/**
 * Sun and moon placement from the local hour and the real date. Stylised but consistent: the sun rises in the east
 * (+x), culminates in the south (+z) higher in summer, sets in the west; the moon lags the sun by its phase, so a
 * full moon rises at sunset and rides high at midnight, and its lit side faces the sun.
 */
import { sunTimes } from '../../model/sky.ts';

const SYNODIC = 29.530588853;
/** a known new moon: 2000-01-06 18:14 UTC */
const NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14);

/** 0 new … 0.25 first quarter … 0.5 full … 0.75 last quarter */
export function moonPhase(ms: number): number {
  const days = (ms - NEW_MOON_MS) / 86_400_000;
  const p = (days / SYNODIC) % 1;
  return p < 0 ? p + 1 : p;
}

/**
 * Day angle φ: sunrise → 0, sunset → π, the night spans π..2π (so night and day may have different lengths).
 */
export function dayAngle(hour: number, doy: number): number {
  const { rise, set } = sunTimes(doy);
  const h = ((hour % 24) + 24) % 24;
  if (h >= rise && h <= set) return ((h - rise) / (set - rise)) * Math.PI;
  const nightLen = 24 - (set - rise);
  const since = h > set ? h - set : h + 24 - set;
  return Math.PI + (since / nightLen) * Math.PI;
}

/** peak sun elevation (radians) through the year: ~64° at midsummer, ~28° midwinter */
export function peakElevation(doy: number): number {
  const k = Math.cos(((doy - 172) / 365) * Math.PI * 2);
  return (46 + 18 * k) * (Math.PI / 180);
}

/** unit direction on the tilted day arc for angle φ (writes out) */
export function arcDir(phi: number, peak: number, out: { x: number; y: number; z: number }): void {
  const s = Math.sin(phi);
  // a slight northward bias at rise/set (summer sun rises north of east) keeps sunsets framed by the valley
  out.x = Math.cos(phi);
  out.y = s * Math.sin(peak);
  out.z = s * Math.cos(peak) - 0.12 * (1 - Math.abs(s));
  const l = Math.hypot(out.x, out.y, out.z) || 1;
  out.x /= l; out.y /= l; out.z /= l;
}
