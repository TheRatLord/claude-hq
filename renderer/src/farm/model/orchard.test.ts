import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CIDER_FRUIT, FRUIT_KINDS, HIVE_COUNT, HONEY_DAYS, SHAKE_DROP, TREE_COUNT, beeActivity, beeMood, createOrchard, daysBetween, emptyOrchard,
  fruitOnTree, honeyJars, isRipe, parseOrchard, pressPlan, treePhase,
} from './orchard.ts';
import type { Season } from './types.ts';
import { CATALOG, PRODUCE, collectDef, createCollection, forageDay, forageFor, whereText } from './collection.ts';
import { sellPrice } from './shop.ts';
import { FRIENDS } from './friends.ts';
import { ORCHARD_GATE, ORCHARD_SITE, inOrchard, orchardClearance, orchardToLocal, orchardToWorld } from '../world/orchard.ts';
import { PATHS, clearance, heightAt, pathAt } from '../world/map.ts';

const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];
const DAY = new Date(2026, 9, 2, 14, 0).getTime();
const H = 3_600_000, D = 24 * H;

test('orchard: trees go through the year by kind', () => {
  for (const k of FRUIT_KINDS) {
    assert.equal(treePhase(k, 'spring'), 'blossom', k);
    assert.equal(treePhase(k, 'winter'), 'bare', k);
  }
  assert.equal(treePhase('cherry', 'summer'), 'ripe');
  assert.equal(treePhase('plum', 'summer'), 'ripe');
  assert.equal(treePhase('apple', 'summer'), 'green');
  assert.equal(treePhase('pear', 'summer'), 'green');
  assert.equal(treePhase('apple', 'autumn'), 'ripe');
  assert.equal(treePhase('pear', 'autumn'), 'ripe');
  assert.equal(treePhase('plum', 'autumn'), 'ripe');
  assert.equal(treePhase('cherry', 'autumn'), 'turning');
  // something is ripe in summer and autumn, nothing in spring and winter
  const ripe = (s: Season) => ORCHARD_SITE.trees.filter((t) => isRipe(t.kind, s)).length;
  assert.ok(ripe('summer') >= 6 && ripe('autumn') >= 12);
  assert.equal(ripe('spring'), 0);
  assert.equal(ripe('winter'), 0);
});

test('orchard: fruit per tree is deterministic per day, 3–6 on a ripe tree', () => {
  for (let day = 1; day < 20; day++) {
    const key = `2026-10-${String(day).padStart(2, '0')}`;
    for (const t of ORCHARD_SITE.trees) {
      const n = fruitOnTree(key, t.i, t.kind, 'autumn');
      if (t.kind === 'cherry') assert.equal(n, 0);
      else assert.ok(n >= 3 && n <= 6, `${t.kind} ${n}`);
      assert.equal(n, fruitOnTree(key, t.i, t.kind, 'autumn'));
    }
  }
});

test('orchard: shaking brings fruit down until the tree is picked clean; a new day fills it again', () => {
  let t = DAY;
  const saved: unknown[] = [];
  const o = createOrchard({ load: () => null, save: (d) => saved.push(structuredClone(d)) }, () => t);
  const apple = ORCHARD_SITE.trees.find((x) => x.kind === 'apple')!;
  const full = o.fruitLeft(apple.i, 'autumn');
  assert.ok(full >= 3);
  let got = 0, shakes = 0;
  for (;;) {
    const r = o.shake(apple.i, 'autumn')!;
    shakes++;
    assert.ok(r.n <= SHAKE_DROP);
    got += r.n;
    assert.equal(r.left, full - got);
    if (!r.n) break;
  }
  assert.equal(got, full);
  assert.equal(o.fruitLeft(apple.i, 'autumn'), 0);
  assert.equal(o.data().total.fruit, full);
  assert.equal(o.data().total.shakes, shakes);
  // spring: shaking a blossoming tree brings down petals, not fruit
  const r = o.shake(apple.i, 'spring')!;
  assert.equal(r.n, 0);
  assert.equal(r.phase, 'blossom');
  // tomorrow it is full again (a fresh count)
  t += D;
  assert.ok(o.fruitLeft(apple.i, 'autumn') >= 3);
  // reload keeps today's picks
  o.shake(apple.i, 'autumn');
  const again = createOrchard({ load: () => saved.at(-1), save: () => {} }, () => t);
  assert.equal(again.fruitLeft(apple.i, 'autumn'), o.fruitLeft(apple.i, 'autumn'));
  assert.equal(o.shake(999, 'autumn'), null);
});

