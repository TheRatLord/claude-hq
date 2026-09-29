/**
 * Prop kit: Lab + Engine Room builders (M2 breadth, ENV 4/5). Same contract as the rest of the kit (§7.5):
 * `build<Name>(params, rng) → {parts, footprint, solid, anchors, colors}`, origin = floor point (wall items: their
 * bottom centre), front = +z, bevelled everything, ≤ 3 palette tokens a prop (+ the literal multi-token groups the
 * table allows: bottles / liquids / tool handles, like book spines), ≤ 1.5k tris (signature ≤ 6k).
 * - Lab: `fumeHood` ★ (signature: lit sash, glassware, exhaust duct), `labBench` (epoxy top, reagent riser, optional
 *   sink), `testLight` (TEST lightbox; the live lenses are build/labLight.ts), `safetyShower`, `gasCylinders`,
 *   `labCart`, `labKit` (microscope / test tubes / flasks / centrifuge), `sampleFridge`.
 * - Engine Room ("shell workshop"): `boiler` ★ (signature: riveted tank, glowing firebox, pipe to STAT's boiler
 *   gauge on the glass), `shellBench` (butcher block on a steel frame), `crt` (beige terminal: the Shellys' kin),
 *   `rackBay` (the housing behind STAT's CPU rack cabinets), `toolWall` (shadow-board pegboard), `toolChest`,
 *   `oilDrum`, `duct` (overhead), `cageLamp`, `cardDeck` (the fern's watering can is amenity.ts's).
 * Owner: ENV.
 */
import { rbox, cyl, lathe, sphere, torus, tube, slab, disc, at, part, vary } from './core.ts';
import type { KitParams, MatClass, Part, Rng, SheetEntry, SlotName, V3 } from './core.ts';
import { T } from './tokens.ts';
import { ENV, WORKSPACE } from '../../../../../shared/palette.ts';

const PI = Math.PI;
/** Derived tokens (documented L*): lab steel cabinets (tile teal-grey, L* 65), hood enamel (L* 30, the §5.5 hero
 *  value), epoxy worktop cream (L* 88), pale sash glass (L* 78), beige CRT plastic (L* 82), CRT glass (L* 22),
 *  boiler enamel (fabric teal L* 48), iron (ink2 L* 35), pegboard (kraft-oat L* 72). */
export const WS = Object.freeze({
  labSteel: '#93A7A5', hoodEnamel: '#3E4A4C', epoxy: '#E4DED2', sash: '#A9C9CF', crtBeige: '#D8CCB4', crtGlass: '#2F3A36',
  crtText: '#7E9E86', boiler: T.fabricTeal, iron: T.ink2, peg: '#C9B99C', rubber: '#3B4442', felt: '#3C6B52',
});
/** Liquids / bottle glass (a multi-token group, like book spines): cool jewels + papers, never a status colour. */
const LIQUIDS = [ENV.teal, ENV.lavender, ENV.sage, ENV.butter, '#8FB9C9', WORKSPACE[2].hex];
/** Tool handles on the pegboard / bench (multi-token group). */
const HANDLES = [ENV.teal, ENV.butter, ENV.lavender, T.tealDeep, ENV.sage];

/** A beaker / flask / bottle lathe of height h (glass body + liquid band as two parts). kind: beaker | flask | bottle */
function glass(kind: 'beaker' | 'flask' | 'bottle', x: number, y: number, z: number, h: number, liquid: string, o: { seg?: number; glass?: string; mat?: MatClass; dry?: boolean; liquidMat?: MatClass } = {}): Part[] {
  const r = kind === 'flask' ? h * 0.42 : kind === 'bottle' ? h * 0.26 : h * 0.34;
  const prof = kind === 'flask' ? [[0, 0], [r, 0], [r * 1.02, h * 0.12], [r * 0.3, h * 0.72], [r * 0.3, h], [r * 0.36, h], [0, h]]
    : kind === 'bottle' ? [[0, 0], [r, 0], [r, h * 0.62], [r * 0.45, h * 0.8], [r * 0.45, h * 0.95], [0, h * 0.95]]
      : [[0, 0], [r, 0], [r, h], [r * 1.08, h], [0, h]];
  const out = [part(at(lathe(prof, o.seg ?? 10), x, y, z), 'accent', { color: o.glass ?? T.bottle, cast: false, mat: o.mat ?? 'small' })];
  if (o.dry) return out;
  const lh = h * (kind === 'bottle' ? 0.55 : 0.45);
  const lr = kind === 'flask' ? r * 0.9 : r * 1.04;
  out.push(part(at(lathe(kind === 'flask' ? [[0, 0], [lr * 1.04, 0], [lr * 0.8, lh * 0.7], [0, lh * 0.72]] : [[0, 0], [lr, 0], [lr, lh], [0, lh]], o.seg ?? 10), x, y + 0.002, z), 'accent', { color: liquid, cast: false, mat: o.liquidMat ?? o.mat ?? 'small' }));
  return out;
}

// ============================================================================================================ LAB
/**
 * ★ Fume hood (Lab signature, §5.5 hero value L* 30): enamel base cabinet with two doors, cream epoxy worktop, a glass
 * sash with a brass pull bar over a lit interior (a bulb strip under the canopy, glowing flasks), a hazard band on
 * the canopy, an airflow tell-tale and a round exhaust duct up to the ceiling (`duct` m).
 */
export function buildFumeHood(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 1.1, h = p.h ?? 1.9, d = p.d ?? 0.8, duct = p.duct ?? 0.9;
  const baseH = 0.66, topY = baseH + 0.04, canopy = 0.3;
  const parts = [
    part(at(rbox(w, baseH, d - 0.04, 0.03, 1), 0, baseH / 2, -0.02), 'body'),
    part(at(rbox(w - 0.06, 0.07, 0.03, 0.01), 0, 0.035, d / 2 - 0.07), 'body', { ao: 0.6 }), // toe kick shadow
    part(at(slab(w + 0.04, d + 0.02, 0.04, 0.02, 0.012), 0, baseH, 0), 'secondary'),
  ];
  for (const e of [-1, 1]) {
    parts.push(part(at(rbox(w / 2 - 0.06, baseH - 0.16, 0.02, 0.01), e * (w / 4), baseH / 2 + 0.03, d / 2 - 0.035), 'body', { ao: 0.9 }));
    parts.push(part(at(cyl(0.012, 0.012, 0.16, 8), e * 0.07, baseH / 2 + 0.06, d / 2 - 0.01), 'accent'));
  }
  const upH = h - topY - canopy;
  // cheeks, back, canopy (rounded front lip), hazard band
  for (const e of [-1, 1]) parts.push(part(at(rbox(0.07, upH + canopy, d, 0.025, 1), e * (w / 2 - 0.035), topY + (upH + canopy) / 2, 0), 'body'));
  parts.push(part(at(rbox(w - 0.1, upH, 0.04, 0.01), 0, topY + upH / 2, -d / 2 + 0.03), 'secondary', { ao: 0.7 }));
  parts.push(part(at(rbox(w, canopy, d, 0.05, 2), 0, h - canopy / 2, 0), 'body'));
  const n = 9;
  for (let i = 0; i < n; i++) parts.push(part(at(rbox(w / n - 0.012, 0.06, 0.012, 0.004), -w / 2 + (i + 0.5) * (w / n), h - canopy + 0.07, d / 2 + 0.004, 0, 0, 0.5), 'accent', { color: i % 2 ? T.ink : T.butter, cast: false }));
  // interior light strip (bulb) + back baffle slots
  parts.push(part(at(rbox(w - 0.2, 0.025, 0.05, 0.01), 0, h - canopy - 0.02, d / 2 - 0.2), 'bulb', { mat: 'bulb', cast: false }));
  for (let i = 0; i < 3; i++) parts.push(part(at(rbox(w - 0.3, 0.02, 0.01), 0, topY + upH * (0.3 + i * 0.22), -d / 2 + 0.056), 'body', { cast: false, ao: 0.5 }));
  // sash: pale glass pane in a thin frame + a brass pull bar
  const sashH = upH * 0.62, sashY = topY + upH - sashH / 2 - 0.02;
  parts.push(part(at(rbox(w - 0.14, sashH, 0.012, 0.004), 0, sashY, d / 2 - 0.02), 'accent', { color: WS.sash, cast: false }));
  for (const y of [sashY - sashH / 2, sashY + sashH / 2]) parts.push(part(at(rbox(w - 0.12, 0.03, 0.03, 0.01), 0, y, d / 2 - 0.02), 'body'));
  parts.push(part(at(cyl(0.013, 0.013, w * 0.6, 10), 0, sashY - sashH / 2 - 0.045, d / 2 + 0.02, 0, 0, PI / 2), 'accent', { color: T.brass }));
  for (const e of [-1, 1]) parts.push(part(at(rbox(0.02, 0.05, 0.05, 0.006), e * w * 0.3, sashY - sashH / 2 - 0.03, d / 2 + 0.0), 'accent', { color: T.brass }));
  // glassware inside (on the worktop): a glowing round-bottom flask on a ring stand, beakers, a bottle
  const wy = topY;
  parts.push(part(at(disc(0.09, 0.012, 14, 0.004), -0.22, wy, -0.08), 'secondary', { color: T.ink2 }));
  parts.push(part(at(cyl(0.008, 0.008, 0.42, 6), -0.22, wy + 0.21, -0.14), 'secondary', { color: T.ink2, cast: false }));
  parts.push(part(at(torus(0.06, 0.006, 4, 12), -0.22, wy + 0.2, -0.08, PI / 2), 'secondary', { color: T.ink2, cast: false }));
  parts.push(part(at(sphere(0.075, 14, 10), -0.22, wy + 0.25, -0.08), 'bulb', { mat: 'bulb', color: ENV.sage, cast: false }));
  parts.push(part(at(cyl(0.018, 0.018, 0.14, 8), -0.22, wy + 0.36, -0.08), 'accent', { color: T.bottle, cast: false }));
  parts.push(...glass('beaker', 0.05, wy, 0.05, 0.13, v.pick(LIQUIDS), { mat: 'plain' }));
  parts.push(...glass('flask', 0.26, wy, -0.05, 0.2, ENV.lavender, { mat: 'plain' }));
  parts.push(...glass('bottle', 0.34, wy, 0.12, 0.18, T.tealDeep, { mat: 'plain' }));
  // airflow tell-tale: a little box on the right cheek with a butter ribbon
  parts.push(part(at(rbox(0.08, 0.1, 0.04, 0.012), w / 2 - 0.035, topY + upH * 0.75, d / 2 + 0.02), 'secondary'));
  parts.push(part(at(rbox(0.012, 0.09, 0.004), w / 2 - 0.035, topY + upH * 0.75 - 0.09, d / 2 + 0.04, 0.35), 'accent', { color: T.butter, cast: false }));
  // exhaust duct to the ceiling: collar, duct, flange rings
  parts.push(part(at(cyl(0.2, 0.24, 0.08, 20), 0, h + 0.04, -0.05), 'body'));
  parts.push(part(at(cyl(0.16, 0.16, duct, 20, true), 0, h + duct / 2, -0.05), 'secondary', { color: T.steel }));
  for (const y of [h + 0.2, h + duct - 0.08]) parts.push(part(at(torus(0.165, 0.014, 4, 20), 0, y, -0.05, PI / 2), 'secondary', { color: T.ink2, cast: false }));
  return { parts, footprint: { w, d }, solid: true, anchors: { top: topY, glow: [-0.22, wy + 0.25, -0.08] }, colors: { body: WS.hoodEnamel, secondary: WS.epoxy, accent: T.butter }, hero: 'lit sash + glowing flask, hazard band, exhaust duct' };
}

