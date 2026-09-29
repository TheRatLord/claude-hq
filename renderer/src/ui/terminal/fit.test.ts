// drawer fix r3: fullscreen asks for the whole pane when it fits; 'cropped' only when the view really hides something.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paneGridSeen, wholePaneFits } from './fit.ts';

test('wholePaneFits: the pane within the hard-floor glass grid, one cell of slack', () => {
  assert.equal(wholePaneFits({ cols: 120, rows: 40 }, { cols: 210, rows: 43 }), true);
  assert.equal(wholePaneFits({ cols: 120, rows: 43 }, { cols: 210, rows: 43 }), false);
  assert.equal(wholePaneFits({ cols: 100, rows: 50 }, { cols: 210, rows: 43 }), false);
  assert.equal(wholePaneFits(null, { cols: 210, rows: 43 }), false);
});

test('paneGridSeen: layoutRect unless the backend keeps the observe child at its own grid', () => {
  const lr = { cols: 100, rows: 50 };
  const obs = (cols: number, rows: number) => ({ cols, rows, mode: 'observe', sizer: true });
  // honoured ask: the child is what we asked for → a real crop, the pane is lr
  assert.deepEqual(paneGridSeen(lr, obs(98, 38), { cols: 98, rows: 38, at: 0 }, 5000), lr);
  // the child is larger than the ask on an axis and is not our previous ask → the backend shows the pane at its own grid
  assert.deepEqual(paneGridSeen(lr, obs(93, 43), { cols: 155, rows: 38, at: 0, prev: { cols: 98, rows: 38 } }, 100), { cols: 93, rows: 43 });
  // a respawn in flight (the child is still at the previous ask): trust lr until stale
  assert.deepEqual(paneGridSeen(lr, obs(93, 43), { cols: 98, rows: 38, at: 0, prev: { cols: 93, rows: 43 } }, 1000), lr);
  assert.deepEqual(paneGridSeen(lr, obs(93, 43), { cols: 98, rows: 38, at: 0, prev: { cols: 93, rows: 43 } }, 3000), { cols: 93, rows: 43 });
  // not the sizer / control: lr
  assert.deepEqual(paneGridSeen(lr, { ...obs(93, 43), sizer: false }, { cols: 155, rows: 38, at: 0 }, 9000), lr);
  assert.deepEqual(paneGridSeen(lr, { ...obs(93, 43), mode: 'control' }, { cols: 155, rows: 38, at: 0 }, 9000), lr);
});
