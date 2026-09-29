// @pure
/**
 * Audio policy, pure and tested: mixer categories + settings mapping, the notification rate limiter (GP §5.4: 1 per
 * agent per 10 s, bursts merge), zone room-tone presets, occlusion between zones, typing classes, CPU → hum.
 * Owner: AUD.
 */

import type { Settings } from '../../../shared/protocol.ts';

/** The four category volume keys of Settings. */
export type LevelKey = 'volumeNotify' | 'volumeSfx' | 'volumeVoices' | 'volumeAmbient';
export type Category = 'notify' | 'sfx' | 'voices' | 'ambient';

/** Mixer categories → settings key (DEFAULT_SETTINGS in shared/protocol.ts). */
export const CATEGORIES: Readonly<Record<Category, LevelKey>> = Object.freeze({
  notify: 'volumeNotify', // chimes + dings (blocked / done / inbox zero)
  sfx: 'volumeSfx', // footsteps, typing, slide, event foley
  voices: 'volumeVoices', // Clawd blips
  ambient: 'volumeAmbient', // room tone, Engine Room hum, fish tank, mood bed
});
/** The category names, in mixer order (Object.keys loses the union; CATEGORIES is the single source). */
export const CATEGORY_NAMES = Object.keys(CATEGORIES) as Category[];
/** Fallbacks while an older backend's hello lacks the M3 keys. */
export const DEFAULT_LEVELS: Readonly<Pick<Settings, LevelKey | 'volumeMaster'>> = Object.freeze({ volumeMaster: 0.8, volumeNotify: 0.9, volumeSfx: 0.8, volumeVoices: 0.7, volumeAmbient: 0.5 });

/** Perceptual slider → linear gain (squared: 0.5 on the slider ≈ −12 dB). */
export const sliderGain = (v: number): number => { const x = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0)); return x * x; };

/** Settings reader: a possibly-missing value (an older backend's hello lacks the M3 keys). */
export type SettingGet = (k: keyof Settings) => unknown;

/** Category gain from settings. */
export function categoryGain(get: SettingGet, cat: Category): number {
  const k = CATEGORIES[cat];
  const v = get(k);
  return sliderGain(typeof v === 'number' ? v : DEFAULT_LEVELS[k]);
}
/** Master gain: 0 while muted or before the first user gesture. */
export function masterGain(get: SettingGet, unlocked: boolean): number {
  if (!unlocked || get('audioMuted') === true) return 0;
  const v = get('volumeMaster');
  return sliderGain(typeof v === 'number' ? v : DEFAULT_LEVELS.volumeMaster);
}

/**
 * Notification limiter: at most one per (agent, kind) per `perAgentMs`; within `mergeMs` of any global chime, later
 * ones play only their spatial part (the burst merges into the first chime).
 */
export function createLimiter({ perAgentMs = 10_000, mergeMs = 1500 }: { perAgentMs?: number; mergeMs?: number } = {}) {
  const last = new Map<string, number>();
  let lastGlobal = -Infinity;
  return {
    check(id: string, kind: string, now: number): { play: boolean; global: boolean } {
      const k = `${kind}|${id}`;
      if (now - (last.get(k) ?? -Infinity) < perAgentMs) return { play: false, global: false };
      last.set(k, now);
      const global = now - lastGlobal >= mergeMs;
      if (global) lastGlobal = now;
      return { play: true, global };
    },
    forget(id: string) { for (const k of last.keys()) if (k.endsWith(`|${id}`)) last.delete(k); },
  };
}

/**
 * Room tone per zone: `lp` bed lowpass Hz, `gain` bed level, `rev` reverb send, `hvac` low rumble level.
 * Tall open volumes (atrium, pit) are airier and wetter; the library and nap nook are hushed.
 */
export interface ZoneTone { lp: number; gain: number; rev: number; hvac: number }
export const ZONE_TONE: Readonly<Record<string, ZoneTone>> = Object.freeze({
  LOB: { lp: 1500, gain: 0.55, rev: 0.28, hvac: 0.5 },
  ATR: { lp: 1900, gain: 0.6, rev: 0.45, hvac: 0.5 },
  PIT: { lp: 1700, gain: 0.55, rev: 0.4, hvac: 0.45 },
  MEZ: { lp: 1500, gain: 0.45, rev: 0.35, hvac: 0.4 },
  LIB: { lp: 700, gain: 0.3, rev: 0.12, hvac: 0.3 },
  NAL: { lp: 800, gain: 0.35, rev: 0.12, hvac: 0.3 },
  STR: { lp: 1300, gain: 0.5, rev: 0.22, hvac: 0.45 },
  PLZ: { lp: 1300, gain: 0.5, rev: 0.22, hvac: 0.45 },
  ENG: { lp: 900, gain: 0.55, rev: 0.2, hvac: 0.9 },
  CAF: { lp: 2100, gain: 0.6, rev: 0.2, hvac: 0.45 },
  NAP: { lp: 450, gain: 0.25, rev: 0.08, hvac: 0.25 },
  MAIL: { lp: 1000, gain: 0.4, rev: 0.15, hvac: 0.4 },
  ARC: { lp: 800, gain: 0.35, rev: 0.18, hvac: 0.35 },
  WAR: { lp: 1100, gain: 0.4, rev: 0.12, hvac: 0.4 },
  LAB: { lp: 1400, gain: 0.45, rev: 0.12, hvac: 0.55 },
  BAY: { lp: 1100, gain: 0.42, rev: 0.12, hvac: 0.4 },
});
export const zoneTone = (zone: string | null): ZoneTone => ZONE_TONE[zone ?? ''] ?? (/^[WE]\d$/.test(zone ?? '') ? ZONE_TONE.BAY : ZONE_TONE.LOB);

