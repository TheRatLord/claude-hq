/**
 * Prop kit: furniture builders (§7.5 rows 1–10, + bench). Each returns an Item (kit/core.ts); front = +z, y = floor.
 * Owner: ENV.
 */
import * as THREE from 'three';
import { rbox, cyl, lathe, sphere, capsule, torus, slab, disc, at, leg, part, vary, detail } from './core.ts';
import type { DeskBack, KitParams, Part, Rng, V3 } from './core.ts';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'; // [ENV M3.5 tris] far shelf spines
import { T, SPINES } from './tokens.ts';

const PI = Math.PI;

/**
 * 1 · desk: top overhang, tapered legs with brass toe caps, a hung drawer unit with round knobs, a cable grommet.
 * `m` = side of the drawer unit (±1).
 */
export function buildDesk(p: KitParams = {}, rng: Rng) {
  const w = p.w ?? 1.1, d = p.d ?? 0.62, h = p.h ?? 0.55, m = p.m ?? 1, t = 0.045;
  const parts = [
    part(at(slab(w, d, t, 0.05, 0.014), 0, h - t, 0), 'body', { mat: 'wood' }),
    part(at(rbox(w - 0.2, 0.12, 0.02, 0.008), 0, h - t - 0.06, -d / 2 + 0.07), 'body', { mat: 'wood', ao: 0.8 }), // modesty panel
  ];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const x = sx * (w / 2 - 0.07), z = sz * (d / 2 - 0.07);
    parts.push(part(leg(x, z, 0.03, h - t, 0.022, 0.014, 8), 'secondary'));
    parts.push(part(at(cyl(0.017, 0.019, 0.03, 8), x, 0.015, z), 'accent')); // brass toe cap
  }
  if (p.drawers !== false) {
    const dx = m * (w / 2 - 0.25), dy = h - t - 0.12;
    parts.push(part(at(rbox(0.3, 0.2, d - 0.14, 0.02), dx, dy, 0.0), 'body', { mat: 'wood', ao: 0.92 }));
    for (const k of [0, 1]) {
      const y = dy + 0.048 - k * 0.096;
      parts.push(part(at(rbox(0.28, 0.085, 0.014, 0.006), dx, y, (d - 0.14) / 2 + 0.004), 'body', { mat: 'wood' }));
      parts.push(part(at(sphere(0.013, 8, 6), dx, y, (d - 0.14) / 2 + 0.018), 'accent', { cast: false }));
    }
  }
  parts.push(part(at(torus(0.028, 0.008, 4, 12), -m * 0.2, h + 0.001, -d / 2 + 0.1, PI / 2), 'secondary', { cast: false })); // grommet
  return { parts, footprint: { w, d }, solid: true, anchors: { top: h }, colors: { body: T.oak, secondary: T.ink2, accent: T.brass }, hero: 'tapered legs + toe caps, knobs, grommet' };
}

/**
 * 2 · deskChair (swivel): 5-star base on ball casters, gas post, piped seat, low reclined back (DESK.back).
 */
