/**
 * `term.search` (rev 5): a read-only search over every pane's recent terminal output, for the command palette
 * (docs/valley/ops.md). The server otherwise keeps only `lastText` (≤ 280 chars); this keeps more, bounded.
 *
 * Per pane a `LineRing`: the last LIMITS.scrollbackLines lines and at most LIMITS.scrollbackBytes of text (oldest
 * dropped first), ANSI-stripped, each stamped with when the server first saw it. It is fed from herdr's own
 * `pane.read {source:'recent_unwrapped', format:'text', lines: READ_LINES}` (the demo answers the same read from its fake
 * terminals): the bottom `rows` lines are the live screen (a TUI redraws them: spinners, the input box), kept apart and
 * replaced on every read; the lines above them have scrolled off and never change, so they are appended to the ring after
 * the overlap with what it already holds (`mergeTail`).
 *
 * Reads happen only once somebody searches: a search refreshes every pane read more than STALE_MS ago (READ_PARALLEL at
 * a time, each bounded by READ_TIMEOUT_MS, the whole refresh by REFRESH_BUDGET_MS: slow panes answer from what the ring
 * already has), and for WARM_MS after the last search a slow sweep (every SWEEP_MS the SWEEP_PANES stalest panes, one at a time) keeps the rings
 * growing past herdr's own read window. Strictly read-only: it never sends keys, never resizes, never runs anything.
 * Pure parts (`LineRing`, `mergeTail`, `searchLines`, `cutAround`) are tested in scrollback.test.ts.
 */
import { LIMITS } from '../../shared/protocol.ts';
import type { ScrollHit, SearchResult } from '../../shared/protocol.ts';
import { errCode, errMessage, isRecord } from '../../shared/guards.ts';
import type { Clock, HerdrSource, Logger, TimerHandle } from '../interfaces.ts';
import { stripAnsi } from './screens.ts';

/** lines asked of herdr per read */
export const READ_LINES = 400;
/** a pane read longer ago than this is refreshed before a search */
export const STALE_MS = 8_000;
export const READ_PARALLEL = 4;
export const READ_TIMEOUT_MS = 1_500;
export const REFRESH_BUDGET_MS = 2_000;
/** after a search, keep sweeping for this long */
export const WARM_MS = 30 * 60_000;
export const SWEEP_MS = 15_000;
/** panes read per sweep (the stalest), one after another */
export const SWEEP_PANES = 8;
/** a client may search at most once per this many ms */
export const SEARCH_GAP_MS = 150;
/** hits per pane (the newest), so one chatty pane cannot crowd out the rest */
export const PER_PANE = 4;
/** characters kept of one line */
const LINE_MAX = 1000;
/** the snippet window around a match */
export const SNIPPET = 200;
/** the live screen when herdr does not say how tall the pane is */
const DEFAULT_ROWS = 40;

export interface RingLine { text: string; at: number }

/** The bounded per-pane line store: at most `maxLines` lines and `maxBytes` (UTF-16 code units × 2) of text. */
export class LineRing {
  maxLines: number;
  maxBytes: number;
  lines: RingLine[] = [];
  bytes = 0;
  /** lines ever appended (dropped ones included) */
  total = 0;
  constructor(maxLines: number = LIMITS.scrollbackLines, maxBytes: number = LIMITS.scrollbackBytes) {
    this.maxLines = maxLines;
    this.maxBytes = maxBytes;
  }
  push(texts: readonly string[], at: number): void {
    for (const t of texts) {
      const text = t.length > LINE_MAX ? t.slice(0, LINE_MAX) : t;
      this.lines.push({ text, at });
      this.bytes += text.length * 2;
      this.total++;
    }
    let drop = 0;
    let bytes = this.bytes;
    while (this.lines.length - drop > this.maxLines || (bytes > this.maxBytes && this.lines.length - drop > 1)) bytes -= this.lines[drop++].text.length * 2;
    if (drop) { this.lines.splice(0, drop); this.bytes = bytes; }
  }
  /** the last `n` texts */
  tail(n: number): string[] {
    return this.lines.slice(Math.max(0, this.lines.length - n)).map((l) => l.text);
  }
}

/**
 * What of `incoming` (the settled lines of a fresh read, oldest first) is new after `ring`'s last lines: the lines after
 * the latest place where the ring's tail anchor (its last few lines, at least two of them non-blank, ≤ 12) appears in
 * `incoming`. No anchor found (a cleared screen, more new output than one read holds, an empty ring): all of it.
 */
export function mergeTail(ringTail: readonly string[], incoming: readonly string[]): string[] {
  if (!ringTail.length || !incoming.length) return [...incoming];
  let k = 0, solid = 0;
  while (k < ringTail.length && k < 12 && solid < 2) { if (ringTail[ringTail.length - 1 - k].trim()) solid++; k++; }
  const anchor = ringTail.slice(ringTail.length - k);
  for (let end = incoming.length - 1; end >= k - 1; end--) {
    let ok = true;
    for (let j = 0; j < k && ok; j++) ok = incoming[end - j] === anchor[k - 1 - j];
    if (ok) return incoming.slice(end + 1);
  }
  return [...incoming];
}

