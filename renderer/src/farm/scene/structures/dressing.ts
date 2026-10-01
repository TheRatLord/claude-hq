/**
 * Hub dressing: the paved plaza with its sundial flowerbed, lamp posts along the roads near the hub (lit
 * by real local light), benches, the farmhouse garden and its fence, a laundry line flapping in the wind, and lived-in clutter.
 * Everything static goes into one Kit (baked by the system); the laundry is the only moving part.
 */
import * as THREE from 'three';
import type { Season } from '../../model/types.ts';
import { GARDEN, LAUNDRY, PATHS, SITES, STRUCTURES, WORLD, heightAt, inSite, pathAt, distToPolyline, RIVER, RIVER_HALF_WIDTH, POND } from '../../world/map.ts';
import { PAL } from '../toon.ts';
import { Kit, rng } from './kit.ts';
import { surfaceMaterial } from '../surface/index.ts';
import { bench, lampPost, flowerPot, barrel, crate, hayBale, picnicTable, fenceRun, wateringCan, sack, pumpkin, cart, bucket, flowerColors } from './props.ts';
import type { Env, Rig } from './rig.ts';

export const PLAZA = Object.freeze({ x: 0, z: -1, r: 9.6 });

export interface Dressing {
  root: THREE.Group;
  /** solid footprints for the colliders: circles (x, z, r) and rects (x, z, w, d, yaw) */
  circles: [number, number, number][];
  rects: [number, number, number, number, number][];
  lamps: THREE.Vector3[];
  seats: { x: number; y: number; z: number; yaw: number; kind: string }[];
}

/** distance from (x, z) to the nearest structure footprint (rect, with yaw) */
function structDist(x: number, z: number): number {
  let d = Infinity;
  for (const s of STRUCTURES) {
    const dx = x - s.x, dz = z - s.z, c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
    const qx = Math.abs(lx) - s.size[0] / 2, qz = Math.abs(lz) - s.size[1] / 2;
    d = Math.min(d, Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0));
  }
  return d;
}
/** The nearest spot (spiralling out from x, z) at least r clear of every field and landmark footprint (and of `avoid`). */
function clearSpot(x: number, z: number, r: number, avoid: readonly { x: number; z: number }[] = []): { x: number; z: number } {
  for (let i = 0; i < 200; i++) {
    const a = i * 2.4, d = Math.sqrt(i) * 0.5, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    if (structDist(px, pz) > r && !SITES.some((s) => inSite(s, px, pz, r)) && pathAt(px, pz) < 0.5 && avoid.every((q) => Math.hypot(q.x - px, q.z - pz) > r)) return { x: px, z: pz };
  }
  return { x, z };
}
const wet = (x: number, z: number) => distToPolyline(x, z, RIVER) < RIVER_HALF_WIDTH + 2.5 || Math.hypot(x - POND.x, z - POND.z) < POND.r + 2.5 || heightAt(x, z) < WORLD.water + 0.3;

