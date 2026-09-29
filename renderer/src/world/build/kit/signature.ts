/**
 * Bespoke signature props (§7.5 "signature props … follow the same three rules"): the Pit hearth, the Big Board
 * housing (STAT draws the faces), the atrium arcade cabinet, the ping-pong table, the queue dais. Owner: ENV.
 */
import * as THREE from 'three';
import { rbox, cyl, lathe, sphere, capsule, tube, slab, at, part, vary } from './core.ts';
import type { KitParams, Part, Rng } from './core.ts';
import { T } from './tokens.ts';

const PI = Math.PI;

/**
 * Hearth (Pit centre): a ring of chunky clay stones round a dark bowl, crossed logs, swaying flames and embers
 * (`flame` class: foliage sway + warm emissive). Its lamp pool is the layout's `hearth` lamp anchor.
 */
export function buildHearth(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), R = (p.w ?? 1.4) / 2;
  const parts: Part[] = [];
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * PI * 2 + v.r(-0.05, 0.05), r = R - 0.16;
    const g = rbox(v.r(0.3, 0.36), v.r(0.2, 0.26), 0.24, 0.07, 2);
    parts.push(part(at(g, Math.sin(a) * r, 0.11, Math.cos(a) * r, v.r(-0.08, 0.08), a, v.r(-0.06, 0.06)), 'body'));
  }
  parts.push(part(lathe([[0, 0.02], [R - 0.2, 0.02], [R - 0.2, 0.2], [R - 0.26, 0.2], [R - 0.34, 0.08], [0, 0.07]], 24), 'body', { ao: 0.42 }));
  for (let i = 0; i < 12; i++) { const a = v.r(0, PI * 2), r = v.r(0.05, R - 0.36); parts.push(part(at(sphere(v.r(0.03, 0.05), 7, 5), Math.sin(a) * r, 0.08, Math.cos(a) * r, 0, 0, 0, 1, 0.6, 1), 'body', { ao: 0.5, cast: false })); }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * PI + 0.3;
    parts.push(part(at(capsule(0.05, 0.42, 3, 8), 0, 0.14 + i * 0.035, 0, PI / 2, a, 0.18 * (i % 2 ? 1 : -1)), 'secondary', { mat: 'wood' }));
    parts.push(part(at(cyl(0.048, 0.048, 0.01, 10), Math.sin(a) * 0.26, 0.14 + i * 0.035 + 0.05 * (i % 2 ? 1 : -1), Math.cos(a) * 0.26, PI / 2, a, 0), 'secondary', { color: T.oak, cast: false }));
  }
  // flames: teardrop lathes of varied height, gradient ember → flame by height
  const fl = [[0, 0, 0.5], [0.12, 0.06, 0.34], [-0.1, 0.08, 0.3], [0.03, -0.12, 0.28], [-0.05, -0.02, 0.22]];
  for (const [x, z, h] of fl) {
    const g = lathe([[0, 0], [0.07, 0.03], [0.085, 0.1], [0.06, h * 0.55], [0.025, h * 0.85], [0, h]].map(([r, y]) => [r * (0.6 + h), y]), 10);
    parts.push(part(at(g, x, 0.18, z, v.r(-0.1, 0.1), v.r(0, PI), v.r(-0.1, 0.1)), 'accent', { mat: 'flame', cast: false, ao: false, grad: [T.ember, T.flame, 0.2, 0.2 + h] }));
  }
  for (let i = 0; i < 7; i++) { const a = v.r(0, PI * 2), r = v.r(0.08, 0.3); parts.push(part(at(sphere(0.022, 6, 4), Math.sin(a) * r, 0.1, Math.cos(a) * r), 'accent', { mat: 'flame', cast: false, ao: false, color: T.ember })); }
  return { parts, footprint: { r: R }, solid: true, anchors: { fire: [0, 0.4, 0] }, colors: { body: T.stone, secondary: T.walnut, accent: T.flame }, hero: 'stone ring, crossed logs, swaying flames' };
}

/**
 * Big Board housing (over the Pit, faces drawn by STAT / the sign atlas): a chunky rounded ink block with walnut
 * cornice bands, recessed face panels, brass corner caps, four hanger cables up `hang` m to a ceiling plate.
 * Origin = the board's bottom centre.
 */
