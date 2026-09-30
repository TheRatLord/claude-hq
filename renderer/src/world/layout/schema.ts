// @pure
/** Neutral navigation geometry in world metres; +y is up. No scene or runtime allocation is provided here. */
export interface Vec3 { x: number; y: number; z: number }
/** [x0, z0, x1, z1], with ordered bounds. */
export type Rect = [number, number, number, number];
/** [centre x, centre z, radius]. */
export type Circle = [number, number, number];

/** A named reservable position. Tags are defined by the consumer. */
export interface Slot { id: string; tag: string; pos: Vec3 }

/** A solid rotated footprint; yaw rotates local +x toward world -z. */
export interface Footprint {
  pos: { x: number; z: number };
  /** Width and depth before yaw. */
  size: [number, number];
  yaw?: number;
  level?: number;
}

/** A traversable gap measured along a wall from its first endpoint. */
export interface WallOpening { at: number; w: number; h: number; sill?: number }
export interface Wall {
  a: [number, number];
  b: [number, number];
  h: number;
  /** Thickness in metres, default 0.2. */
  t?: number;
  /** Height of the wall's base, default 0. */
  y0?: number;
  openings?: readonly WallOpening[];
}

export interface NavPointRef { x: number; z: number; level: number }
export interface NavLevel {
  id: number;
  /** Floor height. */
  y: number;
  /** Walkable rectangles; absent means the entire layout bounds. */
  open?: readonly Rect[];
  block?: readonly ({ rect: Rect } | { circle: Circle } | { seg: Rect })[];
}

/** A single directed connection between levels, reversible when twoWay is true. */
export interface Portal {
  id: string;
  a: NavPointRef;
  b: NavPointRef;
  twoWay: boolean;
  /** Traversal distance used for route comparison. */
  len: number;
  /** Optional centreline in a-to-b order, including endpoints. */
  path?: readonly Vec3[];
}

/** Static input for the navigation algorithms. Recreate navigation after changing geometry. */
export interface Layout {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  walls?: readonly Wall[];
  obstacles?: readonly Footprint[];
  slots?: readonly Slot[];
  /** Absent means a single level (id 0, floor height 0). */
  levels?: readonly NavLevel[];
  portals?: readonly Portal[];
}
