/**
 * [FX fix m2-r3] Floor-slab occluders for the no-depth-test labels (nameplates, bubbles, alert cards, pennants).
 * The wall bake (ui/aim.ts `bakeOccluders` / `wallBlocks`) is plan segments only ("walls only"), so a label whose agent
 * stands on the other level was drawn through the mezzanine floor (a faded 'lumen · agents' plate on the mezz carpet at
 * `mezz` h13 / h22). A slab is a horizontal plane at `y` whose solid footprint is where the layout's level-1 floor is
 * (`layout.floorY(x, z, 1)` ≈ y: the mezzanine + landing rects; the stair ramp top counts too).
 * Slab data comes from the layout itself (the level-1 zones' `floor`), so no layout edit is needed; LVL may later publish
 * `layout.slabs = [{y, rects}]` (DESIGN §11.5 idea) and `bakeSlabs` prefers it.
 * Owner: FX. @pure (no THREE, no DOM)
 */
import type { Layout } from '../world/layout/schema.ts';

/** Slab plane sits this far under the walkable floor top (inside the slab's thickness). */
export const SLAB_DEPTH_M = 0.1;

/**
 * A horizontal slab: the plane at `y` (`top` = the walkable surface); its solid footprint is `rects` when the layout
 * publishes them, else wherever `floorY(x, z, 1)` ≈ `top`.
 */
export interface Slab {
  y: number;
  top: number;
  rects: number[][] | null;
  floorY: ((x: number, z: number, l: number) => number) | null;
}
/** The layout fields the slab bake reads (`slabs` is the optional future LVL publication). */
export type SlabLayout = Partial<Pick<Layout, 'floorY' | 'zones'>> & { slabs?: { y: number; rects: number[][] }[] };

export function bakeSlabs(layout: SlabLayout | null | undefined): Slab[] {
  if (!layout) return [];
  if (Array.isArray(layout.slabs)) return layout.slabs.map((s) => ({ y: s.y - SLAB_DEPTH_M, top: s.y, rects: s.rects, floorY: null }));
  const fy = typeof layout.floorY === 'function' ? layout.floorY : null;
  if (!fy) return [];
  const ys = new Set<number>();
  for (const z of layout.zones ?? []) if ((z.level ?? 0) >= 1 && z.floor !== undefined && z.floor > 0.5) ys.add(z.floor);
  return [...ys].map((y) => ({ y: y - SLAB_DEPTH_M, top: y, rects: null, floorY: fy }));
}

/**
 * Does a slab cut the segment o → t (world)? The segment must cross the slab plane strictly between its ends, at a
 * plan point that is on the slab's solid footprint.
 */
export function slabBlocks(slabs: readonly Slab[], ox: number, oy: number, oz: number, tx: number, ty: number, tz: number): boolean {
  for (let i = 0; i < slabs.length; i++) {
    const s = slabs[i], a = oy - s.y, b = ty - s.y;
    if (a * b >= 0) continue; // same side
    const k = a / (a - b);
    if (k < 0.01 || k > 0.99) continue;
    const x = ox + (tx - ox) * k, z = oz + (tz - oz) * k;
    if (s.rects) {
      for (let j = 0; j < s.rects.length; j++) { const r = s.rects[j]; if (x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]) return true; }
    } else if (s.floorY && Math.abs(s.floorY(x, z, 1) - s.top) < 0.05) return true;
  }
  return false;
}