export function buildBigBoard(p: KitParams = {}, rng: Rng) {
  const w = p.w ?? 2.4, h = p.h ?? 1.4, hang = p.hang ?? 0.8;
  const parts = [part(at(rbox(w - 0.04, h, w - 0.04, 0.09, 2), 0, h / 2, 0), 'body')];
  for (const y of [0.04, h - 0.04]) parts.push(part(at(rbox(w + 0.06, 0.1, w + 0.06, 0.04, 2), 0, y, 0), 'secondary', { mat: 'wood' }));
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * PI * 2;
    parts.push(part(at(rbox(w - 0.3, h - 0.34, 0.02, 0.02), Math.sin(a) * (w / 2 - 0.02), h / 2, Math.cos(a) * (w / 2 - 0.02), 0, a), 'body', { ao: 0.7, cast: false }));
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    parts.push(part(at(sphere(0.07, 12, 8), sx * (w / 2 + 0.01), h + 0.02, sz * (w / 2 + 0.01)), 'accent'));
    parts.push(part(at(sphere(0.06, 12, 8), sx * (w / 2 + 0.01), -0.01, sz * (w / 2 + 0.01)), 'accent'));
    parts.push(part(at(cyl(0.008, 0.008, hang, 4), sx * (w / 2 - 0.2), h + hang / 2, sz * (w / 2 - 0.2)), 'secondary', { color: T.ink2, cast: false }));
  }
  parts.push(part(at(slab(w * 0.6, w * 0.6, 0.04, 0.1, 0.012), 0, h + hang - 0.04, 0), 'secondary', { mat: 'wood', cast: false }));
  parts.push(part(at(lathe([[0.3, 0], [0.26, 0.1], [0.12, 0.16], [0, 0.17]], 16), 0, h + 0.09, 0), 'accent')); // a brass crown dome
  return { parts, footprint: { w, d: w }, solid: false, anchors: {}, colors: { body: T.ink, secondary: T.walnut, accent: T.brass }, hero: 'cornice bands, brass corner caps + crown' };
}

/** Arcade cabinet: curvy side panels, marquee, tilted screen with attract-mode pixels, joystick + buttons. */
export function buildArcade(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 0.8, h = p.h ?? 1.6, d = p.d ?? 0.6;
  const s = new THREE.Shape();
  s.moveTo(-d / 2, 0); s.lineTo(d / 2, 0); s.lineTo(d / 2, 0.85); s.lineTo(d / 2 + 0.08, 0.92); s.lineTo(d / 2 - 0.05, 1.05);
  s.lineTo(d / 2 - 0.14, 1.45); s.lineTo(d / 2 - 0.05, h); s.lineTo(-d / 2, h); s.lineTo(-d / 2, 0);
  const side = new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 1, curveSegments: 3 });
  const parts: Part[] = [];
  for (const e of [-1, 1]) parts.push(part(at(side.clone(), e * (w / 2 - 0.02) - 0.02, 0, 0, 0, -PI / 2, 0), 'body'));
  parts.push(part(at(rbox(w - 0.08, h, d - 0.1, 0.02), 0, h / 2, -0.05), 'body', { ao: 0.85 }));
  parts.push(part(at(rbox(w - 0.04, 0.16, 0.12, 0.02), 0, h - 0.08, d / 2 - 0.06), 'accent')); // marquee
  parts.push(part(at(rbox(w - 0.12, 0.34, 0.03, 0.01), 0, 1.24, d / 2 - 0.1, -0.22), 'secondary'));
  for (let i = 0; i < 9; i++) parts.push(part(at(rbox(0.03, 0.03, 0.006), v.r(-0.2, 0.2), 1.24 + v.r(-0.12, 0.12), d / 2 - 0.08, -0.22), 'accent', { color: v.pick([T.butter, T.teal, T.rose, T.trim]), cast: false }));
  parts.push(part(at(rbox(w - 0.06, 0.05, 0.22, 0.015), 0, 0.93, d / 2 - 0.02, 0.2), 'secondary'));
  parts.push(part(at(cyl(0.008, 0.008, 0.07, 6), -0.15, 0.98, d / 2 - 0.02), 'secondary'));
  parts.push(part(at(sphere(0.025, 10, 6), -0.15, 1.02, d / 2 - 0.02), 'accent', { color: T.rose }));
  for (let i = 0; i < 3; i++) parts.push(part(at(cyl(0.018, 0.018, 0.02, 10), 0.03 + i * 0.07, 0.96, d / 2 - 0.02 + (i % 2) * 0.03, 0.2), 'accent', { color: [T.butter, T.teal, T.trim][i], cast: false }));
  parts.push(part(at(rbox(0.12, 0.08, 0.01, 0.004), 0, 0.5, d / 2 - 0.045), 'accent', { cast: false })); // coin door
  return { parts, footprint: { w, d }, solid: true, anchors: {}, colors: { body: '#3A3F5C', secondary: T.ink, accent: T.butter }, hero: 'curvy side panels, joystick + buttons, marquee' };
}

