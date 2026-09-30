/**
 * Renderer store: the ONLY module that touches the WebSocket.
 * - Applies every message eagerly in `ws.onmessage` (never in the frame loop: rAF stops in hidden tabs).
 * - `entity`/`screen` are coalesced per id; listeners fire on a microtask, in arrival order, once per id per flush.
 * - Binary `term.data` goes straight to the writer registered with `onTermData(id, fn)`.
 * - Protocol skew: `hello.protocol` is checked before anything else; mismatch → banner + one guarded reload.
 * The frame loop only READS `store.*`.
 */
import {
  PROTOCOL_VERSION, S2R, R2S, BIN, BIN_FLAG, DEFAULT_LIMITS, decodeFrame, encodeTermInput,
} from '../../../shared/protocol.ts';
import type {
  Entity, Workspace, Stats, Hello, HelloLimits, ServerMsg, ClientMsg, ReplyMsg, WorldMsg, GoneMsg, WorkspacesMsg,
  EventMsg, ToastMsg, TimelineMsg, TermStateMsg, TermAckMsg, ScreenMsg,
} from '../../../shared/protocol.ts';
import { isRecord } from '../../../shared/guards.ts';
import { isServerMsg } from '../../../shared/serverMsg.ts';
import { createSocket, adoptToken, clientId } from './socket.ts';
import type { HqSocket } from './socket.ts';
import { interactionTrace } from './trace.ts';

export type ConnState = 'connecting' | 'open' | 'closed' | 'mismatch';
export interface ConnInfo {
  state: ConnState;
  /** performance.now() of the last change */
  since: number;
  retryInMs: number | null;
  /** successful hellos so far (≥ 2 → this is a reconnect) */
  connects: number;
}
/** herdr link state: `hello.herdr` first, then the `herdr` messages (minus their `t`). */
export interface HerdrState { connected: boolean; retryInMs?: number; reconnecting?: boolean; protocol?: number | null; readOnly?: boolean }
/** The latest `screen` for a pane (`at` = performance.now() when it arrived). */
export interface ScreenSnapshot { lines: string[]; cols: number; rows: number; ansi?: boolean; at: number }
export type ScreenEvent = ScreenSnapshot & { id: string };

/** Payload of every `store.on` topic. `term.*` = any `term.state` / `term.ack`. */
export interface StoreEvents {
  hello: Hello;
  world: WorldMsg;
  entity: Entity;
  gone: GoneMsg;
  workspaces: WorkspacesMsg;
  event: EventMsg;
  stats: Stats;
  herdr: HerdrState;
  screen: ScreenEvent;
  toast: ToastMsg;
  timeline: TimelineMsg;
  'term.state': TermStateMsg;
  'term.ack': TermAckMsg;
  'term.*': TermStateMsg | TermAckMsg;
  conn: ConnInfo;
}
type StoreTopic = keyof StoreEvents;
type AnyPayload = StoreEvents[StoreTopic];

/** Renderer → server text message; `rid` is added by `call`. */
export type OutMsg = ClientMsg;

const STATS_RING = 300;
const CALL_TIMEOUT_MS = 20_000;
const QUEUE_MAX = 200;
const SKEW_KEY = 'hq.protocolReload';

/** Listener topics accepted by `store.on`. `term.*` = any `term.state` / `term.ack`. */
export const STORE_EVENTS: readonly StoreTopic[] = Object.freeze([
  'hello', 'world', 'entity', 'gone', 'workspaces', 'event', 'stats', 'herdr', 'screen', 'toast', 'timeline',
  'term.state', 'term.ack', 'term.*', 'conn',
] as const);

type Listener = (payload: AnyPayload) => void;
const listeners = new Map<StoreTopic, Set<Listener>>();
type TermWriter = (bytes: Uint8Array, full: boolean) => void;
const termWriters = new Map<string, Set<TermWriter>>();
const pending = new Map<string | number, { resolve: (r: ReplyMsg) => void; timer: ReturnType<typeof setTimeout> }>();
let ridSeq = 1;
let sock: HqSocket | null = null;
let acked = false;
/** JSON frames sent before hello.ack */
let queue: string[] = [];

