import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ISSUES_KEPT, NOTES_MAX, addDays, composeIssue, createGazette, dayWeather, demoInput, demoPast, duration, gatherFacts, issueLetter, issueNo,
  parseFacts, parseGazette, rangeOf, weekOf, weekdayOf, weeklyDue,
} from './gazette.ts';
import type { GazetteData, GazetteInput, GzNote, WeekFacts } from './gazette.ts';
import { dayKey, demoAlmanac, emptyAlmanac, RANKS } from './almanac.ts';
import type { AlmanacData } from './almanac.ts';
import type { DayRoll, FarmerRoll } from './timeline.ts';
import { blockKinds } from './sky.ts';

const at = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h).getTime();
// Monday 5 October 2026, 9 am: the weekly edition covers Mon 28 Sep – Sun 4 Oct
const MON = at(2026, 10, 5, 9);
const roll = (day: string, ...fs: Partial<FarmerRoll>[]): DayRoll => ({
  day, farmers: fs.map((f) => ({ id: f.name ?? 'a', name: 'a', tag: 'app', active: 0, waited: 0, asks: 0, answered: 0, wait: 0, ships: 0, passes: 0, fails: 0, finished: 0, ...f })),
});
const H = 3_600_000;

function almanacWith(days: { date: string; points: number; commit?: number; tests?: number; finished?: number; tilled?: number }[], points: number, since = at(2026, 9, 1)): AlmanacData {
  const a = emptyAlmanac();
  for (const d of days) a.days.push({ date: d.date, points: d.points, counts: { ...(d.commit ? { commit: d.commit } : {}), ...(d.tests ? { tests: d.tests } : {}), ...(d.finished ? { finished: d.finished } : {}), ...(d.tilled ? { tilled: d.tilled } : {}) } });
  a.points = points; a.since = since; a.best = Math.max(0, ...days.map((d) => d.points));
  return a;
}
const input = (o: Partial<GazetteInput>): GazetteInput => ({ kind: 'weekly', now: MON, almanac: emptyAlmanac(), past: [], notes: [], ...o });

test('gazette dates: weeks start on Monday, the weekly covers last week, the morning edition the last seven days', () => {
  assert.equal(weekdayOf('2026-10-05'), 0);
  assert.equal(weekdayOf('2026-10-04'), 6);
  assert.equal(weekOf('2026-10-04'), '2026-09-28');
  assert.equal(weekOf('2026-10-05'), '2026-10-05');
  assert.deepEqual(rangeOf('weekly', '2026-10-05'), { from: '2026-09-28', to: '2026-10-04' });
  assert.deepEqual(rangeOf('weekly', '2026-10-08'), { from: '2026-09-28', to: '2026-10-04' });
  assert.deepEqual(rangeOf('daily', '2026-10-08'), { from: '2026-10-02', to: '2026-10-08' });
  // across the end of DST (25 Oct 2026 in Europe) the dates still step by one
  assert.equal(addDays('2026-10-24', 2), '2026-10-26');
  assert.equal(issueNo(at(2026, 9, 1), '2026-10-05'), 6);
  assert.equal(issueNo(0, '2026-10-05'), 1);
  assert.equal(duration(30_000), 'under a minute');
  assert.equal(duration(45 * 60_000), '45 min');
  assert.equal(duration(6 * H + 20 * 60_000), '6 h 20 min');
});

