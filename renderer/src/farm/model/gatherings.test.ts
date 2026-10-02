import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMPFIRE_PERIOD, STORY_LINE_S, campfireSeg, canAttend, concertSeg, gatheringAt, lineAt, scheduleFor, storyIn, storyLines, tellerOf, tooWet, villagerAttends,
} from './gatherings.ts';
import type { GatherIn, StoryIn } from './gatherings.ts';

const base: GatherIn = { hour: 20.5, weekday: 3, dayOfYear: 200, weather: 'clear', intensity: 0, festival: null, unlocked: [] };
/** a day of the year with the campfire lit (most are) */
const litDay = (() => { for (let d = 1; d < 366; d++) if (scheduleFor({ ...base, dayOfYear: d }).some((w) => w.kind === 'campfire')) return d; return 1; })();

test('most clear evenings have a campfire, about 19:30 to 22:00', () => {
  let lit = 0;
  for (let d = 1; d <= 365; d++) {
    const w = scheduleFor({ ...base, dayOfYear: d }).find((x) => x.kind === 'campfire');
    if (!w) continue;
    lit++;
    assert.ok(w.from > 19.3 && w.from < 19.7 && w.to > 21.8 && w.to < 22.2, `day ${d}: ${w.from}–${w.to}`);
  }
  assert.ok(lit > 280 && lit < 365, `${lit} campfire evenings a year`);
  assert.equal(gatheringAt({ ...base, dayOfYear: litDay })?.kind, 'campfire');
  assert.equal(gatheringAt({ ...base, dayOfYear: litDay, hour: 17 }), null);
  assert.equal(gatheringAt({ ...base, dayOfYear: litDay, hour: 23 }), null);
});

test('rain and storms cancel; light snow round a fire is fine', () => {
  const at = (weather: GatherIn['weather'], intensity: number) => gatheringAt({ ...base, dayOfYear: litDay, weather, intensity });
  assert.equal(at('rain', 0.6), null);
  assert.equal(at('storm', 0.3), null);
  assert.equal(at('snow', 0.3)?.kind, 'campfire');
  assert.equal(at('fog', 0.8)?.kind, 'campfire');
  assert.ok(tooWet('concert', 'snow', 0.5) && !tooWet('campfire', 'snow', 0.5));
});

test('the bandstand plays weekend and festival evenings, then everyone goes to the fire', () => {
  const sat = { ...base, weekday: 6, dayOfYear: litDay, unlocked: ['bandstand'] };
  const day = scheduleFor(sat);
  const c = day.find((w) => w.kind === 'concert')!, f = day.find((w) => w.kind === 'campfire')!;
  assert.ok(c && f && c.to <= f.from, 'concert before the campfire');
  assert.equal(gatheringAt({ ...sat, hour: 19 })?.kind, 'concert');
  assert.equal(gatheringAt({ ...sat, hour: 21.5 })?.kind, 'campfire');
  // a weekday: only with a festival on; never without the bandstand
  assert.equal(scheduleFor({ ...sat, weekday: 2 }).some((w) => w.kind === 'concert'), false);
  assert.equal(scheduleFor({ ...sat, weekday: 2, festival: 'harvest' }).some((w) => w.kind === 'concert'), true);
  assert.equal(scheduleFor({ ...sat, unlocked: [] }).some((w) => w.kind === 'concert'), false);
});

test('market mornings are Saturdays with the stalls up', () => {
  const sat = { ...base, weekday: 6, hour: 9.5, unlocked: ['market'] };
  assert.equal(gatheringAt(sat)?.kind, 'market');
  assert.equal(gatheringAt({ ...sat, weekday: 5 }), null);
  assert.equal(gatheringAt({ ...sat, unlocked: [] }), null);
  assert.equal(gatheringAt({ ...sat, weather: 'rain', intensity: 0.3 })?.kind, 'market', 'a drizzle does not close the market');
});

test('a forced gathering ignores the hour, weather and upgrades', () => {
  const g = gatheringAt({ ...base, hour: 11, weather: 'storm', intensity: 1 }, 'concert');
  assert.equal(g?.kind, 'concert');
  assert.ok(g!.forced && g!.from <= 11 && g!.to > 11);
});

test('only farmers with nothing on attend; one that needs you never does', () => {
  assert.ok(canAttend({ job: 'idle', needsYou: false }));
  assert.ok(canAttend({ job: 'done', needsYou: false }));
  assert.ok(!canAttend({ job: 'ask', needsYou: true }));
  assert.ok(!canAttend({ job: 'idle', needsYou: true }));
  for (const job of ['plant', 'water', 'build', 'inspect', 'away', 'haul'] as const) assert.ok(!canAttend({ job, needsYou: false }), job);
});

