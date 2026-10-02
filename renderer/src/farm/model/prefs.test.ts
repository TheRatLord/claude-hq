import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIONS, DEFAULT_KEYS, DEFAULT_PREFS, IDLE_FPS, NEAR_M, STATUS_GLYPH, STATUS_PALETTE, STATUS_SHAPE, captionFor, clockText, effectiveFpsCap,
  keyConflict, keyLabel, nameplateShown, rebind, reducedMotion, sanitizeKeys, sanitizePrefs, statusColor, uiZoom,
} from './prefs.ts';
import { STATUSES } from '../../../../shared/protocol.ts';

test('prefs: defaults keep the original behaviour (E / F / M / Tab / J, fov 62, bob on, 1x everything)', () => {
  assert.deepEqual(DEFAULT_KEYS, { use: 'KeyE', alt: 'KeyF', map: 'KeyM', ledger: 'Tab', mail: 'KeyJ', wave: 'KeyZ', lantern: 'KeyT' });
  assert.equal(DEFAULT_PREFS.fov, 62);
  assert.equal(DEFAULT_PREFS.headBob, true);
  assert.equal(DEFAULT_PREFS.mouseSens, 1);
  assert.equal(DEFAULT_PREFS.quality, 'high');
  assert.equal(DEFAULT_PREFS.reducedMotion, 'system');
  assert.deepEqual(sanitizePrefs(null), { ...DEFAULT_PREFS, keys: { ...DEFAULT_KEYS } });
});

test('prefs: storage garbage only fills known keys with sane, in-range values', () => {
  const p = sanitizePrefs({
    minimap: false, fov: 400, mouseSens: -3, uiScale: 'big', renderScale: NaN, quality: 'ultra', nameplates: 'near', clock: '12h',
    reducedMotion: 'maybe', fpsCap: 45, idleMin: 2, toastK: 9, weatherFx: 0.4, evil: 1, keys: { use: 'KeyR', map: 'KeyW', ledger: 7, nope: 'KeyZ' },
  });
  assert.equal(p.minimap, false);
  assert.equal(p.fov, 90);
  assert.equal(p.mouseSens, 0.2);
  assert.equal(p.uiScale, 1);
  assert.equal(p.renderScale, 1);
  assert.equal(p.quality, 'high');
  assert.equal(p.nameplates, 'near');
  assert.equal(p.clock, '12h');
  assert.equal(p.reducedMotion, 'system');
  assert.equal(p.fpsCap, 0);
  assert.equal(p.idleMin, 2);
  assert.equal(p.toastK, 3);
  assert.equal(p.weatherFx, 0.4);
  assert.ok(!('evil' in p));
  assert.deepEqual(p.keys, { ...DEFAULT_KEYS, use: 'KeyR' }, 'reserved (W) and non-string keys fall back');
  for (const bad of [[], 'x', 42, { keys: [] }]) assert.deepEqual(sanitizePrefs(bad).keys, DEFAULT_KEYS);
});

test('prefs: a round trip through JSON is stable', () => {
  const p = sanitizePrefs({ ...DEFAULT_PREFS, uiScale: 1.25, highContrast: true, colorSafe: true, keys: { ...DEFAULT_KEYS, map: 'KeyG' } });
  assert.deepEqual(sanitizePrefs(JSON.parse(JSON.stringify(p))), p);
});

