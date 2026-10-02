// @pure
/**
 * The villagers' clock, scene side. The day plans themselves are pure model (model/routines.ts: `planFor`,
 * `routineAt`, the seeded per-day jitter, rounds); this keeps the per-place beat loop: each place plays a seeded loop
 * of acts, so nobody is a cuckoo clock.
 */
import type { Beat } from './cast.ts';
export { entryAt, entryStart, hash01, hoursInto, keyOf, roundStop, stormy, JITTER_H } from '../../model/routines.ts';
import { hash01 } from '../../model/routines.ts';

/**
 * The next beat of a place's loop after beat `prev` (−1 = arriving): walk the loop in order, skipping beats whose
 * chance roll fails; returns the beat index and how long to hold it. Deterministic in (key, n).
 */
export function nextBeat(loop: readonly Beat[], prev: number, key: number, n: number): { i: number; secs: number } {
  if (!loop.length) return { i: -1, secs: 10 };
  let i = prev;
  for (let tries = 0; tries < loop.length; tries++) {
    i = (i + 1) % loop.length;
    const b = loop[i];
    if (b.p === undefined || hash01(key + n * 1.37, i + tries * 0.11) < b.p) break;
  }
  const b = loop[i];
  return { i, secs: b.min + (b.max - b.min) * hash01(key * 0.7 + i, n * 0.53) };
}
