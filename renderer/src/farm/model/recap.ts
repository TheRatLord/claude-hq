// @pure
/**
 * Harvest recaps: what an agent just did, at a glance, when it stops.
 *
 * The valley model (`valley.ts`) hands every farmer to `observe` once a tick (status, task title, last words, the
 * task's line counters, today's spend, the todo list, the repo, the context) and the wire's one-shot moments to
 * `event` (commits, test runs, errors, finishes). A **stretch** opens when a farmer starts working and stays open
 * through asks (blocked) and short pauses; it closes when the farmer finishes (`finished` event: a moment later, so
 * the closing message and counters have arrived), settles idle for `SETTLE_MS`, or goes home. A stretch that was
 * **meaningful** (≥ `MIN_ACTIVE_MS` of work, or it shipped a commit, changed lines or ran tests) becomes a `Recap`:
 * duration, commits (subjects + shas), lines / files, tests green / red, todos ticked off, tokens and estimated cost
 * spent in it, the context left, and the agent's closing message. The HEAD at the start and the end are kept so the
 * HUD can ask the server for the stretch's diffstat (`git.diff`, read-only).
 *
 * Bounded: `RECAP_KEEP` recaps per farmer (newest first), `RECAP_FARMERS` farmers (the stalest go); open stretches
 * persist too (a reload mid-task continues it). Persisted through a `RecapStore` (browser-local in the app; the demo
 * valley keeps a seeded history in memory: `demoRecaps`).
 */
import type { Status, Todo } from '../../../../shared/protocol.ts';
import { hash32, hashHex, mulberry32 } from '../../../../shared/identity.ts';

/** recaps kept per farmer (the card's history) */
export const RECAP_KEEP = 8;
/** farmers kept (the stalest by their newest recap go) */
export const RECAP_FARMERS = 48;
/** a stretch shorter than this that shipped nothing, changed nothing and ran no tests is not worth a recap */
export const MIN_ACTIVE_MS = 60_000;
/** idle / done this long (without a `finished` event) closes a stretch; a return to work before that continues it */
export const SETTLE_MS = 12_000;
/** after a `finished` event, wait this long for the closing message and counters to arrive, then close */
export const FINISH_LAG_MS = 1_500;
/** a farmer not seen for this long (gone home, the valley closed) closes its stretch where it was last seen */
export const LOST_MS = 30_000;
/** open stretches older than this are dropped on load (a valley closed for a day) */
export const STALE_OPEN_MS = 12 * 3600_000;
/** at most one save of open stretches per this long (a closed recap saves at once) */
export const SAVE_MS = 20_000;
const COMMITS_MAX = 12;
const TODOS_MAX = 8;

export type RecapEnd = 'finished' | 'idle' | 'left';

export interface RecapCommit { sha: string | null; msg: string; at: number }

export interface Recap {
  /** unique: `${farmerId}@${from}` */
  key: string;
  farmerId: string;
  tag: string;
  name: string;
  /** wall-clock ms: the stretch began / ended */
  from: number;
  to: number;
  /** ms seen working / waiting on you (blocked) inside the stretch */
  active: number;
  waited: number;
  asks: number;
  end: RecapEnd;
  /** the task title at the end (or the start) */
  title: string | null;
  /** the agent's closing message (last assistant text), ≤ 280 chars */
  said: string | null;
  /** newest last, ≤ COMMITS_MAX */
  commits: RecapCommit[];
  /** lines / files the task's edits touched (the agent's own Edit / Write counters) */
  lines: { added: number; removed: number; files: number } | null;
  tests: { pass: number; fail: number; last: 'pass' | 'fail' | null };
  errors: number;
  /** todos ticked off during the stretch (≤ TODOS_MAX texts), and the list's size / still open at the end */
  todos: { done: string[]; total: number; open: number } | null;
  /** tokens / estimated USD spent during the stretch (null: the agent reports no usage) */
  spend: { tokens: number; cost: number | null } | null;
  /** context fill (0..1) and tokens at the end */
  context: number | null;
  contextTokens: number | null;
  model: string | null;
  /** the repo: HEAD at the start and the end, changed files left at the end, unpushed commits at the end */
  git: { repo: string; branch: string | null; from: string | null; to: string | null; dirty: number; ahead: number | null } | null;
  /** started before the valley saw it (spend and commits before that are missing) */
  partial: boolean;
}

