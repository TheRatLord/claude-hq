/**
 * --record / --replay (DESIGN §4.9). Owner: BE2.
 *
 * Recording (NDJSON, one object per line, `at` = server clock ms):
 *   {k:'header', v:1, at, session, demo, owners:[…]}
 *   {k:'snapshot', at, raw} · {k:'status', at, id, status, seq, raw} · {k:'connected', at, connected} · {k:'reconnected', at}
 *   {k:'patch', at, owner, id, patch} · {k:'event', at, owner, id, kind, detail?}
 * i.e. every HerdrSource snapshot/status, every enricher patch AND every emitEvent. Source listeners are prepended so a
 * snapshot line precedes the patches its application triggers.
 *
 * Replay: `ReplaySource` (a HerdrSource) re-emits snapshots/status/connectivity on the clock (÷ speed), and one
 * `ReplayEnricher` per recorded owner re-emits patches and events through the same onPatch/emitEvent seams, so the
 * WorldModel output stream is reproduced (the golden test, M2, diffs it).
 *
 * Recordings may contain prompts and paths: they stay local (git-ignored), except the scrubbed golden fixture (M2).
 */
import fs from 'node:fs';
import { HerdrSource, Enricher } from './interfaces.ts';
import type { Clock, Logger, RawSnapshot, TimerHandle } from './interfaces.ts';
import type { Entity, EventKind, OwnerName, Status } from '../shared/protocol.ts';
import { isRecord, errMessage } from '../shared/guards.ts';

export const RECORD_VERSION = 1;

/** What a recording line says (the `at` stamp and the source-event numbering are added around it). */
export type RecordItem =
  | { k: 'header'; v: number; session: string | null; demo: boolean; owners: OwnerName[] }
  | { k: 'snapshot'; raw: RawSnapshot }
  | { k: 'status'; id: string; status: Status; seq: number | null; raw: RawSnapshot | null }
  | { k: 'connected'; connected: boolean }
  | { k: 'reconnected' }
  | { k: 'ready' }
  | { k: 'patch'; owner: OwnerName; id: string; patch: Partial<Entity> }
  | { k: 'event'; owner: OwnerName; id: string; kind: EventKind; detail?: unknown };
/**
 * One NDJSON line: `at` = server clock ms; `n` numbers a source event; `in: n` marks a patch/event produced while the
 * model handled source event n.
 */
export type RecordLine = RecordItem & { at: number; n?: number; in?: number };
type HeaderLine = Extract<RecordLine, { k: 'header' }>;
/** A recorded enricher output. */
export type ReplayItem = Extract<RecordLine, { k: 'patch' | 'event' }>;

const RECORD_KINDS: readonly string[] = ['header', 'snapshot', 'status', 'connected', 'reconnected', 'ready', 'patch', 'event'];
// A line of our own recordings: only the discriminant is checked (a garbled line is dropped by parseRecording).
const isRecordLine = (v: unknown): v is RecordLine => isRecord(v) && typeof v.k === 'string' && RECORD_KINDS.includes(v.k);

/**
 * Start recording `source` + `enrichers` to `file`. Call BEFORE the WorldModel is constructed: the seams are
 * intercepted with accessors, so whatever onPatch/emitEvent the model installs is wrapped, and the patches from the
 * model's initial apply are recorded right after the first snapshot; call `ready()` once the model exists (the replay
 * re-emits the patches before that line from `attach`). Returns {ready(), close()}.
 */
export interface RecorderOpts {
  /** the recording file (unused when `write` is given) */
  file?: string;
  source: HerdrSource;
  enrichers: Enricher[];
  clock: Pick<Clock, 'now'>;
  session?: string | null;
  demo?: unknown;
  write?: (line: string) => void;
}

