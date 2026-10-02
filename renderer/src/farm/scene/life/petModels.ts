/**
 * Biscuit (shiba-ish dog) and Mochi (calico cat): skinned, chunky, faceted. Each is one SkinnedMesh on a small
 * skeleton (body → hips / chest → neck → head → ears / eyes / tongue; tails as bone chains; legs as upper → lower →
 * paw). `PetDims` tells the animator (petBody.ts) where the joints are and how long the limbs are.
 */
import * as THREE from 'three';
import { PAL } from '../toon.ts';
import { blob, loft } from '../sculpt.ts';
import type { Face, Ring } from '../sculpt.ts';
import { arc, buildSkinned, sp } from './skin.ts';
import type { BoneDef, SkinPiece, SkinnedModel } from './skin.ts';

const ball = (r: number, w = 7, h = 5) => new THREE.SphereGeometry(r, w, h);
const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);
const cone = (r: number, h: number, s = 4) => new THREE.ConeGeometry(r, h, s);
const cyl = (rt: number, rb: number, h: number, s = 6) => new THREE.CylinderGeometry(rt, rb, h, s);

export interface LegDims {
  /** bones: upper, lower, paw */
  bones: [string, string, string];
  parent: 'hips' | 'chest';
  a: number; b: number;
  /** paw joint height above the sole */
  h: number;
  /** +1 joint behind the line (fore: elbow), −1 in front (hind: stifle) */
  bend: number;
}

export interface PetDims {
  kind: 'dog' | 'cat';
  /** body bone height when standing square */
  standY: number;
  restY: number;
  legs: [LegDims, LegDims, LegDims, LegDims];
  /** neutral foot (x, z), root frame, per leg LF RF LH RH */
  neutral: [[number, number], [number, number], [number, number], [number, number]];
  /** leg length relative to Biscuit */
  scale: number;
  tail: string[];
  /** half height of the barrel (lying / rolled clearance) */
  belly: number;
  /** body bone height when sitting */
  sitY: number;
  /** head top above the body bone (hearts, look-at) */
  headTop: number;
  /** resting tail carriage (default: Biscuit's curl over the back / Mochi's question mark) */
  tailLift?: number;
  tailCurl?: number;
  /** dog rig with the tail authored straight back (along −z) instead of up: it wags about y, lift raises it */
  tailBack?: boolean;
  /** floppy ears (hanging from the top of the head): perk lifts them forward, flat-back flies them out */
  flopEars?: boolean;
}

export interface PetModel extends SkinnedModel { dims: PetDims }


function legBones(pre: string, parent: string, x: number, y0: number, y1: number, y2: number, z: number): BoneDef[] {
  return [
    { name: `${pre}0`, parent, at: [x, y0, z] },
    { name: `${pre}1`, parent: `${pre}0`, at: [x, y1, z] },
    { name: `${pre}2`, parent: `${pre}1`, at: [x, y2, z] },
  ];
}

// ---------------------------------------------------------------------------------------------
// Biscuit

const DOG = { fur: 0xe39a52, back: 0xcf8440, cream: 0xfff0d8, ink: PAL.ink, pink: 0xf2899a, pad: 0x5e3b3e, earIn: 0xf6d2b8 };

