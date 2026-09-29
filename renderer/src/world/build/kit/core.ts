/**
 * Prop-kit core (§7.5): geometry primitives (bevelled, tapered, lathed, extruded), the part/item contract, and the
 * baker that turns placed kit items into per-vis-cell merged meshes.
 *
 * Builder contract: `build<Name>(params, rng) → {parts, footprint, solid, anchors}` where every part is
 * `{geometry, slot, mat?, cast?, ao?, color?}` in prop-local coords (y up from the floor, front = +z):
 * - `slot` ∈ body | secondary | accent (the 3-colour rule, colours from `params.colors` or the builder's defaults),
 *   or a literal `color` for multi-token groups the table allows (book spines, notes, flowers);
 * - `mat` ∈ plain | wood | fabric | small | foliage | bulb | shade | flame (material class, see CLASS below);
 * - `ao` multiplies the baked vertex AO (crevices), `ao:false` skips it (flat decals such as rugs).
 *
 * Static placements are BAKED (vertex colour × ±4% lightness jitter × vertex AO, transformed to world) and merged per
 * vis cell × material class into count-1 InstancedMeshes, so the whole kit rides the existing `toonProp`
 * INSTANCED+VCOL program (and `foliage` VCOL+SWAY): a zone costs ≤ 8 draws however many props it holds, and every
 * placement can be a unique seeded variant for free. Owner: ENV.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32, hash32 } from '../../../../../shared/identity.ts';

// ------------------------------------------------------------------------------------------------ primitives
/** A point / vector as a tuple. */
export type V3 = readonly [number, number, number];
/** A point given as a plain array (path points built up in loops). */
export type Pt = readonly number[];
/**
 * [ENV fix r1] Geometry detail (1 = full, 0.5 = the far LOD the baker builds for props seen from beyond 8 m): radial
 * segment counts scale with it (never under a floor that keeps silhouettes round at that range) and bevels drop to
 * chamfers. Set only around a build (`withDetail`), so builders stay oblivious.
 */
let DETAIL = 1;
// [ENV fix m2 r1] at the far detail (≤ 0.5) every floor drops to 5 segments (sphere rings 3): a far chunk is 7+ m away
const S = (n: number, min = 5) => (DETAIL >= 1 ? n : Math.max(Math.min(n, DETAIL <= 0.5 ? Math.min(min, 5) : min), Math.round(n * DETAIL)));
/** The current geometry detail (builders with hand-made geometry scale their own segments by it). */
export const detail = () => DETAIL;
/** Run `fn` with the geometry detail set to `d`. */
export function withDetail<T>(d: number, fn: () => T): T { const prev = DETAIL; DETAIL = d; try { return fn(); } finally { DETAIL = prev; } }
/**
 * Bevelled box, centred. Parts under 2.5 cm on a side (or with a bevel < 6 mm) become plain boxes (12 tris: the bevel
 * is sub-pixel beyond 1 m); `seg` 1 is a
 * chamfer (≈108 tris), 2 a round (≈300 tris) for silhouette-defining edges.
 */
export function rbox(w: number, h: number, d: number, r = 0.02, seg = 1): THREE.BufferGeometry {
  const mn = Math.min(w, h, d);
  const rr = Math.min(r, mn / 2 - 1e-4);
  if (mn < 0.025 || rr < 0.006 || (DETAIL < 1 && mn < 0.06) || DETAIL <= 0.5) return new THREE.BoxGeometry(w, h, d); // slats, spines, strips (and every box of the far LOD): bevel invisible
  // [ENV fix m2 r1] perf: a round (seg 2, 300 tris) only on boxes ≥ 20 cm with a ≥ 15 mm bevel; the rest get the
  // 44-tri smooth chamfer (was RoundedBoxGeometry seg 1: 108 tris for the same silhouette)
  if (DETAIL < 1 || Math.max(w, h, d) < 0.2 || rr < 0.015 || seg <= 1) return chamferBox(w, h, d, rr);
  return new RoundedBoxGeometry(w, h, d, seg, rr);
}
/**
 * [ENV fix m2 r1] Chamfered box, centred: 24 vertices (3 per corner, each pushed out r along one axis from the inner
 * box), 6 face quads + 12 edge quads + 8 corner triangles = 44 tris. Vertex normals are the push axes, so the
 * chamfers shade as a soft round (like RoundedBoxGeometry) while the faces stay flat.
 */
