import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeClock, RealClock } from './clock.ts';

test('FakeClock fires due timers in order, intervals repeat, clear works', () => {
  const c = new FakeClock(1000);
  const log: (string | number)[] = [];
  c.setTimeout(() => log.push('b'), 20);
  c.setTimeout(() => log.push('a'), 10);
  const iv = c.setInterval(() => log.push(`i${c.now()}`), 15);
  const x = c.setTimeout(() => log.push('never'), 5);
  c.clearTimeout(x);
  c.advance(31);
  assert.deepEqual(log, ['a', 'i1015', 'b', 'i1030']);
  c.clearInterval(iv);
  c.advance(100);
  assert.equal(c.pending, 0);
  assert.equal(c.now(), 1131);
});

test('FakeClock runs timers scheduled while advancing if due', () => {
  const c = new FakeClock(0);
  const log: (string | number)[] = [];
  c.setTimeout(() => c.setTimeout(() => log.push(c.now()), 5), 5);
  c.advance(10);
  assert.deepEqual(log, [10]);
});

test('RealClock scales now()', async () => {
  const c = RealClock(10);
  const t0 = c.now();
  await new Promise<void>((r) => c.setTimeout(() => r(), 200)); // ≈ 20 ms wall
  assert.ok(c.now() - t0 >= 150, `scaled time advanced ${c.now() - t0}`);
  assert.equal(c.timescale, 10);
});

