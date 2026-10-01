// @pure
/**
 * The valley calendar: real-date festivals. From the local date, `festivalAt(date)` says which festival is on (if any),
 * which day of it this is, and which one comes next and in how many days. Windows are fixed calendar dates (northern
 * hemisphere, like the seasons in sky.ts), may wrap the new year, and a short festival beats a long one it falls
 * inside (Founders' Day inside the Harvest Festival). The presentation decorates the valley from `deco`.
 *
 * A dev / screenshot override (`?festival=ID`, `__valley.festival(id)`) forces one festival on any date; the sky then
 * takes that festival's season unless the season is overridden too (sky.ts).
 */
import type { Season } from './types.ts';

export type FestivalId = 'blossom' | 'lantern' | 'founders' | 'harvest' | 'hallowtide' | 'starlight' | 'newyear';

/** What the scene builds for a festival (scene/structures/festivals.ts). */
export type Deco =
  | 'petals' | 'garlands' | 'maypole'
  | 'paperLanterns' | 'floatingLanterns'
  | 'bunting' | 'cake'
  | 'hay' | 'cornucopia' | 'prizePumpkin' | 'scarecrows'
  | 'jackOLanterns' | 'bats' | 'wisps'
  | 'stringLights' | 'starTree' | 'snowLanterns'
  | 'fireworks' | 'banner';

/** month 1..12, day 1..31 */
export type MonthDay = readonly [number, number];

export interface Festival {
  id: FestivalId;
  name: string;
  /** one line for posters and toasts */
  blurb: string;
  season: Season;
  /** inclusive window; `end` before `start` wraps into the next year */
  start: MonthDay;
  end: MonthDay;
  deco: readonly Deco[];
}

export const FESTIVALS: readonly Festival[] = [
  { id: 'blossom', name: 'Blossom Fair', season: 'spring', start: [4, 24], end: [5, 3],
    blurb: 'Cherry petals on the breeze, garlands round the square and a maypole to dance around.',
    deco: ['petals', 'garlands', 'maypole', 'banner'] },
  { id: 'lantern', name: 'Lantern Night', season: 'summer', start: [8, 10], end: [8, 16],
    blurb: 'Paper lanterns round the pond, and after dark the wishes float out on the water.',
    deco: ['paperLanterns', 'floatingLanterns', 'banner'] },
  { id: 'founders', name: "Founders' Day", season: 'autumn', start: [9, 28], end: [9, 28],
    blurb: 'The day the first field was tilled. Cake on the square, flags on every lamp.',
    deco: ['bunting', 'cake', 'banner'] },
  { id: 'harvest', name: 'Harvest Festival', season: 'autumn', start: [9, 22], end: [10, 14],
    blurb: 'Hay bales, a cornucopia, the giant pumpkin weigh-in and the scarecrow contest.',
    deco: ['hay', 'cornucopia', 'prizePumpkin', 'scarecrows', 'banner'] },
  { id: 'hallowtide', name: 'Hallowtide', season: 'autumn', start: [10, 24], end: [11, 1],
    blurb: "Jack-o'-lanterns grin along the roads, bats over the square, wisps by the water.",
    deco: ['jackOLanterns', 'bats', 'wisps', 'hay'] },
  { id: 'starlight', name: 'Starlight', season: 'winter', start: [12, 1], end: [12, 30],
    blurb: 'String lights over the square, a starlit tree, snow lanterns along the roads.',
    deco: ['stringLights', 'starTree', 'snowLanterns', 'banner'] },
  { id: 'newyear', name: 'New Year', season: 'winter', start: [12, 31], end: [1, 1],
    blurb: 'Lights up, glasses raised, fireworks over the meadow at midnight.',
    deco: ['stringLights', 'fireworks', 'banner'] },
];

export const festivalById = (id: string): Festival | undefined => FESTIVALS.find((f) => f.id === id);
export const isFestivalId = (id: unknown): id is FestivalId => typeof id === 'string' && FESTIVALS.some((f) => f.id === id);

