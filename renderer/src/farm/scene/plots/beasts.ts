/**
 * Pen animal models: cows, sheep, pigs, chickens (+ chicks and eggs). Each species is four rigged parts built facing
 * +z with the ground at y = 0 — body (tail / wings bend in the shader), head (eyes blink, jaw opens, ears flick, the
 * head nods on its neck), upper leg and lower leg (posed by the two-bone solve in gait.ts) — plus the numbers the Herd
 * needs to animate them: hip sockets, bone lengths, gait, neck pivot, lying heights, coats.
 *
 * Left is +x (an animal facing +z has its left side toward +x). Legs are listed LF, RF, LH, RH (bipeds: L, R).
 */
import * as THREE from 'three';
import type { Season } from '../../model/types.ts';
import { PAL } from '../toon.ts';
import type { SfxName } from '../context.ts';
import type { BeastKey } from './behavior.ts';
import type { GaitDef, LieStyle } from './gait.ts';
import { ball, box, cached, cone, cyl, dodec, jitter, rng, sphere, torus } from './geo.ts';
import type { V3 } from './geo.ts';
import { P, gradient, rbox, rigMerge, roundify, tag } from './rig.ts';
import { blob, loft, mixHex } from '../sculpt.ts';
import type { Face, Ring } from '../sculpt.ts';

export interface Coat {
  /** instance tint on coat vertices */
  tint: number;
  /** pattern kind (rig.ts) */
  pattern: number;
  weight: number;
  name: string;
}

export interface BeastDef {
  key: BeastKey;
  body(season: Season): THREE.BufferGeometry;
  head(): THREE.BufferGeometry;
  upper(): THREE.BufferGeometry;
  lower(): THREE.BufferGeometry;
  /** hip sockets in body rest space (LF, RF, LH, RH | L, R) */
  hips: V3[];
  /** upper / lower bone lengths per leg (the geometry is modelled at `boneGeo` and stretched) */
  bones: [number, number][];
  boneGeo: [number, number];
  /** knee points forward (cow front knee) or back (hocks, bird ankles) per leg */
  kneeFwd: boolean[];
  /** body pivot (centre of mass) in rest space */
  cog: V3;
  /** head pivot (base of the neck) in body rest space */
  neck: V3;
  /** point on the head (head space, before nod) where hearts / Zzz / notes appear */
  mouth: V3;
  /** neck pitch that brings the mouth to the grass, and the extra head nod used while grazing */
  graze: number; grazeNod: number;
  gait: GaitDef;
  /** rest m/s */
  walk: number; trot: number; flee: number;
  /** turn rate (rad/s) at a walk */
  turn: number;
  /** body half-width and half-length (fence clearance, avoidance) */
  r: number; len: number;
  lie: LieStyle;
  /** how far the body drops (rest metres) at the front / hind end when lying */
  lieDrop: [number, number];
  sound: SfxName;
  names: string[];
  coats: Coat[];
  /** how many live in a full pen */
  max: number;
  /** world scale of the whole animal */
  size: number;
}

const INK = 0x1c1818;
const GLINT = 0xffffff;

/** a big glossy toon eye (black oval + two highlights) facing +z at p; its blink pivot sits a bit below centre */
function eye(p: V3, r: number, joint: V3, o: { sclera?: number; side?: number; look?: number } = {}): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const pivot: V3 = [p[0], p[1] - r * 0.55, p[2]];
  const t = { part: P.EYE, pivot, joint };
  const side = o.side ?? 0;
  if (o.sclera !== undefined) out.push(tag(ball(r * 1.3, o.sclera, { p: [p[0], p[1], p[2] - r * 0.25], s: [0.95, 1.15, 0.7], r: [0, side, 0] }, 1), t));
  out.push(tag(ball(r, INK, { p: [p[0] + Math.sin(side) * r * 0.25, p[1], p[2] + r * 0.1], s: [0.85, 1.15, 0.75], r: [0, side, 0] }, 1), t));
  out.push(tag(ball(r * 0.34, GLINT, { p: [p[0] + r * 0.3 * Math.cos(side) + Math.sin(side) * r * 0.55, p[1] + r * 0.38, p[2] + r * 0.55] }), t));
  out.push(tag(ball(r * 0.15, GLINT, { p: [p[0] - r * 0.28 * Math.cos(side) + Math.sin(side) * r * 0.55, p[1] - r * 0.35, p[2] + r * 0.58] }), t));
  return out;
}


// ---------------------------------------------------------------------------------------------------------------
// Cow

const COW_J: V3 = [0, 0.14, 0.4];

function cowBody(): THREE.BufferGeometry {
  return cached('beast:cow:body', () => {
    const W = 0xfbf8f0;
    const p: THREE.BufferGeometry[] = [];
    // one barrel from rump to brisket: square hips, a dipped back, a round belly and a deep chest
    p.push(tag(loft([
      { p: [0, 1.1, -0.86], r: [0.16, 0.12, 0.16], e: 2.4 },
      { p: [0, 1.07, -0.78], r: [0.36, 0.25, 0.32], e: 2.8 },
      { p: [0, 1.04, -0.6], r: [0.44, 0.3, 0.38], e: 3 },
      { p: [0, 1.0, -0.3], r: [0.45, 0.3, 0.42], e: 2.7 },
      { p: [0, 0.98, 0.02], r: [0.47, 0.32, 0.44], e: 2.5 },
      { p: [0, 1.0, 0.34], r: [0.45, 0.34, 0.42], e: 2.6 },
      { p: [0, 1.04, 0.6], r: [0.41, 0.34, 0.4], e: 2.6 },
      { p: [0, 1.06, 0.78], r: [0.28, 0.28, 0.3], e: 2.3 },
      { p: [0, 1.08, 0.86], r: [0.12, 0.12, 0.14] },
    ], { sides: 14, paint: W, coat: () => 1 }), { coat: 1 }));
    // udder: one soft bag with four teats
    p.push(blob([0, 0.62, -0.38], [0.15, 0.1, 0.17], { paint: 0xf6b4b4, sides: 10 }));
    for (const [x, z] of [[0.065, -0.3], [-0.065, -0.3], [0.065, -0.46], [-0.065, -0.46]]) p.push(loft([
      { p: [x, 0.57, z], r: 0.028 }, { p: [x, 0.51, z], r: 0.022 },
    ], { sides: 6, sub: 1, paint: 0xe89a9e, caps: ['open', 'pole'] }));
    // tail: a tapering rope that swings about the rump, the tuft lags behind
    const root: V3 = [0, 1.3, -0.8];
    p.push(tag(loft([
      { p: [0, 1.2, -0.84], r: 0.05 }, { p: [0, 1.06, -0.87], r: 0.035 }, { p: [0, 0.97, -0.87], r: 0.03 },
    ], { sides: 6, sub: 2, paint: W, caps: ['pole', 'open'] }), { part: P.TAIL, joint: root, coat: 1 }));
    const tipPivot: V3 = [0, 0.98, -0.85];
    const tip = { part: P.TAIL_TIP, pivot: tipPivot, joint: root, axis: [0, 0, 1] as V3 };
    p.push(tag(loft([
      { p: [0, 0.99, -0.87], r: 0.028 }, { p: [0, 0.8, -0.865], r: 0.024 },
    ], { sides: 6, sub: 1, paint: W, caps: ['open', 'open'] }), { ...tip, coat: 1 }));
    p.push(tag(loft([
      { p: [0, 0.82, -0.865], r: 0.03 }, { p: [0, 0.74, -0.865], r: 0.065 }, { p: [0, 0.64, -0.865], r: 0.05 }, { p: [0, 0.58, -0.865], r: 0.02 },
    ], { sides: 7, sub: 2, paint: 0x3a302c }), tip));
    return rigMerge(p);
  });
}

