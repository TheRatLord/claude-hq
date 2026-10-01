/**
 * Helpers for light-emitting materials (kept apart from shader.ts, which toon.ts imports, to avoid an import cycle
 * through the surface library).
 */
import type * as THREE from 'three';
import { chainShader } from '../surface/material.ts';

/**
 * Mark an unlit emitter material (flames, embers, lantern cores) as warm light for the night grade, so it keeps its
 * colour instead of being cooled toward moonlight blue like everything else that is dim. `k` 0..1.
 */
export function warmEmitter<M extends THREE.Material>(m: M, k = 1): M {
  const a = (1 - 0.5 * Math.min(1, Math.max(0, k))).toFixed(3);
  return chainShader(m, (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>\ngl_FragColor.a = ${a};`);
  }, `warm-emitter:${a}`);
}
