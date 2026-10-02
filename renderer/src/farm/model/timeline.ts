// @pure
/**
 * The day timeline: what each farmer did today, so after stepping away you can tell how the morning went.
 *
 * The valley model (`valley.ts`) feeds it every tick with the visible, smoothed job of each farmer (`observe`) and the
 * one-shot moments from the wire (`mark`: commits, test runs, errors, finishes, subagents, compactions). It keeps per
 * farmer a run of **spans** (job + from/to, coalesced: a blip shorter than `BLIP_MS` folds into its neighbours, a gap
 * of more than `GAP_MS` without a tick leaves a hole, e.g. while the valley was closed) and a list of **marks** (an ask
 * carries how long it waited for you). Bounded: one local day (reset at midnight), `MAX_SPANS` spans and `MAX_MARKS`
 * marks per farmer (the shortest spans merge first), `MAX_FARMERS` farmers (the stalest go). Persisted per day through
 * a `TimelineStore` (browser-local in the app, throttled saves); the demo valley keeps a seeded morning in memory
 * (`demoDay`).
 *
 * Readers: `summarize` (the card's "Today" line), `keyMoments` (the card's list), `bands` (the strips).
 */
import type { ToolClass } from '../../../../shared/protocol.ts';
import { hash32, mulberry32 } from '../../../../shared/identity.ts';
import { dayKey } from './almanac.ts';
import type { Job } from './types.ts';

export const GAP_MS = 90_000;
export const BLIP_MS = 20_000;
export const MAX_SPANS = 240;
export const MAX_MARKS = 160;
export const MAX_FARMERS = 48;
/** at most one save per this long (asks, ships and test runs save sooner) */
export const SAVE_MS = 20_000;

/** jobs that count as active work (the rest: asking you, done, idle, away) */
export const WORK_JOBS: ReadonlySet<Job> = new Set<Job>(['plant', 'inspect', 'water', 'build', 'haul', 'fetch', 'plan', 'talk', 'delegate', 'rest']);

export type MarkKind = 'ship' | 'pass' | 'fail' | 'error' | 'ask' | 'finished' | 'sub' | 'compact' | 'struggle';

export interface Span {
  job: Job;
  /** wall-clock ms */
  from: number;
  to: number;
  /** tool flavour seen first inside the span (search inside inspect, web inside fetch …) */
  tool?: ToolClass;
  /** first subject seen (a file, a command), ≤ 40 chars */
  what?: string;
}
export interface Mark {
  kind: MarkKind;
  at: number;
  /** commit message, test command, error, question, task title, duckling label (≤ 60 chars) */
  text?: string;
  /** asks: ms until you answered (unset while it still waits) */
  wait?: number;
}
export interface FarmerDay {
  id: string;
  tag: string;
  name: string;
  spans: Span[];
  marks: Mark[];
  /** bumps whenever a span starts / ends or a mark lands (the HUD re-renders on it; an open span growing does not bump it) */
  rev: number;
}
export interface TimelineData { v: 1; day: string; farmers: Record<string, FarmerDay> }

export interface TimelineView {
  /** local date key */
  day: string;
  /** wall-clock ms of the last tick (the strips end here) */
  now: number;
  farmers: ReadonlyMap<string, FarmerDay>;
  /** bumps with any farmer's rev */
  rev: number;
}

/** What `observe` needs of a farmer (a FarmerView fits). */
export interface Observed {
  id: string; tag: string; name: string; job: Job; tool?: ToolClass | null; detail?: string; needsYou: boolean; question?: string | null;
}

export interface TimelineStore { load(): unknown; save(d: TimelineData): void }

export interface TimelineRecorder {
  readonly view: TimelineView;
  /** once per model tick with every farmer present */
  observe(farmers: Iterable<Observed>, now: number): void;
  /** a one-shot moment */
  mark(id: string, kind: MarkKind, now: number, text?: string): void;
  /** switch storage (the demo valley swaps in memory); `seed` fills a farmer seen for the first time today */
  use(store: TimelineStore | undefined, seed?: SeedFn | null): void;
  /** replace one farmer's day (dev: seed a plausible morning) */
  put(day: FarmerDay): void;
  /** save now if anything changed */
  flush(): void;
  readonly data: TimelineData;
}
export type SeedFn = (f: Observed, now: number) => FarmerDay | null;

