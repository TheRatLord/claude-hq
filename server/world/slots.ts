/**
 * Stable per-workspace `slot` ordinal (bay allocation input), persisted per session in `slots.json`.
 * Keyed by workspace label + number so it survives herdr restarts (re-keyed ids). A slot is freed 5 min after its
 * workspace was last seen; new workspaces take the smallest free slot. Owner: BE.
 */
import { JsonFile } from './persist.ts';
import type { Clock, Logger, RawWorkspace } from '../interfaces.ts';

interface SlotRecord { slot: number; seen: number }
type SlotMap = Record<string, SlotRecord>;

export const SLOT_FREE_MS = 5 * 60_000;

export class Slots {
  clock: Clock;
  doc: JsonFile<SlotMap>;
  map: SlotMap;
  _written?: number;

  constructor({ dir, clock, log }: { dir: string | null; clock: Clock; log?: Partial<Logger> }) {
    this.clock = clock;
    this.doc = new JsonFile<SlotMap>({ dir, name: 'slots.json', clock, log });
    this.map = this.doc.data.slots ?? {};
    this.doc.data = { slots: this.map };
  }

  static key(w: Pick<RawWorkspace, 'label' | 'number'>): string {
    return `${w.label ?? ''}#${w.number ?? 0}`;
  }

  /**
   * Assign slots for the current workspace list (sorted by number for deterministic first assignment).
   * Returns workspace_id → slot.
   */
  assign(workspaces: Pick<RawWorkspace, 'workspace_id' | 'label' | 'number'>[]): Map<string, number> {
    const now = this.clock.now();
    const out = new Map<string, number>();
    const live = new Set<string>();
    for (const w of [...workspaces].sort((a, b) => (a.number ?? 0) - (b.number ?? 0))) live.add(Slots.key(w));
    // expire stale entries (not live, unseen for SLOT_FREE_MS)
    let dirty = false;
    for (const [k, v] of Object.entries(this.map)) {
      if (!live.has(k) && now - v.seen > SLOT_FREE_MS) {
        delete this.map[k];
        dirty = true;
      }
    }
    const taken = new Set(Object.values(this.map).map((v) => v.slot));
    for (const w of [...workspaces].sort((a, b) => (a.number ?? 0) - (b.number ?? 0))) {
      const k = Slots.key(w);
      let e = this.map[k];
      if (!e) {
        let s = 0;
        while (taken.has(s)) s++;
        taken.add(s);
        e = this.map[k] = { slot: s, seen: now };
        dirty = true;
      }
      e.seen = now;
      out.set(w.workspace_id, e.slot);
    }
    if (dirty || now - (this._written ?? 0) > 30_000) {
      this._written = now;
      this.doc.touch();
    }
    return out;
  }

  close(): void {
    this.doc.flush();
  }
}