function cowHead(): THREE.BufferGeometry {
  return cached('beast:cow:head', () => {
    const W = 0xfbf8f0, J = COW_J, MUZZLE = 0xf6b6ae;
    const p: THREE.BufferGeometry[] = [];
    const head = { part: P.HEAD, joint: J };
    // neck (does not nod): a thick tapering trunk from the shoulders up into the skull, with a dewlap underneath
    p.push(tag(loft([
      { p: [0, -0.16, -0.14], r: [0.3, 0.3, 0.34] },
      { p: [0, -0.04, 0.12], r: [0.26, 0.27, 0.32] },
      { p: [0, 0.1, 0.38], r: [0.21, 0.23, 0.25] },
      { p: [0, 0.16, 0.48], r: [0.18, 0.2, 0.2] },
    ], { sides: 12, paint: W, caps: ['open', 'pole'] }), { coat: 1 }));
    // collar and bell
    p.push(loft([
      { p: [0, -0.065, 0.07], r: [0.29, 0.3, 0.355] }, { p: [0, -0.035, 0.12], r: [0.292, 0.302, 0.357] }, { p: [0, -0.005, 0.17], r: [0.288, 0.298, 0.35] },
    ], { sides: 14, sub: 1, paint: 0xc2533e, caps: ['open', 'open'] }));
    p.push(loft([
      { p: [0, -0.34, 0.3], r: 0.025 }, { p: [0, -0.39, 0.31], r: 0.06 }, { p: [0, -0.47, 0.32], r: 0.08 },
    ], { sides: 8, sub: 2, paint: PAL.yellow, caps: ['pole', 'flat'] }));
    p.push(ball(0.026, 0x8a6a20, { p: [0, -0.48, 0.32] }));
    // skull → muzzle in one piece: broad brow, long face, a wide soft nose (painted pink, no coat)
    p.push(tag(loft([
      { p: [0, 0.24, 0.36], r: [0.2, 0.18, 0.18] },
      { p: [0, 0.25, 0.5], r: [0.27, 0.24, 0.24], e: 2.4 },
      { p: [0, 0.21, 0.66], r: [0.25, 0.22, 0.24], e: 2.3 },
      { p: [0, 0.11, 0.8], r: [0.21, 0.15, 0.19], e: 2.2 },
      { p: [0, 0.04, 0.9], r: [0.25, 0.15, 0.14], e: 2.6 },
      { p: [0, 0.03, 0.97], r: [0.21, 0.11, 0.1], e: 2.6 },
      { p: [0, 0.03, 0.99], r: [0.12, 0.06, 0.05] },
    ], {
      sides: 14, round: 0.3,
      paint: (f) => f.t > 0.53 ? MUZZLE : W,
      coat: (f) => f.t > 0.53 ? 0 : 1,
    }), head));
    // nostrils and a little smile
    for (const s of [-1, 1]) p.push(tag(blob([s * 0.09, 0.05, 0.985], [0.032, 0.042, 0.014], { paint: 0x7a3a3a, sides: 8, rings: 3 }), head));
    for (const s of [-1, 1]) p.push(tag(blob([s * 0.19, 0.12, 0.83], [0.05, 0.03, 0.02], { paint: 0xf49a9a, sides: 8, rings: 3, tilt: 0, e: 2 }), head));
    // horns: two short curved points
    for (const s of [-1, 1]) p.push(tag(loft([
      { p: [s * 0.16, 0.38, 0.52], r: 0.055 }, { p: [s * 0.25, 0.44, 0.53], r: 0.045 }, { p: [s * 0.31, 0.53, 0.55], r: 0.03 }, { p: [s * 0.32, 0.6, 0.56], r: 0.012 },
    ], { sides: 7, sub: 2, paint: (f) => f.y > 0.52 ? 0xe8d4a8 : 0xf4e6c4, caps: ['open', 'pole'] }), head));
    // forelock tuft
    p.push(tag(loft([
      { p: [0, 0.4, 0.5], r: [0.09, 0.04] }, { p: [0.01, 0.44, 0.58], r: [0.08, 0.035] }, { p: [0.03, 0.42, 0.66], r: [0.04, 0.02] },
    ], { sides: 8, sub: 2, paint: W }), { ...head, coat: 1 }));
    // jaw (chews and moos) and the mouth behind it
    const jaw = { part: P.JAW, pivot: [0, -0.08, 0.72] as V3, joint: J, axis: [1, 0, 0] as V3 };
    p.push(tag(loft([
      { p: [0, -0.07, 0.7], r: [0.12, 0.05] }, { p: [0, -0.1, 0.82], r: [0.16, 0.06] }, { p: [0, -0.09, 0.9], r: [0.12, 0.045] },
    ], { sides: 10, sub: 2, paint: (f) => f.y > -0.085 ? 0xc86a6a : 0xf0aaa2 }), jaw));
    p.push(tag(box(0.26, 0.08, 0.14, 0x5a2424, { p: [0, -0.07, 0.86] }), head));
    // eyes
    for (const s of [-1, 1]) p.push(...eye([s * 0.2, 0.28, 0.7], 0.056, J, { side: s * 0.45 }));
    // flop ears (pink inside), a yellow tag in the left ear
    for (const s of [-1, 1]) {
      const pivot: V3 = [s * 0.22, 0.3, 0.52];
      const t = { part: s > 0 ? P.EAR_L : P.EAR_R, pivot, joint: J, axis: [0, 0, s] as V3 };
      p.push(tag(loft([
        { p: [s * 0.2, 0.31, 0.52], r: [0.05, 0.03], up: [0, 0.4, 1] },
        { p: [s * 0.3, 0.29, 0.53], r: [0.09, 0.03], up: [0, 0.4, 1] },
        { p: [s * 0.42, 0.25, 0.55], r: [0.08, 0.025], up: [0, 0.4, 1] },
        { p: [s * 0.48, 0.23, 0.56], r: [0.03, 0.015], up: [0, 0.4, 1] },
      ], { sides: 10, sub: 2, paint: (f) => f.z > 0.55 + f.y * 0 && f.nz > 0.5 ? 0xf4a8a8 : W, coat: (f) => f.nz > 0.5 ? 0 : 1 }), t));
      if (s > 0) p.push(tag(rbox(0.07, 0.08, 0.02, PAL.yellow, { p: [0.4, 0.2, 0.57], r: [0, 0.1, -0.3] }, 0.5, 1), t));
    }
    return rigMerge(p);
  });
}

