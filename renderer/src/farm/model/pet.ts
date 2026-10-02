// @pure
/**
 * Your own pet (scene/life/companion.ts walks it, hud/pet.ts adopts and names it).
 *
 *  - **Adoption**: Fern the ranger looks after a basket of foundlings by her signpost. Once she knows you a little
 *    (`FREE_HEARTS` hearts) one goes home with you for free; before that, a donation to the ranger's kibble fund
 *    (`ADOPT_FEE` bits) does it. A **puppy** or a **kitten**, in one of a few coats; the rare **fox kit** only goes to
 *    someone Fern really trusts (`FOX_HEARTS`). You name it (`sanitizeName`; a few suggestions per species).
 *  - **Happiness** (0..100, starts at `START_HAPPY`): grows with the day's pets, walks together, games of fetch and
 *    finds it shows you, each with a daily cap (`GAINS`) so it rewards visiting, not grinding. A day without a pat
 *    costs a little; whole days away cost more (never below `FLOOR`). Shown as 0..5 hearts and a mood word.
 *
 * Pure: no DOM, no three; the clock and the store are injected (browser-local storage in the app, memory in tests).
 */
import { dayKey } from './almanac.ts';

export type Species = 'puppy' | 'kitten' | 'fox';

export interface CoatDef { id: string; name: string; /** css swatch */ swatch: string }
export interface SpeciesDef {
  id: Species;
  name: string;
  blurb: string;
  coats: readonly CoatDef[];
  /** suggested names (three are offered, seeded per day) */
  names: readonly string[];
  /** needs Fern's trust (`FOX_HEARTS`) */
  rare?: boolean;
}

export const SPECIES: readonly SpeciesDef[] = Object.freeze([
  {
    id: 'puppy', name: 'Puppy', blurb: 'All ears and paws. Loves walks, sticks and everyone.',
    coats: [
      { id: 'golden', name: 'Golden', swatch: '#e9b866' }, { id: 'beagle', name: 'Tricolour', swatch: '#c98a43' },
      { id: 'cocoa', name: 'Cocoa', swatch: '#7d4c2f' }, { id: 'speckles', name: 'Speckled', swatch: '#fbf7f0' },
    ],
    names: ['Pip', 'Waffles', 'Bean', 'Clover', 'Nugget', 'Maple', 'Pickle', 'Scout', 'Biscotti', 'Toffee'],
  },
  {
    id: 'kitten', name: 'Kitten', blurb: 'Curious, sleepy, secretly devoted. Fetch is negotiable.',
    coats: [
      { id: 'ginger', name: 'Ginger tabby', swatch: '#f0a056' }, { id: 'tuxedo', name: 'Tuxedo', swatch: '#2d2b32' },
      { id: 'smoke', name: 'Smoke', swatch: '#96a0b0' }, { id: 'siamese', name: 'Siamese', swatch: '#f4e8d4' },
    ],
    names: ['Miso', 'Pebble', 'Tofu', 'Juniper', 'Sprout', 'Button', 'Fig', 'Noodle', 'Dumpling', 'Socks'],
  },
  {
    id: 'fox', name: 'Fox kit', blurb: 'An orphaned kit Fern raised by hand. Shy, clever, a nose for finds.', rare: true,
    coats: [{ id: 'red', name: 'Red', swatch: '#e2742e' }, { id: 'arctic', name: 'Arctic', swatch: '#f2f3f6' }, { id: 'silver', name: 'Silver', swatch: '#4c4852' }],
    names: ['Ember', 'Rusty', 'Sorrel', 'Tansy', 'Kit', 'Bramble', 'Cinder', 'Juniper'],
  },
]);
export const speciesDef = (id: string): SpeciesDef | undefined => SPECIES.find((s) => s.id === id);

/** Fern's hearts for a free adoption; her trust for the fox kit; the kibble-fund donation otherwise */
export const FREE_HEARTS = 2;
export const FOX_HEARTS = 4;
export const ADOPT_FEE = 60;
export const START_HAPPY = 50;
export const FLOOR = 10;
export const NAME_MAX = 14;

