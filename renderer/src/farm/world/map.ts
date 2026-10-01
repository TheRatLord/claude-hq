// @pure
/**
 * The valley. One pure definition of the land that every system samples: terrain, scatter, navigation, minimap.
 *
 * Coordinates are metres; +x east, +z south (north is −z), +y up. Structure `yaw` is three's rotation.y applied to a
 * model built with its front facing +z; a front then faces (sin yaw, cos yaw).
 *
 * Layout at a glance (north up):
 *
 *                 ~~ waterfall ~~          mountains
 *              river ╲      ⌂ plots 6 7          plot 15
 *   plots 18 ╲        ╲   barn  FARMHOUSE  tower      windmill hill
 *   (west     ╲ bridge ╲  4   noticeboard ◉ well  5      13
 *    bank) 17 ═══════════════ square ═══════════════     12
 *   19         ╱        8  0   2  3      1  campfire  pond  16
 *             ╱            9  10        11
 */
import { fbm } from './noise.ts';

export const WORLD = Object.freeze({
  /** half extent of the terrain mesh */
  half: 150,
  /** where the valley floor starts rising into the mountain ring */
  rim: 92,
  /** river and pond surface height */
  water: -1.1,
  /** player spawn: the square, looking north at the farmhouse */
  spawn: Object.freeze({ x: 0, z: 10, yaw: 0 }),
});

export interface XZ { x: number; z: number }

/** A plot site: where a workspace's field goes. `yaw` turns the field so its gate faces the square. */
export interface Site {
  index: number;
  x: number;
  z: number;
  /** field width (local x) and depth (local z), metres */
  w: number;
  d: number;
  yaw: number;
  /** flattened pad height */
  y: number;
  /** where the path meets the field: just outside the front fence */
  gate: XZ;
}

export const STRUCTURE_IDS = Object.freeze([
  'farmhouse', 'mailbox', 'shippingBin', 'noticeboard', 'well', 'waterTower', 'barn', 'silo', 'windmill', 'toolshed',
  'campfire', 'dock', 'bridge', 'signpost', 'waterfall',
] as const);
export type StructureId = (typeof STRUCTURE_IDS)[number];

export interface Structure {
  id: StructureId;
  x: number;
  z: number;
  yaw: number;
  /** footprint width × depth before yaw (solid for navigation unless `walkable`) */
  size: [number, number];
  /** flatten the ground under it (false for things that sit on water or slopes) */
  pad: boolean;
  walkable?: boolean;
  /** ground height at the structure (filled in below) */
  y: number;
}

const faceTo = (from: XZ, to: XZ) => Math.atan2(to.x - from.x, to.z - from.z);
const HUB: XZ = { x: 0, z: -2 };

const S = (id: StructureId, x: number, z: number, yaw: number, size: [number, number], pad = true, walkable = false): Structure =>
  ({ id, x, z, yaw, size, pad, walkable, y: 0 });

/** Landmarks. Gauges: windmill = CPU, water tower = RAM, silo = disk, chimney smoke = disk IO, pigeons = network. */
export const STRUCTURES: readonly Structure[] = [
  S('farmhouse', 0, -19, 0, [13, 10]),
  S('mailbox', 6.5, -9, 0, [0.8, 0.8]),
  S('shippingBin', -7.5, -11, 0, [2, 1.2]),
  S('noticeboard', -11, 0, Math.PI / 2, [3.2, 0.8]),
  S('well', 5, 4, 0, [2.6, 2.6]),
  S('waterTower', 17, -23, -0.4, [6, 6]),
  S('barn', -25, -21, 0.15, [12, 10]),
  S('silo', -34, -25, 0, [6, 6]),
  S('windmill', 58, -32, -0.9, [8, 8]),
  S('toolshed', -12, -16, 0.3, [4, 3.5]),
  S('campfire', 26, 33, 0, [7, 7], true, true),
  S('dock', 36, 35, 0.35, [2.4, 7], false, true),
  S('bridge', -56, 6, Math.PI / 2, [4, 14], false, true),
  S('signpost', 7, 6, -0.5, [0.6, 0.6]),
  S('waterfall', -25, -109, 0.25, [10, 6], false, true),
];
export const structure = (id: StructureId): Structure => {
  const s = STRUCTURES.find((x) => x.id === id);
  if (!s) throw new Error(`no structure ${id}`);
  return s;
};

