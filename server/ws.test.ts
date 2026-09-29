import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startApp, connect, sleep, worldOf, helloOf, TOKEN } from './test/harness.ts';
import type { DemoApp, ConnectOpts } from './test/harness.ts';
import { need } from './test/need.ts';
import { isRecord } from '../shared/guards.ts';
import type { TermStateMsg, WorldMsg } from '../shared/protocol.ts';
import { VALIDATE, PROTOCOL_VERSION, DEFAULT_LIMITS, encodeTermInput, LIMITS } from '../shared/protocol.ts';

let app: DemoApp;
before(async () => (app = await startApp()));
after(async () => app.close());

test('hello → hello.ack → world; nothing accepted before the ack; protocol mismatch refused', async () => {
  const c = await connect(app.port, { ack: false });
  const hello = helloOf(c);
  assert.equal(c.msgs[0]?.t, 'hello');
  assert.equal(hello.protocol, PROTOCOL_VERSION);
  assert.deepEqual(hello.limits, { ...DEFAULT_LIMITS });
  assert.equal(hello.demo, 12);
  assert.equal(hello.session, 'demo'); // D8: demo never reports 'default'
  assert.ok(Array.isArray(hello.statsHistory)); // StatsSampler ring (BE2)
  assert.equal(typeof hello.serverNow, 'number');
  assert.equal(hello.herdr.connected, true);
  assert.equal(typeof hello.settings.fov, 'number');
  assert.equal((await c.call({ t: 'world.get' })).error, 'no_hello_ack');
  assert.equal((await c.call({ t: 'hello.ack', protocol: 999 })).error, 'protocol_mismatch');
  assert.ok(!c.msgs.some((m) => m.t === 'world'));
  assert.equal((await c.call({ t: 'hello.ack', protocol: PROTOCOL_VERSION })).ok, true);
  const world = await c.wait<WorldMsg>((m) => m.t === 'world');
  assert.equal(world.entities.length, 12);
  assert.equal(world.workspaces.length, 3);
  const r = await c.call({ t: 'world.get' });
  assert.equal(r.ok, true);
  assert.equal(c.msgs.filter((m) => m.t === 'world').length, 2);
  await c.close();
});

test('VALIDATE: one reject case per row (unknown field) + typed rejects; nothing executed', async () => {
  const keys = Object.keys(VALIDATE);
  for (let i = 0; i < keys.length; i += 15) {
    // a fresh socket per 15 rows: > 20 invalid messages in 10 s closes the socket (tested below)
    const c = await connect(app.port, { cid: `v${i}` });
    for (const t of keys.slice(i, i + 15)) {
      const r = await c.call({ t, bogusField: 1 });
      assert.equal(r.ok, false, t);
      assert.equal(r.error, 'bad_message', t);
    }
    await c.close();
  }
  const d = await connect(app.port, { cid: 'v2' });
  const cases = [
    { t: 'term.open', id: 'd1:p1', cols: 5, rows: 24 },
    { t: 'term.open', id: 'd1:p1', cols: 80, rows: 24, mode: 'control' },
    { t: 'agent.answer', id: 'd2:p1', key: '12345', promptHash: 'ab' },
    { t: 'agent.keys', id: 'd1:p1', keys: new Array(17).fill('a') },
    { t: 'settings.set', patch: { nope: 1 } },
    { t: 'spawn', cwd: 'relative/path' },
    { t: 'nonsense' },
  ];
  for (const m of cases) assert.equal((await d.call(m)).error, 'bad_message', JSON.stringify(m));
  await d.close();
});

test('invalid burst (> 20 in 10 s) closes with 1008', async () => {
  const c = await connect(app.port, { cid: 'burst' });
  for (let i = 0; i < 22; i++) c.send('{not json');
  await c.wait(() => c.closed !== null).catch(() => {});
  for (let i = 0; i < 50 && c.closed === null; i++) await sleep(10);
  assert.equal(c.closed, 1008);
});

