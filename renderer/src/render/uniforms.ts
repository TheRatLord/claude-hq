/**
 * Shared uniform objects (one `{value}` per name, referenced by every program that uses it, so a write here reaches
 * every material without a per-material loop). Written by lights.ts / lamps.ts / post.ts / probe.ts each frame.
 * Owner: RND.
 */
import * as THREE from 'three';
import { ENV_HEMI_FLOOR, SUN_PATCH } from './lightMath.ts';

/** A bag of named uniforms (a material's `local` set, merged into its program's). */
export type UniformMap = Record<string, THREE.IUniform>;

/** A uniform an effect registered in its constructor (the `uniforms` map is untyped by name). */
export function effectUniform<T>(fx: { readonly uniforms: Map<string, THREE.Uniform> }, name: string): THREE.Uniform<T> {
  const u = fx.uniforms.get(name);
  if (!u) throw new Error(`effect has no uniform ${name}`);
  return u;
}

export const MAX_LAMPS = 12;
/** Gobo windows per frame (§5.6 `uWindows[8]`): Medium uses ≤ 4, High ≤ 8. */
export const MAX_WINDOWS = 8;
/** Complementary-staging rects (zoneGrade.ts). */
export const MAX_STAGES = 4;
/** Monitor spill (M3.5, deskScreens.updateSpill): the nearest lit desk screens light the face / desk in front of them. */
export const MAX_SPILL = 8;

