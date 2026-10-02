import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLIP_MS, GAP_MS, MAX_MARKS, MAX_SPANS, ROLL_DAYS, ROLL_FARMERS, addMark, bands, compactSpans, createTimeline, demoDay, earliest, keyMoments,
  parseRolls, parseTimeline, pushJob, pushRoll, rollDay, spanAt, stripRange, summarize,
} from './timeline.ts';
import type { FarmerDay, Observed, Span, TimelineData } from './timeline.ts';
import { dayKey } from './almanac.ts';
import { createValley } from './valley.ts';
import type { ValleySource } from './valley.ts';
import type { Entity, Workspace } from '../../../../shared/protocol.ts';
import { FIELD_DEFAULTS } from '../../../../shared/protocol.ts';
import type { Job } from './types.ts';

const MIN = 60_000;
const T0 = new Date(2026, 9, 2, 9, 0).getTime();
const day = (): FarmerDay => ({ id: 'a', tag: 'a', name: 'a', spans: [], marks: [], rev: 0 });
const obs = (job: Job, patch: Partial<Observed> = {}): Observed => ({ id: 'a', tag: 'app', name: 'flint', job, needsYou: job === 'ask', ...patch });
/** tick once a second through [from, to) like the 4 Hz model does */
const run = (tl: ReturnType<typeof createTimeline>, o: Observed, from: number, to: number) => { for (let t = from; t < to; t += 1000) tl.observe([o], t); };

test('timeline: spans coalesce the same job, blips fold into their neighbours, gaps leave holes', () => {
  const fd = day();
  assert.equal(pushJob(fd, 'plant', T0), true);
  assert.equal(pushJob(fd, 'plant', T0 + MIN), false);
  assert.equal(fd.spans.length, 1);
  assert.equal(fd.spans[0].to, T0 + MIN);
  // a 5 s read between edits folds away, the edit span carries on
  pushJob(fd, 'inspect', T0 + MIN + 1000);
  pushJob(fd, 'plant', T0 + MIN + 6000);
  assert.equal(fd.spans.length, 1, 'blip folded');
  assert.equal(fd.spans[0].job, 'plant');
  // a real switch stays
  pushJob(fd, 'water', T0 + 2 * MIN);
  pushJob(fd, 'water', T0 + 3 * MIN);
  pushJob(fd, 'plant', T0 + 3 * MIN + 1000);
  assert.deepEqual(fd.spans.map((s) => s.job), ['plant', 'water', 'plant']);
  // a short ask is never folded away
  pushJob(fd, 'ask', T0 + 4 * MIN);
  pushJob(fd, 'plant', T0 + 4 * MIN + 3000);
  assert.ok(fd.spans.some((s) => s.job === 'ask'));
  // the valley was closed for ten minutes: a hole, then a fresh span (even for the same job)
  pushJob(fd, 'plant', T0 + 15 * MIN);
  const last = fd.spans[fd.spans.length - 1], before = fd.spans[fd.spans.length - 2];
  assert.equal(last.from, T0 + 15 * MIN);
  assert.ok(last.from - before.to > GAP_MS);
  assert.ok(BLIP_MS < GAP_MS);
});

test('timeline: compaction keeps spans bounded and asks intact', () => {
  const spans: Span[] = [];
  for (let i = 0; i < MAX_SPANS + 50; i++) spans.push({ job: i % 7 === 0 ? 'ask' : i % 2 ? 'plant' : 'inspect', from: T0 + i * MIN, to: T0 + i * MIN + (i % 5 + 1) * 10_000 });
  const asks = spans.filter((s) => s.job === 'ask').length;
  compactSpans(spans);
  assert.ok(spans.length <= MAX_SPANS);
  assert.equal(spans.filter((s) => s.job === 'ask').length, asks);
  for (let i = 1; i < spans.length; i++) assert.ok(spans[i].from >= spans[i - 1].from, 'ordered');
  const fd = day();
  for (let i = 0; i < MAX_MARKS + 20; i++) addMark(fd, { kind: 'pass', at: T0 + i * MIN });
  assert.equal(fd.marks.length, MAX_MARKS);
  assert.equal(fd.marks[0].at, T0 + 20 * MIN, 'the oldest go');
});