test('gazette facts: the week\'s harvest, best day, record, streak and rank-up come from the Almanac', () => {
  const days = [
    { date: '2026-09-20', points: 90, commit: 3 }, // before the week: the old best
    { date: '2026-09-28', points: 60, commit: 2, tests: 5 },
    { date: '2026-09-29', points: 140, commit: 8, tests: 10, finished: 2 },
    { date: '2026-09-30', points: 30, commit: 1, tilled: 1 },
    { date: '2026-10-01', points: 20 }, { date: '2026-10-02', points: 25 }, { date: '2026-10-03', points: 10 }, { date: '2026-10-04', points: 15 },
    { date: '2026-10-05', points: 40, commit: 4 }, // today: not in the weekly
  ];
  // 260 before the week (Hamlet), 300 in it → 560 (Market Village) at Sunday's end, + 40 today
  const al = almanacWith(days, 600);
  const f = gatherFacts(input({ almanac: al }));
  assert.equal(f.from, '2026-09-28'); assert.equal(f.to, '2026-10-04');
  assert.equal(f.points, 300);
  assert.deepEqual(f.harvest, { commit: 11, tests: 15, finished: 2, tilled: 1 });
  assert.deepEqual(f.bestDay, { date: '2026-09-29', points: 140 });
  assert.equal(f.record, true, '140 beats the old best of 90');
  assert.equal(f.streak, 7);
  assert.equal(f.rank, 'Market Village');
  assert.equal(f.rankFrom, 'Hamlet');
  assert.deepEqual(f.next, { name: 'Market Town', left: RANKS[5].at - 560 });
  assert.equal(f.days.length, 7);
  // the weather of each day is the sky's real blocks
  for (const d of f.days) assert.equal(d.weather, dayWeather(d.date).weather);
  assert.equal(f.forecast.length, 4);
  assert.equal(f.forecast[0].date, '2026-10-05');
  // no earlier day on record: a best day is not a "record"
  const fresh = gatherFacts(input({ almanac: almanacWith(days.slice(1), 600) }));
  assert.equal(fresh.record, false);
});

test('gazette facts: hardest-working farmer, busiest field and the wait for you come from the roll-up', () => {
  const past = [
    roll('2026-09-29', { name: 'flint', tag: 'app', active: 3 * H, ships: 1, asks: 2, answered: 2, wait: 4 * 60_000 }, { name: 'moss', tag: 'api', active: 1 * H, ships: 4 }),
    roll('2026-09-30', { name: 'flint', tag: 'app', active: 2 * H, fails: 2 }, { name: 'moss', tag: 'api', active: 0.5 * H, answered: 1, wait: 8 * 60_000 }),
    roll('2026-09-21', { name: 'moss', tag: 'api', active: 20 * H }), // last-but-one week: not counted
  ];
  const f = gatherFacts(input({ past }));
  assert.deepEqual(f.farmer, { name: 'flint', tag: 'app', active: 5 * H, ships: 1, days: 2 });
  assert.deepEqual(f.shipper, { name: 'moss', tag: 'api', ships: 4 });
  assert.equal(f.field?.tag, 'app');
  assert.ok(Math.abs(f.field!.share - 5 / 6.5) < 1e-9);
  assert.deepEqual(f.wait, { avg: 4 * 60_000, n: 3 });
  assert.equal(f.fails, 2);
  assert.equal(f.farmers, 2);
  assert.equal(f.active, 6.5 * H);
  // the morning edition also counts today, live
  const d = gatherFacts(input({ kind: 'daily', now: at(2026, 9, 30, 15), past: past.slice(0, 1), today: past[1] }));
  assert.equal(d.farmer?.active, 5 * H);
});