export function attachRecorder({ file, source, enrichers, clock, session = null, demo = false, write }: RecorderOpts): { ready(): void; close(): Promise<void> } {
  let out: fs.WriteStream | null = null;
  let sink: (line: string) => void;
  if (write) sink = write;
  else if (file !== undefined) sink = (line) => void (out ??= fs.createWriteStream(file, { flags: 'a', mode: 0o600 })).write(line);
  else throw new Error('attachRecorder: file or write required');
  const rec = (o: RecordItem & { n?: number; in?: number }) => sink(JSON.stringify({ ...o, at: clock.now() }) + '\n');
  rec({ k: 'header', v: RECORD_VERSION, session, demo: !!demo, owners: enrichers.map((e) => e.name) });
  const first = source.snapshot();
  if (first) rec({ k: 'snapshot', raw: first });
  // Source events are numbered (`n`); patches/events the model's synchronous handling of event n produces carry
  // `in: n` (a trailing listener, installed by ready() after the model's, closes the window) so replay can re-emit
  // them from inside the enricher's update()/attach(), in the same entity message as live.
  let evSeq = 0, cur: number | null = null;
  let ready = false;
  const open = (o: RecordItem) => {
    cur = ready ? ++evSeq : null;
    rec(cur ? { ...o, n: cur } : o);
  };
  const on = {
    snapshot: (raw: RawSnapshot) => open({ k: 'snapshot', raw }),
    // the model re-reads source.snapshot() on status, so record what it will read (rollups included)
    status: (id: string, status: Status, seq: number | null) => open({ k: 'status', id, status, seq: seq ?? null, raw: source.snapshot() }),
    connected: (c: boolean) => open({ k: 'connected', connected: !!c }),
    reconnected: () => open({ k: 'reconnected' }),
  };
  const closeWin = () => (cur = null);
  source.prependListener('snapshot', on.snapshot);
  source.prependListener('status', on.status);
  source.prependListener('connected', on.connected);
  source.prependListener('reconnected', on.reconnected);
  const restore: (() => void)[] = [];
  let live = true;
  for (const e of enrichers) {
    const inner = { onPatch: e.onPatch, emitEvent: e.emitEvent };
    const wrapped = {
      onPatch: (id: string, patch: Partial<Entity>) => {
        if (live) rec({ k: 'patch', owner: e.name, id, patch, ...(cur ? { in: cur } : {}) });
        return inner.onPatch.call(e, id, patch);
      },
      emitEvent: (id: string, kind: EventKind, detail?: unknown) => {
        if (live) rec({ k: 'event', owner: e.name, id, kind, ...(detail !== undefined ? { detail } : {}), ...(cur ? { in: cur } : {}) });
        return inner.emitEvent.call(e, id, kind, detail);
      },
    };
    // the model installs its own onPatch/emitEvent later: the setters keep it as the inner target
    Object.defineProperty(e, 'onPatch', { configurable: true, enumerable: true, get: () => wrapped.onPatch, set: (fn: Enricher['onPatch']) => { inner.onPatch = fn; } });
    Object.defineProperty(e, 'emitEvent', { configurable: true, enumerable: true, get: () => wrapped.emitEvent, set: (fn: Enricher['emitEvent']) => { inner.emitEvent = fn; } });
    restore.push(() => {
      Object.defineProperty(e, 'onPatch', { configurable: true, enumerable: true, writable: true, value: inner.onPatch });
      Object.defineProperty(e, 'emitEvent', { configurable: true, enumerable: true, writable: true, value: inner.emitEvent });
    });
  }
  return {
    /** Call right after the WorldModel is constructed: patches before this line are the initial world's. */
    ready: () => {
      if (ready) return;
      ready = true;
      source.on('snapshot', closeWin);
      source.on('status', closeWin);
      source.on('connected', closeWin);
      source.on('reconnected', closeWin);
      rec({ k: 'ready' });
    },
    close: () =>
      new Promise<void>((resolve) => {
        live = false;
        source.off('snapshot', on.snapshot);
        source.off('status', on.status);
        source.off('connected', on.connected);
        source.off('reconnected', on.reconnected);
        source.off('snapshot', closeWin);
        source.off('status', closeWin);
        source.off('connected', closeWin);
        source.off('reconnected', closeWin);
        for (const r of restore) r();
        if (out) out.end(resolve);
        else resolve();
      }),
  };
}

/** Parse a recording (skips blank/garbled lines). */
export function parseRecording(text: string): { header: Pick<HeaderLine, 'owners' | 'demo' | 'session' | 'v'>; items: RecordLine[] } {
  const lines: RecordLine[] = [];
  for (const l of text.split('\n')) {
    if (!l.trim()) continue;
    try {
      const o: unknown = JSON.parse(l);
      if (isRecordLine(o)) lines.push(o);
    } catch {}
  }
  const header = lines.find((l): l is HeaderLine => l.k === 'header') ?? { owners: [], demo: false, session: null, v: 0 };
  return { header, items: lines.filter((l) => l.k !== 'header') };
}

