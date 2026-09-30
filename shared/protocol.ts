// @pure
/**
 * Claude HQ wire protocol (DESIGN §3, §4.0, §4.11). The single contract between server/ and renderer/.
 * Owner: LEAD. Pure: no three, no node built-ins (TextEncoder/TextDecoder are web-standard globals).
 *
 * Changing anything here = editing DESIGN.md in the same commit. Add optional fields; never break shapes.
 */
import { isRecord } from './guards.ts';


export const PROTOCOL_VERSION = 1;
export const WS_PATH = '/ws';

// ---------------------------------------------------------------------------------------------
// Enumerations

export const STATUSES = Object.freeze(['idle', 'working', 'blocked', 'done', 'unknown'] as const);
export type Status = (typeof STATUSES)[number];

export const KINDS = Object.freeze(['claude', 'codex', 'gemini', 'agent', 'shell'] as const);
export type Kind = (typeof KINDS)[number];

export const TOOL_CLASSES = Object.freeze([
  'edit', 'write', 'read', 'search', 'bash', 'test', 'build', 'git', 'net', 'web', 'task', 'todo', 'mcp', 'ask',
  'think', 'talk', 'compact', 'other',
] as const);
export type ToolClass = (typeof TOOL_CLASSES)[number];

export const SHELL_ACTIVITIES = Object.freeze(['prompt', 'edit', 'test', 'serve', 'monitor', 'remote', 'repl', 'git', 'build', 'run'] as const);
export type ShellActivity = (typeof SHELL_ACTIVITIES)[number];

export const MODEL_TIERS = Object.freeze(['opus', 'sonnet', 'haiku', 'other'] as const);
export type ModelTier = (typeof MODEL_TIERS)[number];

/** One-shot `event` kinds (§3.3). */
export const EVENT_KINDS = Object.freeze([
  'arrived', 'left', 'blocked', 'unblocked', 'finished', 'error', 'test-pass', 'test-fail', 'commit',
  'subagent-spawned', 'subagent-done', 'compact', 'tool', 'acked', 'struggle', 'news',
] as const);
export type EventKind = (typeof EVENT_KINDS)[number];

/** Drawer lifecycle states carried by `term.state` (§3.3, §8.4). */
export const TERM_STATES = Object.freeze([
  'connecting', 'live', 'busy', 'taken', 'gone', 'offline', 'reconnecting', 'released', 'error', 'readonly',
] as const);
export type TermState = (typeof TERM_STATES)[number];
export const TERM_MODES = Object.freeze(['observe', 'control'] as const);
export type TermMode = (typeof TERM_MODES)[number];
export const GONE_REASONS = Object.freeze(['closed', 'exited', 'rekeyed'] as const);
export type GoneReason = (typeof GONE_REASONS)[number];
export const TOAST_LEVELS = Object.freeze(['info', 'warn', 'error'] as const);
export type ToastLevel = (typeof TOAST_LEVELS)[number];

/** Error codes used in `reply {ok:false, error}` and elsewhere. */
export const ERR = Object.freeze({
  BAD_MESSAGE: 'bad_message',
  UNKNOWN_ENTITY: 'unknown_entity',
  NOT_CONTROLLER: 'not_controller',
  PROMPT_CHANGED: 'prompt_changed',
  NOT_ACCEPTED: 'not_accepted',
  TERMINAL_LIMIT: 'terminal_limit',
  READONLY_PROTOCOL: 'readonly_protocol',
  MUTATIONS_DISABLED: 'mutations_disabled',
  NOT_DEMO: 'not_demo',
  HERDR_OFFLINE: 'herdr_offline',
  NO_HELLO_ACK: 'no_hello_ack',
  PROTOCOL_MISMATCH: 'protocol_mismatch',
  INTERNAL: 'internal',
});

export type ErrorCode = (typeof ERR)[keyof typeof ERR];

/** WebSocket close codes (§4.7, §4.11). */
export const CLOSE = Object.freeze({ POLICY: 1008, TRY_AGAIN_LATER: 1013 });

// ---------------------------------------------------------------------------------------------
// Message type constants

/** Server → renderer `t` values (§3.3). Binary `term.data` has no `t`. */
export const S2R = Object.freeze({
  HELLO: 'hello',
  WORLD: 'world',
  ENTITY: 'entity',
  GONE: 'gone',
  WORKSPACES: 'workspaces',
  EVENT: 'event',
  STATS: 'stats',
  HERDR: 'herdr',
  SCREEN: 'screen',
  TERM_STATE: 'term.state',
  TERM_ACK: 'term.ack',
  TOAST: 'toast',
  TIMELINE: 'timeline',
  REPLY: 'reply',
});
export type ServerMsgType = (typeof S2R)[keyof typeof S2R];

