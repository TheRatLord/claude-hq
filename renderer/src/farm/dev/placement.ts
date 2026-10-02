/**
 * Placement audit, in page: collision and grounding checks against the scene exactly as the game built it.
 * Driven by `npm run audit:placement` (scripts/placement.ts) through `__valley.audit*`; loaded on demand (dynamic
 * import), so the game never pays for it.
 *
 * Pipeline (the usual broad phase / narrow phase split):
 *   1. items      every static Mesh / InstancedMesh instance / merged-geometry part (scene/parts.ts provenance) of
 *                 the terrain features, shore, flora, structures and plots, named back to its placing code
 *   2. BVH        one three-mesh-bvh per distinct geometry (instances share it), built lazily; one per terrain chunk
 *   3. ground     floating / overhang / sunk / water / path checks: base vertices and surface samples versus the
 *                 rendered terrain (ray cast into the chunk BVHs), supported-by-another-object rays, walkSurface
 *   4. broad      uniform xz grid over world AABBs → candidate pairs of different owners whose AABBs overlap
 *   5. narrow     bvhcast triangle–triangle intersection; the intersection segments give the contact curve
 *                 (length, span) and the AABB overlap gives a depth proxy
 *
 * `show(i)` highlights a finding's items (magenta = a, cyan = b, yellow box = focus) and frames the free camera.
 */
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { SceneCtx } from '../scene/context.ts';
import type { ValleyState } from '../model/types.ts';
import { NOOKS, PATHS, SITES, WORLD, distToPolyline, structure } from '../world/map.ts';
import { Puppets } from '../scene/farmers/assets.ts';
import { lookFor } from '../scene/farmers/look.ts';
import { LOOPS } from '../scene/farmers/idle.ts';
import type { StructureSpots } from '../scene/context.ts';
import { partsOf } from '../scene/parts.ts';
import type { Box, Check, Finding, ItemRef, Vec3 } from './placementCore.ts';
import { assetOf, boxCenter, boxDiag, boxSize, emptyBox, frame, grow, overlapBox, pad, score, triangleSamples } from './placementCore.ts';

export interface AuditOpts {
  /** floating: lowest base point above its support by more than this (m) */
  floatTol?: number;
  /** overhang: part of a wide base hovering by more than this (m) */
  overhangTol?: number;
  /** sunk: terrain above an object's surface by more than this (m) */
  sinkTol?: number;
  /** overlap: ignore contacts whose curve spans less than this (m) */
  minContact?: number;
  /** overlap: pairs a nudge of this size (m) along some axis separates are touching, not overlapping */
  touch?: number;
  /** only items whose key matches (substring) */
  only?: string;
  /**
   * seat a rest-pose farmer of this body (largest look scale) at every leisure-nook seat and stand, and report only
   * the overlaps involving them: farmer × structure and farmer × the farmer on a neighbouring seat
   */
  sitters?: 'claude' | 'codex';
}

interface Geo { pos: Float32Array; box: THREE.Box3; bvh?: MeshBVH }
interface Item extends ItemRef {
  idx: number;
  system: string;
  soft: boolean;
  /** may stand in water (reeds, dock posts …) / sits on the water surface */
  wet: boolean;
  floats: boolean;
  /** a moving/attached piece of a landmark (blades, pigeons, lids…): its owner grounds it */
  attached: boolean;
  geo: Geo;
  /** centre of the base footprint (trunk, legs), filled by the ground checks */
  base?: [number, number];
  matrix: THREE.Matrix4;
  inv?: THREE.Matrix4;
  mesh: THREE.Mesh;
}

const SYSTEMS = ['terrain', 'water', 'flora', 'structures', 'plots', 'forage', 'yard', 'trail', 'projects', 'hillorchard', 'sitters'];
/** ground cover and foliage: grounding checks only, never an overlap (grass through a fence is fine) */
const SOFT = /grass|flowers-|clover|meadow|pebbles|reeds|cattails|lily-(pads|flowers)|paver#|soilBed#|\/ground$|\/(clod|pentile|decor|weed)#/;

// ---------------------------------------------------------------------------------------------------------------
// geometry

