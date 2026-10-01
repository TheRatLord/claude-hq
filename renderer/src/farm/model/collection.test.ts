import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOG, FISHES, FORAGE, FORAGE_PER_DAY, biteDelay, canBite, collectionView, createCollection, emptyCollection, fishOdds, forageDay,
  forageFor, isNight, parseCollection, pickForage, pickedOn, rand, recordFind, rollFish, whereText,
} from './collection.ts';
import type { CollectionData, FishConditions } from './collection.ts';
import type { Season } from './types.ts';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];

test('collection: catalog ids are unique, every season has forage and fish, flavour text everywhere', () => {
  assert.equal(new Set(CATALOG.map((d) => d.id)).size, CATALOG.length);
  for (const s of SEASONS) {
    assert.ok(forageFor(s).length >= 3, `${s} forage`);
    assert.ok(FISHES.filter((f) => f.seasons.includes(s)).length >= 4, `${s} fish`);
  }
  for (const d of CATALOG) { assert.ok(d.blurb.length > 20, d.id); assert.ok(whereText(d).length > 4); }
});

test('collection: forage days are deterministic, 8–12 items of the season, every common kind present', () => {
  for (const s of SEASONS) {
    const a = forageDay('2026-10-01', s), b = forageDay('2026-10-01', s);
    assert.deepEqual(a, b);
    assert.ok(a.length >= FORAGE_PER_DAY.min && a.length <= FORAGE_PER_DAY.max);
    const ids = new Set(a.map((x) => x.id));
    for (const k of forageFor(s)) if (!k.rare) assert.ok(ids.has(k.id), `${s}: ${k.id}`);
    for (const x of a) assert.ok(forageFor(s).some((k) => k.id === x.id));
    assert.equal(new Set(a.map((x) => x.key)).size, a.length);
  }
  assert.notDeepEqual(forageDay('2026-10-01', 'autumn').map((x) => x.seed), forageDay('2026-10-02', 'autumn').map((x) => x.seed));
});

test('collection: night-only fish only at night, rain-only only in the rain, river fish not in the pond', () => {
  const day: FishConditions = { season: 'spring', hour: 13, weather: 'clear', water: 'river' };
  const ids = (c: FishConditions) => fishOdds(c).map((o) => o.def.id);
  assert.ok(!ids(day).includes('catfish'));
  assert.ok(ids({ ...day, hour: 23 }).includes('catfish'));
  assert.ok(!ids({ ...day, hour: 23 }).includes('eel'), 'eels need rain too');
  assert.ok(ids({ ...day, hour: 23, weather: 'rain' }).includes('eel'));
  assert.ok(!ids({ ...day, water: 'pond' }).includes('trout'));
  assert.ok(!ids({ ...day, water: 'pond' }).includes('stormbass'));
  assert.ok(ids({ ...day, water: 'pond', weather: 'storm' }).includes('stormbass'));
  assert.ok(ids({ season: 'winter', hour: 2, weather: 'clear', water: 'river' }).includes('char'));
  assert.ok(!ids({ season: 'winter', hour: 2, weather: 'snow', water: 'river' }).includes('char'));
  assert.ok(isNight(21) && isNight(3) && !isNight(12));
  // something always bites, anywhere, any time
  for (const season of SEASONS) for (const water of ['pond', 'river'] as const) for (let hour = 0; hour < 24; hour += 1.5) {
    for (const weather of ['clear', 'rain', 'snow', 'fog'] as const) assert.ok(fishOdds({ season, hour, weather, water }).some((o) => !o.def.junk));
  }
  // every fish is catchable somewhere, some time
  for (const f of FISHES) {
    let ok = false;
    for (const season of SEASONS) for (const water of f.water) for (let hour = 0; hour < 24; hour += 0.5) for (const weather of ['clear', 'rain'] as const) ok ||= canBite(f, { season, hour, weather, water });
    assert.ok(ok, f.id);
  }
});

test('collection: rolls are seeded, sizes in range, bites come quickly', () => {
  const c: FishConditions = { season: 'summer', hour: 10, weather: 'clear', water: 'pond' };
  const a = rollFish(rand(7), c), b = rollFish(rand(7), c);
  assert.deepEqual(a, b);
  for (let i = 0; i < 200; i++) {
    const r = rand(i);
    const f = rollFish(r, c);
    const d = FISHES.find((x) => x.id === f.id)!;
    assert.ok(canBite(d, c));
    if (!d.junk) assert.ok(f.cm >= d.cm[0] && f.cm <= d.cm[1]);
    const t = biteDelay(r, c);
    assert.ok(t > 1 && t < 8);
  }
});

