// @pure
/**
 * Analytic floor heights for the full office (§7.1 "floorY"): Pit rings, ENG +0.25, the queue dais +0.15, the stairs ramp
 * `2.9·(16.5 − pz)/7`, mezzanine/landing 2.9 on level 1. All inputs are WORLD coords (plan = world + (20.5, 14)).
 *
 * - `floorY(x, z, level)`: the floor of `level` at (x, z). The stairs ramp belongs to both levels (it is how you change
 *   level), so a walker on the stairs gets the ramp whatever level it thinks it is on.
 * - `floorAt(x, z, y)`: the walking surface under a body whose feet are at `y` (the highest surface ≤ y + 0.35, else
 *   the lowest): what a player or a walker that just moved should snap to. Returns `{y, level}`; `level` flips to 1
 *   once the feet are on the mezzanine, the landing or the upper half of the stairs.
 * Owner: LVL.
 */
import { PLAN_OFFSET } from './schema.ts';
import type { Rect } from './schema.ts';

export const MEZZ_Y = 2.9;
export const ENG_Y = 0.25;
/** Plan-space geometry the heights come from (hq.ts builds walls/nav from the same numbers). */
export const PIT = Object.freeze({ cx: 20.5, cz: 14, rings: [[4.0, -0.15], [3.4, -0.3], [2.8, -0.45]] as const });
export const STAIRS = Object.freeze({ x0: 26.3, x1: 28, zFoot: 16.5, zTop: 9.5, rise: MEZZ_Y });
export const MEZZ_RECTS: readonly Rect[] = Object.freeze<Rect[]>([[14, 0, 28, 7], [26, 7, 28, 9.5]]); // mezzanine + landing (plan x0,z0,x1,z1)
export const ENG_RECT: Rect = [28, 11, 42, 20];
/** The roped queue lane stands on a low dais so the queue reads over the Help Desk counter from the spawn (P1).
 *  [LVL fix r2] the lane is an L (rows A+B, then row C's two cells), 0.15 m high (plan rects; hq.ts ropes it). */
export const QUEUE_DAIS = Object.freeze({ rects: Object.freeze<Rect[]>([[14.65, 19.0, 18.4, 20.9], [15.55, 18.1, 17.55, 19.0]]), y: 0.15 });
/** Level switch on the stairs: feet above this are on level 1 (half the rise). */
export const LEVEL_SPLIT_Y = MEZZ_Y / 2;

const inR = (r: readonly number[], px: number, pz: number) => px >= r[0] && px <= r[2] && pz >= r[1] && pz <= r[3];

/** Stairs ramp height at plan z (clamped), or null when (px, pz) is not over the stairs. */
export function stairsY(px: number, pz: number): number | null {
  if (px < STAIRS.x0 || px > STAIRS.x1 || pz < STAIRS.zTop || pz > STAIRS.zFoot) return null;
  return STAIRS.rise * (STAIRS.zFoot - pz) / (STAIRS.zFoot - STAIRS.zTop);
}

/** Ground (level 0) height at plan (px, pz): Pit steps, ENG platform, else 0. */
export function groundY(px: number, pz: number): number {
  const d = Math.hypot(px - PIT.cx, pz - PIT.cz);
  if (d < PIT.rings[0][0]) {
    let y = 0;
    for (const [r, h] of PIT.rings) if (d < r) y = h;
    return y;
  }
  if (inR(ENG_RECT, px, pz)) return ENG_Y;
  if (QUEUE_DAIS.rects.some((r) => inR(r, px, pz))) return QUEUE_DAIS.y;
  return 0;
}

export const onMezz = (px: number, pz: number): boolean => MEZZ_RECTS.some((r) => inR(r, px, pz));

/** `x`, `z` in world coords. */
export function floorY(x: number, z: number, level = 0): number {
  const px = x + PLAN_OFFSET.x, pz = z + PLAN_OFFSET.z;
  const s = stairsY(px, pz);
  if (s !== null) return s;
  if (level === 1 && onMezz(px, pz)) return MEZZ_Y;
  return groundY(px, pz);
}

/** `x`, `z` in world coords, `y` = current feet height. */
export function floorAt(x: number, z: number, y: number): { y: number; level: 0 | 1 } {
  const px = x + PLAN_OFFSET.x, pz = z + PLAN_OFFSET.z;
  const s = stairsY(px, pz);
  if (s !== null) return { y: s, level: s > LEVEL_SPLIT_Y ? 1 : 0 };
  const g = groundY(px, pz);
  if (onMezz(px, pz) && y > MEZZ_Y - 0.35 - 0.3) return { y: MEZZ_Y, level: 1 }; // up here already (or stepping off the ramp)
  return { y: g, level: 0 };
}
