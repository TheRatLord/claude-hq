// @pure
/**
 * The full office (§7.1): 42 × 28 m, two levels. **Single source of truth** for zones, walls, doors, furniture, slots,
 * stations, bays, amenities, windows, stat anchors, points, vis cells, nav levels and portals. Authored in PLAN
 * coordinates (origin NW corner, +x east, +z south, straight from the §7.1 table), exported in WORLD coordinates
 * (world = plan − (20.5, 14); the Pit centre is the origin). Yaw is camera-style for slots (`yawTo`), prop-front for
 * furniture (`frontYaw`: local +z is the prop's front), as in proto.ts.
 *
 * Block map: `npm run walktimes -- --ascii` (regenerated from this file; paste into §7).
 * Owner: LVL.
 */
import { PLAN_OFFSET, yawTo, frontYaw, local2world } from './schema.ts';
import { floorY, floorAt, groundY, MEZZ_Y, STAIRS, PIT, MEZZ_RECTS, onMezz, stairsY, QUEUE_DAIS } from './floorY.ts';
import { DESK, deskLocal } from './proto.ts';
import type {
  Amenity, Bay, Circle, Door, Furniture, HqLayout, LampAnchor, LampKind, Lane, NavLevel, OpeningKind, Portal, Rect, Slot,
  StatAnchor, Station, Vec3, Wall, WallKind, WallOpening, WindowRect, Zone, ZoneDef,
} from './schema.ts';

const OX = PLAN_OFFSET.x, OZ = PLAN_OFFSET.z;
/** plan → world point (y given, or the floor there). */
const P = (px: number, pz: number, y?: number): Vec3 => ({ x: px - OX, y: y ?? floorY(px - OX, pz - OZ, 0), z: pz - OZ });
const PL = (px: number, pz: number, level: number): Vec3 => ({ x: px - OX, y: floorY(px - OX, pz - OZ, level), z: pz - OZ });
const R = ([x0, z0, x1, z1]: readonly number[]): Rect => [x0 - OX, z0 - OZ, x1 - OX, z1 - OZ];
const S = Math.PI, EAST = -Math.PI / 2, WEST = Math.PI / 2; // slot yaws: facing north / south / east / west
const NORTH = 0;
const DOOR_H = 1.7;

// ================================================================================================= zones (§7.1)
/** Zone definitions in plan coordinates. */
const ZONE_DEFS: ZoneDef[] = [
  { id: 'LOB', name: 'Lobby', rect: [14, 21, 28, 28], floor: 0, ceil: 3.4 },
  { id: 'PIT', name: 'The Pit', rect: [16.5, 10, 24.5, 18], circle: [20.5, 14, 4.0], floor: -0.45, ceil: 5.5 },
  { id: 'ATR', name: 'Atrium', rect: [14, 7, 28, 21], floor: 0, ceil: 5.5 },
  { id: 'LIB', name: 'Library', rect: [14, 0, 28, 7], floor: 0, ceil: 2.6 },
  { id: 'MEZ', name: 'Mezzanine', rect: [14, 0, 28, 7], floor: MEZZ_Y, ceil: 5.5, level: 1 },
  { id: 'NAL', name: 'Reading Alley', rect: [0, 0, 14, 2], floor: 0, ceil: 2.8 },
  { id: 'STR', name: 'Studio Street', rect: [5, 2, 8, 21], floor: 0, ceil: 3.4 },
  { id: 'W1', name: 'Bay W1', rect: [0, 2, 5, 8], floor: 0, ceil: 2.8 },
  { id: 'W2', name: 'Bay W2', rect: [0, 8, 5, 15], floor: 0, ceil: 2.8 },
  { id: 'W3', name: 'Bay W3', rect: [0, 15, 5, 21], floor: 0, ceil: 2.8 },
  { id: 'E1', name: 'Bay E1', rect: [8, 2, 14, 8], floor: 0, ceil: 2.8 },
  { id: 'E2', name: 'Bay E2', rect: [8, 8, 14, 15], floor: 0, ceil: 2.8 },
  { id: 'E3', name: 'Bay E3', rect: [8, 15, 14, 21], floor: 0, ceil: 2.8 },
  { id: 'PLZ', name: 'Plaza', rect: [0, 21, 14, 23.5], floor: 0, ceil: 3.0 },
  { id: 'WAR', name: 'War Room', rect: [0, 23.5, 6.5, 28], floor: 0, ceil: 2.8 },
  { id: 'LAB', name: 'Lab', rect: [6.5, 23.5, 14, 28], floor: 0, ceil: 2.8 },
  { id: 'MAIL', name: 'Mailroom', rect: [28, 0, 33, 11], floor: 0, ceil: 2.8 },
  { id: 'ARC', name: 'Archive', rect: [33, 0, 42, 11], floor: 0, ceil: 2.8 },
  { id: 'ENG', name: 'Engine Room', rect: [28, 11, 42, 20], floor: 0.25, ceil: 3.25 },
  { id: 'NAP', name: 'Nap Nook', rect: [38, 20, 42, 23], floor: 0, ceil: 2.8 },
  { id: 'CAF', name: 'Café', rect: [28, 20, 42, 28], floor: 0, ceil: 2.8 },
];
const inRect = (r: Rect, px: number, pz: number) => px >= r[0] && px <= r[2] && pz >= r[1] && pz <= r[3];
/** Zone id at plan (px, pz) on a level (PIT before ATR, NAP before CAF; level 1 = MEZ incl. the landing). */
export function zoneAtPlan(px: number, pz: number, level = 0): string | null {
  if (level === 1) return onMezz(px, pz) ? 'MEZ' : null;
  for (const z of ZONE_DEFS) {
    if (z.level === 1) continue;
    if (z.circle) { if (Math.hypot(px - z.circle[0], pz - z.circle[1]) < z.circle[2]) return z.id; continue; }
    if (inRect(z.rect, px, pz)) return z.id;
  }
  return null;
}

// ================================================================================================= walls & doors
const WALLS: Wall[] = [];
/** Doors / openings people walk through (walls' openings + open junctions). World coords. */
const DOORS: Door[] = [];
const DOOR_KINDS = new Set<OpeningKind>(['door', 'arch', 'storefront', 'entrance', 'opening']);
/**
 * Axis-aligned wall on a plan line. `ops`: [from, to, kind, {sill, top, private, id}] in plan units along the axis.
 * Kinds: wall | glass | storefront | rail | lintel (§7.1). Door-like openings also register a DOOR.
 */
interface OpeningOpts { sill?: number; top?: number; private?: string; id?: string }
/** `[from, to, kind, opts]` in plan units along the wall's axis. */
type WallOp = [from: number, to: number, kind: OpeningKind, opts?: OpeningOpts];
interface WallOpts { y0?: number; t?: number; kind?: WallKind; level?: number }
function wall(ax: number, az: number, bx: number, bz: number, h: number, ops: WallOp[] = [], o: WallOpts = {}): void {
  const horiz = az === bz;
  const a0 = horiz ? ax : az, dir = Math.sign((horiz ? bx : bz) - a0);
  const openings = ops.map(([from, to, kind, q = {}]): WallOpening => {
    const lo = Math.min(from, to), hi = Math.max(from, to);
    const at = dir > 0 ? lo - a0 : a0 - hi;
    const sill = q.sill ?? 0;
    const top = q.top ?? (kind === 'door' ? DOOR_H : kind === 'storefront' ? 2.0 : kind === 'arch' ? 2.2 : kind === 'entrance' ? 2.3 : sill + 1.2);
    const op = { at, w: hi - lo, h: top - sill, sill, kind, ...(q.private ? { private: q.private } : {}) };
    if (DOOR_KINDS.has(kind) && sill <= 0.05) {
      const c = horiz ? [(lo + hi) / 2, az] : [ax, (lo + hi) / 2];
      addDoor({ id: q.id, kind, px: c[0], pz: c[1], w: hi - lo, axis: horiz ? 'x' : 'z', private: q.private ?? null, y0: o.y0 ?? 0 });
    }
    return op;
  });
  WALLS.push({ a: [ax - OX, az - OZ], b: [bx - OX, bz - OZ], h, t: o.t ?? 0.2, y0: o.y0 ?? 0, kind: o.kind ?? 'wall', level: o.level ?? 0, openings });
}
/** Door across a plan line: `axis` 'x' = the opening runs along x (wall on z = pz). */
function addDoor({ id, kind, px, pz, w, axis, private: priv = null, y0 = 0 }: { id?: string; kind: OpeningKind; px: number; pz: number; w: number; axis: 'x' | 'z'; private?: string | null; y0?: number }): void {
  const n = axis === 'x' ? [0, 1] : [1, 0];
  const side = (s: number) => ({ px: px + n[0] * s, pz: pz + n[1] * s });
  const A = side(-0.8), B = side(0.8);
  const za = zoneAtPlan(A.px, A.pz) ?? 'OUT', zb = zoneAtPlan(B.px, B.pz) ?? 'OUT';
  const did = id ?? `${[za, zb].sort().join('-')}@${(axis === 'x' ? px : pz).toFixed(1)}`;
  DOORS.push({
    id: did, kind, zones: [za, zb], private: priv, w, axis, y0,
    pos: P(px, pz), aprons: [P(A.px, A.pz), P(B.px, B.pz)],
    // keep-clear apron (world rect): the door width × ±0.8 m
    rect: R(axis === 'x' ? [px - w / 2, pz - 0.8, px + w / 2, pz + 0.8] : [px - 0.8, pz - w / 2, px + 0.8, pz + w / 2]),
  });
}

const H_ATR = 5.5;
const RAM: [number, number] = [23.2, 21.3]; // [LVL fix r1] RAM column (plan)
/** [LVL fix r1] Slide helix centre x (plan): 0.9 m east of the §7.1 15.4, so the ride sweeps over the atrium (the Pit
 *  and the queue) instead of grazing the E2 wall 0.2 m away. */
const SLIDE_X = 16.3;
// ---- exterior -----------------------------------------------------------------------------------------------------
wall(0, 0, 14, 0, 2.8, [[1, 4, 'window', { sill: 0.9 }], [9, 12, 'window', { sill: 0.9 }]]);
wall(14, 0, 28, 0, H_ATR, [[17, 25, 'highWindow', { sill: 1.45, top: 2.25 }], [15, 20, 'highWindow', { sill: 3.65, top: 4.9 }], [21.5, 27.5, 'highWindow', { sill: 3.65, top: 4.9 }]]);
wall(28, 0, 33, 0, 2.8);
wall(33, 0, 42, 0, 2.8, [[35, 40, 'highWindow', { sill: 1.5, top: 2.3 }]]);
wall(42, 0, 42, 11, 2.8, [[2, 5.5, 'window', { sill: 0.9 }]]);
wall(42, 11, 42, 20, 3.25);
wall(42, 20, 42, 28, 2.8, [[23.8, 27.4, 'window', { sill: 0.9 }]]);
wall(42, 28, 28, 28, 2.8, [[29.5, 36.5, 'window', { sill: 0.9 }]]);
wall(28, 28, 14, 28, 3.4, [[19, 22, 'entrance', { id: 'entrance' }], [15, 18, 'window', { sill: 0.9, top: 2.5 }], [23, 27, 'window', { sill: 0.9, top: 2.5 }]]);
wall(14, 28, 6.5, 28, 2.8, [[8, 12.5, 'window', { sill: 0.9 }]]);
wall(6.5, 28, 0, 28, 2.8, [[1.5, 5, 'window', { sill: 0.9 }]]);
wall(0, 28, 0, 21, 2.8, [[24.5, 27, 'window', { sill: 0.9 }]]);
wall(0, 21, 0, 0, 2.8, [[3.5, 6.5, 'window', { sill: 0.9 }], [10, 13, 'window', { sill: 0.9 }], [16.5, 19.5, 'window', { sill: 0.9 }]]);
// ---- bays ↔ street (storefronts: 2.4 m door centred on the bay's street face + display windows) -------------------
/** Storefront door centre per bay row: centred, except the north row (W1/E1) sits 0.8 m south so its trips down the
 *  street (Lab, War Room, Plaza) stay ≤ 12 s at 2.0 m/s. */
