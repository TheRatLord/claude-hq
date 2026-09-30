/**
 * WorldModel: raw herdr snapshot + enrichers → Entity map; diff → `entity`/`gone`/`event`/
 * `workspaces`/`herdr`. Emits 'msg' (a ServerMsg object) for WsHub to broadcast. Owner: BE.
 *
 *   raw snapshot → base entity (naming.ts, slots.ts, since.ts) → `update(id, base, prev)` on every enricher (synchronous)
 *   → shallow-merge each enricher's latest patch by field ownership → diff → one `entity` per id per 50 ms.
 *
 * - Ownership: patches outside `owns` throw in dev / drop in prod (checkPatch); events must pass `mayEmit(owner, kind,
 *   entity.kind)` (D3: `commit`/`news` split by pane kind) — dev throws, prod drops.
 * - Offline: the model freezes (no `gone`, no events, statuses unchanged) until the source reconnects.
 * - Reconnect grace (15 s): panes missing from the new snapshots are kept; new panes are matched to them by
 *   terminal_id → agent_session → place and RE-KEYED (`gone{reason:'rekeyed', newId}` + `entity`, no arrive/leave).
 *   `arrived`/`left`/`finished`/`blocked`/`unblocked` and enricher events are suppressed while grace runs. When it ends,
 *   still-unmatched old entities get `left` + `gone` in one tick.
 * - First snapshot: no `arrived` for panes that already exist.
 */
import { EventEmitter } from 'node:events';
import {
  FIELD_DEFAULTS, ENTITY_FIELDS, KINDS, LIMITS, S2R, fieldOwnerMap, mayEmit, DEMO_OWNERS, LIVE_OWNERS,
} from '../../shared/protocol.ts';
import type {
  Entity, EnricherField, EventKind, GoneReason, Identity, Kind, OwnerName, ServerMsg, Status, Workspace, WorldMsg,
  HerdrMsg, EventMsg,
} from '../../shared/protocol.ts';
import { assignWorkspaceColors, placeOf, identityKey, IDENTITY_MATCH_ORDER } from '../../shared/identity.ts';
import { assertEnricher, checkPatch } from '../interfaces.ts';
import type {
  Clock, Enricher, EnricherCtx, HerdrSource, Logger, RawPane, RawAgent, RawSnapshot, RawTab, RawWorkspace, TimerHandle,
} from '../interfaces.ts';
import { baseName, seedKeyOf, projectOf, dedupeNames } from './naming.ts';
import { Slots } from './slots.ts';
import { SinceStore } from './since.ts';

export const FINISH_MIN_WORKING_MS = 3000;
export const RECONNECT_GRACE_MS = 15_000;
const GRACE_SUPPRESSED = new Set<EventKind>(['arrived', 'left', 'finished', 'blocked', 'unblocked']);
const quietLog: Logger = { debug() {}, info() {}, warn() {}, error() {} };

/** The base-owned part of an Entity (what WorldModel builds from the raw snapshot; enrichers own the rest). */
export type Base = Omit<Entity, EnricherField>;

/** `stateDir` = ~/.config/claude-hq/<session> (null = memory only). */
export interface WorldModelOptions {
  source: HerdrSource;
  enrichers?: Enricher[];
  clock: Clock;
  log?: Logger;
  session?: string;
  demo?: boolean;
  dev?: boolean;
  stateDir?: string | null;
  graceMs?: number;
}

/** Events a WorldModel emits: `msg` (every ServerMsg for WsHub to broadcast) and `status` (timeline.ts). */
export interface WorldModelEvents {
  msg: [msg: ServerMsg];
  status: [id: string, from: Status, to: Status, identity: Identity];
}

interface PreBase {
  p: RawPane;
  a: RawAgent | undefined;
  w: RawWorkspace;
  t: RawTab;
  id: string;
  kind: Kind;
  cwd: string;
  paneIndex: number;
  name: string;
  order: number[];
}

/** Every ENTITY_FIELDS key is filled in _merge (from its owner or its default), so a complete assembly is an Entity. */
function isAssembledEntity(fields: Partial<Record<keyof Entity, unknown>>): fields is Entity {
  return ENTITY_FIELDS.every((f) => f in fields);
}

