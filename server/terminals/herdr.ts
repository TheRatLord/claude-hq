/**
 * HerdrTerminals: the live `TerminalBackend`. One `herdr terminal session {observe|control}`
 * child per handle, NDJSON over plain pipes (no PTY).
 *
 *   - stdin stays open for the child's life (EOF detaches a control child).
 *   - the exit code is always 0: only `terminal.closed.reason` is trusted (table → closedReasonToState).
 *   - observe children ignore `terminal.release` and stdin EOF (verified): release = SIGTERM, SIGKILL after 1 s.
 *   - control release = `terminal.release`, SIGTERM after 1 s if still alive, SIGKILL 1 s later.
 *   - spawns are rate limited to LIMITS.spawnsPerSec per backend (the handle exists at once; the child follows).
 *   - `input()` resolves when the child's stdin has drained (paste gate).
 */
import type { ChildProcess } from 'node:child_process';
import { TerminalBackend, TerminalHandle } from '../interfaces.ts';
import type { Clock, Logger, TerminalOpenOpts, TimerHandle } from '../interfaces.ts';
import { LIMITS } from '../../shared/protocol.ts';
import { isRecord, errMessage } from '../../shared/guards.ts';
import { ndjson } from '../herdr/client.ts';
import type { HerdrClient } from '../herdr/client.ts';

const b64 = (u8: Uint8Array): string => Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');

class HerdrHandle extends TerminalHandle {
  backend: HerdrTerminals;
  id: string;
  mode: TerminalOpenOpts['mode'];
  override cols: number;
  override rows: number;
  child: ChildProcess | null;
  exited: boolean;
  _exitWaiters: (() => void)[];
  _killTimers: TimerHandle[];
  _releasing = false;
  constructor(backend: HerdrTerminals, id: string, o: TerminalOpenOpts) {
    super();
    this.backend = backend;
    this.id = id;
    this.mode = o.mode;
    this.cols = o.cols;
    this.rows = o.rows;
    this.child = null;
    this.exited = false;
    this._exitWaiters = [];
    this._killTimers = [];
  }

  _start(o: TerminalOpenOpts): void {
    if (this.closedWith) return;
    let child: ChildProcess;
    try {
      child = this.backend.client.spawnTerm({ mode: this.mode, paneId: this.id, cols: this.cols, rows: this.rows,
        takeover: o.takeover, promoteToken: o.promoteToken });
    } catch (e) {
      this._closed({ code: null, reason: `terminal session ${this.mode} failed: ${errMessage(e)}` });
      this.exited = true;
      return;
    }
    this.child = child;
    // spawnTerm pipes all three stdio streams
    const { stdin, stdout, stderr } = child as ChildProcess & { stdin: NonNullable<ChildProcess['stdin']>; stdout: NonNullable<ChildProcess['stdout']>; stderr: NonNullable<ChildProcess['stderr']> };
    stdin.on('error', () => {});
    stderr.on('data', (d) => this.backend.log.debug(`[${this.id} ${this.mode}] ${String(d).trim().slice(0, 200)}`));
    ndjson(stdout, (m) => {
      if (!isRecord(m)) return;
      if (m.type === 'terminal.frame') {
        if (typeof m.width === 'number' && typeof m.height === 'number' && m.width && m.height) {
          this.cols = m.width;
          this.rows = m.height;
        }
        const bytes = Buffer.from(typeof m.bytes === 'string' ? m.bytes : '', 'base64');
        this._frame(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), !!m.full);
      } else if (m.type === 'terminal.closed') this._closed({ code: null, reason: String(m.reason ?? '') });
    });
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (this.exited) return;
      this.exited = true;
      for (const t of this._killTimers) this.backend.clock.clearTimeout(t);
      this._closed({ code: code ?? null, reason: signal ? `exited (${signal})` : 'exited' });
      this._exitWaiters.splice(0).forEach((f) => f());
      this.backend._forget(this);
    };
    child.once('exit', onExit);
    child.once('error', (e) => {
      this._closed({ code: null, reason: `terminal session ${this.mode} failed: ${errMessage(e)}` });
      onExit(null, null);
    });
  }

  _send(obj: object): boolean {
    const c = this.child;
    if (!c || this.exited || !c.stdin?.writable) return false;
    return c.stdin.write(JSON.stringify(obj) + '\n');
  }

  /** Resolves once stdin drained. */
  override input(bytes: Uint8Array): Promise<void> {
    if (this.mode !== 'control') return Promise.resolve();
    if (!this.child) {
      // spawn still rate-limited: wait for it
      return new Promise<void>((resolve) => this.backend._afterSpawn(this, () => resolve(this.input(bytes))));
    }
    const ok = this._send({ type: 'terminal.input', bytes: b64(bytes) });
    const child = this.child;
    if (ok || !child || this.exited) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = () => {
        this.child?.stdin?.off('drain', done);
        this.child?.off('exit', done);
        resolve();
      };
      child.stdin?.once('drain', done);
      child.once('exit', done);
    });
  }

  override resize(cols: number, rows: number): void {
    if (this.mode !== 'control') return;
    this.cols = cols;
    this.rows = rows;
    this._send({ type: 'terminal.resize', cols, rows });
  }

  override scroll(dir: 'up' | 'down' | 'bottom', lines: number): void {
    if (this.mode !== 'control') return; // ignored by observe anyway (verified)
    if (dir === 'bottom') this._send({ type: 'terminal.scroll', direction: 'down', lines: 100_000 });
    else this._send({ type: 'terminal.scroll', direction: dir, lines: Math.max(1, lines | 0) });
  }

  _later(ms: number, fn: () => void): void {
    const t = this.backend.clock.setTimeout(fn, ms);
    this._killTimers.push(t);
  }

  _signal(sig: NodeJS.Signals): void {
    try {
      if (!this.exited) this.child?.kill(sig);
    } catch {}
  }

  /** control → terminal.release (+SIGTERM after 1 s); observe → SIGTERM; SIGKILL 1 s after SIGTERM. Resolves on exit. */
  override release(): Promise<void> {
    if (!this.child || this.exited) {
      this.backend._cancelSpawn(this);
      if (!this.closedWith) this._closed({ code: null, reason: 'terminal session detached' });
      return Promise.resolve();
    }
    const exited = new Promise<void>((r) => this._exitWaiters.push(r));
    if (this._releasing) return exited;
    this._releasing = true;
    const term = () => {
      this._signal('SIGTERM');
      this._later(1000, () => this._signal('SIGKILL'));
    };
    if (this.mode === 'control') {
      this._send({ type: 'terminal.scroll', direction: 'down', lines: 100_000 }); // hub rule: scroll bottom before release
      this._send({ type: 'terminal.release' });
      this._later(1000, term);
    } else term();
    return exited;
  }

  /** Immediate SIGKILL (second signal during shutdown). */
  kill(): void {
    this.backend._cancelSpawn(this);
    this._signal('SIGKILL');
  }
}

