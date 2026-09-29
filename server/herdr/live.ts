/**
 * HerdrLive (DESIGN §4.2): the live-model recipe (research/herdr-api §3) as a `HerdrSource`. Owner: BE.
 *   1. ping → structural subscription (all global types, buffered) → session.snapshot → apply.
 *   2. one status subscription per agent pane (a closed pane poisons a whole subscription), rebuilt on every snapshot.
 *   3. reconcile: snapshot 80 ms (debounced) after any structural event, plus every 1.5 s. The snapshot is the truth.
 *   4. offline on EOF/ECONNREFUSED: `connected(false)`, retry every 2 s, keep the last snapshot (the model freezes).
 *   5. after a reconnect: `reconnected({grace:true})` BEFORE the first new snapshot (WorldModel runs the 15 s grace).
 * Emits 'snapshot'(raw) · 'status'(pane_id, status, seq) · 'connected'(bool, {retryInMs}) · 'reconnected'({grace}).
 */
import { HerdrSource } from '../interfaces.ts';
import type { Clock, Logger, RawSnapshot, TimerHandle } from '../interfaces.ts';
import type { HerdrClient, HerdrEvent, SubscriptionHandle } from './client.ts';
import { errCode, errMessage, isRecord } from '../../shared/guards.ts';
import type { Status } from '../../shared/protocol.ts';

export const GLOBAL_EVENT_TYPES = Object.freeze([
  'workspace.created', 'workspace.updated', 'workspace.metadata_updated', 'workspace.renamed', 'workspace.moved',
  'workspace.reordered', 'workspace.closed', 'workspace.focused', 'worktree.created', 'worktree.opened', 'worktree.removed',
  'tab.created', 'tab.closed', 'tab.focused', 'tab.renamed', 'tab.moved',
  'pane.created', 'pane.closed', 'pane.updated', 'pane.focused', 'pane.moved', 'pane.exited', 'pane.agent_detected',
  'layout.updated',
]);

const RECONCILE_MS = 1500;
const DEBOUNCE_MS = 80;
const RETRY_MS = 2000;

export class HerdrLive extends HerdrSource {
  client: HerdrClient;
  clock: Clock;
  log: Logger;
  raw: RawSnapshot | null;
  everConnected: boolean;
  closed: boolean;
  _structural: SubscriptionHandle | null;
  /** pane_id → status subscription */
  _statusSubs: Map<string, SubscriptionHandle | 'pending'>;
  _reconcileTimer: TimerHandle | null;
  _debounceTimer: TimerHandle | null;
  _retryTimer: TimerHandle | null;
  _snapInFlight: Promise<void> | null;
  _gen: number;
  _announcedOffline?: boolean;
  metrics: { snapshots: number; reconnects: number; statusEvents: number };

  constructor({ client, clock, log }: { client: HerdrClient; clock: Clock; log?: Logger }) {
    super();
    this.client = client;
    this.clock = clock;
    this.log = log ?? { debug() {}, info() {}, warn() {}, error() {} };
    this.raw = null;
    this.connected = false;
    this.everConnected = false;
    this.closed = false;
    this._structural = null;
    this._statusSubs = new Map();
    this._reconcileTimer = null;
    this._debounceTimer = null;
    this._retryTimer = null;
    this._snapInFlight = null;
    this._gen = 0;
    this.metrics = { snapshots: 0, reconnects: 0, statusEvents: 0 };
  }

  override snapshot(): RawSnapshot | null {
    return this.raw;
  }

  get readOnly(): boolean {
    return this.client.readOnly;
  }

