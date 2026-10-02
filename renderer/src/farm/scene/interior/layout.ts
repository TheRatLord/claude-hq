/**
 * The farmhouse interior's floor plan (pure: no three, no DOM; tested in interior.test.ts). Farmhouse-local metres,
 * the same frame as `FARMHOUSE` in scene/structures/farmhouse.ts: front (the porch, the door) is +z, the ground floor
 * sits on the stone foundation at y = 0.55 (porch level). The room fills the ground-floor shell (exterior walls at
 * x = ±4.5, z = −4.4 … 2.0) less 15 cm of interior wall, so the window openings line up with the windows outside.
 *
 *          north (back wall)
 *   ┌───────────────────────────────┐
 *   │ bed      [Collections shelf] tank clock│
 *   │ shelf      table          rug  hearth  │   east: the chimney breast and the fire
 *   │ CRT desk                  armchair     │
 *   │ almanac desk  ▣win   door   ▣win  catbed (under the east window)
 *   └───────────────────────────────┘
 *          south (porch)
 */
import { CATALOG } from '../../model/collection.ts';

export const ROOM = Object.freeze({
  /** inner wall faces */
  x0: -4.35, x1: 4.35, z0: -4.25, z1: 1.85,
  /** floor (top of the foundation) and ceiling (under the jetty beam) */
  floor: 0.55, ceil: 3.2,
  /** interior wall thickness (out to the exterior shell) */
  wall: 0.15,
});

export interface Opening { id: string; wall: 'front' | 'east'; /** centre along the wall (x for front, z for east) */ at: number; /** centre height (absolute local y) */ y: number; w: number; h: number }
/** window openings, matching the exterior windows (farmhouse.ts windowUnit calls) */
export const WINDOWS: readonly Opening[] = Object.freeze([
  { id: 'frontL', wall: 'front', at: -2.7, y: 1.95, w: 1.2, h: 1.25 },
  { id: 'frontR', wall: 'front', at: 2.7, y: 1.95, w: 1.2, h: 1.25 },
  { id: 'east', wall: 'east', at: 0.2, y: 1.95, w: 1.0, h: 1.2 },
]);
/** the front door (exterior: 1.15 wide, 2.1 tall from the porch) */
export const DOOR = Object.freeze({ x: 0, w: 1.15, h: 2.1 });

/**
 * Where the window views are captured from (just outside each pane, eye height, looking out) and what they cover.
 * One wide view for both front windows (from the porch, in front of the door), one for the east window.
 */
export interface ViewSpot { id: string; x: number; y: number; z: number; /** outward direction (local) */ nx: number; nz: number; fov: number; aspect: number }
export const VIEWS: readonly ViewSpot[] = Object.freeze([
  { id: 'front', x: 0, y: 2.15, z: 2.32, nx: 0, nz: 1, fov: 100, aspect: 2.2 },
  { id: 'east', x: 4.78, y: 2.15, z: 0.2, nx: 1, nz: 0, fov: 100, aspect: 1.6 },
]);

export type Solid = { kind: 'rect'; x: number; z: number; w: number; d: number } | { kind: 'circle'; x: number; z: number; r: number };
const R = (x: number, z: number, w: number, d: number): Solid => ({ kind: 'rect', x, z, w, d });
const C = (x: number, z: number, r: number): Solid => ({ kind: 'circle', x, z, r });

/** Furniture anchors (local x, z; yaw = which way its front faces, 0 = +z). Builders and colliders both read these. */
export const FURN = Object.freeze({
  shelf: { x: 0, z: -4.03, w: 3.2, d: 0.42, h: 2.15 },
  tank: { x: 2.45, z: -3.97, w: 1.1, d: 0.52 },
  clock: { x: 3.82, z: -4.02, w: 0.6, d: 0.42 },
  hearth: { x: 4.05, z: -1.25, w: 0.6, d: 1.66 },
  hearthSlab: { x: 3.55, z: -1.2, w: 0.4, d: 1.5 },
  armchair: { x: 2.3, z: -0.95, yaw: Math.PI / 2 + 0.25 },
  sideTable: { x: 2.25, z: -2.05 },
  rug: { x: 2.55, z: -1.15, w: 2.2, d: 1.7 },
  logBasket: { x: 3.62, z: -2.5 },
  catBed: { x: 3.82, z: 0.42 },
  plantSE: { x: 3.95, z: 1.45 },
  bed: { x: -3.33, z: -3.58, w: 2.0, d: 1.34 },
  nightstand: { x: -4.05, z: -2.6 },
  bookshelf: { x: -4.13, z: -1.45, w: 0.44, d: 1.7 },
  plantW: { x: -4.0, z: -0.3 },
  crtDesk: { x: -3.97, z: 0.78, w: 0.74, d: 1.3 },
  crtChair: { x: -3.2, z: 0.78 },
  almanacDesk: { x: -2.05, z: 1.5, w: 1.3, d: 0.62 },
  almanacChair: { x: -2.05, z: 0.86 },
  table: { x: -1.15, z: -1.7, r: 0.5 },
  stools: [{ x: -1.85, z: -1.45 }, { x: -0.55, z: -2.1 }] as readonly { x: number; z: number }[],
  hooks: { x: 1.15, z: 1.85 },
});

