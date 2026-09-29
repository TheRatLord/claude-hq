/**
 * Prop kit, M2 breadth (ENV 3/5): the Library, Mailroom, Archive and Plaza phone-booth builders (§7.5 contract: no raw
 * boxes, ≤ 3 palette tokens per prop via body / secondary / accent slots — book spines, letters and globe land are the
 * table's allowed literal-colour groups — one hero detail each, seeded variation). Signature props: the Library
 * globe, the Mailroom OUTBOX chute, the Archive vault door, the phone booth. Front = +z, y = floor. Owner: ENV.
 */
import * as THREE from 'three';
import { rbox, cyl, lathe, sphere, capsule, torus, tube, slab, disc, at, leg, between, part, vary } from './core.ts';
import type { KitParams, Part, Pt, Rng, SheetEntry } from './core.ts';
import { T, SPINES, NOTES } from './tokens.ts';

const PI = Math.PI;
/** Envelope / letter papers (the pigeonholes' literal-colour group, like book spines): cream, kraft, pastel airmail. */
const LETTERS = Object.freeze([T.trim, T.trim, T.linen, T.kraft, T.lavender, '#C9D6CF', T.butter]);
/** Brass-green library lamp glass (banker's lamp; derived from tealDeep, L* ≈ 40). */
const BANKER = '#3F6B55';
const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
/** A round rod of radius r from a to b. */
const rod = (r: number, a: Pt, b: Pt, seg = 8) => between(cyl(r, r, dist(a, b), seg), a, b);
/** A bevelled bar (w × d section) from a to b. */
const bar = (w: number, d: number, a: Pt, b: Pt, rr = 0.01) => between(rbox(w, dist(a, b), d, rr), a, b);

// ------------------------------------------------------------------------------------------------ Library
/**
 * libChair: a spindle-back library chair (seat 0.32, toy scale), walnut frame, a green cushion, curved crest rail.
 */
export function buildLibChair(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), sw = 0.42, sd = 0.4, sh = 0.32;
  const parts = [part(at(slab(sw, sd, 0.035, 0.06, 0.012), 0, sh - 0.035, 0), 'secondary', { mat: 'wood' })];
  parts.push(part(at(rbox(sw - 0.08, 0.04, sd - 0.1, 0.018, 2), 0, sh + 0.018, 0.02), 'body', { mat: 'fabric' }));
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(part(leg(sx * (sw / 2 - 0.05), sz * (sd / 2 - 0.05), 0, sh - 0.035, 0.018, 0.012, 8, sz * 0.06, -sx * 0.06), 'secondary', { mat: 'wood' }));
  parts.push(part(at(cyl(0.008, 0.008, sw - 0.1, 6), 0, 0.1, sd / 2 - 0.05, 0, 0, PI / 2), 'secondary', { mat: 'wood', cast: false })); // stretcher
  // back: two stiles, 3 spindles, a bowed crest rail (a torus arc)
  const by = sh, top = sh + 0.36, bz = -sd / 2 + 0.03;
  for (const e of [-1, 1]) parts.push(part(rod(0.016, [e * (sw / 2 - 0.04), by, bz], [e * (sw / 2 - 0.05), top, bz - 0.05]), 'secondary', { mat: 'wood' }));
  for (let i = -1; i <= 1; i++) parts.push(part(rod(0.008, [i * 0.08, by, bz], [i * 0.08, top - 0.02, bz - 0.05], 6), 'secondary', { mat: 'wood', cast: false }));
  parts.push(part(at(torus(0.6, 0.02, 5, 14, 0.62), 0, top, bz - 0.05 + 0.6, PI / 2, 0, -PI / 2 - 0.31, 1, 1, 0.55), 'secondary', { mat: 'wood' }));
  parts.push(part(at(rbox(sw - 0.1, 0.008, 0.008, 0.002), 0, sh + 0.04, sd / 2 - 0.028), 'accent', { cast: false })); // cushion piping
  if (v.chance(0.25)) parts.push(part(at(rbox(0.18, 0.03, 0.13, 0.004), 0.04, sh + 0.055, 0.03, 0, v.r(-0.4, 0.4)), 'accent', { color: v.pick(SPINES), mat: 'small' })); // a book left on the seat
  return { parts, footprint: { r: 0.24 }, solid: false, anchors: { seat: sh }, colors: { body: '#5E7F68', secondary: T.walnut, accent: T.trim }, hero: 'spindle back + bowed crest rail' };
}

/**
 * readingTable: a long library table with a turned apron, bulbous turned legs and a leather writing inset.
 */
export function buildReadingTable(p: KitParams = {}, rng: Rng) {
  const w = p.w ?? 1.8, d = p.d ?? 0.8, h = p.h ?? 0.5;
  const parts = [part(at(slab(w, d, 0.045, 0.05, 0.015), 0, h - 0.045, 0), 'body', { mat: 'wood' })];
  parts.push(part(at(slab(w - 0.3, d - 0.3, 0.004, 0.03, 0.001), 0, h, 0), 'secondary', { cast: false, ao: false })); // leather inset
  parts.push(part(at(rbox(w - 0.16, 0.08, d - 0.16, 0.012), 0, h - 0.085, 0), 'body', { mat: 'wood', ao: 0.8 })); // apron
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const x = sx * (w / 2 - 0.1), z = sz * (d / 2 - 0.1);
    parts.push(part(at(lathe([[0.025, 0], [0.032, 0.03], [0.022, 0.06], [0.02, 0.14], [0.042, 0.22], [0.02, 0.3], [0.024, h - 0.13], [0.03, h - 0.12], [0, h - 0.12]], 10), x, 0, z), 'body', { mat: 'wood' }));
  }
  parts.push(part(at(cyl(0.012, 0.012, w - 0.22, 8), 0, 0.1, 0, 0, 0, PI / 2), 'accent', { cast: false })); // brass stretcher
  return { parts, footprint: { w, d }, solid: true, anchors: { top: h }, colors: { body: T.walnut, secondary: '#4A6B55', accent: T.brass }, hero: 'turned bulb legs + leather inset' };
}

/**
 * bankerLamp: brass stem + base, a green glass half-cylinder shade (glows after dark), pull chain. Origin = table top.
 */
export function buildBankerLamp(p: KitParams = {}, rng: Rng) {
  const parts = [
    part(at(lathe([[0, 0], [0.08, 0], [0.085, 0.012], [0.06, 0.025], [0, 0.028]], 16), 0, 0, 0), 'accent'),
    part(at(cyl(0.012, 0.012, 0.24, 8), 0, 0.14, -0.02), 'accent'),
    part(at(cyl(0.008, 0.008, 0.2, 6), 0, 0.26, 0.0, 0, 0, PI / 2), 'accent', { cast: false }),
  ];
  // shade: a half cylinder (open underneath), lathed-looking via a partial cylinder, end caps
  const sh = new THREE.CylinderGeometry(0.075, 0.075, 0.3, 20, 1, false, PI / 2, PI);
  // [RND fix r2, cross-owner ENV] (art review: at 22 h the whole shade glowed as one flat yellow slab): the green glass
  // top is plain lit clay (it stays green after dark), and only the shade's underside lining is the glow class, so the
  // lamp reads as a green shade over a warm lit mouth that throws its pool onto the desk (lamps.ts task lamps)
  // [RND fix r3, cross-owner ENV] `p.tilt` (rad, default 0 = unchanged): tips the shade's mouth down toward the lamp's
  // front, so from standing eye height a sliver of the lit lining shows under the green glass (library hero at 22 h)
  const tilt = p.tilt ?? 0;
  parts.push(part(at(sh, 0, 0.27, 0, tilt, 0, PI / 2), 'body', { cast: false, color: BANKER }));
  const lining = new THREE.CylinderGeometry(0.068, 0.068, 0.28, 16, 1, true, PI / 2, PI);
  { // turned inside out (kit materials are front-sided): the lining faces into the shade's open mouth
    const ix = lining.index?.array ?? [], nm = lining.getAttribute('normal');
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    for (let i = 0; i < nm.array.length; i++) nm.array[i] = -nm.array[i];
  }
  parts.push(part(at(lining, 0, 0.268, 0, tilt, 0, PI / 2), 'body', { mat: 'shade', cast: false, color: '#FFE9C2', ao: false }));
  parts.push(part(at(sphere(0.022, 10, 8), 0.06, 0.25, 0.0), 'bulb', { mat: 'bulb', cast: false }));
  parts.push(part(at(cyl(0.002, 0.002, 0.09, 4), 0.1, 0.2, 0.05), 'accent', { cast: false, mat: 'small' }));
  parts.push(part(at(sphere(0.008, 6, 4), 0.1, 0.155, 0.05), 'accent', { cast: false, mat: 'small' }));
  return { parts, footprint: { r: 0.09 }, solid: false, anchors: { bulb: [0, 0.25, 0] }, colors: { body: BANKER, secondary: T.ink2, accent: T.brass }, hero: 'green glass shade + pull chain' };
}

/**
 * globe (Library signature): a big terrestrial globe tilted 23° in a brass meridian ring, on a turned walnut tripod
 * with a horizon ring; teal oceans, cream / sage / butter continents. Origin = floor.
 */
