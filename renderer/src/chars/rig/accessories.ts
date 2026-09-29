/**
 * Workspace accessories (ART §5.4, DESIGN §5.5/§6.1): type = colorIndex % 8, colour = workspace colour, every accessory
 * carries a paper/cream trim (≥ 12 % of its projected area); `cycle > 0` adds trim stripes. Each accessory returns
 * spring "dyn" descriptors the animator drives (pompom, tips, propeller, brim, scarf tail, ribbons). Owner: CHR.
 */
import type * as THREE from 'three';
import { makeBuilder, limbScale, type RigPart } from './build.ts';
import type { SpringName } from '../anim/springs.ts';

export const ACCESSORIES = Object.freeze(['beanie', 'headphones', 'cone', 'propeller', 'bucket', 'scarf', 'bow', 'antenna'] as const);

/** Spring descriptor the animator drives (pompom / tips, propeller, brim, scarf tail, ribbons). */
export type TipDyn = { kind: 'tip'; node: THREE.Object3D; preset?: SpringName; gain?: number };
export type Dyn =
  | TipDyn
  | { kind: 'spin'; node: THREE.Object3D; rate: number }
  | { kind: 'brim'; node: THREE.Object3D }
  | { kind: 'chain'; nodes: THREE.Object3D[] };

const TOP = 0.548; // body top surface (body-local, squash frame)

/**
 * [CHR fix m15-r1] Crown height per accessory: the highest point of body + accessory in the shape frame (origin at the
 * body's bottom centre, neutral personality). Poses that must clear the head (the blocked "hey!" wave) reach above it;
 * anim.test.ts checks the table against the built geometry.
 */
export const ACC_TOP = Object.freeze([0.886, 0.699, 0.93, 0.77, 0.685, 0.545, 0.786, 0.787]);
/** Crown with no accessory (the pillowed body top). */
export const BARE_TOP = 0.545;

/**
 * @param index 0..7 (colorIndex % 8)
 * @param cycle 0 = plain, > 0 = trim stripes
 * @param top node at the body's bottom-centre inside the squash node
 */
