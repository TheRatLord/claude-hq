// @pure
/**
 * Static occupancy grids: walls with traversable gaps, rotated obstacle footprints, and per-level
 * rectangles, circles, and segments. Cells outside finite bounds or a level's open rectangles are solid.
 * Walls block a level when they span floor + 0.1 through floor + 1.4; a gap must clear floor + 1.5.
 * `inflate(r)` grows blocked cells for radius-aware planning. Rebuild after geometry changes.
 */
import type { Layout, NavLevel, Rect } from '../layout/schema.ts';

export const CELL = 0.25;
export interface Obstacle { x: number; z: number; r: number; level?: number }
export interface GridOpts { level?: number; obstacles?: readonly Obstacle[] }

export function buildGrid(layout: Layout, cell: number = CELL, opts: GridOpts = {}): Grid {
  const level = opts.level ?? 0;
  const lvl: NavLevel = layout.levels?.find((l) => l.id === level) ?? { id: level, y: 0 };
  const ly = lvl.y ?? 0;
  const b = layout.bounds;
  const pad = 0.5;
  const x0 = b.minX - pad, z0 = b.minZ - pad;
  const cols = Math.ceil((b.maxX - b.minX + 2 * pad) / cell), rows = Math.ceil((b.maxZ - b.minZ + 2 * pad) / cell);
  const occ = new Uint8Array(cols * rows);
  const idx = (c: number, r: number) => r * cols + c;
  const cx = (c: number) => x0 + (c + 0.5) * cell, cz = (r: number) => z0 + (r + 0.5) * cell;
  const inAny = (rects: readonly Rect[], x: number, z: number) => rects.some(([ax, az, bx, bz]) => x >= ax && x <= bx && z >= az && z <= bz);
  // outside the bounds (or outside the level's open rects) is solid
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = cx(c), z = cz(r);
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ || (lvl.open && !inAny(lvl.open, x, z))) occ[idx(c, r)] = 1;
  }
  const fillRect = (px: number, pz: number, hw: number, hd: number, yaw: number, slack = 0) => {
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const ex = Math.abs(cs) * hw + Math.abs(sn) * hd + slack, ez = Math.abs(sn) * hw + Math.abs(cs) * hd + slack;
    const c0 = Math.max(0, Math.floor((px - ex - x0) / cell)), c1 = Math.min(cols - 1, Math.floor((px + ex - x0) / cell));
    const r0 = Math.max(0, Math.floor((pz - ez - z0) / cell)), r1 = Math.min(rows - 1, Math.floor((pz + ez - z0) / cell));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const dx = cx(c) - px, dz = cz(r) - pz;
      // into the rect's local frame (yaw rotates +x toward −z, three's rotation.y)
      const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
      if (Math.abs(lx) <= hw + slack && Math.abs(lz) <= hd + slack) occ[idx(c, r)] = 1;
    }
  };
  const fillCircle = (px: number, pz: number, rad: number) => {
    const c0 = Math.max(0, Math.floor((px - rad - x0) / cell)), c1 = Math.min(cols - 1, Math.floor((px + rad - x0) / cell));
    const r0 = Math.max(0, Math.floor((pz - rad - z0) / cell)), r1 = Math.min(rows - 1, Math.floor((pz + rad - z0) / cell));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if ((cx(c) - px) ** 2 + (cz(r) - pz) ** 2 <= rad * rad) occ[idx(c, r)] = 1;
  };
  const fillSeg = (ax: number, az: number, bx: number, bz: number, t: number, gaps: { at: number; w: number }[] = [], slack = cell * 0.5) => {
    const len = Math.hypot(bx - ax, bz - az) || 1e-6;
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    for (let s = 0; s <= len + 1e-6; s += cell * 0.5) {
      if (gaps.some((o) => s > o.at && s < o.at + o.w)) continue;
      fillRect(ax + ux * s, az + uz * s, t, t, 0, slack);
    }
  };
  for (const w of layout.walls ?? []) {
    const wy0 = w.y0 ?? 0, wy1 = wy0 + w.h;
    if (wy1 < ly + 0.1 || wy0 > ly + 1.4) continue; // not in this level's body band
    const gaps = (w.openings ?? []).filter((o) => {
      const s0 = wy0 + (o.sill ?? 0), s1 = s0 + o.h;
      if (s0 > ly + 0.05 || s1 < ly + 1.5) return false;
      return true;
    });
    fillSeg(w.a[0], w.a[1], w.b[0], w.b[1], (w.t ?? 0.2) / 2, gaps);
  }
  for (const f of layout.obstacles ?? []) {
    if ((f.level ?? 0) !== level) continue;
    fillRect(f.pos.x, f.pos.z, f.size[0] / 2, f.size[1] / 2, f.yaw ?? 0);
  }
  for (const k of lvl.block ?? []) {
    if ('rect' in k) { const [ax, az, bx, bz] = k.rect; fillRect((ax + bx) / 2, (az + bz) / 2, (bx - ax) / 2, (bz - az) / 2, 0); }
    if ('circle' in k) fillCircle(k.circle[0], k.circle[1], k.circle[2]);
    if ('seg' in k) fillSeg(k.seg[0], k.seg[1], k.seg[2], k.seg[3], 0.05);
  }
  for (const o of opts.obstacles ?? []) if ((o.level ?? 0) === level) fillCircle(o.x, o.z, o.r);
  return makeGrid({ cols, rows, x0, z0, cell, occ, level });
}

