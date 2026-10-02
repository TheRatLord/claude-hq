/**
 * Walkable tops of the summit trail's built pieces (pure maths, no three): the wooden staircase up the east knob, the
 * rope bridge over the saddle and the lookout platform. The trail system publishes them through 'walkSurface'.
 */
import type { TrailAnchors } from '../../world/trail.ts';

type Stairs = TrailAnchors['stairs'];
type Bridge = TrailAnchors['bridge'];
type Summit = TrailAnchors['summit'];

/** Riser height of the staircase, metres (the controller steps up instantly). */
export const STEP = 0.24;

export interface Flight {
  ax: number; az: number; ay: number;
  /** unit run direction (horizontal), and its right-hand normal */
  ux: number; uz: number;
  run: number; rise: number; n: number; width: number;
}
export const flightOf = (s: Stairs): Flight => {
  const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z, run = Math.hypot(dx, dz) || 1, rise = s.b.y - s.a.y;
  return { ax: s.a.x, az: s.a.z, ay: s.a.y, ux: dx / run, uz: dz / run, run, rise, n: Math.max(1, Math.round(rise / STEP)), width: s.width };
};
/** (u along the run, v across it to the right) of a world point */
export const flightLocal = (f: Flight, x: number, z: number, out: { u: number; v: number }) => {
  const dx = x - f.ax, dz = z - f.az;
  out.u = dx * f.ux + dz * f.uz; out.v = dx * -f.uz + dz * f.ux;
  return out;
};
/** top of tread i (0 = the first step up) */
export const treadTop = (f: Flight, i: number): number => f.ay + ((i + 1) * f.rise) / f.n;

const tmp = { u: 0, v: 0 };
/** Tread height under (x, z), or null off the flight. */
export function stairsFloor(f: Flight, x: number, z: number): number | null {
  flightLocal(f, x, z, tmp);
  if (Math.abs(tmp.v) > f.width / 2 + 0.05 || tmp.u < 0.02 || tmp.u > f.run + 0.05) return null;
  const i = Math.min(f.n - 1, Math.floor((tmp.u / f.run) * f.n));
  return treadTop(f, i);
}

export interface Span { ax: number; az: number; ay: number; by: number; ux: number; uz: number; len: number; width: number; sag: number }
export const spanOf = (b: Bridge): Span => {
  const dx = b.b.x - b.a.x, dz = b.b.z - b.a.z, len = Math.hypot(dx, dz) || 1;
  return { ax: b.a.x, az: b.a.z, ay: b.a.y, by: b.b.y, ux: dx / len, uz: dz / len, len, width: b.width, sag: b.sag };
};
/** deck top at fraction t along the bridge (a gentle catenary-ish sag) */
export const deckAt = (s: Span, t: number): number => s.ay + (s.by - s.ay) * t - s.sag * 4 * t * (1 - t);
/** Deck height under (x, z), or null off the bridge. */
export function bridgeFloor(s: Span, x: number, z: number): number | null {
  const dx = x - s.ax, dz = z - s.az;
  const u = dx * s.ux + dz * s.uz, v = -dx * s.uz + dz * s.ux;
  if (Math.abs(v) > s.width / 2 + 0.05 || u < -0.1 || u > s.len + 0.1) return null;
  return deckAt(s, Math.max(0, Math.min(1, u / s.len)));
}

/** Platform deck height under (x, z), or null off it. */
export function platformFloor(p: Summit, x: number, z: number): number | null {
  const dx = x - p.x, dz = z - p.z, c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  if (Math.abs(lx) > p.w / 2 || Math.abs(lz) > p.d / 2) return null;
  return p.y + p.deck;
}
