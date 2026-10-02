// @pure
/**
 * The hillside orchard & apiary (scene/orchard, world/orchard.ts, docs/valley/orchard.md): what is ripe, what you
 * have picked today, when the hives have honey to spare, and when the bees are out.
 *
 *  - **Trees** go through the year by kind (`treePhase`): blossom in spring, cherries and plums ripe in summer (apples
 *    and pears still small and green), apples, pears and the last plums in autumn (cherries turning), bare in winter.
 *    A ripe tree carries 3–6 fruit a day (deterministic per date and tree, `fruitOnTree`); each shake brings down up to
 *    `SHAKE_DROP` of what's left, and a tree picked clean fills again tomorrow.
 *  - **Hives**: one jar of honey (two in summer) every `HONEY_DAYS` days, never in winter (`honeyReady`).
 *  - **Bees** (`beeActivity`): out on fine days from mid-morning to early evening, fewer in fog and cloud, none at
 *    night, in rain, storm or snow, or all winter (the colony clusters inside to keep warm).
 *  - **The press**: three apples or pears from the basket make a bottle of cider (`pressPlan`).
 *
 * Fruit and honey are finds in the Collections book (model/collection.ts, habitat 'orchard', never in the day's
 * forage batch) and go into the basket; cider is basket produce (`PRODUCE`). Persisted per browser profile
 * (`claude-valley.orchard.v1`): only today's picks per tree, each hive's last harvest day and lifetime totals.
 *
 * Pure: no DOM, no three; the clock and the store are injected.
 */
import type { Season, WeatherKind } from './types.ts';
import { dayKey } from './almanac.ts';
import { hashKey, rand } from './collection.ts';
import { ORCHARD_SITE } from '../world/orchard.ts';
import type { FruitKind } from '../world/orchard.ts';

export type { FruitKind } from '../world/orchard.ts';
export const FRUIT_KINDS: readonly FruitKind[] = Object.freeze(['apple', 'pear', 'plum', 'cherry']);

export interface FruitDef {
  kind: FruitKind;
  name: string;
  /** seasons the fruit is ripe and can be picked */
  ripe: readonly Season[];
  /** fruit carried on a ripe tree each day */
  perTree: readonly [number, number];
}
export const FRUIT: Readonly<Record<FruitKind, FruitDef>> = Object.freeze({
  apple: { kind: 'apple', name: 'Apple', ripe: ['autumn'], perTree: [4, 6] },
  pear: { kind: 'pear', name: 'Pear', ripe: ['autumn'], perTree: [3, 5] },
  plum: { kind: 'plum', name: 'Plum', ripe: ['summer', 'autumn'], perTree: [3, 5] },
  cherry: { kind: 'cherry', name: 'Cherries', ripe: ['summer'], perTree: [3, 6] },
});

/** what a tree looks like (and offers) this season */
export type TreePhase = 'blossom' | 'green' | 'ripe' | 'turning' | 'bare';
export function treePhase(kind: FruitKind, season: Season): TreePhase {
  if (season === 'winter') return 'bare';
  if (season === 'spring') return 'blossom';
  if (FRUIT[kind].ripe.includes(season)) return 'ripe';
  // summer apples / pears: small and green; autumn cherries: done fruiting, leaves turning
  return season === 'summer' ? 'green' : 'turning';
}
export const isRipe = (kind: FruitKind, season: Season): boolean => treePhase(kind, season) === 'ripe';

/** fruit a ripe tree carries today (0 out of season); deterministic per date and tree */
export function fruitOnTree(day: string, tree: number, kind: FruitKind, season: Season): number {
  if (!isRipe(kind, season)) return 0;
  const [lo, hi] = FRUIT[kind].perTree;
  return lo + Math.floor(rand(hashKey(`orchard:${day}:${tree}`))() * (hi - lo + 1));
}

/** most fruit one shake brings down */
export const SHAKE_DROP = 3;
/** days between honey harvests from one hive */
export const HONEY_DAYS = 3;
/** fruit the press takes for a bottle of cider */
export const CIDER_FRUIT = 3;
export const TREE_COUNT = ORCHARD_SITE.trees.length;
export const HIVE_COUNT = ORCHARD_SITE.hives.length;

// ---------------------------------------------------------------------------------------------
// Bees

export type BeeMood = 'out' | 'waking' | 'asleep' | 'sheltering' | 'wintering';
export interface BeeConditions { hour: number; season: Season; weather: WeatherKind }
const ramp = (a: number, b: number, v: number) => Math.min(1, Math.max(0, (v - a) / (b - a)));

