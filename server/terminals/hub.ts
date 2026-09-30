/**
 * TerminalHub: one child per (pane, mode) shared by every viewer on this backend, observe first,
 * control only on `term.promote` (which mints the one-shot promoteToken client.ts requires), a headless screen mirror
 * for `full` frames, writer/sizer rules, interactive input credit (`term.ack`), paste drain gate, WS backpressure
 * (`needsFull`), caps, WS-drop grace resume keyed by cid, paused-viewer drop, idle demotion.
 *
 * A "client" is `{cid, sendJson(msg), sendBinary(u8), bufferedAmount(): number}` (ws.ts).
 *
 * Pane state P: {id, state, child, pending (control child during a promote swap), mirror, viewers: Map<client, V>,
 *   writer, sizer, queue (input held until control is live), sticky ('taken' shown while falling back to observe)}.
 */
import { S2R, ERR, LIMITS, encodeTermData } from '../../shared/protocol.ts';
import type { ServerMsg, TermMode, TermState, TermStateMsg } from '../../shared/protocol.ts';
import { closedReasonToState } from '../interfaces.ts';
import type { Clock, Logger, TerminalBackend, TerminalClosedInfo, TerminalHandle, TerminalOpenOpts, TimerHandle } from '../interfaces.ts';
import { Mirror } from './mirror.ts';

/** A viewer socket as the hub sees it (WsHub's client). */
export interface HubClient {
  cid?: string | null;
  sendJson(msg: ServerMsg): void;
  sendBinary(u8: Uint8Array): void;
  bufferedAmount(): number;
}

export type Grid = { cols: number; rows: number };

export interface TerminalHubOpts {
  backend: TerminalBackend & { mintPromoteToken?: (id: string) => string };
  clock: Clock;
  log?: Logger;
  layoutRect?: (id: string) => Grid | null;
  paneScroll?: (id: string) => Promise<number | null>;
  readOnly?: () => boolean;
  idleDemotion?: () => boolean;
  online?: () => boolean;
}

/** One backend child (observe or control) of a pane. */
interface Child { handle: TerminalHandle; mode: TermMode; cols: number; rows: number; live: boolean; retired: boolean }

/** Per-client state of a pane's viewer. */
interface Viewer {
  paused: boolean;
  orphan: boolean;
  needsFull: boolean;
  fullPending: boolean;
  queue: [Uint8Array, boolean][];
  fullToken?: object | null;
  written: number;
  acked: number;
  ackTimer: TimerHandle | null;
  pauseTimer: TimerHandle | null;
  drainTimer: TimerHandle | null;
  fit: Grid;
  since: number;
}

interface PromoteWaiter { resolve: () => void; reject: (e: Error) => void }

/** Pane state P (see the header). */
interface PaneState {
  id: string;
  cols: number;
  rows: number;
  state: TermState;
  detail: string | undefined;
  child: Child | null;
  pending: Child | null;
  mirror: Mirror | null;
  sticky: 'taken' | null;
  viewers: Map<HubClient, Viewer>;
  writer: HubClient | null;
  sizer: HubClient | null;
  queue: Uint8Array[];
  promoteWaiters: PromoteWaiter[];
  lastRespawn: number;
  respawnTimer: TimerHandle | null;
  promoteTimer: TimerHandle | null;
  idleTimer: TimerHandle | null;
}

export type TermOpenReply = { mode: TermMode; cols: number; rows: number };
export type TermInputResult = { ok: true } | { ok: false; error: string };

export const PROMOTE_TIMEOUT_MS = 5000;
export const IDLE_DEMOTE_MS = 10 * 60_000;
const hubError = (code: string, why?: string): Error & { code: string } => Object.assign(new Error(why ?? code), { code });
const quietLog: Logger = { debug() {}, info() {}, warn() {}, error() {} };
const differs = (a: Grid | null | undefined, b: Grid | null | undefined): boolean => !a || !b || Math.abs(a.cols - b.cols) > 0.1 * b.cols || Math.abs(a.rows - b.rows) > 0.1 * b.rows;

export interface HubMetrics {
  panes: number;
  children: { observe: number; control: number; pending: number };
  viewers: number;
  orphans: number;
  mirrors: number;
  spawns: number;
  promotes: number;
  demotions: number;
  resumes: number;
}

