// @pure
/**
 * Real-clock sky: local hour, season from the month (northern hemisphere), and weather that is deterministic per
 * 3-hour block of the calendar (every window on the same day agrees, no network). Transitions ease through low
 * intensity at block edges so rain never snaps on.
 */
import { hash32, mulberry32 } from '../../../../shared/identity.ts';
import type { Season, Sky, Weather, WeatherKind } from './types.ts';
import { festivalAt, festivalById } from './calendar.ts';

const BLOCK_H = 3;
const EDGE_H = 0.4;

export function seasonOf(month: number): Season {
  if (month === 11 || month <= 1) return 'winter';
  if (month <= 4) return 'spring';
  if (month <= 7) return 'summer';
  return 'autumn';
}

const TABLE: Record<Season, [WeatherKind, number][]> = {
  spring: [['clear', 4], ['cloudy', 3], ['rain', 3], ['storm', 0.6], ['fog', 1]],
  summer: [['clear', 7], ['cloudy', 2], ['rain', 1], ['storm', 0.8], ['fog', 0.3]],
  autumn: [['clear', 3], ['cloudy', 3], ['rain', 2.5], ['storm', 0.6], ['fog', 1.6]],
  winter: [['clear', 2.5], ['cloudy', 3], ['snow', 3], ['fog', 1.2], ['rain', 0.6]],
};

function blockWeather(y: number, doy: number, block: number, season: Season): { kind: WeatherKind; r: () => number } {
  const r = mulberry32(hash32(`${y}:${doy}:${block}`));
  const t = TABLE[season];
  const total = t.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [k, w] of t) { if ((x -= w) <= 0) return { kind: k, r }; }
  return { kind: 'clear', r };
}

export function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d.getTime() - start.getTime()) / 86_400_000);
}

/** Sunrise / sunset hours, shifted by season (longer summer days). */
export function sunTimes(doy: number): { rise: number; set: number } {
  const k = Math.cos(((doy - 172) / 365) * Math.PI * 2); // 1 at the solstice, −1 midwinter
  return { rise: 6.4 - 1.1 * k, set: 18.9 + 1.4 * k };
}

const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

export function daylightAt(hour: number, doy: number): number {
  const { rise, set } = sunTimes(doy);
  return smooth(rise - 0.8, rise + 1.2, hour) * (1 - smooth(set - 1.2, set + 0.8, hour));
}

/** `festival`: force a festival (model/calendar.ts id) on any date; the season follows it unless `season` is set too */
export interface SkyOverrides { hour?: number | null; weather?: WeatherKind | null; season?: Season | null; intensity?: number | null; festival?: string | null }

export function skyAt(date: Date, o: SkyOverrides = {}): Sky {
  const realHour = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  const hour = o.hour ?? realHour;
  const doy = dayOfYear(date);
  const season = o.season ?? (o.festival ? festivalById(o.festival)?.season : undefined) ?? seasonOf(date.getMonth());
  const block = Math.floor(realHour / BLOCK_H);
  const { kind, r } = blockWeather(date.getFullYear(), doy, block, season);
  const inBlock = realHour - block * BLOCK_H;
  const edge = Math.min(smooth(0, EDGE_H, inBlock), 1 - smooth(BLOCK_H - EDGE_H, BLOCK_H, inBlock));
  const base = 0.45 + r() * 0.55;
  const w: Weather = {
    kind: o.weather ?? kind,
    intensity: o.intensity ?? (o.weather ? base : base * (0.25 + 0.75 * edge)),
    clouds: 0,
    wind: 1 + r() * 4,
    windDir: r() * Math.PI * 2,
  };
  const cloudBase: Record<WeatherKind, number> = { clear: 0.15, cloudy: 0.7, rain: 0.9, storm: 1, fog: 0.6, snow: 0.85 };
  w.clouds = cloudBase[w.kind] * (w.kind === 'clear' ? 1 : 0.5 + 0.5 * w.intensity);
  if (w.kind === 'storm') w.wind += 5;
  return { hour, daylight: daylightAt(hour, doy), season, dayOfYear: doy, weather: w, festival: festivalAt(date, o.festival) };
}
