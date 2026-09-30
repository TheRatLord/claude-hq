import { R2S, S2R, TERM_STATES, TERM_MODES, EVENT_KINDS, GONE_REASONS, ERR, SCENARIOS } from '../../../shared/protocol.ts';
import { isRecord } from '../../../shared/guards.ts';

/** Diagnostic metadata only: deliberately insufficient for action replay. */
export interface TraceEntry {
  seq: number;
  at: number;
  direction: 'in' | 'out' | 'local';
  type: string;
  meta?: Record<string, string | number | boolean>;
}
export interface TraceContext { scenario?: string; seed?: number; population?: number; protocol?: number; demo?: boolean; timescale?: number }
export interface TraceSnapshot { version: 1; context: TraceContext; entries: TraceEntry[]; dropped: number }
export const TRACE_LIMITS = Object.freeze({ entries: 512, calls: 128, aliases: 256, identifierLength: 256 });
const messageTypes: readonly string[] = [...Object.values(R2S), ...Object.values(S2R)];
const errors: readonly string[] = Object.values(ERR);
type Outcome = 'ok' | 'error' | 'timeout' | 'disconnected' | 'evicted';
type Delivery = 'queued' | 'sent' | 'dropped';
interface TrackedCall { request: string; requestType: string; started: number; delivery: Delivery }
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER;
const identifier = (v: unknown): v is string | number => (typeof v === 'string' && v.length <= TRACE_LIMITS.identifierLength) || number(v);
const enumValue = (v: unknown, values: readonly string[]): v is string => typeof v === 'string' && values.includes(v);

