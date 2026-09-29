import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBus } from './bus.ts';
import { parseParams } from './params.ts';
import { createClock } from './time.ts';
import { clamp, damp, wrapAngle, yawTo, forwardX, forwardZ } from './math.ts';
import { setSeed, rng, seeded } from './rng.ts';
import { createSettings } from './settings.ts';
import type { Settings as WireSettings } from '../../../shared/protocol.ts';
import type { ClientMsg } from '../../../shared/protocol.ts';

test('bus: on/emit/off/once, listener errors contained', () => {
  const bus = createBus<{ a: number }>();
  const got: (number | string)[] = [];
  const off = bus.on('a', (p) => got.push(p));
  bus.once('a', (p) => got.push(`once:${p}`));
  bus.on('a', () => { throw new Error('boom'); });
  const err = console.error; console.error = () => {};
  bus.emit('a', 1);
  bus.emit('a', 2);
  off();
  bus.emit('a', 3);
  console.error = err;
  assert.deepEqual(got, [1, 'once:1', 2]);
});

test('params: defaults, clamps, flags', () => {
  const p = parseParams('?t=abc&pose=proto&hour=13.5&quality=high&layout=hq&nohud&fov=90&timescale=4&seed=x');
  assert.equal(p.token, 'abc');
  assert.equal(p.pose, 'proto');
  assert.equal(p.hour, 13.5);
  assert.equal(p.quality, 'high');
  assert.equal(p.layout, 'hq');
  assert.equal(p.nohud, true);
  assert.equal(p.fov, 75);
  assert.equal(p.timescale, 4);
  const d = parseParams('');
  assert.equal(d.quality, null);
  assert.equal(d.layout, null); // [LVL M1.5] no default in params: main.ts picks hq (proto for a proto pose)
  assert.equal(parseParams('?layout=proto').layout, 'proto');
  assert.equal(d.fov, 60);
  assert.equal(d.hour, null);
  assert.equal(d.nohud, false);
  assert.equal(parseParams('?quality=ultra').quality, null);
});

test('clock: scale, freeze, clamp, hour pin', () => {
  const c = createClock({ scale: 2 });
  c.tick(0);
  c.tick(50);
  assert.ok(Math.abs(c.dt - 0.1) < 1e-9);
  c.tick(1050); // 1 s gap → raw clamp 0.25, scaled clamp 0.1
  assert.equal(c.rawDt, 0.25);
  assert.equal(c.dt, 0.1);
  c.freeze(true);
  const t = c.time;
  c.tick(1066);
  assert.equal(c.time, t);
  c.setHour(25.5);
  assert.equal(c.hour(), 1.5);
  c.setHour(null);
  assert.ok(c.hour() >= 0 && c.hour() < 24);
});

test('math: yaw convention (§7): yaw 0 faces −z', () => {
  assert.equal(forwardX(0), -0);
  assert.equal(forwardZ(0), -1);
  assert.ok(Math.abs(yawTo(0, -1)) < 1e-12);
  assert.ok(Math.abs(yawTo(-1, 0) - Math.PI / 2) < 1e-12);
  assert.ok(Math.abs(wrapAngle(3 * Math.PI) - Math.PI) < 1e-9);
  assert.equal(clamp(5, 0, 1), 1);
  assert.ok(Math.abs(damp(0, 1, 10, 1e9) - 1) < 1e-9);
});

test('rng: seeded streams are deterministic and independent of setSeed', () => {
  const a = seeded('scout'); const b = seeded('scout');
  assert.equal(a(), b());
  setSeed(42); const x = rng(); setSeed(42);
  assert.equal(rng(), x);
});

test('settings: known keys only, optimistic apply sends settings.set', () => {
  const sent: ClientMsg[] = [];
  const s = createSettings({ send: (m) => sent.push(m) });
  const changes: Partial<WireSettings>[] = [];
  s.onChange((c) => changes.push(c));
  // @ts-expect-error `bogus` is not a setting: the runtime must drop unknown keys
  s.set({ fov: 70, bogus: 1 });
  assert.equal(s.get('fov'), 70);
  assert.deepEqual(sent, [{ t: 'settings.set', patch: { fov: 70 } }]);
  s._applyServer({ fov: 70, termFontPx: 16 });
  assert.deepEqual(changes, [{ fov: 70 }, { termFontPx: 16 }]);
});