/** a leg bone (modelled at its rest length, hanging from y = 0): thigh / shin with a little knee */
const legLoft = (rings: Ring[], paint: number | ((f: Face) => number), coat?: (f: Face) => number, sides = 9) =>
  loft(rings.map((r) => ({ ...r, up: [0, 0, 1] as V3 })), { sides, sub: 2, paint, coat });

const cowUpper = () => cached('beast:cow:upper', () => rigMerge([
  tag(legLoft([
    { p: [0, 0.14, -0.01], r: [0.1, 0.12] }, { p: [0, 0.02, 0], r: [0.13, 0.15] }, { p: [0, -0.18, 0.01], r: [0.1, 0.11] }, { p: [0, -0.36, 0], r: [0.08, 0.085] }, { p: [0, -0.42, 0], r: [0.05, 0.05] },
  ], 0xfbf8f0), { coat: 1 }),
]));
const cowLower = () => cached('beast:cow:lower', () => rigMerge([
  tag(legLoft([
    { p: [0, 0.04, 0], r: [0.085, 0.09] }, { p: [0, -0.04, 0], r: [0.08, 0.085] }, { p: [0, -0.2, 0], r: [0.065, 0.07] }, { p: [0, -0.3, 0.005], r: [0.07, 0.075] },
  ], 0xfbf8f0), { coat: 1 }),
  // hoof: a wide dark cup, cleft at the front
  legLoft([
    { p: [0, -0.3, 0.008], r: [0.075, 0.082] }, { p: [0, -0.36, 0.012], r: [0.088, 0.095], e: 2.6 }, { p: [0, -0.4, 0.014], r: [0.092, 0.1], e: 2.8 },
  ], 0x3a2e2c),
  box(0.012, 0.07, 0.03, 0x1e1616, { p: [0, -0.36, 0.105] }),
]));

// ---------------------------------------------------------------------------------------------------------------
// Sheep

const SHEEP_J: V3 = [0, 0.06, 0.16];
const FACE = 0x3a3230;

/** wool: soft egg-crate lumps over a hull, so a fleece reads as a cloud without being a pile of balls */
const woolly = (k: number, around = 9, along = 7, seed = 0) => (a: number, t: number) =>
  1 + k * (0.55 * Math.cos(a * around + seed) * Math.cos(t * Math.PI * along + seed * 0.7) + 0.45 * Math.cos(a * (around - 2) - t * 9 + seed * 1.3) * 0.5);

function sheepBody(season: Season): THREE.BufferGeometry {
  return cached(`beast:sheep:body:${season}`, () => {
    const wool = season === 'winter' ? 0xfffdf8 : 0xf8f3e6, shade = 0xe8dfcc;
    const p: THREE.BufferGeometry[] = [];
    // one fleece: a fat lumpy loaf, fuller on top, a shade darker underneath
    p.push(tag(loft([
      { p: [0, 0.66, -0.56], r: [0.12, 0.1] },
      { p: [0, 0.66, -0.47], r: [0.3, 0.26, 0.24] },
      { p: [0, 0.65, -0.3], r: [0.37, 0.32, 0.28] },
      { p: [0, 0.64, -0.05], r: [0.39, 0.34, 0.29] },
      { p: [0, 0.65, 0.2], r: [0.38, 0.33, 0.28] },
      { p: [0, 0.67, 0.4], r: [0.31, 0.29, 0.26] },
      { p: [0, 0.69, 0.5], r: [0.16, 0.16, 0.15] },
    ], { sides: 22, sub: 3, round: 0.5, bump: woolly(0.1), paint: (f) => f.ny < -0.35 ? shade : wool, coat: () => 1 }), { coat: 1 }));
    // woolly stub tail
    const root: V3 = [0, 0.72, -0.5];
    p.push(tag(blob([0, 0.62, -0.58], [0.07, 0.09, 0.06], { paint: wool, sides: 9, bump: woolly(0.1, 5, 3) }), { part: P.TAIL, joint: root, coat: 1 }));
    return rigMerge(p);
  });
}

