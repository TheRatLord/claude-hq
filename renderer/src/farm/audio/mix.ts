/**
 * Pure mixing math for the valley's sound: positional attenuation/pan/air absorption, bus gains from the volume
 * settings, per-name rate limiting, and the ambient bed levels for a time/weather/place. No WebAudio, no DOM, no
 * three — everything here is unit-tested (mix.test.ts) and zero-allocation on the per-frame paths.
 */

// ---------------------------------------------------------------------------------------------
// Positional

export interface SpatialOpts {
  /** full volume inside this distance (m) */
  ref?: number;
  /** silent beyond this distance (m) */
  max?: number;
  /** inverse-distance rolloff factor */
  rolloff?: number;
}
export interface Spatial { gain: number; pan: number; cutoff: number }

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const smooth = (a: number, b: number, v: number): number => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/**
 * Gain, stereo pan and a low-pass cutoff (air absorption) for a source at offset (dx, dy, dz) from the listener
 * whose right vector on the ground is (rightX, rightZ). Writes into `out` when given (no allocation).
 */
export function spatial(dx: number, dy: number, dz: number, rightX: number, rightZ: number, o: SpatialOpts = {}, out: Spatial = { gain: 0, pan: 0, cutoff: 20000 }): Spatial {
  const ref = o.ref ?? 3, max = o.max ?? 70, roll = o.rolloff ?? 1;
  const dh = Math.hypot(dx, dz);
  const d = Math.hypot(dh, dy);
  let g = d <= ref ? 1 : ref / (ref + roll * (d - ref));
  g *= 1 - smooth(max * 0.7, max, d);
  out.gain = g;
  // pan by the horizontal direction; sources right on top of the listener stay centred
  const side = dh > 1e-4 ? (dx * rightX + dz * rightZ) / dh : 0;
  out.pan = clamp(side * 0.85 * Math.min(1, dh / 2.5), -0.9, 0.9);
  out.cutoff = clamp(20000 * Math.exp(-d / 32), 1400, 20000);
  return out;
}

/** 1 within `near`, easing to 0 at `far` (ambient beds use this instead of inverse distance: more controllable). */
export const proximity = (d: number, near: number, far: number): number => 1 - smooth(near, far, d);

// ---------------------------------------------------------------------------------------------
// Buses

export interface Volumes {
  volumeMaster: number;
  volumeSfx: number;
  volumeAmbient: number;
  volumeNotify: number;
  volumeVoices: number;
  volumeMusic: number;
  audioMuted: boolean;
}
export const DEFAULT_VOLUMES: Readonly<Volumes> = Object.freeze({
  volumeMaster: 0.8, volumeSfx: 0.8, volumeAmbient: 0.5, volumeNotify: 0.9, volumeVoices: 0.7, volumeMusic: 0.4, audioMuted: false,
});
export interface BusGains { master: number; sfx: number; ambient: number; notify: number; voice: number; music: number }

/** Sliders are perceptual (0..1); gains use a square-law taper so the middle of a slider sounds like the middle. */
export const taper = (v: number): number => { const x = clamp(Number.isFinite(v) ? v : 0, 0, 1); return x * x; };

