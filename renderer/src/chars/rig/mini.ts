/**
 * Mini-Clawds (ART §5.7, DESIGN §6.1/§6.7): active subagents (max 4) as 0.45× interns with no accessory and a little
 * cream sprout antenna. They are sub-rigs inside their parent's rig (children of the parent's root, so they share its
 * culling sphere and never become actors of their own); `anim/minis.ts` makes them pop in, bustle and follow.
 * Owner: CHR.
 */
import type * as THREE from 'three';
import { makeBuilder, limbScale, type RigPart } from './build.ts';
import { BODY_H } from '../render/geometry.ts';

export const MINI_SCALE = 0.45;
export const MAX_MINIS = 4;
const LEG_H = 0.16;

/** One mini's joints (anim/minis.ts poses them). */
export interface MiniRig {
  root: THREE.Object3D;
  hips: THREE.Object3D;
  legs: THREE.Object3D[];
  squash: THREE.Object3D;
  eyes: THREE.Object3D[];
  glints: THREE.Object3D[];
  arms: THREE.Object3D[];
  sprout: THREE.Object3D;
}

export function buildMini(parentRoot: THREE.Object3D, parts: RigPart[], i: number): MiniRig {
  const { part, node } = makeBuilder(parts);
  const root = node(parentRoot, { name: `mini${i}`, s: MINI_SCALE });
  root.visible = false;
  const hips = node(root, { p: [0, LEG_H, 0], order: 'YXZ' });
  const legs = ([[-0.22, 0.06], [0.22, 0.06], [-0.1, -0.08], [0.1, -0.08]] as const).map(([x, z]) => {
    const l = node(hips, { p: [x, 0.02, z] });
    part(l, 'limb', 'bodyDeep', { hull: true, shadow: true, s: limbScale(0.07, LEG_H + 0.02) });
    return l;
  });
  const squash = node(hips, {});
  part(squash, 'body', 'body', { hull: true, shadow: true });
  const eyes = [-1, 1].map((side) => part(squash, 'eye', 'ink', { group: 'face', p: [side * 0.15, BODY_H / 2 + 0.08, 0.243], s: [1.15, 1.15, 1] }));
  const glints = [-1, 1].map((side) => part(squash, 'sphere', 'paper', { group: 'face', p: [side * 0.15 - 0.015, BODY_H / 2 + 0.13, 0.262], s: [0.022, 0.022, 0.008] }));
  const arms = [-1, 1].map((side) => {
    const a = node(squash, { p: [side * 0.345, 0.29, 0], order: 'XYZ' });
    part(a, 'limb', 'body', { hull: true, shadow: true, s: limbScale(0.07, 0.13) });
    return a;
  });
  // sprout antenna: stalk + two leaves
  const sprout = node(squash, { p: [0.05, BODY_H - 0.01, 0] });
  part(sprout, 'limb', 'trim', { s: limbScale(0.024, 0.12), r: [Math.PI, 0, 0] });
  for (const side of [-1, 1]) part(sprout, 'sphere', 'trim', { p: [side * 0.05, 0.14, 0], s: [0.055, 0.025, 0.03], r: [0, 0, side * 0.5] });
  part(root, 'blob', 'ink', { p: [0, 0.01, 0], s: [0.46, 1, 0.34] });
  return { root, hips, legs, squash, eyes, glints, arms, sprout };
}
