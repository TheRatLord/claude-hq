// @pure
/**
 * [UI fix r3, reviewer code "per-agent maps are never pruned"] Drop the entries of an id-keyed map whose agent is gone
 * (a closed pane, a rekeyed id). Callers run it on the store's 'gone' / rekey, or cheaply against the live actor list
 * whenever the map has grown past it (no Set is built while sizes agree). Owner: UI.
 */

/** Drops the entries whose id is not in `live` (the live agents: actors or ids); returns how many were removed. */
export function pruneToLive<V>(map: Map<string, V>, live: Iterable<{ id: string } | string | null | undefined>): number {
  const ids = new Set<string | undefined>();
  for (const x of live) ids.add(typeof x === 'string' ? x : x?.id);
  let n = 0;
  for (const k of map.keys()) if (!ids.has(k)) { map.delete(k); n++; }
  return n;
}

/** The allocation-free guard: prune only when the map holds more ids than there are live agents. */
export function pruneIfGrown<V>(map: Map<string, V>, list: readonly { id: string }[]): number {
  if (map.size <= list.length) return 0;
  return pruneToLive(map, list);
}