  /** Same method names/params/errors as the herdr socket (client.ts gates them). */
  override request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.connected && method !== 'ping') {
      return Promise.reject(Object.assign(new Error('herdr is offline'), { code: 'herdr_offline' }));
    }
    return this.client.request(method, params);
  }

  /** Connect (or keep retrying in the background). Resolves after the first attempt either way. */
  async start(): Promise<void> {
    await this._connect();
  }

  async _connect(): Promise<void> {
    if (this.closed) return;
    const gen = ++this._gen;
    try {
      await this.client.ping();
      if (this.client.readOnly) this.log.warn(`herdr protocol ${this.client.protocol} ≠ 22: read-only mode`);
      const buffered: HerdrEvent[] = [];
      let applying = false;
      this._structural = await this.client.subscribe(GLOBAL_EVENT_TYPES.map((type) => ({ type })), (m) => {
        if (!applying) buffered.push(m);
        else this._onStructural();
      }, () => this._offline(gen, 'structural subscription ended'));
      if (gen !== this._gen || this.closed) return this._structural?.close();
      const reconnect = this.everConnected;
      if (reconnect) {
        this.metrics.reconnects++;
        this.emit('reconnected', { grace: true });
      }
      await this._snapshotNow();
      applying = true;
      if (buffered.length) this._scheduleSnapshot();
      this.connected = true;
      this.everConnected = true;
      this.emit('connected', true, {});
      this._reconcileTimer = this.clock.setInterval(() => this._snapshotNow().catch((e) => this._onRequestError(gen, e)), RECONCILE_MS);
    } catch (e) {
      this._offline(gen, errMessage(e));
    }
  }

  _onRequestError(gen: number, e: unknown): void {
    // only "the server is gone" flips offline; a slow or dropped reply is retried by the next reconcile
    const code = errCode(e);
    if (code === 'ECONNREFUSED' || code === 'ENOENT') this._offline(gen, errMessage(e));
    else this.log.debug('snapshot failed', isRecord(e) ? e.message : undefined);
  }

  _offline(gen: number, why: string): void {
    if (gen !== this._gen || this.closed) return;
    this._gen++;
    const was = this.connected;
    this.connected = false;
    this._teardown();
    if (was || !this._announcedOffline) {
      this.log.warn(`herdr offline: ${why}; retrying every ${RETRY_MS / 1000} s`);
      this.emit('connected', false, { retryInMs: RETRY_MS });
      this._announcedOffline = true;
    }
    this._retryTimer = this.clock.setTimeout(() => {
      this._retryTimer = null;
      this._connect();
    }, RETRY_MS);
  }

  _teardown(): void {
    this.clock.clearInterval(this._reconcileTimer);
    this.clock.clearTimeout(this._debounceTimer);
    this._reconcileTimer = this._debounceTimer = null;
    this._structural?.close();
    this._structural = null;
    for (const s of this._statusSubs.values()) if (s !== 'pending') s.close();
    this._statusSubs.clear();
  }

  _onStructural(): void {
    this._scheduleSnapshot();
  }

  _scheduleSnapshot(): void {
    if (this._debounceTimer) return;
    this._debounceTimer = this.clock.setTimeout(() => {
      this._debounceTimer = null;
      const gen = this._gen;
      this._snapshotNow().catch((e) => this._onRequestError(gen, e));
    }, DEBOUNCE_MS);
  }

  /** Fetch + apply a snapshot (coalesces concurrent calls). */
  _snapshotNow(): Promise<void> {
    if (this._snapInFlight) return this._snapInFlight;
    const gen = this._gen;
    this._snapInFlight = this.client.request('session.snapshot', {}).then((r) => {
      if (gen !== this._gen || this.closed) return;
      // herdr wraps the snapshot as {snapshot}; some replies are the bare snapshot (see mock + fixtures)
      const raw = (isRecord(r) && r.snapshot !== undefined && r.snapshot !== null ? r.snapshot : r) as RawSnapshot;
      this.metrics.snapshots++;
      this.raw = raw;
      this._syncStatusSubs(raw, gen);
      this.emit('snapshot', raw);
    }).finally(() => {
      this._snapInFlight = null;
    });
    return this._snapInFlight;
  }

  /** One status subscription per agent pane; drop those whose pane went away or lost its agent. */
  _syncStatusSubs(raw: RawSnapshot, gen: number): void {
    const want = new Set((raw.panes ?? []).filter((p) => p.agent).map((p) => p.pane_id));
    for (const [id, s] of this._statusSubs) {
      if (want.has(id)) continue;
      if (s !== 'pending') s.close();
      this._statusSubs.delete(id);
    }
    for (const id of want) {
      if (this._statusSubs.has(id)) continue;
      this._statusSubs.set(id, 'pending');
      this.client.subscribe([{ type: 'pane.agent_status_changed', pane_id: id }], (m) => this._onStatus(id, m), () => {
        if (this._statusSubs.get(id) && gen === this._gen) {
          this._statusSubs.delete(id); // resubscribed by the next snapshot if the pane still exists
        }
      }).then((h) => {
        if (gen !== this._gen || this._statusSubs.get(id) !== 'pending') return h.close();
        this._statusSubs.set(id, h);
      }, (e) => {
        if (this._statusSubs.get(id) === 'pending') this._statusSubs.delete(id);
        this.log.debug(`status subscription ${id}: ${errCode(e) ?? errMessage(e)}`);
      });
    }
  }

  _onStatus(id: string, m: HerdrEvent): void {
    const d = isRecord(m.data) ? m.data : {};
    // herdr's pane.agent_status_changed carries the new status name
    const status = d.agent_status as Status | undefined;
    if (!status || !this.raw) return;
    this.metrics.statusEvents++;
    const p = this.raw.panes?.find((x) => x.pane_id === id);
    const a = this.raw.agents?.find((x) => x.pane_id === id);
    if (p) p.agent_status = status;
    if (a) {
      if (a.agent_status !== status && a.state_change_seq !== undefined && Number.isInteger(a.state_change_seq)) a.state_change_seq++; // provisional; snapshot corrects
      a.agent_status = status;
    }
    this.emit('status', id, status, a?.state_change_seq ?? null);
    this._scheduleSnapshot();
  }

  override async close(): Promise<void> {
    this.closed = true;
    this._gen++;
    this.clock.clearTimeout(this._retryTimer);
    this._teardown();
    this.removeAllListeners();
  }
}
