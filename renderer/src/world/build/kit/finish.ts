/**
 * Prop kit, [ENV fix m2 r3] finishing pass (review m2 r3): the south façade's clay "CLAUDE HQ" sign and window boxes,
 * the Mailroom's east wall (parcel conveyor, pneumatic-tube run, stamp board, sack cart), the Library's book bridge
 * over the arches and its wall clock, and the west garden's rolling hills. §7.5 contract: bevelled / blobby, ≤ 3
 * palette tokens per prop via body / secondary / accent (stamps, letters and parcels are literal-colour groups like
 * book spines), one hero detail each, seeded variation. Front = +z, y = floor (wall props: origin = wall face).
 * Owner: ENV.
 */
import * as THREE from 'three';
import { rbox, cyl, sphere, capsule, torus, tube, slab, disc, lathe, at, between, part, vary, withDetail } from './core.ts';
import type { KitParams, Part, PartOpts, Pt, Rng, SheetEntry, SlotName, V3, Vary } from './core.ts';
import { T, SPINES, FLOWERS } from './tokens.ts';

const PI = Math.PI;
const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
const rod = (r: number, a: Pt, b: Pt, seg = 8) => between(cyl(r, r, dist(a, b), seg), a, b);
/** Brand clay (the sign letters: the one place the façade says Claude). */
const CLAY = '#D97757';
/** Stamp / parcel-label literal colours (muted jewels + papers, never a status colour). */
const STAMPS = Object.freeze(['#B35F55', '#4B6F8C', '#6B8A5A', T.butter, '#8A6F9E', '#2F5E62', T.rose, '#C79A6B']);

// ------------------------------------------------------------------------------------------------ the sign
/** Stroke font (x 0…~0.8, y 0…1): each glyph = polylines (capsule rods) + arcs [cx, cy, rx, ry, a0, a1] (tubes). */
interface Glyph { w: number; lines?: [number, number][][]; arcs?: [number, number, number, number, number, number][] }
const GLYPHS: Record<string, Glyph> = {
  C: { w: 0.7, arcs: [[0.37, 0.5, 0.35, 0.5, 0.75, 2 * PI - 0.75]] },
  L: { w: 0.58, lines: [[[0.08, 1], [0.08, 0], [0.56, 0]]] },
  A: { w: 0.76, lines: [[[0.02, 0], [0.38, 1], [0.74, 0]], [[0.18, 0.36], [0.58, 0.36]]] },
  U: { w: 0.7, lines: [[[0.07, 1], [0.07, 0.36]], [[0.63, 1], [0.63, 0.36]]], arcs: [[0.35, 0.36, 0.28, 0.34, PI, 2 * PI]] },
  D: { w: 0.72, lines: [[[0.08, 0], [0.08, 1]], [[0.08, 1], [0.3, 1]], [[0.08, 0], [0.3, 0]]], arcs: [[0.3, 0.5, 0.36, 0.5, -PI / 2, PI / 2]] },
  E: { w: 0.62, lines: [[[0.6, 1], [0.08, 1], [0.08, 0], [0.6, 0]], [[0.08, 0.52], [0.5, 0.52]]] },
  H: { w: 0.72, lines: [[[0.08, 0], [0.08, 1]], [[0.64, 0], [0.64, 1]], [[0.08, 0.52], [0.64, 0.52]]] },
  Q: { w: 0.8, lines: [[[0.46, 0.26], [0.8, -0.06]]], arcs: [[0.39, 0.5, 0.37, 0.5, 0, 2 * PI]] },
  // [ENV M3.5] for the Lobby ARRIVALS sign
  R: { w: 0.66, lines: [[[0.08, 0], [0.08, 1], [0.34, 1]], [[0.08, 0.5], [0.34, 0.5]], [[0.36, 0.5], [0.64, 0]]], arcs: [[0.34, 0.75, 0.26, 0.25, -PI / 2, PI / 2]] },
  I: { w: 0.18, lines: [[[0.09, 0], [0.09, 1]]] },
  V: { w: 0.74, lines: [[[0.02, 1], [0.37, 0], [0.72, 1]]] },
  S: { w: 0.66, arcs: [[0.33, 0.75, 0.28, 0.25, 0.35, 1.5 * PI], [0.33, 0.25, 0.28, 0.25, PI / 2, -PI + 0.35]] },
};
/**
 * Clay block letters of `text` (height `h`, stroke radius `r`, squashed to `depth`), laid out centred on x = 0,
 * baseline y 0, front face at z 0 → parts in the `accent` slot. Rods are capsules (round clay ends and joints),
 * arcs are tubes; each letter leans by a seeded ±3° so the word looks hand-pressed.
 */
