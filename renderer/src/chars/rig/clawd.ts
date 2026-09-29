/**
 * Clawd rig (ART §5.2 as amended by DESIGN §6.1/§6.2): the Claude Code mascot as a clay toy. A pure-math Object3D tree
 * that is NEVER added to the scene, plus a `parts` list charBatch turns into instances. Characters are modelled
 * facing +z, so actors set `root.rotation.y = yaw + π` (§7). `createRig` also builds Shelly for `kind === 'shell'`.
 *
 * root ─ hips (y 0.16: bob, lean, twist) ─┬─ leg ×4 (lift, swing)
 *                                          └─ squash (volume-preserving scale) ─ body block, face, arms, sockets
 * Owner: CHR.
 */
import * as THREE from 'three';
import { BODY_H } from '../render/geometry.ts';
import { makeBuilder, node, limbScale, type RigPart, type PartFn } from './build.ts';
import { buildFace, type FaceRig } from './face.ts';
import { buildAccessory, ACC_TOP, BARE_TOP, type Dyn } from './accessories.ts';
import { buildProps, CLAWD_PROPS, type Prop } from './props.ts';
import { buildGear, type GearRig } from './gear.ts';
import { buildMini, MAX_MINIS, type MiniRig } from './mini.ts';
import { createShellyRig, type ShellyRig } from './shelly.ts';
import { personality, type Personality } from '../anim/personality.ts';
import type { Kind } from '../../../../shared/protocol.ts';

/** Fields both rigs share (see `Rig` in clawd.ts). */
export interface RigBase {
  root: THREE.Object3D;
  parts: RigPart[];
  /** entity kind ('claude'|'codex'|'gemini'|'agent'|'shell'|…) */
  kind: string;
  /** standing height in metres (no accessory) */
  height: number;
  pers: Personality;
  /** prop groups */
  props: Record<string, Prop>;
  /** accessory spring descriptors (animator) */
  dyn: Dyn[];
  accessory: { index: number; cycle: number } | null;
  setAccessory: (index: number, cycle?: number) => void;
  /** bumps when parts change (charBatch re-reads) */
  version: number;
  /** > 0 while a fast action wants stop-motion smears (charBatch reads it) */
  smear: number;
  /** bumped by the animator on every re-pose (LOD cadence; charBatch reuses the cached instance data between poses) */
  poseSerial?: number;
}

export interface ClawdNodes {
  hips: THREE.Object3D;
  squash: THREE.Object3D;
  shape: THREE.Object3D;
  body: THREE.Object3D;
  faceRoot: THREE.Object3D;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  propRoot: THREE.Object3D;
  accRoot: THREE.Object3D;
  blob: THREE.Object3D;
}

/** One Clawd noodle arm: pivot → elbow → a chain of forearm `joints` (each with a stretchable `segs` holder) → hand. */
export interface ClawdArm {
  pivot: THREE.Object3D;
  elbow: THREE.Object3D;
  /** the first forearm joint */
  fore: THREE.Object3D;
  joints: THREE.Object3D[];
  segs: THREE.Object3D[];
  hand: THREE.Object3D;
  side: -1 | 1;
}

/** The arrival crate (walls hinge outward, two lid flaps). */
export interface CrateRig {
  root: THREE.Object3D;
  walls: THREE.Object3D[];
  lids: THREE.Object3D[];
}

export interface ClawdRig extends RigBase {
  species: 'clawd';
  face: FaceRig;
  gear: GearRig;
  minis: MiniRig[];
  /** crown height: the accessory top (shape frame) */
  crown: number;
  nodes: ClawdNodes;
  /** [CHR M3.5] arrival crate (crateUnwrap), hidden unless a reaction shows it */
  crate: CrateRig;
  legs: THREE.Object3D[];
  arms: ClawdArm[];
}

export type Rig = ClawdRig | ShellyRig;

export interface RigOptions {
  kind: string;
  seedKey?: string;
  colorIndex?: number;
  cycle?: number;
  pers?: Partial<Personality>;
}

export const LEG_H = 0.16;
export const ARM_Y = 0.29, ARM_X = 0.345;
export const UPPER_L = 0.075, FORE_L = 0.065, HAND_R = 0.058;
/** Noodle forearm segments and their radii (a slight taper toward the mitten hand). */
export const FORE_SEGS = 4, FORE_R = Object.freeze([0.048, 0.045, 0.042, 0.039]);
/** Leg pivots (x, z): outer pair forward, inner pair back so all four read from the front, like the mascot. */
export const LEGS = Object.freeze([[-0.24, 0.07], [0.24, 0.07], [-0.1, -0.08], [0.1, -0.08]]);