const clip = (s: string | null | undefined, n: number): string | undefined => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t ? (t.length > n ? `${t.slice(0, n - 1)}…` : t) : undefined;
};

export const emptyTimeline = (day: string): TimelineData => ({ v: 1, day, farmers: {} });

/** Loads stored data for `day`; anything from another day (or malformed) is dropped: the daily cleanup. */
export function parseTimeline(raw: unknown, day: string): TimelineData {
  if (!raw || typeof raw !== 'object') return emptyTimeline(day);
  const r = raw as Partial<TimelineData>;
  if (r.v !== 1 || r.day !== day || !r.farmers || typeof r.farmers !== 'object') return emptyTimeline(day);
  const farmers: Record<string, FarmerDay> = {};
  for (const [id, f] of Object.entries(r.farmers)) {
    if (!f || !Array.isArray(f.spans) || !Array.isArray(f.marks)) continue;
    const spans = f.spans.filter((s) => s && typeof s.job === 'string' && Number.isFinite(s.from) && Number.isFinite(s.to) && s.to >= s.from);
    const marks = f.marks.filter((m) => m && typeof m.kind === 'string' && Number.isFinite(m.at));
    farmers[id] = { id, tag: String(f.tag ?? id), name: String(f.name ?? id), spans: spans.slice(-MAX_SPANS), marks: marks.slice(-MAX_MARKS), rev: 1 };
  }
  return { v: 1, day, farmers };
}

/** Merge the shortest spans into a neighbour until the list fits (asks are kept: they matter). */
export function compactSpans(spans: Span[], max = MAX_SPANS): void {
  while (spans.length > max) {
    let best = -1, bestLen = Infinity;
    // never the open (last) span
    for (let i = 0; i < spans.length - 1; i++) {
      const s = spans[i];
      if (s.job === 'ask') continue;
      const len = s.to - s.from;
      if (len < bestLen) { bestLen = len; best = i; }
    }
    if (best < 0) { spans.splice(0, spans.length - max); return; }
    const s = spans[best], prev = spans[best - 1], next = spans[best + 1];
    const okPrev = prev && s.from - prev.to <= GAP_MS && prev.job !== 'ask';
    const okNext = next && next.from - s.to <= GAP_MS && next.job !== 'ask';
    if (okPrev && (!okNext || prev.to - prev.from >= next.to - next.from)) {
      prev.to = s.to;
      if (okNext && next.job === prev.job && next !== spans[spans.length - 1]) { prev.to = next.to; spans.splice(best, 2); continue; }
    } else if (okNext) next.from = s.from;
    spans.splice(best, 1);
  }
}

/** Extend the farmer's open span or start a new one; true when the span list changed shape. */
export function pushJob(fd: FarmerDay, job: Job, now: number, tool?: ToolClass | null, what?: string): boolean {
  const last = fd.spans[fd.spans.length - 1];
  const contiguous = !!last && now - last.to <= GAP_MS;
  if (last && contiguous && last.job === job) {
    last.to = now;
    if (!last.tool && tool) last.tool = tool;
    if (!last.what && what) last.what = clip(what, 40);
    return false;
  }
  if (last && contiguous) {
    last.to = now;
    // a blip between two spans folds away: into the one before (or the two join when the job comes back)
    const prev = fd.spans[fd.spans.length - 2];
    if (last.to - last.from < BLIP_MS && last.job !== 'ask' && prev && last.from - prev.to <= GAP_MS && prev.job !== 'ask') {
      fd.spans.pop();
      prev.to = now;
      if (prev.job === job) return true;
    }
  }
  fd.spans.push({ job, from: now, to: now, ...(tool ? { tool } : {}), ...(what ? { what: clip(what, 40) } : {}) });
  if (fd.spans.length > MAX_SPANS) compactSpans(fd.spans);
  return true;
}

export function addMark(fd: FarmerDay, m: Mark): void {
  const last = fd.marks[fd.marks.length - 1];
  // the same moment twice within a few seconds (a re-sent event) is one
  if (last && last.kind === m.kind && m.at - last.at < 3_000 && last.text === m.text) return;
  fd.marks.push(m);
  if (fd.marks.length > MAX_MARKS) fd.marks.splice(0, fd.marks.length - MAX_MARKS);
}