/** Night (22–06) hushes the bed; golden hour a little. */
export const hourHush = (hour: number): number => (hour >= 22 || hour < 6 ? 0.6 : hour >= 18 ? 0.85 : 1);

/** The open-plan core: sound carries freely between these (no muffling). */
const OPEN = new Set(['LOB', 'ATR', 'PIT', 'MEZ', 'LIB']);
/**
 * Occlusion between the listener's zone and a source's zone. Same zone or both in the open core: clear. Otherwise
 * behind a wall/door: muffled (lowpass Hz, gain). `a` = listener zone, `b` = source zone.
 */
export function occlusion(a: string | null, b: string | null): { lp: number; gain: number } {
  if (!a || !b || a === b || (OPEN.has(a) && OPEN.has(b))) return { lp: 20000, gain: 1 };
  // glazed E bays and the street see each other / the atrium through glass: a lighter muffle
  const glass = (z: string) => /^E\d$/.test(z) || z === 'STR' || z === 'ENG';
  if ((glass(a) && OPEN.has(b)) || (glass(b) && OPEN.has(a)) || (glass(a) && glass(b))) return { lp: 2200, gain: 0.7 };
  return { lp: 900, gain: 0.45 };
}

/**
 * Typing is heard from what the agent visibly does (its animation activity), so sound and picture always agree:
 * activity → keystroke-rate multiplier (0 = silent).
 */
export const TYPING_ACTS: Readonly<Record<string, number>> = Object.freeze({ type: 1, typeFrenzy: 1.8, bashPound: 1.3, walkType: 0.7 });
export function typingRate(activity: string | null | undefined, status: string | null | undefined): number {
  if (status !== 'working' && status !== undefined) return 0;
  return TYPING_ACTS[activity ?? ''] ?? 0;
}

/**
 * Engine Room hum from CPU total (0–100): the ENG rack sings louder and brighter with load.
 */
export function humFor(cpuPct: number | null | undefined): { gain: number; cutoff: number; fan: number; pitch: number } {
  const c = Math.min(1, Math.max(0, (typeof cpuPct === 'number' && Number.isFinite(cpuPct) ? cpuPct : 0) / 100));
  return { gain: 0.15 + 0.85 * c, cutoff: 380 + 1500 * c ** 0.8, fan: 0.1 + 0.9 * c * c, pitch: 1 + 0.06 * c };
}

/** Reactions that never speak (cold-start dissolves, bell taps have their own sound). */
export const SILENT_REACTIONS = new Set(['dissolveIn', 'bellTap']);

/**
 * Help Desk bell (M3.5): the queue head's 20 s bell tap gets louder the longer the OLDEST block has waited, so a
 * neglected queue nags a little harder, capped so it never becomes an alarm. 0 s → 0.3, 5 min → 0.75 (cap).
 * `waitS` = oldest blocked agent's wait (s).
 */
export function bellGain(waitS: number | null | undefined): number {
  const w = Math.max(0, typeof waitS === 'number' && Number.isFinite(waitS) ? waitS : 0);
  return 0.3 + 0.45 * Math.min(1, w / 300) ** 0.7;
}

/** Blocked lantern escalation steps (s blocked): rise at the block, then brighter at 1 and 3 min (the rain cloud is 5). */
export const LANTERN_STEPS: readonly number[] = Object.freeze([0, 60, 180]);
/** Escalation level 0..2. */
export const lanternLevel = (waitS: number): number => (waitS >= LANTERN_STEPS[2] ? 2 : waitS >= LANTERN_STEPS[1] ? 1 : 0);

/**
 * Mix loudness targets at the default sliders (post-compressor, mono capture, `__hqAudio.probe`/`levels()`): room tone
 * sits well under everything, foley and voices in the middle, notifications on top; nothing near clipping. `bed` = the
 * steady ambient rms heard standing in a zone; the rest = loudest-50 ms rms of one cue at ~2 m. Verified by the
 * headless loudness pass (AUD m3.5: bed library 0.010 / atrium 0.016 / engine 0.028; cues 0.04–0.13 sfx, 0.11–0.16
 * notify; queue peak 0.21), kept here so a retune has one place to look.
 */
export const MIX_TARGETS = Object.freeze({
  bed: [0.008, 0.03], // −42…−30 dBFS: audible room air, never a hiss
  sfx: [0.03, 0.18], // footsteps, foley, ambient-life cues
  voices: [0.05, 0.2],
  notify: [0.1, 0.35],
  peakMax: 0.95,
});
