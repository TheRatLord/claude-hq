/**
 * Prop kit: decor + small story props (§7.5 rows 15–22, 24–28, 30) + easel. Owner: ENV.
 */
import * as THREE from 'three';
import { rbox, cyl, lathe, sphere, capsule, torus, tube, slab, disc, at, part, vary, detail } from './core.ts';
import type { KitParams, Part, PartOpts, Rng } from './core.ts';
import { T, NOTES } from './tokens.ts';

const PI = Math.PI;

/** 15 · mug: lathed cup with a rolled lip, torus handle, a coffee disc; `anchors.steam`. */
export function buildMug(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), s = p.s ?? 1;
  const parts = [
    part(at(lathe([[0, 0], [0.034, 0], [0.037, 0.006], [0.038, 0.075], [0.041, 0.08], [0.034, 0.08], [0.032, 0.012], [0, 0.012]], 14), 0, 0, 0, 0, 0, 0, s, s, s), 'body', { mat: 'small' }),
    part(at(torus(0.022, 0.006, 5, 10, PI * 1.25), 0.038 * s, 0.042 * s, 0, 0, 0, -PI * 0.62, s, s, s), 'body', { mat: 'small' }),
    part(at(cyl(0.032, 0.032, 0.004, 12), 0, 0.066 * s, 0, 0, 0, 0, s, 1, s), 'secondary', { mat: 'small', cast: false }),
    part(at(torus(0.036, 0.003, 3, 14), 0, 0.074 * s, 0, PI / 2, 0, 0, s, s, s), 'accent', { mat: 'small', cast: false }),
  ];
  return { parts, footprint: { r: 0.05 }, solid: false, anchors: { steam: [0, 0.09 * s, 0] }, colors: { body: p.colors?.body ?? v.pick([T.teal, T.trim, T.oat, T.lavender]), secondary: T.walnutDark, accent: T.trim }, small: true, hero: 'torus handle, coffee' };
}

