/**
 * Prop kit, lounge set (M2 breadth, ENV 5/5): the bespoke signature props and zone-specific kit items of the Café,
 * the Nap Nook, the Mezzanine (Round Table + Observatory) and the stairs / slide surroundings. Same contract and
 * rules as the §7.5 kit (core.ts): `build<Name>(params, rng) → {parts, footprint, solid, anchors, colors, hero}`,
 * bevelled forms only, ≤ 3 palette tokens per prop (body / secondary / accent; literal colours only for the story
 * groups the table allows: cups, planets, pastries, quilts), baked into the merged kit classes (no new programs).
 * Signature props (espresso bar, Round Table, telescope, orrery, foosball, star canopy) budget ≤ 6k tris, the rest
 * ≤ 1.5k. Owner: ENV.
 */
import * as THREE from 'three';
import { rbox, cyl, lathe, sphere, capsule, torus, tube, slab, disc, at, part, vary, between } from './core.ts';
import type { Item, KitParams, Part, Pt, Rng, SheetEntry, V3 } from './core.ts';
import { T } from './tokens.ts';

const PI = Math.PI;
/** Derived lounge tokens (documented L*): the Observatory's dusk navy (value map MEZ ceiling 28 "star-map"). */
export const LT = Object.freeze({
  navy: '#343C5A', // L* 26: star canopy, star chart field
  navyDeep: '#262C44', // L* 18: canopy rim
  chalk: '#2F4A4A', // L* 29: chalkboard (tealDeep family, reads as slate)
  cushionNavy: '#4A5680', // L* 37: Round Table seat cushions (cool, hue 228: complementary staging vs clay)
  quiltDusk: '#7FA3B3', // L* 64: quilts / cushions (the Pit's dusk blue)
  steel: '#A8A49C', // L* 67: foosball rods
  pitch: '#4F7A57', // L* 47: foosball pitch (moss family)
});

/** `p.y0` (sheet only): lift a hanging item's parts so it shows above the sheet floor. */
const lift = <I extends Item>(item: I, p: KitParams): I => { if (p.y0) for (const q of item.parts) q.geometry.translate(0, p.y0, 0); return item; };
/** A tapered rod (cylinder) from a (radius ra) to b (radius rb). */
const rod = (ra: number, rb: number, n: number, a: Pt, b: Pt) => between(cyl(rb, ra, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), n), a, b);
/** A small cup (lathe) with a handle, base on y 0. */
const cupGeo = (r = 0.035, h = 0.05) => lathe([[0, 0], [r * 0.7, 0], [r, h * 0.2], [r * 1.02, h], [r * 0.9, h], [r * 0.85, h * 0.3], [0, h * 0.28]], 12);

// ------------------------------------------------------------------------------------------------ Café
/**
 * Espresso bar (Café signature, §5.5 "espresso bar walnut 36"): a panelled walnut counter with a stone top and a brass
 * foot rail; on it a cream-enamel lever espresso machine with a brass eagle dome, two group heads with walnut-handled
 * portafilters, a pressure gauge and a steam wand (AMB steam.ts vents: machine top at local (−1.2, h + 0.42), wand tip
 * at (−0.95, h + 0.12, +0.12)), a grinder with a brass hopper, a cup tower, and a cake stand of doughnuts.
 * Origin = floor centre, front (+z) = the customer side.
 */
export function buildEspressoBar(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 4.0, h = p.h ?? 1.0, d = p.d ?? 0.6;
  const parts: Part[] = [];
  // counter: body, overhanging stone top, toe kick, front panels, brass rail on brackets
  parts.push(part(at(rbox(w, h - 0.05, d - 0.06, 0.03, 1), 0, (h - 0.05) / 2, -0.03), 'body', { mat: 'wood' }));
  parts.push(part(at(slab(w + 0.08, d + 0.08, 0.05, 0.04, 0.016), 0, h - 0.05, 0.01), 'secondary'));
  parts.push(part(at(rbox(w - 0.06, 0.07, 0.05, 0.015), 0, 0.035, d / 2 - 0.09), 'body', { mat: 'wood', ao: 0.65 }));
  const n = Math.max(2, Math.round(w / 0.55));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (i + 0.5) * (w / n);
    parts.push(part(at(rbox(w / n - 0.07, h - 0.32, 0.018, 0.008), x, (h - 0.05) / 2 + 0.03, d / 2 - 0.055), 'body', { mat: 'wood', ao: 0.84 }));
  }
  parts.push(part(at(cyl(0.016, 0.016, w - 0.14, 10), 0, 0.15, d / 2 + 0.06, 0, 0, PI / 2), 'accent'));
  for (const x of [-w / 2 + 0.15, -w / 6, w / 6, w / 2 - 0.15]) parts.push(part(at(rbox(0.024, 0.024, 0.11, 0.008), x, 0.15, d / 2 + 0.01), 'accent'));
  // the machine (local x −1.2): plinth, enamel body with a brass band, dome + eagle, group heads, portafilters, gauge, wand
  const mx = -1.2, top = h;
  parts.push(part(at(rbox(0.66, 0.06, 0.42, 0.02), mx, top + 0.03, 0), 'body', { mat: 'wood' }));
  parts.push(part(at(rbox(0.6, 0.3, 0.36, 0.06, 2), mx, top + 0.21, -0.01), 'secondary'));
  parts.push(part(at(rbox(0.61, 0.035, 0.37, 0.012), mx, top + 0.3, -0.01), 'accent', { cast: false }));
  parts.push(part(at(lathe([[0.17, 0], [0.16, 0.04], [0.12, 0.08], [0.06, 0.1], [0.02, 0.105], [0, 0.105]], 16), mx, top + 0.36, -0.02), 'accent'));
  parts.push(part(at(sphere(0.03, 10, 8), mx, top + 0.495, -0.02), 'accent')); // the eagle: body + spread wings
  for (const e of [-1, 1]) parts.push(part(at(capsule(0.012, 0.07, 2, 6), mx + e * 0.05, top + 0.505, -0.02, 0, 0, e * 1.1), 'accent', { cast: false }));
  for (const e of [-1, 1]) {
    const gx = mx + e * 0.14;
    parts.push(part(at(cyl(0.045, 0.05, 0.06, 14), gx, top + 0.15, 0.2), 'accent'));
    parts.push(part(at(cyl(0.05, 0.05, 0.03, 14), gx, top + 0.1, 0.21), 'accent'));
    parts.push(part(at(capsule(0.016, 0.12, 2, 8), gx + e * 0.02, top + 0.095, 0.32, PI / 2 - 0.15, e * 0.25, 0), 'body', { mat: 'wood' }));
    parts.push(part(at(cupGeo(0.032, 0.045), gx, top + 0.035, 0.21), 'secondary', { cast: false }));
  }
  parts.push(part(at(rbox(0.5, 0.025, 0.12, 0.008), mx, top + 0.075, 0.22), 'accent', { cast: false })); // drip tray
  parts.push(part(at(cyl(0.055, 0.055, 0.02, 18), mx, top + 0.25, 0.175, PI / 2), 'secondary', { cast: false }));
  parts.push(part(at(torus(0.055, 0.009, 4, 18), mx, top + 0.25, 0.185), 'accent', { cast: false })); // gauge + brass rim
  parts.push(part(at(rbox(0.006, 0.04, 0.004), mx, top + 0.262, 0.19, 0, 0, -0.6), 'body', { cast: false, color: T.ink }));
  parts.push(part(tube([[mx + 0.27, top + 0.26, 0.1], [mx + 0.3, top + 0.2, 0.16], [mx + 0.25, top + 0.13, 0.12]], 0.008, 8, 5), 'accent', { cast: false }));
  for (let i = 0; i < 3; i++) parts.push(part(at(cupGeo(0.028, 0.04), mx - 0.14 + i * 0.14, top + 0.36, -0.14), 'secondary', { cast: false }));
  // grinder (local x −0.55): walnut body, brass hopper cone, a dosing chute
  parts.push(part(at(rbox(0.16, 0.24, 0.2, 0.03, 2), -0.55, top + 0.12, -0.02), 'body', { mat: 'wood' }));
  parts.push(part(at(lathe([[0.03, 0], [0.1, 0.16], [0.105, 0.18], [0.0, 0.18]], 14), -0.55, top + 0.24, -0.02), 'accent'));
  parts.push(part(at(rbox(0.05, 0.04, 0.06, 0.01), -0.55, top + 0.13, 0.1), 'accent', { cast: false }));
  // cup tower + saucers (local x +0.25)
  for (let i = 0; i < 4; i++) parts.push(part(at(cupGeo(0.034, 0.045), 0.22 + (i % 2) * 0.004, top + i * 0.038, -0.1), 'secondary', { cast: false }));
  for (let i = 0; i < 4; i++) parts.push(part(at(cyl(0.06, 0.05, 0.012, 16), 0.42, top + 0.006 + i * 0.013, -0.08), 'secondary', { cast: false }));
  // cake stand with doughnuts (local x +1.25): brass pedestal, stone plate, iced rings
  parts.push(part(at(lathe([[0.08, 0], [0.05, 0.02], [0.02, 0.04], [0.018, 0.16], [0.03, 0.18], [0, 0.18]], 12), 1.25, top, -0.02), 'accent'));
  parts.push(part(at(disc(0.18, 0.02, 20, 0.006), 1.25, top + 0.18, -0.02), 'secondary'));
  const icing = [T.rose, T.butter, T.lavender, T.rose];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * PI * 2 + 0.4, x = 1.25 + Math.sin(a) * (i === 3 ? 0 : 0.09), z = -0.02 + Math.cos(a) * (i === 3 ? 0 : 0.09), y = top + 0.22 + (i === 3 ? 0.045 : 0);
    parts.push(part(at(torus(0.04, 0.022, 5, 12), x, y, z, PI / 2), 'accent', { color: '#C99060' }));
    parts.push(part(at(torus(0.04, 0.019, 4, 12, PI * 2), x, y + 0.01, z, PI / 2), 'accent', { color: icing[i], cast: false }));
  }
  parts.push(part(at(rbox(0.14, 0.012, 0.1, 0.004), 1.7, top + 0.006, 0.1, 0, v.r(-0.3, 0.3)), 'secondary', { cast: false })); // napkins
  return { parts, footprint: { w, d }, solid: true, anchors: { top: h, machine: [mx, top + 0.42, -0.02], wand: [mx + 0.25, top + 0.12, 0.12] }, colors: { body: T.walnut, secondary: T.sand, accent: T.brass }, hero: 'lever machine with eagle dome, portafilters, gauge, doughnut stand' };
}