export function buildGlobe(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), H = p.h ?? 1.05, R = 0.27, cy = H - R - 0.02, tilt = 0.41;
  const parts: Part[] = [];
  // tripod: three curved splayed legs meeting a turned column
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * PI * 2 + 0.5, x = Math.sin(a), z = Math.cos(a);
    parts.push(part(tube([[x * 0.05, 0.36, z * 0.05], [x * 0.16, 0.18, z * 0.16], [x * 0.26, 0.03, z * 0.26]], 0.022, 8, 6), 'secondary', { mat: 'wood' }));
    parts.push(part(at(sphere(0.03, 8, 6), x * 0.27, 0.025, z * 0.27), 'accent'));
  }
  parts.push(part(at(lathe([[0.06, 0], [0.05, 0.04], [0.03, 0.1], [0.045, 0.16], [0.03, 0.22], [0.04, 0.3], [0.07, 0.34], [0, 0.36]], 14), 0, 0.32, 0), 'secondary', { mat: 'wood' }));
  // horizon ring (walnut) on 4 posts
  const hy = cy - 0.02;
  parts.push(part(at(lathe([[R + 0.04, 0], [R + 0.1, 0], [R + 0.1, 0.03], [R + 0.04, 0.03]], 40), 0, hy, 0), 'secondary', { mat: 'wood' }));
  for (let i = 0; i < 4; i++) { const a = (i / 4) * PI * 2 + PI / 4; parts.push(part(rod(0.012, [Math.sin(a) * 0.05, 0.66, Math.cos(a) * 0.05], [Math.sin(a) * (R + 0.07), hy, Math.cos(a) * (R + 0.07)], 6), 'secondary', { mat: 'wood' })); }
  // meridian ring + axis caps (tilted with the globe)
  const mer = at(torus(R + 0.03, 0.012, 5, 40), 0, 0, 0, 0, PI / 2, 0);
  const apply = (geo: THREE.BufferGeometry) => { geo.applyMatrix4(new THREE.Matrix4().makeRotationZ(tilt)); geo.translate(0, cy, 0); return geo; };
  parts.push(part(apply(mer), 'accent'));
  parts.push(part(apply(at(sphere(0.02, 8, 6), 0, R + 0.045, 0)), 'accent'));
  parts.push(part(apply(at(sphere(0.02, 8, 6), 0, -R - 0.045, 0)), 'accent'));
  parts.push(part(apply(sphere(R, 28, 18)), 'body'));
  // continents: seeded caps (sphere patches a hair above the ocean)
  // continents: clusters of flattened clay blobs laid on the sphere (organic outlines, no lat/long rectangles)
  const LAND = [T.trim, T.sage, '#D9C48E'];
  const conts = [[0.7, 0.5, 5, 0], [1.9, -0.35, 4, 1], [3.1, 0.35, 5, 2], [4.3, -0.1, 4, 1], [5.3, 0.55, 3, 0], [0.2, -0.75, 2, 2]];
  const up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), n = new THREE.Vector3();
  for (const [lon, lat, k, c] of conts) {
    for (let i = 0; i < k; i++) {
      const lo = lon + v.r(-0.35, 0.35), la = Math.max(-1.2, Math.min(1.2, lat + v.r(-0.3, 0.3))), r = v.r(0.045, 0.085);
      n.set(Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo));
      const blob = sphere(r, 10, 6).scale(1, 0.18, v.r(0.7, 1.2));
      blob.applyQuaternion(q.setFromUnitVectors(up, n)).translate(n.x * R * 0.995, n.y * R * 0.995, n.z * R * 0.995);
      parts.push(part(apply(blob), 'body', { color: LAND[(c + (i === k - 1 ? 1 : 0)) % 3], cast: false }));
    }
  }
  return { parts, footprint: { r: 0.3 }, collider: { r: 0.28 }, solid: true, anchors: { center: [0, cy, 0] }, colors: { body: '#4F8C8E', secondary: T.walnut, accent: T.brass }, hero: 'tilted globe in a brass meridian + horizon ring, tripod' };
}

/**
 * teaTrolley: a two-tier walnut trolley on big spoked wheels + a push handle; a brass tea urn (steam vent: AMB
 * steam.ts at local x +0.25, top + 0.12), cups on saucers, a cake stand, cups stacked on the lower tier.
 */
export function buildTeaTrolley(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 1.1, h = p.h ?? 0.95, d = p.d ?? 0.5, top = h - 0.3;
  const parts: Part[] = [];
  for (const y of [0.22, top]) {
    parts.push(part(at(slab(w, d, 0.035, 0.05, 0.012), 0, y - 0.035, 0), 'body', { mat: 'wood' }));
    parts.push(part(at(rbox(w - 0.02, 0.05, 0.02, 0.008), 0, y + 0.02, d / 2 - 0.01), 'body', { mat: 'wood', ao: 0.9 })); // gallery lip
    parts.push(part(at(rbox(w - 0.02, 0.05, 0.02, 0.008), 0, y + 0.02, -d / 2 + 0.01), 'body', { mat: 'wood', ao: 0.9 }));
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(part(at(cyl(0.016, 0.016, top - 0.1, 8), sx * (w / 2 - 0.04), (top + 0.1) / 2, sz * (d / 2 - 0.04)), 'accent'));
  // push handle (brass loop at the -x end)
  parts.push(part(tube([[-w / 2 + 0.04, top, -d / 2 + 0.06], [-w / 2 - 0.1, top + 0.1, -d / 2 + 0.08], [-w / 2 - 0.1, top + 0.1, d / 2 - 0.08], [-w / 2 + 0.04, top, d / 2 - 0.06]], 0.012, 12, 5), 'accent'));
  // wheels: two big spoked ones at +x, casters at -x
  for (const e of [-1, 1]) {
    parts.push(part(at(torus(0.1, 0.018, 6, 20), w / 2 - 0.1, 0.11, e * (d / 2 + 0.01)), 'secondary'));
    parts.push(part(at(cyl(0.03, 0.03, 0.03, 10), w / 2 - 0.1, 0.11, e * (d / 2 + 0.01), PI / 2), 'accent'));
    for (let k = 0; k < 3; k++) parts.push(part(at(rbox(0.012, 0.18, 0.012, 0.003), w / 2 - 0.1, 0.11, e * (d / 2 + 0.01), 0, 0, (k * PI) / 3), 'secondary', { cast: false }));
    parts.push(part(at(sphere(0.035, 8, 6), -w / 2 + 0.06, 0.035, e * (d / 2 - 0.06)), 'secondary'));
  }
  // tea urn (samovar) at +0.25: lathe body, lid knob, tap
  parts.push(part(at(lathe([[0, 0], [0.07, 0], [0.075, 0.015], [0.035, 0.05], [0.04, 0.07], [0.078, 0.1], [0.082, 0.2], [0.07, 0.24], [0.04, 0.26], [0.045, 0.28], [0, 0.28]], 18), 0.25, top, -0.04), 'accent'));
  parts.push(part(at(lathe([[0, 0], [0.045, 0.01], [0.05, 0.04], [0.035, 0.065], [0.012, 0.075], [0.016, 0.085], [0, 0.09]], 14), 0.25, top + 0.28, -0.04), 'body', { color: T.trim })); // teapot on the crown
  parts.push(part(at(cyl(0.006, 0.01, 0.06, 6), 0.3, top + 0.32, -0.04, 0, 0, -0.9), 'body', { color: T.trim, cast: false }));
  parts.push(part(at(cyl(0.012, 0.01, 0.08, 6), 0.25, top + 0.1, 0.06, PI / 2), 'secondary'));
  for (const e of [-1, 1]) parts.push(part(at(torus(0.03, 0.008, 4, 10, PI), 0.25 + e * 0.11, top + 0.2, -0.04, 0, 0, e * PI / 2), 'secondary', { cast: false }));
  // cups on saucers + a cake stand (the literal pastel group of the café)
  for (let k = 0; k < 3; k++) {
    const x = -0.3 + k * 0.14, z = v.r(0.06, 0.12);
    parts.push(part(at(disc(0.045, 0.008, 12, 0.002), x, top, z), 'body', { color: T.trim, mat: 'small' }));
    parts.push(part(at(lathe([[0, 0], [0.025, 0], [0.036, 0.04], [0.032, 0.042], [0, 0.01]], 12), x, top + 0.008, z), 'body', { color: [T.trim, T.teal, T.lavender][k], mat: 'small' }));
  }
  parts.push(part(at(disc(0.1, 0.01, 18, 0.003), -0.15, top + 0.16, -0.12), 'body', { color: T.trim }));
  parts.push(part(at(cyl(0.008, 0.008, 0.16, 6), -0.15, top + 0.08, -0.12), 'accent', { cast: false }));
  for (let k = 0; k < 4; k++) parts.push(part(at(lathe([[0, 0], [0.028, 0], [0.03, 0.02], [0.018, 0.04], [0, 0.045]], 10), -0.15 + Math.sin(k * 1.6) * 0.055, top + 0.17, -0.12 + Math.cos(k * 1.6) * 0.055), 'body', { color: [T.butter, T.rose, T.trim, T.lavender][k], mat: 'small' }));
  // lower tier: a stack of cups and a tin
  for (let k = 0; k < 3; k++) parts.push(part(at(lathe([[0.022, 0], [0.034, 0.04], [0.03, 0.042], [0.02, 0.004]], 12), 0.2, 0.22 + k * 0.022, 0.05), 'body', { color: T.trim, mat: 'small' }));
  parts.push(part(at(cyl(0.06, 0.06, 0.14, 14), -0.2, 0.29, 0.0), 'body', { color: T.tealDeep }));
  return { parts, footprint: { w: w + 0.12, d }, solid: true, anchors: { steam: [0.25, top + 0.34, -0.04] }, colors: { body: T.walnut, secondary: T.ink2, accent: T.brass }, hero: 'brass tea urn, spoked wheels, cake stand' };
}

/**
 * ladder: a rolling library ladder leaning on the brass shelf rail (`lean` m back at the top), hook ends, wheels.
 */
export function buildLadder(p: KitParams = {}, rng: Rng) {
  const H = p.h ?? 1.55, L = p.lean ?? 0.3, w = 0.42;
  const parts: Part[] = [];
  for (const e of [-1, 1]) {
    parts.push(part(bar(0.035, 0.05, [e * w / 2, 0.06, 0], [e * w / 2, H, -L]), 'body', { mat: 'wood' }));
    parts.push(part(tube([[e * w / 2, H, -L], [e * w / 2, H + 0.06, -L - 0.03], [e * w / 2, H + 0.03, -L - 0.08]], 0.012, 6, 5), 'accent')); // hook over the rail
    parts.push(part(at(cyl(0.035, 0.035, 0.025, 12), e * (w / 2 + 0.02), 0.035, 0.0, 0, 0, PI / 2), 'secondary'));
  }
  const n = 6;
  for (let k = 1; k <= n; k++) {
    const t = k / (n + 1), y = 0.06 + t * (H - 0.06), z = -t * L;
    parts.push(part(at(rbox(w, 0.028, 0.07, 0.01), 0, y, z + 0.005), 'body', { mat: 'wood' }));
  }
  return { parts, footprint: { w: w + 0.06, d: 0.15 }, solid: false, anchors: {}, colors: { body: T.oakDark, secondary: T.ink2, accent: T.brass }, hero: 'rail hooks + wheels' };
}

/** brassRail: a wall rail on stand-off brackets along +x, `len` m, centred. */
export function buildBrassRail(p: KitParams = {}, rng: Rng) {
  const len = p.len ?? 4, parts = [part(at(cyl(0.014, 0.014, len, 8), 0, 0, 0.07, 0, 0, PI / 2), 'accent')];
  const n = Math.max(2, Math.round(len / 1.2) + 1);
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + 0.05 + (i * (len - 0.1)) / (n - 1);
    parts.push(part(at(cyl(0.01, 0.01, 0.07, 6), x, 0, 0.035, PI / 2), 'accent', { cast: false }));
    parts.push(part(at(cyl(0.025, 0.025, 0.01, 10), x, 0, 0.004, PI / 2), 'accent', { cast: false }));
  }
  for (const e of [-1, 1]) parts.push(part(at(sphere(0.022, 8, 6), e * len / 2, 0, 0.07), 'accent'));
  return { parts, footprint: { w: len, d: 0.08 }, solid: false, anchors: {}, colors: { body: T.brass, secondary: T.ink2, accent: T.brass }, hero: 'ball finials' };
}