/** Renderer → server `t` values (§3.4). Binary `term.input` has no `t`. */
export const R2S = Object.freeze({
  HELLO_ACK: 'hello.ack',
  TERM_OPEN: 'term.open',
  TERM_PROMOTE: 'term.promote',
  TERM_INPUT: 'term.input', // JSON text form (tests/tools); the renderer uses the binary frame
  TERM_WRITER: 'term.writer',
  TERM_FIT: 'term.fit',
  TERM_RESIZE: 'term.resize',
  TERM_PAUSE: 'term.pause',
  TERM_RESUME: 'term.resume',
  TERM_HISTORY: 'term.history',
  TERM_SCROLL: 'term.scroll',
  TERM_COPY_RECENT: 'term.copyRecent',
  TERM_CLOSE: 'term.close',
  SCREEN_WATCH: 'screen.watch',
  DONE_ACK: 'done.ack',
  HERDR_FOCUS: 'herdr.focus',
  AGENT_PROMPT: 'agent.prompt',
  AGENT_ANSWER: 'agent.answer',
  AGENT_KEYS: 'agent.keys',
  AGENT_EXPLAIN: 'agent.explain',
  SPAWN: 'spawn',
  PANE_CLOSE: 'pane.close',
  SETTINGS_SET: 'settings.set',
  WORLD_GET: 'world.get',
  TIMELINE_GET: 'timeline.get',
  NOTE_SET: 'note.set',
  DEMO_FORCE: 'demo.force',
  DEMO_SCENARIO: 'demo.scenario',
  DEMO_EVENT: 'demo.event',
});
export type ClientMsgType = (typeof R2S)[keyof typeof R2S];

export type ActionClass = 'always' | 'explicit' | 'interact' | 'structural' | 'demo';

/**
 * Action class per renderer→server `t` (§4.8 safety gate). `actions.ts` gates on this;
 * `herdr/client.ts` independently enforces its method allowlist.
 */
export const ACTION_CLASS: Readonly<Record<ClientMsgType, ActionClass>> = Object.freeze({
  'hello.ack': 'always',
  'term.open': 'always',
  'term.promote': 'always',
  'term.input': 'always',
  'term.writer': 'always',
  'term.fit': 'always',
  'term.resize': 'always', // control writer only (hub)
  'term.pause': 'always',
  'term.resume': 'always',
  'term.history': 'always',
  'term.scroll': 'always', // control writer only + scrollMode:'herdr' (hub)
  'term.copyRecent': 'always',
  'term.close': 'always',
  'screen.watch': 'always',
  'done.ack': 'always',
  'agent.explain': 'always',
  'settings.set': 'always',
  'world.get': 'always',
  'timeline.get': 'always',
  'note.set': 'always',
  'herdr.focus': 'explicit',
  'agent.prompt': 'interact',
  'agent.answer': 'interact',
  'agent.keys': 'interact',
  spawn: 'structural',
  'pane.close': 'structural',
  'demo.force': 'demo',
  'demo.scenario': 'demo',
  'demo.event': 'demo',
});

// ---------------------------------------------------------------------------------------------
// Limits (§3.4, §4.7, §4.8, §4.11). `hello.limits` = DEFAULT_LIMITS unless the server overrides.

export const LIMITS = Object.freeze({
  maxTextFrame: 64 * 1024, // bigger text frame → close 1008
  invalidBurst: 20, // > 20 invalid messages …
  invalidWindowMs: 10_000, // … in 10 s → close 1008
  termInputMax: 16 * 1024, // per message (text or binary payload)
  interactiveMax: 4 * 1024, // a single onData above this goes the paste path
  pasteChunk: 16 * 1024,
  creditWindow: 64 * 1024, // un-acked interactive bytes per (client, pane)
  ackEveryMs: 50,
  ackEveryBytes: 16 * 1024,
  textMax: 8 * 1024, // agent.prompt etc.
  keysMax: 16,
  keyLenMax: 16,
  idMax: 64,
  labelMax: 64,
  cwdMax: 1024,
  noteMax: 280,
  settingsPatchMax: 4 * 1024,
  historyLinesMax: 5000,
  watchMax: 8, // M3.5 LEAD: 6 → 8 for the monitor atlas (8 nearest live desks, §5.3)
  watchUnionMax: 16,
  cols: Object.freeze([10, 500] as const),
  rows: Object.freeze([4, 200] as const),
  wsClients: 8,
  viewersPerClient: 6,
  childrenPerBackend: 16,
  spawnsPerSec: 4,
  respawnPerPaneMs: 2000,
  pausedDropMs: 60_000,
  graceMs: 10_000, // WS drop terminal resume grace
  bufferedHigh: 1024 * 1024,
  bufferedLow: 256 * 1024,
  entityCoalesceMs: 50,
  timelineMax: 2000,
});

/** The subset sent to renderers in `hello.limits`. */
export type HelloLimits = Pick<typeof LIMITS, 'wsClients' | 'viewersPerClient' | 'childrenPerBackend' | 'termInputMax' |
  'interactiveMax' | 'pasteChunk' | 'creditWindow' | 'historyLinesMax' | 'watchMax' | 'noteMax'>;
export const DEFAULT_LIMITS: Readonly<HelloLimits> = Object.freeze({
  wsClients: LIMITS.wsClients,
  viewersPerClient: LIMITS.viewersPerClient,
  childrenPerBackend: LIMITS.childrenPerBackend,
  termInputMax: LIMITS.termInputMax,
  interactiveMax: LIMITS.interactiveMax,
  pasteChunk: LIMITS.pasteChunk,
  creditWindow: LIMITS.creditWindow,
  historyLinesMax: LIMITS.historyLinesMax,
  watchMax: LIMITS.watchMax,
  noteMax: LIMITS.noteMax,
});

// ---------------------------------------------------------------------------------------------
// Settings (§8 settings panel). `settings.set {patch}` keys must be in SETTINGS_KEYS.

