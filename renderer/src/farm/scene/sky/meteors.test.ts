import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meteorGap, showerOn } from './meteors.ts';

test('meteors: showers on their real peak nights only', () => {
  assert.equal(showerOn(224)?.name, 'Perseids');
  assert.equal(showerOn(225)?.name, 'Perseids');
  assert.equal(showerOn(348)?.name, 'Geminids');
  assert.equal(showerOn(364)?.name, undefined);
  assert.equal(showerOn(2)?.name, 'Quadrantids'); // wraps the new year
  assert.equal(showerOn(150), null);
});

test('meteors: none under cloud or by day, more often on clear nights and shower nights', () => {
  assert.equal(meteorGap(0, 150), Infinity);
  assert.equal(meteorGap(0.2, 150), Infinity);
  assert.ok(meteorGap(1, 150) < meteorGap(0.5, 150));
  assert.ok(meteorGap(1, 224) < meteorGap(1, 150) / 5);
});
