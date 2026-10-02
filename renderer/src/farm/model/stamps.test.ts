import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MOTIFS, STAMPS, STAMP_CATS, TROPHIES, bitsFor, countEvent, createStamps, emptyStamps, emptyWorld, observe, parseStamps, passes,
  progressOf, stampDef, stampsView,
} from './stamps.ts';
import type { StampWorld, StampsData } from './stamps.ts';
import { emptyCollection, recordFind, recordSighting, SIGHTINGS, FISHES } from './collection.ts';
import { emptyFriends, FRIEND_IDS, setHearts } from './friends.ts';
import { emptyWallet, buy, YARD_SLOTS } from './wallet.ts';
import { decorDef } from './shop.ts';
import { FESTIVALS } from './calendar.ts';

const T0 = new Date(2026, 9, 2, 12).getTime();
const DAY = 86_400_000;
const world = (o: Partial<StampWorld> = {}): StampWorld => ({ ...emptyWorld(T0), ...o });
const ok = (id: string, w: StampWorld, m: StampsData = emptyStamps()) => passes(stampDef(id)!, w, m);

test('stamps: ~40 across every category, unique ids, valley voice, known motifs, some secret', () => {
  assert.ok(STAMPS.length >= 38 && STAMPS.length <= 48, String(STAMPS.length));
  assert.equal(new Set(STAMPS.map((s) => s.id)).size, STAMPS.length);
  for (const c of STAMP_CATS) assert.ok(STAMPS.filter((s) => s.cat === c).length >= 4, c);
  for (const s of STAMPS) {
    assert.ok(MOTIFS.includes(s.motif), s.id);
    assert.ok(s.blurb.length > 20 && s.hint.length > 8 && s.name.length > 2, s.id);
  }
  assert.ok(STAMPS.filter((s) => s.secret).length >= 5);
  for (const f of FESTIVALS) assert.ok(stampDef(`fest-${f.id}`), f.id);
  // a fresh book with an empty world earns nothing (except seasons visited stays a progress)
  const m = emptyStamps();
  const w = world();
  observe(m, w);
  assert.deepEqual(STAMPS.filter((s) => passes(s, w, m)).map((s) => s.id), []);
});

test('stamps: trophies at 10 / 25 / all; secret stamps pay more; the gold cup is a real gift decor', () => {
  assert.deepEqual(TROPHIES.map((t) => t.at), [10, 25, STAMPS.length]);
  for (const t of TROPHIES) { const d = decorDef(t.decor); assert.ok(d?.gift, t.decor); }
  assert.ok(bitsFor(stampDef('pen-pal')!) > bitsFor(stampDef('first-fish')!));
});

test('stamps: work stamps follow counters and the Almanac, never in a demo valley', () => {
  const m = emptyStamps();
  assert.equal(ok('first-crate', world(), m), false);
  countEvent(m, 'ship', { demo: false, hour: 14 });
  assert.equal(ok('first-crate', world(), m), true);
  assert.equal(ok('first-crate', world({ demo: true }), m), false, 'demo never earns work');
  assert.equal(countEvent(m, 'ship', { demo: true, hour: 2 }), false);
  assert.equal(m.n.ship, 1);
  assert.equal(ok('midnight-oil', world(), m), false);
  countEvent(m, 'ship', { demo: false, hour: 2.5 });
  assert.equal(ok('midnight-oil', world(), m), true);
  assert.deepEqual(progressOf(stampDef('hundred-crates')!, world(), m), { have: 2, need: 100 });
  for (let i = 0; i < 49; i++) countEvent(m, 'unblocked', { demo: false, hour: 10 });
  assert.equal(ok('answers-50', world(), m), false);
  countEvent(m, 'unblocked', { demo: false, hour: 10 });
  assert.equal(ok('answers-50', world(), m), true);
  assert.equal(ok('streak-7', world({ streak: 6 })), false);
  assert.equal(ok('streak-7', world({ streak: 7 })), true);
  assert.equal(ok('green-10', world({ testsToday: 10 })), true);
  assert.equal(ok('five-at-once', world({ working: 4 })), false);
  assert.equal(ok('five-at-once', world({ working: 5 })), true);
});

