/** Shore plants: lily pads (+ flowers) on the pond and calm river bends, reeds and cattails along the banks. */
import * as THREE from 'three';
import { seeded } from '../../../core/rng.ts';
import type { Season } from '../../model/types.ts';
import { POND, RIVER_HALF_WIDTH, WORLD, heightAt, pathAt, structure } from '../../world/map.ts';
import { facet, paint, toon } from '../toon.ts';
import { SURF, tagSurface, withSurfaces } from '../surface/index.ts';
import { blade, gradient, merge } from '../flora/geom.ts';
import { sway } from '../flora/wind.ts';
import { riverAt } from './features.ts';

const col = (h: number) => new THREE.Color(h);

const reedCols = (season: Season): [THREE.Color, THREE.Color] =>
  season === 'autumn' ? [col(0x7d7a3a), col(0xd2a456)] : season === 'winter' ? [col(0x8f8163), col(0xd9c9a0)]
    : season === 'spring' ? [col(0x3f7d3a), col(0x9fd46a)] : [col(0x3c7437), col(0x8cc15a)];

export function reedGeometry(season: Season, seed = 1): THREE.BufferGeometry {
  const r = seeded(`reed:${seed}`);
  const parts: THREE.BufferGeometry[] = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.6;
    const b = blade(0.9 + r() * 0.8, 0.09, 0.15 + r() * 0.3, a);
    b.translate(Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08);
    parts.push(b);
  }
  const [lo, hi] = reedCols(season);
  return merge(parts.map((p) => tagSurface(gradient(p, lo, hi, 0, 1.4), SURF.plant)));
}

export function cattailGeometry(season: Season, seed = 2): THREE.BufferGeometry {
  const r = seeded(`cattail:${seed}`);
  const [lo, hi] = reedCols(season);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) { const a = r() * 6.28; parts.push(tagSurface(gradient(blade(0.8 + r() * 0.5, 0.1, 0.25, a), lo, hi, 0, 1.2), SURF.plant)); }
  const head = season === 'winter' ? col(0x9a7a58) : col(0x7a4a2a), headLo = season === 'winter' ? col(0x6a5040) : col(0x4a2a18);
  const spike = season === 'winter' ? col(0xa89a80) : col(0xb89a62);
  for (let i = 0; i < 3; i++) {
    const h = 1.35 + r() * 0.45, ox = (r() - 0.5) * 0.25, oz = (r() - 0.5) * 0.25;
    const stem = new THREE.CylinderGeometry(0.015, 0.02, h, 4).translate(ox, h / 2, oz);
    parts.push(tagSurface(gradient(stem, lo, hi, 0, h), SURF.plant));
    // plump velvet head (slightly tapered ends) with the thin flower spike above it
    const cap = new THREE.CylinderGeometry(0.05, 0.056, 0.28, 8, 2).translate(ox, h - 0.19, oz).toNonIndexed();
    parts.push(tagSurface(gradient(cap, headLo, head, h - 0.33, h - 0.1), SURF.plant, { variant: 1 }));
    parts.push(tagSurface(paint(new THREE.ConeGeometry(0.014, 0.16, 4).translate(ox, h + 0.02, oz).toNonIndexed(), spike), SURF.plant));
    if (season === 'winter') parts.push(paint(new THREE.CylinderGeometry(0.07, 0.06, 0.06, 6).translate(ox, h - 0.03, oz).toNonIndexed(), col(0xf2f6fb)));
  }
  return merge(parts);
}

export function lilyPadGeometry(season: Season): THREE.BufferGeometry {
  // the notch: a wedge cut from the rim to the centre (the shader's veins radiate from it, see surf_plant)
  const pad = new THREE.CircleGeometry(0.5, 16, 0.37, Math.PI * 2 - 0.54).rotateX(-Math.PI / 2);
  // cup the pad slightly so it catches the light
  const p = pad.attributes.position;
  for (let i = 0; i < p.count; i++) { const d = Math.hypot(p.getX(i), p.getZ(i)); p.setY(i, d * d * 0.08); }
  pad.deleteAttribute('uv');
  const g = facet(pad);
  const c = new Float32Array(g.attributes.position.count * 3);
  const a = season === 'autumn' ? col(0x8a9a3a) : col(0x4f9a3f), b = season === 'autumn' ? col(0xb89a45) : col(0x76b84e);
  const t = new THREE.Color();
  const gp = g.attributes.position;
  for (let i = 0; i < gp.count; i++) {
    // lighter heart, deeper green toward the rim
    t.copy(b).lerp(a, Math.min(1, Math.hypot(gp.getX(i), gp.getZ(i)) / 0.5) * 0.7);
    c[i * 3] = t.r; c[i * 3 + 1] = t.g; c[i * 3 + 2] = t.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  tagSurface(g, SURF.plant, { variant: 2, aux: 0.5 });
  g.computeBoundingSphere();
  return g;
}

export function lilyFlowerGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let ring = 0; ring < 2; ring++) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + ring * 0.5;
      const petal = new THREE.ConeGeometry(0.06, 0.2, 3).toNonIndexed();
      petal.rotateZ(-(ring ? 0.5 : 1.0)).translate(0.07 * (ring ? 0.6 : 1), 0.08, 0).rotateY(a);
      paint(petal, ring ? col(0xfbe3ee) : col(0xf29ab8));
      parts.push(petal);
    }
  }
  parts.push(paint(new THREE.IcosahedronGeometry(0.045, 0).translate(0, 0.1, 0), col(0xf6cf3a)));
  return merge(parts);
}

interface Place { x: number; z: number; y: number; s: number; yaw: number }

