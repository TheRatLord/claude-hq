// @pure
/**
 * The secret grotto behind the waterfall (scene/grotto, world/grotto.ts): what the player has found there, kept per
 * browser profile (`claude-valley.grotto.v1`): when it was discovered (the map's "?" turns into a pin), visits, the
 * hidden chest (opened once, its geode lamp sent to the yard: model/shop.ts `geode`) and how far into the explorer's
 * journal you have read. Today's glow-caps are picked through the Collections book (`grottoSpawn`, a forage spawn of
 * its own: picked once a day like any find), so nothing here duplicates the book.
 *
 * Pure: no DOM, no three; the clock and the store are injected.
 */
import { dayKey } from './almanac.ts';
import { hashKey, rand } from './collection.ts';
import type { ForageSpawn } from './collection.ts';

export interface GrottoData {
  v: 1;
  /** first found (ms), null until then */
  found: number | null;
  /** visits into the cave (one a day counts once) */
  visits: number;
  /** YYYY-MM-DD of the last visit */
  last: string;
  /** the hidden chest: opened (ms) */
  chest: number | null;
  /** journal pages read (the furthest page reached, 0..JOURNAL.length) */
  pages: number;
}
export const emptyGrotto = (): GrottoData => ({ v: 1, found: null, visits: 0, last: '', chest: null, pages: 0 });

/** The explorer's journal, left open on a crate by the cold campfire: one page per E. */
export const JOURNAL: readonly string[] = Object.freeze([
  'Day 1. Followed the river up to the falls. Fern said there was nothing behind them. Fern was wrong, and I intend to tell her so at length.',
  'Day 3. The crystals change colour when nobody is looking. I have started looking very hard. They are patient.',
  'Day 4. A family of bats has accepted me as a sort of large, boring bat. I am honoured. I have stopped snoring, for their sake.',
  'Day 6. Paintings on the north wall: little orange farmers with hoes, the windmill, the very first field in neat rows. Somebody was here long before me. I touched up the windmill. I could not help it.',
  'Day 8. The fish in the pool have no eyes and no worries. I have two eyes and one worry, which is the lantern oil.',
  'Day 9. Heading home. I have left something in the chest for whoever is curious enough to come this far. Mind the drip by the door. — R.',
]);

/** Glow-caps grow in the grotto on most days (2 in 3), deterministic per date. */
export function glowcapToday(day: string): boolean {
  return rand(hashKey(`glowcap:${day}`))() < 0.67;
}
/** Today's glow-cap as a forage spawn (the Collections book remembers it picked for the day), or null. */
export function grottoSpawn(day: string): ForageSpawn | null {
  return glowcapToday(day) ? { key: `${day}:grotto:0`, id: 'glowcap', seed: hashKey(`glowcap:${day}:0`) } : null;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const stamp = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 8.64e15 ? Math.floor(v) : null);
const count = (v: unknown, max: number): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(max, Math.floor(v)) : 0);

/** Tolerant parse of stored data (anything malformed → null; bad fields fall back to empty). */
export function parseGrotto(raw: unknown): GrottoData | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return null;
  return {
    v: 1,
    found: stamp(o.found),
    visits: count(o.visits, 1e6),
    last: typeof o.last === 'string' && DAY_RE.test(o.last) ? o.last : '',
    chest: stamp(o.chest),
    pages: count(o.pages, JOURNAL.length),
  };
}

export interface GrottoStore { load(): unknown; save(data: GrottoData): void }

export interface GrottoService {
  /** bumps on every change */
  readonly version: number;
  data(): Readonly<GrottoData>;
  /** has the player found the grotto? (the map's pin, the stamp book) */
  discovered(): boolean;
  /** the player found it: true the first time */
  discover(): boolean;
  /** stepped into the cave (counts once a day); discovers it too */
  visit(): void;
  /** open the hidden chest: true the first time (the caller gives the geode lamp) */
  openChest(): boolean;
  readonly chestOpen: boolean;
  /** turn to the next journal page: its index (cycles round; the furthest page reached is kept) */
  readPage(): number;
  onChange(fn: () => void): () => void;
  /** dev: forget everything */
  devReset(): void;
}

export function createGrotto(store: GrottoStore | undefined, now: () => number = Date.now): GrottoService {
  let data: GrottoData;
  try { data = parseGrotto(store?.load()) ?? emptyGrotto(); } catch { data = emptyGrotto(); }
  let version = 0, page = -1;
  const fns = new Set<() => void>();
  const save = () => {
    version++;
    try { store?.save(data); } catch (err) { console.warn('[grotto] save failed', err); }
    for (const f of [...fns]) { try { f(); } catch (err) { console.error('[grotto] listener threw', err); } }
  };
  const svc: GrottoService = {
    get version() { return version; },
    data: () => data,
    discovered: () => data.found !== null,
    discover() {
      if (data.found !== null) return false;
      data.found = now();
      save();
      return true;
    },
    visit() {
      const day = dayKey(now());
      const first = data.found === null;
      if (first) data.found = now();
      if (data.last === day && !first) return;
      if (data.last !== day) { data.last = day; data.visits++; }
      save();
    },
    openChest() {
      if (data.chest !== null) return false;
      data.chest = now();
      save();
      return true;
    },
    get chestOpen() { return data.chest !== null; },
    readPage() {
      page = (page + 1) % JOURNAL.length;
      if (page + 1 > data.pages) { data.pages = page + 1; save(); }
      return page;
    },
    onChange(fn) { fns.add(fn); return () => fns.delete(fn); },
    devReset() { data = emptyGrotto(); page = -1; save(); },
  };
  return svc;
}
