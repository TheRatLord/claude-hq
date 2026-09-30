/**
 * HTTP server (DESIGN §4.11): loopback-only Host check, token → HttpOnly cookie, static `dist/` with CSP,
 * `/healthz`, `/debug/metrics` (--metrics/--dev, token auth), `/api/audit` (token auth), WS upgrade gate (path, Host, Origin, token).
 * Owner: BE. No compression or range requests: loopback only, hashed assets are served immutable.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { WS_PATH, PROTOCOL_VERSION } from '../shared/protocol.ts';
import type { WsHub } from './ws.ts';
import type { Logger } from './interfaces.ts';

export const CSP = "default-src 'self'; connect-src 'self' ws://localhost:* ws://127.0.0.1:*; img-src 'self' data: blob:; " +
  "style-src 'self' 'unsafe-inline'; worker-src 'self' blob:";
/**
 * The served CSP: connect-src narrowed to this server's own port (the only WS origin ws.ts accepts anyway), so a page
 * can never open a socket to another local service. `port` unknown → the §4.11 wildcard form above.
 */
// [INT M2, cross-owner BE] no `ws://[::1]:port`: CSP host-sources cannot be IPv6 literals (Chromium logs a console error
// "contains an invalid source" on every production load); a page served from [::1] is covered by 'self' (CSP3 ws match)
export const cspFor = (port: number | null | undefined): string => (port ? CSP.replace('ws://localhost:* ws://127.0.0.1:*', `ws://localhost:${port} ws://127.0.0.1:${port}`) : CSP);

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.ktx2': 'image/ktx2',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8',
};

/** hostname part of a Host header value ("127.0.0.1:7462", "[::1]:7462", "localhost"). */
export function hostnameOf(host: unknown): string | null {
  if (typeof host !== 'string' || !host) return null;
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end > 0 ? host.slice(0, end + 1).toLowerCase() : null;
  }
  return host.split(':')[0].toLowerCase();
}
/** Host header must name loopback (the port is ignored). */
export const hostOk = (host: unknown): boolean => LOOPBACK.has(hostnameOf(host) ?? '');
/**
 * WS Origin is required and must be a loopback http(s) origin on one of `ports` — this server's own listen port (plus
 * the vite port in --dev). Any loopback port is NOT enough: the hq_token cookie is SameSite=Strict, and "site" ignores
 * the port, so a page from some other local server (python -m http.server, another project's dev server) would carry
 * the cookie and could otherwise drive term.* / agent.* (§4.11).
 */
export function originOk(origin: unknown, ports?: Iterable<number> | null): boolean {
  if (typeof origin !== 'string') return false;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !LOOPBACK.has(u.hostname.toLowerCase())) return false;
  const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
  for (const p of ports ?? []) if (Number(p) === port) return true;
  return false;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const tokenEq = (a: unknown, b: unknown): boolean => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

export interface HttpServerOpts {
  token: string;
  distDir: string;
  dev: boolean;
  /** dev only: the one extra port whose pages may open the WS (vite proxies /ws with changeOrigin:false) */
  vitePort?: number | null;
  metrics: boolean;
  instanceId: string;
  session: string;
  /** false, or the number of demo panes (reported by /healthz) */
  demo: number | false;
  wsHub: Pick<WsHub, 'handleUpgrade'>;
  metricsFn?: () => object;
  auditFn?: (n: number) => object[];
  log?: Logger;
}

type Send = (code: number, body: string | undefined, headers?: http.OutgoingHttpHeaders) => void;