function letters(text: string, h: number, r: number, depth: number, v: Vary, slot: SlotName = 'accent'): Part[] {
  const out: Part[] = [], gap = 0.16 * h;
  const width = [...text].reduce((s, ch) => s + (ch === ' ' ? 0.34 * h : (GLYPHS[ch]?.w ?? 0.6) * h + gap), -gap);
  let x0 = -width / 2;
  const sz = depth / (2 * r);
  for (const ch of text) {
    if (ch === ' ') { x0 += 0.34 * h; continue; }
    const g = GLYPHS[ch];
    if (!g) { x0 += 0.6 * h + gap; continue; }
    const tilt = v.r(-0.05, 0.05), bob = v.r(-0.012, 0.012) * h, cx = x0 + (g.w * h) / 2;
    const P = ([x, y]: readonly number[]): V3 => { const lx = (x - g.w / 2) * h, ly = y * h - h / 2; return [cx + lx * Math.cos(tilt) - ly * Math.sin(tilt), h / 2 + bob + lx * Math.sin(tilt) + ly * Math.cos(tilt), 0]; };
    const squash = <G extends THREE.BufferGeometry>(geo: G) => { geo.scale(1, 1, sz); return geo; };
    for (const line of g.lines ?? []) for (let i = 0; i < line.length - 1; i++) {
      const a = P(line[i]), b = P(line[i + 1]), L = dist(a, b);
      out.push(part(squash(between(capsule(r, L, 2, 8), a, b).translate(0, 0, 0)).translate(0, 0, -depth / 2), slot));
    }
    for (const [ax, ay, rx, ry, a0, a1] of g.arcs ?? []) {
      const n = Math.max(6, Math.round(Math.abs(a1 - a0) * 5)), pts: V3[] = [];
      for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push(P([ax + Math.cos(a) * rx, ay + Math.sin(a) * ry])); }
      out.push(part(squash(tube(pts, r, n * 2, 8)).translate(0, 0, -depth / 2), slot));
      if (Math.abs(a1 - a0) < 2 * PI - 0.01) for (const q of [pts[0], pts[pts.length - 1]]) out.push(part(squash(at(sphere(r, 10, 8), ...q)).translate(0, 0, -depth / 2), slot));
    }
    x0 += g.w * h + gap;
  }
  return out;
}

/**
 * hqSign: the "CLAUDE HQ" name board over the entrance: a deep-teal board with a rounded cream bead frame, chunky
 * clay block letters pressed onto it (hand-set, each a little off-true), a brass rosette at each end.
 * Origin = wall face, board centre.
 */
export function buildHqSign(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 3.0, h = p.h ?? 0.46, text = p.text ?? 'CLAUDE HQ';
  const parts = [part(at(rbox(w, h, 0.05, 0.02, 2), 0, 0, 0.025), 'body', { ao: 0.95 })];
  // cream bead frame (rounded bars) inset 3 cm
  const fw = w - 0.07, fh = h - 0.07;
  for (const e of [-1, 1]) {
    parts.push(part(at(capsule(0.013, fw - 0.03, 2, 6), 0, e * fh / 2, 0.052, 0, 0, PI / 2), 'secondary', { cast: false }));
    parts.push(part(at(capsule(0.013, fh - 0.03, 2, 6), e * fw / 2, 0, 0.052), 'secondary', { cast: false }));
    parts.push(part(at(sphere(0.035, 12, 8), e * (w / 2 - 0.13), 0, 0.06, 0, 0, 0, 1, 1, 0.5), 'secondary', { color: T.brass }));
  }
  const lh = h * 0.56;
  // the letters ride the `shade` class: clay by day, a warm self-lit marquee after dark (review m2 r3: the façade was
  // one tone at 22 h)
  for (const q of letters(text, lh, lh * 0.1, 0.05, v)) { q.geometry.translate(0, -lh / 2, 0.075); q.mat = 'shade'; q.cast = false; parts.push(q); }
  return { parts, footprint: { w, d: 0.1 }, solid: false, anchors: {}, colors: { body: T.tealDeep, secondary: T.trim, accent: CLAY }, hero: 'hand-pressed clay block letters' };
}

/**
 * windowBox: a painted planter under a window sill (hung on two iron brackets): a rolled rim, a moss soil line,
 * clumped foliage, trailing ivy strands and flower dots. Origin = wall face, box top.
 */