export function createRig(o: RigOptions & { kind: 'shell' }): ShellyRig;
export function createRig(o: RigOptions & { kind: Exclude<Kind, 'shell'> }): ClawdRig;
export function createRig(o: RigOptions): Rig;
export function createRig(o: RigOptions): Rig {
  if (o.kind === 'shell') return createShellyRig(o);
  return createClawdRig(o);
}

export function createClawdRig({ kind, seedKey = '', colorIndex, cycle = 0, pers: persOverride }: RigOptions): ClawdRig {
  const pers = personality(seedKey, persOverride);
  const parts: RigPart[] = [];
  const { part } = makeBuilder(parts);
  const root = new THREE.Object3D();
  root.name = 'rig';
  const hips = node(root, { name: 'hips', p: [0, LEG_H, 0], order: 'YXZ' });
  const legs = LEGS.map(([x, z], i) => {
    const pivot = node(hips, { name: `leg${i}`, p: [x, 0.02, z] });
    part(pivot, 'limb', 'bodyDeep', { hull: true, shadow: true, s: limbScale(0.058, LEG_H + 0.02) });
    return pivot;
  });
  const squash = node(hips, { name: 'squash' });
  const shape = node(squash, { name: 'shape', s: [1 + pers.width, 1 + pers.height, 1 + pers.width * 0.5] });
  const body = part(shape, 'body', 'body', { hull: true, shadow: true, name: 'body' });
  const faceRoot = node(shape, { name: 'face', p: [0, BODY_H / 2, 0] });
  const face = buildFace(faceRoot, parts);
  const arms = ([-1, 1] as const).map((side): ClawdArm => {
    const pivot = node(shape, { name: side < 0 ? 'armL' : 'armR', p: [side * ARM_X, ARM_Y, 0], order: 'XYZ' });
    part(pivot, 'limb', 'body', { hull: true, shadow: true, s: limbScale(0.05, UPPER_L + 0.02), p: [0, 0.01, 0] });
    const elbow = node(pivot, { p: [0, -UPPER_L, 0] });
    // [CHR fix m15-r2] The noodle forearm is a chain of FORE_SEGS tapered segments: each joint curls (the animator's
    // lag / overshoot and the pose's curl channel) and each segment holder stretches along y with the noodle length,
    // so a long "hey!" arm bends like a noodle instead of reading as a rigid rod.
    const joints: THREE.Object3D[] = [], segs: THREE.Object3D[] = [];
    let parent = elbow;
    for (let k = 0; k < FORE_SEGS; k++) {
      const j = node(parent, { p: [0, k ? -FORE_L / FORE_SEGS : 0, 0], order: 'XYZ' });
      const sg = node(j, {});
      // Each capsule but the last runs on to the middle of the next one: stretched capsules taper at both ends, and
      // the overlap hides those tapers, so the noodle reads as one smooth tube instead of a string of sausages.
      part(sg, 'limb', 'body', { hull: true, shadow: true, s: limbScale(FORE_R[k], ((k < FORE_SEGS - 1 ? 2 : 1) * FORE_L) / FORE_SEGS) });
      joints.push(j); segs.push(sg);
      parent = j;
    }
    const hand = node(parent, { p: [0, -FORE_L / FORE_SEGS, 0] });
    part(hand, 'sphere', 'body', { hull: true, shadow: true, s: HAND_R });
    return { pivot, elbow, fore: joints[0], joints, segs, hand, side };
  });
  // Props live in the body ("shape") frame, origin at the body's bottom centre, the same frame ik.reach() uses.
  const propRoot = node(shape, { name: 'propRoot' });
  const props = buildProps(propRoot, parts, Math.floor(pers.seed), CLAWD_PROPS);
  const gear = buildGear(shape, parts);
  const minis: MiniRig[] = [];
  for (let i = 0; i < MAX_MINIS; i++) minis.push(buildMini(root, parts, i));
  // Kind decorations: unknown agents carry a little "?" antenna (ART §5.2).
  if (kind !== 'claude' && kind !== 'codex' && kind !== 'gemini') {
    const q = node(shape, { p: [-0.2, BODY_H, 0.02], r: [0, 0, 0.2] });
    part(q, 'limb', 'ink', { shadow: true, s: limbScale(0.012, 0.1), r: [Math.PI, 0, 0] });
    const g = node(q, { p: [0, 0.14, 0] });
    part(g, 'ring', 'ink', { s: [0.03, 0.03, 0.04], r: [0, 0, -0.9] });
    part(g, 'sphere', 'ink', { s: 0.012, p: [0, -0.055, 0] });
  }
  const blob = part(root, 'blob', 'ink', { p: [0, 0.004, 0], s: [0.46, 1, 0.34] });
  const crate = buildCrate(root, part);
  const accRoot = node(shape, { name: 'acc' });
  const baseParts = parts.length;

  const rig: ClawdRig = {
    root, parts, kind, species: 'clawd', height: LEG_H + BODY_H, pers, face, props, gear, minis, dyn: [], accessory: null, version: 0, crown: BARE_TOP,
    legs, arms,
    smear: 0, // > 0 while a fast action wants stop-motion smears (charBatch reads it)
    nodes: { hips, squash, shape, body, faceRoot, armL: arms[0].pivot, armR: arms[1].pivot, propRoot, accRoot, blob },
    crate, // [CHR M3.5] arrival crate (crateUnwrap), hidden unless a reaction shows it
    setAccessory(index, cyc = 0) {
      if (rig.accessory && rig.accessory.index === index && rig.accessory.cycle === cyc) return;
      parts.length = baseParts;
      accRoot.clear();
      rig.dyn = buildAccessory(index, cyc, accRoot, parts);
      rig.accessory = { index, cycle: cyc };
      rig.crown = ACC_TOP[((index % 8) + 8) % 8];
      rig.version++;
    },
  };
  if (colorIndex !== undefined && colorIndex !== null) rig.setAccessory(colorIndex % 8, cycle);
  return rig;
}

