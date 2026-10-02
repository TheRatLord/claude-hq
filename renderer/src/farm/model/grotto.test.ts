import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOURNAL, createGrotto, emptyGrotto, glowcapToday, grottoSpawn, parseGrotto } from './grotto.ts';
import { collectDef, createCollection, forageDay, forageFor, FISHES, fishOdds, whereText } from './collection.ts';
import { sellPrice } from './shop.ts';
import { decorDef } from './shop.ts';
import { STAMPS, emptyWorld, stampDef } from './stamps.ts';

const DAY = new Date(2026, 9, 2, 14, 0).getTime();

test('grotto: discovery, visits, the chest once, journal pages cycle', () => {
  let t = DAY;
  const saved: unknown[] = [];
  const g = createGrotto({ load: () => null, save: (d) => saved.push(structuredClone(d)) }, () => t);
  assert.equal(g.discovered(), false);
  assert.equal(g.discover(), true);
  assert.equal(g.discover(), false);
  g.visit(); g.visit();
  assert.equal(g.data().visits, 1, 'one visit a day');
  t += 86_400_000; g.visit();
  assert.equal(g.data().visits, 2);
  assert.equal(g.chestOpen, false);
  assert.equal(g.openChest(), true);
  assert.equal(g.openChest(), false);
  const pages = Array.from({ length: JOURNAL.length + 2 }, () => g.readPage());
  assert.deepEqual(pages.slice(0, JOURNAL.length), JOURNAL.map((_, i) => i));
  assert.equal(pages[JOURNAL.length], 0, 'cycles round');
  assert.equal(g.data().pages, JOURNAL.length);
  // reload
  const again = createGrotto({ load: () => saved.at(-1), save: () => {} }, () => t);
  assert.equal(again.discovered(), true);
  assert.equal(again.chestOpen, true);
  assert.equal(parseGrotto({ v: 2 }), null);
  assert.deepEqual(parseGrotto({ v: 1 }), emptyGrotto());
});

test('grotto: glow-caps grow on most days, never in the valley batch, and are picked once a day through the book', () => {
  let on = 0;
  for (let i = 0; i < 300; i++) { const d = new Date(2026, 0, 1 + i); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; if (glowcapToday(k)) on++; }
  assert.ok(on > 150 && on < 260, `${on} of 300 days`);
  for (const s of ['spring', 'summer', 'autumn', 'winter'] as const) {
    assert.ok(!forageFor(s).some((d) => d.id === 'glowcap'));
    assert.ok(!forageDay('2026-10-02', s).some((x) => x.id === 'glowcap'));
  }
  let day = '2026-10-02', spawn = grottoSpawn(day);
  for (let i = 3; !spawn; i++) { day = `2026-10-${String(i).padStart(2, '0')}`; spawn = grottoSpawn(day); }
  const book = createCollection(undefined, () => new Date(`${day}T12:00:00`).getTime());
  assert.equal(book.pick(spawn)?.isNew, true);
  assert.equal(book.pick(spawn), null, 'once a day');
  assert.equal(collectDef('glowcap')?.rare, true);
  assert.ok(sellPrice('glowcap') > 0 && sellPrice('cavefish') > 0);
  assert.ok(whereText(collectDef('glowcap')!).length > 10 && whereText(collectDef('cavefish')!).includes('dark'));
});

test('grotto: the blind cave fish only bites in the cave pool, which holds nothing else', () => {
  const c = { season: 'summer' as const, hour: 14, weather: 'clear' as const };
  assert.deepEqual(fishOdds({ ...c, water: 'cave' }).map((o) => o.def.id), ['cavefish']);
  for (const water of ['pond', 'river'] as const) assert.ok(!fishOdds({ ...c, water }).some((o) => o.def.id === 'cavefish'));
  assert.ok(FISHES.some((f) => f.id === 'cavefish'));
});

test('grotto: a secret stamp, and the chest\'s geode lamp is a gift never sold', () => {
  const s = stampDef('grotto')!;
  assert.ok(s && s.secret && s.cat === 'explorer');
  const w = emptyWorld(DAY);
  assert.equal(s.test(w, { v: 1 } as never), false);
  assert.equal(s.test({ ...w, at: { ...w.at, grotto: true } }, { v: 1 } as never), true);
  assert.ok(STAMPS.filter((x) => x.id === 'grotto').length === 1);
  const d = decorDef('geode')!;
  assert.ok(d.gift && d.glow);
});
