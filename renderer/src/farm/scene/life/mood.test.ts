import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Affection, LookTilt, Wariness } from './mood.ts';

test('petting quickly three times rolls the dog over, then not again for a while', () => {
  const a = new Affection();
  assert.equal(a.pet(0), 'happy');
  assert.equal(a.pet(2), 'happy');
  assert.equal(a.pet(4), 'rollover');
  a.update(5);
  assert.equal(a.pet(10), 'happy');
  assert.equal(a.pet(11), 'happy');
  assert.equal(a.pet(12), 'happy', 'cooling down');
  for (let i = 0; i < 30; i++) a.update(1);
  assert.equal(a.pet(50), 'happy');
  assert.equal(a.pet(51), 'happy');
  assert.equal(a.pet(52), 'rollover');
});

test('slow petting never rolls over; joy rises and settles', () => {
  const a = new Affection();
  for (let i = 0; i < 6; i++) assert.equal(a.pet(i * 10), 'happy');
  assert.ok(a.joy > 0.9);
  for (let i = 0; i < 120; i++) a.update(1);
  assert.ok(Math.abs(a.joy - 0.3) < 0.02, `joy ${a.joy}`);
});

test('wariness: calm → freeze → bolt as you creep closer; calms down when you leave', () => {
  const w = new Wariness({ alertAt: 8, boltAt: 4, charge: 5 });
  assert.equal(w.step(0.1, 12, 2, 0.5), 'calm');
  assert.equal(w.step(0.1, 7, 2, 0.5), 'alert');
  for (let i = 0; i < 5; i++) assert.equal(w.step(0.1, 7, 1, 0.5), 'alert', 'holds still a moment');
  assert.equal(w.step(0.1, 3.5, 1, 0.5), 'bolt');
  for (let i = 0; i < 30; i++) w.step(0.1, 20, 1, 0.5);
  assert.equal(w.state, 'calm');
});

test('wariness: running at a critter makes it bolt straight away; backing off from a freeze relaxes it', () => {
  const w = new Wariness({ alertAt: 8, boltAt: 4, charge: 5 });
  assert.equal(w.step(0.1, 7.5, 7, 0), 'bolt');
  const v = new Wariness({ alertAt: 8, boltAt: 4, charge: 5 });
  v.step(0.1, 7.9, 1, 0);
  for (let i = 0; i < 20; i++) v.step(0.1, 11, 1, 0);
  assert.equal(v.state, 'calm');
});

test('head tilt: only after being looked at for a moment, and it alternates sides', () => {
  const t = new LookTilt();
  assert.equal(t.update(0.3, true), 0);
  const first = t.update(0.3, true);
  assert.ok(Math.abs(first) > 0.3);
  let flipped = 0;
  for (let i = 0; i < 40; i++) { const v = t.update(0.1, true); if (v !== 0 && Math.sign(v) !== Math.sign(first)) flipped++; }
  assert.ok(flipped > 0, 'tilts the other way next');
  assert.equal(t.update(0.1, false), 0);
});
