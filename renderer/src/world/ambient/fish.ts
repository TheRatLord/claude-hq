/**
 * Lobby fish tank life (GP §3.4 "a boids school of 12", ART §6.7): 12 clay fish flocking inside the tank's water
 * volume (separation / alignment / cohesion + soft walls), crowding the front glass when someone stands in front of
 * it, plus a bubbler column and two swaying weeds. One instanced draw for the fish, one for the bubbles, one for the
 * weeds; the sim only runs while the tank is near the camera. Owner: AMB.
 *
 * Contract with ENV's tank prop: water volume = the tank's footprint inset 0.06 m, y 0.74 … 1.26 above its floor,
 * front = local +z (the furniture's yaw). The glass must not be opaque.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getMaterial } from '../../render/materials/index.ts';
import { CORE, ENV } from '../../../../shared/palette.ts';
import { furniture, clamp } from './util.ts';
import type { AmbFrame, AmbPlayer, AmbScene } from './util.ts';
import type { HqLayout } from '../layout/schema.ts';

export const FISH_N = 12;
const BUB_N = 10;
const FISH_COLS = ['#F29A4A', ENV.butter, '#F29A4A', CORE.clayLight, ENV.teal, '#F29A4A', ENV.lavender, ENV.butter, '#F29A4A', ENV.rose, CORE.clayLight, ENV.butter];

/** A boid: position, velocity and its own wander phase `w` (set by the caller). */
export interface Boid { p: number[]; v: number[]; w?: number }
/** Tank water volume in the tank's local frame: x / z half-extents, y range. */
export interface TankBox { x: number; y0: number; y1: number; z: number }

/**
 * One boids step in the tank's local box (pure; mutates `fish`).
 * @param lure a point to crowd toward (the viewer at the front glass)
 */
export function boidsStep(fish: Boid[], dt: number, box: TankBox, lure: { x: number; y: number; z: number } | null = null) {
  const n = fish.length;
  const ax = new Float32Array(n), ay = new Float32Array(n), az = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = fish[i];
    let cx = 0, cy = 0, cz = 0, vx = 0, vy = 0, vz = 0, sx = 0, sy = 0, sz = 0, k = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const b = fish[j];
      const dx = b.p[0] - a.p[0], dy = b.p[1] - a.p[1], dz = b.p[2] - a.p[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 0.09) continue; // 0.3 m neighbourhood
      k++; cx += b.p[0]; cy += b.p[1]; cz += b.p[2]; vx += b.v[0]; vy += b.v[1]; vz += b.v[2];
      if (d2 < 0.01) { const s = 1 / Math.max(d2, 1e-3); sx -= dx * s; sy -= dy * s; sz -= dz * s; }
    }
    let fx = 0, fy = 0, fz = 0;
    if (k) {
      fx += (cx / k - a.p[0]) * 0.35 + (vx / k - a.v[0]) * 1.0;
      fy += (cy / k - a.p[1]) * 0.35 + (vy / k - a.v[1]) * 1.0;
      fz += (cz / k - a.p[2]) * 0.35 + (vz / k - a.v[2]) * 1.0;
    }
    fx += sx * 0.012; fy += sy * 0.012; fz += sz * 0.012;
    // soft walls
    const wall = (p: number, lo: number, hi: number, m: number) => (p < lo + m ? (lo + m - p) * 12 : p > hi - m ? (hi - m - p) * 12 : 0);
    fx += wall(a.p[0], -box.x, box.x, 0.12);
    fy += wall(a.p[1], box.y0, box.y1, 0.07) * 1.5;
    fz += wall(a.p[2], -box.z, box.z, 0.08);
    if (lure) { fx += (lure.x - a.p[0]) * 0.35; fy += (lure.y - a.p[1]) * 0.2; fz += (lure.z - a.p[2]) * 0.6; }
    fy -= a.v[1] * 1.5; // fish mostly swim level
    const w = a.w ?? 0; fx += Math.cos(w) * 0.05; fz += Math.sin(w) * 0.05; fy += Math.sin(w * 1.7) * 0.03; // each fish's own whim
    ax[i] = fx; ay[i] = fy; az[i] = fz;
  }
  for (let i = 0; i < n; i++) {
    const a = fish[i];
    a.v[0] += ax[i] * dt; a.v[1] += ay[i] * dt; a.v[2] += az[i] * dt;
    const s = Math.hypot(a.v[0], a.v[1], a.v[2]);
    const lo = 0.05, hi = 0.2;
    const k = s < lo ? lo / (s || 1) : s > hi ? hi / s : 1;
    a.v[0] *= k; a.v[1] *= k; a.v[2] *= k;
    a.p[0] = clamp(a.p[0] + a.v[0] * dt, -box.x, box.x);
    a.p[1] = clamp(a.p[1] + a.v[1] * dt, box.y0, box.y1);
    a.p[2] = clamp(a.p[2] + a.v[2] * dt, -box.z, box.z);
  }
}

