/**
 * createApp(opts) → {port, url, token, instanceId, session, close(), kill()}.
 * `server/main.ts` is the CLI around it. Live and demo differ ONLY in which implementations are wired:
 *
 *   live:  HerdrClient (allowlist, read-only) → HerdrLive (HerdrSource) + transcripts/subagents/procinfo/blocked/acks
 *          enrichers → WorldModel; HerdrTerminals (TerminalBackend) → TerminalHub. Reaper scan before the first spawn.
 *   demo:  static demo source + DemoEnricher/procinfo (BE2) + blocked/acks (BE) → WorldModel; FakeTerminals → hub.
 *          `--demo` never constructs a herdr client.
 * Owner: BE.
 */
import crypto from 'node:crypto';
import { resolveConfig, loadOrCreateToken, sessionDir, loadSettings, saveSettings } from './config.ts';
import type { AppOptions, ResolvedConfig } from './config.ts';
import { RealClock } from './clock.ts';
import { createLogger } from './log.ts';
import type { ScopedLogger } from './log.ts';
import { DEFAULT_SETTINGS, S2R } from '../shared/protocol.ts';
import type { Settings } from '../shared/protocol.ts';
import { isRecord, errCode, errMessage } from '../shared/guards.ts';
import type { Clock, Enricher, HerdrSource, TerminalBackend } from './interfaces.ts';
import type { HerdrClient } from './herdr/client.ts';
import type { DemoEnricher } from './demo/world.ts';
import type { Reaper } from './reaper.ts';
import type { StatsSampler } from './stats/sampler.ts';
import { WorldModel } from './world/model.ts';
import { Actions } from './world/actions.ts';
import { BlockedEnricher } from './world/blocked.ts';
import { AcksEnricher } from './world/acks.ts';
import { Screens } from './world/screens.ts';
import { TerminalHub } from './terminals/hub.ts';
import { WsHub } from './ws.ts';
import { createHttpServer } from './http.ts';
import { writeLock, removeLock } from './instance.ts';
import { Timeline } from './world/timeline.ts';
import { AuditLog } from './audit.ts';
import { NotesEnricher } from './world/notes.ts';

/** herdr link summary for `hello` and the metrics. */
interface HerdrInfo { connected: boolean; protocol: number | null; readOnly: boolean }

/** A TerminalBackend plus the optional hooks the wiring uses (live: HerdrTerminals; demo/replay: FakeTerminals). */
type Terminals = TerminalBackend & {
  mintPromoteToken?: (id: string) => string;
  drop?: (id: string) => void;
  metrics?: () => unknown;
  killAll?: () => void;
};

/** What each wiring (live, demo, replay) hands createApp. */
interface Wiring {
  source: HerdrSource;
  enrichers: Enricher[];
  terminals: Terminals;
  stateDir: string | null;
  readOnly: () => boolean;
  herdrInfo: () => HerdrInfo;
  isDefault?: boolean;
  /** replay: whether the recording used the demo owner set */
  demoOwners?: boolean;
  demoEnricher?: DemoEnricher;
  client?: HerdrClient;
  reaper?: Reaper;
  bindModel?: (m: WorldModel) => void;
}

interface WireCtx { clock: Clock; log: ScopedLogger }

/** The running backend, also exposed to its integration tests. */
export interface App {
  port: number;
  url: string;
  token: string;
  instanceId: string;
  session: string;
  close(): Promise<void>;
  /** second signal: SIGKILL every child now */
  kill(): void;
  model: WorldModel;
  hub: TerminalHub;
  source: HerdrSource;
  clock: Clock;
  settings: Settings;
  actions: Actions;
  timeline: Timeline;
  audit: AuditLog;
  client: HerdrClient | null;
}

/**
 * Options: see config.ts AppOptions (resolveConfig) plus clock, log, lock?:false, herdrSocket?, herdrBin?, record?, replay?.
 */