test('text frame > 64 KB closes with 1008', async () => {
  const c = await connect(app.port, { cid: 'big' });
  c.send(JSON.stringify({ t: 'world.get', pad: 'x'.repeat(LIMITS.maxTextFrame) }));
  for (let i = 0; i < 100 && c.closed === null; i++) await sleep(10);
  assert.equal(c.closed, 1008);
});

test('unknown entity ids are refused', async () => {
  const c = await connect(app.port, { cid: 'u' });
  assert.equal((await c.call({ t: 'term.open', id: 'w1:p1', cols: 80, rows: 24 })).error, 'unknown_entity');
  assert.equal((await c.call({ t: 'screen.watch', ids: ['d1:p1', 'zz'] })).error, 'unknown_entity');
  assert.equal((await c.call({ t: 'screen.watch', ids: ['d1:p1'] })).ok, true);
  await c.close();
});

test('terminal: observe first, promote, type (binary) with term.ack, second viewer, writer handoff', async () => {
  const id = 'd1:p4';
  const a = await connect(app.port, { cid: 'ta' });
  const open = await a.call({ t: 'term.open', id, cols: 80, rows: 24 });
  assert.deepEqual([open.ok, open.mode, open.cols, open.rows], [true, 'observe', 80, 24]);
  await a.waitFrame((f) => f.id === id && f.full);
  await a.wait<TermStateMsg>((m) => m.t === 'term.state' && m.state === 'live' && m.mode === 'observe' && m.sizer === true);
  // interactive input from an observe viewer: not written, one term.state resend, never auto-promoted
  const nStates = a.msgs.filter((m) => m.t === 'term.state').length;
  a.send(encodeTermInput(id, 'nope\r'));
  await a.wait(() => a.msgs.filter((m) => m.t === 'term.state').length > nStates);
  assert.equal((await a.call({ t: 'term.input', id, text: 'x', paste: true })).error, 'not_controller');
  assert.equal((await a.call({ t: 'term.resize', id, cols: 100, rows: 30 })).error, 'not_controller');
  const pr = await a.call({ t: 'term.promote', id, cols: 80, rows: 24 });
  assert.deepEqual([pr.ok, pr.mode], [true, 'control']);
  await a.wait((m) => m.t === 'term.state' && m.mode === 'control' && m.writer === true);
  a.send(encodeTermInput(id, 'echo zebra\r'));
  await a.wait((m) => m.t === 'term.ack' && m.id === id && m.upTo === 11);
  await a.waitFrame(() => /zebra\r\n/.test(a.text(id).replace(/\x1b\[\?2026[hl]/g, '')));
  assert.doesNotMatch(a.text(id), /nope/);
  // paste path (JSON text form with rid)
  assert.equal((await a.call({ t: 'term.input', id, text: 'echo pasted\r', paste: true })).ok, true);
  // second viewer joins: full frame from the mirror, not the writer
  const b = await connect(app.port, { cid: 'tb' });
  const ob = await b.call({ t: 'term.open', id, cols: 120, rows: 40 });
  assert.equal(ob.mode, 'control');
  const full = await b.waitFrame((f) => f.id === id && f.full);
  assert.match(full.text, /zebra/);
  const st = await b.wait<TermStateMsg>((m) => m.t === 'term.state' && m.id === id);
  assert.deepEqual([st.writer, st.sizer, st.mode], [false, false, 'control']);
  assert.equal((await b.call({ t: 'term.input', id, text: 'x', paste: true })).error, 'not_controller');
  assert.equal((await b.call({ t: 'term.writer', id })).ok, true);
  await a.wait((m) => m.t === 'term.state' && m.id === id && m.writer === false);
  assert.equal((await b.call({ t: 'term.input', id, text: 'echo fromb\r', paste: true })).ok, true);
  await a.waitFrame(() => /fromb/.test(a.text(id)));
  // explicit resize by the writer
  const rz = await b.call({ t: 'term.resize', id, cols: 100, rows: 30 });
  assert.deepEqual([rz.ok, rz.cols, rz.rows], [true, 100, 30]);
  await a.wait((m) => m.t === 'term.state' && m.cols === 100 && m.rows === 30);
  // pause / resume → one full frame
  await a.call({ t: 'term.pause', id });
  const nFull = a.frames.filter((f) => f.full).length;
  await a.call({ t: 'term.resume', id });
  await a.waitFrame(() => a.frames.filter((f) => f.full).length > nFull);
  // history / copyRecent read from the pane
  const h = await a.call({ t: 'term.history', id, lines: 50 });
  assert.match(String(h.ansi), /zebra/);
  const cp = await a.call({ t: 'term.copyRecent', id, lines: 50 });
  assert.match(String(cp.text), /fromb/);
  assert.equal((await a.call({ t: 'term.scroll', id, dir: 'up', lines: 5 })).error, 'not_accepted');
  assert.equal((await a.call({ t: 'term.close', id })).ok, true);
  assert.equal((await b.call({ t: 'term.close', id })).ok, true);
  assert.equal(app.hub.panes.size, 0);
  await a.close();
  await b.close();
});

test('viewer cap: the 7th terminal of one client → terminal_limit', async () => {
  const c = await connect(app.port, { cid: 'cap' });
  const ids = [...app.model.entities.keys()].slice(0, 7);
  const rs: Awaited<ReturnType<typeof c.call>>[] = [];
  for (const id of ids) rs.push(await c.call({ t: 'term.open', id, cols: 80, rows: 24 }));
  assert.deepEqual(rs.map((r) => r.ok), [true, true, true, true, true, true, false]);
  assert.equal(rs[6]?.error, 'terminal_limit');
  await c.close();
  await sleep(20);
  // dropping the socket keeps its viewers for the 10 s grace (cid-keyed resume, §4.7); expiry releases them
  assert.equal(app.hub.orphans.has('cap'), true);
  app.hub._forgetOrphan('cap', true);
  assert.equal(app.hub.panes.size, 0, 'grace expiry releases its viewers');
});

test('actions: agent.answer hash check, entity + event broadcast; demo.force; gates', async () => {
  const c = await connect(app.port, { cid: 'act' });
  const b = need(worldOf(c).entities.find((e) => e.status === 'blocked'));
  const bad = await c.call({ t: 'agent.answer', id: b.id, key: '1', promptHash: 'deadbeef' });
  assert.equal(bad.error, 'prompt_changed');
  assert.ok(isRecord(bad.prompt) && b.prompt);
  assert.equal(bad.prompt.hash, b.prompt.hash);
  const ok = await c.call({ t: 'agent.answer', id: b.id, key: '2', promptHash: b.prompt.hash });
  assert.equal(ok.ok, true);
  await c.wait((m) => m.t === 'entity' && m.entity.id === b.id && m.entity.status === 'working');
  await c.wait((m) => m.t === 'event' && m.id === b.id && m.kind === 'unblocked');
  assert.equal((await c.call({ t: 'agent.prompt', id: 'd3:p2', text: 'hello' })).ok, true);
  await c.wait((m) => m.t === 'entity' && m.entity.id === 'd3:p2' && m.entity.lastPrompt === 'hello');
  assert.equal((await c.call({ t: 'demo.force', id: 'd1:p1', patch: { status: 'done' } })).ok, true);
  await c.wait((m) => m.t === 'entity' && m.entity.id === 'd1:p1' && m.entity.status === 'done');
  assert.equal((await c.call({ t: 'demo.event', id: 'd1:p1', kind: 'test-pass' })).ok, true);
  await c.wait((m) => m.t === 'event' && m.kind === 'test-pass');
  assert.equal((await c.call({ t: 'demo.force', id: 'd1:p1', patch: { workspace: 1 } })).error, 'bad_patch');
  const ex = await c.call({ t: 'agent.explain', id: 'd1:p1' });
  assert.ok(isRecord(ex.explain) && isRecord(ex.explain.matched_rule) && isRecord(ex.why));
  assert.equal(ex.explain.state, 'done', 'herdr-shaped explain (agent, state, matched_rule, evaluated_rules)');
  assert.equal(ex.explain.matched_rule.id, 'turn_finished_unseen');
  assert.deepEqual(Object.keys(ex.why), ['state', 'rule', 'region', 'evidence']);
  assert.equal(ex.why.rule, 'turn_finished_unseen');
  assert.notEqual((await c.call({ t: 'spawn', kind: 'claude' })).error, 'mutations_disabled', 'demo allows structural');
  const s = await c.call({ t: 'settings.set', patch: { fov: 70 } });
  assert.ok(isRecord(s.settings));
  assert.equal(s.settings.fov, 70);
  assert.equal((await c.call({ t: 'settings.set', patch: { fov: 'wide' } })).error, 'bad_message');
  const tl = await c.call({ t: 'timeline.get', since: 0 });
  assert.equal(tl.ok, true);
  assert.ok(c.msgs.some((m) => m.t === 'timeline'));
  await c.close();
});

test('upgrade gate: path, Host, Origin, token', async () => {
  const deny = async (o: ConnectOpts): Promise<unknown> => {
    try {
      const c = await connect(app.port, o);
      await c.close();
      return 'open';
    } catch (e) {
      return isRecord(e) ? e.status : undefined;
    }
  };
  assert.equal(await deny({ origin: 'http://evil.example' }), 403);
  assert.equal(await deny({ origin: null }), 403);
  assert.equal(await deny({ token: null }), 401);
  assert.equal(await deny({ token: 'cd'.repeat(32) }), 401);
  assert.equal(await deny({ headers: { host: 'evil.example:1234' } }), 403);
  assert.equal(await deny({ headers: { cookie: `hq_token=${TOKEN}` }, token: null }), 'open');
  assert.equal(await deny({ origin: `http://localhost:${app.port}` }), 'open');
  // cross-site WS hijack: a page on ANOTHER loopback port carries the SameSite=Strict cookie (site ignores ports)
  const cookie = { cookie: `hq_token=${TOKEN}` };
  assert.equal(await deny({ origin: 'http://localhost:3000', headers: cookie, token: null }), 403);
  assert.equal(await deny({ origin: `http://127.0.0.1:${app.port + 1}`, headers: cookie, token: null }), 403);
  assert.equal(await deny({ origin: 'http://localhost:7461', headers: cookie, token: null }), 403, 'vite port only counts in --dev');
});

test('upgrade gate (--dev): own port + the one vite port, no other loopback port', async () => {
  const dev = await startApp({ dev: true, vitePort: 7799 });
  try {
    const deny = async (origin: string): Promise<unknown> => {
      try {
        const c = await connect(dev.port, { origin, token: null, headers: { cookie: `hq_token=${TOKEN}` }, cid: 'dv' });
        await c.close();
        return 'open';
      } catch (e) {
        return isRecord(e) ? e.status : undefined;
      }
    };
    assert.equal(await deny('http://127.0.0.1:7799'), 'open');
    assert.equal(await deny(`http://localhost:${dev.port}`), 'open');
    assert.equal(await deny('http://localhost:7461'), 403);
    assert.equal(await deny('http://127.0.0.1:3000'), 403);
  } finally {
    await dev.close();
  }
});

test('client cap: the 9th socket is closed with 1013', async () => {
  const cs: Awaited<ReturnType<typeof connect>>[] = [];
  for (let i = 0; i < 8; i++) cs.push(await connect(app.port, { cid: `cap${i}`, ack: false }));
  const ws = new WebSocket(`ws://127.0.0.1:${app.port}/ws?t=${TOKEN}`, { origin: `http://127.0.0.1:${app.port}` });
  const code = await new Promise<number>((r) => ws.on('close', (c) => r(c)));
  assert.equal(code, 1013);
  for (const c of cs) await c.close();
});