export class TerminalHub {
  backend: TerminalHubOpts['backend'];
  clock: Clock;
  log: Logger;
  layoutRect: (id: string) => Grid | null;
  paneScroll: (id: string) => Promise<number | null>;
  readOnly: () => boolean;
  idleDemotion: () => boolean;
  online: () => boolean;
  /** pane id → pane state */
  panes: Map<string, PaneState>;
  /** client → pane ids it views */
  byClient: Map<HubClient, Set<string>>;
  /** cid → dropped client within grace */
  orphans: Map<string, { client: HubClient; timer: TimerHandle }>;
  counters: { spawns: number; promotes: number; demotions: number; resumes: number };
  constructor({ backend, clock, log, layoutRect = () => null, paneScroll = async () => null, readOnly = () => false, idleDemotion = () => true,
    online = () => true }: TerminalHubOpts) {
    this.backend = backend;
    this.clock = clock;
    this.log = log ?? quietLog;
    this.layoutRect = layoutRect;
    this.paneScroll = paneScroll;
    this.readOnly = readOnly;
    this.idleDemotion = idleDemotion;
    this.online = online;
    this.panes = new Map();
    this.byClient = new Map();
    this.orphans = new Map();
    this.counters = { spawns: 0, promotes: 0, demotions: 0, resumes: 0 };
  }

  // ------------------------------------------------------------------ helpers

  _children(): number {
    let n = 0;
    for (const P of this.panes.values()) n += (P.child ? 1 : 0) + (P.pending ? 1 : 0);
    return n;
  }

  _stateMsg(P: PaneState, client: HubClient): TermStateMsg {
    const c = P.child;
    const msg: TermStateMsg = { t: S2R.TERM_STATE, id: P.id, state: P.state, mode: c?.mode ?? 'observe', cols: c?.cols ?? P.cols, rows: c?.rows ?? P.rows,
      writer: P.writer === client, sizer: P.sizer === client };
    if (P.detail) msg.detail = P.detail;
    return msg;
  }
  _sendState(P: PaneState, client: HubClient): void {
    client.sendJson(this._stateMsg(P, client));
  }
  _broadcastState(P: PaneState): void {
    for (const client of P.viewers.keys()) this._sendState(P, client);
  }

  _spawn(P: PaneState, mode: TermMode, cols: number, rows: number, takeover = false): Child {
    const opts: TerminalOpenOpts = { mode, cols, rows, ...(takeover ? { takeover: true } : {}) };
    if (mode === 'control' && this.backend.mintPromoteToken) opts.promoteToken = this.backend.mintPromoteToken(P.id);
    const handle = this.backend.open(P.id, opts);
    this.counters.spawns++;
    const child: Child = { handle, mode, cols, rows, live: false, retired: false };
    handle.onFrame((bytes, full) => this._onFrame(P, child, bytes, full));
    handle.onClosed((info) => this._onClosed(P, child, info));
    return child;
  }

  _retire(child: Child | null): Promise<void> | null {
    if (!child || child.retired) return null;
    child.retired = true;
    // control → terminal.release (+SIGTERM after 1 s); observe → SIGTERM (+SIGKILL after 1 s) — see HerdrTerminals
    return child.handle.release().catch(() => {});
  }

  _onFrame(P: PaneState, child: Child, bytes: Uint8Array, full: boolean): void {
    if (child.retired) return;
    if (child === P.pending) {
      // promote swap: every viewer moves to the control stream; the mirror resets on its first full frame
      const old = P.child;
      P.child = child;
      P.pending = null;
      this.clock.clearTimeout(P.promoteTimer);
      this._retire(old);
      P.mirror?.dispose();
      P.mirror = new Mirror(child.cols, child.rows);
      this._resetViewers(P);
      const q = P.queue.splice(0);
      for (const b of q) child.handle.input(b).catch(() => {});
      P.promoteWaiters.splice(0).forEach((w) => w.resolve());
      this._armIdle(P);
    }
    if (child !== P.child) return;
    if (full) {
      const h = child.handle; // a HerdrHandle tracks the grid herdr reports; a FakeHandle leaves them unset
      if (h.cols && h.rows) {
        child.cols = h.cols;
        child.rows = h.rows;
      }
      if (!P.mirror) P.mirror = new Mirror(child.cols, child.rows);
      P.mirror.resize(child.cols, child.rows);
    }
    if (!P.mirror) P.mirror = new Mirror(child.cols, child.rows);
    P.mirror.write(bytes, full);
    if (!child.live) {
      child.live = true;
      P.state = P.sticky ?? (child.mode === 'observe' && this.readOnly() ? 'readonly' : 'live');
      P.detail = P.sticky ? P.detail : undefined;
      this._broadcastState(P);
    } else if (full) this._broadcastState(P); // grid may have changed
    for (const [client, v] of P.viewers) {
      if (v.paused || v.orphan) continue;
      if (v.fullPending) {
        v.queue.push([bytes, full]);
        continue;
      }
      const buffered = client.bufferedAmount();
      if (v.needsFull) {
        if (buffered < LIMITS.bufferedLow) this._sendFull(P, client, v);
        continue;
      }
      if (!full && buffered > LIMITS.bufferedHigh) {
        v.needsFull = true;
        this._watchDrain(P, client, v);
        continue;
      }
      client.sendBinary(encodeTermData(P.id, bytes, full));
    }
  }