/** per action: happiness gained, and how many count per day */
export const GAINS = Object.freeze({
  pet: { gain: 4, perDay: 3 },
  /** per `WALK_STEP` metres walked together */
  walk: { gain: 1, perDay: 10 },
  fetch: { gain: 3, perDay: 5 },
  find: { gain: 4, perDay: 3 },
});
export const WALK_STEP = 100;
/** a day that ended without a single pat; each whole day away on top */
export const MISS_DAY = 5;
export const AWAY_DAY = 8;

export interface PetInfo { species: Species; coat: string; name: string; /** adoption date (YYYY-MM-DD) */ since: string }
export interface PetToday { pets: number; walk: number; fetch: number; finds: number }
export interface PetData {
  v: 1;
  pet: PetInfo | null;
  happy: number;
  /** the day `today` counts */
  day: string;
  today: PetToday;
  total: PetToday;
  /** consecutive days with at least one pat */
  streak: number;
}

export const emptyPet = (): PetData => ({ v: 1, pet: null, happy: START_HAPPY, day: '', today: { pets: 0, walk: 0, fetch: 0, finds: 0 }, total: { pets: 0, walk: 0, fetch: 0, finds: 0 }, streak: 0 });

const num = (v: unknown, lo: number, hi: number, dflt: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);
const counts = (raw: unknown): PetToday => {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { pets: Math.floor(num(o.pets, 0, 1e9, 0)), walk: num(o.walk, 0, 1e12, 0), fetch: Math.floor(num(o.fetch, 0, 1e9, 0)), finds: Math.floor(num(o.finds, 0, 1e9, 0)) };
};

/**
 * A pet's name, made safe: no markup or control / bidi characters, letters (any script), digits, spaces, apostrophes,
 * dots and hyphens only, whitespace collapsed, at most `NAME_MAX` characters, the first letter capitalised. Empty →
 * `fallback`.
 */
export function sanitizeName(raw: unknown, fallback = 'Pip'): string {
  let s = typeof raw === 'string' ? raw.normalize('NFC') : '';
  s = s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').replace(/[^\p{L}\p{M}\p{N} '’.-]/gu, '').replace(/\s+/g, ' ').trim();
  s = s.replace(/^[-'’. ]+/, '').replace(/[-'’ ]+$/, '');
  const chars = Array.from(s).slice(0, NAME_MAX);
  s = chars.join('').trim();
  if (!s) return fallback;
  return s.charAt(0).toLocaleUpperCase() + s.slice(1);
}

/** Tolerant parse of stored data (anything malformed → null; an unknown species / coat drops the pet). */
export function parsePet(raw: unknown): PetData | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return null;
  let pet: PetInfo | null = null;
  if (o.pet && typeof o.pet === 'object') {
    const q = o.pet as Record<string, unknown>;
    const sd = typeof q.species === 'string' ? speciesDef(q.species) : undefined;
    if (sd) {
      const coat = typeof q.coat === 'string' && sd.coats.some((c) => c.id === q.coat) ? q.coat : sd.coats[0].id;
      pet = { species: sd.id, coat, name: sanitizeName(q.name, sd.names[0]), since: typeof q.since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.since) ? q.since : '' };
    }
  }
  return {
    v: 1, pet,
    happy: num(o.happy, 0, 100, START_HAPPY),
    day: typeof o.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.day) ? o.day : '',
    today: counts(o.today), total: counts(o.total),
    streak: Math.floor(num(o.streak, 0, 1e6, 0)),
  };
}

// ---------------------------------------------------------------------------------------------
// Adoption

export interface Offer {
  /** bits to pay (0 when Fern trusts you) */
  fee: number;
  /** the fox kit is on offer */
  fox: boolean;
  /** Fern's hearts right now, and how many more until it's free / the fox */
  hearts: number;
  toFree: number;
  toFox: number;
}
export function offerFor(fernHearts: number): Offer {
  const h = Math.max(0, Math.floor(fernHearts || 0));
  return { fee: h >= FREE_HEARTS ? 0 : ADOPT_FEE, fox: h >= FOX_HEARTS, hearts: h, toFree: Math.max(0, FREE_HEARTS - h), toFox: Math.max(0, FOX_HEARTS - h) };
}

export type AdoptResult = { ok: true; pet: PetInfo; fee: number } | { ok: false; reason: 'already' | 'species' | 'fox' | 'coins' };

