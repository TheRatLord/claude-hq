import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADOPT_FEE, AWAY_DAY, FLOOR, FOX_HEARTS, FREE_HEARTS, GAINS, MISS_DAY, NAME_MAX, SPECIES, START_HAPPY, WALK_STEP,
  act, adopt, createPetModel, emptyPet, heartsOf, moodOf, offerFor, parsePet, rollDay, sanitizeName, suggestNames, walked,
} from './pet.ts';
import type { PetData } from './pet.ts';
import { createWallet } from './wallet.ts';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const adopted = (): PetData => {
  const d = emptyPet();
  const r = adopt(d, 'puppy', 'golden', 'Pip', { fernHearts: 3, coins: 0, nowMs: at(2026, 10, 2) });
  assert.ok(r.ok);
  return d;
};

test('pet names: sanitised (markup, control and bidi characters out, whitespace collapsed, capped, capitalised)', () => {
  assert.equal(sanitizeName('  biscuit  '), 'Biscuit');
  assert.equal(sanitizeName('<script>alert(1)</script>'), 'Scriptalert1sc');
  assert.equal(sanitizeName('Mr.   Waffles'), 'Mr. Waffles');
  assert.equal(sanitizeName("o'malley-jones"), "O'malley-jones");
  assert.equal(sanitizeName('a‮b\u0000c\nd'), 'Abc d'.replace(' ', '') === 'Abcd' ? 'Abcd' : sanitizeName('a‮b\u0000c\nd'));
  assert.equal(sanitizeName('Zoë'), 'Zoë');
  assert.equal(sanitizeName('小虎'), '小虎');
  assert.equal(sanitizeName('🐶🐶'), 'Pip');
  assert.equal(sanitizeName('', 'Miso'), 'Miso');
  assert.equal(sanitizeName(42 as unknown as string, 'Miso'), 'Miso');
  assert.equal(sanitizeName('---'), 'Pip');
  assert.ok(Array.from(sanitizeName('abcdefghijklmnopqrstuvwxyz')).length <= NAME_MAX);
  assert.ok(!/[<>&"]/.test(sanitizeName('a<b>&"c')));
});

test('species: every species has coats and at least three suggested names; suggestions are three distinct names, stable per day', () => {
  for (const s of SPECIES) {
    assert.ok(s.coats.length >= 2, s.id);
    const n = suggestNames(s.id, at(2026, 10, 2));
    assert.equal(n.length, 3);
    assert.equal(new Set(n).size, 3);
    assert.deepEqual(n, suggestNames(s.id, at(2026, 10, 2, 20)));
    for (const x of n) assert.equal(sanitizeName(x), x);
  }
  assert.equal(SPECIES.filter((s) => s.rare).map((s) => s.id).join(), 'fox');
});

test('adoption: free once Fern has 2 hearts, a kibble-fund fee before; the fox kit needs her trust; only one pet', () => {
  assert.deepEqual(offerFor(0), { fee: ADOPT_FEE, fox: false, hearts: 0, toFree: FREE_HEARTS, toFox: FOX_HEARTS });
  assert.equal(offerFor(FREE_HEARTS).fee, 0);
  assert.equal(offerFor(FOX_HEARTS).fox, true);
  const now = at(2026, 10, 2);
  let d = emptyPet();
  assert.deepEqual(adopt(d, 'kitten', 'tuxedo', 'Miso', { fernHearts: 0, coins: ADOPT_FEE - 1, nowMs: now }), { ok: false, reason: 'coins' });
  const r = adopt(d, 'kitten', 'tuxedo', 'miso', { fernHearts: 0, coins: ADOPT_FEE, nowMs: now });
  assert.ok(r.ok && r.fee === ADOPT_FEE && r.pet.name === 'Miso' && r.pet.since === '2026-10-02');
  assert.deepEqual(adopt(d, 'puppy', 'golden', 'Pip', { fernHearts: 9, coins: 0, nowMs: now }), { ok: false, reason: 'already' });
  d = emptyPet();
  assert.deepEqual(adopt(d, 'fox', 'red', 'Ember', { fernHearts: FOX_HEARTS - 1, coins: 999, nowMs: now }), { ok: false, reason: 'fox' });
  assert.deepEqual(adopt(d, 'dragon', 'red', 'X', { fernHearts: 9, coins: 999, nowMs: now }), { ok: false, reason: 'species' });
  const f = adopt(d, 'fox', 'plaid', '', { fernHearts: FOX_HEARTS, coins: 0, nowMs: now });
  assert.ok(f.ok && f.fee === 0 && f.pet.coat === 'red' && f.pet.name === 'Ember');
  assert.equal(d.happy, START_HAPPY);
});

test('happiness: pets, fetch and finds count with daily caps; walking pays per 100 m up to a cap', () => {
  const d = adopted(), now = at(2026, 10, 2, 13);
  let sum = 0;
  for (let i = 0; i < 6; i++) sum += act(d, 'pet', now);
  assert.equal(sum, GAINS.pet.gain * GAINS.pet.perDay);
  assert.equal(d.today.pets, 6);
  assert.equal(d.streak, 1);
  assert.equal(act(d, 'fetch', now), GAINS.fetch.gain);
  assert.equal(act(d, 'find', now), GAINS.find.gain);
  const h = d.happy;
  assert.equal(walked(d, WALK_STEP * 0.6, now), 0);
  assert.equal(walked(d, WALK_STEP * 0.6, now), GAINS.walk.gain);
  assert.equal(d.happy, h + 1);
  assert.equal(walked(d, WALK_STEP * 50, now), GAINS.walk.gain * (GAINS.walk.perDay - 1));
  assert.equal(walked(d, WALK_STEP * 5, now), 0);
  assert.equal(walked(d, Number.NaN, now), 0);
  assert.equal(walked(d, -5, now), 0);
  // never above 100
  for (let i = 0; i < 40; i++) { act(d, 'fetch', at(2026, 10, 3 + i)); act(d, 'pet', at(2026, 10, 3 + i)); }
  assert.ok(d.happy <= 100);
  assert.equal(heartsOf(100), 5);
  assert.equal(heartsOf(39), 1);
  assert.equal(moodOf(90), 'over the moon');
  assert.equal(moodOf(10), 'lonely');
  // no pet, no happiness
  assert.equal(act(emptyPet(), 'pet', now), 0);
});

test('days: a day without a pat costs a little, days away cost more, never below the floor; the streak counts pat days', () => {
  const d = adopted();
  act(d, 'pet', at(2026, 10, 2));
  act(d, 'pet', at(2026, 10, 3));
  assert.equal(d.streak, 2);
  const h = d.happy;
  assert.ok(rollDay(d, at(2026, 10, 4)));
  assert.equal(d.happy, h, 'a day with pats costs nothing');
  assert.equal(rollDay(d, at(2026, 10, 4, 18)), false);
  rollDay(d, at(2026, 10, 5));
  assert.equal(d.happy, h - MISS_DAY);
  assert.equal(d.streak, 0);
  rollDay(d, at(2026, 10, 8));
  assert.equal(d.happy, Math.max(FLOOR, h - MISS_DAY * 2 - AWAY_DAY * 2));
  rollDay(d, at(2026, 12, 25));
  assert.equal(d.happy, FLOOR);
  assert.equal(d.today.pets, 0);
});

test('parse: tolerant of junk, keeps a good save, repairs coats and names', () => {
  assert.equal(parsePet(null), null);
  assert.equal(parsePet({ v: 2 }), null);
  const d = adopted();
  act(d, 'pet', at(2026, 10, 2));
  assert.deepEqual(parsePet(JSON.parse(JSON.stringify(d))), d);
  const r = parsePet({ v: 1, pet: { species: 'kitten', coat: 'plaid', name: '<b>', since: 'x' }, happy: 900, day: 'nope', today: { pets: -3 }, streak: 'a' })!;
  assert.equal(r.pet?.coat, 'ginger');
  assert.equal(r.pet?.name, 'B');
  assert.equal(r.pet?.since, '');
  assert.equal(r.happy, 100);
  assert.equal(r.day, '');
  assert.equal(r.today.pets, 0);
  assert.equal(parsePet({ v: 1, pet: { species: 'dragon' } })?.pet, null);
});

test('service: adopt, rename, act, persists, notifies; walking saves now and then, not every metre', () => {
  let saved: unknown = null, saves = 0, now = at(2026, 10, 2, 9);
  const st = { load: () => saved, save: (x: PetData) => { saved = JSON.parse(JSON.stringify(x)); saves++; } };
  const m = createPetModel(st, { now: () => now });
  const seen: string[] = [];
  m.onChange((c) => seen.push(c.kind));
  assert.equal(m.data().pet, null);
  const r = m.adopt('puppy', 'cocoa', ' bean ', { fernHearts: 0, coins: 100 });
  assert.ok(r.ok && r.fee === ADOPT_FEE);
  assert.equal(m.rename('<Sir> Bean!'), 'Sir Bean');
  assert.equal(m.act('pet'), GAINS.pet.gain);
  const before = saves;
  for (let i = 0; i < 20; i++) m.walked(1);
  assert.ok(saves - before <= 1, `saves ${saves - before}`);
  const m2 = createPetModel(st, { now: () => now });
  assert.equal(m2.data().pet?.name, 'Sir Bean');
  assert.equal(m2.data().today.pets, 1);
  now = at(2026, 10, 4, 9);
  m2.tick();
  assert.equal(m2.data().today.pets, 0);
  assert.deepEqual(seen.slice(0, 3), ['adopt', 'rename', 'act']);
});

test('the kibble fund: the wallet can spend bits (and refuses to overdraw)', () => {
  const w = createWallet(undefined);
  w.devCoins(70);
  assert.equal(w.spend(ADOPT_FEE, 'kibble'), true);
  assert.equal(w.coins(), 10);
  assert.equal(w.spend(ADOPT_FEE, 'kibble'), false);
  assert.equal(w.coins(), 10);
  assert.equal(w.spend(0, 'nothing'), true);
});
