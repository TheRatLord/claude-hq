// @pure
/**
 * The valley model: reduces a ValleySource (entities, workspaces, stats, events) to a ValleyState the presentation
 * reads. Pure and clock-injected: node tests drive it with plain objects, the game drives it from the store.
 */
import type { Entity, EventMsg, Stats, ToolClass, Workspace } from '../../../../shared/protocol.ts';
import { hash32 } from '../../../../shared/identity.ts';
import { SITES } from '../world/map.ts';
import { createJobSmoother, rawJob, stickyTool, JOB_BUSY, shortDetail } from './jobs.ts';
import type { JobSmoother } from './jobs.ts';
import { skyAt } from './sky.ts';
import type { SkyOverrides } from './sky.ts';
import { PLOT_KINDS } from './types.ts';
import { almanacView, dayKey, emptyAlmanac, parseAlmanac, recapDue, recapLetter, recordHarvest, RANKS } from './almanac.ts';
import type { AlmanacData, HarvestKind } from './almanac.ts';
import { createTimeline } from './timeline.ts';
import type { MarkKind, SeedFn, TimelineRecorder, TimelineStore } from './timeline.ts';
import { contextFill, emptySpendLedger, modelLabel, plotRepo, recordSpend, repoView, spendToday, todoItems, valleySpend } from './signals.ts';
import type {
  FarmerView, Gauges, HelperView, Job, Letter, LetterKind, LinkState, Mood, PlotKind, PlotStage, PlotView, ValleyEvent, ValleyState,
} from './types.ts';

/** Where the model reads from. The store adapter lives in main; tests and the gallery use plain objects. */
export interface ValleySource {
  entities(): Iterable<Entity>;
  workspaces(): readonly Workspace[];
  stats(): Stats | null;
  /** server-clock ms */
  now(): number;
  link(): LinkState;
  demo(): boolean;
}

export const TILL_MS = 6_000;
export const HARVEST_MS = 6_000;
/** matches server/world/slots.ts SLOT_FREE_MS: the slot (and so the site) is reclaimable after this */
export const FALLOW_MS = 5 * 60_000;
const THRIVE_MS = 3 * 60_000;
const REST_MS = 60 * 60_000;
const LETTERS_MAX = 80;
const HISTORY = 120;

interface PlotRec { view: PlotView; seen: boolean; growthLines: number }
interface FarmerRec { smoother: JobSmoother; since: number; tool: ToolClass | null }

export interface Valley {
  readonly state: ValleyState;
  /** rebuild views from the source (call a few times a second, and on store changes) */
  tick(): void;
  /** feed a wire event (store `event` topic) */
  ingest(e: EventMsg): void;
  /** subscribe to one-shot reactions */
  on(fn: (e: ValleyEvent) => void): () => void;
  markRead(letterId: string): void;
  markAllRead(): void;
  /** debug: pin the hour / weather (null clears) */
  setSky(o: SkyOverrides): void;
  /** the overrides currently applied (dev / photo mode restore them) */
  skyOverrides(): Readonly<SkyOverrides>;
  /** for the local clock (sky); defaults to Date.now */
  wallNow?: () => number;
  /** debug: set the almanac's points (gallery / shots / the dev API) */
  setAlmanac(points: number): void;
  /** switch where the almanac lives (the demo valley swaps in its own), loading what that store holds */
  useAlmanac(store: AlmanacStore): void;
  /** the almanac as stored: per-day harvest counts (the Gazette sums a week of them) */
  almanacData(): Readonly<AlmanacData>;
  /** a harvest that is not a valley event (the player's first-ever finds for the Collections book): points, maybe a rank */
  harvest(kind: HarvestKind): number;
  /** each farmer's day (model/timeline.ts): fed by tick / ingest; read through `state.timeline` */
  readonly timeline: TimelineRecorder;
  /** switch where the timeline lives (the demo valley keeps a seeded morning in memory) */
  useTimeline(store: TimelineStore | undefined, seed?: SeedFn | null): void;
  /** a letter from a villager (model/friends.ts milestones): a 'news' letter at `at`, once per `id` */
  post(l: { id: string; at: number; from: string; fromName: string; title: string; body: string }): void;
}