test('stamps: a field that lived a week (first seen is remembered; gone fields are forgotten)', () => {
  const m = emptyStamps();
  const plots = [{ id: 'w1', alive: true }];
  observe(m, world({ plots }));
  assert.deepEqual(m.plots.w1, [T0, T0]);
  assert.equal(ok('field-week', world({ now: T0 + 6 * DAY, plots }), m), false);
  observe(m, world({ now: T0 + 6 * DAY, plots }));
  assert.equal(ok('field-week', world({ now: T0 + 7 * DAY, plots }), m), true);
  assert.equal(ok('field-week', world({ now: T0 + 7 * DAY, plots: [{ id: 'w1', alive: false }] }), m), false, 'harvested fields do not count');
  observe(m, world({ now: T0 + 11 * DAY, plots: [] }));
  assert.equal(m.plots.w1, undefined);
  // the demo valley's fields are never remembered
  const d = emptyStamps();
  observe(d, world({ demo: true, plots }));
  assert.deepEqual(d.plots, {});
});

test('stamps: pastimes read the Collections book', () => {
  const c = emptyCollection();
  const w = () => world({ collection: c });
  assert.equal(ok('first-fish', w()), false);
  recordFind(c, 'boot', T0);
  assert.equal(ok('first-fish', w()), false, 'a boot is not a fish');
  assert.equal(ok('odd-boot', w()), true);
  recordFind(c, 'minnow', T0, 6);
  assert.equal(ok('first-fish', w()), true);
  assert.equal(ok('big-catch', w()), false);
  recordFind(c, 'carp', T0, 61);
  assert.equal(ok('big-catch', w()), true);
  for (const f of FISHES.filter((x) => !x.junk && x.seasons.includes('winter'))) recordFind(c, f.id, T0, f.cm[0]);
  assert.equal(ok('season-fish', w()), true);
  for (const id of ['morel', 'wildleek', 'violet', 'berries', 'feather', 'shell', 'skipstone', 'chanterelle', 'acorn']) recordFind(c, id, T0);
  assert.deepEqual(progressOf(stampDef('forage-10')!, w(), emptyStamps()), { have: 9, need: 10 });
  recordFind(c, 'holly', T0);
  assert.equal(ok('forage-10', w()), true);
  for (const s of SIGHTINGS) recordSighting(c, s.id, T0);
  assert.equal(ok('field-guide', w()), true);
});

test('stamps: village reads friendship; home reads the yard', () => {
  const f = emptyFriends();
  const w = () => world({ friends: f });
  for (const id of FRIEND_IDS.slice(1)) setHearts(f, id, 2);
  assert.equal(ok('friendly', w()), false);
  setHearts(f, FRIEND_IDS[0], 2);
  assert.equal(ok('friendly', w()), true);
  setHearts(f, FRIEND_IDS[2], 10);
  assert.equal(ok('best-friend', w()), true);
  f.total.requests = 20;
  assert.equal(ok('requests-20', w()), true);
  for (const id of FRIEND_IDS) f.known[id] = { acorn: 'love' };
  assert.equal(ok('perfect-gifts', w()), true);

  const y = emptyWallet();
  const h = () => world({ wallet: y });
  buy(y, 'welcome', { rank: 99, season: 'spring', autoPlace: true, free: true });
  assert.equal(ok('welcome-home', h()), true);
  assert.equal(ok('first-decor', h()), false, 'a gift is not a purchase');
  buy(y, 'planter', { rank: 0, season: 'spring', autoPlace: true, free: true });
  assert.equal(ok('first-decor', h()), true);
  assert.equal(ok('rank-item', h()), false);
  buy(y, 'lamppost', { rank: 2, season: 'spring', autoPlace: true, free: true });
  assert.equal(ok('rank-item', h()), true);
  while (y.pieces.filter((p) => p.slot !== null).length < YARD_SLOTS) buy(y, 'flamingo', { rank: 0, season: 'spring', autoPlace: true, free: true }).ok || buy(y, 'gnome', { rank: 0, season: 'spring', autoPlace: true, free: true }).ok || buy(y, 'planter', { rank: 0, season: 'spring', autoPlace: true, free: true });
  assert.equal(ok('yard-full', h()), true);
});

test('stamps: places and seasons are remembered as sets', () => {
  const m = emptyStamps();
  const at = (o: Partial<StampWorld['at']>) => ({ ...emptyWorld().at, ...o });
  for (const n of ['pergola', 'picnic', 'lookout', 'hotspring', 'orchard', 'stones', 'haymeadow']) observe(m, world({ at: at({ nook: n }) }));
  observe(m, world({ at: at({ nook: 'pergola' }) }));
  assert.equal(ok('nooks', world(), m), false);
  observe(m, world({ at: at({ nook: 'swingtree' }) }));
  assert.equal(ok('nooks', world(), m), true);
  observe(m, world({ festival: 'harvest', at: at({ festival: false }) }));
  assert.equal(ok('fest-harvest', world(), m), false, 'you have to go to the square');
  observe(m, world({ festival: 'harvest', at: at({ festival: true }) }));
  assert.equal(ok('fest-harvest', world(), m), true);
  for (const s of ['spring', 'summer', 'autumn', 'winter'] as const) observe(m, world({ season: s }));
  assert.equal(ok('four-seasons', world(), m), true);
  assert.equal(ok('summit-night', world({ at: at({ summit: true }), hour: 14 })), false);
  assert.equal(ok('summit-night', world({ at: at({ summit: true }), hour: 22 })), true);
});

