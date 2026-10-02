/**
 * Wild visitors' motion, pure (no three): rig channels (see the tables in wildModels.ts) + a body transform for one
 * moment. The scene (wildlife.ts) and the gallery flipbooks (wildAssets.ts) drive the same functions.
 *
 * Quadrupeds walk / trot / gallop on `Legs` (gait.ts: planted stance feet, no sliding) with two-bone IK into the
 * rig's upper / lower leg channels.
 */
import { Legs, ik2, rotX } from './gait.ts';
import type { Ik2 } from './gait.ts';
import type { Body } from './critterAnim.ts';
import type { QuadDims } from './wildModels.ts';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (t: number) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const fract = (v: number) => v - Math.floor(v);
const TAU = Math.PI * 2;
export const resetBody = (b: Body) => { b.y = 0; b.pitch = 0; b.roll = 0; b.sx = 1; b.sy = 1; b.sz = 1; };

// ---------------------------------------------------------------------------------------------
// Quadrupeds

interface LegRest { hy: number; hz: number; a: number; b: number; restU: number; restL: number; bend: number }
export interface QuadRig { dims: QuadDims; legs: LegRest[]; neutral: [number, number][]; scale: number }

/** precompute rest angles / lengths for a quadruped (scale: leg length relative to the dog's, for gait thresholds) */
export function quadRig(dims: QuadDims): QuadRig {
  const legs = dims.legs.map((g) => {
    const [, hy, hz] = g.hip, [, ky, kz] = g.knee, [, fy, fz] = g.foot;
    const a = Math.hypot(ky - hy, kz - hz), b = Math.hypot(fy - ky, fz - kz);
    const restU = Math.atan2(-(kz - hz), -(ky - hy));
    const restL = Math.atan2(-(fz - kz), -(fy - ky)) - restU;
    // which side of the hip→foot line the joint sits on: behind (−z) = +1
    const lineZ = hz + (fz - hz) * ((ky - hy) / (fy - hy));
    return { hy, hz, a, b, restU, restL, bend: kz < lineZ ? 1 : -1 };
  });
  const len = (legs[0].a + legs[0].b + legs[2].a + legs[2].b) / 2;
  return { dims, legs, neutral: dims.legs.map((g) => [g.hip[0], g.foot[2]] as [number, number]), scale: len / 0.36 };
}

export const quadLegs = (r: QuadRig): Legs => new Legs({ neutral: r.neutral, scale: r.scale });

const _r = { y: 0, z: 0 };
const _ik: Ik2 = { upper: 0, lower: 0, reach: 0 };

/**
 * Pose the legs: feet from `legs` (or standing neutral when null), corrected for the body's lift and pitch.
 * `fold` 0..1 tucks every leg up under the body (lying down / the fawn curled in the grass). `ground` = terrain height
 * under each foot relative to the body origin (model units), so feet stand on slopes.
 */
export function quadLegPose(r: QuadRig, legs: Legs | null, b: Body, ch: Float32Array, fold = 0, ground?: Float32Array): void {
  for (let i = 0; i < 4; i++) {
    const L = r.legs[i];
    const f = legs?.feet[i];
    const fy = (f ? f.y : 0) + (ground ? ground[i] : 0), fz = f ? f.z : r.neutral[i][1];
    rotX(fy - b.y, fz, -b.pitch, _r);
    ik2(L.a, L.b, _r.y - L.hy, _r.z - L.hz, L.bend, _ik);
    let u = _ik.upper - L.restU, l = _ik.lower - L.restL;
    if (fold > 0) {
      // fold: fore legs tuck back under the chest, hind legs fold forward under the belly
      const fu = i < 2 ? 1.2 : -0.9, fl = i < 2 ? -2.2 : 2.0;
      u += (fu - u) * fold; l += (fl - l) * fold;
    }
    ch[4 + i] = u; ch[8 + i] = l;
  }
}