  /** needsFull clients: poll the socket buffer so a quiet pane still gets its full frame once drained. */
  _watchDrain(P: PaneState, client: HubClient, v: Viewer): void {
    if (v.drainTimer) return;
    const check = () => {
      v.drainTimer = null;
      if (!v.needsFull || !P.viewers.has(client)) return;
      if (client.bufferedAmount() < LIMITS.bufferedLow) this._sendFull(P, client, v);
      else v.drainTimer = this.clock.setTimeout(check, 100);
    };
    v.drainTimer = this.clock.setTimeout(check, 100);
  }

  /** Serialized `full` frame from the mirror, then any frames that arrived meanwhile. */
  _sendFull(P: PaneState, client: HubClient, v: Viewer): void {
    if (!P.mirror || v.fullPending || !P.child?.live) return;
    v.fullPending = true;
    v.needsFull = false;
    v.queue = [];
    const mirror = P.mirror;
    const token = (v.fullToken = {});
    mirror.full().then((bytes) => {
      if (v.fullToken !== token) return; // superseded (stream swap / newer full)
      v.fullPending = false;
      if (!P.viewers.has(client) || P.mirror !== mirror || v.paused) return;
      client.sendBinary(encodeTermData(P.id, bytes, true));
      for (const [b, f] of v.queue.splice(0)) client.sendBinary(encodeTermData(P.id, b, f));
    });
  }

  _onClosed(P: PaneState, child: Child, info: TerminalClosedInfo | null | undefined): void {
    if (child.retired) return;
    const state = closedReasonToState(info?.reason);
    if (child === P.pending) {
      P.pending = null;
      P.queue = [];
      this.clock.clearTimeout(P.promoteTimer);
      const err = hubError(state === 'busy' ? 'busy' : state === 'gone' ? 'gone' : ERR.INTERNAL, info?.reason);
      P.promoteWaiters.splice(0).forEach((w) => w.reject(err));
      // the observe stream keeps running; tell the promoter why control failed
      const writer = P.writer;
      P.writer = null;
      if (writer && P.viewers.has(writer)) writer.sendJson({ ...this._stateMsg(P, writer), state, detail: info?.reason ?? '' });
      return;
    }
    if (child !== P.child) return;
    this.clock.clearTimeout(P.idleTimer);
    if (child.mode === 'control' && (state === 'taken' || state === 'released') && P.viewers.size) {
      // Another client took control (or herdr detached us): stay in Peek on a fresh observe stream (taken).
      P.writer = null;
      P.sticky = state === 'taken' ? 'taken' : null;
      P.state = state;
      P.detail = info?.reason ?? '';
      P.child = null;
      this._broadcastState(P);
      this._observeAgain(P);
      return;
    }
    P.state = state;
    P.detail = info?.reason ?? '';
    P.child = null;
    this._broadcastState(P);
    this._dispose(P);
  }

  /** Fall back to an observe child sized by the sizer (demotion, taken, released). */
  _observeAgain(P: PaneState): void {
    const sv = P.sizer && P.viewers.get(P.sizer);
    const g = sv?.fit ?? { cols: P.cols, rows: P.rows };
    P.cols = g.cols;
    P.rows = g.rows;
    P.mirror?.dispose();
    P.mirror = null;
    this._resetViewers(P);
    P.child = this._spawn(P, 'observe', g.cols, g.rows);
  }