export function buildDeskChair(p: KitParams = {}, rng: Rng) {
  const bk: DeskBack = typeof p.back === 'object' ? p.back : { z: 0.245, t: 0.05, h: 0.13, recline: 0.12 };
  // [ENV fix r2] an upright office back on a visible spine (review: the r1 back hinged off the seat's rear edge, wider
  // than the seat, and from the 3/4 sheet view read as a folded-open lounger). Now: the panel floats 2 cm over the
  // seat on a dark L-shaped spine that runs from the seat mechanism back and up behind it; recline clamped to
  // 8.6–11.5° (LVL's DESK.back 6.9° + a touch, top away from the sitter so its gap only grows); ≤ 0.87 × the seat width.
  // Kept: DESK.back's z / thickness, so the seated body's ≈ 8 cm gap holds; the top ≤ seat + 0.26 so a seated
  // Clawd's head and shoulders still clear it from behind.
  const seatW = 0.44, seatTop = 0.34;
  const rec = Math.min(0.2, Math.max(0.15, bk.recline ?? 0.17));
  const top = Math.max(p.backTop ?? 0.48, 0.6), by0 = seatTop + 0.015, bh = top - by0;
  const parts: Part[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * PI * 2 + 0.3;
    const cx = Math.sin(a) * 0.11, cz = Math.cos(a) * 0.11;
    parts.push(part(at(rbox(0.036, 0.028, 0.2, 0.005), cx, 0.055, cz, -0.08, a), 'secondary')); // [ENV fix r1] perf: 3 cm legs, bevel invisible
    parts.push(part(at(sphere(0.024, 7, 5), Math.sin(a) * 0.2, 0.024, Math.cos(a) * 0.2), 'secondary', { ao: 0.9 }));
  }
  parts.push(part(at(cyl(0.035, 0.042, 0.05, 12), 0, 0.07, 0), 'secondary'));
  parts.push(part(at(cyl(0.017, 0.017, 0.18, 10), 0, 0.18, 0), 'secondary'));
  parts.push(part(at(rbox(0.2, 0.03, 0.22, 0.01), 0, 0.25, 0.0), 'secondary', { ao: 0.8 })); // tilt mechanism
  parts.push(part(at(rbox(seatW, 0.08, 0.42, 0.035, 2), 0, 0.3, -0.01), 'body', { mat: 'fabric' }));
  parts.push(part(at(rbox(seatW + 0.01, 0.014, 0.43, 0.03, 1), 0, 0.302, -0.01), 'accent', { cast: false })); // seat piping
  // back: a rounded cushion panel, a little wider at the top (a shield) and wrapped, reclined about its centre
  const bw = 0.34;
  const back = rbox(bw, bh, bk.t, 0.03, 2);
  const pos = back.getAttribute('position');
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i) / bh + 0.5; pos.setX(i, pos.getX(i) * (1 + 0.12 * y)); pos.setZ(i, pos.getZ(i) + Math.abs(pos.getX(i)) ** 2 * 0.3); }
  back.computeVertexNormals();
  const cy = by0 + bh / 2, sn = Math.sin(rec), cs = Math.cos(rec);
  parts.push(part(at(back, 0, cy, bk.z, rec), 'body', { mat: 'fabric' }));
  const pt = bh / 2 - 0.012; // back piping along the top edge
  parts.push(part(at(rbox(bw * 1.12 + 0.012, 0.012, bk.t + 0.008, 0.005), 0, cy + pt * cs, bk.z + pt * sn, rec), 'accent', { cast: false }));
  // spine: seat mechanism → back under the seat → up behind the panel (reclined with it), joined by a round elbow
  const rear = bk.z + bk.t / 2, py = 0.255, ptop = by0 + bh * 0.62, L = ptop - py, sy = (py + ptop) / 2;
  const sz = rear + 0.014 + (sy - cy) * sn; // post rides on the panel's rear face
  const ez = sz - (L / 2) * sn; // elbow = the post's foot
  parts.push(part(at(rbox(0.05, 0.03, ez - 0.03, 0.01), 0, py, (ez + 0.03) / 2), 'secondary'));
  parts.push(part(at(sphere(0.026, 10, 8), 0, py, ez), 'secondary'));
  parts.push(part(at(rbox(0.05, L, 0.03, 0.01), 0, sy, sz, rec), 'secondary'));
  return { parts, footprint: { r: 0.25 }, solid: false, anchors: { seat: seatTop }, colors: { body: T.fabricTeal, secondary: T.ink2, accent: T.butter }, hero: '5-star base, ball casters, spine-mounted shield back + piping', backRecline: rec, backWidth: bw * 1.12 };
}

/** 3 · stool (bar / lab): cushion seat, splayed legs, brass footring. */
export function buildStool(p: KitParams = {}, rng: Rng) {
  const h = p.h ?? 0.45, r = p.r ?? 0.17;
  const parts = [part(at(lathe([[0, 0], [r - 0.02, 0], [r, 0.02], [r, 0.04], [r - 0.03, 0.06], [0, 0.065]], 16), 0, h - 0.065, 0), 'body', { mat: 'wood' })];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * PI * 2;
    const x0 = Math.sin(a) * 0.08, z0 = Math.cos(a) * 0.08, x1 = Math.sin(a) * 0.15, z1 = Math.cos(a) * 0.15;
    const g = cyl(0.016, 0.012, 1, 6);
    parts.push(part(betweenLeg(g, [x0, h - 0.07, z0], [x1, 0.0, z1]), 'secondary'));
  }
  parts.push(part(at(torus(0.12, 0.009, 4, 18), 0, h * 0.35, 0, PI / 2), 'accent'));
  return { parts, footprint: { r: 0.18 }, solid: false, anchors: { seat: h }, colors: { body: T.oak, secondary: T.ink2, accent: T.brass }, hero: 'footring' };
}
function betweenLeg(g: THREE.BufferGeometry, a: V3, b: V3) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz);
  g.scale(1, len, 1);
  const ax = Math.atan2(Math.hypot(dx, dz), -dy);
  return at(g, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, ax, Math.atan2(dx, dz) + PI, 0);
}