export class WorldModel extends EventEmitter<WorldModelEvents> {
  source: HerdrSource;
  clock: Clock;
  log: Logger;
  session: string;
  dev: boolean;
  graceMs: number;
  owners: Map<keyof Entity, OwnerName>;
  enrichers: Enricher[];
  /** merged entities */
  entities: Map<string, Entity>;
  /** base entities */
  bases: Map<string, Base>;
  /** id → enricher name → latest patch */
  patches: Map<string, Map<OwnerName, Partial<Entity>>>;
  /** id → ms the current working stretch began */
  workingSince: Map<string, number>;
  slots: Slots;
  since: SinceStore;
  workspaces: Workspace[];
  focusedPaneId: string | null;
  connected: boolean;
  graceUntil: number;
  _graceTimer: TimerHandle | null;
  /** id → JSON last broadcast */
  _sent: Map<string, string>;
  _wsSent: string;
  _dirty: Set<string>;
  _flushTimer: TimerHandle | null;
  _first: boolean;
  _applying: boolean;
  _rekeyed?: Set<string>;
  counters: { events: number; dropped: number; rekeys: number };
  _onSnapshot: (raw: RawSnapshot) => void;
  _onStatus: () => void;
  _onConnected: (c: boolean, info?: { retryInMs?: number }) => void;
  _onReconnected: () => void;
  _onDemoReset: () => void;

  constructor({ source, enrichers = [], clock, log, session = 'default', demo = false, dev = false, stateDir = null, graceMs = RECONNECT_GRACE_MS }: WorldModelOptions) {
    super();
    this.source = source;
    this.clock = clock;
    this.log = log ?? quietLog;
    this.session = session;
    this.dev = dev;
    this.graceMs = graceMs;
    this.owners = fieldOwnerMap(demo ? DEMO_OWNERS : LIVE_OWNERS); // throws on a double owner
    this.enrichers = enrichers;
    this.entities = new Map();
    this.bases = new Map();
    this.patches = new Map();
    this.workingSince = new Map();
    this.slots = new Slots({ dir: stateDir, clock, log: this.log });
    this.since = new SinceStore({ dir: stateDir, clock, log: this.log });
    this.workspaces = [];
    this.focusedPaneId = null;
    this.connected = !!source.connected;
    this.graceUntil = 0;
    this._graceTimer = null;
    this._sent = new Map();
    this._wsSent = '';
    this._dirty = new Set();
    this._flushTimer = null;
    this._first = true;
    this._applying = false;
    this.counters = { events: 0, dropped: 0, rekeys: 0 };
    for (const e of enrichers) {
      assertEnricher(e);
      e.onPatch = (id, patch) => this._onPatch(e, id, patch);
      e.emitEvent = (id, kind, detail) => this._onEnricherEvent(e, id, kind, detail);
    }
    this._onSnapshot = (raw) => this.apply(raw);
    this._onStatus = () => this.apply(this.source.snapshot());
    this._onConnected = (c, info = {}) => this._setConnected(!!c, info);
    this._onReconnected = () => this._startGrace();
    this._onDemoReset = () => {
      if (!demo) return;
      this.clock.clearTimeout(this._graceTimer);
      this._graceTimer = null;
      this.graceUntil = 0;
      // A scenario reset is not a reconnect: reused pane IDs must detach enrichers and terminals.
      this._apply({ workspaces: [], tabs: [], panes: [], agents: [], layouts: [] });
      for (const key of Object.keys(this.since.map)) delete this.since.map[key];
    };
    source.on('snapshot', this._onSnapshot);
    source.on('status', this._onStatus);
    source.on('connected', this._onConnected);
    source.on('reconnected', this._onReconnected);
    source.on('demo-reset', this._onDemoReset);
    const raw = source.snapshot();
    if (raw) this.apply(raw);
  }

  worldMsg(): WorldMsg {
    return { t: S2R.WORLD, entities: [...this.entities.values()], workspaces: this.workspaces, focusedPaneId: this.focusedPaneId };
  }
  has(id: string): boolean {
    return this.entities.has(id);
  }
  get(id: string): Entity | null {
    return this.entities.get(id) ?? null;
  }
  base(id: string): Base | null {
    return this.bases.get(id) ?? null;
  }
  get inGrace(): boolean {
    return this.graceUntil > this.clock.now();
  }

  // ------------------------------------------------------------------ connection / grace

