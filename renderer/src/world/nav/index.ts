// @pure
/**
 * Navigation facade (§6.6): per-level occupancy grids → octile A* on the radius-inflated grid → string pulling;
 * portals between levels (stairs two-way, slide one-way); private back doors (owners + player only); the queue lane
 * (queue members only); slot reservations; a circle-vs-grid collider for the player.
 *
 * Route points carry `level`; the points of a portal hop carry `portal` ('stairs' | 'slide'): walk the stairs points
 * straight (the ramp is `layout.floorY`), ride `layout.slide.path` into a `portal: 'slide'` point.
 * Owner: LVL.
 */
import { buildGrid, CELL } from './grid.ts';
import type { Grid } from './grid.ts';
import type { Layout, Slot } from '../layout/schema.ts';
import { astar } from './astar.ts';
import { pull, freeLine } from './pull.ts';
import { createReservations } from './reservations.ts';
import { hops, polyLen } from './portals.ts';

export const AGENT_RADIUS = 0.28;

export interface NavPoint { x: number; z: number; level?: number; portal?: string }
/** `owner`: bay id whose private door opens ('*' = all: player). */
export interface NavOpts { owner?: string | null; queue?: boolean }
export interface Route { points: NavPoint[]; length: number; portals: string[] }
export interface NavBudgetStats { searches: number; pending: number; cache: number; hits: number; misses: number }
export interface NavGrids { raw: Grid; inflated: Grid }
export interface Nav {
  /** polyline incl. both ends; null = unreachable */
  path: (from: NavPoint, to: NavPoint, opts?: NavOpts) => NavPoint[] | null;
  /** path + length (m, portal hops at their `len`) + portals used (unbudgeted: tools, tests, one-off queries) */
  route: (from: NavPoint, to: NavPoint, opts?: NavOpts) => Route | null;
  /**
   * The per-frame budgeted route (§5.3 "A* ≤ 2 searches/frame (queued)"): `undefined` = PENDING, this frame's grid
   * searches are spent; ask again next frame (the walker waits in place). Line-of-sight legs and cached legs cost
   * nothing, so only fresh searches queue.
   */
  tryRoute: (from: NavPoint, to: NavPoint, opts?: NavOpts) => Route | null | undefined;
  /** start a frame: resets the search budget (call once per frame, before the brains) */
  frame: () => void;
  /** take one search from this frame's budget for a caller's own grid search (false = spent: ask again next frame) */
  spendSearch: () => boolean;
  budgetStats: () => NavBudgetStats;
  /** raw occupancy (not inflated) */
  walkable: (x: number, z: number, level?: number, opts?: NavOpts) => boolean;
  reserve: (tag: string, actorId: string, near?: NavPoint) => Slot | null;
  release: (slotId: string) => void;
  releaseAll: (actorId: string) => void;
  holder: (slotId: string) => string | null;
  /** player circle vs occupancy (§6.10; private doors open, queue lane closed) */
  collides: (x: number, z: number, r: number, level?: number) => boolean;
  /** floor under feet at y (level switch) */
  surface: (x: number, z: number, y: number) => { y: number; level: number };
  gridFor: (level?: number, opts?: NavOpts) => NavGrids;
  /** level-0 raw grid (M1 compatibility) */
  grid: Grid;
  /** level-0 inflated grid */
  inflated: Grid;
}

/**
 * `o.obstacles`: static obstacles (tests: a full queue); `o.searchesPerFrame` = the tryRoute budget (default 2, §5.3).
 */