/**
 * Hanging chalk menu (over the espresso bar): walnut frame, slate board, chalk lines + a steaming-cup icon, two chains
 * up `hang` m. Origin = the board's centre; front +z.
 */
export function buildCafeMenu(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 1.5, h = p.h ?? 0.62, hang = p.hang ?? 0.4;
  const parts = [part(at(rbox(w, h, 0.04, 0.02, 1), 0, 0, 0), 'body', { mat: 'wood' })];
  parts.push(part(at(rbox(w - 0.08, h - 0.08, 0.01, 0.004), 0, 0, 0.02), 'secondary', { cast: false }));
  // chalk: a title bar, then price lines (item ··· price dots) in two columns
  parts.push(part(at(rbox(w * 0.36, 0.035, 0.004), 0.08, h / 2 - 0.1, 0.027), 'accent', { cast: false }));
  for (const c of [-1, 1]) {
    for (let r = 0; r < 4; r++) {
      const y = h / 2 - 0.19 - r * 0.085, x0 = c * w * 0.25;
      parts.push(part(at(rbox(v.r(0.16, 0.3), 0.018, 0.004), x0 - 0.05, y, 0.027), 'accent', { cast: false }));
      parts.push(part(at(rbox(0.05, 0.018, 0.004), x0 + 0.21, y, 0.027), 'accent', { cast: false }));
    }
  }
  // the cup icon (top left): cup, handle, two steam curls
  parts.push(part(at(rbox(0.07, 0.05, 0.004, 0.012), -w / 2 + 0.16, h / 2 - 0.12, 0.027), 'accent', { cast: false }));
  parts.push(part(at(torus(0.018, 0.006, 3, 10, PI * 1.3), -w / 2 + 0.2, h / 2 - 0.115, 0.027, 0, 0, -PI * 0.65), 'accent', { cast: false }));
  for (const e of [-1, 1]) parts.push(part(tube([[-w / 2 + 0.16 + e * 0.015, h / 2 - 0.085, 0.027], [-w / 2 + 0.16 + e * 0.015 + 0.012, h / 2 - 0.06, 0.027], [-w / 2 + 0.16 + e * 0.015 - 0.008, h / 2 - 0.035, 0.027]], 0.004, 5, 3), 'accent', { cast: false }));
  for (const e of [-1, 1]) {
    parts.push(part(at(cyl(0.004, 0.004, hang, 4), e * (w / 2 - 0.12), h / 2 + hang / 2, 0), 'secondary', { color: T.ink2, cast: false }));
    parts.push(part(at(torus(0.014, 0.004, 3, 8), e * (w / 2 - 0.12), h / 2 + 0.01, 0), 'secondary', { color: T.brass, cast: false }));
  }
  return lift({ parts, footprint: { w, d: 0.05 }, solid: false, anchors: {}, colors: { body: T.walnut, secondary: LT.chalk, accent: T.trim }, hero: 'chalk menu with a steaming-cup icon, chains' }, p);
}

/**
 * Marquee sign (Café wall): a coffee cup + saucer + three steam curls outlined in bulbs on a walnut backing plate,
 * with stand-off bolts. The bulbs are the `bulb` class (warm; brighter after dark). Origin = plate centre, front +z.
 */
export function buildMarqueeCup(p: KitParams = {}, rng: Rng) {
  const s = p.s ?? 1;
  const parts = [part(at(rbox(0.9 * s, 0.9 * s, 0.035, 0.08, 1), 0, 0, 0.018), 'body', { mat: 'wood' })];
  parts.push(part(at(rbox(0.84 * s, 0.84 * s, 0.006, 0.07), 0, 0, 0.038), 'secondary', { cast: false }));
  for (const [sx, sy] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) parts.push(part(at(cyl(0.018, 0.018, 0.012, 10), sx * 0.36 * s, sy * 0.36 * s, 0.044, PI / 2), 'accent', { cast: false }));
  const pts = [];
  // cup body (U shape), handle (arc), saucer line, steam curls
  for (let i = 0; i <= 8; i++) { const a = PI + (i / 8) * PI; pts.push([Math.cos(a) * 0.2, -0.05 + Math.sin(a) * 0.17]); }
  pts.push([-0.2, 0.05], [0.2, 0.05]);
  for (let i = 0; i <= 5; i++) { const a = -PI / 2 + (i / 5) * PI; pts.push([0.24 + Math.cos(a) * 0.07, -0.02 + Math.sin(a) * 0.07]); }
  for (let i = 0; i <= 6; i++) pts.push([-0.28 + i * 0.093, -0.27]);
  for (const x0 of [-0.1, 0, 0.1]) for (let i = 0; i < 4; i++) { const t = i / 3; pts.push([x0 + Math.sin(t * PI * 1.6) * 0.03, 0.12 + t * 0.2]); }
  for (const [x, y] of pts) {
    parts.push(part(at(sphere(0.017 * s, 5, 3), x * s, y * s, 0.058), 'bulb', { mat: 'bulb', cast: false, color: '#FFE9C4' }));
  }
  return { parts, footprint: { w: 0.9 * s, d: 0.07 }, solid: false, anchors: {}, colors: { body: T.walnut, secondary: LT.chalk, accent: T.brass }, hero: 'bulb-outlined steaming cup' };
}

/**
 * Bistro chair (café stools → chairs with a bentwood hoop back): round teal cushion seat (top = `h`), four slim
 * splayed ink legs with a brass-capped leg ring, a hoop back of two bent rails. Front +z (faces the table).
 */
export function buildBistroChair(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), h = p.h ?? 0.45, r = 0.155;
  const parts = [part(at(disc(r, 0.06, 18, 0.022), 0, h - 0.06, 0), 'body', { mat: 'fabric' })];
  parts.push(part(at(torus(r - 0.004, 0.007, 3, 18), 0, h - 0.03, 0, PI / 2), 'accent', { cast: false }));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * PI * 2 + PI / 4;
    parts.push(part(rod(0.02, 0.014, 8, [Math.sin(a) * 0.1, h - 0.06, Math.cos(a) * 0.1], [Math.sin(a) * 0.15, 0.0, Math.cos(a) * 0.15]), 'secondary', { cast: false }));
    parts.push(part(at(sphere(0.018, 8, 6), Math.sin(a) * 0.15, 0.01, Math.cos(a) * 0.15, 0, 0, 0, 1, 0.6, 1), 'accent', { color: T.brass, cast: false }));
  }
  parts.push(part(at(torus(0.127, 0.01, 4, 16), 0, h * 0.34, 0, PI / 2), 'secondary', { cast: false }));
  // hoop back: an arch of bent rail behind the seat (−z), with a smaller inner hoop
  const bh = typeof p.back === 'number' ? p.back : 0.27;
  parts.push(part(at(torus(0.13, 0.016, 5, 14, PI), 0, h + bh - 0.13, -r + 0.015, -0.12), 'secondary', { cast: false }));
  for (const e of [-1, 1]) parts.push(part(rod(0.016, 0.016, 6, [e * 0.13, h + bh - 0.13, -r + 0.03], [e * 0.12, h - 0.04, -r + 0.05]), 'secondary', { cast: false }));
  parts.push(part(at(torus(0.07, 0.011, 4, 12, PI), 0, h + bh - 0.17, -r + 0.02, -0.12), 'secondary', { cast: false }));
  return { parts, footprint: { r: 0.19 }, solid: false, anchors: { seat: h }, colors: { body: v.pick([T.fabricTeal, T.teal, '#6F8E7D']), secondary: T.ink2, accent: T.trim }, hero: 'bentwood hoop back, leg ring' };
}

/**
 * Banquette (café booth bench): walnut plinth, teal seat cushion with cream piping, channel-tufted back (rounded
 * vertical flutes), capped by a walnut rail. `w` along x, back at −z. Seat top 0.42, back top 0.9.
 */
