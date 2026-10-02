/**
 * Wild visitors' models (wildlife.ts): smooth sculpted hulls (sculpt.ts) with a few crisp accents, merged into one
 * rigged geometry each (rig.ts), so a species is one instanced draw call. Front faces +z, feet at y = 0.
 *
 * Quadrupeds (deer, fox) share one rig layout (`quadSpec`): 0 neck/head pitch (+ = nose down), 1 head yaw,
 * 2 ears (+ perk up / − lay back), 3 tail (+ up), 4..7 upper legs LF RF LH RH (+ = swing back), 8..11 lower legs
 * (relative to the upper). The scene IK's the legs (gait.ts) and converts to these channels (wildAnim.ts).
 * Masks: deer coat = tint, the fawn's spots = tint2 (the doe's tint2 hides them).
 */
import * as THREE from 'three';
import { PAL } from '../toon.ts';
import { loft } from '../sculpt.ts';
import type { Face, LoftOpts, Ring } from '../sculpt.ts';
import { assemble, piece } from './rig.ts';
import type { Piece, RigPart, RigSpec, V3 } from './rig.ts';
import type { Model } from './models.ts';
export type { Model };

const ball = (r: number, w = 7, h = 5) => new THREE.SphereGeometry(r, w, h);
const cone = (r: number, h: number, s = 5) => new THREE.ConeGeometry(r, h, s);
const X = [1, 0, 0] as const, Y = [0, 1, 0] as const, Z = [0, 0, 1] as const;
const L = (rings: readonly Ring[], paint: LoftOpts['paint'], o: Partial<LoftOpts> = {}) => loft(rings, { sides: 12, sub: 2, paint, ...o });
/** rings whose frames keep +z as "up" (ears, legs: spines running vertically) */
const zup = (rs: Ring[]): Ring[] => rs.map((r) => ({ ...r, up: [0, 0, 1] as const }));
const below = (f: Face, k: number) => Math.sin(f.a) < k;

// ---------------------------------------------------------------------------------------------
// Quadruped rig

export interface QuadLeg { hip: V3; knee: V3; foot: V3 }
export interface QuadDims {
  neck: V3;
  ears: readonly [V3, V3];
  tail: V3;
  /** LF, RF, LH, RH */
  legs: readonly [QuadLeg, QuadLeg, QuadLeg, QuadLeg];
  /** the tail swings opposite to the head's yaw by this much */
  tailSway: number;
}
export interface QuadModel extends Model { dims: QuadDims }

export function quadSpec(name: string, d: QuadDims): RigSpec {
  const parts: RigPart[] = [
    { id: 1, pivot: d.neck, ops: [{ axis: X, ch: 0 }, { axis: Y, ch: 1 }] },
    { id: 2, pivot: d.ears[0], parent: 1, ops: [{ axis: Z, ch: 2 }] },
    { id: 3, pivot: d.ears[1], parent: 1, ops: [{ axis: Z, ch: 2, gain: -1 }] },
    { id: 4, pivot: d.tail, ops: [{ axis: Y, ch: 1, gain: -d.tailSway }, { axis: X, ch: 3 }] },
  ];
  for (let i = 0; i < 4; i++) {
    parts.push({ id: 5 + i, pivot: d.legs[i].hip, ops: [{ axis: X, ch: 4 + i }] });
    parts.push({ id: 9 + i, pivot: d.legs[i].knee, parent: 5 + i, ops: [{ axis: X, ch: 8 + i }] });
  }
  return { name, parts };
}

/** a two-piece leg (upper on part 5+i, lower on 9+i) through hip → knee → foot, with a hoof / paw */
function quadLeg(i: number, g: QuadLeg, o: { top: readonly [number, number]; knee: number; ankle: number; paint: (f: Face, lower: boolean) => number; hoof: number; hoofR: number; mask?: number }): Piece[] {
  const [hx, hy, hz] = g.hip, [kx, ky, kz] = g.knee, [fx, fy, fz] = g.foot;
  const mid = (a: number, b: number, t: number) => a + (b - a) * t;
  const upper = L(zup([
    { p: [hx, hy + 0.02, hz], r: [o.top[0] * 0.7, o.top[1] * 0.7] },
    { p: [mid(hx, kx, 0.12), mid(hy, ky, 0.12), mid(hz, kz, 0.12)], r: [o.top[0], o.top[1]] },
    { p: [mid(hx, kx, 0.55), mid(hy, ky, 0.55), mid(hz, kz, 0.55)], r: [o.top[0] * 0.62, o.top[1] * 0.6] },
    { p: [kx, ky, kz], r: o.knee },
  ]), (f) => o.paint(f, false), { sides: 10 });
  const lower = L(zup([
    { p: [kx, ky + 0.01, kz], r: o.knee },
    { p: [mid(kx, fx, 0.4), mid(ky, fy, 0.4), mid(kz, fz, 0.4)], r: o.ankle * 1.05 },
    { p: [fx, fy + o.hoofR * 1.6, fz], r: o.ankle },
    { p: [fx, fy + o.hoofR * 0.6, fz + o.hoofR * 0.2], r: [o.hoofR, o.hoofR * 1.1] },
  ]), (f) => (f.t > 0.8 ? o.hoof : o.paint(f, true)), { sides: 9, caps: ['pole', 'flat'] });
  return [piece(upper, null, { part: 5 + i, mask: o.mask ?? 0 }), piece(lower, null, { part: 9 + i, mask: o.mask ?? 0 })];
}

// ---------------------------------------------------------------------------------------------
// Roe deer (the doe; the fawn is the same body smaller, its spots shown through tint2)