/** a ≤ `max`-char window of `line` around [s, e), with `…` where cut; the match's position inside it */
export function cutAround(line: string, s: number, e: number, max = SNIPPET): { text: string; match: [number, number] } {
  const flat = line.replace(/\t/g, ' ');
  if (flat.length <= max) return { text: flat, match: [s, e] };
  const start = Math.max(0, Math.min(s - Math.floor((max - (e - s)) / 3), flat.length - max));
  const end = Math.min(flat.length, start + max);
  const pre = start > 0 ? '…' : '';
  return { text: `${pre}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`, match: [s - start + pre.length, Math.min(e, end) - start + pre.length] };
}

/** the query's words, lower-cased (every one must appear in a line) */
export function queryWords(q: string): string[] {
  return [...new Set(q.toLowerCase().split(/\s+/).filter(Boolean))];
}

/**
 * Lines (oldest first) that contain every word of `words` (case-insensitive), newest first, at most `max`; repeats of a
 * line already found (a redrawn status line) count once. `fromEnd` = 0 for the last line.
 */
export function searchLines(lines: readonly { text: string }[], words: readonly string[], max: number): { i: number; fromEnd: number; s: number; e: number }[] {
  const out: { i: number; fromEnd: number; s: number; e: number }[] = [];
  if (!words.length) return out;
  const seen = new Set<string>();
  for (let i = lines.length - 1; i >= 0 && out.length < max; i--) {
    const t = lines[i].text;
    if (t.length < words[0].length) continue;
    const low = t.toLowerCase();
    let first = -1, firstLen = 0, ok = true;
    for (const w of words) {
      const at = low.indexOf(w);
      if (at < 0) { ok = false; break; }
      if (first < 0 || at < first) { first = at; firstLen = w.length; }
    }
    if (!ok) continue;
    const key = t.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ i, fromEnd: lines.length - 1 - i, s: first, e: first + firstLen });
  }
  return out;
}

