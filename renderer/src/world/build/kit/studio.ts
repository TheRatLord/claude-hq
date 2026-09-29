/**
 * [ENV fix m2 r1] Prop kit: the amenity-bay "real sets" (§7.2: review m2 r1 — unallocated W bays read as dead offices)
 * and the secondary-zone dressing the review asked for (café density, Mailroom / Archive cool accents):
 * - W1 Music Room: `drumKit` (signature), `synthStand`, `micStand`, `musicStand`
 * - W2 Gym: `weightBench` (signature), `punchBag`, `kettlebells`, `gymMatStack`
 * - W3 Greenhouse: `seedlingTable` (signature), `plantStand`
 * - Café: `pastryCase` (signature), `wallShelf`
 * - Archive: `archiveDesk` (bevelled overhanging top on tapered legs, a drawer apron)
 * Same contract as every kit builder (§7.5): bevelled, ≤ 3 palette tokens (+ the literal groups the table allows),
 * one hero detail, ≤ 1.5k tris (signature ≤ 6k); cool bodies where Clawds spend time. Owner: ENV.
 */
import * as THREE from 'three';
import { rbox, cyl, lathe, sphere, capsule, torus, tube, slab, disc, at, part, vary, between, leg } from './core.ts';
import type { Grad, KitParams, Part, PartOpts, Rng, SheetEntry, SlotName } from './core.ts';
import { T, SPINES } from './tokens.ts';

const PI = Math.PI;
const G = (y0: number, y1: number, lo: string = T.leafDark, hi: string = T.leafLight): Grad => [lo, hi, y0, y1];
/** Drum lacquer: a deep petrol blue (L* ≈ 40, h ≈ 215): hue-far from clay. */
const LACQUER = '#35606E';
const RUBBER = '#45434A';

/** A drum: shell + two cream heads + a brass hoop, axis along local y, centred. */
function drum(r: number, h: number, parts: Part[], m: THREE.Matrix4) {
  const add = (g: THREE.BufferGeometry, slot: SlotName, o?: PartOpts) => { g.applyMatrix4(m); parts.push(part(g, slot, o)); };
  add(cyl(r, r, h, 20), 'body');
  for (const e of [-1, 1]) {
    add(at(cyl(r - 0.004, r - 0.004, 0.006, 20), 0, e * (h / 2 + 0.002), 0), 'body', { color: T.trim, cast: false });
    add(at(torus(r, 0.008, 4, 20), 0, e * (h / 2 - 0.004), 0, PI / 2), 'accent', { cast: false });
  }
}
const M = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(1, 1, 1));
/** Cymbal on a tripod stand at (x, z), top at height h, tilt t. */
function cymbal(x: number, z: number, h: number, r: number, t: number, parts: Part[]) {
  for (let k = 0; k < 3; k++) { const a = k * 2.094; parts.push(part(tube([[x + Math.cos(a) * 0.2, 0, z + Math.sin(a) * 0.2], [x, 0.28, z]], 0.008, 2, 4), 'secondary')); }
  parts.push(part(at(cyl(0.011, 0.011, h - 0.28, 6), x, 0.28 + (h - 0.28) / 2, z), 'secondary'));
  parts.push(part(at(lathe([[0, 0.02], [0.03, 0.018], [r * 0.4, 0.006], [r, 0], [r, -0.004], [0, 0.012]], 20), x, h, z, t, 0, t * 0.6), 'accent'));
}

/**
 * W1 signature · drum kit on its own round rug: bass drum with a cream logo head, rack toms, floor tom, snare on a
 * stand, hi-hat + crash in brass, a padded throne. Front (audience) = +z; the drummer sits at −z.
 */