export function buildWindowBox(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 1.6, d = 0.22, h = 0.2;
  const parts = [part(at(rbox(w, h, d, 0.03, 2), 0, -h / 2, d / 2 + 0.01), 'secondary', { ao: 0.92 })];
  parts.push(part(at(rbox(w + 0.04, 0.035, d + 0.04, 0.015), 0, -0.012, d / 2 + 0.01), 'secondary', { color: T.trim })); // rim
  for (const e of [-1, 1]) parts.push(part(at(rbox(0.03, 0.03, d, 0.008), e * (w / 2 - 0.15), -h - 0.02, d / 2), 'accent')); // brackets
  const n = Math.max(3, Math.round(w / 0.22));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + 0.1 + (i / (n - 1)) * (w - 0.2);
    parts.push(part(at(sphere(v.r(0.08, 0.12), 8, 5), // [ENV fix m3 r1] 10 × 7 → 8 × 5 (§5.3 tris: 3.5k per box)
       x + v.r(-0.03, 0.03), v.r(0.03, 0.07), d / 2 + v.r(-0.03, 0.03), 0, 0, 0, 1.2, 0.8, 1), 'body', { mat: 'foliage', grad: [T.leafDark, T.leafLight, -0.05, 0.15] }));
    if (v.chance(0.6)) { // a trailing ivy strand over the front
      const x1 = x + v.r(-0.06, 0.06), len = v.r(0.18, 0.36);
      parts.push(part(tube([[x, 0.0, d + 0.02], [x1, -0.06, d + 0.05], [x1 + v.r(-0.04, 0.04), -len, d + 0.04]], 0.012, 6, 5), 'body', { mat: 'foliage', grad: [T.leafDark, T.leaf, -0.4, 0], cast: false }));
    }
  }
  for (let i = 0; i < Math.round(w * 6); i++) parts.push(part(at(sphere(0.024, 6, 4), v.r(-w / 2 + 0.06, w / 2 - 0.06), v.r(0.06, 0.14), d / 2 + v.r(-0.06, 0.1)), 'accent', { color: v.pick(FLOWERS), cast: false }));
  return { parts, footprint: { w, d }, solid: false, anchors: {}, colors: { body: T.leaf, secondary: '#5E7F7A', accent: T.ink2 }, hero: 'trailing ivy + flower dots' };
}

// ------------------------------------------------------------------------------------------------ Mailroom
/**
 * conveyor: a roller parcel conveyor (legs, side rails, a row of steel rollers) carrying a few kraft parcels with
 * labels toward the OUTBOX, a red stop button box. Runs along local x (length `len`).
 */
export function buildConveyor(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), len = p.len ?? 2.2, w = 0.5, h = p.h ?? 0.72;
  const parts: Part[] = [];
  for (const e of [-1, 1]) {
    parts.push(part(at(rbox(len, 0.1, 0.035, 0.012), 0, h - 0.02, e * (w / 2)), 'body'));
    for (const x of [-len / 2 + 0.12, 0, len / 2 - 0.12]) parts.push(part(at(rbox(0.04, h - 0.06, 0.04, 0.01), x, (h - 0.06) / 2, e * (w / 2 - 0.02)), 'body'));
  }
  for (const x of [-len / 2 + 0.12, 0, len / 2 - 0.12]) parts.push(part(at(rbox(0.035, 0.035, w - 0.04, 0.01), x, 0.14, 0), 'body', { cast: false })); // cross braces
  const nR = Math.round(len / 0.1);
  for (let i = 0; i < nR; i++) parts.push(part(at(cyl(0.022, 0.022, w - 0.06, 8), -len / 2 + (i + 0.5) * (len / nR), h - 0.03, 0, PI / 2), 'secondary', { cast: false }));
  // parcels riding it
  let x = -len / 2 + 0.2;
  while (x < len / 2 - 0.3) {
    const pw = v.r(0.22, 0.38), ph = v.r(0.12, 0.26), pd = v.r(0.2, 0.34), ry = v.r(-0.2, 0.2);
    parts.push(part(at(rbox(pw, ph, pd, 0.012), x + pw / 2, h + ph / 2 - 0.005, v.r(-0.04, 0.04), 0, ry), 'accent', { color: T.kraft }));
    parts.push(part(at(rbox(pw * 0.42, 0.004, pd * 0.4, 0.001), x + pw / 2, h + ph, 0, 0, ry), 'accent', { color: v.pick([T.trim, T.trim, T.butter]), cast: false }));
    parts.push(part(at(rbox(0.012, ph + 0.004, pd + 0.004, 0.001), x + pw / 2, h + ph / 2 - 0.004, 0, 0, ry), 'accent', { color: '#8C6E52', cast: false, mat: 'small' })); // string
    x += pw + v.r(0.2, 0.45);
  }
  parts.push(part(at(rbox(0.12, 0.14, 0.08, 0.02), len / 2 - 0.1, h + 0.07, w / 2 + 0.05), 'accent', { color: T.butter }));
  parts.push(part(at(cyl(0.028, 0.028, 0.02, 12), len / 2 - 0.1, h + 0.1, w / 2 + 0.1, PI / 2), 'accent', { color: '#B35F55', cast: false }));
  return { parts, footprint: { w: len, d: w }, solid: true, anchors: {}, colors: { body: '#6E8A89', secondary: T.steelOat, accent: T.kraft }, hero: 'steel rollers + parcels in transit' };
}

