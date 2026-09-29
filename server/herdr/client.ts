/**
 * herdr client (DESIGN §4.1): one unix-socket connection per request, long-lived subscriptions, `terminal session`
 * children with a scrubbed env. Defence in depth: a per-session METHOD ALLOWLIST and a read-only mode live HERE,
 * independent of actions.ts (§4.8 "two gates"). Owner: BE.
 *
 *   READ        ping session.snapshot events.subscribe workspace.list tab.list pane.list pane.get pane.read
 *               pane.process_info agent.list agent.get agent.read agent.explain; spawn `observe`     default ✓ named ✓
 *   CONTROL     spawn `terminal session control`: only with a hub-issued one-shot promoteToken       default ✓ named ✓
 *   INTERACT    pane.send_keys agent.prompt                                                          default ✓ named ✓
 *   FOCUS       pane.focus                                                                           default ✓ named ✓
 *   STRUCTURAL  workspace.create/close/rename tab.create/close/rename pane.split/close/run agent.start/stop
 *                                                                           default: never (no override); named ✓
 *   NEVER       server.stop session.stop/delete, anything unknown                                   throws everywhere
 * Read-only mode (ping protocol ≠ 22): only READ (incl. observe) works; everything else throws `readonly_protocol`.
 * No child is spawned before a successful `ping` (§4.1 ping-before-spawn).
 */
import net from 'node:net';
import type { Readable } from 'node:stream';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { Clock, Logger } from '../interfaces.ts';
import { isRecord } from '../../shared/guards.ts';
import { socketFor, herdrBin, childEnv, isDefaultTarget } from './resolve.ts';

/** A promote token is valid for this long after `term.promote` minted it. */
export const PROMOTE_TOKEN_MS = 30_000;
import { ERR } from '../../shared/protocol.ts';

export const HERDR_PROTOCOL = 22;

export const METHOD_CLASS = Object.freeze({
  read: Object.freeze(['ping', 'session.snapshot', 'events.subscribe', 'workspace.list', 'tab.list', 'pane.list', 'pane.get',
    'pane.read', 'pane.process_info', 'agent.list', 'agent.get', 'agent.read', 'agent.explain']),
  interact: Object.freeze(['pane.send_keys', 'agent.prompt']),
  focus: Object.freeze(['pane.focus']),
  structural: Object.freeze(['workspace.create', 'workspace.close', 'workspace.rename', 'tab.create', 'tab.close', 'tab.rename',
    'pane.split', 'pane.close', 'pane.run', 'agent.start', 'agent.stop']),
});

export type MethodClass = keyof typeof METHOD_CLASS;

export function classifyMethod(method: string): MethodClass | 'never' {
  // Object.keys/entries lose the key type; METHOD_CLASS's keys are exactly MethodClass
  for (const cls of Object.keys(METHOD_CLASS) as MethodClass[]) if (METHOD_CLASS[cls].includes(method)) return cls;
  return 'never';
}

const denied = (code: string, why: string): Error & { code: string } => Object.assign(new Error(why), { code });
const quietLog: Logger = { debug() {}, info() {}, warn() {}, error() {} };

/** One NDJSON message from herdr: `{id, result}` or `{id, error}`, or a subscription event. Narrowed at the edge. */
export interface HerdrWireMsg {
  id?: string;
  result?: unknown;
  error?: { code?: string; message?: string };
  event?: string;
  data?: unknown;
}
/** Anything an events.subscribe stream delivers after `subscription_started`. */
export type HerdrEvent = HerdrWireMsg;

/** A herdr subscription spec (`{type, pane_id?}`). */
export interface Subscription { type: string; pane_id?: string }
/** Handle of a live subscription. */
export interface SubscriptionHandle { close(): void }

export interface HerdrClientOptions {
  session: string;
  /** from resolve.ts isDefaultTarget (realpath, incl. the socket override); app.ts always passes it */
  isDefault?: boolean;
  clock: Clock;
  readOnly?: boolean;
  instanceId?: string;
  stateTag?: string;
  log?: Logger;
  socket?: string;
  bin?: string;
  timeoutMs?: number;
  onSpawn?: (child: ChildProcess, info: { mode: string; paneId: string }) => void;
}

export interface SpawnTermOpts {
  mode: 'observe' | 'control';
  paneId: string;
  cols: number;
  rows: number;
  takeover?: boolean;
  promoteToken?: string;
}

