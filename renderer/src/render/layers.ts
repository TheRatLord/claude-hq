// @pure
import type * as THREE from 'three';
/**
 * three.js layer ids (§5.1 pass split). Owner: RND.
 * - RenderPass draws DEFAULT|ENV|PROPS (opaque world, then glass) → N8AO.
 * - CharPass draws CHARS, then HULLS, then OVERLAY (bubbles, blobs, particles) after AO, depth-tested against the
 *   scene depth.
 * - The studio key's shadow render uses CASTERS|CHARS (+ `castShadow`); architecture never casts.
 * Materials from `getMaterial` carry `userData.hqLayer`; `post.ts` moves meshes onto that layer automatically, so
 * callers only need `getMaterial`. Props that cast shadows call `markCaster(obj)`.
 */
// PREPASS (m2 fix r1, perf): architecture also drawn depth-only before the world pass (post.ts WorldPass), so the
// toon shader runs once per pixel instead of once per overlapping wall / floor / ceiling
export const LAYERS = Object.freeze({ DEFAULT: 0, ENV: 1, PROPS: 2, CHARS: 3, HULLS: 4, CASTERS: 5, OVERLAY: 6, PREPASS: 7 });

export const bit = (l: number): number => 1 << l;
/** Camera masks per pass. */
export const MASK = Object.freeze({
  world: bit(LAYERS.DEFAULT) | bit(LAYERS.ENV) | bit(LAYERS.PROPS),
  chars: bit(LAYERS.CHARS),
  hulls: bit(LAYERS.HULLS),
  overlay: bit(LAYERS.OVERLAY),
  shadow: bit(LAYERS.CASTERS) | bit(LAYERS.CHARS),
  prepass: bit(LAYERS.PREPASS),
});

/** Put a prop in the shadow caster set (§5.2: chairs, plants, big props). */
export function markCaster<T extends THREE.Object3D>(obj: T): T {
  obj.traverse?.((o) => { if ('isMesh' in o && o.isMesh) { o.castShadow = true; o.layers.enable(LAYERS.CASTERS); } });
  return obj;
}
