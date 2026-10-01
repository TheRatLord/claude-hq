// @pure
/**
 * The Valley Almanac: what the agents have grown over the days. Every bit of real work the valley sees is a harvest —
 * a commit shipped, tests passing, a task finished, a question answered, a field tilled, ducklings hatched — and is
 * worth prosperity points. Points accumulate across sessions (the store is injected: browser-local in the app, memory
 * in tests) and lift the valley through named ranks; each rank unlocks a visible town upgrade.
 *
 * Pure: no DOM, no three, the clock is passed in. Days are local calendar days (`YYYY-MM-DD`).
 */

export const HARVEST_KINDS = Object.freeze(['commit', 'tests', 'finished', 'answered', 'tilled', 'ducklings'] as const);
export type HarvestKind = (typeof HARVEST_KINDS)[number];

/** points per harvest, and how many of each count toward points per day (busy test loops can't farm the almanac) */
export const HARVEST: Readonly<Record<HarvestKind, { points: number; cap: number; label: string; one: string }>> = Object.freeze({
  commit: { points: 10, cap: 60, label: 'commits shipped', one: 'commit' },
  tests: { points: 4, cap: 40, label: 'test runs passed', one: 'green test run' },
  finished: { points: 6, cap: 60, label: 'tasks finished', one: 'finished task' },
  answered: { points: 3, cap: 60, label: 'questions answered', one: 'answer' },
  tilled: { points: 5, cap: 12, label: 'fields tilled', one: 'new field' },
  ducklings: { points: 1, cap: 40, label: 'ducklings hatched', one: 'duckling' },
});

/** Town upgrades, one per rank above the first (the scene builds them; ids are stable). */
export const UPGRADES = Object.freeze([
  { id: 'bunting', title: 'Bunting over the square', blurb: 'Strings of pennants between the plaza lamps.' },
  { id: 'planters', title: 'Flower barrels', blurb: 'Barrels of flowers line the roads out of the square.' },
  { id: 'fountain', title: 'The fountain', blurb: 'A stone fountain bubbles beside the sundial.' },
  { id: 'market', title: 'Market stalls', blurb: 'Two striped stalls of produce open on the square.' },
  { id: 'lanterns', title: 'Festoon lanterns', blurb: 'Warm lanterns swing over the roads at night.' },
  { id: 'bandstand', title: 'The bandstand', blurb: 'A little bandstand with a weathervane, south of the square.' },
  { id: 'balloon', title: 'Hot-air balloon', blurb: 'A patchwork balloon floats over the south meadow.' },
  { id: 'statue', title: 'The Clawd statue', blurb: 'A golden Clawd on a plinth, for everyone who shipped.' },
  { id: 'fireworks', title: 'Evening fireworks', blurb: 'Fireworks over the valley every evening at nine.' },
] as const);
export type UpgradeId = (typeof UPGRADES)[number]['id'];

/** Ranks: `at` is the cumulative points needed. Rank i (> 0) unlocks UPGRADES[i - 1]. */
export const RANKS = Object.freeze([
  { at: 0, name: 'Homestead' },
  { at: 40, name: 'Smallholding' },
  { at: 130, name: 'Hamlet' },
  { at: 280, name: 'Village' },
  { at: 500, name: 'Market Village' },
  { at: 800, name: 'Market Town' },
  { at: 1200, name: 'Harvest Town' },
  { at: 1750, name: 'Festival Town' },
  { at: 2450, name: 'Valley of Plenty' },
  { at: 3300, name: 'Golden Valley' },
] as const);
/** past the last rank, a star per this many points */
export const STAR_POINTS = 1500;

export interface DayTally {
  /** local date YYYY-MM-DD */
  date: string;
  points: number;
  counts: Partial<Record<HarvestKind, number>>;
}

export interface AlmanacData {
  v: 1;
  points: number;
  /** most recent last; at most DAYS_KEPT */
  days: DayTally[];
  /** highest points in one day */
  best: number;
  /** ms epoch of the first harvest */
  since: number;
  /** the last day (YYYY-MM-DD) the Mayor posted an evening recap for */
  recap?: string;
}

export const DAYS_KEPT = 60;

