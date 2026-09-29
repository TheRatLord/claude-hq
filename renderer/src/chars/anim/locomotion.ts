// @pure
/**
 * Locomotion layer (ART §6.3): trot (default), waddle, skip; idle weight-shift when standing. Writes a full pose;
 * speed/lean/bank springs live in the animator. Owner: CHR.
 */
import { CH, ARM_REST, type Pose } from './pose.ts';
import { noise1 } from './noise.ts';

const TAU = Math.PI * 2;
const sm = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

export interface LocomotionState { speed: number; phase: number; style: string; energy: number; t: number; seed: number; amp: number }

/** @param p  (reset by the caller) */
export function locomotion(p: Pose, s: LocomotionState): void {
  const f = p.f;
  const m = sm(0.04, 0.35, s.speed);
  const amp = s.amp;
  // ---- idle weight shift (never fully still, ART §6.1 #5) ----
  const ws = Math.sin(s.t * 0.9 + s.seed) ;
  f[CH.roll] = 0.03 * ws * (1 - m) * amp;
  f[CH.hipX] = 0.012 * ws * (1 - m);
  f[CH.twist] = 0.06 * noise1(s.t * 0.25, s.seed) * (1 - m);
  f[CH.l0y] = Math.max(0, -ws) * 0.012 * (1 - m);
  f[CH.l2y] = Math.max(0, -ws) * 0.008 * (1 - m);
  f[CH.l1y] = Math.max(0, ws) * 0.012 * (1 - m);
  f[CH.l3y] = Math.max(0, ws) * 0.008 * (1 - m);
  f[CH.aLp] = 0.08 * noise1(s.t * 0.4, s.seed + 3);
  f[CH.aRp] = 0.08 * noise1(s.t * 0.4, s.seed + 9);
  if (m <= 0) return;

  // ---- gait ----
  const ph = s.phase * TAU; // one stride = two steps
  const run = sm(1.2, 2.4, s.speed);
  let bobA = 0.05, sqA = 0.09, pitch = 0.14 + 0.12 * run, armA = 0.6 + 0.25 * run, legSwing = 0.6, legLift = 0.07, roll = 0.05 * Math.sin(ph), twist = 0.07 * Math.sin(ph);
  let steps = Math.abs(Math.sin(ph)); // two bumps per stride
  if (s.style === 'waddle') { bobA = 0.025; sqA = 0.045; roll = 0.15 * Math.sin(ph); twist = 0.1 * Math.sin(ph); legSwing = 0.32; armA = 0.35; }
  let hipY = steps * bobA;
  let sq = (-0.6 + steps * 1.0) * sqA; // contact squash → mid-air stretch
  if (s.style === 'skip') {
    const hop = Math.max(0, Math.sin(ph));
    hipY = Math.pow(hop, 0.7) * 0.1;
    sq = hop > 0.05 ? 0.12 * Math.sin(Math.min(1, hop) * Math.PI * 0.5) : -0.16;
    armA = 0.8;
  }
  if (s.style === 'dash') {
    // [CHR M3.5] Work-call dash (§11.5, > 3 m/s): a cartoon sprint. Leaning hard into it, arms swept back and
    // flapping, legs whirling as wheels (big forward/back swing + high lift, animator smears them), a stretched body.
    const wheel = Math.sin(ph);
    hipY = 0.035 * Math.abs(Math.sin(ph * 2));
    sq = 0.1 - 0.05 * Math.abs(wheel);
    pitch = 0.36; roll = 0.06 * Math.sin(ph); twist = 0.12 * Math.sin(ph);
    f[CH.hipY] = hipY * m * amp; f[CH.sq] = sq * m * amp; f[CH.pitch] = pitch * m;
    f[CH.roll] += roll * m * amp; f[CH.twist] += twist * m;
    const flap = 0.25 * Math.sin(ph * 2);
    f[CH.aLp] = (-1.25 + flap) * m; f[CH.aRp] = (-1.25 - flap) * m;
    f[CH.aLr] = f[CH.aRr] = ARM_REST - 0.45 * m;
    f[CH.aLs] = f[CH.aRs] = 1 + 0.5 * m;
    for (let i = 0; i < 4; i++) {
      const lp = ph + (i === 0 || i === 3 ? 0 : Math.PI);
      f[CH.l0y + i * 2] = (0.03 + 0.09 * Math.max(0, Math.sin(lp))) * m;
      f[CH.l0s + i * 2] = 1.15 * Math.cos(lp) * m;
    }
    return;
  }
  f[CH.hipY] = hipY * m * amp;
  f[CH.sq] = sq * m * amp;
  f[CH.pitch] = pitch * m;
  f[CH.roll] += roll * m * amp;
  f[CH.twist] += twist * m;
  const swing = Math.sin(ph) * armA * m * amp;
  f[CH.aLp] += swing; f[CH.aRp] -= swing;
  f[CH.aLr] = ARM_REST - 0.2 * m + 0.15 * run * Math.abs(Math.sin(ph)); f[CH.aRr] = f[CH.aLr];
  f[CH.aLb] = 0.25 * m * (0.5 + 0.5 * Math.sin(ph)); f[CH.aRb] = 0.25 * m * (0.5 - 0.5 * Math.sin(ph));
  // Diagonal pairs: FL(0)+BR(3) vs FR(1)+BL(2).
  for (let i = 0; i < 4; i++) {
    const lp = ph + (i === 0 || i === 3 ? 0 : Math.PI);
    f[CH.l0y + i * 2] = Math.max(0, Math.sin(lp)) * legLift * m * amp;
    f[CH.l0s + i * 2] = Math.cos(lp) * legSwing * m * amp;
  }
}

/** Stride frequency (strides/s) for a speed. */
export function strideHz(speed: number, style: string, energy: number): number {
  if (style === 'dash') return 2.6 * Math.sqrt(Math.max(1, speed) / 3); // [CHR M3.5] whirling wheel-legs
  const base = style === 'waddle' ? 1.1 : style === 'skip' ? 1.3 : 1.5;
  return base * Math.sqrt(energy) * Math.sqrt(Math.max(0.35, speed) / 0.9);
}
