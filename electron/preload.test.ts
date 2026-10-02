import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { IPC } from '../shared/desktop.ts';
import type { DesktopBridge, ToPage } from '../shared/desktop.ts';

const SRC = fs.readFileSync(new URL('./preload.ts', import.meta.url), 'utf8');

test('preload strips to a classic script that only requires electron', () => {
  const js = stripTypeScriptTypes(SRC);
  assert.doesNotMatch(js, /^\s*(import|export)\s/m, 'a sandboxed preload cannot import');
  const required = [...new Set([...js.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '').matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]))];
  assert.deepEqual(required, ['electron']);
  for (const ch of [...SRC.matchAll(/'(valley:[\w-]+)'/g)].map((m) => m[1])) assert.ok((Object.values(IPC) as string[]).includes(ch), `${ch} is a channel in shared/desktop.ts`);
  for (const ch of Object.values(IPC)) assert.ok(SRC.includes(`'${ch}'`), `${ch} is used by the preload`);
});

test('preload exposes exactly the bridge, forwarding plain messages', async () => {
  const sent: [string, unknown][] = [];
  const invoked: [string, unknown][] = [];
  const listeners = new Map<string, Set<(e: unknown, m: unknown) => void>>();
  let exposed: { name: string; api: DesktopBridge } | null = null;
  const electron = {
    contextBridge: { exposeInMainWorld: (name: string, api: DesktopBridge) => { exposed = { name, api }; } },
    ipcRenderer: {
      send: (ch: string, m: unknown) => { sent.push([ch, m]); },
      invoke: async (ch: string, m: unknown) => { invoked.push([ch, m]); return { ok: true }; },
      on: (ch: string, fn: (e: unknown, m: unknown) => void) => { if (!listeners.has(ch)) listeners.set(ch, new Set()); listeners.get(ch)!.add(fn); },
      removeListener: (ch: string, fn: (e: unknown, m: unknown) => void) => { listeners.get(ch)?.delete(fn); },
    },
  };
  vm.runInNewContext(stripTypeScriptTypes(SRC), { require: (m: string) => { if (m !== 'electron') throw new Error(m); return electron; }, process: { platform: 'linux' } });
  assert.ok(exposed);
  const { name, api } = exposed as { name: string; api: DesktopBridge };
  assert.equal(name, 'valleyDesktop');
  assert.deepEqual(Object.keys(api).sort(), ['notify', 'onCommand', 'platform', 'prefs', 'setPrefs', 'status', 'version']);
  assert.equal(api.version, 1);
  api.status({ need: 1, done: 0, asks: [] });
  api.notify({ title: 't', body: 'b', target: { kind: 'mailbox' } });
  const plain = (v: unknown) => JSON.parse(JSON.stringify(v));   // objects built inside the vm have its prototypes
  assert.deepEqual(plain(sent), [
    [IPC.toMain, { t: 'status', status: { need: 1, done: 0, asks: [] } }],
    [IPC.toMain, { t: 'notify', title: 't', body: 'b', target: { kind: 'mailbox' } }],
  ]);
  await api.prefs(); await api.setPrefs({ pauseHidden: true });
  assert.deepEqual(plain(invoked), [[IPC.prefs, null], [IPC.prefs, { pauseHidden: true }]]);
  const got: ToPage[] = [];
  const off = api.onCommand((m) => got.push(m));
  for (const fn of listeners.get(IPC.toPage) ?? []) fn({ sender: 'secret' }, { t: 'render', mode: 'paused' });
  assert.deepEqual(plain(got), [{ t: 'render', mode: 'paused' }], 'the IPC event object never reaches the page');
  off();
  assert.equal(listeners.get(IPC.toPage)?.size, 0);
});
