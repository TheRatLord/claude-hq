/**
 * Time-of-day palette: keyframes anchored to sunrise / sunset (which move with the season), smoothly blended.
 * Colours are authored as sRGB hex and converted to linear once.
 */
import * as THREE from 'three';
import { sunTimes } from '../../model/sky.ts';

export interface SkyKey {
  zenith: number;
  horizon: number;
  /** sun-side horizon glow */
  glow: number;
  /** key light (sun, or moonlight at night) */
  key: number;
  keyI: number;
  hemiSky: number;
  hemiGround: number;
  hemiI: number;
  stars: number;
  night: number;
  exposure: number;
  /** white balance multiplier (sRGB hex, 0x808080 = neutral) */
  gain: number;
  /** shadow split-tone (sRGB hex added to darks at ~0.1 scale; 0 = none) */
  shade: number;
  sat: number;
  contrast: number;
  bloom: number;
  mist: number;
}

type K = [hourOf: (rise: number, set: number) => number, key: SkyKey];

const NIGHT: SkyKey = {
  zenith: 0x050a1e, horizon: 0x1a2748, glow: 0x243463, key: 0xa4b6ec, keyI: 1.55, hemiSky: 0x34406e, hemiGround: 0x15182a, hemiI: 1.0,
  stars: 1, night: 1, exposure: 1.28, gain: 0x7c8498, shade: 0x0c1236, sat: 0.6, contrast: 1.04, bloom: 1, mist: 0.25,
};
const KEYS: K[] = [
  [(r) => r - 1.7, NIGHT],
  [(r) => r - 0.6, {
    zenith: 0x2e3f7c, horizon: 0xd99aa5, glow: 0xffa98e, key: 0xb39ae0, keyI: 0.6, hemiSky: 0x8088c0, hemiGround: 0x3e3648, hemiI: 1.1,
    stars: 0.35, night: 0.6, exposure: 1.15, gain: 0x888290, shade: 0x1a1a48, sat: 0.95, contrast: 1.02, bloom: 0.9, mist: 0.9,
  }],
  [(r) => r + 0.35, {
    zenith: 0x6a94d0, horizon: 0xf8c8a8, glow: 0xffb080, key: 0xffc494, keyI: 2.2, hemiSky: 0xa8bce8, hemiGround: 0x5e5a50, hemiI: 1.3,
    stars: 0, night: 0.12, exposure: 1.05, gain: 0x8a857f, shade: 0x1c1848, sat: 1.0, contrast: 1.03, bloom: 0.8, mist: 1,
  }],
  [(r) => r + 2, {
    zenith: 0x4c9ae6, horizon: 0xcfe6f2, glow: 0xfff0d0, key: 0xfff0d8, keyI: 3.2, hemiSky: 0xc2e0ff, hemiGround: 0x7d8a4c, hemiI: 1.45,
    stars: 0, night: 0, exposure: 1.0, gain: 0x84827d, shade: 0x141a3c, sat: 1.02, contrast: 1.03, bloom: 0.55, mist: 0.35,
  }],
  [(r, s) => (r + s) / 2, {
    zenith: 0x3a88e2, horizon: 0xbfe0f4, glow: 0xfff6e2, key: 0xfff7ea, keyI: 3.15, hemiSky: 0xc6e4ff, hemiGround: 0x86955a, hemiI: 1.5,
    stars: 0, night: 0, exposure: 1.0, gain: 0x82817f, shade: 0x12183a, sat: 1.0, contrast: 1.04, bloom: 0.5, mist: 0,
  }],
  [(_r, s) => s - 2.2, {
    zenith: 0x4488dc, horizon: 0xd2e2ea, glow: 0xffeccc, key: 0xfff0d4, keyI: 3.25, hemiSky: 0xc8dcf2, hemiGround: 0x84905a, hemiI: 1.45,
    stars: 0, night: 0, exposure: 1.0, gain: 0x85827c, shade: 0x141a3c, sat: 1.02, contrast: 1.04, bloom: 0.55, mist: 0,
  }],
  [(_r, s) => s - 1.0, {
    zenith: 0x5a84c4, horizon: 0xffd29a, glow: 0xffb45e, key: 0xffc67e, keyI: 2.9, hemiSky: 0xd0c6c4, hemiGround: 0x7a6a44, hemiI: 1.35,
    stars: 0, night: 0, exposure: 1.02, gain: 0x8c8074, shade: 0x1e1a44, sat: 1.05, contrast: 1.05, bloom: 0.7, mist: 0,
  }],
  [(_r, s) => s - 0.1, {
    zenith: 0x4a5aa0, horizon: 0xffa47a, glow: 0xff8a5a, key: 0xffaa74, keyI: 1.7, hemiSky: 0xa898b4, hemiGround: 0x4e4250, hemiI: 1.2,
    stars: 0.05, night: 0.25, exposure: 1.08, gain: 0x88807a, shade: 0x201a4a, sat: 0.98, contrast: 1.05, bloom: 0.85, mist: 0.1,
  }],
  [(_r, s) => s + 0.65, {
    zenith: 0x1f2865, horizon: 0x8a6c9e, glow: 0xd08a7a, key: 0x8e9ad0, keyI: 0.7, hemiSky: 0x525e8c, hemiGround: 0x222634, hemiI: 1.3,
    stars: 0.55, night: 0.75, exposure: 1.28, gain: 0x7e8290, shade: 0x101640, sat: 0.82, contrast: 1.04, bloom: 1, mist: 0.2,
  }],
  [(_r, s) => s + 2.1, NIGHT],
];

