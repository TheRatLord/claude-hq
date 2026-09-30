// Chaos harness. On the mock herdr, under FakeClock (timers fake, socket IO real), 20 seeds of
// randomised herdr restarts (re-keyed ids), pane churn, status flips, subscription EOFs and reply/event lines split
// into random byte pieces (mid-UTF-8 included) → no exodus, no duplicate entities, the model converges to herdr's
// truth, no leaked terminal children, and the DEFAULT-session method log holds nothing but READ calls. Owner: BE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeClock } from '../clock.ts';
import { startLive, connect } from './harness.ts';
import { scanTagged } from '../reaper.ts';
import { identityKey, mulberry32 } from '../../shared/identity.ts';
import { FAKE_BIN } from './mockHerdr.ts';
import type { EventMsg, GoneMsg, ServerMsg } from '../../shared/protocol.ts';

const SEEDS = Number(process.env.HQ_CHAOS_SEEDS ?? 20);
const READ = new Set(['ping', 'session.snapshot', 'events.subscribe', 'workspace.list', 'tab.list', 'pane.list', 'pane.get', 'pane.read',
  'pane.process_info', 'agent.list', 'agent.get', 'agent.read', 'agent.explain']);
const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Advance fake time in small steps, letting real socket IO + child processes run in between. */
async function pump(clock: FakeClock, ms: number, step = 100): Promise<void> {
  for (let t = 0; t < ms; t += step) {
    clock.advance(Math.min(step, ms - t));
    await realSleep(1);
  }
}

