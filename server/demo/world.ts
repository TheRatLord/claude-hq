/**
 * DemoWorld: a seeded, scheduled fake herdr. Implements `HerdrSource` with herdr-shaped raw
 * snapshots + status events and a herdr `request()` subset, so WorldModel, naming, event derivation, the blocked
 * parser (`pane.read detection` returns real Claude Code prompt text) and the procinfo enricher (`pane.process_info`)
 * all run unchanged. Transcript-only facts go through `DemoEnricher` (owner `demo`), which re-emits the schedule's
 * events via `emitEvent` like the live transcripts enricher.
 *
 * Working turns are phase-structured like real Claude sessions (explore → plan → edit → verify → git, with occasional
 * web/task phases; 70% of tools in a phase are the phase's class). Every timer runs on `clock`: `--timescale`
 * compresses a scenario and tests drive it with a FakeClock.
 *
 * Wire-up: `const {source, demo, enrichers} = createDemo({clock, n, seed, scenario})`; add blocked/acks; construct
 * the WorldModel; optionally `source.seedSince(model.since)` (longIdle's dust ladder); then `source.start()`.
 */
import { HerdrSource, Enricher } from '../interfaces.ts';
import type { BaseEntity, Clock, Logger, RawAgent, RawLayout, RawPane, RawTab, RawWorkspace, TimerHandle } from '../interfaces.ts';
import { FIELD_OWNERS, KINDS, SCENARIOS, STATUSES, TOOL_CLASSES, VALIDATE, mayEmit } from '../../shared/protocol.ts';
import type { Activity, DemoConfig, DiffFile, DiffResult, Entity, EventKind, GitInfo, Identity, Kind, ShellActivity, Status, Struggle, Subagent, Todo, ToolClass, Usage, WorkStats } from '../../shared/protocol.ts';
import { costOf, localDay, tokensOf } from '../../shared/pricing.ts';
import type { TokenUse } from '../../shared/pricing.ts';
import { hashHex, identityKey, placeOf } from '../../shared/identity.ts';
import { ProcInfoEnricher } from '../enrich/procinfo.ts';
import { modelTier, struggleOf } from '../enrich/transcriptState.ts';
import { processActivity } from '../../shared/classify.ts';
import { isRecord } from '../../shared/guards.ts';
import type { SinceRecord } from '../world/since.ts';
import type { OutLine, ReadOpts, ReadResult } from './fakeTerm.ts';
import {
  WORKSPACES, RENAMES, NAMES, TASKS, MODELS, SHELL_PROCS, BRANCHES, COMMITS, buildScenario, rng, activityFor, pickSubagent,
  randomPrompt, permissionFor, PROMPTS, shellTick, shellEnd, SHELL_TICK_S, demoText,
} from './scenarios.ts';
import type { DemoActivity, DemoTextStage, NewPaneSpec, PromptSpec, Rng, Scenario, ShellLine } from './scenarios.ts';

