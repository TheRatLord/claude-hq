/**
 * Prop kit: the garden outside the Lobby (§7.3 south "garden", the near layer in front of the sky shader's hill
 * cards): clipped hedges, lollipop trees, a pond with lily pads and a fake sky streak, a picket fence, stepping
 * stones, the entrance stoop and flower beds. Same §7.5 contract (bevelled / blobby, ≤ 3 tokens, a hero detail,
 * ≤ 1.5k tris). y = the local ground. Owner: ENV.
 */
import * as THREE from 'three';
import { rbox, cyl, sphere, disc, tube, at, part, vary } from './core.ts';
import type { Grad, KitParams, Part, Rng, SheetEntry, Vary } from './core.ts';
import { T, FLOWERS } from './tokens.ts';

const PI = Math.PI;
const G = (y0: number, y1: number): Grad => [T.leafDark, T.leafLight, y0, y1];
/** Pond water (cool, mid value) and its sky streak. */
const WATER = '#6F97A0', STREAK = '#B9D0D2';

/**
 * A soft lumpy blob (smooth normals, one mass: no interior outline lines). [ENV fix m2 r2] art bible "no faceted
 * spheres": always ≥ 16 × 11 segments whatever the build detail (the far-LOD bake used to drop these to 5 × 3, and a
 * 10-segment sphere with sharp ^4 bumps read as an icosahedron from the plan / lab window), and softer ^2 lumps.
 */
function blob(v: Vary, R: number, sy = 0.85, bumps = 6, amp = 0.3, seg = 18, minSeg = 16) {
  // [ENV fix m3 r1] `minSeg`: the window / plan-view trees (gardenTree `lo`) go down to 12 × 8 (§5.3 tris); soft ^2 lumps
  // + smooth normals keep them round at ≥ 3 m, the art-bible floor (16 × 11) stays the default for everything else
  const ws = Math.max(minSeg, seg), g = new THREE.SphereGeometry(1, ws, Math.max(Math.round(minSeg * 0.66), Math.round(ws * 0.66))), pos = g.getAttribute('position');
  const dirs = [];
  for (let i = 0; i < bumps; i++) { const a = v.r(0, PI * 2), y = v.r(-0.1, 0.95), r = Math.sqrt(1 - y * y); dirs.push([Math.cos(a) * r, y, Math.sin(a) * r, amp * 0.6 * v.r(0.5, 1)]); }
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let s = 1;
    for (const [dx, dy, dz, a] of dirs) s += a * Math.max(0, x * dx + y * dy + z * dz) ** 2;
    if (y < -0.3) s *= 1 - (-0.3 - y) * 0.4;
    pos.setXYZ(i, x * R * s, y * R * s * sy, z * R * s);
  }
  g.computeVertexNormals();
  return g;
}

/** Clipped hedge: a pill-rounded foliage block with a few soft bumps on top, on a low stone curb. */
export function buildHedge(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 2.0, d = p.d ?? 0.6, h = p.h ?? 0.7;
  const parts = [part(at(rbox(w + 0.06, 0.1, d + 0.06, 0.03), 0, 0.05, 0), 'secondary', { ao: 0.8 })];
  parts.push(part(at(rbox(w, h, d, Math.min(d, h) * 0.42, 2), 0, 0.08 + h / 2, 0), 'body', { mat: 'foliage', grad: G(0.1, h + 0.1) }));
  const n = Math.max(1, Math.round(w / 0.9));
  for (let i = 0; i < n; i++) parts.push(part(at(blob(v, d * 0.36, 0.7, 4, 0.2, 10), -w / 2 + (i + 0.5) * (w / n) + v.r(-0.1, 0.1), 0.08 + h - 0.04, v.r(-0.05, 0.05)), 'body', { mat: 'foliage', grad: G(0.1, h + 0.3) }));
  if (p.flowers !== false) for (let i = 0; i < Math.round(w * 3); i++) parts.push(part(at(sphere(0.026, 6, 5), v.r(-w / 2 + 0.08, w / 2 - 0.08), 0.08 + v.r(0.25, h - 0.05), (v.chance(0.5) ? 1 : -1) * (d / 2 + 0.01)), 'accent', { color: v.pick(FLOWERS), cast: false }));
  return { parts, footprint: { w, d }, solid: true, anchors: {}, colors: { body: T.leaf, secondary: T.stone, accent: T.rose }, hero: 'pill-clipped hedge, flower dots' };
}