/** Adopt (pure: the caller takes the fee). `coins` = what the player holds. */
export function adopt(d: PetData, species: string, coat: string, name: string, o: { fernHearts: number; coins: number; nowMs: number; free?: boolean }): AdoptResult {
  if (d.pet) return { ok: false, reason: 'already' };
  const sd = speciesDef(species);
  if (!sd) return { ok: false, reason: 'species' };
  const offer = offerFor(o.fernHearts);
  if (sd.rare && !offer.fox && !o.free) return { ok: false, reason: 'fox' };
  const fee = o.free ? 0 : offer.fee;
  if (fee > o.coins) return { ok: false, reason: 'coins' };
  const day = dayKey(o.nowMs);
  const pet: PetInfo = { species: sd.id, coat: sd.coats.some((c) => c.id === coat) ? coat : sd.coats[0].id, name: sanitizeName(name, sd.names[0]), since: day };
  d.pet = pet;
  d.happy = START_HAPPY;
  d.day = day;
  d.today = { pets: 0, walk: 0, fetch: 0, finds: 0 };
  d.streak = 0;
  return { ok: true, pet, fee };
}

/** three suggested names for a species, varied per day */
export function suggestNames(species: string, nowMs: number): string[] {
  const sd = speciesDef(species) ?? SPECIES[0];
  const key = dayKey(nowMs);
  let h = 2166136261;
  for (const ch of key + sd.id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const out: string[] = [];
  for (let i = 0; out.length < 3 && i < sd.names.length * 2; i++) {
    const n = sd.names[(h + i * 7) % sd.names.length];
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Happiness

const DAY_MS = 86_400_000;
const daysBetween = (a: string, b: string): number => {
  const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((new Date(y2, m2 - 1, d2, 12).getTime() - new Date(y1, m1 - 1, d1, 12).getTime()) / DAY_MS);
};

/** Roll `today` over to the date of `nowMs` (decay for missed pats / days away, the streak). Returns true if it rolled. */
export function rollDay(d: PetData, nowMs: number): boolean {
  const day = dayKey(nowMs);
  if (d.day === day) return false;
  if (d.pet && d.day) {
    const gap = Math.max(1, daysBetween(d.day, day));
    let loss = d.today.pets === 0 ? MISS_DAY : 0;
    loss += (gap - 1) * AWAY_DAY;
    if (loss) d.happy = Math.max(Math.min(d.happy, FLOOR), d.happy - loss);
    if (d.today.pets === 0 || gap > 1) d.streak = 0;
  }
  d.day = day;
  d.today = { pets: 0, walk: 0, fetch: 0, finds: 0 };
  return true;
}

export type PetAction = 'pet' | 'fetch' | 'find';
/** Count an action (rolls the day first). Returns the happiness gained (0 once the day's cap is reached). */
export function act(d: PetData, a: PetAction, nowMs: number): number {
  if (!d.pet) return 0;
  rollDay(d, nowMs);
  const key = a === 'pet' ? 'pets' : a === 'fetch' ? 'fetch' : 'finds';
  const g = GAINS[a];
  const before = d.today[key];
  d.today[key]++;
  d.total[key]++;
  if (a === 'pet' && before === 0) d.streak++;
  if (before >= g.perDay) return 0;
  const gain = Math.min(g.gain, 100 - d.happy);
  d.happy += gain;
  return gain;
}

/** Metres walked together (rolls the day first). Returns the happiness gained. */
export function walked(d: PetData, metres: number, nowMs: number): number {
  if (!d.pet || !(metres > 0) || !Number.isFinite(metres)) return 0;
  rollDay(d, nowMs);
  const before = Math.floor(d.today.walk / WALK_STEP);
  d.today.walk += metres;
  d.total.walk += metres;
  const steps = Math.min(GAINS.walk.perDay, Math.floor(d.today.walk / WALK_STEP)) - Math.min(GAINS.walk.perDay, before);
  if (steps <= 0) return 0;
  const gain = Math.min(steps * GAINS.walk.gain, 100 - d.happy);
  d.happy += gain;
  return gain;
}

/** 0..5 hearts */
export const heartsOf = (happy: number): number => Math.max(0, Math.min(5, Math.floor(happy / 20)));
export function moodOf(happy: number): string {
  if (happy >= 85) return 'over the moon';
  if (happy >= 65) return 'happy';
  if (happy >= 40) return 'content';
  if (happy >= 20) return 'a bit lonely';
  return 'lonely';
}

// ---------------------------------------------------------------------------------------------
// The service (wired by scene/life/companion.ts; the HUD reads it as scene service 'companion')

export interface PetStore { load(): unknown; save(d: PetData): void }
export type PetChange =
  | { kind: 'adopt'; pet: PetInfo; fee: number }
  | { kind: 'rename'; name: string }
  | { kind: 'act'; act: PetAction | 'walk'; gain: number }
  | { kind: 'day' }
  | { kind: 'dev' };

export interface PetModelService {
  readonly version: number;
  data(): Readonly<PetData>;
  adopt(species: string, coat: string, name: string, o: { fernHearts: number; coins: number; free?: boolean }): AdoptResult;
  rename(name: string): string | null;
  act(a: PetAction): number;
  walked(metres: number): number;
  /** roll the day if the date changed (decay); cheap, call now and then */
  tick(): void;
  onChange(fn: (c: PetChange) => void): () => void;
  devSet(o: Partial<{ happy: number; pet: PetInfo | null }>): void;
  devReset(): void;
}

export function createPetModel(st: PetStore | undefined, o: { now?: () => number } = {}): PetModelService {
  const now = o.now ?? Date.now;
  let d: PetData;
  try { d = parsePet(st?.load()) ?? emptyPet(); } catch { d = emptyPet(); }
  let version = 0, savedWalk = Math.floor(d.today.walk / 25);
  const fns = new Set<(c: PetChange) => void>();
  const changed = (c: PetChange, save = true) => {
    version++;
    if (save) { try { st?.save(d); } catch (err) { console.warn('[pet] save failed', err); } }
    for (const f of [...fns]) { try { f(c); } catch (err) { console.error('[pet] listener threw', err); } }
  };
  return {
    get version() { return version; },
    data: () => d,
    adopt(species, coat, name, x) {
      const r = adopt(d, species, coat, name, { ...x, nowMs: now() });
      if (r.ok) changed({ kind: 'adopt', pet: r.pet, fee: r.fee });
      return r;
    },
    rename(name) {
      if (!d.pet) return null;
      const n = sanitizeName(name, d.pet.name);
      if (n !== d.pet.name) { d.pet.name = n; changed({ kind: 'rename', name: n }); }
      return n;
    },
    act(a) { const g = act(d, a, now()); changed({ kind: 'act', act: a, gain: g }); return g; },
    walked(m) {
      const g = walked(d, m, now());
      // a walk is saved every 25 m (and with any gain), not every frame
      const k = Math.floor(d.today.walk / 25);
      if (g || k !== savedWalk) { savedWalk = k; changed({ kind: 'act', act: 'walk', gain: g }, true); }
      return g;
    },
    tick() { if (rollDay(d, now())) { savedWalk = 0; changed({ kind: 'day' }); } },
    onChange(fn) { fns.add(fn); return () => fns.delete(fn); },
    devSet(x) {
      if (x.happy !== undefined) d.happy = Math.max(0, Math.min(100, x.happy));
      if (x.pet !== undefined) d.pet = x.pet;
      if (!d.day) d.day = dayKey(now());
      changed({ kind: 'dev' });
    },
    devReset() { d = emptyPet(); savedWalk = 0; changed({ kind: 'dev' }); },
  };
}

/**
 * Scene service 'companion' (scene/life/companion.ts), read by the HUD's adoption card (hud/pet.ts) and the dev API.
 * `adopt` takes the kibble-fund fee from the wallet when Fern doesn't know you well enough yet.
 */
export interface CompanionService {
  readonly model: PetModelService;
  /** Fern's offer right now, and the bits in your purse */
  offer(): Offer & { coins: number };
  adopt(species: string, coat: string, name: string): AdoptResult;
  /** dev / tests: `dev('puppy' | 'kitten' | 'fox', coat?, name?)` adopts free and brings it to you; 'fetch', 'find',
   *  'pet', 'home', 'sniff', 'reset' (forget the pet), 'state' */
  dev(cmd?: string, a?: string, b?: string): unknown;
  /** where your pet is (feet, world) and its name, null without one or while it is out of the world (photo mode's
   *  "who's in frame", farm/photo.ts); the object is reused */
  where?(): { x: number; y: number; z: number; name: string } | null;
}