function sheepHead(): THREE.BufferGeometry {
  return cached('beast:sheep:head', () => {
    const J = SHEEP_J, wool = 0xf8f3e6;
    const p: THREE.BufferGeometry[] = [];
    const head = { part: P.HEAD, joint: J };
    // a woolly ruff where the neck meets the fleece (does not nod)
    p.push(tag(blob([0, 0.02, 0.04], [0.17, 0.16, 0.15], { paint: wool, sides: 14, bump: woolly(0.09, 7, 3, 1) }), { coat: 1 }));
    // face: one long soft wedge, a greyer nose
    p.push(tag(loft([
      { p: [0, 0.07, 0.06], r: [0.09, 0.09] },
      { p: [0, 0.09, 0.17], r: [0.115, 0.12, 0.11] },
      { p: [0, 0.07, 0.31], r: [0.11, 0.105, 0.1] },
      { p: [0, 0.01, 0.43], r: [0.08, 0.075, 0.07] },
      { p: [0, -0.02, 0.51], r: [0.06, 0.05, 0.05] },
    ], { sides: 12, round: 0.45, paint: (f) => f.t > 0.82 ? 0x4e4444 : FACE }), head));
    for (const s of [-1, 1]) p.push(tag(blob([s * 0.026, -0.01, 0.535], [0.016, 0.012, 0.008], { paint: INK, sides: 6, rings: 2 }), head));
    // wool cap
    p.push(tag(blob([0, 0.19, 0.18], [0.12, 0.08, 0.12], { paint: wool, sides: 14, bump: woolly(0.12, 6, 3, 2) }), { ...head, coat: 1 }));
    // eyes (white sclera so they read on the dark face)
    for (const s of [-1, 1]) p.push(...eye([s * 0.088, 0.105, 0.34], 0.032, J, { sclera: 0xfbf8f2, side: s * 0.5 }));
    // side ears: soft leaves, pink inside
    for (const s of [-1, 1]) {
      const pivot: V3 = [s * 0.11, 0.1, 0.25];
      const t = { part: s > 0 ? P.EAR_L : P.EAR_R, pivot, joint: J, axis: [0, 0, s] as V3 };
      p.push(tag(loft([
        { p: [s * 0.09, 0.11, 0.24], r: [0.03, 0.018], up: [0, 0.3, 1] },
        { p: [s * 0.17, 0.09, 0.25], r: [0.05, 0.02], up: [0, 0.3, 1] },
        { p: [s * 0.25, 0.06, 0.26], r: [0.025, 0.014], up: [0, 0.3, 1] },
      ], { sides: 8, sub: 2, paint: (f) => f.nz > 0.6 && f.t > 0.25 ? 0xd89a9a : FACE }), t));
    }
    // jaw + pink mouth (baa!)
    const jaw = { part: P.JAW, pivot: [0, -0.06, 0.36] as V3, joint: J, axis: [1, 0, 0] as V3 };
    p.push(tag(loft([
      { p: [0, -0.06, 0.36], r: [0.05, 0.025] }, { p: [0, -0.07, 0.43], r: [0.055, 0.028] }, { p: [0, -0.06, 0.49], r: [0.035, 0.02] },
    ], { sides: 8, sub: 2, paint: (f) => f.ny > 0.5 ? 0xd86a78 : 0x3e3434 }), jaw));
    return rigMerge(p);
  });
}

const sheepUpper = () => cached('beast:sheep:upper', () => rigMerge([
  tag(blob([0, -0.03, 0], [0.085, 0.11, 0.085], { paint: 0xf8f3e6, sides: 10, bump: woolly(0.1, 5, 3) }), { coat: 1 }),
  legLoft([{ p: [0, 0, 0], r: 0.036 }, { p: [0, -0.12, 0.004], r: 0.033 }, { p: [0, -0.21, 0], r: 0.03 }], FACE, undefined, 7),
]));
const sheepLower = () => cached('beast:sheep:lower', () => rigMerge([
  legLoft([{ p: [0, 0.02, 0], r: 0.033 }, { p: [0, -0.1, 0], r: 0.028 }, { p: [0, -0.17, 0.004], r: 0.03 }], FACE, undefined, 7),
  legLoft([{ p: [0, -0.165, 0.006], r: [0.034, 0.037] }, { p: [0, -0.22, 0.01], r: [0.042, 0.046], e: 2.6 }], 0x221c1c, undefined, 7),
]));

// ---------------------------------------------------------------------------------------------------------------
// Pig

const PIG_J: V3 = [0, 0.0, 0.04];
const PINK_TOP = 0xffd2d6, PINK_BOTTOM = 0xf09aa8;
const pink = (y: number, y0: number, y1: number) => mixHex(PINK_BOTTOM, PINK_TOP, Math.min(1, Math.max(0, (y - y0) / (y1 - y0))));

function pigBody(): THREE.BufferGeometry {
  return cached('beast:pig:body', () => {
    const p: THREE.BufferGeometry[] = [];
    // one round barrel with a high rump and broad shoulders
    p.push(tag(loft([
      { p: [0, 0.5, -0.52], r: [0.12, 0.11] },
      { p: [0, 0.49, -0.44], r: [0.27, 0.26, 0.25] },
      { p: [0, 0.48, -0.28], r: [0.33, 0.31, 0.3] },
      { p: [0, 0.46, -0.02], r: [0.345, 0.31, 0.32] },
      { p: [0, 0.47, 0.24], r: [0.33, 0.3, 0.3] },
      { p: [0, 0.48, 0.42], r: [0.26, 0.25, 0.25] },
      { p: [0, 0.49, 0.5], r: [0.13, 0.13] },
    ], { sides: 16, round: 0.45, blend: true, paint: (f) => pink(f.y, 0.2, 0.72), coat: () => 1 }), { coat: 1 }));
    // belly row
    for (const z of [-0.12, 0.02, 0.16]) for (const s of [-1, 1]) p.push(ball(0.016, 0xe07a8a, { p: [s * 0.08, 0.155, z] }));
    // curly tail: a corkscrew that wiggles about the rump
    const root: V3 = [0, 0.56, -0.47];
    const t = { part: P.TAIL, joint: root, coat: 1 };
    p.push(tag(torus(0.045, 0.016, 6, 12, 0xf6a8b4, { p: [0, 0.6, -0.54], r: [0, Math.PI / 2, 0] }, Math.PI * 1.7), t));
    p.push(tag(torus(0.032, 0.014, 6, 10, 0xf6a8b4, { p: [0.012, 0.61, -0.575], r: [0.3, Math.PI / 2, 0.4] }, Math.PI * 1.5), t));
    p.push(tag(cyl(0.017, 0.02, 0.07, 6, 0xf6a8b4, { p: [0, 0.57, -0.51], r: [-1.1, 0, 0] }), t));
    return rigMerge(p);
  });
}