/**
 * Re-emits recorded patches/events for one owner (`owns`/`events` = the owner's rows). Patches recorded during the
 * model's initial apply are re-emitted from `attach`, exactly as the live enricher did.
 */
export class ReplayEnricher extends Enricher {
  /** id → merged initial patch */
  initial: Map<string, Partial<Entity>>;
  /** id → recorded items produced inside the source event being replayed */
  pending: Map<string, ReplayItem[]>;
  constructor(name: Enricher['name']) {
    super(name);
    this.initial = new Map();
    this.pending = new Map();
  }
  override attach(id: string): void {
    const p = this.initial.get(id);
    if (p) {
      this.initial.delete(id);
      this.onPatch(id, p);
    }
    this.drain(id);
  }
  override update(id: string): void {
    this.drain(id);
  }
  drain(id: string): void {
    const list = this.pending.get(id);
    if (!list) return;
    this.pending.delete(id);
    for (const it of list) {
      if (it.k === 'patch') this.onPatch(id, it.patch);
      else this.emitEvent(id, it.kind, it.detail);
    }
  }
}

/**
 * HerdrSource that replays a recording on `clock` at `speed`×. Read-only: `request()` answers ping/session.snapshot and
 * refuses everything else (`readonly_replay`).
 */
export interface ReplaySourceOpts {
  items: RecordLine[];
  clock: Clock;
  speed?: number;
  enrichers: Map<string, ReplayEnricher>;
  log?: Pick<Logger, 'debug'>;
}

export class ReplaySource extends HerdrSource {
  items: RecordLine[];
  clock: Clock;
  speed: number;
  enrichers: Map<string, ReplayEnricher>;
  log: Pick<Logger, 'debug'>;
  _raw: RawSnapshot | null;
  _i: number;
  _timer: TimerHandle | null;
  done: boolean;
  _t0: number;
  _startAt: number | null;
  constructor({ items, clock, speed = 1, enrichers, log }: ReplaySourceOpts) {
    super();
    this.items = items;
    this.clock = clock;
    this.speed = speed > 0 ? speed : 1;
    this.enrichers = enrichers;
    this.log = log ?? { debug() {} };
    this.connected = true;
    this._raw = null;
    this._i = 0;
    this._timer = null;
    this.done = false;
    // everything stamped at the first `at` is applied synchronously, so the WorldModel sees the initial world
    this._t0 = items[0]?.at ?? 0;
    this._startAt = null;
    const readyAt = items.findIndex((x) => x.k === 'ready');
    const initialEnd = readyAt >= 0 ? readyAt : items.findIndex((x) => x.at !== this._t0 || (x.k !== 'snapshot' && x.k !== 'patch'));
    while (this._i < (initialEnd < 0 ? items.length : initialEnd)) {
      const it = items[this._i++];
      if (it.k === 'snapshot') this._apply(it, true);
      else if (it.k === 'patch') {
        const e = enrichers.get(it.owner);
        if (e) e.initial.set(it.id, { ...(e.initial.get(it.id) ?? {}), ...it.patch });
      }
    }
  }

  override snapshot(): RawSnapshot | null {
    return this.connected && this._raw ? structuredClone(this._raw) : null;
  }

  /** Begin the timed replay. */
  start(): this {
    if (this._startAt !== null) return this;
    this._startAt = this.clock.now();
    this._next();
    return this;
  }

  _next(): void {
    if (this._i >= this.items.length) {
      this.done = true;
      this.emit('done');
      return;
    }
    this._arm(this._i);
  }

  _due(it: RecordLine): number {
    return (this._startAt ?? 0) + (it.at - this._t0) / this.speed;
  }

  _arm(idx: number): void {
    this._timer = this.clock.setTimeout(() => {
      this._timer = null;
      this._runDue();
    }, Math.max(0, this._due(this.items[idx]) - this.clock.now()));
  }

