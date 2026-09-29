// Electron reach logic (M3.5): blocked count + "became blocked" from model messages, texts, hotkey parsing, tray icon.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { BlockedTracker, modelFeed, trayText, notifyText, parseHotkey, trayBitmap, DEFAULT_HOTKEY } from './reach.ts';
import type { BlockedChange, ReachEntity } from './reach.ts';
import type { ServerMsg } from '../shared/protocol.ts';

const ent = (id: string, status: NonNullable<ReachEntity['status']>, extra: Partial<ReachEntity> = {}): ReachEntity => ({ id, name: id.replace(/:.*/, ''), status, ...extra });

test('BlockedTracker: first world seeds silently; entity/gone/rekey update the count and report only NEW blocks', () => {
  const t = new BlockedTracker();
  const ev: BlockedChange[] = [];
  t.on('change', (c: BlockedChange) => ev.push(c));
  t.onMsg({ t: 'world', entities: [ent('scout:1', 'blocked', { prompt: { question: 'Trust?' } }), ent('tinker:2', 'idle')] });
  assert.deepEqual(ev.at(-1), { count: 1, became: [] });
  assert.equal(t.list()[0].question, 'Trust?');
  t.onMsg({ t: 'entity', entity: ent('tinker:2', 'blocked') });
  assert.deepEqual(ev.at(-1), { count: 2, became: ['tinker:2'] });
  const n = ev.length;
  t.onMsg({ t: 'entity', entity: ent('tinker:2', 'blocked', { prompt: { question: 'again' } }) });
  assert.equal(ev.length, n, 'still blocked → no change');
  t.onMsg({ t: 'entity', entity: ent('scout:1', 'working') });
  assert.deepEqual(ev.at(-1), { count: 1, became: [] });
  t.onMsg({ t: 'gone', id: 'tinker:2', reason: 'rekeyed', newId: 'tinker:9' });
  assert.equal(ev.at(-1)?.count, 0);
  t.onMsg({ t: 'entity', entity: ent('tinker:9', 'blocked') });
  assert.deepEqual(ev.at(-1), { count: 1, became: [] }, 'a re-keyed blocked pane is not a new block');
  const herdr: ServerMsg = { t: 'herdr', connected: true };
  t.onMsg(herdr); // any other ServerMsg is ignored
  t.onMsg({ t: 'world', entities: [ent('tinker:9', 'blocked'), ent('new:3', 'blocked')] });
  assert.deepEqual(ev.at(-1), { count: 2, became: ['new:3'] });
});

test('modelFeed reads the WorldModel (worldMsg + msg events), close() detaches', () => {
  const model = Object.assign(new EventEmitter(), { worldMsg: () => ({ t: 'world' as const, entities: [ent('a:1', 'blocked')] }) });
  const f = modelFeed(model);
  assert.equal(f.tracker.count, 1);
  model.emit('msg', { t: 'entity', entity: ent('b:1', 'blocked') });
  assert.equal(f.tracker.count, 2);
  f.close();
  model.emit('msg', { t: 'gone', id: 'a:1' });
  assert.equal(f.tracker.count, 2);
});

test('texts: tray tooltip/title, notification + deep link', () => {
  assert.deepEqual(trayText(0, 'default'), { tooltip: 'Claude HQ — nobody blocked', title: '' });
  assert.deepEqual(trayText(3, 'hqtest'), { tooltip: 'Claude HQ · hqtest — 3 blocked (needs you)', title: '3' });
  assert.deepEqual(notifyText([{ name: 'tinker', question: 'Trust this folder?' }]), { title: 'tinker is blocked', body: 'Trust this folder?', link: 'inbox:tinker' });
  assert.deepEqual(notifyText([{ name: 'a', question: null }, { name: 'b', question: null }]), { title: '2 agents are blocked', body: 'a, b', link: 'inbox' });
});

test('parseHotkey: default, custom, off, junk → default', () => {
  assert.equal(parseHotkey({}), DEFAULT_HOTKEY);
  assert.equal(parseHotkey({ electron: { hotkey: 'Super+Shift+J' } }), 'Super+Shift+J');
  assert.equal(parseHotkey({ electron: { hotkey: 'CommandOrControl + Alt + F9' } }), 'CommandOrControl+Alt+F9');
  for (const v of [false, '', 'off', null]) assert.equal(parseHotkey({ electron: { hotkey: v } }), null);
  assert.equal(parseHotkey({ electron: { hotkey: 'Ctrl+<script>' } }), DEFAULT_HOTKEY);
});

test('trayBitmap: 32×32 BGRA, transparent corners, red dot only when alerting', () => {
  const quiet = trayBitmap(false), loud = trayBitmap(true);
  assert.equal(quiet.length, 32 * 32 * 4);
  assert.equal(quiet[3], 0, 'corner transparent');
  const px = (b: Buffer, x: number, y: number) => [...b.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4)];
  assert.deepEqual(px(loud, 25, 7), [62, 62, 226, 255]);
  assert.notDeepEqual(px(quiet, 25, 7), [62, 62, 226, 255]);
});