/** 16 · crate: slatted sides, corner brackets, ink straps, a stencil mark. */
export function buildCrate(p: KitParams = {}, rng: Rng) {
  const w = p.w ?? 0.5, h = p.h ?? 0.36, d = p.d ?? 0.4;
  const parts = [part(at(rbox(w - 0.04, h - 0.04, d - 0.04, 0.01), 0, h / 2, 0), 'body', { mat: 'wood', ao: 0.55 })];
  for (let i = 0; i < 3; i++) {
    const y = 0.06 + i * (h - 0.1) / 2.2;
    for (const e of [-1, 1]) {
      parts.push(part(at(rbox(w, 0.08, 0.02, 0.006), 0, y + 0.04, e * (d / 2 - 0.01)), 'body', { mat: 'wood' }));
      parts.push(part(at(rbox(0.02, 0.08, d - 0.04, 0.006), e * (w / 2 - 0.01), y + 0.04, 0), 'body', { mat: 'wood' }));
    }
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(part(at(rbox(0.045, h, 0.045, 0.008), sx * (w / 2 - 0.018), h / 2, sz * (d / 2 - 0.018)), 'secondary'));
  parts.push(part(at(rbox(0.12, 0.08, 0.004, 0.002), 0, h * 0.55, d / 2 + 0.003), 'accent', { cast: false }));
  return { parts, footprint: { w, d }, solid: true, anchors: { top: h }, colors: { body: T.oak, secondary: T.ink2, accent: T.ink }, hero: 'slats + corner brackets' };
}

/** 17 · box (cardboard): tape strip, one open flap. */
export function buildBox(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = v.s(p.w ?? 0.4, 0.1), h = v.s(p.h ?? 0.3, 0.1), d = v.s(p.d ?? 0.32, 0.1);
  const parts = [
    part(at(rbox(w, h, d, 0.008), 0, h / 2, 0), 'body'),
    part(at(rbox(0.06, 0.004, d + 0.004, 0.001), 0, h + 0.001, 0), 'secondary', { cast: false }),
    part(at(rbox(0.06, h * 0.4, 0.004, 0.001), 0, h * 0.8, d / 2 + 0.001), 'secondary', { cast: false }),
    part(at(rbox(w * 0.95, 0.006, d * 0.48, 0.002), 0, h + 0.06, -d / 2 - 0.08, -1.1), 'body', { ao: 0.9 }), // open flap
    part(at(rbox(0.08, 0.05, 0.003), w * 0.25, h * 0.5, d / 2 + 0.002), 'accent', { cast: false }),
  ];
  return { parts, footprint: { w, d }, solid: false, anchors: { top: h }, colors: { body: T.kraft, secondary: T.butter, accent: T.ink }, hero: 'tape strip + open flap' };
}

/**
 * 18 · rug: round / rect / runner. [ENV fix m2 r3] (review m2 r3: "a flat disc with a single cream ring", "a raised
 * dark-teal board with a white line"): a patterned clay rug. The base is a soft pillow (its edge rolls down to the floor:
 * no slab step, so the edge pass draws no hard outline) with gentle hand-pressed lumps; on it, draped to the same
 * surface, the field (body) inside a border (secondary) carrying a diamond motif band (accent), a keyline round the
 * field, a centre medallion (round: an 8-petal rosette in a dotted ring; rect: a stepped lozenge; runner: a row of
 * small lozenges), and cream fringe tassels (round: all round; rect / runner: the short ends). Flat (no AO), ≤ 1.5k tris.
 */
export function buildRug(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), kind = p.kind ?? 'rect', T0 = 0.007;
  const seed = v.r(0, 10), seed2 = v.r(0, 10);
  const parts: Part[] = [];
  const flat: PartOpts = { ao: false, cast: false };
  /** surface height at local (x, z): the pillow top, a slight dome (round), soft lumps fading out toward the rim */
  let edgeD = (x: number, z: number): number => 1; // distance-to-rim fraction (0 at the rim, 1 inside the lump zone)
  const H = (x: number, z: number) => T0 + 0.0014 * (Math.sin(x * 4.1 + seed) * Math.sin(z * 3.7 + seed2) + 0.3 * Math.sin(x * 6.3 - z * 5.2 + seed)) * edgeD(x, z);
  /** drape a flat (y 0, xz) decal onto the surface, `lift` above it (layers ≥ 1.2 mm apart: the lumped surface's chords
   *  differ between meshes, closer layers z-fought into ragged shapes) */
  const drape = (g: THREE.BufferGeometry, lift: number) => { const q = g.getAttribute('position'); for (let k = 0; k < q.count; k++) q.setY(k, H(q.getX(k), q.getZ(k)) + lift); g.computeVertexNormals(); return g; };
  const flatDisc = (r: number, seg = 40, rings = 1, r0 = 0) => (r0 > 0 ? new THREE.RingGeometry(r0, r, seg, rings) : new THREE.CircleGeometry(r, seg)).rotateX(-PI / 2);
  const lozenge = (hw: number, hd: number) => new THREE.CircleGeometry(1, 4).rotateX(-PI / 2).scale(hw, 1, hd);
  const fringe = (x: number, z: number, a: number, len = 0.055) => parts.push(part(at(new THREE.PlaneGeometry(0.013, len).rotateX(-PI / 2), x, 0.0025, z, 0, a), 'accent', { ...flat, mat: 'small', color: p.colors?.fringe ?? T.trim })); // a flat strand (2 tris)
  // far LOD twin ([ENV fix m2 r3] perf): the border + field only (motifs, fringe and medallion are sub-pixel from 6 m;
  // the patterned rugs were 34k of the 249k far-LOD tris)
  if (detail() < 1) {
    const cs: PartOpts = { ao: false, cast: false };
    if (kind === 'round') { const r = p.r ?? 1.2; return { parts: [part(disc(r, T0, 20, 0.003), 'secondary', cs), part(at(disc(r - Math.min(0.16, r * 0.14), T0, 20, 0.002), 0, 0.0012, 0), 'body', cs)], footprint: { r }, solid: false, anchors: {}, colors: { body: T.tealDeep, secondary: T.teal, accent: T.trim } }; }
    const w = p.w ?? 2.0, d = p.d ?? 1.4, b = Math.min(0.14, w * 0.08, d * 0.08);
    return { parts: [part(slab(w, d, T0, 0.035, 0), 'secondary', cs), part(at(slab(w - 2 * b, d - 2 * b, T0, 0.02, 0), 0, 0.0012, 0), 'body', cs)], footprint: { w, d }, solid: false, anchors: {}, colors: { body: T.tealDeep, secondary: T.teal, accent: T.trim } };
  }
  if (kind === 'round') {
    const r = p.r ?? 1.2, b = Math.min(0.16, r * 0.14);
    edgeD = (x: number, z: number) => Math.min(1, Math.max(0, (r - 0.08 - Math.hypot(x, z)) / 0.25));
    // pillow base: rolled rim then rings inward (vertices for the lumps)
    const prof: [number, number][] = [[r, 0], [r - 0.006, T0 * 0.45], [r - 0.018, T0 * 0.85], [r - 0.04, T0]];
    for (let q = r - 0.14; q > 0.08; q -= 0.2) prof.push([q, T0]);
    prof.push([0, T0]);
    const base = new THREE.LatheGeometry(prof.map(([a, y]) => new THREE.Vector2(a, y)), 36), bp = base.getAttribute('position');
    // (under the field the base sinks 2.5 mm: its long lathe chords must never poke through the draped field)
    for (let k = 0; k < bp.count; k++) { const y = bp.getY(k), x = bp.getX(k), z = bp.getZ(k); if (y >= T0 * 0.99) bp.setY(k, H(x, z) - (Math.hypot(x, z) < r - b - 0.03 ? 0.0025 : 0)); }
    base.computeVertexNormals();
    parts.push(part(base, 'secondary', flat));
    parts.push(part(drape(flatDisc(r - b, 36, 6), 0.0012), 'body', flat)); // field
    parts.push(part(drape(flatDisc(r - b + 0.012, 48, 1, r - b - 0.004), 0.0026), 'accent', flat)); // keyline
    const rm = r - b / 2 - 0.01, n = Math.max(10, Math.round((2 * PI * rm) / 0.15));
    for (let k = 0; k < n; k++) { const a = (k / n) * 2 * PI; parts.push(part(drape(lozenge(0.034, 0.05).rotateY(-a).translate(Math.cos(a) * rm, 0, Math.sin(a) * rm), 0.0026), 'accent', flat)); }
    // an inner guard band (secondary) studded with small accent lozenges, between the border and the medallion
    const gr = (r - b) * 0.74;
    if (gr > 0.45) {
      parts.push(part(drape(flatDisc(gr + 0.025, 40, 1, gr - 0.025), 0.0026), 'secondary', flat));
      const ng = Math.round((2 * PI * gr) / 0.22);
      for (let k = 0; k < ng; k++) { const a = (k / ng) * 2 * PI; parts.push(part(drape(lozenge(0.03, 0.022).rotateY(-a).translate(Math.cos(a) * gr, 0, Math.sin(a) * gr), 0.004), 'accent', flat)); }
    }
    // medallion: 8 petals + a dotted ring + a centre boss
    const mR = Math.min(0.42, r * 0.34);
    for (let k = 0; k < 8; k++) { const a = (k / 8) * 2 * PI + PI / 8; parts.push(part(drape(new THREE.CircleGeometry(1, 12).rotateX(-PI / 2).scale(mR * 0.42, 1, mR * 0.17).translate(mR * 0.5, 0, 0).rotateY(a), 0.0026), 'secondary', flat)); }
    parts.push(part(drape(flatDisc(mR * 0.2, 16), 0.004), 'accent', flat));
    const nd = Math.max(12, Math.round((2 * PI * mR * 1.3) / 0.1));
    for (let k = 0; k < nd; k++) { const a = (k / nd) * 2 * PI; parts.push(part(drape(flatDisc(0.018, 6).translate(Math.cos(a) * mR * 1.3, 0, Math.sin(a) * mR * 1.3), 0.0026), 'secondary', flat)); }
    if (p.fringe !== false) { const nf = Math.round((2 * PI * r) / 0.045); for (let k = 0; k < nf; k++) { const a = (k / nf) * 2 * PI; fringe(Math.cos(a) * (r + 0.022), Math.sin(a) * (r + 0.022), PI / 2 - a); } }
    return { parts, footprint: { r }, solid: false, anchors: {}, colors: { body: T.tealDeep, secondary: T.teal, accent: T.trim }, hero: 'diamond border band, rosette medallion, fringe' };
  }
  const w = p.w ?? 2.0, d = p.d ?? 1.4, b = Math.min(0.14, w * 0.08, d * 0.08), cr = 0.035;
  edgeD = (x: number, z: number) => Math.min(1, Math.max(0, Math.min(w / 2 - Math.abs(x), d / 2 - Math.abs(z)) - 0.06) / 0.2);
  // pillow base: 3 inset contours rolling down to the floor + a gridded top (lumps)
  const insets = [[0, 0], [0.006, T0 * 0.45], [0.018, T0 * 0.85], [0.04, T0]];
  const rings = insets.map(([i]) => roundedRectPts(w - 2 * i, d - 2 * i, Math.max(0.001, cr - i)));
  const pos: number[] = [], idx: number[] = [];
  rings.forEach((pts, k) => pts.forEach(([x, z]) => pos.push(x, insets[k][1], z)));
  const m = rings[0].length;
  for (let k = 0; k < rings.length - 1; k++) for (let q = 0; q < m; q++) { const a = k * m + q, b1 = k * m + ((q + 1) % m), c = a + m, e = b1 + m; idx.push(a, b1, c, b1, e, c); }
  const edge = new THREE.BufferGeometry();
  edge.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); edge.setIndex(idx); edge.computeVertexNormals();
  // wind so the band faces up (the contours run counter-clockwise seen from above in shape space → flip if needed)
  if (edge.getAttribute('normal').getY(m + 1) < 0) { for (let q = 0; q < idx.length; q += 3) [idx[q + 1], idx[q + 2]] = [idx[q + 2], idx[q + 1]]; edge.setIndex(idx); edge.computeVertexNormals(); }
  parts.push(part(edge, 'secondary', flat));
  const iw = w - 0.08, id = d - 0.08;
  parts.push(part(drape(new THREE.PlaneGeometry(iw, id, Math.max(1, Math.round(iw / 0.25)), Math.max(1, Math.round(id / 0.25))).rotateX(-PI / 2), 0), 'secondary', flat));
  const fw = w - 2 * b, fd = d - 2 * b;
  parts.push(part(drape(new THREE.PlaneGeometry(fw, fd, Math.max(1, Math.round(fw / 0.25)), Math.max(1, Math.round(fd / 0.25))).rotateX(-PI / 2), 0.0012), 'body', flat)); // field
  // keyline round the field (4 thin strips)
  const kl = 0.014;
  for (const e of [-1, 1]) {
    parts.push(part(drape(new THREE.PlaneGeometry(fw + kl, kl, Math.max(1, Math.round(fw / 0.25)), 1).rotateX(-PI / 2).translate(0, 0, e * (fd / 2)), 0.0026), 'accent', flat));
    parts.push(part(drape(new THREE.PlaneGeometry(kl, fd + kl, 1, Math.max(1, Math.round(fd / 0.25))).rotateX(-PI / 2).translate(e * (fw / 2), 0, 0), 0.0026), 'accent', flat));
  }
  // diamond motif band in the border (all four sides)
  if (b >= 0.07) {
    const md = b * 0.3, run = (L: number, fn: (at: number) => unknown) => { const n = Math.max(2, Math.round(L / 0.15)); for (let k = 0; k < n; k++) fn(-L / 2 + (k + 0.5) * (L / n)); };
    for (const e of [-1, 1]) {
      run(w - b, (x) => parts.push(part(drape(lozenge(md * 0.75, md).translate(x, 0, e * (d / 2 - b / 2)), 0.0026), 'accent', flat)));
      run(d - 2 * b, (z) => parts.push(part(drape(lozenge(md, md * 0.75).translate(e * (w / 2 - b / 2), 0, z), 0.0026), 'accent', flat)));
    }
  }
  // medallion: rect = a stepped lozenge; runner = a row of small lozenges down its length
  const along = w >= d ? 'x' : 'z', L = Math.max(w, d), S = Math.min(fw, fd);
  if (kind === 'runner' || L / Math.min(w, d) > 2.2) {
    const n = Math.max(1, Math.round((L - 2 * b) / 0.7));
    for (let k = 0; k < n; k++) {
      const c = -(L - 2 * b) / 2 + (k + 0.5) * ((L - 2 * b) / n), hw = S * 0.32, hl = Math.min(0.26, S * 0.45);
      const [x, z] = along === 'x' ? [c, 0] : [0, c];
      parts.push(part(drape((along === 'x' ? lozenge(hl, hw) : lozenge(hw, hl)).translate(x, 0, z), 0.0026), 'secondary', flat));
      parts.push(part(drape((along === 'x' ? lozenge(hl * 0.45, hw * 0.45) : lozenge(hw * 0.45, hl * 0.45)).translate(x, 0, z), 0.004), 'accent', flat));
    }
  } else {
    parts.push(part(drape(lozenge(fw * 0.34, fd * 0.34), 0.0026), 'secondary', flat));
    parts.push(part(drape(lozenge(fw * 0.22, fd * 0.22), 0.004), 'body', flat));
    parts.push(part(drape(lozenge(fw * 0.09, fd * 0.09), 0.0054), 'accent', flat));
  }
  if (p.fringe !== false) {
    const ends = along === 'x' || kind !== 'runner' ? 'x' : 'z';
    const n = Math.round((ends === 'x' ? d : w) / 0.045);
    for (const e of [-1, 1]) for (let k = 0; k < n; k++) {
      const t = -0.5 + (k + 0.5) / n;
      if (ends === 'x') fringe(e * (w / 2 + 0.024), t * (d - 0.04), PI / 2); else fringe(t * (w - 0.04), e * (d / 2 + 0.024), 0);
    }
  }
  return { parts, footprint: { w, d }, solid: false, anchors: {}, colors: { body: T.tealDeep, secondary: T.teal, accent: T.trim }, hero: kind === 'runner' ? 'lozenge row + fringe' : 'diamond border band, lozenge medallion, fringe' };
}
/** Points round a rounded rectangle (centred, xz), counter-clockwise from the +x side, fixed count for any size. */
function roundedRectPts(w: number, d: number, r: number, seg = 4): [number, number][] {
  const out: [number, number][] = [], hx = w / 2 - r, hz = d / 2 - r;
  for (const [cx, cz, a0] of [[hx, hz, 0], [-hx, hz, PI / 2], [-hx, -hz, PI], [hx, -hz, 1.5 * PI]]) {
    for (let k = 0; k <= seg; k++) { const a = a0 + (k / seg) * (PI / 2); out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
  }
  return out;
}

/** 19 · stanchion: lathed post, ball top, weighted base. Ropes are `buildRope` spans between posts. */
export function buildStanchion(p: KitParams = {}, rng: Rng) {
  const h = p.h ?? 0.9;
  const parts = [
    part(lathe([[0, 0], [0.13, 0], [0.135, 0.012], [0.11, 0.035], [0.035, 0.05], [0, 0.05]], 18), 'secondary'),
    part(lathe([[0.024, 0.05], [0.02, h - 0.1], [0.028, h - 0.08], [0.028, h - 0.06], [0, h - 0.06]], 10), 'body'),
    part(at(sphere(0.042, 12, 8), 0, h - 0.02, 0), 'body'),
    part(at(torus(0.03, 0.008, 4, 10), 0, h - 0.07, 0, PI / 2), 'secondary'),
  ];
  return { parts, footprint: { r: 0.14 }, solid: false, anchors: { hook: [0, h - 0.08, 0] }, colors: { body: T.brass, secondary: T.ink2, accent: T.tealDeep }, hero: 'ball top, weighted base' };
}
/** 19b · rope: a sagging velvet catenary from local (0, y, 0) to (len, y, 0), with brass end clips. */
export function buildRope(p: KitParams = {}, rng: Rng) {
  const len = p.len ?? 1, y = p.y ?? 0.82, sag = p.sag ?? Math.min(0.14, 0.06 + len * 0.05);
  const pts = []; for (let k = 0; k <= 8; k++) { const t = k / 8; pts.push([t * len, y - sag * 4 * t * (1 - t), 0]); }
  const parts = [part(tube(pts, 0.016, 14, 6), 'body')];
  for (const x of [0.03, len - 0.03]) parts.push(part(at(cyl(0.02, 0.02, 0.05, 8), x, y, 0, 0, 0, PI / 2), 'accent'));
  return { parts, footprint: { w: len, d: 0.04 }, solid: false, anchors: {}, colors: { body: p.colors?.body ?? T.tealDeep, accent: T.brass }, hero: 'sagging catenary' };
}

/** 20 · whiteboard: mobile (caster legs) or wall-mounted; marker tray with markers, a doodle of notes. */
export function buildWhiteboard(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 1.4, bh = p.h ?? 0.8, wall = !!p.wall, y0 = wall ? 0 : 0.55;
  const parts = [
    part(at(rbox(w, bh, 0.03, 0.015), 0, y0 + bh / 2, 0), 'secondary'),
    part(at(rbox(w - 0.06, bh - 0.06, 0.012, 0.004), 0, y0 + bh / 2, 0.012), 'body', { cast: false }),
    part(at(rbox(w * 0.6, 0.02, 0.06, 0.006), 0, y0 + 0.02, 0.035), 'secondary'),
  ];
  for (let i = 0; i < 3; i++) parts.push(part(at(capsule(0.008, 0.09, 2, 6), -0.1 + i * 0.07, y0 + 0.04, 0.04, 0, 0, PI / 2), 'accent', { color: [T.tealDeep, T.rose, T.ink][i], cast: false, mat: 'small' }));
  for (let i = 0; i < 4; i++) parts.push(part(at(rbox(0.09, 0.09, 0.004, 0.002), -w / 2 + 0.2 + i * 0.22 + v.r(-0.03, 0.03), y0 + bh * v.r(0.45, 0.75), 0.02, 0, 0, v.r(-0.12, 0.12)), 'accent', { color: v.pick(NOTES), cast: false }));
  for (let i = 0; i < 3; i++) parts.push(part(at(rbox(v.r(0.2, 0.45), 0.012, 0.003), -w / 2 + 0.3 + v.r(0, w * 0.4), y0 + bh * (0.3 - i * 0.07), 0.02), 'accent', { color: T.tealDeep, cast: false })); // scribbles
  if (!wall) {
    for (const e of [-1, 1]) {
      parts.push(part(at(rbox(0.04, 0.55 + bh * 0.9, 0.04, 0.012), e * (w / 2 + 0.02), (0.55 + bh * 0.9) / 2, 0), 'secondary'));
      parts.push(part(at(rbox(0.05, 0.03, 0.42, 0.01), e * (w / 2 + 0.02), 0.05, 0), 'secondary'));
      for (const z of [-0.19, 0.19]) parts.push(part(at(sphere(0.025, 8, 6), e * (w / 2 + 0.02), 0.025, z), 'secondary'));
    }
  }
  return { parts, footprint: { w: w + 0.1, d: wall ? 0.06 : 0.45 }, solid: !wall, anchors: {}, colors: { body: T.whiteboard, secondary: T.ink2, accent: T.teal }, hero: 'marker tray + markers, casters' };
}

/** 21 · corkboard: oak frame, cork face, pinned paper notes with pushpins. */
export function buildCorkboard(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 1.0, h = p.h ?? 0.7;
  const parts = [part(at(rbox(w, h, 0.03, 0.014), 0, h / 2, 0), 'secondary', { mat: 'wood' }), part(at(rbox(w - 0.06, h - 0.06, 0.01, 0.003), 0, h / 2, 0.012), 'body', { cast: false })];
  const n = 5 + v.int(3);
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + 0.12 + v.r(0, w - 0.24), y = 0.12 + v.r(0, h - 0.24), s = v.r(0.09, 0.16);
    parts.push(part(at(rbox(s, s * v.r(0.8, 1.3), 0.003), x, y, 0.019, 0, 0, v.r(-0.15, 0.15)), 'accent', { color: v.pick([...NOTES, T.trim, T.trim]), cast: false }));
    parts.push(part(at(sphere(0.008, 6, 4), x, y + s * 0.4, 0.024), 'accent', { color: v.pick([T.rose, T.tealDeep, T.butter]), cast: false, mat: 'small' }));
  }
  return { parts, footprint: { w, d: 0.04 }, solid: false, anchors: {}, colors: { body: T.cork, secondary: T.oak, accent: T.trim }, hero: 'pinned notes + pushpins' };
}