/**
 * Lab bench: steel cabinet run (drawers + doors with bar pulls), overhanging cream epoxy top, a reagent riser with
 * coloured bottles at the back; `sink` swaps a drawer bank for a basin + gooseneck tap and a drying peg rack.
 */
export function buildLabBench(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 1.8, h = p.h ?? 0.7, d = p.d ?? 0.7;
  const parts = [
    part(at(rbox(w - 0.04, h - 0.04, d - 0.1, 0.02, 1), 0, (h - 0.04) / 2, -0.05), 'body'),
    part(at(rbox(w - 0.1, 0.07, 0.03, 0.008), 0, 0.035, d / 2 - 0.12), 'body', { ao: 0.55 }),
    part(at(slab(w + 0.03, d + 0.02, 0.035, 0.02, 0.012), 0, h - 0.035, 0), 'secondary'),
  ];
  const bays = Math.max(2, Math.round(w / 0.45));
  const bw = (w - 0.06) / bays;
  for (let i = 0; i < bays; i++) {
    const x = -w / 2 + 0.03 + (i + 0.5) * bw;
    if (i % 2 === 0) { // drawer bank: 3 drawers
      for (let k = 0; k < 3; k++) {
        const dh = (h - 0.2) / 3, y = 0.1 + dh * (k + 0.5);
        parts.push(part(at(rbox(bw - 0.03, dh - 0.02, 0.018, 0.006), x, y, d / 2 - 0.1), 'body', { ao: 0.92 }));
        parts.push(part(at(rbox(bw * 0.4, 0.014, 0.02, 0.005), x, y + dh * 0.22, d / 2 - 0.08), 'accent', { cast: false }));
      }
    } else {
      parts.push(part(at(rbox(bw - 0.03, h - 0.2, 0.018, 0.006), x, 0.1 + (h - 0.2) / 2, d / 2 - 0.1), 'body', { ao: 0.92 }));
      parts.push(part(at(rbox(0.014, 0.12, 0.02, 0.005), x + bw * 0.34, h * 0.62, d / 2 - 0.08), 'accent', { cast: false }));
    }
  }
  if (p.sink) {
    parts.push(part(at(rbox(0.46, 0.012, 0.34, 0.004), -w * 0.2, h + 0.001, 0.02), 'accent', { color: T.ink2, cast: false })); // basin shadow
    parts.push(part(at(torus(0.012, 0.004, 3, 10), -w * 0.2, h + 0.008, 0.02, PI / 2), 'accent', { color: T.steel, cast: false }));
    parts.push(part(tube([[-w * 0.2, h, -d / 2 + 0.1], [-w * 0.2, h + 0.36, -d / 2 + 0.1], [-w * 0.2, h + 0.4, -d / 2 + 0.2], [-w * 0.2, h + 0.3, -d / 2 + 0.28]], 0.014, 12, 6), 'accent', { color: T.steel }));
    for (const e of [-1, 1]) parts.push(part(at(rbox(0.05, 0.03, 0.03, 0.01), -w * 0.2 + e * 0.07, h + 0.03, -d / 2 + 0.1), 'accent', { color: e > 0 ? T.tealDeep : T.rose, cast: false }));
    // drying peg rack with upturned flasks
    parts.push(part(at(rbox(0.5, 0.36, 0.02, 0.008), w * 0.2, h + 0.18, -d / 2 + 0.06), 'accent', { color: '#56727A' }));
    for (let i = 0; i < 6; i++) {
      const x = w * 0.2 - 0.2 + (i % 3) * 0.2, y = h + 0.1 + Math.floor(i / 3) * 0.16;
      parts.push(part(at(cyl(0.005, 0.005, 0.07, 5), x, y, -d / 2 + 0.1, PI / 2 - 0.4), 'body', { cast: false, mat: 'small' }));
      if (v.chance(0.7)) parts.push(part(at(lathe([[0.0, 0], [0.03, 0.01], [0.04, 0.05], [0.012, 0.1], [0, 0.1]], 8), x, y + 0.06, -d / 2 + 0.12, PI), 'accent', { color: T.bottle, cast: false, mat: 'small' }));
    }
  } else if (p.riser !== false) {
    const ry = h + 0.36;
    for (const e of [-1, 1]) parts.push(part(at(rbox(0.024, 0.36, 0.024, 0.01), e * (w / 2 - 0.12), h + 0.18, -d / 2 + 0.08), 'accent'));
    parts.push(part(at(slab(w - 0.16, 0.16, 0.025, 0.01, 0.008), 0, ry - 0.025, -d / 2 + 0.1), 'secondary'));
    parts.push(part(at(rbox(w - 0.2, 0.012, 0.012), 0, ry + 0.035, -d / 2 + 0.17), 'accent', { cast: false })); // guard rail
    const nb = Math.floor((w - 0.3) / 0.17);
    for (let i = 0; i < nb; i++) {
      if (v.chance(0.18)) continue;
      const x = -w / 2 + 0.2 + i * 0.17 + v.r(-0.02, 0.02), hh = v.r(0.1, 0.17);
      parts.push(...glass('bottle', x, ry, -d / 2 + 0.1, hh, v.pick(LIQUIDS), { glass: v.pick(LIQUIDS), seg: 7, mat: 'plain', dry: true }));
    }
  }
  return { parts, footprint: { w, d }, solid: true, anchors: { top: h }, colors: { body: WS.labSteel, secondary: WS.epoxy, accent: T.ink2 }, hero: p.sink ? 'gooseneck tap + drying pegs' : 'reagent riser with bottles' };
}