const errOf = (m: HerdrWireMsg): Error & { code?: string } =>
  Object.assign(new Error(m.error?.message ?? m.error?.code), { code: m.error?.code });

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Validate a parsed NDJSON object into a HerdrWireMsg: mistyped fields are omitted. */
export function toWireMsg(m: Record<string, unknown>): HerdrWireMsg {
  const msg: HerdrWireMsg = {};
  const id = str(m.id);
  if (id !== undefined) msg.id = id;
  if ('result' in m) msg.result = m.result;
  if (m.error) msg.error = isRecord(m.error) ? { code: str(m.error.code), message: str(m.error.message) } : {};
  const event = str(m.event);
  if (event !== undefined) msg.event = event;
  if ('data' in m) msg.data = m.data;
  return msg;
}

/** NDJSON line splitter; tolerates lines split mid-UTF-8 (setEncoding keeps multi-byte chars whole). */
export function ndjson(stream: Readable, onMsg: (m: Record<string, unknown>) => void): void {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (d: string) => {
    buf += d;
    for (let i; (i = buf.indexOf('\n')) >= 0;) {
      const l = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!l.trim()) continue;
      let m: unknown;
      try {
        m = JSON.parse(l);
      } catch {
        continue;
      }
      if (isRecord(m)) onMsg(m);
    }
  });
}

export class HerdrClient {
  session: string;
  isDefault: boolean;
  clock: Clock;
  readOnly: boolean;
  instanceId: string | null;
  stateTag: string | null;
  log: Logger;
  socket: string;
  bin: string;
  timeoutMs: number;
  onSpawn: HerdrClientOptions['onSpawn'] | null;
  /** protocol reported by the last successful ping (null = never pinged) */
  protocol: number | null;
  version: string | null;
  pinged: boolean;
  /** one-shot control tokens */
  _tokens: Map<string, { paneId: string; at: number }>;
  _seq: number;
  /** metrics */
  stats: { requests: number; subscriptions: number; children: { observe: number; control: number } };

  /**
   * `isDefault`: from resolve.ts isDefaultTarget (realpath, incl. the socket override); app.ts always passes it; the
   * fallback (name or socket realpath) keeps a bare construction safe.
   */
  constructor(o: HerdrClientOptions) {
    this.session = o.session || 'default';
    this.isDefault = o.isDefault ?? isDefaultTarget(this.session, o.socket ?? null);
    this.clock = o.clock;
    this.readOnly = !!o.readOnly;
    this.instanceId = o.instanceId ?? null;
    this.stateTag = o.stateTag ?? null;
    this.log = o.log ?? quietLog;
    this.socket = o.socket ?? socketFor(this.session);
    this.bin = o.bin ?? herdrBin();
    this.timeoutMs = o.timeoutMs ?? 10_000;
    this.onSpawn = o.onSpawn ?? null;
    this.protocol = null;
    this.version = null;
    this.pinged = false;
    this._tokens = new Map();
    this._seq = 0;
    this.stats = { requests: 0, subscriptions: 0, children: { observe: 0, control: 0 } };
  }

  /** Throws `method_denied` / `readonly_protocol` / `mutations_disabled` unless `method` may run. */
  gate(method: string): MethodClass {
    const cls = classifyMethod(method);
    if (cls === 'never') throw denied('method_denied', `herdr method ${method} is never allowed`);
    if (cls === 'read') return cls;
    if (this.readOnly) throw denied(ERR.READONLY_PROTOCOL, `herdr protocol ${this.protocol} ≠ ${HERDR_PROTOCOL}: read-only`);
    if (cls === 'structural' && this.isDefault) {
      throw denied(ERR.MUTATIONS_DISABLED, `${method} is never allowed in the default session (use a named session)`);
    }
    return cls;
  }

  /**
   * One request per connection. Errors: first line on the connection (the error id may be "").
   */
  request(method: string, params: Record<string, unknown> = {}, { timeoutMs = this.timeoutMs }: { timeoutMs?: number } = {}): Promise<unknown> {
    try {
      this.gate(method);
    } catch (e) {
      return Promise.reject(e);
    }
    return this._raw(method, params, timeoutMs);
  }

  /** No gate: only for request() and ping(). */
  _raw(method: string, params: Record<string, unknown> | null, timeoutMs: number): Promise<unknown> {
    this.stats.requests++;
    return new Promise<unknown>((resolve, reject) => {
      const id = `hq_${++this._seq}`;
      const s = net.createConnection(this.socket);
      let settled = false;
      const done = (err: Error | null, val?: unknown): void => {
        if (settled) return;
        settled = true;
        this.clock.clearTimeout(t);
        s.destroy();
        if (err) reject(err);
        else resolve(val);
      };
      const t = this.clock.setTimeout(() => done(denied('timeout', `herdr ${method}: timeout`)), timeoutMs);
      s.on('error', (e: NodeJS.ErrnoException) => done(Object.assign(e, { code: e.code ?? 'socket_error' })));
      s.on('close', () => done(denied('closed', `herdr ${method}: closed without reply`)));
      s.on('connect', () => s.write(JSON.stringify({ id, method, params: params ?? {} }) + '\n'));
      ndjson(s, (raw) => {
        const m = toWireMsg(raw);
        if (m.error) done(errOf(m));
        else done(null, m.result);
      });
    });
  }

