import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { hostOk, originOk, hostnameOf, parseCookies, cspFor } from './http.ts';
import { startApp, TOKEN } from './test/harness.ts';
import type { DemoApp } from './test/harness.ts';
import { AuditLog } from './audit.ts';
import { FakeClock } from './clock.ts';

test('host / origin predicates', () => {
  for (const h of ['127.0.0.1:7462', 'localhost', 'LOCALHOST:1', '[::1]:7462']) assert.ok(hostOk(h), h);
  for (const h of ['evil.com', '127.0.0.2:7462', '', undefined, 'localhost.evil.com', '[::2]:1']) assert.ok(!hostOk(h), String(h));
  assert.equal(hostnameOf('[::1]:80'), '[::1]');
  const ports = [7462, 7461];
  for (const o of ['http://127.0.0.1:7461', 'http://localhost:7462', 'http://[::1]:7462']) assert.ok(originOk(o, ports), o);
  for (const o of ['null', 'http://evil.com', 'file://', undefined, 'ws://127.0.0.1:7462', 'http://127.0.0.1.evil.com:7462',
    'http://localhost:3000', 'http://127.0.0.1:8000', 'http://127.0.0.1', 'https://localhost:7463']) assert.ok(!originOk(o, ports), String(o));
  assert.ok(!originOk('http://127.0.0.1:7462'), 'no ports → nothing allowed');
  assert.ok(originOk('http://127.0.0.1', [80]), 'implicit :80');
  assert.deepEqual(parseCookies('a=1; hq_token=x%20y'), { a: '1', hq_token: 'x y' });
});

let app: DemoApp, dist: string;
before(async () => {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-dist-'));
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>hq</title>');
  fs.writeFileSync(path.join(dist, 'assets', 'main-AbCd1234.js'), 'console.log(1)');
  app = await startApp({ distDir: dist, metrics: true });
});
after(async () => {
  await app.close();
  fs.rmSync(dist, { recursive: true, force: true });
});

interface Res { status: number | undefined; headers: http.IncomingHttpHeaders; body: string }

function get(p: string, headers: http.OutgoingHttpHeaders = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: app.port, path: p, headers: { host: `127.0.0.1:${app.port}`, ...headers } }, (res) => {
      let body = '';
      res.on('data', (d: Buffer) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
  });
}
const cookie = `hq_token=${TOKEN}`;

test('/healthz is open and reports instance + session', async () => {
  const r = await get('/healthz');
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body) as { instanceId: string; session: string; protocol: number };
  assert.deepEqual([j.instanceId, j.session, j.protocol], [app.instanceId, 'demo', 1]);
});

test('Host check applies to every request', async () => {
  assert.equal((await get('/healthz', { host: 'evil.example' })).status, 403);
});

test('?t=TOKEN sets an HttpOnly SameSite=Strict cookie and redirects without the token', async () => {
  const r = await get(`/?pose=desk&t=${TOKEN}`);
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, '/?pose=desk');
  assert.match(r.headers['set-cookie']?.[0] ?? '', new RegExp(`^hq_token=${TOKEN}; HttpOnly; SameSite=Strict; Path=/`));
  assert.equal((await get('/?t=nope')).status, 403);
});

test('static: index needs the cookie, is no-store and carries the CSP; hashed assets are immutable', async () => {
  assert.equal((await get('/')).status, 401);
  const r = await get('/', { cookie });
  assert.equal(r.status, 200);
  assert.equal(r.headers['cache-control'], 'no-store');
  const csp = String(r.headers['content-security-policy']);
  assert.equal(csp, cspFor(app.port));
  assert.match(csp, new RegExp(`connect-src 'self' ws://localhost:${app.port} ws://127\\.0\\.0\\.1:${app.port}`));
  assert.doesNotMatch(csp, /:\*/, 'connect-src names our own port, never a wildcard');
  assert.match(String(r.headers['content-type']), /text\/html/);
  const a = await get('/assets/main-AbCd1234.js');
  assert.equal(a.status, 200);
  assert.match(String(a.headers['cache-control']), /immutable/);
  assert.match(String(a.headers['content-type']), /javascript/);
  assert.equal((await get('/assets/missing.js')).status, 404);
  assert.notEqual((await get('/%2e%2e/%2e%2e/etc/passwd')).status, 200);
  assert.notEqual((await get('/../package.json')).status, 200);
});

test('/debug/metrics needs --metrics and the token', async () => {
  assert.equal((await get('/debug/metrics')).status, 401);
  const r = await get('/debug/metrics', { cookie });
  assert.equal(r.status, 200);
  const m = JSON.parse(r.body) as { world: { entities: number }; terminals: { children: { observe: number } }; enrichers: { blocked: { pollers: number } } };
  assert.equal(m.world.entities, 12);
  assert.equal(typeof m.terminals.children.observe, 'number');
  assert.equal(typeof m.enrichers.blocked.pollers, 'number');
});

test('no dist → 503 hint; --dev → 404 hint', async () => {
  const a2 = await startApp({ distDir: path.join(dist, 'nope') });
  const a3 = await startApp({ dev: true });
  const req = (port: number, p: string): Promise<number | undefined> => new Promise((resolve) => http.get({ host: '127.0.0.1', port, path: p, headers: { cookie } }, (res) => resolve(res.statusCode)).end());
  assert.equal(await req(a2.port, '/'), 503);
  assert.equal(await req(a3.port, '/'), 404);
  await a2.close();
  await a3.close();
});

test('GET /api/audit: token/cookie auth, newest last, metadata only; survives rotation', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-audit-'));
  try {
    const a = new AuditLog({ dir, session: 's', clock: new FakeClock(), rotateBytes: 2000 });
    for (let i = 0; i < 40; i++) a.record({ cid: 'c', action: 'prompt', paneId: `w1:p${i}`, ok: i % 2 === 0, error: i % 2 ? 'agent_blocked' : undefined });
    assert.ok(fs.existsSync(path.join(dir, 'audit.1.ndjson')), 'rotated');
    const cur = path.join(dir, 'audit.ndjson');
    assert.ok(!fs.existsSync(cur) || fs.statSync(cur).size <= 2000 + 200, 'current file stays under the rotation size');
    const r = a.read(15); // current + rotated file together hold ≥ one rotation's worth (~18 entries here)
    assert.equal(r.length, 15);
    assert.deepEqual(r.map((e) => e.paneId), Array.from({ length: 15 }, (_, i) => `w1:p${25 + i}`), 'contiguous across the rotation, newest last');
    assert.equal(r.at(-1)?.paneId, 'w1:p39');
    assert.deepEqual(Object.keys(r.at(-1) ?? {}).sort(), ['action', 'at', 'cid', 'error', 'ok', 'paneId', 'session']);
    // a fresh log (restart) still serves the history from disk
    assert.equal(new AuditLog({ dir, session: 's', clock: new FakeClock() }).read(5).at(-1)?.paneId, 'w1:p39');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const app = await startApp();
  try {
    const base = `http://127.0.0.1:${app.port}/api/audit`;
    assert.equal((await fetch(base)).status, 401);
    app.audit.record({ cid: 'x', action: 'focus', paneId: 'd1:p1', ok: true });
    const res = await fetch(`${base}?n=5`, { headers: { cookie: `hq_token=${TOKEN}` } });
    assert.equal(res.status, 200);
    const j = await res.json() as { entries: { action: string }[] };
    assert.equal(j.entries.at(-1)?.action, 'focus');
  } finally {
    await app.close();
  }
});
