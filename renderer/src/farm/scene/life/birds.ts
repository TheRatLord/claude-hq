/**
 * Sky folk:
 *  - songbird flocks (boids-lite): fly over the valley, circle, land on open ground near the player, hop and peck,
 *    burst off when you come close. Out by day (dawn chorus), fewer in rain, roost at night.
 *  - crows circling fields whose farmers are struggling.
 *  - carrier pigeons = network: they shuttle between the farmhouse loft and the fields / valley edges with tiny
 *    letters; departures ∝ log(netRx + netTx).
 * Two draw calls (songbirds + crows share one rig; pigeons have their own).
 */
import * as THREE from 'three';
import type { FrameInfo, SceneCtx } from '../context.ts';
import { SITES, siteToWorld, structure } from '../../world/map.ts';
import { seeded } from '../../../core/rng.ts';
import { RigPool } from './rig.ts';
import { pigeon, songbird } from './models.ts';
import type { Activity } from './schedule.ts';
import { outboundShare, pigeonInterval } from './schedule.ts';
import { TAU, clamp, critterSound, damp, dampAngle, groundY, lerp, openGround, sampleSpots, wrap } from './util.ts';
import type { Fx, Rng } from './util.ts';

const SPECIES: readonly [number, number, number][] = [
  [0.78, 0.55, 0.36], // sparrow
  [0.45, 0.66, 1.0], // bluebird
  [0.98, 0.8, 0.32], // finch
  [0.9, 0.5, 0.42], // robin-ish
];
const CROW: [number, number, number] = [0.17, 0.17, 0.22];
/** wing channel value that tucks the wings down along the body */
const FOLD = -0.3;
/** wing scale channel value that tucks the flight wings away (perched) */
const SWEEP = -1;

interface Bird {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number; pitch: number; roll: number;
  mode: 'air' | 'ground';
  gx: number; gz: number; // landing target
  ox: number; oy: number; oz: number; // formation offset
  flap: number; burst: number;
  hop: number; hopX: number; hopZ: number; hopFromX: number; hopFromZ: number; nextHop: number;
  peck: number; nextPeck: number; look: number; lookTo: number; tail: number;
  scale: number;
}

type FlockState = 'away' | 'flying' | 'circling' | 'perched' | 'leaving';

interface Flock {
  birds: Bird[];
  tint: [number, number, number];
  state: FlockState;
  cx: number; cy: number; cz: number;
  fromX: number; fromY: number; fromZ: number;
  toX: number; toY: number; toZ: number;
  t: number; dur: number; arc: number;
  timer: number;
  circleR: number; circleA: number;
  chirpIn: number;
  /** perched on a fence rail (true) or on the ground */
  rail: boolean; railY: number; railYaw: number;
}

const newBird = (rng: Rng, scale: number): Bird => ({
  x: 0, y: -100, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, roll: 0, mode: 'air', gx: 0, gz: 0,
  ox: (rng() - 0.5) * 4, oy: (rng() - 0.5) * 1.5, oz: (rng() - 0.5) * 4, flap: rng() * TAU, burst: rng(),
  hop: 1, hopX: 0, hopZ: 0, hopFromX: 0, hopFromZ: 0, nextHop: rng() * 2, peck: 0, nextPeck: rng() * 2, look: 0, lookTo: 0, tail: 0,
  scale,
});

interface Crow { site: number; on: boolean; x: number; y: number; z: number; vx: number; vy: number; vz: number; phase: number; yaw: number; roll: number; flap: number; fade: number }

interface Flight {
  on: boolean;
  kind: 'out' | 'in';
  toPlot: boolean;
  x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; x2: number; y2: number; z2: number;
  t: number; dur: number;
  letter: boolean;
  wait: number; // seconds sitting at the plot gate
  back: boolean;
  flap: number;
  x: number; y: number; z: number; yaw: number; pitch: number; roll: number;
}

export interface Birds {
  meshes: THREE.Object3D[];
  update(f: FrameInfo, act: Activity): void;
  stats(): Record<string, number>;
  dispose(): void;
}