/** sconce: a wall lamp (brass back plate, swan-neck arm, small fabric drum shade, bulb). Origin = wall plate. */
export function buildSconce(p: KitParams = {}, rng: Rng) {
  const parts = [
    part(at(lathe([[0, 0], [0.05, 0], [0.05, 0.012], [0.03, 0.02], [0, 0.022]], 12), 0, 0, 0, PI / 2), 'accent'),
    part(tube([[0, 0, 0.02], [0, 0.04, 0.1], [0, 0.12, 0.14], [0, 0.14, 0.17]], 0.009, 8, 5), 'accent'),
    part(at(lathe([[0.075, 0], [0.055, 0.11], [0.05, 0.11], [0.07, 0.0]], 24), 0, 0.12, 0.17), 'body', { mat: 'shade', cast: false }),
    part(at(sphere(0.025, 10, 8), 0, 0.15, 0.17), 'bulb', { mat: 'bulb', cast: false }),
  ];
  return { parts, footprint: { w: 0.16, d: 0.25 }, solid: false, anchors: { bulb: [0, 0.15, 0.17] }, colors: { body: T.linen, secondary: T.ink2, accent: T.brass }, hero: 'swan-neck arm + drum shade' };
}

/**
 * cardCatalog: an oak card-catalogue cabinet on turned legs: a grid of small drawers with brass pulls + cream label
 * cards, one drawer pulled out with cards fanned up.
 */
export function buildCardCatalog(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), cols = typeof p.cols === 'number' ? p.cols : 4, rows = p.rows ?? 5, dw = 0.14, dh = 0.1, w = cols * dw + 0.06, legH = 0.18, h = legH + rows * dh + 0.06, d = 0.42;
  const parts = [part(at(rbox(w, rows * dh + 0.05, d, 0.02, 1), 0, legH + (rows * dh + 0.05) / 2, 0), 'body', { mat: 'wood', ao: 0.9 })];
  parts.push(part(at(slab(w + 0.05, d + 0.04, 0.03, 0.03, 0.01), 0, h - 0.01, 0), 'body', { mat: 'wood' }));
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(part(at(lathe([[0.02, 0], [0.024, 0.04], [0.016, 0.1], [0.026, legH - 0.02], [0.03, legH], [0, legH]], 8), sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.05)), 'body', { mat: 'wood' }));
  const out = v.int(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = -w / 2 + 0.03 + (c + 0.5) * dw, y = legH + 0.03 + (r + 0.5) * dh, i = r * cols + c;
    const pz = i === out ? 0.16 : 0;
    parts.push(part(at(rbox(dw - 0.014, dh - 0.014, 0.02, 0.004), x, y, d / 2 + pz), 'body', { mat: 'wood' }));
    parts.push(part(at(rbox(0.05, 0.022, 0.004), x, y + 0.02, d / 2 + 0.012 + pz), 'secondary', { cast: false }));
    parts.push(part(at(torus(0.014, 0.004, 3, 8, PI), x, y - 0.018, d / 2 + 0.012 + pz, 0, 0, PI), 'accent', { cast: false }));
    if (i === out) {
      parts.push(part(at(rbox(dw - 0.03, dh - 0.03, 0.16, 0.004), x, y, d / 2 - 0.08 + pz), 'body', { mat: 'wood', ao: 0.7 }));
      for (let k = 0; k < 5; k++) parts.push(part(at(rbox(dw - 0.04, 0.08, 0.003), x, y + 0.04, d / 2 - 0.02 + pz - k * 0.022, -0.25 + k * 0.1), 'secondary', { cast: false }));
    }
  }
  return { parts, footprint: { w: w + 0.05, d: d + 0.04 }, solid: true, anchors: { top: h }, colors: { body: T.oakDark, secondary: T.trim, accent: T.brass }, hero: 'drawer grid, one drawer out with fanned cards' };
}

// ------------------------------------------------------------------------------------------------ Mailroom
/**
 * pigeonholes: an oak sorting frame, a grid of cubbies with name labels; letters, bundles and a parcel poking out.
 */
