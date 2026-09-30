/**
 * Actions & safety gate (DESIGN §4.8): gate by ACTION_CLASS, then `source.request(...)`. Never knows live vs demo.
 * Handles every non-`term.*` renderer→server message after ws.ts validated it and checked the entity id.
 *
 *   always      screen.watch settings.set world.get done.ack agent.explain timeline.get note.set   (HQ-local / read-only)
 *   explicit    herdr.focus (button only)
 *   interact    agent.prompt agent.answer agent.keys
 *   structural  spawn pane.close — demo or a named, non-default herdr session only; NEVER the default session (there is no
 *               flag or setting that enables it there; a named session resolving to the default socket counts as default)
 * herdr/client.ts enforces its own method allowlist independently (§4.1): a bug in either alone cannot mutate the
 * default session. Read-only herdr protocol → every class but `always` is refused with `readonly_protocol`.
 * Owner: BE. `timeline.get` is served by timeline.ts (M2); `note.set` by notes.ts (M3).
 */
import { ACTION_CLASS, ERR, S2R, DEFAULT_SETTINGS } from '../../shared/protocol.ts';
import type { ActionClass, ClientMsg, ClientMsgOf, ClientMsgType, EventKind, Prompt, ServerMsg, Settings } from '../../shared/protocol.ts';
import { errCode, isRecord } from '../../shared/guards.ts';
import type { Clock, HerdrSource } from '../interfaces.ts';
import { readPrompt, answerKeys } from './blocked.ts';
import type { BlockedEnricher } from './blocked.ts';
import type { AcksEnricher } from './acks.ts';
import type { NotesEnricher } from './notes.ts';
import type { Base, WorldModel } from './model.ts';
import type { Screens } from './screens.ts';
import type { Timeline } from './timeline.ts';

/** A connected renderer as far as actions are concerned (WsHub's client object). */
export interface ActionClient {
  sendJson(msg: ServerMsg): void;
  /** the pane ids this client watches for `screen` messages */
  watch: string[];
  cid?: string | null;
}

/** What the demo source adds to the herdr socket surface. */
export interface DemoControls {
  force(id: string, patch: Record<string, unknown>): void;
  scenario: NonNullable<HerdrSource['scenario']>;
}
/** The herdr-shaped source; `force`/`scenario` exist on the demo source only. */
export type ActionSource = Pick<HerdrSource, 'request'> & Partial<DemoControls>;

/** DemoEnricher's `fire` (demo.event). */
export interface EventFirer { fire(id: string, kind: EventKind): boolean }

export interface ActionsOptions {
  source: ActionSource;
  model: ActionModel;
  clock: Clock;
  session: string;
  /** the realpath-based default-session verdict (app.ts wireLive → resolve.ts isDefaultTarget); defaults to the name check for demo/replay/tests, which never talk to a real herdr socket */
  isDefault?: boolean;
  demo: boolean;
  settings: Settings;
  demoEnricher?: EventFirer | null;
  acks?: Pick<AcksEnricher, 'ack'> | null;
  blocked?: Pick<BlockedEnricher, 'refresh'> | null;
  screens?: Pick<Screens, 'setWatch'> | null;
  timeline?: Pick<Timeline, 'msg'> | null;
  saveSettings?: (s: Settings) => void;
  /** spawn's first prompt is audited here (ws.ts audits the spawn itself) */
  audit?: ActionAudit | null;
  notes?: Pick<NotesEnricher, 'set'> | null;
  readOnly?: () => boolean;
}

/** The part of the WorldModel actions use. */
export type ActionModel = Pick<WorldModel, 'get' | 'base' | 'worldMsg' | 'event' | 'workspaces'>;

/** The part of AuditLog actions use. */
export interface ActionAudit {
  record(e: { cid: string | null; action: string; paneId: string | null; ok: boolean; error?: string | null }): unknown;
}

/** Extra reply fields (`reply {ok:true, ...extra}`). */
export type ActionResult = Record<string, unknown>;

/** herdr's `agent.explain` boiled down for the "Why?" expander. */
export interface ExplainWhy { state: string | null; rule: string | null; region: string | null; evidence: string | null }

/** After sending an answer, re-check every ANSWER_POLL_MS for up to ANSWER_RECHECK_MS (a menu answer that ends the
 * agent can take ~0.3-1 s to show: herdr keeps reporting blocked at the same stateSeq and the screen keeps the prompt). */
