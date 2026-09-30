/**
 * Leisure landmarks: the campfire (idle farmers gather here), the fishing dock on the pond and the arched bridge over
 * the river. Dock and bridge are walkable (their deck heights feed the 'walkSurface' service).
 */
import * as THREE from 'three';
import { PAL, toon } from '../toon.ts';
import { Kit, damp, softSpot } from './kit.ts';
import { bucket, firewood, logBench, stool, crate, barrel, lampPost } from './props.ts';
import type { Env, Rig } from './rig.ts';
import type { BuildOpts } from './farmhouse.ts';

// ---------------------------------------------------------------------------------------------
// Campfire

/** bench seats around the fire (local offsets, facing the fire) */
export const CAMPFIRE_SEATS: readonly [number, number][] = [[-2.2, -2.2], [3.0, 2.4], [-3.0, 2.8], [2.9, -1.9]];

export function buildCampfire(o: BuildOpts): THREE.Group {
  const root = new THREE.Group();
  root.name = 'campfire';
  const k = new Kit(o.seed + 101);
  // ash bed + stone ring
  k.cyl(0.95, 0.06, 0x4a4440, { y: 0.03 }, 10);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    k.blob(0.24 + k.r() * 0.08, [PAL.stone, PAL.rockDark, 0xa9a294][i % 3], { x: Math.sin(a) * 1.05, y: 0.12, z: Math.cos(a) * 1.05, s: [1.2, 0.8, 1], ry: a });
  }
  // log teepee
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    k.beam(Math.sin(a) * 0.62, 0.05, Math.cos(a) * 0.62, Math.sin(a) * 0.08, 0.85, Math.cos(a) * 0.08, 0.13, i % 2 ? PAL.trunk : PAL.bark);
  }
  k.cyl(0.12, 1.1, PAL.bark, { y: 0.1, z: 0.35, rz: Math.PI / 2, ry: 0.4 }, 6);
  k.cyl(0.35, 0.08, 0x2a1a12, { y: 0.07 }, 8);
  // cooking tripod with a pot
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 + 0.5; k.beam(Math.sin(a) * 1.3, 0, Math.cos(a) * 1.3, 0, 2.0, 0, 0.06, PAL.woodDark); }
  k.rod(0, 2.0, 0, 0, 1.45, 0, 0.012, PAL.metalDark);
  k.cyl(0.24, 0.3, PAL.ink, { y: 1.3 }, 8, 0.28);
  k.cyl(0.29, 0.04, PAL.metalDark, { y: 1.46 }, 8);
  k.add(new THREE.TorusGeometry(0.22, 0.015, 4, 10, Math.PI), PAL.metalDark, { y: 1.45 });
  // benches, stools, woodpile, a guitar leaning on a bench, marshmallow sticks
  for (const [x, z] of CAMPFIRE_SEATS.slice(0, 3)) logBench(k, { x, z, ry: Math.atan2(-x, -z) }, 2.0);
  stool(k, { x: CAMPFIRE_SEATS[3][0], z: CAMPFIRE_SEATS[3][1] });
  firewood(k, { x: -0.5, z: -3.4, ry: 0.1 }, 1.4, 3);
  k.at({ x: 3.6, y: 0.0, z: 3.3, ry: -2.2 }, () => {
    k.ball(0.28, 0xc8843a, { y: 0.3, z: 0.1, rx: -0.3, s: [1, 1, 0.35] }, 1);
    k.ball(0.22, 0xc8843a, { y: 0.62, z: 0.02, rx: -0.3, s: [1, 1, 0.35] }, 1);
    k.cyl(0.07, 0.02, PAL.ink, { y: 0.45, z: 0.18, rx: Math.PI / 2 - 0.3 }, 8);
    k.box(0.08, 0.7, 0.05, PAL.woodDark, { y: 1.0, z: -0.12, rx: -0.3 });
    k.box(0.12, 0.16, 0.05, PAL.woodDark, { y: 1.4, z: -0.24, rx: -0.3 });
  });
  for (const [x, z, r] of [[1.5, 1.0, 0.8], [-1.2, 1.6, -0.6]] as const) {
    k.beam(x, 0, z, x * 0.55, 0.7, z * 0.55, 0.03, PAL.woodLight);
    k.ball(0.06, PAL.white, { x: x * 0.53, y: 0.72, z: z * 0.53, ry: r, s: [1, 1.3, 1] });
  }
  lampPost(k, { x: 4.2, z: -3.0 }, 2.4);
  k.build(root, o.night);

  // flames: three tongues in one mesh (unlit, hot colours)
  const fk = new Kit(5);
  fk.jitter = 0;
  fk.cone(0.42, 1.2, 0xff6a1a, { y: 0.55 }, 6);
  fk.cone(0.26, 0.85, 0xffb030, { y: 0.45, x: 0.14, z: 0.05 }, 5);
  fk.cone(0.24, 0.9, 0xffb030, { y: 0.47, x: -0.12, z: -0.08 }, 5);
  fk.cone(0.16, 0.6, 0xfff0a0, { y: 0.35 }, 5);
  fk.cone(0.18, 0.7, 0xff8a2a, { y: 0.4, x: 0.05, z: -0.2 }, 5);
  const flameMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1.6, 1.4, 1.2) });
  const flame = fk.mesh(flameMat);
  flame.castShadow = false;
  flame.position.y = 0.1;
  root.add(flame);
  // embers
  const EM = 18;
  const embers = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.035, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.0, 0.25) }), EM);
  embers.frustumCulled = false;
  root.add(embers);
  const em = Array.from({ length: EM }, (_, i) => ({ age: (i / EM) * 2.5, life: 2.5, x: 0, z: 0, sx: Math.sin(i * 7.1) * 0.25, sz: Math.cos(i * 3.3) * 0.25 }));
  const d = new THREE.Object3D();
  // fake light pool on the ground
  const poolMat = new THREE.MeshBasicMaterial({ map: softSpot(), color: 0xff9a40, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2 });
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2), poolMat);
  pool.position.y = 0.06;
  pool.renderOrder = 2;
  root.add(pool);
  // a real warm light (the system may disable it when the player is far)
  const light = new THREE.PointLight(0xff9a4a, 0, 14, 1.6);
  light.position.set(0, 1.2, 0);
  light.castShadow = false;
  root.add(light);
  root.userData.light = light;

  const rig: Rig = {
    update(e: Env) {
      const t = e.t;
      const fl = 1 + Math.sin(t * 11) * 0.08 + Math.sin(t * 17.3) * 0.06 + Math.sin(t * 5.1) * 0.05;
      const big = 0.85 + e.night * 0.3;
      flame.scale.set(big * (1 + Math.sin(t * 9) * 0.05), big * fl, big * (1 + Math.cos(t * 8) * 0.05));
      flame.rotation.y = t * 0.9;
      flame.rotation.z = e.wind.x * 0.03 + Math.sin(t * 3.1) * 0.04;
      flame.rotation.x = -e.wind.z * 0.03;
      for (let i = 0; i < EM; i++) {
        const p = em[i];
        p.age += e.dt;
        if (p.age > p.life) { p.age = 0; p.life = 1.6 + ((i * 37) % 10) / 10; p.x = 0; p.z = 0; }
        const u = p.age / p.life;
        p.x += (p.sx * 0.4 + e.wind.x * 0.12 + Math.sin(t * 3 + i) * 0.2) * e.dt;
        p.z += (p.sz * 0.4 + e.wind.z * 0.12 + Math.cos(t * 2.6 + i) * 0.2) * e.dt;
        d.position.set(p.x, 0.6 + u * 2.6, p.z);
        d.rotation.set(t * 5 + i, t * 3, 0);
        d.scale.setScalar((1 - u) * (0.6 + 0.6 * Math.abs(Math.sin(t * 13 + i))));
        d.updateMatrix();
        embers.setMatrixAt(i, d.matrix);
      }
      embers.instanceMatrix.needsUpdate = true;
      poolMat.opacity = (0.08 + e.night * 0.5) * fl;
      light.intensity = e.night * 9 * fl;
    },
  };
  root.userData.rig = rig;
  return root;
}

