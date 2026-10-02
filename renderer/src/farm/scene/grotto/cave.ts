/**
 * The grotto's meshes (room-local: the mouth at the origin, +z out toward the falls; world/grotto.ts has the plan).
 * Built once on the first visit, merged so the whole cave stays in a couple of dozen draws:
 *
 *  - the shell: the cave's signed-distance field polygonised (surface nets, 0.36 m), faceted, floor vertices snapped
 *    to the plan's floor, painted per face (cool wet rock, moss by the pool and the mouth, darker overhead), with the
 *    stalactites and stalagmites merged in: one draw;
 *  - the crystals and the little glow-caps: one draw, a toon material whose emissive cycles slowly through teal,
 *    violet and rose per cluster (`crystalTint` mirrors it on the CPU for the LightEmitters);
 *  - the pool: one draw, a still dark mirror that reflects the crystals, the lantern and the mouth analytically (no
 *    second render), rippled by the drips; blind cave fish under it (one instanced draw);
 *  - the cave paintings: one canvas texture on a quad grid hugging the north wall;
 *  - the bats: one instanced draw, wings folded / flapping in the vertex shader;
 *  - the drips: one point draw animated on the GPU (the room plays their plips);
 *  - the mouth from inside: a curtain of backlit water, light shafts and drifting spray (three draws);
 *  - the explorer's camp + the chest's body (one draw), the chest lid, the lantern glass, today's glow-caps.
 *
 * Nothing allocates per frame: every update writes into preallocated buffers and uniforms.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PAL, paint } from '../toon.ts';
import { blob, loft } from '../sculpt.ts';
import { partName, recordParts } from '../parts.ts';
import { chainShader, ensureSurface, surfaceMaterial, tagSurface, SURF } from '../surface/index.ts';
import { toon } from '../toon.ts';
import { catchGeometry, forageGeometry } from '../forage/models.ts';
import {
  CAMP, CHEST, CRATE_H, GLOWCAP, PAINTING, POOL, ROOST, SHELL_END, SOLIDS, caveFloor, caveRay, caveSdf, noise3,
} from '../../world/grotto.ts';

const C = (hex: number) => new THREE.Color(hex);
const rnd = (seed: number) => { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

/** keep only position / normal / colour (+ surface), so parts merge */
function clean(g: THREE.BufferGeometry, keep: readonly string[] = ['position', 'normal', 'color']): THREE.BufferGeometry {
  const f = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(f.attributes)) if (!keep.includes(k)) f.deleteAttribute(k);
  if (!f.attributes.normal) f.computeVertexNormals();
  return f;
}
/** a three primitive, flat-shaded, painted one colour */
const prim = (g: THREE.BufferGeometry, color: number) => { const f = clean(g, ['position']); f.computeVertexNormals(); return paint(f, color); };
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts)!;
  recordParts(g, parts);
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}
/** place a part: turn about y, then move */
const put = (g: THREE.BufferGeometry, x: number, y: number, z: number, yaw = 0) => g.rotateY(yaw).translate(x, y, z);

// ------------------------------------------------------------------------------------------------------- the shell

interface Box { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }
const SHELL_BOX: Box = { x0: -12.5, y0: -1.6, z0: -21.5, x1: 12.5, y1: 7.6, z1: SHELL_END + 0.4 };

/**
 * Surface nets over `f` (negative = air): one vertex per sign-changing cell (the mean of its edge crossings), one quad
 * per sign-changing edge, wound so faces look into the air. Quads reaching past `clipZ` are dropped (the open mouth).
 */
function surfaceNets(f: (x: number, y: number, z: number) => number, b: Box, h: number, clipZ: number): Float32Array {
  const nx = Math.ceil((b.x1 - b.x0) / h) + 1, ny = Math.ceil((b.y1 - b.y0) / h) + 1, nz = Math.ceil((b.z1 - b.z0) / h) + 1;
  const val = new Float32Array(nx * ny * nz);
  const I = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) val[I(i, j, k)] = f(b.x0 + i * h, b.y0 + j * h, b.z0 + k * h);
  const cellV = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const CI = (i: number, j: number, k: number) => i + (nx - 1) * (j + (ny - 1) * k);
  const verts: number[] = [];
  const corner = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let neg = 0;
    for (let c = 0; c < 8; c++) { const [a, bb, cc] = corner[c]; cv[c] = val[I(i + a, j + bb, k + cc)]; if (cv[c] < 0) neg++; }
    if (neg === 0 || neg === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [e0, e1] of edges) {
      const v0 = cv[e0], v1 = cv[e1];
      if ((v0 < 0) === (v1 < 0)) continue;
      const t = v0 / (v0 - v1);
      const p0 = corner[e0], p1 = corner[e1];
      sx += p0[0] + (p1[0] - p0[0]) * t; sy += p0[1] + (p1[1] - p0[1]) * t; sz += p0[2] + (p1[2] - p0[2]) * t; n++;
    }
    cellV[CI(i, j, k)] = verts.length / 3;
    verts.push(b.x0 + (i + sx / n) * h, b.y0 + (j + sy / n) * h, b.z0 + (k + sz / n) * h);
  }
  const out: number[] = [];
  const tri = (a: number, b2: number, c: number) => out.push(verts[a * 3], verts[a * 3 + 1], verts[a * 3 + 2], verts[b2 * 3], verts[b2 * 3 + 1], verts[b2 * 3 + 2], verts[c * 3], verts[c * 3 + 1], verts[c * 3 + 2]);
  const quad = (q: number[], axis: number, airLow: boolean) => {
    if (q.some((v) => v < 0)) return;
    if (q.some((v) => verts[v * 3 + 2] > clipZ)) return;
    // winding so the normal points into the air (toward the low end of the edge when the air is there)
    const [a, b2, c] = q;
    const ux = verts[b2 * 3] - verts[a * 3], uy = verts[b2 * 3 + 1] - verts[a * 3 + 1], uz = verts[b2 * 3 + 2] - verts[a * 3 + 2];
    const vx = verts[c * 3] - verts[a * 3], vy = verts[c * 3 + 1] - verts[a * 3 + 1], vz = verts[c * 3 + 2] - verts[a * 3 + 2];
    const nn = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx][axis];
    const want = airLow ? -1 : 1;
    if (nn * want >= 0) { tri(q[0], q[1], q[2]); tri(q[0], q[2], q[3]); } else { tri(q[0], q[2], q[1]); tri(q[0], q[3], q[2]); }
  };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const v = val[I(i, j, k)];
    // x edge (i → i+1): cells around it in the y-z plane
    if (i < nx - 1 && (v < 0) !== (val[I(i + 1, j, k)] < 0) && i < nx - 1)
      quad([cellV[CI(i, j - 1, k - 1)], cellV[CI(i, j, k - 1)], cellV[CI(i, j, k)], cellV[CI(i, j - 1, k)]], 0, v < 0);
    if ((v < 0) !== (val[I(i, j + 1, k)] < 0) && j < ny - 1)
      quad([cellV[CI(i - 1, j, k - 1)], cellV[CI(i, j, k - 1)], cellV[CI(i, j, k)], cellV[CI(i - 1, j, k)]], 1, v < 0);
    if ((v < 0) !== (val[I(i, j, k + 1)] < 0) && k < nz - 1)
      quad([cellV[CI(i - 1, j - 1, k)], cellV[CI(i, j - 1, k)], cellV[CI(i, j, k)], cellV[CI(i - 1, j, k)]], 2, v < 0);
  }
  return new Float32Array(out);
}

