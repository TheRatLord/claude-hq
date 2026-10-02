import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PACE, Shy, WILD, WILD_IDS, geesePass, sees, wildAbout, wildDay, wildVisiting } from './wild.ts';

test('wild: every visitor has windows, a sight range and sensible shyness', () => {
  for (const id of WILD_IDS) {
    const s = WILD[id];
    assert.ok(s.windows.length > 0 && s.seasons.length > 0, id);
    assert.ok(s.sight > 0, id);
    if (id !== 'geese') assert.ok(s.notice > s.flee && s.flee > 0, id);
  }
});

test('wild: time windows by hour, season and weather (wrapping midnight)', () => {
  assert.ok(wildAbout('deer', 6, 'autumn', 'clear'));
  assert.ok(wildAbout('deer', 19, 'winter', 'snow'));
  assert.ok(!wildAbout('deer', 13, 'autumn', 'clear'));
  assert.ok(!wildAbout('deer', 6, 'autumn', 'storm'));
  assert.ok(wildAbout('fox', 23.5, 'summer', 'clear') && wildAbout('fox', 2, 'summer', 'clear') && !wildAbout('fox', 12, 'summer', 'clear'));
  assert.ok(wildAbout('owl', 1, 'spring', 'clear') && !wildAbout('owl', 1, 'spring', 'rain'));
  assert.ok(!wildAbout('hedgehog', 20, 'winter', 'clear') && wildAbout('hedgehog', 20, 'autumn', 'clear'));
  assert.ok(wildAbout('geese', 8, 'autumn', 'clear') && !wildAbout('geese', 8, 'summer', 'clear'));
  assert.ok(wildAbout('heron', 9, 'winter', 'snow'));
  // something wild is about at dawn, by day and at night in every season
  for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
    for (const h of [6.5, 10, 22]) assert.ok(WILD_IDS.some((id) => wildAbout(id, h, season, 'clear')), `${season} ${h}`);
  }
});

test('wild: the day plan is deterministic per date and varies between dates', () => {
  for (const id of WILD_IDS) assert.deepEqual(wildDay('2026-10-01', id), wildDay('2026-10-01', id));
  const spots = new Set(Array.from({ length: 20 }, (_, i) => wildDay(`2026-10-${String(i + 1).padStart(2, '0')}`, 'deer').spot % 7));
  assert.ok(spots.size >= 4, 'the deer use different spots across a month');
  // most days have visitors
  let comes = 0;
  for (let d = 1; d <= 28; d++) comes += wildDay(`2026-02-${String(d).padStart(2, '0')}`, 'fox').comes ? 1 : 0;
  assert.ok(comes >= 20);
  // a visit never starts outside its (shifted) window
  const p = { ...wildDay('2026-10-01', 'deer'), comes: true };
  assert.ok(!wildVisiting(p, 12, 'autumn', 'clear'));
  assert.ok(wildVisiting(p, 7, 'autumn', 'clear'));
  assert.ok(!wildVisiting({ ...p, comes: false }, 7, 'autumn', 'clear'));
});

test('wild: geese go over every few minutes during their window', () => {
  const p = wildDay('2026-10-01', 'geese');
  let flying = 0;
  // sample every 6 s across an hour: a pass is in the air ~11% of the time
  for (let s = 0; s < 600; s++) if (geesePass(p, 7 + s / 600).k >= 0) flying++;
  assert.ok(flying > 40 && flying < 110, `${flying}`);
});

test('shy: charging scares it off, a careful stop-and-go approach gets close', () => {
  const o = WILD.deer;
  // sprinting in from 40 m: gone well before you are close
  let s = new Shy();
  let d = 40, fledAt = -1;
  for (let i = 0; i < 400 && d > 0; i++) { d -= 8.2 / 60; if (s.step(1 / 60, d, 8.2, o) === 'flee') { fledAt = d; break; } }
  assert.ok(fledAt > o.notice, `fled at ${fledAt}`);
  // walking straight in: noticed, then off before the flee radius... but not instantly
  s = new Shy(); d = 35; fledAt = -1;
  for (let i = 0; i < 1200 && d > 0; i++) { d -= 4.6 / 60; if (s.step(1 / 60, d, 4.6, o) === 'flee') { fledAt = d; break; } }
  assert.ok(fledAt > o.flee && fledAt < o.notice, `walked: fled at ${fledAt}`);
  // stop and go: half a second of walking, then wait for it to settle
  s = new Shy(); d = 35;
  let t = 0;
  for (let i = 0; i < 60 * 120 && d > o.flee + 1; i++) {
    const walking = (t % 2.2) < 0.45;
    const v = walking ? 4.6 : 0;
    d -= (v / 60);
    t += 1 / 60;
    assert.notEqual(s.step(1 / 60, d, v, o), 'flee', `spooked at ${d.toFixed(1)}`);
  }
  assert.ok(d <= o.flee + 1);
  // standing still it calms down
  for (let i = 0; i < 60 * 8; i++) s.step(1 / 60, d, 0, o);
  assert.equal(s.state, 'calm');
  assert.ok(PACE.sprint < 8.2 && PACE.sprint > 4.6, 'sprint pace sits between walking and sprinting');
});

test('shy: sightings need range, view and a calm animal', () => {
  assert.ok(sees(10, 0.95, 'calm', 30));
  assert.ok(sees(10, 0.95, 'alert', 30));
  assert.ok(!sees(10, 0.95, 'flee', 30));
  assert.ok(!sees(40, 0.95, 'calm', 30));
  assert.ok(!sees(10, 0.2, 'calm', 30));
});
