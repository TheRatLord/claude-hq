// @pure
/**
 * Personality (DESIGN §6.3, ART §5.5): deterministic knobs from the entity's seedKey via mulberry32(hash32()).
 * The same agent always looks and moves the same in every window. Owner: CHR.
 */
import { hash32, mulberry32 } from '../../../../shared/identity.ts';

export const FIDGETS = Object.freeze(['stretch', 'hopInPlace', 'lookAround', 'shimmy', 'yoyo', 'juggle', 'spin', 'polish']);
export const SPOTS = Object.freeze(['window', 'plants', 'coffee', 'arcade', 'beanbag', 'library']);
export const WALKS = Object.freeze(['trot', 'waddle', 'skip']);

export interface Personality {
  /** 0.75–1.3 (amplitude and tempo) */
  energy: number;
  /** 0.8–1.2 (squash spring stiffness) */
  bounciness: number;
  /** ±6 % */
  width: number;
  /** ±5 % */
  height: number;
  /** ±4° (degrees) */
  hue: number;
  /** ±5 % (fraction) */
  lightness: number;
  /** blinks per second */
  blinkRate: number;
  /** saccades per second */
  saccadeRate: number;
  /** ±10 % on loop speeds */
  tempo: number;
  /** 0..1 loop phase offset (stagger) */
  phase: number;
  favoriteFidget: string;
  favoriteSpot: string;
  walkStyle: string;
  /** 0..1 pitch */
  voice: number;
  /** int for noise */
  seed: number;
}

export function personality(seedKey: string, override: Partial<Personality> = {}): Personality {
  const r = mulberry32(hash32(String(seedKey ?? '')));
  const between = (a: number, b: number) => a + (b - a) * r();
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];
  const p: Personality = {
    energy: between(0.75, 1.3),
    bounciness: between(0.8, 1.2),
    width: between(-0.06, 0.06),
    height: between(-0.05, 0.05),
    hue: between(-4, 4),
    lightness: between(-0.05, 0.05),
    blinkRate: between(1 / 6, 1 / 2.5),
    saccadeRate: between(0.5, 1.25),
    tempo: between(0.9, 1.1),
    phase: r(),
    favoriteFidget: pick(FIDGETS),
    favoriteSpot: pick(SPOTS),
    walkStyle: r() < 0.6 ? 'trot' : r() < 0.6 ? 'waddle' : 'skip',
    voice: r(),
    seed: Math.floor(r() * 1e6),
  };
  return Object.assign(p, override);
}