test('orchard: each hive gives honey every few days, two jars in summer, none in winter', () => {
  let t = DAY;
  const o = createOrchard(undefined, () => t);
  assert.equal(o.honeyReady(0, 'summer'), true, 'a hive never harvested has some to spare');
  assert.equal(o.takeHoney(0, 'summer'), 2);
  assert.equal(o.takeHoney(0, 'summer'), 0, 'not again today');
  assert.equal(o.honeyIn(0, 'summer'), HONEY_DAYS);
  t += (HONEY_DAYS - 1) * D;
  assert.equal(o.honeyReady(0, 'summer'), false);
  t += D;
  assert.equal(o.honeyReady(0, 'summer'), true);
  assert.equal(o.takeHoney(0, 'autumn'), 1);
  assert.equal(o.honeyReady(1, 'winter'), false);
  assert.equal(o.takeHoney(1, 'winter'), 0);
  assert.equal(o.honeyIn(1, 'winter'), -1);
  assert.equal(honeyJars('spring'), 1);
  assert.equal(o.data().total.honey, 3);
  assert.equal(o.takeHoney(HIVE_COUNT, 'summer'), 0, 'unknown hive');
  assert.equal(daysBetween('2026-02-27', '2026-03-02'), 3);
  assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
});

test('orchard: bees are out on fine days, asleep at night, sheltering in rain, wintering in the hive', () => {
  const c = (hour: number, season: Season = 'summer', weather: 'clear' | 'cloudy' | 'fog' | 'rain' | 'storm' | 'snow' = 'clear') => ({ hour, season, weather });
  assert.equal(beeActivity(c(13)), 1);
  assert.equal(beeActivity(c(2)), 0);
  assert.equal(beeActivity(c(22)), 0);
  assert.ok(beeActivity(c(7.5)) > 0 && beeActivity(c(7.5)) < 1, 'waking up');
  assert.ok(beeActivity(c(19.5, 'summer')) > 0, 'summer evenings run late');
  assert.equal(beeActivity(c(19.5, 'autumn')), 0);
  assert.equal(beeActivity(c(13, 'summer', 'rain')), 0);
  assert.equal(beeActivity(c(13, 'summer', 'storm')), 0);
  assert.equal(beeActivity(c(13, 'winter')), 0);
  assert.ok(beeActivity(c(13, 'summer', 'fog')) < beeActivity(c(13, 'summer', 'cloudy')));
  assert.ok(beeActivity(c(13, 'autumn')) < beeActivity(c(13, 'spring')));
  assert.equal(beeMood(c(13)), 'out');
  assert.equal(beeMood(c(23)), 'asleep');
  assert.equal(beeMood(c(6)), 'waking');
  assert.equal(beeMood(c(13, 'summer', 'rain')), 'sheltering');
  assert.equal(beeMood(c(13, 'winter')), 'wintering');
});

test('orchard: the press takes three apples (or pears) for a bottle', () => {
  assert.equal(pressPlan({}), null);
  assert.equal(pressPlan({ apple: 2 }), null);
  assert.deepEqual(pressPlan({ apple: 5, pear: 1 }), { apple: 3, pear: 0 });
  assert.deepEqual(pressPlan({ apple: 1, pear: 4 }), { apple: 1, pear: 2 });
  assert.deepEqual(pressPlan({ pear: CIDER_FRUIT }), { apple: 0, pear: CIDER_FRUIT });
  assert.equal(pressPlan({ apple: -4, pear: Number.NaN }), null);
});

test('orchard: tolerant parse', () => {
  assert.equal(parseOrchard(null), null);
  assert.equal(parseOrchard({ v: 2 }), null);
  assert.deepEqual(parseOrchard({ v: 1 }), emptyOrchard());
  const p = parseOrchard({ v: 1, day: '2026-10-02', picked: { 0: 3, 1: -2, 999: 4, x: 1 }, hives: { 0: '2026-10-01', 1: 'nope', 9: '2026-10-01' }, total: { fruit: 5.5, honey: 'x' } })!;
  assert.deepEqual(p.picked, { 0: 3 });
  assert.deepEqual(p.hives, { 0: '2026-10-01' });
  assert.deepEqual(p.total, { fruit: 5, shakes: 0, honey: 0, cider: 0 });
  assert.equal(TREE_COUNT, 18);
});

