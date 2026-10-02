import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BARN_ANIMALS, collectEggs, createBarn, eggsLaid, eggsWaiting, emptyBarn, feed, milk, parseBarn, rollDay } from './barn.ts';

const D1 = '2026-10-02', D2 = '2026-10-03';

test('feeding: the right food once a day; every animal fed counts one chores day', () => {
  const d = emptyBarn();
  assert.deepEqual(feed(d, 'cow', 'grain', D1), { ok: false, reason: 'food' });
  assert.deepEqual(feed(d, 'cow', null, D1), { ok: false, reason: 'food' });
  assert.deepEqual(feed(d, 'cow', 'hay', D1), { ok: true, allDone: false });
  assert.deepEqual(feed(d, 'cow', 'hay', D1), { ok: false, reason: 'fed' });
  feed(d, 'donkey', 'hay', D1); feed(d, 'sheep', 'hay', D1);
  assert.deepEqual(feed(d, 'hens', 'grain', D1), { ok: true, allDone: true });
  assert.equal(d.total.days, 1);
  assert.equal(d.total.feeds, 4);
  // a new day: hungry again
  assert.ok(feed(d, 'cow', 'hay', D2).ok);
  assert.deepEqual(d.fed, ['cow']);
});

test('milk only after the cow has eaten, once a day', () => {
  const d = emptyBarn();
  assert.equal(milk(d, D1), 'hungry');
  feed(d, 'cow', 'hay', D1);
  assert.equal(milk(d, D1), 'ok');
  assert.equal(milk(d, D1), 'done');
  assert.equal(d.total.milk, 1);
  rollDay(d, D2);
  assert.equal(milk(d, D2), 'hungry');
});

test('eggs: a few a day, one more when the hens were fed yesterday; collected once', () => {
  for (const day of ['2026-01-01', '2026-05-17', D1, D2]) {
    const n = eggsLaid(day, false);
    assert.ok(n >= 2 && n <= 4, `${day} ${n}`);
    assert.equal(eggsLaid(day, true), n + 1);
  }
  const d = emptyBarn();
  feed(d, 'hens', 'grain', D1);
  const waiting = eggsWaiting(d, D2);
  assert.equal(waiting, eggsLaid(D2, true));
  assert.equal(collectEggs(d, D2), waiting);
  assert.equal(eggsWaiting(d, D2), 0);
  assert.equal(collectEggs(d, D2), 0);
  assert.equal(d.total.eggs, waiting);
});

test('parse is tolerant; the service persists and rolls the day', () => {
  assert.equal(parseBarn(null), null);
  assert.equal(parseBarn({ v: 2 }), null);
  const p = parseBarn({ v: 1, day: 'nope', fed: ['cow', 'cow', 'dragon'], eggs: -3, total: { days: 2.7 } })!;
  assert.deepEqual(p.fed, ['cow']);
  assert.equal(p.day, '');
  assert.equal(p.eggs, 0);
  assert.equal(p.total.days, 2);
  let saved: unknown = null;
  let t = new Date(2026, 9, 2, 9).getTime();
  const svc = createBarn({ load: () => saved, save: (x) => { saved = JSON.parse(JSON.stringify(x)); } }, { now: () => t });
  for (const a of BARN_ANIMALS) svc.feed(a, a === 'hens' ? 'grain' : 'hay');
  assert.equal(svc.data().total.days, 1);
  assert.ok(svc.collectEggs() >= 2);
  const again = createBarn({ load: () => saved, save: () => {} }, { now: () => t });
  assert.equal(again.data().total.days, 1);
  assert.ok(again.fed('cow'));
  t += 86_400_000;
  assert.ok(!again.fed('cow'));
  assert.ok(again.eggsWaiting() >= 3); // fed yesterday: an extra egg
});
