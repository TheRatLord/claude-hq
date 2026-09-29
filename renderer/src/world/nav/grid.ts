// @pure
/**
 * Occupancy grids (§6.6): 0.25 m cells baked from layout walls (walkable openings stay open) and `solid` furniture
 * footprints (rotated rects), one grid per nav level. `inflate(r)` grows blocked cells by an agent radius for planning.
 *
 * Levels (hq): `layout.levels[i]` = `{id, y, open?, block?, queueLane?}`. Without `open` the whole bounds are floor;
 * with it only those rects are (the mezzanine). `block` adds rects / circles / segments (stairs underside, slide helix,
 * stair rail). Walls count on a level when they span its body band (floor + 0.1 … + 1.4); an opening is walkable when
 * it covers floor … floor + 1.5 (doors, arches, storefronts, lintels). Private doors (`opening.private = bayId`) are
 * open only for `owner === bayId` or `owner === '*'` (the player). The queue lane is solid unless `queue` is set.
 * `cameraWells` (rects / circles) are solid for everyone but the player (review-camera stands and their near field).
 * Proto (no `levels`): one level, doors open, as in M1.
 * Owner: LVL.
 */
import type { KeepClearView, Layout, NavLevel, Rect } from '../layout/schema.ts';

export const CELL = 0.25;
/**
 * [BRN fix m3-r2, cross-owner LVL] The agent-solid near field of an authored view (`layout.keepClearViews`): the first
 * `r` m of its frustum (`pathR[id]` for the nav grid), `half` rad either side of the view axis (the 16:9 review frame's
 * horizontal half-FOV is ≈ 46° at the default 60° vertical FOV; + a body's width at 3 m), plus an optional `disc` round
 * the lens. Views face (−sin yaw, −cos yaw).
 */
export const VIEW_CONE = Object.freeze({ r: 3, half: (52 * Math.PI) / 180, disc: 0.6,
  // [BRN fix m3-r3, cross-owner LVL] (art review m3-r3: a walker 1.5 m off at eBayGlass / 2 m off at pitOverview filled a
  // lower quarter from just outside the 52° cone) a body is ~0.7 m wide: near the lens the SOFT cone widens by the angle
  // a half-body subtends (asin(body / d): +14° at 1.5 m, +7° at 3 m)
  body: 0.35,
  // [BRN fix m3-r3, cross-owner LVL] beyond the hard (pathR) depth, out to softR, the cone is a SOFT nav cost (A* step ×
  // (1 + softK × (softR − d)), string pulling never cuts deeper): walkers take the far side of a corridor that crosses a
  // view (the E-bay corridor at eBayGlass: 2.3 → ≈ 3 m), or a way round when it is cheap, without closing any route
  softR: 3.2, softK: 3,
  pathR: Object.freeze<Record<string, number>>({
  // shallower where the full 3 m would close a circulation route (the directors still keep every stander out of the
  // whole 3 m cone): pitOverview stands by the stairs landing, mezz looks down the hot-desk row, street / eBayGlass look
  // along their lanes (their camera wells cover the lens itself)
  // [BRN fix m3-r3, cross-owner LVL] (art review m3-r3 h22-2: a Clawd crossed eBayGlass 1.5 m off, its back over the lower
  // right; fun review m3-r3 lap-6: moss crossed pitOverview's lower right at 2 m). [BRN carryover m3] a HARD 3 m at
  // eBayGlass / pitOverview closes the E-bay corridor and the stairs foot (the sim gates fail: stalls, no Pit dwell), so
  // the hard depths stay 2 / 2.5 and the SOFT cone (softR) pushes corridor walkers to its far side: measured ≥ 2.6 m
  // off the eBayGlass lens (the corridor's glass edge) and ≥ 3.4 m at pitOverview over 3 min at ×4
  pitOverview: 2.5, mezz: 2.0, eBayGlass: 2.0, street: 1.2,
  // none: these lenses stand in a lane — mezzToPit on the landing → slide rail run, serve on the STAFF mat behind the
  // counter (Ada's beat; the queue is its subject, §9.2)
  mezzToPit: 0, serve: 0,
}) });
/** [BRN fix m3-r3] the stand / seat cone the directors use (no body widening: the Lab's benches are the lab view's subject) */
const STAND_CONE = Object.freeze({ ...VIEW_CONE, body: 0 });
/** Is (x, z) inside view v's near field (VIEW_CONE; `r` = the cone's depth, default VIEW_CONE.r)? `k.body` widens it
 *  near the lens (the walker nav cone passes VIEW_CONE; the default is the directors' stand cone without it) */
