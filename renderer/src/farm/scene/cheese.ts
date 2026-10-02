/**
 * "Say cheese" (photo mode, farm/photo.ts → service 'photo' → `PhotoService.cheese()`): how much someone standing at
 * (x, z) should play to the camera right now. 0 = carry on; up to 1 = turn to the lens, look into it and smile; the
 * subject in focus gets 1 and does a little pose (a wave, a cheer). Shared by the farmers, the villagers and your pet;
 * no three, no allocation.
 */
import type { CheeseCue, PhotoService } from './context.ts';

/** how far from the camera people still notice it (m) */
export const CHEESE_RANGE = 18;

/** the live cue from the photo service (null when there is none or it ran out) */
export function cheeseCue(svc: unknown, now = performance.now()): CheeseCue | null {
  const c = (svc as PhotoService | undefined)?.cheese?.() ?? null;
  return c && now >= c.from && now < c.until ? c : null;
}

/**
 * 0..1: the focused subject 1; anyone else in front of the camera within CHEESE_RANGE fades out with distance and
 * with how far off the view axis they stand. Ramps in over the first 0.25 s and out over the last 0.4 s.
 */
export function cheeseWeight(c: CheeseCue | null, x: number, z: number, id: string, now = performance.now()): number {
  if (!c) return 0;
  const ramp = Math.min(1, (now - c.from) / 250, (c.until - now) / 400);
  if (ramp <= 0) return 0;
  if (c.focus !== null && c.focus === id) return ramp;
  const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz);
  if (d > CHEESE_RANGE || d < 0.2) return 0;
  const front = (dx * c.dx + dz * c.dz) / d;
  if (front < 0.55) return 0;
  return ramp * Math.min(1, (front - 0.55) / 0.25) * Math.min(1, (CHEESE_RANGE - d) / 5);
}

/** is this the subject in focus (the one who poses)? */
export const cheeseFocus = (c: CheeseCue | null, id: string): boolean => !!c && c.focus === id;
