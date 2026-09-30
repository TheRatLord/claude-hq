import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGlyphTable, glyphMapper } from './glyphs.ts';

test('glyphs: missing symbols swap in place; split UTF-8 sequences carry over', () => {
  const table = buildGlyphTable((ch) => !['⎿', '⏺'].includes(ch));
  const map = glyphMapper(table);
  const enc = new TextEncoder(), dec = new TextDecoder();
  assert.equal(dec.decode(map(enc.encode('⏺ Bash(ls)\r\n  ⎿ ok ✻'))), '● Bash(ls)\r\n  └ ok ✻');
  const b = enc.encode('a⎿b');
  const out = dec.decode(map(b.subarray(0, 2))) + dec.decode(map(b.subarray(2)));
  assert.equal(out, 'a└b');
});

test('glyphs: missing pictographs keep two-cell width, including across frames', () => {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const m = glyphMapper(new Map(), (cp) => cp !== 0x1f44b);
  assert.equal(dec.decode(m(enc.encode('Hi! 👋 ok 🎉'))), 'Hi! ◆  ok 🎉');
  const m2 = glyphMapper(new Map(), () => false);
  const b = enc.encode('x👋');
  const out = dec.decode(new Uint8Array([...m2(b.subarray(0, 3)), ...m2(b.subarray(3))]));
  assert.equal(out, 'x◆ ', 'a split sequence is carried over');
});