  /** Apply everything due now, in recorded order. */
  _runDue(): void {
    const now = this.clock.now();
    let end = this._i;
    while (end < this.items.length && this._due(this.items[end]) <= now) end++;
    // Arm the NEXT batch's timer before applying this one (M3.5 BE2): live, the source's timers were armed long before
    // the model's coalesce timer this batch arms, so on an equal due time they fired first; keep that order.
    if (end < this.items.length) this._arm(end);
    while (this._i < end) {
      const it = this.items[this._i++];
      if (it.n == null) {
        this._apply(it);
        continue;
      }
      // stage the items recorded inside this source event, emit it (enrichers drain from update/attach), then
      // re-emit whatever was not drained (ids the model did not touch) in order
      const nested: ReplayItem[] = [];
      while (this._i < this.items.length && this.items[this._i].in === it.n) {
        const x = this.items[this._i++];
        if (x.k === 'patch' || x.k === 'event') nested.push(x); // (only enricher output is ever nested)
      }
      for (const x of nested) {
        const e = this.enrichers.get(x.owner);
        if (!e) continue;
        const list = e.pending.get(x.id) ?? [];
        e.pending.set(x.id, list);
        list.push(x);
      }
      this._apply(it);
      for (const x of nested) this.enrichers.get(x.owner)?.drain(x.id);
    }
    if (end >= this.items.length && !this.done) this._next();
  }

  _apply(it: RecordLine, silent = false): void {
    switch (it.k) {
      case 'snapshot':
        this._raw = it.raw;
        if (!silent) this.emit('snapshot', structuredClone(it.raw));
        break;
      case 'status':
        if (it.raw) this._raw = it.raw;
        else if (this._raw) {
          const p = this._raw.panes?.find((x) => x.pane_id === it.id);
          if (p) p.agent_status = it.status;
          const a = this._raw.agents?.find((x) => x.pane_id === it.id);
          if (a) {
            a.agent_status = it.status;
            if (it.seq != null) a.state_change_seq = it.seq;
          }
        }
        this.emit('status', it.id, it.status, it.seq);
        break;
      case 'connected':
        this.connected = it.connected;
        this.emit('connected', it.connected);
        break;
      case 'reconnected':
        this.emit('reconnected', { grace: true });
        break;
      case 'ready':
        break;
      case 'patch': {
        const e = this.enrichers.get(it.owner);
        try {
          e?.onPatch(it.id, it.patch);
        } catch (err) {
          this.log.debug(`replay patch ${it.owner}: ${errMessage(err)}`);
        }
        break;
      }
      case 'event': {
        const e = this.enrichers.get(it.owner);
        try {
          e?.emitEvent(it.id, it.kind, it.detail);
        } catch (err) {
          this.log.debug(`replay event ${it.owner}/${it.kind}: ${errMessage(err)}`);
        }
        break;
      }
      default:
        break;
    }
  }

  override async request(method: string, params?: Record<string, unknown>): Promise<unknown> { // eslint-disable-line no-unused-vars
    if (method === 'ping') return { type: 'pong', version: 'replay', protocol: 22, capabilities: {} };
    if (method === 'session.snapshot') return { type: 'session_snapshot', snapshot: this.snapshot() };
    throw Object.assign(new Error(`replay is read-only (${method})`), { code: 'readonly_replay' });
  }

  metrics(): { items: number; applied: number; done: boolean } {
    return { items: this.items.length, applied: this._i, done: this.done };
  }

  override async close(): Promise<void> {
    this.clock.clearTimeout(this._timer ?? undefined);
    this._timer = null;
    this.removeAllListeners();
  }
}

/**
 * Build a replay: {source, enrichers, demo, header}. Wire the enrichers into the WorldModel (with `demo` choosing the
 * owner set), then `source.start()`.
 */
export function createReplay({ file, text, clock, speed = 1, log }: { file?: string; text?: string; clock: Clock; speed?: number; log?: Pick<Logger, 'debug'> }): {
  source: ReplaySource; enrichers: ReplayEnricher[]; demo: boolean; header: Pick<HeaderLine, 'owners' | 'demo' | 'session' | 'v'>;
} {
  let body = text;
  if (body === undefined) {
    if (file === undefined) throw new Error('createReplay: file or text required');
    body = fs.readFileSync(file, 'utf8');
  }
  const { header, items } = parseRecording(body);
  const owners = header.owners?.length ? header.owners : [...new Set(items.flatMap((i) => (i.k === 'patch' || i.k === 'event' ? [i.owner] : [])))];
  const map = new Map(owners.map((name): [string, ReplayEnricher] => [name, new ReplayEnricher(name)]));
  const source = new ReplaySource({ items, clock, speed, enrichers: map, log });
  return { source, enrichers: [...map.values()], demo: !!header.demo || owners.includes('demo'), header };
}