export function buildBanquette(p: KitParams = {}, rng: Rng) {
  const w = p.w ?? 3.0, d = p.d ?? 0.58, sh = 0.42, bh = p.backH ?? 0.9;
  const parts = [part(at(rbox(w, 0.24, d - 0.04, 0.03, 1), 0, 0.12, 0.0), 'secondary', { mat: 'wood', ao: 0.85 })];
  parts.push(part(at(rbox(w - 0.02, 0.07, 0.04, 0.012), 0, 0.035, d / 2 - 0.07), 'secondary', { mat: 'wood', ao: 0.6 }));
  const segs = Math.max(1, Math.round(w / 1.0));
  for (let i = 0; i < segs; i++) {
    const x = -w / 2 + (i + 0.5) * (w / segs);
    parts.push(part(at(rbox(w / segs - 0.02, 0.16, d - 0.06, 0.06, 2), x, sh - 0.08, 0.02), 'body', { mat: 'fabric' }));
    parts.push(part(at(rbox(w / segs - 0.1, 0.012, 0.012, 0.004), x, sh - 0.075, d / 2 - 0.012), 'accent', { cast: false }));
  }
  const n = Math.max(4, Math.min(16, Math.round(w / 0.24)));
  const fw = (w - 0.06) / n;
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + 0.03 + (i + 0.5) * fw;
    parts.push(part(at(capsule(fw * 0.5, bh - sh - 0.16, 2, 8), x, (sh + bh) / 2 + 0.01, -d / 2 + 0.09, -0.1, 0, 0, 1, 1, 0.55), 'body', { mat: 'fabric' }));
  }
  parts.push(part(at(rbox(w, bh - 0.2, 0.08, 0.02), 0, (bh - 0.2) / 2 + 0.2, -d / 2 + 0.03), 'secondary', { mat: 'wood', ao: 0.7 }));
  parts.push(part(at(rbox(w + 0.02, 0.05, 0.12, 0.02, 2), 0, bh - 0.02, -d / 2 + 0.05), 'secondary', { mat: 'wood' }));
  return { parts, footprint: { w, d }, solid: true, anchors: { seat: sh }, colors: { body: '#4E7C78', secondary: T.walnut, accent: T.trim }, hero: 'channel-tufted back, piped cushions, walnut cap rail' };
}

/**
 * Foosball table (Café): walnut cabinet on splayed ink legs, a moss pitch with cream lines and goal mouths, eight steel
 * rods with walnut handles and little players in two team colours, bead score counters. Origin floor centre; rods
 * run along z (the players stand at the long ±z sides).
 */
export function buildFoosball(p: KitParams = {}, rng: Rng) {
  const w = p.w ?? 1.2, h = p.h ?? 0.85, d = p.d ?? 0.7, cy = h - 0.2;
  const parts: Part[] = [];
  parts.push(part(at(rbox(w, 0.22, d, 0.035, 1), 0, cy + 0.05, 0), 'body', { mat: 'wood' }));
  parts.push(part(at(rbox(w - 0.1, 0.012, d - 0.1, 0.004), 0, cy + 0.066, 0), 'secondary', { cast: false, ao: 0.8 }));
  for (const [x, z, lw, ld] of [[0, 0, 0.012, d - 0.12], [0, 0, 0.012, 0.012]]) parts.push(part(at(rbox(lw, 0.004, ld), x, cy + 0.074, z), 'accent', { cast: false }));
  parts.push(part(at(torus(0.07, 0.005, 3, 18), 0, cy + 0.074, 0, PI / 2), 'accent', { cast: false }));
  for (const e of [-1, 1]) parts.push(part(at(rbox(0.03, 0.08, 0.2, 0.01), e * (w / 2 - 0.035), cy + 0.1, 0), 'accent', { color: T.ink, cast: false, ao: 0.6 })); // goal mouths
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    parts.push(part(at(rbox(0.08, cy - 0.04, 0.08, 0.02), sx * (w / 2 - 0.08), (cy - 0.04) / 2, sz * (d / 2 - 0.08)), 'body', { mat: 'wood' }));
    parts.push(part(at(rbox(0.1, 0.04, 0.1, 0.015), sx * (w / 2 - 0.08), 0.02, sz * (d / 2 - 0.08)), 'secondary'));
  }
  for (const e of [-1, 1]) parts.push(part(at(rbox(0.05, 0.05, d - 0.2, 0.015), e * (w / 2 - 0.08), 0.18, 0), 'body', { mat: 'wood', cast: false }));
  parts.push(part(at(rbox(w - 0.2, 0.05, 0.05, 0.015), 0, 0.18, 0), 'body', { mat: 'wood', cast: false }));
  const rods = 8, team = [T.trim, T.tealDeep];
  for (let i = 0; i < rods; i++) {
    const x = -w / 2 + 0.12 + i * ((w - 0.24) / (rods - 1));
    const side = [0, 0, 1, 0, 1, 0, 1, 1][i]; // goalie, defence, attack… alternating
    parts.push(part(at(cyl(0.008, 0.008, d + 0.34, 6), x, cy + 0.16, 0, PI / 2), 'secondary', { color: LT.steel, cast: false }));
    parts.push(part(at(capsule(0.022, 0.08, 2, 6), x, cy + 0.16, (side ? 1 : -1) * (d / 2 + 0.2), PI / 2), 'body', { mat: 'wood', cast: false }));
    const np = [1, 2, 3, 5, 5, 3, 2, 1][i];
    for (let k = 0; k < np; k++) {
      const z = (k - (np - 1) / 2) * ((d - 0.2) / Math.max(np, 2));
      parts.push(part(at(capsule(0.018, 0.05, 2, 6), x, cy + 0.12, z), 'accent', { color: team[side], cast: false }));
      parts.push(part(at(sphere(0.016, 6, 5), x, cy + 0.18, z), 'accent', { color: team[side], cast: false }));
    }
  }
  for (const e of [-1, 1]) {
    parts.push(part(at(cyl(0.004, 0.004, 0.3, 4), e * (w / 2 - 0.16), cy + 0.2, -d / 2 + 0.05, 0, 0, PI / 2), 'secondary', { color: LT.steel, cast: false }));
    for (let k = 0; k < 5; k++) parts.push(part(at(sphere(0.012, 6, 4), e * (w / 2 - 0.16) - 0.12 + k * 0.03 + (k > 2 ? 0.08 : 0), cy + 0.2, -d / 2 + 0.05), 'accent', { color: T.brass, cast: false }));
  }
  parts.push(part(at(sphere(0.018, 8, 6), 0.08, cy + 0.09, 0.05), 'accent', { color: T.butter, cast: false }));
  return { parts, footprint: { w, d }, solid: true, anchors: { top: cy + 0.16 }, colors: { body: T.walnut, secondary: T.ink2, accent: LT.pitch }, hero: 'rods with handles and little players, score beads' };
}

/**
 * Bunting (garland of pennant flags along a sagging cord from (0,0,0) to (len,0,0)); flags cycle `colors` tokens.
 */
export function buildBunting(p: KitParams = {}, rng: Rng) {
  const len = p.len ?? 3, sag = p.sag ?? 0.18, n = p.n ?? Math.max(4, Math.round(len / 0.26));
  const cols = p.flags ?? [T.teal, T.butter, T.trim, T.lavender];
  const yAt = (t: number) => -sag * 4 * t * (1 - t);
  const pts = []; for (let k = 0; k <= 8; k++) pts.push([k / 8 * len, yAt(k / 8), 0]);
  const parts = [part(tube(pts, 0.004, 16, 3), 'secondary', { cast: false })];
  const tri = new THREE.Shape(); tri.moveTo(-0.07, 0); tri.lineTo(0.07, 0); tri.lineTo(0, -0.15); tri.lineTo(-0.07, 0);
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    const g = new THREE.ExtrudeGeometry(tri, { depth: 0.004, bevelEnabled: false });
    parts.push(part(at(g, t * len, yAt(t) - 0.005, -0.002, 0, 0, (0.5 - t) * sag * 0.9), 'accent', { color: cols[k % cols.length], cast: false, mat: 'fabric' }));
  }
  return lift({ parts, footprint: { w: len, d: 0.02 }, solid: false, anchors: {}, colors: { body: T.trim, secondary: T.ink2, accent: T.teal }, hero: 'sagging cord of pennants' }, p);
}

/** A-frame sandwich board (café): walnut frame, chalk faces with a doughnut + cup doodle. Origin floor, front +z. */
export function buildSandwichBoard(p: KitParams = {}, rng: Rng) {
  const H = p.h ?? 0.75, w = p.w ?? 0.45, tilt = 0.2;
  const parts: Part[] = [];
  for (const e of [-1, 1]) {
    const z = e * Math.sin(tilt) * H / 2;
    parts.push(part(at(rbox(w, H, 0.03, 0.02, 1), 0, H / 2, z, -e * tilt), 'body', { mat: 'wood' }));
    parts.push(part(at(rbox(w - 0.07, H - 0.14, 0.006, 0.004), 0, H / 2 + 0.02, z + e * 0.018, -e * tilt), 'secondary', { cast: false }));
  }
  const fz = Math.sin(tilt) * H / 2 + 0.024;
  parts.push(part(at(torus(0.06, 0.018, 4, 14), 0, H * 0.62, fz - 0.02, -tilt), 'accent', { cast: false, color: T.rose }));
  parts.push(part(at(rbox(0.16, 0.012, 0.004), 0, H * 0.4, fz - 0.058, -tilt), 'accent', { cast: false }));
  parts.push(part(at(rbox(0.1, 0.012, 0.004), 0, H * 0.33, fz - 0.07, -tilt), 'accent', { cast: false }));
  return { parts, footprint: { w, d: 0.3 }, solid: true, anchors: {}, colors: { body: T.walnut, secondary: LT.chalk, accent: T.trim }, hero: 'A-frame, doodled doughnut' };
}

