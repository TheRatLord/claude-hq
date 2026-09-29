/**
 * Architecture (§7.1 build, §5.5 value map): floors, walls, trims, ceilings, the Pit bowl, the mezzanine slab, rails,
 * stairs, slide, skylight, glazing and the exterior sky cards, from `layout` (hq.ts).
 * - Everything is `toonEnv` VCOL (colour in vertex colours, pattern as the material uniform), merged per vis REGION ×
 *   pattern (≈ 3–5 draws a region); architecture never casts (§5.4 matrix).
 * - Floors are 0.25–0.3 m vertex grids with baked AO: contact darkening along walls and under / around furniture
 *   footprints (the Low-tier AO, and it seats every prop on the floor on Medium too).
 * - Walls carry the diorama trim set per zone: walnut baseboard, painted wainscot with stiles, a chair rail, and a
 *   cornice under the ceiling; openings get chunky architraves; windows get mullions matching the gobo (3 × 2 panes).
 * - Glass: exterior windows reflect the sky, interior glazing (E bays, ENG, café) the warm interior gradient (§5.6).
 * Owner: ENV.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getMaterial, PATTERN } from '../../render/materials/index.ts';
import { chamferBox } from './kit/core.ts';
import { CORE, ENV, MISC } from '../../../../shared/palette.ts';
import type { HqLayout, Rect, Circle, Wall, WallOpening } from '../layout/schema.ts';

/** Per-vertex AO (or any multiplier) at a world point. */
type AoFn = (x: number, y: number, z: number) => number;
/** One zone's value-map row (§5.5). */
export interface ZoneStyleEntry {
  floor: [string, string];
  wall: [string, string];
  wain: string | null;
  wainH?: number;
  rail: string;
  base: string;
  ceil: string;
}
/** A furniture AO source (world): a circle (`r`) or a yawed rect (`w` × `d`); `k` = darkness. */
export type AoFootprint = { x: number; z: number; yaw?: number; k?: number } & ({ r: number } | { w: number; d: number });
export interface ArchOpts { flat?: boolean; footprints?: AoFootprint[] }
/** A ceiling patch that shares a floor mesh's buffer: `set(false)` trims the draw range (plan view). */
export interface CeilingHandle { mesh: THREE.Mesh; mainCount: number; set: (on: boolean) => void }
export interface ArchResult {
  groups: Map<string, THREE.Group>;
  regionCells: Map<string, Set<string>>;
  extra: THREE.Mesh[];
  ceilings: CeilingHandle[];
  stats: { draws: number; tris: number };
}
type Span = [number, number];

const OX = 20.5, OZ = 14;
const isPattern = (p: string): p is keyof typeof PATTERN => p in PATTERN;
/** `'a@b@c'` → its three parts. */
const split3 = (k: string): [string, string, string] => { const [a = '', b = '', c = ''] = k.split('@'); return [a, b, c]; };
const WAIN_H = 0.72, BASE_H = 0.1;
/** Glazing metalwork: CORE.ink2 lifted one step (L* 35) so frames read dark without sinking under the p10 luma floor. */
const IRON = '#56514B';
/** Outer radius of the stone band round the Pit (the atrium floor grid starts here). */
const PIT_BAND = 4.47;
/** [ENV fix r1] outer radius of the atrium ring-lane mosaic (the atrium grid starts here). */
const MOSAIC_R = 6.35;
/** [ENV fix r2] inner radius of the atrium checker lane (1 m: two rows of 0.5 m tiles, brass lines either side). */
const LANE_R = 5.15;
/** [ENV M3.5 tris] floor-grid vertices at or above this baked AO count as flat (≤ 1% off white across a merged patch: invisible). */
const FLAT_AO = 0.99;
/** [ENV M3.5 tris] segments of the Pit's rings / nosings / risers (was 144: a 4 m ring's 96-gon is 2 mm off round). */
const RING_SEG = 96;
/** [ENV M3.5 tris] patterns used only by floors, trims, beams, frames and the Pit (no wall / ceiling surface uses
 *  them): no depth prepass (build merge, below). The walls / ceilings (plaster, brick, tile) keep it. */
const NO_PREPASS = new Set(['planks', 'felt', 'terrazzo', 'cobble', 'wood', 'none']);
/** [ENV fix r1] vis region → merge super-region (W: bays / street / plaza, C: lobby / atrium / Pit / library / mezz, E). */
export const SUPER: Readonly<Record<string, string>> = { west: 'W', south: 'W', ebays: 'W', core: 'C', lib: 'C', mez: 'C', ne: 'E', eng: 'E', caf: 'E' };

/**
 * §5.5 value map per zone (albedo; the rendered targets are checked by surfaceStats):
 * floor [colour, pattern], wall [colour, pattern], wain (painted wainscot or null), rail (chair rail / cornice trim),
 * base (baseboard), ceil. Cool wainscots where Clawds spend time (complementary staging).
 */
export const ZONE_STYLE: Record<string, ZoneStyleEntry> = {
  // [ENV fix m2 r2] LOB floor: warm oak-dark planks (L* 50, C 26; §5.5 row 46 + the band, renders L* ≈ 42), was a grey-beige '#A2886F' (L* 58, C 18)
  LOB: { floor: ['#93724F', 'planks'], wall: [ENV.wallCream, 'plaster'], wain: '#AC9070', rail: '#D8CBB4', base: '#5E4636', ceil: '#C4BCB0' },
  ATR: { floor: ['#978E86', 'terrazzo'], wall: ['#DCD3C6', 'plaster'], wain: '#8C9588', rail: '#D8CBB4', base: '#4F4239', ceil: '#D3CBBF' },
  PIT: { floor: ['#9B928A', 'terrazzo'], wall: ['#DCD3C6', 'plaster'], wain: '#8C9588', rail: '#D8CBB4', base: '#4F4239', ceil: '#D3CBBF' },
  LIB: { floor: ['#6E5543', 'planks'], wall: ['#C2B39E', 'plaster'], wain: '#56705C', rail: '#D0C2A8', base: '#4A382C', ceil: '#978C7E' },
  MEZ: { floor: ['#46526B', 'felt'], wall: ['#C2B8AA', 'plaster'], wain: '#5A6278', rail: '#CFC3AE', base: '#3A4258', ceil: '#7A83A2' },
  NAL: { floor: ['#76604C', 'planks'], wall: ['#C7BDAF', 'plaster'], wain: '#8B7A64', rail: '#D6CAB5', base: '#4F4036', ceil: '#A8A096' },
  STR: { floor: [MISC.strPavers, 'cobble'], wall: [MISC.strBrick, 'brick'], wain: null, rail: '#6F7A70', base: '#48504A', ceil: '#6A4B37' }, // [ENV fix m2 r2] ceil: warm walnut boards (L* 35), was slate '#4E5550' (a tunnel)
  // [ENV fix m2 r2] BAY walls: oat-greige L* 80 (was '#DFD6CA' L* 86, over the ±4 band; through the storefronts they read
  // blown-out at 13 h from the street) above a tall 1.2 m panelled wainscot, so less than half the bay wall is plaster
  BAY: { floor: [MISC.bayCarpet, 'felt'], wall: ['#D2C8B8', 'plaster'], wain: '#93A39D', wainH: 1.2, rail: '#DDD2C1', base: '#4F4A42', ceil: '#C6BFB4' },
  PLZ: { floor: ['#66706A', 'cobble'], wall: [MISC.strBrick, 'brick'], wain: null, rail: '#6F7A70', base: '#48504A', ceil: '#6A4B37' }, // [ENV fix m2 r2] walnut boards like the street
  WAR: { floor: ['#7C7266', 'planks'], wall: ['#C7BDAF', 'plaster'], wain: '#A68D6C', rail: '#D6CAB5', base: '#4F4036', ceil: '#A8A096' },
  LAB: { floor: ['#6F8483', 'tile'], wall: ['#DCD8CD', 'tile'], wain: '#AEBDB9', rail: '#E2DDD1', base: '#5E6A68', ceil: '#BDB8AE' },
  MAIL: { floor: ['#7C7266', 'planks'], wall: ['#C9BBA5', 'plaster'], wain: '#A28A6A', rail: '#D6CAB5', base: '#4F4036', ceil: '#A8A096' },
  ARC: { floor: ['#76705F', 'planks'], wall: ['#C3BCAD', 'plaster'], wain: '#8C8F84', rail: '#D2CAB8', base: '#4A463E', ceil: '#A39C90' },
  ENG: { floor: ['#5E615F', 'tile'], wall: ['#8E8F8A', 'plaster'], // [ENV M3.5 tris] wall 'plaster' (was 'none': 'none' is now trims only, no prepass)
    wain: '#6C706C', rail: '#A4A59F', base: '#3E403E', ceil: '#4B4D4B' },
  CAF: { floor: [MISC.cafTerrazzo, 'terrazzo'], wall: [ENV.wallCream, 'plaster'], wain: '#7F9A93', rail: '#E0D6C6', base: '#4D5A56', ceil: '#B5AEA4' },
  NAP: { floor: ['#6F7C8A', 'felt'], wall: ['#BDB3C9', 'plaster'], wain: '#8E86A0', rail: '#D6CFDD', base: '#4E4A5A', ceil: '#9A93A8' },
  // [ENV fix m2 r3] façade body: warm sand running-bond brick (was a flat taupe plaster slab); trims in facade()
  OUT: { floor: ['#857C72', 'none'], wall: ['#C7B29B', 'brick'], wain: null, rail: '#D8CBB4', base: '#4F4239', ceil: '#B3AB9F' },
};
export const styleOf = (zone: string | null | undefined): ZoneStyleEntry => ZONE_STYLE[/^[EW]\d$/.test(zone ?? '') ? 'BAY' : (zone ?? '')] ?? ZONE_STYLE.OUT;