/** 22 · filingCabinet: oat steel, drawers with cup handles + label holders. */
export function buildFilingCabinet(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), n = typeof p.drawers === 'number' ? p.drawers : 3, w = p.w ?? 0.46, d = p.d ?? 0.55, dh = 0.3, h = n * dh + 0.06;
  const parts = [part(at(rbox(w, h, d, 0.02), 0, h / 2, 0), 'body', { ao: 0.9 })];
  for (let i = 0; i < n; i++) {
    const y = 0.05 + i * dh + dh / 2;
    parts.push(part(at(rbox(w - 0.04, dh - 0.03, 0.02, 0.01), 0, y, d / 2 + 0.004), 'body'));
    parts.push(part(at(torus(0.035, 0.008, 4, 10, PI), 0, y + 0.02, d / 2 + 0.02, PI / 2 - 0.2, 0, PI), 'accent', { cast: false }));
    parts.push(part(at(rbox(0.09, 0.04, 0.006, 0.002), 0, y + 0.07, d / 2 + 0.017), 'secondary', { cast: false }));
  }
  if (v.chance(0.5)) parts.push(part(at(rbox(0.3, 0.02, 0.22, 0.004), 0.02, h + 0.01, 0, 0, 0.2), 'secondary')); // folder on top
  return { parts, footprint: { w, d }, solid: true, anchors: { top: h }, colors: { body: T.steelOat, secondary: T.trim, accent: T.brass }, hero: 'cup handles + label holders' };
}