  _dispose(P: PaneState): void {
    this._retire(P.child);
    this._retire(P.pending);
    this.clock.clearTimeout(P.promoteTimer);
    this.clock.clearTimeout(P.idleTimer);
    this.clock.clearTimeout(P.respawnTimer);
    for (const v of P.viewers.values()) this._clearViewerTimers(v);
    P.mirror?.dispose();
    P.mirror = null;
    P.promoteWaiters.splice(0).forEach((w) => w.reject(hubError('gone')));
    for (const client of P.viewers.keys()) this.byClient.get(client)?.delete(P.id);
    this.panes.delete(P.id);
  }

  _clearViewerTimers(v: Viewer): void {
    this.clock.clearTimeout(v.ackTimer);
    this.clock.clearTimeout(v.pauseTimer);
    this.clock.clearTimeout(v.drainTimer);
  }

  _resetViewers(P: PaneState): void {
    for (const v of P.viewers.values()) {
      v.needsFull = false;
      v.fullPending = false;
      v.fullToken = null;
      v.queue = [];
    }
  }

  _viewer(P: PaneState, client: HubClient): Viewer {
    const v = P.viewers.get(client);
    if (!v) throw hubError(ERR.BAD_MESSAGE, 'term not open');
    return v;
  }

  _pane(id: string): PaneState {
    const P = this.panes.get(id);
    if (!P) throw hubError(ERR.BAD_MESSAGE, 'term not open');
    return P;
  }

  /** Oldest active (not paused, not orphaned) viewer. */
  _nextSizer(P: PaneState, except: HubClient | null = null): HubClient | null {
    const next = [...P.viewers.entries()].filter(([c, v]) => c !== except && !v.paused && !v.orphan).sort((a, b) => a[1].since - b[1].since)[0];
    return next?.[0] ?? null;
  }

  /** Sizer changed: respawn the observe child only if the grids differ by > 10 %. */
  _handSizer(P: PaneState, next: HubClient | null): void {
    P.sizer = next;
    if (!next || P.child?.mode !== 'observe' || P.pending) return;
    const f = P.viewers.get(next)?.fit;
    if (f && differs(f, { cols: P.child.cols, rows: P.child.rows })) this._respawnObserve(P, next);
  }

  _respawnObserve(P: PaneState, sizer: HubClient): void {
    const wait = P.lastRespawn + LIMITS.respawnPerPaneMs - this.clock.now();
    this.clock.clearTimeout(P.respawnTimer);
    const respawn = () => {
      P.respawnTimer = null;
      if (!this.panes.has(P.id) || P.child?.mode !== 'observe' || P.sizer !== sizer || P.pending) return;
      const f = P.viewers.get(sizer)?.fit;
      if (!f || (P.child.cols === f.cols && P.child.rows === f.rows)) return;
      P.lastRespawn = this.clock.now();
      const old = P.child;
      P.child = this._spawn(P, 'observe', f.cols, f.rows);
      P.cols = f.cols;
      P.rows = f.rows;
      this._retire(old);
      P.mirror?.dispose();
      P.mirror = null;
      this._resetViewers(P); // the new child's first frame is full
    };
    if (wait > 0) P.respawnTimer = this.clock.setTimeout(respawn, wait);
    else respawn();
  }

  _armIdle(P: PaneState): void {
    this.clock.clearTimeout(P.idleTimer);
    P.idleTimer = null;
    if (P.child?.mode !== 'control' || !this.idleDemotion()) return;
    P.idleTimer = this.clock.setTimeout(() => this._demote(P, 'idle'), IDLE_DEMOTE_MS);
  }

  /** Release control, fall back to observe (idle demotion / explicit). */
  _demote(P: PaneState, why: string): void {
    if (!this.panes.has(P.id) || P.child?.mode !== 'control') return;
    this.counters.demotions++;
    const old = P.child;
    P.child = null;
    P.writer = null;
    P.sticky = null;
    P.state = 'released';
    P.detail = why;
    this._retire(old);
    this._broadcastState(P);
    this._observeAgain(P);
  }

  // ------------------------------------------------------------------ API (one method per term.* message)

