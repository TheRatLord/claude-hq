import test from 'node:test';
import assert from 'node:assert/strict';
import { VENDORS, VENDOR_INFO, isVendor, kindOfVendor, vendorLabel, vendorOfInfo, vendorOfLabel, vendorOfProcess } from './vendors.ts';

test('vendorOfLabel: herdr ids, aliases and spellings', () => {
  const rows: [string, string | null][] = [
    ['claude', 'claude'], ['Claude-Code', 'claude'], ['codex', 'codex'], ['gemini', 'gemini'], ['opencode', 'opencode'],
    ['herdr:opencode', 'opencode'], ['open_code', 'opencode'], ['copilot', 'copilot'], ['github_copilot', 'copilot'], ['ghcs', 'copilot'],
    ['cursor', 'cursor'], ['cursor-agent', 'cursor'], ['amp', 'amp'], ['amp-local', 'amp'], ['qwen', 'qwen'], ['qwen code', 'qwen'],
    ['droid', 'droid'], ['omp', 'pi'], ['herdr:pi', 'pi'], ['agy', 'antigravity'], ['antigravity_cli', 'antigravity'],
    ['qodercli', 'qoder'], ['mastracode', 'mastra'], ['kilo-code', 'kilo'], ['aider', 'aider'], ['goose', 'goose'], ['crush', 'crush'],
    ['something-new', null], ['', null],
  ];
  for (const [l, v] of rows) assert.equal(vendorOfLabel(l), v, l);
  assert.equal(vendorOfLabel(null), null);
  // every id resolves to itself and every alias belongs to exactly one vendor
  const seen = new Map<string, string>();
  for (const v of VENDORS) {
    assert.equal(vendorOfLabel(v), v);
    for (const a of VENDOR_INFO[v].aliases ?? []) {
      assert.ok(!seen.has(a), `alias ${a} used twice`);
      seen.set(a, v);
      assert.equal(vendorOfLabel(a), v, a);
    }
  }
});

test('kindOfVendor / vendorLabel', () => {
  assert.equal(kindOfVendor('claude'), 'claude');
  assert.equal(kindOfVendor('codex'), 'codex');
  assert.equal(kindOfVendor('gemini'), 'gemini');
  for (const v of ['aider', 'goose', 'opencode', 'pi'] as const) assert.equal(kindOfVendor(v), 'agent');
  assert.equal(kindOfVendor(null), 'agent');
  assert.equal(vendorLabel('opencode'), 'OpenCode');
  assert.equal(vendorLabel('nope'), 'Agent');
  assert.equal(vendorLabel(null), 'Agent');
  assert.ok(isVendor('crush') && !isVendor('bash'));
});

test('vendorOfProcess: real command lines', () => {
  const rows: [string, string[], string | null][] = [
    // shebang python script: comm is the script name, argv[0] the interpreter
    ['aider', ['/usr/bin/python3', '/home/u/.local/bin/aider', '--model', 'sonnet'], 'aider'],
    ['python3', ['python3', '-m', 'aider', '--yes'], 'aider'],
    ['uv', ['uv', 'tool', 'run', 'aider'], 'aider'],
    ['pipx', ['pipx', 'run', 'aider-chat'], 'aider'],
    ['node', ['node', '/usr/local/bin/gemini'], 'gemini'],
    ['node', ['node', '--no-warnings=DEP0040', '/home/u/.nvm/versions/node/v22/bin/gemini', '-p', 'hi'], 'gemini'],
    ['npm exec @goo', ['npm', 'exec', '@google/gemini-cli'], 'gemini'],
    ['node', ['node', '/usr/lib/node_modules/@google/gemini-cli/dist/index.js'], 'gemini'],
    ['opencode', ['opencode'], 'opencode'],
    ['opencode', ['/home/u/.opencode/bin/opencode', 'run', 'fix it'], 'opencode'],
    ['goose', ['goose'], 'goose'],
    ['goose', ['goose', 'session', '--name', 'x'], 'goose'],
    ['goose', ['goose', 'run', '-t', 'do it'], 'goose'],
    ['goose', ['goose', 'up'], null], // pressly/goose, the migrator
    ['goose', ['goose', 'postgres', 'user=x dbname=y', 'status'], null],
    ['goose', [], null], // no argv: cannot tell
    ['cursor-agent', ['cursor-agent', '-p', 'x'], 'cursor'],
    ['node', ['node', '/home/u/.local/share/cursor-agent/versions/1/index.js'], null], // the bundle has no telling name
    ['cursor', ['cursor', '.'], null], // the IDE launcher
    ['node', ['node', '/usr/local/bin/amp'], 'amp'],
    ['amp', ['amp'], null], // a bare `amp` is too common a name
    ['node', ['node', '/usr/lib/node_modules/@sourcegraph/amp/dist/main.js'], 'amp'],
    ['crush', ['crush'], 'crush'],
    ['node', ['node', '/usr/local/bin/qwen'], 'qwen'],
    ['node', ['node', '/usr/local/bin/copilot'], 'copilot'],
    ['copilot', ['copilot'], null],
    ['droid', ['droid'], 'droid'],
    ['claude', ['claude', '--resume'], 'claude'],
    ['node', ['node', '/usr/local/bin/codex'], 'codex'],
    ['codex', ['codex'], 'codex'],
    ['env', ['env', 'OPENAI_API_KEY=x', 'aider'], 'aider'],
    // not agents
    ['vim', ['vim', 'aider.py'], null],
    ['bash', ['bash'], null],
    ['node', ['node', 'server.js'], null],
    ['npm', ['npm', 'run', 'dev'], null],
    ['python3', ['python3', 'manage.py', 'runserver'], null],
    ['less', ['less', 'crush.log'], null],
  ];
  for (const [name, argv, want] of rows) assert.equal(vendorOfProcess(name, argv), want, `${name}: ${argv.join(' ')}`);
  assert.equal(vendorOfProcess('aider', 'python3 /x/bin/aider --no-git'), 'aider', 'command-line string');
});

test('vendorOfInfo: group leader first, npx hand-over, empty', () => {
  assert.equal(vendorOfInfo(null), null);
  assert.equal(vendorOfInfo({ foreground_processes: [] }), null);
  assert.equal(vendorOfInfo({ foreground_process_group_id: 7, foreground_processes: [
    { pid: 9, name: 'rg', argv: ['rg', 'x'] }, { pid: 7, name: 'aider', argv: ['/usr/bin/python3', '/x/aider'] },
  ] }), 'aider');
  assert.equal(vendorOfInfo({ foreground_process_group_id: 5, foreground_processes: [
    { pid: 5, name: 'npm exec', argv: ['npm exec @charmland/crush'] },
  ] }), 'crush', 'single-element argv holding the whole command line');
  assert.equal(vendorOfInfo({ foreground_process_group_id: 5, foreground_processes: [{ pid: 5, name: 'bash', argv: ['bash'] }] }), null);
});