/** Persisted user settings (the `settings.set` patch keys and the `hello.settings` value). */
export interface Settings {
  volumeMaster: number;
  volumeSfx: number;
  volumeAmbient: number;
  volumeNotify: number;
  volumeVoices: number;
  audioMuted: boolean;
  quality: 'auto' | 'low' | 'medium' | 'high' | 'photo';
  /** 55–75 */
  fov: number;
  quickAnswer: boolean;
  autoAckOnOpen: boolean;
  pasteConfirmLines: number;
  copyOnSelect: boolean;
  termFontPx: number;
  scrollMode: 'local' | 'herdr';
  leaderKey: string;
  /** server-side */
  allowMutations: boolean;
  reducedMotion: boolean;
  headBob: boolean;
  /** 0 = off */
  awayRecapMin: number;
  peekCtrlCConfirm: boolean;
  /** §4.7 release control after 10 min idle */
  idleDemotion: boolean;
  /** §8.2.2 */
  platform: 'auto' | 'mac' | 'other';
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  volumeMaster: 0.8,
  volumeSfx: 0.8,
  volumeAmbient: 0.5,
  volumeNotify: 0.9, // [AUD M3] blocked/done chimes + dings (GP §5.4 per-category volume)
  volumeVoices: 0.7, // [AUD M3] Clawd vocal blips
  audioMuted: false, // [AUD M3] mute toggle (GP §5.4)
  quality: 'auto',
  fov: 60,
  quickAnswer: false,
  autoAckOnOpen: true,
  pasteConfirmLines: 5,
  copyOnSelect: true,
  termFontPx: 14,
  scrollMode: 'local',
  leaderKey: 'Ctrl+`',
  allowMutations: false, // server-side
  reducedMotion: false,
  headBob: true,
  awayRecapMin: 10, // 0 = off
  peekCtrlCConfirm: true,
  idleDemotion: true, // §4.7 release control after 10 min idle
  platform: 'auto',
});
// Object.keys() is string[]; the keys of a frozen Settings literal are exactly keyof Settings.
export const SETTINGS_KEYS: readonly (keyof Settings)[] = Object.freeze(Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]);

// ---------------------------------------------------------------------------------------------
// Wire types (§3.1–3.3)

/** place = `${ws.label}/${tab.label}/${paneIndex}/${cwd}`; match order terminalId → agentSession → place. */
export interface Identity { terminalId: string | null; agentSession: string | null; place: string }
export interface EntityWorkspace { id: string; label: string; number: number; colorIndex: number; cycle: number; slot: number; status: Status }
export interface EntityTab { id: string; label: string; number: number; index: number }
export interface Activity {
  tool: string | null;
  cls: ToolClass | null;
  detail: string;
  since: number;
  /**
   * (M4 LEAD) labels of subagents running under a long Task/Agent/Workflow tool (≤ 4, e.g. 'ideate:daily'); the
   * activity stays non-null for the whole run of such a tool (sidechain transcripts count as progress)
   */
  subs?: string[];
}
export interface Subagent { id: string; type: string; label: string; active: boolean }
export interface Todo { content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm: string }
export interface Struggle {
  level: 0 | 1 | 2 | 3;
  reason: 'fails' | 'errors' | 'noEdits' | 'context';
  /** short human reason line, e.g. '3 test fails in a row' (M3.5 LEAD) */
  detail?: string;
}
/** current task (since the latest real user prompt): start time ms epoch + line/file counts from Edit/MultiEdit/Write tool inputs (M3.5 LEAD) */
export interface WorkStats { since: number; added: number; removed: number; files: number }
export interface PromptOption { key: string; label: string; index: number }
/**
 * (M4 LEAD; BE blocked.ts) what a permission prompt approves: tool 'Bash'|'Edit'|'Write'|'WebFetch'|'Workflow'|'MCP'|'Trust'|…,
 * arg = command / path / host / name (≤ 120 chars), detail e.g. '+12 −3', scope = the "don't ask again for ___" text of the
 * always-option
 */
export interface PromptSubject { tool: string; arg: string; detail?: string; scope?: string }
export interface Prompt {
  question: string;
  options: PromptOption[];
  selected: number;
  numbered: boolean;
  hash: string;
  raw: string;
  subject?: PromptSubject | null;
}
/**
 * (M4 LEAD; BE2 procinfo) since = foreground command start (ms epoch); lastLine = last non-blank output line (≤ 120,
 * ANSI-stripped, from read-only pane.read); exit = last finished command's code (+ '3 failed' summary); ports = TCP
 * listen ports owned by the foreground process tree
 */
export interface ProcessInfo {
  name: string;
  argv: string;
  activity: ShellActivity;
  since?: number;
  lastLine?: string | null;
  exit?: { code: number; at: number; summary?: string } | null;
  ports?: number[];
}
export interface Ack { at: number; by: 'hq' }
/** Sticky note (§8.10), `Entity.note`. */
export interface Note { text: string; at: number }