const S = 1000;
const MIN = 60 * S;
const ROLLUP: Status[] = ['blocked', 'working', 'done', 'idle', 'unknown'];
const rollup = (statuses: (Status | undefined)[]): Status => ROLLUP.find((s) => statuses.includes(s)) ?? 'unknown';
const clone = <T>(o: T): T => structuredClone(o);
const isKind = (v: unknown): v is Kind => KINDS.some((k) => k === v);
const isToolClass = (v: unknown): v is ToolClass => TOOL_CLASSES.some((k) => k === v);
const isStatus = (v: unknown): v is Status => STATUSES.some((k) => k === v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const uuidOf = (s: string): string => {
  const h = (hashHex(s) + hashHex(s + '1') + hashHex(s + '2') + hashHex(s + '3')).padEnd(32, '0');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const home = (cwd: string): string => cwd.replace(/^\/home\/demo/, '~');
/** Claude's ai-title for a typed prompt: its first few words, capitalised (≤ 40 chars). */
const titleOf = (text: unknown): string | null => {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ').slice(0, 40);
  return t ? t[0].toUpperCase() + t.slice(1) : null;
};

// ---- the demo's own view of a herdr snapshot (RawSnapshot + the fields the fake herdr keeps)

interface DemoWorkspace extends RawWorkspace {
  workspace_id: string;
  number: number;
  label: string;
  focused: boolean;
  pane_count: number;
  tab_count: number;
  active_tab_id: string | null;
  agent_status: Status;
  worktree?: { repo_name: string; repo_root: string; checkout_path: string; is_linked_worktree: boolean; repo_key: string };
  /** workspace default cwd */
  _cwd: string;
  _paneSeq: number;
  _tabSeq: number;
}
interface DemoTab extends RawTab {
  number: number;
  label: string;
  focused: boolean;
  pane_count: number;
  agent_status: Status;
  /** the requested tab name ('#' = numeric) */
  _name: string;
}
interface DemoPane extends RawPane {
  terminal_id: string;
  focused: boolean;
  cwd: string;
  foreground_cwd: string;
  terminal_title: string;
  terminal_title_stripped: string;
  agent_status: Status;
  scroll: { offset_from_bottom: number; max_offset_from_bottom: number; viewport_rows: number };
  revision: number;
}
interface DemoAgent extends RawAgent {
  terminal_id: string;
  workspace_id: string;
  tab_id: string;
  agent: string;
  agent_status: Status;
  cwd: string;
  foreground_cwd: string;
  interactive_ready?: boolean;
  state_change_seq: number;
  name?: string;
}
interface DemoLayout extends RawLayout {
  panes: { pane_id: string; focused: boolean; rect: { x: number; y: number; width: number; height: number } }[];
  focused_pane_id: string | null;
  splits: { id: string; direction: string; ratio: number; rect: { x: number; y: number; width: number; height: number } }[];
}
interface DemoRaw {
  version: string;
  protocol: number;
  workspaces: DemoWorkspace[];
  tabs: DemoTab[];
  panes: DemoPane[];
  agents: DemoAgent[];
  layouts: DemoLayout[];
  focused_workspace_id: string | null;
  focused_tab_id: string | null;
  focused_pane_id: string | null;
}

/** A blocked prompt as the demo holds it: the shape plus the menu cursor and free text typed so far. */
export type DemoPrompt = PromptSpec & { selected: number; typed: string };

/** The activity a pane shows; `cls` can be null after a `demo.force` without one. */
type FactActivity = Omit<DemoActivity, 'cls'> & { cls: ToolClass | null };

/** Transcript-ish facts of one pane (DemoEnricher reads them; fakeTerm renders `out`). */
export interface Facts {
  kind: Kind;
  title: string | null;
  activity: FactActivity | null;
  activitySince: number;
  model: string | null;
  modelTier: Entity['modelTier'];
  contextTokens: number | null;
  outputTokens: number | null;
  todos: Todo[] | null;
  lastPrompt: string | null;
  struggle: Struggle | null;
  subagents: Subagent[];
  prompt: DemoPrompt | null;
  askActivity: boolean;
  lastText: string | null;
  work: WorkStats | null;
  /** today's spend (rev 2): seeded with a believable morning, grown per tool step from the context it re-reads */
  usage: Usage | null;
  /** the shell's (or agent's) foreground argv */
  proc: string[];
  /** shells: printed lines (DemoWorld is the shell; fakeTerm renders them) */
  out: OutLine[];
  outSeq: number;
}

/** A tool step the sim paused for a permission prompt. */
interface PendingStep { cls: ToolClass; a: DemoActivity; dur: number }
type PhaseName = 'explore' | 'plan' | 'edit' | 'verify' | 'web' | 'task' | 'git';
interface Phase { name: PhaseName; dur: number }
interface Turn { phases: Phase[]; i: number; left: number; subs: unknown[] }

/** Per-pane schedule state. */
interface Sim {
  id: string;
  kind: Kind;
  spec: NewPaneSpec;
  R: Rng;
  /** a separate stream for lastText/work, so they never shift the schedule's own random sequence */
  T: Rng;
  timers: Set<TimerHandle>;
  turn: Turn | null;
  frozen: boolean;
  focusedAt: number | null;
  fails?: number;
  files?: Set<string>;
  turnMsgs?: number;
  turnEdits?: number;
  pending?: PendingStep | null;
  lastAnswerAt?: number;
  answered?: boolean;
  lastFile?: string;
  subSeq?: number;
  tickTimer?: TimerHandle | null;
  ticks: number;
}

/** Phase table: [class weights, duration range s]. */
const PHASES: Record<PhaseName, { cls: [ToolClass, number][]; dur: [number, number] }> = {
  explore: { cls: [['read', 3], ['search', 2]], dur: [20, 90] },
  plan: { cls: [['think', 3], ['todo', 1]], dur: [10, 30] },
  edit: { cls: [['edit', 4], ['write', 1]], dur: [20, 120] },
  verify: { cls: [['test', 3], ['build', 1]], dur: [20, 90] },
  web: { cls: [['web', 1]], dur: [20, 60] },
  task: { cls: [['task', 1]], dur: [60, 240] },
  git: { cls: [['git', 1]], dur: [5, 15] },
};
/** Interjections are dealt from a shuffled deck (weights = copies) so rare classes show up within minutes, not hours. */
const INTERJECT: [ToolClass, number][] = [['think', 4], ['read', 3], ['bash', 3], ['talk', 2], ['search', 2]];
const RARE: [ToolClass, number][] = (['net', 'git', 'mcp', 'other', 'web', 'todo', 'build', 'write'] as const).map((c) => [c, 1]);
const COVER: ToolClass[] = ['net', 'git', 'mcp', 'other', 'web', 'todo', 'build', 'write', 'task', 'search', 'bash', 'talk'];
/** Optional phases per turn, dealt the same way. */
const EXTRA_PHASES: PhaseName[][] = [['web'], ['task'], [], ['web', 'task'], [], ['task']];
const SPREAD: Status[] = ['working', 'blocked', 'done', 'working', 'idle', 'unknown', 'working', 'working', 'done', 'working', 'idle', 'working'];
const MODEL_OF = (R: Rng, kind: Kind): string => (kind === 'codex' ? 'gpt-5-codex' : R.weighted(MODELS));
/** Lively scenarios: mid-turn permission prompts, trust prompts for newcomers ("realistic prompts"). */
const LIVELY = new Set(['mixed', 'crowd40', 'trio', 'churn']);
/** Per risky tool step (bash/edit/fetch/mcp): chance Claude Code stops to ask permission first. */
const MIDTURN_ASK = 0.03;
/** No second permission prompt for this long after an answer (people approve "don't ask again"). */
const ASK_COOLDOWN_MS = 90 * S;
/** How long a shell keeps each foreground command, [lo, hi] seconds. */
const SHELL_RUN_S: Record<Exclude<ShellActivity, 'prompt'>, [number, number]> = { serve: [60, 300], monitor: [45, 240], remote: [30, 180], edit: [30, 120], repl: [20, 60],
  test: [8, 40], build: [10, 60], git: [5, 25], run: [10, 60] };
/** Shell output ring per pane (pane.read recent_unwrapped + fakeTerm render). */
const OUT_MAX = 400;

const emptyRaw = (): DemoRaw => ({ version: 'demo', protocol: 22, workspaces: [], tabs: [], panes: [], agents: [], layouts: [],
  focused_workspace_id: null, focused_tab_id: null, focused_pane_id: null });

export interface DemoWorldOpts { clock: Clock; n?: number; seed?: number; scenario?: string; log?: Logger }

type DeckKey = '_deck' | '_rareDeck' | '_phaseDeck' | '_testDeck';

export class DemoWorld extends HerdrSource {
  clock: Clock;
  n: number;
  seed: number;
  log: Logger;
  /** pane id → transcript-ish facts (DemoEnricher reads) */
  facts: Map<string, Facts>;
  /** workspace id → its repository (rev 2; every pane of the workspace shares it); null = not a git repo */
  gits: Map<string, GitInfo | null>;
  /** workspace id → the HEADs it has had (oldest first) and every edit, tagged with the HEAD it landed on (`git.diff`, rev 4) */
  edits: Map<string, DemoEdits>;
  /** pane id → schedule state */
  sims: Map<string, Sim>;
  /** Optional pane reader for pane.read visible/recent (app wires FakeTerminals.read). */
  paneReader: ((id: string, opts?: ReadOpts) => Promise<ReadResult>) | null;
  /** Optional fake pane-global scroll offset (app wires FakeTerminals.scrollOffset). */
  paneScroll: ((id: string) => number) | null;
  /** Optional: true once a human typed into the pane's fake PTY (app wires FakeTerminals.touched). */
  paneTouched: ((id: string) => boolean) | null;
  _globalTimers: Set<TimerHandle>;
  _started: boolean;
  scenarioName: string;
  sc: Scenario;
  raw: DemoRaw;
  _wsSeq: number;
  _termSeq: number;
  _names: Set<string>;
  _R: Rng;
  // shuffled decks (see `_deal`): each holds the items of its own table
  _deck: unknown[];
  _rareDeck: unknown[];
  _phaseDeck: unknown[];
  _testDeck: unknown[];
  _iSeq: number;
  _seen: Set<ToolClass>;
  constructor({ clock, n = 12, seed = 1, scenario = 'mixed', log }: DemoWorldOpts) {
    super();
    if (!clock) throw new Error('DemoWorld: clock required');
    this.clock = clock;
    this.n = n;
    this.seed = seed;
    this.log = log ?? { debug() {}, info() {}, warn() {}, error() {} };
    this.facts = new Map();
    this.gits = new Map();
    this.edits = new Map();
    this.sims = new Map();
    this.paneReader = null;
    this.paneScroll = null;
    this.paneTouched = null;
    this._globalTimers = new Set();
    this._started = false;
    // _build() (re)assigns the per-scenario state
    this.scenarioName = 'mixed';
    this.sc = { specs: [], schedule: false };
    this.raw = emptyRaw();
    this._wsSeq = 0;
    this._termSeq = 0;
    this._names = new Set();
    this._R = rng('');
    this._deck = [];
    this._rareDeck = [];
    this._phaseDeck = [];
    this._testDeck = [];
    this._iSeq = 0;
    this._seen = new Set();
    this._build(scenario);
  }

  // ------------------------------------------------------------------------------------------
  // HerdrSource

  /** Begin emitting and scheduling (the first snapshot is available from snapshot() right away). */
  start(): this {
    if (this._started) return this;
    this._started = true;
    this._startSchedules();
    this.emit('connected', this.connected);
    if (this.connected) this._emitSnapshot();
    return this;
  }

  override snapshot(): DemoRaw | null {
    return this.connected ? clone(this.raw) : null;
  }

  override async close(): Promise<void> {
    this._stopAll();
    this.removeAllListeners();
  }

  /** Leak surface (churn). */
  metrics(): { scenario: string; panes: number; sims: number; facts: number; timers: number; connected: boolean } {
    let timers = this._globalTimers.size;
    for (const s of this.sims.values()) timers += s.timers.size;
    return { scenario: this.scenarioName, panes: this.raw.panes.length, sims: this.sims.size, facts: this.facts.size, timers, connected: this.connected };
  }

  /**
   * Seed `since.json` records so longIdle's ages are honest (not approx). `store` = WorldModel's SinceStore.
   */
  seedSince(store: { map: Record<string, SinceRecord>; doc?: { touch(): void } }): void {
    const now = this.clock.now();
    for (const s of this.sims.values()) {
      if (s.spec.idleForMs == null) continue;
      const p = this._paneReq(s.id);
      const a = this._agent(s.id);
      const identity = this._identity(p);
      store.map[identityKey(identity)] = { stateSeq: a?.state_change_seq ?? null, status: p.agent_status, since: now - s.spec.idleForMs,
        approx: false, hinted: true, seen: now, ...(a ? {} : { activity: 'prompt' }) };
    }
    store.doc?.touch();
  }

  /** Emit the current snapshot (nothing while offline: the store ignores a null one). */
  _emitSnapshot(): void {
    const snap = this.snapshot();
    if (snap) this.emit('snapshot', snap);
  }

  _identity(p: DemoPane): Identity {
    const w = this.raw.workspaces.find((x) => x.workspace_id === p.workspace_id);
    const t = this.raw.tabs.find((x) => x.tab_id === p.tab_id);
    const lay = this.raw.layouts.find((l) => l.tab_id === p.tab_id);
    const idx = lay ? lay.panes.findIndex((q) => q.pane_id === p.pane_id) : 0;
    return { terminalId: p.terminal_id, agentSession: p.agent_session?.value ?? null, place: placeOf(w?.label ?? '', t?.label ?? '', Math.max(0, idx), p.foreground_cwd ?? p.cwd) };
  }

  override get demoConfig(): DemoConfig {
    return { scenario: this.scenarioName, seed: this.seed, population: this.n };
  }

  /** Reset the active scenario, retaining its seed when none was supplied. */
  override scenario = (name: string, seed?: number): DemoConfig => this.setScenario(name, seed);

  /** Switch scenario at runtime: every old pane leaves before the new set arrives. */
  setScenario(name: string, seed = this.seed): DemoConfig {
    if (!SCENARIOS.includes(name)) throw Object.assign(new Error(`unknown scenario ${name}`), { code: 'not_accepted' });
    const invalidSeed = VALIDATE['demo.scenario'].seed.check(seed);
    if (invalidSeed) throw Object.assign(new Error(`seed: ${invalidSeed}`), { code: 'bad_message' });
    const wasConnected = this.connected;
    this._stopAll();
    this.seed = seed;
    this._build(name);
    this.emit('demo-reset');
    if (!this._started) return this.demoConfig;
    if (this.connected !== wasConnected) this.emit('connected', this.connected);
    if (this.connected) this._emitSnapshot();
    this._startSchedules();
    return this.demoConfig;
  }

  // ------------------------------------------------------------------------------------------
  // Building

  _build(scenario: string): void {
    this.scenarioName = SCENARIOS.includes(scenario) ? scenario : 'mixed';
    const sc = buildScenario(this.scenarioName, { n: this.n, seed: this.seed });
    this.sc = sc;
    this.connected = !sc.offline;
    this.raw = emptyRaw();
    this.facts.clear();
    this.gits.clear();
    this.edits.clear();
    this.sims.clear();
    this._wsSeq = 0;
    this._termSeq = 0;
    this._names = new Set();
    this._R = rng(`world:${this.scenarioName}:${this.seed}`);
    this._deck = [];
    this._rareDeck = [];
    this._phaseDeck = [];
    this._testDeck = [];
    this._iSeq = 0;
    this._seen = new Set();
    const wsIds = new Map<number, string>();
    // Scheduled scenarios start from a deterministic status spread so the first minute already shows every status.
    const spread = ['mixed', 'crowd40', 'churn', 'trio'].includes(this.scenarioName);
    let agentOrder = 0;
    sc.specs = sc.specs.map((spec) => {
      if (!spread || spec.kind === 'shell' || spec.status) return spec;
      const k = agentOrder++;
      return { ...spec, status: SPREAD[k % SPREAD.length], nearCompact: k % SPREAD.length === 3 };
    });
    sc.specs.forEach((spec, i) => {
      if (!wsIds.has(spec.ws)) wsIds.set(spec.ws, this._addWorkspace(spec.ws));
      this._addPane({ ...spec, index: i }, wsIds.get(spec.ws) as string, { silent: true }); // set just above
    });
    const first = this.raw.panes[0];
    if (first) this._focus(first, { silent: true });
    this._rollup();
  }

  _addWorkspace(k: number, label?: string): string {
    const n = ++this._wsSeq;
    const def = WORKSPACES[k % WORKSPACES.length];
    const lbl = label ?? (k < WORKSPACES.length ? def.label : `${def.label}-${Math.floor(k / WORKSPACES.length) + 1}`);
    const id = `d${n}`;
    this.raw.workspaces.push({
      workspace_id: id, number: n, label: lbl, focused: false, pane_count: 0, tab_count: 0, active_tab_id: null, agent_status: 'unknown',
      ...(def.repo ? { worktree: { repo_name: def.repo, repo_root: def.cwd, checkout_path: def.cwd, is_linked_worktree: false, repo_key: def.repo } } : {}),
      _cwd: def.cwd, _paneSeq: 0, _tabSeq: 0,
    });
    this.gits.set(id, def.repo ? this._seedGit(rng(`git:${this.scenarioName}:${this.seed}:${id}:${lbl}`), def.cwd) : null);
    return id;
  }

  /** A workspace's repo as the morning left it: a branch, a few changed files, maybe commits waiting to be pushed (up to 7, so a
   *  field can show more crates than its stack holds), sometimes behind its upstream. */
  _seedGit(R: Rng, root: string): GitInfo {
    const branch = R.pick(BRANCHES);
    const untracked = R.int(0, 2);
    return {
      root, branch, head: hashHex(`${root}:${R.next()}`).slice(0, 7), dirty: R.int(0, 6) + untracked, untracked,
      ahead: branch === 'spike/webgpu' ? null : R.chance(0.5) ? R.int(1, 7) : 0, behind: R.chance(0.2) ? R.int(1, 4) : 0,
      lastCommit: { subject: R.pick(COMMITS), at: this.clock.now() - R.int(4, 240) * MIN },
    };
  }

  /** git.diff bookkeeping: the workspace's HEAD history starts at the HEAD it was seeded with. */
  _editsOf(wsId: string): DemoEdits | null {
    const g = this.gits.get(wsId);
    if (!g) return null;
    let e = this.edits.get(wsId);
    if (!e) { e = { heads: [g.head ?? '0000000'], log: [] }; this.edits.set(wsId, e); }
    return e;
  }
  _logEdit(wsId: string | undefined, file: string, added: number, removed: number, created: boolean): void {
    const e = wsId ? this._editsOf(wsId) : null;
    if (!e) return;
    e.log.push({ head: e.heads.length - 1, file, added, removed, created });
    if (e.log.length > 2000) e.log.splice(0, e.log.length - 2000);
  }
  _logHead(wsId: string | undefined, head: string): void {
    const e = wsId ? this._editsOf(wsId) : null;
    if (e && e.heads.at(-1) !== head) e.heads.push(head);
  }

  /**
   * `git.diff` (rev 4) over the demo's own edit log: from a HEAD the workspace had to a later one (or the working tree),
   * every edit made on the HEADs in between, summed per file; `path` adds a made-up but plausible patch. A HEAD the
   * log never had (the seeded morning's recaps) gets a seeded diffstat of its own, so every recap has something to show.
   */
  async diff(id: string, _root: string | null, q: { from?: string; to?: string; path?: string }): Promise<DiffResult> {
    const wsId = this._pane(id)?.workspace_id;
    const g = wsId ? this.gits.get(wsId) : null;
    if (!wsId || !g) throw Object.assign(new Error('not a git repository'), { code: 'not_accepted' });
    const e = this._editsOf(wsId)!;
    const from = q.from ?? e.heads.at(-1)!;
    const to = q.to ?? null;
    const a = e.heads.indexOf(from);
    const b = to ? e.heads.indexOf(to) : e.heads.length;
    const per = new Map<string, { added: number; removed: number; created: boolean }>();
    if (a >= 0 && b >= a) {
      for (const x of e.log) {
        if (x.head < a || x.head >= b) continue;
        const c = per.get(x.file) ?? { added: 0, removed: 0, created: x.created };
        c.added += x.added; c.removed += x.removed;
        per.set(x.file, c);
      }
    } else {
      const R = rng(`diff:${wsId}:${from}:${to ?? ''}`);
      const n = R.int(1, 6);
      for (let i = 0; i < n; i++) {
        const file = activityFor(R, R.chance(0.2) ? 'write' : 'edit').detail || `src/file${i}.ts`;
        const added = R.int(2, 80);
        per.set(file, { added, removed: R.int(0, Math.round(added * 0.7)), created: R.chance(0.15) });
      }
    }
    const files: DiffFile[] = [...per].map(([path, c]) => ({ path, status: c.created ? (to || (b > a && e.log.some((x) => x.file === path && x.head < e.heads.length - 1)) ? 'A' : '?') : 'M', added: c.added, removed: c.created ? 0 : c.removed }))
      .sort((x, y) => (y.added! + y.removed!) - (x.added! + x.removed!) || x.path.localeCompare(y.path));
    const res: DiffResult = { root: g.root, from: from.slice(0, 12), to: to ? to.slice(0, 12) : null, files, added: files.reduce((s, f) => s + f.added!, 0), removed: files.reduce((s, f) => s + f.removed!, 0), more: 0 };
    if (!q.path) return res;
    const f = files.find((x) => x.path === q.path);
    if (!f) throw Object.assign(new Error('that file is not in this diff'), { code: 'not_accepted' });
    return { ...res, patch: { path: f.path, text: demoPatch(f, `${wsId}:${from}`), truncated: false } };
  }

  /** Change a workspace's repo and tell every pane in it. */
  _gitEdit(wsId: string | undefined, fn: (g: GitInfo) => GitInfo): void {
    const g = wsId ? this.gits.get(wsId) : null;
    if (wsId && g) this._gitSet(wsId, fn(g));
  }
  _gitSet(wsId: string, g: GitInfo | null): void {
    this.gits.set(wsId, g);
    for (const p of this.raw.panes) if (p.workspace_id === wsId) this._facts(p.pane_id);
  }

  /** One model call's spend (rev 2): today's tokens and estimated cost, reset when the local day rolls. */
  _spend(f: Facts, u: TokenUse): void {
    const day = localDay(this.clock.now());
    const cur = f.usage && f.usage.day === day ? f.usage : { day, tokens: 0, output: 0, cost: 0, partial: false };
    const c = costOf(f.model, u);
    f.usage = { day, tokens: cur.tokens + tokensOf(u), output: cur.output + u.output, cost: c == null ? cur.cost : Math.round(((cur.cost ?? 0) + c) * 10_000) / 10_000, partial: false };
  }

  _tabFor(wsId: string, label: string): DemoTab {
    const w = this._wsReq(wsId);
    let t = label === '#' ? null : this.raw.tabs.find((x) => x.workspace_id === wsId && x._name === label);
    if (!t) {
      const num = ++w._tabSeq;
      t = { tab_id: `${wsId}:t${num}`, workspace_id: wsId, number: num, label: label === '#' ? String(num) : label, focused: num === 1,
        pane_count: 0, agent_status: 'unknown', _name: label };
      this.raw.tabs.push(t);
      if (!w.active_tab_id) w.active_tab_id = t.tab_id;
    }
    return t;
  }

  _pickName(R: Rng): string | null {
    for (let i = 0; i < 50; i++) {
      const n = R.pick(NAMES);
      if (!this._names.has(n)) {
        this._names.add(n);
        return n;
      }
    }
    return null;
  }

  /**
   * Create a pane from a spec in workspace `wsId`. Returns the pane id.
   */
  _addPane(spec: NewPaneSpec, wsId: string, { silent = false }: { silent?: boolean } = {}): string {
    const w = this._wsReq(wsId);
    const t = this._tabFor(wsId, spec.tab ?? 'claude');
    const id = `${wsId}:p${++w._paneSeq}`;
    const R = rng(`pane:${this.scenarioName}:${this.seed}:${id}:${spec.index ?? this._termSeq}`);
    const kind = spec.kind ?? 'claude';
    const cwd = spec.cwd ?? (kind === 'shell' && spec.proc?.[0] === 'tail' ? '/var/log/nginx' : w._cwd);
    const term = `term_demo_${hashHex(`${this.scenarioName}:${this.seed}:${id}:${++this._termSeq}`)}`;
    const agent = kind !== 'shell';
    // the herdr agent label: the kind itself, or a vendor's (`opencode`, `aider` …) for kind 'agent' panes (zoo)
    const label = spec.agent ?? kind;
    const status = agent ? spec.status ?? 'idle' : 'unknown';
    const pane: DemoPane = {
      pane_id: id, terminal_id: term, workspace_id: wsId, tab_id: t.tab_id, focused: false, cwd, foreground_cwd: cwd,
      terminal_title: '', terminal_title_stripped: '', agent_status: status,
      scroll: { offset_from_bottom: 0, max_offset_from_bottom: 0, viewport_rows: 50 }, revision: 1,
    };
    const f: Facts = {
      kind, title: null, activity: null, activitySince: 0, model: null, modelTier: null, contextTokens: null, outputTokens: null,
      todos: null, lastPrompt: null, struggle: null, subagents: [], prompt: null, askActivity: false, lastText: null, work: null, usage: null,
      proc: kind === 'shell' ? spec.proc ?? ['bash'] : spec.proc ?? [label],
      out: [], outSeq: 0, // shells: printed lines {seq, text, kind} (DemoWorld is the shell; fakeTerm renders them)
    };
    if (kind === 'shell' && f.proc[0] !== 'bash') {
      this._print(f, [{ text: f.proc.join(' '), kind: 'cmd' }, ...shellTick(R, processActivity(f.proc[0], [...f.proc]), f.proc, 0)]);
    }
    if (agent) {
      const named = spec.name !== undefined ? spec.name : R.chance(0.8) ? this._pickName(R) : null;
      pane.agent = label;
      pane.agent_session = { source: `herdr:${label}`, agent: label, kind: 'id', value: uuidOf(term) };
      this.raw.agents.push({ pane_id: id, terminal_id: term, workspace_id: wsId, tab_id: t.tab_id, agent: label, agent_status: status,
        agent_session: pane.agent_session, cwd, foreground_cwd: cwd, ...(named ? { name: named } : {}), interactive_ready: true,
        state_change_seq: 1 + R.int(0, 40) });
      if (kind === 'claude') {
        f.model = spec.model ?? MODEL_OF(R, kind);
        f.modelTier = modelTier(f.model);
        const [title, prompt] = spec.title ? [spec.title, spec.lastPrompt ?? null] : R.pick(TASKS);
        const blank = spec.fresh || (status === 'unknown' && !spec.frozen); // a fresh hire (agent.start) has no task yet
        f.title = blank ? null : title;
        f.lastPrompt = blank ? null : prompt;
        // spread slot 3 starts near its context limit so compaction shows up early ("grow contextTokens")
        f.contextTokens = spec.nearCompact ? R.int(148_000, 158_000) : R.int(18_000, 140_000);
        f.outputTokens = Math.round(f.contextTokens * R.range(0.08, 0.2));
        // the morning so far: some model calls re-reading a growing context (own stream: never shifts the schedule's R)
        const M = rng(`spend:${this.scenarioName}:${this.seed}:${id}`);
        if (status !== 'unknown') for (let i = 0, n = M.int(20, 160), ctx = M.int(15_000, 60_000); i < n; i++, ctx = Math.min(180_000, ctx + M.int(200, 3000))) {
          this._spend(f, { input: M.int(2, 40), cacheWrite: M.int(200, 3000), cacheRead: ctx, output: M.int(40, 900) });
        }
        if (f.title) this._seedWork(rng(`text:${this.scenarioName}:${this.seed}:${id}`), f, status);
      }
      if (spec.trust) f.prompt = { ...PROMPTS.trust(cwd), selected: 0, typed: '' };
      else if (spec.prompt) f.prompt = { ...spec.prompt, selected: 0, typed: '' };
      else if (status === 'blocked') f.prompt = { ...randomPrompt(R, cwd), selected: 0, typed: '' };
      f.askActivity = !!spec.askActivity;
      if (spec.frozen && spec.cls && status === 'working') this._setActivity(f, activityFor(R, spec.cls));
    }
    this.raw.panes.push(pane);
    this.facts.set(id, f);
    // T: a separate stream for lastText/work, so they never shift the schedule's own random sequence (R)
    const sim: Sim = { id, kind, spec, R, T: rng(`text:${this.scenarioName}:${this.seed}:${id}:${this._termSeq}`), timers: new Set(), turn: null,
      frozen: !!spec.frozen, focusedAt: null, ticks: 0 };
    this.sims.set(id, sim);
    this._title(id);
    this._relayout(t.tab_id);
    if (!silent) {
      this._rollup();
      this._emitSnapshot();
      if (this._started) this._startSim(sim);
    }
    return id;
  }

  /**
   * Starting lastText + work for a Claude that already has a task: a working one is mid-task (some edits so far),
   * idle/done ones show their finished task, a blocked one is waiting mid-task.
   */
  _seedWork(R: Rng, f: Facts, status: Status): void {
    const now = this.clock.now();
    const file = activityFor(R, 'edit').detail;
    const files = status === 'working' ? R.int(0, 3) : R.int(1, 5);
    const work = (f.work = { since: now - R.int(status === 'working' ? 1 : 4, status === 'working' ? 9 : 40) * MIN, added: 0, removed: 0, files });
    for (let i = 0; i < files; i++) {
      work.added += R.int(3, 45);
      work.removed += R.int(0, 18);
    }
    f.lastText = demoText(R, status === 'working' ? (files ? 'talk' : 'explore') : status === 'blocked' ? 'plan' : 'done', { title: f.title, prompt: f.lastPrompt, file, work });
  }

  /** Struggle (+ detail/context) from the sim's fail streak and context, the same rules as live. */
  _struggle(sim: Sim): void {
    const f = this.facts.get(sim.id);
    if (!f || f.kind !== 'claude') return;
    const fails = sim.fails ?? 0;
    f.struggle = this._pane(sim.id)?.agent_status === 'working'
      ? struggleOf({ failStreak: fails, streakFails: fails, contextTokens: f.contextTokens, model: f.model }) : null;
  }

  _removePane(id: string, { silent = false }: { silent?: boolean } = {}): void {
    const p = this._pane(id);
    if (!p) return;
    const sim = this.sims.get(id);
    if (sim) this._clearSim(sim);
    this.sims.delete(id);
    const a = this._agent(id);
    if (a?.name) this._names.delete(a.name);
    this.facts.delete(id);
    this.raw.panes = this.raw.panes.filter((q) => q !== p);
    this.raw.agents = this.raw.agents.filter((x) => x.pane_id !== id);
    this._relayout(p.tab_id);
    const liveTabs = new Set(this.raw.panes.map((q) => q.tab_id));
    this.raw.tabs = this.raw.tabs.filter((t) => liveTabs.has(t.tab_id));
    this.raw.layouts = this.raw.layouts.filter((l) => liveTabs.has(l.tab_id));
    const liveWs = new Set(this.raw.panes.map((q) => q.workspace_id));
    this.raw.workspaces = this.raw.workspaces.filter((w) => liveWs.has(w.workspace_id));
    if (this.raw.focused_pane_id === id) this.raw.focused_pane_id = null;
    this._rollup();
    if (!silent) this._emitSnapshot();
  }

  _relayout(tabId: string): void {
    const inTab = this.raw.panes.filter((p) => p.tab_id === tabId);
    this.raw.layouts = this.raw.layouts.filter((l) => l.tab_id !== tabId);
    if (!inTab.length) return;
    const W = 200, H = 50, cw = Math.floor(W / inTab.length);
    const panes = inTab.map((p, k) => ({ pane_id: p.pane_id, focused: k === 0,
      rect: { x: k * cw, y: 0, width: k === inTab.length - 1 ? W - k * cw : cw, height: H } }));
    this.raw.layouts.push({ workspace_id: inTab[0].workspace_id, tab_id: tabId, zoomed: false, area: { x: 0, y: 0, width: W, height: H },
      focused_pane_id: panes[0].pane_id, panes,
      splits: panes.length > 1 ? [{ id: `${tabId}:s1`, direction: 'right', ratio: 1 / panes.length, rect: { x: 0, y: 0, width: W, height: H } }] : [] });
  }

  _rollup(): void {
    for (const t of this.raw.tabs) {
      const ps = this.raw.panes.filter((p) => p.tab_id === t.tab_id);
      t.agent_status = rollup(ps.map((p) => p.agent_status));
      t.pane_count = ps.length;
    }
    for (const w of this.raw.workspaces) {
      const ps = this.raw.panes.filter((p) => p.workspace_id === w.workspace_id);
      w.agent_status = rollup(ps.map((p) => p.agent_status));
      w.pane_count = ps.length;
      w.tab_count = this.raw.tabs.filter((t) => t.workspace_id === w.workspace_id).length;
    }
  }

  /** OSC-like titles: Claude sets `✳ <task>` idle / spinner while working; shells show `user@host: cwd`. */
  _title(id: string): void {
    const p = this._pane(id);
    const f = this.facts.get(id);
    if (!p || !f) return;
    let raw: string;
    if (f.kind === 'shell') raw = `demo@hq: ${home(p.foreground_cwd)}`;
    else if (f.kind !== 'claude') raw = f.proc[0] ?? f.kind; // codex, opencode, aider …: the CLI's own name
    else {
      const t = f.title ?? 'Claude Code';
      raw = p.agent_status === 'working' ? `${SPIN[(p.revision ?? 0) % SPIN.length]} ${t}` : `✳ ${t}`;
    }
    p.terminal_title = raw;
    p.terminal_title_stripped = raw.replace(/^[✳⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] /u, '');
  }

  // ------------------------------------------------------------------------------------------
  // State changes (each emits what herdr would)

  _pane(id: string): DemoPane | null {
    return this.raw.panes.find((p) => p.pane_id === id) ?? null;
  }
  /** The pane of a live sim / just-created pane (a missing one is a bug in the demo, not a case to handle). */
  /** The facts of a live sim (see _paneReq). */
  _fact(id: string): Facts {
    const f = this.facts.get(id);
    if (!f) throw new Error(`demo facts for ${id} not found`);
    return f;
  }
  _paneReq(id: string): DemoPane {
    const p = this._pane(id);
    if (!p) throw new Error(`demo pane ${id} not found`);
    return p;
  }
  _agent(id: string): DemoAgent | null {
    return this.raw.agents.find((a) => a.pane_id === id) ?? null;
  }
  _ws(id: string): DemoWorkspace | null {
    return this.raw.workspaces.find((w) => w.workspace_id === id) ?? null;
  }
  _wsReq(id: string): DemoWorkspace {
    const w = this._ws(id);
    if (!w) throw new Error(`demo workspace ${id} not found`);
    return w;
  }

  /** Set a pane's status (agents bump state_change_seq) and emit `status` (WorldModel re-reads the snapshot). */
  setStatus(id: string, status: Status): void {
    const p = this._pane(id);
    if (!p || p.agent_status === status) return;
    const a = this._agent(id);
    p.agent_status = status;
    p.revision++;
    if (a) {
      a.agent_status = status;
      a.state_change_seq++;
    }
    const f = this.facts.get(id);
    if (f && status !== 'blocked') {
      f.prompt = null;
      f.askActivity = false;
    }
    if (f && status !== 'working') f.struggle = null;
    this._title(id);
    this._rollup();
    if (this.connected && this._started) this.emit('status', id, status, a ? a.state_change_seq : null);
    this._facts(id);
  }

  _facts(id: string): void {
    if (this._started) this.emit('facts', id);
  }

  _event(id: string, kind: EventKind, detail: unknown): void {
    if (this._started && this.connected) this.emit('demo-event', id, kind, detail);
  }

  _setActivity(f: Facts, a: FactActivity | null): void {
    const key = a ? `${a.tool}|${a.cls}|${a.detail}` : '';
    const prev = f.activity ? `${f.activity.tool}|${f.activity.cls}|${f.activity.detail}` : '';
    f.activity = a;
    if (key !== prev) f.activitySince = this.clock.now();
  }

  _focus(p: DemoPane, { silent = false }: { silent?: boolean } = {}): void {
    for (const q of this.raw.panes) q.focused = q === p;
    this.raw.focused_pane_id = p.pane_id;
    this.raw.focused_workspace_id = p.workspace_id;
    this.raw.focused_tab_id = p.tab_id;
    for (const w of this.raw.workspaces) w.focused = w.workspace_id === p.workspace_id;
    if (!silent && p.agent_status === 'done') this.setStatus(p.pane_id, 'idle');
    else if (!silent) this._emitSnapshot();
  }

  // ------------------------------------------------------------------------------------------
  // Scheduling

  _after(sim: Sim, ms: number, fn: () => void): TimerHandle {
    const h = this.clock.setTimeout(() => {
      sim.timers.delete(h);
      if (this.sims.get(sim.id) !== sim) return;
      fn();
    }, Math.max(0, Math.round(ms)));
    sim.timers.add(h);
    return h;
  }

  _every(ms: number, fn: () => void): TimerHandle {
    const h = this.clock.setInterval(fn, ms);
    this._globalTimers.add(h);
    return h;
  }

  _clearSim(sim: Sim): void {
    for (const h of sim.timers) this.clock.clearTimeout(h);
    sim.timers.clear();
  }

  _stopAll(): void {
    for (const s of this.sims.values()) this._clearSim(s);
    for (const h of this._globalTimers) this.clock.clearInterval(h);
    this._globalTimers.clear();
  }

  _startSchedules(): void {
    if (!this.sc.schedule) return;
    let i = 0;
    for (const sim of this.sims.values()) this._startSim(sim, i++);
    if (this.scenarioName === 'mixed' || this.scenarioName === 'crowd40') this._scheduleComings();
    if (this.sc.churn) this._startChurn();
  }

  _startSim(sim: Sim, order = 0): void {
    if (sim.frozen || !this.sc.schedule) return;
    if (sim.kind === 'shell') {
      this._shellTicks(sim, { printFirst: false }); // _addPane already printed the command + its first lines
      return this._shellLoop(sim, true);
    }
    // every other agent (codex, gemini, the zoo's vendors) walks herdr statuses only: no transcript facts
    const f = this._fact(sim.id);
    const R = sim.R;
    const spec = sim.spec;
    if (spec.queue) return this._block(sim, { keep: true });
    if (spec.frozenIdle) return;
    switch (spec.status ?? 'idle') {
      case 'working':
        this._startTurn(sim, { resume: true });
        break;
      case 'blocked':
        this._block(sim, { ask: order % 2 === 1 || R.chance(0.3) || !!spec.askActivity });
        break;
      case 'done':
        this._after(sim, R.range(20, 120) * S, () => this._looked(sim));
        break;
      case 'unknown':
        this._after(sim, R.range(15, 50) * S, () => {
          f.title = null;
          this.setStatus(sim.id, 'idle');
          this._idle(sim);
        });
        break;
      default:
        this._idle(sim);
    }
  }

  /** Idle for a while, then the user sends a new prompt. */
  _idle(sim: Sim): void {
    const R = sim.R;
    const ms = (this.scenarioName === 'trio' ? 10 + 50 * R.next() ** 2 : 15 + 135 * R.next() ** 2) * S;
    this._after(sim, ms, () => {
      if (R.chance(0.04)) {
        this.setStatus(sim.id, 'unknown');
        this._after(sim, R.range(10, 40) * S, () => {
          this.setStatus(sim.id, 'idle');
          this._idle(sim);
        });
        return;
      }
      this._prompt(sim, null);
    });
  }

  /** A new user prompt (from the schedule, or `agent.prompt`). */
  _prompt(sim: Sim, text: string | null): void {
    const f = this._fact(sim.id);
    const R = sim.R;
    if (f.kind === 'claude') {
      if (text) {
        f.lastPrompt = String(text).slice(0, 500);
        f.title = titleOf(f.lastPrompt) ?? f.title; // Claude's ai-title for a typed prompt
      } else {
        const [title, prompt] = R.chance(0.6) || !f.title ? R.pick(TASKS) : [f.title, f.lastPrompt];
        f.title = title;
        f.lastPrompt = prompt;
      }
      f.todos = null;
      f.subagents = f.subagents.map((s) => ({ ...s, active: false }));
      // a new task → fresh work counters (lastText stays until Claude says something new)
      f.work = { since: this.clock.now(), added: 0, removed: 0, files: 0 };
      sim.files = new Set();
      sim.turnMsgs = 1;
      sim.turnEdits = 0;
      // Claude opens a task with a line of text ("Let me look at … first")
      f.lastText = demoText(sim.T, 'explore', { title: f.title, prompt: f.lastPrompt, file: activityFor(sim.T, 'read').detail });
    }
    this._clearSim(sim);
    this._startTurn(sim, {});
  }

  /** Build the phase plan for a turn: 20–300 s of explore → plan → edit → verify (→ edit → verify) → git. */
  _plan(R: Rng, resume: boolean): Phase[] {
    const total = (20 + 280 * Math.pow(R.next(), 1.6)) * S;
    const names: PhaseName[] = ['explore', ...this._deal('_phaseDeck', EXTRA_PHASES.map((x): [PhaseName[], number] => [x, 1])), 'plan', 'edit', 'verify'];
    if (R.chance(0.3)) names.push('edit', 'verify');
    if (R.chance(0.4)) names.push('git');
    let phases = names.map((name) => ({ name, dur: R.range(...PHASES[name].dur) * S }));
    const sum = phases.reduce((a, p) => a + p.dur, 0);
    const k = total / sum;
    phases = phases.map((p) => ({ ...p, dur: Math.max(4 * S, p.dur * k) }));
    if (resume) phases = phases.slice(R.int(0, Math.max(0, phases.length - 2)));
    return phases;
  }

  /** Deal the next item from a shuffled deck (refilled when empty). Each deck key is always used with the same table. */
  _deal<T>(key: DeckKey, weighted: readonly (readonly [T, number])[]): T {
    if (!this[key].length) {
      const deck = weighted.flatMap(([v, n]) => Array.from({ length: n }, () => v));
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(this._R.next() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      this[key] = deck;
    }
    return this[key].pop() as T; // just refilled, so non-empty
  }

  /**
   * Next interjection class: while some class has not been shown yet, every other interjection surfaces one (so a
   * fresh demo shows every ToolClass within ~3 min); otherwise alternate the common and rare decks.
   */
  _interject(): ToolClass {
    const k = this._iSeq++;
    const unseen = COVER.filter((c) => !this._seen.has(c));
    if (unseen.length && k % 2 === 0) return unseen[Math.floor(this._R.next() * unseen.length)];
    return k % 2 ? this._deal('_rareDeck', RARE) : this._deal('_deck', INTERJECT);
  }

  _startTurn(sim: Sim, { resume = false, short = false }: { resume?: boolean; short?: boolean }): void {
    const R = sim.R;
    const f = this._fact(sim.id);
    sim.turn = { phases: short ? [{ name: R.pick(['edit', 'verify']), dur: R.range(8, 40) * S }] : this._plan(R, resume), i: 0, left: 0, subs: [] };
    sim.turn.left = sim.turn.phases[0].dur;
    if (f.kind === 'claude') this._setActivity(f, activityFor(R, 'think'));
    this.setStatus(sim.id, 'working');
    this._step(sim);
  }

  /** One tool step inside the current phase. */
  _step(sim: Sim): void {
    const R = sim.R;
    const f = this._fact(sim.id);
    const turn = sim.turn;
    if (!turn) return;
    if (turn.left <= 0) {
      this._endPhase(sim);
      turn.i++;
      if (turn.i >= turn.phases.length) return this._endTurn(sim);
      turn.left = turn.phases[turn.i].dur;
    }
    const phase = turn.phases[turn.i];
    if (f.kind !== 'claude') {
      // codex: herdr status only (no transcript facts); still walk the turn's time
      const d = turn.left;
      turn.left = 0;
      this._after(sim, d, () => this._step(sim));
      return;
    }
    let cls: ToolClass;
    if ((f.contextTokens ?? 0) > 150_000 && R.chance(0.5)) cls = 'compact';
    else if (phase.name === 'task') cls = 'task';
    else if (R.chance(0.68)) cls = R.weighted(PHASES[phase.name].cls);
    else cls = this._interject();
    // Real Claude changes tool every few seconds; keep steps short so the office stays lively.
    let dur = cls === 'task' ? (phase.name === 'task' ? turn.left : R.range(10, 40) * S) : cls === 'think' || cls === 'talk' ? R.range(1.5, 4.5) * S
      : cls === 'compact' ? R.range(6, 12) * S : cls === 'test' || cls === 'build' ? R.range(4, 12) * S : cls === 'web' ? R.range(3, 9) * S : R.range(1.5, 5) * S;
    dur = Math.min(dur, Math.max(2 * S, turn.left));
    const a = activityFor(R, cls);
    if (cls === 'git' && phase.name === 'git' && R.chance(0.6)) a.detail = `git add -A && git commit -m "${(f.title ?? 'wip').toLowerCase().slice(0, 30)}"`;
    // Claude Code asks permission BEFORE a risky tool runs: block mid-turn, resume the same turn once answered
    if (this._mayAsk(sim) && R.chance(MIDTURN_ASK)) {
      const pr = permissionFor(a, this._pane(sim.id)?.cwd ?? '~');
      if (pr) {
        sim.pending = { cls, a, dur };
        f.prompt = { ...pr, selected: 0, typed: '' };
        return this._block(sim, { ask: false, midTurn: true });
      }
    }
    if (cls === 'todo' || (phase.name === 'plan' && !f.todos)) this._todos(sim, 'plan');
    if (cls === 'todo') a.detail = f.todos?.find((t) => t.status === 'in_progress')?.activeForm ?? '';
    if (cls === 'task') this._spawnSubs(sim, dur);
    this._setActivity(f, a);
    this._seen.add(cls);
    const ctxBefore = f.contextTokens ?? 20_000;
    f.contextTokens = Math.min(199_000, ctxBefore + R.int(400, 4500));
    const out = R.int(20, 900);
    f.outputTokens = (f.outputTokens ?? 0) + out;
    this._spend(f, { input: 3, cacheWrite: Math.max(0, f.contextTokens - ctxBefore), cacheRead: ctxBefore, output: out });
    this._struggle(sim);
    const p = this._pane(sim.id);
    if (p) {
      p.revision++;
      this._title(sim.id);
    }
    this._facts(sim.id);
    turn.left -= dur;
    this._after(sim, dur, () => {
      this._stepDone(sim, cls, a);
      this._step(sim);
    });
  }

  /** Mid-turn permission prompts: lively scenarios only, a cooldown after each answer, ≤ ⌈agents/5⌉ blocked at once. */
  _mayAsk(sim: Sim): boolean {
    if (!LIVELY.has(this.scenarioName) || sim.spec.queue) return false;
    if (sim.lastAnswerAt && this.clock.now() - sim.lastAnswerAt < ASK_COOLDOWN_MS) return false;
    const blocked = this.raw.panes.filter((p) => p.agent_status === 'blocked').length;
    return blocked < Math.max(1, Math.ceil(this.raw.agents.length / 5));
  }

  _stepDone(sim: Sim, cls: ToolClass, a: DemoActivity): void {
    const R = sim.R;
    const f = this.facts.get(sim.id);
    if (!f) return;
    // no news per step (one per turn end, `_endTurn`); assistant text updates lastText
    const phase = sim.turn?.phases[sim.turn.i]?.name;
    const say = (stage: DemoTextStage) => {
      if (f.kind !== 'claude') return;
      f.lastText = demoText(sim.T, stage, { title: f.title, prompt: f.lastPrompt, file: sim.lastFile ?? activityFor(sim.T, 'read').detail, work: f.work });
      sim.turnMsgs = (sim.turnMsgs ?? 0) + 1;
    };
    if (cls === 'read' || cls === 'edit' || cls === 'write') sim.lastFile = a.detail;
    if (cls === 'talk') say(phase === 'explore' ? 'explore' : phase === 'plan' ? 'plan' : 'talk');
    if (cls === 'test') {
      const pass = this._deal('_testDeck', [[true, 3], [false, 2]]); // dealt, so every few runs one fails (red → green arcs)
      this._event(sim.id, pass ? 'test-pass' : 'test-fail', { cmd: a.detail });
      sim.fails = pass ? 0 : (sim.fails ?? 0) + 1;
      this._struggle(sim);
      if (sim.T.chance(0.6)) say(pass ? 'pass' : 'fail');
      if (pass) this._todos(sim, 'verify');
    } else if (cls === 'compact') {
      this._event(sim.id, 'compact', { preTokens: f.contextTokens, trigger: 'auto' });
      f.contextTokens = R.int(18_000, 40_000);
    } else if (cls === 'git' && /commit/.test(a.detail)) {
      const msg = /-m "([^"]*)"/.exec(a.detail)?.[1] || (f.title ?? 'wip');
      const subject = msg.charAt(0).toUpperCase() + msg.slice(1);
      const head = hashHex(`${sim.id}:${this.clock.now()}:${subject}`).slice(0, 7);
      // the commit takes the dirty files; every other commit gets pushed too (deterministic: no draw from R)
      this._gitEdit(this._pane(sim.id)?.workspace_id, (g) => {
        const ahead = g.ahead == null ? null : parseInt(head[0], 16) % 2 ? 0 : g.ahead + 1;
        return { ...g, head, dirty: 0, untracked: 0, ahead, behind: 0, lastCommit: { subject, at: this.clock.now() } };
      });
      this._logHead(this._pane(sim.id)?.workspace_id, head);
      this._event(sim.id, 'commit', { push: false, msg: subject, sha: head, branch: this.gits.get(this._pane(sim.id)?.workspace_id ?? '')?.branch ?? undefined });
      this._todos(sim, 'git');
    } else if ((cls === 'build' && R.chance(0.15)) || (cls !== 'think' && cls !== 'talk' && R.chance(0.03))) {
      this._event(sim.id, 'error', { tool: a.tool });
    } else if (cls === 'edit' || cls === 'write') {
      sim.fails = 0;
      this._struggle(sim);
      this._todos(sim, 'edit');
      this._addWork(sim, cls, a);
    }
  }

  /** An Edit/MultiEdit/Write landed: grow the task's work counters. */
  _addWork(sim: Sim, cls: ToolClass, a: DemoActivity): void {
    const f = this.facts.get(sim.id);
    if (!f || f.kind !== 'claude') return;
    const R = sim.T;
    f.work ??= { since: this.clock.now(), added: 0, removed: 0, files: 0 };
    sim.files ??= new Set();
    const fresh = !sim.files.has(a.detail || 'file');
    sim.files.add(a.detail || 'file');
    // a file this task had not touched yet is one more changed file in the repo (weeds until the next commit)
    if (fresh) this._gitEdit(this._pane(sim.id)?.workspace_id, (g) => ({ ...g, dirty: Math.min(40, g.dirty + 1), untracked: g.untracked + (cls === 'write' ? 1 : 0) }));
    const added = cls === 'write' ? R.int(12, 140) : a.tool === 'MultiEdit' ? R.int(4, 40) : R.int(1, 18);
    const removed = cls === 'write' ? 0 : R.int(0, Math.max(1, Math.round(added * 0.8)));
    f.work = { since: f.work.since, added: f.work.added + added, removed: f.work.removed + removed, files: Math.max(f.work.files, sim.files.size) };
    this._logEdit(this._pane(sim.id)?.workspace_id, a.detail || 'file', added, removed, cls === 'write');
    sim.turnEdits = (sim.turnEdits ?? 0) + 1;
  }

  _endPhase(sim: Sim): void {
    const f = this.facts.get(sim.id);
    if (sim.turn?.phases[sim.turn.i]?.name === 'task' && f) {
      for (const s of f.subagents) if (s.active) this._subDone(sim, s);
    }
  }

  _endTurn(sim: Sim): void {
    const R = sim.R;
    const f = this._fact(sim.id);
    sim.turn = null;
    if (f.todos) f.todos = f.todos.map((t) => ({ ...t, status: 'completed' }));
    for (const s of f.subagents) if (s.active) this._subDone(sim, s);
    this._setActivity(f, null);
    f.struggle = null;
    sim.fails = 0;
    if (!sim.answered && R.chance(0.18)) return this._block(sim, { ask: R.chance(0.35) });
    if (f.kind === 'claude') {
      // the closing summary message; one meaningful `news` per finished turn
      f.lastText = demoText(sim.T, 'done', { title: f.title, prompt: f.lastPrompt, work: f.work });
      this._event(sim.id, 'news', { src: 'turn', msgs: (sim.turnMsgs ?? 0) + 1, edits: sim.turnEdits ?? 0 });
    }
    sim.turnMsgs = 0;
    sim.turnEdits = 0;
    sim.answered = false;
    if (sim.spec.queue) {
      // queue keeps its line populated: done for a bit, then blocked again with a fresh prompt of the same shape
      this.setStatus(sim.id, 'done');
      this._after(sim, R.range(20, 60) * S, () => {
        // (no prompt in the spec → _block deals a random one)
        f.prompt = sim.spec.prompt ? { ...sim.spec.prompt, selected: 0, typed: '' } : null;
        this._block(sim, { ask: sim.spec.askActivity, keep: true });
      });
      return;
    }
    if (this.raw.focused_pane_id === sim.id) {
      this.setStatus(sim.id, 'idle');
      return this._idle(sim);
    }
    this.setStatus(sim.id, 'done');
    this._after(sim, (40 + 200 * R.next() ** 2.2) * S, () => this._looked(sim)); // 40–240 s, skewed short (lively demo)
  }

  /** "The user looked in herdr": done → idle (the demo stand-in for pane.focus). */
  _looked(sim: Sim): void {
    this.setStatus(sim.id, 'idle');
    this._idle(sim);
  }

  _block(sim: Sim, { ask = false, keep = false, midTurn = false }: { ask?: boolean; keep?: boolean; midTurn?: boolean } = {}): void {
    const R = sim.R;
    const f = this._fact(sim.id);
    const p = this._paneReq(sim.id);
    if (!f.prompt) f.prompt = { ...randomPrompt(R, p.cwd), selected: 0, typed: '' };
    f.askActivity = !midTurn && f.prompt.shape !== 'trust' && (ask || f.askActivity || f.prompt.shape === 'bullets' || f.prompt.shape === 'free');
    this._setActivity(f, null);
    this.setStatus(sim.id, 'blocked');
    // setStatus('blocked') keeps prompt/askActivity; re-announce so the enricher shows `ask`
    this._facts(sim.id);
    // "the user answered in herdr": mostly yes, sometimes the second option, rarely a refusal
    if (!keep && !sim.spec.queue) {
      this._after(sim, R.range(25, 80) * S, () => {
        const n = f.prompt?.labels?.length ?? 1;
        this._answered(sim, R.weighted([[0, 7], [Math.min(1, n - 1), 2], [n - 1, 1]]));
      });
    }
  }

  /** A prompt was answered (from the schedule or pane.send_keys): a short working continuation, then done. */
  _answered(sim: Sim, optionIndex: number): void {
    const f = this._fact(sim.id);
    const shape = f.prompt?.shape;
    const refused = f.prompt && optionIndex === f.prompt.labels.length - 1 && shape !== 'free' && shape !== 'bullets';
    f.prompt = null;
    f.askActivity = false;
    this._clearSim(sim);
    sim.lastAnswerAt = this.clock.now();
    if (shape === 'trust') {
      if (sim.turn) sim.turn = null;
      this.setStatus(sim.id, 'idle');
      if (refused) return this._idle(sim);
      // trusted: the user types the first prompt a moment later
      this._after(sim, sim.R.range(3, 12) * S, () => this._prompt(sim, null));
      return;
    }
    const p = sim.pending;
    sim.pending = null;
    if (sim.turn && p) {
      // mid-turn permission: the same turn carries on (the approved tool runs; a refusal makes Claude say so and move on)
      this.setStatus(sim.id, 'working');
      if (refused) {
        this._setActivity(f, activityFor(sim.R, 'talk'));
        this._facts(sim.id);
        this._after(sim, sim.R.range(2, 5) * S, () => {
          f.lastText = demoText(sim.T, 'refused');
          sim.turnMsgs = (sim.turnMsgs ?? 0) + 1;
          this._facts(sim.id);
          this._step(sim);
        });
      } else {
        this._setActivity(f, p.a);
        this._facts(sim.id);
        sim.turn.left -= p.dur;
        this._after(sim, p.dur, () => {
          this._stepDone(sim, p.cls, p.a);
          this._step(sim);
        });
      }
      return;
    }
    sim.answered = true;
    this._startTurn(sim, { short: true });
  }

  _todos(sim: Sim, stage: 'plan' | 'verify' | 'git' | 'edit'): void {
    const f = this.facts.get(sim.id);
    if (!f || f.kind !== 'claude') return;
    if (stage === 'plan' && !f.todos) {
      const t = (f.title ?? 'the change').toLowerCase();
      const items = [['Read the relevant code', 'Reading the relevant code'], [`Implement ${t}`, `Implementing ${t}`],
        ['Add or update tests', 'Adding tests'], ['Run the test suite', 'Running the test suite']];
      if (sim.R.chance(0.4)) items.push(['Commit the change', 'Committing the change']);
      f.todos = items.map(([content, activeForm], i) => ({ content, activeForm, status: i === 0 ? 'completed' : i === 1 ? 'in_progress' : 'pending' }));
      return;
    }
    if (!f.todos) return;
    const idx = f.todos.findIndex((t) => t.status !== 'completed');
    if (idx < 0) return;
    const todos = f.todos;
    const want = stage === 'edit' ? 1 : stage === 'verify' ? 3 : todos.length;
    f.todos = todos.map((t, i): Todo => ({ ...t, status: i < Math.min(want, todos.length) && i < idx + 1 ? 'completed' : i === idx + 1 || (i === idx && t.status === 'pending') ? 'in_progress' : t.status }));
  }

  _spawnSubs(sim: Sim, phaseMs: number): void {
    const R = sim.R;
    const f = this._fact(sim.id);
    const k = R.int(1, 3);
    for (let i = 0; i < k; i++) {
      const [type, label] = pickSubagent(R);
      const s = { id: `${sim.id}:a${(sim.subSeq = (sim.subSeq ?? 0) + 1)}`, type, label, active: true };
      f.subagents = [s, ...f.subagents].slice(0, 8);
      this._event(sim.id, 'subagent-spawned', { id: s.id, type, label });
      this._after(sim, R.range(0.4, 1) * phaseMs, () => this._subDone(sim, s));
    }
  }

  _subDone(sim: Sim, s: Subagent): void {
    const f = this.facts.get(sim.id);
    const cur = f?.subagents.find((x) => x.id === s.id);
    if (!f || !cur || !cur.active) return;
    f.subagents = f.subagents.map((x) => (x.id === s.id ? { ...x, active: false } : x));
    this._event(sim.id, 'subagent-done', { id: s.id, type: s.type, label: s.label });
    this._facts(sim.id);
  }

  /** Shells cycle through their activities: prompt ↔ a foreground command. */
  _shellLoop(sim: Sim, first = false): void {
    const R = sim.R;
    const f = this._fact(sim.id);
    if (sim.spec.frozenProc) return;
    const atPrompt = f.proc[0] === 'bash';
    if (first && !atPrompt) {
      // started with a long-running command (e.g. queue's `npm test`): keep it a while
      this._after(sim, R.range(20, 90) * S, () => this._setProc(sim, ['bash'], () => this._shellLoop(sim)));
      return;
    }
    if (atPrompt) {
      const act = R.weighted<Exclude<ShellActivity, 'prompt'>>([['edit', 2], ['test', 2], ['git', 2], ['serve', 1], ['monitor', 1.2], ['build', 1], ['run', 1], ['repl', 0.5], ['remote', 0.5]]);
      const argv = act === 'git' && R.chance(0.35) ? ['git', 'commit', '-v'] : R.pick(SHELL_PROCS[act]);
      const dur = SHELL_RUN_S[act];
      this._after(sim, R.range(first ? 3 : 8, first ? 30 : 60) * S, () =>
        this._setProc(sim, argv, () => this._after(sim, R.range(...dur) * S, () => this._setProc(sim, ['bash'], () => this._shellLoop(sim)))));
    }
  }

  _setProc(sim: Sim, argv: string[], then?: () => void): void {
    const f = this.facts.get(sim.id);
    const p = this._pane(sim.id);
    if (!f || !p) return;
    const wasAct = processActivity(f.proc[0], f.proc);
    if (f.proc[0] !== 'bash') this._print(f, shellEnd(sim.R, wasAct, sim.ticks ?? 0));
    f.proc = argv;
    if (argv[0] !== 'bash') this._print(f, [{ text: argv.join(' '), kind: 'cmd' }]);
    p.revision++;
    this._shellTicks(sim);
    then?.();
  }

  /** Append printed lines to a shell's output ring. */
  _print(f: Facts, lines: ShellLine[]): void {
    for (const l of lines) f.out.push({ seq: ++f.outSeq, text: l.text, kind: l.kind ?? 'out' });
    if (f.out.length > OUT_MAX) f.out.splice(0, f.out.length - OUT_MAX);
  }

  /** While a shell runs a chatty command (tests, a build, a dev server, training…), print its output on the clock. */
  _shellTicks(sim: Sim, { printFirst = true }: { printFirst?: boolean } = {}): void {
    const f = this.facts.get(sim.id);
    if (!f || sim.kind !== 'shell') return;
    this.clock.clearTimeout(sim.tickTimer ?? undefined);
    if (sim.tickTimer) sim.timers.delete(sim.tickTimer);
    sim.tickTimer = null;
    sim.ticks = 0;
    const argv = f.proc;
    if (argv[0] === 'bash') return;
    const act = processActivity(argv[0], argv);
    if (printFirst) this._print(f, shellTick(sim.R, act, argv, 0));
    sim.ticks = 1;
    const every = SHELL_TICK_S[act];
    if (!every || sim.frozen) return;
    const tick = () => {
      sim.tickTimer = this._after(sim, sim.R.range(...every) * S, () => {
        if (f.proc !== argv) return;
        this._print(f, shellTick(sim.R, act, argv, sim.ticks++));
        tick();
      });
    };
    tick();
  }

  /** Text of a shell's recent output + its live prompt line, like `pane.read recent_unwrapped` (demo shells). */
  shellText(id: string, lines = 200): string {
    const f = this.facts.get(id);
    const p = this._pane(id);
    if (!f || !p) return '';
    const ps = `demo@hq:${home(p.foreground_cwd)}$ `;
    const out = f.out.slice(-lines).map((l) => (l.kind === 'cmd' ? ps + l.text : l.text));
    if (f.proc[0] === 'bash') out.push(ps);
    return out.join('\n');
  }

  /** mixed/crowd40: now and then an agent leaves and, a little later, a new one arrives in its workspace. */
  _scheduleComings(): void {
    const R = this._R;
    const loop = () => {
      const h = this.clock.setTimeout(() => {
        this._globalTimers.delete(h);
        const agents = this.raw.panes.filter((p) => p.agent && this.raw.focused_pane_id !== p.pane_id);
        if (agents.length > 2) {
          const p = R.pick(agents);
          const ws = p.workspace_id;
          const tabName = this.raw.tabs.find((t) => t.tab_id === p.tab_id)?._name ?? 'claude';
          this._removePane(p.pane_id);
          const h2 = this.clock.setTimeout(() => {
            this._globalTimers.delete(h2);
            if (!this._ws(ws)) return;
            const trust = R.chance(0.4); // a fresh folder: Claude Code asks "Do you trust the files in this folder?" first
            this._addPane({ kind: R.chance(0.08) ? 'codex' : 'claude', tab: tabName, status: trust ? 'blocked' : 'idle', trust }, ws);
          }, Math.round(R.range(20, 60) * S));
          this._globalTimers.add(h2);
        }
        loop();
      }, Math.round(R.range(4, 10) * MIN));
      this._globalTimers.add(h);
    };
    loop();
  }

  /** churn: panes appear/vanish every 1–2 s, offline flaps every 20 s, re-keyed restarts, workspace renames. */
  _startChurn(): void {
    const R = this._R;
    const base = this.raw.panes.length;
    const tick = () => {
      const h = this.clock.setTimeout(() => {
        this._globalTimers.delete(h);
        if (this.connected) {
          const n = this.raw.panes.length;
          if (n > Math.max(2, base - 4) && (n >= base + 4 || R.chance(0.5))) {
            const p = R.pick(this.raw.panes);
            this._removePane(p.pane_id);
          } else {
            const ws = this.raw.workspaces.length && R.chance(0.8) ? R.pick(this.raw.workspaces).workspace_id : this._addWorkspace(R.int(0, 11));
            this._addPane({ kind: R.chance(0.25) ? 'shell' : 'claude', tab: R.pick(['claude', 'dev', '#']), status: 'idle' }, ws);
          }
        }
        tick();
      }, Math.round(R.range(1, 2) * S));
      this._globalTimers.add(h);
    };
    tick();
    this._every(20 * S, () => this._flap(R.range(2, 5) * S));
    this._every(45 * S, () => this._restart());
    this._every(30 * S, () => {
      if (!this.raw.workspaces.length) return;
      const w = R.pick(this.raw.workspaces);
      w.label = R.pick(RENAMES) + (R.chance(0.3) ? `-${R.int(2, 9)}` : '');
      if (this.connected) this._emitSnapshot();
    });
  }

  /** herdr offline for `ms`, then back (reconnect grace). */
  _flap(ms: number): void {
    if (!this.connected) return;
    this.connected = false;
    this.emit('connected', false);
    const h = this.clock.setTimeout(() => {
      this._globalTimers.delete(h);
      this.connected = true;
      this.emit('connected', true);
      this.emit('reconnected', { grace: true });
      this._emitSnapshot();
    }, Math.round(ms));
    this._globalTimers.add(h);
  }

  /** herdr restart: pane ids re-keyed (new numbers), terminal ids + agent sessions kept (rekey). */
  _restart(): void {
    if (!this.connected) return;
    this.connected = false;
    this.emit('connected', false);
    const map = new Map<string, string>();
    for (const p of this.raw.panes) {
      const w = this._wsReq(p.workspace_id);
      map.set(p.pane_id, `${p.workspace_id}:p${++w._paneSeq}`);
    }
    const re = (id: string): string => map.get(id) ?? id;
    for (const p of this.raw.panes) p.pane_id = re(p.pane_id);
    for (const a of this.raw.agents) a.pane_id = re(a.pane_id);
    for (const l of this.raw.layouts) {
      for (const q of l.panes) q.pane_id = re(q.pane_id);
      l.focused_pane_id = l.focused_pane_id === null ? null : re(l.focused_pane_id);
    }
    this.raw.focused_pane_id = this.raw.focused_pane_id ? re(this.raw.focused_pane_id) : null;
    const facts = new Map<string, Facts>(), sims = new Map<string, Sim>();
    for (const [id, f] of this.facts) facts.set(re(id), f);
    for (const [id, s] of this.sims) {
      s.id = re(id);
      sims.set(s.id, s);
    }
    this.facts = facts;
    this.sims = sims;
    const h = this.clock.setTimeout(() => {
      this._globalTimers.delete(h);
      this.connected = true;
      this.emit('connected', true);
      this.emit('reconnected', { grace: true });
      this._emitSnapshot();
    }, 1500);
    this._globalTimers.add(h);
  }

  // ------------------------------------------------------------------------------------------
  // herdr request subset (demo list). Errors carry herdr's string `code`.

  _err(code: string, message?: string): Error & { code: string } {
    return Object.assign(new Error(message ?? code), { code });
  }
  _need(params: Record<string, unknown>, key = 'pane_id'): DemoPane {
    const id = params[key] ?? params.target ?? params.pane_id;
    const p = typeof id === 'string' ? this._pane(id) : null;
    if (!p) throw this._err('pane_not_found', `pane ${String(id)} not found`);
    return p;
  }

  override async request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.connected && method !== 'ping') throw this._err('server_not_running', 'demo herdr offline');
    switch (method) {
      case 'ping':
        if (!this.connected) throw this._err('server_not_running', 'demo herdr offline');
        return { type: 'pong', version: 'demo', protocol: 22, capabilities: {} };
      case 'session.snapshot':
        return { type: 'session_snapshot', snapshot: this.snapshot() };
      case 'pane.get': {
        const pane = clone(this._need(params));
        if (this.paneScroll) pane.scroll = { ...pane.scroll, offset_from_bottom: this.paneScroll(pane.pane_id) };
        return { type: 'pane_info', pane };
      }
      case 'pane.process_info': {
        const p = this._need(params);
        const f = this.facts.get(p.pane_id);
        const pid = 4000 + (Number(p.pane_id.split(':p')[1]) || 0) * 10;
        const argv = f?.proc ?? ['bash'];
        const shellPid = pid - 1;
        const fg = argv[0] === 'bash' ? shellPid : pid;
        return { type: 'pane_process_info', process_info: { pane_id: p.pane_id, shell_pid: shellPid, foreground_process_group_id: fg,
          foreground_processes: [{ pid: fg, name: (argv[0].split('/').pop() ?? '').slice(0, 15), argv: argv[0] === 'bash' ? ['/bin/bash'] : argv, cmdline: argv.join(' '), cwd: p.foreground_cwd }] } };
      }
      case 'pane.read': {
        const p = this._need(params);
        const f = this.facts.get(p.pane_id);
        const lines = typeof params.lines === 'number' ? params.lines : undefined;
        if (params.source === 'detection' && p.agent_status === 'blocked' && f?.prompt) {
          return { type: 'pane_read', read: { text: promptText(f.prompt), revision: p.revision, truncated: false } };
        }
        if (!p.agent && params.source === 'recent_unwrapped' && params.format !== 'ansi' && !this.paneTouched?.(p.pane_id)) {
          return { type: 'pane_read', read: { text: this.shellText(p.pane_id, lines ?? 200), revision: p.revision, truncated: false } };
        }
        if (this.paneReader) return { type: 'pane_read', read: { ...(await this.paneReader(p.pane_id, { source: str(params.source), format: str(params.format), lines })), truncated: false } };
        return { type: 'pane_read', read: { text: `${p.terminal_title_stripped}\n`, revision: p.revision, truncated: false } };
      }
      case 'pane.send_keys':
      case 'agent.send_keys':
        return this._keys(this._need(params), Array.isArray(params.keys) ? params.keys.filter((k): k is string => typeof k === 'string') : []);
      case 'agent.prompt': {
        const p = this._need(params);
        const sim = this.sims.get(p.pane_id);
        if (!p.agent || !sim) throw this._err('agent_not_found', `no agent in ${p.pane_id}`);
        if (p.agent_status === 'blocked') throw this._err('agent_blocked', 'agent is blocked');
        sim.frozen = false;
        this._prompt(sim, String(params.text ?? ''));
        return { type: 'ok' };
      }
      case 'pane.focus':
      case 'agent.focus': {
        const p = this._need(params);
        this._focus(p);
        const sim = this.sims.get(p.pane_id);
        if (sim && p.agent_status === 'idle' && !sim.turn && !sim.frozen && !sim.spec.queue && this.sc.schedule && sim.kind !== 'shell') {
          this._clearSim(sim);
          this._idle(sim);
        }
        return { type: 'ok' };
      }
      case 'agent.explain': {
        // herdr's real shape (agent, state, manifest_*, matched_rule, evaluated_rules[{id, matched, state, region,
        // priority, evidence:{region_preview}}]) so the "Why?" expander renders demo and live alike
        const p = this._need(params);
        if (!p.agent) throw this._err('agent_not_found', `no agent in ${p.pane_id}`);
        const f = this.facts.get(p.pane_id);
        const RULES: Record<Status, [string, string, number]> = { working: ['osc_title_working', 'osc_title', 1100], blocked: ['live_blocked_form', 'after_last_horizontal_rule', 980],
          done: ['turn_finished_unseen', 'osc_title', 900], idle: ['live_turn_idle', 'bottom_non_empty_lines(12)', 800], unknown: ['no_match', 'screen', 0] };
        const [id, region, priority] = RULES[p.agent_status] ?? RULES.unknown;
        const preview = p.agent_status === 'blocked' && f?.prompt ? promptText(f.prompt).slice(0, 400) : p.terminal_title;
        const rule = { id, matched: p.agent_status !== 'unknown', state: p.agent_status, region, priority, evidence: { region_preview: preview, region_bytes: preview.length } };
        return { type: 'agent_explain', explain: { agent: p.agent, state: p.agent_status, manifest_source: `demo:${this.scenarioName}`, manifest_version: 'demo',
          matched_rule: rule.matched ? { id, priority, region, state: p.agent_status } : null, evaluated_rules: [rule], fallback_reason: null,
          visible_blocker: p.agent_status === 'blocked', visible_working: p.agent_status === 'working', visible_idle: p.agent_status === 'idle', warning: null } };
      }
      case 'pane.close': {
        const p = this._need(params);
        this._removePane(p.pane_id);
        return { type: 'ok' };
      }
      case 'workspace.create': {
        const k = this._R.int(0, WORKSPACES.length - 1);
        const cwd = str(params.cwd);
        const ws = this._addWorkspace(k, str(params.label));
        if (cwd) this._wsReq(ws)._cwd = cwd;
        const id = this._addPane({ kind: 'shell', tab: '#', proc: ['bash'], cwd }, ws);
        return { type: 'workspace_created', workspace: clone(this._ws(ws)), root_pane: clone(this._pane(id)) };
      }
      case 'tab.create': {
        const wid = str(params.workspace_id) ?? str(params.workspace);
        const w = wid ? this._ws(wid) : null;
        if (!w) throw this._err('workspace_not_found', 'workspace not found');
        const id = this._addPane({ kind: 'shell', tab: str(params.label) ?? '#', proc: ['bash'], cwd: str(params.cwd) }, w.workspace_id);
        return { type: 'tab_created', tab: clone(this.raw.tabs.find((t) => t.tab_id === this._paneReq(id).tab_id)), root_pane: clone(this._pane(id)) };
      }
      case 'pane.split': {
        const p = this._need(params);
        const t = this.raw.tabs.find((x) => x.tab_id === p.tab_id);
        const id = this._addPane({ kind: 'shell', tab: t?._name ?? '#', proc: ['bash'], cwd: p.cwd }, p.workspace_id);
        return { type: 'pane_created', pane: clone(this._pane(id)) };
      }
      case 'agent.start': {
        const p = this._need(params, 'pane_id');
        const kind = params.kind === 'codex' ? 'codex' : 'claude';
        const t = this.raw.tabs.find((x) => x.tab_id === p.tab_id);
        const ws = p.workspace_id;
        // herdr starts the agent in the pane's place; removing the only pane of a brand-new
        // workspace (hire → "new workspace") dropped the workspace too and _addPane crashed (`_tabSeq` of null)
        const wsObj = this._ws(ws);
        this._removePane(p.pane_id, { silent: true });
        if (wsObj && !this._ws(ws)) this.raw.workspaces.push(wsObj);
        const id = this._addPane({ kind, tab: t?._name ?? 'claude', status: 'idle', name: str(params.name) ?? null, cwd: p.cwd, fresh: true }, ws);
        return { type: 'agent_started', agent: clone(this._agent(id)) };
      }
      default:
        throw this._err('not_implemented', `demo: ${method} not implemented`);
    }
  }

  _keys(p: DemoPane, keys: string[]): { type: 'ok' } {
    const f = this.facts.get(p.pane_id);
    const sim = this.sims.get(p.pane_id);
    if (p.agent_status !== 'blocked' || !f?.prompt || !sim) return { type: 'ok' };
    const pr = f.prompt;
    for (const k of keys) {
      if (k === 'Down') pr.selected = Math.min(pr.labels.length - 1, pr.selected + 1);
      else if (k === 'Up') pr.selected = Math.max(0, pr.selected - 1);
      else if (/^[1-9]$/.test(k) && pr.numbered && Number(k) <= pr.labels.length) {
        this._answered(sim, Number(k) - 1);
        return { type: 'ok' };
      } else if (k === 'Enter') {
        this._answered(sim, pr.selected);
        return { type: 'ok' };
      } else if (k === 'Escape') {
        this._answered(sim, pr.labels.length - 1);
        return { type: 'ok' };
      } else if (k.length === 1 || k === 'Space') pr.typed = (pr.typed + (k === 'Space' ? ' ' : k)).slice(-200);
      else if (k === 'Backspace') pr.typed = pr.typed.slice(0, -1);
    }
    p.revision++;
    this._facts(p.pane_id);
    return { type: 'ok' };
  }

  // ------------------------------------------------------------------------------------------
  // demo.force

  /**
   * `demo.force {id, patch}`: `status`/`name`/`kind` go to the raw pane; demo/procinfo-owned fields go to facts.
   * The pane's schedule stops (frozen) so the forced state holds; `agent.prompt` unfreezes it.
   */
  force(id: string, patch: Record<string, unknown>): void {
    const p = this._pane(id);
    if (!p) throw this._err('pane_not_found', `pane ${id} not found`);
    const allowed = new Set<string>([...FIELD_OWNERS.demo, 'process', 'status', 'name', 'kind']);
    const bad = Object.keys(patch).filter((k) => !allowed.has(k));
    if (bad.length) throw this._err('bad_patch', `demo.force: unsupported fields ${bad.join(',')}`);
    const sim = this.sims.get(id);
    if (sim) {
      this._clearSim(sim);
      sim.frozen = true;
      sim.turn = null;
    }
    const f = this._fact(id);
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'status' || k === 'name' || k === 'kind') continue;
      if (k === 'activity') {
        const a = isRecord(v) ? v : null;
        this._setActivity(f, a ? { tool: str(a.tool) ?? null, cls: isToolClass(a.cls) ? a.cls : null, detail: str(a.detail) ?? '' } : null);
      } else if (k === 'process') f.proc = isRecord(v) && v.argv ? String(v.argv).split(/\s+/) : ['bash'];
      else if (k === 'git') this._gitSet(p.workspace_id, isRecord(v) ? clone(v) as unknown as GitInfo : null); // the workspace's repo (its panes share it)
      else Object.assign(f, { [k]: clone(v) }); // any other demo-owned field: the caller (demo.force) is trusted to send the right shape
      if (k === 'model') f.modelTier = modelTier(typeof v === 'string' ? v : null);
    }
    const pk = patch.kind;
    if (isKind(pk) && pk !== f.kind) {
      f.kind = pk;
      if (sim) sim.kind = pk;
      if (pk === 'shell') {
        delete p.agent;
        delete p.agent_session;
        this.raw.agents = this.raw.agents.filter((a) => a.pane_id !== id);
        p.agent_status = 'unknown';
        f.proc = ['bash'];
      } else {
        p.agent = pk;
        p.agent_session ??= { source: `herdr:${pk}`, agent: pk, kind: 'id', value: uuidOf(p.terminal_id) };
        let a = this._agent(id);
        if (a) a.agent = pk;
        else {
          a = { pane_id: id, terminal_id: p.terminal_id, workspace_id: p.workspace_id, tab_id: p.tab_id, agent: pk,
            agent_status: p.agent_status === 'unknown' ? 'idle' : p.agent_status, agent_session: p.agent_session, cwd: p.cwd, foreground_cwd: p.foreground_cwd, state_change_seq: 1 };
          this.raw.agents.push(a);
        }
        p.agent_status = a.agent_status;
        f.proc = [pk];
      }
    }
    if (typeof patch.name === 'string') {
      const a = this._agent(id);
      if (a) a.name = patch.name;
    }
    const ps = patch.status;
    if (isStatus(ps) && ps !== p.agent_status) {
      if (ps === 'blocked' && !f.prompt) f.prompt = { ...randomPrompt(this._R, p.cwd), selected: 0, typed: '' };
      this.setStatus(id, ps);
    } else {
      p.revision++;
      this._title(id);
      this._rollup();
      this._emitSnapshot();
    }
    this._facts(id);
  }
}