test('keys: duplicates in storage resolve to defaults; conflicts are refused with the reason', () => {
  assert.deepEqual(sanitizeKeys({ use: 'KeyG', alt: 'KeyG' }), { ...DEFAULT_KEYS, use: 'KeyG' });
  assert.deepEqual(sanitizeKeys({ use: 'KeyF' }), DEFAULT_KEYS, 'use on F collides with alt → everything resets');
  assert.deepEqual(keyConflict(DEFAULT_KEYS, 'use', 'KeyM'), { action: 'map' });
  assert.deepEqual(keyConflict(DEFAULT_KEYS, 'use', 'KeyW'), { reserved: 'walk' });
  assert.equal(keyConflict(DEFAULT_KEYS, 'use', 'KeyE'), null, 'its own key is fine');
  assert.equal(keyConflict(DEFAULT_KEYS, 'use', 'KeyG'), null);
  const r = rebind(DEFAULT_KEYS, 'map', 'KeyJ');
  assert.equal(r.keys, DEFAULT_KEYS);
  assert.deepEqual(r.conflict, { action: 'mail' });
  const ok = rebind(DEFAULT_KEYS, 'map', 'KeyG');
  assert.equal(ok.conflict, null);
  assert.equal(ok.keys.map, 'KeyG');
  assert.equal(DEFAULT_KEYS.map, 'KeyM', 'never mutates');
  for (const a of ACTIONS) assert.equal(keyConflict(DEFAULT_KEYS, a, DEFAULT_KEYS[a]), null, `default ${a} is not reserved`);
});

test('keyLabel: readable names', () => {
  assert.equal(keyLabel('KeyE'), 'E');
  assert.equal(keyLabel('Digit4'), '4');
  assert.equal(keyLabel('Tab'), 'Tab');
  assert.equal(keyLabel('Semicolon'), ';');
  assert.equal(keyLabel('F7'), 'F7');
});

test('clock: 24 h and 12 h', () => {
  assert.equal(clockText(9.5), '09:30');
  assert.equal(clockText(0.25, '12h'), '12:15 am');
  assert.equal(clockText(12, '12h'), '12:00 pm');
  assert.equal(clockText(23.99, '12h'), '11:59 pm');
  assert.equal(clockText(-1), '23:00');
});

test('reduced motion, the idle throttle, nameplates, zoom', () => {
  assert.equal(reducedMotion('system', true), true);
  assert.equal(reducedMotion('system', false), false);
  assert.equal(reducedMotion('system', false, true), true, 'the old roaming setting still counts while following the system');
  assert.equal(reducedMotion('off', true, true), false);
  assert.equal(reducedMotion('on', false), true);
  assert.equal(effectiveFpsCap({ fpsCap: 0, idleMin: 5 }, 1000), null);
  assert.equal(effectiveFpsCap({ fpsCap: 30, idleMin: 5 }, 1000), 30);
  assert.equal(effectiveFpsCap({ fpsCap: 60, idleMin: 5 }, 5 * 60_000), IDLE_FPS);
  assert.equal(effectiveFpsCap({ fpsCap: 0, idleMin: 0 }, 1e9), null, 'idle throttle off');
  assert.equal(nameplateShown('always', 99), true);
  assert.equal(nameplateShown('near', NEAR_M), true);
  assert.equal(nameplateShown('near', NEAR_M + 1), false);
  assert.equal(nameplateShown('off', 1), false);
  assert.equal(uiZoom({ uiScale: 1, largeText: false }), 1);
  assert.equal(uiZoom({ uiScale: 1.2, largeText: true }), 1.38);
});

test('status: every status has a colour in both palettes, a distinct shape and glyph', () => {
  for (const st of STATUSES) {
    assert.match(STATUS_PALETTE.warm[st], /^#[0-9a-f]{6}$/);
    assert.match(STATUS_PALETTE.safe[st], /^#[0-9a-f]{6}$/);
    assert.ok(STATUS_SHAPE[st] && STATUS_GLYPH[st]);
  }
  const main = ['blocked', 'working', 'done', 'idle'] as const;
  assert.equal(new Set(main.map((s) => STATUS_SHAPE[s])).size, 4, 'the four statuses you act on never share a shape');
  assert.equal(statusColor('working', false), STATUS_PALETTE.warm.working);
  assert.equal(statusColor('working', true), '#009e73');
});

test('captions: the important cues have words; quiet events none', () => {
  assert.deepEqual(captionFor('blocked', 'claude-hq'), { sound: 'Alert bell', text: 'claude-hq needs you', key: 'blocked' });
  assert.equal(captionFor('finished', 'x')?.sound, 'Done chime');
  assert.match(captionFor('level-up', '', 'Hamlet')?.text ?? '', /Hamlet/);
  assert.equal(captionFor('arrived', 'x'), null);
  assert.equal(captionFor('compact', 'x'), null);
});