/**
 * tubeRun: a pneumatic-tube run along a wall (local x, length `len`): two glass-ish tubes on brass saddle brackets,
 * flanged couplings, one capsule caught mid-flight, and a drop elbow down to a receiver at `dropX`.
 * Origin = wall face at the tube centre height.
 */
export function buildTubeRun(p: KitParams = {}, rng: Rng) {
  const len = p.len ?? 4, dropX = p.dropX ?? len / 2 - 0.3, drop = p.drop ?? 0.9, parts: Part[] = [];
  for (const [dy, r] of [[0, 0.055], [-0.16, 0.045]]) {
    parts.push(part(at(cyl(r, r, len, 14), 0, dy, 0.1, 0, 0, PI / 2), 'body'));
    const nC = Math.max(2, Math.round(len / 0.9));
    for (let i = 0; i <= nC; i++) parts.push(part(at(torus(r + 0.004, 0.009, 4, 14), -len / 2 + (len * i) / nC, dy, 0.1, 0, PI / 2), 'accent', { cast: false }));
  }
  const nB = Math.max(2, Math.round(len / 1.1));
  for (let i = 0; i <= nB; i++) { const x = -len / 2 + 0.1 + ((len - 0.2) * i) / nB; parts.push(part(at(rbox(0.04, 0.3, 0.1, 0.01), x, -0.08, 0.05), 'accent')); }
  // the drop: an elbow down to a receiver cup
  parts.push(part(tube([[dropX, 0, 0.1], [dropX + 0.05, -0.02, 0.1], [dropX + 0.1, -0.15, 0.1], [dropX + 0.1, -drop, 0.1]], 0.055, 10, 12), 'body'));
  parts.push(part(at(cyl(0.085, 0.07, 0.14, 14), dropX + 0.1, -drop - 0.06, 0.1), 'accent'));
  parts.push(part(at(capsule(0.04, 0.12, 2, 10), -len * 0.15, 0, 0.1, 0, 0, PI / 2), 'secondary', { cast: false }));
  return { parts, footprint: { w: len, d: 0.16 }, solid: false, anchors: {}, colors: { body: '#BFD0D2', secondary: T.butter, accent: T.brass }, hero: 'capsule caught mid-flight' };
}

/**
 * stampBoard: a postage-rate board: a walnut-framed cream board ruled into a grid of oversized stamps (perforated
 * scallop edges, a coloured field with a tiny emblem) and a brass rate rail with two hanging rubber stamps.
 * Origin = wall face, board bottom centre.
 */
export function buildStampBoard(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 1.3, h = p.h ?? 0.78;
  const parts = [part(at(rbox(w, h, 0.035, 0.015), 0, h / 2, 0.018), 'secondary', { mat: 'wood' }), part(at(rbox(w - 0.07, h - 0.07, 0.008, 0.003), 0, h / 2, 0.038), 'body', { cast: false })];
  const cols = Math.max(3, Math.round((w - 0.12) / 0.17)), rows = 3, sw = 0.12, sh = 0.15;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = -w / 2 + 0.08 + (c + 0.5) * ((w - 0.16) / cols) + v.r(-0.008, 0.008), y = 0.2 + r * ((h - 0.25) / rows) + v.r(-0.006, 0.006) + 0.03;
    const col = v.pick(STAMPS), rz = v.r(-0.06, 0.06);
    parts.push(part(at(rbox(sw, sh, 0.004, 0.001), x, y, 0.044, 0, 0, rz), 'body', { color: T.trim, cast: false }));
    parts.push(part(at(rbox(sw * 0.72, sh * 0.62, 0.003, 0.001), x, y + 0.01, 0.047, 0, 0, rz), 'accent', { color: col, cast: false }));
    parts.push(part(at(rbox(0.03, 0.03, 0.003, 0.001), x, y + 0.02, 0.049, 0, 0, rz + PI / 4), 'accent', { color: T.trim, cast: false, mat: 'small' }));
  }
  parts.push(part(at(cyl(0.01, 0.01, w - 0.1, 8), 0, 0.12, 0.07, 0, 0, PI / 2), 'accent')); // rate rail
  for (const x of [-0.25, 0.3]) {
    parts.push(part(at(cyl(0.02, 0.02, 0.07, 10), x, 0.07, 0.08), 'secondary', { mat: 'wood' }));
    parts.push(part(at(rbox(0.07, 0.025, 0.05, 0.006), x, 0.03, 0.08), 'accent', { color: T.ink2 }));
  }
  return { parts, footprint: { w, d: 0.1 }, solid: false, anchors: {}, colors: { body: T.linen, secondary: T.walnut, accent: T.brass }, hero: 'grid of oversized stamps' };
}

/**
 * sackCart: a canvas mail hamper on a steel frame with four castors: canvas sides with a stencil band, sacks and
 * bundles heaped over the rim, a push handle.
 */
