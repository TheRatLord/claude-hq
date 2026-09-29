/**
 * Prop kit: Lobby + Help Desk + Plaza builders (ENV M2 breadth, §7.1 LOB/PLZ, §7.5 rules: bevels, ≤ 3 tokens, one
 * hero detail each). The Lobby's signature prop is the Help Desk (pill-shaped walnut teller counter with a brass
 * "?" medallion, §5.5 "Help Desk walnut 38 + brass"). The Plaza's phone booths are ENV 3/5's (stacks.ts); the Plaza
 * reuses the Studio Street bicycle / mailbox (street.ts). Owner: ENV.
 */
import * as THREE from 'three';
import { rbox, cyl, lathe, sphere, capsule, torus, tube, slab, disc, at, part, vary } from './core.ts';
import type { KitParams, Part, PartOpts, Rng, SheetEntry, SlotName } from './core.ts';
import { T } from './tokens.ts';

const PI = Math.PI;
/** Verdigris bronze (the lobby statue), L* 60, h 170°: cool, reads as "statue", never as a clay character. */
export const PATINA = '#6E9A8B';
/** Felt of the letter board / chalk of the menu board (deep slate-green, L* 30). */
const FELT = '#3C4845';

/**
 * Help Desk (Lobby signature): a pill-shaped walnut teller counter (bull-nosed ends), a walnut top on a brass nosing with an overhanging
 * lip, raised front panels, a brass "?" medallion, a brass foot rail on brackets, and on top the desk bell (`bell`
 * anchor = layout POINTS.bell), a take-a-number dispenser and the NOW SERVING stand (the sign atlas quad sits on its
 * front face, greybox.ts). Staff side (−z): a work ledge with paper stacks. Front = +z (the queue side).
 */