export interface AlmanacView {
  points: number;
  /** 0-based rank index */
  rank: number;
  name: string;
  /** points where this rank / the next begins (next null at the top; then stars count on) */
  at: number;
  nextAt: number | null;
  nextName: string | null;
  /** 0..1 toward the next rank (or the next star) */
  progress: number;
  stars: number;
  today: DayTally;
  /** the last 7 days, oldest first (today last), zero-filled */
  week: { date: string; points: number }[];
  /** consecutive days, ending today or yesterday, with any harvest */
  streak: number;
  best: number;
  unlocked: UpgradeId[];
  /** the upgrade the next rank brings */
  next: (typeof UPGRADES)[number] | null;
  since: number;
}

export const emptyAlmanac = (): AlmanacData => ({ v: 1, points: 0, days: [], best: 0, since: 0 });

/** local calendar date of a ms epoch */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const DAY_MS = 86_400_000;
/** the date key `n` days before `key` (DST-safe: steps from local noon) */
function shiftDay(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d, 12).getTime() - n * DAY_MS);
}

export function rankAt(points: number): number {
  let r = 0;
  for (let i = 0; i < RANKS.length; i++) if (points >= RANKS[i].at) r = i;
  return r;
}

/** Tolerant parse of stored data (anything malformed → null, so a bad blob never breaks the valley). */
export function parseAlmanac(raw: unknown): AlmanacData | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1 || typeof o.points !== 'number' || !Number.isFinite(o.points) || !Array.isArray(o.days)) return null;
  const days: DayTally[] = [];
  for (const d of o.days) {
    if (!d || typeof d !== 'object') continue;
    const t = d as Record<string, unknown>;
    if (typeof t.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(t.date) || typeof t.points !== 'number') continue;
    const counts: DayTally['counts'] = {};
    if (t.counts && typeof t.counts === 'object') {
      for (const k of HARVEST_KINDS) {
        const v = (t.counts as Record<string, unknown>)[k];
        if (typeof v === 'number' && v > 0) counts[k] = Math.floor(v);
      }
    }
    days.push({ date: t.date, points: Math.max(0, t.points), counts });
  }
  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return {
    v: 1, points: Math.max(0, o.points), days: days.slice(-DAYS_KEPT),
    best: typeof o.best === 'number' ? Math.max(0, o.best) : Math.max(0, ...days.map((d) => d.points)),
    since: typeof o.since === 'number' ? o.since : 0,
    ...(typeof o.recap === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.recap) ? { recap: o.recap } : {}),
  };
}

/**
 * Record one harvest (mutates `data`). Returns the points it earned (0 once the day's cap for that kind is reached —
 * the count still goes up) and whether it lifted the valley into a new rank.
 */
export function recordHarvest(data: AlmanacData, kind: HarvestKind, nowMs: number): { earned: number; rankUp: boolean } {
  const key = dayKey(nowMs);
  let day = data.days[data.days.length - 1];
  if (!day || day.date !== key) {
    day = { date: key, points: 0, counts: {} };
    data.days.push(day);
    if (data.days.length > DAYS_KEPT) data.days.splice(0, data.days.length - DAYS_KEPT);
  }
  const h = HARVEST[kind];
  const n = (day.counts[kind] ?? 0) + 1;
  day.counts[kind] = n;
  const earned = n <= h.cap ? h.points : 0;
  const before = rankAt(data.points);
  data.points += earned;
  day.points += earned;
  data.best = Math.max(data.best, day.points);
  if (!data.since && earned) data.since = nowMs;
  return { earned, rankUp: rankAt(data.points) > before };
}

export function almanacView(data: AlmanacData, nowMs: number): AlmanacView {
  const key = dayKey(nowMs);
  const byDate = new Map(data.days.map((d) => [d.date, d]));
  const today = byDate.get(key) ?? { date: key, points: 0, counts: {} };
  const week = [];
  for (let i = 6; i >= 0; i--) { const k = shiftDay(key, i); week.push({ date: k, points: byDate.get(k)?.points ?? 0 }); }
  // streak: today counts if it has a harvest; otherwise start from yesterday (the day isn't over yet)
  let streak = 0;
  for (let i = (today.points > 0 ? 0 : 1); i < DAYS_KEPT; i++) {
    const d = byDate.get(shiftDay(key, i));
    if (!d || d.points <= 0) break;
    streak++;
  }
  const rank = rankAt(data.points);
  const top = rank === RANKS.length - 1;
  const at = RANKS[rank].at;
  const nextAt = top ? null : RANKS[rank + 1].at;
  const over = data.points - RANKS[RANKS.length - 1].at;
  const stars = top ? Math.floor(over / STAR_POINTS) : 0;
  const progress = top ? (over % STAR_POINTS) / STAR_POINTS : (data.points - at) / ((nextAt as number) - at);
  return {
    points: data.points, rank, name: RANKS[rank].name, at, nextAt, nextName: top ? null : RANKS[rank + 1].name,
    progress: Math.max(0, Math.min(1, progress)), stars, today, week, streak, best: data.best,
    unlocked: UPGRADES.slice(0, rank).map((u) => u.id),
    next: top ? null : UPGRADES[rank],
    since: data.since,
  };
}

