import type { ToolClass } from '../../../../shared/protocol.ts';
// @pure
/**
 * Layout schema + coordinate helpers (§7): plan (px, pz) origin NW corner, +x east, +z south;
 * world = (px − 20.5, y, pz − 14). Yaw is camera-style: forward = (−sin yaw, 0, −cos yaw).
 * Owner: LVL.
 */

export const PLAN_OFFSET = Object.freeze({ x: 20.5, z: 14 });

export const plan2world = (px: number, pz: number, y = 0): Vec3 => ({ x: px - PLAN_OFFSET.x, y, z: pz - PLAN_OFFSET.z });
export const world2plan = (x: number, z: number): { px: number; pz: number } => ({ px: x + PLAN_OFFSET.x, pz: z + PLAN_OFFSET.z });
/** Yaw that faces along (dx, dz). */
export const yawTo = (dx: number, dz: number) => Math.atan2(-dx, -dz);
/** Furniture yaw whose local +z (the prop's front) points along (dx, dz) (three rotation.y). */
export const frontYaw = (dx: number, dz: number) => Math.atan2(dx, dz);
/** Local (lx, lz) of a thing at `pos` with rotation.y = `yaw` → world {x, z}. */
export const local2world = (pos: { x: number; z: number }, yaw: number, lx: number, lz: number): { x: number; z: number } => {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: pos.x + lx * c + lz * s, z: pos.z - lx * s + lz * c };
};

/**
 * Layout schema (the shape both proto.ts and hq.ts export as `layout`). LVL owns the final version. The hq layout is the
 * full office; `HqLayout` is what `hq.ts` exports (every hq-only field present), `Layout` the common base the proto room
 * also satisfies (hq-only fields optional).
 */
export interface Vec3 { x: number; y: number; z: number }
/** [x0, z0, x1, z1] */
export type Rect = [number, number, number, number];
/** [cx, cz, r] */
export type Circle = [number, number, number];
export type Pose = 'sit' | 'stand' | 'lie';

/** §6.6 */
export interface Slot {
  id: string;
  /** 'desk'|'sofa'|'queue'|'station:<name>'|… */
  tag: string;
  /** feet position */
  pos: Vec3;
  /** facing (camera-style yaw) */
  yaw: number;
  pose: Pose;
  /** 0 ground, 1 mezzanine */
  level: number;
  /** furniture id this slot belongs to (e.g. the desk) */
  anchor?: string;
  /** desk pod index (proto: 0..2; BRN's D7 desk rule) */
  pod?: number;
  /** zone id the slot stands in (hq) */
  zone?: string | null;
  /** bay id (hq bays and their amenities) */
  bay?: string;
  amenity?: string;
  /** napNook bunks */
  bunk?: 'lower' | 'upper';
  /** extra lift (m) of an upper bunk */
  lift?: number;
}

export interface Furniture {
  id: string;
  /** 'desk'|'chair'|'sofa'|'counter'|'window'|'lamp'|… */
  type: string;
  /** centre of the footprint at floor level */
  pos: Vec3;
  yaw: number;
  /** w (x), h (y), d (z) before yaw */
  size: [number, number, number];
  /** blocks nav */
  solid: boolean;
  pod?: number;
  /** desk: which side of its pod centre it stands (proto; −1 west, +1 east); shellBench: which end (local ±x) carries the monitor */
  side?: -1 | 1;
  /** desk: pod row (proto; 0 north, faces spawn; 1 south) */
  row?: 0 | 1;
  level?: number;
  zone?: string | null;
  bay?: string;
  /** hq desks: +1 when desk-local +x points at the pod centre */
  m?: number;
  /** round footprint (tables, rugs) */
  round?: boolean;
  /** drawn by the prop kit rather than the greybox */
  kit?: boolean;
  /** rug / mat colour key */
  color?: string;
}

export type LampKind = 'desk' | 'floor' | 'pendant' | 'street' | 'hearth' | 'lantern';
/** §5.6 lamp pool */
export interface LampAnchor {
  id: string;
  kind: LampKind;
  /** pool centre (the bulb) */
  pos: Vec3;
  /** m */
  radius: number;
  /** hex (normalised in lamps.ts) */
  color: string;
  /** ≤ 0.30 */
  gain: number;
}

/** §5.6 gobo window */
export interface WindowRect {
  center: Vec3;
  /** unit, pointing INTO the room */
  normal: Vec3;
  w: number;
  h: number;
  zone?: string | null;
  kind?: OpeningKind;
}

export type OpeningKind = 'window' | 'highWindow' | 'door' | 'arch' | 'storefront' | 'entrance' | 'opening' | 'glass' | 'display' | 'lintel';
export interface WallOpening {
  /** metres from the wall's start along its axis */
  at: number;
  w: number;
  h: number;
  sill: number;
  kind: OpeningKind;
  /** bay id whose private door this is */
  private?: string;
}
export type WallKind = 'wall' | 'glass' | 'storefront' | 'rail' | 'lintel';
export interface Wall {
  /** (x, z) world */
  a: [number, number];
  b: [number, number];
  h: number;
  /** thickness, default 0.2 */
  t?: number;
  /** floor height the wall stands on (default 0) */
  y0?: number;
  kind?: WallKind;
  level?: number;
  openings?: WallOpening[];
}

