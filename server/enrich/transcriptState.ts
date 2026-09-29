/**
 * Claude Code transcript derivations (DESIGN §4.4, research/herdr-api §6). Pure state machine over parsed JSONL lines:
 * no fs, no timers. `transcripts.ts` feeds it lines; tests feed it fixtures. Owner: BE2.
 *
 * Derives: current tool (last tool_use without a tool_result), think/talk from the last block, model, context tokens
 * (input + cache_read + cache_creation of the latest assistant message.id), output tokens (Σ over unique message.id),
 * title (ai-title), lastPrompt (last-prompt / latest real user string), todos (latest TodoWrite), and one-shot events
 * (error, test-pass, test-fail, commit, compact, news) + struggle (§4.4).
 *
 * M3.5 (BE2): `lastText` = the last main-chain assistant text block (whitespace-collapsed, ≤ 280 chars); `work` =
 * {since, added, removed, files} for the current task (since the latest real user prompt; line counts from the inputs
 * of Edit / MultiEdit / Write calls whose result came back without an error, files = distinct file_path). Both are
 * maintained incrementally per line. Struggle carries a human `detail` line and a 4th reason, 'context' (> 85% of the
 * model window).
 *
 * `news` (§8.9, "meaningful news", M3.5): ONE event per finished assistant turn (stop_reason end_turn on the main
 * chain; `system turn_duration` as a fallback), `{src:'turn', msgs, edits}` = assistant text blocks and successful edit
 * calls in that turn. Never per tool call: Claude's per-step chatter is not something the user has to read.
 */
import { toolClass, isGitCommit, editStats, contextWindow } from '../../shared/classify.ts';
import type { ToolInput } from '../../shared/classify.ts';
import { isRecord } from '../../shared/guards.ts';
import type { EventKind, ModelTier, Struggle, Todo, ToolClass, WorkStats } from '../../shared/protocol.ts';

const MAX_PROMPT = 500;
export const MAX_TEXT = 280;
const basename = (p: unknown): string => String(p ?? '').replace(/\/+$/, '').split('/').pop() as string; // split() is never empty
const clip = (s: unknown, n: number): string => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

/** A number field of a JSON line, 0 when absent or not a number. */
const numOf = (v: unknown): number => (typeof v === 'number' ? v : 0);
/** A JSON object field, `{}` when absent or not an object. */
const recOf = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {});

/** An event a line produced (the caller decides whether to emit it, e.g. not during backfill). */
export interface TranscriptEvent { kind: EventKind; detail?: unknown }
/** What the transcript says the agent is doing right now (the enricher gates it on herdr status). */
export interface TranscriptActivity { tool: string | null; cls: ToolClass; detail: string; at: number }
/** A `tool_use` without its `tool_result` yet. */
interface OpenTool { name: string | null; input: ToolInput; cls: ToolClass; detail: string; at: number }
/** Struggle with the human detail line always present (M3.5). */
export type StruggleOf = Struggle & { level: 1 | 2 | 3; detail: string };

/** Model id → tier. */
export function modelTier(m: string | null): ModelTier | null {
  if (!m) return null;
  if (/opus/i.test(m)) return 'opus';
  if (/sonnet/i.test(m)) return 'sonnet';
  if (/haiku/i.test(m)) return 'haiku';
  return 'other';
}

/**
 * Short human detail for a tool_use (§4.4): a file basename, a command ≤ 60 chars, a pattern, a query, a host/path,
 * or a subagent description.
 */
export function toolDetail(name: string | null | undefined, input: unknown): string {
  const i = recOf(input);
  if (i.file_path || i.notebook_path) return basename(i.file_path ?? i.notebook_path);
  if (typeof i.command === 'string') return clip(i.command, 60);
  if (name === 'WebFetch' && i.url) {
    try {
      const u = new URL(String(i.url));
      return clip(u.host + u.pathname, 60);
    } catch {
      return clip(i.url, 60);
    }
  }
  if (i.pattern) return clip(i.pattern, 60);
  if (i.query) return clip(i.query, 60);
  if (i.description) return clip(i.description, 60);
  if (i.prompt && (name === 'Agent' || name === 'Task')) return clip(i.prompt, 60);
  if (i.skill) return clip(i.skill, 60);
  if (name === 'TodoWrite' && Array.isArray(i.todos)) {
    const todos: unknown[] = i.todos;
    const cur = recOf(todos.find((t) => isRecord(t) && t.status === 'in_progress'));
    return clip(cur.activeForm ?? cur.content ?? `${todos.length} todos`, 60);
  }
  if (name === 'AskUserQuestion') return clip(recOf(Array.isArray(i.questions) ? i.questions[0] : undefined).question ?? i.question ?? '', 60);
  if (name?.startsWith('mcp__')) return name.split('__').slice(2).join('__').replace(/_/g, ' ');
  if (i.path) return basename(i.path);
  return '';
}

