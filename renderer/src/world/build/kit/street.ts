/**
 * Prop kit: Studio Street furniture (§7.1 STR "storefronts, string lights, banners, street lamps"): storefront
 * awnings with a scalloped valance, hanging bay banners on wall brackets, chalk A-frame boards, a bicycle with a
 * basket, a round-top mailbox, and the street's signature flower stall. Same §7.5 contract: bevelled, ≤ 3 tokens
 * (+ literal flower / stripe groups), one hero detail each, ≤ 1.5k tris (flower stall ≤ 6k). Owner: ENV.
 */
import * as THREE from 'three';
import { rbox, cyl, lathe, sphere, capsule, torus, tube, at, part, vary, between } from './core.ts';
import type { KitParams, Part, PartOpts, Rng, SheetEntry, SlotName } from './core.ts';
import { T, FLOWERS } from './tokens.ts';

const PI = Math.PI;
/** Zinc bucket grey-green (L* ≈ 62), low chroma. */
const ZINC = '#98A29C';

/** Half-disc scallop (valance tooth) in the local xy plane, flat side up, facing +z. */
function scallop(r: number, t: number) {
  return new THREE.CylinderGeometry(r, r, t, 10, 1, false, -PI / 2, PI).rotateX(PI / 2); // lower half-disc
}

/**
 * Storefront awning: `w` wide, projecting `d` from the wall (+z = into the street), a sloped striped canopy from
 * y `y` at the wall down 0.22 m at its lip, a scalloped valance, iron side brackets. Origin = wall face, bottom of
 * the canopy's wall edge. `colors.body` / `colors.secondary` = the two stripe tokens.
 */
export function buildAwning(p: KitParams = {}, rng: Rng) {
  const w = p.w ?? 2.6, d = p.d ?? 0.55, drop = 0.22, n = Math.max(5, Math.round(w / 0.2) | 1);
  const parts: Part[] = [];
  const len = Math.hypot(d, drop), tilt = Math.atan2(drop, d);
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (i + 0.5) * (w / n);
    parts.push(part(at(rbox(w / n + 0.002, 0.018, len, 0.006), x, -drop / 2 + 0.01, d / 2, tilt), i % 2 ? 'secondary' : 'body', { mat: 'fabric' }));
    const sc = at(scallop(w / n / 2, 0.012), x, -drop + 0.005, d + 0.004);
    parts.push(part(sc, i % 2 ? 'secondary' : 'body', { mat: 'fabric', cast: false }));
  }
  parts.push(part(at(rbox(w + 0.02, 0.1, 0.014, 0.005), 0, -drop - 0.03, d + 0.008), 'body', { mat: 'fabric', ao: 0.95 })); // valance band
  parts.push(part(at(cyl(0.018, 0.018, w + 0.06, 10), 0, -drop, d, 0, 0, PI / 2), 'accent')); // front bar
  parts.push(part(at(rbox(w + 0.06, 0.05, 0.05, 0.015), 0, 0.02, 0.02), 'accent')); // wall rail
  for (const e of [-1, 1]) {
    parts.push(part(tube([[e * (w / 2 + 0.02), -0.45, 0.02], [e * (w / 2 + 0.02), -0.3, d * 0.55], [e * (w / 2 + 0.02), -drop, d]], 0.012, 6, 5), 'accent'));
    parts.push(part(at(sphere(0.025, 8, 6), e * (w / 2 + 0.05), -drop, d), 'accent'));
  }
  return { parts, footprint: { w, d }, solid: false, anchors: {}, colors: { body: p.colors?.body ?? T.trim, secondary: p.colors?.secondary ?? '#5F7F7A', accent: '#46433F' }, hero: 'striped canopy + scalloped valance' };
}

/**
 * Hanging street banner on a wall bracket: an iron arm out along +z with a brass finial, a fabric pennant
 * (swallowtail foot) with a cream border stripe and an emblem roundel. Origin = wall face at the arm height.
 * `colors.body` = the banner cloth (a desaturated accent: tealDeep / lavender / walnut), `colors.secondary` = the trim,
 * `emblem` = the roundel dot (the bay's workspace jewel, ≤ 5% of the cloth: §5.5 60/30/10).
 */