// ---------------------------------------------------------------------------------------------
// Dock — planks from the bank into the pond

export interface DeckOpts { /** deck top height (root-local) */ deckY: number; /** ground height at local z (root-local) */ ground(lz: number): number; /** water height (root-local) */ water: number }
export const DOCK = Object.freeze({ w: 2.2, z0: -3.5, z1: 7.2 });

/** where the planks start (first local z whose ground is below the deck) */
export function dockStart(d: DeckOpts): number {
  for (let z = DOCK.z0; z < DOCK.z1; z += 0.1) if (d.ground(z) <= d.deckY - 0.12) return Math.max(DOCK.z0, z - 0.4);
  return DOCK.z0;
}

export function buildDock(o: BuildOpts, dk: DeckOpts = { deckY: 0.6, ground: (z) => (z < -1 ? 0.5 : -0.5 - z * 0.2), water: 0 }): THREE.Group {
  const root = new THREE.Group();
  root.name = 'dock';
  const k = new Kit(o.seed + 111);
  const W = DOCK.w, y = dk.deckY, z0 = dockStart(dk), z1 = DOCK.z1;
  // planks across the width
  for (let z = z0; z < z1; z += 0.32) k.box(W, 0.1, 0.28, (Math.round(z / 0.32) % 3 === 0) ? PAL.woodLight : PAL.plank, { y: y - 0.05, z: z + 0.14, ry: (k.r() - 0.5) * 0.02 });
  for (const s of [-1, 1]) k.box(0.14, 0.18, z1 - z0, PAL.woodDark, { x: s * (W / 2 - 0.07), y: y - 0.18, z: (z0 + z1) / 2 });
  // posts down into the water/bank, with rope wraps
  for (let z = z0 + 0.2; z <= z1; z += 1.6) for (const s of [-1, 1]) {
    const g = Math.min(dk.ground(z), dk.water) - 1.2;
    k.cyl(0.13, y + 0.35 - g, PAL.woodDark, { x: s * (W / 2 + 0.02), y: (y + 0.35 + g) / 2, z }, 6);
    k.cyl(0.15, 0.08, PAL.cloth, { x: s * (W / 2 + 0.02), y: y + 0.1, z }, 6);
  }
  // end: bollard, lantern post, stool, bucket, tackle crate, a rolled net
  k.cyl(0.14, 0.4, PAL.ink, { x: 0.7, y: y + 0.2, z: z1 - 0.3 }, 7);
  k.cyl(0.19, 0.06, PAL.ink, { x: 0.7, y: y + 0.4, z: z1 - 0.3 }, 7);
  lampPost(k, { x: -W / 2 + 0.15, y, z: z1 - 0.25 }, 2.1);
  stool(k, { x: 0.35, y, z: z1 - 1.3 });
  bucket(k, { x: -0.35, y, z: z1 - 1.1 }, true);
  crate(k, { x: -0.6, y, z: z1 - 2.2, ry: 0.3 }, 0.42);
  k.cyl(0.18, 0.6, 0xc9b98a, { x: 0.6, y: y + 0.18, z: z1 - 2.6, rz: Math.PI / 2 }, 7);
  // a fish in the bucket's neighbour
  k.ball(0.1, 0x7fa8c0, { x: -0.6, y: y + 0.47, z: z1 - 2.2, s: [1.8, 0.7, 0.8] });
  k.build(root, o.night);

  // fishing rod resting on the stool, line to a bobbing float
  const rk = new Kit(6);
  const tip = new THREE.Vector3(0.6, y + 1.9, z1 + 1.9);
  rk.beam(0.25, y + 0.45, z1 - 1.5, tip.x, tip.y, tip.z, 0.04, PAL.woodLight);
  rk.cyl(0.05, 0.1, PAL.metalDark, { x: 0.3, y: y + 0.6, z: z1 - 1.2, rx: 0.9 }, 6);
  root.add(rk.mesh());
  const line = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1, 3).translate(0, -0.5, 0), toon(PAL.white));
  line.position.copy(tip);
  root.add(line);
  const bob = new Kit(7);
  bob.ball(0.07, PAL.red, { y: 0.03 });
  bob.ball(0.065, PAL.white, { y: -0.03 });
  bob.cyl(0.01, 0.1, PAL.ink, { y: 0.12 }, 3);
  const float = bob.mesh();
  root.add(float);
  const fp = new THREE.Vector3(tip.x + 0.2, dk.water + 0.02, tip.z + 1.2);
  const dir = new THREE.Vector3(), up = new THREE.Vector3(0, -1, 0);

  const rig: Rig = {
    update(e: Env) {
      const nib = Math.sin(e.t * 0.37) > 0.93 ? Math.sin(e.t * 25) * 0.05 : 0;
      float.position.set(fp.x + Math.sin(e.t * 0.5) * 0.08, fp.y + Math.sin(e.t * 2.1) * 0.025 + nib, fp.z + Math.cos(e.t * 0.4) * 0.08);
      dir.subVectors(float.position, tip);
      line.scale.y = dir.length();
      line.quaternion.setFromUnitVectors(up, dir.normalize());
    },
  };
  root.userData.rig = rig;
  return root;
}