export function buildPigeonholes(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 3.4, h = p.h ?? 1.8, d = p.d ?? 0.4, base = 0.5;
  const cols = Math.max(4, Math.round(w / 0.36)), rows = 4, cw = (w - 0.08) / cols, rh = (h - base - 0.12) / rows;
  const parts = [
    part(at(rbox(w, base, d, 0.02, 1), 0, base / 2, 0), 'body', { mat: 'wood', ao: 0.9 }), // cabinet base
    part(at(slab(w + 0.06, d + 0.05, 0.035, 0.02, 0.012), 0, base - 0.01, 0.01), 'body', { mat: 'wood' }), // counter lip
    part(at(rbox(w - 0.06, h - base - 0.06, 0.02, 0.006), 0, base + (h - base) / 2, -d / 2 + 0.02), 'body', { mat: 'wood', ao: 0.55 }),
    part(at(rbox(w + 0.08, 0.06, d + 0.04, 0.02), 0, h - 0.02, 0.0), 'body', { mat: 'wood' }), // crown
  ];
  for (const e of [-1, 1]) parts.push(part(at(rbox(0.04, h - base, d - 0.04, 0.012), e * (w / 2 - 0.02), base + (h - base) / 2, -0.02), 'body', { mat: 'wood' }));
  for (let c = 1; c < cols; c++) parts.push(part(at(rbox(0.014, h - base - 0.1, d - 0.08, 0.004), -w / 2 + 0.04 + c * cw, base + (h - base - 0.06) / 2 + 0.03, -0.03), 'body', { mat: 'wood' }));
  for (let r = 1; r < rows; r++) parts.push(part(at(rbox(w - 0.08, 0.014, d - 0.08, 0.004), 0, base + 0.03 + r * rh, -0.03), 'body', { mat: 'wood' }));
  // drawers in the base with brass cup pulls
  const nD = Math.max(2, Math.round(w / 0.85));
  for (let i = 0; i < nD; i++) {
    const x = -w / 2 + (i + 0.5) * (w / nD);
    parts.push(part(at(rbox(w / nD - 0.06, base - 0.14, 0.02, 0.008), x, base / 2 - 0.01, d / 2 + 0.004), 'body', { mat: 'wood' }));
    parts.push(part(at(torus(0.04, 0.008, 4, 10, PI), x, base / 2 + 0.03, d / 2 + 0.02, PI / 2 - 0.2, 0, PI), 'accent', { cast: false }));
  }
  // contents
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = -w / 2 + 0.04 + (c + 0.5) * cw, y = base + 0.03 + r * rh;
    parts.push(part(at(rbox(0.1, 0.022, 0.004), x, y + 0.012, d / 2 - 0.05), 'accent', { cast: false, color: T.trim })); // label strip on the shelf edge
    const q = v.r(0, 1);
    if (q < 0.25) continue;
    if (q < 0.75) { // a fan of letters, some poking out
      const n = 1 + v.int(4);
      for (let k = 0; k < n; k++) {
        const lw = cw * v.r(0.55, 0.8), lh = rh * v.r(0.4, 0.7), stick = v.r(-0.02, 0.1);
        parts.push(part(at(rbox(lw, lh, 0.006, 0.002), x + v.r(-0.03, 0.03), y + 0.014 + lh / 2 + k * 0.004, d / 2 - 0.12 + stick - k * 0.03, -0.08 - k * 0.05, 0, v.r(-0.08, 0.08)), 'secondary', { color: v.pick(LETTERS), cast: false }));
      }
    } else if (q < 0.9) { // a bundle tied with string
      const bh = rh * 0.5;
      parts.push(part(at(rbox(cw * 0.7, bh, d * 0.5, 0.006), x, y + 0.014 + bh / 2, 0.0, 0, v.r(-0.1, 0.1)), 'secondary', { color: v.pick(LETTERS) }));
      parts.push(part(at(rbox(cw * 0.72, 0.006, 0.012, 0.001), x, y + 0.014 + bh + 0.002, 0.05), 'accent', { cast: false, color: T.walnut }));
    } else { // a little parcel sticking out
      const bh = rh * 0.7;
      parts.push(part(at(rbox(cw * 0.8, bh, d * 0.7, 0.01), x, y + 0.014 + bh / 2, 0.08), 'secondary', { color: T.kraft }));
      parts.push(part(at(rbox(0.012, bh + 0.004, d * 0.7 + 0.004, 0.001), x, y + 0.014 + bh / 2, 0.08), 'accent', { cast: false, color: T.trim }));
    }
  }
  return { parts, footprint: { w: w + 0.08, d }, solid: true, anchors: { top: h }, colors: { body: T.oak, secondary: T.trim, accent: T.brass }, hero: 'cubby grid with letters poking out' };
}

/**
 * sortingTable: an oak mail table with a raised back rack of letter trays, a brass postal scale, a rubber stamp on its
 * ink pad, a tape dispenser and stacks of envelopes. Front (+z) = the sorters' side.
 */
export function buildSortingTable(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 2.0, d = p.d ?? 0.9, h = p.h ?? 0.6;
  const parts = [part(at(slab(w, d, 0.045, 0.05, 0.014), 0, h - 0.045, 0), 'body', { mat: 'wood' })];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(part(leg(sx * (w / 2 - 0.08), sz * (d / 2 - 0.08), 0, h - 0.045, 0.028, 0.018, 8), 'body', { mat: 'wood' }));
  parts.push(part(at(slab(w - 0.2, d - 0.2, 0.025, 0.04, 0.008), 0, 0.12, 0), 'body', { mat: 'wood', ao: 0.8 })); // low shelf
  // back rack: two tiers of wire trays
  const ry = h, rz = -d / 2 + 0.12;
  for (const e of [-1, 1]) parts.push(part(at(rbox(0.03, 0.34, 0.2, 0.01), e * (w / 2 - 0.08), ry + 0.17, rz), 'body', { mat: 'wood' }));
  for (let t = 0; t < 2; t++) {
    const y = ry + 0.06 + t * 0.15;
    parts.push(part(at(rbox(w - 0.16, 0.012, 0.2, 0.004), 0, y, rz, 0.1), 'secondary'));
    const nT = 5;
    for (let k = 0; k < nT; k++) {
      const x = -w / 2 + 0.16 + (k + 0.5) * ((w - 0.32) / nT);
      if (v.chance(0.3)) continue;
      parts.push(part(at(rbox(0.26, 0.04 + v.r(0, 0.05), 0.15, 0.004), x, y + 0.04, rz + 0.01, 0.1), 'accent', { color: v.pick(LETTERS), cast: false }));
    }
  }
  // postal scale (brass) with a parcel on it
  const sx = w / 2 - 0.3;
  parts.push(part(at(rbox(0.22, 0.05, 0.18, 0.02), sx, h + 0.025, 0.1), 'secondary'));
  parts.push(part(at(disc(0.08, 0.012, 16, 0.004), sx, h + 0.07, 0.1), 'secondary'));
  parts.push(part(at(cyl(0.012, 0.012, 0.02, 6), sx, h + 0.06, 0.1), 'secondary', { cast: false }));
  parts.push(part(at(cyl(0.06, 0.06, 0.012, 16), sx, h + 0.1, 0.19, PI / 2 - 0.3), 'accent', { color: T.trim, cast: false })); // dial face
  parts.push(part(at(rbox(0.14, 0.1, 0.12, 0.01), sx, h + 0.132, 0.1, 0, 0.3), 'accent', { color: T.kraft }));
  // stamp + ink pad, tape dispenser, envelope stacks, a rubber-band ball
  parts.push(part(at(rbox(0.1, 0.014, 0.07, 0.004), -0.25, h + 0.007, 0.22), 'secondary', { color: T.ink }));
  parts.push(part(at(lathe([[0.03, 0], [0.03, 0.02], [0.012, 0.03], [0.012, 0.07], [0.022, 0.08], [0.02, 0.1], [0, 0.1]], 10), -0.1, h, 0.24), 'accent', { color: T.walnut, mat: 'small' }));
  parts.push(part(at(rbox(0.14, 0.06, 0.06, 0.02), 0.25, h + 0.03, 0.25), 'secondary', { color: T.tealDeep }));
  parts.push(part(at(torus(0.025, 0.012, 6, 12), 0.25, h + 0.075, 0.25), 'secondary', { color: T.trim, cast: false }));
  for (let k = 0; k < 3; k++) {
    const n = 2 + v.int(5), x = -w / 2 + 0.3 + k * 0.28, z = v.r(0.02, 0.2);
    parts.push(part(at(rbox(0.22, 0.008 * n, 0.14, 0.003), x, h + 0.004 * n, z, 0, v.r(-0.3, 0.3)), 'accent', { color: v.pick(LETTERS), mat: 'small' }));
  }
  parts.push(part(at(sphere(0.035, 8, 6), 0.55, h + 0.035, -0.02), 'accent', { color: T.lavender, mat: 'small' }));
  return { parts, footprint: { w, d }, solid: true, anchors: { top: h }, colors: { body: T.oak, secondary: T.ink2, accent: T.brass }, hero: 'letter-tray rack, brass postal scale, stamp' };
}

/**
 * outboxChute (Mailroom signature): a fat teal pillar-box chute with a brass hopper mouth and hinged flap (the
 * parcel drop, §6.4 sign-off run), a porthole showing parcels inside, rivet bands, a domed cap, a ship's bell on a
 * bracket (the "ding"), a cream OUTBOX plaque, and its pipe elbowing up into the ceiling (`ceil` m).
 */
