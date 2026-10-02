/**
 * Transcripts enricher: tails each Claude pane's JSONL transcript and patches
 * activity / model / modelTier / contextTokens / outputTokens / todos / lastPrompt / title / struggle / lastText / work,
 * and emits error / test-pass / test-fail / commit / compact / struggle / news (one per finished turn).
 * Claude panes only.
 *
 * Load shaping: initial 512 KB tails are staggered (≤ 1 new tail per 50 ms) and parsed in ≤ 64 KB chunks with
 * a ≤ 4 ms budget per event-loop turn (yielding via setImmediate), so 40 agents × 22 MB files never stall the WS loop.
 * Backfill never emits events; only lines that arrive while tailing do.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Enricher } from '../interfaces.ts';
import type { BaseEntity, Clock, EnricherCtx, Logger, TimerHandle } from '../interfaces.ts';
import type { Activity, EventKind, Status } from '../../shared/protocol.ts';
import { errMessage } from '../../shared/guards.ts';
import { TranscriptState } from './transcriptState.ts';
import { dayStart } from '../../shared/pricing.ts';
import type { TranscriptActivity, TranscriptEvent } from './transcriptState.ts';

export const TAIL_BYTES = 512 * 1024;
const CHUNK = 64 * 1024;
const BUDGET_MS = 4;
const STAGGER_MS = 50;
const POLL_MS = 1500;
const GLOB_EVERY_MS = 10_000;
const STRUGGLE_TICK_MS = 30_000;
/** read-back of the transcript head (spend since midnight): chunk size and the most it reads before giving up (partial) */
const HEAD_CHUNK = 1024 * 1024;
export const HEAD_MAX = 64 * 1024 * 1024;

/** `~/.claude/projects/<cwd with [^A-Za-z0-9] → '-'>` */
export const projectSlug = (cwd: unknown): string => String(cwd ?? '').replace(/[^A-Za-z0-9]/g, '-');
export const defaultProjectsDir = (): string => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');

const yieldTurn = () => new Promise<void>((r) => setImmediate(r));

/** Set by `_stop` to abandon an in-flight parse. */
interface CancelToken { cancelled: boolean }

/** Per-pane record. */
interface Rec {
  id: string;
  sid: string | null;
  cwd: string | undefined;
  file: string | null;
  st: TranscriptState;
  offset: number;
  partial: string;
  ready: boolean;
  tok: CancelToken;
  watcher: fs.FSWatcher | null;
  poll: TimerHandle | null;
  tick: TimerHandle | null;
  reading: boolean;
  again: boolean;
  lastGlob: number;
  hint: EnricherCtx['sinceHint'] | undefined;
  status: Status | undefined;
  workingSince: number | null;
  sent: string;
  actKey: string;
  actSince: number;
  struggleLevel: number;
}

/**
 * Spend read-back: walk the file backwards from `end` in 1 MB chunks, feeding only assistant usage lines, until a line
 * older than `since` (today's midnight) shows up, the file starts, or `max` bytes were read (then `st.partialHead`).
 * Yields between chunks.
 */
export async function scanHead(fh: fs.promises.FileHandle, end: number, st: TranscriptState, since: number, tok: CancelToken, max = HEAD_MAX, chunk = HEAD_CHUNK): Promise<void> {
  let pos = end, carry = '', read = 0;
  while (pos > 0 && !tok.cancelled) {
    const len = Math.min(chunk, pos);
    pos -= len;
    read += len;
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, pos);
    const text = buf.toString('utf8') + carry;
    const lines = text.split('\n');
    carry = pos > 0 ? (lines.shift() ?? '') : ''; // the first line may continue in the previous chunk
    let oldest = Infinity;
    for (const line of lines) {
      if (line.length < 2 || !line.includes('"usage"')) continue;
      let o: unknown = null;
      try {
        o = JSON.parse(line);
      } catch {}
      const at = st.feedUsage(o);
      if (at != null && at < oldest) oldest = at;
    }
    if (oldest < since) return;
    if (pos > 0 && read >= max) {
      st.partialHead = true;
      return;
    }
    await yieldTurn();
  }
  if (carry) {
    try {
      st.feedUsage(JSON.parse(carry));
    } catch {}
  }
}

/**
 * Parse `text` (complete lines) into the state, yielding every ≤ 64 KB / 4 ms. Returns events from the lines.
 */
