// herdr restarts (DESIGN §4.2 reconnect grace + rekey), honest time across backend restarts (§4.3.1 since), and the
// reaper (§4.7.1) — all against the mock herdr + fake terminal bin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { startLive, connect, waitFor, sleep, worldOf, TOKEN } from './test/harness.ts';
import { need } from './test/need.ts';
import type { GoneMsg, EntityMsg } from '../shared/protocol.ts';
import { scanTagged, stateTag } from './reaper.ts';
import { FAKE_BIN } from './test/mockHerdr.ts';

test('herdr restart with re-keyed pane ids: offline → grace → rekeyed gone + entity, no exodus, no arrive/leave', async () => {
  const L = await startLive({ app: { graceMs: 1500 } });
  try {
    const c = await connect(L.app.port, { cid: 'rk' });
    const before = worldOf(c).entities.map((e) => e.id).sort();
    await L.mock.stop();
    await c.wait((m) => m.t === 'herdr' && m.connected === false, 3000);
    await sleep(300);
    assert.equal(L.app.model.entities.size, 4, 'offline: the model freezes');
    assert.ok(!c.msgs.some((m) => m.t === 'gone'));
    await L.mock.restart({ rekey: true });
    const rk = await c.wait<GoneMsg>((m) => m.t === 'gone' && m.reason === 'rekeyed' && m.id === 'w1:p1', 5000);
    assert.equal(rk.newId, 'w1:p11');
    await c.wait((m) => m.t === 'herdr' && m.connected === true, 4000);
    await waitFor(() => c.msgs.filter((m) => m.t === 'gone' && m.reason === 'rekeyed').length === 4, 3000);
    const after = [...L.app.model.entities.keys()].sort();
    assert.deepEqual(after, before.map((id) => id.replace(/:p(\d+)$/, (_, n) => `:p${Number(n) + 10}`)).sort());
    await sleep(1700); // grace ends: nothing left to drop
    assert.ok(!c.msgs.some((m) => m.t === 'event' && (m.kind === 'arrived' || m.kind === 'left')), 'no exodus');
    assert.ok(!c.msgs.some((m) => m.t === 'gone' && m.reason === 'closed'));
    assert.equal(L.app.model.get('w1:p11')?.name, 'scout');
    await c.close();
  } finally {
    await L.app.close();
  }
});

test('grace: a pane that did not come back is dropped (left + gone) only after the grace window', async () => {
  const L = await startLive({ app: { graceMs: 800 } });
  try {
    const c = await connect(L.app.port, { cid: 'g2' });
    await L.mock.stop();
    await c.wait((m) => m.t === 'herdr' && m.connected === false, 3000);
    L.mock.removePane('w2:p2');
    await L.mock.restart();
    await c.wait((m) => m.t === 'herdr' && m.connected === true, 5000);
    assert.equal(L.app.model.has('w2:p2'), true, 'kept during grace');
    const g = await c.wait<GoneMsg>((m) => m.t === 'gone' && m.id === 'w2:p2', 3000);
    assert.equal(g.reason, 'closed');
    assert.ok(c.msgs.some((m) => m.t === 'event' && m.id === 'w2:p2' && m.kind === 'left'));
    await c.close();
  } finally {
    await L.app.close();
  }
});

test('since: a backend restart with unchanged stateSeq keeps statusSince and approx=false; a new pane is approx', async () => {
  const L = await startLive();
  const c = await connect(L.app.port, { cid: 's1' });
  L.mock.setStatus('w1:p1', 'working'); // a real transition → approx false
  const e1 = (await c.wait<EntityMsg>((m) => m.t === 'entity' && m.entity.id === 'w1:p1' && m.entity.status === 'working', 2000)).entity;
  assert.equal(e1.statusSinceApprox, false);
  const firstSight = need(worldOf(c).entities.find((e) => e.id === 'w2:p2'));
  assert.equal(firstSight.statusSinceApprox, true);
  await c.close();
  await L.app.close({ keep: true });
  await sleep(50);
  const L2 = await startLive({ mock: L.mock, home: L.home, configDir: L.configDir });
  try {
    const d = await connect(L2.app.port, { cid: 's2' });
    const e2 = need(worldOf(d).entities.find((e) => e.id === 'w1:p1'));
    assert.equal(e2.statusSince, e1.statusSince);
    assert.equal(e2.statusSinceApprox, false);
    const sh = need(worldOf(d).entities.find((e) => e.id === 'w2:p2'));
    assert.equal(sh.statusSince, firstSight.statusSince, 'first-sighting time also survives');
    await d.close();
  } finally {
    await L2.app.close();
  }
});

