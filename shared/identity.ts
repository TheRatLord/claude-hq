// @pure
/**
 * Stable hashing, seeded RNG, workspace colour assignment and stable pane identity (DESIGN §3.1, §4.2, §8.10).
 * Owner: LEAD. Pure (no three, no node built-ins).
 */

import type { Identity } from './protocol.ts';

/** Number of workspace colour indices in the wire contract; actual colours belong to the frontend. */
const WORKSPACE_COUNT = 8;

const enc = new TextEncoder();

/**
 * 32-bit FNV-1a over the UTF-8 bytes, finished with the murmur3 fmix32 avalanche. Unsigned.
 * Deterministic across Node and browsers; used for personality seeds, colour slots, prompt hashes.
 * @returns uint32
 */
export function hash32(str: string): number {
  const bytes = enc.encode(String(str));
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** hash32 as 8 lowercase hex chars. */
export function hashHex(str: string): string {
  return hash32(str).toString(16).padStart(8, '0');
}

/**
 * mulberry32 PRNG. `mulberry32(hash32(seedKey))` seeds personality (§6.3).
 * @returns a generator of uniform [0, 1)
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Blocked-prompt hash (§4.3): hash32(stateSeq + '\n' + question + '\n' + labels.join('\n')) as hex.
 * `labels` are the option labels in order.
 */
export function promptHash(stateSeq: number | null, question: string, labels: string[]): string {
  return hashHex(`${stateSeq ?? ''}\n${question ?? ''}\n${(labels ?? []).join('\n')}`);
}

/**
 * Colour slot for a workspace: hash of the label with linear probing past colours already taken
 * by lower-numbered workspaces (in the same 8-wide cycle band). Same label → same colour across restarts.
 * `taken` = colorIndexes already used. Returns 0..7.
 */
export function workspaceColorIndex(label: string, taken: Iterable<number> = []): number {
  const used: ReadonlySet<number> = taken instanceof Set ? taken : new Set(taken);
  const start = hash32(label) % WORKSPACE_COUNT;
  for (let k = 0; k < WORKSPACE_COUNT; k++) {
    const idx = (start + k) % WORKSPACE_COUNT;
    if (!used.has(idx)) return idx;
  }
  return start;
}

/**
 * Assign {colorIndex, cycle} for a whole workspace list (§3.1). Order by `number`; the n-th workspace
 * (0-based) gets `cycle = floor(n/8)` and probes only against lower-numbered workspaces of its cycle.
 * @returns colour + cycle by workspace id
 */
export function assignWorkspaceColors(workspaces: { id: string; label: string; number: number }[]): Map<string, { colorIndex: number; cycle: number }> {
  const sorted = [...workspaces].sort((a, b) => a.number - b.number || String(a.id).localeCompare(String(b.id)));
  const takenByCycle = new Map<number, Set<number>>();
  const out = new Map<string, { colorIndex: number; cycle: number }>();
  sorted.forEach((ws, n) => {
    const cycle = Math.floor(n / WORKSPACE_COUNT);
    const taken = takenByCycle.get(cycle) ?? new Set<number>();
    takenByCycle.set(cycle, taken);
    const colorIndex = workspaceColorIndex(ws.label ?? '', taken);
    taken.add(colorIndex);
    out.set(ws.id, { colorIndex, cycle });
  });
  return out;
}

/**
 * The `place` component of a stable identity: `${ws.label}/${tab.label}/${paneIndex}/${cwd}`.
 */
export function placeOf(wsLabel: string, tabLabel: string, paneIndex: number, cwd: string): string {
  return `${wsLabel ?? ''}/${tabLabel ?? ''}/${paneIndex ?? 0}/${cwd ?? ''}`;
}

/** Match strength order (§4.2 rekey order): terminalId → agentSession → place. */
export const IDENTITY_MATCH_ORDER = Object.freeze(['terminalId', 'agentSession', 'place'] as const);
export type IdentityKey = (typeof IDENTITY_MATCH_ORDER)[number];

const hasIdentity = (x: { identity?: Identity } | Identity): x is { identity?: Identity } => 'identity' in x;

/**
 * Does a saved identity refer to this entity? Returns the strongest matching key, or null.
 * Empty/null components never match.
 */
export function identityMatch(saved: Identity | null | undefined, entityOrIdentity: { identity?: Identity } | Identity): IdentityKey | null {
  if (!saved || !entityOrIdentity) return null;
  const cur = hasIdentity(entityOrIdentity) ? entityOrIdentity.identity : entityOrIdentity;
  if (!cur) return null;
  for (const key of IDENTITY_MATCH_ORDER) {
    const a = saved[key];
    if (a != null && a !== '' && a === cur[key]) return key;
  }
  return null;
}

/**
 * Re-bind a saved identity against a set of entities (pins, notes, tabs; §8.10). Tries each key in order
 * across ALL entities before falling back to the next key; a key matching several entities is ambiguous
 * and skipped.
 */
export function findByIdentity<E extends { identity?: Identity }>(saved: Identity, entities: Iterable<E>): E | null {
  if (!saved) return null;
  const list = [...entities];
  for (const key of IDENTITY_MATCH_ORDER) {
    const want = saved[key];
    if (want == null || want === '') continue;
    const hits = list.filter((e) => e.identity && e.identity[key] === want);
    if (hits.length === 1) return hits[0];
  }
  return null;
}

/**
 * A single string key for maps/persistence (prefers the strongest available component).
 */
export function identityKey(identity: Identity | null | undefined): string {
  if (!identity) return '';
  for (const key of IDENTITY_MATCH_ORDER) if (identity[key]) return `${key}:${identity[key]}`;
  return '';
}