const geoCache = new Map<string, Geo>();
function geoOf(g: THREE.BufferGeometry, start: number, count: number): Geo {
  const key = `${g.uuid}|${start}|${count}`;
  let e = geoCache.get(key);
  if (e) return e;
  const p = g.attributes.position as THREE.BufferAttribute;
  const idx = g.index;
  const n = Math.floor(count / 3) * 3;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = idx ? idx.getX(start + i) : start + i;
    pos[i * 3] = p.getX(v); pos[i * 3 + 1] = p.getY(v); pos[i * 3 + 2] = p.getZ(v);
  }
  const box = new THREE.Box3();
  for (let i = 0; i < n; i++) box.expandByPoint(_v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));
  e = { pos, box };
  geoCache.set(key, e);
  return e;
}
function bvhOf(g: Geo): MeshBVH {
  if (!g.bvh) {
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(g.pos, 3));
    g.bvh = new MeshBVH(bg, { maxLeafSize: 8 });
  }
  return g.bvh;
}

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _m = new THREE.Matrix4(), _ray = new THREE.Ray(), _box = new THREE.Box3();
const toBox = (b: THREE.Box3): Box => ({ min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] });

/** world-space triangle soup of an item */
function worldPos(it: Item): Float32Array {
  const src = it.geo.pos, out = new Float32Array(src.length), e = it.matrix.elements;
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i], y = src[i + 1], z = src[i + 2];
    out[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
    out[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    out[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// terrain

interface Chunk { bvh: MeshBVH; x0: number; z0: number; x1: number; z1: number; area: number }
let chunks: Chunk[] = [];
function buildTerrain(scene: THREE.Object3D): void {
  chunks = [];
  const t = scene.getObjectByName('terrain');
  t?.children.forEach((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.name.startsWith('terrain:')) return;
    m.updateWorldMatrix(true, false);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', (m.geometry.attributes.position as THREE.BufferAttribute).clone().applyMatrix4(m.matrixWorld));
    g.computeBoundingBox();
    const b = g.boundingBox!;
    chunks.push({ bvh: new MeshBVH(g), x0: b.min.x, z0: b.min.z, x1: b.max.x, z1: b.max.z, area: (b.max.x - b.min.x) * (b.max.z - b.min.z) });
  });
  chunks.sort((a, b) => a.area - b.area);
}
const _down = new THREE.Vector3(0, -1, 0);
/** rendered terrain height (the faceted chunk mesh, not the analytic heightAt) */
function ground(x: number, z: number): number {
  for (const c of chunks) {
    if (x < c.x0 || x > c.x1 || z < c.z0 || z > c.z1) continue;
    _ray.origin.set(x, 2000, z); _ray.direction.copy(_down);
    const h = c.bvh.raycastFirst(_ray, THREE.DoubleSide);
    if (h) return h.point.y;
  }
  return -Infinity;
}

// ---------------------------------------------------------------------------------------------------------------
// items

let items: Item[] = [];
let findings: Finding[] = [];
let grid = new Map<number, number[]>();
const CELL = 4;
const cellKey = (i: number, j: number) => (i + 4096) * 8192 + (j + 4096);

function visibleChain(o: THREE.Object3D | null): boolean { for (; o; o = o.parent) if (!o.visible) return false; return true; }

function collect(ctx: SceneCtx, state: ValleyState, only?: string): Item[] {
  const out: Item[] = [];
  const plotAtSite = new Map<number, string>();
  for (const p of state.plots.values()) plotAtSite.set(p.site, p.id);
  const siteOf = (x: number, z: number): string => {
    // the nearest field (fence instances sit on the boundary, where a neighbour's margin may also reach)
    let best = 'nowhere', bd = 2.5;
    for (const s of SITES) {
      const c = Math.cos(s.yaw), sn = Math.sin(s.yaw), dx = x - s.x, dz = z - s.z;
      const d = Math.max(Math.abs(dx * c - dz * sn) - s.w / 2, Math.abs(dx * sn + dz * c) - s.d / 2);
      if (d < bd) { bd = d; best = plotAtSite.get(s.index) ?? `site${s.index}`; }
    }
    return best;
  };
  const add = (mesh: THREE.Mesh, system: string, key: string, owner: string, geo: Geo, matrix: THREE.Matrix4) => {
    if (only && !key.includes(only)) return;
    if (!geo.pos.length) return;
    const b = _box.copy(geo.box).applyMatrix4(matrix);
    if (!Number.isFinite(b.min.x) || b.isEmpty()) return;
    // a hidden (zero-scaled) instance: an unsown crop, a stage that is not showing
    if (Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) < 0.02) return;
    const k = `${system}/${key}`;
    const leaf = key.split('/').pop() ?? key;
    out.push({
      idx: out.length, key: k, owner: `${system}/${owner}`, asset: assetOf(k), box: toBox(b), system, geo, matrix: matrix.clone(), mesh,
      soft: SOFT.test(key) || SOFT.test(owner),
      wet: /reeds|cattails|lily-(pads|flowers)|river-rocks|ford-stones|pebbles|dock|bridge/.test(key),
      floats: /lily-(pads|flowers)/.test(leaf),
      attached: system === 'structures' && /\/m\d+(#\d+)?$/.test(key),
    });
  };
  const pathOf = (o: THREE.Object3D, root: THREE.Object3D): string[] => {
    const names: string[] = [];
    for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (p.name) names.unshift(p.name);
    return names;
  };

  for (const sys of SYSTEMS) {
    const root = ctx.scene.getObjectByName(sys);
    if (!root) continue;
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !visibleChain(mesh)) return;
      const mat = mesh.material as THREE.Material;
      if (Array.isArray(mat) || (mat.transparent && !mat.depthWrite)) return; // decals, light pools, glows
      const names = pathOf(mesh, root);
      const name = mesh.name, path = names.join('/') + (name ? '' : `${names.length ? '/' : ''}m${mesh.parent?.children.indexOf(mesh) ?? 0}`);
      // ---- what to skip ----
      if (sys === 'terrain' && name.startsWith('terrain:')) return;
      if (sys === 'water' && !names.includes('shore')) return;
      if (sys === 'flora' && name === 'drifters') return;
      if (sys === 'trail' && /^trail:(flag|sign)$/.test(name)) return; // the flag flies off its pole, the lettering sits on its boards
      if (sys === 'hillorchard' && /^orchard:(bees|petals|sign)$/.test(name)) return; // bees and drifting petals are in the air; the sign board sits on its posts
      if (sys === 'plots' && /^plots:(fx|beast|signtext|lantern|exitribbon|fenceribbon)/.test(name)) return;
      const g = mesh.geometry;
      const total = g.index ? g.index.count : (g.attributes.position?.count ?? 0);
      const inst = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh) : null;
      // ---- instanced: one item per instance ----
      if (inst) {
        const geo = geoOf(g, 0, total);
        for (let i = 0; i < inst.count; i++) {
          inst.getMatrixAt(i, _m);
          const m = new THREE.Matrix4().multiplyMatrices(mesh.matrixWorld, _m);
          if (Math.abs(m.determinant()) < 1e-9) continue; // scaled to nothing (hidden slot)
          let key = `${path}#${i}`, owner = key;
          if (sys === 'plots' && name.startsWith('plots:')) {
            const base = name.slice(6).replace(/:(spring|summer|autumn|winter)$/, '');
            _v.setFromMatrixPosition(m);
            const field = `field:${siteOf(_v.x, _v.z)}`;
            const group = base === 'fence' ? 'fence' : /^(clod|pentile|decor|weed)$/.test(base) ? 'ground' : null;
            key = `${field}/${base}#${i}`;
            owner = group ? `${field}/${group}` : key;
          } else if (sys === 'plots' && names[0]?.startsWith('field:') && name.startsWith('crop:')) owner = `${names[0]}/crops`;
          else if (sys === 'structures' || sys === 'sitters') owner = names[0] ?? path; // animated bits of a landmark (blades, pigeons…), one sitter's body parts
          add(mesh, sys, key, owner, geo, m);
        }
        return;
      }
      // ---- merged geometry with provenance: one item per named part ----
      const parts = partsOf(g);
      const prefix = sys === 'plots' && names[0]?.startsWith('field:') ? `${names[0]}/`
        : sys === 'structures' && names[0] && !name.startsWith('structures:') ? `${names[0]}/` : ''; // baked parts carry their landmark
      if (parts?.length) {
        let cur = 0;
        const gap = (a: number, b: number) => { if (b > a) add(mesh, sys, `${path}@${a}`, prefix + (names[0] ?? path), geoOf(g, a, b - a), mesh.matrixWorld); };
        for (const p of parts) {
          gap(cur, p.start);
          const key = `${prefix}${sys === 'terrain' ? `${name}/` : ''}${p.name}`;
          add(mesh, sys, key, key, geoOf(g, p.start, p.count), mesh.matrixWorld);
          cur = p.start + p.count;
        }
        gap(cur, total);
        return;
      }
      // ---- plain mesh: belongs to its top named ancestor (a structure, a field) ----
      const owner = sys === 'structures' || sys === 'plots' ? (names[0] ?? path) : path;
      add(mesh, sys, path || name || 'mesh', owner, geoOf(g, 0, total), mesh.matrixWorld);
    });
  }
  return mergeSameKey(out);
}

