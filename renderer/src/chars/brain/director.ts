// @pure
/**
 * Director (DESIGN §6.4): the one global allocator. The full office (a layout with `bays`) is `directorHq.ts`; this
 * file is the proto room (§7.1 D7) and the shared helpers:
 * - **desks**: pod = `workspace.slot mod pods`, then the first free desk of that pod starting at a per-pane offset,
 *   else the first free desk anywhere. Sticky: an actor keeps a desk in its own pod while it lives, so churn never
 *   reshuffles the room; a fresh renderer (second window, reload) computes the same result from the same entity set.
 * - **pins** (a pure function of entities + now, identical in every window): the help queue for agents blocked
 *   ≥ `blockedChairMs`, ordered by `(statusSince, id)`; sofa seats for unacked done agents, same order.
 * - **spots**: casual claims (chill picks) on the remaining sofa seats, window spots and amenity slots; a pin always
 *   evicts a casual claim.
 * - **wander points**: walkable floor points (unknown ghosts, strolls).
 * - **keep-clear zones**: nothing the director hands out (overflow homes, lounge stand spots, wander points) lies
 *   within `keepClearR` of an authored viewpoint (`layout.keepClearViews`: spawn + §9.2 cameras), so review frames
 *   never start inside a Clawd.
 * - **overflow**: panes beyond the desks stand along the back wall / around the lounge (never the front aisle);
 *   done agents beyond the sofa seats stand around the lounge rug (`standLounge`), not at their desks.
 * - **routes**: A* on a body-width clearance grid (chairs count as solid, so seated neighbours are walked around),
 *   string-pulled: pod-row exit → aisle → target instead of a straight scurry through desks.
 * Owner: BRN.
 */
import { TUNING, SPOT_ACTIVITY } from './tuning.ts';
import { buildGrid, CELL } from '../../world/nav/grid.ts';
import { astar } from '../../world/nav/astar.ts';
import { pull, lineOfSight } from '../../world/nav/pull.ts';
import { createHqDirector } from './directorHq.ts';
import type { HqDirector, HqMembers } from './directorHq.ts';
import type { Entity } from '../../../../shared/protocol.ts';
import type { Furniture, HqLayout, Layout, Slot } from '../../world/layout/schema.ts';
import type { Grid } from '../../world/nav/grid.ts';
import type { Nav, NavOpts, NavPoint } from '../../world/nav/index.ts';

export interface P2 { x: number; z: number }
/** an axis-aligned footprint (world space) */
export interface Box { x0: number; x1: number; z0: number; z1: number }
/** extra options of `route()` (the office director's level-aware router; the proto room ignores them) */
export interface RouteOpts { actorId?: string; via?: string | null; budget?: boolean }
/** extra options of `routeAround()` */
export interface AroundOpts { actorId?: string; minR?: number }

/**
 * The one global allocator, as the brain and the actors see it. The proto room implements the base members; the
 * full office (`HqDirector`, directorHq.ts) adds the optional ones below (callers check `isHq` / use `?.`).
 */
export interface Director extends Partial<HqMembers> {
  /** once per frame, before actors */
  update(entities: Map<string, Entity>, now: number): void;
  /** room centre (look-back target) */
  center: P2;
  /** yaw that faces the room centre from p */
  faceRoom(p: P2): number;
  /** yaw that faces the player spawn (room centre if none) from p */
  faceSpawn(p: P2): number;
  /** home slot (desk) of an actor */
  slotFor(actorId: string): Slot | null;
  /** queue / sofa seat the status pins this actor to (or null) */
  pinFor(actorId: string): Slot | null;
  /** casual spot (chill pick); null = none free. `maxLen` / `o` are the office director's (roaming cap, pin-safe claim) */
  claim(actorId: string, tag: string, near?: P2 | null, maxLen?: number, o?: { withPin?: boolean }): Slot | null;
  unclaim(actorId: string): void;
  holds(actorId: string, slotId: string): boolean;
  /** spot tags this layout offers for chill picks */
  chillTags: string[];
  /** deterministic in r ∈ [0,1) */
  wanderPoint(r: number, near?: P2 | null, maxD?: number, ghost?: boolean): P2;
  /** open floor with body clearance (walker sidesteps) */
  walkable(x: number, z: number, level?: number, o?: NavOpts, r?: number): boolean;
  /** route keeping clear of a person standing at p; null = no way round; undefined = PENDING (office: budget spent) */
  routeAround(from: NavPoint, to: NavPoint, p: P2, o?: AroundOpts): NavPoint[] | null | undefined;
  /** body-clearance path from → to around furniture and chairs; includes both ends (office: null = PENDING, the frame's A* budget is spent) */
  route(from: NavPoint, to: NavPoint, o?: RouteOpts): NavPoint[] | null;
  rekey(oldId: string, newId: string): void;
  forget(actorId: string): void;
  debug(): Record<string, unknown>;
  /** debug / tests: the overflow + lounge standing spots */
  spots(): { floor: readonly FloorSlot[]; lounge: readonly Slot[]; derived?: readonly Slot[] };
}

/** Narrow to the office director (the members above are all present). */
export const isHqDirector = (d: Director): d is HqDirector => d.isHq === true;

export interface DirectorOptions { keepClear?: (P2 & { level?: number })[]; keepClearR?: number }

/** A layout with bays is the full office (every `HqLayout` field is then present). */
function isHqLayout(l: Layout): l is HqLayout { return !!l.bays?.length; }

export type View = 'clear' | 'keep' | 'any';
/** an overflow standing spot: `view` = how clear its sightline is (the proto room's tiers) */
export type FloorSlot = Slot & { view?: View };
const PIN_HZ = 4;
const KEEP_CLEAR_R = 1.5;
const DESK_TAGS = new Set(['desk']);
const SEAT_TAGS = new Set(['sofa', 'beanbag']);
const FURNITURE_SPOTS: Readonly<Record<string, string>> = {
  plant: 'plant', plants: 'plant', plantSmall: 'plant', coffee: 'coffee', coffeeMachine: 'coffee', cooler: 'coffee',
  arcade: 'arcade', fishtank: 'fish', fishTank: 'fish', bookshelf: 'library', shelf: 'library',
};

