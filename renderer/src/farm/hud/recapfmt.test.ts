import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffHeader, fileRow, patchClass, recapWhen } from './recapfmt.ts';
import { demoRecaps } from '../model/recap.ts';
import type { DiffResult } from '../../../../shared/protocol.ts';

test('recapfmt: diff header, file rows, patch classes, the when line', () => {
  const d: DiffResult = { root: '/r', from: 'abc1234def', to: null, files: [{ path: 'src/net/store.ts', status: 'M', added: 30, removed: 10 }], added: 30, removed: 10, more: 2 };
  assert.deepEqual(diffHeader(d), { stat: '3 files · +30 −10', range: 'abc1234 → the working tree now (includes later, uncommitted changes)' });
  assert.match(diffHeader({ ...d, to: 'fff0000' }).range, /^abc1234\.\.fff0000 \(what this task committed\)$/);
  assert.deepEqual(fileRow(d.files[0], 80), { dir: 'src/net/', name: 'store.ts', counts: '+30 −10', share: 0.5, status: 'changed' });
  assert.equal(fileRow({ path: 'a.png', status: 'A', added: null, removed: null }, 1).counts, 'binary');
  assert.equal(fileRow({ path: 'n.md', status: '?', added: null, removed: null }, 1).counts, 'new');
  assert.deepEqual(['+++ b/x', '--- a/x', 'diff --git a b', '@@ -1 +1 @@', '+a', '-b', ' c', 'index 1..2'].map(patchClass), ['meta', 'meta', 'meta', 'hunk', 'add', 'del', 'ctx', 'meta']);
  const now = new Date(2026, 9, 2, 12).getTime();
  let r = demoRecaps({ id: 'x0', tag: 't', name: 'n', title: null, git: null }, now)[0];
  for (let i = 1; !r && i < 20; i++) r = demoRecaps({ id: `x${i}`, tag: 't', name: 'n', title: null, git: null }, now)[0];
  assert.ok(r);
  assert.match(recapWhen({ ...r, asks: 1, waited: 120_000 }, now, () => '5m ago'), /^Finished 5m ago · took \d+ (min|h \d\d) · waited on you 2 min \(1 ask\)$/);
});
