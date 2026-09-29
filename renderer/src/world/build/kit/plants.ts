/**
 * Prop kit: plant family (§7.5 row 11): bush, monstera, fern, cactus, pothos (hanging), tree-in-tub, succulent.
 * Pots are lathed with a lip, a rim band (accent) and a saucer; foliage is smooth blobs / extruded notched leaves /
 * bent straps with a moss → sage height gradient, on the `foliage` class (VCOL + SWAY). Owner: ENV.
 */
import * as THREE from 'three';
import { rbox, cyl, lathe, sphere, capsule, tube, at, part, vary, detail } from './core.ts';
import type { Colors, Grad, KitParams, Part, Rng, Vary } from './core.ts';
import { T, FLOWERS } from './tokens.ts';

const PI = Math.PI;
const G = (y0: number, y1: number, lo: string = T.leafDark, hi: string = T.leafLight): Grad => [lo, hi, y0, y1];

/** Pot with saucer + rim band. Returns {parts, top}. `glaze` = pot body colour slot. */
function pot(rb: number, rt: number, h: number, o: { saucer?: boolean } = {}) {
  const parts: Part[] = [];
  if (o.saucer !== false) parts.push(part(lathe([[0, 0], [rb + 0.035, 0], [rb + 0.045, 0.012], [rb + 0.04, 0.02], [0, 0.02]], 16), 'body', { ao: 0.9 }));
  const y0 = o.saucer !== false ? 0.018 : 0;
  parts.push(part(lathe([[0, y0], [rb, y0], [rt, y0 + h - 0.035], [rt + 0.014, y0 + h - 0.03], [rt + 0.016, y0 + h], [rt - 0.012, y0 + h], [rt - 0.016, y0 + h - 0.03], [0, y0 + h - 0.035]], 16), 'body'));
  parts.push(part(at(lathe([[rt + 0.006, 0], [rt + 0.017, 0], [rt + 0.017, 0.028], [rt + 0.006, 0.028]], 16), 0, y0 + h - 0.03, 0), 'accent', { cast: false }));
  parts.push(part(at(cyl(rt - 0.016, rt - 0.016, 0.01, 12), 0, y0 + h - 0.04, 0), 'body', { ao: 0.45, cast: false })); // soil
  return { parts, top: y0 + h - 0.035 };
}
/**
 * One lumpy clay blob (bush / canopy): a sphere pushed out by a few seeded bumps, so the foliage reads as one soft
 * mass (no interior intersection lines for the outline pass), flattened a little underneath.
 */