/** `cost`: optional per-cell extra step cost for weighted A* and string pulling. */
export interface GridData { cols: number; rows: number; x0: number; z0: number; cell: number; occ: Uint8Array; level?: number; cost?: Float32Array | null }
export interface Grid extends GridData {
  col: (x: number) => number;
  row: (z: number) => number;
  inside: (c: number, r: number) => boolean;
  blockedCR: (c: number, r: number) => boolean;
  blocked: (x: number, z: number) => boolean;
  center: (c: number, r: number) => { x: number; z: number };
  /** Grid grown by radius r (m). */
  inflate: (r: number) => Grid;
  /** ASCII occupancy dump. */
  ascii: () => string;
}
export function makeGrid(g: GridData): Grid {
  const { cols, rows, x0, z0, cell, occ } = g;
  const col = (x: number) => Math.floor((x - x0) / cell), row = (z: number) => Math.floor((z - z0) / cell);
  const inside = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows;
  const blockedCR = (c: number, r: number) => !inside(c, r) || occ[r * cols + c] === 1;
  return {
    ...g,
    col, row, inside, blockedCR,
    blocked: (x: number, z: number) => blockedCR(col(x), row(z)),
    center: (c: number, r: number) => ({ x: x0 + (c + 0.5) * cell, z: z0 + (r + 0.5) * cell }),
    /** Grid grown by radius r (m). */
    inflate(r: number): Grid {
      const n = Math.ceil(r / cell - 1e-6);
      const out = new Uint8Array(occ.length);
      for (let rr = 0; rr < rows; rr++) for (let c = 0; c < cols; c++) {
        if (!occ[rr * cols + c]) continue;
        for (let dr = -n; dr <= n; dr++) for (let dc = -n; dc <= n; dc++) {
          if (dc * dc + dr * dr > (n + 0.5) ** 2) continue;
          const c2 = c + dc, r2 = rr + dr;
          if (inside(c2, r2)) out[r2 * cols + c2] = 1;
        }
      }
      return makeGrid({ cols, rows, x0, z0, cell, occ: out, level: g.level, cost: g.cost ?? null });
    },
    /** ASCII occupancy dump. */
    ascii(): string {
      let s = '';
      for (let r = 0; r < rows; r++) { for (let c = 0; c < cols; c++) s += occ[r * cols + c] ? '#' : '.'; s += '\n'; }
      return s;
    },
  };
}
