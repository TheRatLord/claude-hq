// @pure
/**
 * Collections: the player's own cozy pastime between checking on the agents. Forageables turn up around the valley
 * each real day (season-appropriate, deterministic per date) and fish bite at the pond and the river by season, hour
 * and weather. Everything found goes into the Collections book (count, first-found date, best size for fish).
 *
 * Pure: no DOM, no three; the clock and the store are injected (browser-local storage in the app, memory in tests).
 * Days are local calendar days (`YYYY-MM-DD`, see `dayKey` in almanac.ts).
 */
import type { Season, WeatherKind } from './types.ts';
import { dayKey } from './almanac.ts';
import { mulberry32 } from '../../../../shared/identity.ts';

export type CollectKind = 'forage' | 'fish';
/** where a forageable grows: open meadow, under / beside trees, the water's edge, the foot of the cliffs, or only in the
 *  secret grotto behind the waterfall (scene/grotto) or the hillside orchard's trees and hives (scene/orchard): those
 *  two are never in the day's valley batch */
export type Habitat = 'meadow' | 'wood' | 'shore' | 'cliff' | 'grotto' | 'orchard';
/** 'cave': the still pool in the grotto behind the waterfall (scene/grotto) */
export type WaterKind = 'pond' | 'river' | 'cave';
/** when a fish bites: any time, daylight only, dark only, around dawn and dusk */
export type FishTime = 'any' | 'day' | 'night' | 'twilight';
/** weather a fish needs: any, rain (or storm) only, clear skies only */
export type FishWeather = 'any' | 'rain' | 'clear';

interface Base {
  id: string;
  name: string;
  /** flavour text in the valley's voice */
  blurb: string;
  seasons: readonly Season[];
  /** relative odds among what is possible right now */
  weight: number;
  rare?: boolean;
  /** one css colour for swatches and the HUD icon */
  color: string;
}
export interface ForageDef extends Base { kind: 'forage'; habitat: Habitat }
export interface FishDef extends Base {
  kind: 'fish';
  water: readonly WaterKind[];
  time: FishTime;
  weather: FishWeather;
  /** size range, cm */
  cm: readonly [number, number];
  /** not a fish (boots, bottles): no size */
  junk?: boolean;
  /** body colours for the 3D catch and the HUD icon: back, belly, fins / accent */
  look: readonly [string, string, string];
}
export type CollectDef = ForageDef | FishDef;

const ALL: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];
const F = (id: string, name: string, seasons: readonly Season[], habitat: Habitat, weight: number, color: string, blurb: string, rare = false): ForageDef =>
  ({ kind: 'forage', id, name, seasons, habitat, weight, color, blurb, ...(rare ? { rare } : {}) });
const FISH = (id: string, name: string, o: Omit<FishDef, 'kind' | 'id' | 'name'>): FishDef => ({ kind: 'fish', id, name, ...o });

