// @pure
/**
 * Director for the full office (DESIGN §6.4, §6.4.4, §6.5, §7.1): the one global allocator on `layout/hq.ts`.
 * Same interface as the proto director (director.ts dispatches here when the layout has bays), plus the M1.5 pieces:
 * stations, level-aware routes (stairs / slide, private back doors, the queue lane), path lengths for the roaming cap
 * and the 2× rule, and seat approach points.
 *
 * - Homes and pins come from `capacity.ts` (pure; sticky homes, `(statusSince, id)` pins).
 * - Casual spots (chill / hobby / nap picks and station seats) are held in one `holder` map: a pin or a home always
 *   evicts a casual claim on the same slot, so the Pit, the queue and the hot desks never double-book.
 * - Routes: `nav.route` (0.25 m grid, octile A*, string-pulled) with `owner` = the actor's bay (its private back door
 *   opens) and `queue` when either end is inside the roped lane. `via` forces the slide or the stairs (§6.5: returning
 *   from the mezzanine takes the slide half the time).
 * Owner: BRN.
 */
import { TUNING } from './tuning.ts';
import { capacityPlan, allocateHomes, allocatePins } from './capacity.ts';
import { AGENT_RADIUS } from '../../world/nav/index.ts';
import { makeGrid, inViewCone, VIEW_CONE } from '../../world/nav/grid.ts';
import { astar } from '../../world/nav/astar.ts';
import { pull, freeLine, costAt } from '../../world/nav/pull.ts';
import type { Grid } from '../../world/nav/grid.ts';
import type { Nav, NavOpts, NavPoint, Route } from '../../world/nav/index.ts';
import type { CapacityPlan, WsState } from './capacity.ts';
import type { AroundOpts, Director, DirectorOptions, P2, RouteOpts } from './director.ts';
import type { Entity } from '../../../../shared/protocol.ts';
import type { HqLayout, Slot, Station } from '../../world/layout/schema.ts';

/** where a walker steps in / out of a slot */
export interface Approach { x: number; z: number; level: number }
/** the office's allocation bookkeeping (`info()`) */
export interface HqInfo { overflowUsed: number; queueLen: number; queueFull: string[]; homeOverflow?: number; pinOverflow?: number }
/** a Shelly pocket-mode point (ENG) */
export interface PocketPoint { x: number; z: number; yaw: number }
/** a station with its resolved slots */
export type HqStation = Station & { slotList: Slot[] };
/** one bay's occupancy (signs / storefronts / "moving day") */
export interface BayInfo { amenity: string; name: string; ws: { id: string | null; label: string; number: number; colorIndex: number } | null }
export interface AroundStats { calls: number; searches: number; pending: number; scratchGrids: number }
export interface NavStats {
  searchesPerFrame: number; maxSearchesPerFrame: number; window: number; queue: number; queueMax: number;
  cache: number; cacheHits: number; cacheMisses: number; hitRate: number;
  bySource: { brain: number; via: number; around: number; other: number }; around: AroundStats; fields: number; fieldMisses: number;
}

/** The members only the full-office director has (the base ones are `Director`'s). */
export interface HqMembers {
  isHq: true;
  version(): number;
  slideExit(): Readonly<Slot> | null;
  pocketPoints: Record<string, PocketPoint[] | undefined>;
  /** [BRN fix m2-r1] Long-idle stagger (§6.4.1 10–60 min tier): this actor's place `k` among the `n` agents idle ≥ 10 min, or null */
  idleRank(id: string): { k: number; n: number } | null;
  /** [BRN fix m3-r2] the player's feet (actors.ts, per frame; null = nobody in the room): seat picks keep clear */
  setPlayer(p: { x: number; z: number; level?: number } | null): void;
  /** [BRN fix m3-r2] is (x, z) inside an authored view's 3 m no-stand cone? */
  inView(x: number, z: number, level?: number): boolean;
  /** [BRN fix m3-r2] may a new visitor take this spot (not in a view cone, not at the player's elbow)? */
  spotOk(s: Slot): boolean;
  bayOf(id: string): string | null;
  /** blocked for ≥ 10 s but the lane + rug are full → waits at its desk (§6.4.4) */
  queueFull(id: string): boolean;
  /** [BRN fix m2-r1] the NOW SERVING agent (queue head) id, or null */
  queueHead(): string | null;
  info(): HqInfo;
  /** bay occupancy for signs / storefronts / "moving day" (§7.2); changes bump `version()` */
  bayState(): Record<string, BayInfo>;
  /** [BRN fix m2-r2] every casual spot of a pick tag (social.ts frames the showcase regulars' seats) */
  spotsOf(tag: string): Slot[];
  /** how many casual claims a pick tag has had (outing freshness bias) */
  tagVisits(tag: string): number;
  /** [BRN fix m2-r1] ms since a pick tag was last claimed (or since the director's first frame) */
  tagIdleMs(tag: string, now: number): number;
  /** shortest path (m) from the actor's home to the nearest spot of a pick tag (roaming-cap weights) */
  tagDist(id: string, tag: string): number;
  farPick(tag: string): boolean;
  nearStairs(id: string): boolean;
  nearSlideExit(id: string): boolean;
  station(sid: string): HqStation | null;
  /** one-way travel time (s at the working 2.0 m/s) from the actor's home to the nearest slot of a station */
  travelS(id: string, sid: string): number;
  /** reserve the nearest free slot of a station (null = full → desk variant) */
  reserveStation(id: string, sid: string, near?: P2 | null): Slot | null;
  signpost: P2 | null;
  /** [BRN fix m175-r2] the nav opts a walk from → to is routed with (for the walker's local side-steps) */
  walkOpts(actorId: string | null | undefined, from: NavPoint, to: NavPoint): NavOpts;
  /** [BRN fix m3-r3] the soft view-cone cost at (x, z) (0 outside every cone) */
  softCost(x: number, z: number, level?: number): number;
  approach(s: Slot): Approach;
  approach(s: Slot | null | undefined): Approach | null;
  zoneAt(x: number, z: number, level?: number): string | null;
  /** path length (m) from → to for an actor (its back door opens); Infinity when unreachable */
  pathLen(from: NavPoint, to: NavPoint, actorId?: string | null): number;
  aroundStats(): AroundStats;
  /** §5.3 nav budget stats (`__hq.stats().brain.nav`) */
  navStats(): NavStats;
  plan: CapacityPlan;
}
/** The full-office director. */
export type HqDirector = Director & HqMembers;

const PIN_HZ = 4;
/** A standing body's clearance from walls / solid furniture for derived and overflow spots (m). */
const BODY_R = 0.4;
/** Seats entered from behind (a table / desk in front of them); every other sit/lie slot is entered from the front. */
const FROM_BEHIND = new Set(['desk', 'hotdesk', 'shellBench', 'station:library', 'station:roundtable', 'cafe', 'cards', 'microfiche', 'amenity']);
/** Chill / hobby pick tag → layout slot tags (window / plant spots are derived from walls / furniture). */
const PICK_SLOTS = Object.freeze({
  coffee: ['coffee'], arcade: ['arcade'], pingpong: ['pingpong'], foosball: ['foosball'], fish: ['fish'], library: ['library'],
  cafe: ['cafe'], microfiche: ['microfiche'], filing: ['filing'], telescope: ['station:observatory'], hotdesk: ['hotdesk'],
  boardGame: ['station:roundtable'], stargaze: ['stargaze'], archive: ['archive'], vaultNap: ['vaultNap'],
  cards: ['cards'], rack: ['rackSpot'], fern: ['plant'], bunk: ['bunk'], beanbag: ['beanbag'], sofa: ['sofa'],
  outbox: ['outbox'],
  lab: ['station:lab'], // [BRN fix m2-r1] an idle peek at the Lab's bubbling flasks (gives way to a test phase)
});
/** Picks that climb to the mezzanine or cross to the Archive: exempt from the 25 m roaming cap only for bays near the
 *  stairs foot (§6.4.1). */