/**
 * Garden tree. [ENV fix m2 r2] smooth clay canopies (art bible: no faceted spheres), two silhouettes so the lawn has
 * rhythm: `kind` 'round' (default) = a forked walnut trunk under a blob cluster (a big crown + 3–4 satellites, each
 * a 16–18-segment lumpy sphere, like the indoor tree-in-tub), 'poplar' = a tall capsule crown (18 radial segments)
 * with a smaller capsule tucked beside it. Every part is `foliage` (trunk included: walnut vertex colour), so the whole
 * orchard merges into ONE swaying mesh (build/index.ts `K~trees`: 1 draw + 1 depth draw, no far-LOD twin; the plan-only side-lawn trees: `K~treesPlan`).
 */
export function buildGardenTree(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), h = p.h ?? 2.6, kind = p.kind ?? 'round';
  // [ENV fix m3 r1] §5.3 tris (review m3 r1: foliage 202k, OUT 135k): `lo` 1 = a window-scenery tree (never nearer than
  // ≈ 2.5 m: ≈ 1.1k tris instead of 2.1k), 2 = the plan view's side lawns (seen from 30 m: ≈ 0.6k)
  const lo = p.lo ?? 0, sg = <N>(n0: N, n1: N, n2: N) => (lo >= 2 ? n2 : lo ? n1 : n0);
  const trunk = (g: THREE.BufferGeometry) => part(g, 'secondary', { mat: 'foliage', color: T.walnut, grad: [T.walnutDark, T.walnut, 0, h * 0.6] });
  const leaf = (g: THREE.BufferGeometry, y0: number, y1: number) => part(g, 'body', { mat: 'foliage', grad: G(y0, y1) });
  const parts: Part[] = [];
  if (kind === 'poplar') {
    const R = p.r ?? h * 0.17, L = h * 0.5;
    parts.push(trunk(at(new THREE.CylinderGeometry(0.045, 0.075, h * 0.4, sg(12, 8, 6)), 0, h * 0.2, 0)));
    parts.push(leaf(at(new THREE.CapsuleGeometry(R, L, sg(8, 5, 4), sg(18, 14, 10)), v.r(-0.03, 0.03), h * 0.3 + R + L / 2, v.r(-0.03, 0.03), v.r(-0.05, 0.05), 0, v.r(-0.05, 0.05)), h * 0.25, h * 1.05));
    const a = v.r(0, PI * 2);
    parts.push(leaf(at(new THREE.CapsuleGeometry(R * 0.62, L * 0.45, sg(6, 4, 3), sg(16, 12, 8)), Math.cos(a) * R * 0.75, h * 0.3 + R * 0.7 + L * 0.25, Math.sin(a) * R * 0.75), h * 0.25, h * 1.05));
    return { parts, footprint: { r: R }, collider: { r: 0.12 }, solid: true, anchors: {}, colors: { body: T.leaf, secondary: T.walnut }, hero: 'capsule poplar crown' };
  }
  const R = p.r ?? h * 0.26, top = h * 0.6;
  parts.push(trunk(tube([[0, 0, 0], [v.r(-0.04, 0.04), top * 0.5, v.r(-0.04, 0.04)], [0, top, 0]], 0.075, sg(8, 6, 4), sg(12, 8, 6))));
  parts.push(trunk(at(new THREE.LatheGeometry([[0.13, 0], [0.085, 0.08], [0.07, 0.16]].map(([r, y]) => new THREE.Vector2(r, y)), sg(12, 8, 6)), 0, 0, 0))); // root flare
  const n = 3 + v.int(2), a0 = v.r(0, PI * 2);
  parts.push(leaf(at(blob(v, R, 0.86, 6, 0.28, sg(18, 14, 10), sg(16, 12, 10)), 0, top + R * 0.75, 0), top - 0.1, top + R * 2));
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * PI * 2 + v.r(-0.3, 0.3), off = R * v.r(0.62, 0.78), y = top + R * v.r(0.25, 0.55);
    const tip = [Math.cos(a) * off * 0.7, y - R * 0.2, Math.sin(a) * off * 0.7];
    parts.push(trunk(tube([[0, top - 0.15, 0], [tip[0] * 0.5, (top + tip[1]) / 2, tip[2] * 0.5], tip], 0.03, sg(6, 4, 3), sg(8, 6, 4))));
    parts.push(leaf(at(blob(v, R * v.r(0.55, 0.68), 0.84, 5, 0.25, sg(16, 12, 8), sg(16, 12, 8)), Math.cos(a) * off, y, Math.sin(a) * off), top - 0.1, top + R * 2));
  }
  return { parts, footprint: { r: R }, collider: { r: 0.12 }, solid: true, anchors: {}, colors: { body: T.leaf, secondary: T.walnut }, hero: 'forked trunk + smooth blob-cluster crown' };
}