export async function createApp(opts: AppOptions = {}): Promise<App> {
  const cfg = resolveConfig(opts);
  const log = opts.log ?? createLogger('hq');
  if (cfg.timescale !== 1 && !cfg.demo && !opts.replay) throw new Error('--timescale is only accepted with --demo or --replay');
  const clock = opts.clock ?? RealClock(cfg.timescale);
  const token = cfg.token ?? loadOrCreateToken(cfg.configDir);
  const instanceId = crypto.randomBytes(8).toString('hex');
  const startedAt = clock.now();
  const settings = loadSettings(cfg.configDir, DEFAULT_SETTINGS);
  // the `allowMutations` setting is never honoured (config.ts UNPERSISTED_SETTINGS; actions.ts gates on the session)
  if (opts.replay && !opts.session) cfg.session = 'replay'; // BE2: a replay never claims a real session's name or lock
  const useLock = opts.lock !== false && !cfg.demo && !opts.replay; // demo/replay backends may coexist (no herdr children)

  const w: Wiring = opts.replay ? await wireReplay(opts.replay, opts.speed ?? 1, { clock, log }) // BE2: --replay (record.ts)
    : cfg.demo ? await wireDemo(cfg.demo, cfg, { clock, log }) : await wireLive(cfg, { clock, log, instanceId, opts });
  const { source, enrichers, terminals, stateDir, readOnly, herdrInfo } = w;
  const blocked = enrichers.find((e) => e instanceof BlockedEnricher) ?? null;
  const acks = enrichers.find((e) => e instanceof AcksEnricher) ?? null;
  const notes = enrichers.find((e) => e instanceof NotesEnricher) ?? null;

  // BE2: --record F appends every source snapshot/status + enricher patch/event (record.ts); attached before the model
  const recorder = opts.record ? (await import('./record.ts')).attachRecorder({ file: opts.record, source, enrichers, clock, session: cfg.session, demo: !!cfg.demo }) : null;
  const model = new WorldModel({ source, enrichers, clock, log: log.child('world'), session: cfg.session, demo: w.demoOwners ?? !!cfg.demo, dev: cfg.dev, stateDir,
    ...(opts.graceMs ? { graceMs: opts.graceMs } : {}) }); // graceMs: tests only
  recorder?.ready();
  w.bindModel?.(model);
  const hub = new TerminalHub({
    backend: terminals, clock, log: log.child('term'), readOnly,
    layoutRect: (id) => model.get(id)?.layoutRect ?? null,
    paneScroll: async (id) => {
      const r = await source.request('pane.get', { pane_id: id });
      const scroll = isRecord(r) && isRecord(r.pane) && isRecord(r.pane.scroll) ? r.pane.scroll.offset_from_bottom : null;
      return typeof scroll === 'number' ? scroll : null;
    },
    idleDemotion: () => !!settings.idleDemotion, online: () => source.connected !== false,
  });
  model.on('msg', (m) => {
    if (m.t === S2R.GONE) {
      hub.paneGone(m.id, m.reason === 'rekeyed' ? 'rekeyed' : 'pane closed');
      terminals.drop?.(m.id);
    }
  });
  source.on('connected', (c) => {
    if (!c) hub.offline();
  });
  const screens = new Screens({ source, hub, model, clock, log: log.child('screens') });
  const timeline = new Timeline({ dir: stateDir, clock, log: log.child('timeline') }).attach(model);
  const audit = new AuditLog({ dir: stateDir, session: cfg.session, clock, log: log.child('audit') });
  const actions = new Actions({
    source, model, clock, session: cfg.session, isDefault: w.isDefault, demo: !!cfg.demo, settings,
    demoEnricher: w.demoEnricher ?? null, acks, blocked, screens, timeline, readOnly, audit, notes,
    saveSettings: (s) => {
      try {
        saveSettings(cfg.configDir, s);
      } catch (e) {
        log.warn(`settings not saved: ${errMessage(e)}`);
      }
    },
  });
  const stats = await loadStats({ clock, log: log.child('stats') });
  const wsHub = new WsHub({
    model, hub, actions, source, screens, clock, log: log.child('ws'), audit,
    statsHistory: () => stats?.history() ?? [],
    helloInfo: () => {
      const demoConfig = source.demoConfig;
      return {
        session: cfg.session, instanceId, demo: cfg.demo, timescale: clock.timescale, defaultSession: !!w.isDefault,
        ...(demoConfig ? { demoConfig } : {}),
        herdr: herdrInfo(),
        allowMutations: actions.mutationsAllowed, settings: { ...settings },
      };
    },
  });
  stats?.on('stats', (s) => wsHub.broadcast({ t: S2R.STATS, stats: s }));
  // M1 integ: demo/replay expose metrics(), live a plain object
  const sourceMetrics = (): unknown => {
    if (!('metrics' in source)) return null;
    const m = source.metrics;
    return typeof m === 'function' ? m.call(source) : m ?? null;
  };
  const server = createHttpServer({
    token, distDir: cfg.distDir, dev: cfg.dev, vitePort: cfg.vitePort, metrics: cfg.metrics, instanceId, session: cfg.session, demo: cfg.demo, wsHub, log,
    auditFn: (n) => audit.read(n), // GET /api/audit (M3: the drawer's Recent HQ actions panel)
    metricsFn: () => ({
      instanceId, session: cfg.session, demo: cfg.demo,
      herdr: { ...herdrInfo(), client: w.client?.stats ?? null, live: sourceMetrics() },
      terminals: hub.metrics(), backend: terminals.metrics?.() ?? null, ws: wsHub.metrics(), world: model.metrics(),
      enrichers: Object.fromEntries(enrichers.map((e) => [e.name, 'metrics' in e && typeof e.metrics === 'function' ? e.metrics() : null])), screens: screens.metrics(),
      timeline: timeline.metrics(), audit: audit.metrics(),
    }),
  });

  await new Promise<void>((resolve, reject) => {
    const onErr = (e: Error) => {
      server.off('listening', onOk);
      if (errCode(e) === 'EADDRINUSE') reject(new Error(`port ${cfg.port} is in use by another program (127.0.0.1:${cfg.port}); pick --port`));
      else reject(e);
    };
    const onOk = () => {
      server.off('error', onErr);
      resolve();
    };
    server.once('error', onErr);
    server.once('listening', onOk);
    server.listen(cfg.port, cfg.host);
  }).catch(async (e) => {
    await teardown();
    throw e;
  });
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('http server is not listening on a TCP port');
  const port = addr.port;
  const url = `http://127.0.0.1:${port}/?t=${token}`;
  if (useLock) writeLock(cfg.configDir, cfg.session, { port, instanceId, startedAt });

  async function teardown(): Promise<void> {
    await recorder?.close();
    stats?.stop();
    await hub.closeAll();
    await wsHub.close();
    screens.close();
    timeline.close();
    model.close();
    await terminals.close();
    await source.close();
    w.reaper?.close();
  }

  let closing: Promise<void> | null = null;
  const close = (): Promise<void> =>
    (closing ??= (async () => {
      await teardown();
      if (useLock) removeLock(cfg.configDir, cfg.session, instanceId);
      server.closeAllConnections?.();
      await new Promise<void>((r) => server.close(() => r()));
    })());
  /** Second signal: SIGKILL every child now. */
  const kill = (): void => {
    terminals.killAll?.();
    w.reaper?.killAll();
    if (useLock) removeLock(cfg.configDir, cfg.session, instanceId);
  };

  return { port, url, token, instanceId, session: cfg.session, close, kill, model, hub, source, clock, settings, actions, timeline, audit, client: w.client ?? null };
}