  _setConnected(c: boolean, info: { retryInMs?: number }): void {
    if (this.connected === c && !info.retryInMs) return;
    this.connected = c;
    const msg: HerdrMsg = { t: S2R.HERDR, connected: c };
    if (!c && info.retryInMs) msg.retryInMs = info.retryInMs;
    if (c && this.inGrace) msg.reconnecting = true;
    this.emit('msg', msg);
  }

  _startGrace(): void {
    this.graceUntil = this.clock.now() + this.graceMs;
    this.clock.clearTimeout(this._graceTimer);
    this._graceTimer = this.clock.setTimeout(() => this._endGrace(), this.graceMs);
    this.emit('msg', { t: S2R.HERDR, connected: false, reconnecting: true });
  }

  _endGrace(): void {
    this._graceTimer = null;
    this.graceUntil = 0;
    const raw = this.source.snapshot();
    const present = new Set((raw?.panes ?? []).map((p) => p.pane_id));
    for (const id of [...this.bases.keys()]) if (!present.has(id)) this._gone(id, 'closed');
    if (this.connected) this.emit('msg', { t: S2R.HERDR, connected: true });
    this._scheduleFlush();
  }

  // ------------------------------------------------------------------ apply

  /** Apply a raw herdr snapshot. */
  apply(raw: RawSnapshot | null): void {
    if (!raw || this._applying) return;
    if (!this.connected && this.source.connected === false && !this._first && !this.inGrace) return; // offline freeze
    this._applying = true;
    try {
      this._apply(raw);
    } finally {
      this._applying = false;
    }
  }

  _apply(raw: RawSnapshot): void {
    const grace = this.inGrace;
    const { bases, workspaces } = this._buildBases(raw);
    // re-key during grace: new pane ids matched to vanished ones (terminalId → agentSession → place)
    if (grace) {
      const orphans = [...this.bases.keys()].filter((id) => !bases.has(id));
      const fresh = [...bases.keys()].filter((id) => !this.bases.has(id));
      if (orphans.length && fresh.length) {
        for (const key of IDENTITY_MATCH_ORDER) {
          for (const nid of fresh) {
            const nb = bases.get(nid);
            if (this.bases.has(nid) || !nb) continue;
            const want = nb.identity[key];
            if (!want) continue;
            const hits = orphans.filter((oid) => this.bases.has(oid) && !bases.has(oid) && this.bases.get(oid)?.identity[key] === want);
            if (hits.length === 1) this._rekey(hits[0], nid, nb);
          }
        }
      }
    }
    for (const id of [...this.bases.keys()]) {
      if (bases.has(id)) continue;
      if (grace) continue; // kept until the grace window ends
      this._gone(id, 'closed');
    }
    for (const [id, base] of bases) {
      const prev = this.bases.get(id) ?? null;
      this.bases.set(id, base);
      if (!prev) {
        const ctx = this._ctx(id);
        for (const e of this.enrichers) e.attach(id, base, ctx);
        this._merge(id);
        if (!this._first && !grace) this._event(id, 'arrived');
      } else if (JSON.stringify(prev) !== JSON.stringify(base)) {
        if (prev.kind !== base.kind) {
          for (const e of this.enrichers) {
            e.detach(id);
            e.attach(id, base, this._ctx(id));
          }
        } else for (const e of this.enrichers) e.update(id, base, prev);
        this._merge(id);
        this._statusEvents(id, prev, base);
      }
    }
    this.focusedPaneId = raw.focused_pane_id ?? null;
    this.workspaces = workspaces;
    const wsJson = JSON.stringify([workspaces, this.focusedPaneId]);
    if (wsJson !== this._wsSent && !this._first) this.emit('msg', { t: S2R.WORKSPACES, workspaces, focusedPaneId: this.focusedPaneId });
    this._wsSent = wsJson;
    if (this._first) {
      // Initial world goes out with each client's `world`; nothing to diff against.
      for (const [id, e] of this.entities) this._sent.set(id, JSON.stringify(e));
      this._dirty.clear();
    }
    this._first = false;
    this._scheduleFlush();
  }

  _ctx(id: string): EnricherCtx {
    return {
      source: this.source, clock: this.clock, log: this.log, session: this.session,
      // accepts sinceHint(ms) or sinceHint(id, ms)
      sinceHint: (a: number | string, b?: number) => this._sinceHint(id, b === undefined ? a : b),
    };
  }

