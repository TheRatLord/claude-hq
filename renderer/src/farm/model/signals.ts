// @pure
/**
 * Work signals the valley shows beside each farmer's job (docs/valley/signals.md): the model's display name, context
 * fill against the model's window, the repository a pane works in (branch, changed files, commits waiting to ship, the
 * last commit), today's token spend, and the todo checklist. Pure helpers over the wire Entity; valley.ts calls them
 * per tick, tests call them with plain objects.
 */
import type { Entity, GitInfo, Todo, Usage } from '../../../../shared/protocol.ts';
import { contextWindow } from '../../../../shared/classify.ts';
import { localDay } from '../../../../shared/pricing.ts';

/** A repository as the valley shows it (from Entity.git). `repo` = the work tree's directory name. */
export interface RepoView {
  repo: string;
  branch: string | null;
  head: string | null;
  /** changed files (tracked + untracked): weeds in the field */
  dirty: number;
  untracked: number;
  /** commits not yet pushed: crates waiting at the shipping bin (null: no upstream) */
  ahead: number | null;
  behind: number | null;
  lastCommit: { subject: string; at: number } | null;
}

/** The field's repo: the one most of its panes work in, plus how many panes share it and how many branches are out. */
export interface PlotRepoView extends RepoView { panes: number; branches: number }

/** Today's spend of one farmer (null when it spent nothing today, or the agent reports no usage). */
export interface SpendView { tokens: number; cost: number | null; partial: boolean }

/** The valley's spend today: every farmer seen today, including ones that have since gone home. */
export interface ValleySpend { day: string; tokens: number; cost: number | null; agents: number; partial: boolean }

/** One todo of the checklist. */
export interface TodoItem { text: string; state: 'done' | 'doing' | 'todo' }
export const TODO_ITEMS_MAX = 12;

const FAMILY: Record<string, string> = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable', mythos: 'Mythos' };

/** 'claude-opus-5-5' → 'Opus 5.5', 'claude-3-5-haiku-20241022' → 'Haiku 3.5', '…[1m]' → '… 1M', codex → 'Codex'. */
export function modelLabel(model: string | null | undefined): string | null {
  const m = String(model ?? '').trim();
  if (!m) return null;
  const big = /\[1m\]|[-_]1m\b/i.test(m) ? ' 1M' : '';
  const id = m.replace(/\[1m\]/i, '').replace(/-\d{8}$/, '');
  let x = /(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2}))?(?!\d)/i.exec(id);
  if (x) return `${FAMILY[x[1].toLowerCase()]} ${x[2]}${x[3] ? `.${x[3]}` : ''}${big}`;
  x = /claude-(\d)(?:-(\d))?-(opus|sonnet|haiku)/i.exec(id);
  if (x) return `${FAMILY[x[3].toLowerCase()]} ${x[1]}${x[2] ? `.${x[2]}` : ''}${big}`;
  if (/codex/i.test(id)) return 'Codex';
  if (/^gpt-/i.test(id)) return id.toUpperCase().replace(/^GPT-/, 'GPT-');
  return id.length > 20 ? `${id.slice(0, 19)}…` : id;
}

/** Context fill 0..1 against the model's window (200k, or 1M for `[1m]` models / contexts already past 200k). */
export function contextFill(e: Pick<Entity, 'model' | 'contextTokens'>): { fill: number; size: number } | null {
  if (!e.contextTokens) return null;
  const size = contextWindow(e.model, e.contextTokens);
  return { fill: Math.min(1, e.contextTokens / size), size };
}

const base = (p: string): string => p.replace(/\/+$/, '').split('/').pop() || p;

export function repoView(g: GitInfo | null | undefined): RepoView | null {
  if (!g || typeof g.root !== 'string') return null;
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  const nn = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : null);
  return {
    repo: base(g.root), branch: g.branch || null, head: g.head || null, dirty: n(g.dirty), untracked: n(g.untracked), ahead: nn(g.ahead),
    behind: nn(g.behind), lastCommit: g.lastCommit && typeof g.lastCommit.subject === 'string' ? { subject: g.lastCommit.subject, at: g.lastCommit.at } : null,
  };
}