const SITE_XZ: readonly [number, number][] = [
  [-28, 18], [28, 14], [-10, 34], [12, 36], [-40, -4], [43, -15], [-12, -44], [16, -46], [-34, 42], [-14, 62],
  [14, 64], [44, 70], [66, 24], [74, -6], [-28, -60], [40, -60], [66, 50], [-82, 4], [-80, -28], [-80, 34],
];
const SITE_W = 18, SITE_D = 14;

/** River centreline, source (waterfall pool, north) to mouth (south-west). */
export const RIVER: readonly XZ[] = [
  [-25, -104], [-31, -88], [-43, -67], [-51, -43], [-57, -17], [-56, 8], [-51, 30], [-55, 52], [-64, 76], [-77, 100], [-93, 124], [-112, 152],
].map(([x, z]) => ({ x, z }));
export const RIVER_HALF_WIDTH = 3.6;
export const POND = Object.freeze({ x: 41, z: 45, r: 9.5 });

export interface PathLine { points: XZ[]; width: number }

// ---------------------------------------------------------------------------------------------
// Height

const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Distance from p to polyline, plus the segment parameter along the whole line (0..1). */
export function distToPolyline(x: number, z: number, pts: readonly XZ[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const l2 = dx * dx + dz * dz;
    const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)) : 0;
    const ex = a.x + dx * t - x, ez = a.z + dz * t - z;
    const d = ex * ex + ez * ez;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** Natural land before pads, river and pond. */
function landHeight(x: number, z: number): number {
  let h = 1.4 * fbm(x / 70, z / 70, 3) + 0.45 * fbm(x / 19 + 7.3, z / 19 - 2.1, 3);
  h += 9 * Math.exp(-((x - 58) ** 2 + (z + 32) ** 2) / (2 * 20 ** 2)); // windmill hill
  h += 5 * Math.exp(-((x - 72) ** 2 + (z - 20) ** 2) / (2 * 26 ** 2)); // eastern downs
  h += 4.5 * smooth(-30, -80, z) * smooth(-70, -20, x); // northern slope behind the farmhouse
  h += 2.2 * Math.exp(-((x + 18) ** 2 + (z - 60) ** 2) / (2 * 18 ** 2)); // southern knoll
  h += 0.9 - 0.9 * smooth(-30, -60, x); // the river lowlands sit lower
  h += 2.5 * smooth(-66, -90, x) * smooth(150, 60, Math.abs(z)); // west bank bench
  // mountain ring, higher and craggier in the north where the waterfall drops
  const r = Math.hypot(x, z * 1.05);
  const a = Math.atan2(z, x);
  const rim = WORLD.rim + 10 * fbm(Math.cos(a) * 1.3 + 4, Math.sin(a) * 1.3 - 2, 3) + 6 * Math.sin(a * 3 + 1);
  const crag = 0.6 + 0.4 * fbm(x / 24, z / 24, 4);
  // gentle forested foothills, then steep rocky mountains, then taller hazy peaks far beyond the rim
  const foot = smooth(rim - 6, rim + 24, r), cliff = smooth(rim + 12, rim + 42, r), far = smooth(rim + 40, rim + 190, r);
  const ridge = 1 - Math.abs(fbm(x / 48 + 9, z / 48 - 4, 4));
  h += foot * (8 + 5 * crag) + cliff * (16 + 24 * crag * ridge) + far * (20 + 80 * ridge * ridge);
  h += smooth(-88, -112, z) * 16 * smooth(60, 0, Math.abs(x + 25));
  return h;
}

interface Pad { x: number; z: number; hw: number; hd: number; yaw: number; y: number; blend: number; /** landmark terraces sit on top of the plaza */ top?: boolean; /** a field: its core (fence and all) wins over everything */ field?: boolean }
const pads: Pad[] = [];
const padOf = (x: number, z: number, w: number, d: number, yaw: number, blend: number, y?: number): Pad =>
  ({ x, z, hw: w / 2, hd: d / 2, yaw, blend, y: y ?? Math.max(WORLD.water + 1.2, landHeight(x, z)) });