const FAR_PICKS = new Set(['slide', 'telescope', 'hotdesk', 'boardGame', 'stargaze', 'microfiche', 'filing', 'archive', 'vaultNap']);

const segD = (p: P2, a: P2, b: P2) => {
  const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / L2));
  return Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z);
};
const inRect = (k: { x0: number; x1: number; z0: number; z1: number }, x: number, z: number) => x >= k.x0 && x <= k.x1 && z >= k.z0 && z <= k.z1;

export function createHqDirector(layout: HqLayout, nav: Nav, o: DirectorOptions = {}): HqDirector {
  const b = layout.bounds;
  const pts = layout.points;
  const center = pts.pitCenter ? { x: pts.pitCenter.x, z: pts.pitCenter.z } : { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
  const spawnPt = { x: layout.spawn[0], z: layout.spawn[2] };
  const slotById = new Map(layout.slots.map((s): [string, Slot] => [s.id, s]));
  const stations = new Map((layout.stations ?? []).map((s): [string, HqStation] => [s.id, { ...s, slotList: s.slots.flatMap((id) => slotById.get(id) ?? []) }]));
  const keep = (layout.keepClear ?? []).filter((k) => !k.headSlotOnly);
  const lane = layout.queueLane;
  const cams: (P2 & { level?: number })[] = o.keepClear ?? (layout.keepClearViews ?? []).map((v) => ({ x: v.x, z: v.z, level: v.level ?? 0 })); // authored viewpoints (data, not debug/poses.ts)
  // [BRN fix m3-r2] (art review m3-r2: gale + pennant filled pitOverview's corner, lumen a blob at the mezz frame's edge)
  // the first VIEW_CONE.r (3) m of every authored view's frustum is no-stand: no spiral / derived / wander spot, no casual
  // claim, a station slot only when every other one is taken (the nav grid also keeps walkers out, nav/grid.ts)
  const views = o.keepClear ? [] : (layout.keepClearViews ?? []);
  const inView = (x: number, z: number, level = 0) => views.some((v) => (v.level ?? 0) === level && inViewCone(v, x, z, VIEW_CONE.r - 0.01));
  const slotInView = (s: Slot) => { const ap = approach(s); return inView(s.pos.x, s.pos.z, s.level ?? 0) || (!!ap && inView(ap.x, ap.z, s.level ?? 0)); };
  // [BRN fix m3-r2] (fun review m3-r2: tinker lounged 0.5 m from the camera, its hat over a third of the frame) the
  // player's personal space: no new seat / spot pick within TUNING.personalR of them (actors.ts → setPlayer per frame)
  let player: { x: number; z: number; level: number } | null = null;
  const nearPlayer = (s: Slot) => {
    if (!player || (s.level ?? 0) !== player.level) return false;
    const R2 = TUNING.personalR ** 2;
    if ((s.pos.x - player.x) ** 2 + (s.pos.z - player.z) ** 2 < R2) return true;
    const ap = approach(s);
    return !!ap && (ap.x - player.x) ** 2 + (ap.z - player.z) ** 2 < R2;
  };
  const banned = (s: Slot) => slotInView(s) || nearPlayer(s);

  /** Open floor for a standing body (spiral overflow, derived spots): inflated nav clear, no keep-clear, no lane. */
  const free = (x: number, z: number, level = 0) => {
    const g = nav.gridFor(level).raw;
    if (g.blocked(x, z)) return false;
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; if (g.blocked(x + Math.cos(a) * BODY_R, z + Math.sin(a) * BODY_R)) return false; }
    if (keep.some((k) => inRect(k, x, z))) return false;
    if (lane && x >= lane[0] - 0.3 && x <= lane[2] + 0.3 && z >= lane[1] - 0.3 && z <= lane[3] + 0.3) return false;
    if (cams.some((c) => (c.level ?? 0) === level && (c.x - x) ** 2 + (c.z - z) ** 2 < 1.5 * 1.5)) return false;
    if (inView(x, z, level)) return false; // [BRN fix m3-r2]
    return true;
  };
  const plan = capacityPlan(layout, free);
  const pitRank = new Map(plan.pit.map((q, i): [string, number] => [q.id, i])); // [BRN fix m3-r2] Pit seats, best facing the hero views first

  // ---- derived casual spots: windows (people-height openings only) and plants -----------------------------------------
  const derived: Slot[] = [];
  for (const w of layout.walls ?? []) {
    if ((w.level ?? 0) !== 0) continue;
    for (const op of w.openings ?? []) {
      if (op.kind !== 'window' || (op.sill ?? 0) > 1.2) continue;
      const dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1], L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
      const mx = w.a[0] + ux * (op.at + op.w / 2), mz = w.a[1] + uz * (op.at + op.w / 2);
      for (const sgn of [1, -1]) {
        const nx = -uz * sgn, nz = ux * sgn;
        const x = mx + nx * 0.7, z = mz + nz * 0.7;
        if (!free(x, z, 0)) continue;
        derived.push({ id: `spot:window:${derived.length}`, tag: 'window', pos: { x, y: 0, z }, yaw: Math.atan2(nx, nz), pose: 'stand', level: 0, zone: layout.zoneAt(x, z, 0) });
        break;
      }
    }
  }
  for (const f of layout.furniture ?? []) {
    if (f.type !== 'plant' || f.id === 'engFern') continue;
    const lvl = f.level ?? 0;
    const r = Math.max(f.size[0], f.size[2]) / 2 + 0.45;
    for (const [dx, dz] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
      const x = f.pos.x + dx * r, z = f.pos.z + dz * r;
      if (!free(x, z, lvl)) continue;
      derived.push({ id: `spot:plant:${f.id}`, tag: 'plant', pos: { x, y: 0, z }, yaw: Math.atan2(dx, dz), pose: 'stand', level: lvl, anchor: f.id, zone: layout.zoneAt(x, z, lvl) });
      break;
    }
  }
  // [BRN fix m2-r1] Studio Street + Plaza (gameplay review m2: "no empty storefronts"): bench seats (sit, facing the
  // bench's front) and window-shopping spots in front of every storefront (stand, facing the bay's glazing), so idle
  // strolls and done agents' outings have somewhere to be on the street.
  const streetZones = new Set<string | null>(['STR', 'PLZ']);
  for (const f of layout.furniture ?? []) {
    if (f.type !== 'bench' || (f.level ?? 0) !== 0) continue;
    const zn = layout.zoneAt(f.pos.x, f.pos.z, 0);
    if (!streetZones.has(zn)) continue;
    const fx = Math.sin(f.yaw), fz = Math.cos(f.yaw), ax = Math.cos(f.yaw), az = -Math.sin(f.yaw);
    const n = f.size[0] >= 1.3 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const off = n === 1 ? 0 : (k - 0.5) * 0.8;
      const x = f.pos.x + ax * off + fx * 0.3, z = f.pos.z + az * off + fz * 0.3;
      const ap = { x: x + fx * 0.55, z: z + fz * 0.55 };
      if (!free(ap.x, ap.z, 0)) continue;
      derived.push({ id: `spot:streetBench:${f.id}:${k}`, tag: 'streetBench', pos: { x, y: 0, z }, yaw: f.yaw, pose: 'sit', level: 0, anchor: f.id, zone: zn });
    }
  }
  for (const bay of layout.bays ?? []) {
    const bz = layout.zones?.find((q) => q.id === bay.id);
    if (!bz) continue;
    const [x0, z0, x1, z1] = bz.rect;
    const east = bay.id[0] === 'E';
    const fx = east ? x0 : x1; // the storefront wall on the street
    const x = east ? fx - 0.75 : fx + 0.75;
    for (const dz of [-1.2, 1.2]) {
      const z = (z0 + z1) / 2 + dz;
      if (!free(x, z, 0) || layout.zoneAt(x, z, 0) !== 'STR') continue;
      derived.push({ id: `spot:street:${bay.id}:${dz}`, tag: 'street', pos: { x, y: 0, z }, yaw: east ? -Math.PI / 2 : Math.PI / 2, pose: 'stand', level: 0, bay: bay.id, zone: 'STR' });
    }
  }
  const spotsByTag = new Map<string, Slot[]>();
  const addSpot = (tag: string, s: Slot) => { let l = spotsByTag.get(tag); if (!l) spotsByTag.set(tag, (l = [])); l.push(s); };
  for (const [tag, tags] of Object.entries(PICK_SLOTS)) for (const s of layout.slots) if (tags.includes(s.tag)) addSpot(tag, s);
  for (const s of derived) addSpot(s.tag, s);
  // [BRN fix m2-r1] `street` = a storefront window or a street / plaza bench; `caf` = the Café proper (CAF zone), which
  // the nearest-spot `cafe` / `coffee` tags never reach from the Pit or an E bay (the Library café table is closer)
  for (const s of derived) if (s.tag === 'streetBench') addSpot('street', s);
  for (const s of layout.slots) if ((s.tag === 'cafe' || s.tag === 'coffee') && s.zone === 'CAF') addSpot('caf', s);
  // [BRN fix m2-r2] showcase-room regulars (social.ts): `libRead` = a Library seat (the reading tables' chairs, the tea
  // corner, the browse spots; never the ladders), `pitLounge` = a Pit sofa / beanbag (a done agent's pin still evicts it)
  const zoneOfSlot = (s: Slot) => s.zone ?? layout.zoneAt(s.pos.x, s.pos.z, s.level ?? 0);
  for (const s of layout.slots) {
    const zn = zoneOfSlot(s);
    if (zn === 'LIB' && ((s.tag === 'station:library' && s.pose === 'sit') || s.tag === 'cafe' || s.tag === 'library')) addSpot('libRead', s);
    if (zn === 'PIT' && (s.tag === 'beanbag' || s.tag === 'sofa')) addSpot('pitLounge', s);
  }
  for (const bay of layout.bays ?? []) {
    for (const id of bay.amenitySlots) { const sl = slotById.get(id); if (sl) addSpot('amenity', sl); }
    const nap = bay.nap ? slotById.get(bay.nap) : undefined;
    if (nap) addSpot('nap', nap);
  }
  // the slide ride: the mouth on the mezzanine (the rest of the ride is the route, §6.4.1 "stairs up, slide down")
  const slideTop = layout.portals?.find((p) => p.id === 'slide');
  // [BRN fix m175-r2] 1 m back from the mouth, facing it: the old spot (0.9 m east) stood 0.36 m from hot desk 1's stool
  if (slideTop) addSpot('slide', { id: 'spot:slideTop', tag: 'slide', pos: { x: slideTop.a.x, y: 0, z: slideTop.a.z - 1.0 }, yaw: Math.PI, pose: 'stand', level: 1, zone: 'MEZ' });
  // the Archive's filing-drawer wall (§7.1 ARC): where a shipped parcel's receipt gets filed (parcel run, §6.4)
  const drawers = (layout.furniture ?? []).find((f) => f.id === 'drawerWall');
  if (drawers) {
    const fx = Math.sin(drawers.yaw), fz = Math.cos(drawers.yaw); // prop front (+z local)
    const along = [Math.cos(drawers.yaw), -Math.sin(drawers.yaw)];
    for (const k of [-2.4, -0.8, 0.8, 2.4]) {
      const x = drawers.pos.x + along[0] * k + fx * (drawers.size[2] / 2 + 0.5), z = drawers.pos.z + along[1] * k + fz * (drawers.size[2] / 2 + 0.5);
      if (free(x, z, 0)) addSpot('receipt', { id: `spot:receipt:${k}`, tag: 'receipt', pos: { x, y: 0, z }, yaw: Math.atan2(fx, fz), pose: 'stand', level: 0, zone: layout.zoneAt(x, z, 0) });
    }
  }
  const chillTags = [...spotsByTag.keys()];
  // where a slide ride ends: a step past the exit, facing on (a virtual standing spot)
  const slideExit: Readonly<Slot> | null = layout.slide ? (() => {
    const e = layout.slide.exit, yaw = layout.slide.exitYaw ?? 0;
    const x = e.x - Math.sin(yaw) * 1.1, z = e.z - Math.cos(yaw) * 1.1;
    return Object.freeze({ id: 'spot:slideExit', tag: 'slideExit', pos: { x, y: 0, z }, yaw, pose: 'stand', level: 0, zone: layout.zoneAt(x, z, 0) });
  })() : null;
  // Shelly pocket-mode points in ENG (§6.4.1): the boiler gauge, a lap along the glass partition (waving at the atrium)
  const engZone = layout.zones?.find((q) => q.id === 'ENG');
  const boiler = (layout.statAnchors ?? []).find((a) => a.id === 'boiler');
  const pocketPoints: { gauge: PocketPoint[]; glass: PocketPoint[] } = { gauge: [], glass: [] };
  if (engZone) {
    const [x0, z0] = engZone.rect;
    if (boiler) { const p = { x: boiler.pos.x + 0.75, z: boiler.pos.z }; if (free(p.x, p.z, 0)) pocketPoints.gauge.push({ ...p, yaw: Math.PI / 2 }); }
    for (const dz of [1.0, 3.2, 5.4, 3.2]) { const p = { x: x0 + 0.75, z: z0 + dz }; if (free(p.x, p.z, 0)) pocketPoints.glass.push({ ...p, yaw: Math.PI / 2 }); }
  }

  // ---- wander points: a 1 m lattice of open floor (ghosts: Studio Street ↔ Plaza; strolls near home) -----------------
  const wander: P2[] = [], ghostWander: P2[] = [];
  for (let x = Math.ceil(b.minX) + 0.5; x < b.maxX; x += 1) for (let z = Math.ceil(b.minZ) + 0.5; z < b.maxZ; z += 1) {
    if (!free(x, z, 0)) continue;
    const p = { x, z };
    wander.push(p);
    const zn = layout.zoneAt(x, z, 0);
    if (zn === 'STR' || zn === 'PLZ') ghostWander.push(p);
  }
  const signpost = pts.signpost ? { x: pts.signpost.x, z: pts.signpost.z } : null;

  // ---- state ----------------------------------------------------------------------------------------------------------
  let home = new Map<string, Slot>();
  let bayOf = new Map<string, string | undefined>();
  /** workspace → slot + bays of the last allocation */
  let wsState: Map<string, WsState> | null = null;
  let pins = new Map<string, Slot>();
  /** actorId → casual spot */
  const claims = new Map<string, Slot>();
  /** slotId → actorId (homes, pins, claims) */
  const holder = new Map<string, string>();
  let nextPinAt = -Infinity, lastSize = -1, homeKeyBuilds = 0;
  /** the help queue, head first (sticky across pin recomputes) */
  let queueOrder: string[] = [];
  let info: HqInfo = { overflowUsed: 0, queueLen: 0, queueFull: [] };
  const homeIds = new Set<string>();
  /** bays a workspace occupies (their amenity dressing is packed away, §7.2) */
  const activeBays = new Set<string>();
  let version = 0;
  let lastEnts: Map<string, Entity> | null = null;
  /** amenity slots of occupied bays are not offered */
  const usable = (s: Slot) => !(s.tag === 'amenity' && s.bay && activeBays.has(s.bay));

  const rebuildHolder = () => {
    holder.clear();
    for (const [id, s] of home) holder.set(s.id, id);
    for (const [id, s] of pins) holder.set(s.id, id);
    for (const [id, s] of claims) {
      if (holder.has(s.id) || (pins.has(id) && !withPin.has(id))) claims.delete(id);
      else holder.set(s.id, id);
    }
  };

  /**
   * [BRN fix r3] (code review r3: a sorted key string over every entity every frame, ~8.6 KB/frame at crowd40) The
   * allocation inputs per entity (kind class, workspace id + slot, tab index, pane index), cached with the entity
   * object they were read from. Store entities are immutable snapshots (a patch replaces the object), so a steady-state
   * frame is one identity check per entity and allocates nothing; a patch compares six fields in place.
   */
  interface HomeSig { ref: Entity; shell: boolean; ws: string; slot: number; tab: number; pane: number }
  const homeSig = new Map<string, HomeSig>();
  let homeDirty = true;
  const sigSame = (s: HomeSig, e: Entity) => s.shell === (e.kind === 'shell') && s.ws === (e.workspace?.id ?? '') && s.slot === (e.workspace?.slot ?? 0)
    && s.tab === (e.tab?.index ?? 0) && s.pane === (e.paneIndex ?? 0);
  const sigSet = (s: HomeSig, e: Entity) => { s.ref = e; s.shell = e.kind === 'shell'; s.ws = e.workspace?.id ?? ''; s.slot = e.workspace?.slot ?? 0; s.tab = e.tab?.index ?? 0; s.pane = e.paneIndex ?? 0; return s; };
  /** true when an allocation input changed since the last allocation (entity added / gone / moved / kind class) */
  const homeInputsChanged = (ents: Map<string, Entity>) => {
    let changed = homeDirty || ents.size !== homeSig.size;
    for (const e of ents.values()) {
      const s = homeSig.get(e.id);
      if (!s) { changed = true; homeSig.set(e.id, sigSet({ ref: e, shell: false, ws: '', slot: 0, tab: 0, pane: 0 }, e)); continue; }
      if (s.ref === e) continue;
      if (!sigSame(s, e)) changed = true;
      sigSet(s, e);
    }
    if (homeSig.size !== ents.size) for (const id of homeSig.keys()) if (!ents.has(id)) homeSig.delete(id);
    homeDirty = false;
    return changed;
  };

  const recomputeHomes = (ents: Map<string, Entity>) => {
    if (!homeInputsChanged(ents)) return false;
    homeKeyBuilds++;
    const list = [...ents.values()];
    const prev = new Map([...home].map(([id, s]): [string, string] => [id, s.id]));
    const r = allocateHomes(list, plan, prev, wsState); // [BRN fix r2] bays stay with their workspace across churn
    home = r.home; bayOf = r.bayOf; wsState = r.wsState;
    activeBays.clear();
    for (const ids of r.wsBays.values()) for (const bid of ids) activeBays.add(bid);
    tagCache.clear(); nearStairsCache.clear(); nearExitCache.clear();
    version++;
    homeIds.clear();
    for (const s of home.values()) homeIds.add(s.id);
    info.homeOverflow = r.overflowUsed;
    return true;
  };
  const recomputePins = (ents: Map<string, Entity>, now: number) => {
    const r = allocatePins([...ents.values()], plan, now, TUNING.blockedChairMs, queueOrder, { prev: pins, avoid: nearPlayer }); // [BRN fix m3-r2]
    pins = r.pins;
    queueOrder = r.queueOrder; // sticky: a newcomer joins at the back (no two actors on one queue index mid-shuffle)
    info = { ...info, queueLen: r.queueLen, queueFull: r.queueFull, pinOverflow: r.overflowUsed, overflowUsed: (info.homeOverflow ?? 0) + r.overflowUsed };
    rebuildHolder();
  };

  // ---- routes & lengths ---------------------------------------------------------------------------------------------
  const inLane = (p: NavPoint) => lane && p.x >= lane[0] - 0.2 && p.x <= lane[2] + 0.2 && p.z >= lane[1] - 0.2 && p.z <= lane[3] + 0.2 && (p.level ?? 0) === 0;
  const optsFor = (actorId: string | null | undefined, from: NavPoint, to: NavPoint) => ({ owner: (actorId && bayOf.get(actorId)) || null, queue: inLane(from) || inLane(to) });
  const portal = (id: string) => layout.portals?.find((p) => p.id === id) ?? null;
  const straight = (from: NavPoint, to: NavPoint): NavPoint[] => [{ x: from.x, z: from.z, level: from.level ?? 0 }, { x: to.x, z: to.z, level: to.level ?? 0 }];

  /** Route forced through a portal (`slide`: must start on level 1; `stairs`: either way). */
  const routeVia = (from: NavPoint, to: NavPoint, via: string, opts: NavOpts, budget = false): Route | null | undefined => {
    const p = portal(via);
    if (!p) return null;
    const lf = from.level ?? 0, lt = to.level ?? 0;
    const fwd = p.a.level === lf && p.b.level === lt;
    if (!fwd && !(p.twoWay && p.b.level === lf && p.a.level === lt)) return null;
    const enter = fwd ? p.a : p.b, exit = fwd ? p.b : p.a;
    // [BRN fix m2-r1] budgeted like every other walker route (§5.3): forced slide / stairs routes used the unbudgeted
    // nav.route, so a frame could run 4 fresh searches; undefined = PENDING (both legs come from the cache next frame)
    const leg = budget && nav.tryRoute ? nav.tryRoute : nav.route;
    const r1 = leg(from, enter, opts);
    if (r1 === undefined) return undefined;
    const r2 = leg(exit, to, opts);
    if (r2 === undefined) return undefined;
    if (!r1 || !r2) return null;
    const path = fwd ? p.path ?? [] : [...(p.path ?? [])].reverse();
    const mid = via === 'stairs' ? path.slice(1, -1).map((q) => ({ x: q.x, z: q.z, level: q.y > 1.45 ? 1 : 0, portal: via })) : [];
    return { points: [...r1.points, ...mid, { x: exit.x, z: exit.z, level: exit.level, portal: via }, ...r2.points.slice(1)], length: r1.length + p.len + r2.length, portals: [via] };
  };

  // ---- distance fields: one 2-level Dijkstra per (source, owner) → O(1) path lengths for the roaming cap, tag
  // distances and station travel (§6.4.1, §6.5); octile grid metric (≈ 5 % over the string-pulled length).
  const SQ2 = Math.SQRT2;
  const fieldCache = new Map<string, Float32Array>();
  let fieldMisses = 0;
  const g0 = nav.gridFor(0).inflated;
  const COLS = g0.cols, ROWS = g0.rows, N = COLS * ROWS, CELLM = g0.cell;
  const nLevels = Math.max(1, layout.levels?.length ?? 1);
  const snapCell = (g: Grid, x: number, z: number): number => {
    const c = g.col(x), r = g.row(z);
    if (!g.blockedCR(c, r)) return r * COLS + c;
    for (let k = 1; k < 6; k++) for (let dr = -k; dr <= k; dr++) for (let dc = -k; dc <= k; dc++) {
      if (Math.max(Math.abs(dc), Math.abs(dr)) === k && !g.blockedCR(c + dc, r + dr)) return (r + dr) * COLS + c + dc;
    }
    return -1;
  };
  /** distances (m) over [level·N + cell] */
  const field = (src: NavPoint, owner: string | null): Float32Array => {
    const lvl = src.level ?? 0;
    const s0 = snapCell(nav.gridFor(lvl, { owner }).inflated, src.x, src.z);
    const key = `${owner ?? ''}|${lvl}|${s0}`;
    let d = fieldCache.get(key);
    if (d) { fieldCache.delete(key); fieldCache.set(key, d); return d; } // [LVL fix r1, cross-owner] LRU refresh
    fieldMisses++;
    const grids = Array.from({ length: nLevels }, (_, l) => nav.gridFor(l, { owner }).inflated); // [BRN fix r3] miss path only
    d = new Float32Array(N * nLevels).fill(Infinity);
    const links = new Map<number, [number, number][]>(); // node → [[node, cost]]
    const addLink = (u: number, v: number, cost: number) => { let l = links.get(u); if (!l) links.set(u, (l = [])); l.push([v, cost]); };
    for (const p of layout.portals ?? []) {
      if (p.a.level >= nLevels || p.b.level >= nLevels) continue;
      const a = snapCell(grids[p.a.level], p.a.x, p.a.z), bb = snapCell(grids[p.b.level], p.b.x, p.b.z);
      if (a < 0 || bb < 0) continue;
      const na = p.a.level * N + a, nb = p.b.level * N + bb;
      addLink(na, nb, p.len);
      if (p.twoWay) addLink(nb, na, p.len);
    }
    if (s0 < 0) { fieldCache.set(key, d); return d; }
    // binary heap of (dist, node)
    let hk = new Float64Array(1024), hv = new Int32Array(1024), hn = 0;
    const push = (k: number, v: number) => {
      if (hn === hk.length) { const k2 = new Float64Array(hn * 2); k2.set(hk); hk = k2; const v2 = new Int32Array(hn * 2); v2.set(hv); hv = v2; }
      let i = hn++;
      while (i > 0) { const q = (i - 1) >> 1; if (hk[q] <= k) break; hk[i] = hk[q]; hv[i] = hv[q]; i = q; }
      hk[i] = k; hv[i] = v;
    };
    let pk = 0;
    const pop = () => {
      const v = hv[0]; pk = hk[0]; hn--;
      const k = hk[hn], vv = hv[hn];
      let i = 0;
      for (;;) { const l = 2 * i + 1; if (l >= hn) break; const m = l + 1 < hn && hk[l + 1] < hk[l] ? l + 1 : l; if (hk[m] >= k) break; hk[i] = hk[m]; hv[i] = hv[m]; i = m; }
      hk[i] = k; hv[i] = vv;
      return v;
    };
    const start = lvl * N + s0;
    d[start] = 0; push(0, start);
    while (hn) {
      const node = pop();
      if (pk > d[node] + 1e-3) continue; // stale heap entry (d is float32: allow its rounding)
      const base = node >= N ? N : 0, l = base ? 1 : 0, cell = node - base;
      const dn = d[node];
      const c = cell % COLS, r = (cell / COLS) | 0, g = grids[l];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dc && !dr) continue;
        const c2 = c + dc, r2 = r + dr;
        if (g.blockedCR(c2, r2) || (dc && dr && (g.blockedCR(c + dc, r) || g.blockedCR(c, r + dr)))) continue;
        const nn = base + r2 * COLS + c2, nd = dn + (dc && dr ? SQ2 : 1) * CELLM;
        if (nd < d[nn]) { d[nn] = nd; push(nd, nn); }
      }
      const ls = links.get(node);
      if (ls) for (const [nn, cost] of ls) { const nd = dn + cost; if (nd < d[nn]) { d[nn] = nd; push(nd, nn); } }
    }
    fieldCache.set(key, d);
    if (fieldCache.size > 96) { const oldest = fieldCache.keys().next(); if (!oldest.done) fieldCache.delete(oldest.value); } // [LVL fix r1, cross-owner] LRU, not clear()
    return d;
  };
  const readField = (d: Float32Array, p: NavPoint, owner: string | null) => {
    const l = p.level ?? 0;
    const i = snapCell(nav.gridFor(l, { owner }).inflated, p.x, p.z);
    return i < 0 ? Infinity : d[l * N + i];
  };
  /** Path length (m) from → to for an actor (its back door opens); Infinity when unreachable. */
  const pathLen = (from: NavPoint, to: NavPoint, actorId: string | null = null) => {
    const owner = (actorId && bayOf.get(actorId)) || null;
    return readField(field(from, owner), to, owner);
  };

  const apCache = new Map<string, Approach>();
  /** Where a walker steps in / out of a slot (seats: behind or in front, whichever is open). */
  function approach(s: Slot): Approach;
  function approach(s: Slot | null | undefined): Approach | null;
  function approach(s: Slot | null | undefined): Approach | null {
    if (!s) return null;
    let ap = apCache.get(s.id);
    if (ap) return ap;
    const lvl = s.level ?? 0;
    ap = { x: s.pos.x, z: s.pos.z, level: lvl };
    if (s.pose === 'sit' || s.pose === 'lie') {
      const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
      const order = FROM_BEHIND.has(s.tag) ? [-0.6, 0.55, -0.85, 0.8] : [0.55, 0.8, -0.6, -0.85];
      const g = nav.gridFor(lvl).inflated;
      for (const k of order) {
        const x = s.pos.x + fx * k, z = s.pos.z + fz * k;
        if (!g.blocked(x, z)) { ap = { x, z, level: lvl }; break; }
      }
      if (ap.x === s.pos.x && ap.z === s.pos.z) { // sideways (a bench against a wall)
        for (const k of [0.6, -0.6]) {
          const x = s.pos.x - fz * k, z = s.pos.z + fx * k;
          if (!g.blocked(x, z)) { ap = { x, z, level: lvl }; break; }
        }
      }
    }
    apCache.set(s.id, ap);
    return ap;
  }
  const homeAp = (id: string) => approach(home.get(id));
  const stairsFoot = pts.stairsFoot ? { x: pts.stairsFoot.x, z: pts.stairsFoot.z, level: 0 } : null;
  const nearStairsCache = new Map<string, boolean>();
  /** Is this actor's home within the roaming cap of the stairs foot (E bays: slide / mezzanine / Archive picks)? */
  const nearStairs = (id: string) => {
    const s = home.get(id);
    if (!s || !stairsFoot) return false;
    let v = nearStairsCache.get(s.id);
    if (v === undefined) { v = pathLen(approach(s), stairsFoot, id) <= TUNING.roamCapM; nearStairsCache.set(s.id, v); }
    return v;
  };

  const nearExitCache = new Map<string, boolean>();
  /**
   * [BRN fix r1] Is this actor's home within the roaming cap of the slide exit? The victory lap (MAIL → stairs → slide
   * home) and a work call from the mezzanine (§6.4.2: the slide when shorter) both end there, so this — not the stairs
   * foot — is the distance that bounds them.
   */
  const nearSlideExit = (id: string) => {
    const s = home.get(id);
    if (!s || !slideExit) return false;
    let v = nearExitCache.get(s.id);
    if (v === undefined) { v = pathLen(slideExit.pos, approach(s), id) <= TUNING.roamCapM; nearExitCache.set(s.id, v); }
    return v;
  };

  // ---- routes around the player ([BRN fix r2]: was a fresh createNav — a full-office buildGrid + inflate — per 0.25 m
  // player cell and an unbudgeted search). One scratch copy of the inflated grid per (level, owner, queue): the player's
  // disc is stamped in (only the cells within r + AGENT_RADIUS; the previous stamp is restored from the base grid), and
  // every search it needs spends the §5.3 per-frame budget (`nav.spendSearch`); a spent budget = PENDING (`undefined`).
  interface Scratch { base: Grid; occ: Uint8Array; grid: Grid; stamped: number[]; key: string }
  const scratch = new Map<string, Scratch>();
  /** [BRN fix m3-r3] routeAround tier memo (see routeAround) and the tiers: personal space, then the tight fallbacks */
  const aroundMemo = new Map<string, { at: number; q: NavPoint[] | null }>();
  const AROUND_TIERS = [TUNING.personalR, TUNING.aroundR, 0.45];
  const aroundStats = { calls: 0, searches: 0, pending: 0, scratchGrids: 0 };
  const scratchFor = (lvl: number, opts: NavOpts): Scratch => {
    const key = `${lvl}|${opts.owner ?? ''}|${opts.queue ? 1 : 0}`;
    let sc = scratch.get(key);
    if (!sc) {
      const base = nav.gridFor(lvl, opts).inflated;
      const occ = base.occ.slice();
      sc = { base, occ, grid: makeGrid({ cols: base.cols, rows: base.rows, x0: base.x0, z0: base.z0, cell: base.cell, occ, level: lvl, cost: base.cost ?? null }), stamped: [], key: '' };
      scratch.set(key, sc);
      aroundStats.scratchGrids++;
      if (scratch.size > 8) { const oldest = scratch.keys().next(); if (!oldest.done) scratch.delete(oldest.value); }
    }
    return sc;
  };
  const stampDisc = (sc: Scratch, p: P2, R: number): Grid => {
    const key = `${p.x},${p.z},${R}`;
    if (sc.key === key) return sc.grid;
    for (const i of sc.stamped) sc.occ[i] = sc.base.occ[i];
    sc.stamped.length = 0;
    const g = sc.grid;
    const c0 = Math.max(0, g.col(p.x - R)), c1 = Math.min(g.cols - 1, g.col(p.x + R));
    const r0 = Math.max(0, g.row(p.z - R)), r1 = Math.min(g.rows - 1, g.row(p.z + R));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const q = g.center(c, r), i = r * g.cols + c;
      if ((q.x - p.x) ** 2 + (q.z - p.z) ** 2 <= R * R && !sc.occ[i]) { sc.occ[i] = 1; sc.stamped.push(i); }
    }
    sc.key = key;
    return g;
  };
  const freeCellOf = (g: Grid, x: number, z: number): [number, number] | null => {
    const c = g.col(x), r = g.row(z);
    if (!g.blockedCR(c, r)) return [c, r];
    for (let k = 1; k < 12; k++) {
      let best: [number, number] | null = null, bd = Infinity;
      for (let dr = -k; dr <= k; dr++) for (let dc = -k; dc <= k; dc++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== k || g.blockedCR(c + dc, r + dr)) continue;
        const q = g.center(c + dc, r + dr), d = (q.x - x) ** 2 + (q.z - z) ** 2;
        if (d < bd) { bd = d; best = [c + dc, r + dr]; }
      }
      if (best) return best;
    }
    return null;
  };
  /** Same-level leg on a stamped grid: a line of sight is free, a search spends the budget. undefined = PENDING */
  const gridLeg = (g: Grid, f: NavPoint, t: NavPoint): NavPoint[] | null | undefined => {
    if (freeLine(g, f.x, f.z, t.x, t.z)) return [f, t]; // ([BRN fix m3-r3] no deeper into a soft view cone)
    if (nav.spendSearch && !nav.spendSearch()) return undefined;
    aroundStats.searches++;
    const s = freeCellOf(g, f.x, f.z), e = freeCellOf(g, t.x, t.z);
    if (!s || !e) return null;
    const cells = astar(g, s[0], s[1], e[0], e[1]);
    if (!cells) return null;
    const pts = cells.map((i) => g.center(i % g.cols, (i / g.cols) | 0));
    pts[0] = { x: f.x, z: f.z }; pts[pts.length - 1] = { x: t.x, z: t.z };
    return pull(g, pts).map((q) => ({ x: q.x, z: q.z, level: f.level }));
  };
  /** points; null = no way round at this radius; undefined = PENDING (budget spent) */
  const aroundRoute = (from: NavPoint, to: NavPoint, p: P2, r: number, o2: AroundOpts): NavPoint[] | null | undefined => {
    const lvl = from.level ?? 0;
    const f = { x: from.x, z: from.z, level: lvl }, t = { x: to.x, z: to.z, level: to.level ?? 0 };
    const opts = optsFor(o2.actorId, f, t);
    let q: NavPoint[];
    if (t.level === lvl) {
      const same = gridLeg(stampDisc(scratchFor(lvl, opts), p, r + AGENT_RADIUS), f, t);
      if (!same) return same;
      q = same;
    } else {
      // another level: the usual (budgeted, cached) route, with its leg on the player's level re-planned round them
      const base = nav.tryRoute ? nav.tryRoute(f, t, opts) : nav.route(f, t, opts);
      if (!base) return base;
      const pts = base.points;
      let j = 1;
      while (j < pts.length && (pts[j].level ?? 0) === lvl && !pts[j].portal) j++;
      const head = gridLeg(stampDisc(scratchFor(lvl, opts), p, r + AGENT_RADIUS), f, pts[j - 1]);
      if (!head) return head;
      q = [...head, ...pts.slice(j)];
    }
    for (let i = 1; i < q.length; i++) if ((q[i].level ?? 0) === lvl && (q[i - 1].level ?? 0) === lvl && segD(p, q[i - 1], q[i]) < r + 0.1) return null;
    return q;
  };
  // ---- §5.3 nav budget stats ([BRN fix m2-r1]: `__hq.stats().brain.nav`, gated by perf.ts): fresh grid searches per
  // frame over the last NAV_WIN frames, the queued (PENDING) asks, the leg cache, and who searched (brain routes, forced
  // portal routes, routes around the player, anyone else on the shared nav: the ambient cast)
  const NAV_WIN = 120;
  const navWin = new Uint8Array(NAV_WIN);
  let navI = 0, navFrames = 0, navPending = 0, navPendingMax = 0;
  const navSrc = { brain: 0, via: 0, around: 0 };
  const missesNow = () => nav.budgetStats?.().misses ?? 0;
  /** run `fn`, charging the fresh searches it made to `src` */
  const charged = <T,>(src: keyof typeof navSrc, fn: () => T): T => { const m0 = missesNow(); const r = fn(); navSrc[src] += missesNow() - m0; return r; };
  const navFrame = () => {
    const b = nav.budgetStats?.();
    if (!b) return;
    navWin[navI] = Math.min(255, b.searches); navI = (navI + 1) % NAV_WIN; navFrames++;
    navPending = b.pending; navPendingMax = Math.max(navPendingMax, b.pending);
  };
  const navStats = () => {
    const b = nav.budgetStats?.() ?? { searches: 0, pending: 0, cache: 0, hits: 0, misses: 0 };
    const n = Math.min(NAV_WIN, navFrames);
    let sum = 0, max = 0;
    for (let i = 0; i < n; i++) { sum += navWin[i]; if (navWin[i] > max) max = navWin[i]; }
    const ours = navSrc.brain + navSrc.via + navSrc.around;
    return {
      searchesPerFrame: n ? +(sum / n).toFixed(3) : 0, maxSearchesPerFrame: max, window: n,
      queue: navPending, queueMax: navPendingMax, cache: b.cache, cacheHits: b.hits, cacheMisses: b.misses,
      hitRate: b.hits + b.misses ? +(b.hits / (b.hits + b.misses)).toFixed(3) : 0,
      bySource: { ...navSrc, other: Math.max(0, b.misses - ours) }, around: { ...aroundStats }, fields: fieldCache.size, fieldMisses,
    };
  };

  /** long-idle agents (idle ≥ idleChillMs), id order, and each one's index (rebuilt at PIN_HZ; no garbage when steady) */
  const longIdle: string[] = [];
  const idleRankOf = new Map<string, number>();
  const rankLongIdle = (ents: Map<string, Entity>, now: number) => {
    longIdle.length = 0;
    for (const e of ents.values()) {
      if (e.kind === 'shell' || !(e.status === 'idle' || (e.status === 'done' && e.ack))) continue;
      if (now - (e.statusSince ?? now) >= TUNING.idleChillMs) longIdle.push(e.id);
    }
    longIdle.sort();
    idleRankOf.clear();
    for (let i = 0; i < longIdle.length; i++) idleRankOf.set(longIdle[i], i);
  };

  const director: HqDirector = {
    isHq: true,
    version: () => version,
    slideExit: () => slideExit,
    pocketPoints,
    update(entities, now) {
      navFrame(); // the finished frame's searches (before the reset)
      nav.frame?.(); // [LVL fix r1, cross-owner] a new frame's A* budget (§5.3)
      lastEnts = entities;
      lastNow = now;
      if (firstNow === null) firstNow = now;
      const changed = recomputeHomes(entities);
      if (changed || now >= nextPinAt || entities.size !== lastSize || now < nextPinAt - 2000) {
        nextPinAt = now + 1000 / PIN_HZ;
        lastSize = entities.size;
        for (const id of [...claims.keys()]) if (!entities.has(id)) claims.delete(id);
        recomputePins(entities, now);
        rankLongIdle(entities, now);
      }
    },
    /**
     * [BRN fix m2-r1] Long-idle stagger (§6.4.1 10–60 min tier): this actor's place `k` among the `n` agents idle ≥ 10
     * min (id order), or null. The brain offsets its nap / hobby cycle by k / n of a period, so the office always has
     * somebody on a hobby instead of every sleeper dozing in sync.
     */
    idleRank: (id: string) => { const k = idleRankOf.get(id); return k === undefined ? null : { k, n: longIdle.length }; },
    center,
    faceRoom: (p) => Math.atan2(-(center.x - p.x), -(center.z - p.z)),
    faceSpawn: (p) => Math.atan2(-(spawnPt.x - p.x), -(spawnPt.z - p.z)),
    slotFor: (id) => home.get(id) ?? null,
    /** [BRN fix m3-r2] the player's feet (actors.ts, per frame; null = nobody in the room): seat picks keep clear */
    setPlayer(p) { if (!p) player = null; else { player ??= { x: 0, z: 0, level: 0 }; player.x = p.x; player.z = p.z; player.level = p.level ?? 0; } },
    /** [BRN fix m3-r2] is (x, z) inside an authored view's 3 m no-stand cone? */
    inView,
    /** [BRN fix m3-r2] may a new visitor take this spot (not in a view cone, not at the player's elbow)? */
    spotOk: (s) => !banned(s),
    pinFor: (id) => pins.get(id) ?? null,
    bayOf: (id) => bayOf.get(id) ?? null,
    /** blocked for ≥ 10 s but the lane + rug are full → waits at its desk (§6.4.4) */
    queueFull: (id) => info.queueFull.includes(id),
    /** [BRN fix m2-r1] the NOW SERVING agent (queue head) id, or null */
    queueHead: () => queueOrder[0] ?? null,
    info: () => info,
    /**
     * Bay occupancy for signs / storefronts / "moving day" (§7.2; ENV/FX read this): per bay, the workspace ids that
     * hold its desks (primary or annex) or null = amenity. Changes bump `version()`.
     */
    bayState() {
      const out: Record<string, BayInfo> = {};
      for (const b of layout.bays ?? []) out[b.id] = { amenity: b.amenity, name: b.amenityName, ws: null };
      for (const [id, bid] of bayOf) { const e = lastEnts?.get(id); const ob = bid === undefined ? undefined : out[bid]; if (e && ob && !ob.ws) ob.ws = { id: e.workspace?.id ?? null, label: e.workspace?.label ?? '', number: e.workspace?.number ?? 0, colorIndex: e.workspace?.colorIndex ?? 0 }; }
      return out;
    },
    chillTags,
    /** [BRN fix m2-r2] every casual spot of a pick tag (social.ts frames the showcase regulars' seats) */
    spotsOf: (tag) => spotsByTag.get(tag) ?? [],
    /**
     * Casual spot of a pick tag: the nearest free one by path from `near` (the home's approach), or null. `maxLen`
     * applies the roaming cap (`Infinity` = none). `o3.withPin`: the claim is kept while the actor holds a pin (a
     * done agent's outing from the Pit, [BRN fix r2]); otherwise a pin drops it.
     */
    claim(id, tag, near, maxLen = Infinity, o3 = {}) {
      const cur = claims.get(id);
      if (cur && cur.tag !== undefined && claimTag.get(id) === tag) return cur;
      director.unclaim(id);
      const list = spotsByTag.get(tag);
      if (!list) return null;
      let best = null, bd = Infinity;
      const from = near ?? homeAp(id);
      for (const s of list) {
        if (holder.has(s.id) || homeIds.has(s.id) || !usable(s) || banned(s)) continue; // [BRN fix m3-r2] view cones, the player
        let d = from ? pathLen(from, approach(s), id) : 0;
        if (d > maxLen) continue;
        // [BRN fix m3-r2] a Pit lounger (a regular, a stint) takes the free seat that best faces the hero views (the
        // done agents' pin order: the far arc first), not the nearest one
        if (tag === 'pitLounge' && maxLen >= 30 && pitRank.has(s.id)) d = (pitRank.get(s.id) ?? 0) + d * 1e-3;
        if (d >= bd) continue;
        bd = d; best = s;
      }
      if (best) { claims.set(id, best); claimTag.set(id, tag); holder.set(best.id, id); if (o3.withPin) withPin.add(id); visits.set(tag, (visits.get(tag) ?? 0) + 1); lastClaimAt.set(tag, lastNow); }
      return best;
    },
    unclaim(id) {
      withPin.delete(id);
      const cur = claims.get(id);
      if (cur) { if (holder.get(cur.id) === id) holder.delete(cur.id); claims.delete(id); claimTag.delete(id); }
    },
    holds: (id, slotId) => holder.get(slotId) === id,
    /** How many casual claims a pick tag has had (outing freshness bias). */
    tagVisits: (tag) => visits.get(tag) ?? 0,
    /** [BRN fix m2-r1] ms since a pick tag was last claimed (or since the director's first frame): a drought bias for outings */
    tagIdleMs: (tag, now) => now - (lastClaimAt.get(tag) ?? firstNow ?? 0),
    /** Shortest path (m) from the actor's home to the nearest spot of a pick tag (roaming-cap weights); cached per home. */
    tagDist(id, tag) {
      const h = home.get(id);
      if (!h) return Infinity;
      const key = `${h.id}|${tag}`;
      let v = tagCache.get(key);
      if (v === undefined) {
        v = Infinity;
        for (const s of spotsByTag.get(tag) ?? []) if (usable(s)) v = Math.min(v, pathLen(approach(h), approach(s), id));
        tagCache.set(key, v);
      }
      return v;
    },
    farPick: (tag) => FAR_PICKS.has(tag),
    nearStairs,
    nearSlideExit,
    // ---- stations (§6.5)
    station: (sid) => stations.get(sid) ?? null,
    /** One-way travel time (s at the working 2.0 m/s) from the actor's home to the nearest slot of a station. */
    travelS(id, sid) {
      const h = home.get(id), st = stations.get(sid);
      if (!h || !st) return Infinity;
      const key = `${h.id}|st:${sid}`;
      let v = tagCache.get(key);
      if (v === undefined) {
        v = Infinity;
        for (const s of st.slotList) v = Math.min(v, pathLen(approach(h), approach(s), id));
        v /= TUNING.scurrySpeed;
        tagCache.set(key, v);
      }
      return v;
    },
    /** Reserve the nearest free slot of a station (null = full → desk variant). */
    reserveStation(id, sid, near) {
      const st = stations.get(sid);
      if (!st) return null;
      const cur = claims.get(id);
      if (cur && st.slots.includes(cur.id)) return cur;
      director.unclaim(id);
      let best = null, bd = Infinity;
      const from = near ?? homeAp(id);
      // [BRN fix m2-r1] work outranks idling: an idle agent's casual pick on a station slot (the telescope, the board
      // game, a lab peek) gives way to a working agent's station visit (a free slot is still preferred)
      const casual = (sl: Slot) => { const h = holder.get(sl.id); return h !== undefined && claims.get(h) === sl && !claimTag.get(h)?.startsWith('station:') && !withPin.has(h); };
      for (const s of st.slotList) {
        const taken = holder.has(s.id);
        if (taken && !casual(s)) continue;
        // ([BRN fix m3-r2] a slot in a view cone or at the player's elbow only when nothing else is left)
        const d = (from ? pathLen(from, approach(s), id) : 0) + (taken ? 8 : 0) + (banned(s) ? 60 : 0);
        if (d < bd) { bd = d; best = s; }
      }
      if (best) {
        const h = holder.get(best.id);
        if (h !== undefined && h !== id) { claims.delete(h); claimTag.delete(h); }
        claims.set(id, best); claimTag.set(id, `station:${sid}`); holder.set(best.id, id);
      }
      return best;
    },
    // ---- wandering
    wanderPoint(r, near, maxD = Infinity, ghost = false) {
      const src = ghost && ghostWander.length ? ghostWander : wander;
      if (near && Number.isFinite(maxD)) {
        const m2 = maxD * maxD;
        const cand = src.filter((p) => (p.x - near.x) ** 2 + (p.z - near.z) ** 2 <= m2);
        if (cand.length) return cand[Math.floor(r * cand.length) % cand.length];
      }
      return src[Math.floor(r * src.length) % src.length];
    },
    signpost,
    // [BRN fix m175-r2] `o` = the walker's route opts (walkOpts): its own bay's back door / the queue lane are open floor
    walkable(x, z, level = 0, o = undefined, r = 0.22) { // r: body probe ring (0.08 = hugging a wall to let someone by)
      const w = nav.walkable;
      return w(x, z, level, o) && w(x + r, z, level, o) && w(x - r, z, level, o) && w(x, z + r, level, o) && w(x, z - r, level, o);
    },
    /** [BRN fix m175-r2] the nav opts a walk from → to is routed with (for the walker's local side-steps) */
    walkOpts: (actorId, from, to) => optsFor(actorId, from, to),
    /** [BRN fix m3-r3] the soft view-cone cost at (x, z) (nav/grid.ts VIEW_CONE.softR; 0 outside every cone) */
    softCost: (x, z, level = 0) => costAt(nav.gridFor(level).raw, x, z),
    approach,
    zoneAt: (x, z, level = 0) => layout.zoneAt(x, z, level),
    // ---- routes
    /** Level-aware route (NavPoints with `level`, `portal`); `o.via` forces 'slide' / 'stairs'. Never null. */
    route(from, to, o2 = {}) {
      const f = { x: from.x, z: from.z, level: from.level ?? 0 }, t = { x: to.x, z: to.z, level: to.level ?? 0 };
      const opts = optsFor(o2.actorId, f, t);
      // [LVL fix r1, cross-owner] `o2.budget`: the per-frame A* budget (§5.3, nav.tryRoute); null = queued, ask next frame
      if (o2.budget && !o2.via && nav.tryRoute) { const q = charged('brain', () => nav.tryRoute(f, t, opts)); if (q === undefined) return null; return q ? q.points : straight(f, t); }
      const via = o2.via;
      let r = via ? charged('via', () => routeVia(f, t, via, opts, !!o2.budget)) : null;
      if (r === undefined) return null; // PENDING: ask next frame
      r = r || charged('brain', () => (o2.budget && nav.tryRoute ? nav.tryRoute(f, t, opts) : nav.route(f, t, opts)));
      if (r === undefined) return null;
      return r ? r.points : straight(f, t);
    },
    pathLen,
    /**
     * A route that keeps clear of the player at `p` (a disc of TUNING.aroundR, then a tight 0.45 m). Budgeted (§5.3):
     * `undefined` = PENDING (this frame's searches are spent: wait, ask next frame); null = no way round.
     */
    routeAround(from, to, p, o2 = {}) {
      aroundStats.calls++;
      // [BRN fix m3-r3] the player's personal space first (TUNING.personalR, a soft cost: actors.ts weighs the detour),
      // then the old tight radii. A tier's answer is memoised per (from, to, p) 0.25 m cell for aroundMemoS: with three
      // tiers a PENDING retry must not re-spend the budget on the tiers it already searched (it would never finish)
      const r0 = o2.minR ?? 0;
      for (const r of AROUND_TIERS) {
        if (r < r0) continue;
        const key = `${Math.round(from.x * 4)},${Math.round(from.z * 4)},${from.level ?? 0}>${Math.round(to.x * 4)},${Math.round(to.z * 4)},${to.level ?? 0}@${Math.round(p.x * 4)},${Math.round(p.z * 4)}|${r}|${o2.actorId ?? ''}`;
        const m = aroundMemo.get(key);
        let q;
        if (m && lastNow - m.at < 2000) q = m.q;
        else {
          q = charged('around', () => aroundRoute(from, to, p, r, o2));
          if (q === undefined) { aroundStats.pending++; return undefined; }
          aroundMemo.set(key, { at: lastNow, q });
          if (aroundMemo.size > 256) { const oldest = aroundMemo.keys().next(); if (!oldest.done) aroundMemo.delete(oldest.value); }
        }
        if (q) return q;
      }
      return null;
    },
    aroundStats: () => ({ ...aroundStats }),
    /** §5.3 nav budget stats (`__hq.stats().brain.nav`; perf.ts gates searchesPerFrame / maxSearchesPerFrame) */
    navStats,
    rekey(oldId, newId) {
      for (const m of [home, pins, claims]) { const v = m.get(oldId); if (v) { m.set(newId, v); m.delete(oldId); } }
      if (bayOf.has(oldId)) { bayOf.set(newId, bayOf.get(oldId)); bayOf.delete(oldId); }
      const ct = claimTag.get(oldId);
      if (ct !== undefined) { claimTag.set(newId, ct); claimTag.delete(oldId); }
      for (const [k, v] of holder) if (v === oldId) holder.set(k, newId);
      if (withPin.delete(oldId)) withPin.add(newId);
      const qi = queueOrder.indexOf(oldId);
      if (qi >= 0) queueOrder = queueOrder.map((q) => (q === oldId ? newId : q));
      homeDirty = true;
    },
    forget(id) {
      director.unclaim(id);
      home.delete(id); pins.delete(id); bayOf.delete(id);
      homeDirty = true;
    },
    debug: () => ({
      desks: Object.fromEntries([...home].map(([k, v]) => [k, v.id])),
      pins: Object.fromEntries([...pins].map(([k, v]) => [k, v.id])),
      claims: Object.fromEntries([...claims].map(([k, v]) => [k, v.id])),
      bays: Object.fromEntries(bayOf),
      wsBays: wsState ? Object.fromEntries([...wsState].map(([k, v]) => [k, v.bays])) : {},
      chillTags, info, homeBuilds: homeKeyBuilds,
      spirals: { cushions: plan.cushions.length, eng: plan.engSpiral.length, pit: plan.pitSpiral.length, atrium: plan.atriumSpiral.length },
    }),
    spots: () => ({ floor: [...plan.cushions, ...plan.engSpiral, ...plan.pitSpiral, ...plan.atriumSpiral], lounge: [], derived }),
    plan,
  };
  const claimTag = new Map<string, string>();
  /** [BRN fix r2] actors whose casual claim survives their pin (a done agent's outing from its Pit seat) */
  const withPin = new Set<string>();
  /** claims made per pick tag (a freshness bias for outings: the office spreads its visits, [BRN fix r2]) */
  const visits = new Map<string, number>();
  /** pick tag → `now` of its last claim */
  const lastClaimAt = new Map<string, number>();
  let lastNow = 0, firstNow: number | null = null;
  const tagCache = new Map<string, number>();
  return director;
}
