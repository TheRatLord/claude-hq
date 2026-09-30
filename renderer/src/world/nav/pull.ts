// @pure
/**
 * Greedy line-of-sight simplification of a cell path on an inflated grid.
 */
import type { Grid } from './grid.ts';

/** Grid line of sight between two world points (supercover-ish sampling at ¼ cell). */
export function lineOfSight(g: Grid, ax: number, az: number, bx: number, bz: number): boolean {
  const d = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(d / (g.cell * 0.25)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (g.blocked(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
  }
  return true;
}

/** Extra step cost at a world point (0 without a cost field or outside the grid). */
export function costAt(g: Grid, x: number, z: number): number {
  if (!g.cost) return 0;
  const c = g.col(x), r = g.row(z);
  return g.inside(c, r) ? g.cost[r * g.cols + c] : 0;
}
/** Highest extra step cost along a straight line, sampled at quarter-cell intervals. */
export function lineCost(g: Grid, ax: number, az: number, bx: number, bz: number): number {
  if (!g.cost) return 0;
  const d = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(d / (g.cell * 0.25)));
  let m = 0;
  for (let i = 0; i <= n; i++) { const t = i / n, k = costAt(g, ax + (bx - ax) * t, az + (bz - az) * t); if (k > m) m = k; }
  return m;
}
/** A search-free straight leg: unblocked, with no higher cost than either endpoint. */
export function freeLine(g: Grid, ax: number, az: number, bx: number, bz: number): boolean {
  if (!lineOfSight(g, ax, az, bx, bz)) return false;
  return !g.cost || lineCost(g, ax, az, bx, bz) <= Math.max(costAt(g, ax, az), costAt(g, bx, bz)) + 1e-3;
}

export function pull<P extends { x: number; z: number }>(g: Grid, pts: P[]): P[] {
  if (pts.length <= 2) return pts;
  const out = [pts[0]];
  // With weighted cells, a shortcut must not cross a higher-cost region than the original path
  // at the corresponding fraction, allowing 0.3 slack for discretisation.
  const ok = !g.cost ? null : (i: number, j: number) => {
    const a = pts[i], b = pts[j], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (g.cell * 0.5)));
    for (let k = 1; k < n; k++) {
      const u = k / n, q = pts[i + Math.round(u * (j - i))];
      if (costAt(g, a.x + (b.x - a.x) * u, a.z + (b.z - a.z) * u) > costAt(g, q.x, q.z) + 0.3) return false;
    }
    return true;
  };
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !(lineOfSight(g, pts[i].x, pts[i].z, pts[j].x, pts[j].z) && (!ok || ok(i, j)))) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}
