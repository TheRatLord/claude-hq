/**
 * Surface ids and the per-vertex packing (pure: no three, testable in node).
 *
 * A tagged vertex carries `surface = vec4(code, scale, strength, aux)`:
 *   code     = id + 32·axis + 128·variant      (id 0..31, axis 0..3, variant 0..3)
 *   scale    pattern size multiplier (1 = the surface's natural size in metres)
 *   strength 0..1 how strongly the detail modulates the base colour (1 = full)
 *   aux      free per-vertex scalar; `logs` use it for the distance from the log axis (end-grain rings)
 * id 0 (`SURF.inherit`) means "use the material's default surface", which is also what an untagged vertex reads.
 */

/** Surface ids. Stable: they are baked into geometry. */
export const SURF = Object.freeze({
  inherit: 0, plain: 1,
  grass: 2, meadow: 3, soil: 4, dirt: 5, cobble: 6, sand: 7, pebbles: 8, rock: 9, cliff: 10, snow: 11,
  planks: 12, logs: 13, bark: 14, shingle: 15, tile: 16, thatch: 17, brick: 18, fieldstone: 19, plaster: 20,
  metal: 21, fabric: 22, hay: 23, leaves: 24, plant: 25,
});
export type SurfName = keyof typeof SURF;
export type SurfId = (typeof SURF)[SurfName];

/** Every real surface (no `inherit`), in id order. */
export const SURF_NAMES: readonly SurfName[] = (Object.keys(SURF) as SurfName[]).filter((k) => k !== 'inherit').sort((a, b) => SURF[a] - SURF[b]);

/**
 * Orientation of the pattern's "long" direction in object space:
 *   'y' (default) grain / rows run up: vertical siding, roof shingle rows step down the slope, bark ridges run up trunks
 *   'x' | 'z'     along that local axis (floor boards, a log lying along x)
 *   'h'           horizontal along each face (clapboard siding on every wall of a box, brick courses stay level)
 * When the face is perpendicular to the axis (a floor with axis 'y'), the pattern falls back to z (y, x) → x (z).
 */
export type SurfAxis = 'y' | 'x' | 'z' | 'h';
export const AXIS_CODE: Readonly<Record<SurfAxis, number>> = Object.freeze({ y: 0, x: 1, z: 2, h: 3 });
const AXES: readonly SurfAxis[] = ['y', 'x', 'z', 'h'];

export interface SurfTag {
  axis?: SurfAxis;
  /** 0..3: a style switch per surface (planks: 0 plain, 1 weathered, 2 painted; metal: 1 corrugated, 2 rusty; leaves: 1 needles; …) */
  variant?: number;
  /** pattern size multiplier (default 1) */
  scale?: number;
  /** 0..1 (default 1) */
  strength?: number;
}

export function packCode(id: number, axis: SurfAxis = 'y', variant = 0): number {
  if (!Number.isInteger(id) || id < 0 || id > 31) throw new RangeError(`surface id ${id} out of range`);
  const v = Math.max(0, Math.min(3, Math.round(variant)));
  return id + 32 * AXIS_CODE[axis] + 128 * v;
}

export function unpackCode(code: number): { id: number; axis: SurfAxis; variant: number } {
  const c = Math.round(code);
  return { id: c % 32, axis: AXES[Math.floor(c / 32) % 4], variant: Math.floor(c / 128) % 4 };
}

/** The four floats a tagged vertex stores. */
export function packSurface(id: number, t: SurfTag = {}, aux = 0): [number, number, number, number] {
  return [packCode(id, t.axis, t.variant), t.scale ?? 1, Math.max(0, Math.min(1, t.strength ?? 1)), aux];
}

/** Short stable key for a set of compiled-in surfaces (program cache key). */
export function surfaceSetKey(ids: readonly number[]): string {
  let bits = 0;
  for (const id of ids) bits |= 1 << id;
  return (bits >>> 0).toString(36);
}

/** Resolve names or ids to ids (unknown names throw). */
export function surfIds(list: readonly (SurfName | number)[]): number[] {
  return list.map((s) => {
    if (typeof s === 'number') return s;
    if (!(s in SURF)) throw new Error(`unknown surface ${s}`);
    return SURF[s];
  });
}
