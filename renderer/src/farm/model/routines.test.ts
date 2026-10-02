import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLACES, VILLAGER_KEYS, entryAt, fairCond, nowText, overlay, partOf, placeIndoors, planFor, routineAt, usualEntry, usualLines, usualSentence, wet,
} from './routines.ts';
import type { RoutineCond, RoutineEntry } from './routines.ts';

const at = (plan: readonly RoutineEntry[], hour: number, c: Partial<RoutineCond> = {}) => routineAt(plan, hour, { weather: 'clear', intensity: 0, ...c });

test('every villager has a full, sorted day: up in the morning, at work, lunch, an evening spot, asleep at night', () => {
  for (const k of VILLAGER_KEYS) {
    const p = planFor(k, fairCond());
    assert.ok(p.length >= 5, k);
    for (let i = 1; i < p.length; i++) assert.ok(p[i].from > p[i - 1].from, `${k} sorted`);
    for (const e of p) assert.ok(e.place in PLACES && e.doing.length > 3, `${k}: ${e.place}`);
    const kinds = new Set(p.map((e) => e.kind));
    for (const want of ['lunch', 'evening', 'sleep'] as const) assert.ok(kinds.has(want), `${k} has ${want}`);
    assert.ok(kinds.has('work') || kinds.has('round'), `${k} works`);
    // somewhere every quarter hour, all day
    for (let h = 0; h < 24; h += 0.25) assert.ok(at(p, h).entry >= 0);
  }
});

test('asleep at 3 am, everybody but the night owl; and the owl sleeps all morning instead', () => {
  for (const k of VILLAGER_KEYS) {
    const p = planFor(k, fairCond());
    if (k === 'nimbus') {
      assert.equal(at(p, 0.5).kind, 'evening', 'up past midnight');
      assert.equal(at(p, 8).kind, 'sleep');
      assert.equal(at(p, 22).place, 'knoll');
    } else assert.equal(at(p, 3).kind, 'sleep', k);
  }
  // indoor homes go dark; the ranger sleeps out by the fire
  assert.ok(placeIndoors('farmhouse') && placeIndoors('loft') && placeIndoors('toolshed') && !placeIndoors('campbed'));
});

test('the posts: where the job is', () => {
  const where = (k: string, h: number) => at(planFor(k, fairCond()), h).place;
  assert.equal(where('posy', 9), 'mailbox');
  assert.equal(where('posy', 6.5), 'porch', 'tea on the porch first');
  assert.equal(where('bram', 10), 'bin');
  assert.equal(where('hazel', 7), 'mill');
  assert.equal(where('marigold', 10), 'noticeboard');
  assert.equal(where('marigold', 14.5), 'board');
  assert.equal(where('fern', 7.5), 'signpost');
  assert.equal(where('nimbus', 17.5), 'knoll');
});

test('afternoon pastimes, and the restored projects change them', () => {
  const where = (k: string, h: number, c: Partial<RoutineCond> = {}) => at(planFor(k, fairCond(c)), h).place;
  assert.equal(where('posy', 16), 'orchard');
  assert.equal(where('posy', 16, { restored: ['glasshouse'] }), 'glasshouse');
  assert.equal(where('hazel', 16), 'millwheel', 'she sits by the old mill, wheel or no wheel');
  assert.equal(where('bram', 17.2), 'bridge');
  assert.equal(where('marigold', 16.5), 'hotspring');
  assert.equal(where('marigold', 16.5, { restored: new Set(['halt']) }), 'halt');
  assert.equal(where('fern', 14.5, { restored: ['glasshouse'] }), 'glasshouse');
  assert.equal(where('nimbus', 21), 'knoll');
  assert.equal(where('nimbus', 21, { restored: ['observatory'] }), 'observatory');
});

test('Fern walks out to the stones with her lantern at night (not in the wet), and does her rounds by day', () => {
  const p = planFor('fern', fairCond());
  assert.equal(at(p, 22.7).place, 'stones');
  assert.equal(at(p, 23.9).place, 'campbed');
  const rounds = new Set<string>();
  for (let h = 9.4; h < 11.2; h += 0.1) rounds.add(at(p, h).place);
  assert.ok(rounds.size >= 3, 'she moves between stops');
  assert.notEqual(at(planFor('fern', fairCond({ weather: 'rain', intensity: 0.6 })), 22.7).place, 'stones');
});

