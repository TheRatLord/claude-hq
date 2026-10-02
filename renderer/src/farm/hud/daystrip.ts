/**
 * Pure helpers for the day timeline's strips (the farmer card's day strip, the ledger's mini strips): which colour band
 * a job reads as, one CSS gradient per strip (no per-span DOM, so 40 ledger rows stay cheap), hour ticks and the copy
 * of the key-moment list. No DOM here (node tests import it); the DOM lives in timeline.ts.
 */
import type { Job } from '../model/types.ts';
import type { DaySummary, Moment, Span } from '../model/timeline.ts';
import { dur } from './format.ts';

/** Fewer colours than jobs on purpose: a calm strip reads at a glance. */
export type Band = 'edit' | 'read' | 'test' | 'run' | 'think' | 'ask' | 'done' | 'idle' | 'away';
export const BAND_OF: Record<Job, Band> = {
  plant: 'edit', inspect: 'read', fetch: 'read', water: 'test', build: 'run', haul: 'run', plan: 'think', talk: 'think',
  delegate: 'think', rest: 'think', ask: 'ask', done: 'done', idle: 'idle', away: 'away',
};
/** band colours (HUD palette: leaf, sky, wood, gold; muted so the gold "waiting on you" stands out); null = no paint */
export const BAND_COLOR: Record<Band, string | null> = {
  edit: '#6aa84f', read: '#86b7c4', test: '#4f8fc8', run: '#c39058', think: '#a796c4', ask: '#f0a72c', done: '#a9cbe8', idle: '#dccca8', away: null,
};
export const BAND_LABEL: Record<Band, string> = {
  edit: 'Editing', read: 'Reading', test: 'Tests', run: 'Commands & git', think: 'Thinking', ask: 'Waiting on you', done: 'Done',
  idle: 'Idle', away: 'Away',
};
/** legend order (away and done are rare: left out of the key) */
export const LEGEND: readonly Band[] = ['edit', 'read', 'test', 'run', 'think', 'ask', 'idle'];

/** One `linear-gradient` for a run of bucket jobs (null = no record → `empty`): adjacent equal colours merge. */
export function stripGradient(buckets: readonly (Job | null)[], empty = 'transparent'): string {
  const n = buckets.length;
  if (!n) return empty;
  const stops: string[] = [];
  let i = 0;
  while (i < n) {
    const c = (buckets[i] && BAND_COLOR[BAND_OF[buckets[i]!]]) || empty;
    let j = i + 1;
    while (j < n && ((buckets[j] && BAND_COLOR[BAND_OF[buckets[j]!]]) || empty) === c) j++;
    const a = +(i / n * 100).toFixed(2), b = +(j / n * 100).toFixed(2);
    stops.push(`${c} ${a}% ${b}%`);
    i = j;
  }
  return stops.length === 1 && stops[0].startsWith(`${empty} `) ? empty : `linear-gradient(90deg, ${stops.join(', ')})`;
}

/** 'HH:MM' local */
export function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Hour ticks across [from, to] (every hour; every 2 h past 8 h, 3 h past 14 h), as % positions. */
export function hourTicks(from: number, to: number): { at: number; pct: number; label: string }[] {
  if (to <= from) return [];
  const H = 3_600_000;
  const span = (to - from) / H;
  const step = span > 14 ? 3 : span > 8 ? 2 : 1;
  const d = new Date(from); d.setMinutes(0, 0, 0);
  let t = d.getTime();
  if (t < from) t += H;
  const out: { at: number; pct: number; label: string }[] = [];
  for (; t <= to; t += H) {
    const h = new Date(t).getHours();
    if (h % step) continue;
    out.push({ at: t, pct: ((t - from) / (to - from)) * 100, label: `${h}:00` });
  }
  return out;
}

/** The trailing part of a moment line: '→ 11:09 green', 'waited 4m', 'still waiting', '×3'. */
export function momentTail(m: Moment, now: number): string {
  if (m.kind === 'fixed' && m.until) return `→ ${hhmm(m.until)} green`;
  if (m.kind === 'ask') return m.wait == null ? `still waiting · ${dur(now - m.at)}` : `waited ${dur(m.wait)}`;
  if (m.kind === 'pass' && m.until && m.n) return `till ${hhmm(m.until)}`;
  return '';
}

/** Short tooltip / aria copy for a day: '3h 10m active · waited 12m on you · 2 ships · 5 test runs (1 red)'. */
export function summaryLine(s: DaySummary): string {
  if (s.first == null) return 'Nothing recorded today yet';
  const tests = s.passes + s.fails;
  return [
    `${dur(s.active)} active`,
    s.waited ? `waited ${dur(s.waited)} on you` : 'never waited on you',
    `${s.ships} ship${s.ships === 1 ? '' : 's'}`,
    `${tests} test run${tests === 1 ? '' : 's'}${s.fails ? ` (${s.fails} red)` : ''}`,
  ].join(' · ');
}

/** Hover copy for a span: '10:12–10:24 · Editing · 12m' + its subject on a second line. */
export function spanLine(sp: Span): string {
  const label = sp.tool === 'search' ? 'Searching' : sp.tool === 'web' || sp.tool === 'net' ? 'Fetching the web' : sp.tool === 'mcp' ? 'MCP tools'
    : sp.tool === 'todo' ? 'Planning todos' : sp.tool === 'git' || sp.job === 'haul' ? 'Git' : sp.job === 'delegate' ? 'Ducklings out'
      : sp.job === 'rest' ? 'Compacting' : sp.job === 'talk' ? 'Writing a reply' : BAND_LABEL[BAND_OF[sp.job]];
  return `${hhmm(sp.from)}–${hhmm(sp.to)} · ${label} · ${dur(sp.to - sp.from)}${sp.what ? `\n${sp.what}` : ''}`;
}