export function createNav(layout: Layout, o: { obstacles?: { x: number; z: number; r: number; level?: number }[]; searchesPerFrame?: number } = {}): Nav {
  const grids = new Map<string, NavGrids>();
  const gridFor = (level = 0, opts: NavOpts = {}): NavGrids => {
    const key = `${level}|${opts.owner ?? ''}|${opts.queue ? 1 : 0}`;
    let g = grids.get(key);
    if (!g) {
      const raw = buildGrid(layout, CELL, { level, owner: opts.owner ?? null, queue: !!opts.queue, obstacles: o.obstacles });
      g = { raw, inflated: raw.inflate(AGENT_RADIUS - 0.05) };
      grids.set(key, g);
    }
    return g;
  };
  const base = gridFor(0);
  const res = createReservations(layout.slots ?? []);
  /** leg cache, LRU ([LVL fix r1]: was cleared wholesale at 2048 entries, so a busy office re-searched everything) */
  const cache = new Map<string, NavPoint[] | null>();
  const CACHE_MAX = 2048;
  const portals = layout.portals ?? [];
  /** per-frame search budget (§5.3): `limited` only inside tryRoute */
  const PER_FRAME = o.searchesPerFrame ?? 2;
  const PENDING = Symbol('pending');
  const bud = { used: 0, limited: false, pending: 0, hits: 0, misses: 0, total: 0 };

  /** Nearest free cell of an inflated grid (spiral search), for starts/goals inside a footprint (e.g. a seat). */
  const freeCell = (inf: Grid, x: number, z: number): [number, number] | null => {
    const c = inf.col(x), r = inf.row(z);
    if (!inf.blockedCR(c, r)) return [c, r];
    for (let k = 1; k < 12; k++) {
      let best: [number, number] | null = null, bd = Infinity;
      for (let dr = -k; dr <= k; dr++) for (let dc = -k; dc <= k; dc++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== k || inf.blockedCR(c + dc, r + dr)) continue;
        const p = inf.center(c + dc, r + dr); const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d < bd) { bd = d; best = [c + dc, r + dr]; }
      }
      if (best) return best;
    }
    return null;
  };

  /** Same-level leg (cached). */
  const leg = (level: number, from: NavPoint, to: NavPoint, opts: NavOpts): NavPoint[] | null | typeof PENDING => {
    const inf = gridFor(level, opts).inflated;
    const L = (p: { x: number; z: number }): NavPoint => ({ x: p.x, z: p.z, level });
    if (freeLine(inf, from.x, from.z, to.x, to.z)) return [L(from), L(to)]; // ([BRN fix m3-r3, cross-owner] soft cones)
    const key = `${level}|${opts.owner ?? ''}|${opts.queue ? 1 : 0}|${from.x.toFixed(1)},${from.z.toFixed(1)}>${to.x.toFixed(1)},${to.z.toFixed(1)}`;
    let hit = cache.get(key);
    if (hit !== undefined) { cache.delete(key); cache.set(key, hit); bud.hits++; } // LRU: refresh
    if (hit === undefined) {
      if (bud.limited && bud.used >= PER_FRAME) return PENDING;
      bud.used++; bud.misses++; bud.total++;
      hit = null;
      const s = freeCell(inf, from.x, from.z), g = freeCell(inf, to.x, to.z);
      if (s && g) {
        const cells = astar(inf, s[0], s[1], g[0], g[1]);
        if (cells) {
          const pts = cells.map((i) => inf.center(i % inf.cols, (i / inf.cols) | 0));
          pts[0] = { x: from.x, z: from.z }; pts[pts.length - 1] = { x: to.x, z: to.z };
          hit = pull(inf, pts).map((p) => ({ x: p.x, z: p.z }));
        }
      }
      cache.set(key, hit);
      if (cache.size > CACHE_MAX) { const oldest = cache.keys().next(); if (!oldest.done) cache.delete(oldest.value); } // evict the least recently used
    }
    return hit && [L(from), ...hit.slice(1, -1).map(L), L(to)];
  };

  const route = (from: NavPoint, to: NavPoint, opts: NavOpts = {}): Route | null | typeof PENDING => {
    const lf = from.level ?? 0, lt = to.level ?? 0;
    let best: Route | null = null;
    let pending = false;
    if (lf === lt) {
      const p = leg(lf, from, to, opts);
      if (p === PENDING) pending = true;
      else if (p) best = { points: p, length: polyLen(p), portals: [] };
    }
    for (const h of hops(portals, lf, lt)) {
      const p1 = leg(lf, from, h.enter, opts);
      if (p1 === PENDING) { pending = true; continue; }
      if (!p1) continue;
      const p2 = leg(lt, h.exit, to, opts);
      if (p2 === PENDING) { pending = true; continue; }
      if (!p2) continue;
      const length = polyLen(p1) + h.portal.len + polyLen(p2);
      if (best && length >= best.length) continue;
      const id = h.portal.id;
      // stairs: walk the centreline (levels flip at the ramp's mid-height); slide: one hop into the exit
      const mid = id === 'stairs'
        ? h.path.slice(1, -1).map((q) => ({ x: q.x, z: q.z, level: q.y > (layout.levels?.[1]?.y ?? 2.9) / 2 ? 1 : 0, portal: id }))
        : [];
      best = { points: [...p1, ...mid, { x: h.exit.x, z: h.exit.z, level: lt, portal: id }, ...p2.slice(1)], length, portals: [id] };
    }
    return pending ? PENDING : best; // a half-searched route is never returned: the rest comes from the cache next frame
  };

  const player: NavOpts = { owner: '*' };
  return {
    grid: base.raw, inflated: base.inflated, gridFor,
    route(from, to, opts) { const r = route(from, to, opts); return r === PENDING ? null : r; },
    tryRoute(from, to, opts) {
      bud.limited = true;
      try {
        const r = route(from, to, opts);
        if (r === PENDING) { bud.pending++; return undefined; }
        return r;
      } finally { bud.limited = false; }
    },
    frame() { bud.used = 0; bud.pending = 0; },
    // [BRN fix r2, cross-owner] one search from this frame's §5.3 budget for a caller's own A* on a derived grid (the
    // director's route around the player): false = spent this frame, ask again next frame
    spendSearch() { if (bud.used >= PER_FRAME) { bud.pending++; return false; } bud.used++; bud.misses++; bud.total++; return true; },
    budgetStats: () => ({ searches: bud.used, pending: bud.pending, cache: cache.size, hits: bud.hits, misses: bud.misses }),
    path(from, to, opts) { const r = route(from, to, opts); return r && r !== PENDING ? r.points.map((p) => ({ ...p })) : null; },
    walkable: (x, z, level = 0, opts = {}) => !gridFor(level, opts).raw.blocked(x, z),
    collides(x, z, r, level = 0) {
      const g = gridFor(level, player).raw;
      for (let a = 0; a < 8; a++) {
        const t = (a / 8) * Math.PI * 2;
        if (g.blocked(x + Math.cos(t) * r, z + Math.sin(t) * r)) return true;
      }
      return g.blocked(x, z);
    },
    surface: (x, z, y) => layout.floorAt?.(x, z, y) ?? { y: layout.floorY?.(x, z, 0) ?? 0, level: 0 },
    reserve: res.reserve,
    release: res.release,
    releaseAll: res.releaseAll,
    holder: res.holder,
  };
}