/**
 * The repo a field shows: the root most of its panes share (agents count double: they are the ones shipping), ties to
 * the most recent commit. `branches` counts distinct branches in that repo across the field's panes (worktrees).
 */
export function plotRepo(entities: readonly Pick<Entity, 'kind' | 'git'>[]): PlotRepoView | null {
  const by = new Map<string, { w: number; panes: number; views: GitInfo[] }>();
  for (const e of entities) {
    const g = e.git;
    if (!g || typeof g.root !== 'string') continue;
    const r = by.get(g.root) ?? { w: 0, panes: 0, views: [] };
    r.w += e.kind === 'shell' ? 1 : 2;
    r.panes++;
    r.views.push(g);
    by.set(g.root, r);
  }
  let best: { w: number; panes: number; views: GitInfo[] } | null = null, bestAt = -1;
  for (const r of by.values()) {
    const at = Math.max(...r.views.map((v) => v.lastCommit?.at ?? 0));
    if (!best || r.w > best.w || (r.w === best.w && at > bestAt)) { best = r; bestAt = at; }
  }
  if (!best) return null;
  // the freshest view (latest commit) stands for the repo
  const g = [...best.views].sort((a, b) => (b.lastCommit?.at ?? 0) - (a.lastCommit?.at ?? 0))[0];
  const v = repoView(g);
  if (!v) return null;
  return { ...v, panes: best.panes, branches: new Set(best.views.map((x) => x.branch ?? x.head ?? '?')).size };
}

/** Today's spend from a usage block, or null when it belongs to another day / is empty. */
export function spendToday(u: Usage | null | undefined, now: number): SpendView | null {
  if (!u || u.day !== localDay(now) || !(u.tokens > 0)) return null;
  return { tokens: u.tokens, cost: typeof u.cost === 'number' ? u.cost : null, partial: !!u.partial };
}

/**
 * The valley's day ledger of spend: remembers each farmer's latest figure for the day (so a farmer who went home
 * still counts), rolls over at local midnight.
 */
export interface SpendLedger { day: string; by: Map<string, SpendView> }
export const emptySpendLedger = (): SpendLedger => ({ day: '', by: new Map() });

export function recordSpend(l: SpendLedger, id: string, s: SpendView | null, now: number): void {
  const day = localDay(now);
  if (l.day !== day) { l.day = day; l.by.clear(); }
  if (s) l.by.set(id, s);
}

export function valleySpend(l: SpendLedger, now: number): ValleySpend {
  const day = localDay(now);
  if (l.day !== day) return { day, tokens: 0, cost: null, agents: 0, partial: false };
  let tokens = 0, cost = 0, priced = false, partial = false;
  for (const s of l.by.values()) {
    tokens += s.tokens;
    if (s.cost != null) { cost += s.cost; priced = true; }
    partial ||= s.partial;
  }
  return { day, tokens, cost: priced ? Math.round(cost * 100) / 100 : null, agents: l.by.size, partial };
}

/** The checklist (≤ 12 items: the in-progress one and its neighbours first when the list is longer). */
export function todoItems(todos: readonly Todo[] | null | undefined): TodoItem[] {
  if (!todos?.length) return [];
  const items = todos.map((t): TodoItem => ({
    text: t.status === 'in_progress' ? t.activeForm || t.content : t.content,
    state: t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'doing' : 'todo',
  }));
  if (items.length <= TODO_ITEMS_MAX) return items;
  const cur = Math.max(0, items.findIndex((t) => t.state !== 'done'));
  const from = Math.max(0, Math.min(items.length - TODO_ITEMS_MAX, cur - 3));
  return items.slice(from, from + TODO_ITEMS_MAX);
}

/** '1.2M', '340k', '900' */
export function tokensLabel(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(Math.round(n));
}

/** '$1.24', '$0.31', '<$0.01', '$12' */
export function costLabel(c: number | null): string {
  if (c == null) return '';
  if (c > 0 && c < 0.01) return '<$0.01';
  return c >= 10 ? `$${Math.round(c)}` : `$${c.toFixed(2)}`;
}