/** What `observe` needs of a farmer each tick (valley.ts builds it from the FarmerView + Entity). */
export interface RecapObs {
  id: string;
  tag: string;
  name: string;
  status: Status;
  title: string | null;
  said: string | null;
  /** the task's counters (Entity.work): reset by a new prompt (`since` changes) */
  work: { since: number; added: number; removed: number; files: number } | null;
  /** today's spend (Entity.usage) */
  usage: { day: string; tokens: number; cost: number | null } | null;
  todos: readonly Pick<Todo, 'content' | 'status'>[] | null;
  git: { repo: string; branch: string | null; head: string | null; dirty: number; ahead: number | null } | null;
  context: number | null;
  contextTokens: number | null;
  model: string | null;
}

/** An open stretch (persisted so a reload mid-task continues it). */
export interface Stretch {
  farmerId: string;
  from: number;
  lastSeen: number;
  active: number;
  waited: number;
  asks: number;
  status: Status;
  /** wall ms the farmer stopped working (idle / done), null while working or blocked */
  restSince: number | null;
  /** a `finished` event arrived: close at this time */
  closeAt: number | null;
  commits: RecapCommit[];
  pass: number; fail: number; last: 'pass' | 'fail' | null;
  errors: number;
  usage0: { day: string; tokens: number; cost: number | null } | null;
  usage1: { day: string; tokens: number; cost: number | null } | null;
  todos0: string[];
  head0: string | null;
  /** the task counters at the start (a task already under way when the stretch opened: only growth counts) */
  work0: { since: number; added: number; removed: number; files: number } | null;
  /** counters of earlier tasks inside this stretch (a new prompt mid-stretch) */
  bank: { added: number; removed: number; files: number };
  work: { since: number; added: number; removed: number; files: number } | null;
  partial: boolean;
  /** the latest snapshot (what the recap reports when it closes) */
  snap: Omit<RecapObs, 'work' | 'usage'> | null;
}

export interface RecapData { v: 1; farmers: Record<string, Recap[]>; open: Record<string, Stretch> }
export interface RecapStore { load(): unknown; save(d: RecapData): void }

export interface RecapView {
  /** newest first per farmer */
  farmers: ReadonlyMap<string, readonly Recap[]>;
  /** bumps whenever a recap lands (or the store is swapped) */
  rev: number;
}

export type RecapSeedFn = (f: Pick<RecapObs, 'id' | 'tag' | 'name' | 'title' | 'git'>, now: number) => Recap[];

export interface RecapRecorder {
  readonly view: RecapView;
  /** once per tick with every farmer present; returns the recaps that closed this tick */
  observe(list: Iterable<RecapObs>, now: number): Recap[];
  /** a wire event for a farmer: commit / test-pass / test-fail / error / finished */
  event(id: string, kind: string, now: number, detail?: { msg?: string; sha?: string | null }): void;
  /** the newest recap of a farmer */
  latest(id: string): Recap | null;
  /** a recap by key */
  get(key: string): Recap | null;
  /** switch storage (the demo valley: in memory, seeded with `seed` for farmers seen the first time) */
  use(store: RecapStore | undefined, seed?: RecapSeedFn | null): void;
  /** add a recap (dev / tests) */
  put(r: Recap): void;
  flush(): void;
  readonly data: RecapData;
}

const clip = (s: unknown, n: number): string | null => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t ? (t.length > n ? `${t.slice(0, n - 1)}…` : t) : null;
};
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const nn = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export const emptyRecaps = (): RecapData => ({ v: 1, farmers: {}, open: {} });

