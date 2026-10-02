// @pure
/**
 * The Valley Gazette: a little newspaper made only from what really happened. Every Monday morning (or on the first
 * visit of a new week) the post brings the weekly edition about the week just gone; any day the noticeboard has the
 * morning edition about the last seven days.
 *
 * Three steps, all pure:
 *  1. **gather** (`gatherFacts`): the week's numbers out of the Almanac (per-day harvest counts, ranks, streaks), the
 *     timeline's weekly roll-up (active time per farmer and field, asks and how long they waited), the sky's real
 *     3-hour weather blocks (a recap, and since they are deterministic, a true forecast), the festival calendar, the
 *     stamp book and the Gazette's own little journal of the player's week (`GzNote`: gifts, requests, hearts, catches,
 *     first finds). The result, `WeekFacts`, is small plain data.
 *  2. **compose** (`composeIssue`): facts → a page (headlines, stories, gossip, classifieds, the Mayor's editorial),
 *     with templated copy seeded per issue so every week reads fresh, and only ever stating the facts.
 *  3. **keep** (`createGazette`): the journal and the last `ISSUES_KEPT` weekly issues as facts (recomposed on reading),
 *     persisted through an injected store (browser-local in the app, memory in the demo and tests).
 *
 * The demo valley gets a believable week from its seeded history (`demoInput`: demoAlmanac + demoDay per farmer).
 */
import { hash32, mulberry32 } from '../../../../shared/identity.ts';
import { HARVEST_KINDS, RANKS, UPGRADES, dayKey, rankAt } from './almanac.ts';
import type { AlmanacData, HarvestKind } from './almanac.ts';
import { ROLL_DAYS, daysBetween, demoDay, rollDay } from './timeline.ts';
import type { DayRoll, FarmerDay } from './timeline.ts';
import { blockKinds, seasonOf } from './sky.ts';
import { festivalAt } from './calendar.ts';
import { friendDef } from './friends.ts';
import type { Tier } from './friends.ts';
import { collectDef } from './collection.ts';
import { stampDef } from './stamps.ts';
import type { Season, WeatherKind } from './types.ts';

// ---------------------------------------------------------------------------------------------
// dates (local calendar keys, DST-proof: step from local noon)

const DAY_MS = 86_400_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const noonOf = (key: string): Date => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d, 12); };
/** the date key `n` days after `key` (negative: before) */
export const addDays = (key: string, n: number): string => dayKey(noonOf(key).getTime() + n * DAY_MS);
/** 0 = Monday … 6 = Sunday */
export const weekdayOf = (key: string): number => (noonOf(key).getDay() + 6) % 7;
/** the Monday on or before `key`: the week's key */
export const weekOf = (key: string): string => addDays(key, -weekdayOf(key));
const inRange = (k: string, from: string, to: string) => k >= from && k <= to;

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const weekdayName = (key: string): string => WEEKDAYS[weekdayOf(key)];
/** "Monday 5 October 2026" */
export function longDate(key: string): string { const d = noonOf(key); return `${weekdayName(key)} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; }
/** "5 Oct" */
export function shortDate(key: string): string { const d = noonOf(key); return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`; }

/** "6 h 20 min", "45 min", "under a minute" */
export function duration(ms: number): string {
  if (!(ms >= 60_000)) return 'under a minute';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r && h < 10 ? `${h} h ${r} min` : `${h} h`;
}

// ---------------------------------------------------------------------------------------------
// the journal: the player's week, noted as it happens

export type GzNote =
  | { k: 'gift'; at: number; who: string; item: string; tier: Tier }
  | { k: 'request'; at: number; who: string }
  | { k: 'hearts'; at: number; who: string; n: number }
  | { k: 'catch'; at: number; item: string; cm: number }
  | { k: 'find'; at: number; item: string };
export type GzNoteKind = GzNote['k'];

export const NOTES_MAX = 120;
/** notes older than this many days are dropped (a week plus the slack of a late delivery) */
export const NOTE_DAYS = 9;
export const ISSUES_KEPT = 8;

const TIERS: readonly Tier[] = ['love', 'like', 'neutral', 'dislike'];
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const word = (v: unknown, n = 40): string | null => (typeof v === 'string' && v && v.length <= n ? v : null);

export function parseNote(raw: unknown): GzNote | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!finite(o.at) || o.at <= 0) return null;
  const at = o.at;
  switch (o.k) {
    case 'gift': { const who = word(o.who), item = word(o.item); return who && item && TIERS.includes(o.tier as Tier) ? { k: 'gift', at, who, item, tier: o.tier as Tier } : null; }
    case 'request': { const who = word(o.who); return who ? { k: 'request', at, who } : null; }
    case 'hearts': { const who = word(o.who); return who && finite(o.n) ? { k: 'hearts', at, who, n: Math.max(0, Math.min(10, Math.round(o.n))) } : null; }
    case 'catch': { const item = word(o.item); return item && finite(o.cm) ? { k: 'catch', at, item, cm: Math.max(0, Math.min(999, Math.round(o.cm))) } : null; }
    case 'find': { const item = word(o.item); return item ? { k: 'find', at, item } : null; }
    default: return null;
  }
}

// ---------------------------------------------------------------------------------------------
// facts

export type EditionKind = 'weekly' | 'daily';

export interface DayFacts { date: string; points: number; weather: WeatherKind; /** daytime blocks of rain, storm or snow (0..5) */ wet: number }
export interface WeekFacts {
  v: 1;
  kind: EditionKind;
  no: number;
  /** the issue's date, and the days it covers (inclusive) */
  date: string;
  from: string;
  to: string;
  demo: boolean;
  harvest: Partial<Record<HarvestKind, number>>;
  points: number;
  days: DayFacts[];
  bestDay: { date: string; points: number } | null;
  /** the best day beat every earlier day on record */
  record: boolean;
  streak: number;
  /** the streak is the longest on record (and at least 3) */
  streakBest: boolean;
  rank: string;
  /** the rank at the start of the covered days, when it changed */
  rankFrom: string | null;
  next: { name: string; left: number } | null;
  /** average wait for you over the answered asks (ms) */
  wait: { avg: number; n: number } | null;
  /** ms of active work, every farmer; distinct farmers seen */
  active: number;
  farmers: number;
  field: { tag: string; active: number; share: number } | null;
  farmer: { name: string; tag: string; active: number; ships: number; days: number } | null;
  /** the most commits, when someone else than the hardest worker */
  shipper: { name: string; tag: string; ships: number } | null;
  /** red test runs over the days (the green ones are harvest.tests) */
  fails: number;
  forecast: { date: string; weather: WeatherKind }[];
  festival: { id: string; name: string; blurb: string; day: number; days: number } | null;
  upcoming: { id: string; name: string; blurb: string; inDays: number; start: string } | null;
  season: Season;
  /** the player's week, the most newsworthy first (≤ 10) */
  notes: GzNote[];
  stamp: { id: string; at: number } | null;
  stamps: number;
  fish: { item: string; cm: number } | null;
  catches: number;
  finds: string[];
}

