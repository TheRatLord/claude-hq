// @pure
/**
 * The stamp book: long-term goals that tie the valley's systems together. Each stamp is inked once, for good, when
 * something in the valley comes true: real agent work (commits through the shipping bin, a streak in the Almanac, a
 * crowd of farmers working at once), the player's pastimes (the Collections book), friendship (model/friends.ts), the
 * places you go (the summit, the nooks, a festival on the square), the sky (a rainbow, a meteor shower) and your yard
 * (model/wallet.ts).
 *
 * Nothing here duplicates another service's data: `check(world)` is handed a `StampWorld` snapshot that main.ts reads
 * off the live services about once a second (and on their change hooks), and every stamp is a predicate over it. What
 * the book keeps for itself (localStorage `claude-valley.stamps.v1`) is only what no other service remembers: the
 * stamps earned and when, lifetime commit / answer counters, the first day each field was seen (a field that lived a
 * week), and the sets of nooks / festivals / seasons visited.
 *
 * Work stamps are only for real work: a demo valley (fake agents) never inks them.
 *
 * Pure: no DOM, no three; the clock comes in with the world.
 */
import type { Season, WeatherKind } from './types.ts';
import type { CollectionData } from './collection.ts';
import { CATALOG, FISHES, SIGHTINGS } from './collection.ts';
import type { FriendsData } from './friends.ts';
import { FRIEND_IDS, heartsOf } from './friends.ts';
import type { WalletData } from './wallet.ts';
import { YARD_SLOTS } from './wallet.ts';
import { decorDef } from './shop.ts';
import { FESTIVALS } from './calendar.ts';
import type { FestivalId } from './calendar.ts';
import { dayKey } from './almanac.ts';

export const STAMP_CATS = Object.freeze(['work', 'pastimes', 'village', 'explorer', 'seasons', 'home'] as const);
export type StampCat = (typeof STAMP_CATS)[number];
export const CAT_NAME: Readonly<Record<StampCat, string>> = Object.freeze({
  work: 'Work', pastimes: 'Pastimes', village: 'Village', explorer: 'Explorer', seasons: 'Seasons & festivals', home: 'Home',
});

/** the little drawing in the middle of a stamp (hud/stamps.ts draws each on a canvas) */
export const MOTIFS = Object.freeze([
  'crate', 'crates', 'flame', 'sprout', 'can', 'letter', 'crowd', 'field', 'moon',
  'fish', 'fishes', 'ruler', 'mushroom', 'binoculars', 'rainbow', 'boot', 'bottle',
  'heart', 'hearts', 'ribbon', 'campfire', 'notes', 'gift', 'basket',
  'mountain', 'cairn', 'meteor', 'compass', 'camera', 'star',
  'blossom', 'lantern', 'cake', 'pumpkin', 'jack', 'tree', 'firework', 'snowflake', 'leaf',
  'fence', 'lamp', 'gnome', 'portrait', 'house',
  'boat', 'skates', 'snowman', 'egg',
] as const);
export type Motif = (typeof MOTIFS)[number];

/** What the valley looks like right now, as far as the stamps care (main.ts builds it from the live services). */
export interface StampWorld {
  /** wall clock, ms */
  now: number;
  /** a demo valley (fake agents): work stamps are never earned */
  demo: boolean;
  /** sky hour 0..24 (follows ?hour / dev overrides) */
  hour: number;
  season: Season;
  weather: WeatherKind;
  /** lying snow 0..1 (sky trace) */
  snow: number;
  /** today's festival id, if any */
  festival: string | null;
  /** the player is outside (not in the farmhouse) */
  outdoors: boolean;
  /** the Almanac: days in a row with a harvest, green test runs today */
  streak: number;
  testsToday: number;
  /** farmers working right now */
  working: number;
  /** open fields (not harvested / fallow) */
  plots: readonly { id: string; alive: boolean }[];
  collection: Readonly<CollectionData> | null;
  friends: Readonly<FriendsData> | null;
  wallet: Readonly<WalletData> | null;
  /** stones on the summit cairn */
  stones: number;
  /** days with every barn animal fed (model/barn.ts) */
  chores: number;
  /** where the player is */
  at: { summit: boolean; nook: string | null; festival: boolean; concert: boolean; campfire: boolean };
  /** a rainbow in the sky / a meteor shower over a clear night sky, while you're out under it */
  sky: { rainbow: boolean; shower: boolean };
}