test('orchard: fruit and honey are finds (never in the day\'s forage batch), cider is produce; they sell and make gifts', () => {
  for (const id of ['apple', 'pear', 'plum', 'cherry', 'honey']) {
    const d = collectDef(id);
    assert.ok(d && d.kind === 'forage' && d.habitat === 'orchard', id);
    assert.ok(CATALOG.includes(d!), `${id} in the book`);
    assert.ok(sellPrice(id) > 0, id);
    assert.match(whereText(d!), /orchard/);
  }
  for (const s of SEASONS) {
    assert.ok(!forageFor(s).some((d) => d.habitat === 'orchard'), s);
    assert.ok(!forageDay('2026-10-02', s).some((x) => ['apple', 'pear', 'plum', 'cherry', 'honey'].includes(x.id)), s);
  }
  assert.ok(PRODUCE.some((d) => d.id === 'cider'));
  assert.ok(sellPrice('cider') > sellPrice('apple') * CIDER_FRUIT * 0.9, 'pressing is worth it');
  assert.ok(sellPrice('honey') > sellPrice('apple'));
  const fans = FRIENDS.filter((f) => [...f.loves, ...f.likes].some((id) => ['apple', 'pear', 'plum', 'cherry', 'honey', 'cider'].includes(id)));
  assert.ok(fans.length >= 4, 'several villagers like orchard things');
  // the book records a gathered fruit like any find
  const book = createCollection(undefined, () => DAY);
  const r = book.gather('apple')!;
  assert.equal(r.isNew, true);
  assert.equal(book.gather('apple')!.n, 2);
  assert.equal(book.gather('nonsense'), null);
});

test('orchard: the layout sits on open ground, joined to the roads, clear of everything else', () => {
  const O = ORCHARD_SITE;
  // local ↔ world round trip
  const w = orchardToWorld(3, -2), l = orchardToLocal(w.x, w.z);
  assert.ok(Math.abs(l.x - 3) < 1e-9 && Math.abs(l.z + 2) < 1e-9);
  // the front (gate) faces downhill: the back row stands higher than the front
  const back = orchardToWorld(0, O.back), front = orchardToWorld(0, O.front);
  assert.ok(heightAt(back.x, back.z) > heightAt(front.x, front.z) + 2, 'on a slope');
  // dry land everywhere inside, and on the valley side of the rim's steep cliffs
  for (let x = -O.hw; x <= O.hw; x += 2) for (let z = O.back; z <= O.front; z += 2) {
    const p = orchardToWorld(x, z);
    assert.ok(heightAt(p.x, p.z) > 2, `dry at ${x},${z}`);
    assert.ok(inOrchard(p.x, p.z, 0.01));
  }
  // trees, hives and the shed are reserved ground (flora keeps out), the alley between the rows is a path
  for (const t of O.trees) { const p = orchardToWorld(t.x, t.z); assert.ok(clearance(p.x, p.z) < 0 && orchardClearance(p.x, p.z) < 0); }
  for (const h of O.hives) { const p = orchardToWorld(h.x, h.z); assert.ok(clearance(p.x, p.z) < 0); }
  const mid = orchardToWorld(0, -3);
  assert.ok(pathAt(mid.x, mid.z) > 0.5, 'the alley is worn');
  // a footpath leaves the gate and reaches a road
  const spur = PATHS.find((p) => p.points.some((q) => Math.hypot(q.x - ORCHARD_GATE.x, q.z - ORCHARD_GATE.z) < 0.01));
  assert.ok(spur, 'gate footpath');
  const end = spur!.points[0];
  assert.ok(PATHS.some((p) => p !== spur && p.width >= 2 && p.points.some((q, i) => i + 1 < p.points.length && Math.hypot(q.x - end.x, q.z - end.z) < 60)), 'joins a road');
  // no tree trunk stands on the alley or the gate footpath
  for (const t of O.trees) { const p = orchardToWorld(t.x, t.z); assert.ok(pathAt(p.x, p.z) < 0.05, `tree ${t.i} off the path`); }
  // far away: no cost, no reservation
  assert.equal(orchardClearance(0, 0), Infinity);
});