export function buildStreetBanner(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), bw = p.w ?? 0.46, bh = p.h ?? 0.86, z0 = 0.1, zc = z0 + bw / 2 + 0.04;
  const parts: Part[] = [];
  parts.push(part(at(rbox(0.05, 0.16, 0.03, 0.01), 0, -0.04, 0.015), 'accent')); // wall plate
  parts.push(part(at(cyl(0.012, 0.012, bw + 0.2, 8), 0, 0, (bw + 0.2) / 2, PI / 2), 'accent')); // arm
  parts.push(part(tube([[0, -0.12, 0.03], [0, -0.05, 0.14], [0, 0, 0.26]], 0.008, 5, 4), 'accent')); // brace
  parts.push(part(at(sphere(0.025, 10, 8), 0, 0, bw + 0.22), 'accent', { color: T.brass }));
  // cloth: a thin panel with a gentle wave, swallowtail foot
  const s = new THREE.Shape(), hw = bw / 2;
  s.moveTo(-hw, 0); s.lineTo(hw, 0); s.lineTo(hw, -bh); s.lineTo(0, -bh + 0.13); s.lineTo(-hw, -bh); s.lineTo(-hw, 0);
  const cloth = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 1 });
  const pos = cloth.getAttribute('position');
  for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) + Math.sin(pos.getX(i) * 9 + v.r(0, 0.01)) * 0.012 + (pos.getY(i) / bh) * -0.02);
  cloth.computeVertexNormals();
  // cloth lives in the local yz plane (readable along the street): rotate so its width runs along +z
  parts.push(part(at(cloth, 0, -0.03, zc, 0, -PI / 2, 0), 'body', { mat: 'fabric' }));
  for (const e of [-1, 1]) parts.push(part(at(rbox(0.024, 0.02, bw - 0.06), e * 0.012, -0.12, zc), 'secondary', { cast: false })); // top stripe (both faces)
  for (const e of [-1, 1]) {
    parts.push(part(at(cyl(0.1, 0.1, 0.004, 20), e * 0.013, -0.4, zc, 0, 0, PI / 2), 'secondary', { cast: false, color: p.ring })); // roundel ([ENV fix m2 r2] `ring`: brass on the street, not a cream disc: greyCheck)
    parts.push(part(at(cyl(0.055, 0.055, 0.004, 16), e * 0.016, -0.4, zc, 0, 0, PI / 2), 'body', { cast: false, mat: 'fabric', color: p.emblem })); // [ENV fix m2 r2] `emblem`: the bay's workspace jewel as a small roundel dot, the cloth stays a muted accent
  }
  parts.push(part(at(cyl(0.01, 0.01, bw + 0.04, 8), 0, -0.02, zc, PI / 2), 'accent')); // hanging rod
  return { parts, footprint: { w: 0.05, d: bw + 0.25 }, solid: false, anchors: { cloth: [0, -0.03 - bh / 2, zc] }, colors: { body: p.colors?.body ?? T.tealDeep, secondary: p.colors?.secondary ?? T.trim, accent: '#46433F' }, hero: 'swallowtail pennant, roundel, brass finial' };
}

/** Chalk A-frame sandwich board: oak frame, slate faces with chalk doodles, a hinge bar. Front = +z. */
export function buildAFrame(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 0.42, h = p.h ?? 0.66, a = 0.2, parts: Part[] = [];
  for (const e of [-1, 1]) {
    const face = (g: THREE.BufferGeometry) => { at(g, 0, 0, 0, e * a, 0, 0); g.translate(0, 0, 0); return g; };
    const pz = e * Math.sin(a) * h / 2;
    parts.push(part(at(face(rbox(w, h, 0.03, 0.012)), 0, h / 2, pz), 'secondary', { mat: 'wood' }));
    parts.push(part(at(face(rbox(w - 0.07, h - 0.08, 0.01, 0.004)), 0, h / 2 + 0.01, pz + e * 0.013), 'body', { cast: false }));
    for (let l = 0; l < 3; l++) parts.push(part(at(face(rbox(v.r(0.12, 0.26), 0.014, 0.004)), v.r(-0.04, 0.04), h * 0.7 - l * 0.09, pz + e * 0.02), 'accent', { cast: false, mat: 'small' }));
    parts.push(part(at(face(cyl(0.035, 0.035, 0.004, 14)), -0.08, h * 0.3, pz + e * 0.02, PI / 2, 0, 0), 'accent', { cast: false, color: p.doodle ?? v.pick([T.butter, T.rose, T.lavender, T.sage]) }));
  }
  parts.push(part(at(cyl(0.012, 0.012, w + 0.02, 8), 0, h - 0.02, 0, 0, 0, PI / 2), 'secondary'));
  return { parts, footprint: { w, d: 0.3 }, solid: true, anchors: {}, colors: { body: '#3D4A48', secondary: T.oak, accent: T.trim }, hero: 'chalk doodles on slate faces' };
}

