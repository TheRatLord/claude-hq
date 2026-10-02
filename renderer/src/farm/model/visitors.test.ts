import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LURE_BOOST, MERCHANT_DAYS, PAINTING_PRICE, PAINT_SPOTS, STOCK, VISITOR_IDS, addDays, comes, createVisitors, emptyVisitors, fairDay,
  festivalVisit, merchantComes, nextVisit, paintProgress, paintSpotFor, painterComes, parcelFor, parseVisitors, phaseAt, postieComes,
  stockFor, stockView, tooWetToPaint, visitorsOn, weekday, whenText,
} from './visitors.ts';
import type { VisitorsData, VisitorsDeps } from './visitors.ts';
import { decorDef, DECOR } from './shop.ts';
import { shopView } from './wallet.ts';
import { emptyWallet } from './wallet.ts';
import { collectDef } from './collection.ts';

const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));

test('calendar helpers: weekday, addDays across months and DST', () => {
  assert.equal(weekday('2026-10-02'), 5);   // a Friday
  assert.equal(weekday('2026-10-07'), 3);   // Wednesday
  assert.equal(addDays('2026-10-30', 3), '2026-11-02');
  assert.equal(addDays('2026-03-28', 2), '2026-03-30');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('the merchant comes Wednesdays and Saturdays, plus festival days', () => {
  assert.deepEqual([...MERCHANT_DAYS], [3, 6]);
  // a plain week in June (no festival): exactly Wednesday and Saturday
  const june = days('2026-06-01', 7).filter(merchantComes);
  assert.deepEqual(june.map(weekday).sort(), [3, 6]);
  // Founders' Day (Sep 28) is a one-day festival: always a merchant day
  assert.ok(festivalVisit('2026-09-28'));
  assert.ok(merchantComes('2026-09-28'));
  // the Harvest Festival (Sep 22 – Oct 14): its first and last days and its weekends, not every weekday
  assert.ok(festivalVisit('2026-09-22'));
  assert.ok(festivalVisit('2026-10-14'));
  assert.ok(festivalVisit('2026-10-03'));    // Saturday
  assert.ok(festivalVisit('2026-10-04'));    // Sunday
  assert.equal(festivalVisit('2026-10-02'), false);   // a Friday mid-festival
  assert.equal(festivalVisit('2026-06-10'), false);
  // so the festival adds visits on top of the regular two
  const oct = days('2026-09-28', 14).filter(merchantComes).length;
  assert.ok(oct > 4, `festival fortnight has ${oct} merchant days`);
});

test('the painter comes on some fair days only, never in the rain; deterministic', () => {
  const year = days('2026-01-01', 365);
  const visits = year.filter(painterComes);
  assert.ok(visits.length > 30 && visits.length < 140, `painter came ${visits.length} times`);
  for (const d of visits) assert.ok(fairDay(d), `${d} is fair`);
  assert.deepEqual(year.filter(painterComes), visits);
  assert.ok(tooWetToPaint('rain', 0.3));
  assert.ok(tooWetToPaint('storm', 1));
  assert.ok(tooWetToPaint('snow', 0.8));
  assert.equal(tooWetToPaint('snow', 0.2), false);
  assert.equal(tooWetToPaint('fog', 1), false);
  // she paints somewhere scenic, the same spot all day
  assert.ok(PAINT_SPOTS.includes(paintSpotFor('2026-06-03')));
  assert.equal(paintSpotFor('2026-06-03'), paintSpotFor('2026-06-03'));
  assert.equal(paintProgress(9), 0);
  assert.equal(paintProgress(12.5), 0.5);
  assert.equal(paintProgress(16), 1);
});

test('the parcel post only rides the train once the halt is restored', () => {
  const week = days('2026-06-01', 7);
  assert.deepEqual(week.filter((d) => postieComes(d, false)), []);
  assert.deepEqual(week.filter((d) => postieComes(d, true)).map(weekday), [1, 4]);
  assert.ok(visitorsOn('2026-06-03', { halt: true }).includes('merchant'));
  assert.ok(!visitorsOn('2026-06-03', { halt: true }).includes('postie'));
  assert.ok(visitorsOn('2026-06-04', { halt: true }).includes('postie'));
  assert.ok(!comes('postie', '2026-06-01', { halt: false }));
  assert.ok(comes('postie', '2026-06-01', { halt: true }));
});

test('next visit and when-text', () => {
  const n = nextVisit('merchant', '2026-06-01', { halt: false })!;   // a Monday
  assert.equal(n.day, '2026-06-03');
  assert.equal(n.inDays, 2);
  assert.equal(whenText(n), 'on Wednesday');
  assert.equal(whenText({ day: '2026-06-01', inDays: 0 }), 'today');
  assert.equal(whenText({ day: '2026-06-02', inDays: 1 }), 'tomorrow');
  assert.equal(nextVisit('postie', '2026-06-01', { halt: false }), null);
  assert.equal(phaseAt('merchant', 7), 'before');
  assert.equal(phaseAt('merchant', 12), 'here');
  assert.equal(phaseAt('merchant', 18), 'after');
});

test('stock rotates by day, deterministically, and never repeats an item', () => {
  const seen = new Set<string>();
  for (const d of days('2026-01-01', 120)) {
    const s = stockFor(d);
    assert.deepEqual(s, stockFor(d));
    assert.ok(s.length >= 3 && s.length <= 4, `${d}: ${s.length}`);
    assert.equal(new Set(s.map((e) => e.def.id)).size, s.length);
    assert.ok(s.filter((e) => e.def.decor).length >= 2);
    for (const e of s) {
      seen.add(e.def.id);
      assert.ok(e.price % 5 === 0);
      assert.ok(Math.abs(e.price - e.def.price) <= e.def.price * 0.1, `${e.def.id} ${e.price}`);
    }
  }
  assert.deepEqual([...seen].sort(), STOCK.map((s) => s.id).sort());
  // the rare decor exists, is the merchant's own, and never sits on the General store's shelves
  for (const s of STOCK) if (s.decor) { const d = decorDef(s.decor); assert.ok(d?.visitor, s.decor); }
  const shelves = shopView(emptyWallet(), { rank: 99, season: 'summer' }).map((e) => e.def.id);
  for (const d of DECOR.filter((x) => x.visitor)) assert.ok(!shelves.includes(d.id), d.id);
});

const mkDeps = (o: { purse?: { coins: number }; owned?: Record<string, number>; found?: boolean; basket?: Record<string, number> } = {}) => {
  const purse = o.purse ?? { coins: 1000 };
  const owned = o.owned ?? {};
  const basket = o.basket ?? {};
  const deps: VisitorsDeps = {
    spend: (c) => { if (c > purse.coins) return false; purse.coins -= c; return true; },
    refund: (c) => { purse.coins += c; },
    giftDecor: (id) => { const d = decorDef(id); if (!d || (owned[id] ?? 0) >= d.max) return false; owned[id] = (owned[id] ?? 0) + 1; return true; },
    stash: (id, n) => { basket[id] = (basket[id] ?? 0) + n; },
    coins: () => purse.coins,
    owned: (id) => owned[id] ?? 0,
    secretKnown: () => !!o.found,
    halt: () => true,
  };
  return { deps, purse, owned, basket };
};
const mem = () => { let v: unknown = null; return { load: () => v, save: (d: VisitorsData) => { v = JSON.parse(JSON.stringify(d)); }, get raw() { return v; } }; };
/** a merchant day whose stock has the lure and the map */
const dayWith = (...ids: string[]) => days('2026-01-01', 400).find((d) => ids.every((id) => stockFor(d).some((e) => e.def.id === id)))!;

test('buying decor puts it in the yard, once per visit, and only while he is here', () => {
  const st = mem();
  const { deps, purse, owned } = mkDeps();
  const v = createVisitors(st, deps);
  const day = dayWith('lure');
  const deco = v.stock(day).find((e) => e.def.decor)!;
  assert.deepEqual(v.buy(deco.def.id, day, false), { ok: false, reason: 'closed' });
  const r = v.buy(deco.def.id, day, true);
  assert.ok(r.ok);
  assert.equal(purse.coins, 1000 - deco.price);
  assert.equal(owned[deco.def.decor!], 1);
  assert.equal(v.stock(day).find((e) => e.def.id === deco.def.id)!.lock, 'bought');
  assert.deepEqual(v.buy(deco.def.id, day, true), { ok: false, reason: 'bought' });
  assert.equal(v.data().total.bought, 1);
  // persisted
  const again = createVisitors(st, deps);
  assert.equal(again.stock(day).find((e) => e.def.id === deco.def.id)!.lock, 'bought');
  // too dear
  const poor = createVisitors(undefined, mkDeps({ purse: { coins: 3 } }).deps);
  assert.equal(poor.stock(day)[0].lock, 'coins');
  assert.deepEqual(poor.buy(poor.stock(day)[0].def.id, day, true), { ok: false, reason: 'coins' });
});

test('a piece you already own (to its max) is sold out; the seeds become moonflowers', () => {
  const day = dayWith('moonseed');
  const { deps, owned } = mkDeps({ owned: {} });
  const v = createVisitors(undefined, deps);
  assert.ok(v.buy('moonseed', day, true).ok);
  assert.equal(owned.moonflower, 1);
  const full = createVisitors(undefined, mkDeps({ owned: { moonflower: 2 } }).deps);
  assert.equal(full.stock(day).find((e) => e.def.id === 'moonseed')!.lock, 'owned');
});

test('the glimmer lure boosts the rarer fish for the rest of that day only', () => {
  const day = dayWith('lure');
  const v = createVisitors(undefined, mkDeps().deps);
  assert.equal(v.fishBoost(day), 1);
  assert.ok(v.buy('lure', day, true).ok);
  assert.equal(v.fishBoost(day), LURE_BOOST);
  assert.equal(v.fishBoost(addDays(day, 1)), 1);
});

test('the sketch map marks the grotto, and is never stocked once it is known', () => {
  const day = dayWith('map');
  const v = createVisitors(undefined, mkDeps().deps);
  assert.equal(v.mapped('grotto'), false);
  assert.ok(v.buy('map', day, true).ok);
  assert.ok(v.mapped('grotto'));
  // a later visit with the map in stock: already marked
  const later = days(addDays(day, 1), 200).find((d) => stockFor(d).some((e) => e.def.id === 'map'))!;
  assert.equal(v.stock(later).find((e) => e.def.id === 'map')?.lock, 'known');
  // found the grotto yourself: the map isn't on the cart at all
  const finder = createVisitors(undefined, mkDeps({ found: true }).deps);
  assert.equal(finder.stock(day).some((e) => e.def.id === 'map'), false);
});

test('the painter sells the finished canvas, once a day', () => {
  const { deps, purse } = mkDeps();
  const v = createVisitors(undefined, deps, { now: () => 5 });
  assert.deepEqual(v.buyPainting('2026-06-03', 'pond', 'summer', 0.6), { ok: false, reason: 'unfinished' });
  assert.deepEqual(v.buyPainting('2026-06-03', 'nowhere', 'summer', 1), { ok: false, reason: 'unknown' });
  const r = v.buyPainting('2026-06-03', 'pond', 'summer', 1);
  assert.ok(r.ok);
  assert.equal(purse.coins, 1000 - PAINTING_PRICE);
  assert.equal(v.data().paintings[0].title, 'The pond, in high summer');
  assert.deepEqual(v.buyPainting('2026-06-03', 'pond', 'summer', 1), { ok: false, reason: 'bought' });
  const poor = createVisitors(undefined, mkDeps({ purse: { coins: 10 } }).deps);
  assert.deepEqual(poor.buyPainting('2026-06-03', 'pond', 'summer', 1), { ok: false, reason: 'coins' });
});

test('arrivals are announced once a day; meeting a visitor is remembered', () => {
  const v = createVisitors(undefined, mkDeps().deps);
  const seen: string[] = [];
  v.onChange((c) => seen.push(c.kind));
  assert.ok(v.arrived('merchant', '2026-06-03'));
  assert.equal(v.arrived('merchant', '2026-06-03'), false);
  assert.ok(v.arrived('merchant', '2026-06-06'));
  v.met('painter'); v.met('painter');
  assert.deepEqual(v.data().met, ['painter']);
  assert.deepEqual(seen, ['arrive', 'arrive', 'met']);
});

test('the parcel post delivers a letter and a seasonal find, once per day', () => {
  const { deps, basket } = mkDeps();
  const v = createVisitors(undefined, deps);
  const p = v.deliver('2026-06-04', 'summer', 1)!;
  assert.ok(p);
  assert.match(p.body, /Ned/);
  assert.ok(p.item && collectDef(p.item)?.kind === 'forage');
  assert.equal(basket[p.item!], 1);
  assert.equal(v.deliver('2026-06-04', 'summer', 2), null);
  assert.equal(v.parcels().length, 1);
  assert.deepEqual(parcelFor('2026-06-04', 'summer', true), parcelFor('2026-06-04', 'summer', true));
  assert.match(parcelFor('2026-06-04', 'summer', true).body, /Barnaby/);
});

test('parse is tolerant: garbage in, sane data out', () => {
  assert.equal(parseVisitors(null), null);
  assert.equal(parseVisitors({ v: 2 }), null);
  assert.equal(parseVisitors([]), null);
  const d = parseVisitors({
    v: 1, bought: { '2026-06-03|lure': 1, 'nope|lure': 1, '2026-06-03|bogus': 1, '2026-06-03|map': 'x' }, lure: '2026-06-03', maps: ['grotto', 'grotto', 'moon', 3],
    paintings: [{ day: '2026-06-03', spot: 'pond', season: 'summer', at: 9 }, { day: '2026-06-03', spot: 'pond', season: 'summer' }, { day: 'x', spot: 'pond', season: 'summer' }, { day: '2026-06-04', spot: 'mars', season: 'summer' }],
    posted: ['2026-06-04', '2026-06-04', 7], met: ['merchant', 'ghost'], told: { merchant: '2026-06-03', ghost: '2026-06-03', painter: 4 }, total: { spent: -5, bought: 'many' },
  })!;
  assert.deepEqual(d.bought, { '2026-06-03|lure': 1 });
  assert.equal(d.lure, '2026-06-03');
  assert.deepEqual(d.maps, ['grotto']);
  assert.equal(d.paintings.length, 1);
  assert.deepEqual(d.posted, ['2026-06-04']);
  assert.deepEqual(d.met, ['merchant']);
  assert.deepEqual(d.told, { merchant: '2026-06-03' });
  assert.deepEqual(d.total, { spent: 0, bought: 0 });
  assert.deepEqual(parseVisitors(JSON.parse(JSON.stringify(emptyVisitors()))), emptyVisitors());
  // a store that throws on load still gives a working service
  const v = createVisitors({ load: () => { throw new Error('boom'); }, save: () => {} }, mkDeps().deps);
  assert.equal(v.data().met.length, 0);
  assert.deepEqual(VISITOR_IDS, ['merchant', 'painter', 'postie']);
  assert.ok(stockView(emptyVisitors(), '2026-06-03', { coins: 0, owned: () => 0, secretKnown: () => false }).every((e) => e.lock === 'coins'));
});

test('visitors: the Gazette runs the merchant\'s notice, with his true next day', async () => {
  const { composeIssue, gatherFacts } = await import('./gazette.ts');
  const { emptyAlmanac } = await import('./almanac.ts');
  const now = new Date(2026, 9, 5, 9).getTime();   // Monday 5 Oct 2026: he comes Wednesday
  const iss = composeIssue(gatherFacts({ kind: 'weekly', now, almanac: emptyAlmanac(), past: [], notes: [] }));
  const ad = iss.classifieds.find((c) => c.head === 'Curiosities');
  assert.ok(ad, JSON.stringify(iss.classifieds));
  assert.match(ad.text, new RegExp(whenText(nextVisit('merchant', '2026-10-05', { halt: false }))));
});
