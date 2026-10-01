/**
 * Where the player's yard and the General store go (no three; node-testable).
 *
 * The yard is the strip of lawn behind the farmhouse (`YARD` in world/map.ts, kept clear of scatter): a low picket
 * fence on the west, north and east sides (the house is the fourth), a gate in the north fence toward the back road
 * and a gap in the west fence toward the laundry yard. Decor stands on `YARD_SLOTS` slots, 5 across × 3 deep.
 *
 * The General store is a little cart on the open meadow south-east of the square, facing the road (searched for a free,
 * level spot near `STORE_NEAR`, clear of roads, structures, fields, water, lamps and flora).
 */
import { PATHS, POND, RIVER, RIVER_HALF_WIDTH, SITES, STRUCTURES, WORLD, YARD, distToPolyline, heightAt, inSite } from '../../world/map.ts';
import { YARD_SLOTS } from '../../model/wallet.ts';

export interface Slot { i: number; x: number; z: number }

const COLS = 5, ROWS = 3;
/** slot centres: columns 2.4 m apart, rows 2 m apart, the first row 2.1 m off the house's back wall */
export const SLOTS: readonly Slot[] = Array.from({ length: YARD_SLOTS }, (_, i) => {
  const c = i % COLS, r = Math.floor(i / COLS);
  return { i, x: (YARD.x0 + YARD.x1) / 2 + (c - (COLS - 1) / 2) * 2.4, z: YARD.z1 - 2.1 - r * 2.0 };
});
if (COLS * ROWS !== YARD_SLOTS) throw new Error('yard grid does not match YARD_SLOTS');

/** the north gate (an opening in the fence between two slot columns, toward the back road) and the west gap (toward the laundry) */
export const GATE = Object.freeze({ x: (YARD.x0 + YARD.x1) / 2 + 1.2, z: YARD.z0, w: 1.6 });
export const WEST_GAP = Object.freeze({ x: YARD.x0, z: YARD.z1 - 1.6, w: 1.4 });
/** the yard sign stands outside the gate, to its east */
export const SIGN = Object.freeze({ x: GATE.x + GATE.w / 2 + 1.6, z: YARD.z0 - 0.6 });
/** a good place to stand and decorate: just outside the gate, looking over the yard at the house */
export const VIEW = Object.freeze({ x: GATE.x, z: YARD.z0 - 2.8, yaw: Math.PI, pitch: -0.26 });

/** fence runs (ax, az, bx, bz): west side (with its gap), north side (with the gate), east side */
export function fenceRuns(): [number, number, number, number][] {
  const { x0, x1, z0, z1 } = YARD;
  const zs = z1 + 0.15; // the fence starts just off the house's back wall
  return [
    [x0, zs, x0, WEST_GAP.z + WEST_GAP.w / 2],
    [x0, WEST_GAP.z - WEST_GAP.w / 2, x0, z0],
    [x0, z0, GATE.x - GATE.w / 2, z0],
    [GATE.x + GATE.w / 2, z0, x1, z0],
    [x1, z0, x1, zs],
  ];
}

/** the slot nearest (x, z) within `r` metres, or null */
export function slotNear(x: number, z: number, r = 1.3): Slot | null {
  let best: Slot | null = null, bd = r;
  for (const s of SLOTS) { const d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; best = s; } }
  return best;
}

export const inYard = (x: number, z: number, m = 0): boolean => x > YARD.x0 - m && x < YARD.x1 + m && z > YARD.z0 - m && z < YARD.z1 + m;

// ---------------------------------------------------------------------------------------------
// The General store

export const STORE_NEAR = Object.freeze({ x: 7.2, z: 13.4 });
export const STORE_R = 1.7;

function structDist(x: number, z: number): number {
  let d = Infinity;
  for (const s of STRUCTURES) {
    const dx = x - s.x, dz = z - s.z, c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
    const qx = Math.abs(lx) - s.size[0] / 2, qz = Math.abs(lz) - s.size[1] / 2;
    d = Math.min(d, Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0));
  }
  return d;
}
const pathDist = (x: number, z: number) => Math.min(...PATHS.map((p) => distToPolyline(x, z, p.points) - p.width / 2));

/** the nearest point on any road */
export function nearestRoad(x: number, z: number): { x: number; z: number } {
  let best = { x, z }, bd = Infinity;
  for (const p of PATHS) for (let i = 0; i < p.points.length - 1; i++) {
    const a = p.points[i], b = p.points[i + 1], dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2));
    const px = a.x + dx * t, pz = a.z + dz * t, d = Math.hypot(x - px, z - pz);
    if (d < bd) { bd = d; best = { x: px, z: pz }; }
  }
  return best;
}

/** A free, level spot for the store cart near `STORE_NEAR`, facing the nearest road. `blocked`: flora, lamps, … */
export function storeSpot(blocked: (x: number, z: number, r: number) => boolean = () => false): { x: number; z: number; yaw: number } {
  const r = STORE_R;
  const free = (x: number, z: number) => {
    if (structDist(x, z) < r + 1.5 || SITES.some((s) => inSite(s, x, z, r + 1.2))) return false;
    const pd = pathDist(x, z);
    if (pd < r + 0.4 || pd > r + 3.5) return false; // by the road, not on it
    if (distToPolyline(x, z, RIVER) < RIVER_HALF_WIDTH + 3 + r || Math.hypot(x - POND.x, z - POND.z) < POND.r + 3 + r || heightAt(x, z) < WORLD.water + 0.5) return false;
    if (blocked(x, z, r + 0.3)) return false;
    const h0 = heightAt(x, z);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; if (Math.abs(heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r) - h0) > 0.2) return false; }
    return true;
  };
  for (let i = 0; i < 500; i++) {
    const a = i * 2.39996, d = Math.sqrt(i) * 0.45, x = STORE_NEAR.x + Math.cos(a) * d, z = STORE_NEAR.z + Math.sin(a) * d;
    if (!free(x, z)) continue;
    const p = nearestRoad(x, z);
    return { x, z, yaw: Math.atan2(p.x - x, p.z - z) };
  }
  const p = nearestRoad(STORE_NEAR.x, STORE_NEAR.z);
  return { ...STORE_NEAR, yaw: Math.atan2(p.x - STORE_NEAR.x, p.z - STORE_NEAR.z) };
}