const dock = structure('dock');
const dockTip = { x: dock.x + Math.sin(dock.yaw) * 2.5, z: dock.z + Math.cos(dock.yaw) * 2.5 };
const nearDock = (x: number, z: number) => Math.hypot(x - dock.x, z - dock.z) < 4.5 || Math.hypot(x - dockTip.x, z - dockTip.z) < 4;
const bridge = structure('bridge');

function placements(): { pads: Place[]; flowers: Place[]; reeds: Place[]; cattails: Place[] } {
  const r = seeded('land:shore');
  const pads: Place[] = [], flowers: Place[] = [], reeds: Place[] = [], cattails: Place[] = [];
  const depthAt = (x: number, z: number) => WORLD.water - heightAt(x, z);
  // pond lily clusters
  for (let c = 0; c < 6; c++) {
    const a = r() * Math.PI * 2, d = POND.r * (0.35 + r() * 0.45);
    const cx = POND.x + Math.cos(a) * d, cz = POND.z + Math.sin(a) * d;
    for (let i = 0; i < 9; i++) {
      const x = cx + (r() - 0.5) * 3.2, z = cz + (r() - 0.5) * 3.2;
      if (depthAt(x, z) < 0.35 || nearDock(x, z) || pads.some((p) => Math.hypot(p.x - x, p.z - z) < 0.75)) continue;
      const s = 0.7 + r() * 0.7;
      pads.push({ x, z, y: WORLD.water + 0.02 + r() * 0.01, s, yaw: r() * 6.28 });
      if (r() < 0.22) flowers.push({ x: x + 0.1, z: z - 0.05, y: WORLD.water + 0.03, s: 0.8 + r() * 0.5, yaw: r() * 6.28 });
    }
  }
  // lilies in the slow outer bends of the lower river
  for (let i = 0; i < 26; i++) {
    const t = 0.55 + r() * 0.3, p = riverAt(t), side = r() < 0.5 ? -1 : 1;
    const off = side * (RIVER_HALF_WIDTH - 0.6 - r() * 0.8);
    const x = p.x - p.tz * off, z = p.z + p.tx * off;
    if (depthAt(x, z) < 0.3 || Math.hypot(x - bridge.x, z - bridge.z) < 10) continue;
    pads.push({ x, z, y: WORLD.water + 0.02, s: 0.55 + r() * 0.5, yaw: r() * 6.28 });
  }
  // reeds and cattails: clumps at the waterline
  const shoreClump = (x: number, z: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const px = x + (r() - 0.5) * 2.4, pz = z + (r() - 0.5) * 2.4;
      const dep = depthAt(px, pz);
      if (dep < -0.35 || dep > 0.55 || pathAt(px, pz) > 0.02 || nearDock(px, pz)) continue;
      if (Math.hypot(px - bridge.x, pz - bridge.z) < 10) continue;
      const pl = { x: px, z: pz, y: WORLD.water - dep - 0.05, s: 0.8 + r() * 0.5, yaw: r() * 6.28 };
      (r() < 0.28 ? cattails : reeds).push(pl);
    }
  };
  for (let i = 0; i < 16; i++) {
    const a = r() * Math.PI * 2, d = POND.r + 0.2;
    shoreClump(POND.x + Math.cos(a) * d, POND.z + Math.sin(a) * d, 6);
  }
  for (let i = 0; i < 30; i++) {
    const t = 0.06 + r() * 0.82, p = riverAt(t), side = r() < 0.5 ? -1 : 1;
    const off = side * (RIVER_HALF_WIDTH + 0.4);
    shoreClump(p.x - p.tz * off, p.z + p.tx * off, 5);
  }
  return { pads, flowers, reeds, cattails };
}

let cached: ReturnType<typeof placements> | null = null;
/** where the shore plants are (scene/seasons: the rowboat nudges through the lily pads) */
export const shorePlaces = (): ReturnType<typeof placements> => (cached ??= placements());

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, list: Place[], name: string): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  m.count = list.length;
  const mx = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  list.forEach((p, i) => { m.setMatrixAt(i, mx.compose(v.set(p.x, p.y, p.z), q.setFromAxisAngle(up, p.yaw), s.setScalar(p.s))); });
  m.instanceMatrix.needsUpdate = true;
  m.computeBoundingSphere();
  m.name = name;
  return m;
}

export interface Shore { group: THREE.Group; update(t: number): void; dispose(): void }

export function buildShore(season: Season): Shore {
  cached ??= placements();
  const P = cached;
  const group = new THREE.Group();
  group.name = 'shore';
  const plantMat = withSurfaces(sway(toon(0xffffff, { vertexColors: true, shared: false, side: THREE.DoubleSide }), { amount: 0.05, fade: 90 }), { surfaces: ['plant'] });
  const meshes: THREE.InstancedMesh[] = [
    instanced(reedGeometry(season), plantMat, P.reeds, 'reeds'),
    instanced(cattailGeometry(season), plantMat, P.cattails, 'cattails'),
  ];
  if (season !== 'winter') {
    const padMat = withSurfaces(toon(0xffffff, { vertexColors: true, shared: false }), { surfaces: ['plant'] });
    meshes.push(instanced(lilyPadGeometry(season), padMat, P.pads, 'lily-pads'));
    if (season !== 'autumn') meshes.push(instanced(lilyFlowerGeometry(), padMat, P.flowers, 'lily-flowers'));
  }
  for (const m of meshes) { m.receiveShadow = true; group.add(m); }
  return {
    group,
    update() {},
    dispose() { for (const m of meshes) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } },
  };
}
