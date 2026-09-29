// @pure
/**
 * Density check (§7.1 "Density", M1.5 gate): empty floor patches larger than 2.5 × 2.5 m outside circulation lanes.
 * A cell is "dressed" when it is within `reach` of any furniture footprint (solid or not, floor decals excluded), in a
 * lane or keep-clear rect, or not walkable. Greedy maximal empty squares (DP) larger than `maxSide` are returned.
 * `?greybox` draws them as a red overlay; `walktimes` prints them.
 * Owner: LVL.
 */
import type { Circle, Layout, Lane, Rect } from './schema.ts';

const DECALS = new Set(['rug', 'mat', 'medallion', 'podRug', 'queueMat', 'yogaMat', 'stairs', 'slide', 'bigBoard', 'banner', 'starChart', 'testLight']);

/** Returns the square centres (world) and sides (m). */
export function emptyPatches(
  layout: Layout,
  nav: { walkable: (x: number, z: number, level?: number) => boolean },
  o: { cell?: number; reach?: number; maxSide?: number; level?: number } = {},
): { x: number; z: number; side: number; zone: string | null; level: number }[] {
  const cell = o.cell ?? 0.25, reach = o.reach ?? 0.6, maxSide = o.maxSide ?? 2.5, level = o.level ?? 0;
  const b = layout.bounds;
  const cols = Math.round((b.maxX - b.minX) / cell), rows = Math.round((b.maxZ - b.minZ) / cell);
  const free = new Uint8Array(cols * rows);
  const lanes: (Partial<Lane> & { circle?: Circle })[] = [...(layout.lanes ?? []), ...(layout.keepClear ?? []).map((k): { rect: Rect; level: number } => ({ rect: [k.x0, k.z0, k.x1, k.z1], level: 0 }))];
  const inLane = (x: number, z: number) => lanes.some((l) => {
    if ((l.level ?? level) !== level) return false;
    if (l.rect) return x >= l.rect[0] && x <= l.rect[2] && z >= l.rect[1] && z <= l.rect[3];
    if (l.annulus) { const d2 = (x - l.annulus[0]) ** 2 + (z - l.annulus[1]) ** 2; return d2 >= l.annulus[2] ** 2 && d2 <= l.annulus[3] ** 2; } // [LVL fix r1] ring lanes
    if (!l.circle) return false;
    return (x - l.circle[0]) ** 2 + (z - l.circle[1]) ** 2 <= l.circle[2] ** 2;
  });
  const props = (layout.furniture ?? []).filter((f) => !DECALS.has(f.type) && (f.level ?? 0) === level).map((f) => {
    const c = Math.abs(Math.cos(f.yaw ?? 0)), s = Math.abs(Math.sin(f.yaw ?? 0));
    const ex = c * f.size[0] / 2 + s * f.size[2] / 2 + reach, ez = s * f.size[0] / 2 + c * f.size[2] / 2 + reach;
    return [f.pos.x - ex, f.pos.z - ez, f.pos.x + ex, f.pos.z + ez] satisfies Rect;
  });
  const slots = (layout.slots ?? []).filter((s) => (s.level ?? 0) === level).map((s) => s.pos);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = b.minX + (c + 0.5) * cell, z = b.minZ + (r + 0.5) * cell;
    if (!nav.walkable(x, z, level) || inLane(x, z)) continue;
    if (props.some((q) => x >= q[0] && x <= q[2] && z >= q[1] && z <= q[3])) continue;
    if (slots.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < reach * reach)) continue;
    free[r * cols + c] = 1;
  }
  const out: ReturnType<typeof emptyPatches> = [];
  const need = Math.ceil(maxSide / cell - 1e-6) + 1; // strictly larger than maxSide
  for (let guard = 0; guard < 200; guard++) {
    // largest empty square (DP over the remaining free cells)
    const dp = new Uint16Array(cols * rows);
    let best = 0, bi = -1;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!free[i]) continue;
      dp[i] = r && c ? 1 + Math.min(dp[i - cols], dp[i - 1], dp[i - cols - 1]) : 1;
      if (dp[i] > best) { best = dp[i]; bi = i; }
    }
    if (best < need) break;
    const r1 = (bi / cols) | 0, c1 = bi % cols;
    for (let r = r1 - best + 1; r <= r1; r++) for (let c = c1 - best + 1; c <= c1; c++) free[r * cols + c] = 0;
    const x = b.minX + (c1 - best / 2 + 1) * cell, z = b.minZ + (r1 - best / 2 + 1) * cell;
    out.push({ x, z, side: best * cell, zone: layout.zoneAt?.(x, z, level) ?? null, level });
  }
  return out;
}
