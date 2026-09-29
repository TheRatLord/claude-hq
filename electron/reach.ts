/**
 * Electron "reach" (M3.5, ideation #7): what the tray, the dock/launcher badge and OS notifications say. Pure logic +
 * the two feeds, NO electron import (so `node --test` runs it). electron/main.ts does the wiring. Owner: BE.
 *
 *   BlockedTracker   entity/gone/world messages → {count, blocked:[{id,name,question}]} + the ids that BECAME blocked
 *                    (the first snapshot seeds silently: nothing "became" blocked on boot)
 *   modelFeed(model) in-process: the WorldModel's own 'msg' stream (never the renderer)
 *   wsFeed(url)      attach mode (another process owns the backend): one read-only WS client (hello.ack, then only
 *                    listens; never sends an action). Reconnects every 3 s; errors are silent.
 *   trayText / notifyText / deepLink   the exact strings.
 *   parseHotkey      config.json `electron.hotkey` → an Electron accelerator (default Ctrl+Alt+H), or null = off.
 */
import { EventEmitter } from 'node:events';
import type WebSocket from 'ws';
import { isRecord } from '../shared/guards.ts';
import type { Rgb } from '../shared/palette.ts';
import type { Entity, GoneMsg, ServerMsgType, WorldMsg } from '../shared/protocol.ts';

export const DEFAULT_HOTKEY = 'Control+Alt+H';
/** A pane that re-blocks within this window does not notify again. */
export const NOTIFY_RATE_MS = 60_000;
/** Blocked bursts (several agents at once) merge into one notification. */
export const NOTIFY_MERGE_MS = 400;

/** One blocked agent as the tray / notifications show it. */
export interface BlockedRow { id: string; name: string; question: string | null }

/** The slice of an Entity the tracker reads (a full Entity fits; tests pass partial ones). */
export interface ReachEntity { id: string; status?: Entity['status']; name?: string; prompt?: { question?: string } | null }

/** The ServerMsg variants the tracker reads; every other variant is ignored (`Other`). */
export type ReachMsg =
  | { t: WorldMsg['t']; entities?: ReachEntity[] }
  | { t: 'entity'; entity?: ReachEntity }
  | { t: GoneMsg['t']; id: string; reason?: string; newId?: string }
  | { t: Exclude<ServerMsgType, 'world' | 'entity' | 'gone'> };

/** What 'change' listeners receive. */
export interface BlockedChange { count: number; became: string[] }

/** The slice of the backend's WorldModel the in-process feed uses. */
export interface ReachModel {
  worldMsg(): ReachMsg;
  on(event: 'msg', fn: (m: ReachMsg) => void): unknown;
  off(event: 'msg', fn: (m: ReachMsg) => void): unknown;
}

export interface ReachFeed { tracker: BlockedTracker; close: () => void }

export class BlockedTracker extends EventEmitter {
  blocked: Map<string, BlockedRow>;
  seeded: boolean;
  /** new ids of re-keyed panes that were blocked under their old id */
  rekeyed: Set<string>;
  constructor() {
    super();
    this.blocked = new Map();
    this.seeded = false;
    this.rekeyed = new Set();
  }
  get count() {
    return this.blocked.size;
  }
  list() {
    return [...this.blocked.values()];
  }
  /** @param m a ServerMsg (world / entity / gone); anything else is ignored */
  onMsg(m: ReachMsg) {
    if (!m || typeof m !== 'object') return;
    const before = this.blocked.size;
    const became: string[] = [];
    let changed = false;
    if (m.t === 'world') {
      const next = new Map<string, BlockedRow>();
      for (const e of m.entities ?? []) if (e?.status === 'blocked') next.set(e.id, row(e));
      if (this.seeded) for (const id of next.keys()) if (!this.blocked.has(id)) became.push(id);
      changed = !sameKeys(next, this.blocked);
      this.blocked = next;
      this.seeded = true;
    } else if (m.t === 'entity' && m.entity) {
      const e = m.entity;
      const was = this.blocked.has(e.id);
      if (e.status === 'blocked') {
        this.blocked.set(e.id, row(e));
        if (!was) {
          changed = true;
          if (this.seeded && !this.rekeyed.has(e.id)) became.push(e.id);
        }
        this.rekeyed.delete(e.id);
      } else if (was) {
        this.blocked.delete(e.id);
        changed = true;
      }
    } else if (m.t === 'gone') {
      // a rekey's new id arrives as an entity of its own: if the old one was blocked, that is not a NEW block
      if (this.blocked.delete(m.id)) {
        changed = true;
        if (m.reason === 'rekeyed' && m.newId) this.rekeyed.add(m.newId);
      }
    } else return;
    if (changed || became.length || before !== this.blocked.size) this.emit('change', { count: this.count, became } satisfies BlockedChange);
  }
}

const row = (e: ReachEntity): BlockedRow => ({ id: e.id, name: String(e.name ?? e.id), question: e.prompt?.question ? String(e.prompt.question) : null });
const sameKeys = (a: Map<string, unknown>, b: Map<string, unknown>) => a.size === b.size && [...a.keys()].every((k) => b.has(k));

/** In-process feed: the backend's WorldModel (server/world/model.ts) — seeded from worldMsg(), then its 'msg' events. */
export function modelFeed(model: ReachModel, tracker = new BlockedTracker()): ReachFeed {
  tracker.onMsg(model.worldMsg());
  const on = (m: ReachMsg) => tracker.onMsg(m);
  model.on('msg', on);
  return { tracker, close: () => model.off('msg', on) };
}