  /** `term.open` → {mode, cols, rows}. Resumes a dropped client's viewer within the grace window (same cid). */
  open(client: HubClient, { id, cols, rows }: { id: string } & Grid): TermOpenReply {
    let mine = this.byClient.get(client);
    if (!mine) this.byClient.set(client, (mine = new Set()));
    let P = this.panes.get(id);
    const orphan = P && !P.viewers.has(client) && client.cid ? this.orphans.get(client.cid) : undefined;
    if (P && orphan && client.cid) {
      const old = orphan.client;
      const v = P.viewers.get(old);
      if (v) {
        // grace resume: the same viewer (roles, credit) continues on the new socket with one full frame
        P.viewers.delete(old);
        v.orphan = false;
        v.fit = { cols, rows };
        P.viewers.set(client, v);
        if (P.writer === old) P.writer = client;
        if (P.sizer === old) P.sizer = client;
        this.byClient.get(old)?.delete(id);
        mine.add(id);
        this.counters.resumes++;
        if (!this.byClient.get(old)?.size) this._forgetOrphan(client.cid);
        this._sendState(P, client);
        v.fullPending = false;
        this._sendFull(P, client, v);
        return this._openReply(P, cols, rows);
      }
    }
    const existing = P?.viewers.get(client);
    if (P && existing) {
      existing.fit = { cols, rows };
      this._sendState(P, client);
      this._sendFull(P, client, existing);
      return this._openReply(P, cols, rows);
    }
    if (!P && !this.online()) throw hubError(ERR.HERDR_OFFLINE, 'herdr is offline');
    if (mine.size >= LIMITS.viewersPerClient) throw hubError(ERR.TERMINAL_LIMIT, 'viewers per client');
    if (!P && this._children() >= LIMITS.childrenPerBackend) throw hubError(ERR.TERMINAL_LIMIT, 'children per backend');
    if (!P) {
      P = { id, cols, rows, state: 'connecting', detail: undefined, child: null, pending: null, mirror: null, sticky: null,
        viewers: new Map(), writer: null, sizer: client, queue: [], promoteWaiters: [], lastRespawn: this.clock.now(),
        respawnTimer: null, promoteTimer: null, idleTimer: null };
      this.panes.set(id, P);
      P.child = this._spawn(P, 'observe', cols, rows);
    }
    const v = { paused: false, orphan: false, needsFull: false, fullPending: false, queue: [], written: 0, acked: 0,
      ackTimer: null, pauseTimer: null, drainTimer: null, fit: { cols, rows }, since: this.clock.now() };
    P.viewers.set(client, v);
    if (!P.sizer || !P.viewers.has(P.sizer)) this._handSizer(P, client);
    mine.add(id);
    this._sendState(P, client);
    if (P.child?.live) this._sendFull(P, client, v);
    return this._openReply(P, cols, rows);
  }

  _openReply(P: PaneState, cols: number, rows: number): TermOpenReply {
    return { mode: P.child?.mode ?? 'observe', cols: P.child?.cols ?? cols, rows: P.child?.rows ?? rows };
  }

  /** `term.promote` → resolves {mode:'control', cols, rows} after the swap. */
  async promote(client: HubClient, { id, cols, rows, takeover = false }: { id: string; takeover?: boolean } & Grid): Promise<TermOpenReply> {
    const P = this._pane(id);
    const v = this._viewer(P, client);
    if (this.readOnly()) throw hubError(ERR.READONLY_PROTOCOL, 'herdr is read-only: no control');
    v.fit = { cols, rows };
    P.writer = client;
    P.sticky = null;
    if (P.child?.mode === 'control' && !takeover) {
      this._broadcastState(P);
      return { mode: 'control', cols: P.child.cols, rows: P.child.rows };
    }
    if (!P.pending) {
      if (this._children() >= LIMITS.childrenPerBackend + 1) throw hubError(ERR.TERMINAL_LIMIT, 'children per backend');
      // control size policy: layoutRect if it fits in the writer's grid, else the writer's grid
      const lr = this.layoutRect(id);
      const [c, r] = lr && lr.cols <= cols && lr.rows <= rows ? [lr.cols, lr.rows] : [cols, rows];
      this.counters.promotes++;
      P.pending = this._spawn(P, 'control', c, r, takeover);
      this.clock.clearTimeout(P.promoteTimer);
      P.promoteTimer = this.clock.setTimeout(() => {
        const pend = P.pending;
        if (!pend) return;
        P.pending = null;
        P.queue = [];
        this._retire(pend);
        P.promoteWaiters.splice(0).forEach((w) => w.reject(hubError(ERR.INTERNAL, 'control did not start within 5 s')));
      }, PROMOTE_TIMEOUT_MS);
    }
    await new Promise<void>((resolve, reject) => P.promoteWaiters.push({ resolve, reject }));
    if (!P.child) throw hubError('gone'); // the waiters resolve right after P.child is set
    return { mode: 'control', cols: P.child.cols, rows: P.child.rows };
  }