/**
 * 4 · sofa: plinth on oak peg feet, tufted back cushions, piped roll arms, seat cushions (top 0.40, seats at ±w/4).
 */
export function buildSofa(p: KitParams = {}, rng: Rng) {
  const w = p.w ?? 1.8, d = p.d ?? 0.72, n = p.seats ?? 2, armW = 0.17;
  const parts: Part[] = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(part(at(lathe([[0.02, 0], [0.034, 0.07], [0.0, 0.07]], 8), sx * (w / 2 - 0.1), 0, sz * (d / 2 - 0.1)), 'secondary'));
  parts.push(part(at(rbox(w - 0.04, 0.2, d - 0.06, 0.05, 1), 0, 0.17, 0), 'body', { mat: 'fabric', ao: 0.86 })); // plinth
  // [ENV fix r1] `back: 'low'` = a 70s conversation-pit lounger: the back is a low frame + one long rolled bolster,
  // its top 0.17 m over the seat (was 0.31), so from the atrium rim a seated Clawd's face and the hearth read over it
  const low = p.back === 'low';
  parts.push(part(at(rbox(w - 0.06, low ? 0.3 : 0.44, 0.16, 0.06, 1), 0, low ? 0.4 : 0.47, -d / 2 + 0.09), 'body', { mat: 'fabric', ao: 0.92 })); // back frame
  const inner = w - 2 * armW, cw = inner / n - 0.012;
  for (let i = 0; i < n; i++) {
    const x = -inner / 2 + (i + 0.5) * (inner / n);
    parts.push(part(at(rbox(cw, 0.13, d - 0.2, 0.05, 2), x, 0.335, 0.06), 'body', { mat: 'fabric' }));
    parts.push(part(at(rbox(cw - 0.02, 0.012, 0.012, 0.004), x, 0.335, d / 2 - 0.04), 'accent', { cast: false })); // cushion piping
    if (low) continue;
    parts.push(part(at(rbox(cw, 0.32, 0.15, 0.07, 2), x, 0.555, -d / 2 + 0.2, -0.16), 'body', { mat: 'fabric' }));
    for (const e of [-1, 1]) parts.push(part(at(sphere(0.016, 6, 4), x + e * cw * 0.22, 0.575, -d / 2 + 0.268), 'body', { mat: 'fabric', ao: 0.55, cast: false })); // tufts
  }
  if (low) { // the bolster: one long roll along the back, piped at both ends, with a button tuft per seat
    parts.push(part(at(capsule(0.085, inner - 0.17, 4, 14), 0, 0.49, -d / 2 + 0.2, 0, 0, PI / 2), 'body', { mat: 'fabric' }));
    for (const e of [-1, 1]) parts.push(part(at(torus(0.078, 0.01, 5, 16), e * (inner / 2 - 0.1), 0.49, -d / 2 + 0.2, 0, PI / 2), 'accent', { cast: false }));
    for (let i = 0; i < n; i++) parts.push(part(at(sphere(0.016, 8, 6), -inner / 2 + (i + 0.5) * (inner / n), 0.5, -d / 2 + 0.283), 'body', { mat: 'fabric', ao: 0.55, cast: false }));
  }
  for (const e of [-1, 1]) {
    const x = e * (w / 2 - armW / 2);
    parts.push(part(at(rbox(armW, 0.22, d - 0.05, 0.05, 1), x, 0.34, 0), 'body', { mat: 'fabric' }));
    if (p.arms !== 'track') {
      parts.push(part(at(capsule(0.095, d - 0.26, 3, 10), x, 0.45, 0.0, PI / 2), 'body', { mat: 'fabric' }));
      parts.push(part(at(torus(0.088, 0.011, 4, 14), x, 0.45, d / 2 - 0.07), 'accent', { cast: false })); // roll-arm piping
    } else parts.push(part(at(rbox(armW, 0.06, d - 0.05, 0.03, 2), x, 0.47, 0), 'body', { mat: 'fabric' }));
  }
  return { parts, footprint: { w, d }, solid: true, anchors: { seat: 0.4, backTop: low ? 0.575 : 0.715 }, colors: { body: T.sofa, secondary: T.oak, accent: T.trim }, hero: low ? 'conversation-pit bolster back, roll arms, peg feet' : 'roll arms + piping, button tufts, peg feet' };
}

