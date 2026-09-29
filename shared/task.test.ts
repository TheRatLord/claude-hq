import test from 'node:test';
import assert from 'node:assert/strict';
import { taskLabel, fitLabel, TASK_MAX_CHARS } from './task.ts';
import type { Entity } from './protocol.ts';

const cases: [Partial<Entity> | null, string | null][] = [
  // [entity, expected]
  [{ title: 'Route stops display' }, 'Route stops display'],
  [{ title: '✳ Claude Code' }, null],
  [{ title: '✳ Fix flaky websocket reconnect tests in the hub module' }, 'Fix flaky websocket'],
  [{ title: 'Claude Code — Add dark mode toggle' }, 'Add dark mode toggle'],
  [{ title: '⠐ Refactor terminal hub' }, 'Refactor terminal hub'],
  [{ title: 'zsh', lastPrompt: 'add tests for the parser' }, 'Add tests for the parser'],
  [{ lastPrompt: 'can you please fix the login bug in auth.js, and then run the tests' }, 'Fix the login bug in auth.js'],
  [{ lastPrompt: 'ok so I want you to refactor the renderer store so that it applies messages eagerly' }, 'Refactor the renderer store'],
  [{ lastPrompt: 'Please add a --timescale flag to the server. It should be demo-only.' }, 'Add a --timescale flag'],
  [{ lastPrompt: "let's migrate the stats sampler to statfs" }, 'Migrate the stats sampler to'.replace(/ to$/, '')],
  [{ lastPrompt: 'look at https://example.com/a/b and summarize it' }, 'Look at example.com'],
  [{ lastPrompt: '/clear' }, null],
  [{ lastPrompt: '   ' }, null],
  [{ kind: 'shell', process: { name: 'vim', argv: 'vim src/foo.js', activity: 'edit' } }, 'vim foo.js'],
  [{ kind: 'shell', process: { name: 'python3', argv: '/usr/bin/python3 -m http.server 8000', activity: 'serve' } }, 'python3 http.server'],
  [{ kind: 'shell', process: { name: 'zsh', argv: 'zsh', activity: 'prompt' } }, null],
  [{ kind: 'shell', process: { name: 'npm', argv: 'NODE_ENV=test npm test', activity: 'test' } }, 'npm test'],
  [{ kind: 'shell', process: { name: 'htop', argv: 'htop', activity: 'monitor' } }, 'htop'],
  [{ kind: 'claude', process: { name: 'node', argv: 'node server.js', activity: 'run' } }, null],
  [{ kind: 'shell', process: null }, null],
  [null, null],
  // D2: baseTitle (herdr terminal title) fallback
  [{ kind: 'codex', title: null, baseTitle: 'Review protocol codec', lastPrompt: 'hi there' }, 'Review protocol codec'],
  [{ kind: 'claude', title: null, baseTitle: 'Claude Code', lastPrompt: 'fix the reaper' }, 'Fix the reaper'],
  [{ kind: 'shell', baseTitle: 'david@box: ~/claude-hq', process: { name: 'zsh', argv: 'zsh', activity: 'prompt' } }, null],
  [{ kind: 'shell', baseTitle: '~/claude-hq', process: null }, null],
  [{ kind: 'shell', baseTitle: 'deploy staging', process: { name: 'zsh', argv: 'zsh', activity: 'prompt' } }, 'deploy staging'],
  [{ kind: 'shell', baseTitle: 'deploy staging', process: { name: 'htop', argv: 'htop', activity: 'monitor' } }, 'htop'],
];

test('taskLabel on real-world titles / prompts / argv', () => {
  for (const [e, want] of cases) assert.equal(taskLabel(e), want, JSON.stringify(e));
});

test('labels are ≤ 28 chars and ≤ 6 words', () => {
  const long = { lastPrompt: 'implement the whole three dimensional office including every zone and all characters' };
  const l = taskLabel(long);
  assert.ok(l);
  assert.ok(l.length <= TASK_MAX_CHARS, l);
  assert.ok(l.split(' ').length <= 6);
  assert.equal(fitLabel('Supercalifragilisticexpialidocious-refactoring'), 'Supercalifragilisticexpiali…');
  assert.equal(fitLabel('Fix the bug in the'), 'Fix the bug');
});
