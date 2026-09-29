// @pure
/**
 * Serve card / Blocked Inbox model (§6.8.1, §8.8), pure: queue order, option rows, confirm text, answer-reply mapping.
 * The DOM lives in inbox.ts (one component for the Blocked Inbox, the roster's inline card and the Serve counter).
 * Owner: UI.
 */

import type { Entity, Prompt, PromptOption } from '../../../shared/protocol.ts';
import { isRecord } from '../../../shared/guards.ts';
import { cmpNeedsYou } from './roster/model.ts';

/** Narrows a wire value (a reply's `prompt`) to a Prompt: the fields the cards read must be there. */
export const isPrompt = (v: unknown): v is Prompt => isRecord(v) && typeof v.hash === 'string' && typeof v.question === 'string' && Array.isArray(v.options);

/** Blocked agents, oldest first (the Inbox stack / queue order): the roster's shared "needs you" order. */
export function blockedQueue(entities: Iterable<Entity>): Entity[] {
  return [...entities].filter((e) => e.status === 'blocked').sort(cmpNeedsYou);
}

/** Done agents not yet signed off in HQ, oldest first (the Done tab). */
export function doneQueue(entities: Iterable<Entity>): Entity[] {
  return [...entities].filter((e) => e.status === 'done' && !e.ack && e.kind !== 'shell').sort((a, b) => (a.statusSince || 0) - (b.statusSince || 0) || String(a.id).localeCompare(String(b.id)));
}

/** Options that end the agent's Claude session ("No, exit" on the folder-trust prompt, "Quit", "End session"). */
const EXIT_RE = /\b(exit|quit|end (the )?session|log ?out|terminate)\b/i;
/** Options that refuse / abort what the agent asked: a leading "No" ("No, and tell Claude what to do differently",
 *  "No, keep planning"), "Reject", "Cancel", "Deny", "Decline", "Abort", or any "tell Claude …" redirect. A "Yes, delete
 *  it" approves the agent's own request, so object words (delete, discard) deliberately do not count. */
const REJECT_RE = /^\s*(no|nope)\b|\b(reject|cancel|deny|decline|abort|tell (claude|codex|me)\b)/i;

/**
 * Is this option label destructive? `'exit'` = ends the session, `'reject'` = refuses / aborts the request, else null.
 */
export function dangerOf(label: string | null | undefined): 'exit' | 'reject' | null {
  const s = String(label || '');
  if (EXIT_RE.test(s)) return 'exit';
  if (REJECT_RE.test(s)) return 'reject';
  return null;
}

/** Options that only open a text field: the agent then waits for typed text (AskUserQuestion's "Type something.",
 *  "No, and tell Claude what to do differently", "Chat about this"). The key alone does not answer. */
const FREE_RE = /^\s*(type something|chat about this)|\btell (claude|codex|gemini|the agent|me)\b/i;
export const isFreeText = (label: string | null | undefined): boolean => FREE_RE.test(String(label || ''));

export type CardRow =
  | { kind: 'opt'; key: string; label: string; n: number; danger: 'exit' | 'reject' | null; free: boolean }
  | { kind: 'open'; label: string; key?: undefined; n?: undefined; danger?: undefined; free?: undefined };

/** An option row (as opposed to the trailing **Open terminal** row). */
export type OptRow = Extract<CardRow, { kind: 'opt' }>;

/** The parts of an `agent.answer` reply the cards read (a `ReplyMsg` fits). */
export interface AnswerReply { ok: boolean; error?: string; prompt?: unknown }

/**
 * Rows of a card: parsed options (1–9), then **Open terminal ↗** last (§6.8.1). A free-text prompt (no options) has
 * only the terminal row. Destructive options carry `danger` (danger styling, spelled-out confirm).
 */
export function cardRows(prompt: { options?: readonly Pick<PromptOption, 'key' | 'label'>[] } | null | undefined): CardRow[] {
  const rows: CardRow[] = [];
  const opts = prompt?.options ?? [];
  opts.slice(0, 9).forEach((o, i) => rows.push({ kind: 'opt', key: o.key, label: o.label, n: i + 1, danger: dangerOf(o.label), free: isFreeText(o.label) }));
  rows.push({ kind: 'open', label: 'Open terminal' });
  return rows;
}

/**
 * The row a fresh card highlights: the option Claude Code itself highlights (❯) unless it is destructive, else the
 * first non-destructive option, else **Open terminal** (so Enter, Enter can never exit or reject by accident).
 */
export function initialRow(rows: readonly CardRow[], selected: number | null | undefined): number {
  const sel = selected != null && Number.isInteger(selected) && selected >= 0 && selected < rows.length ? selected : 0;
  const s = rows[sel];
  if (s && s.kind === 'opt' && !s.danger) return sel;
  const i = rows.findIndex((r) => r.kind === 'opt' && !r.danger);
  return i >= 0 ? i : rows.length - 1;
}

