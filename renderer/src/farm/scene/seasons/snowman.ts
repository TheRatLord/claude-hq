/**
 * Snowmen, pure (no three, no DOM; tested in seasons.test.ts): roll a ball that grows as you push it through the snow,
 * set it down as a base, stack two more on top (each no bigger than the one below), then decorate it a piece at a time
 * (eyes, a carrot nose, a scarf, coal buttons, twig arms, a topper), using a pinecone or a holly sprig from your basket
 * when you have one. At most three snowmen; they last the day and melt with the snow (persisted per profile by
 * seasons.ts as `claude-valley.snowmen.v1`).
 */

export const MAX_SNOWMEN = 3;
/** a fresh snowball's radius, and the biggest one you can still push */
export const BALL_MIN = 0.16, BALL_MAX = 0.78;
/** smaller than this won't do as a base */
export const BASE_MIN = 0.26;

export type DecorPart = 'eyes' | 'nose' | 'scarf' | 'buttons' | 'arms' | 'topper';
export const DECOR_ORDER: readonly DecorPart[] = ['eyes', 'nose', 'scarf', 'buttons', 'arms', 'topper'];
export const SCARVES = ['red', 'blue', 'green'] as const;

export interface Snowman {
  id: number;
  x: number;
  z: number;
  /** facing (model convention: front = (sin, cos)) */
  yaw: number;
  /** ball radii, bottom first (1..3) */
  balls: number[];
  decor: Partial<Record<DecorPart, string>>;
}
export interface SnowData { v: 1; day: string; next: number; list: Snowman[] }
export const emptySnow = (day: string): SnowData => ({ v: 1, day, next: 1, list: [] });

/** Push a ball `dist` metres through lying snow: it grows, more slowly as it gets heavy. */
export function grow(r: number, dist: number): number {
  if (dist <= 0) return r;
  const k = Math.max(0.12, Math.sqrt(Math.max(0, 1 - r / BALL_MAX)));
  return Math.min(BALL_MAX, r + dist * 0.055 * k);
}

/** Heights of each ball's centre above the ground (balls settle into each other a little). */
export function ballHeights(balls: readonly number[], out: number[] = []): number[] {
  out.length = 0;
  let y = 0;
  for (let i = 0; i < balls.length; i++) {
    y = i === 0 ? balls[0] * 0.9 : y + balls[i - 1] * 0.8 + balls[i] * 0.8;
    out.push(y);
  }
  return out;
}
/** total height of a snowman (top of the head) */
export const heightOf = (balls: readonly number[]): number => { const h = ballHeights(balls); return balls.length ? h[h.length - 1] + balls[balls.length - 1] : 0; };

export type PlaceResult =
  | { kind: 'new'; sm: Snowman }
  | { kind: 'stack'; sm: Snowman }
  | { kind: 'too-big'; sm: Snowman }
  | { kind: 'tall'; sm: Snowman }
  | { kind: 'too-small' }
  | { kind: 'full' };

/** the snowman a ball set down at (x, z) with radius r would go onto, if any */
export function nearSnowman(d: SnowData, x: number, z: number, r: number): Snowman | null {
  let best: Snowman | null = null, bd = Infinity;
  for (const s of d.list) {
    const dd = Math.hypot(s.x - x, s.z - z);
    if (dd < s.balls[0] + r + 0.9 && dd < bd) { bd = dd; best = s; }
  }
  return best;
}

/** Set a rolled ball down at (x, z): onto a snowman nearby (if it fits) or as a new snowman's base. Mutates `d`. */
export function placeBall(d: SnowData, x: number, z: number, r: number, yaw: number): PlaceResult {
  const near = nearSnowman(d, x, z, r);
  if (near) {
    if (near.balls.length >= 3) return { kind: 'tall', sm: near };
    const top = near.balls[near.balls.length - 1];
    if (r > top * 1.08) return { kind: 'too-big', sm: near };
    near.balls.push(Math.max(BALL_MIN, r));
    return { kind: 'stack', sm: near };
  }
  if (d.list.length >= MAX_SNOWMEN) return { kind: 'full' };
  if (r < BASE_MIN) return { kind: 'too-small' };
  const sm: Snowman = { id: d.next++, x, z, yaw, balls: [r], decor: {} };
  d.list.push(sm);
  return { kind: 'new', sm };
}

export interface DecorStep { part: DecorPart; value: string; /** a basket item it uses up */ take: string | null }
/** What decorating adds next (null: not three balls yet, or already dressed). `has` asks the basket. */
export function nextDecor(sm: Snowman, has: (item: string) => boolean): DecorStep | null {
  if (sm.balls.length < 3) return null;
  const part = DECOR_ORDER.find((p) => !sm.decor[p]);
  if (!part) return null;
  switch (part) {
    case 'eyes': return has('pinecone') ? { part, value: 'pinecone', take: 'pinecone' } : { part, value: 'coal', take: null };
    case 'nose': return { part, value: 'carrot', take: null };
    case 'scarf': return { part, value: SCARVES[sm.id % SCARVES.length], take: null };
    case 'buttons': return { part, value: 'coal', take: null };
    case 'arms': return { part, value: 'twig', take: null };
    case 'topper': return has('holly') ? { part, value: 'holly', take: 'holly' } : { part, value: 'hat', take: null };
  }
}
export function decorate(sm: Snowman, step: DecorStep): void { sm.decor[step.part] = step.value; }

/** A proper snow friend: three balls, eyes and a nose. */
export const isFriend = (sm: Snowman): boolean => sm.balls.length === 3 && !!sm.decor.eyes && !!sm.decor.nose;

/** Clear everything if it's another day or the snow has gone. Returns true if it changed. */
export function settle(d: SnowData, day: string, snowLying: boolean): boolean {
  if (d.day !== day) { d.day = day; d.list = []; return true; }
  if (!snowLying && d.list.length) { d.list = []; return true; }
  return false;
}

const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const PART_VALUES: Readonly<Record<DecorPart, readonly string[]>> = {
  eyes: ['coal', 'pinecone'], nose: ['carrot'], scarf: SCARVES, buttons: ['coal'], arms: ['twig'], topper: ['holly', 'hat'],
};

/** Tolerant parse: anything malformed is dropped; another day's snowmen are gone. */
export function parseSnow(raw: unknown, day: string): SnowData {
  const d = emptySnow(day);
  if (!raw || typeof raw !== 'object') return d;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1 || o.day !== day || !Array.isArray(o.list)) return d;
  for (const s of o.list.slice(0, MAX_SNOWMEN)) {
    if (!s || typeof s !== 'object') continue;
    const r = s as Record<string, unknown>;
    const id = num(r.id, 1, 1e9), x = num(r.x, -500, 500), z = num(r.z, -500, 500), yaw = num(r.yaw, -10, 10);
    if (id === null || x === null || z === null || yaw === null || !Array.isArray(r.balls)) continue;
    const balls = r.balls.map((b) => num(b, BALL_MIN * 0.5, BALL_MAX)).filter((b): b is number => b !== null).slice(0, 3);
    if (!balls.length) continue;
    const decor: Snowman['decor'] = {};
    if (r.decor && typeof r.decor === 'object') {
      for (const p of DECOR_ORDER) { const v = (r.decor as Record<string, unknown>)[p]; if (typeof v === 'string' && PART_VALUES[p].includes(v)) decor[p] = v; }
    }
    d.list.push({ id: Math.floor(id), x, z, yaw, balls, decor });
  }
  d.next = Math.max(1, num(o.next, 1, 1e9) ?? 1, ...d.list.map((s) => s.id + 1));
  return d;
}