/** One per herdr pane; key = pane_id (§3.1). */
export interface Entity {
  /** pane_id ('w1:p3'; demo 'd1:p3') */
  id: string;
  /** herdr terminal_id; null when herdr reports none */
  terminalId: string | null;
  kind: Kind;
  name: string;
  seedKey: string;
  status: Status;
  /** ms epoch, server clock */
  statusSince: number;
  statusSinceApprox: boolean;
  identity: Identity;
  stateSeq: number | null;
  ack: Ack | null;
  layoutRect: { cols: number; rows: number } | null;
  workspace: EntityWorkspace;
  tab: EntityTab;
  paneIndex: number;
  cwd: string;
  project: string;
  repo: string | null;
  /** herdr `terminal_title_stripped` (every pane; base-owned; null if empty) */
  baseTitle: string | null;
  /** agent task title (transcripts ai-title / demo); null for shells. Display via taskLabel() */
  title: string | null;
  focused: boolean;
  activity: Activity | null;
  model: string | null;
  modelTier: ModelTier | null;
  contextTokens: number | null;
  outputTokens: number | null;
  /** max 8 */
  subagents: Subagent[];
  todos: Todo[] | null;
  struggle: Struggle | null;
  lastPrompt: string | null;
  /** last assistant text block, whitespace-collapsed, ≤ 280 chars (M3.5 LEAD; BE2) */
  lastText: string | null;
  /** current-task counters (M3.5 LEAD; BE2) */
  work: WorkStats | null;
  /** only while blocked */
  prompt: Prompt | null;
  process: ProcessInfo | null;
  /** M4 */
  res: { cpu: number; rssMB: number } | null;
  note: Note | null;
}

export interface WorkspaceTab { id: string; label: string; number: number; status: Status }
export interface Workspace {
  id: string;
  label: string;
  number: number;
  colorIndex: number;
  cycle: number;
  slot: number;
  status: Status;
  focused: boolean;
  paneCount: number;
  tabs: WorkspaceTab[];
}

/** Stats (§3.2), 1 Hz; `disks` every 30 s. */
export interface Stats {
  at: number;
  host: string;
  uptime: number;
  cpu: { total: number; cores: number[]; load: number[]; freqMHz: number; /** null: no /proc/pressure on this kernel */ psi: { cpu: number | null; mem: number | null; io: number | null } };
  mem: { total: number; used: number; cache: number; swapTotal: number; swapUsed: number };
  disks: { mount: string; fs: string; total: number; used: number }[];
  io: { readBps: number; writeBps: number };
  gpu: { busy: number; vramUsed: number; vramTotal: number; gttUsed: number; gttTotal: number; clockMHz: number; powerW: number; tempC: number } | null;
  temps: { cpu: number | null; nvme: number | null; wifi: number | null; gpu: number | null };
  net: { rxBps: number; txBps: number; ifaces: string[] };
}

// ---- server → renderer (JSON text frames, discriminated on `t`)

export const SCENARIOS: readonly string[] = Object.freeze(['mixed', 'allStates', 'crowd40', 'trio', 'longIdle', 'queue', 'churn', 'empty', 'offline']);

/** Active simulated world; absent for live sources and recordings, including demo recordings. */
export interface DemoConfig {
  scenario: string;
  /** Unsigned 32-bit seed used to build and schedule the simulation. */
  seed: number;
  /** Configured population; fixed-size scenarios may override it. */
  population: number;
}

export interface Hello {
  t: 'hello';
  protocol: number;
  serverNow: number;
  session: string;
  instanceId: string;
  demo: boolean | number;
  demoConfig?: DemoConfig;
  timescale: number;
  herdr: { connected: boolean; protocol: number | null; readOnly: boolean };
  /** authoritative "structural actions (spawn, pane.close) allowed": the UI gates on this */
  allowMutations: boolean;
  /** the session resolves (by realpath) to herdr's default socket (BE, app.ts) */
  defaultSession?: boolean;
  settings: Settings;
  statsHistory: Stats[];
  limits: HelloLimits;
}
export interface WorldMsg { t: 'world'; entities: Entity[]; workspaces: Workspace[]; focusedPaneId: string | null }
export interface EntityMsg { t: 'entity'; entity: Entity }
export interface GoneMsg { t: 'gone'; id: string; reason: GoneReason; newId?: string }
export interface WorkspacesMsg { t: 'workspaces'; workspaces: Workspace[]; focusedPaneId: string | null }
/** `detail` depends on `kind` (e.g. news: {src, msgs, edits} | {src, lines}); narrow before use. */
export interface EventMsg { t: 'event'; id: string; kind: EventKind; detail?: unknown }
export interface StatsMsg { t: 'stats'; stats: Stats }
export interface HerdrMsg { t: 'herdr'; connected: boolean; retryInMs?: number; reconnecting?: boolean }
export interface ScreenMsg { t: 'screen'; id: string; lines: string[]; cols: number; rows: number; ansi?: boolean }
export interface TermStateMsg {
  t: 'term.state';
  id: string;
  state: TermState;
  mode: TermMode;
  cols: number;
  rows: number;
  writer: boolean;
  sizer: boolean;
  detail?: string;
}
export interface TermAckMsg { t: 'term.ack'; id: string; upTo: number }
export interface ToastMsg { t: 'toast'; level: ToastLevel; text: string }
export interface TimelineItem {
  at: number;
  id: string;
  /** null when the model no longer knew the pane */
  identity: Identity | null;
  kind: 'status' | EventKind;
  from?: Status;
  to?: Status;
  detail?: unknown;
}
export interface TimelineMsg { t: 'timeline'; since: number; items: TimelineItem[]; /** present (true) when the oldest items were cut to timelineMax */ truncated?: boolean }
/** Extra fields depend on the request the `rid` answers; read them as `unknown` and narrow. */
export interface ReplyMsg {
  t: 'reply';
  /** echoes the request's rid; null when the request carried none (e.g. an invalid frame) */
  rid: number | string | null;
  ok: boolean;
  error?: string;
  [k: string]: unknown;
}
export type ServerMsg = Hello | WorldMsg | EntityMsg | GoneMsg | WorkspacesMsg | EventMsg | StatsMsg | HerdrMsg | ScreenMsg |
  TermStateMsg | TermAckMsg | ToastMsg | TimelineMsg | ReplyMsg;

