// @pure
/**
 * Evening gatherings: the shared moments that make the valley a community (scene/gather runs them).
 *
 *  - **Campfire evenings** (most dry evenings, ≈ 19:30–22:00): idle / finished farmers and off-duty villagers sit round
 *    the fire; the evening runs in a cycle of story → laughter → marshmallows → sing-along → chatter, and the story is
 *    told from what the valley actually did today (ValleyState: commits shipped, test runs, finished jobs, a farmer's
 *    planted files, a stubborn bug…).
 *  - **Bandstand concert** (once the bandstand is built; weekend and festival evenings ≈ 18:30–20:15, before the
 *    campfire): a few farmers play fiddle, banjo and flute on the stage, the villagers dance and clap.
 *  - **Market morning** (Saturday mornings once the market stalls are up): the villagers browse the stalls in turns.
 *
 * Who may attend: only farmers with nothing on (idle, or done and waiting for you): a farmer who needs you still runs
 * to its gate and working farmers keep working. Pure: no three, no clock (hours / seconds are passed in), deterministic
 * per real date so every window agrees.
 */
import type { FarmerView, Job, ValleyState, WeatherKind } from './types.ts';

export type GatherKind = 'campfire' | 'concert' | 'market';
export const GATHER_KINDS: readonly GatherKind[] = ['campfire', 'concert', 'market'];

export interface GatherIn {
  /** local fractional hour */
  hour: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
  dayOfYear: number;
  weather: WeatherKind;
  /** 0..1 */
  intensity: number;
  /** today's festival id, if any */
  festival: string | null;
  /** town upgrades built so far (model/almanac.ts UpgradeId) */
  unlocked: readonly string[];
}

export interface GatherWindow { kind: GatherKind; from: number; to: number }
export interface Gathering extends GatherWindow { forced: boolean }

/** deterministic 0..1 */
export const hashG = (a: number, b: number): number => { const v = Math.sin(a * 91.3458 + b * 47.123) * 24634.6345; return v - Math.floor(v); };

/** Too wet / wild for an outdoor gathering (light snow round a fire is fine). */
export function tooWet(kind: GatherKind, weather: WeatherKind, intensity: number): boolean {
  if (weather === 'storm') return true;
  if (weather === 'rain') return intensity > (kind === 'market' ? 0.6 : 0.15);
  if (weather === 'snow') return intensity > (kind === 'campfire' ? 0.55 : 0.35);
  return false;
}

/** Share of evenings the campfire is lit (the odd evening everyone has an early night). */
export const CAMPFIRE_NIGHTS = 0.86;

/** Today's gathering windows (hours, local), in time order; weather is checked separately (`gatheringAt`). */
export function scheduleFor(i: Omit<GatherIn, 'hour' | 'weather' | 'intensity'>): GatherWindow[] {
  const out: GatherWindow[] = [];
  const j = (salt: number) => (hashG(i.dayOfYear, salt) - 0.5) * 0.3;
  if (i.unlocked.includes('market') && i.weekday === 6) out.push({ kind: 'market', from: 8 + j(3) * 0.5, to: 11.5 + j(4) * 0.5 });
  let fireFrom = 19.5 + j(1);
  if (i.unlocked.includes('bandstand') && (i.weekday === 0 || i.weekday === 6 || !!i.festival)) {
    const c = { kind: 'concert' as const, from: 18.5 + j(5) * 0.5, to: 20.25 + j(6) * 0.5 };
    out.push(c);
    // the band packs up and everyone strolls over to the fire
    fireFrom = Math.max(fireFrom, c.to + 0.2);
  }
  if (hashG(i.dayOfYear, 9) < CAMPFIRE_NIGHTS || i.festival) out.push({ kind: 'campfire', from: fireFrom, to: 22 + j(2) });
  return out;
}

