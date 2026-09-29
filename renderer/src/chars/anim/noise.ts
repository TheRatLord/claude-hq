// @pure
/** Cheap smooth 1D value noise in [-1, 1] (sway, look-around, hand jitter). Owner: CHR. */

const hash = (i: number, seed: number) => {
  let h = (Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(seed | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

/** −1..1, C1-smooth */
export function noise1(t: number, seed = 0): number {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  // [CHR m2 r2 alloc] hash() spelled out twice (same bits): a non-inlined hash() boxed its double result per call
  const sm = Math.imul(seed | 0, 0x165667b1);
  let h = (Math.imul(i | 0, 0x27d4eb2d) ^ sm) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  let g = (Math.imul((i + 1) | 0, 0x27d4eb2d) ^ sm) >>> 0;
  g = Math.imul(g ^ (g >>> 15), 0x85ebca6b) >>> 0;
  g = Math.imul(g ^ (g >>> 13), 0xc2b2ae35) >>> 0;
  const h0 = ((h ^ (h >>> 16)) >>> 0) / 4294967295, h1 = ((g ^ (g >>> 16)) >>> 0) / 4294967295;
  return (h0 * (1 - u) + h1 * u) * 2 - 1;
}

/** Two octaves. */
export const fbm1 = (t: number, seed = 0): number => noise1(t, seed) * 0.67 + noise1(t * 2.3 + 17.1, seed + 7) * 0.33;