/** Ping-pong table: teal top with cream lines, net, X-frame legs, two paddles and a ball. */
export function buildPingPong(p: KitParams = {}, rng: Rng) {
  const w = p.w ?? 0.85, d = p.d ?? 1.5, h = p.h ?? 0.76;
  const parts = [part(at(slab(w, d, 0.03, 0.02, 0.008), 0, h - 0.03, 0), 'body')];
  for (const [x, z, lw, ld] of [[0, -d / 2 + 0.01, w - 0.02, 0.012], [0, d / 2 - 0.01, w - 0.02, 0.012], [-w / 2 + 0.01, 0, 0.012, d - 0.02], [w / 2 - 0.01, 0, 0.012, d - 0.02], [0, 0, 0.006, d - 0.02]]) parts.push(part(at(rbox(lw, 0.003, ld), x, h + 0.001, z), 'accent', { cast: false }));
  parts.push(part(at(rbox(w + 0.08, 0.12, 0.012, 0.004), 0, h + 0.06, 0), 'secondary'));
  parts.push(part(at(rbox(w + 0.08, 0.012, 0.016, 0.004), 0, h + 0.12, 0), 'accent', { cast: false }));
  for (const e of [-1, 1]) for (const f of [-1, 1]) parts.push(part(at(rbox(0.035, h * 1.12, 0.035, 0.01), e * (w / 2 - 0.1), (h - 0.03) / 2, f * d * 0.28, f * 0.32, 0, 0), 'secondary'));
  // [INT M2, cross-owner ENV] `props:false`: no resting paddles / ball (BRN's rally holds real paddles + a live ball)
  if (p.props !== false) for (const e of [-1, 1]) {
    parts.push(part(at(cyl(0.075, 0.075, 0.012, 16), e * 0.18, h + 0.008, e * 0.45, 0, 0, 0), 'accent', { color: T.rose, cast: false }));
    parts.push(part(at(rbox(0.03, 0.02, 0.09, 0.006), e * 0.18, h + 0.012, e * 0.45 + e * 0.1), 'secondary', { color: T.walnut, cast: false }));
  }
  if (p.props !== false) parts.push(part(at(sphere(0.02, 8, 6), 0.1, h + 0.02, -0.2), 'accent', { cast: false }));
  return { parts, footprint: { w, d }, solid: true, anchors: {}, colors: { body: '#2F6A5A', secondary: T.ink2, accent: T.trim }, hero: 'net, paddles + ball' };
}

/** Queue dais: a low walnut platform with a slate-teal mat top and a brass nosing along its open edges. */
export function buildDais(p: KitParams = {}, rng: Rng) {
  const w = p.w ?? 3, d = p.d ?? 1.8, h = p.h ?? 0.15;
  const parts = [
    part(at(rbox(w, h - 0.012, d, 0.03, 1), 0, (h - 0.012) / 2, 0), 'secondary', { mat: 'wood' }),
    part(at(slab(w - 0.06, d - 0.06, 0.014, 0.03, 0.004), 0, h - 0.012, 0), 'body', { mat: 'fabric', ao: false, cast: false }),
    part(at(rbox(w + 0.004, 0.02, 0.03, 0.008), 0, h - 0.01, d / 2 - 0.01), 'accent', { cast: false }),
    part(at(rbox(w + 0.004, 0.02, 0.03, 0.008), 0, h - 0.01, -d / 2 + 0.01), 'accent', { cast: false }),
    part(at(rbox(0.03, 0.02, d + 0.004, 0.008), w / 2 - 0.01, h - 0.01, 0), 'accent', { cast: false }),
    part(at(rbox(0.03, 0.02, d + 0.004, 0.008), -w / 2 + 0.01, h - 0.01, 0), 'accent', { cast: false }),
  ];
  return { parts, footprint: { w, d }, solid: false, anchors: { top: h }, colors: { body: '#4E6E6E', secondary: T.walnut, accent: T.brass }, hero: 'brass nosing' };
}