export const ANSWER_RECHECK_MS = 2000;
export const ANSWER_POLL_MS = 200;
/** spawn with a first prompt: wait at most this long for the new agent to become interactive-ready (M3.5). */
export const SPAWN_READY_MS = 20_000;
export const SPAWN_POLL_MS = 400;
/** …and at most this long for a new tab's shell to accept `agent.start`. */
export const SPAWN_SHELL_MS = 8000;

/**
 * One-glance summary of herdr's `agent.explain` (the full object can be tens of KB of rule evidence):
 * `{state, rule, region, evidence}` from `matched_rule` + that rule's evaluated evidence preview (≤ 300 chars).
 * `x` is herdr's explain object (unknown: narrowed here).
 */
export function explainWhy(x: unknown): ExplainWhy | null {
  if (!isRecord(x)) return null;
  const m = isRecord(x.matched_rule) ? x.matched_rule : null;
  const rules: unknown[] = Array.isArray(x.evaluated_rules) ? x.evaluated_rules : [];
  const found = rules.find((r) => isRecord(r) && (r.matched || (m && r.id === m.id)));
  const ev = isRecord(found) ? found : null;
  const prev = isRecord(ev?.evidence) ? ev.evidence.region_preview : undefined;
  const str = (...vs: unknown[]): string | null => vs.find((v): v is string => typeof v === 'string') ?? null;
  return { state: str(x.state, m?.state), rule: str(m?.id, ev?.id), region: str(m?.region, ev?.region),
    evidence: typeof prev === 'string' && prev ? prev.slice(0, 300) : null };
}
const actionError = (code: string, why?: string, extra?: Record<string, unknown>): Error & { code: string; extra?: Record<string, unknown> } =>
  Object.assign(new Error(why ?? code), { code }, extra ? { extra } : {});

export class Actions {
  source: ActionSource;
  model: ActionModel;
  clock: Clock;
  session: string;
  isDefault: boolean;
  demo: boolean;
  settings: Settings;
  demoEnricher: EventFirer | null;
  acks: Pick<AcksEnricher, 'ack'> | null;
  blocked: Pick<BlockedEnricher, 'refresh'> | null;
  screens: Pick<Screens, 'setWatch'> | null;
  timeline: Pick<Timeline, 'msg'> | null;
  saveSettings: (s: Settings) => void;
  audit: ActionAudit | null;
  notes: Pick<NotesEnricher, 'set'> | null;
  readOnly: () => boolean;
  /** paneId → the answer in flight (send + acceptance poll) */
  answering: Map<string, Promise<ActionResult>>;

  constructor(o: ActionsOptions) {
    this.source = o.source;
    this.model = o.model;
    this.clock = o.clock;
    this.session = o.session;
    this.isDefault = o.isDefault ?? (!o.session || o.session === 'default');
    this.demo = !!o.demo;
    this.settings = o.settings;
    this.demoEnricher = o.demoEnricher ?? null;
    this.acks = o.acks ?? null;
    this.blocked = o.blocked ?? null;
    this.screens = o.screens ?? null;
    this.timeline = o.timeline ?? null;
    this.saveSettings = o.saveSettings ?? (() => {});
    this.audit = o.audit ?? null;
    this.notes = o.notes ?? null;
    this.readOnly = o.readOnly ?? (() => false);
    this.answering = new Map();
  }

  /**
   * Structural gate: demo, or a named session that does not resolve to the default socket. Nothing opens it in the
   * default session: the `allowMutations` *setting* is never honoured (`settings.set` refuses it there) and there is
   * no CLI flag, so one renderer message can never open both gates (§4.8 "two gates, not one").
   */
  get mutationsAllowed(): boolean {
    return this.demo || !this.isDefault;
  }

  /** Gate (§4.8). Throws `{code}` when refused. */
  gate(t: ClientMsgType): ActionClass {
    const cls = ACTION_CLASS[t];
    if (cls === 'demo' && !this.demo) throw actionError(ERR.NOT_DEMO, `${t} is demo only`);
    if (cls !== 'always' && cls !== 'demo' && this.readOnly()) throw actionError(ERR.READONLY_PROTOCOL, `${t}: herdr is read-only (protocol mismatch)`);
    if (cls === 'structural' && !this.mutationsAllowed) throw actionError(ERR.MUTATIONS_DISABLED, `${t === 'spawn' ? 'hiring' : 'closing panes'} is off in your default herdr session (HQ never changes its layout); run HQ with --session <name> for full actions`);
    return cls;
  }