/** Every collectible, in book order (forage by season, then fish). Ids are stable (they are the save keys). */
export const CATALOG: readonly CollectDef[] = Object.freeze([
  F('morel', 'Morel', ['spring'], 'wood', 3, '#b08a5a',
    'A honeycomb cap hiding under last year\'s leaves. Fern swears they come up the morning after a thunderstorm.'),
  F('wildleek', 'Wild leeks', ['spring'], 'wood', 3, '#6cbf55',
    'Ramps, if you\'re from over the ridge. The whole wood smells of garlic for a week in April.'),
  F('violet', 'Sweet violet', ['spring'], 'meadow', 3, '#8e5fc2',
    'Tiny, purple and shy. Posy presses one into every letter that goes out in spring.'),
  F('berries', 'Wild strawberries', ['summer'], 'meadow', 3, '#e0404a',
    'No bigger than a fingernail and twice as sweet as the garden ones. Nobody has ever brought a full basket home.'),
  F('feather', 'Jay feather', ['summer'], 'meadow', 2, '#4f8fd8',
    'Barred blue, dropped by a jay on its way somewhere important. Nimbus says it means fair weather. Nimbus says that about everything.'),
  F('shell', 'Pond mussel shell', ['summer'], 'shore', 2, '#e8d6c8',
    'Pearly inside and pleasingly heavy. Hold it to your ear and you can hear… the pond.'),
  F('skipstone', 'Skipping stone', ['summer'], 'shore', 2, '#8f9aa6',
    'Perfectly flat, perfectly round. Far too good to skip, really.'),
  F('chanterelle', 'Chanterelle', ['autumn'], 'wood', 3, '#f0a83a',
    'Golden trumpets that smell faintly of apricots. Hazel trades a sack of flour for a basket.'),
  F('acorn', 'Acorn', ['autumn'], 'wood', 3, '#a8763f',
    'Still wearing its little hat. The squirrels have counted these and they will notice.'),
  F('hazelnut', 'Hazelnut', ['autumn'], 'wood', 2, '#b9824a',
    'Cracks with a satisfying pop. The Mayor insists the miller is named after them; Hazel insists otherwise.'),
  F('mapleleaf', 'Maple leaf', ['autumn'], 'meadow', 3, '#d8452a',
    'Red on one side, gold on the other, and not another one like it anywhere in the valley.'),
  F('holly', 'Holly sprig', ['winter'], 'wood', 3, '#2f7a3f',
    'Glossy leaves and three red berries. Bram hangs one over the shipping bin for luck.'),
  F('pinecone', 'Pinecone', ['winter'], 'wood', 3, '#8a5a32',
    'Closes up tight when rain is coming. A better forecaster than some we could name.'),
  F('crystal', 'Frost crystal', ['winter'], 'cliff', 1, '#9fd8f0',
    'A clear quartz point from the foot of the cliffs. The standing stones hum when you carry one past.', true),
  F('glowcap', 'Glow-cap', ALL, 'grotto', 1, '#7ff0c8',
    'A little mushroom that glows sea-green in the dark, found only in the grotto behind the falls. Hold one up and the bats lean in to read by it.', true),
  // the hillside orchard (scene/orchard, model/orchard.ts): shaken down from its trees in season, and its hives' honey
  F('cherry', 'Cherries', ['summer'], 'orchard', 3, '#c8243a',
    'Always in pairs, like they planned it. Posy hooks a pair over each ear and calls it the summer fashion.'),
  F('plum', 'Plum', ['summer', 'autumn'], 'orchard', 3, '#6a3a8a',
    'Dusty purple with a bloom that rubs off on your thumb. Fern eats them on the walk home and blames the wasps.'),
  F('apple', 'Apple', ['autumn'], 'orchard', 4, '#d8402e',
    'Crisp, a little lopsided and better for it. The old trees on the hillside were planted by whoever built the first wall.'),
  F('pear', 'Pear', ['autumn'], 'orchard', 3, '#c8c454',
    'Speckled gold and soft by the stalk. There is exactly one perfect afternoon to eat a pear, and this is it.'),
  F('honey', 'Wildflower honey', ['spring', 'summer', 'autumn'], 'orchard', 1, '#e8a422',
    'A jar of the hillside hives\' best, cloudy with clover and orchard blossom. Hazel will trade almost anything for it.'),

  FISH('minnow', 'Minnow', { seasons: ALL, water: ['pond', 'river'], time: 'any', weather: 'any', weight: 5, cm: [4, 9], color: '#a9b8b8', look: ['#8fa3a6', '#e8eee8', '#c7d2cc'],
    blurb: 'Small, silver and in a tremendous hurry. Everybody\'s first catch.' }),
  FISH('bluegill', 'Bluegill', { seasons: ['spring', 'summer'], water: ['pond'], time: 'day', weather: 'any', weight: 4, cm: [10, 22], color: '#5a86b8', look: ['#4f7aa8', '#f2c25a', '#2f4f78'],
    blurb: 'Round as a coin with a blue cheek. Bites at anything at all, bless it.' }),
  FISH('carp', 'Mirror carp', { seasons: ALL, water: ['pond'], time: 'any', weather: 'any', weight: 3, cm: [35, 80], color: '#b8913f', look: ['#9a7a3a', '#e8cf8a', '#c8955a'],
    blurb: 'Big, slow and wise. It has been in the pond longer than the dock has.' }),
  FISH('perch', 'Perch', { seasons: ['autumn', 'winter', 'spring'], water: ['pond', 'river'], time: 'day', weather: 'any', weight: 3, cm: [15, 35], color: '#8fae4a', look: ['#7a9a3f', '#f0e4b0', '#e8742c'],
    blurb: 'Striped like a deckchair. They swim in shoals, so where there\'s one…' }),
  FISH('trout', 'Rainbow trout', { seasons: ['spring', 'autumn'], water: ['river'], time: 'any', weather: 'any', weight: 4, cm: [25, 55], color: '#d8879a', look: ['#7f9a6a', '#f2e6dc', '#e07a8f'],
    blurb: 'Flashes pink in the riffles below the waterfall. Fern knows a spot. Fern will not tell you the spot.' }),
  FISH('salmon', 'Salmon', { seasons: ['autumn'], water: ['river'], time: 'any', weather: 'any', weight: 2, cm: [50, 90], color: '#e07a5a', look: ['#7a6a72', '#f0d0c0', '#d8604a'],
    blurb: 'Homeward bound up the river, and not best pleased about the detour.' }),
  FISH('pike', 'Pike', { seasons: ['autumn', 'winter'], water: ['river', 'pond'], time: 'twilight', weather: 'any', weight: 2, cm: [45, 100], color: '#6f8f4a', look: ['#5a7a3a', '#e8e4b8', '#9ab05a'],
    blurb: 'All teeth and opinions. Fern calls this one the Mayor of the Reeds, but never where the Mayor can hear.' }),
  FISH('catfish', 'Catfish', { seasons: ALL, water: ['pond', 'river'], time: 'night', weather: 'any', weight: 3, cm: [30, 70], color: '#7a6a5a', look: ['#5f5248', '#d8cbb8', '#3f352e'],
    blurb: 'Whiskers like a village elder. Only comes up after dark to see what the fuss is about.' }),
  FISH('eel', 'Eel', { seasons: ['spring', 'summer', 'autumn'], water: ['river'], time: 'night', weather: 'rain', weight: 2, cm: [40, 90], color: '#5a6a3a', look: ['#4a5a32', '#c8c08a', '#3a4428'], rare: true,
    blurb: 'A rainy-night rarity. Wriggles out of your hands and straight back into the story.' }),
  FISH('koi', 'Golden koi', { seasons: ['summer'], water: ['pond'], time: 'day', weather: 'clear', weight: 1, cm: [30, 60], color: '#f0a020', look: ['#f29a2a', '#fff4e0', '#ffffff'], rare: true,
    blurb: 'Somebody let a koi go in the pond years ago. Admire it, wish on it, put it back. (You put it back.)' }),
  FISH('stormbass', 'Thunder bass', { seasons: ['spring', 'summer', 'autumn'], water: ['pond'], time: 'any', weather: 'rain', weight: 2, cm: [30, 60], color: '#5a6e8a', look: ['#46597a', '#d8dfe8', '#f2c33a'], rare: true,
    blurb: 'Only bites when the rain is really coming down. Looks personally offended by the weather.' }),
  FISH('char', 'Moonlit char', { seasons: ['winter'], water: ['river', 'pond'], time: 'night', weather: 'clear', weight: 2, cm: [25, 50], color: '#c8d8f0', look: ['#8aa0c8', '#f8f4ec', '#e86a4a'], rare: true,
    blurb: 'Pale as moonlight and cold as the stream it came from. Only bites on clear winter nights.' }),
  FISH('cavefish', 'Blind cave fish', { seasons: ALL, water: ['cave'], time: 'any', weather: 'any', weight: 1, cm: [6, 14], color: '#f2d8dc', look: ['#f0d6d8', '#fbeef0', '#e8a8b4'], rare: true,
    blurb: 'Pale pink, no eyes and no worries at all. It has lived in the dark so long it finds the rest of us a bit much.' }),
  FISH('boot', 'Old boot', { seasons: ALL, water: ['pond', 'river'], time: 'any', weather: 'any', weight: 1, cm: [0, 0], junk: true, color: '#6e4a2a', look: ['#6e4a2a', '#a0703f', '#3b2a1e'],
    blurb: 'Size eleven, left foot. If you ever find the right one, Posy will happily post the pair home.' }),
  FISH('bottle', 'Message in a bottle', { seasons: ALL, water: ['river'], time: 'any', weather: 'any', weight: 0.4, cm: [0, 0], junk: true, rare: true, color: '#7fc3a0', look: ['#8fd0b0', '#fff6e0', '#a0703f'],
    blurb: '"Dear whoever finds this: the valley is lovely this time of year. Wish you were here." Unsigned.' }),
] as CollectDef[]);