export function buildHelpDesk(p: KitParams = {}, rng: Rng) {
  const w = p.w ?? 2.5, h = p.h ?? 0.62, d = p.d ?? 0.6;
  const L = w - d, dd = d - 0.07, bh = h - 0.1, fz = dd / 2;
  const parts: Part[] = [];
  // plinth (recessed toe kick), straight body, bull-nosed ends
  parts.push(part(at(rbox(L + 0.02, 0.06, dd - 0.1, 0.02), 0, 0.03, 0), 'body', { mat: 'wood', ao: 0.55 }));
  for (const e of [-1, 1]) parts.push(part(at(cyl((dd - 0.1) / 2, (dd - 0.1) / 2, 0.06, 20), e * L / 2, 0.03, 0), 'body', { mat: 'wood', ao: 0.55 }));
  parts.push(part(at(rbox(L, bh, dd, 0.02), 0, 0.05 + bh / 2, 0), 'body', { mat: 'wood' }));
  for (const e of [-1, 1]) parts.push(part(at(cyl(dd / 2, dd / 2, bh, 24), e * L / 2, 0.05 + bh / 2, 0), 'body', { mat: 'wood' }));
  // [LVL m3 fix r2, cross-owner ENV] walnut top (§5.5 "Help Desk walnut 38 + brass"; the cream top read as a flat,
  // blown-out slab across the bottom 40 % of the serve / walk-up frames, art review m3-r2) on a bevelled brass nosing
  // that shows as a bright line round the lip
  parts.push(part(at(slab(w + 0.05, d + 0.05, 0.05, (d + 0.05) / 2 - 0.002, 0.016, 10), 0, h - 0.05, 0), 'body', { mat: 'wood' }));
  parts.push(part(at(slab(w + 0.075, d + 0.075, 0.032, (d + 0.075) / 2 - 0.002, 0.012, 10), 0, h - 0.046, 0), 'accent', { cast: false }));
  // brass inlay band under the lip (front run) + raised front panels (the middle one carries the medallion)
  parts.push(part(at(rbox(L, 0.018, 0.012, 0.004), 0, h - 0.085, fz + 0.004), 'accent', { cast: false }));
  const n = 3, pw = L / n;
  for (let i = 0; i < n; i++) parts.push(part(at(rbox(pw - 0.09, bh - 0.2, 0.018, 0.008), -L / 2 + (i + 0.5) * pw, 0.05 + bh / 2 - 0.01, fz + 0.006), 'body', { mat: 'wood', ao: 0.84 }));
  const my = 0.05 + bh / 2, mz = fz + 0.022;
  parts.push(part(at(torus(0.1, 0.012, 6, 28), 0, my, mz), 'accent'));
  parts.push(part(tube([[-0.036, my + 0.035, mz], [-0.02, my + 0.062, mz], [0.018, my + 0.064, mz], [0.036, my + 0.036, mz], [0.012, my + 0.006, mz], [0, my - 0.018, mz], [0, my - 0.036, mz]], 0.011, 14, 6), 'accent'));
  parts.push(part(at(sphere(0.014, 10, 8), 0, my - 0.066, mz), 'accent'));
  // brass foot rail on three brackets (front straight run)
  parts.push(part(at(cyl(0.014, 0.014, L + 0.1, 10), 0, 0.14, fz + 0.075, 0, 0, PI / 2), 'accent'));
  for (const x of [-L / 2, 0, L / 2]) parts.push(part(at(rbox(0.024, 0.024, 0.08, 0.008), x, 0.14, fz + 0.035), 'accent'));
  // staff side: a work ledge on brackets, three paper stacks, a pen cup
  parts.push(part(at(rbox(L - 0.1, 0.025, 0.16, 0.01), 0, h - 0.24, -fz - 0.08), 'body', { mat: 'wood' }));
  for (const x of [-L / 2 + 0.1, L / 2 - 0.1]) parts.push(part(at(rbox(0.025, 0.1, 0.14, 0.008), x, h - 0.3, -fz - 0.07), 'body', { mat: 'wood', ao: 0.8 }));
  for (const [x, t] of [[-0.5, 0.04], [0.3, 0.025]]) parts.push(part(at(rbox(0.2, t, 0.12, 0.006), x, h - 0.2275 + t / 2, -fz - 0.08, 0, x * 0.3), 'secondary', { cast: false }));
  for (let i = 0; i < 4; i++) parts.push(part(at(rbox(0.035, 0.17, 0.13, 0.006), -0.12 + i * 0.04, h - 0.2275 + 0.085, -fz - 0.08, 0, 0, i === 3 ? -0.25 : 0), 'body', { color: [T.tealDeep, T.sage, T.tealDeep, T.butter][i] })); // binders
  parts.push(part(at(lathe([[0, 0], [0.03, 0], [0.032, 0.08], [0.026, 0.08], [0.024, 0.006], [0, 0.006]], 12), 0.62, h - 0.2275, -fz - 0.08), 'body', { mat: 'small' }));
  for (const e of [-1, 1]) parts.push(part(at(cyl(0.004, 0.004, 0.12, 5), 0.62 + e * 0.01, h - 0.2275 + 0.1, -fz - 0.08, e * 0.15, 0, e * 0.2), 'accent', { mat: 'small', cast: false }));
  // desk bell (walnut base, brass dome, plunger) at the layout's bell point
  const bx = p.bellX ?? -0.65;
  parts.push(part(at(disc(0.05, 0.016, 16, 0.005), bx, h, 0), 'body', { mat: 'small' }));
  parts.push(part(at(lathe([[0.042, 0], [0.041, 0.012], [0.034, 0.03], [0.02, 0.041], [0, 0.044]], 16), bx, h + 0.016, 0), 'accent', { mat: 'small' }));
  parts.push(part(at(cyl(0.004, 0.004, 0.02, 6), bx, h + 0.066, 0), 'accent', { mat: 'small' }));
  parts.push(part(at(sphere(0.009, 8, 6), bx, h + 0.078, 0), 'accent', { mat: 'small' }));
  // take-a-number dispenser on a brass post (east end, customer side)
  const tx = -1.08, tz = 0.12;
  parts.push(part(at(disc(0.05, 0.012, 14, 0.004), tx, h, tz), 'accent', { mat: 'small' }));
  parts.push(part(at(cyl(0.01, 0.01, 0.16, 8), tx, h + 0.09, tz), 'accent', { mat: 'small' }));
  parts.push(part(at(cyl(0.055, 0.055, 0.06, 18), tx, h + 0.2, tz, PI / 2), 'secondary', { mat: 'small' }));
  parts.push(part(at(torus(0.055, 0.006, 4, 18), tx, h + 0.2, tz + 0.03), 'accent', { mat: 'small', cast: false }));
  parts.push(part(at(rbox(0.035, 0.05, 0.003, 0.001), tx, h + 0.15, tz + 0.035, 0.3), 'secondary', { mat: 'small', cast: false })); // a ticket tongue
  // NOW SERVING stand (the sign atlas text quad is 5 mm in front of the board face)
  const sx = p.servingX ?? 0.95;
  parts.push(part(at(rbox(0.5, 0.16, 0.03, 0.012), sx, h + 0.12, 0.18), 'body', { mat: 'wood' }));
  for (const e of [-1, 1]) parts.push(part(at(rbox(0.05, 0.04, 0.09, 0.012), sx + e * 0.2, h + 0.02, 0.17), 'accent'));
  return { parts, footprint: { w, d }, solid: true, anchors: { top: h, bell: [bx, h, 0] }, colors: { body: T.walnut, secondary: T.trim, accent: T.brass }, hero: 'pill counter, brass ? medallion + foot rail, desk bell' };
}