/** Block-letter glyphs (segment boxes) for plaques: T, E, S. Returns parts in the plane z (letter height lh). */
function letters(str: string, x0: number, y0: number, z: number, lh: number, slot: SlotName, o: { color?: string } = {}): Part[] {
  const t = lh * 0.2, lw = lh * 0.7, gap = lh * 0.28, out: Part[] = [];
  const seg = (x: number, y: number, w: number, h: number) => out.push(part(at(rbox(w, h, 0.006, 0.002), x, y, z), slot, { cast: false, color: o.color }));
  let x = x0 - ((str.length * lw + (str.length - 1) * gap) / 2);
  for (const ch of str) {
    const cx = x + lw / 2;
    if (ch === 'T') { seg(cx, y0 + lh / 2 - t / 2, lw, t); seg(cx, y0 - t / 2, t, lh - t); }
    else if (ch === 'E') { seg(x + t / 2, y0, t, lh); for (const yy of [lh / 2 - t / 2, 0, -lh / 2 + t / 2]) seg(cx + t / 2, y0 + yy, lw - t, t); }
    else if (ch === 'S') {
      for (const yy of [lh / 2 - t / 2, 0, -lh / 2 + t / 2]) seg(cx, y0 + yy, lw, t);
      seg(x + t / 2, y0 + lh / 4, t, lh / 2 - t); seg(x + lw - t / 2, y0 - lh / 4, t, lh / 2 - t);
    }
    x += lw + gap;
  }
  return out;
}

/**
 * TEST lightbox (Lab, §6.7 "TEST light green / red"): an ink housing with three brass-bezelled lens cups (red · amber ·
 * green; the lit lenses are build/labLight.ts, placed from `anchors.lenses`), a cream plaque with block letters
 * TEST, hung from two ceiling rods (`hang` m).
 */
export function buildTestLight(p: KitParams = {}, rng: Rng) {
  const w = 0.62, hh = 0.24, hang = p.hang ?? 0.6;
  const parts = [part(at(rbox(w, hh, 0.1, 0.06, 2), 0, 0, 0), 'body')];
  const lenses: { x: number; y: number; z: number; r: number }[] = [];
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * 0.19;
    parts.push(part(at(torus(0.068, 0.014, 4, 16), x, 0, 0.052), 'accent'));
    parts.push(part(at(cyl(0.066, 0.066, 0.02, 18), x, 0, 0.045, PI / 2), 'secondary', { cast: false })); // dark lens cup
    parts.push(part(at(rbox(0.13, 0.02, 0.06, 0.008), x, 0.078, 0.07, -0.25), 'body', { cast: false })); // visor
    lenses.push({ x, y: 0, z: 0.058, r: 0.056 });
  }
  // plaque under the lights
  parts.push(part(at(rbox(0.46, 0.13, 0.02, 0.03, 1), 0, -0.21, 0.01), 'secondary', { color: T.trim }));
  parts.push(...letters('TEST', 0, -0.21, 0.023, 0.075, 'body'));
  for (const e of [-1, 1]) {
    parts.push(part(at(cyl(0.008, 0.008, hang, 5), e * 0.22, hh / 2 + hang / 2, 0), 'secondary', { color: T.ink2, cast: false }));
    parts.push(part(at(disc(0.03, 0.012, 10, 0.004), e * 0.22, hh / 2 + hang - 0.012, 0), 'accent'));
  }
  return { parts, footprint: { w, d: 0.1 }, solid: false, anchors: { lenses }, colors: { body: T.ink, secondary: '#1F2123', accent: T.brass }, hero: 'three bezelled lenses + TEST plaque' };
}

/** Safety shower + eyewash (Lab): floor flange, steel riser, a sage cone head, a butter pull rod with a triangle
 *  handle, an eyewash bowl on a side arm, a sage wall sign with a cream cross. */
export function buildSafetyShower(p: KitParams = {}, rng: Rng) {
  const H = p.h ?? 2.25;
  const parts = [
    part(at(disc(0.12, 0.03, 16, 0.01), 0, 0, 0), 'secondary'),
    part(at(cyl(0.028, 0.028, H, 10), 0, H / 2, 0), 'secondary'),
    part(tube([[0, H - 0.02, 0], [0, H + 0.06, 0.05], [0, H + 0.06, 0.3]], 0.026, 8, 8), 'secondary'),
    part(at(lathe([[0.02, 0.1], [0.05, 0.08], [0.16, 0.0], [0.17, -0.02], [0.0, -0.02]], 20), 0, H - 0.08, 0.36), 'body'),
    part(at(cyl(0.006, 0.006, 0.6, 5), 0.1, H - 0.34, 0.33), 'accent', { cast: false }),
  ];
  parts.push(part(tube([[0.1, H - 0.64, 0.33], [0.04, H - 0.76, 0.33], [0.16, H - 0.76, 0.33], [0.1, H - 0.64, 0.33]], 0.01, 8, 4), 'accent'));
  // eyewash: side arm + bowl
  parts.push(part(tube([[0, 0.9, 0], [0.06, 0.95, 0.12], [0.06, 0.95, 0.26]], 0.02, 8, 6), 'secondary'));
  parts.push(part(at(lathe([[0.02, -0.03], [0.1, 0.0], [0.13, 0.05], [0.12, 0.05], [0.0, 0.0]], 18), 0.06, 0.95, 0.3), 'body'));
  parts.push(part(at(rbox(0.16, 0.05, 0.04, 0.015), 0.06, 0.92, 0.46), 'accent'));
  // wall sign (behind the riser)
  parts.push(part(at(rbox(0.34, 0.34, 0.02, 0.04, 1), 0, 1.72, -0.06), 'body'));
  parts.push(part(at(rbox(0.2, 0.06, 0.006), 0, 1.72, -0.047), 'accent', { color: T.trim, cast: false }), part(at(rbox(0.06, 0.2, 0.006), 0, 1.72, -0.046), 'accent', { color: T.trim, cast: false }));
  return { parts, footprint: { r: 0.18 }, collider: { r: 0.18 }, solid: false, anchors: {}, colors: { body: T.sage, secondary: T.steel, accent: T.butter }, hero: 'cone head + triangle pull handle' };
}

/** Gas cylinders (Lab), chained to a wall bracket: tall domed cylinders with brass valves, a coloured shoulder band. */
export function buildGasCylinders(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), n = p.n ?? 3, parts: Part[] = [];
  const cols = [T.tealDeep, T.sage, WS.hoodEnamel, T.lavender];
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * 0.25, hh = v.r(1.12, 1.3), r = 0.1;
    parts.push(part(at(lathe([[0, 0], [r - 0.01, 0], [r, 0.02], [r, hh * 0.84], [r * 0.7, hh * 0.95], [0.03, hh], [0, hh]], 16), x, 0, 0), 'body', { color: cols[i % cols.length] }));
    parts.push(part(at(cyl(r + 0.002, r + 0.002, 0.06, 16, true), x, hh * 0.86, 0), 'accent', { color: [T.butter, T.trim, T.rose][i % 3], cast: false }));
    parts.push(part(at(cyl(0.022, 0.028, 0.08, 8), x, hh + 0.04, 0), 'secondary'));
    parts.push(part(at(torus(0.035, 0.007, 4, 10), x, hh + 0.09, 0, PI / 2), 'secondary', { cast: false }));
  }
  const bw = n * 0.25 + 0.06;
  parts.push(part(at(rbox(bw, 0.05, 0.03, 0.012), 0, 0.85, -0.13), 'accent', { color: T.ink2 }));
  parts.push(part(at(tube([[-bw / 2 + 0.02, 0.87, -0.12], [0, 0.82, 0.12], [bw / 2 - 0.02, 0.87, -0.12]], 0.008, 12, 4)), 'accent', { color: T.steel, cast: false }));
  return { parts, footprint: { w: bw, d: 0.3 }, solid: true, anchors: {}, colors: { body: T.tealDeep, secondary: T.brass, accent: T.butter }, hero: 'domed tops + brass valves + chain' };
}

/**
 * Small lab gear (`small`, 12 m draw distance): kind ∈ microscope | tubes | flasks | centrifuge. Origin = bench top.
 */
