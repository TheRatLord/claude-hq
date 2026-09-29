// @pure
/**
 * Unread marks (§8.9): meaningful signals only.
 * - Added by `event news` (transcript text / tool result, shell output after the prompt) and by status transitions to
 *   `done` (blocked has its own channel and adds nothing).
 * - Cleared when the pane's tab is the active, visible, focused-or-hovered drawer tab for ≥ 1 s, or its row is opened.
 * - Stored per **stable identity** (§8.10) in sessionStorage so marks survive a reload and follow re-keyed ids.
 * - M3.5 granularity (BE2): one `news {src:'turn', msgs, edits}` per finished turn, `{src:'shell', lines}` per shell
 *   command. The marks keep that breakdown ("since you looked: 1 msg · 4 edits"); the badge counts real messages
 *   (a turn with text, a finished-status) and shows a dot for edits / shell output alone — never '9+' without messages.
 * Owner: UI.
 */
import { identityKey, findByIdentity } from '../../../shared/identity.ts';
import { isRecord } from '../../../shared/guards.ts';
import type { Entity, Identity } from '../../../shared/protocol.ts';
import type { StorageIo } from './rekey.ts';

/** What has arrived for one pane since it was last looked at. */
export interface UnreadBreakdown { msgs: number; edits: number; lines: number; done: number }
/** A persisted mark: `n` is the legacy badge count, `b` the M3.5 breakdown. */
export interface SavedMark { identity: Identity; n?: number; b?: UnreadBreakdown }

const int = (v: unknown): number => Number(v) | 0;

export const UNREAD_CAP = 99;
export const UNREAD_CLEAR_MS = 1000;

/** @pure What a news event adds (`detail` is the wire event detail, `unknown` until narrowed here). */
export function newsOf(detail: unknown): UnreadBreakdown {
  const d = isRecord(detail) ? detail : {};
  if (d.src === 'shell') return { msgs: 0, edits: 0, lines: Math.max(1, int(d.lines)), done: 0 };
  if (d.src === 'done') return { msgs: 0, edits: 0, lines: 0, done: 1 };
  if (d.src === 'turn') return { msgs: Math.max(0, int(d.msgs)), edits: Math.max(0, int(d.edits)), lines: 0, done: 0 };
  // legacy {src:'text'|'tool'} (pre-M3.5 servers): a text is a message, a tool result an edit-ish signal
  return d.src === 'tool' ? { msgs: 0, edits: 1, lines: 0, done: 0 } : { msgs: 1, edits: 0, lines: 0, done: 0 };
}
/** @pure The badge number for a breakdown: messages + finished, else 1 (a dot) when only edits / output arrived. */
export function badgeOf(b: UnreadBreakdown | null | undefined): number {
  if (!b) return 0;
  const n = (b.msgs | 0) + (b.done | 0);
  return n > 0 ? n : (b.edits | 0) + (b.lines | 0) > 0 ? 1 : 0;
}
/** @pure "since you looked: 1 msg · 4 edits · finished" (roster row). */
export function sinceLabel(b: UnreadBreakdown | null | undefined): string {
  if (!b) return '';
  const p: string[] = [];
  if (b.msgs) p.push(`${b.msgs} msg${b.msgs === 1 ? '' : 's'}`);
  if (b.edits) p.push(`${b.edits} edit${b.edits === 1 ? '' : 's'}`);
  if (b.lines) p.push(`${b.lines} line${b.lines === 1 ? '' : 's'} of output`);
  if (b.done) p.push('finished');
  return p.length ? `since you looked: ${p.join(' · ')}` : '';
}

/** '' / '1' dot / 'n' count / '9+' (§8.9). */
export function unreadLabel(n: number | null | undefined): string {
  if (!n) return '';
  if (n === 1) return '•';
  return n > 9 ? '9+' : String(n);
}