/** Rock colours: cool and a little damp; moss where the pool and the mouth keep it wet and lit. */
const ROCK = C(0x6c6774), ROCK_WARM = C(0x7a6e66), ROCK_DARK = C(0x45414f), FLOOR = C(0x5e5862), MOSS = C(0x4f7a3e), MOSS_DARK = C(0x3a5a34), WET = C(0x3c3a48), CALCITE = C(0xb2a796);

function shellColor(x: number, y: number, z: number, ny: number, out: THREE.Color): THREE.Color {
  const n = noise3(x * 0.7, y * 0.7, z * 0.7), band = Math.sin(y * 3.1 + n * 2.2);
  if (ny > 0.55) {
    out.copy(FLOOR).lerp(ROCK_WARM, Math.max(0, n) * 0.5);
    const pr = Math.hypot((x - POOL.x) / POOL.rx, (z - POOL.z) / POOL.rz);
    if (y < POOL.water + 0.05) out.copy(WET);                                        // under the water
    else if (pr < 1.7) out.lerp(MOSS, Math.max(0, 0.75 - (pr - 1) * 0.9 + n * 0.5) * 0.9);
    if (z > -4.5) out.lerp(MOSS, Math.max(0, (z + 4.5) / 5.5 * 0.7 + n * 0.4));     // daylight at the mouth
    if (noise3(x * 2.1, 1.3, z * 2.1) > 0.45) out.lerp(MOSS_DARK, 0.45);
  } else if (ny < -0.45) {
    out.copy(ROCK_DARK).lerp(ROCK, 0.3 + n * 0.25);
  } else {
    out.copy(ROCK).lerp(band > 0.55 ? ROCK_WARM : ROCK_DARK, band > 0.55 ? 0.45 : 0.25 + Math.max(0, -n) * 0.4);
    if (y < 0.5 && noise3(x * 1.4, y * 2, z * 1.4) > 0.1) out.lerp(MOSS_DARK, 0.35);
    if (z > -3.5 && y < 2.4) out.lerp(MOSS, Math.max(0, (z + 3.5) / 4.5) * 0.55);
  }
  return out;
}

/** a stalactite (hanging from y down `len`) or a stalagmite (rising from y up `len`): a lumpy cone */
function dripstone(x: number, y: number, z: number, len: number, r: number, down: boolean, rand: () => number): THREE.BufferGeometry {
  const s = down ? -1 : 1;
  const rings = [0, 0.3, 0.62, 0.86, 1].map((t, i) => ({ p: [x + (rand() - 0.5) * 0.04 * i, y + s * (t * len - (i === 0 ? 0.35 : 0)), z + (rand() - 0.5) * 0.04 * i] as [number, number, number], r: Math.max(0.006, r * (1 - t) ** 1.25 + 0.006) }));
  return loft(rings, { sides: 6, sub: 1, caps: ['flat', 'pole'], paint: (f) => (f.t > 0.7 ? CALCITE.getHex() : 0x8a8078), round: 0 });
}

export interface Shell { geometry: THREE.BufferGeometry; drips: { x: number; y: number; z: number; floor: number }[] }