/** The store singleton's shape. */
export interface Store {
  entities: Map<string, Entity>;
  /** workspace list */
  workspaces: Workspace[];
  focusedPaneId: string | null;
  /** latest Stats */
  stats: Stats | null;
  /** ring of the last ≤ 300 Stats, oldest first */
  statsHistory: Stats[];
  screens: Map<string, ScreenSnapshot>;
  /** latest term.state per pane id */
  termStates: Map<string, TermStateMsg>;
  /** the last hello payload */
  hello: Hello | null;
  herdr: HerdrState;
  conn: ConnInfo;
  /** server clock − local clock, ms (from hello.serverNow) */
  skewMs: number;
  /** hello.limits (DEFAULT_LIMITS until hello) */
  limits: HelloLimits;
  /** true when the backend runs --demo */
  demo: boolean;
  /** hello.timescale: the server clock runs K× wall under `--timescale K` (demo/replay) */
  timescale: number;
  /** local Date.now() when skewMs was measured */
  skewAt: number;
  /** Server-clock ms now (use for statusSince ages); extrapolates at the server's rate. */
  now(): number;
  /** Subscribe to one of STORE_EVENTS. Returns an unsubscribe function. */
  on<K extends StoreTopic>(evt: K, fn: (payload: StoreEvents[K]) => void): () => boolean;
}

/**
 * The store singleton. Maps are mutated in place (identity stable for the life of the page).
 */
export const store: Store = {
  entities: new Map(),
  workspaces: [],
  focusedPaneId: null,
  stats: null,
  statsHistory: [],
  screens: new Map(),
  termStates: new Map(),
  hello: null,
  herdr: { connected: false },
  conn: { state: 'connecting', since: 0, retryInMs: null, connects: 0 },
  skewMs: 0,
  limits: { ...DEFAULT_LIMITS },
  demo: false,

  timescale: 1,
  skewAt: 0,

  /**
   * Server-clock ms now (use for statusSince ages). Extrapolates at the server's rate (hello.timescale), so ages stay
   * honest under a demo time-lapse: server now = serverNow + K·(local − skewAt).
   * A plain 1× extrapolation would fall behind the scaled stamps when K≠1, and every age would read 0s.
   */
  now: () => { const l = Date.now(); return l + store.skewMs + (store.timescale - 1) * (l - store.skewAt); },

  on(evt, fn) {
    const set = listeners.get(evt) ?? new Set<Listener>();
    listeners.set(evt, set);
    // The one cast: a listener for topic K sits in the shared per-topic set and is only ever fired with K's payload.
    const l = fn as Listener;
    set.add(l);
    return () => set.delete(l);
  },
};

// ---------------------------------------------------------------------------------------------
// Microtask-coalesced dispatch

const outbox = new Map<string, { evt: StoreTopic; payload: AnyPayload }>();
let seq = 0;
let flushQueued = false;

function dispatch<K extends StoreTopic>(evt: K, payload: StoreEvents[K], coalesceKey: string | null = null) {
  const key = coalesceKey ?? `#${seq++}`;
  if (coalesceKey && outbox.has(key)) outbox.delete(key); // re-insert at the end so order follows the latest message
  outbox.set(key, { evt, payload });
  if (!flushQueued) {
    flushQueued = true;
    queueMicrotask(flush);
  }
}

function flush() {
  flushQueued = false;
  const items = [...outbox.values()];
  outbox.clear();
  for (const { evt, payload } of items) {
    fire(evt, payload);
    if (evt.startsWith('term.')) fire('term.*', payload);
  }
}

function fire(evt: StoreTopic, payload: AnyPayload) {
  const s = listeners.get(evt);
  if (!s) return;
  for (const fn of [...s]) {
    try { fn(payload); } catch (e) { console.error(`[store] ${evt} listener threw`, e); }
  }
}

function setConn(state: ConnState, retryInMs: number | null = null) {
  store.conn = { ...store.conn, state, since: performance.now(), retryInMs };
  interactionTrace.connection(state, retryInMs);
  dispatch('conn', store.conn, 'conn');
}

// ---------------------------------------------------------------------------------------------
// Apply (eager)

const banner = (text: string) => {
  const el = typeof document !== 'undefined' && document.getElementById('hq-banner');
  if (el) { el.textContent = text; el.classList.add('show'); }
};

/**
 * Protocol-skew decision, pure. `tried` = the sessionStorage guard from an earlier reload in this tab.
 */
export function skewAction(bundled: number, server: number, tried: string | null): { action: 'ok' | 'reload' | 'stuck'; tag: string } {
  const tag = `${bundled}->${server}`;
  if (bundled === server) return { action: 'ok', tag };
  return { action: tried === tag ? 'stuck' : 'reload', tag };
}

