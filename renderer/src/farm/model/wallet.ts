// @pure
/**
 * The player's pockets: bits (the valley's coin, model/shop.ts), the basket of finds still held, and the yard decor
 * they own and where each piece stands.
 *
 *  - **Basket**: every find (forage picked, fish caught, junk) goes into the basket as well as into the Collections
 *    book (the book remembers everything ever found; the basket is what you're carrying). Bram buys from it at the
 *    shipping bin, the General store too: `sell` moves items from held to sold and pays `sellPrice` each.
 *  - **Work**: real agent work pays a little too (a commit shipped, tests passing, a finished task…), capped per day
 *    so a busy test loop can't print money (`WORK_PAY`, `WORK_CAP`).
 *  - **Decor**: `buy` takes the price (scaled by copies owned, gated by Almanac rank / season) and adds a piece to
 *    storage; `place` puts a piece on one of the yard's `YARD_SLOTS` (the scene owns where those are), swapping with
 *    whatever stood there; `store`, `rotate` and `restyle` do what they say.
 *
 * Pure: no DOM, no three; the clock and the store are injected (browser-local storage in the app, memory in tests).
 */
import type { Season, ValleyEventKind } from './types.ts';
import { dayKey } from './almanac.ts';
import { collectDef } from './collection.ts';
import { DECOR, decorDef, lockOf, priceOf, sellPrice } from './shop.ts';
import type { DecorDef, Locked } from './shop.ts';

/** slots in the player's yard (5 × 3, scene/yard/layout.ts) */
export const YARD_SLOTS = 15;
/** rotation steps per full turn (45°) */
export const ROT_STEPS = 8;

/** bits per valley event that is real agent work (the same events the Almanac counts as harvests) */
export const WORK_PAY: Readonly<Partial<Record<ValleyEventKind, number>>> = Object.freeze({
  ship: 4, celebrate: 2, finished: 3, unblocked: 2, 'plot-opened': 3, 'duckling-hatched': 1,
});
/** most bits real work pays in one day */
export const WORK_CAP = 40;
/** most of one item the basket holds (a sanity cap, not a game rule anyone should meet) */
const BASKET_MAX = 999;
const COIN_MAX = 9_999_999;

export interface Piece {
  /** stable per profile */
  uid: number;
  /** DecorDef id */
  id: string;
  /** yard slot 0..YARD_SLOTS-1, or null = in storage */
  slot: number | null;
  /** 0..ROT_STEPS-1, in 45° steps (0 faces the house, i.e. south) */
  rot: number;
  /** index into the def's `styles` */
  style: number;
}

export interface WalletData {
  v: 1;
  coins: number;
  /** finds held, per collectible id */
  basket: Record<string, number>;
  /** lifetime sold, per collectible id */
  sold: Record<string, number>;
  /** lifetime totals */
  total: { sales: number; work: number; spent: number };
  /** today's work pay (the daily cap) */
  work: { day: string; coins: number };
  pieces: Piece[];
  nextUid: number;
}

export const emptyWallet = (): WalletData => ({
  v: 1, coins: 0, basket: {}, sold: {}, total: { sales: 0, work: 0, spent: 0 }, work: { day: '', coins: 0 }, pieces: [], nextUid: 1,
});

const num = (v: unknown, lo = 0, hi = Number.MAX_SAFE_INTEGER): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : null);
function counts(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = num(v, 0, BASKET_MAX);
    if (collectDef(id) && n) out[id] = n;
  }
  return out;
}

/** Tolerant parse of stored data (anything malformed → null; unknown ids and broken pieces are dropped). */
export function parseWallet(raw: unknown): WalletData | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1 || num(o.coins) === null) return null;
  const t = (o.total ?? {}) as Record<string, unknown>;
  const w = (o.work ?? {}) as Record<string, unknown>;
  const pieces: Piece[] = [];
  const taken = new Set<number>(), uids = new Set<number>();
  if (Array.isArray(o.pieces)) for (const p of o.pieces) {
    if (!p || typeof p !== 'object') continue;
    const q = p as Record<string, unknown>;
    const uid = num(q.uid, 1), def = typeof q.id === 'string' ? decorDef(q.id) : undefined;
    if (!uid || !def || uids.has(uid)) continue;
    let slot = q.slot === null || q.slot === undefined ? null : num(q.slot, 0, YARD_SLOTS - 1);
    if (slot !== null && taken.has(slot)) slot = null;
    if (slot !== null) taken.add(slot);
    uids.add(uid);
    pieces.push({ uid, id: def.id, slot, rot: (num(q.rot, 0) ?? 0) % ROT_STEPS, style: Math.min((def.styles?.length ?? 1) - 1, num(q.style, 0) ?? 0) });
  }
  return {
    v: 1,
    coins: num(o.coins, 0, COIN_MAX) ?? 0,
    basket: counts(o.basket),
    sold: counts(o.sold),
    total: { sales: num(t.sales) ?? 0, work: num(t.work) ?? 0, spent: num(t.spent) ?? 0 },
    work: { day: typeof w.day === 'string' ? w.day : '', coins: num(w.coins) ?? 0 },
    pieces,
    nextUid: Math.max(num(o.nextUid, 1) ?? 1, ...pieces.map((p) => p.uid + 1)),
  };
}