export function inViewCone(v: { x: number; z: number; yaw: number }, x: number, z: number, r: number = VIEW_CONE.r, k: { half: number; disc: number; body: number } = STAND_CONE): boolean {
  const dx = x - v.x, dz = z - v.z, d2 = dx * dx + dz * dz;
  if (d2 > r * r) return false;
  if (d2 <= k.disc * k.disc) return true;
  const d = Math.sqrt(d2), half = Math.min(Math.PI, k.half + (k.body ? Math.asin(Math.min(1, k.body / Math.max(d, 1e-6))) : 0));
  return (dx * -Math.sin(v.yaw) + dz * -Math.cos(v.yaw)) > Math.cos(half) * d;
}
const WALKABLE_OPENINGS = new Set<string>(['door', 'arch', 'storefront', 'entrance', 'opening', 'lintel']);

export interface Obstacle { x: number; z: number; r: number; level?: number }
export interface GridOpts { level?: number; owner?: string | null; queue?: boolean; obstacles?: Obstacle[] }
/** A level's queue lane as a list of rects (one rect or a list of them). */
const isRect = (q: Rect | readonly Rect[]): q is Rect => typeof q[0] === 'number';

export function buildGrid(layout: Layout, cell: number = CELL, opts: GridOpts = {}): Grid {
  const level = opts.level ?? 0, owner = opts.owner ?? null;
  const lvl: NavLevel = layout.levels?.find((l) => l.id === level) ?? { id: level, y: 0 };
  const ly = lvl.y ?? 0;
  const b = layout.bounds;
  const pad = 0.5;
  const x0 = b.minX - pad, z0 = b.minZ - pad;
  const cols = Math.ceil((b.maxX - b.minX + 2 * pad) / cell), rows = Math.ceil((b.maxZ - b.minZ + 2 * pad) / cell);
  const occ = new Uint8Array(cols * rows);
  const idx = (c: number, r: number) => r * cols + c;
  const cx = (c: number) => x0 + (c + 0.5) * cell, cz = (r: number) => z0 + (r + 0.5) * cell;
  const inAny = (rects: readonly Rect[], x: number, z: number) => rects.some(([ax, az, bx, bz]) => x >= ax && x <= bx && z >= az && z <= bz);
  // outside the bounds (or outside the level's open rects) is solid
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = cx(c), z = cz(r);
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ || (lvl.open && !inAny(lvl.open, x, z))) occ[idx(c, r)] = 1;
  }
  const fillRect = (px: number, pz: number, hw: number, hd: number, yaw: number, slack = 0) => {
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const ex = Math.abs(cs) * hw + Math.abs(sn) * hd + slack, ez = Math.abs(sn) * hw + Math.abs(cs) * hd + slack;
    const c0 = Math.max(0, Math.floor((px - ex - x0) / cell)), c1 = Math.min(cols - 1, Math.floor((px + ex - x0) / cell));
    const r0 = Math.max(0, Math.floor((pz - ez - z0) / cell)), r1 = Math.min(rows - 1, Math.floor((pz + ez - z0) / cell));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const dx = cx(c) - px, dz = cz(r) - pz;
      // into the rect's local frame (yaw rotates +x toward −z, three's rotation.y)
      const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
      if (Math.abs(lx) <= hw + slack && Math.abs(lz) <= hd + slack) occ[idx(c, r)] = 1;
    }
  };
  const fillCircle = (px: number, pz: number, rad: number) => {
    const c0 = Math.max(0, Math.floor((px - rad - x0) / cell)), c1 = Math.min(cols - 1, Math.floor((px + rad - x0) / cell));
    const r0 = Math.max(0, Math.floor((pz - rad - z0) / cell)), r1 = Math.min(rows - 1, Math.floor((pz + rad - z0) / cell));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if ((cx(c) - px) ** 2 + (cz(r) - pz) ** 2 <= rad * rad) occ[idx(c, r)] = 1;
  };
  const fillSeg = (ax: number, az: number, bx: number, bz: number, t: number, gaps: { at: number; w: number }[] = [], slack = cell * 0.5) => {
    const len = Math.hypot(bx - ax, bz - az) || 1e-6;
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    for (let s = 0; s <= len + 1e-6; s += cell * 0.5) {
      if (gaps.some((o) => s > o.at && s < o.at + o.w)) continue;
      fillRect(ax + ux * s, az + uz * s, t, t, 0, slack);
    }
  };
  const laneRects: readonly Rect[] = lvl.queueLane ? (isRect(lvl.queueLane) ? [lvl.queueLane] : lvl.queueLane) : [];
  // (a slot's own footing is never coned: a seat / stand the cone reaches stays a place — the directors decide who uses it)
  const lvlSlots = (layout.slots ?? []).filter((q) => (q.level ?? 0) === level);
  const onSlot = (x: number, z: number) => lvlSlots.some((q) => (q.pos.x - x) ** 2 + (q.pos.z - z) ** 2 < 0.25 * 0.25);
  const fillViewCone = (v: KeepClearView) => { // [BRN fix m3-r2, cross-owner LVL] see the keepClearViews pass below
    const R = v.coneR ?? VIEW_CONE.pathR[v.id] ?? VIEW_CONE.r;
    if (!(R > 0)) return;
    const c0 = Math.max(0, Math.floor((v.x - R - x0) / cell)), c1 = Math.min(cols - 1, Math.floor((v.x + R - x0) / cell));
    const r0 = Math.max(0, Math.floor((v.z - R - z0) / cell)), r1 = Math.min(rows - 1, Math.floor((v.z + R - z0) / cell));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const x = cx(c), z = cz(r);
      if (inViewCone(v, x, z, R) && !inAny(laneRects, x, z) && !onSlot(x, z)) occ[idx(c, r)] = 1; // (hard: no body widening — it would close station step-ins, e.g. a Lab bench)
    }
  };
  for (const w of layout.walls ?? []) {
    const wy0 = w.y0 ?? 0, wy1 = wy0 + w.h;
    if (wy1 < ly + 0.1 || wy0 > ly + 1.4) continue; // not in this level's body band
    const gaps = (w.openings ?? []).filter((o) => {
      if (!WALKABLE_OPENINGS.has(o.kind)) return false;
      const s0 = wy0 + (o.sill ?? 0), s1 = s0 + o.h;
      if (s0 > ly + 0.05 || s1 < ly + 1.5) return false;
      return !o.private || owner === '*' || owner === o.private;
    });
    // [LVL fix m2 r1] a balustrade (`rail`) is rasterized without the half-cell slack: it runs along its level's open-rect
    // edge, which already blocks the far side, so the player's circle reaches the glass (≈ 0.29 m from the rail line, was
    // 0.53) and the cap drops out of the overlook frame (layout.test: 'rail overlook'; every rail sits on an open edge)
    fillSeg(w.a[0], w.a[1], w.b[0], w.b[1], (w.t ?? 0.2) / 2, gaps, w.kind === 'rail' && lvl.open ? 0 : cell * 0.5);
  }
  for (const f of layout.furniture ?? []) {
    if (!f.solid || (f.level ?? 0) !== level) continue;
    fillRect(f.pos.x, f.pos.z, f.size[0] / 2, f.size[2] / 2, f.yaw ?? 0);
  }
  for (const k of lvl.block ?? []) {
    if ('rect' in k) { const [ax, az, bx, bz] = k.rect; fillRect((ax + bx) / 2, (az + bz) / 2, (bx - ax) / 2, (bz - az) / 2, 0); }
    if ('circle' in k) fillCircle(k.circle[0], k.circle[1], k.circle[2]);
    if ('seg' in k) fillSeg(k.seg[0], k.seg[1], k.seg[2], k.seg[3], 0.05);
  }
  // [LVL fix m2 r1] camera wells: the stand + near field of a §9.2 review camera, solid for agents (walkers route round,
  // no wander point / stander lands there) but open floor for the player (owner '*'), who stands in them for the shot
  if (owner !== '*') for (const k of lvl.cameraWells ?? []) {
    if ('rect' in k) { const [ax, az, bx, bz] = k.rect; fillRect((ax + bx) / 2, (az + bz) / 2, (bx - ax) / 2, (bz - az) / 2, 0); }
    if ('circle' in k) fillCircle(k.circle[0], k.circle[1], k.circle[2]);
  }
  // [BRN fix m3-r2, cross-owner LVL] keep-clear view cones (art review m3-r2: at pitOverview / mezz a Clawd filled a frame
  // corner from < 2 m): the first VIEW_CONE.pathR (default 3) m of every authored view's frustum (`layout.keepClearViews`,
  // §9.2 poses) is solid for agents like a camera well — no walker paths through it — and open for the player.
  // The queue lane is left to its own rule (the serve view's subject is the queue head, 2.2 m off, §9.2 table).
  if (owner !== '*' && layout.levels) for (const v of layout.keepClearViews ?? []) if ((v.level ?? 0) === level) fillViewCone(v); // (hq only: the proto room is 12 × 9 m)
  // [BRN fix m3-r3, cross-owner LVL] the soft cone (VIEW_CONE.softR / softK): a per-cell extra step cost, max over views
  let cost: Float32Array | null = null;
  if (owner !== '*' && layout.levels) for (const v of layout.keepClearViews ?? []) {
    if ((v.level ?? 0) !== level) continue;
    const R = VIEW_CONE.softR;
    if (!((v.coneR ?? VIEW_CONE.pathR[v.id] ?? VIEW_CONE.r) > 0)) continue; // (a lens in a lane: no cone at all)
    const c0 = Math.max(0, Math.floor((v.x - R - x0) / cell)), c1 = Math.min(cols - 1, Math.floor((v.x + R - x0) / cell));
    const r0 = Math.max(0, Math.floor((v.z - R - z0) / cell)), r1 = Math.min(rows - 1, Math.floor((v.z + R - z0) / cell));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const x = cx(c), z = cz(r), d = Math.hypot(x - v.x, z - v.z);
      if (d >= R || !inViewCone(v, x, z, R, VIEW_CONE) || inAny(laneRects, x, z)) continue;
      cost ??= new Float32Array(cols * rows);
      const k = VIEW_CONE.softK * (R - d);
      if (k > cost[idx(c, r)]) cost[idx(c, r)] = k;
    }
  }
  if (lvl.queueLane && !opts.queue) {
    // one rect [x0, z0, x1, z1] or a list of them ([LVL fix r2] the hq lane is an L of two rects)
    for (const [ax, az, bx, bz] of laneRects) fillRect((ax + bx) / 2, (az + bz) / 2, (bx - ax) / 2, (bz - az) / 2, 0);
  }
  for (const o of opts.obstacles ?? []) if ((o.level ?? 0) === level) fillCircle(o.x, o.z, o.r);
  return makeGrid({ cols, rows, x0, z0, cell, occ, level, cost });
}