/** 5 · armchair (wingback): wing ears, piped seat, walnut legs. */
export function buildArmchair(p: KitParams = {}, rng: Rng) {
  const w = p.w ?? 0.8, d = p.d ?? 0.78;
  const parts: Part[] = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(part(leg(sx * (w / 2 - 0.08), sz * (d / 2 - 0.08), 0, 0.1, 0.022, 0.014, 8, sz * 0.12, -sx * 0.12), 'secondary'));
  parts.push(part(at(rbox(w - 0.04, 0.18, d - 0.04, 0.05, 1), 0, 0.19, 0), 'body', { mat: 'fabric', ao: 0.88 }));
  parts.push(part(at(rbox(w - 0.26, 0.12, d - 0.2, 0.05, 2), 0, 0.33, 0.06), 'body', { mat: 'fabric' }));
  parts.push(part(at(rbox(w - 0.26, 0.012, 0.012, 0.004), 0, 0.33, d / 2 - 0.035), 'accent', { cast: false }));
  parts.push(part(at(rbox(w - 0.1, 0.6, 0.16, 0.07, 1), 0, 0.58, -d / 2 + 0.1, -0.1), 'body', { mat: 'fabric' }));
  for (const e of [-1, 1]) {
    parts.push(part(at(rbox(0.13, 0.2, d - 0.1, 0.05, 1), e * (w / 2 - 0.08), 0.37, 0.02), 'body', { mat: 'fabric' }));
    parts.push(part(at(capsule(0.07, d - 0.26, 2, 7), e * (w / 2 - 0.08), 0.47, 0.02, PI / 2), 'body', { mat: 'fabric' }));
    parts.push(part(at(rbox(0.12, 0.34, 0.26, 0.06, 1), e * (w / 2 - 0.08), 0.72, -d / 2 + 0.2, -0.1, e * 0.35), 'body', { mat: 'fabric' })); // wing
    parts.push(part(at(torus(0.064, 0.009, 4, 12), e * (w / 2 - 0.08), 0.47, d / 2 - 0.06), 'accent', { cast: false }));
  }
  return { parts, footprint: { w, d }, solid: true, anchors: { seat: 0.39 }, colors: { body: T.lavender, secondary: T.walnut, accent: T.trim }, hero: 'wingback ears + piping' };
}

/** 6 · beanbag: lathe blob, pinched top knot, seam line, squash dent. */
export function buildBeanbag(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), s = (p.w ?? 0.7) / 0.72;
  const g = lathe([[0, 0], [0.3, 0.012], [0.36, 0.08], [0.355, 0.18], [0.3, 0.29], [0.18, 0.37], [0.07, 0.4], [0, 0.39]].map(([r, y]) => [r * s, y * (p.h ?? 0.45) / 0.45]), 20);
  // squash dent where someone sat (seeded side)
  const pos = g.getAttribute('position'), a = v.r(0, PI * 2), dx = Math.sin(a) * 0.12 * s, dz = Math.cos(a) * 0.12 * s;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = Math.exp(-((x - dx) ** 2 + (z - dz) ** 2) / 0.03) * Math.min(1, y / 0.3);
    pos.setY(i, y - k * 0.1);
  }
  g.computeVertexNormals();
  at(g, 0, 0, 0, 0, 0, 0, v.s(1.04, 0.03), 1, v.s(0.96, 0.03));
  const parts = [part(g, 'body', { mat: 'fabric' })];
  parts.push(part(at(torus(0.345 * s, 0.008, 4, 24), 0, 0.13, 0, PI / 2, 0, 0, 1.04, 0.96, 1), 'accent', { cast: false })); // seam
  parts.push(part(at(sphere(0.045, 8, 6), 0, 0.38 * (p.h ?? 0.45) / 0.45, 0, 0, 0, 0, 1, 0.7, 1), 'accent')); // pinched knot
  return { parts, footprint: { r: 0.36 * s }, solid: false, anchors: { seat: 0.3 }, colors: { body: T.teal, accent: T.trim }, hero: 'pinched top + seam, squash dent' };
}