/** Coerce one stored recap (anything may be in storage); null when unusable. */
export function parseRecap(raw: unknown): Recap | null {
  if (!isObj(raw)) return null;
  const farmerId = str(raw.farmerId), from = nn(raw.from), to = nn(raw.to);
  if (!farmerId || from === null || to === null || to < from) return null;
  const lines = isObj(raw.lines) ? { added: num(raw.lines.added), removed: num(raw.lines.removed), files: num(raw.lines.files) } : null;
  const t = isObj(raw.tests) ? raw.tests : {};
  const td = isObj(raw.todos) ? { done: Array.isArray(raw.todos.done) ? raw.todos.done.filter((x): x is string => typeof x === 'string').slice(0, TODOS_MAX) : [], total: num(raw.todos.total), open: num(raw.todos.open) } : null;
  const sp = isObj(raw.spend) ? { tokens: num(raw.spend.tokens), cost: nn(raw.spend.cost) } : null;
  const g = isObj(raw.git) && typeof raw.git.repo === 'string'
    ? { repo: raw.git.repo, branch: str(raw.git.branch), from: str(raw.git.from), to: str(raw.git.to), dirty: num(raw.git.dirty), ahead: nn(raw.git.ahead) } : null;
  const end = raw.end === 'idle' || raw.end === 'left' ? raw.end : 'finished';
  return {
    key: str(raw.key) ?? `${farmerId}@${from}`, farmerId, tag: str(raw.tag) ?? farmerId, name: str(raw.name) ?? farmerId, from, to,
    active: num(raw.active), waited: num(raw.waited), asks: num(raw.asks), end,
    title: str(raw.title), said: str(raw.said),
    commits: parseCommits(raw.commits),
    lines, tests: { pass: num(t.pass), fail: num(t.fail), last: t.last === 'pass' || t.last === 'fail' ? t.last : null }, errors: num(raw.errors),
    todos: td, spend: sp, context: nn(raw.context), contextTokens: nn(raw.contextTokens), model: str(raw.model), git: g, partial: raw.partial === true,
  };
}

const STATUSES_OK: readonly Status[] = ['idle', 'working', 'blocked', 'done', 'unknown'];
const parseWork = (v: unknown): Stretch['work'] => (isObj(v) && nn(v.since) !== null ? { since: num(v.since), added: Math.max(0, num(v.added)), removed: Math.max(0, num(v.removed)), files: Math.max(0, num(v.files)) } : null);
const parseUsage = (v: unknown): Stretch['usage0'] => (isObj(v) && typeof v.day === 'string' ? { day: v.day, tokens: Math.max(0, num(v.tokens)), cost: nn(v.cost) } : null);
const parseCommits = (v: unknown): RecapCommit[] => (Array.isArray(v) ? v.filter(isObj).map((c) => ({ sha: str(c.sha), msg: str(c.msg) ?? '', at: num(c.at) })).slice(-COMMITS_MAX) : []);
function parseSnap(v: unknown, id: string): Stretch['snap'] {
  if (!isObj(v)) return null;
  const g = isObj(v.git) && typeof v.git.repo === 'string' ? { repo: v.git.repo, branch: str(v.git.branch), head: str(v.git.head), dirty: Math.max(0, num(v.git.dirty)), ahead: nn(v.git.ahead) } : null;
  return {
    id, tag: str(v.tag) ?? id, name: str(v.name) ?? id, status: STATUSES_OK.includes(v.status as Status) ? v.status as Status : 'idle',
    title: str(v.title), said: str(v.said),
    todos: Array.isArray(v.todos) ? v.todos.filter(isObj).map((t) => ({ content: String(t.content ?? ''), status: t.status === 'completed' || t.status === 'in_progress' ? t.status : 'pending' as const })) : null,
    git: g, context: nn(v.context), contextTokens: nn(v.contextTokens), model: str(v.model),
  };
}
/** Coerce one stored open stretch (garbage in any field reads as unknown, never throws later). */
function parseStretch(st: Record<string, unknown>, id: string, from: number, lastSeen: number): Stretch {
  const bank = isObj(st.bank) ? st.bank : {};
  return {
    farmerId: id, from, lastSeen, active: Math.max(0, num(st.active)), waited: Math.max(0, num(st.waited)), asks: Math.max(0, num(st.asks)),
    status: STATUSES_OK.includes(st.status as Status) ? st.status as Status : 'working',
    restSince: nn(st.restSince), closeAt: nn(st.closeAt), commits: parseCommits(st.commits),
    pass: Math.max(0, num(st.pass)), fail: Math.max(0, num(st.fail)), last: st.last === 'pass' || st.last === 'fail' ? st.last : null, errors: Math.max(0, num(st.errors)),
    usage0: parseUsage(st.usage0), usage1: parseUsage(st.usage1),
    todos0: Array.isArray(st.todos0) ? st.todos0.filter((x): x is string => typeof x === 'string') : [],
    head0: str(st.head0), work0: parseWork(st.work0), work: parseWork(st.work),
    bank: { added: Math.max(0, num(bank.added)), removed: Math.max(0, num(bank.removed)), files: Math.max(0, num(bank.files)) },
    partial: st.partial === true, snap: parseSnap(st.snap, id),
  };
}

