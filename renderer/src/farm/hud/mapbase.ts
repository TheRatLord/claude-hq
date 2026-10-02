/**
 * The map's static base: a hand-painted parchment chart of the whole world, rendered once to an offscreen canvas
 * (5 px / m) in idle time and blitted by the big map and the minimap (which uses a half-resolution copy).
 *
 * Painted from world/map.ts only (hud never imports scene systems), so where the scene scatters with seeded noise the
 * map re-plays the same noise (world/noise.ts fbm) to stamp trees and hedgerows where the real ones grow:
 *  - a watercolour wash: meadow mosaic (clover drifts, sunny bleached patches), groves and the forest ring, mossy
 *    shelves, ochre rock and pale peaks, toned by the season and faded into bare paper toward the world's edge
 *  - paper grain, fibres and a few tea stains (multiply)
 *  - hachures: short strokes down every steep slope, so the terraced cliff wall reads as inked strata
 *  - water: the river with an inked bank, flow dashes and a sandy ford; the pond with ripple rings and its beach; the
 *    waterfall and the four cliff cascades
 *  - roads as inked double lines (wheel ruts on the big ones), footpaths dashed, trails (world TRAILS, if any) dotted
 *  - hedgerows as beaded green runs, trees as little stamped icons (round / pine / willow, seasonal)
 *  - the square's cobbles, every landmark as a tiny drawing with a cast shadow, the yard's picket fence, the garden
 */
import * as WorldMap from '../world/map.ts';
import { clearance, GARDEN, heightAt, LAUNDRY, PATHS, POND, RIVER, RIVER_HALF_WIDTH, SITES, siteToWorld, STRUCTURES, WORLD, YARD, type XZ } from '../world/map.ts';
import { fbm } from '../world/noise.ts';
import type { Season } from '../model/types.ts';

/** what the base raster covers: the whole world, so panning never shows blank paper */
export const WB = Object.freeze({ x0: -150, x1: 150, z0: -150, z1: 150 });
/** base raster: pixels per metre */
export const S = 5;
const GW = WB.x1 - WB.x0 + 1, GH = WB.z1 - WB.z0 + 1;

// ---------------------------------------------------------------------------------------------- shared helpers

