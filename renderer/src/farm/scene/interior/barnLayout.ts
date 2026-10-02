/**
 * The barn interior's floor plan (pure: no three, no DOM; tested in barn.test.ts). Barn-local metres, the same frame
 * as `BARN` in scene/structures/landmarks.ts: the big door is on the front (+z) wall, the stone foundation's top is
 * the floor (y = 0.3). The shell is 10 × 8.4 m with 4.2 m walls under a gambrel roof (knees at ±3.9 / 6.4 m, ridge
 * 7.8 m); the room fills it less 18 cm of wall.
 *
 *              back (north)
 *   ┌──────────────── hay loft (2.6 m up) ───────────────┐
 *   │ cow stall    hay pile          coop: roost, nests  │
 *   │ (Daisy)      ladder ⟋                              │
 *   │ donkey stall    aisle          sheep pen           │
 *   │ (Pepper)                       grain bin           │
 *   │ workbench, tool wall, Mochi's bale   machine room  │  ← the thermometer's inside face, brass dials
 *   └──────────────────── big door ──────────────────────┘
 *              front (south)
 */

export const BARN_ROOM = Object.freeze({
  /** inner wall faces */
  x0: -4.82, x1: 4.82, z0: -4.02, z1: 4.02,
  /** floor (top of the foundation), the walls' top (eaves), the knees and the ridge (inner faces, a little under the roof) */
  floor: 0.3, wallTop: 4.2, kneeX: 3.75, kneeY: 6.25, ridge: 7.62,
  wall: 0.18,
});

/** the hay loft: a deck across the back, reached by the ladder */
export const LOFT = Object.freeze({ y: BARN_ROOM.floor + 2.6, z0: BARN_ROOM.z0, z1: -1.3, th: 0.16 });
/** the loft ladder: in the aisle, its foot at z1, leaning up to the loft edge at z0 */
export const LADDER = Object.freeze({ x: 1.0, w: 0.9, z0: LOFT.z1, z1: 0.75 });
/** the big front door (inside: closed, light leaking round it) */
export const BIG_DOOR = Object.freeze({ x: 0, w: 3.8, h: 3.7 });

export interface BarnOpening { id: string; wall: 'east' | 'west' | 'front'; /** along the wall (z for east/west, x for front) */ at: number; y: number; w: number; h: number }
/** openings that let daylight in (matching the shell's side windows and the hayloft door): shutters ajar */
export const OPENINGS: readonly BarnOpening[] = Object.freeze([
  { id: 'eastBack', wall: 'east', at: -2.2, y: 2.2, w: 1.2, h: 1.1 },
  { id: 'eastFront', wall: 'east', at: 1.6, y: 2.2, w: 1.2, h: 1.1 },
  { id: 'westBack', wall: 'west', at: -2.2, y: 2.2, w: 1.2, h: 1.1 },
  { id: 'westFront', wall: 'west', at: 1.6, y: 2.2, w: 1.2, h: 1.1 },
  { id: 'hayDoor', wall: 'front', at: 0, y: 5.2, w: 1.6, h: 1.4 },
]);

/** Furniture and animal anchors (local x, z; yaw = which way it faces, 0 = +z). Builders and colliders read these. */
export const B = Object.freeze({
  /** the two stalls on the west side, open to the aisle at x = stallX1 */
  stallX1: -1.55,
  cowStall: { z0: BARN_ROOM.z0, z1: -1.3 },
  donkeyStall: { z0: -1.3, z1: 1.45 },
  cow: { x: -3.25, z: -2.62, yaw: Math.PI / 2 },
  donkey: { x: -3.15, z: 0.05, yaw: Math.PI / 2 },
  /** mangers along the stall fronts */
  manger: { x: -1.95, w: 0.5 },
  /** the coop (back east): roost bars, three nest boxes on the east wall */
  coop: { x0: 1.65, z0: BARN_ROOM.z0, z1: -1.75 },
  roost: [{ x: 2.9, z: -3.55, y: 1.05 }, { x: 2.9, z: -3.05, y: 0.75 }, { x: 2.9, z: -2.55, y: 0.45 }] as readonly { x: number; z: number; y: number }[],
  roostLen: 1.9,
  nests: [{ z: -3.55 }, { z: -2.95 }, { z: -2.35 }] as readonly { z: number }[],
  nestX: 4.52, nestY: 0.62,
  /** the sheep pen (middle east) */
  pen: { x0: 1.65, z0: -1.45, z1: 1.55 },
  sheep: [{ x: 3.3, z: -0.55, yaw: -2.2 }, { x: 3.85, z: 0.75, yaw: -1.3 }] as readonly { x: number; z: number; yaw: number }[],
  trough: { x: 1.95, z: 0.05 },
  grain: { x: 1.98, z: 1.96 },
  /** the machine room: a panel desk along the front wall, the thermometer's inside face above it */
  panel: { x: 3.55, z: 3.72, w: 2.2, d: 0.55 },
  thermo: { x: 3.75, y: 2.35 },
  stool: { x: 3.4, z: 3.0 },
  /** west front: the workbench under the tool wall, Mochi's hay bales */
  bench: { x: -4.4, z: 2.75, w: 0.8, d: 1.9 },
  bales: { x: -2.5, z: 3.2 },
  hay: { x: -0.35, z: -3.32 },
  /** the milking stool and pail, at the end of the cow's stall */
  stoolPail: { x: -1.25, z: -3.6 },
  /** the loft's hay stack and the pile you can flop into */
  loftHay: { x: -2.7, z: -2.9 },
  loftPile: { x: 2.6, z: -2.6 },
});

