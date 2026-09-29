// @pure
/**
 * One display label per agent across the UI (reviewer m2-r2 [gameplay]): same-named agents get STAT's Big Board suffix
 * ("claude · 2", world/stats/format.ts boardNames) on the edge chevrons, the reticle / follow chip, the Blocked Inbox
 * cards and rows, so every surface names the same agent the same way. Cached; recomputed when the id → name set
 * changes (cheap O(n) signature, n ≈ tens).
 * Owner: UI.
 */
import { boardNames } from '../world/stats/format.ts';
import type { Entity } from '../../../shared/protocol.ts';
import { aliasVersion } from './aliases.ts';

/** What a label needs from an entity (a full Entity, a roster row, or a bare id + name). */
export type Nameable = Pick<Entity, 'id'> & { name?: string | null };

export function createNames(store: { entities: Map<string, Entity> }) {
  let sig = '', map = new Map<string, string>();
  const refresh = () => {
    let s = `${aliasVersion()}\u0003`; // Shift+N renames (aliases.ts) relabel every surface
    for (const e of store.entities.values()) s += `${e.id}\u0001${e.name ?? ''}\u0002`;
    if (s !== sig) { sig = s; map = boardNames(store.entities.values()); }
  };
  return {
    /** The display label of an entity (or of an id: the store entity, else the id itself). */
    label(e: Nameable | string | null | undefined): string {
      if (!e) return '';
      const n: Nameable = typeof e === 'string' ? store.entities.get(e) ?? { id: e, name: e } : e;
      refresh();
      return map.get(n.id) ?? String(n.name ?? n.id);
    },
  };
}
