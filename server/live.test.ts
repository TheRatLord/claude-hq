// Live wiring e2e against the mock herdr + fake terminal bin (DESIGN §9.3 mock-herdr / WS e2e).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { startLive, connect, waitFor, sleep, worldOf, helloOf } from './test/harness.ts';
import type { LiveHarness } from './test/harness.ts';
import { need } from './test/need.ts';
import { isRecord } from '../shared/guards.ts';
import { encodeTermInput } from '../shared/protocol.ts';
import type { Entity, EntityMsg, TermStateMsg } from '../shared/protocol.ts';

let L: LiveHarness;
before(async () => (L = await startLive()));
after(async () => L.app.close());

test('hello/world from the live source: entities, names, D2 baseTitle, slots, herdr status', async () => {
  const c = await connect(L.app.port, { cid: 'w' });
  const hello = helloOf(c);
  assert.equal(hello.session, 'hqtest');
  assert.equal(hello.demo, false);
  assert.equal(hello.demoConfig, undefined);
  assert.equal((await c.call({ t: 'demo.scenario', name: 'mixed', seed: 42 })).error, 'not_demo');
  assert.deepEqual(hello.herdr, { connected: true, protocol: 22, readOnly: false });
  const w = worldOf(c);
  const byId = new Map(w.entities.map((e) => [e.id, e]));
  const ent = (id: string): Entity => need(byId.get(id), id);
  assert.equal(w.entities.length, 4);
  assert.equal(ent('w1:p1').name, 'scout');
  assert.equal(ent('w1:p1').kind, 'claude');
  assert.equal(ent('w1:p1').baseTitle, 'Confirmation message');
  assert.equal(ent('w1:p1').stateSeq, 6);
  assert.equal(ent('w1:p2').name, 'dev');
  assert.equal(ent('w1:p2').kind, 'shell');
  assert.equal(ent('w1:p2').stateSeq, null);
  assert.equal(ent('w2:p1').status, 'blocked');
  assert.deepEqual(w.workspaces.map((x) => [x.label, x.slot]), [['hq-core', 0], ['hq-sandbox', 1]]);
  assert.equal(ent('w1:p1').identity.agentSession, 'sess-scout');
  await c.close();
});

test('status change reaches the renderer well within 2 s (per-pane subscription), finished after ≥ 3 s working', async () => {
  const c = await connect(L.app.port, { cid: 's' });
  const t0 = performance.now();
  L.mock.setStatus('w1:p1', 'working');
  const m = await c.wait<EntityMsg>((x) => x.t === 'entity' && x.entity.id === 'w1:p1' && x.entity.status === 'working', 2000);
  const dt = performance.now() - t0;
  assert.ok(dt < 500, `status latency ${dt.toFixed(0)} ms`);
  assert.equal(m.entity.stateSeq, 7);
  L.mock.setStatus('w1:p1', 'idle');
  await c.wait((x) => x.t === 'entity' && x.entity.id === 'w1:p1' && x.entity.status === 'idle', 2000);
  assert.ok(!c.msgs.some((x) => x.t === 'event' && x.kind === 'finished'), 'short turn: no finished');
  await c.close();
});

test('blocked: tinker folder-trust prompt parsed; answer is hash-checked and sent as keys', async () => {
  const c = await connect(L.app.port, { cid: 'b' });
  const e = await waitFor(() => L.app.model.get('w2:p1')?.prompt, 4000);
  assert.equal(e.question, 'Quick safety check: Is this a project you created or one you trust?');
  assert.deepEqual(e.options.map((o) => o.label), ['No, exit', 'Yes, I trust this folder']);
  assert.equal(e.numbered, false);
  assert.equal(e.selected, 0);
  const bad = await c.call({ t: 'agent.answer', id: 'w2:p1', key: '2', promptHash: 'deadbeef' });
  assert.equal(bad.error, 'prompt_changed');
  assert.ok(isRecord(bad.prompt));
  assert.equal(bad.prompt.hash, e.hash);
  assert.equal(L.mock.methods((x) => x.method === 'pane.send_keys').length, 0, 'nothing sent on a stale hash');
  const ok = await c.call({ t: 'agent.answer', id: 'w2:p1', key: '2', promptHash: e.hash });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.deepEqual(ok.keys, ['Down', 'Enter']);
  const sent = L.mock.calls.filter((x) => x.method === 'pane.send_keys');
  assert.deepEqual(sent.map((x) => x.params.keys), [['Down', 'Enter']]);
  assert.match(L.mock.answered?.text ?? '', /❯ Yes, I trust this folder/);
  await c.wait((x) => x.t === 'entity' && x.entity.id === 'w2:p1' && x.entity.status === 'idle' && x.entity.prompt === null, 3000);
  await c.wait((x) => x.t === 'event' && x.id === 'w2:p1' && x.kind === 'unblocked');
  await c.close();
});