/** Service light (the counter's `beacon`): walnut foot, brass stem, a butter mushroom shade that glows after dark. */
export function buildServiceLight(p: KitParams = {}, rng: Rng) {
  const parts = [
    part(lathe([[0, 0], [0.06, 0], [0.062, 0.01], [0.04, 0.03], [0, 0.032]], 16), 'body', { mat: 'small' }),
    part(at(cyl(0.008, 0.01, 0.14, 8), 0, 0.1, 0), 'accent', { mat: 'small' }),
    part(at(lathe([[0.075, 0], [0.07, 0.02], [0.05, 0.05], [0.02, 0.065], [0, 0.068]], 24), 0, 0.16, 0), 'secondary', { mat: 'shade', cast: false }),
    part(at(sphere(0.022, 12, 8), 0, 0.165, 0), 'bulb', { mat: 'bulb', cast: false }),
    part(at(sphere(0.012, 8, 6), 0, 0.235, 0), 'accent', { mat: 'small' }),
  ];
  return { parts, footprint: { r: 0.07 }, solid: false, anchors: { bulb: [0, 0.165, 0] }, colors: { body: T.walnut, secondary: T.butter, accent: T.brass }, hero: 'mushroom shade on a brass stem' };
}

/**
 * Lobby fish tank (AMB's fish swim inside: water y 0.74–1.26, footprint inset 0.06, front = +z, no opaque front):
 * walnut cabinet with doors, slim ink frame, a teal → aqua painted backdrop, a sand bed with pebbles, a tiny castle
 * and a treasure chest, and a walnut hood. The front and sides stay open (no glass pane in the kit).
 */
export function buildFishTank(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 1.6, d = p.d ?? 0.5;
  const parts: Part[] = [];
  parts.push(part(at(rbox(w, 0.62, d, 0.03, 1), 0, 0.06 + 0.31, 0), 'body', { mat: 'wood' }));
  parts.push(part(at(rbox(w - 0.08, 0.06, d - 0.08, 0.02), 0, 0.03, 0), 'body', { mat: 'wood', ao: 0.5 }));
  for (const e of [-1, 1]) {
    parts.push(part(at(rbox(w / 2 - 0.1, 0.46, 0.016, 0.008), e * (w / 4 - 0.01), 0.37, d / 2 + 0.004), 'body', { mat: 'wood', ao: 0.85 }));
    parts.push(part(at(sphere(0.018, 10, 8), e * 0.06, 0.42, d / 2 + 0.02), 'accent'));
  }
  // frame: bottom + top rails, corner posts
  parts.push(part(at(rbox(w, 0.05, d, 0.012), 0, 0.705, 0), 'secondary'));
  parts.push(part(at(rbox(w, 0.03, d, 0.01), 0, 1.285, 0), 'secondary'));
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(part(at(rbox(0.03, 0.56, 0.03, 0.008), sx * (w / 2 - 0.015), 1.0, sz * (d / 2 - 0.015)), 'secondary'));
  // backdrop (deep teal at the sand → aqua at the surface) and a sand bed
  parts.push(part(at(rbox(w - 0.05, 0.55, 0.012, 0.004), 0, 1.0, -d / 2 + 0.022), 'secondary', { grad: [T.tealDeep, T.bottle, 0.73, 1.27], ao: false }));
  parts.push(part(at(slab(w - 0.05, d - 0.05, 0.03, 0.02, 0.008), 0, 0.73, 0), 'secondary', { color: T.sand, ao: 0.9 }));
  for (let i = 0; i < 9; i++) parts.push(part(at(sphere(v.r(0.014, 0.026), 7, 5), v.r(-w / 2 + 0.08, w / 2 - 0.08), 0.765, v.r(-d / 2 + 0.06, d / 2 - 0.06), 0, 0, 0, 1, 0.6, 1), 'secondary', { color: v.pick([T.oat, T.stone, T.lavender]), cast: false, mat: 'small' }));
  // a tiny castle (stone, a rose cone roof) and a treasure chest
  const cx = -w * 0.28, cz = -0.06;
  parts.push(part(at(cyl(0.06, 0.07, 0.17, 12), cx, 0.845, cz), 'secondary', { color: T.stone }));
  for (let k = 0; k < 4; k++) parts.push(part(at(rbox(0.035, 0.035, 0.035, 0.006), cx + Math.sin(k * PI / 2) * 0.05, 0.945, cz + Math.cos(k * PI / 2) * 0.05), 'secondary', { color: T.stone }));
  parts.push(part(at(cyl(0.035, 0.04, 0.12, 10), cx + 0.1, 0.82, cz + 0.05), 'secondary', { color: T.stone }));
  parts.push(part(at(cyl(0.0, 0.05, 0.08, 10), cx + 0.1, 0.92, cz + 0.05), 'secondary', { color: T.rose }));
  parts.push(part(at(rbox(0.09, 0.05, 0.06, 0.01), w * 0.26, 0.785, 0.06, 0, 0.4), 'body', { mat: 'wood' }));
  parts.push(part(at(rbox(0.095, 0.012, 0.065, 0.004), w * 0.26, 0.815, 0.06, 0, 0.4), 'accent', { cast: false }));
  // hood with a brass lip
  parts.push(part(at(slab(w + 0.03, d + 0.03, 0.09, 0.035, 0.015), 0, 1.3, 0), 'body', { mat: 'wood' }));
  parts.push(part(at(rbox(w - 0.1, 0.014, 0.01, 0.004), 0, 1.345, d / 2 + 0.017), 'accent', { cast: false }));
  return { parts, footprint: { w, d }, solid: true, anchors: { water: [0, 1.0, 0] }, colors: { body: T.walnut, secondary: T.ink2, accent: T.brass }, hero: 'painted backdrop, castle + treasure chest, open front' };
}

