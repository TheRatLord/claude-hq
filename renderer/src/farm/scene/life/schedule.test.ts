import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activity, blink, outboundShare, pigeonInterval, wildness } from './schedule.ts';
import type { LifeClock } from './schedule.ts';

const at = (hour: number, daylight: number, o: Partial<LifeClock> = {}): LifeClock =>
  ({ hour, daylight, night: 1 - daylight, weather: 'clear', intensity: 0, season: 'summer', ...o });

test('birds by day, fireflies by night', () => {
  const noon = activity(at(12, 1));
  const midnight = activity(at(0, 0));
  assert.ok(noon.birds > 0.9 && noon.butterflies > 0.9);
  assert.equal(noon.fireflies, 0);
  assert.equal(midnight.birds, 0);
  assert.equal(midnight.butterflies, 0);
  assert.ok(midnight.fireflies > 0.9);
  assert.ok(midnight.croak > noon.croak);
  assert.ok(midnight.sleep && !noon.sleep);
});

test('dawn chorus peaks after sunrise', () => {
  const dawn = activity(at(6.6, 0.6)).chorus;
  assert.ok(dawn > 0.5, `dawn chorus ${dawn}`);
  assert.ok(activity(at(14, 1)).chorus < 0.05);
});

test('storms send everyone for cover', () => {
  const storm = activity(at(12, 1, { weather: 'storm', intensity: 1 }));
  const rain = activity(at(12, 1, { weather: 'rain', intensity: 0.5 }));
  assert.ok(storm.shelter);
  assert.ok(storm.birds < 0.3);
  assert.equal(storm.butterflies, 0);
  assert.ok(rain.birds < activity(at(12, 1)).birds);
  assert.ok(rain.rabbits < 0.2);
  assert.ok(wildness('storm', 1) > wildness('rain', 1) && wildness('rain', 1) > wildness('clear', 1));
});

test('winter: no fireflies, no frogs', () => {
  const w = activity(at(23, 0, { season: 'winter' }));
  assert.equal(w.fireflies, 0);
  assert.equal(w.frogs, 0);
});

test('all activity levels stay within 0..1', () => {
  for (let h = 0; h < 24; h += 0.5) for (const weather of ['clear', 'cloudy', 'rain', 'storm', 'fog', 'snow'] as const) {
    const a = activity(at(h, Math.max(0, Math.sin(((h - 6) / 12) * Math.PI)), { weather, intensity: 1 }));
    for (const [k, v] of Object.entries(a)) if (typeof v === 'number') assert.ok(v >= 0 && v <= 1, `${k}=${v} at ${h} ${weather}`);
  }
});

test('pigeon traffic is log-scaled with the network', () => {
  assert.equal(pigeonInterval(0), Infinity);
  assert.equal(pigeonInterval(NaN), Infinity);
  const k1 = pigeonInterval(1e3), k100 = pigeonInterval(1e5), m10 = pigeonInterval(1e7), huge = pigeonInterval(1e10);
  assert.ok(k1 > 25 && k1 < 60, `1 kB/s → ${k1}`);
  assert.ok(k100 > 4 && k100 < 15, `100 kB/s → ${k100}`);
  assert.ok(m10 < 3, `10 MB/s → ${m10}`);
  assert.ok(k1 > k100 && k100 > m10 && m10 >= huge);
  assert.equal(huge, 1.2);
});

test('outbound share follows upload vs download', () => {
  assert.equal(outboundShare(0, 0), 0.5);
  assert.ok(outboundShare(1e6, 1e3) < 0.5);
  assert.ok(outboundShare(1e3, 1e6) > 0.5);
  assert.ok(outboundShare(1e9, 0) >= 0.15);
});

test('blink is a brief pulse', () => {
  let lit = 0;
  for (let i = 0; i < 1000; i++) { const b = blink(i / 100, 4, 0.3); assert.ok(b >= 0 && b <= 1); if (b > 0) lit++; }
  assert.ok(lit > 150 && lit < 300, `lit ${lit}`);
});
