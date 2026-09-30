/**
 * Small valley life: butterflies over meadows and fields, dragonflies darting over the pond, fireflies on dry
 * nights, fish jumping in the pond and river, frogs on the pond bank, rabbits and squirrels in the meadows.
 * One instanced draw call per kind (fireflies: core + glow). Zero allocation per frame.
 */
import * as THREE from 'three';
import type { FrameInfo, SceneCtx } from '../context.ts';
import { HANGOUTS, POND, RIVER, RIVER_HALF_WIDTH, WORLD, heightAt, structure } from '../../world/map.ts';
import { seeded } from '../../../core/rng.ts';
import { RigPool } from './rig.ts';
import { butterfly, dragonfly, fish, frog, glowTexture, rabbit, squirrel } from './models.ts';
import type { Activity } from './schedule.ts';
import { blink } from './schedule.ts';
import { TAU, clamp, critterSound, damp, dampAngle, groundY, lerp, openGround, sampleSpots } from './util.ts';
import type { Fx, Rng } from './util.ts';

export interface Critters {
  meshes: THREE.Object3D[];
  update(f: FrameInfo, act: Activity): void;
  stats(): Record<string, number>;
  dispose(): void;
}

const BUTTERFLY_TINTS: readonly [number, number, number][] = [
  [1, 0.86, 0.3], [1, 1, 0.97], [1, 0.62, 0.25], [0.55, 0.72, 1], [1, 0.66, 0.82], [0.72, 0.92, 0.5],
];
const DRAGON_TINTS: readonly [number, number, number][] = [[0.3, 0.85, 0.8], [0.35, 0.55, 1], [0.95, 0.38, 0.28]];
const RABBIT_TINTS: readonly [number, number, number][] = [[0.8, 0.62, 0.46], [0.74, 0.72, 0.7], [0.97, 0.93, 0.85], [0.62, 0.48, 0.37], [0.88, 0.77, 0.62]];

/** nearest point on the river centreline to (x, z) → writes out, returns distance */
function nearestRiver(x: number, z: number, out: { x: number; z: number; dx: number; dz: number }): number {
  let best = Infinity;
  for (let i = 0; i < RIVER.length - 1; i++) {
    const a = RIVER[i], b = RIVER[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
    const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / l2, 0, 1);
    const px = a.x + dx * t, pz = a.z + dz * t, d = (px - x) ** 2 + (pz - z) ** 2;
    if (d < best) { best = d; out.x = px; out.z = pz; const l = Math.sqrt(l2); out.dx = dx / l; out.dz = dz / l; }
  }
  return Math.sqrt(best);
}

