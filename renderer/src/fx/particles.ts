/**
 * One pooled particle system (ART §10: 1024 max) for confetti, Z's, sparkles, sparks, steam, smoke, poof, dust, rain,
 * dust motes and the pneumatic capsule. CPU-simulated, written into two quad batches: `hot` (confetti, §5.0 emissive
 * 1.2) and `plain` (everything else, ≤ 1.0 so it never blooms). Preallocated particles, no per-frame allocation.
 * Owner: FX.
 */
import * as THREE from 'three';
import { QV } from './quads.ts';
import { STATUS, CORE, ENV, MISC } from '../../../shared/palette.ts';
import type { QuadBatch } from './quads.ts';
import type { ShapeKey } from './draw.ts';
import type { UvRect, Vec3Like } from './types.ts';

export const MAX_PARTICLES = 1024;

type Rgb = [number, number, number];
const lin = (hex: string): Rgb => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const CONFETTI = [STATUS.done, ENV.butter, CORE.clay, STATUS.working, ENV.lavender, ENV.rose, CORE.clayLight].map(lin);
const C: Record<'paper' | 'smoke' | 'sand' | 'butter' | 'spark' | 'rain' | 'white' | 'mote', Rgb> = {
  paper: lin(CORE.paper), smoke: lin('#958F88'), // warm grey, lighter than slate so the puff reads as smoke, not a hole
  sand: lin(CORE.sand), butter: lin(ENV.butter),
  spark: lin(STATUS.shellBusy), rain: lin('#9CC3E4'), white: [1, 1, 1], mote: lin(MISC.trim),
};

/** One pooled particle. */
interface P {
  live: boolean;
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  age: number; life: number; size: number; size1: number; rot: number; spin: number;
  r: number; g: number; b: number; a: number;
  drag: number; grav: number; flutter: number; sway: number; fadeIn: number; fadeOut: number;
  shape: ShapeKey; hot: boolean; align: boolean; floor: number; ceil: number; kind: number;
  /** on-top batch (depth test off) */
  top: boolean;
  /** squash-scale pop-in (hearts) */
  pop: number;
}

export type BurstKind = 'confetti' | 'poof' | 'smoke' | 'sparkle' | 'sparks' | 'dust' | 'capsule' | 'steam' | 'zzz' | 'drop' | 'mote' | 'hearts';
/** `top` (hearts): the on-top batch (depth test off) [FX fix r1 m2-carry]. */
export interface BurstOpts { count?: number; floor?: number; ceil?: number; color?: number[]; up?: number; spread?: number; top?: boolean }

const KIND = { generic: 0, capsule: 1, drop: 2 };
/** [FX fix r1 m2-carry] pop-in time (s) and its ease-out-back scale (overshoot ≈ 1.3 at k ≈ 0.6). */
const POP_S = 0.3;
const popScale = (k: number) => { const c = 2.6, q = k - 1; return 1 + (c + 1) * q * q * q + c * q * q; };
/** [FX fix m2-r1] default burst options (no `{}` per call; burst only reads them) */
const NO_OPTS: Readonly<BurstOpts> = Object.freeze({});

/** The slice of a quad batch the pool drives (test fakes satisfy it). */
export type ParticleQuads = Pick<QuadBatch, 'begin' | 'pushQ' | 'end'>;