/** one placed object can span several meshes (solid + glow bake, bake cells): join pieces with the same key */
function mergeSameKey(list: Item[]): Item[] {
  const by = new Map<string, Item[]>();
  for (const it of list) { const g = by.get(it.key); if (g) g.push(it); else by.set(it.key, [it]); }
  const out: Item[] = [];
  for (const g of by.values()) {
    if (g.length === 1) { out.push(g[0]); continue; }
    const parts = g.map(worldPos);
    const pos = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { pos.set(p, at); at += p.length; }
    const box = new THREE.Box3();
    for (let i = 0; i < pos.length; i += 3) box.expandByPoint(_v.set(pos[i], pos[i + 1], pos[i + 2]));
    out.push({ ...g[0], geo: { pos, box }, matrix: new THREE.Matrix4(), inv: undefined, box: toBox(box) });
  }
  out.forEach((it, i) => { it.idx = i; });
  return out;
}

function buildGrid(list: Item[]): void {
  grid = new Map();
  for (const it of list) {
    const i0 = Math.floor(it.box.min[0] / CELL), i1 = Math.floor(it.box.max[0] / CELL);
    const j0 = Math.floor(it.box.min[2] / CELL), j1 = Math.floor(it.box.max[2] / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = cellKey(i, j);
      const c = grid.get(k);
      if (c) c.push(it.idx); else grid.set(k, [it.idx]);
    }
  }
}

