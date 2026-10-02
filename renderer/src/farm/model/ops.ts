// @pure
/**
 * Operator helpers for running many agents at once (docs/valley/ops.md): the fuzzy matcher behind the command palette
 * (Ctrl/Cmd+K, hud/palette.ts) and the focus queue (Alt+N, the drawer's Next button): every agent that wants you, in
 * the order you should look at them. Pure; tested in ops.test.ts.
 */
import type { FarmerView } from './types.ts';

// ---------------------------------------------------------------------------------------------------------------------
// fuzzy matching

/**
 * How well `query` matches `text` (higher is better; -1 = no match). Every query character must appear in order
 * (case-insensitive). Bonuses: a contiguous substring (most), a match at a word start (after a space, `·`, `-`, `_`,
 * `/`, `.`, `:` or a lower→upper case change), runs of consecutive characters; a small penalty for gaps and for long
 * texts, so `pebb` ranks `claude-hq·pebble` over a sentence that happens to spell it out. Scattered letters only count
 * in short texts (≤ LOOSE_MAX) and within a tight span; longer texts need the word itself.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  if (!text) return -1;
  const t = text.toLowerCase();
  const sub = t.indexOf(q);
  if (sub >= 0) {
    // a substring: best at a word start, then earlier is better
    return 1000 + (isWordStart(text, sub) ? 300 : 0) + q.length * 10 - Math.min(sub, 200) - Math.min(t.length, 400) / 20;
  }
  // scattered letters only count in short texts (names, labels): in a sentence almost any word can be spelled out
  if (t.length > LOOSE_MAX) return -1;
  let score = 0, ti = 0, run = 0, first = -1;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    if (c === ' ') { run = 0; continue; }
    const at = t.indexOf(c, ti);
    if (at < 0) return -1;
    if (first < 0) first = at;
    const gap = at - ti;
    run = gap === 0 && qi > 0 ? run + 1 : 0;
    score += 10 + run * 8 + (isWordStart(text, at) ? 25 : 0) - Math.min(gap, 20);
    ti = at + 1;
  }
  // too spread out to be what was meant ("rate" across a whole label)
  if (ti - first > Math.max(q.length * 3, q.length + 8)) return -1;
  return score - Math.min(first, 100) / 4 - Math.min(t.length, 400) / 20;
}

/** texts longer than this match by substring only (what an agent said, a todo list), never by scattered letters */
export const LOOSE_MAX = 48;

function isWordStart(text: string, i: number): boolean {
  if (i <= 0) return true;
  const p = text[i - 1], c = text[i];
  if (' ·-_/.:,(['.includes(p)) return true;
  return p >= 'a' && p <= 'z' && c >= 'A' && c <= 'Z';
}

/**
 * Multi-word query against several fields: each word must match some field (fuzzily); the score is the sum of each
 * word's best field score, weighted by the field's weight (the name counts more than a line the agent once said).
 * Returns the score and the index of the field that best matched the whole query (the palette shows it as the
 * snippet), or null for no match.
 */
export function fieldsMatch(query: string, fields: readonly { text: string | null | undefined; weight?: number }[]): { score: number; field: number } | null {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { score: 0, field: 0 };
  let total = 0;
  for (const w of words) {
    let best = -1;
    for (const f of fields) {
      if (!f.text) continue;
      const s = fuzzyScore(w, f.text);
      if (s >= 0) best = Math.max(best, s * (f.weight ?? 1));
    }
    if (best < 0) return null;
    total += best;
  }
  // the field that matched the whole query best (for the snippet)
  let field = 0, fs = -Infinity;
  fields.forEach((f, i) => {
    if (!f.text) return;
    const s = words.reduce((a, w) => { const x = fuzzyScore(w, f.text!); return x < 0 ? a - 2000 : a + x; }, 0) * (f.weight ?? 1);
    if (s > fs) { fs = s; field = i; }
  });
  return { score: total, field };
}

/** a short window of `text` around the first occurrence of any query word (the palette's "what they said" snippet) */
export function snippet(text: string, query: string, max = 90): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const low = flat.toLowerCase();
  let at = -1;
  for (const w of query.toLowerCase().split(/\s+/).filter(Boolean)) { const i = low.indexOf(w); if (i >= 0 && (at < 0 || i < at)) at = i; }
  if (at < 0) return `${flat.slice(0, max - 1)}…`;
  const start = Math.max(0, Math.min(at - Math.floor(max / 3), flat.length - max));
  return `${start > 0 ? '…' : ''}${flat.slice(start, start + max)}${start + max < flat.length ? '…' : ''}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// the focus queue

export type FocusWhy = 'ask' | 'stuck' | 'done';
export interface FocusItem { id: string; why: FocusWhy; since: number }

/** copy for a queue entry ("needs you", …) */
export const FOCUS_LABEL: Readonly<Record<FocusWhy, string>> = Object.freeze({ ask: 'needs you', stuck: 'struggling', done: 'finished, unreviewed' });

type QueueFarmer = Pick<FarmerView, 'id' | 'needsYou' | 'unseenDone' | 'status' | 'struggle' | 'jobSince'>;

/**
 * Everyone who wants your attention, most urgent first: asks (they block the agent; the longest-waiting first, so
 * nobody starves behind a stream of new ones), then agents badly struggling (struggle ≥ 2 while working: looping on a
 * failing test, retrying a tool), then finished work nobody has reviewed (oldest first). Idle and happily working agents
 * are not in it: "the queue is empty" means you are caught up.
 */
export function focusQueue(farmers: Iterable<QueueFarmer>): FocusItem[] {
  const out: FocusItem[] = [];
  for (const f of farmers) {
    if (f.needsYou) out.push({ id: f.id, why: 'ask', since: f.jobSince });
    else if (f.status === 'working' && f.struggle >= 2) out.push({ id: f.id, why: 'stuck', since: f.jobSince });
    else if (f.unseenDone) out.push({ id: f.id, why: 'done', since: f.jobSince });
  }
  const rank: Record<FocusWhy, number> = { ask: 0, stuck: 1, done: 2 };
  return out.sort((a, b) => rank[a.why] - rank[b.why] || a.since - b.since || a.id.localeCompare(b.id));
}

/**
 * The next one to look at after `current` (the terminal you are in, or null): the head of the queue, skipping
 * `current` itself, so pressing Alt+N repeatedly walks the whole queue even while answers are in flight. Wraps.
 * `visited` (ids already stepped through this round, oldest first) is skipped too until everything was seen once.
 */
export function nextFocus(queue: readonly FocusItem[], current: string | null, visited: readonly string[] = []): FocusItem | null {
  const rest = queue.filter((q) => q.id !== current);
  if (!rest.length) return null;
  const fresh = rest.find((q) => !visited.includes(q.id));
  return fresh ?? rest[0];
}