/** Claude Code-style prompt text as `pane.read {source:'detection'}` returns it (the real parser runs on it). */
export function promptText(pr: DemoPrompt): string {
  const lines = ['╭' + '─'.repeat(78) + '╮', ...pr.lines, ''];
  pr.labels.forEach((l, i) => {
    const cur = i === pr.selected ? '❯' : ' ';
    lines.push(pr.numbered ? ` ${cur} ${i + 1}. ${l}` : ` ${cur} ${l}`);
  });
  if (pr.shape === 'free' && pr.typed) lines.push('', `   > ${pr.typed}`);
  lines.push('╰' + '─'.repeat(78) + '╯');
  if (pr.footer) lines.push(pr.footer);
  return lines.join('\n');
}

// ------------------------------------------------------------------------------------------------

/**
 * DemoEnricher (owner `demo` = the transcripts + subagents rows): patches the schedule's facts and re-emits its
 * events through `emitEvent`. Reacts in update(): status ≠ working → activity null (or `ask` for a pending question),
 * struggle null. Non-Claude agents are herdr-status-only, like live.
 */
export class DemoEnricher extends Enricher {
  world: DemoWorld;
  _bases: Map<string, BaseEntity>;
  _sent: Map<string, string>;
  /** last struggle level per pane (event on change) */
  _level: Map<string, number>;
  _onFacts: (id: string) => void;
  _onEvent: (id: string, kind: EventKind, detail: unknown) => void;
  constructor(world: DemoWorld) {
    super('demo');
    this.world = world;
    this._bases = new Map();
    this._sent = new Map();
    this._level = new Map();
    this._onFacts = (id) => {
      const b = this._bases.get(id);
      if (b) this._refresh(id, b);
    };
    this._onEvent = (id, kind, detail) => {
      const b = this._bases.get(id);
      if (b?.kind && mayEmit('demo', kind, b.kind)) this.emitEvent(id, kind, detail);
    };
    world.on('facts', this._onFacts);
    world.on('demo-event', this._onEvent);
  }

