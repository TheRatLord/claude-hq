// @pure
/**
 * Level portals (§6.6): the stairs (two-way, walked as a ramp) and the slide (one-way, ridden). A portal hop is
 * `a → b` (and `b → a` when two-way). Routes chain: leg on the start level → portal → leg on the goal level.
 * Owner: LVL.
 */
import type { NavPointRef, Portal, Vec3 } from '../layout/schema.ts';

export interface Hop { portal: Portal; enter: NavPointRef; exit: NavPointRef; path: readonly Vec3[] }

/**
 * Directed hops available from level `from` to level `to`.
 */
export function hops(portals: readonly Portal[] | undefined, from: number, to: number): Hop[] {
  const out: Hop[] = [];
  for (const p of portals ?? []) {
    if (p.a.level === from && p.b.level === to) out.push({ portal: p, enter: p.a, exit: p.b, path: p.path ?? [] });
    if (p.twoWay && p.b.level === from && p.a.level === to) out.push({ portal: p, enter: p.b, exit: p.a, path: [...(p.path ?? [])].reverse() });
  }
  return out;
}

/** Polyline length (x/z). */
export const polyLen = (pts: readonly { x: number; z: number }[]): number => { let d = 0; for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z); return d; };