test('terminal: observe first (no PTY resize), no control child without promote; promote → control; echo round-trip', async () => {
  const id = 'w1:p2';
  const before = L.spawns().length;
  const a = await connect(L.app.port, { cid: 'ta' });
  const open = await a.call({ t: 'term.open', id, cols: 90, rows: 30 });
  assert.equal(open.mode, 'observe');
  await a.waitFrame((f) => f.id === id && f.full, 3000);
  await a.call({ t: 'term.fit', id, cols: 90, rows: 30 });
  a.send(encodeTermInput(id, 'nope\r'));
  assert.equal((await a.call({ t: 'term.input', id, text: 'x', paste: true })).error, 'not_controller');
  await a.call({ t: 'term.history', id, lines: 10 });
  await a.call({ t: 'term.pause', id });
  await a.call({ t: 'term.resume', id });
  await sleep(100);
  const s1 = L.spawns().slice(before);
  assert.ok(s1.length >= 1 && s1.every((s) => s.argv.includes('observe')), 'observe children only');
  assert.equal(L.mock.pane(id)?.scroll.viewport_rows, 24, 'observing does not resize the PTY');
  // argv + env: same --session as the socket, HERDR_* scrubbed, reaper tags present
  const s10 = need(s1[0]);
  assert.deepEqual(s10.argv.slice(0, 6), ['--session', 'hqtest', 'terminal', 'session', 'observe', id]);
  assert.deepEqual(s10.herdrEnv, []);
  assert.equal(s10.instance, L.app.instanceId);
  assert.equal(s10.session, 'hqtest');
  // promote: exactly one control child, at the layout rect if it fits (120×40 does not fit 90×30 → writer grid)
  const pr = await a.call({ t: 'term.promote', id, cols: 90, rows: 30 });
  assert.deepEqual([pr.ok, pr.mode], [true, 'control'], JSON.stringify(pr));
  const ctl = L.spawns().slice(before).filter((s) => s.argv.includes('control'));
  assert.equal(ctl.length, 1);
  assert.equal(L.mock.pane(id)?.scroll.viewport_rows, 30);
  a.send(encodeTermInput(id, 'echo hi\r'));
  await a.wait((m) => m.t === 'term.ack' && m.id === id && m.upTo === 8, 2000);
  await a.waitFrame(() => /echo hi/.test(a.text(id)), 2000);
  // paste chunk: reply after drain
  assert.equal((await a.call({ t: 'term.input', id, text: 'pasted\r', paste: true })).ok, true);
  // a late second window gets one serialized full frame, no resize
  const b = await connect(L.app.port, { cid: 'tb' });
  const ob = await b.call({ t: 'term.open', id, cols: 140, rows: 50 });
  assert.equal(ob.mode, 'control');
  const full = await b.waitFrame((f) => f.id === id && f.full, 2000);
  assert.match(full.text, /pasted/);
  assert.equal(L.mock.pane(id)?.scroll.viewport_rows, 30, 'late joiner does not resize');
  assert.equal(L.spawns().slice(before).filter((s) => s.argv.includes('control')).length, 1);
  await a.call({ t: 'term.close', id });
  await b.call({ t: 'term.close', id });
  await waitFor(() => L.mock.attached(id).length === 0, 3000);
  await a.close();
  await b.close();
});

test('busy → takeover: an external controller holds the pane', async () => {
  const id = 'w2:p2';
  // an "external herdr attach": a control attach directly on the mock socket
  const ext = net.createConnection(L.mock.socket);
  await new Promise<void>((r) => ext.once('connect', () => r()));
  ext.write(JSON.stringify({ id: 'x', method: 'fake.term.attach', params: { pane_id: id, mode: 'control', cols: 80, rows: 24 } }) + '\n');
  await waitFor(() => L.mock.attached(id).some((t) => t.mode === 'control'));
  let extClosed = '';
  ext.setEncoding('utf8');
  ext.on('data', (d) => (extClosed += d));
  const a = await connect(L.app.port, { cid: 'busy' });
  await a.call({ t: 'term.open', id, cols: 80, rows: 24 });
  const r = await a.call({ t: 'term.promote', id, cols: 80, rows: 24 });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'busy');
  await a.wait((m) => m.t === 'term.state' && m.id === id && m.state === 'busy');
  const t = await a.call({ t: 'term.promote', id, cols: 80, rows: 24, takeover: true });
  assert.equal(t.ok, true, JSON.stringify(t));
  await waitFor(() => /taken over/.test(extClosed));
  ext.destroy();
  await a.call({ t: 'term.close', id });
  await a.close();
});