export interface Zone {
  id: string;
  /** [x0, z0, x1, z1] world */
  rect: Rect;
  level: number;
  name?: string;
  floor?: number;
  ceil?: number;
  /** [cx, cz, r] world (the Pit's round floor) */
  circle?: Circle;
}
/** Vis cell (§5.3): a zone plus its authored visibility set (hq). */
export interface VisCell {
  id: string;
  rect: Rect;
  level: number;
  region?: string;
  visible?: readonly string[];
}

/** hq vis cell: region and the hand-authored visible set are always present. */
export interface HqVisCell extends VisCell { region: string; visible: readonly string[] }

export interface NavPointRef { x: number; z: number; level: number }

/** §6.6. [LEAD m2 fix r2, cross-owner LVL: ratifies LVL's m2 r1 proposal] */
export interface NavLevel {
  id: number;
  /** floor height */
  y: number;
  /** walkable rects (levels other than 0) */
  open?: readonly Rect[];
  /** solid for everyone */
  block?: readonly ({ rect: Rect } | { circle: Circle } | { seg: Rect })[];
  /** rect(s), solid except for queue members */
  queueLane?: Rect | readonly Rect[];
  /** world rects/circles round §9.2 review-camera stands: solid for agents, open for the player (grid owner '*'); no slot inside (layout.test) */
  cameraWells?: readonly ({ rect: Rect } | { circle: Circle })[];
}

export interface Portal {
  /** 'stairs' | 'slide' */
  id: string;
  /** entry */
  a: NavPointRef;
  /** exit */
  b: NavPointRef;
  twoWay: boolean;
  /** metres walked (stairs) or equivalent (slide: ride time × 2.8 m/s) */
  len: number;
  /** ride time (s), slide only */
  time?: number;
  /** centreline a → b (slide: baked helix, §6.10) */
  path?: readonly Vec3[];
}

export interface KeepClearRect { id?: string; x0: number; z0: number; x1: number; z1: number; headSlotOnly?: boolean }
export interface KeepClearView {
  id: string;
  x: number;
  z: number;
  level: number;
  yaw: number;
  /** override of the nav near-field depth (m) for this view */
  coneR?: number;
}

export interface Layout {
  /** 'proto'|'hq' */
  id: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** ceiling height of the main room */
  height: number;
  walls: Wall[];
  furniture: Furniture[];
  slots: Slot[];
  zones: readonly Zone[];
  visCells: readonly VisCell[];
  /** stat / lamp / sign anchors */
  anchors: { id: string; pos: Vec3; kind: string; yaw?: number }[];
  lamps?: LampAnchor[];
  windows?: WindowRect[];
  /** desk slot ids per pod */
  pods?: string[][];
  /** named points (spawn, entrance, helpDesk, staffMat, queue[]) */
  points?: LayoutPoints;
  /** open floor for __hq.clayCheck */
  probeSpot?: { x: number; z: number };
  /** x,y,z,yaw,pitch (y = feet) */
  spawn: [number, number, number, number, number];
  floorY: (x: number, z: number, level?: number) => number;
  zoneAt: (x: number, z: number, level?: number) => string | null;
  /** surface under feet at y (hq) */
  floorAt?: (x: number, z: number, y: number) => { y: number; level: 0 | 1 };
  /** nav levels (hq; proto = one level) */
  levels?: readonly NavLevel[];
  /** level links (hq: stairs two-way, slide one-way) */
  portals?: readonly Portal[];
  /** world rects (§7.1 KEEP_CLEAR) */
  keepClear?: KeepClearRect[];
  /**
   * [BRN fix r1] authored viewpoints (the spawn + the §9.2 review cameras): nobody parks within ~1.5 m of one and
   * standers avoid their near view cone. The directors read only this (never debug/poses.ts); layout tests keep it in sync with it.
   */
  keepClearViews?: ReadonlyArray<KeepClearView>;
  // ---- hq only (see HqLayout)
  doors?: Door[];
  stations?: readonly Station[];
  bays?: Bay[];
  amenities?: readonly Amenity[];
  statAnchors?: readonly StatAnchor[];
  lanes?: readonly Lane[];
  slide?: SlideDef;
  stairs?: StairsDef & { rect: Rect };
  skylight?: { rect: Rect; y: number };
  queueLane?: Readonly<Rect>;
  /** [LVL fix r2] the lane as nav sees it (rects) */
  queueRects?: readonly Rect[];
  /** rope runs [x0, z0, x1, z1] (world; greybox draws them) */
  queueRopes?: readonly Rect[];
  /** plan-space accessors for tools (walktimes --ascii, greybox) */
  plan?: PlanApi;
}