async function parseChunked(st: TranscriptState, text: string, now: number, tok: CancelToken): Promise<TranscriptEvent[]> {
  const events: TranscriptEvent[] = [];
  let i = 0, t0 = performance.now(), sinceYield = 0;
  while (i < text.length) {
    if (tok.cancelled) return events;
    let j = text.indexOf('\n', i);
    if (j < 0) j = text.length;
    const line = text.slice(i, j);
    sinceYield += j - i + 1;
    i = j + 1;
    if (line.length > 1) {
      let o: unknown = null;
      try {
        o = JSON.parse(line);
      } catch {}
      if (o) for (const e of st.feed(o, now)) events.push(e);
    }
    if (sinceYield >= CHUNK || performance.now() - t0 > BUDGET_MS) {
      await yieldTurn();
      t0 = performance.now();
      sinceYield = 0;
    }
  }
  return events;
}

export interface TranscriptsOpts {
  clock: Clock;
  log?: Logger;
  projectsDir?: string;
  staggerMs?: number;
  pollMs?: number;
  watch?: boolean;
}

/** The only part of the wire-up context this enricher reads (attach() is also called with a bare `{}` in tests) */
type SinceCtx = Partial<Pick<EnricherCtx, 'sinceHint'>>;

export class TranscriptsEnricher extends Enricher {
  clock: Clock;
  log: Logger;
  projectsDir: string;
  staggerMs: number;
  pollMs: number;
  useWatch: boolean;
  /** pane id → record */
  recs: Map<string, Rec>;
  /** records waiting for their initial tail */
  _queue: Rec[];
  _pumpTimer: TimerHandle | null;
  _closed: boolean;
  /** set by the first attach() */
  declare ctx?: SinceCtx;
  constructor({ clock, log, projectsDir = defaultProjectsDir(), staggerMs = STAGGER_MS, pollMs = POLL_MS, watch = true }: TranscriptsOpts) {
    super('transcripts');
    this.clock = clock;
    this.log = log ?? { debug() {}, info() {}, warn() {}, error() {} };
    this.projectsDir = projectsDir;
    this.staggerMs = staggerMs;
    this.pollMs = pollMs;
    this.useWatch = watch;
    this.recs = new Map();
    this._queue = [];
    this._pumpTimer = null;
    this._closed = false;
  }

  override attach(id: string, base: BaseEntity, ctx: SinceCtx = {}): void {
    this.ctx = ctx;
    this._sync(id, base, ctx);
  }

  override update(id: string, base: BaseEntity): void {
    this._sync(id, base, null);
  }

  override detach(id: string): void {
    const r = this.recs.get(id);
    if (r) this._stop(r);
    this.recs.delete(id);
  }

  override async close(): Promise<void> {
    this._closed = true;
    for (const r of this.recs.values()) this._stop(r);
    this.recs.clear();
    this.clock.clearTimeout(this._pumpTimer ?? undefined);
    this._pumpTimer = null;
    this._queue = [];
  }

  /** Leak/metrics surface (churn test). */
  metrics(): { panes: number; queued: number; watchers: number; polls: number; ticks: number } {
    let watchers = 0, polls = 0, ticks = 0;
    for (const r of this.recs.values()) {
      if (r.watcher) watchers++;
      if (r.poll) polls++;
      if (r.tick) ticks++;
    }
    return { panes: this.recs.size, queued: this._queue.length, watchers, polls, ticks };
  }

  // ------------------------------------------------------------------------------------------

