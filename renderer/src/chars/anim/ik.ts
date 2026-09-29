// @pure
/**
 * IK-lite for Clawd's noodle arms (ART §6.2): aim the arm at a target in the body ("shape") frame and stretch the
 * forearm to reach it. Arm channels: pitch (+ forward), raise (+ out/up from hanging), len (forearm ×). Owner: CHR.
 */
import { CH, type Pose } from './pose.ts';


// Kept in sync with rig/clawd.ts (ARM_X, ARM_Y, UPPER_L, FORE_L, HAND_R); duplicated so this module stays three-free.
export const ARM = Object.freeze({ x: 0.345, y: 0.29, upper: 0.075, fore: 0.065, hand: 0.052 });
export const MAX_LEN = 4.2;
/** Arm geometry (metres). */
export interface ArmGeom { x: number; y: number; upper: number; fore: number; hand: number }

/** Shelly's head-frame arm geometry (rig/shelly.ts mounts the cable arms on the CRT's lower sides). */
export const SHELLY_ARM = Object.freeze({ x: 0.225, y: 0.07, upper: 0.1, fore: 0.1, hand: 0.03 });

/**
 * Noodle-arm reach (ART §6.2): far targets stretch the forearm (up to MAX_LEN ×), near ones bend the elbow (2-bone
 * analytic solve in the arm plane) instead of shrinking the arm to a stub.
 * @param side  −1 left (x−), +1 right (x+) (a plain number: callers loop `side = -1; side <= 1; side += 2`)
 * @param tx target in the shape frame (origin body bottom-centre)
 * @param w blend weight toward the solution
 * @param g arm geometry (default: Clawd)
 */
export function reach(pose: Pose, side: number, tx: number, ty: number, tz: number, w = 1, g: ArmGeom = ARM): void {
  const dx = tx - side * g.x, dy = ty - g.y, dz = tz;
  // [CHR m2 r2 alloc] sqrt, not Math.hypot (a builtin call that boxes its result); no per-call channel arrays
  const h = Math.sqrt(dy * dy + dz * dz);
  const L = Math.sqrt(dx * dx + h * h) || 1e-6;
  const raise = Math.atan2(side * dx, h);
  let pitch = Math.atan2(dz, -dy);
  const want = L - g.hand * 0.7; // shoulder → hand centre
  let len = (want - g.upper) / g.fore, bend = 0;
  if (len < 1) {
    // Too close for a straight arm: keep the forearm at rest length and fold the elbow forward (law of cosines).
    const a = g.upper, c = g.fore, d = Math.max(Math.abs(a - c) + 1e-3, Math.min(a + c, want));
    const inner = Math.acos(Math.min(1, Math.max(-1, (a * a + c * c - d * d) / (2 * a * c))));
    bend = Math.PI - inner;
    pitch -= Math.asin(Math.min(1, (c * Math.sin(inner)) / d)) * 0.9;
    len = 1;
  }
  len = Math.min(MAX_LEN, len);
  const f = pose.f;
  const ip = side < 0 ? CH.aLp : CH.aRp, ir = side < 0 ? CH.aLr : CH.aRr, ib = side < 0 ? CH.aLb : CH.aRb, is = side < 0 ? CH.aLs : CH.aRs;
  f[ip] += (pitch - f[ip]) * w;
  f[ir] += (raise - f[ir]) * w;
  f[ib] += (bend - f[ib]) * w;
  f[is] += (len - f[is]) * w;
}

/** Set an arm's channels directly. */
export function arm(pose: Pose, side: number, pitch: number, raise: number, bend = 0, len = 1): void {
  const f = pose.f;
  if (side < 0) { f[CH.aLp] = pitch; f[CH.aLr] = raise; f[CH.aLb] = bend; f[CH.aLs] = len; }
  else { f[CH.aRp] = pitch; f[CH.aRr] = raise; f[CH.aRb] = bend; f[CH.aRs] = len; }
}
