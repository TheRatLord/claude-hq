/**
 * The ONE WebSocket. Only store.ts uses this module.
 * - URL: same-origin `/ws?cid=…[&t=…]`; `cid` is random per tab (sessionStorage) for the terminal grace resume.
 * - Token: `?t=` is removed from the location at boot, kept in memory + sessionStorage (dev proxy path). Web mode
 *   also has the HttpOnly cookie, which the upgrade accepts.
 * - Reconnect: exponential backoff 0.5 s → 10 s with jitter; reset after a connection that lasted ≥ 5 s. While
 *   waiting, a cheap `/healthz` probe (1 s) short-circuits the backoff as soon as the backend is back, and so do the
 *   tab becoming visible and the browser coming `online` (a restarted backend is picked up within ≈ 1 s).
 */

import { isRecord } from '../../../shared/guards.ts';

const TOKEN_KEY = 'hq.token';
const CID_KEY = 'hq.cid';

const ss = {
  get(k: string): string | null { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string): void { try { sessionStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

/** Take the token out of the URL (keeps every other param). Returns the token to use (URL > sessionStorage > null). */
export function adoptToken(fromUrl: string | null): string | null {
  if (fromUrl) {
    ss.set(TOKEN_KEY, fromUrl);
    try {
      const u = new URL(location.href);
      u.searchParams.delete('t');
      history.replaceState(history.state, '', u.pathname + (u.search ? u.search : '') + u.hash);
    } catch { /* non-browser */ }
    return fromUrl;
  }
  return ss.get(TOKEN_KEY);
}

/** stable per-tab client id */
export function clientId(): string {
  let cid = ss.get(CID_KEY);
  if (!cid) {
    const b = new Uint8Array(12);
    crypto.getRandomValues(b);
    cid = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    ss.set(CID_KEY, cid);
  }
  return cid;
}

export interface SocketHandlers {
  onOpen?(): void;
  onText(text: string): void;
  onBinary(buf: ArrayBuffer): void;
  onClose?(info: { code: number; reason: string; retryInMs: number | null }): void;
}

export interface HqSocket {
  /** false when not open (caller decides whether to queue) */
  send(data: string | Uint8Array<ArrayBuffer>): boolean;
  isOpen(): boolean;
  bufferedAmount(): number;
  /** reconnect:false stops for good (protocol mismatch) */
  close(opts?: { reconnect?: boolean }): void;
  reconnectNow(): void;
}

export function createSocket({ token, cid, handlers, url }: { token: string | null; cid: string; handlers: SocketHandlers; url?: string }): HqSocket {
  const base = url || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
  const q = new URLSearchParams({ cid });
  if (token) q.set('t', token);
  const full = `${base}${base.includes('?') ? '&' : '?'}${q}`;

  let ws: WebSocket | null = null;
  let stopped = false;
  let delay = 500;
  let openedAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let probe: ReturnType<typeof setTimeout> | null = null;
  const HEALTH_URL = url ? null : `${location.protocol}//${location.host}/healthz`;

  const stopProbe = () => { if (probe) { clearTimeout(probe); probe = null; } };
  const startProbe = () => {
    if (!HEALTH_URL || probe || stopped) return;
    const tick = async () => {
      probe = null;
      if (stopped || !timer) return;
      let up = false;
      try {
        const r = await fetch(HEALTH_URL, { cache: 'no-store', signal: AbortSignal.timeout(900) });
        const body: unknown = await r.json();
        up = r.ok && isRecord(body) && body.ok === true;
      } catch { /* still down */ }
      if (up) reconnectNow();
      else if (timer && !stopped) probe = setTimeout(tick, 1000);
    };
    probe = setTimeout(tick, 1000);
  };
  const reconnectNow = () => {
    if (stopped || !timer) return;
    clearTimeout(timer);
    stopProbe();
    connect();
  };
  const onWake = () => { if (typeof document === 'undefined' || !document.hidden) reconnectNow(); };
  if (typeof addEventListener === 'function') addEventListener('online', onWake);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onWake);

  const connect = () => {
    timer = null;
    stopProbe();
    if (stopped) return;
    ws = new WebSocket(full);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => { openedAt = performance.now(); handlers.onOpen?.(); };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') handlers.onText(ev.data);
      else handlers.onBinary(ev.data); // binaryType 'arraybuffer' (set above)
    };
    ws.onclose = (ev) => {
      ws = null;
      if (openedAt && performance.now() - openedAt >= 5000) delay = 500;
      openedAt = 0;
      let retryInMs: number | null = null;
      if (!stopped) {
        retryInMs = Math.round(delay * (0.8 + Math.random() * 0.4));
        delay = Math.min(10_000, delay * 2);
        timer = setTimeout(connect, retryInMs);
        if (retryInMs >= 1500) startProbe();
      }
      handlers.onClose?.({ code: ev.code, reason: ev.reason, retryInMs });
    };
    ws.onerror = () => { /* onclose follows */ };
  };
  connect();

  return {
    send(data) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      ws.send(data);
      return true;
    },
    isOpen: () => !!ws && ws.readyState === WebSocket.OPEN,
    bufferedAmount: () => (ws ? ws.bufferedAmount : 0),
    close({ reconnect = true } = {}) {
      if (!reconnect) { stopped = true; if (timer) clearTimeout(timer); timer = null; stopProbe(); }
      ws?.close();
    },
    reconnectNow,
  };
}