function pigHead(): THREE.BufferGeometry {
  return cached('beast:pig:head', () => {
    const J = PIG_J;
    const p: THREE.BufferGeometry[] = [];
    const head = { part: P.HEAD, joint: J };
    // head → jowls → snout in one hull; the flat end is the snout disc
    p.push(tag(loft([
      { p: [0, 0.03, -0.1], r: [0.16, 0.15] },
      { p: [0, 0.05, 0.04], r: [0.23, 0.2, 0.22] },
      { p: [0, 0.03, 0.18], r: [0.22, 0.18, 0.2] },
      { p: [0, -0.01, 0.3], r: [0.14, 0.12, 0.12] },
      { p: [0, -0.03, 0.37], r: [0.1, 0.09] },
      { p: [0, -0.03, 0.45], r: [0.11, 0.1], e: 2.2 },
    ], {
      sides: 16, caps: ['pole', 'flat'],
      paint: (f) => f.t >= 0.999 ? 0xffc0c8 : f.t > 0.72 ? 0xf6a6b2 : pink(f.y, -0.2, 0.22),
      coat: (f) => f.t > 0.72 ? 0 : 1,
    }), head));
    for (const s of [-1, 1]) p.push(tag(blob([s * 0.04, -0.03, 0.452], [0.022, 0.034, 0.008], { paint: 0x8a3a4a, sides: 8, rings: 2 }), head));
    // blush
    for (const s of [-1, 1]) p.push(tag(blob([s * 0.165, -0.02, 0.21], [0.012, 0.035, 0.05], { paint: 0xff8a9a, sides: 8, rings: 3 }), head));
    // eyes
    for (const s of [-1, 1]) p.push(...eye([s * 0.12, 0.1, 0.25], 0.04, J, { side: s * 0.45 }));
    // triangle ears that flop forward
    for (const s of [-1, 1]) {
      const pivot: V3 = [s * 0.14, 0.2, 0.12];
      const t = { part: s > 0 ? P.EAR_L : P.EAR_R, pivot, joint: J, axis: [1, 0, s * 0.3] as V3 };
      p.push(tag(loft([
        { p: [s * 0.1, 0.19, 0.04], r: [0.08, 0.025], up: [0, 0.8, 1] },
        { p: [s * 0.16, 0.26, 0.1], r: [0.075, 0.022], up: [0, 0.6, 1] },
        { p: [s * 0.22, 0.29, 0.18], r: [0.04, 0.016], up: [0, 0.2, 1] },
        { p: [s * 0.25, 0.27, 0.24], r: [0.01, 0.008], up: [0, 0, 1] },
      ], { sides: 8, sub: 2, paint: (f) => f.nz > 0.35 && f.ny > -0.2 && f.t > 0.2 ? 0xff9aaa : 0xffc8d0, coat: (f) => f.nz > 0.35 && f.t > 0.2 ? 0 : 1 }), t));
    }
    // jaw (oink!)
    const jaw = { part: P.JAW, pivot: [0, -0.1, 0.24] as V3, joint: J, axis: [1, 0, 0] as V3 };
    p.push(tag(loft([
      { p: [0, -0.12, 0.22], r: [0.07, 0.03] }, { p: [0, -0.14, 0.31], r: [0.08, 0.032] }, { p: [0, -0.12, 0.38], r: [0.05, 0.022] },
    ], { sides: 8, sub: 2, paint: (f) => f.ny > 0.5 ? 0xc85a6a : 0xf2a2ae }), jaw));
    return rigMerge(p);
  });
}

const pigUpper = () => cached('beast:pig:upper', () => rigMerge([
  tag(legLoft([{ p: [0, 0.06, 0], r: 0.07 }, { p: [0, -0.04, 0.005], r: [0.085, 0.09] }, { p: [0, -0.13, 0], r: 0.055 }], PINK_BOTTOM), { coat: 1 }),
]));
const pigLower = () => cached('beast:pig:lower', () => rigMerge([
  tag(legLoft([{ p: [0, 0.02, 0], r: 0.052 }, { p: [0, -0.08, 0], r: 0.046 }, { p: [0, -0.115, 0.004], r: 0.047 }], PINK_BOTTOM, undefined, 8), { coat: 1 }),
  legLoft([{ p: [0, -0.11, 0.006], r: [0.048, 0.05] }, { p: [0, -0.15, 0.012], r: [0.054, 0.058], e: 2.6 }], 0x8a5a5a, undefined, 8),
  box(0.008, 0.035, 0.02, 0x5a3434, { p: [0, -0.135, 0.065] }),
]));

// ---------------------------------------------------------------------------------------------------------------
// Chicken

const HEN_J: V3 = [0, 0.1, 0.03];
const COMB = 0xe8423a, BEAK = 0xf2a830, SHANK = 0xf2b640;