test('collection: finds count up, remember the first day and the best size', () => {
  const d = emptyCollection();
  const r1 = recordFind(d, 'carp', at(2026, 10, 1), 40)!;
  assert.equal(r1.isNew, true);
  assert.equal(r1.record, false, 'the first one is not a "record"');
  const r2 = recordFind(d, 'carp', at(2026, 10, 3), 61)!;
  assert.equal(r2.isNew, false);
  assert.equal(r2.n, 2);
  assert.equal(r2.record, true);
  assert.equal(recordFind(d, 'carp', at(2026, 10, 3), 50)!.record, false);
  assert.deepEqual(d.found.carp, { n: 3, first: '2026-10-01', best: 61 });
  assert.equal(recordFind(d, 'nope', at(2026, 10, 1)), null);
  const v = collectionView(d, 'autumn', at(2026, 10, 3));
  assert.equal(v.found, 1);
  assert.equal(v.total, CATALOG.length);
  assert.equal(v.fishToday, 2);
  assert.equal(v.forage.total, FORAGE.length);
});

test('collection: a forage spot is picked once per day and comes back tomorrow', () => {
  const d = emptyCollection();
  const [s] = forageDay('2026-10-01', 'autumn');
  assert.ok(pickForage(d, s, at(2026, 10, 1)));
  assert.equal(pickForage(d, s, at(2026, 10, 1)), null);
  assert.ok(pickedOn(d, '2026-10-01').has(s.key));
  const [t] = forageDay('2026-10-02', 'autumn');
  assert.ok(pickForage(d, t, at(2026, 10, 2)));
  assert.equal(pickedOn(d, '2026-10-01').size, 0, 'yesterday is forgotten');
  assert.equal(d.found[s.id].n, s.id === t.id ? 2 : 1);
});

test('collection: parse is tolerant and round-trips', () => {
  assert.equal(parseCollection(null), null);
  assert.equal(parseCollection({ v: 2 }), null);
  const d: CollectionData = { v: 1, found: { carp: { n: 2, first: '2026-09-30', best: 50 }, bogus: { n: 1, first: '2026-09-30' } as never, morel: { n: 0, first: 'x' } as never }, picked: { day: '2026-10-01', keys: ['a', 3 as never] } };
  const p = parseCollection(JSON.parse(JSON.stringify(d)))!;
  assert.deepEqual(Object.keys(p.found), ['carp']);
  assert.deepEqual(p.picked.keys, ['a']);
  assert.deepEqual(parseCollection(JSON.parse(JSON.stringify(p))), p);
});

test('collection: the live book saves, notifies and survives a bad store', () => {
  let saved: unknown = null;
  const c = createCollection({ load: () => saved, save: (x) => { saved = JSON.parse(JSON.stringify(x)); } }, () => at(2026, 10, 1));
  const seen: string[] = [];
  c.onFind((r) => seen.push(`${r.def.id}:${r.isNew}`));
  c.catch('minnow', 6);
  c.catch('minnow', 7);
  assert.deepEqual(seen, ['minnow:true', 'minnow:false']);
  assert.equal(c.version, 2);
  const again = createCollection({ load: () => saved, save: () => {} });
  assert.equal(again.data().found.minnow.n, 2);
  const broken = createCollection({ load: () => { throw new Error('blocked'); }, save: () => { throw new Error('full'); } });
  assert.ok(broken.catch('carp', 40)?.isNew);
  c.devFill(5);
  assert.equal(c.view('autumn').found, 5 + (CATALOG.slice(0, 5).some((d) => d.id === 'minnow') ? 0 : 1));
});

test('collection: first-ever finds are an Almanac harvest, three a day', async () => {
  const { emptyAlmanac, recordHarvest, HARVEST } = await import('./almanac.ts');
  const a = emptyAlmanac();
  for (let i = 0; i < 6; i++) recordHarvest(a, 'found', at(2026, 10, 1));
  assert.equal(a.points, HARVEST.found.cap * HARVEST.found.points);
  assert.equal(a.days[0].counts.found, 6);
});