/** `cost`: [BRN fix m3-r3] optional per-cell extra step cost (the soft view cones; astar.ts, pull.ts). */
export interface GridData { cols: number; rows: number; x0: number; z0: number; cell: number; occ: Uint8Array; level?: number; cost?: Float32Array | null }
export interface Grid extends GridData {
  col: (x: number) => number;
  row: (z: number) => number;
  inside: (c: number, r: number) => boolean;
  blockedCR: (c: number, r: number) => boolean;
  blocked: (x: number, z: number) => boolean;
  center: (c: number, r: number) => { x: number; z: number };
  /** Grid grown by radius r (m). */
  inflate: (r: number) => Grid;
  /** ASCII dump (debug / walktimes --ascii). */
  ascii: () => string;
}
export function makeGrid(g: GridData): Grid {
  const { cols, rows, x0, z0, cell, occ } = g;
  const col = (x: number) => Math.floor((x - x0) / cell), row = (z: number) => Math.floor((z - z0) / cell);
  const inside = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows;
  const blockedCR = (c: number, r: number) => !inside(c, r) || occ[r * cols + c] === 1;
  return {
    ...g,
    col, row, inside, blockedCR,
    blocked: (x: number, z: number) => blockedCR(col(x), row(z)),
    center: (c: number, r: number) => ({ x: x0 + (c + 0.5) * cell, z: z0 + (r + 0.5) * cell }),
    /** Grid grown by radius r (m). */
    inflate(r: number): Grid {
      const n = Math.ceil(r / cell - 1e-6);
      const out = new Uint8Array(occ.length);
      for (let rr = 0; rr < rows; rr++) for (let c = 0; c < cols; c++) {
        if (!occ[rr * cols + c]) continue;
        for (let dr = -n; dr <= n; dr++) for (let dc = -n; dc <= n; dc++) {
          if (dc * dc + dr * dr > (n + 0.5) ** 2) continue;
          const c2 = c + dc, r2 = rr + dr;
          if (inside(c2, r2)) out[r2 * cols + c2] = 1;
        }
      }
      return makeGrid({ cols, rows, x0, z0, cell, occ: out, level: g.level, cost: g.cost ?? null });
    },
    /** ASCII dump (debug / walktimes --ascii). */
    ascii(): string {
      let s = '';
      for (let r = 0; r < rows; r++) { for (let c = 0; c < cols; c++) s += occ[r * cols + c] ? '#' : '.'; s += '\n'; }
      return s;
    },
  };
}