// ---------------------------------------------------------------------------------------------
// Sightings: the field guide's wild visitors (scene/life/wildlife.ts). Not finds (nothing goes in the basket): seen
// with your own eyes, counted once per day.

/** when a visitor is about, in the book's words */
export type SightTime = 'dawn-dusk' | 'night' | 'day' | 'evening' | 'morning-evening';
export interface SightDef {
  kind: 'sight';
  id: string;
  name: string;
  blurb: string;
  seasons: readonly Season[];
  time: SightTime;
  /** where to look, in the valley's voice */
  place: string;
  /** how to get close (shown with the silhouette) */
  tip: string;
  rare?: boolean;
  color: string;
}
const SIGHT = (id: string, name: string, o: Omit<SightDef, 'kind' | 'id' | 'name'>): SightDef => ({ kind: 'sight', id, name, ...o });

/** Every wild visitor, in field-guide order. Ids are stable (save keys) and match scene/life/wild.ts. */
export const SIGHTINGS: readonly SightDef[] = Object.freeze([
  SIGHT('deer', 'Roe deer', { seasons: ALL, time: 'dawn-dusk', color: '#c47a45', place: 'grazing at the edge of the woods near the valley rim',
    tip: 'Come up slowly. When she lifts her head, stand still until she goes back to grazing.',
    blurb: 'A doe and her fawn, out of the trees while the valley is still grey. Fern leaves a salt lick by the rim and pretends she doesn\'t.' }),
  SIGHT('fox', 'Red fox', { seasons: ALL, time: 'night', color: '#e2762e', place: 'trotting the hedgerows round the fields after dark',
    tip: 'Look for two green sparks in the lamplight, and don\'t run at him.',
    blurb: 'Does his rounds of every field like a night watchman. Bram blames him for a missing glove. Bram has no proof.' }),
  SIGHT('heron', 'Grey heron', { seasons: ALL, time: 'morning-evening', color: '#9ea7b3', place: 'standing in the river shallows',
    tip: 'Mornings and late afternoons. He spooks from a long way off; approach along the bank, a few steps at a time.',
    blurb: 'Patience on stilts. Nimbus has timed him at forty minutes without moving, then three fish in a minute.' }),
  SIGHT('owl', 'Tawny owl', { seasons: ALL, time: 'night', color: '#8a5a36', place: 'on top of a standing stone up on the north knoll',
    tip: 'Clear nights only. Listen for the hoot; she lets you come quite close if you take your time.',
    blurb: 'Turns her head right round to keep an eye on you, which is fair: you were keeping an eye on her.' }),
  SIGHT('hedgehog', 'Hedgehog', { seasons: ['spring', 'summer', 'autumn'], time: 'evening', color: '#6e4c34', place: 'snuffling under the orchard trees',
    tip: 'Mild evenings. If it curls up, keep still and it will uncurl and carry on.',
    blurb: 'Hunts slugs under the apple trees and snores in the hay. Hazel leaves out a saucer of water, never milk.' }),
  SIGHT('geese', 'Greylag geese', { seasons: ['autumn', 'spring'], time: 'morning-evening', color: '#8f877b', place: 'flying over the valley in a long V',
    tip: 'Autumn and spring, mornings and evenings. Listen for the honking and look up.',
    blurb: 'South in autumn, home again in spring, and always arguing about the way. The Mayor waves. They never wave back.' }),
] as SightDef[]);
const SIGHT_BY_ID = new Map(SIGHTINGS.map((d) => [d.id, d]));
export const sightDef = (id: string): SightDef | undefined => SIGHT_BY_ID.get(id);