/**
 * How many of the colony are out foraging, 0..1: a daylight curve (out from ~7, all out by ~9, home by ~19.5; an
 * hour longer in summer), damped by cloud and fog, none in rain / storm / snow or in winter.
 */
export function beeActivity(c: BeeConditions): number {
  if (c.season === 'winter') return 0;
  if (c.weather === 'rain' || c.weather === 'storm' || c.weather === 'snow') return 0;
  const late = c.season === 'summer' ? 1 : c.season === 'autumn' ? -0.5 : 0;
  const day = ramp(6.8, 9, c.hour) * (1 - ramp(18 + late, 19.6 + late, c.hour));
  const sky = c.weather === 'fog' ? 0.35 : c.weather === 'cloudy' ? 0.7 : 1;
  const season = c.season === 'autumn' ? 0.65 : c.season === 'spring' ? 0.9 : 1;
  return day * sky * season;
}
/** why the bees are (or aren't) out: for lines and hints */
export function beeMood(c: BeeConditions): BeeMood {
  if (c.season === 'winter') return 'wintering';
  if (c.weather === 'rain' || c.weather === 'storm' || c.weather === 'snow') return 'sheltering';
  const a = beeActivity(c);
  if (a > 0.3) return 'out';
  return c.hour >= 5 && c.hour < 12 ? 'waking' : 'asleep';
}

// ---------------------------------------------------------------------------------------------
// The press

/** What the press would take from the basket for one bottle: apples first, then pears (null: not enough fruit). */
export function pressPlan(basket: Readonly<Record<string, number>>): { apple: number; pear: number } | null {
  const n = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
  const a = n(basket.apple), p = n(basket.pear);
  if (a + p < CIDER_FRUIT) return null;
  const apple = Math.min(a, CIDER_FRUIT);
  return { apple, pear: CIDER_FRUIT - apple };
}

// ---------------------------------------------------------------------------------------------
// The store

export interface OrchardData {
  v: 1;
  /** today (YYYY-MM-DD): `picked` is today's */
  day: string;
  /** fruit already shaken down today, per tree index */
  picked: Record<string, number>;
  /** each hive's last harvest day, per hive index */
  hives: Record<string, string>;
  /** lifetime: fruit shaken down, shakes, jars of honey, bottles pressed */
  total: { fruit: number; shakes: number; honey: number; cider: number };
}
export const emptyOrchard = (): OrchardData => ({ v: 1, day: '', picked: {}, hives: {}, total: { fruit: 0, shakes: 0, honey: 0, cider: 0 } });

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const int = (v: unknown, max = 1e9): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(max, Math.floor(v)) : 0);
const isIdx = (k: string, n: number) => /^\d{1,3}$/.test(k) && Number(k) < n;

/** Tolerant parse of stored data (anything malformed → null; bad fields fall back to empty). */
export function parseOrchard(raw: unknown): OrchardData | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return null;
  const d = emptyOrchard();
  if (typeof o.day === 'string' && DAY_RE.test(o.day)) d.day = o.day;
  if (o.picked && typeof o.picked === 'object' && !Array.isArray(o.picked)) {
    for (const [k, v] of Object.entries(o.picked as Record<string, unknown>)) if (isIdx(k, TREE_COUNT) && int(v, 99)) d.picked[k] = int(v, 99);
  }
  if (o.hives && typeof o.hives === 'object' && !Array.isArray(o.hives)) {
    for (const [k, v] of Object.entries(o.hives as Record<string, unknown>)) if (isIdx(k, HIVE_COUNT) && typeof v === 'string' && DAY_RE.test(v)) d.hives[k] = v;
  }
  const t = (o.total && typeof o.total === 'object' ? o.total : {}) as Record<string, unknown>;
  d.total = { fruit: int(t.fruit), shakes: int(t.shakes), honey: int(t.honey), cider: int(t.cider) };
  return d;
}

/** whole days from a to b (YYYY-MM-DD, local calendar days; b ≥ a → ≥ 0) */
export function daysBetween(a: string, b: string): number {
  const p = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(b) - p(a)) / 86_400_000);
}

/** start a new day (mutates): yesterday's picks are forgotten */
export function rollDay(d: OrchardData, day: string): void {
  if (d.day === day) return;
  d.day = day;
  d.picked = {};
}