  _rekey(oldId: string, newId: string, newBase: Base): void {
    const oldBase = this.bases.get(oldId);
    if (!oldBase) return; // callers pass an id taken from this.bases
    const oldKey = identityKey(oldBase.identity), newKey = identityKey(newBase.identity);
    this.since.rekey(oldKey, newKey);
    const s = this.since.observe(newKey, { status: newBase.status, stateSeq: newBase.stateSeq });
    newBase.statusSince = s.since;
    newBase.statusSinceApprox = s.approx;
    const ws = this.workingSince.get(oldId);
    for (const e of this.enrichers) e.detach(oldId);
    this.bases.delete(oldId);
    this.entities.delete(oldId);
    this.patches.delete(oldId);
    this.workingSince.delete(oldId);
    this._dirty.delete(oldId);
    this._sent.delete(oldId);
    if (ws !== undefined) this.workingSince.set(newId, ws);
    this.counters.rekeys++;
    this.log.info(`re-keyed ${oldId} → ${newId}`);
    this.emit('msg', { t: S2R.GONE, id: oldId, reason: 'rekeyed', newId });
    // The new base is attached by the caller loop (prev = null) without `arrived` (grace); flush it right away so the
    // renderer sees the new id immediately after the rekey.
    this._rekeyed = this._rekeyed ?? new Set();
    this._rekeyed.add(newId);
  }

  _gone(id: string, reason: GoneReason): void {
    this._event(id, 'left'); // suppressed while grace runs
    for (const e of this.enrichers) e.detach(id);
    this.bases.delete(id);
    this.entities.delete(id);
    this.patches.delete(id);
    this.workingSince.delete(id);
    this._dirty.delete(id);
    this._sent.delete(id);
    this.emit('msg', { t: S2R.GONE, id, reason });
  }