export function dogModel(): PetModel {
  const bones: BoneDef[] = [
    { name: 'body', parent: null, at: [0, 0.44, 0] },
    { name: 'hips', parent: 'body', at: [0, 0.44, -0.13] },
    { name: 'chest', parent: 'body', at: [0, 0.44, 0.13] },
    { name: 'neck', parent: 'chest', at: [0, 0.54, 0.26] },
    { name: 'head', parent: 'neck', at: [0, 0.65, 0.33] },
    { name: 'earL', parent: 'head', at: [0.088, 0.8, 0.33] },
    { name: 'earR', parent: 'head', at: [-0.088, 0.8, 0.33] },
    { name: 'eyeL', parent: 'head', at: [0.068, 0.725, 0.5] },
    { name: 'eyeR', parent: 'head', at: [-0.068, 0.725, 0.5] },
    { name: 'happyL', parent: 'head', at: [0.068, 0.725, 0.5] },
    { name: 'happyR', parent: 'head', at: [-0.068, 0.725, 0.5] },
    { name: 'tongue', parent: 'head', at: [0, 0.625, 0.56] },
    { name: 'tag', parent: 'neck', at: [0, 0.5, 0.35] },
    { name: 'tail0', parent: 'hips', at: [0, 0.56, -0.32] },
    { name: 'tail1', parent: 'tail0', at: [0, 0.63, -0.32] },
    { name: 'tail2', parent: 'tail1', at: [0, 0.7, -0.32] },
    { name: 'tail3', parent: 'tail2', at: [0, 0.765, -0.32] },
    ...legBones('lf', 'chest', 0.1, 0.42, 0.235, 0.06, 0.22),
    ...legBones('rf', 'chest', -0.1, 0.42, 0.235, 0.06, 0.22),
    ...legBones('lh', 'hips', 0.1, 0.43, 0.24, 0.06, -0.22),
    ...legBones('rh', 'hips', -0.1, 0.43, 0.24, 0.06, -0.22),
  ];
  const { fur, back, cream, ink, pink, pad, earIn } = DOG;
  const p: SkinPiece[] = [];
  // barrel: one hull from rump to brisket, bending between hips and chest; darker saddle, cream belly and chest
  const barrel = { bone: 'hips', blend: { to: 'chest', axis: 2 as const, from: -0.16, till: 0.16 } };
  p.push(sp(loft([
    { p: [0, 0.48, -0.36], r: 0.05 },
    { p: [0, 0.47, -0.31], r: [0.14, 0.13, 0.12] },
    { p: [0, 0.465, -0.19], r: [0.185, 0.165, 0.17] },
    { p: [0, 0.455, 0.0], r: [0.18, 0.16, 0.165] },
    { p: [0, 0.465, 0.15], r: [0.19, 0.175, 0.18] },
    { p: [0, 0.495, 0.26], r: [0.15, 0.15, 0.15] },
    { p: [0, 0.53, 0.31], r: 0.07 },
  ], { sides: 14, paint: (f) => Math.sin(f.a) > 0.8 ? back : Math.sin(f.a) < -0.55 || (f.t > 0.8 && Math.sin(f.a) < 0.1) ? cream : fur }), null, barrel));
  // neck: a thick ruff rising into the head, cream down the throat
  p.push(sp(loft([
    { p: [0, 0.5, 0.2], r: [0.13, 0.13] }, { p: [0, 0.58, 0.28], r: [0.125, 0.125, 0.12] }, { p: [0, 0.66, 0.33], r: [0.105, 0.1] },
  ], { sides: 12, sub: 2, caps: ['open', 'pole'], paint: (f) => Math.sin(f.a) < -0.3 ? cream : fur }), null, { bone: 'neck' }));
  p.push(sp(new THREE.TorusGeometry(0.128, 0.03, 6, 14), PAL.red, { bone: 'neck', at: [0, 0.56, 0.29], rot: [Math.PI / 2 - 0.6, 0, 0] }));
  p.push(sp(new THREE.TorusGeometry(0.014, 0.005, 3, 6), PAL.metal, { bone: 'tag', at: [0, 0.495, 0.365], rot: [0, 0, 0] }));
  p.push(sp(cyl(0.032, 0.032, 0.012, 8), PAL.yellow, { bone: 'tag', at: [0, 0.462, 0.37], rot: [Math.PI / 2, 0, 0] }));
  p.push(sp(box(0.02, 0.004, 0.004), 0xb07a1a, { bone: 'tag', at: [0, 0.462, 0.378] }));
  // head: round skull drawn into a short fox muzzle; the shiba mask (cheeks, muzzle, throat) is painted on
  const H = { bone: 'head' };
  p.push(sp(loft([
    { p: [0, 0.715, 0.22], r: [0.1, 0.1] },
    { p: [0, 0.72, 0.3], r: [0.165, 0.15, 0.14] },
    { p: [0, 0.715, 0.4], r: [0.165, 0.145, 0.14] },
    { p: [0, 0.69, 0.48], r: [0.11, 0.095, 0.095] },
    { p: [0, 0.665, 0.55], r: [0.07, 0.055, 0.055] },
    { p: [0, 0.665, 0.59], r: [0.04, 0.035, 0.03] },
  ], { sides: 14, round: 0.4, paint: (f) => (f.t > 0.62 && Math.sin(f.a) < 0.75) || (f.t > 0.3 && Math.sin(f.a) < -0.15) ? cream : fur }), null, H));
  p.push(sp(blob([0, 0.683, 0.598], [0.035, 0.026, 0.024], { paint: ink, sides: 10, rings: 4 }), null, H));
  p.push(sp(ball(0.011, 4, 3), 0xffffff, { ...H, at: [0.012, 0.697, 0.618] }));
  p.push(sp(box(0.006, 0.03, 0.006), ink, { ...H, at: [0, 0.645, 0.584] }));
  p.push(sp(box(0.05, 0.007, 0.007), ink, { ...H, at: [0, 0.628, 0.57], rot: [0, 0, 0] }));
  for (const s of [1, -1]) p.push(sp(blob([s * 0.06, 0.79, 0.47], [0.024, 0.012, 0.01], { paint: cream, sides: 8, rings: 3 }), null, H));
  p.push(sp(box(0.05, 0.012, 0.075), pink, { bone: 'tongue', at: [0, 0.615, 0.58], rot: [0.5, 0, 0] }));
  p.push(sp(box(0.004, 0.013, 0.05), 0xd06a7a, { bone: 'tongue', at: [0, 0.618, 0.585], rot: [0.5, 0, 0] }));
  // eyes (blink by scaling), happy "∩" eyes (shown when petted)
  for (const [s, e, h] of [[1, 'eyeL', 'happyL'], [-1, 'eyeR', 'happyR']] as const) {
    p.push(sp(ball(0.029, 7, 5), ink, { bone: e, at: [s * 0.07, 0.725, 0.505], scale: [0.95, 1.2, 0.65], rot: [0, s * 0.35, 0] }));
    p.push(sp(ball(0.0095, 4, 3), 0xffffff, { bone: e, at: [s * 0.07 + 0.01, 0.738, 0.523] }));
    p.push(sp(arc(0.024, 0.0075), ink, { bone: h, at: [s * 0.068, 0.716, 0.512], rot: [-0.25, s * 0.35, 0] }));
  }
  // ears: pointy and alert, warm inside
  for (const [s, e] of [[1, 'earL'], [-1, 'earR']] as const) {
    p.push(sp(loft([
      { p: [s * 0.085, 0.79, 0.33], r: [0.07, 0.03], up: [0, 0, 1] },
      { p: [s * 0.098, 0.86, 0.335], r: [0.05, 0.022], up: [0, 0, 1] },
      { p: [s * 0.11, 0.93, 0.34], r: [0.012, 0.01], up: [0, 0, 1] },
    ], { sides: 8, sub: 2, paint: (f) => f.nz > 0.6 && f.t > 0.15 && f.t < 0.85 ? earIn : fur }), null, { bone: e }));
  }
  // curled fluffy tail over the back: orange outside, cream inside the curl
  p.push(sp(loft([
    { p: [0, 0.5, -0.29], r: 0.055 },
    { p: [0, 0.6, -0.345], r: [0.07, 0.072] },
    { p: [0, 0.7, -0.34], r: [0.075, 0.075] },
    { p: [0, 0.77, -0.29], r: [0.065, 0.065] },
    { p: [0, 0.78, -0.22], r: [0.045, 0.045] },
    { p: [0, 0.755, -0.19], r: 0.02 },
  ], { sides: 10, round: 0.6, paint: (f) => f.t > 0.2 && Math.sin(f.a) < -0.4 ? cream : fur }), null, { bone: 'tail0', chain: { bones: ['tail0', 'tail1', 'tail2', 'tail3'], axis: 1, at: [0.56, 0.63, 0.7, 0.765] } }));
  // legs: one hull from shoulder to wrist riding upper → lower, cream socks, round paws with dark pads
  const leg = (pre: string, x: number, z: number, y0: number, y1: number, hind: boolean) => {
    p.push(sp(loft(([
      { p: [x, y0 + 0.05, z], r: [0.065, 0.07] },
      { p: [x, y0 - 0.06, z - (hind ? 0.01 : 0)], r: [0.058, 0.062] },
      { p: [x, y1, z], r: [0.046, 0.05] },
      { p: [x, 0.12, z + 0.004], r: [0.042, 0.045] },
      { p: [x, 0.05, z + 0.01], r: [0.04, 0.042] },
    ] as Ring[]).map((r) => ({ ...r, up: [0, 0, 1] as const })), { sides: 9, sub: 2, caps: ['pole', 'open'], paint: (f) => f.t > (hind ? 0.62 : 0.42) ? cream : fur }), null,
      { bone: `${pre}0`, chain: { bones: [`${pre}0`, `${pre}1`, `${pre}2`], axis: 1, at: [y0, y1, 0.06] } }));
    p.push(sp(blob([x, 0.034, z + 0.022], [0.05, 0.034, 0.066], { paint: (f) => f.ny < -0.6 ? pad : cream, sides: 10, rings: 4 }), null, { bone: `${pre}2` }));
    for (const t of [-1, 0, 1]) p.push(sp(ball(0.011, 4, 3), pad, { bone: `${pre}2`, at: [x + t * 0.022, 0.006, z + 0.06 - Math.abs(t) * 0.008], scale: [1, 0.4, 1] }));
  };
  leg('lf', 0.1, 0.22, 0.42, 0.235, false); leg('rf', -0.1, 0.22, 0.42, 0.235, false);
  leg('lh', 0.1, -0.22, 0.43, 0.24, true); leg('rh', -0.1, -0.22, 0.43, 0.24, true);
  const m = buildSkinned('dog', bones, p);
  const lf = (bones: [string, string, string], parent: 'hips' | 'chest', a: number, b: number, bend: number): LegDims => ({ bones, parent, a, b, h: 0.06, bend });
  return {
    ...m,
    dims: {
      kind: 'dog', standY: 0.425, restY: 0.44, scale: 1, belly: 0.19, sitY: 0.3, headTop: 0.38,
      legs: [lf(['lf0', 'lf1', 'lf2'], 'chest', 0.185, 0.175, 1), lf(['rf0', 'rf1', 'rf2'], 'chest', 0.185, 0.175, 1),
        lf(['lh0', 'lh1', 'lh2'], 'hips', 0.19, 0.18, -1), lf(['rh0', 'rh1', 'rh2'], 'hips', 0.19, 0.18, -1)],
      neutral: [[0.1, 0.235], [-0.1, 0.235], [0.1, -0.225], [-0.1, -0.225]],
      tail: ['tail0', 'tail1', 'tail2', 'tail3'],
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Mochi

const CAT = { fur: 0xf7efe3, orange: 0xeb9a55, char: 0x57504e, pink: 0xf2a3ae, iris: 0xd9b23a, ink: PAL.ink };

export function catModel(): PetModel {
  const bones: BoneDef[] = [
    { name: 'body', parent: null, at: [0, 0.26, 0] },
    { name: 'hips', parent: 'body', at: [0, 0.26, -0.11] },
    { name: 'chest', parent: 'body', at: [0, 0.26, 0.11] },
    { name: 'neck', parent: 'chest', at: [0, 0.31, 0.2] },
    { name: 'head', parent: 'neck', at: [0, 0.39, 0.25] },
    { name: 'earL', parent: 'head', at: [0.058, 0.475, 0.255] },
    { name: 'earR', parent: 'head', at: [-0.058, 0.475, 0.255] },
    { name: 'eyeL', parent: 'head', at: [0.044, 0.425, 0.352] },
    { name: 'eyeR', parent: 'head', at: [-0.044, 0.425, 0.352] },
    { name: 'happyL', parent: 'head', at: [0.044, 0.425, 0.352] },
    { name: 'happyR', parent: 'head', at: [-0.044, 0.425, 0.352] },
    { name: 'tongue', parent: 'head', at: [0, 0.375, 0.345] },
    { name: 'tag', parent: 'neck', at: [0, 0.285, 0.265] },
    { name: 'tail0', parent: 'hips', at: [0, 0.3, -0.24] },
    { name: 'tail1', parent: 'tail0', at: [0, 0.3, -0.325] },
    { name: 'tail2', parent: 'tail1', at: [0, 0.3, -0.41] },
    { name: 'tail3', parent: 'tail2', at: [0, 0.3, -0.49] },
    { name: 'tail4', parent: 'tail3', at: [0, 0.3, -0.565] },
    ...legBones('lf', 'chest', 0.052, 0.25, 0.138, 0.03, 0.14),
    ...legBones('rf', 'chest', -0.052, 0.25, 0.138, 0.03, 0.14),
    ...legBones('lh', 'hips', 0.055, 0.26, 0.145, 0.03, -0.14),
    ...legBones('rh', 'hips', -0.055, 0.26, 0.145, 0.03, -0.14),
  ];
  const { fur, orange, char, pink, iris, ink } = CAT;
  const p: SkinPiece[] = [];
  // calico patches: two soft noise fields over the white coat (orange on the back and haunch, charcoal on the shoulder)
  const calico = (f: Face, top: number) => {
    const n1 = Math.sin(f.x * 31 + 1.3) * Math.sin(f.z * 17 - 0.4) + Math.sin(f.y * 23 + f.z * 9);
    const n2 = Math.sin(f.x * 27 - 2.1) * Math.sin(f.z * 21 + 2.4) + Math.sin(f.y * 19 - f.x * 13 + 1);
    if (top > 0.1 && n1 > 0.75) return orange;
    if (top > -0.2 && n2 > 0.95) return char;
    return fur;
  };
  const barrel = { bone: 'hips', blend: { to: 'chest', axis: 2 as const, from: -0.14, till: 0.14 } };
  p.push(sp(loft([
    { p: [0, 0.285, -0.255], r: 0.035 },
    { p: [0, 0.278, -0.21], r: [0.09, 0.085, 0.08] },
    { p: [0, 0.272, -0.11], r: [0.11, 0.1, 0.1] },
    { p: [0, 0.262, 0.02], r: [0.1, 0.09, 0.098] },
    { p: [0, 0.27, 0.13], r: [0.104, 0.098, 0.1] },
    { p: [0, 0.29, 0.2], r: [0.084, 0.084, 0.084] },
    { p: [0, 0.305, 0.24], r: 0.04 },
  ], { sides: 14, paint: (f) => calico(f, Math.sin(f.a)) }), null, barrel));
  p.push(sp(loft([
    { p: [0, 0.27, 0.16], r: [0.08, 0.08] }, { p: [0, 0.33, 0.215], r: [0.074, 0.072] }, { p: [0, 0.39, 0.25], r: [0.062, 0.06] },
  ], { sides: 12, sub: 2, caps: ['open', 'pole'], paint: fur }), null, { bone: 'neck' }));
  p.push(sp(new THREE.TorusGeometry(0.074, 0.013, 5, 14), 0x4fa3c9, { bone: 'neck', at: [0, 0.325, 0.225], rot: [Math.PI / 2 - 0.5, 0, 0] }));
  p.push(sp(ball(0.019, 6, 4), PAL.yellow, { bone: 'tag', at: [0, 0.27, 0.272] }));
  p.push(sp(box(0.022, 0.003, 0.003), 0x8a6a1a, { bone: 'tag', at: [0, 0.264, 0.289] }));
  // head: one wide round face with a little muzzle, a charcoal patch over the right eye, whiskers
  const H = { bone: 'head' };
  p.push(sp(loft([
    { p: [0, 0.42, 0.16], r: [0.07, 0.07] },
    { p: [0, 0.422, 0.215], r: [0.118, 0.098, 0.09] },
    { p: [0, 0.415, 0.285], r: [0.122, 0.1, 0.092] },
    { p: [0, 0.4, 0.33], r: [0.086, 0.07, 0.066] },
    { p: [0, 0.385, 0.356], r: [0.042, 0.036, 0.034] },
  ], { sides: 14, round: 0.45, paint: (f) => f.x < -0.012 && f.y > 0.418 && f.t < 0.85 ? char : fur }), null, H));
  for (const s of [1, -1]) p.push(sp(blob([s * 0.024, 0.382, 0.34], [0.036, 0.03, 0.03], { paint: 0xffffff, sides: 8, rings: 3 }), null, H));
  p.push(sp(blob([0, 0.37, 0.338], [0.02, 0.016, 0.018], { paint: 0xffffff, sides: 8, rings: 3 }), null, H));
  p.push(sp(cone(0.013, 0.014, 3), pink, { ...H, at: [0, 0.4, 0.366], rot: [Math.PI, 0, 0], scale: [1.3, 1, 0.8] }));
  for (const s of [1, -1]) for (const k of [-1, 0, 1]) {
    p.push(sp(box(0.1, 0.0055, 0.0055), 0xffffff, { ...H, at: [s * 0.1, 0.387 + k * 0.009, 0.335], rot: [0, s * 0.18, s * k * 0.16] }));
  }
  for (const [s, e, h] of [[1, 'eyeL', 'happyL'], [-1, 'eyeR', 'happyR']] as const) {
    p.push(sp(ball(0.026, 7, 5), iris, { bone: e, at: [s * 0.045, 0.425, 0.35], scale: [1, 1.12, 0.55], rot: [0, s * 0.3, 0] }));
    p.push(sp(box(0.009, 0.036, 0.01), ink, { bone: e, at: [s * 0.046, 0.425, 0.362], rot: [0, s * 0.3, 0] }));
    p.push(sp(ball(0.006, 4, 3), 0xffffff, { bone: e, at: [s * 0.046 + 0.008, 0.436, 0.366] }));
    p.push(sp(arc(0.02, 0.006), ink, { bone: h, at: [s * 0.044, 0.418, 0.358], rot: [-0.2, s * 0.3, 0] }));
  }
  p.push(sp(box(0.032, 0.008, 0.045), pink, { bone: 'tongue', at: [0, 0.362, 0.352], rot: [0.3, 0, 0] }));
  for (const [s, e] of [[1, 'earL'], [-1, 'earR']] as const) {
    p.push(sp(loft([
      { p: [s * 0.058, 0.47, 0.255], r: [0.05, 0.022], up: [0, 0, 1] },
      { p: [s * 0.068, 0.515, 0.258], r: [0.034, 0.016], up: [0, 0, 1] },
      { p: [s * 0.078, 0.56, 0.262], r: [0.008, 0.006], up: [0, 0, 1] },
    ], { sides: 8, sub: 2, paint: (f) => f.nz > 0.6 && f.t > 0.15 && f.t < 0.8 ? pink : s > 0 ? orange : char }), null, { bone: e }));
  }
  // long tail: one tapering hull riding the chain, a charcoal band and an orange tip
  p.push(sp(loft([
    { p: [0, 0.29, -0.22], r: 0.034 },
    { p: [0, 0.3, -0.33], r: 0.03 },
    { p: [0, 0.3, -0.45], r: 0.027 },
    { p: [0, 0.3, -0.57], r: 0.024 },
    { p: [0, 0.3, -0.645], r: 0.02 },
  ], { sides: 9, caps: ['open', 'pole'], round: 0.8, paint: (f) => f.t > 0.86 ? orange : f.t > 0.42 && f.t < 0.56 ? char : fur }), null,
    { bone: 'tail0', chain: { bones: ['tail0', 'tail1', 'tail2', 'tail3', 'tail4'], axis: 2, at: [-0.24, -0.325, -0.41, -0.49, -0.565] } }));
  const leg = (pre: string, x: number, z: number, y0: number, y1: number, c: number) => {
    p.push(sp(loft(([
      { p: [x, y0 + 0.035, z], r: [0.04, 0.042] },
      { p: [x, y0 - 0.045, z], r: [0.034, 0.037] },
      { p: [x, y1, z], r: [0.027, 0.029] },
      { p: [x, 0.07, z + 0.003], r: [0.025, 0.026] },
      { p: [x, 0.028, z + 0.006], r: [0.024, 0.025] },
    ] as Ring[]).map((r) => ({ ...r, up: [0, 0, 1] as const })), { sides: 8, sub: 2, caps: ['pole', 'open'], paint: (f) => f.t < 0.4 ? c : fur }), null,
      { bone: `${pre}0`, chain: { bones: [`${pre}0`, `${pre}1`, `${pre}2`], axis: 1, at: [y0, y1, 0.03] } }));
    p.push(sp(blob([x, 0.018, z + 0.012], [0.03, 0.019, 0.04], { paint: (f) => f.ny < -0.6 ? pink : fur, sides: 9, rings: 4 }), null, { bone: `${pre}2` }));
    for (const t of [-1, 1]) p.push(sp(ball(0.007, 4, 3), pink, { bone: `${pre}2`, at: [x + t * 0.011, 0.004, z + 0.037], scale: [1, 0.4, 1] }));
  };
  leg('lf', 0.052, 0.14, 0.25, 0.138, fur); leg('rf', -0.052, 0.14, 0.25, 0.138, fur);
  leg('lh', 0.055, -0.14, 0.26, 0.145, orange); leg('rh', -0.055, -0.14, 0.26, 0.145, fur);
  const m = buildSkinned('cat', bones, p);
  const lf = (bones: [string, string, string], parent: 'hips' | 'chest', a: number, b: number, bend: number): LegDims => ({ bones, parent, a, b, h: 0.03, bend });
  return {
    ...m,
    dims: {
      kind: 'cat', standY: 0.25, restY: 0.26, scale: 0.6, belly: 0.1, sitY: 0.19, headTop: 0.2,
      legs: [lf(['lf0', 'lf1', 'lf2'], 'chest', 0.112, 0.108, 1), lf(['rf0', 'rf1', 'rf2'], 'chest', 0.112, 0.108, 1),
        lf(['lh0', 'lh1', 'lh2'], 'hips', 0.115, 0.115, -1), lf(['rh0', 'rh1', 'rh2'], 'hips', 0.115, 0.115, -1)],
      neutral: [[0.052, 0.15], [-0.052, 0.15], [0.055, -0.14], [-0.055, -0.14]],
      tail: ['tail0', 'tail1', 'tail2', 'tail3', 'tail4'],
    },
  };
}