export function buildAccessory(index: number, cycle: number, top: THREE.Object3D, parts: RigPart[]): Dyn[] {
  const { part, node } = makeBuilder(parts);
  const W = 'workspace', T = 'trim';
  const A = { hull: true, shadow: true, group: 'acc' };
  const a = { ...A, hull: false }; // small trim bits: no hull (keeps the trim reading as a clean band)
  const dyn: Dyn[] = [];
  const stripe = cycle > 0;
  switch (ACCESSORIES[((index % 8) + 8) % 8]) {
    case 'beanie': {
      const root = node(top, { p: [0, TOP - 0.01, -0.02] });
      part(root, 'dome', W, { ...A, s: [0.21, 0.25, 0.19] });
      part(root, 'torus', T, { ...A, p: [0, 0.025, 0], s: [0.215, 0.3, 0.195] });
      if (stripe) part(root, 'torus', T, { ...a, p: [0, 0.13, 0], s: [0.172, 0.14, 0.155] });
      const tip = node(root, { p: [0, 0.24, 0] });
      part(tip, 'sphere', T, { ...A, p: [0, 0.05, 0], s: 0.058 });
      dyn.push({ kind: 'tip', node: tip, preset: 'jiggle', gain: 0.06 });
      break;
    }
    case 'headphones': {
      const flex = node(top, { p: [0, 0.36, 0] });
      part(flex, 'band', W, { ...A, s: [0.4, 0.3, 0.55] });
      part(flex, 'band', T, { ...a, p: [0, 0.012, 0], s: [0.4, 0.3, 0.28] });
      for (const side of [-1, 1]) {
        part(flex, 'cyl', W, { ...A, p: [side * 0.405, 0.03, 0], s: [0.125, 0.075, 0.125], r: [0, 0, Math.PI / 2] });
        part(flex, 'cyl', T, { ...a, p: [side * 0.448, 0.03, 0], s: [0.07, 0.02, 0.07], r: [0, 0, Math.PI / 2] });
        if (stripe) part(flex, 'torus', T, { ...a, p: [side * 0.43, 0.02, 0], s: [0.07, 0.1, 0.07], r: [0, 0, Math.PI / 2] });
      }
      dyn.push({ kind: 'brim', node: flex });
      break;
    }
    case 'cone': {
      const root = node(top, { p: [0.08, TOP - 0.01, -0.03], r: [0, 0, -0.18] });
      part(root, 'cone', W, { ...A, s: [0.14, 0.32, 0.14] });
      part(root, 'torus', T, { ...A, p: [0, 0.015, 0], s: [0.14, 0.2, 0.14] });
      if (stripe) { part(root, 'torus', T, { ...a, p: [0, 0.12, 0], s: [0.088, 0.12, 0.088] }); part(root, 'torus', T, { ...a, p: [0, 0.21, 0], s: [0.047, 0.1, 0.047] }); }
      const tip = node(root, { p: [0, 0.31, 0] });
      part(tip, 'sphere', T, { ...A, p: [0, 0.035, 0], s: 0.045 });
      dyn.push({ kind: 'tip', node: tip, preset: 'jiggle', gain: 0.08 });
      break;
    }
    case 'propeller': {
      const root = node(top, { p: [0, TOP - 0.01, -0.03] });
      part(root, 'dome', W, { ...A, s: [0.21, 0.15, 0.19] });
      part(root, 'cyl', W, { ...A, p: [0, 0.008, 0.14], s: [0.17, 0.022, 0.12] });
      part(root, 'cyl', T, { ...a, p: [0, 0.004, 0.155], s: [0.175, 0.012, 0.115] });
      if (stripe) part(root, 'torus', T, { ...a, p: [0, 0.06, 0], s: [0.19, 0.14, 0.17] });
      part(root, 'limb', T, { ...a, p: [0, 0.21, 0], s: limbScale(0.012, 0.07) });
      const spin = node(root, { p: [0, 0.2, 0] });
      part(spin, 'sphere', T, { ...A, s: 0.032 });
      part(spin, 'rbox', W, { ...A, p: [0.1, 0, 0], s: [0.17, 0.012, 0.05], r: [0.25, 0, 0] });
      part(spin, 'rbox', W, { ...A, p: [-0.1, 0, 0], s: [0.17, 0.012, 0.05], r: [-0.25, 0, 0] });
      dyn.push({ kind: 'spin', node: spin, rate: 1 });
      break;
    }
    case 'bucket': {
      const brim = node(top, { p: [0, TOP + 0.002, -0.02] });
      part(brim, 'cyl', W, { ...A, s: [0.3, 0.022, 0.275] });
      part(brim, 'cyl', W, { ...A, p: [0, 0.07, 0], s: [0.19, 0.13, 0.175] });
      part(brim, 'cyl', T, { ...a, p: [0, 0.035, 0], s: [0.195, 0.04, 0.18] });
      if (stripe) part(brim, 'cyl', T, { ...a, p: [0, 0.1, 0], s: [0.192, 0.025, 0.177] });
      dyn.push({ kind: 'brim', node: brim });
      break;
    }
    case 'scarf': {
      const root = node(top, { p: [0, 0.1, 0] });
      part(root, 'torus', W, { ...A, s: [0.378, 0.24, 0.248] });
      if (stripe) part(root, 'torus', T, { ...a, p: [0, 0.0, 0], s: [0.388, 0.12, 0.258] });
      const k = node(root, { p: [0.22, 0.01, 0.25] });
      part(k, 'sphere', W, { ...A, s: [0.06, 0.05, 0.04] });
      const chain: THREE.Object3D[] = [];
      let parent = k;
      for (let i = 0; i < 3; i++) {
        const seg = node(parent, { p: [0, i ? -0.055 : -0.01, 0.01] });
        part(seg, 'limb', i === 2 ? T : W, { ...A, s: [0.07, 0.03, 0.03] });
        chain.push(seg);
        parent = seg;
      }
      part(parent, 'rbox', T, { ...a, p: [0, -0.055, 0], s: [0.07, 0.012, 0.028] });
      dyn.push({ kind: 'chain', nodes: chain });
      break;
    }
    case 'bow': {
      const root = node(top, { p: [0.13, TOP + 0.045, 0.02], r: [0, 0, -0.25], s: 1.6 });
      for (const side of [-1, 1]) {
        part(root, 'sphere', W, { ...A, p: [side * 0.075, 0.015, 0], s: [0.075, 0.055, 0.04], r: [0, 0, side * 0.35] });
        if (stripe) part(root, 'sphere', T, { ...a, p: [side * 0.08, 0.016, 0.008], s: [0.05, 0.022, 0.036], r: [0, 0, side * 0.35] });
      }
      part(root, 'sphere', T, { ...A, s: [0.036, 0.034, 0.034] });
      for (const side of [-1, 1]) {
        const r = node(root, { p: [side * 0.015, -0.01, -0.01], r: [0, 0, side * 0.5] });
        part(r, 'limb', W, { ...A, s: [0.036, 0.03, 0.02] });
        dyn.push({ kind: 'tip', node: r, preset: 'bouncy', gain: 0.05 });
      }
      break;
    }
    case 'antenna': {
      const root = node(top, { p: [0, TOP - 0.005, -0.04] });
      part(root, 'cyl', T, { ...A, s: [0.28, 0.03, 0.05] });
      for (const side of [-1, 1]) {
        const base = node(root, { p: [side * 0.13, 0.01, 0], r: [0, 0, -side * 0.28] });
        const stalk = node(base, {});
        part(stalk, 'limb', W, { ...A, s: [0.026, 0.085, 0.026], r: [Math.PI, 0, 0] });
        const bob = node(stalk, { p: [0, 0.18, 0] });
        part(bob, 'sphere', W, { ...A, s: 0.048 });
        part(bob, 'torus', T, { ...a, s: [0.05, 0.12, 0.05], r: [0.35, 0, 0] });
        if (stripe) part(bob, 'torus', T, { ...a, s: [0.05, 0.12, 0.05], r: [-0.35, 0, Math.PI / 2] });
        dyn.push({ kind: 'tip', node: stalk, preset: 'bouncy', gain: 0.09 });
      }
      break;
    }
  }
  return dyn;
}