  _buildBases(raw: RawSnapshot): { bases: Map<string, Base>; workspaces: Workspace[] } {
    const now = this.clock.now();
    const wsById = new Map((raw.workspaces ?? []).map((w) => [w.workspace_id, w]));
    const tabsById = new Map((raw.tabs ?? []).map((t) => [t.tab_id, t]));
    const agentsById = new Map((raw.agents ?? []).map((a) => [a.pane_id, a]));
    const colors = assignWorkspaceColors((raw.workspaces ?? []).map((w) => ({ id: w.workspace_id, label: w.label ?? '', number: w.number ?? 0 })));
    const sortedWs = [...(raw.workspaces ?? [])].sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
    const slotOf = this.slots.assign(sortedWs);
    const rectOf = new Map<string, { cols: number; rows: number }>();
    const orderOf = new Map<string, number>();
    for (const l of raw.layouts ?? []) {
      const ps = [...(l.panes ?? [])].sort((a, b) => (a.rect?.y ?? 0) - (b.rect?.y ?? 0) || (a.rect?.x ?? 0) - (b.rect?.x ?? 0));
      ps.forEach((p, i) => {
        orderOf.set(p.pane_id, i);
        if (p.rect) rectOf.set(p.pane_id, { cols: p.rect.width, rows: p.rect.height });
      });
    }
    const tabIndex = new Map<string, number>();
    for (const w of sortedWs) {
      const ts = (raw.tabs ?? []).filter((t) => t.workspace_id === w.workspace_id).sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
      ts.forEach((t, i) => tabIndex.set(t.tab_id, i));
    }
    const wsEntity = (w: RawWorkspace) => ({ id: w.workspace_id, label: w.label ?? '', number: w.number ?? 0,
      colorIndex: colors.get(w.workspace_id)?.colorIndex ?? 0, cycle: colors.get(w.workspace_id)?.cycle ?? 0,
      slot: slotOf.get(w.workspace_id) ?? 0, status: w.agent_status ?? 'unknown' });

    const pre: PreBase[] = [];
    for (const p of raw.panes ?? []) {
      const id = p.pane_id;
      const a = agentsById.get(id);
      const w = wsById.get(p.workspace_id) ?? { workspace_id: p.workspace_id, label: p.workspace_id, number: 0 };
      const t = tabsById.get(p.tab_id) ?? { tab_id: p.tab_id, workspace_id: p.workspace_id, label: '', number: 0 };
      const agent = p.agent ?? null;
      const known = KINDS.find((k) => k === agent);
      const kind: Kind = !agent ? 'shell' : known && known !== 'shell' ? known : 'agent';
      const cwd = p.foreground_cwd ?? p.cwd ?? '';
      const paneIndex = orderOf.get(id) ?? 0;
      pre.push({ p, a, w, t, id, kind, cwd, paneIndex, name: baseName({ agentName: a?.name, tabLabel: t.label, cwd }),
        order: [w.number ?? 0, tabIndex.get(t.tab_id) ?? 0, paneIndex] });
    }
    const names = dedupeNames(pre.map((x) => ({ id: x.id, ws: x.w.workspace_id, name: x.name, order: x.order })));
    const bases = new Map<string, Base>();
    for (const { p, a, w, t, id, kind, cwd, paneIndex } of pre) {
      const status = p.agent_status ?? a?.agent_status ?? 'unknown';
      const stateSeq = kind === 'shell' ? null : (a?.state_change_seq ?? null);
      const identity = { terminalId: p.terminal_id ?? null, agentSession: p.agent_session?.value ?? a?.agent_session?.value ?? null,
        // String(): an unlabelled workspace/tab has always produced 'undefined' in the place (persisted keys depend on it)
        place: placeOf(String(w.label), String(t.label), paneIndex, cwd) };
      const s = this.since.observe(identityKey(identity), { status, stateSeq });
      // working stretch start (for `finished` ≥ 3 s of working)
      const prevStatus = this.bases.get(id)?.status;
      if (status === 'working' && prevStatus !== 'working') this.workingSince.set(id, prevStatus === undefined ? s.since : now);
      bases.set(id, {
        id,
        terminalId: p.terminal_id ?? null,
        kind,
        name: names.get(id) ?? '', // dedupeNames covers every pre entry
        seedKey: seedKeyOf(a?.name, id),
        status,
        statusSince: s.since,
        statusSinceApprox: s.approx,
        identity,
        stateSeq,
        layoutRect: rectOf.get(id) ?? null,
        workspace: wsEntity(w),
        tab: { id: t.tab_id, label: t.label ?? '', number: t.number ?? 0, index: tabIndex.get(t.tab_id) ?? 0 },
        paneIndex,
        cwd,
        project: projectOf({ repoName: w.worktree?.repo_name, foregroundCwd: p.foreground_cwd, cwd: p.cwd }),
        repo: w.worktree?.repo_name ?? null,
        focused: !!p.focused && raw.focused_pane_id === id,
        baseTitle: p.terminal_title_stripped || null, // D2: herdr title, base-owned; display only via taskLabel()
      });
    }
    const workspaces = sortedWs.map((w) => {
      const tabs = (raw.tabs ?? []).filter((t) => t.workspace_id === w.workspace_id).sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
        .map((t) => ({ id: t.tab_id, label: t.label ?? '', number: t.number ?? 0, status: t.agent_status ?? 'unknown' }));
      return { ...wsEntity(w), focused: !!w.focused, paneCount: (raw.panes ?? []).filter((p) => p.workspace_id === w.workspace_id).length, tabs };
    });
    return { bases, workspaces };
  }

  _sinceHint(id: string, ms: number | string): void {
    const b = this.bases.get(id);
    if (!b) return;
    const since = this.since.hint(identityKey(b.identity), ms);
    if (since == null) return;
    b.statusSince = since;
    this._merge(id);
    this._scheduleFlush();
  }

  _statusEvents(id: string, prev: Base, base: Base): void {
    if (prev.status === base.status) return;
    this.emit('status', id, prev.status, base.status, base.identity); // timeline.ts: every transition
    if (base.status === 'blocked') this._event(id, 'blocked');
    if (prev.status === 'blocked') this._event(id, 'unblocked');
    if (prev.status === 'working' && (base.status === 'done' || base.status === 'idle')) {
      const ws = this.workingSince.get(id) ?? prev.statusSince;
      if (this.clock.now() - ws >= FINISH_MIN_WORKING_MS) this._event(id, 'finished');
    }
    if (base.status !== 'working') this.workingSince.delete(id);
  }

  _onPatch(e: Enricher, id: string, patch: Partial<Entity>): void {
    if (!this.bases.has(id)) return;
    const clean = checkPatch(e, patch, { dev: this.dev });
    let m = this.patches.get(id);
    if (!m) this.patches.set(id, (m = new Map()));
    m.set(e.name, { ...(m.get(e.name) ?? {}), ...clean });
    // Patches during attach/update are merged by apply(); async patches merge + flush here.
    if (this._applying) return;
    this._merge(id);
    this._scheduleFlush();
  }