export const emptyWorld = (now = 0): StampWorld => ({
  now, demo: false, hour: 12, season: 'summer', weather: 'clear', snow: 0, festival: null, outdoors: true, streak: 0, testsToday: 0,
  working: 0, plots: [], collection: null, friends: null, wallet: null, stones: 0, chores: 0,
  at: { summit: false, nook: null, festival: false, concert: false, campfire: false }, sky: { rainbow: false, shower: false },
});

/** The book's own memory (persisted). */
export interface StampsData {
  v: 1;
  /** earned stamps: when (ms) */
  earned: Record<string, number>;
  /** lifetime counters nobody else keeps: commits shipped, asks answered, photos taken, late-night commits */
  n: { ship: number; answered: number; photo: number; late: number; row: number; eight: number; snowman: number };
  /** fields seen: id → [first seen, last seen] ms (pruned a few days after a field is gone) */
  plots: Record<string, [number, number]>;
  /** nooks visited, festivals attended, seasons spent in the valley */
  nooks: string[];
  fests: string[];
  seasons: string[];
  /** stamp-book trophies already given (0..TROPHIES.length) */
  trophies: number;
}

export const emptyStamps = (): StampsData => ({ v: 1, earned: {}, n: { ship: 0, answered: 0, photo: 0, late: 0, row: 0, eight: 0, snowman: 0 }, plots: {}, nooks: [], fests: [], seasons: [], trophies: 0 });

/** progress toward a stamp: have / need (shown under an unearned stamp) */
export interface Progress { have: number; need: number }
type Test = (w: StampWorld, m: StampsData) => boolean | Progress;

export interface StampDef {
  id: string;
  cat: StampCat;
  name: string;
  /** the inked stamp's line, in the valley's voice */
  blurb: string;
  /** how to earn it (shown on the faint outline; secret stamps show "?" until earned) */
  hint: string;
  motif: Motif;
  secret?: boolean;
  /** hold true this long (ms, continuously) before it counts: moments, not glances */
  dwell?: number;
  test: Test;
}

const DAY_MS = 86_400_000;
const FIELD_WEEK = 7 * DAY_MS;
const pr = (have: number, need: number): Progress => ({ have: Math.min(have, need), need });
const fish = (w: StampWorld) => FISHES.filter((d) => !d.junk && w.collection?.found[d.id]);
const forageFound = (w: StampWorld) => CATALOG.filter((d) => d.kind === 'forage' && w.collection?.found[d.id]).length;
const hearts = (w: StampWorld, id: string) => heartsOf(w.friends?.pts[id] ?? 0);
const owns = (w: StampWorld, f: (id: string) => boolean) => !!w.wallet?.pieces.some((p) => f(p.id));
const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];
/** the most complete season's fish set: [found, total] */
function bestSeasonFish(w: StampWorld): Progress {
  let best = pr(0, 1);
  for (const s of SEASONS) {
    const all = FISHES.filter((d) => !d.junk && d.seasons.includes(s));
    const got = all.filter((d) => w.collection?.found[d.id]).length;
    if (got / all.length > best.have / best.need) best = pr(got, all.length);
  }
  return best;
}
const NOOK_COUNT = 8;
const late = (h: number) => h >= 0 && h < 4;
const night = (h: number) => h >= 21 || h < 5;