export function chamferBox(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
  const vid = (sx: number, sy: number, sz: number, ax: number) => ((((sx > 0 ? 1 : 0) * 2 + (sy > 0 ? 1 : 0)) * 2 + (sz > 0 ? 1 : 0)) * 3 + ax);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) for (let ax = 0; ax < 3; ax++) {
    const n = [ax === 0 ? sx : 0, ax === 1 ? sy : 0, ax === 2 ? sz : 0];
    pos.push(sx * hx + n[0] * r, sy * hy + n[1] * r, sz * hz + n[2] * r); nrm.push(...n);
  }
  const tri = (a: number, b: number, c: number) => { // wind outward (convex, centred on the origin)
    const A = a * 3, B = b * 3, C = c * 3;
    const ux = pos[B] - pos[A], uy = pos[B + 1] - pos[A + 1], uz = pos[B + 2] - pos[A + 2], vx = pos[C] - pos[A], vy = pos[C + 1] - pos[A + 1], vz = pos[C + 2] - pos[A + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * (pos[A] + pos[B] + pos[C]) + cy * (pos[A + 1] + pos[B + 1] + pos[C + 1]) + cz * (pos[A + 2] + pos[B + 2] + pos[C + 2]) >= 0) idx.push(a, b, c); else idx.push(a, c, b);
  };
  const quad = (a: number, b: number, c: number, e: number) => { tri(a, b, c); tri(a, c, e); };
  const S2 = [-1, 1];
  // faces: along each axis, the 4 corners' vertices pushed along that axis, in ring order
  for (const s of S2) {
    quad(vid(s, -1, -1, 0), vid(s, 1, -1, 0), vid(s, 1, 1, 0), vid(s, -1, 1, 0));
    quad(vid(-1, s, -1, 1), vid(1, s, -1, 1), vid(1, s, 1, 1), vid(-1, s, 1, 1));
    quad(vid(-1, -1, s, 2), vid(1, -1, s, 2), vid(1, 1, s, 2), vid(-1, 1, s, 2));
  }
  // edges: along z at (sx, sy) joins the x- and y-pushed vertices; along x at (sy, sz); along y at (sx, sz)
  for (const a of S2) for (const b of S2) {
    quad(vid(a, b, -1, 0), vid(a, b, 1, 0), vid(a, b, 1, 1), vid(a, b, -1, 1));
    quad(vid(-1, a, b, 1), vid(1, a, b, 1), vid(1, a, b, 2), vid(-1, a, b, 2));
    quad(vid(a, -1, b, 0), vid(a, 1, b, 0), vid(a, 1, b, 2), vid(a, -1, b, 2));
  }
  for (const sx of S2) for (const sy of S2) for (const sz of S2) tri(vid(sx, sy, sz, 0), vid(sx, sy, sz, 1), vid(sx, sy, sz, 2));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}
/**
 * [ENV fix m2 r1] perf (§5.3 tris; review m2 r1: bulbs 62k, knobs / pots / beads at 16–36 segments): radial segments
 * capped by the part's radius at every detail level, so a 2 cm knob or bulb never costs more than a 30 cm pot.
 * Radius → max radial segments: < 1.5 cm 6 · < 4 cm 8 · < 8 cm 12 · < 16 cm 16 · < 30 cm 22 · else 28.
 */
