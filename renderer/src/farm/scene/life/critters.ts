/**
 * Small valley life: butterflies over meadows and fields, dragonflies darting over the pond, fireflies on dry
 * nights, koi under the pond and fish jumping in the pond and river, frogs on the pond bank, rabbits and squirrels
 * in the meadows. Motion comes from `critterAnim.ts` (the same loops the gallery flipbooks show), behaviour from
 * small state machines here and in `mood.ts`. One instanced draw call per kind (fireflies: core + glow).
 * Zero allocation per frame.
 */
import * as THREE from 'three';
import type { FrameInfo, SceneCtx } from '../context.ts';
import { HANGOUTS, POND, RIVER, RIVER_HALF_WIDTH, WORLD, heightAt, structure } from '../../world/map.ts';
import { seeded } from '../../../core/rng.ts';
import { RigPool } from './rig.ts';
import { butterfly, dragonfly, fish, frog, glowTexture, rabbit, squirrel } from './models.ts';
import { body, butterflyWings, dragonWings, fishWave, frogIdle, frogJump, rabbitHop, rabbitIdle, squirrelBound, squirrelTail } from './critterAnim.ts';
import type { RabbitIdle } from './critterAnim.ts';
import { BUTTERFLIES, DRAGONS, FISH, RABBITS } from './palette.ts';
import { Wariness } from './mood.ts';
import type { Activity } from './schedule.ts';
import { blink } from './schedule.ts';
import { TAU, clamp, critterSound, damp, dampAngle, groundY, lerp, openGround, sampleSpots, smooth01, wrap } from './util.ts';
import type { Fx } from './util.ts';

export interface Critters {
  meshes: THREE.Object3D[];
  update(f: FrameInfo, act: Activity): void;
  stats(): Record<string, number>;
  dispose(): void;
}

type C3 = [number, number, number];
const BFLY = Object.values(BUTTERFLIES);
const DFLY = Object.values(DRAGONS);
const FISHES = Object.values(FISH);
const RAB: C3[] = Object.values(RABBITS);

const CH = new Float32Array(12);
const BD = body();