test('villagers come on their evening off; market browsing is a short visit', () => {
  const o = { key: 123, dayOfYear: 5, hour: 20, from: 19.5, to: 22 };
  assert.equal(villagerAttends('campfire', { ...o, slot: 'post' }), false);
  assert.equal(villagerAttends('campfire', { ...o, slot: 'evening', regular: true }), true);
  let come = 0;
  for (let k = 0; k < 200; k++) if (villagerAttends('campfire', { ...o, key: k * 37, slot: 'evening' })) come++;
  assert.ok(come > 120 && come < 190, `${come}/200 villager-evenings`);
  // market: about 40 minutes inside the window, never from home
  let hours = 0;
  for (let h = 8; h < 11.5; h += 0.05) if (villagerAttends('market', { ...o, hour: h, from: 8, to: 11.5, slot: 'post' })) hours += 0.05;
  assert.ok(hours > 0.5 && hours < 0.8, `${hours.toFixed(2)} h browsing`);
  assert.equal(villagerAttends('market', { ...o, hour: 9, from: 8, to: 11.5, slot: 'home', forced: true }), false);
});

test('the campfire evening cycles story, laughter, marshmallows, a sing-along', () => {
  const segs = new Set<string>();
  let sing = 0;
  for (let s = 0; s < CAMPFIRE_PERIOD; s++) { const x = campfireSeg(s); segs.add(x.seg); if (x.seg === 'sing') sing++; assert.ok(x.t >= 0 && x.t < x.len); }
  assert.deepEqual([...segs].sort(), ['chat', 'laugh', 'sing', 'story', 'toast']);
  assert.ok(sing >= 60, 'a sing-along long enough for a song');
  assert.equal(campfireSeg(0).seg, 'story');
  assert.equal(campfireSeg(CAMPFIRE_PERIOD + 1).cycle, 1);
  assert.equal(concertSeg(10).seg, 'play');
  assert.equal(concertSeg(100).seg, 'applause');
  const tellers = new Set<number>();
  for (let c = 0; c < 40; c++) { const t = tellerOf(c, 5); assert.ok(t >= 0 && t < 5); tellers.add(t); }
  assert.ok(tellers.size >= 4, 'the story goes round');
  assert.equal(tellerOf(3, 0), -1);
});

const story = (o: Partial<StoryIn> = {}): StoryIn => ({
  teller: 'Fern', self: null, farmers: [], commits: 0, counts: {}, streak: 0, nextName: null, toNext: null, season: 'autumn', festival: null, ...o,
});

test('stories come from the valley\'s day, deterministic, in the first person for the teller', () => {
  const s = story({
    commits: 3, counts: { tests: 4, finished: 1 },
    farmers: [
      { tag: 'flint', job: 'idle', files: 7, added: 10, struggle: 0, title: null, todos: null },
      { tag: 'gale', job: 'done', files: 0, added: 0, struggle: 2, title: 'Fix the flaky login test once and for all please', todos: null },
    ],
  });
  const a = storyLines(s, 11), b = storyLines(s, 11);
  assert.deepEqual(a, b);
  assert.ok(a.length >= 5 && a.length <= 7);
  const all = storyLines(s, 11, 20).join('\n');
  assert.match(all, /3 crates shipped today/);
  assert.match(all, /4 green test runs/);
  assert.match(all, /flint planted 7 files/);
  assert.match(all, /gale wrestled a stubborn bug/);
  assert.match(all, /gale finished "Fix the flaky login test once and…"/);
  assert.ok(a.every((l) => l.length < 140));
  const mine = storyLines({ ...s, self: 'flint' }, 11, 20).join('\n');
  assert.match(mine, /I planted 7 files today\. My rows/);
  assert.doesNotMatch(mine, /flint planted/);
  // a quiet day still has a tale or two
  const quiet = storyLines(story(), 3);
  assert.ok(quiet.length >= 1 && quiet.length <= 2);
});

test('storyIn reads ValleyState only', () => {
  const f = { tag: 'flint', job: 'idle', work: { added: 5, removed: 0, files: 4 }, struggle: 0, title: null, todos: null };
  const v = {
    farmers: new Map([['p1', f]]), commitsToday: 2,
    almanac: { today: { counts: { tests: 1 } }, streak: 4, nextName: 'Hamlet', nextAt: 130, points: 100 },
    sky: { season: 'spring', festival: { active: null, next: null } },
  } as unknown as Parameters<typeof storyIn>[0];
  const s = storyIn(v, 'Posy', null);
  assert.equal(s.commits, 2);
  assert.equal(s.toNext, 30);
  assert.equal(s.farmers[0].files, 4);
  assert.match(storyLines(s, 1, 20).join('\n'), /Only 30 prosperity to Hamlet/);
});

test('one line at a time, with a breath between', () => {
  const lines = ['a', 'b'];
  assert.equal(lineAt(lines, 0.5), 'a');
  assert.equal(lineAt(lines, STORY_LINE_S - 0.5), null);
  assert.equal(lineAt(lines, STORY_LINE_S + 1), 'b');
  assert.equal(lineAt(lines, STORY_LINE_S * 2 + 1), null);
  assert.equal(lineAt([], 1), null);
});