export function buildLabKit(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), kind = p.kind ?? 'tubes', parts: Part[] = [];
  if (kind === 'microscope') {
    parts.push(part(at(rbox(0.14, 0.03, 0.18, 0.01), 0, 0.015, 0), 'body'));
    parts.push(part(tube([[0, 0.03, -0.07], [0, 0.18, -0.07], [0, 0.26, -0.02]], 0.022, 10, 8), 'body'));
    parts.push(part(at(cyl(0.028, 0.028, 0.16, 12), 0, 0.26, 0.02, -0.5), 'secondary'));
    parts.push(part(at(cyl(0.018, 0.022, 0.05, 10), 0, 0.33, -0.02, -0.5), 'secondary'));
    parts.push(part(at(rbox(0.1, 0.012, 0.08, 0.004), 0, 0.12, 0.03), 'body'));
    parts.push(part(at(cyl(0.012, 0.008, 0.06, 8), 0, 0.17, 0.05), 'secondary'));
    parts.push(part(at(cyl(0.025, 0.025, 0.02, 10), 0.03, 0.12, -0.07, 0, 0, PI / 2), 'accent'));
    return { parts, footprint: { w: 0.16, d: 0.2 }, solid: false, anchors: {}, colors: { body: T.trim, secondary: T.ink2, accent: T.brass }, small: true, hero: 'angled tube + focus knob' };
  }
  if (kind === 'centrifuge') {
    parts.push(part(at(rbox(0.26, 0.14, 0.26, 0.05, 2), 0, 0.07, 0), 'body'));
    parts.push(part(at(lathe([[0, 0], [0.11, 0], [0.1, 0.03], [0.0, 0.045]], 16), 0, 0.14, 0), 'secondary'));
    parts.push(part(at(rbox(0.1, 0.03, 0.01, 0.004), 0, 0.06, 0.131), 'accent', { cast: false }));
    parts.push(part(at(cyl(0.012, 0.012, 0.01, 8), 0.08, 0.06, 0.133, PI / 2), 'accent', { color: T.sage, cast: false }));
    return { parts, footprint: { w: 0.26, d: 0.26 }, solid: false, anchors: {}, colors: { body: T.trim, secondary: WS.sash, accent: T.ink2 }, small: true, hero: 'domed lid + control strip' };
  }
  if (kind === 'flasks') {
    parts.push(...glass('flask', -0.08, 0, 0, 0.18, v.pick(LIQUIDS), { mat: 'small' }));
    parts.push(...glass('beaker', 0.06, 0, 0.04, 0.11, v.pick(LIQUIDS), { mat: 'small' }));
    parts.push(...glass('beaker', 0.09, 0, -0.07, 0.08, v.pick(LIQUIDS), { mat: 'small' }));
    return { parts, footprint: { w: 0.3, d: 0.2 }, solid: false, anchors: {}, colors: { body: T.bottle, secondary: T.ink2, accent: T.bottle }, small: true, hero: 'erlenmeyer + beakers' };
  }
  // tubes: a rack of coloured test tubes
  parts.push(part(at(rbox(0.26, 0.018, 0.07, 0.006), 0, 0.009, 0), 'body'), part(at(rbox(0.26, 0.012, 0.07, 0.004), 0, 0.09, 0), 'body'));
  for (const e of [-1, 1]) parts.push(part(at(rbox(0.012, 0.09, 0.06, 0.004), e * 0.125, 0.045, 0), 'body'));
  for (let i = 0; i < 6; i++) {
    const x = -0.1 + i * 0.04, hh = v.r(0.11, 0.14);
    parts.push(part(at(cyl(0.012, 0.012, hh, 8), x, hh / 2 + 0.01, 0), 'accent', { color: T.bottle, cast: false }));
    parts.push(part(at(cyl(0.011, 0.011, hh * 0.5, 8), x, hh * 0.25 + 0.012, 0), 'accent', { color: v.pick(LIQUIDS), cast: false }));
    if (v.chance(0.4)) parts.push(part(at(cyl(0.014, 0.013, 0.02, 8), x, hh + 0.02, 0), 'secondary', { cast: false }));
  }
  return { parts, footprint: { w: 0.26, d: 0.08 }, solid: false, anchors: {}, colors: { body: T.oak, secondary: T.rose, accent: T.bottle }, small: true, hero: 'coloured test tubes, stoppers' };
}

/** Lab cart: two-tier steel trolley on casters, glassware on top, a glove box + a jug below. */
export function buildLabCart(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 0.7, d = p.d ?? 0.45, h = p.h ?? 0.72;
  const parts: Part[] = [];
  for (const y of [0.18, h - 0.03]) {
    parts.push(part(at(slab(w, d, 0.025, 0.03, 0.008), 0, y, 0), 'body'));
    parts.push(part(at(rbox(w - 0.02, 0.04, 0.012, 0.004), 0, y + 0.04, d / 2 - 0.006), 'body', { cast: false }));
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    parts.push(part(at(cyl(0.012, 0.012, h - 0.06, 8), sx * (w / 2 - 0.03), (h - 0.06) / 2 + 0.06, sz * (d / 2 - 0.03)), 'secondary'));
    parts.push(part(at(sphere(0.028, 6, 4), sx * (w / 2 - 0.03), 0.03, sz * (d / 2 - 0.03)), 'secondary', { cast: false }));
  }
  parts.push(part(tube([[-w / 2 + 0.03, h - 0.02, -d / 2 + 0.03], [-w / 2 - 0.06, h + 0.1, -d / 2 + 0.03], [-w / 2 - 0.06, h + 0.1, d / 2 - 0.03], [-w / 2 + 0.03, h - 0.02, d / 2 - 0.03]], 0.012, 12, 5), 'accent'));
  parts.push(...glass('flask', -0.18, h, 0.03, 0.2, v.pick(LIQUIDS), { mat: 'plain' }));
  parts.push(...glass('beaker', 0.02, h, -0.08, 0.12, v.pick(LIQUIDS), { mat: 'small' }));
    parts.push(...glass('bottle', 0.08, h, 0.1, 0.16, T.tealDeep, { mat: 'small' }));
  parts.push(part(at(rbox(0.24, 0.1, 0.13, 0.012), -0.12, 0.25, 0), 'accent', { color: T.trim }));
  parts.push(part(at(rbox(0.1, 0.012, 0.05, 0.004), -0.12, 0.30, 0.02), 'accent', { color: T.lavender, cast: false })); // glove poking out
  parts.push(part(at(lathe([[0, 0], [0.07, 0], [0.075, 0.12], [0.04, 0.17], [0.04, 0.2], [0, 0.2]], 12), 0.16, 0.205, 0), 'accent', { color: T.bottle }));
  return { parts, footprint: { w: w + 0.1, d }, solid: true, anchors: { top: h }, colors: { body: T.steelOat, secondary: T.ink2, accent: T.steel }, hero: 'push handle + glassware' };
}

/** Sample fridge (Lab): tall cream fridge, a glass door over shelves of coloured vials, bar handle, a sticker. */
export function buildSampleFridge(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 0.66, h = p.h ?? 1.7, d = p.d ?? 0.62;
  const parts = [
    part(at(rbox(w, h, d, 0.06, 2), 0, h / 2 + 0.05, 0), 'body'),
    part(at(rbox(w - 0.1, 0.05, d - 0.1, 0.01), 0, 0.025, 0), 'secondary', { ao: 0.6 }),
    part(at(rbox(w - 0.14, h - 0.42, 0.012, 0.006), 0, h / 2 + 0.12, d / 2 + 0.002), 'accent', { color: WS.sash, cast: false }),
    part(at(rbox(0.03, h * 0.5, 0.04, 0.012), w / 2 - 0.08, h / 2 + 0.12, d / 2 + 0.03), 'secondary'),
    part(at(rbox(w - 0.16, 0.12, 0.012, 0.006), 0, 0.2, d / 2 + 0.002), 'secondary', { cast: false }), // kick grille
    part(at(disc(0.05, 0.004, 14, 0.001), -w / 2 + 0.14, h - 0.08, d / 2 + 0.003, PI / 2), 'accent', { color: T.butter, cast: false }),
  ];
  const rows = 4;
  for (let r = 0; r < rows; r++) {
    const y = 0.42 + r * (h - 0.6) / rows;
    parts.push(part(at(rbox(w - 0.18, 0.012, 0.012), 0, y, d / 2 + 0.01), 'secondary', { cast: false }));
    for (let i = 0; i < 6; i++) if (v.chance(0.7)) parts.push(part(at(rbox(0.035, v.r(0.06, 0.12), 0.006, 0.003), -w / 2 + 0.14 + i * (w - 0.24) / 5, y + 0.06, d / 2 + 0.012), 'accent', { color: v.pick(LIQUIDS), cast: false }));
  }
  return { parts, footprint: { w, d }, solid: true, anchors: { top: h + 0.05 }, colors: { body: T.trim, secondary: T.ink2, accent: WS.sash }, hero: 'glass door full of vials' };
}

// ============================================================================================================ ENG
/**
 * ★ Boiler (Engine Room signature): a riveted enamel tank on an iron plinth, brass bands, a glowing firebox door, a
 * valve wheel, a little side gauge, a whistle on the dome, and the outlet pipe that runs up and over to STAT's
 * boiler pressure gauge on the ENG glass (`pipeTo` = the gauge back, prop-local [x, y, z]).
 */