// ---------------------------------------------------------------------------------------------
// Basket

export const basketCount = (d: WalletData): number => Object.values(d.basket).reduce((a, b) => a + b, 0);
export const basketValue = (d: WalletData): number => Object.entries(d.basket).reduce((a, [id, n]) => a + sellPrice(id) * n, 0);

/** A find goes into the basket (unknown ids ignored). Returns the new count held. */
export function stash(d: WalletData, id: string, n = 1): number {
  if (!collectDef(id) || n <= 0) return d.basket[id] ?? 0;
  d.basket[id] = Math.min(BASKET_MAX, (d.basket[id] ?? 0) + Math.floor(n));
  return d.basket[id];
}

export interface Sale { n: number; coins: number }

/** Sell up to `n` of one item from the basket (all of it by default). */
export function sell(d: WalletData, id: string, n = Infinity): Sale {
  const held = d.basket[id] ?? 0;
  const k = Math.min(held, Math.max(0, Math.floor(n)));
  if (!k) return { n: 0, coins: 0 };
  const coins = sellPrice(id) * k;
  if (held - k > 0) d.basket[id] = held - k; else delete d.basket[id];
  d.sold[id] = Math.min(BASKET_MAX * 1000, (d.sold[id] ?? 0) + k);
  d.coins = Math.min(COIN_MAX, d.coins + coins);
  d.total.sales += coins;
  return { n: k, coins };
}

/** Take up to `n` of one item out of the basket without pay (a gift, a request delivered). Returns how many. */
export function take(d: WalletData, id: string, n = 1): number {
  const held = d.basket[id] ?? 0;
  const k = Math.min(held, Math.max(0, Math.floor(n)));
  if (!k) return 0;
  if (held - k > 0) d.basket[id] = held - k; else delete d.basket[id];
  return k;
}

/** Sell everything in the basket. */
export function sellAll(d: WalletData): Sale {
  let n = 0, coins = 0;
  for (const id of Object.keys(d.basket)) { const s = sell(d, id); n += s.n; coins += s.coins; }
  return { n, coins };
}

// ---------------------------------------------------------------------------------------------
// Work pay

/** Pay for a bit of real agent work (a valley event): bits earned, 0 once today's cap is reached. */
export function workPay(d: WalletData, kind: ValleyEventKind, nowMs: number): number {
  const pay = WORK_PAY[kind] ?? 0;
  if (!pay) return 0;
  const day = dayKey(nowMs);
  if (d.work.day !== day) d.work = { day, coins: 0 };
  const earned = Math.max(0, Math.min(pay, WORK_CAP - d.work.coins));
  if (!earned) return 0;
  d.work.coins += earned;
  d.coins = Math.min(COIN_MAX, d.coins + earned);
  d.total.work += earned;
  return earned;
}

/** Bits real work has paid today, and what's left under the cap. */
export function workToday(d: WalletData, nowMs: number): { coins: number; left: number } {
  const c = d.work.day === dayKey(nowMs) ? d.work.coins : 0;
  return { coins: c, left: WORK_CAP - c };
}

// ---------------------------------------------------------------------------------------------
// Decor

export const ownedOf = (d: WalletData, id: string): number => d.pieces.filter((p) => p.id === id).length;
export const pieceOf = (d: WalletData, uid: number): Piece | undefined => d.pieces.find((p) => p.uid === uid);
export const pieceAt = (d: WalletData, slot: number): Piece | undefined => d.pieces.find((p) => p.slot === slot);
export const freeSlots = (d: WalletData): number[] => Array.from({ length: YARD_SLOTS }, (_, i) => i).filter((i) => !pieceAt(d, i));

export interface ShopEntry {
  def: DecorDef;
  /** price of the next copy */
  price: number;
  owned: number;
  placed: number;
  locked: Locked;
  affordable: boolean;
}

/** what the shelves depend on: the Almanac rank, the season, and (optional) villagers' hearts (model/friends.ts) */
export interface ShopCtx { rank: number; season: Season; hearts?: (id: string) => number }