const ss = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mix = (c1: readonly number[], c2: readonly number[], t: number): number[] => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
const ringR = (x: number, z: number) => Math.hypot(x, z * 1.05);
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Optional trail / point-of-interest data in world/map.ts (TRAILS, POIS): read duck-typed so the map draws them once they exist. */
export interface TrailLine { points: readonly XZ[]; width?: number }
export interface Poi { id: string; name: string; x: number; z: number; kind?: string }
const W = WorldMap as unknown as Record<string, unknown>;
const isXZ = (p: unknown): p is XZ => !!p && typeof (p as XZ).x === 'number' && typeof (p as XZ).z === 'number';
export const worldTrails = (): TrailLine[] => parseTrails(W.TRAILS ?? W.TRAIL);
export const worldPois = (): Poi[] => parsePois(W.POIS ?? W.POI);
/** Trails as an array of lines ({ points } or bare XZ[]), a single line, or a record of lines. */
export function parseTrails(raw: unknown): TrailLine[] {
  const list: unknown[] = Array.isArray(raw) ? (raw.length && isXZ(raw[0]) ? [raw] : raw) : raw && typeof raw === 'object' ? (isXZ((raw as { points?: unknown[] }).points?.[0]) ? [raw] : Object.values(raw)) : [];
  const out: TrailLine[] = [];
  for (const t of list) {
    const pts = Array.isArray(t) ? t : (t as { points?: unknown })?.points;
    if (Array.isArray(pts) && pts.length > 1 && pts.every(isXZ)) out.push({ points: pts as XZ[], width: typeof (t as TrailLine).width === 'number' ? (t as TrailLine).width : undefined });
  }
  return out;
}
/** Points of interest as an array or a record of { x, z, name | label | title, kind? }. */
export function parsePois(raw: unknown): Poi[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.entries(raw).map(([k, v]) => ({ id: k, ...(v as object) })) : [];
  const out: Poi[] = [];
  for (const p of list as Record<string, unknown>[]) {
    if (!isXZ(p)) continue;
    const name = String(p.name ?? p.label ?? p.title ?? p.id ?? 'Lookout');
    out.push({ id: String(p.id ?? name), name, x: p.x as number, z: p.z as number, kind: typeof p.kind === 'string' ? p.kind : undefined });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- heights (progressive)

// the 1 m height grid is sampled progressively in idle time (~90k samples ≈ 170 ms of CPU in total)
const H = new Float32Array(GW * GH);
let rowsDone = 0;
export function sampleRows(budgetMs: number): boolean {
  const t0 = performance.now();
  while (rowsDone < GH) {
    const z = WB.z0 + rowsDone;
    for (let i = 0; i < GW; i++) H[rowsDone * GW + i] = heightAt(WB.x0 + i, z);
    rowsDone++;
    if (performance.now() - t0 > budgetMs) break;
  }
  return rowsDone >= GH;
}
const at = (i: number, j: number) => H[Math.min(GH - 1, Math.max(0, j)) * GW + Math.min(GW - 1, Math.max(0, i))];
/** height from the grid (bilinear), world metres */
function hAt(x: number, z: number): number {
  const fx = x - WB.x0, fz = z - WB.z0, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  return lerp(lerp(at(i, j), at(i + 1, j), u), lerp(at(i, j + 1), at(i + 1, j + 1), u), v);
}
/** gradient (dh/dx, dh/dz) from the grid */
function gradAt(x: number, z: number): [number, number] {
  return [(hAt(x + 1, z) - hAt(x - 1, z)) / 2, (hAt(x, z + 1) - hAt(x, z - 1)) / 2];
}
/** 0 flat … 1 vertical, like world slopeAt */
const slope = (x: number, z: number) => { const [gx, gz] = gradAt(x, z); return 1 - 1 / Math.hypot(gx, 1, gz); };

// ---------------------------------------------------------------------------------------------- stamps

interface Stamp { img: HTMLCanvasElement; w: number }
const SEASON_LEAF: Record<Season, [string, string, string][]> = {
  spring: [['#8cc463', '#5f9a42', '#f4b8c8'], ['#9ccf6c', '#689f45', '#fff3f6'], ['#7fb85a', '#55893b', '#f4b8c8']],
  summer: [['#6fae52', '#477d36', ''], ['#7dba5a', '#4f8a3a', ''], ['#5f9e4a', '#3f7030', '']],
  autumn: [['#e09a3e', '#a8622a', ''], ['#d4733a', '#9a4a26', ''], ['#e8bc4a', '#b07f2a', ''], ['#9fa34a', '#6a7232', '']],
  winter: [['#c9c2b4', '#8c7f6c', ''], ['#d6d2c8', '#9a8e7a', '']],
};
function stampCanvas(size: number, draw: (g: CanvasRenderingContext2D, r: number) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.translate(size / 2, size / 2);
  draw(g, size / 2);
  return c;
}
const INK = '#4a2f19';
function treeStamps(season: Season): { round: Stamp[]; pine: Stamp[]; willow: Stamp[] } {
  const N = 40;
  const round = SEASON_LEAF[season].map(([fill, dark, dot]) => ({ w: N, img: stampCanvas(N, (g, r) => {
    // cast shadow, trunk, then a lumpy canopy with a light top-left and an ink outline
    g.fillStyle = 'rgba(60, 40, 20, .28)'; g.beginPath(); g.ellipse(r * 0.22, r * 0.34, r * 0.62, r * 0.42, 0, 0, Math.PI * 2); g.fill();
    if (season === 'winter') {
      g.strokeStyle = '#6a5038'; g.lineWidth = r * 0.09; g.lineCap = 'round';
      g.beginPath();
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + 0.3; g.moveTo(0, 0); g.lineTo(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62); }
      g.stroke();
      g.strokeStyle = dark; g.lineWidth = r * 0.05; g.beginPath(); g.arc(0, 0, r * 0.66, 0, Math.PI * 2); g.stroke();
      return;
    }
    g.beginPath();
    for (let k = 0; k <= 7; k++) {
      const a = (k / 7) * Math.PI * 2, rr = r * (0.62 + 0.07 * Math.sin(k * 2.3));
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr - r * 0.08;
      if (k === 0) g.moveTo(x, y); else g.quadraticCurveTo(Math.cos(a - 0.45) * rr * 1.18, Math.sin(a - 0.45) * rr * 1.18 - r * 0.08, x, y);
    }
    g.closePath();
    g.fillStyle = fill; g.fill();
    g.lineWidth = r * 0.07; g.strokeStyle = dark; g.stroke();
    g.fillStyle = 'rgba(255, 250, 220, .35)'; g.beginPath(); g.arc(-r * 0.2, -r * 0.3, r * 0.26, 0, Math.PI * 2); g.fill();
    if (dot) { g.fillStyle = dot; for (const [dx, dy] of [[-0.25, 0.1], [0.2, -0.2], [0.15, 0.25], [-0.05, -0.38]]) { g.beginPath(); g.arc(dx * r, dy * r, r * 0.08, 0, Math.PI * 2); g.fill(); } }
  }) }));
  const pine = [['#4f8a55', '#2f5a3a'], ['#5d9660', '#36633f'], ['#447a4c', '#28503a']].map(([fill, dark]) => ({ w: N, img: stampCanvas(N, (g, r) => {
    g.fillStyle = 'rgba(60, 40, 20, .28)'; g.beginPath(); g.ellipse(r * 0.26, r * 0.42, r * 0.44, r * 0.26, 0, 0, Math.PI * 2); g.fill();
    // a stacked fir seen from a low oblique: two tiers and a tip
    const tier = (y: number, w: number, hgt: number) => { g.beginPath(); g.moveTo(0, y - hgt); g.lineTo(w, y); g.quadraticCurveTo(0, y + hgt * 0.18, -w, y); g.closePath(); g.fill(); g.stroke(); };
    g.fillStyle = season === 'winter' ? '#5f8a66' : fill; g.strokeStyle = dark; g.lineWidth = r * 0.07; g.lineJoin = 'round';
    tier(r * 0.5, r * 0.5, r * 0.62); tier(r * 0.12, r * 0.4, r * 0.56);
    if (season === 'winter') { g.fillStyle = '#f4f6f4'; g.beginPath(); g.moveTo(0, -r * 0.44); g.lineTo(r * 0.16, -r * 0.22); g.lineTo(-r * 0.16, -r * 0.22); g.closePath(); g.fill(); }
  }) }));
  const willow = [{ w: N, img: stampCanvas(N, (g, r) => {
    g.fillStyle = 'rgba(60, 40, 20, .25)'; g.beginPath(); g.ellipse(r * 0.2, r * 0.36, r * 0.64, r * 0.4, 0, 0, Math.PI * 2); g.fill();
    const leaf = season === 'autumn' ? '#c9b24a' : season === 'winter' ? '#b8b49a' : '#9cc66a';
    g.fillStyle = leaf; g.strokeStyle = season === 'autumn' ? '#8a7a2a' : '#5f8a3a'; g.lineWidth = r * 0.06;
    g.beginPath(); g.arc(0, -r * 0.05, r * 0.6, 0, Math.PI * 2); g.fill(); g.stroke();
    // drooping fronds
    g.beginPath();
    for (let k = -3; k <= 3; k++) { g.moveTo(k * r * 0.15, -r * 0.35); g.quadraticCurveTo(k * r * 0.2, r * 0.1, k * r * 0.18, r * 0.42); }
    g.stroke();
  }) }];
  return { round, pine, willow };
}

// ---------------------------------------------------------------------------------------------- scatter (mirrors flora/scatter.ts)

interface Tree { x: number; z: number; s: number; k: 'round' | 'pine' | 'willow'; v: number }
function treesFor(): Tree[] {
  const out: Tree[] = [];
  const near = (x: number, z: number, d: number) => out.some((t) => Math.abs(t.x - x) < d && Math.abs(t.z - z) < d && Math.hypot(t.x - x, t.z - z) < d);
  const nearWater = (x: number, z: number) => Math.min(WorldMap.distToPolyline(x, z, RIVER) - RIVER_HALF_WIDTH, Math.hypot(x - POND.x, z - POND.z) - POND.r);
  const FALL = STRUCTURES.find((s) => s.id === 'waterfall')!;
  // the forest ring: pines and firs, thickest at the rim, thinning up the high rock
  const rf = rng(0x5eed1);
  for (let z = WB.z0; z < WB.z1; z += 4.2) for (let x = WB.x0; x < WB.x1; x += 4.2) {
    const px = x + (rf() - 0.5) * 3.8, pz = z + (rf() - 0.5) * 3.8, roll = rf(), kind = rf(), v = rf();
    const R = ringR(px, pz);
    if (R < 62) continue;
    const h = hAt(px, pz), sl = slope(px, pz);
    const n = fbm(px / 34 + 11, pz / 34 - 5, 3);
    const dens = ss(64, 96, R) * (1 - ss(34, 44, h)) * (1 - ss(0.42, 0.62, sl)) * (0.55 + 0.6 * ss(-0.4, 0.4, n));
    if (roll > dens * 0.95) continue;
    if (h < WORLD.water + 0.8 || nearWater(px, pz) < 3.5 || Math.hypot(px - FALL.x, pz - FALL.z) < 16) continue;
    if (R < 100 && clearance(px, pz) < 3) continue;
    const deciduous = R < 88 && kind < 0.3 * (1 - ss(78, 90, R));
    out.push({ x: px, z: pz, s: 0.95 + v * 0.4 + ss(90, 120, R) * 0.15, k: deciduous ? 'round' : 'pine', v: Math.floor(v * 7) });
  }
  // valley groves
  const rg = rng(0x5eed2);
  for (let z = -100; z < 100; z += 5) for (let x = -100; x < 100; x += 5) {
    const px = x + (rg() - 0.5) * 4.6, pz = z + (rg() - 0.5) * 4.6, roll = rg(), v = rg();
    if (ringR(px, pz) > 90) continue;
    const gq = fbm(px / 42 - 3, pz / 42 + 8, 3);
    const p = gq > 0.05 ? 0.3 + 0.55 * ss(0.05, 0.4, gq) : 0.08;
    if (roll > p || nearWater(px, pz) < 4 || near(px, pz, 3.7) || clearance(px, pz) < 2.4) continue;
    out.push({ x: px, z: pz, s: 0.85 + v * 0.35, k: v < 0.18 ? 'pine' : 'round', v: Math.floor(v * 7) });
  }
  // willows along the water
  const rw = rng(0x5eed3);
  for (let i = 0; i < 90; i++) {
    let x: number, z: number;
    if (i % 5 === 0) { const a = rw() * 6.28, d = POND.r + 4 + rw() * 2; x = POND.x + Math.cos(a) * d; z = POND.z + Math.sin(a) * d; }
    else {
      const t = rw(), k = Math.min(RIVER.length - 2, Math.floor(t * (RIVER.length - 1))), f = t * (RIVER.length - 1) - k;
      const a = RIVER[k], b = RIVER[k + 1], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
      const side = rw() < 0.5 ? -1 : 1, off = RIVER_HALF_WIDTH + 5 + rw() * 3;
      x = a.x + dx * f - (dz / l) * off * side; z = a.z + dz * f + (dx / l) * off * side;
    }
    if (rw() < 0.45 || ringR(x, z) > 112 || hAt(x, z) > 8 || near(x, z, 6) || clearance(x, z) < 1.2) continue;
    out.push({ x, z, s: 1.05, k: 'willow', v: 0 });
  }
  return out;
}

/** Hedgerow beads: along the tracks (runs where a slow noise says so) and round the backs / sides of the field sites. */
function hedgesFor(): { x: number; z: number; a: number }[] {
  const out: { x: number; z: number; a: number }[] = [];
  const add = (x: number, z: number, dx: number, dz: number) => {
    const R = ringR(x, z);
    if (R < 24 || R > 88 || Math.hypot(x, z + 1) < 26 || slope(x, z) > 0.18) return;
    if (Math.min(WorldMap.distToPolyline(x, z, RIVER) - RIVER_HALF_WIDTH, Math.hypot(x - POND.x, z - POND.z) - POND.r) < 2.5) return;
    if (out.some((q) => Math.abs(q.x - x) < 2.4 && Math.abs(q.z - z) < 2.4 && Math.hypot(q.x - x, q.z - z) < 2.4)) return;
    if (clearance(x, z) < 1.1) return;
    out.push({ x, z, a: Math.atan2(dz, dx) });
  };
  for (const [pi, path] of PATHS.entries()) {
    const pts = path.points;
    for (const side of [-1, 1]) {
      let d = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
        for (let t = 0; t < l; t += 2.6, d += 2.6) {
          if (fbm(d / 26 + pi * 7.3 + side * 3.1, pi * 1.7) < -0.08) continue;
          const off = path.width / 2 + 2;
          add(a.x + dx * (t / l) - (dz / l) * off * side, a.z + dz * (t / l) + (dx / l) * off * side, dx / l, dz / l);
        }
      }
    }
  }
  for (const site of SITES) {
    const c = Math.cos(site.yaw), sn = Math.sin(site.yaw);
    const edges: [number, number, number, number][] = [
      [-site.w / 2 - 0.5, -site.d / 2 - 2.1, site.w / 2 + 0.5, -site.d / 2 - 2.1],
      [-site.w / 2 - 2.1, -site.d / 2 - 0.5, -site.w / 2 - 2.1, site.d / 2 - 1],
      [site.w / 2 + 2.1, -site.d / 2 - 0.5, site.w / 2 + 2.1, site.d / 2 - 1],
    ];
    for (const [ax, az, bx, bz] of edges) {
      const l = Math.hypot(bx - ax, bz - az), lx = (bx - ax) / l, lz = (bz - az) / l, wx = lx * c + lz * sn, wz = -lx * sn + lz * c;
      for (let t = 1.2; t < l - 1; t += 2.6) {
        const p = siteToWorld(site, ax + lx * t, az + lz * t);
        if (fbm(p.x / 14 + 4, p.z / 14 - 2) < -0.25) continue;
        add(p.x, p.z, wx, wz);
      }
    }
  }
  return out;
}