export function busGains(v: Partial<Volumes>, out: BusGains = { master: 0, sfx: 0, ambient: 0, notify: 0, voice: 0, music: 0 }): BusGains {
  const get = <K extends keyof Volumes>(k: K): Volumes[K] => (v[k] ?? DEFAULT_VOLUMES[k]) as Volumes[K];
  out.master = get('audioMuted') ? 0 : taper(get('volumeMaster'));
  out.sfx = taper(get('volumeSfx'));
  out.ambient = taper(get('volumeAmbient'));
  out.notify = taper(get('volumeNotify'));
  out.voice = taper(get('volumeVoices'));
  out.music = taper(get('volumeMusic'));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Rate limiting

export interface RateLimiter {
  /** true (and records the time) if `name` may sound at `now` seconds */
  allow(name: string, now: number, minGap?: number): boolean;
  /** seconds since `name` last sounded (Infinity if never) */
  since(name: string, now: number): number;
}

export function createRateLimiter(gaps: Readonly<Record<string, number>> = {}, fallback = 0.03): RateLimiter {
  const last = new Map<string, number>();
  return {
    allow(name, now, minGap) {
      const gap = minGap ?? gaps[name] ?? fallback;
      const l = last.get(name);
      if (l !== undefined && now - l < gap) return false;
      last.set(name, now);
      return true;
    },
    since(name, now) { const l = last.get(name); return l === undefined ? Infinity : now - l; },
  };
}

/** Fixed-size polyphony tracker: how many one-shots are still ringing. */
export interface Polyphony { admit(now: number, end: number, priority: boolean): boolean; active(now: number): number }
export function createPolyphony(cap = 40): Polyphony {
  const ends = new Float64Array(cap);
  return {
    admit(now, end, priority) {
      let free = -1, earliest = 0;
      for (let i = 0; i < cap; i++) {
        if (ends[i] <= now) { free = i; break; }
        if (ends[i] < ends[earliest]) earliest = i;
      }
      if (free < 0) { if (!priority) return false; free = earliest; }
      ends[free] = end;
      return true;
    },
    active(now) { let n = 0; for (let i = 0; i < cap; i++) if (ends[i] > now) n++; return n; },
  };
}

// ---------------------------------------------------------------------------------------------
// Ambient beds

export type WeatherKindLike = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog' | 'snow';
export type SeasonLike = 'spring' | 'summer' | 'autumn' | 'winter';

export interface AmbientIn {
  hour: number;
  /** 0 night … 1 noon */
  daylight: number;
  season: SeasonLike;
  weather: WeatherKindLike;
  /** 0..1 */
  intensity: number;
  /** m/s */
  wind: number;
  /** 0..1 cpu (windmill speed) */
  cpu: number;
  /** listener height above the valley floor proxy (m) — windier up on hills */
  altitude: number;
  /** distances (m) from the listener */
  dRiver: number;
  dPond: number;
  dWaterfall: number;
  dFire: number;
  dWindmill: number;
  /** nearest bee plot, Infinity when none */
  dBees: number;
  /** nearest cow / sheep field, Infinity when none */
  dHerd: number;
  /** distance from the village square (the trees are out in the countryside) */
  dHub: number;
}

export interface AmbientLevels {
  wind: number; rain: number; storm: number;
  river: number; waterfall: number; pond: number;
  birds: number; crickets: number; owls: number; frogs: number;
  fire: number; windmill: number; bees: number;
  leaves: number; cowbells: number;
  /** music level multiplier (storms hush it) */
  music: number;
}
export const emptyLevels = (): AmbientLevels => ({
  wind: 0, rain: 0, storm: 0, river: 0, waterfall: 0, pond: 0, birds: 0, crickets: 0, owls: 0, frogs: 0, fire: 0, windmill: 0, bees: 0, leaves: 0, cowbells: 0, music: 0,
});

/** Dawn chorus: a bump around sunrise-ish (hour ≈ 6.5). */
const dawn = (h: number): number => Math.exp(-(((h - 6.6) / 1.1) ** 2));
const dusk = (h: number): number => Math.exp(-(((h - 19.8) / 1.4) ** 2));

export function ambientLevels(a: AmbientIn, out: AmbientLevels = emptyLevels()): AmbientLevels {
  const night = clamp(1 - a.daylight, 0, 1);
  const k = a.weather;
  const wet = k === 'rain' ? 0.35 + 0.65 * a.intensity : k === 'storm' ? 0.7 + 0.3 * a.intensity : 0;
  const snow = k === 'snow' ? 0.4 + 0.6 * a.intensity : 0;
  const cold = a.season === 'winter' ? 1 : 0;
  out.rain = clamp(wet, 0, 1);
  out.storm = k === 'storm' ? clamp(0.5 + 0.5 * a.intensity, 0, 1) : 0;
  out.wind = clamp(0.12 + a.wind / 14 + out.storm * 0.35 + snow * 0.1 + clamp(a.altitude / 25, 0, 0.3) + (k === 'fog' ? -0.06 : 0), 0.04, 1);
  out.river = proximity(a.dRiver, 5, 48);
  // right up against the falls (the grotto's ledge runs behind the curtain) the roar swells past the usual peak
  out.waterfall = proximity(a.dWaterfall, 10, 120) * (1 + 0.3 * proximity(a.dWaterfall, 3, 9));
  out.pond = proximity(a.dPond, 10.5, 32) * (1 - snow * 0.5);
  const quietWeather = 1 - 0.85 * out.rain - 0.5 * snow - (k === 'fog' ? 0.3 : 0);
  out.birds = clamp((a.daylight * 0.55 + dawn(a.hour) * 0.65 + dusk(a.hour) * 0.15 * a.daylight) * quietWeather * (cold ? 0.45 : 1), 0, 1);
  out.crickets = clamp(smooth(0.25, 0.75, night) * (0.6 + 0.4 * dusk(a.hour)) * (1 - 0.75 * out.rain) * (1 - snow) * (cold ? 0 : a.season === 'autumn' ? 0.7 : 1), 0, 1);
  out.owls = clamp(smooth(0.7, 0.95, night) * (1 - 0.8 * out.rain) * 0.8, 0, 1);
  const frogSeason = a.season === 'winter' ? 0 : a.season === 'autumn' ? 0.45 : 1;
  out.frogs = clamp(smooth(0.35, 0.8, night) * frogSeason * proximity(a.dPond, 12, 70) * (1 + 0.3 * out.rain), 0, 1);
  // the campfire is lit from late afternoon through the night
  const lit = Math.max(smooth(0.25, 0.6, night), a.hour >= 17.5 || a.hour < 6 ? 1 : 0);
  out.fire = proximity(a.dFire, 2.5, 30) * lit * (1 - 0.6 * out.rain);
  out.windmill = proximity(a.dWindmill, 5, 50) * (0.3 + 0.7 * clamp(a.cpu, 0, 1));
  out.bees = Number.isFinite(a.dBees) ? proximity(a.dBees, 3, 26) * clamp(a.daylight * 1.4, 0, 1) * (1 - out.rain) * (cold ? 0 : 1) : 0;
  // wind in the trees: out in the countryside, stronger with the wind, thin in winter (bare boughs)
  const boughs = a.season === 'winter' ? 0.3 : a.season === 'autumn' ? 1.1 : 0.9;
  out.leaves = clamp((out.wind - 0.1) * 1.3 * boughs * smooth(12, 34, a.dHub) * (1 - 0.6 * out.rain), 0, 1);
  out.cowbells = Number.isFinite(a.dHerd) ? proximity(a.dHerd, 6, 60) * smooth(0.12, 0.45, a.daylight) * (1 - 0.7 * out.rain) * (1 - 0.6 * snow) : 0;
  out.music = 1 - out.storm * 0.6;
  return out;
}

/**
 * Carrier-pigeon / cricket style log mapping kept here for sharing: bytes/s → 0..1 (1 kB/s ≈ 0, 100 MB/s ≈ 1).
 */
export const logRate = (bytesPerSec: number): number => clamp((Math.log10(Math.max(1, bytesPerSec)) - 3) / 5, 0, 1);

/** Dolbear's law, gently: crickets chirp faster when it's warm (°C of the machine's hottest sensor, clamped). */
export function cricketPeriod(tempC: number | null): number {
  const t = clamp(tempC ?? 50, 30, 90);
  return 0.95 - (t - 30) * 0.0075; // 0.95 s at 30 °C … 0.5 s at 90 °C
}