function chickenBody(): THREE.BufferGeometry {
  return cached('beast:chicken:body', () => {
    const W = 0xfbf8f0, S = 0xece6d8;
    const p: THREE.BufferGeometry[] = [];
    // one plump boat: the rump sweeps up into the tail, a round breast rises into the neck
    p.push(tag(loft([
      { p: [0, 0.5, -0.235], r: [0.025, 0.03] },
      { p: [0, 0.45, -0.2], r: [0.05, 0.065] },
      { p: [0, 0.38, -0.14], r: [0.1, 0.1, 0.1] },
      { p: [0, 0.32, -0.06], r: [0.145, 0.13, 0.13] },
      { p: [0, 0.3, 0.02], r: [0.155, 0.14, 0.14] },
      { p: [0, 0.32, 0.1], r: [0.135, 0.125, 0.12] },
      { p: [0, 0.38, 0.14], r: [0.09, 0.085, 0.08] },
      { p: [0, 0.44, 0.13], r: [0.06, 0.06] },
    ], { sides: 14, round: 0.4, paint: (f) => f.ny < -0.45 ? S : W, coat: () => 1 }), { coat: 1 }));
    // tail feathers: a slim fan out of the rump that cocks up and back
    const root: V3 = [0, 0.38, -0.15];
    p.push(tag(loft([
      { p: [0, 0.44, -0.19], r: [0.03, 0.05] },
      { p: [0, 0.51, -0.23], r: [0.022, 0.055] },
      { p: [0, 0.58, -0.25], r: [0.014, 0.04] },
      { p: [0, 0.62, -0.25], r: [0.008, 0.015] },
    ], { sides: 8, sub: 2, round: 0.35, paint: (f) => f.t > 0.6 ? S : W, coat: () => 1 }), { part: P.TAIL, joint: root, coat: 1 }));
    // wings: smooth folded teardrops with a darker trailing edge
    for (const s of [-1, 1]) {
      const pivot: V3 = [s * 0.12, 0.38, 0.04];
      const t = { part: s > 0 ? P.WING_L : P.WING_R, pivot, axis: [0, 0.15 * s, s] as V3, coat: 1 };
      p.push(tag(loft([
        { p: [s * 0.12, 0.35, 0.08], r: [0.015, 0.045] },
        { p: [s * 0.14, 0.33, 0.01], r: [0.024, 0.08] },
        { p: [s * 0.142, 0.315, -0.08], r: [0.02, 0.068] },
        { p: [s * 0.125, 0.31, -0.15], r: [0.01, 0.025] },
      ], { sides: 10, sub: 2, paint: (f) => f.t > 0.62 ? S : W, coat: () => 1 }), t));
    }
    return rigMerge(p);
  });
}

function chickenHead(): THREE.BufferGeometry {
  return cached('beast:chicken:head', () => {
    const J = HEN_J, W = 0xfbf8f0;
    const p: THREE.BufferGeometry[] = [];
    const head = { part: P.HEAD, joint: J };
    // neck (does not nod)
    p.push(tag(loft([
      { p: [0, -0.06, -0.01], r: [0.085, 0.085] }, { p: [0, 0.04, 0.0], r: [0.072, 0.075] }, { p: [0, 0.12, 0.02], r: [0.06, 0.06] },
    ], { sides: 12, sub: 2, paint: W, caps: ['open', 'pole'] }), { coat: 1 }));
    // head: a round skull drawn forward toward the beak
    p.push(tag(loft([
      { p: [0, 0.15, -0.035], r: [0.05, 0.05] },
      { p: [0, 0.165, 0.02], r: [0.072, 0.078, 0.074] },
      { p: [0, 0.165, 0.08], r: [0.066, 0.07, 0.068] },
      { p: [0, 0.155, 0.125], r: [0.038, 0.036] },
    ], { sides: 12, sub: 2, round: 0.4, paint: W, coat: () => 1 }), { ...head, coat: 1 }));
    // beak: upper fixed, lower opens
    p.push(tag(loft([{ p: [0, 0.158, 0.12], r: [0.03, 0.022] }, { p: [0, 0.15, 0.165], r: [0.016, 0.012] }, { p: [0, 0.14, 0.19], r: 0.004 }], { sides: 6, sub: 2, paint: BEAK }), head));
    p.push(tag(loft([{ p: [0, 0.134, 0.115], r: [0.022, 0.012] }, { p: [0, 0.13, 0.155], r: [0.012, 0.007] }], { sides: 6, sub: 1, paint: 0xe0902a }), { part: P.JAW, pivot: [0, 0.135, 0.11], joint: J, axis: [1, 0, 0] }));
    // comb (wobbles): one wavy crest
    const comb = { part: P.EAR_L, pivot: [0, 0.22, 0.06] as V3, joint: J, axis: [0, 0, 1] as V3 };
    p.push(tag(loft([
      { p: [0, 0.215, -0.02], r: [0.012, 0.022, 0.02] },
      { p: [0, 0.215, 0.01], r: [0.016, 0.055, 0.02] },
      { p: [0, 0.215, 0.04], r: [0.017, 0.04, 0.02] },
      { p: [0, 0.215, 0.065], r: [0.016, 0.058, 0.02] },
      { p: [0, 0.21, 0.095], r: [0.012, 0.03, 0.02] },
    ], { sides: 8, sub: 3, paint: COMB }), comb));
    // wattle (swings)
    const wat = { part: P.EAR_R, pivot: [0, 0.12, 0.12] as V3, joint: J, axis: [1, 0, 0] as V3 };
    p.push(tag(loft([{ p: [0, 0.125, 0.12], r: [0.018, 0.012] }, { p: [0, 0.095, 0.125], r: [0.03, 0.02] }, { p: [0, 0.07, 0.12], r: [0.02, 0.015] }], { sides: 8, sub: 2, paint: COMB }), wat));
    // eyes on the sides, a red earlobe
    for (const s of [-1, 1]) {
      p.push(...eye([s * 0.062, 0.18, 0.075], 0.022, J, { side: s * 0.75 }));
      p.push(tag(blob([s * 0.068, 0.14, 0.04], [0.008, 0.018, 0.016], { paint: COMB, sides: 6, rings: 2 }), head));
    }
    return rigMerge(p);
  });
}

const chickenUpper = () => cached('beast:chicken:upper', () => rigMerge([
  tag(blob([0, -0.02, 0], [0.058, 0.075, 0.062], { paint: 0xf4efe4, sides: 10 }), { coat: 1 }),
]));
const chickenLower = () => cached('beast:chicken:lower', () => {
  const p: THREE.BufferGeometry[] = [];
  p.push(legLoft([{ p: [0, 0.0, 0], r: 0.019 }, { p: [0, -0.06, 0], r: 0.016 }, { p: [0, -0.11, 0.002], r: 0.017 }], (f) => (Math.floor(f.y * -70) % 2 ? SHANK : 0xe6a634), undefined, 6));
  // three toes forward, one back
  for (const a of [-0.5, 0, 0.5]) p.push(loft([
    { p: [0, -0.112, 0.004], r: [0.011, 0.008] }, { p: [Math.sin(a) * 0.045, -0.116, Math.cos(a) * 0.045], r: [0.009, 0.007] }, { p: [Math.sin(a) * 0.07, -0.118, Math.cos(a) * 0.07], r: 0.004 },
  ], { sides: 5, sub: 2, paint: SHANK }));
  p.push(loft([{ p: [0, -0.112, 0], r: 0.009 }, { p: [0, -0.117, -0.035], r: 0.005 }], { sides: 5, sub: 1, paint: SHANK }));
  return rigMerge(p);
});