export interface GazetteInput {
  kind: EditionKind;
  now: number;
  almanac: Readonly<AlmanacData>;
  /** the timeline's weekly roll-up (the days before today) */
  past: readonly DayRoll[];
  /** today so far (rollDay of the live timeline); counted by the morning edition */
  today?: DayRoll | null;
  /** the stamp book's earned stamps: id → when (ms) */
  stamps?: Readonly<Record<string, number>>;
  notes: readonly GzNote[];
  demo?: boolean;
}

/** The days an edition covers: the weekly the Monday-to-Sunday week before `date`'s, the morning edition the last seven days. */
export function rangeOf(kind: EditionKind, date: string): { from: string; to: string } {
  if (kind === 'weekly') { const mon = weekOf(date); return { from: addDays(mon, -7), to: addDays(mon, -1) }; }
  return { from: addDays(date, -6), to: date };
}

/** Issue number: weeks since the valley's first harvest (No. 1 is that week). */
export function issueNo(since: number, date: string): number {
  if (!finite(since) || since <= 0) return 1;
  return Math.max(1, Math.floor(daysBetween(weekOf(dayKey(since)), weekOf(date)) / 7) + 1);
}

const WET: ReadonlySet<WeatherKind> = new Set<WeatherKind>(['rain', 'storm', 'snow']);
/** ties go to the more newsworthy weather */
const NEWSY: readonly WeatherKind[] = ['storm', 'snow', 'rain', 'fog', 'cloudy', 'clear'];
/** A day's weather in a word: any storm in the daytime blocks (06–21 h), else the most common kind. */
export function dayWeather(date: string): { weather: WeatherKind; wet: number } {
  const day = blockKinds(date).slice(2, 7);
  const wet = day.filter((k) => WET.has(k)).length;
  if (day.includes('storm')) return { weather: 'storm', wet };
  const n = new Map<WeatherKind, number>();
  for (const k of day) n.set(k, (n.get(k) ?? 0) + 1);
  let best: WeatherKind = 'clear', bv = -1;
  for (const k of NEWSY) { const v = n.get(k) ?? 0; if (v > bv) { bv = v; best = k; } }
  return { weather: best, wet };
}

/** the field (project) of an in-world tag: 'infra·onyx' → 'infra' (twins share a field) */
export const fieldOf = (tag: string): string => tag.split('·')[0] || tag;

const NOTE_RANK: Readonly<Record<GzNoteKind, number>> = { hearts: 5, gift: 4, request: 3, find: 2, catch: 1 };

