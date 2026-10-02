import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markLabel, NOISY, pinnedFirst, quietEvent, setId, toggleId } from './marks.ts';
import { MARKS_MAX, sanitizeIds, sanitizePrefs } from './prefs.ts';

test('toggleId / setId: add at the end, remove, bounded, never mutates', () => {
  const a = ['x'];
  assert.deepEqual(toggleId(a, 'y'), ['x', 'y']);
  assert.deepEqual(toggleId(a, 'x'), []);
  assert.deepEqual(a, ['x']);
  assert.deepEqual(setId(['x'], 'x', true), ['x']);
  assert.deepEqual(setId(['x'], 'y', false), ['x']);
  assert.deepEqual(setId(['x'], 'x', false), []);
  const many = Array.from({ length: MARKS_MAX }, (_, i) => `p${i}`);
  const more = toggleId(many, 'new');
  assert.equal(more.length, MARKS_MAX);
  assert.equal(more[MARKS_MAX - 1], 'new');
  assert.equal(more[0], 'p1', 'the oldest mark goes first');
});

test('pinnedFirst: pinned in pin order, the rest keep the comparator / original order', () => {
  const items = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
  assert.deepEqual(pinnedFirst(items, (x) => x.id, ['d', 'b']).map((x) => x.id), ['d', 'b', 'a', 'c', 'e']);
  assert.deepEqual(pinnedFirst(items, (x) => x.id, []).map((x) => x.id), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(pinnedFirst(items, (x) => x.id, ['gone', 'c'], (p, q) => q.id.localeCompare(p.id)).map((x) => x.id), ['c', 'e', 'd', 'b', 'a']);
});

test('quietEvent: only a muted agent\'s noisy events', () => {
  assert.ok(NOISY.has('blocked') && NOISY.has('finished') && !NOISY.has('plot-opened'));
  assert.equal(quietEvent(['w1:p1'], { kind: 'blocked', id: 'w1:p1' }), true);
  assert.equal(quietEvent(['w1:p1'], { kind: 'finished', id: 'w1:p2' }), false);
  assert.equal(quietEvent(['w1:p1'], { kind: 'plot-opened', id: 'w1:p1' }), false);
  assert.equal(markLabel('pinned', true), 'Unpin');
  assert.equal(markLabel('muted', false), 'Mute');
});

test('sanitizeIds / prefs: pinned and muted survive a reload and nothing else does', () => {
  assert.deepEqual(sanitizeIds(['a', 'a', 7, '', 'x'.repeat(65), 'b', null]), ['a', 'b']);
  assert.deepEqual(sanitizeIds('a,b'), []);
  assert.equal(sanitizeIds(Array.from({ length: 200 }, (_, i) => `p${i}`)).length, MARKS_MAX);
  const p = sanitizePrefs({ pinned: ['w1:p1', 3], muted: { evil: true } });
  assert.deepEqual(p.pinned, ['w1:p1']);
  assert.deepEqual(p.muted, []);
  assert.deepEqual(sanitizePrefs(JSON.parse(JSON.stringify({ ...p, muted: ['w2:p4'] }))).muted, ['w2:p4']);
});