/**
 * 7 · table: round café/side (pedestal with flared foot), coffee (low, lower shelf), meeting (rect, 4 legs).
 */
export function buildTable(p: KitParams = {}, rng: Rng) {
  const kind = p.kind ?? 'round', h = p.h ?? (kind === 'coffee' ? 0.32 : 0.55);
  const parts: Part[] = [];
  if (kind === 'round') {
    const r = (p.w ?? 0.7) / 2;
    parts.push(part(at(disc(r, 0.04, 28, 0.012), 0, h - 0.04, 0), 'body', { mat: 'wood' }));
    parts.push(part(at(torus(r - 0.035, 0.006, 3, 28), 0, h + 0.001, 0, PI / 2), 'accent', { cast: false })); // cream inlay
    parts.push(part(lathe([[0.2 * r / 0.35, 0], [0.2 * r / 0.35, 0.016], [0.07, 0.045], [0.035, 0.1], [0.03, h - 0.07], [0.07, h - 0.045], [0, h - 0.04]], 14), 'secondary'));
    return { parts, footprint: { r }, solid: true, anchors: { top: h }, colors: { body: T.oak, secondary: T.ink2, accent: T.trim }, hero: 'pedestal with flared foot' };
  }
  const w = p.w ?? 0.9, d = p.d ?? 0.55;
  parts.push(part(at(slab(w, d, 0.04, 0.06, 0.012), 0, h - 0.04, 0), 'body', { mat: 'wood' }));
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(part(leg(sx * (w / 2 - 0.06), sz * (d / 2 - 0.06), 0, h - 0.04, 0.02, 0.013, 8), kind === 'coffee' ? 'body' : 'secondary', { mat: kind === 'coffee' ? 'wood' : 'plain' }));
  if (kind === 'coffee') parts.push(part(at(slab(w - 0.14, d - 0.14, 0.02, 0.04, 0.006), 0, 0.08, 0), 'body', { mat: 'wood', ao: 0.8 }));
  parts.push(part(at(rbox(w - 0.12, 0.012, 0.012, 0.004), 0, h - 0.02, d / 2 + 0.001), 'accent', { cast: false }));
  return { parts, footprint: { w, d }, solid: true, anchors: { top: h }, colors: { body: kind === 'coffee' ? T.walnut : T.oak, secondary: T.ink2, accent: T.trim }, hero: kind === 'coffee' ? 'lower shelf' : 'tapered legs' };
}

/** 8 · counter (bar / Help Desk / lab bench): panelled body, overhanging top lip, brass foot rail on brackets. */
export function buildCounter(p: KitParams = {}, rng: Rng) {
  const w = p.w ?? 2.0, h = p.h ?? 0.9, d = p.d ?? 0.6;
  const parts = [
    part(at(rbox(w, h - 0.05, d - 0.06, 0.03, 1), 0, (h - 0.05) / 2, -0.03), 'body', { mat: 'wood' }),
    part(at(slab(w + 0.06, d + 0.04, 0.05, 0.03, 0.015), 0, h - 0.05, 0.0), 'secondary', { mat: 'wood' }),
    part(at(rbox(w - 0.04, 0.06, 0.04, 0.012), 0, 0.03, d / 2 - 0.08), 'body', { mat: 'wood', ao: 0.7 }), // toe kick
  ];
  const panels = Math.max(1, Math.round(w / 0.6));
  for (let i = 0; i < panels; i++) {
    const x = -w / 2 + (i + 0.5) * (w / panels);
    parts.push(part(at(rbox(w / panels - 0.08, h - 0.3, 0.014, 0.008), x, (h - 0.05) / 2 + 0.04, d / 2 - 0.058), 'body', { mat: 'wood', ao: 0.86 }));
  }
  parts.push(part(at(cyl(0.014, 0.014, w - 0.1, 10), 0, 0.14, d / 2 + 0.05, 0, 0, PI / 2), 'accent'));
  for (const x of [-w / 2 + 0.12, 0, w / 2 - 0.12]) parts.push(part(at(rbox(0.02, 0.02, 0.1, 0.006), x, 0.14, d / 2 + 0.0), 'accent'));
  return { parts, footprint: { w, d }, solid: true, anchors: { top: h }, colors: { body: T.walnut, secondary: T.trim, accent: T.brass }, hero: 'foot rail + top overhang lip' };
}