/**
 * Lobby coffee cart: walnut cart on two spoked wheels, a brass espresso machine with a dome (AMB's steam vent sits
 * on it: local x 0.3, y ≈ 1.12), a stack of cups, a bean jar, a striped butter/cream awning with a scalloped valance,
 * a brass push bar. Front = +z (the coffee slots).
 */
export function buildCoffeeCart(p: KitParams = {}, rng: Rng) {
  const w = p.w ?? 1.3, d = p.d ?? 0.55, top = 0.9;
  const parts: Part[] = [];
  parts.push(part(at(rbox(w - 0.1, 0.7, d - 0.08, 0.03, 1), 0, 0.16 + 0.35, 0), 'body', { mat: 'wood' }));
  for (const e of [-1, 1]) parts.push(part(at(rbox((w - 0.1) / 2 - 0.08, 0.5, 0.016, 0.008), e * ((w - 0.1) / 4), 0.5, (d - 0.08) / 2 + 0.006), 'body', { mat: 'wood', ao: 0.85 }));
  parts.push(part(at(torus(0.07, 0.01, 5, 20), 0, 0.52, (d - 0.08) / 2 + 0.02), 'accent'));
  parts.push(part(at(slab(w, d + 0.04, 0.04, 0.03, 0.012), 0, top - 0.04, 0), 'body', { mat: 'wood' }));
  // two spoked wheels (east end), two peg feet (west end)
  for (const e of [-1, 1]) {
    const x = w / 2 - 0.26, z = e * (d / 2 - 0.0);
    parts.push(part(at(torus(0.15, 0.022, 6, 24), x, 0.17, z), 'body', { mat: 'wood' }));
    for (let k = 0; k < 4; k++) parts.push(part(at(cyl(0.008, 0.008, 0.28, 5), x, 0.17, z, 0, 0, k * PI / 4), 'accent'));
    parts.push(part(at(cyl(0.03, 0.03, 0.05, 10), x, 0.17, z, PI / 2), 'accent'));
    parts.push(part(at(cyl(0.025, 0.02, 0.16, 8), -w / 2 + 0.1, 0.08, e * (d / 2 - 0.08)), 'body', { mat: 'wood' }));
  }
  // brass push bar (west end)
  parts.push(part(tube([[-w / 2 + 0.02, top - 0.15, -d / 2 + 0.06], [-w / 2 - 0.1, top - 0.1, -d / 2 + 0.06], [-w / 2 - 0.1, top - 0.1, d / 2 - 0.06], [-w / 2 + 0.02, top - 0.15, d / 2 - 0.06]], 0.013, 12, 6), 'accent'));
  // espresso machine (brass), group head, two cups under the spout
  const mx = 0.3;
  parts.push(part(at(rbox(0.3, 0.18, 0.26, 0.05, 2), mx, top + 0.09, -0.04), 'accent'));
  parts.push(part(at(lathe([[0.1, 0], [0.09, 0.05], [0.05, 0.09], [0.015, 0.1], [0.02, 0.12], [0, 0.125]], 16), mx, top + 0.18, -0.04), 'accent'));
  parts.push(part(at(cyl(0.03, 0.025, 0.05, 10), mx, top + 0.06, 0.11), 'secondary'));
  for (const e of [-1, 1]) parts.push(part(at(lathe([[0, 0], [0.022, 0], [0.026, 0.045], [0.02, 0.045], [0.018, 0.006], [0, 0.006]], 10), mx + e * 0.05, top, 0.12), 'secondary', { mat: 'small' }));
  // stack of cups + bean jar
  for (let k = 0; k < 4; k++) parts.push(part(at(lathe([[0.03, 0], [0.036, 0.055], [0.03, 0.055], [0.026, 0.004]], 10), -0.3, top + k * 0.035, 0.08), 'secondary', { mat: 'small', ao: k ? 1 : 0.9 }));
  parts.push(part(at(lathe([[0, 0], [0.05, 0], [0.055, 0.12], [0.035, 0.14], [0.035, 0.16], [0, 0.16]], 14), -0.08, top, 0.02), 'body', { mat: 'small' }));
  // awning: posts, striped canopy (butter / cream), scalloped valance
  for (const e of [-1, 1]) parts.push(part(at(cyl(0.013, 0.013, 0.95, 8), e * (w / 2 - 0.05), top + 0.47, -d / 2 + 0.05), 'accent'));
  const ns = 6, sw = (w + 0.2) / ns, tilt = 0.32, cd = d + 0.3, y0 = top + 0.9, lipY = y0 - (cd / 2) * Math.sin(tilt), lipZ = 0.07 + (cd / 2) * Math.cos(tilt);
  for (let k = 0; k < ns; k++) {
    const x = -(w + 0.2) / 2 + (k + 0.5) * sw, color = k % 2 ? T.trim : undefined; // butter / cream stripes
    parts.push(part(at(rbox(sw + 0.002, 0.025, cd, 0.01), x, y0, 0.07, tilt), 'secondary', { mat: 'fabric', color }));
    // a hanging half-disc scallop under each stripe's lip (flat side up)
    const sc = new THREE.CylinderGeometry(sw / 2, sw / 2, 0.018, 12, 1, false, -PI / 2, PI).rotateX(PI / 2);
    parts.push(part(at(sc, x, lipY - 0.006, lipZ), 'secondary', { mat: 'fabric', color, cast: false }));
  }
  return { parts, footprint: { w, d }, solid: true, anchors: { steam: [mx, top + 0.22, -0.04] }, colors: { body: T.walnut, secondary: T.butter, accent: T.brass }, hero: 'striped scalloped awning, brass espresso dome, spoked wheels' };
}