const STOREFRONT_Z: [number, number, number][] = [[2, 8, 5.8], [8, 15, 11.5], [15, 21, 18]];
const storefront = (x: number) => wall(x, 2, x, 21, 3.4, STOREFRONT_Z.flatMap(([z0, z1, c]): WallOp[] => [
  [c - 1.2, c + 1.2, 'storefront'],
  ...([[z0 + 0.4, c - 1.4], [c + 1.4, z1 - 0.4]] as const).filter(([a, b]) => b - a >= 0.6).map(([a, b]): WallOp => [a, b, 'display', { sill: 0.55, top: 1.9 }]),
]), { kind: 'storefront' });
storefront(5);
storefront(8);
for (const [x0, x1] of [[0, 5], [8, 14]]) {
  wall(x0, 2, x1, 2, 2.8);
  wall(x0, 8, x1, 8, 2.8);
  wall(x0, 15, x1, 15, 2.8);
  wall(x0, 21, x1, 21, 3.0);
}
// ---- x14: bays / alley ↔ library / atrium (E bays: glazed back wall + private back doors) ---------------------------
wall(14, 0, 14, 2, H_ATR, [[0.3, 1.7, 'door']]);
wall(14, 2, 14, 7, H_ATR, [[3, 4.4, 'door', { private: 'E1' }]]);
wall(14, 7, 14, 8, H_ATR);
// [LVL fix r1] E-bay glazing runs down to a 0.12 m kerb (was a 0.6 m sill): from the spawn the rays to the desks cross
// x14 at 0.2–0.4 m, so a 0.6 m sill hid every working ring and most monitors (P1)
const E_SILL = 0.12;
wall(14, 8, 14, 15, H_ATR, [[8.3, 10.8, 'glass', { sill: E_SILL, top: 2.4 }], [11, 12.4, 'door', { private: 'E2' }], [12.6, 14.7, 'glass', { sill: E_SILL, top: 2.4 }]], { kind: 'glass' });
wall(14, 15, 14, 21, H_ATR, [[15.3, 16.8, 'glass', { sill: E_SILL, top: 2.4 }], [17, 18.4, 'door', { private: 'E3' }], [18.6, 20.7, 'glass', { sill: E_SILL, top: 2.4 }]], { kind: 'glass' });
wall(14, 21, 14, 23.5, 3.4, [[21, 23.5, 'opening', { top: 3.0 }]], { kind: 'lintel' });
wall(14, 23.5, 14, 28, 3.4, [[25, 26.4, 'door']]);
// ---- plaza ↔ war room / lab -----------------------------------------------------------------------------------------
wall(0, 23.5, 6.5, 23.5, 3.0, [[2.5, 3.9, 'door']]);
wall(6.5, 23.5, 14, 23.5, 3.0, [[7.2, 8.6, 'door']]); // [M1.5] moved from x9–10.4 to line up with the street (E1 → Lab ≤ 12 s)
wall(6.5, 23.5, 6.5, 28, 2.8);
// ---- lobby ↔ atrium: rope line + planters (see-through; the planters/counter are furniture) under a lintel ---------
wall(14, 21, 28, 21, H_ATR, [[14, 28, 'lintel', { top: 3.4 }]], { kind: 'lintel' });
addDoor({ id: 'LOB-ATR:main', kind: 'opening', px: 20.5, pz: 21, w: 4, axis: 'x' });
addDoor({ id: 'LOB-ATR:east', kind: 'opening', px: 25.5, pz: 21, w: 2, axis: 'x' });
// open junctions (no wall): street ↔ alley, street ↔ plaza
addDoor({ id: 'NAL-STR', kind: 'opening', px: 6.5, pz: 2, w: 3, axis: 'x' });
addDoor({ id: 'PLZ-STR', kind: 'opening', px: 6.5, pz: 21, w: 3, axis: 'x' });
// ---- library ↔ atrium arches (up to the mezzanine slab) --------------------------------------------------------------
wall(14, 7, 28, 7, 2.6, [[16, 19.5, 'arch'], [21.5, 25, 'arch']]);
// ---- east block ---------------------------------------------------------------------------------------------------
wall(28, 0, 28, 7, H_ATR);
wall(28, 7, 28, 11, H_ATR, [[7.2, 8.6, 'door']]); // ATR ↔ MAIL under the stair landing (clearance 2.6)
wall(28, 11, 28, 20, H_ATR, [[11.3, 17.2, 'glass', { sill: 0.6, top: 2.6 }], [17.5, 19, 'door'], [19.2, 19.8, 'glass', { sill: 0.6, top: 2.6 }]], { kind: 'glass' });
wall(28, 20, 28, 21, H_ATR);
wall(28, 21, 28, 28, 3.4, [[23, 26, 'door', { top: 2.2 }]]);
wall(33, 0, 33, 11, 2.8, [[4, 5.4, 'door']]);
wall(28, 11, 42, 11, 3.25, [[37, 38.4, 'door']]);
wall(28, 20, 42, 20, 3.25, [[33, 34.4, 'door']]);
wall(38, 20, 38, 23, 2.8);
wall(38, 23, 42, 23, 2.8, [[38.4, 39.6, 'door']]);
// ---- level 1: mezzanine rail (slide mouth gap), landing rail, stairs rail ------------------------------------------
// [LVL fix r3] 0.8 m (was 1.0): the eye is at 1.2 m, so at the rail looking down (pitch −0.3) the cap now falls below the
// frame instead of banding its middle; greybox draws it as a thin 0.04 m tube over the glass (the Pit/Board overlook)
export const RAIL_H = 0.8;
/** [LVL fix m175 r2] Plan rect of the mezzanine rail run (stair landing → slide mouth): no slot, seat or prop in it (layout.test). */
export const RAIL_RUN = Object.freeze([14, 5.75, 28, 7.0]);
wall(14, 7, SLIDE_X - 0.5, 7, RAIL_H, [], { kind: 'rail', y0: MEZZ_Y, level: 1, t: 0.08 });
wall(SLIDE_X + 0.5, 7, 26, 7, RAIL_H, [], { kind: 'rail', y0: MEZZ_Y, level: 1, t: 0.08 });
wall(26, 7, 26, 9.5, RAIL_H, [], { kind: 'rail', y0: MEZZ_Y, level: 1, t: 0.08 });
wall(26, 9.5, 26.3, 9.5, RAIL_H, [], { kind: 'rail', y0: MEZZ_Y, level: 1, t: 0.08 });

// ================================================================================================= furniture & slots
const FURNITURE: Furniture[] = [];
const SLOTS: Slot[] = [];
const LAMPS: LampAnchor[] = [];
const counters = new Map<string, number>();
const nid = (k: string) => { const n = counters.get(k) ?? 0; counters.set(k, n + 1); return `${k}${n}`; };

/**
 * Furniture at plan (px, pz). `yaw`: prop-front yaw (frontYaw). size [w, h, d] before yaw.
 */
type FurnitureOpts = Partial<Omit<Furniture, 'type' | 'pos' | 'yaw' | 'size'>> & { y?: number };
function F(type: string, px: number, pz: number, size: [number, number, number], yaw = 0, o: FurnitureOpts = {}): Furniture {
  const { id, solid = true, level = 0, y, ...rest } = o;
  const f: Furniture = { id: id ?? nid(type), type, pos: y !== undefined ? P(px, pz, y) : PL(px, pz, level), yaw, size, solid, level, zone: zoneAtPlan(px, pz, level), ...rest };
  FURNITURE.push(f);
  return f;
}
/** Slot at plan (px, pz), camera-style yaw. */
type SlotOpts = Partial<Omit<Slot, 'tag' | 'pos' | 'yaw' | 'pose'>>;
function slot(tag: string, px: number, pz: number, yaw: number, pose: Slot['pose'] = 'stand', o: SlotOpts = {}): Slot {
  const { id, level = 0, ...rest } = o;
  const s: Slot = { id: id ?? `slot:${nid(`${tag}:`)}`, tag, pos: PL(px, pz, level), yaw, pose, level, zone: zoneAtPlan(px, pz, level), ...rest };
  SLOTS.push(s);
  return s;
}
const lamp = (kind: LampKind, px: number, pz: number, y: number, radius: number, color: string, gain: number, level = 0): void => {
  LAMPS.push({ id: nid(`lamp:${kind}:`), kind, pos: P(px, pz, y + (level ? MEZZ_Y : 0)), radius, color, gain });
  if (kind === 'floor') F('lampPost', px, pz, [0.36, 1.6, 0.36], 0, { level }); // the fixture is drawn from the lamp anchor
};
const planTo = (f: Furniture, lx: number, lz: number) => { const w = local2world(f.pos, f.yaw, lx, lz); return { px: w.x + OX, pz: w.z + OZ }; };

// ---- bays (§6.4 BAY_ORDER = [E3, E2, E1, W3, W2, W1]; pod index = order index) ------------------------------------
export const BAY_ORDER = Object.freeze(['E3', 'E2', 'E1', 'W3', 'W2', 'W1'] as const);
type BayId = (typeof BAY_ORDER)[number];
type AmenityId = 'musicRoom' | 'gym' | 'greenhouse' | 'gameRoom' | 'artStudio' | 'napLounge';
const AMENITY_OF: Record<BayId, AmenityId> = { W1: 'musicRoom', W2: 'gym', W3: 'greenhouse', E1: 'gameRoom', E2: 'artStudio', E3: 'napLounge' };
const AMENITY_NAME: Record<AmenityId, string> = { musicRoom: 'MUSIC ROOM', gym: 'GYM', greenhouse: 'GREENHOUSE', gameRoom: 'GAME ROOM', artStudio: 'ART STUDIO', napLounge: 'NAP LOUNGE' };
const BAYS: Bay[] = [];
const PODS: string[][] = [];
/** Desk centres along z relative to the bay centre: 2 + 1 with a 0.8 m pass-through, so the far column reaches the
 *  storefront without walking round the pod. */