async function wireDemo(n: number, cfg: ResolvedConfig, { clock, log }: WireCtx): Promise<Wiring> {
  // BE2 (M1): DemoWorld (seeded schedules, scenarios) replaces the M0.5 static demo.
  const { createDemo } = await import('./demo/world.ts');
  const { FakeTerminals } = await import('./demo/fakeTerm.ts');
  const { source, demo, enrichers: demoEnrichers } = createDemo({ clock, n, seed: cfg.seed, scenario: cfg.scenario, log: log.child('demo') });
  // BE owns the blocked path: the real parser runs on the demo's `pane.read detection` text.
  const enrichers = [...demoEnrichers, new BlockedEnricher({ clock, log: log.child('blocked') }), new AcksEnricher({ dir: null, clock, log }),
    new NotesEnricher({ dir: null, clock, log })];
  let model: WorldModel | null = null;
  const terminals = new FakeTerminals({
    clock,
    output: (id) => source.facts.get(id)?.out ?? null, // demo shells: what the DemoWorld shell printed
    describe: (id) => model?.get(id) ?? null, // the whole entity: FakeTerminals feeds its mock TUI from activity/status/prompt
  });
  source.paneReader = (id, o) => terminals.read(id, o);
  source.paneScroll = (id) => terminals.scrollOffset(id);
  source.paneTouched = (id) => terminals.touched(id);
  return {
    source, enrichers, terminals, demoEnricher: demo, stateDir: null, readOnly: () => false,
    herdrInfo: () => ({ connected: source.connected, protocol: null, readOnly: false }),
    bindModel: (m) => {
      model = m;
      source.on('demo-reset', () => {
        for (const e of enrichers) {
          if (e instanceof AcksEnricher || e instanceof NotesEnricher) {
            for (const key of Object.keys(e.map)) delete e.map[key];
          }
        }
        source.seedSince(m.since);
      });
      source.seedSince(m.since); // longIdle's honest ages
      source.start();
    },
  };
}