test('gazette facts: the journal makes gossip, the fishing report, finds and the stamp of the week', () => {
  const notes: GzNote[] = [
    { k: 'gift', at: at(2026, 9, 29, 15), who: 'villager:hazel', item: 'hazelnut', tier: 'love' },
    { k: 'catch', at: at(2026, 9, 30, 18), item: 'carp', cm: 64 },
    { k: 'catch', at: at(2026, 10, 1, 18), item: 'pike', cm: 71 },
    { k: 'catch', at: at(2026, 10, 1, 19), item: 'boot', cm: 90 }, // junk is never the catch of the week
    { k: 'catch', at: at(2026, 9, 20, 18), item: 'salmon', cm: 88 }, // the week before
    { k: 'find', at: at(2026, 10, 2, 9), item: 'chanterelle' },
    { k: 'hearts', at: at(2026, 10, 3, 9), who: 'villager:fern', n: 4 },
  ];
  const stamps = { 'first-fish': at(2026, 9, 30, 18), 'big-catch': at(2026, 10, 1, 18), photo: at(2026, 9, 1) };
  const f = gatherFacts(input({ notes, stamps }));
  assert.deepEqual(f.fish, { item: 'pike', cm: 71 });
  assert.equal(f.catches, 3);
  assert.deepEqual(f.finds, ['chanterelle']);
  assert.deepEqual(f.stamp, { id: 'big-catch', at: stamps['big-catch'] });
  assert.equal(f.stamps, 2);
  assert.equal(f.notes[0].k, 'hearts');
  const iss = composeIssue(f);
  assert.ok(iss.gossip.some((g) => /Hazel/.test(g) && /hazelnut/.test(g)), iss.gossip.join(' | '));
  assert.ok(iss.gossip.some((g) => /Fern/.test(g) && /four hearts/.test(g)));
  assert.ok(iss.stories.some((s) => s.id === 'fish' && /71 cm/.test(s.head + s.body.join(' '))));
  assert.ok(iss.stories.some((s) => s.id === 'stamp' && s.stamp === 'big-catch'));
});

test('gazette compose: only facts, seeded per issue (same page twice, different weeks read differently)', () => {
  const days = [{ date: '2026-09-29', points: 140, commit: 12, tests: 10 }, { date: '2026-09-30', points: 40, commit: 2 }];
  const f = gatherFacts(input({ almanac: almanacWith(days, 180), past: [roll('2026-09-29', { name: 'flint', tag: 'app', active: 3 * H, ships: 12 })] }));
  const a = composeIssue(f), b = composeIssue(structuredClone(f));
  assert.deepEqual(a, b, 'deterministic');
  assert.equal(a.lead.id, 'lead');
  // the numbers box carries the real totals
  assert.equal(a.numbers.find((n) => n.label === 'Commits shipped')?.value, '14');
  assert.ok(a.stories.some((s) => s.id === 'farmer' && /Flint/.test(s.head + s.body.join(' '))));
  // every printed number in the lead appears in the facts (no invented figures)
  const text = [a.lead.head, a.lead.deck ?? '', ...a.lead.body].join(' ');
  for (const m of text.match(/\d[\d,]*/g) ?? []) {
    const n = Number(m.replace(/,/g, ''));
    assert.ok([14, 12, 10, 2, 180, 140, 3, 1, 29].includes(n) || n === f.next?.left, `lead number ${n} in "${text}"`);
  }
  // headlines vary across weeks (templates seeded by the covered days)
  const heads = new Set<string>();
  for (let w = 0; w < 12; w++) {
    const now = at(2026, 10, 5 + w * 7, 9);
    const { from } = rangeOf('weekly', dayKey(now));
    const ff = gatherFacts(input({ now, almanac: almanacWith([{ date: addDays(from, 1), points: 60, commit: 6 }], 2000) }));
    heads.add(composeIssue(ff).lead.head);
  }
  assert.ok(heads.size >= 3, [...heads].join(' | '));
  // a week with nothing in it is a quiet issue, not an invented one
  const q = composeIssue(gatherFacts(input({})));
  assert.equal(q.quiet, true);
  assert.equal(q.stories.filter((s) => ['farmer', 'field', 'wait', 'tests', 'fish', 'stamp'].includes(s.id)).length, 0);
  assert.equal(q.gossip.length, 0);
  const l = issueLetter(a);
  assert.match(l.title, /^The Valley Gazette, No\. \d+: /);
});