/** false → stop processing (protocol mismatch) */
function checkProtocol(hello: Hello): boolean {
  let tried: string | null = null;
  try { tried = sessionStorage.getItem(SKEW_KEY); } catch { /* ignore */ }
  const { action, tag } = skewAction(PROTOCOL_VERSION, hello.protocol, tried);
  if (action === 'ok') {
    if (tried !== null) { try { sessionStorage.removeItem(SKEW_KEY); } catch { /* ignore */ } }
    return true;
  }
  sock?.close({ reconnect: false });
  queue = [];
  setConn('mismatch');
  if (action === 'reload') {
    try { sessionStorage.setItem(SKEW_KEY, tag); } catch { /* ignore */ }
    banner('Claude HQ was updated — reloading');
    setTimeout(() => location.reload(), 600);
  } else {
    banner(`Claude HQ was updated, but this page is still stale (renderer protocol ${PROTOCOL_VERSION}, server ${hello.protocol}). Hard-reload the page (Ctrl+Shift+R).`);
  }
  return false;
}

function applyWorld(m: WorldMsg) {
  const next = new Set<string>();
  for (const e of m.entities || []) {
    next.add(e.id);
    store.entities.set(e.id, e);
  }
  for (const id of [...store.entities.keys()]) if (!next.has(id)) store.entities.delete(id);
  store.workspaces = m.workspaces || [];
  store.focusedPaneId = m.focusedPaneId ?? null;
  dispatch('world', m);
}

export { isServerMsg };

function onText(text: string) {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { console.warn('[store] bad JSON from server'); return; }
  if (!isServerMsg(raw)) { console.warn('[store] unknown message', isRecord(raw) ? raw.t : undefined); return; }
  const m: ServerMsg = raw;
  interactionTrace.message('in', m);
  switch (m.t) {
    case S2R.HELLO: {
      if (!checkProtocol(m)) return;
      store.hello = m;
      store.skewAt = Date.now();
      store.skewMs = typeof m.serverNow === 'number' ? m.serverNow - store.skewAt : 0;
      store.timescale = typeof m.timescale === 'number' && m.timescale > 0 ? m.timescale : 1;
      store.demo = !!m.demo;
      if (m.limits) store.limits = { ...DEFAULT_LIMITS, ...m.limits };
      if (m.herdr) store.herdr = { ...m.herdr };
      if (Array.isArray(m.statsHistory)) {
        store.statsHistory = m.statsHistory.slice(-STATS_RING);
        store.stats = store.statsHistory.at(-1) ?? store.stats;
      }
      const helloAck = { t: R2S.HELLO_ACK, protocol: PROTOCOL_VERSION };
      if (sock?.send(JSON.stringify(helloAck))) interactionTrace.message('out', helloAck, 'sent');
      acked = true;
      for (const q of queue) {
        const sent = sock?.send(q);
        if (interactionTrace.enabled) interactionTrace.message(sent ? 'out' : 'local', JSON.parse(q), sent ? 'sent' : 'dropped');
      }
      queue = [];
      store.conn.connects++;
      setConn('open');
      dispatch('hello', m);
      return;
    }
    case S2R.WORLD: applyWorld(m); return;
    case S2R.ENTITY: {
      const e = m.entity;
      if (!e || !e.id) return;
      store.entities.set(e.id, e);
      dispatch('entity', e, `e:${e.id}`);
      return;
    }
    case S2R.GONE: {
      store.entities.delete(m.id);
      store.screens.delete(m.id);
      outbox.delete(`e:${m.id}`);
      dispatch('gone', m);
      return;
    }
    case S2R.WORKSPACES:
      store.workspaces = m.workspaces || [];
      store.focusedPaneId = m.focusedPaneId ?? null;
      dispatch('workspaces', m, 'workspaces');
      return;
    case S2R.EVENT: dispatch('event', m); return;
    case S2R.STATS:
      store.stats = m.stats;
      store.statsHistory.push(m.stats);
      if (store.statsHistory.length > STATS_RING) store.statsHistory.splice(0, store.statsHistory.length - STATS_RING);
      dispatch('stats', m.stats, 'stats');
      return;
    case S2R.HERDR: {
      const { t: _t, ...herdr } = m;
      store.herdr = herdr;
      dispatch('herdr', store.herdr, 'herdr');
      return;
    }
    case S2R.SCREEN: {
      const s: ScreenSnapshot = { lines: m.lines, cols: m.cols, rows: m.rows, ansi: m.ansi, at: performance.now() };
      store.screens.set(m.id, s);
      dispatch('screen', { id: m.id, ...s }, `s:${m.id}`);
      return;
    }
    case S2R.TERM_STATE:
      store.termStates.set(m.id, m);
      dispatch('term.state', m);
      return;
    case S2R.TERM_ACK: {
      const c = credits.get(m.id);
      if (c && typeof m.upTo === 'number' && m.upTo > c.acked) { c.acked = m.upTo; drainCredit(m.id); }
      dispatch('term.ack', m);
      return;
    }
    case S2R.TOAST: dispatch('toast', m); return;
    case S2R.TIMELINE: dispatch('timeline', m); return;
    case S2R.REPLY: {
      const rid = m.rid;
      const p = rid === null ? undefined : pending.get(rid);
      if (rid !== null && p) { pending.delete(rid); clearTimeout(p.timer); p.resolve(m); }
      return;
    }
  }
}