const S = (id: string, cat: StampCat, name: string, motif: Motif, hint: string, blurb: string, test: Test, o: Partial<StampDef> = {}): StampDef =>
  Object.freeze({ id, cat, name, motif, hint, blurb, test, ...o });

const FEST_MOTIF: Readonly<Record<FestivalId, Motif>> = {
  blossom: 'blossom', lantern: 'lantern', founders: 'cake', harvest: 'pumpkin', hallowtide: 'jack', starlight: 'tree', newyear: 'firework',
};
const FEST_BLURB: Readonly<Record<FestivalId, string>> = {
  blossom: 'Petals in your hair and ribbons round the maypole.',
  lantern: 'A paper lantern floated off across the pond with your wish in it.',
  founders: 'Cake on the square for the valley\'s very first commit.',
  harvest: 'You stood by the prize pumpkin. It was, objectively, enormous.',
  hallowtide: 'Jack-o\'-lanterns all down the roads and a wisp over the pond.',
  starlight: 'The big tree lit up, snow lanterns glowing, and somebody humming carols.',
  newyear: 'Fireworks over the south meadow and a glass raised to the year.',
};

/** Every stamp, in book order (by category). Ids are stable: they are the save keys. */
export const STAMPS: readonly StampDef[] = Object.freeze([
  // ---- Work: real agent work through the valley
  S('first-crate', 'work', 'First crate', 'crate', 'Ship a commit through the valley.',
    'The first crate rattled into Bram\'s shipping bin. He wrote it in the ledger twice, just to be sure.',
    (w, m) => !w.demo && m.n.ship >= 1),
  S('hundred-crates', 'work', 'A hundred crates', 'crates', 'Ship 100 commits.',
    'One hundred crates. Bram has started stacking them in the shape of a castle.',
    (w, m) => (w.demo ? false : pr(m.n.ship, 100))),
  S('streak-7', 'work', 'Seven-day streak', 'flame', 'A harvest every day for a week.',
    'Seven days of harvests on the trot. The Almanac\'s pages are getting dog-eared.',
    (w) => (w.demo ? false : pr(w.streak, 7))),
  S('green-10', 'work', 'Green thumbs', 'can', 'Ten green test runs in one day.',
    'Ten green test runs in a single day. The watering can has never been so busy.',
    (w) => (w.demo ? false : pr(w.testsToday, 10))),
  S('answers-50', 'work', 'Good listener', 'letter', 'Answer 50 farmers who need you.',
    'Fifty questions answered. Posy says you\'re her best correspondent.',
    (w, m) => (w.demo ? false : pr(m.n.answered, 50))),
  S('five-at-once', 'work', 'Busy valley', 'crowd', 'Have five farmers working at once.',
    'Five farmers hard at it at the same time. The valley hummed like a hive.',
    (w) => !w.demo && w.working >= 5),
  S('field-week', 'work', 'Deep roots', 'field', 'Keep one field going for a full week.',
    'A field tilled a week ago and still growing. Some things take their time.',
    (w, m) => !w.demo && w.plots.some((p) => p.alive && m.plots[p.id] && w.now - m.plots[p.id][0] >= FIELD_WEEK)),
  S('midnight-oil', 'work', 'Midnight oil', 'moon', 'A secret: ship something at an unusual hour.',
    'A commit shipped in the small hours. Bram was in his pyjamas, but he signed for it.',
    (w, m) => !w.demo && m.n.late >= 1, { secret: true }),

  // ---- Pastimes: the Collections book
  S('first-fish', 'pastimes', 'First bite', 'fish', 'Catch a fish.',
    'Your very first fish. Everybody remembers theirs (it was probably a minnow).',
    (w) => fish(w).length >= 1),
  S('season-fish', 'pastimes', 'Full creel', 'fishes', 'Catch every fish of one season.',
    'Every fish a season has to offer, from the minnows to the moody ones.',
    (w) => bestSeasonFish(w)),
  S('big-catch', 'pastimes', 'The one that didn\'t get away', 'ruler', 'Land a fish of 60 cm or more.',
    'Sixty centimetres if it was an inch. Bram measured it with the shipping tape.',
    (w) => FISHES.some((d) => !d.junk && (w.collection?.found[d.id]?.best ?? 0) >= 60)),
  S('forage-10', 'pastimes', 'Forager', 'mushroom', 'Find ten different kinds of forage.',
    'Ten kinds of forage in the book. Fern has started asking you where the good spots are.',
    (w) => pr(forageFound(w), 10)),
  S('field-guide', 'pastimes', 'Naturalist', 'binoculars', 'Fill the field guide: see every wild visitor.',
    'Every wild visitor seen with your own eyes, from the owl to the hedgehog.',
    (w) => pr(SIGHTINGS.filter((d) => w.collection?.seen?.[d.id]).length, SIGHTINGS.length)),
  S('rainbow', 'pastimes', 'Over the rainbow', 'rainbow', 'See a rainbow after a shower.',
    'A rainbow over the valley after the rain. Nimbus called it, apparently.',
    (w) => w.outdoors && w.sky.rainbow, { dwell: 3000 }),
  S('odd-boot', 'pastimes', 'Odd boot', 'boot', 'A secret: something that isn\'t a fish.',
    'Size eleven, left foot. Somewhere out there is a lonely right one.',
    (w) => !!w.collection?.found.boot, { secret: true }),
  S('first-row', 'pastimes', 'First row', 'boat', 'Take the rowboat out on the pond.',
    'Out on the pond in the little rowboat, the dock getting smaller behind you.',
    (_w, m) => m.n.row >= 1),
  S('pen-pal', 'pastimes', 'Pen pal', 'bottle', 'A secret: a letter from far away.',
    'A message in a bottle, from somebody who thinks the valley is lovely. They\'re right.',
    (w) => !!w.collection?.found.bottle, { secret: true }),

  // ---- Village: friendship and requests
  S('friendly', 'village', 'Friendly face', 'heart', 'Two hearts with every villager.',
    'Everybody in the village waves when they see you coming now.',
    (w) => pr(FRIEND_IDS.filter((id) => hearts(w, id) >= 2).length, FRIEND_IDS.length)),
  S('best-friend', 'village', 'Best friends', 'hearts', 'Ten hearts with one villager.',
    'Ten hearts. There\'s a portrait of you somewhere in the village, and you know it.',
    (w) => pr(Math.max(0, ...FRIEND_IDS.map((id) => hearts(w, id))), 10)),
  S('first-request', 'village', 'Happy to help', 'basket', 'Finish a villager\'s request.',
    'One request done and dusted. Word gets round in a village this size.',
    (w) => (w.friends?.total.requests ?? 0) >= 1),
  S('requests-20', 'village', 'Valley regular', 'ribbon', 'Finish 20 requests.',
    'Twenty requests. The noticeboard has started saving the good ones for you.',
    (w) => pr(w.friends?.total.requests ?? 0, 20)),
  S('campfire', 'village', 'Fireside', 'campfire', 'Sit down at a campfire evening.',
    'A log by the fire, a marshmallow on a stick and a story you\'ve half heard before.',
    (w) => w.at.campfire, { dwell: 2000 }),
  S('concert', 'village', 'Front row', 'notes', 'Listen to a bandstand concert.',
    'Fiddle, banjo and flute under the bandstand lamp. You may have danced a bit.',
    (w) => w.at.concert, { dwell: 12_000 }),
  S('perfect-gifts', 'village', 'Perfect presents', 'gift', 'A secret: know everyone\'s favourite things.',
    'You know exactly what everyone loves. That\'s what friends are for.',
    (w) => FRIEND_IDS.every((id) => Object.values(w.friends?.known[id] ?? {}).includes('love')), { secret: true }),

  // ---- Explorer: the places you go
  S('summit', 'explorer', 'Top of the world', 'mountain', 'Climb the trail to the summit lookout.',
    'The whole valley laid out below you, the waterfall to the farmhouse chimney.',
    (w) => w.at.summit),
  S('cairn-7', 'explorer', 'Cairn builder', 'cairn', 'Leave seven stones on the summit cairn.',
    'Seven stones on the cairn. It leans a bit, but so does everything up there.',
    (w) => pr(w.stones, 7)),
  S('meteors', 'explorer', 'Wish upon a star', 'meteor', 'Be out under a meteor shower night.',
    'Shooting stars every few seconds. You ran out of wishes before they ran out of stars.',
    (w) => w.outdoors && w.sky.shower, { dwell: 20_000 }),
  S('nooks', 'explorer', 'Every nook and cranny', 'compass', 'Visit every leisure nook in the valley.',
    'The pergola to the swing tree, the hot spring to the standing stones: you\'ve sat in them all.',
    (_w, m) => pr(m.nooks.length, NOOK_COUNT)),
  S('photo', 'explorer', 'Say cheese', 'camera', 'Take a picture in photo mode (P, then Enter).',
    'A picture of the valley to keep. Everybody blinked except the windmill.',
    (_w, m) => m.n.photo >= 1),
  S('summit-night', 'explorer', 'Summit by starlight', 'star', 'A secret: a view few people see.',
    'The summit after dark, the lantern lit and every farmhouse glowing below.',
    (w) => w.at.summit && night(w.hour), { secret: true }),

  // ---- Seasons & festivals
  ...FESTIVALS.map((f) => S(`fest-${f.id}`, 'seasons', f.name, FEST_MOTIF[f.id], `Join in the ${f.name} on the square.`, FEST_BLURB[f.id],
    (_w, m) => m.fests.includes(f.id))),
  S('first-snow', 'seasons', 'First snow', 'snowflake', 'Be out in the valley while it snows.',
    'Snow on the roofs, snow on the fences, snow on the farmers\' hats.',
    (w) => w.outdoors && (w.weather === 'snow' || w.snow > 0.3), { dwell: 3000 }),
  S('figure-eight', 'seasons', 'Figure eight', 'skates', 'Skate a figure eight on the frozen pond.',
    'A loop one way, a loop the other, and the ice wrote it down for you.',
    (_w, m) => m.n.eight >= 1),
  S('snow-friend', 'seasons', 'Snow friend', 'snowman', 'Build a snowman: three balls, eyes and a nose.',
    'Three snowballs high, a carrot for a nose and a very patient smile.',
    (_w, m) => m.n.snowman >= 1),
  S('four-seasons', 'seasons', 'All year round', 'leaf', 'Spend time in the valley in all four seasons.',
    'Blossom, sunshine, falling leaves and snow: a whole year in the valley.',
    (_w, m) => pr(m.seasons.length, 4)),

  // ---- Home: your yard
  S('first-decor', 'home', 'Home touches', 'lamp', 'Buy something for your yard at the General store.',
    'Your first piece of yard decor. The yard is starting to look lived in.',
    (w) => owns(w, (id) => { const d = decorDef(id); return !!d && !d.gift && !d.keepsake; })),
  S('rank-item', 'home', 'Town fancy', 'gnome', 'Buy a piece only a prosperous valley stocks.',
    'Something from the top shelf, only stocked once the valley had grown. Very fancy.',
    (w) => owns(w, (id) => decorDef(id)?.rank !== undefined)),
  S('yard-full', 'home', 'Full yard', 'fence', 'Fill every spot in your yard.',
    'Not a single empty spot left inside the picket fence. Biscuit has to weave through.',
    (w) => pr(w.wallet?.pieces.filter((p) => p.slot !== null).length ?? 0, YARD_SLOTS)),
  S('barn-chores', 'home', 'Barn chores', 'egg', 'Feed every animal in the barn in one day.',
    'Hay for Daisy and Pepper, hay for the sheep, grain for the hens. The whole barn sighed happily.',
    (w) => w.chores >= 1),
  S('welcome-home', 'home', 'Welcome home', 'house', 'Finish Posy\'s welcome tour.',
    'Posy\'s welcome sign by the gate. You live here now.',
    (w) => owns(w, (id) => id === 'welcome')),
  S('keepsake', 'home', 'Keepsake', 'portrait', 'A secret: a gift from a dear friend.',
    'A portrait on a little easel, from a friend who wanted you to have it.',
    (w) => owns(w, (id) => !!decorDef(id)?.keepsake), { secret: true }),
] as StampDef[]);

