// @pure
/**
 * The villagers' day, on the real clock. Pure (no three): which slot of its day plan a villager is in at an hour
 * (with a little seeded per-day jitter so nobody is a cuckoo clock), storms send everyone not already indoors to
 * shelter, rounds walk a list of stops, and each place plays a seeded loop of beats.
 */
import type { WeatherKind } from '../../model/types.ts';
import type { Beat, DayEntry, Slot } from './cast.ts';

/** deterministic 0..1 from two numbers */
export const hash01 = (a: number, b: number): number => { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return v - Math.floor(v); };
/** a stable small number for a string (villager ids) */
export const keyOf = (s: string): number => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100003; return h; };

/** ± minutes of jitter on each day-plan boundary, varying by day */
export const JITTER_H = 0.3;

/** The start hour of entry i on day `day`, jittered (never past its neighbours). */
export function entryStart(day: readonly DayEntry[], i: number, dayOfYear: number, key: number): number {
  const j = (hash01(key + i * 3.17, dayOfYear) - 0.5) * 2 * JITTER_H;
  return (day[i].from + j + 24) % 24;
}

/** Index of the day-plan entry active at `hour` (entries are cyclic across midnight; `day` sorted by `from`). */
export function entryAt(day: readonly DayEntry[], hour: number, dayOfYear = 0, key = 0): number {
  const n = day.length;
  if (n === 0) return -1;
  let best = -1, bestAgo = Infinity;
  for (let i = 0; i < n; i++) {
    const ago = (hour - entryStart(day, i, dayOfYear, key) + 48) % 24;
    if (ago < bestAgo) { bestAgo = ago; best = i; }
  }
  return best;
}

/** Bad enough weather to send villagers under a roof. */
export const stormy = (kind: WeatherKind, intensity: number): boolean => kind === 'storm' || ((kind === 'rain' || kind === 'snow') && intensity > 0.8);

export type Where = Slot | 'shelter';

/** Where a villager should be: its plan slot, or shelter in a storm (unless it is home indoors; the ranger, who
 * sleeps out by the fire, `homeIndoors` = false, shelters too). */
export function whereAt(day: readonly DayEntry[], hour: number, weather: WeatherKind, intensity: number, dayOfYear = 0, key = 0, homeIndoors = true): { slot: Where; entry: number } {
  const entry = entryAt(day, hour, dayOfYear, key);
  const slot = entry >= 0 ? day[entry].slot : 'post';
  if ((slot !== 'home' || !homeIndoors) && stormy(weather, intensity)) return { slot: 'shelter', entry };
  return { slot, entry };
}

/** Which stop of a round to visit `elapsedH` hours into it (each stop gets an equal share, then the round restarts). */
export function roundStop(stops: number, elapsedH: number, perStopH = 0.6): number {
  if (stops <= 0) return -1;
  return Math.floor(Math.max(0, elapsedH) / perStopH) % stops;
}

/** Hours since the entry began (handles midnight). */
export function hoursInto(day: readonly DayEntry[], entry: number, hour: number, dayOfYear = 0, key = 0): number {
  return (hour - entryStart(day, entry, dayOfYear, key) + 48) % 24;
}

/**
 * The next beat of a place's loop after beat `prev` (−1 = arriving): walk the loop in order, skipping beats whose
 * chance roll fails; returns the beat index and how long to hold it. Deterministic in (key, n).
 */
export function nextBeat(loop: readonly Beat[], prev: number, key: number, n: number): { i: number; secs: number } {
  if (!loop.length) return { i: -1, secs: 10 };
  let i = prev;
  for (let tries = 0; tries < loop.length; tries++) {
    i = (i + 1) % loop.length;
    const b = loop[i];
    if (b.p === undefined || hash01(key + n * 1.37, i + tries * 0.11) < b.p) break;
  }
  const b = loop[i];
  return { i, secs: b.min + (b.max - b.min) * hash01(key * 0.7 + i, n * 0.53) };
}