/** body bob / pitch from the gait: walk nods gently, trot bounces, gallop rocks with a flight phase */
export function quadBody(legs: Legs, b: Body, k = 1): void {
  const p = legs.phase, w = legs.w, s = legs.stride * k;
  b.y += (Math.abs(Math.sin(p * TAU * 2)) * 0.008 * w.walk + Math.abs(Math.sin(p * TAU * 2)) * 0.02 * w.trot + Math.max(0, Math.sin(p * TAU - 0.6)) * 0.07 * w.gallop) * s;
  b.pitch += (Math.sin(p * TAU * 2) * 0.012 * w.walk + Math.sin(p * TAU + 0.4) * 0.12 * w.gallop) * s;
  b.roll += Math.sin(p * TAU) * 0.015 * w.walk * s;
}

export interface QuadHead {
  /** neck pitch (+ nose down; grazing ≈ 1.3) */
  neck: number;
  yaw: number;
  /** ears: +1 pricked … −0.6 laid back */
  ears: number;
  /** tail: + raised (the deer's white flag) */
  tail: number;
}

/** head / ears / tail channels (0..3) */
export function quadHead(h: QuadHead, ch: Float32Array): void {
  ch[0] = h.neck; ch[1] = h.yaw; ch[2] = h.ears; ch[3] = h.tail;
}

/**
 * A grazing loop at time t: head down cropping with little tugs, now and then up to chew and look about.
 * Returns the neck pitch; writes yaw into h.
 */
export function grazeNeck(t: number, seed: number, h: QuadHead): number {
  const c = fract(t / 9 + seed);
  const up = c > 0.72 ? smooth((c - 0.72) / 0.06) * (1 - smooth((c - 0.94) / 0.06)) : 0;
  const tug = Math.max(0, Math.sin(t * 5.5 + seed * 7)) * 0.06;
  h.yaw = up * Math.sin(t * 0.9 + seed) * 0.5 + (1 - up) * Math.sin(t * 0.4 + seed * 3) * 0.12;
  return (1 - up) * (1.25 + tug) + up * -0.05;
}

// ---------------------------------------------------------------------------------------------
// Heron

export interface HeronPose {
  /** 0 neck tucked (resting) … 1 neck up and out (watching / hunting) */
  reach: number;
  /** strike 0..1 (a stab and back) */
  strike: number;
  yaw: number;
  /** stalking stride phase (−1 standing) */
  stride: number;
  crest: number;
}

export function heronStand(t: number, o: HeronPose, ch: Float32Array, b: Body): void {
  ch.fill(0); resetBody(b);
  // reach: neck leans forward and the head levels out; the S straightens
  const r = o.reach;
  const s = Math.sin(clamp(o.strike, 0, 1) * Math.PI);
  ch[0] = -0.25 + r * 0.45 + s * 0.55;
  ch[1] = 0.15 + r * 0.25 + s * 0.45 + Math.sin(t * 0.7) * 0.03;
  ch[2] = s * 0.14;
  ch[3] = o.yaw;
  ch[5] = 0;
  ch[11] = o.crest + Math.sin(t * 1.3) * 0.08;
  b.pitch = -0.08 + r * 0.05 + s * 0.12;
  b.y = Math.sin(t * 1.1) * 0.002;
  if (o.stride >= 0) {
    // a slow high-stepping wade: one leg lifts (knee back), swings forward and sets down
    const p = fract(o.stride), side = p < 0.5 ? 0 : 1, k = Math.sin(fract(p * 2) * Math.PI);
    const legs = [7, 8], knees = [9, 10];
    ch[legs[side]] = -0.35 * k; ch[knees[side]] = 0.9 * k;
    ch[legs[1 - side]] = 0.12 * k;
    b.y += k * 0.01;
  }
}

/** flight: deep slow beats, neck pulled back into the shoulders, legs trailing */
export function heronFly(ph: number, t: number, glide: number, ch: Float32Array, b: Body): void {
  ch.fill(0); resetBody(b);
  const p = fract(ph);
  const beat = Math.sin(p * TAU);
  ch[4] = (1 - glide) * beat * 0.75 + glide * 0.08 + 0.05;
  ch[6] = (1 - glide) * Math.max(0, Math.cos(p * TAU)) * 0.5;
  ch[5] = 1;
  ch[0] = -0.9; ch[1] = 0.9; ch[3] = 0;
  ch[7] = ch[8] = 1.45; ch[9] = ch[10] = -0.1;
  b.pitch = -0.05; b.y = -beat * 0.012 + Math.sin(t * 1.3) * 0.004;
}