/** A-frame chalk menu board (walnut frame, slate-green chalk face, cream chalk lines + a cup doodle). */
export function buildMenuBoard(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), h = 0.7, w = 0.42;
  const parts: Part[] = [];
  for (const e of [-1, 1]) {
    const rx = e * 0.2, z = e * 0.07, F = (g: THREE.BufferGeometry) => at(g, 0, h / 2, z, rx); // panel frame → world (pivot at the panel centre)
    parts.push(part(F(rbox(w, h, 0.03, 0.012)), 'body', { mat: 'wood' }));
    parts.push(part(F(rbox(w - 0.08, h - 0.12, 0.006, 0.002).translate(0, 0.02, e * 0.018)), 'secondary', { cast: false }));
    if (e < 0) continue;
    for (let k = 0; k < 4; k++) parts.push(part(F(rbox(v.r(0.12, 0.26), 0.014, 0.003, 0.001).translate(v.r(-0.04, 0.03), 0.08 - k * 0.07, 0.022)), 'accent', { cast: false, mat: 'small' }));
    parts.push(part(F(torus(0.045, 0.006, 4, 14).translate(0.02, 0.2, 0.023)), 'accent', { cast: false }));
  }
  return { parts, footprint: { w, d: 0.3 }, solid: true, anchors: {}, colors: { body: T.walnut, secondary: FELT, accent: T.trim }, hero: 'A-frame + chalk doodle' };
}

/** Plaza map signpost: walnut post, brass finial, four cream arrow boards (teal tips) pointing at the zones. */
export function buildSignpost(p: KitParams = {}, rng: Rng) {
  const h = p.h ?? 2.2;
  const parts = [part(at(rbox(0.09, h - 0.1, 0.09, 0.02), 0, (h - 0.1) / 2, 0), 'body', { mat: 'wood' })];
  parts.push(part(at(rbox(0.2, 0.1, 0.2, 0.03), 0, 0.05, 0), 'body', { mat: 'wood', ao: 0.8 }));
  parts.push(part(at(lathe([[0.06, 0], [0.065, 0.02], [0.03, 0.05], [0.05, 0.1], [0.03, 0.15], [0, 0.16]], 14), 0, h - 0.1, 0), 'accent'));
  const arrow = (len: number, hh: number) => {
    const s = new THREE.Shape();
    s.moveTo(0, -hh / 2); s.lineTo(len - hh * 0.6, -hh / 2); s.lineTo(len, 0); s.lineTo(len - hh * 0.6, hh / 2); s.lineTo(0, hh / 2); s.lineTo(0, -hh / 2);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.028, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.005, bevelSegments: 1 });
    return g.translate(0, 0, -0.014);
  };
  const boards = p.boards ?? [[PI / 2, 0.62], [0.05, 0.55], [PI - 0.3, 0.5], [-0.8, 0.5]];
  boards.forEach(([yaw, len], i) => {
    const y = h - 0.3 - i * 0.2;
    parts.push(part(at(arrow(len, 0.14).translate(0.045, 0, 0), 0, y, 0, 0, yaw), 'secondary'));
    const c = Math.cos(yaw), sn = Math.sin(yaw), tx = 0.045 + len - 0.1;
    parts.push(part(at(rbox(0.03, 0.15, 0.036, 0.006), tx * c, y, -tx * sn, 0, yaw), 'accent', { cast: false }));
    for (let k = 0; k < 3; k++) { const lx = 0.12 + k * 0.1; parts.push(part(at(rbox(0.07, 0.018, 0.034, 0.002), lx * c, y, -lx * sn, 0, yaw), 'body', { cast: false, mat: 'small' })); }
  });
  return { parts, footprint: { w: 0.3, d: 0.3 }, collider: { r: 0.15 }, solid: true, anchors: {}, colors: { body: T.walnut, secondary: T.trim, accent: T.teal }, hero: 'four arrow boards + brass finial' };
}