/** A plate with a treat (story prop on café tables): cream plate + a doughnut or a croissant. */
export function buildTreat(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), kind = p.kind ?? v.pick(['donut', 'croissant', 'cake']);
  const parts = [part(disc(0.09, 0.012, 16, 0.004), 'body', { mat: 'small', cast: false })];
  if (kind === 'donut') {
    parts.push(part(at(torus(0.035, 0.02, 6, 12), 0, 0.03, 0, PI / 2), 'secondary', { mat: 'small', cast: false }));
    parts.push(part(at(torus(0.035, 0.017, 4, 12), 0, 0.04, 0, PI / 2), 'accent', { mat: 'small', cast: false, color: v.pick([T.rose, T.butter, T.lavender]) }));
  } else if (kind === 'croissant') {
    parts.push(part(at(torus(0.04, 0.02, 6, 10, PI * 1.1), 0, 0.03, 0, PI / 2, 0, 0.9, 1, 1, 0.7), 'secondary', { mat: 'small', cast: false, color: '#D2A060' }));
  } else {
    parts.push(part(at(cyl(0.045, 0.045, 0.05, 12, false), 0, 0.037, 0, 0, 0, 0), 'secondary', { mat: 'small', cast: false, color: '#E8D2B0' }));
    parts.push(part(at(sphere(0.014, 8, 6), 0, 0.068, 0), 'accent', { mat: 'small', cast: false, color: T.rose }));
  }
  return { parts, footprint: { r: 0.09 }, solid: false, anchors: {}, colors: { body: T.trim, secondary: '#C99060', accent: T.rose }, small: true, hero: 'iced treat' };
}

// ------------------------------------------------------------------------------------------------ Nap Nook
/**
 * Bunk bed (Nap Nook): walnut posts with ball finials, two decks, mattresses under a quilt (colour = body) turned
 * down to a cream sheet, fat pillows at the −x end, an upper guard rail, a ladder at the +x end (front, +z) and a string
 * of tiny warm fairy bulbs along the upper rail. Mattress tops at 0.5 / 1.4 (the lie slots, `lift` 1.0).
 */
export function buildBunk(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 1.8, h = p.h ?? 1.6, d = p.d ?? 0.8;
  const parts: Part[] = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    parts.push(part(at(rbox(0.07, h, 0.07, 0.02, 1), sx * (w / 2 - 0.035), h / 2, sz * (d / 2 - 0.035)), 'secondary', { mat: 'wood' }));
    parts.push(part(at(sphere(0.045, 8, 6), sx * (w / 2 - 0.035), h + 0.03, sz * (d / 2 - 0.035)), 'secondary', { mat: 'wood' }));
  }
  const quilts = [p.quilt ?? T.lavender, p.quilt2 ?? LT.quiltDusk];
  [0.38, 1.28].forEach((dy, i) => {
    parts.push(part(at(rbox(w - 0.02, 0.1, d - 0.04, 0.025, 1), 0, dy - 0.05, 0), 'secondary', { mat: 'wood' }));
    parts.push(part(at(rbox(w - 0.14, 0.11, d - 0.14, 0.05, 1), 0, dy + 0.055, 0), 'accent', { mat: 'fabric' }));
    // quilt: the foot 2/3, with a rolled turn-down edge and a tuck over the front
    const qw = (w - 0.14) * 0.66, qx = (w - 0.14) / 2 - qw / 2;
    parts.push(part(at(rbox(qw, 0.045, d - 0.1, 0.02, 1), qx + 0.01, dy + 0.12, 0.015), 'body', { mat: 'fabric', color: quilts[i] }));
    parts.push(part(at(capsule(0.03, d - 0.2, 2, 8), qx - qw / 2 + 0.02, dy + 0.13, 0.015, PI / 2), 'body', { mat: 'fabric', color: quilts[i] }));
    parts.push(part(at(rbox(qw, 0.12, 0.03, 0.015), qx + 0.01, dy + 0.07, d / 2 - 0.04), 'body', { mat: 'fabric', color: quilts[i], cast: false }));
    parts.push(part(at(rbox(0.26, 0.09, d - 0.26, 0.045, 1), -w / 2 + 0.24, dy + 0.155, 0, 0, v.r(-0.1, 0.1), 0.12), 'accent', { mat: 'fabric' }));
    for (const e of [-1, 1]) parts.push(part(at(rbox(w - 0.1, 0.05, 0.035, 0.015), 0, dy + 0.02, e * (d / 2 - 0.03)), 'secondary', { mat: 'wood', ao: 0.8 }));
  });
  // upper guard rail (front, the −x 60%) on two spindles; head / foot boards
  parts.push(part(at(rbox(w * 0.6, 0.04, 0.035, 0.015), -w * 0.2, 1.62, d / 2 - 0.035), 'secondary', { mat: 'wood' }));
  for (const x of [-w * 0.2, w * 0.1 - 0.04]) parts.push(part(at(rbox(0.03, 0.26, 0.03, 0.01), x, 1.5, d / 2 - 0.035), 'secondary', { mat: 'wood' }));
  for (const e of [-1, 1]) for (const y of [0.62, 1.52]) parts.push(part(at(rbox(0.035, 0.22, d - 0.1, 0.012), e * (w / 2 - 0.035), y, 0), 'secondary', { mat: 'wood' }));
  // ladder at the +x end of the front
  const lx = w / 2 - 0.22;
  for (const e of [-1, 1]) parts.push(part(at(rbox(0.035, 1.5, 0.035, 0.012), lx + e * 0.14, 0.75, d / 2 + 0.03, -0.08), 'secondary', { mat: 'wood' }));
  for (let k = 1; k <= 4; k++) parts.push(part(at(cyl(0.013, 0.013, 0.28, 6), lx, k * 0.33, d / 2 + 0.03 + k * 0.026, 0, 0, PI / 2), 'secondary', { color: T.brass, cast: false }));
  // fairy lights along the upper rail + the head board
  const pts = []; for (let k = 0; k <= 10; k++) { const t = k / 10; pts.push([-w / 2 + 0.05 + t * (w - 0.1), 1.66 - Math.sin(t * PI * 3) ** 2 * 0.05, d / 2 - 0.01]); }
  parts.push(part(tube(pts, 0.003, 20, 3), 'secondary', { color: T.ink2, cast: false }));
  for (let k = 1; k < 10; k++) { const [x, y, z] = pts[k]; parts.push(part(at(sphere(0.012, 5, 3), x, y - 0.018, z + 0.004), 'bulb', { mat: 'bulb', cast: false, color: '#FFE9C4' })); }
  return { parts, footprint: { w, d }, solid: false, anchors: { lower: 0.5, upper: 1.4 }, colors: { body: T.lavender, secondary: T.walnut, accent: T.trim }, hero: 'turned-down quilts, ladder, fairy-light rail' };
}

/** Moon night-light (Nap Nook floor lamp fixture): a walnut pole with a glowing crescent moon + a little star. */
export function buildNightMoon(p: KitParams = {}, rng: Rng) {
  const by = p.bulbY ?? 1.2;
  const parts = [part(lathe([[0, 0], [0.15, 0], [0.13, 0.04], [0.04, 0.06], [0, 0.06]], 14), 'secondary', { mat: 'wood' })];
  parts.push(part(at(cyl(0.018, 0.022, by - 0.2, 8), 0, (by - 0.2) / 2 + 0.05, 0), 'secondary', { mat: 'wood' }));
  // crescent: a thick torus arc, glowing (bulb) with a brass rim bead
  parts.push(part(at(torus(0.13, 0.05, 8, 18, PI * 1.25), 0, by, 0, 0, 0, PI * 0.9), 'bulb', { mat: 'bulb', cast: false, color: '#FFE9C4' }));
  parts.push(part(at(sphere(0.03, 8, 6), 0.1, by + 0.12, 0.02), 'bulb', { mat: 'bulb', cast: false, color: '#FFE9C4' }));
  parts.push(part(at(cyl(0.012, 0.012, 0.1, 6), 0, by - 0.12, 0), 'accent'));
  return { parts, footprint: { r: 0.15 }, collider: { r: 0.15 }, solid: true, anchors: { bulb: [0, by, 0] }, colors: { body: T.butter, secondary: T.walnut, accent: T.brass }, hero: 'glowing crescent moon' };
}

/** Star mobile (hangs from the ceiling): brass cross-bars, stars (flat extruded, butter) and a moon on threads. */
export function buildMobile(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), drop = p.drop ?? 0.5;
  const parts = [part(at(cyl(0.003, 0.003, drop, 4), 0, -drop / 2, 0), 'secondary', { cast: false })];
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) { const a = (i / 10) * PI * 2, r = i % 2 ? 0.025 : 0.06; star[i ? 'lineTo' : 'moveTo'](Math.sin(a) * r, Math.cos(a) * r); }
  for (const [a, L, y] of [[0, 0.32, 0], [PI / 2, 0.24, -0.12]]) {
    parts.push(part(at(cyl(0.005, 0.005, L * 2, 5), 0, -drop + y, 0, 0, a, PI / 2), 'accent', { cast: false }));
    for (const e of [-1, 1]) {
      const x = Math.cos(a) * L * e, z = -Math.sin(a) * L * e, t = v.r(0.12, 0.28);
      parts.push(part(at(cyl(0.002, 0.002, t, 3), x, -drop + y - t / 2, z), 'secondary', { cast: false }));
      const g = new THREE.ExtrudeGeometry(star, { depth: 0.012, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 1 });
      parts.push(part(at(g, x, -drop + y - t - 0.06, z, 0, v.r(0, PI), 0), 'body', { cast: false }));
    }
  }
  parts.push(part(at(torus(0.05, 0.02, 6, 14, PI * 1.2), 0, -drop - 0.3, 0, 0, 0.4, PI * 0.9), 'body', { cast: false }));
  return lift({ parts, footprint: { r: 0.35 }, solid: false, anchors: {}, colors: { body: T.butter, secondary: T.ink2, accent: T.brass }, hero: 'stars + moon on threads' }, p);
}