export function gatherFacts(inp: GazetteInput): WeekFacts {
  const date = dayKey(inp.now);
  const { from, to } = rangeOf(inp.kind, date);
  const al = inp.almanac;
  const byDate = new Map(al.days.map((d) => [d.date, d]));
  // ---- the Almanac
  const harvest: Partial<Record<HarvestKind, number>> = {};
  let points = 0;
  const days: DayFacts[] = [];
  let bestDay: WeekFacts['bestDay'] = null;
  for (let k = from; k <= to; k = addDays(k, 1)) {
    const t = byDate.get(k);
    const p = t?.points ?? 0;
    points += p;
    for (const h of HARVEST_KINDS) { const c = t?.counts[h] ?? 0; if (c > 0) harvest[h] = (harvest[h] ?? 0) + c; }
    if (p > 0 && (!bestDay || p > bestDay.points)) bestDay = { date: k, points: p };
    days.push({ date: k, points: p, ...dayWeather(k) });
  }
  const before = al.days.filter((d) => d.date < from);
  const record = !!bestDay && before.some((d) => d.points > 0) && bestDay.points > Math.max(0, ...before.map((d) => d.points));
  // streak at the end of the covered days (an unfinished today without harvest doesn't break it)
  const streakAt = (end: string): number => { let n = 0; for (let k = end; (byDate.get(k)?.points ?? 0) > 0; k = addDays(k, -1)) n++; return n; };
  const streak = inp.kind === 'daily' && !(byDate.get(to)?.points) ? streakAt(addDays(to, -1)) : streakAt(to);
  let longest = 0, run = 0, prev = '';
  for (const d of al.days) {
    if (d.points <= 0) { run = 0; prev = d.date; continue; }
    run = prev && daysBetween(prev, d.date) === 1 && run ? run + 1 : 1;
    prev = d.date;
    longest = Math.max(longest, run);
  }
  const after = al.days.filter((d) => d.date > to).reduce((s, d) => s + d.points, 0);
  const atEnd = Math.max(0, al.points - after), atStart = Math.max(0, atEnd - points);
  const rank = rankAt(atEnd), rank0 = rankAt(atStart);
  const next = rank < RANKS.length - 1 ? { name: RANKS[rank + 1].name, left: RANKS[rank + 1].at - atEnd } : null;
  // ---- the timeline's roll-up: who worked where, and how long they waited for you
  const rolls = inp.past.filter((r) => inRange(r.day, from, to));
  if (inp.today && inRange(inp.today.day, from, to) && !rolls.some((r) => r.day === inp.today!.day)) rolls.push(inp.today);
  const people = new Map<string, { name: string; tag: string; active: number; ships: number; days: Set<string> }>();
  const fields = new Map<string, number>();
  let active = 0, waitSum = 0, waitN = 0, fails = 0;
  for (const r of rolls) {
    for (const f of r.farmers) {
      const key = `${f.name}\u0000${f.tag}`;
      const p = people.get(key) ?? { name: f.name, tag: f.tag, active: 0, ships: 0, days: new Set<string>() };
      p.active += f.active; p.ships += f.ships;
      if (f.active > 0 || f.ships > 0) p.days.add(r.day);
      people.set(key, p);
      const field = fieldOf(f.tag);
      fields.set(field, (fields.get(field) ?? 0) + f.active);
      active += f.active; waitSum += f.wait; waitN += f.answered; fails += f.fails;
    }
  }
  const ranked = [...people.values()].sort((a, b) => b.active - a.active || b.ships - a.ships || a.name.localeCompare(b.name));
  const top = ranked[0] && ranked[0].active > 0 ? ranked[0] : null;
  const shipperP = [...people.values()].sort((a, b) => b.ships - a.ships || b.active - a.active)[0];
  const fieldTop = [...fields.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  // ---- the journal, the stamp book
  const notes = inp.notes.filter((n) => inRange(dayKey(n.at), from, to));
  const catches = notes.filter((n): n is Extract<GzNote, { k: 'catch' }> => n.k === 'catch');
  const real = catches.filter((c) => c.cm > 0 && !(collectDef(c.item) as { junk?: boolean } | undefined)?.junk);
  const fish = real.sort((a, b) => b.cm - a.cm)[0];
  const finds = [...new Set(notes.filter((n) => n.k === 'find').map((n) => (n as { item: string }).item))].filter((id) => collectDef(id));
  const inked = Object.entries(inp.stamps ?? {}).filter(([id, at]) => finite(at) && stampDef(id) && inRange(dayKey(at), from, to)).sort((a, b) => b[1] - a[1]);
  const gossip = notes.filter((n) => n.k !== 'catch' && n.k !== 'find' && friendDef(n.who))
    .sort((a, b) => NOTE_RANK[b.k] - NOTE_RANK[a.k] || b.at - a.at);
  // ---- the calendar, the forecast
  const fv = festivalAt(noonOf(date));
  const forecast = [0, 1, 2, 3].map((i) => { const k = addDays(date, i); return { date: k, weather: dayWeather(k).weather }; });
  return {
    v: 1, kind: inp.kind, no: issueNo(al.since, date), date, from, to, demo: !!inp.demo,
    harvest, points, days, bestDay, record, streak, streakBest: streak >= 3 && streak >= longest,
    rank: RANKS[rank].name, rankFrom: rank > rank0 ? RANKS[rank0].name : null, next,
    wait: waitN ? { avg: Math.round(waitSum / waitN), n: waitN } : null,
    active, farmers: people.size,
    field: fieldTop && fieldTop[1] > 0 ? { tag: fieldTop[0], active: fieldTop[1], share: active ? fieldTop[1] / active : 0 } : null,
    farmer: top ? { name: top.name, tag: fieldOf(top.tag), active: top.active, ships: top.ships, days: top.days.size } : null,
    shipper: shipperP && shipperP.ships > 0 && top && (shipperP.name !== top.name || shipperP.tag !== top.tag) && shipperP.ships > top.ships
      ? { name: shipperP.name, tag: fieldOf(shipperP.tag), ships: shipperP.ships } : null,
    fails,
    forecast,
    festival: fv.active ? { id: fv.active.id, name: fv.active.name, blurb: fv.active.blurb, day: fv.active.day, days: fv.active.days } : null,
    upcoming: fv.next ? { id: fv.next.id, name: fv.next.name, blurb: fv.next.blurb, inDays: fv.next.inDays, start: fv.next.start } : null,
    season: seasonOf(noonOf(date).getMonth()),
    notes: [...gossip.slice(0, 8), ...notes.filter((n) => n.k === 'find').slice(0, 2)],
    stamp: inked[0] ? { id: inked[0][0], at: inked[0][1] } : null,
    stamps: inked.length,
    fish: fish ? { item: fish.item, cm: fish.cm } : null,
    catches: catches.length,
    finds,
  };
}

/** Tolerant parse of stored facts: everything is coerced or defaulted, so a hand-edited archive still composes. */
export function parseFacts(raw: unknown): WeekFacts | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const key = (v: unknown): string | null => (typeof v === 'string' && DAY_RE.test(v) ? v : null);
  const date = key(o.date), from = key(o.from), to = key(o.to);
  if (o.v !== 1 || !date || !from || !to || from > to || daysBetween(from, to) > 14) return null;
  const n = (v: unknown, lo = 0, hi = 1e12): number => (finite(v) ? Math.max(lo, Math.min(hi, v)) : 0);
  const s = (v: unknown, max = 80): string => (typeof v === 'string' ? v.slice(0, max) : '');
  const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
  const kinds: readonly WeatherKind[] = ['clear', 'cloudy', 'rain', 'storm', 'fog', 'snow'];
  const wk = (v: unknown): WeatherKind => (kinds.includes(v as WeatherKind) ? v as WeatherKind : 'clear');
  const harvest: Partial<Record<HarvestKind, number>> = {};
  const h = obj(o.harvest);
  if (h) for (const k of HARVEST_KINDS) { const c = n(h[k], 0, 99_999); if (c) harvest[k] = Math.round(c); }
  const days: DayFacts[] = (Array.isArray(o.days) ? o.days : []).map((d) => obj(d)).filter((d): d is Record<string, unknown> => !!d && !!key(d.date))
    .slice(0, 15).map((d) => ({ date: d.date as string, points: n(d.points, 0, 1e6), weather: wk(d.weather), wet: n(d.wet, 0, 8) }));
  const bd = obj(o.bestDay), nx = obj(o.next), wt = obj(o.wait), fl = obj(o.field), fm = obj(o.farmer), sh = obj(o.shipper), fe = obj(o.festival), up = obj(o.upcoming), st = obj(o.stamp), fi = obj(o.fish);
  const seasons: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];
  return {
    v: 1, kind: o.kind === 'daily' ? 'daily' : 'weekly', no: Math.round(n(o.no, 1, 99_999)) || 1, date, from, to, demo: o.demo === true,
    harvest, points: n(o.points, 0, 1e7), days,
    bestDay: bd && key(bd.date) ? { date: bd.date as string, points: n(bd.points, 0, 1e6) } : null,
    record: o.record === true, streak: Math.round(n(o.streak, 0, 9999)), streakBest: o.streakBest === true,
    rank: s(o.rank) || RANKS[0].name, rankFrom: typeof o.rankFrom === 'string' ? s(o.rankFrom) : null,
    next: nx && typeof nx.name === 'string' ? { name: s(nx.name), left: n(nx.left, 0, 1e7) } : null,
    wait: wt && n(wt.n) ? { avg: n(wt.avg, 0, 1e9), n: Math.round(n(wt.n, 0, 1e5)) } : null,
    active: n(o.active), farmers: Math.round(n(o.farmers, 0, 999)),
    field: fl && typeof fl.tag === 'string' ? { tag: s(fl.tag, 60), active: n(fl.active), share: n(fl.share, 0, 1) } : null,
    farmer: fm && typeof fm.name === 'string' ? { name: s(fm.name, 60), tag: s(fm.tag, 60), active: n(fm.active), ships: Math.round(n(fm.ships, 0, 1e5)), days: Math.round(n(fm.days, 0, 14)) } : null,
    shipper: sh && typeof sh.name === 'string' ? { name: s(sh.name, 60), tag: s(sh.tag, 60), ships: Math.round(n(sh.ships, 0, 1e5)) } : null,
    fails: Math.round(n(o.fails, 0, 1e5)),
    forecast: (Array.isArray(o.forecast) ? o.forecast : []).map((d) => obj(d)).filter((d): d is Record<string, unknown> => !!d && !!key(d.date)).slice(0, 5)
      .map((d) => ({ date: d.date as string, weather: wk(d.weather) })),
    festival: fe && typeof fe.name === 'string' ? { id: s(fe.id, 20), name: s(fe.name), blurb: s(fe.blurb, 200), day: Math.round(n(fe.day, 1, 99)), days: Math.round(n(fe.days, 1, 99)) } : null,
    upcoming: up && typeof up.name === 'string' ? { id: s(up.id, 20), name: s(up.name), blurb: s(up.blurb, 200), inDays: Math.round(n(up.inDays, 1, 999)), start: key(up.start) ?? date } : null,
    season: seasons.includes(o.season as Season) ? o.season as Season : 'spring',
    notes: (Array.isArray(o.notes) ? o.notes : []).map(parseNote).filter((x): x is GzNote => !!x).slice(0, 12),
    stamp: st && typeof st.id === 'string' && stampDef(st.id) ? { id: st.id, at: n(st.at) } : null,
    stamps: Math.round(n(o.stamps, 0, 999)),
    fish: fi && typeof fi.item === 'string' && collectDef(fi.item) ? { item: fi.item, cm: n(fi.cm, 0, 999) } : null,
    catches: Math.round(n(o.catches, 0, 1e5)),
    finds: (Array.isArray(o.finds) ? o.finds : []).filter((x): x is string => typeof x === 'string' && !!collectDef(x)).slice(0, 12),
  };
}

// ---------------------------------------------------------------------------------------------
// compose: facts → a newspaper page