  override attach(id: string, base: BaseEntity): void {
    this._bases.set(id, base);
    this._refresh(id, base);
  }
  override update(id: string, base: BaseEntity): void {
    this._bases.set(id, base);
    this._refresh(id, base);
  }
  override detach(id: string): void {
    this._bases.delete(id);
    this._sent.delete(id);
    this._level.delete(id);
  }
  override async close(): Promise<void> {
    this.world.off('facts', this._onFacts);
    this.world.off('demo-event', this._onEvent);
    this._bases.clear();
    this._sent.clear();
    this._level.clear();
  }
  metrics(): { panes: number } {
    return { panes: this._bases.size };
  }

  _refresh(id: string, base: BaseEntity): void {
    const f = this.world.facts.get(id);
    let patch: Partial<Entity>;
    if (!f || base.kind !== 'claude') {
      patch = { title: null, activity: null, model: null, modelTier: null, contextTokens: null, outputTokens: null, todos: null,
        lastPrompt: null, struggle: null, subagents: [], lastText: null, work: null, usage: null, git: this._gitOf(id) };
    } else {
      const working = base.status === 'working';
      let activity: Activity | null = null;
      if (working && f.activity) activity = { ...f.activity, since: f.activitySince };
      else if (base.status === 'blocked' && f.askActivity) {
        activity = { tool: 'AskUserQuestion', cls: 'ask', detail: f.prompt?.lines?.at(-1)?.trim().slice(0, 60) ?? '', since: base.statusSince ?? this.world.clock.now() };
      }
      patch = {
        title: f.title, activity, model: f.model, modelTier: f.modelTier, contextTokens: f.contextTokens, outputTokens: f.outputTokens,
        todos: f.todos, lastPrompt: f.lastPrompt, struggle: working ? f.struggle : null, subagents: f.subagents,
        lastText: f.lastText, work: f.work, usage: f.usage, git: this._gitOf(id),
      };
    }
    const j = JSON.stringify(patch);
    if (this._sent.get(id) === j) return;
    this._sent.set(id, j);
    this.onPatch(id, patch);
    // `struggle` event on every level change, like the live transcripts enricher (incl. the level-0 clear)
    const level = patch.struggle?.level ?? 0;
    if (level !== (this._level.get(id) ?? 0)) {
      this._level.set(id, level);
      if (base.kind === 'claude') this.emitEvent(id, 'struggle', { level, reason: patch.struggle?.reason ?? null, detail: patch.struggle?.detail ?? null });
    }
  }