/** "where / when" line for a visitor (the book's hint line, also under the silhouette) */
export function sightText(d: SightDef): string {
  const seasons = d.seasons.length === 4 ? 'all year' : d.seasons.join(' & ');
  const time = { 'dawn-dusk': 'at dawn and dusk', night: 'at night', day: 'by day', evening: 'in the evenings', 'morning-evening': 'mornings and late afternoons' }[d.time];
  return `${d.place}, ${time}, ${seasons}`;
}

export const FORAGE: readonly ForageDef[] = CATALOG.filter((d): d is ForageDef => d.kind === 'forage');
export const FISHES: readonly FishDef[] = CATALOG.filter((d): d is FishDef => d.kind === 'fish');
/**
 * Barn produce (the walk-in barn's chores, model/barn.ts): eggs from the nest boxes and Daisy's milk. They go into the
 * basket and sell like any find (`collectDef` knows them), but they are not finds: never in the Collections book,
 * never foraged.
 */
export const PRODUCE: readonly ForageDef[] = Object.freeze([
  F('egg', 'Fresh egg', ALL, 'meadow', 4, '#f4e6cc',
    'Still warm from the nest box. The hens pretend not to have noticed you taking it.'),
  F('milk', 'Pail of milk', ALL, 'meadow', 2, '#f6f2e8',
    'Creamy and fresh from Daisy. Hazel trades a loaf for a pail, and the cats follow you home.'),
  // pressed at the hillside orchard's honey house from three apples or pears (model/orchard.ts `pressPlan`)
  F('cider', 'Bottle of cider', ALL, 'orchard', 1, '#e8b04a',
    'Pressed in the honey house from the hillside apples. Cloudy, sharp and gone by Founders\' Day.'),
]);
const BY_ID = new Map([...CATALOG, ...PRODUCE].map((d) => [d.id, d]));
export const collectDef = (id: string): CollectDef | undefined => BY_ID.get(id);