const BY_ID = new Map(STAMPS.map((s) => [s.id, s]));
export const stampDef = (id: string): StampDef | undefined => BY_ID.get(id);

/** Bits for a stamp (secret ones are worth a little more). */
export const STAMP_BITS = 10, SECRET_BITS = 25;
export const bitsFor = (d: StampDef): number => (d.secret ? SECRET_BITS : STAMP_BITS);

/** Stamp-book trophies for the yard (model/shop.ts gift decor): at 10, 25 and every stamp. */
export const TROPHIES: readonly { at: number; decor: string; name: string }[] = Object.freeze([
  { at: 10, decor: 'trophy-bronze', name: 'Bronze stamp cup' },
  { at: 25, decor: 'trophy-silver', name: 'Silver stamp cup' },
  { at: STAMPS.length, decor: 'trophy-gold', name: 'Golden stamp cup' },
]);

// ---------------------------------------------------------------------------------------------
// Persistence

const ints = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const strs = (v: unknown, ok: (s: string) => boolean): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && ok(x)))] : []);

/** Tolerant parse (anything malformed → null; unknown stamp ids are dropped). */
export function parseStamps(raw: unknown): StampsData | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return null;
  const d = emptyStamps();
  if (o.earned && typeof o.earned === 'object') for (const [id, at] of Object.entries(o.earned as Record<string, unknown>)) if (BY_ID.has(id) && ints(at)) d.earned[id] = ints(at);
  const n = (o.n && typeof o.n === 'object' ? o.n : {}) as Record<string, unknown>;
  d.n = { ship: ints(n.ship), answered: ints(n.answered), photo: ints(n.photo), late: ints(n.late), row: ints(n.row), eight: ints(n.eight), snowman: ints(n.snowman) };
  if (o.plots && typeof o.plots === 'object') {
    for (const [id, v] of Object.entries(o.plots as Record<string, unknown>)) {
      if (Array.isArray(v) && v.length === 2 && ints(v[0]) && ints(v[1])) d.plots[id] = [ints(v[0]), ints(v[1])];
    }
  }
  d.nooks = strs(o.nooks, () => true).slice(0, 32);
  d.fests = strs(o.fests, (s) => FESTIVALS.some((f) => f.id === s));
  d.seasons = strs(o.seasons, (s) => (SEASONS as readonly string[]).includes(s));
  d.trophies = Math.min(TROPHIES.length, ints(o.trophies));
  return d;
}