/** The four cliff cascades (scene/terrain/features.ts TRICKLES, re-traced here on the same land). */
function cascades(): XZ[][] {
  const out: XZ[][] = [];
  for (const a0 of [0.12, 0.95, 3.55, 5.35]) {
    let x = 0, z = 0;
    for (let r = WORLD.rim; r < WORLD.rim + 60; r += 1) { x = Math.cos(a0) * r; z = (Math.sin(a0) * r) / 1.05; if (hAt(x, z) > 30) break; }
    const pts: XZ[] = [];
    for (let i = 0; i < 160; i++) {
      const [gx, gz] = gradAt(x, z), gl = Math.hypot(gx, gz) || 1, inw = Math.hypot(x, z) || 1;
      let dx = -x / inw * 0.65 - gx / gl * 0.35, dz = -z / inw * 0.65 - gz / gl * 0.35;
      const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
      pts.push({ x, z });
      if (hAt(x, z) < 7 || Math.hypot(x, z * 1.05) < WORLD.rim - 6) break;
      x += dx * 0.7; z += dz * 0.7;
    }
    if (pts.length > 16) out.push(pts);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- the painting

let base: HTMLCanvasElement | null = null;
let half: HTMLCanvasElement | null = null;
let baseSeason: Season | null = null;
export const baseReady = () => !!base;

const P = (x: number, z: number): [number, number] => [(x - WB.x0) * S, (z - WB.z0) * S];
/** a smooth stroke through polyline points (quadratic through midpoints) */
function smoothLine(g: CanvasRenderingContext2D | Path2D, pts: readonly XZ[]): void {
  if (pts.length < 2) return;
  const [x0, y0] = P(pts[0].x, pts[0].z);
  g.moveTo(x0, y0);
  for (let i = 1; i < pts.length - 1; i++) {
    const [cx, cy] = P(pts[i].x, pts[i].z), [nx, ny] = P(pts[i + 1].x, pts[i + 1].z);
    g.quadraticCurveTo(cx, cy, (cx + nx) / 2, (cy + ny) / 2);
  }
  const [lx, ly] = P(pts[pts.length - 1].x, pts[pts.length - 1].z);
  g.lineTo(lx, ly);
}

/** Paper grain: a tile of speckle + fibres, multiplied over everything. */
function paperTile(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const img = g.createImageData(256, 256);
  const r = rng(77);
  for (let i = 0; i < 256 * 256; i++) {
    const x = i % 256, y = (i / 256) | 0;
    const lo = 0.5 + 0.5 * Math.sin(x * 0.049 + Math.sin(y * 0.031) * 2) * Math.sin(y * 0.043 + Math.cos(x * 0.027) * 2);
    const v = 236 + lo * 14 + (r() - 0.5) * 16;
    img.data[i * 4] = Math.min(255, v + 4); img.data[i * 4 + 1] = Math.min(255, v); img.data[i * 4 + 2] = Math.min(255, v - 10); img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(150, 120, 80, .13)'; g.lineWidth = 0.7;
  for (let k = 0; k < 70; k++) {
    const x = r() * 256, y = r() * 256, a = r() * Math.PI, l = 4 + r() * 12;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a + 0.6) * l * 0.5, y + Math.sin(a + 0.6) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  return c;
}

/** Build (once per season) the static parchment base. Heavy (~150–300 ms): warmBase() gets it ready in idle time. */
export function getBase(season: Season = 'summer'): HTMLCanvasElement {
  if (base && baseSeason === season) return base;
  sampleRows(Infinity);
  baseSeason = season;
  const t0 = performance.now();

  // ---- 1. the watercolour wash, 1 px per metre, upscaled soft ----
  const small = document.createElement('canvas');
  small.width = GW; small.height = GH;
  const sg = small.getContext('2d')!;
  const img = sg.createImageData(GW, GH);
  const PARCH = [242, 228, 192];
  const tone = season === 'autumn' ? [206, 186, 108] : season === 'winter' ? [222, 226, 220] : season === 'spring' ? [168, 208, 122] : [160, 198, 110];
  const MEADOW = mix([174, 202, 118], tone, 0.35), CLOVER = mix([138, 178, 98], tone, 0.25), SUN = mix([206, 210, 136], tone, 0.3);
  const GROVE = season === 'autumn' ? [170, 150, 84] : season === 'winter' ? [178, 184, 170] : [128, 166, 96];
  const FOREST = season === 'winter' ? [130, 156, 132] : [100, 146, 102];
  const MOSS = season === 'winter' ? [214, 218, 212] : [158, 170, 108], ROCK = [190, 168, 134], ROCK2 = [168, 146, 118], PEAK = [236, 230, 216];
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const x = WB.x0 + i, z = WB.z0 + j, hgt = at(i, j), R = ringR(x, z);
    const dx = (at(i + 1, j) - at(i - 1, j)) / 2, dz = (at(i, j + 1) - at(i, j - 1)) / 2;
    const sl = Math.hypot(dx, dz);
    const m = fbm(x / 30 + 3.1, z / 30 - 7.7, 3), sun = fbm(x / 55 + 9, z / 55 - 3, 2);
    let c = mix(MEADOW, CLOVER, ss(-0.05, 0.35, m));
    c = mix(c, SUN, ss(0.1, 0.45, sun) * 0.7);
    if (R < 90) c = mix(c, GROVE, ss(0.05, 0.35, fbm(x / 42 - 3, z / 42 + 8, 3)) * 0.55);
    c = mix(c, FOREST, ss(64, 96, R) * (1 - ss(34, 44, hgt)) * 0.8);
    // up the wall: mossy shelves, ochre rock on the risers, pale high peaks
    const high = ss(6, 14, hgt);
    c = mix(c, mix(MOSS, sl > 0.9 ? ROCK2 : ROCK, ss(0.35, 0.9, sl)), high * 0.85);
    c = mix(c, PEAK, ss(40, 70, hgt) * 0.8);
    // soft hillshade from the north-west
    const shade = Math.max(-0.35, Math.min(0.3, (-dx * 0.55 - dz * 0.55) * 0.28));
    c = c.map((v) => v * (1 + shade));
    c = mix(c, PARCH, 0.22 + ss(118, 148, R) * 0.7);
    const o = (j * GW + i) * 4;
    img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
  }
  sg.putImageData(img, 0, 0);
  const cv = document.createElement('canvas');
  cv.width = (GW - 1) * S; cv.height = (GH - 1) * S;
  const g = cv.getContext('2d')!;
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(small, 0, 0, GW, GH, -S / 2, -S / 2, GW * S, GH * S);
  g.lineCap = 'round'; g.lineJoin = 'round';

  // ---- 2. paper grain ----
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = g.createPattern(paperTile(), 'repeat')!;
  g.fillRect(0, 0, cv.width, cv.height);
  // a few tea stains
  const rs = rng(4242);
  for (let k = 0; k < 9; k++) {
    const x = rs() * cv.width, y = rs() * cv.height, r = 60 + rs() * 160;
    const st = g.createRadialGradient(x, y, r * 0.6, x, y, r);
    st.addColorStop(0, 'rgba(255,255,255,0)'); st.addColorStop(0.85, 'rgba(196,160,110,.10)'); st.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = st; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.restore();

  // ---- 3. hachures down the steep ground (strata read as inked bands) ----
  const hr = rng(99);
  const buckets = [new Path2D(), new Path2D(), new Path2D()];
  for (let z = WB.z0 + 1; z < WB.z1 - 1; z += 1.5) for (let x = WB.x0 + 1; x < WB.x1 - 1; x += 1.5) {
    const px = x + (hr() - 0.5) * 1.1, pz = z + (hr() - 0.5) * 1.1;
    const [gx, gz] = gradAt(px, pz), s = Math.hypot(gx, gz);
    if (s < 0.42 || hAt(px, pz) < WORLD.water + 0.3) continue;
    const L = 0.7 + Math.min(1.6, s * 0.5), ux = -gx / s, uz = -gz / s;
    const [x0, y0] = P(px, pz), [x1, y1] = P(px + ux * L, pz + uz * L);
    const b = buckets[s > 1.6 ? 2 : s > 0.85 ? 1 : 0];
    b.moveTo(x0, y0); b.lineTo(x1, y1);
  }
  g.lineWidth = 1.1;
  ['rgba(92, 62, 36, .11)', 'rgba(92, 62, 36, .24)', 'rgba(80, 52, 30, .4)'].forEach((c, k) => { g.strokeStyle = c; g.stroke(buckets[k]); });

  // ---- 4. water ----
  // river banks (a damp darker margin), inked edge, wash, flow dashes
  const river = new Path2D(); smoothLine(river, RIVER);
  g.strokeStyle = 'rgba(96, 120, 70, .25)'; g.lineWidth = (RIVER_HALF_WIDTH * 2 + 5) * S; g.stroke(river);
  g.strokeStyle = '#3d6d94'; g.lineWidth = (RIVER_HALF_WIDTH * 2 + 0.9) * S; g.stroke(river);
  g.strokeStyle = '#9ccae4'; g.lineWidth = RIVER_HALF_WIDTH * 2 * S; g.stroke(river);
  g.strokeStyle = 'rgba(190, 226, 244, .9)'; g.lineWidth = RIVER_HALF_WIDTH * 0.9 * S; g.stroke(river);
  g.strokeStyle = 'rgba(61, 109, 148, .55)'; g.lineWidth = 1.2;
  for (const side of [-0.42, 0.42]) {
    const off = RIVER.map((p, i) => {
      const a = RIVER[Math.max(0, i - 1)], b = RIVER[Math.min(RIVER.length - 1, i + 1)], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
      return { x: p.x - (dz / l) * RIVER_HALF_WIDTH * side, z: p.z + (dx / l) * RIVER_HALF_WIDTH * side };
    });
    g.setLineDash([2.2 * S, 3.4 * S]); g.lineDashOffset = side > 0 ? 0 : 2.6 * S;
    g.beginPath(); smoothLine(g, off); g.stroke();
  }
  g.setLineDash([]); g.lineDashOffset = 0;
  // the pond: a sandy beach on its sunny south-east shore, ink edge, ripple rings
  const [px, py] = P(POND.x, POND.z);
  g.fillStyle = 'rgba(232, 208, 150, .9)'; g.beginPath(); g.ellipse(px + 1.2 * S, py + 2.4 * S, (POND.r + 3.2) * S, (POND.r + 2.6) * S, 0.25, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(px, py, POND.r * S, 0, Math.PI * 2);
  g.fillStyle = '#9ccae4'; g.fill(); g.strokeStyle = '#3d6d94'; g.lineWidth = 0.55 * S; g.stroke();
  g.fillStyle = 'rgba(190, 226, 244, .9)'; g.beginPath(); g.arc(px - 1.4 * S, py - 1.2 * S, POND.r * 0.62 * S, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(61, 109, 148, .5)'; g.lineWidth = 1.2;
  for (const [k, a0, a1] of [[0.78, 0.3, 2.2], [0.78, 3.4, 4.6], [0.52, 1.0, 3.0], [0.52, 4.0, 5.6], [0.28, 0, 4.2]] as const) {
    g.beginPath(); g.arc(px, py, POND.r * k * S, a0, a1); g.stroke();
  }
  // lily pads
  g.fillStyle = '#6fa65a';
  for (const [dx, dz] of [[-5.5, 2.4], [-4.4, 3.6], [5.2, -4.1]]) { g.beginPath(); g.arc(px + dx * S, py + dz * S, 0.7 * S, 0.4, Math.PI * 2 - 0.2); g.lineTo(px + dx * S, py + dz * S); g.fill(); }
  // the waterfall and the cascades: white water with an inked edge
  for (const t of cascades()) {
    const p = new Path2D(); smoothLine(p, t);
    g.strokeStyle = '#3d6d94'; g.lineWidth = 2.0 * S; g.stroke(p);
    g.strokeStyle = '#e8f6fc'; g.lineWidth = 1.2 * S; g.stroke(p);
  }
  {
    const wf = STRUCTURES.find((s) => s.id === 'waterfall')!;
    const [wx, wy] = P(wf.x, wf.z);
    g.save(); g.translate(wx, wy); g.rotate(-wf.yaw);
    g.fillStyle = '#e8f6fc'; g.strokeStyle = '#3d6d94'; g.lineWidth = 0.4 * S;
    g.beginPath(); g.moveTo(-4 * S, -6 * S); g.lineTo(4 * S, -6 * S); g.lineTo(5 * S, 3 * S); g.lineTo(-5 * S, 3 * S); g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = 'rgba(61,109,148,.45)'; g.lineWidth = 1.2;
    for (let k = -3; k <= 3; k++) { g.beginPath(); g.moveTo(k * S, -5.5 * S); g.lineTo(k * 1.2 * S, 2.6 * S); g.stroke(); }
    g.restore();
  }

  // ---- 5. the square, roads, footpaths, trails ----
  {
    const [sx0, sy0] = P(-12.5, -9), [sx1, sy1] = P(12.5, 12);
    g.fillStyle = '#ecdcb6'; g.strokeStyle = '#7a5636'; g.lineWidth = 0.35 * S;
    roundRectPath(g, sx0, sy0, sx1 - sx0, sy1 - sy0, 3 * S); g.fill(); g.stroke();
    // cobbles
    const rc = rng(5);
    g.fillStyle = 'rgba(150, 110, 70, .13)';
    for (let k = 0; k < 300; k++) { const x = lerp(sx0 + 6, sx1 - 6, rc()), y = lerp(sy0 + 6, sy1 - 6, rc()); g.beginPath(); g.ellipse(x, y, 2.2, 1.5, rc() * 3, 0, Math.PI * 2); g.fill(); }
  }
  const roads = PATHS.filter((p) => p.width >= 1.8), foot = PATHS.filter((p) => p.width < 1.8);
  for (const p of roads) { g.beginPath(); smoothLine(g, p.points); g.strokeStyle = '#6b4a2b'; g.lineWidth = (p.width + 0.7) * S; g.stroke(); }
  for (const p of roads) { g.beginPath(); smoothLine(g, p.points); g.strokeStyle = '#ecd6a2'; g.lineWidth = p.width * S; g.stroke(); }
  g.strokeStyle = 'rgba(150, 110, 66, .45)'; g.lineWidth = 1; g.setLineDash([1.4 * S, 1.1 * S]);
  for (const p of roads) if (p.width >= 2.4) { g.beginPath(); smoothLine(g, p.points); g.stroke(); }
  g.setLineDash([1.3 * S, 0.9 * S]); g.strokeStyle = '#6b4a2b'; g.lineWidth = 0.55 * S;
  for (const p of foot) { g.beginPath(); smoothLine(g, p.points); g.stroke(); }
  g.setLineDash([]);
  for (const t of worldTrails()) {
    g.beginPath(); smoothLine(g, t.points);
    g.strokeStyle = 'rgba(248, 236, 206, .75)'; g.lineWidth = 1.4 * S; g.stroke();
    g.beginPath(); smoothLine(g, t.points);
    g.strokeStyle = '#9a3b2a'; g.lineWidth = 0.7 * S; g.setLineDash([0.01, 1.5 * S]); g.stroke(); g.setLineDash([]);
  }

  // ---- 6. the yard, the garden, the laundry line ----
  {
    const [x0, y0] = P(YARD.x0, YARD.z0), [x1, y1] = P(YARD.x1, YARD.z1);
    g.fillStyle = 'rgba(176, 210, 120, .75)'; g.fillRect(x0, y0, x1 - x0, y1 - y0);
    g.strokeStyle = '#fff6e0'; g.lineWidth = 0.5 * S; g.strokeRect(x0, y0, x1 - x0, y1 - y0);
    g.strokeStyle = '#6b4a2b'; g.lineWidth = 0.22 * S; g.setLineDash([0.35 * S, 0.35 * S]); g.strokeRect(x0, y0, x1 - x0, y1 - y0); g.setLineDash([]);
    const [gx0, gy0] = P(GARDEN.x0, GARDEN.z0), [gx1, gy1] = P(GARDEN.x1, GARDEN.z1);
    g.fillStyle = '#b98a5a'; g.fillRect(gx0, gy0, gx1 - gx0, gy1 - gy0);
    g.strokeStyle = '#6f9a48'; g.lineWidth = 0.4 * S;
    for (let x = gx0 + S; x < gx1; x += 1.1 * S) { g.beginPath(); g.moveTo(x, gy0 + S * 0.6); g.lineTo(x, gy1 - S * 0.6); g.stroke(); }
    const [lx, ly0] = P(LAUNDRY.x, LAUNDRY.z0), [, ly1] = P(LAUNDRY.x, LAUNDRY.z1);
    g.strokeStyle = '#6b4a2b'; g.lineWidth = 0.15 * S; g.beginPath(); g.moveTo(lx, ly0); g.lineTo(lx, ly1); g.stroke();
    for (const [k, c] of [[0.25, '#e8e2f4'], [0.5, '#f0a0a0'], [0.72, '#9cc8e8']] as const) { g.fillStyle = c; g.fillRect(lx - 0.5 * S, lerp(ly0, ly1, k), S, 0.8 * S); }
  }

  // ---- 7. hedgerows and trees (stamped) ----
  g.fillStyle = season === 'autumn' ? '#7f8a3c' : season === 'winter' ? '#7d8a70' : '#55833f';
  g.strokeStyle = 'rgba(40, 60, 25, .7)'; g.lineWidth = 0.18 * S;
  for (const hd of hedgesFor()) {
    const [x, y] = P(hd.x, hd.z);
    g.beginPath(); g.ellipse(x, y, 1.6 * S, 0.75 * S, hd.a, 0, Math.PI * 2); g.fill(); g.stroke();
  }
  const st = treeStamps(season);
  const trees = treesFor().sort((a, b) => a.z - b.z);
  for (const t of trees) {
    const set = st[t.k], sp = set[t.v % set.length];
    const sz = (t.k === 'pine' ? 5.2 : t.k === 'willow' ? 6.6 : 6.2) * t.s * S;
    const [x, y] = P(t.x, t.z);
    g.drawImage(sp.img, x - sz / 2, y - sz / 2, sz, sz);
  }

  // ---- 8. landmarks: little drawings with a cast shadow ----
  for (const s of STRUCTURES) drawStructure(g, s, st.round[0]);
  // field sites stay meadow until tilled (plots are live); nothing else to paint for them

  half = null;
  base = cv;
  if (performance.now() - t0 > 400) console.warn(`[map] base painted in ${Math.round(performance.now() - t0)} ms`);
  return cv;
}

/** A half-resolution copy for the minimap (cleaner and cheaper to downsample). */
export function getHalf(): HTMLCanvasElement | null {
  if (!base) return null;
  if (half) return half;
  const c = document.createElement('canvas');
  c.width = Math.ceil(base.width / 2); c.height = Math.ceil(base.height / 2);
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(base, 0, 0, c.width, c.height);
  half = c;
  return c;
}

/** Start sampling the map heights in idle time so the first map open is instant. */
export function warmBase(season: () => Season): void {
  type Idle = (cb: (d: { timeRemaining(): number }) => void, o?: { timeout: number }) => number;
  const ric = (window as unknown as { requestIdleCallback?: Idle }).requestIdleCallback;
  const step = (d?: { timeRemaining(): number }) => {
    if (base) return;
    if (sampleRows(Math.max(2, Math.min(8, d ? d.timeRemaining() - 1 : 4)))) { getBase(season()); getHalf(); return; }
    if (ric) ric(step, { timeout: 1000 }); else setTimeout(() => step(), 16);
  };
  if (ric) ric(step, { timeout: 3000 }); else setTimeout(() => step(), 500);
}

export function roundRectPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

function drawStructure(g: CanvasRenderingContext2D, s: (typeof STRUCTURES)[number], tree: Stamp): void {
  const [x, y] = P(s.x, s.z);
  const w = s.size[0] * S, d = s.size[1] * S;
  g.save(); g.translate(x, y); g.rotate(-s.yaw);
  g.lineWidth = 0.3 * S; g.strokeStyle = INK;
  const dot = (dx: number, dz: number, r: number, c: string) => { g.beginPath(); g.arc(dx * S, dz * S, r * S, 0, Math.PI * 2); g.fillStyle = c; g.fill(); g.stroke(); };
  const shadowRect = (ww: number, dd: number) => { g.fillStyle = 'rgba(60, 40, 20, .28)'; g.fillRect(-ww / 2 + 0.9 * S, -dd / 2 + 0.9 * S, ww, dd); };
  const house = (fill: string, roof: string) => {
    shadowRect(w, d);
    g.fillStyle = fill; g.fillRect(-w / 2, -d / 2, w, d); g.strokeRect(-w / 2, -d / 2, w, d);
    // a pitched roof: the shaded half hatched
    g.fillStyle = roof; g.fillRect(-w / 2, 0, w, d / 2);
    g.strokeStyle = 'rgba(60, 30, 15, .35)'; g.lineWidth = 0.18 * S;
    for (let k = -w / 2 + 0.8 * S; k < w / 2; k += 0.9 * S) { g.beginPath(); g.moveTo(k, 0.2 * S); g.lineTo(k, d / 2 - 0.2 * S); g.stroke(); }
    g.strokeStyle = INK; g.lineWidth = 0.3 * S; g.strokeRect(-w / 2, -d / 2, w, d);
    g.beginPath(); g.moveTo(-w / 2, 0); g.lineTo(w / 2, 0); g.stroke();
  };
  switch (s.id) {
    case 'farmhouse': house('#e8a46a', '#c87e4a'); dot(w / S / 2 - 2, -d / S / 2 + 1.6, 0.7, '#9a8a7a'); break;
    case 'barn': house('#d0584a', '#a83e34'); break;
    case 'toolshed': house('#b8875a', '#93663e'); break;
    case 'silo': case 'waterTower': {
      g.fillStyle = 'rgba(60, 40, 20, .28)'; g.beginPath(); g.arc(0.9 * S, 0.9 * S, Math.min(w, d) / 2.4, 0, Math.PI * 2); g.fill();
      dot(0, 0, Math.min(s.size[0], s.size[1]) / 2.4, '#d4dade');
      g.fillStyle = 'rgba(255,255,255,.7)'; g.beginPath(); g.arc(-0.8 * S, -0.8 * S, Math.min(w, d) / 7, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'windmill': {
      dot(0, 0, s.size[0] / 4, '#e6d2a8');
      g.lineWidth = 0.9 * S; g.strokeStyle = INK;
      g.beginPath(); g.moveTo(-w / 1.6, 0); g.lineTo(w / 1.6, 0); g.moveTo(0, -w / 1.6); g.lineTo(0, w / 1.6); g.stroke();
      g.lineWidth = 0.5 * S; g.strokeStyle = '#f4ead2';
      g.beginPath(); g.moveTo(-w / 1.7, 0); g.lineTo(w / 1.7, 0); g.moveTo(0, -w / 1.7); g.lineTo(0, w / 1.7); g.stroke();
      break;
    }
    case 'well': dot(0, 0, 1.1, '#b9b4a8'); dot(0, 0, 0.55, '#5f9ccc'); break;
    case 'campfire': {
      g.fillStyle = 'rgba(122, 86, 54, .25)'; g.beginPath(); g.arc(0, 0, w / 2, 0, Math.PI * 2); g.fill();
      for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.4; g.fillStyle = '#8a5a36'; g.fillRect(Math.cos(a) * 2.6 * S - 0.9 * S, Math.sin(a) * 2.6 * S - 0.35 * S, 1.8 * S, 0.7 * S); }
      dot(0, 0, 0.9, '#f08a2c'); g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(0, 0, 0.45 * S, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'dock': case 'bridge': {
      shadowRect(w, d);
      g.fillStyle = '#c0915a'; g.fillRect(-w / 2, -d / 2, w, d); g.strokeRect(-w / 2, -d / 2, w, d);
      g.strokeStyle = 'rgba(74, 47, 25, .55)'; g.lineWidth = 0.15 * S;
      for (let k = -d / 2 + 0.8 * S; k < d / 2; k += 0.8 * S) { g.beginPath(); g.moveTo(-w / 2, k); g.lineTo(w / 2, k); g.stroke(); }
      break;
    }
    case 'waterfall': break;
    case 'hotspring': dot(0, 0, Math.min(s.size[0], s.size[1]) / 2.6, '#b8dcef'); g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 0.2 * S; g.beginPath(); g.arc(0, 0, 1.4 * S, 0, Math.PI * 2); g.stroke(); break;
    case 'lookout': {
      g.fillStyle = '#c99a62'; g.beginPath();
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + Math.PI / 8, r = w / 2.3; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      g.closePath(); g.fill(); g.stroke();
      break;
    }
    case 'pergola': {
      shadowRect(w, d);
      g.strokeStyle = '#7a5636'; g.lineWidth = 0.35 * S;
      g.strokeRect(-w / 2, -d / 2, w, d);
      for (let k = -w / 2 + S; k < w / 2; k += 1.1 * S) { g.beginPath(); g.moveTo(k, -d / 2); g.lineTo(k, d / 2); g.stroke(); }
      break;
    }
    case 'picnic': {
      g.fillStyle = '#e46a5a'; g.fillRect(-1.6 * S, -1.4 * S, 3.2 * S, 2.8 * S);
      g.fillStyle = 'rgba(255,255,255,.75)';
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2 === 0) g.fillRect(-1.6 * S + i * 0.8 * S, -1.4 * S + j * 0.7 * S, 0.8 * S, 0.7 * S);
      g.strokeRect(-1.6 * S, -1.4 * S, 3.2 * S, 2.8 * S);
      break;
    }
    case 'orchard': {
      for (const dx of [-4.6, 0, 4.6]) for (const dz of [-4.2, -0.6, 3.0]) g.drawImage(tree.img, (dx - 1.9) * S, (dz - 1.9) * S, 3.8 * S, 3.8 * S);
      for (const dx of [-6.6, -5.3, -7.7]) dot(dx, 4.4, 0.45, '#f1d77a');
      break;
    }
    case 'stones': { for (let i = 1; i < 9; i++) { const a = (i / 9) * Math.PI * 2; dot(Math.sin(a) * 4.4, Math.cos(a) * 4.4, 0.6, '#c4beb2'); } dot(0, 0, 0.9, '#d6d0c4'); break; }
    case 'haymeadow': {
      for (const [dx, dz] of [[-3.6, -1.8], [-1.4, -3.0], [2.2, -2.2], [4.2, 0.4], [-4.4, 1.6]]) {
        dot(dx, dz, 0.8, '#e6c45e');
        g.strokeStyle = 'rgba(122, 86, 30, .6)'; g.lineWidth = 0.12 * S; g.beginPath(); g.arc(dx * S, dz * S, 0.42 * S, 0, 5); g.stroke(); g.strokeStyle = INK; g.lineWidth = 0.3 * S;
      }
      break;
    }
    case 'swingtree': g.drawImage(tree.img, -3.6 * S, -4.2 * S, 7.2 * S, 7.2 * S); break;
    case 'mailbox': dot(0, 0, 0.55, '#d0453a'); break;
    case 'signpost': dot(0, 0, 0.35, '#8a5a36'); break;
    default: {
      shadowRect(w, d);
      g.fillStyle = '#c8955a'; g.fillRect(-w / 2, -d / 2, w, d); g.strokeRect(-w / 2, -d / 2, w, d);
    }
  }
  g.restore();
}