export function buildSackCart(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 0.7, d = p.d ?? 0.5, h = 0.62;
  const parts: Part[] = [];
  parts.push(part(at(rbox(w, h - 0.12, d, 0.05, 2), 0, 0.12 + (h - 0.12) / 2, 0), 'body', { mat: 'fabric' })); // canvas tub
  parts.push(part(at(rbox(w + 0.04, 0.04, d + 0.04, 0.015), 0, h, 0), 'secondary')); // rim
  parts.push(part(at(rbox(w + 0.008, 0.07, d + 0.008, 0.01), 0, h - 0.18, 0), 'accent', { color: T.tealDeep, cast: false })); // stencil band
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    parts.push(part(at(cyl(0.012, 0.012, h - 0.06, 6), sx * (w / 2), 0.09 + (h - 0.06) / 2 - 0.03, sz * (d / 2)), 'secondary'));
    parts.push(part(at(cyl(0.035, 0.035, 0.025, 10), sx * (w / 2 - 0.05), 0.04, sz * (d / 2 - 0.05), 0, 0, PI / 2), 'secondary', { color: T.ink2 }));
  }
  parts.push(part(tube([[-w / 2, h, -d / 2 - 0.02], [-w / 2 - 0.02, h + 0.2, -d / 2 - 0.1], [w / 2 + 0.02, h + 0.2, -d / 2 - 0.1], [w / 2, h, -d / 2 - 0.02]], 0.014, 12, 6), 'secondary'));
  // heaped sacks (lumpy capsules) + a strapped bundle of letters
  for (let i = 0; i < 3; i++) {
    const x = -w / 4 + i * (w / 4) + v.r(-0.03, 0.03);
    parts.push(part(at(capsule(0.11, 0.14, 3, 10), x, h + 0.05 + v.r(0, 0.04), v.r(-0.08, 0.08), PI / 2 + v.r(-0.3, 0.3), v.r(0, PI), 0, 1, 0.8, 1), 'accent', { color: [T.linen, '#C9B99A', T.kraft][i] }));
  }
  parts.push(part(at(rbox(0.18, 0.1, 0.12, 0.012), w * 0.22, h + 0.2, 0.04, 0, 0.4), 'accent', { color: T.trim }));
  parts.push(part(at(rbox(0.19, 0.012, 0.02, 0.002), w * 0.22, h + 0.2, 0.04, 0, 0.4), 'accent', { color: '#B35F55', cast: false }));
  return { parts, footprint: { w: w + 0.05, d: d + 0.12 }, solid: true, anchors: {}, colors: { body: '#CFC2A6', secondary: '#6E8A89', accent: T.linen }, hero: 'heaped sacks + stencil band' };
}

// ------------------------------------------------------------------------------------------------ Library
/**
 * bookBridge: a shallow walnut book ledge spanning over an arch / between bookcases (length `w`, one row of books
 * with bookends and a leaning run), with a crown lip and a small corbel at each end. Origin = floor under its
 * centre at the wall face (+z = into the room); `y` = the ledge bottom.
 */
export function buildBookBridge(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 3.8, h = p.h ?? 0.3, d = p.d ?? 0.26, y = p.y ?? 2.3;
  const parts = [part(at(rbox(w, 0.035, d, 0.012), 0, y + 0.018, d / 2), 'body', { mat: 'wood' })];
  parts.push(part(at(rbox(w + 0.04, 0.035, d + 0.03, 0.012), 0, y + h - 0.018, d / 2 + 0.01), 'body', { mat: 'wood' })); // crown
  parts.push(part(at(rbox(w, h, 0.02, 0.006), 0, y + h / 2, 0.01), 'body', { mat: 'wood', ao: 0.62 })); // back
  parts.push(part(at(rbox(w, 0.05, 0.02, 0.008), 0, y - 0.01, d - 0.005), 'body', { mat: 'wood' })); // apron
  for (const e of [-1, 1]) parts.push(part(at(rbox(0.05, h, d, 0.012), e * (w / 2 - 0.025), y + h / 2, d / 2), 'body', { mat: 'wood' }));
  for (const e of [-1, 1]) parts.push(part(at(rbox(0.06, 0.14, d * 0.8, 0.015), e * (w / 2 - 0.05), y - 0.07, d * 0.4), 'body', { mat: 'wood' })); // corbels
  const nDiv = Math.max(1, Math.round(w / 1.2)), divs = [];
  for (let i = 1; i < nDiv; i++) { const dx = -w / 2 + (w * i) / nDiv; divs.push(dx); parts.push(part(at(rbox(0.03, h - 0.05, d - 0.02, 0.008), dx, y + h / 2, d / 2), 'body', { mat: 'wood' })); }
  const maxH = h - 0.09;
  let x = -w / 2 + 0.06;
  while (x < w / 2 - 0.08) {
    if (v.chance(0.06)) { x += v.r(0.1, 0.2); continue; }
    const tw = v.r(0.028, 0.05), bh = maxH * v.r(0.7, 1.0), bd = d * v.r(0.6, 0.78);
    const hit = divs.find((dx) => x < dx + 0.02 && x + tw > dx - 0.02);
    if (hit !== undefined) { x = hit + 0.022; continue; }
    if (x + tw > w / 2 - 0.05) break;
    parts.push(part(at(rbox(tw, bh, bd, 0.004), x + tw / 2, y + 0.035 + bh / 2, 0.04 + bd / 2), 'secondary', { color: v.pick(SPINES), ao: 0.95 }));
    x += tw + 0.003;
  }
  for (const q of parts) q.cast = false; // up under the mezzanine: the studio key threw its shadow as two blobs mid-room
  return { parts, footprint: { w, d }, solid: false, anchors: {}, colors: { body: T.walnutDark, secondary: T.trim, accent: T.brass }, hero: 'books over the arch' };
}