/** `io` persists the marks as [{identity, n, b}]. */
export function createUnread(io: StorageIo<SavedMark[]>) {
  /** pane id → breakdown */
  const counts = new Map<string, UnreadBreakdown>();
  const add = (a: UnreadBreakdown | undefined, b: UnreadBreakdown): UnreadBreakdown => ({ msgs: Math.min(UNREAD_CAP, (a?.msgs ?? 0) + (b.msgs | 0)), edits: Math.min(999, (a?.edits ?? 0) + (b.edits | 0)), lines: Math.min(9999, (a?.lines ?? 0) + (b.lines | 0)), done: Math.min(UNREAD_CAP, (a?.done ?? 0) + (b.done | 0)) });
  const fromSaved = (x: SavedMark): UnreadBreakdown => (x.b ? x.b : { msgs: (x.n ?? 0) | 0, edits: 0, lines: 0, done: 0 });
  /** pane id → identity (for persistence) */
  const idents = new Map<string, Identity>();
  /** saved-but-unbound marks from a previous page (identity → n) */
  let pending: SavedMark[] = [];
  try {
    const raw: unknown = io.load();
    if (Array.isArray(raw)) pending = raw.filter((x: unknown): x is SavedMark => isRecord(x) && !!x.identity && ((x.n as number) > 0 || !!x.b));
  } catch { /* corrupt storage */ }

  let dirty = false;
  const persist = () => {
    dirty = false;
    const out: SavedMark[] = [];
    for (const [id, b] of counts) { const identity = idents.get(id); if (badgeOf(b) > 0 && identity) out.push({ identity, n: badgeOf(b), b }); }
    for (const p of pending) out.push(p);
    io.save(out);
  };

  const api = {
    /** Badge count for a pane id (0 if none): messages + finished, or 1 for edits / output only. */
    of: (id: string) => badgeOf(counts.get(id)),
    /** The breakdown for a pane id (null if none). */
    detailOf: (id: string) => counts.get(id) ?? null,
    /** `detail` = news event detail ({src:'turn', msgs, edits} …); a number = that many messages (legacy). */
    bump(e: Pick<Entity, 'id'> & { identity?: Identity } | null | undefined, detail: unknown = 1) {
      if (!e?.id) return 0;
      const inc = typeof detail === 'number' ? { msgs: detail, edits: 0, lines: 0, done: 0 } : newsOf(detail);
      if (!badgeOf(inc)) return badgeOf(counts.get(e.id));
      counts.set(e.id, add(counts.get(e.id), inc));
      if (e.identity) idents.set(e.id, e.identity);
      persist();
      return badgeOf(counts.get(e.id));
    },
    clear(id: string) {
      if (!counts.has(id)) return false;
      counts.delete(id);
      persist();
      return true;
    },
    /** Re-attach saved marks to the current entities (on world / new entity), by the §4.2 identity order. */
    rebind(entities: Iterable<Pick<Entity, 'id'> & { identity?: Identity }>) {
      if (!pending.length) return;
      const list = [...entities];
      const left: SavedMark[] = [];
      for (const p of pending) {
        const e = findByIdentity(p.identity, list);
        if (e) { counts.set(e.id, add(counts.get(e.id), fromSaved(p))); idents.set(e.id, e.identity ?? p.identity); dirty = true; }
        else left.push(p);
      }
      pending = left;
      if (dirty) persist();
    },
    /** A pane went away for good: forget it (tombstones don't keep unread). */
    drop(id: string) { if (counts.delete(id)) persist(); idents.delete(id); },
    rekey(oldId: string, newId: string) {
      const moved = counts.get(oldId);
      if (moved) { counts.set(newId, add(counts.get(newId), moved)); counts.delete(oldId); }
      const ident = idents.get(oldId);
      if (ident) { idents.set(newId, ident); idents.delete(oldId); }
      persist();
    },
    /** Total unread (HUD / title). */
    total() { let t = 0; for (const b of counts.values()) t += badgeOf(b); return t; },
    get size() { return counts.size; },
    /** For tests: a stable persisted snapshot key per entity. */
    keyOf: (e: { identity?: Identity } | null | undefined) => (e?.identity ? identityKey(e.identity) : ''),
  };
  return api;
}

/** sessionStorage io (never throws). */
export function sessionIo(key: string): StorageIo<unknown> {
  return {
    load(): unknown { try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return null; } },
    save(v) { try { sessionStorage.setItem(key, JSON.stringify(v)); } catch { /* storage blocked */ } },
  };
}
