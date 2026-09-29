// @pure
/**
 * String pulling (§6.6): greedy line-of-sight simplification of a cell path on the (inflated) grid.
 * Owner: LVL.
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

/** [BRN fix m3-r3, cross-owner LVL] the grid's soft cost at a world point (0 without a cost field / outside) */
export function costAt(g: Grid, x: number, z: number): number {
  if (!g.cost) return 0;
  const c = g.col(x), r = g.row(z);
  return g.inside(c, r) ? g.cost[r * g.cols + c] : 0;
}
/** [BRN fix m3-r3, cross-owner LVL] the highest soft cost along a straight line (¼-cell samples) */
export function lineCost(g: Grid, ax: number, az: number, bx: number, bz: number): number {
  if (!g.cost) return 0;
  const d = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(d / (g.cell * 0.25)));
  let m = 0;
  for (let i = 0; i <= n; i++) { const t = i / n, k = costAt(g, ax + (bx - ax) * t, az + (bz - az) * t); if (k > m) m = k; }
  return m;
}
/** [BRN fix m3-r3, cross-owner LVL] a straight walk a → b needs no search: open AND no deeper into a soft cone than its ends */
export function freeLine(g: Grid, ax: number, az: number, bx: number, bz: number): boolean {
  if (!lineOfSight(g, ax, az, bx, bz)) return false;
  return !g.cost || lineCost(g, ax, az, bx, bz) <= Math.max(costAt(g, ax, az), costAt(g, bx, bz)) + 1e-3;
}

export function pull<P extends { x: number; z: number }>(g: Grid, pts: P[]): P[] {
  if (pts.length <= 2) return pts;
  const out = [pts[0]];
  // [BRN fix m3-r3, cross-owner LVL] with a soft cost field a shortcut may not cut deeper into it than its own ends (a
  // cell path hugging a corridor's far wall past a view keeps its corners instead of being pulled across the frame)
  // (each sample of the shortcut vs the cell path at the same fraction of the way, + 0.3 slack)
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