/** `WebSocketImpl` = the `ws` package's class; the timer functions are injectable. */
export interface WsFeedOptions {
  port: number;
  token: string;
  WebSocketImpl: typeof WebSocket;
  protocol: number;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
}
/** Attach-mode feed: a listen-only WS client to a backend in another process. */
export function wsFeed({ port, token, WebSocketImpl, protocol, setTimeout: st = setTimeout, clearTimeout: ct = clearTimeout }: WsFeedOptions,
  tracker = new BlockedTracker()): ReachFeed {
  let ws: WebSocket | undefined, timer: ReturnType<typeof setTimeout> | undefined, closed = false;
  const connect = () => {
    if (closed) return;
    try {
      ws = new WebSocketImpl(`ws://127.0.0.1:${port}/ws?t=${token}&cid=electron-reach`, { origin: `http://127.0.0.1:${port}` });
    } catch {
      return retry();
    }
    const sock = ws;
    sock.on('message', (d, bin) => {
      if (bin) return;
      let m: unknown;
      try {
        m = JSON.parse(String(d));
      } catch {
        return;
      }
      // the original read `m.t` off any parsed JSON (a bare `null` threw inside the ws handler); now non-objects are ignored
      if (!isRecord(m)) return;
      if (m.t === 'hello') sock.send(JSON.stringify({ t: 'hello.ack', protocol, rid: 1 }));
      // boundary cast: the read-only feed trusts the backend's frames; onMsg ignores every `t` it does not know
      else tracker.onMsg(m as ReachMsg);
    });
    sock.on('error', () => {});
    sock.on('close', () => retry());
  };
  const retry = () => {
    if (closed || timer) return;
    timer = st(() => {
      timer = undefined;
      tracker.seeded = false; // a reconnect's world must not look like a burst of new blocks
      connect();
    }, 3000);
  };
  connect();
  return { tracker, close: () => {
    closed = true;
    ct(timer);
    try {
      ws?.close();
    } catch {}
  } };
}

/** Tray tooltip / title for a blocked count. */
export function trayText(count: number, session?: string) {
  const where = session && session !== 'default' ? ` · ${session}` : '';
  return {
    tooltip: count ? `Claude HQ${where} — ${count} blocked (needs you)` : `Claude HQ${where} — nobody blocked`,
    title: count ? String(count) : '',
  };
}

/** Notification for the agents that just became blocked (one or a merged burst). */
export function notifyText(rows: Pick<BlockedRow, 'name' | 'question'>[]) {
  if (rows.length === 1) return { title: `${rows[0].name} is blocked`, body: rows[0].question || 'needs you', link: deepLink(rows[0].name) };
  return { title: `${rows.length} agents are blocked`, body: rows.map((r) => r.name).join(', '), link: 'inbox' };
}

/** `?open=` value for the Blocked Inbox, optionally focused on one agent (UI resolves `inbox:<name>`). */
export const deepLink = (name: string | null) => (name ? `inbox:${name}` : 'inbox');

/**
 * config.json → accelerator. `{"electron": {"hotkey": "Control+Alt+H"}}`; `false`/`""`/`"off"` disables it.
 * Only plain accelerator characters are accepted (modifiers + one key), else the default.
 * @param cfg parsed config.json (untrusted)
 */
export function parseHotkey(cfg: unknown): string | null {
  const electron = isRecord(cfg) ? cfg.electron : undefined;
  const v = isRecord(electron) ? electron.hotkey : undefined;
  if (v === false || v === '' || v === 'off' || v === null) return null;
  if (typeof v !== 'string') return DEFAULT_HOTKEY;
  const parts = v.split('+').map((s) => s.trim()).filter(Boolean);
  if (!parts.length || parts.length > 5 || !parts.every((p) => /^[A-Za-z0-9]{1,16}$|^F\d{1,2}$|^[`\-=[\];',./\\]$/.test(p))) return DEFAULT_HOTKEY;
  return parts.join('+');
}

/**
 * The tray icon: a 32×32 clay-orange rounded square with a white "window" and, when anyone is blocked, a red dot.
 * Raw BGRA for nativeImage.createFromBitmap (no image files: "no external assets").
 */
export function trayBitmap(alert: boolean, size = 32): Buffer {
  const buf = Buffer.alloc(size * size * 4);
  const put = (x: number, y: number, [r, g, b]: Rgb, a = 255) => {
    const i = (y * size + x) * 4;
    buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = a;
  };
  const s = size / 32;
  const clay: Rgb = [217, 119, 87], white: Rgb = [250, 246, 240], dark: Rgb = [60, 44, 40], red: Rgb = [226, 62, 62];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = Math.max(0, Math.abs(x + 0.5 - size / 2) - 11 * s), cy = Math.max(0, Math.abs(y + 0.5 - size / 2) - 11 * s);
      const d = Math.hypot(cx, cy);
      if (d > 4 * s) continue;
      const a = d > 3 * s ? Math.round(255 * (4 * s - d) / s) : 255;
      let c: Rgb = clay;
      const inScreen = x >= 8 * s && x < 24 * s && y >= 9 * s && y < 21 * s;
      if (inScreen) c = (y >= 11 * s && y < 13 * s && x >= 10 * s && x < 18 * s) || (y >= 15 * s && y < 17 * s && x >= 10 * s && x < 15 * s) ? dark : white;
      put(x, y, c, a);
    }
  }
  if (alert) {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - 25 * s, y + 0.5 - 7 * s);
      if (d <= 6.5 * s) put(x, y, d > 5.2 * s ? white : red);
    }
  }
  return buf;
}
