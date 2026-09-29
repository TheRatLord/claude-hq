// M3.5 chalkboards: tool / test tallies, throughput, layout (pure parts of chalk.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createToolTally, createTestTally, createThroughput, steamFor, tallyLayout, toolLabel, shortN } from './chalk.ts';

test('tool tally: top 3 today, seeded once per agent, resets at midnight', () => {
  const t = createToolTally();
  const now = new Date(2026, 8, 28, 12).getTime();
  for (const [k, n] of [['Read', 5], ['Edit', 3], ['Bash', 3], ['Grep', 1]] as const) for (let i = 0; i < n; i++) t.add(k, now);
  t.seed([{ id: 'a', activity: { tool: 'Grep' } }], now);
  t.seed([{ id: 'a', activity: { tool: 'Grep' } }], now);
  assert.deepEqual(t.top(3, now), [{ tool: 'Read', n: 5 }, { tool: 'Bash', n: 3 }, { tool: 'Edit', n: 3 }]);
  assert.equal(t.counts.get('Grep'), 2);
  assert.deepEqual(t.top(3, new Date(2026, 8, 29, 1).getTime()), []);
});

test('test tally: chronological, deduped, today only', () => {
  const t = createTestTally();
  const now = Date.now();
  assert.ok(t.add('test-pass', now - 1000));
  assert.ok(t.add('test-fail', now - 3000, 'k1', false));
  assert.equal(t.add('test-fail', now - 3000, 'k1', false), false);
  assert.equal(t.add('commit', now), false);
  assert.equal(t.add('test-pass', now - 3 * 86400e3), false);
  assert.deepEqual(t.marks.map((m) => m.ok), [false, true]);
  assert.equal(t.pass, 1); assert.equal(t.fail, 1);
});

test('throughput: output-token deltas per second, resets ignored', () => {
  const tp = createThroughput(1);
  tp.sample([{ id: 'a', outputTokens: 100 }, { id: 'b', outputTokens: 50 }], 0);
  assert.equal(tp.sample([{ id: 'a', outputTokens: 300 }, { id: 'b', outputTokens: 10 }], 2), 100);
  assert.ok(steamFor(0) === 0.6 && steamFor(1e6) === 2.5 && steamFor(100) > steamFor(10));
});

test('tally layout: groups of five, overflow notes, rows inside the board, labels', () => {
  for (const [W, H] of [[768, 445], [640, 440]]) {
    const L = tallyLayout(W, H, 23, 3);
    assert.equal(L.groups, 5); assert.equal(L.passMore, 0); assert.equal(L.failShown, 3);
    assert.ok(L.m + L.perRow * L.gw <= W - L.colW - L.m + 0.5, 'marks clear the count column');
    assert.ok(L.failY + L.cd / 2 <= H - L.m + 0.5, 'fail row inside');
    const M = tallyLayout(W, H, 500, 40);
    assert.ok(M.passMore > 0 && M.failMore > 0 && M.passShown % 5 === 0);
  }
  assert.equal(toolLabel('mcp__github__create_pr'), 'create_pr');
  assert.equal(shortN(1234), '1.2k');
});
