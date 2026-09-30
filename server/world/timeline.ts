/**
 * Timeline ring: every status transition and every `event` per pane for 24 h (≤ 20k items),
 * persisted to `~/.config/claude-hq/<session>/timeline.ndjson` (0600, rotated at 2 MB into `timeline.1.ndjson`) and
 * served by `timeline.get {since}` → `{t:'timeline', since, items, truncated}` (≤ LIMITS.timelineMax, newest kept).
 * Feeds the away recap, roster sparklines, Daily Diff and unread after a reload.
 *
 *   item = {at, id, identity, kind:'status'|EventKind, from?, to?, detail?}
 *
 * Metadata only, never prompt text: event details are reduced to an allowlist of short scalar keys (tool, cls, push,
 * type, level, reason, src, n, preTokens, trigger); commands, labels, paths and questions are dropped.
 * Volume shaping: `tool` events are not recorded (the entity stream carries them; ~1 per 3 s per agent), and `news`
 * is coalesced per pane into ≤ 1 item per NEWS_BUCKET_MS carrying `detail.n` (so unread counts survive a reload).
 * Owner: BE.
 */
import fs from 'node:fs';
import path from 'node:path';
import { LIMITS, S2R } from '../../shared/protocol.ts';
import type { Identity, ServerMsg, Status, TimelineItem, TimelineMsg } from '../../shared/protocol.ts';
import type { Clock, Logger, TimerHandle } from '../interfaces.ts';
import { errMessage, isRecord } from '../../shared/guards.ts';
import type { EventEmitter } from 'node:events';
import type { WorldModelEvents } from './model.ts';

export const TIMELINE_WINDOW_MS = 24 * 3600_000;
export const TIMELINE_MAX = 20_000;
export const TIMELINE_ROTATE_BYTES = 2 * 1024 * 1024;
export const NEWS_BUCKET_MS = 60_000;
const FLUSH_MS = 1000;
const SKIP = new Set<string>(['tool']);
const DETAIL_KEYS = new Set<string>(['tool', 'cls', 'push', 'type', 'level', 'reason', 'src', 'n', 'preTokens', 'trigger']);