/** Roomba dock: a low pad with a rounded back plate and a charge LED (flat: never a nav obstacle). */
export function buildRoombaDock(p: KitParams = {}, rng: Rng) {
  const parts = [
    part(slab(0.42, 0.34, 0.012, 0.08, 0.004), 'secondary', { ao: false, cast: false }),
    part(at(rbox(0.32, 0.13, 0.07, 0.03, 2), 0, 0.075, -0.15), 'body'),
    part(at(rbox(0.18, 0.02, 0.012, 0.006), 0, 0.11, -0.112), 'accent', { cast: false }),
    part(at(sphere(0.012, 8, 6), 0.1, 0.11, -0.11), 'bulb', { mat: 'bulb', cast: false }),
  ];
  return { parts, footprint: { w: 0.42, d: 0.34 }, solid: false, anchors: {}, colors: { body: T.oat, secondary: T.ink2, accent: T.teal }, hero: 'back plate + charge LED' };
}

/**
 * The lobby mascot: a verdigris-bronze Clawd on a walnut plinth, one arm up in a wave, with a brass plaque. Cool
 * patina (h 170°), so it never reads as a live clay agent (§5.5 channel separation).
 */
export function buildClawdStatue(p: KitParams = {}, rng: Rng) {
  const ph = p.plinth ?? 0.5, s = p.s ?? 1.15;
  const parts: Part[] = [];
  parts.push(part(at(rbox(0.62, ph - 0.06, 0.52, 0.03), 0, (ph - 0.06) / 2 + 0.06, 0), 'secondary', { mat: 'wood' }));
  parts.push(part(at(rbox(0.7, 0.06, 0.6, 0.02), 0, 0.03, 0), 'secondary', { mat: 'wood', ao: 0.7 }));
  parts.push(part(at(rbox(0.68, 0.04, 0.58, 0.015), 0, ph - 0.02, 0), 'secondary', { mat: 'wood' }));
  parts.push(part(at(rbox(0.3, 0.1, 0.012, 0.006), 0, ph * 0.55, 0.265), 'accent', { cast: false }));
  const y0 = ph;
  // body: chunky rounded block on four stubby legs, two arm nubs (right one waving), slot eyes
  const B = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => at(g, x * s, y0 + y * s, z * s, rx, ry, rz, s, s, s);
  for (const [lx, lz] of [[-0.18, -0.08], [-0.07, -0.08], [0.07, -0.08], [0.18, -0.08]]) parts.push(part(B(rbox(0.07, 0.14, 0.09, 0.03, 2), lx, 0.07, lz + 0.08), 'body'));
  parts.push(part(B(rbox(0.56, 0.4, 0.34, 0.12, 3), 0, 0.14 + 0.2, 0), 'body'));
  parts.push(part(B(rbox(0.1, 0.09, 0.12, 0.04, 2), -0.31, 0.3, 0), 'body'));
  parts.push(part(B(rbox(0.09, 0.2, 0.11, 0.04, 2), 0.31, 0.48, 0.0, 0, 0, -0.35), 'body'));
  for (const e of [-1, 1]) parts.push(part(B(rbox(0.05, 0.11, 0.03, 0.02, 2), e * 0.1, 0.4, 0.165), 'body', { color: '#3F5E55', ao: false }));
  return { parts, footprint: { w: 0.7, d: 0.6 }, solid: true, anchors: {}, colors: { body: PATINA, secondary: T.walnut, accent: T.brass }, hero: 'verdigris Clawd waving on a plinth' };
}

/** Wall sconce (origin on the wall face at the bulb height): brass back plate, curved arm, cream cone shade, bulb. */
export function buildWallSconce(p: KitParams = {}, rng: Rng) {
  const parts = [
    part(at(disc(0.06, 0.02, 16, 0.006), 0, -0.06, 0.0, PI / 2), 'accent'),
    part(tube([[0, -0.06, 0.02], [0, -0.1, 0.1], [0, -0.04, 0.16]], 0.01, 8, 6), 'accent'),
    part(at(lathe([[0.075, 0], [0.07, 0.01], [0.035, 0.12], [0.03, 0.13]], 32), 0, -0.06, 0.16), 'body', { mat: 'shade', cast: false }),
    part(at(sphere(0.028, 12, 8), 0, 0.0, 0.16), 'bulb', { mat: 'bulb', cast: false }),
  ];
  return { parts, footprint: { w: 0.16, d: 0.2 }, solid: false, anchors: { bulb: [0, 0, 0.16] }, colors: { body: T.linen, secondary: T.ink2, accent: T.brass }, hero: 'brass arm + cone shade' };
}

/**
 * Felt letter board (office directory): walnut frame, slate felt, rows of cream "letters" (seeded word lengths).
 * Origin = wall face centre.
 */