const DEER = { coat: 0xc47a45, cream: 0xf3e6cf, white: 0xfbf7ef, dark: 0x3a2a22, nose: 0x2b2220, hoof: 0x3a2e28, earIn: 0xe9c9b2, spot: 0xf6ead6 };

export const DEER_DIMS: QuadDims = {
  neck: [0, 0.86, 0.28],
  ears: [[0.05, 1.21, 0.46], [-0.05, 1.21, 0.46]],
  tail: [0, 0.82, -0.44],
  legs: [
    { hip: [0.085, 0.74, 0.25], knee: [0.08, 0.34, 0.28], foot: [0.08, 0, 0.275] },
    { hip: [-0.085, 0.74, 0.25], knee: [-0.08, 0.34, 0.28], foot: [-0.08, 0, 0.275] },
    { hip: [0.09, 0.76, -0.3], knee: [0.085, 0.36, -0.42], foot: [0.085, 0, -0.35] },
    { hip: [-0.09, 0.76, -0.3], knee: [-0.085, 0.36, -0.42], foot: [-0.085, 0, -0.35] },
  ],
  tailSway: 0.3,
};

/** fawn spots: a scatter of little dapples along the back and flanks (per face of the hull) */
const dapple = (f: Face) => {
  if (f.t < 0.12 || f.t > 0.85 || Math.sin(f.a) < 0.05) return false;
  const i = Math.floor(f.t * 13), j = Math.floor(((f.a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2) * 12);
  return ((i * 7 + j * 5) % 4 === 0) && Math.abs(Math.cos(f.a)) > 0.2;
};

export function deer(): QuadModel {
  const D = DEER, d = DEER_DIMS;
  const body = (f: Face) => (f.t < 0.12 ? D.white : below(f, -0.45) ? D.cream : dapple(f) ? D.spot : D.coat);
  const p: Piece[] = [
    // one long hull: round rump, a deep chest, rising into the withers
    piece(L([
      { p: [0, 0.77, -0.5], r: 0.05 }, { p: [0, 0.8, -0.43], r: [0.13, 0.13, 0.14] }, { p: [0, 0.79, -0.3], r: [0.165, 0.15, 0.17] },
      { p: [0, 0.76, -0.1], r: [0.155, 0.14, 0.16] }, { p: [0, 0.78, 0.1], r: [0.155, 0.15, 0.19] }, { p: [0, 0.82, 0.25], r: [0.13, 0.15, 0.17] },
      { p: [0, 0.89, 0.32], r: 0.08 },
    ], body, { sides: 14, coat: (f) => (f.t < 0.12 || below(f, -0.45) ? 0 : dapple(f) ? 2 : 1) }), null, { mask: 1 }),
    // neck rising forward into the head (one part with the head)
    piece(L([
      { p: [0, 0.84, 0.22], r: [0.105, 0.115] }, { p: [0, 0.93, 0.33], r: [0.078, 0.084] }, { p: [0, 1.03, 0.42], r: [0.064, 0.068] },
      { p: [0, 1.1, 0.46], r: [0.058, 0.06] }, { p: [0, 1.15, 0.47], r: 0.04 },
    ], (f) => (below(f, -0.6) && f.t > 0.55 ? D.cream : D.coat), { coat: (f) => (below(f, -0.6) && f.t > 0.55 ? 0 : 1) }), null, { part: 1, mask: 1 }),
    // head: a soft wedge, cream chin and a white band behind the dark nose
    piece(L([
      { p: [0, 1.155, 0.41], r: 0.045 }, { p: [0, 1.165, 0.46], r: [0.085, 0.08, 0.075] }, { p: [0, 1.145, 0.53], r: [0.074, 0.067, 0.062] },
      { p: [0, 1.115, 0.6], r: [0.052, 0.048, 0.045] }, { p: [0, 1.098, 0.645], r: [0.038, 0.036, 0.034] }, { p: [0, 1.09, 0.665], r: 0.022 },
    ], (f) => (f.t > 0.86 ? D.nose : f.t > 0.7 && below(f, 0.3) ? D.white : below(f, -0.35) && f.t > 0.3 ? D.cream : D.coat),
    { coat: (f) => (f.t > 0.7 || (below(f, -0.35) && f.t > 0.3) ? 0 : 1) }), null, { part: 1, mask: 1 }),
    // big dark eyes with a catchlight
    ...[1, -1].flatMap((s) => [
      piece(ball(0.025, 8, 6), PAL.ink, { at: [s * 0.066, 1.178, 0.51], scale: [0.6, 1, 1.15], rot: [0, s * 0.5, 0], part: 1 }),
      piece(ball(0.0075, 4, 3), 0xffffff, { at: [s * 0.078, 1.188, 0.522], part: 1 }),
    ]),
    // large ears, cream inside with a dark rim at the tip
    ...[1, -1].map((s) => piece(L(zup([
      { p: [s * 0.05, 1.21, 0.46], r: [0.026, 0.013] }, { p: [s * 0.082, 1.25, 0.456], r: [0.05, 0.016] },
      { p: [s * 0.115, 1.29, 0.45], r: [0.054, 0.016] }, { p: [s * 0.142, 1.318, 0.445], r: [0.032, 0.011] }, { p: [s * 0.152, 1.328, 0.443], r: 0.006 },
    ]), (f) => (f.t > 0.88 ? D.dark : f.nz > 0.45 && f.t > 0.15 ? D.earIn : D.coat), { sides: 8, coat: (f) => (f.t > 0.88 || (f.nz > 0.45 && f.t > 0.15) ? 0 : 1) }), null, { part: s > 0 ? 2 : 3, mask: 1 })),
    // a little white tail (flags up when she bolts)
    piece(L([{ p: [0, 0.82, -0.44], r: 0.035 }, { p: [0, 0.8, -0.5], r: [0.04, 0.035] }, { p: [0, 0.76, -0.53], r: 0.02 }], (f) => (below(f, 0) ? D.white : D.coat), { sides: 8, coat: (f) => (below(f, 0) ? 0 : 1) }), null, { part: 4, mask: 1 }),
  ];
  for (let i = 0; i < 4; i++) {
    const hind = i >= 2;
    p.push(...quadLeg(i, d.legs[i], {
      top: hind ? [0.08, 0.13] : [0.06, 0.09], knee: hind ? 0.034 : 0.03, ankle: 0.022, hoof: D.hoof, hoofR: 0.024, mask: 1,
      paint: (f, lower) => (!lower && below(f, -0.2) && Math.cos(f.a) * (d.legs[i].hip[0] > 0 ? 1 : -1) < 0 ? D.cream : D.coat),
    }));
  }
  return { geo: assemble(p), spec: quadSpec('deer', d), dims: d };
}

// ---------------------------------------------------------------------------------------------
// Red fox

const FOX = { orange: 0xe2762e, white: 0xfaf3e8, dark: 0x2e2220, nose: 0x231a18, earIn: 0xe8b890 };

export const FOX_DIMS: QuadDims = {
  neck: [0, 0.4, 0.2],
  ears: [[0.045, 0.53, 0.29], [-0.045, 0.53, 0.29]],
  tail: [0, 0.37, -0.27],
  legs: [
    { hip: [0.05, 0.31, 0.15], knee: [0.05, 0.15, 0.165], foot: [0.05, 0, 0.17] },
    { hip: [-0.05, 0.31, 0.15], knee: [-0.05, 0.15, 0.165], foot: [-0.05, 0, 0.17] },
    { hip: [0.055, 0.33, -0.19], knee: [0.055, 0.15, -0.26], foot: [0.055, 0, -0.22] },
    { hip: [-0.055, 0.33, -0.19], knee: [-0.055, 0.15, -0.26], foot: [-0.055, 0, -0.22] },
  ],
  tailSway: 0.8,
};

export function fox(): QuadModel {
  const F = FOX, d = FOX_DIMS;
  const p: Piece[] = [
    piece(L([
      { p: [0, 0.35, -0.3], r: 0.05 }, { p: [0, 0.355, -0.24], r: [0.08, 0.08, 0.085] }, { p: [0, 0.34, -0.08], r: [0.085, 0.08, 0.09] },
      { p: [0, 0.35, 0.07], r: [0.088, 0.088, 0.1] }, { p: [0, 0.38, 0.18], r: [0.07, 0.078, 0.085] }, { p: [0, 0.42, 0.24], r: 0.048 },
    ], (f) => (f.t > 0.55 && below(f, -0.35) ? F.white : F.orange), { sides: 12 }), null),
    // head: wide cheeks narrowing to a fine muzzle, white chin and cheeks
    piece(L([
      { p: [0, 0.455, 0.215], r: 0.05 }, { p: [0, 0.47, 0.27], r: [0.088, 0.072, 0.07] }, { p: [0, 0.452, 0.33], r: [0.06, 0.048, 0.045] },
      { p: [0, 0.438, 0.39], r: [0.03, 0.026, 0.024] }, { p: [0, 0.434, 0.42], r: 0.014 },
    ], (f) => (f.t > 0.9 ? F.nose : below(f, -0.15) && f.t > 0.22 ? F.white : F.orange)), null, { part: 1 }),
    piece(L([{ p: [0, 0.42, 0.2], r: [0.06, 0.06] }, { p: [0, 0.445, 0.24], r: [0.065, 0.06] }, { p: [0, 0.46, 0.27], r: 0.04 }], F.orange, { sides: 10 }), null, { part: 1 }),
    piece(ball(0.013, 6, 4), F.nose, { at: [0, 0.438, 0.425], scale: [1.2, 0.9, 1], part: 1 }),
    // almond eyes
    ...[1, -1].flatMap((s) => [
      piece(ball(0.015, 7, 5), PAL.ink, { at: [s * 0.042, 0.488, 0.318], scale: [0.7, 0.85, 1.2], rot: [0, s * 0.45, s * -0.3], part: 1 }),
      piece(ball(0.005, 4, 3), 0xffffff, { at: [s * 0.049, 0.495, 0.327], part: 1 }),
    ]),
    // tall pointed ears, black backs
    ...[1, -1].map((s) => piece(L(zup([
      { p: [s * 0.045, 0.52, 0.29], r: [0.032, 0.013] }, { p: [s * 0.058, 0.57, 0.287], r: [0.027, 0.011] },
      { p: [s * 0.07, 0.62, 0.283], r: [0.016, 0.007] }, { p: [s * 0.074, 0.645, 0.28], r: [0.004, 0.003] },
    ]), (f) => (f.nz < -0.2 || f.t > 0.7 ? F.dark : f.nz > 0.4 ? F.earIn : F.orange), { sides: 8 }), null, { part: s > 0 ? 2 : 3 })),
    // the brush: thick, curving down, a white tip
    piece(L([
      { p: [0, 0.37, -0.27], r: 0.035 }, { p: [0, 0.345, -0.36], r: [0.06, 0.062] }, { p: [0, 0.29, -0.48], r: [0.075, 0.075] },
      { p: [0, 0.225, -0.58], r: [0.065, 0.062] }, { p: [0, 0.19, -0.65], r: 0.03 },
    ], (f) => (f.t > 0.8 ? F.white : F.orange), { sides: 10, bump: (a, t) => 1 + 0.07 * Math.cos(a * 5 + t * 11) }), null, { part: 4 }),
  ];
  for (let i = 0; i < 4; i++) {
    const hind = i >= 2;
    p.push(...quadLeg(i, d.legs[i], {
      top: hind ? [0.048, 0.07] : [0.036, 0.05], knee: 0.02, ankle: 0.016, hoof: F.dark, hoofR: 0.019,
      paint: (_f, lower) => (lower ? F.dark : F.orange),
    }));
  }
  return { geo: assemble(p), spec: quadSpec('fox', d), dims: d };
}

// ---------------------------------------------------------------------------------------------
// Grey heron. Channels: 0 neck lean (+ forward / down), 1 head pitch (+ bill down), 2 strike (bill thrusts forward),
//   3 head yaw, 4 wing flap (+ up), 5 flight (0 perched: folded wings; 1 flying: flight wings), 6 wing fold (upstroke),
//   7 / 8 legs L / R (+ swing back; 1.5 = trailing in flight), 9 / 10 knees L / R (+ heel back), 11 crest.

const HERON = { grey: 0x9ea7b3, pale: 0xeef0ef, dark: 0x2c3036, bill: 0xe6b84a, leg: 0xb59a5a, wingDark: 0x4c535c };

export const HERON_SPEC: RigSpec = {
  name: 'heron',
  parts: [
    { id: 1, pivot: [0, 0.74, 0.12], ops: [{ axis: X, ch: 0 }, { axis: Y, ch: 3 }] },
    { id: 2, pivot: [0, 0.98, 0.12], parent: 1, ops: [{ axis: X, ch: 1 }, { axis: Z, mode: 'move', ch: 2 }] },
    { id: 3, pivot: [0.09, 0.72, 0.05], ops: [{ axis: 'scale', ch: 5, gain: 1, bias: -1 }, { axis: Z, ch: 4 }] },
    { id: 4, pivot: [-0.09, 0.72, 0.05], ops: [{ axis: 'scale', ch: 5, gain: 1, bias: -1 }, { axis: Z, ch: 4, gain: -1 }] },
    { id: 5, pivot: [0.5, 0.72, 0.05], parent: 3, ops: [{ axis: Z, ch: 6, gain: -1 }, { axis: Y, ch: 6, gain: 0.6 }] },
    { id: 6, pivot: [-0.5, 0.72, 0.05], parent: 4, ops: [{ axis: Z, ch: 6 }, { axis: Y, ch: 6, gain: -0.6 }] },
    { id: 7, pivot: [0, 0.68, 0], ops: [{ axis: 'scale', ch: 5, gain: -1 }] },
    { id: 8, pivot: [0.05, 0.6, -0.02], ops: [{ axis: X, ch: 7 }] },
    { id: 9, pivot: [-0.05, 0.6, -0.02], ops: [{ axis: X, ch: 8 }] },
    { id: 10, pivot: [0.05, 0.3, -0.06], parent: 8, ops: [{ axis: X, ch: 9, gain: -1 }] },
    { id: 11, pivot: [-0.05, 0.3, -0.06], parent: 9, ops: [{ axis: X, ch: 10, gain: -1 }] },
    { id: 12, pivot: [0, 1.06, 0.15], parent: 2, ops: [{ axis: X, ch: 11, gain: -1 }] },
  ],
};

/** a broad wing along +x (s = side): loft rings across the span, chord along z, a rounded leading edge */
function wing(s: number, x0: number, x1: number, y: number, z: number, chord0: number, chord1: number, paint: LoftOpts['paint'], th = 0.016): THREE.BufferGeometry {
  const rings: Ring[] = [];
  for (let k = 0; k <= 3; k++) {
    const t = k / 3, c = chord0 + (chord1 - chord0) * t;
    rings.push({ p: [s * (x0 + (x1 - x0) * t), y, z - c * 0.15], r: [c / 2, th * (1 - t * 0.4)], e: 2.2 });
  }
  return L(rings, paint, { sides: 8, caps: ['flat', 'pole'], round: 0.25 });
}

export function heron(): Model {
  const H = HERON;
  const p: Piece[] = [
    // body: a long tapering hull, leaning up at the front
    piece(L([
      { p: [0, 0.6, -0.33], r: 0.025 }, { p: [0, 0.62, -0.25], r: [0.07, 0.06] }, { p: [0, 0.65, -0.1], r: [0.105, 0.095, 0.1] },
      { p: [0, 0.69, 0.03], r: [0.1, 0.1, 0.105] }, { p: [0, 0.74, 0.12], r: [0.065, 0.065] }, { p: [0, 0.76, 0.14], r: 0.04 },
    ], (f) => (below(f, -0.35) ? H.pale : H.grey)), null),
    // folded wings: long grey leaves with dark primaries along the back
    ...[1, -1].map((s) => piece(L([
      { p: [s * 0.085, 0.71, 0.1], r: [0.014, 0.05] }, { p: [s * 0.1, 0.69, -0.02], r: [0.022, 0.07] },
      { p: [s * 0.095, 0.66, -0.18], r: [0.018, 0.055] }, { p: [s * 0.07, 0.62, -0.34], r: [0.008, 0.02] },
    ], (f) => (f.t > 0.55 ? H.wingDark : H.grey)), null, { part: 7 })),
    // lower neck: rising, then kinking back (the heron's S)
    piece(L(zup([
      { p: [0, 0.72, 0.12], r: 0.05 }, { p: [0, 0.8, 0.17], r: 0.04 }, { p: [0, 0.88, 0.15], r: 0.034 }, { p: [0, 0.96, 0.12], r: 0.032 }, { p: [0, 1.0, 0.12], r: 0.03 },
    ]), (f) => (Math.sin(f.a) < -0.55 ? (Math.floor(f.t * 9) % 2 ? H.dark : H.pale) : H.pale), { sides: 10 }), null, { part: 1 }),
    // upper neck + head (strikes)
    piece(L(zup([
      { p: [0, 0.97, 0.12], r: 0.031 }, { p: [0, 1.02, 0.13], r: 0.033 }, { p: [0, 1.06, 0.15], r: [0.04, 0.038] },
    ]), H.pale, { sides: 10 }), null, { part: 2 }),
    piece(L([
      { p: [0, 1.065, 0.11], r: 0.03 }, { p: [0, 1.07, 0.15], r: [0.04, 0.038, 0.035] }, { p: [0, 1.065, 0.2], r: [0.03, 0.028, 0.026] }, { p: [0, 1.06, 0.225], r: 0.016 },
    ], (f) => (Math.abs(Math.cos(f.a)) > 0.75 && f.t > 0.2 && f.t < 0.75 && Math.sin(f.a) > -0.1 ? H.dark : H.pale), { sides: 10 }), null, { part: 2 }),
    // the dagger bill
    piece(L([{ p: [0, 1.06, 0.215], r: [0.016, 0.014] }, { p: [0, 1.055, 0.28], r: [0.01, 0.009] }, { p: [0, 1.048, 0.36], r: 0.002 }], H.bill, { sides: 6 }), null, { part: 2 }),
    ...[1, -1].flatMap((s) => [
      piece(ball(0.011, 6, 4), 0xf2d84a, { at: [s * 0.03, 1.078, 0.185], part: 2 }),
      piece(ball(0.0065, 5, 4), PAL.ink, { at: [s * 0.037, 1.079, 0.19], part: 2 }),
    ]),
    // crest plume
    piece(L([{ p: [0, 1.085, 0.14], r: 0.01 }, { p: [0, 1.08, 0.08], r: [0.008, 0.005] }, { p: [0, 1.07, 0.02], r: 0.002 }], H.dark, { sides: 5 }), null, { part: 12 }),
    // flight wings (hidden while perched): broad, slate primaries
    piece(wing(1, 0.08, 0.5, 0.72, 0.05, 0.3, 0.26, (f) => (f.x > 0 && f.z < -0.08 ? 0x7d8691 : H.grey)), null, { part: 3 }),
    piece(wing(-1, 0.08, 0.5, 0.72, 0.05, 0.3, 0.26, (f) => (f.z < -0.08 ? 0x7d8691 : H.grey)), null, { part: 4 }),
    piece(wing(1, 0.49, 0.92, 0.72, 0.05, 0.26, 0.12, (f) => (f.x > 0.62 ? H.wingDark : 0x7d8691)), null, { part: 5 }),
    piece(wing(-1, 0.49, 0.92, 0.72, 0.05, 0.26, 0.12, (f) => (f.x < -0.62 ? H.wingDark : 0x7d8691)), null, { part: 6 }),
  ];
  // stilt legs: thigh (feathered) to the heel, shank to the toes
  for (const s of [1, -1]) {
    const pt = s > 0 ? 8 : 9, kn = s > 0 ? 10 : 11, x = s * 0.05;
    p.push(piece(L(zup([{ p: [x, 0.62, -0.02], r: 0.026 }, { p: [x, 0.46, -0.04], r: 0.014 }, { p: [x, 0.3, -0.06], r: 0.011 }]), (f) => (f.t < 0.3 ? H.grey : H.leg), { sides: 6 }), null, { part: pt }));
    p.push(piece(L(zup([{ p: [x, 0.3, -0.06], r: 0.011 }, { p: [x, 0.15, -0.03], r: 0.01 }, { p: [x, 0.01, 0], r: 0.01 }]), H.leg, { sides: 6 }), null, { part: kn }));
    for (const a of [-0.5, 0, 0.5, Math.PI]) {
      const l = a === Math.PI ? 0.05 : 0.085;
      p.push(piece(L([{ p: [x, 0.008, 0], r: 0.007 }, { p: [x + Math.sin(a) * l, 0.006, Math.cos(a) * l], r: 0.003 }], H.leg, { sides: 4 }), null, { part: kn }));
    }
  }
  return { geo: assemble(p), spec: HERON_SPEC };
}

// ---------------------------------------------------------------------------------------------
// Tawny owl. Channels: 0 head yaw (owls turn a long way round), 1 head tilt, 2 lids (−1 open … 0 shut), 3 wing flap,
//   4 flight (0 perched … 1 flying), 5 wing fold, 6 feet tuck (+ back), 7 tail, 8 body fluff (scale), 9 ear tufts.

const OWL = { back: 0x8a5a36, front: 0xd6ad78, streak: 0xa87a4c, disc: 0xe9cfa2, rim: 0x5a3a24, beak: 0xd8c8a0, feet: 0xb8a070, dark: 0x6e4528 };

export const OWL_SPEC: RigSpec = {
  name: 'owl',
  parts: [
    { id: 1, pivot: [0, 0.29, 0], ops: [{ axis: Z, ch: 1 }, { axis: Y, ch: 0 }] },
    { id: 2, pivot: [0.046, 0.385, 0.098], parent: 1, ops: [{ axis: 'scale', ch: 2, gain: 1, bias: 0 }] },
    { id: 3, pivot: [-0.046, 0.385, 0.098], parent: 1, ops: [{ axis: 'scale', ch: 2, gain: 1, bias: 0 }] },
    { id: 4, pivot: [0.1, 0.25, -0.01], ops: [{ axis: 'scale', ch: 4, gain: 1, bias: -1 }, { axis: Z, ch: 3 }] },
    { id: 5, pivot: [-0.1, 0.25, -0.01], ops: [{ axis: 'scale', ch: 4, gain: 1, bias: -1 }, { axis: Z, ch: 3, gain: -1 }] },
    { id: 6, pivot: [0.38, 0.25, -0.01], parent: 4, ops: [{ axis: Z, ch: 5, gain: -1 }, { axis: Y, ch: 5, gain: 0.5 }] },
    { id: 7, pivot: [-0.38, 0.25, -0.01], parent: 5, ops: [{ axis: Z, ch: 5 }, { axis: Y, ch: 5, gain: -0.5 }] },
    { id: 8, pivot: [0, 0.18, 0], ops: [{ axis: 'scale', ch: 4, gain: -1 }] },
    { id: 9, pivot: [0, 0.04, 0.02], ops: [{ axis: X, ch: 6 }] },
    { id: 10, pivot: [0, 0.1, -0.09], ops: [{ axis: X, ch: 7, gain: -1 }] },
    { id: 11, pivot: [0.06, 0.46, 0.04], parent: 1, ops: [{ axis: Z, ch: 9, gain: -1 }] },
    { id: 12, pivot: [-0.06, 0.46, 0.04], parent: 1, ops: [{ axis: Z, ch: 9 }] },
  ],
};

export function owl(): Model {
  const O = OWL;
  // little dashes, not a chequerboard: every other ring, one face in four around
  const streaks = (f: Face) => Math.floor(f.t * 12) % 2 === 0 && Math.floor((f.a + 7) * 2.3) % 2 === 0;
  const p: Piece[] = [
    // a plump upright egg: barred buff front, mottled brown back (the spine runs up, so "up" faces backwards)
    piece(L([
      { p: [0, 0.03, -0.01], r: 0.05 }, { p: [0, 0.08, 0], r: [0.12, 0.115, 0.115] }, { p: [0, 0.17, 0], r: [0.135, 0.125, 0.125] },
      { p: [0, 0.26, -0.005], r: [0.12, 0.11, 0.105] }, { p: [0, 0.31, -0.01], r: 0.07 },
    ], (f) => {
      const front = Math.sin(f.a) < -0.25;
      return front ? (streaks(f) ? O.streak : O.front) : (streaks(f) ? O.dark : O.back);
    }, { sides: 14 }), null),
    // folded wings hugging the flanks
    ...[1, -1].map((s) => piece(L(zup([
      { p: [s * 0.105, 0.28, 0.01], r: [0.03, 0.012] }, { p: [s * 0.125, 0.2, -0.01], r: [0.065, 0.02] },
      { p: [s * 0.11, 0.1, -0.04], r: [0.055, 0.016] }, { p: [s * 0.08, 0.04, -0.08], r: [0.02, 0.008] },
    ]), (f) => (Math.floor(f.t * 7) % 2 ? O.dark : O.back), { sides: 8 }), null, { part: 8 })),
    // big round head
    piece(L([
      { p: [0, 0.38, -0.12], r: 0.05 }, { p: [0, 0.385, -0.08], r: [0.115, 0.1, 0.1] }, { p: [0, 0.385, 0], r: [0.13, 0.115, 0.11] },
      { p: [0, 0.38, 0.06], r: [0.115, 0.1, 0.1] }, { p: [0, 0.375, 0.09], r: 0.07 },
    ], (f) => (streaks(f) && Math.sin(f.a) > 0 ? O.dark : O.back), { sides: 14 }), null, { part: 1 }),
    // the facial disc: a pale dish with a dark rim, two lobes
    ...[1, -1].map((s) => piece(L([
      { p: [s * 0.045, 0.375, 0.07], r: 0.055 }, { p: [s * 0.046, 0.378, 0.088], r: [0.058, 0.064] }, { p: [s * 0.047, 0.38, 0.1], r: 0.05 },
    ], (f) => (f.t < 0.35 ? O.rim : O.disc), { sides: 12, caps: ['pole', 'flat'] }), null, { part: 1 })),
    // eyes: big and dark, a bright catchlight; the brows meet in a pale V over the beak
    ...[1, -1].flatMap((s) => [
      piece(ball(0.033, 9, 7), PAL.ink, { at: [s * 0.046, 0.385, 0.098], scale: [1, 1, 0.55], part: 1 }),
      piece(ball(0.009, 4, 3), 0xffffff, { at: [s * 0.054, 0.396, 0.115], part: 1 }),
      piece(L([{ p: [0, 0.405, 0.108], r: 0.008 }, { p: [s * 0.05, 0.43, 0.1], r: [0.014, 0.008] }, { p: [s * 0.09, 0.42, 0.085], r: 0.004 }], O.disc, { sides: 5 }), null, { part: 1 }),
      // eyelids: feathered domes that cover the eye (scaled from nothing)
      piece(ball(0.036, 9, 7), O.front, { at: [s * 0.046, 0.385, 0.1], scale: [1, 1, 0.6], part: s > 0 ? 2 : 3 }),
    ]),
    piece(cone(0.014, 0.04, 5), O.beak, { at: [0, 0.36, 0.11], rot: [Math.PI * 0.9, 0, 0], part: 1 }),
    // little ear tufts
    ...[1, -1].map((s) => piece(L(zup([{ p: [s * 0.06, 0.46, 0.04], r: [0.022, 0.012] }, { p: [s * 0.08, 0.5, 0.035], r: [0.014, 0.008] }, { p: [s * 0.09, 0.52, 0.03], r: 0.003 }]), O.back, { sides: 6 }), null, { part: s > 0 ? 11 : 12 })),
    // tail
    piece(L([{ p: [0, 0.1, -0.09], r: [0.05, 0.015] }, { p: [0, 0.05, -0.13], r: [0.055, 0.012] }, { p: [0, 0.02, -0.15], r: [0.03, 0.006] }], O.back, { sides: 6 }), null, { part: 10 }),
    // feathered feet gripping the perch
    ...[1, -1].flatMap((s) => [
      piece(ball(0.03, 6, 4), O.front, { at: [s * 0.045, 0.03, 0.04], scale: [1, 0.8, 1.2], part: 9 }),
      ...[-0.35, 0, 0.35].map((a) => piece(L([{ p: [s * 0.045, 0.015, 0.06], r: 0.008 }, { p: [s * 0.045 + Math.sin(a) * 0.035, 0.005, 0.06 + Math.cos(a) * 0.035], r: 0.004 }], O.feet, { sides: 4 }), null, { part: 9 })),
    ]),
    // flight wings (hidden while perched): broad and round-tipped, barred
    piece(wing(1, 0.09, 0.38, 0.25, -0.01, 0.2, 0.18, (f) => (Math.floor(f.x * 22) % 2 ? O.back : O.front)), null, { part: 4 }),
    piece(wing(-1, 0.09, 0.38, 0.25, -0.01, 0.2, 0.18, (f) => (Math.floor(-f.x * 22) % 2 ? O.back : O.front)), null, { part: 5 }),
    piece(wing(1, 0.37, 0.62, 0.25, -0.01, 0.18, 0.11, (f) => (Math.floor(f.x * 20) % 2 ? O.dark : O.back)), null, { part: 6 }),
    piece(wing(-1, 0.37, 0.62, 0.25, -0.01, 0.18, 0.11, (f) => (Math.floor(-f.x * 20) % 2 ? O.dark : O.back)), null, { part: 7 }),
  ];
  return { geo: assemble(p), spec: OWL_SPEC };
}

// ---------------------------------------------------------------------------------------------
// Hedgehog. Channels: 0 head pitch (+ nose down; curled ≈ 1.6), 1 head yaw, 2 nose twitch (scale), 3 legs hide (−1),
//   4..7 legs LF RF LH RH (+ swing back), 8 spines bristle (scale).

const HOG = { spine: 0x6a4a32, tip: 0xa88a64, face: 0xd9b88e, dark: 0x2a1e18, skin: 0xb8906a };

export const HOG_SPEC: RigSpec = {
  name: 'hedgehog',
  parts: [
    { id: 1, pivot: [0, 0.07, 0.07], ops: [{ axis: X, ch: 0 }, { axis: Y, ch: 1 }] },
    { id: 2, pivot: [0, 0.058, 0.17], parent: 1, ops: [{ axis: 'scale', ch: 2 }] },
    { id: 3, pivot: [0.05, 0.04, 0.06], ops: [{ axis: 'scale', ch: 3 }, { axis: X, ch: 4 }] },
    { id: 4, pivot: [-0.05, 0.04, 0.06], ops: [{ axis: 'scale', ch: 3 }, { axis: X, ch: 5 }] },
    { id: 5, pivot: [0.055, 0.04, -0.06], ops: [{ axis: 'scale', ch: 3 }, { axis: X, ch: 6 }] },
    { id: 6, pivot: [-0.055, 0.04, -0.06], ops: [{ axis: 'scale', ch: 3 }, { axis: X, ch: 7 }] },
    { id: 7, pivot: [0, 0.06, 0], ops: [{ axis: 'scale', ch: 8 }] },
  ],
};

export function hedgehog(): Model {
  const H = HOG;
  const p: Piece[] = [
    // the spiny mantle: a dome with spiky ridges, light tips
    piece(L([
      { p: [0, 0.06, -0.14], r: 0.03 }, { p: [0, 0.075, -0.11], r: [0.09, 0.08, 0.04] }, { p: [0, 0.085, -0.02], r: [0.115, 0.11, 0.05] },
      { p: [0, 0.085, 0.05], r: [0.105, 0.1, 0.05] }, { p: [0, 0.075, 0.1], r: [0.075, 0.07, 0.04] }, { p: [0, 0.07, 0.12], r: 0.035 },
    ], (f) => (below(f, -0.25) ? H.skin : (Math.floor((f.a + 7) * 3.2) + Math.floor(f.t * 6)) % 3 === 0 ? H.tip : H.spine),
    { sides: 22, sub: 3, bump: (a, t) => (Math.sin(a) > -0.25 ? 1 + 0.22 * Math.pow(Math.max(0, Math.sin(a * 11 + t * 3) * Math.sin(t * 30)), 0.7) : 1) }), null, { part: 7 }),
    // a soft belly under it
    piece(L([{ p: [0, 0.045, -0.1], r: 0.03 }, { p: [0, 0.045, -0.03], r: [0.075, 0.035] }, { p: [0, 0.048, 0.06], r: [0.065, 0.035] }, { p: [0, 0.055, 0.1], r: 0.03 }], H.skin, { sides: 10 }), null),
    // pointy face
    piece(L([
      { p: [0, 0.075, 0.07], r: 0.045 }, { p: [0, 0.07, 0.11], r: [0.048, 0.042, 0.035] }, { p: [0, 0.062, 0.15], r: [0.026, 0.024, 0.02] }, { p: [0, 0.058, 0.172], r: 0.01 },
    ], H.face, { sides: 10 }), null, { part: 1 }),
    piece(ball(0.011, 6, 4), H.dark, { at: [0, 0.059, 0.176], part: 2 }),
    ...[1, -1].flatMap((s) => [
      piece(ball(0.0105, 6, 5), PAL.ink, { at: [s * 0.03, 0.084, 0.123], part: 1 }),
      piece(ball(0.0035, 3, 2), 0xffffff, { at: [s * 0.033, 0.088, 0.13], part: 1 }),
      piece(ball(0.012, 5, 4), H.skin, { at: [s * 0.04, 0.1, 0.095], scale: [1, 1, 0.5], part: 1 }),
    ]),
  ];
  const legs: [number, number, number][] = [[0.05, 0.06, 3], [-0.05, 0.06, 4], [0.055, -0.06, 5], [-0.055, -0.06, 6]];
  for (const [x, z, part] of legs) p.push(piece(L(zup([{ p: [x, 0.045, z], r: 0.014 }, { p: [x, 0.02, z + 0.004], r: 0.012 }, { p: [x, 0.006, z + 0.012], r: [0.012, 0.015] }]), H.dark, { sides: 6 }), null, { part }));
  return { geo: assemble(p), spec: HOG_SPEC };
}

// ---------------------------------------------------------------------------------------------
// Greylag goose (only ever flying over). Channels: 0 flap (+ up), 1 fold (upstroke), 2 neck bob, 3 feet tuck.

const GOOSE = { body: 0x9a9184, under: 0xe8e2d8, dark: 0x5e574e, bill: 0xf09048, feet: 0xf0a080 };

export const GOOSE_SPEC: RigSpec = {
  name: 'goose',
  parts: [
    { id: 1, pivot: [0.09, 0.02, 0.02], ops: [{ axis: Z, ch: 0 }] },
    { id: 2, pivot: [-0.09, 0.02, 0.02], ops: [{ axis: Z, ch: 0, gain: -1 }] },
    { id: 3, pivot: [0.42, 0.02, 0.02], parent: 1, ops: [{ axis: Z, ch: 1, gain: -1 }, { axis: Y, ch: 1, gain: 0.5 }] },
    { id: 4, pivot: [-0.42, 0.02, 0.02], parent: 2, ops: [{ axis: Z, ch: 1 }, { axis: Y, ch: 1, gain: -0.5 }] },
    { id: 5, pivot: [0, 0.03, 0.2], ops: [{ axis: X, ch: 2 }] },
  ],
};

export function goose(): Model {
  const G = GOOSE;
  const p: Piece[] = [
    piece(L([
      { p: [0, 0.01, -0.36], r: 0.025 }, { p: [0, 0.01, -0.29], r: [0.08, 0.06] }, { p: [0, 0, -0.12], r: [0.13, 0.1, 0.11] },
      { p: [0, 0.01, 0.06], r: [0.12, 0.1, 0.1] }, { p: [0, 0.03, 0.18], r: [0.07, 0.065] }, { p: [0, 0.035, 0.22], r: 0.045 },
    ], (f) => (f.t < 0.15 ? G.under : below(f, -0.45) ? G.under : G.body)), null),
    // the long neck stretched out, the head and the orange bill
    piece(L([
      { p: [0, 0.03, 0.18], r: 0.045 }, { p: [0, 0.04, 0.3], r: 0.035 }, { p: [0, 0.05, 0.42], r: 0.032 },
      { p: [0, 0.058, 0.48], r: [0.04, 0.042, 0.036] }, { p: [0, 0.055, 0.53], r: [0.032, 0.03] }, { p: [0, 0.05, 0.55], r: 0.018 },
    ], (f) => (f.t > 0.55 ? G.dark : 0x7e766a)), null, { part: 5 }),
    piece(L([{ p: [0, 0.05, 0.54], r: [0.02, 0.016] }, { p: [0, 0.045, 0.6], r: [0.014, 0.01] }, { p: [0, 0.042, 0.63], r: 0.004 }], G.bill, { sides: 6 }), null, { part: 5 }),
    ...[1, -1].map((s) => piece(ball(0.007, 4, 3), PAL.ink, { at: [s * 0.03, 0.065, 0.5], part: 5 })),
    // tucked feet
    ...[1, -1].map((s) => piece(L([{ p: [s * 0.04, -0.06, -0.2], r: 0.012 }, { p: [s * 0.04, -0.055, -0.3], r: [0.02, 0.006] }], G.feet, { sides: 4 }), null)),
    piece(wing(1, 0.08, 0.43, 0.02, 0.02, 0.28, 0.24, (f) => (f.z < -0.06 ? G.dark : G.body)), null, { part: 1 }),
    piece(wing(-1, 0.08, 0.43, 0.02, 0.02, 0.28, 0.24, (f) => (f.z < -0.06 ? G.dark : G.body)), null, { part: 2 }),
    piece(wing(1, 0.42, 0.8, 0.02, 0.02, 0.24, 0.1, (f) => (f.x > 0.6 ? 0x3e3a34 : G.dark)), null, { part: 3 }),
    piece(wing(-1, 0.42, 0.8, 0.02, 0.02, 0.24, 0.1, (f) => (f.x < -0.6 ? 0x3e3a34 : G.dark)), null, { part: 4 }),
  ];
  return { geo: assemble(p), spec: GOOSE_SPEC };
}

// ---------------------------------------------------------------------------------------------

type C3 = readonly [number, number, number];
const lin = (hex: number) => new THREE.Color(hex);
/** instance tints for the doe and the fawn: [tint, tint2]. The doe's tint2 turns the dapples back into coat. */
export const DEER_LOOK: readonly [C3, C3] = (() => { const a = lin(DEER.coat), b = lin(DEER.spot); return [[1, 1, 1], [a.r / b.r, a.g / b.g, a.b / b.b]] as const; })();
export const FAWN_LOOK: readonly [C3, C3] = [[1.06, 1.02, 0.97], [1, 1, 1]];
/** winter coat: greyer and darker (multiplies the doe's tint) */
export const DEER_WINTER: C3 = [0.74, 0.76, 0.84];
