// @pure
/**
 * Barn chores (the walk-in barn, scene/interior/barn.ts): once a day the animals want feeding — hay for Daisy the cow,
 * Pepper the donkey and the sheep, grain for the hens. A fed cow can be milked once a day, the donkey loves a brush,
 * and the hens lay a few eggs every day (more when they were fed the day before) for you to collect. Eggs and milk go
 * into the basket (model/wallet.ts; sold like any find). A day with every animal fed counts toward the "Barn chores"
 * stamp (model/stamps.ts `chores`).
 *
 * Pure: no DOM, no three; the clock and the store are injected (browser-local storage `claude-valley.barn.v1`).
 */
import { dayKey } from './almanac.ts';
import { hashKey, rand } from './collection.ts';

export const BARN_ANIMALS = Object.freeze(['cow', 'donkey', 'sheep', 'hens'] as const);
export type BarnAnimal = (typeof BARN_ANIMALS)[number];
/** what each animal eats */
export const FEED: Readonly<Record<BarnAnimal, 'hay' | 'grain'>> = Object.freeze({ cow: 'hay', donkey: 'hay', sheep: 'hay', hens: 'grain' });

export interface BarnData {
  v: 1;
  /** the day the `today` fields belong to (YYYY-MM-DD) */
  day: string;
  fed: BarnAnimal[];
  milked: boolean;
  brushed: boolean;
  /** eggs collected today */
  eggs: number;
  /** were the hens fed yesterday (an extra egg today) */
  hensFedYesterday: boolean;
  /** lifetime: days with every animal fed, eggs collected, pails of milk, feeds */
  total: { days: number; eggs: number; milk: number; feeds: number; brushes: number };
}

export const emptyBarn = (): BarnData => ({ v: 1, day: '', fed: [], milked: false, brushed: false, eggs: 0, hensFedYesterday: false, total: { days: 0, eggs: 0, milk: 0, feeds: 0, brushes: 0 } });

const int = (v: unknown, hi = 1e7): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(hi, Math.floor(v)) : 0);

/** Tolerant parse (anything malformed → null). */
export function parseBarn(raw: unknown): BarnData | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return null;
  const d = emptyBarn();
  d.day = typeof o.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.day) ? o.day : '';
  d.fed = Array.isArray(o.fed) ? [...new Set(o.fed.filter((x): x is BarnAnimal => (BARN_ANIMALS as readonly unknown[]).includes(x)))] : [];
  d.milked = o.milked === true;
  d.brushed = o.brushed === true;
  d.eggs = int(o.eggs, 99);
  d.hensFedYesterday = o.hensFedYesterday === true;
  const t = (o.total && typeof o.total === 'object' ? o.total : {}) as Record<string, unknown>;
  d.total = { days: int(t.days), eggs: int(t.eggs), milk: int(t.milk), feeds: int(t.feeds), brushes: int(t.brushes) };
  return d;
}

/** the day before a YYYY-MM-DD key */
function prevDay(day: string): string {
  const [y, m, dd] = day.split('-').map(Number);
  return dayKey(new Date(y, m - 1, dd - 1, 12).getTime());
}

/** Move the day's fields on to `day` (a new day: hungry animals, fresh eggs). Returns true if it rolled. */
export function rollDay(d: BarnData, day: string): boolean {
  if (d.day === day) return false;
  d.hensFedYesterday = d.day === prevDay(day) && d.fed.includes('hens');
  d.day = day; d.fed = []; d.milked = false; d.brushed = false; d.eggs = 0;
  return true;
}

/** Eggs the hens lay on a day (2..4, seeded per day; one more if they were fed the day before, at most 5). */
export function eggsLaid(day: string, fedYesterday: boolean): number {
  const r = rand(hashKey(`barn-eggs:${day}`));
  return Math.min(5, 2 + Math.floor(r() * 3) + (fedYesterday ? 1 : 0));
}

export type FeedResult = { ok: false; reason: 'fed' | 'food' } | { ok: true; /** every animal is fed now (first time today) */ allDone: boolean };

