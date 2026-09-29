// @pure helpers of the live monitor atlas (M3.5). Owner: RND.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tintLine, tailLines, wrapText, pickLive, fixGlyphs, INK, TILES, type LiveCand } from './monitorAtlas.ts';

test('tailLines: trailing blanks dropped, last n kept', () => {
  assert.deepEqual(tailLines(['a', 'b', 'c', '', '  ']), ['a', 'b', 'c']);
  assert.deepEqual(tailLines(['1', '2', '3', '4'], 2), ['3', '4']);
  assert.deepEqual(tailLines(undefined), []);
});

test('tintLine: Claude Code heuristics and ANSI SGR', () => {
  const bullet = tintLine('⏺ Bash(npm test)');
  assert.equal(bullet[0].color, INK.clay);
  assert.equal(bullet[0].text, '●');
  assert.equal(tintLine('  ⎿  Found 9 matches')[0].color, INK.dim);
  assert.equal(tintLine('✓ 42 tests passed')[0].color, INK.green);
  assert.equal(tintLine('Error: boom')[0].color, INK.red);
  assert.equal(tintLine('> fix the thing')[0].color, INK.cyan);
  const a = tintLine('\x1b[32mok\x1b[0m plain \x1b[31mbad');
  assert.deepEqual(a.map((r) => r.color), [INK.green, INK.text, INK.red]);
  assert.equal(a.map((r) => r.text).join(''), 'ok plain bad');
  assert.deepEqual(tintLine(''), []);
  assert.equal(fixGlyphs('⏺⎿⏵'), '●└▶');
});

test('wrapText: greedy, cuts long words', () => {
  assert.deepEqual(wrapText('Do you want to proceed?', 10), ['Do you', 'want to', 'proceed?']);
  assert.deepEqual(wrapText('abcdefghijkl', 5), ['abcde', 'fghij', 'kl']);
});

test('pickLive: proximity desk always wins, then nearest visible seated / blocked, capped', () => {
  const c = (key: string, dist: number, o: Partial<LiveCand> = {}): LiveCand => ({ key, dist, owned: true, seated: true, visible: true, blocked: false, ...o });
  const cands = [
    c('far', 9), c('near', 2), c('behind', 1.2, { visible: false, seated: false }), c('standing', 3, { seated: false }),
    c('blocked', 4, { seated: false, blocked: true }), c('unowned', 0.5, { owned: false }),
  ];
  const r = pickLive(cands);
  assert.equal(r.prox, 'behind', 'proximity wins even unseated / out of view');
  assert.deepEqual(r.live, ['behind', 'near', 'blocked', 'far']);
  const many = Array.from({ length: 30 }, (_, i) => c(`d${i}`, 2 + i));
  assert.equal(pickLive(many).live.length, TILES);
  assert.equal(pickLive(many, { max: 8 }).live.length, 8);
});
