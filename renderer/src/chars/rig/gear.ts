/**
 * Data-driven Clawd gear (DESIGN §6.7 signal vocabulary), all built once per rig and toggled by the animator from
 * `animator.setTraits()`:
 *   backpack   context 50k / 100k / 150k → small / medium / overstuffed (papers poking out); a jiggle spring on its strap
 *   lanyard    model tier emblem on a badge (opus gold star, sonnet cream circle, haiku mint leaf); swings on a spring
 *   struggle   level 1: static-frizz tufts; level ≥ 2: + scribble eye-bags + an orbit of crossed-out paper balls
 *   sweat      context ≥ 180k: drops slide down the temples
 * Owner: CHR.
 */
import type * as THREE from 'three';
import { makeBuilder, limbScale, type RigPart } from './build.ts';
import { BODY_W, BODY_H, BODY_D } from '../render/geometry.ts';
import { EYE_X, EYE_Y, FACE_Z } from './face.ts';

export type TierEmblem = 'star' | 'circle' | 'leaf';

/** Model tier → lanyard emblem (any other tier: none). */
export const TIER_EMBLEM: Readonly<Record<string, TierEmblem>> = Object.freeze({ opus: 'star', sonnet: 'circle', haiku: 'leaf' });

/** The gear nodes the animator toggles from `setTraits()`. */
export interface GearRig {
  packPivot: THREE.Object3D;
  pack: THREE.Object3D;
  papers: THREE.Object3D[];
  badge: THREE.Object3D;
  badgePivot: THREE.Object3D;
  lan: THREE.Object3D;
  emblems: Record<TierEmblem | 'circleRing', THREE.Object3D>;
  tuftRoot: THREE.Object3D;
  tufts: THREE.Object3D[];
  bags: THREE.Object3D[];
  orbit: THREE.Object3D;
  balls: THREE.Object3D[];
  drops: THREE.Object3D[];
}

