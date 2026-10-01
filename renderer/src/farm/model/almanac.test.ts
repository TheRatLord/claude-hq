import { test } from 'node:test';
import assert from 'node:assert/strict';
import { almanacView, dayKey, demoAlmanac, emptyAlmanac, HARVEST, parseAlmanac, RANKS, rankAt, recapDue, recapLetter, recordHarvest, STAR_POINTS, UPGRADES } from './almanac.ts';
import { createValley } from './valley.ts';
import type { ValleySource } from './valley.ts';
import type { ValleyEvent } from './types.ts';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

test('almanac: every rank above the first brings one upgrade, ranks ascend', () => {
  assert.equal(UPGRADES.length, RANKS.length - 1);
  for (let i = 1; i < RANKS.length; i++) assert.ok(RANKS[i].at > RANKS[i - 1].at);
  assert.equal(rankAt(0), 0);
  assert.equal(rankAt(RANKS[3].at), 3);
  assert.equal(rankAt(RANKS[3].at - 1), 2);
});

test('almanac: harvests earn points, tally per day, and rank up', () => {
  const d = emptyAlmanac();
  const t = at(2026, 10, 1);
  let ups = 0;
  for (let i = 0; i < 4; i++) ups += recordHarvest(d, 'commit', t).rankUp ? 1 : 0;
  assert.equal(d.points, 40);
  assert.equal(ups, 1, 'crossing 40 points reaches Smallholding once');
  const v = almanacView(d, t);
  assert.equal(v.name, 'Smallholding');
  assert.deepEqual(v.unlocked, ['bunting']);
  assert.equal(v.next?.id, 'planters');
  assert.equal(v.today.counts.commit, 4);
  assert.equal(v.today.points, 40);
  assert.equal(d.since, t);
});

test('almanac: daily caps stop a busy loop farming points, but still count', () => {
  const d = emptyAlmanac();
  const t = at(2026, 10, 1);
  for (let i = 0; i < HARVEST.tests.cap + 10; i++) recordHarvest(d, 'tests', t);
  assert.equal(d.points, HARVEST.tests.cap * HARVEST.tests.points);
  assert.equal(d.days[0].counts.tests, HARVEST.tests.cap + 10);
  // a new day resets the cap
  assert.equal(recordHarvest(d, 'tests', at(2026, 10, 2)).earned, HARVEST.tests.points);
});

test('almanac: week, streak and best', () => {
  const d = emptyAlmanac();
  recordHarvest(d, 'commit', at(2026, 9, 28));
  recordHarvest(d, 'commit', at(2026, 9, 29));
  recordHarvest(d, 'finished', at(2026, 9, 30));
  recordHarvest(d, 'finished', at(2026, 9, 30));
  // today (Oct 1) has nothing yet: the streak still counts up to yesterday
  let v = almanacView(d, at(2026, 10, 1));
  assert.equal(v.streak, 3);
  assert.equal(v.week.length, 7);
  assert.equal(v.week[6].date, '2026-10-01');
  assert.deepEqual(v.week.slice(3).map((w) => w.points), [10, 10, 12, 0]);
  assert.equal(v.best, 12);
  recordHarvest(d, 'answered', at(2026, 10, 1));
  v = almanacView(d, at(2026, 10, 1));
  assert.equal(v.streak, 4);
  // a gap breaks it
  assert.equal(almanacView(d, at(2026, 10, 4)).streak, 0);
});

test('almanac: past the last rank, stars', () => {
  const d = emptyAlmanac();
  d.points = RANKS[RANKS.length - 1].at + STAR_POINTS * 2 + STAR_POINTS / 2;
  const v = almanacView(d, at(2026, 10, 1));
  assert.equal(v.rank, RANKS.length - 1);
  assert.equal(v.stars, 2);
  assert.ok(Math.abs(v.progress - 0.5) < 1e-9);
  assert.equal(v.next, null);
  assert.equal(v.unlocked.length, UPGRADES.length);
});

test('almanac: parse is tolerant and round-trips', () => {
  assert.equal(parseAlmanac(null), null);
  assert.equal(parseAlmanac({ v: 2 }), null);
  assert.equal(parseAlmanac({ v: 1, points: 'x', days: [] }), null);
  const d = emptyAlmanac();
  recordHarvest(d, 'commit', at(2026, 10, 1));
  const back = parseAlmanac(JSON.parse(JSON.stringify(d)));
  assert.deepEqual(back, d);
  const junk = parseAlmanac({ v: 1, points: 5, days: [{ date: 'nope', points: 1 }, { date: '2026-10-01', points: 5, counts: { commit: 1, bogus: 3 } }] });
  assert.deepEqual(junk?.days, [{ date: '2026-10-01', points: 5, counts: { commit: 1 } }]);
});

