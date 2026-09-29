/**
 * Clawd face parts (ART §5.3, DESIGN §6.1): every eye shape and mouth shape exists once per rig and the animator shows
 * one of each. Eyes 0.09 w × 0.17 h at x ±0.145, y +0.08 (body-centre relative), on the front face. Owner: CHR.
 */
import type * as THREE from 'three';
import { makeBuilder, limbScale, type RigPart } from './build.ts';

export const EYE_X = 0.145, EYE_Y = 0.08, FACE_Z = 0.243;
export const EYE_SHAPES = Object.freeze(['slot', 'arc', 'heart', 'star', 'swirl', 'diamond', 'round', 'closed'] as const);
export const MOUTH_SHAPES = Object.freeze(['smile', 'o', 'wobble', 'snore', 'grin', 'squiggle'] as const);
export type EyeShape = (typeof EYE_SHAPES)[number];
export type MouthShape = (typeof MOUTH_SHAPES)[number];

/** Every eye shape part of one eye (the extra `swirl2` / `pupil` accompany swirl / round). */
export type EyeShapes = Record<EyeShape | 'swirl2' | 'pupil', THREE.Object3D>;

export interface EyeRig {
  node: THREE.Object3D;
  side: -1 | 1;
  shapes: EyeShapes;
  glint: THREE.Object3D;
  brow: THREE.Object3D;
  blush: THREE.Object3D;
}

/** Mouth part nodes (`squiggle` has no part of its own). */
export interface MouthRig {
  node: THREE.Object3D;
  smile: THREE.Object3D;
  o: THREE.Object3D;
  snore: THREE.Object3D;
  grin: THREE.Object3D;
  wobbleA: THREE.Object3D;
  wobbleB: THREE.Object3D;
}

export interface FaceRig { eyes: EyeRig[]; mouth: MouthRig }

/** @param faceRoot  node at (0, bodyCentreY, 0) inside the squash node */
export function buildFace(faceRoot: THREE.Object3D, parts: RigPart[]): FaceRig {
  const { part, node } = makeBuilder(parts);
  const F = { group: 'face' };
  const eyes = ([-1, 1] as const).map((side): EyeRig => {
    const e = node(faceRoot, { p: [side * EYE_X, EYE_Y, FACE_Z], name: side < 0 ? 'eyeL' : 'eyeR' });
    const base = {
      slot: part(e, 'eye', 'ink', F),
      // [CHR fix r3] slot-footprint happy "^": 0.108 wide, ink stroke 0.032 (sides) – 0.035 (top), ≥ 0.03 m (§6.1)
      arc: part(e, 'arc', 'ink', { ...F, s: [0.038, 0.042, 0.05], p: [0, -0.012, 0] }),
      heart: part(e, 'heart', 'ink', { ...F, s: [0.13, 0.13, 0.1] }),
      star: part(e, 'star', 'ink', { ...F, s: [0.15, 0.15, 0.1], r: [0, 0, side * 0.2] }),
      swirl: part(e, 'ring', 'ink', { ...F, s: [0.042, 0.042, 0.05] }),
      swirl2: part(e, 'ring', 'ink', { ...F, s: [0.019, 0.019, 0.05] }),
      diamond: part(e, 'diamond', 'ink', { ...F, s: [0.13, 0.15, 0.1] }),
      round: part(e, 'sphere', 'paper', { ...F, s: [0.055, 0.055, 0.03] }),
      pupil: part(e, 'sphere', 'ink', { ...F, s: [0.03, 0.036, 0.02], p: [0, 0, 0.018] }),
    };
    const shapes: EyeShapes = { ...base, closed: base.slot }; // closed = slot squashed to a dash (animator)
    const glint = part(e, 'glint', 'paper', { ...F, s: 0.018, p: [-0.018, 0.045, 0.02] });
    parts[parts.length - 1].glintOf = e;
    const brow = part(faceRoot, 'limb', 'ink', { ...F, p: [side * EYE_X, EYE_Y + 0.13, FACE_Z], s: limbScale(0.012, 0.09), r: [0, 0, side * Math.PI / 2] });
    const blush = part(faceRoot, 'cyl', 'blush', { ...F, p: [side * 0.25, EYE_Y - 0.1, FACE_Z - 0.008], s: [0.05, 0.01, 0.034], r: [Math.PI / 2, 0, 0] });
    return { node: e, side, shapes, glint, brow, blush };
  });
  const m = node(faceRoot, { p: [0, EYE_Y - 0.14, FACE_Z + 0.004], name: 'mouth' });
  const mouth = {
    node: m,
    smile: part(m, 'arc', 'ink', { ...F, s: [0.04, 0.034, 0.04], r: [0, 0, Math.PI], p: [0, 0.016, 0] }), // 0.114 wide, stroke ≈ 0.03
    o: part(m, 'cyl', 'ink', { ...F, s: [0.024, 0.01, 0.03], r: [Math.PI / 2, 0, 0] }),
    snore: part(m, 'ring', 'ink', { ...F, s: [0.016, 0.016, 0.03] }),
    grin: part(m, 'halfdisc', 'ink', { ...F, s: [0.085, 0.085, 0.08], p: [0, 0.01, 0] }),
    wobbleA: part(m, 'arc', 'ink', { ...F, s: [0.017, 0.016, 0.035], p: [-0.018, 0, 0] }),
    wobbleB: part(m, 'arc', 'ink', { ...F, s: [0.017, 0.016, 0.035], p: [0.018, 0.0, 0], r: [0, 0, Math.PI] }),
  };
  return { eyes, mouth };
}
