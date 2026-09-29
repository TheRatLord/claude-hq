// @pure
/**
 * [ENV fix m2 r1] Wall occlusion for the kit's draw chunks (§5.3 budget). The layout's vis table lets almost every cell
 * see almost every other (it is per cell, not per eye point), and three's frustum test cannot drop a room that sits
 * in front of the camera behind a wall, so from the spawn the whole office was drawn. This is a conservative 2.5D
 * test against the layout's own walls: a chunk is visible when any of its sample points (a ~1 m grid over its vis
 * cells' rects at two heights) has a clear line from the eye, where a wall blocks a ray only where it is solid (its
 * openings — doors, arches, glazing, storefronts, display windows — and rails never block). No mesh, no GPU.
 * Owner: ENV.
 */
import type { Layout, Rect } from '../layout/schema.ts';

export interface Eye { x: number; y: number; z: number }
/** Extra per-point test (the camera frustum, padded by `pad`). */
export type Accept = (x: number, y: number, z: number, pad: number) => boolean;
export interface OcclusionOpts {
  /** chunks never occluded */
  always?: string[];
  step?: number;
  /** sample rects (world x0, z0, x1, z1) of chunks outside the vis cells (the garden) */
  extra?: Record<string, Rect[]>;
}
export interface ChunkOcclusion {
  visible: (eye: Eye, accept?: Accept | null) => Set<string>;
  nearest: (eye: Eye, maxD: number, accept?: Accept | null) => Map<string, number>;
  chunks: string[];
}
type SampleCell = { id: string; rect: Rect; chunk?: string };
type Sample = [number, number, number];