  /** The pane's workspace repo (demo git, rev 2). */
  _gitOf(id: string): GitInfo | null {
    const ws = this.world._pane(id)?.workspace_id;
    return (ws ? this.world.gits.get(ws) : null) ?? null;
  }

  /** `demo.event {id, kind}` for kinds this owner may emit (actions.ts). */
  fire(id: string, kind: EventKind, detail?: unknown): boolean {
    const b = this._bases.get(id);
    if (!b?.kind || !mayEmit('demo', kind, b.kind)) return false;
    this.emitEvent(id, kind, detail);
    return true;
  }
}

/**
 * Wire-up helper (app.ts): DemoWorld + DemoEnricher + the real ProcInfoEnricher (polls the demo's `pane.process_info`).
 * blocked/acks are added by the caller. Call `source.start()` after the WorldModel is constructed.
 */
export function createDemo({ clock, n = 12, seed = 1, scenario = 'mixed', log }: DemoWorldOpts & { log?: Logger & { child?: (scope: string) => Logger } }): { source: DemoWorld; demo: DemoEnricher; enrichers: Enricher[] } {
  const source = new DemoWorld({ clock, n, seed, scenario, log });
  const demo = new DemoEnricher(source);
  const procinfo = new ProcInfoEnricher({ source, clock, log: log?.child?.('procinfo') });
  return { source, demo, enrichers: [demo, procinfo] };
}