/** Coerce the stored data: recaps per farmer (newest first, ≤ RECAP_KEEP), open stretches younger than STALE_OPEN_MS. */
export function parseRecaps(raw: unknown, now: number): RecapData {
  const out = emptyRecaps();
  if (!isObj(raw)) return out;
  if (isObj(raw.farmers)) {
    for (const [id, list] of Object.entries(raw.farmers)) {
      if (!Array.isArray(list)) continue;
      const rs = list.map(parseRecap).filter((r): r is Recap => !!r && r.farmerId === id).sort((a, b) => b.to - a.to).slice(0, RECAP_KEEP);
      if (rs.length) out.farmers[id] = rs;
    }
  }
  if (isObj(raw.open)) {
    for (const [id, s] of Object.entries(raw.open)) {
      if (!isObj(s) || s.farmerId !== id) continue;
      const from = nn(s.from), lastSeen = nn(s.lastSeen);
      if (from === null || lastSeen === null || now - lastSeen > STALE_OPEN_MS) continue;
      out.open[id] = parseStretch(s, id, from, lastSeen);
    }
  }
  return out;
}

const doneTexts = (todos: RecapObs['todos']): string[] => (todos ?? []).filter((t) => t.status === 'completed').map((t) => String(t.content));

/** lines of the stretch: earlier tasks' counters + this task's growth since the stretch opened */
function stretchLines(s: Stretch): { added: number; removed: number; files: number } {
  const w = s.work, base = w && s.work0 && s.work0.since === w.since ? s.work0 : null;
  const cur = w ? { added: Math.max(0, w.added - (base?.added ?? 0)), removed: Math.max(0, w.removed - (base?.removed ?? 0)), files: Math.max(0, w.files - (base?.files ?? 0)) } : { added: 0, removed: 0, files: 0 };
  return { added: s.bank.added + cur.added, removed: s.bank.removed + cur.removed, files: s.bank.files + cur.files };
}

/** spend inside the stretch: today's figure at the end minus at the start (a day roll counts only the new day) */
function stretchSpend(s: Stretch): { tokens: number; cost: number | null } | null {
  const a = s.usage0, b = s.usage1;
  if (!b) return null;
  if (!a || a.day !== b.day) return { tokens: Math.max(0, b.tokens), cost: b.cost };
  const tokens = Math.max(0, b.tokens - a.tokens);
  const cost = b.cost === null || a.cost === null ? null : Math.max(0, b.cost - a.cost);
  return { tokens, cost };
}

/** Did the stretch earn a recap? (enough work, or it shipped / changed / tested something) */
export function meaningful(s: Pick<Stretch, 'active' | 'commits' | 'pass' | 'fail'>, lines: { added: number; removed: number }): boolean {
  return s.active >= MIN_ACTIVE_MS || s.commits.length > 0 || lines.added + lines.removed > 0 || s.pass + s.fail > 0;
}

