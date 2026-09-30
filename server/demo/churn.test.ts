// Leak test: `churn` for 10 simulated minutes under FakeClock through the whole app (WorldModel, enrichers, fake
// terminals, WS hub), then quiesce → /debug/metrics gauges equal the pre-run baseline (cumulative counters excluded).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeClock } from '../clock.ts';
import { startApp, TOKEN } from '../test/harness.ts';

/** the /debug/metrics fields this test reads */
interface ChurnMetrics {
  world: { entities: number; inGrace: boolean; connected: boolean };
  terminals: { panes: number; children: unknown; viewers: number; orphans: number; mirrors: number };
  enrichers: unknown;
  screens: { watched: number; clients: number };
}

async function metrics(port: number) {
  const r = await fetch(`http://127.0.0.1:${port}/debug/metrics`, { headers: { Authorization: `Bearer ${TOKEN}`, Cookie: `hq_token=${TOKEN}` } });
  assert.equal(r.status, 200);
  const m = await r.json() as ChurnMetrics;
  // gauges only: counters (events, spawns, rekeys…) legitimately grow
  return {
    entities: m.world.entities,
    inGrace: m.world.inGrace,
    connected: m.world.connected,
    terminals: { panes: m.terminals.panes, children: m.terminals.children, viewers: m.terminals.viewers, orphans: m.terminals.orphans, mirrors: m.terminals.mirrors },
    enrichers: m.enrichers,
    screens: { watched: m.screens.watched, clients: m.screens.clients },
  };
}

test('churn: 10 simulated minutes, then quiesce → /debug/metrics back to baseline', { timeout: 60_000 }, async () => {
  const clock = new FakeClock();
  const app = await startApp({ clock, scenario: 'empty', metrics: true, demo: 12 });
  try {
    const run = async (ms: number, step = 500): Promise<void> => {
      for (let t = 0; t < ms; t += step) {
        clock.advance(step);
        for (let i = 0; i < 4; i++) await null;
      }
    };
    await run(5000);
    const pending0 = clock.pending;
    const base = await metrics(app.port);
    app.source.scenario('churn');
    await run(10 * 60_000);
    const mid = await metrics(app.port);
    assert.ok(mid.entities > 0, 'churn populated the world');
    app.source.scenario('empty');
    await run(60_000);
    assert.deepEqual(await metrics(app.port), base);
    assert.equal(app.source.metrics().timers, 0, 'no demo timers left');
    assert.equal(clock.pending, pending0, `timers back to baseline (${clock.pending} vs ${pending0})`);
  } finally {
    await app.close();
  }
});