export function buildBoiler(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), R = p.r ?? 0.46, H = p.h ?? 1.45, y0 = 0.14;
  const parts = [
    part(at(slab(R * 2 + 0.22, R * 2 + 0.22, y0, 0.12, 0.03), 0, 0, 0), 'secondary'),
    part(at(lathe([[0, 0], [R, 0], [R + 0.01, 0.03], [R + 0.01, H - 0.05], [R, H], [R * 0.86, H + 0.16], [R * 0.55, H + 0.26], [0.1, H + 0.3], [0, H + 0.3]], 28), 0, y0, 0), 'body'),
  ];
  // brass bands + rivet rows
  for (const by of [0.14, H * 0.5, H - 0.08]) {
    parts.push(part(at(torus(R + 0.018, 0.018, 5, 36), 0, y0 + by, 0, PI / 2), 'accent'));
    for (let i = 0; i < 18; i++) { const a = (i / 18) * PI * 2; parts.push(part(at(sphere(0.011, 5, 3), Math.sin(a) * (R + 0.012), y0 + by + 0.045, Math.cos(a) * (R + 0.012)), 'accent', { cast: false })); }
  }
  // firebox door (front, glowing window) + latch
  const fy = y0 + 0.38;
  parts.push(part(at(rbox(0.36, 0.3, 0.1, 0.04, 2), 0, fy, R - 0.02), 'secondary'));
  parts.push(part(at(cyl(0.085, 0.085, 0.02, 18), 0, fy, R + 0.035, PI / 2), 'bulb', { mat: 'bulb', color: T.ember, cast: false }));
  parts.push(part(at(torus(0.09, 0.014, 5, 20), 0, fy, R + 0.04), 'accent', { cast: false }));
  for (let i = 0; i < 3; i++) parts.push(part(at(rbox(0.012, 0.15, 0.012), -0.04 + i * 0.04, fy, R + 0.05), 'secondary', { cast: false })); // grate bars
  parts.push(part(at(rbox(0.12, 0.025, 0.04, 0.01), 0.16, fy, R + 0.05), 'accent'));
  // valve wheel on the right flank
  const wy = y0 + H * 0.72, wx = R + 0.1;
  parts.push(part(at(cyl(0.03, 0.03, 0.14, 10), R + 0.03, wy, 0, 0, 0, PI / 2), 'secondary'));
  parts.push(part(at(torus(0.12, 0.016, 6, 24), wx, wy, 0, 0, PI / 2), 'accent'));
  for (let k = 0; k < 4; k++) parts.push(part(at(rbox(0.01, 0.22, 0.016, 0.004), wx, wy, 0, (k * PI) / 4, 0, 0), 'accent', { cast: false }));
  // little side gauge (cream face, ink needle), front-left
  const ga = -0.55, gy = y0 + H * 0.78;
  parts.push(part(at(cyl(0.075, 0.075, 0.04, 18), Math.sin(ga) * (R + 0.03), gy, Math.cos(ga) * (R + 0.03), PI / 2, ga), 'accent'));
  parts.push(part(at(cyl(0.062, 0.062, 0.01, 18), Math.sin(ga) * (R + 0.052), gy, Math.cos(ga) * (R + 0.052), PI / 2, ga), 'accent', { color: T.trim, cast: false }));
  parts.push(part(at(rbox(0.008, 0.05, 0.004), Math.sin(ga) * (R + 0.06), gy + 0.015, Math.cos(ga) * (R + 0.06), 0, ga, 0.6), 'secondary', { cast: false }));
  // dome top: safety valve + whistle
  const top = y0 + H + 0.3;
  parts.push(part(at(cyl(0.03, 0.04, 0.12, 10), 0.14, top - 0.04, -0.1), 'accent'));
  parts.push(part(at(lathe([[0.0, 0], [0.035, 0], [0.035, 0.1], [0.045, 0.12], [0.02, 0.16], [0, 0.17]], 12), 0.14, top + 0.02, -0.1), 'accent'));
  // outlet pipe: up from the dome, across the ceiling side and in to the gauge back (`pipeDir` = the local direction
  // the last run points along, into the gauge)
  const to = p.pipeTo ?? [-1.8, 1.8, 0.8], n = p.pipeDir ?? [-1, 0, 0];
  const py = p.pipeY ?? Math.max(top + 0.22, to[1] + 0.3);
  const back = (k: number, y: number): V3 => [to[0] - n[0] * k, y, to[2] - n[2] * k];
  const pts: V3[] = [[0, top - 0.06, 0], [0, py - 0.12, 0], [0, py, 0.0], [to[0] * 0.15 - n[0] * 0.3, py, to[2] * 0.15 - n[2] * 0.3], back(0.3, py), back(0.14, py - 0.02), back(0.12, to[1] + 0.12)];
  parts.push(part(tube(pts, 0.045, 36, 10), 'secondary'));
  parts.push(part(at(cyl(0.07, 0.07, 0.04, 14), 0, top - 0.02, 0), 'accent'));
  const fl = back(0.03, to[1]);
  parts.push(part(at(cyl(0.065, 0.065, 0.035, 14), fl[0], fl[1], fl[2], n[2] ? PI / 2 : 0, 0, n[0] ? PI / 2 : 0), 'accent'));
  parts.push(part(tube([back(0.12, to[1] + 0.12), back(0.11, to[1] + 0.02), back(0.03, to[1])], 0.045, 6, 10), 'secondary'));
  // a coal scuttle with a shovel (story)
  parts.push(part(at(lathe([[0, 0], [0.12, 0], [0.15, 0.2], [0.13, 0.2], [0.1, 0.02], [0, 0.02]], 14), R + 0.28, 0, R * 0.2), 'secondary'));
  for (let i = 0; i < 5; i++) parts.push(part(at(sphere(v.r(0.03, 0.045), 6, 4), R + 0.28 + v.r(-0.06, 0.06), 0.17, R * 0.2 + v.r(-0.06, 0.06)), 'secondary', { color: T.ink, cast: false }));
  parts.push(part(at(cyl(0.012, 0.012, 0.62, 6), R + 0.36, 0.34, R * 0.2 + 0.06, 0.1, 0, -0.35), 'secondary', { color: T.oak }));
  return { parts, footprint: { r: R + 0.12 }, collider: { r: R + 0.12 }, solid: true, anchors: { steam: [0.14, top + 0.2, -0.1], fire: [0, fy, R + 0.05] }, colors: { body: WS.boiler, secondary: WS.iron, accent: T.brass }, hero: 'riveted bands, glowing firebox, valve wheel, pipe to the gauge' };
}

/**
 * Shell bench (Engine Room): an oak butcher-block top on a square-tube steel frame with a lower shelf (a parts tray on
 * it), a short pegboard riser at the back with two hanging tools. `vise` bolts a vise on one end (the long workbench).
 */
export function buildShellBench(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 1.0, h = p.h ?? 0.55, d = p.d ?? 0.6;
  const parts = [part(at(rbox(w, 0.06, d, 0.018, 1), 0, h - 0.03, 0), 'body', { mat: 'wood' })];
  for (let i = 1; i < Math.round(w / 0.2); i++) parts.push(part(at(rbox(0.006, 0.062, d - 0.02), -w / 2 + i * (w / Math.round(w / 0.2)), h - 0.03, 0), 'body', { mat: 'wood', ao: 0.8, cast: false })); // block seams
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    parts.push(part(at(rbox(0.04, h - 0.06, 0.04, 0.008), sx * (w / 2 - 0.05), (h - 0.06) / 2, sz * (d / 2 - 0.05)), 'secondary'));
    parts.push(part(at(rbox(0.07, 0.015, 0.07, 0.006), sx * (w / 2 - 0.05), 0.008, sz * (d / 2 - 0.05)), 'secondary'));
  }
  for (const e of [-1, 1]) parts.push(part(at(rbox(0.03, 0.03, d - 0.1, 0.008), e * (w / 2 - 0.05), 0.12, 0), 'secondary'));
  parts.push(part(at(rbox(w - 0.1, 0.02, d - 0.1, 0.006), 0, 0.14, 0), 'secondary', { ao: 0.85 }));
  // parts tray on the lower shelf (small bins)
  const tx = v.r(-w * 0.2, w * 0.2);
  parts.push(part(at(rbox(0.34, 0.08, 0.22, 0.012), tx, 0.19, 0), 'accent'));
  for (let i = 0; i < 3; i++) parts.push(part(at(sphere(0.025, 6, 4), tx - 0.1 + i * 0.1, 0.23, v.r(-0.05, 0.05)), 'secondary', { color: v.pick([T.brass, T.steel, T.tealDeep]), cast: false, mat: 'small' }));
  if (p.riser !== false && !p.vise) {
    const rh = 0.28;
    parts.push(part(at(rbox(w - 0.04, rh, 0.018, 0.008), 0, h + rh / 2, -d / 2 + 0.02), 'accent', { color: WS.peg }));
    for (let i = 0; i < 5; i++) for (let k = 0; k < 2; k++) parts.push(part(at(rbox(0.012, 0.012, 0.004), -w / 2 + 0.12 + i * (w - 0.24) / 4, h + 0.08 + k * 0.12, -d / 2 + 0.03), 'secondary', { cast: false, mat: 'small' }));
    // a wrench + a screwdriver on hooks
    parts.push(part(at(rbox(0.018, 0.16, 0.008, 0.004), -w * 0.25, h + 0.12, -d / 2 + 0.04, 0, 0, 0.1), 'secondary', { color: T.steel, cast: false }));
    parts.push(part(at(torus(0.022, 0.008, 4, 10), -w * 0.25 + 0.008, h + 0.21, -d / 2 + 0.04), 'secondary', { color: T.steel, cast: false }));
    parts.push(part(at(cyl(0.014, 0.012, 0.08, 8), w * 0.22, h + 0.18, -d / 2 + 0.045), 'accent', { color: v.pick(HANDLES), cast: false }));
    parts.push(part(at(cyl(0.004, 0.004, 0.09, 5), w * 0.22, h + 0.095, -d / 2 + 0.045), 'secondary', { color: T.steel, cast: false }));
  }
  else if (!p.vise) { // a screwdriver + a spare knob left on the block
    parts.push(part(at(cyl(0.014, 0.012, 0.08, 8), w * 0.28, h + 0.014, -d / 2 + 0.14, 0, 0.5, PI / 2), 'accent', { color: v.pick(HANDLES), cast: false, mat: 'small' }));
    parts.push(part(at(cyl(0.004, 0.004, 0.09, 5), w * 0.28 + 0.07, h + 0.014, -d / 2 + 0.14 - 0.04, 0, 0.5, PI / 2), 'secondary', { color: T.steel, cast: false, mat: 'small' }));
  }
  if (p.vise) {
    const vx = w / 2 - 0.16;
    parts.push(part(at(rbox(0.16, 0.08, 0.14, 0.02), vx, h + 0.04, d / 2 - 0.1), 'secondary'));
    parts.push(part(at(rbox(0.14, 0.07, 0.04, 0.012), vx, h + 0.05, d / 2 + 0.0), 'secondary'));
    parts.push(part(at(cyl(0.012, 0.012, 0.18, 6), vx, h + 0.05, d / 2 + 0.06, 0, 0, PI / 2), 'secondary', { color: T.steel }));
    for (const e of [-1, 1]) parts.push(part(at(sphere(0.018, 6, 4), vx + e * 0.09, h + 0.05, d / 2 + 0.06), 'accent'));
  }
  return { parts, footprint: { w, d }, solid: true, anchors: { top: h }, colors: { body: T.oak, secondary: WS.iron, accent: T.butter }, hero: 'butcher block, pegboard riser, parts tray' };
}