test('gazette: the weekly is due on Monday morning or the first visit of a new week, once', () => {
  const d: GazetteData = { v: 1, notes: [], issues: [], week: '' };
  assert.equal(weeklyDue(d, at(2026, 10, 5, 5)), false, 'not before six on Monday');
  assert.equal(weeklyDue(d, at(2026, 10, 5, 6)), true);
  assert.equal(weeklyDue(d, at(2026, 10, 7, 1)), true, 'first visit later in the week');
  let saved: unknown = null;
  let clock = at(2026, 10, 5, 9);
  const g = createGazette({ load: () => saved, save: (x) => { saved = JSON.parse(JSON.stringify(x)); } }, () => clock);
  assert.equal(g.due(), true);
  const facts = gatherFacts(input({ almanac: demoAlmanac(clock) }));
  g.file(facts);
  assert.equal(g.due(), false);
  clock = at(2026, 10, 9, 9);
  assert.equal(g.due(), false, 'the same week');
  clock = at(2026, 10, 12, 7);
  assert.equal(g.due(), true, 'next Monday');
  // the back issues survive a reload, as facts that recompose
  const again = createGazette({ load: () => saved, save: () => {} }, () => clock);
  assert.equal(again.data().issues.length, 1);
  assert.deepEqual(composeIssue(again.data().issues[0].facts), composeIssue(facts));
  // bounded: ISSUES_KEPT issues, NOTES_MAX notes (old ones go)
  for (let w = 0; w < ISSUES_KEPT + 3; w++) { clock = at(2026, 10, 12 + w * 7, 9); g.file(gatherFacts(input({ now: clock }))); }
  assert.equal(g.data().issues.length, ISSUES_KEPT);
  for (let i = 0; i < NOTES_MAX + 30; i++) g.note({ k: 'catch', at: clock - i * 1000, item: 'carp', cm: 40 });
  assert.equal(g.data().notes.length, NOTES_MAX);
  g.note({ k: 'catch', at: clock - 30 * 86_400_000, item: 'carp', cm: 40 } as GzNote);
  assert.ok(g.data().notes.every((n) => clock - n.at < 10 * 86_400_000), 'a month-old note is dropped');
  // garbage in storage never breaks it
  for (const bad of [null, 'x', 1, { v: 1, issues: 'x', notes: [{ k: 'gift' }] }, { v: 1, issues: [{ at: 1, facts: { v: 1 } }] }]) {
    const p = parseGazette(bad);
    if (p) assert.ok(Array.isArray(p.issues) && Array.isArray(p.notes));
  }
  assert.equal(parseFacts({ v: 1, date: '2026-10-05', from: '2026-10-04', to: '2026-09-28' }), null);
});

test('gazette demo: a believable week from the seeded history', () => {
  const now = at(2026, 10, 5, 9);
  const farmers = [{ id: 'p1', tag: 'claude-hq', name: 'flint' }, { id: 'p2', tag: 'api', name: 'moss' }, { id: 'p3', tag: 'site', name: 'wren' }];
  const past = demoPast(farmers, now);
  assert.equal(past.length, 8);
  const sat = past.find((r) => weekdayOf(r.day) === 5)!, tue = past.find((r) => weekdayOf(r.day) === 1)!;
  assert.ok(tue.farmers.length >= sat.farmers.length, 'weekends are quieter');
  for (const kind of ['weekly', 'daily'] as const) {
    const f: WeekFacts = gatherFacts(demoInput(kind, now, demoAlmanac(now), farmers));
    assert.equal(f.demo, true);
    assert.ok(f.points > 0 && f.farmer && f.field && f.wait && f.fish && f.stamp, JSON.stringify(f).slice(0, 400));
    const iss = composeIssue(f);
    assert.ok(iss.stories.length >= 5, iss.stories.map((s) => s.id).join(','));
    assert.ok(iss.gossip.length >= 2);
    assert.ok(iss.classifieds.length >= 3);
    assert.ok(iss.editorial.body.length >= 3);
  }
  // the weather recap reads the same blocks as the sky
  assert.equal(blockKinds('2026-10-05').length, 8);
});