/** Slippers (a pair, story prop by a bunk). */
export function buildSlippers(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), parts: Part[] = [];
  for (const e of [-1, 1]) {
    const yaw = v.r(-0.25, 0.25) + e * 0.1;
    parts.push(part(at(capsule(0.04, 0.1, 2, 8), e * 0.06, 0.025, 0, PI / 2, yaw, 0, 1, 0.6, 1), 'body', { mat: 'small', cast: false }));
    parts.push(part(at(sphere(0.022, 8, 6), e * 0.06 + Math.sin(yaw) * 0.07, 0.05, Math.cos(yaw) * 0.07), 'accent', { mat: 'small', cast: false }));
  }
  return { parts, footprint: { w: 0.24, d: 0.18 }, solid: false, anchors: {}, colors: { body: v.pick([T.rose, T.lavender, LT.quiltDusk]), accent: T.trim }, small: true, hero: 'pompoms' };
}

// ------------------------------------------------------------------------------------------------ Mezzanine
/**
 * The Round Table (MEZ signature, `task` station): a thick walnut top on a turned pedestal with four scrolled feet, a
 * brass compass-rose inlay and ring, a lazy susan holding an unrolled map, a task card + quill at each of the 8 seats
 * and a brass candlestick with a flickering flame (the `flame` class). Origin floor centre.
 */
export function buildRoundTable(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), R = (p.w ?? 2.2) / 2, h = p.h ?? 0.5, seats = p.seats ?? 8;
  const parts: Part[] = [];
  parts.push(part(at(disc(R, 0.06, 40, 0.022), 0, h - 0.06, 0), 'body', { mat: 'wood' }));
  parts.push(part(at(lathe([[R - 0.06, 0], [R - 0.04, 0.03], [R - 0.08, 0.05], [0, 0.05]], 36), 0, h - 0.11, 0), 'body', { mat: 'wood', ao: 0.8 }));
  parts.push(part(lathe([[0.3, 0], [0.3, 0.03], [0.14, 0.07], [0.1, 0.12], [0.12, 0.17], [0.08, 0.22], [0.09, h - 0.2], [0.14, h - 0.14], [0.2, h - 0.11], [0, h - 0.11]], 18), 'body', { mat: 'wood', ao: 0.9 }));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * PI * 2 + PI / 4;
    parts.push(part(tube([[Math.sin(a) * 0.12, 0.12, Math.cos(a) * 0.12], [Math.sin(a) * 0.3, 0.06, Math.cos(a) * 0.3], [Math.sin(a) * 0.46, 0.03, Math.cos(a) * 0.46], [Math.sin(a) * 0.5, 0.07, Math.cos(a) * 0.5]], 0.035, 8, 8), 'body', { mat: 'wood' }));
  }
  // brass inlay: an outer ring + an 8-point compass rose (thin flat diamonds)
  parts.push(part(at(torus(R - 0.12, 0.012, 3, 48), 0, h + 0.001, 0, PI / 2, 0, 0, 1, 1, 0.25), 'accent', { cast: false }));
  const dia = (len: number, wid: number) => { const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(wid, len * 0.3); s.lineTo(0, len); s.lineTo(-wid, len * 0.3); s.lineTo(0, 0); return new THREE.ExtrudeGeometry(s, { depth: 0.003, bevelEnabled: false }).rotateX(-PI / 2); };
  for (let i = 0; i < 8; i++) parts.push(part(at(dia(i % 2 ? 0.38 : 0.62, i % 2 ? 0.04 : 0.07), 0, h + 0.002, 0, 0, (i / 8) * PI * 2), 'accent', { cast: false }));
  // lazy susan + map
  parts.push(part(at(disc(0.3, 0.03, 28, 0.01), 0, h + 0.004, 0), 'body', { mat: 'wood', ao: 0.9 }));
  parts.push(part(at(rbox(0.42, 0.006, 0.3, 0.004), 0, h + 0.037, 0, 0, 0.3), 'secondary', { cast: false }));
  for (const e of [-1, 1]) parts.push(part(at(capsule(0.018, 0.3, 2, 8), e * 0.21 * Math.cos(0.3), h + 0.05, -e * 0.21 * Math.sin(0.3), PI / 2, 0.3 + PI / 2, 0), 'secondary'));
  for (let k = 0; k < 4; k++) parts.push(part(at(rbox(0.07, 0.003, 0.004), v.r(-0.12, 0.12), h + 0.041, v.r(-0.08, 0.08), 0, v.r(0, PI)), 'accent', { color: T.walnut, cast: false }));
  // task cards + quills at the seats
  for (let i = 0; i < seats; i++) {
    const a = (i / seats) * PI * 2 + PI / 8, r = R - 0.28;
    parts.push(part(at(rbox(0.16, 0.004, 0.11, 0.002), Math.sin(a) * r, h + 0.002, Math.cos(a) * r, 0, a + v.r(-0.25, 0.25)), 'secondary', { cast: false }));
    if (i % 2 === 0) parts.push(part(at(capsule(0.006, 0.16, 2, 5), Math.sin(a) * (r - 0.02) + 0.05, h + 0.015, Math.cos(a) * (r - 0.02), PI / 2 - 0.1, a + 1.1, 0), 'secondary', { color: T.trim, cast: false }));
  }
  // candlestick on the susan
  parts.push(part(at(lathe([[0.06, 0], [0.05, 0.015], [0.015, 0.03], [0.012, 0.12], [0.03, 0.13], [0.02, 0.14], [0, 0.14]], 12), 0.12, h + 0.034, 0.14), 'accent'));
  parts.push(part(at(cyl(0.018, 0.018, 0.09, 10), 0.12, h + 0.22, 0.14), 'secondary', { color: T.trim }));
  parts.push(part(at(lathe([[0, 0], [0.014, 0.012], [0.01, 0.035], [0, 0.055]], 8), 0.12, h + 0.265, 0.14), 'accent', { mat: 'flame', cast: false, ao: false, grad: [T.ember, T.flame, 0, 0.05] }));
  return { parts, footprint: { r: R }, solid: true, anchors: { top: h }, colors: { body: T.walnut, secondary: T.trim, accent: T.brass }, hero: 'compass-rose inlay, lazy susan + map, candlestick, scrolled feet' };
}

/**
 * Round Table seat: a low walnut chair (seat `h`) with a navy cushion, a rounded arch back with brass finials.
 * Front +z faces the table.
 */
export function buildRtChair(p: KitParams = {}, rng: Rng) {
  const h = p.h ?? 0.32, w = 0.36, d = 0.34;
  const parts = [part(at(rbox(w, 0.05, d, 0.02, 1), 0, h - 0.07, 0), 'secondary', { mat: 'wood' })];
  parts.push(part(at(rbox(w - 0.04, 0.06, d - 0.04, 0.03, 1), 0, h - 0.025, 0.01), 'body', { mat: 'fabric' }));
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(part(at(cyl(0.02, 0.014, h - 0.07, 8), sx * (w / 2 - 0.04), (h - 0.07) / 2, sz * (d / 2 - 0.04)), 'secondary', { mat: 'wood' }));
  const bh = typeof p.back === 'number' ? p.back : 0.36;
  for (const e of [-1, 1]) {
    parts.push(part(at(rbox(0.04, bh, 0.04, 0.012), e * (w / 2 - 0.03), h - 0.05 + bh / 2, -d / 2 + 0.03, -0.1), 'secondary', { mat: 'wood' }));
    parts.push(part(at(sphere(0.026, 8, 6), e * (w / 2 - 0.03), h - 0.03 + bh, -d / 2 + 0.03 - Math.sin(0.1) * bh), 'accent'));
  }
  parts.push(part(at(rbox(w - 0.08, bh * 0.62, 0.03, 0.02, 1), 0, h + bh * 0.52, -d / 2 + 0.035 - Math.sin(0.1) * bh * 0.5, -0.1), 'body', { mat: 'fabric' }));
  parts.push(part(at(torus((w - 0.08) / 2, 0.018, 4, 14, PI), 0, h + bh * 0.8, -d / 2 + 0.03 - Math.sin(0.1) * bh * 0.8, -0.1), 'secondary', { mat: 'wood' }));
  return { parts, footprint: { r: 0.22 }, solid: false, anchors: { seat: h }, colors: { body: LT.cushionNavy, secondary: T.walnut, accent: T.brass }, hero: 'arched upholstered back, brass finials' };
}

/**
 * Brass telescope on a walnut tripod (MEZ Observatory signature, "telescope brass"): tapering tube with ink rings and
 * a dew shield pointing up at the high window (+z, 35°), eyepiece at the viewer end, a finder scope, an equatorial head
 * with a counterweight, a brass spreader ring. Origin floor; front +z = where it points.
 */
