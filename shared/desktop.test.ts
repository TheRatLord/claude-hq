import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acceleratorFromKey, acceleratorLabel, badgeText, DESKTOP_DEFAULTS, isAccelerator, MAX_ASKS, sanitizeDesktopPrefs, sanitizeStatus, sanitizeTarget, sanitizeToMain,
} from './desktop.ts';

test('badge text: counts, 9+, a dot for unseen finishes only, empty when quiet', () => {
  assert.equal(badgeText(0, 0), '');
  assert.equal(badgeText(0, 3), '•');
  assert.equal(badgeText(1, 3), '1');
  assert.equal(badgeText(9, 0), '9');
  assert.equal(badgeText(10, 0), '9+');
  assert.equal(badgeText(250, 1), '9+');
});

test('status from the page is sanitized: bad ids dropped, strings clipped, need ≥ listed asks, at most MAX_ASKS', () => {
  assert.deepEqual(sanitizeStatus(null), { need: 0, done: 0, asks: [] });
  assert.deepEqual(sanitizeStatus({ need: -3, done: 'x', asks: 'nope' }), { need: 0, done: 0, asks: [] });
  const s = sanitizeStatus({
    need: 1, done: 2.7,
    asks: [{ id: 'd1', name: 'Ada', question: 'Allow\nwrite?' }, { id: 'bad id with spaces', name: 'x' }, { id: 'p:2', name: '', question: 'q'.repeat(500) }, 7],
  });
  assert.equal(s.need, 2, 'need is at least the asks listed');
  assert.equal(s.done, 2);
  assert.deepEqual(s.asks.map((a) => a.id), ['d1', 'p:2']);
  assert.equal(s.asks[0].question, 'Allow write?');
  assert.equal(s.asks[1].name, 'p:2', 'a nameless ask falls back to its id');
  assert.equal(s.asks[1].question.length, 120);
  const many = sanitizeStatus({ need: 30, asks: Array.from({ length: 30 }, (_, i) => ({ id: `f${i}`, name: `F${i}` })) });
  assert.equal(many.asks.length, MAX_ASKS);
  assert.equal(many.need, 30);
});

test('messages and targets: unknown kinds rejected, targets default to the mailbox', () => {
  assert.equal(sanitizeToMain({ t: 'eval', code: 'x' }), null);
  assert.equal(sanitizeToMain('status'), null);
  assert.equal(sanitizeToMain({ t: 'notify', title: '' }), null, 'a notification needs a title');
  assert.deepEqual(sanitizeToMain({ t: 'notify', title: 'Ada needs you', body: 'b', target: { kind: 'terminal', id: 'd1' } }),
    { t: 'notify', title: 'Ada needs you', body: 'b', target: { kind: 'terminal', id: 'd1' } });
  assert.deepEqual(sanitizeTarget({ kind: 'terminal', id: '../../etc' + ' x' }), { kind: 'mailbox' });
  assert.deepEqual(sanitizeTarget({ kind: 'shell' }), { kind: 'mailbox' });
});

test('desktop prefs: known keys of the right type only, invalid hotkeys keep the old one', () => {
  assert.deepEqual(sanitizeDesktopPrefs(null), DESKTOP_DEFAULTS);
  assert.deepEqual(sanitizeDesktopPrefs('garbage'), DESKTOP_DEFAULTS);
  const p = sanitizeDesktopPrefs({ minimizeToTray: true, closeToTray: 'yes', hotkey: 'V', bogus: 1 });
  assert.equal(p.minimizeToTray, true);
  assert.equal(p.closeToTray, false);
  assert.equal(p.hotkey, DESKTOP_DEFAULTS.hotkey, 'a bare key would steal typing everywhere');
  assert.equal(sanitizeDesktopPrefs({ hotkey: '' }).hotkey, '', 'empty = no hotkey');
  assert.equal(sanitizeDesktopPrefs({ hotkey: 'Ctrl+Shift+F9' }).hotkey, 'Ctrl+Shift+F9');
  assert.ok(!('bogus' in p));
});

test('accelerators: a non-Shift modifier and one key; function keys may stand alone', () => {
  for (const ok of ['CommandOrControl+Alt+V', 'Ctrl+Alt+V', 'Alt+Space', 'Super+1', 'F9', 'Shift+F2', 'CmdOrCtrl+Shift+`', 'Ctrl+Plus', 'Ctrl++']) assert.ok(isAccelerator(ok), ok);
  for (const bad of ['', 'V', 'Shift+V', 'Ctrl+Ctrl+V', 'Ctrl+Alt', 'Ctrl+Alt+VV', 'Hyper+V', 'Ctrl+Alt+é']) assert.ok(!isAccelerator(bad), bad);
});

test('acceleratorFromKey: codes → accelerators per platform, modifier-only presses → null', () => {
  const k = (o: Partial<{ code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }>) => ({ code: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...o });
  assert.equal(acceleratorFromKey(k({ code: 'KeyV', ctrlKey: true, altKey: true }), 'linux'), 'CommandOrControl+Alt+V');
  assert.equal(acceleratorFromKey(k({ code: 'KeyV', metaKey: true, altKey: true }), 'darwin'), 'CommandOrControl+Alt+V');
  assert.equal(acceleratorFromKey(k({ code: 'KeyV', metaKey: true }), 'linux'), 'Super+V');
  assert.equal(acceleratorFromKey(k({ code: 'Digit3', ctrlKey: true, shiftKey: true }), 'win32'), 'CommandOrControl+Shift+3');
  assert.equal(acceleratorFromKey(k({ code: 'F8' }), 'linux'), 'F8');
  assert.equal(acceleratorFromKey(k({ code: 'Backquote', altKey: true }), 'linux'), 'Alt+`');
  assert.equal(acceleratorFromKey(k({ code: 'KeyV' }), 'linux'), null, 'no modifier');
  assert.equal(acceleratorFromKey(k({ code: 'KeyV', shiftKey: true }), 'linux'), null, 'Shift alone');
  assert.equal(acceleratorFromKey(k({ code: 'ControlLeft', ctrlKey: true }), 'linux'), null, 'only a modifier so far');
  assert.equal(acceleratorLabel('CommandOrControl+Alt+V', 'linux'), 'Ctrl+Alt+V');
  assert.equal(acceleratorLabel('CommandOrControl+Alt+V', 'darwin'), '⌘⌥V');
  assert.equal(acceleratorLabel('', 'linux'), 'none');
});