test('reaper: kill -9 the backend with live children → children survive (the bug); restart reaps them within 2 s', async () => {
  const L = await startLive();
  await L.app.close({ keep: true }); // keep the mock + dirs; run the backend as a real child process
  const env = { ...process.env, CLAUDE_HQ_CONFIG_DIR: L.configDir };
  const main = new URL('./main.ts', import.meta.url).pathname;
  const boot = (): Promise<{ p: ChildProcess; port: number }> => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [main, '--port', '0', '--session', 'hqtest'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d: Buffer) => {
      out += d;
      const m = out.match(/127\.0\.0\.1:(\d+)\//);
      if (m) resolve({ p, port: Number(m[1]) });
    });
    p.on('exit', (code) => reject(new Error(`backend exited ${code}: ${out}`)));
  });
  const tag = stateTag(L.configDir); // only this test's backend's children (other test files run in parallel)
  const tagged = () => scanTagged({ bin: FAKE_BIN }).filter((p) => p.state === tag);
  try {
    const b1 = await boot();
    const c = await connect(b1.port, { cid: 'r', token: fs.readFileSync(path.join(L.configDir, 'token'), 'utf8').trim() });
    for (const id of ['w1:p1', 'w1:p2', 'w2:p2']) await c.call({ t: 'term.open', id, cols: 80, rows: 24 });
    await c.call({ t: 'term.open', id: 'w2:p1', cols: 80, rows: 24 });
    const pr = await c.call({ t: 'term.promote', id: 'w2:p1', cols: 80, rows: 24 });
    assert.equal(pr.ok, true, JSON.stringify(pr));
    await waitFor(() => tagged().length >= 4, 3000);
    const children = JSON.parse(fs.readFileSync(path.join(L.configDir, 'hqtest', 'children.json'), 'utf8'));
    assert.ok(children.pids.length >= 4);
    b1.p.kill('SIGKILL');
    await new Promise((r) => b1.p.once('exit', r));
    await sleep(300);
    const orphans = tagged();
    assert.ok(orphans.length >= 3, `observe children survive a kill -9 (${orphans.length})`);
    const t0 = performance.now();
    const b2 = await boot();
    await waitFor(() => tagged().filter((x) => orphans.some((o) => o.pid === x.pid)).length === 0, 2500);
    assert.ok(performance.now() - t0 < 2500);
    // SIGHUP → clean release: no tagged process of that instance remains
    const c2 = await connect(b2.port, { cid: 'r2', token: fs.readFileSync(path.join(L.configDir, 'token'), 'utf8').trim() });
    await c2.call({ t: 'term.open', id: 'w1:p2', cols: 80, rows: 24 });
    await waitFor(() => tagged().length >= 1, 3000);
    b2.p.kill('SIGHUP');
    const code = await new Promise<number | null>((r) => b2.p.once('exit', r));
    assert.equal(code, 0);
    await waitFor(() => tagged().length === 0, 3000);
    assert.equal(fs.existsSync(path.join(L.configDir, 'hqtest.lock')), false, 'lock removed on clean exit');
    await c.close();
    await c2.close();
  } finally {
    for (const t of tagged()) {
      try {
        process.kill(t.pid, 'SIGKILL');
      } catch {}
    }
    await L.mock.close();
    fs.rmSync(L.configDir, { recursive: true, force: true });
    fs.rmSync(L.home, { recursive: true, force: true });
  }
});

test('single instance: a second main.ts for the same live session attaches (prints the URL, exits 0); --new-instance refuses', async () => {
  const L = await startLive();
  try {
    const env = { ...process.env, CLAUDE_HQ_CONFIG_DIR: L.configDir };
    fs.writeFileSync(path.join(L.configDir, 'token'), TOKEN + '\n', { mode: 0o600 });
    const main = new URL('./main.ts', import.meta.url).pathname;
    const run = (args: string[]): Promise<{ code: number | null; out: string }> => new Promise((resolve) => {
      const p = spawn(process.execPath, [main, '--port', '0', '--session', 'hqtest', ...args], { env });
      let out = '';
      p.stdout.on('data', (d: Buffer) => (out += d));
      p.stderr.on('data', (d: Buffer) => (out += d));
      p.on('exit', (code) => resolve({ code, out }));
    });
    const a = await run([]);
    assert.equal(a.code, 0);
    assert.match(a.out, new RegExp(`already running.*127\\.0\\.0\\.1:${L.app.port}/\\?t=${TOKEN}`));
    const b = await run(['--new-instance']);
    assert.equal(b.code, 1);
    assert.match(b.out, /already running/);
  } finally {
    await L.app.close();
  }
});
