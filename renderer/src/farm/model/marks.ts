// @pure
/**
 * Pin and mute, per agent (docs/valley/ops.md). Both live in the browser-local prefs (`Prefs.pinned` / `Prefs.muted`,
 * pane ids, sanitised by model/prefs.ts `sanitizeIds`), so they persist per browser through farm/storage.ts.
 *
 * * **Pinned** agents come first: the ledger's *Pinned* group, the needs-you strip (so Alt+1 is a pinned ask when
 *   there is one), the palette's *Pinned* group and the overview grid.
 * * **Muted** agents make no noise: no toasts, no desktop notifications, no alert bell / done chime / far cheers, no
 *   captions or screen-reader announcements. Their asks still show in the needs-you strip and the mailbox, quietly (no
 *   new-ask ring, a muted bell on the card), so nothing is lost: you just are not interrupted.
 *
 * Pure; tested in marks.test.ts.
 */
import { MARKS_MAX } from './prefs.ts';
import type { ValleyEventKind } from './types.ts';

export interface Marks { pinned: readonly string[]; muted: readonly string[] }
export type MarkKind = keyof Marks;

/** `ids` with `id` toggled (added at the end, or removed); the newest MARKS_MAX kept */
export function toggleId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id].slice(-MARKS_MAX);
}
/** `ids` with `id` set on or off */
export function setId(ids: readonly string[], id: string, on: boolean): string[] {
  return on === ids.includes(id) ? [...ids] : toggleId(ids, id);
}

/** the valley events that make noise (alerts, chimes, cheers): a muted agent's carry `quiet` (main.ts) */
export const NOISY: ReadonlySet<ValleyEventKind> = new Set<ValleyEventKind>(['blocked', 'finished', 'unblocked', 'celebrate', 'oops']);
/** should this event be quiet (a muted agent's noisy event)? */
export function quietEvent(muted: readonly string[], e: { kind: ValleyEventKind; id: string }): boolean {
  return NOISY.has(e.kind) && muted.includes(e.id);
}

/**
 * A stable "pinned first" order: pinned items (in the order they were pinned) before the rest, which keep `cmp`'s
 * order. Returns a new array.
 */
export function pinnedFirst<T>(items: readonly T[], idOf: (t: T) => string, pinned: readonly string[], cmp?: (a: T, b: T) => number): T[] {
  const rank = (t: T) => { const i = pinned.indexOf(idOf(t)); return i < 0 ? Infinity : i; };
  return items.map((t, i) => ({ t, i, r: rank(t) }))
    .sort((a, b) => (a.r === b.r ? (cmp ? cmp(a.t, b.t) || a.i - b.i : a.i - b.i) : a.r < b.r ? -1 : 1))
    .map((x) => x.t);
}

/** copy for the toggles (buttons, palette rows, toasts) */
export function markLabel(kind: MarkKind, on: boolean): string {
  return kind === 'pinned' ? (on ? 'Unpin' : 'Pin to the top') : on ? 'Unmute' : 'Mute';
}
/** what a mute does, in one line (tooltips, the card) */
export const MUTE_HELP = 'Muted: no toasts, notifications or alert sounds. Asks still show, quietly, in the needs-you strip and the mailbox.';
export const PIN_HELP = 'Pinned: first in the ledger, the needs-you strip, the palette and the overview.';