/** the little engravings the HUD draws beside a story */
export type Art = 'crates' | 'rosette' | 'sun' | 'rain' | 'snow' | 'fish' | 'farmer' | 'field' | 'stamp' | 'heart' | 'lantern' | 'pumpkin' | 'star' | 'quill' | 'moon';

export interface Story {
  id: string;
  /** small caps line above the headline */
  kicker: string;
  head: string;
  /** a subhead under the headline */
  deck?: string;
  body: string[];
  art?: Art;
  /** a stamp id: the HUD shows the inked stamp */
  stamp?: string;
}

export interface Issue {
  facts: WeekFacts;
  no: number;
  kind: EditionKind;
  edition: string;
  /** "Monday 5 October 2026" */
  dateLine: string;
  /** "The week of 28 Sep – 4 Oct" */
  covers: string;
  price: string;
  motto: string;
  lead: Story;
  stories: Story[];
  /** the harvest box: label → value */
  numbers: { label: string; value: string }[];
  quote: { text: string; by: string } | null;
  gossip: string[];
  weather: { days: { label: string; weather: WeatherKind; wet: number }[]; line: string };
  forecast: { label: string; weather: WeatherKind; line: string }[];
  classifieds: { head: string; text: string }[];
  editorial: Story;
  /** nothing was harvested in the covered days */
  quiet: boolean;
}

type R = () => number;
const pick = <T>(r: R, xs: readonly T[]): T => xs[Math.floor(r() * xs.length) % xs.length];
const shuffle = <T>(r: R, xs: readonly T[]): T[] => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const words = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const spell = (n: number) => (n >= 0 && n < words.length ? words[n] : n.toLocaleString('en-US'));
const Cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** a farmer's name as the paper prints it ("Flint", or a path left alone) */
export const nameOf = (s: string) => (/[:/\\.]/.test(s) ? s : Cap(s));
const itemName = (id: string) => (collectDef(id)?.name ?? id).toLowerCase();
const fishName = (id: string) => collectDef(id)?.name ?? id;
const short = (who: string) => friendDef(who)?.short ?? Cap(who.replace(/^villager:/, ''));

export const WEATHER_WORD: Readonly<Record<WeatherKind, string>> = { clear: 'Sunny', cloudy: 'Cloudy', rain: 'Showers', storm: 'Thunder', fog: 'Fog', snow: 'Snow' };
const FORECAST_LINE: Readonly<Record<WeatherKind, readonly string[]>> = {
  clear: ['Blue skies. Hang the washing out.', 'Sunshine all day; mind the scarecrows don\'t burn.', 'Fair and bright. A fine day to ship.'],
  cloudy: ['Grey but dry. Good thinking weather.', 'Clouds drifting over the ridge, nothing more.', 'Overcast; the windmill will be glad of the breeze.'],
  rain: ['Bring a brolly: showers on and off.', 'Rain for the fields. The frogs approve.', 'Wet. Puddles by the bandstand by noon.'],
  storm: ['Thunder over the hills. Batten the barn.', 'Stormy! Nimbus will be on the knoll, delighted.', 'Lightning likely. Fishing is excellent, apparently.'],
  fog: ['Thick fog till late morning. Walk slowly.', 'Misty. The lanterns stay lit a while longer.', 'Fog in the hollows; the heron likes it.'],
  snow: ['Snow! Mittens on, snowmen out.', 'Flurries, settling on the fences.', 'A white day. The pond may hold.'],
};
const ART_OF_WEATHER: Readonly<Record<WeatherKind, Art>> = { clear: 'sun', cloudy: 'sun', rain: 'rain', storm: 'rain', fog: 'rain', snow: 'snow' };

const PRICES = ['One acorn', 'Two pinecones', 'A shiny pebble', 'One bit', 'A friendly wave', 'Three daisies', 'Free to good homes', 'One feather'];
const MOTTOS = ['All the news that grows', 'Fresh from the fields since the first commit', 'Printed with care, read with tea', 'Est. the day the first field was tilled',
  'Honest news, mostly about crates', 'Delivered by pigeon, edited by Posy'];
const CLASSIFIEDS: readonly { head: string; text: string }[] = [
  { head: 'Lost', text: 'One left mitten, blue, answers to "Mitten". Last seen near the skating pond. Reward: gratitude.' },
  { head: 'Wanted', text: 'Somebody to tell the ducks a bedtime story. They have heard all of Fern\'s twice.' },
  { head: 'For swap', text: 'Slightly dented watering can, very loyal. Will trade for a good pun.' },
  { head: 'Found', text: 'A small brass key by the sundial. Opens nothing we know of. Ask Posy at the post office.' },
  { head: 'Notice', text: 'The windmill would like it known that it is not "showing off", it is simply very good at turning.' },
  { head: 'Wanted', text: 'Volunteers to count the fireflies on a warm evening. Last year\'s total: "lots".' },
  { head: 'Lost', text: 'Hazel\'s good flour scoop. If found, please return before the bread notices.' },
  { head: 'Lessons', text: 'Scarecrow posture classes, Thursdays, by the south field. Arms out, chin up, look fearsome.' },
  { head: 'For sale', text: 'Bram\'s spare crate. Sturdy, square, smells faintly of apples. Bring your own commits.' },
  { head: 'Notice', text: 'The heron has asked, again, that the pond not be called "his". It is, though.' },
  { head: 'Wanted', text: 'A rhyme for "pumpkin". The Mayor\'s Harvest speech depends on it.' },
  { head: 'Found', text: 'One paper boat, slightly soggy, bearing the word "ship it". Claim at the dock.' },
  { head: 'Club news', text: 'The Moonlit Stargazing Society meets on the knoll whenever Nimbus says so. Bring cocoa.' },
  { head: 'Lost', text: 'A very good stick. The dog would like it back and is taking it personally.' },
  { head: 'Offered', text: 'Free hugs from the scarecrows. Not very warm, but sincere.' },
  { head: 'Notice', text: 'Please do not feed the ducklings after midnight. They get ideas.' },
];

/** the issue's dice: fixed per edition and covered days, so a page reads the same every time it is opened */
const seedOf = (f: WeekFacts) => mulberry32(hash32(`gazette|${f.kind}|${f.from}|${f.to}|${f.no}`));

