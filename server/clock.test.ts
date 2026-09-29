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

test('lint: no bare Date.now/setTimeout/setInterval in server/ except clock.ts (§4.13)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = path.dirname(new URL(import.meta.url).pathname);
  const bad: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'test') walk(p); // server/test/ = test helpers
      }
      else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith(`${path.sep}clock.ts`)) {
        fs.readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
          const code = l.replace(/^\s*(\*|\/\/).*$/, '');
          if (/Date\.now\(|(^|[^.\w])set(Timeout|Interval)\(/.test(code)) bad.push(`${path.relative(root, p)}:${i + 1}`);
        });
      }
    }
  };
  walk(root);
  assert.deepEqual(bad, []);
});