const radSeg = (r: number, n: number) => Math.min(n, r < 0.015 ? 6 : r < 0.04 ? 8 : r < 0.08 ? 12 : r < 0.16 ? 16 : r < 0.3 ? 22 : 28);
/** Cylinder / cone (tapered leg), centred on its height. */
export const cyl = (rt: number, rb: number, h: number, seg = 10, open = false) => new THREE.CylinderGeometry(rt, rb, h, S(radSeg(Math.max(rt, rb), seg), 6), 1, open);
/** Lathe from [radius, y] pairs (bottom → top). */
export const lathe = (pts: readonly Pt[], seg = 16) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), S(radSeg(Math.max(...pts.map((q) => q[0])), seg), 8));
export const sphere = (r: number, ws = 12, hs = 8) => new THREE.SphereGeometry(r, S(radSeg(r, ws), 6), Math.max(DETAIL <= 0.5 ? 3 : 4, S(Math.min(hs, Math.max(4, Math.round(radSeg(r, ws) * 0.66))), 4)));
export const capsule = (r: number, len: number, cs = 3, rs = 10) => new THREE.CapsuleGeometry(r, len, S(Math.min(cs, r < 0.05 ? 2 : cs), 2), S(radSeg(r, rs), 6));
export const torus = (R: number, r: number, rs = 6, ts = 16, arc = Math.PI * 2) => new THREE.TorusGeometry(R, r, S(Math.min(rs, r < 0.01 ? 4 : rs), 3), S(Math.max(6, Math.round(radSeg(R, ts) * Math.max(0.25, arc / (Math.PI * 2)))), 8), arc);
/** Tube along points ([x,y,z][]), radius r. */
export function tube(pts: readonly Pt[], r: number, seg = 12, rs = 6): THREE.TubeGeometry {
  const c = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal');
  return new THREE.TubeGeometry(c, S(seg, 4), r, S(rs, 4), false);
}
/** Rounded-rectangle shape centred on the origin. */
export function roundedRect(w: number, d: number, r: number): THREE.Shape {
  const s = new THREE.Shape(), x = -w / 2, y = -d / 2;
  r = Math.min(r, w / 2 - 1e-4, d / 2 - 1e-4);
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
/**
 * Horizontal slab with rounded corners (plan) and a small edge bevel: table tops, rugs, plaques. Bottom at y 0.
 * `t` = thickness, `r` = corner radius.
 */
export function slab(w: number, d: number, t: number, r = 0.05, bevel = 0.01, curve = 4): THREE.ExtrudeGeometry {
  if (DETAIL <= 0.5) { bevel = 0; curve = Math.min(curve, 2); } // [ENV fix m2 r1] far LOD: no edge bevel
  const b = Math.min(bevel, t / 2 - 1e-4);
  const g = new THREE.ExtrudeGeometry(roundedRect(w - 2 * b, d - 2 * b, Math.max(0.001, r - b)), { depth: Math.max(1e-4, t - 2 * b), bevelEnabled: b > 1e-4, bevelThickness: b, bevelSize: b, bevelSegments: 1, curveSegments: curve });
  return g.rotateX(-Math.PI / 2).translate(0, b, 0);
}
/** Disc slab (round top / round rug), bottom at y 0. */
export function disc(r: number, t: number, seg = 28, bevel = 0.01): THREE.LatheGeometry {
  const b = Math.min(bevel, t / 2 - 1e-4, r / 3);
  return lathe([[0, 0], [r - b, 0], [r, b], [r, t - b], [r - b, t], [0, t]], seg);
}

/** Apply a transform: position, Euler (YXZ), scale. Returns the geometry. */
const tM = new THREE.Matrix4(), tQ = new THREE.Quaternion(), tE = new THREE.Euler(), tS = new THREE.Vector3(), tP = new THREE.Vector3();
export function at<G extends THREE.BufferGeometry>(geo: G, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): G {
  tE.set(rx, ry, rz, 'YXZ');
  geo.applyMatrix4(tM.compose(tP.set(x, y, z), tQ.setFromEuler(tE), tS.set(sx, sy, sz)));
  return geo;
}
/** Orient a Y-axis geometry (cylinder / capsule) along the segment a → b and centre it there. */
export function between<G extends THREE.BufferGeometry>(geo: G, a: Pt, b: Pt): G {
  const va = new THREE.Vector3(a[0], a[1], a[2]), vb = new THREE.Vector3(b[0], b[1], b[2]);
  const d = vb.clone().sub(va), len = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  geo.applyMatrix4(tM.compose(va.add(vb).multiplyScalar(0.5), q, tS.set(1, 1, 1)));
  return geo;
}
/** A leg tapering from rt (top) to rb (bottom), from y0 to y1, at (x, z), splayed by (ax, az) radians. */
export const leg = (x: number, z: number, y0: number, y1: number, rt: number, rb: number, seg = 8, ax = 0, az = 0) => at(cyl(rt, rb, y1 - y0, seg), x, (y0 + y1) / 2, z, ax, 0, az);

// ------------------------------------------------------------------------------------------------ parts & items
export type MatClass = 'plain' | 'wood' | 'fabric' | 'small' | 'foliage' | 'bulb' | 'shade' | 'flame';
/** The 3-colour rule's slots. */
export type SlotName = 'body' | 'secondary' | 'accent' | 'bulb';
/** Colour overrides by slot (`params.colors`) or a builder's defaults (`item.colors`). */
export interface Colors { body?: string; secondary?: string; accent?: string; bulb?: string; fringe?: string }
/** `grad` = [bottom colour, top colour, y0, y1]: a vertical vertex-colour gradient (foliage moss → sage) */
export type Grad = [string, string, number, number];
export interface Part {
  geometry: THREE.BufferGeometry;
  slot: SlotName;
  mat: MatClass;
  cast: boolean;
  ao: number | false;
  color?: string;
  grad?: Grad;
}
/** Named attachment points a builder exposes (prop-local); only the ones consumers read are listed. */
export interface Anchors {
  top?: number;
  seat?: number | Pt;
  backTop?: number;
  bulb?: Pt;
  belt?: number;
  lower?: number;
  upper?: number;
  hook?: number | Pt;
  screen?: { x: number; y: number; z: number; rx?: number; w: number; h: number };
  /** the test-light lens cups (centre + radius) */
  lenses?: { x: number; y: number; z: number; r: number }[];
  [name: string]: unknown;
}
export type Footprint = { w: number; d: number } | { r: number };
export interface Item {
  parts: Part[];
  footprint: Footprint;
  solid: boolean;
  anchors: Anchors;
  colors: Colors;
  small?: boolean;
  tris?: number;
  hero?: string;
  collider?: Footprint;
  backRecline?: number;
  backWidth?: number;
}
/** Random source of a builder: `() => [0, 1)`. */
export type Rng = () => number;
/** Pose → matrix input: {x, y, z, yaw, rx?, rz?, s?} (yaw = prop-front yaw: local +z faces `yaw`). */
export interface Pose { x: number; y?: number; z: number; yaw?: number; rx?: number; rz?: number; s?: number }
/** A builder: params (optional) + rng → item. */
export type Builder = (p: KitParams | undefined, rng: Rng) => Item;
/** A prop-sheet entry: [builder name, params, label]. */
export type SheetEntry = readonly [name: string, params: KitParams, label: string];

export interface DeskBack { z: number; t: number; h: number; recline: number }
/**
 * Every parameter any builder reads (all optional; a builder ignores the keys it does not know). Kept in one bag so the
 * registry, the prop sheet and the zones share one param type; a key means the same thing wherever it appears.
 */
export interface KitParams {
  // size
  w?: number; h?: number; d?: number; r?: number; len?: number; s?: number; y?: number;
  ceil?: number; reach?: number; open?: number; up?: number; land?: number; drop?: number; dropX?: number; hang?: number; lift?: number;
  lean?: number; bend?: number; sag?: number; tilt?: number; plinth?: number; servingX?: number; bellX?: number; bulbY?: number;
  backTop?: number; backH?: number; pipeY?: number; duct?: number; lo?: number; n?: number; count?: number; stars?: number; windows?: number;
  ws?: number; hs?: number; hour?: number; min?: number; m?: number; y0?: number; fill?: number;
  // choice / flags
  kind?: string; shape?: 'cone' | 'dome' | 'drum'; style?: number; out?: 'poster' | 'bread' | 'book'; arms?: 'roll' | 'track';
  seats?: number; rows?: number;
  /** desk: drawers on/off; filing cabinet: drawer count */
  drawers?: boolean | number;
  /** shelf: crown ornament on/off; studio props: height of the top (m) */
  top?: boolean | number;
  /** sofa: 'low' = pit lounger; bench: back height (m); desk chair: back panel geometry */
  back?: 'low' | number | DeskBack;
  /** grid: columns (number); bunting-style sets: colour list */
  cols?: number | string[];
  cast?: boolean; flowers?: boolean; fringe?: boolean; props?: boolean; roof?: boolean | string; wigwam?: boolean;
  wall?: boolean; vise?: boolean; sink?: boolean; riser?: boolean; lines?: boolean; mouse?: boolean; full?: boolean; rag?: boolean;
  noContact?: boolean;
  // colours
  colors?: Colors;
  quilt?: string; quilt2?: string; ring?: string; emblem?: string; doodle?: string; paint?: string; dark?: string; light?: string;
  text?: string;
  // structured
  pipeTo?: V3; pipeDir?: V3; boards?: [number, number][]; flags?: string[];
}

export interface PartOpts { mat?: MatClass; cast?: boolean; ao?: number | false; color?: string; grad?: Grad }
export const part = (geometry: THREE.BufferGeometry, slot: SlotName = 'body', o: PartOpts = {}): Part => ({ geometry, slot, mat: o.mat ?? 'plain', cast: o.cast ?? true, ao: o.ao ?? 1, color: o.color, grad: o.grad });
/** Seeded variation helpers bound to an rng. */
export function vary(rng: Rng) {
  return {
    /** v × (1 ± amt) */
    s: (v: number, amt = 0.04) => v * (1 + (rng() * 2 - 1) * amt),
    /** uniform in [a, b] */
    r: (a: number, b: number) => a + (b - a) * rng(),
    /** pick one */
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length) % arr.length],
    chance: (p: number) => rng() < p,
    int: (n: number) => Math.floor(rng() * n) % n,
  };
}
/** The helpers `vary(rng)` returns. */
export type Vary = ReturnType<typeof vary>;
/** rng from anything: number seed or string. */
export const rngOf = (seed: number | string): Rng => mulberry32(typeof seed === 'number' ? seed >>> 0 : hash32(String(seed)));