/**
 * wallClock: a round station clock: walnut case, cream face with 12 ticks (the quarter ticks longer), ink hands at
 * `hour`:`min`, a brass bezel and a hanging bracket. Origin = wall face, clock centre.
 */
export function buildWallClock(p: KitParams = {}, rng: Rng) {
  const r = p.r ?? 0.2, hr = p.hour ?? 10, mn = p.min ?? 9;
  const parts = [part(at(disc(r, 0.05, 32, 0.012), 0, 0, 0, PI / 2), 'secondary', { mat: 'wood' })];
  parts.push(part(at(torus(r - 0.005, 0.012, 6, 32), 0, 0, 0.05), 'accent'));
  parts.push(part(at(disc(r - 0.025, 0.006, 32, 0.002), 0, 0, 0.048, PI / 2), 'body', { cast: false }));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * 2 * PI, L = i % 3 ? 0.022 : 0.04, rr = r - 0.05 - L / 2;
    parts.push(part(at(rbox(0.012, L, 0.004, 0.001), Math.sin(a) * rr, Math.cos(a) * rr, 0.056, 0, 0, -a), 'accent', { color: T.ink, cast: false, mat: 'small' }));
  }
  const hand = (a: number, L: number, wd: number) => part(at(rbox(wd, L, 0.005, 0.002), Math.sin(a) * L * 0.4, Math.cos(a) * L * 0.4, 0.062, 0, 0, -a), 'accent', { color: T.ink, cast: false });
  parts.push(hand(((hr % 12) + mn / 60) / 12 * 2 * PI, r * 0.5, 0.018), hand((mn / 60) * 2 * PI, r * 0.78, 0.012));
  parts.push(part(at(sphere(0.012, 8, 6), 0, 0, 0.066), 'accent'));
  parts.push(part(at(rbox(0.06, 0.1, 0.03, 0.01), 0, r + 0.03, 0.015), 'accent'));
  return { parts, footprint: { w: 2 * r, d: 0.07 }, solid: false, anchors: {}, colors: { body: T.trim, secondary: T.walnut, accent: T.brass }, hero: 'station-clock face' };
}

// ------------------------------------------------------------------------------------------------ arrivals
/**
 * [ENV M3.5] arrivalsPad: the Lobby's hiring / arrivals crate spot (build/dress.ts HIRE_CRATE; BRN drops the
 * new-hire parcel crate here): a flush kraft floor inlay with a bound butter / ink chevron border (hazard-tape
 * rhythm, rounded corners) and a stencilled cream parcel in the middle (tape cross + a bow). Flat, non-blocking.
 */
export function buildArrivalsPad(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 1.0, d = p.d ?? 1.0, t = 0.006, bw = 0.075;
  const parts = [part(slab(w, d, t, 0.09, 0.003, 4), 'body', { ao: false, cast: false })];
  // chevron border: alternating blocks along each edge (mitred in the corners by the rounded inlay under them)
  const edges: [number, 'x' | 'z'][] = [[w, 'x'], [d, 'z']];
  for (const [len, axis] of edges) {
    const n = Math.max(4, Math.round((len - 0.2) / 0.11)), step = (len - 0.2) / n;
    for (let i = 0; i < n; i++) for (const e of [-1, 1]) {
      const c = -len / 2 + 0.1 + step * (i + 0.5), off = e * ((axis === 'x' ? d : w) / 2 - bw / 2 - 0.012);
      const g = rbox(step - 0.012, 0.003, bw, 0.0);
      const [x, z, ry] = axis === 'x' ? [c, off, 0] : [off, c, PI / 2];
      parts.push(part(at(g, x, t + 0.0015, z, 0, ry), (i % 2) ? 'accent' : 'secondary', { ao: false, cast: false }));
    }
  }
  // stencilled parcel: a cream rounded square, a tape cross and a two-loop bow
  const pw = Math.min(w, d) * 0.34;
  parts.push(part(at(slab(pw, pw, 0.003, 0.03, 0.001, 3), 0, t, 0, 0, v.r(-0.08, 0.08)), 'secondary', { color: T.trim, ao: false, cast: false }));
  for (const ry of [0, PI / 2]) parts.push(part(at(rbox(pw, 0.002, 0.035, 0), 0, t + 0.0035, 0, 0, ry), 'accent', { ao: false, cast: false }));
  for (const e of [-1, 1]) parts.push(part(at(torus(0.045, 0.012, 4, 12), e * 0.045, t + 0.006, -pw / 2 + 0.02, PI / 2, 0, 0, 1, 1, 0.3), 'accent', { cast: false }));
  return { parts, footprint: { w, d }, solid: false, anchors: { crate: [0, t, 0] }, colors: { body: '#B89A74', secondary: T.butter, accent: T.ink }, hero: 'hazard chevron border + stencilled parcel' };
}