/** Where the almanac persists (browser-local storage in the app; nothing in tests unless given). */
export interface AlmanacStore {
  load(): unknown;
  save(data: AlmanacData): void;
}

/** valley events that are harvests in the almanac */
const HARVEST_OF: Partial<Record<ValleyEvent['kind'], HarvestKind>> = {
  ship: 'commit', celebrate: 'tests', finished: 'finished', unblocked: 'answered', 'plot-opened': 'tilled', 'duckling-hatched': 'ducklings',
};

/** wire events that are moments on a farmer's day timeline */
const MARK_OF: Partial<Record<EventMsg['kind'], MarkKind>> = {
  commit: 'ship', 'test-pass': 'pass', 'test-fail': 'fail', error: 'error', finished: 'finished', 'subagent-spawned': 'sub', compact: 'compact',
};

export function createValley(src: ValleySource, { wallNow = Date.now, almanac: alStore, timeline: tlStore }: { wallNow?: () => number; almanac?: AlmanacStore; timeline?: TimelineStore } = {}): Valley {
  const listeners = new Set<(e: ValleyEvent) => void>();
  const send = (e: ValleyEvent) => { for (const f of [...listeners]) { try { f(e); } catch (err) { console.error('[valley] listener threw', err); } } };
  const loadAlmanac = (st: AlmanacStore | undefined): AlmanacData => { try { return parseAlmanac(st?.load()) ?? emptyAlmanac(); } catch { return emptyAlmanac(); } };
  let alData = loadAlmanac(alStore);
  let alDay = '';
  const saveAlmanac = () => { try { alStore?.save(alData); } catch (err) { console.warn('[valley] almanac save failed', err); } };
  const harvest = (h: HarvestKind): number => {
    const { earned, rankUp } = recordHarvest(alData, h, wallNow());
    state.almanac = almanacView(alData, wallNow());
    if (!earned && !rankUp) return 0;
    saveAlmanac();
    if (rankUp) send({ kind: 'level-up', id: 'valley', detail: state.almanac.name });
    return earned;
  };
  const emit = (e: ValleyEvent) => {
    send(e);
    const h = HARVEST_OF[e.kind];
    if (h) harvest(h);
  };
  const tl = createTimeline(tlStore, { now: wallNow() });
  const farmerRecs = new Map<string, FarmerRec>();
  const spendLedger = emptySpendLedger();
  const plotRecs = new Map<string, PlotRec>();
  const cpuHist: number[] = [], memHist: number[] = [];
  let lastStatsAt = 0;
  let skyO: SkyOverrides = {};
  let primed = false;
  let liveTicks = 0;
  let commitDay = new Date(wallNow()).toDateString();
  let letterSeq = 0;
  const prevStatus = new Map<string, Entity['status']>();

  const state: ValleyState = {
    now: src.now(), link: src.link(), demo: src.demo(),
    farmers: new Map(), helpers: new Map(), plots: new Map(), letters: [], commitsToday: 0, gauges: null,
    sky: skyAt(new Date(wallNow())),
    almanac: almanacView(alData, wallNow()),
    timeline: tl.view,
    spend: valleySpend(spendLedger, wallNow()),
  };

  const letter = (kind: LetterKind, e: Entity | undefined, id: string, title: string, body = '') => {
    // coalesce chatty kinds per farmer within a minute
    const recent = state.letters.find((l) => l.farmerId === id && l.kind === kind && !l.read && state.now - l.at < 60_000);
    if (recent && (kind === 'test-pass' || kind === 'subagents' || kind === 'news' || kind === 'commit')) {
      recent.at = state.now; recent.title = title; recent.body = body || recent.body;
      return;
    }
    const plot = e ? state.plots.get(e.workspace.id)?.label ?? e.workspace.label : '';
    state.letters.unshift({
      id: `L${++letterSeq}`, at: state.now, kind, farmerId: id, farmerName: e?.name ?? id, plotLabel: plot, title, body, read: false,
      resolved: false,
    });
    if (state.letters.length > LETTERS_MAX) state.letters.length = LETTERS_MAX;
  };

  const kindFor = (w: Workspace, taken: Set<PlotKind>): PlotKind => {
    const h = hash32(`${w.label}#${w.number}`);
    for (let k = 0; k < PLOT_KINDS.length; k++) {
      const c = PLOT_KINDS[(h + k) % PLOT_KINDS.length];
      if (!taken.has(c)) return c;
    }
    return PLOT_KINDS[h % PLOT_KINDS.length];
  };

  function tickPlots(now: number, entities: Entity[]) {
    const wss = src.workspaces();
    const live = new Set(wss.map((w) => w.id));
    for (const r of plotRecs.values()) r.seen = false;
    const takenKinds = new Set<PlotKind>([...plotRecs.values()].filter((r) => live.has(r.view.id)).map((r) => r.view.kind));
    const bySite = new Map<number, PlotRec>();
    for (const r of plotRecs.values()) bySite.set(r.view.site, r);
    for (const w of [...wss].sort((a, b) => a.slot - b.slot)) {
      let r = plotRecs.get(w.id);
      if (!r) {
        const site = w.slot % SITES.length;
        // a new workspace reclaims its site from any fallow plot still resting there
        const prior = bySite.get(site);
        if (prior && !live.has(prior.view.id)) plotRecs.delete(prior.view.id);
        const kind = kindFor(w, takenKinds);
        takenKinds.add(kind);
        r = {
          seen: true, growthLines: 0,
          view: {
            id: w.id, label: w.label, site, kind, colorIndex: w.colorIndex, stage: primed ? 'tilling' : 'growing', stageSince: now,
            growth: 0.25, vigor: 0, status: w.status, farmers: [], helpers: [], git: null,
          },
        };
        plotRecs.set(w.id, r);
        if (primed) emit({ kind: 'plot-opened', id: w.id });
      }
      r.seen = true;
      r.view.label = w.label;
      r.view.colorIndex = w.colorIndex;
      r.view.status = w.status;
    }
    // activity per workspace
    const lastActive = new Map<string, number>();
    const lines = new Map<string, number>();
    for (const e of entities) {
      const t = e.status === 'working' || e.status === 'blocked' ? now : Math.max(e.statusSince, e.activity?.since ?? 0);
      lastActive.set(e.workspace.id, Math.max(lastActive.get(e.workspace.id) ?? 0, t));
      if (e.work) lines.set(e.workspace.id, (lines.get(e.workspace.id) ?? 0) + e.work.added + e.work.removed * 0.5);
    }
    for (const [id, r] of plotRecs) {
      const v = r.view;
      if (!r.seen) {
        if (v.stage !== 'harvest' && v.stage !== 'fallow') { v.stage = 'harvest'; v.stageSince = now; emit({ kind: 'plot-closed', id }); }
        else if (v.stage === 'harvest' && now - v.stageSince > HARVEST_MS) { v.stage = 'fallow'; v.stageSince = now; }
        else if (v.stage === 'fallow' && now - v.stageSince > FALLOW_MS) plotRecs.delete(id);
        v.vigor = Math.max(0, v.vigor - 0.02);
        v.farmers = []; v.helpers = [];
        continue;
      }
      const la = lastActive.get(id) ?? 0;
      const idle = la ? now - la : Infinity;
      v.vigor = la ? Math.exp(-idle / (15 * 60_000)) : 0;
      r.growthLines = Math.max(r.growthLines, lines.get(id) ?? 0);
      v.growth = Math.max(v.growth, 0.25 + 0.75 * (1 - Math.exp(-r.growthLines / 500)));
      let stage: PlotStage = idle < THRIVE_MS ? 'thriving' : idle < REST_MS ? 'growing' : 'resting';
      if (v.stage === 'tilling' && now - v.stageSince < TILL_MS) stage = 'tilling';
      if (v.stage === 'harvest' || v.stage === 'fallow') { stage = 'tilling'; emit({ kind: 'plot-opened', id }); } // reopened
      if (stage !== v.stage) { v.stage = stage; v.stageSince = now; }
    }
  }

  function farmerView(e: Entity, now: number, spot: number): FarmerView {
    const raw = rawJob(e);
    let rec = farmerRecs.get(e.id);
    const t = now / 1000;
    if (!rec) { rec = { smoother: createJobSmoother(raw, t), since: now, tool: null }; farmerRecs.set(e.id, rec); }
    const job: Job = rec.smoother.step(raw, t);
    rec.tool = e.status === 'working' ? stickyTool(job, e.activity?.cls, rec.tool) : null;
    const struggle = (e.struggle?.level ?? 0) as 0 | 1 | 2 | 3;
    const needsYou = e.status === 'blocked';
    const unseenDone = e.status === 'done' && !e.ack;
    const mood: Mood = needsYou ? 'worried' : struggle >= 2 ? 'stuck' : e.status === 'done' ? 'proud' : e.status === 'unknown' ? 'sleepy'
      : e.status === 'idle' ? 'happy' : 'focused';
    const subs = e.subagents.map((s) => ({ id: s.id, label: s.label, type: s.type, active: s.active }));
    for (const [i, label] of (e.activity?.subs ?? []).entries()) {
      if (!subs.some((s) => s.label === label)) subs.push({ id: `${e.id}:s${i}`, label, type: 'sub', active: true });
    }
    const todos = e.todos && e.todos.length
      ? { done: e.todos.filter((x) => x.status === 'completed').length, total: e.todos.length, current: e.todos.find((x) => x.status === 'in_progress')?.activeForm ?? null, items: todoItems(e.todos) }
      : null;
    const ctx = contextFill(e);
    return {
      id: e.id, name: e.name, project: projectName(e), tag: projectName(e), kind: e.kind === 'shell' ? 'agent' : e.kind, vendor: e.vendor ?? null, seed: e.seedKey, tier: e.modelTier, plotId: e.workspace.id, spot,
      status: e.status, job, jobSince: rec.smoother.since * 1000, rawJob: raw, tool: rec.tool,
      detail: needsYou ? shortDetail(e.prompt?.subject?.arg ?? e.prompt?.question ?? e.activity?.detail) : shortDetail(e.activity?.detail),
      title: e.title, needsYou, unseenDone, struggle, mood,
      busy: Math.min(1, JOB_BUSY[job] + struggle * 0.05),
      ducklings: subs.slice(0, 8),
      said: e.lastText, question: needsYou ? e.prompt?.question ?? e.activity?.detail ?? 'Needs your input' : null,
      options: needsYou ? (e.prompt?.options ?? []).map((o) => ({ key: o.key, label: o.label })) : [],
      todos, work: e.work ? { added: e.work.added, removed: e.work.removed, files: e.work.files } : null,
      context: ctx?.fill ?? null, contextTokens: ctx ? e.contextTokens : null, contextWindow: ctx?.size ?? null,
      model: modelLabel(e.model) ?? (e.kind === 'codex' ? 'Codex' : null), git: repoView(e.git), spend: spendToday(e.usage, wallNow()),
      lastActive: Math.max(e.statusSince, e.activity?.since ?? 0),
    };
  }

  function helperView(e: Entity, spot: number): HelperView {
    const p = e.process;
    const exit = p?.exit ? (p.exit.code === 0 ? 'ok' : 'fail') : null;
    const running = !!p && p.activity !== 'prompt';
    return {
      id: e.id, name: e.name, project: projectName(e), tag: projectName(e), plotId: e.workspace.id, spot, activity: p?.activity ?? 'prompt', running, exit,
      label: shortDetail(p?.argv ?? e.baseTitle ?? e.name, 32), ports: p?.ports ?? [], git: repoView(e.git),
    };
  }

  function tickGauges(s: Stats | null) {
    if (!s) return;
    const mem = s.mem.total ? s.mem.used / s.mem.total : 0;
    const cpu = Math.min(1, s.cpu.total / 100);
    if (s.at !== lastStatsAt) {
      lastStatsAt = s.at;
      cpuHist.push(cpu); memHist.push(mem);
      if (cpuHist.length > HISTORY) cpuHist.shift();
      if (memHist.length > HISTORY) memHist.shift();
    }
    const root = s.disks.find((d) => d.mount === '/') ?? s.disks[0];
    const temps = [s.temps.cpu, s.temps.gpu, s.temps.nvme].filter((t): t is number => typeof t === 'number');
    const GB = 1024 ** 3;
    const g: Gauges = {
      at: s.at, host: s.host, cpu, cores: s.cpu.cores.map((c) => Math.min(1, c / 100)), load1: s.cpu.load[0] ?? 0,
      mem, memUsedGB: s.mem.used / GB, memTotalGB: s.mem.total / GB, swap: s.mem.swapTotal ? s.mem.swapUsed / s.mem.swapTotal : 0,
      disk: root && root.total ? root.used / root.total : 0, diskUsedGB: root ? root.used / GB : 0, diskTotalGB: root ? root.total / GB : 0,
      ioRead: s.io.readBps, ioWrite: s.io.writeBps, netRx: s.net.rxBps, netTx: s.net.txBps,
      gpu: s.gpu ? Math.min(1, s.gpu.busy / 100) : null, tempC: temps.length ? Math.max(...temps) : null,
      cpuHistory: cpuHist.slice(), memHistory: memHist.slice(),
    };
    state.gauges = g;
  }

  function tick() {
    const now = src.now();
    state.now = now;
    state.link = src.link();
    state.demo = src.demo();
    state.sky = skyAt(new Date(wallNow()), skyO);
    const entities = [...src.entities()];
    tickPlots(now, entities);
    const farmers = new Map<string, FarmerView>();
    const helpers = new Map<string, HelperView>();
    const spots = new Map<string, number>();
    const hspots = new Map<string, number>();
    const ordered = entities.sort((a, b) => a.tab.index - b.tab.index || a.paneIndex - b.paneIndex || a.id.localeCompare(b.id));
    for (const e of ordered) {
      const plot = plotRecs.get(e.workspace.id)?.view;
      if (e.kind === 'shell') {
        const s = hspots.get(e.workspace.id) ?? 0;
        hspots.set(e.workspace.id, s + 1);
        helpers.set(e.id, helperView(e, s));
      } else {
        const s = spots.get(e.workspace.id) ?? 0;
        spots.set(e.workspace.id, s + 1);
        farmers.set(e.id, farmerView(e, now, s));
      }
      // letters seeded on connect: agents already waiting on you
      const was = prevStatus.get(e.id);
      if (!primed && e.status === 'blocked') letter('needs-you', e, e.id, `${e.name} needs you`, e.prompt?.question ?? '');
      if (was !== undefined && was !== e.status) {
        if (e.status === 'blocked') emit({ kind: 'blocked', id: e.id });
        if (was === 'blocked') emit({ kind: 'unblocked', id: e.id });
      }
      prevStatus.set(e.id, e.status);
      void plot;
    }
    for (const id of [...prevStatus.keys()]) if (!farmers.has(id) && !helpers.has(id)) { prevStatus.delete(id); farmerRecs.delete(id); }
    for (const p of plotRecs.values()) { p.view.farmers = []; p.view.helpers = []; }
    for (const f of farmers.values()) plotRecs.get(f.plotId)?.view.farmers.push(f.id);
    for (const h of helpers.values()) plotRecs.get(h.plotId)?.view.helpers.push(h.id);
    // in-world names: unique per field (farmers and helpers each), in spot order
    for (const p of plotRecs.values()) {
      for (const [ids, views] of [[p.view.farmers, farmers], [p.view.helpers, helpers]] as const) {
        if (ids.length < 2) continue;
        const list = ids.map((id) => views.get(id)!);
        worldTags(list).forEach((t, i) => { list[i].tag = t; });
      }
    }
    state.farmers = farmers;
    state.helpers = helpers;
    state.plots = new Map([...plotRecs].map(([id, r]) => [id, r.view]));
    tl.observe(farmers.values(), wallNow());
    // the field's repo (branch on the sign, weeds, crates) and the valley's spend today
    const byPlot = new Map<string, Entity[]>();
    for (const e of ordered) { const l = byPlot.get(e.workspace.id); if (l) l.push(e); else byPlot.set(e.workspace.id, [e]); }
    for (const [id, p] of state.plots) if (p.stage !== 'harvest' && p.stage !== 'fallow') p.git = plotRepo(byPlot.get(id) ?? []);
    for (const f of farmers.values()) recordSpend(spendLedger, f.id, f.spend ?? null, wallNow());
    state.spend = valleySpend(spendLedger, wallNow());
    for (const l of state.letters) {
      if (l.kind === 'needs-you' && !l.resolved) {
        const f = farmers.get(l.farmerId);
        if (!f || !f.needsYou) l.resolved = true;
      }
    }
    tickGauges(src.stats());
    // the almanac's "today" rolls over at local midnight
    const day = new Date(wallNow()).toDateString();
    if (day !== alDay) { alDay = day; state.almanac = almanacView(alData, wallNow()); }
    // the Mayor's evening recap: once a day, from six, if anything was harvested
    if (primed && recapDue(alData, wallNow())) {
      alData.recap = dayKey(wallNow());
      saveAlmanac();
      const r = recapLetter(state.almanac);
      letter('news', undefined, 'villager:marigold', r.title, r.body);
      state.letters[0].farmerName = 'Mayor Marigold';
    }
    // prime once the first real world arrived (a tick before that must not swallow the on-connect letters)
    if (entities.length || src.workspaces().length || (state.link === 'live' && ++liveTicks > 8)) primed = true;
  }

  const detailText = (d: unknown, ...keys: string[]): string => {
    if (!d || typeof d !== 'object') return '';
    for (const k of keys) { const v = (d as Record<string, unknown>)[k]; if (typeof v === 'string' && v) return v; }
    return '';
  };

  function ingest(m: EventMsg) {
    const e = [...src.entities()].find((x) => x.id === m.id);
    const name = e?.name ?? m.id;
    state.now = src.now();
    const mk = MARK_OF[m.kind];
    if (mk) tl.mark(m.id, mk, wallNow(), m.kind === 'finished' ? e?.title ?? '' : m.kind === 'subagent-spawned' ? detailText(m.detail, 'label', 'type')
      : detailText(m.detail, 'msg', 'message', 'subject', 'cmd', 'summary', 'tool'));
    else if (m.kind === 'struggle' && ((m.detail as { level?: number } | undefined)?.level ?? 0) >= 2) tl.mark(m.id, 'struggle', wallNow(), detailText(m.detail, 'detail', 'reason'));
    switch (m.kind) {
      case 'blocked': letter('needs-you', e, m.id, `${name} needs you`, e?.prompt?.question ?? e?.activity?.detail ?? ''); break;
      case 'finished': letter('finished', e, m.id, `${name} finished`, e?.title ?? e?.lastText ?? ''); emit({ kind: 'finished', id: m.id }); break;
      case 'error': letter('error', e, m.id, `${name} hit an error`, detailText(m.detail, 'tool', 'message')); emit({ kind: 'oops', id: m.id }); break;
      case 'test-fail': letter('test-fail', e, m.id, `Tests failed for ${name}`, detailText(m.detail, 'cmd', 'summary')); emit({ kind: 'oops', id: m.id }); break;
      case 'test-pass': letter('test-pass', e, m.id, `Tests passed for ${name}`, detailText(m.detail, 'cmd')); emit({ kind: 'celebrate', id: m.id }); break;
      case 'commit': {
        const day = new Date(wallNow()).toDateString();
        if (day !== commitDay) { commitDay = day; state.commitsToday = 0; }
        state.commitsToday++;
      }
        letter('commit', e, m.id, `${name} shipped a commit`, detailText(m.detail, 'msg', 'message', 'subject')); emit({ kind: 'ship', id: m.id }); break;
      case 'struggle': {
        const lvl = typeof (m.detail as { level?: unknown } | undefined)?.level === 'number' ? (m.detail as { level: number }).level : 0;
        if (lvl >= 2) letter('struggle', e, m.id, `${name} is struggling`, detailText(m.detail, 'detail', 'reason'));
        emit({ kind: 'struggle', id: m.id });
        break;
      }
      case 'arrived': if (primed) { letter('arrived', e, m.id, `${name} arrived in the valley`, e?.workspace.label ?? ''); emit({ kind: 'arrived', id: m.id }); } break;
      case 'left': letter('left', e, m.id, `${name} went home`, ''); emit({ kind: 'left', id: m.id }); break;
      case 'subagent-spawned': letter('subagents', e, m.id, `${name} hatched helpers`, detailText(m.detail, 'label', 'type')); emit({ kind: 'duckling-hatched', id: m.id, detail: detailText(m.detail, 'label') }); break;
      case 'subagent-done': emit({ kind: 'duckling-home', id: m.id, detail: detailText(m.detail, 'label') }); break;
      case 'compact': emit({ kind: 'compact', id: m.id }); break;
      default: break;
    }
  }

  return {
    state, tick, ingest,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    markRead(id) { const l = state.letters.find((x) => x.id === id); if (l) l.read = true; },
    useAlmanac(st) {
      alStore = st;
      alData = loadAlmanac(st);
      state.almanac = almanacView(alData, wallNow());
    },
    harvest,
    almanacData: () => alData,
    timeline: tl,
    useTimeline(st, seed) { tl.use(st, seed); state.timeline = tl.view; },
    post(l) {
      const id = `V:${l.id}`;
      if (state.letters.some((x) => x.id === id)) return;
      state.letters.push({ id, at: l.at, kind: 'news', farmerId: l.from, farmerName: l.fromName, plotLabel: '', title: l.title, body: l.body, read: false, resolved: false });
      state.letters.sort((a, b) => b.at - a.at);
      if (state.letters.length > LETTERS_MAX) state.letters.length = LETTERS_MAX;
    },
    setAlmanac(points) {
      const before = state.almanac.rank;
      alData = { ...alData, points: Math.max(0, points) };
      state.almanac = almanacView(alData, wallNow());
      if (state.almanac.rank > before) send({ kind: 'level-up', id: 'valley', detail: RANKS[state.almanac.rank].name });
    },
    markAllRead() { for (const l of state.letters) l.read = true; },
    setSky(o) { skyO = { ...skyO, ...o }; state.sky = skyAt(new Date(wallNow()), skyO); },
    skyOverrides: () => ({ ...skyO }),
  };
}