  /** Handle a validated message; resolves to the extra reply fields. */
  async handle(client: ActionClient, msg: ClientMsg): Promise<ActionResult> {
    this.gate(msg.t);
    const req = (method: string, params: Record<string, unknown>): Promise<unknown> => this.source.request(method, params);
    switch (msg.t) {
      case 'world.get':
        client.sendJson(this.model.worldMsg());
        return {};
      case 'settings.set': {
        const defaults: Readonly<Record<string, unknown>> = DEFAULT_SETTINGS;
        for (const [k, v] of Object.entries(msg.patch)) {
          const def = defaults[k];
          if (typeof v !== typeof def) throw actionError(ERR.BAD_MESSAGE, `settings.${k}: expected ${typeof def}`);
        }
        if (msg.patch.allowMutations === true && !this.demo && this.isDefault) {
          throw actionError(ERR.MUTATIONS_DISABLED, 'allowMutations cannot be enabled from the UI in the default session');
        }
        Object.assign(this.settings, msg.patch);
        this.saveSettings(this.settings);
        return { settings: { ...this.settings } };
      }
      case 'screen.watch':
        client.watch = [...msg.ids];
        this.screens?.setWatch(client, msg.ids, msg.ansi === true);
        return {};
      case 'timeline.get':
        client.sendJson(this.timeline ? this.timeline.msg(msg.since) : { t: S2R.TIMELINE, since: msg.since, items: [] });
        return {};
      case 'done.ack':
        if (!this.acks) throw actionError(ERR.NOT_ACCEPTED, 'acks not wired');
        return this.acks.ack(msg.id, msg.stateSeq);
      case 'note.set':
        if (!this.notes) throw actionError(ERR.NOT_ACCEPTED, 'notes not wired');
        return this.notes.set(msg.id, msg.text);
      case 'herdr.focus':
        await req('pane.focus', { pane_id: msg.id });
        return {};
      case 'agent.prompt':
        await req('agent.prompt', { target: msg.id, text: msg.text });
        return {};
      case 'agent.keys':
        await req('pane.send_keys', { pane_id: msg.id, keys: msg.keys });
        return {};
      case 'agent.explain': {
        // passthrough (read-only, §3.4) + a compact `why` line for the status card's "Why?" expander
        const r = await req('agent.explain', { target: msg.id });
        const explain = isRecord(r) ? r.explain ?? r : r;
        return { explain, why: explainWhy(explain) };
      }
      case 'agent.answer':
        return this._answer(msg);
      case 'spawn':
        return this._spawn(msg, client);
      case 'pane.close':
        await req('pane.close', { pane_id: msg.id });
        return {};
      case 'demo.force':
        if (!this.source.force) throw actionError(ERR.NOT_DEMO, 'demo.force: this source cannot force states');
        this.source.force(msg.id, msg.patch);
        return {};
      case 'demo.scenario':
        if (!this.source.scenario) throw actionError(ERR.NOT_DEMO, 'demo.scenario: this source cannot reset scenarios');
        return { demoConfig: await this.source.scenario(msg.name, msg.seed) };
      case 'demo.event':
        if (!this.demoEnricher?.fire(msg.id, msg.kind)) this.model.event(msg.id, msg.kind); // demo convenience
        return {};
      default:
        throw actionError(ERR.BAD_MESSAGE, `no handler for ${msg.t}`);
    }
  }

