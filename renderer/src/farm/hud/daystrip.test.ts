import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BAND_COLOR, BAND_OF, hhmm, hourTicks, momentTail, spanLine, stripGradient, summaryLine } from './daystrip.ts';
import { JOBS } from '../model/types.ts';
import { summarize } from '../model/timeline.ts';

const T0 = new Date(2026, 9, 2, 9, 0).getTime();
const MIN = 60_000;

test('daystrip: every job has a band, runs merge into one gradient stop, no record stays clear', () => {
  for (const j of JOBS) assert.ok(BAND_OF[j]);
  assert.equal(stripGradient([null, null]), 'transparent');
  const g = stripGradient(['plant', 'plant', 'ask', null]);
  assert.equal(g, `linear-gradient(90deg, ${BAND_COLOR.edit} 0% 50%, ${BAND_COLOR.ask} 50% 75%, transparent 75% 100%)`);
  // inspect and fetch share a band: one stop
  assert.equal(stripGradient(['inspect', 'fetch']), `linear-gradient(90deg, ${BAND_COLOR.read} 0% 100%)`);
});

test('daystrip: hour ticks, moment tails and summary copy', () => {
  const ticks = hourTicks(T0 - 20 * MIN, T0 + 150 * MIN);
  assert.deepEqual(ticks.map((t) => t.label), ['9:00', '10:00', '11:00']);
  assert.ok(hourTicks(T0, T0 + 10 * 60 * MIN).every((t) => new Date(t.at).getHours() % 2 === 0));
  assert.equal(hhmm(T0 + 5 * MIN), '09:05');
  assert.equal(momentTail({ at: T0, kind: 'fixed', text: 'tests failed', until: T0 + 4 * MIN }, T0), '→ 09:04 green');
  assert.equal(momentTail({ at: T0, kind: 'ask', text: 'asked you', wait: 4 * MIN }, T0), 'waited 4m');
  assert.equal(momentTail({ at: T0, kind: 'ask', text: 'asked you', wait: null }, T0 + 2 * MIN), 'still waiting · 2m');
  assert.equal(summaryLine(summarize(undefined)), 'Nothing recorded today yet');
  const s = summarize({ id: 'a', tag: 'a', name: 'a', rev: 1, spans: [{ job: 'plant', from: T0, to: T0 + 70 * MIN }, { job: 'ask', from: T0 + 70 * MIN, to: T0 + 75 * MIN }],
    marks: [{ kind: 'ship', at: T0 }, { kind: 'fail', at: T0 }, { kind: 'pass', at: T0 }] });
  assert.equal(summaryLine(s), '1h 10m active · waited 5m on you · 1 ship · 2 test runs (1 red)');
  assert.equal(spanLine({ job: 'inspect', tool: 'search', from: T0, to: T0 + 12 * MIN, what: 'store.ts' }), '09:00–09:12 · Searching · 12m\nstore.ts');
});