const POD_Z = [-1.65, -0.55, 1.35];
for (const [pod, id] of BAY_ORDER.entries()) {
  const z = ZONE_DEFS.find((q) => q.id === id);
  if (!z) throw new Error(`hq: no zone ${id}`);
  const [x0, z0, x1, z1] = z.rect;
  const east = id[0] === 'E';
  const cx = east ? 11.6 : 2.5, zc = (z0 + z1) / 2;
  const desks: string[] = [];
  // pod of 6 = 2 columns × 3. [LVL fix r1] Desks fill in slot order, so the column whose SCREENS face the atrium side
  // (E bays: the east column, agents' backs to the glazing) is filled first, so working monitors read through the E-bay
  // glazing from the spawn (P1). W bays keep the street-facing agents first (faces toward the storefronts).
  for (const [col, face] of east ? [[1, -1], [-1, 1]] : [[-1, 1], [1, -1]]) {
    // E3's first desk is its middle one: from the spawn the ray to the north desk passes the teller window right where
    // the queue head stands, and the south desk sits just outside the 45° half-FOV
    for (const k of id === 'E3' && col === 1 ? [POD_Z[1], POD_Z[0], POD_Z[2]] : POD_Z) {
      const i = desks.length;
      const d = F('desk', cx + col * (DESK.d / 2 + 0.01), zc + k, [DESK.w, DESK.h, DESK.d], yawTo(face, 0), { id: `desk:${id}:${i}`, pod, bay: id, m: 1, row: 1 });
      const { agentX } = deskLocal(d);
      const back = DESK.d / 2 + 0.36;
      const ch = local2world(d.pos, d.yaw, agentX, back), st = local2world(d.pos, d.yaw, agentX, back - DESK.sitForward);
      F('chair', ch.x + OX, ch.z + OZ, [0.5, 0.32, 0.5], d.yaw, { id: `chair:${id}:${i}`, solid: false, pod, bay: id });
      desks.push(slot('desk', st.x + OX, st.z + OZ, d.yaw, 'sit', { id: `slot:desk:${id}:${i}`, anchor: d.id, pod, bay: id }).id);
    }
  }
  F('podRug', cx, zc - 0.15, [3.0, 0.01, 4.5], 0, { solid: false, bay: id });
  lamp('pendant', cx, zc - 1.1, 2.25, 3.4, '#FFD9A8', 0.24);
  lamp('pendant', cx, zc + 1.35, 2.25, 3.4, '#FFD9A8', 0.24);
  PODS.push(desks);
  const doorZ = STOREFRONT_Z.find((q) => q[0] === z0)?.[2];
  if (doorZ === undefined) throw new Error(`hq: no storefront for ${id}`);
  BAYS.push({
    id, pod, rect: R(z.rect), side: east ? 'E' : 'W', amenity: AMENITY_OF[id], amenityName: AMENITY_NAME[AMENITY_OF[id]],
    desks, nap: null, amenitySlots: [],
    storefront: P(east ? 8 : 5, doorZ), backDoor: east ? DOORS.find((d) => d.private === id)?.id ?? null : null,
    sign: P(east ? 8.12 : 4.88, doorZ, 2.45), signYaw: frontYaw(east ? -1 : 1, 0),
  });
}
const bay = (id: BayId): Bay => {
  const b = BAYS.find((q) => q.id === id);
  if (!b) throw new Error(`hq: no bay ${id}`);
  return b;
};
/** Amenity slot (and its prop) in a bay. */
const amen = (bid: BayId, tag: string, px: number, pz: number, yaw: number, pose: Slot['pose'] = 'stand', o: SlotOpts = {}) => { const s = slot(tag, px, pz, yaw, pose, { bay: bid, amenity: AMENITY_OF[bid], ...o }); (tag === 'nap' ? (bay(bid).nap = s.id) : bay(bid).amenitySlots.push(s.id)); return s; };
// W1 music room
F('piano', 1.4, 7.72, [1.4, 1.0, 0.5], frontYaw(0, -1), { bay: 'W1' });
amen('W1', 'amenity', 1.4, 7.15, S, 'sit');
F('recordPlayer', 3.7, 7.75, [0.6, 0.8, 0.4], frontYaw(0, -1), { bay: 'W1' });
amen('W1', 'amenity', 3.7, 7.2, S);
F('guitar', 0.45, 2.45, [0.35, 1.0, 0.2], frontYaw(1, 0), { bay: 'W1', solid: false });
amen('W1', 'amenity', 1.0, 2.45, WEST);
F('beanbag', 4.3, 2.55, [0.7, 0.45, 0.7], 0, { bay: 'W1', solid: false });
amen('W1', 'nap', 4.3, 2.55, S, 'lie');
// W2 gym
F('treadmill', 1.3, 8.6, [1.5, 1.1, 0.7], frontYaw(0, 1), { bay: 'W2', solid: false });
amen('W2', 'amenity', 1.3, 8.6, WEST);
F('dumbbells', 3.9, 8.3, [1.0, 0.6, 0.35], frontYaw(0, 1), { bay: 'W2' });
amen('W2', 'amenity', 3.9, 8.85, NORTH);
for (const x of [1.2, 2.4]) { F('yogaMat', x, 14.25, [0.6, 0.02, 1.4], frontYaw(1, 0), { bay: 'W2', solid: false }); amen('W2', 'amenity', x, 14.25, NORTH, 'lie'); }
F('beanbag', 4.3, 14.4, [0.7, 0.45, 0.7], 0, { bay: 'W2', solid: false });
amen('W2', 'nap', 4.3, 14.4, NORTH, 'lie');
// W3 greenhouse
F('planterBox', 1.3, 20.65, [1.6, 0.6, 0.45], frontYaw(0, -1), { bay: 'W3' });
amen('W3', 'amenity', 1.3, 20.1, S);
F('planterBox', 3.3, 20.65, [1.3, 0.6, 0.45], frontYaw(0, -1), { bay: 'W3' });
amen('W3', 'amenity', 3.3, 20.1, S);
F('sunLamp', 0.4, 15.4, [0.4, 1.6, 0.4], 0, { bay: 'W3' });
F('hangingPlant', 2.5, 15.35, [0.5, 0.5, 0.5], 0, { bay: 'W3', solid: false, y: 1.9 });
amen('W3', 'amenity', 2.5, 15.35, NORTH);
F('beanbag', 4.35, 15.5, [0.7, 0.45, 0.7], 0, { bay: 'W3', solid: false });
amen('W3', 'nap', 4.35, 15.5, NORTH, 'lie');
// E1 game room
F('gameTable', 10.3, 7.4, [1.1, 0.45, 0.6], 0, { bay: 'E1' });
amen('E1', 'amenity', 9.45, 7.4, EAST, 'sit');
amen('E1', 'amenity', 11.15, 7.4, WEST, 'sit');
F('shelf', 12.75, 2.25, [1.4, 1.0, 0.35], frontYaw(0, 1), { bay: 'E1' });
F('beanbag', 9.0, 2.55, [0.7, 0.45, 0.7], 0, { bay: 'E1', solid: false });
amen('E1', 'nap', 9.0, 2.55, S, 'lie');
F('plant', 13.45, 7.5, [0.55, 1.1, 0.55], 0, { bay: 'E1' });
// E2 art studio (easels paint the agent's favourite colour)
for (const x of [9.3, 10.75, 12.2]) { F('easel', x, 8.45, [0.6, 1.4, 0.45], frontYaw(0, 1), { bay: 'E2' }); amen('E2', 'amenity', x, 9.0, NORTH); }
F('beanbag', 9.2, 14.3, [0.7, 0.45, 0.7], 0, { bay: 'E2', solid: false });
amen('E2', 'nap', 9.2, 14.3, NORTH, 'lie');
F('shelf', 12.6, 14.65, [1.4, 1.0, 0.35], frontYaw(0, -1), { bay: 'E2' });
// E3 nap lounge (hammocks; the first is the bay's nap spot)
F('hammock', 10.2, 15.45, [2.0, 0.9, 0.6], 0, { bay: 'E3', solid: false });
amen('E3', 'nap', 10.2, 15.45, WEST, 'lie');
F('hammock', 10.2, 20.5, [2.0, 0.9, 0.6], 0, { bay: 'E3', solid: false });
amen('E3', 'amenity', 10.2, 20.5, WEST, 'lie');
F('plant', 13.45, 15.5, [0.55, 1.1, 0.55], 0, { bay: 'E3' });
F('beanbag', 12.9, 20.45, [0.7, 0.45, 0.7], 0, { bay: 'E3', solid: false });
amen('E3', 'amenity', 12.9, 20.45, NORTH, 'lie');

// ---- Lobby: teller-window Help Desk, STAFF mat, rope line, RAM column, fish tank ------------------------------------
// front = customer (atrium) side. [LVL fix r2] 0.62 m (was 0.75): with the queue dais at 0.15 m the queue shows from the
// chest up over it from the spawn (row A 6 m away: the sightline over the top edge passes 0.54 m up)
const COUNTER_H = 0.62;
F('counter', 16.25, 21.2, [2.5, COUNTER_H, 0.6], frontYaw(0, -1), { id: 'counter0' });
F('beacon', 17.2, 21.2, [0.2, 0.3, 0.2], 0, { id: 'beacon0', solid: false, y: COUNTER_H });
F('mat', 16.25, 22.1, [2.5, 0.01, 1.0], 0, { id: 'staffMat', solid: false, color: 'staff' });
slot('staff', 16.25, 22.1, NORTH, 'stand', { id: 'slot:staff:0', anchor: 'counter0' });
for (const [x, w] of [[18.0, 1.0]]) F('planter', x, 21.2, [w, 0.45, 0.4], 0); // on the lobby side of the z21 line (west of the counter the queue lane's rope closes it)
// [LVL fix r1] RAM column on the rope line, 34° right of the spawn view (was (25.5, 23.5), 59° right: outside the 45°
// half-FOV); it reads as the pier under the z21 lintel between the main and east openings
F('ramColumn', RAM[0], RAM[1], [0.7, 3.4, 0.7], 0, { id: 'ramColumn' });
// [LVL fix r1] Lobby coffee cart on the rope line by the Café door (replaces the east planter): the idle loop's coffee
// within the 25 m roaming cap of E3/E2 (the espresso bar is 28+ m away)
F('coffeeCart', 27.2, 21.45, [1.3, 1.0, 0.55], frontYaw(0, 1), { id: 'coffeeCart' });
for (const x of [26.9, 27.5]) slot('coffee', x, 22.25, NORTH);
// [LVL fix r1] the spawn view's foreground (the empty bottom 40 %): a floor medallion in the spine (a decal: the walk
// forward from the spawn stays clear) flanked by two low flower boxes at the spine's edges
// [LVL fix m175 r2] both are `kit` items: ENV's prop-kit rug (bound border, stripe, fringe, floor-AO lip; zones/lobby.ts)
// replaces the flat greybox decals, and the pair shrank from 5 × 2.6 m + a 2.6 m sunburst (≈ 35 % of the spawn frame,
// reviewer art r2) to one 2.8 × 1.6 m rug with a 1.1 m medallion on it, 2.2 m out from the spawn (the `lobbyDesk` camera no longer stands on it)
F('medallion', 20.5, 23.5, [1.1, 0.01, 1.1], 0, { id: 'lobbyMedallion', solid: false, round: true, kit: true });
// [LVL fix r2] the boxes sit 1.4 m further out (x17.15 / 23.85): with the spawn yawed left the west box stood right in
// front of the queue (33° left at 2.6 m, its bushes hid the whole lane); now both frame the lower corners
for (const x of [17.15, 23.85]) F('flowerBox', x, 24.6, [0.5, 0.42, 1.3], 0);
F('fishTank', 26.5, 27.45, [1.6, 1.2, 0.5], frontYaw(0, -1), { id: 'fishTank' });
slot('fish', 26.5, 26.75, S);
F('bench', 23.5, 27.55, [1.8, 0.45, 0.45], frontYaw(0, -1));
F('armchair', 15.4, 27.3, [0.8, 0.7, 0.8], frontYaw(1, -0.3));
F('armchair', 17.4, 27.3, [0.8, 0.7, 0.8], frontYaw(-1, -0.3));
F('coffeeTable', 16.4, 27.25, [0.9, 0.3, 0.6], 0);
F('plant', 14.5, 23.9, [0.6, 1.2, 0.6], 0);
F('plant', 27.5, 27.5, [0.6, 1.2, 0.6], 0);
F('mat', 20.5, 27.45, [3.0, 0.01, 0.9], 0, { id: 'entranceMat', solid: false, color: 'entrance' });
lamp('pendant', 17.5, 24.2, 2.9, 4.0, '#FFD9A8', 0.26);
lamp('pendant', 23.5, 24.8, 2.9, 4.0, '#FFD9A8', 0.26);
lamp('floor', 15.0, 27.4, 1.45, 3.0, '#FFCF94', 0.24);

