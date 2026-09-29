/**
 * Shelly rig (ART §5.6, DESIGN §6.1/§6.7): a little retro CRT terminal robot on one wheel, ≈ 0.75 m. Clearly not a
 * Claude: tall boxy beige CRT head (with the tube bulge at the back) on an accordion spring neck, a round base pod
 * over a single wheel, a whippy antenna with a status bulb, and two noodly cable arms with mitten claws mounted on the
 * sides of the CRT (so it can juggle, knit and read the paper in front of its own face). The face is phosphor glyph
 * strokes on a bulged screen (">_" with a blinking cursor, spinner, "^_^", "x_x", "-_-", "<3", …). Faces +z.
 *
 * root ─ wheel (rolls about x)
 *      └ hips (y 0.15: lean, bob) ─ base pod, fork, chest plate (workspace)
 *          └ neck0 ─ neck1 (spring lag) ─ head ─┬ shape (squash) ─ CRT, bezel, screen, glyphs, knobs, antenna
 *                                              └ armL / armR (pivot → elbow → fore → hand) · propRoot
 * Owner: CHR.
 */
import * as THREE from 'three';
import { makeBuilder, node, limbScale, type RigPart } from './build.ts';
import { personality } from '../anim/personality.ts';
import { buildProps, SHELLY_PROPS } from './props.ts';
import type { RigBase, RigOptions } from './clawd.ts';
import type { TipDyn } from './accessories.ts';
import { SHELLY_ARM } from '../anim/ik.ts';

export const SHELLY_BEIGE = '#E6DCC6';
export const WHEEL_R = 0.075;
export const SCREEN_W = 0.29, SCREEN_H = 0.21;
export const MAX_STROKES = 12;
export { SHELLY_ARM };
export const HIP_Y = 0.15, NECK_SEG = 0.07, HEAD_Y0 = 0.05;
const HEAD_CY = 0.16; // CRT centre above the head node
/** [CHR fix m15-r1] Shelly's activity props are 1.6× so they read from the ENG bench at 4–5 m (anim/activities/shelly.ts). */
export const SHELLY_PROP_SCALE = 1.6;

/** One of Shelly's cable arms (head frame). */
export interface ShellyArm {
  pivot: THREE.Object3D;
  elbow: THREE.Object3D;
  fore: THREE.Object3D;
  hand: THREE.Object3D;
  fingers: THREE.Object3D[];
  side: -1 | 1;
}

export interface ShellyNodes {
  hips: THREE.Object3D;
  head: THREE.Object3D;
  shape: THREE.Object3D;
  wheel: THREE.Object3D;
  screen: THREE.Object3D;
  glyphRoot: THREE.Object3D;
  plate: THREE.Object3D;
  bulb: THREE.Object3D;
  propRoot: THREE.Object3D;
}

export interface ShellyRig extends RigBase {
  species: 'shelly';
  /** the antenna tip */
  dyn: [TipDyn];
  face: null;
  nodes: ShellyNodes;
  neck: THREE.Object3D[];
  arms: ShellyArm[];
  knobs: THREE.Object3D[];
  strokes: THREE.Object3D[];
  bulbPart: RigPart | undefined;
  ledPart: RigPart | undefined;
  strokeParts: RigPart[];
}