/** The store's shelves right now: every item with its price and whether you can have it (keepsakes and gifts are never stocked). */
export function shopView(d: WalletData, o: ShopCtx): ShopEntry[] {
  return DECOR.filter((def) => !def.keepsake && !def.gift).map((def) => {
    const owned = ownedOf(d, def.id);
    const price = priceOf(def, owned);
    return {
      def, price, owned, placed: d.pieces.filter((p) => p.id === def.id && p.slot !== null).length,
      locked: lockOf(def, { ...o, owned }), affordable: d.coins >= price,
    };
  });
}

export type BuyResult = { ok: true; piece: Piece; price: number } | { ok: false; reason: 'unknown' | 'coins' | Exclude<Locked, null> };

/**
 * Buy one decor item: pays, adds the piece to storage, or puts it straight on the first free yard slot when
 * `autoPlace` (the shop's default: what you buy shows up in the yard).
 */
export function buy(d: WalletData, id: string, o: ShopCtx & { autoPlace?: boolean; free?: boolean }): BuyResult {
  const def = decorDef(id);
  if (!def) return { ok: false, reason: 'unknown' };
  const owned = ownedOf(d, id);
  const locked = lockOf(def, { rank: o.rank, season: o.season, owned, hearts: o.hearts });
  if (locked && !(o.free && locked !== 'max')) return { ok: false, reason: locked };
  const price = o.free ? 0 : priceOf(def, owned);
  if (d.coins < price) return { ok: false, reason: 'coins' };
  d.coins -= price;
  d.total.spent += price;
  const slot = o.autoPlace ? (freeSlots(d)[0] ?? null) : null;
  const piece: Piece = { uid: d.nextUid++, id, slot, rot: 0, style: 0 };
  d.pieces.push(piece);
  return { ok: true, piece, price };
}

/**
 * Put a piece on a yard slot. Whatever stood there swaps into the moved piece's old slot (or goes to storage when the
 * moved piece came from storage). Returns the uid of the piece that was displaced, if any; null when nothing changed.
 */
export function place(d: WalletData, uid: number, slot: number): { moved: boolean; displaced: number | null } {
  const p = pieceOf(d, uid);
  if (!p || !Number.isInteger(slot) || slot < 0 || slot >= YARD_SLOTS) return { moved: false, displaced: null };
  if (p.slot === slot) return { moved: false, displaced: null };
  const other = pieceAt(d, slot);
  if (other) other.slot = p.slot;
  p.slot = slot;
  return { moved: true, displaced: other?.uid ?? null };
}

/** Take a piece out of the yard into storage. */
export function store(d: WalletData, uid: number): boolean {
  const p = pieceOf(d, uid);
  if (!p || p.slot === null) return false;
  p.slot = null;
  return true;
}

/** Turn a piece by `steps` × 45°. */
export function rotate(d: WalletData, uid: number, steps = 1): number | null {
  const p = pieceOf(d, uid);
  if (!p) return null;
  p.rot = (((p.rot + steps) % ROT_STEPS) + ROT_STEPS) % ROT_STEPS;
  return p.rot;
}

/** Cycle a piece through its def's styles (hats, colours). Returns the new style name, null if it has none. */
export function restyle(d: WalletData, uid: number): string | null {
  const p = pieceOf(d, uid);
  const styles = p ? decorDef(p.id)?.styles : undefined;
  if (!p || !styles || styles.length < 2) return null;
  p.style = (p.style + 1) % styles.length;
  return styles[p.style];
}

// ---------------------------------------------------------------------------------------------
// The live wallet: data + store + listeners (main.ts creates one; the scene and the HUD both read it)

export interface WalletStore {
  load(): unknown;
  save(data: WalletData): void;
}

export type WalletChange =
  | { kind: 'stash'; id: string; n: number }
  | { kind: 'sell'; n: number; coins: number }
  | { kind: 'work'; coins: number }
  | { kind: 'buy'; piece: Piece; price: number }
  | { kind: 'take'; id: string; n: number }
  | { kind: 'reward'; coins: number; why: string }
  | { kind: 'spend'; coins: number; why: string }
  | { kind: 'gift'; piece: Piece }
  | { kind: 'yard'; uid: number }
  | { kind: 'dev' };