// ---- queue lane: 10 slots at 1.0 m in a 3-row serpentine, head at the teller window; overflow (6) north of it --------
// [LVL fix r2] The lane was 2 rows × 5 at 0.8 m (x14.4–18.4): the west slots sat 40–44° left of the spawn view (half-HFOV
// 45.7° at 16:9) and neighbours' two-arm waves crossed. Now: 1.0 m pitch, 4 columns (x15.05–18.05) × rows z20.5 / 19.5
// plus two cells of a third row (z18.5), and the spawn yaws 0.22 rad left (`spawn` below): every slot and overflow spot
// is ≤ 30° off the spawn view axis (layout.test.ts projects them, bubbles included, into the 16:9 and 1366×768 frusta).
// The lane is two rects (rows A+B, and row C's two cells) so the E3 back-door apron beside row C stays open floor.
const QUEUE_RECTS = Object.freeze(QUEUE_DAIS.rects.map(R)); // = the dais (floorY.ts: queue members stand 0.15 m up)
export const QUEUE_LANE = Object.freeze(R([14.65, 18.1, 18.4, 20.9])); // bounding rect (director / tools)
QUEUE_DAIS.rects.forEach(([x0, z0, x1, z1], i) => F('dais', (x0 + x1) / 2, (z0 + z1) / 2, [x1 - x0, QUEUE_DAIS.y, z1 - z0], 0, { id: i ? 'queueDaisC' : 'queueDais', solid: false, y: 0 }));
/** Rope runs [x0, z0, x1, z1] (plan) between stanchions: the outline (open at the NE entry cell) + serpentine dividers. */
// [LVL m3 fix r2] the front run (z20.8, 0.1 m off the counter face) is open at the teller window, x15.55–16.55: it ran
// across the served head's face at `serve` and at every walk-up to it (art review m3-r2 h13-5 / pat-b0); the counter
// itself closes that gap (its front is at z20.9) and the lane's nav rect is unchanged
const QUEUE_ROPE_PLAN: Rect[] = [
  [14.65, 20.8, 15.55, 20.8], [16.55, 20.8, 18.4, 20.8], [14.65, 19.0, 14.65, 20.8], [14.65, 19.0, 15.55, 19.0], [15.55, 18.1, 15.55, 19.0],
  [15.55, 18.1, 17.55, 18.1], [18.4, 19.0, 18.4, 20.8], // outline; the entry is the gap at x17.55–18.4 on z19.0
  [16.55, 19.0, 16.55, 20.8], [17.55, 18.1, 17.55, 20.0], [15.55, 20.0, 16.55, 20.0], // dividers
];
const QUEUE_ROPES = Object.freeze(QUEUE_ROPE_PLAN.map(R));
{
  // serpentine (plan): head (16.05, 20.5) faces the window; → west, up, east, up to row C, east, back down to the head
  // row's east end behind the x16.55 divider, then up to the entry cell (18.05, 18.5) at the NE corner
  const Q: [number, number][] = [[16.05, 20.5], [15.05, 20.5], [15.05, 19.5], [16.05, 19.5], [16.05, 18.5], [17.05, 18.5], [17.05, 19.5], [17.05, 20.5], [18.05, 20.5], [18.05, 19.5]];
  Q.forEach(([x, z], i) => {
    const ahead = i ? Q[i - 1] : [x, 21.2];
    const yaw = i === 0 ? S : yawTo(ahead[0] - x, ahead[1] - z);
    slot('queue', x, z, yaw, 'stand', { id: `slot:queue:${i}`, anchor: 'counter0' });
  });
  const posts = new Set<string>();
  for (const [x0, z0, x1, z1] of QUEUE_ROPE_PLAN) for (const [x, z] of [[x0, z0], [x1, z1]]) posts.add(`${x},${z}`);
  for (const k of posts) { const [x, z] = k.split(',').map(Number); F('stanchion', x, z, [0.12, 0.9, 0.12], 0, { solid: false }); }
}
// overflow: 6 spots ≥ 0.95 m apart on a rug north of the lane (clear of the E3 back-door apron and the Pit's top step)
F('rug', 16.45, 17.475, [2.5, 0.01, 1.05], 0, { id: 'overflowRug', solid: false, color: 'queue' });
F('rug', 20.5, 23.5, [2.8, 0.01, 1.6], 0, { id: 'lobbyRug', solid: false, color: 'lobby', kit: true }); // [M1.5] the lobby foreground rug ([LVL fix m175 r2] kit-dressed, see lobbyMedallion)
for (const [x, z] of [[15.6, 17.5], [16.55, 17.5], [17.5, 17.5], [18.45, 17.5], [16.05, 16.55], [17.0, 16.55]]) slot('queueOverflow', x, z, S);

// ---- the Pit: sofa ring (gaps N/S), step seats, beanbags, hearth, Big Board -------------------------------------------
const pitPt = (r: number, deg: number): [number, number] => [PIT.cx + r * Math.sin((deg * Math.PI) / 180), PIT.cz - r * Math.cos((deg * Math.PI) / 180)];
F('hearth', PIT.cx, PIT.cz, [1.4, 0.5, 1.4], 0, { id: 'hearth' });
// [LVL fix r2] seats ≥ 0.95 m apart (were 0.8: three loungers merged into one blob): 1.8 m sofas with seats at ±0.48,
// the six sofas re-spread so the 12 seats sit evenly every 24° (30°–150° and 210°–330°); N/S gaps stay ≥ 1.6 m
for (const deg of [42, 90, 138, 222, 270, 318]) {
  const [x, z] = pitPt(2.35, deg);
  const f = F('sofa', x, z, [1.8, 0.72, 0.7], frontYaw(PIT.cx - x, PIT.cz - z), { zone: 'PIT' });
  for (const off of [-0.48, 0.48]) {
    const p = local2world(f.pos, f.yaw, off, 0.08);
    slot('sofa', p.x + OX, p.z + OZ, yawTo(PIT.cx - p.x - OX, PIT.cz - p.z - OZ), 'sit', { anchor: f.id });
  }
}
for (const deg of [22, 34, 146, 158, 202, 214, 326, 338]) { const [x, z] = pitPt(3.6, deg); slot('pitStep', x, z, yawTo(PIT.cx - x, PIT.cz - z), 'sit'); }
for (const deg of [20, 160, 200, 340]) { const [x, z] = pitPt(1.35, deg); F('beanbag', x, z, [0.7, 0.45, 0.7], 0, { solid: false }); slot('beanbag', x, z, yawTo(PIT.cx - x, PIT.cz - z), 'sit'); }
F('bigBoard', PIT.cx, PIT.cz, [2.4, 1.4, 2.4], 0, { id: 'bigBoard', solid: false, y: 3.3 });
F('rug', PIT.cx, PIT.cz, [5.4, 0.01, 5.4], 0, { id: 'pitRug', solid: false, color: 'pit', round: true });
// floor lamps on the top step behind the sofa arcs (never in the N/S gaps); the Big Board hangs where a pendant would
for (const deg of [90, 270]) { const [x, z] = pitPt(3.05, deg); lamp('floor', x, z, 1.45, 3.4, '#FFCF94', 0.24); }
// [ENV M1.75, cross-owner LVL] the hearth's own warm pool + four dome pendants over the atrium ring, between the
// Board and the walls (fixtures: build/zones/atrium.ts; pools: render/lamps.ts)
lamp('hearth', PIT.cx, PIT.cz, 0.1, 2.4, '#FFB070', 0.26);
for (const deg of [45, 135, 225, 315]) { const [x, z] = pitPt(5.3, deg); lamp('pendant', x, z, 3.4, 4.6, '#FFD9A8', 0.22); }

// ---- Atrium dressing: benches, planters by the arch piers, info board --------------------------------------------------
F('plant', 21.1, 7.5, [0.7, 1.4, 0.7], 0); // [LVL fix r2] 0.6 m east: the arcade cabinet takes the pier's west half
F('plant', 25.6, 7.5, [0.7, 1.2, 0.7], 0);
// [LVL fix r2] hobby picks within 25 m of every E-bay desk (walktimes idle-pick table; §6.4.1 roaming cap):
// an arcade cabinet on the Library's west pier (faces the Pit's north gap) and the ping-pong table in the NE pocket
// between the Pit and the stairs (N-S, so the players stand clear of the Pit rim and the stairs)
F('arcade', 19.95, 7.4, [0.8, 1.6, 0.6], frontYaw(0, 1), { id: 'arcadeAtrium' });
slot('arcade', 19.95, 8.15, NORTH);
F('pingPong', 25.0, 10.6, [0.85, 0.5, 1.5], 0, { id: 'pingPong' }); // [BRN cross-owner] toy scale (0.76 hid the Clawds: rallies, social.ts)
slot('pingpong', 25.0, 9.45, S); slot('pingpong', 25.0, 11.75, NORTH);
F('bench', 14.55, 14.2, [1.6, 0.45, 0.45], frontYaw(1, 0));
// [LVL fix m2 r2] the fern moved from (25.9, 17.6) to the foot of ENV's atrium tree (SE corner), behind the new
// pitOverview stand: it cut the frame's lower-right corner
F('plant', 27.6, 19.7, [0.6, 1.1, 0.6], 0);
F('bench', 25.3, 13.3, [1.6, 0.45, 0.45], frontYaw(-1, 0)); // [LVL fix r2] 0.5 m south: room for the ping-pong player

lamp('floor', 14.6, 15.4, 1.45, 3.0, '#FFCF94', 0.22);

// ---- stairs (open risers, walked as a ramp) + slide (one-way helix) --------------------------------------------------
F('stairs', (STAIRS.x0 + STAIRS.x1) / 2, (STAIRS.zTop + STAIRS.zFoot) / 2, [STAIRS.x1 - STAIRS.x0, MEZZ_Y, STAIRS.zFoot - STAIRS.zTop], 0, { id: 'stairs', solid: false, y: 0 });
export const SLIDE = (() => {
  const c = [SLIDE_X, 8.4], r = 0.9, turns = 1.25;
  const pts: [number, number, number][] = [[SLIDE_X, 6.6, MEZZ_Y + 0.05], [SLIDE_X, 7.0, MEZZ_Y - 0.05]];
  const n = 40;
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = t * turns * Math.PI * 2; // clockwise seen from above, starting north of the centre
    pts.push([c[0] + r * Math.sin(a), c[1] - r * Math.cos(a), MEZZ_Y - 0.25 - t * (MEZZ_Y - 0.25 - 0.45)]);
  }
  pts.push([SLIDE_X + 0.95, 9.2, 0.22], [SLIDE_X + 1.0, 9.6, 0.06]);
  return Object.freeze({
    center: P(c[0], c[1], 0), r, turns, tube: 0.32,
    mouth: P(SLIDE_X, 7.0, MEZZ_Y), exit: P(SLIDE_X + 1.0, 9.6, 0), exitYaw: yawTo(0.45, 1),
    path: pts.map(([x, z, y]) => P(x, z, y)), duration: 2.2,
  });
})();
F('slide', SLIDE_X, 8.4, [2.5, MEZZ_Y, 2.5], 0, { id: 'slide', solid: false, y: 0 });