/** Feed one animal with what you carry. */
export function feed(d: BarnData, a: BarnAnimal, food: 'hay' | 'grain' | null, day: string): FeedResult {
  rollDay(d, day);
  if (d.fed.includes(a)) return { ok: false, reason: 'fed' };
  if (food !== FEED[a]) return { ok: false, reason: 'food' };
  d.fed.push(a);
  d.total.feeds++;
  const allDone = BARN_ANIMALS.every((x) => d.fed.includes(x));
  if (allDone) d.total.days++;
  return { ok: true, allDone };
}

/** Milk the cow: once a day, after she has had her hay. */
export function milk(d: BarnData, day: string): 'ok' | 'hungry' | 'done' {
  rollDay(d, day);
  if (d.milked) return 'done';
  if (!d.fed.includes('cow')) return 'hungry';
  d.milked = true;
  d.total.milk++;
  return 'ok';
}

/** Brush the donkey (the first brush of the day counts). */
export function brush(d: BarnData, day: string): boolean {
  rollDay(d, day);
  if (d.brushed) return false;
  d.brushed = true;
  d.total.brushes++;
  return true;
}

/** Eggs waiting in the nest boxes right now. */
export function eggsWaiting(d: BarnData, day: string): number {
  const fy = d.day === day ? d.hensFedYesterday : d.day === prevDay(day) && d.fed.includes('hens');
  return Math.max(0, eggsLaid(day, fy) - (d.day === day ? d.eggs : 0));
}

/** Collect every egg waiting; returns how many. */
export function collectEggs(d: BarnData, day: string): number {
  rollDay(d, day);
  const n = eggsWaiting(d, day);
  d.eggs += n;
  d.total.eggs += n;
  return n;
}

// ---------------------------------------------------------------------------------------------
// The service (persisted; published by the interior system as service 'barn')

export interface BarnStore { load(): unknown; save(data: unknown): void }

export interface BarnService {
  /** bumps on every change */
  readonly version: number;
  /** today's view (rolled to today first) */
  data(): Readonly<BarnData>;
  fed(a: BarnAnimal): boolean;
  feed(a: BarnAnimal, food: 'hay' | 'grain' | null): FeedResult;
  milk(): 'ok' | 'hungry' | 'done';
  brush(): boolean;
  eggsWaiting(): number;
  collectEggs(): number;
  onChange(fn: () => void): () => void;
  /** dev: forget today (hungry animals, eggs back in the boxes) */
  reset(): void;
}

export function createBarn(st: BarnStore | undefined, o: { now?: () => number } = {}): BarnService {
  const now = o.now ?? Date.now;
  let d: BarnData;
  try { d = parseBarn(st?.load()) ?? emptyBarn(); } catch { d = emptyBarn(); }
  let version = 0;
  const fns = new Set<() => void>();
  const today = () => dayKey(now());
  const changed = () => {
    version++;
    try { st?.save(d); } catch (err) { console.warn('[barn] save failed', err); }
    for (const f of [...fns]) { try { f(); } catch (err) { console.error('[barn] listener threw', err); } }
  };
  const roll = () => { if (rollDay(d, today())) changed(); };
  return {
    get version() { return version; },
    data: () => { roll(); return d; },
    fed: (a) => { roll(); return d.fed.includes(a); },
    feed(a, food) { const r = feed(d, a, food, today()); if (r.ok) changed(); return r; },
    milk() { const r = milk(d, today()); if (r === 'ok') changed(); return r; },
    brush() { const r = brush(d, today()); if (r) changed(); return r; },
    eggsWaiting: () => eggsWaiting(d, today()),
    collectEggs() { const n = collectEggs(d, today()); if (n) changed(); return n; },
    onChange(fn) { fns.add(fn); return () => fns.delete(fn); },
    reset() { const t = d.total; d = emptyBarn(); d.total = t; d.day = today(); changed(); },
  };
}