export interface WalletService {
  /** bumps on every change (cheap HUD / scene signatures) */
  readonly version: number;
  /** bumps only when the yard layout or the set of pieces changes (the scene rebuilds the decor mesh) */
  readonly yardVersion: number;
  data(): Readonly<WalletData>;
  coins(): number;
  basketCount(): number;
  basketValue(): number;
  workToday(): { coins: number; left: number };
  shop(o: ShopCtx): ShopEntry[];
  stash(id: string, n?: number): void;
  sell(id: string, n?: number): Sale;
  sellAll(): Sale;
  /** take finds out of the basket without pay (gifts, requests); returns how many */
  take(id: string, n?: number): number;
  /** bits for something done (a villager's request) */
  reward(coins: number, why: string): void;
  /** pay bits for something that isn't decor (the pet's kibble-fund donation); false (and nothing taken) if short */
  spend(coins: number, why: string): boolean;
  /** a free decor piece (a villager's keepsake), straight into the yard when there's room */
  gift(id: string): Piece | null;
  work(kind: ValleyEventKind): number;
  buy(id: string, o: ShopCtx & { autoPlace?: boolean; free?: boolean }): BuyResult;
  place(uid: number, slot: number): { moved: boolean; displaced: number | null };
  store(uid: number): boolean;
  rotate(uid: number, steps?: number): number | null;
  restyle(uid: number): string | null;
  onChange(fn: (c: WalletChange) => void): () => void;
  /** dev: add (or with a negative n, take) bits */
  devCoins(n: number): void;
  /** dev: forget everything */
  devReset(): void;
}

export function createWallet(st: WalletStore | undefined, o: { now?: () => number; seed?: () => Record<string, number> } = {}): WalletService {
  const now = o.now ?? Date.now;
  let data: WalletData | null = null;
  try { data = parseWallet(st?.load()); } catch { data = null; }
  if (!data) {
    // first run: whatever the Collections book already holds starts out in the basket (earlier finds are sellable)
    data = emptyWallet();
    try { for (const [id, n] of Object.entries(o.seed?.() ?? {})) stash(data, id, n); } catch { /* optional */ }
  }
  const d = data;
  let version = 0, yardVersion = 0;
  const fns = new Set<(c: WalletChange) => void>();
  const changed = (c: WalletChange, yard = false) => {
    version++;
    if (yard) yardVersion++;
    try { st?.save(d); } catch (err) { console.warn('[wallet] save failed', err); }
    for (const f of [...fns]) { try { f(c); } catch (err) { console.error('[wallet] listener threw', err); } }
  };
  return {
    get version() { return version; },
    get yardVersion() { return yardVersion; },
    data: () => d,
    coins: () => d.coins,
    basketCount: () => basketCount(d),
    basketValue: () => basketValue(d),
    workToday: () => workToday(d, now()),
    shop: (x) => shopView(d, x),
    stash(id, n = 1) { const before = d.basket[id] ?? 0; if (stash(d, id, n) !== before) changed({ kind: 'stash', id, n }); },
    sell(id, n) { const s = sell(d, id, n); if (s.n) changed({ kind: 'sell', ...s }); return s; },
    sellAll() { const s = sellAll(d); if (s.n) changed({ kind: 'sell', ...s }); return s; },
    take(id, n = 1) { const k = take(d, id, n); if (k) changed({ kind: 'take', id, n: k }); return k; },
    reward(c, why) {
      const k = Math.max(0, Math.floor(c));
      if (!k) return;
      d.coins = Math.min(COIN_MAX, d.coins + k);
      changed({ kind: 'reward', coins: k, why });
    },
    spend(c, why) {
      const k = Math.max(0, Math.floor(c));
      if (k > d.coins) return false;
      if (!k) return true;
      d.coins -= k;
      d.total.spent += k;
      changed({ kind: 'spend', coins: k, why });
      return true;
    },
    gift(id) { const r = buy(d, id, { rank: 99, season: 'spring', autoPlace: true, free: true }); if (!r.ok) return null; changed({ kind: 'gift', piece: r.piece }, true); return r.piece; },
    work(kind) { const c = workPay(d, kind, now()); if (c) changed({ kind: 'work', coins: c }); return c; },
    buy(id, x) { const r = buy(d, id, x); if (r.ok) changed({ kind: 'buy', piece: r.piece, price: r.price }, true); return r; },
    place(uid, slot) { const r = place(d, uid, slot); if (r.moved) changed({ kind: 'yard', uid }, true); return r; },
    store(uid) { const r = store(d, uid); if (r) changed({ kind: 'yard', uid }, true); return r; },
    rotate(uid, steps) { const r = rotate(d, uid, steps); if (r !== null) changed({ kind: 'yard', uid }, true); return r; },
    restyle(uid) { const r = restyle(d, uid); if (r !== null) changed({ kind: 'yard', uid }, true); return r; },
    onChange(fn) { fns.add(fn); return () => fns.delete(fn); },
    devCoins(n) { d.coins = Math.max(0, Math.min(COIN_MAX, d.coins + Math.floor(n))); changed({ kind: 'dev' }); },
    devReset() { Object.assign(d, emptyWallet()); changed({ kind: 'dev' }, true); },
  };
}