export function buildTelescope(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), parts: Part[] = [];
  const apex = [0, 0.78, 0];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * PI * 2 + PI / 3;
    parts.push(part(rod(0.022, 0.016, 8, [apex[0] + Math.sin(a) * 0.04, apex[1] - 0.04, Math.cos(a) * 0.04], [Math.sin(a) * 0.3, 0, Math.cos(a) * 0.3]), 'secondary', { mat: 'wood' }));
    parts.push(part(at(sphere(0.024, 8, 6), Math.sin(a) * 0.3, 0.012, Math.cos(a) * 0.3), 'accent'));
  }
  parts.push(part(at(torus(0.16, 0.008, 4, 20), 0, 0.32, 0, PI / 2), 'accent', { cast: false }));
  parts.push(part(at(rbox(0.09, 0.08, 0.09, 0.025, 2), 0, apex[1] + 0.03, 0), 'accent'));
  parts.push(part(at(cyl(0.012, 0.012, 0.22, 8), 0, apex[1] - 0.02, -0.02, 0.9, 0, 0), 'secondary', { color: T.ink2 }));
  parts.push(part(at(sphere(0.04, 10, 8), 0, apex[1] - 0.09, -0.11), 'secondary', { color: T.ink2 }));
  const tilt = 0.62 + v.r(-0.05, 0.05), L = 0.9;
  const dir: V3 = [0, Math.sin(tilt), Math.cos(tilt)];
  const c0: V3 = [0, apex[1] + 0.11, -0.05];
  const P = (t: number): V3 => [c0[0], c0[1] + dir[1] * t, c0[2] + dir[2] * t];
  parts.push(part(rod(0.06, 0.075, 18, P(-0.32), P(L - 0.36)), 'body'));
  parts.push(part(rod(0.09, 0.085, 18, P(L - 0.36), P(L - 0.2)), 'body'));
  parts.push(part(rod(0.075, 0.075, 18, P(L - 0.2), P(L - 0.19)), 'secondary', { color: T.ink }));
  for (const t of [-0.28, -0.02, 0.24, L - 0.37]) parts.push(part(rod(t > L - 0.4 ? 0.093 : 0.078, t > L - 0.4 ? 0.093 : 0.078, 18, P(t), P(t + 0.025)), 'secondary', { color: T.ink2, cast: false }));
  parts.push(part(rod(0.02, 0.018, 10, P(-0.32), P(-0.42)), 'secondary', { color: T.ink2 }));
  parts.push(part(rod(0.028, 0.028, 10, P(-0.42), P(-0.46)), 'secondary', { color: T.ink }));
  const f = (t: number): V3 => { const q = P(t); return [q[0] + 0.09, q[1] + 0.06, q[2]]; };
  parts.push(part(rod(0.022, 0.018, 10, f(-0.05), f(0.25)), 'body'));
  for (const t of [0.0, 0.18]) parts.push(part(rod(0.006, 0.006, 4, P(t), f(t)), 'secondary', { color: T.ink2, cast: false }));
  return { parts, footprint: { r: 0.3 }, collider: { r: 0.25 }, solid: true, anchors: { eyepiece: P(-0.44) }, colors: { body: T.brass, secondary: T.walnut, accent: T.brass }, hero: 'brass tube with dew shield, finder scope, counterweight' };
}

/**
 * Orrery (Observatory centrepiece): a walnut drum plinth, a brass column, a glowing sun (`bulb`) and five planets on
 * brass arms at different heights, one ringed, one with a moon. Origin floor.
 */
export function buildOrrery(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), parts: Part[] = [];
  parts.push(part(lathe([[0, 0], [0.26, 0], [0.27, 0.02], [0.25, 0.04], [0.22, 0.05], [0.22, 0.4], [0.25, 0.42], [0.26, 0.45], [0, 0.45]], 24), 'secondary', { mat: 'wood' }));
  parts.push(part(at(torus(0.24, 0.008, 3, 24), 0, 0.2, 0, PI / 2), 'accent', { cast: false }));
  parts.push(part(at(cyl(0.018, 0.024, 0.5, 10), 0, 0.7, 0), 'accent'));
  parts.push(part(at(torus(0.3, 0.006, 3, 32), 0, 0.62, 0, PI / 2), 'accent', { cast: false })); // ecliptic ring
  parts.push(part(at(sphere(0.085, 16, 12), 0, 1.0, 0), 'bulb', { mat: 'bulb', cast: false, color: '#FFE2A8' }));
  const planets: [number, number, string][] = [[0.18, 0.045, T.rose], [0.3, 0.04, T.teal], [0.42, 0.06, T.butter], [0.52, 0.05, T.lavender], [0.6, 0.035, T.sage]];
  planets.forEach(([r, pr, c], i) => {
    const a = v.r(0, PI * 2), y = 0.66 + i * 0.07;
    parts.push(part(at(cyl(0.006, 0.006, r, 5), Math.sin(a) * r / 2, y, Math.cos(a) * r / 2, 0, a, PI / 2), 'accent', { cast: false }));
    parts.push(part(at(cyl(0.005, 0.005, 0.08, 4), Math.sin(a) * r, y + 0.04, Math.cos(a) * r), 'accent', { cast: false }));
    parts.push(part(at(sphere(pr, 12, 8), Math.sin(a) * r, y + 0.08 + pr, Math.cos(a) * r), 'body', { color: c }));
    if (i === 2) parts.push(part(at(torus(pr * 1.6, 0.008, 3, 20), Math.sin(a) * r, y + 0.08 + pr, Math.cos(a) * r, PI / 2 - 0.4, 0, 0.2), 'accent', { cast: false }));
    if (i === 3) parts.push(part(at(sphere(0.015, 8, 6), Math.sin(a) * r + 0.08, y + 0.1 + pr, Math.cos(a) * r), 'body', { color: T.trim, cast: false }));
  });
  return { parts, footprint: { r: 0.27 }, collider: { r: 0.27 }, solid: true, anchors: {}, colors: { body: T.teal, secondary: T.walnut, accent: T.brass }, hero: 'glowing sun, planets on brass arms, ringed giant' };
}

/**
 * Star canopy (the Observatory "star-map" ceiling, §5.5 MEZ ceiling 28): a navy panel with a rounded bevel hung on four
 * rods `hang` below the roof, scattered warm pin-stars (`bulb`), a butter crescent moon and cream constellation lines
 * on its underside. Origin = panel centre (its underside); w along x, d along z.
 */
export function buildStarCanopy(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 6, d = p.d ?? 4.5, hang = p.hang ?? 0.2;
  const parts = [part(at(rbox(w, 0.06, d, 0.03, 1), 0, 0.03, 0), 'body', { cast: false })];
  parts.push(part(at(rbox(w + 0.06, 0.05, 0.06, 0.02), 0, 0.02, d / 2), 'secondary', { cast: false }), part(at(rbox(w + 0.06, 0.05, 0.06, 0.02), 0, 0.02, -d / 2), 'secondary', { cast: false }));
  parts.push(part(at(rbox(0.06, 0.05, d, 0.02), w / 2, 0.02, 0), 'secondary', { cast: false }), part(at(rbox(0.06, 0.05, d, 0.02), -w / 2, 0.02, 0), 'secondary', { cast: false }));
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(part(at(cyl(0.008, 0.008, hang, 4), sx * (w / 2 - 0.3), 0.06 + hang / 2, sz * (d / 2 - 0.3)), 'accent', { cast: false }));
  const n = p.stars ?? Math.round(w * d * 2.2);
  for (let i = 0; i < n; i++) {
    const r = v.chance(0.15) ? 0.02 : 0.011;
    parts.push(part(at(sphere(r, 6, 4), v.r(-w / 2 + 0.1, w / 2 - 0.1), -0.002, v.r(-d / 2 + 0.1, d / 2 - 0.1), 0, 0, 0, 1, 0.5, 1), 'bulb', { mat: 'bulb', cast: false, color: '#FFE9C4' }));
  }
  // three constellations (dot-to-dot cream lines between brighter stars)
  const cons = [[[-2.2, -1.2], [-1.7, -1.5], [-1.2, -1.3], [-0.9, -0.8], [-1.4, -0.5]], [[0.6, 0.4], [1.0, 0.9], [1.6, 0.7], [2.0, 1.2]], [[-0.6, 1.1], [-0.2, 1.5], [0.2, 1.2]]];
  for (const c of cons) {
    const q = c.map(([x, z]) => [x * w / 6, z * d / 4.5]);
    q.forEach(([x, z], i) => {
      parts.push(part(at(sphere(0.026, 8, 6), x, -0.004, z, 0, 0, 0, 1, 0.5, 1), 'bulb', { mat: 'bulb', cast: false, color: '#FFE9C4' }));
      if (i) { const [x0, z0] = q[i - 1]; const L = Math.hypot(x - x0, z - z0); parts.push(part(at(rbox(L, 0.004, 0.01), (x + x0) / 2, -0.002, (z + z0) / 2, 0, -Math.atan2(z - z0, x - x0)), 'accent', { color: '#7F86AE', cast: false })); } // [RND m2 fix r1, cross-owner] dusty periwinkle (L* 56), not cream (L* 92): cream lines on the L* 26 navy were a top-10 greyCheck blob at pitOverview; the pin-stars (emissive) carry the sparkle
    });
  }
  parts.push(part(at(torus(0.16, 0.07, 8, 20, PI * 1.25), w * 0.3, -0.03, -d * 0.28, PI / 2, 0, 0.5, 1, 1, 0.45), 'accent', { color: T.butter, cast: false }));
  // [ENV fix m2 r2] its top reads as a skylight roof from the plan view (review: "two flat navy slabs"): dusk glass
  // panes in a walnut frame with mullions every ~1.1 m, and two diagonal sheen streaks per pane. Only the plan camera
  // (ceilings hidden) ever sees the top; all flat, non-casting, merged with the canopy.
  if (p.roof !== false) {
    const t0 = 0.06, nx = Math.max(1, Math.round(w / 1.1)), nz = Math.max(1, Math.round(d / 1.1)), px = w / nx, pz = d / nz;
    parts.push(part(at(rbox(w - 0.04, 0.01, d - 0.04), 0, t0 + 0.005, 0), 'body', { color: '#6F8698', cast: false, ao: false }));
    for (let i = 0; i <= nx; i++) parts.push(part(at(rbox(i % nx ? 0.06 : 0.1, 0.045, d), -w / 2 + i * px, t0 + 0.022, 0), 'secondary', { color: T.walnut, cast: false, ao: false }));
    for (let j = 0; j <= nz; j++) parts.push(part(at(rbox(w, 0.045, j % nz ? 0.06 : 0.1), 0, t0 + 0.023, -d / 2 + j * pz), 'secondary', { color: T.walnut, cast: false, ao: false }));
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const x = -w / 2 + (i + 0.5) * px, z = -d / 2 + (j + 0.5) * pz, s = Math.min(px, pz);
      parts.push(part(at(rbox(s * 0.55, 0.004, 0.07), x - s * 0.12, t0 + 0.012, z - s * 0.12, 0, PI / 4), 'body', { color: '#B7CAD3', cast: false, ao: false }));
      parts.push(part(at(rbox(s * 0.3, 0.004, 0.035), x + s * 0.06, t0 + 0.012, z + s * 0.04, 0, PI / 4), 'body', { color: '#A3B9C4', cast: false, ao: false }));
    }
  }
  return { parts, footprint: { w, d }, solid: false, anchors: {}, colors: { body: LT.navy, secondary: LT.navyDeep, accent: T.brass }, hero: 'pin-star field, constellations, crescent moon' };
}