export function buildOutboxChute(p: KitParams = {}, rng: Rng) {
  const R = 0.33, H = 1.2, ceil = p.ceil ?? 2.8;
  const parts: Part[] = [];
  parts.push(part(lathe([[0, 0], [R + 0.05, 0], [R + 0.05, 0.08], [R, 0.1], [R, H - 0.12], [R + 0.03, H - 0.1], [R + 0.03, H - 0.06], [R - 0.02, H], [R * 0.6, H + 0.1], [0.12, H + 0.15], [0, H + 0.15]], 32), 'body'));
  for (const y of [0.2, H - 0.3]) parts.push(part(at(torus(R + 0.008, 0.012, 5, 36), 0, y, 0, PI / 2), 'secondary'));
  for (let i = 0; i < 12; i++) { const a = (i / 12) * PI * 2; for (const y of [0.2, H - 0.3]) parts.push(part(at(sphere(0.012, 6, 4), Math.sin(a) * (R + 0.02), y, Math.cos(a) * (R + 0.02)), 'secondary', { cast: false })); }
  // hopper mouth on the front (+z): a brass lip frame, dark throat, the flap tipped open a little
  const my = 0.82;
  parts.push(part(at(rbox(0.46, 0.2, 0.16, 0.05, 2), 0, my, R - 0.02), 'secondary'));
  parts.push(part(at(rbox(0.38, 0.12, 0.08, 0.03, 1), 0, my, R + 0.035), 'accent', { color: T.ink, cast: false, ao: 0.5 }));
  parts.push(part(at(rbox(0.4, 0.14, 0.018, 0.02, 2), 0, my + 0.06, R + 0.1, 0.55), 'secondary'));
  parts.push(part(at(cyl(0.012, 0.012, 0.44, 8), 0, my + 0.1, R + 0.06, 0, 0, PI / 2), 'secondary'));
  // porthole with parcels behind the glass
  parts.push(part(at(torus(0.09, 0.02, 6, 20), 0, 0.46, R + 0.005), 'secondary'));
  parts.push(part(at(cyl(0.085, 0.085, 0.01, 18), 0, 0.46, R - 0.005, PI / 2), 'accent', { color: '#3C5A5C', cast: false }));
  parts.push(part(at(rbox(0.07, 0.05, 0.02, 0.008), -0.02, 0.43, R - 0.01, 0, 0, 0.3), 'accent', { color: T.kraft, cast: false }));
  parts.push(part(at(rbox(0.05, 0.04, 0.02, 0.008), 0.03, 0.47, R - 0.012, 0, 0, -0.2), 'accent', { color: T.trim, cast: false }));
  // OUTBOX plaque (cream, ink border) above the mouth
  parts.push(part(at(rbox(0.36, 0.1, 0.02, 0.03, 2), 0, 1.02, R + 0.005, -0.05), 'accent', { color: T.trim }));
  for (let i = 0; i < 6; i++) parts.push(part(at(rbox(0.035, 0.05, 0.004), -0.1 + i * 0.04, 1.02, R + 0.018, -0.05), 'accent', { color: T.ink, cast: false })); // stencil blocks "OUTBOX"
  // bell on a bracket (side +x)
  parts.push(part(tube([[R - 0.02, H - 0.2, 0], [R + 0.12, H - 0.12, 0], [R + 0.16, H - 0.05, 0]], 0.012, 8, 5), 'secondary'));
  parts.push(part(at(lathe([[0, 0], [0.07, 0], [0.06, 0.02], [0.045, 0.08], [0.02, 0.1], [0, 0.1]], 16), R + 0.16, H - 0.2, 0), 'secondary'));
  parts.push(part(at(sphere(0.018, 8, 6), R + 0.16, H - 0.21, 0), 'secondary', { color: T.ink2, cast: false }));
  // pipe: up from the cap, an elbow toward the wall (-z), then into the ceiling
  const top = H + 0.15;
  parts.push(part(tube([[0, top - 0.02, 0], [0, top + 0.3, 0], [0, top + 0.5, -0.08], [0, top + 0.62, -0.2], [0, ceil, -0.24]], 0.1, 16, 12), 'body'));
  parts.push(part(at(torus(0.105, 0.014, 5, 20), 0, top + 0.25, 0, PI / 2), 'secondary'));
  parts.push(part(at(lathe([[0.12, 0], [0.2, 0], [0.2, 0.02], [0.12, 0.03]], 20), 0, ceil - 0.03, -0.24), 'secondary', { cast: false }));
  return { parts, footprint: { r: R + 0.06 }, solid: true, anchors: { mouth: [0, my, R + 0.08], bell: [R + 0.16, H - 0.15, 0] }, colors: { body: '#3F6E6A', secondary: T.brass, accent: T.trim }, hero: 'brass hopper mouth + flap, porthole of parcels, ship\'s bell, pipe to the ceiling' };
}

/**
 * capsuleTube: the pneumatic-post terminus (commits, §6.7): a pale tube from the ceiling into a riveted receiver with
 * a brass hatch and a gauge, a delivery tray holding two capsules, a wall bracket.
 */
export function buildCapsuleTube(p: KitParams = {}, rng: Rng) {
  const ceil = p.ceil ?? 2.8;
  const parts = [
    part(at(cyl(0.075, 0.075, ceil - 1.25, 14), 0, (ceil + 1.25) / 2, 0), 'body'),
    part(at(rbox(0.3, 0.36, 0.26, 0.05, 2), 0, 1.08, 0.02), 'secondary'),
    part(at(lathe([[0.09, 0], [0.13, 0.04], [0.13, 0.07], [0.08, 0.08]], 16), 0, 1.24, 0.02), 'accent'),
    part(at(cyl(0.1, 0.1, 0.02, 18), 0, 1.08, 0.155, PI / 2), 'accent'), // hatch
    part(at(rbox(0.1, 0.02, 0.02, 0.006), 0.0, 1.08, 0.172), 'secondary', { cast: false }),
    part(at(cyl(0.035, 0.035, 0.012, 12), 0.1, 1.2, 0.16, PI / 2), 'accent', { color: T.trim, cast: false }), // gauge
    part(at(slab(0.3, 0.2, 0.02, 0.03, 0.006), 0, 0.84, 0.14), 'secondary'), // tray
    part(at(rbox(0.3, 0.05, 0.015, 0.006), 0, 0.87, 0.235), 'secondary'),
    part(at(rbox(0.04, 0.9, 0.04, 0.01), 0, 0.45, -0.08), 'secondary'), // post
    part(at(rbox(0.24, 0.02, 0.2, 0.008), 0, 0.01, -0.02), 'secondary', { ao: 0.7 }),
  ];
  for (const y of [1.6, 2.1, 2.55]) parts.push(part(at(cyl(0.085, 0.085, 0.03, 14), 0, y, 0), 'accent'));
  for (const [x, a] of [[-0.06, 0.2], [0.07, -0.15]]) parts.push(part(at(capsule(0.035, 0.1, 2, 8), x, 0.9, 0.14, PI / 2, a), 'accent', { color: [T.teal, T.butter][x > 0 ? 1 : 0] }));
  return { parts, footprint: { r: 0.18 }, solid: true, anchors: { tray: [0, 0.88, 0.14] }, colors: { body: '#BFD0D2', secondary: T.ink2, accent: T.brass }, hero: 'receiver hatch + capsules in the tray' };
}

/**
 * parcelStack: a seeded tumble of kraft parcels tied with string, address labels, one tipped over.
 */
export function buildParcelStack(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), n = p.n ?? 5, parts: Part[] = [];
  let y = 0, layer = 0;
  const spots = [[-0.18, -0.12], [0.16, -0.1], [-0.1, 0.16], [0.18, 0.18]];
  for (let i = 0; i < n; i++) {
    const w = v.r(0.24, 0.42), h = v.r(0.14, 0.26), d = v.r(0.2, 0.34);
    let x, z, yy, rz = 0;
    if (i < 3) { [x, z] = spots[i]; yy = 0; } else { x = v.r(-0.08, 0.08); z = v.r(-0.08, 0.08); yy = 0.26 + layer * 0.2; layer++; }
    if (i === n - 1 && n > 3) { x = 0.34; z = 0.3; yy = 0; rz = 0.35; }
    const yaw = v.r(-0.4, 0.4);
    parts.push(part(at(rbox(w, h, d, 0.012), x, yy + h / 2, z, 0, yaw, rz), 'body'));
    parts.push(part(at(rbox(0.012, h + 0.004, d + 0.004, 0.001), x, yy + h / 2, z, 0, yaw, rz), 'secondary', { cast: false }));
    parts.push(part(at(rbox(w + 0.004, h + 0.004, 0.012, 0.001), x, yy + h / 2, z, 0, yaw, rz), 'secondary', { cast: false }));
    parts.push(part(at(rbox(w * 0.3, 0.004, d * 0.3, 0.001), x + w * 0.18 * Math.cos(yaw), yy + h + 0.003, z - w * 0.18 * Math.sin(yaw), 0, yaw, rz), 'accent', { cast: false }));
    y = Math.max(y, yy + h);
  }
  return { parts, footprint: { w: 0.8, d: 0.7 }, collider: { r: 0.36 }, solid: true, anchors: { top: y }, colors: { body: T.kraft, secondary: T.trim, accent: T.butter }, hero: 'string-tied parcels, one tipped over' };
}

/** mailSack: a slumped canvas sack, tied neck, a stencilled band; `full` puffs it up. */
export function buildMailSack(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), s = p.full ? 1.15 : 1;
  const g = lathe([[0, 0], [0.18, 0.01], [0.23, 0.08], [0.24, 0.2], [0.2, 0.34], [0.12, 0.42], [0.06, 0.44], [0.07, 0.5], [0.04, 0.53], [0, 0.53]].map(([r, y]) => [r * s, y * s]), 16);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); pos.setX(i, pos.getX(i) * (1 + 0.15 * (1 - y / 0.53))); pos.setX(i, pos.getX(i) + y * y * 0.25 * v.r(0.8, 1.2)); }
  g.computeVertexNormals();
  const parts = [part(g, 'body', { mat: 'fabric' })];
  parts.push(part(at(torus(0.06 * s, 0.014, 5, 12), 0.07 * s, 0.45 * s, 0, PI / 2), 'secondary'));
  parts.push(part(at(torus(0.25 * s, 0.008, 4, 24, PI * 0.9), 0.02, 0.18 * s, 0, PI / 2, 0, -0.5), 'accent', { cast: false }));
  return { parts, footprint: { r: 0.28 * s }, solid: false, anchors: {}, colors: { body: '#C9BCA2', secondary: T.walnut, accent: T.tealDeep }, hero: 'tied neck + stencil band' };
}