/** 31 · bench: slab seat, trestle legs, a stretcher (atrium / lobby). */
export function buildBench(p: KitParams = {}, rng: Rng) {
  const w = p.w ?? 1.6, d = p.d ?? 0.42, h = p.h ?? 0.42;
  const parts = [part(at(slab(w, d, 0.06, 0.05, 0.016), 0, h - 0.06, 0), 'body', { mat: 'wood' })];
  for (const e of [-1, 1]) {
    parts.push(part(at(rbox(0.06, h - 0.06, d - 0.08, 0.02), e * (w / 2 - 0.18), (h - 0.06) / 2, 0), 'secondary'));
    parts.push(part(at(rbox(0.08, 0.03, d - 0.02, 0.01), e * (w / 2 - 0.18), 0.015, 0), 'secondary'));
  }
  parts.push(part(at(cyl(0.015, 0.015, w - 0.36, 8), 0, 0.12, 0, 0, 0, PI / 2), 'accent'));
  return { parts, footprint: { w, d }, solid: true, anchors: { seat: h }, colors: { body: T.oak, secondary: T.ink2, accent: T.brass }, hero: 'trestle legs + brass stretcher' };
}

/**
 * 9 · shelf: crown moulding, plinth, boards of seeded books (leaning books, gaps, brass bookends), a top ornament.
 */
export function buildShelf(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 1.4, h = p.h ?? 1.2, d = p.d ?? 0.36, fill = p.fill ?? 0.85;
  const parts: Part[] = [];
  for (const e of [-1, 1]) parts.push(part(at(rbox(0.04, h - 0.04, d, 0.012), e * (w / 2 - 0.02), (h - 0.04) / 2, 0), 'body', { mat: 'wood' }));
  parts.push(part(at(rbox(w - 0.06, h - 0.1, 0.02, 0.006), 0, h / 2, -d / 2 + 0.012), 'body', { mat: 'wood', ao: 0.62 }));
  parts.push(part(at(rbox(w + 0.06, 0.035, d + 0.05, 0.012), 0, h - 0.018, 0.012), 'body', { mat: 'wood' })); // crown
  parts.push(part(at(rbox(w + 0.02, 0.03, d + 0.02, 0.01), 0, h - 0.05, 0.006), 'body', { mat: 'wood', ao: 0.8 })); // cove
  parts.push(part(at(rbox(w - 0.02, 0.07, d - 0.02, 0.012), 0, 0.035, 0.0), 'body', { mat: 'wood', ao: 0.75 })); // plinth
  const nS = Math.max(2, Math.round((h - 0.1) / 0.36));
  const pitch = (h - 0.12) / nS;
  // [ENV M3.5 tris] far LOD (detail < 1): each shelf row's books become one book-mass block + a front spine quad per
  // book, merged per spine colour (2 tris a book instead of a 12-tri box; ~5× fewer far tris on every bookcase, and
  // the merged row parts are big enough to survive the far LOD's small-part cut, so far shelves never read empty)
  const far = detail() < 1;
  for (let k = 0; k < nS; k++) {
    const y = 0.07 + k * pitch;
    if (k) parts.push(part(at(rbox(w - 0.07, 0.022, d - 0.03, 0.006), 0, y, 0.005), 'body', { mat: 'wood' }));
    const maxH = Math.min(0.3, pitch - 0.05);
    let x = -w / 2 + 0.06;
    const end = w / 2 - 0.06;
    let leaned = false;
    /** far: spine colour → front quads; the row's book extent */
    const spines = new Map<string, THREE.BufferGeometry[]>();
    let rx0 = Infinity, rx1 = -Infinity, rh = Infinity, rd = d;
    const spine = (col: string, cx: number, bw: number, bh: number, bd: number, rz = 0) => {
      const list = spines.get(col) ?? [];
      if (!spines.has(col)) spines.set(col, list);
      list.push(at(new THREE.PlaneGeometry(bw, bh), cx, y + 0.011 + bh / 2, 0.02 + bd / 2 + 0.002, 0, 0, rz));
      rx0 = Math.min(rx0, cx - bw / 2); rx1 = Math.max(rx1, cx + bw / 2); rh = Math.min(rh, bh); rd = Math.min(rd, bd);
    };
    while (x < end - 0.03) {
      if (v.chance(1 - fill) && x > -w / 2 + 0.2) { x += v.r(0.08, 0.2); continue; }
      const tw = v.r(0.028, 0.05), bh = maxH * v.r(0.68, 1.0), bd = d * v.r(0.62, 0.8);
      if (x + tw > end) break;
      const col = v.pick(SPINES);
      if (!leaned && v.chance(0.12) && x + bh * 0.5 < end) { // a leaning book
        leaned = true;
        if (far) spine(col, x + bh * 0.3, tw * 1.3, bh * 0.92, bd, -0.55);
        else parts.push(part(at(rbox(tw, bh, bd, 0.004), x + bh * 0.3, y + 0.011 + bh * 0.46, 0.02, 0, 0, -0.55), 'secondary', { color: col, ao: 0.95 }));
        x += bh * 0.62; continue;
      }
      if (far) spine(col, x + tw / 2, tw, bh, bd);
      else parts.push(part(at(rbox(tw, bh, bd, 0.004), x + tw / 2, y + 0.011 + bh / 2, 0.02), 'secondary', { color: col, ao: 0.95 }));
      x += tw + 0.002;
      if (v.chance(0.06)) { if (!far) parts.push(part(at(rbox(0.012, 0.1, 0.09, 0.004), x + 0.006, y + 0.061, 0.03), 'accent')); x += 0.03; } // bookend
    }
    if (far && spines.size) {
      parts.push(part(at(new THREE.BoxGeometry(rx1 - rx0, rh * 0.96, rd * 0.96), (rx0 + rx1) / 2, y + 0.011 + rh * 0.48, 0.02), 'secondary', { color: '#6A5446', ao: 0.95 }));
      for (const [col, geos] of spines) parts.push(part(mergeGeometries(geos, false), 'secondary', { color: col, ao: false }));
    }
  }
  if (p.top !== false) { // ornament on the crown: a little brass globe or a tiny pot
    if (v.chance(0.5)) {
      parts.push(part(at(sphere(0.06, 10, 8), w * 0.28, h + 0.1, 0), 'accent'));
      parts.push(part(at(cyl(0.012, 0.03, 0.04, 8), w * 0.28, h + 0.02, 0), 'body'));
    } else parts.push(part(at(rbox(0.16, 0.12, 0.2, 0.02), -w * 0.28, h + 0.06, 0, 0, 0.3), 'secondary', { color: v.pick(SPINES) }));
  }
  if (p.cast === false) for (const q of parts) q.cast = false; // [ENV fix m2 r3] wall cases whose key shadow would fall mid-room (LIB south wall)
  return { parts, footprint: { w, d }, solid: true, anchors: { top: h }, colors: { body: T.walnut, secondary: T.trim, accent: T.brass }, hero: 'crown moulding, leaning books, bookends' };
}

