import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autostartEntry, DEFAULT_SIZE, loginArgs, MIN_H, MIN_W, renderMode, restoreWindowState, trayKey, trayMenu, trayTooltip } from './model.ts';
import type { TrayItem } from './model.ts';

const quiet = { need: 0, done: 0, asks: [] };
const busy = {
  need: 12, done: 2,
  asks: [{ id: 'd1', name: 'Ada', question: 'Allow write to src/a & b.ts?' }, { id: 'd2', name: 'Bo', question: '' }],
};
const labels = (m: TrayItem[]) => m.map((i) => i.type === 'sep' ? '—' : i.label);

test('tray menu: who needs you (click → their ask), the mailbox, show / pause / quit', () => {
  const m = trayMenu(busy, { paused: false, visible: true });
  assert.deepEqual(labels(m), [
    '12 farmers need you', 'Ada: Allow write to src/a && b.ts?', 'Bo', '…and 10 more', 'Open the mailbox (Needs you)',
    '2 finished, not yet seen', '—', 'Hide valley', 'Pause rendering', '—', 'Quit Claude Valley',
  ]);
  const ask = m[1];
  assert.ok(ask.type === 'item' && ask.action.kind === 'ask' && ask.action.id === 'd1');
  const more = m[3];
  assert.ok(more.type === 'item' && more.action.kind === 'mailbox');
  const pause = m.find((i) => i.type === 'check');
  assert.ok(pause && pause.type === 'check' && pause.checked === false);
  const q = trayMenu(quiet, { paused: true, visible: false });
  assert.deepEqual(labels(q), ['Nobody needs you right now', '—', 'Show valley', 'Pause rendering', '—', 'Quit Claude Valley']);
  assert.ok(q.some((i) => i.type === 'check' && i.checked));
  const long = trayMenu({ need: 1, done: 0, asks: [{ id: 'x', name: 'Cy', question: 'q'.repeat(200) }] }, { paused: false, visible: true });
  assert.ok((long[1] as { label: string }).label.length <= 60);
});

test('tray tooltip and change key', () => {
  assert.equal(trayTooltip(quiet, false), 'Claude Valley · all quiet');
  assert.equal(trayTooltip(busy, true), 'Claude Valley · 12 need you · 2 finished · paused');
  assert.equal(trayTooltip({ need: 1, done: 0, asks: [] }, false), 'Claude Valley · 1 needs you');
  const v = { paused: false, visible: true };
  assert.equal(trayKey(busy, v), trayKey(structuredClone(busy), v));
  assert.notEqual(trayKey(busy, v), trayKey(busy, { ...v, paused: true }));
  assert.notEqual(trayKey(busy, v), trayKey({ ...busy, done: 3 }, v));
});

test('render mode: tray pause wins, hidden / minimized → background or paused, else live', () => {
  const vis = { visible: true, minimized: false }, hid = { visible: false, minimized: false }, min = { visible: true, minimized: true };
  assert.equal(renderMode(vis, { paused: false, pauseHidden: false }), 'live');
  assert.equal(renderMode(vis, { paused: true, pauseHidden: false }), 'paused');
  assert.equal(renderMode(hid, { paused: false, pauseHidden: false }), 'background');
  assert.equal(renderMode(min, { paused: false, pauseHidden: false }), 'background');
  assert.equal(renderMode(min, { paused: false, pauseHidden: true }), 'paused');
});

test('window state: garbage → defaults centred; saved bounds kept on screen; off-screen windows come back', () => {
  const primary = { x: 0, y: 0, width: 1920, height: 1080 };
  const right = { x: 1920, y: 0, width: 2560, height: 1440 };
  const d = restoreWindowState(null, [primary]);
  assert.deepEqual(d, { bounds: { x: 160, y: 60, width: DEFAULT_SIZE.width, height: DEFAULT_SIZE.height }, maximized: false, fullscreen: false });
  assert.deepEqual(restoreWindowState('junk', []).bounds.width, DEFAULT_SIZE.width);
  const s = restoreWindowState({ bounds: { x: 2000, y: 100, width: 1200, height: 800 }, maximized: true, fullscreen: 'yes' }, [primary, right]);
  assert.deepEqual(s, { bounds: { x: 2000, y: 100, width: 1200, height: 800 }, maximized: true, fullscreen: false });
  // the second monitor was unplugged: back to the primary, centred
  const gone = restoreWindowState({ bounds: { x: 2000, y: 100, width: 1200, height: 800 } }, [primary]);
  assert.deepEqual(gone.bounds, { x: 360, y: 140, width: 1200, height: 800 });
  // title bar above the screen: unreachable, recentred
  assert.equal(restoreWindowState({ bounds: { x: 100, y: -500, width: 1200, height: 1000 } }, [primary]).bounds.y, 40);
  // tiny / huge / NaN sizes clamp
  const tiny = restoreWindowState({ bounds: { x: 0, y: 0, width: 10, height: NaN } }, [primary]);
  assert.equal(tiny.bounds.width, MIN_W);
  assert.equal(tiny.bounds.height, DEFAULT_SIZE.height);
  assert.equal(restoreWindowState({ bounds: { x: 0, y: 0, width: 99999, height: 99999 } }, [primary]).bounds.width, 1920);
  assert.ok(restoreWindowState({ bounds: { width: 1, height: 1 } }, [primary]).bounds.height >= MIN_H);
});

test('start at login: XDG entry quoting and the relaunch arguments', () => {
  const e = autostartEntry(['/opt/my apps/electron', '/home/me/claude-hq/electron/main.ts', '--tray']);
  assert.match(e, /^\[Desktop Entry\]\n/);
  assert.match(e, /\nExec="\/opt\/my apps\/electron" \/home\/me\/claude-hq\/electron\/main.ts --tray\n/);
  assert.match(e, /\nName=Claude Valley\n/);
  assert.deepEqual(loginArgs(['--demo', '--session', 'work', '--url', 'http://x', '--port', '9000', '--no-sandbox', '--session']), ['--session', 'work', '--port', '9000', '--no-sandbox', '--tray']);
});