// ---------------------------------------------------------------------------------------------
// Evaluation

/** Fold what the world shows into the book's own memory (fields seen, places visited). Returns true if it changed in a way worth saving. */
export function observe(m: StampsData, w: StampWorld): boolean {
  let dirty = false;
  if (!w.demo) {
    for (const p of w.plots) {
      if (!p.alive) continue;
      const r = m.plots[p.id];
      if (!r) { m.plots[p.id] = [w.now, w.now]; dirty = true; } else if (w.now - r[1] > 3_600_000) { r[1] = w.now; dirty = true; }
    }
    // forget fields gone for a few days (a reopened workspace starts its week again)
    for (const [id, r] of Object.entries(m.plots)) if (w.now - r[1] > 3 * DAY_MS) { delete m.plots[id]; dirty = true; }
  }
  if (w.at.nook && !m.nooks.includes(w.at.nook)) { m.nooks.push(w.at.nook); dirty = true; }
  if (w.at.festival && w.festival && FESTIVALS.some((f) => f.id === w.festival) && !m.fests.includes(w.festival)) { m.fests.push(w.festival); dirty = true; }
  if (!m.seasons.includes(w.season)) { m.seasons.push(w.season); dirty = true; }
  return dirty;
}

/** Does this stamp's test pass? (a Progress passes when have ≥ need) */
export function passes(d: StampDef, w: StampWorld, m: StampsData): boolean {
  const r = d.test(w, m);
  return typeof r === 'boolean' ? r : r.have >= r.need;
}