/** Hammock (E3 nap lounge): walnut posts, cream rope ties, a sagging sage sling with a pillow. */
export function buildHammock(p: KitParams = {}, rng: Rng) {
  const w = p.w ?? 2.0, d = p.d ?? 0.6, H = 1.1, sag = 0.28, y0 = 0.62;
  const parts: Part[] = [];
  for (const e of [-1, 1]) {
    parts.push(part(at(cyl(0.035, 0.05, H, 10), e * w / 2, H / 2, 0), 'secondary', { mat: 'wood' }));
    parts.push(part(at(rbox(0.14, 0.04, 0.5, 0.015), e * w / 2, 0.02, 0), 'secondary', { mat: 'wood' }));
    parts.push(part(at(sphere(0.045, 10, 6), e * w / 2, H + 0.02, 0), 'secondary', { mat: 'wood' }));
    for (const s of [-1, 1]) parts.push(part(tube([[e * w / 2, H - 0.12, 0], [e * (w / 2 - 0.2), y0 + 0.05, s * (d / 2 - 0.08)]], 0.008, 2, 4), 'accent', { cast: false }));
  }
  const L = w - 0.4, g = new THREE.BoxGeometry(L, 0.025, d - 0.08, 14, 1, 3), pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getZ(i); pos.setY(i, pos.getY(i) + y0 - sag * (1 - (2 * x / L) ** 2) + Math.abs(z) ** 2 * 1.2); }
  g.computeVertexNormals();
  parts.push(part(g, 'body', { mat: 'fabric' }));
  parts.push(part(at(rbox(0.32, 0.1, 0.4, 0.045, 2), -L / 2 + 0.3, y0 - sag * 0.55 + 0.06, 0, 0, 0, -0.35), 'accent', { mat: 'fabric' }));
  return { parts, footprint: { w, d }, solid: false, anchors: {}, colors: { body: T.sage, secondary: T.walnut, accent: T.trim }, hero: 'sagging sling + pillow' };
}

/** Game table (E1 game room): a low meeting table with a board game mid-play, dice and a card fan. */
export function buildGameTable(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 1.1, d = p.d ?? 0.6, h = p.h ?? 0.45;
  const parts = [part(at(slab(w, d, 0.04, 0.05, 0.012), 0, h - 0.04, 0), 'body', { mat: 'wood' })];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(part(at(cyl(0.022, 0.015, h - 0.04, 8), sx * (w / 2 - 0.07), (h - 0.04) / 2, sz * (d / 2 - 0.07)), 'secondary'));
  parts.push(part(at(rbox(0.36, 0.012, 0.36, 0.004), 0, h + 0.006, 0, 0, 0.2), 'secondary', { color: T.tealDeep, cast: false }));
  for (let i = 0; i < 6; i++) parts.push(part(at(lathe([[0, 0], [0.018, 0], [0.014, 0.02], [0.008, 0.03], [0.012, 0.038], [0, 0.04]], 8), v.r(-0.14, 0.14), h + 0.012, v.r(-0.14, 0.14)), 'accent', { color: i % 2 ? T.trim : T.butter, mat: 'small' }));
  for (let i = 0; i < 2; i++) parts.push(part(at(rbox(0.03, 0.03, 0.03, 0.004), 0.3 + i * 0.05, h + 0.015, 0.12, 0, v.r(0, 1)), 'accent', { color: T.trim, mat: 'small' }));
  for (let i = 0; i < 4; i++) parts.push(part(at(rbox(0.06, 0.002, 0.09), -0.33 + i * 0.015, h + 0.002 + i * 0.002, -0.1, 0, -0.4 + i * 0.25), 'accent', { color: i % 2 ? T.rose : T.trim, mat: 'small', cast: false }));
  return { parts, footprint: { w, d }, solid: true, anchors: { top: h }, colors: { body: T.oak, secondary: T.ink2, accent: T.butter }, hero: 'board game mid-play, dice, card fan' };
}
