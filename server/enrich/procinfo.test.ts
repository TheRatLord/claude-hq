import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ProcInfoEnricher, shellNews } from './procinfo.ts';
import { FakeClock } from '../clock.ts';
import { assertEnricher } from '../interfaces.ts';
import type { Entity } from '../../shared/protocol.ts';

const info = (argv: string[]) => ({ type: 'pane_process_info', process_info: { pane_id: 'x', shell_pid: 1, foreground_process_group_id: 2,
  foreground_processes: [{ pid: 2, name: argv[0], argv, cmdline: argv.join(' ') }] } });

test('procinfo: shell 2.5 s / agent 10 s polls, classify, commit event for shells, detach stops', async () => {
  const clock = new FakeClock();
  const procs: Record<string, string[]> = { 'w1:p1': ['bash'], 'w1:p2': ['claude'] };
  const calls: unknown[] = [];
  const source = Object.assign(new EventEmitter(), { connected: true,
    request: async (m: string, p: Record<string, unknown> = {}) => (m === 'pane.read' ? { read: { text: '$ ' } } : (calls.push(p.pane_id), info(procs[String(p.pane_id)] ?? []))) });
  const e = new ProcInfoEnricher({ source, clock });
  assertEnricher(e);
  const patches: ({ id: string } & Partial<Entity>)[] = [], events: { id: string; kind: string }[] = [];
  e.onPatch = (id, p) => void patches.push({ id, ...p });
  e.emitEvent = (id, kind) => void events.push({ id, kind });
  const tick = async (ms: number): Promise<void> => {
    for (let t = 0; t <= ms; t += 500) {
      clock.advance(t === 0 ? 0 : 500);
      for (let i = 0; i < 5; i++) await null;
    }
  };
  e.attach('w1:p1', { kind: 'shell' });
  e.attach('w1:p2', { kind: 'claude' });
  await tick(0);
  assert.deepEqual(patches.find((p) => p.id === 'w1:p1')?.process, { name: 'bash', argv: 'bash', activity: 'prompt' });
  assert.equal(patches.find((p) => p.id === 'w1:p2')?.process?.name, 'claude');
  calls.length = 0;
  await tick(10_000);
  assert.equal(calls.filter((c) => c === 'w1:p1').length, 4);
  assert.equal(calls.filter((c) => c === 'w1:p2').length, 1);
  procs['w1:p1'] = ['git', 'commit', '-m', 'x'];
  procs['w1:p2'] = ['git', 'commit', '-m', 'x'];
  await tick(10_000);
  assert.equal(patches.filter((p) => p.id === 'w1:p1').at(-1)?.process?.activity, 'git');
  assert.deepEqual(events, [{ id: 'w1:p1', kind: 'commit' }], 'shells only, once per command');
  e.detach('w1:p1');
  e.detach('w1:p2');
  assert.equal(clock.pending, 0);
});

test('shellNews: settled new lines after the anchor; the prompt line and redraws never count', () => {
  const a = ['$ npm test', '> test', '> node --test', '$ '];
  assert.equal(shellNews(null, a), 0, 'first read is the baseline');
  assert.equal(shellNews(a, a), 0);
  assert.equal(shellNews(a, [...a.slice(0, -1), '$ ls -la'], ), 0, 'typing on the prompt line');
  assert.equal(shellNews(a, [...a.slice(0, -1), '# pass 12', '# fail 0', '', '$ ']), 2, 'two new settled lines; blanks never count');
  assert.equal(shellNews(['$ '], ['$ tail log', 'GET / 200', 'GET /a 200', '$ ']), 3);
  assert.equal(shellNews(a, ['totally', 'different', 'screen', '$ ']), 3, 'no anchor → the whole settled tail');
});

test('procinfo: shells emit news {src:shell, lines} for new output; full-screen apps and agents never do', async () => {
  const clock = new FakeClock();
  let text = 'demo$ ';
  let argv = ['bash'];
  const source = Object.assign(new EventEmitter(), { connected: true,
    request: async (m: string) => (m === 'pane.read' ? { read: { text } } : info(argv)) });
  const e = new ProcInfoEnricher({ source, clock });
  const events: { id: string; kind: string; detail?: unknown }[] = [];
  e.onPatch = () => {};
  e.emitEvent = (id, kind, detail) => void events.push({ id, kind, detail });
  const tick = async (ms: number): Promise<void> => {
    clock.advance(ms);
    for (let i = 0; i < 10; i++) await null;
  };
  e.attach('s', { kind: 'shell' });
  e.attach('a', { kind: 'claude' });
  await tick(0);
  argv = ['npm', 'test'];
  text = 'demo$ npm test\n> test\n✔ one\n✔ two\n';
  await tick(2500);
  text = 'demo$ npm test\n> test\n✔ one\n✔ two\n✔ three\n';
  await tick(2500);
  assert.deepEqual([...events], [], 'output while the command runs accumulates (M3.5: news once the prompt returns)');
  argv = ['bash'];
  text = 'demo$ npm test\n> test\n✔ one\n✔ two\n✔ three\n# pass 3\ndemo$ ';
  await tick(2500);
  assert.deepEqual([...events], [{ id: 's', kind: 'news', detail: { src: 'shell', lines: 6 } }], 'one news for the whole command (echo + 5 output lines)');
  await tick(2500);
  assert.equal(events.length, 1, 'no change → no news');
  text += 'ls\na.txt\ndemo$ ';
  await tick(2500);
  assert.deepEqual(events[1]?.detail, { src: 'shell', lines: 2 }, 'a quick command between polls: news at the prompt');
  argv = ['htop'];
  text = 'CPU 12%\nMEM 40%\n';
  await tick(2500);
  text = 'CPU 50%\nMEM 41%\n';
  await tick(2500);
  assert.equal(events.length, 2, 'monitor redraws are not news');
  e.detach('s');
  e.detach('a');
});