/** Progress for the book (null for yes/no stamps). */
export function progressOf(d: StampDef, w: StampWorld, m: StampsData): Progress | null {
  const r = d.test(w, m);
  return typeof r === 'boolean' ? null : r;
}

/** A one-shot valley happening the book counts itself (lifetime counters). Returns true if anything changed. */
export type StampEvent = 'ship' | 'unblocked' | 'photo' | 'row' | 'eight' | 'snowman';
export function countEvent(m: StampsData, kind: StampEvent, o: { demo: boolean; hour: number }): boolean {
  if (kind === 'photo') { m.n.photo++; return true; }
  // the seasonal pastimes (scene/seasons): an outing in the rowboat, a figure eight on the ice, a finished snowman
  if (kind === 'row' || kind === 'eight' || kind === 'snowman') { m.n[kind]++; return true; }
  if (o.demo) return false;
  if (kind === 'ship') { m.n.ship++; if (late(o.hour)) m.n.late++; return true; }
  m.n.answered++;
  return true;
}

export interface StampEntry {
  def: StampDef;
  earned: boolean;
  /** ms when inked */
  at: number | null;
  /** YYYY-MM-DD when inked */
  day: string | null;
  progress: Progress | null;
  /** secret and not earned yet: the book shows "?" */
  hidden: boolean;
}
export interface StampsView {
  entries: StampEntry[];
  earned: number;
  total: number;
  byCat: Record<StampCat, { earned: number; total: number }>;
  /** the next trophy to earn (null once all are given) */
  next: (typeof TROPHIES)[number] | null;
  trophies: number;
  /** bits the stamps have paid so far */
  bits: number;
}