export interface HerdrTerminalsOpts { client: HerdrClient; clock: Clock; log?: Logger }

export class HerdrTerminals extends TerminalBackend {
  client: HerdrClient;
  clock: Clock;
  log: Logger;
  handles: Set<HerdrHandle>;
  _spawnTimes: number[];
  _queue: { h: HerdrHandle; o: TerminalOpenOpts }[];
  _queueTimer: TimerHandle | null;
  _after: Map<HerdrHandle, (() => void)[]>;
  constructor({ client, clock, log }: HerdrTerminalsOpts) {
    super();
    this.client = client;
    this.clock = clock;
    this.log = log ?? { debug() {}, info() {}, warn() {}, error() {} };
    this.handles = new Set();
    this._spawnTimes = [];
    this._queue = [];
    this._queueTimer = null;
    this._after = new Map();
  }

  /** One-shot control token (TerminalHub calls this on `term.promote` only). */
  mintPromoteToken(id: string): string {
    return this.client.mintPromoteToken(id);
  }

  override open(id: string, o: TerminalOpenOpts): HerdrHandle {
    const h = new HerdrHandle(this, id, o);
    this.handles.add(h);
    this._queue.push({ h, o });
    this._pump();
    return h;
  }

  _pump(): void {
    const now = this.clock.now();
    this._spawnTimes = this._spawnTimes.filter((t) => now - t < 1000);
    while (this._queue.length && this._spawnTimes.length < LIMITS.spawnsPerSec) {
      const { h, o } = this._queue.shift() as { h: HerdrHandle; o: TerminalOpenOpts }; // loop condition: non-empty
      this._spawnTimes.push(now);
      h._start(o);
      for (const fn of this._after.get(h) ?? []) fn();
      this._after.delete(h);
    }
    if (this._queue.length && !this._queueTimer) {
      const wait = Math.max(10, 1000 - (now - this._spawnTimes[0]));
      this._queueTimer = this.clock.setTimeout(() => {
        this._queueTimer = null;
        this._pump();
      }, wait);
    }
  }

  _afterSpawn(h: HerdrHandle, fn: () => void): void {
    if (!this._queue.some((q) => q.h === h)) return fn();
    const list = this._after.get(h) ?? [];
    list.push(fn);
    this._after.set(h, list);
  }

  _cancelSpawn(h: HerdrHandle): void {
    const i = this._queue.findIndex((q) => q.h === h);
    if (i >= 0) this._queue.splice(i, 1);
    this._after.delete(h);
    if (!h.child) this.handles.delete(h);
  }

  _forget(h: HerdrHandle): void {
    this.handles.delete(h);
  }

  metrics(): Record<'observe' | 'control' | 'queued', number> {
    const out = { observe: 0, control: 0, queued: this._queue.length };
    for (const h of this.handles) if (h.child && !h.exited) out[h.mode]++;
    return out;
  }

  /** Release every child and await exit (≤ ~2 s). */
  override async close(): Promise<void> {
    this.clock.clearTimeout(this._queueTimer);
    this._queue = [];
    await Promise.all([...this.handles].map((h) => h.release()));
  }

  /** Second signal: SIGKILL everything now. */
  killAll(): void {
    for (const h of this.handles) h.kill();
  }
}