  _onEnricherEvent(e: Enricher, id: string, kind: EventKind, detail?: unknown): void {
    const ent = this.entities.get(id) ?? this.bases.get(id);
    if (!ent) return;
    if (!mayEmit(e.name, kind, ent.kind)) {
      this.counters.dropped++;
      if (this.dev) throw new Error(`enricher ${e.name} may not emit ${kind} for a ${ent.kind} pane (mayEmit, D3)`);
      return;
    }
    if (this.inGrace || !this.connected && this.source.connected === false) return;
    if (this._applying) this._merge(id);
    this._event(id, kind, detail);
  }

  /** Emit an event now (actions' demo.event uses this). */
  event(id: string, kind: EventKind, detail?: unknown): void {
    this._event(id, kind, detail);
  }

  _event(id: string, kind: EventKind, detail?: unknown): void {
    if (this.inGrace && GRACE_SUPPRESSED.has(kind)) return;
    if (this._dirty.has(id)) this._flushOne(id); // renderer sees the state before the moment
    const msg: EventMsg = { t: S2R.EVENT, id, kind };
    if (detail !== undefined) msg.detail = detail;
    this.counters.events++;
    this.emit('msg', msg);
  }

  _merge(id: string): void {
    const base = this.bases.get(id);
    if (!base) return;
    const baseFields: Readonly<Partial<Record<keyof Entity, unknown>>> = base;
    const defaults: Readonly<Partial<Record<keyof Entity, unknown>>> = FIELD_DEFAULTS;
    const fields: Partial<Record<keyof Entity, unknown>> = {};
    const m = this.patches.get(id);
    for (const f of ENTITY_FIELDS) {
      const owner = this.owners.get(f);
      if (owner === 'base') fields[f] = baseFields[f];
      else {
        const p = owner ? m?.get(owner) : undefined;
        fields[f] = p && f in p ? p[f] : structuredClone(defaults[f] ?? null);
      }
    }
    if (!isAssembledEntity(fields)) throw new Error(`entity ${id}: field assembly incomplete`);
    const out = fields;
    // shells: a process.activity change is a status change for time purposes
    if (base.kind === 'shell' && out.process?.activity && this.since.activity(identityKey(base.identity), out.process.activity)) {
      base.statusSince = out.statusSince = this.clock.now();
      base.statusSinceApprox = out.statusSinceApprox = false;
    }
    const prev = this.entities.get(id);
    const prevTool = prev?.activity?.tool ?? null;
    this.entities.set(id, out);
    this._dirty.add(id);
    if (this._rekeyed?.delete(id)) this._flushOne(id);
    const tool = out.activity?.tool ?? null;
    if (prev && tool && tool !== prevTool && !this.inGrace) this._event(id, 'tool', { tool, cls: out.activity?.cls ?? null });
  }

  _scheduleFlush(): void {
    if (this._flushTimer || !this._dirty.size) return;
    this._flushTimer = this.clock.setTimeout(() => {
      this._flushTimer = null;
      this.flush();
    }, LIMITS.entityCoalesceMs);
  }

  /** Send `entity` for every changed entity (diffed against the last broadcast). */
  flush(): void {
    for (const id of [...this._dirty]) this._flushOne(id);
  }

  _flushOne(id: string): void {
    this._dirty.delete(id);
    const e = this.entities.get(id);
    if (!e || this._first) return;
    const j = JSON.stringify(e);
    if (this._sent.get(id) === j) return;
    this._sent.set(id, j);
    this.emit('msg', { t: S2R.ENTITY, entity: e });
  }

  metrics(): { entities: number; inGrace: boolean; connected: boolean; events: number; dropped: number; rekeys: number } {
    return { entities: this.entities.size, inGrace: this.inGrace, connected: this.connected, ...this.counters };
  }

  close(): void {
    this.clock.clearTimeout(this._flushTimer);
    this.clock.clearTimeout(this._graceTimer);
    this.source.off('snapshot', this._onSnapshot);
    this.source.off('status', this._onStatus);
    this.source.off('connected', this._onConnected);
    this.source.off('reconnected', this._onReconnected);
    this.source.off('demo-reset', this._onDemoReset);
    for (const e of this.enrichers) e.close?.();
    this.slots.close();
    this.since.close();
  }
}