/** Text of a tool_result (content string or text blocks) plus structured stdout/stderr when present. */
function resultText(block: Record<string, unknown>, line: Record<string, unknown>): string {
  const parts: string[] = [];
  const c = block.content;
  if (typeof c === 'string') parts.push(c);
  else if (Array.isArray(c)) for (const b of c) if (isRecord(b) && b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
  const r = line.toolUseResult;
  if (isRecord(r)) {
    if (typeof r.stdout === 'string') parts.push(r.stdout);
    if (typeof r.stderr === 'string') parts.push(r.stderr);
  }
  return parts.join('\n').slice(-20_000);
}

const FAIL_COUNT = /(?:\b([1-9]\d*)\s+(?:failed|failing|failures?|errors?)\b)|(?:\b(?:fail|failed|failures|tests failed)[:=]?\s+([1-9]\d*)\b)/i;
const FAIL_WORD = /(^|\n)\s*(FAIL\b|FAILED\b|not ok \d)|✖|✗ \d|\bTest(s)? failed\b|\bAssertionError\b/;
const PASS_WORD = /\b(passed|passing|pass \d|all tests pass|ok \d|✔|✓)\b|# pass [1-9]|ℹ pass [1-9]|\btests? \d+ passed/i;

/**
 * Test verdict for a test-class Bash result: exit status (is_error) or output match (§4.3 table).
 */
export function testVerdict(isError: boolean, text: string): 'test-pass' | 'test-fail' {
  if (isError) return 'test-fail';
  if (FAIL_COUNT.test(text) || FAIL_WORD.test(text)) return 'test-fail';
  if (PASS_WORD.test(text)) return 'test-pass';
  return 'test-pass'; // a test command that exited 0 with no recognisable summary
}

const USER_REJECT = /doesn't want to proceed|was rejected|\[Request interrupted|user denied|tool use was rejected/i;

function realPromptText(msg: Record<string, unknown>): string | null {
  const c = msg.content;
  let s: string | null = null;
  if (typeof c === 'string') s = c;
  else if (Array.isArray(c)) {
    if (c.some((b) => isRecord(b) && b.type === 'tool_result')) return null;
    const t = c.filter(isRecord).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    s = t || null;
  }
  if (!s) return null;
  const trimmed = s.trim();
  if (!trimmed || /^<(command-|local-command|bash-|system-reminder|user-memory|task-notification)/.test(trimmed)) return null;
  if (/^Caveat: The messages below/.test(trimmed)) return null;
  return clip(trimmed, MAX_PROMPT);
}

/** Struggle thresholds (§4.4). */
type Level = 0 | 1 | 2 | 3;
const FAIL_LEVELS: readonly (readonly [number, Level])[] = [[6, 3], [4, 2], [2, 1]];
const NOEDIT_LEVELS: readonly (readonly [number, Level])[] = [[20 * 60_000, 2], [10 * 60_000, 1]];
/** Context struggle: share of the model window (> 85% → 1, > 95% → 2). */
const CONTEXT_LEVELS: readonly (readonly [number, Level])[] = [[0.95, 2], [0.85, 1]];
const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * Struggle (§4.4 + M3.5 detail/context) from plain numbers, shared with the demo so both read the same.
 * Priority on a level tie: fails/errors > noEdits > context.
 */
export interface StruggleInput {
  failStreak: number;
  streakFails: number;
  failSpanMs?: number;
  noEditMs?: number | null;
  contextTokens?: number | null;
  model?: string | null;
}
export function struggleOf({ failStreak, streakFails, failSpanMs = 0, noEditMs = null, contextTokens = null, model = null }: StruggleInput): StruggleOf | null {
  let fl: Level = 0;
  for (const [n, l] of FAIL_LEVELS) if (failStreak >= n) { fl = l; break; }
  let nl: Level = 0;
  if (noEditMs != null) for (const [ms, l] of NOEDIT_LEVELS) if (noEditMs >= ms) { nl = l; break; }
  let cl: Level = 0, pct = 0;
  if (contextTokens) {
    const frac = contextTokens / contextWindow(model, contextTokens);
    pct = Math.round(frac * 100);
    for (const [f, l] of CONTEXT_LEVELS) if (frac > f) { cl = l; break; }
  }
  const level: Level = [fl, nl, cl].reduce<Level>((a, b) => (b > a ? b : a), 0);
  if (!level) return null;
  if (fl === level) {
    if (streakFails * 2 >= failStreak) return { level, reason: 'fails', detail: `${plural(streakFails, 'test fail')} in a row` };
    const min = Math.max(1, Math.round(failSpanMs / 60_000));
    return { level, reason: 'errors', detail: `${plural(failStreak, 'error')} in ${min} min` };
  }
  if (nl === level) return { level, reason: 'noEdits', detail: `no edits for ${Math.floor((noEditMs ?? 0) / 60_000)}m while working` };
  return { level, reason: 'context', detail: `context ${pct}% — compaction soon` };
}

const TODO_STATUSES: readonly Todo['status'][] = ['pending', 'in_progress', 'completed'];
const isTodoStatus = (v: unknown): v is Todo['status'] => TODO_STATUSES.some((s) => s === v);

/** The transcript-owned Entity fields except activity/struggle. */
export interface TranscriptFacts {
  model: string | null;
  modelTier: ModelTier | null;
  contextTokens: number | null;
  outputTokens: number | null;
  title: string | null;
  lastPrompt: string | null;
  todos: Todo[] | null;
  lastText: string | null;
  work: WorkStats | null;
}

/**
 * Transcript state machine for one Claude session.
 */
export class TranscriptState {
  // all fields are (re)assigned by reset(), which the constructor calls
  /** open tool_uses by id */
  declare open: Map<string, OpenTool>;
  /** open tool ids in arrival order */
  declare order: string[];
  declare lastBlock: 'thinking' | 'text' | 'tool_use' | 'result' | null;
  declare turnOver: boolean;
  declare model: string | null;
  declare lastMsgId: string | null;
  declare contextTokens: number | null;
  /** message.id → output_tokens (last seen value; usage repeats per block) */
  declare outputs: Map<string, number>;
  declare outputTokens: number | null;
  declare title: string | null;
  declare lastPrompt: string | null;
  declare todos: Todo[] | null;
  declare lastTs: number | null;
  declare lastActivityAt: number | null;
  declare lastEditAt: number | null;
  declare failStreak: number;
  declare streakFails: number;
  declare firstFailAt: number | null;
  declare lastFailAt: number | null;
  declare lines: number;
  declare firstTs: number | null;
  declare lastText: string | null;
  declare work: WorkStats | null;
  /** distinct files edited in the current task */
  declare workFiles: Set<string>;
  declare turnMsgs: number;
  declare turnEdits: number;
  declare newsSent: boolean;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.open = new Map();
    this.order = []; // open tool ids in arrival order
    this.lastBlock = null;
    this.turnOver = false;
    this.model = null;
    this.lastMsgId = null;
    this.contextTokens = null;
    this.outputs = new Map();
    this.outputTokens = null;
    this.title = null;
    this.lastPrompt = null;
    this.todos = null;
    this.lastTs = null;
    this.lastActivityAt = null;
    this.lastEditAt = null;
    this.failStreak = 0;
    this.streakFails = 0;
    this.firstFailAt = null;
    this.lastFailAt = null;
    this.lines = 0;
    this.firstTs = null;
    this.lastText = null;
    this.work = null;
    this.workFiles = new Set();
    /** per-turn counters for the turn-end `news` payload; `newsSent` = this turn already announced */
    this.turnMsgs = 0;
    this.turnEdits = 0;
    this.newsSent = false;
  }

  /** Start a new task (a real user prompt): fresh work counters. */
  _newTask(at: number): WorkStats {
    const work = (this.work = { since: at, added: 0, removed: 0, files: 0 });
    this.workFiles = new Set();
    this.turnMsgs = 0;
    this.turnEdits = 0;
    this.newsSent = false;
    return work;
  }

  /** Turn end (§8.9 meaningful news): one `news` per turn with its text/edit counts. */
  _turnEnd(ev: TranscriptEvent[]): void {
    if (this.newsSent) return;
    // nothing to read yet (an interrupted turn, or a thinking line that carries end_turn before its text line): wait
    if (!this.turnMsgs && !this.turnEdits) return;
    this.newsSent = true;
    ev.push({ kind: 'news', detail: { src: 'turn', msgs: this.turnMsgs, edits: this.turnEdits } });
    this.turnMsgs = 0;
    this.turnEdits = 0;
  }

  /**
   * Feed one parsed JSONL object. `now` = ms (observation time; used when a line has no timestamp). Returns the events
   * (the caller decides whether to emit, e.g. not during backfill).
   */
  feed(o: unknown, now: number): TranscriptEvent[] {
    const ev: TranscriptEvent[] = [];
    if (!isRecord(o)) return ev;
    this.lines++;
    const ts = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN;
    const at = Number.isFinite(ts) ? ts : now;
    if (this.firstTs == null && Number.isFinite(ts)) this.firstTs = ts;
    switch (o.type) {
      case 'ai-title':
        if (typeof o.aiTitle === 'string' && o.aiTitle.trim()) this.title = clip(o.aiTitle, 120);
        break;
      case 'last-prompt':
        if (typeof o.lastPrompt === 'string' && o.lastPrompt.trim()) this.lastPrompt = clip(o.lastPrompt, MAX_PROMPT);
        break;
      case 'system':
        this.lastTs = at;
        if (o.subtype === 'turn_duration' && !o.isSidechain) this._turnEnd(ev);
        if (o.subtype === 'compact_boundary') {
          ev.push({ kind: 'compact', detail: { preTokens: recOf(o.compactMetadata).preTokens ?? null, trigger: recOf(o.compactMetadata).trigger ?? null } });
          this.open.clear();
          this.order = [];
          this.contextTokens = null;
        }
        break;
      case 'assistant':
        this.lastTs = at;
        this._assistant(o, at, ev);
        break;
      case 'user':
        this.lastTs = at;
        this._user(o, at, ev);
        break;
      default:
        break;
    }
    return ev;
  }

  _assistant(o: Record<string, unknown>, at: number, ev: TranscriptEvent[]): void {
    const m = recOf(o.message);
    if (typeof m.model === 'string' && m.model !== '<synthetic>') this.model = m.model;
    const u = m.usage;
    if (isRecord(u) && typeof m.id === 'string' && m.id) {
      this.lastMsgId = m.id;
      this.contextTokens = numOf(u.input_tokens) + numOf(u.cache_read_input_tokens) + numOf(u.cache_creation_input_tokens);
      this.outputs.set(m.id, numOf(u.output_tokens));
      let sum = 0;
      for (const v of this.outputs.values()) sum += v;
      this.outputTokens = sum;
      const oldest = this.outputs.keys().next();
      if (this.outputs.size > 5000 && !oldest.done) this.outputs.delete(oldest.value);
    }
    this.turnOver = m.stop_reason === 'end_turn';
    const main = !o.isSidechain;
    for (const b of Array.isArray(m.content) ? m.content : []) {
      if (!isRecord(b)) continue;
      if (b.type === 'thinking' || b.type === 'redacted_thinking') this.lastBlock = 'thinking';
      else if (b.type === 'text') {
        this.lastBlock = 'text';
        if (main && typeof b.text === 'string' && b.text.trim() && m.model !== '<synthetic>') {
          this.lastText = clip(b.text, MAX_TEXT);
          this.turnMsgs++;
        }
      }
      else if (b.type === 'tool_use' && typeof b.id === 'string' && b.id) {
        this.lastBlock = 'tool_use';
        if (main) this.newsSent = false; // the turn goes on after a tool call
        const name = typeof b.name === 'string' ? b.name : null;
        const input: ToolInput = recOf(b.input);
        const cls = toolClass(name, input);
        this.open.set(b.id, { name, input, cls, detail: toolDetail(name, input), at });
        this.order.push(b.id);
        this.lastActivityAt = at;
        if (name === 'TodoWrite' && Array.isArray(input.todos)) {
          this.todos = input.todos.slice(0, 50).map((raw: unknown): Todo => {
            const t = recOf(raw);
            return {
              content: clip(t.content, 200), status: isTodoStatus(t.status) ? t.status : 'pending',
              activeForm: clip(t.activeForm ?? t.content, 200),
            };
          });
        }
      }
    }
    // the final text line ends the turn (a thinking line of the same message can carry end_turn before its text lands)
    if (main && (m.stop_reason === 'end_turn' || m.stop_reason === 'stop_sequence') && this.lastBlock === 'text') this._turnEnd(ev);
  }

  _user(o: Record<string, unknown>, at: number, ev: TranscriptEvent[]): void {
    const m = recOf(o.message);
    const prompt = !o.isMeta && !o.isCompactSummary && !o.isSidechain ? realPromptText(m) : null;
    if (prompt) {
      this.lastPrompt = prompt;
      this._newTask(at);
      this.open.clear();
      this.order = [];
      this.lastBlock = 'result'; // a fresh prompt: Claude is thinking until its first block lands
      this.turnOver = false;
      return;
    }
    if (!Array.isArray(m.content)) return;
    for (const b of m.content) {
      if (!isRecord(b) || b.type !== 'tool_result' || typeof b.tool_use_id !== 'string' || !b.tool_use_id) continue;
      const toolUseId = b.tool_use_id;
      const t = this.open.get(toolUseId);
      if (!t) continue;
      this.open.delete(toolUseId);
      this.order = this.order.filter((x) => x !== toolUseId);
      this.lastBlock = 'result';
      const isError = b.is_error === true;
      const text = resultText(b, o);
      const rejected = isError && USER_REJECT.test(text);
      if (rejected) continue;
      if (t.cls === 'test') {
        const v = testVerdict(isError, text);
        ev.push({ kind: v, detail: { cmd: clip(t.input.command, 60) } });
        if (v === 'test-pass') this._clearFails();
        else this._fail('fails');
      } else if (isError) {
        ev.push({ kind: 'error', detail: { tool: t.name } });
        this._fail('errors');
      } else if (t.cls === 'git' && typeof t.input.command === 'string' && isGitCommit(t.input.command)) {
        ev.push({ kind: 'commit', detail: { push: /\bpush\b/.test(t.input.command) && !/\bcommit\b/.test(t.input.command) } });
      }
      if (!isError && (t.cls === 'edit' || t.cls === 'write')) {
        this.lastEditAt = at;
        this._clearFails();
        if (!o.isSidechain) this._countWork(t, at);
      }
    }
  }

  /** Add one successful Edit/MultiEdit/Write to the current task (a task with no prompt in view starts at the first line). */
  _countWork(t: OpenTool, at: number): void {
    const s = editStats(t.name ?? '', t.input);
    if (!s) return;
    const work = this.work ?? this._newTask(this.firstTs ?? at);
    work.added += s.added;
    work.removed += s.removed;
    if (s.file && !this.workFiles.has(s.file) && this.workFiles.size < 10_000) this.workFiles.add(s.file);
    this.work = { ...work, files: this.workFiles.size }; // new object: facts() consumers compare by value anyway
    this.turnEdits++;
  }

  _fail(kind: 'fails' | 'errors'): void {
    this.failStreak++;
    if (kind === 'fails') this.streakFails++;
    this.firstFailAt ??= this.lastTs;
    this.lastFailAt = this.lastTs;
  }
  _clearFails(): void {
    this.failStreak = 0;
    this.streakFails = 0;
    this.firstFailAt = this.lastFailAt = null;
  }

  /** The pending AskUserQuestion, if any. */
  pendingAsk(): OpenTool | null {
    for (let i = this.order.length - 1; i >= 0; i--) {
      const t = this.open.get(this.order[i]);
      if (t?.cls === 'ask') return t;
    }
    return null;
  }

  /**
   * Activity as the transcript sees it (the enricher gates it on herdr status).
   */
  activity(): TranscriptActivity | null {
    const id = this.order[this.order.length - 1];
    const t = id ? this.open.get(id) : null;
    if (t) return { tool: t.name, cls: t.cls, detail: t.detail, at: t.at };
    if (this.turnOver) return null;
    if (this.lastBlock === 'thinking' || this.lastBlock === 'result') return { tool: null, cls: 'think', detail: '', at: this.lastTs ?? 0 };
    if (this.lastBlock === 'text') return { tool: null, cls: 'talk', detail: '', at: this.lastTs ?? 0 };
    return null;
  }

  /**
   * Struggle (§4.4) given the working streak start (ms) and now; null when level 0.
   */
  struggle(workingSince: number | null, now: number): StruggleOf | null {
    return struggleOf({
      failStreak: this.failStreak, streakFails: this.streakFails,
      failSpanMs: this.firstFailAt != null ? (this.lastFailAt ?? this.firstFailAt) - this.firstFailAt : 0,
      noEditMs: workingSince != null ? now - Math.max(workingSince, this.lastEditAt ?? -Infinity) : null,
      contextTokens: this.contextTokens, model: this.model,
    });
  }

  /** Transcript-owned Entity fields except activity/struggle (status-gated by the enricher). */
  facts(): TranscriptFacts {
    return {
      model: this.model, modelTier: modelTier(this.model), contextTokens: this.contextTokens, outputTokens: this.outputTokens,
      title: this.title, lastPrompt: this.lastPrompt, todos: this.todos, lastText: this.lastText, work: this.work,
    };
  }
}