const lastAsk = (fd: FarmerDay): Mark | undefined => {
  for (let i = fd.marks.length - 1; i >= 0; i--) if (fd.marks[i].kind === 'ask') return fd.marks[i];
  return undefined;
};

export function createTimeline(store?: TimelineStore, { now: start = 0, seed = null }: { now?: number; seed?: SeedFn | null } = {}): TimelineRecorder {
  let st = store;
  let seedFn = seed;
  const load = (day: string): TimelineData => { try { return parseTimeline(st?.load(), day); } catch { return emptyTimeline(day); } };
  let data = load(dayKey(start || Date.now()));
  let dirty = false, urgent = false, savedAt = 0, rev = 0;
  const asking = new Map<string, Mark>();
  const view: { day: string; now: number; farmers: Map<string, FarmerDay>; rev: number } = { day: data.day, now: start, farmers: new Map(Object.entries(data.farmers)), rev: 0 };
  const touch = (fd: FarmerDay) => { fd.rev++; view.rev = ++rev; dirty = true; };
  const save = (now: number) => {
    if (!dirty || !st) return;
    if (!urgent && now - savedAt < SAVE_MS) return;
    try { st.save(data); } catch { /* storage full or blocked: the day lives on in memory */ }
    dirty = false; urgent = false; savedAt = now;
  };
  const rollover = (now: number) => {
    const day = dayKey(now);
    if (day === data.day) return;
    data = emptyTimeline(day);
    asking.clear();
    view.day = day; view.farmers = new Map(); view.rev = ++rev;
    dirty = true; urgent = true;
  };
  const farmer = (f: Pick<Observed, 'id' | 'tag' | 'name'>, now: number, full?: Observed): FarmerDay => {
    let fd = data.farmers[f.id];
    if (!fd) {
      fd = (full && seedFn?.(full, now)) || { id: f.id, tag: f.tag, name: f.name, spans: [], marks: [], rev: 0 };
      data.farmers[f.id] = fd;
      view.farmers.set(f.id, fd);
      const ids = Object.keys(data.farmers);
      if (ids.length > MAX_FARMERS) {
        const stalest = ids.map((id) => [id, data.farmers[id].spans.at(-1)?.to ?? 0] as const).sort((a, b) => a[1] - b[1]).slice(0, ids.length - MAX_FARMERS);
        for (const [id] of stalest) { if (id === f.id) continue; delete data.farmers[id]; view.farmers.delete(id); }
      }
      touch(fd);
    }
    fd.tag = f.tag; fd.name = f.name;
    return fd;
  };
  return {
    view,
    get data() { return data; },
    observe(list, now) {
      rollover(now);
      view.now = now;
      for (const f of list) {
        const fd = farmer(f, now, f);
        if (pushJob(fd, f.job, now, f.tool, f.job === 'ask' ? undefined : f.detail)) touch(fd);
        else dirty = true;
        // asks: a mark when it starts, its wait when you answer
        const open = asking.get(f.id) ?? lastAsk(fd);
        const waiting = open && open.wait === undefined ? open : undefined;
        if (f.needsYou && !waiting) {
          const m: Mark = { kind: 'ask', at: now, ...(clip(f.question, 60) ? { text: clip(f.question, 60) } : {}) };
          addMark(fd, m); asking.set(f.id, m); touch(fd); urgent = true;
        } else if (f.needsYou && waiting) asking.set(f.id, waiting);
        else if (!f.needsYou && waiting) {
          waiting.wait = Math.max(0, now - waiting.at);
          asking.delete(f.id); touch(fd); urgent = true;
        }
      }
      save(now);
    },
    mark(id, kind, now, text) {
      rollover(now);
      const fd = data.farmers[id];
      if (!fd) return; // not a farmer (a scarecrow's event) or not seen yet
      addMark(fd, { kind, at: now, ...(clip(text, 60) ? { text: clip(text, 60) } : {}) });
      touch(fd);
      if (kind !== 'compact' && kind !== 'sub') urgent = true;
      save(now);
    },
    use(s, sd = null) {
      st = s; seedFn = sd;
      data = load(view.day);
      asking.clear();
      view.farmers = new Map(Object.entries(data.farmers));
      view.rev = ++rev;
    },
    put(fd) {
      data.farmers[fd.id] = fd;
      view.farmers.set(fd.id, fd);
      asking.delete(fd.id);
      touch(fd);
      urgent = true;
    },
    flush() { urgent = true; save(view.now); },
  };
}