/** 24 · coatRack: lathe pole, ball-ended hooks, a hung scarf; or an umbrella stand (kind:'umbrella'). */
export function buildCoatRack(p: KitParams = {}, rng: Rng) {
  const v = vary(rng);
  if (p.kind === 'umbrella') {
    const parts = [part(lathe([[0, 0], [0.12, 0], [0.13, 0.05], [0.12, 0.45], [0.13, 0.46], [0.11, 0.46], [0.1, 0.05], [0, 0.05]], 14), 'body')];
    for (let i = 0; i < 2; i++) {
      const a = i * 2 + 0.4;
      parts.push(part(at(cyl(0.008, 0.006, 0.7, 6), Math.cos(a) * 0.04, 0.4, Math.sin(a) * 0.04, 0.1, 0, 0.1 * (i ? 1 : -1)), 'secondary'));
      parts.push(part(at(lathe([[0, 0], [0.045, 0.05], [0.035, 0.25], [0.01, 0.4], [0, 0.42]], 8), Math.cos(a) * 0.05, 0.3, Math.sin(a) * 0.05), 'accent', { color: [T.tealDeep, T.lavender][i] }));
      parts.push(part(at(torus(0.03, 0.007, 4, 8, PI), Math.cos(a) * 0.06, 0.77, Math.sin(a) * 0.04), 'secondary'));
    }
    return { parts, footprint: { r: 0.14 }, solid: false, anchors: {}, colors: { body: T.walnut, secondary: T.ink2, accent: T.tealDeep }, hero: 'umbrellas + hook handles' };
  }
  const h = p.h ?? 1.6;
  const parts = [part(lathe([[0, 0], [0.2, 0], [0.19, 0.03], [0.05, 0.06], [0.03, 0.09], [0.024, h - 0.06], [0.04, h - 0.04], [0.02, h], [0, h]], 12), 'body', { mat: 'wood' })];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * PI * 2 + 0.3, x = Math.sin(a), z = Math.cos(a);
    parts.push(part(tube([[x * 0.02, h - 0.14, z * 0.02], [x * 0.12, h - 0.1, z * 0.12], [x * 0.15, h - 0.02, z * 0.15]], 0.008, 4, 4), 'secondary'));
    parts.push(part(at(sphere(0.016, 8, 6), x * 0.15, h - 0.01, z * 0.15), 'secondary'));
  }
  // hung scarf: a draped strap over the front hook
  const sx = Math.sin(0.3) * 0.13, sz = Math.cos(0.3) * 0.13;
  parts.push(part(tube([[sx - 0.06, h - 0.55, sz + 0.02], [sx - 0.03, h - 0.2, sz + 0.03], [sx, h - 0.08, sz], [sx + 0.03, h - 0.2, sz + 0.03], [sx + 0.05, h - 0.45, sz + 0.02]], 0.028, 12, 5), 'accent', { color: v.pick([T.lavender, T.teal, T.rose]) }));
  return { parts, footprint: { r: 0.2 }, solid: false, anchors: {}, colors: { body: T.walnut, secondary: T.brass, accent: T.rose }, hero: 'ball-ended hooks, a hung scarf' };
}