export function buildDrumKit(p: KitParams = {}, rng: Rng) {
  const parts: Part[] = [];
  drum(0.24, 0.32, parts, M(0, 0.25, 0.08, PI / 2)); // bass drum, heads face ±z
  parts.push(part(at(disc(0.13, 0.004, 20), 0, 0.25, 0.245, PI / 2), 'secondary', { color: T.butter, cast: false })); // logo roundel
  for (const e of [-1, 1]) parts.push(part(tube([[e * 0.18, 0.1, 0.18], [e * 0.26, 0, 0.26]], 0.008, 2, 4), 'secondary')); // spurs
  drum(0.1, 0.11, parts, M(-0.13, 0.56, 0.02, 0.35, 0, 0.2)); // rack toms on the bass drum
  drum(0.11, 0.12, parts, M(0.14, 0.57, 0.02, 0.35, 0, -0.2));
  parts.push(part(at(cyl(0.012, 0.012, 0.12, 6), 0, 0.46, 0.04), 'secondary'));
  drum(0.16, 0.26, parts, M(0.42, 0.36, -0.2)); // floor tom on three legs
  for (let k = 0; k < 3; k++) { const a = k * 2.094 + 0.4; parts.push(part(tube([[0.42 + Math.cos(a) * 0.16, 0.36, -0.2 + Math.sin(a) * 0.16], [0.42 + Math.cos(a) * 0.2, 0, -0.2 + Math.sin(a) * 0.2]], 0.007, 2, 4), 'secondary')); }
  drum(0.14, 0.09, parts, M(-0.3, 0.52, -0.22, 0.12)); // snare
  for (let k = 0; k < 3; k++) { const a = k * 2.094; parts.push(part(tube([[-0.3 + Math.cos(a) * 0.18, 0, -0.22 + Math.sin(a) * 0.18], [-0.3, 0.3, -0.22], [-0.3, 0.46, -0.22]], 0.008, 3, 4), 'secondary')); }
  cymbal(-0.55, 0.0, 0.82, 0.17, 0.05, parts); // hi-hat (two plates)
  parts.push(part(at(lathe([[0, 0.012], [0.03, 0.01], [0.17, 0], [0.17, -0.004], [0, 0.004]], 20), -0.55, 0.78, 0.0, PI), 'accent'));
  cymbal(0.35, 0.3, 1.18, 0.22, -0.25, parts); // crash
  // throne
  parts.push(part(at(cyl(0.16, 0.15, 0.08, 16), 0, 0.5, -0.5), 'body', { mat: 'fabric', color: RUBBER }));
  parts.push(part(at(cyl(0.018, 0.018, 0.44, 6), 0, 0.24, -0.5), 'secondary'));
  for (let k = 0; k < 3; k++) { const a = k * 2.094 + 0.5; parts.push(part(tube([[Math.cos(a) * 0.2, 0, -0.5 + Math.sin(a) * 0.2], [0, 0.12, -0.5]], 0.009, 2, 4), 'secondary')); }
  // sticks resting on the snare
  for (const e of [-1, 1]) parts.push(part(at(cyl(0.006, 0.008, 0.4, 5), -0.3 + e * 0.03, 0.585, -0.22, PI / 2, 0.3 * e), 'secondary', { color: T.oak, cast: false }));
  return { parts, footprint: { w: 1.3, d: 1.0 }, collider: { r: 0.45 }, solid: true, anchors: { seat: [0, 0.54, -0.5] }, colors: { body: p.colors?.body ?? LACQUER, secondary: T.ink2, accent: T.brass }, hero: 'lacquered shells + cream heads, brass cymbals on stands' };
}

/** Keyboard synth on an X-stand, pedal cable, a little music sheet. Front = +z (the player stands at +z). */
export function buildSynthStand(p: KitParams = {}, rng: Rng) {
  const w = p.w ?? 1.1, parts: Part[] = [];
  for (const e of [-1, 1]) for (const s of [-1, 1]) parts.push(part(between(cyl(0.013, 0.013, 1, 6), [e * (w / 2 - 0.12) + s * 0.0, 0, s * 0.22], [e * (w / 2 - 0.12), 0.7, -s * 0.2]), 'secondary'));
  for (const e of [-1, 1]) parts.push(part(at(rbox(0.05, 0.03, 0.34, 0.01), e * (w / 2 - 0.12), 0.72, 0), 'secondary'));
  parts.push(part(at(rbox(w, 0.07, 0.3, 0.02), 0, 0.77, 0), 'body')); // case
  parts.push(part(at(rbox(w - 0.12, 0.016, 0.14, 0.004), 0, 0.81, 0.06), 'secondary', { color: T.trim, cast: false })); // white keys
  const nb = Math.round((w - 0.14) / 0.045);
  for (let i = 0; i < nb; i++) { if ([2, 6].includes(i % 7)) continue; parts.push(part(at(rbox(0.018, 0.018, 0.08), -w / 2 + 0.09 + i * 0.045, 0.822, 0.03), 'secondary', { color: T.ink, cast: false })); }
  parts.push(part(at(rbox(w - 0.12, 0.012, 0.08, 0.004), 0, 0.81, -0.08), 'body', { color: '#2E3A3F', cast: false })); // control strip
  for (let i = 0; i < 6; i++) parts.push(part(at(cyl(0.012, 0.012, 0.02, 8), -w / 2 + 0.2 + i * 0.07, 0.825, -0.08), 'accent', { cast: false }));
  parts.push(part(at(rbox(0.2, 0.008, 0.07, 0.002), w * 0.28, 0.822, -0.08), 'secondary', { color: T.teal, cast: false })); // screen
  parts.push(part(at(rbox(0.3, 0.2, 0.005), 0, 0.93, -0.12, -0.25), 'secondary', { color: '#EDE3CF', cast: false })); // sheet
  return { parts, footprint: { w, d: 0.5 }, solid: true, anchors: {}, colors: { body: p.colors?.body ?? '#3A4F5C', secondary: T.ink2, accent: T.butter }, hero: 'X-stand, keys + knob row' };
}