/** Signed distance from p to a rotated rectangle (negative inside). */
function rectSdf(x: number, z: number, p: { x: number; z: number; hw: number; hd: number; yaw: number }): number {
  const dx = x - p.x, dz = z - p.z;
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  const qx = Math.abs(lx) - p.hw, qz = Math.abs(lz) - p.hd;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
}

function carve(x: number, z: number, h: number): number {
  const bed = WORLD.water - 1.4;
  const dr = distToPolyline(x, z, RIVER);
  if (dr < RIVER_HALF_WIDTH + 9) {
    const k = smooth(RIVER_HALF_WIDTH + 8, RIVER_HALF_WIDTH * 0.5, dr);
    h = lerp(h, Math.min(h, bed), k);
    const bank = smooth(RIVER_HALF_WIDTH + 9, RIVER_HALF_WIDTH + 2, dr);
    h = lerp(h, Math.min(h, WORLD.water + 0.5), bank * 0.6);
  }
  const dp = Math.hypot(x - POND.x, z - POND.z);
  if (dp < POND.r + 14) {
    // the sunny south-east shore shelves gently into a little beach
    const beach = dp > 0.1 ? smooth(0.1, 0.6, ((x - POND.x) * 0.26 + (z - POND.z) * 0.97) / dp) : 0;
    h = lerp(h, Math.min(h, bed + 0.3), smooth(POND.r + 6 + beach * 6, POND.r * 0.55, dp));
  }
  return h;
}

/**
 * Pads blend as a weighted mean whose weight grows without bound toward a pad's flat core (w = s / (1 − s), then
 * exponentially with depth inside it), so a pad's interior stays flat even where a neighbour's blend skirt reaches
 * over it (applying pads one after another let a later skirt tilt an earlier field: its fence ran into a hill). Where
 * two cores overlap, the one you are deeper in wins. Landmark terraces (`top`) are a second layer blended over the
 * plaza, so a house's front steps keep their terrace and the plaza ramps up to it; a field's core (its fence line
 * included) stays exactly level over all of them.
 */
export function heightAt(x: number, z: number): number {
  const h = carve(x, z, landHeight(x, z));
  let wsum = 1, hsum = h, tw = 0, th = 0, tk = 0, fk = 0, fy = 0;
  for (const p of pads) {
    const d = rectSdf(x, z, p);
    if (d >= p.blend) continue;
    const k = 1 - smooth(0, p.blend, d);
    const w = d < 0 ? 1e4 * Math.exp(Math.min(600, -d * 12)) : k / (1 - k + 1e-4);
    if (p.top) { tw += w; th += w * p.y; if (k > tk) tk = k; } else { wsum += w; hsum += w * p.y; }
    if (p.field && d < 0) { const c = smooth(0, -0.8, d); if (c > fk) { fk = c; fy = p.y; } }
  }
  const base = hsum / wsum;
  const terr = tw ? lerp(base, th / tw, tk) : base;
  return fk ? lerp(terr, fy, fk) : terr;
}

/** Surface normal by central differences. */
export function normalAt(x: number, z: number, e = 0.5): { x: number; y: number; z: number } {
  const hx = heightAt(x + e, z) - heightAt(x - e, z), hz = heightAt(x, z + e) - heightAt(x, z - e);
  const nx = -hx, ny = 2 * e, nz = -hz;
  const l = Math.hypot(nx, ny, nz);
  return { x: nx / l, y: ny / l, z: nz / l };
}

/** 0 flat … 1 vertical */
export const slopeAt = (x: number, z: number): number => 1 - normalAt(x, z).y;

export function isWater(x: number, z: number): boolean { return heightAt(x, z) < WORLD.water - 0.05; }

// ---------------------------------------------------------------------------------------------
// Sites, structures, paths (built once at module load; pads depend on the natural land only)