/** A clock seam makes timing/correlation tests deterministic; production uses the singleton below. */
export function createInteractionTrace(now: () => number = () => performance.now()) {
  let enabled = false;
  let context: TraceContext = {};
  let entries: TraceEntry[] = [];
  let head = 0, dropped = 0, seq = 0, aliasSeq = 0, requestSeq = 0, epoch = 0;
  const aliases = new Map<string | number, string>();
  const calls = new Map<string | number, TrackedCall>();
  const listeners = new Set<() => void>();
  let notified = false;
  function notify() {
    if (notified || !listeners.size) return;
    notified = true;
    queueMicrotask(() => {
      notified = false;
      for (const fn of listeners) { try { fn(); } catch { /* A diagnostic listener cannot interrupt transport. */ } }
    });
  }
  function reset() {
    context = {}; entries = []; head = dropped = seq = aliasSeq = requestSeq = 0;
    aliases.clear(); calls.clear(); epoch = now();
  }
  function at() { return Math.max(0, Math.round((now() - epoch) * 1000) / 1000); }
  function append(direction: TraceEntry['direction'], type: string, meta?: TraceEntry['meta']) {
    const entry: TraceEntry = { seq: ++seq, at: at(), direction, type };
    if (meta && Object.keys(meta).length) entry.meta = meta;
    if (entries.length < TRACE_LIMITS.entries) entries.push(entry);
    else { entries[head] = entry; head = (head + 1) % TRACE_LIMITS.entries; dropped++; }
    notify();
  }
  function alias(value: unknown): string | undefined {
    if (!identifier(value)) return undefined;
    const old = aliases.get(value);
    if (old) return old;
    if (aliases.size >= TRACE_LIMITS.aliases) {
      const first = aliases.keys().next();
      if (!first.done) aliases.delete(first.value);
    }
    const id = `p${++aliasSeq}`;
    aliases.set(value, id);
    return id;
  }
  function finish(rid: unknown, outcome: Outcome) {
    if (!enabled || !identifier(rid)) return;
    const call = calls.get(rid);
    if (!call) return;
    calls.delete(rid);
    append('local', 'call.end', { request: call.request, requestType: call.requestType, outcome,
      elapsedMs: Math.max(0, at() - call.started), delivery: call.delivery });
  }
  function captureDemoConfig(value: unknown, meta?: NonNullable<TraceEntry['meta']>) {
    if (!isRecord(value)) return;
    const config: TraceContext = {};
    if (enumValue(value.scenario, SCENARIOS)) config.scenario = value.scenario;
    if (number(value.seed) && Number.isInteger(value.seed) && value.seed >= 0 && value.seed <= 0xffff_ffff) config.seed = value.seed;
    if (number(value.population) && Number.isInteger(value.population) && value.population >= 0) config.population = value.population;
    Object.assign(context, config);
    if (meta) Object.assign(meta, config);
  }
  function captureHello(value: unknown, meta?: NonNullable<TraceEntry['meta']>) {
    if (!enabled || !isRecord(value)) return;
    if (number(value.protocol)) context.protocol = value.protocol;
    if (typeof value.demo === 'boolean' || number(value.demo)) context.demo = !!value.demo;
    if (number(value.timescale) && value.timescale > 0) context.timescale = value.timescale;
    captureDemoConfig(value.demoConfig, meta);
    notify();
  }
  return {
    get enabled() { return enabled; },
    setEnabled(value: boolean) {
      if (enabled === value) return;
      reset(); enabled = value; notify();
    },
    clear() { reset(); notify(); },
    setContext(value: { scenario?: string; seed?: number }) {
      if (!enabled) return;
      if ('scenario' in value) {
        delete context.scenario;
        if (enumValue(value.scenario, SCENARIOS)) context.scenario = value.scenario;
      }
      if ('seed' in value) {
        delete context.seed;
        if (number(value.seed) && Number.isInteger(value.seed) && value.seed >= 0 && value.seed <= 0xffff_ffff) context.seed = value.seed;
      }
      notify();
    },
    captureHello,
    snapshot(): TraceSnapshot {
      const ordered = head ? [...entries.slice(head), ...entries.slice(0, head)] : entries;
      return { version: 1, context: { ...context }, entries: ordered.map(e => ({ ...e, ...(e.meta ? { meta: { ...e.meta } } : {}) })), dropped };
    },
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    beginCall(msg: unknown) {
      if (!enabled || !isRecord(msg) || !identifier(msg.rid)) return;
      if (calls.size >= TRACE_LIMITS.calls) finish(calls.keys().next().value, 'evicted');
      const requestType = typeof msg.t === 'string' && messageTypes.includes(msg.t) ? msg.t : 'unknown';
      const call: TrackedCall = { request: `r${++requestSeq}`, requestType, started: at(), delivery: 'queued' };
      calls.set(msg.rid, call);
      append('local', 'call.start', { request: call.request, requestType });
    },
    finishCall: finish,
    disconnect() {
      if (!enabled) return;
      for (const rid of calls.keys()) finish(rid, 'disconnected');
    },
    connection(state: string, retryInMs: number | null) {
      if (!enabled) return;
      const meta: NonNullable<TraceEntry['meta']> = {};
      if (enumValue(state, ['connecting', 'open', 'closed', 'mismatch'])) meta.state = state;
      if (number(retryInMs)) meta.retryInMs = retryInMs;
      append('local', 'connection', meta);
    },
    message(direction: 'in' | 'out' | 'local', value: unknown, delivery?: Delivery) {
      if (!enabled || !isRecord(value)) return;
      const type = typeof value.t === 'string' && messageTypes.includes(value.t) ? value.t : 'unknown';
      const meta: NonNullable<TraceEntry['meta']> = {};
      const id = alias(type === 'entity' && isRecord(value.entity) ? value.entity.id : value.id);
      if (id) meta.id = id;
      const tracked = identifier(value.rid) ? calls.get(value.rid) : undefined;
      if (tracked) {
        meta.request = tracked.request;
        if (delivery) tracked.delivery = delivery;
      }
      if (delivery) meta.delivery = delivery;
      if (type === 'hello') captureHello(value, meta);
      if (type === 'reply') {
        meta.ok = value.ok === true;
        if (typeof value.error === 'string' && errors.includes(value.error)) meta.errorCode = value.error;
        if (value.ok === true && tracked?.requestType === 'demo.scenario') captureDemoConfig(value.demoConfig, meta);
      }
      if (type === 'gone') {
        if (enumValue(value.reason, GONE_REASONS)) meta.reason = value.reason;
        const next = alias(value.newId);
        if (next) meta.newId = next;
      }
      if (type === 'event' && enumValue(value.kind, EVENT_KINDS)) meta.kind = value.kind;
      if (type.startsWith('term.')) {
        if (enumValue(value.state, TERM_STATES)) meta.state = value.state;
        if (enumValue(value.mode, TERM_MODES)) meta.mode = value.mode;
        for (const key of ['cols', 'rows', 'upTo', 'lines'] as const) if (number(value[key])) meta[key] = value[key];
        for (const key of ['paste', 'writer', 'sizer', 'takeover'] as const) if (typeof value[key] === 'boolean') meta[key] = value[key];
      }
      if (type === 'demo.scenario') {
        if (enumValue(value.name, SCENARIOS)) meta.scenario = value.name;
        if (number(value.seed) && Number.isInteger(value.seed) && value.seed >= 0 && value.seed <= 0xffff_ffff) meta.seed = value.seed;
      }
      append(direction, type, meta);
      if (type === 'reply') finish(value.rid, value.ok === true ? 'ok' : 'error');
    },
    binary(direction: 'in' | 'out' | 'local', id: string, bytes: number, full: boolean, delivery?: Delivery) {
      if (!enabled) return;
      const meta: NonNullable<TraceEntry['meta']> = { full };
      const pane = alias(id);
      if (pane) meta.id = pane;
      if (number(bytes)) meta.bytes = bytes;
      if (delivery) meta.delivery = delivery;
      append(direction, direction === 'in' ? 'term.data' : 'term.input.binary', meta);
    },
    credit(id: string, sent: number, acked: number, queuedBytes: number) {
      if (!enabled) return;
      const meta: NonNullable<TraceEntry['meta']> = {};
      const pane = alias(id);
      if (pane) meta.id = pane;
      if (number(sent)) meta.sent = sent;
      if (number(acked)) meta.acked = acked;
      if (number(queuedBytes)) meta.queuedBytes = queuedBytes;
      append('local', 'term.credit', meta);
    },
  };
}

export const interactionTrace = createInteractionTrace();
