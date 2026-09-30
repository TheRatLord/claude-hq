/**
 * WsHub: authenticated sockets, `hello` → `hello.ack` handshake, VALIDATE enforcement before
 * routing, invalid-burst and frame-size closes, client cap, rid replies, model broadcasts, term.* → TerminalHub.
 *
 * Handshake: server sends `hello`; the renderer's first message must be `hello.ack {protocol}`; only then does the
 * server send `world` and start broadcasting. Anything before the ack → `reply {ok:false, error:'no_hello_ack'}`.
 *
 * Input paths: binary kind 2 = interactive (no rid, credit-windowed via term.ack; an observe viewer gets one
 * term.state resend). JSON `term.input {id, text, paste:true, rid}` = paste chunk: the reply is sent only after the
 * child's stdin drained; to an observe viewer → `{ok:false, error:'not_controller'}`. The server never auto-promotes.
 * WS drop → TerminalHub keeps the client's viewers for 10 s keyed by `cid` (grace resume on the next term.open).
 */
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import type { RawData, WebSocket } from 'ws';
import {
  PROTOCOL_VERSION, S2R, ERR, CLOSE, LIMITS, DEFAULT_LIMITS,
  parseClientText, decodeFrame, validateBinaryInput, reply, replyError,
} from '../shared/protocol.ts';
import type { ClientMsg, Hello, ServerMsg, Stats } from '../shared/protocol.ts';
import { isRecord, errCode, errMessage } from '../shared/guards.ts';
import { auditAction } from './audit.ts';
import type { AuditLog } from './audit.ts';
import type { Clock, HerdrSource, Logger } from './interfaces.ts';
import type { HubClient, TerminalHub } from './terminals/hub.ts';
import type { WorldModel } from './world/model.ts';
import type { Actions } from './world/actions.ts';
import type { Screens } from './world/screens.ts';

/** One connected renderer socket: the TerminalHub's client plus the handshake / abuse state. */
export interface WsClient extends HubClient {
  /** no cid → no terminal grace resume */
  cid: string | null;
  ws: WebSocket;
  acked: boolean;
  /** timestamps of recent invalid messages */
  invalid: number[];
  /** the pane ids this client watches for `screen` messages */
  watch: string[];
}

/** The non-constant `hello` fields (the rest is added by WsHub). */
export type HelloInfo = Omit<Hello, 't' | 'protocol' | 'serverNow' | 'statsHistory' | 'limits'>;

export interface WsHubOpts {
  model: Pick<WorldModel, 'on' | 'off' | 'worldMsg' | 'has'>;
  hub: TerminalHub;
  actions: Pick<Actions, 'handle' | 'settings'>;
  source: Pick<HerdrSource, 'request'>;
  clock: Clock;
  log?: Logger;
  /** the non-constant hello fields */
  helloInfo: () => HelloInfo;
  screens?: Pick<Screens, 'dropClient'> | null;
  statsHistory?: () => Stats[];
  audit?: AuditLog | null;
}

/** Every message id must name a known entity: the ids a message refers to. */
const idsOf = (msg: ClientMsg): string[] => (msg.t === 'screen.watch' ? msg.ids : 'id' in msg ? [msg.id] : []);