/** Bicycle leaning on its kickstand: tyres + spokes hint, teal frame, saddle, a front basket with flowers. Along x. */
export function buildBicycle(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), R = 0.26, parts: Part[] = [], lean = 0.12;
  const add = (g: THREE.BufferGeometry, slot: SlotName, o?: PartOpts) => { at(g, 0, 0, 0, 0, 0, 0); g.applyMatrix4(new THREE.Matrix4().makeRotationX(lean)); parts.push(part(g, slot, o)); };
  for (const e of [-1, 1]) {
    add(at(torus(R, 0.022, 5, 22), e * 0.4, R + 0.02, 0), 'secondary');
    add(at(torus(R - 0.03, 0.006, 3, 18), e * 0.4, R + 0.02, 0), 'accent', { cast: false });
    add(at(cyl(0.03, 0.03, 0.05, 10), e * 0.4, R + 0.02, 0, PI / 2), 'accent');
    for (let k = 0; k < 2; k++) add(at(rbox(0.004, 2 * R - 0.06, 0.004), e * 0.4, R + 0.02, 0, 0, 0, k * PI / 3), 'accent', { cast: false, mat: 'small' });
  }
  const bb = [0.0, R, 0], seat = [-0.14, 0.72, 0], head = [0.3, 0.74, 0];
  add(between(cyl(0.017, 0.017, 1, 8), [-0.4, R + 0.02, 0], bb), 'body');
  add(between(cyl(0.017, 0.017, 1, 8), bb, seat), 'body');
  add(between(cyl(0.017, 0.017, 1, 8), bb, head), 'body');
  add(between(cyl(0.015, 0.015, 1, 8), seat, [-0.4, R + 0.02, 0]), 'body');
  add(between(cyl(0.017, 0.017, 1, 8), head, [0.4, R + 0.02, 0]), 'body');
  add(at(capsule(0.035, 0.1, 3, 8), -0.16, 0.77, 0, 0, 0, PI / 2), 'secondary', { mat: 'fabric' }); // saddle
  add(tube([[0.3, 0.8, -0.22], [0.27, 0.84, 0], [0.3, 0.8, 0.22]], 0.012, 6, 5), 'secondary');
  add(at(lathe([[0.1, 0], [0.13, 0.14], [0.135, 0.15], [0.125, 0.15], [0.09, 0.02], [0, 0.02]], 12), 0.42, 0.62, 0), 'accent', { color: T.kraft, mat: 'fabric' }); // basket
  for (let k = 0; k < 4; k++) add(at(sphere(0.035, 6, 4), 0.4 + v.r(-0.05, 0.05), 0.8, v.r(-0.06, 0.06)), 'accent', { color: FLOWERS[k % FLOWERS.length], cast: false });
  add(at(capsule(0.03, 0.22, 2, 6), 0.44, 0.84, 0.03, 0.3, 0, 0.4), 'accent', { color: '#D9B98A' }); // a baguette
  add(between(cyl(0.008, 0.008, 1, 5), bb, [0.05, 0, 0.14]), 'secondary');
  return { parts, footprint: { w: 1.1, d: 0.3 }, solid: true, anchors: {}, colors: { body: p.colors?.body ?? '#4E7C78', secondary: T.ink2, accent: T.trim }, hero: 'basket of flowers + baguette' };
}

/** Round-top post mailbox (tealDeep, brass slot). */
export function buildMailbox(p: KitParams = {}, rng: Rng) {
  const parts = [part(at(cyl(0.05, 0.06, 0.8, 10), 0, 0.4, 0), 'secondary')];
  parts.push(part(at(rbox(0.3, 0.26, 0.22, 0.04, 2), 0, 0.93, 0), 'body'));
  parts.push(part(at(cyl(0.11, 0.11, 0.3, 18, false), 0, 1.06, 0, 0, 0, PI / 2), 'body'));
  parts.push(part(at(rbox(0.16, 0.025, 0.01, 0.005), 0, 0.98, 0.115), 'accent'));
  parts.push(part(at(lathe([[0.14, 0], [0.12, 0.04], [0.06, 0.05], [0, 0.05]], 14), 0, 0, 0), 'secondary'));
  return { parts, footprint: { r: 0.16 }, solid: true, anchors: {}, colors: { body: T.tealDeep, secondary: T.ink2, accent: T.brass }, hero: 'round top + brass slot' };
}

/**
 * STR signature · flower stall: a three-step oak stand of zinc buckets with bunched flowers (literal flower tokens),
 * a striped canopy on two posts, a chalk price tag and a butter watering can on the ground. Against a wall: back = −z.
 */
