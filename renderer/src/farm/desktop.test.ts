import { test } from 'node:test';
import assert from 'node:assert/strict';
import { desktopStatus, installDesktop, renderInterval, BACKGROUND_MS } from './desktop.ts';
import type { DesktopBridge, DesktopStatus, ToPage } from '../../../shared/desktop.ts';
import type { ValleyState } from './model/types.ts';

const farmer = (id: string, o: Record<string, unknown>) => ({ id, name: id.toUpperCase(), needsYou: false, unseenDone: false, question: null, jobSince: 0, ...o });
const valleyOf = (fs: ReturnType<typeof farmer>[]) => ({ farmers: new Map(fs.map((f) => [f.id, f])) }) as unknown as ValleyState;

test('desktop status: asks newest first (the strip order), unseen finishes counted, first line of the question', () => {
  const s = desktopStatus(valleyOf([
    farmer('a', { needsYou: true, jobSince: 100, question: 'Allow?\nmore detail' }),
    farmer('b', { needsYou: true, jobSince: 300 }),
    farmer('c', { unseenDone: true }),
    farmer('d', { needsYou: true, unseenDone: true, jobSince: 200 }),
    farmer('e', {}),
  ]));
  assert.equal(s.need, 3);
  assert.equal(s.done, 1, 'an ask is not also counted as done');
  assert.deepEqual(s.asks.map((a) => a.id), ['b', 'd', 'a']);
  assert.equal(s.asks[2].question, 'Allow?');
});

test('render modes map to the loop: live → rAF, background → slow timer, paused → none', () => {
  assert.equal(renderInterval('live'), null);
  assert.equal(renderInterval('background'), BACKGROUND_MS);
  assert.equal(renderInterval('paused'), 0);
});

test('installDesktop: null in a browser; routes shell commands; sends status only on change', () => {
  const calls: string[] = [];
  const deps = (v: ValleyState) => ({
    valley: () => v,
    openTerminal: (id: string) => calls.push(`term:${id}`),
    openNeeds: () => calls.push('needs'),
    setBackground: (ms: number | null) => calls.push(`bg:${ms}`),
  });
  assert.equal(installDesktop(deps(valleyOf([])), null), null);
  const sent: DesktopStatus[] = [];
  let cmd: ((m: ToPage) => void) | null = null;
  const bridge: DesktopBridge = {
    version: 1, platform: 'linux',
    status: (s) => sent.push(s), notify: () => {},
    prefs: async () => { throw new Error('unused'); }, setPrefs: async () => { throw new Error('unused'); },
    onCommand: (fn) => { cmd = fn; return () => { cmd = null; }; },
  };
  const v = valleyOf([farmer('a', { needsYou: true, jobSince: 1 })]);
  const link = installDesktop(deps(v), bridge)!;
  try {
    assert.equal(sent.length, 1);
    assert.equal(sent[0].need, 1);
    cmd!({ t: 'render', mode: 'background' });
    cmd!({ t: 'render', mode: 'live' });
    assert.equal(link.mode(), 'live');
    cmd!({ t: 'open', target: { kind: 'terminal', id: 'a' } });
    cmd!({ t: 'open', target: { kind: 'terminal', id: 'gone' } });
    cmd!({ t: 'open', target: { kind: 'mailbox' } });
    cmd!({ t: 'summoned', need: 0 });   // the page's own count still has an ask
    assert.deepEqual(calls, [`bg:${BACKGROUND_MS}`, 'bg:null', 'term:a', 'needs', 'needs', 'needs']);
  } finally { link.dispose(); }
  assert.equal(cmd, null, 'dispose unsubscribes');
  const quiet = installDesktop(deps(valleyOf([farmer('z', {})])), bridge)!;
  calls.length = 0;
  cmd!({ t: 'summoned', need: 0 });
  assert.deepEqual(calls, [], 'nothing pending: summoning just shows the valley');
  quiet.dispose();
});
