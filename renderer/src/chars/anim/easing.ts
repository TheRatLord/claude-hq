// @pure
/** Easings (ART §6.2). t ∈ [0,1]. Owner: CHR. */
const c1 = 1.70158, c3 = c1 + 1;
export const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
export const easeOutBack = (t: number) => 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
export const easeInBack = (t: number) => c3 * t ** 3 - c1 * t * t;
export const easeOutElastic = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1);
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
export const easeInCubic = (t: number) => t * t * t;
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const easeOutQuad = (t: number) => 1 - (1 - t) * (1 - t);
export function bounce(t: number): number {
  const n1 = 7.5625, d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}
/** 0→1→0 hump over [0,1] (parabolic arc for hops). */
export const arc = (t: number) => 4 * clamp01(t) * (1 - clamp01(t));
/** Smooth window: 0 outside [a,d], ramps a→b, 1 on [b,c], ramps c→d. */
export function window4(t: number, a: number, b: number, c: number, d: number): number {
  if (t <= a || t >= d) return 0;
  if (t < b) { const u = (t - a) / (b - a); return u * u * (3 - 2 * u); }
  if (t <= c) return 1;
  const u = (d - t) / (d - c); return u * u * (3 - 2 * u);
}