// ---------------------------------------------------------------------------------------------
// Bridge — a wooden arch over the river

export interface BridgeOpts { /** ground at the two ends (root-local heights), z = -L/2 and +L/2 */ yA: number; yB: number; water: number }
export const BRIDGE = Object.freeze({ L: 14.6, w: 3.0, rise: 1.6 });

export function bridgeDeck(b: BridgeOpts, lz: number): number {
  const L = BRIDGE.L, u = Math.max(-1, Math.min(1, lz / (L / 2)));
  const base = b.yA + (b.yB - b.yA) * (u * 0.5 + 0.5);
  const mid = Math.max(b.water + 1.9, Math.max(b.yA, b.yB) + BRIDGE.rise * 0.6);
  const lift = mid - (b.yA + b.yB) / 2;
  return base + lift * Math.cos((u * Math.PI) / 2) ** 1.3;
}

export function buildBridge(o: BuildOpts, b: BridgeOpts = { yA: 0.2, yB: 0.2, water: -1.5 }): THREE.Group {
  const root = new THREE.Group();
  root.name = 'bridge';
  const k = new Kit(o.seed + 121);
  const { L, w } = BRIDGE;
  const N = 22;
  const zAt = (i: number) => -L / 2 + (i / N) * L;
  // deck planks (across), following the arch
  for (let i = 0; i < N; i++) {
    const za = zAt(i), zb = zAt(i + 1), ya = bridgeDeck(b, za), yb = bridgeDeck(b, zb);
    const len = Math.hypot(zb - za, yb - ya);
    k.box(w, 0.14, len + 0.02, i % 2 ? PAL.plank : PAL.woodLight, { y: (ya + yb) / 2 - 0.07, z: (za + zb) / 2, rx: -Math.atan2(yb - ya, zb - za) });
    // arched stringers under the deck
    for (const s of [-1, 1]) k.beam(s * (w / 2 - 0.2), ya - 0.3, za, s * (w / 2 - 0.2), yb - 0.3, zb, 0.2, PAL.woodDark, 'solid', 0.4);
  }
  // railings: posts + curved top rail
  const PN = 9;
  for (const s of [-1, 1]) {
    for (let i = 0; i <= PN; i++) {
      const z = -L / 2 + 0.3 + (i / PN) * (L - 0.6), y = bridgeDeck(b, z);
      k.box(0.16, 1.05, 0.16, PAL.woodDark, { x: s * (w / 2 + 0.05), y: y + 0.45, z });
      k.cone(0.12, 0.16, PAL.woodDark, { x: s * (w / 2 + 0.05), y: y + 1.05, z, ry: Math.PI / 4 }, 4);
      if (i < PN) {
        const z2 = -L / 2 + 0.3 + ((i + 1) / PN) * (L - 0.6), y2 = bridgeDeck(b, z2);
        k.beam(s * (w / 2 + 0.05), y + 0.92, z, s * (w / 2 + 0.05), y2 + 0.92, z2, 0.1, PAL.wood, 'solid', 0.14);
        k.beam(s * (w / 2 + 0.05), y + 0.45, z, s * (w / 2 + 0.05), y2 + 0.45, z2, 0.06, PAL.wood, 'solid', 0.1);
      }
    }
  }
  // big arch beams + piers into the river
  for (const s of [-1, 1]) {
    for (let i = 0; i < N; i++) {
      const za = zAt(i), zb = zAt(i + 1);
      const u0 = za / (L / 2), u1 = zb / (L / 2);
      const ya = bridgeDeck(b, za) - 0.5 - (1 - Math.cos(u0 * Math.PI / 2)) * 0.6, yb = bridgeDeck(b, zb) - 0.5 - (1 - Math.cos(u1 * Math.PI / 2)) * 0.6;
      k.beam(s * (w / 2 - 0.05), ya, za, s * (w / 2 - 0.05), yb, zb, 0.18, PAL.trunk, 'solid', 0.3);
    }
    for (const z of [-L / 4, L / 4]) k.box(0.3, bridgeDeck(b, z) - b.water + 1.2, 0.3, PAL.woodDark, { x: s * (w / 2 - 0.2), y: (bridgeDeck(b, z) + b.water - 1.2) / 2 - 0.3, z });
  }
  // stone abutments at both ends + corner lanterns
  for (const [z, y] of [[-L / 2, b.yA], [L / 2, b.yB]] as const) {
    k.box(w + 0.8, 1.4, 1.2, PAL.stone, { y: y - 0.55, z });
    for (let i = 0; i < 5; i++) k.box(0.5, 0.18, 0.05, PAL.rockDark, { x: -1.4 + i * 0.7, y: y - 0.4 - (i % 2) * 0.3, z: z + Math.sign(z) * 0.62 });
    for (const s of [-1, 1]) {
      k.box(0.34, 1.35, 0.34, PAL.stone, { x: s * (w / 2 + 0.2), y: y + 0.55, z });
      k.box(0.2, 0.3, 0.2, PAL.lampGlow, { x: s * (w / 2 + 0.2), y: y + 1.4, z }, 'glow');
      k.cone(0.22, 0.25, PAL.ink, { x: s * (w / 2 + 0.2), y: y + 1.66, z, ry: Math.PI / 4 }, 4);
      k.box(0.3, 0.05, 0.3, PAL.ink, { x: s * (w / 2 + 0.2), y: y + 1.24, z });
    }
  }
  // a crate and a barrel near the east end (a traveller's rest)
  crate(k, { x: -w / 2 - 1.0, y: b.yB, z: L / 2 + 0.6, ry: 0.4 }, 0.5);
  barrel(k, { x: w / 2 + 0.9, y: b.yB, z: L / 2 + 0.8 });
  k.build(root, o.night);
  return root;
}