/** Close a stretch into a recap (null when it was not meaningful). */
export function closeStretch(s: Stretch, to: number, end: RecapEnd): Recap | null {
  const lines = stretchLines(s);
  if (!meaningful(s, lines)) return null;
  const sn = s.snap;
  const done0 = new Set(s.todos0);
  const todosNow = sn?.todos ?? null;
  const ticked = (todosNow ?? []).filter((t) => t.status === 'completed' && !done0.has(String(t.content))).map((t) => clip(t.content, 90)!).filter(Boolean);
  const g = sn?.git ?? null;
  return {
    key: `${s.farmerId}@${s.from}`, farmerId: s.farmerId, tag: sn?.tag ?? s.farmerId, name: sn?.name ?? s.farmerId,
    from: s.from, to: Math.max(s.from, to), active: s.active, waited: s.waited, asks: s.asks, end,
    title: clip(sn?.title, 140), said: clip(sn?.said, 280),
    commits: s.commits.slice(-COMMITS_MAX),
    lines: lines.added + lines.removed + lines.files > 0 ? lines : null,
    tests: { pass: s.pass, fail: s.fail, last: s.last }, errors: s.errors,
    todos: todosNow && todosNow.length ? { done: ticked.slice(0, TODOS_MAX), total: todosNow.length, open: todosNow.filter((t) => t.status !== 'completed').length } : null,
    spend: stretchSpend(s), context: sn?.context ?? null, contextTokens: sn?.contextTokens ?? null, model: sn?.model ?? null,
    git: g ? { repo: g.repo, branch: g.branch, from: s.head0, to: g.head, dirty: g.dirty, ahead: g.ahead } : null,
    partial: s.partial,
  };
}

const WORKING = (st: Status) => st === 'working' || st === 'blocked';

function openStretch(o: RecapObs, now: number, fresh: boolean, before: RecapObs['work'] = null): Stretch {
  // first sight of a farmer already mid-task (a reload without a stored stretch): it began when its task did
  const began = !fresh && o.work && o.work.since < now && now - o.work.since < STALE_OPEN_MS ? o.work.since : now;
  // a task already under way when the stretch opens (status flipped back to working on the same prompt): only its
  // growth since the farmer was last seen resting counts
  const sameTask = fresh && o.work && o.work.since < now - 5_000;
  const base = sameTask ? (before && before.since === o.work!.since ? before : o.work!) : null;
  return {
    farmerId: o.id, from: began, lastSeen: now, active: 0, waited: 0, asks: o.status === 'blocked' ? 1 : 0, status: o.status,
    restSince: null, closeAt: null, commits: [], pass: 0, fail: 0, last: null, errors: 0,
    usage0: o.usage, usage1: o.usage, todos0: fresh ? doneTexts(o.todos) : [], head0: o.git?.head ?? null,
    work0: base ? { ...base } : null, bank: { added: 0, removed: 0, files: 0 }, work: o.work ? { ...o.work } : null,
    partial: !fresh, snap: snapOf(o),
  };
}

const snapOf = (o: RecapObs): Stretch['snap'] => ({
  id: o.id, tag: o.tag, name: o.name, status: o.status, title: o.title, said: o.said,
  todos: o.todos ? o.todos.map((t) => ({ content: t.content, status: t.status })) : null,
  git: o.git ? { ...o.git } : null, context: o.context, contextTokens: o.contextTokens, model: o.model,
});

/** fold one observation into an open stretch (time, asks, counters, the snapshot) */
function advance(s: Stretch, o: RecapObs, now: number): void {
  const dt = Math.max(0, Math.min(now - s.lastSeen, 5_000));
  if (s.status === 'working') s.active += dt;
  else if (s.status === 'blocked') s.waited += dt;
  if (o.status === 'blocked' && s.status !== 'blocked') s.asks++;
  // a new prompt mid-stretch: bank the old task's counters
  if (o.work && s.work && o.work.since !== s.work.since) {
    const prev = stretchLines({ ...s, bank: { added: 0, removed: 0, files: 0 } });
    s.bank = { added: s.bank.added + prev.added, removed: s.bank.removed + prev.removed, files: s.bank.files + prev.files };
    s.work0 = null;
  }
  if (o.work) s.work = { ...o.work };
  if (o.usage) s.usage1 = { ...o.usage };
  if (!s.head0 && o.git?.head) s.head0 = o.git.head;
  s.status = o.status;
  s.lastSeen = now;
  s.snap = snapOf(o);
}

/**
 * The recorder. `observe` once a tick: opens a stretch when a farmer starts working, closes it on a finish (after
 * FINISH_LAG_MS), after SETTLE_MS idle / done, or LOST_MS after the farmer was last seen; returns the recaps that closed.
 */
