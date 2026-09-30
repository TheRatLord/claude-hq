/**
 * When and how much of each critter is about. Pure (no three, no DOM) so the rhythm of the valley is testable:
 * dawn chorus, butterflies on clear days, fireflies on dry nights, everyone sheltering from storms, and the carrier
 * pigeon traffic that tracks the network.
 */
import type { Season, WeatherKind } from '../../model/types.ts';

export interface LifeClock {
  /** local fractional hour 0..24 */
  hour: number;
  /** 0 night … 1 noon */
  daylight: number;
  /** 0 day … 1 deep night (lighting.night, or 1 − daylight when the sky system has not published yet) */
  night: number;
  weather: WeatherKind;
  /** 0..1 */
  intensity: number;
  season: Season;
}

export interface Activity {
  /** 0..1 fraction of songbird flocks out */
  birds: number;
  /** 0..1 extra chirpiness around sunrise */
  chorus: number;
  butterflies: number;
  dragonflies: number;
  fireflies: number;
  /** 0..1 rate multiplier for fish jumps */
  fish: number;
  frogs: number;
  /** frogs croak (night / rain) */
  croak: number;
  rabbits: number;
  squirrels: number;
  /** pets and critters head for cover */
  shelter: boolean;
  /** pets sleep */
  sleep: boolean;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
/** bump centred on c with half-width w (hours, wraps midnight) */
const bump = (h: number, c: number, w: number) => {
  let d = Math.abs(h - c);
  if (d > 12) d = 24 - d;
  return 1 - smooth(0, w, d);
};

/** How wet/wild the weather is, 0 calm … 1 storm. */
export function wildness(kind: WeatherKind, intensity: number): number {
  switch (kind) {
    case 'storm': return 0.7 + 0.3 * intensity;
    case 'rain': return 0.3 + 0.45 * intensity;
    case 'snow': return 0.25 + 0.35 * intensity;
    case 'fog': return 0.12 * intensity;
    case 'cloudy': return 0.05 * intensity;
    default: return 0;
  }
}

export function activity(c: LifeClock): Activity {
  const day = clamp01(c.daylight);
  const night = clamp01(Math.max(c.night, 1 - day));
  const wild = wildness(c.weather, c.intensity);
  const wet = c.weather === 'rain' || c.weather === 'storm' || c.weather === 'snow';
  const sunny = c.weather === 'clear' ? 1 : c.weather === 'cloudy' ? 0.55 : c.weather === 'fog' ? 0.3 : 0;
  const winter = c.season === 'winter';
  const warm = c.season === 'summer' ? 1 : c.season === 'spring' ? 0.8 : c.season === 'autumn' ? 0.45 : 0;
  // birds wake before full daylight and sing hardest just after sunrise
  const awake = smooth(0.05, 0.35, day);
  const birds = clamp01(awake * (1 - wild * 0.75));
  const chorus = clamp01(bump(c.hour, 6.6, 1.6) * awake * (1 - wild));
  const butterflies = clamp01(smooth(0.45, 0.8, day) * sunny * warm);
  const dragonflies = clamp01(smooth(0.35, 0.7, day) * (1 - wild) * warm * (c.weather === 'fog' ? 0.4 : 1));
  const fireflies = clamp01(smooth(0.55, 0.9, night) * (wet ? 0.12 * (1 - wild) : 1) * (winter ? 0 : warm > 0.5 ? 1 : 0.7));
  const fish = clamp01(0.35 + 0.4 * bump(c.hour, 7, 2.5) + 0.4 * bump(c.hour, 19, 2.5) + (c.weather === 'rain' ? 0.3 : 0) - (c.weather === 'storm' ? 0.5 : 0));
  const frogs = winter ? 0 : clamp01(0.55 + 0.45 * night + (wet ? 0.2 : 0));
  const croak = winter ? 0 : clamp01(0.08 + 0.92 * smooth(0.3, 0.8, night) + (c.weather === 'rain' ? 0.4 : 0));
  // rabbits love dawn and dusk, nap through deep night, hide from rain
  const rabbits = clamp01((0.55 + 0.45 * Math.max(bump(c.hour, 6.8, 2), bump(c.hour, 19.2, 2))) * (1 - smooth(0.75, 0.95, night)) * (wet ? 0.1 : 1) * (winter ? 0.6 : 1));
  const squirrels = clamp01(awake * (wet ? 0.15 : 1) * (c.season === 'autumn' ? 1 : 0.7));
  return {
    birds, chorus, butterflies, dragonflies, fireflies, fish, frogs, croak, rabbits, squirrels,
    shelter: wild >= 0.45,
    sleep: night > 0.8 || (c.hour >= 22.5 || c.hour < 5),
  };
}

/**
 * Carrier pigeons = network. Mean seconds between departures from the loft for a total byte rate (rx + tx, B/s).
 * Log-scaled: ~1 kB/s → one every ~40 s, ~100 kB/s → every ~8 s, ~10 MB/s → every ~1.5 s, never faster than 1.2 s.
 * Returns Infinity when the network is idle (< 200 B/s) — the pigeons just coo on the roof.
 */
export function pigeonInterval(bytesPerSec: number): number {
  if (!(bytesPerSec >= 200)) return Infinity;
  const lg = Math.log10(bytesPerSec); // 2.3 … 9
  const k = clamp01((lg - 2.3) / (7.3 - 2.3)); // 200 B/s … 20 MB/s
  return Math.max(1.2, 60 * Math.pow(0.02, k));
}

/** 0..1 fraction of flights that leave the loft (uploads) rather than arrive (downloads). */
export function outboundShare(rx: number, tx: number): number {
  const t = Math.max(0, tx), r = Math.max(0, rx);
  if (t + r <= 0) return 0.5;
  // log-ish so a heavy download still sends the odd pigeon out
  return clamp01(0.15 + 0.7 * (Math.log1p(t) / (Math.log1p(t) + Math.log1p(r))));
}

/** Firefly blink: brightness 0..1 at time t for a firefly with period p and phase ph (a quick swell and fade). */
export function blink(t: number, period: number, phase: number): number {
  const x = ((t / period + phase) % 1 + 1) % 1;
  if (x > 0.22) return 0;
  const s = Math.sin((x / 0.22) * Math.PI);
  return s * s;
}