/** The cave shell with its dripstones (one merged, faceted, vertex-coloured geometry). */
export function buildShell(res = 0.36): Shell {
  const pos = surfaceNets(caveSdf, SHELL_BOX, res, SHELL_END);
  // snap the floor to the plan (feet, props and the pool rim all sit on exactly this)
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2], f = caveFloor(x, z);
    if (Math.abs(y - f) < 0.2 && caveSdf(x, f + 0.6, z) < -0.15) pos[i + 1] = f;
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  // per-face colour
  const col = new Float32Array(pos.length), nrm = g.attributes.normal as THREE.BufferAttribute, c = new THREE.Color();
  for (let i = 0; i < pos.length; i += 9) {
    const x = (pos[i] + pos[i + 3] + pos[i + 6]) / 3, y = (pos[i + 1] + pos[i + 4] + pos[i + 7]) / 3, z = (pos[i + 2] + pos[i + 5] + pos[i + 8]) / 3;
    shellColor(x, y, z, nrm.getY(i / 3), c);
    for (let k = 0; k < 3; k++) { col[i + k * 3] = c.r; col[i + k * 3 + 1] = c.g; col[i + k * 3 + 2] = c.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g = partName(g, 'shell');
  // dripstones: stalactites over the open floor (some drip), stalagmites at the plan's solids
  const r = rnd(7), parts: THREE.BufferGeometry[] = [g];
  const drips: Shell['drips'] = [];
  for (let gx = -9; gx <= 9; gx += 1.15) for (let gz = -19; gz <= -3; gz += 1.15) {
    const x = gx + (r() - 0.5) * 0.9, z = gz + (r() - 0.5) * 0.9;
    const f = caveFloor(x, z);
    if (caveSdf(x, f + 1, z) > -0.4) continue;
    const up = caveRay(x, f + 1, z, 0, 1, 0, 9);
    if (up < 2.2 || r() < 0.35) continue;
    const top = f + 1 + up, len = 0.25 + r() * Math.min(1.3, up * 0.3), rad = 0.06 + r() * 0.12 + len * 0.06;
    parts.push(partName(dripstone(x, top + 0.02, z, len, rad, true, r), 'stalactite'));
    if (drips.length < 9 && (r() < 0.3 || (Math.hypot((x - POOL.x) / POOL.rx, (z - POOL.z) / POOL.rz) < 0.8 && drips.length < 4))) {
      const pr = Math.hypot((x - POOL.x) / POOL.rx, (z - POOL.z) / POOL.rz);
      drips.push({ x, y: top - len, z, floor: pr < 0.9 ? POOL.water : f });
    }
  }
  // the bats' roost: a cluster of small ones round the crack
  for (let i = 0; i < 6; i++) {
    const a = i * 1.1, x = ROOST.x + Math.cos(a) * (0.8 + r() * 0.6), z = ROOST.z + Math.sin(a) * (0.6 + r() * 0.5);
    const f = caveFloor(x, z), up = caveRay(x, f + 1, z, 0, 1, 0, 9);
    parts.push(partName(dripstone(x, f + 1 + up + 0.02, z, 0.2 + r() * 0.35, 0.05 + r() * 0.05, true, r), 'stalactite'));
  }
  SOLIDS.slice(0, 7).forEach(([x, z, sr], i) => {
    const f = caveFloor(x, z);
    parts.push(partName(dripstone(x, f - 0.08, z, 0.7 + sr * 3 + (i % 3) * 0.2, sr * 1.15, false, r), 'stalagmite'));
  });
  // little ones scattered by the walls (no colliders: ankle-high)
  for (let i = 0; i < 26; i++) {
    const x = (r() - 0.5) * 20, z = -3 - r() * 17, f = caveFloor(x, z);
    const d = caveSdf(x, f + 0.4, z);
    if (d > -0.15 || d < -1.3 || Math.hypot((x - POOL.x) / POOL.rx, (z - POOL.z) / POOL.rz) < 1.15) continue;
    parts.push(partName(dripstone(x, f - 0.05, z, 0.15 + r() * 0.3, 0.05 + r() * 0.06, false, r), 'stalagmite'));
  }
  const merged = merge(parts.map((p) => clean(p)));
  merged.computeVertexNormals();
  return { geometry: merged, drips };
}

// ------------------------------------------------------------------------------------------------------ crystals

export interface Cluster { x: number; y: number; z: number; nx: number; ny: number; nz: number; size: number; phase: number }

/** cluster anchors: cast from inside the cavern toward the walls (azimuth, elevation, from), sized */
const ANCHORS: readonly [number, number, number, number, number, number][] = [
  // [from x, from z, azimuth (0 = −z, north), elevation, size, from y]
  [-4.3, -11.4, -1.9, 0.05, 1.25, 0.6],   // the pool's west wall (big)
  [-4.3, -11.4, -2.6, 0.15, 0.9, 0.6],
  [-4.3, -11.4, -0.9, 0.0, 0.8, 0.4],
  [-4.3, -11.4, 3.0, 0.1, 0.7, 0.5],
  [-1.6, -12.5, 0.15, 0.25, 0.85, 1.4],  // beside the paintings
  [0.6, -11.0, 0.9, 1.2, 0.75, 1.5],     // the dome
  [0.6, -11.0, -2.2, 1.1, 0.6, 1.5],
  [4.5, -12.0, 0.4, 0.1, 0.95, 0.6],     // north-east, over the chest alcove
  [5.0, -8.0, 1.6, 0.25, 0.7, 0.9],      // the camp bay's east wall
  [0.3, -4.5, 1.5, 0.3, 0.5, 0.9],       // the passage: a first glimpse
  [0.3, -4.5, -1.5, 0.15, 0.45, 0.9],
  [-6.0, -7.4, -1.2, 0.0, 0.7, 0.5],
];

const _g = new THREE.Vector3();
function gradient(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  const e = 0.04;
  return out.set(caveSdf(x + e, y, z) - caveSdf(x - e, y, z), caveSdf(x, y + e, z) - caveSdf(x, y - e, z), caveSdf(x, y, z + e) - caveSdf(x, y, z - e)).normalize();
}

/** The crystal clusters' anchors on the walls (deterministic). */
export function crystalClusters(): Cluster[] {
  return ANCHORS.map(([fx, fz, az, el, size, fy], i) => {
    const f = caveFloor(fx, fz) + fy;
    const dx = Math.sin(az) * Math.cos(el), dy = Math.sin(el), dz = -Math.cos(az) * Math.cos(el);
    const t = caveRay(fx, f, fz, dx, dy, dz, 16);
    const x = fx + dx * t, y = f + dy * t, z = fz + dz * t;
    gradient(x, y, z, _g);
    return { x, y, z, nx: -_g.x, ny: -_g.y, nz: -_g.z, size, phase: (i * 0.618) % 1 };
  });
}

/** Spots where the little glow-caps grow (decorative: the pickable ones are today's, by the log). */
export const GLOW_SPOTS: readonly [number, number, number][] = [[-7.2, -9.4, 0.9], [-6.6, -14.4, 1.0], [-1.8, -9.0, 0.7], [2.2, -16.6, 0.8], [6.9, -14.8, 0.8], [-2.6, -3.6, 0.6], [2.0, -5.0, 0.6], [7.4, -9.9, 0.7]];

/**
 * Every crystal and the decorative glow-caps in one geometry: `cyc` per vertex = the cluster's colour phase (−1 for
 * glow-caps: a fixed sea-green), `tip` = 0 at a prism's root .. 1 at its point (brighter).
 */
export function buildCrystals(clusters: readonly Cluster[]): THREE.BufferGeometry {
  const r = rnd(31);
  const parts: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0), n = new THREE.Vector3(), q = new THREE.Quaternion(), tilt = new THREE.Quaternion(), ax = new THREE.Vector3();
  const tag = (g: THREE.BufferGeometry, cyc: number, tip: (y: number) => number) => {
    const p = g.attributes.position, cy = new Float32Array(p.count), tp = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) { cy[i] = cyc; tp[i] = tip(p.getY(i)); }
    g.setAttribute('cyc', new THREE.BufferAttribute(cy, 1));
    g.setAttribute('tip', new THREE.BufferAttribute(tp, 1));
    return g;
  };
  for (const c of clusters) {
    n.set(c.nx, c.ny, c.nz).normalize();
    const count = 4 + Math.round(c.size * 4);
    for (let i = 0; i < count; i++) {
      const len = c.size * (0.35 + r() * 0.65) * (i === 0 ? 1.25 : 1), rad = c.size * (0.05 + r() * 0.05) * (i === 0 ? 1.3 : 1);
      const body = new THREE.CylinderGeometry(rad, rad * 1.1, len, 6, 1).translate(0, len / 2, 0);
      const tipG = new THREE.ConeGeometry(rad, rad * 2.4, 6, 1).translate(0, len + rad * 1.2, 0);
      const g = mergeGeometries([clean(body, ['position']), clean(tipG, ['position'])])!;
      tag(g, c.phase, (y) => Math.min(1, Math.max(0, y / (len + rad * 2.4))));
      paint(g, 0xffffff);
      // fan out from the wall's normal
      ax.set(r() - 0.5, r() - 0.5, r() - 0.5).cross(n).normalize();
      tilt.setFromAxisAngle(ax, (i === 0 ? 0.1 : 0.25 + r() * 0.55));
      q.setFromUnitVectors(up, n).premultiply(tilt);
      g.applyQuaternion(q);
      const off = c.size * 0.22;
      g.translate(c.x - n.x * 0.12 + (r() - 0.5) * off, c.y - n.y * 0.12 + (r() - 0.5) * off, c.z - n.z * 0.12 + (r() - 0.5) * off);
      parts.push(partName(g, 'crystal'));
    }
  }
  const cap = forageGeometry('glowcap');
  for (const [x, z, s] of GLOW_SPOTS) {
    const f = caveFloor(x, z);
    const g = clean(cap.clone(), ['position', 'normal', 'color']).scale(s * 2.2, s * 2.2, s * 2.2).rotateY(x * 3.1).translate(x, f, z);
    tag(g, -1, (y) => (y - f > 0.12 * s ? 1 : 0.3));
    parts.push(partName(g, 'glowcaps'));
  }
  const keep = ['position', 'normal', 'color', 'cyc', 'tip'];
  const merged = merge(parts.map((p) => { const f = clean(p, keep); f.computeVertexNormals(); return f; }));
  return merged;
}

/** crystal palette the colour cycles through (linear-ish sRGB values; the shader and the CPU agree) */
const CYCLE = [new THREE.Color(0x3ff0d8), new THREE.Color(0x9a6cff), new THREE.Color(0xff6fd0), new THREE.Color(0x58b8ff)];
const CYCLE_GLSL = CYCLE.map((c) => `vec3(${c.r.toFixed(3)}, ${c.g.toFixed(3)}, ${c.b.toFixed(3)})`);
/** seconds per full turn of the colour wheel */
export const CYCLE_SECS = 48;
/** The tint of a cluster with colour phase `phase` at time t (what the shader draws, for its LightEmitter). */
export function crystalTint(phase: number, t: number, out: THREE.Color): THREE.Color {
  const u = (((t / CYCLE_SECS + phase) % 1) + 1) % 1 * CYCLE.length;
  const i = Math.floor(u), k = u - i, s = k * k * (3 - 2 * k);
  return out.copy(CYCLE[i % CYCLE.length]).lerp(CYCLE[(i + 1) % CYCLE.length], s);
}