/** handTruck: a two-wheeled dolly leaning back, with two parcels strapped on. */
export function buildHandTruck(p: KitParams = {}, rng: Rng) {
  const parts: Part[] = [];
  const lean = 0.22, H = 1.05;
  for (const e of [-1, 1]) {
    parts.push(part(rod(0.014, [e * 0.17, 0.08, 0], [e * 0.17, H, -lean]), 'secondary'));
    parts.push(part(at(torus(0.08, 0.03, 8, 16), e * 0.24, 0.1, -0.04, 0, PI / 2), 'secondary', { color: T.ink }));
    parts.push(part(at(cyl(0.03, 0.03, 0.04, 10), e * 0.24, 0.1, -0.04, 0, 0, PI / 2), 'accent'));
  }
  parts.push(part(tube([[-0.17, H, -lean], [-0.1, H + 0.08, -lean - 0.02], [0.1, H + 0.08, -lean - 0.02], [0.17, H, -lean]], 0.014, 10, 5), 'secondary'));
  for (const y of [0.45, 0.8]) parts.push(part(at(cyl(0.01, 0.01, 0.34, 6), 0, y, -(y / H) * lean, 0, 0, PI / 2), 'secondary', { cast: false }));
  parts.push(part(at(rbox(0.38, 0.02, 0.22, 0.006), 0, 0.02, 0.1), 'accent'));
  parts.push(part(at(rbox(0.34, 0.26, 0.26, 0.012), 0, 0.16, 0.08, -0.08), 'body'));
  parts.push(part(at(rbox(0.28, 0.2, 0.22, 0.012), 0.01, 0.4, 0.04, -0.12, 0.12), 'body'));
  parts.push(part(at(rbox(0.36, 0.03, 0.012, 0.004), 0, 0.3, 0.2, -0.1), 'accent', { color: T.tealDeep, cast: false }));
  return { parts, footprint: { w: 0.5, d: 0.4 }, collider: { r: 0.24 }, solid: true, anchors: {}, colors: { body: T.kraft, secondary: T.ink2, accent: T.brass }, hero: 'fat rubber wheels, strapped parcels' };
}

// ------------------------------------------------------------------------------------------------ Archive
/**
 * vaultDoor (Archive signature): a round bank-vault door set in a steel frame ring: bolt-head ring, a brass five-spoke
 * wheel on a hub, a combination dial, chunky hinge blocks, a cream maker's plate. Origin = floor under the door
 * centre (the layout lifts it 0.1 m); the door face stays ≤ 0.1 m proud so STAT's NVMe thermometer (local x +0.48)
 * sits on it cleanly.
 */
export function buildVaultDoor(p: KitParams = {}, rng: Rng) {
  const cy = 0.8, R = 0.72;
  const parts: Part[] = [];
  // frame ring against the wall (lathe around z)
  const frame = lathe([[R + 0.02, -0.06], [R + 0.16, -0.06], [R + 0.16, 0.02], [R + 0.12, 0.05], [R + 0.03, 0.05], [R + 0.01, 0.0]], 48);
  parts.push(part(at(frame, 0, cy, -0.02, PI / 2), 'secondary'));
  const door = lathe([[0, -0.03], [R - 0.01, -0.03], [R, 0.0], [R - 0.02, 0.05], [R - 0.12, 0.07], [R - 0.14, 0.09], [0, 0.09]], 48);
  parts.push(part(at(door, 0, cy, -0.02, PI / 2), 'body'));
  for (let i = 0; i < 16; i++) { const a = (i / 16) * PI * 2; parts.push(part(at(sphere(0.022, 8, 6), Math.sin(a) * (R - 0.07), cy + Math.cos(a) * (R - 0.07), 0.055, 0, 0, 0, 1, 1, 0.6), 'accent', { cast: false })); }
  // wheel: hub + 5 spokes with ball ends
  parts.push(part(at(cyl(0.07, 0.08, 0.06, 18), 0, cy, 0.1, PI / 2), 'accent'));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * PI * 2 + 0.3, x = Math.sin(a), y = Math.cos(a);
    parts.push(part(rod(0.016, [x * 0.05, cy + y * 0.05, 0.12], [x * 0.27, cy + y * 0.27, 0.13]), 'accent'));
    parts.push(part(at(sphere(0.03, 10, 8), x * 0.28, cy + y * 0.28, 0.13), 'accent'));
  }
  parts.push(part(at(torus(0.26, 0.014, 5, 32), 0, cy, 0.125), 'accent'));
  // combination dial (left) + hinge blocks (right edge, on the frame)
  parts.push(part(at(cyl(0.075, 0.08, 0.035, 20), -0.36, cy + 0.3, 0.08, PI / 2), 'secondary'));
  parts.push(part(at(cyl(0.05, 0.05, 0.02, 16), -0.36, cy + 0.3, 0.105, PI / 2), 'accent', { color: T.trim, cast: false }));
  parts.push(part(at(rbox(0.012, 0.03, 0.01, 0.002), -0.36, cy + 0.36, 0.118), 'secondary', { cast: false, color: T.ink }));
  for (const y of [cy - 0.4, cy + 0.4]) parts.push(part(at(capsule(0.05, 0.14, 3, 12), R + 0.08, y, 0.06), 'secondary'));
  parts.push(part(at(rbox(0.26, 0.08, 0.012, 0.02, 2), -0.3, cy - 0.38, 0.075, 0, 0, 0.15), 'accent', { color: T.trim, cast: false })); // maker's plate
  return { parts, footprint: { w: 2 * (R + 0.16), d: 0.2 }, solid: false, anchors: { wheel: [0, cy, 0.13] }, colors: { body: '#9EA19B', secondary: '#5F625E', accent: T.brass }, hero: 'bolt ring, five-spoke brass wheel, combination dial' };
}

/**
 * mapChest: a wide plan chest of shallow drawers (walnut, brass pulls + label frames); one drawer pulled out with a
 * map curling over its lip; a rolled map and a magnifier on top.
 */
export function buildMapChest(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 1.8, h = p.h ?? 0.9, d = p.d ?? 0.8, n = 6, plinth = 0.08;
  const dh = (h - plinth - 0.06) / n;
  const parts = [
    part(at(rbox(w, h - plinth, d, 0.025, 1), 0, plinth + (h - plinth) / 2, 0), 'body', { mat: 'wood', ao: 0.9 }),
    part(at(rbox(w - 0.1, plinth, d - 0.1, 0.02), 0, plinth / 2, 0), 'body', { mat: 'wood', ao: 0.6 }),
    part(at(slab(w + 0.05, d + 0.05, 0.035, 0.03, 0.012), 0, h - 0.01, 0), 'body', { mat: 'wood' }),
  ];
  const out = 1 + v.int(3);
  for (let i = 0; i < n; i++) {
    const y = plinth + 0.03 + (i + 0.5) * dh, pz = i === out ? 0.22 : 0;
    parts.push(part(at(rbox(w - 0.06, dh - 0.016, 0.022, 0.006), 0, y, d / 2 + pz), 'body', { mat: 'wood' }));
    for (const e of [-1, 1]) parts.push(part(at(rbox(0.1, 0.014, 0.018, 0.004), e * w * 0.28, y - 0.008, d / 2 + 0.02 + pz), 'accent', { cast: false }));
    parts.push(part(at(rbox(0.1, 0.035, 0.006, 0.002), 0, y + 0.004, d / 2 + 0.014 + pz), 'secondary', { cast: false }));
    if (i === out) {
      parts.push(part(at(rbox(w - 0.1, dh - 0.03, 0.22, 0.004), 0, y - 0.005, d / 2 - 0.1 + pz), 'body', { mat: 'wood', ao: 0.7 }));
      const sheet = new THREE.PlaneGeometry(w * 0.6, 0.3, 8, 4), sp = sheet.getAttribute('position');
      for (let k = 0; k < sp.count; k++) { const t = (sp.getY(k) + 0.15) / 0.3; sp.setZ(k, t * t * 0.12); }
      sheet.computeVertexNormals();
      parts.push(part(at(sheet, 0.1, y + dh / 2 + 0.01, d / 2 + 0.1, -PI / 2 + 0.2), 'secondary', { cast: false, color: '#E6DCC4' }));
    }
  }
  for (let i = 0; i < 3; i++) parts.push(part(at(rbox(w / 3 - 0.1, h - plinth - 0.16, 0.02, 0.01), -w / 3 + i * (w / 3), plinth + (h - plinth) / 2, -d / 2 - 0.006), 'body', { mat: 'wood', ao: 0.85 })); // back panels
  for (const e of [-1, 1]) parts.push(part(at(rbox(0.02, h - plinth - 0.16, d - 0.14, 0.01), e * (w / 2 + 0.006), plinth + (h - plinth) / 2, 0), 'body', { mat: 'wood', ao: 0.85 }));
  parts.push(part(at(capsule(0.035, 0.7, 3, 10), -w * 0.2, h + 0.06, -0.15, 0, 0.2, PI / 2), 'secondary', { color: '#E6DCC4' }));
  parts.push(part(at(torus(0.045, 0.01, 5, 16), w * 0.28, h + 0.03, 0.05, PI / 2), 'accent'));
  parts.push(part(at(cyl(0.012, 0.012, 0.12, 6), w * 0.28 + 0.1, h + 0.03, 0.08, 0, -0.3, PI / 2), 'secondary', { color: T.walnutDark }));
  return { parts, footprint: { w, d }, solid: true, anchors: { top: h }, colors: { body: T.walnut, secondary: T.trim, accent: T.brass }, hero: 'shallow drawers, one out with a curling map; magnifier' };
}

