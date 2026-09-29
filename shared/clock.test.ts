import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitClock } from './clock.ts';

test('waitClock: m:ss under an hour, h:mm:ss after, honest ≥ for since-boot ages', () => {
  assert.equal(waitClock(7_000), '0:07');
  assert.equal(waitClock(3_599_000), '59:59');
  assert.equal(waitClock(3_600_000), '1:00:00');
  assert.equal(waitClock(263 * 60_000 + 55_000), '4:23:55'); // never "263:55"
  assert.equal(waitClock(15_825_000, true), '≥ 4:23:45');
  assert.equal(waitClock(-5), '0:00');
  assert.equal(waitClock(NaN), '0:00');
});