/** The crystals' material: toon-lit facets with a slow colour-cycling glow, brighter at the tips (blooms). */
export function crystalMaterial(time: { value: number }): THREE.MeshToonMaterial {
  const m = toon(0xd8d4ff, { vertexColors: true, emissive: 0xffffff, emissiveIntensity: 1, shared: false });
  return chainShader(m, (sh) => {
    sh.uniforms.uCrystalT = time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float cyc;\nattribute float tip;\nvarying float vCyc;\nvarying float vTip;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCyc = cyc; vTip = tip;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uCrystalT;
varying float vCyc;
varying float vTip;
vec3 crystalCycle(float ph) {
  float u = fract(uCrystalT / ${CYCLE_SECS.toFixed(1)} + ph) * 4.0;
  float i = floor(u), k = u - i; k = k * k * (3.0 - 2.0 * k);
  vec3 c0 = ${CYCLE_GLSL[0]}, c1 = ${CYCLE_GLSL[1]}, c2 = ${CYCLE_GLSL[2]}, c3 = ${CYCLE_GLSL[3]};
  vec3 a = i < 0.5 ? c0 : i < 1.5 ? c1 : i < 2.5 ? c2 : c3;
  vec3 b = i < 0.5 ? c1 : i < 1.5 ? c2 : i < 2.5 ? c3 : c0;
  return mix(a, b, k);
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec3 tint = vCyc < -0.5 ? vec3(0.32, 0.95, 0.72) : crystalCycle(vCyc);
  float pulse = 0.85 + 0.15 * sin(uCrystalT * 0.9 + vCyc * 17.0);
  diffuseColor.rgb *= mix(vec3(1.0), tint, 0.65);
  totalEmissiveRadiance = tint * (vCyc < -0.5 ? 0.55 + 0.9 * vTip : (0.35 + 1.35 * vTip * vTip) * pulse);
}`);
  }, 'grotto-crystal');
}

// ------------------------------------------------------------------------------------------------------ the pool

export interface PoolUniforms {
  uTime: { value: number };
  uLights: { value: THREE.Vector3[] };
  uLightCols: { value: THREE.Color[] };
  /** drips on the pool: x, z, time of the last impact */
  uRipples: { value: THREE.Vector3[] };
  uDay: { value: number };
}
export const POOL_LIGHTS = 6, POOL_RIPPLES = 4;

/** The pool's surface: an ellipse a little larger than the basin at the water line (the rim hides its edge). */
export function poolGeometry(): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
  g.scale(POOL.rx * 1.18, 1, POOL.rz * 1.18).translate(POOL.x, POOL.water, POOL.z);
  return g;
}

export function poolMaterial(u: PoolUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...u },
    transparent: true, depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uDay;
      uniform vec3 uLights[${POOL_LIGHTS}];
      uniform vec3 uLightCols[${POOL_LIGHTS}];
      uniform vec3 uRipples[${POOL_RIPPLES}];
      varying vec3 vW;
      void main() {
        vec3 n = vec3(0.0, 1.0, 0.0);
        // a breath of movement, and rings spreading from the last drips
        n.xz += 0.012 * vec2(sin(vW.x * 3.1 + uTime * 0.7 + sin(vW.z * 2.3)), cos(vW.z * 2.7 - uTime * 0.6));
        for (int i = 0; i < ${POOL_RIPPLES}; i++) {
          vec3 r = uRipples[i];
          float age = uTime - r.z;
          if (age < 0.0 || age > 3.0) continue;
          vec2 d = vW.xz - r.xy;
          float dist = length(d);
          float front = age * 0.55;
          float w = exp(-pow((dist - front) * 9.0, 2.0)) * (1.0 - age / 3.0);
          n.xz += normalize(d + 1e-4) * sin((dist - front) * 40.0) * w * 0.22;
        }
        n = normalize(n);
        vec3 v = normalize(cameraPosition - vW);
        vec3 rd = reflect(-v, n);
        float fres = 0.25 + 0.75 * pow(1.0 - max(0.0, dot(v, n)), 3.0);
        // the still water: very dark teal, a hint of the cave's own colour mirrored back
        vec3 col = mix(vec3(0.012, 0.03, 0.04), vec3(0.03, 0.05, 0.08), fres);
        // mirrored lights: tight reflections stretched a little along the view, plus a soft halo
        for (int i = 0; i < ${POOL_LIGHTS}; i++) {
          vec3 L = uLights[i] - vW;
          float dl = length(L);
          vec3 ld = L / dl;
          float s = max(0.0, dot(rd, ld));
          float tight = pow(s, 900.0) * 6.0 + pow(s, 140.0) * 1.2;
          float halo = pow(s, 14.0) * 0.18;
          col += uLightCols[i] * (tight + halo) * fres / (0.4 + dl * 0.12);
        }
        // the mouth's daylight, far off at the end of the passage
        float a = mix(0.82, 0.95, fres);
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// ------------------------------------------------------------------------------------------------- cave paintings

/** The north wall's cave paintings, drawn on a canvas: the valley's oldest story. */
export function paintingCanvas(): HTMLCanvasElement | OffscreenCanvas {
  const W = 1024, H = 336;
  const cv: HTMLCanvasElement | OffscreenCanvas = typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: W, height: H }) : new OffscreenCanvas(W, H);
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  const r = rnd(11);
  const OCHRE = '#d08a3a', RED = '#a8432c', WHITE = '#efe2c6', CHAR = '#2a2226', ORANGE = '#e0763a';
  g.clearRect(0, 0, W, H);
  g.lineCap = 'round'; g.lineJoin = 'round';
  // a faint pale wash where the wall was smoothed for painting
  const wash = g.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.55);
  wash.addColorStop(0, 'rgba(235, 220, 190, 0.22)'); wash.addColorStop(1, 'rgba(235, 220, 190, 0)');
  g.fillStyle = wash; g.fillRect(0, 0, W, H);
  const wobble = (pts: [number, number][], w: number, color: string) => {
    g.strokeStyle = color; g.lineWidth = w; g.beginPath();
    pts.forEach(([x, y], i) => { const jx = x + (r() - 0.5) * 2.5, jy = y + (r() - 0.5) * 2.5; if (i) g.lineTo(jx, jy); else g.moveTo(jx, jy); });
    g.stroke();
  };
  const blobFill = (x: number, y: number, w: number, h: number, color: string, round = 10) => {
    g.fillStyle = color; g.beginPath(); g.roundRect(x + (r() - 0.5) * 2, y + (r() - 0.5) * 2, w, h, round); g.fill();
  };
  // the sun (the spark), top left
  g.fillStyle = ORANGE;
  g.beginPath(); g.arc(92, 78, 26, 0, Math.PI * 2); g.fill();
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; wobble([[92 + Math.cos(a) * 34, 78 + Math.sin(a) * 34], [92 + Math.cos(a) * (50 + (i % 2) * 10), 78 + Math.sin(a) * (50 + (i % 2) * 10)]], 6, ORANGE); }
  // the waterfall and the river winding away
  for (let k = 0; k < 4; k++) wobble([[40 + k * 9, 130], [42 + k * 9, 200], [38 + k * 9, 260]], 4, WHITE);
  wobble([[30, 270], [80, 285], [60, 305], [140, 318], [200, 312]], 7, '#7fb8d0');
  // three Clawd farmers, one with a hoe, one with a watering can, one waving
  const clawd = (x: number, y: number, s: number, tool: 'hoe' | 'can' | 'wave') => {
    blobFill(x - 34 * s, y - 30 * s, 68 * s, 44 * s, ORANGE, 12 * s);
    for (const dx of [-24, -8, 8, 24]) wobble([[x + dx * s, y + 14 * s], [x + dx * s, y + 34 * s]], 7 * s, ORANGE);
    for (const sx of [-1, 1]) wobble([[x + sx * 34 * s, y - 10 * s], [x + sx * 46 * s, y - 4 * s]], 8 * s, ORANGE);
    g.fillStyle = CHAR; for (const sx of [-1, 1]) g.fillRect(x + sx * 12 * s - 3 * s, y - 20 * s, 6 * s, 10 * s);
    if (tool === 'hoe') { wobble([[x + 46 * s, y - 4 * s], [x + 62 * s, y - 52 * s]], 5 * s, RED); wobble([[x + 62 * s, y - 52 * s], [x + 76 * s, y - 46 * s]], 6 * s, CHAR); }
    if (tool === 'can') { blobFill(x + 46 * s, y - 14 * s, 26 * s, 20 * s, '#8aa0a8', 4 * s); for (let i = 0; i < 4; i++) wobble([[x + 76 * s + i * 3, y - 6 * s + i * 7], [x + 80 * s + i * 3, y + 4 * s + i * 7]], 2.5, '#7fb8d0'); }
    if (tool === 'wave') wobble([[x - 46 * s, y - 4 * s], [x - 52 * s, y - 26 * s], [x - 46 * s, y - 40 * s]], 7 * s, ORANGE);
  };
  clawd(250, 220, 1.0, 'hoe');
  clawd(372, 236, 0.85, 'can');
  clawd(176, 248, 0.7, 'wave');
  // the windmill
  wobble([[540, 300], [556, 150], [584, 150], [600, 300]], 8, RED);
  blobFill(552, 128, 36, 28, RED, 6);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + 0.4, cx = 570, cy = 140;
    wobble([[cx, cy], [cx + Math.cos(a) * 92, cy + Math.sin(a) * 92]], 6, WHITE);
    g.save(); g.translate(cx, cy); g.rotate(a); g.strokeStyle = WHITE; g.lineWidth = 3; g.strokeRect(30, -10, 58, 20); g.restore();
  }
  // the first field: a fenced rectangle of sprouting rows
  wobble([[680, 200], [960, 200], [960, 300], [680, 300], [680, 200]], 5, CHAR);
  for (let x = 690; x < 960; x += 22) wobble([[x, 196], [x, 206]], 4, CHAR);
  for (let row = 0; row < 4; row++) for (let x = 702; x < 950; x += 26) {
    const y = 222 + row * 22;
    wobble([[x, y + 8], [x, y]], 4, '#6a9a3a');
    wobble([[x, y], [x - 6, y - 6]], 4, '#6a9a3a'); wobble([[x, y], [x + 6, y - 6]], 4, '#6a9a3a');
  }
  // stars and crystals above, hand prints at the edges
  for (let i = 0; i < 14; i++) { const x = 650 + r() * 340, y = 30 + r() * 120; g.fillStyle = WHITE; g.beginPath(); g.arc(x, y, 2 + r() * 3, 0, Math.PI * 2); g.fill(); }
  for (let i = 0; i < 3; i++) { const x = 860 + i * 34, y = 120; g.fillStyle = '#9a7cf0'; g.beginPath(); g.moveTo(x, y - 34); g.lineTo(x + 10, y); g.lineTo(x - 10, y); g.closePath(); g.fill(); }
  const hand = (x: number, y: number, color: string) => {
    g.fillStyle = color; g.globalAlpha = 0.75;
    g.beginPath(); g.ellipse(x, y, 16, 19, 0, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 4; i++) { g.beginPath(); g.ellipse(x - 12 + i * 8, y - 28, 3.5, 11, (i - 1.5) * 0.12, 0, Math.PI * 2); g.fill(); }
    g.beginPath(); g.ellipse(x + 19, y - 4, 4, 10, -0.9, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
  };
  hand(990, 70, RED); hand(470, 70, OCHRE); hand(28, 50, RED);
  // weathering: specks rubbed away
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(0,0,0,${0.15 + r() * 0.5})`; g.fillRect(r() * W, r() * H, 1 + r() * 4, 1 + r() * 3); }
  g.globalCompositeOperation = 'source-over';
  return cv;
}

/** A quad grid hugging the north wall where the paintings are (found by casting at the wall). */
export function paintingGeometry(): THREE.BufferGeometry {
  const NU = 52, NV = 18, from = PAINTING.z + 3.5;   // dense: the wall is lumpy at the shell's resolution
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
    const u = i / NU, v = j / NV;
    const x = PAINTING.x + (u - 0.5) * PAINTING.w, y = caveFloor(PAINTING.x, PAINTING.z) + PAINTING.y + (v - 0.5) * PAINTING.h;
    const t = caveRay(x, y, from, 0, 0, -1, 10);
    pos.push(x, y, from - t + 0.07);
    uv.push(u, v);
  }
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
    const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// --------------------------------------------------------------------------------------------------------- bats

export const BATS = 7;
/** A bat in flight pose: body along +z (head forward), wings spread along x; `wing` = −1..1 (0 on the body). */
export function batGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const fur = 0x3a2f3a, skin = 0x5a4250;
  parts.push(blob([0, 0, 0], [0.045, 0.04, 0.075], { paint: fur, sides: 7, rings: 4 }));
  parts.push(blob([0, 0.012, 0.075], [0.032, 0.03, 0.032], { paint: fur, sides: 7, rings: 3 }));
  for (const s of [-1, 1]) {
    const ear = new THREE.ConeGeometry(0.012, 0.035, 4).translate(0, 0.0175, 0).rotateZ(-s * 0.35).translate(s * 0.016, 0.035, 0.078);
    parts.push(paint(clean(ear, ['position']), skin));
    // the wing: a scalloped membrane, three fingers
    const w = new THREE.BufferGeometry();
    const P = [[0, 0.004, 0.045], [s * 0.1, 0.012, 0.05], [s * 0.2, 0.004, 0.02], [s * 0.15, 0, -0.03], [s * 0.24, -0.002, -0.05], [s * 0.1, 0, -0.07], [0, 0, -0.06]];
    const tri = [[0, 1, 6], [1, 2, 3], [1, 3, 6], [3, 4, 5], [3, 5, 6]];
    const arr: number[] = [];
    for (const t of tri) for (const k of t) arr.push(...P[k]);
    // both faces (the material is single-sided)
    for (const t of tri) for (const k of [...t].reverse()) arr.push(...P[k]);
    w.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    w.computeVertexNormals();
    parts.push(paint(w, skin));
  }
  const g = mergeGeometries(parts.map((p) => clean(p)))!;
  const p = g.attributes.position, wing = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) { const x = p.getX(i); wing[i] = Math.abs(x) > 0.03 ? Math.sign(x) * Math.min(1, Math.abs(x) / 0.24) : 0; }
  g.setAttribute('wing', new THREE.BufferAttribute(wing, 1));
  g.computeBoundingSphere();
  return g;
}