/** The gathering on now (or null). `force` (dev / shots) puts one on regardless of the hour, the weather or the upgrades. */
export function gatheringAt(i: GatherIn, force: GatherKind | null = null): Gathering | null {
  if (force) return { kind: force, from: i.hour - 0.01, to: i.hour + 2.5, forced: true };
  for (const w of scheduleFor(i)) {
    if (i.hour < w.from || i.hour >= w.to) continue;
    if (tooWet(w.kind, i.weather, i.intensity)) return null;
    return { ...w, forced: false };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Who comes

/** Only farmers with nothing on: idle, or finished (their ✓ still shows). Never one that needs you. */
export const canAttend = (f: Pick<FarmerView, 'job' | 'needsYou'>): boolean => !f.needsYou && (f.job === 'idle' || f.job === 'done');
export const ATTEND_JOBS: readonly Job[] = ['idle', 'done'];

/**
 * Does a villager come? Campfire and concert: when their day plan says it's their evening off (`slot` 'evening'), most
 * evenings (`regular` villagers whose evening spot is the fire always do). Market: a ~40 min browse at a seeded time in
 * the morning, while they're out and about (not at home, not sheltering).
 */
export function villagerAttends(kind: GatherKind, o: { slot: string; key: number; dayOfYear: number; hour: number; from: number; to: number; regular?: boolean; forced?: boolean }): boolean {
  if (kind === 'market') {
    if (o.slot === 'home' || o.slot === 'shelter') return false;
    if (o.forced) return true;
    const span = Math.max(0.5, o.to - o.from - 0.7);
    const start = o.from + 0.1 + hashG(o.key, o.dayOfYear + 0.5) * span;
    return o.hour >= start && o.hour < start + 0.7;
  }
  if (o.slot !== 'evening') return false;
  return !!o.regular || !!o.forced || hashG(o.key, o.dayOfYear) < 0.78;
}

// ---------------------------------------------------------------------------------------------------------------
// The shape of an evening (on the wall clock in seconds, so every window agrees)

export type CampfireSeg = 'story' | 'laugh' | 'toast' | 'sing' | 'chat';
export const CAMPFIRE_CYCLE: readonly (readonly [CampfireSeg, number])[] = [['story', 84], ['laugh', 12], ['toast', 40], ['sing', 80], ['chat', 30]];
export const CAMPFIRE_PERIOD = CAMPFIRE_CYCLE.reduce((s, [, d]) => s + d, 0);
/** seconds per told line (the bubble shows for most of it) */
export const STORY_LINE_S = 10.5;

export interface SegAt<S extends string> { seg: S; cycle: number; /** seconds into the segment */ t: number; len: number }

/** Where the campfire evening is at clock second `s`. */
export function campfireSeg(s: number, out: SegAt<CampfireSeg> = { seg: 'story', cycle: 0, t: 0, len: 0 }): SegAt<CampfireSeg> {
  const cycle = Math.floor(s / CAMPFIRE_PERIOD);
  let r = s - cycle * CAMPFIRE_PERIOD;
  out.cycle = cycle;
  for (const [seg, d] of CAMPFIRE_CYCLE) {
    if (r < d) { out.seg = seg; out.t = r; out.len = d; return out; }
    r -= d;
  }
  out.seg = 'chat'; out.t = 0; out.len = 0;
  return out;
}

export type ConcertSeg = 'play' | 'applause';
/** clock fallback when the music isn't running (muted, locked audio): a song, then a round of applause */
export const SONG_S = 96, APPLAUSE_S = 9;
export function concertSeg(s: number, out: SegAt<ConcertSeg> = { seg: 'play', cycle: 0, t: 0, len: 0 }): SegAt<ConcertSeg> {
  const p = SONG_S + APPLAUSE_S, cycle = Math.floor(s / p), r = s - cycle * p;
  out.cycle = cycle;
  if (r < SONG_S) { out.seg = 'play'; out.t = r; out.len = SONG_S; } else { out.seg = 'applause'; out.t = r - SONG_S; out.len = APPLAUSE_S; }
  return out;
}

/** Which of `n` sitters tells this cycle's story (deterministic per cycle). */
export const tellerOf = (cycle: number, n: number): number => (n <= 0 ? -1 : Math.floor(hashG(cycle, 2.5) * n) % n);

// ---------------------------------------------------------------------------------------------------------------
// Stories round the fire: light-hearted lines from what the valley did today

export interface StoryFarmer {
  tag: string;
  job: Job;
  files: number;
  added: number;
  struggle: number;
  title: string | null;
  todos: { done: number; total: number } | null;
}
export interface StoryIn {
  /** who tells it (a farmer's tag or a villager's name) */
  teller: string;
  /** the teller's own farmer tag, if a farmer tells it (lines about itself go first person) */
  self: string | null;
  farmers: StoryFarmer[];
  commits: number;
  /** today's harvest counts (model/almanac.ts kinds) */
  counts: Readonly<Partial<Record<string, number>>>;
  streak: number;
  nextName: string | null;
  toNext: number | null;
  season: string;
  festival: string | null;
}

/** Gather the story material from the valley (ValleyState only: what the model already shows). */
export function storyIn(v: Pick<ValleyState, 'farmers' | 'commitsToday' | 'almanac' | 'sky'>, teller: string, self: string | null): StoryIn {
  const farmers: StoryFarmer[] = [];
  for (const f of v.farmers.values()) farmers.push({
    tag: f.tag, job: f.job, files: f.work?.files ?? 0, added: f.work?.added ?? 0, struggle: f.struggle, title: f.title,
    todos: f.todos ? { done: f.todos.done, total: f.todos.total } : null,
  });
  farmers.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const a = v.almanac;
  return {
    teller, self, farmers, commits: v.commitsToday, counts: a?.today?.counts ?? {}, streak: a?.streak ?? 0,
    nextName: a?.nextName ?? null, toNext: a && a.nextAt !== null ? Math.max(0, a.nextAt - a.points) : null,
    season: v.sky.season, festival: v.sky.festival?.active?.name ?? null,
  };
}

const short = (s: string, n = 34): string => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Valley tall tales for quiet days (and to round a story off). */
export const TALES: readonly string[] = [
  'They say the old windmill once spun so fast it ground the flour twice.',
  'Nimbus swears a cloud shaped like a semicolon hung over the pond all afternoon.',
  'Biscuit chased a duckling, the duckling chased Biscuit back. Nobody won.',
  'Fern found a mushroom ring by the stones. Shh, don\'t tell the moles.',
  'Bram once stacked crates so high the pigeons used them as a lookout.',
  'Hazel claims the mill cat can tell a good harvest by the smell of the flour.',
  'Did you hear? The scarecrow by the barn got two votes in the scarecrow contest. Both his own.',
  'Mayor Marigold practised her speech to the sheep. They gave a standing ovation.',
  'Once a farmer planted a single semicolon and a whole hedge of brackets came up.',
  'Posy says one letter took the long way round, by the waterfall. It came back damp and very pleased.',
];
const SEASON_TALES: Readonly<Record<string, string>> = {
  spring: 'The blossom\'s out in the orchard. Even the bees look smug about it.',
  summer: 'Warm enough to fish till midnight. The pike are not amused.',
  autumn: 'The pumpkins are getting ideas above their station. One of them winked at me.',
  winter: 'Cold enough that my breath froze into a little cloud. Nimbus wants to study it.',
};

/**
 * The lines told round the fire (≤ `max`), deterministic in `seed`: news of the day first (shuffled), then a tall tale
 * or two. Lines about the teller's own farmer are in the first person.
 */
export function storyLines(s: StoryIn, seed: number, max = 7): string[] {
  const news: string[] = [];
  const who = (tag: string) => (tag === s.self ? 'I' : tag);
  const c = s.counts;
  if (s.commits > 0) news.push(s.commits >= 3 ? `${plural(s.commits, 'crate', 'crates')} shipped today! Bram had to fetch more crates.` : `We shipped ${plural(s.commits, 'crate', 'crates')} today. Bram rang the bell twice for luck.`);
  if ((c.tests ?? 0) > 0) news.push(`${plural(c.tests!, 'green test run', 'green test runs')} today. The sprouts are standing to attention!`);
  if ((c.finished ?? 0) > 0) news.push(`${plural(c.finished!, 'job', 'jobs')} finished today. Somebody put the kettle on!`);
  if ((c.answered ?? 0) > 0) news.push(`And you answered ${plural(c.answered!, 'question', 'questions')} for us today. Thank you, neighbour!`);
  if ((c.ducklings ?? 0) > 0) news.push(`${plural(c.ducklings!, 'duckling', 'ducklings')} hatched today. They're all asleep at the pond now.`);
  if ((c.tilled ?? 0) > 0) news.push(`A new field was tilled today. Fresh soil smells like possibility.`);
  if (s.streak >= 3) news.push(`That's ${s.streak} good days in a row. The almanac is running out of gold stars.`);
  if (s.nextName && s.toNext !== null && s.toNext > 0 && s.toNext < 400) news.push(`Only ${s.toNext} prosperity to ${s.nextName}. We'll get there!`);
  if (s.festival) news.push(`Happy ${s.festival}, everyone! Best time of the year, I always say.`);
  for (const f of s.farmers) {
    const w = who(f.tag), me = w === 'I';
    if (f.struggle >= 2) news.push(me ? 'I wrestled a stubborn bug for ages today… I think the bug is more tired than I am.' : `${w} wrestled a stubborn bug for ages… the bug is getting tired!`);
    else if (f.files >= 3) news.push(`${w} planted ${f.files} files today. ${me ? 'My' : 'The'} rows are bristling!`);
    if (f.added >= 120) news.push(`${w} wrote ${f.added} lines today. That's a lot of furrows.`);
    if (f.job === 'done' && f.title) news.push(`${w} finished "${short(f.title)}". Proper job!`);
    else if (f.todos && f.todos.total >= 3 && f.todos.done >= 2) news.push(`${w} ticked off ${f.todos.done} of ${f.todos.total} things on ${me ? 'my' : 'the'} list.`);
  }
  // deterministic shuffle of the news, then tall tales to round it off
  const r = (i: number) => hashG(seed + i * 0.731, 4.4);
  const shuffled = news.map((l, i) => ({ l, k: r(i) })).sort((a, b) => a.k - b.k).map((x) => x.l);
  const out = shuffled.slice(0, Math.max(0, max - 1));
  const tales = [SEASON_TALES[s.season], ...TALES].filter(Boolean) as string[];
  const start = Math.floor(r(97) * tales.length);
  for (let i = 0; out.length < max && i < tales.length; i++) {
    out.push(tales[(start + i) % tales.length]);
    if (out.length >= Math.min(max, shuffled.length + 2)) break;
  }
  return out;
}

/** The line told `s` seconds into the story (null between lines: a beat to breathe). */
export function lineAt(lines: readonly string[], s: number): string | null {
  if (!lines.length || s < 0) return null;
  const i = Math.floor(s / STORY_LINE_S);
  if (i >= lines.length) return null;
  return s - i * STORY_LINE_S < STORY_LINE_S - 1.6 ? lines[i] : null;
}
