import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choose, DEST, LYING, transitionFor } from './behavior.ts';
import type { Act, BeastKey, Mood } from './behavior.ts';
import { mulberry32 } from '../../../../../shared/identity.ts';

const calm: Mood = { sleepy: 0, lively: 0.5, dirt: 0, hasMud: true, hasNests: true, hasPosts: true };
const tally = (sp: BeastKey, m: Mood, n = 4000) => {
  const r = mulberry32(7), c = new Map<Act, number>();
  for (let i = 0; i < n; i++) { const p = choose(sp, m, r); c.set(p.act, (c.get(p.act) ?? 0) + 1); assert.ok(p.dur > 0); }
  return c;
};

test('each species only does its own tricks', () => {
  const cow = tally('cow', calm), hen = tally('chicken', calm), pig = tally('pig', calm), sheep = tally('sheep', calm);
  for (const a of ['roll', 'dust', 'brood', 'root', 'chase'] as Act[]) assert.ok(!cow.has(a), `cow ${a}`);
  for (const a of ['roll', 'root', 'scratch', 'rest'] as Act[]) assert.ok(!hen.has(a), `hen ${a}`);
  for (const a of ['dust', 'brood', 'chase'] as Act[]) assert.ok(!pig.has(a), `pig ${a}`);
  assert.ok(pig.has('roll') && pig.has('root') && hen.has('dust') && hen.has('brood') && sheep.has('shake') && cow.has('scratch'));
  // grazing dominates a calm day
  assert.ok((cow.get('graze') ?? 0) > (cow.get('wander') ?? 0));
});

test('nobody sleeps in the day; at night nearly everyone does', () => {
  for (const sp of ['cow', 'sheep', 'pig', 'chicken'] as BeastKey[]) {
    assert.ok(!tally(sp, calm).has('sleep'), `${sp} day`);
    const night = tally(sp, { ...calm, sleepy: 1 });
    const lying = [...night].filter(([a]) => LYING.has(a)).reduce((s, [, n]) => s + n, 0);
    assert.ok(lying / 4000 > 0.6, `${sp} night ${lying}`);
    assert.equal(DEST.sleep, 'bed');
  }
});

test('missing props switch their activities off; muddy pigs shake more', () => {
  const noMud = tally('pig', { ...calm, hasMud: false });
  assert.ok(!noMud.has('roll'));
  assert.ok(!tally('chicken', { ...calm, hasNests: false }).has('brood'));
  assert.ok(!tally('cow', { ...calm, hasPosts: false }).has('scratch'));
  const clean = tally('pig', calm).get('shake') ?? 0, dirty = tally('pig', { ...calm, dirt: 1 }).get('shake') ?? 0;
  assert.ok(dirty > clean * 2);
});

test('lying activities go down first, standing ones get up first', () => {
  assert.equal(transitionFor(false, 'sleep'), 'down');
  assert.equal(transitionFor(true, 'graze'), 'up');
  assert.equal(transitionFor(true, 'rest'), null);
  assert.equal(transitionFor(false, 'wander'), null);
});