  /**
   * Input bytes (interactive or paste). Resolves once written (the child's stdin drained).
   */
  async input(client: HubClient, id: string, bytes: Uint8Array): Promise<TermInputResult> {
    const P = this.panes.get(id);
    const v = P?.viewers.get(client);
    if (!P || !v || P.writer !== client || !(P.child?.mode === 'control' || P.pending)) return { ok: false, error: ERR.NOT_CONTROLLER };
    if (P.pending) P.queue.push(bytes);
    else {
      this._armIdle(P);
      await P.child?.handle.input(bytes); // not pending, so the control child exists (checked above)
    }
    v.written += bytes.length;
    this._ack(P, client, v);
    return { ok: true };
  }

  _ack(P: PaneState, client: HubClient, v: Viewer): void {
    const send = () => {
      v.ackTimer = null;
      if (v.acked === v.written || !P.viewers.has(client)) return;
      v.acked = v.written;
      client.sendJson({ t: S2R.TERM_ACK, id: P.id, upTo: v.written });
    };
    if (v.written - v.acked >= LIMITS.ackEveryBytes) {
      this.clock.clearTimeout(v.ackTimer);
      send();
    } else if (!v.ackTimer) v.ackTimer = this.clock.setTimeout(send, LIMITS.ackEveryMs);
  }

  /** Resend term.state to a viewer (interactive input from an observe viewer). */
  resendState(client: HubClient, id: string): void {
    const P = this.panes.get(id);
    if (P?.viewers.has(client)) this._sendState(P, client);
  }

  /** `term.writer`: take the keyboard from another HQ window (no herdr takeover). */
  writer(client: HubClient, { id }: { id: string }): Record<never, never> {
    const P = this._pane(id);
    this._viewer(P, client);
    if (P.child?.mode !== 'control' && !P.pending) throw hubError(ERR.NOT_CONTROLLER, 'no control stream; promote first');
    P.writer = client;
    this._broadcastState(P);
    return {};
  }

  /** `term.fit`: observe → respawn at the sizer's grid (rate-limited); control → stored only. */
  fit(client: HubClient, { id, cols, rows }: { id: string } & Grid): Record<never, never> {
    const P = this._pane(id);
    const v = this._viewer(P, client);
    v.fit = { cols, rows };
    if (P.child?.mode !== 'observe' || P.sizer !== client || P.pending) return {};
    if (P.child.cols === cols && P.child.rows === rows) return {};
    this._respawnObserve(P, client);
    return {};
  }

  /** `term.resize`: explicit user resize; control writer only. */
  resize(client: HubClient, { id, cols, rows }: { id: string } & Grid): Grid {
    const P = this.panes.get(id);
    if (!P || P.writer !== client || P.child?.mode !== 'control') throw hubError(ERR.NOT_CONTROLLER, 'resize needs the control writer');
    P.child.handle.resize(cols, rows);
    P.child.cols = cols;
    P.child.rows = rows;
    P.mirror?.resize(cols, rows);
    this._broadcastState(P);
    return { cols, rows };
  }

  /** `term.scroll`: control writer only (ws.ts also checks setting scrollMode:'herdr'). */
  async scroll(client: HubClient, { id, dir, lines = 0 }: { id: string; dir: 'up' | 'down' | 'bottom'; lines?: number }): Promise<{ offsetFromBottom: number }> {
    const P = this.panes.get(id);
    if (!P || P.writer !== client || P.child?.mode !== 'control') throw hubError(ERR.NOT_CONTROLLER, 'scroll needs the control writer');
    P.child.handle.scroll(dir, lines);
    this._armIdle(P);
    await new Promise<void>((r) => this.clock.setTimeout(r, 30));
    const off = await this.paneScroll(id).catch(() => null);
    return { offsetFromBottom: off ?? 0 };
  }

  pause(client: HubClient, { id }: { id: string }): Record<never, never> {
    const P = this._pane(id);
    const v = this._viewer(P, client);
    if (v.paused) return {};
    v.paused = true;
    this.clock.clearTimeout(v.pauseTimer);
    v.pauseTimer = this.clock.setTimeout(() => {
      if (!P.viewers.has(client) || !v.paused) return;
      client.sendJson({ ...this._stateMsg(P, client), state: 'released', detail: 'paused too long' });
      this.close(client, { id });
    }, LIMITS.pausedDropMs);
    if (P.sizer === client) {
      const next = this._nextSizer(P, client);
      if (next) this._handSizer(P, next);
    }
    return {};
  }

