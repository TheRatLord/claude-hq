// @pure
/**
 * `reserve(tag, actorId, near?)` returns the actor's held slot of that tag, otherwise the nearest free
 * slot in horizontal distance (or the first free in input order). Ties retain input order.
 */
import type { Slot } from '../layout/schema.ts';

export interface Reservations {
  reserve: (tag: string, actorId: string, near?: { x: number; z: number }) => Slot | null;
  release: (slotId: string) => void;
  releaseAll: (actorId: string) => void;
  holder: (slotId: string) => string | null;
}

export function createReservations(slots: readonly Slot[]): Reservations {
  /** slotId → actorId */
  const held = new Map<string, string>();
  const d2 = (s: Slot, p: { x: number; z: number }) => (s.pos.x - p.x) ** 2 + (s.pos.z - p.z) ** 2;
  return {
    reserve(tag, actorId, near) {
      let best: Slot | null = null;
      for (const s of slots) {
        if (s.tag !== tag) continue;
        const h = held.get(s.id);
        if (h === actorId) return s;
        if (h) continue;
        if (!near) { if (!best) best = s; continue; }
        if (!best || d2(s, near) < d2(best, near)) best = s;
      }
      if (best) held.set(best.id, actorId);
      return best;
    },
    release: (slotId: string) => { held.delete(slotId); },
    releaseAll(actorId: string) { for (const [k, v] of held) if (v === actorId) held.delete(k); },
    holder: (slotId: string) => held.get(slotId) ?? null,
  };
}
