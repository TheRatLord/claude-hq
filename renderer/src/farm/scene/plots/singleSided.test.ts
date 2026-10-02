import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leaf, merge, singleSided } from './geo.ts';
import { partName } from '../parts.ts';

test('singleSided drops reversed twins (leaf back faces) and keeps parts aligned', () => {
  const a = partName(leaf(0.4, 0.06, 0x55aa33), 'a'), b = partName(leaf(0.3, 0.05, 0x55aa33, { p: [1, 0, 0] }), 'b');
  const g = merge([a, b]);
  assert.equal(g.attributes.position.count, 24);
  const s = singleSided(g);
  assert.equal(s.attributes.position.count, 12);
  for (const k of Object.keys(g.attributes)) assert.equal(s.attributes[k].count, 12, k);
  assert.deepEqual(s.userData.parts, [{ name: 'a', start: 0, count: 6 }, { name: 'b', start: 6, count: 6 }]);
  assert.equal(singleSided(g), s, 'memoised');
  // nothing to drop: the same geometry back
  assert.equal(singleSided(s), s);
});