/** basename of a path ('' for '/', '', '~'). */
const baseOf = (p: string | null | undefined): string => {
  const b = String(p ?? '').trim().replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? '';
  return b === '~' ? '' : b;
};

/** The project directory name for the 3D world: basename of the project (repo) name, else of the cwd, else the name. */
export function projectName(e: { project?: string | null; cwd?: string | null; name: string }): string {
  return baseOf(e.project) || baseOf(e.cwd) || baseOf(e.name) || e.name;
}

/** a herdr name short and clean enough to tell twins apart in the world ('flint', 'review'; not paths or sentences) */
const cleanWord = (name: string, project: string): string | null => {
  const n = name.trim();
  if (!n || n.length > 14 || /[\s/\\~:]/.test(n) || /^\d+$/.test(n)) return null;
  const l = n.toLowerCase(), p = project.toLowerCase();
  if (l === p || l.startsWith(`${p}·`)) return null;
  return n;
};

/**
 * In-world names, unique within one field (`items` = one field's farmers or helpers, in spot order): the project
 * directory name; twins sharing it get `project·word` when every twin has a distinct clean one-word herdr name, else
 * the first keeps the bare project and the rest get `·2`, `·3`, … Returns tags in input order.
 */
export function worldTags(items: readonly { name: string; project: string }[]): string[] {
  const groups = new Map<string, number[]>();
  items.forEach((it, i) => { const k = it.project.toLowerCase(); const g = groups.get(k); if (g) g.push(i); else groups.set(k, [i]); });
  const out = items.map((it) => it.project);
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const words = g.map((i) => cleanWord(items[i].name, items[i].project));
    const distinct = new Set(words.map((w) => w?.toLowerCase())).size === g.length;
    g.forEach((i, n) => { out[i] = distinct && words.every(Boolean) ? `${items[i].project}·${words[n]!.toLowerCase()}` : n ? `${items[i].project}·${n + 1}` : items[i].project; });
  }
  return out;
}

/** Letters the player hasn't read that still matter (unresolved asks count double in the badge). */
export function unreadCount(letters: readonly Letter[]): number {
  return letters.filter((l) => !l.read && !(l.kind === 'needs-you' && l.resolved)).length;
}