/** @param shape  the body-shape node (origin at the body's bottom centre) */
export function buildGear(shape: THREE.Object3D, parts: RigPart[]): GearRig {
  const { part, node } = makeBuilder(parts);
  const H = { hull: true, shadow: true, group: 'gear' };
  const s = { hull: false, shadow: false, group: 'gear' };
  const zBack = -BODY_D / 2;

  // ---- backpack: one bag scaled per size; papers only when overstuffed --------------------------------------------
  const packPivot = node(shape, { name: 'pack', p: [0, BODY_H * 0.86, zBack + 0.01] });
  const pack = node(packPivot, {});
  const bag = node(pack, { p: [0, -0.2, -0.08] });
  part(bag, 'rbox', '#6E8E6A', { ...H, s: [0.36, 0.3, 0.16] });
  part(bag, 'rbox', '#5F7D5B', { ...H, p: [0, 0.13, -0.005], s: [0.37, 0.09, 0.175] });
  part(bag, 'rbox', 'trim', { ...s, p: [0, -0.04, -0.082], s: [0.18, 0.11, 0.02] });
  part(bag, 'cyl', 'ink2', { ...s, p: [0, 0.1, -0.095], s: [0.018, 0.01, 0.018], r: [Math.PI / 2, 0, 0] });
  const papers = [0, 1, 2].map((i) => {
    const n = node(bag, { p: [-0.09 + i * 0.09, 0.16, 0.01], r: [0.1 * (i - 1), 0, (i - 1) * 0.35] });
    part(n, 'rbox', 'trim', { ...s, p: [0, 0.06, 0], s: [0.09, 0.14, 0.006] });
    part(n, 'limb', 'ink2', { ...s, p: [-0.015, 0.09, -0.005], s: [0.006, 0.025, 0.006], r: [0, 0, Math.PI / 2] });
    return n;
  });
  // shoulder straps over the top edge
  for (const side of [-1, 1]) part(pack, 'rbox', '#5F7D5B', { ...s, p: [side * 0.2, 0.02, 0.1], s: [0.05, 0.02, 0.22] });

  // ---- lanyard + badge: a name-tag badge clipped low on the front left (clear of the eyes, blush and mouth), its cord
  // running over the left edge; swings on a spring from the clip ----------------------------------------------------
  const lan = node(shape, { name: 'lanyard', p: [-0.2, 0.2, FACE_Z + 0.004] });
  // [CHR fix m15-r1] The cord was a thin round capsule that read as a stylus in the hand (review m15-r1): it is now a
  // flat two-tone ribbon lying on the body, running to the left edge and wrapping round the side like a real strap.
  const rib = node(lan, { p: [-0.07, 0.07, -0.002], r: [0, 0, 0.785] });
  part(rib, 'rbox', 'workspace', { ...s, s: [0.03, 0.2, 0.006] });
  part(rib, 'rbox', 'trim', { ...s, p: [0, 0, 0.003], s: [0.008, 0.19, 0.004] });
  const wrap = node(lan, { p: [-BODY_W / 2 + 0.196, 0.13, -0.094], r: [0, Math.PI / 2, 0.3] });
  part(wrap, 'rbox', 'workspace', { ...s, s: [0.17, 0.03, 0.006] });
  part(lan, 'rbox', 'ink2', { ...s, p: [0, -0.012, 0.004], s: [0.026, 0.018, 0.012] });
  const badgePivot = node(lan, { p: [0, -0.014, 0.006] });
  const badge = node(badgePivot, { p: [0, -0.058, 0] });
  part(badge, 'rbox', 'workspace', { ...H, s: [0.105, 0.125, 0.014] });
  part(badge, 'rbox', 'trim', { ...s, p: [0, -0.01, 0.006], s: [0.086, 0.086, 0.008] });
  const emblems = {
    star: part(badge, 'star', '#E8B84A', { ...s, p: [0, -0.01, 0.013], s: [0.08, 0.08, 0.04] }),
    circle: part(badge, 'cyl', '#D9C9A8', { ...s, p: [0, -0.01, 0.012], s: [0.028, 0.01, 0.028], r: [Math.PI / 2, 0, 0] }),
    circleRing: part(badge, 'torus', 'ink2', { ...s, p: [0, -0.01, 0.013], s: [0.03, 0.05, 0.03], r: [Math.PI / 2, 0, 0] }),
    leaf: part(badge, 'diamond', '#7FC99A', { ...s, p: [0, -0.01, 0.013], s: [0.08, 0.08, 0.04], r: [0, 0, 0.6] }),
  };

  // ---- struggle: frizz tufts, eye-bags, orbiting crossed-out paper balls ----------------------------------------
  const tuftRoot = node(shape, { name: 'tufts', p: [0, BODY_H - 0.005, 0.02] });
  const tufts: THREE.Object3D[] = [];
  const TUFTS = [[-0.33, 0.14, -0.7], [-0.33, -0.1, -0.9], [-0.27, 0.2, -0.3], [0.27, 0.2, 0.3], [0.33, 0.14, 0.7], [0.33, -0.1, 0.9], [0.0, 0.22, 0.05]] as const;
  for (const [x, z, a] of TUFTS) {
    const n = node(tuftRoot, { p: [x, 0, z - 0.02], r: [0, 0, a] });
    part(n, 'limb', 'ink2', { ...s, s: limbScale(0.013, 0.065), r: [Math.PI, 0, 0] });
    const kink = node(n, { p: [0, 0.07, 0], r: [0, 0, 1.1] });
    part(kink, 'limb', 'ink2', { ...s, s: limbScale(0.012, 0.045), r: [Math.PI, 0, 0] });
    const kink2 = node(kink, { p: [0, 0.048, 0], r: [0, 0, -1.2] });
    part(kink2, 'limb', 'ink2', { ...s, s: limbScale(0.011, 0.035), r: [Math.PI, 0, 0] });
    tufts.push(n);
  }
  const bags = [-1, 1].map((side) => part(shape, 'arc', 'ink2', { ...s, group: 'face', p: [side * EYE_X, BODY_H / 2 + EYE_Y - 0.115, FACE_Z + 0.004], s: [0.03, 0.02, 0.02], r: [0, 0, Math.PI] }));
  const orbit = node(shape, { name: 'orbit', p: [0, BODY_H + 0.12, 0] });
  const balls = [0, 1, 2].map((i) => {
    const n = node(orbit, {});
    part(n, 'sphere', 'trim', { ...H, s: [0.04, 0.036, 0.038] });
    part(n, 'limb', 'ink', { ...s, p: [-0.02, 0.022, 0.03], s: limbScale(0.006, 0.02), r: [0, 0, 0.8] });
    part(n, 'limb', 'ink', { ...s, p: [0.02, 0.022, 0.03], s: limbScale(0.006, 0.02), r: [0, 0, -0.8] });
    return n;
  });

  // ---- sweat drops at the temples ------------------------------------------------------------------------------
  const drops = [-1, 1].map((side) => {
    const n = node(shape, { p: [side * (BODY_W / 2 - 0.02), BODY_H * 0.75, FACE_Z - 0.05] });
    part(n, 'sphere', '#A9D6EA', { ...s, s: [0.022, 0.03, 0.02] });
    part(n, 'cone', '#A9D6EA', { ...s, p: [0, 0.022, 0], s: [0.017, 0.03, 0.015] });
    return n;
  });

  return { packPivot, pack, papers, badge, badgePivot, lan, emblems, tuftRoot, tufts, bags, orbit, balls, drops };
}