/** Pond: a sunken water ellipse with a pale sky streak, a ring of pebble stones, lily pads (one in flower), reeds. */
export function buildPond(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 2.4, d = p.d ?? 1.4;
  const sx = w / 2, sz = d / 2;
  const parts = [part(at(disc(1, 0.02, 32, 0.004), 0, -0.01, 0, 0, 0, 0, sx, 1, sz), 'body', { ao: false, cast: false })];
  parts.push(part(at(disc(1, 0.004, 14, 0.001), -sx * 0.2, 0.011, -sz * 0.15, 0, 0.5, 0, sx * 0.42, 1, sz * 0.12), 'body', { color: STREAK, ao: false, cast: false }));
  parts.push(part(at(disc(1, 0.004, 14, 0.001), sx * 0.25, 0.011, sz * 0.2, 0, 0.5, 0, sx * 0.2, 1, sz * 0.06), 'body', { color: STREAK, ao: false, cast: false }));
  const n = Math.round((w + d) * 4);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * PI * 2 + v.r(-0.05, 0.05), r = 1.02 + v.r(0, 0.06);
    parts.push(part(at(sphere(v.r(0.09, 0.14), 6, 4), Math.cos(a) * sx * r, 0.0, Math.sin(a) * sz * r, 0, v.r(0, PI), 0, 1.2, 0.55, 1), 'secondary'));
  }
  for (let i = 0; i < 5; i++) {
    const a = v.r(0, PI * 2), r = v.r(0.2, 0.65), x = Math.cos(a) * sx * r, z = Math.sin(a) * sz * r;
    parts.push(part(at(cyl(0.11, 0.11, 0.008, 10, false), x, 0.016, z, 0, a, 0), 'accent', { color: T.moss, cast: false }));
    if (i === 0) parts.push(part(at(sphere(0.035, 8, 6), x, 0.04, z), 'accent', { color: T.rose, cast: false }));
  }
  for (let i = 0; i < 9; i++) { const a = PI * 0.8 + v.r(-0.35, 0.35), r = 0.92; parts.push(part(at(cyl(0.006, 0.01, v.r(0.35, 0.6), 4), Math.cos(a) * sx * r + v.r(-0.1, 0.1), 0.2, Math.sin(a) * sz * r + v.r(-0.1, 0.1), v.r(-0.15, 0.15), 0, v.r(-0.15, 0.15)), 'accent', { color: T.leafDark, cast: false })); }
  return { parts, footprint: { w: w + 0.3, d: d + 0.3 }, solid: true, anchors: {}, colors: { body: WATER, secondary: T.stone, accent: T.moss }, hero: 'sky streak + lily pad in flower' };
}