export class WsHub {
  model: WsHubOpts['model'];
  hub: TerminalHub;
  actions: WsHubOpts['actions'];
  source: WsHubOpts['source'];
  clock: Clock;
  log: Logger;
  helloInfo: () => HelloInfo;
  screens: WsHubOpts['screens'];
  statsHistory: () => Stats[];
  audit: AuditLog | null;
  clients: Set<WsClient>;
  wss: WebSocketServer;
  _onModelMsg: (msg: ServerMsg) => void;
  constructor({ model, hub, actions, source, clock, log, helloInfo, screens = null, statsHistory = () => [], audit = null }: WsHubOpts) {
    this.model = model;
    this.hub = hub;
    this.actions = actions;
    this.source = source;
    this.clock = clock;
    this.log = log ?? { debug() {}, info() {}, warn() {}, error() {} };
    this.helloInfo = helloInfo;
    this.screens = screens;
    this.statsHistory = statsHistory;
    this.audit = audit;
    this.clients = new Set();
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 4 * LIMITS.maxTextFrame, perMessageDeflate: false });
    this._onModelMsg = (msg) => this.broadcast(msg);
    model.on('msg', this._onModelMsg);
  }

  /** Called by http.ts after Host/Origin/token checks. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, { cid }: { cid: string }): void {
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      if (this.clients.size >= LIMITS.wsClients) {
        ws.close(CLOSE.TRY_AGAIN_LATER, 'try again later');
        return;
      }
      this._connect(ws, cid);
    });
  }

  _connect(ws: WebSocket, cid: string): void {
    const client: WsClient = {
      cid: cid || null, // no cid → no terminal grace resume
      ws,
      acked: false,
      invalid: [],
      watch: [],
      sendJson: (msg) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
      sendBinary: (u8) => {
        if (ws.readyState === ws.OPEN) ws.send(u8, { binary: true });
      },
      bufferedAmount: () => ws.bufferedAmount,
    };
    this.clients.add(client);
    ws.on('message', (data, isBinary) => {
      this._onMessage(client, data, isBinary).catch((e) => this.log.error('ws message', e));
    });
    ws.on('close', () => {
      this.clients.delete(client);
      this.hub.dropClient(client);
      this.screens?.dropClient(client);
    });
    ws.on('error', (e) => this.log.debug('ws error', e.message));
    client.sendJson({
      t: S2R.HELLO, protocol: PROTOCOL_VERSION, serverNow: this.clock.now(), statsHistory: this.statsHistory(), limits: DEFAULT_LIMITS,
      ...this.helloInfo(),
    });
  }

  /** Send to every acked client. */
  broadcast(msg: ServerMsg): void {
    const text = JSON.stringify(msg);
    for (const c of this.clients) if (c.acked && c.ws.readyState === c.ws.OPEN) c.ws.send(text);
  }

  _invalid(client: WsClient, why: string): void {
    const now = this.clock.now();
    client.invalid = client.invalid.filter((t) => now - t < LIMITS.invalidWindowMs);
    client.invalid.push(now);
    this.log.debug(`invalid message from ${client.cid}: ${why}`);
    if (client.invalid.length > LIMITS.invalidBurst) client.ws.close(CLOSE.POLICY, 'too many invalid messages');
  }

  async _onMessage(client: WsClient, data: RawData, isBinary: boolean): Promise<void> {
    if (isBinary) return this._onBinary(client, data);
    const text = Buffer.isBuffer(data) ? data.toString('utf8') : Array.isArray(data) ? Buffer.concat(data).toString('utf8') : Buffer.from(data).toString('utf8');
    const p = parseClientText(text);
    if (!p.ok) {
      if (p.close) return client.ws.close(CLOSE.POLICY, 'frame too large');
      this._invalid(client, p.why);
      return client.sendJson(replyError(typeof p.rid === 'number' || typeof p.rid === 'string' ? p.rid : null, p.error, { why: p.why }));
    }
    const msg = p.msg;
    const rid = msg.rid ?? null;
    if (!client.acked) {
      if (msg.t !== 'hello.ack') return client.sendJson(replyError(rid, ERR.NO_HELLO_ACK));
      if (msg.protocol !== PROTOCOL_VERSION) return client.sendJson(replyError(rid, ERR.PROTOCOL_MISMATCH, { protocol: PROTOCOL_VERSION }));
      client.acked = true;
      client.sendJson(reply(rid, true));
      client.sendJson(this.model.worldMsg());
      return;
    }
    if (msg.t === 'hello.ack') return client.sendJson(reply(rid, true));
    // every id must name a known entity
    const unknown = idsOf(msg).find((id) => !this.model.has(id));
    if (unknown !== undefined) return client.sendJson(replyError(rid, ERR.UNKNOWN_ENTITY, { id: unknown }));
    const action = this.audit ? auditAction(msg) : null;
    const paneId = 'id' in msg ? msg.id : null;
    try {
      const extra = await this._route(client, msg);
      if (this.audit && action) this.audit.record({ cid: client.cid, action, paneId: paneId ?? (typeof extra?.paneId === 'string' ? extra.paneId : null), ok: true });
      if (extra !== undefined) client.sendJson(reply(rid, true, extra));
    } catch (e) {
      const code = errCode(e);
      if (this.audit && action) this.audit.record({ cid: client.cid, action, paneId, ok: false, error: code ?? ERR.INTERNAL });
      client.sendJson(replyError(rid, code ?? ERR.INTERNAL, { why: errMessage(e), ...(isRecord(e) && isRecord(e.extra) ? e.extra : {}) }));
      if (!code) this.log.error(`${msg.t} failed`, e);
    }
  }

  /** Reply extras; undefined = no reply (interactive input). */
  async _route(client: WsClient, msg: ClientMsg): Promise<Record<string, unknown> | undefined> {
    switch (msg.t) {
      case 'term.open': return this.hub.open(client, msg);
      case 'term.promote': return this.hub.promote(client, msg);
      case 'term.writer': return this.hub.writer(client, msg);
      case 'term.fit': return this.hub.fit(client, msg);
      case 'term.resize': return this.hub.resize(client, msg);
      case 'term.pause': return this.hub.pause(client, msg);
      case 'term.resume': return this.hub.resume(client, msg);
      case 'term.close': return this.hub.close(client, msg);
      case 'term.scroll':
        if (this.actions.settings.scrollMode !== 'herdr') {
          throw Object.assign(new Error('term.scroll needs setting scrollMode:herdr'), { code: ERR.NOT_ACCEPTED });
        }
        return this.hub.scroll(client, msg);
      case 'term.input': {
        // JSON form {id, text, paste?, rid?}: the paste path (reply after stdin drain) and tools/tests.
        const bytes = new TextEncoder().encode(msg.text);
        const r = await this.hub.input(client, msg.id, bytes);
        if (!r.ok) {
          if (!msg.paste && msg.rid === undefined) return void this.hub.resendState(client, msg.id);
          throw Object.assign(new Error('not the controller'), { code: r.error });
        }
        return msg.rid === undefined && !msg.paste ? undefined : {};
      }
      case 'term.history':
      case 'term.copyRecent': {
        const history = msg.t === 'term.history';
        const r = await this.source.request('pane.read', {
          pane_id: msg.id, source: history ? 'recent' : 'recent_unwrapped', format: history ? 'ansi' : 'text', lines: msg.lines,
        });
        if (!isRecord(r) || !isRecord(r.read)) throw new Error('unexpected pane.read reply');
        return history ? { ansi: r.read.text } : { text: r.read.text };
      }
      default:
        return this.actions.handle(client, msg);
    }
  }

  async _onBinary(client: WsClient, data: RawData): Promise<void> {
    if (!client.acked) return this._invalid(client, 'binary before hello.ack');
    const f = decodeFrame(Array.isArray(data) ? Buffer.concat(data) : data);
    if (!f) return this._invalid(client, 'malformed frame');
    const v = validateBinaryInput(f);
    if (!v.ok) return this._invalid(client, v.why);
    if (!this.model.has(f.id)) return this._invalid(client, 'unknown entity');
    const r = await this.hub.input(client, f.id, new Uint8Array(f.payload));
    // Binary frames carry no rid: an observe viewer gets one term.state resend.
    if (!r.ok) this.hub.resendState(client, f.id);
  }

  metrics(): { cid: string | null; acked: boolean; bufferedAmount: number; watch: number }[] {
    return [...this.clients].map((c) => ({ cid: c.cid, acked: c.acked, bufferedAmount: c.ws.bufferedAmount, watch: c.watch.length }));
  }

  async close(): Promise<void> {
    this.model.off('msg', this._onModelMsg);
    for (const c of this.clients) c.ws.terminate();
    this.clients.clear();
    await new Promise<void>((r) => this.wss.close(() => r()));
  }
}