// ---------------------------------------------------------------------------------------------------------------
// Chick and egg

export const CHICK_J: V3 = [0, 0.1, 0.02];
export function chickBody(): THREE.BufferGeometry {
  return cached('beast:chick', () => {
    const Y = 0xffe070, Y2 = 0xf6c848;
    const p: THREE.BufferGeometry[] = [];
    // a fluffy egg with a stubby tail
    p.push(tag(loft([
      { p: [0, 0.1, -0.085], r: 0.02 },
      { p: [0, 0.085, -0.06], r: [0.055, 0.055] },
      { p: [0, 0.075, -0.01], r: [0.072, 0.066, 0.066] },
      { p: [0, 0.08, 0.045], r: [0.062, 0.06, 0.058] },
      { p: [0, 0.095, 0.075], r: 0.03 },
    ], { sides: 12, sub: 2, blend: true, bump: woolly(0.04, 7, 4), paint: (f) => mixHex(Y2, 0xfff0a0, Math.min(1, Math.max(0, (f.y - 0.02) / 0.11))) }), { coat: 1 }));
    const head = { part: P.HEAD, joint: CHICK_J };
    p.push(tag(blob([0, 0.14, 0.035], [0.05, 0.048, 0.05], { paint: Y, sides: 12 }), { ...head, coat: 1 }));
    p.push(tag(loft([{ p: [0, 0.18, 0.03], r: 0.012 }, { p: [0.004, 0.2, 0.025], r: 0.01 }, { p: [0.012, 0.212, 0.015], r: 0.003 }], { sides: 5, sub: 2, paint: 0xfff0a0 }), { ...head, coat: 1 }));
    p.push(tag(cone(0.014, 0.03, 5, BEAK, { p: [0, 0.135, 0.092], r: [Math.PI / 2, 0, 0] }), head));
    for (const s of [-1, 1]) p.push(...eye([s * 0.03, 0.155, 0.07], 0.012, CHICK_J, { side: s * 0.4 }));
    for (const s of [-1, 1]) {
      const t = { part: s > 0 ? P.WING_L : P.WING_R, pivot: [s * 0.06, 0.1, 0] as V3, axis: [0, 0, s] as V3, coat: 1 };
      p.push(tag(loft([{ p: [s * 0.064, 0.09, 0.02], r: [0.01, 0.022] }, { p: [s * 0.07, 0.08, -0.01], r: [0.014, 0.03] }, { p: [s * 0.066, 0.07, -0.05], r: [0.006, 0.012] }], { sides: 8, sub: 2, paint: Y2 }), t));
    }
    return rigMerge(p);
  });
}
export const chickLeg = () => cached('beast:chickleg', () => rigMerge([
  cyl(0.007, 0.008, 0.035, 5, SHANK, { p: [0, -0.017, 0] }),
  box(0.03, 0.006, 0.025, SHANK, { p: [0, -0.035, 0.008] }),
]));
export const eggGeo = () => cached('beast:egg', () => rigMerge([tag(blob([0, 0.07, 0], [0.06, 0.06, 0.078], { paint: 0xffffff, sides: 10, rings: 5, tilt: Math.PI / 2 }), { coat: 1 })], { coat: 1 }));

// ---------------------------------------------------------------------------------------------------------------
// Species table

/** find the neck pitch that brings the mouth down to `groundY` (rest space) for grazing */
function grazePitch(neck: V3, mouth: V3, nod: number, joint: V3, groundY: number): number {
  const v = new THREE.Vector3(), e = new THREE.Euler();
  for (let a = 0; a < 1.6; a += 0.01) {
    v.set(mouth[0] - joint[0], mouth[1] - joint[1], mouth[2] - joint[2]).applyEuler(e.set(nod, 0, 0)).add(new THREE.Vector3(...joint)).applyEuler(e.set(a, 0, 0));
    if (neck[1] + v.y <= groundY) return a;
  }
  return 1.5;
}

const quadKnees = [true, true, false, false];

const COW_NECK: V3 = [0, 1.16, 0.62], COW_MOUTH: V3 = [0, -0.1, 0.9];
const SHEEP_NECK: V3 = [0, 0.72, 0.36], SHEEP_MOUTH: V3 = [0, -0.08, 0.48];
const PIG_NECK: V3 = [0, 0.5, 0.42], PIG_MOUTH: V3 = [0, -0.12, 0.44];
const HEN_NECK: V3 = [0, 0.37, 0.11], HEN_MOUTH: V3 = [0, 0.14, 0.17];