const hubPad = padOf(HUB.x, HUB.z + 1, 30, 26, 0, 6);
pads.push(hubPad);
for (const s of STRUCTURES) {
  if (!s.pad) continue;
  if (Math.hypot(s.x - HUB.x, s.z - HUB.z) < 16) continue; // on the square
  const p = padOf(s.x, s.z, s.size[0] + 3, s.size[1] + 3, s.yaw, 5);
  // neighbours whose pads touch share one terrace (barn + silo): no step through either footprint
  const c = Math.cos(p.yaw), sn = Math.sin(p.yaw);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]].map(([i, j]) => ({ x: p.x + i * p.hw * c + j * p.hd * sn, z: p.z - i * p.hw * sn + j * p.hd * c }));
  const touch = pads.find((q) => q.top && corners.some((k) => rectSdf(k.x, k.z, q) < 0));
  if (touch) p.y = touch.y;
  p.top = true;
  pads.push(p);
}
/** The farmhouse's kitchen garden (east of the house, hub dressing): level with the house, kept clear of scatter. */
export const GARDEN = Object.freeze({ x0: 7.6, x1: 12.4, z0: -25.5, z1: -18.2 });
/** The laundry line's yard (west of the house, hub dressing): the line runs along x between the two poles; kept clear of scatter. */
export const LAUNDRY = Object.freeze({ x: -8.9, z0: -25.0, z1: -19.4 });
{
  const fh = pads.find((q) => q.top && rectSdf(STRUCTURES[0].x, STRUCTURES[0].z, q) < 0)!;
  const g = padOf((GARDEN.x0 + GARDEN.x1) / 2, (GARDEN.z0 + GARDEN.z1) / 2, GARDEN.x1 - GARDEN.x0 + 4, GARDEN.z1 - GARDEN.z0 + 4, 0, 4, fh.y);
  g.top = true;
  // a terrace that overlaps the garden (the water tower's) sits at the garden's level: two cores 1.4 m apart met in a cliff
  const c = (q: Pad) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => ({ x: q.x + i * q.hw * Math.cos(q.yaw) + j * q.hd * Math.sin(q.yaw), z: q.z - i * q.hw * Math.sin(q.yaw) + j * q.hd * Math.cos(q.yaw) }));
  for (const q of pads) if (q.top && q !== fh && (c(q).some((k) => rectSdf(k.x, k.z, g) < 0) || c(g).some((k) => rectSdf(k.x, k.z, q) < 0))) q.y = g.y;
  pads.push(g);
}

export const SITES: readonly Site[] = SITE_XZ.map(([x, z], index) => {
  const yaw = faceTo({ x, z }, HUB);
  const p = padOf(x, z, SITE_W + 3.5, SITE_D + 3.5, yaw, 6); // flat 1.7 m past the fence: the 1.25 m terrain mesh must not bend up under it
  p.field = true;
  pads.push(p);
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  return { index, x, z, w: SITE_W, d: SITE_D, yaw, y: p.y, gate: { x: x + fx * (SITE_D / 2 + 1.5), z: z + fz * (SITE_D / 2 + 1.5) } };
});

// a terrace whose pad runs into a field's sits at the field's level (the campfire by its field): two flat cores at
// different heights would meet in a cliff
{
  const corners = (q: Pad) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => ({ x: q.x + i * q.hw * Math.cos(q.yaw) + j * q.hd * Math.sin(q.yaw), z: q.z - i * q.hw * Math.sin(q.yaw) + j * q.hd * Math.cos(q.yaw) }));
  for (const q of pads) {
    if (!q.top) continue;
    // (the field itself, its fence grown by a metre, not the flat margin round it: a yard corner in that margin just ramps)
    const fence = (p: Pad): Pad => ({ ...p, hw: p.hw - 0.75, hd: p.hd - 0.75 });
    const f = pads.find((p) => p.field && (corners(q).some((k) => rectSdf(k.x, k.z, fence(p)) < 0) || corners(fence(p)).some((k) => rectSdf(k.x, k.z, q) < 0)));
    if (!f || f.y === q.y) continue;
    // ...and so does every terrace sharing its level with it (barn + silo)
    const was = q.y;
    for (const t of pads) if (t.top && t.y === was && (t === q || corners(t).some((k) => rectSdf(k.x, k.z, q) < 0) || corners(q).some((k) => rectSdf(k.x, k.z, t) < 0))) t.y = f.y;
  }
}
for (const s of STRUCTURES) (s as { y: number }).y = heightAt(s.x, s.z);
export const HUB_Y = hubPad.y;

