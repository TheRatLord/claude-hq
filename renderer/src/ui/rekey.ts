// @pure
/**
 * Stable identity & rekeys (§8.10).
 * - `createRekey()`: every UI holder of a pane id (tabs, LRU, last terminal, roster selection, pins, unread, outbox…)
 *   keys through `resolve(id)` and subscribes to `onRekey(old, new)` to migrate in the same tick when the server sends
 *   `gone {reason:'rekeyed', newId}`.
 * - `createPins()`: pins 1–9 persisted per session **by stable identity** (never pane_id), re-bound on load/world with
 *   the §4.2 match order; a pin that matches nothing shows as a dimmed "missing" slot for 24 h, then frees.
 * Owner: UI.
 */
import { findByIdentity, identityMatch } from '../../../shared/identity.ts';
import { isRecord } from '../../../shared/guards.ts';
import type { Entity, Identity } from '../../../shared/protocol.ts';

/** Persistence seam (sessionStorage / localStorage in the browser, an in-memory object in tests). `load` returns whatever was saved. */
export interface StorageIo<T = unknown> { load(): unknown; save(v: T): void }

export interface Rekey {
  resolve(id: string): string;
  resolve(id: string | null | undefined): string | null | undefined;
  record(oldId: string, newId: string): void;
  onRekey(fn: (oldId: string, newId: string) => void): () => void;
}

export function createRekey(): Rekey {
  const map = new Map<string, string>();
  const fns = new Set<(oldId: string, newId: string) => void>();
  function resolve(id: string): string;
  function resolve(id: string | null | undefined): string | null | undefined;
  function resolve(id: string | null | undefined) {
    let n = 0;
    while (id != null && map.has(id) && n++ < 64) id = map.get(id);
    return id;
  }
  return {
    resolve,
    record(oldId: string, newId: string) {
      if (!oldId || !newId || oldId === newId) return;
      map.set(oldId, newId);
      if (map.size > 512) map.delete(map.keys().next().value!); // size > 512, so the iterator has a first key
      for (const fn of [...fns]) { try { fn(oldId, newId); } catch (e) { console.error('[rekey] holder threw', e); } }
    },
    onRekey(fn: (oldId: string, newId: string) => void) { fns.add(fn); return () => fns.delete(fn); },
  };
}

export type Pins = ReturnType<typeof createPins>;

export const PIN_SLOTS = 9;
export const MISSING_TTL_MS = 24 * 3600 * 1000;

export interface PinSlot { identity: Identity; name: string; id: string | null; missingSince: number | null }
type PinnableEntity = Pick<Entity, 'id' | 'identity' | 'name'>;

/**
 * Pins 1–9 by stable identity.
 */
export function createPins(io: StorageIo<({ identity: Identity; name: string; missingSince: number | null } | null)[]> & { now?: () => number }) {
  const now = io.now ?? (() => Date.now());
  let slots: (PinSlot | null)[] = Array(PIN_SLOTS).fill(null);
  try {
    const raw: unknown = io.load();
    if (Array.isArray(raw)) {
      const rows: unknown[] = raw;
      slots = Array.from({ length: PIN_SLOTS }, (_, i): PinSlot | null => {
        const r = rows[i];
        // saved rows are trusted only as far as `identity` being present, as before
        if (!isRecord(r) || !r.identity) return null;
        return { identity: r.identity as Identity, name: (r.name ?? '') as string, id: null, missingSince: (r.missingSince ?? null) as number | null };
      });
    }
  } catch { /* ignore corrupt storage */ }
  const persist = () => io.save(slots.map((s) => (s ? { identity: s.identity, name: s.name, missingSince: s.missingSince } : null)));

  const api = {
    get slots() { return slots; },
    /** Re-bind every slot against the current entities (world / entity / gone). */
    rebind(entities: Iterable<PinnableEntity>) {
      const list = [...entities];
      let changed = false;
      for (let i = 0; i < PIN_SLOTS; i++) {
        const s = slots[i];
        if (!s) continue;
        const e = (s.id && list.find((x) => x.id === s.id && identityMatch(s.identity, x))) || findByIdentity(s.identity, list);
        if (e) {
          if (s.id !== e.id || s.missingSince) changed = true;
          s.id = e.id;
          s.identity = e.identity;
          s.name = e.name;
          s.missingSince = null;
        } else {
          s.id = null;
          if (!s.missingSince) { s.missingSince = now(); changed = true; } else if (now() - s.missingSince > MISSING_TTL_MS) { slots[i] = null; changed = true; }
        }
      }
      if (changed) persist();
    },
    /** Pane id for slot n (1-based) or null. */
    idAt(n: number) { return slots[n - 1]?.id ?? null; },
    /** 1-based slot of a pane id, or 0. */
    slotOf(id: string) { return slots.findIndex((s) => s && s.id === id) + 1; },
    /** Put an entity into slot n (1-based), removing it from any other slot. */
    assign(n: number, e: PinnableEntity | null | undefined) {
      if (!e || n < 1 || n > PIN_SLOTS) return;
      for (let i = 0; i < PIN_SLOTS; i++) if (slots[i]?.id === e.id) slots[i] = null;
      slots[n - 1] = { identity: e.identity, name: e.name, id: e.id, missingSince: null };
      persist();
    },
    /** P on a row: unpin if pinned, else pin into the first free slot. Returns the slot (0 = unpinned / full). */
    toggle(e: PinnableEntity) {
      const at = api.slotOf(e.id);
      if (at) { slots[at - 1] = null; persist(); return 0; }
      const free = slots.findIndex((s) => !s);
      if (free < 0) return 0;
      api.assign(free + 1, e);
      return free + 1;
    },
    /** Rekey migration (ids only; identity already covers persistence). */
    rekey(oldId: string, newId: string) { for (const s of slots) if (s && s.id === oldId) s.id = newId; },
  };
  return api;
}

/**
 * localStorage-backed io for createPins / collapsed groups (per session). Never throws.
 */
export function localIo(key: string): StorageIo<unknown> {
  return {
    load(): unknown { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } },
    save(v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage blocked */ } },
  };
}
