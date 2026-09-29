// @pure
/**
 * Status card v2 text model (M3.5 "walk up and manage"): what one card says about what an agent is doing or stuck on.
 *   todoLine    `3/7 ▶ Running the test suite` — the in-progress todo first (never only crossed-out lines)
 *   workLine    `+120 −34 · 5 files · 12m on task` (entity.work, BE2; `since` = the latest real user prompt)
 *   ctxInfo     context fill 0..1 + `62% ctx` label, `hot` past 85 % ("compaction soon")
 *   stuckLine   the struggle reason (`struggle.detail`, else a generic line per `reason`)
 *   readyNudge  idle / signed-off agents: "ready for work · T"
 * Shared by the status card, the roster row and triage (one wording on every surface). No DOM.
 * Owner: UI.
 */
import type { Entity, Struggle, Todo, WorkStats } from '../../../shared/protocol.ts';
import { elapsedLabel } from './roster/model.ts';

/** Context window used for the fill (tokens). 1M-context models report more; the bar then saturates at 100 %. */
export const CTX_WINDOW = 200_000;
export const CTX_HOT = 0.85;

export interface TodoLine { text: string; n: number; of: number; state: 'active' | 'next' | 'done' }

export function todoLine(todos: readonly Partial<Todo>[] | null | undefined): TodoLine | null {
  if (!Array.isArray(todos) || !todos.length) return null;
  const of = todos.length;
  const done = todos.filter((t) => t?.status === 'completed').length;
  const cur = todos.find((t) => t?.status === 'in_progress');
  if (cur) return { text: `${Math.min(of, done + 1)}/${of} ▶ ${clean(cur.activeForm || cur.content)}`, n: done + 1, of, state: 'active' };
  const next = todos.find((t) => t?.status !== 'completed');
  if (next) return { text: `${done}/${of} · next: ${clean(next.content || next.activeForm)}`, n: done, of, state: 'next' };
  return { text: `${of}/${of} ✓ all done`, n: of, of, state: 'done' };
}

/** `now` = ms epoch (server clock). */
export function workLine(work: Partial<WorkStats> | null | undefined, now: number): string | null {
  if (!work) return null;
  const parts: string[] = [];
  const a = (work.added ?? 0) | 0, r = (work.removed ?? 0) | 0, f = (work.files ?? 0) | 0;
  if (a || r) parts.push(`+${a} −${r}`);
  if (f) parts.push(`${f} file${f === 1 ? '' : 's'}`);
  if (work.since != null && Number.isFinite(work.since) && work.since > 0) parts.push(`${elapsedLabel(Math.max(0, now - work.since))} on task`);
  return parts.length ? parts.join(' · ') : null;
}

export function ctxInfo(tokens: number | null | undefined): { frac: number; pct: number; hot: boolean; label: string } | null {
  if (!tokens) return null;
  const frac = Math.min(1, tokens / CTX_WINDOW);
  const pct = Math.round(frac * 100);
  const hot = frac > CTX_HOT;
  return { frac, pct, hot, label: `${pct}% ctx${hot ? ' · compaction soon' : ''}` };
}

const REASON: Record<string, string> = { fails: 'tests keep failing', errors: 'tools keep erroring', noEdits: 'busy without edits for a while', context: 'context nearly full' };
export function stuckLine(s: Partial<Struggle> | null | undefined): string | null {
  if (!s || !((s.level ?? 0) > 0)) return null;
  return clean(s.detail) || (s.reason && REASON[s.reason]) || 'struggling';
}

/**
 * The "ready for work" nudge: an idle agent, or a done one you signed off, can take a new task (T).
 */
export function readyNudge(e: Partial<Pick<Entity, 'kind' | 'status' | 'ack'>> | null | undefined): boolean {
  if (!e || e.kind === 'shell') return false;
  return e.status === 'idle' || (e.status === 'done' && !!e.ack);
}

/** Two display lines of the last assistant text (whitespace collapsed; the CSS clamps). */
export function lastTextLine(t: unknown): string | null {
  const s = clean(t);
  return s || null;
}

function clean(s: unknown): string {
  return typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '';
}

/**
 * [UI fix r1, fun review "summoned X · on its way" while X stayed at its desk] The R summon toast, worded by what the
 * agent actually does (BRN brain.verb outcome, §6.9): only idle / done agents come over. Without an outcome (no live
 * actor yet) the status decides, same table. P6: the UI never promises what the world doesn't do.
 * `outcome` = come · refuse · cooldown · beep · none.
 */
export function summonText(name: string, outcome: string | undefined, e: Partial<Pick<Entity, 'status' | 'kind'>> | null | undefined): string {
  const st = e?.kind === 'shell' ? 'shell' : e?.status;
  const out = outcome ?? (st === 'shell' ? 'beep' : st === 'idle' || st === 'done' ? 'come' : 'refuse');
  if (out === 'come') return `summoned ${name} · on its way`;
  if (out === 'beep') return `${name}: beep! (shells stay at their bench)`;
  if (out === 'cooldown') return `${name} waves · just summoned, give it a moment`;
  if (st === 'working') return `${name} is busy · waves from the desk`;
  if (st === 'blocked') return `${name} points at its ticket · answer it first (B)`;
  return `${name} waves back · stays put`;
}