const BRIDGE: [XZ, XZ] = [{ x: -46, z: 7 }, { x: -66, z: 5.5 }];

/** Does the segment a→b pass through a field (its fence rectangle grown by m)? Returns the site. */
function crossedSite(a: XZ, b: XZ, m: number): Site | null {
  const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.4);
  for (const site of SITES) for (let i = 1; i < n; i++) {
    const x = a.x + ((b.x - a.x) * i) / n, z = a.z + ((b.z - a.z) * i) / n;
    if (rectSdf(x, z, { x: site.x, z: site.z, hw: site.w / 2 + m, hd: site.d / 2 + m, yaw: site.yaw }) < 0) return site;
  }
  return null;
}

/** Detour a polyline around fields it would cut through, via the grown corners of each field in its way. */
function routeAround(pts: XZ[], m: number): void {
  for (let guard = 0; guard < 24; guard++) {
    let fixed = false;
    for (let i = 0; i < pts.length - 1; i++) {
      const site = crossedSite(pts[i], pts[i + 1], m - 0.6);
      if (!site) continue;
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => siteToWorld(site, sx * (site.w / 2 + m), sz * (site.d / 2 + m)));
      const a = pts[i], b = pts[i + 1];
      const d = (p: XZ, q: XZ) => Math.hypot(p.x - q.x, p.z - q.z);
      // shortest detour via one grown corner, else via two neighbouring corners, every leg clear of this field
      const clear = (p: XZ, q: XZ) => crossedSite(p, q, m - 0.6) === null;
      let best: XZ[] | null = null, bestL = Infinity;
      // walk the grown perimeter either way from any corner, up to three corners
      for (let c = 0; c < 4; c++) for (const dir of [1, 3]) {
        const chain: XZ[] = [];
        let L = 0, prev = a;
        for (let n = 0; n < 3; n++) {
          const cn = corners[(c + dir * n) % 4];
          if (!clear(prev, cn)) break;
          L += d(prev, cn); chain.push(cn); prev = cn;
          if (clear(cn, b) && L + d(cn, b) < bestL) { best = [...chain]; bestL = L + d(cn, b); }
        }
      }
      if (!best) continue;
      pts.splice(i + 1, 0, ...best);
      fixed = true;
      break;
    }
    if (!fixed) return;
  }
}

/**
 * Roads: a spanning tree grown from the square (Prim's, nearest connected node first), so the network branches like
 * a real village instead of radiating spokes. The west bank joins only over the bridge. Corners are rounded.
 */