/** A demo workspace's git history for `git.diff`: HEADs oldest first, and every edit with the index of the HEAD it landed on. */
export interface DemoEdits { heads: string[]; log: { head: number; file: string; added: number; removed: number; created: boolean }[] }

const PATCH_ADD = ['  const next = settle(prev, now);', '  if (!next) return null;', '  // keep the order stable for the HUD', '  out.push({ id, at: now, ...patch });',
  '  return list.filter((x) => x.live);', '  for (const r of rows) total += r.n;', "  log.debug(`sweep ${n} roots`);", '  await queue.flush();', '  cache.delete(key);', '  return { ok: true, value };'];
const PATCH_DEL = ['  const next = prev;', '  // TODO: remove once the race is fixed', '  return list;', '  total = rows.length;', '  await sleep(50);'];
/** A made-up but plausible unified diff for one demo file (deterministic per file and range; ≤ ~60 lines). */
export function demoPatch(f: DiffFile, key: string): string {
  const R = rng(`patch:${key}:${f.path}`);
  const add = Math.min(f.added ?? 0, 40), del = Math.min(f.removed ?? 0, 16);
  const lines: string[] = [`diff --git a/${f.path} b/${f.path}`];
  if (f.status === 'A' || f.status === '?') lines.push('new file mode 100644', '--- /dev/null', `+++ b/${f.path}`, `@@ -0,0 +1,${f.added} @@`);
  else lines.push(`index ${hashHex(`${key}a`).slice(0, 7)}..${hashHex(`${key}b`).slice(0, 7)} 100644`, `--- a/${f.path}`, `+++ b/${f.path}`);
  let left = add, gone = del, at = R.int(8, 120);
  while (left > 0 || gone > 0) {
    const a = Math.min(left, R.int(1, 8)), d = Math.min(gone, R.int(0, 4));
    if (f.status !== 'A' && f.status !== '?') lines.push(`@@ -${at},${d + 3} +${at},${a + 3} @@ export function ${R.pick(['tick', 'render', 'sweep', 'apply', 'load'])}(`);
    if (f.status !== 'A' && f.status !== '?') lines.push(`   ${R.pick(['const now = clock.now();', 'if (!state) return;', 'let n = 0;'])}`);
    for (let i = 0; i < d; i++) lines.push(`-${R.pick(PATCH_DEL)}`);
    for (let i = 0; i < a; i++) lines.push(`+${R.pick(PATCH_ADD)}`);
    if (f.status !== 'A' && f.status !== '?') lines.push(`   ${R.pick(['}', 'return out;', '// …'])}`);
    left -= a; gone -= d; at += R.int(12, 60);
    if (!a && !d) break;
  }
  if ((f.added ?? 0) > add || (f.removed ?? 0) > del) lines.push(`@@ … ${(f.added ?? 0) - add + (f.removed ?? 0) - del} more lines in this demo file @@`);
  return `${lines.join('\n')}\n`;
}