/** --replay F [--speed K] (BE2, record.ts): a read-only HerdrSource + one replay enricher per recorded owner. */
async function wireReplay(file: string, speed: number, { clock, log }: WireCtx): Promise<Wiring> {
  const { createReplay } = await import('./record.ts');
  const { FakeTerminals } = await import('./demo/fakeTerm.ts');
  const { source, enrichers, demo } = createReplay({ file, clock, speed, log: log.child('replay') });
  let model: WorldModel | null = null;
  const terminals = new FakeTerminals({ clock, describe: (id) => {
    const e = model?.get(id);
    return e ? { kind: e.kind, name: e.name, cwd: e.cwd, title: e.title } : null;
  } });
  return {
    source, enrichers, terminals, demoOwners: demo, stateDir: null, readOnly: () => true,
    herdrInfo: () => ({ connected: source.connected, protocol: null, readOnly: true }),
    bindModel: (m) => {
      model = m;
      source.start();
    },
  };
}

async function wireLive(cfg: ResolvedConfig, { clock, log, instanceId, opts }: WireCtx & { instanceId: string; opts: AppOptions }): Promise<Wiring> {
  const { HerdrClient } = await import('./herdr/client.ts');
  const { HerdrLive } = await import('./herdr/live.ts');
  const { isDefaultTarget } = await import('./herdr/resolve.ts');
  const { HerdrTerminals } = await import('./terminals/herdr.ts');
  const { Reaper, stateTag } = await import('./reaper.ts');
  const { TranscriptsEnricher } = await import('./enrich/transcripts.ts');
  const { SubagentsEnricher } = await import('./enrich/subagents.ts');
  const { ProcInfoEnricher } = await import('./enrich/procinfo.ts');
  // ONE default-session verdict (realpath of the session socket AND of a socket override) for every gate
  const isDefault = isDefaultTarget(cfg.session, opts.herdrSocket ?? null);
  if (isDefault && cfg.session !== 'default') log.warn(`herdr session "${cfg.session}" resolves to the DEFAULT socket: treated as the default session (structural actions refused)`);
  const stateDir = sessionDir(cfg.configDir, cfg.session);
  const reaper = new Reaper({ configDir: cfg.configDir, stateDir, instanceId, clock, log: log.child('reaper'), bin: opts.herdrBin });
  await reaper.scan(); // before the first spawn
  const client = new HerdrClient({
    session: cfg.session, isDefault, clock, instanceId, stateTag: stateTag(cfg.configDir), log: log.child('herdr'), socket: opts.herdrSocket ?? undefined, bin: opts.herdrBin,
    onSpawn: (child, info) => reaper.track(child, info),
  });
  const source = new HerdrLive({ client, clock, log: log.child('live') });
  const enrichers = [
    new TranscriptsEnricher({ clock, log: log.child('transcripts') }),
    new SubagentsEnricher({ clock, log: log.child('subagents') }),
    new ProcInfoEnricher({ source, clock, log: log.child('procinfo') }),
    new BlockedEnricher({ clock, log: log.child('blocked') }),
    new AcksEnricher({ dir: stateDir, clock, log }),
    new NotesEnricher({ dir: stateDir, clock, log }),
  ];
  const terminals = new HerdrTerminals({ client, clock, log: log.child('herdr-term') });
  await source.start(); // first attempt; offline keeps retrying every 2 s
  if (!source.connected) log.warn(`herdr session "${cfg.session}" not reachable yet; retrying`);
  return {
    source, enrichers, terminals, stateDir, client, reaper, isDefault,
    readOnly: () => client.readOnly,
    herdrInfo: () => ({ connected: source.connected, protocol: client.protocol, readOnly: client.readOnly }),
  };
}

/** Stats sampler (BE2, `server/stats/sampler.ts`) if present: emits 'stats', `history()` = the 300-sample ring. */
async function loadStats({ clock, log }: WireCtx): Promise<StatsSampler | null> {
  let mod: typeof import('./stats/sampler.ts');
  try {
    mod = await import('./stats/sampler.ts');
  } catch (e) {
    if (errCode(e) !== 'ERR_MODULE_NOT_FOUND') log.warn(`stats sampler failed to load: ${errMessage(e)}`);
    return null;
  }
  try {
    const s = new mod.StatsSampler({ clock, log });
    s.start();
    return s;
  } catch (e) {
    log.warn(`stats sampler: ${errMessage(e)}`);
    return null;
  }
}
