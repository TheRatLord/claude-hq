// @pure
/**
 * The secret grotto behind the big waterfall (scene/grotto): a narrow rock ledge that leaves the west shore of the
 * plunge pool, slips behind the falling water and ends at a cave mouth in the cliff; through it, a cavern of glowing
 * crystals around a still pool.
 *
 * Two halves, both pure:
 *  - **the ledge** (world space): a polyline with a designed tread height, cut into `heightAt` by `carveGrotto` (the
 *    terrain mesh, scatter, `clearance()` and the controller all agree). The waterfall's sheet is traced against the
 *    land *before* this cut (`world/map.ts` `heightBeforeGrotto`), so the water keeps falling where it always did and
 *    the cut opens a walkable gap behind it.
 *  - **the cave** (room-local space: the mouth at the origin, +z out toward the falls, y up from the ledge's tread):
 *    one signed-distance field (`caveSdf`, negative = air) that the scene polygonises into the shell, and that the
 *    room plan (`caveFloor`, `inCave`, `cavePushOut`) walks, so what you see is what you bump into.
 */

export interface XZ { x: number; z: number }
interface LedgePt { x: number; z: number; y: number }

/** The ledge, from the road's end on the pool's west shore to the cave mouth (world; y = tread height). */
export const LEDGE: readonly LedgePt[] = Object.freeze([
  { x: -32.7, z: -97.2, y: -0.35 },
  { x: -32.1, z: -100.6, y: 0.3 },
  { x: -31.0, z: -103.8, y: 0.8 },
  { x: -29.9, z: -106.5, y: 1.05 },
  { x: -29.0, z: -108.9, y: 1.1 },
  { x: -27.2, z: -110.2, y: 1.1 },
  { x: -24.9, z: -110.5, y: 1.1 },
  { x: -24.6, z: -111.5, y: 1.1 },
]);
/** The cave mouth in the back of the alcove behind the falls: the room's frame (yaw 0: the mouth looks south, +z). */
export const MOUTH = Object.freeze({ x: -24.6, z: -111.5, y: 1.1, yaw: 0 });
/** half-width of the level tread; the cut blends into the cliff over `LEDGE_BLEND` beyond it */
export const LEDGE_HW = 1.0;
const CUT_BLEND = 1.6, FILL_BLEND = 0.7;
/** the cut's level floor runs wider than the tread: the terrain mesh (1.25 m grid) must not overhang the walk */
const CUT_HW = 1.7;
/** the cut runs on past the mouth into the rock (a groove the arch and its dark throat sit in) */
const CUT: readonly LedgePt[] = Object.freeze([...LEDGE, { x: -24.6, z: -112.7, y: 1.1 }]);
const BOX = (() => {
  const m = CUT_BLEND + CUT_HW + 0.2;
  return { x0: Math.min(...CUT.map((p) => p.x)) - m, x1: Math.max(...CUT.map((p) => p.x)) + m, z0: Math.min(...CUT.map((p) => p.z)) - m, z1: Math.max(...CUT.map((p) => p.z)) + m };
})();

const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** distance to a ledge polyline and the tread height there (written into `out`) */
function nearest(x: number, z: number, pts: readonly LedgePt[], out: { d: number; y: number; t: number }): typeof out {
  let best = Infinity, by = 0, bt = 0, along = 0, total = 0;
  for (let i = 0; i + 1 < pts.length; i++) total += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z);
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz, l = Math.sqrt(l2);
    const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)) : 0;
    const ex = a.x + dx * t - x, ez = a.z + dz * t - z;
    const d = ex * ex + ez * ez;
    if (d < best) { best = d; by = a.y + (b.y - a.y) * t; bt = (along + l * t) / (total || 1); }
    along += l;
  }
  out.d = Math.sqrt(best); out.y = by; out.t = bt;
  return out;
}
const tmp = { d: 0, y: 0, t: 0 };

/** Distance from (x, z) to the ledge's centre line (world), and the tread height there. */
export function ledgeAt(x: number, z: number): { d: number; y: number; t: number } {
  return nearest(x, z, LEDGE, { d: 0, y: 0, t: 0 });
}

/** Cut the ledge into the land height `h` at (x, z): level tread, the cliff cut back behind it, a little fill in front. */
export function carveGrotto(x: number, z: number, h: number): number {
  if (x < BOX.x0 || x > BOX.x1 || z < BOX.z0 || z > BOX.z1) return h;
  const n = nearest(x, z, CUT, tmp);
  if (h > n.y) {
    const k = 1 - smooth(CUT_HW, CUT_HW + CUT_BLEND, n.d);
    return k > 0 ? lerp(h, n.y, k) : h;
  }
  const k = 1 - smooth(LEDGE_HW * 0.9, LEDGE_HW + FILL_BLEND, n.d);
  return k > 0 ? lerp(h, n.y, k) : h;
}

