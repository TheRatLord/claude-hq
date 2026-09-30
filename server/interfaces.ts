/**
 * Backend internal seams (DESIGN §4.0). The ONLY way backend modules talk across WP boundaries.
 * Live and demo differ only in which implementations app.ts wires in.
 * Owner: LEAD. Tiny base classes + JSDoc; implementations live in herdr/, demo/, enrich/, world/, terminals/.
 */

import { EventEmitter } from 'node:events';
import { FIELD_OWNERS, EVENT_OWNERS, EVENT_KINDS } from '../shared/protocol.ts';
import type { DemoConfig, Entity, EventKind, OwnerName, Status, TermState } from '../shared/protocol.ts';

// ---- herdr wire shapes (research/herdr-api §2; the subset HQ reads. Add fields here when a module needs one.)

export interface RawWorkspace {
  workspace_id: string;
  label?: string;
  number?: number;
  agent_status?: Status;
  focused?: boolean;
  worktree?: { repo_name?: string };
}
export interface RawTab {
  tab_id: string;
  workspace_id: string;
  label?: string;
  number?: number;
  agent_status?: Status;
}
export interface RawAgentSession { source?: string; agent?: string; kind?: 'id' | 'path'; value?: string }
export interface RawPane {
  pane_id: string;
  terminal_id?: string;
  workspace_id: string;
  tab_id: string;
  focused?: boolean;
  cwd?: string;
  foreground_cwd?: string;
  terminal_title?: string;
  terminal_title_stripped?: string;
  /** agent kind ('claude' | 'codex' | …); absent for a shell */
  agent?: string;
  agent_status?: Status;
  agent_session?: RawAgentSession;
  /** cell rect of the pane inside its tab layout (merged in from `layouts`) */
  rect?: { x?: number; y?: number; width: number; height: number };
}
/** `agents[]` ⊂ panes with a detected agent. */
export interface RawAgent {
  pane_id: string;
  name?: string;
  agent_status?: Status;
  agent_session?: RawAgentSession;
  state_change_seq?: number;
}
export interface RawLayout {
  workspace_id: string;
  tab_id: string;
  zoomed?: boolean;
  area?: { x: number; y: number; width: number; height: number };
  focused_pane_id?: string | null;
  panes?: { pane_id: string; focused?: boolean; rect: { x?: number; y?: number; width: number; height: number } }[];
}

/** herdr-shaped raw snapshot: exactly what `session.snapshot` returns. */
export interface RawSnapshot {
  workspaces: RawWorkspace[];
  tabs: RawTab[];
  panes: RawPane[];
  agents: RawAgent[];
  layouts: RawLayout[];
  focused_workspace_id?: string | null;
  focused_tab_id?: string | null;
  focused_pane_id?: string | null;
}

/** Opaque handle returned by a Clock's setTimeout / setInterval. */
export type TimerHandle = NodeJS.Timeout | number;

/**
 * Injectable clock (server/clock.ts, §4.13). Never call Date.now()/setTimeout directly in server code.
 */