  _sync(id: string, base: BaseEntity, ctx: SinceCtx | null): void {
    let found = this.recs.get(id);
    if (base.kind !== 'claude') {
      if (found) {
        this._stop(found);
        this.recs.delete(id);
        this.onPatch(id, { activity: null, model: null, modelTier: null, contextTokens: null, outputTokens: null, todos: null,
          lastPrompt: null, title: null, struggle: null, lastText: null, work: null, usage: null });
      }
      return;
    }
    const sid = base.identity?.agentSession ?? null;
    if (found && found.sid && sid && found.sid !== sid) {
      // agent_session changed (claude restarted / resumed another session): re-locate from scratch
      this._stop(found);
      this.recs.delete(id);
      found = undefined;
    }
    let r: Rec;
    if (!found) {
      r = {
        id, sid, cwd: base.cwd, file: null, st: new TranscriptState(), offset: 0, partial: '', ready: false, tok: { cancelled: false },
        watcher: null, poll: null, tick: null, reading: false, again: false, lastGlob: -Infinity, hint: ctx?.sinceHint ?? this.ctx?.sinceHint,
        status: base.status, workingSince: base.status === 'working' ? base.statusSince ?? null : null, sent: '', actKey: '', actSince: 0,
        struggleLevel: 0,
      };
      this.recs.set(id, r);
      if (sid) this._enqueue(r);
    } else {
      r = found;
      if (r.sid === null && sid) {
        r.sid = sid;
        this._enqueue(r);
      }
    }
    r.cwd = base.cwd;
    const wasWorking = r.status === 'working';
    r.status = base.status;
    if (base.status === 'working') {
      if (!wasWorking) r.workingSince = base.statusSince ?? this.clock.now();
      const rec = r;
      if (!r.tick) r.tick = this.clock.setInterval(() => this._patch(rec), STRUGGLE_TICK_MS);
    } else {
      r.workingSince = null;
      if (r.tick) this.clock.clearInterval(r.tick);
      r.tick = null;
    }
    this._patch(r);
  }

  _stop(r: Rec): void {
    r.tok.cancelled = true;
    try {
      r.watcher?.close();
    } catch {}
    r.watcher = null;
    if (r.poll) this.clock.clearInterval(r.poll);
    if (r.tick) this.clock.clearInterval(r.tick);
    r.poll = r.tick = null;
    this._queue = this._queue.filter((x) => x !== r);
  }

  _enqueue(r: Rec): void {
    if (this._closed) return;
    this._queue.push(r);
    this._pump();
  }

  _pump(): void {
    if (this._pumpTimer || !this._queue.length || this._closed) return;
    const r = this._queue.shift() as Rec; // non-empty (checked above)
    this._start(r).catch((e) => this.log.debug(`transcript ${r.id}: ${errMessage(e)}`));
    this._pumpTimer = this.clock.setTimeout(() => {
      this._pumpTimer = null;
      this._pump();
    }, this.staggerMs);
  }

  /** Locate the file (direct path, else a rate-limited glob), then start polling. */
  async _start(r: Rec): Promise<void> {
    if (r.tok.cancelled) return;
    r.poll ??= this.clock.setInterval(() => this._onPoll(r), this.pollMs);
    await this._onPoll(r);
  }

  _locate(r: Rec): string | null {
    const direct = path.join(this.projectsDir, projectSlug(r.cwd), `${r.sid}.jsonl`);
    if (fs.existsSync(direct)) return direct;
    const now = this.clock.now();
    if (now - r.lastGlob < GLOB_EVERY_MS) return null;
    r.lastGlob = now;
    let dirs: string[] = [];
    try {
      dirs = fs.readdirSync(this.projectsDir);
    } catch {
      return null;
    }
    for (const d of dirs) {
      const f = path.join(this.projectsDir, d, `${r.sid}.jsonl`);
      if (fs.existsSync(f)) return f;
    }
    return null;
  }

  async _onPoll(r: Rec): Promise<void> {
    if (r.tok.cancelled) return;
    if (!r.file) {
      const file = (r.file = this._locate(r));
      if (!file) return;
      await this._backfill(r);
      if (r.tok.cancelled) return;
      if (this.useWatch) {
        try {
          const watcher = (r.watcher = fs.watch(file, { persistent: false }, () => void this._readMore(r)));
          watcher.on('error', () => {
            try {
              r.watcher?.close();
            } catch {}
            r.watcher = null;
          });
        } catch {}
      }
      return;
    }
    await this._readMore(r);
  }

  /** First read: the last 512 KB, dropping the partial first line. No events. */
  async _backfill(r: Rec): Promise<void> {
    let fh: fs.promises.FileHandle | undefined;
    try {
      if (!r.file) throw new Error('no file'); // _onPoll located it before calling
      fh = await fs.promises.open(r.file, 'r');
      const { size } = await fh.stat();
      const start = Math.max(0, size - TAIL_BYTES);
      const buf = Buffer.alloc(size - start);
      await fh.read(buf, 0, buf.length, start);
      let text = buf.toString('utf8');
      if (start > 0) text = text.slice(text.indexOf('\n') + 1);
      const end = text.lastIndexOf('\n');
      r.partial = end < 0 ? text : text.slice(end + 1);
      text = end < 0 ? '' : text.slice(0, end + 1);
      r.offset = size;
      r.st.reset();
      await parseChunked(r.st, text, this.clock.now(), r.tok);
      // today's spend: read back what the tail skipped, as far as this morning
      const since = dayStart(this.clock.now());
      if (start > 0 && !r.tok.cancelled && (r.st.firstTs == null || r.st.firstTs >= since)) await scanHead(fh, start, r.st, since, r.tok);
    } catch (e) {
      this.log.debug(`transcript backfill ${r.id}: ${errMessage(e)}`);
      r.file = null;
      return;
    } finally {
      await fh?.close().catch(() => {});
    }
    if (r.tok.cancelled) return;
    r.ready = true;
    const last = r.st.lastTs;
    if (last && typeof r.hint === 'function') {
      try {
        if (r.hint.length >= 2) r.hint(r.id, last);
        else r.hint(last);
      } catch {}
    }
    this._patch(r);
  }

