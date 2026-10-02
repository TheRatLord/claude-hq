/**
 * Footstep surfaces (pure). The controller reports grass / water / wood (a deck); the audio refines that from where
 * the player stands: the paved square, the dirt roads, snow, the farmhouse floorboards, and how wet it all is.
 */
import type { SeasonLike, WeatherKindLike } from './mix.ts';

export type StepSurface = 'grass' | 'dirt' | 'stone' | 'deck' | 'floor' | 'water' | 'snow';
export const STEP_SURFACES: readonly StepSurface[] = ['grass', 'dirt', 'stone', 'deck', 'floor', 'water', 'snow'];

/** The hub plaza's paved disc (mirrors PLAZA in scene/structures/dressing.ts). */
export const PLAZA = Object.freeze({ x: 0, z: -1, r: 9.6 });
/** Winter snow line (mirrors snowLine('winter') in scene/terrain/ground.ts). */
export const WINTER_SNOW_LINE = 13;

export interface StepIn {
  ctrl: 'grass' | 'water' | 'wood';
  indoors: boolean;
  /** 0..1 how much the spot is on a road (world/map.ts pathAt) */
  path: number;
  /** distance from the plaza centre (m) */
  plaza: number;
  season: SeasonLike;
  weather: WeatherKindLike;
  /** 0..1 ground wetness (sky.trace.wet: puddles linger after a shower) */
  wet: number;
  /** 0..1 lying snow (sky.trace.snow) */
  snow: number;
  /** ground height (m) */
  height: number;
}
export interface StepOut {
  surface: StepSurface;
  /** 0..1: how much puddle splash rides on the step */
  splash: number;
}

export function stepSurface(i: StepIn, out: StepOut = { surface: 'grass', splash: 0 }): StepOut {
  const wet = Math.max(0, Math.min(1, i.wet));
  const raining = i.weather === 'rain' || i.weather === 'storm';
  out.splash = 0;
  if (i.ctrl === 'water') { out.surface = 'water'; return out; }
  if (i.indoors) { out.surface = 'floor'; return out; }
  if (i.ctrl === 'wood') { out.surface = 'deck'; out.splash = raining ? wet * 0.35 : 0; return out; }
  const snowy = i.snow > 0.3 || (i.season === 'winter' && i.height > WINTER_SNOW_LINE);
  if (i.plaza < PLAZA.r && i.snow < 0.6) out.surface = 'stone';
  else if (snowy) { out.surface = 'snow'; return out; }
  else if (i.path > 0.55) out.surface = 'dirt';
  else out.surface = 'grass';
  // puddles: paving and roads splash most, grass squelches a little; they linger after the rain stops
  const w = raining ? Math.max(wet, 0.5) : wet;
  out.splash = w < 0.25 ? 0 : (w - 0.25) / 0.75 * (out.surface === 'grass' ? 0.5 : 1);
  return out;
}