function leadStory(f: WeekFacts, r: R): Story {
  const c = f.harvest;
  const commits = c.commit ?? 0, tests = c.tests ?? 0, finished = c.finished ?? 0;
  const week = f.kind === 'weekly' ? 'the week' : 'the past seven days';
  const tally: string[] = [];
  if (commits) tally.push(`${plural(commits, 'commit')} shipped`);
  if (tests) tally.push(`${plural(tests, 'green test run')}`);
  if (finished) tally.push(`${plural(finished, 'task')} finished`);
  if (c.answered) tally.push(`${plural(c.answered, 'question')} answered`);
  const tallyText = tally.length > 1 ? `${tally.slice(0, -1).join(', ')} and ${tally[tally.length - 1]}` : tally[0] ?? '';
  if (f.rankFrom) {
    const ri = RANKS.findIndex((x) => x.name === f.rank);
    const up = ri > 0 ? UPGRADES[ri - 1] : null;
    return {
      id: 'lead', kicker: 'Town news', art: 'rosette',
      head: pick(r, [`${f.rank} at Last!`, `Valley Rises to ${f.rank}`, `Bunting Up: We're ${/^[aeiou]/i.test(f.rank) ? 'an' : 'a'} ${f.rank} Now`, `From ${f.rankFrom} to ${f.rank}`]),
      deck: up ? `New in town: ${up.title.replace(/^[A-Z](?=[a-z])/, (x) => x.toLowerCase())}` : 'The Almanac makes it official',
      body: [
        `It is official: over ${week} the valley grew from ${f.rankFrom} into ${f.rank}, on ${plural(Math.round(f.points), 'point')} of prosperity${tallyText ? ` (${tallyText})` : ''}.`,
        up ? `To mark the occasion the town has built something new: ${up.blurb.replace(/\.$/, '').replace(/^[A-Z](?=[a-z ])/, (x) => x.toLowerCase())}. Do go and admire it.` : 'The Mayor has been seen polishing the town sign.',
        f.next ? `Next on the Almanac's list: ${f.next.name}, ${plural(Math.round(f.next.left), 'point')} away.` : 'The Almanac has run out of ranks, and has started handing out stars.',
      ],
    };
  }
  if (f.record && f.bestDay) {
    return {
      id: 'lead', kicker: 'Record broken', art: 'star',
      head: pick(r, [`Best Day on Record!`, `${weekdayName(f.bestDay.date)}'s Harvest Breaks the Record`, `A Record ${plural(Math.round(f.bestDay.points), 'Point')} in One Day`, `Almanac Reaches for a New Page`]),
      deck: `${Math.round(f.bestDay.points)} prosperity on ${weekdayName(f.bestDay.date)} ${shortDate(f.bestDay.date)}`,
      body: [
        `${weekdayName(f.bestDay.date)} was the valley's best day yet: ${plural(Math.round(f.bestDay.points), 'point')} of prosperity in a single day, beating every day the Almanac remembers.`,
        tallyText ? `All told, ${week} brought ${tallyText}.` : '',
        f.streak >= 2 ? `The fields have now been busy ${spell(f.streak)} days in a row.` : '',
      ].filter(Boolean),
    };
  }
  if (commits) {
    return {
      id: 'lead', kicker: 'The harvest', art: 'crates',
      head: commits >= 25 ? pick(r, [`Bin Overflows: ${commits} Crates Go Out`, `${commits} Commits! Bram Asks for a Bigger Bin`, `A Bumper Week at the Shipping Bin`])
        : pick(r, [`${Cap(spell(commits))} Crate${commits === 1 ? '' : 's'} Shipped`, `Steady Work at the Shipping Bin`, `The Crates Keep Coming: ${commits} This Week`]),
      deck: tallyText ? Cap(tallyText) : undefined,
      body: [
        `Over ${week} the farmers shipped ${plural(commits, 'commit')}${tests ? `, watched ${plural(tests, 'test run')} come up green` : ''}${finished ? ` and finished ${plural(finished, 'task')}` : ''}.`,
        `That came to ${plural(Math.round(f.points), 'point')} of prosperity for the Almanac${f.bestDay ? `, ${weekdayName(f.bestDay.date)} the busiest day with ${Math.round(f.bestDay.points)}` : ''}.`,
        f.active > 0 ? `Between them, ${plural(f.farmers, 'farmer')} put in ${duration(f.active)} of work in the fields.` : '',
      ].filter(Boolean),
    };
  }
  if (f.points > 0) {
    return {
      id: 'lead', kicker: 'The harvest', art: 'field',
      head: pick(r, ['Quiet Progress in the Fields', 'Tending, Testing, Tidying', `${plural(Math.round(f.points), 'Point')} of Prosperity`]),
      deck: tallyText ? Cap(tallyText) : undefined,
      body: [
        `No crates went out over ${week}, but the fields were far from idle: ${tallyText || 'little bits of work here and there'}.`,
        `${Cap(plural(Math.round(f.points), 'point'))} of prosperity went into the Almanac.`,
      ],
    };
  }
  return {
    id: 'lead', kicker: 'All quiet', art: 'moon',
    head: pick(r, ['A Quiet Week in the Valley', 'Fields Rest, Farmers Dream', 'Nothing to Report, Beautifully']),
    deck: 'The scarecrows report all calm',
    body: [
      `Nothing was harvested over ${week}. The fields lay fallow, the shipping bin stood empty, and the ducks had the pond to themselves.`,
      'A rest is part of farming too. The valley will be here when the work starts again.',
    ],
  };
}

function gossipLine(n: GzNote, r: R): string | null {
  switch (n.k) {
    case 'gift': {
      const who = short(n.who), it = itemName(n.item);
      if (n.tier === 'love') return pick(r, [`${who} was delighted by your ${it}.`, `${who} hasn't stopped talking about the ${it} you brought.`, `Word is the ${it} you gave ${who} has pride of place on the mantel.`]);
      if (n.tier === 'like') return pick(r, [`${who} was quietly pleased with the ${it}.`, `${who} says thank you for the ${it}, and means it.`]);
      if (n.tier === 'dislike') return pick(r, [`${who} has asked us to print that ${it} is "not really their thing". Noted.`, `${who} accepted the ${it} with a brave smile.`]);
      return `${who} thanks you for the ${it}.`;
    }
    case 'request': return pick(r, [`${short(n.who)} sends thanks for your help with that little errand.`, `${short(n.who)}'s request? Done, and done kindly.`]);
    case 'hearts': return `${short(n.who)} now counts you a friend of ${spell(n.n)} heart${n.n === 1 ? '' : 's'}.`;
    default: return null;
  }
}