/** Mic on a boom stand (tripod base). */
export function buildMicStand(p: KitParams = {}, rng: Rng) {
  const h = p.h ?? 1.45, parts: Part[] = [];
  for (let k = 0; k < 3; k++) { const a = k * 2.094; parts.push(part(tube([[Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22], [0, 0.3, 0]], 0.009, 2, 4), 'secondary')); }
  parts.push(part(at(cyl(0.012, 0.012, h - 0.3, 6), 0, 0.3 + (h - 0.3) / 2, 0), 'secondary'));
  parts.push(part(tube([[0, h, 0], [0.12, h + 0.06, 0.25]], 0.009, 2, 4), 'secondary'));
  parts.push(part(at(capsule(0.028, 0.06, 2, 8), 0.13, h + 0.08, 0.28, 0.9), 'accent'));
  parts.push(part(at(torus(0.028, 0.006, 3, 10), 0.13, h + 0.1, 0.3, 0.9), 'secondary', { cast: false }));
  parts.push(part(tube([[0.11, h + 0.04, 0.24], [0.02, h - 0.3, 0.02], [0.05, 0.02, 0.12], [0.3, 0.005, 0.2]], 0.005, 8, 3), 'secondary', { cast: false })); // cable
  return { parts, footprint: { r: 0.22 }, solid: false, anchors: {}, colors: { body: T.ink2, secondary: T.ink2, accent: '#B7BEC0' }, hero: 'boom + grille mic + cable' };
}

/** Music stand: tripod, a slotted sheet desk with a page on it. */
export function buildMusicStand(p: KitParams = {}, rng: Rng) {
  const parts: Part[] = [];
  for (let k = 0; k < 3; k++) { const a = k * 2.094 + 0.5; parts.push(part(tube([[Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2], [0, 0.25, 0]], 0.008, 2, 4), 'secondary')); }
  parts.push(part(at(cyl(0.01, 0.01, 0.85, 6), 0, 0.25 + 0.42, 0), 'secondary'));
  parts.push(part(at(rbox(0.46, 0.3, 0.012, 0.004), 0, 1.2, 0.02, -0.3), 'secondary'));
  parts.push(part(at(rbox(0.46, 0.03, 0.05, 0.004), 0, 1.06, 0.07, -0.3), 'secondary'));
  parts.push(part(at(rbox(0.21, 0.28, 0.004), -0.11, 1.21, 0.03, -0.3, 0.05), 'body', { cast: false }));
  parts.push(part(at(rbox(0.21, 0.28, 0.004), 0.11, 1.21, 0.03, -0.3, -0.05), 'body', { cast: false }));
  return { parts, footprint: { r: 0.2 }, solid: false, anchors: {}, colors: { body: '#EDE3CF', secondary: T.ink2, accent: T.brass }, hero: 'open sheet music on a slotted desk' };
}