const vcol = (g: THREE.BufferGeometry, hex: string) => {
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
  return g.index ? g.toNonIndexed() : g;
};

function fishGeometry() {
  const body = new THREE.SphereGeometry(1, 12, 9).scale(0.042, 0.03, 0.016);
  const tail = new THREE.ConeGeometry(0.024, 0.036, 4, 1).rotateZ(Math.PI / 2).scale(1, 1, 0.3).translate(-0.056, 0, 0);
  const fin = new THREE.ConeGeometry(0.012, 0.02, 3, 1).scale(1, 1, 0.3).translate(0.002, 0.03, 0);
  const eyeL = new THREE.SphereGeometry(0.0065, 6, 5).translate(0.024, 0.007, 0.012);
  const eyeR = new THREE.SphereGeometry(0.0065, 6, 5).translate(0.024, 0.007, -0.012);
  return mergeGeometries([vcol(body, '#FFFFFF'), vcol(tail, '#FFFFFF'), vcol(fin, '#FFFFFF'), vcol(eyeL, CORE.ink), vcol(eyeR, CORE.ink)], false);
}

function weedGeometry(box: TankBox) {
  const geos: THREE.BufferGeometry[] = [];
  const blade = (x: number, z: number, h: number, bend: number) => {
    const g = new THREE.CylinderGeometry(0.006, 0.014, h, 5, 6).translate(0, h / 2, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i) / h; p.setX(i, p.getX(i) + Math.sin(y * 2.4) * bend * y); }
    g.computeVertexNormals();
    return vcol(g.translate(x, box.y0 - 0.04, z), ENV.moss);
  };
  for (const [x, z, h, b] of ([[-box.x * 0.72, -box.z * 0.4, 0.34, 0.03], [-box.x * 0.62, -box.z * 0.1, 0.42, -0.04], [-box.x * 0.8, box.z * 0.2, 0.28, 0.05],
    [box.x * 0.55, -box.z * 0.45, 0.3, -0.03], [box.x * 0.66, -box.z * 0.2, 0.38, 0.04]] as [number, number, number, number][])) geos.push(blade(x, z, h, b));
  // a sage rock + a clay castle stump for the fish to hide behind
  geos.push(vcol(new THREE.DodecahedronGeometry(0.07, 0).scale(1.2, 0.7, 1).translate(box.x * 0.2, box.y0 - 0.02, -box.z * 0.35), '#8F9A8E'));
  geos.push(vcol(new THREE.CylinderGeometry(0.05, 0.06, 0.12, 8).translate(-box.x * 0.2, box.y0 + 0.02, -box.z * 0.45), CORE.clayLight));
  return mergeGeometries(geos, false);
}

interface TankFish extends Boid { ph: number; yaw: number }

