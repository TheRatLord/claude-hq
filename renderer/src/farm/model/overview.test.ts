import { test } from 'node:test';
import assert from 'node:assert/strict';
import { columnsOf, gridMove, overviewOrder, tileRank, tileState, type TileFarmer } from './overview.ts';

const F = (id: string, o: Partial<TileFarmer> = {}): TileFarmer => ({ id, tag: id, status: 'idle', needsYou: false, unseenDone: false, struggle: 0, jobSince: 0, ...o });

test('tileState: asks outrank everything, unreviewed finishes read as done', () => {
  assert.equal(tileState({ status: 'working', needsYou: true, unseenDone: false }), 'blocked');
  assert.equal(tileState({ status: 'idle', needsYou: false, unseenDone: true }), 'done');
  assert.equal(tileState({ status: 'blocked', needsYou: false, unseenDone: false }), 'working', 'answered, not yet moving');
  assert.equal(tileState({ status: 'unknown', needsYou: false, unseenDone: false }), 'unknown');
});

test('overviewOrder: pinned first, then asks (longest waiting), struggling, unreviewed, working, idle; names otherwise', () => {
  const list = [
    F('idle-b'), F('idle-a'), F('work', { status: 'working' }), F('stuck', { status: 'working', struggle: 2 }),
    F('ask-new', { status: 'blocked', needsYou: true, jobSince: 200 }), F('ask-old', { status: 'blocked', needsYou: true, jobSince: 100 }),
    F('fin', { status: 'done', unseenDone: true }), F('unk', { status: 'unknown' }),
  ];
  assert.deepEqual(overviewOrder(list).map((f) => f.id), ['ask-old', 'ask-new', 'stuck', 'fin', 'work', 'idle-a', 'idle-b', 'unk']);
  assert.deepEqual(overviewOrder(list, ['idle-b', 'work']).map((f) => f.id).slice(0, 3), ['idle-b', 'work', 'ask-old']);
  assert.equal(tileRank(F('x', { needsYou: true })), 0);
});

test('gridMove / columnsOf: arrows in a wrapping grid, edges hold, Home / End / pages', () => {
  // 10 tiles, 4 wide: rows [0..3] [4..7] [8, 9]
  assert.equal(gridMove(0, 'ArrowRight', 4, 10), 1);
  assert.equal(gridMove(3, 'ArrowRight', 4, 10), 4, 'right wraps to the next row');
  assert.equal(gridMove(0, 'ArrowLeft', 4, 10), 0);
  assert.equal(gridMove(1, 'ArrowDown', 4, 10), 5);
  assert.equal(gridMove(6, 'ArrowDown', 4, 10), 6, 'no tile below: stay');
  assert.equal(gridMove(5, 'ArrowDown', 4, 10), 9);
  assert.equal(gridMove(2, 'ArrowUp', 4, 10), 2);
  assert.equal(gridMove(9, 'ArrowUp', 4, 10), 5);
  assert.equal(gridMove(4, 'Home', 4, 10), 0);
  assert.equal(gridMove(4, 'End', 4, 10), 9);
  assert.equal(gridMove(0, 'PageDown', 4, 10, 1), 4);
  assert.equal(gridMove(9, 'PageUp', 4, 10, 4), 0);
  assert.equal(gridMove(3, 'x', 4, 10), 3);
  assert.equal(gridMove(0, 'ArrowRight', 4, 0), 0, 'empty grid');
  assert.equal(gridMove(50, 'ArrowLeft', 4, 10), 8, 'an out-of-range selection is clamped first');
  assert.equal(columnsOf([10, 10, 10, 120, 120]), 3);
  assert.equal(columnsOf([]), 1);
  assert.equal(columnsOf([5, 6.5, 230]), 2, 'sub-pixel jitter is one row');
});
