// Safety e2e (DESIGN §9.3): two gates (actions.ts + client.ts allowlist), read-only protocol mode, resolver guard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startLive, connect, sleep, helloOf } from './test/harness.ts';
import { need } from './test/need.ts';
import { classifyMethod, METHOD_CLASS, HerdrClient } from './herdr/client.ts';
import { socketFor, isDefaultSocket, refuseDefault, childEnv } from './herdr/resolve.ts';
import { FakeClock } from './clock.ts';
import { Actions } from './world/actions.ts';
import { MockHerdr, FAKE_BIN } from './test/mockHerdr.ts';
import { isDefaultTarget } from './herdr/resolve.ts';
import { createApp } from './app.ts';
import { nullLogger } from './log.ts';
import { DEFAULT_SETTINGS } from '../shared/protocol.ts';

/** An Actions whose gate() is all a test needs: it reads session/isDefault/demo only, so source and model are empty stubs. */
function gateOnly(o: Record<string, unknown> & { session: string; isDefault: boolean; demo: boolean }): Actions {
  // @ts-expect-error source/model are empty stubs, and `settings`/extra knobs are deliberately invalid input (the removed allowMutations option, a hostile setting)
  return new Actions({ source: {}, model: {}, clock: new FakeClock(), ...o });
}

const STRUCTURAL = new Set(METHOD_CLASS.structural);
const READ = new Set(METHOD_CLASS.read);

test('resolver: socketFor table, default guard by realpath, env scrub + tags', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-res-'));
  process.env.HQ_HERDR_HOME = home;
  assert.equal(socketFor('default'), path.join(home, 'herdr.sock'));
  assert.equal(socketFor(undefined), path.join(home, 'herdr.sock'));
  assert.equal(socketFor('hqtest'), path.join(home, 'sessions/hqtest/herdr.sock'));
  assert.throws(() => socketFor('../x'), /bad herdr session/);
  assert.throws(() => socketFor('a/b'), /bad herdr session/);
  assert.throws(() => refuseDefault('default'), /refuses the default/);
  refuseDefault('hqtest');
  // a named session whose directory is a symlink to the default socket's directory is still the default
  fs.mkdirSync(path.join(home, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(home, 'herdr.sock'), '');
  fs.symlinkSync(home, path.join(home, 'sessions', 'sneaky'));
  assert.equal(isDefaultSocket('sneaky'), true);
  assert.throws(() => refuseDefault('sneaky'), /refuses the default/);
  const env = childEnv({ instanceId: 'i1', session: 's1' }, { PATH: '/bin', HERDR_SOCKET_PATH: '/x', HERDR_PANE_ID: 'w1:p1', HERDR_ENV: '1', HERDR_BIN_PATH: '/b' });
  assert.deepEqual(env, { PATH: '/bin', CLAUDE_HQ_INSTANCE: 'i1', CLAUDE_HQ_SESSION: 's1' });
  assert.equal(childEnv({ stateTag: 'abc' }, {}).CLAUDE_HQ_STATE, 'abc');
  fs.rmSync(home, { recursive: true, force: true });
});

test('client allowlist: classes, default-session structural refusal, never-class, control needs a promote token, ping before spawn', async () => {
  assert.equal(classifyMethod('session.snapshot'), 'read');
  assert.equal(classifyMethod('pane.send_keys'), 'interact');
  assert.equal(classifyMethod('pane.focus'), 'focus');
  assert.equal(classifyMethod('pane.split'), 'structural');
  for (const m of ['server.stop', 'session.stop', 'session.delete', 'pane.send_text', 'agent.focus', 'nope']) assert.equal(classifyMethod(m), 'never', m);
  const clock = new FakeClock();
  const def = new HerdrClient({ session: 'default', clock, socket: '/nonexistent.sock' });
  await assert.rejects(def.request('pane.close', { pane_id: 'w1:p1' }), { code: 'mutations_disabled' });
  await assert.rejects(def.request('server.stop', {}), { code: 'method_denied' });
  assert.throws(() => def.spawnTerm({ mode: 'observe', paneId: 'w1:p1', cols: 80, rows: 24 }), { code: 'not_pinged' });
  def.pinged = true;
  assert.throws(() => def.spawnTerm({ mode: 'control', paneId: 'w1:p1', cols: 80, rows: 24 }), { code: 'method_denied' });
  const tok = def.mintPromoteToken('w1:p2');
  assert.throws(() => def.spawnTerm({ mode: 'control', paneId: 'w1:p1', cols: 80, rows: 24, promoteToken: tok }), { code: 'method_denied' }, 'token is per pane');
  assert.throws(() => def.spawnTerm({ mode: 'control', paneId: 'w1:p2', cols: 80, rows: 24, promoteToken: tok }), { code: 'method_denied' }, 'and one-shot');
  const named = new HerdrClient({ session: 'hqtest', clock, socket: '/nonexistent.sock' });
  assert.equal(named.gate('pane.close'), 'structural');
  const ro = new HerdrClient({ session: 'hqtest', clock, readOnly: true, socket: '/x' });
  assert.throws(() => ro.gate('pane.send_keys'), { code: 'readonly_protocol' });
  assert.throws(() => ro.gate('pane.focus'), { code: 'readonly_protocol' });
  assert.equal(ro.gate('pane.read'), 'read');
});