export type Level = 'lo' | 'hi';
/** a footprint: lo = ground floor only, hi = loft only, both when unset */
export type BarnSolid = ({ kind: 'rect'; x: number; z: number; w: number; d: number } | { kind: 'circle'; x: number; z: number; r: number }) & { lvl?: Level };
const R = (x0: number, x1: number, z0: number, z1: number, lvl?: Level): BarnSolid => ({ kind: 'rect', x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, lvl });
const C = (x: number, z: number, r: number, lvl?: Level): BarnSolid => ({ kind: 'circle', x, z, r, lvl });

const { x0, x1, z0, z1 } = BARN_ROOM;
/** feet above this (local y) count as up on the loft; below LO_MAX as on the ground floor */
export const HI_MIN = BARN_ROOM.floor + 1.5, LO_MAX = BARN_ROOM.floor + 0.9;

export const BARN_SOLIDS: readonly BarnSolid[] = Object.freeze([
  // ground floor
  R(x0, B.stallX1, z0, B.donkeyStall.z1, 'lo'),                     // both stalls (rails, mangers, the animals)
  R(B.coop.x0, x1, z0, B.coop.z1, 'lo'),                             // the coop
  R(B.pen.x0, x1, B.pen.z0, B.pen.z1, 'lo'),                         // the sheep pen
  C(B.grain.x, B.grain.z, 0.36, 'lo'),
  R(B.panel.x - B.panel.w / 2, x1, B.panel.z - B.panel.d / 2, z1, 'lo'),
  C(B.stool.x, B.stool.z, 0.2, 'lo'),
  R(x0, x0 + B.bench.w, B.bench.z - B.bench.d / 2, B.bench.z + B.bench.d / 2, 'lo'),
  R(B.bales.x - 0.65, B.bales.x + 0.65, B.bales.z - 0.45, B.bales.z + 0.45, 'lo'),
  C(B.hay.x, B.hay.z, 0.62, 'lo'),
  C(B.stoolPail.x, B.stoolPail.z, 0.3, 'lo'),
  // the ladder: rails both sides (any height), and nothing walks under it
  R(LADDER.x - LADDER.w / 2 - 0.06, LADDER.x - LADDER.w / 2, LADDER.z0, LADDER.z1 - 0.15),
  R(LADDER.x + LADDER.w / 2, LADDER.x + LADDER.w / 2 + 0.06, LADDER.z0, LADDER.z1 - 0.15),
  R(LADDER.x - LADDER.w / 2, LADDER.x + LADDER.w / 2, LADDER.z0 - 0.05, -0.45, 'lo'),
  // the loft: a rail along its edge (open at the ladder), the hay stacked up there
  R(x0, LADDER.x - LADDER.w / 2, LOFT.z1 - 0.1, LOFT.z1, 'hi'),
  R(LADDER.x + LADDER.w / 2, x1, LOFT.z1 - 0.1, LOFT.z1, 'hi'),
  R(x0, x0 + 2.6, z0, z0 + 1.35, 'hi'),
  C(B.loftHay.x + 0.6, B.loftHay.z + 0.9, 0.45, 'hi'),
]);

/** Is a body of radius r at (x, z) inside the walls? */
export function inBarn(x: number, z: number, r: number): boolean {
  return x >= x0 + r && x <= x1 - r && z >= z0 + r && z <= z1 - r;
}

/** the ladder's surface height at z (null off its footprint) */
export function ladderAt(x: number, z: number): number | null {
  if (Math.abs(x - LADDER.x) > LADDER.w / 2 || z < LADDER.z0 - 0.02 || z > LADDER.z1) return null;
  const t = (LADDER.z1 - z) / (LADDER.z1 - LADDER.z0);
  return BARN_ROOM.floor + Math.min(1, Math.max(0, t)) * (LOFT.y - BARN_ROOM.floor);
}