// ---- renderer → server (JSON text frames, discriminated on `t`; validated by VALIDATE below)

/** Payload of every renderer→server message, keyed by `t` (`rid` is added by ClientMsg). */
export interface ClientPayloads {
  'hello.ack': { protocol: number };
  'term.open': { id: string; cols: number; rows: number; mode?: 'observe' };
  'term.promote': { id: string; cols: number; rows: number; takeover?: boolean };
  'term.input': { id: string; text: string; paste?: boolean };
  'term.writer': { id: string };
  'term.fit': { id: string; cols: number; rows: number };
  'term.resize': { id: string; cols: number; rows: number };
  'term.pause': { id: string };
  'term.resume': { id: string };
  'term.history': { id: string; lines: number };
  'term.scroll': { id: string; dir: 'up' | 'down' | 'bottom'; lines?: number };
  'term.copyRecent': { id: string; lines: number };
  'term.close': { id: string };
  /** ansi:true → this client's `screen` lines keep SGR colour escapes (+ `ansi:true` on the msg) */
  'screen.watch': { ids: string[]; ansi?: boolean };
  'done.ack': { id: string; stateSeq: number | null };
  'herdr.focus': { id: string };
  'agent.prompt': { id: string; text: string };
  'agent.answer': { id: string; key: string; promptHash: string };
  'agent.keys': { id: string; keys: string[] };
  'agent.explain': { id: string };
  spawn: { workspaceId?: string; cwd?: string; kind?: 'claude' | 'codex'; label?: string; name?: string; prompt?: string };
  'pane.close': { id: string };
  'settings.set': { patch: Partial<Settings> };
  'world.get': Record<never, never>;
  'timeline.get': { since: number };
  'note.set': { id: string; text: string | null };
  'demo.force': { id: string; patch: Record<string, unknown> };
  'demo.scenario': { name: string; seed?: number };
  'demo.event': { id: string; kind: EventKind };
}
export type ClientMsg = { [K in keyof ClientPayloads]: { t: K; rid?: number | string } & ClientPayloads[K] }[keyof ClientPayloads];
/** The ClientMsg with `t` = K. */
export type ClientMsgOf<K extends keyof ClientPayloads> = Extract<ClientMsg, { t: K }>;

/** Extra fields a reply carries beside its envelope (`paneId`, `why`, `protocol`, …); they never redefine the envelope. */
export interface ReplyExtra { [k: string]: unknown; t?: never; rid?: never; ok?: never; error?: never }

export function reply(rid: number | string | null, ok: boolean, extra: ReplyExtra = {}): ReplyMsg {
  return { t: S2R.REPLY, rid, ok, ...extra };
}
export function replyError(rid: number | string | null, error: string, extra: ReplyExtra = {}): ReplyMsg {
  return { t: S2R.REPLY, rid, ok: false, error, ...extra };
}

// ---------------------------------------------------------------------------------------------
// Field & event ownership (§4.0). A field has exactly one writer. `demo` replaces transcripts+subagents.

/** The writers of Entity fields / events (§4.0). */
export type OwnerName = 'base' | 'transcripts' | 'subagents' | 'procinfo' | 'blocked' | 'acks' | 'notes' | 'demo';
type EntityField = keyof Entity;

const BASE_FIELDS = Object.freeze([
  'id', 'terminalId', 'kind', 'name', 'seedKey', 'status', 'statusSince', 'statusSinceApprox', 'identity', 'stateSeq',
  'layoutRect', 'workspace', 'tab', 'paneIndex', 'cwd', 'project', 'repo', 'focused', 'baseTitle',
] as const satisfies readonly EntityField[]);
const TRANSCRIPT_FIELDS = Object.freeze([
  'activity', 'model', 'modelTier', 'contextTokens', 'outputTokens', 'todos', 'lastPrompt', 'title', 'struggle', 'lastText', 'work',
] as const satisfies readonly EntityField[]);

/** owner name → Entity fields it writes */
export const FIELD_OWNERS: Readonly<Record<OwnerName, readonly EntityField[]>> = Object.freeze({
  base: BASE_FIELDS,
  transcripts: TRANSCRIPT_FIELDS,
  subagents: Object.freeze(['subagents'] as const),
  procinfo: Object.freeze(['process', 'res'] as const),
  blocked: Object.freeze(['prompt'] as const),
  acks: Object.freeze(['ack'] as const),
  notes: Object.freeze(['note'] as const), // [BE M3.5 cross-owner] world/notes.ts (§8.10 sticky notes): Entity.note {text, at}|null
  demo: Object.freeze([...TRANSCRIPT_FIELDS, 'subagents'] as const),
});

/** owner name → EVENT_KINDS it may emit */
export const EVENT_OWNERS: Readonly<Record<OwnerName, readonly EventKind[]>> = Object.freeze({
  base: Object.freeze(['arrived', 'left', 'blocked', 'unblocked', 'finished', 'tool'] as const),
  transcripts: Object.freeze(['error', 'test-pass', 'test-fail', 'commit', 'compact', 'struggle', 'news'] as const),
  subagents: Object.freeze(['subagent-spawned', 'subagent-done'] as const),
  procinfo: Object.freeze(['commit', 'news'] as const),
  blocked: Object.freeze([] as const),
  acks: Object.freeze(['acked'] as const),
  notes: Object.freeze([] as const), // [BE M3.5 cross-owner]
  demo: Object.freeze(['error', 'test-pass', 'test-fail', 'commit', 'compact', 'struggle', 'news', 'subagent-spawned', 'subagent-done'] as const),
});