export const BEASTS: Record<BeastKey, BeastDef> = {
  cow: {
    key: 'cow', body: () => cowBody(), head: cowHead, upper: cowUpper, lower: cowLower,
    hips: [[0.25, 0.76, 0.5], [-0.25, 0.76, 0.5], [0.25, 0.78, -0.5], [-0.25, 0.78, -0.5]],
    bones: [[0.37, 0.4], [0.37, 0.4], [0.38, 0.41], [0.38, 0.41]], boneGeo: [0.37, 0.4], kneeFwd: quadKnees,
    cog: [0, 1.0, 0], neck: COW_NECK, mouth: COW_MOUTH, grazeNod: 0.35, graze: grazePitch(COW_NECK, COW_MOUTH, 0.35, COW_J, 0.08),
    gait: { kind: 'quad', walkStride: 1.05, trotStride: 1.45, walkDuty: 0.64, trotDuty: 0.46, walkLift: 0.11, trotLift: 0.17, trotAt: 0.95, fullAt: 0.45 },
    walk: 0.55, trot: 1.35, flee: 1.8, turn: 1.6, r: 0.5, len: 1.05, lie: 'cow', lieDrop: [0.62, 0.6],
    sound: 'moo', max: 4, size: 1,
    names: ['Daisy', 'Buttercup', 'Clover', 'Bessie', 'Mabel', 'Marigold', 'Petunia', 'Honey', 'Dolly', 'Maple', 'Moomin', 'Toffee'],
    coats: [
      { tint: 0xffffff, pattern: 1, weight: 3, name: 'Holstein' }, { tint: 0xffffff, pattern: 2, weight: 2, name: 'brown & white' },
      { tint: 0xe0b078, pattern: 0, weight: 1.2, name: 'Jersey' }, { tint: 0x3a3232, pattern: 3, weight: 0.8, name: 'belted' },
      { tint: 0xa8683c, pattern: 6, weight: 1, name: 'Hereford-ish' },
    ],
  },
  sheep: {
    key: 'sheep', body: sheepBody, head: sheepHead, upper: sheepUpper, lower: sheepLower,
    hips: [[0.14, 0.41, 0.25], [-0.14, 0.41, 0.25], [0.14, 0.41, -0.25], [-0.14, 0.41, -0.25]],
    bones: [[0.2, 0.22], [0.2, 0.22], [0.2, 0.22], [0.2, 0.22]], boneGeo: [0.2, 0.22], kneeFwd: quadKnees,
    cog: [0, 0.64, 0], neck: SHEEP_NECK, mouth: SHEEP_MOUTH, grazeNod: 0.3, graze: grazePitch(SHEEP_NECK, SHEEP_MOUTH, 0.3, SHEEP_J, 0.06),
    gait: { kind: 'quad', walkStride: 0.62, trotStride: 0.9, walkDuty: 0.62, trotDuty: 0.45, walkLift: 0.07, trotLift: 0.1, trotAt: 0.8, fullAt: 0.35 },
    walk: 0.5, trot: 1.2, flee: 1.8, turn: 2.2, r: 0.38, len: 0.6, lie: 'sheep', lieDrop: [0.33, 0.33],
    sound: 'baa', max: 6, size: 1,
    names: ['Woolly', 'Cotton', 'Fluffy', 'Shaun', 'Baabara', 'Cloud', 'Lamby', 'Muffin', 'Pearl', 'Nimbus', 'Dumpling', 'Tufty'],
    coats: [
      { tint: 0xffffff, pattern: 0, weight: 5, name: 'white' }, { tint: 0xfff0dc, pattern: 0, weight: 2, name: 'cream' },
      { tint: 0x4a4446, pattern: 0, weight: 1, name: 'black' }, { tint: 0xc8a888, pattern: 0, weight: 0.6, name: 'brown' },
    ],
  },
  pig: {
    key: 'pig', body: () => pigBody(), head: pigHead, upper: pigUpper, lower: pigLower,
    hips: [[0.17, 0.27, 0.26], [-0.17, 0.27, 0.26], [0.17, 0.28, -0.28], [-0.17, 0.28, -0.28]],
    bones: [[0.12, 0.15], [0.12, 0.15], [0.12, 0.155], [0.12, 0.155]], boneGeo: [0.12, 0.15], kneeFwd: quadKnees,
    cog: [0, 0.46, 0], neck: PIG_NECK, mouth: PIG_MOUTH, grazeNod: 0.25, graze: grazePitch(PIG_NECK, PIG_MOUTH, 0.25, PIG_J, 0.04),
    gait: { kind: 'quad', walkStride: 0.46, trotStride: 0.68, walkDuty: 0.62, trotDuty: 0.45, walkLift: 0.06, trotLift: 0.085, trotAt: 0.7, fullAt: 0.3 },
    walk: 0.5, trot: 1.2, flee: 1.6, turn: 2.2, r: 0.36, len: 0.62, lie: 'pig', lieDrop: [0.2, 0.22],
    sound: 'oink', max: 5, size: 1,
    names: ['Truffle', 'Hamlet', 'Pickles', 'Wilbur', 'Peaches', 'Snuffles', 'Pudding', 'Rosie', 'Babe', 'Mochi', 'Sprout', 'Bean'],
    coats: [
      { tint: 0xffffff, pattern: 0, weight: 4, name: 'pink' }, { tint: 0xffffff, pattern: 5, weight: 1.5, name: 'spotted' },
      { tint: 0x4a4042, pattern: 3, weight: 0.8, name: 'saddleback' }, { tint: 0xf0b080, pattern: 0, weight: 0.8, name: 'ginger' },
    ],
  },
  chicken: {
    key: 'chicken', body: () => chickenBody(), head: chickenHead, upper: chickenUpper, lower: chickenLower,
    hips: [[0.07, 0.2, 0.0], [-0.07, 0.2, 0.0]],
    bones: [[0.08, 0.12], [0.08, 0.12]], boneGeo: [0.08, 0.12], kneeFwd: [false, false],
    cog: [0, 0.3, 0], neck: HEN_NECK, mouth: HEN_MOUTH, grazeNod: 0.5, graze: grazePitch(HEN_NECK, HEN_MOUTH, 0.5, HEN_J, 0.02),
    gait: { kind: 'biped', walkStride: 0.17, trotStride: 0.3, walkDuty: 0.6, trotDuty: 0.4, walkLift: 0.05, trotLift: 0.07, trotAt: 0.5, fullAt: 0.22 },
    walk: 0.3, trot: 0.9, flee: 1.9, turn: 5, r: 0.18, len: 0.22, lie: 'bird', lieDrop: [0.16, 0.16],
    sound: 'cluck', max: 9, size: 1.35,
    names: ['Nugget', 'Pip', 'Henrietta', 'Peep', 'Clucky', 'Popcorn', 'Dotty', 'Waffles', 'Biscuit', 'Marge', 'Omelette', 'Sunny', 'Pepper', 'Custard'],
    coats: [
      { tint: 0xffffff, pattern: 0, weight: 2, name: 'white' }, { tint: 0xc87444, pattern: 0, weight: 2.5, name: 'red' },
      { tint: 0xeebc78, pattern: 0, weight: 1.5, name: 'buff' }, { tint: 0xf4f0e8, pattern: 4, weight: 1.5, name: 'speckled' },
      { tint: 0x48424c, pattern: 0, weight: 0.7, name: 'black' },
    ],
  },
};

/** pick a coat by weight with a 0..1 roll */
export function pickCoat(def: BeastDef, roll: number): Coat {
  const total = def.coats.reduce((s, c) => s + c.weight, 0);
  let r = roll * total;
  for (const c of def.coats) { r -= c.weight; if (r <= 0) return c; }
  return def.coats[0];
}