// ---- Library (under the mezzanine): shelves, reading tables (station), browse spots, ladders -----------------------
F('shelf', 15.6, 0.3, [1.4, 1.25, 0.4], frontYaw(0, 1));
for (const x of [17.3, 23.7, 25.6]) F('shelf', x, 0.3, [1.8, 1.25, 0.4], frontYaw(0, 1));
for (const x of [19.35, 21.65]) F('shelf', x, 0.3, [1.8, 1.25, 0.4], frontYaw(0, 1));
F('shelf', 27.7, 3.2, [1.8, 1.25, 0.4], frontYaw(-1, 0));
F('shelf', 14.3, 5.6, [1.4, 1.25, 0.4], frontYaw(1, 0));
const LIB_ST: string[] = [];
const CAFE_LIB: string[] = [];
for (const [tx, tz] of [[18.3, 3.7], [23.3, 3.7]]) {
  F('readingTable', tx, tz, [1.8, 0.5, 0.8], 0);
  lamp('desk', tx, tz, 0.95, 2.2, '#FFD49A', 0.2);
  for (const [dx, dz, yaw] of [[-0.55, -0.75, S], [0.55, -0.75, S], [0, 0.75, NORTH]]) {
    F('chair', tx + dx, tz + dz + Math.sign(dz) * 0.1, [0.5, 0.32, 0.5], yaw, { solid: false });
    LIB_ST.push(slot('station:library', tx + dx, tz + dz, yaw, 'sit').id);
  }
}
for (const x of [16.4, 26.5]) { F('ladder', x, 0.75, [0.5, 1.8, 0.15], frontYaw(0, 1), { solid: false }); LIB_ST.push(slot('station:library', x, 0.95, NORTH).id); }
// [LVL fix m2 r1] browse spots in front of the 17.3 / 23.7 shelves (were x20.5 / 22.8): the `library` camera now stands
// in the north aisle at x20.5 looking south at the readers' faces (it needs its 1.5 m and the camera well clear)
for (const x of [17.3, 23.7]) slot('library', x, 1.05, NORTH);
F('armchair', 27.2, 5.7, [0.8, 0.7, 0.8], frontYaw(-1, -0.3));
slot('library', 26.4, 5.5, yawTo(-1, 0.3), 'stand');
F('globe', 15.25, 6.2, [0.5, 1.0, 0.5], 0);
// [LVL fix r1] the Library tea trolley by the E1 back door: a coffee pick within the 25 m roaming cap of every E-bay
// desk (E1 3 m, E2/E3 via their back doors and the west arch), so the idle loop's top chill pick is never out of reach
F('coffeeCart', 16.0, 5.1, [1.1, 0.95, 0.5], frontYaw(1, 0), { id: 'teaTrolley' });
for (const z of [4.8, 5.4]) slot('coffee', 16.75, z, WEST);
// [LVL fix r2] Library tea corner by the east arch: a café table + 2 stools (`cafe` picks) ≤ 20 m from every E-bay desk
// (the Café proper is 26–35 m from E1/E2). The §11.5 kiosk spot (atrium east, x24.5–26 z17–20) is the pitOverview
// camera's stand (25, 18.5; [LVL fix m175 r1] was 25.5, 19), so the corner went here, in the `library` camera's frame instead.
{
  const [tx, tz] = [24.9, 5.75];
  F('cafeTable', tx, tz, [0.7, 0.55, 0.7], 0, { round: true, id: 'libCafeTable' });
  for (const dx of [-0.6, 0.6]) { F('stool', tx + dx, tz, [0.4, 0.45, 0.4], 0, { solid: false }); CAFE_LIB.push(slot('cafe', tx + dx, tz, yawTo(-dx, 0), 'sit').id); }
}

// ---- Mezzanine (level 1): Round Table, Observatory, hot desks on the rail -----------------------------------------
const RT = [17.5, 3.1];
F('roundTable', RT[0], RT[1], [2.2, 0.5, 2.2], 0, { id: 'roundTable', level: 1 });
const RT_ST: string[] = [];
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
  const x = RT[0] + Math.sin(a) * 1.55, z = RT[1] - Math.cos(a) * 1.55;
  F('stool', x, z, [0.4, 0.32, 0.4], 0, { level: 1, solid: false });
  RT_ST.push(slot('station:roundtable', x, z, yawTo(RT[0] - x, RT[1] - z), 'sit', { level: 1 }).id);
}
const OBS_ST: string[] = [];
for (const x of [22.6, 24.6, 26.6]) {
  F('telescope', x, 0.75, [0.5, 1.5, 0.5], frontYaw(0, -1), { level: 1 });
  OBS_ST.push(slot('station:observatory', x, 1.45, NORTH, 'stand', { level: 1 }).id);
}
// [LVL fix m175 r2] the star chart hangs on the mezzanine's east wall (it stood at z6.4, in the rail run to the slide)
F('starChart', 27.93, 3.3, [1.4, 0.9, 0.08], frontYaw(-1, 0), { level: 1, solid: false, y: MEZZ_Y + 1.55 });
const HOT: string[] = [];
// [LVL fix m175 r2] the hot desks moved OFF the rail: the rail run (plan z 5.75→7.0, `RAIL_RUN`) is the walk from the
// stair landing to the slide mouth, and the old row (desks z6.72, stools z6.05) put every stool in it (walkers threaded
// the chairs, reviewer play r2). Now one bench row of 8 desks at z5.15 whose sitters (z4.5) face SOUTH across the run
// and over the rail at the atrium: every stool ≥ 1.2 m from the run. x19.6→25.34 (0.82 pitch): clear of the Round
// Table stools (x ≤ 18.93), ≥ 1.5 m from the `mezz` (26.5, 3.5) and `mezzToPit` (19.85, 6.45) cameras.
for (let k = 0; k < 8; k++) {
  const x = 19.6 + k * 0.82;
  F('hotDesk', x, 5.15, [0.8, 0.5, 0.45], frontYaw(0, -1), { level: 1 });
  F('stool', x, 4.5, [0.4, 0.32, 0.4], 0, { level: 1, solid: false });
  HOT.push(slot('hotdesk', x, 4.5, S, 'sit', { level: 1 }).id);
}
F('plant', 14.5, 0.5, [0.6, 1.1, 0.6], 0, { level: 1 });
F('plant', 21.1, 0.5, [0.5, 0.9, 0.5], 0, { level: 1 });
// [LVL fix m175 r2] the stargaze beanbag moved north of the new hot-desk row (was 20.9, 4.6: now the desk bench)
F('beanbag', 21.0, 3.0, [0.7, 0.45, 0.7], 0, { level: 1, solid: false });
slot('stargaze', 21.0, 3.0, NORTH, 'lie', { level: 1 });
lamp('floor', 14.6, 5.3, 1.45, 3.4, '#FFCF94', 0.22, 1);
lamp('floor', 27.55, 5.2, /* [LVL fix m175 r2] out of the rail run (was z5.8) */ 1.45, 3.4, '#FFCF94', 0.22, 1);
lamp('pendant', RT[0], RT[1], 1.9, 3.2, '#FFD9A8', 0.24, 1);

// ---- Reading Alley: book carts, laptop benches (overflow desks) ------------------------------------------------------
for (const [x, n] of [[2.2, 2], [9.9, 2], [12.1, 2]]) {
  F('bench', x, 0.45, [1.6, 0.45, 0.45], frontYaw(0, 1));
  for (let k = 0; k < n; k++) slot('alleyBench', x - 0.4 + k * 0.8, 0.75, S, 'sit');
}
F('bookCart', 4.2, 0.5, [0.9, 0.9, 0.5], frontYaw(0, 1));
F('bookCart', 8.3, 0.5, [0.9, 0.9, 0.5], frontYaw(0, 1));
lamp('pendant', 6.5, 1.0, 2.3, 3.0, '#FFD9A8', 0.22);

// ---- Studio Street: street lamps, benches, planters, banners (non-solid, overhead) ------------------------------------
for (const [x, z] of [[7.7, 3.4], [5.3, 7.6], [7.7, 9.4], [5.3, 14.3], [7.7, 15.6], [5.3, 19.9]]) {
  F('streetLamp', x, z, [0.3, 2.6, 0.3], 0);
  lamp('street', x, z, 2.5, 3.2, '#FFCB8A', 0.26);
}
F('bench', 5.35, 9.1, [1.2, 0.45, 0.45], frontYaw(1, 0));
F('planter', 5.35, 3.45, [0.45, 0.6, 1.0], 0);
F('planter', 5.35, 15.4, [0.45, 0.6, 0.9], 0);
F('planter', 7.65, 19.65, [0.45, 0.6, 0.7], 0);
for (const b of BAYS) F('banner', b.side === 'E' ? 7.85 : 5.15, b.rect[1] + OZ + 0.9, [0.05, 0.9, 0.5], frontYaw(b.side === 'E' ? -1 : 1, 0), { solid: false, y: 2.2, bay: b.id });

// ---- Plaza: phone booths (mcp station), map signpost (unknown agents) --------------------------------------------------
const PHONE_ST: string[] = [];
for (const x of [10.6, 11.6, 12.6]) { F('phoneBooth', x, 23.25, [0.85, 2.0, 0.4], frontYaw(0, -1)); PHONE_ST.push(slot('station:phone', x, 22.75, S).id); }
F('signpost', 6.5, 22.3, [0.3, 2.2, 0.3], 0, { id: 'signpost' });
F('planter', 0.6, 21.6, [0.9, 0.6, 0.9], 0);
F('bench', 5.2, 23.1, [1.4, 0.45, 0.45], frontYaw(0, -1));
lamp('street', 3.0, 22.2, 2.6, 3.4, '#FFCB8A', 0.24);
// [ENV fix m2 r3, cross-owner LVL minimal] garden lanterns + the porch light at the entrance: pools for the south façade
// (review m2 r3 zones22-8: "the two lanterns light nothing"). Kind 'lantern': no greybox fixture (ENV's kit draws the
// lamp posts / wall lanterns, zones/exterior.ts), no rollup neon; POOL_RADIUS default.
for (const x of [18.05, 22.95]) lamp('lantern', x, 29.47, 1.35, 2.4, '#FFCB8A', 0.24);
for (const x of [18.35, 22.65]) lamp('lantern', x, 28.42, 1.5, 2.6, '#FFC27A', 0.3);
lamp('lantern', 20.5, 28.75, 2.25, 3.2, '#FFD39A', 0.28);

// ---- War Room: whiteboards (real todos), table ------------------------------------------------------------------------
const WAR_ST: string[] = [];
for (const x of [1.8, 4.6]) {
  F('whiteboard', x, 27.85, [2.0, 1.0, 0.05], frontYaw(0, -1), { solid: false, y: 0.95 });
  for (const dx of [-0.5, 0.5]) WAR_ST.push(slot('station:war', x + dx, 27.1, S).id);
}
F('meetingTable', 3.2, 25.4, [2.0, 0.55, 0.9], 0);
F('plant', 0.5, 24.0, [0.55, 1.1, 0.55], 0);
lamp('pendant', 3.2, 25.4, 2.25, 3.2, '#FFD9A8', 0.24);