/**
 * archiveShelf: steel archive shelving (posts, 4 shelves, X-brace) packed with banker's boxes (hand holes, label
 * cards), a few skewed or missing, a blueprint tube on top.
 */
export function buildArchiveShelf(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 2.4, h = p.h ?? 1.7, d = p.d ?? 0.45, nS = 4;
  const parts: Part[] = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(part(at(rbox(0.035, h, 0.035, 0.008), sx * (w / 2 - 0.02), h / 2, sz * (d / 2 - 0.02)), 'secondary'));
  parts.push(part(rod(0.006, [-w / 2 + 0.03, 0.1, -d / 2 + 0.01], [w / 2 - 0.03, h - 0.1, -d / 2 + 0.01], 4), 'secondary', { cast: false }));
  parts.push(part(rod(0.006, [w / 2 - 0.03, 0.1, -d / 2 + 0.01], [-w / 2 + 0.03, h - 0.1, -d / 2 + 0.01], 4), 'secondary', { cast: false }));
  const pitch = (h - 0.08) / nS;
  for (let k = 0; k < nS; k++) {
    const y = 0.06 + k * pitch;
    parts.push(part(at(rbox(w, 0.025, d, 0.006), 0, y, 0), 'secondary'));
    parts.push(part(at(rbox(w - 0.02, 0.02, 0.01, 0.003), 0, y + 0.005, d / 2 + 0.003), 'secondary', { cast: false })); // lip
    let x = -w / 2 + 0.06;
    const bh = Math.min(0.28, pitch - 0.06);
    while (x < w / 2 - 0.3) {
      if (v.chance(0.12)) { x += 0.3; continue; }
      const bw = v.r(0.24, 0.3), skew = v.chance(0.15) ? v.r(-0.12, 0.12) : 0, col = v.pick([T.kraft, T.kraft, T.oat, '#A9906E']);
      parts.push(part(at(rbox(bw, bh, d - 0.06, 0.01), x + bw / 2, y + 0.0125 + bh / 2, 0.01 + (skew ? 0.05 : 0), 0, skew), 'body', { color: col }));
      parts.push(part(at(rbox(0.09, 0.035, 0.004), x + bw / 2, y + 0.0125 + bh * 0.4, d / 2 - 0.018 + (skew ? 0.05 : 0), 0, skew), 'accent', { cast: false, color: T.ink2 })); // hand hole
      parts.push(part(at(rbox(0.1, 0.05, 0.004), x + bw / 2, y + 0.0125 + bh * 0.72, d / 2 - 0.018 + (skew ? 0.05 : 0), 0, skew), 'accent', { cast: false, color: T.trim }));
      x += bw + 0.012;
    }
  }
  parts.push(part(at(capsule(0.045, 0.6, 3, 10), 0.2, h + 0.05, 0, 0, 0.1, PI / 2), 'body', { color: T.tealDeep }));
  return { parts, footprint: { w, d }, solid: true, anchors: { top: h }, colors: { body: T.kraft, secondary: T.steel, accent: T.trim }, hero: "banker's boxes with hand holes, X-brace" };
}

/**
 * microficheDesk: the reader's desk + hood that STAT's microfiche (world/stats/misc.ts) mounts its reels (y 1.32) and
 * screen (y 0.96, z 0.157, tilted −0.2) on: a steel-oat desk with a drawer, a tilted ink hood whose face sits just
 * behind the screen, a film-box stack and a lens on the desk.
 */
export function buildMicroficheDesk(p: KitParams = {}, rng: Rng) {
  const w = p.w ?? 1.0, d = p.d ?? 0.7, h = 0.62;
  const parts = [
    part(at(slab(w, d, 0.04, 0.04, 0.012), 0, h - 0.04, 0), 'body'),
    part(at(rbox(0.36, h - 0.08, d - 0.08, 0.02), w / 2 - 0.22, (h - 0.04) / 2, 0), 'body', { ao: 0.9 }),
    part(at(rbox(0.3, 0.14, 0.02, 0.008), w / 2 - 0.22, h - 0.16, d / 2 - 0.03), 'body'),
    part(at(torus(0.03, 0.007, 4, 10, PI), w / 2 - 0.22, h - 0.15, d / 2 - 0.015, PI / 2 - 0.2, 0, PI), 'accent', { cast: false }),
    part(leg(-w / 2 + 0.06, -d / 2 + 0.06, 0, h - 0.04, 0.02, 0.014, 8), 'secondary'),
    part(leg(-w / 2 + 0.06, d / 2 - 0.06, 0, h - 0.04, 0.02, 0.014, 8), 'secondary'),
    // hood: a tilted rounded body (its face ≈ z 0.14 at y 0.96, just behind STAT's screen)
    part(at(rbox(0.72, 0.52, 0.34, 0.06, 2), 0, 0.95, -0.03, -0.2), 'secondary'),
    part(at(rbox(0.66, 0.44, 0.02, 0.03), 0, 0.955, 0.138, -0.2), 'secondary', { color: T.ink, cast: false }),
    part(at(rbox(0.5, 0.06, 0.3, 0.02), 0, h + 0.03, 0.0), 'secondary'),
  ];
  for (let k = 0; k < 3; k++) parts.push(part(at(rbox(0.12, 0.03, 0.12, 0.006), -w / 2 + 0.14, h + 0.015 + k * 0.032, 0.18, 0, k * 0.2), 'accent', { color: [T.tealDeep, T.trim, T.butter][k], mat: 'small' }));
  parts.push(part(at(torus(0.04, 0.008, 5, 14), w / 2 - 0.14, h + 0.01, 0.22, PI / 2), 'accent'));
  return { parts, footprint: { w, d }, solid: true, anchors: { top: h }, colors: { body: T.steelOat, secondary: '#4A4F55', accent: T.brass }, hero: 'tilted reader hood' };
}

// ------------------------------------------------------------------------------------------------ Plaza phones
/**
 * phoneBooth (the phones' signature, §7.1 Plaza mcp station): a shallow hooded wall booth: slate-teal cabinet sides
 * with little porthole windows, a quilted acoustic back panel, a curved hood with a glowing PHONE lightbox, a wall
 * rotary phone (handset on its cradle, coiled cord), a notepad shelf with a pencil. The caller stands in front.
 */