/** Solid footprints (the player is pushed out of them; walls are the room's edge). */
export const SOLIDS: readonly Solid[] = Object.freeze([
  R(FURN.shelf.x, FURN.shelf.z, FURN.shelf.w + 0.1, FURN.shelf.d),
  R(FURN.tank.x, FURN.tank.z, FURN.tank.w, FURN.tank.d + 0.05),
  R(FURN.clock.x, FURN.clock.z, FURN.clock.w, FURN.clock.d + 0.05),
  R(FURN.hearth.x, FURN.hearth.z, FURN.hearth.w, FURN.hearth.d),
  R(FURN.hearthSlab.x, FURN.hearthSlab.z, FURN.hearthSlab.w, FURN.hearthSlab.d),
  C(FURN.armchair.x, FURN.armchair.z, 0.5),
  C(FURN.sideTable.x, FURN.sideTable.z, 0.27),
  C(FURN.logBasket.x, FURN.logBasket.z, 0.28),
  C(FURN.catBed.x, FURN.catBed.z, 0.3),
  C(FURN.plantSE.x, FURN.plantSE.z, 0.28),
  R(FURN.bed.x, FURN.bed.z, FURN.bed.w, FURN.bed.d),
  R(FURN.nightstand.x, FURN.nightstand.z, 0.5, 0.46),
  R(FURN.bookshelf.x, FURN.bookshelf.z, FURN.bookshelf.w, FURN.bookshelf.d),
  C(FURN.plantW.x, FURN.plantW.z, 0.26),
  R(FURN.crtDesk.x, FURN.crtDesk.z, FURN.crtDesk.w, FURN.crtDesk.d),
  C(FURN.crtChair.x, FURN.crtChair.z, 0.26),
  R(FURN.almanacDesk.x, FURN.almanacDesk.z, FURN.almanacDesk.w, FURN.almanacDesk.d),
  C(FURN.almanacChair.x, FURN.almanacChair.z, 0.26),
  C(FURN.table.x, FURN.table.z, FURN.table.r),
  ...FURN.stools.map((s) => C(s.x, s.z, 0.2)),
]);

/** Is a body of radius r at (x, z) on the room's floor (inside the walls)? */
export function onFloor(x: number, z: number, r: number): boolean {
  return x >= ROOM.x0 + r && x <= ROOM.x1 - r && z >= ROOM.z0 + r && z <= ROOM.z1 - r;
}

/** Push a circle (radius r, mutated) out of every solid; true if it moved. Same maths as the engine's colliders. */
export function pushOut(p: { x: number; z: number }, r: number, solids: readonly Solid[] = SOLIDS): boolean {
  let moved = false;
  for (const o of solids) {
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
    if (d < 1e-6) { // centre inside: out through the nearest face
      if (hw - Math.abs(lx) < hd - Math.abs(lz)) p.x = o.x + Math.sign(lx || 1) * (hw + r); else p.z = o.z + Math.sign(lz || 1) * (hd + r);
    } else { p.x = o.x + cx + (ex / d) * r; p.z = o.z + cz + (ez / d) * r; }
    moved = true;
  }
  return moved;
}

/** Where you stand on coming in (just inside the door, looking into the room) and on going out (the porch). */
export const ENTRY = Object.freeze({ x: 0, z: 1.15, yaw: 0, pitch: -0.06 });
export const EXIT = Object.freeze({ x: 0, z: 3.1, yaw: Math.PI, pitch: -0.04 });

/** Named viewpoints for shots and the dev hook (`__valley.inside(name)`): stand at (x, z), look at (tx, ty, tz). */
export const INSIDE_VIEWS: Readonly<Record<string, { x: number; z: number; tx: number; ty: number; tz: number }>> = Object.freeze({
  door: { x: 0, z: 1.2, tx: 0, ty: 1.75, tz: -4.25 },
  room: { x: 1.2, z: 1.3, tx: -1.6, ty: 1.2, tz: -3.2 },
  hearth: { x: 0.6, z: 0.4, tx: 4.2, ty: 1.35, tz: -1.4 },
  shelf: { x: 0.2, z: -2.15, tx: 0, ty: 1.55, tz: -4.25 },
  desk: { x: -1.6, z: -0.3, tx: -3.6, ty: 1.15, tz: 1.0 },
  bed: { x: -1.6, z: -0.7, tx: -3.6, ty: 0.9, tz: -3.8 },
  photos: { x: -2.9, z: -2.0, tx: -3.25, ty: 2.15, tz: -4.25 },
  tank: { x: 1.9, z: -2.6, tx: 2.6, ty: 1.4, tz: -4.2 },
  window: { x: 0.9, z: -0.6, tx: 2.7, ty: 1.9, tz: 1.85 },
  sun: { x: 3.0, z: -2.9, tx: -0.6, ty: 0.9, tz: 1.2 },
});