/**
 * A demo almanac: a believable fortnight of harvests ending today, landing at `points` (the demo valley shows the
 * town mid-way up the ranks).
 */
export function demoAlmanac(nowMs: number, points = 1320): AlmanacData {
  const data = emptyAlmanac();
  const key = dayKey(nowMs);
  let left = points;
  for (let i = 13; i >= 1 && left > 0; i--) {
    const k = shiftDay(key, i);
    const weekend = [0, 6].includes(new Date(`${k}T12:00:00`).getDay());
    const pts = Math.min(left, weekend ? 20 + ((i * 37) % 30) : 70 + ((i * 53) % 90));
    const commits = Math.floor(pts / 30), tests = Math.floor(pts / 20), finished = Math.max(0, Math.floor((pts - commits * 10 - tests * 4) / 6));
    data.days.push({ date: k, points: pts, counts: { commit: commits, tests, finished } });
    left -= pts;
    data.best = Math.max(data.best, pts);
  }
  // whatever the fortnight doesn't cover was grown before the records start
  data.points = points;
  data.since = nowMs - (left > 0 ? 40 : 14) * DAY_MS;
  return data;
}

/** the evening hour (local) from which the Mayor posts the day's recap */
export const RECAP_HOUR = 18;

/** Is an evening recap due now (an evening with a harvest that hasn't been recapped yet)? */
export function recapDue(data: AlmanacData, nowMs: number): boolean {
  if (new Date(nowMs).getHours() < RECAP_HOUR) return false;
  const key = dayKey(nowMs);
  if (data.recap === key) return false;
  const today = data.days[data.days.length - 1];
  return !!today && today.date === key && today.points > 0;
}

const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The Mayor's evening letter: the day's harvest, any records, and how far to the next rank. */
export function recapLetter(v: AlmanacView): { title: string; body: string } {
  const c = v.today.counts;
  const bits: string[] = [];
  if (c.commit) bits.push(`shipped ${count(c.commit, 'commit', 'commits')}`);
  if (c.tests) bits.push(`passed ${count(c.tests, 'test run', 'test runs')}`);
  if (c.finished) bits.push(`finished ${count(c.finished, 'task', 'tasks')}`);
  if (c.answered) bits.push(`got ${count(c.answered, 'answer', 'answers')} from you`);
  if (c.tilled) bits.push(`tilled ${count(c.tilled, 'new field', 'new fields')}`);
  if (c.ducklings) bits.push(`hatched ${count(c.ducklings, 'duckling', 'ducklings')}`);
  const lines = [`Today the valley ${list(bits) || 'kept busy'}: ${v.today.points} prosperity in all.`];
  const cheers: string[] = [];
  if (v.today.points >= v.best && v.week.slice(0, -1).some((d) => d.points > 0)) cheers.push('That\'s our best day on record!');
  if (v.streak >= 3) cheers.push(`${v.streak} days in a row now.`);
  if (cheers.length) lines.push(cheers.join(' '));
  if (v.nextAt !== null && v.nextName) {
    const left = v.nextAt - v.points;
    lines.push(`We're ${left.toLocaleString('en-US')} short of ${v.nextName}${v.next ? `, and with it ${v.next.title.replace(/^The /, 'the ').replace(/^[A-Z](?=[a-z])/, (x) => x.toLowerCase())}` : ''}.`);
  } else lines.push(`${v.name} it is${v.stars ? `, with ${count(v.stars, 'star', 'stars')}` : ''}. Fireworks at nine!`);
  return { title: `Today's harvest: +${v.today.points} prosperity`, body: `${lines.join(' ')}\n\nYours, Mayor Marigold` };
}