const num = (s: string) => { const m = /(\d+)\D*$/.exec(s); return m ? +m[1] : 0; };
const byId = (a: { id: string }, b: { id: string }) => num(a.id) - num(b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const since = (e: Entity) => (typeof e.statusSince === 'number' ? e.statusSince : 0);
const cmpSince = (a: Entity, b: Entity) => since(a) - since(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const canon = (a: Entity, b: Entity) => (a.workspace?.slot ?? 0) - (b.workspace?.slot ?? 0) || (a.tab?.index ?? 0) - (b.tab?.index ?? 0)
  || (a.paneIndex ?? 0) - (b.paneIndex ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Group desk slots into pods: `slot.pod` if the layout provides it, else 3 contiguous groups in id order.
 */
export function podsOf(desks: Slot[]): Slot[][] {
  const sorted = [...desks].sort(byId);
  if (sorted.length && sorted.every((s) => Number.isInteger(s.pod))) {
    const m = new Map<number, Slot[]>();
    for (const s of sorted) { const p = s.pod as number; let l = m.get(p); if (!l) m.set(p, (l = [])); l.push(s); }
    return [...m.keys()].sort((a, b) => a - b).map((k) => m.get(k) ?? []);
  }
  const n = Math.min(3, sorted.length) || 1;
  const size = Math.ceil(sorted.length / n);
  const pods: Slot[][] = [];
  for (let i = 0; i < sorted.length; i += size) pods.push(sorted.slice(i, i + size));
  return pods;
}

/**
 * Deterministic desk assignment (pure). `prev` = current id → deskId (sticky; pass an empty map for a fresh window).
 */
export function assignDesks(ents: Entity[], pods: Slot[][], prev: Map<string, string> = new Map()): Map<string, Slot> {
  const P = pods.length;
  const out = new Map<string, Slot>();
  if (!P) return out;
  const taken = new Set<string>();
  const all = pods.flat();
  const podOf = new Map<string, number>();
  pods.forEach((pod, i) => pod.forEach((s) => podOf.set(s.id, i)));
  const sorted = [...ents].sort(canon);
  const prefPod = (e: Entity) => ((e.workspace?.slot ?? 0) % P + P) % P;
  // 1) sticky: keep a previous desk that lies in the entity's own pod.
  for (const e of sorted) {
    const d = prev.get(e.id);
    const s = d && podOf.get(d) === prefPod(e) && !taken.has(d) ? all.find((q) => q.id === d) : undefined;
    if (d && s) { taken.add(d); out.set(e.id, s); }
  }
  // 2) own pod from a per-pane start offset (spreads tabs/panes, so a leaver never shifts its neighbours).
  const rest: Entity[] = [];
  for (const e of sorted) {
    if (out.has(e.id)) continue;
    const pod = pods[prefPod(e)];
    const n = pod.length;
    const start = ((e.tab?.index ?? 0) * 2 + (e.paneIndex ?? 0) + Math.floor((e.workspace?.slot ?? 0) / P) * 2) % n;
    let got: Slot | null = null;
    for (let k = 0; k < n && !got; k++) { const s = pod[(start + k) % n]; if (!taken.has(s.id)) got = s; }
    if (got) { taken.add(got.id); out.set(e.id, got); } else rest.push(e);
  }
  // 3) overflow: keep a previous overflow desk if still free, else the first free desk anywhere.
  for (const e of rest) {
    const d = prev.get(e.id);
    let got = (d && !taken.has(d) ? all.find((s) => s.id === d) : null) ?? null;
    if (!got) got = all.find((s) => !taken.has(s.id)) ?? null;
    if (got) { taken.add(got.id); out.set(e.id, got); }
  }
  return out;
}

/** Inward-facing spot `off` metres in front of the side of a footprint that faces the room centre. */
function frontSpot(f: Furniture, cx: number, cz: number, off: number): { x: number; z: number; yaw: number } {
  const [w, , d] = f.size;
  const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
  let best = { x: 0, z: 0, dd: Infinity };
  for (const [lx, lz] of [[0, d / 2 + off], [0, -d / 2 - off], [w / 2 + off, 0], [-w / 2 - off, 0]]) {
    const x = f.pos.x + lx * c + lz * s, z = f.pos.z - lx * s + lz * c;
    const dd = (x - cx) ** 2 + (z - cz) ** 2;
    if (dd < best.dd) best = { x, z, dd };
  }
  return { x: best.x, z: best.z, yaw: Math.atan2(-(f.pos.x - best.x), -(f.pos.z - best.z)) };
}

/** World-space AABB of a (yaw ≈ k·π/2) footprint, inflated by `pad`. */
const boxOf = (f: Furniture, pad: number): Box => {
  const swap = Math.abs(Math.sin(f.yaw)) > 0.7;
  const hx = (swap ? f.size[2] : f.size[0]) / 2 + pad, hz = (swap ? f.size[0] : f.size[2]) / 2 + pad;
  return { x0: f.pos.x - hx, x1: f.pos.x + hx, z0: f.pos.z - hz, z1: f.pos.z + hz };
};
const inside = (bx: Box, x: number, z: number) => x > bx.x0 && x < bx.x1 && z > bx.z0 && z < bx.z1;
/** Does segment p→q cross the open box? (slab test) */
function segHits(bx: Box, p: P2, q: P2): boolean {
  let t0 = 0, t1 = 1;
  const d = [q.x - p.x, q.z - p.z], o = [p.x, p.z], lo = [bx.x0, bx.z0], hi = [bx.x1, bx.z1];
  for (let i = 0; i < 2; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] <= lo[i] || o[i] >= hi[i]) return false; continue; }
    let a = (lo[i] - o[i]) / d[i], b = (hi[i] - o[i]) / d[i];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 >= t1) return false;
  }
  return t1 - t0 > 1e-4;
}