/** Bats' material: toon, wings fold round the body (roosting) or beat (`state.x` = flight 0..1, `state.y` = phase). */
export function batMaterial(time: { value: number }): THREE.MeshToonMaterial {
  const m = toon(0xffffff, { vertexColors: true, shared: false });
  return chainShader(m, (sh) => {
    sh.uniforms.uBatT = time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float wing;\nattribute vec2 batState;\nuniform float uBatT;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
if (wing != 0.0) {
  float s = sign(wing);
  float beat = sin(uBatT * 17.0 + batState.y * 6.283) * 0.95 + 0.15;
  float fold = -1.75;
  float ang = mix(fold, beat, batState.x) * s * min(1.0, abs(wing) * 1.6);
  float c = cos(ang), sn = sin(ang);
  transformed.xy = vec2(transformed.x * c - transformed.y * sn, transformed.x * sn + transformed.y * c);
  // folded: tuck the membrane in round the body
  transformed.x *= mix(0.55, 1.0, batState.x);
}`);
  }, 'grotto-bat');
}

// --------------------------------------------------------------------------------------------------------- drips

/** One point per drip: (x, tip y, z) + (floor y, period s, phase). The fall happens in the last ~20% of a period. */
export function dripGeometry(drips: Shell['drips']): THREE.BufferGeometry {
  const pos = new Float32Array(drips.length * 3), dat = new Float32Array(drips.length * 3);
  drips.forEach((d, i) => {
    pos.set([d.x, d.y, d.z], i * 3);
    dat.set([d.floor, 2.6 + (i * 1.37) % 3.4, (i * 0.381) % 1], i * 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('drip', new THREE.BufferAttribute(dat, 3));
  g.computeBoundingSphere();
  if (g.boundingSphere) g.boundingSphere.radius += 6;
  return g;
}
/** the fall's share of a drip's period, and its fraction at impact (shared with the room's sounds and ripples) */
export const DRIP_FALL = 0.2;
export function dripMaterial(time: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: time, uScale: { value: 420 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec3 drip; uniform float uTime, uScale; varying float vA;
      void main() {
        float k = fract(uTime / drip.y + drip.z);
        float fall = clamp((k - ${(1 - DRIP_FALL).toFixed(2)}) / ${DRIP_FALL.toFixed(2)}, 0.0, 1.0);
        vec3 p = position;
        p.y = mix(position.y, drip.x, fall * fall);
        // swelling at the tip, then falling; gone at the bottom
        vA = fall > 0.0 ? (fall < 0.98 ? 1.0 : 0.0) : smoothstep(0.3, 0.8, k) * 0.7;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uScale * (fall > 0.0 ? 0.03 : 0.02 + 0.015 * smoothstep(0.3, 0.8, k)) / max(0.5, -mv.z);
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() { vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.15, length(c * vec2(1.6, 1.0))) * vA; gl_FragColor = vec4(vec3(0.75, 0.95, 1.0) * a * 0.9, a); }`,
  });
}

