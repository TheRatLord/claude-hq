// @pure
/**
 * Renderer cosmetic RNG (`?seed=`). Anything identity-bound uses `seeded(key)` so every window agrees;
 * `rng()` is for cosmetics only (particles, jitter).
 */
import { hash32, mulberry32 } from '../../../shared/identity.ts';

let base = 0x9e3779b9;
let stream = mulberry32(base);

/** Reseed the global cosmetic stream (boot calls this with `?seed`). */
export function setSeed(seed: number | string): void {
  base = typeof seed === 'number' ? seed >>> 0 : hash32(String(seed));
  stream = mulberry32(base);
}
/** [0,1) from the global cosmetic stream */
export const rng = (): number => stream();
/** Deterministic per-key stream, independent of the global seed. */
export const seeded = (key: string): (() => number) => mulberry32(hash32(key));
export const range = (a: number, b: number, r: () => number = rng): number => a + (b - a) * r();
export const pick = <T>(arr: readonly T[], r: () => number = rng): T => arr[Math.floor(r() * arr.length)];