export function stampsView(m: StampsData, w: StampWorld | null): StampsView {
  const entries = STAMPS.map((def) => {
    const at = m.earned[def.id] ?? null;
    return {
      def, earned: at !== null, at, day: at !== null ? dayKey(at) : null,
      progress: at === null && w ? progressOf(def, w, m) : null, hidden: !!def.secret && at === null,
    };
  });
  const byCat = Object.fromEntries(STAMP_CATS.map((c) => [c, { earned: entries.filter((e) => e.def.cat === c && e.earned).length, total: entries.filter((e) => e.def.cat === c).length }])) as StampsView['byCat'];
  const earned = entries.filter((e) => e.earned).length;
  return {
    entries, earned, total: STAMPS.length, byCat, trophies: m.trophies,
    next: TROPHIES.find((t) => earned < t.at) ?? null,
    bits: entries.reduce((a, e) => a + (e.earned ? bitsFor(e.def) : 0), 0),
  };
}

// ---------------------------------------------------------------------------------------------
// The live book (main.ts creates one; the HUD reads it)

export interface StampsStore { load(): unknown; save(d: StampsData): void }
export interface StampsPorts {
  /** pay bits for a stamp (WalletService.reward) */
  pay?: (coins: number, why: string) => void;
  /** a stamp-book trophy for the yard (WalletService.gift) */
  gift?: (decorId: string) => void;
}
export interface Earned {
  def: StampDef;
  at: number;
  /** stamps earned in all, after this one */
  count: number;
  bits: number;
  /** a trophy this stamp brought (decor id), else null */
  trophy: (typeof TROPHIES)[number] | null;
}
export interface StampsService {
  /** bumps on every change (cheap HUD signatures) */
  readonly version: number;
  data(): Readonly<StampsData>;
  view(): StampsView;
  /** evaluate against the world now (≈ 1 Hz, and after any service's change hook) */
  check(w: StampWorld): Earned[];
  /** a valley happening the book counts (commits, answers, photos) */
  event(kind: StampEvent, o: { demo: boolean; hour: number }): void;
  onEarn(fn: (e: Earned) => void): () => void;
  /** dev: ink a stamp now (with its reward, toast and sound) */
  devAward(id: string): Earned | null;
  /** dev: ink the first n stamps (no reward; shots of the book) */
  devFill(n: number): void;
  devReset(): void;
}

