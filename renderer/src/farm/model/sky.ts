// @pure
/**
 * Real-clock sky: local hour, season from the month (northern hemisphere), and weather that is deterministic per
 * 3-hour block of the calendar (every window on the same day agrees, no network). Transitions ease through low
 * intensity at block edges so rain never snaps on.
 */
import { hash32, mulberry32 } from '../../../../shared/identity.ts';
import type { Season, Sky, Weather, WeatherKind, WeatherTrace } from './types.ts';
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

/**
 * `festival`: force a festival (model/calendar.ts id) on any date; the season follows it unless `season` is set too.
 * `trace`: force what the recent weather left (dev: puddles, lying snow, a rainbow via `sinceRain`).
 */
export interface SkyOverrides {
  hour?: number | null; weather?: WeatherKind | null; season?: Season | null; intensity?: number | null; festival?: string | null;
  trace?: Partial<WeatherTrace> | null;
}

/** how long (h) back the trace integrates: lying snow can outlast a day in winter */
const TRACE_BLOCKS = 16;
const SINCE_RAIN_MAX_H = 12;
const wetKind = (k: WeatherKind) => k === 'rain' || k === 'storm';

/** one block-long (or shorter) stretch of constant weather applied to the trace (closed form, any length) */
function stepTrace(t: { wet: number; snow: number }, kind: WeatherKind, k: number, dtH: number, season: Season, daylight: number): void {
  if (dtH <= 0) return;
  const cold = season === 'winter' ? 1 : season === 'autumn' || season === 'spring' ? 0.4 : 0;
  if (wetKind(kind)) {
    // puddles fill within the first half hour; rain washes lying snow away
    t.wet = 1 - (1 - t.wet) * Math.exp(-dtH * (1.5 + 3 * k));
    t.snow *= Math.exp(-dtH / (1.2 + cold * 2));
    return;
  }
  if (kind === 'snow') {
    // ~3 h of steady snow covers everything; the ground underneath stays damp
    t.snow = Math.min(1, t.snow + dtH * (0.16 + 0.24 * k));
    t.wet += (0.3 - t.wet) * (1 - Math.exp(-dtH));
    return;
  }
  // drying: sun and wind dry fastest; night, fog and winter keep the ground wet for hours
  const sun = kind === 'clear' ? 1 : kind === 'cloudy' ? 0.55 : 0.2;
  const tau = (1.2 + 2.4 * (1 - sun) + 1.6 * cold) * (1.7 - 0.7 * daylight);
  const floor = kind === 'fog' ? 0.22 : 0;
  t.wet = floor + (t.wet - floor) * Math.exp(-dtH / tau);
  if (t.wet < floor) t.wet += (floor - t.wet) * (1 - Math.exp(-dtH / 2));
  const melt = (0.015 + 0.3 * (1 - cold)) * (0.3 + 0.7 * daylight * sun);
  t.snow = Math.max(0, t.snow - dtH * melt);
}

/**
 * What the recent weather left behind at `date`: integrates the deterministic 3-hour blocks of the last two days
 * (the same table as `skyAt`), so every window agrees and a reload does not dry the puddles. A forced `weather`
 * counts as having been going on for at least the last 1.5 h. Pure.
 */
export function weatherTrace(date: Date, o: SkyOverrides = {}): WeatherTrace {
  const realHour = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  const block = Math.floor(realHour / BLOCK_H);
  const t = { wet: 0, snow: 0 };
  let rainEnd: number | null = null; // hours before now that the last rain stopped (null: none seen)
  let raining = false;
  const forcedFor = o.weather ? Math.max(realHour - block * BLOCK_H, 1.5) : 0;
  for (let i = TRACE_BLOCKS; i >= 0; i--) {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), (block - i) * BLOCK_H);
    const ago0 = (date.getTime() - start.getTime()) / 3_600_000; // hours from block start to now
    const ago1 = Math.max(0, ago0 - BLOCK_H);
    const season = o.season ?? (o.festival ? festivalById(o.festival)?.season : undefined) ?? seasonOf(start.getMonth());
    const { kind: realKind, r } = blockWeather(start.getFullYear(), dayOfYear(start), Math.floor(start.getHours() / BLOCK_H), season);
    const k = 0.45 + r() * 0.55;
    // split at the start of a forced stretch: before it the real blocks, after it the forced weather
    const segs: [number, number, WeatherKind][] = [];
    if (forcedFor > ago1 && o.weather) {
      if (ago0 > forcedFor) segs.push([ago0, forcedFor, realKind]);
      segs.push([Math.min(ago0, forcedFor), ago1, o.weather]);
    } else segs.push([ago0, ago1, realKind]);
    for (const [a0, a1, kind] of segs) {
      const midHour = start.getHours() + (ago0 - (a0 + a1) / 2);
      stepTrace(t, kind, o.weather && kind === o.weather ? o.intensity ?? k : k, a0 - a1, season, daylightAt(midHour, dayOfYear(start)));
      if (wetKind(kind)) { raining = a1 <= 0; rainEnd = a1; } else raining = false;
    }
  }
  const sinceRain = raining || rainEnd === null || rainEnd > SINCE_RAIN_MAX_H ? null : rainEnd;
  const out: WeatherTrace = { wet: Math.min(1, Math.max(0, t.wet)), snow: Math.min(1, Math.max(0, t.snow)), sinceRain };
  if (o.trace) Object.assign(out, o.trace);
  return out;
}

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
  return { hour, daylight: daylightAt(hour, doy), season, dayOfYear: doy, weather: w, trace: weatherTrace(date, o), festival: festivalAt(date, o.festival) };
}