/** fruit left on tree `i` today */
export function fruitLeft(d: OrchardData, day: string, i: number, season: Season): number {
  const t = ORCHARD_SITE.trees[i];
  if (!t) return 0;
  const picked = d.day === day ? d.picked[String(i)] ?? 0 : 0;
  return Math.max(0, fruitOnTree(day, i, t.kind, season) - picked);
}

export interface ShakeResult {
  kind: FruitKind;
  /** fruit that came down (0: not ripe, or picked clean) */
  n: number;
  /** still on the tree after this shake */
  left: number;
  phase: TreePhase;
}
/** Shake tree `i` (mutates): up to SHAKE_DROP of today's fruit comes down. Null for an unknown tree. */
export function shakeTree(d: OrchardData, day: string, i: number, season: Season): ShakeResult | null {
  const t = ORCHARD_SITE.trees[i];
  if (!t) return null;
  rollDay(d, day);
  const phase = treePhase(t.kind, season);
  const before = fruitLeft(d, day, i, season);
  const n = Math.min(SHAKE_DROP, before);
  d.total.shakes++;
  if (n > 0) { d.picked[String(i)] = (d.picked[String(i)] ?? 0) + n; d.total.fruit += n; }
  return { kind: t.kind, n, left: before - n, phase };
}

/** jars a hive gives when harvested this season (0 in winter) */
export const honeyJars = (season: Season): number => (season === 'winter' ? 0 : season === 'summer' ? 2 : 1);
/** has hive `i` honey to spare today? (a hive never harvested has some) */
export function honeyReady(d: OrchardData, day: string, i: number, season: Season): boolean {
  if (i < 0 || i >= HIVE_COUNT || !honeyJars(season)) return false;
  const last = d.hives[String(i)];
  return !last || daysBetween(last, day) >= HONEY_DAYS;
}
/** days until hive `i` has honey again (0 = ready; in winter: until spring, reported as -1) */
export function honeyIn(d: OrchardData, day: string, i: number, season: Season): number {
  if (!honeyJars(season)) return -1;
  const last = d.hives[String(i)];
  return last ? Math.max(0, HONEY_DAYS - daysBetween(last, day)) : 0;
}
/** Take hive `i`'s honey (mutates): the jars, 0 when it has none to spare. */
export function takeHoney(d: OrchardData, day: string, i: number, season: Season): number {
  if (!honeyReady(d, day, i, season)) return 0;
  const n = honeyJars(season);
  d.hives[String(i)] = day;
  d.total.honey += n;
  return n;
}

export interface OrchardStore { load(): unknown; save(data: OrchardData): void }

export interface OrchardService {
  /** bumps on every change */
  readonly version: number;
  data(): Readonly<OrchardData>;
  today(): string;
  fruitLeft(i: number, season: Season): number;
  shake(i: number, season: Season): ShakeResult | null;
  honeyReady(i: number, season: Season): boolean;
  honeyIn(i: number, season: Season): number;
  takeHoney(i: number, season: Season): number;
  /** a bottle was pressed */
  pressed(): void;
  onChange(fn: () => void): () => void;
  /** dev: every tree full again today, every hive ready */
  devRefill(): void;
  /** dev: forget everything */
  devReset(): void;
}

export function createOrchard(store: OrchardStore | undefined, now: () => number = Date.now): OrchardService {
  let d: OrchardData;
  try { d = parseOrchard(store?.load()) ?? emptyOrchard(); } catch { d = emptyOrchard(); }
  let version = 0;
  const fns = new Set<() => void>();
  const today = () => dayKey(now());
  const changed = () => {
    version++;
    try { store?.save(d); } catch (err) { console.warn('[orchard] save failed', err); }
    for (const f of [...fns]) { try { f(); } catch (err) { console.error('[orchard] listener threw', err); } }
  };
  return {
    get version() { return version; },
    data: () => d,
    today,
    fruitLeft: (i, s) => fruitLeft(d, today(), i, s),
    shake(i, s) { const r = shakeTree(d, today(), i, s); if (r) changed(); return r; },
    honeyReady: (i, s) => honeyReady(d, today(), i, s),
    honeyIn: (i, s) => honeyIn(d, today(), i, s),
    takeHoney(i, s) { const n = takeHoney(d, today(), i, s); if (n) changed(); return n; },
    pressed() { d.total.cider++; changed(); },
    onChange(fn) { fns.add(fn); return () => fns.delete(fn); },
    devRefill() { d.picked = {}; d.hives = {}; changed(); },
    devReset() { d = emptyOrchard(); changed(); },
  };
}