/** take-off / landing: legs dangling, wings in big beats, neck half out (k 0 on the ground … 1 airborne) */
export function heronLift(ph: number, k: number, ch: Float32Array, b: Body): void {
  heronFly(ph, 0, 0, ch, b);
  const g = 1 - smooth(k);
  ch[7] = ch[8] = 1.45 * (1 - g) + 0.3 * g;
  ch[9] = ch[10] = 0.6 * g;
  ch[0] = -0.9 * (1 - g) + -0.1 * g;
  ch[1] = 0.9 * (1 - g) + 0.3 * g;
  b.pitch = -0.35 * g;
}

// ---------------------------------------------------------------------------------------------
// Owl

export interface OwlPose { yaw: number; tilt: number; blink: number; fluff: number; tufts: number; hoot: number }

export function owlPerch(t: number, o: OwlPose, ch: Float32Array, b: Body): void {
  ch.fill(0); resetBody(b);
  ch[0] = o.yaw; ch[1] = o.tilt;
  ch[2] = -1 + clamp(o.blink, 0, 1);
  ch[4] = 0; ch[6] = 0; ch[7] = Math.sin(t * 0.8) * 0.05;
  ch[9] = o.tufts;
  const breath = Math.sin(t * 1.6) * 0.012;
  // a hoot: the throat swells, the head dips a touch
  b.sy = 1 + breath + o.fluff * 0.04 + o.hoot * 0.03;
  b.sx = b.sz = 1 + o.fluff * 0.06 + o.hoot * 0.05;
  b.pitch = o.hoot * 0.12;
}

/** silent flight: broad beats then long glides, feet tucked */
export function owlFly(ph: number, glide: number, ch: Float32Array, b: Body): void {
  ch.fill(0); resetBody(b);
  const p = fract(ph), beat = Math.sin(p * TAU);
  ch[4] = 1;
  ch[3] = (1 - glide) * beat * 0.85 + glide * 0.12;
  ch[5] = (1 - glide) * Math.max(0, Math.cos(p * TAU)) * 0.55;
  ch[2] = -1; ch[6] = 1.2; ch[7] = 0.2; ch[9] = -0.4;
  b.pitch = 0.75; b.y = 0.12 - beat * 0.015;
}

// ---------------------------------------------------------------------------------------------
// Hedgehog

/** trundling: quick little steps (phase), nose working the ground; `curl` 0..1 rolls it into a ball */
export function hogPose(t: number, ph: number, moving: number, curl: number, sniff: number, yaw: number, ch: Float32Array, b: Body): void {
  ch.fill(0); resetBody(b);
  const p = fract(ph) * TAU;
  const step = moving * (1 - curl);
  ch[4] = Math.sin(p) * 0.6 * step; ch[7] = Math.sin(p) * 0.6 * step;
  ch[5] = -Math.sin(p) * 0.6 * step; ch[6] = -Math.sin(p) * 0.6 * step;
  ch[0] = (0.25 + Math.max(0, Math.sin(t * 3.1)) * 0.25 * sniff) * (1 - curl) + curl * 1.7;
  ch[1] = yaw * (1 - curl);
  ch[2] = Math.max(0, Math.sin(t * 19)) * 0.25 * sniff * (1 - curl) - curl * 0.6;
  ch[3] = -curl;
  ch[8] = curl * 0.12;
  b.y = Math.abs(Math.sin(p)) * 0.006 * step + curl * 0.03;
  b.roll = Math.sin(p) * 0.04 * step;
  b.pitch = curl * 0.55;
  b.sz = 1 - curl * 0.22; b.sy = 1 + curl * 0.15; b.sx = 1 + curl * 0.03;
}

// ---------------------------------------------------------------------------------------------
// Goose

export function gooseFly(ph: number, t: number, ch: Float32Array, b: Body): void {
  ch.fill(0); resetBody(b);
  const p = fract(ph), beat = Math.sin(p * TAU);
  ch[0] = beat * 0.55 + 0.05;
  ch[1] = Math.max(0, Math.cos(p * TAU)) * 0.45;
  ch[2] = -beat * 0.06 + Math.sin(t * 0.7) * 0.03;
  b.y = -beat * 0.02;
}