export function createBirds(ctx: SceneCtx, fx: Fx): Birds {
  const rng = seeded('life:birds');
  const sb = songbird();
  const small = new RigPool(sb.geo, sb.spec, 40, { side: THREE.DoubleSide });
  const pg = pigeon();
  const pigeons = new RigPool(pg.geo, pg.spec, 20, { side: THREE.DoubleSide });
  ctx.scene.add(small.mesh, pigeons.mesh);

  const spots = sampleSpots(5, 85, -0.6, 9, rng);
  const flocks: Flock[] = [];
  for (let i = 0; i < 3; i++) {
    const n = 6 + (i % 2) * 2;
    const birds: Bird[] = [];
    for (let k = 0; k < n; k++) birds.push(newBird(rng, 0.9 + rng() * 0.25));
    flocks.push({
      birds, tint: SPECIES[i % SPECIES.length], state: 'away', cx: 0, cy: 0, cz: 0, fromX: 0, fromY: 0, fromZ: 0, toX: 0, toY: 0, toZ: 0,
      t: 0, dur: 1, arc: 0, timer: 1 + i * 4, circleR: 10, circleA: 0, chirpIn: 2, rail: false, railY: 0, railYaw: 0,
    });
  }
  const crows: Crow[] = [];
  for (let i = 0; i < 9; i++) crows.push({ site: -1, on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, phase: rng() * TAU, yaw: 0, roll: 0, flap: rng() * TAU, fade: 0 });

  // --- loft: on the farmhouse roof ridge, east end (the structures package may put a dovecote there)
  const fh = structure('farmhouse');
  const loft = new THREE.Vector3(fh.x - 3, fh.y + 8.85, fh.z - 0.4);
  let loftYaw = fh.yaw, loftIn = 0;
  /** perch on the dovecote's landing board (structures publishes 'pigeonLoft': a point just in front of it) */
  function resolveLoft(): void {
    const sp = (ctx.services.get('structureSpots') as { get(n: string): { x: number; y: number; z: number; yaw: number } | null } | undefined)?.get('pigeonLoft');
    if (!sp) return;
    loftYaw = sp.yaw;
    loft.set(sp.x - Math.sin(sp.yaw) * 0.8, sp.y - 0.14, sp.z - Math.cos(sp.yaw) * 0.8);
  }
  const flights: Flight[] = [];
  for (let i = 0; i < 14; i++) flights.push({ on: false, kind: 'out', toPlot: false, x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0, x2: 0, y2: 0, z2: 0, t: 0, dur: 1, letter: false, wait: 0, back: false, flap: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 });
  let nextFlight = 3;
  const residents = [{ dx: -0.5, bob: 0 }, { dx: 0.02, bob: 1.3 }, { dx: 0.52, bob: 2.1 }];

  const player = ctx.player.pos;

  const perchY = (fl: Flock, x: number, z: number) => (fl.rail ? fl.railY : groundY(ctx, x, z));

  function pickSpot(minD: number, maxD: number): { x: number; z: number } | null {
    for (let tries = 0; tries < 30; tries++) {
      const s = spots[Math.floor(rng() * spots.length)];
      if (!s) return null;
      const d = Math.hypot(s.x - player.x, s.z - player.z);
      if (d < minD || d > maxD) continue;
      if (!openGround(ctx, s.x, s.z, 1.2)) continue;
      return s;
    }
    return null;
  }

  function launch(fl: Flock, toX: number, toY: number, toZ: number, speed: number, fromPos = true) {
    if (fromPos) {
      let mx = 0, my = 0, mz = 0;
      for (const b of fl.birds) { mx += b.x; my += b.y; mz += b.z; }
      const n = fl.birds.length;
      fl.cx = mx / n; fl.cy = my / n; fl.cz = mz / n;
    }
    fl.fromX = fl.cx; fl.fromY = fl.cy; fl.fromZ = fl.cz;
    fl.toX = toX; fl.toY = toY; fl.toZ = toZ;
    const d = Math.hypot(toX - fl.cx, toZ - fl.cz);
    fl.dur = Math.max(2, d / speed); fl.t = 0;
    fl.arc = clamp(d * 0.18, 3, 16);
  }

  function takeOff(fl: Flock) {
    for (const b of fl.birds) {
      if (b.mode === 'ground') { b.mode = 'air'; b.vy = 3 + rng() * 2; b.vx = (rng() - 0.5) * 3; b.vz = (rng() - 0.5) * 3; }
    }
    critterSound(ctx, 'flap', fl.cx, fl.cy + 0.3, fl.cz, 25, 1);
    critterSound(ctx, 'chirp', fl.cx, fl.cy + 0.3, fl.cz, 30, 0.8, 1 + rng() * 0.2);
  }

  /** the back fence rail of a worked field nearby (plots builds fences on the site frame: rail top ≈ pad + 0.92 m) */
  function pickRail(fl: Flock): boolean {
    let best = -1, n = 0;
    for (const p of ctx.valley.plots.values()) {
      if (p.stage !== 'thriving' && p.stage !== 'growing' && p.stage !== 'resting') continue;
      const st = SITES[p.site], d = Math.hypot(st.x - player.x, st.z - player.z);
      if (d < 14 || d > 60) continue;
      n++;
      if (rng() < 1 / n) best = p.site;
    }
    if (best < 0) return false;
    const st = SITES[best];
    const lx0 = (rng() - 0.5) * (st.w - 5), lz = -st.d / 2 + 0.05;
    const c = siteToWorld(st, lx0, lz);
    fl.rail = true; fl.railY = st.y + 0.93; fl.railYaw = st.yaw;
    launch(fl, c.x, fl.railY + 1.2, c.z, 8);
    fl.state = 'flying'; fl.timer = 0;
    const ax = Math.cos(st.yaw), az = -Math.sin(st.yaw); // rail direction (site local +x)
    fl.birds.forEach((b, k) => { const off = (k - (fl.birds.length - 1) / 2) * 0.34 + (rng() - 0.5) * 0.08; b.gx = c.x + ax * off; b.gz = c.z + az * off; });
    return true;
  }

  function landFlock(fl: Flock) {
    fl.rail = false;
    if (rng() < 0.4 && pickRail(fl)) return;
    const s = pickSpot(14, 55) ?? pickSpot(8, 80);
    if (!s) { fl.state = 'circling'; fl.timer = 8; return; }
    const gy = groundY(ctx, s.x, s.z);
    launch(fl, s.x, gy + 1.2, s.z, 8);
    fl.state = 'flying';
    fl.timer = 0;
    for (const b of fl.birds) {
      const a = rng() * TAU, r = 0.4 + rng() * 1.8;
      b.gx = s.x + Math.cos(a) * r; b.gz = s.z + Math.sin(a) * r;
    }
  }

  function rimPoint(out: { x: number; y: number; z: number }) {
    const a = rng() * TAU;
    out.x = player.x + Math.cos(a) * 95; out.z = player.z + Math.sin(a) * 95; out.y = player.y + 40;
  }
  const rim = { x: 0, y: 0, z: 0 };

  function updateFlock(fl: Flock, i: number, dt: number, time: number, act: Activity) {
    const wanted = i < Math.round(act.birds * flocks.length + 0.25) && act.birds > 0.08;
    fl.timer -= dt;
    switch (fl.state) {
      case 'away':
        if (wanted && fl.timer <= 0) {
          rimPoint(rim);
          fl.cx = rim.x; fl.cy = rim.y; fl.cz = rim.z;
          for (const b of fl.birds) { b.x = rim.x + b.ox; b.y = rim.y + b.oy; b.z = rim.z + b.oz; b.mode = 'air'; b.vx = b.vy = b.vz = 0; }
          if (rng() < 0.45) { fl.state = 'circling'; fl.timer = 8 + rng() * 10; const s = pickSpot(10, 50); fl.toX = s?.x ?? player.x; fl.toZ = s?.z ?? player.z; fl.toY = player.y + 14 + rng() * 8; fl.circleR = 9 + rng() * 8; fl.circleA = Math.atan2(fl.cz - fl.toZ, fl.cx - fl.toX); launch(fl, fl.toX + Math.cos(fl.circleA) * fl.circleR, fl.toY, fl.toZ + Math.sin(fl.circleA) * fl.circleR, 9, false); }
          else landFlock(fl);
        }
        return;
      case 'circling': {
        // approach the ring first, then orbit
        fl.t += dt / fl.dur;
        if (fl.t < 1) { const k = fl.t; fl.cx = lerp(fl.fromX, fl.toX + Math.cos(fl.circleA) * fl.circleR, k); fl.cz = lerp(fl.fromZ, fl.toZ + Math.sin(fl.circleA) * fl.circleR, k); fl.cy = lerp(fl.fromY, fl.toY, k); }
        else { fl.circleA += (dt * 7) / fl.circleR; fl.cx = fl.toX + Math.cos(fl.circleA) * fl.circleR; fl.cz = fl.toZ + Math.sin(fl.circleA) * fl.circleR; fl.cy = fl.toY + Math.sin(time * 0.5 + i) * 1.5; }
        if (fl.timer <= 0) { if (wanted) landFlock(fl); else { rimPoint(rim); launch(fl, rim.x, rim.y, rim.z, 10, false); fl.state = 'leaving'; } }
        break;
      }
      case 'flying':
      case 'leaving': {
        fl.t = Math.min(1, fl.t + dt / fl.dur);
        const k = fl.t, e = k * k * (3 - 2 * k);
        fl.cx = lerp(fl.fromX, fl.toX, e) + Math.sin(k * Math.PI * 2 + i) * 1.5;
        fl.cz = lerp(fl.fromZ, fl.toZ, e) + Math.cos(k * Math.PI * 2 + i) * 1.5;
        fl.cy = lerp(fl.fromY, fl.toY, e) + Math.sin(k * Math.PI) * fl.arc;
        if (fl.state === 'leaving') { if (k >= 1) { fl.state = 'away'; fl.timer = 10 + rng() * 25; } break; }
        if (k > 0.8) {
          // peel off to individual landing spots
          for (const b of fl.birds) if (b.mode === 'air' && Math.hypot(b.x - b.gx, b.z - b.gz) < 2.5 && b.y - perchY(fl, b.gx, b.gz) < 1.2) { b.mode = 'ground'; b.y = perchY(fl, b.gx, b.gz); b.x = b.gx; b.z = b.gz; b.hop = 1; b.vx = b.vy = b.vz = 0; if (fl.rail) b.yaw = fl.railYaw + (rng() < 0.5 ? 0 : Math.PI) + (rng() - 0.5) * 0.5; }
          let allDown = true;
          for (const b of fl.birds) if (b.mode === 'air') allDown = false;
          if (!allDown && k >= 1 && fl.timer < -4) {
            for (const b of fl.birds) if (b.mode === 'air') { b.mode = 'ground'; b.x = b.gx; b.z = b.gz; b.y = perchY(fl, b.gx, b.gz); b.hop = 1; }
            allDown = true;
          }
          if (allDown) { fl.state = 'perched'; fl.timer = 14 + rng() * 26; }
        }
        break;
      }
      case 'perched': {
        const d = Math.hypot(player.x - fl.toX, player.z - fl.toZ);
        const scare = d < 5.5 || (d < 9 && ctx.player.speed > 6);
        if (scare || fl.timer <= 0 || !wanted) {
          takeOff(fl);
          if (!wanted) { rimPoint(rim); launch(fl, rim.x, rim.y, rim.z, 10); fl.state = 'leaving'; }
          else if (rng() < 0.35 && !scare) { fl.state = 'circling'; fl.timer = 6 + rng() * 8; fl.toX = fl.cx; fl.toZ = fl.cz; fl.toY = fl.cy + 12; fl.circleR = 8 + rng() * 6; fl.circleA = rng() * TAU; launch(fl, fl.cx, fl.toY, fl.cz, 8); }
          else landFlock(fl);
          break;
        }
        fl.chirpIn -= dt;
        if (fl.chirpIn <= 0) {
          fl.chirpIn = (2 + rng() * 6) / (0.5 + act.chorus * 1.5);
          const b = fl.birds[Math.floor(rng() * fl.birds.length)];
          critterSound(ctx, 'chirp', b.x, b.y + 0.2, b.z, 28, 0.55 + act.chorus * 0.4, 0.9 + rng() * 0.35);
          b.lookTo = (rng() - 0.5) * 1.6;
        }
        break;
      }
    }
    // birds
    for (const b of fl.birds) {
      if (b.mode === 'air') {
        let tx: number, ty: number, tz: number;
        const landing = fl.state === 'flying' && fl.t > 0.6;
        if (landing) { const k = clamp((fl.t - 0.6) / 0.4, 0, 1); tx = lerp(fl.cx + b.ox, b.gx, k); tz = lerp(fl.cz + b.oz, b.gz, k); ty = lerp(fl.cy + b.oy, perchY(fl, b.gx, b.gz) + 0.05, k * k); }
        else { const w = time * 0.7 + b.burst * 9; tx = fl.cx + b.ox + Math.sin(w) * 0.8; ty = fl.cy + b.oy + Math.sin(w * 1.3) * 0.5; tz = fl.cz + b.oz + Math.cos(w * 0.9) * 0.8; }
        const k = landing ? 5 : 2.2;
        b.vx += ((tx - b.x) * k - b.vx * 1.6) * dt * 2;
        b.vy += ((ty - b.y) * k - b.vy * 1.6) * dt * 2;
        b.vz += ((tz - b.z) * k - b.vz * 1.6) * dt * 2;
        const sp = Math.hypot(b.vx, b.vy, b.vz), max = landing ? 7 : 13;
        if (sp > max) { b.vx *= max / sp; b.vy *= max / sp; b.vz *= max / sp; }
        b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
        const floor = groundY(ctx, b.x, b.z) + 0.05;
        if (b.y < floor) { b.y = floor; if (b.vy < 0) b.vy = 0; }
        const hs = Math.hypot(b.vx, b.vz);
        if (hs > 0.3) {
          const ny = Math.atan2(b.vx, b.vz);
          const turn = wrap(ny - b.yaw);
          b.yaw = dampAngle(b.yaw, ny, 6, dt);
          b.roll = damp(b.roll, clamp(-turn * 1.5, -0.7, 0.7), 5, dt);
        }
        b.pitch = damp(b.pitch, clamp(-Math.atan2(b.vy, hs + 0.5) * 0.8, -0.8, 0.8), 6, dt);
        // bounding flight: bursts of flapping, then a short glide with wings tucked
        b.burst += dt;
        const cycle = b.burst % 0.9;
        b.flap += dt * (cycle < 0.55 || b.vy > 1 || landing ? 26 : 0);
      } else {
        // on the ground: hop, peck, look about
        b.nextHop -= dt;
        if (fl.rail) {
          // on a fence rail: shuffle, preen, look about, turn round now and then
          if (b.nextHop <= 0) { b.nextHop = 1.5 + rng() * 4; if (rng() < 0.3) b.yaw += Math.PI; b.peck = rng() < 0.4 ? 0.6 : 0; }
          b.y = fl.railY + (b.nextHop > 0 && b.nextHop < 0.12 ? 0.04 : 0);
          b.peck = Math.max(0, b.peck - dt * 2);
          if (rng() < dt * 0.5) b.lookTo = (rng() - 0.5) * 1.6;
          b.look = damp(b.look, b.lookTo, 8, dt);
          b.tail = rng() < dt * 0.8 ? 0.6 : damp(b.tail, 0, 10, dt);
          continue;
        }
        if (b.hop < 1) {
          b.hop = Math.min(1, b.hop + dt / 0.18);
          b.x = lerp(b.hopFromX, b.hopX, b.hop); b.z = lerp(b.hopFromZ, b.hopZ, b.hop);
        } else if (b.nextHop <= 0) {
          b.nextHop = 0.5 + rng() * 2.5;
          const a = rng() * TAU, r = 0.1 + rng() * 0.22;
          let nx = b.x + Math.cos(a) * r, nz = b.z + Math.sin(a) * r;
          if (Math.hypot(nx - fl.toX, nz - fl.toZ) > 2.6) { nx = b.x + (fl.toX - b.x) * 0.15; nz = b.z + (fl.toZ - b.z) * 0.15; }
          b.hopFromX = b.x; b.hopFromZ = b.z; b.hopX = nx; b.hopZ = nz; b.hop = 0;
          b.yaw = Math.atan2(nx - b.x, nz - b.z);
        }
        b.y = groundY(ctx, b.x, b.z) + (b.hop < 1 ? Math.sin(b.hop * Math.PI) * 0.07 : 0);
        b.nextPeck -= dt;
        if (b.nextPeck <= 0) { b.nextPeck = 0.4 + rng() * 1.8; b.peck = 1; }
        b.peck = Math.max(0, b.peck - dt * 3.5);
        if (rng() < dt * 0.4) b.lookTo = (rng() - 0.5) * 1.4;
        b.look = damp(b.look, b.lookTo, 8, dt);
        b.tail = rng() < dt * 0.8 ? 0.6 : damp(b.tail, 0, 10, dt);
        b.pitch = damp(b.pitch, 0, 8, dt); b.roll = damp(b.roll, 0, 8, dt);
      }
    }
  }

  const tmpTint = { r: 0, g: 0, b: 0 };
  function drawFlock(fl: Flock) {
    if (fl.state === 'away') return;
    tmpTint.r = fl.tint[0]; tmpTint.g = fl.tint[1]; tmpTint.b = fl.tint[2];
    for (const b of fl.birds) {
      const s = b.scale * 1.45;
      let slot: number;
      if (b.mode === 'air') {
        const flap = b.flap > 0 ? Math.sin(b.flap) * 0.95 + 0.25 : 0.1;
        slot = small.put(b.x, b.y, b.z, b.yaw, b.pitch, b.roll, s, s, s, flap, 0, 0, 0);
      } else {
        const peck = Math.sin(b.peck * Math.PI) * 0.95;
        slot = small.put(b.x, b.y, b.z, b.yaw, 0, 0, s, s, s, FOLD, peck, b.look, b.tail, SWEEP);
        if (!fl.rail) fx.shadow(b.x, b.y, b.z, 0.1 * s);
      }
      small.tintAt(slot, tmpTint.r, tmpTint.g, tmpTint.b);
    }
  }

  // --- crows over struggling fields
  let crowScan = 0;
  const crowSites: number[] = [];
  function scanCrows() {
    crowSites.length = 0;
    for (const f of ctx.valley.farmers.values()) {
      if (f.struggle < 2) continue;
      const p = ctx.valley.plots.get(f.plotId);
      if (p && !crowSites.includes(p.site) && crowSites.length < 3) crowSites.push(p.site);
    }
    for (let i = 0; i < crows.length; i++) {
      const c = crows[i];
      const site = crowSites[Math.floor(i / 3)] ?? -1;
      if (site !== c.site) {
        if (site >= 0 && !c.on) { rimPoint(rim); c.x = rim.x; c.y = rim.y; c.z = rim.z; c.on = true; c.fade = 0; }
        c.site = site;
      }
    }
  }
  function updateCrows(dt: number, time: number) {
    crowScan -= dt;
    if (crowScan <= 0) { crowScan = 1; scanCrows(); }
    for (let i = 0; i < crows.length; i++) {
      const c = crows[i];
      if (!c.on) continue;
      let tx: number, ty: number, tz: number;
      if (c.site >= 0) {
        const s = SITES[c.site];
        c.phase += dt * 0.55;
        const r = 6 + (i % 3) * 1.4;
        tx = s.x + Math.cos(c.phase) * r; tz = s.z + Math.sin(c.phase) * r; ty = s.y + 8 + (i % 3) * 1.2 + Math.sin(time * 0.7 + i) * 0.6;
        c.fade = Math.min(1, c.fade + dt * 0.5);
      } else {
        tx = c.x + c.vx * 3; tz = c.z + c.vz * 3; ty = c.y + 3;
        c.fade -= dt * 0.25;
        if (c.fade <= 0) { c.on = false; continue; }
      }
      c.vx += ((tx - c.x) * 1.2 - c.vx) * dt * 2; c.vy += ((ty - c.y) * 1.2 - c.vy) * dt * 2; c.vz += ((tz - c.z) * 1.2 - c.vz) * dt * 2;
      const sp = Math.hypot(c.vx, c.vz);
      if (sp > 9) { c.vx *= 9 / sp; c.vz *= 9 / sp; }
      c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
      const ny = Math.atan2(c.vx, c.vz);
      c.roll = damp(c.roll, clamp(-wrap(ny - c.yaw) * 4, -0.6, 0.6), 3, dt);
      c.yaw = dampAngle(c.yaw, ny, 4, dt);
      c.flap += dt * ((time + i) % 3 < 1.2 ? 14 : 0); // mostly soaring
      const s = 1.9 * c.fade;
      const slot = small.put(c.x, c.y, c.z, c.yaw, 0, c.roll, s, s, s, (time + i) % 3 < 1.2 ? Math.sin(c.flap) * 0.7 + 0.15 : 0.12, 0, 0, 0);
      small.tintAt(slot, CROW[0], CROW[1], CROW[2]);
    }
  }

  // --- carrier pigeons
  function startFlight(out: boolean) {
    const fl = flights.find((v) => !v.on);
    if (!fl) return;
    fl.on = true; fl.kind = out ? 'out' : 'in'; fl.t = 0; fl.back = false; fl.wait = 0; fl.flap = rng() * TAU; fl.letter = true;
    let tx: number, ty: number, tz: number;
    fl.toPlot = false;
    if (out && rng() < 0.6) {
      // to a field someone is working in
      let best = -1, n = 0;
      for (const p of ctx.valley.plots.values()) {
        if (p.stage === 'fallow' || p.stage === 'harvest') continue;
        n++;
        if (rng() < 1 / n) best = p.site;
      }
      if (best >= 0) { const s = SITES[best]; fl.toPlot = true; tx = s.gate.x + (rng() - 0.5) * 1.5; tz = s.gate.z + (rng() - 0.5) * 1.5; ty = groundY(ctx, tx, tz); }
      else { rimPoint(rim); tx = rim.x; ty = rim.y; tz = rim.z; }
    } else { const a = rng() * TAU; tx = Math.cos(a) * 105; tz = Math.sin(a) * 105; ty = 45; }
    if (out) { fl.x0 = loft.x; fl.y0 = loft.y; fl.z0 = loft.z; fl.x2 = tx!; fl.y2 = ty!; fl.z2 = tz!; }
    else { fl.x0 = tx!; fl.y0 = ty!; fl.z0 = tz!; fl.x2 = loft.x + (rng() - 0.5); fl.y2 = loft.y; fl.z2 = loft.z + (rng() - 0.5) * 0.3; }
    setArc(fl);
    if (out) critterSound(ctx, 'flap', loft.x, loft.y, loft.z, 35, 0.8);
  }
  function setArc(fl: Flight) {
    const d = Math.hypot(fl.x2 - fl.x0, fl.z2 - fl.z0);
    fl.x1 = (fl.x0 + fl.x2) / 2; fl.z1 = (fl.z0 + fl.z2) / 2;
    fl.y1 = Math.max(fl.y0, fl.y2) + clamp(4 + d * 0.15, 5, 24);
    fl.dur = Math.max(2.5, (d * 1.15) / 11);
  }
  function updateFlights(dt: number) {
    const g = ctx.valley.gauges;
    const rate = g ? g.netRx + g.netTx : 0;
    const iv = pigeonInterval(rate);
    nextFlight -= dt;
    if (nextFlight <= 0) {
      if (Number.isFinite(iv)) { startFlight(rng() < outboundShare(g?.netRx ?? 0, g?.netTx ?? 0)); nextFlight = iv * (0.5 + rng()); }
      else nextFlight = 2;
    }
    for (const fl of flights) {
      if (!fl.on) continue;
      if (fl.wait > 0) {
        fl.wait -= dt;
        if (fl.wait <= 0) {
          // drop the letter, head home
          fl.back = true; fl.letter = false; fl.t = 0;
          fl.x0 = fl.x; fl.y0 = fl.y; fl.z0 = fl.z; fl.x2 = loft.x + (rng() - 0.5); fl.y2 = loft.y; fl.z2 = loft.z;
          setArc(fl);
          critterSound(ctx, 'flap', fl.x, fl.y, fl.z, 20, 0.7);
        }
        continue;
      }
      fl.t += dt / fl.dur;
      const t = Math.min(1, fl.t), u = 1 - t;
      const px = fl.x, pz = fl.z, py = fl.y;
      fl.x = u * u * fl.x0 + 2 * u * t * fl.x1 + t * t * fl.x2;
      fl.y = u * u * fl.y0 + 2 * u * t * fl.y1 + t * t * fl.y2;
      fl.z = u * u * fl.z0 + 2 * u * t * fl.z1 + t * t * fl.z2;
      const vx = fl.x - px, vy = fl.y - py, vz = fl.z - pz, hs = Math.hypot(vx, vz);
      if (hs > 1e-4) {
        const ny = Math.atan2(vx, vz);
        fl.roll = damp(fl.roll, clamp(-wrap(ny - fl.yaw) * 20, -0.5, 0.5), 4, dt);
        fl.yaw = t < 0.02 ? ny : dampAngle(fl.yaw, ny, 8, dt);
        fl.pitch = damp(fl.pitch, clamp(-Math.atan2(vy, hs) * 0.8, -0.7, 0.7), 6, dt);
      }
      const climbing = vy > 0 || t < 0.2 || t > 0.85;
      fl.flap += dt * (climbing || (t * 7) % 1 < 0.6 ? 22 : 0);
      if (t >= 1) {
        if (fl.kind === 'out' && fl.toPlot && !fl.back) { fl.wait = 1.4 + rng(); fl.pitch = 0; fl.roll = 0; }
        else fl.on = false; // into the loft / over the ridge
      }
    }
  }
  function drawPigeons(time: number) {
    // loft residents: bob, peck at the ridge, coo
    for (let i = 0; i < residents.length; i++) {
      const r = residents[i];
      const bob = Math.max(0, Math.sin(time * 2.2 + r.bob)) * 0.35;
      const c = Math.cos(loftYaw), sn = Math.sin(loftYaw);
      pigeons.put(loft.x + r.dx * c, loft.y, loft.z - r.dx * sn, loftYaw + (i === 1 ? 0.5 : -0.3) + Math.sin(time * 0.3 + i) * 0.5, 0, 0, 1.3, 1.3, 1.3, FOLD, bob, Math.sin(time * 0.8 + r.bob * 3) * 0.6, 0, -1, SWEEP);
    }
    for (const fl of flights) {
      if (!fl.on) continue;
      const sitting = fl.wait > 0;
      const t = Math.min(1, fl.t);
      const flap = sitting ? FOLD : fl.flap > 0 ? Math.sin(fl.flap) * 0.9 + 0.3 : 0.15;
      const fade0 = fl.kind === 'in' && !fl.back ? Math.min(1, t * 6) : fl.kind === 'out' && !fl.toPlot ? Math.min(1, (1 - t) * 6) : 1;
      const fade = fade0 * 1.3;
      pigeons.put(fl.x, fl.y, fl.z, fl.yaw, sitting ? 0 : fl.pitch, sitting ? 0 : fl.roll, fade, fade, fade, flap, sitting ? Math.max(0, Math.sin(time * 5)) * 0.4 : 0, 0, 0, fl.letter ? 0 : -1, sitting ? SWEEP : 0);
      if (sitting) fx.shadow(fl.x, fl.y, fl.z, 0.15);
    }
  }
  let cooIn = 5;

  return {
    meshes: [small.mesh, pigeons.mesh],
    update(f, act) {
      const dt = f.dt;
      loftIn -= dt;
      if (loftIn <= 0) { loftIn = 2; resolveLoft(); }
      small.begin();
      pigeons.begin();
      for (let i = 0; i < flocks.length; i++) { updateFlock(flocks[i], i, dt, f.time, act); drawFlock(flocks[i]); }
      updateCrows(dt, f.time);
      updateFlights(dt);
      drawPigeons(f.time);
      cooIn -= dt;
      if (cooIn <= 0) { cooIn = 5 + rng() * 10; critterSound(ctx, 'coo', loft.x, loft.y, loft.z, 32, 0.8, 0.9 + rng() * 0.2); }
      small.end();
      pigeons.end();
    },
    stats() {
      let air = 0;
      for (const fl of flights) if (fl.on) air++;
      return { birds: small.size, pigeonsFlying: air };
    },
    dispose() { ctx.scene.remove(small.mesh, pigeons.mesh); small.dispose(); pigeons.dispose(); },
  };
}