/** Row index for a digit (1–9): the option whose key is that digit, else the n-th option. -1 = none. */
export function rowForDigit(rows: readonly CardRow[], n: number): number {
  let i = rows.findIndex((r) => r.kind === 'opt' && r.key === String(n));
  if (i < 0) i = rows.findIndex((r) => r.kind === 'opt' && r.n === n);
  return i;
}

/**
 * The one-line confirm (§4.8 / §6.8.1): "Send ‘2. Yes, allow all edits this session’ to tinker?". Destructive options
 * say what happens: "Send ‘1. No, exit’ to tinker? This exits tinker's Claude session."
 */
/** Longest option label quoted verbatim in the confirm sentence; longer ones are clipped with an ellipsis. */
export const CONFIRM_LABEL_MAX = 40;
export const clipLabel = (s: string | null | undefined, max = CONFIRM_LABEL_MAX): string => {
  const t = String(s ?? '');
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp >= max - 14 ? cut.slice(0, sp) : cut).replace(/[\s,;:.–-]+$/, '')}…`; // prefer a word boundary
};

/**
 * Card breadcrumb "ws › tab", with the namesake qualifier (roster/model.ts nameQualifier) folded in rather than
 * prefixed: it is itself a prefix of the crumb ("hq-core" or "hq-core › claude") except for the "#n" twin suffix.
 * Consecutive repeated segments collapse too (a tab named like its workspace).
 */
export function crumbLabel(qual: string, ws: string, tab: string): string {
  const segs = [ws || '?', tab || '?'].filter((x, i, a) => i === 0 || x !== a[i - 1]);
  const base = segs.join(' › ');
  if (!qual || base === qual || base.startsWith(`${qual} › `)) return base;
  if (qual.startsWith(base)) return qual; // "ws › tab #2"
  return `${qual} · ${base}`;
}

export function confirmText(e: Partial<Pick<Entity, 'name' | 'kind'>> | null | undefined, row: { n?: number; label: string; danger?: 'exit' | 'reject' | null; free?: boolean }): string {
  const name = e?.name ?? 'agent';
  const base = `Send ‘${row.n}. ${clipLabel(row.label)}’ to ${name}?`;
  const who = e?.kind === 'codex' ? 'Codex' : 'Claude';
  if (row.danger === 'exit') return `${base} This exits ${name}'s ${who} session.`;
  if (row.free) return `${base} ${row.danger === 'reject' ? 'This refuses the request; then type' : 'Then type'} your reply in ${name}'s terminal.`;
  if (row.danger === 'reject') return `${base} This refuses the request; ${name} stops and waits for you.`;
  return base;
}

/** A TUI rule / box edge line ("────────", "╭───╮", "…") carries no words: drop it from displayed questions. */
export const isRule = (line: string): boolean => /^[\s\u2500-\u257F\u2580-\u259F─━═…·.\-_|]*$/.test(line);

/** First meaningful line of a question (toasts, announcements). */
export function firstQuestionLine(q: string | null | undefined): string {
  return String(q || '').split('\n').map((l) => l.trim()).find((l) => l && !isRule(l)) ?? '';
}

/**
 * Claude Code's Misc-Technical UI glyphs (⏺ tool bullet, ⎿ result elbow, ⏵ ⏸ …) that few fonts cover: the card is DOM
 * text, so on a box without such a font they were empty boxes (playtest d18-triage; the xterm drawer swaps them via
 * terminal/glyphs.ts). Always swapped here for look-alikes every UI font has (the first of glyphs.ts GLYPH_FALLBACKS).
 */
export const CARD_GLYPHS: Readonly<Record<string, string>> = Object.freeze({ '⏺': '●', '⎿': '└', '⏵': '▶', '⏴': '◀', '⏸': '‖', '⏹': '■', '⎯': '─', '⏎': '↵' });
const CARD_GLYPH_RE = new RegExp(`[${Object.keys(CARD_GLYPHS).join('')}]`, 'gu');
/** @pure */
export const cardGlyphs = (s: string): string => s.replace(CARD_GLYPH_RE, (c) => CARD_GLYPHS[c] ?? c);

/**
 * Question text for the card: the parsed question, else the raw detection text (free-text prompts), trimmed to
 * `maxLines` non-empty lines.
 */
export function questionText(prompt: Partial<Pick<Prompt, 'question' | 'raw'>> | null | undefined, maxLines = 6): string {
  const q = cardGlyphs(String(prompt?.question || '').trim() || String(prompt?.raw || '').trim());
  const lines = q.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim() && !isRule(l));
  if (lines.length <= maxLines) return lines.join('\n');
  return `${lines.slice(0, maxLines).join('\n')}\n…`;
}

/**
 * What the card does with an `agent.answer` reply (§4.8 / §6.8.1).
 */
export function answerOutcome(r: AnswerReply | null | undefined): 'sent' | 'changed' | 'notAccepted' | 'gone' | 'failed' {
  if (r?.ok) return 'sent';
  if (r?.error === 'prompt_changed') return r.prompt ? 'changed' : 'gone';
  if (r?.error === 'not_accepted') return 'notAccepted';
  return 'failed';
}
