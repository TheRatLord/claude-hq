// @pure
/**
 * Vis cells (§5.3 "Zone cells have a hand-authored visibility table"): one cell per zone (hq: 21, proto: 1). The
 * visible set of each cell is authored in `hq.ts` (`VIS_TABLE`); this module holds the helpers around it:
 *
 * - `cellAt(layout, x, y, z)`: the cell a CAMERA is in (world coords, y = eye height): the mezzanine above its slab,
 *   else the ground zone; `null` above the roofline or outside the building (= everything visible, e.g. `plan`).
 * - `sampleVisibility(layout)`: the ground-truth the authored table is checked against (layout.test.ts) and drafted
 *   from (`walktimes --vis`): 2-D rays at eye height (1.2 m) from a 0.5 m grid of camera points in every level-0 cell,
 *   stepped through a 0.1 m raster of the walls' solid spans at that height (glass, doors, arches, storefronts, display
 *   windows and lintel openings see through; high windows and walls do not). Vertical sight is folded in by rule:
 *   whoever sees the atrium also sees up to the mezzanine, and the mezzanine sees what the atrium sees.
 * Owner: LVL.
 */
import { PLAN_OFFSET } from './schema.ts';
import type { Layout } from './schema.ts';

const EYE = 1.2;
const SEE_THROUGH = new Set(['glass', 'window', 'door', 'arch', 'storefront', 'entrance', 'opening', 'lintel', 'display']);

/** Camera cell (`y` = eye height, world). */
export function cellAt(layout: Pick<Layout, 'bounds' | 'plan' | 'visCells'>, x: number, y: number, z: number): string | null {
  if (!layout.plan) return layout.visCells?.[0]?.id ?? null; // proto: one cell
  const b = layout.bounds;
  if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ || y > 6.2) return null;
  const px = x + PLAN_OFFSET.x, pz = z + PLAN_OFFSET.z;
  const level = y > 3.05 && layout.plan.onMezz(px, pz) ? 1 : 0;
  return layout.plan.zoneAt(px, pz, level) ?? layout.plan.zoneAt(px, pz, 0) ?? null;
}

/** Sampled ground-level visibility: `{[cellId]: string[]}` (sorted; always includes itself). `layout` is the hq layout. */
export function sampleVisibility(layout: Pick<Layout, 'bounds' | 'walls' | 'zones' | 'zoneAt'>, o: { step?: number; rays?: number } = {}): Record<string, string[]> {
  const step = o.step ?? 0.5, rays = o.rays ?? 720, R = 0.1;
  const b = layout.bounds;
  const W = Math.ceil((b.maxX - b.minX) / R), H = Math.ceil((b.maxZ - b.minZ) / R);
  const solid = new Uint8Array(W * H);
  const mark = (x: number, z: number) => {
    const c = Math.floor((x - b.minX) / R), r = Math.floor((z - b.minZ) / R);
    if (c >= 0 && r >= 0 && c < W && r < H) solid[r * W + c] = 1;
  };
  for (const w of layout.walls ?? []) {
    const y0 = w.y0 ?? 0;
    if (y0 > EYE || y0 + w.h < EYE) continue; // rails on the mezzanine, walls that stop below the eye
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1e-6;
    const ux = (w.b[0] - w.a[0]) / len, uz = (w.b[1] - w.a[1]) / len;
    const gaps = (w.openings ?? []).filter((op) => SEE_THROUGH.has(op.kind) && y0 + op.sill <= EYE && y0 + op.sill + op.h >= EYE);
    for (let s = 0; s <= len; s += R * 0.5) {
      if (gaps.some((g) => s > g.at + 0.02 && s < g.at + g.w - 0.02)) continue;
      mark(w.a[0] + ux * s, w.a[1] + uz * s);
    }
  }
  const zoneOf = new Array<string | null>(W * H);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) zoneOf[r * W + c] = layout.zoneAt(b.minX + (c + 0.5) * R, b.minZ + (r + 0.5) * R, 0);
  const seen = new Map<string, Set<string>>();
  for (const z of layout.zones) if ((z.level ?? 0) === 0) seen.set(z.id, new Set([z.id]));
  const dirs = Array.from({ length: rays }, (_, i) => [Math.cos((i / rays) * Math.PI * 2), Math.sin((i / rays) * Math.PI * 2)]);
  for (let x = b.minX + step / 2; x < b.maxX; x += step) {
    for (let z = b.minZ + step / 2; z < b.maxZ; z += step) {
      const c0 = Math.floor((x - b.minX) / R), r0 = Math.floor((z - b.minZ) / R);
      if (solid[r0 * W + c0]) continue;
      const home = zoneOf[r0 * W + c0];
      const set = home ? seen.get(home) : undefined;
      if (!set) continue;
      for (const [dx, dz] of dirs) {
        let px = x, pz = z;
        for (;;) {
          px += dx * R * 0.7; pz += dz * R * 0.7;
          const c = Math.floor((px - b.minX) / R), r = Math.floor((pz - b.minZ) / R);
          if (c < 0 || r < 0 || c >= W || r >= H) break;
          const i = r * W + c;
          if (solid[i]) break;
          const zz = zoneOf[i];
          if (zz) set.add(zz);
        }
      }
    }
  }
  // vertical sight (rule): the atrium's viewers look up to the mezzanine; the mezzanine sees what the atrium sees
  const out: Record<string, string[]> = {};
  for (const [id, set] of seen) { if (set.has('ATR') || set.has('PIT')) set.add('MEZ'); out[id] = [...set].sort(); }
  if (layout.zones.some((z) => z.id === 'MEZ')) out.MEZ = [...new Set(['MEZ', ...(out.ATR ?? [])])].sort();
  return out;
}