/**
 * Insert corner waypoints so a polyline never crosses a solid footprint (pure; boxes from `boxOf`).
 */
export function detour(pts: P2[], boxes: Box[]): P2[] {
  const out = [pts[0]];
  const seg = (p: P2, q: P2, depth: number): void => {
    let hit: Box | null = null, hd = Infinity;
    for (const bx of boxes) {
      if (inside(bx, p.x, p.z) || inside(bx, q.x, q.z) || !segHits(bx, p, q)) continue;
      const d = ((bx.x0 + bx.x1) / 2 - p.x) ** 2 + ((bx.z0 + bx.z1) / 2 - p.z) ** 2;
      if (d < hd) { hd = d; hit = bx; }
    }
    if (!hit || depth > 6) { out.push(q); return; }
    const e = 0.02;
    let best: P2 | null = null, bc = Infinity;
    for (const c of [{ x: hit.x0 - e, z: hit.z0 - e }, { x: hit.x1 + e, z: hit.z0 - e }, { x: hit.x0 - e, z: hit.z1 + e }, { x: hit.x1 + e, z: hit.z1 + e }]) {
      if (Math.abs(c.x - p.x) + Math.abs(c.z - p.z) < 1e-3 || segHits(hit, p, c)) continue;
      const cost = Math.hypot(c.x - p.x, c.z - p.z) + Math.hypot(q.x - c.x, q.z - c.z);
      if (cost < bc) { bc = cost; best = c; }
    }
    if (!best) { out.push(q); return; }
    seg(p, best, depth + 1);
    seg(best, q, depth + 1);
  };
  for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i], 0);
  return out;
}

/** Body half-width + margin for route planning (Clawd ≈ 0.6 m across with arms; nav's AGENT_RADIUS is 0.28). */
const ROUTE_CLEARANCE = 0.4;
const TIGHT_CLEARANCE = 0.25;
/** Walkers detour this far around canonical camera spots when the room allows (+ clearance). */
const AVOID_R = 0.8;
/** A person to route around: a ring of stander discs (0.12 m each) ≈ a 0.45 m-radius solid body. */
const AROUND_RING: [number, number][] = [[0, 0], ...Array.from({ length: 8 }, (_, i): [number, number] => [0.33 * Math.cos(i * Math.PI / 4), 0.33 * Math.sin(i * Math.PI / 4)])];
/** Distance from point p to segment ab. */
function segDist(p: P2, a: P2, b: P2): number {
  const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / L2));
  return Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z);
}
/** Overflow / lounge standing spots: min centre spacing (m). A Clawd body is 0.72 m wide, so this leaves a ≥ 0.23 m gap. */
export const FLOOR_PITCH = 0.95;
/** A stander's clear front sightline: nobody else stands within this range (m) inside this half-angle cone of its
 *  facing, so its face reads from a 1.5 m hero camera and from across the room (rows come out staggered). */
/** Most overflow standing spots a room offers. */
const FLOOR_MAX = 64;
const SIGHT = { range: 1.9, cos: Math.cos(36 * Math.PI / 180) };
/** Walking lane kept free behind each chair row (from the seat, m): the pod-row exit toward the aisles. */
const LANE = 1.45;
/** Standers keep this far (m) from the help-queue line (spots, counter, approach tail). */
const QUEUE_CLEAR = 1.1;

/**
 * The layout's authored viewpoints (`layout.keepClearViews`: spawn + §9.2 review cameras), the keep-clear centres;
 * a layout without them keeps its spawn clear. Data only: the brain never reads the debug pose table.
*/
export interface CameraSpot { x: number; z: number; level: number; yaw: number }
export function cameraSpots(layout: Layout): CameraSpot[] {
  if (layout.keepClearViews?.length) return layout.keepClearViews.map((v) => ({ x: v.x, z: v.z, level: v.level ?? 0, yaw: v.yaw ?? 0 }));
  const s = layout.spawn;
  return s ? [{ x: s[0], z: s[2], level: 0, yaw: s[3] ?? 0 }] : [];
}

/**
 * Clearance router (pure): A* over `layout` with chairs made solid, inflated by `clearance`, string-pulled.
 * Starts/goals inside the inflated footprint (a seat's approach point, a queue spot by the counter) snap to the
 * nearest free cell. Returns null when no route exists.
 */
