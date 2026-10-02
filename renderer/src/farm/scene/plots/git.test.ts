import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GIT_WEEDS, branchColor, gitWeedSpots, weedCount } from './git.ts';

test('git weeds: log-scaled by changed files, a handful at most', () => {
  assert.deepEqual([0, 1, 2, 4, 8, 23, 500].map(weedCount), [0, 1, 3, 5, 7, 10, 10]);
});

test('branch pennant: main / master share the valley colour, others never take it, detached is grey', () => {
  assert.equal(branchColor('main'), branchColor('master'));
  for (const b of ['feat/x', 'fix/y', 'chore/deps', 'spike/webgpu', 'refactor/store']) assert.notEqual(branchColor(b), branchColor('main'));
  assert.equal(branchColor('feat/x'), branchColor('feat/x'));
  assert.notEqual(branchColor(null), branchColor('main'));
});

test('weed spots stay in the field, clear of farmer spots and plants, spread out, deterministic', () => {
  const clears = [{ x: 0, z: 0, r: 0.9 }, { x: -3, z: 5.6, r: 0.9 }];
  const plants = [{ x: -1.5, z: 1 }];
  const o = { hw: 9, hd: 7, rows: [-7.8, -6.6, -5.4, -4.2, -3, -1.8, -0.6, 0.6, 1.8, 3, 4.2, 5.4, 6.6], clears, plants, key: 'p1' };
  const a = gitWeedSpots(o), b = gitWeedSpots(o);
  assert.deepEqual(a, b);
  assert.equal(a.length, GIT_WEEDS);
  for (const w of a) {
    assert.ok(Math.abs(w.x) < 9 && Math.abs(w.z) < 7);
    for (const c of clears) assert.ok(Math.hypot(w.x - c.x, w.z - c.z) > c.r * 0.7);
    for (const q of a) if (q !== w) assert.ok(Math.hypot(w.x - q.x, w.z - q.z) >= 1.4);
  }
});