/** Picket fence run along +x (`len`): pointed cream pickets on two rails, square posts with ball caps. */
export function buildPicketFence(p: KitParams = {}, rng: Rng) {
  const len = p.len ?? 3, h = p.h ?? 0.62, n = Math.round(len / 0.14);
  const parts: Part[] = [];
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + (i + 0.5) * (len / n);
    parts.push(part(at(new THREE.BoxGeometry(0.075, h - 0.06, 0.022), x, (h - 0.06) / 2, 0), 'body'));
    parts.push(part(at(new THREE.ConeGeometry(0.053, 0.07, 4, 1).rotateY(PI / 4), x, h - 0.025, 0, 0, 0, 0, 1, 1, 0.42), 'body'));
  }
  for (const y of [0.16, h - 0.2]) parts.push(part(at(rbox(len, 0.05, 0.025, 0.008), 0, y, -0.025), 'body', { ao: 0.9 }));
  for (const x of [-len / 2, len / 2]) {
    parts.push(part(at(rbox(0.08, h + 0.08, 0.08, 0.015), x, (h + 0.08) / 2, -0.02), 'secondary'));
    parts.push(part(at(sphere(0.05, 10, 8), x, h + 0.12, -0.02), 'secondary'));
  }
  return { parts, footprint: { w: len, d: 0.1 }, solid: true, anchors: {}, colors: { body: T.trim, secondary: T.sage }, hero: 'pointed pickets + ball-capped posts' };
}

/**
 * Entrance stoop: a stone landing at the door sill (y 0) and `n` steps down to the garden `drop` m below.
 * [ENV fix m2 r3] (review: "the steps are plain boxes"): rounded treads with a pale bullnose nosing proud of every
 * riser, stepped cheek walls with a rounded coping ending in ball-capped piers, a nosed landing, and two terracotta
 * pots with clipped topiary balls on the landing corners (were plain cubes).
 */
export function buildStoop(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 4, land = p.land ?? 1.2, drop = p.drop ?? 0.55, n = p.n ?? 3, run = 0.36, cw = 0.26;
  const tw = w - 2 * cw, parts: Part[] = [];
  const nose = (len: number, y: number, z: number) => parts.push(part(at(cyl(0.028, 0.028, len, 12), 0, y - 0.022, z + 0.012, 0, 0, PI / 2), 'secondary', { ao: 0.95 }));
  parts.push(part(at(rbox(w, drop, land, 0.04, 2), 0, -drop / 2, land / 2 - 0.02), 'body', { ao: 0.9 }));
  nose(tw, 0, land - 0.02);
  for (let i = 0; i < n; i++) {
    const top = -drop * (i + 1) / (n + 1), z = land + i * run;
    parts.push(part(at(rbox(tw, top + drop, run + 0.04, 0.03, 2), 0, (top - drop) / 2, z + run / 2), 'body', { ao: 0.92 }));
    nose(tw, top, z + run);
    // cheek walls step down with the flight (a block per step, rounded coping on each)
    for (const e of [-1, 1]) {
      const x = e * (w / 2 - cw / 2), ch = top + drop + 0.28;
      parts.push(part(at(rbox(cw, ch, run + 0.02, 0.03, 2), x, -drop + ch / 2, z + run / 2), 'body', { ao: 0.9 }));
      parts.push(part(at(rbox(cw + 0.05, 0.05, run + 0.05, 0.022), x, -drop + ch + 0.02, z + run / 2), 'secondary'));
    }
  }
  // foot piers with ball finials
  const zf = land + n * run + 0.12;
  for (const e of [-1, 1]) {
    const x = e * (w / 2 - cw / 2);
    parts.push(part(at(rbox(cw + 0.06, 0.62, 0.3, 0.03, 2), x, -drop + 0.31, zf), 'body', { ao: 0.88 }));
    parts.push(part(at(rbox(cw + 0.12, 0.05, 0.36, 0.02), x, -drop + 0.645, zf), 'secondary'));
    parts.push(part(at(sphere(0.085, 16, 12), x, -drop + 0.74, zf), 'secondary'));
    // landing pots + topiary
    const px = e * (w / 2 - 0.3);
    parts.push(part(at(new THREE.LatheGeometry([[0.001, 0], [0.13, 0], [0.16, 0.24], [0.185, 0.26], [0.185, 0.3], [0.15, 0.3]].map(([r, y]) => new THREE.Vector2(r, y)), 20), px, 0, 0.32), 'accent', { ao: 0.9 }));
    parts.push(part(at(blob(v, 0.2, 0.95, 5, 0.15, 16), px, 0.47, 0.32), 'accent', { mat: 'foliage', grad: G(0.3, 0.7) }));
  }
  return { parts, footprint: { w, d: land + n * run + 0.3 }, solid: false, anchors: {}, colors: { body: T.stone, secondary: '#D6CBB7', accent: '#B06E52' }, hero: 'bullnose nosings + ball-capped cheek piers' };
}