/**
 * Event kinds with more than one possible emitter (D3): the pane's kind picks exactly one. Agent panes (any kind but
 * 'shell') → the transcript-side owner (`transcripts` live, `demo` in --demo); shells → `procinfo`. WorldModel drops
 * (dev: throws) an emit from the other owner. Every other kind has exactly one owner in any wiring.
 */
export const SHARED_EVENTS: readonly EventKind[] = Object.freeze(['commit', 'news'] as const);

/**
 * May `owner` emit event `kind` for a pane of `entityKind`? (EVENT_OWNERS + the D3 split for SHARED_EVENTS.)
 */
export function mayEmit(owner: OwnerName, kind: EventKind, entityKind: Kind): boolean {
  if (!EVENT_OWNERS[owner]?.includes(kind)) return false;
  if (!SHARED_EVENTS.includes(kind)) return true;
  return entityKind === 'shell' ? owner === 'procinfo' : owner === 'transcripts' || owner === 'demo';
}

/** Owners wired in live mode vs demo mode (demo replaces transcripts + subagents). */
// [BE M3.5 cross-owner] + 'notes' (world/notes.ts)
export const LIVE_OWNERS: readonly OwnerName[] = Object.freeze(['base', 'transcripts', 'subagents', 'procinfo', 'blocked', 'acks', 'notes'] as const);
export const DEMO_OWNERS: readonly OwnerName[] = Object.freeze(['base', 'demo', 'procinfo', 'blocked', 'acks', 'notes'] as const);

/** Every Entity field, in §3.1 order-ish. */
export const ENTITY_FIELDS: readonly EntityField[] = Object.freeze([
  ...BASE_FIELDS, 'ack', 'title', 'activity', 'model', 'modelTier', 'contextTokens', 'outputTokens', 'subagents',
  'todos', 'struggle', 'lastPrompt', 'prompt', 'process', 'res', 'lastText', 'work', 'note', // note: [BE M3.5 cross-owner]
]);

/**
 * field → owner, for the given set of owners (default live). Throws if two owners claim a field.
 */
export function fieldOwnerMap(owners: readonly OwnerName[] = LIVE_OWNERS): Map<EntityField, OwnerName> {
  const m = new Map<EntityField, OwnerName>();
  for (const o of owners) {
    for (const f of FIELD_OWNERS[o] ?? []) {
      if (m.has(f)) throw new Error(`field ${f} owned by both ${m.get(f)} and ${o}`);
      m.set(f, o);
    }
  }
  return m;
}

/** Default values for enricher-owned fields (what an Entity carries before any patch). */
export type EnricherField = Exclude<EntityField, (typeof BASE_FIELDS)[number]>;
export type FieldDefaults = Readonly<{ [K in EnricherField]: K extends 'subagents' ? readonly Subagent[] : Entity[K] }>;
export const FIELD_DEFAULTS: FieldDefaults = Object.freeze({
  ack: null, title: null, activity: null, model: null, modelTier: null, contextTokens: null, outputTokens: null,
  subagents: Object.freeze([]), todos: null, struggle: null, lastPrompt: null, prompt: null, process: null, res: null,
  lastText: null, work: null, note: null, // note: [BE M3.5 cross-owner]
});

// ---------------------------------------------------------------------------------------------
// Binary frames (§3): [u8 kind][u8 idLen][id utf8][u8 flags][payload]

export const BIN = Object.freeze({
  TERM_DATA: 1, // server → renderer; flags bit0 = full snapshot
  TERM_INPUT: 2, // renderer → server; interactive bytes only, flags must be 0 (paste = JSON term.input, §3.4)
});
export const BIN_FLAG = Object.freeze({ FULL: 1 });

const te = new TextEncoder();
const td = new TextDecoder('utf-8', { fatal: true });

/**
 * `kind` = BIN.*, `id` = pane id (≤ 255 UTF-8 bytes), `flags` = u8.
 */
export function encodeFrame(kind: number, id: string, flags: number, payload: Uint8Array | string): Uint8Array<ArrayBuffer> {
  const idBytes = te.encode(id);
  if (idBytes.length > 255) throw new RangeError('frame id too long');
  if (!(kind >= 0 && kind <= 255) || !(flags >= 0 && flags <= 255)) throw new RangeError('bad kind/flags');
  const body = typeof payload === 'string' ? te.encode(payload) : payload;
  const out = new Uint8Array(3 + idBytes.length + body.length);
  out[0] = kind;
  out[1] = idBytes.length;
  out.set(idBytes, 2);
  out[2 + idBytes.length] = flags;
  out.set(body, 3 + idBytes.length);
  return out;
}

export interface Frame { kind: number; id: string; flags: number; payload: Uint8Array }

/** `buf`: a Node Buffer works. Returns null if malformed. `payload` is a view (no copy). */
export function decodeFrame(buf: ArrayBuffer | ArrayBufferView): Frame | null {
  const u8 =
    buf instanceof Uint8Array
      ? buf
      : ArrayBuffer.isView(buf)
        ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
        : buf instanceof ArrayBuffer
          ? new Uint8Array(buf)
          : null;
  if (!u8 || u8.length < 3) return null;
  const idLen = u8[1];
  if (u8.length < 3 + idLen) return null;
  let id: string;
  try {
    id = td.decode(u8.subarray(2, 2 + idLen));
  } catch {
    return null;
  }
  return { kind: u8[0], id, flags: u8[2 + idLen], payload: u8.subarray(3 + idLen) };
}

