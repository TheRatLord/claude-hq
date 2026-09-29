import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statFactory, registeredStats } from './registry.ts';
import { layout } from '../layout/hq.ts';

test('every §7.4 stat anchor in the hq layout has a registered stats object', async () => {
  for (const m of ['bigBoard', 'ramColumn', 'rack', 'gauge', 'drawers', 'hamster', 'misc', 'net', 'weather']) await import(`./${m}.ts`);
  const missing = layout.statAnchors.filter((a) => typeof statFactory(a.id) !== 'function').map((a) => a.id);
  assert.deepEqual(missing, []);
  assert.ok(registeredStats().length >= layout.statAnchors.length);
});