export const U = {
  uTime: { value: 0 },
  uResolution: { value: new THREE.Vector2(1920, 1080) },
  /** kKey, kAmb, kSun(0 for chars), lampScale — two separate sets (§5.0: only env takes sun). */
  uGainChar: { value: new THREE.Vector4(0.62, 0.38, 1, 0.15) }, // kKey, kAmb, char exposure (RND fix r2), lampScale
  uGainEnv: { value: new THREE.Vector4(0.48, 0.46, 0.2, 0.15) },
  uKeyCol: { value: new THREE.Color(1, 0.8, 0.65) },
  uSky: { value: new THREE.Color(0.85, 0.9, 1) },
  uGround: { value: new THREE.Color(1, 0.8, 0.6) },
  /** Env hemisphere ground (lightMath ENV_GROUND_SOFTEN): a creamier bounce for architecture. */
  uEnvGround: { value: new THREE.Color(1, 0.85, 0.7) },
  uEnvSky: { value: new THREE.Color(0.81, 0.91, 1) },   // env/prop hemisphere sky (lightMath ENV_SKY_SOFTEN)
  uShadowTint: { value: new THREE.Color(0.4, 0.38, 0.72) },
  /** Env/prop base-light tint (key + ambient; not pools, sun or characters), cool at night (lightMath ENV_TINT). */
  uEnvTint: { value: new THREE.Color(1, 1, 1) },
  /** Per-zone colour script (zoneGrade.ts; env + props only): key / hemisphere-sky / hemisphere-ground tints. */
  uZoneKey: { value: new THREE.Color(1, 1, 1) },
  uZoneSky: { value: new THREE.Color(1, 1, 1) },
  uZoneGround: { value: new THREE.Color(1, 1, 1) },
  /** Complementary staging (§5.5, zoneGrade.ts): up to MAX_STAGES world xz rects {minX, minZ, maxX, maxZ} where Clawds
   *  gather (atrium + lobby, bays + street, café). Env + props inside take the hero-zone grade whatever cell the camera
   *  is in, and their warm mid-chroma albedos are pulled toward grey by uStageDesat (m175 fix r2). */
  uStageRect: { value: Array.from({ length: MAX_STAGES }, () => new THREE.Vector4(0, 0, -1, -1)) },
  uStageKey: { value: new THREE.Color(1, 1, 1) },
  uStageSky: { value: new THREE.Color(1, 1, 1) },
  uStageGround: { value: new THREE.Color(1, 1, 1) },
  uStageDesat: { value: new THREE.Vector4(0, 0, 0, 0) },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunCol: { value: new THREE.Color(1, 0.9, 0.8) },
  /** The skylight gobo's sun direction (lightMath goboSkyDir: true azimuth, elevation ≥ GOBO_SKY_MIN_ELEV). */
  uGoboSkyDir: { value: new THREE.Vector3(0, 1, 0) },
  uLampPos: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4(0, -100, 0, 0)) },
  uLampCol: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Color(0, 0, 0)) },
  /** Monitor spill (M3.5): screen centre + reach (w, 0 = unused) / front normal / light colour × gain; toon chars + props. */
  uSpillPos: { value: Array.from({ length: MAX_SPILL }, () => new THREE.Vector4(0, -100, 0, 0)) },
  uSpillN: { value: Array.from({ length: MAX_SPILL }, () => new THREE.Vector4(0, 0, 1, 0)) },
  uSpillCol: { value: Array.from({ length: MAX_SPILL }, () => new THREE.Color(0, 0, 0)) },
  uSpillCount: { value: 0 },
  /** 1 normally; probe.ts sets 0 for `lumaStats({emissive:false})`. */
  uEmissiveGain: { value: 1 },
  /** probe.ts greyCheck only: 1 renders every screen / readout (screen.ts) black for one frame, to find readout pixels. */
  uScreenMask: { value: 0 },
  /** probe.ts lumaStats (m2 fix r3): 1 renders the window sky exactly black for one frame (sky pixels leave the measure). */
  uSkyMask: { value: 0 },
  /** Screen accent gain (§5.0: 1 + 0.5 / max(1, visibleScreens/4)). */
  uAccentGain: { value: 1.5 },
  /** Window gobo (§5.6): up to 8 window rects {centre.xyz, halfW} / {inward normal.xyz, halfH} (world; a normal with
   *  |y| > 0.5 is a skylight: halfW along x, halfH along z) / clip {minX, minZ, maxX, maxZ} = the window's room. */
  uWinA: { value: Array.from({ length: MAX_WINDOWS }, () => new THREE.Vector4(0, -100, 0, 0)) },
  uWinB: { value: Array.from({ length: MAX_WINDOWS }, () => new THREE.Vector4(0, 0, 1, 0)) },
  uWinC: { value: Array.from({ length: MAX_WINDOWS }, () => new THREE.Vector4(0, 0, 0, 0)) },
  uWinCount: { value: 0 },
  uGobo: { value: 1 },
  /** Env-only hemisphere floor (toon.ts): the down-facing ambient factor for architecture (chars/props keep 0.55). */
  uEnvHemiFloor: { value: ENV_HEMI_FLOOR },
  /** Sun-patch multiplier on kSun inside the window gobo (toon.ts; lightMath SUN_PATCH). */
  uSunPatch: { value: SUN_PATCH },
  /** RND fix r1: sun-patch value cap (x = linear Y ceiling, y = max lift over the unlit value); lightMath PATCH_CAP. */
  uPatchCap: { value: new THREE.Vector2(0.34, 1.12) },
  /** Alias of uGainEnv for props' sun-patch term (toon.ts uSunGain.z = env kSun). */
  get uSunGain() { return U.uGainEnv; },
  /** Sky gradient + night factor for the window sky (sky.ts), written by lights.ts. */
  uSkyTop: { value: new THREE.Color(0.28, 0.55, 0.8) },
  uSkyHorizon: { value: new THREE.Color(0.95, 0.8, 0.62) },
  /** Horizon colour away from the sun's azimuth (golden hour: lilac; day/night = uSkyHorizon). */
  uSkyHorizonAway: { value: new THREE.Color(0.95, 0.8, 0.62) },
  uNight: { value: 0 },
  /** Golden-hour phase weight (lightMath phaseWeights().golden): exterior glass + the atrium sun shaft go peach. */
  uGolden: { value: 0 },
  /** Lamp phase 0 (day, lamps at 15%) → 1 (night, fully on); drives day-dimmed emissives (shades, bulbs). */
  uLampPhase: { value: 0 },
};
