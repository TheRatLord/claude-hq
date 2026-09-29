// HUD pure helpers (UI fix round 2): notice split for warn tickets, Leader chord steps in key hints.
// Owner: UI (HUD surface).
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitNotice, parseHint, THEN } from './hud.ts';

test('splitNotice: short headline + serif line, never a clamped headline', () => {
  assert.deepEqual(splitNotice('Sign-off failed: timeout'), { head: 'Sign-off failed', sub: 'timeout' });
  assert.deepEqual(splitNotice('Closing panes needs allowMutations (off in the default session).'), { head: 'Closing panes needs allowMutations', sub: 'Off in the default session' });
  assert.deepEqual(splitNotice('Copied 3 lines'), { head: 'Copied 3 lines', sub: '' });
  assert.deepEqual(splitNotice('Pane gone — closed elsewhere'), { head: 'Pane gone', sub: 'closed elsewhere' });
});

test('parseHint: "Leader L, B" is a step (L then B), not a combo; Leader shown once', () => {
  const p = parseHint('Ctrl+` U next blocked  ·  Ctrl+` L, B inbox  ·  click to open');
  assert.deepEqual(p, [{ keys: ['Leader', 'U'], label: 'next blocked' }, { keys: ['Leader', 'L', THEN, 'B'], label: 'inbox' }]);
  assert.deepEqual(parseHint('[B] inbox'), [{ keys: ['B'], label: 'inbox' }]);
});
