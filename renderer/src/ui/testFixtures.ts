/**
 * Test fixtures for ui/*.test.ts: partial entities the UI models read a few fields of, and small typed helpers.
 * (No node:test import: this file is type-checked with the renderer project too.) Owner: UI.
 */
import type { Entity, Identity } from '../../../shared/protocol.ts';

/** Every field optional, all the way down (arrays elementwise). */
export type Deep<T> = T extends readonly (infer U)[] ? Deep<U>[] : T extends object ? { [K in keyof T]?: Deep<T[K]> } : T;

/**
 * A test entity: the fields a test cares about, the rest absent. The UI models under test only read the fields the
 * fixture sets, so the one cast (a partial → the full Entity) is the fixture boundary, not a claim about production data.
 */
export function ent(p: Deep<Entity>): Entity {
  return p as Entity;
}

/** A stable identity with only the terminal id set (the other components never match). */
export const ident = (terminalId: string): Identity => ({ terminalId, agentSession: null, place: '' });

/** `map.get(k)`, failing the test when it is absent. */
export function must<K, V>(m: ReadonlyMap<K, V>, k: K): V {
  const v = m.get(k);
  if (v === undefined) throw new Error(`fixture: no entry for ${String(k)}`);
  return v;
}
