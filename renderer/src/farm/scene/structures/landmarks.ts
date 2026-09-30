/**
 * Gauge landmarks: windmill (CPU), water tower (RAM), silo (disk), barn thermometer (temperature) + barn lantern (GPU).
 * Each carries a live canvas plaque with exact numbers.
 */
import * as THREE from 'three';
import { PAL, toon } from '../toon.ts';
import { Kit, damp, plaque, setGlow, glowMat, clamp01 } from './kit.ts';
import { crate, hayBale, barrel, sack, bucket, cart, pumpkin, flowerPot } from './props.ts';
import type { Env, Levels, Rig } from './rig.ts';
import { pct } from './rig.ts';
import type { BuildOpts } from './farmhouse.ts';
import { windowUnit } from './farmhouse.ts';

const gb = (v: number) => (v >= 100 ? v.toFixed(0) : v.toFixed(1));
const NOSTAT = 'no reading';

// ---------------------------------------------------------------------------------------------
// Windmill — blade speed = CPU

export const WINDMILL = Object.freeze({ hubY: 9.2, hubZ: 2.35, plaque: new THREE.Vector3(1.6, 1.3, 3.6), r0: 2.7, r1: 1.75, h: 8.4 });

export function buildWindmill(o: BuildOpts): THREE.Group {
  const root = new THREE.Group();
  root.name = 'windmill';
  const k = new Kit(o.seed * 17 + 3);
  const W = WINDMILL;
  // stone plinth + tapered octagonal tower (whitewashed, stone base)
  k.cyl(W.r0 + 0.35, 0.6, PAL.stone, { y: 0.3 }, 8);
  k.cyl(W.r0, 2.2, 0xcfc7b6, { y: 0.6 + 1.1, ry: Math.PI / 8 }, 8, W.r0 - 0.2);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2, y = 0.9 + (i % 3) * 0.55;
    k.box(0.5, 0.2, 0.12, i % 2 ? PAL.rockDark : 0xa29a8c, { x: Math.sin(a) * (W.r0 - 0.05), y, z: Math.cos(a) * (W.r0 - 0.05), ry: a });
  }
  k.cyl(W.r0 - 0.2, W.h - 2.8, PAL.wallWhite, { y: 2.8 + (W.h - 2.8) / 2, ry: Math.PI / 8 }, 8, W.r1);
  // gallery balcony (wooden deck + railing) around the waist
  const gy = 4.4, gr = 2.9;
  k.cyl(gr, 0.16, PAL.plank, { y: gy }, 12);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, a2 = ((i + 1) / 12) * Math.PI * 2;
    k.beam(Math.sin(a) * (gr - 0.1), gy - 0.9, Math.cos(a) * (gr - 0.1), Math.sin(a) * (W.r0 - 0.5), gy - 1.8, Math.cos(a) * (W.r0 - 0.5), 0.1, PAL.woodDark);
    k.box(0.1, 0.8, 0.1, PAL.woodDark, { x: Math.sin(a) * (gr - 0.08), y: gy + 0.45, z: Math.cos(a) * (gr - 0.08) });
    k.beam(Math.sin(a) * (gr - 0.08), gy + 0.82, Math.cos(a) * (gr - 0.08), Math.sin(a2) * (gr - 0.08), gy + 0.82, Math.cos(a2) * (gr - 0.08), 0.08, PAL.wood);
  }
  // cap: wooden boat-shaped roof
  k.cyl(W.r1 + 0.25, 0.3, PAL.woodDark, { y: W.h + 0.1 }, 10);
  k.at({ y: W.h + 0.2 }, () => {
    k.ball(W.r1 + 0.35, PAL.roofBrown, { y: 0.1, s: [1, 0.95, 1.2] }, 1);
    k.cone(0.25, 0.8, PAL.roofBrown, { y: 2.1 }, 6);
    k.ball(0.14, PAL.yellow, { y: 2.55 });
    k.box(0.9, 0.9, 0.9, PAL.roofBrown, { y: 0.9, z: W.r1 + 0.1 });
    k.box(0.12, 0.12, 1.8, PAL.woodDark, { y: 0.2, z: -W.r1 - 0.6, rx: -0.4 }); // tail pole
  });
  // axle housing
  k.cyl(0.35, 0.8, PAL.woodDark, { y: W.hubY, z: W.hubZ - 0.45, rx: Math.PI / 2 }, 8);
  // front door, steps, windows
  k.at({ z: W.r0 - 0.05 }, () => {
    k.box(1.4, 2.3, 0.3, PAL.woodDark, { y: 0.6 + 1.1 });
    k.box(1.1, 2.05, 0.1, 0x8a5a3a, { y: 0.6 + 1.0, z: 0.14 });
    k.cyl(0.55, 0.3, PAL.woodDark, { y: 2.8, rx: Math.PI / 2 }, 8);
    k.box(0.05, 1.9, 0.02, PAL.woodDark, { y: 1.6, z: 0.2 });
    k.ball(0.06, PAL.yellow, { x: 0.35, y: 1.6, z: 0.22 });
    for (let i = 0; i < 2; i++) k.box(1.6, 0.2, 0.4, PAL.stone, { y: 0.1 + i * 0.2, z: 0.45 - i * 0.2 });
  });
  for (const [a, y] of [[0.9, 3.2], [-1.2, 6.4], [2.6, 6.2], [0.2, 7.2]] as const) {
    const r = W.r0 - 0.2 - ((W.r0 - 0.2 - W.r1) * (y - 2.8)) / (W.h - 2.8);
    windowUnit(k, { x: Math.sin(a) * r, y, z: Math.cos(a) * r, ry: a }, 0.55, 0.7, null);
  }
  // plaque post + sacks and crates
  k.box(0.14, 1.3, 0.14, PAL.woodDark, { x: W.plaque.x, y: 0.65, z: W.plaque.z - 0.08 });
  sack(k, { x: -1.8, z: 3.0, ry: 0.3 });
  sack(k, { x: -2.3, z: 2.6, ry: -0.5 });
  sack(k, { x: -2.0, y: 0.45, z: 2.8, ry: 1.1, s: 0.85 });
  crate(k, { x: 2.8, z: 1.6, ry: 0.4 });
  crate(k, { x: 2.9, y: 0.6, z: 1.7, ry: 0.1 }, 0.5);
  if (o.season === 'autumn') { pumpkin(k, { x: -1.2, z: 3.5 }); pumpkin(k, { x: 1.0, z: 3.7 }, 0.18); }
  k.build(root, o.night);

  // sails (rotating)
  const sk = new Kit(9);
  sk.cyl(0.42, 0.5, PAL.woodDark, { rx: Math.PI / 2 }, 8);
  sk.ball(0.28, PAL.yellow, { z: 0.28 });
  for (let i = 0; i < 4; i++) {
    sk.at({ rz: (i * Math.PI) / 2 + 0.02 }, () => {
      sk.box(0.22, 6.2, 0.18, PAL.woodDark, { y: 3.1, z: 0.1 });
      // lattice + cloth on the trailing side
      for (let j = 0; j < 7; j++) sk.box(1.25, 0.07, 0.07, PAL.woodLight, { x: 0.6, y: 1.1 + j * 0.8, z: 0.12 });
      sk.box(0.07, 5.0, 0.07, PAL.woodLight, { x: 1.2, y: 3.6, z: 0.12 });
      sk.box(1.05, 4.6, 0.03, i % 2 ? PAL.cloth : 0xf3e6cc, { x: 0.62, y: 3.7, z: 0.07 });
    });
  }
  const sails = sk.mesh();
  sails.position.set(0, W.hubY, W.hubZ);
  root.add(sails);

  // per-core indicator lamps on the gallery rail (instanced; lit = busy core)
  const MAXC = 24;
  const lampGeo = new THREE.IcosahedronGeometry(0.11, 0);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, MAXC);
  lamps.count = 0;
  root.add(lamps);
  const lampCol = new THREE.Color(), dim = new THREE.Color(0x4a3a2a), hot = new THREE.Color(1.8, 1.1, 0.35), warm = new THREE.Color(1.4, 1.4, 0.5);
  const m4 = new THREE.Matrix4();

  const pl = plaque(1.3, 0.72);
  pl.mesh.position.copy(W.plaque);
  pl.mesh.rotation.x = -0.12;
  root.add(pl.mesh);

  let speed = 0.2, ang = 0, lastPl = -1;
  const cores: number[] = [];
  const rig: Rig = {
    update(e: Env) {
      const lv = e.lv;
      const target = 0.12 + lv.cpu * 3.2 + Math.min(0.3, Math.hypot(e.wind.x, e.wind.z) * 0.04);
      speed = damp(speed, target, 0.8, e.dt);
      ang += speed * e.dt;
      sails.rotation.z = -ang;
      // lamps
      const n = Math.min(MAXC, lv.cores.length);
      lamps.count = n;
      for (let i = 0; i < n; i++) {
        cores[i] = damp(cores[i] ?? 0, lv.cores[i] ?? 0, 4, e.dt);
        const a = Math.PI + ((i + 0.5) / n - 0.5) * Math.PI * 1.1;
        m4.makeTranslation(Math.sin(a) * 2.82, 4.4 + 0.92, Math.cos(a) * 2.82 * -1);
        lamps.setMatrixAt(i, m4);
        const v = clamp01(cores[i]);
        lampCol.copy(dim).lerp(v > 0.85 ? hot : warm, Math.min(1, v * 1.3));
        lamps.setColorAt(i, lampCol);
      }
      lamps.instanceMatrix.needsUpdate = true;
      if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
      if (e.t - lastPl > 0.5 || lastPl < 0) {
        lastPl = e.t;
        pl.set(lv.live
          ? { title: 'Windmill · CPU', value: pct(lv.cpu), sub: `${lv.cores.length} cores · load ${(lv.cpu * Math.max(1, lv.cores.length)).toFixed(1)}`, bar: lv.cpu, accent: lv.cpu > 0.85 ? '#c9452f' : '#4f8a3a' }
          : { title: 'Windmill · CPU', value: NOSTAT });
      }
      pl.night(e.night);
    },
  };
  root.userData.rig = rig;
  return root;
}