  resume(client: HubClient, { id }: { id: string }): Record<never, never> {
    const P = this._pane(id);
    const v = this._viewer(P, client);
    v.paused = false;
    this.clock.clearTimeout(v.pauseTimer);
    if (!P.sizer || !P.viewers.has(P.sizer) || P.viewers.get(P.sizer)?.paused) this._handSizer(P, client);
    this._sendState(P, client);
    v.fullPending = false;
    this._sendFull(P, client, v);
    return {};
  }

  /** `term.close`: last viewer releases the child. */
  close(client: HubClient, { id }: { id: string }): Record<never, never> {
    const P = this.panes.get(id);
    this.byClient.get(client)?.delete(id);
    const pv = P?.viewers.get(client);
    if (!P || !pv) return {};
    this._clearViewerTimers(pv);
    P.viewers.delete(client);
    if (P.writer === client) P.writer = null;
    if (!P.viewers.size) {
      this._dispose(P);
      return {};
    }
    if (P.sizer === client) this._handSizer(P, this._nextSizer(P));
    this._broadcastState(P);
    return {};
  }

  /** Client socket gone: keep its viewers for LIMITS.graceMs keyed by cid (resume on term.open from the same cid). */
  dropClient(client: HubClient): void {
    const ids = [...(this.byClient.get(client) ?? [])];
    const cid = client.cid;
    if (!ids.length || !cid) {
      for (const id of ids) this.close(client, { id });
      this.byClient.delete(client);
      return;
    }
    this._forgetOrphan(cid, true);
    for (const id of ids) {
      const P = this.panes.get(id);
      const v = P?.viewers.get(client);
      if (v) v.orphan = true;
      if (P && P.sizer === client) {
        const next = this._nextSizer(P);
        if (next) this._handSizer(P, next);
      }
    }
    const timer = this.clock.setTimeout(() => this._forgetOrphan(cid, true), LIMITS.graceMs);
    this.orphans.set(cid, { client, timer });
  }

  _forgetOrphan(cid: string, closeViewers = false): void {
    const o = this.orphans.get(cid);
    if (!o) return;
    this.clock.clearTimeout(o.timer);
    this.orphans.delete(cid);
    if (closeViewers) for (const id of [...(this.byClient.get(o.client) ?? [])]) this.close(o.client, { id });
    this.byClient.delete(o.client);
  }

  /** Pane vanished from the world: viewers see `gone`. */
  paneGone(id: string, reason = 'pane closed'): void {
    const P = this.panes.get(id);
    if (!P) return;
    P.state = 'gone';
    P.detail = reason;
    this._broadcastState(P);
    this._dispose(P);
  }

  /** herdr went offline: every drawer shows `offline` (children will die with the socket anyway). */
  offline(): void {
    for (const P of [...this.panes.values()]) {
      P.state = 'offline';
      P.detail = 'herdr offline';
      this._broadcastState(P);
      this._dispose(P);
    }
  }

  /** Live mirror of a pane (screens.ts). */
  mirrorOf(id: string): Mirror | null {
    const P = this.panes.get(id);
    return P?.child?.live ? P.mirror : null;
  }

  metrics(): HubMetrics {
    const out: HubMetrics = { panes: this.panes.size, children: { observe: 0, control: 0, pending: 0 }, viewers: 0, orphans: this.orphans.size,
      mirrors: 0, ...this.counters };
    for (const P of this.panes.values()) {
      if (P.child) out.children[P.child.mode]++;
      if (P.pending) out.children.pending++;
      if (P.mirror) out.mirrors++;
      out.viewers += P.viewers.size;
    }
    return out;
  }

  /** Release every child and await exit. */
  async closeAll(): Promise<void> {
    const waits: (Promise<void> | null)[] = [];
    for (const o of this.orphans.values()) this.clock.clearTimeout(o.timer);
    this.orphans.clear();
    for (const P of [...this.panes.values()]) {
      waits.push(this._retire(P.child), this._retire(P.pending));
      this._dispose(P);
    }
    await Promise.all(waits.filter(Boolean));
  }
}
