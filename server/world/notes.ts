/**
 * HQ-local sticky notes, an Enricher (`notes`: owns `note`, emits nothing).
 * `note.set {id, text|null}` stores `{text, at}` per stable identity in `<session>/notes.json` (0600, debounced atomic
 * writes via persist.ts), so a note follows re-keys and survives backend restarts. `Entity.note` = `{text, at}|null`.
 * Never sent to herdr. Empty/whitespace text or null clears the note.
 */
import { Enricher } from '../interfaces.ts';
import type { BaseEntity, Clock, Logger } from '../interfaces.ts';
import type { Note } from '../../shared/protocol.ts';
import { identityKey } from '../../shared/identity.ts';
import { JsonFile } from './persist.ts';
import { ERR, LIMITS } from '../../shared/protocol.ts';

/** Notes whose identity has not been seen for this long are dropped on load (a closed pane's note is not forever). */
export const NOTE_TTL_MS = 30 * 24 * 3600_000;

/** Persisted per identity key (`seen` = last keep-alive for the TTL). */
interface NoteRecord { text: string; at: number; seen?: number }

export class NotesEnricher extends Enricher {
  clock: Clock;
  doc: JsonFile<NoteRecord>;
  map: Record<string, NoteRecord>;
  /** id → base */
  bases: Map<string, BaseEntity>;

  constructor({ dir, clock, log }: { dir: string | null; clock: Clock; log?: Partial<Logger> }) {
    super('notes');
    this.clock = clock;
    this.doc = new JsonFile<NoteRecord>({ dir, name: 'notes.json', clock, log });
    this.map = this.doc.data;
    const now = clock.now();
    for (const [k, v] of Object.entries(this.map)) {
      if (!v || typeof v.text !== 'string' || !(now - (v.seen ?? v.at ?? 0) < NOTE_TTL_MS)) {
        delete this.map[k];
        this.doc.touch();
      }
    }
    this.bases = new Map();
  }

  override attach(id: string, base: BaseEntity): void {
    this.update(id, base);
  }

  override update(id: string, base: BaseEntity): void {
    this.bases.set(id, base);
    const k = identityKey(base.identity);
    const r = k ? this.map[k] : null;
    if (r && this.clock.now() - (r.seen ?? 0) > 3600_000) {
      r.seen = this.clock.now(); // keep-alive for the TTL, at most one write an hour per note
      this.doc.touch();
    }
    this.onPatch(id, { note: r ? { text: r.text, at: r.at } : null });
  }

  override detach(id: string): void {
    this.bases.delete(id);
  }

  /** `note.set`. */
  set(id: string, text: string | null): { note: Note | null } {
    const base = this.bases.get(id);
    if (!base) throw Object.assign(new Error('unknown pane'), { code: ERR.UNKNOWN_ENTITY });
    const k = identityKey(base.identity);
    if (!k) throw Object.assign(new Error('pane has no stable identity'), { code: ERR.NOT_ACCEPTED });
    const t = typeof text === 'string' ? [...text.trim()].slice(0, LIMITS.noteMax).join('') : '';
    let note: Note | null = null;
    if (t) {
      const at = this.clock.now();
      this.map[k] = { text: t, at, seen: at };
      note = { text: t, at };
    } else delete this.map[k];
    this.doc.touch();
    this.onPatch(id, { note });
    return { note };
  }

  override async close(): Promise<void> {
    this.doc.flush();
  }
}