/** Allowlisted, scalar-only detail (≤ 40-char strings). */
export function scrubDetail(detail: unknown): Record<string, string | number | boolean | null> | undefined {
  if (!detail || typeof detail !== 'object') return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (!DETAIL_KEYS.has(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean' || v === null) out[k] = v;
    else if (typeof v === 'string' && v.length <= 40) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The part of the WorldModel the timeline listens to and reads identities from. */
export interface TimelineModel extends EventEmitter<WorldModelEvents> {
  get(id: string): { identity: Identity } | null;
  base(id: string): { identity: Identity } | null;
}

/** What `record` takes: an item whose `at` defaults to now and whose `detail` is scrubbed. */
export interface TimelineInput {
  id: string;
  identity?: Identity | null;
  kind: TimelineItem['kind'];
  from?: Status;
  to?: Status;
  detail?: unknown;
  at?: number;
}

/** An open per-pane `news` bucket. */
interface NewsBucket { identity: Identity | null; n: number; at: number; src: string | null; timer: TimerHandle | null }

/** Trust-boundary check for a persisted line: the fields _push always writes (`at`, `id`, `kind`, `identity`). */
function isTimelineItem(v: unknown): v is TimelineItem {
  return isRecord(v) && typeof v.at === 'number' && typeof v.id === 'string' && typeof v.kind === 'string' && (v.identity === null || isRecord(v.identity));
}

export class Timeline {
  clock: Clock;
  log: Partial<Logger>;
  max: number;
  windowMs: number;
  rotateBytes: number;
  file: string | null;
  old: string | null;
  /** oldest first */
  items: TimelineItem[];
  /** lines not yet written */
  _pending: string[];
  _timer: TimerHandle | null;
  /** id → open news bucket */
  _news: Map<string, NewsBucket>;
  _model: TimelineModel | null;
  _onStatus: ((id: string, from: Status, to: Status, identity: Identity) => void) | null;
  _onMsg: ((m: ServerMsg) => void) | null;

  /** `dir` = the session state dir (null → memory only: demo, replay, tests). */
  constructor({ dir, clock, log, max = TIMELINE_MAX, windowMs = TIMELINE_WINDOW_MS, rotateBytes = TIMELINE_ROTATE_BYTES }: {
    dir: string | null; clock: Clock; log?: Partial<Logger>; max?: number; windowMs?: number; rotateBytes?: number;
  }) {
    this.clock = clock;
    this.log = log ?? { debug() {}, warn() {} };
    this.max = max;
    this.windowMs = windowMs;
    this.rotateBytes = rotateBytes;
    this.file = dir ? path.join(dir, 'timeline.ndjson') : null;
    this.old = dir ? path.join(dir, 'timeline.1.ndjson') : null;
    this.items = [];
    this._pending = [];
    this._timer = null;
    this._news = new Map();
    this._model = null;
    this._onStatus = null;
    this._onMsg = null;
    this._load();
  }

  _load(): void {
    if (!this.file) return;
    const cutoff = this.clock.now() - this.windowMs;
    for (const f of [this.old, this.file]) {
      if (!f) continue; // both are set together with `file`
      let text = '';
      try {
        text = fs.readFileSync(f, 'utf8');
      } catch {
        continue;
      }
      for (const line of text.split('\n')) {
        if (!line) continue;
        try {
          const it: unknown = JSON.parse(line);
          if (isTimelineItem(it) && it.at >= cutoff) this.items.push(it);
        } catch {} // a torn last line after a crash
      }
    }
    this.items.sort((a, b) => a.at - b.at);
    if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max);
  }

  /** Record from the WorldModel: status transitions (`status` event) + every `event` message. */
  attach(model: TimelineModel): this {
    this._model = model;
    const onStatus = (id: string, from: Status, to: Status, identity: Identity): void => this.record({ id, identity, kind: 'status', from, to });
    const onMsg = (m: ServerMsg): void => {
      if (m.t !== S2R.EVENT || SKIP.has(m.kind)) return;
      const identity = model.get(m.id)?.identity ?? model.base(m.id)?.identity ?? null;
      if (m.kind === 'news') return this._newsItem(m.id, identity, m.detail);
      this.record({ id: m.id, identity, kind: m.kind, detail: m.detail });
    };
    this._onStatus = onStatus;
    this._onMsg = onMsg;
    model.on('status', onStatus);
    model.on('msg', onMsg);
    return this;
  }

  record(it: TimelineInput): void {
    this._closeNews(it.id); // keep a pane's items in order: an open news bucket lands before what follows it
    this._push(it);
  }

  _push({ id, identity, kind, from, to, detail, at }: TimelineInput): TimelineItem {
    const item: TimelineItem = { at: at ?? this.clock.now(), id, identity: identity ?? null, kind };
    if (from !== undefined) item.from = from;
    if (to !== undefined) item.to = to;
    const d = scrubDetail(detail);
    if (d) item.detail = d;
    this.items.push(item);
    if (this.items.length > this.max * 1.1) this._trim();
    if (this.file) {
      this._pending.push(JSON.stringify(item));
      this._timer ??= this.clock.setTimeout(() => this.flush(), FLUSH_MS);
    }
    return item;
  }

  _newsItem(id: string, identity: Identity | null, detail: unknown): void {
    const src = isRecord(detail) && typeof detail.src === 'string' ? detail.src : undefined;
    const open = this._news.get(id);
    if (open) {
      open.n++;
      open.at = this.clock.now();
      if (src && open.src !== src) open.src = 'mixed';
      return;
    }
    const b: NewsBucket = { identity, n: 1, at: this.clock.now(), src: src ?? null, timer: null };
    b.timer = this.clock.setTimeout(() => this._closeNews(id), NEWS_BUCKET_MS);
    this._news.set(id, b);
  }

  _closeNews(id: string): void {
    const b = this._news.get(id);
    if (!b) return;
    this._news.delete(id);
    this.clock.clearTimeout(b.timer);
    this._push({ id, identity: b.identity, kind: 'news', detail: { n: b.n, ...(b.src ? { src: b.src } : {}) }, at: b.at });
  }

  _trim(): void {
    const cutoff = this.clock.now() - this.windowMs;
    let drop = 0;
    while (drop < this.items.length && (this.items[drop].at < cutoff || this.items.length - drop > this.max)) drop++;
    if (drop) this.items.splice(0, drop);
  }

  /**
   * Items with `at >= since`, oldest first, capped to the newest `limit`. Open news buckets are included as-is.
   */
  get(since: number, limit: number = LIMITS.timelineMax): { items: TimelineItem[]; truncated: boolean } {
    this._trim();
    const out = this.items.filter((x) => x.at >= since);
    for (const [id, b] of this._news) {
      if (b.at >= since) out.push({ at: b.at, id, identity: b.identity, kind: 'news', detail: { n: b.n, ...(b.src ? { src: b.src } : {}) } });
    }
    out.sort((a, b) => a.at - b.at);
    const truncated = out.length > limit;
    return { items: truncated ? out.slice(out.length - limit) : out, truncated };
  }

  /** The `timeline` server message. */
  msg(since: number): TimelineMsg {
    const { items, truncated } = this.get(since);
    return { t: S2R.TIMELINE, since, items, ...(truncated ? { truncated: true } : {}) };
  }

  flush(): void {
    this.clock.clearTimeout(this._timer);
    this._timer = null;
    if (!this.file || !this._pending.length) return;
    const text = this._pending.join('\n') + '\n';
    this._pending = [];
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      fs.appendFileSync(this.file, text, { mode: 0o600 });
      if (this.old && fs.statSync(this.file).size > this.rotateBytes) fs.renameSync(this.file, this.old);
    } catch (e) {
      this.log.warn?.(`timeline: ${errMessage(e)}`);
    }
  }

  metrics(): { items: number; newsOpen: number; pending: number } {
    return { items: this.items.length, newsOpen: this._news.size, pending: this._pending.length };
  }

  close(): void {
    for (const id of [...this._news.keys()]) this._closeNews(id);
    if (this._model) {
      if (this._onStatus) this._model.off('status', this._onStatus);
      if (this._onMsg) this._model.off('msg', this._onMsg);
      this._model = null;
    }
    this.flush();
  }
}