test('timeline recorder: asks record how long they waited, marks land, revs bump only on changes', () => {
  const tl = createTimeline(undefined, { now: T0 });
  tl.observe([obs('plant', { detail: 'store.ts', tool: 'edit' })], T0);
  const fd = tl.view.farmers.get('a')!;
  assert.equal(fd.spans[0].what, 'store.ts');
  assert.equal(fd.spans[0].tool, 'edit');
  const r0 = fd.rev;
  tl.observe([obs('plant')], T0 + 1000);
  assert.equal(fd.rev, r0, 'an open span growing is not a change');
  run(tl, obs('plant'), T0 + 2000, T0 + MIN);
  tl.observe([obs('ask', { question: 'Run npm install?' })], T0 + MIN);
  assert.ok(fd.rev > r0);
  run(tl, obs('ask'), T0 + MIN + 1000, T0 + 5 * MIN);
  tl.observe([obs('plant')], T0 + 5 * MIN);
  const ask = fd.marks.find((m) => m.kind === 'ask')!;
  assert.equal(ask.text, 'Run npm install?');
  assert.equal(ask.wait, 4 * MIN);
  tl.mark('a', 'ship', T0 + 6 * MIN, 'fix: retry');
  tl.mark('nobody', 'ship', T0 + 6 * MIN);
  assert.equal(fd.marks.filter((m) => m.kind === 'ship').length, 1);
  assert.equal(tl.view.farmers.has('nobody'), false);
  const s = summarize(fd);
  assert.equal(s.asks, 1);
  assert.equal(s.ships, 1);
  assert.equal(s.waited, 4 * MIN);
  assert.equal(s.active, MIN);
  assert.equal(s.first, T0);
});

test('timeline recorder: persists per day, survives a reload, cleans up at midnight', () => {
  let saved: TimelineData | null = null;
  const store = { load: () => (saved ? JSON.parse(JSON.stringify(saved)) : null), save: (d: TimelineData) => { saved = JSON.parse(JSON.stringify(d)); } };
  const tl = createTimeline(store, { now: T0 });
  tl.observe([obs('plant')], T0);
  tl.mark('a', 'ship', T0 + 1000, 'feat: x');
  assert.ok(saved, 'a ship saves at once');
  run(tl, obs('plant'), T0 + 2000, T0 + 2 * MIN + 1000);
  tl.flush();
  // reload: the same day comes back and the open span continues
  const again = createTimeline(store, { now: T0 + 2 * MIN + 5000 });
  assert.equal(again.view.farmers.get('a')?.marks[0].text, 'feat: x');
  again.observe([obs('plant')], T0 + 2 * MIN + 5000);
  assert.equal(again.view.farmers.get('a')!.spans.length, 1);
  // a stored day from yesterday is dropped on load
  assert.deepEqual(parseTimeline(saved, '2026-10-03').farmers, {});
  assert.deepEqual(parseTimeline({ v: 1, day: dayKey(T0), farmers: { a: { spans: 'x' } } }, dayKey(T0)).farmers, {});
  // midnight while running: a fresh day
  const midnight = new Date(2026, 9, 3, 0, 0, 30).getTime();
  again.observe([obs('plant')], midnight);
  assert.equal(again.view.day, '2026-10-03');
  assert.equal(again.view.farmers.get('a')!.spans.length, 1);
  assert.equal(again.view.farmers.get('a')!.marks.length, 0);
});

test('timeline: key moments pair a red test run with the next green, coalesce green runs and ducklings', () => {
  const fd = day();
  fd.spans.push({ job: 'plant', from: T0, to: T0 + 60 * MIN });
  fd.marks.push(
    { kind: 'pass', at: T0 + 5 * MIN }, { kind: 'pass', at: T0 + 9 * MIN },
    { kind: 'fail', at: T0 + 20 * MIN, text: 'npm test' }, { kind: 'fail', at: T0 + 22 * MIN }, { kind: 'pass', at: T0 + 24 * MIN },
    { kind: 'ship', at: T0 + 30 * MIN, text: 'fix: retry' },
    { kind: 'sub', at: T0 + 31 * MIN }, { kind: 'sub', at: T0 + 32 * MIN },
    { kind: 'ask', at: T0 + 40 * MIN, text: 'Push?', wait: 4 * MIN }, { kind: 'ask', at: T0 + 50 * MIN },
    { kind: 'compact', at: T0 + 55 * MIN },
  );
  const ms = keyMoments(fd);
  assert.deepEqual(ms.map((m) => m.kind), ['ask', 'ask', 'sub', 'ship', 'fixed', 'pass', 'start']);
  const fixed = ms.find((m) => m.kind === 'fixed')!;
  assert.equal(fixed.text, 'tests failed ×2');
  assert.equal(fixed.until, T0 + 24 * MIN);
  assert.equal(ms.find((m) => m.kind === 'pass')!.text, 'tests green ×2');
  assert.equal(ms.find((m) => m.kind === 'sub')!.n, 2);
  assert.equal(ms[0].wait, null, 'the newest ask still waits');
  assert.equal(ms[1].wait, 4 * MIN);
  assert.equal(ms[ms.length - 1].at, T0);
});