export const encodeTermData = (id: string, bytes: Uint8Array | string, full = false): Uint8Array<ArrayBuffer> => encodeFrame(BIN.TERM_DATA, id, full ? BIN_FLAG.FULL : 0, bytes);
/**
 * Interactive-path input frame (no rid, credit-windowed). Paste chunks never use this: they are JSON
 * `{t:'term.input', id, text, paste:true, rid}` so each chunk gets a reply (§3.4, LEAD M1 decision D6).
 */
export const encodeTermInput = (id: string, bytes: Uint8Array | string): Uint8Array<ArrayBuffer> => encodeFrame(BIN.TERM_INPUT, id, 0, bytes);

/** Validate a decoded binary renderer→server frame. */
export function validateBinaryInput(f: Frame | null): { ok: true; paste: false } | Invalid {
  if (!f) return bad('malformed frame');
  if (f.kind !== BIN.TERM_INPUT) return bad(`kind ${f.kind} not accepted from renderer`);
  if (!f.id || f.id.length > LIMITS.idMax) return bad('id');
  if (f.flags !== 0) return bad('flags (binary term.input is interactive-only; paste uses JSON term.input)');
  if (f.payload.length === 0 || f.payload.length > LIMITS.termInputMax) return bad('payload size');
  return { ok: true, paste: false };
}

// ---------------------------------------------------------------------------------------------
// VALIDATE (§4.11): one row per renderer→server `t`. Enforced in server/ws.ts before routing.
// Rules check shape/type/range only; "known entity" is checked by ws.ts against the WorldModel.

/** A rule validates one field value; `check` returns an error string or null. */
export interface Rule { kind: string; check: (v: unknown) => string | null; opt: boolean }
/** A failed validation: `error` is the `reply` error code, `why` a short human reason. */
export interface Invalid { ok: false; error: ErrorCode; why: string }
const rule = (kind: string, check: Rule['check'], opt = false): Readonly<Rule> => Object.freeze({ kind, check, opt });
const isInt = (v: unknown): v is number => Number.isInteger(v);
const byteLen = (s: string): number => te.encode(s).length;

/** Rule builders (exported so ws.test.ts / additions reuse them). */
export const R = Object.freeze({
  str: (max: number, { opt = false, min = 0, re = null }: { opt?: boolean; min?: number; re?: RegExp | null } = {}) =>
    rule('str', (v) => (typeof v !== 'string' ? 'not a string' : v.length < min ? 'too short' : byteLen(v) > max ? `> ${max} bytes` : re && !re.test(v) ? 'bad format' : null), opt),
  paneId: (opt = false) =>
    rule('paneId', (v) => (typeof v !== 'string' || v.length === 0 || v.length > LIMITS.idMax || /[\s\u0000-\u001f]/.test(v) ? 'bad pane id' : null), opt),
  int: (min: number, max: number, opt = false) => rule('int', (v) => (!isInt(v) ? 'not an int' : v < min || v > max ? `out of range ${min}–${max}` : null), opt),
  bool: (opt = false) => rule('bool', (v) => (typeof v !== 'boolean' ? 'not a boolean' : null), opt),
  oneOf: (values: readonly unknown[], opt = false) => rule('oneOf', (v) => (values.includes(v) ? null : `not in {${values.join(',')}}`), opt),
  arr: (item: Rule, max: number, opt = false) =>
    rule('arr', (v) => {
      if (!Array.isArray(v)) return 'not an array';
      if (v.length > max) return `> ${max} items`;
      for (const x of v) {
        const e = item.check(x);
        if (e) return `item: ${e}`;
      }
      return null;
    }, opt),
  obj: (maxBytes: number, keys: readonly string[] | null = null, opt = false) =>
    rule('obj', (v) => {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) return 'not an object';
      let size;
      try {
        size = byteLen(JSON.stringify(v));
      } catch {
        return 'not serialisable';
      }
      if (size > maxBytes) return `> ${maxBytes} bytes`;
      if (keys) for (const k of Object.keys(v)) if (!keys.includes(k)) return `unknown key ${k}`;
      return null;
    }, opt),
  nullable: (inner: Rule, opt = false) => rule(`${inner.kind}|null`, (v) => (v === null ? null : inner.check(v)), opt),
});

const cols = R.int(LIMITS.cols[0], LIMITS.cols[1]);
const rows = R.int(LIMITS.rows[0], LIMITS.rows[1]);
const id = R.paneId();
const opt = (r: Rule): Readonly<Rule> => Object.freeze({ ...r, opt: true });

/**
 * renderer→server validation table. Every key of R2S appears exactly once, with a rule for every payload field
 * (ClientPayloads). `t` and `rid` are implicit.
 */