function onBinary(buf: ArrayBuffer) {
  const f = decodeFrame(buf);
  if (!f || f.kind !== BIN.TERM_DATA) return;
  interactionTrace.binary('in', f.id, f.payload.byteLength, (f.flags & BIN_FLAG.FULL) !== 0);
  const set = termWriters.get(f.id);
  if (!set) return;
  const full = (f.flags & BIN_FLAG.FULL) !== 0;
  for (const fn of set) {
    try { fn(f.payload, full); } catch (e) { console.error('[store] term writer threw', e); }
  }
}

// ---------------------------------------------------------------------------------------------
// Public API

/**
 * Open the connection (idempotent). Boot calls this once with the URL token.
 */
export function connect({ token = null, url }: { token?: string | null; url?: string } = {}): void {
  if (sock) return;
  const t = adoptToken(token);
  setConn('connecting');
  sock = createSocket({
    token: t,
    cid: clientId(),
    url,
    handlers: {
      onOpen: () => { acked = false; interactionTrace.connection('connecting', null); },
      onText,
      onBinary,
      onClose: ({ retryInMs }) => {
        acked = false;
        interactionTrace.disconnect();
        credits.clear(); // un-acked/queued keystrokes are stale after a drop; term.open (re)starts the count
        for (const [rid, p] of pending) { clearTimeout(p.timer); p.resolve({ t: 'reply', rid, ok: false, error: 'disconnected' }); }
        pending.clear();
        if (store.conn.state !== 'mismatch') setConn('closed', retryInMs);
      },
    },
  });
}

/**
 * Fire-and-forget JSON message. Queued (≤ 200) until `hello.ack` if not yet connected.
 */
export function send(msg: OutMsg): boolean {
  if ((msg.t === R2S.TERM_OPEN || msg.t === R2S.TERM_CLOSE) && typeof msg.id === 'string') resetCredit(msg.id);
  const text = JSON.stringify(msg);
  if (sock && acked && sock.send(text)) { interactionTrace.message('out', msg, 'sent'); return true; }
  if (store.conn.state === 'mismatch') { interactionTrace.message('local', msg, 'dropped'); return false; }
  if (queue.length < QUEUE_MAX) { queue.push(text); interactionTrace.message('local', msg, 'queued'); }
  else interactionTrace.message('local', msg, 'dropped');
  return false;
}

/**
 * Request/reply. Adds a `rid`; always resolves with the `reply` payload (`{ok:false, error:'disconnected'|'timeout'}`
 * on failure), never rejects.
 */
export function call(msg: OutMsg, { timeoutMs = CALL_TIMEOUT_MS }: { timeoutMs?: number } = {}): Promise<ReplyMsg> {
  const rid = ridSeq++;
  const request = { ...msg, rid };
  interactionTrace.beginCall(request);
  return new Promise<ReplyMsg>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(rid);
      interactionTrace.finishCall(rid, 'timeout');
      resolve({ t: 'reply', rid, ok: false, error: 'timeout' });
    }, timeoutMs);
    pending.set(rid, { resolve, timer });
    send(request);
  });
}

// ---------------------------------------------------------------------------------------------
// Terminal input. Interactive: binary kind 2, no rid, ≤ creditWindow un-acked bytes per pane, queued locally
// beyond that. Paste: JSON `term.input {paste:true, rid}` chunks, each awaited (the hub replies after stdin drain).
// The hub's `term.ack.upTo` counts every byte written for this (client, pane) viewer since `term.open`, paste
// included, so paste bytes are added to `sent` too (they just never wait for credit).