test('stamps service: earns once, pays bits, dwell moments must hold, trophies at milestones, persists', () => {
  let saved: unknown = null;
  const paid: [number, string][] = [];
  const gifts: string[] = [];
  let t = T0;
  const svc = createStamps({ load: () => saved, save: (d) => { saved = JSON.parse(JSON.stringify(d)); } }, {
    pay: (c, why) => paid.push([c, why]), gift: (id) => gifts.push(id),
  }, () => t);
  const heard: string[] = [];
  svc.onEarn((e) => heard.push(e.def.id));
  const c = emptyCollection();
  recordFind(c, 'minnow', T0, 7);
  let got = svc.check(world({ collection: c }));
  assert.deepEqual(got.map((e) => e.def.id), ['first-fish']);
  assert.deepEqual(paid, [[10, 'stamp: First bite']]);
  assert.deepEqual(svc.check(world({ collection: c })), [], 'only once');
  // a rainbow must stay in the sky a moment
  const rb = { rainbow: true, shower: false };
  assert.deepEqual(svc.check(world({ now: t, sky: rb })), []);
  assert.deepEqual(svc.check(world({ now: t + 1000, sky: { rainbow: false, shower: false } })), []);
  assert.deepEqual(svc.check(world({ now: t + 2000, sky: rb })), []);
  got = svc.check(world({ now: t + 5100, sky: rb }));
  assert.deepEqual(got.map((e) => e.def.id), ['rainbow']);
  // a commit through the event hook (re-checks against the last world)
  svc.event('ship', { demo: false, hour: 11 });
  assert.ok(heard.includes('first-crate'));
  assert.equal(svc.view().earned, 3);
  // fill to the first trophy
  for (const id of ['summit', 'photo', 'nooks', 'odd-boot', 'pen-pal', 'campfire']) svc.devAward(id);
  assert.equal(gifts.length, 0);
  svc.devAward('cairn-7');
  assert.equal(svc.view().earned, 10);
  assert.deepEqual(gifts, ['trophy-bronze']);
  assert.equal(svc.data().trophies, 1);
  assert.equal(svc.devAward('cairn-7'), null);
  // persisted: a new service sees the same book, dates kept
  const again = createStamps({ load: () => saved, save: () => {} });
  assert.equal(again.view().earned, 10);
  assert.equal(again.view().entries.find((e) => e.def.id === 'first-fish')?.day, '2026-10-02');
  assert.equal(again.data().trophies, 1);
  assert.equal(again.data().n.ship, 1);
});

test('stamps: tolerant parse; the view hides unearned secrets and reports progress', () => {
  assert.equal(parseStamps(null), null);
  assert.equal(parseStamps({ v: 2 }), null);
  const d = parseStamps({ v: 1, earned: { 'first-fish': T0, bogus: T0, rainbow: 'x' }, n: { ship: 3.7, answered: -1 }, plots: { a: [1, 2], b: 'x' }, nooks: ['pergola', 'pergola', 3], fests: ['harvest', 'nope'], seasons: ['winter', 'monsoon'], trophies: 9 })!;
  assert.deepEqual(d.earned, { 'first-fish': T0 });
  assert.deepEqual(d.n, { ship: 3, answered: 0, photo: 0, late: 0 });
  assert.deepEqual(d.plots, { a: [1, 2] });
  assert.deepEqual(d.nooks, ['pergola']);
  assert.deepEqual(d.fests, ['harvest']);
  assert.deepEqual(d.seasons, ['winter']);
  assert.equal(d.trophies, TROPHIES.length);
  const v = stampsView(d, world({ stones: 3 }));
  assert.equal(v.earned, 1);
  assert.equal(v.total, STAMPS.length);
  assert.equal(v.entries.find((e) => e.def.id === 'pen-pal')?.hidden, true);
  assert.equal(v.entries.find((e) => e.def.id === 'first-fish')?.hidden, false);
  assert.deepEqual(v.entries.find((e) => e.def.id === 'cairn-7')?.progress, { have: 3, need: 7 });
  assert.equal(v.byCat.pastimes.earned, 1);
  assert.equal(v.bits, 10);
});
