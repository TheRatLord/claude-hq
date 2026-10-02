// @pure
/**
 * Visitors: the valley's comings and goings (docs/valley/visitors.md). Three folk who don't live here:
 *
 *  - **Barnaby Pell, the travelling merchant**, whose hand cart rolls in over the south pass on Wednesdays and
 *    Saturdays (and on festival days: the first, the last, the weekends, every day of a short one) and parks on the
 *    square's east side from 8:30 to 17:30. He sells a rotating stock of rare things the General store never has:
 *    rare yard decor, moonflower seeds, a glimmer lure (rarer fish bite for the rest of the day), an explorer's
 *    sketch map that marks the waterfall's secret on your map. One of each per visit; no haggling.
 *  - **Odile, the wandering painter**, who comes on some fair days (seeded, never on a wet one), sets up her easel at
 *    a scenic spot and paints it from 10:00 to 15:00. Once it's finished you can buy the painting: it hangs in the
 *    farmhouse, over the fish tank.
 *  - **Ned, the parcel post**, who arrives on the morning train on Mondays and Thursdays once the train halt is
 *    restored (model/projects.ts), walks a parcel to the mailbox and goes back for the train.
 *
 * Everything here is pure and deterministic by calendar date (`YYYY-MM-DD`, model/almanac.ts `dayKey`): who comes
 * when, the stock and its prices; and the player's side (what was bought, the lure, the maps, the paintings, the
 * parcels, who you've met), persisted through an injected store (browser-local `claude-valley.visitors.v1`).
 * The scene (scene/visitors) walks them in and out; visitorsboard.ts wires this to the wallet and the mailbox.
 */
import type { Season, WeatherKind } from './types.ts';
import { festivalAt } from './calendar.ts';
import { blockKinds, seasonOf } from './sky.ts';
import { forageFor, hashKey, rand } from './collection.ts';
import { decorDef } from './shop.ts';

export const VISITOR_IDS = Object.freeze(['merchant', 'painter', 'postie'] as const);
export type VisitorId = (typeof VISITOR_IDS)[number];
export const isVisitorId = (v: unknown): v is VisitorId => typeof v === 'string' && (VISITOR_IDS as readonly string[]).includes(v);

export interface VisitorDef {
  id: VisitorId;
  name: string;
  /** first name, for lines and toasts */
  short: string;
  title: string;
  /** a line for the notebook / the panel's head */
  blurb: string;
  /** when they come, in words */
  when: string;
  /** local hours: walks in at `arrive`, sets out for home at `leave` */
  arrive: number;
  leave: number;
}

export const VISITORS: Readonly<Record<VisitorId, VisitorDef>> = Object.freeze({
  merchant: {
    id: 'merchant', name: 'Barnaby Pell', short: 'Barnaby', title: 'Travelling merchant',
    blurb: 'A cart of curiosities from over the south pass. Every object has a story; some of the stories are true.',
    when: 'Wednesdays and Saturdays, and on festival days, 8:30 to 17:30',
    arrive: 8.5, leave: 17.5,
  },
  painter: {
    id: 'painter', name: 'Odile Varenne', short: 'Odile', title: 'Wandering painter',
    blurb: 'Paints the valley in a single day, at a different spot each time. The finished canvas is for sale.',
    when: 'some fair days (never in the rain), 9:30 to 16:30',
    arrive: 9.5, leave: 16.5,
  },
  postie: {
    id: 'postie', name: 'Ned Hobbs', short: 'Ned', title: 'Parcel post',
    blurb: 'Rides the morning train in with a parcel for the valley, and the train back out.',
    when: 'Mondays and Thursdays on the morning train, once the halt is restored',
    arrive: 10.25, leave: 11.5,
  },
});
export const visitorDef = (id: string): VisitorDef | undefined => (isVisitorId(id) ? VISITORS[id] : undefined);

// ---------------------------------------------------------------------------------------------
// The calendar

