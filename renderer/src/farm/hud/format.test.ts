import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askOrder, clock, dur, letterKey, letterTitle, matchCombo, matches, nextAfter, nice, notifyCopy, parseCombo, rosterFilterHit } from './format.ts';

const key = (o: Partial<KeyboardEvent>) => ({ key: '', code: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...o });

test('leader key combos parse and match by key or physical code', () => {
  const c = parseCombo('Ctrl+`');
  assert.deepEqual(c, { ctrl: true, alt: false, shift: false, meta: false, key: '`' });
  assert.ok(matchCombo(key({ key: '`', code: 'Backquote', ctrlKey: true }), c));
  assert.ok(matchCombo(key({ key: 'Dead', code: 'Backquote', ctrlKey: true }), c), 'layout-independent via code');
  assert.ok(!matchCombo(key({ key: '`', code: 'Backquote' }), c), 'needs ctrl');
  assert.ok(!matchCombo(key({ key: '`', code: 'Backquote', ctrlKey: true, altKey: true }), c), 'extra modifiers do not match');
  assert.ok(matchCombo(key({ key: 'T', code: 'KeyT', altKey: true, shiftKey: true }), parseCombo('Alt+Shift+T')));
  assert.equal(parseCombo(''), null);
});

test('durations, clock, names and letter titles read naturally', () => {
  assert.equal(dur(4_000), '4s');
  assert.equal(dur(5 * 60_000), '5m');
  assert.equal(dur(90 * 60_000), '1h 30m');
  assert.equal(dur(3 * 86_400_000), '3d');
  assert.equal(clock(9.5), '09:30');
  assert.equal(clock(23.99), '23:59');
  assert.equal(nice('flint'), 'Flint');
  assert.equal(nice('d1:p2'), 'd1:p2');
  assert.equal(letterTitle({ title: 'willow finished', farmerName: 'willow' }), 'Willow finished');
  assert.equal(letterTitle({ title: 'Tests passed for juniper', farmerName: 'juniper' }), 'Tests passed for Juniper');
  assert.equal(letterKey({ kind: 'finished', farmerId: 'd1:p1', at: 12_345_678 }), 'finished|d1:p1|12346');
});

test('filter matches every word anywhere', () => {
  assert.ok(matches('', 'x'));
  assert.ok(matches('fl need', 'Flint', 'needs you'));
  assert.ok(!matches('flint cows', 'Flint', 'wheat'));
});

test('short names: the in-world tag first, the full name as the secondary line, one glyph per pin', async () => {
  const { shortName, altName, pinGlyph } = await import('./format.ts');
  assert.equal(shortName({ name: '~/src/claude-hq/renderer', tag: 'claude-hq' }), 'claude-hq');
  assert.equal(shortName({ name: 'flint' }), 'Flint');
  assert.equal(altName({ name: '~/src/claude-hq', tag: 'claude-hq' }), '~/src/claude-hq');
  assert.equal(altName({ name: 'claude-hq', tag: 'claude-hq' }), '');
  assert.equal(altName({ name: 'flint', tag: 'claude-hq·flint' }), 'Flint');
  assert.equal(pinGlyph({ name: 'flint', tag: 'claude-hq·flint' }), 'F');
  assert.equal(pinGlyph({ name: 'x', tag: 'webshop·2' }), '2');
  assert.equal(pinGlyph({ name: 'x', tag: 'webshop' }), 'W');
});

test('field-grouped lists show only the distinguishing part of the tag', async () => {
  const { fieldName, altName } = await import('./format.ts');
  assert.equal(fieldName({ name: 'flint', tag: 'claude-hq·flint' }), 'flint');
  assert.equal(fieldName({ name: 'x', tag: 'webshop·2' }), 'webshop·2');
  assert.equal(fieldName({ name: '~/src/claude-hq', tag: 'claude-hq' }), 'claude-hq');
  assert.equal(altName({ name: 'flint', tag: 'claude-hq·flint' }, 'flint'), '');
});

test('answer + next: the item that takes the answered one\'s place', () => {
  assert.equal(nextAfter(['a', 'b', 'c'], 'a'), 'b');
  assert.equal(nextAfter(['a', 'b', 'c'], 'b'), 'c');
  assert.equal(nextAfter(['a', 'b', 'c'], 'c'), 'b', 'the last one falls back to the one before');
  assert.equal(nextAfter(['a'], 'a'), null);
  assert.equal(nextAfter(['a', 'b'], 'zz'), 'a', 'unknown: start at the top');
  assert.equal(nextAfter([], 'zz'), null);
  const asks = [{ since: 1, id: 'x' }, { since: 3, id: 'y' }, { since: 3, id: 'a' }];
  assert.deepEqual(asks.sort(askOrder).map((a) => a.id), ['a', 'y', 'x'], 'newest first, ties by id');
});

test('ledger status chips split farmers without overlap', () => {
  const f = (status: 'blocked' | 'working' | 'done' | 'idle' | 'unknown', needsYou = false, unseenDone = false) => ({ status, needsYou, unseenDone });
  const all = [f('blocked', true), f('working'), f('done', false, true), f('done'), f('idle'), f('unknown')];
  const hits = (k: Parameters<typeof rosterFilterHit>[0]) => all.filter((x) => rosterFilterHit(k, x)).length;
  assert.equal(hits(null), 6);
  assert.equal(hits('needs'), 1);
  assert.equal(hits('working'), 1);
  assert.equal(hits('done'), 2);
  assert.equal(hits('idle'), 3, 'idle, away and reviewed-done');
  assert.ok(rosterFilterHit(null, null) && !rosterFilterHit('needs', null), 'scarecrows only unfiltered');
});

test('desktop notification copy: one ping speaks for itself, a burst summarises asks first', () => {
  assert.equal(notifyCopy([]), null);
  assert.deepEqual(notifyCopy([{ kind: 'blocked', id: 'a', name: 'claude-hq·flint', text: 'Proceed?' }]), { title: 'claude-hq·flint needs you', body: 'Proceed?' });
  assert.deepEqual(notifyCopy([{ kind: 'finished', id: 'a', name: 'tinker', text: '' }]), { title: 'tinker finished', body: 'Ready for your review' });
  const many = notifyCopy([
    { kind: 'finished', id: 'd', name: 'dune', text: '' },
    { kind: 'blocked', id: 'a', name: 'atlas', text: 'q' }, { kind: 'blocked', id: 'b', name: 'birch', text: 'q' },
    { kind: 'blocked', id: 'c', name: 'cobalt', text: 'q' }, { kind: 'blocked', id: 'e', name: 'ember', text: 'q' },
  ]);
  assert.equal(many?.title, 'Claude Valley: 4 need you · 1 finished');
  assert.equal(many?.body, 'Waiting: atlas, birch, cobalt +1\nDone: dune');
});
