/**
 * Segfault's rig: a low-poly clay cat built from the shared character part kit (chars/render/geometry.ts) so it draws
 * inside charBatch's instanced meshes (no extra draw calls, same toon shading + ink hull as the agents). A pure-math
 * Object3D tree, modelled facing +z, origin on the floor between the paws. No nameplate, no ring (§6.7 ambient row).
 * Owner: AMB.
 */
import * as THREE from 'three';
import { makeBuilder, node, limbScale } from '../../chars/rig/build.ts';
import type { RigPart } from '../../chars/rig/build.ts';
import { CORE, ENV, MISC } from '../../../../shared/palette.ts';

/** Colours: a smoky blue-grey tabby with cream socks / chest / tail tip (reads apart from every agent body hue). */
export const CAT_COL = Object.freeze({
  fur: '#5F6673', stripe: '#434852', cream: MISC.trim, pink: '#E39A9A', nose: '#D9787C', collar: ENV.teal, tag: ENV.butter,
  heart: '#E0707C', ink: CORE.ink,
});
export const CAT_LEG = 0.1;
export const TAIL_SEGS = 6;

/** The cat's named nodes (`n`): what cat.ts poses each frame. */
export interface CatNodes {
  blob: THREE.Object3D;
  hips: THREE.Object3D;
  torso: THREE.Object3D;
  /** front-left, front-right, back-left, back-right */
  legs: THREE.Object3D[];
  neck: THREE.Object3D;
  head: THREE.Object3D;
  /** left, right */
  ears: THREE.Object3D[];
  eyes: THREE.Object3D[];
  /** closed-eye arcs (hidden until sleep / purr) */
  shut: THREE.Object3D[];
  /** TAIL_SEGS chained segments from the rump */
  tail: THREE.Object3D[];
  tailBase: THREE.Object3D;
  hearts: THREE.Object3D[];
}

/** The rig shape charBatch registers (same fields as the character rigs it batches). */
export interface CatRig {
  root: THREE.Object3D;
  parts: RigPart[];
  species: string;
  kind: string;
  pers: { seed: number };
  version: number;
  smear: number;
  accessory: { index: number; cycle: number };
  setAccessory: () => void;
  n: CatNodes;
}