/** 25 · waterCooler: cream body, teal bottle dome, cup dispenser, ink taps. */
export function buildWaterCooler(p: KitParams = {}, rng: Rng) {
  const parts = [
    part(at(rbox(0.34, 0.8, 0.34, 0.05, 2), 0, 0.42, 0), 'body'),
    part(at(rbox(0.3, 0.03, 0.3, 0.01), 0, 0.02, 0), 'secondary', { ao: 0.7 }),
    part(at(lathe([[0.1, 0], [0.14, 0.03], [0.14, 0.28], [0.1, 0.34], [0.04, 0.37], [0.04, 0.4], [0, 0.4]], 16), 0, 0.82, 0), 'accent'),
    part(at(rbox(0.2, 0.06, 0.08, 0.02), 0, 0.62, 0.19), 'body'),
    part(at(rbox(0.04, 0.03, 0.04, 0.01), -0.05, 0.58, 0.21), 'secondary', { color: T.tealDeep }),
    part(at(rbox(0.04, 0.03, 0.04, 0.01), 0.05, 0.58, 0.21), 'secondary', { color: T.rose }),
    part(at(rbox(0.16, 0.012, 0.06, 0.004), 0, 0.46, 0.2), 'secondary'),
    part(at(cyl(0.035, 0.03, 0.26, 10), 0.21, 0.5, 0.0), 'body', { ao: 0.9 }), // cup dispenser tube
    part(at(lathe([[0.022, 0], [0.032, 0.05], [0.028, 0.05], [0.018, 0.004]], 10), 0.21, 0.35, 0.0), 'accent', { mat: 'small' }),
  ];
  return { parts, footprint: { w: 0.4, d: 0.36 }, solid: true, anchors: {}, colors: { body: T.steelOat, secondary: T.ink2, accent: T.bottle }, hero: 'bottle dome + cup dispenser' };
}