// ---- readers

export interface DaySummary {
  /** ms of active work (WORK_JOBS) */
  active: number;
  /** ms spent waiting on you (ask spans) */
  waited: number;
  asks: number;
  ships: number;
  passes: number;
  fails: number;
  errors: number;
  finished: number;
  ducklings: number;
  /** wall ms of the first record, null when nothing yet */
  first: number | null;
}

export function summarize(fd: FarmerDay | undefined): DaySummary {
  const s: DaySummary = { active: 0, waited: 0, asks: 0, ships: 0, passes: 0, fails: 0, errors: 0, finished: 0, ducklings: 0, first: null };
  if (!fd) return s;
  for (const sp of fd.spans) {
    const len = sp.to - sp.from;
    if (WORK_JOBS.has(sp.job)) s.active += len;
    else if (sp.job === 'ask') s.waited += len;
  }
  for (const m of fd.marks) {
    if (m.kind === 'ask') s.asks++;
    else if (m.kind === 'ship') s.ships++;
    else if (m.kind === 'pass') s.passes++;
    else if (m.kind === 'fail') s.fails++;
    else if (m.kind === 'error') s.errors++;
    else if (m.kind === 'finished') s.finished++;
    else if (m.kind === 'sub') s.ducklings++;
  }
  s.first = Math.min(fd.spans[0]?.from ?? Infinity, fd.marks[0]?.at ?? Infinity);
  if (!Number.isFinite(s.first)) s.first = null;
  return s;
}

export type MomentKind = MarkKind | 'start' | 'fixed';
export interface Moment {
  at: number;
  kind: MomentKind;
  /** 'shipped a commit' */
  text: string;
  /** the commit message, the question, the test command … */
  sub?: string;
  /** a second time ('→ 11:09 green', an ask's answer) */
  until?: number;
  /** asks: ms waited (null = still waiting) */
  wait?: number | null;
  /** coalesced count (tests green ×4) */
  n?: number;
}

const COALESCE_MS = 15 * 60_000;

/**
 * The day's key moments, newest first: ships, asks (with how long they waited), a red test run paired with the next
 * green one ("tests failed → 11:09 green"), green runs coalesced, errors, finishes, ducklings, and when work started.
 * Compactions are left out (they are noise in a day view).
 */
export function keyMoments(fd: FarmerDay | undefined, max = 60): Moment[] {
  if (!fd) return [];
  const out: Moment[] = [];
  const marks = fd.marks;
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    const prev = out[out.length - 1];
    switch (m.kind) {
      case 'ship': out.push({ at: m.at, kind: 'ship', text: 'shipped a commit', sub: m.text }); break;
      case 'ask': out.push({ at: m.at, kind: 'ask', text: 'asked you', sub: m.text, wait: m.wait ?? null, until: m.wait !== undefined ? m.at + m.wait : undefined }); break;
      case 'fail': {
        if (prev && prev.kind === 'fail' && prev.until === undefined && m.at - prev.at < COALESCE_MS * 2) { prev.n = (prev.n ?? 1) + 1; break; }
        out.push({ at: m.at, kind: 'fail', text: 'tests failed', sub: m.text });
        break;
      }
      case 'pass': {
        if (prev && prev.kind === 'fail' && prev.until === undefined) { prev.until = m.at; prev.kind = 'fixed'; prev.text = prev.n && prev.n > 1 ? `tests failed ×${prev.n}` : 'tests failed'; break; }
        if (prev && prev.kind === 'pass' && m.at - (prev.until ?? prev.at) < COALESCE_MS) { prev.n = (prev.n ?? 1) + 1; prev.until = m.at; prev.text = `tests green ×${prev.n}`; break; }
        out.push({ at: m.at, kind: 'pass', text: 'tests green', sub: m.text });
        break;
      }
      case 'error': out.push({ at: m.at, kind: 'error', text: 'hit an error', sub: m.text }); break;
      case 'finished': out.push({ at: m.at, kind: 'finished', text: 'finished the task', sub: m.text }); break;
      case 'struggle': if (!(prev && prev.kind === 'struggle' && m.at - prev.at < COALESCE_MS)) out.push({ at: m.at, kind: 'struggle', text: 'was struggling', sub: m.text }); break;
      case 'sub': {
        if (prev && prev.kind === 'sub' && m.at - prev.at < 5 * 60_000) { prev.n = (prev.n ?? 1) + 1; prev.text = `sent out ${prev.n} ducklings`; break; }
        out.push({ at: m.at, kind: 'sub', text: 'sent out a duckling', sub: m.text });
        break;
      }
      default: break;
    }
  }
  for (const o of out) if (o.kind === 'fail' && o.n && o.n > 1) o.text = `tests failed ×${o.n}`;
  const firstWork = fd.spans.find((s) => WORK_JOBS.has(s.job));
  if (firstWork) out.push({ at: firstWork.from, kind: 'start', text: 'started work' });
  out.sort((a, b) => b.at - a.at);
  return out.slice(0, max);
}