/** [CHR M3.5] Arrival crate footprint (m): walls hinge outward at the base; two lid flaps ride the side walls. */
export const CRATE = Object.freeze({ w: 0.8, d: 0.64, h: 0.64, t: 0.035 });
const KRAFT = '#C9A27A', KRAFT_DEEP = '#A9805A';

/**
 * Root-level crate (not under the hips, so it stays on the floor while the Clawd hops out). Hidden by default; the
 * animator shows it from the pose's crate channels. All parts reuse existing instanced types (rbox, torus, sphere).
 */
function buildCrate(root: THREE.Object3D, part: PartFn): CrateRig {
  const { w, d, h, t } = CRATE;
  const cr = node(root, { name: 'crate' });
  cr.visible = false;
  const P = { hull: true, shadow: true, group: 'prop' }, S = { hull: false, shadow: false, group: 'prop' };
  part(cr, 'rbox', KRAFT_DEEP, { ...P, p: [0, t / 2, 0], s: [w, t, d] });
  // Each wall: a base node (position + yaw so its local +z points out of the crate) → a tilt hinge (rotation.x > 0
  // tips it outward) → the parts. The ribbon runs down the outside face.
  const wall = (x: number, z: number, yaw: number, width: number) => {
    const base = node(cr, { p: [x, t, z], r: [0, yaw, 0] });
    const tilt = node(base, {});
    part(tilt, 'rbox', KRAFT, { ...P, p: [0, h / 2, -t / 2], s: [width, h, t] });
    part(tilt, 'rbox', KRAFT_DEEP, { ...S, p: [0, h - 0.03, -t / 2 + 0.003], s: [width + 0.004, 0.05, t + 0.006] });
    part(tilt, 'rbox', 'workspace', { ...S, p: [0, h / 2, -t / 2 + 0.004], s: [0.09, h - 0.02, t + 0.004] });
    return tilt;
  };
  const front = wall(0, d / 2, 0, w), back = wall(0, -d / 2, Math.PI, w);
  const left = wall(-w / 2, 0, -Math.PI / 2, d - 0.002), right = wall(w / 2, 0, Math.PI / 2, d - 0.002);
  // lid flaps: hinged on the side walls' top edges, each covering half the top (spanning local −z, into the crate)
  const flap = (wallTilt: THREE.Object3D) => {
    const hn = node(wallTilt, { p: [0, h, -t] });
    part(hn, 'rbox', KRAFT, { ...P, p: [0, t / 2, -w / 4], s: [d - 0.01, t, w / 2 - 0.004] });
    part(hn, 'rbox', 'workspace', { ...S, p: [0, t / 2 + 0.004, -w / 4], s: [0.09, t + 0.002, w / 2 - 0.004] });
    return hn;
  };
  const lidL = flap(left), lidR = flap(right);
  // a bow in the workspace colour where the flaps meet
  const bow = node(lidL, { p: [0, t + 0.02, -w / 2 + 0.035] });
  part(bow, 'torus', 'workspace', { ...P, s: [0.055, 0.06, 0.055], r: [Math.PI / 2, 0.6, 0], p: [0, 0.02, 0.045] });
  part(bow, 'torus', 'workspace', { ...P, s: [0.055, 0.06, 0.055], r: [Math.PI / 2, -0.6, 0], p: [0, 0.02, -0.045] });
  part(bow, 'sphere', 'workspace', { ...S, s: 0.03, p: [0, 0.02, 0] });
  return { root: cr, walls: [front, back, left, right], lids: [lidL, lidR] };
}