test('weather: wet days move the picnic under a roof; storms send everyone not asleep indoors to shelter', () => {
  const rainy = fairCond({ weather: 'rain', intensity: 0.6 });
  assert.ok(wet(rainy) && !wet(fairCond({ weather: 'rain', intensity: 0.1 })));
  assert.equal(at(planFor('posy', fairCond()), 12.5).place, 'picnic');
  assert.equal(at(planFor('posy', rainy), 12.5, rainy).place, 'pergola');
  assert.equal(at(planFor('marigold', rainy), 16.5, rainy).place, 'pergola', 'checkers instead of the hot spring');
  assert.equal(at(planFor('posy', fairCond()), 10, { weather: 'storm', intensity: 0.5 }).kind, 'shelter');
  assert.equal(at(planFor('posy', fairCond()), 23.5, { weather: 'storm', intensity: 1 }).kind, 'sleep', 'asleep indoors: stays put');
  assert.equal(at(planFor('fern', fairCond()), 2, { weather: 'storm', intensity: 1 }).kind, 'shelter', 'sleeping out: shelters');
  assert.equal(at(planFor('posy', fairCond({ season: 'winter' })), 12.5).place, 'pergola', 'no picnics in the snow');
  assert.equal(at(planFor('posy', fairCond({ season: 'winter' })), 16).place, 'pond', 'watching the skaters');
});

test('festivals pull everyone to the square for part of the afternoon; Sundays are different for Bram and the Mayor', () => {
  for (const k of VILLAGER_KEYS) {
    const p = planFor(k, fairCond({ festival: 'harvest' }));
    let saw = false;
    for (let h = 13; h < 17.5; h += 0.1) if (at(p, h).place === 'festival') saw = true;
    assert.ok(saw, `${k} goes to the festival`);
    assert.equal(at(p, 3).kind, at(planFor(k, fairCond()), 3).kind, 'and still goes to bed');
  }
  assert.equal(at(planFor('bram', fairCond({ dow: 0 })), 10).place, 'bridge', 'Sunday: fishing');
  assert.equal(at(planFor('marigold', fairCond({ dow: 0 })), 10).place, 'picnic');
  assert.equal(at(planFor('bram', fairCond({ dow: 2 })), 10).place, 'bin');
});

test('overlay: an insert resumes whatever was on at its end', () => {
  const p: RoutineEntry[] = [{ from: 7, kind: 'work', place: 'mailbox', doing: 'a' }, { from: 12, kind: 'lunch', place: 'picnic', doing: 'b' }, { from: 22, kind: 'sleep', place: 'farmhouse', doing: 'c' }];
  const o = overlay(p, { from: 10, kind: 'pastime', place: 'festival', doing: 'x' }, 11);
  assert.deepEqual(o.map((e) => [e.from, e.place]), [[7, 'mailbox'], [10, 'festival'], [11, 'mailbox'], [12, 'picnic'], [22, 'farmhouse']]);
  assert.equal(entryAt(o, 10.5), 1);
});

test('words: usually / now', () => {
  const fern = planFor('fern', fairCond({ restored: ['glasshouse'] }));
  assert.equal(usualSentence('Fern', fern, 'afternoon'), 'Fern is usually at the glasshouse in the afternoon.');
  assert.equal(usualSentence('Posy', planFor('posy', fairCond()), 'morning'), 'Posy is usually at the mailbox in the morning.');
  assert.equal(usualSentence('Nimbus', planFor('nimbus', fairCond()), 'morning'), 'Nimbus is usually asleep in the windmill loft in the morning.');
  const lines = usualLines(planFor('hazel', fairCond()));
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^mornings at the windmill/);
  assert.match(lines[1], /old river mill/);
  assert.match(lines[2], /under the windmill sails/);
  assert.match(lines[3], /asleep in the windmill/);
  assert.equal(usualEntry([], 'morning'), null);
  assert.equal(partOf(9), 'morning'); assert.equal(partOf(14), 'afternoon'); assert.equal(partOf(20), 'evening'); assert.equal(partOf(2), 'night');
  assert.equal(nowText(at(planFor('posy', fairCond()), 9)), 'sorting the post at the mailbox');
  assert.equal(nowText(at(planFor('posy', fairCond()), 9, { weather: 'storm', intensity: 1 })), 'sheltering from the storm');
  assert.equal(planFor('nobody', fairCond()).length, 0);
});