/**
 * The strip in `n` buckets over [from, to]: the job covering most of each bucket (an ask wins with a quarter of it, so
 * a short wait still shows), null where nothing was recorded (a third or less covered).
 */
export function bands(fd: FarmerDay | undefined, from: number, to: number, n: number): (Job | null)[] {
  const out: (Job | null)[] = new Array(n).fill(null);
  if (!fd || to <= from || n <= 0) return out;
  const w = (to - from) / n;
  const acc = new Map<Job, number>();
  let si = 0;
  const spans = fd.spans;
  for (let b = 0; b < n; b++) {
    const a0 = from + b * w, a1 = a0 + w;
    acc.clear();
    let cover = 0;
    while (si < spans.length && spans[si].to <= a0) si++;
    for (let j = si; j < spans.length && spans[j].from < a1; j++) {
      const s = spans[j];
      const o = Math.min(a1, Math.max(s.to, s.from + 1)) - Math.max(a0, s.from);
      if (o <= 0) continue;
      cover += o;
      acc.set(s.job, (acc.get(s.job) ?? 0) + o);
    }
    if (cover <= w / 3) continue;
    if ((acc.get('ask') ?? 0) >= w / 4) { out[b] = 'ask'; continue; }
    let best: Job | null = null, bv = 0;
    for (const [j, v] of acc) if (v > bv) { bv = v; best = j; }
    out[b] = best;
  }
  return out;
}

/** The span covering `t` (hover), or null. */
export function spanAt(fd: FarmerDay | undefined, t: number): Span | null {
  if (!fd) return null;
  for (let i = fd.spans.length - 1; i >= 0; i--) { const s = fd.spans[i]; if (s.from <= t && t <= s.to) return s; if (s.to < t) break; }
  return null;
}

/** The earliest record across farmers (the ledger's shared strip start), or null. */
export function earliest(farmers: Iterable<FarmerDay>): number | null {
  let e = Infinity;
  for (const f of farmers) { const t = Math.min(f.spans[0]?.from ?? Infinity, f.marks[0]?.at ?? Infinity); if (t < e) e = t; }
  return Number.isFinite(e) ? e : null;
}

/** A strip's window: from the first record (floored to the hour, at least 2 h back) to now. */
export function stripRange(first: number | null, now: number): { from: number; to: number } {
  const HOUR = 3_600_000;
  const back = new Date(Math.min(first ?? now, now - 2 * HOUR));
  back.setMinutes(0, 0, 0);
  return { from: back.getTime(), to: now };
}

// ---- the demo valley: a plausible morning

const TASKS = [
  'Fix the flaky login test', 'Add dark mode to settings', 'Refactor the session store', 'Speed up the map redraw',
  'Wire the webhook retries', 'Tidy the README', 'Port the parser to streams', 'Profile the slow query',
];
const COMMITS = ['fix: retry on 429', 'feat: settings dark mode', 'refactor: split store.ts', 'perf: cache tile bitmaps',
  'test: cover webhook retries', 'docs: quick start', 'chore: bump deps', 'fix: off-by-one in pager'];
