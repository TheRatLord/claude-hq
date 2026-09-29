import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lutData, sampleLut, PROTECTED, neutral, untoe, type GradePhase } from './lut.ts';
import { hexToRgb, srgbToLinear, linearToSrgb, linearRgbToLab, deltaE2000, BODY, type Rgb } from '../../../shared/palette.ts';

const lab = ([r, g, b]: Rgb) => linearRgbToLab([srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]);
/** what the screen shows for an sRGB colour: toe compensation + NEUTRAL tone map (sRGB domain, the LUT's input) */
const tone = ([r, g, b]: Rgb): Rgb => {
  const [tr, tg, tb] = neutral(untoe([srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]));
  return [linearToSrgb(Math.max(0, tr)), linearToSrgb(Math.max(0, tg)), linearToSrgb(Math.max(0, tb))];
};

const cases: [GradePhase, number][] = [['day', 3], ['golden', 8], ['night', 8], ['morning', 8]];
for (const [phase, max] of cases) {
  test(`LUT ${phase}: protected swatches within ΔE00 < ${max} of identity (§5.0)`, () => {
    const d = lutData(phase);
    const worst: [string, number][] = [];
    for (const h of PROTECTED) {
      // what the screen shows: toe compensation + NEUTRAL tone map, then the LUT (sRGB domain)
      const c = hexToRgb(h);
      const toned = tone(c);
      const dE = deltaE2000(lab(c), lab(sampleLut(d, toned)));
      worst.push([h, +dE.toFixed(2)]);
      assert.ok(dE < max, `${phase} ${h} ΔE ${dE.toFixed(2)}`);
    }
  });
}

test('LUT night grade actually moves the environment (not identity)', () => {
  const d = lutData('night');
  const c: Rgb = [0.45, 0.5, 0.42];
  const o = sampleLut(d, c);
  assert.ok(Math.abs(o[2] - c[2]) + Math.abs(o[0] - c[0]) > 0.02);
});

test('NEUTRAL + day LUT keep the codex slate body and clay within ΔE 3 (toe undone)', () => {
  const d = lutData('day');
  for (const h of [BODY.bodySlate, BODY.bodyClay, '#A1544B']) {
    const c = hexToRgb(h);
    const toned = tone(c);
    const dE = deltaE2000(lab(c), lab(sampleLut(d, toned)));
    assert.ok(dE < 3, `${h} ΔE ${dE.toFixed(2)}`);
  }
});