export function createRecaps(store?: RecapStore, { now: start = Date.now(), seed = null }: { now?: number; seed?: RecapSeedFn | null } = {}): RecapRecorder {
  let st = store;
  let seedFn = seed;
  const load = (now: number): RecapData => { try { return parseRecaps(st?.load(), now); } catch { return emptyRecaps(); } };
  let data = load(start);
  let rev = 0, dirty = false, urgent = false, savedAt = 0, nowAt = start;
  const seen = new Set<string>(Object.keys(data.farmers));
  /** this session's last status per farmer (a stretch we watched start vs one already under way) */
  const known = new Map<string, { status: Status; work: RecapObs['work'] }>();
  const view: { farmers: Map<string, readonly Recap[]>; rev: number } = { farmers: new Map(Object.entries(data.farmers)), rev: 0 };
  const save = (now: number) => {
    if (!dirty || !st) return;
    if (!urgent && now - savedAt < SAVE_MS) return;
    try { st.save(data); } catch { /* storage full or blocked: recaps live on in memory */ }
    dirty = false; urgent = false; savedAt = now;
  };
  const add = (r: Recap) => {
    const list = [r, ...(data.farmers[r.farmerId] ?? []).filter((x) => x.key !== r.key)].sort((a, b) => b.to - a.to).slice(0, RECAP_KEEP);
    data.farmers[r.farmerId] = list;
    view.farmers.set(r.farmerId, list);
    const ids = Object.keys(data.farmers);
    if (ids.length > RECAP_FARMERS) {
      const stalest = ids.map((id) => [id, data.farmers[id][0]?.to ?? 0] as const).sort((a, b) => a[1] - b[1]).slice(0, ids.length - RECAP_FARMERS);
      for (const [id] of stalest) { if (id === r.farmerId) continue; delete data.farmers[id]; view.farmers.delete(id); }
    }
    view.rev = ++rev;
    dirty = true; urgent = true;
  };
  const close = (id: string, to: number, end: RecapEnd, out: Recap[]) => {
    const s = data.open[id];
    if (!s) return;
    delete data.open[id];
    dirty = true; urgent = true;
    const r = closeStretch(s, to, end);
    if (r) { add(r); out.push(r); }
  };
  return {
    view,
    get data() { return data; },
    observe(list, now) {
      nowAt = now;
      const out: Recap[] = [];
      const present = new Set<string>();
      for (const o of list) {
        present.add(o.id);
        if (!seen.has(o.id)) {
          seen.add(o.id);
          if (seedFn && !data.farmers[o.id]) for (const r of seedFn(o, now)) add(r);
        }
        let s: Stretch | undefined = data.open[o.id];
        const was = known.get(o.id);
        known.set(o.id, { status: o.status, work: o.work });
        // the valley was closed a long while: a stretch whose farmer has since stopped ends where it was last seen
        if (s && now - s.lastSeen > LOST_MS && !WORKING(o.status)) { close(o.id, s.lastSeen, s.status === 'done' ? 'finished' : 'idle', out); s = undefined; }
        if (!s) {
          if (!WORKING(o.status)) continue;
          // `fresh`: we watched it start (seen idle / done before); else it was already mid-task when the valley met it
          data.open[o.id] = openStretch(o, now, was !== undefined && !WORKING(was.status), was?.work);
          dirty = true;
          continue;
        }
        advance(s, o, now);
        dirty = true;
        // finished: close once the closing message and counters had a moment to arrive (whatever the status says by then)
        if (s.closeAt !== null && now >= s.closeAt) { close(o.id, s.closeAt - FINISH_LAG_MS, 'finished', out); continue; }
        if (WORKING(o.status)) { s.restSince = null; continue; }
        s.restSince ??= now;
        if (now - s.restSince >= SETTLE_MS) close(o.id, s.restSince, o.status === 'done' ? 'finished' : 'idle', out);
      }
      // gone home (or out of sight): close where it was last seen
      for (const [id, s] of Object.entries(data.open)) if (!present.has(id) && now - s.lastSeen > LOST_MS) close(id, s.lastSeen, 'left', out);
      save(now);
      return out;
    },
    event(id, kind, now, detail) {
      const s = data.open[id];
      if (!s) return;
      if (kind === 'commit') {
        const msg = clip(detail?.msg, 120) ?? 'a commit';
        s.commits.push({ sha: typeof detail?.sha === 'string' && /^[0-9a-f]{4,40}$/.test(detail.sha) ? detail.sha : null, msg, at: now });
        if (s.commits.length > COMMITS_MAX) s.commits.splice(0, s.commits.length - COMMITS_MAX);
        urgent = true;
      } else if (kind === 'test-pass') { s.pass++; s.last = 'pass'; } else if (kind === 'test-fail') { s.fail++; s.last = 'fail'; } else if (kind === 'error') s.errors++;
      else if (kind === 'finished') s.closeAt = now + FINISH_LAG_MS;
      else return;
      dirty = true;
      save(now);
    },
    latest: (id) => view.farmers.get(id)?.[0] ?? null,
    get(key) {
      const at = key.lastIndexOf('@');
      const list = view.farmers.get(key.slice(0, at)) ?? [];
      return list.find((r) => r.key === key) ?? null;
    },
    use(s, sd = null) {
      st = s; seedFn = sd;
      data = load(nowAt);
      seen.clear();
      for (const id of Object.keys(data.farmers)) seen.add(id);
      view.farmers = new Map(Object.entries(data.farmers));
      view.rev = ++rev;
    },
    put(r) { add(r); save(nowAt); },
    flush() { urgent = true; save(nowAt); },
  };
}