test('default session (mock registered as default, no allowMutations): full WS run writes ZERO structural/never methods', async () => {
  const L = await startLive({ session: 'default' });
  try {
    const c = await connect(L.app.port, { cid: 'safe' });
    const hello = helloOf(c);
    assert.equal(hello.session, 'default');
    assert.equal(hello.allowMutations, false);
    const r1 = await c.call({ t: 'spawn', kind: 'claude', cwd: '/tmp' });
    assert.equal(r1.error, 'mutations_disabled');
    const r2 = await c.call({ t: 'pane.close', id: 'w1:p2' });
    assert.equal(r2.error, 'mutations_disabled');
    await c.call({ t: 'agent.prompt', id: 'w1:p1', text: 'hello' });
    await c.call({ t: 'agent.keys', id: 'w1:p1', keys: ['Escape'] });
    await c.call({ t: 'agent.explain', id: 'w1:p1' });
    await c.call({ t: 'agent.answer', id: 'w2:p1', key: '1', promptHash: 'deadbeef' });
    await c.call({ t: 'screen.watch', ids: ['w1:p1', 'w2:p2'] });
    await c.call({ t: 'term.open', id: 'w1:p2', cols: 80, rows: 24 });
    await c.call({ t: 'term.history', id: 'w1:p2', lines: 20 });
    await c.call({ t: 'term.close', id: 'w1:p2' });
    await c.call({ t: 'demo.force', id: 'w1:p1', patch: {} });
    // the allowMutations setting cannot open the default session from the UI (see the no-leak test below)
    await sleep(1200);
    const bad = L.mock.calls.filter((x) => STRUCTURAL.has(x.method) || classifyMethod(x.method) === 'never');
    assert.deepEqual(bad, []);
    assert.ok(L.mock.calls.some((x) => x.method === 'agent.prompt'), 'interact class is allowed in default');
    assert.equal(L.spawns().filter((s) => s.argv.includes('control')).length, 0);
    await c.close();
  } finally {
    await L.app.close();
  }
});

test('named session that resolves to the DEFAULT socket (symlinked dir, socket override) is gated as default', async () => {
  // (a) sessions/sneaky → <home> (symlinked dir): the mock serves <home>/herdr.sock, i.e. the default socket
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-sneaky-'));
  process.env.HQ_HERDR_HOME = home;
  const mock = await MockHerdr.start({ home, session: 'default' });
  fs.mkdirSync(path.join(home, 'sessions'), { recursive: true });
  fs.symlinkSync(home, path.join(home, 'sessions', 'sneaky'));
  assert.equal(isDefaultTarget('sneaky'), true);
  assert.equal(isDefaultTarget('other', path.join(home, 'sessions', 'sneaky', 'herdr.sock')), true, 'override via a symlink');
  assert.equal(isDefaultTarget('other', path.join(home, 'elsewhere.sock')), false);
  const runs = [
    { session: 'sneaky' },
    { session: 'other', app: { herdrSocket: path.join(home, 'herdr.sock') } }, // (b) socket override = the default socket
  ];
  for (const r of runs) {
    const L = await startLive({ home, mock, ...r });
    try {
      const c = await connect(L.app.port, { cid: `sn-${r.session}` });
      const hello = helloOf(c);
      assert.equal(hello.session, r.session);
      assert.equal(hello.allowMutations, false, 'UI hides spawn/close');
      assert.equal(hello.defaultSession, true);
      assert.equal((await c.call({ t: 'spawn', kind: 'claude', cwd: '/tmp' })).error, 'mutations_disabled');
      assert.equal((await c.call({ t: 'pane.close', id: 'w1:p2' })).error, 'mutations_disabled');
      assert.equal((await c.call({ t: 'settings.set', patch: { allowMutations: true } })).error, 'mutations_disabled');
      await c.call({ t: 'agent.prompt', id: 'w1:p1', text: 'hi' }); // interact still allowed, as in default
      await sleep(300);
      assert.deepEqual(mock.calls.filter((x) => STRUCTURAL.has(x.method)), []);
      await c.close();
    } finally {
      await L.app.close({ keep: true });
    }
  }
  const bare = new HerdrClient({ session: 'sneaky', clock: new FakeClock() });
  assert.equal(bare.isDefault, true, 'bare client construction resolves by realpath too');
  assert.throws(() => bare.gate('pane.close'), { code: 'mutations_disabled' });
  await mock.close();
  fs.rmSync(home, { recursive: true, force: true });
});