export interface Clock {
  now(): number;
  setTimeout<A extends unknown[]>(fn: (...args: A) => void, ms?: number, ...args: A): TimerHandle;
  clearTimeout(h: TimerHandle | null | undefined): void;
  setInterval<A extends unknown[]>(fn: (...args: A) => void, ms?: number, ...args: A): TimerHandle;
  clearInterval(h: TimerHandle | null | undefined): void;
  timescale: number;
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** Context handed to Enricher.attach. */
export interface EnricherCtx {
  source: HerdrSource;
  clock: Clock;
  log: Logger;
  session: string;
  /** Offer the pane's true `statusSince` (ms): `sinceHint(ms)` or `sinceHint(paneId, ms)` (WorldModel accepts both, §4.3.1). */
  sinceHint(msOrId: number | string, ms?: number): void;
}

/** Minimal base entity as WorldModel builds it (FIELD_OWNERS.base fields). */
export type BaseEntity = Partial<Entity>;

/** Events a HerdrSource emits. */
export interface HerdrSourceEvents {
  snapshot: [raw: RawSnapshot];
  status: [paneId: string, status: Status, seq: number | null];
  connected: [connected: boolean, info?: { retryInMs?: number }];
  reconnected: [info: { grace: boolean }];
  /** DemoWorld only: a pane's demo facts changed (DemoEnricher re-reads them) */
  facts: [id: string];
  /** DemoWorld only: a schedule event for DemoEnricher to re-emit */
  'demo-event': [id: string, kind: EventKind, detail: unknown];
  /** DemoWorld only: discard the previous simulation, even while offline or in reconnect grace. */
  'demo-reset': [];
  /** ReplaySource only: the recording ended */
  done: [];
}

/**
 * HerdrSource: raw herdr truth. Implemented by HerdrLive (§4.2), DemoWorld (§4.9), Replay (§4.9).
 * Events: 'snapshot'(raw) · 'status'(pane_id, status, seq) · 'connected'(bool) · 'reconnected'({grace:true}).
 */
export class HerdrSource extends EventEmitter<HerdrSourceEvents> {
  connected: boolean;
  /** Only real simulated sources expose reset controls and current reproducibility metadata. */
  declare scenario?: (name: string, seed?: number) => DemoConfig | Promise<DemoConfig>;
  get demoConfig(): DemoConfig | undefined { return undefined; }
  constructor() {
    super();
    this.connected = false;
  }
  snapshot(): RawSnapshot | null {
    return null;
  }
  /** Same method names/params/errors as the herdr socket (subset in demo). */
  async request(method: string, params: Record<string, unknown> = {}): Promise<unknown> { // eslint-disable-line no-unused-vars
    throw Object.assign(new Error(`${this.constructor.name}: ${method} not implemented`), { code: 'not_implemented' });
  }
  /** Stop timers/sockets. */
  async close(): Promise<void> {}
}

/**
 * Enricher: adds facts to one pane. Subclass and set `name`; `owns`/`events` default to FIELD_OWNERS/EVENT_OWNERS.
 * WorldModel sets `onPatch` and `emitEvent` at wire-up (and calls assertEnricher first).
 */
export class Enricher {
  /** key in FIELD_OWNERS */
  name: OwnerName;
  /** Entity fields it writes; must equal FIELD_OWNERS[name] */
  owns: (keyof Entity)[];
  /** EVENT_KINDS it may emit */
  events: EventKind[];
  onPatch: (id: string, patch: Partial<Entity>) => void;
  emitEvent: (id: string, kind: EventKind, detail?: unknown) => void;
  constructor(name: OwnerName) {
    this.name = name;
    this.owns = [...(FIELD_OWNERS[name] ?? [])];
    this.events = [...(EVENT_OWNERS[name] ?? [])];
    this.onPatch = () => {
      throw new Error(`${name}.onPatch called before wire-up`);
    };
    this.emitEvent = () => {
      throw new Error(`${name}.emitEvent called before wire-up`);
    };
  }
  /** Pane appeared (or kind changed). */
  attach(id: string, base: BaseEntity, ctx: EnricherCtx): void {} // eslint-disable-line no-unused-vars
  /**
   * After EVERY base-entity change, before the merged entity is diffed. Synchronous. Start/stop pollers here.
   */
  update(id: string, base: BaseEntity, prevBase: BaseEntity | null): void {} // eslint-disable-line no-unused-vars
  /** Pane gone (after grace). */
  detach(id: string): void {} // eslint-disable-line no-unused-vars
  /** Stop everything (backend shutdown). */
  async close(): Promise<void> {}
}

/**
 * Check an enricher against the ownership contract. WorldModel calls this at wire-up.
 */
export function assertEnricher(e: Pick<Enricher, 'name' | 'owns' | 'events'> & Partial<Pick<Enricher, 'attach' | 'update' | 'detach'>>): void {
  const want = FIELD_OWNERS[e.name];
  if (!want || e.name === 'base') throw new Error(`enricher ${e.name}: not in FIELD_OWNERS`);
  const a = [...e.owns].sort().join(','), b = [...want].sort().join(',');
  if (a !== b) throw new Error(`enricher ${e.name}: owns [${a}] ≠ FIELD_OWNERS [${b}]`);
  for (const k of e.events) {
    if (!EVENT_KINDS.includes(k)) throw new Error(`enricher ${e.name}: unknown event ${k}`);
    if (!EVENT_OWNERS[e.name].includes(k)) throw new Error(`enricher ${e.name}: may not emit ${k}`);
  }
  for (const m of ['attach', 'update', 'detach'] as const) if (typeof e[m] !== 'function') throw new Error(`enricher ${e.name}: missing ${m}()`);
}

/**
 * Filter a patch to the owner's fields. Dev: throws on a foreign field. Prod: drops it.
 */
export function checkPatch(e: Pick<Enricher, 'name' | 'owns'>, patch: Record<string, unknown>, { dev = false }: { dev?: boolean } = {}): Partial<Entity> {
  const owns: readonly string[] = e.owns;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (owns.includes(k)) out[k] = v;
    else if (dev) throw new Error(`enricher ${e.name} patched foreign field ${k}`);
  }
  // only fields in `owns` (= FIELD_OWNERS[name], keyof Entity) survive; the values are the enricher's to get right
  return out as Partial<Entity>;
}