export const PATHS: readonly PathLine[] = (() => {
  const out: PathLine[] = [];
  const front = (id: StructureId, off: number): XZ => { const s = structure(id); return { x: s.x + Math.sin(s.yaw) * off, z: s.z + Math.cos(s.yaw) * off }; };
  interface Node { p: XZ; west: boolean; width: number }
  const west = (p: XZ) => p.x < -60;
  const targets: Node[] = [
    ...SITES.map((s) => ({ p: s.gate, west: west(s.gate), width: 2.2 })),
    { p: front('windmill', 5.5), west: false, width: 2.4 },
    { p: front('barn', 7), west: false, width: 3 },
    { p: front('waterTower', 4.5), west: false, width: 2 },
    { p: { x: 25, z: 28 }, west: false, width: 2.4 },
    { p: { x: 34, z: 31 }, west: false, width: 2 },
    { p: { x: -32, z: -96 }, west: false, width: 2 },
  ];
  // the square's four exits + the bridge ends seed the connected set
  const connected: Node[] = [
    { p: { x: 12, z: 0 }, west: false, width: 3 }, { p: { x: -12, z: 1 }, west: false, width: 3 },
    { p: { x: 2, z: 10 }, west: false, width: 3 }, { p: { x: 9, z: -12 }, west: false, width: 3 },
  ];
  const segs: [Node, Node][] = [];
  const bridgeE: Node = { p: BRIDGE[0], west: false, width: 3 }, bridgeW: Node = { p: BRIDGE[1], west: true, width: 3 };
  segs.push([connected[1], bridgeE], [bridgeE, bridgeW]);
  // road graph (for the neighbour lanes below): the square joins its exits
  const adj = new Map<Node, [Node, number][]>();
  const link = (u: Node, v: Node) => {
    const l = Math.hypot(u.p.x - v.p.x, u.p.z - v.p.z);
    (adj.get(u) ?? adj.set(u, []).get(u)!).push([v, l]);
    (adj.get(v) ?? adj.set(v, []).get(v)!).push([u, l]);
  };
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) link(connected[i], connected[j]);
  link(connected[1], bridgeE); link(bridgeE, bridgeW);
  connected.push(bridgeE, bridgeW);
  const pending = [...targets];
  const d2 = (a: XZ, b: XZ) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
  while (pending.length) {
    let bi = 0, bn: Node = connected[0], bd = Infinity;
    pending.forEach((t, i) => {
      for (const c of connected) {
        if (c.west !== t.west) continue;
        const d = d2(t.p, c.p);
        if (d < bd) { bd = d; bi = i; bn = c; }
      }
    });
    const t = pending.splice(bi, 1)[0];
    segs.push([bn, t]);
    // the middle of a new road is itself a junction others may branch from
    const mid: Node = { p: { x: (t.p.x + bn.p.x) / 2, z: (t.p.z + bn.p.z) / 2 }, west: t.west, width: t.width };
    connected.push(t, mid);
    link(bn, t); link(mid, bn); link(mid, t);
  }
  // the greedy tree can leave two neighbouring fields a long way apart by road (each joined a different branch):
  // give such neighbours a direct lane
  const gates = SITES.map((s) => targets[s.index]);
  for (const a of gates) {
    const dist = new Map<Node, number>([[a, 0]]);
    const open = [a];
    while (open.length) {
      open.sort((x, y) => dist.get(x)! - dist.get(y)!);
      const u = open.shift()!;
      for (const [v, l] of adj.get(u) ?? []) {
        const nd = dist.get(u)! + l;
        if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); if (!open.includes(v)) open.push(v); }
      }
    }
    for (const b of gates) {
      if (b === a || a.west !== b.west || a.p.x > b.p.x) continue;
      const st = Math.sqrt(d2(a.p, b.p));
      if (st < 40 && (dist.get(b) ?? Infinity) > st * 5) { segs.push([a, b]); link(a, b); }
    }
  }
  for (const [a, b] of segs) {
    const dx = b.p.x - a.p.x, dz = b.p.z - a.p.z, l = Math.hypot(dx, dz) || 1;
    const wob = fbm(a.p.x * 0.07, b.p.z * 0.07) * Math.min(4, l * 0.12);
    const pts: XZ[] = [];
    const width = Math.min(a.width, b.width) + (a.width > 2.5 && b.width > 2.5 ? 0.6 : 0);
    const N = 6;
    const inField = (p: XZ, m: number) => SITES.some((st) => rectSdf(p.x, p.z, { x: st.x, z: st.z, hw: st.w / 2 + m, hd: st.d / 2 + m, yaw: st.yaw }) < 0);
    for (let k = 0; k <= N; k++) {
      const t = k / N, bow = Math.sin(t * Math.PI) * wob;
      const p = { x: a.p.x + dx * t - (dz / l) * bow, z: a.p.z + dz * t + (dx / l) * bow };
      // roads skirt fields: drop bend points that fall in (or on the fence of) a field, then detour round corners
      if (k === 0 || k === N || !inField(p, width / 2 + 0.3)) pts.push(p);
    }
    // a road leaving a field's gate first heads straight out from the fence (not along it)
    for (const end of [0, 1] as const) {
      const g = end ? pts[pts.length - 1] : pts[0];
      const site = SITES.find((st) => Math.hypot(st.gate.x - g.x, st.gate.z - g.z) < 0.01);
      if (!site) continue;
      const stub = { x: g.x + Math.sin(site.yaw) * 2.5, z: g.z + Math.cos(site.yaw) * 2.5 };
      if (end) pts.splice(pts.length - 1, 0, stub); else pts.splice(1, 0, stub);
    }
    routeAround(pts, width / 2 + 0.9);
    out.push({ points: pts, width });
  }
  return out;
})();