export function buildFlowerStall(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 1.2, d = p.d ?? 0.44, parts: Part[] = [];
  const steps = [[0.28, 0.1], [0.5, -0.02], [0.72, -0.13]];
  steps.forEach(([y, z], si) => {
    parts.push(part(at(rbox(w, 0.035, 0.16, 0.01), 0, y, z), 'body', { mat: 'wood' }));
    const n = 4 - (si === 2 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + 0.16 + i * ((w - 0.32) / Math.max(1, n - 1));
      parts.push(part(at(lathe([[0, 0], [0.055, 0], [0.068, 0.13], [0.072, 0.135], [0, 0.135]], 14), x, y + 0.018, z), 'secondary'));
      const fc = FLOWERS[(i + si * 2 + v.int(2)) % FLOWERS.length];
      for (let k = 0; k < 3; k++) parts.push(part(at(capsule(0.006, 0.12, 1, 4), x + v.r(-0.03, 0.03), y + 0.2, z + v.r(-0.03, 0.03), v.r(-0.2, 0.2), 0, v.r(-0.2, 0.2)), 'body', { mat: 'foliage', grad: [T.moss, T.sage, y, y + 0.3] }));
      for (let k = 0; k < 4; k++) parts.push(part(at(sphere(0.04, 6, 4), x + v.r(-0.05, 0.05), y + 0.27 + v.r(0, 0.05), z + v.r(-0.04, 0.04)), 'accent', { color: k === 3 ? T.trim : fc, cast: false }));
      parts.push(part(at(sphere(0.05, 7, 5), x, y + 0.2, z, 0, 0, 0, 1.2, 0.6, 1.2), 'body', { mat: 'foliage', grad: [T.leafDark, T.sage, y + 0.1, y + 0.3] }));
    }
  });
  for (const e of [-1, 1]) {
    for (const [z, h] of [[0.15, 0.3], [-0.18, 0.75]]) parts.push(part(at(rbox(0.04, h, 0.04, 0.01), e * (w / 2 - 0.03), h / 2, z), 'body', { mat: 'wood' }));
    parts.push(part(between(rbox(0.035, 1, 0.035, 0.01), [e * (w / 2 - 0.03), 0.3, 0.15], [e * (w / 2 - 0.03), 0.75, -0.18]), 'body', { mat: 'wood' }));
    parts.push(part(at(cyl(0.02, 0.022, 1.65, 8), e * (w / 2 + 0.02), 0.825, d / 2 - 0.02), 'body', { mat: 'wood' })); // canopy posts
  }
  // canopy: 7 stripes sloping from the wall down toward the front, scalloped lip
  const n = 7, cw = w + 0.2, cd = 0.62, ch = 1.62;
  for (let i = 0; i < n; i++) {
    const x = -cw / 2 + (i + 0.5) * (cw / n);
    parts.push(part(at(rbox(cw / n + 0.002, 0.016, cd, 0.005), x, ch + 0.1, -0.05, 0.3), 'accent', { mat: 'fabric', color: i % 2 ? '#6C8D88' : T.trim }));
    parts.push(part(at(scallop(cw / n / 2, 0.012), x, ch - 0.0, 0.245), 'accent', { mat: 'fabric', color: i % 2 ? '#6C8D88' : T.trim, cast: false }));
  }
  // price tag + chalk board + a butter watering can
  parts.push(part(at(rbox(0.22, 0.14, 0.012, 0.005), 0.3, 0.22, 0.2, -0.2), 'secondary', { color: '#3D4A48', cast: false }));
  parts.push(part(at(rbox(0.14, 0.012, 0.004), 0.3, 0.24, 0.208, -0.2), 'accent', { color: T.trim, cast: false, mat: 'small' }));
  parts.push(part(at(lathe([[0, 0], [0.07, 0], [0.072, 0.13], [0.055, 0.15], [0, 0.15]], 12), -w / 2 + 0.1, 0, 0.22), 'accent', { color: T.butter }));
  parts.push(part(tube([[-w / 2 + 0.16, 0.04, 0.22], [-w / 2 + 0.26, 0.16, 0.22]], 0.01, 3, 5), 'accent', { color: T.butter }));
  return { parts, footprint: { w: w + 0.1, d }, solid: true, anchors: {}, colors: { body: T.oak, secondary: ZINC, accent: T.rose }, hero: 'stepped buckets of flowers under a striped canopy' };
}

/** Registry entries (spread into `KIT`, registry.ts) + signature names + prop-sheet rows. */
export const STREET_KIT = Object.freeze({ awning: buildAwning, streetBanner: buildStreetBanner, aFrame: buildAFrame, bicycle: buildBicycle, mailbox: buildMailbox, flowerStall: buildFlowerStall });
export const STREET_SIGNATURE = Object.freeze(['flowerStall', 'awning']);
export const STREET_SHEET: readonly SheetEntry[] = Object.freeze<SheetEntry[]>([
  ['awning', {}, 'awning'], ['streetBanner', {}, 'street banner'], ['aFrame', {}, 'A-frame board'], ['bicycle', {}, 'bicycle'], ['mailbox', {}, 'mailbox'], ['flowerStall', {}, 'flower stall ★'],
]);