// ---------------------------------------------------------------------------------------------
// Water tower — water level = RAM (a tall sight glass on the tank)

export const WATER_TOWER = Object.freeze({ legH: 6.2, tankR: 2.3, tankH: 3.2, plaque: new THREE.Vector3(0, 1.5, 2.25) });

export function buildWaterTower(o: BuildOpts): THREE.Group {
  const root = new THREE.Group();
  root.name = 'waterTower';
  const k = new Kit(o.seed * 13 + 5);
  const T = WATER_TOWER;
  const top = T.legH;
  const legs: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [x, z] of legs) {
    k.cyl(0.35, 0.35, PAL.stone, { x: x * 2.2, y: 0.17, z: z * 2.2 }, 6);
    k.beam(x * 2.2, 0.2, z * 2.2, x * 1.55, top, z * 1.55, 0.28, PAL.wood);
  }
  for (let i = 0; i < 4; i++) {
    const [ax, az] = legs[i], [bx, bz] = legs[(i + 1) % 4];
    for (const [y0, y1] of [[0.8, 3.2], [3.2, 5.6]]) {
      const f0 = 2.2 - (0.65 * y0) / top, f1 = 2.2 - (0.65 * y1) / top;
      k.beam(ax * f0, y0, az * f0, bx * f1, y1, bz * f1, 0.1, PAL.woodDark);
      k.beam(bx * f0, y0, bz * f0, ax * f1, y1, az * f1, 0.1, PAL.woodDark);
    }
    const fy = 3.2, f = 2.2 - (0.65 * fy) / top;
    k.beam(ax * f, fy, az * f, bx * f, fy, bz * f, 0.14, PAL.wood);
  }
  // platform + railing
  k.cyl(2.75, 0.2, PAL.plank, { y: top + 0.1 }, 12);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2, a2 = ((i + 1) / 16) * Math.PI * 2;
    k.box(0.07, 0.7, 0.07, PAL.metalDark, { x: Math.sin(a) * 2.65, y: top + 0.55, z: Math.cos(a) * 2.65 });
    k.beam(Math.sin(a) * 2.65, top + 0.88, Math.cos(a) * 2.65, Math.sin(a2) * 2.65, top + 0.88, Math.cos(a2) * 2.65, 0.06, PAL.metalDark);
  }
  // barrel tank with hoops, conical roof
  k.cyl(T.tankR, T.tankH, PAL.woodLight, { y: top + 0.2 + T.tankH / 2 }, 16);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.2;
    k.box(0.03, T.tankH, 0.05, PAL.wood, { x: Math.sin(a) * (T.tankR + 0.01), y: top + 0.2 + T.tankH / 2, z: Math.cos(a) * (T.tankR + 0.01), ry: a });
  }
  for (const f of [0.12, 0.5, 0.88]) k.cyl(T.tankR + 0.05, 0.12, PAL.metalDark, { y: top + 0.2 + T.tankH * f }, 16);
  k.cone(T.tankR + 0.45, 1.8, PAL.roofBlue, { y: top + 0.2 + T.tankH + 0.9 }, 12);
  k.cyl(T.tankR + 0.45, 0.12, 0x3d5f88, { y: top + 0.2 + T.tankH + 0.02 }, 12);
  k.cyl(0.08, 0.6, PAL.metalDark, { y: top + T.tankH + 2.2 }, 5);
  k.ball(0.15, PAL.red, { y: top + T.tankH + 2.55 });
  // sight glass frame on the front (+z) of the tank, with tick marks
  const gy0 = top + 0.45, gy1 = top + T.tankH - 0.1, gz = T.tankR + 0.18;
  k.box(0.75, gy1 - gy0 + 0.3, 0.14, PAL.metalDark, { y: (gy0 + gy1) / 2, z: gz - 0.08 });
  k.box(0.46, gy1 - gy0, 0.06, 0x1c3448, { y: (gy0 + gy1) / 2, z: gz });
  for (let i = 0; i <= 10; i++) k.box(i % 5 ? 0.12 : 0.22, 0.04, 0.04, PAL.white, { x: -0.3, y: gy0 + ((gy1 - gy0) * i) / 10, z: gz + 0.04 });
  k.cyl(0.14, 0.2, PAL.metalDark, { y: gy1 + 0.2, z: gz - 0.05 }, 6);
  // outlet pipe + spout
  k.cyl(0.14, top, PAL.metalDark, { x: 0.9, y: top / 2, z: -0.4 }, 6);
  k.beam(0.9, 1.6, -0.4, 1.6, 1.3, 0.3, 0.14, PAL.metalDark);
  bucket(k, { x: 1.7, z: 0.4 }, true);
  // ladder up the back-right leg
  k.at({}, () => {
    const a = [1.95, 0.2, -1.95], b = [1.4, top, -1.4];
    for (const s of [-0.25, 0.25]) k.beam(a[0] + s, a[1], a[2] - s, b[0] + s, b[1], b[2] - s, 0.07, PAL.metalDark);
    for (let i = 1; i < 18; i++) {
      const f = i / 18, x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f, z = a[2] + (b[2] - a[2]) * f;
      k.beam(x - 0.25, y, z + 0.25, x + 0.25, y, z - 0.25, 0.04, PAL.metalDark);
    }
  });
  // plaque sign post
  k.box(0.12, 1.4, 0.12, PAL.woodDark, { x: -0.7, y: 0.7, z: T.plaque.z - 0.05 });
  k.box(0.12, 1.4, 0.12, PAL.woodDark, { x: 0.7, y: 0.7, z: T.plaque.z - 0.05 });
  barrel(k, { x: -1.6, z: 0.8 });
  k.build(root, o.night);

  // animated water column + wobbling surface inside the sight glass
  const wk = new Kit(2);
  wk.box(0.4, 1, 0.08, 0x4ab8e8, { y: 0.5 });
  wk.box(0.08, 1, 0.09, 0x9fe0ff, { x: -0.12, y: 0.5 });
  const water = wk.mesh(toon(0xffffff, { vertexColors: true, emissive: 0x0a3a5a }));
  water.position.set(0, gy0, gz + 0.02);
  water.castShadow = false;
  root.add(water);
  const bob = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), toon(PAL.red));
  bob.position.set(0, gy0, gz + 0.07);
  root.add(bob);

  const pl = plaque(1.5, 0.82);
  pl.mesh.position.copy(T.plaque);
  root.add(pl.mesh);

  let lvl = 0.3, lastPl = -1;
  const span = gy1 - gy0;
  const rig: Rig = {
    update(e: Env) {
      const lv = e.lv;
      lvl = damp(lvl, lv.mem, 1.2, e.dt);
      const h = Math.max(0.02, lvl * span + Math.sin(e.t * 2.1) * 0.015);
      water.scale.y = h;
      bob.position.y = gy0 + h;
      bob.rotation.z = Math.sin(e.t * 1.7) * 0.2;
      if (e.t - lastPl > 0.5 || lastPl < 0) {
        lastPl = e.t;
        pl.set(lv.live
          ? { title: 'Water tower · RAM', value: `${gb(lv.memUsedGB)} / ${gb(lv.memTotalGB)} GB`, sub: `${pct(lv.mem)} full`, bar: lv.mem, accent: lv.mem > 0.9 ? '#c9452f' : '#2f78b0' }
          : { title: 'Water tower · RAM', value: NOSTAT });
      }
      pl.night(e.night);
    },
  };
  root.userData.rig = rig;
  return root;
}