const LOCAL_QUEUE_MAX = 1024 * 1024;
interface Credit { sent: number; acked: number; q: Uint8Array[]; qBytes: number }
const credits = new Map<string, Credit>();
const creditOf = (id: string): Credit => {
  let c = credits.get(id);
  if (!c) credits.set(id, (c = { sent: 0, acked: 0, q: [], qBytes: 0 }));
  return c;
};
const resetCredit = (id: string) => {
  credits.delete(id);
  interactionTrace.credit(id, 0, 0, 0);
};

function drainCredit(id: string) {
  const c = credits.get(id);
  if (!c || !sock || !acked) return;
  const win = store.limits.creditWindow;
  while (c.q.length && c.sent - c.acked + c.q[0].length <= win) {
    const b = c.q.shift();
    if (!b) break; // unreachable: the loop condition just saw an element
    c.qBytes -= b.length;
    if (!sock.send(encodeTermInput(id, b))) {
      c.q.unshift(b); c.qBytes += b.length;
      interactionTrace.binary('local', id, b.length, false, 'queued');
      return;
    }
    interactionTrace.binary('out', id, b.length, false, 'sent');
    c.sent += b.length;
  }
  interactionTrace.credit(id, c.sent, c.acked, c.qBytes);
}

/**
 * Interactive `term.input` (binary, fire-and-forget; typing only). Payloads above `limits.termInputMax` are split.
 * Beyond the un-acked credit window the bytes wait in a local FIFO (≤ 1 MB) and flush as `term.ack` arrives.
 * Returns false (dropped) when not connected or the local queue is full: the UI outbox owns retry.
 */
export function sendBytes(id: string, bytes: Uint8Array): boolean {
  if (!sock || !acked || !bytes.length) {
    interactionTrace.binary('local', id, bytes.length, false, 'dropped');
    return false;
  }
  const c = creditOf(id);
  const max = store.limits.termInputMax;
  if (c.qBytes + bytes.length > LOCAL_QUEUE_MAX) {
    interactionTrace.binary('local', id, bytes.length, false, 'dropped');
    return false;
  }
  for (let o = 0; o < bytes.length; o += max) {
    const part = bytes.subarray(o, o + max);
    c.q.push(part);
    c.qBytes += part.length;
  }
  interactionTrace.binary('local', id, bytes.length, false, 'queued');
  drainCredit(id);
  return true;
}

const te = new TextEncoder();

/**
 * Split `text` into chunks of ≤ `maxBytes` UTF-8 bytes, never inside a code point (surrogate pairs stay together).
 */
export function chunkUtf8(text: string, maxBytes: number): string[] {
  const out: string[] = [];
  let start = 0, bytes = 0;
  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i) ?? 0; // i < length, so always defined
    const w = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    const n = cp > 0xffff ? 2 : 1;
    if (bytes + w > maxBytes) { out.push(text.slice(start, i)); start = i; bytes = 0; }
    bytes += w;
    i += n;
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

/**
 * Paste path: JSON `{t:'term.input', id, text, paste:true, rid}` in ≤ `limits.pasteChunk`-byte UTF-8-safe
 * chunks; the next chunk is sent only after the previous reply (hub awaits stdin drain). Stops at the first error.
 */
export async function sendPaste(
  id: string, text: string, { onProgress }: { onProgress?: (sentChunks: number, totalChunks: number) => void } = {},
): Promise<{ ok: boolean; error?: string; chunks: number; sent: number }> {
  const chunks = chunkUtf8(text, store.limits.pasteChunk);
  let sent = 0;
  if (!sock || !acked) return { ok: false, error: 'disconnected', chunks: chunks.length, sent };
  for (const chunk of chunks) {
    const r = await call({ t: R2S.TERM_INPUT, id, text: chunk, paste: true });
    if (!r.ok) return { ok: false, error: r.error, chunks: chunks.length, sent };
    const c = creditOf(id);
    c.sent += te.encode(chunk).length;
    interactionTrace.credit(id, c.sent, c.acked, c.qBytes);
    sent++;
    onProgress?.(sent, chunks.length);
  }
  return { ok: true, chunks: chunks.length, sent };
}

/**
 * Register the xterm writer for a pane. Returns an unsubscribe function.
 */
export function onTermData(id: string, fn: TermWriter): () => void {
  let s = termWriters.get(id);
  if (!s) termWriters.set(id, (s = new Set()));
  s.add(fn);
  return () => { s.delete(fn); if (!s.size) termWriters.delete(id); };
}

/** WS bufferedAmount (backpressure hints for the UI). */
export const bufferedAmount = () => sock?.bufferedAmount() ?? 0;

/** Drop the socket and reconnect (debug / tests). */
export function reconnect(): void { sock?.close(); }
