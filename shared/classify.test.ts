import test from 'node:test';
import assert from 'node:assert/strict';
import { toolClass, bashCategory, processActivity, processFromInfo, isGitCommit } from './classify.ts';
import { TOOL_CLASSES, SHELL_ACTIVITIES } from './protocol.ts';
import type { ShellActivity } from './protocol.ts';

test('toolClass: table', () => {
  const rows = [
    ['Edit', 'edit'], ['MultiEdit', 'edit'], ['NotebookEdit', 'edit'], ['Write', 'write'], ['Read', 'read'],
    ['Grep', 'search'], ['Glob', 'search'], ['LS', 'search'], ['WebSearch', 'web'], ['WebFetch', 'web'],
    ['Agent', 'task'], ['Task', 'task'], ['Workflow', 'task'], ['TodoWrite', 'todo'], ['AskUserQuestion', 'ask'],
    ['mcp__playwright__browser_click', 'mcp'], ['Skill', 'other'], [null, 'other'], ['SomethingNew', 'other'],
  ];
  for (const [name, cls] of rows) assert.equal(toolClass(name, {}), cls, String(name));
  assert.equal(toolClass('Bash', { command: 'npm test' }), 'test');
  assert.equal(toolClass('Bash', {}), 'bash');
  for (const [n] of rows) assert.ok(TOOL_CLASSES.includes(toolClass(n, {})));
});

test('bashCategory: real commands', () => {
  const rows = [
    ['npm test', 'test'], ['npm run test -- server/ws.test.ts', 'test'], ['cd /home/x/claude-hq && npm test 2>&1 | tail -20', 'test'],
    ['node --test server/', 'test'], ['npx vitest run', 'test'], ['pytest -q tests/', 'test'], ['python -m pytest -x', 'test'],
    ['cargo test --release', 'test'], ['go test ./...', 'test'], ['jest --watch=false', 'test'], ['make test', 'test'],
    ['timeout 60 node --test "**/*.test.js"', 'test'], ['CI=1 yarn test', 'test'], ['./run-tests.sh', 'test'],
    ['npm run build', 'build'], ['vite build', 'build'], ['make -j8', 'build'], ['cargo build', 'build'], ['npx tsc --noEmit', 'build'],
    ['cmake -B build', 'build'], ['docker build -t x .', 'build'],
    ['git status', 'git'], ['git add -A && git commit -m "x"', 'git'], ['gh pr create --fill', 'git'],
    ['curl -s http://127.0.0.1:7462/healthz', 'net'], ['wget https://x', 'net'], ['ssh box uptime', 'net'], ['npm i ws', 'net'],
    ['pip install requests', 'net'],
    ['ls -la', 'bash'], ['grep -rn foo src', 'bash'], ['test -f x && echo y', 'bash'], ['cat package.json | jq .scripts', 'bash'],
    ['', 'bash'], ['sed -n 1,20p "a && npm test"', 'bash'],
  ];
  for (const [cmd, cat] of rows) assert.equal(bashCategory(cmd), cat, cmd);
});

test('isGitCommit', () => {
  assert.ok(isGitCommit('git commit -m "fix"'));
  assert.ok(isGitCommit('git add . && git commit -am wip && git push'));
  assert.ok(isGitCommit('git -C /x push origin main'));
  assert.ok(!isGitCommit('git status'));
  assert.ok(!isGitCommit('echo "git commit"'));
});

test('processActivity: table', () => {
  const rows: [[string, string[]], ShellActivity][] = [
    [['bash', ['/bin/bash']], 'prompt'], [['zsh', ['-zsh']], 'prompt'], [['fish', ['fish']], 'prompt'],
    [['nvim', ['nvim', 'foo.js']], 'edit'], [['vim', ['vim']], 'edit'], [['hx', ['hx', '.']], 'edit'],
    [['top', ['top', '-d', '3']], 'monitor'], [['watch', ['watch', '-n', '2', 'uptime']], 'monitor'], [['btop', ['btop']], 'monitor'],
    [['tail', ['tail', '-f', '/var/log/x']], 'monitor'],
    [['python3', ['python3', '-m', 'http.server', '0', '--bind', '127.0.0.1']], 'serve'],
    [['node', ['node', 'node_modules/.bin/vite', '--port', '7461']], 'serve'], [['npm', ['npm', 'run', 'dev']], 'serve'],
    [['docker', ['docker', 'compose', 'up']], 'serve'], [['caddy', ['caddy', 'run']], 'serve'],
    [['ssh', ['ssh', 'box']], 'remote'], [['mosh-client', ['mosh-client', '-#', 'box']], 'remote'],
    [['python3', ['python3']], 'repl'], [['node', ['node']], 'repl'], [['ipython', ['ipython']], 'repl'],
    [['git', ['git', 'log', '-p']], 'git'], [['lazygit', ['lazygit']], 'git'],
    [['npm', ['npm', 'test']], 'test'], [['pytest', ['pytest', '-x']], 'test'],
    [['make', ['make', '-j8']], 'build'], [['cargo', ['cargo', 'build']], 'build'],
    [['sleep', ['sleep', '5']], 'run'], [['python3', ['python3', 'train.py']], 'run'], [['claude', ['claude']], 'run'],
    [['bash', ['bash', 'loop.sh']], 'run'],
  ];
  for (const [[name, argv], act] of rows) {
    assert.equal(processActivity(name, argv), act, `${argv.join(' ')}`);
    assert.ok(SHELL_ACTIVITIES.includes(act));
  }
  assert.equal(processActivity({ name: 'top', argv: 'top -d 3' }), 'monitor');
});

test('processFromInfo: real herdr pane.process_info shapes (hqtest)', () => {
  const idle = { shell_pid: 1, foreground_process_group_id: 1, foreground_processes: [{ pid: 1, name: 'bash', argv: ['/bin/bash'], cmdline: '/bin/bash' }] };
  assert.deepEqual(processFromInfo(idle), { name: 'bash', argv: 'bash', activity: 'prompt' });
  const top = { shell_pid: 1, foreground_process_group_id: 5, foreground_processes: [{ pid: 5, name: 'top', argv: ['top', '-d', '3'], cmdline: 'top -d 3' }] };
  assert.deepEqual(processFromInfo(top), { name: 'top', argv: 'top -d 3', activity: 'monitor' });
  const claude = { shell_pid: 1, foreground_process_group_id: 7, foreground_processes: [
    { pid: 7, name: 'claude', argv: ['claude'], cmdline: 'claude' },
    { pid: 8, name: 'npm exec @playw', argv: ['npm exec @playwright/mcp@latest'], cmdline: 'npm exec @playwright/mcp@latest' },
    { pid: 9, name: 'MainThread', argv: ['node', '/x/cli.js'], cmdline: 'node /x/cli.js' }] };
  assert.equal(processFromInfo(claude)?.name, 'claude');
  assert.equal(processFromInfo(null), null);
  assert.equal(processFromInfo({ foreground_processes: [] }), null);
});
