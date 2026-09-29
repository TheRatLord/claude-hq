// @pure. Owner: RND.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lumaQuantiles, lumaSamples, isLightSource } from './lumaStats.ts';

const TGT = { p99: 0.88, p50: 0.14, p10: 0.03, bloomFrac: 0.015 };
/** RGBA frame from per-pixel grey luminances */
const frame = (vals: readonly number[]) => { const a = new Float32Array(vals.length * 4); vals.forEach((v, i) => { a[i * 4] = a[i * 4 + 1] = a[i * 4 + 2] = v; a[i * 4 + 3] = 1; }); return a; };

test('lumaStats: light sources and sky are excluded (m2 fix r3: Board / skylight no longer drag p10)', () => {
  // 80 lit surfaces 0.1..0.5, 20 "Board / sky" pixels: bright in the normal frame, exactly black when switched off
  const lit = Array.from({ length: 80 }, (_, i) => 0.1 + (0.4 * i) / 79);
  const pre = frame([...lit, ...Array(20).fill(0.6)]);
  const off = frame([...lit, ...Array(20).fill(0)]);
  const naive = lumaQuantiles(off, null, TGT);
  assert.equal(naive.p10, 0, 'the old measure: switched-off sources are black and own p10');
  assert.equal(naive.pass, false);
  const r = lumaQuantiles(pre, off, TGT, { maxCap: 0.95 });
  assert.ok(r.p10 >= 0.1 - 1e-6, `p10 ${r.p10}`);
  assert.equal(r.excluded, 0.2);
  assert.equal(r.pass, true);
});

test('lumaStats: surfaces with a small emissive glow stay in; strong emitters leave', () => {
  assert.equal(isLightSource(0.3, 0.29), false);   // lit wall, a hint of glow
  assert.equal(isLightSource(0.05, 0.049), false);  // dark floor
  assert.equal(isLightSource(0.5, 0.3), true);      // lamp shade: mostly emission
  assert.equal(isLightSource(0.02, 0.0), true);     // masked sky / screen: black when off
  assert.equal(isLightSource(0.0, 0.0), false);     // genuinely black paint stays (it is a real p10 failure)
});

test('lumaStats: bloomFrac counts the normal frame (lamps on), all pixels', () => {
  const pre = frame([1.2, 0.3, 0.3, 0.3]);
  const off = frame([0.0, 0.3, 0.3, 0.3]);
  const s = lumaSamples(pre, off);
  assert.equal(s.bloomFrac, 0.25);
  assert.equal(s.n, 3);
});

test('lumaStats: a lit surface over the cap still fails the emissive-off max rule', () => {
  const v = Array(100).fill(0.3); v[5] = 0.97;
  const r = lumaQuantiles(frame(v), frame(v), TGT, { maxCap: 0.95 });
  assert.equal(r.max, 0.97);
  assert.equal(r.maxIdx, 5);
  assert.equal(r.pass, false);
});
