// @pure
/**
 * Pure locomotion maths for the pen animals (no three.js): gait tables and footfall timing, analytic foot paths
 * that plant without sliding, the two-bone leg solve, staged lie-down / get-up curves and critically damped springs.
 *
 * Foot paths: a gait cycle advances by distance, not time — `phase += speed·dt / (stride·amp)` — and a planted foot
 * sweeps back by exactly `duty·stride·amp` over its stance, so in the body frame it moves back at `speed`: it stays
 * put on the ground. `amp` (0..1) shrinks the stride as the animal slows, so a stopping cow takes smaller steps
 * instead of skating.
 */

export type GaitKind = 'quad' | 'biped';

export interface GaitDef {
  kind: GaitKind;
  /** stride length (rest metres) at a walk and at a trot / run */
  walkStride: number; trotStride: number;
  /** fraction of the cycle a foot is planted */
  walkDuty: number; trotDuty: number;
  /** foot lift height (rest metres) */
  walkLift: number; trotLift: number;
  /** speed (rest m/s) where the walk turns into a trot */
  trotAt: number;
  /** speed (rest m/s) of a full-length walking stride; slower walks take shorter steps */
  fullAt: number;
}

/**
 * Leg order for quadrupeds: 0 LF, 1 RF, 2 LH, 3 RH (hips are listed in this order by every species).
 * Walk = lateral sequence LH → LF → RH → RF (quarter cycle apart); trot = diagonal pairs (LF+RH, RF+LH).
 * RF runs 0.75 → 1.0 (≡ 0) so blending walk → trot never crosses another foot.
 */
export const WALK_OFFSETS = [0.25, 0.75, 0, 0.5] as const;
export const TROT_OFFSETS = [0.5, 1.0, 0, 0.5] as const;
/** bipeds: left, right */
export const BIPED_WALK = [0, 0.5] as const;

export const frac = (v: number): number => v - Math.floor(v);
export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const smoothstep = (a: number, b: number, v: number): number => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** 0 walk … 1 trot for a speed */
export function trotBlend(g: GaitDef, speed: number): number { return smoothstep(g.trotAt * 0.85, g.trotAt * 1.25, speed); }

/** stride amplitude 0..1 for a speed (full stride from `fullAt`) */
export function strideAmp(g: GaitDef, speed: number): number { return clamp(speed / g.fullAt, 0, 1); }

/** effective stride length (rest metres) at a speed */
export function strideLen(g: GaitDef, speed: number): number { return mix(g.walkStride, g.trotStride, trotBlend(g, speed)); }

/** cycles per second → how much `phase` grows this frame (0 when standing still) */
export function phaseStep(g: GaitDef, speed: number, dt: number): number {
  const amp = strideAmp(g, speed);
  if (amp < 0.015) return 0;
  return (speed * dt) / (strideLen(g, speed) * amp);
}

/** a leg's phase offset for the current walk↔trot blend */
export function legOffset(g: GaitDef, leg: number, trot: number): number {
  if (g.kind === 'biped') return BIPED_WALK[leg] ?? 0;
  return mix(WALK_OFFSETS[leg], TROT_OFFSETS[leg], trot);
}

export interface FootOut {
  /** foot position relative to its neutral spot under the hip (rest metres, +z forward) */
  z: number; y: number;
  /** true while the foot bears weight */
  planted: boolean;
  /** 0..1 progress through the current stance or swing */
  t: number;
}

/**
 * Where a foot is at gait `phase` (cycles) for a given speed: stance sweeps back linearly (no slide), swing eases
 * forward on an arc that peaks early (the hoof lifts, then reaches).
 */
export function footAt(g: GaitDef, leg: number, phase: number, speed: number, out: FootOut): FootOut {
  const trot = trotBlend(g, speed), amp = strideAmp(g, speed);
  const duty = mix(g.walkDuty, g.trotDuty, trot), S = strideLen(g, speed) * amp, lift = mix(g.walkLift, g.trotLift, trot) * Math.min(1, amp * 1.6);
  const p = frac(phase + legOffset(g, leg, trot));
  const sweep = duty * S;
  if (p < duty) {
    const t = p / duty;
    out.z = sweep * (0.5 - t); out.y = 0; out.planted = true; out.t = t;
  } else {
    const t = (p - duty) / (1 - duty);
    const e = t * t * (3 - 2 * t);
    out.z = sweep * (-0.5 + e);
    out.y = lift * Math.sin(Math.PI * Math.pow(t, 0.8));
    out.planted = false; out.t = t;
  }
  return out;
}

/** Stance-weighted body rhythm for a phase: vertical bob (≤0, dips as weight lands), lateral roll, head nod. */
export interface Rhythm { bob: number; roll: number; nod: number; pitch: number }
export function rhythm(g: GaitDef, phase: number, speed: number, out: Rhythm): Rhythm {
  const amp = strideAmp(g, speed), trot = trotBlend(g, speed);
  const a = 2 * Math.PI * phase;
  if (g.kind === 'biped') {
    // waddle: roll toward the planted foot, dip twice per cycle, head bob handled by the stabiliser
    out.bob = -(0.5 + 0.5 * Math.cos(2 * a)) * 0.35 * amp;
    out.roll = Math.sin(a) * amp;
    out.nod = 0;
    out.pitch = Math.cos(2 * a) * 0.3 * amp;
    return out;
  }
  // walk: two dips per cycle (hind footfalls at 0 and 0.5), roll over the planted hind leg, nod with the fronts
  const walkBob = -(0.5 + 0.5 * Math.cos(2 * a)) * 0.6;
  const trotBob = -(0.5 + 0.5 * Math.cos(2 * a - 0.6)) * 1.0;
  out.bob = mix(walkBob, trotBob, trot) * amp;
  out.roll = Math.sin(a) * mix(1, 0.3, trot) * amp;
  out.nod = Math.cos(2 * (a - Math.PI * 0.5)) * mix(1, 0.6, trot) * amp;
  out.pitch = Math.sin(2 * a) * mix(0.4, 0.7, trot) * amp;
  return out;
}