/**
 * Beige CRT terminal (the Shellys' kin): rounded bezel, deep tapered back, dark glass with three dim text lines,
 * two knobs and a butter power pip. Origin = its foot (desk top). `anchors.screen` = the glass (local).
 */
export function buildCrt(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 0.34, h = p.h ?? 0.28, d = p.d ?? 0.3;
  const parts = [
    part(at(rbox(w, h, d * 0.45, 0.04, 2), 0, h / 2 + 0.03, d * 0.2), 'body'),
    part(at(rbox(w * 0.78, h * 0.78, d * 0.55, 0.05, 1), 0, h / 2 + 0.035, -d * 0.2), 'body', { ao: 0.9 }),
    part(at(rbox(w * 0.5, 0.03, d * 0.6, 0.01), 0, 0.015, 0), 'body', { ao: 0.8 }),
    part(at(rbox(w - 0.07, h - 0.08, 0.012, 0.03, 1), -0.012, h / 2 + 0.045, d * 0.2 + d * 0.225), 'secondary', { cast: false }),
  ];
  if (p.lines !== false) for (let i = 0; i < 3; i++) parts.push(part(at(rbox(v.r(0.08, 0.18), 0.012, 0.004), -0.07 + v.r(0, 0.04), h / 2 + 0.09 - i * 0.035, d * 0.2 + d * 0.225 + 0.008), 'accent', { color: WS.crtText, cast: false, mat: 'small' }));
  for (let i = 0; i < 2; i++) parts.push(part(at(cyl(0.012, 0.012, 0.015, 8), w / 2 - 0.028, 0.08 + i * 0.05, d * 0.2 + d * 0.225, PI / 2), 'secondary', { cast: false, mat: 'small' }));
  parts.push(part(at(sphere(0.008, 6, 4), w / 2 - 0.028, 0.2, d * 0.2 + d * 0.225 + 0.004), 'accent', { color: T.butter, cast: false, mat: 'small' }));
  return { parts, footprint: { w, d }, solid: false, anchors: { screen: { x: -0.012, y: h / 2 + 0.045, z: d * 0.2 + d * 0.225 + 0.007, w: w - 0.07, h: h - 0.08 } }, colors: { body: WS.crtBeige, secondary: WS.crtGlass, accent: WS.crtText }, hero: 'deep tapered back, knobs, glass text lines' };
}

/**
 * Rack bay (behind STAT's CPU rack cabinets): the ink housing block (the rack wall body), a plinth, a soffit to the
 * ceiling and a ladder cable tray running along the top with drooping cable bundles. Front = the room (+z).
 */
export function buildRackBay(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 8, h = p.h ?? 2.6, d = p.d ?? 0.55, ceil = p.ceil ?? 3.0;
  const parts = [
    part(at(rbox(w, h, d, 0.03, 1), 0, h / 2, 0), 'body'),
    part(at(rbox(w + 0.04, 0.08, d + 0.04, 0.02), 0, 0.04, 0), 'secondary'),
    part(at(rbox(w + 0.02, ceil - h, d * 0.55, 0.02), 0, h + (ceil - h) / 2, -d * 0.22), 'secondary'),
  ];
  // ladder tray along the top (behind STAT's fans), two rails + rungs, hanger rods
  const ty = h + 0.26, tz = -d * 0.05;
  for (const e of [-1, 1]) parts.push(part(at(rbox(w - 0.2, 0.05, 0.02, 0.006), 0, ty, tz + e * 0.09), 'secondary'));
  for (let i = 0; i <= Math.round(w / 0.4); i++) parts.push(part(at(rbox(0.02, 0.012, 0.18), -w / 2 + 0.1 + i * ((w - 0.2) / Math.round(w / 0.4)), ty - 0.015, tz), 'secondary', { cast: false }));
  // cable bundles: sagging loops between tray and housing top, in three cable colours
  const cols = [T.tealDeep, T.butter, T.ink, T.lavender];
  for (let i = 0; i < 9; i++) {
    const x = -w / 2 + 0.5 + i * (w - 1) / 8, c = cols[i % cols.length];
    parts.push(part(tube([[x, ty, tz], [x + 0.12, h + 0.08, tz + 0.06], [x + 0.3, ty, tz]], 0.018, 8, 5), 'accent', { color: c, cast: false }));
    parts.push(part(at(rbox(0.3, 0.035, 0.035, 0.01), x + 0.15, ty + 0.035, tz), 'accent', { color: c, cast: false }));
  }
  return { parts, footprint: { w, d }, solid: true, anchors: {}, colors: { body: T.ink, secondary: '#2A2D31', accent: T.tealDeep }, hero: 'ladder cable tray + drooping cable loops' };
}

/**
 * Pegboard tool wall (Engine Room workshop): a kraft pegboard with a hole grid, a shadow-board outline behind each
 * tool (wrench, hammer, pliers, screwdrivers, a cable coil, a saw), brass hooks. Origin = bottom centre (wall item).
 */