/** W2 signature · weight bench: padded teal bench, twin uprights, a barbell with colour plates in the rack. Long axis x. */
export function buildWeightBench(p: KitParams = {}, rng: Rng) {
  const parts: Part[] = [];
  parts.push(part(at(rbox(1.15, 0.1, 0.3, 0.045, 2), 0, 0.46, 0), 'body', { mat: 'fabric' })); // pad
  parts.push(part(at(rbox(1.1, 0.05, 0.1, 0.015), 0, 0.39, 0), 'secondary'));
  for (const x of [-0.45, 0.45]) {
    parts.push(part(at(rbox(0.06, 0.36, 0.06, 0.012), x, 0.2, 0), 'secondary'));
    parts.push(part(at(rbox(0.08, 0.04, 0.5, 0.012), x, 0.02, 0), 'secondary'));
    for (const e of [-1, 1]) parts.push(part(at(cyl(0.022, 0.022, 0.02, 8), x, 0.012, e * 0.24), 'secondary', { color: RUBBER, cast: false }));
  }
  const rx = -0.62; // rack uprights at the head end
  for (const e of [-1, 1]) {
    parts.push(part(at(rbox(0.06, 1.1, 0.06, 0.012), rx, 0.55, e * 0.42), 'secondary'));
    parts.push(part(at(rbox(0.26, 0.04, 0.08, 0.012), rx, 0.02, e * 0.42), 'secondary'));
    parts.push(part(at(rbox(0.08, 0.05, 0.05, 0.01), rx + 0.04, 0.92, e * 0.42), 'accent'));
  }
  parts.push(part(at(cyl(0.014, 0.014, 1.5, 8), rx + 0.05, 0.965, 0, PI / 2), 'secondary', { color: '#9A9994' })); // bar
  for (const e of [-1, 1]) {
    parts.push(part(at(cyl(0.2, 0.2, 0.05, 20), rx + 0.05, 0.965, e * 0.56, PI / 2), 'body', { color: e > 0 ? T.teal : '#5E6E8A' }));
    parts.push(part(at(cyl(0.15, 0.15, 0.04, 16), rx + 0.05, 0.965, e * 0.61, PI / 2), 'body', { color: T.butter }));
    parts.push(part(at(cyl(0.03, 0.03, 0.05, 8), rx + 0.05, 0.965, e * 0.66, PI / 2), 'accent'));
  }
  return { parts, footprint: { w: 1.4, d: 1.3 }, collider: { w: 1.3, d: 0.6 }, solid: true, anchors: {}, colors: { body: p.colors?.body ?? '#4E7C78', secondary: RUBBER, accent: T.brass }, hero: 'barbell with colour plates in the rack' };
}

/** Punching bag hanging from a ceiling bracket on a chain (origin = floor under it; `top` = ceiling height). */
export function buildPunchBag(p: KitParams = {}, rng: Rng) {
  const top = typeof p.top === 'number' ? p.top : 2.8, parts: Part[] = [];
  parts.push(part(at(capsule(0.17, 0.62, 3, 14), 0, 0.95, 0), 'body', { mat: 'fabric' }));
  for (const y of [0.72, 1.18]) parts.push(part(at(torus(0.172, 0.012, 4, 16), 0, y, 0, PI / 2), 'accent', { cast: false }));
  parts.push(part(at(lathe([[0, 0], [0.12, 0.0], [0.05, 0.08], [0, 0.08]], 12), 0, 1.44, 0), 'secondary'));
  parts.push(part(at(cyl(0.008, 0.008, top - 1.52, 4), 0, 1.52 + (top - 1.52) / 2, 0), 'secondary', { cast: false }));
  parts.push(part(at(rbox(0.16, 0.04, 0.16, 0.01), 0, top - 0.02, 0), 'secondary'));
  return { parts, footprint: { r: 0.2 }, solid: true, anchors: {}, colors: { body: p.colors?.body ?? '#7A3E54', secondary: T.ink2, accent: T.trim }, hero: 'hung heavy bag with cream bands' };
}

/** A row of three kettlebells (graphite, colour-banded by weight). */
export function buildKettlebells(p: KitParams = {}, rng: Rng) {
  const parts: Part[] = [];
  const bells: [number, string][] = [[0.075, T.butter], [0.09, T.teal], [0.105, T.lavender]];
  bells.forEach(([r, c], i) => {
    const x = -0.24 + i * 0.24;
    parts.push(part(at(sphere(r, 14, 10), x, r * 0.95, 0, 0, 0, 0, 1, 0.95, 1), 'body'));
    parts.push(part(at(torus(r * 0.62, r * 0.18, 5, 14, PI), x, r * 1.75, 0), 'body'));
    parts.push(part(at(torus(r * 0.8, 0.008, 3, 14), x, r * 1.2, 0, PI / 2), 'accent', { color: c, cast: false }));
  });
  return { parts, footprint: { w: 0.7, d: 0.25 }, solid: false, anchors: {}, colors: { body: RUBBER, accent: T.butter }, small: false, hero: 'weight-coloured bands' };
}

