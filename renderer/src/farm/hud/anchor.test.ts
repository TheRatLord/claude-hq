import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addPlaced, distScale, edgeClamp, nudgeUp, pageMs, pageText, placed } from './anchor.ts';

test('pageText: short text is one page; long text pages at sentences or words, never mid-word', () => {
  assert.deepEqual(pageText('  Hello   there. '), ['Hello there.']);
  const long = 'I refactored the store so every topic has one owner. Then I moved the reducers into their own module and added tests for the merge order, which was the subtle part of the whole change. Tests pass.';
  const pages = pageText(long, 80);
  assert.ok(pages.length >= 3);
  for (const p of pages) assert.ok(p.length <= 80 + 24, p);
  assert.equal(pages.join(' '), long, 'nothing is lost');
  const words = new Set(long.split(' '));
  for (const p of pages) for (const w of p.split(' ')) assert.ok(words.has(w), `"${w}" was cut mid-word`);
  assert.ok(pages[0].endsWith('owner.'), 'breaks after a sentence when it can');
  assert.ok(pageMs('x') >= 2400 && pageMs('y'.repeat(400)) <= 6500);
});

test('edgeClamp: off-screen targets pin to the edge, pointing at them; behind the camera flips', () => {
  const o = { x: 0, y: 0, angle: 0 };
  edgeClamp(3000, 450, false, 1600, 900, 40, o);
  assert.deepEqual([o.x, o.y, Math.round(o.angle * 100)], [1560, 450, 0]);
  edgeClamp(800, -500, false, 1600, 900, 40, o);
  assert.equal(o.y, 40);
  assert.ok(Math.abs(o.angle + Math.PI / 2) < 1e-6, 'points up');
  // behind the camera and projected to the right → it is really to the left
  edgeClamp(1000, 450, true, 1600, 900, 40, o);
  assert.equal(o.x, 40);
});

test('nudgeUp: stacks move up past what is placed, give up past the limit', () => {
  const p = placed(8);
  addPlaced(p, 100, 100, 200, 50);
  assert.equal(nudgeUp(p, 500, 100, 100, 40, 4, 200), 100, 'no overlap, no move');
  assert.equal(nudgeUp(p, 150, 120, 100, 40, 4, 200), 100 - 40 - 4);
  addPlaced(p, 150, 56, 100, 40);
  assert.equal(nudgeUp(p, 160, 120, 100, 40, 4, 200), 56 - 40 - 4, 'cascades over several');
  assert.ok(Number.isNaN(nudgeUp(p, 160, 120, 100, 40, 4, 30)));
  assert.equal(distScale(3), 1);
  assert.equal(distScale(200), 0.74);
});

test('placeRect: steps around HUD furniture, prefers up, gives up when boxed in', async () => {
  const { placeRect } = await import('./anchor.ts');
  const out = { x: 0, y: 0 };
  const p = placed(8);
  // a status card top-left, a bubble wanted half under it
  addPlaced(p, 14, 14, 360, 120);
  assert.equal(placeRect(p, 300, 60, 200, 60, 6, 1600, 900, 8, 400, out), true);
  assert.ok(out.x >= 14 + 360 + 6 || out.y >= 14 + 120 + 6, 'clear of the card');
  assert.deepEqual([out.x, out.y], [380, 60], 'the short way: sideways');
  // free space: unchanged
  assert.equal(placeRect(p, 800, 400, 200, 60, 6, 1600, 900, 8, 400, out), true);
  assert.deepEqual([out.x, out.y], [800, 400]);
  // something in the way below a free sky: goes up
  addPlaced(p, 700, 380, 400, 100);
  assert.equal(placeRect(p, 800, 400, 200, 60, 6, 1600, 900, 8, 400, out), true);
  assert.deepEqual([out.x, out.y], [800, 380 - 60 - 6]);
  // boxed in
  const full = placed(2);
  addPlaced(full, 0, 0, 1600, 900);
  assert.equal(placeRect(full, 800, 400, 200, 60, 6, 1600, 900, 8, 400, out), false);
});