  /**
   * §4.8 answer algorithm: re-read the prompt NOW and re-hash; anything different → prompt_changed (nothing sent).
   * Then the digit (numbered) or Up/Down × distance + Enter from the CURRENT cursor. Then poll (every ANSWER_POLL_MS,
   * up to ANSWER_RECHECK_MS) until the answer visibly took: status/stateSeq/kind changed, pane gone, or the prompt
   * text/cursor changed. Only the identical prompt with an unmoved cursor at the deadline → not_accepted.
   * One answer per pane at a time: while one is in flight (read → send → poll), a second (another window, a retry after
   * a timeout) is refused with prompt_changed BEFORE reading the screen — during the 0.3-1 s acceptance lag the old
   * prompt still hashes the same, and a second digit+Enter would land in whatever replaced it (e.g. a shell).
   */
  _answer(msg: ClientMsgOf<'agent.answer'>): Promise<ActionResult> {
    const { id } = msg;
    if (this.answering.has(id)) {
      return Promise.reject(actionError(ERR.PROMPT_CHANGED, 'an answer for this pane is already in flight',
        { prompt: this.model.get(id)?.prompt ?? null, busy: true }));
    }
    const p = this._answerOnce(msg).finally(() => this.answering.delete(id));
    this.answering.set(id, p);
    return p;
  }

  async _answerOnce({ id, key, promptHash }: ClientMsgOf<'agent.answer'>): Promise<ActionResult> {
    const e = this.model.get(id);
    const base = this.model.base(id);
    if (!e || !base || base.status !== 'blocked') {
      throw actionError(ERR.PROMPT_CHANGED, 'not blocked', { prompt: e?.prompt ?? null });
    }
    const cur = await readPrompt(this.source, id, base.stateSeq);
    const keys = cur && cur.hash === promptHash ? answerKeys(cur, key) : null;
    if (!cur || cur.hash !== promptHash || !keys) {
      throw actionError(ERR.PROMPT_CHANGED, 'prompt changed', { prompt: cur ?? e.prompt ?? null });
    }
    await this.source.request('pane.send_keys', { pane_id: id, keys });
    try {
      const stuck = await this._answerStuck(id, base, cur);
      if (stuck) throw actionError(ERR.NOT_ACCEPTED, 'the prompt is still there', { prompt: stuck });
    } finally {
      this.blocked?.refresh(id);
    }
    return { keys };
  }

  /** Poll after an answer. Resolves to the unchanged prompt if it never moved, else null (= taken). */
  async _answerStuck(id: string, base: Base, sent: Prompt): Promise<Prompt | null> {
    const deadline = this.clock.now() + ANSWER_RECHECK_MS;
    let last: Prompt = sent;
    while (this.clock.now() < deadline) {
      await new Promise<void>((r) => this.clock.setTimeout(r, ANSWER_POLL_MS));
      const nb = this.model.base(id);
      if (!nb || nb.kind !== base.kind || nb.status !== 'blocked' || nb.stateSeq !== base.stateSeq) return null;
      let p: Prompt | null;
      try {
        p = await readPrompt(this.source, id, base.stateSeq);
      } catch {
        return null; // pane gone (or unreadable because it is being torn down)
      }
      if (!p || p.hash !== sent.hash || p.selected !== sent.selected) return null;
      last = p;
    }
    return last;
  }