async function runSeed(seed: number) {
  const r = mulberry32(seed);
  const R = { next: r, pick: <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)]!, range: (a: number, b: number): number => a + r() * (b - a) };
  const clock = new FakeClock();
  const L = await startLive({ session: 'default', app: { clock, graceMs: 15_000 } });
  const { mock, app } = L;
  mock.chaos = { rng: r };
  const p1 = mock.pane('w1:p1');
  if (!p1) throw new Error('fixture has w1:p1');
  p1.terminal_title_stripped = '✳ Überprüfe 日本語 ⏺ ⎿'; // multibyte text for the mid-UTF-8 splits
  const msgs: ServerMsg[] = [];
  app.model.on('msg', (m) => msgs.push(m));
  const trace = process.env.HQ_CHAOS_TRACE ? (...a: unknown[]) => console.log(clock.now() - 1_727_400_000_000, ...a) : () => {};
  app.model.on('msg', (m) => (m.t === 'gone' || (m.t === 'event' && (m.kind === 'left' || m.kind === 'arrived')) || m.t === 'herdr') && trace('MSG', JSON.stringify(m)));
  // pane lineage = terminal_id without the mock's per-rekey '_r' suffixes (the model may learn a rekey after the
  // chaos already closed the renamed pane, so ids alone cannot tell a real close from an exodus)
  const lineage = (tid: unknown): string => String(tid).replace(/(_r)+$/, '');
  const removed = new Set();
  const termOf = new Map<string, string | null>(); // model id → terminalId, from every entity the model sent
  for (const e of app.model.entities.values()) termOf.set(e.id, e.terminalId);
  app.model.on('msg', (m) => m.t === 'entity' && termOf.set(m.entity.id, m.entity.terminalId));
  let added = 0, restarts = 0;
  // a WS viewer with an observe terminal open on a shell, kept through the chaos
  const c = await connect(app.port, { cid: `chaos${seed}` });
  const shell = [...app.model.entities.values()].find((e) => e.kind === 'shell');
  if (!shell) throw new Error('demo world has a shell');
  const opening = c.call({ t: 'term.open', id: shell.id, cols: 80, rows: 24 });
  await pump(clock, 500);
  await opening;
  try {
    for (let i = 0; i < 40; i++) {
      const a = R.next();
      if (a < 0.3) {
        const ag = mock.raw.agents.length ? R.pick(mock.raw.agents) : null;
        if (ag) mock.setStatus(ag.pane_id, R.pick(['working', 'idle', 'done', 'blocked']));
      } else if (a < 0.45) {
        const id = `w${R.pick([1, 2])}:p${1000 * ++added}`;
        trace('ADD', id);
        mock.addPane({ id, ws: id.split(':')[0], agent: R.next() < 0.5 ? 'claude' : null, name: `ag${added}`, status: 'idle', cwd: `/tmp/c${added}` });
      } else if (a < 0.55 && mock.raw.panes.length > 3) {
        const p = R.pick(mock.raw.panes);
        removed.add(lineage(p.terminal_id));
        trace('REMOVE', p.pane_id);
        mock.removePane(p.pane_id);
      } else if (a < 0.65) {
        trace('DROPSUBS');
        mock.dropSubscriptions();
      }
      else if (a < 0.73) {
        restarts++;
        trace('STOP');
        await mock.stop();
        await pump(clock, R.range(200, 6000));
        const rk = R.next() < 0.6;
        trace('RESTART', rk);
        await mock.restart({ rekey: rk });
      }
      await pump(clock, R.range(50, 900));
      // invariant at every step: never two entities for one pane identity
      const keys = [...app.model.entities.values()].map((e) => identityKey(e.identity));
      assert.equal(new Set(keys).size, keys.length, `seed ${seed} step ${i}: duplicate entities`);
    }
    // past the reconnect grace + a few reconciles; under a loaded test run socket IO lags fake time, so keep pumping
    // (bounded) until the model settled instead of trusting a fixed number of steps
    const herdrIds = () => mock.raw.panes.map((p) => p.pane_id).sort().join();
    await pump(clock, 20_000, 400);
    for (let i = 0; i < 150 && ([...app.model.entities.keys()].sort().join() !== herdrIds() || app.model.inGrace || !app.source.connected); i++) {
      clock.advance(400);
      await realSleep(10);
    }
    // converged: the model holds exactly herdr's panes, once each
    assert.deepEqual([...app.model.entities.keys()].sort(), mock.raw.panes.map((p) => p.pane_id).sort(), `seed ${seed}: model ≠ herdr`);
    // no exodus: only panes the chaos really closed ever left
    const left = msgs.filter((m): m is EventMsg => m.t === 'event' && m.kind === 'left').map((m) => m.id);
    for (const id of left) assert.ok(removed.has(lineage(termOf.get(id))), `seed ${seed}: ${id} left but was never closed (restarts ${restarts})`);
    const spurious = msgs.filter((m): m is GoneMsg => m.t === 'gone' && m.reason === 'closed' && !removed.has(lineage(termOf.get(m.id))));
    assert.deepEqual(spurious, [], `seed ${seed}: spurious gone`);
    // the default session saw READ methods only (terminal children are observe; no promote happened)
    const bad = mock.calls.map((x) => x.method).filter((m) => !READ.has(m));
    assert.deepEqual(bad, [], `seed ${seed}: non-READ calls on the default session`);
  } finally {
    await c.close();
    const closing = app.close();
    for (let i = 0; i < 60 && !(await Promise.race([closing.then(() => true), realSleep(5).then(() => false)])); i++) clock.advance(100);
    await closing;
  }
  // no leaked children: nothing tagged with this instance survives the close
  await realSleep(50);
  const leaked = scanTagged({ bin: FAKE_BIN }).filter((p) => p.instance === app.instanceId);
  assert.deepEqual(leaked, [], `seed ${seed}: leaked terminal children`);
  return { restarts, added, removed: removed.size, msgs: msgs.length, rekeyed: msgs.filter((m) => m.t === 'gone' && m.reason === 'rekeyed').length, statusMsgs: msgs.filter((m) => m.t === 'entity').length };
}

test(`chaos: ${SEEDS} seeds of restarts/rekeys, churn, subscription EOFs and split NDJSON on the default session`, { timeout: 180_000 }, async () => {
  const totals: Record<string, number> = { restarts: 0, added: 0, removed: 0, msgs: 0, rekeyed: 0, statusMsgs: 0 };
  for (let s = Number(process.env.HQ_CHAOS_FROM ?? 1); s <= SEEDS; s++) {
    const r = await runSeed(s);
    for (const [k, v] of Object.entries(r)) totals[k] = (totals[k] ?? 0) + v;
  }
  if (process.env.HQ_CHAOS_VERBOSE) console.log(totals);
  assert.ok(totals.restarts >= SEEDS / 2 && totals.removed > 0 && totals.added > 0, `chaos exercised: ${JSON.stringify(totals)}`);
});