/** A stack of folded gym mats with a rolled one on top. */
export function buildGymMatStack(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), parts: Part[] = [];
  const cols = [T.teal, '#5E6E8A', T.sage, T.lavender];
  for (let i = 0; i < 4; i++) parts.push(part(at(rbox(0.9, 0.07, 0.6, 0.025), v.r(-0.03, 0.03), 0.035 + i * 0.07, v.r(-0.02, 0.02), 0, v.r(-0.06, 0.06)), 'body', { mat: 'fabric', color: cols[i] }));
  parts.push(part(at(cyl(0.09, 0.09, 0.62, 14), 0, 0.37, 0, 0, 0.1, PI / 2), 'body', { mat: 'fabric', color: T.butter }));
  return { parts, footprint: { w: 0.9, d: 0.6 }, solid: true, anchors: {}, colors: { body: T.teal }, hero: 'folded colour stack + roll' };
}

/**
 * W3 signature · seedling table: a slatted potting table on splayed legs covered in trays of sprouts and potted
 * herbs, a hanging LED grow bar over it (glows), a label stick in every tray. Long axis x.
 */
export function buildSeedlingTable(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 1.2, d = p.d ?? 0.62, h = 0.72, parts: Part[] = [];
  for (let i = 0; i < 5; i++) parts.push(part(at(rbox(w, 0.03, d / 5 - 0.012, 0.008), 0, h - 0.015, -d / 2 + (i + 0.5) * d / 5), 'body', { mat: 'wood' }));
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(part(leg(sx * (w / 2 - 0.06), sz * (d / 2 - 0.06), 0, h - 0.03, 0.025, 0.018, 6, sz * 0.05, -sx * 0.05), 'body', { mat: 'wood' }));
  parts.push(part(at(rbox(w - 0.1, 0.02, d - 0.1, 0.006), 0, 0.2, 0), 'body', { mat: 'wood' })); // lower shelf
  const nT = Math.max(2, Math.round(w / 0.4));
  for (let t = 0; t < nT; t++) {
    const x = -w / 2 + (t + 0.5) * (w / nT), tw = w / nT - 0.05;
    parts.push(part(at(rbox(tw, 0.05, d - 0.12, 0.012), x, h + 0.025, 0), 'secondary', { ao: 0.9 }));
    parts.push(part(at(rbox(tw - 0.04, 0.012, d - 0.16, 0.004), x, h + 0.046, 0), 'secondary', { color: '#5A4636', ao: 0.6, cast: false }));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      const sx = x - tw / 2 + 0.06 + i * ((tw - 0.12) / 2), sz = -d / 2 + 0.16 + j * (d - 0.32);
      parts.push(part(at(sphere(v.r(0.035, 0.05), 7, 5), sx, h + 0.075, sz, 0, 0, 0, 1, 0.8, 1), 'body', { mat: 'foliage', grad: G(h, h + 0.12, T.moss, '#A9C08F') }));
    }
    parts.push(part(at(rbox(0.04, 0.05, 0.003, 0.001), x + tw / 2 - 0.05, h + 0.09, d / 2 - 0.08), 'accent', { color: T.trim, cast: false, mat: 'small' }));
  }
  // grow bar on two cords
  const ceilTop = typeof p.top === 'number' ? p.top : 2.8;
  parts.push(part(at(rbox(w - 0.1, 0.04, 0.1, 0.012), 0, 1.75, 0), 'secondary', { color: T.ink2 }));
  parts.push(part(at(rbox(w - 0.16, 0.012, 0.06, 0.004), 0, 1.726, 0), 'bulb', { mat: 'bulb', cast: false }));
  for (const e of [-1, 1]) parts.push(part(at(cyl(0.003, 0.003, ceilTop - 1.77, 3), e * (w / 2 - 0.12), 1.77 + (ceilTop - 1.77) / 2, 0), 'secondary', { color: T.ink2, cast: false }));
  // two potted herbs on the lower shelf
  for (const e of [-1, 1]) {
    parts.push(part(at(lathe([[0, 0], [0.06, 0], [0.075, 0.1], [0, 0.1]], 12), e * w * 0.25, 0.21, 0), 'accent'));
    parts.push(part(at(sphere(0.08, 9, 6), e * w * 0.25, 0.34, 0, 0, 0, 0, 1, 0.8, 1), 'body', { mat: 'foliage', grad: G(0.25, 0.45) }));
  }
  return { parts, footprint: { w, d }, solid: true, anchors: { bulb: [0, 1.7, 0] }, colors: { body: T.oak, secondary: '#5E8A84', accent: T.teal }, hero: 'sprout trays under a glowing grow bar' };
}