/** @param chunkOf vis cell → chunk key */
export function createChunkOcclusion(layout: Pick<Layout, 'walls' | 'visCells' | 'plan'>, chunkOf: Record<string, string>, o: OcclusionOpts = {}): ChunkOcclusion {
  const step = o.step ?? 1.0;
  const always = new Set(o.always ?? []);
  // solid walls as 2D segments with their vertical extent and openings (world metres along the wall)
  const walls = layout.walls.filter((w) => w.kind !== 'rail').map((w) => {
    const [ax, az] = w.a, [bx, bz] = w.b;
    return { ax, az, dx: bx - ax, dz: bz - az, len: Math.hypot(bx - ax, bz - az), y0: (w.y0 ?? 0) + (w.level ? 2.9 : 0), h: w.h, ops: (w.openings ?? []).map((q): [number, number, number, number] => [q.at, q.at + q.w, q.sill, q.sill + q.h]) };
  });
  /** chunk → sample points [x, y, z] */
  const samples = new Map<string, Sample[]>();
  const cells: SampleCell[] = [...layout.visCells, ...Object.entries(o.extra ?? {}).flatMap(([key, rs]) => rs.map((rect) => ({ id: key, rect, chunk: key })))];
  for (const c of cells) {
    const key = c.chunk ?? chunkOf[c.id] ?? c.id;
    if (always.has(key) || !c.rect) continue;
    const [x0, z0, x1, z1] = c.rect;
    const lift = c.id === 'MEZ' ? 2.9 : 0;
    const nx = Math.max(1, Math.round((x1 - x0) / step)), nz = Math.max(1, Math.round((z1 - z0) / step));
    const pts: Sample[] = samples.get(key) ?? [];
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
      const x = x0 + 0.15 + (x1 - x0 - 0.3) * (i / nx), z = z0 + 0.15 + (z1 - z0 - 0.3) * (j / nz);
      pts.push([x, lift + 0.45, z], [x, lift + 1.5, z]);
    }
    samples.set(key, pts);
  }
  const rects = new Map<string, [number, number, number, number, number][]>();
  for (const c of cells) {
    const key = c.chunk ?? chunkOf[c.id] ?? c.id;
    if (!c.rect) continue;
    const list = rects.get(key) ?? [];
    rects.set(key, list);
    list.push([c.rect[0], c.rect[1], c.rect[2], c.rect[3], c.id === 'MEZ' ? 1 : 0]);
  }
  // [ENV fix m3 r1] the mezzanine slab (y 2.9 over the plan's mezzanine rects) is solid too: from the mezzanine the
  // library below is out of sight (it was drawn, and drawn at full detail as the "nearest" chunk, from every mezz pose)
  const MEZZ_Y = 2.9;
  const planOnMezz = layout.plan?.onMezz;
  const onMezz = (x: number, z: number): boolean => (planOnMezz ? planOnMezz(x + 20.5, z + 14) : false);
  const slab = (ex: number, ey: number, ez: number, px: number, py: number, pz: number): boolean => {
    if ((ey - MEZZ_Y) * (py - MEZZ_Y) >= 0) return false;
    const t = (MEZZ_Y - ey) / (py - ey);
    return onMezz(ex + (px - ex) * t, ez + (pz - ez) * t);
  };
  /** is the segment eye → p blocked by a solid part of any wall (or the mezzanine slab)? */
  const blocked = (ex: number, ey: number, ez: number, px: number, py: number, pz: number): boolean => {
    if (slab(ex, ey, ez, px, py, pz)) return true;
    const rx = px - ex, rz = pz - ez;
    for (const w of walls) {
      const den = rx * w.dz - rz * w.dx;
      if (Math.abs(den) < 1e-9) continue;
      const qx = w.ax - ex, qz = w.az - ez;
      const t = (qx * w.dz - qz * w.dx) / den; // along the ray
      if (t <= 1e-4 || t >= 1 - 1e-4) continue;
      const u = (qx * rz - qz * rx) / den; // along the wall, 0..1
      if (u < 0 || u > 1) continue;
      const y = ey + (py - ey) * t - w.y0;
      if (y < 0 || y > w.h) continue;
      const s = u * w.len;
      let open = false;
      for (const [a, b, s0, s1] of w.ops) if (s >= a && s <= b && y >= s0 && y <= s1) { open = true; break; }
      if (!open) return true;
    }
    return false;
  };
  // [ENV fix m3 r1] level-aware: the mezzanine cell's rect only holds an eye above the slab, a ground cell's only one below
  // it (LIB and MEZ share one plan rect)
  const inside = (key: string, x: number, y: number, z: number): boolean => (rects.get(key) ?? []).some(([x0, z0, x1, z1, up]) => x >= x0 - 0.3 && x <= x1 + 0.3 && z >= z0 - 0.3 && z <= z1 + 0.3
    && (up ? y > MEZZ_Y : !(y > MEZZ_Y && onMezz(x, z))));
  return {
    chunks: [...samples.keys()],
    /**
     * The chunks with at least one sample point in clear view of the eye (+ `always` + the eye's own chunk).
     * @param accept extra per-point test (the camera
     *   frustum, padded by half the sample spacing so a room's edge never drops out between two samples)
     */
    visible(eye: Eye, accept: Accept | null = null) {
      const out = new Set(always);
      for (const [key, pts] of samples) {
        if (inside(key, eye.x, eye.y, eye.z)) { out.add(key); continue; }
        for (const [x, y, z] of pts) if ((!accept || accept(x, y, z, step * 0.75)) && !blocked(eye.x, eye.y, eye.z, x, y, z)) { out.add(key); break; }
      }
      return out;
    },
    /**
     * [ENV fix m3 r1] LOD distance by line of sight (§5.3 tris): chunk → distance from the eye to its nearest sample
     * point that is in clear view (and passes `accept`), for the chunks with one within `maxD`; the eye's own chunk is
     * 0. A room seen only through a doorway is as near as the doorway's view into it, not as near as its bounding box
     * (from the engine pose the café and archive boxes were 4.5 m away through a wall and drew at full detail).
     * @param maxD LOD cut-off distance
     */
    nearest(eye: Eye, maxD: number, accept: Accept | null = null) {
      const out = new Map<string, number>();
      for (const [key, pts] of samples) {
        if (inside(key, eye.x, eye.y, eye.z)) { out.set(key, 0); continue; }
        let best = Infinity;
        for (const [x, y, z] of pts) {
          const d = Math.hypot(x - eye.x, y - eye.y, z - eye.z);
          if (d >= maxD || d >= best) continue;
          if ((!accept || accept(x, y, z, step * 0.75)) && !blocked(eye.x, eye.y, eye.z, x, y, z)) best = d;
        }
        if (best < maxD) out.set(key, best);
      }
      return out;
    },
  };
}
