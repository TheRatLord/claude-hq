import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GESTURE_SECS, emptyInput, emptyOut, gestureFor, gestureSide, gestureState, lanternLit, lanternShown, requestGesture, resolveHands,
  settleLantern, stepGesture, toggleLantern,
} from './logic.ts';
import type { HandsInput } from './logic.ts';

const resolve = (p: Partial<HandsInput>) => resolveHands({ ...emptyInput(), ...p }, emptyOut());

test('hidden in photo mode, in menus and when Settings → Show hands is off', () => {
  assert.equal(resolve({}).show, true);
  assert.equal(resolve({ photo: true }).show, false);
  assert.equal(resolve({ menu: true }).show, false);
  assert.equal(resolve({ enabled: false }).show, false);
});

test('one-handed things: rod and chores in the right paw, the lantern in the left, the basket where there is room', () => {
  assert.deepEqual(resolve({ fishing: true, lantern: true }), { show: true, mode: 'free', left: 'lantern', right: 'rod' });
  assert.deepEqual(resolve({ chore: 'grain' }), { show: true, mode: 'free', left: 'none', right: 'grain' });
  assert.equal(resolve({ fishing: true, chore: 'hay' }).right, 'rod', 'the rod wins over a chore');
  assert.equal(resolve({ basket: true }).left, 'basket');
  const lit = resolve({ basket: true, lantern: true });
  assert.equal(lit.left, 'lantern'); assert.equal(lit.right, 'basket', 'the lantern keeps the left paw, the basket moves right');
  const busy = resolve({ basket: true, lantern: true, fishing: true });
  assert.equal(busy.left, 'lantern'); assert.equal(busy.right, 'rod', 'no paw left: no basket');
});

test('two-handed modes take both paws (and put the lantern away), by priority', () => {
  assert.deepEqual(resolve({ rowing: true, lantern: true, fishing: true }), { show: true, mode: 'oars', left: 'none', right: 'none' });
  assert.equal(resolve({ viewing: true, rowing: true }).mode, 'telescope');
  assert.equal(resolve({ rolling: true, decor: true }).mode, 'push');
  assert.equal(resolve({ decor: true }).mode, 'carry');
  assert.equal(lanternShown(resolve({ rowing: true, lantern: true })), false);
  // skating leaves the paws free: the arms swing, a lantern swings along
  const sk = resolve({ skating: true, lantern: true });
  assert.equal(sk.mode, 'skate'); assert.equal(sk.left, 'lantern'); assert.equal(lanternShown(sk), true);
  assert.equal(lanternShown(resolve({ lantern: true, menu: true })), false);
});

test('gestures pick a free paw; none in two-handed modes', () => {
  assert.equal(gestureSide(resolve({}), 'grab'), 'right');
  assert.equal(gestureSide(resolve({ fishing: true }), 'wave'), 'left', 'the rod hand is busy: wave with the other');
  assert.equal(gestureSide(resolve({ fishing: true, lantern: true }), 'pat'), null);
  assert.equal(gestureSide(resolve({}), 'shield'), 'both');
  assert.equal(gestureSide(resolve({ lantern: true }), 'shield'), 'right');
  assert.equal(gestureSide(resolve({ lantern: true }), 'cheer'), 'right');
  assert.equal(gestureSide(resolve({ rowing: true }), 'wave'), null);
  assert.equal(gestureSide(resolve({ skating: true }), 'wave'), 'right');
  assert.equal(gestureSide(resolve({ menu: true }), 'wave'), null);
});

test('using things: pick up → grab, pet → pat, coin → coin, a villager → wave, a farmer card → nothing', () => {
  assert.equal(gestureFor('prop', 'Pick up'), 'grab');
  assert.equal(gestureFor('animal', 'Pet'), 'pat');
  assert.equal(gestureFor('animal', 'Feed'), 'grab');
  assert.equal(gestureFor('structure', 'Toss a coin into'), 'coin');
  assert.equal(gestureFor('villager', 'Talk to'), 'wave');
  assert.equal(gestureFor('villager', 'Gift'), 'grab');
  assert.equal(gestureFor('farmer', 'Check on'), null);
  assert.equal(gestureFor('structure', 'Read'), null);
  assert.equal(gestureFor('prop', 'Cast a line'), null, 'the rod does the casting');
  assert.equal(gestureFor('structure', 'Ring'), 'poke');
});

test('the lantern: automatic after dusk outdoors, the key flips it, a manual choice lasts until dusk / dawn', () => {
  assert.equal(lanternLit('auto', 0.1, false), false);
  assert.equal(lanternLit('auto', 0.8, false), true);
  assert.equal(lanternLit('auto', 0.8, true), false, 'not indoors by itself');
  assert.equal(lanternLit('on', 0, true), true);
  assert.equal(lanternLit('off', 1, false), false);
  assert.equal(toggleLantern('auto', true), 'off');
  assert.equal(toggleLantern('auto', false), 'on');
  assert.equal(settleLantern('off', 0.8, 0.82), 'off', 'still night: stays off');
  assert.equal(settleLantern('off', 0.6, 0.5), 'auto', 'dawn: automatic again');
  assert.equal(settleLantern('on', 0.2, 0.6), 'auto', 'dusk: automatic (and lit)');
});

test('gesture player: one at a time, a queue of one, the storm shield cuts in, cooldowns', () => {
  const o = resolve({});
  const s = gestureState();
  assert.ok(requestGesture(s, 'grab', o, 0));
  assert.equal(s.g, 'grab'); assert.equal(s.side, 'right');
  assert.ok(requestGesture(s, 'wave', o, 0.1));
  assert.equal(s.g, 'grab'); assert.equal(s.next, 'wave');
  for (let t = 0; t < GESTURE_SECS.grab + 0.05; t += 0.05) stepGesture(s, o, 0.05, t);
  assert.equal(s.g, 'wave', 'the queued wave plays next');
  assert.ok(requestGesture(s, 'shield', o, 1));
  assert.equal(s.g, 'shield', 'shield cuts in'); assert.equal(s.side, 'both');
  assert.equal(requestGesture(s, 'shield', o, 2), false, 'cooldown');
  const c = gestureState();
  assert.ok(requestGesture(c, 'cheer', o, 10));
  for (let t = 10; t < 12; t += 0.1) stepGesture(c, o, 0.1, t);
  assert.equal(requestGesture(c, 'cheer', o, 12), false, 'one cheer per few seconds');
  assert.ok(requestGesture(c, 'cheer', o, 17));
});

test('gesture player: stops when its paw gets busy or the paws hide', () => {
  const s = gestureState();
  assert.ok(requestGesture(s, 'pat', resolve({}), 0));
  stepGesture(s, resolve({ fishing: true }), 0.1, 0.1);
  assert.equal(s.g, null, 'picked up the rod mid-pat');
  assert.ok(requestGesture(s, 'wave', resolve({}), 1));
  stepGesture(s, resolve({ menu: true }), 0.1, 1.1);
  assert.equal(s.g, null);
  assert.equal(requestGesture(s, 'wave', resolve({ rowing: true }), 2), false, 'no free paw: dropped');
});
