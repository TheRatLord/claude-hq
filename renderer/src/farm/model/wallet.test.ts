import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG } from './collection.ts';
import { COIN, DECOR, coins, decorDef, lockOf, priceOf, sellPrice } from './shop.ts';
import {
  ROT_STEPS, WORK_CAP, YARD_SLOTS, basketCount, basketValue, buy, createWallet, emptyWallet, freeSlots, parseWallet, pieceAt, place,
  restyle, rotate, sell, sellAll, shopView, stash, store, workPay, workToday,
} from './wallet.ts';
import type { WalletData } from './wallet.ts';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const AUTUMN = { rank: 0, season: 'autumn' as const };

test('shop: every collectible has a sell price; rares and big fish are worth more; junk is cheap (mostly)', () => {
  for (const d of CATALOG) assert.ok(sellPrice(d.id) > 0, d.id);
  assert.equal(sellPrice('nope'), 0);
  assert.ok(sellPrice('crystal') > sellPrice('acorn'));
  assert.ok(sellPrice('carp') > sellPrice('minnow'));
  assert.ok(sellPrice('koi') > sellPrice('bluegill'));
  assert.ok(sellPrice('boot') <= 2);
  assert.ok(sellPrice('bottle') > sellPrice('boot'));
  assert.equal(coins(1), `1 ${COIN.one}`);
  assert.equal(coins(1200), `1,200 ${COIN.many}`);
});

test('shop: decor ids unique, prices scale with copies owned, gates by rank / season / max', () => {
  assert.equal(new Set(DECOR.map((d) => d.id)).size, DECOR.length);
  assert.ok(DECOR.length >= 12);
  for (const d of DECOR) {
    assert.ok(d.blurb.length > 20 && d.max >= 1 && d.price > 0, d.id);
    assert.ok(priceOf(d, 1) > priceOf(d, 0) && priceOf(d, 0) % 5 === 0, d.id);
  }
  const lamp = decorDef('lamppost')!, pumpkin = decorDef('pumpkin')!, gnome = decorDef('gnome')!;
  assert.equal(lockOf(lamp, { rank: 0, season: 'autumn', owned: 0 }), 'rank');
  assert.equal(lockOf(lamp, { rank: 2, season: 'autumn', owned: 0 }), null);
  assert.equal(lockOf(pumpkin, { rank: 0, season: 'winter', owned: 0 }), 'season');
  assert.equal(lockOf(pumpkin, { rank: 0, season: 'autumn', owned: 0 }), null);
  assert.equal(lockOf(gnome, { rank: 9, season: 'autumn', owned: gnome.max }), 'max');
  // every season stocks something seasonal, and something is always in stock at rank 0
  for (const s of ['spring', 'summer', 'autumn', 'winter'] as const) assert.ok(DECOR.some((d) => d.seasons?.includes(s)), s);
  assert.ok(DECOR.filter((d) => lockOf(d, { rank: 0, season: 'spring', owned: 0 }) === null).length >= 8);
});

test('wallet: finds stash into the basket; selling moves held → sold and pays', () => {
  const w = emptyWallet();
  stash(w, 'acorn'); stash(w, 'acorn'); stash(w, 'carp'); stash(w, 'not-a-thing');
  assert.equal(basketCount(w), 3);
  assert.equal(basketValue(w), sellPrice('acorn') * 2 + sellPrice('carp'));
  const s = sell(w, 'acorn', 1);
  assert.deepEqual(s, { n: 1, coins: sellPrice('acorn') });
  assert.equal(w.basket.acorn, 1);
  assert.equal(w.sold.acorn, 1);
  assert.deepEqual(sell(w, 'acorn', 5), { n: 1, coins: sellPrice('acorn') }, 'never sells more than held');
  assert.equal(w.basket.acorn, undefined);
  assert.deepEqual(sell(w, 'acorn'), { n: 0, coins: 0 });
  const all = sellAll(w);
  assert.deepEqual(all, { n: 1, coins: sellPrice('carp') });
  assert.equal(basketCount(w), 0);
  assert.equal(w.coins, sellPrice('acorn') * 2 + sellPrice('carp'));
  assert.equal(w.total.sales, w.coins);
});

test('wallet: real work pays a little, capped per day, fresh the next day', () => {
  const w = emptyWallet();
  const t = at(2026, 10, 1, 10);
  assert.equal(workPay(w, 'ship', t), 4);
  assert.equal(workPay(w, 'blocked', t), 0, 'not work');
  let n = 4;
  for (let i = 0; i < 40; i++) n += workPay(w, 'ship', t);
  assert.equal(n, WORK_CAP);
  assert.equal(w.coins, WORK_CAP);
  assert.deepEqual(workToday(w, t), { coins: WORK_CAP, left: 0 });
  assert.equal(workPay(w, 'finished', at(2026, 10, 2, 9)), 3);
  assert.deepEqual(workToday(w, at(2026, 10, 2, 9)), { coins: 3, left: WORK_CAP - 3 });
});