// ---------------------------------------------------------------------------------------------- the mouth inside

/** The waterfall seen from inside the cave: a curtain of backlit water across the open end of the passage. */
export function curtainGeometry(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(3.6, 3.8, 6, 6).translate(0, 1.6, SHELL_END - 0.08);
  // bow it out a little at the middle (the water arcs away from the rock)
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) - Math.cos(p.getX(i) / 1.8 * Math.PI * 0.5) * 0.25);
  g.rotateY(Math.PI).translate(0, 0, 2 * (SHELL_END - 0.08));
  g.computeVertexNormals();
  return g;
}
export function curtainMaterial(u: { uTime: { value: number }; uDay: { value: number }; uSky: { value: THREE.Color } }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...u },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uDay; uniform vec3 uSky; varying vec2 vUv;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        float u = vUv.x, v = vUv.y, t = uTime;
        float streak = n(vec2(u * 18.0, v * 1.2 + t * 1.6));
        float fine = n(vec2(u * 46.0, v * 3.0 + t * 2.8));
        float sheet = 0.55 + 0.45 * streak + 0.25 * fine;
        // daylight through water: bright blue-white by day, a dim moonlit blue at night
        vec3 day = mix(uSky, vec3(0.92, 0.98, 1.0), 0.55) * 1.55;
        vec3 night = vec3(0.08, 0.12, 0.2);
        vec3 col = mix(night, day, uDay) * sheet;
        col += vec3(1.0) * step(0.83, streak * 0.7 + fine * 0.4) * (0.25 + 0.6 * uDay);
        // brighter where it thins near the middle, foamy at the bottom
        col *= 0.8 + 0.35 * (1.0 - abs(u - 0.5) * 2.0);
        col = mix(col, vec3(0.9, 0.95, 1.0) * (0.25 + 0.9 * uDay), smoothstep(0.12, 0.0, v) * 0.7);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** Light shafts from the mouth slanting down into the passage (additive, soft-edged sheets along the light). */
export function shaftGeometry(): THREE.BufferGeometry {
  const r = rnd(5);
  const pos: number[] = [], uv: number[] = [];
  for (let i = 0; i < 5; i++) {
    const x = -0.8 + i * 0.4 + (r() - 0.5) * 0.15, y0 = 1.3 + r() * 0.9, w = 0.5 + r() * 0.5, len = 4.5 + r() * 2.5;
    const dy = -(0.22 + r() * 0.12), roll = (r() - 0.5) * 1.4;
    // a sheet across (cos roll, sin roll) in the x-y plane, running from the mouth along (0, dy, -1)
    const ax = Math.sin(roll) * w / 2, ay = Math.cos(roll) * w / 2, z0 = SHELL_END - 0.1;
    const P = [[x - ax, y0 - ay, z0], [x + ax, y0 + ay, z0], [x + ax, y0 + ay + dy * len, z0 - len], [x - ax, y0 - ay + dy * len, z0 - len]];
    const U = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(...P[k]); uv.push(...U[k]); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  return g;
}
export function shaftMaterial(u: { uTime: { value: number }; uDay: { value: number } }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...u },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, forceSinglePass: true,
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uDay; varying vec2 vUv;
      void main() {
        float edge = smoothstep(0.0, 0.5, vUv.x) * smoothstep(1.0, 0.5, vUv.x);
        float along = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
        float flick = 0.75 + 0.25 * sin(uTime * 1.7 + vUv.y * 9.0);
        float a = edge * along * flick * (0.05 + 0.13 * uDay);
        gl_FragColor = vec4(vec3(0.8, 0.92, 1.0) * a, a);
      }`,
  });
}

/** Spray and dust drifting in the mouth's light (one point draw, animated on the GPU). */
export function motesGeometry(n = 60): THREE.BufferGeometry {
  const r = rnd(9), pos = new Float32Array(n * 3), seed = new Float32Array(n);
  for (let i = 0; i < n; i++) { pos.set([(r() - 0.5) * 2.4, 0.2 + r() * 2.4, SHELL_END - r() * 5.5], i * 3); seed[i] = r(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  g.computeBoundingSphere();
  return g;
}
export function motesMaterial(u: { uTime: { value: number }; uDay: { value: number } }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...u, uScale: { value: 300 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float seed; uniform float uTime, uScale; varying float vA;
      void main() {
        vec3 p = position;
        float t = uTime * (0.08 + seed * 0.1) + seed * 40.0;
        p.x += sin(t * 1.3) * 0.3; p.y += sin(t * 0.9 + seed * 3.0) * 0.25; p.z -= fract(t * 0.05) * 1.5;
        vA = (0.4 + 0.6 * sin(uTime * (1.5 + seed * 2.0) + seed * 20.0)) * smoothstep(-6.0, -1.0, p.z);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uScale * (0.012 + seed * 0.01) / max(0.4, -mv.z);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uDay; varying float vA;
      void main() { float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5)) * vA * (0.15 + 0.6 * uDay); gl_FragColor = vec4(vec3(0.85, 0.95, 1.0) * a, a); }`,
  });
}