export function createParticles({ hot, plain, top = plain, tile }: { hot: ParticleQuads; plain: ParticleQuads; top?: ParticleQuads; tile: (shape: ShapeKey) => UvRect & { w: number; h: number } }) {
  const pool: P[] = Array.from({ length: MAX_PARTICLES }, () => ({
    live: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, size: 0.1, size1: 0.1, rot: 0, spin: 0,
    r: 1, g: 1, b: 1, a: 1, drag: 0, grav: 0, flutter: 0, sway: 0, fadeIn: 0.05, fadeOut: 0.3, shape: 'puff', hot: false,
    align: false, floor: -1e9, ceil: 1e9, kind: 0, top: false, pop: 0,
  }));
  let cursor = 0, liveCount = 0, spawned = 0, dropped = 0;
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const range = (a: number, b: number) => a + (b - a) * rnd();

  function take(): P | null {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = pool[(cursor + i) % MAX_PARTICLES];
      if (!p.live) { cursor = (cursor + i + 1) % MAX_PARTICLES; p.live = true; liveCount++; spawned++; reset(p); return p; }
    }
    dropped++;
    return null;
  }
  const reset = (p: P) => {
    p.vx = p.vy = p.vz = 0; p.age = 0; p.rot = 0; p.spin = 0; p.drag = 0; p.grav = 0; p.flutter = 0; p.sway = 0;
    p.fadeIn = 0.05; p.fadeOut = 0.3; p.hot = false; p.align = false; p.floor = -1e9; p.ceil = 1e9; p.kind = 0; p.a = 1;
    p.top = false; p.pop = 0;
  };
  const col = (p: P, c: readonly number[]) => { p.r = c[0]; p.g = c[1]; p.b = c[2]; };

  /**
   * Spawn a burst.
   */
  function burst(kind: BurstKind, pos: Vec3Like, o: BurstOpts = NO_OPTS) {
    const { x, y, z } = pos;
    switch (kind) {
      case 'confetti': {
        const n = o.count ?? 40;
        // [FX M3.5] `up` / `spread` scale the launch (the inbox-zero fountain in the Pit, the lantern pop in the air)
        const up = o.up ?? 1, spread = o.spread ?? 1;
        for (let i = 0; i < n; i++) {
          const p = take(); if (!p) return;
          const a = rnd() * Math.PI * 2, s = range(0.6, 1.9) * spread;
          p.x = x; p.y = y + 0.2; p.z = z;
          p.vx = Math.cos(a) * s; p.vz = Math.sin(a) * s; p.vy = range(2.6, 4.4) * up;
          p.grav = -6.5; p.drag = 1.6; p.life = range(1.8, 2.8); p.size = p.size1 = range(0.045, 0.07);
          p.rot = rnd() * 6.28; p.spin = range(-9, 9); p.flutter = range(6, 14); p.shape = 'confetti'; p.hot = true;
          p.floor = (o.floor ?? y - 0.9) + 0.01; p.fadeOut = 0.25;
          col(p, CONFETTI[i % CONFETTI.length]);
        }
        return;
      }
      case 'sparkle': {
        const n = o.count ?? 12;
        for (let i = 0; i < n; i++) {
          const p = take(); if (!p) return;
          const a = rnd() * Math.PI * 2, s = range(0.3, 0.9);
          p.x = x + Math.cos(a) * 0.15; p.y = y + range(-0.1, 0.35); p.z = z + Math.sin(a) * 0.15;
          p.vx = Math.cos(a) * s; p.vz = Math.sin(a) * s; p.vy = range(0.3, 1.2);
          p.grav = -0.6; p.drag = 2.5; p.life = range(0.55, 1.0); p.size = range(0.09, 0.15); p.size1 = 0;
          p.spin = range(-3, 3); p.shape = 'star'; p.fadeOut = 0.4;
          col(p, i % 3 ? C.butter : C.paper);
        }
        return;
      }
      case 'sparks': {
        const n = o.count ?? 10;
        for (let i = 0; i < n; i++) {
          const p = take(); if (!p) return;
          const a = rnd() * Math.PI * 2, s = range(1.2, 2.6);
          p.x = x; p.y = y; p.z = z;
          p.vx = Math.cos(a) * s; p.vz = Math.sin(a) * s; p.vy = range(1, 2.5);
          p.grav = -9; p.drag = 0.8; p.life = range(0.3, 0.55); p.size = p.size1 = range(0.05, 0.08);
          p.shape = 'spark'; p.align = true; p.fadeOut = 0.5; p.floor = o.floor ?? -1e9;
          col(p, i % 2 ? C.spark : C.butter);
        }
        return;
      }
      case 'poof': case 'dust': {
        const n = o.count ?? (kind === 'poof' ? 12 : 8);
        for (let i = 0; i < n; i++) {
          const p = take(); if (!p) return;
          const a = (i / n) * Math.PI * 2 + rnd() * 0.4, s = range(0.7, 1.4) * (kind === 'dust' ? 0.8 : 1);
          p.x = x + Math.cos(a) * 0.1; p.y = (kind === 'dust' ? (o.floor ?? y - 0.8) + 0.08 : y - 0.3) + range(0, 0.25); p.z = z + Math.sin(a) * 0.1;
          p.vx = Math.cos(a) * s; p.vz = Math.sin(a) * s; p.vy = range(0.1, 0.5);
          p.drag = 4; p.life = range(0.5, 0.8); p.size = range(0.12, 0.18); p.size1 = p.size * 2.2;
          p.spin = range(-1, 1); p.shape = 'puff'; p.fadeOut = 0.6; p.a = kind === 'dust' ? 0.55 : 0.85;
          col(p, kind === 'dust' ? C.sand : C.paper);
        }
        return;
      }
      case 'smoke': {
        const n = o.count ?? 9;
        for (let i = 0; i < n; i++) {
          const p = take(); if (!p) return;
          p.x = x + range(-0.15, 0.15); p.y = y + range(0, 0.2); p.z = z + range(-0.15, 0.15);
          p.vx = range(-0.2, 0.2); p.vz = range(-0.2, 0.2); p.vy = range(0.45, 0.8);
          p.drag = 0.8; p.life = range(1.2, 1.9); p.size = range(0.12, 0.2); p.size1 = p.size * 2.6; p.sway = 0.25;
          p.spin = range(-0.8, 0.8); p.shape = 'puff'; p.a = 0.75; p.fadeIn = 0.1; p.fadeOut = 0.6;
          col(p, C.smoke);
        }
        return;
      }
      case 'steam': {
        const p = take(); if (!p) return;
        p.x = x + range(-0.02, 0.02); p.y = y; p.z = z + range(-0.02, 0.02);
        p.vy = range(0.16, 0.26); p.drag = 0.2; p.life = range(1.8, 2.4); p.size = 0.035; p.size1 = 0.11; p.sway = 0.12;
        p.shape = 'puff'; p.a = 0.4; p.fadeIn = 0.2; p.fadeOut = 0.6; p.spin = range(-0.5, 0.5);
        col(p, C.paper);
        return;
      }
      case 'hearts': {
        // [FX M3.5] pat (§6.9 "squash + hearts"): rose hearts bubble up off the head, swaying.
        // [FX fix r1 m2-carry] a fan that pops (squash-scale, `pop`) and drifts up gently (≈ 0.3 m, it stayed in frame
        // only for far cameras); `top`: drawn over the hat / head
        const n = o.count ?? 7;
        for (let i = 0; i < n; i++) {
          const p = take(); if (!p) return;
          const a = (i / n) * Math.PI * 2 + rnd() * 0.6;
          p.x = x + Math.cos(a) * 0.08; p.y = y + range(-0.03, 0.06); p.z = z + Math.sin(a) * 0.08;
          p.vx = Math.cos(a) * range(0.25, 0.45); p.vz = Math.sin(a) * range(0.25, 0.45); p.vy = range(0.3, 0.5);
          p.drag = 2.2; p.life = range(1.3, 1.7); p.size = range(0.075, 0.095); p.size1 = p.size * 1.2; p.sway = 0.15;
          p.rot = range(-0.35, 0.35); p.spin = range(-0.5, 0.5); p.shape = 'heart'; p.fadeIn = 0.02; p.fadeOut = 0.35;
          p.age = -i * 0.045; // a quick ripple of pops, not one blob
          p.top = !!o.top; p.pop = 1; p.grav = 0.25; // a slow float after the pop (terminal ≈ 0.11 m/s)
          col(p, C.white);
        }
        return;
      }
      case 'zzz': {
        const p = take(); if (!p) return;
        p.x = x; p.y = y; p.z = z;
        p.vx = range(0.05, 0.12); p.vy = 0.24; p.drag = 0; p.life = 2.6; p.size = 0.05; p.size1 = 0.11; p.sway = 0.18;
        p.shape = 'z'; p.fadeIn = 0.15; p.fadeOut = 0.35; p.rot = range(-0.25, 0.1);
        col(p, C.white);
        return;
      }
      case 'drop': {
        const p = take(); if (!p) return;
        p.x = x; p.y = y; p.z = z; p.vy = -range(2.6, 3.4); p.life = 1.5; p.size = p.size1 = 0.04;
        p.shape = 'drop'; p.a = 0.85; p.floor = o.floor ?? y - 1.2; p.kind = KIND.drop; p.fadeIn = 0.05; p.fadeOut = 0.05;
        col(p, C.rain);
        return;
      }
      case 'mote': {
        const p = take(); if (!p) return;
        p.x = x + range(-0.35, 0.35); p.y = y + range(-0.1, 0.25); p.z = z + range(-0.35, 0.35);
        p.vx = range(-0.04, 0.04); p.vz = range(-0.04, 0.04); p.vy = range(-0.06, -0.02);
        p.life = range(2.5, 4); p.size = p.size1 = range(0.018, 0.03); p.sway = 0.05; p.shape = 'mote';
        p.a = 0.8; p.fadeIn = 0.3; p.fadeOut = 0.4;
        col(p, C.mote);
        return;
      }
      case 'capsule': {
        // pneumatic capsule (§6.7 commit): shoots up to the ceiling tube, then a thunk puff
        const p = take(); if (!p) return;
        p.x = x; p.y = y + 0.3; p.z = z; p.vy = 1.2; p.grav = 9; p.life = 3; p.size = p.size1 = 0.07;
        p.shape = 'capsule'; p.ceil = o.ceil ?? 2.7; p.kind = KIND.capsule; p.fadeOut = 0.02; p.spin = 0;
        col(p, C.white);
        return;
      }
    }
  }

  let trail = 0;
  /**
   * Simulate and write quads. `R` / `U` = camera right / up (unit).
   */
  function update(dt: number, R: THREE.Vector3, U: THREE.Vector3, t: number) {
    trail += dt;
    const emitTrail = trail > 0.04;
    if (emitTrail) trail = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = pool[i];
      if (!p.live) continue;
      p.age += dt;
      if (p.age < 0) continue; // [FX M3.5] staggered spawn (hearts): waits unseen at its start
      if (p.age >= p.life) { p.live = false; liveCount--; continue; }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vz *= k; p.vy = p.vy * k + p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.sway) { const s = Math.sin(t * 2.3 + i) * p.sway * dt; p.x += s; p.z += s * 0.6; }
      p.rot += p.spin * dt;
      if (p.y < p.floor) {
        if (p.kind === KIND.drop) { p.live = false; liveCount--; continue; }
        p.y = p.floor; p.vy = 0; p.vx *= 0.5; p.vz *= 0.5; p.spin *= 0.3; p.flutter = 0; // confetti settles on the floor
      }
      if (p.kind === KIND.capsule) {
        if (emitTrail) { const q = take(); if (q) { q.x = p.x; q.y = p.y - 0.12; q.z = p.z; q.life = 0.5; q.size = 0.05; q.size1 = 0.12; q.shape = 'puff'; q.a = 0.5; q.fadeOut = 0.7; col(q, C.paper); } }
        if (p.y >= p.ceil) { p.live = false; liveCount--; burst('poof', { x: p.x, y: p.ceil + 0.3, z: p.z }, { count: 6 }); continue; }
      }
    }
    hot.begin(); plain.begin(); if (top !== plain) top.begin();
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = pool[i];
      if (!p.live) continue;
      if (p.age <= 0) continue;
      const u = p.age / p.life;
      let a = p.a * Math.min(1, p.age / Math.max(1e-3, p.fadeIn)) * Math.min(1, (1 - u) / Math.max(1e-3, p.fadeOut));
      if (a <= 0.003) continue;
      const tl = tile(p.shape);
      const size = p.size + (p.size1 - p.size) * u;
      const aspect = tl.h / tl.w;
      let rot = p.rot;
      if (p.align) {
        const vr = p.vx * R.x + p.vy * R.y + p.vz * R.z, vu = p.vx * U.x + p.vy * U.y + p.vz * U.z;
        rot = Math.atan2(vu, vr);
      }
      const c = Math.cos(rot), s = Math.sin(rot);
      const fl = p.flutter ? Math.abs(Math.cos(p.age * p.flutter)) * 0.8 + 0.2 : 1;
      let hw = size * fl, hh = size * aspect;
      if (p.pop) {
        // [FX fix r1 m2-carry] squash-scale pop: 0 → 1.3 overshoot → 1 in ≈ 0.3 s, a wide/tall wobble decaying after
        const k = p.age / POP_S, sc = k >= 1 ? 1 : popScale(k), w = 0.28 * Math.exp(-p.age * 7) * Math.sin(p.age * 26);
        hw *= sc * (1 + w); hh *= sc * (1 - w);
      }
      // rotated billboard axes
      const rx = (R.x * c + U.x * s) * hw, ry = (R.y * c + U.y * s) * hw, rz = (R.z * c + U.z * s) * hw;
      const ux = (-R.x * s + U.x * c) * hh, uy = (-R.y * s + U.y * c) * hh, uz = (-R.z * s + U.z * c) * hh;
      QV[0] = p.x; QV[1] = p.y; QV[2] = p.z; QV[3] = rx; QV[4] = ry; QV[5] = rz; QV[6] = ux; QV[7] = uy; QV[8] = uz;
      QV[9] = tl.u0; QV[10] = tl.v0; QV[11] = tl.u1; QV[12] = tl.v1; QV[13] = p.r; QV[14] = p.g; QV[15] = p.b; QV[16] = a;
      (p.hot ? hot : p.top ? top : plain).pushQ(); // [FX fix m2-r1] staged: no boxed float arguments
    }
    hot.end(); plain.end(); if (top !== plain) top.end();
  }

  return { burst, update, stats: () => ({ live: liveCount, spawned, dropped }) };
}

export type Particles = ReturnType<typeof createParticles>;
