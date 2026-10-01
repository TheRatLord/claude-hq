/**
 * Quadruped locomotion, pure (no three): gait choice with hysteresis, phase-locked footfalls whose stance feet move
 * backwards at exactly the body's ground speed (no foot sliding), a settle step when stopping or turning in place,
 * and a planar two-bone IK. The pets (pets.ts) feed it speed and turn rate and pose its skeleton from the results.
 *
 * Frames: the pet's root frame (x left, y up, z forward; origin on the ground under the body centre). Leg order:
 * 0 LF, 1 RF, 2 LH, 3 RH. Angles about +x: positive swings a hanging limb backwards / tips the nose down.
 */

export type GaitName = 'walk' | 'trot' | 'gallop';

export interface GaitSpec {
  /** metres per cycle at speed v: base + perSpeed * v */
  base: number;
  perSpeed: number;
  /** fraction of a cycle each foot is on the ground */
  duty: number;
  /** touch-down phase per leg (LF, RF, LH, RH) */
  offsets: readonly [number, number, number, number];
  /** swing apex height (m) */
  lift: number;
}

export const GAITS: Record<GaitName, GaitSpec> = {
  // lateral-sequence walk: LH, LF, RH, RF
  walk: { base: 0.34, perSpeed: 0.26, duty: 0.64, offsets: [0.25, 0.75, 0, 0.5], lift: 0.07 },
  // diagonal pairs
  trot: { base: 0.46, perSpeed: 0.2, duty: 0.46, offsets: [0, 0.5, 0.5, 0], lift: 0.1 },
  // rotary gallop with a flight phase after the front feet push off
  gallop: { base: 0.8, perSpeed: 0.2, duty: 0.3, offsets: [0.52, 0.62, 0, 0.1], lift: 0.14 },
};

/** Gait for a speed with hysteresis so it never flickers at a threshold. `scale` = leg length / dog leg length. */
export function pickGait(cur: GaitName, v: number, scale = 1): GaitName {
  const s = v / scale;
  switch (cur) {
    case 'walk': return s > 3.6 ? 'gallop' : s > 1.75 ? 'trot' : 'walk';
    case 'trot': return s > 4.0 ? 'gallop' : s < 1.35 ? 'walk' : 'trot';
    case 'gallop': return s < 1.35 ? 'walk' : s < 3.3 ? 'trot' : 'gallop';
  }
}

export interface Foot {
  /** root-frame position (x left, y up, z forward) */
  x: number; y: number; z: number;
  swing: boolean;
  /** lift-off position of the current swing */
  sx: number; sz: number;
  /** 0..1 progress through the current swing (0 in stance) */
  s: number;
  /** leg phase last frame */
  p: number;
}

export interface LegsOpts {
  /** neutral foot positions, root frame (x, z) per leg */
  neutral: readonly (readonly [number, number])[];
  /** leg length relative to the dog (strides and gait thresholds scale with it) */
  scale: number;
}

const fract = (v: number) => v - Math.floor(v);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (t: number) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

/**
 * Footfall state for four legs. Call `update` once per frame with the body's ground speed (m/s, along its facing)
 * and turn rate (rad/s). Stance feet are carried backwards by exactly the body motion, so they stay put in the world.
 */
export class Legs {
  readonly feet: Foot[] = [];
  gait: GaitName = 'walk';
  /** cycle phase 0..1 */
  phase = 0;
  /** cycles per second right now */
  freq = 0;
  /** blended gait weights (for body motion overlays): walk, trot, gallop */
  readonly w = { walk: 1, trot: 0, gallop: 0 };
  /** 0 standing … 1 fully striding */
  stride = 0;
  private readonly off = [0, 0, 0, 0];
  private readonly o: LegsOpts;
  /** narrow the stance (cats on a fence rail): 0 normal … 1 feet on the centre line */
  narrow = 0;
  constructor(o: LegsOpts) {
    this.o = o;
    for (let i = 0; i < 4; i++) {
      const [x, z] = o.neutral[i];
      this.feet.push({ x, y: 0, z, swing: false, sx: x, sz: z, s: 0, p: 0 });
      this.off[i] = GAITS.walk.offsets[i];
    }
  }

  /** stride length (m per cycle) of the current gait at speed v */
  strideLen(v: number): number { const g = GAITS[this.gait]; return (g.base + g.perSpeed * v / this.o.scale) * this.o.scale; }

  private neutralX(i: number): number { return this.o.neutral[i][0] * (1 - this.narrow * 0.92); }

  /** is any foot away from neutral or airborne (then a stop needs a settle step) */
  unsettled(): boolean {
    for (let i = 0; i < 4; i++) {
      const f = this.feet[i];
      if (f.swing || Math.abs(f.z - this.o.neutral[i][1]) > 0.035 * this.o.scale || Math.abs(f.x - this.neutralX(i)) > 0.03 * this.o.scale) return true;
    }
    return false;
  }