/** room-local → world (the frame is unrotated: yaw 0) */
export const caveToWorld = (lx: number, ly: number, lz: number): { x: number; y: number; z: number } => ({ x: MOUTH.x + lx, y: MOUTH.y + ly, z: MOUTH.z + lz });

// ---------------------------------------------------------------------------------------------------------- the cave
// Room-local metres: the mouth's tread at the origin, +z out toward the waterfall, −z into the mountain, +x east.

/** a tiny deterministic 3D value noise, −1..1 */
function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296 * 2 - 1;
}
export function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const c = (i: number, j: number, k: number) => hash3(xi + i, yi + j, zi + k);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), u), x10 = lerp(c(0, 1, 0), c(1, 1, 0), u);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), u), x11 = lerp(c(0, 1, 1), c(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}

/** the still pool (an ellipse in plan) and its water surface */
export const POOL = Object.freeze({ x: -4.3, z: -11.4, rx: 2.9, rz: 2.35, water: -0.32, depth: -1.05 });
/** the explorer's camp on the east side, and its pieces (room-local; yaw = three rotation.y) */
export const CAMP = Object.freeze({
  bedroll: { x: 5.3, z: -9.4, yaw: 1.35 },
  crate: { x: 3.9, z: -7.7, yaw: 0.3 },
  fire: { x: 3.3, z: -10.0 },
  pack: { x: 5.9, z: -7.4, yaw: -0.6 },
  pick: { x: 6.55, z: -11.1, yaw: 0.2 },
});
/** the journal and the lantern sit on the crate */
export const CRATE_H = 0.55;
/** the hidden chest, tucked into the north-east alcove behind a stand of stalagmites */
export const CHEST = Object.freeze({ x: 6.3, z: -16.6, yaw: -0.75 });
/** where today's glow-caps grow (a mossy log by the pool) */
export const GLOWCAP = Object.freeze({ x: -1.2, z: -14.3, yaw: 0.6 });
/** the painted wall: the cave paintings face the camp from the cavern's north-west wall, centred here */
export const PAINTING = Object.freeze({ x: -1.6, z: -16.3, y: 1.55, w: 5.2, h: 1.7 });
/** the bats' roost, a crack in the dome over the middle of the cavern */
export const ROOST = Object.freeze({ x: 1.6, z: -12.2 });

/** the room's lobes: ellipsoids (centre, radii) blended into one cavern */
interface Lobe { x: number; y: number; z: number; rx: number; ry: number; rz: number }
const LOBES: readonly Lobe[] = [
  { x: 0, y: 0.95, z: 0.6, rx: 1.25, ry: 1.55, rz: 1.6 },           // the mouth
  { x: 0.25, y: 0.95, z: -1.7, rx: 1.3, ry: 1.6, rz: 1.9 },         // the passage
  { x: 0.5, y: 1.1, z: -4.4, rx: 2.4, ry: 2.4, rz: 2.2 },           // it widens
  { x: 0.6, y: 1.25, z: -11.2, rx: 7.4, ry: 4.6, rz: 5.9 },         // the cavern
  { x: -4.6, y: 1.0, z: -11.8, rx: 4.0, ry: 3.6, rz: 3.6 },         // the pool's lobe
  { x: 5.4, y: 0.9, z: -8.4, rx: 2.9, ry: 2.9, rz: 2.7 },           // the camp bay
  { x: 5.9, y: 0.8, z: -16.2, rx: 2.2, ry: 2.3, rz: 1.9 },          // the chest alcove
];
/** walkable outward past the mouth (the ledge outside); the room's walls end at `MOUTH_OUT` */
export const MOUTH_OUT = 0.25;

const ellipsoid = (x: number, y: number, z: number, e: Lobe) => {
  const px = (x - e.x) / e.rx, py = (y - e.y) / e.ry, pz = (z - e.z) / e.rz;
  const k = Math.sqrt(px * px + py * py + pz * pz);
  return (k - 1) * Math.min(e.rx, e.ry, e.rz);
};
const smin = (a: number, b: number, k: number) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

/** The floor height (room-local) under (x, z): level at the mouth, gently rolling, a basin for the pool. */
export function caveFloor(x: number, z: number): number {
  let f = 0.08 * noise3(x * 0.45, 3.1, z * 0.45) + 0.05 * noise3(x * 1.3, 7.7, z * 1.3);
  f *= smooth(-0.8, -3, z);                                  // exactly level where it meets the ledge
  f += 0.22 * smooth(-12, -18, z) + 0.12 * smooth(4, 7.5, x); // rising a little to the back and the camp bay
  const pr = Math.hypot((x - POOL.x) / POOL.rx, (z - POOL.z) / POOL.rz);
  if (pr < 1.5) {
    const bowl = 1 - smooth(0.55, 1.08, pr);
    f = lerp(f, POOL.depth, bowl);
    f += 0.07 * Math.exp(-((pr - 1.18) ** 2) / 0.012);      // a lip of flowstone round the rim
  }
  return f;
}

/** Signed distance to the rock (room-local): negative in the air of the cave, positive in the rock. */
export function caveSdf(x: number, y: number, z: number): number {
  let d = Infinity;
  for (const e of LOBES) d = d === Infinity ? ellipsoid(x, y, z, e) : smin(d, ellipsoid(x, y, z, e), 1.4);
  // rocky lumps (larger in the dome, small near the mouth so it meets the arch cleanly)
  const rough = 0.32 * noise3(x * 0.55, y * 0.55, z * 0.55) + 0.12 * noise3(x * 1.6 + 5, y * 1.6, z * 1.6 - 3);
  d += rough * smooth(0.5, -2.5, z);
  // the floor (the shell is cut open just past the mouth: the scene clips its mesh at `SHELL_END`)
  return Math.max(d, caveFloor(x, z) - y);
}
/** the shell's open end, a little past the mouth: the water curtain hangs across it */
export const SHELL_END = 1.0;

/** Stalagmites and solid camp pieces (circles in plan), for collisions: x, z, r. */
export const SOLIDS: readonly (readonly [number, number, number])[] = Object.freeze([
  // the stand of stalagmites that hides the chest alcove
  [4.1, -14.2, 0.32], [4.9, -13.5, 0.24], [3.4, -15.1, 0.22],
  // a few along the walls
  [-6.8, -7.6, 0.3], [-1.6, -6.1, 0.2], [7.3, -12.6, 0.28], [-7.9, -14.1, 0.34],
  // the camp: crate, pack, the chest itself
  [CAMP.crate.x, CAMP.crate.z, 0.42], [CAMP.pack.x, CAMP.pack.z, 0.3], [CHEST.x, CHEST.z, 0.45],
]);

/** body clearance height: the walls are tested at the waist (the dome curves in overhead, the floor rolls) */
const WAIST = 0.9;

/** Is a body of radius r at (x, z) inside the cave's air (room-local)? Negative r: a margin outside the walls. */
export function inCave(x: number, z: number, r: number): boolean {
  if (z > MOUTH_OUT - r) return false;
  return caveSdf(x, caveFloor(x, z) + WAIST, z) < -r;
}

/** Walkable floor height under (x, z), or null: past the walls, in the pool, or beyond the ledge outside. */
export function floorAt(x: number, z: number): number | null {
  if (z > 2.2 || z < -22 || Math.abs(x) > 14) return null;
  if (Math.hypot((x - POOL.x) / POOL.rx, (z - POOL.z) / POOL.rz) < 0.92) return null;
  if (z > MOUTH_OUT) return Math.abs(x) < 1.1 ? 0 : null;   // the threshold, out onto the ledge
  const f = caveFloor(x, z);
  return caveSdf(x, f + WAIST, z) < 0 ? f : null;
}

/** Push a circle (room-local, mutated) out of the walls, the pool and the solids; true when it moved. */
export function cavePushOut(p: { x: number; z: number }, r: number): boolean {
  let moved = false;
  for (const [sx, sz, sr] of SOLIDS) {
    const dx = p.x - sx, dz = p.z - sz, d = Math.hypot(dx, dz), m = sr + r;
    if (d < m && d > 1e-6) { p.x = sx + (dx / d) * m; p.z = sz + (dz / d) * m; moved = true; }
  }
  // the pool: an ellipse you stand at the edge of
  const ex = (p.x - POOL.x) / POOL.rx, ez = (p.z - POOL.z) / POOL.rz, er = Math.hypot(ex, ez);
  const need = 0.92 + r / Math.min(POOL.rx, POOL.rz);
  if (er < need && er > 1e-6) { p.x = POOL.x + (ex / er) * need * POOL.rx; p.z = POOL.z + (ez / er) * need * POOL.rz; moved = true; }
  // the walls: step back along the field's gradient at the waist (the threshold out to the ledge stays open)
  if (p.z < MOUTH_OUT + 1) {
    for (let it = 0; it < 3; it++) {
      const y = caveFloor(p.x, p.z) + WAIST;
      const d = caveSdf(p.x, y, p.z);
      if (d < -r) break;
      const e = 0.05;
      let gx = caveSdf(p.x + e, y, p.z) - caveSdf(p.x - e, y, p.z), gz = caveSdf(p.x, y, p.z + e) - caveSdf(p.x, y, p.z - e);
      const gl = Math.hypot(gx, gz);
      if (gl < 1e-6) break;
      gx /= gl; gz /= gl;
      p.x -= gx * (d + r + 0.01); p.z -= gz * (d + r + 0.01);
      moved = true;
    }
  }
  return moved;
}

/** March from (x, y, z) along (dx, dy, dz) (unit) until the rock: the distance, or `max`. */
export function caveRay(x: number, y: number, z: number, dx: number, dy: number, dz: number, max = 20): number {
  let t = 0;
  for (let i = 0; i < 96 && t < max; i++) {
    const d = caveSdf(x + dx * t, y + dy * t, z + dz * t);
    if (d > -0.01) return t;
    t += Math.max(0.03, -d * 0.7);
  }
  return max;
}
