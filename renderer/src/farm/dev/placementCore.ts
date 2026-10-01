/**
 * Placement audit: the pure half (no three, no DOM). Finding shapes, allowlist matching, ranking, sampling and camera
 * framing maths, shared by the in-page auditor (`dev/placement.ts`) and the runner (`scripts/placement.ts`).
 * Tested in placementCore.test.ts.
 */

export type Vec3 = [number, number, number];
export interface Box { min: Vec3; max: Vec3 }

/**
 * floating  an object whose base does not reach the ground (or anything it could rest on)
 * overhang  part of a wide base hovers (a slope under a flat-bottomed object), the rest touches
 * sunk     terrain swallows part of the object (a fence run through a hill, a prop pushed into a slope)
 * overlap   two different placed objects interpenetrate (mesh triangles intersect)
 * water     a dry-land object standing in the river / pond
 * path      a solid object standing on a road's centre line
 */
export type Check = 'floating' | 'overhang' | 'sunk' | 'overlap' | 'water' | 'path';
export const CHECKS: readonly Check[] = ['floating', 'overhang', 'sunk', 'overlap', 'water', 'path'];

export interface ItemRef {
  /** unique: system/object path/part#n (instances carry #index) */
  key: string;
  /** what counts as "the same placed object" (overlaps inside one owner are modelling, not placement) */
  owner: string;
  /** key without indices or plot ids: the class a fix at the source addresses */
  asset: string;
  /** world AABB */
  box: Box;
}

export interface Finding {
  check: Check;
  a: ItemRef;
  b?: ItemRef;
  /** headline metric, metres: gap (floating/overhang), depth (sunk/water), contact span (overlap) */
  value: number;
  /** secondary metrics (depth proxy, curve length, base width, sample counts…) */
  extra: Record<string, number>;
  /** world region to look at */
  focus: Box;
  score: number;
  /** filled by the runner */
  allowed?: string;
  id?: string;
}

export interface AllowEntry {
  check: Check | '*';
  /** glob over item keys (`*` any run of characters, `?` one); matched against key, owner and asset */
  a: string;
  /** for overlaps: the other item (order-free) */
  b?: string;
  /** only allow up to this metric (larger values still surface) */
  max?: number;
  /** only allow when every named extra metric is at least this (e.g. { "sepRatio": 0.55 }) */
  min?: Record<string, number>;
  reason: string;
}

// ---------------------------------------------------------------------------------------------------------------

const reCache = new Map<string, RegExp>();
export function glob(p: string): RegExp {
  let re = reCache.get(p);
  if (!re) {
    re = new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
    reCache.set(p, re);
  }
  return re;
}
const hit = (p: string, it: ItemRef): boolean => { const r = glob(p); return r.test(it.key) || r.test(it.owner) || r.test(it.asset); };

/** The first allowlist entry covering a finding, or null. */
export function allowedBy(f: Finding, list: readonly AllowEntry[]): AllowEntry | null {
  for (const e of list) {
    if (e.check !== '*' && e.check !== f.check) continue;
    if (e.max !== undefined && f.value > e.max) continue;
    if (e.min && Object.entries(e.min).some(([k, v]) => !((f.extra[k] ?? -Infinity) >= v))) continue;
    if (!f.b) { if (!e.b && hit(e.a, f.a)) return e; continue; }
    const b = e.b ?? '*';
    if ((hit(e.a, f.a) && hit(b, f.b)) || (hit(e.a, f.b) && hit(b, f.a))) return e;
  }
  return null;
}