/** A three-tier plant stand (ladder shelf) of pots and trailing greens. */
export function buildPlantStand(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 0.8, parts: Part[] = [];
  for (const e of [-1, 1]) {
    parts.push(part(between(cyl(0.018, 0.02, 1, 6), [e * w / 2, 0, 0.25], [e * w / 2, 1.2, -0.05]), 'body', { mat: 'wood' }));
    parts.push(part(between(cyl(0.018, 0.02, 1, 6), [e * w / 2, 0, -0.2], [e * w / 2, 1.2, -0.05]), 'body', { mat: 'wood' }));
  }
  [[0.35, 0.16], [0.7, 0.07], [1.02, -0.02]].forEach(([y, z], i) => {
    parts.push(part(at(rbox(w + 0.04, 0.025, 0.22, 0.008), 0, y, z), 'body', { mat: 'wood' }));
    const n = 3 - (i === 2 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const x = -w / 2 + 0.14 + k * ((w - 0.28) / Math.max(1, n - 1)), pr = v.r(0.055, 0.075);
      parts.push(part(at(lathe([[0, 0], [pr * 0.8, 0], [pr, pr * 1.4], [pr + 0.008, pr * 1.5], [0, pr * 1.5]], 12), x, y + 0.012, z), 'accent', { color: v.pick([T.trim, T.teal, T.oat]) }));
      if (k % 2) parts.push(part(tube([[x, y + pr * 1.5, z + 0.02], [x + 0.03, y - 0.1, z + 0.1], [x - 0.02, y - 0.25, z + 0.12]], 0.012, 4, 4), 'body', { mat: 'foliage', grad: G(y - 0.3, y + 0.1) }));
      parts.push(part(at(sphere(pr * 1.3, 8, 6), x, y + pr * 1.9, z, 0, 0, 0, 1, 0.8, 1), 'body', { mat: 'foliage', grad: G(y, y + 0.2) }));
    }
  });
  return { parts, footprint: { w: w + 0.05, d: 0.45 }, solid: true, anchors: {}, colors: { body: T.oakDark, accent: T.trim }, hero: 'ladder of pots with trailing greens' };
}

/**
 * Café signature · pastry case: a walnut counter with a cream top, a curved "glass" hood (pale, streaked) over two
 * tiers of treats, a cake dome, a brass price rail. Front = +z.
 */
export function buildPastryCase(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 1.3, d = 0.6, h = 0.95, parts: Part[] = [];
  parts.push(part(at(rbox(w, h - 0.05, d, 0.03, 1), 0, (h - 0.05) / 2, 0), 'body', { mat: 'wood' }));
  parts.push(part(at(rbox(w - 0.1, 0.06, 0.03, 0.01), 0, 0.05, d / 2 - 0.02), 'body', { mat: 'wood', ao: 0.6 })); // kick
  for (let i = 0; i < 3; i++) parts.push(part(at(rbox(w / 3 - 0.08, h - 0.3, 0.015, 0.006), -w / 3 + i * (w / 3), (h - 0.05) / 2 + 0.04, d / 2 + 0.004), 'body', { mat: 'wood', ao: 0.8 })); // panels
  parts.push(part(at(slab(w + 0.04, d + 0.04, 0.04, 0.02, 0.012), 0, h - 0.05, 0), 'secondary'));
  parts.push(part(at(cyl(0.01, 0.01, w - 0.1, 8), 0, h - 0.12, d / 2 + 0.05, 0, 0, PI / 2), 'accent')); // price rail
  // treats on two tiers inside the hood
  const treats: [string, number][] = [['#E3B8A0', 0.05], [T.butter, 0.045], ['#C98FA0', 0.05], ['#D8C0A0', 0.05], ['#B9876A', 0.045]];
  for (let t = 0; t < 2; t++) {
    const y = h + 0.01 + t * 0.18, z = t ? -0.08 : 0.07;
    parts.push(part(at(rbox(w - 0.2, 0.012, 0.22, 0.004), 0, y, z), 'secondary', { cast: false }));
    const n = Math.round((w - 0.3) / 0.14);
    for (let i = 0; i < n; i++) {
      const [c, r] = treats[(i + t * 2) % treats.length], x = -w / 2 + 0.2 + i * ((w - 0.4) / Math.max(1, n - 1));
      if ((i + t) % 3 === 0) parts.push(part(at(torus(r * 0.75, r * 0.4, 5, 10), x, y + 0.03, z, PI / 2), 'body', { color: c, cast: false }));
      else parts.push(part(at(cyl(r, r, 0.05, 10), x, y + 0.035, z), 'body', { color: c, cast: false }));
      if (i % 2) parts.push(part(at(sphere(0.014, 5, 4), x, y + 0.07, z), 'body', { color: '#B8455E', cast: false, mat: 'small' }));
    }
  }
  // the curved hood: a pale quarter-cylinder shell + end caps, and one streak highlight
  const hood = new THREE.CylinderGeometry(0.32, 0.32, w - 0.06, 14, 1, true, 0, PI / 2);
  parts.push(part(at(hood, 0, h, -0.12, 0, 0, PI / 2), 'body', { color: '#C9D8D6', cast: false, ao: false }));
  parts.push(part(at(rbox(0.008, 0.2, 0.012), w * 0.2, h + 0.2, 0.12, -0.7, 0, 0.3), 'body', { color: '#EEF3F1', cast: false, ao: false }));
  // cake dome on the top back
  parts.push(part(at(disc(0.14, 0.02, 16), -w * 0.3, h + 0.33, -0.18), 'secondary'));
  parts.push(part(at(cyl(0.11, 0.11, 0.08, 14), -w * 0.3, h + 0.39, -0.18), 'body', { color: '#F0DCC8' }));
  parts.push(part(at(lathe([[0.14, 0], [0.135, 0.08], [0.1, 0.15], [0.04, 0.18], [0, 0.18]], 16), -w * 0.3, h + 0.35, -0.18), 'body', { color: '#D6E2E0', cast: false }));
  parts.push(part(at(sphere(0.02, 6, 4), -w * 0.3, h + 0.54, -0.18), 'accent'));
  return { parts, footprint: { w, d }, solid: true, anchors: {}, colors: { body: T.walnut, secondary: '#EDE3CF', accent: T.brass }, hero: 'curved hood over two tiers of treats + cake dome' };
}