/** Facts → a page. Pure and deterministic per issue. */
export function composeIssue(f: WeekFacts): Issue {
  const r = seedOf(f);
  const c = f.harvest;
  const quiet = f.points <= 0;
  const lead = leadStory(f, r);
  const stories: Story[] = [];
  const week = f.kind === 'weekly' ? 'this week' : 'these past seven days';
  // farmer of the week
  if (f.farmer) {
    const n = nameOf(f.farmer.name);
    stories.push({
      id: 'farmer', kicker: 'Farmer of the week', art: 'farmer',
      head: pick(r, [`Hardest-Working Hands: ${n}`, `${n} Tops the Field`, `Up With the Lark: ${n}`, `Three Cheers for ${n}`]),
      deck: `of the ${f.farmer.tag} field`,
      body: [
        `${n} put in ${duration(f.farmer.active)} of honest work ${f.farmer.days > 1 ? `across ${spell(f.farmer.days)} days` : week}${f.farmer.ships ? `, and shipped ${plural(f.farmer.ships, 'crate')} along the way` : ''}.`,
        f.shipper ? `Honourable mention to ${nameOf(f.shipper.name)} (${f.shipper.tag}), who shipped the most: ${plural(f.shipper.ships, 'crate')}.` : '',
      ].filter(Boolean),
    });
  }
  // the busiest field
  if (f.field && f.farmers > 1) {
    stories.push({
      id: 'field', kicker: 'Around the fields', art: 'field',
      head: pick(r, [`The ${f.field.tag} Field Hums Along`, `Busiest Field: ${f.field.tag}`, `All Hands on ${f.field.tag}`]),
      body: [`The ${f.field.tag} field saw ${duration(f.field.active)} of work, ${Math.round(f.field.share * 100)}% of everything done in the valley ${week}.`],
    });
  }
  // waiting on you
  if (f.wait) {
    const m = f.wait.avg / 60_000;
    stories.push({
      id: 'wait', kicker: 'Your post', art: 'quill',
      head: m < 2 ? pick(r, ['Quick Answers Win Praise', 'Speedy Replies from the Farmhouse']) : m < 10 ? pick(r, ['Answers Arrive in Good Time', 'Questions Asked, Questions Answered']) : pick(r, ['Farmers Wait Patiently by the Gate', 'A Little Longer at the Gate']),
      body: [`The farmers asked for you ${plural(f.wait.n, 'time')} and waited ${duration(f.wait.avg)} on average for an answer.${m >= 10 ? ' They don\'t mind, much. They whittled.' : ' They were very pleased about it.'}`],
    });
  }
  // tests
  if ((c.tests ?? 0) >= 3 || f.fails >= 3) {
    stories.push({
      id: 'tests', kicker: 'Tests', art: 'sun',
      head: f.fails > (c.tests ?? 0) ? 'A Red Week at the Test Beds' : pick(r, ['Green Across the Board', 'Test Beds in Fine Fettle', 'The Lamps Glow Green']),
      body: [`${Cap(plural(c.tests ?? 0, 'test run'))} came up green ${week}${f.fails ? `, and ${plural(f.fails, 'red one')} got fixed up along the way` : ', and not one red one'}.`],
    });
  }
  // streak
  if (f.streak >= 3) {
    stories.push({
      id: 'streak', kicker: 'Streak', art: 'star',
      head: f.streakBest ? `Longest Streak Yet: ${f.streak} Days` : `${Cap(spell(f.streak))} Days Running`,
      body: [`Something has been harvested every day for ${spell(f.streak)} days in a row.${f.streakBest ? ' The Almanac has never seen a longer one.' : ''}`],
    });
  }
  // new fields
  if ((c.tilled ?? 0) > 0) {
    stories.push({
      id: 'fields', kicker: 'New ground', art: 'field',
      head: c.tilled === 1 ? 'A New Field Is Tilled' : `${Cap(spell(c.tilled!))} New Fields Broken`,
      body: [`${c.tilled === 1 ? 'A fresh field was' : `${Cap(spell(c.tilled!))} fresh fields were`} tilled ${week}${(c.ducklings ?? 0) ? `, and ${plural(c.ducklings!, 'duckling')} hatched to help` : ''}.`],
    });
  }
  // festivals
  if (f.festival) {
    stories.push({
      id: 'festival', kicker: 'Festival', art: f.festival.id === 'harvest' || f.festival.id === 'hallowtide' ? 'pumpkin' : 'lantern',
      head: f.festival.day === f.festival.days ? `Last Day of the ${f.festival.name}` : f.festival.days === 1 ? `${f.festival.name} Is Today` : `${f.festival.name} in Full Swing`,
      deck: f.festival.days > 1 ? `Day ${f.festival.day} of ${f.festival.days}` : undefined,
      body: [f.festival.blurb],
    });
  } else if (f.upcoming && f.upcoming.inDays <= 21) {
    stories.push({
      id: 'festival', kicker: 'Coming soon', art: f.upcoming.id === 'harvest' || f.upcoming.id === 'hallowtide' ? 'pumpkin' : 'lantern',
      head: `${f.upcoming.name} ${f.upcoming.inDays === 1 ? 'Tomorrow' : `in ${Cap(spell(f.upcoming.inDays))} Days`}`,
      deck: `From ${longDate(f.upcoming.start)}`,
      body: [f.upcoming.blurb],
    });
  }
  // stamp of the week
  if (f.stamp) {
    const d = stampDef(f.stamp.id)!;
    stories.push({
      id: 'stamp', kicker: 'Stamp of the week', art: 'stamp', stamp: d.id,
      head: d.name,
      body: [d.blurb, f.stamps > 1 ? `One of ${spell(f.stamps)} stamps inked in the book ${week}.` : ''].filter(Boolean),
    });
  }
  // fishing report
  if (f.fish || f.catches) {
    stories.push({
      id: 'fish', kicker: 'Fishing report', art: 'fish',
      head: f.fish ? pick(r, [`${fishName(f.fish.item)}, ${f.fish.cm} cm!`, `The Big One: a ${f.fish.cm} cm ${fishName(f.fish.item).toLowerCase()}`]) : 'Lines in the Water',
      body: [f.fish ? `The catch of the week was a ${fishName(f.fish.item).toLowerCase()} of ${f.fish.cm} cm, out of ${plural(f.catches, 'catch', 'catches')} in all.` : `${Cap(plural(f.catches, 'catch', 'catches'))}, none worth measuring. The boots were the usual size.`],
    });
  }
  if (f.finds.length) {
    const names = f.finds.slice(0, 4).map((id) => collectDef(id)!.name.toLowerCase());
    stories.push({
      id: 'finds', kicker: 'Collections', art: 'heart',
      head: f.finds.length === 1 ? 'New in the Collections Book' : `${Cap(spell(f.finds.length))} New Finds for the Book`,
      body: [`Newly pressed into the Collections book: ${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]}.`],
    });
  }
  // the numbers box
  const numbers: Issue['numbers'] = [];
  const add = (label: string, v: number | string) => numbers.push({ label, value: typeof v === 'number' ? v.toLocaleString('en-US') : v });
  add('Commits shipped', c.commit ?? 0);
  add('Green test runs', c.tests ?? 0);
  add('Tasks finished', c.finished ?? 0);
  add('Asks answered', Math.max(c.answered ?? 0, f.wait?.n ?? 0));
  add('Avg. wait for you', f.wait ? duration(f.wait.avg) : '–');
  add('Prosperity', Math.round(f.points));
  // quote
  const quotes: { text: string; by: string }[] = [];
  if ((c.commit ?? 0) >= 10) quotes.push({ text: pick(r, ['Never seen the bin so full. I had to sit on the lid.', 'Crates, crates, crates. My ledger needs a ledger.']), by: 'Bram, shipping clerk' });
  if (f.rankFrom) quotes.push({ text: 'I have ordered more bunting. One can never have too much bunting.', by: 'Mayor Marigold' });
  if (f.days.filter((d) => d.wet >= 2).length >= 3) quotes.push({ text: 'A splendid week for clouds. Splendid! Everyone else, I\'m told, was damp.', by: 'Nimbus, weather-watcher' });
  if (f.days.every((d) => d.wet === 0)) quotes.push({ text: 'Not a drop all week. I\'ve been reduced to forecasting sunshine. Dreadful.', by: 'Nimbus, weather-watcher' });
  if (f.fish) quotes.push({ text: `A ${f.fish.cm} centimetre ${fishName(f.fish.item).toLowerCase()}? I'd have liked to see that.`, by: 'Bram, shipping clerk' });
  if (f.notes.some((n) => n.k === 'gift' && n.tier === 'love')) { const g = f.notes.find((n) => n.k === 'gift' && n.tier === 'love') as Extract<GzNote, { k: 'gift' }>; quotes.push({ text: `Tell everyone. The ${itemName(g.item)} was perfect.`, by: friendDef(g.who)?.name ?? short(g.who) }); }
  if (quiet) quotes.push({ text: 'A quiet week is still a week well spent. Mind you, I polished the sundial twice.', by: 'Mayor Marigold' });
  const quote = quotes.length ? pick(r, quotes) : { text: 'The post goes out whatever the weather. That\'s the whole point of post.', by: 'Posy, postmaster' };
  // gossip
  const gossip = f.notes.map((n) => gossipLine(n, r)).filter((x): x is string => !!x).slice(0, 5);
  // weather recap + forecast
  const wetDays = f.days.filter((d) => d.wet >= 2).length;
  const sunny = f.days.filter((d) => d.weather === 'clear').length;
  const snowy = f.days.filter((d) => d.weather === 'snow').length;
  const stormy = f.days.filter((d) => d.weather === 'storm');
  const wline = stormy.length ? `Thunder rolled through on ${stormy.map((d) => weekdayName(d.date)).slice(0, 2).join(' and ')}${wetDays > 1 ? `; ${spell(wetDays)} wet days in all` : ''}.`
    : snowy ? `Snow on ${spell(snowy)} day${snowy === 1 ? '' : 's'}; the valley wore white.`
      : wetDays >= 4 ? `A soggy stretch: ${spell(wetDays)} wet days. The frogs threw a party.`
        : sunny >= 4 ? `${Cap(spell(sunny))} sunny days. Hats were worn.`
          : `A bit of everything: ${spell(sunny)} sunny, ${spell(wetDays)} wet.`;
  const weather = { days: f.days.map((d) => ({ label: weekdayName(d.date).slice(0, 3), weather: d.weather, wet: d.wet })), line: wline };
  const forecast = f.forecast.map((d, i) => ({
    label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : weekdayName(d.date),
    weather: d.weather,
    line: pick(r, FORECAST_LINE[d.weather]),
  }));
  // classifieds: a fixed whimsical bank, plus anything the week really turned up
  const cls = shuffle(r, CLASSIFIEDS).slice(0, 3);
  if (f.notes.length === 0 && f.catches && !f.fish) cls.unshift({ head: 'Found', text: 'One old boot, in the river, by you. Returned to the river, also by you.' });
  if (f.festival || (f.upcoming && f.upcoming.inDays <= 14)) cls.push({ head: 'Notice', text: `Volunteers wanted for the ${(f.festival ?? f.upcoming)!.name}. See the Mayor; bring enthusiasm.` });
  // the Mayor's editorial
  const ed: string[] = [];
  ed.push(quiet ? pick(r, ['Dear residents, it has been a peaceful week, and I for one am grateful for it.', 'Friends, the fields have rested, and so, I hope, have you.'])
    : pick(r, ['Dear residents, what a week it has been.', 'Friends, neighbours, farmers: thank you.', 'Another week, another page in the Almanac, and what a page.']));
  if (!quiet) ed.push(`Our farmers brought in ${plural(Math.round(f.points), 'point')} of prosperity ${week}${f.farmer ? `, with ${nameOf(f.farmer.name)} leading the way` : ''}.${f.rankFrom ? ` We are ${/^[aeiou]/i.test(f.rank) ? 'an' : 'a'} ${f.rank} now, and I intend to mention it often.` : ''}`);
  if (f.next) ed.push(`The Almanac tells me ${f.next.name} is ${plural(Math.round(f.next.left), 'point')} away. I have already drafted the speech.`);
  if (f.festival) ed.push(`Do come to the square for the ${f.festival.name}. There will be ${f.festival.id === 'harvest' ? 'a pumpkin of unreasonable size' : f.festival.id === 'founders' ? 'cake' : 'things to see'}.`);
  else if (f.upcoming && f.upcoming.inDays <= 21) ed.push(`And mark your calendars: the ${f.upcoming.name} begins ${f.upcoming.inDays === 1 ? 'tomorrow' : `in ${spell(f.upcoming.inDays)} days`}.`);
  ed.push(pick(r, ['Yours in civic pride,', 'Ever at your service,', 'With warm regards from the town hall,']));
  const editorial: Story = { id: 'editorial', kicker: 'From the Mayor\'s desk', head: pick(r, ['A Word from the Town Hall', 'The Mayor Writes', 'Notes from the Mayor\'s Desk']), body: ed, art: 'quill' };
  const dateLine = longDate(f.date);
  return {
    facts: f, no: f.no, kind: f.kind,
    edition: f.kind === 'weekly' ? 'Weekly Edition' : 'Morning Edition',
    dateLine,
    covers: `${f.kind === 'weekly' ? 'The week of' : 'The seven days to'} ${f.kind === 'weekly' ? `${shortDate(f.from)} – ${shortDate(f.to)}` : shortDate(f.to)}`,
    price: pick(r, PRICES), motto: pick(r, MOTTOS),
    lead, stories, numbers, quote, gossip, weather, forecast, classifieds: cls.slice(0, 4), editorial, quiet,
  };
}