test('wallet: buying pays the scaled price, respects gates, places in the first free slot', () => {
  const w: WalletData = { ...emptyWallet(), coins: 1000 };
  const r = buy(w, 'gnome', { ...AUTUMN, autoPlace: true });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.price, priceOf(decorDef('gnome')!, 0));
  assert.equal(r.piece.slot, 0);
  const r2 = buy(w, 'gnome', { ...AUTUMN, autoPlace: true });
  assert.ok(r2.ok && r2.price > r.price && r2.piece.slot === 1);
  assert.equal(w.coins, 1000 - r.price - (r2.ok ? r2.price : 0));
  assert.deepEqual(buy(w, 'lamppost', AUTUMN), { ok: false, reason: 'rank' });
  assert.deepEqual(buy(w, 'snowman', AUTUMN), { ok: false, reason: 'season' });
  assert.deepEqual(buy(w, 'what', AUTUMN), { ok: false, reason: 'unknown' });
  const poor = emptyWallet();
  assert.deepEqual(buy(poor, 'gnome', AUTUMN), { ok: false, reason: 'coins' });
  assert.ok(buy(poor, 'lamppost', { ...AUTUMN, free: true }).ok, 'dev: free ignores rank');
  buy(w, 'gnome', AUTUMN);
  assert.deepEqual(buy(w, 'gnome', { ...AUTUMN, free: true }), { ok: false, reason: 'max' }, 'never past max');
  const view = shopView(w, AUTUMN);
  const g = view.find((e) => e.def.id === 'gnome')!;
  assert.equal(g.owned, 3); assert.equal(g.placed, 2); assert.equal(g.locked, 'max');
  // a full yard: new pieces go to storage
  const rich: WalletData = { ...emptyWallet(), coins: 1e6 };
  const many = ['planter', 'flamingo', 'gnome', 'birdhouse', 'chime', 'bench'].flatMap((id) => Array(decorDef(id)!.max).fill(id) as string[]);
  assert.ok(many.length > YARD_SLOTS);
  for (const id of many) assert.ok(buy(rich, id, { ...AUTUMN, autoPlace: true }).ok, id);
  assert.equal(freeSlots(rich).length, 0);
  assert.ok(rich.pieces.some((p) => p.slot === null));
});

test('wallet: place swaps, store / rotate / restyle', () => {
  const w: WalletData = { ...emptyWallet(), coins: 1000 };
  const a = buy(w, 'gnome', { ...AUTUMN, autoPlace: true }), b = buy(w, 'planter', { ...AUTUMN, autoPlace: true }), c = buy(w, 'bench', AUTUMN);
  assert.ok(a.ok && b.ok && c.ok);
  if (!a.ok || !b.ok || !c.ok) return;
  assert.equal(c.piece.slot, null);
  // move a onto b's slot: they swap
  assert.deepEqual(place(w, a.piece.uid, 1), { moved: true, displaced: b.piece.uid });
  assert.equal(a.piece.slot, 1); assert.equal(b.piece.slot, 0);
  // stored c onto slot 0: b goes to storage
  assert.deepEqual(place(w, c.piece.uid, 0), { moved: true, displaced: b.piece.uid });
  assert.equal(b.piece.slot, null);
  assert.deepEqual(place(w, c.piece.uid, 0), { moved: false, displaced: null });
  assert.deepEqual(place(w, c.piece.uid, YARD_SLOTS), { moved: false, displaced: null });
  assert.equal(pieceAt(w, 0)?.uid, c.piece.uid);
  assert.ok(store(w, c.piece.uid));
  assert.ok(!store(w, c.piece.uid));
  assert.equal(rotate(w, a.piece.uid), 1);
  assert.equal(rotate(w, a.piece.uid, -2), ROT_STEPS - 1);
  assert.equal(restyle(w, a.piece.uid), 'Blue hat');
  assert.equal(restyle(w, c.piece.uid), null, 'benches have no styles');
});

test('wallet: parse is tolerant (bad pieces dropped, slot clashes resolved, unknown ids gone)', () => {
  assert.equal(parseWallet(null), null);
  assert.equal(parseWallet({ v: 2, coins: 1 }), null);
  const w = parseWallet({
    v: 1, coins: 50.7, basket: { acorn: 3, nope: 2, carp: -1 },
    pieces: [{ uid: 3, id: 'gnome', slot: 2, rot: 9, style: 7 }, { uid: 4, id: 'bench', slot: 2 }, { uid: 3, id: 'planter', slot: 5 }, { uid: 9, id: 'ufo', slot: 1 }, 'x'],
  })!;
  assert.equal(w.coins, 50);
  assert.deepEqual(w.basket, { acorn: 3 });
  assert.equal(w.pieces.length, 2);
  assert.deepEqual(w.pieces[0], { uid: 3, id: 'gnome', slot: 2, rot: 1, style: 2 });
  assert.equal(w.pieces[1].slot, null, 'second piece on a taken slot goes to storage');
  assert.ok(w.nextUid > 4);
  assert.deepEqual(parseWallet(JSON.parse(JSON.stringify(w))), w, 'round trip');
});

test('wallet service: persists, notifies, seeds the basket from the book on first run', () => {
  let saved: unknown = null;
  const st = { load: () => saved, save: (d: WalletData) => { saved = JSON.parse(JSON.stringify(d)); } };
  const w = createWallet(st, { now: () => at(2026, 10, 1), seed: () => ({ acorn: 2, minnow: 1 }) });
  assert.equal(w.basketCount(), 3);
  const seen: string[] = [];
  w.onChange((c) => seen.push(c.kind));
  w.stash('chanterelle');
  const s = w.sellAll();
  assert.equal(s.n, 4);
  assert.equal(w.coins(), s.coins);
  w.devCoins(500);
  const y0 = w.yardVersion;
  const r = w.buy('gnome', { ...AUTUMN, autoPlace: true });
  assert.ok(r.ok);
  assert.ok(w.yardVersion > y0);
  assert.equal(w.work('ship'), 4);
  assert.deepEqual(seen, ['stash', 'sell', 'dev', 'buy', 'work']);
  // a second load reads what was saved, no reseeding
  const w2 = createWallet(st, { seed: () => ({ acorn: 99 }) });
  assert.equal(w2.coins(), w.coins());
  assert.equal(w2.basketCount(), 0);
  assert.equal(w2.data().pieces.length, 1);
});