  update(dt: number, v: number, turn: number): void {
    const o = this.o;
    this.gait = pickGait(this.gait, Math.abs(v), o.scale);
    const g = GAITS[this.gait];
    const k = 1 - Math.exp(-dt * 6);
    this.w.walk += ((this.gait === 'walk' ? 1 : 0) - this.w.walk) * k;
    this.w.trot += ((this.gait === 'trot' ? 1 : 0) - this.w.trot) * k;
    this.w.gallop += ((this.gait === 'gallop' ? 1 : 0) - this.w.gallop) * k;
    for (let i = 0; i < 4; i++) this.off[i] += (g.offsets[i] - this.off[i]) * k;
    const av = Math.abs(v);
    const moving = av > 0.04 || Math.abs(turn) > 0.25;
    this.stride += ((moving ? clamp(av / (0.35 * o.scale), 0.35, 1) : 0) - this.stride) * (1 - Math.exp(-dt * 5));
    const S = this.strideLen(av);
    // settle: keep stepping (slowly) until every foot is home when stopped or turning on the spot
    const settle = !moving || av < 0.25 ? (this.unsettled() || Math.abs(turn) > 0.25 ? 1.9 / Math.sqrt(o.scale) : 0) : 0;
    this.freq = Math.max(av / S, settle);
    this.phase = fract(this.phase + this.freq * dt);
    const sweep = S * g.duty * clamp(av / (0.3 * o.scale), 0, 1);
    const swingDur = this.freq > 1e-3 ? (1 - g.duty) / this.freq : 1;
    const c = Math.cos(-turn * dt), sn = Math.sin(-turn * dt);
    for (let i = 0; i < 4; i++) {
      const f = this.feet[i];
      const p = fract(this.phase - this.off[i]);
      const inSwing = p >= g.duty && this.freq > 1e-3;
      // while settling, a foot that is already home stays down
      const home = settle > 0 && Math.abs(f.z - o.neutral[i][1]) < 0.03 * o.scale && Math.abs(f.x - this.neutralX(i)) < 0.025 * o.scale;
      if (inSwing && !f.swing && !home) { f.swing = true; f.sx = f.x; f.sz = f.z; f.s = 0; }
      if (f.swing) {
        // aim for the far end of the next stance: neutral + half the sweep, plus what the body covers during landing
        const tz = o.neutral[i][1] + sweep / 2;
        const tx = this.neutralX(i);
        f.s = clamp(inSwing ? (p - g.duty) / (1 - g.duty) : 1, f.s, 1);
        const e = smooth(f.s);
        // a swing leg reaches forward from its (moving) lift-off point relative to the body
        f.sz -= v * dt; // lift-off point is fixed in the world, so it drifts back in the root frame
        const rx = f.sx * c - f.sz * sn, rz = f.sx * sn + f.sz * c; f.sx = rx; f.sz = rz;
        f.x = f.sx + (tx - f.sx) * e;
        f.z = f.sz + (tz - f.sz) * e;
        f.y = Math.sin(f.s * Math.PI) * g.lift * o.scale * clamp(0.45 + this.stride * 0.8, 0, 1) * (swingDur < 0.08 ? 0.5 : 1);
        if (!inSwing || f.s >= 1) { f.swing = false; f.s = 0; f.x = tx; f.z = tz; f.y = 0; }
      } else {
        // stance: the ground (and the foot on it) slides back under the body at exactly the body speed
        f.z -= v * dt;
        const rx = f.x * c - f.z * sn, rz = f.x * sn + f.z * c; f.x = rx; f.z = rz;
        f.y = 0;
      }
      f.p = p;
    }
  }

  /** snap all feet home (teleports, pose resets) */
  reset(): void {
    for (let i = 0; i < 4; i++) { const f = this.feet[i]; f.x = this.neutralX(i); f.z = this.o.neutral[i][1]; f.y = 0; f.swing = false; f.s = 0; }
    this.stride = 0;
  }
}

// ---------------------------------------------------------------------------------------------
// Planar two-bone IK in a limb's parent frame (y, z plane)

export interface Ik2 { upper: number; lower: number; reach: number }

/**
 * Angles (about +x, 0 = hanging straight down) that put the end of a two-segment limb (lengths a, b) rooted at the
 * origin at (ty, tz). `bend` +1 puts the middle joint behind the line (elbow / hock), −1 in front (knee / stifle).
 * Out-of-reach targets straighten the limb toward them. Writes into `out`.
 */
export function ik2(a: number, b: number, ty: number, tz: number, bend: number, out: Ik2): Ik2 {
  const d0 = Math.hypot(ty, tz);
  const d = clamp(d0, Math.abs(a - b) + 1e-4, a + b - 1e-4);
  // direction angle: 0 = straight down, positive = backwards (−z)
  const base = Math.atan2(-tz, -ty);
  const cu = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const cl = clamp((b * b + d * d - a * a) / (2 * b * d), -1, 1);
  const alpha = Math.acos(cu), gamma = Math.acos(cl);
  const upperAbs = base + bend * alpha;
  const lowerAbs = base - bend * gamma;
  out.upper = upperAbs;
  out.lower = lowerAbs - upperAbs;
  out.reach = d0 / (a + b);
  return out;
}

/** Forward kinematics of `ik2` (tests, debugging): end point of the limb for the given angles. */
export function fk2(a: number, b: number, upper: number, lower: number): { y: number; z: number } {
  const u = upper, l = upper + lower;
  return { y: -Math.cos(u) * a - Math.cos(l) * b, z: -Math.sin(u) * a - Math.sin(l) * b };
}

/** rotate (y, z) about +x by angle t (the three.js convention), in place into `out` */
export function rotX(y: number, z: number, t: number, out: { y: number; z: number }): { y: number; z: number } {
  const c = Math.cos(t), s = Math.sin(t);
  const ny = y * c - z * s, nz = y * s + z * c;
  out.y = ny; out.z = nz;
  return out;
}