export function createCritters(ctx: SceneCtx, fx: Fx): Critters {
  const rng = seeded('life:critters');
  const player = ctx.player.pos;
  const cam = ctx.camera;
  const W = WORLD.water;

  // ------------------------------------------------------------------ butterflies
  const bm = butterfly();
  const butterflies = new RigPool(bm.geo, bm.spec, 18, { side: THREE.DoubleSide });
  interface Fly { on: boolean; x: number; y: number; z: number; vx: number; vz: number; ax: number; az: number; ph: number; tint: number; rest: number; nextRest: number; yaw: number; flap: number; fade: number; leaving: boolean }
  const flies: Fly[] = [];
  for (let i = 0; i < 18; i++) flies.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vz: 0, ax: 0, az: 0, ph: rng() * 100, tint: i % BUTTERFLY_TINTS.length, rest: 0, nextRest: 4 + rng() * 10, yaw: 0, flap: 0, fade: 0, leaving: false });
  const meadow = sampleSpots(4, 90, 0.4, 14, rng);
  const pickNear = (minD: number, maxD: number, out: { x: number; z: number }): boolean => {
    for (let k = 0; k < 24; k++) {
      const s = meadow[Math.floor(rng() * meadow.length)];
      if (!s) return false;
      const d = Math.hypot(s.x - player.x, s.z - player.z);
      if (d >= minD && d <= maxD) { out.x = s.x; out.z = s.z; return true; }
    }
    return false;
  };
  const tmpXZ = { x: 0, z: 0 };

  function updateButterflies(dt: number, time: number, act: Activity) {
    const want = Math.round(act.butterflies * 16);
    let on = 0;
    for (const b of flies) if (b.on && !b.leaving) on++;
    for (const b of flies) {
      if (!b.on && on < want && rng() < dt * 2 && pickNear(6, 32, tmpXZ)) {
        // a new patch of butterflies: 1–3 share an anchor
        b.on = true; b.leaving = false; b.fade = 0; b.ax = tmpXZ.x; b.az = tmpXZ.z; b.x = tmpXZ.x; b.z = tmpXZ.z; b.y = groundY(ctx, b.x, b.z) + 0.8; on++;
        for (const o of flies) if (!o.on && on < want && rng() < 0.5) { o.on = true; o.leaving = false; o.fade = 0; o.ax = b.ax + (rng() - 0.5) * 3; o.az = b.az + (rng() - 0.5) * 3; o.x = o.ax; o.z = o.az; o.y = b.y; on++; }
      }
      if (!b.on) continue;
      const far = Math.hypot(b.x - player.x, b.z - player.z) > 55;
      if ((on > want || far) && !b.leaving) { b.leaving = true; on--; }
      b.fade = b.leaving ? b.fade - dt * 0.6 : Math.min(1, b.fade + dt * 0.8);
      if (b.fade <= 0 && b.leaving) { b.on = false; continue; }
      const g = groundY(ctx, b.x, b.z);
      if (b.rest > 0) {
        // resting on a flower head, wings slowly opening and closing
        b.rest -= dt;
        b.y = damp(b.y, g + 0.32, 6, dt);
        const pd = Math.hypot(b.x - player.x, b.z - player.z);
        if (pd < 1.6) b.rest = 0;
        b.flap = 0.65 + Math.sin(time * 2.2 + b.ph) * 0.55;
      } else {
        b.nextRest -= dt;
        if (b.nextRest <= 0) { b.nextRest = 6 + rng() * 14; b.rest = 2 + rng() * 5; }
        const t = time * 0.55 + b.ph;
        let tx = b.ax + Math.sin(t * 0.7) * 2.6 + Math.sin(t * 1.9) * 1.1;
        let tz = b.az + Math.cos(t * 0.6) * 2.6 + Math.cos(t * 1.7) * 1.1;
        const pdx = b.x - player.x, pdz = b.z - player.z, pd = Math.hypot(pdx, pdz);
        if (pd < 2) { tx += (pdx / (pd || 1)) * 3; tz += (pdz / (pd || 1)) * 3; }
        b.vx = damp(b.vx, clamp((tx - b.x) * 0.9, -1.6, 1.6), 2, dt);
        b.vz = damp(b.vz, clamp((tz - b.z) * 0.9, -1.6, 1.6), 2, dt);
        b.x += b.vx * dt; b.z += b.vz * dt;
        b.flap = 0.55 + Math.sin(time * 15 + b.ph) * 0.75;
        // each wingbeat lifts: the bobbing, erratic butterfly flight
        const lift = b.leaving ? 1.5 : 0;
        b.y = damp(b.y, g + 0.75 + Math.sin(t * 1.3) * 0.4 + lift * (1 - b.fade) * 4, 2.5, dt) + Math.sin(time * 15 + b.ph) * 0.012;
        if (Math.abs(b.vx) + Math.abs(b.vz) > 0.05) b.yaw = dampAngle(b.yaw, Math.atan2(b.vx, b.vz), 5, dt);
      }
      const s = 2.0 * b.fade;
      const slot = butterflies.put(b.x, b.y, b.z, b.yaw, 0, 0, s, s, s, b.flap);
      const c = BUTTERFLY_TINTS[b.tint];
      butterflies.tintAt(slot, c[0], c[1], c[2]);
    }
  }

  // ------------------------------------------------------------------ dragonflies
  const dm = dragonfly();
  const dragons = new RigPool(dm.geo, dm.spec, 8, { side: THREE.DoubleSide });
  interface Dragon { x: number; y: number; z: number; tx: number; ty: number; tz: number; hover: number; yaw: number; ph: number; tint: number; river: boolean; fade: number }
  const dfs: Dragon[] = [];
  for (let i = 0; i < 8; i++) dfs.push({ x: POND.x, y: W + 0.6, z: POND.z, tx: POND.x, ty: W + 0.6, tz: POND.z, hover: rng() * 2, yaw: rng() * TAU, ph: rng() * TAU, tint: i % 3, river: i >= 5, fade: 0 });
  const riv = { x: 0, z: 0, dx: 0, dz: 1 };
  function updateDragons(dt: number, time: number, act: Activity) {
    const rd = nearestRiver(player.x, player.z, riv);
    for (let i = 0; i < dfs.length; i++) {
      const d = dfs[i];
      const want = (i + 0.5) / dfs.length < act.dragonflies * (d.river ? (rd < 45 ? 1 : 0) : 1);
      d.fade = want ? Math.min(1, d.fade + dt) : Math.max(0, d.fade - dt);
      if (d.fade <= 0) {
        if (d.river) { d.x = riv.x; d.z = riv.z; d.tx = d.x; d.tz = d.z; }
        continue;
      }
      d.hover -= dt;
      if (d.hover <= 0) {
        d.hover = 0.5 + rng() * 2.2;
        if (d.river) {
          const along = (rng() - 0.5) * 16, side = (rng() - 0.5) * RIVER_HALF_WIDTH * 1.4;
          d.tx = riv.x + riv.dx * along - riv.dz * side; d.tz = riv.z + riv.dz * along + riv.dx * side;
        } else {
          const a = rng() * TAU, r = Math.sqrt(rng()) * POND.r * 0.8;
          d.tx = POND.x + Math.cos(a) * r; d.tz = POND.z + Math.sin(a) * r;
        }
        d.ty = Math.max(W, heightAt(d.tx, d.tz)) + 0.35 + rng() * 0.6;
      }
      const px = d.x, pz = d.z;
      d.x = damp(d.x, d.tx, 7, dt); d.z = damp(d.z, d.tz, 7, dt); d.y = damp(d.y, d.ty, 5, dt);
      const vx = d.x - px, vz = d.z - pz;
      if (Math.abs(vx) + Math.abs(vz) > dt * 0.4) d.yaw = dampAngle(d.yaw, Math.atan2(vx, vz), 14, dt);
      const s = 2.2 * d.fade;
      const slot = dragons.put(d.x, d.y + Math.sin(time * 3 + d.ph) * 0.04, d.z, d.yaw, 0, 0, s, s, s, Math.sin(time * 55 + d.ph) * 0.35 + 0.05);
      const c = DRAGON_TINTS[d.tint];
      dragons.tintAt(slot, c[0], c[1], c[2]);
    }
  }

  // ------------------------------------------------------------------ fireflies
  const FF = 112;
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const core = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.045, 0), coreMat, FF);
  const glowMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const glow = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), glowMat, FF);
  for (const m of [core, glow]) {
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(FF * 3), 3);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false; m.count = 0;
  }
  core.name = 'life:fireflies'; glow.name = 'life:fireflyGlow';
  glow.renderOrder = 2;
  const fire = structure('campfire');
  const clusters: { x: number; z: number; r: number }[] = [
    { x: POND.x, z: POND.z, r: POND.r + 5 },
    { x: POND.x, z: POND.z, r: POND.r + 1 },
    { x: -50, z: 12, r: 12 },
    { x: fire.x, z: fire.z + 2, r: 9 },
    ...HANGOUTS.filter((h) => h.kind === 'meadow').map((h) => ({ x: h.x, z: h.z, r: 10 })),
  ];
  interface Firefly { cx: number; cz: number; ox: number; oz: number; h: number; ph: number; period: number; thr: number; gy: number }
  const ffs: Firefly[] = [];
  for (let i = 0; i < FF; i++) {
    const c = clusters[i % clusters.length];
    const a = rng() * TAU, r = Math.sqrt(rng()) * c.r;
    const ox = Math.cos(a) * r, oz = Math.sin(a) * r;
    ffs.push({ cx: c.x, cz: c.z, ox, oz, h: 0.4 + rng() * 1.9, ph: rng(), period: 2.5 + rng() * 3.5, thr: rng(), gy: Math.max(W + 0.1, heightAt(c.x + ox, c.z + oz)) });
  }
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion(), _c = new THREE.Color();
  const _qi = new THREE.Quaternion();
  let ffOn = 0;
  function updateFireflies(time: number, act: Activity) {
    let n = 0;
    ffOn = 0;
    if (act.fireflies > 0.01) {
      _q.copy(cam.quaternion);
      for (const f of ffs) {
        if (f.thr > act.fireflies) continue;
        const t = time * 0.25 + f.ph * 40;
        const x = f.cx + f.ox + Math.sin(t * 0.9) * 0.9 + Math.sin(t * 2.3) * 0.25;
        const z = f.cz + f.oz + Math.cos(t * 0.7) * 0.9 + Math.cos(t * 2.1) * 0.25;
        const y = f.gy + f.h + Math.sin(t * 1.1) * 0.35;
        if ((x - player.x) ** 2 + (z - player.z) ** 2 > 90 * 90) continue;
        const b = blink(time, f.period, f.ph);
        const k = Math.min(1, act.fireflies * 1.5);
        ffOn++;
        core.setMatrixAt(n, _m.compose(_p.set(x, y, z), _qi, _s.set(1, 1, 1)));
        const lvl = (0.5 + b * 2.6) * k;
        core.setColorAt(n, _c.setRGB(lvl * 1.0, lvl * 0.95, lvl * 0.35));
        // glow sprite: world-sized, but eased off right in front of the camera so a close one never floods the view
        const cd = Math.hypot(x - cam.position.x, y - cam.position.y, z - cam.position.z);
        const near = cd < 1 ? 0 : cd > 5 ? 1 : (cd - 1) / 4;
        const gs = (0.28 + b * 0.5) * (0.4 + 0.6 * near);
        glow.setMatrixAt(n, _m.compose(_p, _q, _s.set(gs, gs, gs)));
        const gl = (0.12 + b * 0.6) * k * (0.3 + 0.7 * near);
        glow.setColorAt(n, _c.setRGB(gl * 0.9, gl, gl * 0.35));
        n++;
      }
    }
    core.count = n; glow.count = n;
    core.instanceMatrix.needsUpdate = true; glow.instanceMatrix.needsUpdate = true;
    if (core.instanceColor) core.instanceColor.needsUpdate = true;
    if (glow.instanceColor) glow.instanceColor.needsUpdate = true;
  }

  // ------------------------------------------------------------------ fish
  const fm = fish();
  const fishes = new RigPool(fm.geo, fm.spec, 10);
  interface Jump { on: boolean; x0: number; z0: number; x1: number; z1: number; t: number; dur: number; h: number; tint: number }
  const jumps: Jump[] = [];
  for (let i = 0; i < 4; i++) jumps.push({ on: false, x0: 0, z0: 0, x1: 0, z1: 0, t: 0, dur: 1, h: 0.7, tint: 0 });
  const FISH_TINTS: readonly [number, number, number][] = [[1, 0.58, 0.28], [0.72, 0.8, 0.78], [1, 0.95, 0.9], [0.62, 0.72, 0.5]];
  let nextJump = 2;
  function updateFish(dt: number, time: number, act: Activity) {
    nextJump -= dt * (0.3 + act.fish);
    if (nextJump <= 0) {
      nextJump = 3 + rng() * 7;
      const j = jumps.find((v) => !v.on);
      const dp = Math.hypot(player.x - POND.x, player.z - POND.z);
      const rd = nearestRiver(player.x, player.z, riv);
      let ok = false;
      if (j && dp < 70 && (rd > 45 || rng() < 0.6)) {
        const a = rng() * TAU, r = Math.sqrt(rng()) * POND.r * 0.7;
        j.x0 = POND.x + Math.cos(a) * r; j.z0 = POND.z + Math.sin(a) * r; ok = true;
      } else if (j && rd < 55) {
        const along = (rng() - 0.5) * 24, side = (rng() - 0.5) * RIVER_HALF_WIDTH;
        j.x0 = riv.x + riv.dx * along - riv.dz * side; j.z0 = riv.z + riv.dz * along + riv.dx * side; ok = heightAt(j.x0, j.z0) < W - 0.3;
      }
      if (j && ok) {
        const a = rng() * TAU, l = 0.8 + rng() * 0.8;
        j.x1 = j.x0 + Math.cos(a) * l; j.z1 = j.z0 + Math.sin(a) * l;
        j.on = true; j.t = 0; j.dur = 0.7 + rng() * 0.35; j.h = 0.45 + rng() * 0.5; j.tint = Math.floor(rng() * FISH_TINTS.length);
        fx.ring(j.x0, W, j.z0, 0.5, 1.2);
      }
    }
    for (const j of jumps) {
      if (!j.on) continue;
      const pt = j.t;
      j.t += dt / j.dur;
      if (j.t >= 1) {
        j.on = false;
        fx.ring(j.x1, W, j.z1, 0.8, 1.8);
        fx.ring(j.x1, W, j.z1, 0.45, 1.1);
        critterSound(ctx, 'fish', j.x1, W, j.z1, 40, 1);
        continue;
      }
      if (pt < 0.5 && j.t >= 0.5) critterSound(ctx, 'plop', j.x0, W, j.z0, 25, 0.25, 1.6);
      const k = j.t;
      const x = lerp(j.x0, j.x1, k), z = lerp(j.z0, j.z1, k), y = W - 0.15 + Math.sin(k * Math.PI) * j.h;
      const yaw = Math.atan2(j.x1 - j.x0, j.z1 - j.z0);
      const pitch = -Math.cos(k * Math.PI) * 1.1;
      const slot = fishes.put(x, y, z, yaw, pitch, Math.sin(k * 9) * 0.3, 1.7, 1.7, 1.7, Math.sin(time * 30) * 0.5);
      const c = FISH_TINTS[j.tint];
      fishes.tintAt(slot, c[0], c[1], c[2]);
    }
  }

  // ------------------------------------------------------------------ frogs
  const frm = frog();
  const frogs = new RigPool(frm.geo, frm.spec, 8);
  interface Frog { hx: number; hz: number; x: number; y: number; z: number; yaw: number; state: 'sit' | 'hop' | 'under'; t: number; fx: number; fz: number; tx: number; tz: number; croak: number; nextCroak: number; timer: number; thr: number; toWater: boolean; wx: number; wz: number }
  const frogList: Frog[] = [];
  const shore = (cx: number, cz: number, a: number, r0: number, r1: number): { x: number; z: number; wx: number; wz: number } | null => {
    for (let r = r0; r < r1; r += 0.15) {
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (heightAt(x, z) >= W + 0.04) return { x: x + Math.cos(a) * 0.15, z: z + Math.sin(a) * 0.15, wx: cx + Math.cos(a) * (r - 1.2), wz: cz + Math.sin(a) * (r - 1.2) };
    }
    return null;
  };
  const frogSpots: { x: number; z: number; wx: number; wz: number }[] = [];
  for (let i = 0; i < 7; i++) { const s = shore(POND.x, POND.z, (i / 7) * TAU + 0.4 + rng() * 0.4, POND.r * 0.4, POND.r + 6); if (s) frogSpots.push(s); }
  {
    const bridge = structure('bridge');
    nearestRiver(bridge.x, bridge.z + 10, riv);
    for (const side of [-1, 1]) {
      const a = Math.atan2(riv.dx * side, -riv.dz * side);
      const s = shore(riv.x, riv.z, a, 0, RIVER_HALF_WIDTH + 6);
      if (s) frogSpots.push(s);
    }
  }
  for (let i = 0; i < Math.min(8, frogSpots.length); i++) {
    const s = frogSpots[i];
    const cx = i < 7 ? POND.x : s.wx, cz = i < 7 ? POND.z : s.wz;
    frogList.push({ hx: s.x, hz: s.z, x: s.x, y: heightAt(s.x, s.z), z: s.z, yaw: Math.atan2(cx - s.x, cz - s.z) + Math.PI + (rng() - 0.5) * 1.6, state: 'sit', t: 0, fx: 0, fz: 0, tx: 0, tz: 0, croak: 0, nextCroak: 2 + rng() * 8, timer: 0, thr: rng(), toWater: false, wx: s.wx, wz: s.wz });
  }
  function hopTo(fr: Frog, x: number, z: number, water: boolean) {
    fr.state = 'hop'; fr.t = 0; fr.fx = fr.x; fr.fz = fr.z; fr.tx = x; fr.tz = z; fr.toWater = water;
    fr.yaw = Math.atan2(x - fr.x, z - fr.z);
  }
  function updateFrogs(dt: number, time: number, act: Activity) {
    for (const fr of frogList) {
      const want = fr.thr < act.frogs;
      const pd = Math.hypot(player.x - fr.x, player.z - fr.z);
      if (fr.state === 'under') {
        fr.timer -= dt;
        if (fr.timer <= 0 && want && pd > 4) {
          fr.state = 'sit'; fr.x = fr.hx; fr.z = fr.hz; fr.y = heightAt(fr.x, fr.z);
          fx.ring(fr.wx, W, fr.wz, 0.35, 1);
        }
        continue;
      }
      if (fr.state === 'sit') {
        if (!want || pd < 2.4) { hopTo(fr, fr.wx, fr.wz, true); continue; }
        fr.nextCroak -= dt * (0.15 + act.croak);
        if (fr.nextCroak <= 0) {
          fr.nextCroak = 3 + rng() * 9;
          fr.croak = 1;
          critterSound(ctx, 'ribbit', fr.x, fr.y + 0.1, fr.z, 35, 0.8, 0.85 + fr.thr * 0.35);
        }
        if (rng() < dt * 0.04) {
          const a = rng() * TAU;
          const nx = fr.hx + Math.cos(a) * 0.5, nz = fr.hz + Math.sin(a) * 0.5;
          if (heightAt(nx, nz) >= W + 0.03) hopTo(fr, nx, nz, false);
        }
      } else if (fr.state === 'hop') {
        fr.t += dt / (fr.toWater ? 0.5 : 0.35);
        const k = Math.min(1, fr.t);
        fr.x = lerp(fr.fx, fr.tx, k); fr.z = lerp(fr.fz, fr.tz, k);
        const g = Math.max(W - 0.1, heightAt(fr.x, fr.z));
        fr.y = g + Math.sin(k * Math.PI) * (fr.toWater ? 0.45 : 0.22);
        if (k >= 1) {
          if (fr.toWater) {
            fr.state = 'under'; fr.timer = 6 + rng() * 10;
            fx.ring(fr.tx, W, fr.tz, 0.6, 1.4);
            critterSound(ctx, 'plop', fr.tx, W, fr.tz, 30, 0.9);
          } else { fr.state = 'sit'; fr.hx = fr.x; fr.hz = fr.z; }
        }
      }
      fr.croak = Math.max(0, fr.croak - dt * 0.9);
      const pouch = fr.croak > 0 ? Math.max(0, Math.sin(fr.croak * Math.PI * 3)) : 0;
      const kick = fr.state === 'hop' ? Math.sin(Math.min(1, fr.t) * Math.PI) * 1.2 : 0;
      const breathe = 1 + Math.sin(time * 2 + fr.thr * 9) * 0.03;
      const s = 2.1;
      const slot = frogs.put(fr.x, fr.y, fr.z, fr.yaw, fr.state === 'hop' ? -0.4 * Math.sin(Math.min(1, fr.t) * Math.PI) : 0, 0, s, s * breathe, s, pouch, 0, kick);
      frogs.tintAt(slot, 0.85 + fr.thr * 0.3, 1, 0.8 + fr.thr * 0.2);
      if (fr.state === 'sit') fx.shadow(fr.x, fr.y, fr.z, 0.13 * s);
    }
  }

  // ------------------------------------------------------------------ rabbits + squirrels
  const rm = rabbit(), sm = squirrel();
  const rabbits = new RigPool(rm.geo, rm.spec, 6);
  const squirrels = new RigPool(sm.geo, sm.spec, 3);
  interface Hopper {
    squirrel: boolean; hx: number; hz: number; x: number; y: number; z: number; yaw: number;
    state: 'idle' | 'hop' | 'hidden' | 'up';
    t: number; dur: number; h: number; fx: number; fz: number; tx: number; tz: number;
    timer: number; flee: number; nib: number; earL: number; earR: number; tint: number; thr: number; show: number;
  }
  const hoppers: Hopper[] = [];
  const homes = sampleSpots(7, 80, 3, 30, rng, 10);
  for (let i = 0; i < 8; i++) {
    const h = homes[Math.floor(rng() * homes.length)] ?? { x: 20 + i, z: 20 };
    hoppers.push({ squirrel: i >= 6, hx: h.x, hz: h.z, x: h.x, y: heightAt(h.x, h.z), z: h.z, yaw: rng() * TAU, state: 'hidden', t: 0, dur: 0.3, h: 0.2, fx: 0, fz: 0, tx: 0, tz: 0, timer: rng() * 3, flee: 0, nib: 0, earL: 0, earR: 0, tint: i % RABBIT_TINTS.length, thr: rng(), show: 0 });
  }
  function hop(h: Hopper, dist: number, dir: number, dur: number, height: number): boolean {
    for (let k = 0; k < 6; k++) {
      const a = dir + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.55;
      const nx = h.x + Math.sin(a) * dist, nz = h.z + Math.cos(a) * dist;
      if (!openGround(ctx, nx, nz, 0.25)) continue;
      h.state = 'hop'; h.t = 0; h.dur = dur; h.h = height; h.fx = h.x; h.fz = h.z; h.tx = nx; h.tz = nz; h.yaw = a;
      return true;
    }
    return false;
  }
  function updateHoppers(dt: number, time: number, act: Activity) {
    for (const h of hoppers) {
      const want = h.thr < (h.squirrel ? act.squirrels : act.rabbits);
      const pdx = h.x - player.x, pdz = h.z - player.z, pd = Math.hypot(pdx, pdz);
      if (h.state === 'hidden') {
        h.show = Math.max(0, h.show - dt * 2);
        h.timer -= dt;
        if (want && h.timer <= 0 && Math.hypot(h.hx - player.x, h.hz - player.z) > 16 && openGround(ctx, h.hx, h.hz, 0.3)) {
          h.state = 'idle'; h.x = h.hx; h.z = h.hz; h.timer = 1 + rng() * 2;
        } else if (h.timer <= 0) h.timer = 3;
        if (h.show <= 0) continue;
      } else h.show = Math.min(1, h.show + dt * 2);
      if (h.state !== 'hidden' && !want && (pd > 25 || h.flee <= 0) && h.state === 'idle') { h.state = 'hidden'; h.timer = 5 + rng() * 10; }
      const scared = pd < (ctx.player.speed > 6 ? 10 : 6.5);
      if (scared && h.flee <= 0 && h.state !== 'hidden') { h.flee = 5 + Math.floor(rng() * 4); if (h.squirrel) critterSound(ctx, 'squeak', h.x, h.y + 0.2, h.z, 20, 0.9); }
      if (h.state === 'hop') {
        h.t += dt / h.dur;
        const k = Math.min(1, h.t);
        h.x = lerp(h.fx, h.tx, k); h.z = lerp(h.fz, h.tz, k);
        h.y = groundY(ctx, h.x, h.z) + Math.sin(k * Math.PI) * h.h;
        if (k >= 1) {
          h.state = 'idle';
          h.timer = h.flee > 0 ? 0.02 : h.squirrel ? 0.4 + rng() * 2.5 : 0.8 + rng() * 3.5;
          if (h.flee > 0) h.flee--;
          if (!h.squirrel && pd < 22) critterSound(ctx, 'hop', h.x, h.y, h.z, 14, 0.5);
          if (h.flee === 0 && pd > 12) { h.hx = h.x; h.hz = h.z; }
        }
      } else if (h.state === 'idle' || h.state === 'up') {
        h.y = groundY(ctx, h.x, h.z);
        h.timer -= dt;
        if (h.timer <= 0) {
          if (h.flee > 0) {
            const away = Math.atan2(pdx, pdz) + (rng() - 0.5) * 0.7;
            if (h.squirrel) hop(h, 1.1, away, 0.16, 0.12);
            else hop(h, 1.0 + rng() * 0.4, away, 0.3, 0.32);
          } else if (!h.squirrel && rng() < 0.2) { h.state = h.state === 'up' ? 'idle' : 'up'; h.timer = 1.5 + rng() * 2.5; }
          else if (h.squirrel && rng() < 0.3) {
            h.state = h.state === 'up' ? 'idle' : 'up'; h.timer = 0.8 + rng() * 1.5;
            if (h.state === 'up' && rng() < 0.4) critterSound(ctx, 'squeak', h.x, h.y + 0.2, h.z, 18, 0.6, 1.1);
          } else {
            // wander around home, drifting back toward it
            const home = Math.atan2(h.hx - h.x, h.hz - h.z), far = Math.hypot(h.hx - h.x, h.hz - h.z) > 5;
            const dir = far ? home + (rng() - 0.5) : rng() * TAU;
            const ok = h.squirrel ? hop(h, 0.5 + rng() * 0.4, dir, 0.14, 0.1) : hop(h, 0.35 + rng() * 0.3, dir, 0.26, 0.14);
            if (!ok) h.timer = 0.5;
          }
        }
      }
      // little idle motions
      h.nib = h.state === 'idle' && !h.squirrel ? 0.45 + Math.max(0, Math.sin(time * 9 + h.thr * 20)) * 0.15 : damp(h.nib, 0, 8, dt);
      if (rng() < dt * 0.8) h.earL = 0.5; if (rng() < dt * 0.8) h.earR = 0.5;
      h.earL = damp(h.earL, 0, 6, dt); h.earR = damp(h.earR, 0, 6, dt);
      const hopK = h.state === 'hop' ? Math.sin(Math.min(1, h.t) * Math.PI) : 0;
      const sink = h.state === 'hidden' ? (1 - h.show) * -0.25 : 0;
      const s = (h.squirrel ? 1.55 : 1.6) * (0.3 + 0.7 * h.show);
      const up = h.state === 'up' ? (h.squirrel ? -0.9 : -0.55) : 0;
      if (h.squirrel) {
        const tail = h.state === 'up' ? Math.sin(time * 12) * 0.25 : hopK * 0.6;
        squirrels.put(h.x, h.y + sink, h.z, h.yaw, up - hopK * 0.3, 0, s, s * (1 + hopK * 0.15), s * (1 + hopK * 0.2), tail, up ? 0.5 : 0.2, 0, 0);
      } else {
        const slot = rabbits.put(h.x, h.y + sink, h.z, h.yaw, up - hopK * 0.25, 0, s, s * (1 - hopK * 0.08 + (up ? 0.08 : 0)), s * (1 + hopK * 0.25), 0, up ? -0.4 : h.nib * (h.flee > 0 ? 0 : 1), h.earL + (h.flee > 0 ? -0.5 : 0), h.earR + (h.flee > 0 ? -0.5 : 0));
        const c = RABBIT_TINTS[h.tint];
        rabbits.tintAt(slot, c[0], c[1], c[2]);
      }
      if (h.show > 0.5) fx.shadow(h.x, groundY(ctx, h.x, h.z), h.z, (h.squirrel ? 0.12 : 0.2) * s * (1 - hopK * 0.3), 1.4, h.yaw);
    }
  }

  ctx.scene.add(butterflies.mesh, dragons.mesh, core, glow, fishes.mesh, frogs.mesh, rabbits.mesh, squirrels.mesh);
  const pools = [butterflies, dragons, fishes, frogs, rabbits, squirrels];

  return {
    meshes: [butterflies.mesh, dragons.mesh, core, glow, fishes.mesh, frogs.mesh, rabbits.mesh, squirrels.mesh],
    update(f, act) {
      const dt = f.dt;
      for (const p of pools) p.begin();
      updateButterflies(dt, f.time, act);
      updateDragons(dt, f.time, act);
      updateFireflies(f.time, act);
      updateFish(dt, f.time, act);
      updateFrogs(dt, f.time, act);
      updateHoppers(dt, f.time, act);
      for (const p of pools) p.end();
    },
    stats: () => ({ butterflies: butterflies.size, dragonflies: dragons.size, fireflies: ffOn, fish: fishes.size, frogs: frogs.size, rabbits: rabbits.size, squirrels: squirrels.size }),
    dispose() {
      ctx.scene.remove(butterflies.mesh, dragons.mesh, core, glow, fishes.mesh, frogs.mesh, rabbits.mesh, squirrels.mesh);
      for (const p of pools) p.dispose();
      core.geometry.dispose(); glow.geometry.dispose(); coreMat.dispose(); glowMat.dispose();
    },
  };
}
