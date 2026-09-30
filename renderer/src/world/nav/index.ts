// @pure
/**
 * Static navigation: per-level occupancy grids, radius-inflated octile A*, string pulling,
 * direct connections between levels, slot reservations, and circle-vs-grid collision.
 * Geometry and extra obstacles are baked lazily and cached; create a new instance after changing them.
 * Routes support one portal per query, not arbitrary multi-hop level graphs.
 */
import { buildGrid, CELL } from './grid.ts';
import type { Grid, Obstacle } from './grid.ts';
import type { Layout, Slot } from '../layout/schema.ts';
import { astar } from './astar.ts';
import { pull, freeLine } from './pull.ts';
import { createReservations } from './reservations.ts';
import { hops, polyLen } from './portals.ts';

export const AGENT_RADIUS = 0.28;

export interface NavPoint { x: number; z: number; level?: number; portal?: string }
export interface Route { points: NavPoint[]; length: number; portals: string[] }
export interface NavBudgetStats { searches: number; pending: number; cache: number; hits: number; misses: number }
export interface NavGrids { raw: Grid; inflated: Grid }
export interface Nav {
  /** polyline incl. both ends; null = unreachable */
  path: (from: NavPoint, to: NavPoint) => NavPoint[] | null;
  /** Path, distance (portal traversal uses `len`), and portal ids; unbudgeted. */
  route: (from: NavPoint, to: NavPoint) => Route | null;
  /**
   * `undefined` means pending: this frame's grid searches are spent; ask again after `frame()`.
   * Line-of-sight and cached legs do not spend searches.
   */
  tryRoute: (from: NavPoint, to: NavPoint) => Route | null | undefined;
  /** Reset the search budget once before each batch of budgeted queries. */
  frame: () => void;
  /** take one search from this frame's budget for a caller's own grid search (false = spent: ask again next frame) */
  spendSearch: () => boolean;
  budgetStats: () => NavBudgetStats;
  /** raw occupancy (not inflated) */
  walkable: (x: number, z: number, level?: number) => boolean;
  reserve: (tag: string, actorId: string, near?: NavPoint) => Slot | null;
  release: (slotId: string) => void;
  releaseAll: (actorId: string) => void;
  holder: (slotId: string) => string | null;
  /** Circle against raw occupancy, sampled at its centre and eight perimeter points. */
  collides: (x: number, z: number, r: number, level?: number) => boolean;
  gridFor: (level?: number) => NavGrids;
  /** Level-0 raw grid. */
  grid: Grid;
  /** level-0 inflated grid */
  inflated: Grid;
}

/**
 * Extra obstacles are static circles. `searchesPerFrame` sets the `tryRoute` search budget (default 2).
 */
export function createNav(layout: Layout, o: { obstacles?: readonly Obstacle[]; searchesPerFrame?: number } = {}): Nav {
  const grids = new Map<number, NavGrids>();
  const gridFor = (level = 0): NavGrids => {
    let g = grids.get(level);
    if (!g) {
      const raw = buildGrid(layout, CELL, { level, obstacles: o.obstacles });
      g = { raw, inflated: raw.inflate(AGENT_RADIUS - 0.05) };
      grids.set(level, g);
    }
    return g;
  };
  const base = gridFor(0);
  const res = createReservations(layout.slots ?? []);
  /** Least-recently-used cache of same-level legs. */
  const cache = new Map<string, NavPoint[] | null>();
  const CACHE_MAX = 2048;
  const portals = layout.portals ?? [];
  /** Search budget applies only inside `tryRoute`. */
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
  const leg = (level: number, from: NavPoint, to: NavPoint): NavPoint[] | null | typeof PENDING => {
    const inf = gridFor(level).inflated;
    const L = (p: { x: number; z: number }): NavPoint => ({ x: p.x, z: p.z, level });
    if (freeLine(inf, from.x, from.z, to.x, to.z)) return [L(from), L(to)];
    const key = `${level}|${from.x.toFixed(1)},${from.z.toFixed(1)}>${to.x.toFixed(1)},${to.z.toFixed(1)}`;
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

  const route = (from: NavPoint, to: NavPoint): Route | null | typeof PENDING => {
    const lf = from.level ?? 0, lt = to.level ?? 0;
    let best: Route | null = null;
    let pending = false;
    if (lf === lt) {
      const p = leg(lf, from, to);
      if (p === PENDING) pending = true;
      else if (p) best = { points: p, length: polyLen(p), portals: [] };
    }
    for (const h of hops(portals, lf, lt)) {
      const p1 = leg(lf, from, h.enter);
      if (p1 === PENDING) { pending = true; continue; }
      if (!p1) continue;
      const p2 = leg(lt, h.exit, to);
      if (p2 === PENDING) { pending = true; continue; }
      if (!p2) continue;
      const length = polyLen(p1) + h.portal.len + polyLen(p2);
      if (best && length >= best.length) continue;
      const id = h.portal.id;
      // Interior centreline points remain on the entry level; the exit changes to the target level.
      const mid = h.path.slice(1, -1).map((q) => ({ x: q.x, z: q.z, level: lf, portal: id }));
      best = { points: [...p1, ...mid, { x: h.exit.x, z: h.exit.z, level: lt, portal: id }, ...p2.slice(1)], length, portals: [id] };
    }
    return pending ? PENDING : best; // a half-searched route is never returned: the rest comes from the cache next frame
  };

  return {
    grid: base.raw, inflated: base.inflated, gridFor,
    route(from, to) { const r = route(from, to); return r === PENDING ? null : r; },
    tryRoute(from, to) {
      bud.limited = true;
      try {
        const r = route(from, to);
        if (r === PENDING) { bud.pending++; return undefined; }
        return r;
      } finally { bud.limited = false; }
    },
    frame() { bud.used = 0; bud.pending = 0; },
    // External searches can share the same per-batch budget.
    spendSearch() { if (bud.used >= PER_FRAME) { bud.pending++; return false; } bud.used++; bud.misses++; bud.total++; return true; },
    budgetStats: () => ({ searches: bud.used, pending: bud.pending, cache: cache.size, hits: bud.hits, misses: bud.misses }),
    path(from, to) { const r = route(from, to); return r && r !== PENDING ? r.points.map((p) => ({ ...p })) : null; },
    walkable: (x, z, level = 0) => !gridFor(level).raw.blocked(x, z),
    collides(x, z, r, level = 0) {
      const g = gridFor(level).raw;
      for (let a = 0; a < 8; a++) {
        const t = (a / 8) * Math.PI * 2;
        if (g.blocked(x + Math.cos(t) * r, z + Math.sin(t) * r)) return true;
      }
      return g.blocked(x, z);
    },
    reserve: res.reserve,
    release: res.release,
    releaseAll: res.releaseAll,
    holder: res.holder,
  };
}