/** put one rigged critter: world transform ⊕ the loop's body transform, all 12 channels */
function emit(pool: RigPool, x: number, y: number, z: number, yaw: number, pitch: number, roll: number, s: number): number {
  const slot = pool.put(x, y + BD.y * s, z, yaw, pitch + BD.pitch, roll + BD.roll, s * BD.sx, s * BD.sy, s * BD.sz,
    CH[0], CH[1], CH[2], CH[3], CH[4], CH[5], CH[6], CH[7]);
  pool.chC(slot, CH[8], CH[9], CH[10], CH[11]);
  return slot;
}
const tints = (pool: RigPool, slot: number, c: readonly [C3, C3]) => { pool.tintAt(slot, c[0][0], c[0][1], c[0][2]); pool.tint2At(slot, c[1][0], c[1][1], c[1][2]); };
const easeInOut = (k: number) => (k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k));

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
  /** the nearest threat (player or a running dog): distance and speed, for wariness */
  const threat = { d: 0, v: 0, x: 0, z: 0 };
  const nearestThreat = (x: number, z: number) => {
    const pd = Math.hypot(player.x - x, player.z - z);
    // the dog counts from further away when he's running
    const dd = Math.hypot(fx.dogX - x, fx.dogZ - z) * (fx.dogSpeed > 2 ? 0.8 : 1.6);
    if (dd < pd) { threat.d = dd; threat.v = fx.dogSpeed * 1.4; threat.x = fx.dogX; threat.z = fx.dogZ; }
    else { threat.d = pd; threat.v = ctx.player.speed; threat.x = player.x; threat.z = player.z; }
  };

  // ------------------------------------------------------------------ butterflies
  const bm = butterfly();
  const butterflies = new RigPool(bm.geo, bm.spec, 18, { side: THREE.DoubleSide });
  const FLY = 0, LAND = 1, REST = 2;
  interface Fly {
    on: boolean; x: number; y: number; z: number; vx: number; vz: number; ax: number; az: number; ph: number; tint: number;
    state: number; rest: number; nextRest: number; yaw: number; roll: number; fade: number; leaving: boolean; tx: number; ty: number; tz: number; lift: number;
  }
  const flies: Fly[] = [];
  for (let i = 0; i < 18; i++) flies.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vz: 0, ax: 0, az: 0, ph: rng() * 100, tint: i % BFLY.length, state: FLY, rest: 0, nextRest: 4 + rng() * 10, yaw: 0, roll: 0, fade: 0, leaving: false, tx: 0, ty: 0, tz: 0, lift: 0 });
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
  const spawnFly = (b: Fly, x: number, z: number) => {
    b.on = true; b.leaving = false; b.fade = 0; b.ax = x; b.az = z; b.x = x; b.z = z; b.y = groundY(ctx, x, z) + 0.8;
    b.state = FLY; b.nextRest = 3 + rng() * 8; b.vx = b.vz = 0;
  };

  function updateButterflies(dt: number, time: number, act: Activity) {
    const want = Math.round(act.butterflies * 16);
    let on = 0;
    for (const b of flies) if (b.on && !b.leaving) on++;
    for (const b of flies) {
      if (!b.on && on < want && rng() < dt * 2 && pickNear(6, 32, tmpXZ)) {
        // a new patch of butterflies: 1–3 share an anchor
        spawnFly(b, tmpXZ.x, tmpXZ.z); on++;
        for (const o of flies) if (!o.on && on < want && rng() < 0.5) { spawnFly(o, b.ax + (rng() - 0.5) * 3, b.az + (rng() - 0.5) * 3); on++; }
      }
      if (!b.on) continue;
      const far = Math.hypot(b.x - player.x, b.z - player.z) > 55;
      if ((on > want || far) && !b.leaving) { b.leaving = true; on--; if (b.state !== FLY) b.state = FLY; }
      b.fade = b.leaving ? b.fade - dt * 0.6 : Math.min(1, b.fade + dt * 0.8);
      if (b.fade <= 0 && b.leaving) { b.on = false; continue; }
      const g = groundY(ctx, b.x, b.z);
      const t = time + b.ph;
      const pdx = b.x - player.x, pdz = b.z - player.z, pd = Math.hypot(pdx, pdz);
      let pitch = -0.2;
      BD.y = 0; BD.pitch = 0; BD.roll = 0; BD.sx = BD.sy = BD.sz = 1;
      if (b.state === REST) {
        // basking on a flower head: wings slowly open and close; startled off by a close approach
        b.rest -= dt;
        butterflyWings(t, 'rest', b.ph, CH);
        pitch = 0.08;
        b.roll = damp(b.roll, 0, 6, dt);
        if (pd < 1.5 || b.rest <= 0 || Math.hypot(fx.dogX - b.x, fx.dogZ - b.z) < 1.2) { b.state = FLY; b.nextRest = 6 + rng() * 14; b.vx = pdx / (pd || 1) * 0.8; b.vz = pdz / (pd || 1) * 0.8; }
      } else {
        const lift = butterflyWings(t, 'fly', b.ph, CH);
        let tx: number, tz: number, ty: number;
        if (b.state === LAND) {
          tx = b.tx; tz = b.tz;
          const d = Math.hypot(tx - b.x, tz - b.z);
          ty = b.ty + Math.min(0.5, d * 0.4);
          b.rest -= dt;
          if ((d < 0.05 && Math.abs(b.y - b.ty) < 0.03) || b.rest < 0) { b.state = REST; b.rest = 3 + rng() * 7; b.x = tx; b.z = tz; b.y = b.ty; b.vx = b.vz = 0; }
        } else {
          b.nextRest -= dt;
          if (b.nextRest <= 0 && !b.leaving) {
            // pick a flower nearby, at a flower's height
            const a = rng() * TAU, r = 0.4 + rng() * 1.6;
            b.tx = b.x + Math.cos(a) * r; b.tz = b.z + Math.sin(a) * r;
            b.ty = groundY(ctx, b.tx, b.tz) + 0.14 + rng() * 0.3;
            if (openGround(ctx, b.tx, b.tz, 0.1) && heightAt(b.tx, b.tz) > W + 0.05) { b.state = LAND; b.rest = 5; } else b.nextRest = 1;
          }
          const u = time * 0.55 + b.ph;
          tx = b.ax + Math.sin(u * 0.7) * 2.6 + Math.sin(u * 1.9) * 1.1;
          tz = b.az + Math.cos(u * 0.6) * 2.6 + Math.cos(u * 1.7) * 1.1;
          ty = g + 0.75 + Math.sin(u * 1.3) * 0.4 + (b.leaving ? (1 - b.fade) * 6 : 0);
          if (pd < 2) { tx += (pdx / (pd || 1)) * 3; tz += (pdz / (pd || 1)) * 3; }
        }
        const lim = b.state === LAND ? 0.9 : 1.6;
        b.vx = damp(b.vx, clamp((tx - b.x) * (b.state === LAND ? 2.2 : 0.9), -lim, lim), 3, dt);
        b.vz = damp(b.vz, clamp((tz - b.z) * (b.state === LAND ? 2.2 : 0.9), -lim, lim), 3, dt);
        b.x += b.vx * dt; b.z += b.vz * dt;
        // each downstroke lifts; between beats it sinks: the bobbing, erratic butterfly flight
        b.lift = damp(b.lift, lift, 20, dt);
        b.y = damp(b.y, ty, 2.5, dt) + (b.lift - 0.35) * dt * 0.9;
        if (b.y < g + 0.08) b.y = g + 0.08;
        const sp = Math.abs(b.vx) + Math.abs(b.vz);
        if (sp > 0.05) {
          const want = Math.atan2(b.vx, b.vz);
          b.roll = damp(b.roll, clamp(-wrap(want - b.yaw) * 1.5, -0.5, 0.5), 5, dt);
          b.yaw = dampAngle(b.yaw, want, 5, dt);
        }
      }
      const s = 1.6 * b.fade;
      const slot = emit(butterflies, b.x, b.y, b.z, b.yaw, pitch, b.roll, s);
      tints(butterflies, slot, BFLY[b.tint]);
    }
    CH.fill(0);
  }

  // ------------------------------------------------------------------ dragonflies
  const dm = dragonfly();
  const dragons = new RigPool(dm.geo, dm.spec, 8, { side: THREE.DoubleSide });
  const HOVER = 0, TURN = 1, DART = 2, PERCH = 3;
  interface Dragon {
    x: number; y: number; z: number; fx: number; fy: number; fz: number; tx: number; ty: number; tz: number;
    state: number; t: number; dur: number; timer: number; yaw: number; yawTo: number; pitch: number; ph: number; tint: number; river: boolean; fade: number; perch: boolean;
  }
  const dfs: Dragon[] = [];
  for (let i = 0; i < 8; i++) dfs.push({ x: POND.x, y: W + 0.6, z: POND.z, fx: 0, fy: 0, fz: 0, tx: POND.x, ty: W + 0.6, tz: POND.z, state: HOVER, t: 0, dur: 0.3, timer: rng() * 2, yaw: rng() * TAU, yawTo: 0, pitch: 0, ph: rng() * TAU, tint: i % DFLY.length, river: i >= 5, fade: 0, perch: false });
  const riv = { x: 0, z: 0, dx: 0, dz: 1 };
  // perches: the tops of the cattail heads along the banks (the shore builds them from a fixed seed, so the stem
  // tops can be recovered from the instance matrices once the shore is in the scene)
  const perches: number[] = [];
  let perchScan = 0;
  function scanPerches(dt: number) {
    if (perches.length || (perchScan -= dt) > 0) return;
    perchScan = 3;
    const m = ctx.scene.getObjectByName('cattails') as THREE.InstancedMesh | undefined;
    if (!m || !(m as THREE.InstancedMesh).isInstancedMesh) return;
    const r = seeded('cattail:2');
    for (let i = 0; i < 5; i++) { r(); r(); }
    const tips: number[] = [];
    for (let i = 0; i < 3; i++) { const h = 1.35 + r() * 0.45, ox = (r() - 0.5) * 0.25, oz = (r() - 0.5) * 0.25; tips.push(ox, h - 0.035, oz); }
    m.updateWorldMatrix(true, false);
    for (let i = 0; i < m.count; i++) {
      m.getMatrixAt(i, _m); _m.premultiply(m.matrixWorld);
      for (let k = 0; k < tips.length; k += 3) { _p.set(tips[k], tips[k + 1], tips[k + 2]).applyMatrix4(_m); perches.push(_p.x, _p.y, _p.z); }
    }
  }
  /** a cattail head within `r` of (x, z) → d.tx/ty/tz */
  const pickPerch = (d: Dragon, r: number): boolean => {
    const n = perches.length / 3;
    for (let k = 0; k < 16 && n > 0; k++) {
      const i = Math.floor(rng() * n) * 3;
      if (Math.hypot(perches[i] - d.x, perches[i + 2] - d.z) >= r) continue;
      // one dragonfly per cattail clump
      let taken = false;
      for (const o of dfs) if (o !== d && o.perch && Math.hypot(o.tx - perches[i], o.tz - perches[i + 2]) < 0.6) taken = true;
      if (taken) continue;
      d.tx = perches[i]; d.ty = perches[i + 1]; d.tz = perches[i + 2]; return true;
    }
    return false;
  };
  function updateDragons(dt: number, time: number, act: Activity) {
    scanPerches(dt);
    const rd = nearestRiver(player.x, player.z, riv);
    for (let i = 0; i < dfs.length; i++) {
      const d = dfs[i];
      const want = (i + 0.5) / dfs.length < act.dragonflies * (d.river ? (rd < 45 ? 1 : 0) : 1);
      d.fade = want ? Math.min(1, d.fade + dt) : Math.max(0, d.fade - dt);
      if (d.fade <= 0) {
        if (d.river) { d.x = riv.x; d.z = riv.z; d.tx = d.x; d.tz = d.z; d.y = W + 0.6; }
        d.state = HOVER;
        continue;
      }
      d.timer -= dt;
      let jx = 0, jy = 0;
      switch (d.state) {
        case HOVER:
        case PERCH: {
          const spooked = d.state === PERCH && Math.hypot(player.x - d.x, player.z - d.z) < 2.2;
          if (d.state === HOVER) { jx = Math.sin(time * 2.1 + d.ph) * 0.02; jy = Math.sin(time * 3.3 + d.ph) * 0.03; }
          if (d.timer > 0 && !spooked) break;
          // next: dart somewhere over the water, or (sometimes) to a cattail head nearby
          d.perch = !spooked && rng() < 0.25 && (pickPerch(d, 9) || pickPerch(d, 30));
          const perchY = d.ty;
          if (d.perch) { /* target set by pickPerch */ } else if (d.river) {
            const along = (rng() - 0.5) * 16, side = (rng() - 0.5) * RIVER_HALF_WIDTH * 1.4;
            d.tx = riv.x + riv.dx * along - riv.dz * side; d.tz = riv.z + riv.dz * along + riv.dx * side;
          } else {
            const a = rng() * TAU, r = Math.sqrt(rng()) * POND.r * 0.8;
            d.tx = POND.x + Math.cos(a) * r; d.tz = POND.z + Math.sin(a) * r;
          }
          // don't dart further than a few metres at once
          const dx = d.tx - d.x, dz = d.tz - d.z, l = Math.hypot(dx, dz);
          if (l > 5 && !d.perch) { d.tx = d.x + dx / l * 5; d.tz = d.z + dz / l * 5; }
          const gy = Math.max(W, heightAt(d.tx, d.tz));
          d.ty = d.perch ? perchY : gy + 0.3 + rng() * 0.6;
          d.yawTo = Math.atan2(d.tx - d.x, d.tz - d.z);
          d.state = TURN; d.timer = 0.14;
          break;
        }
        case TURN:
          // pivot on the spot first, then go
          d.yaw = dampAngle(d.yaw, d.yawTo, 22, dt);
          jy = Math.sin(time * 3.3 + d.ph) * 0.03;
          if (d.timer <= 0) {
            d.state = DART; d.t = 0; d.fx = d.x; d.fy = d.y + jy; d.fz = d.z;
            d.dur = clamp(Math.hypot(d.tx - d.x, d.tz - d.z) / 4.5, 0.16, 0.7);
          }
          break;
        case DART: {
          d.t += dt / d.dur;
          const k = Math.min(1, d.t), e = easeInOut(k);
          d.x = lerp(d.fx, d.tx, e); d.z = lerp(d.fz, d.tz, e); d.y = lerp(d.fy, d.ty, e);
          d.yaw = dampAngle(d.yaw, d.yawTo, 22, dt);
          if (k >= 1) {
            d.state = d.perch ? PERCH : HOVER;
            d.timer = d.perch ? 3 + rng() * 6 : 0.4 + rng() * 2.2;
          }
          break;
        }
      }
      // nose down to accelerate, nose up to brake: the dart's body language
      const pt = d.state === DART ? Math.sin(Math.min(1, d.t) * TAU) * 0.4 : 0;
      d.pitch = damp(d.pitch, pt, 18, dt);
      const perched = d.state === PERCH;
      dragonWings(time, d.ph, perched, CH);
      CH[2] += -d.pitch * 0.35 + (perched ? -0.12 : 0);
      BD.y = 0; BD.pitch = 0; BD.roll = 0; BD.sx = BD.sy = BD.sz = 1;
      const s = 1.8 * d.fade;
      const slot = emit(dragons, d.x + jx, d.y + jy, d.z, d.yaw, d.pitch, 0, s);
      tints(dragons, slot, DFLY[d.tint]);
    }
    CH.fill(0);
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
  interface Firefly { cx: number; cz: number; ox: number; oz: number; h: number; ph: number; period: number; thr: number; gy: number; rise: number }
  const ffs: Firefly[] = [];
  for (let i = 0; i < FF; i++) {
    const c = clusters[i % clusters.length];
    const a = rng() * TAU, r = Math.sqrt(rng()) * c.r;
    const ox = Math.cos(a) * r, oz = Math.sin(a) * r;
    ffs.push({ cx: c.x, cz: c.z, ox, oz, h: 0.4 + rng() * 1.9, ph: rng(), period: 2.5 + rng() * 3.5, thr: rng(), gy: Math.max(W + 0.1, heightAt(c.x + ox, c.z + oz)), rise: 0 });
  }
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion(), _c = new THREE.Color();
  const _qi = new THREE.Quaternion();
  let ffOn = 0;
  function updateFireflies(dt: number, time: number, act: Activity) {
    let n = 0;
    ffOn = 0;
    if (act.fireflies > 0.01) {
      _q.copy(cam.quaternion);
      for (const f of ffs) {
        if (f.thr > act.fireflies) continue;
        // a slow, lazy drift; each flash comes with a little climb (the male's courtship "J"), then a sink
        const t = time * 0.16 + f.ph * 40;
        const b = blink(time, f.period, f.ph);
        f.rise = b > 0.3 ? Math.min(0.25, f.rise + dt * 0.35) : Math.max(0, f.rise - dt * 0.06);
        const x = f.cx + f.ox + Math.sin(t * 0.9) * 0.9 + Math.sin(t * 2.3) * 0.2;
        const z = f.cz + f.oz + Math.cos(t * 0.7) * 0.9 + Math.cos(t * 2.1) * 0.2;
        const y = f.gy + f.h + Math.sin(t * 1.1) * 0.3 + f.rise;
        if ((x - player.x) ** 2 + (z - player.z) ** 2 > 90 * 90) continue;
        const k = Math.min(1, act.fireflies * 1.5);
        ffOn++;
        core.setMatrixAt(n, _m.compose(_p.set(x, y, z), _qi, _s.set(1, 1, 1)));
        const lvl = (0.35 + b * 2.8) * k;
        core.setColorAt(n, _c.setRGB(lvl * 1.0, lvl * 0.95, lvl * 0.35));
        // glow sprite: world-sized, but eased off right in front of the camera so a close one never floods the view
        const cd = Math.hypot(x - cam.position.x, y - cam.position.y, z - cam.position.z);
        const near = cd < 1 ? 0 : cd > 5 ? 1 : (cd - 1) / 4;
        const gs = (0.22 + b * 0.55) * (0.4 + 0.6 * near);
        glow.setMatrixAt(n, _m.compose(_p, _q, _s.set(gs, gs, gs)));
        const gl = (0.08 + b * 0.65) * k * (0.3 + 0.7 * near);
        glow.setColorAt(n, _c.setRGB(gl * 0.9, gl, gl * 0.35));
        n++;
      }
    }
    core.count = n; glow.count = n;
    core.instanceMatrix.needsUpdate = true; glow.instanceMatrix.needsUpdate = true;
    if (core.instanceColor) core.instanceColor.needsUpdate = true;
    if (glow.instanceColor) glow.instanceColor.needsUpdate = true;
  }

  // ------------------------------------------------------------------ fish: koi under the pond, jumpers
  const fm = fish();
  const fishes = new RigPool(fm.geo, fm.spec, 10);
  interface Koi { x: number; z: number; y: number; yaw: number; turn: number; speed: number; want: number; dash: number; ph: number; tint: number; depth: number; kiss: number; up: number }
  const kois: Koi[] = [];
  for (let i = 0; i < 4; i++) {
    const a = rng() * TAU, r = Math.sqrt(rng()) * POND.r * 0.45;
    kois.push({ x: POND.x + Math.cos(a) * r, z: POND.z + Math.sin(a) * r, y: W - 0.2, yaw: rng() * TAU, turn: 0, speed: 0.3, want: 0.3, dash: 0, ph: rng() * 50, tint: i % 2, depth: 0.1 + rng() * 0.03, kiss: 4 + rng() * 10, up: 0 });
  }
  interface Jump { on: boolean; x0: number; z0: number; x1: number; z1: number; t: number; dur: number; h: number; tint: number; spin: number; out: boolean }
  const jumps: Jump[] = [];
  for (let i = 0; i < 4; i++) jumps.push({ on: false, x0: 0, z0: 0, x1: 0, z1: 0, t: 0, dur: 1, h: 0.7, tint: 0, spin: 0, out: false });
  let nextJump = 2;
  function updateKoi(dt: number, time: number) {
    if (Math.hypot(player.x - POND.x, player.z - POND.z) > 60) return;
    for (const k of kois) {
      // lazy wandering turns; stay in deep water; scatter from someone at the edge
      const cx = POND.x - k.x, cz = POND.z - k.z, cd = Math.hypot(cx, cz);
      const pdx = k.x - player.x, pdz = k.z - player.z, pd = Math.hypot(pdx, pdz);
      let steer = Math.sin(time * 0.23 + k.ph) * 0.5 + Math.sin(time * 0.61 + k.ph * 2) * 0.25;
      const ax = k.x + Math.sin(k.yaw) * 0.8, az = k.z + Math.cos(k.yaw) * 0.8;
      if (heightAt(ax, az) > W - 0.3 || cd > POND.r * 0.6) steer = wrap(Math.atan2(cx, cz) - k.yaw) * 2.5;
      if (pd < 2.6 && k.dash <= 0) { k.dash = 1.2; k.yaw = Math.atan2(pdx, pdz) + (rng() - 0.5) * 0.8; }
      k.dash = Math.max(0, k.dash - dt);
      k.turn = damp(k.turn, steer, 2, dt);
      k.yaw += k.turn * dt * (k.dash > 0 ? 0.4 : 1);
      if (rng() < dt * 0.1) k.want = 0.15 + rng() * 0.35;
      k.speed = damp(k.speed, k.dash > 0 ? 1.6 : k.want, k.dash > 0 ? 6 : 1, dt);
      k.x += Math.sin(k.yaw) * k.speed * dt; k.z += Math.cos(k.yaw) * k.speed * dt;
      // now and then one rises and kisses the surface (a little ring at its mouth)
      k.kiss -= dt;
      if (k.kiss <= 0) { k.kiss = 8 + rng() * 14; k.up = 1; }
      if (k.up > 0) {
        const pu = k.up;
        k.up = Math.max(0, k.up - dt / 2.2);
        if (pu > 0.5 && k.up <= 0.5) fx.ring(k.x + Math.sin(k.yaw) * 0.25, W, k.z + Math.cos(k.yaw) * 0.25, 0.3, 1.2);
      }
      const rise = Math.sin(k.up * Math.PI);
      k.y = W - k.depth * (1 - rise * 0.7) + Math.sin(time * 0.4 + k.ph) * 0.02;
      fishWave(time + k.ph, clamp(k.speed / 1.6, 0, 1), CH);
      BD.y = 0; BD.pitch = 0; BD.roll = 0; BD.sx = BD.sy = BD.sz = 1;
      const slot = emit(fishes, k.x, k.y, k.z, k.yaw, -rise * 0.35, -k.turn * 0.15, 1.9);
      tints(fishes, slot, FISHES[k.tint]);
    }
  }
  function updateFish(dt: number, time: number, act: Activity) {
    updateKoi(dt, time);
    nextJump -= dt * (0.3 + act.fish);
    if (nextJump <= 0) {
      nextJump = 3 + rng() * 7;
      let j: Jump | null = null;
      for (const v of jumps) if (!v.on) { j = v; break; }
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
        j.on = true; j.t = 0; j.out = false; j.dur = 0.7 + rng() * 0.35; j.h = 0.45 + rng() * 0.5; j.tint = 1 + Math.floor(rng() * (FISHES.length - 1));
        // some leap straight, some twist right round in the air
        j.spin = rng() < 0.45 ? (rng() < 0.5 ? -TAU : TAU) : (rng() - 0.5) * 0.8;
      }
    }
    for (const j of jumps) {
      if (!j.on) continue;
      const pt = j.t;
      j.t += dt / j.dur;
      if (!j.out && j.t > 0.08) {
        // bursting out: a ring and a spray
        j.out = true;
        fx.ring(j.x0, W, j.z0, 0.5, 1.2);
        fx.drops(j.x0, W + 0.05, j.z0, 8, 1.5, 0.25, W, rng);
      }
      if (j.t >= 1) {
        j.on = false;
        fx.ring(j.x1, W, j.z1, 0.8, 1.8);
        fx.ring(j.x1, W, j.z1, 0.45, 1.1);
        fx.drops(j.x1, W + 0.05, j.z1, 14, 2.2, 0.4, W, rng);
        critterSound(ctx, 'fish', j.x1, W, j.z1, 40, 1);
        continue;
      }
      if (pt < 0.5 && j.t >= 0.5) critterSound(ctx, 'plop', j.x0, W, j.z0, 25, 0.25, 1.6);
      const k = j.t;
      const x = lerp(j.x0, j.x1, k), z = lerp(j.z0, j.z1, k), y = W - 0.15 + Math.sin(k * Math.PI) * j.h;
      const yaw = Math.atan2(j.x1 - j.x0, j.z1 - j.z0);
      const pitch = -Math.cos(k * Math.PI) * 1.1;
      // thrashing out of the water, a stiff arch at the top, thrashing again as it dives
      fishWave(time * 1.3, 1 - Math.sin(k * Math.PI) * 0.7, CH);
      CH[1] += Math.sin(k * Math.PI) * 0.2;
      BD.y = 0; BD.pitch = 0; BD.roll = 0; BD.sx = BD.sy = BD.sz = 1;
      const slot = emit(fishes, x, y, z, yaw, pitch, smooth01(k) * j.spin, 1.7);
      tints(fishes, slot, FISHES[j.tint]);
    }
    CH.fill(0);
  }

  // ------------------------------------------------------------------ frogs
  const frm = frog();
  const frogs = new RigPool(frm.geo, frm.spec, 8);
  interface Frog {
    hx: number; hz: number; x: number; y: number; z: number; yaw: number; state: 'sit' | 'hop' | 'under'; t: number; fx: number; fz: number; tx: number; tz: number;
    croak: number; nextCroak: number; blink: number; nextBlink: number; timer: number; thr: number; toWater: boolean; fromWater: boolean; wx: number; wz: number; h: number;
  }
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
    frogList.push({ hx: s.x, hz: s.z, x: s.x, y: heightAt(s.x, s.z), z: s.z, yaw: Math.atan2(cx - s.x, cz - s.z) + Math.PI + (rng() - 0.5) * 1.6, state: 'sit', t: 0, fx: 0, fz: 0, tx: 0, tz: 0, croak: 9, nextCroak: 2 + rng() * 8, blink: 9, nextBlink: 1 + rng() * 4, timer: 0, thr: rng(), toWater: false, fromWater: false, wx: s.wx, wz: s.wz, h: 0.2 });
  }
  const FROG_S = 2.1;
  function hopTo(fr: Frog, x: number, z: number, water: boolean) {
    fr.state = 'hop'; fr.t = 0; fr.fx = fr.x; fr.fz = fr.z; fr.tx = x; fr.tz = z; fr.toWater = water;
    fr.h = water ? 0.4 : fr.fromWater ? 0.3 : 0.2;
    fr.yaw = Math.atan2(x - fr.x, z - fr.z);
  }
  function updateFrogs(dt: number, time: number, act: Activity) {
    for (const fr of frogList) {
      const want = fr.thr < act.frogs;
      nearestThreat(fr.x, fr.z);
      const pd = threat.d;
      if (fr.state === 'under') {
        fr.timer -= dt;
        if (fr.timer <= 0 && want && pd > 5) {
          // surface in the shallows and hop back up onto the bank
          fr.x = fr.wx; fr.z = fr.wz; fr.y = W - 0.08; fr.fromWater = true;
          fx.ring(fr.wx, W, fr.wz, 0.35, 1);
          hopTo(fr, fr.hx, fr.hz, false);
        } else continue;
      }
      if (fr.state === 'sit') {
        if (!want || pd < 2.4 || (pd < 5 && threat.v > 4)) { fr.fromWater = false; hopTo(fr, fr.wx, fr.wz, true); }
        else {
          fr.nextCroak -= dt * (0.15 + act.croak);
          if (fr.nextCroak <= 0) {
            fr.nextCroak = 3 + rng() * 9;
            fr.croak = 0;
            critterSound(ctx, 'ribbit', fr.x, fr.y + 0.1, fr.z, 35, 0.8, 0.85 + fr.thr * 0.35);
          }
          fr.nextBlink -= dt;
          if (fr.nextBlink <= 0) { fr.nextBlink = 2 + rng() * 5; fr.blink = 0; }
          if (rng() < dt * 0.04) {
            const a = fr.yaw + (rng() - 0.5) * 2.4;
            const nx = fr.hx + Math.sin(a) * 0.5, nz = fr.hz + Math.cos(a) * 0.5;
            if (heightAt(nx, nz) >= W + 0.03) { fr.fromWater = false; hopTo(fr, nx, nz, false); }
          }
        }
      }
      if (fr.state === 'hop') {
        fr.t += dt / (fr.toWater ? 0.55 : 0.42);
        const k = Math.min(1, fr.t);
        // only travel while airborne (the crouch and the landing stay put)
        const air = smooth01((k - 0.1) / 0.8);
        fr.x = lerp(fr.fx, fr.tx, air); fr.z = lerp(fr.fz, fr.tz, air);
        fr.y = Math.max(W - 0.08, heightAt(fr.x, fr.z));
        if (k >= 1) {
          if (fr.toWater) {
            fr.state = 'under'; fr.timer = 6 + rng() * 10;
            fx.ring(fr.tx, W, fr.tz, 0.6, 1.4);
            fx.ring(fr.tx, W, fr.tz, 0.3, 0.9);
            fx.drops(fr.tx, W + 0.03, fr.tz, 10, 1.4, 0.25, W, rng);
            critterSound(ctx, 'plop', fr.tx, W, fr.tz, 30, 0.9);
            continue;
          }
          fr.state = 'sit'; fr.hx = fr.x; fr.hz = fr.z;
          // settle facing the water more often than not
          if (fr.fromWater) fr.yaw += Math.PI + (rng() - 0.5) * 1.2;
          fr.fromWater = false;
        }
      }
      const lt = time + fr.thr * 9;
      if (fr.state === 'hop') frogJump(Math.min(1, fr.t), fr.h / FROG_S, CH, BD);
      else {
        fr.croak += dt; fr.blink += dt;
        // "rib-bit": two quick inflations of the throat sac
        const c = fr.croak < 0.62 ? Math.abs(Math.sin((fr.croak / 0.31) * Math.PI)) : 0;
        const b = fr.blink < 0.22 ? Math.sin((fr.blink / 0.22) * Math.PI) : 0;
        frogIdle(lt, c, b, CH, BD);
      }
      const slot = emit(frogs, fr.x, fr.y, fr.z, fr.yaw, 0, 0, FROG_S);
      frogs.tintAt(slot, 0.85 + fr.thr * 0.3, 1, 0.8 + fr.thr * 0.2);
      fx.shadow(fr.x, fr.y, fr.z, 0.13 * FROG_S * (1 - Math.min(0.5, BD.y * 4)));
    }
    CH.fill(0);
  }

  // ------------------------------------------------------------------ rabbits
  const rm = rabbit(), sm = squirrel();
  const rabbits = new RigPool(rm.geo, rm.spec, 6);
  const squirrels = new RigPool(sm.geo, sm.spec, 3);
  const homes = sampleSpots(7, 80, 3, 30, rng, 10);
  const home = (i: number) => homes[Math.floor(rng() * homes.length)] ?? { x: 20 + i, z: 20 };
  type RState = 'hidden' | 'idle' | 'hop' | 'alert' | 'bolt';
  interface Rabbit {
    hx: number; hz: number; x: number; y: number; z: number; yaw: number; state: RState;
    /** idle activity: 0 graze, 1 groom, 2 sit up and look */
    doing: number; doT: number; hops: number;
    t: number; dur: number; h: number; fx: number; fz: number; tx: number; tz: number;
    timer: number; tint: number; thr: number; show: number; wary: Wariness; pose: RabbitIdle; tail: number; earKickL: number; earKickR: number;
  }
  const rabbitList: Rabbit[] = [];
  for (let i = 0; i < 6; i++) {
    const h = home(i);
    rabbitList.push({
      hx: h.x, hz: h.z, x: h.x, y: heightAt(h.x, h.z), z: h.z, yaw: rng() * TAU, state: 'hidden', doing: 0, doT: 0, hops: 0,
      t: 1, dur: 0.3, h: 0.1, fx: 0, fz: 0, tx: 0, tz: 0, timer: rng() * 3, tint: i % RAB.length, thr: rng(), show: 0,
      wary: new Wariness({ alertAt: 9, boltAt: 4.2, charge: 5.2 }), pose: { nibble: 0, groom: 0, alert: 0, earL: 0, earR: 0, turnL: 0, turnR: 0 }, tail: 0, earKickL: 0, earKickR: 0,
    });
  }
  const RAB_S = 1.5;
  /** start a hop of `dist` toward `dir`, trying a fan of directions around it; false when boxed in */
  function rabbitHopTo(r: Rabbit, dist: number, dir: number, dur: number, h: number): boolean {
    for (let k = 0; k < 6; k++) {
      const a = dir + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.55;
      const nx = r.x + Math.sin(a) * dist, nz = r.z + Math.cos(a) * dist;
      if (!openGround(ctx, nx, nz, 0.25) || heightAt(nx, nz) < W + 0.05) continue;
      r.state = r.state === 'bolt' ? 'bolt' : 'hop'; r.t = 0; r.dur = dur; r.h = h; r.fx = r.x; r.fz = r.z; r.tx = nx; r.tz = nz; r.yaw = a;
      return true;
    }
    return false;
  }
  function updateRabbits(dt: number, time: number, act: Activity) {
    for (const r of rabbitList) {
      const want = r.thr < act.rabbits && !act.shelter;
      if (r.state === 'hidden') {
        r.show = Math.max(0, r.show - dt * 2);
        r.timer -= dt;
        if (want && r.timer <= 0 && Math.hypot(r.hx - player.x, r.hz - player.z) > 16 && openGround(ctx, r.hx, r.hz, 0.3)) {
          r.state = 'idle'; r.x = r.hx; r.z = r.hz; r.timer = 1 + rng() * 2; r.doing = 2; r.doT = 1.5; r.wary.state = 'calm';
        } else if (r.timer <= 0) r.timer = 3;
        if (r.show <= 0) continue;
      } else r.show = Math.min(1, r.show + dt * 2);
      nearestThreat(r.x, r.z);
      const w = r.state === 'hidden' ? 'calm' : r.wary.step(dt, threat.d, threat.v, rng());
      const away = Math.atan2(r.x - threat.x, r.z - threat.z);
      if (w === 'bolt' && r.state !== 'bolt' && r.state !== 'hidden') {
        r.state = 'bolt'; r.timer = 0; r.hops = 0;
        if (r.t < 1) r.timer = (1 - r.t) * r.dur; // finish the current hop first
      } else if (w === 'alert' && (r.state === 'idle')) { r.state = 'alert'; r.earKickL = r.earKickR = 0; }
      else if (w === 'calm' && r.state === 'alert') { r.state = 'idle'; r.doing = 2; r.doT = 1 + rng(); }

      const hopping = (r.state === 'hop' || r.state === 'bolt') && r.t < 1;
      if (hopping) {
        r.t += dt / r.dur;
        const k = Math.min(1, r.t);
        const air = smooth01((k - 0.08) / 0.7);
        r.x = lerp(r.fx, r.tx, air); r.z = lerp(r.fz, r.tz, air);
        r.y = groundY(ctx, r.x, r.z);
        if (k >= 1) {
          if (threat.d < 22) critterSound(ctx, 'hop', r.x, r.y, r.z, 14, r.state === 'bolt' ? 0.7 : 0.4);
          if (r.state === 'hop') { r.state = 'idle'; r.timer = r.hops > 0 ? 0.08 + rng() * 0.25 : 0.8 + rng() * 2; }
          else r.timer = 0.03;
        }
      } else r.y = groundY(ctx, r.x, r.z);

      if (r.state === 'bolt' && !hopping) {
        r.timer -= dt;
        if (r.timer <= 0) {
          r.hops++;
          // zig-zag away, long fast bounds
          if (!rabbitHopTo(r, 1.2 + rng() * 0.5, away + (r.hops % 2 ? 0.35 : -0.35) * rng(), 0.3, 0.32)) r.timer = 0.2;
          else r.t = 0;
        }
        if (w === 'calm' || r.hops > 14) {
          r.state = 'idle'; r.doing = 2; r.doT = 2 + rng() * 2; r.timer = 1.5 + rng() * 2;
          if (threat.d > 14) { r.hx = r.x; r.hz = r.z; }
          if (!want || r.hops > 14) { r.state = 'hidden'; r.timer = 8 + rng() * 10; }
        }
      } else if (r.state === 'idle') {
        r.timer -= dt; r.doT -= dt;
        if (r.doT <= 0) {
          // what to do while stopped: mostly graze, sometimes sit up and look about, now and then groom
          const u = rng();
          r.doing = u < 0.62 ? 0 : u < 0.85 ? 2 : 1;
          r.doT = r.doing === 1 ? 2.5 + rng() * 2 : 2 + rng() * 4;
        }
        if (!want && threat.d > 20) { r.state = 'hidden'; r.timer = 5 + rng() * 10; }
        else if (r.timer <= 0 && r.doing !== 1) {
          if (r.hops > 0) r.hops--;
          else if (rng() < 0.5) r.hops = 1 + Math.floor(rng() * 3);
          const homeDir = Math.atan2(r.hx - r.x, r.hz - r.z), far = Math.hypot(r.hx - r.x, r.hz - r.z) > 5;
          const dir = far ? homeDir + (rng() - 0.5) : r.hops > 0 ? r.yaw + (rng() - 0.5) * 0.8 : rng() * TAU;
          if (!rabbitHopTo(r, 0.32 + rng() * 0.28, dir, 0.36, 0.1)) r.timer = 0.5;
          else r.doing = 0;
        }
      }

      // pose
      CH.fill(0);
      const p = r.pose;
      const alert = r.state === 'alert' ? 1 : 0;
      p.alert = damp(p.alert, alert, 10, dt);
      p.nibble = damp(p.nibble, r.state === 'idle' && r.doing === 0 && r.timer > 0.15 ? 1 : 0, 5, dt);
      p.groom = damp(p.groom, r.state === 'idle' && r.doing === 1 ? 1 : 0, 4, dt);
      const lookUp = r.state === 'idle' && r.doing === 2 ? 1 : 0;
      // ears: random flicks; when alert both swivel toward the threat
      if (rng() < dt * 0.7) r.earKickL = 0.6; if (rng() < dt * 0.7) r.earKickR = 0.6;
      r.earKickL = damp(r.earKickL, 0, 6, dt); r.earKickR = damp(r.earKickR, 0, 6, dt);
      p.earL = r.earKickL; p.earR = r.earKickR;
      const rel = clamp(wrap(away + Math.PI - r.yaw), -1.2, 1.2);
      p.turnL = damp(p.turnL, alert ? rel * 0.8 : Math.sin(time * 0.5 + r.thr * 9) * 0.35, 6, dt);
      p.turnR = damp(p.turnR, alert ? -rel * 0.8 : Math.sin(time * 0.43 + r.thr * 5) * 0.35, 6, dt);
      r.tail = damp(r.tail, r.state === 'bolt' ? 0.7 : 0, 8, dt);
      if (hopping) {
        rabbitHop(Math.min(1, r.t), r.h / RAB_S, CH, BD);
        CH[4] = p.turnL * 0.3; CH[5] = p.turnR * 0.3; CH[6] = 0;
      } else {
        rabbitIdle(time + r.thr * 20, p, CH, BD);
        // sitting up to look around: taller, head up
        BD.pitch -= lookUp * 0.25; CH[0] -= lookUp * 0.3; CH[1] = Math.sin(time * 0.9 + r.thr * 7) * 0.5 * lookUp;
      }
      CH[9] = r.tail;
      const sink = r.state === 'hidden' ? (1 - r.show) * -0.25 : 0;
      const s = RAB_S * (0.3 + 0.7 * r.show);
      const slot = emit(rabbits, r.x, r.y + sink, r.z, r.yaw, 0, 0, s);
      const c = RAB[r.tint];
      rabbits.tintAt(slot, c[0], c[1], c[2]);
      if (r.show > 0.5) fx.shadow(r.x, r.y, r.z, 0.2 * s * (1 - Math.min(0.4, BD.y * 2)), 1.4, r.yaw);
    }
    CH.fill(0);
  }

  // ------------------------------------------------------------------ squirrels
  type SState = 'hidden' | 'idle' | 'run';
  interface Squirrel {
    hx: number; hz: number; x: number; y: number; z: number; yaw: number; state: SState;
    /** idle: 0 forage (nose down), 1 sit up and nibble, 2 chatter (alarmed) */
    doing: number; doT: number; tx: number; tz: number; speed: number; ph: number; flee: boolean;
    timer: number; thr: number; show: number; wary: Wariness; up: number; chatter: number; squeakIn: number;
  }
  const sqList: Squirrel[] = [];
  for (let i = 0; i < 3; i++) {
    const h = home(i);
    sqList.push({ hx: h.x, hz: h.z, x: h.x, y: heightAt(h.x, h.z), z: h.z, yaw: rng() * TAU, state: 'hidden', doing: 0, doT: 0, tx: 0, tz: 0, speed: 0, ph: 0, flee: false, timer: rng() * 3, thr: rng(), show: 0, wary: new Wariness({ alertAt: 7, boltAt: 3.4, charge: 5 }), up: 0, chatter: 0, squeakIn: 0 });
  }
  const SQ_S = 1.45;
  function runTo(q: Squirrel, dist: number, dir: number, speed: number, flee: boolean): boolean {
    for (let k = 0; k < 6; k++) {
      const a = dir + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.5;
      const nx = q.x + Math.sin(a) * dist, nz = q.z + Math.cos(a) * dist;
      if (!openGround(ctx, nx, nz, 0.25) || heightAt(nx, nz) < W + 0.05) continue;
      q.state = 'run'; q.tx = nx; q.tz = nz; q.speed = speed; q.flee = flee;
      return true;
    }
    return false;
  }
  function updateSquirrels(dt: number, time: number, act: Activity) {
    for (const q of sqList) {
      const want = q.thr < act.squirrels && !act.shelter;
      if (q.state === 'hidden') {
        q.show = Math.max(0, q.show - dt * 2);
        q.timer -= dt;
        if (want && q.timer <= 0 && Math.hypot(q.hx - player.x, q.hz - player.z) > 14 && openGround(ctx, q.hx, q.hz, 0.3)) {
          q.state = 'idle'; q.x = q.hx; q.z = q.hz; q.timer = 1 + rng(); q.doing = 1; q.doT = 2; q.wary.state = 'calm';
        } else if (q.timer <= 0) q.timer = 3;
        if (q.show <= 0) continue;
      } else q.show = Math.min(1, q.show + dt * 2);
      nearestThreat(q.x, q.z);
      const w = q.state === 'hidden' ? 'calm' : q.wary.step(dt, threat.d, threat.v, rng());
      const away = Math.atan2(q.x - threat.x, q.z - threat.z);
      if (w === 'bolt' && !q.flee && q.state !== 'hidden') {
        if (!runTo(q, 7 + rng() * 5, away + (rng() - 0.5) * 0.6, 3.4, true)) q.doing = 2;
        critterSound(ctx, 'squeak', q.x, q.y + 0.2, q.z, 20, 0.9, 1.15);
      }
      if (q.state === 'run') {
        const dx = q.tx - q.x, dz = q.tz - q.z, d = Math.hypot(dx, dz);
        const v = Math.min(q.speed, d * 3 + 0.5);
        const arriving = d < 0.3;
        if (!arriving) q.yaw = dampAngle(q.yaw, Math.atan2(dx, dz), 10, dt);
        q.x += Math.sin(q.yaw) * v * dt; q.z += Math.cos(q.yaw) * v * dt;
        // one bound covers ~0.3 m (more at a sprint): the phase is locked to distance so the paws don't skate
        q.ph += (v * dt) / (0.24 + v * 0.05);
        if (arriving) {
          // finish the bound in progress before stopping
          if (q.ph % 1 < 0.12 || q.ph % 1 > 0.92) {
            q.state = 'idle'; q.ph = 0;
            if (q.flee) { q.flee = false; q.doing = 2; q.doT = 2.5 + rng() * 2; q.chatter = 1; if (!want || threat.d < 9) { q.state = 'hidden'; q.timer = 10 + rng() * 10; } }
            else { q.doing = rng() < 0.55 ? 1 : 0; q.doT = 1.5 + rng() * 3; }
            q.timer = q.doT;
          }
        }
      } else if (q.state === 'idle') {
        q.timer -= dt;
        if (w === 'alert' && q.doing !== 2) { q.doing = 2; q.timer = 1.5; q.chatter = 1; }
        if (q.timer <= 0) {
          if (!want && threat.d > 18) { q.state = 'hidden'; q.timer = 5 + rng() * 10; }
          else if (w === 'alert') q.timer = 0.5;
          else if (rng() < 0.55) {
            const homeDir = Math.atan2(q.hx - q.x, q.hz - q.z), far = Math.hypot(q.hx - q.x, q.hz - q.z) > 6;
            if (!runTo(q, 1 + rng() * 2.5, far ? homeDir + (rng() - 0.5) : rng() * TAU, 1.3 + rng() * 0.6, false)) q.timer = 0.5;
          } else { q.doing = rng() < 0.5 ? 1 : 0; q.timer = 1.5 + rng() * 3; }
        }
        q.chatter = Math.max(0, q.chatter - dt * 0.35);
        if (q.doing === 2) {
          q.squeakIn -= dt;
          if (q.squeakIn <= 0) { q.squeakIn = 0.5 + rng() * 0.8; critterSound(ctx, 'squeak', q.x, q.y + 0.2, q.z, 18, 0.6, 1 + rng() * 0.2); }
        }
      }
      q.y = groundY(ctx, q.x, q.z);

      // pose
      const lt = time + q.thr * 13;
      CH.fill(0);
      if (q.state === 'run') {
        squirrelBound(q.ph, q.flee ? 0.09 : 0.06, CH, BD);
        q.up = 0;
      } else {
        const upT = q.doing === 1 ? 1 : q.doing === 2 ? 0.75 : 0;
        q.up = damp(q.up, upT, 7, dt);
        BD.y = 0; BD.roll = 0; BD.sx = BD.sy = BD.sz = 1;
        BD.pitch = -1.05 * q.up + (1 - q.up) * 0.12;
        CH.fill(0);
        squirrelTail(lt, q.doing === 2 ? Math.max(0.35, q.chatter) : 0, CH);
        const nib = q.doing === 1 ? 1 : 0;
        // forage: nose to the ground in little pecks; nibble: paws to the mouth, fast chewing
        CH[0] = nib ? 0.55 + Math.max(0, Math.sin(lt * 14)) * 0.08 : q.doing === 0 ? 0.35 + Math.max(0, Math.sin(lt * 3.1)) * 0.3 : -0.25 + Math.sin(lt * 20) * 0.04 * q.chatter;
        CH[1] = q.doing === 2 ? clamp(wrap(away + Math.PI - q.yaw), -0.8, 0.8) : Math.sin(lt * 0.7) * 0.3 * (1 - nib);
        // sitting up tips the body back: swing the tail base forward so it still curls up the back
        CH[2] -= q.up * 0.95;
        CH[5] = -1.7 * q.up * (nib ? 1 : 0.55);
        CH[6] = 0.9 * q.up;
        CH[7] = nib ? 0 : -1;
      }
      const sink = q.state === 'hidden' ? (1 - q.show) * -0.2 : 0;
      const s = SQ_S * (0.3 + 0.7 * q.show);
      emit(squirrels, q.x, q.y + sink, q.z, q.yaw, 0, 0, s);
      if (q.show > 0.5) fx.shadow(q.x, q.y, q.z, 0.12 * s, 1.4, q.yaw);
    }
    CH.fill(0);
  }

  ctx.scene.add(butterflies.mesh, dragons.mesh, core, glow, fishes.mesh, frogs.mesh, rabbits.mesh, squirrels.mesh);
  const pools = [butterflies, dragons, fishes, frogs, rabbits, squirrels];

  // dev hook: __valley.ctx.services.get('lifeDebug').critters
  const debug = {
    state: () => ({
      rabbits: rabbitList.map((r) => ({ s: r.state, w: r.wary.state, x: +r.x.toFixed(1), z: +r.z.toFixed(1) })),
      squirrels: sqList.map((q) => ({ s: q.state, d: q.doing, x: +q.x.toFixed(1), z: +q.z.toFixed(1) })),
      frogs: frogList.map((f) => ({ s: f.state, x: +f.x.toFixed(1), z: +f.z.toFixed(1) })),
      flies: flies.filter((b) => b.on).map((b) => ({ s: b.state, x: +b.x.toFixed(1), z: +b.z.toFixed(1) })),
      pond: { x: POND.x, z: POND.z, r: POND.r, w: W },
      perches: perches.length / 3,
      koi: kois.map((k) => ({ x: +k.x.toFixed(2), z: +k.z.toFixed(2), yaw: +k.yaw.toFixed(2) })),
      dragons: dfs.map((d) => ({ s: d.state, x: +d.x.toFixed(1), y: +d.y.toFixed(2), z: +d.z.toFixed(1), f: +d.fade.toFixed(1) })),
    }),
    /** bring every rabbit and squirrel out around (x, z) */
    meadow(x: number, z: number) {
      let i = 0;
      for (const r of rabbitList) { const a = (i++ / 9) * TAU; r.hx = x + Math.cos(a) * 3; r.hz = z + Math.sin(a) * 3; r.x = r.hx; r.z = r.hz; r.state = 'idle'; r.show = 1; r.timer = 1 + rng() * 2; r.wary.state = 'calm'; r.thr = 0; }
      for (const q of sqList) { const a = (i++ / 9) * TAU; q.hx = x + Math.cos(a) * 3; q.hz = z + Math.sin(a) * 3; q.x = q.hx; q.z = q.hz; q.state = 'idle'; q.show = 1; q.timer = 1 + rng(); q.wary.state = 'calm'; q.thr = 0; }
    },
    /** land every active butterfly near (x, z) */
    flowers(x: number, z: number) {
      let i = 0;
      for (const b of flies) {
        if (i > 5) break;
        spawnFly(b, x + (i % 3) * 0.6 - 0.6, z + Math.floor(i / 3) * 0.6); b.fade = 1; b.tint = i % BFLY.length;
        b.state = LAND; b.tx = b.x; b.tz = b.z; b.ty = groundY(ctx, b.x, b.z) + 0.15 + (i % 3) * 0.08; b.y = b.ty + 0.3; i++;
      }
    },
    jump() { nextJump = 0; },
    /** send the pond dragonflies to cattails near (x, z); returns the first perch */
    perch(x: number, z: number) {
      let out = null as null | { x: number; y: number; z: number };
      for (const d of dfs) {
        if (d.river) continue;
        d.x = x; d.z = z;
        if (pickPerch(d, 12)) { d.x = d.tx; d.y = d.ty; d.z = d.tz; d.state = PERCH; d.perch = true; d.timer = 15; d.fade = 1; out ??= { x: d.x, y: d.y, z: d.z }; }
      }
      return out;
    },
    ground: (x: number, z: number) => groundY(ctx, x, z),
  };
  const dbg = (ctx.services.get('lifeDebug') as Record<string, unknown> | undefined) ?? {};
  dbg.critters = debug;
  ctx.services.set('lifeDebug', dbg);

  return {
    meshes: [butterflies.mesh, dragons.mesh, core, glow, fishes.mesh, frogs.mesh, rabbits.mesh, squirrels.mesh],
    update(f, act) {
      const dt = Math.min(f.dt, 0.1);
      for (const p of pools) p.begin();
      updateButterflies(dt, f.time, act);
      updateDragons(dt, f.time, act);
      updateFireflies(dt, f.time, act);
      updateFish(dt, f.time, act);
      updateFrogs(dt, f.time, act);
      updateRabbits(dt, f.time, act);
      updateSquirrels(dt, f.time, act);
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
