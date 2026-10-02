/**
 * The valley's skyline, baked once for the water's reflections: for each azimuth around the valley centre, the
 * terrain point that rises highest above the horizon as seen from the middle of the valley (the rim, or a far peak
 * behind it), as its distance and its height above the water. The water shader casts its reflected ray from the
 * pixel, finds where it meets that ring (two lookups: a guess at a mean radius, then the ring's own radius there) and
 * compares the ray's slope with the skyline's: below it the water mirrors the rim (hazy cliffs, turf, snow caps), above
 * it the sky gradient. One 256×1 texture, ~20k `heightAt` samples (~20 ms) at build.
 */
import * as THREE from 'three';
import { WORLD, heightAt } from '../../world/map.ts';

export const SKYLINE_N = 256;
/** encoding ranges: distance (m) and height above the water (m) */
export const SKYLINE_DIST = 512, SKYLINE_HEIGHT = 256;

/** `[dist, height]` per azimuth (atan2(z, x) from −π, SKYLINE_N steps) */
export function skylineProfile(n = SKYLINE_N): Float32Array {
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const a = -Math.PI + ((i + 0.5) / n) * Math.PI * 2;
    const cx = Math.cos(a), cz = Math.sin(a);
    let best = -1, bd = 150, bh = 0;
    for (let d = 40; d <= 440; d += 5) {
      const h = heightAt(cx * d, cz * d) - WORLD.water;
      const e = h / d;
      if (e > best) { best = e; bd = d; bh = h; }
    }
    out[i * 2] = bd; out[i * 2 + 1] = Math.max(0, bh);
  }
  return out;
}

/** RGBA8 1D texture: R/G = distance (hi/lo bytes of SKYLINE_DIST), B/A = height (hi/lo of SKYLINE_HEIGHT); wraps in u */
export function skylineTexture(): THREE.DataTexture {
  const p = skylineProfile();
  const data = new Uint8Array(SKYLINE_N * 4);
  const enc = (v: number, range: number, o: number) => {
    const q = Math.round(Math.min(1, Math.max(0, v / range)) * 65535);
    data[o] = q >> 8; data[o + 1] = q & 255;
  };
  for (let i = 0; i < SKYLINE_N; i++) {
    enc(p[i * 2], SKYLINE_DIST, i * 4);
    enc(p[i * 2 + 1], SKYLINE_HEIGHT, i * 4 + 2);
  }
  const t = new THREE.DataTexture(data, SKYLINE_N, 1, THREE.RGBAFormat);
  // nearest + manual lerp would be exact; linear filtering of hi/lo bytes is wrong across a carry, so sample nearest
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  t.name = 'skyline';
  return t;
}
