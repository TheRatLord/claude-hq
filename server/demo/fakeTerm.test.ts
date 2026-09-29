import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RealClock } from '../clock.ts';
import { FakeTerminals } from './fakeTerm.ts';
import type { PaneInfo } from './fakeTerm.ts';
import type { TerminalHandle } from '../interfaces.ts';
import { closedReasonToState } from '../interfaces.ts';

const td = new TextDecoder();
const te = new TextEncoder();
const tick = (ms = 30): Promise<void> => new Promise((r) => RealClock().setTimeout(() => r(), ms));
const describe = (id: string): PaneInfo | null => (id.startsWith('x') ? null : { kind: id === 'a' ? 'claude' : 'shell', name: 'n', cwd: '/home/demo/src/hq', title: 'Fix it' });

function collect(h: TerminalHandle): { text: string; full: boolean }[] {
  const frames: { text: string; full: boolean }[] = [];
  h.onFrame((b, full) => frames.push({ text: td.decode(b), full }));
  return frames;
}

test('first frame is full, synchronized-output wrapped; control echoes and runs commands', async () => {
  const ft = new FakeTerminals({ clock: RealClock(), describe });
  const h = ft.open('s', { mode: 'control', cols: 80, rows: 24 });
  const frames = collect(h);
  await tick();
  assert.equal(frames[0]?.full, true);
  assert.match(frames[0]?.text ?? '', /^\x1b\[\?2026h\x1b\[H\x1b\[2J.*demo@hq/s);
  assert.match(frames[0]?.text ?? '', /\x1b\[\?2026l$/);
  await h.input(te.encode('echo hi there\r'));
  await h.input(te.encode('seq 3\rnope\r'));
  const all = frames.slice(1).map((f) => f.text).join('');
  assert.ok(frames.slice(1).every((f) => !f.full));
  assert.match(all, /hi there\r\n/);
  assert.match(all, /1\r\n2\r\n3\r\n/);
  assert.match(all, /bash: nope: command not found/);
  const vis = await ft.read('s', { source: 'visible' });
  assert.match(vis.text, /\$ seq 3\n1\n2\n3\n/);
  await ft.close();
});

test('backspace, ctrl-c, escape sequences and clear', async () => {
  const ft = new FakeTerminals({ clock: RealClock(), describe });
  const h = ft.open('s', { mode: 'control', cols: 80, rows: 24 });
  await tick();
  await h.input(te.encode('ecx\x7fho ok\x1b[A\x1bOB\r'));
  let vis = await ft.read('s', { source: 'visible' });
  assert.match(vis.text, /\$ echo ok\nok\n/);
  await h.input(te.encode('abc\x03'));
  vis = await ft.read('s', { source: 'visible' });
  assert.match(vis.text, /abc\^C\n/);
  await h.input(te.encode('clear\r'));
  vis = await ft.read('s', { source: 'visible' });
  assert.equal(vis.text.trim(), 'demo@hq:~/src/hq$');
  await ft.close();
});

test('seq N produces scrollback readable via recent', async () => {
  const ft = new FakeTerminals({ clock: RealClock(), describe });
  const h = ft.open('s', { mode: 'control', cols: 80, rows: 10 });
  await tick();
  await h.input(te.encode('seq 500\r'));
  const r = await ft.read('s', { source: 'recent', lines: 100 });
  const lines = r.text.split('\n');
  assert.equal(lines.length, 100);
  assert.ok(lines.includes('450'));
  const ansi = await ft.read('s', { source: 'recent', format: 'ansi', lines: 50 });
  assert.match(ansi.text, /499/);
  await ft.close();
});

test('observe ignores input and resize; agents get the mock Claude box and a reply', async () => {
  const ft = new FakeTerminals({ clock: RealClock(), describe });
  const c = ft.open('a', { mode: 'control', cols: 70, rows: 20 });
  const o = ft.open('a', { mode: 'observe', cols: 120, rows: 40 });
  const of = collect(o);
  await tick();
  assert.equal(of[0]?.full, true);
  assert.match(of[0]?.text ?? '', /Welcome to .*Claude Code \(demo\)/);
  assert.equal(o.cols, 70);
  await o.input(te.encode('ignored\r'));
  o.resize(100, 30);
  assert.equal(ft.ptys.get('a')?.cols, 70);
  await c.input(te.encode('fix the bug\r'));
  assert.match(of.map((f) => f.text).join(''), /I would work on: fix the bug/);
  assert.doesNotMatch(of.map((f) => f.text).join(''), /ignored/);
  c.resize(90, 25);
  await tick();
  assert.equal(of.at(-1)?.full, true, 'every frame after a resize is full');
  assert.equal(o.cols, 90);
  await ft.close();
});

test('herdr close reasons: busy without takeover, taken over, detached, not found', async () => {
  const ft = new FakeTerminals({ clock: RealClock(), describe });
  const reasons: Record<string, string> = {};
  const c1 = ft.open('s', { mode: 'control', cols: 80, rows: 24 });
  c1.onClosed((i) => (reasons.c1 = i.reason));
  const c2 = ft.open('s', { mode: 'control', cols: 80, rows: 24 });
  c2.onClosed((i) => (reasons.c2 = i.reason));
  await tick();
  assert.equal(closedReasonToState(reasons.c2 ?? ''), 'busy');
  const c3 = ft.open('s', { mode: 'control', cols: 80, rows: 24, takeover: true });
  await tick();
  assert.equal(closedReasonToState(reasons.c1 ?? ''), 'taken');
  await c3.release();
  assert.equal(closedReasonToState(c3.closedWith?.reason ?? ''), 'released');
  const x = ft.open('x1', { mode: 'observe', cols: 80, rows: 24 });
  await tick();
  assert.equal(closedReasonToState(x.closedWith?.reason ?? ''), 'gone');
  const o = ft.open('s', { mode: 'observe', cols: 80, rows: 24 });
  ft.drop('s');
  assert.equal(closedReasonToState(o.closedWith?.reason ?? ''), 'gone');
  await ft.close();
});