export function createHttpServer(o: HttpServerOpts): http.Server {
  const authed = (req: http.IncomingMessage, url: URL): boolean => tokenEq(url.searchParams.get('t'), o.token) || tokenEq(parseCookies(req.headers.cookie).hq_token, o.token);

  // Origin ports: our own listen port (read lazily: tests listen on port 0) + the vite port in --dev only.
  const originPorts = () => {
    const addr = server.address(); // a TCP server: an AddressInfo once listening (a string only for pipes)
    const own = addr && typeof addr === 'object' ? addr.port : undefined;
    return [own, ...(o.dev && o.vitePort ? [o.vitePort] : [])].filter((p): p is number => !!p);
  };

  const server = http.createServer((req, res) => {
    const base = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': cspFor(req.socket.localPort) };
    const send: Send = (code, body, headers = {}) => {
      res.writeHead(code, { ...base, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
      res.end(body);
    };
    if (!hostOk(req.headers.host)) return send(403, 'forbidden host\n');
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'method not allowed\n', { Allow: 'GET, HEAD' });
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://127.0.0.1');
    } catch {
      return send(400, 'bad url\n');
    }
    const json = (code: number, obj: unknown) => send(code, JSON.stringify(obj), { 'Content-Type': 'application/json' });

    if (url.pathname === '/healthz') {
      return json(200, { ok: true, instanceId: o.instanceId, session: o.session, protocol: PROTOCOL_VERSION, demo: o.demo });
    }
    if (url.pathname === '/debug/metrics') {
      if (!o.metrics) return send(404, 'not found\n');
      if (!authed(req, url)) return send(401, 'unauthorized\n');
      return json(200, o.metricsFn?.() ?? {});
    }
    // Recent HQ actions (§4.8, §8.5, M3): metadata-only audit entries for this session, newest last. Token/cookie auth.
    if (url.pathname === '/api/audit') {
      if (!authed(req, url)) return send(401, 'unauthorized\n');
      if (!o.auditFn) return send(404, 'not found\n');
      return json(200, { session: o.session, entries: o.auditFn(Number(url.searchParams.get('n') ?? 50)) });
    }
    // `/?t=TOKEN` → cookie, then redirect to strip the token (other params kept).
    if (url.searchParams.has('t')) {
      if (!tokenEq(url.searchParams.get('t'), o.token)) return send(403, 'bad token\n');
      url.searchParams.delete('t');
      const qs = url.searchParams.toString();
      return send(302, '', {
        Location: url.pathname + (qs ? `?${qs}` : ''),
        'Set-Cookie': `hq_token=${o.token}; HttpOnly; SameSite=Strict; Path=/`,
      });
    }
    if (o.dev) return send(404, 'dev mode: serve the frontend separately on the configured --vite-port\n');
    return serveStatic(req, res, url, o, base, send, authed(req, url));
  });

  server.on('upgrade', (req, socket, head) => {
    const deny = (code: number, text: string) => {
      socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://127.0.0.1');
    } catch {
      return deny(400, 'Bad Request');
    }
    if (url.pathname !== WS_PATH) return deny(404, 'Not Found');
    if (!hostOk(req.headers.host)) return deny(403, 'Forbidden');
    if (!originOk(req.headers.origin, originPorts())) return deny(403, 'Forbidden');
    if (!authed(req, url)) return deny(401, 'Unauthorized');
    const cid = (url.searchParams.get('cid') ?? '').slice(0, 64);
    o.wsHub.handleUpgrade(req, socket, head, { cid });
  });
  return server;
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, url: URL, o: HttpServerOpts, base: http.OutgoingHttpHeaders, send: Send, isAuthed: boolean): void {
  let rel: string;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    return send(400, 'bad path\n');
  }
  if (rel.includes('\0')) return send(400, 'bad path\n');
  const root = path.resolve(o.distDir);
  let file = path.resolve(root, '.' + (rel.endsWith('/') ? rel + 'index.html' : rel));
  if (file !== root && !file.startsWith(root + path.sep)) return send(403, 'forbidden\n');
  let st: fs.Stats | null = null;
  try {
    st = fs.statSync(file);
    if (st.isDirectory()) {
      file = path.join(file, 'index.html');
      st = fs.statSync(file);
    }
  } catch {
    st = null;
  }
  const isIndex = path.basename(file) === 'index.html';
  if (!st) {
    if (!fs.existsSync(path.join(root, 'index.html'))) return send(503, 'no frontend bundle: supply one with --dist DIR; backend API remains available\n');
    return send(404, 'not found\n');
  }
  if (isIndex && !isAuthed) {
    return send(401, 'Claude HQ: open the URL the backend printed (it carries the access token).\n');
  }
  const ext = path.extname(file).toLowerCase();
  const immutable = !isIndex && /[.-][A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(path.basename(file)) && rel.startsWith('/assets/');
  res.writeHead(200, {
    ...base,
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': isIndex ? 'no-store' : immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(file).pipe(res);
}