/** `blocked`: ground other systems already use (flora's trunks and bushes): lamp posts keep out of it. */
export function buildDressing(season: Season, seed = 1, blocked: (x: number, z: number, r: number) => boolean = () => false): Dressing {
  const root = new THREE.Group();
  root.name = 'hub-dressing';
  const k = new Kit(seed * 7 + 201);
  const r = rng(seed * 3 + 9);
  const gy = (x: number, z: number) => heightAt(x, z);
  const circles: Dressing['circles'] = [], rects: Dressing['rects'] = [], lamps: THREE.Vector3[] = [], seats: Dressing['seats'] = [];
  const fl = flowerColors(season);

  // ---- plaza pavers: concentric rings of chunky flagstones + a darker border ----
  const P = PLAZA;
  const keepOut: [number, number, number][] = [[5, 4, 1.7], [7, 6, 0.6]];
  const stoneCols = [0xc9bfae, 0xb9ae9b, 0xd6cdbd, 0xa89f8e, 0xc2b49c];
  for (let ring = 0; ring < 16; ring++) {
    const rr = 1.9 + ring * 0.52;
    if (rr > P.r) break;
    const n = Math.floor((2 * Math.PI * rr) / 0.56);
    const off = r() * Math.PI;
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * Math.PI * 2;
      const x = P.x + Math.sin(a) * rr, z = P.z + Math.cos(a) * rr;
      if (keepOut.some(([kx, kz, kr]) => Math.hypot(x - kx, z - kz) < kr)) continue;
      const border = rr + 0.52 > P.r;
      k.part('paver', () => k.surf(['rock', { scale: 0.5 }], () => k.box(0.5 + r() * 0.06, 0.06, 0.44, border ? 0x8f887c : stoneCols[Math.floor(r() * stoneCols.length)], { x, y: gy(x, z) + 0.015 + r() * 0.02, z, ry: a + (r() - 0.5) * 0.12, rx: (r() - 0.5) * 0.05, rz: (r() - 0.5) * 0.05 })));
    }
  }
  // spokes of darker stones toward the four exits
  for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) for (let rr = 2.1; rr < P.r - 0.3; rr += 0.52) {
    const x = P.x + Math.sin(a) * rr, z = P.z + Math.cos(a) * rr;
    k.part('paver', () => k.surf(['rock', { scale: 0.5 }], () => k.box(0.46, 0.09, 0.4, 0x9a8f7c, { x, y: gy(x, z) + 0.025, z, ry: a })));
  }
  // ---- central flowerbed with a sundial ----
  k.part('sundial', () => {
    const cx = P.x, cz = P.z, y = gy(cx, cz);
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; k.box(0.62, 0.32, 0.3, i % 2 ? PAL.stone : 0xa9a294, { x: cx + Math.sin(a) * 1.45, y: y + 0.16, z: cz + Math.cos(a) * 1.45, ry: a }); }
    k.cyl(1.35, 0.3, PAL.soil, { x: cx, y: y + 0.15, z: cz }, 12);
    for (let i = 0; i < 22; i++) {
      const a = r() * Math.PI * 2, d = 0.55 + r() * 0.7, x = cx + Math.sin(a) * d, z = cz + Math.cos(a) * d;
      if (season === 'winter') { k.cone(0.12, 0.3, PAL.pine, { x, y: y + 0.42, z }, 5); continue; }
      k.ball(0.14, r() < 0.5 ? PAL.leaf : PAL.leafDark, { x, y: y + 0.36, z });
      k.ball(0.09, fl[i % fl.length], { x, y: y + 0.5, z });
    }
    k.cyl(0.28, 0.7, PAL.stone, { x: cx, y: y + 0.5, z: cz }, 8, 0.2);
    k.cyl(0.42, 0.08, 0xd9a93a, { x: cx, y: y + 0.88, z: cz }, 12);
    k.prism([[0, 0], [0.34, 0], [0, 0.28]], 0.03, 0x8a6a2a, { x: cx - 0.17, y: y + 0.92, z: cz, ry: 0 });
    circles.push([cx, cz, 1.7]);
  });

  // ---- lamp posts: plaza ring + along the roads near the hub ----
  const lampAt = (x: number, z: number) => {
    const y = gy(x, z);
    lampPost(k, { x, y, z, ry: r() * Math.PI * 2 });
    lamps.push(new THREE.Vector3(x, y, z));
    circles.push([x, z, 0.22]);
  };
  // four lamps around the plaza ring, nudged along the ring until clear of landmarks and paths
  for (const a0 of [Math.PI * 0.25, Math.PI * 0.75, -Math.PI * 0.25, -Math.PI * 0.75]) {
    for (let k2 = 0; k2 < 24; k2++) {
      const a = a0 + (k2 % 2 ? 1 : -1) * Math.ceil(k2 / 2) * 0.06;
      const x = P.x + Math.sin(a) * (P.r + 0.5), z = P.z + Math.cos(a) * (P.r + 0.5);
      if (structDist(x, z) > 2.2 && pathAt(x, z) < 0.9 && !blocked(x, z, 0.3)) { lampAt(x, z); break; }
    }
  }
  const okLamp = (x: number, z: number) => structDist(x, z) > 1.8 && !SITES.some((s) => inSite(s, x, z, 1.2)) && !wet(x, z) && pathAt(x, z) < 0.35 && !blocked(x, z, 0.3)
    && lamps.every((l) => Math.hypot(l.x - x, l.z - z) > 9) && Math.hypot(x - P.x, z - P.z) > P.r + 1;
  let side = 1;
  for (const p of PATHS) {
    let acc = 6;
    for (let i = 0; i < p.points.length - 1; i++) {
      const a = p.points[i], b = p.points[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
      for (let t = 0; t < L; t += 1) {
        acc += 1;
        const x = a.x + (dx * t) / L, z = a.z + (dz * t) / L;
        if (Math.hypot(x, z + 2) > 52 || acc < 14) continue;
        const nx = -dz / L, nz = dx / L, off = p.width / 2 + 0.8;
        const lx = x + nx * off * side, lz = z + nz * off * side;
        if (okLamp(lx, lz)) { lampAt(lx, lz); acc = 0; side = -side; }
      }
    }
    if (lamps.length > 26) break;
  }

  // ---- benches around the plaza (facing its centre) ----
  const benchAt = (x: number, z: number, yaw: number, w = 1.8) => {
    const y = gy(x, z);
    bench(k, { x, y, z, ry: yaw }, w);
    rects.push([x - Math.sin(yaw) * 0.05, z - Math.cos(yaw) * 0.05, w, 0.6, yaw]);
    seats.push({ x: x + Math.sin(yaw) * 0.15, y: y + 0.48, z: z + Math.cos(yaw) * 0.15, yaw, kind: 'bench' });
  };
  for (const a0 of [0.55, -0.62, 2.35, -2.2]) {
    for (let k2 = 0; k2 < 24; k2++) {
      const a = a0 + (k2 % 2 ? 1 : -1) * Math.ceil(k2 / 2) * 0.05;
      const x = P.x + Math.sin(a) * (P.r + 0.9), z = P.z + Math.cos(a) * (P.r + 0.9);
      if (structDist(x, z) < 2.4 || lamps.some((l) => Math.hypot(l.x - x, l.z - z) < 1.8)) continue;
      benchAt(x, z, Math.atan2(P.x - x, P.z - z));
      break;
    }
  }
  // flowers + planters at the plaza ring
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const x = P.x + Math.sin(a) * (P.r + 0.35), z = P.z + Math.cos(a) * (P.r + 0.35);
    if (pathAt(x, z) > 0.8 && i % 2) continue;
    if (lamps.some((l) => Math.hypot(l.x - x, l.z - z) < 1.2)) continue;
    flowerPot(k, { x, y: gy(x, z), z }, season, i, i % 3 === 0);
  }

  // ---- picnic table (south-west of the plaza) ----
  { const x = -8.2, z = 8.6, y = gy(x, z); picnicTable(k, { x, y, z, ry: 0.35 }); rects.push([x, z, 1.9, 2.0, 0.35]); seats.push({ x: x + Math.cos(0.35) * 0.72, y: y + 0.46, z: z - Math.sin(0.35) * 0.72, yaw: -Math.PI / 2 + 0.35, kind: 'picnic' }); }

  // ---- by the shipping bin: barrels, crates, hay ----
  barrel(k, { x: -10.2, y: gy(-10.2, -10.8), z: -10.8 });
  barrel(k, { x: -10.9, y: gy(-10.9, -11.5), z: -11.5 }, PAL.woodDark);
  crate(k, { x: -10.6, y: gy(-10.6, -9.8), z: -9.8, ry: 0.3 });
  crate(k, { x: -10.6, y: gy(-10.6, -9.8) + 0.6, z: -9.8, ry: 0.6 }, 0.5);
  circles.push([-10.5, -11, 0.9], [-10.6, -9.8, 0.45]);
  hayBale(k, { x: -13.6, y: gy(-13.6, -9.2), z: -9.2, ry: 0.4 });
  hayBale(k, { x: -13.9, y: gy(-13.9, -9.2) + 0.55, z: -9.2, ry: 0.2 });
  rects.push([-13.7, -9.2, 1.2, 0.8, 0.4]);
  if (season === 'autumn') { for (let i = 0; i < 5; i++) pumpkin(k, { x: -13 + i * 0.5, y: gy(-13, -8.2), z: -8.2 + (i % 2) * 0.35 }, 0.2 + (i % 3) * 0.06); }
  // a cart parked by the barn road
  { const { x, z } = clearSpot(-31.5, -13.5, 1.6, lamps); cart(k, { x, y: gy(x, z), z, ry: 0.9 }, season === 'autumn' ? 'pumpkins' : 'crates'); rects.push([x, z, 1.5, 2.4, 0.9]); }

  // ---- farmhouse garden (east of the house) with a picket fence ----
  const G = GARDEN; // levelled with the house by its own terrace (world/map.ts)
  {
    const fenceGy = (x: number, z: number) => gy(x, z);
    const gateX = (G.x0 + G.x1) / 2;
    k.part('gardenFence', () => {
      fenceRun(k, G.x0, G.z1, gateX - 0.6, G.z1, fenceGy);
      fenceRun(k, gateX + 0.6, G.z1, G.x1, G.z1, fenceGy);
      fenceRun(k, G.x1, G.z1, G.x1, G.z0, fenceGy);
      fenceRun(k, G.x1, G.z0, G.x0, G.z0, fenceGy);
      fenceRun(k, G.x0, G.z0, G.x0, G.z1, fenceGy);
    });
    rects.push([(G.x0 + gateX - 0.6) / 2, G.z1, gateX - 0.6 - G.x0, 0.2, 0], [(G.x1 + gateX + 0.6) / 2, G.z1, G.x1 - gateX - 0.6, 0.2, 0]);
    rects.push([G.x1, (G.z0 + G.z1) / 2, 0.2, G.z1 - G.z0, 0], [G.x0, (G.z0 + G.z1) / 2, 0.2, G.z1 - G.z0, 0], [(G.x0 + G.x1) / 2, G.z0, G.x1 - G.x0, 0.2, 0]);
    // raised beds with veg
    for (let b = 0; b < 3; b++) k.part('raisedBed', () => {
      const bz = G.z0 + 1.3 + b * 2.2, bx = (G.x0 + G.x1) / 2;
      // level on a slope: the frame stands on the lowest corner and grows to the highest (no hovering end)
      const cs = [[-1.8, -0.6], [1.8, -0.6], [1.8, 0.6], [-1.8, 0.6], [0, 0]].map(([dx, dz]) => gy(bx + dx, bz + dz));
      const lo = Math.min(...cs), hi = Math.max(...cs), y = hi, fh = 0.3 + (hi - lo) + 0.04;
      k.surf(['planks', { axis: 'h', variant: 1 }], () => k.box(3.6, fh, 1.2, PAL.woodDark, { x: bx, y: y + 0.3 - fh / 2, z: bz }));
      k.box(3.4, 0.05, 1.0, PAL.soil, { x: bx, y: y + 0.31, z: bz });
      for (let i = 0; i < 6; i++) {
        const x = bx - 1.4 + i * 0.56;
        if (season === 'winter') { k.box(0.3, 0.06, 0.3, PAL.snow, { x, y: y + 0.36, z: bz }); continue; }
        if (b === 0) { k.ball(0.2, PAL.cabbage, { x, y: y + 0.45, z: bz, s: [1, 0.8, 1] }, 1); }
        else if (b === 1) { k.cone(0.07, 0.18, PAL.orange, { x, y: y + 0.36, z: bz - 0.2, rx: Math.PI }, 5); k.cone(0.12, 0.35, PAL.leaf, { x, y: y + 0.52, z: bz - 0.2 }, 5); k.cone(0.12, 0.35, PAL.leafDark, { x, y: y + 0.5, z: bz + 0.2 }, 5); }
        else { k.cyl(0.02, 0.9, PAL.woodLight, { x, y: y + 0.75, z: bz }, 4); k.ball(0.16, PAL.leaf, { x, y: y + 0.7, z: bz }); if (season !== 'spring') k.ball(0.07, PAL.red, { x: x + 0.1, y: y + 0.65, z: bz + 0.08 }); }
      }
    });
    wateringCan(k, { x: G.x0 + 0.8, y: gy(G.x0 + 0.8, G.z1 - 0.5), z: G.z1 - 0.5, ry: 1.2 }); // between the last bed and the fence
    sack(k, { x: G.x1 - 0.6, y: gy(G.x1 - 0.6, G.z1 - 0.7), z: G.z1 - 0.7 });
    // bird bath
    k.part('birdBath', () => { const x = G.x1 - 0.65, z = G.z0 + 2.4, y = gy(x, z); /* in the gap between the first two beds */ k.cyl(0.12, 0.8, PAL.stone, { x, y: y + 0.4, z }, 6, 0.08); k.cyl(0.4, 0.12, PAL.stone, { x, y: y + 0.85, z }, 8, 0.45); k.cyl(0.34, 0.02, PAL.water, { x, y: y + 0.91, z }, 8); });
  }

  // ---- laundry line (west yard, between the house and the toolshed) ----
  const LA = LAUNDRY; // kept clear of trees by world/map.ts clearance()
  for (const z of [LA.z0, LA.z1]) k.part('laundryPole', () => {
    const y = gy(LA.x, z);
    k.box(0.14, 2.2, 0.14, PAL.woodDark, { x: LA.x, y: y + 1.1, z });
    k.box(0.14, 0.14, 0.8, PAL.woodDark, { x: LA.x, y: y + 2.1, z });
    circles.push([LA.x, z, 0.2]);
  });
  const lineY = (z: number) => {
    const u = (z - LA.z0) / (LA.z1 - LA.z0);
    return gy(LA.x, LA.z0) + (gy(LA.x, LA.z1) - gy(LA.x, LA.z0)) * u + 2.08 - Math.sin(u * Math.PI) * 0.18;
  };
  k.part('laundryLine', () => { for (let i = 0; i < 12; i++) {
    const za = LA.z0 + ((LA.z1 - LA.z0) * i) / 12, zb = LA.z0 + ((LA.z1 - LA.z0) * (i + 1)) / 12;
    k.beam(LA.x, lineY(za), za, LA.x, lineY(zb), zb, 0.025, PAL.cloth);
  } });
  k.part('basket', () => basket(k, LA.x + 0.8, LA.z0 + 1.2, gy));

  k.build(root);

  // laundry pieces: instanced cloth hanging from the line, rotating about it in the wind
  const CL = [
    { z: 0.6, w: 0.8, h: 1.0, c: 0xf6f1e6 }, { z: 1.6, w: 0.55, h: 0.7, c: 0x5a8fd6 }, { z: 2.3, w: 0.45, h: 0.55, c: 0xe86a5a },
    { z: 3.0, w: 0.9, h: 1.1, c: 0xf2d06a }, { z: 3.9, w: 0.4, h: 0.45, c: 0x8ed06a }, { z: 4.6, w: 0.6, h: 0.75, c: 0xf08aa8 },
  ];
  const clothGeo = new THREE.BoxGeometry(1, 1, 0.03).translate(0, -0.5, 0);
  const laundry = new THREE.InstancedMesh(clothGeo, surfaceMaterial({ surface: 'fabric', surfaces: ['fabric'], scale: 0.5 }), CL.length);
  laundry.castShadow = true;
  const col = new THREE.Color();
  CL.forEach((c, i) => laundry.setColorAt(i, col.setHex(c.c)));
  root.add(laundry);
  const d = new THREE.Object3D();

  // (lamp light: the lamp heads are glow parts, so the Kit registers them as real local lights; see scene/lights)

  const rig: Rig = {
    update(e: Env) {
      const wx = e.wind.x, wz = e.wind.z, ws = Math.hypot(wx, wz);
      for (let i = 0; i < CL.length; i++) {
        const c = CL[i], z = LA.z0 + c.z;
        const flap = Math.sin(e.t * (2.2 + i * 0.3) + i) * (0.06 + ws * 0.05) + Math.sin(e.t * 7 + i * 2) * ws * 0.015;
        d.position.set(LA.x, lineY(z), z);
        // the cloth plane holds the line (along z); it swings about the line, blown by the cross wind (x)
        d.rotation.order = 'YXZ';
        d.rotation.set(-Math.max(-1.0, Math.min(1.0, wx * 0.1 + flap)), Math.PI / 2, Math.sin(e.t * 3.1 + i) * 0.03 + wz * 0.01);
        d.scale.set(c.w, c.h, 1);
        d.updateMatrix();
        laundry.setMatrixAt(i, d.matrix);
      }
      laundry.instanceMatrix.needsUpdate = true;
    },
  };
  root.userData.rig = rig;
  return { root, circles, rects, lamps, seats };
}

function basket(k: Kit, x: number, z: number, gy: (x: number, z: number) => number): void {
  const y = gy(x, z);
  k.cyl(0.3, 0.3, 0xc9a26a, { x, y: y + 0.15, z }, 8, 0.36);
  k.cyl(0.37, 0.04, 0xa8844f, { x, y: y + 0.3, z }, 8);
  k.box(0.5, 0.12, 0.35, PAL.white, { x, y: y + 0.32, z, ry: 0.3 });
  k.box(0.3, 0.1, 0.3, PAL.blue, { x: x + 0.05, y: y + 0.36, z: z + 0.05, ry: 0.9 });
  bucket(k, { x: x + 0.7, y, z: z - 0.3 });
}