/** highest support below (x, y, z) from other objects (not `self`'s owner), within `range`; -Infinity if none */
function supportBelow(self: Item, x: number, y: number, z: number, range: number): number {
  const c = grid.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (!c) return -Infinity;
  let best = -Infinity;
  for (const i of c) {
    const o = items[i];
    if (o.owner === self.owner || o.soft && !/paver|soilBed|pentile|clod|lily/.test(o.key)) continue;
    const b = o.box;
    if (x < b.min[0] || x > b.max[0] || z < b.min[2] || z > b.max[2] || b.min[1] > y + 0.01 || b.max[1] < y - range) continue;
    o.inv ??= o.matrix.clone().invert();
    // cast from a little above: a base sunk into its support (wheat in a soil ridge) counts as resting on it
    _ray.origin.set(x, y + 0.3, z).applyMatrix4(o.inv);
    _ray.direction.set(0, -1, 0).transformDirection(o.inv);
    const h = bvhOf(o.geo).raycastFirst(_ray, THREE.DoubleSide);
    if (!h) continue;
    const wy = Math.min(y, _w.copy(h.point).applyMatrix4(o.matrix).y);
    if (wy >= y - range && wy > best) best = wy;
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------------------
// checks

function groundChecks(ctx: SceneCtx, it: Item, o: Required<Omit<AuditOpts, 'only' | 'sitters'>>, out: Finding[]): void {
  const wp = worldPos(it);
  const n = wp.length / 3;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) { const y = wp[i * 3 + 1]; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const h = maxY - minY;
  const size = Math.max(boxSize(it.box)[0], boxSize(it.box)[2], h);
  const walk = ctx.services.get('walkSurface') as ((x: number, z: number) => number | null) | undefined;

  // ---- base: the bottom slab of vertices ----
  const slab = Math.max(0.03, Math.min(0.25, h * 0.08));
  const seen = new Set<string>();
  const base: number[] = [];
  for (let i = 0; i < n; i++) {
    const y = wp[i * 3 + 1];
    if (y > minY + slab) continue;
    const x = wp[i * 3], z = wp[i * 3 + 2];
    const k = `${Math.round(x * 50)},${Math.round(z * 50)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    base.push(x, y, z);
  }
  const stride = Math.max(1, Math.floor(base.length / 3 / 64));
  let minGap = Infinity, maxGap = -Infinity, wet = 0, dry = 0;
  /** resting (partly) on another object: a stacked bale may overhang its support, that is not a slope problem */
  let onObject = false;
  const fb = emptyBox(), hov = emptyBox();
  let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
  for (let i = 0; i < base.length / 3; i += stride) {
    const x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2];
    bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); bz0 = Math.min(bz0, z); bz1 = Math.max(bz1, z);
    let g = ground(x, z);
    if (g < WORLD.water) { if (it.floats) g = WORLD.water; if (y < WORLD.water - 0.02) wet++; } else dry++;
    let gap = y - g;
    if (gap > o.floatTol) {
      const ws = walk?.(x, z);
      if (ws != null && ws <= y + 0.01) gap = Math.min(gap, y - ws);
    }
    if (gap > o.floatTol) {
      const s = supportBelow(it, x, y, z, gap);
      if (s > -Infinity) { gap = Math.min(gap, Math.max(0, y - s)); if (gap <= o.floatTol) onObject = true; }
    }
    if (gap < minGap) minGap = gap;
    if (gap > maxGap) maxGap = gap;
    grow(fb, x, y, z);
    if (gap > o.overhangTol) { grow(hov, x, y, z); grow(hov, x, y - gap, z); }
  }
  const width = Math.max(bx1 - bx0, bz1 - bz0);
  it.base = [(bx0 + bx1) / 2, (bz0 + bz1) / 2];
  const keyRef = { key: it.key, owner: it.owner, asset: it.asset, box: it.box };
  if (it.attached) { /* grounded by its landmark */ } else if (minGap > o.floatTol && minGap < 50) {
    const focus = grow(grow({ min: [...fb.min] as Vec3, max: [...fb.max] as Vec3 }, fb.min[0], fb.min[1] - minGap, fb.min[2]), fb.max[0], fb.max[1], fb.max[2]);
    const extra = { size, h, base: width };
    out.push({ check: 'floating', a: keyRef, value: minGap, extra, focus, score: score('floating', minGap, extra) });
  } else if (maxGap > o.overhangTol && width > 0.5 && !it.soft && !onObject) {
    const extra = { width, h, minGap };
    out.push({ check: 'overhang', a: keyRef, value: maxGap, extra, focus: hov, score: score('overhang', maxGap, extra) });
  }
  if (wet > 0 && !it.wet && !it.soft) {
    const depth = WORLD.water - minY;
    out.push({ check: 'water', a: keyRef, value: depth, extra: { wet, dry }, focus: it.box, score: score('water', depth) });
  }

  // ---- sunk: terrain above the object's surface (skip ground cover and low foliage) ----
  if (!(it.soft && h < 0.8)) {
    // skip triangles clearly above the local terrain
    let gTop = -Infinity;
    const b = it.box;
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) gTop = Math.max(gTop, ground(b.min[0] + (b.max[0] - b.min[0]) * i / 4, b.min[2] + (b.max[2] - b.min[2]) * j / 4));
    let worst = 0;
    let span = 0;
    const sb = emptyBox();
    const pts: number[] = [];
    const tri = new Float32Array(9);
    for (let t = 0; t < n; t += 3) {
      const y0 = Math.min(wp[t * 3 + 1], wp[t * 3 + 4], wp[t * 3 + 7]);
      if (y0 > gTop + 0.02) continue;
      for (let k = 0; k < 9; k++) tri[k] = wp[t * 3 + k];
      pts.length = 0;
      triangleSamples(tri, 0.3, pts);
      for (let s = 0; s < pts.length; s += 3) {
        const d = ground(pts[s], pts[s + 2]) - pts[s + 1];
        if (d > o.sinkTol) { grow(sb, pts[s], pts[s + 1], pts[s + 2]); if (d > worst) worst = d; }
      }
    }
    if (worst > o.sinkTol) {
      span = Math.max(sb.max[0] - sb.min[0], sb.max[2] - sb.min[2]);
      // design burial: base vertices sitting just under the ground are fine; we flag terrain over the object's body
      const extra = { h, span, frac: worst / Math.max(0.05, h) };
      out.push({ check: 'sunk', a: keyRef, value: worst, extra, focus: pad(sb, 0.15), score: score('sunk', worst, extra) });
    }
  }

  // ---- path: a solid object standing on a road centre ----
  if (!it.soft && !it.attached && h > 0.3 && it.system !== 'terrain' && width > 0.05) {
    const cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2;
    for (const p of PATHS) {
      const d = distToPolyline(cx, cz, p.points);
      if (d < p.width * 0.3) {
        out.push({ check: 'path', a: keyRef, value: p.width * 0.3 - d, extra: { width: p.width, d }, focus: it.box, score: score('path', p.width * 0.3 - d) });
        break;
      }
    }
  }
}

const _line = new THREE.Line3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const NUDGE = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
const _t = new THREE.Matrix4(), _n = new THREE.Matrix4();
function separable(ba: MeshBVH, bb: MeshBVH, A: Item, B: Item, eps: number): boolean {
  for (const [x, y, z] of NUDGE) {
    _n.multiplyMatrices(A.inv!, _t.makeTranslation(x * eps, y * eps, z * eps).multiply(B.matrix));
    const hit = ba.bvhcast(bb, _n, { intersectsTriangles: (t1, t2) => t1.intersectsTriangle(t2) });
    if (!hit) return true;
  }
  return false;
}
function overlapChecks(o: Required<Omit<AuditOpts, 'only' | 'sitters'>>, out: Finding[]): number {
  const done = new Set<number>();
  let pairs = 0;
  const N = items.length;
  for (const cell of grid.values()) {
    for (let x = 0; x < cell.length; x++) {
      const A = items[cell[x]];
      if (A.soft) continue;
      for (let y = x + 1; y < cell.length; y++) {
        const B = items[cell[y]];
        if (B.soft || A.owner === B.owner) continue;
        const lo = Math.min(A.idx, B.idx), hi = Math.max(A.idx, B.idx), pk = lo * N + hi;
        if (done.has(pk)) continue;
        done.add(pk);
        const ob = overlapBox(A.box, B.box);
        if (!ob) continue;
        const os = boxSize(ob);
        if (Math.min(os[0], os[1], os[2]) < 0.005) continue;
        pairs++;
        // narrow phase: B's triangles in A's frame
        const ba = bvhOf(A.geo), bb = bvhOf(B.geo);
        A.inv ??= A.matrix.clone().invert();
        const toA = _m.multiplyMatrices(A.inv, B.matrix);
        const cb = emptyBox();
        let len = 0, hits = 0;
        ba.bvhcast(bb, toA, {
          intersectsTriangles(t1, t2) {
            if (t1.intersectsTriangle(t2, _line)) {
              _a.copy(_line.start).applyMatrix4(A.matrix); _b.copy(_line.end).applyMatrix4(A.matrix);
              const l = _a.distanceTo(_b);
              if (l > 1e-4) { len += l; grow(cb, _a.x, _a.y, _a.z); grow(cb, _b.x, _b.y, _b.z); hits++; }
            }
            return hits > 4000;
          },
        });
        if (!hits) continue;
        // touching, not interpenetrating: nudging B by `touch` along some axis separates them (a crate resting on a
        // deck, a pot against a wall). A real overlap (a rail through a trunk) survives every nudge.
        if (separable(ba, bb, A, B, o.touch)) continue;
        const span = boxDiag(cb);
        if (span < o.minContact) continue;
        const depth = Math.min(os[0], os[1], os[2]);
        // how far apart the two bases stand, relative to their half-widths (≥ 1: footprints apart; trunks vs crowns)
        const ra = Math.max(A.box.max[0] - A.box.min[0], A.box.max[2] - A.box.min[2]) / 2, rb = Math.max(B.box.max[0] - B.box.min[0], B.box.max[2] - B.box.min[2]) / 2;
        const sep = A.base && B.base ? Math.hypot(A.base[0] - B.base[0], A.base[1] - B.base[1]) : 0;
        const extra = { depth, curve: len, hits, sep, sepRatio: sep / Math.max(0.01, ra + rb) };
        const ref = (it: Item): ItemRef => ({ key: it.key, owner: it.owner, asset: it.asset, box: it.box });
        const [a, b] = A.key < B.key ? [A, B] : [B, A];
        out.push({ check: 'overlap', a: ref(a), b: ref(b), value: span, extra, focus: pad(cb, 0.1), score: score('overlap', span, extra) });
      }
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------------------------------------------
// sitters: farmers posed on the leisure seats

/** the activity loop a farmer runs on each kind of nook seat (brain.ts buildSeats, idle.ts LOOPS) */
const SIT_LOOP: Record<string, string> = { checkers: 'checkers', blanket: 'blanket', soak: 'soak', lookout: 'lookout', bench: 'sit', telescope: 'telescope' };

/** the posed sitters stay in the scene (for the contact sheets) until the next audit */
let sitterRoot: THREE.Group | null = null;
function placeSitters(ctx: SceneCtx, body: 'claude' | 'codex'): THREE.Group {
  const root = new THREE.Group();
  root.name = 'sitters';
  const spots = ctx.services.get('structureSpots') as StructureSpots | undefined;
  if (!spots) return root;
  const nookOf = (x: number, z: number): string | null => {
    for (const id of NOOKS) { const s = structure(id); if (Math.hypot(x - s.x, z - s.z) < Math.max(s.size[0], s.size[1]) / 2 + 0.5) return id; }
    return null;
  };
  const list = spots.seats().filter((s) => s.kind in SIT_LOOP).map((s) => ({ ...s }));
  const tel = spots.get('telescope');
  if (tel) list.push({ ...tel, kind: 'telescope' });
  const n: Record<string, number> = {};
  const look = lookFor({ seed: 'audit', tier: body === 'claude' ? 'opus' : null, kind: body }, 0x5a8fd6);
  for (const s of list) {
    const nook = nookOf(s.x, s.z);
    if (!nook) continue;
    // one seat = one owner; every act of its loop is posed there (they never meet each other, only the props and
    // the neighbouring seats)
    const g = new THREE.Group();
    g.name = `${nook}:${s.kind}${(n[nook + s.kind] = (n[nook + s.kind] ?? -1) + 1)}:${body}`;
    g.position.set(s.x, s.y, s.z); // SEAT_H is 0 for every nook act: the root sits on the published seat height
    g.scale.setScalar(1.05); // the largest look scale
    for (const act of new Set(LOOPS[SIT_LOOP[s.kind]].map((b) => b.act))) {
      const p = new Puppets(1);
      p.add(look, act, 0, 0, s.yaw);
      p.tick(0.5, 1 / 60);
      const a = new THREE.Group();
      a.name = act;
      a.add(p.crowd.group);
      g.add(a);
    }
    root.add(g);
  }
  ctx.scene.add(root);
  return root;
}

// ---------------------------------------------------------------------------------------------------------------
// public

export interface AuditResult { items: number; pairs: number; ms: number; findings: Finding[]; perSystem: Record<string, number> }

export function audit(ctx: SceneCtx, state: ValleyState, opts: AuditOpts = {}): AuditResult {
  const t0 = performance.now();
  const o = { floatTol: opts.floatTol ?? 0.04, overhangTol: opts.overhangTol ?? 0.2, sinkTol: opts.sinkTol ?? 0.12, minContact: opts.minContact ?? 0.06, touch: opts.touch ?? 0.03 };
  clearHighlight(ctx);
  geoCache.clear();
  // view-culled instance sets (the plots meadow) put every instance back for this audit (the next frame re-culls)
  ctx.scene.traverse((x) => { (x.userData.uncull as (() => void) | undefined)?.(); });
  buildTerrain(ctx.scene);
  sitterRoot?.removeFromParent();
  const sitters = sitterRoot = opts.sitters ? placeSitters(ctx, opts.sitters) : null;
  sitters?.updateMatrixWorld(true);
  items = collect(ctx, state, opts.only);
  buildGrid(items);
  let out: Finding[] = [];
  if (!sitters) for (const it of items) groundChecks(ctx, it, o, out);
  const pairs = overlapChecks(o, out);
  if (sitters) out = out.filter((f) => f.a.key.startsWith('sitters/') || f.b?.key.startsWith('sitters/'));
  findings = out;
  const perSystem: Record<string, number> = {};
  for (const it of items) perSystem[it.system] = (perSystem[it.system] ?? 0) + 1;
  return { items: items.length, pairs, ms: Math.round(performance.now() - t0), findings: out, perSystem };
}

let hl: THREE.Group | null = null;
export function clearHighlight(ctx: SceneCtx): void {
  if (!hl) return;
  ctx.scene.remove(hl);
  hl.traverse((x) => { const m = x as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
  hl = null;
}

/** Highlight items by key and frame the camera on a box; returns the camera pose for the caller (dev api `cam`). */
export function show(ctx: SceneCtx, keys: string[], focus: Box, view: number): { x: number; y: number; z: number; yaw: number; pitch: number } {
  clearHighlight(ctx);
  hl = new THREE.Group();
  hl.name = 'placement-highlight';
  const colors = [0xff2bd6, 0x22e0ff];
  const hiItems: Item[] = [];
  keys.forEach((k, i) => {
    const it = items.find((x) => x.key === k);
    if (!it) return;
    hiItems.push(it);
    // a big object (the farmhouse) would cover the view: highlight only its triangles near the problem
    let wp = worldPos(it);
    if (boxDiag(it.box) > 6) {
      const b = pad(focus, 1.2), keep: number[] = [];
      const inB = (i: number) => wp[i] >= b.min[0] && wp[i] <= b.max[0] && wp[i + 1] >= b.min[1] && wp[i + 1] <= b.max[1] && wp[i + 2] >= b.min[2] && wp[i + 2] <= b.max[2];
      for (let t = 0; t < wp.length; t += 9) if (inB(t) || inB(t + 3) || inB(t + 6)) for (let k = 0; k < 9; k++) keep.push(wp[t + k]);
      wp = new Float32Array(keep);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(wp, 3));
    for (const [depthTest, opacity] of [[false, 0.28], [true, 0.55]] as const) {
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: colors[i % 2], transparent: true, opacity, depthTest, depthWrite: false, fog: false, side: THREE.DoubleSide }));
      m.renderOrder = 998;
      m.frustumCulled = false;
      hl!.add(m);
    }
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), new THREE.LineBasicMaterial({ color: colors[i % 2], depthTest: false, fog: false }));
    e.renderOrder = 999;
    hl!.add(e);
  });
  const fb = new THREE.Box3(new THREE.Vector3(...focus.min), new THREE.Vector3(...focus.max));
  const helper = new THREE.Box3Helper(fb, 0xffe14a);
  (helper.material as THREE.LineBasicMaterial).depthTest = false;
  helper.renderOrder = 999;
  hl.add(helper);
  ctx.scene.add(hl);

  // frame: the focus box plus a bit of each item for context
  const c = boxCenter(focus);
  let r = Math.max(0.9, boxDiag(focus) * 0.7);
  for (const it of hiItems) r = Math.max(r, Math.min(boxDiag(it.box) > 6 ? 1.5 : 4, boxDiag(it.box) * 0.45));
  if (view === 2) {
    const p = frame(c, r * 1.4, 0.3, 1.25);
    return p;
  }
  // pick the least occluded azimuth (terrain + other objects between the camera and the target)
  const occl = (az: number): number => {
    const p = frame(c, r, az, 0.42);
    let n = 0;
    for (let k = 1; k < 10; k++) {
      const t = k / 10, x = c[0] + (p.x - c[0]) * t, y = c[1] + (p.y - c[1]) * t, z = c[2] + (p.z - c[2]) * t;
      if (ground(x, z) > y - 0.2) n += 3;
      const cell = grid.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
      if (cell) for (const i of cell) { const b = items[i].box; if (!items[i].soft && !hiItems.includes(items[i]) && x > b.min[0] && x < b.max[0] && y > b.min[1] && y < b.max[1] && z > b.min[2] && z < b.max[2]) { n++; break; } }
    }
    return n + (ground(p.x, p.z) > p.y - 0.4 ? 5 : 0);
  };
  const azs = Array.from({ length: 12 }, (_, i) => (i / 12) * Math.PI * 2);
  const ranked = azs.map((a) => ({ a, n: occl(a) })).sort((p, q) => p.n - q.n);
  const a0 = ranked[0].a;
  const second = ranked.find((x) => Math.abs(Math.atan2(Math.sin(x.a - a0), Math.cos(x.a - a0))) > 1.2)?.a ?? a0 + 1.6;
  const p = frame(c, r, view === 0 ? a0 : second, 0.42);
  p.y = Math.max(p.y, ground(p.x, p.z) + 0.6);
  // re-aim after lifting
  const vx = c[0] - p.x, vy = c[1] - p.y, vz = c[2] - p.z;
  return { x: p.x, y: p.y, z: p.z, yaw: Math.atan2(-vx, -vz), pitch: Math.atan2(vy, Math.hypot(vx, vz)) };
}