/** 26 · bin (paper basket): tapered woven basket with rim, crumpled paper balls. */
export function buildBin(p: KitParams = {}, rng: Rng) {
  const v = vary(rng);
  const parts = [part(lathe([[0, 0], [0.11, 0], [0.14, 0.3], [0.15, 0.31], [0.135, 0.31], [0.1, 0.02], [0, 0.02]], 14), 'body')];
  parts.push(part(at(torus(0.145, 0.008, 4, 16), 0, 0.305, 0, PI / 2), 'secondary'));
  for (let i = 0; i < 4; i++) {
    const g = sphere(0.04, 6, 4), pos = g.getAttribute('position');
    for (let k = 0; k < pos.count; k++) { const f = 0.75 + v.r(0, 0.45); pos.setXYZ(k, pos.getX(k) * f, pos.getY(k) * f, pos.getZ(k) * f); }
    g.computeVertexNormals();
    parts.push(part(at(g, v.r(-0.06, 0.06), 0.27 + i * 0.02, v.r(-0.06, 0.06)), 'accent', { cast: false }));
  }
  if (v.chance(0.5)) parts.push(part(at(sphere(0.035, 6, 4), 0.22, 0.03, 0.08), 'accent', { cast: false })); // missed shot
  return { parts, footprint: { r: 0.16 }, solid: false, anchors: {}, colors: { body: v.pick([T.teal, T.oat]), secondary: T.walnut, accent: T.trim }, hero: 'crumpled paper balls' };
}

/** 27 · sign / plaque: rounded plaque on stand-off bolts (wall) or on a post (floor). Text is the sign atlas. */
export function buildSign(p: KitParams = {}, rng: Rng) {
  const w = p.w ?? 0.6, h = p.h ?? 0.2;
  const parts = [part(at(rbox(w, h, 0.03, Math.min(0.05, h / 3), 2), 0, 0, 0.03), 'body')];
  parts.push(part(at(rbox(w - 0.03, h - 0.03, 0.006, Math.min(0.04, h / 3.5)), 0, 0, 0.047), 'secondary', { cast: false }));
  for (const [sx, sy] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    parts.push(part(at(cyl(0.012, 0.012, 0.03, 8), sx * (w / 2 - 0.04), sy * (h / 2 - 0.035), 0.015, PI / 2), 'accent'));
    parts.push(part(at(cyl(0.016, 0.016, 0.006, 10), sx * (w / 2 - 0.04), sy * (h / 2 - 0.035), 0.05, PI / 2), 'accent'));
  }
  return { parts, footprint: { w, d: 0.06 }, solid: false, anchors: { face: [0, 0, 0.051] }, colors: { body: T.trim, secondary: T.ink, accent: T.brass }, hero: 'stand-off bolts, rounded corners' };
}

/** 28 · radiator / vent / pipe (architecture dressing). */
export function buildRadiator(p: KitParams = {}, rng: Rng) {
  const kind = p.kind ?? 'radiator';
  const parts: Part[] = [];
  if (kind === 'vent') {
    const w = p.w ?? 0.5, h = p.h ?? 0.3;
    parts.push(part(at(rbox(w, h, 0.03, 0.012), 0, 0, 0.015), 'body'));
    for (let i = 0; i < 5; i++) parts.push(part(at(rbox(w - 0.06, 0.02, 0.02, 0.006), 0, -h / 2 + 0.05 + i * (h - 0.1) / 4, 0.03, -0.5), 'secondary'));
    return { parts, footprint: { w, d: 0.04 }, solid: false, anchors: {}, colors: { body: T.oat, secondary: T.steel, accent: T.brass }, hero: 'louvres' };
  }
  if (kind === 'pipe') {
    const len = p.len ?? 1.5;
    parts.push(part(at(cyl(0.04, 0.04, len, 10), 0, len / 2, 0), 'body'));
    parts.push(part(tube([[0, len, 0], [0, len + 0.12, 0.0], [0, len + 0.16, 0.12]], 0.04, 8, 10), 'body'));
    for (const y of [0.2, len - 0.1]) parts.push(part(at(torus(0.045, 0.012, 4, 12), 0, y, 0, PI / 2), 'secondary'));
    parts.push(part(at(torus(0.06, 0.01, 4, 12), 0.07, len * 0.5, 0, 0, 0, PI / 2), 'accent'));
    parts.push(part(at(cyl(0.012, 0.012, 0.07, 6), 0.035, len * 0.5, 0, 0, 0, PI / 2), 'accent'));
    return { parts, footprint: { r: 0.08 }, solid: false, anchors: {}, colors: { body: T.oat, secondary: T.ink2, accent: T.brass }, hero: 'elbow + valve wheel' };
  }
  const w = p.w ?? 0.9, h = p.h ?? 0.5, n = Math.round(w / 0.08);
  for (let i = 0; i < n; i++) parts.push(part(at(rbox(0.045, h, 0.08, 0.005), -w / 2 + (i + 0.5) * (w / n), h / 2 + 0.08, 0), 'body', { ao: 0.9 }));
  for (const y of [0.1, h + 0.06]) parts.push(part(at(cyl(0.02, 0.02, w, 8), 0, y, 0, 0, 0, PI / 2), 'secondary'));
  for (const e of [-1, 1]) parts.push(part(at(rbox(0.04, 0.1, 0.04, 0.01), e * (w / 2 - 0.05), 0.04, 0), 'secondary'));
  parts.push(part(at(torus(0.04, 0.008, 4, 12), w / 2 + 0.05, 0.12, 0, 0, PI / 2), 'accent'));
  return { parts, footprint: { w, d: 0.12 }, solid: false, anchors: {}, colors: { body: T.oat, secondary: T.steel, accent: T.brass }, hero: 'fins + valve wheel' };
}