export function createCatRig(): CatRig {
  const parts: RigPart[] = [];
  const { part } = makeBuilder(parts);
  const C = CAT_COL;
  const root = new THREE.Object3D();
  root.name = 'cat';
  const blob = part(root, 'blob', 'ink', { p: [0, 0.004, 0], s: [0.24, 1, 0.34] });
  const hips = node(root, { name: 'hips', p: [0, CAT_LEG, 0], order: 'YXZ' });
  // body: a soft bean, three tabby stripes arcing over the back, cream chest
  const torso = node(hips, { name: 'torso', p: [0, 0.06, 0] });
  part(torso, 'sphere', C.fur, { hull: true, shadow: true, s: [0.118, 0.1, 0.19] });
  for (let i = 0; i < 3; i++) {
    const z = -0.085 + i * 0.06, k = Math.sqrt(1 - (z / 0.19) ** 2);
    part(torso, 'band', C.stripe, { s: [0.118 * k + 0.003, 0.1 * k + 0.003, 0.3], p: [0, 0, z] }); // ∩ arcs over the back
  }
  part(torso, 'sphere', C.cream, { hull: false, s: [0.075, 0.075, 0.07], p: [0, -0.015, 0.125] });
  // legs (pivots on the hips): front pair forward, cream socks
  const legs = [[-0.062, 0.115], [0.062, 0.115], [-0.066, -0.11], [0.066, -0.11]].map(([x, z], i) => {
    const pv = node(hips, { name: `leg${i}`, p: [x, 0.03, z], order: 'XYZ' });
    part(pv, 'limb', C.fur, { hull: true, shadow: true, s: limbScale(0.03, CAT_LEG + 0.03) });
    const paw = node(pv, { p: [0, -(CAT_LEG + 0.025), 0.012] });
    part(paw, 'sphere', i < 2 ? C.cream : C.fur, { hull: true, s: [0.034, 0.022, 0.042] });
    return pv;
  });
  // neck → head
  const neck = node(hips, { name: 'neck', p: [0, 0.1, 0.15], order: 'YXZ' });
  const head = node(neck, { name: 'head', p: [0, 0.045, 0.02], order: 'YXZ' });
  part(head, 'sphere', C.fur, { hull: true, shadow: true, s: [0.108, 0.09, 0.092] });
  part(head, 'sphere', C.fur, { hull: false, s: [0.06, 0.05, 0.05], p: [-0.055, -0.03, 0.03] }); // cheeks
  part(head, 'sphere', C.fur, { hull: false, s: [0.06, 0.05, 0.05], p: [0.055, -0.03, 0.03] });
  part(head, 'sphere', C.cream, { hull: false, s: [0.05, 0.034, 0.034], p: [0, -0.034, 0.066] }); // muzzle
  part(head, 'sphere', C.nose, { s: [0.015, 0.011, 0.01], p: [0, -0.014, 0.096] });
  const ears = [-1, 1].map((s) => {
    const e = node(head, { name: s < 0 ? 'earL' : 'earR', p: [s * 0.058, 0.05, -0.008], r: [0, 0, -s * 0.32], order: 'ZXY' });
    part(e, 'cone', C.fur, { hull: true, s: [0.04, 0.07, 0.026] });
    part(e, 'cone', C.pink, { s: [0.024, 0.048, 0.01], p: [0, 0.006, 0.014] });
    return e;
  });
  // eyes: ink slot eyes like the agents (big, cute), a light glint; closed-eye arcs for sleep / purr
  const eyes = [-1, 1].map((s) => {
    const e = node(head, { p: [s * 0.042, 0.004, 0.08], r: [0, s * 0.3, 0] });
    part(e, 'eye', C.ink, { s: [0.36, 0.3, 0.5], group: 'face' });
    part(e, 'sphere', MISC.trim, { s: [0.0065, 0.0065, 0.004], p: [s * -0.004, 0.012, 0.01], group: 'face' });
    return e;
  });
  const shut = [-1, 1].map((s) => {
    const e = node(head, { p: [s * 0.042, 0.0, 0.086], r: [0, s * 0.3, 0] });
    part(e, 'band', C.ink, { s: [0.019, 0.017, 0.03], group: 'face' });
    e.visible = false;
    return e;
  });
  // whiskers
  for (const s of [-1, 1]) for (let k = 0; k < 2; k++) {
    const w = node(head, { p: [s * 0.03, -0.03 - k * 0.012, 0.085], r: [0, -s * 0.25, s * (Math.PI / 2 + 0.12 - k * 0.24)] });
    part(w, 'limb', C.ink, { s: limbScale(0.0035, 0.07), group: 'face' });
  }
  // collar + tag
  const collar = node(neck, { p: [0, 0.0, 0.0], r: [-0.95, 0, 0] });
  part(collar, 'torus', C.collar, { s: [0.066, 0.07, 0.06] });
  part(neck, 'sphere', C.tag, { s: 0.016, p: [0, -0.034, 0.05] });
  // tail: a chain of short segments from the rump; the last is cream
  const tail: THREE.Object3D[] = [];
  let parent = node(torso, { name: 'tail', p: [0, 0.02, -0.17], order: 'XYZ' });
  const tailBase = parent;
  for (let k = 0; k < TAIL_SEGS; k++) {
    const j = node(parent, { p: [0, k ? -0.056 : 0, 0], order: 'XYZ' });
    const r = 0.024 - k * 0.0018;
    part(j, 'limb', k === TAIL_SEGS - 1 ? C.cream : C.fur, { hull: true, shadow: k < 3, s: limbScale(r, 0.07) });
    tail.push(j); parent = j;
  }
  // hearts (purr), hidden until patted
  const hearts = [0, 1, 2].map(() => {
    const h = node(root, {});
    part(h, 'heart', C.heart, { s: 0.09 });
    h.visible = false;
    return h;
  });

  const rig: CatRig = {
    root, parts, species: 'cat', kind: 'cat', pers: { seed: 7 }, version: 0, smear: 0, accessory: { index: 0, cycle: 0 },
    setAccessory() {},
    n: { blob, hips, torso, legs, neck, head, ears, eyes, shut, tail, tailBase, hearts },
  };
  return rig;
}