test('timeline: bands bucket the day, asks show even when short, holes stay empty', () => {
  const fd = day();
  fd.spans.push({ job: 'plant', from: T0, to: T0 + 50 * MIN }, { job: 'ask', from: T0 + 50 * MIN, to: T0 + 54 * MIN }, { job: 'water', from: T0 + 54 * MIN, to: T0 + 60 * MIN });
  const b = bands(fd, T0, T0 + 120 * MIN, 12);
  assert.deepEqual(b.slice(0, 5), ['plant', 'plant', 'plant', 'plant', 'plant']);
  assert.equal(b[5], 'ask');
  assert.deepEqual(b.slice(6), [null, null, null, null, null, null]);
  assert.equal(spanAt(fd, T0 + 52 * MIN)?.job, 'ask');
  assert.equal(spanAt(fd, T0 + 90 * MIN), null);
  assert.equal(earliest([fd]), T0);
  const r = stripRange(T0 + 25 * MIN, T0 + 300 * MIN);
  assert.equal(r.from, T0);
  assert.ok(stripRange(null, T0 + 300 * MIN).from <= T0 + 180 * MIN, 'at least two hours');
});

test('timeline: the demo morning is deterministic, bounded, ends now and reads well', () => {
  const now = new Date(2026, 9, 2, 12, 30).getTime();
  const a = demoDay({ id: 'p1', tag: 'app', name: 'flint' }, now);
  const b = demoDay({ id: 'p1', tag: 'app', name: 'flint' }, now);
  assert.deepEqual(a, b);
  assert.ok(a.spans.length > 8 && a.spans.length <= MAX_SPANS);
  assert.equal(a.spans[a.spans.length - 1].to, now);
  for (let i = 1; i < a.spans.length; i++) assert.ok(a.spans[i].from >= a.spans[i - 1].to - 1);
  const s = summarize(a);
  assert.ok(s.active > 60 * MIN);
  let ships = 0, tests = 0;
  for (let i = 0; i < 12; i++) { const x = summarize(demoDay({ id: `p${i}`, tag: 't', name: 'n' }, now)); ships += x.ships; tests += x.passes + x.fails; }
  assert.ok(ships > 5 && tests > 12, `a crowd has ships (${ships}) and tests (${tests})`);
});

// ---- through the valley model

const ws: Workspace = { id: 'w1', label: 'app', number: 1, colorIndex: 0, cycle: 0, slot: 0, status: 'working', focused: false, paneCount: 1, tabs: [] };
const ent = (patch: Partial<Entity>): Entity => ({
  ...FIELD_DEFAULTS, subagents: [],
  id: 'p1', terminalId: null, kind: 'claude', name: 'flint', seedKey: 'p1', status: 'working', statusSince: 0, statusSinceApprox: false,
  identity: { terminalId: null, agentSession: null, place: 'p1' }, stateSeq: 1, layoutRect: null,
  workspace: { id: ws.id, label: ws.label, number: 1, colorIndex: 0, cycle: 0, slot: 0, status: 'working' },
  tab: { id: 'w1:t1', label: 't', number: 1, index: 0 }, paneIndex: 0, cwd: '/x/app', project: 'app', repo: null, focused: false, baseTitle: null,
  ...patch,
}) as Entity;

test('valley: the timeline records jobs, asks with their wait, ships and test runs from the wire', () => {
  let now = T0;
  let e = ent({ activity: { tool: 'Edit', cls: 'edit', detail: 'src/store.ts', since: 0 } as Entity['activity'] });
  const src: ValleySource = { entities: () => [e], workspaces: () => [ws], stats: () => null, now: () => now, link: () => 'live', demo: () => false };
  const v = createValley(src, { wallNow: () => now });
  for (let i = 0; i < 20; i++) { v.tick(); now += 1000; }
  e = ent({ status: 'blocked', prompt: { question: 'Push?', options: [] } as unknown as Entity['prompt'] });
  for (let i = 0; i < 180; i++) { v.tick(); now += 1000; }
  e = ent({ activity: { tool: 'Bash', cls: 'test', detail: 'npm test', since: 0 } as Entity['activity'] });
  for (let i = 0; i < 30; i++) { v.tick(); now += 1000; }
  v.ingest({ t: 'event', id: 'p1', kind: 'test-fail', detail: { cmd: 'npm test' } });
  v.ingest({ t: 'event', id: 'p1', kind: 'test-pass', detail: { cmd: 'npm test' } });
  v.ingest({ t: 'event', id: 'p1', kind: 'commit', detail: { msg: 'fix: it' } });
  const fd = v.state.timeline.farmers.get('p1')!;
  assert.deepEqual(fd.spans.map((s) => s.job), ['plant', 'ask', 'water']);
  const ask = fd.marks.find((m) => m.kind === 'ask')!;
  assert.equal(ask.text, 'Push?');
  assert.ok(ask.wait! >= 170_000 && ask.wait! <= 190_000, `waited ${ask.wait}`);
  const s = summarize(fd);
  assert.equal(s.ships, 1);
  assert.equal(s.passes + s.fails, 2);
  assert.equal(keyMoments(fd).find((m) => m.kind === 'ship')?.sub, 'fix: it');
  // the demo valley seeds a morning for farmers it sees for the first time
  v.useTimeline(undefined, demoDay);
  v.tick();
  assert.ok(v.state.timeline.farmers.get('p1')!.spans.length > 5);
});