  /** `ping` → protocol check; sets `readOnly` on a mismatch. Must succeed before any child spawns. */
  async ping(): Promise<unknown> {
    const r = await this._raw('ping', {}, 3000);
    const rec = isRecord(r) ? r : null;
    // herdr's ping reply: {protocol: number, version: string}; a wrong type falls back like an absent field
    this.protocol = typeof rec?.protocol === 'number' ? rec.protocol : null;
    this.version = typeof rec?.version === 'string' ? rec.version : null;
    this.readOnly = this.protocol !== HERDR_PROTOCOL;
    this.pinged = true;
    return r;
  }

  /**
   * Long-lived subscription. Resolves after `subscription_started` with `{close()}`; `onEvent({event, data})`,
   * `onClose()` once when the connection ends after it started.
   */
  subscribe(subscriptions: Subscription[], onEvent: (m: HerdrEvent) => void, onClose?: () => void): Promise<SubscriptionHandle> {
    return new Promise<SubscriptionHandle>((resolve, reject) => {
      const s = net.createConnection(this.socket);
      let started = false, closed = false;
      const handle: SubscriptionHandle = {
        close: () => {
          closed = true;
          s.destroy();
        },
      };
      const t = this.clock.setTimeout(() => {
        if (!started) {
          s.destroy();
          reject(denied('timeout', 'herdr events.subscribe: timeout'));
        }
      }, this.timeoutMs);
      s.on('error', (e) => {
        if (!started) {
          this.clock.clearTimeout(t);
          reject(e);
        }
      });
      s.on('close', () => {
        if (!started) {
          this.clock.clearTimeout(t);
          return reject(denied('closed', 'herdr events.subscribe: closed'));
        }
        this.stats.subscriptions--;
        if (!closed) onClose?.();
      });
      s.on('connect', () => s.write(JSON.stringify({ id: 'sub', method: 'events.subscribe', params: { subscriptions } }) + '\n'));
      ndjson(s, (raw) => {
        const m = toWireMsg(raw);
        if (!started) {
          this.clock.clearTimeout(t);
          if (m.error) {
            s.destroy();
            return reject(errOf(m));
          }
          started = true;
          this.stats.subscriptions++;
          return resolve(handle);
        }
        onEvent(m);
      });
    });
  }

  /** Mint a one-shot control token (TerminalHub, on `term.promote` only). */
  mintPromoteToken(paneId: string): string {
    const tok = crypto.randomBytes(12).toString('hex');
    const now = this.clock.now();
    for (const [k, t] of this._tokens) if (now - t.at > PROMOTE_TOKEN_MS) this._tokens.delete(k); // prune unused, expired
    this._tokens.set(tok, { paneId, at: now });
    return tok;
  }

  /**
   * Spawn `herdr --session S terminal session {observe|control} <pane> --cols C --rows R [--takeover]`.
   * observe = READ; control needs a fresh promoteToken minted for this pane (consumed here).
   */
  spawnTerm({ mode, paneId, cols, rows, takeover = false, promoteToken }: SpawnTermOpts): ChildProcess {
    if (!this.pinged) throw denied('not_pinged', 'no herdr child before a successful ping');
    if (mode === 'control') {
      if (this.readOnly) throw denied(ERR.READONLY_PROTOCOL, 'read-only: no control children');
      const t = promoteToken ? this._tokens.get(promoteToken) : null;
      if (promoteToken) this._tokens.delete(promoteToken);
      if (!t || t.paneId !== paneId || this.clock.now() - t.at > PROMOTE_TOKEN_MS) throw denied('method_denied', 'control spawn needs a promote token');
    } else if (mode !== 'observe') throw denied('method_denied', `terminal mode ${mode}`);
    if (!/^[^\s-][^\s]*$/.test(paneId)) throw denied('method_denied', 'bad pane id');
    const args = ['--session', this.session, 'terminal', 'session', mode, paneId, '--cols', String(cols), '--rows', String(rows),
      ...(takeover && mode === 'control' ? ['--takeover'] : [])];
    const child = spawn(this.bin, args, {
      env: childEnv({ instanceId: this.instanceId, session: this.session, stateTag: this.stateTag }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.stats.children[mode]++;
    let counted = true;
    const uncount = () => {
      if (counted) this.stats.children[mode]--;
      counted = false;
    };
    child.once('exit', uncount);
    child.once('error', uncount);
    this.onSpawn?.(child, { mode, paneId });
    return child;
  }
}