/**
 * [ENV M3.5] arrivalsSign: a brass stanchion-post sign by the arrivals pad: weighted round base, a post, and a
 * deep-teal board with clay "ARRIVALS" letters and a cream bead frame, tilted a touch toward the viewer.
 */
export function buildArrivalsSign(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), text = p.text ?? 'ARRIVALS', H = p.h ?? 0.98, bw = 0.16 + text.length * 0.06, bh = 0.16;
  const parts = [part(lathe([[0, 0], [0.16, 0], [0.165, 0.015], [0.13, 0.035], [0.04, 0.05], [0.025, 0.07], [0, 0.07]], 20), 'secondary', { ao: 0.9 })];
  parts.push(part(at(cyl(0.018, 0.022, H - 0.07, 12), 0, 0.07 + (H - 0.07) / 2, 0), 'secondary'));
  const tilt = -0.12, by = H + bh / 2 - 0.02;
  const board = (g: THREE.BufferGeometry, slot: SlotName = 'body', o: PartOpts = {}) => part(at(g, 0, by, 0.03, tilt), slot, o);
  parts.push(board(rbox(bw, bh, 0.03, 0.012, 2)));
  for (const e of [-1, 1]) {
    parts.push(board(at(capsule(0.008, bw - 0.07, 2, 6), 0, e * (bh / 2 - 0.022), 0.017, 0, 0, PI / 2), 'secondary', { color: T.trim, cast: false }));
    parts.push(board(at(capsule(0.008, bh - 0.07, 2, 6), e * (bw / 2 - 0.022), 0, 0.017), 'secondary', { color: T.trim, cast: false }));
  }
  // (5-sided rods: the 9 cm letters are read at 3–8 m; full-detail strokes were 3.5k tris)
  for (const q of withDetail(0.5, () => letters(text, bh * 0.46, 0.0085, 0.012, v))) { q.geometry.translate(0, -bh * 0.23, 0.028); parts.push(board(q.geometry, 'accent', { color: CLAY, cast: false })); }
  parts.push(part(at(sphere(0.028, 10, 8), 0, H + bh + 0.01, 0.03), 'secondary'));
  return { parts, footprint: { r: 0.17 }, solid: true, anchors: {}, colors: { body: T.tealDeep, secondary: T.brass, accent: CLAY }, hero: 'clay ARRIVALS letters on a post board' };
}

// ------------------------------------------------------------------------------------------------ garden
/**
 * hill: a long soft grassy mound (a squashed lumpy half-ellipsoid, smooth normals: one clay mass) with a darker
 * foot and a sunlit crest (vertical gradient). `w` along x, `d` deep, `h` tall. y = ground.
 */
const hillBumps = (v: Vary) => { const b: [number, number, number][] = []; for (let i = 0; i < 5; i++) b.push([v.r(-0.8, 0.8), v.r(0.12, 0.3), v.r(0.2, 0.45)]); return b; };
const hillLift = (bumps: readonly (readonly number[])[], x: number, y: number) => { let s = 1; for (const [bx, a, wd] of bumps) s += a * Math.exp(-((x - bx) ** 2) / (wd * wd)) * y; return s; };
/**
 * [ENV fix m3 r1] Crest height of a `hill` (same params + the rng its placement seeds) at local x `lx` along its length:
 * the zone dresser stands cottages on the far ridge.
 */
