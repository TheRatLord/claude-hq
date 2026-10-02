// @pure
/**
 * Valley Projects: the town's long restoration arc (docs/valley/projects.md). Six broken-down places around the valley
 * (a dark lantern path, a washed-out footbridge, a glasshouse frame, a stopped mill wheel, a rusted observatory dome,
 * an overgrown train halt) each have a plan pinned to the Mayor's projects board on the square. A plan needs a mix of
 * four things:
 *
 *  - **bits** from your purse, paid in at the board;
 *  - **items** from your basket (any forage find, any fish, something rare, an old boot), handed in at the board;
 *  - **friendship**: the villager who champions it must like you enough (hearts, read live from model/friends.ts);
 *  - **real work**: commits shipped, green test runs, asks answered, tasks finished, counted from the valley's events
 *    while the project is open (a demo valley's pretend farmers never count, like the stamp book's work stamps).
 *
 * Projects open in a little tree (`after`): three at first, the mill after the footbridge, the observatory after the
 * lanterns, the train halt last. When every need is met the project completes by itself (`check`), the champion
 * writes a letter, and the next time you come near the place the restored version is unveiled in the world
 * (scene/projects: confetti, a fanfare) and its small reward unlocks (a shortcut, a seat, a view, a daily flower).
 *
 * Persisted per browser profile (`claude-valley.projects.v1`): per project what was paid / handed in / worked, when it
 * was completed and unveiled, plus the glasshouse's last picking day. Nothing here copies another service's data.
 *
 * Pure: no DOM, no three; the clock, the store, the purse and the basket are injected.
 */
import type { ValleyEventKind } from './types.ts';
import { CATALOG, collectDef } from './collection.ts';
import type { CollectDef } from './collection.ts';
import { FRIEND_IDS, friendDef, heartsOf } from './friends.ts';
import type { FriendId, FriendsData } from './friends.ts';
import { dayKey } from './almanac.ts';

export const PROJECT_IDS = Object.freeze(['lanterns', 'footbridge', 'glasshouse', 'millwheel', 'observatory', 'halt'] as const);
export type ProjectId = (typeof PROJECT_IDS)[number];

/** Real agent work a project can need (counted from ValleyEvents). */
export const WORK_KINDS = Object.freeze(['ship', 'tests', 'unblocked', 'finished'] as const);
export type WorkKind = (typeof WORK_KINDS)[number];
export const WORK_NAME: Readonly<Record<WorkKind, readonly [string, string]>> = Object.freeze({
  ship: ['commit shipped', 'commits shipped'],
  tests: ['green test run', 'green test runs'],
  unblocked: ['ask answered', 'asks answered'],
  finished: ['task finished', 'tasks finished'],
});
/** which valley event counts as which kind of work */
export const WORK_OF: Readonly<Partial<Record<ValleyEventKind, WorkKind>>> = Object.freeze({
  ship: 'ship', celebrate: 'tests', unblocked: 'unblocked', finished: 'finished',
});

/** What a project accepts from your basket. */
export const ITEM_GROUPS = Object.freeze(['forage', 'fish', 'rare', 'boot'] as const);
export type ItemGroup = (typeof ITEM_GROUPS)[number];
export const GROUP_NAME: Readonly<Record<ItemGroup, readonly [string, string]>> = Object.freeze({
  forage: ['forage find', 'forage finds'],
  fish: ['fish', 'fish'],
  rare: ['rare find', 'rare finds'],
  boot: ['old boot', 'old boots'],
});
/** Does a basket item count for a group? (barn produce never does) */
export function inGroup(group: ItemGroup, d: CollectDef | undefined): boolean {
  if (!d || !CATALOG.includes(d)) return false;
  switch (group) {
    case 'forage': return d.kind === 'forage';
    case 'fish': return d.kind === 'fish' && !d.junk;
    case 'rare': return !!d.rare && !(d.kind === 'fish' && d.junk);
    case 'boot': return d.id === 'boot';
  }
}
export const groupItems = (g: ItemGroup): string[] => CATALOG.filter((d) => inGroup(g, d)).map((d) => d.id);