test('timeline roll-up: a finished day becomes a few numbers per farmer, kept ROLL_DAYS days', () => {
  const fd = demoDay({ id: 'a', tag: 'app', name: 'flint' }, T0 + 6 * 60 * MIN);
  const r = rollDay({ day: dayKey(T0), farmers: { a: fd, idle: { id: 'idle', tag: 'x', name: 'x', spans: [], marks: [], rev: 0 } } });
  assert.equal(r.day, dayKey(T0));
  assert.equal(r.farmers.length, 1, 'farmers with nothing recorded are left out');
  const s = summarize(fd), f = r.farmers[0];
  assert.equal(f.ships, s.ships); assert.equal(f.asks, s.asks); assert.equal(f.passes, s.passes);
  assert.ok(Math.abs(f.active - s.active) <= 500);
  const answered = fd.marks.filter((m) => m.kind === 'ask' && (m.wait ?? 0) > 0);
  assert.equal(f.answered, answered.length);
  // bounded: the busiest ROLL_FARMERS
  const many = Object.fromEntries(Array.from({ length: ROLL_FARMERS + 6 }, (_, i) => [`f${i}`, { id: `f${i}`, tag: 't', name: `n${i}`, spans: [{ job: 'plant' as Job, from: T0, to: T0 + (i + 1) * MIN }], marks: [], rev: 0 }]));
  const big = rollDay({ day: dayKey(T0), farmers: many });
  assert.equal(big.farmers.length, ROLL_FARMERS);
  assert.equal(big.farmers[0].id, `f${ROLL_FARMERS + 5}`, 'busiest first');
  // pruned to the ROLL_DAYS before today, one per date, oldest first
  let past = parseRolls([], '2026-10-20');
  for (let d = 1; d <= 19; d++) past = pushRoll(past, { day: `2026-10-${String(d).padStart(2, '0')}`, farmers: [] }, '2026-10-20');
  assert.equal(past.length, ROLL_DAYS);
  assert.equal(past[0].day, '2026-10-12'); assert.equal(past.at(-1)!.day, '2026-10-19');
  assert.deepEqual(parseRolls([{ day: '2026-10-20', farmers: [] }, { day: 'x' }, null, 5], '2026-10-20'), [], 'today and junk are not past days');
});

test('timeline roll-up: midnight and a stale stored day both roll into past, and it persists', () => {
  let saved: TimelineData | null = null;
  const store = { load: () => (saved ? JSON.parse(JSON.stringify(saved)) : null), save: (d: TimelineData) => { saved = JSON.parse(JSON.stringify(d)); } };
  const tl = createTimeline(store, { now: T0 });
  run(tl, obs('plant'), T0, T0 + 10 * MIN);
  tl.mark('a', 'ship', T0 + 10 * MIN, 'feat: x');
  // the valley stays open across midnight
  const midnight = new Date(2026, 9, 3, 0, 0, 30).getTime();
  tl.observe([obs('plant')], midnight);
  assert.equal(tl.view.past.length, 1);
  assert.equal(tl.view.past[0].day, dayKey(T0));
  assert.equal(tl.view.past[0].farmers[0].ships, 1);
  assert.ok(tl.view.past[0].farmers[0].active >= 9 * MIN);
  tl.flush();
  assert.equal(saved!.past?.length, 1);
  // closed on the 3rd, opened on the 5th: the 3rd's stored day is rolled up on load, the 2nd's roll kept
  tl.mark('a', 'ship', midnight + 1000, 'fix: y');
  tl.flush();
  const later = createTimeline(store, { now: new Date(2026, 9, 5, 9).getTime() });
  assert.deepEqual(later.view.past.map((r) => r.day), ['2026-10-02', '2026-10-03']);
  assert.equal(later.view.farmers.size, 0);
  // a store from long ago keeps nothing
  assert.deepEqual(parseTimeline(saved, '2026-12-01').past, []);
});