/** Strip instance indices and plot ids: `plots/field:d3/crop:apple#12` → `plots/field/crop:apple`. */
export function assetOf(key: string): string {
  return key.replace(/#\d+/g, '').replace(/field:[^/]+/g, 'field');
}

export function overlapBox(a: Box, b: Box): Box | null {
  const min: Vec3 = [Math.max(a.min[0], b.min[0]), Math.max(a.min[1], b.min[1]), Math.max(a.min[2], b.min[2])];
  const max: Vec3 = [Math.min(a.max[0], b.max[0]), Math.min(a.max[1], b.max[1]), Math.min(a.max[2], b.max[2])];
  return min[0] <= max[0] && min[1] <= max[1] && min[2] <= max[2] ? { min, max } : null;
}
export const boxSize = (b: Box): Vec3 => [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
export const boxCenter = (b: Box): Vec3 => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
export const boxDiag = (b: Box): number => Math.hypot(...boxSize(b));
export const emptyBox = (): Box => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
export function grow(b: Box, x: number, y: number, z: number): Box {
  if (x < b.min[0]) b.min[0] = x; if (y < b.min[1]) b.min[1] = y; if (z < b.min[2]) b.min[2] = z;
  if (x > b.max[0]) b.max[0] = x; if (y > b.max[1]) b.max[1] = y; if (z > b.max[2]) b.max[2] = z;
  return b;
}
export const pad = (b: Box, m: number): Box => ({ min: [b.min[0] - m, b.min[1] - m, b.min[2] - m], max: [b.max[0] + m, b.max[1] + m, b.max[2] + m] });

/**
 * Sample points on a triangle (flat xyz into `out`): the corners, then a barycentric grid whose spacing is about
 * `step` along the longest edge. Returns the number of points added.
 */
export function triangleSamples(t: ArrayLike<number>, step: number, out: number[]): number {
  const [ax, ay, az, bx, by, bz, cx, cy, cz] = [t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7], t[8]];
  const L = Math.max(Math.hypot(bx - ax, by - ay, bz - az), Math.hypot(cx - bx, cy - by, cz - bz), Math.hypot(ax - cx, ay - cy, az - cz));
  const n = Math.max(1, Math.min(64, Math.ceil(L / step)));
  let k = 0;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n - i; j++) {
      const u = i / n, v = j / n, w = 1 - u - v;
      out.push(ax * w + bx * u + cx * v, ay * w + by * u + cy * v, az * w + bz * u + cz * v);
      k++;
    }
  }
  return k;
}

/**
 * A camera looking at `target` from `azimuth` (radians, 0 = from the south looking north) and `elevation` above
 * the horizon, far enough for a sphere of `radius` to fill the frame. Yaw/pitch follow the game camera (yaw 0 looks
 * north / −z; YXZ order).
 */
export function frame(target: Vec3, radius: number, azimuth: number, elevation: number, fovDeg = 62): { x: number; y: number; z: number; yaw: number; pitch: number; dist: number } {
  const dist = Math.max(2.2, (radius / Math.tan((fovDeg * Math.PI) / 360)) * 1.15);
  const ce = Math.cos(elevation);
  const x = target[0] + Math.sin(azimuth) * ce * dist, z = target[2] + Math.cos(azimuth) * ce * dist, y = target[1] + Math.sin(elevation) * dist;
  const vx = target[0] - x, vy = target[1] - y, vz = target[2] - z;
  return { x, y, z, yaw: Math.atan2(-vx, -vz), pitch: Math.atan2(vy, Math.hypot(vx, vz)), dist };
}

/** Rank: metres of trouble, weighted by how visible the check usually is. */
export function score(check: Check, value: number, extra: Record<string, number> = {}): number {
  switch (check) {
    case 'floating': return value * 10 * Math.max(0.3, Math.min(3, extra.size ?? 1));
    case 'overhang': return value * 4 * Math.max(0.3, Math.min(3, extra.width ?? 1));
    case 'sunk': return value * 6 * Math.max(0.3, Math.min(3, extra.span ?? 1));
    case 'overlap': return value * 5 * (1 + Math.min(2, extra.depth ?? 0) * 2);
    case 'water': return value * 6;
    case 'path': return 1 + value;
  }
}

/** Stable id for a finding (dedupe across scenarios; reports and contact sheets use it). */
export function findingId(f: Pick<Finding, 'check' | 'a' | 'b'>): string {
  const ks = f.b ? [f.a.key, f.b.key].sort() : [f.a.key];
  return `${f.check}|${ks.join('|')}`;
}

export function sortFindings<T extends Pick<Finding, 'score'>>(list: T[]): T[] { return list.sort((a, b) => b.score - a.score); }

/** Counts per class (check + asset pair): the unit you fix at the source. */
export function summarize(list: readonly Finding[]): { cls: string; n: number; worst: number; allowed: number }[] {
  const m = new Map<string, { cls: string; n: number; worst: number; allowed: number }>();
  for (const f of list) {
    const assets = f.b ? [f.a.asset, f.b.asset].sort().join(' × ') : f.a.asset;
    const cls = `${f.check}: ${assets}`;
    const e = m.get(cls) ?? { cls, n: 0, worst: 0, allowed: 0 };
    e.n++;
    e.worst = Math.max(e.worst, f.value);
    if (f.allowed) e.allowed++;
    m.set(cls, e);
  }
  return [...m.values()].sort((a, b) => (a.allowed === a.n ? 1 : 0) - (b.allowed === b.n ? 1 : 0) || b.n * b.worst - a.n * a.worst);
}