const FILES = ['store.ts', 'login.test.ts', 'settings.tsx', 'map.ts', 'webhook.ts', 'README.md', 'parser.ts', 'query.sql', 'pager.ts'];
const CMDS = ['npm test', 'npm run build', 'node --test', 'pytest -q', 'cargo test'];
const QUESTIONS = ['Run npm install?', 'Allow edits to package.json?', 'Delete the old fixtures?', 'Push to origin/main?', 'Use the staging database?'];
const ERRORS = ['ENOENT: fixtures/user.json', 'TypeError: cannot read map', 'build failed: 2 errors'];

/**
 * A seeded, plausible day so far for a demo farmer: arrives a few hours ago, works turns of explore → plan → edit →
 * test (sometimes red, then fixed) → ship, now and then asks you and waits a few minutes, sends out ducklings, takes a
 * lunch break. Ends at `now`. Deterministic per farmer and day.
 */
export function demoDay(f: Pick<Observed, 'id' | 'tag' | 'name'>, now: number): FarmerDay {
  const R = mulberry32(hash32(`${f.id}|${dayKey(now)}`));
  const pick = <T>(a: readonly T[]) => a[Math.floor(R() * a.length)];
  const MIN = 60_000;
  const fd: FarmerDay = { id: f.id, tag: f.tag, name: f.name, spans: [], marks: [], rev: 1 };
  let t = now - (2.5 + R() * 3.5) * 60 * MIN;
  const span = (job: Job, mins: number, what?: string, tool?: ToolClass) => {
    const to = Math.min(now, t + mins * MIN);
    if (to > t) fd.spans.push({ job, from: t, to, ...(what ? { what } : {}), ...(tool ? { tool } : {}) });
    t = to;
  };
  const lunch = R() < 0.6 ? now - (1 + R() * 2) * 60 * MIN : Infinity;
  let lunched = false;
  while (t < now - 2 * MIN) {
    if (!lunched && t > lunch) { lunched = true; span('idle', 25 + R() * 35); continue; }
    if (R() < 0.12) { span('idle', 4 + R() * 14); continue; }
    span('inspect', 3 + R() * 9, pick(FILES), R() < 0.4 ? 'search' : 'read');
    span('plan', 1 + R() * 4, undefined, R() < 0.3 ? 'todo' : 'think');
    if (R() < 0.3) {
      fd.marks.push({ kind: 'sub', at: t, text: pick(['explore', 'reviewer', 'tests']) });
      if (R() < 0.5) fd.marks.push({ kind: 'sub', at: t + 20_000, text: 'helper' });
      span('delegate', 4 + R() * 8);
    }
    if (R() < 0.35 && t < now) {
      const wait = 1 + R() * (R() < 0.25 ? 18 : 6);
      fd.marks.push({ kind: 'ask', at: t, text: pick(QUESTIONS), wait: Math.min(wait * MIN, Math.max(0, now - t)) });
      span('ask', wait);
    }
    span('plant', 6 + R() * 22, pick(FILES), R() < 0.2 ? 'write' : 'edit');
    if (R() < 0.15 && t < now) { fd.marks.push({ kind: 'error', at: t, text: pick(ERRORS) }); span('build', 2 + R() * 4, pick(CMDS), 'bash'); }
    const cmd = pick(CMDS);
    span('water', 1 + R() * 3, cmd);
    if (t >= now) break;
    if (R() < 0.35) {
      fd.marks.push({ kind: 'fail', at: t, text: cmd });
      span('plant', 3 + R() * 8, pick(FILES), 'edit');
      span('water', 1 + R() * 2, cmd);
      if (t >= now) break;
    }
    fd.marks.push({ kind: 'pass', at: t, text: cmd });
    if (R() < 0.7) { span('haul', 0.5 + R()); if (t < now) fd.marks.push({ kind: 'ship', at: t, text: pick(COMMITS) }); }
    if (R() < 0.25 && t < now) { fd.marks.push({ kind: 'finished', at: t, text: pick(TASKS) }); span('done', 3 + R() * 10); }
  }
  // the last span runs up to now, so live recording continues it (or switches from it)
  const last = fd.spans[fd.spans.length - 1];
  if (last) last.to = now;
  fd.marks = fd.marks.filter((m) => m.at <= now).sort((a, b) => a.at - b.at);
  // a still-open ask belongs to live state, not the seed
  for (const m of fd.marks) if (m.kind === 'ask' && m.wait === undefined) m.wait = 0;
  compactSpans(fd.spans);
  return fd;
}
