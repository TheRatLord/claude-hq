/**
 * The wind service ('wind'): a gusty field that travels downwind, plus shared shader uniforms for foliage and cloth.
 *
 *   uWindTime      float  seconds (animation clock)
 *   uWindDir       vec2   unit direction the wind blows toward (x, z)
 *   uWindStrength  float  ≈0 calm … 1 breezy … 2.5 storm (already gust-modulated)
 *
 * Suggested vertex sway: `float ph = uWindTime * 1.7 + dot(worldPos.xz, uWindDir) * 0.35;`
 * `worldPos.xz += uWindDir * (sin(ph) * 0.5 + 0.5) * uWindStrength * 0.08 * heightAboveRoot;`
 */
import * as THREE from 'three';
import type { WindService } from '../context.ts';
import type { Atmo } from './atmo.ts';

export interface WindHandle extends WindService {
  update(time: number): void;
}

export function createWind(a: Atmo): WindHandle {
  const dir = new THREE.Vector2(1, 0);
  const uniforms = { uWindTime: { value: 0 }, uWindDir: { value: dir }, uWindStrength: { value: 0.4 } };
  /** big slow gusts that sweep across the valley in the wind direction */
  const gustAt = (x: number, z: number, t: number): number => {
    const along = x * a.windDir.x + z * a.windDir.y;
    const across = -x * a.windDir.y + z * a.windDir.x;
    const s = Math.max(1, a.windSpeed);
    const g1 = Math.sin(t * 0.55 - along * 0.045 * (4 / s) * 0.6 + Math.sin(across * 0.03) * 1.3);
    const g2 = Math.sin(t * 1.27 - along * 0.11 + across * 0.05);
    const g3 = Math.sin(t * 0.21 + 1.7);
    return Math.max(0.15, 1 + 0.32 * g1 + 0.14 * g2 + 0.18 * g3);
  };
  return {
    uniforms,
    at(x, z, t, out) {
      const k = a.windSpeed * gustAt(x, z, t);
      out.x = a.windDir.x * k;
      out.z = a.windDir.y * k;
      return out;
    },
    update(time) {
      a.gust = gustAt(0, 0, time);
      uniforms.uWindTime.value = time;
      dir.copy(a.windDir);
      uniforms.uWindStrength.value = (a.windSpeed / 4) * a.gust;
    },
  };
}