export interface ProjectDef {
  id: ProjectId;
  /** "Relight the lantern path" */
  title: string;
  /** the place itself: "the lantern path" */
  name: string;
  /** where to find it */
  where: string;
  /** what's wrong with it now (the board's note) */
  blurb: string;
  /** the restored line (the letter, the toast) */
  done: string;
  /** what finishing it unlocks, one line */
  unlock: string;
  /** who champions it (writes the plan and the thank-you letter) */
  who: FriendId;
  /** projects that must be finished first */
  after: readonly ProjectId[];
  bits: number;
  items: readonly { group: ItemGroup; n: number }[];
  work: Readonly<Partial<Record<WorkKind, number>>>;
  /** the champion's friendship needed */
  hearts: number;
}

const D = (o: ProjectDef): ProjectDef => Object.freeze(o);

/** The six projects, in board order. Ids are save keys: never rename one. */
export const PROJECTS: readonly ProjectDef[] = Object.freeze([
  D({
    id: 'lanterns', title: 'Relight the lantern path', name: 'the lantern path', where: 'the footpath up to the standing stones, north of the farmhouse',
    blurb: 'The old lanterns along the path to the standing stones have been dark for years: cracked glass, posts knocked askew. Fern walks it every night with her own lamp and would rather not.',
    done: 'The lanterns on the path to the standing stones are lit again. Fern says she can leave her own lamp at home.',
    unlock: 'the path to the standing stones glows every night', who: 'villager:fern', after: [],
    bits: 60, items: [{ group: 'forage', n: 3 }], work: { unblocked: 2 }, hearts: 2,
  }),
  D({
    id: 'footbridge', title: 'Mend the old footbridge', name: 'the old footbridge', where: 'over the river, downstream of the big bridge',
    blurb: 'A spring flood took the middle out of the little footbridge south of the big one. The stone ends still stand on both banks, and the west-bank fields are a long walk round without it.',
    done: 'The footbridge over the river is mended: new planks, rope rails and a lick of paint. The west bank is a short stroll away again.',
    unlock: 'a shortcut over the river to the west-bank fields', who: 'villager:bram', after: [],
    bits: 120, items: [{ group: 'fish', n: 2 }], work: { ship: 5 }, hearts: 3,
  }),
  D({
    id: 'glasshouse', title: 'Raise the glasshouse', name: 'the glasshouse', where: 'the meadow below the windmill hill, east of the water tower',
    blurb: 'Someone started a glasshouse on the sunny meadow below the windmill hill and never finished it: a bare frame, a heap of panes and some very determined weeds.',
    done: 'The glasshouse is glazed and planted. Posy has already claimed a corner for her violets.',
    unlock: 'a sweet violet to pick there every day, whatever the season', who: 'villager:posy', after: [],
    bits: 150, items: [{ group: 'forage', n: 5 }], work: { tests: 10 }, hearts: 3,
  }),
  D({
    id: 'millwheel', title: 'Rebuild the mill wheel', name: 'the river mill', where: 'the river bank north of the hot spring',
    blurb: 'The little river mill has stood still since its wheel lost half its paddles and the roof fell in. Hazel misses the sound of it, and its wheel is stuck fast with something old and soggy.',
    done: 'The mill wheel turns again, the roof is back on, and the millrace sings. Hazel says it sounds like home.',
    unlock: 'the wheel turns, and a bench by the millrace to sit and listen', who: 'villager:hazel', after: ['footbridge'],
    bits: 200, items: [{ group: 'fish', n: 3 }, { group: 'boot', n: 1 }], work: { ship: 15, finished: 5 }, hearts: 4,
  }),
  D({
    id: 'observatory', title: 'Open the observatory dome', name: 'the observatory', where: 'up the north slope, east of the standing stones',
    blurb: 'An old stargazer\'s observatory sits up the north slope, its dome rusted shut and its telescope wrapped in a dust sheet. Nimbus has been dying to get it open.',
    done: 'The observatory dome rolls open again and the telescope is polished. Nimbus has started a logbook of every clear night.',
    unlock: 'a telescope under the dome: sit and look at the stars', who: 'villager:nimbus', after: ['lanterns'],
    bits: 250, items: [{ group: 'rare', n: 1 }, { group: 'forage', n: 4 }], work: { tests: 25 }, hearts: 4,
  }),
  D({
    id: 'halt', title: 'Restore the train halt', name: 'the train halt', where: 'the valley\'s south rim, east of the hay meadow',
    blurb: 'Trains still pass the valley in the evening, but nobody has waved one down at the old halt since the platform grew over and the bell went missing. The Mayor wants it back on the timetable.',
    done: 'The train halt is restored: a swept platform, a bell, a bench and a lamp. The evening train whistles as it passes now.',
    unlock: 'the halt\'s bell (ring it and the evening train whistles back) and a bench on the platform', who: 'villager:marigold', after: ['glasshouse', 'millwheel', 'observatory'],
    bits: 400, items: [{ group: 'fish', n: 4 }, { group: 'forage', n: 4 }], work: { ship: 40, unblocked: 10 }, hearts: 5,
  }),
] as ProjectDef[]);