function lumpy(v: Vary, R: number, sy = 0.85, bumps = 7, amp = 0.32, seg = 16) {
  const g = sphere(1, seg, Math.round(seg * 0.7)), pos = g.getAttribute('position');
  const dirs: [number, number, number, number][] = [];
  for (let i = 0; i < bumps; i++) {
    const a = v.r(0, Math.PI * 2), y = v.r(-0.2, 0.95), r = Math.sqrt(1 - y * y);
    dirs.push([Math.cos(a) * r, y, Math.sin(a) * r, amp * v.r(0.5, 1)]);
  }
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let s = 1;
    for (const [dx, dy, dz, a] of dirs) s += a * Math.max(0, x * dx + y * dy + z * dz) ** 4;
    if (y < -0.2) s *= 1 - (-0.2 - y) * 0.35;
    pos.setXYZ(i, x * R * s, y * R * s * sy, z * R * s);
  }
  g.computeVertexNormals();
  return g;
}
/** Foliage mass at (cx, cy, cz) (its bottom), radius rad, gradient over [gy0, gy1]. */
function blobs(v: Vary, n: number, cx: number, cy: number, cz: number, rad: number, spread: number, lift: number, gy0: number, gy1: number): Part[] {
  const R = rad + spread * 0.6;
  return [part(at(lumpy(v, R, 0.82, n + 1), cx, cy + R * 0.7 + lift * 0.3, cz), 'body', { mat: 'foliage', grad: G(gy0, gy1) })];
}
/** Extruded leaf: lanceolate or monstera (notched slits + holes), 4 mm thick so both faces read. */
function leafGeo(len: number, wid: number, notched: boolean, v: Vary) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(wid * 0.9, len * 0.12, wid * 0.75, len * 0.8, 0, len);
  s.bezierCurveTo(-wid * 0.75, len * 0.8, -wid * 0.9, len * 0.12, 0, 0);
  const far = detail() < 1; // [ENV fix m2 r1] far LOD: plain leaf outline, no slits
  if (notched && !far) {
    for (const [y, x, r] of [[0.45, 0.28, 0.07], [0.62, -0.27, 0.06], [0.33, -0.3, 0.06]]) {
      const h = new THREE.Path(); h.absellipse(x * wid, y * len, r * wid * 1.4, r * len * 0.5, 0, PI * 2, false, 0.4); s.holes.push(h);
    }
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: false, curveSegments: far ? 2 : 3 });
  g.translate(0, 0, -0.002);
  // gentle cup + droop along the leaf
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i); pos.setZ(i, pos.getZ(i) + (x / wid) ** 2 * wid * 0.25 - (y / len) ** 2 * len * 0.18); }
  g.computeVertexNormals();
  return g;
}
/** A bent strap leaf (fern frond, grass) along +z, drooping. */
function strap(len: number, wid: number, droop: number, seg = 6) {
  if (detail() < 1) seg = 3; // [ENV fix m2 r1] far LOD
  const g = new THREE.BoxGeometry(wid, 0.006, len, 1, 1, seg).translate(0, 0, len / 2);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getZ(i) / len;
    pos.setX(i, pos.getX(i) * Math.sin(Math.min(1, t * 1.15) * PI * 0.92 + 0.12));
    pos.setY(i, pos.getY(i) + Math.sin(t * PI * 0.55) * len * 0.25 - t * t * droop);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * 11 · plant: kind ∈ bush | monstera | fern | cactus | pothos | tree | succulent; `h` total height (m).
 */
export function buildPlant(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), kind = p.kind ?? 'bush', H = v.s(p.h ?? 1.0, 0.08);
  const colors: Colors = { body: v.pick([T.oat, T.teal, T.trim]), accent: v.pick([T.tealDeep, T.walnut, T.oat]) };
  if (colors.body === colors.accent) colors.accent = T.tealDeep;
  let parts: Part[] = [], hero = '', fp = 0.3;
  switch (kind) {
    case 'succulent': {
      const pt = pot(0.05, 0.06, 0.07, { saucer: false });
      parts.push(...pt.parts);
      for (let i = 0; i < 9; i++) {
        const a = i * 2.4, r = i < 3 ? 0.012 : 0.03, tilt = i < 3 ? 0.3 : 0.9;
        parts.push(part(at(capsule(0.012, 0.035, 2, 6), Math.cos(a) * r, pt.top + 0.02, Math.sin(a) * r, Math.sin(a) * tilt, 0, -Math.cos(a) * tilt), 'body', { mat: 'foliage', grad: G(pt.top, pt.top + 0.06, T.moss, T.sage) }));
      }
      return { parts, footprint: { r: 0.07 }, solid: false, anchors: {}, colors, small: true, hero: 'rosette' };
    }
    case 'cactus': {
      const pt = pot(0.11, 0.13, 0.18);
      parts.push(...pt.parts);
      const h = H - pt.top - 0.1;
      parts.push(part(at(capsule(0.075, h, 4, 10), 0, pt.top + h / 2 + 0.075, 0), 'body', { mat: 'foliage', grad: G(pt.top, H, T.moss, T.sage) }));
      for (const e of [-1, 1]) {
        const y = pt.top + h * v.r(0.35, 0.6), L = h * 0.35;
        parts.push(part(at(capsule(0.05, 0.08, 3, 8), e * 0.1, y, 0, 0, 0, e * PI / 2), 'body', { mat: 'foliage', grad: G(pt.top, H, T.moss, T.sage) }));
        parts.push(part(at(capsule(0.05, L, 3, 8), e * 0.16, y + L / 2 + 0.02, 0), 'body', { mat: 'foliage', grad: G(pt.top, H, T.moss, T.sage) }));
      }
      parts.push(part(at(sphere(0.035, 8, 6), 0.02, pt.top + h + 0.14, 0), 'accent', { color: T.rose, cast: false })); // flower
      hero = 'arms + a pink flower'; fp = 0.2;
      break;
    }
    case 'monstera': {
      const pt = pot(0.14, 0.18, 0.28);
      parts.push(...pt.parts);
      const n = 7;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * PI * 2 + v.r(-0.25, 0.25), L = (H - pt.top) * v.r(0.3, 0.6), out = v.r(0.1, 0.22);
        const tipX = Math.sin(a) * out, tipZ = Math.cos(a) * out, tipY = pt.top + L;
        parts.push(part(tube([[0, pt.top, 0], [tipX * 0.4, pt.top + L * 0.6, tipZ * 0.4], [tipX, tipY, tipZ]], 0.008, 4, 3), 'body', { mat: 'foliage', grad: G(pt.top, H) }));
        const lg = leafGeo(v.r(0.34, 0.44) * H / 1.2, v.r(0.28, 0.34) * H / 1.2, true, v);
        at(lg, tipX, tipY, tipZ, PI / 2 - v.r(0.35, 0.75), a, v.r(-0.2, 0.2));
        parts.push(part(lg, 'body', { mat: 'foliage', grad: G(pt.top, H) }));
      }
      hero = 'notched split leaves'; fp = 0.35;
      break;
    }
    case 'fern': {
      const pt = pot(0.13, 0.16, 0.26);
      parts.push(...pt.parts);
      const n = 12;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * PI * 2 + v.r(-0.2, 0.2), L = (H - pt.top + 0.25) * v.r(0.6, 0.9), up = v.r(-1.0, -0.55);
        const g = strap(L, 0.07, L * 0.45, 6);
        at(g, 0, pt.top, 0, up, a, 0);
        parts.push(part(g, 'body', { mat: 'foliage', grad: G(pt.top - 0.2, H, T.leafDark, T.sage) }));
      }
      hero = 'arching fronds'; fp = 0.4;
      break;
    }
    case 'pothos': { // hanging: hook + cords + pot at y 0 (item hangs from `drop` above), trailing vines
      const drop = p.drop ?? 0.6;
      const pt = pot(0.1, 0.13, 0.16, { saucer: false });
      parts.push(...pt.parts);
      for (let i = 0; i < 3; i++) { const a = (i / 3) * PI * 2; parts.push(part(tube([[Math.sin(a) * 0.12, pt.top, Math.cos(a) * 0.12], [0, pt.top + drop, 0]], 0.003, 2, 3), 'secondary', { color: T.ink2, cast: false })); }
      parts.push(part(at(sphere(0.016, 6, 4), 0, pt.top + drop, 0), 'secondary', { color: T.brass }));
      parts.push(...blobs(v, 4, 0, pt.top + 0.02, 0, 0.09, 0.08, 0.05, pt.top - 0.4, pt.top + 0.2));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * PI * 2 + v.r(-0.3, 0.3), L = v.r(0.35, 0.8);
        const pts = []; for (let k = 0; k <= 4; k++) { const t = k / 4; pts.push([Math.sin(a) * (0.12 + t * 0.1), pt.top + 0.02 - t * L, Math.cos(a) * (0.12 + t * 0.1) + Math.sin(t * 5 + i) * 0.03]); }
        parts.push(part(tube(pts, 0.004, 8, 3), 'body', { mat: 'foliage', grad: G(pt.top - 0.8, pt.top) }));
        for (let k = 1; k <= 5; k++) {
          const t = k / 5.5, q = pts[Math.min(3, Math.floor(t * 4))];
          parts.push(part(at(sphere(0.035, 5, 3), q[0] + v.r(-0.02, 0.02), q[1] - (t % 0.25) * 0.2, q[2], v.r(-0.5, 0.5), v.r(0, PI), 0, 1, 0.3, 0.75), 'body', { mat: 'foliage', grad: G(pt.top - 0.8, pt.top) }));
        }
      }
      return { parts, footprint: { r: 0.25 }, solid: false, anchors: { hook: pt.top + drop }, colors, hero: 'trailing vines' };
    }
    case 'tree': { // tree in a tub
      const tub = [part(at(rbox(0.5, 0.36, 0.5, 0.04, 2), 0, 0.2, 0), 'body', { mat: 'wood' }), part(at(rbox(0.54, 0.05, 0.54, 0.02), 0, 0.39, 0), 'accent', { mat: 'wood' }), part(at(cyl(0.2, 0.2, 0.01, 12), 0, 0.41, 0), 'body', { ao: 0.45, cast: false })];
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) tub.push(part(at(rbox(0.07, 0.06, 0.07, 0.015), sx * 0.2, 0.02, sz * 0.2), 'accent'));
      parts.push(...tub);
      // [ENV fix r1] a clustered crown, not a lollipop: a trunk that forks into 3–4 branches, each ending in its own
      // lumpy canopy blob (a big central one on top), so the tree has a layered, cloud-like silhouette
      const top = H * 0.62, S = H / 2.2;
      const trunk = [[0, 0.4, 0], [0.03, top * 0.45, 0.01], [-0.01, top * 0.8, -0.02], [0, top, 0]];
      parts.push(part(tube(trunk, 0.04 * S, 8, 8), 'secondary', { color: T.walnut }));
      parts.push(part(at(lathe([[0.075 * S, 0], [0.045 * S, 0.06], [0.04 * S, 0.1]], 10), 0, 0.4, 0), 'secondary', { color: T.walnut })); // root flare
      const nb = 3 + v.int(2), a0 = v.r(0, PI * 2);
      const crowns = [[0, H - 0.34 * S, 0, 0.3 * S]];
      for (let i = 0; i < nb; i++) {
        const a = a0 + (i / nb) * PI * 2 + v.r(-0.3, 0.3), out = v.r(0.26, 0.36) * S, y = top + v.r(0.02, 0.28) * S;
        const tip = [Math.sin(a) * out, y + 0.1 * S, Math.cos(a) * out];
        parts.push(part(tube([[0, top - 0.12 * S * (i % 2), 0], [tip[0] * 0.55, y - 0.02, tip[2] * 0.55], tip], 0.02 * S, 6, 6), 'secondary', { color: T.walnut }));
        crowns.push([tip[0], tip[1] - 0.08 * S, tip[2], v.r(0.2, 0.25) * S]);
      }
      for (const [x, y, z, r] of crowns) parts.push(part(at(lumpy(v, r, 0.8, 5, 0.28, 14), x, y + r * 0.6, z), 'body', { mat: 'foliage', grad: G(top - 0.1, H) }));
      colors.body = T.oak; colors.accent = T.walnut;
      hero = 'forked trunk + clustered crown in a footed tub'; fp = 0.3;
      break;
    }
    default: { // bush, optionally flowering
      const pt = pot(0.14, 0.17, 0.26);
      parts.push(...pt.parts);
      const s = (H - pt.top) / 0.75;
      parts.push(...blobs(v, 6, 0, pt.top - 0.02, 0, 0.17 * s, 0.14 * s, 0.34 * s, pt.top, H));
      if (p.flowers ?? v.chance(0.4)) {
        const fc = v.pick(FLOWERS);
        for (let i = 0; i < 6; i++) { const a = i * 1.1 + v.r(0, 0.5), r = 0.18 * s; parts.push(part(at(sphere(0.03, 7, 5), Math.cos(a) * r, pt.top + 0.2 * s + v.r(0, 0.35 * s), Math.sin(a) * r), 'accent', { color: fc, cast: false })); }
      }
      hero = 'blob canopy (+ flowers)'; fp = 0.3;
    }
  }
  // `collider`: what a walker bumps into (the pot / tub), not the foliage spread ([ENV fix r1] nav obstacles)
  const potR = { cactus: 0.16, monstera: 0.2, fern: 0.19, tree: 0.3 }[kind] ?? 0.19;
  return { parts, footprint: { r: fp }, collider: { r: potR }, solid: kind === 'tree' || H > 0.8, anchors: {}, colors, hero };
}

