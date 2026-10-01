/**
 * Biscuit (shiba-ish dog) and Mochi (calico cat): skinned, chunky, faceted. Each is one SkinnedMesh on a small
 * skeleton (body → hips / chest → neck → head → ears / eyes / tongue; tails as bone chains; legs as upper → lower →
 * paw). `PetDims` tells the animator (petBody.ts) where the joints are and how long the limbs are.
 */
import * as THREE from 'three';
import { PAL } from '../toon.ts';
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
  // barrel: bends between hips and chest
  const barrel = { bone: 'hips', blend: { to: 'chest', axis: 2 as const, from: -0.16, till: 0.16 } };
  p.push(sp(ball(0.2, 9, 7), fur, { ...barrel, at: [0, 0.455, -0.01], scale: [1.02, 0.94, 1.62] }));
  p.push(sp(ball(0.15, 8, 5), back, { ...barrel, at: [0, 0.53, -0.04], scale: [0.95, 0.5, 1.7] }));
  p.push(sp(ball(0.16, 8, 5), cream, { ...barrel, at: [0, 0.38, 0.05], scale: [0.86, 0.72, 1.45] }));
  // chest ruff and haunches
  p.push(sp(ball(0.135, 7, 5), cream, { bone: 'chest', at: [0, 0.46, 0.25], scale: [1.05, 1.1, 0.8] }));
  for (const s of [1, -1]) p.push(sp(ball(0.11, 7, 5), fur, { bone: 'hips', at: [s * 0.1, 0.44, -0.2], scale: [0.7, 1.05, 1.15] }));
  // neck + collar with a tag
  p.push(sp(ball(0.125, 7, 5), fur, { bone: 'neck', at: [0, 0.58, 0.29], scale: [1, 1.1, 1] }));
  p.push(sp(ball(0.1, 7, 5), cream, { bone: 'neck', at: [0, 0.54, 0.34], scale: [1, 1.05, 0.8] }));
  p.push(sp(new THREE.TorusGeometry(0.12, 0.032, 6, 12), PAL.red, { bone: 'neck', at: [0, 0.56, 0.3], rot: [Math.PI / 2 - 0.55, 0, 0] }));
  p.push(sp(new THREE.TorusGeometry(0.014, 0.005, 3, 6), PAL.metal, { bone: 'tag', at: [0, 0.495, 0.365], rot: [0, 0, 0] }));
  p.push(sp(cyl(0.032, 0.032, 0.012, 8), PAL.yellow, { bone: 'tag', at: [0, 0.462, 0.37], rot: [Math.PI / 2, 0, 0] }));
  p.push(sp(box(0.02, 0.004, 0.004), 0xb07a1a, { bone: 'tag', at: [0, 0.462, 0.378] }));
  // head: round skull, cream cheeks + muzzle, brows, nose with a highlight, mouth, tongue
  const H = { bone: 'head' };
  p.push(sp(ball(0.16, 9, 7), fur, { ...H, at: [0, 0.715, 0.37], scale: [1.08, 0.95, 0.96] }));
  for (const s of [1, -1]) p.push(sp(ball(0.078, 7, 5), cream, { ...H, at: [s * 0.078, 0.648, 0.45], scale: [1, 0.85, 0.95] }));
  p.push(sp(ball(0.08, 8, 5), cream, { ...H, at: [0, 0.655, 0.515], scale: [0.95, 0.72, 1.15] }));
  p.push(sp(ball(0.052, 7, 5), fur, { ...H, at: [0, 0.715, 0.5], scale: [0.9, 0.75, 1.2] })); // stop between the eyes
  p.push(sp(ball(0.03, 7, 5), ink, { ...H, at: [0, 0.683, 0.598], scale: [1.35, 0.95, 0.95] }));
  p.push(sp(ball(0.011, 4, 3), 0xffffff, { ...H, at: [0.012, 0.697, 0.622] }));
  p.push(sp(box(0.006, 0.03, 0.006), ink, { ...H, at: [0, 0.645, 0.588] }));
  p.push(sp(box(0.05, 0.007, 0.007), ink, { ...H, at: [0, 0.628, 0.575], rot: [0, 0, 0] }));
  for (const s of [1, -1]) p.push(sp(ball(0.017, 5, 4), cream, { ...H, at: [s * 0.058, 0.79, 0.49], scale: [1.4, 0.8, 0.6] }));
  p.push(sp(box(0.05, 0.012, 0.075), pink, { bone: 'tongue', at: [0, 0.615, 0.58], rot: [0.5, 0, 0] }));
  p.push(sp(box(0.004, 0.013, 0.05), 0xd06a7a, { bone: 'tongue', at: [0, 0.618, 0.585], rot: [0.5, 0, 0] }));
  // eyes (blink by scaling), happy "∩" eyes (shown when petted)
  for (const [s, e, h] of [[1, 'eyeL', 'happyL'], [-1, 'eyeR', 'happyR']] as const) {
    p.push(sp(ball(0.029, 7, 5), ink, { bone: e, at: [s * 0.068, 0.725, 0.5], scale: [0.95, 1.2, 0.65] }));
    p.push(sp(ball(0.0095, 4, 3), 0xffffff, { bone: e, at: [s * 0.068 + 0.01, 0.738, 0.517] }));
    p.push(sp(arc(0.024, 0.0075), ink, { bone: h, at: [s * 0.068, 0.716, 0.508], rot: [-0.25, s * 0.35, 0] }));
  }
  // ears: pointy, a warm inner
  for (const [s, e] of [[1, 'earL'], [-1, 'earR']] as const) {
    p.push(sp(cone(0.072, 0.155, 4), fur, { bone: e, at: [s * 0.095, 0.865, 0.33], rot: [0.12, Math.PI / 4, -s * 0.28], scale: [1, 1, 0.55] }));
    p.push(sp(cone(0.045, 0.1, 4), earIn, { bone: e, at: [s * 0.093, 0.85, 0.352], rot: [0.12, Math.PI / 4, -s * 0.28], scale: [1, 1, 0.4] }));
  }
  // curled fluffy tail: orange outside, cream inside the curl
  const tr = [0.068, 0.075, 0.068, 0.052];
  for (let i = 0; i < 4; i++) {
    const y = [0.575, 0.645, 0.715, 0.775][i];
    p.push(sp(ball(tr[i], 7, 5), fur, { bone: `tail${i}`, at: [0, y, -0.325], scale: [0.95, 1.05, 1] }));
    p.push(sp(ball(tr[i] * 0.72, 6, 4), cream, { bone: `tail${i}`, at: [0, y, -0.29], scale: [0.9, 1, 0.8] }));
  }
  p.push(sp(ball(0.03, 5, 4), cream, { bone: 'tail3', at: [0, 0.825, -0.315] }));
  // legs: fur uppers, cream socks, round paws with dark pads
  const leg = (pre: string, x: number, z: number, hind: boolean) => {
    p.push(sp(cyl(0.056, 0.047, 0.2, 7), fur, { bone: `${pre}0`, at: [x, 0.33, z] }));
    p.push(sp(ball(0.05, 6, 4), hind ? fur : cream, { bone: `${pre}1`, at: [x, 0.235, z] }));
    p.push(sp(cyl(0.045, 0.04, 0.18, 7), cream, { bone: `${pre}1`, at: [x, 0.15, z] }));
    p.push(sp(ball(0.052, 7, 5), cream, { bone: `${pre}2`, at: [x, 0.032, z + 0.022], scale: [1, 0.62, 1.3] }));
    p.push(sp(ball(0.026, 5, 3), pad, { bone: `${pre}2`, at: [x, 0.006, z + 0.012], scale: [1.2, 0.35, 1] }));
    for (const t of [-1, 0, 1]) p.push(sp(ball(0.011, 4, 3), pad, { bone: `${pre}2`, at: [x + t * 0.022, 0.006, z + 0.058 - Math.abs(t) * 0.008], scale: [1, 0.4, 1] }));
  };
  leg('lf', 0.1, 0.22, false); leg('rf', -0.1, 0.22, false); leg('lh', 0.1, -0.22, true); leg('rh', -0.1, -0.22, true);
  const m = buildSkinned('dog', bones, p);
  const lf = (bones: [string, string, string], parent: 'hips' | 'chest', a: number, b: number, bend: number): LegDims => ({ bones, parent, a, b, h: 0.06, bend });
  return {
    ...m,
    dims: {
      kind: 'dog', standY: 0.425, restY: 0.44, scale: 1, belly: 0.19,
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
  const barrel = { bone: 'hips', blend: { to: 'chest', axis: 2 as const, from: -0.14, till: 0.14 } };
  p.push(sp(ball(0.118, 9, 7), fur, { ...barrel, at: [0, 0.265, -0.005], scale: [0.9, 0.9, 1.95] }));
  p.push(sp(ball(0.1, 7, 5), orange, { ...barrel, at: [0.025, 0.315, -0.07], scale: [0.95, 0.55, 1.2] }));
  p.push(sp(ball(0.07, 7, 5), char, { ...barrel, at: [-0.04, 0.31, 0.08], scale: [0.95, 0.6, 1.1] }));
  p.push(sp(ball(0.085, 7, 5), fur, { bone: 'chest', at: [0, 0.27, 0.16], scale: [0.95, 1.05, 0.9] }));
  for (const s of [1, -1]) p.push(sp(ball(0.07, 7, 5), s > 0 ? orange : fur, { bone: 'hips', at: [s * 0.055, 0.26, -0.15], scale: [0.7, 1.1, 1.15] }));
  p.push(sp(ball(0.075, 7, 5), fur, { bone: 'neck', at: [0, 0.33, 0.22], scale: [1, 1.1, 1] }));
  p.push(sp(new THREE.TorusGeometry(0.07, 0.014, 4, 12), 0x4fa3c9, { bone: 'neck', at: [0, 0.325, 0.225], rot: [Math.PI / 2 - 0.5, 0, 0] }));
  p.push(sp(ball(0.019, 6, 4), PAL.yellow, { bone: 'tag', at: [0, 0.27, 0.272] }));
  p.push(sp(box(0.022, 0.003, 0.003), 0x8a6a1a, { bone: 'tag', at: [0, 0.264, 0.289] }));
  // head: wide round face, small muzzle, whiskers, slit-pupil amber eyes
  const H = { bone: 'head' };
  p.push(sp(ball(0.1, 9, 7), fur, { ...H, at: [0, 0.415, 0.265], scale: [1.18, 0.98, 0.98] }));
  p.push(sp(ball(0.06, 7, 5), char, { ...H, at: [-0.05, 0.45, 0.255], scale: [1, 0.7, 1] }));
  for (const s of [1, -1]) p.push(sp(ball(0.042, 6, 4), 0xffffff, { ...H, at: [s * 0.024, 0.382, 0.335], scale: [1, 0.8, 0.85] }));
  p.push(sp(ball(0.024, 5, 4), 0xffffff, { ...H, at: [0, 0.37, 0.33] }));
  p.push(sp(cone(0.013, 0.014, 3), pink, { ...H, at: [0, 0.4, 0.36], rot: [Math.PI, 0, 0], scale: [1.3, 1, 0.8] }));
  for (const s of [1, -1]) for (const k of [-1, 0, 1]) {
    p.push(sp(box(0.1, 0.0055, 0.0055), 0xffffff, { ...H, at: [s * 0.1, 0.387 + k * 0.009, 0.33], rot: [0, s * 0.18, s * k * 0.16] }));
  }
  for (const [s, e, h] of [[1, 'eyeL', 'happyL'], [-1, 'eyeR', 'happyR']] as const) {
    p.push(sp(ball(0.026, 7, 5), iris, { bone: e, at: [s * 0.044, 0.425, 0.352], scale: [1, 1.12, 0.55] }));
    p.push(sp(box(0.009, 0.036, 0.01), ink, { bone: e, at: [s * 0.044, 0.425, 0.364] }));
    p.push(sp(ball(0.006, 4, 3), 0xffffff, { bone: e, at: [s * 0.044 + 0.008, 0.436, 0.367] }));
    p.push(sp(arc(0.02, 0.006), ink, { bone: h, at: [s * 0.044, 0.418, 0.358], rot: [-0.2, s * 0.3, 0] }));
  }
  p.push(sp(box(0.032, 0.008, 0.045), pink, { bone: 'tongue', at: [0, 0.362, 0.352], rot: [0.3, 0, 0] }));
  for (const [s, e] of [[1, 'earL'], [-1, 'earR']] as const) {
    p.push(sp(cone(0.05, 0.1, 4), s > 0 ? orange : char, { bone: e, at: [s * 0.064, 0.52, 0.255], rot: [0, Math.PI / 4, -s * 0.3], scale: [1, 1, 0.55] }));
    p.push(sp(cone(0.03, 0.065, 4), pink, { bone: e, at: [s * 0.062, 0.51, 0.27], rot: [0, Math.PI / 4, -s * 0.3], scale: [1, 1, 0.4] }));
  }
  // long tail, orange tip
  const tz = [-0.24, -0.325, -0.41, -0.49, -0.565, -0.63];
  for (let i = 0; i < 5; i++) {
    const r0 = 0.03 - i * 0.002, r1 = 0.03 - (i + 1) * 0.002, len = tz[i] - tz[i + 1];
    p.push(sp(cyl(r1, r0, len + 0.02, 6), i === 4 ? orange : i === 2 ? char : fur, { bone: `tail${i}`, at: [0, 0.3, (tz[i] + tz[i + 1]) / 2], rot: [Math.PI / 2, 0, 0] }));
    p.push(sp(ball(r0 * 1.05, 6, 4), i === 4 ? orange : i === 2 ? char : fur, { bone: `tail${i}`, at: [0, 0.3, tz[i]] }));
  }
  p.push(sp(ball(0.024, 6, 4), orange, { bone: 'tail4', at: [0, 0.3, -0.632] }));
  const leg = (pre: string, x: number, z: number, c: number) => {
    p.push(sp(cyl(0.033, 0.027, 0.125, 6), c, { bone: `${pre}0`, at: [x, 0.195, z] }));
    p.push(sp(ball(0.028, 5, 4), c, { bone: `${pre}1`, at: [x, 0.138, z] }));
    p.push(sp(cyl(0.026, 0.023, 0.11, 6), fur, { bone: `${pre}1`, at: [x, 0.085, z] }));
    p.push(sp(ball(0.03, 6, 4), fur, { bone: `${pre}2`, at: [x, 0.017, z + 0.012], scale: [1, 0.6, 1.3] }));
    p.push(sp(ball(0.015, 5, 3), pink, { bone: `${pre}2`, at: [x, 0.004, z + 0.008], scale: [1.2, 0.35, 1] }));
    for (const t of [-1, 1]) p.push(sp(ball(0.007, 4, 3), pink, { bone: `${pre}2`, at: [x + t * 0.011, 0.004, z + 0.035], scale: [1, 0.4, 1] }));
  };
  leg('lf', 0.052, 0.14, fur); leg('rf', -0.052, 0.14, fur); leg('lh', 0.055, -0.14, orange); leg('rh', -0.055, -0.14, fur);
  const m = buildSkinned('cat', bones, p);
  const lf = (bones: [string, string, string], parent: 'hips' | 'chest', a: number, b: number, bend: number): LegDims => ({ bones, parent, a, b, h: 0.03, bend });
  return {
    ...m,
    dims: {
      kind: 'cat', standY: 0.25, restY: 0.26, scale: 0.6, belly: 0.1,
      legs: [lf(['lf0', 'lf1', 'lf2'], 'chest', 0.112, 0.108, 1), lf(['rf0', 'rf1', 'rf2'], 'chest', 0.112, 0.108, 1),
        lf(['lh0', 'lh1', 'lh2'], 'hips', 0.115, 0.115, -1), lf(['rh0', 'rh1', 'rh2'], 'hips', 0.115, 0.115, -1)],
      neutral: [[0.052, 0.15], [-0.052, 0.15], [0.055, -0.14], [-0.055, -0.14]],
      tail: ['tail0', 'tail1', 'tail2', 'tail3', 'tail4'],
    },
  };
}