export function buildLetterBoard(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 0.8, h = p.h ?? 0.6;
  const parts = [part(at(rbox(w, h, 0.04, 0.015), 0, 0, 0.02), 'body', { mat: 'wood' }), part(at(rbox(w - 0.07, h - 0.07, 0.006, 0.002), 0, 0, 0.042), 'secondary', { cast: false })];
  const rows = Math.floor((h - 0.12) / 0.07);
  for (let r = 0; r < rows; r++) {
    let x = -w / 2 + 0.07 + (r === 0 ? 0.08 : 0);
    const y = h / 2 - 0.09 - r * 0.07, lh = r === 0 ? 0.04 : 0.028;
    while (x < w / 2 - 0.12) {
      const n = 2 + v.int(5);
      for (let k = 0; k < n && x < w / 2 - 0.07; k++) { parts.push(part(at(rbox(0.016, lh, 0.004, 0.001), x, y, 0.047), 'accent', { cast: false, mat: 'small' })); x += 0.024; }
      x += 0.035;
      if (v.chance(0.25)) break;
    }
  }
  return { parts, footprint: { w, d: 0.05 }, solid: false, anchors: {}, colors: { body: T.walnut, secondary: FELT, accent: T.trim }, hero: 'felt rows of letters' };
}

/** Guest-book podium: flared walnut pedestal, a slanted top with an open book and a brass pen on a chain. */
export function buildPodium(p: KitParams = {}, rng: Rng) {
  const parts = [
    part(lathe([[0, 0], [0.2, 0], [0.19, 0.03], [0.09, 0.08], [0.06, 0.2], [0.06, 0.8], [0.1, 0.86], [0, 0.86]], 16), 'body', { mat: 'wood' }),
    part(at(rbox(0.46, 0.04, 0.34, 0.015), 0, 0.9, 0, 0.3), 'body', { mat: 'wood' }),
    part(at(rbox(0.46, 0.025, 0.025, 0.008), 0, 0.84, 0.17, 0.3), 'accent'),
  ];
  for (const e of [-1, 1]) {
    const g = rbox(0.17, 0.02, 0.24, 0.006);
    parts.push(part(at(g, e * 0.09, 0.93, 0.0, 0.3, 0, -e * 0.05), 'secondary'));
  }
  parts.push(part(at(capsule(0.006, 0.12, 2, 6), 0.12, 0.945, 0.02, 0.3, 0.4, PI / 2), 'accent', { mat: 'small' }));
  return { parts, footprint: { r: 0.2 }, solid: true, anchors: {}, colors: { body: T.walnut, secondary: T.trim, accent: T.brass }, hero: 'slanted top, open guest book + pen' };
}

/**
 * Wall lantern on a scrolled iron bracket (plaza): origin on the wall face; the lantern hangs `reach` m out (+z) with
 * its bulb at y 0 (so the layout's street-lamp anchor can be the bulb).
 */
export function buildWallLantern(p: KitParams = {}, rng: Rng) {
  const reach = p.reach ?? 1.0;
  const parts = [
    part(at(rbox(0.12, 0.28, 0.04, 0.015), 0, 0.16, 0.02), 'secondary'),
    part(tube([[0, 0.28, 0.03], [0, 0.33, reach * 0.4], [0, 0.32, reach * 0.85], [0, 0.29, reach]], 0.016, 12, 6), 'secondary'),
    part(tube([[0, 0.05, 0.03], [0, 0.13, reach * 0.3], [0, 0.29, reach * 0.55]], 0.01, 10, 5), 'secondary'),
    part(at(torus(0.06, 0.008, 4, 14), 0, 0.2, reach * 0.35), 'accent', { cast: false }),
    part(at(cyl(0.006, 0.006, 0.08, 5), 0, 0.25, reach), 'secondary', { cast: false }),
    part(at(lathe([[0.02, 0.08], [0.11, 0.0], [0.1, -0.02], [0.02, 0.01]], 16), 0, 0.14, reach), 'secondary'),
    part(at(lathe([[0.075, -0.14], [0.095, 0.04], [0.09, 0.06], [0.06, 0.08]], 32), 0, 0.06, reach), 'body', { mat: 'shade', cast: false }),
    part(at(lathe([[0, -0.02], [0.07, -0.02], [0.08, 0.0], [0.07, 0.015], [0, 0.015]], 16), 0, -0.1, reach), 'secondary'),
    part(at(sphere(0.045, 14, 10), 0, 0.0, reach), 'bulb', { mat: 'bulb', cast: false }),
  ];
  return { parts, footprint: { w: 0.2, d: reach + 0.1 }, solid: false, anchors: { bulb: [0, 0, reach] }, colors: { body: T.butter, secondary: T.ink2, accent: T.brass }, hero: 'scrolled bracket + lantern' };
}

/** Header beam (plaza west end: hides the 0.2 m gap between the 2.8 m west wall and the 3.0 m plaza ceiling): a
 * walnut beam, bottom at y 0, running along local x, with two brass bolt plates. */
export function buildBeam(p: KitParams = {}, rng: Rng) {
  const w = p.w ?? 2.5, h = p.h ?? 0.24, d = p.d ?? 0.26;
  const parts = [part(at(rbox(w, h, d, 0.025), 0, h / 2, 0), 'body', { mat: 'wood' })];
  for (const e of [-1, 1]) {
    parts.push(part(at(rbox(0.12, h * 0.6, 0.012, 0.004), e * (w / 2 - 0.3), h / 2, d / 2 + 0.004), 'accent', { cast: false }));
    for (const y of [-1, 1]) parts.push(part(at(sphere(0.012, 6, 4), e * (w / 2 - 0.3), h / 2 + y * h * 0.18, d / 2 + 0.012), 'accent', { cast: false, mat: 'small' }));
  }
  return { parts, footprint: { w, d }, solid: false, anchors: {}, colors: { body: T.walnut, accent: T.brass }, hero: 'bolt plates' };
}

