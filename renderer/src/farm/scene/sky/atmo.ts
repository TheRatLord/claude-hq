/**
 * Shared, eased atmosphere state between the three atmosphere systems (sky → weather → post, in that order each
 * frame). Private to the atmosphere package: other packages read `ctx.lighting` and the 'wind' service instead.
 */
import * as THREE from 'three';
import type { SceneCtx } from '../context.ts';

export interface Grade {
  exposure: number;
  /** multiplies linear colour before tone mapping (white balance / warmth) */
  gain: THREE.Color;
  /** added to dark tones after tone mapping (blue-purple shadows) */
  shadowTint: THREE.Color;
  saturation: number;
  contrast: number;
  vignette: number;
  bloomThreshold: number;
  bloomStrength: number;
  /** outline ink colour (linear) and strength */
  ink: THREE.Color;
  inkStrength: number;
}

export interface Atmo {
  /** eased weather channels, 0..1 */
  overcast: number;
  rain: number;
  snow: number;
  storm: number;
  fog: number;
  /** eased cloud cover 0..1 (drives cloud count) */
  cover: number;
  /** lightning flash 0..1 this frame (weather writes, sky + post read) */
  flash: number;
  /** rainbow visibility 0..1 (weather writes, sky reads) */
  rainbow: number;
  /** sun elevation (sin), negative below the horizon */
  sunElev: number;
  /** true unit sun / moon directions (the visible disks; `lighting.sunDir` is the key light) */
  sun: THREE.Vector3;
  moon: THREE.Vector3;
  /** 0 new … 0.5 full … 1 */
  moonPhase: number;
  zenith: THREE.Color;
  horizon: THREE.Color;
  /** sun-side horizon glow colour */
  glow: THREE.Color;
  /** ground mist in the valley 0..2 (dawn, fog, after rain) */
  mist: number;
  /** cloud-shadow strength on the ground 0..1 and the drift offset (m) */
  cloudShadow: number;
  cloudOffset: THREE.Vector2;
  daylight: number;
  /** palette night 0..1 (clock only, not weather) */
  night: number;
  grade: Grade;
  /** eased wind (m/s) and direction (unit) — the wind service reads these */
  windSpeed: number;
  windDir: THREE.Vector2;
  /** the wind service's global gust factor this frame (≈0.6..1.4) */
  gust: number;
  time: number;
}

const store = new WeakMap<SceneCtx, Atmo>();

export function atmoOf(ctx: SceneCtx): Atmo {
  let a = store.get(ctx);
  if (a) return a;
  a = {
    overcast: 0, rain: 0, snow: 0, storm: 0, fog: 0, cover: 0.2, flash: 0, rainbow: 0, sunElev: 0.7,
    sun: new THREE.Vector3(0, 0.8, 0.6).normalize(), moon: new THREE.Vector3(0, -1, 0), moonPhase: 0.5,
    zenith: new THREE.Color(0x3f8ee6), horizon: new THREE.Color(0xbfe3f7), glow: new THREE.Color(0xfff0d0),
    mist: 0, cloudShadow: 0, cloudOffset: new THREE.Vector2(), daylight: 1, night: 0,
    grade: {
      exposure: 1, gain: new THREE.Color(1, 1, 1), shadowTint: new THREE.Color(0, 0, 0), saturation: 1, contrast: 1,
      vignette: 0.2, bloomThreshold: 1.2, bloomStrength: 0.6, ink: new THREE.Color(0x2b2420), inkStrength: 0.8,
    },
    windSpeed: 2, windDir: new THREE.Vector2(1, 0), gust: 1, time: 0,
  };
  store.set(ctx, a);
  return a;
}

/** frame-rate independent approach of `cur` toward `target` with time constant `tau` seconds */
export const ease = (cur: number, target: number, dt: number, tau: number): number =>
  cur + (target - cur) * (1 - Math.exp(-dt / Math.max(1e-4, tau)));

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
export const smooth = (a: number, b: number, v: number): number => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
