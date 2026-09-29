// @pure
/**
 * JS-generated 3D grading LUTs (ART §4 row 1, §5.0 "LUT fixed points"). Input and output are sRGB-encoded 0..1
 * (LUT3DEffect converts around it). Day is a gentle warm grade; golden warms and lifts; night cools the shadows and
 * slightly desaturates. Protected swatches (clay, clayDeep, cream, ink, every status colour) are pulled back toward
 * identity with a smooth radial correction, so the brand survives the grade: day ΔE00 < 3, golden/night < 8.
 * post.ts runs `ToeCompEffect` (the exact inverse of the Khronos PBR Neutral toe, `untoe` below) right before
 * NEUTRAL, so tone mapping is the identity below ≈ 0.76 linear as §5.0 intends: without it the toe (an offset of up
 * to 0.04 on dark channels) crushes the codex slate body and over-saturates clay (measured: lit clay ΔE 7.7,
 * slate L* 20). The LUT therefore grades plain sRGB.
 * Owner: RND. No three here (post.ts wraps the data in a Data3DTexture).
 */

/** JS mirror of three/pmndrs NEUTRAL (Khronos PBR Neutral), linear in/out. */
export function neutral([r, g, b]: Rgb): Rgb {
  const start = 0.8 - 0.04, desat = 0.15;
  const x = Math.min(r, g, b);
  const off = x < 0.08 ? x - 6.25 * x * x : 0.04;
  let c: Rgb = [r - off, g - off, b - off];
  const peak = Math.max(...c);
  if (peak < start) return c;
  const d = 1 - start;
  const np = 1 - (d * d) / (peak + d - start);
  c = [(c[0] * np) / peak, (c[1] * np) / peak, (c[2] * np) / peak];
  const k = 1 - 1 / (desat * (peak - np) + 1);
  return [c[0] + (np - c[0]) * k, c[1] + (np - c[1]) * k, c[2] + (np - c[2]) * k];
}

/** Inverse of the NEUTRAL toe (linear in/out; highlights are left compressed). GLSL twin: post.ts ToeCompEffect. */
export function untoe([r, g, b]: Rgb): Rgb {
  const m = Math.min(r, g, b);
  const add = m < 0.04 ? Math.sqrt(Math.max(0, m) / 6.25) - m : 0.04;
  return [r + add, g + add, b + add];
}
import { CORE, STATUS, BODY, MISC, hexToRgb, srgbToLinear, linearToSrgb, type Rgb } from '../../../shared/palette.ts';

export const LUT_SIZE = 32;

// + the codex slate body and the clay shadow band (clayCheck references); pebble/rose are left out on purpose: a
// near-neutral protected swatch would pin every mid-grey wall to identity
export const PROTECTED = Object.freeze([CORE.clay, CORE.clayDeep, CORE.cream, CORE.ink, ...Object.values(STATUS), BODY.bodySlate, MISC.clayShadow]);

export type GradePhase = 'day' | 'golden' | 'night' | 'morning';

/** One phase's grade parameters. */
export interface Grade {
  lift: Rgb; liftAmt: number; warm: Rgb; hi?: Rgb; sat: number; contrast: number;
  /** warm-selective saturation (night) */
  warmSat?: number;
}

/** Grade parameters per phase. */
export const GRADES: Readonly<Record<GradePhase, Grade>> = Object.freeze({
  // M1.75 (clay diorama): more S-curve so the painted clay reads crisp; mid warmth cut (hue-gap: the old warm mids put
  // C* ≈ 20 on cream walls behind Clawds)
  day: { lift: [0.165, 0.133, 0.2], liftAmt: 0.03, warm: [0.008, 0.002, -0.006], sat: 1.05, contrast: 0.055 },
  // fix r1: golden split-tone. Warm mids (0.05 R) put C* ≈ 20 at h 66 on every wall behind a Clawd (hueGapCheck 0.2–0.4
  // at 18 h); now mids stay near neutral, highlights (sun patches, lit shades, the sky) go amber and shadows lift toward
  // dusk violet, so the frame reads warm-sun / cool-room
  golden: { lift: [0.16, 0.13, 0.24], liftAmt: 0.06, warm: [0.004, 0.001, -0.006], hi: [0.035, 0.016, -0.03], sat: 1.05, contrast: 0.05 },
  // night (M1 fix r2): split-tone. Shadows lift toward violet-ink and mids cool slightly, while highlights warm and
  // saturation stays up, so lamp pools, shades and screens read as warm light in a cool room (was: sat 0.9, a flat
  // grey-lilac cast over everything)
  // m2 fix r3 (warm pools read): warm pixels (r > b: lamp pools, shades, wood under a lamp) take extra saturation and the
  // mid cooling is cut by a fifth, so the pools keep their amber against the violet-lifted room instead of greying out
  // RND fix r1 (art: a cool, pale morning, not a second sunset): lifted blue-grey blacks, cool mids, a pale (neutral)
  // highlight and a little less saturation: the 8 h frame reads washed and fresh
  morning: { lift: [0.22, 0.26, 0.33], liftAmt: 0.16, warm: [-0.024, -0.004, 0.03], hi: [-0.004, 0.01, 0.02], sat: 0.84, contrast: -0.02 },
  // RND fix r1: night shadows lift toward a deep navy (was violet [0.11, 0.13, 0.27]: walls read lilac at 22 h)
  night: { lift: [0.07, 0.1, 0.21], liftAmt: 0.1, warm: [-0.02, -0.003, 0.027], hi: [0.035, 0.03, -0.05], sat: 1.06, warmSat: 0.55, contrast: 0.02 },
});

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The raw (uncorrected) grade of one sRGB colour. */
export function gradeRaw(rgb: Rgb, g: Grade): Rgb {
  let [r, gg, b] = rgb;
  const y = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
  // saturation around luma
  // warm-selective saturation (night): full at r − b ≥ 0.12 with red leading green (amber / orange, never olive)
  const cl = (v: number) => Math.min(1, Math.max(0, v));
  const ws = g.warmSat ? 1 + g.warmSat * cl((r - b) / 0.12) * cl((r - gg + 0.01) / 0.05) : 1;
  r = y + (r - y) * g.sat * ws; gg = y + (gg - y) * g.sat * ws; b = y + (b - y) * g.sat * ws;
  // gentle S-curve on luma-ish channels
  const s = (v: number) => v + g.contrast * (v - 0.5) * 4 * v * (1 - v);
  r = s(r); gg = s(gg); b = s(b);
  // mids warm: weight peaks at 0.5
  const m = 4 * y * (1 - y);
  r += g.warm[0] * m; gg += g.warm[1] * m; b += g.warm[2] * m;
  // highlights warm (split toning; weight y²)
  if (g.hi) { const hw = y * y; r += g.hi[0] * hw; gg += g.hi[1] * hw; b += g.hi[2] * hw; }
  // shadow lift toward a violet-ink tone
  const sh = Math.pow(1 - y, 3) * g.liftAmt;
  r += (g.lift[0] - r) * sh; gg += (g.lift[1] - gg) * sh; b += (g.lift[2] - b) * sh;
  return [clamp01(r), clamp01(gg), clamp01(b)];
}

