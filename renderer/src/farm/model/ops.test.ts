import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldsMatch, focusQueue, fuzzyScore, nextFocus, snippet } from './ops.ts';

test('fuzzyScore: in-order subsequence, case-insensitive; -1 otherwise', () => {
  assert.ok(fuzzyScore('pbl', 'claude-hq·pebble') > 0);
  assert.equal(fuzzyScore('lbp', 'claude-hq·pebble'), -1);
  assert.equal(fuzzyScore('xyz', 'claude-hq'), -1);
  assert.equal(fuzzyScore('', 'anything'), 0);
  assert.equal(fuzzyScore('a', ''), -1);
  assert.ok(fuzzyScore('PEB', 'claude-hq·pebble') > 0);
});

test('fuzzyScore: substrings beat scattered letters, word starts beat mid-word, short beats long', () => {
  assert.ok(fuzzyScore('pebble', 'claude-hq·pebble') > fuzzyScore('pebble', 'p e b b l e scattered'));
  assert.ok(fuzzyScore('peb', 'claude-hq·pebble') > fuzzyScore('peb', 'xpebble'));
  assert.ok(fuzzyScore('map', 'Map') > fuzzyScore('map', 'the map of the whole valley and everything in it'));
  // initials ("chp" → claude-hq·pebble) still match
  assert.ok(fuzzyScore('chp', 'claude-hq·pebble') > 0);
});

test('fieldsMatch: every word must hit some field; weights rank the name over what they said', () => {
  const byName = fieldsMatch('pebble', [{ text: 'claude-hq·pebble', weight: 3 }, { text: 'said nothing' }]);
  const bySaid = fieldsMatch('pebble', [{ text: 'claude-hq·iris', weight: 3 }, { text: 'I asked pebble about it' }]);
  assert.ok(byName && bySaid);
  assert.ok(byName.score > bySaid.score);
  assert.equal(byName.field, 0);
  assert.equal(bySaid.field, 1);
  assert.equal(fieldsMatch('pebble zzz', [{ text: 'claude-hq·pebble' }]), null);
  assert.ok(fieldsMatch('hq tests', [{ text: 'claude-hq' }, { text: 'running tests' }]));
  assert.deepEqual(fieldsMatch('  ', [{ text: 'x' }]), { score: 0, field: 0 });
  assert.ok(fieldsMatch('x', [{ text: null }, { text: undefined }, { text: 'x' }]));
});

test('snippet: a window around the first hit, ellipses where cut', () => {
  assert.equal(snippet('short  text', 'x'), 'short text');
  const long = `${'a'.repeat(100)} the needle is here ${'b'.repeat(100)}`;
  const s = snippet(long, 'needle', 60);
  assert.ok(s.includes('needle'));
  assert.ok(s.startsWith('…') && s.endsWith('…'));
  assert.ok(s.length <= 62);
  assert.ok(snippet(long, 'missing', 30).endsWith('…'));
});

const F = (id: string, p: Partial<{ needsYou: boolean; unseenDone: boolean; status: 'working' | 'idle' | 'done' | 'blocked' | 'unknown'; struggle: 0 | 1 | 2 | 3; jobSince: number }> = {}) => ({
  id, needsYou: false, unseenDone: false, status: 'working' as const, struggle: 0 as const, jobSince: 0, ...p,
});

test('focusQueue: asks (longest waiting first), then badly struggling, then unreviewed finishes; nobody else', () => {
  const q = focusQueue([
    F('calm'),
    F('idle', { status: 'idle' }),
    F('done-old', { unseenDone: true, status: 'done', jobSince: 10 }),
    F('ask-new', { needsYou: true, status: 'blocked', jobSince: 500 }),
    F('stuck', { struggle: 2, jobSince: 50 }),
    F('meh', { struggle: 1 }),
    F('ask-old', { needsYou: true, status: 'blocked', jobSince: 100 }),
    F('done-new', { unseenDone: true, status: 'done', jobSince: 900 }),
  ]);
  assert.deepEqual(q.map((x) => x.id), ['ask-old', 'ask-new', 'stuck', 'done-old', 'done-new']);
  assert.deepEqual(q.map((x) => x.why), ['ask', 'ask', 'stuck', 'done', 'done']);
  assert.deepEqual(focusQueue([F('a'), F('b', { status: 'idle' })]), []);
});

test('nextFocus: the head, skipping the current one and those already visited this round; wraps', () => {
  const q = focusQueue([F('a', { needsYou: true, jobSince: 1 }), F('b', { needsYou: true, jobSince: 2 }), F('c', { unseenDone: true, jobSince: 3 })]);
  assert.equal(nextFocus(q, null)?.id, 'a');
  assert.equal(nextFocus(q, 'a')?.id, 'b');
  // in b, a is still waiting (not answered yet): it was visited this round, so c comes first
  assert.equal(nextFocus(q, 'b', ['a', 'b'])?.id, 'c');
  // everything visited: back to the head (wrap)
  assert.equal(nextFocus(q, 'c', ['a', 'b', 'c'])?.id, 'a');
  assert.equal(nextFocus(q.slice(0, 1), 'a'), null);
  assert.equal(nextFocus([], null), null);
});

test('fuzzyScore: long texts (what they said) need the word itself; scattered letters stay within a tight span', () => {
  const said = 'Read the relevant code · Implement coalesce store updates · Add or update tests';
  assert.equal(fuzzyScore('rate', said), -1);
  assert.ok(fuzzyScore('coalesce', said) > 0);
  assert.ok(fuzzyScore('chp', 'claude-hq·pebble') > 0);
});

test('scrollback search helpers: when to search, what to look for in the history', async () => {
  const { findNeedle, wantsScrollSearch, SEARCH_MIN } = await import('./ops.ts');
  assert.equal(SEARCH_MIN, 3);
  assert.equal(wantsScrollSearch('ab'), false);
  assert.equal(wantsScrollSearch(' a b '), false);
  assert.equal(wantsScrollSearch('rate'), true);
  assert.deepEqual(findNeedle({ text: '…ERROR rate limit exceeded on /api/v1', match: [7, 11] }), { text: 'rate limit exceeded on /api/v1', word: 'rate' });
  const long = `x RATE ${'y'.repeat(80)}…`;
  const n = findNeedle({ text: long, match: [2, 6] });
  assert.equal(n.text.length, 48);
  assert.ok(n.text.startsWith('RATE'));
  assert.equal(findNeedle({ text: 'end…', match: [0, 3] }).text, 'end');
});