// ---- Lab: benches (test/build station), fume hood (signature), TEST light ----------------------------------------------
const LAB_ST: string[] = [];
// bench 1 along the west wall just inside the plaza door (the street's shortest station hop), bench 2 on the south wall
F('labBench', 6.85, 25.2, [1.8, 0.7, 0.7], frontYaw(1, 0));
for (const dz of [-0.45, 0.45]) LAB_ST.push(slot('station:lab', 7.6, 25.2 + dz, WEST).id);
F('labBench', 11.6, 27.3, [1.8, 0.7, 0.7], frontYaw(0, -1));
for (const dx of [-0.45, 0.45]) LAB_ST.push(slot('station:lab', 11.6 + dx, 26.55, S).id);
F('fumeHood', 6.95, 27.2, [1.1, 1.9, 0.8], frontYaw(1, 0), { id: 'fumeHood' });
F('testLight', 9.2, 27.9, [0.5, 0.5, 0.1], frontYaw(0, -1), { id: 'testLight', solid: false, y: 2.0 });
F('shelf', 13.75, 24.25, [1.4, 1.25, 0.4], frontYaw(-1, 0));
// [RND fix r2, cross-owner LVL] warm white (was cool '#E8F0FF'): the drum glows warm (kit 'shade' class), and at 22 h a
// cool pool on the cool lab read as no pool at all (art review h22-7: "the round table and floor under it get no warm light");
// and hung over ENV's round sample table (zones/lab.ts, 11.5 / 25.05; was 10.3 / 26.0, 1.5 m off), so its pool lands on it
lamp('pendant', 11.5, 25.1, 2.25, 3.6, '#FFE2BC', 0.22);

// ---- Mailroom: pigeonholes, sorting table (git), OUTBOX chute + queue, capsule tube terminus ---------------------------
F('pigeonholes', 30.5, 0.3, [3.4, 1.8, 0.4], frontYaw(0, 1), { id: 'pigeonholes' });
F('sortingTable', 30.5, 4.0, [2.0, 0.6, 0.9], 0);
const MAIL_ST = [slot('station:mail', 30.0, 4.85, NORTH).id, slot('station:mail', 31.0, 4.85, NORTH).id];
F('outboxChute', 32.4, 9.8, [0.8, 1.3, 0.8], frontYaw(-1, 0), { id: 'outboxChute' });
const OUTBOX = [31.55, 30.75, 29.95, 29.15].map((x, i) => slot('outbox', x, 9.8, EAST, 'stand', { id: `slot:outbox:${i}` }).id);
F('capsuleTube', 28.6, 1.4, [0.4, 2.8, 0.4], 0, { id: 'capsuleTube' });
F('parcelStack', 32.4, 1.2, [0.8, 0.8, 0.8], 0);
lamp('pendant', 30.5, 5.5, 2.25, 4.0, '#FFE6C4', 0.22);

// ---- Archive: filing-drawer wall (disk), microfiche (disk I/O), filing nook, vault-door nap corner ---------------------
F('drawerWall', 37.5, 0.3, [7.5, 2.0, 0.5], frontYaw(0, 1), { id: 'drawerWall' });
F('microfiche', 35.0, 3.6, [1.0, 1.1, 0.7], frontYaw(0, 1), { id: 'microfiche' });
slot('microfiche', 35.0, 4.35, NORTH, 'sit');
F('armchair', 40.6, 5.6, [0.8, 0.7, 0.8], frontYaw(-1, 0), { id: 'filingChair' });
slot('filing', 40.6, 5.6, WEST, 'sit', { anchor: 'filingChair' });
lamp('floor', 41.4, 4.6, 1.45, 2.8, '#FFCF94', 0.26);
F('vaultDoor', 41.85, 9.3, [1.4, 1.8, 0.2], frontYaw(-1, 0), { id: 'vaultDoor', solid: false, y: 0.1 });
slot('vaultNap', 40.9, 9.3, WEST, 'lie');
F('mapChest', 37.3, 8.2, [1.8, 0.9, 0.8], frontYaw(0, -1));
slot('archive', 37.3, 7.35, S); // "cataloguing" hobby (sorts the map drawers)
F('crates', 38.7, 2.4, [1.2, 0.8, 0.8], 0.2);
F('crates', 40.9, 2.2, [0.9, 0.6, 0.9], -0.3);
F('plant', 41.5, 0.9, [0.5, 0.9, 0.5], 0);
F('bookCart', 34.6, 6.9, [0.9, 0.9, 0.5], frontYaw(1, 0)); // [LVL fix r1] density: the Archive's west floor was a 2.5 m patch
F('filingCabinet', 33.6, 8.8, [0.6, 1.3, 0.6], frontYaw(1, 0));
F('filingCabinet', 33.6, 9.5, [0.6, 1.3, 0.6], frontYaw(1, 0));
lamp('pendant', 36.5, 5.5, 2.25, 4.0, '#FFE6C4', 0.2);

// ---- Engine Room (+0.25): rack wall (CPU), shell benches in 3 columns facing the glass, rack spots, card table, hamster wheel, boiler ----------
F('rackWall', 41.7, 15.5, [8.0, 2.6, 0.55], frontYaw(-1, 0), { id: 'rackWall' });
// [LVL fix r3] the benches stand in N–S columns and the Shellies sit east of them facing WEST, at the atrium glass (and
// the `engine` pose): visitors see faces, not backs. Slot order = fill order: the first four are the ones the `engine`
// pose frames either side of the card table (layout.test.ts projects them), the rest fill the column ends and a third
// column by the rack spots. The central aisle z14.6–16.4 stays open: glass → card table → rack wall.
const ENG_B: string[] = [];
for (const [x, z] of [[31.4, 14.1], [31.4, 16.9], [35.9, 14.1], [35.9, 17.3], [38.6, 16.1], [38.6, 17.3], [35.9, 12.9], [35.9, 18.5], [31.4, 12.9], [31.4, 18.1]]) {
  F('shellBench', x, z, [1.0, 0.55, 0.6], frontYaw(1, 0), { id: `shellBench${ENG_B.length}`, side: z < 15.5 ? 1 : -1 }); // monitor on the side away from the aisle
  F('chair', x + 0.85, z, [0.5, 0.32, 0.5], WEST, { solid: false });
  ENG_B.push(slot('shellBench', x + 0.75, z, WEST, 'sit', { id: `slot:shellBench:${ENG_B.length}` }).id);
}
const RACK: string[] = [];
for (let i = 0; i < 8; i++) RACK.push(slot('rackSpot', 40.95, 12.0 + i, EAST).id);
F('cardTable', 34.5, 15.7, [1.1, 0.5, 1.1], 0, { round: true });
const CARDS: string[] = [];
for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; const x = 34.5 + Math.sin(a) * 0.9, z = 15.7 - Math.cos(a) * 0.9; F('stool', x, z, [0.4, 0.32, 0.4], 0, { solid: false }); CARDS.push(slot('cards', x, z, yawTo(34.5 - x, 15.7 - z), 'sit').id); }
F('hamsterWheel', 39.5, 12.5, [1.2, 1.3, 0.6], frontYaw(-1, 0), { id: 'hamsterWheel' });
F('plant', 28.6, 15.0, [0.5, 0.9, 0.5], 0, { id: 'engFern' });
slot('plant', 29.2, 15.0, WEST);
lamp('pendant', 32.5, 15.7, 2.6, 4.2, '#D8E6FF', 0.2);
lamp('pendant', 37.8, 15.7, 2.6, 4.2, '#D8E6FF', 0.2);

// ---- Café, arcade, Nap Nook --------------------------------------------------------------------------------------------
F('espressoBar', 35.5, 27.55, [4.0, 1.0, 0.6], frontYaw(0, -1), { id: 'espressoBar' });
for (const x of [34.3, 35.5, 36.7]) slot('coffee', x, 26.8, S);
const CAFE: string[] = [];
for (const [tx, tz, n] of [[31.0, 23.5, 3], [33.2, 24.9, 4], [36.0, 23.4, 3]]) {
  F('cafeTable', tx, tz, [0.8, 0.55, 0.8], 0, { round: true });
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.4;
    const x = tx + Math.sin(a) * 0.75, z = tz - Math.cos(a) * 0.75;
    F('stool', x, z, [0.4, 0.45, 0.4], 0, { solid: false });
    CAFE.push(slot('cafe', x, z, yawTo(tx - x, tz - z), 'sit').id);
  }
}
for (const x of [29.2, 30.3]) { F('arcade', x, 20.45, [0.8, 1.6, 0.6], frontYaw(0, 1)); slot('arcade', x, 21.2, NORTH); }
// [LVL fix r2] the ping-pong table moved to the atrium's NE pocket (below) and a third arcade cabinet stands on the
// Library's west pier: with the Library tea corner's café table they are the E bays' hobby picks within the 25 m roam cap
F('foosball', 40.2, 26.2, [1.2, 0.85, 0.7], 0);
slot('foosball', 40.2, 25.45, S); slot('foosball', 40.2, 26.95, NORTH);
F('plant', 28.5, 27.5, [0.6, 1.2, 0.6], 0);
F('plant', 41.5, 23.5, [0.5, 1.0, 0.5], 0);
const BUNKS: string[] = [];
for (const [x, z, yaw] of [[39.2, 20.5, 0], [41.05, 20.5, 0], [41.55, 22.1, Math.PI / 2]]) {
  F('bunk', x, z, [1.8, 1.6, 0.8], yaw, { solid: false });
  const lo = local2world(P(x, z, 0), yaw, 0, 0);
  BUNKS.push(slot('bunk', lo.x + OX, lo.z + OZ, yaw ? WEST : S, 'lie', { bunk: 'lower' }).id);
  BUNKS.push(slot('bunk', lo.x + OX, lo.z + OZ, yaw ? WEST : S, 'lie', { bunk: 'upper', lift: 1.0 }).id);
}
lamp('pendant', 30.5, 24.5, 2.3, 3.8, '#FFD9A8', 0.26);
lamp('pendant', 34.5, 24.0, 2.3, 3.8, '#FFD9A8', 0.26);
lamp('pendant', 39.5, 26.0, 2.3, 3.4, '#FFD9A8', 0.24);
lamp('floor', 38.35, 21.35, 1.2, 2.2, '#FFB978', 0.2);

// ================================================================================================= derived tables
/** Station registry (§6.5): class → station, its slots and capacity. */
const STATION_DEFS: Omit<Station, 'cap'>[] = [
  { id: 'library', zone: 'LIB', level: 0, cls: ['read', 'search'], slots: LIB_ST },
  { id: 'lab', zone: 'LAB', level: 0, cls: ['test', 'build'], slots: LAB_ST },
  { id: 'war', zone: 'WAR', level: 0, cls: ['todo', 'think'], slots: WAR_ST },
  { id: 'phones', zone: 'PLZ', level: 0, cls: ['mcp'], slots: PHONE_ST },
  { id: 'mail', zone: 'MAIL', level: 0, cls: ['git'], slots: MAIL_ST, queue: OUTBOX },
  { id: 'observatory', zone: 'MEZ', level: 1, cls: ['web'], slots: OBS_ST },
  { id: 'roundtable', zone: 'MEZ', level: 1, cls: ['task'], slots: RT_ST },
];
const STATIONS: readonly Station[] = Object.freeze(STATION_DEFS.map((s) => Object.freeze({ ...s, cap: s.slots.length, slots: Object.freeze(s.slots) })));