/** Floating wall shelf (w long, two boards on brass brackets) with jars, mugs, a trailing plant and books. */
export function buildWallShelf(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 1.6, parts: Part[] = [];
  for (const y of [0, 0.36]) {
    parts.push(part(at(rbox(w, 0.035, 0.2, 0.01), 0, y, 0.1), 'body', { mat: 'wood' }));
    for (const e of [-1, 1]) parts.push(part(at(rbox(0.02, 0.1, 0.16, 0.004), e * (w / 2 - 0.15), y - 0.06, 0.08), 'accent', { cast: false }));
    let x = -w / 2 + 0.1;
    while (x < w / 2 - 0.12) {
      const q = v.r(0, 1);
      if (q < 0.35) { const r = v.r(0.04, 0.055), hh = v.r(0.1, 0.16); parts.push(part(at(cyl(r, r, hh, 10), x + r, y + 0.018 + hh / 2, 0.1), 'secondary', { color: v.pick(['#D6E2E0', '#E8D9B0', '#C9D8D6']) })); parts.push(part(at(cyl(r * 0.8, r * 0.8, 0.02, 10), x + r, y + 0.028 + hh, 0.1), 'accent', { cast: false })); x += 2 * r + 0.05; }
      else if (q < 0.6) { parts.push(part(at(lathe([[0, 0], [0.035, 0], [0.04, 0.09], [0, 0.09]], 10), x + 0.04, y + 0.018, 0.1), 'secondary', { color: v.pick([T.teal, T.trim, T.lavender]) })); x += 0.1; }
      else if (q < 0.8) { const n = 2 + v.int(3); for (let k = 0; k < n; k++) parts.push(part(at(rbox(0.035, 0.2, 0.15, 0.004), x + k * 0.037, y + 0.12, 0.1), 'secondary', { color: v.pick(SPINES) })); x += n * 0.037 + 0.05; }
      else { parts.push(part(at(lathe([[0, 0], [0.05, 0], [0.06, 0.08], [0, 0.08]], 10), x + 0.06, y + 0.018, 0.1), 'secondary', { color: T.oat })); parts.push(part(tube([[x + 0.06, y + 0.09, 0.12], [x + 0.08, y - 0.1, 0.18], [x + 0.04, y - 0.28, 0.2]], 0.012, 4, 4), 'body', { mat: 'foliage', grad: G(y - 0.3, y + 0.1) })); parts.push(part(at(sphere(0.07, 8, 6), x + 0.06, y + 0.13, 0.1, 0, 0, 0, 1, 0.8, 1), 'body', { mat: 'foliage', grad: G(y, y + 0.2) })); x += 0.16; }
    }
  }
  return { parts, footprint: { w, d: 0.2 }, solid: false, anchors: {}, colors: { body: T.oak, secondary: T.trim, accent: T.brass }, hero: 'jars, mugs, books and a trailing plant' };
}