export type Router = (from: P2, to: P2) => P2[] | null;
export function createRouter(layout: Layout, clearance = ROUTE_CLEARANCE, standers: P2[] = [], avoid: P2[] = []): Router {
  const disc = (p: P2, i: number, r: number, tag: string): Furniture => ({ id: `${tag}${i}`, type: tag, pos: { x: p.x, y: 0, z: p.z }, yaw: 0, size: [r * 2, 1, r * 2], solid: true });
  const furniture: Furniture[] = [
    ...(layout.furniture ?? []).map((f) => (f.type === 'chair' ? { ...f, solid: true } : f)),
    // people standing at fixed spots (overflow homes) are walked around, not through
    ...standers.map((p, i) => disc(p, i, 0.12, 'stander')),
  ];
  const base = buildGrid({ ...layout, furniture }, CELL);
  // 1) body-width grid that also steers around the keep-clear zones (canonical cameras) when there is room;
  // 2) body-width grid; 3) tight corners (the sofa nook, a desk by the wall) squeeze through.
  const grids = [
    ...(avoid.length ? [buildGrid({ ...layout, furniture: [...furniture, ...avoid.map((p, i) => disc(p, i, AVOID_R, 'avoid'))] }, CELL).inflate(clearance)] : []),
    base.inflate(clearance),
    base.inflate(Math.min(clearance, TIGHT_CLEARANCE)),
  ];
  const snap = (g: Grid, x: number, z: number): [number, number] | null => {
    const c = g.col(x), r = g.row(z);
    if (!g.blockedCR(c, r)) return [c, r];
    for (let k = 1; k < 10; k++) {
      let best: [number, number] | null = null, bd = Infinity;
      for (let dr = -k; dr <= k; dr++) for (let dc = -k; dc <= k; dc++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== k || g.blockedCR(c + dc, r + dr)) continue;
        const p = g.center(c + dc, r + dr);
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d < bd) { bd = d; best = [c + dc, r + dr]; }
      }
      if (best) return best;
    }
    return null;
  };
  const plan = (g: Grid, from: P2, to: P2): P2[] | null => {
    if (lineOfSight(g, from.x, from.z, to.x, to.z)) return [{ x: from.x, z: from.z }, { x: to.x, z: to.z }];
    const s = snap(g, from.x, from.z), e = snap(g, to.x, to.z);
    const cells = s && e ? astar(g, s[0], s[1], e[0], e[1]) : null;
    if (!cells) return null;
    const mid = pull(g, cells.map((i) => g.center(i % g.cols, (i / g.cols) | 0)));
    let out: P2[] = [{ x: from.x, z: from.z }, ...mid, { x: to.x, z: to.z }];
    // drop near-duplicates (the snapped end cells sit within a cell or two of the real ends)
    out = out.filter((p, i) => i === 0 || i === out.length - 1 || Math.hypot(p.x - out[i - 1].x, p.z - out[i - 1].z) > 0.05);
    // shortcut the snapped first / last cells when the real end already sees the next waypoint
    if (out.length > 2 && lineOfSight(g, from.x, from.z, out[2].x, out[2].z)) out.splice(1, 1);
    const n = out.length;
    if (n > 2 && lineOfSight(g, out[n - 3].x, out[n - 3].z, to.x, to.z)) out.splice(n - 2, 1);
    return out;
  };
  const cache = new Map<string, P2[] | null>();
  return (from, to) => {
    const key = `${from.x.toFixed(2)},${from.z.toFixed(2)}>${to.x.toFixed(2)},${to.z.toFixed(2)}`;
    if (cache.has(key)) return cache.get(key) ?? null;
    let out: P2[] | null = null;
    for (const g of grids) if ((out = plan(g, from, to))) break;
    if (cache.size > 512) cache.clear();
    cache.set(key, out);
    return out;
  };
}

/**
 * `o.keepClear`: keep-clear centres (default: the layout's §9.2 cameras). A layout with bays is the full office
 * (`HqLayout`, directorHq.ts).
 */