/** 30 · cushion (pinched corners) / throw (folded over an arm). */
export function buildCushion(p: KitParams = {}, rng: Rng) {
  const v = vary(rng);
  if (p.kind === 'throw') {
    const w = p.w ?? 0.5;
    const g = new THREE.BoxGeometry(w, 0.02, 0.9, 1, 1, 10), pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) { const z = pos.getZ(i), a = (z / 0.9 + 0.5) * PI; pos.setXYZ(i, pos.getX(i) * (1 + Math.sin(z * 9) * 0.03), Math.sin(a) * 0.16 + pos.getY(i), -Math.cos(a) * 0.16 + Math.sin(z * 7) * 0.01); }
    g.computeVertexNormals();
    const parts = [part(g, 'body', { mat: 'fabric' })];
    for (const e of [-1, 1]) parts.push(part(at(rbox(w, 0.024, 0.03, 0.006), 0, 0.0, e * 0.16), 'accent', { cast: false }));
    return { parts, footprint: { w, d: 0.34 }, solid: false, anchors: {}, colors: { body: p.colors?.body ?? v.pick([T.rose, T.lavender, T.sage]), accent: T.trim }, hero: 'fold + stripe hem' };
  }
  if (p.kind === 'floor') { // [ENV fix r1] a square floor cushion (zabuton): thick, piped all round, a tuft button
    const w = p.w ?? 0.46, t = p.h ?? 0.11;
    const g = rbox(w, t, w, 0.045, 2), pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i) / w * 2, z = pos.getZ(i) / w * 2, y = pos.getY(i); pos.setY(i, y * (1 + 0.35 * (1 - x * x) * (1 - z * z)) + t / 2); } // puffed middle
    g.computeVertexNormals();
    const parts = [part(g, 'body', { mat: 'fabric' })];
    parts.push(part(at(rbox(w + 0.006, 0.012, w + 0.006, 0.02, 1), 0, t / 2, 0), 'accent', { cast: false })); // piping
    parts.push(part(at(sphere(0.018, 8, 6), 0, t * 1.35 + 0.004, 0, 0, 0, 0, 1, 0.5, 1), 'accent', { cast: false }));
    return { parts, footprint: { w, d: w }, solid: false, anchors: { top: t * 1.35 }, colors: { body: p.colors?.body ?? v.pick([T.rose, T.butter, T.lavender]), accent: T.trim }, hero: 'puffed zabuton, piping + tuft' };
  }
  const w = p.w ?? 0.34, h = p.h ?? 0.3, t = 0.1;
  const g = sphere(0.5, 14, 10), pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) * 2, y = pos.getY(i) * 2, z = pos.getZ(i) * 2;
    const k = 1 + 0.55 * Math.abs(x * y) ** 0.8; // corner pinch
    pos.setXYZ(i, x * w / 2 * k, y * h / 2 * k, z * t / 2 * (1 - 0.35 * Math.abs(x * y)));
  }
  g.computeVertexNormals();
  const parts = [part(at(g, 0, h / 2, 0), 'body', { mat: 'fabric' })];
  parts.push(part(at(torus(0.02, 0.006, 4, 10), 0, h / 2, t / 2 - 0.01), 'accent', { cast: false })); // button
  return { parts, footprint: { w, d: t }, solid: false, anchors: {}, colors: { body: p.colors?.body ?? v.pick([T.rose, T.butter, T.lavender, T.trim]), accent: T.trim }, hero: 'corner pinch + button' };
}

/** Sticky note (story prop). */
export function buildNote(p: KitParams = {}, rng: Rng) {
  const v = vary(rng);
  return { parts: [part(at(rbox(0.07, 0.07, 0.004, 0.001), 0, 0, 0.002, 0, 0, v.r(-0.15, 0.15)), 'body', { mat: 'small', cast: false })], footprint: { w: 0.07, d: 0.01 }, solid: false, anchors: {}, colors: { body: p.colors?.body ?? v.pick(NOTES) }, small: true, hero: 'curl' };
}

/**
 * Framed print (wall art): generative Bauhaus shapes in palette tokens on a cream field. Origin = wall face centre.
 */