/** 29 · planter (rope line / street): rounded trough, cream rim, foliage spilling over the lip. */
export function buildPlanter(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 1.0, h = p.h ?? 0.45, d = p.d ?? 0.4;
  const parts = [
    part(at(rbox(w, h - 0.04, d, 0.04, 2), 0, (h - 0.04) / 2, 0), 'body'),
    part(at(rbox(w + 0.04, 0.05, d + 0.04, 0.02), 0, h - 0.025, 0), 'accent'),
    part(at(rbox(w - 0.06, 0.02, d - 0.06, 0.01), 0, h - 0.04, 0), 'body', { ao: 0.4, cast: false }),
  ];
  const n = Math.max(2, Math.round(w / 0.28));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (i + 0.5) * (w / n);
    parts.push(part(at(sphere(v.r(0.13, 0.17), 11, 8), x, h + 0.06, v.r(-0.05, 0.05), 0, 0, 0, 1.1, 0.8, 1.05), 'body', { mat: 'foliage', grad: G(h - 0.1, h + 0.35) }));
    if (v.chance(0.6)) parts.push(part(at(sphere(0.07, 8, 6), x + v.r(-0.08, 0.08), h - 0.02, (v.chance(0.5) ? 1 : -1) * (d / 2 + 0.02), 0, 0, 0, 1, 1.3, 0.7), 'body', { mat: 'foliage', grad: G(h - 0.3, h + 0.3) })); // spill over the lip
  }
  for (let i = 0; i < 4; i++) parts.push(part(at(sphere(0.028, 6, 5), v.r(-w / 2 + 0.1, w / 2 - 0.1), h + 0.2, v.r(-0.08, 0.08)), 'accent', { color: v.pick(FLOWERS), cast: false }));
  return { parts, footprint: { w, d }, solid: true, anchors: {}, colors: { body: v.pick([T.teal, T.oat]), accent: T.trim }, hero: 'overflowing foliage lip' };
}