export function createStamps(store: StampsStore | undefined, ports: StampsPorts = {}, now: () => number = Date.now): StampsService {
  let data: StampsData;
  try { data = parseStamps(store?.load()) ?? emptyStamps(); } catch { data = emptyStamps(); }
  let version = 0;
  let last: StampWorld | null = null;
  /** dwell timers (in memory): when each dwell stamp's test started holding */
  const held = new Map<string, number>();
  const fns = new Set<(e: Earned) => void>();
  const save = () => { version++; try { store?.save(data); } catch (err) { console.warn('[stamps] save failed', err); } };

  const award = (def: StampDef, at: number, pay: boolean): Earned => {
    data.earned[def.id] = at;
    const count = Object.keys(data.earned).length;
    let trophy: Earned['trophy'] = null;
    if (pay) {
      try { ports.pay?.(bitsFor(def), `stamp: ${def.name}`); } catch (err) { console.warn('[stamps] pay failed', err); }
      while (data.trophies < TROPHIES.length && count >= TROPHIES[data.trophies].at) {
        trophy = TROPHIES[data.trophies++];
        try { ports.gift?.(trophy.decor); } catch (err) { console.warn('[stamps] trophy failed', err); }
      }
    }
    return { def, at, count, bits: pay ? bitsFor(def) : 0, trophy };
  };
  const tell = (es: Earned[]) => { for (const e of es) for (const f of [...fns]) { try { f(e); } catch (err) { console.error('[stamps] listener threw', err); } } };

  return {
    get version() { return version; },
    data: () => data,
    view: () => stampsView(data, last),
    check(w) {
      last = w;
      let dirty = observe(data, w);
      const out: Earned[] = [];
      for (const def of STAMPS) {
        if (data.earned[def.id] !== undefined) continue;
        let ok = false;
        try { ok = passes(def, w, data); } catch { ok = false; }
        if (def.dwell) {
          if (!ok) { held.delete(def.id); continue; }
          const since = held.get(def.id) ?? w.now;
          held.set(def.id, since);
          if (w.now - since < def.dwell) continue;
          held.delete(def.id);
        } else if (!ok) continue;
        out.push(award(def, w.now, true));
        dirty = true;
      }
      if (dirty) save();
      tell(out);
      return out;
    },
    event(kind, o) {
      if (!countEvent(data, kind, o)) return;
      save();
      if (last) this.check({ ...last, now: now() });
    },
    onEarn(fn) { fns.add(fn); return () => fns.delete(fn); },
    devAward(id) {
      const def = BY_ID.get(id);
      if (!def || data.earned[id] !== undefined) return null;
      const e = award(def, now(), true);
      save();
      tell([e]);
      return e;
    },
    devFill(n) {
      const t = now();
      STAMPS.slice(0, Math.max(0, n)).forEach((d, i) => { data.earned[d.id] ??= t - i * 3 * DAY_MS; });
      data.trophies = TROPHIES.filter((x) => Object.keys(data.earned).length >= x.at).length;
      save();
    },
    devReset() { data = emptyStamps(); held.clear(); save(); },
  };
}