  /**
   * `spawn {workspaceId?, cwd?, kind?, label?, name?, prompt?}` → `{paneId, prompted}`.
   * - No kind = a shell: a new tab in `workspaceId` (or a new workspace) → its root pane id, so the renderer's shell
   *   character appears at once.
   * - kind claude/codex: `agent.start` in that pane; herdr's socket call returns at once (`launch_pending`). With a first
   *   `prompt` (M3.5): poll `agent.get` (≤ SPAWN_READY_MS, every SPAWN_POLL_MS) until the agent is interactive-ready and
   *   idle, then `agent.prompt` exactly once → `prompted:true`. A startup dialog (folder trust → blocked), a timeout or a
   *   vanished pane → `prompted:false` + `why` (the agent stays up; the user answers the dialog like any block).
   *   The prompt text is never logged or audited (only `{action:'prompt', paneId, ok}`).
   */
  async _spawn({ workspaceId, cwd, kind, label, name, prompt }: ClientMsgOf<'spawn'>, client: ActionClient | null = null): Promise<ActionResult> {
    const req = (method: string, params: Record<string, unknown>): Promise<unknown> => this.source.request(method, params);
    const rootPane = (r: unknown): string | undefined => (isRecord(r) && isRecord(r.root_pane) && typeof r.root_pane.pane_id === 'string' ? r.root_pane.pane_id : undefined);
    if (prompt && !kind) throw actionError(ERR.BAD_MESSAGE, 'spawn.prompt needs kind claude or codex');
    let paneId: string | undefined;
    if (workspaceId) {
      const wss = this.model.workspaces;
      if (Array.isArray(wss) && !wss.some((w) => w.id === workspaceId)) {
        throw actionError(ERR.UNKNOWN_ENTITY, `unknown workspace ${workspaceId}`);
      }
      const r = await req('tab.create', { workspace_id: workspaceId, focus: false, ...(label || name ? { label: label ?? name } : {}), ...(cwd ? { cwd } : {}) });
      paneId = rootPane(r);
    } else {
      const r = await req('workspace.create', { focus: false, label: label ?? name ?? (kind ? 'agents' : 'shell'), ...(cwd ? { cwd } : {}) });
      paneId = rootPane(r);
    }
    if (!paneId) throw actionError(ERR.INTERNAL, 'spawn: herdr returned no pane');
    if (!kind) return { paneId, prompted: false };
    // a brand-new tab's shell needs a moment before herdr accepts agent.start (`agent_pane_busy: not an available
    // shell`): retry until SPAWN_SHELL_MS; on failure close the pane we just made so no stray tab is left behind
    const startParams = { name: name ?? label ?? `${kind}-${paneId.split(':').pop()}`, kind, pane_id: paneId };
    const shellDeadline = this.clock.now() + SPAWN_SHELL_MS;
    let started: unknown;
    for (;;) {
      try {
        started = await req('agent.start', startParams);
        break;
      } catch (e) {
        if (errCode(e) === 'agent_pane_busy' && this.clock.now() < shellDeadline) {
          await new Promise<void>((r) => this.clock.setTimeout(r, SPAWN_POLL_MS));
          continue;
        }
        await req('pane.close', { pane_id: paneId }).catch(() => {});
        throw e;
      }
    }
    paneId = (isRecord(started) && isRecord(started.agent) && typeof started.agent.pane_id === 'string' ? started.agent.pane_id : undefined) ?? paneId; // the demo re-keys the pane on agent.start; herdr keeps it
    if (!prompt) return { paneId, prompted: false };
    const ready = await this._waitReady(paneId, kind);
    let prompted = false;
    let why = ready.why;
    if (ready.ok) {
      try {
        await req('agent.prompt', { target: paneId, text: prompt });
        prompted = true;
        why = undefined;
      } catch (e) {
        why = errCode(e) ?? 'prompt_failed';
      }
    }
    this.audit?.record({ cid: client?.cid ?? null, action: 'prompt', paneId, ok: prompted, error: why });
    return { paneId, prompted, ...(why ? { why } : {}) };
  }

  /**
   * Wait until a freshly started agent can take a prompt. Live: `agent.get {target}` → `interactive_ready` + idle/done.
   * Sources without `agent.get` (the demo) → the WorldModel's base (kind + idle). Blocked (a startup dialog) for two
   * polls in a row → give up early: prompting it would be rejected (`agent_blocked`).
   */
  async _waitReady(paneId: string, kind: string): Promise<{ ok: boolean; why?: string }> {
    const deadline = this.clock.now() + SPAWN_READY_MS;
    let viaModel = false;
    let blockedPolls = 0;
    for (;;) {
      let st: { status: unknown; ready: boolean } | null = null;
      if (!viaModel) {
        try {
          const r = await this.source.request('agent.get', { target: paneId });
          const a = isRecord(r) && isRecord(r.agent) ? r.agent : null;
          st = a ? { status: a.agent_status, ready: a.interactive_ready === true && !a.launch_pending } : null;
        } catch (e) {
          const code = errCode(e);
          if (code === 'not_implemented' || code === 'invalid_request') viaModel = true;
          else if (code !== 'agent_not_found') return { ok: false, why: code ?? 'agent_gone' };
        }
      }
      if (viaModel) {
        const b = this.model.base(paneId);
        st = b ? { status: b.status, ready: b.kind === kind } : null;
      }
      if (st?.ready && (st.status === 'idle' || st.status === 'done')) return { ok: true };
      blockedPolls = st?.status === 'blocked' ? blockedPolls + 1 : 0;
      if (blockedPolls >= 2) return { ok: false, why: 'agent_blocked' };
      if (this.clock.now() >= deadline) return { ok: false, why: 'not_ready' };
      await new Promise<void>((r) => this.clock.setTimeout(r, SPAWN_POLL_MS));
    }
  }
}
