import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayOfYear, skyAt, weatherTrace } from './sky.ts';
import type { WeatherKind } from './types.ts';

const H = 3_600_000;
const kindAt = (d: Date) => skyAt(d).weather.kind;

/** scan forward from `from` for the first block start whose weather matches `pred` */
function findBlock(from: Date, pred: (k: WeatherKind, prev: WeatherKind) => boolean, season?: 'winter'): Date {
  for (let i = 1; i < 3000; i++) {
    const t = new Date(from.getTime() + i * 3 * H);
    t.setHours(Math.floor(t.getHours() / 3) * 3, 0, 0, 0);
    const prev = new Date(t.getTime() - 1.5 * H);
    const k = season ? skyAt(t, { season }).weather.kind : kindAt(t);
    const p = season ? skyAt(prev, { season }).weather.kind : kindAt(prev);
    if (pred(k, p)) return t;
  }
  throw new Error('no such block');
}

test('trace: deterministic, in range, part of the sky', () => {
  const d = new Date(2026, 9, 1, 14, 20);
  const a = weatherTrace(d), b = weatherTrace(d);
  assert.deepEqual(a, b);
  assert.deepEqual(skyAt(d).trace, a);
  for (let h = 0; h < 24 * 20; h += 1.7) {
    const t = weatherTrace(new Date(d.getTime() + h * H));
    assert.ok(t.wet >= 0 && t.wet <= 1 && t.snow >= 0 && t.snow <= 1, JSON.stringify(t));
    if (t.sinceRain !== null) assert.ok(t.sinceRain >= 0 && t.sinceRain <= 12);
  }
});

test('trace: rain soaks the ground, which dries after it stops; sinceRain counts up', () => {
  // a dry block right after a wet one
  const end = findBlock(new Date(2026, 3, 1), (k, p) => !['rain', 'storm'].includes(k) && ['rain', 'storm'].includes(p) && k !== 'fog');
  const during = weatherTrace(new Date(end.getTime() - 0.5 * H));
  assert.ok(during.wet > 0.8, `wet while raining ${during.wet}`);
  assert.equal(during.sinceRain, null);
  const just = weatherTrace(new Date(end.getTime() + 0.25 * H));
  const later = weatherTrace(new Date(end.getTime() + 2.5 * H));
  assert.ok(just.sinceRain !== null && Math.abs(just.sinceRain - 0.25) < 1e-6, `sinceRain ${just.sinceRain}`);
  assert.ok(later.wet < just.wet, `dries: ${just.wet} → ${later.wet}`);
});

test('trace: a forced rain is wet now; forced snow builds lying snow over time', () => {
  const d = new Date(2026, 6, 10, 12, 5);
  const r = weatherTrace(d, { weather: 'rain' });
  assert.ok(r.wet > 0.9);
  assert.equal(r.sinceRain, null);
  const s = weatherTrace(d, { weather: 'snow', season: 'winter' });
  assert.ok(s.snow > 0.2, `snow ${s.snow}`);
  // a real snowy winter block: more lying snow at its end than its start
  const snowy = findBlock(new Date(2026, 0, 1), (k, p) => k === 'snow' && p !== 'snow', 'winter');
  const a = weatherTrace(new Date(snowy.getTime() + 0.1 * H), { season: 'winter' });
  const b = weatherTrace(new Date(snowy.getTime() + 2.9 * H), { season: 'winter' });
  assert.ok(b.snow > a.snow, `${a.snow} → ${b.snow}`);
});

test('trace: a forced sunny day dries what the real rain left, faster under a forced midday sun', () => {
  // just after a real wet block, during the night
  const end = findBlock(new Date(2026, 3, 1), (k, p) => !['rain', 'storm'].includes(k) && ['rain', 'storm'].includes(p) && k !== 'fog');
  const d = new Date(end.getTime() + 0.25 * H);
  const real = weatherTrace(d);
  const noon = weatherTrace(d, { weather: 'clear', hour: 12 });
  const night = weatherTrace(d, { weather: 'clear', hour: 1 });
  assert.ok(noon.wet < real.wet, `forced clear dries: ${real.wet} → ${noon.wet}`);
  assert.ok(noon.wet < night.wet, `midday sun dries faster: noon ${noon.wet}, night ${night.wet}`);
  assert.ok(noon.wet < 0.3, `long after rain on a sunny day the puddles are small (they start at wet 0.2): ${noon.wet}`);
});

test('trace: overrides win', () => {
  const t = weatherTrace(new Date(2026, 6, 10, 12), { trace: { wet: 0.7, sinceRain: 0.2 } });
  assert.equal(t.wet, 0.7);
  assert.equal(t.sinceRain, 0.2);
  assert.equal(skyAt(new Date(2026, 6, 10, 12), { trace: { snow: 1 } }).trace.snow, 1);
});

test('dayOfYear is the calendar day all day long, across DST (rolls at midnight, not at 01:00)', () => {
  assert.equal(dayOfYear(new Date(2026, 0, 1, 0, 5)), 1);
  assert.equal(dayOfYear(new Date(2026, 11, 31, 23, 55)), 365);
  for (const [m, d] of [[2, 9], [5, 10], [10, 1], [10, 2]] as const) {
    const early = dayOfYear(new Date(2026, m, d, 0, 30)), late = dayOfYear(new Date(2026, m, d, 23, 30));
    assert.equal(early, late, `2026-${m + 1}-${d}`);
    assert.equal(dayOfYear(new Date(2026, m, d + 1, 0, 1)), early + 1);
  }
});