// ---------------------------------------------------------------------------------------------
// Deterministic randomness for the day's plans (forage spots, requests, wild visits): plain FNV-1a over UTF-16 code
// units (NOT shared/identity's hash32, whose avalanche finaliser would reshuffle every seeded day) + mulberry32

export function hashKey(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export const rand: (seed: number) => () => number = mulberry32;
const weighted = <T extends { weight: number }>(xs: readonly T[], r: () => number): T => {
  let sum = 0;
  for (const x of xs) sum += x.weight;
  let v = r() * sum;
  for (const x of xs) { v -= x.weight; if (v < 0) return x; }
  return xs[xs.length - 1];
};

// ---------------------------------------------------------------------------------------------
// Forage: what turns up today

export const FORAGE_PER_DAY = Object.freeze({ min: 8, max: 12 });
export interface ForageSpawn {
  /** stable per day (`YYYY-MM-DD:season:i`): the save key once picked */
  key: string;
  id: string;
  /** placement seed for the scene (position, turn, size) */
  seed: number;
}

/** what can turn up in the valley today (the grotto's and the orchard's own finds never join the day's batch) */
export const forageFor = (season: Season): ForageDef[] => FORAGE.filter((d) => d.seasons.includes(season) && d.habitat !== 'grotto' && d.habitat !== 'orchard');

/** Today's forageables: 8–12 of the season's kinds, every kind at least once, deterministic per date + season. */
export function forageDay(day: string, season: Season): ForageSpawn[] {
  const kinds = forageFor(season);
  if (!kinds.length) return [];
  const r = rand(hashKey(`forage:${day}:${season}`));
  const n = FORAGE_PER_DAY.min + Math.floor(r() * (FORAGE_PER_DAY.max - FORAGE_PER_DAY.min + 1));
  const out: ForageSpawn[] = [];
  // the commons once each first (rares stay a rare treat), then by weight
  const commons = kinds.filter((k) => !k.rare);
  for (let i = 0; i < n; i++) {
    const d = i < commons.length ? commons[i] : weighted(kinds, r);
    out.push({ key: `${day}:${season}:${i}`, id: d.id, seed: hashKey(`forage:${day}:${season}:${i}`) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Fishing: what bites

export interface FishConditions {
  season: Season;
  /** local fractional hour */
  hour: number;
  weather: WeatherKind;
  water: WaterKind;
  /** extra odds for the rarer fish (a cast from the rowboat out in the middle of the pond: scene/seasons), default 1 */
  rareBoost?: number;
}
export const isNight = (hour: number): boolean => hour >= 20 || hour < 5;
export const isTwilight = (hour: number): boolean => (hour >= 4.5 && hour < 8) || (hour >= 17.5 && hour < 21.5);
const rainy = (w: WeatherKind) => w === 'rain' || w === 'storm';
const clearSky = (w: WeatherKind) => w === 'clear' || w === 'cloudy';

export function canBite(d: FishDef, c: FishConditions): boolean {
  if (!d.seasons.includes(c.season) || !d.water.includes(c.water)) return false;
  if (d.time === 'day' && isNight(c.hour)) return false;
  if (d.time === 'night' && !isNight(c.hour)) return false;
  if (d.time === 'twilight' && !isTwilight(c.hour)) return false;
  if (d.weather === 'rain' && !rainy(c.weather)) return false;
  if (d.weather === 'clear' && !clearSky(c.weather)) return false;
  return true;
}

/** Everything that can bite right now, with odds (rain and dusk wake the rarer fish up a little). */
export function fishOdds(c: FishConditions): { def: FishDef; weight: number }[] {
  const boost = (rainy(c.weather) ? 1.4 : 1) * (isTwilight(c.hour) ? 1.25 : 1) * (c.rareBoost ?? 1);
  return FISHES.filter((d) => canBite(d, c)).map((d) => ({ def: d, weight: d.weight * (d.rare && !d.junk ? boost : 1) }));
}

/** One catch: which fish and how big (cm, 0 for junk). */
export function rollFish(r: () => number, c: FishConditions): { id: string; cm: number } {
  const odds = fishOdds(c);
  const pick = odds.length ? weighted(odds, r).def : FISHES[0];
  // sizes lean small: the big ones are stories
  const cm = pick.junk ? 0 : Math.round(pick.cm[0] + (pick.cm[1] - pick.cm[0]) * Math.pow(r(), 1.6));
  return { id: pick.id, cm };
}

/** seconds until a bite: shorter in the rain and at dawn / dusk, never long */
export function biteDelay(r: () => number, c: Pick<FishConditions, 'hour' | 'weather'>): number {
  const k = (rainy(c.weather) ? 0.75 : 1) * (isTwilight(c.hour) ? 0.8 : 1);
  return (2.2 + r() * 4.5) * k;
}

// ---------------------------------------------------------------------------------------------
// The book (persisted)

export interface FoundRec {
  n: number;
  /** YYYY-MM-DD */
  first: string;
  /** fish: biggest, cm */
  best?: number;
}
export interface CollectionData {
  v: 1;
  found: Record<string, FoundRec>;
  /** today's picked forage spawn keys (they stay gone until tomorrow's batch) */
  picked: { day: string; keys: string[] };
  /** fish caught today (a small daily tally for the book's footer) */
  fishDay?: { day: string; n: number };
  /** wild visitors seen: n = days seen on, first / last day */
  seen?: Record<string, SeenRec>;
}
export interface SeenRec { n: number; first: string; last: string }

export const emptyCollection = (): CollectionData => ({ v: 1, found: {}, picked: { day: '', keys: [] } });

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Tolerant parse of stored data (anything malformed → null; unknown ids are dropped). */
export function parseCollection(raw: unknown): CollectionData | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1 || !o.found || typeof o.found !== 'object') return null;
  const found: Record<string, FoundRec> = {};
  for (const [id, v] of Object.entries(o.found as Record<string, unknown>)) {
    if (!BY_ID.has(id) || !v || typeof v !== 'object') continue;
    const f = v as Record<string, unknown>;
    if (typeof f.n !== 'number' || !(f.n >= 1) || typeof f.first !== 'string' || !DAY_RE.test(f.first)) continue;
    found[id] = { n: Math.floor(f.n), first: f.first, ...(typeof f.best === 'number' && f.best > 0 ? { best: f.best } : {}) };
  }
  const p = o.picked as Record<string, unknown> | undefined;
  const picked = p && typeof p.day === 'string' && Array.isArray(p.keys)
    ? { day: p.day, keys: p.keys.filter((k): k is string => typeof k === 'string').slice(0, 64) }
    : { day: '', keys: [] };
  const fd = o.fishDay as Record<string, unknown> | undefined;
  const seen: Record<string, SeenRec> = {};
  if (o.seen && typeof o.seen === 'object') {
    for (const [id, v] of Object.entries(o.seen as Record<string, unknown>)) {
      if (!SIGHT_BY_ID.has(id) || !v || typeof v !== 'object') continue;
      const f = v as Record<string, unknown>;
      if (typeof f.n !== 'number' || !(f.n >= 1) || typeof f.first !== 'string' || !DAY_RE.test(f.first)) continue;
      seen[id] = { n: Math.floor(f.n), first: f.first, last: typeof f.last === 'string' && DAY_RE.test(f.last) ? f.last : f.first };
    }
  }
  return {
    v: 1, found, picked,
    ...(fd && typeof fd.day === 'string' && typeof fd.n === 'number' ? { fishDay: { day: fd.day, n: Math.max(0, Math.floor(fd.n)) } } : {}),
    ...(Object.keys(seen).length ? { seen } : {}),
  };
}

export interface FindResult {
  def: CollectDef;
  /** first time ever */
  isNew: boolean;
  n: number;
  /** fish: a new personal best size */
  record: boolean;
  /** fish: this one's size, cm (the Gazette's fishing report) */
  cm?: number;
}

/** Record one find (mutates `data`). */
export function recordFind(data: CollectionData, id: string, nowMs: number, cm = 0): FindResult | null {
  const def = BY_ID.get(id);
  if (!def) return null;
  const day = dayKey(nowMs);
  const prev = data.found[id];
  const rec: FoundRec = prev ? { ...prev, n: prev.n + 1 } : { n: 1, first: day };
  const record = cm > 0 && cm > (prev?.best ?? 0);
  if (record) rec.best = cm;
  data.found[id] = rec;
  if (def.kind === 'fish') data.fishDay = { day, n: (data.fishDay?.day === day ? data.fishDay.n : 0) + 1 };
  return { def, isNew: !prev, n: rec.n, record: record && !!prev, ...(cm > 0 ? { cm } : {}) };
}

export interface SightResult {
  def: SightDef;
  /** first time ever */
  isNew: boolean;
  /** days seen on */
  n: number;
}

/** Record a sighting (mutates `data`): once per species per day (null when already seen today, or unknown). */
export function recordSighting(data: CollectionData, id: string, nowMs: number): SightResult | null {
  const def = SIGHT_BY_ID.get(id);
  if (!def) return null;
  const day = dayKey(nowMs);
  const seen = (data.seen ??= {});
  const prev = seen[id];
  if (prev?.last === day) return null;
  seen[id] = prev ? { n: prev.n + 1, first: prev.first, last: day } : { n: 1, first: day, last: day };
  return { def, isNew: !prev, n: seen[id].n };
}

/** Which of `day`'s forage spawns were already picked. */
export const pickedOn = (data: CollectionData, day: string): ReadonlySet<string> => new Set(data.picked.day === day ? data.picked.keys : []);

/** Pick a forage spawn: records the find and remembers the spot as picked for the day (once). */
export function pickForage(data: CollectionData, spawn: ForageSpawn, nowMs: number): FindResult | null {
  const day = spawn.key.slice(0, 10);
  if (data.picked.day !== day) data.picked = { day, keys: [] };
  if (data.picked.keys.includes(spawn.key)) return null;
  data.picked.keys.push(spawn.key);
  return recordFind(data, spawn.id, nowMs);
}

export interface CollectionEntry {
  def: CollectDef;
  found: boolean;
  n: number;
  first: string | null;
  best: number | null;
  /** can be found / caught in `season` */
  inSeason: boolean;
}
export interface SightEntry {
  def: SightDef;
  found: boolean;
  /** days seen on */
  n: number;
  first: string | null;
  last: string | null;
  inSeason: boolean;
}
export interface CollectionView {
  entries: CollectionEntry[];
  /** the field guide (wild visitors); not counted in found / total */
  sightings: SightEntry[];
  sight: { found: number; total: number };
  found: number;
  total: number;
  forage: { found: number; total: number };
  fish: { found: number; total: number };
  fishToday: number;
}

export function collectionView(data: CollectionData, season: Season, nowMs: number): CollectionView {
  const entries = CATALOG.map((def) => {
    const f = data.found[def.id];
    return { def, found: !!f, n: f?.n ?? 0, first: f?.first ?? null, best: f?.best ?? null, inSeason: def.seasons.includes(season) };
  });
  const count = (k: CollectKind) => ({ found: entries.filter((e) => e.def.kind === k && e.found).length, total: entries.filter((e) => e.def.kind === k).length });
  const sightings = SIGHTINGS.map((def) => {
    const f = data.seen?.[def.id];
    return { def, found: !!f, n: f?.n ?? 0, first: f?.first ?? null, last: f?.last ?? null, inSeason: def.seasons.includes(season) };
  });
  return {
    entries, found: entries.filter((e) => e.found).length, total: entries.length,
    sightings, sight: { found: sightings.filter((e) => e.found).length, total: sightings.length },
    forage: count('forage'), fish: count('fish'),
    fishToday: data.fishDay?.day === dayKey(nowMs) ? data.fishDay.n : 0,
  };
}

/** A plain-language "where / when" for an entry (the book's hint line; silhouettes show it too). */
export function whereText(d: CollectDef): string {
  const seasons = d.seasons.length === 4 ? 'all year' : d.seasons.join(' & ');
  if (d.kind === 'forage') {
    const where = { meadow: 'in the meadows', wood: 'under the trees', shore: 'along the water\'s edge', cliff: 'at the foot of the cliffs', grotto: 'somewhere secret, where the river begins', orchard: d.id === 'honey' ? 'from the hives in the hillside orchard' : 'shaken from the hillside orchard\'s trees' }[d.habitat];
    return `${where}, ${seasons}`;
  }
  const water = d.water.includes('cave') ? 'a still pool, somewhere very dark' : d.water.length === 2 ? 'pond or river' : `the ${d.water[0]}`;
  const time = { any: '', day: ', by day', night: ', at night', twilight: ', at dawn and dusk' }[d.time];
  const weather = { any: '', rain: ', in the rain', clear: ', under clear skies' }[d.weather];
  return `${water}, ${seasons}${time}${weather}`;
}

// ---------------------------------------------------------------------------------------------
// The live book: data + store + listeners (main.ts creates one; the scene finds, the HUD reads)

export interface CollectionStore {
  load(): unknown;
  save(data: CollectionData): void;
}

export interface CollectionService {
  /** bumps on every change (cheap HUD signatures) */
  readonly version: number;
  data(): CollectionData;
  view(season: Season): CollectionView;
  /** a caught fish (or junk) */
  catch(id: string, cm: number): FindResult | null;
  /** a picked forageable (once per spawn per day) */
  pick(spawn: ForageSpawn): FindResult | null;
  /** something gathered that has its own daily rules (the orchard's fruit and honey: model/orchard.ts) */
  gather(id: string): FindResult | null;
  picked(day: string): ReadonlySet<string>;
  onFind(fn: (r: FindResult) => void): () => void;
  /** a wild visitor seen (counted once a day; null when already seen today) */
  sight(id: string): SightResult | null;
  onSight(fn: (r: SightResult) => void): () => void;
  /** dev: mark the first n catalog entries found, then the field guide's (shots, the HUD panel) */
  devFill(n: number): void;
  /** dev: forget everything */
  devReset(): void;
}

export function createCollection(store: CollectionStore | undefined, now: () => number = Date.now): CollectionService {
  let data: CollectionData;
  try { data = parseCollection(store?.load()) ?? emptyCollection(); } catch { data = emptyCollection(); }
  let version = 0;
  const fns = new Set<(r: FindResult) => void>();
  const sightFns = new Set<(r: SightResult) => void>();
  const save = () => { version++; try { store?.save(data); } catch (err) { console.warn('[collection] save failed', err); } };
  const after = (r: FindResult | null) => {
    if (!r) return null;
    save();
    for (const f of [...fns]) { try { f(r); } catch (err) { console.error('[collection] listener threw', err); } }
    return r;
  };
  return {
    get version() { return version; },
    data: () => data,
    view: (season) => collectionView(data, season, now()),
    catch: (id, cm) => after(recordFind(data, id, now(), cm)),
    pick: (spawn) => after(pickForage(data, spawn, now())),
    gather: (id) => after(recordFind(data, id, now())),
    picked: (day) => pickedOn(data, day),
    onFind(fn) { fns.add(fn); return () => fns.delete(fn); },
    sight(id) {
      const r = recordSighting(data, id, now());
      if (!r) return null;
      save();
      for (const f of [...sightFns]) { try { f(r); } catch (err) { console.error('[collection] sight listener threw', err); } }
      return r;
    },
    onSight(fn) { sightFns.add(fn); return () => sightFns.delete(fn); },
    devFill(n) {
      const day = dayKey(now());
      CATALOG.slice(0, Math.max(0, n)).forEach((d, i) => {
        if (data.found[d.id]) return;
        data.found[d.id] = { n: 1 + (i % 4), first: day, ...(d.kind === 'fish' && !d.junk ? { best: Math.round((d.cm[0] + d.cm[1]) / 2) } : {}) };
      });
      SIGHTINGS.slice(0, Math.max(0, n - CATALOG.length)).forEach((d, i) => {
        const seen = (data.seen ??= {});
        seen[d.id] ??= { n: 1 + (i % 3), first: day, last: day };
      });
      save();
    },
    devReset() { data = emptyCollection(); save(); },
  };
}