// ------------------------------------------------------------------------------------------------------ the camp

/** the lantern on the crate: its glass, and where its light sits (room-local) */
export const LANTERN = Object.freeze({ x: CAMP.crate.x + 0.18, y: caveFloor(CAMP.crate.x, CAMP.crate.z) + CRATE_H + 0.17, z: CAMP.crate.z - 0.05 });
/** the journal on the crate */
export const JOURNAL_AT = Object.freeze({ x: CAMP.crate.x - 0.14, y: caveFloor(CAMP.crate.x, CAMP.crate.z) + CRATE_H + 0.03, z: CAMP.crate.z + 0.06 });

/** The explorer's camp (bedroll, crate with the journal, cold fire ring, pack, rope, pick) and the chest's body. */
export function buildCamp(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const r = rnd(23);
  const F = (x: number, z: number) => caveFloor(x, z);
  const S = (g: THREE.BufferGeometry, s: string, o?: Parameters<typeof tagSurface>[2]) => tagSurface(g, s as never, o);
  // the crate, the journal, the lantern's frame
  {
    const c = CAMP.crate, y = F(c.x, c.z);
    const box = S(prim(new THREE.BoxGeometry(0.7, CRATE_H, 0.5), PAL.plank), 'planks', { axis: 'x' });
    parts.push(partName(put(box.translate(0, CRATE_H / 2, 0), c.x, y, c.z, c.yaw), 'crate'));
    for (const sx of [-1, 1]) parts.push(partName(put(prim(new THREE.BoxGeometry(0.06, CRATE_H + 0.01, 0.52), PAL.woodDark).translate(sx * 0.32, CRATE_H / 2, 0), c.x, y, c.z, c.yaw), 'crate'));
    // the journal, open: two pages on a leather cover
    const j = JOURNAL_AT;
    const cover = prim(new THREE.BoxGeometry(0.34, 0.02, 0.24), 0x7a3f2a).translate(0, 0.01, 0);
    const pageL = prim(new THREE.BoxGeometry(0.155, 0.018, 0.22), 0xf2e6c8).rotateZ(0.06).translate(-0.08, 0.026, 0);
    const pageR = prim(new THREE.BoxGeometry(0.155, 0.018, 0.22), 0xf6ecd2).rotateZ(-0.06).translate(0.08, 0.026, 0);
    const lines: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) for (const sx of [-1, 1]) lines.push(prim(new THREE.BoxGeometry(0.11, 0.003, 0.006), 0x6a5a4a).translate(sx * 0.08, 0.037 + (sx > 0 ? -0.004 : 0.004), -0.08 + i * 0.03));
    for (const p of [cover, pageL, pageR, ...lines]) parts.push(partName(p.rotateY(c.yaw).translate(j.x, j.y - 0.02, j.z), 'journal'));
    const L = LANTERN;
    const frame: THREE.BufferGeometry[] = [
      prim(new THREE.CylinderGeometry(0.09, 0.1, 0.03, 8), PAL.metalDark).translate(0, 0.015, 0),
      prim(new THREE.CylinderGeometry(0.05, 0.09, 0.06, 8), PAL.metalDark).translate(0, 0.27, 0),
      prim(new THREE.TorusGeometry(0.06, 0.008, 4, 10, Math.PI), PAL.metalDark).translate(0, 0.31, 0),
    ];
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) frame.push(prim(new THREE.BoxGeometry(0.012, 0.24, 0.012), PAL.metalDark).translate(x * 0.062, 0.14, z * 0.062));
    for (const p of frame) parts.push(partName(p.translate(L.x, L.y - 0.17, L.z), 'lantern'));
    // a tin mug beside it
    parts.push(partName(prim(new THREE.CylinderGeometry(0.04, 0.035, 0.08, 8), 0x8a98a0).translate(c.x - 0.2, y + CRATE_H + 0.04, c.z - 0.15), 'mug'));
  }
  // the bedroll: a blanket on a sleeping mat, a rolled pillow
  {
    const b = CAMP.bedroll, y = F(b.x, b.z);
    const mat = loft([{ p: [0, 0.03, -0.95], r: [0.38, 0.03] }, { p: [0, 0.035, 0], r: [0.4, 0.035] }, { p: [0, 0.03, 0.95], r: [0.38, 0.03] }], { sides: 8, sub: 1, caps: ['flat', 'flat'], paint: 0x5a6a48 });
    const blanket = loft([{ p: [0.02, 0.08, -0.7], r: [0.36, 0.04] }, { p: [0.04, 0.1, -0.1], r: [0.37, 0.07] }, { p: [0.03, 0.09, 0.45], r: [0.36, 0.06] }, { p: [0.0, 0.07, 0.62], r: [0.35, 0.03] }],
      { sides: 10, sub: 2, caps: ['flat', 'flat'], paint: (f) => ((Math.floor(f.t * 9) + Math.floor((f.a / Math.PI) * 4)) % 2 ? 0xb8483a : 0xd8b08a) });
    const pillow = loft([{ p: [-0.3, 0.1, 0.78], r: 0.08 }, { p: [0, 0.11, 0.8], r: 0.1 }, { p: [0.3, 0.1, 0.78], r: 0.08 }], { sides: 8, sub: 2, caps: ['flat', 'flat'], paint: 0xe8dcc4 });
    for (const [p, n] of [[mat, 'bedroll'], [blanket, 'bedroll'], [pillow, 'bedroll']] as const) parts.push(partName(put(p, b.x, y, b.z, b.yaw), n));
  }
  // the cold fire ring: stones, charred logs, a little pot
  {
    const f = CAMP.fire, y = F(f.x, f.z);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + r() * 0.2;
      parts.push(partName(S(blob([f.x + Math.cos(a) * 0.36, y + 0.04, f.z + Math.sin(a) * 0.36], [0.09 + r() * 0.03, 0.07, 0.08 + r() * 0.03], { paint: (ff) => (ff.ny > 0.4 ? 0x8a8478 : 0x6a6458), sides: 7, rings: 3 }), 'rock'), 'firering'));
    }
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1 + 0.4;
      parts.push(partName(loft([{ p: [f.x + Math.cos(a) * 0.22, y + 0.05, f.z + Math.sin(a) * 0.22], r: 0.04 }, { p: [f.x - Math.cos(a) * 0.12, y + 0.09, f.z - Math.sin(a) * 0.12], r: 0.035 }], { sides: 6, sub: 1, caps: ['flat', 'flat'], paint: (ff) => (ff.t > 0.6 ? 0x1e1a1a : 0x3a2a22) }), 'logs'));
    }
    parts.push(partName(prim(new THREE.CylinderGeometry(0.11, 0.09, 0.12, 9), 0x4a4a52).translate(f.x + 0.42, y + 0.06 + 0.02, f.z + 0.28), 'pot'));
  }
  // the pack, a coil of rope, the pick leaning on the wall
  {
    const p = CAMP.pack, y = F(p.x, p.z);
    parts.push(partName(put(blob([0, 0.24, 0], [0.2, 0.25, 0.14], { paint: (f) => (f.ny > 0.7 ? 0x6a7a3e : 0x5a6a34), sides: 9, rings: 5 }), p.x, y, p.z, p.yaw), 'pack'));
    parts.push(partName(put(blob([0, 0.38, 0.08], [0.17, 0.08, 0.1], { paint: 0x4e5c2c, sides: 8, rings: 3 }), p.x, y, p.z, p.yaw), 'pack'));
    parts.push(partName(put(prim(new THREE.CylinderGeometry(0.07, 0.07, 0.36, 8), 0xc8b88a).rotateZ(Math.PI / 2).translate(0, 0.5, -0.04), p.x, y, p.z, p.yaw), 'pack'));
    parts.push(partName(prim(new THREE.TorusGeometry(0.16, 0.035, 5, 14), 0xc8a868).rotateX(Math.PI / 2).translate(p.x + 0.45, y + 0.035, p.z + 0.3), 'rope'));
    parts.push(partName(prim(new THREE.TorusGeometry(0.12, 0.033, 5, 12), 0xb89858).rotateX(Math.PI / 2).translate(p.x + 0.47, y + 0.09, p.z + 0.3), 'rope'));
    const k = CAMP.pick, ky = F(k.x, k.z);
    const handle = prim(new THREE.CylinderGeometry(0.025, 0.03, 0.95, 6), PAL.wood).translate(0, 0.47, 0);
    const head = prim(new THREE.BoxGeometry(0.42, 0.05, 0.05), PAL.metalDark).translate(0, 0.93, 0);
    for (const g of [handle, head]) parts.push(partName(put(g.rotateZ(0.32), k.x, ky, k.z, k.yaw), 'pick'));
  }
  // the mossy log where today's glow-caps grow
  {
    const gc = GLOWCAP, y = F(gc.x, gc.z);
    const log = S(loft([{ p: [-0.55, 0.12, 0], r: 0.13 }, { p: [0, 0.14, 0.02], r: 0.15 }, { p: [0.55, 0.12, -0.02], r: 0.12 }], { sides: 9, sub: 2, caps: ['flat', 'flat'], paint: (f) => (f.ny > 0.45 ? 0x4f7a3e : 0x5e4632) }), 'bark');
    parts.push(partName(put(log, gc.x, y, gc.z, gc.yaw), 'log'));
  }
  // the chest's body: planks, iron bands, the lock plate (the lid is its own mesh: `buildChestLid`)
  {
    const c = CHEST, y = F(c.x, c.z);
    const body = S(prim(new THREE.BoxGeometry(0.8, 0.42, 0.5), 0x8a5a32), 'planks', { axis: 'x' }).translate(0, 0.21, 0);
    const bands: THREE.BufferGeometry[] = [body];
    for (const sx of [-0.28, 0.28]) bands.push(prim(new THREE.BoxGeometry(0.06, 0.43, 0.52), 0x4a4a52).translate(sx, 0.215, 0));
    bands.push(prim(new THREE.BoxGeometry(0.1, 0.12, 0.02), 0xc8a040).translate(0, 0.32, 0.26));
    for (const g of bands) parts.push(partName(put(g, c.x, y, c.z, c.yaw), 'chest'));
    // a scatter of old coins and a candle stub beside it
    for (let i = 0; i < 5; i++) parts.push(partName(prim(new THREE.CylinderGeometry(0.03, 0.03, 0.008, 8), 0xd8b040).translate(c.x + 0.5 + r() * 0.2, y + 0.004 + i * 0.008, c.z + 0.2 + r() * 0.1), 'coins'));
  }
  return merge(parts.map((p) => { const f = clean(ensureSurface(p), ['position', 'normal', 'color', 'surface']); return f; }));
}

