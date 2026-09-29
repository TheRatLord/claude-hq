/**
 * `__hq.lumaStats({emissive:false})` maths (§5.0 luminance row), pure so it is unit tested (lumaStats.test.ts).
 *
 * m2 fix r3: the emissive-off frame used to take quantiles over *every* pixel. Light sources that the probe switches
 * off (the Big Board face, desk monitors, bulbs, shades) and the window sky then entered the stats as black, so p10
 * fell under its floor at pitOverview (Board + skylight) and p50 drifted with how much sky a pose saw: the gate
 * failed on content, not on the lit environment it is about. The row is about **lit surfaces**, so light-source and
 * sky pixels are masked out using a second capture:
 *   - `pre`  : the normal frame (linear, pre-tonemap, RGBA)
 *   - `off`  : the same frame with uEmissiveGain 0, screens masked and the sky masked (uSkyMask: exactly black)
 * A pixel is a light source / sky (excluded) when it is black in `off` but not in `pre`, or when emission is a large
 * share of it (drops ≥ 0.08 absolute or ≥ 30 % with the emissive gain off). Quantiles are taken of `off` over the kept
 * pixels (the lit environment with its emissive glow removed, as the §5.0 row specifies). `bloomFrac` stays a
 * normal-frame, all-pixel measure (lamps and screens included, §5.0 "normal frame, lamps on").
 * Owner: RND.
 */

const lum = (d: ArrayLike<number>, i: number) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

/** Emissive / sky classification of one pixel (luminance in the normal frame `lp`, emissive-off frame `lq`). */
export const isLightSource = (lp: number, lq: number): boolean => (lq < 1e-4 && lp > 1e-3) || lp - lq > 0.08 || lp - lq > 0.3 * lp;

/**
 * @param pre   normal frame RGBA (linear)
 * @param off  emissive/sky-off frame RGBA, same size (null: no masking, all pixels)
 * @returns `L` sorted luminance of the kept pixels, `idx` their pixel index (unsorted order irrelevant), `excluded` fraction
 */
export function lumaSamples(pre: ArrayLike<number>, off: ArrayLike<number> | null): { L: Float32Array; idx: Uint32Array; n: number; excluded: number; bloomFrac: number } {
  const total = pre.length / 4;
  let over = 0, n = 0;
  const L = new Float32Array(total), idx = new Uint32Array(total);
  for (let i = 0, k = 0; i < pre.length; i += 4, k++) {
    const lp = lum(pre, i);
    if (lp > 1.0) over++;
    if (off) {
      const lq = lum(off, i);
      if (isLightSource(lp, lq)) continue;
      L[n] = lq;
    } else L[n] = lp;
    idx[n++] = k;
  }
  return { L: L.subarray(0, n), idx: idx.subarray(0, n), n, excluded: total ? 1 - n / total : 0, bloomFrac: total ? over / total : 0 };
}

export interface LumaTarget { p99: number; p50: number; p10: number; bloomFrac: number }
export interface LumaResult { max: number; maxIdx: number; p99: number; p50: number; p10: number; bloomFrac: number; excluded: number; pass: boolean }

/**
 * Quantiles + the §5.0 verdict.
 * @param o.maxCap  emissive-off frames also require max ≤ maxCap (0.95: no lit surface reads as a light)
 */
export function lumaQuantiles(pre: ArrayLike<number>, off: ArrayLike<number> | null, tgt: LumaTarget, o: { maxCap?: number } = {}): LumaResult {
  const s = lumaSamples(pre, off);
  // argmax before sorting (pixel index of the brightest kept pixel)
  let arg = -1, mx = -Infinity;
  for (let j = 0; j < s.n; j++) if (s.L[j] > mx) { mx = s.L[j]; arg = s.idx[j]; }
  const L = Float32Array.from(s.L).sort();
  const n = L.length;
  const q = (p: number) => (n ? L[Math.min(n - 1, Math.floor(p * n))] : 0);
  const r = (v: number, k = 3) => +v.toFixed(k);
  const m = { max: r(n ? L[n - 1] : 0), maxIdx: arg, p99: r(q(0.99)), p50: r(q(0.5)), p10: r(q(0.1)), bloomFrac: r(s.bloomFrac, 5), excluded: r(s.excluded, 3) };
  const pass = n > 0 && m.p99 <= tgt.p99 && m.p50 >= tgt.p50 && m.p10 >= tgt.p10 && m.bloomFrac <= tgt.bloomFrac && (o.maxCap == null || m.max <= o.maxCap);
  return { ...m, pass };
}