const BY_ID = new Map(PROJECTS.map((p) => [p.id, p]));
export const projectDef = (id: string): ProjectDef | undefined => BY_ID.get(id as ProjectId);
export const isProjectId = (id: unknown): id is ProjectId => typeof id === 'string' && BY_ID.has(id as ProjectId);

// ---------------------------------------------------------------------------------------------
// Data

export interface ProjectState {
  /** bits paid in */
  bits: number;
  /** items handed in, per group */
  items: Partial<Record<ItemGroup, number>>;
  /** real work counted while it was open, per kind */
  work: Partial<Record<WorkKind, number>>;
  /** when it was completed (ms), 0 = not yet */
  done: number;
  /** when the restored place was first seen (the unveiling), 0 = not yet */
  unveiled: number;
}
export interface ProjectsData {
  v: 1;
  p: Partial<Record<ProjectId, ProjectState>>;
  /** the glasshouse's last picking day (YYYY-MM-DD) */
  picked: string;
  /** lifetime: bits and items given, for the notebook */
  total: { bits: number; items: number };
}

export const emptyProject = (): ProjectState => ({ bits: 0, items: {}, work: {}, done: 0, unveiled: 0 });
export const emptyProjects = (): ProjectsData => ({ v: 1, p: {}, picked: '', total: { bits: 0, items: 0 } });

const int = (v: unknown, max = 1e9): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(max, Math.floor(v)) : 0);

/** Tolerant parse (anything malformed → null; unknown projects, groups and kinds are dropped, amounts capped at the need). */
export function parseProjects(raw: unknown): ProjectsData | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return null;
  const d = emptyProjects();
  const ps = o.p && typeof o.p === 'object' ? (o.p as Record<string, unknown>) : {};
  for (const def of PROJECTS) {
    const r = ps[def.id];
    if (!r || typeof r !== 'object') continue;
    const x = r as Record<string, unknown>;
    const s = emptyProject();
    s.bits = Math.min(def.bits, int(x.bits));
    const it = x.items && typeof x.items === 'object' ? (x.items as Record<string, unknown>) : {};
    for (const n of def.items) { const v = Math.min(n.n, int(it[n.group])); if (v) s.items[n.group] = v; }
    const wk = x.work && typeof x.work === 'object' ? (x.work as Record<string, unknown>) : {};
    for (const k of WORK_KINDS) { const need = def.work[k] ?? 0; const v = Math.min(need, int(wk[k])); if (v) s.work[k] = v; }
    s.done = int(x.done, 8.64e15);
    s.unveiled = s.done ? int(x.unveiled, 8.64e15) : 0;
    d.p[def.id] = s;
  }
  d.picked = typeof o.picked === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.picked) ? o.picked : '';
  const t = o.total && typeof o.total === 'object' ? (o.total as Record<string, unknown>) : {};
  d.total = { bits: int(t.bits), items: int(t.items) };
  return d;
}

// ---------------------------------------------------------------------------------------------
// The view

export type ProjectStatus = 'locked' | 'open' | 'done';
export type Need =
  | { kind: 'bits'; have: number; need: number }
  | { kind: 'item'; group: ItemGroup; have: number; need: number }
  | { kind: 'work'; work: WorkKind; have: number; need: number }
  | { kind: 'hearts'; who: FriendId; have: number; need: number };