test('read-only mode: herdr protocol 21 → hello.herdr.readOnly; zero CONTROL/INTERACT/FOCUS calls', async () => {
  const L = await startLive({ protocol: 21 });
  try {
    const c = await connect(L.app.port, { cid: 'ro' });
    assert.deepEqual(helloOf(c).herdr, { connected: true, protocol: 21, readOnly: true });
    assert.equal((await c.call({ t: 'agent.prompt', id: 'w1:p1', text: 'x' })).error, 'readonly_protocol');
    assert.equal((await c.call({ t: 'agent.keys', id: 'w1:p1', keys: ['a'] })).error, 'readonly_protocol');
    assert.equal((await c.call({ t: 'herdr.focus', id: 'w1:p1' })).error, 'readonly_protocol');
    assert.equal((await c.call({ t: 'spawn' })).error, 'readonly_protocol');
    const o = await c.call({ t: 'term.open', id: 'w1:p2', cols: 80, rows: 24 });
    assert.equal(o.mode, 'observe');
    await c.wait((m) => m.t === 'term.state' && m.id === 'w1:p2' && m.state === 'readonly', 3000); // Peek only (§8.4)
    assert.equal((await c.call({ t: 'term.promote', id: 'w1:p2', cols: 80, rows: 24 })).error, 'readonly_protocol');
    await c.call({ t: 'term.close', id: 'w1:p2' });
    const bad = L.mock.calls.filter((x) => !READ.has(x.method));
    assert.deepEqual(bad, []);
    assert.equal(L.spawns().filter((s) => s.argv.includes('control')).length, 0);
    await c.close();
  } finally {
    await L.app.close();
  }
});

test('no child spawns before a successful ping (herdr down at start); the removed allowMutations option is a hard error', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-down-'));
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-cfg-'));
  process.env.HQ_HERDR_HOME = home;
  process.env.HERDR_BIN_PATH = FAKE_BIN;
  const log = path.join(home, 'bin.log');
  process.env.FAKE_HERDR_LOG = log;
  const app = await createApp({ port: 0, session: 'hqtest', configDir: cfg, log: nullLogger, token: 'ab'.repeat(32) });
  try {
    const c = await connect(app.port, { cid: 'down' });
    assert.equal(helloOf(c).herdr.connected, false);
    assert.equal(fs.existsSync(log), false, 'no terminal child');
    await c.close();
  } finally {
    await app.close();
  }
  for (const session of ['default', 'hqtest']) {
    for (const v of [true, false]) {
      await assert.rejects(createApp({ port: 0, session, allowMutations: v, configDir: cfg, log: nullLogger }), /--allow-mutations was removed/);
    }
  }
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(cfg, { recursive: true, force: true });
});

test('allowMutations setting never leaks: not persisted; a stale config value is ignored; UI cannot open it in default', async () => {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-leak-'));
  const cfgFile = path.join(cfg, 'config.json');
  // 1) a run where structural is allowed (demo), then any settings.set → config.json must not carry allowMutations
  const a = await createApp({ demo: 4, port: 0, configDir: cfg, log: nullLogger, token: 'ab'.repeat(32) });
  try {
    assert.equal(a.actions.mutationsAllowed, true);
    const c = await connect(a.port, { cid: 'leak1' });
    assert.equal((await c.call({ t: 'settings.set', patch: { headBob: false } })).ok, true);
    await c.close();
  } finally {
    await a.close();
  }
  assert.equal('allowMutations' in JSON.parse(fs.readFileSync(cfgFile, 'utf8')).settings, false, 'flag not persisted');
  // 2) even a hand-written/stale allowMutations:true in config.json is ignored by a later default-session run
  const j = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  j.settings.allowMutations = true;
  fs.writeFileSync(cfgFile, JSON.stringify(j));
  const b = await createApp({ session: 'default', port: 0, configDir: cfg, log: nullLogger, lock: false, token: 'ab'.repeat(32),
    herdrSocket: path.join(cfg, 'nope.sock'), herdrBin: '/nonexistent/herdr' });
  try {
    assert.equal(b.settings.allowMutations, false);
    assert.equal(b.actions.mutationsAllowed, false);
    assert.throws(() => need(b.client).gate('pane.close'), { code: 'mutations_disabled' });
  } finally {
    await b.close();
  }
  fs.rmSync(cfg, { recursive: true, force: true });

  // 3) one renderer settings.set {allowMutations:true} in the default session opens NEITHER gate
  const L = await startLive({ session: 'default' });
  try {
    const c = await connect(L.app.port, { cid: 'leak2' });
    const r = await c.call({ t: 'settings.set', patch: { allowMutations: true } });
    assert.equal(r.error, 'mutations_disabled');
    assert.equal(L.app.actions.mutationsAllowed, false);
    assert.equal((await c.call({ t: 'pane.close', id: 'w1:p2' })).error, 'mutations_disabled');
    await assert.rejects(L.app.client.request('pane.close', { pane_id: 'w1:p2' }), { code: 'mutations_disabled' });
    assert.deepEqual(L.mock.calls.filter((x) => STRUCTURAL.has(x.method)), []);
    await c.close();
  } finally {
    await L.app.close();
  }
});