export function createDirector(layout: HqLayout, nav: Nav, o?: DirectorOptions): HqDirector;
export function createDirector(layout: Layout, nav: Nav, o?: DirectorOptions): Director;
export function createDirector(layout: Layout, nav: Nav, o: DirectorOptions = {}): Director {
  if (isHqLayout(layout)) return createHqDirector(layout, nav, o); // the full office (M1.5): bays, stations, levels
  const b = layout.bounds;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const slots = layout.slots ?? [];
  const pods = podsOf(slots.filter((s) => DESK_TAGS.has(s.tag)));
  const queue = slots.filter((s) => s.tag === 'queue').sort(byId);
  const seats = slots.filter((s) => SEAT_TAGS.has(s.tag)).sort(byId);
  // The player's spawn (the `proto` review pose): queue actors angle toward it so the blocked silhouette faces the view.
  const sp = layout.points?.spawn ?? (layout.spawn ? { x: layout.spawn[0], z: layout.spawn[2] } : null);
  const spawnPt = sp ? { x: sp.x, z: sp.z } : { x: cx, z: cz };
  const inBounds = (x: number, z: number) => x > b.minX + 0.35 && x < b.maxX - 0.35 && z > b.minZ + 0.35 && z < b.maxZ - 0.35;

  // Casual spots: seats, any other tagged layout slot, window spots from wall openings, furniture fronts.
  const spots: Slot[] = [...seats];
  for (const s of slots) if (!SEAT_TAGS.has(s.tag) && s.tag in SPOT_ACTIVITY) spots.push(s); // never staff mats / queues
  for (const w of layout.walls ?? []) {
    for (const o of w.openings ?? []) {
      if (o.kind !== 'window') continue;
      const dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1];
      const L = Math.hypot(dx, dz) || 1;
      const ux = dx / L, uz = dz / L;
      let nx = -uz, nz = ux; // pick the normal pointing at the room centre
      const mx = w.a[0] + ux * (o.at + o.w / 2), mz = w.a[1] + uz * (o.at + o.w / 2);
      if ((cx - mx) * nx + (cz - mz) * nz < 0) { nx = -nx; nz = -nz; }
      const k = Math.max(1, Math.min(3, Math.floor(o.w / 1.1)));
      for (let i = 0; i < k; i++) {
        const along = (i - (k - 1) / 2) * 1.0;
        const x = mx + ux * along + nx * 0.85, z = mz + uz * along + nz * 0.85;
        if (!inBounds(x, z)) continue;
        spots.push({ id: `spot:window:${spots.length}`, tag: 'window', pos: { x, y: 0, z }, yaw: Math.atan2(nx, nz), pose: 'stand', level: 0 });
      }
    }
  }
  for (const f of layout.furniture ?? []) {
    const tag = FURNITURE_SPOTS[f.type];
    if (!tag) continue;
    const p = frontSpot(f, cx, cz, 0.45);
    if (inBounds(p.x, p.z)) spots.push({ id: `spot:${tag}:${f.id}`, tag, pos: { x: p.x, y: 0, z: p.z }, yaw: p.yaw, pose: 'stand', level: 0, anchor: f.id });
  }
  const chillTags = [...new Set(spots.map((s) => s.tag))];

  // Wander points: a 1 m lattice of walkable floor at least 0.7 m from any furniture footprint.
  const blocked = (x: number, z: number) => (layout.furniture ?? []).some((f) => {
    const r = Math.max(f.size[0], f.size[2]) / 2 + 0.55;
    return (x - f.pos.x) ** 2 + (z - f.pos.z) ** 2 < r * r;
  });
  const wander: P2[] = [];
  for (let x = Math.ceil(b.minX) + 0.5; x < b.maxX - 0.5; x += 1) {
    for (let z = Math.ceil(b.minZ) + 0.5; z < b.maxZ - 0.5; z += 1) {
      if (inBounds(x, z) && (nav.walkable?.(x, z, 0) ?? true) && !blocked(x, z)) wander.push({ x, z });
    }
  }
  if (!wander.length) wander.push({ x: cx, z: cz });

  // Keep-clear zones around the canonical cameras: wander points too (a ghost must not park in a review frame).
  const camSpots = cameraSpots(layout);
  const cams: (P2 & { level?: number })[] = o.keepClear ?? camSpots;
  const keepR2 = (o.keepClearR ?? KEEP_CLEAR_R) ** 2;
  const clearOfCams = (x: number, z: number) => cams.every((c) => (c.x - x) ** 2 + (c.z - z) ** 2 >= keepR2);
  const openWander = wander.filter((p) => clearOfCams(p.x, p.z));
  if (openWander.length >= 4) { wander.length = 0; wander.push(...openWander); }

  const boxes = (layout.furniture ?? []).filter((f) => f.solid).map((f) => boxOf(f, 0.22));
  let router = createRouter(layout, ROUTE_CLEARANCE, [], cams);
  let aroundKey = '', aroundRouter = router;

  let home = new Map<string, Slot>();
  const pins = new Map<string, Slot>();
  const claims = new Map<string, Slot>(); // actorId → spot
  const spotHolder = new Map<string, string>(); // spotId → actorId (pins + claims)
  let deskKey = '', routerKey = '';
  /** positions of occupied overflow homes */
  let standing: P2[] = [];
  let nextPinAt = -Infinity;
  let lastSize = -1;

  const deskList = pods.flat();
  const seatC = seats.length
    ? { x: seats.reduce((a, s) => a + s.pos.x, 0) / seats.length, z: seats.reduce((a, s) => a + s.pos.z, 0) / seats.length }
    : { x: cx, z: cz };
  // Standing spots: a fine lattice of open floor (clear of furniture by a body width, of every camera, and of every
  // layout slot's approach), shared by the lounge ring and the overflow homes, packed greedily in preference order.
  const taken = slots.map((s) => s.pos);
  const doorways: P2[] = [layout.points?.entrance, layout.points && 'door' in layout.points ? (layout.points as { door?: P2 }).door : undefined].flatMap((p) => (p ? [p] : []));
  const solidBoxes = (layout.furniture ?? []).filter((f) => f.solid).map((f) => boxOf(f, 0.42));
  const podX = { min: Math.min(...deskList.map((s) => s.pos.x), cx), max: Math.max(...deskList.map((s) => s.pos.x), cx) };
  const podZ0 = { min: Math.min(...deskList.map((s) => s.pos.z), cz), max: Math.max(...deskList.map((s) => s.pos.z), cz) };
  // a seated agent steps out 0.6 m behind its chair (actors.ts approach())
  const stepOut = deskList.map((q) => ({ x: q.pos.x + Math.sin(q.yaw) * 0.6, z: q.pos.z + Math.cos(q.yaw) * 0.6 }));
  // other seats (sofa, beanbags) are entered from the front (actors.ts approach(): 0.5 m ahead of the seat)
  const seatFronts = seats.map((q) => ({ x: q.pos.x - Math.sin(q.yaw) * 0.5, z: q.pos.z - Math.cos(q.yaw) * 0.5 }));
  const deskBoxes = (layout.furniture ?? []).filter((f) => f.type === 'desk').map((f) => boxOf(f, 0.85));
  const chairBoxes = (layout.furniture ?? []).filter((f) => f.type === 'chair').map((f) => boxOf(f, 0.5));
  // The help queue's walk-in line: counter → each spot → a tail extension along the line (the approach), kept clear by
  // QUEUE_CLEAR so no stander crowds a queued agent or its hero frame.
  const queueLine: [P2, P2][] = [];
  if (queue.length) {
    const ctr = layout.points?.helpDesk ?? queue[0].pos;
    const pts = [{ x: ctr.x, z: ctr.z }, ...queue.map((s) => ({ x: s.pos.x, z: s.pos.z }))];
    const a = pts[pts.length - 2], c = pts[pts.length - 1], L = Math.hypot(c.x - a.x, c.z - a.z) || 1;
    pts.push({ x: c.x + (c.x - a.x) / L * 1.4, z: c.z + (c.z - a.z) / L * 1.4 });
    for (let i = 1; i < pts.length; i++) queueLine.push([pts[i - 1], pts[i]]);
  }
  // `spill` (a crowd beyond the open floor): the walking lanes behind the chair rows open up too, still clear of desks,
  // chairs and step-outs; walkers route around whoever stands there (createRouter's `standing`).
  const floorLattice = (spill: boolean) => {
    const out: P2[] = [];
    for (let x = b.minX + 0.55; x <= b.maxX - 0.55 + 1e-6; x += 0.125) {
      for (let z = b.minZ + 0.55; z <= b.maxZ - 0.55 + 1e-6; z += 0.125) {
        if (open(x, z, spill)) out.push({ x, z });
      }
    }
    return out;
  };
  const inLanes = (x: number, z: number) => x > podX.min - 0.3 && x < podX.max + 0.3 && z > podZ0.min - LANE && z < podZ0.max + LANE;
  const open = (x: number, z: number, spill: boolean) => {
    if (!(nav.walkable?.(x, z, 0) ?? true) || !clearOfCams(x, z)) return false;
    if (solidBoxes.some((bx) => inside(bx, x, z)) || chairBoxes.some((bx) => inside(bx, x, z))) return false;
    if ((spill || (x > podX.min && x < podX.max)) && deskBoxes.some((bx) => inside(bx, x, z))) return false; // aisles between pods stay walkable
    if (!spill && inLanes(x, z)) return false; // lanes behind the chair rows
    if (spill && z > podZ0.min - 0.2 && z < podZ0.max + 0.2) return false; // never inside a pod row
    if (taken.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 0.8 * 0.8)) return false;
    if (doorways.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 1.4 * 1.4)) return false; // walk-ins come through here
    if (deskList.some((s) => (s.pos.x - x) ** 2 + (s.pos.z - z) ** 2 < 0.9 * 0.9)) return false; // the seat itself
    const so = spill ? 1.0 : 1.1;
    if (stepOut.some((q) => (q.x - x) ** 2 + (q.z - z) ** 2 < so * so)) return false; // where a sitter steps out
    if (seatFronts.some((q) => (q.x - x) ** 2 + (q.z - z) ** 2 < 0.9 * 0.9)) return false;
    if (queueLine.some(([a, c]) => segDist({ x, z }, a, c) < QUEUE_CLEAR)) return false; // the queue line + its approach
    return true;
  };
  const openFloor = floorLattice(false);
  const faceTo = (p: P2, t: P2) => Math.atan2(-(t.x - p.x), -(t.z - p.z));
  // Overflow homes (more panes than desks): the back strip (behind the pods, away from the spawn side) and the lounge
  // corner first, the side walls next, the front aisle last and never right in front of a camera.
  const podZ = deskList.length ? { min: Math.min(...deskList.map((s) => s.pos.z)), max: Math.max(...deskList.map((s) => s.pos.z)) } : { min: cz, max: cz };
  const spawnZ = layout.spawn?.[2] ?? b.maxZ;
  const backSign = spawnZ >= cz ? -1 : 1; // the back of the room is away from the spawn
  const roomFocus = { x: cx, z: cz - backSign * 1.5 }; // standers face into the room, toward the spawn side
  const packed: (P2 & { yaw: number; clear?: boolean })[] = [];
  /** q stands inside p's front sightline cone. */
  const blocksView = (p: P2 & { yaw: number }, q: P2) => {
    const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
    return d < SIGHT.range && (-Math.sin(p.yaw) * dx - Math.cos(p.yaw) * dz) / (d || 1) > SIGHT.cos;
  };
  /**
   * Greedy pick from `cands` (preference order), always ≥ FLOOR_PITCH apart. `view`: 'clear' = nobody in its sightline
   * and it is in nobody's; 'keep' = may have its own view blocked but spoils no clear spot; 'any' = spacing only.
   */
  const pack = (cands: (P2 & { yaw: number })[], max: number, view: View = 'clear') => {
    const out: (P2 & { yaw: number; clear?: boolean })[] = [];
    for (const c of cands) {
      if (out.length >= max) break;
      const p = { x: c.x, z: c.z, yaw: c.yaw, clear: view === 'clear' };
      if (packed.some((q) => (q.x - p.x) ** 2 + (q.z - p.z) ** 2 < FLOOR_PITCH * FLOOR_PITCH)) continue;
      if (view === 'clear' && packed.some((q) => blocksView(p, q) || blocksView(q, p))) continue;
      if (view === 'keep' && packed.some((q) => q.clear && blocksView(q, p))) continue;
      packed.push(p); out.push(p);
    }
    return out;
  };
  // Lounge stand spots (done agents beyond the sofa seats): the ring around the seats, nearest first, facing them.
  const lounge = seats.length
    ? pack(openFloor
      .map((p) => ({ ...p, d: Math.hypot(p.x - seatC.x, p.z - seatC.z), yaw: faceTo(p, seatC) }))
      .filter((q) => q.d > 0.9 && q.d < 2.6)
      .sort((a, c) => a.d - c.d || a.x - c.x || a.z - c.z), 6, 'any')
      .map((p, i): Slot => ({ id: `lounge:${i}`, tag: 'loungeStand', pos: { x: p.x, y: 0, z: p.z }, yaw: p.yaw, pose: 'stand', level: 0 }))
    : [];
  const camYaws = o.keepClear ? [] : camSpots;
  const inFrontOfCam = (p: P2, r = 2.6) => camYaws.some(({ x, z, yaw }) => {
    const dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz);
    return d < r && (-Math.sin(yaw) * dx - Math.cos(yaw) * dz) / d > 0.5; // close and inside the view cone
  });
  // The spawn view's foreground (the first thing anyone sees; 70° vfov at 16:9 ≈ ±51° across): a stander there hides
  // the room, so it is the very last resort, taken frame edges first, and it faces the spawn (a greeter, not a back).
  const spawnYaw = layout.spawn?.[3] ?? 0;
  const spawnCos = (p: P2) => {
    const dx = p.x - spawnPt.x, dz = p.z - spawnPt.z, d = Math.hypot(dx, dz) || 1;
    return (-Math.sin(spawnYaw) * dx - Math.cos(spawnYaw) * dz) / d;
  };
  const inSpawnView = (p: P2) => Math.hypot(p.x - spawnPt.x, p.z - spawnPt.z) < 4.5 && spawnCos(p) > 0.62;
  // ghosts don't loiter there either (they still walk through)
  const wanderOut = wander.filter((p) => !inSpawnView(p));
  if (wanderOut.length >= 4) { wander.length = 0; wander.push(...wanderOut); }
  const rank = (p: P2) => {
    if (inFrontOfCam(p) || inSpawnView(p)) return 4;
    if (inFrontOfCam(p, 4.5)) return 3; // a camera's middle distance: only a big crowd stands there
    const behind = backSign < 0 ? p.z < podZ.min - 0.3 : p.z > podZ.max + 0.3;
    const front = backSign < 0 ? p.z > podZ.max + 0.3 : p.z < podZ.min - 0.3;
    return behind ? 0 : front ? 2 : 1;
  };
  // back strip: backmost first; elsewhere: farthest from every camera first
  const floorCands = openFloor
    .map((p) => { const r = rank(p); return { ...p, r, yaw: faceTo(p, inSpawnView(p) ? spawnPt : roomFocus), w: r === 0 ? backSign * (p.z - cz) : Math.min(99, ...cams.map((c) => Math.hypot(c.x - p.x, c.z - p.z))) }; })
    .sort((a, c) => a.r - c.r || c.w - a.w || a.x - c.x || a.z - c.z);
  // Clear-sightline spots first (canonical order = preference order); a crowd beyond them still keeps the body pitch.
  const spillCands = floorLattice(true)
    .map((p) => ({ ...p, r: inFrontOfCam(p) || inSpawnView(p) ? 4 : inFrontOfCam(p, 4) ? 3 : 0, yaw: faceTo(p, inSpawnView(p) ? spawnPt : roomFocus), w: Math.min(99, ...cams.map((c) => Math.hypot(c.x - p.x, c.z - p.z))) }))
    .sort((a, c) => a.r - c.r || c.w - a.w || a.x - c.x || a.z - c.z);
  // Tiers (floor ids in this order, so a small crowd only ever gets the best), rank by rank (back strip, sides, front,
  // camera middle distance, camera foreground): clear-sightline spots, then spots that spoil no clear view; then the
  // spill lanes the same way; only a huge crowd packs in front of others (the body pitch always holds).
  const tiered: { p: P2 & { yaw: number; clear?: boolean }; view: View }[] = [];
  const take = (cands: (P2 & { yaw: number })[], view: View) => { for (const p of pack(cands, FLOOR_MAX - tiered.length, view)) tiered.push({ p, view }); };
  /**
   * The crowd tier: one spot at a time, the one that hides the fewest clear faces (and those least squarely), so a
   * forced second row still staggers between the first row's standers instead of right in front of one.
   */
  const takeAny = (cands: (P2 & { yaw: number })[]) => {
    const left = cands.slice();
    while (tiered.length < FLOOR_MAX) {
      let best = -1, bestPen = Infinity;
      for (let i = 0; i < left.length; i++) {
        const c = left[i];
        if (packed.some((q) => (q.x - c.x) ** 2 + (q.z - c.z) ** 2 < FLOOR_PITCH * FLOOR_PITCH)) continue;
        let pen = 0;
        for (const q of packed) {
          if (!q.clear || !blocksView(q, c)) continue;
          const dx = c.x - q.x, dz = c.z - q.z, d = Math.hypot(dx, dz) || 1;
          pen += 1 + (-Math.sin(q.yaw) * dx - Math.cos(q.yaw) * dz) / d; // dead ahead costs most
        }
        if (pen < bestPen - 1e-9) { bestPen = pen; best = i; }
      }
      if (best < 0) return;
      const c = left.splice(best, 1)[0];
      const p = { x: c.x, z: c.z, yaw: c.yaw, clear: false };
      packed.push(p);
      tiered.push({ p, view: 'any' });
    }
  };
  // camera foregrounds (rank 4) only after every other spot, in the same tier order
  const offAxis = (a: P2, c: P2) => (inSpawnView(a) ? spawnCos(a) : 0) - (inSpawnView(c) ? spawnCos(c) : 0); // frame edges first
  for (const fg of [false, true]) {
    for (const r of fg ? [4] : [0, 1, 2, 3]) {
      const group = floorCands.filter((p) => p.r === r);
      if (fg) group.sort(offAxis);
      take(group, 'clear');
      take(group, 'keep');
    }
    const spill = spillCands.filter((p) => (p.r === 4) === fg), open = floorCands.filter((p) => (p.r === 4) === fg);
    if (fg) { spill.sort(offAxis); open.sort(offAxis); }
    take(spill, 'keep');
    takeAny(open);
    takeAny(spill);
  }
  const floor = tiered.map(({ p, view }, i): Slot & { view: View } => ({ id: `floor:${i}`, tag: 'floor', pos: { x: p.x, y: 0, z: p.z }, yaw: p.yaw, pose: 'stand', level: 0, view }));

  const recomputeDesks = (ents: Map<string, Entity>) => {
    const list = [...ents.values()];
    const key = list.map((e) => `${e.id}/${e.workspace?.slot ?? 0}/${e.tab?.index ?? 0}/${e.paneIndex ?? 0}`).sort().join('|');
    if (key === deskKey) return;
    deskKey = key;
    const prev = new Map();
    for (const [id, s] of home) prev.set(id, s.id);
    home = assignDesks(list, pods, prev);
    // Overflow (more panes than desks): sticky floor spots, then the next free one in canonical order.
    const used = new Set<string>();
    const rest = list.filter((e) => !home.has(e.id)).sort(canon);
    for (const e of rest) { const p = prev.get(e.id); if (p?.startsWith('floor:') && !used.has(p)) { used.add(p); home.set(e.id, floor[+p.slice(6)]); } }
    let k = 0;
    for (const e of rest) {
      if (home.has(e.id)) continue;
      while (k < floor.length && used.has(floor[k].id)) k++;
      if (k < floor.length) { used.add(floor[k].id); home.set(e.id, floor[k]); }
    }
    // Re-plan the clearance grid around whoever now stands at an overflow spot.
    const standKey = [...used].sort().join(',');
    if (standKey !== routerKey) {
      routerKey = standKey;
      standing = floor.filter((f) => used.has(f.id)).map((f) => f.pos);
      router = createRouter(layout, ROUTE_CLEARANCE, standing, cams);
    }
  };

  const recomputePins = (ents: Map<string, Entity>, now: number) => {
    pins.clear();
    const blockedQ: Entity[] = [], doneQ: Entity[] = [];
    for (const e of ents.values()) {
      if (e.kind === 'shell') continue;
      if (e.status === 'blocked' && now - since(e) >= TUNING.blockedChairMs) blockedQ.push(e);
      else if (e.status === 'done' && !e.ack) doneQ.push(e);
    }
    blockedQ.sort(cmpSince);
    doneQ.sort(cmpSince);
    for (let i = 0; i < blockedQ.length && i < queue.length; i++) pins.set(blockedQ[i].id, queue[i]);
    for (let i = 0; i < doneQ.length && i < seats.length + lounge.length; i++) pins.set(doneQ[i].id, i < seats.length ? seats[i] : lounge[i - seats.length]);
    spotHolder.clear();
    for (const [id, s] of pins) spotHolder.set(s.id, id);
    for (const [id, s] of claims) {
      if (spotHolder.has(s.id) || pins.has(id)) claims.delete(id); // evicted by a pin
      else spotHolder.set(s.id, id);
    }
  };

  return {
    update(entities, now) {
      recomputeDesks(entities);
      // Pins change with time (blocked ≥ 10 s), so refresh at PIN_HZ, or at once when the entity set changes.
      if (now >= nextPinAt || entities.size !== lastSize || now < nextPinAt - 2000) {
        nextPinAt = now + 1000 / PIN_HZ;
        lastSize = entities.size;
        for (const id of [...claims.keys()]) if (!entities.has(id)) claims.delete(id);
        recomputePins(entities, now);
      }
    },
    center: { x: cx, z: cz },
    faceRoom: (p) => Math.atan2(-(cx - p.x), -(cz - p.z)),
    faceSpawn: (p) => Math.atan2(-(spawnPt.x - p.x), -(spawnPt.z - p.z)),
    slotFor: (id) => home.get(id) ?? null,
    pinFor: (id) => pins.get(id) ?? null,
    claim(id, tag, near) {
      const cur = claims.get(id);
      if (cur && cur.tag === tag) return cur;
      if (cur) { spotHolder.delete(cur.id); claims.delete(id); }
      let best = null, bd = Infinity;
      for (const s of spots) {
        if (s.tag !== tag || spotHolder.has(s.id)) continue;
        if (standing.some((p) => (p.x - s.pos.x) ** 2 + (p.z - s.pos.z) ** 2 < 0.6 * 0.6)) continue; // an overflow home stands there
        const d = near ? (s.pos.x - near.x) ** 2 + (s.pos.z - near.z) ** 2 : 0;
        if (d < bd) { bd = d; best = s; }
      }
      if (best) { claims.set(id, best); spotHolder.set(best.id, id); }
      return best;
    },
    unclaim(id) {
      const cur = claims.get(id);
      if (cur) { spotHolder.delete(cur.id); claims.delete(id); }
    },
    holds: (id, slotId) => spotHolder.get(slotId) === id,
    chillTags,
    wanderPoint(r, near, maxD = Infinity) {
      if (near && Number.isFinite(maxD)) {
        const m2 = maxD * maxD;
        let n = 0;
        for (const p of wander) if ((p.x - near.x) ** 2 + (p.z - near.z) ** 2 <= m2) n++;
        if (n) {
          let k = Math.floor(r * n);
          for (const p of wander) if ((p.x - near.x) ** 2 + (p.z - near.z) ** 2 <= m2 && k-- === 0) return p;
        }
      }
      return wander[Math.floor(r * wander.length) % wander.length];
    },
    /** Open floor with a body's clearance (local avoidance sidesteps; raw nav occupancy, 0.22 m probe ring). */
    walkable(x, z) {
      if (!inBounds(x, z)) return false;
      const w = nav.walkable;
      if (!w) return true;
      const r = 0.22;
      return w(x, z, 0) && w(x + r, z, 0) && w(x - r, z, 0) && w(x, z + r, 0) && w(x, z - r, 0);
    },
    /**
     * A route that keeps clear of a person standing at `p` (the player blocking an aisle): the same clearance router
     * with a solid disc at `p`; null when there is no way around. The router is cached per 0.25 m player cell.
     */
    routeAround(from, to, p) {
      const key = `${Math.round(p.x * 4)},${Math.round(p.z * 4)}|${routerKey}`;
      if (key !== aroundKey) {
        aroundKey = key;
        aroundRouter = createRouter(layout, ROUTE_CLEARANCE, [...standing, ...AROUND_RING.map(([dx, dz]) => ({ x: p.x + dx, z: p.z + dz }))], cams);
      }
      const r = aroundRouter(from, to);
      if (!r) return null;
      // the tight-corner fallback grid may still squeeze past: only accept a route that really keeps its distance
      for (let i = 1; i < r.length; i++) if (segDist(p, r[i - 1], r[i]) < 0.55) return null;
      return r;
    },
    route(from, to) {
      const r = router(from, to);
      if (r) return r;
      const p = nav.path?.(from, to) ?? [from, to];
      return detour(p && p.length ? p : [from, to], boxes);
    },
    rekey(oldId, newId) {
      for (const m of [home, pins, claims]) { const v = m.get(oldId); if (v) { m.set(newId, v); m.delete(oldId); } }
      for (const [k, v] of spotHolder) if (v === oldId) spotHolder.set(k, newId);
      deskKey = '';
    },
    forget(id) {
      home.delete(id);
      pins.delete(id);
      const c = claims.get(id);
      if (c) { spotHolder.delete(c.id); claims.delete(id); }
      deskKey = '';
    },
    debug: () => ({
      pods: pods.map((p) => p.map((s) => s.id)),
      desks: Object.fromEntries([...home].map(([k, v]) => [k, v.id])),
      pins: Object.fromEntries([...pins].map(([k, v]) => [k, v.id])),
      claims: Object.fromEntries([...claims].map(([k, v]) => [k, v.id])),
      chillTags,
      wanderPoints: wander.length,
      floorSpots: floor.length,
      loungeSpots: lounge.map((s) => s.id),
    }),
    /** debug / tests: the overflow + lounge standing spots; `view` = 'clear' (clear front sightline), 'keep' (stands in
     *  no clear spot's sightline), 'any' (a big crowd: body pitch only) */
    spots: () => ({ floor, lounge }),
  };
}