/** 0..1 how much (x,z) is on a path (1 = centre). */
export function pathAt(x: number, z: number): number {
  let best = 0;
  for (const p of PATHS) {
    const d = distToPolyline(x, z, p.points);
    const v = 1 - smooth(p.width * 0.35, p.width * 0.75, d);
    if (v > best) best = v;
  }
  const dh = rectSdf(x, z, { x: HUB.x, z: HUB.z + 1, hw: 12, hd: 10, yaw: 0 });
  return Math.max(best, 1 - smooth(-1, 2, dh));
}

/**
 * Distance to the nearest reserved feature (square, structure, site, path, water). Scatter uses it: trees want
 * > 3, grass tufts > 0.3, rocks > 1.5.
 */
export function clearance(x: number, z: number): number {
  let d = rectSdf(x, z, { x: HUB.x, z: HUB.z + 1, hw: 13, hd: 11, yaw: 0 });
  for (const s of STRUCTURES) d = Math.min(d, rectSdf(x, z, { x: s.x, z: s.z, hw: s.size[0] / 2, hd: s.size[1] / 2, yaw: s.yaw }));
  d = Math.min(d, rectSdf(x, z, { x: (GARDEN.x0 + GARDEN.x1) / 2, z: (GARDEN.z0 + GARDEN.z1) / 2, hw: (GARDEN.x1 - GARDEN.x0) / 2, hd: (GARDEN.z1 - GARDEN.z0) / 2, yaw: 0 }));
  d = Math.min(d, rectSdf(x, z, { x: LAUNDRY.x, z: (LAUNDRY.z0 + LAUNDRY.z1) / 2, hw: 1.0, hd: (LAUNDRY.z1 - LAUNDRY.z0) / 2 + 0.5, yaw: 0 }));
  for (const s of SITES) d = Math.min(d, rectSdf(x, z, { x: s.x, z: s.z, hw: s.w / 2 + 0.5, hd: s.d / 2 + 0.5, yaw: s.yaw }));
  for (const p of PATHS) d = Math.min(d, distToPolyline(x, z, p.points) - p.width / 2);
  d = Math.min(d, distToPolyline(x, z, RIVER) - RIVER_HALF_WIDTH - 1.5, Math.hypot(x - POND.x, z - POND.z) - POND.r - 1.5);
  return d;
}

/** World position of a local point in a site (lx along width, lz along depth; +lz is toward the gate). */
export function siteToWorld(site: Site, lx: number, lz: number): XZ {
  const c = Math.cos(site.yaw), s = Math.sin(site.yaw);
  return { x: site.x + lx * c + lz * s, z: site.z - lx * s + lz * c };
}

/** Is (x, z) inside the site's field (with margin)? */
export function inSite(site: Site, x: number, z: number, margin = 0): boolean {
  return rectSdf(x, z, { x: site.x, z: site.z, hw: site.w / 2, hd: site.d / 2, yaw: site.yaw }) < margin;
}

/** Leisure spots idle farmers wander to. */
export const HANGOUTS: readonly (XZ & { kind: 'fire' | 'fish' | 'bench' | 'well' | 'board' | 'porch' | 'meadow' })[] = [
  { x: 24, z: 31, kind: 'fire' }, { x: 29, z: 35.5, kind: 'fire' }, { x: 23, z: 36, kind: 'fire' },
  { x: 37.5, z: 38.5, kind: 'fish' }, { x: 47, z: 37, kind: 'fish' },
  { x: 3, z: 5.5, kind: 'well' }, { x: -9, z: 1.5, kind: 'board' }, { x: -3, z: -12.5, kind: 'porch' },
  { x: 2.5, z: -12.5, kind: 'porch' }, { x: -44, z: 18, kind: 'meadow' }, { x: 30, z: -20, kind: 'meadow' },
  { x: -18, z: -30, kind: 'meadow' },
];