/** The chest's lid: pivots about its back edge (local origin), so opening is a rotation about x. */
export function buildChestLid(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const top = loft([{ p: [-0.41, 0, 0.0], r: [0.04, 0.0] }, { p: [-0.4, 0, 0.0], r: [0.26, 0.1] }, { p: [0.4, 0, 0.0], r: [0.26, 0.1] }, { p: [0.41, 0, 0.0], r: [0.04, 0.0] }],
    { sides: 8, sub: 1, caps: ['flat', 'flat'], paint: (f) => (f.ny > 0.3 ? 0x9a6a3a : 0x7a4a2a) });
  // the loft runs along x: turn it into a half-barrel above the pivot (back edge at z = 0)
  top.translate(0, 0, 0.25);
  const p = top.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, Math.max(0, p.getY(i)));
  parts.push(partName(top, 'lid'));
  for (const sx of [-0.28, 0.28]) parts.push(partName(prim(new THREE.BoxGeometry(0.06, 0.12, 0.53), 0x4a4a52).translate(sx, 0.05, 0.25), 'lid'));
  parts.push(partName(prim(new THREE.BoxGeometry(0.1, 0.08, 0.03), 0xc8a040).translate(0, 0.0, 0.52), 'lid'));
  const g = merge(parts.map((q) => { const f = clean(q); f.computeVertexNormals(); return f; }));
  return g;
}

/** The lantern's glass (its own unlit, warm mesh). */
export function lanternGlass(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.055, 0.06, 0.2, 8, 2).translate(LANTERN.x, LANTERN.y, LANTERN.z);
  return g;
}

/** today's glow-caps on the log: three clumps (local to the log) */
export function glowcapClumps(): THREE.BufferGeometry {
  const gc = GLOWCAP, y = caveFloor(gc.x, gc.z) + 0.24;
  const cap = forageGeometry('glowcap');
  const parts = [[-0.3, 0.02, 1.25], [0.05, -0.05, 1.5], [0.36, 0.03, 1.1]].map(([dx, dz, s], i) =>
    partName(clean(cap.clone()).scale(s, s, s).rotateY(i * 2.1).translate(dx, 0, dz).rotateY(gc.yaw).translate(gc.x, y - (i === 1 ? 0.02 : 0.04), gc.z), 'glowcap'));
  return merge(parts);
}
export const GLOWCAP_TOP = Object.freeze({ x: GLOWCAP.x, y: caveFloor(GLOWCAP.x, GLOWCAP.z) + 0.38, z: GLOWCAP.z });

/** The blind cave fish (instanced in the pool). */
export const FISH_N = 3;
export const fishGeometry = (): THREE.BufferGeometry => catchGeometry('cavefish');

/** The shell's material: the surface library's rock over the vertex colours. */
export const shellMaterial = (): THREE.MeshToonMaterial => surfaceMaterial({ vertexColors: true, surface: 'rock', shared: false });
export const propsMaterial = (): THREE.MeshToonMaterial => surfaceMaterial({ vertexColors: true, shared: false });
export { SURF };