export interface ProjectEntry {
  def: ProjectDef;
  status: ProjectStatus;
  state: ProjectState;
  needs: Need[];
  /** 0..1 over every need (each weighted the same) */
  progress: number;
  /** every need met (it completes on the next check) */
  ready: boolean;
  /** completed but the restored place not seen yet */
  pending: boolean;
  /** the unfinished projects it waits for (locked only) */
  waiting: ProjectDef[];
}
export interface ProjectsView {
  entries: ProjectEntry[];
  done: number;
  total: number;
  /** open projects you could give something to right now (bits in the purse, a fitting item in the basket) */
  canGive: number;
}

/** What the board needs to know about the rest of the valley. */
export interface ProjectsWorld {
  /** friendship points per villager (model/friends.ts `pts`) */
  friends: Readonly<Pick<FriendsData, 'pts'>> | null;
  /** your purse */
  coins: number;
  /** your basket (item id → count) */
  basket: Readonly<Record<string, number>>;
}

const state = (m: ProjectsData, id: ProjectId): ProjectState => m.p[id] ?? emptyProject();
export const isDone = (m: ProjectsData, id: ProjectId): boolean => state(m, id).done > 0;
export function statusOf(m: ProjectsData, def: ProjectDef): ProjectStatus {
  if (isDone(m, def.id)) return 'done';
  return def.after.every((a) => isDone(m, a)) ? 'open' : 'locked';
}
export const heartsFor = (w: Pick<ProjectsWorld, 'friends'> | null, who: string): number => heartsOf(w?.friends?.pts[who] ?? 0);

export function needsOf(def: ProjectDef, s: ProjectState, w: Pick<ProjectsWorld, 'friends'> | null): Need[] {
  const out: Need[] = [];
  if (def.bits) out.push({ kind: 'bits', have: Math.min(def.bits, s.bits), need: def.bits });
  for (const it of def.items) out.push({ kind: 'item', group: it.group, have: Math.min(it.n, s.items[it.group] ?? 0), need: it.n });
  for (const k of WORK_KINDS) { const n = def.work[k]; if (n) out.push({ kind: 'work', work: k, have: Math.min(n, s.work[k] ?? 0), need: n }); }
  if (def.hearts) {
    // once done, the friendship it needed is history: show it met
    const have = s.done ? def.hearts : Math.min(def.hearts, heartsFor(w, def.who));
    out.push({ kind: 'hearts', who: def.who, have, need: def.hearts });
  }
  return out;
}
export const needMet = (n: Need): boolean => n.have >= n.need;