export interface SkyMix {
  zenith: THREE.Color; horizon: THREE.Color; glow: THREE.Color; key: THREE.Color; hemiSky: THREE.Color; hemiGround: THREE.Color;
  gain: THREE.Color; shade: THREE.Color;
  keyI: number; hemiI: number; stars: number; night: number; exposure: number; sat: number; contrast: number; bloom: number; mist: number;
}

export function createMix(): SkyMix {
  return {
    zenith: new THREE.Color(), horizon: new THREE.Color(), glow: new THREE.Color(), key: new THREE.Color(), hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(), gain: new THREE.Color(), shade: new THREE.Color(),
    keyI: 0, hemiI: 0, stars: 0, night: 0, exposure: 1, sat: 1, contrast: 1, bloom: 1, mist: 0,
  };
}

const ca = new THREE.Color(), cb = new THREE.Color();
const COLOR_KEYS = ['zenith', 'horizon', 'glow', 'key', 'hemiSky', 'hemiGround', 'gain', 'shade'] as const;
const NUM_KEYS = ['keyI', 'hemiI', 'stars', 'night', 'exposure', 'sat', 'contrast', 'bloom', 'mist'] as const;

/** blend the palette for a local hour (writes into `out`) */
export function samplePalette(hour: number, doy: number, out: SkyMix): SkyMix {
  const { rise, set } = sunTimes(doy);
  const h = ((hour % 24) + 24) % 24;
  // keys in [rise-1.7, set+2.1]; outside that window it is plain night
  let a = KEYS[KEYS.length - 1][1], b = KEYS[0][1], t = 0;
  for (let i = 0; i < KEYS.length - 1; i++) {
    const h0 = KEYS[i][0](rise, set), h1 = KEYS[i + 1][0](rise, set);
    if (h >= h0 && h < h1) { a = KEYS[i][1]; b = KEYS[i + 1][1]; t = (h - h0) / (h1 - h0); break; }
  }
  t = t * t * (3 - 2 * t);
  for (const k of COLOR_KEYS) {
    ca.setHex(a[k]);
    cb.setHex(b[k]);
    out[k].copy(ca).lerp(cb, t);
  }
  for (const k of NUM_KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
  // gain authored around 0x80 = 1.0
  out.gain.multiplyScalar(1 / 0.2158605001138992); // linear value of sRGB 0x80
  return out;
}