export interface ActiveFestival {
  id: FestivalId;
  name: string;
  blurb: string;
  season: Season;
  deco: readonly Deco[];
  /** 1-based day of the festival, and its length in days */
  day: number;
  days: number;
  /** ISO local dates (YYYY-MM-DD) of this occurrence */
  start: string;
  end: string;
  /** forced by the dev override, not the calendar */
  forced: boolean;
}
export interface UpcomingFestival { id: FestivalId; name: string; blurb: string; /** ≥ 1 */ inDays: number; start: string }
export interface FestivalView { active: ActiveFestival | null; next: UpcomingFestival | null }

export const NO_FESTIVAL: FestivalView = Object.freeze({ active: null, next: null });

// ---- day numbers (local calendar dates, DST-proof) ----
const dayNum = (y: number, m: number, d: number): number => Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
const iso = (n: number): string => new Date(n * 86_400_000).toISOString().slice(0, 10);
const before = (a: MonthDay, b: MonthDay): boolean => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

/** the occurrence of `f` that starts in year `y`: [start, end] day numbers */
function occurrence(f: Festival, y: number): [number, number] {
  const s = dayNum(y, f.start[0], f.start[1]);
  const e = dayNum(before(f.end, f.start) ? y + 1 : y, f.end[0], f.end[1]);
  return [s, e];
}

function activeOf(f: Festival, s: number, e: number, today: number, forced: boolean): ActiveFestival {
  return {
    id: f.id, name: f.name, blurb: f.blurb, season: f.season, deco: f.deco,
    day: Math.min(e - s + 1, Math.max(1, today - s + 1)), days: e - s + 1, start: iso(s), end: iso(e), forced,
  };
}

/**
 * The festival on `date` (local calendar), and the next one to start. `force` (a festival id) makes that one active
 * whatever the date: its current occurrence if it is on, else the next one, as day 1.
 */
export function festivalAt(date: Date, force?: string | null): FestivalView {
  const y = date.getFullYear();
  const today = dayNum(y, date.getMonth() + 1, date.getDate());
  let active: ActiveFestival | null = null;
  let next: UpcomingFestival | null = null;
  for (const f of FESTIVALS) {
    for (const yy of [y - 1, y, y + 1]) {
      const [s, e] = occurrence(f, yy);
      if (today >= s && today <= e) {
        // the shorter festival wins a shared day
        if (!active || e - s + 1 < active.days) active = activeOf(f, s, e, today, false);
      } else if (s > today && (!next || s - today < next.inDays)) {
        next = { id: f.id, name: f.name, blurb: f.blurb, inDays: s - today, start: iso(s) };
      }
    }
  }
  const forced = force ? festivalById(force) : undefined;
  if (forced && active?.id !== forced.id) {
    let occ: [number, number] | null = null;
    for (const yy of [y - 1, y, y + 1]) {
      const o = occurrence(forced, yy);
      if (o[1] >= today && (!occ || o[0] < occ[0])) occ = o;
    }
    const [s, e] = occ ?? occurrence(forced, y);
    active = activeOf(forced, s, e, s, true);
  }
  // the next one is never the festival that is on now
  if (active && next?.id === active.id) {
    next = null;
    for (const f of FESTIVALS) {
      if (f.id === active.id) continue;
      for (const yy of [y - 1, y, y + 1]) {
        const [s] = occurrence(f, yy);
        if (s > today && (!next || s - today < next.inDays)) next = { id: f.id, name: f.name, blurb: f.blurb, inDays: s - today, start: iso(s) };
      }
    }
  }
  return { active, next };
}

/** "today" / "tomorrow" / "in 5 days" */
export const inDaysText = (n: number): string => (n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);

/** "Day 3 of 23" / "Last day!" / "Today only" for posters */
export function dayText(a: ActiveFestival): string {
  if (a.days === 1) return 'Today only';
  if (a.day === a.days) return 'Last day!';
  return `Day ${a.day} of ${a.days}`;
}

/** Near enough to talk about (villagers, the noticeboard). */
export const SOON_DAYS = 14;