/**
 * Chicken head stabiliser: while walking the head holds still in the world for most of each step and then thrusts
 * forward. Returns the head's forward offset (rest metres) relative to its neutral spot.
 */
export function headHold(phase: number, stride: number, amp: number, hold = 0.72): number {
  const q = frac(phase * 2);
  const range = stride * 0.5 * hold * amp * 0.9;
  if (q < hold) return range * (0.5 - q / hold);
  const t = (q - hold) / (1 - hold);
  return range * (-0.5 + t * t * (3 - 2 * t));
}

// ---------------------------------------------------------------------------------------------------------------
// Two-bone leg

export interface LegSolve {
  /** upper bone angle from straight down, + = foot side forward (radians) */
  upper: number;
  /** lower bone angle from straight down */
  lower: number;
  /** knee position relative to the hip (z forward, y up) */
  kz: number; ky: number;
  /** sideways lean of the whole leg (radians about the forward axis) */
  splay: number;
}

/**
 * Solve a two-bone leg from hip to foot (hip-relative dx, dy, dz; y up, z forward). `kneeFwd` picks which way the
 * middle joint points: true for a cow's front knee, false for hocks and bird ankles. The reach is clamped so the
 * joint always keeps a little bend.
 */
export function solveLeg(a: number, b: number, dx: number, dy: number, dz: number, kneeFwd: boolean, out: LegSolve): LegSolve {
  out.splay = Math.atan2(dx, -dy);
  const down = -Math.hypot(dx, dy) * (dy <= 0 ? 1 : -1);
  let c = Math.hypot(dz, down);
  const maxR = (a + b) * 0.985, minR = Math.abs(a - b) + 0.02 * (a + b);
  const base = Math.atan2(dz, -down);
  c = clamp(c, minR, maxR);
  const cosA = clamp((a * a + c * c - b * b) / (2 * a * c), -1, 1);
  const alpha = Math.acos(cosA);
  const u = kneeFwd ? base + alpha : base - alpha;
  out.upper = u;
  out.kz = a * Math.sin(u); out.ky = -a * Math.cos(u);
  const fz = c * Math.sin(base), fy = -c * Math.cos(base);
  out.lower = Math.atan2(fz - out.kz, -(fy - out.ky));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Lying down and getting up

export type LieStyle = 'cow' | 'sheep' | 'pig' | 'bird';

/** Seconds a full lie-down / get-up takes. */
export const LIE_TIME: Record<LieStyle, { down: number; up: number }> = {
  cow: { down: 2.4, up: 2.0 }, sheep: { down: 1.6, up: 1.3 }, pig: { down: 1.5, up: 1.2 }, bird: { down: 0.6, up: 0.45 },
};

/**
 * How far down the front and the hind end are (0 standing … 1 lying) `t` seconds into a transition. Cows (and sheep)
 * go down front knees first and get up hind end first; pigs sit on their haunches first; birds just settle.
 */
export function lieStage(style: LieStyle, down: boolean, t: number, out: { front: number; hind: number } = { front: 0, hind: 0 }): { front: number; hind: number } {
  const T = down ? LIE_TIME[style].down : LIE_TIME[style].up;
  const k = clamp(t / T, 0, 1);
  let front: number, hind: number;
  if (style === 'cow' || style === 'sheep') {
    if (down) { front = smoothstep(0, 0.45, k) * 0.75 + smoothstep(0.7, 1, k) * 0.25; hind = smoothstep(0.35, 0.85, k); }
    else { hind = 1 - smoothstep(0, 0.5, k); front = 1 - smoothstep(0.45, 1, k); }
  } else if (style === 'pig') {
    if (down) { hind = smoothstep(0, 0.5, k); front = smoothstep(0.35, 1, k); }
    else { front = 1 - smoothstep(0, 0.55, k); hind = 1 - smoothstep(0.35, 1, k); }
  } else {
    front = hind = down ? smoothstep(0, 1, k) : 1 - smoothstep(0, 1, k);
  }
  out.front = front; out.hind = hind;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Springs

/** A critically damped spring value (x) with velocity (v). */
export interface Spring { x: number; v: number }
export const spring = (x = 0): Spring => ({ x, v: 0 });

/** Advance a critically damped spring toward `to` with angular frequency `w` (≈ 1/response time). */
export function springTo(s: Spring, to: number, w: number, dt: number): number {
  // exact solution of x'' = -w²(x - to) - 2w x'
  const e = Math.exp(-w * dt);
  const d = s.x - to;
  const j = s.v + w * d;
  s.x = to + (d + j * dt) * e;
  s.v = (s.v - w * j * dt) * e;
  return s.x;
}

/** wrap an angle to (-π, π] */
export const wrapAngle = (a: number): number => (Number.isFinite(a) ? a - 2 * Math.PI * Math.round(a / (2 * Math.PI)) : 0);

/** a spring on an angle (always takes the short way round) */
export function springAngle(s: Spring, to: number, w: number, dt: number): number {
  s.x = wrapAngle(s.x);
  return springTo(s, s.x + wrapAngle(to - s.x), w, dt);
}