/** day of the week of a `YYYY-MM-DD` key (0 = Sunday), local, DST-proof (noon) */
export function weekday(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12).getDay();
}
const dateOf = (day: string): Date => { const [y, m, d] = day.split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1, 12); };
/** `n` days after `day` */
export function addDays(day: string, n: number): string {
  const t = dateOf(day);
  t.setDate(t.getDate() + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}
export const WEEKDAY_NAME = Object.freeze(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);

/** the merchant's regular days (Wednesday, Saturday) */
export const MERCHANT_DAYS: readonly number[] = Object.freeze([3, 6]);
/** the parcel post's train days (Monday, Thursday) */
export const POSTIE_DAYS: readonly number[] = Object.freeze([1, 4]);
/** share of fair days the painter comes */
export const PAINTER_ODDS = 0.4;

/** A festival day the merchant also comes: every day of a short one (≤ 3 days), else its first, its last and its weekends. */
export function festivalVisit(day: string): boolean {
  const f = festivalAt(dateOf(day)).active;
  if (!f) return false;
  const wd = weekday(day);
  return f.days <= 3 || f.day === 1 || f.day === f.days || wd === 0 || wd === 6;
}

/** Does the merchant come on `day`? */
export const merchantComes = (day: string): boolean => MERCHANT_DAYS.includes(weekday(day)) || festivalVisit(day);

/** A fair painting day: no rain, storm or snow in the 9:00–18:00 weather blocks (model/sky.ts, the same table the sky uses). */
export function fairDay(day: string): boolean {
  const b = blockKinds(day);
  return b.slice(3, 6).every((k) => k !== 'rain' && k !== 'storm' && k !== 'snow');
}
/** Does the painter come on `day`? (seeded, fair days only) */
export const painterComes = (day: string): boolean => fairDay(day) && rand(hashKey(`painter|${day}`))() < PAINTER_ODDS;
/** Does the parcel post come on `day`? (only once the halt is restored) */
export const postieComes = (day: string, halt: boolean): boolean => halt && POSTIE_DAYS.includes(weekday(day));

export interface CalendarCtx { /** the train halt is restored (model/projects.ts) */ halt: boolean }
export function comes(id: VisitorId, day: string, c: CalendarCtx): boolean {
  return id === 'merchant' ? merchantComes(day) : id === 'painter' ? painterComes(day) : postieComes(day, c.halt);
}
/** who comes on `day` */
export const visitorsOn = (day: string, c: CalendarCtx): VisitorId[] => VISITOR_IDS.filter((id) => comes(id, day, c));
/** The next visit on or after `day` (within `horizon` days): its day and how many days away (0 = today). */
export function nextVisit(id: VisitorId, day: string, c: CalendarCtx, horizon = 21): { day: string; inDays: number } | null {
  for (let i = 0; i <= horizon; i++) { const d = addDays(day, i); if (comes(id, d, c)) return { day: d, inDays: i }; }
  return null;
}
/** "today" / "tomorrow" / "on Saturday" / "on 14 Oct" */
export function whenText(v: { day: string; inDays: number } | null): string {
  if (!v) return 'not soon';
  if (v.inDays === 0) return 'today';
  if (v.inDays === 1) return 'tomorrow';
  if (v.inDays < 7) return `on ${WEEKDAY_NAME[weekday(v.day)]}`;
  return `on ${dateOf(v.day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
}

/** Where a visitor is in their day at `hour`: not yet, here (walking in or settled), or gone home. */
export type Phase = 'before' | 'here' | 'after';
export function phaseAt(id: VisitorId, hour: number): Phase {
  const d = VISITORS[id];
  return hour < d.arrive ? 'before' : hour < d.leave ? 'here' : 'after';
}

/** Weather the painter won't work in (she packs up and goes): rain, a storm, or more than flurries of snow. */
export const tooWetToPaint = (kind: WeatherKind, intensity: number): boolean => kind === 'rain' || kind === 'storm' || (kind === 'snow' && intensity > 0.4);

// ---------------------------------------------------------------------------------------------
// The merchant's stock

export type StockKind = 'decor' | 'seed' | 'lure' | 'map';
export interface StockDef {
  id: string;
  kind: StockKind;
  name: string;
  blurb: string;
  /** Barnaby's story about it (the panel's italic line) */
  tale: string;
  /** base price (each visit's price varies a little) */
  price: number;
  /** the yard decor it becomes (decor, seed: model/shop.ts, `visitor: true`) */
  decor?: string;
  /** the secret a map marks */
  secret?: string;
}

/** how much more often the rarer fish bite on the lure's day */
export const LURE_BOOST = 2.5;
/** the painter's price for a finished canvas */
export const PAINTING_PRICE = 160;

export const STOCK: readonly StockDef[] = Object.freeze([
  { id: 'starlamp', kind: 'decor', decor: 'starlamp', name: 'Star-glass lantern', price: 240,
    blurb: 'A brass lantern glazed in coloured glass. Lights up after dark and throws little stars on the grass.',
    tale: 'From a lighthouse keeper who retired inland. Said she missed the stars more than the sea.' },
  { id: 'sundial', kind: 'decor', decor: 'sundial', name: 'Brass sundial', price: 210,
    blurb: 'A green-bronze sundial on a stone column. Accurate to the nearest pleasant afternoon.',
    tale: 'It once told the time for a duke. The duke was always late anyway.' },
  { id: 'moonseed', kind: 'seed', decor: 'moonflower', name: 'Moonflower seeds', price: 170,
    blurb: 'A packet of seeds that grows into a pot of white moonflowers in your yard. They open at dusk and glow all night.',
    tale: 'Only bloom when nobody is looking. So I\'m told. I\'ve never caught them at it.' },
  { id: 'whirligig', kind: 'decor', decor: 'whirligig', name: 'Whirligig', price: 150,
    blurb: 'A painted wooden wind toy on a pole: a little farmer pumping a well, faster the harder it blows.',
    tale: 'Carved on a long winter by a shepherd with time and a very sharp knife.' },
  { id: 'lure', kind: 'lure', name: 'Glimmer lure', price: 85,
    blurb: 'A silver spoon lure with a fleck of mother-of-pearl. For the rest of today the rarer fish bite more often.',
    tale: 'Blessed by a heron. A very serious heron. Works for one day; herons are busy birds.' },
  { id: 'map', kind: 'map', secret: 'grotto', name: 'Explorer\'s sketch map', price: 140,
    blurb: 'A water-stained page from an old explorer\'s journal. It marks a secret near the waterfall on your map (M).',
    tale: 'Signed "R." in the corner. Bought it off a fellow who bought it off a fellow. You know how it is.' },
]);
const STOCK_BY_ID = new Map(STOCK.map((s) => [s.id, s]));
export const stockDef = (id: string): StockDef | undefined => STOCK_BY_ID.get(id);

const round5 = (n: number): number => Math.max(5, Math.round(n / 5) * 5);

/**
 * The cart's stock on `day` (deterministic): two of the four rare pieces, the glimmer lure on most days, the sketch
 * map on some (it shows only while its secret is unmapped: `StockCtx.secretKnown`), prices within ±8 % of the base.
 */
export function stockFor(day: string): { def: StockDef; price: number }[] {
  const r = rand(hashKey(`merchant|${day}`));
  const decor = STOCK.filter((s) => s.kind === 'decor' || s.kind === 'seed').map((s) => ({ s, k: r() })).sort((a, b) => a.k - b.k).map((x) => x.s);
  const pick: StockDef[] = decor.slice(0, 2);
  if (r() < 0.7) pick.push(stockDef('lure')!);
  if (r() < 0.55) pick.push(stockDef('map')!);
  if (pick.length < 3) pick.push(decor[2]);
  return pick.map((def) => ({ def, price: round5(def.price * (0.92 + r() * 0.16)) }));
}

// ---------------------------------------------------------------------------------------------
// The painter's spots

export interface PaintSpot { id: string; name: string; /** the painting's subject, for its title */ subject: string }
/** Scenic spots she sets up at (the scene places the easel; ids are save keys). */
export const PAINT_SPOTS: readonly PaintSpot[] = Object.freeze([
  { id: 'windmill', name: 'below the windmill hill', subject: 'The windmill' },
  { id: 'pond', name: 'on the pond\'s beach', subject: 'The pond' },
  { id: 'farmhouse', name: 'across the lane from the farmhouse', subject: 'The farmhouse' },
  { id: 'barn', name: 'in the meadow by the barn', subject: 'The red barn' },
  { id: 'bridge', name: 'on the river bank by the bridge', subject: 'The old bridge' },
  { id: 'stones', name: 'by the standing stones', subject: 'The standing stones' },
]);
export const paintSpot = (id: string): PaintSpot | undefined => PAINT_SPOTS.find((s) => s.id === id);
/** where she paints on `day` */
export const paintSpotFor = (day: string): PaintSpot => PAINT_SPOTS[hashKey(`easel|${day}`) % PAINT_SPOTS.length];
/** hours she works on the canvas: 10:00 → 15:00 */
export const PAINT_FROM = 10, PAINT_TO = 15;
/** how far along the day's canvas is at `hour` (0..1) */
export const paintProgress = (hour: number): number => Math.max(0, Math.min(1, (hour - PAINT_FROM) / (PAINT_TO - PAINT_FROM)));
const SEASON_WORD: Readonly<Record<Season, string>> = { spring: 'in spring', summer: 'in high summer', autumn: 'in autumn', winter: 'in winter' };
export const paintingTitle = (spot: string, season: Season): string => `${paintSpot(spot)?.subject ?? 'The valley'}, ${SEASON_WORD[season] ?? season}`;

// ---------------------------------------------------------------------------------------------
// The player's side: data, parse, actions

export interface Painting { day: string; spot: string; season: Season; title: string; at: number }

export interface VisitorsData {
  v: 1;
  /** bought on a visit: `${day}|${stock id}` → 1 */
  bought: Record<string, number>;
  /** the day the glimmer lure was bought ('' = never) */
  lure: string;
  /** secrets marked on your map by the sketch map */
  maps: string[];
  /** paintings bought (newest last; the farmhouse hangs the newest) */
  paintings: Painting[];
  /** days the parcel post delivered (newest last, a few kept) */
  posted: string[];
  /** visitors you've talked to */
  met: VisitorId[];
  /** the last day each visitor's arrival was announced (a toast once a day) */
  told: Partial<Record<VisitorId, string>>;
  /** lifetime: bits spent with visitors, things bought */
  total: { spent: number; bought: number };
}

export const emptyVisitors = (): VisitorsData => ({ v: 1, bought: {}, lure: '', maps: [], paintings: [], posted: [], met: [], told: {}, total: { spent: 0, bought: 0 } });

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v: unknown): v is string => typeof v === 'string' && DAY_RE.test(v);
const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];
const PAINTINGS_KEPT = 12, POSTED_KEPT = 16, BOUGHT_KEPT = 60;
const int = (v: unknown, hi = 1e9): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(hi, Math.floor(v))) : 0);

/** Tolerant parse of stored data (anything malformed → null; broken entries are dropped). */
export function parseVisitors(raw: unknown): VisitorsData | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return null;
  const d = emptyVisitors();
  if (o.bought && typeof o.bought === 'object' && !Array.isArray(o.bought)) {
    for (const [k, v] of Object.entries(o.bought as Record<string, unknown>).slice(-BOUGHT_KEPT)) {
      const [day, id] = k.split('|');
      if (isDay(day) && stockDef(id ?? '') && int(v, 99)) d.bought[k] = int(v, 99);
    }
  }
  d.lure = isDay(o.lure) ? o.lure : '';
  if (Array.isArray(o.maps)) d.maps = [...new Set(o.maps.filter((m): m is string => typeof m === 'string' && STOCK.some((s) => s.secret === m)))];
  if (Array.isArray(o.paintings)) {
    for (const p of o.paintings) {
      if (!p || typeof p !== 'object') continue;
      const q = p as Record<string, unknown>;
      if (!isDay(q.day) || typeof q.spot !== 'string' || !paintSpot(q.spot) || !SEASONS.includes(q.season as Season)) continue;
      if (d.paintings.some((x) => x.day === q.day)) continue;
      d.paintings.push({ day: q.day, spot: q.spot, season: q.season as Season, title: paintingTitle(q.spot, q.season as Season), at: int(q.at, 8.64e15) });
    }
    d.paintings = d.paintings.slice(-PAINTINGS_KEPT);
  }
  if (Array.isArray(o.posted)) d.posted = [...new Set(o.posted.filter(isDay))].slice(-POSTED_KEPT);
  if (Array.isArray(o.met)) d.met = [...new Set(o.met.filter(isVisitorId))];
  if (o.told && typeof o.told === 'object' && !Array.isArray(o.told)) {
    for (const [k, v] of Object.entries(o.told as Record<string, unknown>)) if (isVisitorId(k) && isDay(v)) d.told[k] = v;
  }
  const t = (o.total ?? {}) as Record<string, unknown>;
  d.total = { spent: int(t?.spent), bought: int(t?.bought) };
  return d;
}

export const lureActive = (d: VisitorsData, day: string): boolean => d.lure === day;
/** the odds multiplier for the rarer fish today (1 without the lure) */
export const fishBoost = (d: VisitorsData, day: string): number => (lureActive(d, day) ? LURE_BOOST : 1);
export const mapped = (d: VisitorsData, secret: string): boolean => d.maps.includes(secret);
export const paintingOn = (d: VisitorsData, day: string): Painting | undefined => d.paintings.find((p) => p.day === day);

/** What the stock entries depend on besides the data: owned decor, your purse, secrets already found. */
export interface StockCtx {
  coins: number;
  /** copies of a decor id you own (model/wallet.ts) */
  owned(decor: string): number;
  /** a secret you've found yourself (the grotto service): its map isn't stocked */
  secretKnown(secret: string): boolean;
}
/** Why a stock entry can't be bought: you own all it allows, you bought it this visit, you know the secret, too dear. */
export type StockLock = 'owned' | 'bought' | 'known' | 'coins' | null;
export interface StockEntry { def: StockDef; price: number; lock: StockLock }

/** The cart on `day` as the panel shows it (the map drops out once its secret is found or marked). */
export function stockView(d: VisitorsData, day: string, c: StockCtx): StockEntry[] {
  return stockFor(day)
    .filter((e) => !(e.def.kind === 'map' && e.def.secret && c.secretKnown(e.def.secret) && !d.bought[`${day}|${e.def.id}`]))
    .map((e) => ({ ...e, lock: lockOf(d, day, e.def, e.price, c) }));
}
function lockOf(d: VisitorsData, day: string, def: StockDef, price: number, c: StockCtx): StockLock {
  if (d.bought[`${day}|${def.id}`]) return 'bought';
  if (def.decor) { const dd = decorDef(def.decor); if (dd && c.owned(def.decor) >= dd.max) return 'owned'; }
  if (def.kind === 'map' && def.secret && (mapped(d, def.secret) || c.secretKnown(def.secret))) return 'known';
  if (c.coins < price) return 'coins';
  return null;
}

// ---------------------------------------------------------------------------------------------
// The live service

export interface VisitorsStore { load(): unknown; save(data: VisitorsData): void }

export interface VisitorsDeps {
  /** pay bits (false, nothing taken, when short) */
  spend(coins: number, why: string): boolean;
  /** give the bits back (a purchase that couldn't be delivered) */
  refund?(coins: number, why: string): void;
  /** put a decor piece into the yard (model/wallet.ts `gift`): false when it couldn't */
  giftDecor(id: string): boolean;
  /** a find into the basket (the parcel post's present) */
  stash?(id: string, n: number): void;
  coins(): number;
  owned(decor: string): number;
  secretKnown(secret: string): boolean;
  halt(): boolean;
}

export type BuyResult = { ok: true; def: StockDef; price: number } | { ok: false; reason: 'unknown' | 'closed' | Exclude<StockLock, null> };
export type PaintingResult = { ok: true; painting: Painting; price: number } | { ok: false; reason: 'unfinished' | 'bought' | 'coins' | 'unknown' };

export interface Parcel { id: string; day: string; title: string; body: string; item: string | null }

export type VisitorsChange =
  | { kind: 'buy'; day: string; def: StockDef; price: number }
  | { kind: 'painting'; painting: Painting; price: number }
  | { kind: 'arrive'; id: VisitorId; day: string }
  | { kind: 'met'; id: VisitorId }
  | { kind: 'parcel'; parcel: Parcel }
  | { kind: 'dev' };

export interface VisitorsService {
  readonly version: number;
  data(): Readonly<VisitorsData>;
  /** today's merchant stock as the panel shows it */
  stock(day: string): StockEntry[];
  /** buy from the merchant's cart (he must be here: `open`) */
  buy(id: string, day: string, open: boolean): BuyResult;
  /** buy the painter's finished canvas (`progress` ≥ 1) */
  buyPainting(day: string, spot: string, season: Season, progress: number): PaintingResult;
  fishBoost(day: string): number;
  mapped(secret: string): boolean;
  /** a visitor walked in today: true (and a change) the first time that day, so the HUD announces it once */
  arrived(id: VisitorId, day: string): boolean;
  /** you talked to them (the notebook's page) */
  met(id: VisitorId): void;
  /** the parcel post reached the mailbox: the parcel (a letter + a find), once per day; null when already delivered */
  deliver(day: string, season: Season, at: number): Parcel | null;
  /** the parcel letters already delivered (re-posted on load) */
  parcels(): Parcel[];
  onChange(fn: (c: VisitorsChange) => void): () => void;
  devReset(): void;
}

/** The parcel for `day`: a letter from over the pass, with a seasonal find in the basket and the merchant's next visit. */
export function parcelFor(day: string, season: Season, halt: boolean): Parcel {
  const pool = forageFor(season).filter((f) => !f.rare);
  const item = pool.length ? pool[hashKey(`parcel|${day}`) % pool.length] : null;
  const next = nextVisit('merchant', addDays(day, 1), { halt }, 14);
  const bodies = [
    'A parcel came up the line for you, wrapped in brown paper and far too much string. Somebody over the pass thought of you.',
    'One parcel, valley delivery, handle with care (I did, mostly). The guard says the line\'s never been busier since the halt reopened.',
    'Parcel post! It rattled the whole way up the line. No, I didn\'t peek. Well. A little.',
  ];
  const body = [
    bodies[hashKey(`parcel-body|${day}`) % bodies.length],
    item ? `\n\nInside: ${/^[aeiou]/i.test(item.name) ? 'an' : 'a'} ${item.name.toLowerCase()} (it's in your basket).` : '',
    next ? `\n\nAnd a note from Barnaby Pell, pinned to the string: "My cart calls again ${whenText({ day: next.day, inDays: next.inDays + 1 })}. Bring bits."` : '',
    '\n\nNed\nParcel post, the morning train',
  ].join('');
  return { id: `visitors:parcel:${day}`, day, title: 'A parcel off the morning train', body, item: item?.id ?? null };
}

export function createVisitors(st: VisitorsStore | undefined, deps: VisitorsDeps, o: { now?: () => number } = {}): VisitorsService {
  const now = o.now ?? Date.now;
  let data: VisitorsData | null = null;
  try { data = parseVisitors(st?.load()); } catch { data = null; }
  const d = data ?? emptyVisitors();
  let version = 0;
  const fns = new Set<(c: VisitorsChange) => void>();
  const changed = (c: VisitorsChange) => {
    version++;
    // keep the purchase log short (a visit's keys are only read on that day)
    const keys = Object.keys(d.bought);
    if (keys.length > BOUGHT_KEPT) for (const k of keys.slice(0, keys.length - BOUGHT_KEPT)) delete d.bought[k];
    try { st?.save(d); } catch (err) { console.warn('[visitors] save failed', err); }
    for (const f of [...fns]) { try { f(c); } catch (err) { console.error('[visitors] listener threw', err); } }
  };
  const ctx = (): StockCtx => ({ coins: deps.coins(), owned: (id) => deps.owned(id), secretKnown: (s) => deps.secretKnown(s) });
  const parcels = (): Parcel[] => d.posted.map((day) => parcelFor(day, seasonOfDay(day), true));

  return {
    get version() { return version; },
    data: () => d,
    stock: (day) => stockView(d, day, ctx()),
    buy(id, day, open) {
      if (!open) return { ok: false, reason: 'closed' };
      const e = stockView(d, day, ctx()).find((x) => x.def.id === id);
      if (!e) return { ok: false, reason: 'unknown' };
      if (e.lock) return { ok: false, reason: e.lock };
      if (!deps.spend(e.price, `${e.def.name} from Barnaby`)) return { ok: false, reason: 'coins' };
      if (e.def.decor && !deps.giftDecor(e.def.decor)) { deps.refund?.(e.price, 'refund'); return { ok: false, reason: 'owned' }; }
      if (e.def.kind === 'lure') d.lure = day;
      if (e.def.kind === 'map' && e.def.secret && !d.maps.includes(e.def.secret)) d.maps.push(e.def.secret);
      d.bought[`${day}|${e.def.id}`] = 1;
      d.total.spent += e.price; d.total.bought++;
      changed({ kind: 'buy', day, def: e.def, price: e.price });
      return { ok: true, def: e.def, price: e.price };
    },
    buyPainting(day, spot, season, progress) {
      if (!paintSpot(spot)) return { ok: false, reason: 'unknown' };
      if (paintingOn(d, day)) return { ok: false, reason: 'bought' };
      if (progress < 1) return { ok: false, reason: 'unfinished' };
      if (!deps.spend(PAINTING_PRICE, 'a painting from Odile')) return { ok: false, reason: 'coins' };
      const painting: Painting = { day, spot, season, title: paintingTitle(spot, season), at: now() };
      d.paintings.push(painting);
      if (d.paintings.length > PAINTINGS_KEPT) d.paintings.splice(0, d.paintings.length - PAINTINGS_KEPT);
      d.total.spent += PAINTING_PRICE; d.total.bought++;
      changed({ kind: 'painting', painting, price: PAINTING_PRICE });
      return { ok: true, painting, price: PAINTING_PRICE };
    },
    fishBoost: (day) => fishBoost(d, day),
    mapped: (s) => mapped(d, s),
    arrived(id, day) {
      if (!isVisitorId(id) || d.told[id] === day) return false;
      d.told[id] = day;
      changed({ kind: 'arrive', id, day });
      return true;
    },
    met(id) {
      if (!isVisitorId(id) || d.met.includes(id)) return;
      d.met.push(id);
      changed({ kind: 'met', id });
    },
    deliver(day, season, at) {
      void at;
      if (!isDay(day) || d.posted.includes(day)) return null;
      const parcel = parcelFor(day, season, deps.halt());
      d.posted.push(day);
      if (d.posted.length > POSTED_KEPT) d.posted.splice(0, d.posted.length - POSTED_KEPT);
      if (parcel.item) deps.stash?.(parcel.item, 1);
      changed({ kind: 'parcel', parcel });
      return parcel;
    },
    parcels,
    onChange(fn) { fns.add(fn); return () => fns.delete(fn); },
    devReset() { Object.assign(d, emptyVisitors()); changed({ kind: 'dev' }); },
  };
}

/** the season of a calendar day (model/sky.ts, by month) */
const seasonOfDay = (day: string): Season => seasonOf(dateOf(day).getMonth());