// ---------------------------------------------------------------------------------------------
// Barn — thermometer = hottest temperature, lantern = GPU

export const BARN = Object.freeze({ w: 10, d: 8.4, wallH: 4.2, thermo: new THREE.Vector3(3.75, 1.75, 4.3), lantern: new THREE.Vector3(-2.35, 3.55, 4.55), plaque: new THREE.Vector3(3.9, 0.55, 4.45) });

const BARN_RED = PAL.wallRed, BARN_TRIM = PAL.wallWhite, BARN_ROOF = 0x6f4a3a;

export function buildBarn(o: BuildOpts): THREE.Group {
  const root = new THREE.Group();
  root.name = 'barn';
  const k = new Kit(o.seed * 19 + 1);
  const B = BARN;
  const hw = B.w / 2, hd = B.d / 2, wh = B.wallH;
  // gambrel profile (x, y): walls to wh, steep lower roof, shallow upper
  const kneeX = hw - 1.1, kneeY = wh + 2.2, ridgeY = wh + 3.6;
  const prof: [number, number][] = [[-hw, 0], [hw, 0], [hw, wh], [kneeX, kneeY], [0, ridgeY], [-kneeX, kneeY], [-hw, wh]];
  k.box(B.w + 0.3, 0.3, B.d + 0.3, PAL.stone, { y: 0.15 });
  k.prism(prof, B.d, BARN_RED, {});
  // vertical board lines on the side walls
  for (const s of [-1, 1]) for (let z = -hd + 0.4; z < hd; z += 0.5) k.box(0.03, wh - 0.3, 0.05, 0x9e3a2e, { x: s * (hw + 0.01), y: wh / 2 + 0.15, z });
  // white trim: corners, eaves, gable outline, X-braces
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box(0.25, wh, 0.25, BARN_TRIM, { x: x * hw, y: wh / 2, z: z * hd });
  for (const zs of [-1, 1]) {
    const z = zs * (hd + 0.05);
    for (let i = 3; i < prof.length; i++) {
      const [ax, ay] = prof[i - 1], [bx, by] = prof[i];
      k.beam(ax, ay, z, bx, by, z, 0.2, BARN_TRIM, 'solid', 0.1);
    }
    k.beam(-hw, wh, z, hw, wh, z, 0.18, BARN_TRIM, 'solid', 0.1);
  }
  // roof slabs
  const segs: [number, number, number, number][] = [[hw + 0.35, wh - 0.25, kneeX, kneeY], [kneeX, kneeY, 0, ridgeY]];
  for (const s of [-1, 1]) for (const [ax, ay, bx, by] of segs) {
    const nx = (by - ay), ny = -(bx - ax), nl = Math.hypot(nx, ny);
    const ox = (s * nx) / nl * 0.12, oy = Math.abs(ny / nl) * 0.12;
    k.beam(s * ax + ox, ay + oy, 0, s * bx + ox, by + oy, 0, 0.24, BARN_ROOF, 'solid', B.d + 0.8);
    const L = Math.hypot(bx - ax, by - ay), rows = Math.floor(L / 0.45);
    for (let i = 1; i < rows; i++) {
      const f = i / rows;
      k.beam(s * (ax + (bx - ax) * f) + ox * 2.1, ay + (by - ay) * f + oy * 2.1, 0, s * (ax + (bx - ax) * (f + 0.03)) + ox * 2.1, ay + (by - ay) * (f + 0.03) + oy * 2.1, 0, 0.06, 0x5a3a2c, 'solid', B.d + 0.82);
    }
    if (o.season === 'winter') k.beam(s * ax + ox * 2.5, ay + oy * 2.5, 0, s * bx + ox * 2.5, by + oy * 2.5, 0, 0.14, PAL.snow, 'solid', B.d + 0.6);
  }
  k.box(0.4, 0.25, B.d + 0.85, 0x5a3a2c, { y: ridgeY + 0.2 });
  // cupola on the ridge
  k.at({ y: ridgeY + 0.1 }, () => {
    k.box(1.3, 1.1, 1.3, BARN_TRIM, { y: 0.55 });
    for (const r of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) k.at({ ry: r }, () => { for (let i = 0; i < 4; i++) k.box(0.9, 0.06, 0.05, PAL.woodDark, { y: 0.3 + i * 0.18, z: 0.66, rx: 0.4 }); });
    k.cone(1.15, 0.9, BARN_ROOF, { y: 1.55, ry: Math.PI / 4 }, 4);
    k.cyl(0.04, 0.9, PAL.metalDark, { y: 2.3 }, 4);
    k.box(0.6, 0.04, 0.04, PAL.metalDark, { y: 2.4 });
    k.prism([[-0.2, 0], [0.15, 0], [0.2, 0.15], [0.05, 0.28], [-0.05, 0.18], [-0.25, 0.25]], 0.03, PAL.ink, { y: 2.55 });
  });
  // front: open doorway with dark interior, open doors, hayloft
  const dw = 3.8, dh = 3.7, fz = hd + 0.02;
  k.box(dw, dh, 0.1, 0x2a1d16, { y: dh / 2 + 0.3, z: fz - 0.05 });
  k.box(dw + 0.3, 0.25, 0.2, BARN_TRIM, { y: dh + 0.42, z: fz + 0.05 });
  for (const s of [-1, 1]) k.box(0.22, dh + 0.2, 0.2, BARN_TRIM, { x: s * (dw / 2 + 0.05), y: dh / 2 + 0.3, z: fz + 0.05 });
  for (const s of [-1, 1]) {
    // door leaf hinged at the outer edge, swung open ~115°
    k.at({ x: s * (dw / 2 + 0.1), y: 0.32, z: fz + 0.12, ry: s * 2.0 }, () => {
      const lw = dw / 2;
      k.box(lw, dh, 0.12, BARN_RED, { x: -s * lw / 2, y: dh / 2 });
      k.box(lw, 0.18, 0.16, BARN_TRIM, { x: -s * lw / 2, y: 0.1 });
      k.box(lw, 0.18, 0.16, BARN_TRIM, { x: -s * lw / 2, y: dh - 0.1 });
      k.box(0.18, dh, 0.16, BARN_TRIM, { x: -s * 0.09, y: dh / 2 });
      k.box(0.18, dh, 0.16, BARN_TRIM, { x: -s * (lw - 0.09), y: dh / 2 });
      const dl = Math.hypot(lw - 0.2, dh - 0.3);
      k.box(0.16, dl, 0.15, BARN_TRIM, { x: -s * lw / 2, y: dh / 2, rz: Math.atan2(lw - 0.2, dh - 0.3) });
      k.box(0.16, dl, 0.15, BARN_TRIM, { x: -s * lw / 2, y: dh / 2, rz: -Math.atan2(lw - 0.2, dh - 0.3) });
    });
  }
  // sliding-door rail above
  k.box(dw * 2.1, 0.12, 0.12, PAL.metalDark, { y: dh + 0.65, z: fz + 0.12 });
  // hayloft door with hay, pulley beam
  k.box(1.7, 1.5, 0.1, 0x2a1d16, { y: wh + 1.0, z: fz - 0.02 });
  k.box(1.9, 0.14, 0.18, BARN_TRIM, { y: wh + 1.8, z: fz + 0.04 });
  k.box(1.9, 0.14, 0.18, BARN_TRIM, { y: wh + 0.22, z: fz + 0.04 });
  for (const s of [-1, 1]) k.box(0.14, 1.6, 0.18, BARN_TRIM, { x: s * 0.9, y: wh + 1.0, z: fz + 0.04 });
  k.blob(0.55, PAL.hay, { x: -0.2, y: wh + 0.5, z: fz + 0.15, s: [1.3, 0.55, 0.8] });
  k.blob(0.35, 0xd4b458, { x: 0.35, y: wh + 0.45, z: fz + 0.25, s: [1.1, 0.6, 0.8] });
  k.box(0.2, 0.2, 1.8, PAL.woodDark, { y: ridgeY - 0.35, z: fz + 0.6 });
  k.cyl(0.14, 0.1, PAL.metalDark, { y: ridgeY - 0.55, z: fz + 1.3, rz: Math.PI / 2 }, 8);
  k.rod(0, ridgeY - 0.6, fz + 1.3, 0, 1.4, fz + 1.3, 0.02, PAL.cloth);
  k.box(0.18, 0.3, 0.1, PAL.metalDark, { y: 1.3, z: fz + 1.3 });
  // interior: hay bales, loft floor, a lantern glow deep inside
  k.at({ z: 0 }, () => {
    k.box(B.w - 0.6, 0.2, B.d - 0.6, PAL.plank, { y: wh + 0.05 });
    hayBale(k, { x: -1.2, y: 0.3, z: hd - 1.4, ry: 0.2 });
    hayBale(k, { x: 1.0, y: 0.3, z: hd - 1.8, ry: -0.3 });
    hayBale(k, { x: -0.8, y: 0.85, z: hd - 1.5, ry: 0.5 });
    hayBale(k, { x: 1.3, y: 0.3, z: hd - 3.0, ry: 0.1 });
    k.blob(1.3, PAL.hay, { x: 0.2, y: 0.4, z: -1.5, s: [1.5, 0.8, 1.3] });
    k.box(0.3, 0.4, 0.3, PAL.lampGlow, { x: -1.6, y: 2.5, z: -1.0 }, 'glow');
  });
  // side windows (hay-door style, cross-braced) and trims
  for (const s of [-1, 1]) for (const z of [-2.2, 1.6]) {
    k.at({ x: s * (hw + 0.02), y: 2.2, z, ry: s * Math.PI / 2 }, () => {
      k.box(1.2, 1.1, 0.08, PAL.windowGlow, { z: 0 }, 'glow');
      k.box(1.4, 0.14, 0.14, BARN_TRIM, { y: 0.6, z: 0.05 });
      k.box(1.4, 0.14, 0.14, BARN_TRIM, { y: -0.6, z: 0.05 });
      k.box(0.14, 1.3, 0.14, BARN_TRIM, { x: -0.65, z: 0.05 });
      k.box(0.14, 1.3, 0.14, BARN_TRIM, { x: 0.65, z: 0.05 });
      k.box(0.1, 1.5, 0.1, BARN_TRIM, { rz: 0.83, z: 0.08 });
    });
  }
  // thermometer board on the front wall (right of the door)
  const T = B.thermo;
  k.at({ x: T.x, z: fz + 0.1 }, () => {
    k.box(0.95, 3.2, 0.14, BARN_TRIM, { y: T.y + 1.45 });
    k.box(0.85, 3.1, 0.02, 0xf6efe0, { y: T.y + 1.45, z: 0.08 });
    k.cyl(0.22, 0.1, 0xd83a36, { y: T.y + 0.1, z: 0.13, rx: Math.PI / 2 }, 10);
    k.box(0.16, 2.55, 0.05, 0xdbe6ee, { y: T.y + 1.55, z: 0.12 });
    for (let i = 0; i <= 15; i++) k.box(i % 5 ? 0.12 : 0.22, 0.025, 0.02, PAL.ink, { x: 0.2 + (i % 5 ? 0 : 0.05), y: T.y + 0.35 + i * 0.16, z: 0.1 });
    k.cyl(0.14, 0.16, 0xd9a93a, { y: T.y + 3.06, z: 0.1, rx: Math.PI / 2 }, 6);
  });
  k.box(1.25, 0.1, 0.12, PAL.woodDark, { x: T.x, y: 0.82, z: fz + 0.1 });
  k.box(1.25, 0.1, 0.12, PAL.woodDark, { x: T.x, y: 1.5, z: fz + 0.1 });
  // lantern bracket by the door
  const L = B.lantern;
  k.box(0.08, 0.08, 0.6, PAL.ink, { x: L.x, y: L.y + 0.55, z: fz + 0.3 });
  k.cyl(0.02, 0.2, PAL.ink, { x: L.x, y: L.y + 0.42, z: L.z }, 4);
  k.cyl(0.18, 0.08, PAL.ink, { x: L.x, y: L.y + 0.3, z: L.z }, 6, 0.1);
  k.cyl(0.19, 0.06, PAL.ink, { x: L.x, y: L.y - 0.25, z: L.z }, 6);
  // yard dressing
  cart(k, { x: -6.2, z: 3.5, ry: 0.5 }, 'hay');
  hayBale(k, { x: 5.8, z: 3.2, ry: 0.3 }, true);
  hayBale(k, { x: 5.9, z: 1.6, ry: -0.2 });
  hayBale(k, { x: 5.9, y: 0.55, z: 1.7, ry: 0.1 });
  barrel(k, { x: -5.6, z: -1.5 });
  barrel(k, { x: -5.9, z: -2.5 }, PAL.woodDark);
  crate(k, { x: 2.6, z: hd + 1.0, ry: 0.3 }, 0.55);
  bucket(k, { x: 2.1, z: hd + 1.2 });
  flowerPot(k, { x: -2.6, z: hd + 0.5 }, o.season, 1);
  if (o.season === 'autumn') for (let i = 0; i < 4; i++) pumpkin(k, { x: -3.2 + i * 0.35, z: hd + 0.9 + (i % 2) * 0.3 }, 0.2 + (i % 2) * 0.08);
  k.build(root, o.night);

  // thermometer liquid (animated)
  const tk = new Kit(3);
  tk.box(0.1, 1, 0.06, 0xd83a36, { y: 0.5 });
  const liquid = tk.mesh(toon(0xffffff, { vertexColors: true, emissive: 0x3a0806 }));
  liquid.castShadow = false;
  liquid.position.set(T.x, T.y + 0.2, fz + 0.24);
  root.add(liquid);
  // lantern glass (GPU busy → glow)
  const lanternMat = glowMat(0);
  const lg = new Kit(4);
  lg.cyl(0.14, 0.42, PAL.lampGlow, { ry: Math.PI / 6 }, 6, 0.16);
  const lantern = lg.mesh(lanternMat);
  lantern.castShadow = false;
  lantern.position.copy(L);
  root.add(lantern);

  const pl = plaque(1.1, 0.6);
  pl.mesh.position.set(T.x, 1.16, fz + 0.26);
  root.add(pl.mesh);

  let temp = 0.3, gpu = 0, lastPl = -1;
  const rig: Rig = {
    update(e: Env) {
      const lv = e.lv;
      temp = damp(temp, lv.tempC == null ? 0.05 : lv.temp, 1.0, e.dt);
      liquid.scale.y = 0.15 + temp * 2.4;
      gpu = damp(gpu, lv.gpu ?? 0, 2, e.dt);
      const flick = 1 + Math.sin(e.t * 13) * 0.04 * gpu + Math.sin(e.t * 7.3) * 0.03 * gpu;
      setGlow(lanternMat, Math.max(e.night * 0.6, gpu), (0.55 + gpu * 0.75) * flick);
      lantern.rotation.z = Math.sin(e.t * 1.3) * 0.04;
      if (e.t - lastPl > 0.5 || lastPl < 0) {
        lastPl = e.t;
        const tc = lv.tempC;
        pl.set({
          title: lv.gpu == null ? 'Barn · temp' : `Barn · temp · GPU ${pct(lv.gpu)}`,
          value: lv.live && tc != null ? `${Math.round(tc)} °C` : NOSTAT,
          accent: tc != null && tc > 80 ? '#c9452f' : '#8a3a2a',
        });
      }
      pl.night(e.night);
    },
  };
  root.userData.rig = rig;
  return root;
}