/** Bevelled box (walls/trims): plain box below 2.5 cm or bevel < 6 mm. */
const rbox = (w: number, h: number, d: number, r = 0.01, seg = 1): THREE.BufferGeometry => {
  const mn = Math.min(w, h, d), rr = Math.min(r, mn / 2 - 1e-4);
  if (mn < 0.025 || rr < 0.006) return new THREE.BoxGeometry(w, h, d);
  return seg <= 1 ? chamferBox(w, h, d, rr) : new RoundedBoxGeometry(w, h, d, seg, rr); // [ENV fix m2 r1] 44-tri chamfer (was 108)
};
const clean = (g: THREE.BufferGeometry): THREE.BufferGeometry => {
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
  return g.index ? g.toNonIndexed() : g;
};
const paint = (g: THREE.BufferGeometry, hex: string, aoFn: AoFn | null = null): THREE.BufferGeometry => {
  g = clean(g);
  const c = new THREE.Color(hex), pos = g.getAttribute('position'), n = pos.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const k = aoFn ? aoFn(pos.getX(i), pos.getY(i), pos.getZ(i)) : 1;
    a[i * 3] = c.r * k; a[i * 3 + 1] = c.g * k; a[i * 3 + 2] = c.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
};

/** `o.footprints` (world): furniture AO sources (k = darkness under/around, default 0.28). */
export function buildArchitecture(layout: HqLayout, o: ArchOpts = {}): ArchResult {
  const flat = !!o.flat;
  const zoneDef = (id: string) => layout.zones.find((z) => z.id === id);
  const pitCircle = ((): Circle => {
    const c = zoneDef('PIT')?.circle;
    if (!c) throw new Error('buildArchitecture: layout has no PIT circle');
    return c;
  })();
  const zoneAtW = (x: number, z: number, level = 0) => layout.zoneAt(x, z, level);
  const regionOfCell = new Map(layout.visCells.map((c) => [c.id, c.region ?? c.id]));
  const b0 = layout.bounds;
  const cellOfGeo = (x: number, y: number, z: number): string | null => {
    if (x < b0.minX || x > b0.maxX || z < b0.minZ || z > b0.maxZ) return null;
    return (y > 2.85 && layout.plan.onMezz(x + OX, z + OZ) ? 'MEZ' : layout.zoneAt(x, z, 0)) ?? null;
  };
  const arch = new Map<string, THREE.BufferGeometry[]>();
  const tmpBox = new THREE.Box3(), tmpC = new THREE.Vector3();
  /** Add geometry with a colour (+ optional AO fn) under a pattern; `group` 'ceil'/'cap' toggles with the plan view. */
  const add = (color: string, pattern: string | null | undefined, geo: THREE.BufferGeometry, group = 'main', aoFn: AoFn | null = null, region: string | null = null): void => {
    const g = paint(geo, color, aoFn);
    if (!region) {
      g.computeBoundingBox(); (g.boundingBox ?? tmpBox).getCenter(tmpC);
      const cell = cellOfGeo(tmpC.x, tmpC.y, tmpC.z);
      region = (cell === null ? undefined : regionOfCell.get(cell)) ?? 'OUT';
    }
    const k = `${group}@${region}@${flat ? 'none' : pattern || 'none'}`;
    const list = arch.get(k) ?? [];
    arch.set(k, list);
    list.push(g);
  };
  const skyGeos: THREE.BufferGeometry[] = [];
  const glassIn: THREE.BufferGeometry[] = [], glassOut: THREE.BufferGeometry[] = [];
  const isExterior = (w: Wall): boolean => {
    const [ax, az] = w.a, [bx, bz] = w.b, e = 1e-3;
    return (Math.abs(ax - bx) < e && (Math.abs(ax - b0.minX) < e || Math.abs(ax - b0.maxX) < e)) || (Math.abs(az - bz) < e && (Math.abs(az - b0.minZ) < e || Math.abs(az - b0.maxZ) < e));
  };

  // ------------------------------------------------------------------ floor AO sources
  const walls0 = layout.walls.filter((w) => (w.y0 ?? 0) < 0.1 && w.kind !== 'rail' && w.kind !== 'lintel');
  const wallSegs = walls0.map((w) => {
    const [ax, az] = w.a, [bx, bz] = w.b, len = Math.hypot(bx - ax, bz - az);
    return { ax, az, ux: (bx - ax) / len, uz: (bz - az) / len, len, t: w.t ?? 0.2, gaps: (w.openings ?? []).filter((q) => q.sill <= 0.05).map((q): Span => [q.at, q.at + q.w]), kerb: (w.openings ?? []).filter((q) => q.sill > 0.05).map((q): Span => [q.at, q.at + q.w]) };
  });
  const foot = (o.footprints ?? []).map((f) => ({ ...f, cs: Math.cos(f.yaw ?? 0), sn: Math.sin(f.yaw ?? 0), k: f.k ?? 0.28 }));
  /** Baked floor AO at world (x, z): walls (soft 0.25 m falloff), footprints (dark under, 0.15 m halo). */
  const floorAO = (x: number, z: number): number => {
    let ao = 1;
    for (const s of wallSegs) {
      const rx = x - s.ax, rz = z - s.az;
      const along = rx * s.ux + rz * s.uz;
      if (along < -0.3 || along > s.len + 0.3) continue;
      const cl = Math.max(0, Math.min(s.len, along));
      if (s.gaps.some(([a, b]) => cl > a + 0.02 && cl < b - 0.02)) continue;
      const d = Math.hypot(x - (s.ax + s.ux * cl), z - (s.az + s.uz * cl)) - s.t / 2;
      if (d > 0.9) continue;
      const kerb = s.kerb.some(([a, b]) => cl > a && cl < b) ? 0.5 : 1;
      ao *= 1 - 0.22 * kerb * Math.exp(-Math.max(0, d) / 0.2);
    }
    for (const f of foot) {
      const dx = x - f.x, dz = z - f.z;
      let dist: number;
      if ('r' in f) dist = Math.hypot(dx, dz) - f.r;
      else {
        const lx = dx * f.cs - dz * f.sn, lz = dx * f.sn + dz * f.cs;
        const ex = Math.abs(lx) - f.w / 2, ez = Math.abs(lz) - f.d / 2;
        dist = ex > 0 || ez > 0 ? Math.hypot(Math.max(ex, 0), Math.max(ez, 0)) : Math.max(ex, ez);
      }
      if (dist > 0.6) continue;
      ao *= 1 - f.k * (dist <= 0 ? Math.min(1, 0.7 + -dist * 1.5) : Math.exp(-dist / 0.13));
    }
    return Math.max(0.55, ao);
  };
  /** A floor grid over a rect at height y (optionally minus a circle), vertex colours = colour × AO. */
  const floorGrid = (x0: number, z0: number, x1: number, z1: number, y: number, cell: number, color: string, pattern: string, hole: Circle | null = null): void => {
    const nx = Math.max(1, Math.round((x1 - x0) / cell)), nz = Math.max(1, Math.round((z1 - z0) / cell));
    const pos: number[] = [], idx: number[] = [];
    const vid = new Int32Array((nx + 1) * (nz + 1)).fill(-1);
    const clamped = new Uint8Array((nx + 1) * (nz + 1));
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      let x = x0 + (x1 - x0) * i / nx, z = z0 + (z1 - z0) * j / nz;
      if (hole) { const dx = x - hole[0], dz = z - hole[1], r = Math.hypot(dx, dz); if (r < hole[2]) { if (r < hole[2] - cell * 1.5) continue; x = hole[0] + dx / r * hole[2]; z = hole[1] + dz / r * hole[2]; clamped[j * (nx + 1) + i] = 1; } }
      vid[j * (nx + 1) + i] = pos.length / 3;
      pos.push(x, y, z);
    }
    // [ENV M3.5 tris] AO-flat patches (every corner's baked AO ≥ FLAT_AO, no rim clamp) merge greedily into rects; a
    // rect is drawn as a fan from its centre over ALL the grid vertices on its border (watertight: no T-junction with
    // the fine quads around it), 2·(w + h) triangles instead of 2·w·h. The AO gradients near walls / under props keep
    // the full grid. (§5.3 tris: the floors were ~24k tris, drawn twice with the architecture depth prepass.)
    const NX = nx + 1;
    const flat = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const ks = [j * NX + i, j * NX + i + 1, (j + 1) * NX + i, (j + 1) * NX + i + 1];
      flat[j * nx + i] = ks.every((k) => vid[k] >= 0 && !clamped[k] && floorAO(pos[vid[k] * 3], pos[vid[k] * 3 + 2]) >= FLAT_AO) ? 1 : 0;
    }
    const used = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      if (!flat[j * nx + i] || used[j * nx + i]) continue;
      let w = 1;
      while (i + w < nx && flat[j * nx + i + w] && !used[j * nx + i + w]) w++;
      let h = 1;
      while (j + h < nz) { let ok = true; for (let q = 0; q < w && ok; q++) ok = !!flat[(j + h) * nx + i + q] && !used[(j + h) * nx + i + q]; if (!ok) break; h++; }
      if (w * h <= w + h) continue; // a thin strip: the plain quads are as cheap
      for (let jj = j; jj < j + h; jj++) for (let ii = i; ii < i + w; ii++) used[jj * nx + ii] = 1;
      const ring: number[] = [];
      for (let ii = i; ii < i + w; ii++) ring.push(vid[j * NX + ii]);
      for (let jj = j; jj < j + h; jj++) ring.push(vid[jj * NX + i + w]);
      for (let ii = i + w; ii > i; ii--) ring.push(vid[(j + h) * NX + ii]);
      for (let jj = j + h; jj > j; jj--) ring.push(vid[jj * NX + i]);
      const cx = x0 + (x1 - x0) * (i + w / 2) / nx, cz = z0 + (z1 - z0) * (j + h / 2) / nz, c0 = pos.length / 3;
      pos.push(cx, y, cz);
      for (let q = 0; q < ring.length; q++) idx.push(c0, ring[(q + 1) % ring.length], ring[q]);
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      if (used[j * nx + i]) continue;
      const ka = j * (nx + 1) + i, kb = ka + 1, kc = ka + nx + 1, kd = kc + 1;
      const a = vid[ka], b = vid[kb], c = vid[kc], d = vid[kd];
      if (a < 0 || b < 0 || c < 0 || d < 0) continue;
      // a quad straddling the rim keeps its clamped corners (it stretches onto the rim: no gap can open); only quads
      // with every corner on the rim are dropped
      if (hole && clamped[ka] && clamped[kb] && clamped[kc] && clamped[kd]) continue;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    const nrm = new Float32Array(pos.length); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    add(color, pattern, g, 'main', (x, _y, z) => floorAO(x, z));
  };

  // ------------------------------------------------------------------ floors
  for (const z of layout.zones) {
    if (z.id === 'PIT' || z.level === 1) continue;
    const [x0, z0, x1, z1] = z.rect;
    const st = styleOf(z.id);
    const y = z.id === 'ENG' ? (z.floor ?? 0) : z.id === 'NAP' ? 0.004 : 0;
    const hero = ['ATR', 'E1', 'E2', 'E3', 'LOB'].includes(z.id);
    const pit = pitCircle;
    // the atrium grid stops at the stone band round the Pit (its rings below are coplanar, so no planarity edge lines)
    floorGrid(x0, z0, x1, z1, y, hero ? 0.25 : 0.33, st.floor[0], st.floor[1], z.id === 'ATR' ? [pit[0], pit[1], MOSAIC_R] : null);
    if (z.id === 'ENG') add('#4B4D4B', 'none', rbox(0.2, 0.25, z1 - z0, 0.02).translate(x0 + 0.1, 0.125, (z0 + z1) / 2));
  }
  // [ENV fix r2] the Pit bowl + its atrium ring as a finished stone piece (review m175-r2: from `pitOverview` the tread
  // bands and the outer ring read as flat grey and the checker lane did not register). Shared kit:
  //  - `sector(a, b, t0, dt, …)`: a coplanar ring sector; every ring below is an exact partition of its annulus (tiles +
  //    grout sectors share their edges), all at the tread's height (edge.ts: no decal steps on a floor)
  //  - `nosing(r, y)`: a bevelled bullnose lip on the top edge of every riser (flush with the tread above, rounding down
  //    1.8 cm proud of the riser), with a brass anti-slip strip set into the tread just behind it — the real ≥ 1.5 cm
  //    step there is the only line the edge pass draws
  //  - `tiles(…)`: a row of tiles in two alternating tones with 1.2 cm grout joints (AO fn per tread)
  const BRASS = '#C99A4A', NOSE = '#DCD0BA', GROUT = '#4F544F';
  const [pcx, pcz] = pitCircle;
  const sector = (a: number, b: number, y: number, col: string, pat?: string, ao: AoFn | null = null, t0 = 0, dt = Math.PI * 2, segs = RING_SEG): void => {
    const n = Math.max(1, Math.round(segs * dt / (Math.PI * 2)));
    add(col, pat, new THREE.RingGeometry(a, b, n, Math.max(1, Math.round((b - a) / 0.25)), t0, dt).rotateX(-Math.PI / 2).translate(pcx, y, pcz), 'main', ao);
  };
  const nosing = (r: number, y: number, riserH: number): void => {
    const d = Math.min(0.05, riserH * 0.35);
    // lathe profile (radius, height) from the tread over the lip down onto the riser face: listed top → bottom, so the
    // faces point at the Pit's centre (the risers face it too)
    const pts = [[r + 0.05, y], [r + 0.012, y], [r - 0.006, y - 0.005], [r - 0.016, y - 0.016], [r - 0.018, y - d * 0.55], [r - 0.012, y - d * 0.9], [r, y - d]]
      .map(([x, yy]) => new THREE.Vector2(x - 0.0, yy));
    add(NOSE, 'none', new THREE.LatheGeometry(pts, RING_SEG).translate(pcx, 0, pcz));
    sector(r + 0.05, r + 0.085, y, BRASS, 'none'); // brass strip
  };
  // an underlay 4 mm below a tiled annulus: the tile / strip rings do not share vertices, so their chords leave
  // sub-mm T-junction slivers that showed the dark void under the floor as dashes along every brass strip
  const under = (a: number, b: number, y: number, col: string): void => add(col, 'none', new THREE.RingGeometry(a, b, RING_SEG, 1).rotateX(-Math.PI / 2).translate(pcx, y - 0.004, pcz));
  const tiles = (a: number, b: number, y: number, n: number, cols: readonly string[], pat: string, ao: AoFn | null, phase = 0, colOf: ((i: number) => string) | null = null): void => {
    const dt = Math.PI * 2 / n, g = 0.006 / ((a + b) / 2); // half a joint, in radians
    const segs = Math.max(1, Math.round(RING_SEG / n));
    for (let i = 0; i < n; i++) {
      const t0 = phase + i * dt;
      sector(a, b, y, GROUT, 'none', ao, t0 - g, 2 * g, Math.PI / g); // one segment
      sector(a, b, y, colOf ? colOf(i) : cols[i % 2], pat, ao, t0 + g, dt - 2 * g, segs * n);
    }
  };
  // atrium ring (y 0), inside → out: the Pit's top nosing + brass, a paved stone band (48 slabs, warm, grouted), a cream
  // line, a ring of 40 big terrazzo slabs, then the checker lane — the atrium's "clock face": two rows of 64 big tiles
  // (≈ 0.5 × 0.55 m, oat / slate-teal, albedo L* ≈ 69 / 60: ≤ 15 L*, [ENV fix m2 r1]) with a teal column every 45°
  // between brass lines — then terrazzo to the grid
  {
    const r0 = pitCircle[2];
    const aoF: AoFn = (x, _y, z) => floorAO(x, z);
    nosing(r0, 0, 0.15);
    under(r0, MOSAIC_R, 0, '#6E665E');
    tiles(r0 + 0.085, PIT_BAND - 0.07, 0, 48, ['#7B7064', '#6E645A'], 'terrazzo', aoF, 0.03);
    sector(PIT_BAND - 0.07, PIT_BAND, 0, NOSE, 'none', aoF); // cream line
    // a walking ring of big grouted terrazzo slabs (the atrium floor's value: pitOverview's floor / pool probes land on it)
    const atr = ZONE_STYLE.ATR.floor;
    tiles(PIT_BAND, LANE_R - 0.04, 0, 40, [atr[0], '#9B928A'], atr[1], aoF, 0.05);
    const L0 = LANE_R, L1 = L0 + 1.0, mid = (L0 + L1) / 2, N = 64;
    sector(L0 - 0.04, L0, 0, BRASS, 'none', aoF);
    for (const [a, b, row] of [[L0, mid, 0], [mid, L1, 1]]) {
      // [ENV fix m2 r1] low-contrast checker (§5.5 floors low-contrast; review m2 r1: the old sand L* 70 / umber 32 ring
      // was the highest-contrast surface in every atrium frame): oat L* 69 / slate-teal 60, teal columns L* 56 / 58
      tiles(a, b, 0, N, [], 'terrazzo', aoF, Math.PI / 2 - Math.PI / N, (i) => (i % 8 === 0 ? (row ? '#6A8C86' : '#71918B') : (i + row) % 2 ? '#B3A68F' : '#7E948E'));
    }
    sector(L1, L1 + 0.04, 0, BRASS, 'none', aoF);
    sector(L1 + 0.04, MOSAIC_R / Math.cos(Math.PI / RING_SEG), 0, atr[0], atr[1], aoF);
  }
  // the Pit: tiled terrazzo treads stepping down in value toward the rug, risers facing the centre, a bevelled nosing +
  // brass strip on every riser's top edge, a soft AO band at the foot of each riser
  {
    const P = layout.plan.PIT;
    // cool sage terrazzo tiles (the Pit is where Clawds sit, §5.5 complementary staging), two tones per tread
    const TREAD = [['#93A39A', '#84958C'], ['#7F9088', '#72837B']];
    const inward = (g: THREE.BufferGeometry): THREE.BufferGeometry => {
      const idx = g.index;
      if (idx) for (let i = 0; i < idx.count; i += 3) { const t2 = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, t2); }
      const n = g.getAttribute('normal');
      for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
      return g;
    };
    let prevY = 0;
    P.rings.forEach(([r, y], i) => {
      const rin = P.rings[i + 1]?.[0] ?? 0;
      const yin = P.rings[i + 1]?.[1] ?? y;
      const last = i === P.rings.length - 1;
      // AO: darker at the foot of this tread's riser (the outer edge) and round the sofa feet
      const aoFn: AoFn = (x, _y, z) => { const d = r - Math.hypot(x - pcx, z - pcz); return (1 - 0.22 * Math.exp(-d / 0.12)) * floorAO(x, z); };
      if (!last) {
        nosing(rin, y, y - yin);
        under(rin, r, y, (TREAD[i] ?? TREAD[1])[1]);
        const a = rin + 0.085, b = r - 0.07;
        tiles(a, b, y, Math.round((Math.PI * (a + b)) / 0.5 / 4) * 4, TREAD[i] ?? TREAD[1], 'terrazzo', aoFn, 0.02 * i);
      } else {
        const rug = MISC.pitRug, rao: AoFn = (x, _y, z) => floorAO(x, z);
        const bands: [number, number, string, string?][] = [[0, 0.98, rug, 'felt'], [0.98, 1.02, '#C9BFAE'], [1.02, 2.3, rug, 'felt'], [2.3, 2.34, '#C9BFAE'], [2.34, 2.45, rug, 'felt'], [2.45, 2.66, '#3E7069', 'felt'], [2.66, r - 0.07, rug, 'felt']];
        for (const [a, b, col, pat] of bands) {
          if (a === 0) add(col, pat, new THREE.CircleGeometry(b, RING_SEG).rotateX(-Math.PI / 2).translate(pcx, y, pcz), 'main', rao);
          else sector(a, b, y, col, pat, pat ? (b > 2.6 ? aoFn : rao) : null);
        }
      }
      sector(r - 0.07, r, y, '#5E574F', 'none', aoFn); // foot of the riser
      add('#4B443D', 'none', inward(new THREE.CylinderGeometry(r, r, prevY - y, RING_SEG, 1, true)).translate(pcx, (prevY + y) / 2, pcz));
      prevY = y;
    });
  }
  // mezzanine slab + landing (MEZ carpet on top, Library ceiling underneath, walnut fascia on the open edges)
  const MZ: Rect[] = layout.plan.MEZZ_RECTS.map(([a, b, c, d]): Rect => [a - OX, b - OZ, c - OX, d - OZ]);
  for (const [x0, z0, x1, z1] of MZ) {
    floorGrid(x0, z0, x1, z1, 2.901, 0.5, ZONE_STYLE.MEZ.floor[0], ZONE_STYLE.MEZ.floor[1]);
    add(ZONE_STYLE.LIB.ceil, 'plaster', rbox(x1 - x0, 0.3, z1 - z0, 0.02).translate((x0 + x1) / 2, 2.75, (z0 + z1) / 2), 'main', null, 'lib');
  }
  { // [ENV fix m2 r1] the Library's ceiling = the mezzanine underside: walnut beams N–S on two girders, a coffer rhythm
    const [x0, z0, x1, z1] = MZ[0], yb = 2.6;
    const n = Math.round((x1 - x0) / 1.4);
    for (let i = 1; i < n; i++) { const x = x0 + ((x1 - x0) * i) / n; add('#6B5646', 'wood', rbox(0.14, 0.18, z1 - z0 - 0.2, 0.02).translate(x, yb - 0.09, (z0 + z1) / 2), 'main', null, 'lib'); }
    for (const zc of [z0 + (z1 - z0) / 3, z0 + (2 * (z1 - z0)) / 3]) add('#5E4A3C', 'wood', rbox(x1 - x0 - 0.2, 0.24, 0.2, 0.02).translate((x0 + x1) / 2, yb - 0.12, zc), 'main', null, 'lib');
  }
  {
    const [x0, , x1, z1] = MZ[0];
    add(ENV.walnut, 'wood', rbox(x1 - x0 - 2 + 0.02, 0.26, 0.05, 0.015).translate((x0 + x1 - 2) / 2, 2.78, z1 + 0.025), 'main', null, 'core');
    add('#D8CBB4', 'none', rbox(x1 - x0 - 2 + 0.03, 0.03, 0.07, 0.01).translate((x0 + x1 - 2) / 2, 2.915, z1 + 0.02), 'main', null, 'core');
    const [lx0, lz0, , lz1] = MZ[1];
    add(ENV.walnut, 'wood', rbox(0.05, 0.26, lz1 - lz0, 0.015).translate(lx0 - 0.025, 2.78, (lz0 + lz1) / 2), 'main', null, 'core');
    add(ENV.walnut, 'wood', rbox(MZ[1][2] - lx0, 0.26, 0.05, 0.015).translate((lx0 + MZ[1][2]) / 2, 2.78, lz1 + 0.025), 'main', null, 'core');
  }

  // ------------------------------------------------------------------ façade ([ENV fix m2 r3])
  /**
   * review m2 r3 (zones13-8 / zones22-8): the south façade was one flat taupe slab with a blank top third. Every
   * exterior wall's outside face now carries the diorama façade kit, all merged into the architecture (0 draws):
   * an ashlar stone plinth down to the garden with a cream cap keyline, a warm sand running-bond brick body (OUT wall
   * style) broken by cream stucco pilasters, a stone string course over the window heads and a cream frieze band
   * above it, a stepped cornice (fascia, deep-teal keyline, crown) under a parapet with a rounded coping, and per
   * opening a stucco surround (deeper reveal), a projecting stone sill with a drip and a keystoned lintel; the entrance
   * gets a deep stone portal. The sign, awning, window boxes, sconces and steps are kit props (zones/exterior.ts).
   */
  function facade() {
    const G = -0.56, CREAM = '#E6DAC4', STUCCO = '#DCCDB5', STONE = '#D2C5AE', PLINTH = '#8E877D', KEY = ENV.tealDeep;
    for (const w of layout.walls) {
      if (w.kind === 'rail' || (w.y0 ?? 0) > 0.05 || !isExterior(w)) continue;
      const [ax, az] = w.a, [bx, bz] = w.b, len = Math.hypot(bx - ax, bz - az);
      const ux = (bx - ax) / len, uz = (bz - az) / len, nx = -uz, nz = ux, yaw = Math.atan2(-uz, ux), t = w.t ?? 0.2;
      const pt = (s: number, off: number): [number, number] => [ax + ux * s + nx * off, az + uz * s + nz * off];
      const inB = (x: number, z: number): boolean => x > b0.minX && x < b0.maxX && z > b0.minZ && z < b0.maxZ;
      const sg = inB(...pt(len / 2, 0.6)) ? -1 : 1; // the outside side
      const F = t / 2, H = w.h;
      /** box along the wall: centre s, height band [y0, y1], `out` m proud of the outside face */
      const box = (col: string, pat: string, s: number, gw: number, y0: number, y1: number, out: number, r = 0.012, back = 0): void => {
        const d = out + back, [px, pz] = pt(s, sg * (F + (out - back) / 2));
        add(col, pat, (r > 0 ? rbox(gw, y1 - y0, d, r) : new THREE.BoxGeometry(gw, y1 - y0, d)).rotateY(yaw).translate(px, (y0 + y1) / 2, pz), 'main', null, 'EXT'); // [ENV M3.5 tris] EXT: drawn from outside / the plan only
      };
      const ops = (w.openings ?? []).filter((q) => q.kind !== 'lintel').sort((p, q) => p.at - q.at);
      const doors = ops.filter((q) => q.sill < 0.05);
      const head = ops.reduce((m: number, q) => Math.max(m, q.sill + q.h), 0);
      const sc = Math.min(H - 0.5, Math.max(head + 0.16, 2.2)); // string course
      // spans of the wall not cut by a door (plinth, string course) / by any opening (pilasters)
      const spans = (cuts: readonly WallOpening[], pad: number): Span[] => {
        let segs: Span[] = [[-0.07, len + 0.07]];
        for (const q of cuts) {
          segs = segs.flatMap(([a, b]): Span[] => {
            if (q.at + q.w + pad <= a || q.at - pad >= b) return [[a, b]];
            const cut: Span[] = [[a, q.at - pad], [q.at + q.w + pad, b]];
            return cut.filter(([u, v]) => v - u > 0.05);
          });
        }
        return segs;
      };
      // plinth: ashlar (cobble pattern) from the garden to 0.42, with a cream cap keyline
      for (const [a, b] of spans(doors, 0.3)) {
        box(PLINTH, 'cobble', (a + b) / 2, b - a, G, 0.42, 0.06, 0);
        box(CREAM, 'none', (a + b) / 2, b - a + 0.02, 0.42, 0.48, 0.09, 0.015);
      }
      // stucco pilasters: at both corners and in the middle of every solid run ≥ 1.7 m (≤ 3.6 m apart)
      const pil: Span[] = [[0.22, 0.44], [len - 0.22, 0.44]];
      for (const [a, b] of spans(ops, 0.35)) {
        const a1 = Math.max(a, 0.5), b1 = Math.min(b, len - 0.5);
        if (b1 - a1 < 1.3) continue;
        const n = Math.max(1, Math.round((b1 - a1) / 3.6));
        for (let i = 0; i < n; i++) pil.push([a1 + ((b1 - a1) * (i + 0.5)) / n, 0.36]);
      }
      for (const [s, gw] of pil) {
        box(STUCCO, 'plaster', s, gw, 0.48, sc, 0.05, 0);
        box(CREAM, 'none', s, gw + 0.06, sc - 0.1, sc, 0.075, 0.012); // capital
      }
      // string course + frieze band + stepped cornice + parapet with coping (run past the corners: they return)
      box(STONE, 'none', len / 2, len + 0.14, sc, sc + 0.09, 0.08, 0.02);
      if (H - 0.14 - (sc + 0.09) > 0.12) box(CREAM, 'plaster', len / 2, len + 0.1, sc + 0.09, H - 0.14, 0.02, 0);
      box(CREAM, 'none', len / 2, len + 0.16, H - 0.14, H, 0.08, 0); // fascia
      box(KEY, 'none', len / 2, len + 0.22, H, H + 0.04, 0.11, 0); // keyline
      box(CREAM, 'none', len / 2, len + 0.3, H + 0.04, H + 0.15, 0.15, 0.03); // crown
      box(STUCCO, 'plaster', len / 2, len + 0.2, H + 0.15, H + 0.5, 0.0, 0, t); // parapet (the wall's own thickness)
      box('#EEE5D3', 'none', len / 2, len + 0.28, H + 0.5, H + 0.57, 0.06, 0.025, t + 0.06); // coping
      // per opening: stucco surround (deeper reveal), sill + drip, keystoned lintel; the entrance: a stone portal
      for (const q of ops) {
        const c = q.at + q.w / 2, top = q.sill + q.h;
        if (q.sill < 0.05) {
          for (const e of [q.at - 0.17, q.at + q.w + 0.17]) box(STONE, 'none', e, 0.34, 0, top + 0.02, 0.16, 0.025);
          box(STONE, 'none', c, q.w + 0.72, top + 0.02, top + 0.26, 0.18, 0.03);
          box(CREAM, 'none', c, q.w + 0.8, top + 0.26, top + 0.31, 0.21, 0.015);
          box(STUCCO, 'none', c, 0.3, top - 0.04, top + 0.3, 0.22, 0.02); // keystone
          continue;
        }
        for (const e of [q.at - 0.06, q.at + q.w + 0.06]) box(STUCCO, 'none', e, 0.12, q.sill, top, 0.06, 0);
        box(STONE, 'none', c, q.w + 0.36, q.sill - 0.07, q.sill, 0.13, 0.015); // sill
        box(PLINTH, 'none', c, q.w + 0.24, q.sill - 0.12, q.sill - 0.07, 0.07, 0); // drip
        box(STONE, 'none', c, q.w + 0.3, top, top + 0.15, 0.075, 0.015); // lintel
        box(CREAM, 'none', c, 0.2, top - 0.03, top + 0.2, 0.1, 0.015); // keystone
      }
    }
  }

  // ------------------------------------------------------------------ walls + trims
  const frames: { w: Wall; o: WallOpening; yaw: number; at: (s: number, off?: number) => [number, number]; y0: number; ext: boolean; len: number }[] = [];
  const TRIM_D = 0.022;
  for (const w of layout.walls) {
    const [ax, az] = w.a, [bx, bz] = w.b;
    const len = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / len, uz = (bz - az) / len, nx = -uz, nz = ux;
    const yaw = Math.atan2(-uz, ux);
    const y0 = w.y0 ?? 0, t = w.t ?? 0.2;
    const at = (s: number, off = 0): [number, number] => [ax + ux * s + nx * off, az + uz * s + nz * off];
    // [ENV fix m2 r1] perf (arch was 240k tris, 142k of it these pieces at 108 tris each): r 0 = a plain box (12 tris)
    // for the wall slabs (their ends hide in architraves / wall joints) and the wainscot stiles (5 × 3 cm)
    // [ENV fix m2 r3] perf: trims default to plain boxes too (baseboards, rails, stiles, cornices: 21.7k tris as 44-tri
    // chamfers, drawn twice with the depth prepass; a 1 cm bevel on a 3 cm trim is under a pixel from 1 m)
    const piece = (color: string, pattern: string, gw: number, gh: number, gd: number, s: number, y: number, off: number, group = 'main', r = 0): void => { const [px, pz] = at(s, off); add(color, pattern, (r > 0 ? rbox(gw, gh, gd, r) : new THREE.BoxGeometry(gw, gh, gd)).rotateY(yaw).translate(px, y, pz), group); };
    if (w.kind === 'rail') { // glass balustrade: a thin walnut tube on ink posts over glass
      const [mx, mz] = at(len / 2);
      add(ENV.walnut, 'wood', new THREE.CylinderGeometry(0.022, 0.022, len + 0.04, 10).rotateZ(Math.PI / 2).rotateY(yaw).translate(mx, y0 + w.h - 0.02, mz));
      add(IRON, 'none', rbox(len + 0.02, 0.03, 0.05, 0.01).rotateY(yaw).translate(mx, y0 + 0.03, mz));
      for (let s = 0; s <= len + 1e-6; s += Math.max(0.3, len / Math.ceil(len / 1.2))) { const [px, pz] = at(s); add(IRON, 'none', rbox(0.04, w.h - 0.02, 0.04, 0.012).translate(px, y0 + (w.h - 0.02) / 2, pz)); }
      glassIn.push(new THREE.PlaneGeometry(len, w.h - 0.12).rotateY(yaw).translate(mx, y0 + 0.06 + (w.h - 0.12) / 2, mz));
      continue;
    }
    const ext = isExterior(w);
    const ops = [...(w.openings ?? [])].sort((p, q) => p.at - q.at);
    const cuts = [0, len, ...ops.flatMap((q) => [q.at, q.at + q.w])].filter((v) => v >= 0 && v <= len).sort((p, q) => p - q);
    for (let i = 0; i < cuts.length - 1; i++) {
      const s0 = cuts[i], s1 = cuts[i + 1];
      if (s1 - s0 < 0.005) continue;
      const mid = (s0 + s1) / 2;
      let spans: Span[] = [[y0, y0 + w.h]];
      for (const q of ops) {
        if (q.at > mid || q.at + q.w < mid) continue;
        const c0 = y0 + q.sill, c1 = y0 + q.sill + q.h;
        spans = spans.flatMap(([p, qq]): Span[] => {
          if (c1 <= p || c0 >= qq) return [[p, qq]];
          const cut: Span[] = [[p, c0], [c1, qq]];
          return cut.filter(([u, v]) => v - u > 0.005);
        });
        if (['glass', 'window', 'highWindow', 'display'].includes(q.kind)) {
          const [gx, gz] = at(mid);
          (ext ? glassOut : glassIn).push(new THREE.PlaneGeometry(s1 - s0, q.h).rotateY(yaw).translate(gx, c0 + q.h / 2, gz));
        }
        frames.push({ w, o: q, yaw, at, y0, ext, len });
      }
      const endPad = (i === 0 || i === cuts.length - 2 ? t / 2 : 0.002);
      // [RND m2 fix r1, cross-owner minimal] the corner pad goes on the wall's *outer* end only: centred, it also pushed
      // the slab t/4 into a door next to the corner, exactly onto the jamb's inner face (NAP door: z-fighting stipple
      // along the jamb, crop_nap_edges.png). Same outer overlap (t/4) as before, 1 mm at a door edge.
      const padA = i === 0 ? t / 4 : 0.001, padB = i === cuts.length - 2 ? t / 4 : 0.001;
      const slabL = s1 - s0 + padA + padB, slabMid = mid + (padB - padA) / 2;
      for (const side of [-1, 1]) {
        const [sx, sz] = at(mid, side * 0.5);
        for (const [p, q] of spans) {
          const lvl = (p + q) / 2 > 2.9 && layout.plan.onMezz(sx + OX, sz + OZ) ? 1 : 0;
          const zone = zoneAtW(sx, sz, lvl) ?? 'OUT';
          const st = styleOf(zone);
          piece(st.wall[0], st.wall[1], slabL, q - p, t / 2, slabMid, (p + q) / 2, side * t / 4, 'main', 0);
          if (zone === 'OUT' || s1 - s0 < 0.12) continue;
          const face = side * (t / 2 + TRIM_D / 2);
          const L = s1 - s0 + (endPad > 0.01 ? 0 : 0.0);
          // trims only on spans that reach the floor of this side
          const floorY = zone === 'ENG' ? 0.25 : 0;
          const wh = st.wainH ?? WAIN_H; // [ENV fix m2 r2] per-zone wainscot height (BAY: tall panelling)
          if (p <= floorY + 0.01 && q - p > wh + 0.15) {
            piece(st.base, 'none', L, BASE_H, TRIM_D + 0.012, mid, floorY + BASE_H / 2, side * (t / 2 + (TRIM_D + 0.012) / 2));
            if (st.wain) {
              piece(st.wain, 'plaster', L, wh - BASE_H, TRIM_D, mid, floorY + BASE_H + (wh - BASE_H) / 2, face);
              const nSt = Math.max(1, Math.round(L / 0.9));
              for (let k = 0; k <= nSt; k++) { const s = s0 + (L * k) / nSt; if (k === 0 || k === nSt) continue; piece(st.wain, 'none', 0.05, wh - BASE_H - 0.08, TRIM_D + 0.012, s, floorY + BASE_H + (wh - BASE_H) / 2, side * (t / 2 + (TRIM_D + 0.012) / 2), 'main', 0); }
              piece(st.rail, 'none', L, 0.04, TRIM_D + 0.02, mid, floorY + wh + 0.02, side * (t / 2 + (TRIM_D + 0.02) / 2));
            }
          }
          const zc = zoneDef(zone)?.ceil ?? 2.8;
          if (q >= zc - 0.02 && p < zc - 0.2) piece(st.rail, 'none', L, 0.07, 0.05, mid, zc - 0.045, side * (t / 2 + 0.025), 'cap', 0);
        }
      }
    }
    const [mx, mz] = at(len / 2);
    add(MISC.trim, 'none', new THREE.BoxGeometry(len + t, 0.04, t + 0.02).rotateY(yaw).translate(mx, y0 + w.h + 0.02, mz), 'cap'); // plan view only
  }
  facade();
  // opening frames: chunky architraves (jambs + head + sill), mullions matching the gobo on windows
  const seen = new Set<WallOpening>();
  for (const { w, o: q, yaw, at, y0, ext } of frames) {
    if (seen.has(q)) continue; seen.add(q);
    if (q.kind === 'lintel' || q.kind === 'opening') continue;
    const dark = q.kind === 'storefront' || q.kind === 'display' || w.kind === 'storefront';
    const col = dark ? '#7A6C5F' : q.kind === 'glass' ? IRON : ENV.oak;
    const c0 = y0 + q.sill, c1 = c0 + q.h, dep = (w.t ?? 0.2) + 0.07;
    const fw = q.kind === 'glass' ? 0.07 : 0.1;
    for (const e of [q.at, q.at + q.w]) { const [px, pz] = at(e); add(col, 'wood', rbox(fw, q.h, dep, 0.018).rotateY(yaw).translate(px, (c0 + c1) / 2, pz)); }
    const [hx, hz] = at(q.at + q.w / 2);
    add(col, 'wood', rbox(q.w + fw * 2, 0.1, dep, 0.018).rotateY(yaw).translate(hx, c1 + 0.05, hz));
    if (q.sill > 0.05) add(q.kind === 'glass' ? IRON : MISC.trim, 'none', rbox(q.w + 0.2, 0.05, dep + 0.08, 0.018).rotateY(yaw).translate(hx, c0 - 0.025, hz));
    if (q.kind === 'window' || q.kind === 'highWindow') { // 3 × 2 panes (hqGobo nu 3, nv 2)
      for (const f of [1 / 3, 2 / 3]) { const [px, pz] = at(q.at + q.w * f); add(col, 'wood', rbox(0.05, q.h, 0.08, 0.012).rotateY(yaw).translate(px, (c0 + c1) / 2, pz)); }
      add(col, 'wood', rbox(q.w, 0.05, 0.08, 0.012).rotateY(yaw).translate(hx, (c0 + c1) / 2, hz));
    } else if (q.kind === 'glass' && q.w > 1.2) { // E-bay / ENG ribbon glazing: slim mullions + a transom
      const n = Math.round(q.w / 1.1);
      for (let k = 1; k < n; k++) { const [px, pz] = at(q.at + (q.w * k) / n); add(IRON, 'none', rbox(0.035, q.h, 0.06, 0.01).rotateY(yaw).translate(px, (c0 + c1) / 2, pz)); }
      add(IRON, 'none', rbox(q.w, 0.035, 0.06, 0.01).rotateY(yaw).translate(hx, c1 - 0.42, hz));
    } else if (q.kind === 'door' || q.kind === 'arch' || q.kind === 'entrance') { // threshold strip
      add('#5E4636', 'none', rbox(q.w, 0.012, dep, 0.004).rotateY(yaw).translate(hx, c0 + 0.006, hz));
    }
  }

  // ------------------------------------------------------------------ ceiling detail ([ENV fix m2 r1])
  // review m2 r1: big flat ceilings made the secondary zones look cheap (the Library's mezzanine underside, café,
  // Archive, Mailroom and the Lobby were one flat value over 20–35% of the frame). Every room ceiling now gets a
  // structure one value step darker than its plaster (joists, coffers or girders; walnut beams in the Library) and the
  // back-of-house rooms a cool steel duct run on hangers. All merged into the ceiling groups (0 draws), chamfered boxes.
  const beam = (col: string, pat: string, x0: number, z0: number, x1: number, z1: number, yTop: number, depth: number, group = 'ceil'): void => add(col, pat, rbox(Math.max(0.02, x1 - x0), depth, Math.max(0.02, z1 - z0), 0.018).translate((x0 + x1) / 2, yTop - depth / 2, (z0 + z1) / 2), group);
  /** parallel joists across a rect: `along` = the axis the joists run along; spacing between centres */
  const joists = (col: string, pat: string, [x0, z0, x1, z1]: Rect, yTop: number, along: 'x' | 'z', spacing: number, w: number, depth: number, group = 'ceil'): void => {
    const [a0, a1] = along === 'x' ? [z0, z1] : [x0, x1];
    const n = Math.max(1, Math.round((a1 - a0) / spacing));
    for (let i = 1; i < n; i++) {
      const c = a0 + ((a1 - a0) * i) / n;
      if (along === 'x') beam(col, pat, x0 + 0.1, c - w / 2, x1 - 0.1, c + w / 2, yTop, depth, group);
      else beam(col, pat, c - w / 2, z0 + 0.1, c + w / 2, z1 - 0.1, yTop, depth, group);
    }
  };
  /** a round steel duct from (xa, za) to (xb, zb) hung `drop` below the ceiling, with flanged joints + hanger straps */
  const duct = (col: string, xa: number, za: number, xb: number, zb: number, yTop: number, r: number, drop: number, group = 'ceil'): void => {
    const L = Math.hypot(xb - xa, zb - za), yaw = Math.atan2(xb - xa, zb - za), yc = yTop - drop - r;
    add(col, 'none', new THREE.CylinderGeometry(r, r, L, 12, 1, true).rotateX(Math.PI / 2).rotateY(yaw).translate((xa + xb) / 2, yc, (za + zb) / 2), group);
    const nJ = Math.max(1, Math.round(L / 1.6));
    for (let i = 0; i <= nJ; i++) {
      const t = i / nJ, x = xa + (xb - xa) * t, zz = za + (zb - za) * t;
      add(IRON, 'none', new THREE.TorusGeometry(r + 0.008, 0.012, 4, 12).rotateY(yaw).translate(x, yc, zz), group); // flange
      if (i > 0 && i < nJ) add(IRON, 'none', new THREE.BoxGeometry(0.02, drop + r, 0.03).rotateY(yaw).translate(x, yTop - (drop + r) / 2, zz), group); // hanger
    }
  };
  function ceilDetail(id: string, rect: Rect, y: number): void {
    const [x0, z0, x1, z1] = rect;
    const st = styleOf(id);
    const tone = (hex: string, k: number): string => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();
    switch (id) {
      case 'LOB': { // coffers: painted beams both ways + a deeper walnut girder over the Help Desk line
        const c = tone(st.ceil, 0.84);
        joists(c, 'plaster', rect, y, 'z', 1.75, 0.16, 0.2);
        joists(c, 'plaster', rect, y, 'x', 1.75, 0.16, 0.2);
        beam('#6B5242', 'wood', x0 + 0.1, z0 + 0.2, x1 - 0.1, z0 + 0.46, y, 0.3);
        break;
      }
      case 'CAF': { // exposed timber joists over two walnut girders (the café's "barn" ceiling)
        joists('#BFAE96', 'wood', rect, y, 'z', 0.9, 0.09, 0.14);
        for (const zc of [z0 + 2.7, z0 + 5.4]) beam('#957C66', 'wood', x0 + 0.1, zc - 0.12, x1 - 0.1, zc + 0.12, y - 0.14, 0.22);
        break;
      }
      case 'MAIL': { // joists + a cool steel duct down the room (value-map cool accent)
        joists(tone(st.ceil, 0.86), 'plaster', rect, y, 'x', 0.85, 0.1, 0.14);
        duct('#7E9594', x1 - 0.75, z0 + 0.4, x1 - 0.75, z1 - 0.6, y, 0.13, 0.18);
        break;
      }
      case 'ARC': { // coffers + a steel duct along the south side
        const c = tone(st.ceil, 0.84);
        joists(c, 'plaster', rect, y, 'z', 1.5, 0.14, 0.18);
        joists(c, 'plaster', rect, y, 'x', 1.55, 0.14, 0.18);
        duct('#7F9398', x0 + 0.5, z1 - 1.0, x1 - 0.6, z1 - 1.0, y, 0.16, 0.22);
        break;
      }
      case 'ENG': { // twin ducts over the benches
        duct('#6F7A78', x0 + 0.4, z0 + 2.4, x1 - 0.8, z0 + 2.4, y, 0.2, 0.18);
        duct('#6F7A78', x0 + 0.4, z1 - 2.2, x1 - 0.8, z1 - 2.2, y, 0.14, 0.26);
        break;
      }
      case 'STR': joists(tone(st.ceil, 0.72), 'wood', rect, y, 'x', 1.2, 0.12, 0.18); break; // [ENV fix m2 r2] walnut joists over the board ceiling
      case 'NAL': case 'WAR': case 'LAB': case 'PLZ': joists(tone(st.ceil, 0.86), st.wall[1] === 'brick' ? 'none' : 'plaster', rect, y, (x1 - x0) > (z1 - z0) ? 'z' : 'x', 1.0, 0.1, 0.14); break;
      default:
        if (/^[EW]\d$/.test(id)) joists(tone(st.ceil, 0.88), 'plaster', rect, y, 'x', 1.0, 0.1, 0.14);
    }
  }

  // ------------------------------------------------------------------ ceilings (+ atrium beams, skylight)
  for (const z of layout.zones) {
    if (['PIT', 'NAP', 'LIB'].includes(z.id)) continue;
    const [x0, z0, x1, z1] = z.rect;
    const y = z.ceil ?? 2.8;
    const st = styleOf(z.id);
    if (z.id === 'ATR') {
      const [sx0, sz0, sx1, sz1] = layout.skylight.rect;
      const sh = new THREE.Shape();
      sh.moveTo(x0, z0); sh.lineTo(x1, z0); sh.lineTo(x1, z1); sh.lineTo(x0, z1); sh.lineTo(x0, z0);
      const hole = new THREE.Path(); hole.moveTo(sx0, sz0); hole.lineTo(sx0, sz1); hole.lineTo(sx1, sz1); hole.lineTo(sx1, sz0); hole.lineTo(sx0, sz0); sh.holes.push(hole);
      add(st.ceil, 'plaster', new THREE.ShapeGeometry(sh).rotateX(Math.PI / 2).translate(0, y, 0), 'ceil');
      // coffer beams (walnut) on a 3 m grid, skipping the skylight
      const beam = '#6B5242';
      for (let bx = x0 + 3; bx < x1 - 0.5; bx += 3) {
        if (bx > sx0 - 0.2 && bx < sx1 + 0.2) { add(beam, 'wood', rbox(0.2, 0.26, sz0 - z0, 0.03).translate(bx, y - 0.13, (z0 + sz0) / 2), 'ceil'); add(beam, 'wood', rbox(0.2, 0.26, z1 - sz1, 0.03).translate(bx, y - 0.13, (sz1 + z1) / 2), 'ceil'); }
        else add(beam, 'wood', rbox(0.2, 0.26, z1 - z0, 0.03).translate(bx, y - 0.13, (z0 + z1) / 2), 'ceil');
      }
      for (let bz = z0 + 3; bz < z1 - 0.5; bz += 3) {
        if (bz > sz0 - 0.2 && bz < sz1 + 0.2) { add(beam, 'wood', rbox(sx0 - x0, 0.2, 0.18, 0.03).translate((x0 + sx0) / 2, y - 0.1, bz), 'ceil'); add(beam, 'wood', rbox(x1 - sx1, 0.2, 0.18, 0.03).translate((sx1 + x1) / 2, y - 0.1, bz), 'ceil'); }
        else add(beam, 'wood', rbox(x1 - x0, 0.2, 0.18, 0.03).translate((x0 + x1) / 2, y - 0.1, bz), 'ceil');
      }
      // skylight: deep frame, 2 × 2 mullions (hqGobo), glass, sky above
      const fr = (w2: number, d2: number, px: number, pz: number, h2 = 0.3): void => add(CORE.ink2, 'none', rbox(w2, h2, d2, 0.03).translate(px, y - h2 / 2 + 0.05, pz), 'ceil');
      fr(sx1 - sx0 + 0.3, 0.25, (sx0 + sx1) / 2, sz0); fr(sx1 - sx0 + 0.3, 0.25, (sx0 + sx1) / 2, sz1);
      fr(0.25, sz1 - sz0, sx0, (sz0 + sz1) / 2); fr(0.25, sz1 - sz0, sx1, (sz0 + sz1) / 2);
      fr(0.12, sz1 - sz0, (sx0 + sx1) / 2, (sz0 + sz1) / 2, 0.16); fr(sx1 - sx0, 0.12, (sx0 + sx1) / 2, (sz0 + sz1) / 2, 0.16);
      glassOut.push(new THREE.PlaneGeometry(sx1 - sx0, sz1 - sz0).rotateX(Math.PI / 2).translate((sx0 + sx1) / 2, y + 0.05, (sz0 + sz1) / 2));
      skyGeos.push(new THREE.PlaneGeometry(sx1 - sx0 + 12, sz1 - sz0 + 12).rotateX(Math.PI / 2).translate((sx0 + sx1) / 2, y + 4, (sz0 + sz1) / 2));
      continue;
    }
    add(st.ceil, z.id === 'STR' || z.id === 'PLZ' ? 'planks' : 'plaster', new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(Math.PI / 2).translate((x0 + x1) / 2, y, (z0 + z1) / 2), 'ceil'); // [ENV fix m2 r2] STR / PLZ: board ceiling
    ceilDetail(z.id, z.rect, y);
  }
  // exterior sky cards all round (the sky shader draws skyline / garden, §7.3) + ground below the Pit's floor
  {
    const pad = 6, H = 12;
    const card = (w2: number, px: number, pz: number, ry: number): number => skyGeos.push(new THREE.PlaneGeometry(w2, H).rotateY(ry).translate(px, H / 2 - 2, pz));
    card(b0.maxX - b0.minX + 2 * pad, (b0.minX + b0.maxX) / 2, b0.minZ - pad, 0);
    card(b0.maxX - b0.minX + 2 * pad, (b0.minX + b0.maxX) / 2, b0.maxZ + pad, Math.PI);
    card(b0.maxZ - b0.minZ + 2 * pad, b0.minX - pad, (b0.minZ + b0.maxZ) / 2, Math.PI / 2);
    card(b0.maxZ - b0.minZ + 2 * pad, b0.maxX + pad, (b0.minZ + b0.maxZ) / 2, -Math.PI / 2);
    // [ENV fix m2 r2] the lawn runs 40 m past the building (the plan view showed its hard edge ~6 m out, flat backdrop
    // beyond): subdivided so its vertex colour carries soft mowing stripes (E–W, 2.4 m), a few low-frequency patches,
    // and a gentle darkening toward the far rim, so the diorama sits on a lawn instead of a green rectangle (the sky
    // cards hide everything past 6 m from inside)
    const LP = 40, cx = (b0.minX + b0.maxX) / 2, cz = (b0.minZ + b0.maxZ) / 2, lw = b0.maxX - b0.minX + 2 * LP, ld = b0.maxZ - b0.minZ + 2 * LP;
    const lawnK: AoFn = (x, _y, z) => {
      const dx = Math.max(0, b0.minX - x, x - b0.maxX), dz = Math.max(0, b0.minZ - z, z - b0.maxZ), d = Math.hypot(dx, dz);
      const stripe = Math.floor((z + 100) / 2.4) % 2 ? 1.05 : 0.96;
      const patch = 1 + 0.05 * Math.sin(x * 0.23 + 1.3) * Math.sin(z * 0.19 + 0.4) + 0.02 * Math.sin(x * 0.61 - z * 0.47);
      return stripe * patch * (1 - 0.16 * Math.min(1, Math.max(0, (d - 8) / 26)));
    };
    // [ENV fix m2 r3] perf: 4 m columns (the stripes run E–W, so only z needs the 1.2 m rows): 18k → 5.6k tris
    // [ENV M3.5 tris] the striped lawn is EXT (outside / plan view only: 2 × 5.6k tris with the depth prepass); from
    // inside, the few metres seen past the south hedges are a plain 2-triangle lawn 2.5 cm under it (no z-fight)
    add('#7F8A6E', 'none', new THREE.PlaneGeometry(lw, ld, Math.round(lw / 4), Math.round(ld / 1.2)).rotateX(-Math.PI / 2).translate(cx, -0.55, cz), 'main', lawnK, 'EXT');
    add('#7F8A6E', 'none', new THREE.PlaneGeometry(lw, ld, 1, 1).rotateX(-Math.PI / 2).translate(cx, -0.575, cz), 'main', null, 'OUT');
  }
  // stairs: open risers, oak treads with a rounded nosing, ink stringers, balusters + walnut handrail
  {
    const S = layout.stairs, n = 17;
    const x0 = S.x0 - OX, x1 = S.x1 - OX, zf = S.zFoot - OZ, zt = S.zTop - OZ, w2 = x1 - x0 - 0.12, run = zf - zt;
    for (let i = 0; i < n; i++) {
      const zc = zf - (i + 0.5) * (run / n), y = S.rise * (i + 1) / n;
      add('#A57C52', 'wood', rbox(w2, 0.055, run / n + 0.04, 0.02).translate((x0 + x1) / 2, y - 0.028, zc - 0.01)); // [ENV fix m2 r3] chamfer (was a 300-tri round)
    }
    const slope = Math.atan2(S.rise, run), L = Math.hypot(S.rise, run);
    for (const x of [x0 + 0.04, x1 - 0.04]) add(CORE.ink2, 'none', rbox(0.06, 0.24, L, 0.025).rotateX(slope).translate(x, S.rise / 2 - 0.1, (zf + zt) / 2));
    add(ENV.walnut, 'wood', new THREE.CylinderGeometry(0.025, 0.025, L + 0.1, 10).rotateX(Math.PI / 2).rotateX(slope).translate(x0, S.rise / 2 + 0.9, (zf + zt) / 2));
    for (let i = 0; i <= 12; i++) { const z = zf - (i / 12) * run, y = S.rise * (i / 12); add(CORE.ink2, 'none', rbox(0.03, 0.9, 0.03, 0.01).translate(x0, y + 0.45, z)); }
    for (const [z, y] of [[zf, 0], [zt, S.rise]]) add(ENV.walnut, 'wood', rbox(0.1, 1.0, 0.1, 0.03, 2).translate(x0, y + 0.5, z));
    add('#B8904F', 'none', new THREE.SphereGeometry(0.06, 12, 8).translate(x0, 1.04, zf));
  }
  // the slide: butter tube along the baked helix, the centre pole, three support posts, a mouth hoop
  {
    const pts = layout.slide.path.map((p) => new THREE.Vector3(p.x, p.y + 0.3, p.z));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    add('#E9C477', 'none', new THREE.TubeGeometry(curve, 128, layout.slide.tube, 14, false), 'main', null, 'core'); // [ENV fix m2 r3] perf: was 180 × 16
    for (const t of [0.0, 0.5, 0.97]) add('#C9A45E', 'none', new THREE.TorusGeometry(layout.slide.tube + 0.01, 0.025, 6, 20).lookAt(curve.getTangent(t)).translate(...curve.getPoint(t).toArray()), 'main', null, 'core');
    const c = layout.slide.center;
    add(CORE.ink2, 'none', new THREE.CylinderGeometry(0.09, 0.11, 3.3, 14).translate(c.x, 1.65, c.z), 'main', null, 'core');
    add(CORE.ink2, 'none', new THREE.CylinderGeometry(0.22, 0.26, 0.06, 18).translate(c.x, 0.03, c.z), 'main', null, 'core');
    for (const t of [0.3, 0.55, 0.8]) {
      const p = curve.getPoint(t);
      if (p.y < 0.8) continue;
      add(CORE.ink2, 'none', new THREE.CylinderGeometry(0.03, 0.035, p.y - layout.slide.tube, 8).translate(p.x, (p.y - layout.slide.tube) / 2, p.z), 'main', null, 'core');
    }
  }

  // ------------------------------------------------------------------ merge
  // [ENV fix r1] perf: the vis table lets almost every cell see almost every other (hq.ts VIS_TABLE), so per-region
  // groups only cost draws: merge the vis regions into three spatial super-regions (west of the atrium / the core /
  // east of it: frustum culling still drops one or two from most poses) and the wall caps into the ceilings (both
  // toggle with the plan view). `regionCells` = the vis cells of each super-region (build/index.ts culling).
  // [ENV fix r2] perf (review m175-r2: 187–247 draws in the hero views vs ≤ 150): one merge per pattern for the whole
  // office (was per super-region: from the spawn / Pit / plan all three are in view anyway, so the split only cost
  // ~17 draws; the architecture is ~250k tris, all of it drawn from those poses already). toonEnv never casts.
  const superOf = (r: string): string => (r === 'EXT' ? 'EXT' : 'A'); // [ENV M3.5 tris] + EXT: the façade trims + striped lawn (build/index.ts shows it from outside only)
  const regionCells = new Map<string, Set<string>>();
  for (const c of layout.visCells) {
    const s = superOf(c.region);
    const cells = regionCells.get(s) ?? new Set<string>();
    regionCells.set(s, cells);
    cells.add(c.id);
  }
  // [ENV fix m2 r1] perf (draws): the ceilings (+ wall caps) share their pattern's mesh with the rest of the
  // architecture, laid out LAST in its buffer; the plan view hides them by trimming the draw range (`ceilings` =
  // {mesh, mainCount} handles for build/index.ts) instead of costing 3 extra draws every frame
  const merged = new Map<string, { main: THREE.BufferGeometry[]; ceil: THREE.BufferGeometry[] }>();
  for (const [k, geos] of arch) {
    const [group, region, pattern] = split3(k);
    const mk = `main@${superOf(region)}@${pattern}`;
    const entry = merged.get(mk) ?? { main: [], ceil: [] };
    merged.set(mk, entry);
    entry[group === 'main' ? 'main' : 'ceil'].push(...geos);
  }
  const groups = new Map<string, THREE.Group>();
  const groupOf = (r: string): THREE.Group => { let g = groups.get(r); if (!g) { g = new THREE.Group(); g.name = `arch:${r}`; groups.set(r, g); } return g; };
  const ceilings: CeilingHandle[] = [];
  let draws = 0, tris = 0;
  for (const [k, { main, ceil }] of merged) {
    const [group, region, pattern] = split3(k);
    const geos = [...main, ...ceil];
    const g = mergeGeometries(geos, false);
    if (!g) throw new Error(`buildArchitecture: merge failed for ${k}`);
    const mainCount = main.reduce((n, q) => n + q.getAttribute('position').count, 0);
    for (const q of geos) q.dispose();
    const mesh = new THREE.Mesh(g, getMaterial('toonEnv', { color: '#FFFFFF', vertexColors: true, pattern: isPattern(pattern) ? pattern : 0 }));
    mesh.name = `arch:${group}:${region}:${pattern}`;
    // [ENV M3.5 tris] floors (and the wood trims / beams) occlude nothing the walls don't: they skip RND's
    // architecture depth prepass (post.ts), which drew every architecture triangle a second time
    if (NO_PREPASS.has(pattern)) mesh.userData.noPrepass = true;
    mesh.receiveShadow = true;
    if (ceil.length) ceilings.push({ mesh, mainCount, set(on) { g.drawRange.count = on ? Infinity : mainCount; mesh.visible = on || mainCount > 0; } });
    groupOf(region).add(mesh);
    draws++; tris += g.getAttribute('position').count / 3;
  }
  const extra: THREE.Mesh[] = [];
  const addGlass = (list: THREE.BufferGeometry[], reflect: 'interior' | 'exterior', name: string): void => {
    if (!list.length) return;
    const g = mergeGeometries(list.map((q) => clean(q)), false);
    if (!g) throw new Error(`buildArchitecture: glass merge failed (${name})`);
    const m = new THREE.Mesh(g, getMaterial('glass', { color: reflect === 'exterior' ? '#DDEBF2' : '#E8E2D6', reflect }));
    m.name = name; extra.push(m); draws++;
  };
  addGlass(glassIn, 'interior', 'hq:glass:interior');
  addGlass(glassOut, 'exterior', 'hq:glass:exterior');
  if (skyGeos.length) {
    const skyGeo = mergeGeometries(skyGeos.map((q) => clean(q)), false);
    if (!skyGeo) throw new Error('buildArchitecture: sky merge failed');
    const m = new THREE.Mesh(skyGeo, getMaterial('sky'));
    m.name = 'hq:sky'; extra.push(m); draws++;
  }
  return { groups, regionCells, extra, ceilings, stats: { draws, tris: Math.round(tris) } };
}
