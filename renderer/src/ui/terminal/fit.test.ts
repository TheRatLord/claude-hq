import { test } from 'node:test';
import assert from 'node:assert/strict';
import { letterbox, gridFor } from './fit.ts';

test('fit: preserve the child grid, scale font to fit, then pan', () => {
  const cw = (px: number) => px * 0.6, ch = (px: number) => px * 1.2;
  assert.equal(letterbox({ boxW: 800, boxH: 600, cols: 80, rows: 24, fontPx: 14, cellW: cw, cellH: ch }).fontPx, 14);
  const s = letterbox({ boxW: 600, boxH: 600, cols: 80, rows: 24, fontPx: 14, cellW: cw, cellH: ch });
  assert.ok(s.fontPx < 14 && !s.pan);
  assert.ok(letterbox({ boxW: 300, boxH: 200, cols: 200, rows: 60, fontPx: 14, cellW: cw, cellH: ch }).pan);
  assert.deepEqual(gridFor(1000, 10, 10, 20), { cols: 100, rows: 4 });
});