/** 10 · bookStack: 1–4 books with visible cream page blocks, tilted. */
export function buildBookStack(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), n = p.n ?? 1 + v.int(3);
  const parts: Part[] = [];
  let y = 0;
  for (let i = 0; i < n; i++) {
    const bw = v.r(0.16, 0.22), bd = v.r(0.12, 0.16), bt = v.r(0.022, 0.04), yaw = v.r(-0.3, 0.3), col = p.colors?.body ?? v.pick(SPINES);
    parts.push(part(at(rbox(bw, 0.005, bd, 0.002), 0, y + 0.0025, 0, 0, yaw), 'body', { color: col, mat: 'small' }));
    parts.push(part(at(rbox(bw, 0.005, bd, 0.002), 0, y + bt - 0.0025, 0, 0, yaw), 'body', { color: col, mat: 'small' }));
    parts.push(part(at(rbox(0.006, bt, bd, 0.002), -bw / 2 * Math.cos(yaw), y + bt / 2, bw / 2 * Math.sin(yaw), 0, yaw), 'body', { color: col, mat: 'small' })); // spine
    parts.push(part(at(rbox(bw - 0.012, bt - 0.01, bd - 0.008, 0.002), 0.004, y + bt / 2, 0, 0, yaw), 'secondary', { mat: 'small' }));
    y += bt;
  }
  return { parts, footprint: { w: 0.22, d: 0.16 }, solid: false, anchors: { top: y }, colors: { body: SPINES[0], secondary: T.trim, accent: T.ink }, small: true, hero: 'page block' };
}