// ---------------------------------------------------------------------------------------------
// Silo — grain fill = disk

export const SILO = Object.freeze({ r: 2.2, h: 10.5, win0: 1.1, win1: 9.6, plaque: new THREE.Vector3(1.9, 1.2, 2.6) });

export function buildSilo(o: BuildOpts): THREE.Group {
  const root = new THREE.Group();
  root.name = 'silo';
  const k = new Kit(o.seed * 23 + 11);
  const S = SILO;
  k.cyl(S.r + 0.35, 0.5, PAL.stone, { y: 0.25 }, 14);
  k.cyl(S.r, S.h, 0xd9d2c4, { y: 0.5 + S.h / 2 }, 14);
  // concrete staves + steel hoops
  for (let i = 0; i < 14; i++) {
    const y = 0.5 + (i + 0.5) * (S.h / 14);
    k.cyl(S.r + 0.03, 0.06, i % 2 ? PAL.metalDark : 0xb8b0a0, { y }, 14);
  }
  // red roof dome with vent
  k.add(new THREE.SphereGeometry(S.r + 0.15, 14, 4, 0, Math.PI * 2, 0, Math.PI / 2), PAL.roofRed, { y: 0.5 + S.h, s: [1, 0.7, 1] });
  k.cyl(S.r + 0.2, 0.15, 0x9e3d2e, { y: 0.5 + S.h }, 14);
  k.cyl(0.3, 0.5, PAL.metalDark, { y: 0.5 + S.h + 1.7 }, 6);
  k.cone(0.45, 0.35, PAL.metalDark, { y: 0.5 + S.h + 2.1 }, 6);
  // window strip on the front: frame, dark interior, glass mullions
  const z = S.r + 0.02;
  k.box(0.95, S.win1 - S.win0 + 0.3, 0.16, PAL.metalDark, { y: (S.win0 + S.win1) / 2, z: z - 0.02 });
  k.box(0.62, S.win1 - S.win0, 0.06, 0x2a221a, { y: (S.win0 + S.win1) / 2, z: z + 0.05 });
  for (let i = 1; i < 10; i++) k.box(0.68, 0.05, 0.06, PAL.metal, { y: S.win0 + ((S.win1 - S.win0) * i) / 10, z: z + 0.14 });
  for (let i = 0; i <= 4; i++) k.box(0.22, 0.05, 0.04, PAL.white, { x: 0.52, y: S.win0 + ((S.win1 - S.win0) * i) / 4, z: z + 0.08 });
  // ladder on the side with standoff brackets
  k.at({ ry: -1.2 }, () => {
    for (const s2 of [-0.25, 0.25]) k.box(0.07, S.h + 0.6, 0.07, PAL.metalDark, { x: s2, y: (S.h + 0.6) / 2 + 0.3, z: S.r + 0.25 });
    for (let i = 0; i < 26; i++) k.box(0.5, 0.045, 0.045, PAL.metalDark, { y: 0.7 + i * 0.4, z: S.r + 0.25 });
    for (let i = 0; i < 5; i++) for (const s2 of [-0.25, 0.25]) k.box(0.05, 0.05, 0.3, PAL.metalDark, { x: s2, y: 1.5 + i * 2.2, z: S.r + 0.1 });
  });
  // chute + feed trough, plaque post
  k.beam(-1.2, 2.6, S.r - 0.3, -2.4, 1.1, S.r + 0.9, 0.35, PAL.metal);
  k.box(1.6, 0.4, 0.6, PAL.wood, { x: -2.6, y: 0.2, z: S.r + 1.2, ry: 0.4 });
  k.box(0.12, 1.2, 0.12, PAL.woodDark, { x: S.plaque.x, y: 0.6, z: S.plaque.z - 0.08 });
  sack(k, { x: 2.6, z: 1.2, ry: 0.4 });
  sack(k, { x: 2.8, z: 0.4, ry: -0.3 });
  k.build(root, o.night);

  // grain column (animated) with a little heaped top
  const gk = new Kit(4);
  gk.box(0.58, 1, 0.05, PAL.wheat, { y: 0.5 });
  gk.box(0.12, 1, 0.055, 0xf6dc86, { x: -0.18, y: 0.5 });
  const grain = gk.mesh(toon(0xffffff, { vertexColors: true, emissive: 0x2a1a00 }));
  grain.castShadow = false;
  grain.position.set(0, S.win0, z + 0.08);
  root.add(grain);
  const pl = plaque(1.3, 0.72);
  pl.mesh.position.copy(S.plaque);
  pl.mesh.rotation.y = -0.2;
  root.add(pl.mesh);

  let lvl = 0.4, lastPl = -1;
  const rig: Rig = {
    update(e: Env) {
      const lv: Levels = e.lv;
      lvl = damp(lvl, lv.disk, 0.8, e.dt);
      grain.scale.y = Math.max(0.03, lvl * (S.win1 - S.win0));
      if (e.t - lastPl > 0.5 || lastPl < 0) {
        lastPl = e.t;
        pl.set(lv.live
          ? { title: 'Silo · disk', value: `${gb(lv.diskUsedGB)} / ${gb(lv.diskTotalGB)} GB`, sub: `${pct(lv.disk)} full`, bar: lv.disk, accent: lv.disk > 0.9 ? '#c9452f' : '#b8862a' }
          : { title: 'Silo · disk', value: NOSTAT });
      }
      pl.night(e.night);
    },
  };
  root.userData.rig = rig;
  return root;
}