export function buildToolWall(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 2.0, h = p.h ?? 0.9;
  const parts = [part(at(rbox(w, h, 0.025, 0.02, 1), 0, h / 2, 0.0125), 'body'), part(at(rbox(w + 0.05, 0.04, 0.035, 0.01), 0, h + 0.02, 0.018), 'secondary', { mat: 'wood', color: T.oak })];
  for (let i = 0; i < Math.floor(w / 0.1); i++) for (let k = 0; k < Math.floor(h / 0.1); k++) if ((i + k) % 2 === 0) parts.push(part(at(rbox(0.012, 0.012, 0.003), -w / 2 + 0.06 + i * 0.1, 0.06 + k * 0.1, 0.026), 'secondary', { cast: false, mat: 'small', color: '#8A7B64' }));
  const z = 0.03, outline = (x: number, y: number, ww: number, hh: number, rz = 0) => parts.push(part(at(rbox(ww + 0.03, hh + 0.03, 0.003), x, y, z, 0, 0, rz), 'secondary', { cast: false, color: '#9C8A6C' }));
  const hook = (x: number, y: number) => parts.push(part(at(cyl(0.006, 0.006, 0.05, 5), x, y, z + 0.02, PI / 2), 'accent', { cast: false, mat: 'small' }));
  const slots = Math.max(4, Math.floor(w / 0.3));
  for (let i = 0; i < slots; i++) {
    const x = -w / 2 + 0.2 + i * (w - 0.4) / (slots - 1), y = h * v.r(0.42, 0.62), kind = i % 6;
    if (kind === 0) { // wrench
      outline(x, y, 0.03, 0.26, 0.15);
      parts.push(part(at(rbox(0.026, 0.24, 0.01, 0.005), x, y, z + 0.01, 0, 0, 0.15), 'secondary', { color: T.steel }));
      parts.push(part(at(torus(0.03, 0.01, 4, 10), x - 0.018, y + 0.13, z + 0.01), 'secondary', { color: T.steel }));
    } else if (kind === 1) { // hammer
      outline(x, y, 0.2, 0.05); outline(x, y - 0.12, 0.035, 0.24);
      parts.push(part(at(rbox(0.2, 0.05, 0.03, 0.01), x, y + 0.02, z + 0.02), 'secondary', { color: T.ink2 }));
      parts.push(part(at(cyl(0.016, 0.018, 0.26, 8), x, y - 0.12, z + 0.02), 'accent', { color: T.oak }));
    } else if (kind === 2) { // screwdrivers ×3
      for (let s = 0; s < 3; s++) {
        const sx = x - 0.06 + s * 0.06;
        outline(sx, y - 0.02, 0.03, 0.2);
        parts.push(part(at(cyl(0.016, 0.013, 0.09, 8), sx, y + 0.03, z + 0.02), 'accent', { color: HANDLES[(s + i) % HANDLES.length] }));
        parts.push(part(at(cyl(0.004, 0.004, 0.1, 5), sx, y - 0.06, z + 0.02), 'secondary', { color: T.steel, cast: false }));
        hook(sx, y + 0.09);
      }
    } else if (kind === 3) { // cable coil
      parts.push(part(at(torus(0.09, 0.018, 6, 20), x, y, z + 0.03), 'accent', { color: v.pick([T.tealDeep, T.butter, T.lavender]) }));
      hook(x, y + 0.1);
    } else if (kind === 4) { // pliers
      outline(x, y, 0.1, 0.22);
      for (const e of [-1, 1]) parts.push(part(at(rbox(0.02, 0.14, 0.01, 0.005), x + e * 0.025, y - 0.04, z + 0.015, 0, 0, e * 0.15), 'accent', { color: T.teal }));
      parts.push(part(at(rbox(0.035, 0.07, 0.012, 0.006), x, y + 0.07, z + 0.015), 'secondary', { color: T.steel }));
    } else { // hand saw
      outline(x, y, 0.1, 0.3, 0.05);
      parts.push(part(at(rbox(0.09, 0.26, 0.004, 0.002), x, y - 0.02, z + 0.012, 0, 0, 0.05), 'secondary', { color: T.steel }));
      parts.push(part(at(rbox(0.07, 0.08, 0.02, 0.012), x, y + 0.14, z + 0.015), 'accent', { color: T.oak }));
    }
  }
  return { parts, footprint: { w, d: 0.05 }, solid: false, anchors: {}, colors: { body: WS.peg, secondary: T.ink2, accent: T.brass }, hero: 'shadow-board tool outlines' };
}

/** Rolling tool chest: tealDeep enamel, five shallow drawers with brass bar pulls, casters, a top tray with a mallet. */
export function buildToolChest(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 0.72, h = p.h ?? 0.86, d = p.d ?? 0.46;
  const parts = [part(at(rbox(w, h - 0.1, d, 0.035, 2), 0, (h - 0.1) / 2 + 0.1, 0), 'body')];
  const n = 5;
  for (let i = 0; i < n; i++) {
    const dh = (h - 0.22) / n, y = 0.14 + dh * (i + 0.5);
    parts.push(part(at(rbox(w - 0.05, dh - 0.016, 0.014, 0.005), 0, y, d / 2 + 0.002), 'body', { ao: 0.9 }));
    parts.push(part(at(rbox(w * 0.6, 0.014, 0.022, 0.006), 0, y + dh * 0.22, d / 2 + 0.014), 'accent', { cast: false }));
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    parts.push(part(at(cyl(0.035, 0.035, 0.03, 10), sx * (w / 2 - 0.07), 0.04, sz * (d / 2 - 0.07), 0, 0, PI / 2), 'secondary'));
    parts.push(part(at(rbox(0.05, 0.04, 0.05, 0.01), sx * (w / 2 - 0.07), 0.08, sz * (d / 2 - 0.07)), 'secondary'));
  }
  parts.push(part(at(rbox(w - 0.02, 0.05, d - 0.02, 0.015), 0, h + 0.02, 0), 'secondary', { ao: 0.8 }));
  parts.push(part(at(cyl(0.035, 0.035, 0.12, 10), -0.1, h + 0.08, 0.02, 0, v.r(0, 1), PI / 2), 'secondary', { color: T.oak }));
  parts.push(part(at(cyl(0.012, 0.012, 0.3, 6), 0.05, h + 0.08, 0.02, 0, 0.3, PI / 2), 'secondary', { color: T.oak }));
  return { parts, footprint: { w, d }, solid: true, anchors: { top: h + 0.05 }, colors: { body: T.tealDeep, secondary: WS.iron, accent: T.brass }, hero: 'drawer bank with bar pulls + casters' };
}

/** Oil drum: ribbed lathe drum, a lid rim with two bungs, a painted band; `rag` drapes a cloth over the rim. */
export function buildOilDrum(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), r = p.r ?? 0.27, h = p.h ?? 0.86;
  const parts = [part(at(lathe([[0, 0], [r - 0.01, 0], [r, 0.02], [r, h - 0.02], [r - 0.01, h], [0, h]], 22), 0, 0, 0), 'body')];
  for (const y of [h * 0.33, h * 0.66]) parts.push(part(at(torus(r + 0.006, 0.01, 4, 24), 0, y, 0, PI / 2), 'body'));
  parts.push(part(at(torus(r - 0.006, 0.012, 4, 24), 0, h, 0, PI / 2), 'secondary'));
  parts.push(part(at(cyl(r + 0.003, r + 0.003, 0.1, 22, true), 0, h * 0.5, 0), 'accent', { cast: false }));
  for (const [x, z, rr] of [[0.12, 0.06, 0.03], [-0.1, -0.08, 0.02]]) parts.push(part(at(cyl(rr, rr, 0.02, 8), x, h + 0.01, z), 'secondary', { cast: false }));
  if (p.rag) parts.push(part(tube([[-r * 0.6, h + 0.01, -0.05], [0, h + 0.02, 0.02], [r - 0.02, h, 0.08], [r + 0.03, h - 0.12, 0.1], [r + 0.02, h - 0.24, 0.12]], 0.03, 12, 5), 'accent', { color: T.trim, cast: false }));
  return { parts, footprint: { r }, solid: true, anchors: { top: h }, colors: { body: v.pick([T.tealDeep, WS.hoodEnamel]), secondary: WS.iron, accent: T.butter }, hero: 'rolling ribs + painted band' };
}

/**
 * Overhead duct (a ceiling item; origin = the duct's centre line, running along local x): round duct with flange
 * rings, hanger straps up `up` m, and a louvred diffuser dropping down every few metres.
 */
export function buildDuct(p: KitParams = {}, rng: Rng) {
  const len = p.len ?? 5, r = p.r ?? 0.2, up = p.up ?? 0.2;
  const parts = [part(at(cyl(r, r, len, 22, true), 0, 0, 0, 0, 0, PI / 2), 'body', { ao: 0.9 })];
  const nF = Math.max(2, Math.round(len / 1.2));
  for (let i = 0; i <= nF; i++) {
    const x = -len / 2 + i * (len / nF);
    parts.push(part(at(torus(r + 0.008, 0.014, 4, 22), x, 0, 0, 0, PI / 2), 'secondary', { cast: false }));
    if (i % 2 === 1) {
      parts.push(part(at(rbox(0.03, up + r, 0.02), x, (up + r) / 2, 0), 'secondary', { cast: false }));
      parts.push(part(at(rbox(0.3, 0.14, 0.3, 0.02), x, -r - 0.04, 0), 'body'));
      for (let k = 0; k < 3; k++) parts.push(part(at(rbox(0.24, 0.012, 0.03), x, -r - 0.115, -0.08 + k * 0.08), 'accent', { cast: false }));
    }
  }
  parts.push(part(at(sphere(r, 16, 8), len / 2, 0, 0), 'body'));
  parts.push(part(at(sphere(r, 16, 8), -len / 2, 0, 0), 'body'));
  return { parts, footprint: { w: len, d: r * 2 }, solid: false, anchors: {}, colors: { body: '#9A9C98', secondary: WS.iron, accent: T.ink }, hero: 'flange rings + diffusers + hanger straps' };
}