test('ONLY a named, non-default socket (or demo) enables spawn + pane.close: every other path is refused at both gates', async () => {
  const clock = new FakeClock();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-only-'));
  process.env.HQ_HERDR_HOME = home;
  fs.writeFileSync(path.join(home, 'herdr.sock'), '');
  fs.mkdirSync(path.join(home, 'sessions', 'hqtest'), { recursive: true });
  fs.symlinkSync(home, path.join(home, 'sessions', 'sneaky'));
  // gate 1 (actions.ts): every combination of stale/injected knobs; only !isDefault or demo opens it
  const junk = { allowMutations: true, settings: { ...DEFAULT_SETTINGS, allowMutations: true } }; // removed option + a hostile setting
  for (const session of ['default', 'sneaky', 'hqtest']) {
    const isDefault = isDefaultTarget(session);
    for (const extra of [{}, junk]) {
      const a = gateOnly({ session, isDefault, demo: false, settings: { ...DEFAULT_SETTINGS }, ...extra });
      for (const t of ['spawn', 'pane.close'] as const) {
        if (session === 'hqtest') assert.equal(a.gate(t), 'structural', `${session} ${t}`);
        else assert.throws(() => a.gate(t), { code: 'mutations_disabled' }, `${session} ${t} ${JSON.stringify(Object.keys(extra))}`);
      }
      assert.equal(a.mutationsAllowed, session === 'hqtest');
    }
  }
  assert.equal(gateOnly({ session: 'demo', isDefault: true, demo: true, settings: {} }).gate('spawn'), 'structural');
  // gate 2 (client.ts): the same verdict, and no constructor option re-opens a default socket
  for (const session of ['default', 'sneaky', 'hqtest']) {
    for (const extra of [{}, { allowMutations: true }]) {
      const c = new HerdrClient({ session, clock, ...extra });
      for (const m of ['pane.close', 'tab.create', 'pane.split', 'agent.start']) {
        if (session === 'hqtest') assert.equal(c.gate(m), 'structural', `${session} ${m}`);
        else assert.throws(() => c.gate(m), { code: 'mutations_disabled' }, `${session} ${m}`);
      }
    }
    // an override pointing at the default socket makes even "hqtest" default
    assert.throws(() => new HerdrClient({ session: 'hqtest', clock, socket: path.join(home, 'sessions', 'sneaky', 'herdr.sock') }).gate('pane.close'),
      { code: 'mutations_disabled' });
  }
  fs.rmSync(home, { recursive: true, force: true });
  // end to end: a named, non-default mock session DOES reach herdr for spawn + pane.close (so the refusals above are real)
  const L = await startLive({ session: 'hqtest' });
  try {
    const c = await connect(L.app.port, { cid: 'only' });
    assert.equal(helloOf(c).allowMutations, true);
    const sp = await c.call({ t: 'spawn', cwd: '/tmp' }); // plain shell: workspace.create
    assert.notEqual(sp.error, 'mutations_disabled', JSON.stringify(sp));
    assert.equal((await c.call({ t: 'pane.close', id: 'w1:p2' })).error, undefined);
    await sleep(300);
    const methods = L.mock.calls.map((x) => x.method);
    assert.ok(methods.some((m) => STRUCTURAL.has(m) && m !== 'pane.close'), `spawn reached herdr: ${methods.join(',')}`);
    assert.ok(methods.includes('pane.close'), 'pane.close reached herdr');
    await c.close();
  } finally {
    await L.app.close();
  }
});