/**
 * Star chart (Observatory wall, layout `starChart`): walnut frame, navy field, butter stars joined by cream lines, a
 * brass compass ring. Origin = the chart's centre on the wall face, front +z.
 */
export function buildStarChart(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 1.4, h = p.h ?? 0.9;
  const parts = [part(at(rbox(w, h, 0.04, 0.02, 1), 0, 0, 0.02), 'secondary', { mat: 'wood' }), part(at(rbox(w - 0.08, h - 0.08, 0.006, 0.004), 0, 0, 0.041), 'body', { cast: false })];
  parts.push(part(at(torus(h * 0.36, 0.006, 3, 40), 0, 0, 0.046), 'accent', { cast: false, color: T.brass }));
  const pts: [number, number][] = [];
  for (let i = 0; i < 22; i++) pts.push([v.r(-w / 2 + 0.08, w / 2 - 0.08), v.r(-h / 2 + 0.08, h / 2 - 0.08)]);
  pts.forEach(([x, y], i) => {
    parts.push(part(at(sphere(i % 4 ? 0.01 : 0.018, 6, 4), x, y, 0.046, 0, 0, 0, 1, 1, 0.4), 'accent', { color: T.butter, cast: false }));
    if (i % 4 && i < 16) { const [x0, y0] = pts[i - 1]; const L = Math.hypot(x - x0, y - y0); parts.push(part(at(rbox(L, 0.004, 0.003), (x + x0) / 2, (y + y0) / 2, 0.046, 0, 0, Math.atan2(y - y0, x - x0)), 'accent', { cast: false })); }
  });
  return { parts, footprint: { w, d: 0.05 }, solid: false, anchors: {}, colors: { body: LT.navy, secondary: T.walnut, accent: T.trim }, hero: 'constellation field + brass ring' };
}

/**
 * Hot-desk bench (MEZ rail row): one long oak top on ink trestles every ~1.6 m, a cable tray underneath, an ink
 * privacy lip at the back (+z of the sitters = the rail side, local −z here). Origin floor centre, front +z = sitters.
 */
export function buildBenchDesk(p: KitParams = {}, rng: Rng) {
  const w = p.w ?? 6.6, d = p.d ?? 0.45, h = p.h ?? 0.5;
  const parts = [part(at(slab(w, d, 0.04, 0.05, 0.012), 0, h - 0.04, 0), 'body', { mat: 'wood' })];
  const n = Math.max(2, Math.round(w / 1.6) + 1);
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + 0.12 + i * ((w - 0.24) / (n - 1));
    parts.push(part(at(rbox(0.05, h - 0.04, 0.04, 0.012), x, (h - 0.04) / 2, 0), 'secondary'));
    parts.push(part(at(rbox(0.06, 0.03, d - 0.04, 0.01), x, 0.015, 0), 'secondary'));
    parts.push(part(at(rbox(0.05, 0.03, d - 0.08, 0.01), x, h - 0.06, 0), 'secondary', { cast: false }));
  }
  parts.push(part(at(rbox(w - 0.3, 0.05, 0.1, 0.01), 0, h - 0.12, -d / 2 + 0.1), 'secondary', { cast: false, ao: 0.8 }));
  parts.push(part(at(rbox(w, 0.12, 0.025, 0.01), 0, h + 0.06, -d / 2 + 0.012), 'accent', { mat: 'wood' }));
  return { parts, footprint: { w, d }, solid: true, anchors: { top: h }, colors: { body: T.oak, secondary: T.ink2, accent: T.walnut }, hero: 'trestles + back lip' };
}

/** Laptop (hot desks): oat base with a key field, lid open ~105° with a dark screen and a sticker. Front +z. */
export function buildLaptop(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), open = p.open ?? 1.83, w = 0.3, d = 0.2;
  const parts = [part(at(rbox(w, 0.014, d, 0.006), 0, 0.007, 0), 'body', { mat: 'small' })];
  parts.push(part(at(rbox(w - 0.05, 0.002, d * 0.45, 0.001), 0, 0.015, -0.02), 'secondary', { mat: 'small', cast: false }));
  const lid = at(rbox(w, 0.01, d, 0.005), 0, 0.005, -d / 2);
  lid.rotateX(PI - open); lid.translate(0, 0.012, -d / 2);
  parts.push(part(lid, 'body', { mat: 'small' }));
  const scr = at(rbox(w - 0.03, 0.002, d - 0.03, 0.001), 0, 0.011, -d / 2);
  scr.rotateX(PI - open); scr.translate(0, 0.012, -d / 2);
  parts.push(part(scr, 'secondary', { mat: 'small', cast: false }));
  const st = at(sphere(0.018, 8, 6), v.r(-0.07, 0.07), -0.001, -d / 2 + v.r(-0.04, 0.04), 0, 0, 0, 1, 0.2, 1);
  st.rotateX(PI - open); st.translate(0, 0.012, -d / 2);
  parts.push(part(st, 'accent', { mat: 'small', cast: false, color: v.pick([T.butter, T.rose, T.teal]) }));
  return { parts, footprint: { w, d }, solid: false, anchors: {}, colors: { body: T.oat, secondary: T.screenOff, accent: T.butter }, small: true, hero: 'open lid + sticker' };
}

// ------------------------------------------------------------------------------------------------ stairs / slide
/** Crash mat (slide exit): a fat piped cushion mat with carry loops. Origin floor centre. */
export function buildCrashMat(p: KitParams = {}, rng: Rng) {
  const w = p.w ?? 1.3, d = p.d ?? 0.9, h = p.h ?? 0.07;
  const parts = [part(at(rbox(w, h, d, Math.min(0.035, h / 2 - 0.002), 2), 0, h / 2, 0), 'body', { mat: 'fabric', ao: false })];
  for (const e of [-1, 1]) parts.push(part(at(rbox(w - 0.04, 0.01, 0.01, 0.003), 0, h * 0.55, e * (d / 2 + 0.002)), 'accent', { cast: false }));
  for (const e of [-1, 1]) parts.push(part(at(rbox(0.01, 0.01, d - 0.04, 0.003), e * (w / 2 + 0.002), h * 0.55, 0), 'accent', { cast: false }));
  parts.push(part(at(rbox(w * 0.7, 0.004, 0.06, 0.002), 0, h + 0.001, 0), 'secondary', { cast: false })); // a stripe
  for (const e of [-1, 1]) parts.push(part(at(torus(0.05, 0.01, 3, 10, PI), e * (w / 2 + 0.01), h * 0.5, 0, 0, PI / 2, 0), 'accent', { cast: false }));
  return { parts, footprint: { w, d }, solid: false, anchors: { top: h }, colors: { body: T.teal, secondary: T.butter, accent: T.trim }, hero: 'piped edges + carry loops' };
}

/**
 * Slide gate (the mezzanine slide mouth): two walnut posts with brass ball caps under a butter arch (the slide's
 * colour), a row of pennants hanging from the arch. Origin floor centre, the opening across x (w).
 */
export function buildSlideGate(p: KitParams = {}, rng: Rng) {
  const w = p.w ?? 1.1, H = p.h ?? 1.3;
  const parts: Part[] = [];
  for (const e of [-1, 1]) {
    parts.push(part(at(rbox(0.07, H, 0.07, 0.02, 1), e * w / 2, H / 2, 0), 'secondary', { mat: 'wood' }));
    parts.push(part(at(rbox(0.12, 0.04, 0.12, 0.012), e * w / 2, 0.02, 0), 'secondary', { mat: 'wood' }));
  }
  parts.push(part(at(torus(w / 2, 0.045, 8, 24, PI), 0, H, 0), 'body'));
  parts.push(part(at(torus(w / 2 - 0.08, 0.012, 3, 20, PI), 0, H, 0.03), 'accent', { cast: false }));
  const tri = new THREE.Shape(); tri.moveTo(-0.05, 0); tri.lineTo(0.05, 0); tri.lineTo(0, -0.12); tri.lineTo(-0.05, 0);
  const cols = [T.teal, T.trim, T.lavender, T.trim, T.teal];
  for (let i = 0; i < 5; i++) {
    const a = PI * (0.18 + i * 0.16);
    parts.push(part(at(new THREE.ExtrudeGeometry(tri, { depth: 0.004, bevelEnabled: false }), Math.cos(a) * (w / 2 - 0.02), H + Math.sin(a) * (w / 2 - 0.02) - 0.04, 0), 'accent', { color: cols[i], cast: false, mat: 'fabric' }));
  }
  return { parts, footprint: { w, d: 0.12 }, solid: false, anchors: {}, colors: { body: '#E9C477', secondary: T.walnut, accent: T.brass }, hero: 'butter arch with pennants' };
}