export function hillCrest(p: KitParams, rng: Rng, lx: number): number {
  const w = p.w ?? 8, h = p.h ?? 1.5, x = Math.max(-1, Math.min(1, (2 * lx) / w)), y = Math.sqrt(1 - x * x);
  return y * h * hillLift(hillBumps(vary(rng)), x, y);
}
export function buildHill(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 8, d = p.d ?? 3, h = p.h ?? 1.5;
  // [ENV fix m3 r1] §5.3 tris: 40 × 14 (1.1k tris) → 28 × 9 (≈ 500): a hill is a 5–10 m mound seen from ≥ 3 m through a
  // window, smooth normals keep it one soft clay mass
  const g = new THREE.SphereGeometry(1, p.ws ?? 28, p.hs ?? 9, 0, 2 * PI, 0, PI / 2), pos = g.getAttribute('position');
  const bumps = hillBumps(v);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const s = hillLift(bumps, x, y);
    pos.setXYZ(i, x * w / 2, y * h * s, z * d / 2);
  }
  g.computeVertexNormals();
  const parts = [part(g, 'body', { mat: 'foliage', grad: [p.dark ?? T.leafDark, p.light ?? T.leafLight, 0, h * 1.2], ao: false, cast: false })];
  return { parts, footprint: { w, d }, solid: false, anchors: {}, colors: { body: T.leaf }, hero: 'rolling clay mound' };
}

/**
 * [ENV fix m3 r1] cottage: a tiny far-off farmhouse for the west hills' ridge (forced perspective: ≈ 0.5 m wide seen
 * 6–10 m away through a W-bay window reads as a house on the far hill). Cream walls, a gabled roof, a chimney and
 * 1–3 windows in the `shade` class (emissiveDay 0: pale butter panes by day, warm lit windows after dark), so the night
 * hills carry a few warm house-window dots. y = ground, front = +z.
 */
export function buildCottage(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 0.5, d = w * 0.6, h = p.h ?? w * 0.42;
  // walls / roof / chimney in the `foliage` class: the cottage merges into its hill group's one foliage mesh (no extra
  // draw; the sway is a function of world position, so it moves with the crest it stands on)
  const F: PartOpts = { mat: 'foliage', ao: false, cast: false };
  const parts = [part(at(new THREE.BoxGeometry(w, h, d), 0, h / 2, 0), 'body', F)];
  // gabled roof: a triangular prism along x (a 3-sided cylinder turned on its side), a touch of overhang
  const rh = h * 0.8, roof = new THREE.CylinderGeometry(1, 1, w * 1.08, 3, 1);
  roof.rotateZ(PI / 2).rotateX(-PI / 2); // apex up (y 1), eaves at y −0.5, z ±0.866
  roof.scale(1, rh / 1.5, (d * 0.62) / 0.866);
  parts.push(part(at(roof, 0, h + rh / 3, 0), 'secondary', F));
  parts.push(part(at(new THREE.BoxGeometry(w * 0.1, rh * 0.8, w * 0.1), w * v.r(0.18, 0.3), h + rh * 0.55, -d * 0.1), 'secondary', F));
  const n = p.windows ?? 1 + v.int(3);
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? v.r(-0.15, 0.15) * w : -w * 0.3 + (i / (n - 1)) * w * 0.6;
    parts.push(part(at(new THREE.PlaneGeometry(w * 0.14, h * 0.34), x, h * v.r(0.42, 0.55), d / 2 + 0.004), 'accent', { mat: 'shade', cast: false }));
  }
  return { parts, footprint: { w, d }, solid: false, anchors: {}, colors: { body: '#E8DCC4', secondary: typeof p.roof === 'string' ? p.roof : '#8C5A48', accent: '#FFD9A0' }, hero: 'lit windows after dark' };
}

export const FINISH_KIT = {
  hqSign: buildHqSign, windowBox: buildWindowBox, conveyor: buildConveyor, tubeRun: buildTubeRun, stampBoard: buildStampBoard,
  sackCart: buildSackCart, bookBridge: buildBookBridge, wallClock: buildWallClock, hill: buildHill, cottage: buildCottage, // [ENV fix m3 r1] cottage
  arrivalsPad: buildArrivalsPad, arrivalsSign: buildArrivalsSign, // [ENV M3.5] Lobby hiring-crate spot
};
export const FINISH_SIGNATURE = ['hqSign', 'arrivalsSign']; // [ENV M3.5] arrivalsSign: 2.4k (clay letters), signature budget
export const FINISH_SHEET: SheetEntry[] = [
  ['hqSign', {}, 'hqSign ★'], ['windowBox', {}, 'windowBox'], ['conveyor', {}, 'conveyor'], ['tubeRun', { len: 2.4 }, 'tubeRun'],
  ['stampBoard', {}, 'stampBoard'], ['sackCart', {}, 'sackCart'], ['bookBridge', { w: 2.2, y: 0 }, 'bookBridge'], ['wallClock', {}, 'wallClock'],
  ['hill', { w: 3, d: 1.5, h: 0.8 }, 'hill'], ['cottage', {}, 'cottage'], ['arrivalsPad', {}, 'arrivalsPad'], ['arrivalsSign', {}, 'arrivalsSign'],
];
