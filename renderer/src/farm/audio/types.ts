/**
 * The life & sound package's own audio surface: a superset of the shared `AudioService` contract (scene/context.ts).
 * Other packages only see `AudioService`; the life system (same package) casts the 'audio' service to `ValleyAudio`
 * to voice its critters at their exact positions.
 */
import type * as THREE from 'three';
import type { AudioService } from '../scene/context.ts';

/** Small critter voices the life system triggers (all positional, all on the ambient bus). */
export const CRITTER_SOUNDS = Object.freeze([
  'chirp', // songbird on the ground / taking off: 2–4 quick high tweets
  'coo', // pigeon at the loft: soft "hoo-hoo-oo"
  'flap', // wings taking off: 3–5 soft feathery noise bursts
  'ribbit', // frog: croaky double pulse
  'plop', // frog / small thing hopping into water
  'hop', // rabbit / squirrel soft thud on grass
  'squeak', // squirrel chatter
  'wag', // dog: happy pant "hah-hah"
  'hoot', // owl
  'fish', // small fish splash
  'sniff', // dog: 3–4 quick snuffles
  'shake', // dog shaking off water: a fluttery rattle with droplets
  'caw', // crow: a rough "kaah"
] as const);
export type CritterSound = (typeof CRITTER_SOUNDS)[number];

export interface ValleyAudio extends AudioService {
  critter(kind: CritterSound, pos: THREE.Vector3, o?: { volume?: number; pitch?: number }): void;
}