/** A curving path of flat stepping stones along +z (`n` stones over `len` m). */
export function buildSteppingStones(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), n = p.n ?? 6, len = p.len ?? 3, bend = p.bend ?? 0.3;
  const parts: Part[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, x = Math.sin(t * PI) * bend + v.r(-0.05, 0.05);
    parts.push(part(at(disc(1, 0.045, 12, 0.012), x, 0, t * len, 0, v.r(0, PI), 0, v.r(0.22, 0.28), 1, v.r(0.17, 0.22)), 'body', { ao: false }));
  }
  return { parts, footprint: { w: 0.6, d: len }, solid: false, anchors: {}, colors: { body: T.stone }, hero: 'irregular stepping stones' };
}

/** Flower bed: a low soil mound edged with a scalloped stone border, bush blobs and dotted flowers. */
export function buildFlowerBed(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 1.6, d = p.d ?? 0.8;
  const parts = [part(at(disc(1, 0.08, 20, 0.03), 0, 0, 0, 0, 0, 0, w / 2, 1, d / 2), 'secondary', { color: '#6B5646', ao: 0.8 })];
  const n = Math.round((w + d) * 4);
  for (let i = 0; i < n; i++) { const a = (i / n) * PI * 2; parts.push(part(at(sphere(0.06, 6, 4), Math.cos(a) * w / 2, 0.03, Math.sin(a) * d / 2, 0, 0, 0, 1, 0.6, 1), 'secondary')); }
  const m = Math.max(2, Math.round(w * 1.6));
  for (let i = 0; i < m; i++) parts.push(part(at(blob(v, v.r(0.14, 0.2), 0.75, 4, 0.2, 10), -w / 2 + 0.2 + (i / (m - 1 || 1)) * (w - 0.4), 0.1, v.r(-d * 0.15, d * 0.15)), 'body', { mat: 'foliage', grad: G(0.05, 0.4) }));
  for (let i = 0; i < Math.round(w * 6); i++) parts.push(part(at(sphere(0.03, 6, 4), v.r(-w * 0.42, w * 0.42), v.r(0.16, 0.3), v.r(-d * 0.35, d * 0.35)), 'accent', { color: v.pick(FLOWERS), cast: false }));
  return { parts, footprint: { w, d }, solid: false, anchors: {}, colors: { body: T.leaf, secondary: T.stone, accent: T.rose }, hero: 'scalloped stone edge + flower dots' };
}

export const EXTERIOR_KIT = {
  hedge: buildHedge, gardenTree: buildGardenTree, pond: buildPond, picketFence: buildPicketFence, stoop: buildStoop,
  steppingStones: buildSteppingStones, flowerBed: buildFlowerBed,
};
export const EXTERIOR_SHEET: SheetEntry[] = [
  ['hedge', {}, 'hedge'], ['gardenTree', {}, 'gardenTree'], ['pond', {}, 'pond'], ['picketFence', {}, 'picketFence'],
  ['stoop', {}, 'stoop'], ['steppingStones', {}, 'steppingStones'], ['flowerBed', {}, 'flowerBed'],
];