/**
 * [ENV fix m2 r2] Floor compass inlay (Lobby medallion, review m2 r2: "break the plank floor up with an inlaid
 * compass / logo medallion"): a brass ring round a walnut band, a sand field, an 8-point compass star (4 long oak
 * points with a walnut half each, 4 short walnut points) and a brass hub; flush with the floor (≤ 5 mm, the edge
 * pass's planarity rule for rugs). `r` = outer radius. Origin = centre on the floor.
 */
export function buildFloorInlay(p: KitParams = {}, rng: Rng) {
  const r = p.r ?? 0.8, t = 0.004, parts: Part[] = [];
  const flat = (g: THREE.BufferGeometry, slot: SlotName, o: PartOpts = {}) => part(g, slot, { ao: false, cast: false, ...o });
  parts.push(flat(disc(r, t * 0.5, 56, 0.001), 'accent')); // brass rim
  parts.push(flat(at(disc(r - 0.04, t * 0.6, 56, 0.001), 0, 0.0005, 0), 'secondary')); // walnut band
  parts.push(flat(at(disc(r * 0.8, t * 0.7, 56, 0.001), 0, 0.001, 0), 'body')); // sand field
  parts.push(flat(at(lathe([[r * 0.8 - 0.03, 0], [r * 0.8 - 0.015, 0], [r * 0.8 - 0.015, t * 0.8], [r * 0.8 - 0.03, t * 0.8]], 56), 0, 0.0012, 0), 'accent')); // inner brass line
  const pt = (len: number, wid: number, half: number) => { // one compass point along +z, flat: a kite (or its left / right half)
    const sh = new THREE.Shape();
    if (half < 0) { sh.moveTo(0, 0); sh.lineTo(-wid, len * 0.28); sh.lineTo(0, len); sh.lineTo(0, 0); }
    else { sh.moveTo(0, 0); sh.lineTo(0, len); sh.lineTo(wid, len * 0.28); sh.lineTo(0, 0); }
    return new THREE.ShapeGeometry(sh).rotateX(PI / 2).rotateY(PI);
  };
  for (let i = 0; i < 8; i++) {
    const long = i % 2 === 0, len = long ? r * 0.76 : r * 0.46, wid = long ? r * 0.13 : r * 0.09, a = (i / 8) * PI * 2;
    const y = long ? t + 0.0012 : t + 0.0006;
    parts.push(flat(at(pt(len, wid, -1).rotateX(PI), 0, y, 0, 0, a, 0), long ? 'body' : 'secondary', { color: long ? T.oak : T.walnutDark }));
    parts.push(flat(at(pt(len, wid, 1).rotateX(PI), 0, y, 0, 0, a, 0), 'secondary', { color: long ? T.walnut : T.walnut }));
  }
  parts.push(flat(at(cyl(r * 0.07, r * 0.07, 0.004, 24), 0, t + 0.004, 0), 'accent'));
  return { parts, footprint: { r }, solid: false, anchors: {}, colors: { body: T.sand, secondary: T.walnut, accent: T.brass }, hero: '8-point compass star in a brass ring' };
}

/** The Lobby / Plaza builders (registry.ts spreads them in). */
export const LOBBY_KIT = {
  helpDesk: buildHelpDesk, serviceLight: buildServiceLight, fishTank: buildFishTank, coffeeCart: buildCoffeeCart,
  menuBoard: buildMenuBoard, signpost: buildSignpost, roombaDock: buildRoombaDock,
  clawdStatue: buildClawdStatue, wallSconce: buildWallSconce, letterBoard: buildLetterBoard, podium: buildPodium,
  wallLantern: buildWallLantern, beam: buildBeam, floorInlay: buildFloorInlay, // [ENV fix m2 r2]
};
/** Signature (6k-tri) members. */
export const LOBBY_SIGNATURE = ['helpDesk', 'fishTank', 'coffeeCart', 'clawdStatue'];
/** `?sheet=props` rows. */
export const LOBBY_SHEET: SheetEntry[] = [
  ['helpDesk', {}, 'helpDesk ★'], ['serviceLight', {}, 'serviceLight'], ['fishTank', {}, 'fishTank ★'], ['coffeeCart', {}, 'coffeeCart ★'],
  ['menuBoard', {}, 'menuBoard'], ['signpost', {}, 'signpost'], ['roombaDock', {}, 'roombaDock'],
  ['clawdStatue', {}, 'clawdStatue ★'], ['wallSconce', {}, 'wallSconce'], ['letterBoard', {}, 'letterBoard'], ['podium', {}, 'podium'],
  ['wallLantern', {}, 'wallLantern'], ['beam', {}, 'beam'], ['floorInlay', {}, 'floorInlay'],
];