// ---- copy (pure; the HUD, letters and toasts share it) ---------------------------------------------------------------

/** '42 min', '1 h 05', '35 s' */
export function recapDur(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

/** the facts in one short line: '2 commits · +120 −30 in 6 files · tests green · 3 todos · 42 min' */
export function recapLine(r: Recap): string {
  const bits: string[] = [];
  if (r.commits.length) bits.push(`${r.commits.length} commit${r.commits.length === 1 ? '' : 's'}`);
  if (r.lines) bits.push(`+${r.lines.added} −${r.lines.removed}${r.lines.files ? ` in ${r.lines.files} file${r.lines.files === 1 ? '' : 's'}` : ''}`);
  const runs = r.tests.pass + r.tests.fail;
  if (runs) bits.push(r.tests.last === 'fail' ? `tests red (${r.tests.fail}/${runs})` : r.tests.fail ? `tests green after ${r.tests.fail} red` : 'tests green');
  if (r.todos?.done.length) bits.push(`${r.todos.done.length} todo${r.todos.done.length === 1 ? '' : 's'} done`);
  bits.push(recapDur(r.to - r.from));
  return bits.join(' · ');
}

/** the postcard headline: what kind of harvest it was */
export function recapHeadline(r: Recap): string {
  if (r.end === 'left') return 'Went home mid-task';
  if (r.commits.length) return r.commits.length === 1 ? 'Shipped a commit' : `Shipped ${r.commits.length} commits`;
  if (r.tests.last === 'fail') return 'Stopped with tests failing';
  if (r.lines) return r.git && r.git.dirty ? 'Changes ready to review' : 'Made changes';
  if (r.tests.pass) return 'Tests run, all green';
  return 'Finished a stretch of work';
}

/**
 * What to ask the server for the stretch's diff (`git.diff`): from the HEAD at the start; to the HEAD at the end when
 * the stretch committed and left the tree clean (a stable range), else the working tree now (`to` null: "up to now").
 * Null when the farmer was not in a repo.
 */
export function recapDiffQuery(r: Recap): { from: string; to: string | null } | null {
  const g = r.git;
  if (!g || !g.from) return null;
  const to = r.commits.length && g.dirty === 0 && g.to && g.to !== g.from ? g.to : null;
  return { from: g.from, to };
}

// ---- demo ----------------------------------------------------------------------------------------------------------

const DEMO_TITLES = ['Fix the flaky reconnect test', 'Add a diffstat to the harvest card', 'Tidy the ledger columns', 'Speed up the terrain build',
  'Wire todos into the card', 'Refactor the store adapter', 'Handle a detached HEAD in the sign', 'Make the toasts calmer'];
const DEMO_COMMITS = ['fix: reconnect races the hello', 'feat: diffstat on the harvest card', 'refactor: split the store adapter', 'test: cover the detached head',
  'perf: cache the height samples', 'fix: toasts coalesce per farmer', 'docs: signals audit', 'chore: bump the protocol revision', 'feat: todo checklist on the card'];
const DEMO_SAID = [
  'Done: the reconnect test is stable now (the hello raced the first world message). All 412 tests pass.',
  "I've added the diffstat and per-file list; the card links to it. Typecheck and tests are green.",
  'Refactored the adapter into two files and kept the API. Nothing else changed; tests pass.',
  'Fixed the sign for detached HEADs and added a test. One flaky browser test remains, unrelated.',
  'The terrain build is ~2× faster (cached height samples). Benchmarks in the PR description.',
];
const DEMO_TODOS = ['Read the failing test', 'Find the race', 'Write a fix', 'Add a regression test', 'Run the suite', 'Update the docs'];

/** A plausible earlier-today history for a demo farmer: 1–3 recaps, deterministic per farmer and day. */
export function demoRecaps(f: Pick<RecapObs, 'id' | 'tag' | 'name' | 'title' | 'git'>, now: number): Recap[] {
  const R = mulberry32(hash32(`recap|${f.id}|${Math.floor(now / 86_400_000)}`));
  const pick = <T>(a: readonly T[]) => a[Math.floor(R() * a.length)];
  const n = 1 + Math.floor(R() * 3);
  const out: Recap[] = [];
  let t = now - (20 + R() * 40) * 60_000;
  let head = hashHex(`${f.id}|h|${n}`).slice(0, 7);
  for (let i = 0; i < n; i++) {
    const len = (6 + R() * 50) * 60_000;
    const from = t - len;
    const commits: RecapCommit[] = [];
    const nc = R() < 0.7 ? 1 + Math.floor(R() * 3) : 0;
    const head0 = hashHex(`${f.id}|h|${n}|${i}`).slice(0, 7);
    for (let c = 0; c < nc; c++) commits.push({ sha: c === nc - 1 ? head : hashHex(`${f.id}|c|${i}|${c}`).slice(0, 7), msg: pick(DEMO_COMMITS), at: from + len * ((c + 1) / (nc + 0.5)) });
    const fails = R() < 0.35 ? 1 + Math.floor(R() * 2) : 0;
    const passes = R() < 0.85 ? 1 + Math.floor(R() * 3) : 0;
    const files = 1 + Math.floor(R() * 7);
    const added = Math.round(files * (8 + R() * 50)), removed = Math.round(added * R() * 0.6);
    const ticked = DEMO_TODOS.slice(0, 2 + Math.floor(R() * 4));
    const tokens = Math.round((0.3 + R() * 3) * 1e6);
    out.push({
      key: `${f.id}@${Math.round(from)}`, farmerId: f.id, tag: f.tag, name: f.name, from: Math.round(from), to: Math.round(t),
      active: Math.round(len * (0.7 + R() * 0.25)), waited: R() < 0.4 ? Math.round((1 + R() * 8) * 60_000) : 0, asks: R() < 0.4 ? 1 : 0, end: 'finished',
      title: i === 0 && f.title ? f.title : pick(DEMO_TITLES), said: pick(DEMO_SAID), commits,
      lines: { added, removed, files }, tests: { pass: passes, fail: fails, last: passes ? 'pass' : fails ? 'fail' : null }, errors: R() < 0.2 ? 1 : 0,
      todos: { done: ticked, total: ticked.length + (R() < 0.3 ? 1 : 0), open: 0 }, spend: { tokens, cost: Math.round(tokens * 4.2e-6 * 100) / 100 },
      context: 0.2 + R() * 0.6, contextTokens: Math.round(40_000 + R() * 100_000), model: 'Opus 5.5',
      git: f.git ? { repo: f.git.repo, branch: f.git.branch, from: head0, to: head, dirty: nc ? 0 : files, ahead: nc ? nc : 0 } : null,
      partial: false,
    });
    head = head0;
    t = from - (5 + R() * 40) * 60_000;
  }
  return out;
}