// ---------------------------------------------------------------------------------------------
// The photo wall over the bed (north wall, west end): eight little frames for the album's favourites, hung salon
// style in two rows above the headboard (photowall.ts puts the photos in them, room.ts builds the frames).

export interface WallFrame {
  /** photo centre (room-local x, absolute local y) and the photo's size (m); the frame adds border + mat round it */
  x: number; y: number; w: number; h: number;
  /** frame wood colour */
  wood: number;
}
export const PHOTO_WALL = Object.freeze({ z: ROOM.z0 + 0.035, border: 0.035, mat: 0.028, x0: -4.22, x1: -2.26, gap: 0.035 });
const FRAME_WOODS = [0x6e4a2a, 0xc9963a, 0x8a5a36, 0x3f2a1c, 0xb07a4a, 0x5a3a24, 0xd8b26a, 0x7a3a28];
/** The eight frames, in hanging order: the first slots (the newest favourites) are the biggest, in the middle. */
export function photoWallSlots(): WallFrame[] {
  const pad = PHOTO_WALL.border + PHOTO_WALL.mat;
  const rows: { y: number; ws: number[]; hs: number[]; dy: number[] }[] = [
    { y: ROOM.floor + 2.18, ws: [0.34, 0.42, 0.32, 0.3], hs: [0.26, 0.32, 0.32, 0.38], dy: [0.02, 0, 0.015, -0.01] },
    { y: ROOM.floor + 1.63, ws: [0.28, 0.42, 0.34, 0.3], hs: [0.36, 0.3, 0.26, 0.3], dy: [0, -0.015, 0.02, 0] },
  ];
  const out: WallFrame[] = [];
  rows.forEach((r, ri) => {
    const total = r.ws.reduce((a, w) => a + w + pad * 2, 0) + PHOTO_WALL.gap * (r.ws.length - 1);
    let x = (PHOTO_WALL.x0 + PHOTO_WALL.x1) / 2 - total / 2;
    r.ws.forEach((w, i) => {
      x += pad + w / 2;
      out.push({ x, y: r.y + r.dy[i], w, h: r.hs[i], wood: FRAME_WOODS[(ri * 4 + i) % FRAME_WOODS.length] });
      x += w / 2 + pad + PHOTO_WALL.gap;
    });
  });
  // hanging order: the big middle ones first, then outwards
  return [1, 5, 2, 6, 0, 4, 3, 7].map((i) => out[i]);
}

// ---------------------------------------------------------------------------------------------
// The Collections shelf: 3 display rows of 6 or more (SHELF_COLS), forage in book order then the junk from the river (boot, bottle).
// Real fish swim in the tank instead; the biggest catch is mounted over the fire.

export const SHELF_ROWS = [0.78, 1.26, 1.74] as const;   // board tops above the floor
export interface ShelfSlot { id: string; row: number; col: number; /** local x (room frame), height above the floor */ x: number; y: number; z: number }
export const SHELF_IDS: readonly string[] = Object.freeze(CATALOG.filter((d) => d.kind === 'forage' || d.junk).map((d) => d.id));
export const TANK_IDS: readonly string[] = Object.freeze(CATALOG.filter((d) => d.kind === 'fish' && !d.junk).map((d) => d.id));
/** at least 6 a row, more (narrower) when the book outgrows 3 × 6 (the orchard's finds took it to 22) */
export const SHELF_COLS = Math.max(6, Math.ceil(SHELF_IDS.length / SHELF_ROWS.length));

export function shelfSlots(): ShelfSlot[] {
  const pitch = (FURN.shelf.w - 0.2) / SHELF_COLS;
  return SHELF_IDS.map((id, i) => {
    const row = Math.floor(i / SHELF_COLS), col = i % SHELF_COLS;
    // the last row is short: centre it
    const inRow = Math.min(SHELF_COLS, SHELF_IDS.length - row * SHELF_COLS);
    const x0 = FURN.shelf.x - (inRow * pitch) / 2 + pitch / 2;
    return { id, row, col, x: x0 + col * pitch, y: SHELF_ROWS[SHELF_ROWS.length - 1 - row], z: FURN.shelf.z + 0.04 };
  });
}

/** The biggest fish ever landed (by best cm), or null. */
export function biggestCatch(found: Readonly<Record<string, { best?: number }>>): { id: string; cm: number } | null {
  let best: { id: string; cm: number } | null = null;
  for (const id of TANK_IDS) {
    const cm = found[id]?.best ?? 0;
    if (cm > 0 && (!best || cm > best.cm)) best = { id, cm };
  }
  return best;
}

/** A clock face reading for an hour of day (0..24): hand angles in radians, clockwise from 12. */
export function clockHands(hour: number): { h: number; m: number; s: number } {
  const h12 = ((hour % 12) + 12) % 12;
  const min = (hour * 60) % 60;
  const sec = (hour * 3600) % 60;
  return { h: (h12 / 12) * Math.PI * 2, m: (min / 60) * Math.PI * 2, s: (sec / 60) * Math.PI * 2 };
}

/** "10:42" for an hour of day. */
export function clockText(hour: number): string {
  const t = Math.floor((((hour % 24) + 24) % 24) * 60);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