  /** Read [offset, size) with a partial-line buffer; reset if the file shrank. */
  async _readMore(r: Rec): Promise<void> {
    if (r.tok.cancelled || !r.ready) return;
    if (r.reading) {
      r.again = true;
      return;
    }
    r.reading = true;
    let fh: fs.promises.FileHandle | undefined;
    try {
      do {
        r.again = false;
        let st: fs.Stats;
        try {
          if (!r.file) throw new Error('no file');
          st = await fs.promises.stat(r.file);
        } catch {
          r.file = null; // vanished: locate again on the next poll
          r.ready = false;
          return;
        }
        if (st.size < r.offset) {
          r.ready = false;
          await this._backfill(r);
          continue;
        }
        if (st.size === r.offset) continue;
        fh ??= await fs.promises.open(r.file as string, 'r'); // set: the stat above succeeded on it
        const len = Math.min(st.size - r.offset, 4 * 1024 * 1024);
        const buf = Buffer.alloc(len);
        const { bytesRead } = await fh.read(buf, 0, len, r.offset);
        r.offset += bytesRead;
        let text = r.partial + buf.subarray(0, bytesRead).toString('utf8');
        const end = text.lastIndexOf('\n');
        r.partial = end < 0 ? text : text.slice(end + 1);
        text = end < 0 ? '' : text.slice(0, end + 1);
        const events = await parseChunked(r.st, text, this.clock.now(), r.tok);
        if (r.tok.cancelled) return;
        this._patch(r);
        for (const e of events) this._emit(r, e.kind, e.detail);
        if (st.size > r.offset) r.again = true;
      } while (r.again && !r.tok.cancelled);
    } catch (e) {
      this.log.debug(`transcript read ${r.id}: ${errMessage(e)}`);
    } finally {
      r.reading = false;
      await fh?.close().catch(() => {});
    }
  }

  _emit(r: Rec, kind: EventKind, detail: unknown): void {
    if (!this.recs.has(r.id)) return;
    try {
      this.emitEvent(r.id, kind, detail);
    } catch (e) {
      this.log.warn(`transcripts emit ${kind}: ${errMessage(e)}`);
    }
  }

  /** Build + send the patch (status-gated activity, struggle); only when it changed. */
  _patch(r: Rec): void {
    if (!this.recs.has(r.id) || r.tok.cancelled) return;
    const now = this.clock.now();
    const working = r.status === 'working';
    let activity: Activity | null = null;
    if (r.ready) {
      const a = working ? r.st.activity() : null;
      const ask = !working ? r.st.pendingAsk() : null;
      const src: TranscriptActivity | null = a ?? (ask ? { tool: ask.name, cls: 'ask', detail: ask.detail, at: ask.at } : null);
      if (src) {
        const key = `${src.tool}|${src.cls}|${src.detail}`;
        if (key !== r.actKey) {
          r.actKey = key;
          r.actSince = Math.min(now, src.at || now);
        }
        activity = { tool: src.tool, cls: src.cls, detail: src.detail, since: r.actSince };
      } else r.actKey = '';
    }
    const struggle = working && r.ready ? r.st.struggle(r.workingSince, now) : null;
    const level = struggle?.level ?? 0;
    const patch = { ...r.st.facts(now), activity, struggle };
    const j = JSON.stringify(patch);
    if (j !== r.sent) {
      r.sent = j;
      this.onPatch(r.id, patch);
    }
    if (level !== r.struggleLevel) {
      r.struggleLevel = level;
      this._emit(r, 'struggle', { level, reason: struggle?.reason ?? null, detail: struggle?.detail ?? null });
    }
  }
}