export function buildPoster(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 0.6, h = p.h ?? 0.8;
  const parts = [part(at(rbox(w, h, 0.035, 0.012), 0, 0, 0.018), 'secondary', { mat: 'wood' }), part(at(rbox(w - 0.07, h - 0.07, 0.006, 0.002), 0, 0, 0.037), 'body', { cast: false })];
  const pal = [T.tealDeep, T.butter, T.sage, T.lavender, T.teal, T.rose, T.walnut];
  const style = p.style ?? v.int(3);
  const iw = w - 0.16, ih = h - 0.16;
  if (style === 0) { // sun + hills
    parts.push(part(at(cyl(iw * 0.22, iw * 0.22, 0.004, 24), iw * 0.1, ih * 0.15, 0.043, PI / 2), 'accent', { color: T.butter, cast: false }));
    for (let i = 0; i < 3; i++) parts.push(part(at(cyl(iw * (0.5 - i * 0.1), iw * (0.5 - i * 0.1), 0.004, 24, false), -iw * 0.25 + i * iw * 0.25, -ih * 0.5 + 0.02, 0.044 + i * 0.001, PI / 2, 0, 0, 1, 1, 1), 'accent', { color: [T.tealDeep, T.sage, T.teal][i], cast: false }));
  } else if (style === 1) { // stacked blocks
    for (let i = 0; i < 4; i++) parts.push(part(at(rbox(iw * v.r(0.3, 0.7), ih * 0.18, 0.004), v.r(-iw * 0.2, iw * 0.2), -ih / 2 + ih * 0.12 + i * ih * 0.24, 0.043 + i * 0.001), 'accent', { color: v.pick(pal), cast: false }));
  } else { // circles
    for (let i = 0; i < 3; i++) { const r = iw * v.r(0.12, 0.26); parts.push(part(at(cyl(r, r, 0.004, 22), v.r(-iw * 0.3, iw * 0.3), v.r(-ih * 0.3, ih * 0.3), 0.043 + i * 0.001, PI / 2), 'accent', { color: v.pick(pal), cast: false })); }
  }
  // clip the art to the field (shapes may hang over): a cream mat frame on top
  const m = 0.035, fw = w - 0.07, fh = h - 0.07;
  parts.push(part(at(rbox(fw, m, 0.006), 0, fh / 2 - m / 2, 0.048), 'body', { cast: false }), part(at(rbox(fw, m, 0.006), 0, -fh / 2 + m / 2, 0.048), 'body', { cast: false }));
  parts.push(part(at(rbox(m, fh, 0.006), fw / 2 - m / 2, 0, 0.048), 'body', { cast: false }), part(at(rbox(m, fh, 0.006), -fw / 2 + m / 2, 0, 0.048), 'body', { cast: false }));
  return { parts, footprint: { w, d: 0.05 }, solid: false, anchors: {}, colors: { body: T.trim, secondary: T.walnut, accent: T.tealDeep }, hero: 'generative Bauhaus print' };
}

/** Easel (E2 art studio amenity, §7.2): A-frame, canvas with a painted blob, paint tray, a brush. */
export function buildEasel(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), H = p.h ?? 1.4;
  const parts: Part[] = [];
  for (const e of [-1, 1]) parts.push(part(at(rbox(0.035, H, 0.035, 0.01), e * 0.2, H / 2, 0.04, -0.08, 0, e * 0.12), 'body', { mat: 'wood' }));
  parts.push(part(at(rbox(0.035, H * 0.9, 0.035, 0.01), 0, H * 0.45, -0.22, 0.28), 'body', { mat: 'wood' }));
  parts.push(part(at(rbox(0.55, 0.03, 0.08, 0.01), 0, 0.62, 0.08), 'body', { mat: 'wood' }));
  parts.push(part(at(rbox(0.52, 0.6, 0.025, 0.006), 0, 0.95, 0.07, -0.08), 'secondary'));
  const paint = p.paint ?? v.pick([T.butter, T.teal, T.rose, T.lavender]);
  for (let i = 0; i < 3; i++) parts.push(part(at(sphere(v.r(0.06, 0.1), 10, 6), v.r(-0.12, 0.12), 0.95 + v.r(-0.12, 0.15), 0.085, -0.08, 0, 0, 1, v.r(0.7, 1.2), 0.08), 'accent', { color: i ? v.pick([T.butter, T.teal, T.rose, T.lavender, T.sage]) : paint, cast: false }));
  parts.push(part(at(capsule(0.006, 0.16, 2, 5), 0.18, 0.66, 0.1, 0, 0, 1.2), 'accent', { color: T.ink2, mat: 'small', cast: false }));
  return { parts, footprint: { w: 0.55, d: 0.45 }, solid: true, anchors: { canvas: [0, 0.95, 0.09] }, colors: { body: T.oak, secondary: T.trim, accent: paint }, hero: 'A-frame + painted canvas' };
}


/**
 * 32 · tote ([ENV fix r1] foreground story prop): a slumped canvas tote with two strap loops, a folded top and
 * something poking out (a rolled poster, a baguette or a book), set down against a planter or a bench leg.
 */
export function buildTote(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = 0.34, h = 0.36, d = 0.13;
  // a slumped bag: a rounded box whose top half leans and pinches (vertex warp), so it reads as soft canvas
  const g = rbox(w, h, d, 0.04, 2);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i) + h / 2, z = pos.getZ(i), t = y / h;
    pos.setXYZ(i, x * (1 - 0.1 * t) + 0.03 * t * t, y, z * (1 + 0.35 * Math.sin(t * PI) * (1 - t * 0.6)) + 0.04 * t * t);
  }
  g.computeVertexNormals();
  const parts = [part(g, 'body', { mat: 'fabric' })];
  parts.push(part(at(rbox(w * 0.92, 0.05, d * 1.25, 0.02), 0.03, h - 0.02, 0.04, 0.12), 'accent', { mat: 'fabric' })); // folded hem
  for (const e of [-1, 1]) parts.push(part(at(torus(0.075, 0.009, 5, 14, PI), e * 0.085 + 0.03, h - 0.01, 0.04 + e * 0.02, 0.2 * e, 0, 0), 'secondary', { cast: false }));
  parts.push(part(at(rbox(0.12, 0.1, 0.01, 0.004), -0.02, h * 0.45, d / 2 + 0.035), 'secondary', { cast: false })); // pocket patch
  const out = p.out ?? v.pick(['poster', 'bread', 'book']);
  if (out === 'poster') parts.push(part(at(cyl(0.035, 0.035, 0.42, 12), 0.08, h + 0.08, 0.03, 0, 0, -0.25), 'accent', { color: T.butter }));
  else if (out === 'bread') parts.push(part(at(capsule(0.035, 0.34, 3, 8), -0.06, h + 0.06, 0.02, 0.1, 0, 0.35), 'accent', { color: '#C89A5E' }));
  else parts.push(part(at(rbox(0.16, 0.2, 0.03, 0.006), 0.07, h + 0.02, 0.03, 0, 0.2, -0.15), 'accent', { color: T.rose }));
  return { parts, footprint: { r: 0.16 }, solid: false, anchors: {}, colors: { body: p.colors?.body ?? v.pick([T.linen, T.oat, '#B9C4B0']), secondary: T.tealDeep, accent: T.trim }, hero: `slumped canvas + straps, ${out} poking out` };
}