export function buildPhoneBooth(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 0.85, H = p.h ?? 2.0, d = p.d ?? 0.4;
  const parts: Part[] = [];
  parts.push(part(at(rbox(w, H - 0.2, 0.06, 0.02), 0, (H - 0.2) / 2, -d / 2 + 0.03), 'body', { mat: 'wood' })); // back
  for (const e of [-1, 1]) {
    parts.push(part(at(rbox(0.06, H - 0.18, d, 0.025, 1), e * (w / 2 - 0.03), (H - 0.18) / 2, 0), 'body', { mat: 'wood' }));
    for (const [y0, y1] of [[0.12, 0.72], [0.82, 1.62]]) parts.push(part(at(rbox(0.012, y1 - y0, d - 0.12, 0.005), e * (w / 2 - 0.066), (y0 + y1) / 2, 0.01), 'body', { mat: 'wood', ao: 0.8, cast: false })); // inner panels
    parts.push(part(at(capsule(0.035, H - 0.36, 3, 10), e * (w / 2 - 0.02), (H - 0.2) / 2, d / 2), 'body', { mat: 'wood' })); // rounded front pillar
    parts.push(part(at(cyl(0.04, 0.045, 0.05, 12), e * (w / 2 - 0.02), 0.025, d / 2), 'secondary')); // pillar foot
    parts.push(part(at(torus(0.06, 0.014, 5, 16), e * (w / 2 + 0.001), 1.35, 0.02, 0, PI / 2), 'secondary'));
    parts.push(part(at(cyl(0.055, 0.055, 0.064, 14), e * (w / 2 - 0.03), 1.35, 0.02, 0, 0, PI / 2), 'secondary', { color: '#3C5657', cast: false })); // porthole glass
  }
  // barrel-vault roof + a crown lightbox reading PHONE (glows; ~0.9 × by day)
  const rr = d / 2 + 0.04, ry = H - 0.2;
  parts.push(part(at(new THREE.CylinderGeometry(rr, rr, w + 0.08, 18, 1, false, 0, PI), 0, ry, 0, 0, 0, PI / 2), 'body', { mat: 'wood' }));
  parts.push(part(at(rbox(w + 0.1, 0.05, d + 0.1, 0.02), 0, ry - 0.02, 0.0), 'secondary'));
  parts.push(part(at(rbox(0.5, 0.16, 0.14, 0.04, 2), 0, ry + rr + 0.05, 0.0), 'secondary'));
  for (const e of [-1, 1]) {
    parts.push(part(at(rbox(0.44, 0.1, 0.02, 0.02), 0, ry + rr + 0.05, e * 0.065), 'bulb', { mat: 'bulb', cast: false, color: '#F3E3C0' }));
    for (let i = 0; i < 5; i++) parts.push(part(at(rbox(0.045, 0.055, 0.004), (-0.1 + i * 0.05) * e, ry + rr + 0.05, e * 0.077), 'secondary', { color: T.ink, cast: false }));
  }
  for (const e of [-1, 1]) parts.push(part(at(sphere(0.035, 10, 8), e * (w / 2 + 0.01), ry + 0.02, d / 2 + 0.02), 'secondary')); // finials
  // quilted acoustic panel
  parts.push(part(at(rbox(w - 0.18, 0.9, 0.04, 0.03, 2), 0, 1.05, -d / 2 + 0.07), 'accent', { mat: 'fabric' }));
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) parts.push(part(at(sphere(0.012, 6, 4), -0.18 + c * 0.18, 0.7 + r * 0.24, -d / 2 + 0.092), 'accent', { mat: 'fabric', ao: 0.6, cast: false }));
  // rotary phone: body, dial, handset on the cradle hooks, coiled cord
  const px = -0.12, py = 1.18, pz = -d / 2 + 0.14;
  parts.push(part(at(rbox(0.2, 0.26, 0.09, 0.04, 2), px, py, pz), 'secondary'));
  parts.push(part(at(cyl(0.055, 0.055, 0.012, 16), px, py - 0.03, pz + 0.05, PI / 2), 'secondary', { color: T.trim, cast: false }));
  parts.push(part(at(cyl(0.015, 0.015, 0.016, 8), px, py - 0.03, pz + 0.056, PI / 2), 'secondary', { cast: false }));
  const hs = capsule(0.022, 0.16, 3, 8);
  parts.push(part(at(hs, px, py + 0.16, pz + 0.04, 0, 0, PI / 2), 'secondary'));
  for (const e of [-1, 1]) parts.push(part(at(sphere(0.034, 10, 8), px + e * 0.1, py + 0.16, pz + 0.045, 0, 0, 0, 1, 0.8, 0.9), 'secondary'));
  const cord = [];
  for (let i = 0; i <= 28; i++) { const t = i / 28, a = t * PI * 14; cord.push([px + 0.1 + Math.sin(a) * 0.012 + t * 0.02, py + 0.1 - t * 0.35, pz + 0.05 + Math.cos(a) * 0.012]); }
  parts.push(part(tube(cord, 0.004, 56, 3), 'secondary', { cast: false }));
  // notepad shelf + pad + pencil
  parts.push(part(at(slab(w - 0.12, 0.16, 0.025, 0.02, 0.006), 0, 0.86, -d / 2 + 0.14), 'body', { mat: 'wood' }));
  parts.push(part(at(rbox(0.12, 0.012, 0.09, 0.003), 0.14, 0.891, -d / 2 + 0.15, 0, 0.15), 'secondary', { color: v.pick(NOTES), mat: 'small' }));
  parts.push(part(at(cyl(0.005, 0.005, 0.12, 6), 0.1, 0.9, -d / 2 + 0.2, 0, 0.4, PI / 2), 'secondary', { color: T.butter, mat: 'small', cast: false }));
  // kick plate + threshold
  parts.push(part(at(rbox(w - 0.06, 0.1, 0.03, 0.012), 0, 0.05, -d / 2 + 0.07), 'secondary', { ao: 0.8 }));
  return { parts, footprint: { w, d }, solid: true, anchors: { phone: [px, py, pz + 0.06] }, colors: { body: '#4E6E6E', secondary: T.ink2, accent: '#C9BFAE' }, hero: 'hood with PHONE lightbox, quilted back, rotary phone + coiled cord' };
}

/**
 * bookCart: a library returns cart: two sloped walnut troughs on a frame with casters, books leaning in rows, a
 * brass push bar. (Reading Alley / Archive `bookCart`.)
 */
export function buildBookCart(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 0.9, h = p.h ?? 0.9, d = p.d ?? 0.5;
  const parts: Part[] = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    parts.push(part(at(rbox(0.035, h - 0.12, 0.035, 0.01), sx * (w / 2 - 0.03), (h - 0.12) / 2 + 0.08, sz * (d / 2 - 0.03)), 'body', { mat: 'wood' }));
    parts.push(part(at(cyl(0.032, 0.032, 0.03, 8), sx * (w / 2 - 0.03), 0.034, sz * (d / 2 - 0.03), 0, 0, PI / 2), 'secondary'));
  }
  for (const [y, tilt] of [[0.22, 0], [0.56, 0]]) {
    for (const e of [-1, 1]) { // two back-to-back sloped troughs (a V) per tier
      parts.push(part(at(rbox(w - 0.04, 0.02, d / 2 - 0.02, 0.006), 0, y + 0.04, e * d / 4, e * 0.35), 'body', { mat: 'wood' }));
      let x = -w / 2 + 0.06;
      while (x < w / 2 - 0.08) {
        const bw = v.r(0.045, 0.07), bh = v.r(0.16, 0.24);
        if (v.chance(0.1)) { x += 0.1; continue; }
        parts.push(part(at(rbox(bw, bh, v.r(0.12, 0.16), 0.004), x + bw / 2, y + 0.06 + bh / 2, e * (d / 4 + 0.02), e * 0.35 + tilt), 'secondary', { color: v.pick(SPINES) }));
        x += bw + 0.004;
      }
    }
    parts.push(part(at(rbox(w - 0.02, 0.06, 0.03, 0.01), 0, y + 0.1, 0), 'body', { mat: 'wood' })); // spine board
  }
  parts.push(part(at(cyl(0.014, 0.014, d - 0.02, 8), -w / 2 - 0.05, h - 0.02, 0, PI / 2), 'accent'));
  for (const e of [-1, 1]) parts.push(part(at(cyl(0.01, 0.01, 0.07, 6), -w / 2 - 0.015, h - 0.02, e * (d / 2 - 0.04), 0, 0, PI / 2), 'accent', { cast: false }));
  return { parts, footprint: { w: w + 0.08, d }, solid: true, anchors: {}, colors: { body: T.walnut, secondary: T.trim, accent: T.brass }, hero: 'sloped V troughs of leaning books, brass push bar' };
}

/** Registry block (kit/registry.ts spreads these): builders, signature set (6k-tri budget), prop-sheet rows. */
export const STACKS_KIT = Object.freeze({
  libChair: buildLibChair, readingTable: buildReadingTable, bankerLamp: buildBankerLamp, globe: buildGlobe, teaTrolley: buildTeaTrolley,
  ladder: buildLadder, brassRail: buildBrassRail, sconce: buildSconce, cardCatalog: buildCardCatalog, bookCart: buildBookCart,
  pigeonholes: buildPigeonholes, sortingTable: buildSortingTable, outboxChute: buildOutboxChute, capsuleTube: buildCapsuleTube,
  parcelStack: buildParcelStack, mailSack: buildMailSack, handTruck: buildHandTruck,
  vaultDoor: buildVaultDoor, mapChest: buildMapChest, archiveShelf: buildArchiveShelf, microficheDesk: buildMicroficheDesk,
  phoneBooth: buildPhoneBooth,
});
export const STACKS_SIGNATURE = Object.freeze(['globe', 'outboxChute', 'vaultDoor', 'phoneBooth', 'pigeonholes', 'teaTrolley', 'archiveShelf', 'cardCatalog', 'sortingTable']);
export const STACKS_SHEET: readonly SheetEntry[] = Object.freeze<SheetEntry[]>([
  ['globe', {}, 'globe ★ (LIB)'], ['libChair', {}, 'libChair'], ['readingTable', {}, 'readingTable'], ['bankerLamp', {}, "banker's lamp"],
  ['teaTrolley', {}, 'teaTrolley'], ['ladder', {}, 'library ladder'], ['sconce', {}, 'sconce'], ['cardCatalog', {}, 'cardCatalog'], ['bookCart', {}, 'bookCart'],
  ['outboxChute', { ceil: 2.2 }, 'OUTBOX chute ★ (MAIL)'], ['pigeonholes', { w: 2.2 }, 'pigeonholes'], ['sortingTable', {}, 'sortingTable'],
  ['capsuleTube', { ceil: 2.2 }, 'capsule tube'], ['parcelStack', {}, 'parcelStack'], ['mailSack', { full: true }, 'mailSack'], ['handTruck', {}, 'handTruck'],
  ['vaultDoor', {}, 'vault door ★ (ARC)'], ['mapChest', {}, 'mapChest'], ['archiveShelf', {}, 'archiveShelf'], ['microficheDesk', {}, 'microfiche desk'],
  ['phoneBooth', {}, 'phone booth ★ (PLZ)'],
]);