test('almanac: dayKey is the local date', () => {
  assert.equal(dayKey(at(2026, 1, 5, 0)), '2026-01-05');
  assert.equal(dayKey(at(2026, 12, 31, 23)), '2026-12-31');
});

test('almanac: demo lands near the requested points over the past fortnight', () => {
  const now = at(2026, 10, 1);
  const d = demoAlmanac(now, 900);
  assert.equal(d.points, 900);
  assert.equal(demoAlmanac(now, 5000).points, 5000);
  assert.ok(d.days.length > 5);
  assert.ok(d.days.every((x) => x.date < '2026-10-01'));
});

test('valley: harvest events feed the almanac, persist, and emit level-up', () => {
  let stored: unknown = null;
  const src: ValleySource = { entities: () => [], workspaces: () => [], stats: () => null, now: () => 0, link: () => 'live', demo: () => false };
  const v = createValley(src, { wallNow: () => at(2026, 10, 1), almanac: { load: () => stored, save: (d) => { stored = JSON.parse(JSON.stringify(d)); } } });
  const seen: ValleyEvent[] = [];
  v.on((e) => seen.push(e));
  for (let i = 0; i < 4; i++) v.ingest({ t: 'event', id: 'p1', kind: 'commit' });
  assert.equal(v.state.almanac.points, 40);
  assert.equal(v.state.almanac.name, 'Smallholding');
  assert.equal(seen.filter((e) => e.kind === 'level-up').length, 1);
  assert.equal(seen.find((e) => e.kind === 'level-up')?.detail, 'Smallholding');
  assert.equal((stored as { points: number }).points, 40);
  // a fresh valley picks it up again
  const v2 = createValley(src, { wallNow: () => at(2026, 10, 1), almanac: { load: () => stored, save: () => {} } });
  assert.equal(v2.state.almanac.points, 40);
});

test('recap: the Mayor writes once an evening, only after a harvest', () => {
  const d = emptyAlmanac();
  const morning = at(2026, 10, 1, 9), evening = at(2026, 10, 1, 19), next = at(2026, 10, 2, 19);
  recordHarvest(d, 'commit', morning);
  recordHarvest(d, 'tests', morning);
  assert.equal(recapDue(d, morning), false); // too early
  assert.equal(recapDue(d, evening), true);
  d.recap = dayKey(evening);
  assert.equal(recapDue(d, evening), false); // already posted
  assert.equal(recapDue(d, next), false); // nothing harvested on the 2nd
  assert.equal(parseAlmanac(JSON.parse(JSON.stringify(d)))?.recap, '2026-10-01');
  const r = recapLetter(almanacView(d, evening));
  assert.equal(r.title, "Today's harvest: +14 prosperity");
  assert.match(r.body, /shipped 1 commit and passed 1 test run: 14 prosperity in all\./);
  assert.match(r.body, /26 short of Smallholding, and with it bunting over the square\./);
  assert.match(r.body, /Mayor Marigold$/);
  assert.doesNotMatch(r.body, /best day/); // the first day ever is not a record
});

test('recap: the valley posts it as a news letter from the Mayor, once', () => {
  let wall = at(2026, 10, 1, 15);
  const src: ValleySource = { entities: () => [], workspaces: () => [], stats: () => null, now: () => 0, link: () => 'live', demo: () => false };
  const v = createValley(src, { wallNow: () => wall });
  v.ingest({ t: 'event', id: 'p1', kind: 'commit' });
  for (let i = 0; i < 12; i++) v.tick();
  const recaps = () => v.state.letters.filter((l) => l.farmerId === 'villager:marigold');
  assert.equal(recaps().length, 0); // 3 pm: not yet
  wall = at(2026, 10, 1, 18);
  v.tick();
  assert.equal(recaps().length, 1);
  assert.equal(recaps()[0].kind, 'news');
  assert.equal(recaps()[0].farmerName, 'Mayor Marigold');
  assert.match(recaps()[0].title, /\+10 prosperity/);
  for (let i = 0; i < 5; i++) v.tick();
  assert.equal(recaps().length, 1);
});