const AMENITIES: readonly Amenity[] = Object.freeze(([
  ...BAYS.map((b) => ({ id: b.amenity, bay: b.id, name: b.amenityName, slots: b.amenitySlots, nap: b.nap })),
  { id: 'cafe', zone: 'CAF', slots: CAFE }, { id: 'teaCorner', zone: 'LIB', slots: CAFE_LIB }, { id: 'coffee', zone: 'CAF', slots: SLOTS.filter((s) => s.tag === 'coffee').map((s) => s.id) },
  { id: 'arcade', zone: 'CAF', slots: SLOTS.filter((s) => s.tag === 'arcade').map((s) => s.id) },
  { id: 'pingpong', zone: 'ATR', slots: SLOTS.filter((s) => s.tag === 'pingpong').map((s) => s.id) },
  { id: 'foosball', zone: 'CAF', slots: SLOTS.filter((s) => s.tag === 'foosball').map((s) => s.id) },
  { id: 'napNook', zone: 'NAP', slots: BUNKS },
  { id: 'cards', zone: 'ENG', slots: CARDS },
  { id: 'hotdesks', zone: 'MEZ', slots: HOT },
] satisfies Amenity[]).map((a) => Object.freeze(a)));

const SOUTH_GAP: [number, number] = [20.5, 18.4];
const pitSeats = SLOTS.filter((s) => ['sofa', 'pitStep', 'beanbag'].includes(s.tag))
  .sort((a, b) => Math.hypot(a.pos.x + OX - SOUTH_GAP[0], a.pos.z + OZ - SOUTH_GAP[1]) - Math.hypot(b.pos.x + OX - SOUTH_GAP[0], b.pos.z + OZ - SOUTH_GAP[1]))
  .map((s) => s.id);

/** §7.1 keep-clear rects (world): the named ones + every door's ±0.8 m apron. */
interface KeepClear { id: string; rect: Rect; headSlotOnly?: boolean }
const KEEP_CLEAR = Object.freeze(([
  { id: 'E3-apron', rect: R([14, 16.6, 15.45, 18.9]) }, // [LVL fix r2] 1.45 m out (was 1.8 × to z19.0): the queue's row C starts at x15.55, rows A/B at z19.0
  { id: 'main-corridor', rect: R([18.5, 18.3, 22.5, 23.0]) },
  { id: 'east-opening', rect: R([24.5, 20, 26.5, 22]) },
  { id: 'teller-approach', rect: R([15, 20.9, 17.5, 21.0]), headSlotOnly: true },
  ...DOORS.map((d) => ({ id: `door:${d.id}`, rect: d.rect })),
] satisfies KeepClear[]).map((k): Readonly<KeepClear> => Object.freeze(k)));

/**
 * Circulation lanes (§7.1 density: lanes 1.4–2.0 m wide, the atrium ring ≤ 2.5 m); the density check skips them. World.
 * [LVL fix r1] widths capped per §7.1 (the lobby spine was 4 m, the ENG and Mailroom aisles 3 m), and the atrium ring is
 * an ANNULUS round the Pit (r 4.0 → 6.3, 2.3 m), no longer a filled disc that exempted the whole Pit and most of the
 * atrium. layout.test.ts asserts the widths.
 */
const LANES: readonly Lane[] = Object.freeze(([
  { id: 'street', rect: R([5.5, 2, 7.5, 21]) }, { id: 'alley', rect: R([0, 0.9, 14, 2]) }, { id: 'plaza', rect: R([0, 21, 14, 22.5]) },
  { id: 'atriumRing', annulus: [PIT.cx - OX, PIT.cz - OZ, 4.0, 6.3] }, { id: 'atriumNorth', rect: R([14, 7.8, 28, 9.6]) },
  { id: 'atriumEast', rect: R([24.3, 7, 26.3, 21]) }, { id: 'atriumWest', rect: R([14, 9.5, 15.9, 19.3]) },
  { id: 'lobbySpine', rect: R([19.5, 21, 21.5, 28]) }, { id: 'lobbyCross', rect: R([14, 22.8, 28, 24.4]) },
  { id: 'engAisle', rect: R([28, 14.7, 42, 16.7]) }, { id: 'cafeAisle', rect: R([28, 22.4, 38, 23.4]) },
  { id: 'mailAisle', rect: R([28, 6.3, 33, 8.3]) }, { id: 'archiveAisle', rect: R([33, 4, 42, 5.4]) },
  { id: 'libraryAisle', rect: R([14, 1.6, 28, 2.4]) }, { id: 'mezzWalk', rect: R(RAIL_RUN), level: 1 },
] satisfies Lane[]).map((l) => Object.freeze(l)));

const POINTS = Object.freeze<HqLayout['points']>({
  spawn: P(20.5, 26.5), entrance: P(20.5, 27.4), door: P(20.5, 27.4),
  helpDesk: P(16.25, 21.2), staffMat: P(16.25, 22.1), tellerWindow: P(16.4, 20.9), bell: P(16.9, 21.2, COUNTER_H + 0.05),
  queue: SLOTS.filter((s) => s.tag === 'queue').map((s) => ({ x: s.pos.x, z: s.pos.z })),
  queueEntry: P(18.05, 18.5), queueOverflow: SLOTS.filter((s) => s.tag === 'queueOverflow').map((s) => ({ x: s.pos.x, z: s.pos.z })),
  pitCenter: P(PIT.cx, PIT.cz), pitSouthGap: P(...SOUTH_GAP), pitNorthGap: P(20.5, 9.6), pitSeats,
  stairsFoot: P(27.15, 17.1), stairsTop: P(27.15, 9.0, MEZZ_Y), slideMouth: SLIDE.mouth, slideExit: SLIDE.exit,
  bigBoard: P(PIT.cx, PIT.cz, 4.0), ramColumn: P(...RAM), fishTank: P(26.5, 27.45), signpost: P(6.5, 22.3),
  outbox: P(32.4, 9.8), serveCamera: P(16.25, 22.1),
  /** overflow spiral anchors (§6.4.4) */
  overflow: { desks: P(20.5, 4.5, MEZZ_Y), alley: P(6.5, 1.0), library: P(21, 5.3), eng: P(34.5, 15.7), pit: P(PIT.cx, PIT.cz), atrium: P(22.5, 9.5), queue: P(16.5, 17.3) },
  /** a representative walkable point per zone (walktimes, minimap labels) */
  zone: {
    LOB: P(22.5, 24.5), PIT: P(20.5, 12.0), ATR: P(23.5, 9.5), LIB: P(21, 5.3), MEZ: PL(21.5, 3.5, 1), NAL: P(6.5, 1.0),
    STR: P(6.5, 11.5), W1: P(3.8, 5), W2: P(3.8, 11.5), W3: P(3.8, 18), E1: P(9.2, 5), E2: P(9.2, 11.5), E3: P(9.2, 18),
    PLZ: P(8.0, 22.3), WAR: P(3.2, 24.3), LAB: P(10.3, 25.2), MAIL: P(30.5, 7.0), ARC: P(37.5, 6.0), ENG: P(33.5, 15.8),
    NAP: P(39.8, 21.8), CAF: P(33.5, 25.5),
  },
});

const STAT_ANCHORS: readonly StatAnchor[] = Object.freeze(([
  { id: 'cpuRack', kind: 'stat:cpu', pos: P(41.8, 15.5, 1.3), yaw: frontYaw(-1, 0), span: R([41.8, 11.5, 41.8, 19.5]) },
  { id: 'boiler', kind: 'stat:cpuTotal', pos: P(28, 13, 2.0), yaw: frontYaw(-1, 0) },
  { id: 'ramColumn', kind: 'stat:ram', pos: P(...RAM, 0), yaw: 0 },
  { id: 'drawers', kind: 'stat:disk', pos: P(37.5, 0.55, 1.0), yaw: frontYaw(0, 1) },
  { id: 'microfiche', kind: 'stat:diskIO', pos: P(35.0, 3.6, 1.1), yaw: frontYaw(0, 1) },
  { id: 'nvmeThermo', kind: 'stat:nvmeTemp', pos: P(41.75, 9.3, 1.4), yaw: frontYaw(-1, 0) },
  { id: 'hamster', kind: 'stat:gpu', pos: P(39.5, 12.5, 0.25), yaw: frontYaw(-1, 0) },
  { id: 'hiScore', kind: 'stat:vram', pos: P(30, 21, 1.6), yaw: frontYaw(0, 1) },
  { id: 'thermostat', kind: 'stat:cpuTemp', pos: P(28.3, 17.2, 1.4), yaw: frontYaw(1, 0) },
  { id: 'mast', kind: 'stat:net', pos: P(24.5, 1.5, 7.5), yaw: 0 },
  { id: 'cableTray', kind: 'stat:netPulse', pos: P(21, 7.2, 5.2), yaw: 0, span: R([14.5, 7.2, 27.5, 7.2]) },
  { id: 'uptime', kind: 'stat:uptime', pos: P(28.1, 19.6, 2.0), yaw: frontYaw(-1, 0) },
  { id: 'clock', kind: 'stat:clock', pos: P(20.5, 27.85, 2.75), yaw: frontYaw(0, -1) },
  { id: 'bigBoard', kind: 'stat:summary', pos: P(PIT.cx, PIT.cz, 4.0), yaw: Math.PI, size: [2.4, 1.4] },
  { id: 'fans', kind: 'stat:load', pos: P(20.5, 14, 5.3), yaw: 0 },
  { id: 'skylight', kind: 'stat:weather', pos: P(20.5, 14, 5.5), yaw: 0 },
] satisfies StatAnchor[]).map((a) => Object.freeze(a)));

/** Gobo windows (§5.6): the first 4 are used; people-height, level-0, facing the most-viewed zones first. */
const WINDOWS: WindowRect[] = [];
for (const w of WALLS) {
  const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  const ux = (w.b[0] - w.a[0]) / len, uz = (w.b[1] - w.a[1]) / len;
  for (const o of w.openings ?? []) {
    if (o.kind !== 'window' && o.kind !== 'highWindow') continue;
    const s = o.at + o.w / 2;
    const cx = w.a[0] + ux * s, cz = w.a[1] + uz * s;
    // inward normal: toward the building centre (all window walls are exterior)
    let nx = -uz, nz = ux;
    if (nx * -cx + nz * -cz < 0) { nx = -nx; nz = -nz; }
    WINDOWS.push({ center: { x: cx, y: (w.y0 ?? 0) + o.sill + o.h / 2, z: cz }, normal: { x: nx, y: 0, z: nz }, w: o.w, h: o.h, zone: zoneAtPlan(cx + OX + nx * 0.5, cz + OZ + nz * 0.5), kind: o.kind });
  }
}
const GOBO_ORDER: (string | null | undefined)[] = ['LIB', 'CAF', 'W2', 'LOB', 'ARC'];
WINDOWS.sort((a, b) => ((GOBO_ORDER.indexOf(a.zone) + 99) % 99) - ((GOBO_ORDER.indexOf(b.zone) + 99) % 99) || b.w * b.h - a.w * a.h);
export const SKYLIGHT = Object.freeze({ rect: R([17.5, 11, 23.5, 17]), y: 5.5 });

// ---- nav levels + portals (§6.6) -------------------------------------------------------------------------------------
/** [LVL fix m2 r1] camera wells, plan → world. eBayGlass: its stand on the Pit's west step + the rim lane in front of it
 *  (walkers take the 1.9 m strip by the glazing, ≥ 1.7 m from the lens, legs behind the rim); library: the north-aisle
 *  stand (walkers go round by the rug); lab: the NE-corner stand by the coat rack. */