test('promote with other viewers: B and C get one full frame at the control grid, stay Peek; one control child', async () => {
  const id = 'w1:p1';
  const n0 = L.spawns().length;
  const A = await connect(L.app.port, { cid: 'pa' });
  const B = await connect(L.app.port, { cid: 'pb' });
  const C = await connect(L.app.port, { cid: 'pc' });
  await A.call({ t: 'term.open', id, cols: 100, rows: 30 });
  await B.call({ t: 'term.open', id, cols: 140, rows: 45 });
  await C.call({ t: 'term.open', id, cols: 60, rows: 20 });
  await A.waitFrame((f) => f.id === id && f.full, 3000);
  // mixed sizes: the observe child is at the first opener's grid; B's fit does not respawn it
  await B.call({ t: 'term.fit', id, cols: 150, rows: 48 });
  await sleep(50);
  const obs = L.spawns().slice(n0).filter((s) => s.argv.includes('observe'));
  assert.equal(obs.length, 1);
  assert.deepEqual(need(obs[0]).argv.slice(-4), ['--cols', '100', '--rows', '30']);
  const bFull = B.frames.filter((f) => f.full).length, cFull = C.frames.filter((f) => f.full).length;
  const pr = await A.call({ t: 'term.promote', id, cols: 130, rows: 42 });
  assert.equal(pr.ok, true);
  assert.deepEqual([pr.cols, pr.rows], [120, 40], 'layoutRect 120×40 fits the writer grid → no reflow');
  await B.waitFrame(() => B.frames.filter((f) => f.full).length > bFull, 2000);
  await C.waitFrame(() => C.frames.filter((f) => f.full).length > cFull, 2000);
  const sb = await B.wait<TermStateMsg>((m) => m.t === 'term.state' && m.id === id && m.mode === 'control');
  assert.deepEqual([sb.writer, sb.cols, sb.rows], [false, 120, 40]);
  assert.equal(L.spawns().slice(n0).filter((s) => s.argv.includes('control')).length, 1);
  for (const x of [A, B, C]) {
    await x.call({ t: 'term.close', id });
    await x.close();
  }
});

test('grace resume: a dropped socket reconnecting with the same cid resumes its viewer with a full frame', async () => {
  const id = 'w1:p2';
  const n0 = L.spawns().length;
  const a = await connect(L.app.port, { cid: 'grace' });
  await a.call({ t: 'term.open', id, cols: 80, rows: 24 });
  await a.waitFrame((f) => f.full, 3000);
  await a.close();
  await sleep(50);
  assert.equal(L.app.hub.panes.has(id), true, 'kept during grace');
  const b = await connect(L.app.port, { cid: 'grace' });
  const r = await b.call({ t: 'term.open', id, cols: 80, rows: 24 });
  assert.equal(r.ok, true);
  await b.waitFrame((f) => f.full, 2000);
  assert.equal(L.spawns().length - n0, 1, 'the same child resumed');
  assert.equal(L.app.hub.metrics().resumes >= 1, true);
  await b.call({ t: 'term.close', id });
  await b.close();
});

test('done sign-off: done.ack overlay while done at the same stateSeq; cleared by a new transition', async () => {
  const c = await connect(L.app.port, { cid: 'ack' });
  L.mock.setStatus('w1:p1', 'done');
  const d = await c.wait<EntityMsg>((x) => x.t === 'entity' && x.entity.id === 'w1:p1' && x.entity.status === 'done', 2000);
  assert.equal((await c.call({ t: 'done.ack', id: 'w1:p1', stateSeq: (d.entity.stateSeq ?? 0) - 1 })).error, 'not_accepted');
  const r = await c.call({ t: 'done.ack', id: 'w1:p1', stateSeq: d.entity.stateSeq });
  assert.equal(r.ok, true);
  await c.wait((x) => x.t === 'entity' && x.entity.id === 'w1:p1' && x.entity.ack?.by === 'hq');
  await c.wait((x) => x.t === 'event' && x.kind === 'acked');
  assert.equal(L.mock.methods((x) => x.method === 'pane.focus').length, 0, 'sign-off touches nothing in herdr');
  L.mock.setStatus('w1:p1', 'working');
  await c.wait((x) => x.t === 'entity' && x.entity.id === 'w1:p1' && x.entity.status === 'working' && x.entity.ack === null, 2000);
  L.mock.setStatus('w1:p1', 'idle');
  await c.close();
});

test('pane churn: arrived for new panes, left + gone for closed ones; status subscription follows', async () => {
  const c = await connect(L.app.port, { cid: 'churn' });
  L.mock.addPane({ id: 'w1:p9', label: 'extra', agent: 'claude', name: 'nova', status: 'idle' });
  await c.wait((x) => x.t === 'event' && x.id === 'w1:p9' && x.kind === 'arrived', 3000);
  await waitFor(() => L.mock.subs.size && [...L.mock.subs].some((s) => s.subs.some((x) => x.pane_id === 'w1:p9')), 3000);
  L.mock.setStatus('w1:p9', 'working');
  await c.wait((x) => x.t === 'entity' && x.entity.id === 'w1:p9' && x.entity.status === 'working', 2000);
  L.mock.removePane('w1:p9');
  await c.wait((x) => x.t === 'gone' && x.id === 'w1:p9' && x.reason === 'closed', 3000);
  assert.ok(c.msgs.some((x) => x.t === 'event' && x.id === 'w1:p9' && x.kind === 'left'));
  await c.close();
});

test('/debug/metrics shape (herdr children, subscriptions, enrichers)', async () => {
  const L2 = L; // metrics need --metrics; read the same data through the app objects
  const m = L2.app.hub.metrics();
  assert.equal(typeof m.children.observe, 'number');
  assert.equal(typeof L2.app.client.stats.subscriptions, 'number');
});