export function createShellyRig({ kind = 'shell', seedKey = '', colorIndex, cycle = 0, pers: persOverride }: RigOptions): ShellyRig {
  const pers = personality(seedKey, persOverride);
  const parts: RigPart[] = [];
  const { part } = makeBuilder(parts);
  const root = new THREE.Object3D();
  root.name = 'rig';
  const H = { hull: true, shadow: true };
  const d = { hull: false, shadow: false };
  const METAL = '#8A847A';

  // Wheel: a chunky tyre, a hub and a workspace-coloured hubcap dot so the roll reads.
  const wheel = node(root, { name: 'wheel', p: [0, WHEEL_R, 0] });
  part(wheel, 'torus', 'ink2', { ...H, s: [WHEEL_R * 0.8, WHEEL_R * 1.1, WHEEL_R * 0.8], r: [0, 0, Math.PI / 2] });
  part(wheel, 'cyl', METAL, { shadow: true, s: [WHEEL_R * 0.66, 0.06, WHEEL_R * 0.66], r: [0, 0, Math.PI / 2] });
  for (const side of [-1, 1]) part(wheel, 'cyl', 'workspace', { ...d, p: [side * 0.032, 0.03, 0], s: [0.014, 0.006, 0.014], r: [0, 0, Math.PI / 2] });

  // Hips: base pod over the wheel + fork plates + chest plate.
  const hips = node(root, { name: 'hips', p: [0, HIP_Y, 0], order: 'YXZ' });
  for (const side of [-1, 1]) part(hips, 'rbox', 'ink2', { ...H, p: [side * 0.055, -0.045, 0], s: [0.022, 0.1, 0.07] });
  part(hips, 'cyl', SHELLY_BEIGE, { ...H, p: [0, 0.04, 0], s: [0.13, 0.1, 0.12] });
  part(hips, 'torus', 'ink2', { ...d, p: [0, 0.0, 0], s: [0.13, 0.12, 0.12] });
  const plate = part(hips, 'rbox', 'workspace', { ...d, p: [0, 0.045, 0.112], s: [0.1, 0.05, 0.02], r: [-0.1, 0, 0] });
  part(hips, 'cyl', 'ink2', { ...d, p: [0, 0.095, 0], s: [0.06, 0.02, 0.06] });

  // Accordion spring neck: two lagging segments with bellows rings.
  const neck: THREE.Object3D[] = [];
  let parent = hips;
  for (let i = 0; i < 2; i++) {
    const seg = node(parent, { name: `neck${i}`, p: [0, i ? NECK_SEG : 0.1, 0] });
    part(seg, 'limb', 'ink2', { ...H, s: limbScale(0.028, NECK_SEG), r: [Math.PI, 0, 0] });
    part(seg, 'torus', 'ink2', { ...d, p: [0, NECK_SEG * 0.5, 0], s: [0.04, 0.18, 0.04] });
    neck.push(seg);
    parent = seg;
  }
  const head = node(parent, { name: 'head', p: [0, NECK_SEG + HEAD_Y0 - 0.035, 0] });
  const shape = node(head, { name: 'shape' });
  // CRT: front box + tapered tube bulge at the back + bezel + bulged glass.
  part(shape, 'rbox', SHELLY_BEIGE, { ...H, p: [0, HEAD_CY, 0.02], s: [0.42, 0.32, 0.26] });
  part(shape, 'rbox', SHELLY_BEIGE, { ...H, p: [0, HEAD_CY + 0.005, -0.13], s: [0.32, 0.25, 0.14] });
  part(shape, 'rbox', '#D4C8AE', { ...d, p: [0, HEAD_CY + 0.01, -0.2], s: [0.2, 0.15, 0.04] });
  part(shape, 'rbox', 'ink2', { shadow: false, p: [0, HEAD_CY, 0.143], s: [0.35, 0.27, 0.03] });
  const screen = part(shape, 'screen', '#16211B', { p: [0, HEAD_CY, 0.158], s: [SCREEN_W, SCREEN_H, 0.15], emissive: 1 });
  // Chin ledge with a power LED + little feet of the CRT case.
  part(shape, 'rbox', '#D4C8AE', { ...d, p: [0, HEAD_CY - 0.15, 0.13], s: [0.3, 0.03, 0.04] });
  const led = part(shape, 'glint', '#7FE3A0', { p: [0.12, HEAD_CY - 0.15, 0.152], s: 0.009, emissive: 1.4 });
  // Side knobs (right) + speaker grille (left).
  const knobs = [0.1, 0.2].map((y) => {
    const k = node(shape, { p: [0.215, y + 0.02, 0.04] });
    part(k, 'cyl', 'ink2', { shadow: true, s: [0.03, 0.03, 0.03], r: [0, 0, Math.PI / 2] });
    part(k, 'rbox', 'trim', { ...d, p: [0.016, 0, 0.012], s: [0.008, 0.012, 0.03] });
    return k;
  });
  for (let i = 0; i < 3; i++) part(shape, 'rbox', 'ink2', { ...d, p: [-0.211, 0.12 + i * 0.045, 0.0], s: [0.01, 0.014, 0.16] });
  // Antenna on a spring with a status bulb.
  const ant = node(shape, { name: 'antenna', p: [0.11, HEAD_CY + 0.16, -0.03], r: [0, 0, -0.18] });
  part(ant, 'cyl', 'ink2', { ...d, s: [0.022, 0.02, 0.022] });
  part(ant, 'limb', 'ink2', { shadow: true, s: limbScale(0.011, 0.15), r: [Math.PI, 0, 0] });
  const bob = node(ant, { p: [0, 0.165, 0] });
  const bulb = part(bob, 'glint', '#7FE3A0', { s: 0.03, emissive: 1.4 });
  // Glyph strokes on the screen (phosphor). The animator writes them per face.
  const glyphRoot = node(shape, { name: 'glyphs', p: [0, HEAD_CY, 0.171] });
  const strokes: THREE.Object3D[] = [];
  for (let i = 0; i < MAX_STROKES; i++) strokes.push(part(glyphRoot, 'stroke', 'phosphor', { emissive: 1.4 }));
  // Cable arms: upper → elbow → noodle fore → mitten claw (two fingers that open/close).
  const arms = ([-1, 1] as const).map((side): ShellyArm => {
    const pivot = node(head, { name: side < 0 ? 'armL' : 'armR', p: [side * SHELLY_ARM.x, SHELLY_ARM.y, 0.0], order: 'XYZ' });
    part(pivot, 'sphere', 'ink2', { ...H, s: 0.026 });
    part(pivot, 'limb', 'ink2', { ...H, s: limbScale(0.017, SHELLY_ARM.upper) });
    const elbow = node(pivot, { p: [0, -SHELLY_ARM.upper, 0] });
    const fore = node(elbow, {});
    part(fore, 'limb', 'ink2', { ...H, s: limbScale(0.016, SHELLY_ARM.fore) });
    const hand = node(elbow, { p: [0, -SHELLY_ARM.fore, 0] });
    part(hand, 'sphere', METAL, { ...H, s: 0.026 });
    const fingers = [-1, 1].map((fs) => {
      const fn = node(hand, { p: [fs * 0.012, -0.012, 0] });
      part(fn, 'rbox', METAL, { ...H, p: [0, -0.02, 0], s: [0.018, 0.045, 0.026] });
      return fn;
    });
    return { pivot, elbow, fore, hand, fingers, side };
  });
  const propRoot = node(head, { name: 'propRoot' });
  const props = buildProps(propRoot, parts, Math.floor(pers.seed), SHELLY_PROPS, SHELLY_PROP_SCALE);
  part(root, 'blob', 'ink', { p: [0, 0.004, 0], s: [0.3, 1, 0.26] });

  return {
    root, parts, kind, species: 'shelly', height: 0.75, pers, face: null, props, smear: 0,
    dyn: [{ kind: 'tip', node: ant, preset: 'bouncy', gain: 0.12 }], accessory: null, version: 0,
    nodes: { hips, head, shape, wheel, screen, glyphRoot, plate, bulb, propRoot },
    neck, arms, knobs, strokes, bulbPart: parts.find((p) => p.node === bulb), ledPart: parts.find((p) => p.node === led),
    strokeParts: parts.filter((p) => p.type === 'stroke' && p.node.parent === glyphRoot),
    setAccessory() { /* Shelly shows the workspace on its chest plate only */ },
  };
}