/** Basket items that fit an item need (id → count), most plentiful first. */
export function fitting(group: ItemGroup, basket: Readonly<Record<string, number>>): { id: string; n: number }[] {
  return Object.entries(basket).filter(([id, n]) => n > 0 && inGroup(group, collectDef(id))).map(([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n || a.id.localeCompare(b.id));
}

export function projectsView(m: ProjectsData, w: ProjectsWorld | null): ProjectsView {
  let canGive = 0;
  const entries = PROJECTS.map((def): ProjectEntry => {
    const s = state(m, def.id);
    const status = statusOf(m, def);
    const needs = needsOf(def, s, w);
    const progress = status === 'done' ? 1 : needs.reduce((a, n) => a + Math.min(1, n.have / n.need), 0) / Math.max(1, needs.length);
    if (status === 'open' && w && needs.some((n) => !needMet(n) && ((n.kind === 'bits' && w.coins > 0) || (n.kind === 'item' && fitting(n.group, w.basket).length > 0)))) canGive++;
    return {
      def, status, state: s, needs, progress, ready: status === 'open' && needs.every(needMet), pending: status === 'done' && !s.unveiled,
      waiting: status === 'locked' ? def.after.filter((a) => !isDone(m, a)).map((a) => BY_ID.get(a)!) : [],
    };
  });
  return { entries, done: entries.filter((e) => e.status === 'done').length, total: PROJECTS.length, canGive };
}

// ---------------------------------------------------------------------------------------------
// Changes (pure, on the data)

/** Count one piece of real work toward every open project that still needs that kind. Demo valleys never count. */
export function countWork(m: ProjectsData, kind: WorkKind, demo: boolean): ProjectId[] {
  if (demo) return [];
  const out: ProjectId[] = [];
  for (const def of PROJECTS) {
    const need = def.work[kind] ?? 0;
    if (!need || statusOf(m, def) !== 'open') continue;
    const s = (m.p[def.id] ??= emptyProject());
    if ((s.work[kind] ?? 0) >= need) continue;
    s.work[kind] = (s.work[kind] ?? 0) + 1;
    out.push(def.id);
  }
  return out;
}

/** The completion letter (re-made from the done date on load, so nothing but the date is stored). */
export function projectLetter(def: ProjectDef, at: number): { id: string; at: number; from: string; fromName: string; title: string; body: string } {
  const f = friendDef(def.who);
  return {
    id: `project:${def.id}`, at, from: def.who, fromName: f?.name ?? 'The Mayor',
    title: `${def.name[0].toUpperCase()}${def.name.slice(1)} is restored!`,
    body: `${def.done}\n\nThank you for everything you put in at the projects board: the bits, the finds, and all that hard work from your farmers. Go and have a look (${def.where}): ${def.unlock}.\n\nThe board in the square shows what the valley could take on next.\n\n${f ? f.short : 'Marigold'}`,
  };
}

// ---------------------------------------------------------------------------------------------
// The live board (main.ts creates one; the scene and the HUD read it)

export interface ProjectsStore { load(): unknown; save(d: ProjectsData): void }
export interface ProjectsPorts {
  /** take bits from the purse (WalletService.spend): false if short */
  spend?: (coins: number, why: string) => boolean;
  /** take finds out of the basket (WalletService.take): how many came out */
  take?: (id: string, n: number) => number;
  /** stash a find in the basket (the glasshouse's violet) */
  stash?: (id: string, n: number) => void;
}
export type ProjectsChange =
  | { kind: 'give'; id: ProjectId; what: 'bits' | ItemGroup; n: number }
  | { kind: 'work'; ids: ProjectId[]; work: WorkKind }
  | { kind: 'complete'; id: ProjectId; at: number }
  | { kind: 'unveil'; id: ProjectId; at: number }
  | { kind: 'pick'; item: string }
  | { kind: 'reset' };

export type GiveResult = { ok: true; n: number } | { ok: false; reason: 'locked' | 'done' | 'full' | 'short' | 'item' | 'none' };

export interface ProjectsService {
  /** bumps on every change */
  readonly version: number;
  data(): Readonly<ProjectsData>;
  view(w?: ProjectsWorld | null): ProjectsView;
  /** pay bits in (capped at what's still needed and what's in the purse; n omitted = as much as possible) */
  pay(id: ProjectId, n?: number): GiveResult;
  /** hand in basket items for an item need (n omitted = 1) */
  give(id: ProjectId, group: ItemGroup, item: string, n?: number): GiveResult;
  /** a valley event (only work kinds count; never in a demo) */
  event(kind: ValleyEventKind, demo: boolean): void;
  /** complete every open project whose needs are all met (≈ 1 Hz and after changes); returns the ones that just did */
  check(w: Pick<ProjectsWorld, 'friends'> | null): ProjectId[];
  /** the restored place was seen for the first time */
  unveil(id: ProjectId): boolean;
  /** the glasshouse's daily violet: true if picked now (once a day, once restored) */
  pick(): boolean;
  /** has today's violet been picked */
  picked(): boolean;
  onChange(fn: (c: ProjectsChange) => void): () => void;
  /** dev: finish a project now (its needs filled); `unveil` = also mark it seen */
  devComplete(id: ProjectId, unveil?: boolean): boolean;
  /** dev: forget one project (or all) */
  devReset(id?: ProjectId): void;
}

export function createProjects(store: ProjectsStore | undefined, ports: ProjectsPorts = {}, now: () => number = Date.now): ProjectsService {
  let data: ProjectsData;
  try { data = parseProjects(store?.load()) ?? emptyProjects(); } catch { data = emptyProjects(); }
  let version = 0;
  const fns = new Set<(c: ProjectsChange) => void>();
  const save = () => { version++; try { store?.save(data); } catch (err) { console.warn('[projects] save failed', err); } };
  const tell = (c: ProjectsChange) => { for (const f of [...fns]) { try { f(c); } catch (err) { console.error('[projects] listener threw', err); } } };
  const openState = (id: ProjectId): { def: ProjectDef; s: ProjectState } | GiveResult => {
    const def = BY_ID.get(id);
    if (!def) return { ok: false, reason: 'none' };
    const st = statusOf(data, def);
    if (st === 'locked') return { ok: false, reason: 'locked' };
    if (st === 'done') return { ok: false, reason: 'done' };
    return { def, s: (data.p[id] ??= emptyProject()) };
  };
  const complete = (def: ProjectDef, at: number) => {
    const s = (data.p[def.id] ??= emptyProject());
    s.done = at;
    tell({ kind: 'complete', id: def.id, at });
  };

  const self: ProjectsService = {
    get version() { return version; },
    data: () => data,
    view: (w) => projectsView(data, w ?? null),
    pay(id, n) {
      const o = openState(id);
      if ('ok' in o) return o;
      const left = o.def.bits - o.s.bits;
      if (left <= 0) return { ok: false, reason: 'full' };
      const want = Math.min(left, n === undefined ? left : Math.max(0, Math.floor(n)));
      if (want <= 0) return { ok: false, reason: 'short' };
      if (!ports.spend?.(want, `projects board: ${o.def.name}`)) return { ok: false, reason: 'short' };
      o.s.bits += want;
      data.total.bits += want;
      save();
      tell({ kind: 'give', id, what: 'bits', n: want });
      return { ok: true, n: want };
    },
    give(id, group, item, n = 1) {
      const o = openState(id);
      if ('ok' in o) return o;
      const need = o.def.items.find((x) => x.group === group);
      if (!need || !inGroup(group, collectDef(item))) return { ok: false, reason: 'item' };
      const left = need.n - (o.s.items[group] ?? 0);
      if (left <= 0) return { ok: false, reason: 'full' };
      const got = ports.take?.(item, Math.min(left, Math.max(1, Math.floor(n)))) ?? 0;
      if (got <= 0) return { ok: false, reason: 'short' };
      o.s.items[group] = (o.s.items[group] ?? 0) + got;
      data.total.items += got;
      save();
      tell({ kind: 'give', id, what: group, n: got });
      return { ok: true, n: got };
    },
    event(kind, demo) {
      const w = WORK_OF[kind];
      if (!w) return;
      const ids = countWork(data, w, demo);
      if (!ids.length) return;
      save();
      tell({ kind: 'work', ids, work: w });
    },
    check(w) {
      const out: ProjectId[] = [];
      const t = now();
      // one pass per tier: finishing one can open the next, which waits for the next check (a beat later)
      for (const def of PROJECTS) {
        if (statusOf(data, def) !== 'open') continue;
        if (!needsOf(def, state(data, def.id), w).every(needMet)) continue;
        complete(def, t);
        out.push(def.id);
      }
      if (out.length) save();
      return out;
    },
    unveil(id) {
      const s = data.p[id];
      if (!s?.done || s.unveiled) return false;
      s.unveiled = now();
      save();
      tell({ kind: 'unveil', id, at: s.unveiled });
      return true;
    },
    pick() {
      if (!isDone(data, 'glasshouse')) return false;
      const day = dayKey(now());
      if (data.picked === day) return false;
      data.picked = day;
      try { ports.stash?.('violet', 1); } catch (err) { console.warn('[projects] stash failed', err); }
      save();
      tell({ kind: 'pick', item: 'violet' });
      return true;
    },
    picked: () => data.picked === dayKey(now()),
    onChange(fn) { fns.add(fn); return () => fns.delete(fn); },
    devComplete(id, unveil = false) {
      const def = BY_ID.get(id);
      if (!def) return false;
      const s = (data.p[id] ??= emptyProject());
      if (!s.done) {
        s.bits = def.bits;
        for (const it of def.items) s.items[it.group] = it.n;
        for (const k of WORK_KINDS) if (def.work[k]) s.work[k] = def.work[k];
        complete(def, now());
      }
      if (unveil && !s.unveiled) { s.unveiled = now(); tell({ kind: 'unveil', id, at: s.unveiled }); }
      save();
      return true;
    },
    devReset(id) {
      if (id) delete data.p[id]; else data = emptyProjects();
      save();
      tell({ kind: 'reset' });
    },
  };
  return self;
}

/** every villager id a project needs (for tests and the notebook) */
export const CHAMPIONS: readonly FriendId[] = Object.freeze(FRIEND_IDS.filter((f) => PROJECTS.some((p) => p.who === f)));