/**
 * Archive desk: an overhanging bevelled walnut top on tapered legs with brass toe caps, a two-drawer apron with cup
 * pulls, a leather writing inset (cool green), a stack of ledgers. Front = +z.
 */
export function buildArchiveDesk(p: KitParams = {}, rng: Rng) {
  const w = p.w ?? 1.6, d = p.d ?? 0.8, h = p.h ?? 0.76, parts: Part[] = [];
  parts.push(part(at(slab(w + 0.08, d + 0.08, 0.045, 0.04, 0.016), 0, h - 0.045, 0), 'body', { mat: 'wood' }));
  parts.push(part(at(rbox(w * 0.62, 0.006, d * 0.55, 0.002), 0, h + 0.001, 0.02), 'secondary', { cast: false, ao: false }));
  parts.push(part(at(rbox(w - 0.12, 0.13, d - 0.12, 0.015), 0, h - 0.11, 0), 'body', { mat: 'wood', ao: 0.8 })); // apron
  for (const e of [-1, 1]) {
    parts.push(part(at(rbox(w * 0.36, 0.1, 0.02, 0.008), e * w * 0.22, h - 0.11, d / 2 - 0.055), 'body', { mat: 'wood' }));
    parts.push(part(at(torus(0.035, 0.007, 4, 10, PI), e * w * 0.22, h - 0.1, d / 2 - 0.04, PI / 2 - 0.2, 0, PI), 'accent', { cast: false }));
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    parts.push(part(leg(sx * (w / 2 - 0.07), sz * (d / 2 - 0.07), 0.03, h - 0.17, 0.034, 0.022, 8), 'body', { mat: 'wood' }));
    parts.push(part(at(cyl(0.024, 0.024, 0.03, 8), sx * (w / 2 - 0.07), 0.015, sz * (d / 2 - 0.07)), 'accent'));
  }
  parts.push(part(at(rbox(w - 0.2, 0.025, 0.04, 0.008), 0, 0.16, 0), 'body', { mat: 'wood' })); // stretcher
  for (let i = 0; i < 3; i++) parts.push(part(at(rbox(0.28, 0.05, 0.36, 0.008), w * 0.3, h + 0.025 + i * 0.05, -0.12, 0, 0.1 * (i - 1)), 'secondary', { color: ['#3F5E58', '#6B3F24', '#4B4FA6'][i] }));
  return { parts, footprint: { w: w + 0.08, d: d + 0.08 }, collider: { w, d }, solid: true, anchors: { top: h }, colors: { body: T.walnut, secondary: '#4F6B5E', accent: T.brass }, hero: 'overhanging bevelled top, tapered legs + toe caps, drawer pulls' };
}

export const STUDIO_KIT = Object.freeze({
  drumKit: buildDrumKit, synthStand: buildSynthStand, micStand: buildMicStand, musicStand: buildMusicStand,
  weightBench: buildWeightBench, punchBag: buildPunchBag, kettlebells: buildKettlebells, gymMatStack: buildGymMatStack,
  seedlingTable: buildSeedlingTable, plantStand: buildPlantStand, pastryCase: buildPastryCase, wallShelf: buildWallShelf,
  archiveDesk: buildArchiveDesk,
});
export const STUDIO_SIGNATURE = Object.freeze(['drumKit', 'weightBench', 'seedlingTable', 'pastryCase']);
export const STUDIO_SHEET: readonly SheetEntry[] = Object.freeze<SheetEntry[]>([
  ['drumKit', {}, 'drumKit ★'], ['synthStand', {}, 'synthStand'], ['micStand', {}, 'micStand'], ['musicStand', {}, 'musicStand'],
  ['weightBench', {}, 'weightBench ★'], ['punchBag', {}, 'punchBag'], ['kettlebells', {}, 'kettlebells'], ['gymMatStack', {}, 'gymMatStack'],
  ['seedlingTable', {}, 'seedlingTable ★'], ['plantStand', {}, 'plantStand'], ['pastryCase', {}, 'pastryCase ★'], ['wallShelf', {}, 'wallShelf'],
  ['archiveDesk', {}, 'archiveDesk'],
]);