export const VALIDATE: Readonly<{ [K in keyof ClientPayloads]: Readonly<Record<keyof ClientPayloads[K], Rule>> }> = Object.freeze({
  'hello.ack': { protocol: R.int(0, 1e6) },
  'term.open': { id, cols, rows, mode: R.oneOf(['observe'], true) },
  'term.promote': { id, cols, rows, takeover: R.bool(true) },
  'term.input': { id, text: R.str(LIMITS.termInputMax, { min: 1 }), paste: R.bool(true) },
  'term.writer': { id },
  'term.fit': { id, cols, rows },
  'term.resize': { id, cols, rows },
  'term.pause': { id },
  'term.resume': { id },
  'term.history': { id, lines: R.int(1, LIMITS.historyLinesMax) },
  'term.scroll': { id, dir: R.oneOf(['up', 'down', 'bottom']), lines: R.int(0, 10_000, true) },
  'term.copyRecent': { id, lines: R.int(1, LIMITS.historyLinesMax) },
  'term.close': { id },
  // [BE M3.5 cross-owner] ansi:true → this client's `screen` lines keep SGR colour escapes (+ `ansi:true` on the msg)
  'screen.watch': { ids: R.arr(R.paneId(), LIMITS.watchMax), ansi: R.bool(true) },
  'done.ack': { id, stateSeq: R.nullable(R.int(0, Number.MAX_SAFE_INTEGER)) },
  'herdr.focus': { id },
  'agent.prompt': { id, text: R.str(LIMITS.textMax, { min: 1 }) },
  'agent.answer': { id, key: R.str(4, { min: 1 }), promptHash: R.str(16, { min: 1, re: /^[0-9a-f]+$/ }) },
  'agent.keys': { id, keys: R.arr(R.str(LIMITS.keyLenMax, { min: 1 }), LIMITS.keysMax) },
  'agent.explain': { id },
  spawn: {
    workspaceId: opt(R.str(LIMITS.idMax, { min: 1 })),
    cwd: opt(R.str(LIMITS.cwdMax, { min: 1, re: /^\/[^\u0000]*$/ })),
    kind: R.oneOf(['claude', 'codex'], true),
    label: opt(R.str(LIMITS.labelMax, { min: 1 })),
    name: opt(R.str(LIMITS.labelMax, { min: 1 })),
    prompt: opt(R.str(LIMITS.textMax, { min: 1 })), // M3.5 LEAD: first prompt for kind 'claude'/'codex' (BE sends it once the agent is ready)
  },
  'pane.close': { id },
  'settings.set': { patch: R.obj(LIMITS.settingsPatchMax, SETTINGS_KEYS) },
  'world.get': {},
  'timeline.get': { since: R.int(0, Number.MAX_SAFE_INTEGER) },
  'note.set': { id, text: R.nullable(R.str(LIMITS.noteMax * 4)) }, // ≤ 280 chars checked below
  'demo.force': { id, patch: R.obj(LIMITS.textMax) },
  'demo.scenario': { name: R.str(LIMITS.labelMax, { min: 1, re: /^[A-Za-z0-9_-]+$/ }), seed: R.int(0, 0xffff_ffff, true) },
  'demo.event': { id, kind: R.oneOf(EVENT_KINDS) },
});

/** Extra per-type checks that don't fit a single-field rule. */
const EXTRA: Partial<Record<ClientMsgType, (m: Record<string, unknown>) => string | null>> = {
  'note.set': (m) => (typeof m.text === 'string' && [...m.text].length > LIMITS.noteMax ? `text > ${LIMITS.noteMax} chars` : null),
};

const RID = R.str(64, { min: 1 });
const bad = (why: string): Invalid => ({ ok: false, error: ERR.BAD_MESSAGE, why });
const isClientType = (t: unknown): t is ClientMsgType => typeof t === 'string' && Object.hasOwn(VALIDATE, t);

/**
 * Validate a parsed renderer→server JSON message. Unknown `t`, missing required fields, wrongly typed
 * or unknown extra fields → `{ok:false, error:'bad_message', why}`.
 */
export function validateMessage(value: unknown): { ok: true; t: ClientMsgType; cls: ActionClass } | Invalid {
  if (!isRecord(value)) return bad('not an object');
  const msg = value;
  const t = msg.t;
  if (!isClientType(t)) return bad(`unknown t ${String(t).slice(0, 32)}`);
  const spec: Readonly<Record<string, Rule>> = VALIDATE[t];
  if ('rid' in msg && !(isInt(msg.rid) && msg.rid >= 0) && RID.check(msg.rid)) return bad('rid');
  for (const k of Object.keys(msg)) {
    if (k === 't' || k === 'rid') continue;
    if (!Object.hasOwn(spec, k)) return bad(`unexpected field ${k}`);
  }
  for (const [k, r] of Object.entries(spec)) {
    if (!(k in msg) || msg[k] === undefined) {
      if (r.opt) continue;
      return bad(`missing ${k}`);
    }
    const e = r.check(msg[k]);
    if (e) return bad(`${k}: ${e}`);
  }
  const extra = EXTRA[t]?.(msg);
  if (extra) return bad(extra);
  return { ok: true, t, cls: ACTION_CLASS[t] };
}

/** Parse + validate a text frame (size cap first). Never throws. */
export function parseClientText(text: string):
  | { ok: true; msg: ClientMsg; t: ClientMsgType; cls: ActionClass }
  | (Invalid & { close?: boolean; rid?: unknown }) {
  if (typeof text !== 'string') return bad('not text');
  if (text.length > LIMITS.maxTextFrame || byteLen(text) > LIMITS.maxTextFrame) return { ...bad('frame too large'), close: true };
  let msg: unknown;
  try {
    msg = JSON.parse(text);
  } catch {
    return bad('invalid json');
  }
  const v = validateMessage(msg);
  if (!v.ok) return { ...v, rid: isRecord(msg) ? msg.rid : undefined };
  // validateMessage checked every field of this `t` against VALIDATE, which mirrors ClientPayloads
  return { ok: true, msg: msg as ClientMsg, t: v.t, cls: v.cls };
}