/** feet can step up this much onto a higher surface */
const STEP = 0.65;
/**
 * The floor under (x, z) for feet at height y: the highest walkable surface at or a step above the feet (the loft
 * deck, the ladder, the ground floor). Without y: the ground floor. Null outside the walls.
 */
export function barnFloor(x: number, z: number, y?: number): number | null {
  if (!inBarn(x, z, 0.3)) return null;
  let h: number = BARN_ROOM.floor;
  if (y === undefined) return h;
  const reach = y + STEP;
  const lad = ladderAt(x, z);
  if (lad !== null && lad <= reach) h = Math.max(h, lad);
  if (z <= LOFT.z1 && LOFT.y <= reach) h = Math.max(h, LOFT.y);
  return h;
}

/** Push a circle (radius r, mutated) out of every solid on the feet's level; true if it moved. */
export function barnPushOut(p: { x: number; z: number }, r: number, y?: number, solids: readonly BarnSolid[] = BARN_SOLIDS): boolean {
  const lo = y === undefined || y < LO_MAX, hi = y !== undefined && y > HI_MIN;
  let moved = false;
  for (const o of solids) {
    if (o.lvl === 'lo' && !lo) continue;
    if (o.lvl === 'hi' && !hi) continue;
    if (o.kind === 'circle') {
      const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz), m = o.r + r;
      if (d < m) {
        if (d > 1e-6) { p.x = o.x + (dx / d) * m; p.z = o.z + (dz / d) * m; } else p.z = o.z + m;
        moved = true;
      }
      continue;
    }
    const hw = o.w / 2, hd = o.d / 2, lx = p.x - o.x, lz = p.z - o.z;
    const cx = Math.max(-hw, Math.min(hw, lx)), cz = Math.max(-hd, Math.min(hd, lz));
    const ex = lx - cx, ez = lz - cz, d = Math.hypot(ex, ez);
    if (d >= r) continue;
    if (d < 1e-6) {
      if (hw - Math.abs(lx) < hd - Math.abs(lz)) p.x = o.x + Math.sign(lx || 1) * (hw + r); else p.z = o.z + Math.sign(lz || 1) * (hd + r);
    } else { p.x = o.x + cx + (ex / d) * r; p.z = o.z + cz + (ez / d) * r; }
    moved = true;
  }
  return moved;
}

/** coming in (just inside the big door, looking up the aisle) and going out (the yard in front of the door) */
export const BARN_ENTRY = Object.freeze({ x: -0.4, z: 3.2, yaw: 0, pitch: -0.02 });
export const BARN_EXIT = Object.freeze({ x: 0.2, z: 6.6, yaw: Math.PI, pitch: -0.04 });

/** Named viewpoints for shots and the dev hook (`__valley.inside('barn:NAME')`, `pose=barn-inside:NAME`). */
export const BARN_VIEWS: Readonly<Record<string, { x: number; z: number; tx: number; ty: number; tz: number; y?: number }>> = Object.freeze({
  door: { x: -0.2, z: 3.4, tx: -0.3, ty: 2.4, tz: -4.0 },
  aisle: { x: 0.2, z: 1.6, tx: -2.6, ty: 1.2, tz: -2.2 },
  stalls: { x: -0.6, z: 1.9, tx: -3.2, ty: 1.1, tz: -1.4 },
  cow: { x: -0.7, z: -2.0, tx: -2.6, ty: 1.2, tz: -2.6 },
  donkey: { x: -0.7, z: 0.4, tx: -2.6, ty: 1.2, tz: 0.05 },
  hens: { x: -0.1, z: -2.1, tx: 3.4, ty: 0.8, tz: -3.0 },
  coop: { x: 1.15, z: -2.6, tx: 4.4, ty: 0.9, tz: -2.95 },
  sheep: { x: 0.2, z: 1.5, tx: 3.4, ty: 0.6, tz: 0.0 },
  panel: { x: 2.5, z: 2.55, tx: 3.25, ty: 1.85, tz: 4.0 },
  bench: { x: -2.6, z: 1.85, tx: -4.6, ty: 1.4, tz: 2.9 },
  loft: { x: 0.2, z: -2.2, tx: -1.5, ty: 2.6, tz: 3.0, y: LOFT.y },
  rafters: { x: 2.2, z: -2.6, tx: -1.0, ty: 6.4, tz: 0.5, y: LOFT.y },
  ladder: { x: 1.0, z: 2.2, tx: 1.0, ty: 3.4, tz: -2.0 },
});

/** where a visiting pet curls up: on the straw by Mochi's bales */
export const BARN_PET = Object.freeze({ x: -1.75, z: 2.65, yaw: Math.PI * 0.75 });

/** the outside door interactable (barn-local; the door is 3.8 m wide, the thermometer stands right of it) */
export const BARN_DOOR_OUT: readonly [number, number, number] = [-0.6, 1.7, 4.45];