export function createFish(d: { layout: HqLayout; scene: AmbScene; player: AmbPlayer; rand: () => number }) {
  const { layout, scene, player, rand } = d;
  const tank = furniture(layout, 'fishTank');
  if (!tank) return null;
  const tankPos = tank.pos; // (update() is a function declaration: it does not see the null check above)
  const [w, , dd] = tank.size;
  const floor = layout.floorY(tank.pos.x, tank.pos.z, 0);
  const box = { x: w / 2 - 0.1, y0: 0.8, y1: 1.2, z: dd / 2 - 0.09 };
  const group = new THREE.Group();
  group.name = 'amb:fishTank';
  group.position.set(tank.pos.x, floor, tank.pos.z);
  group.rotation.y = tank.yaw;
  scene.add(group);
  group.updateMatrixWorld(true);

  const fishMat = getMaterial('toonProp', { color: '#FFFFFF', vertexColors: true, instanced: true });
  const fishMesh = new THREE.InstancedMesh(fishGeometry(), fishMat, FISH_N);
  fishMesh.name = 'amb:fish';
  fishMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  fishMesh.frustumCulled = false;
  fishMesh.castShadow = false;
  const col = new THREE.Color();
  for (let i = 0; i < FISH_N; i++) fishMesh.setColorAt(i, col.set(FISH_COLS[i % FISH_COLS.length]));
  group.add(fishMesh);

  const bubMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), getMaterial('toonProp', { color: '#EAF4F6', instanced: true }), BUB_N);
  bubMesh.name = 'amb:bubbles';
  bubMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  bubMesh.frustumCulled = false;
  bubMesh.castShadow = false;
  group.add(bubMesh);

  const weeds = new THREE.Mesh(weedGeometry(box), getMaterial('foliage', { color: '#FFFFFF', vertexColors: true }));
  weeds.name = 'amb:weeds';
  weeds.castShadow = false;
  group.add(weeds);

  const fish: TankFish[] = [];
  for (let i = 0; i < FISH_N; i++) {
    const a = rand() * Math.PI * 2;
    fish.push({ p: [(rand() - 0.5) * box.x, box.y0 + rand() * (box.y1 - box.y0), (rand() - 0.5) * box.z], v: [Math.cos(a) * 0.1, 0, Math.sin(a) * 0.1], ph: rand() * 6, yaw: a });
  }
  const bub: { y: number; ph: number; s: number }[] = [];
  for (let i = 0; i < BUB_N; i++) bub.push({ y: box.y0 + rand() * (box.y1 - box.y0 + 0.05), ph: rand() * 6, s: 0.006 + rand() * 0.008 });
  const bubX = box.x - 0.08, bubZ = -box.z * 0.5;

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YZX'), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const lp = new THREE.Vector3();
  let t = 0, lureOn = false;

  function update(c: AmbFrame, camera: { position: { x: number; z: number } } | null | undefined) {
    const dist = camera ? Math.hypot(camera.position.x - tankPos.x, camera.position.z - tankPos.z) : 0;
    const vis = dist < 18;
    group.visible = vis;
    if (!vis) return;
    const dt = Math.min(c.dt, 0.05);
    t += dt;
    // a viewer at the front glass (≤ 1.8 m, in front) lures the school forward
    lp.set(player.pos.x, player.pos.y + 1.1, player.pos.z).applyMatrix4(inv);
    lureOn = lp.z > dd / 2 && lp.z < 2.2 && Math.abs(lp.x) < w / 2 + 0.4;
    const lure = lureOn ? { x: clamp(lp.x, -box.x * 0.7, box.x * 0.7), y: (box.y0 + box.y1) / 2, z: box.z * 0.8 } : null;
    for (const f of fish) f.w = (f.w ?? f.ph) + dt * (0.3 + (f.ph % 1) * 0.4);
    boidsStep(fish, dt, box, lure);
    for (let i = 0; i < FISH_N; i++) {
      const f = fish[i];
      const want = Math.atan2(-f.v[2], f.v[0]);
      let dy = want - f.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      f.yaw += dy * Math.min(1, dt * 6);
      f.ph += dt * (8 + Math.hypot(f.v[0], f.v[2]) * 40);
      e.set(0, f.yaw + Math.sin(f.ph) * 0.22, clamp(f.v[1] * 3, -0.4, 0.4));
      q.setFromEuler(e);
      p.set(f.p[0], f.p[1], f.p[2]);
      s.set(1, 1, 1 + Math.sin(f.ph * 0.5) * 0.04);
      fishMesh.setMatrixAt(i, m4.compose(p, q, s));
    }
    fishMesh.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < BUB_N; i++) {
      const b = bub[i];
      b.y += dt * (0.12 + b.s * 8);
      if (b.y > box.y1 + 0.05) { b.y = box.y0 - 0.02; b.ph = Math.random() * 6; }
      p.set(bubX + Math.sin(t * 3 + b.ph) * 0.012, b.y, bubZ + Math.cos(t * 2.3 + b.ph) * 0.01);
      const r = b.s * (1 + (b.y - box.y0) * 0.8);
      bubMesh.setMatrixAt(i, m4.compose(p, q.identity(), s.set(r, r, r)));
    }
    bubMesh.instanceMatrix.needsUpdate = true;
  }
  return {
    update,
    /** debug: 'lift' raises the school 1 m out of the tank (a look check while the tank prop is opaque) */
    force(id?: string) { if (id === 'lift') { group.position.y = floor + 1; group.updateMatrixWorld(true); inv.copy(group.matrixWorld).invert(); return true; } return false; },
    debug: () => ({ n: FISH_N, lure: lureOn }),
    dispose() { scene.remove(group); fishMesh.dispose(); bubMesh.dispose(); weeds.geometry.dispose(); },
  };
}