/**
 * Build a corrected grade function: identity is restored around protected swatches with Gaussian weights
 * (σ ≈ 0.07 in sRGB space) × `keep` (1 = full identity at the swatch).
 */
export function makeGrade(phase: GradePhase): (rgb: Rgb) => Rgb {
  const g = GRADES[phase];
  const keep = phase === 'day' ? 0.9 : 0.6;
  const base = (rgbIn: Rgb) => gradeRaw(rgbIn, g);
  // protected swatches: the LUT input is the tone-mapped swatch; pull its output back toward the swatch itself
  const sw = PROTECTED.map((h) => {
    const c = hexToRgb(h);
    const lin: Rgb = [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])];
    const n = neutral(untoe(lin));
    const cv = (v: number) => clamp01(linearToSrgb(Math.max(0, v)));
    const t: Rgb = [cv(n[0]), cv(n[1]), cv(n[2])];
    const o = base(t);
    return { c: t, d: [c[0] - o[0], c[1] - o[1], c[2] - o[2]] };
  });
  const inv2s2 = 1 / (2 * 0.06 * 0.06);
  return (rgb: Rgb): Rgb => {
    const o = base(rgb);
    for (const s of sw) {
      const d2 = (rgb[0] - s.c[0]) ** 2 + (rgb[1] - s.c[1]) ** 2 + (rgb[2] - s.c[2]) ** 2;
      const w = Math.exp(-d2 * inv2s2) * keep;
      o[0] += s.d[0] * w; o[1] += s.d[1] * w; o[2] += s.d[2] * w;
    }
    return [clamp01(o[0]), clamp01(o[1]), clamp01(o[2])];
  };
}

/**
 * RGBA float data for a size³ LUT (r fastest, then g, then b — Data3DTexture layout).
 */
export function lutData(phase: GradePhase, size = LUT_SIZE): Float32Array {
  const f = makeGrade(phase);
  const out = new Float32Array(size * size * size * 4);
  let i = 0;
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    const o = f([r / (size - 1), g / (size - 1), b / (size - 1)]);
    out[i++] = o[0]; out[i++] = o[1]; out[i++] = o[2]; out[i++] = 1;
  }
  return out;
}

/** Weighted blend of phase LUTs into `out` (same layout). */
export function blendLuts(out: Float32Array, luts: Readonly<Record<GradePhase, Float32Array>>, weights: Partial<Record<GradePhase, number>>): Float32Array {
  out.fill(0);
  for (const [phase, w] of Object.entries(weights) as [GradePhase, number | undefined][]) { // Object.entries key narrowing
    if (!w) continue;
    const d = luts[phase];
    for (let i = 0; i < out.length; i++) out[i] += d[i] * w;
  }
  return out;
}

/** Trilinear lookup of a LUT's data (tests). */
export function sampleLut(data: ArrayLike<number>, rgb: Rgb, size = LUT_SIZE): Rgb {
  const p = rgb.map((c) => clamp01(c) * (size - 1));
  const i0 = p.map(Math.floor), f = p.map((v, k) => v - i0[k]);
  const i1 = i0.map((v) => Math.min(size - 1, v + 1));
  const at = (r: number, g: number, b: number, c: number) => data[((b * size + g) * size + r) * 4 + c];
  const out: Rgb = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    let acc = 0;
    for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const w = (dx ? f[0] : 1 - f[0]) * (dy ? f[1] : 1 - f[1]) * (dz ? f[2] : 1 - f[2]);
      acc += w * at(dx ? i1[0] : i0[0], dy ? i1[1] : i0[1], dz ? i1[2] : i0[2], c);
    }
    out[c] = acc;
  }
  return out;
}