/**
 * Rail flower box (hangs on the outside of the mezzanine balustrade): a teal trough on brass hooks, foliage blobs and
 * trailing strands spilling down, a few flowers. Origin = the trough's top-centre at the rail face; +z = outward.
 */
export function buildRailBox(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 1.1, h = 0.2, d = 0.2;
  const parts = [part(at(rbox(w, h, d, 0.04, 2), 0, -h / 2, d / 2 + 0.01), 'body')];
  parts.push(part(at(rbox(w + 0.03, 0.035, d + 0.03, 0.012), 0, -0.012, d / 2 + 0.01), 'accent'));
  for (const e of [-1, 1]) parts.push(part(at(torus(0.05, 0.008, 3, 10, PI), e * (w / 2 - 0.15), 0.0, 0.0, 0, PI / 2, 0), 'accent', { cast: false }));
  const n = Math.max(2, Math.round(w / 0.26));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (i + 0.5) * (w / n);
    parts.push(part(at(sphere(v.r(0.085, 0.105), 8, 5), x, 0.02, d / 2 + v.r(-0.03, 0.03), 0, 0, 0, 1.2, 0.7, 1.05), 'body', { mat: 'foliage', grad: [T.leafDark, T.leafLight, -0.1, 0.14] }));
    if (v.chance(0.85)) {
      const len = v.r(0.25, 0.55), xs = x + v.r(-0.08, 0.08);
      const pts = []; for (let k = 0; k <= 4; k++) { const t = k / 4; pts.push([xs + Math.sin(t * 5 + i) * 0.03, -0.02 - t * len, d + 0.03 + Math.sin(t * PI) * 0.05]); }
      parts.push(part(tube(pts, 0.012, 6, 4), 'body', { mat: 'foliage', grad: [T.leafDark, T.leafLight, -len, 0], cast: false }));
      for (let k = 1; k < 4; k++) { const q = pts[k]; parts.push(part(at(sphere(0.028, 5, 3), q[0] + 0.02, q[1], q[2] + 0.01, 0, 0, 0, 1, 0.6, 1.2), 'body', { mat: 'foliage', grad: [T.leafDark, T.leafLight, -len, 0], cast: false })); }
    }
  }
  for (let i = 0; i < 4; i++) parts.push(part(at(sphere(0.026, 6, 5), v.r(-w / 2 + 0.1, w / 2 - 0.1), 0.14, d / 2 + v.r(-0.05, 0.05)), 'accent', { color: v.pick([T.rose, T.butter, T.trim, T.lavender]), cast: false }));
  return { parts, footprint: { w, d }, solid: false, anchors: {}, colors: { body: T.teal, accent: T.trim }, hero: 'trailing strands over the balustrade' };
}

/**
 * Cubby shelf (under the stairs): a low walnut cabinet of square cubbies with baskets, books and a folded throw.
 * Origin floor centre, front +z.
 */
export function buildCubbies(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 1.5, h = p.h ?? 0.9, d = p.d ?? 0.36, cols = typeof p.cols === 'number' ? p.cols : 3, rows = p.rows ?? 2;
  const t = 0.024, parts = [part(at(rbox(w, 0.04, d, 0.012), 0, h - 0.02, 0), 'body', { mat: 'wood' })];
  parts.push(part(at(rbox(w, 0.06, d - 0.02, 0.012), 0, 0.03, -0.01), 'body', { mat: 'wood', ao: 0.7 }));
  parts.push(part(at(rbox(w - 0.02, h - 0.06, 0.012, 0.004), 0, h / 2, -d / 2 + 0.006), 'body', { mat: 'wood', ao: 0.6 }));
  for (let i = 0; i <= cols; i++) parts.push(part(at(rbox(t, h - 0.06, d, 0.008), -w / 2 + t / 2 + i * ((w - t) / cols), h / 2 + 0.01, 0), 'body', { mat: 'wood' }));
  const ch = (h - 0.06 - t) / rows, cw = (w - t) / cols;
  for (let r = 1; r < rows; r++) parts.push(part(at(rbox(w - 0.02, t, d, 0.008), 0, 0.06 + r * ch, 0), 'body', { mat: 'wood' }));
  const off = v.int(3);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = -w / 2 + t / 2 + (c + 0.5) * cw, y = 0.06 + r * ch + (r ? t / 2 : 0);
    const k = (r * cols + c + off) % 3; // an even mix: at most a third of the cubbies hold a (heavier) folded throw
    if (k === 0) { // basket
      parts.push(part(at(rbox(cw - 0.06, ch * 0.62, d - 0.08, 0.03, 1), x, y + ch * 0.31, 0.02), 'secondary', { mat: 'fabric' }));
      parts.push(part(at(torus(0.035, 0.008, 3, 10, PI), x, y + ch * 0.5, d / 2 - 0.02), 'accent', { cast: false }));
    } else if (k === 1) { // books
      const nb = 3 + v.int(3);
      for (let b = 0; b < nb; b++) parts.push(part(at(rbox(0.024, ch * v.r(0.55, 0.8), d * 0.7, 0.004), x - cw / 2 + 0.06 + b * 0.04, y + ch * 0.33, 0.0, 0, 0, b === nb - 1 ? 0.25 : 0), 'accent', { color: v.pick([T.teal, T.butter, T.trim, T.lavender, T.sage]), cast: false }));
    } else { // folded throw
      for (let f = 0; f < 2; f++) parts.push(part(at(rbox(cw - 0.08 - f * 0.03, 0.06, d - 0.1, 0.025, 1), x, y + 0.032 + f * 0.062, 0.02), 'secondary', { mat: 'fabric', color: [T.rose, T.lavender, LT.quiltDusk][(f + c + r) % 3] }));
    }
  }
  return { parts, footprint: { w, d }, solid: true, anchors: { top: h }, colors: { body: T.walnut, secondary: T.oat, accent: T.brass }, hero: 'cubbies with baskets, books, folded throws' };
}

/** The lounge set, merged into `KIT` by registry.ts (names unique across the kit files). */
export const LOUNGE_KIT = Object.freeze({
  espressoBar: buildEspressoBar, cafeMenu: buildCafeMenu, marqueeCup: buildMarqueeCup, bistroChair: buildBistroChair, banquette: buildBanquette,
  foosball: buildFoosball, bunting: buildBunting, sandwichBoard: buildSandwichBoard, treat: buildTreat,
  bunk: buildBunk, nightMoon: buildNightMoon, mobile: buildMobile, slippers: buildSlippers,
  roundTable: buildRoundTable, rtChair: buildRtChair, telescope: buildTelescope, orrery: buildOrrery, starCanopy: buildStarCanopy,
  starChart: buildStarChart, benchDesk: buildBenchDesk, laptop: buildLaptop,
  crashMat: buildCrashMat, slideGate: buildSlideGate, railBox: buildRailBox, cubbies: buildCubbies,
});
/** Signature (6k-tri budget) members of the lounge set. */
export const LOUNGE_SIGNATURE = Object.freeze(['espressoBar', 'roundTable', 'telescope', 'orrery', 'starCanopy', 'foosball', 'banquette', 'bunk', 'benchDesk']);
/** `?sheet=props` rows. */
export const LOUNGE_SHEET: readonly SheetEntry[] = Object.freeze<SheetEntry[]>([
  ['espressoBar', {}, 'espressoBar ★'], ['cafeMenu', { y0: 1.2 }, 'cafe menu'], ['marqueeCup', {}, 'marquee cup'], ['bistroChair', {}, 'bistro chair'],
  ['banquette', { w: 2.0 }, 'banquette ★'], ['foosball', {}, 'foosball ★'], ['bunting', { len: 1.6, y0: 1.0 }, 'bunting'], ['sandwichBoard', {}, 'sandwich board'],
  ['treat', { kind: 'donut' }, 'treat · donut'], ['treat', { kind: 'croissant' }, 'treat · croissant'],
  ['bunk', {}, 'bunk ★'], ['nightMoon', {}, 'night moon'], ['mobile', { y0: 1.3 }, 'star mobile'], ['slippers', {}, 'slippers'],
  ['roundTable', {}, 'roundTable ★'], ['rtChair', {}, 'round-table chair'], ['telescope', {}, 'telescope ★'], ['orrery', {}, 'orrery ★'],
  ['starCanopy', { w: 1.6, d: 1.2, stars: 30 }, 'star canopy ★'], ['starChart', {}, 'star chart'], ['benchDesk', { w: 1.8 }, 'bench desk'], ['laptop', {}, 'laptop'],
  ['crashMat', {}, 'crash mat'], ['slideGate', {}, 'slide gate'], ['railBox', {}, 'rail flower box'], ['cubbies', {}, 'cubbies'],
]);