/** a story's art when it has none: the week's weather */
export const weatherArt = (k: WeatherKind): Art => ART_OF_WEATHER[k];

// ---------------------------------------------------------------------------------------------
// keep: the journal and the back issues

export interface IssueRec { no: number; at: number; facts: WeekFacts }
export interface GazetteData {
  v: 1;
  notes: GzNote[];
  /** newest last, at most ISSUES_KEPT */
  issues: IssueRec[];
  /** the week (its Monday) of the last weekly delivery ('' never) */
  week: string;
}
export const emptyGazette = (): GazetteData => ({ v: 1, notes: [], issues: [], week: '' });

export function parseGazette(raw: unknown): GazetteData | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return null;
  const notes = (Array.isArray(o.notes) ? o.notes : []).map(parseNote).filter((n): n is GzNote => !!n).sort((a, b) => a.at - b.at).slice(-NOTES_MAX);
  const issues: IssueRec[] = [];
  for (const x of Array.isArray(o.issues) ? o.issues : []) {
    if (!x || typeof x !== 'object') continue;
    const i = x as Record<string, unknown>;
    const facts = parseFacts(i.facts);
    if (!facts || !finite(i.at)) continue;
    issues.push({ no: facts.no, at: i.at, facts });
  }
  issues.sort((a, b) => a.at - b.at);
  return { v: 1, notes, issues: issues.slice(-ISSUES_KEPT), week: typeof o.week === 'string' && DAY_RE.test(o.week) ? o.week : '' };
}

/** the Monday morning hour from which the weekly edition is delivered */
export const DELIVERY_HOUR = 6;

/** Is a weekly edition due (a new week since the last one; on Mondays from DELIVERY_HOUR)? */
export function weeklyDue(d: GazetteData, nowMs: number): boolean {
  const today = dayKey(nowMs);
  const wk = weekOf(today);
  if (d.week === wk) return false;
  if (weekdayOf(today) === 0 && new Date(nowMs).getHours() < DELIVERY_HOUR) return false;
  return true;
}

/** Add a note (mutates): drops notes older than NOTE_DAYS and keeps at most NOTES_MAX. */
export function addNote(d: GazetteData, n: GzNote, nowMs: number): void {
  d.notes.push(n);
  const cut = addDays(dayKey(nowMs), -NOTE_DAYS);
  d.notes = d.notes.filter((x) => dayKey(x.at) >= cut).slice(-NOTES_MAX);
}