/** Named points of a layout: proto has the first few, hq all of them. */
export interface LayoutPoints {
  spawn: { x: number; z: number };
  entrance: { x: number; z: number };
  helpDesk: { x: number; z: number };
  staffMat: { x: number; z: number };
  queue: { x: number; z: number }[];
}

export interface Door {
  id: string;
  kind: OpeningKind;
  zones: [string, string];
  private: string | null;
  w: number;
  axis: 'x' | 'z';
  y0: number;
  pos: Vec3;
  aprons: [Vec3, Vec3];
  /** keep-clear apron (world rect): the door width × ±0.8 m */
  rect: Rect;
}
export interface Bay {
  id: string;
  pod: number;
  rect: Rect;
  side: 'E' | 'W';
  amenity: string;
  amenityName: string;
  desks: string[];
  nap: string | null;
  amenitySlots: string[];
  storefront: Vec3;
  backDoor: string | null;
  sign: Vec3;
  signYaw: number;
}
export interface Station {
  id: string;
  zone: string;
  level: number;
  cls: readonly ToolClass[];
  slots: readonly string[];
  queue?: readonly string[];
  cap: number;
}
export interface Amenity {
  id: string;
  zone?: string;
  bay?: string;
  name?: string;
  slots: readonly string[];
  nap?: string | null;
}
export interface StatAnchor { id: string; kind: string; pos: Vec3; yaw: number; span?: Rect; size?: [number, number] }
export interface Lane { id: string; rect?: Rect; annulus?: [number, number, number, number]; level?: number }
export interface SlideDef {
  center: Vec3;
  r: number;
  turns: number;
  tube: number;
  mouth: Vec3;
  exit: Vec3;
  exitYaw: number;
  path: readonly Vec3[];
  duration: number;
}
export interface StairsDef { x0: number; x1: number; zFoot: number; zTop: number; rise: number }
export interface PlanApi {
  zoneAt: (px: number, pz: number, level?: number) => string | null;
  groundY: (px: number, pz: number) => number;
  stairsY: (px: number, pz: number) => number | null;
  onMezz: (px: number, pz: number) => boolean;
  ZONE_DEFS: readonly ZoneDef[];
  PIT: { cx: number; cz: number; rings: readonly (readonly [number, number])[] };
  STAIRS: StairsDef;
  MEZZ_RECTS: readonly Rect[];
}
/** Plan-space zone definition (hq.ts ZONE_DEFS). */
export interface ZoneDef { id: string; name: string; rect: Rect; floor: number; ceil: number; level?: number; circle?: Circle }

/** The full office layout `hq.ts` exports: `Layout` with every hq-only field present. */
export interface HqLayout extends Layout {
  visCells: readonly HqVisCell[];
  lamps: LampAnchor[];
  windows: WindowRect[];
  pods: string[][];
  points: HqPoints;
  probeSpot: { x: number; z: number };
  floorAt: (x: number, z: number, y: number) => { y: number; level: 0 | 1 };
  levels: readonly NavLevel[];
  portals: readonly Portal[];
  keepClear: KeepClearRect[];
  keepClearViews: ReadonlyArray<KeepClearView>;
  doors: Door[];
  stations: readonly Station[];
  bays: Bay[];
  amenities: readonly Amenity[];
  statAnchors: readonly StatAnchor[];
  lanes: readonly Lane[];
  slide: SlideDef;
  stairs: StairsDef & { rect: Rect };
  skylight: { rect: Rect; y: number };
  queueLane: Readonly<Rect>;
  queueRects: readonly Rect[];
  queueRopes: readonly Rect[];
  plan: PlanApi;
}
export interface HqPoints extends LayoutPoints {
  spawn: Vec3;
  entrance: Vec3;
  door: Vec3;
  helpDesk: Vec3;
  staffMat: Vec3;
  tellerWindow: Vec3;
  bell: Vec3;
  queueEntry: Vec3;
  queueOverflow: { x: number; z: number }[];
  pitCenter: Vec3;
  pitSouthGap: Vec3;
  pitNorthGap: Vec3;
  pitSeats: string[];
  stairsFoot: Vec3;
  stairsTop: Vec3;
  slideMouth: Vec3;
  slideExit: Vec3;
  bigBoard: Vec3;
  ramColumn: Vec3;
  fishTank: Vec3;
  signpost: Vec3;
  outbox: Vec3;
  serveCamera: Vec3;
  /** overflow spiral anchors (§6.4.4) */
  overflow: Record<'desks' | 'alley' | 'library' | 'eng' | 'pit' | 'atrium' | 'queue', Vec3>;
  /** a representative walkable point per zone (walktimes, minimap labels) */
  zone: Record<string, Vec3>;
}

/** Is this the full office layout? */
export const isHqLayout = (l: Layout): l is HqLayout => l.id === 'hq';

/** The M1 proto room `proto.ts` exports: `Layout` with the fields the room authors present. */
export interface ProtoLayout extends Layout {
  lamps: LampAnchor[];
  windows: WindowRect[];
  pods: string[][];
  points: LayoutPoints;
  probeSpot: { x: number; z: number };
  keepClearViews: ReadonlyArray<KeepClearView>;
}
