import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SKYLINE_DIST, SKYLINE_HEIGHT, skylineProfile } from './skyline.ts';

test('the baked skyline rings the valley: every azimuth finds the rim or a peak beyond it, within the encoding', () => {
  const n = 32, p = skylineProfile(n);
  for (let i = 0; i < n; i++) {
    const d = p[i * 2], h = p[i * 2 + 1];
    assert.ok(d >= 80 && d < SKYLINE_DIST, `distance ${d} at ${i}`);
    assert.ok(h > 20 && h < SKYLINE_HEIGHT, `height ${h} at ${i}`);
    // seen from the middle the skyline stands well above the horizon (reflections need a visible rim)
    assert.ok(h / d > 0.15, `slope ${(h / d).toFixed(2)} at ${i}`);
  }
});