/** herdr `pane.read` text → plain lines (no ANSI, no \r, no trailing padding / blank lines) */
export function plainLines(text: string): string[] {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => stripAnsi(l).trimEnd());
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** One pane as the search sees it (app.ts maps the WorldModel's entities). */
export interface SearchPane { id: string; rows?: number | null; agent?: boolean }

interface PaneBuf { ring: LineRing; screen: RingLine[]; readAt: number; inflight: Promise<void> | null }

export class Scrollback {
  source: Pick<HerdrSource, 'request'> & { connected?: boolean };
  panes: () => Iterable<SearchPane>;
  clock: Clock;
  log: Pick<Logger, 'debug'>;
  bufs = new Map<string, PaneBuf>();
  reads = 0;
  searches = 0;
  _warmUntil = 0;
  _sweep: TimerHandle | null = null;
  _sweeping = false;
  _lastBy = new WeakMap<object, number>();

  constructor({ source, panes, clock, log }: { source: Pick<HerdrSource, 'request'> & { connected?: boolean }; panes: () => Iterable<SearchPane>; clock: Clock; log?: Pick<Logger, 'debug'> }) {
    this.source = source;
    this.panes = panes;
    this.clock = clock;
    this.log = log ?? { debug() {} };
  }

  _buf(id: string): PaneBuf {
    let b = this.bufs.get(id);
    if (!b) this.bufs.set(id, (b = { ring: new LineRing(), screen: [], readAt: -Infinity, inflight: null }));
    return b;
  }

  /** a pane closed: forget its lines */
  drop(id: string): void { this.bufs.delete(id); }

  /** Read one pane and fold it in (one read in flight per pane). */
  read(p: SearchPane): Promise<void> {
    const b = this._buf(p.id);
    if (b.inflight) return b.inflight;
    this.reads++;
    const rows = Math.max(1, Math.min(LIMITS.rows[1], p.rows ?? DEFAULT_ROWS));
    b.inflight = this.source.request('pane.read', { pane_id: p.id, source: 'recent_unwrapped', format: 'text', lines: READ_LINES }).then((r) => {
      const read = isRecord(r) && isRecord(r.read) ? r.read : null;
      if (typeof read?.text !== 'string') return;
      this.ingest(p.id, plainLines(read.text), rows);
    }, (e: unknown) => {
      this.log.debug(`scrollback ${p.id}: ${errCode(e) ?? errMessage(e)}`);
    }).finally(() => { b.inflight = null; b.readAt = this.clock.now(); });
    return b.inflight;
  }

  /** Fold a fresh read (plain lines, oldest first) into the pane's ring: the bottom `rows` are the live screen. */
  ingest(id: string, lines: readonly string[], rows: number): void {
    const b = this._buf(id);
    const now = this.clock.now();
    const split = Math.max(0, lines.length - rows);
    const fresh = mergeTail(b.ring.tail(12), lines.slice(0, split));
    if (fresh.length) b.ring.push(fresh, now);
    const prev = new Map(b.screen.map((l) => [l.text, l.at]));
    b.screen = lines.slice(split).map((text) => ({ text: text.length > LINE_MAX ? text.slice(0, LINE_MAX) : text, at: prev.get(text) ?? now }));
    b.readAt = now;
  }

  /** Refresh the panes that are stale (bounded parallelism and time). */
  async refresh(all: SearchPane[]): Promise<void> {
    if (this.source.connected === false) return;
    const now = this.clock.now();
    const due = all.filter((p) => now - (this.bufs.get(p.id)?.readAt ?? -Infinity) > STALE_MS);
    if (!due.length) return;
    let next = 0;
    const worker = async () => { while (next < due.length) await this.read(due[next++]); };
    const work = Promise.all(Array.from({ length: Math.min(READ_PARALLEL, due.length) }, worker));
    let timer: TimerHandle | null = null;
    await Promise.race([work, new Promise<void>((r) => { timer = this.clock.setTimeout(r, REFRESH_BUDGET_MS); })]);
    this.clock.clearTimeout(timer);
  }

  /**
   * `term.search`: refresh stale panes, then every line (ring + screen) of every live pane holding every word of `q`.
   * Newest first per pane (≤ PER_PANE each), then across panes by when the line was seen; ≤ `max` hits.
   * `client` (any object) is rate limited to one search per SEARCH_GAP_MS.
   */
  async search(q: string, max = 24, client: object | null = null): Promise<SearchResult> {
    const now = this.clock.now();
    if (client) {
      if (now - (this._lastBy.get(client) ?? -Infinity) < SEARCH_GAP_MS) throw Object.assign(new Error('searching too fast: one search per 150 ms'), { code: 'not_accepted' });
      this._lastBy.set(client, now);
    }
    this.searches++;
    this._warm();
    const words = queryWords(q).slice(0, 8);
    const panes = [...this.panes()];
    const live = new Set(panes.map((p) => p.id));
    for (const id of [...this.bufs.keys()]) if (!live.has(id)) this.bufs.delete(id);
    await this.refresh(panes);
    max = Math.max(1, Math.min(LIMITS.searchHitsMax, max));
    const hits: ScrollHit[] = [];
    let lines = 0, more = 0;
    for (const p of panes) {
      const b = this.bufs.get(p.id);
      if (!b) continue;
      const all: RingLine[] = b.ring.lines.length ? [...b.ring.lines, ...b.screen] : b.screen;
      lines += all.length;
      const found = searchLines(all, words, PER_PANE + 1);
      if (found.length > PER_PANE) more += found.length - PER_PANE;
      for (const f of found.slice(0, PER_PANE)) {
        const cut = cutAround(all[f.i].text, f.s, f.e);
        hits.push({ id: p.id, text: cut.text, match: cut.match, fromEnd: f.fromEnd, at: all[f.i].at, screen: f.i >= all.length - b.screen.length });
      }
    }
    hits.sort((a, b) => b.at - a.at || a.fromEnd - b.fromEnd || a.id.localeCompare(b.id));
    more += Math.max(0, hits.length - max);
    return { q, hits: hits.slice(0, max), panes: panes.length, lines, more };
  }

  /** keep a slow sweep running until WARM_MS after the last search */
  _warm(): void {
    this._warmUntil = this.clock.now() + WARM_MS;
    if (this._sweep) return;
    this._sweep = this.clock.setInterval(() => this._tick(), SWEEP_MS);
  }

  _tick(): void {
    if (this.clock.now() > this._warmUntil) { this.clock.clearInterval(this._sweep); this._sweep = null; return; }
    if (this.source.connected === false || this._sweeping) return;
    // one pane at a time, the stalest SWEEP_PANES first (agents before shells on a tie)
    const panes = [...this.panes()].sort((a, b) => (this.bufs.get(a.id)?.readAt ?? -Infinity) - (this.bufs.get(b.id)?.readAt ?? -Infinity) || Number(!!b.agent) - Number(!!a.agent))
      .slice(0, SWEEP_PANES);
    let i = 0;
    this._sweeping = true;
    const step = () => {
      const p = panes[i++];
      if (!p || this._sweep === null) { this._sweeping = false; return; }
      void this.read(p).then(step);
    };
    step();
  }

  metrics(): { panes: number; lines: number; bytes: number; reads: number; searches: number; warm: boolean } {
    let lines = 0, bytes = 0;
    for (const b of this.bufs.values()) { lines += b.ring.lines.length + b.screen.length; bytes += b.ring.bytes; }
    return { panes: this.bufs.size, lines, bytes, reads: this.reads, searches: this.searches, warm: !!this._sweep };
  }

  close(): void {
    this.clock.clearInterval(this._sweep);
    this._sweep = null;
    this.bufs.clear();
  }
}
