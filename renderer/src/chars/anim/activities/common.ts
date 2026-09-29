// @pure
/** Shared activity helpers. Owner: CHR. */
import { CH, M, type Pose } from '../pose.ts';

/** Hip lift that puts the body bottom on a 0.32 m chair seat (legs 0.16 + clearance). */
export const SEAT_OFF = 0.17;
export const TAU = Math.PI * 2;

/**
 * Seated base (the animator adds the SEAT_OFF lift itself): legs dangling forward over the edge with a lazy alternating kick.
 */
export function sitBase(p: Pose, t: number, kick = 1): void {
  const f = p.f;
  for (let i = 0; i < 4; i++) {
    const front = i < 2;
    const k = Math.sin(t * 2.4 + i * 1.7) * 0.22 * kick;
    f[CH.l0s + i * 2] = (front ? 1.25 : 1.05) + k;
    f[CH.l0y + i * 2] = 0;
  }
}

/** Short hop curve: returns {y, sq} for local time u seconds into a hop of airtime `air` and height `h`. */
export function hopCurve(u: number, air = 0.3, h = 0.08, crouch = 0.08): { y: number; sq: number } {
  if (u < crouch) { const k = u / crouch; return { y: -0.015 * k, sq: -0.16 * k }; }
  const v = (u - crouch) / air;
  if (v < 1) return { y: h * 4 * v * (1 - v), sq: 0.14 * (1 - v) - 0.02 };
  const w = u - crouch - air;
  return { y: 0, sq: -0.2 * Math.exp(-w * 10) * Math.cos(w * 24) };
}

export const pulse = (t: number, period: number, dur: number): number => { const u = ((t % period) + period) % period; return u < dur ? u : -1; };

/** Masks: standing activities keep the locomotion layer's idle leg weight-shift; walking variants own arms + prop. */
export const STAND = M.BODY | M.ARMS | M.FACE | M.PROP;
export const WALK = M.ARMS | M.PROP | M.FACE;

/**
 * Show a held prop and place its root in the body ("shape") frame (origin at the body's bottom centre, +z forward).
 */
export function hold(p: Pose, id: string, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): void {
  const f = p.f;
  p.prop = id;
  f[CH.propX] = x; f[CH.propY] = y; f[CH.propZ] = z; f[CH.propRx] = rx; f[CH.propRy] = ry; f[CH.propRz] = rz;
}

/** Smooth 0→1→0 envelope of local time u over [0, d] (sin hump). */
export const hump = (u: number, d: number): number => (u <= 0 || u >= d ? 0 : Math.sin((u / d) * Math.PI));
/** Clamp to [0, 1]. */
export const sat = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Sawtooth phase 0..1 of t at hz. */
export const saw = (t: number, hz: number): number => { const x = t * hz; return x - Math.floor(x); };
/** Back-out ease with an overshoot (snap poses). */
export const snap = (u: number, c = 2.2): number => { const k = sat(u) - 1; return 1 + (c + 1) * k * k * k + c * k * k; };

/**
 * `grep` prop geometry, shared by rig/props.ts (places it) and the activity (aims the hand). [CHR fix r3] The open book
 * stands propped on the desk (spine centre `GREP_BOOK_H` up, top tipped `GREP_TILT` away from Clawd, pages toward it)
 * instead of lying flat where the monitor and the body hid it; the lens sweeps its pages (propB −1..1) and on "found!"
 * (propC 0→1) is thrust up over Clawd's head, visible from every side.
 */
export const GREP_TILT = 0.45, GREP_TOME = 1.25, GREP_BOOK_H = 0.125, GREP_MAG_L = 0.155; // GREP_TOME: book scale (a big tome)
/**
 * [CHR fix m3-r3] Walk-up: the tome lies down (propA = lay 0..1) to GREP_TILT_FLAT from the vertical, its bottom edge
 * still on the desk (spine centre height = half the tome × cos tilt), so it no longer stands in front of the face.
 */
export const GREP_TILT_FLAT = 1.3;
const GREP_HALF = 0.11 * GREP_TOME;
/** Tome tilt from the vertical (top away from Clawd) for the lay channel. */
export const grepTilt = (f: Float32Array): number => GREP_TILT + (GREP_TILT_FLAT - GREP_TILT) * Math.max(0, Math.min(1, f[CH.propA]));
/** Spine centre height above the prop root (the desk) for a tilt: the bottom edge stays on the desk. */
export const grepBookH = (tilt: number): number => GREP_BOOK_H + GREP_HALF * (Math.cos(tilt) - Math.cos(GREP_TILT));
const GREP_UP = [0.21, 0.52, -0.1] as const; // thrust target (prop frame): up beside the hat
/** Lens centre in the prop root frame. */
export const grepLens = (f: Float32Array): [number, number, number] => {
  const c = f[CH.propC], s = 1 - c;
  const x = 0.15 * f[CH.propB], v = -0.01; // page point (book-local): across the spread, on the middle line
  const tilt = grepTilt(f), ct = Math.cos(tilt), st = Math.sin(tilt);
  // book-local (−x, v, 0) tipped by the tilt, lifted to the spine, 6 cm off the pages toward Clawd
  const px = x, py = grepBookH(tilt) + v * ct + 0.06 * st, pz = v * st - 0.06 * ct;
  return [px * s + GREP_UP[0] * c, py * s + GREP_UP[1] * c, pz * s + GREP_UP[2] * c];
};
/** Magnifier Euler (XYZ) in the prop frame: lens parallel to the pages while sweeping, upright + jaunty when thrust. */
export const grepMagRot = (f: Float32Array): [number, number, number] => {
  const c = f[CH.propC];
  return [grepTilt(f) * (1 - c) - 0.15 * c, 0, -0.2 * (1 - c) + 0.35 * c];
};
/** Grip (the magnifier root, handle end) in the prop frame = lens − R·(0, GREP_MAG_L, 0). */
export const grepGrip = (f: Float32Array): [number, number, number] => {
  const [lx, ly, lz] = grepLens(f);
  const [rx, , rz] = grepMagRot(f);
  const L = GREP_MAG_L;
  return [lx + L * Math.sin(rz), ly - L * Math.cos(rz) * Math.cos(rx), lz - L * Math.cos(rz) * Math.sin(rx)];
};