/** Triangle count of an item. */
export const trisOf = (item: Pick<Item, 'parts'>): number => item.parts.reduce((n, p) => n + (p.geometry.index ? p.geometry.index.count : p.geometry.getAttribute('position').count) / 3, 0);

// ------------------------------------------------------------------------------------------------ baking
const cA = new THREE.Color(), cB = new THREE.Color();
/** Keep only position + normal, indexed (so heterogeneous primitives merge). */
function normalise(g: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  if (!g.index) {
    const n = g.getAttribute('position').count;
    g.setIndex(n > 65535 ? new THREE.BufferAttribute(new Uint32Array([...Array(n).keys()]), 1) : [...Array(n).keys()]);
  }
  g.morphAttributes = {};
  return g;
}
/**
 * Bake one part: vertex colour (slot colour × jitter × AO) in local space, then transform by `m`.
 * AO: contact darkening near the prop's floor (−22% at 0, gone by 0.15 m), undersides −18%, × part.ao.
 * `jit` = lightness multiplier, `m` = the placement matrix.
 */
export function bakePart(p: Part, colors: Colors, jit: number, m: THREE.Matrix4, { contact = true }: { contact?: boolean } = {}): THREE.BufferGeometry {
  const g = normalise(p.geometry.clone());
  const pos = g.getAttribute('position'), nrm = g.getAttribute('normal');
  const col = new Float32Array(pos.count * 3);
  cA.set(p.color ?? colors[p.slot] ?? colors.body ?? '#FF00FF');
  // ±4% lightness in HSL keeps the hue
  const hsl = { h: 0, s: 0, l: 0 }; cA.getHSL(hsl); cA.setHSL(hsl.h, hsl.s, Math.min(0.95, hsl.l * jit));
  const grad = p.grad;
  const g0 = grad ? new THREE.Color(grad[0]) : null, g1 = grad ? new THREE.Color(grad[1]) : null;
  for (let i = 0; i < pos.count; i++) {
    if (grad && g0 && g1) { const t = Math.min(1, Math.max(0, (pos.getY(i) - grad[2]) / (grad[3] - grad[2]))); cA.copy(g0).lerp(g1, t).multiplyScalar(jit); }
    let ao = 1;
    if (p.ao !== false) {
      const y = pos.getY(i);
      if (contact) ao *= 1 - 0.22 * (1 - Math.min(1, Math.max(0, y / 0.15)));
      if (nrm.getY(i) < -0.6) ao *= 0.82;
      ao *= p.ao;
    }
    cB.copy(cA).multiplyScalar(ao);
    col[i * 3] = cB.r; col[i * 3 + 1] = cB.g; col[i * 3 + 2] = cB.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.applyMatrix4(m);
  return g;
}

/** Merge baked geometries (indexed, position/normal/color). */
export function mergeBaked(geos: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (!geos.length) return null;
  const g = mergeGeometries(geos, false);
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}