/**
 * One terminal stream per pane. Implemented by HerdrTerminals (herdr CLI child) and FakeTerminals.
 * TerminalHub (§4.7) is the only caller.
 */
export interface TerminalOpenOpts {
  mode: 'observe' | 'control';
  cols: number;
  rows: number;
  takeover?: boolean;
  /** one-shot token TerminalHub mints (backend.mintPromoteToken) for a control spawn */
  promoteToken?: string;
}

export class TerminalBackend {
  /** `id` = pane id. */
  open(id: string, opts: TerminalOpenOpts): TerminalHandle { // eslint-disable-line no-unused-vars
    throw new Error(`${this.constructor.name}.open not implemented`);
  }
  async close(): Promise<void> {}
}

export interface TerminalClosedInfo { code: number | null; reason: string }

/**
 * Base terminal handle: listener plumbing done; subclasses implement input/resize/scroll/release and call
 * `_frame(bytes, full)` / `_closed({code, reason})`.
 */
export class TerminalHandle {
  _frameFns: ((bytes: Uint8Array, full: boolean) => void)[];
  _closedFns: ((info: TerminalClosedInfo) => void)[];
  closedWith: TerminalClosedInfo | null;
  /** current grid of the child, for handles that track it (HerdrHandle updates it from each frame) */
  declare cols?: number;
  declare rows?: number;
  constructor() {
    this._frameFns = [];
    this._closedFns = [];
    this.closedWith = null;
  }
  onFrame(fn: (bytes: Uint8Array, full: boolean) => void): void {
    this._frameFns.push(fn);
  }
  /** Fires once; late subscribers after close are called immediately. */
  onClosed(fn: (info: TerminalClosedInfo) => void): void {
    if (this.closedWith) fn(this.closedWith);
    else this._closedFns.push(fn);
  }
  /** Resolves when written (stdin drained). */
  async input(bytes: Uint8Array): Promise<void> { // eslint-disable-line no-unused-vars
    throw new Error('input not implemented');
  }
  resize(cols: number, rows: number): void {} // eslint-disable-line no-unused-vars
  scroll(dir: 'up' | 'down' | 'bottom', lines: number): void {} // eslint-disable-line no-unused-vars
  async release(): Promise<void> {}
  /** For subclasses. */
  _frame(bytes: Uint8Array, full = false): void {
    if (this.closedWith) return;
    for (const fn of this._frameFns) fn(bytes, full);
  }
  /** For subclasses. */
  _closed(info?: Partial<TerminalClosedInfo> | null): void {
    if (this.closedWith) return;
    this.closedWith = { code: info?.code ?? null, reason: info?.reason ?? '' };
    const fns = this._closedFns.splice(0);
    for (const fn of fns) fn(this.closedWith);
  }
}

/** Map a herdr `terminal.closed.reason` to a `term.state` (§4.7). */
export function closedReasonToState(reason: string | null | undefined): Extract<TermState, 'busy' | 'taken' | 'gone' | 'released' | 'error'> {
  const r = String(reason ?? '').toLowerCase();
  if (r.includes('already has an attached client')) return 'busy';
  if (r.includes('taken over')) return 'taken';
  if (r.includes('not found')) return 'gone';
  if (r.includes('detached')) return 'released';
  return 'error';
}