/** File a weekly issue (mutates): replaces one for the same days, keeps the last ISSUES_KEPT, marks the week delivered. */
export function fileIssue(d: GazetteData, facts: WeekFacts, nowMs: number): IssueRec {
  const rec: IssueRec = { no: facts.no, at: nowMs, facts };
  d.issues = [...d.issues.filter((i) => !(i.facts.from === facts.from && i.facts.to === facts.to && i.facts.kind === facts.kind)), rec].slice(-ISSUES_KEPT);
  d.week = weekOf(dayKey(nowMs));
  return rec;
}

/** The letter the post brings with a weekly edition. */
export function issueLetter(iss: Issue): { title: string; body: string } {
  return {
    title: `The Valley Gazette, No. ${iss.no}: ${iss.lead.head}`,
    body: `${iss.edition}, ${iss.dateLine}.\n\n${iss.lead.deck ? `${iss.lead.deck}. ` : ''}${iss.lead.body[0] ?? ''}\n\nInside: ${[...iss.stories.slice(0, 3).map((s) => s.head), 'the weather', 'classifieds'].join(' · ')}.`,
  };
}

export interface GazetteStore { load(): unknown; save(d: GazetteData): void }

export interface GazetteService {
  /** bumps on every change */
  readonly version: number;
  data(): Readonly<GazetteData>;
  /** something the player did worth printing */
  note(n: GzNote): void;
  /** a weekly edition is due now */
  due(): boolean;
  /** file a weekly edition from gathered facts (the caller posts the letter) */
  file(facts: WeekFacts): IssueRec;
  /** mark this week delivered without an issue (nothing at all happened last week: no empty paper) */
  skip(): void;
  /** switch storage (the demo valley keeps its paper in memory) */
  use(store: GazetteStore | undefined): void;
  devReset(): void;
}

export function createGazette(store: GazetteStore | undefined, now: () => number = Date.now): GazetteService {
  let st = store;
  const load = (): GazetteData => { try { return parseGazette(st?.load()) ?? emptyGazette(); } catch { return emptyGazette(); } };
  let d = load();
  let version = 0;
  const save = () => { version++; try { st?.save(d); } catch (err) { console.warn('[gazette] save failed', err); } };
  return {
    get version() { return version; },
    data: () => d,
    note(n) { const p = parseNote(n); if (!p) return; addNote(d, p, now()); save(); },
    due: () => weeklyDue(d, now()),
    file(facts) { const rec = fileIssue(d, facts, now()); save(); return rec; },
    skip() { d.week = weekOf(dayKey(now())); save(); },
    use(s) { st = s; d = load(); version++; },
    devReset() { d = emptyGazette(); save(); },
  };
}

// ---------------------------------------------------------------------------------------------
// the demo valley: a believable week from its seeded history

/**
 * The demo's past week: each demo farmer's seeded day (demoDay, ending in the late afternoon) for the ROLL_DAYS days
 * before `now`, rolled up; weekends are quieter (about a third of the farmers come in).
 */
export function demoPast(farmers: readonly { id: string; tag: string; name: string }[], nowMs: number): DayRoll[] {
  const today = dayKey(nowMs);
  const out: DayRoll[] = [];
  for (let i = ROLL_DAYS; i >= 1; i--) {
    const k = addDays(today, -i);
    const weekend = weekdayOf(k) >= 5;
    const fs: Record<string, FarmerDay> = {};
    for (const f of farmers) {
      if (weekend && hash32(`${f.id}|${k}|wkd`) % 3 !== 0) continue;
      const end = noonOf(k).getTime() + (5 + (hash32(`${f.id}|${k}`) % 120) / 60) * 3_600_000;
      fs[f.id] = demoDay(f, end);
    }
    out.push(rollDay({ day: k, farmers: fs }));
  }
  return out;
}

/** A few seeded happenings for the demo's journal (a gift, a request, a catch, a find), all in the last week. */
export function demoNotes(nowMs: number): GzNote[] {
  const r = mulberry32(hash32(`gazette-demo|${weekOf(dayKey(nowMs))}`));
  const at = (daysAgo: number, h: number) => noonOf(addDays(dayKey(nowMs), -daysAgo)).getTime() + (h - 12) * 3_600_000;
  const season = seasonOf(new Date(nowMs).getMonth());
  const gifts: Record<Season, [string, string]> = { spring: ['villager:posy', 'violet'], summer: ['villager:posy', 'berries'], autumn: ['villager:hazel', 'hazelnut'], winter: ['villager:nimbus', 'crystal'] };
  const fish: Record<Season, string> = { spring: 'trout', summer: 'carp', autumn: 'salmon', winter: 'pike' };
  const [who, item] = gifts[season];
  return [
    { k: 'gift', at: at(5, 15), who, item, tier: 'love' },
    { k: 'catch', at: at(4, 18), item: 'minnow', cm: 7 },
    { k: 'catch', at: at(3, 19), item: fish[season], cm: 48 + Math.floor(r() * 30) },
    { k: 'request', at: at(3, 11), who: 'villager:bram' },
    { k: 'hearts', at: at(2, 16), who: 'villager:fern', n: 4 },
    { k: 'gift', at: at(1, 10), who: 'villager:marigold', item: 'mapleleaf', tier: 'love' },
    { k: 'find', at: at(2, 9), item: season === 'autumn' ? 'chanterelle' : season === 'spring' ? 'morel' : season === 'summer' ? 'shell' : 'holly' },
  ];
}

/** The demo's stamp book for the week: a couple of stamps inked a few days ago. */
export const demoStamps = (nowMs: number): Record<string, number> => ({ 'first-fish': nowMs - 4 * DAY_MS, 'big-catch': nowMs - 3 * DAY_MS });

/** Everything a demo edition needs (the almanac comes from the demo valley: demoAlmanac). */
export function demoInput(kind: EditionKind, nowMs: number, almanac: Readonly<AlmanacData>, farmers: readonly { id: string; tag: string; name: string }[], today?: DayRoll | null): GazetteInput {
  const past = demoPast(farmers, nowMs);
  return { kind, now: nowMs, almanac: almanacFromRolls(almanac, today ? [...past, today] : past), past, today: today ?? null, stamps: demoStamps(nowMs), notes: demoNotes(nowMs), demo: true };
}

/**
 * `base` with the harvest counts of the days the rolls cover re-tallied from them (commits, green runs, finished tasks,
 * answered asks), so the demo paper's numbers agree with its farmers' days. Points (and so ranks) stay the demo
 * Almanac's, matching the HUD.
 */
export function almanacFromRolls(base: Readonly<AlmanacData>, rolls: readonly DayRoll[]): AlmanacData {
  const days = new Map(base.days.map((d) => [d.date, { ...d, counts: { ...d.counts } }]));
  for (const r of rolls) {
    const sum = (k: 'ships' | 'passes' | 'finished' | 'answered') => r.farmers.reduce((s, f) => s + f[k], 0);
    const counts = { commit: sum('ships'), tests: sum('passes'), finished: sum('finished'), answered: sum('answered') };
    days.set(r.day, { date: r.day, points: days.get(r.day)?.points ?? 0, counts: Object.fromEntries(Object.entries(counts).filter(([, v]) => v > 0)) });
  }
  return { ...base, days: [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1)) };
}