const CAMERA_WELLS = Object.freeze<NonNullable<NavLevel["cameraWells"]>[number][]>([
  { circle: [17.45 - OX, 12.8 - OZ, 0.5] }, { rect: R([15.9, 12.2, 17.3, 13.4]) },
  { rect: R([19.7, 0.55, 21.3, 2.3]) },
  { rect: R([12.2, 23.6, 13.5, 24.9]) },
  // [LVL fix m2 r2] street: the lens hugs the WEST facade at the street's south end (plan 5.85, 19.7, just ahead of the last street lamp: pole and basket stay out of frame); the well covers
  // that facade strip from the W3 storefront to the plaza (x5.25–6.2), so walkers keep to the east 1.55 m of the street
  // and no stander lands in the lens's near field (an unknown 1 m off filled the h18 frame, gameplay m2-r2). West, not
  // east: the E-bay → Lab/Lobby routes cut the east corner (an east well cost +0.3 s on the 13.5 s Lab bound)
  { rect: R([5.25, 19.25, 6.2, 20.75]) },
]);
const LEVELS: readonly NavLevel[] = Object.freeze([
  Object.freeze<NavLevel>({
    id: 0, y: 0,
    // blocked extras on the ground: the high end of the stairs (no headroom), the slide helix, the Pit hearth is furniture
    block: [{ rect: R([STAIRS.x0, STAIRS.zTop, STAIRS.x1, 12.5]) }, { circle: [SLIDE.center.x, SLIDE.center.z, 1.25] },
      { seg: R([STAIRS.x0, STAIRS.zTop, STAIRS.x0, STAIRS.zFoot]) }],
    /** the queue lane's rope footprint (one or more rects) is solid for everyone except queue members */
    queueLane: QUEUE_RECTS,
    /** [LVL fix m2 r1] review-camera wells (§9.2): solid for agents, open for the player (nav/grid.ts) — no walker passes
     *  and no wanderer stands within ~1.5 m in front of these lenses (eBayGlass: a passing hat filled the h18 frame) */
    cameraWells: CAMERA_WELLS,
  }),
  Object.freeze<NavLevel>({
    id: 1, y: MEZZ_Y,
    open: [...MEZZ_RECTS.map(R), R([STAIRS.x0, STAIRS.zTop, STAIRS.x1, 14.0])],
    block: [{ seg: R([STAIRS.x0, STAIRS.zTop, STAIRS.x0, 14.0]) }],
  }),
]);
const PORTALS: readonly Portal[] = Object.freeze([
  Object.freeze<Portal>({ id: 'stairs', a: { ...P(27.15, 17.1), level: 0 }, b: { ...P(27.15, 9.0, MEZZ_Y), level: 1 }, twoWay: true, len: Math.hypot(8.1, MEZZ_Y), path: [P(27.15, 17.1, 0), P(27.15, 16.5, 0), P(27.15, 9.5, MEZZ_Y), P(27.15, 9.0, MEZZ_Y)] }),
  Object.freeze<Portal>({ id: 'slide', a: { ...P(SLIDE_X, 6.5, MEZZ_Y), level: 1 }, b: { ...P(SLIDE_X + 1.15, 9.95, 0), level: 0 }, twoWay: false, len: SLIDE.duration * 2.8, time: SLIDE.duration, path: SLIDE.path }),
]);

// ---- zones / vis cells (world) ----------------------------------------------------------------------------------------
const ZONES: readonly Zone[] = Object.freeze(ZONE_DEFS.map((z): Zone => Object.freeze({ id: z.id, name: z.name, rect: R(z.rect), level: z.level ?? 0, floor: z.floor, ceil: z.ceil, ...(z.circle ? { circle: [z.circle[0] - OX, z.circle[1] - OZ, z.circle[2]] satisfies Circle } : {}) })));
/**
 * Vis cells (§5.3, [LVL fix r1]): one per zone. `visible` is the hand-authored set of cells a camera in this cell can
 * see; drafted from `sampleVisibility` (vis.ts: eye-height rays through every see-through opening; `walktimes --vis`)
 * and checked against it in layout.test.ts (the table must be a superset). The greybox is very open (glazed E bays and
 * ENG, open doorways, the atrium), so most cells see most of the office: the per-cell groups mostly pay off through
 * frustum culling (`region`: the arch merge group, a few adjacent cells) and the small-prop draw distance.
 */
const VIS_CELLS = ZONES.map((z) => z.id);
const ALL_BUT = (...ids: string[]) => VIS_CELLS.filter((c) => !ids.includes(c));
const VIS_TABLE: Record<string, string[]> = {
  LOB: VIS_CELLS,
  PIT: ALL_BUT('NAP'),
  ATR: ALL_BUT('NAP'),
  LIB: ALL_BUT('ARC', 'NAP'),
  NAL: ALL_BUT('WAR', 'ARC', 'NAP'),
  STR: ALL_BUT('NAP'),
  W1: ALL_BUT('W2', 'W3', 'WAR', 'MAIL', 'ARC', 'NAP'),
  W2: ALL_BUT('W1', 'W3', 'WAR', 'NAP'),
  W3: ALL_BUT('W1', 'W2', 'WAR', 'NAP'),
  E1: ALL_BUT('E2', 'E3', 'WAR', 'LAB', 'ARC', 'NAP'),
  E2: ALL_BUT('E1', 'E3', 'WAR', 'NAP'),
  E3: ALL_BUT('E1', 'E2', 'NAP'),
  PLZ: ALL_BUT('NAP'),
  WAR: ALL_BUT('NAL', 'W1', 'W2', 'W3', 'E1', 'E2', 'LAB', 'NAP', 'CAF'),
  LAB: ALL_BUT('WAR'),
  MAIL: ALL_BUT('W1', 'NAP', 'CAF'),
  ARC: ALL_BUT('LIB', 'NAL', 'W1', 'E1', 'NAP'),
  ENG: ALL_BUT('NAP'),
  NAP: ['NAP', 'CAF', 'LOB', 'LAB'],
  CAF: ALL_BUT('MAIL'),
  MEZ: ALL_BUT('NAP'),
};
const VIS_REGION: Record<string, string> = {
  W1: 'west', W2: 'west', W3: 'west', STR: 'west', NAL: 'west', PLZ: 'south', WAR: 'south', LAB: 'south',
  E1: 'ebays', E2: 'ebays', E3: 'ebays', LOB: 'core', ATR: 'core', PIT: 'core', LIB: 'lib', MEZ: 'mez',
  MAIL: 'ne', ARC: 'ne', ENG: 'eng', CAF: 'caf', NAP: 'caf',
};
const VIS = ZONES.map((z) => Object.freeze({ id: z.id, rect: z.rect, level: z.level, region: VIS_REGION[z.id] ?? z.id, visible: Object.freeze([...(VIS_TABLE[z.id] ?? VIS_CELLS)]) }));

/** [LVL fix r2] The spawn looks 0.22 rad (12.6°) left of the main axis: the whole queue lane + overflow sit ≤ 30° off the
 *  view axis (they were 40–44° left at yaw 0), the E-bay glazing moves toward the centre, and the RAM column stays in
 *  frame (39° right of the axis, half-HFOV 45.7° at 16:9). */
export const SPAWN_YAW = 0.22;
const spawn: HqLayout['spawn'] = [0, 0, 12.5, SPAWN_YAW, -0.05];
/**
 * [BRN fix r1, cross-owner: LVL] Authored viewpoints the brain keeps clear (§9.2 cameras + the spawn; world x, z, level,
 * yaw). Mirrors the hq poses of debug/poses.ts (sync: chars/brain/directorHq.test.ts) so live behaviour never depends
 * on the debug table.
 */
const V = (id: string, x: number, z: number, yaw: number, level = 0) => Object.freeze({ id, x, z, level, yaw });
const KEEP_CLEAR_VIEWS = Object.freeze([
  V('spawn', 0, 12.5, SPAWN_YAW), V('pitOverview', 6.0, 6.0, 0.785), V('eBayGlass', -2.85, -1.2, 1.571), V('street', -14.65, 5.7, -0.04),
  V('lobbyDesk', 0.5, 11, 0.73), V('serve', -4.35, 8.5, 0) /* [BRN fix m2-r1, cross-owner] = poses.ts serve; [LVL m3 fix r2] eye 2.1 m leaning over the counter, head 2.0 m off */, V('library', 0, -13.15, Math.PI), V('lab', -7.6, 10.35, 2.2),
  V('mezz', 6, -10.5, 1.571, 1), V('mezzToPit', -0.65, -7.32, Math.PI, 1), V('engine', 9, 1.5, -1.571), V('cafe', 9.5, 12.5, -1.2) /* [ENV fix m2 r1, cross-owner] = poses.ts cafe (yaw −0.968 → −1.2: the espresso bar in frame) */,
]);

export { ZONES, WALLS, DOORS, FURNITURE, SLOTS, STATIONS, BAYS, AMENITIES, WINDOWS, STAT_ANCHORS, POINTS, VIS, LEVELS, PORTALS, KEEP_CLEAR, LAMPS, LANES };

export const layout: HqLayout = Object.freeze<HqLayout>({
  id: 'hq',
  bounds: { minX: 0 - OX, maxX: 42 - OX, minZ: 0 - OZ, maxZ: 28 - OZ },
  height: 2.8,
  walls: WALLS,
  furniture: FURNITURE,
  slots: SLOTS,
  pods: PODS,
  zones: ZONES,
  visCells: VIS,
  anchors: [...STAT_ANCHORS.map((a) => ({ id: a.id, pos: a.pos, kind: a.kind })), ...LAMPS.map((l) => ({ id: l.id, pos: l.pos, kind: `lamp:${l.kind}` }))],
  lamps: LAMPS,
  windows: WINDOWS,
  points: POINTS,
  doors: DOORS,
  stations: STATIONS,
  bays: BAYS,
  amenities: AMENITIES,
  statAnchors: STAT_ANCHORS,
  keepClear: KEEP_CLEAR.map((k) => ({ id: k.id, x0: k.rect[0], z0: k.rect[1], x1: k.rect[2], z1: k.rect[3], headSlotOnly: !!k.headSlotOnly })),
  levels: LEVELS,
  lanes: LANES,
  portals: PORTALS,
  slide: SLIDE,
  stairs: { ...STAIRS, rect: R([STAIRS.x0, STAIRS.zTop, STAIRS.x1, STAIRS.zFoot]) },
  skylight: SKYLIGHT,
  queueLane: QUEUE_LANE,
  /** [LVL fix r2] the lane as nav sees it (rects) and its rope runs [x0, z0, x1, z1] (world; greybox draws them) */
  queueRects: QUEUE_RECTS,
  queueRopes: QUEUE_ROPES,
  probeSpot: { x: 24.2 - OX, z: 25.3 - OZ },
  spawn,
  keepClearViews: KEEP_CLEAR_VIEWS,
  floorY,
  floorAt,
  zoneAt: (x: number, z: number, level = 0) => zoneAtPlan(x + OX, z + OZ, level),
  /** helpers for tools (walktimes --ascii, greybox): plan-space accessors */
  plan: { zoneAt: zoneAtPlan, groundY, stairsY, onMezz, ZONE_DEFS, PIT, STAIRS, MEZZ_RECTS },
});