/** Cage lamp (wall): an iron bracket, a glass bulb inside a wire cage (bulb class: the only emissive). */
export function buildCageLamp(p: KitParams = {}, rng: Rng) {
  const parts = [
    part(at(disc(0.07, 0.02, 14, 0.006), 0, 0, 0.01, PI / 2), 'secondary'),
    part(tube([[0, 0, 0.02], [0, 0.04, 0.12], [0, 0.0, 0.18]], 0.012, 8, 6), 'secondary'),
    part(at(cyl(0.035, 0.03, 0.05, 12), 0, -0.02, 0.18), 'secondary'),
    part(at(sphere(0.045, 14, 10), 0, -0.08, 0.18), 'bulb', { mat: 'bulb', cast: false }),
  ];
  for (let i = 0; i < 4; i++) parts.push(part(at(torus(0.06, 0.004, 3, 14, PI), 0, -0.08, 0.18, 0, (i * PI) / 4, PI / 2), 'accent', { cast: false }));
  parts.push(part(at(torus(0.06, 0.005, 3, 16), 0, -0.08, 0.18, PI / 2), 'accent', { cast: false }));
  return { parts, footprint: { w: 0.14, d: 0.25 }, solid: false, anchors: { bulb: [0, -0.08, 0.18] }, colors: { body: T.ink2, secondary: WS.iron, accent: T.brass }, hero: 'wire cage round a bare bulb' };
}

/** A card game in progress (`small`): a fanned hand, the discard pile, two chip stacks. Origin = table top. */
export function buildCardDeck(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), parts: Part[] = [];
  for (let i = 0; i < 6; i++) parts.push(part(at(rbox(0.06, 0.003, 0.085, 0.002), v.r(-0.03, 0.03), 0.002 + i * 0.003, v.r(-0.03, 0.03), 0, v.r(-0.5, 0.5)), i === 5 ? 'accent' : 'body', { cast: false }));
  for (let i = 0; i < 4; i++) parts.push(part(at(rbox(0.06, 0.003, 0.085, 0.002), 0.2 + i * 0.03, 0.002 + i * 0.001, 0.16, 0, -0.5 + i * 0.25), 'body', { cast: false }));
  for (let s = 0; s < 2; s++) {
    const n = 3 + v.int(4);
    for (let i = 0; i < n; i++) parts.push(part(at(cyl(0.02, 0.02, 0.008, 12), -0.2 + s * 0.06, 0.004 + i * 0.009, -0.14), 'accent', { color: s ? T.butter : T.lavender, cast: false }));
  }
  return { parts, footprint: { w: 0.4, d: 0.4 }, solid: false, anchors: {}, colors: { body: T.trim, secondary: T.ink, accent: T.rose }, small: true, hero: 'fanned hand + chip stacks' };
}

/**
 * Wall pipe run (Engine Room, architecture dressing): two parallel pipes along local x at the origin height, iron
 * brackets every ~1.2 m, painted identification bands, one valve wheel and one little pressure dial. Origin = the
 * wall point under the run's centre (wall item, +z = into the room).
 */
export function buildPipeRun(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), len = p.len ?? 6, parts: Part[] = [];
  const pipes = [[0.1, 0.05, 0.045], [0.1, -0.1, 0.03]]; // [z, y, r]
  for (const [z, y, r] of pipes) parts.push(part(at(cyl(r, r, len, 12), 0, y, z, 0, 0, PI / 2), 'body'));
  const nb = Math.max(2, Math.round(len / 1.2));
  for (let i = 0; i <= nb; i++) {
    const x = -len / 2 + 0.1 + i * ((len - 0.2) / nb);
    parts.push(part(at(rbox(0.04, 0.26, 0.05, 0.008), x, -0.02, 0.025), 'secondary'));
    for (const [z, y, r] of pipes) parts.push(part(at(torus(r + 0.006, 0.008, 3, 10), x, y, z, 0, PI / 2), 'secondary', { cast: false }));
    if (i < nb && i % 2 === 0) parts.push(part(at(cyl(0.047, 0.047, 0.12, 12, true), x + 0.45, 0.05, 0.1, 0, 0, PI / 2), 'accent', { color: v.pick([T.butter, T.tealDeep, T.trim]), cast: false }));
  }
  const vx = v.r(-len * 0.3, len * 0.3);
  parts.push(part(at(cyl(0.02, 0.02, 0.12, 8), vx, 0.05, 0.19, PI / 2), 'secondary'));
  parts.push(part(at(torus(0.08, 0.012, 5, 18), vx, 0.05, 0.25), 'accent'));
  for (let k = 0; k < 3; k++) parts.push(part(at(rbox(0.01, 0.15, 0.012, 0.004), vx, 0.05, 0.25, 0, 0, (k * PI) / 3), 'accent', { cast: false }));
  const gx = vx + (vx > 0 ? -0.9 : 0.9);
  parts.push(part(at(cyl(0.012, 0.012, 0.1, 6), gx, 0.12, 0.1), 'secondary'));
  parts.push(part(at(cyl(0.055, 0.055, 0.03, 16), gx, 0.2, 0.12, PI / 2), 'accent'));
  parts.push(part(at(cyl(0.045, 0.045, 0.006, 16), gx, 0.2, 0.137, PI / 2), 'accent', { color: T.trim, cast: false }));
  return { parts, footprint: { w: len, d: 0.3 }, solid: false, anchors: {}, colors: { body: '#8E918C', secondary: WS.iron, accent: T.brass }, hero: 'brackets, ID bands, valve wheel + dial' };
}

/** Floor safety tape (a flat decal, no AO): a dashed butter / ink strip `len` m along local x, `w` wide. */
export function buildFloorTape(p: KitParams = {}, rng: Rng) {
  const len = p.len ?? 4, w = p.w ?? 0.05, dash = 0.3, parts: Part[] = [];
  const n = Math.max(1, Math.floor(len / dash));
  for (let i = 0; i < n; i++) parts.push(part(at(rbox(dash - 0.004, 0.004, w), -len / 2 + (i + 0.5) * (len / n), 0.002, 0, 0, 0, 0), i % 2 ? 'secondary' : 'body', { cast: false, ao: false }));
  return { parts, footprint: { w: len, d: w }, solid: false, anchors: {}, colors: { body: '#C9A95E', secondary: '#3E4442', accent: T.butter }, hero: 'dashed hazard tape' };
}

/** Registry entries (spread into kit/registry.ts KIT). */
export const WORKSHOP_KIT = Object.freeze({
  fumeHood: buildFumeHood, labBench: buildLabBench, testLight: buildTestLight, safetyShower: buildSafetyShower, gasCylinders: buildGasCylinders,
  labKit: buildLabKit, labCart: buildLabCart, sampleFridge: buildSampleFridge,
  boiler: buildBoiler, shellBench: buildShellBench, crt: buildCrt, rackBay: buildRackBay, toolWall: buildToolWall, toolChest: buildToolChest,
  oilDrum: buildOilDrum, duct: buildDuct, cageLamp: buildCageLamp, cardDeck: buildCardDeck, pipeRun: buildPipeRun, floorTape: buildFloorTape,
});
/** Signature (6k-tri budget) builders of this file. */
export const WORKSHOP_SIGNATURE = Object.freeze(['fumeHood', 'boiler', 'rackBay', 'toolWall']);
/** Prop-sheet rows (`?sheet=props`). */
export const WORKSHOP_SHEET: readonly SheetEntry[] = Object.freeze<SheetEntry[]>([
  ['fumeHood', { duct: 0.4 }, 'fumeHood ★'], ['labBench', {}, 'labBench'], ['labBench', { sink: true }, 'labBench · sink'], ['testLight', { hang: 0.2 }, 'testLight'],
  ['safetyShower', {}, 'safetyShower'], ['gasCylinders', {}, 'gasCylinders'], ['labCart', {}, 'labCart'], ['sampleFridge', {}, 'sampleFridge'],
  ['labKit', { kind: 'microscope' }, 'labKit · microscope'], ['labKit', { kind: 'tubes' }, 'labKit · tubes'], ['labKit', { kind: 'flasks' }, 'labKit · flasks'], ['labKit', { kind: 'centrifuge' }, 'labKit · centrifuge'],
  ['boiler', { pipeTo: [-0.9, 1.6, 0.5] }, 'boiler ★'], ['shellBench', {}, 'shellBench'], ['shellBench', { w: 1.8, vise: true }, 'shellBench · vise'], ['crt', {}, 'crt'],
  ['rackBay', { w: 2, ceil: 3.0 }, 'rackBay'], ['toolWall', { w: 1.6 }, 'toolWall'], ['toolChest', {}, 'toolChest'], ['oilDrum', { rag: true }, 'oilDrum'],
  ['duct', { len: 2 }, 'duct'], ['cageLamp', {}, 'cageLamp'], ['cardDeck', {}, 'cardDeck'], ['pipeRun', { len: 3.6 }, 'pipeRun'], ['floorTape', { len: 1.5 }, 'floorTape'],
]);
