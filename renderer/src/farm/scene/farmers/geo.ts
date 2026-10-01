/**
 * Mascot geometry, built once from the voxel designs in mascots.ts and instanced across every farmer. Each vertex
 * carries `vinfo` = (slot, vgroup, wob) for the rig material:
 *   slot   — 0 keeps the baked vertex colour; 1..3 take the instance palette colour A..C (× the vertex colour as shade)
 *   vgroup — 0 always drawn; k > 0 drawn only when the instance selects group k (glyph shapes, hats, props, the
 *            Gemini star), so one InstancedMesh draws every variant in a single call. Variant sets are kept tiny.
 *   wob    — how much a vertex follows the jiggle (Codex lobes, scarf tails)
 */
import * as THREE from 'three';
import {
  CLAWD, CODEX, DUCK, GLYPH_NAMES, HAT_NAMES, HAT_VOXEL, Vox, clawdBody, clawdLeg, codexBody, codexFoot, duckBody, duckEgg, duckFoot, duckHead,
  duckWing, glyph, hat, joinMeshes, ROLE_HAT_NAMES, roleHat, WEAR_NAMES, wear,
} from './mascots.ts';
import type { GlyphName, HatName, RoleHatName, VoxMesh, WearName } from './mascots.ts';
import { PROPS } from './pose.ts';
import type { Prop } from './pose.ts';

export function toGeometry(m: VoxMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(m.color, 3));
  const info = new Float32Array(m.count * 3);
  for (let i = 0; i < m.count; i++) { info[i * 3] = m.slot[i]; info[i * 3 + 1] = m.group[i]; info[i * 3 + 2] = m.wob[i]; }
  g.setAttribute('vinfo', new THREE.BufferAttribute(info, 3));
  g.computeBoundingSphere();
  return g;
}

const cache = new Map<string, THREE.BufferGeometry>();
const once = (k: string, f: () => THREE.BufferGeometry) => { let g = cache.get(k); if (!g) { g = f(); cache.set(k, g); } return g; };

export const clawdBodyGeometry = () => once('clawdBody', () => toGeometry(clawdBody().mesh(CLAWD.u)));
export const clawdLegGeometry = () => once('clawdLeg', () => toGeometry(clawdLeg().mesh(CLAWD.u)));
export const codexBodyGeometry = () => once('codexBody', () => toGeometry(codexBody().mesh(CODEX.u)));
export const codexFootGeometry = () => once('codexFoot', () => toGeometry(codexFoot().mesh(CODEX.u)));

/** A unit nub: x from 0 to 1 (pivot at the body side), y and z centred; the rig scales it per mascot. */
export const nubGeometry = () => once('nub', () => {
  const v = new Vox();
  v.jitter = 0;
  v.box(0.5, 0, 0, 1, 1, 1, 1, 0xffffff);
  v.box(0.97, 0, 0, 0.06, 0.94, 0.94, 1, 0xe2e2e2); // a slightly darker tip face
  return toGeometry(v.mesh(1));
});

/** Every glyph (vgroup = GLYPH_GROUP), unit cell size: the rig scales it to the mascot's glyph cell. */
export const GLYPH_GROUP = (g: GlyphName) => 1 + GLYPH_NAMES.indexOf(g);
export const glyphGeometry = () => once('glyphs', () => toGeometry(joinMeshes(GLYPH_NAMES.map((n) => glyph(n, GLYPH_GROUP(n)).mesh(1)))));

export const HAT_GROUP = (h: HatName) => 1 + HAT_NAMES.indexOf(h);
/** All hats in one geometry (the gallery's hat sheet). */
export const hatGeometry = () => once('hats', () => toGeometry(joinMeshes(HAT_NAMES.map((n) => hat(n, HAT_GROUP(n)).mesh(HAT_VOXEL)))));
/** One hat (vgroup 0): the crowd draws each hat as its own instanced mesh, so no farmer sends the three it isn't wearing. */
export const hatGeometryOf = (h: HatName) => once(`hat:${h}`, () => toGeometry(hat(h, 0).mesh(HAT_VOXEL)));

/** Villager role hats in one geometry (vgroup = ROLE_HAT_GROUP) and wear in another (vgroup = WEAR_GROUP). */
export const ROLE_HAT_GROUP = (h: RoleHatName) => 1 + ROLE_HAT_NAMES.indexOf(h);
export const roleHatGeometry = () => once('roleHats', () => toGeometry(joinMeshes(ROLE_HAT_NAMES.map((n) => roleHat(n, ROLE_HAT_GROUP(n)).mesh(HAT_VOXEL)))));
export const WEAR_GROUP = (w: WearName) => 1 + WEAR_NAMES.indexOf(w);
export const wearGeometry = () => once('wear', () => toGeometry(joinMeshes(WEAR_NAMES.map((n) => wear(n, WEAR_GROUP(n)).mesh(CLAWD.u)))));

// props -------------------------------------------------------------------------------------------------------------
// Authored in metres in grip space: origin = the nub tip, +z = forward, +y = up. Voxel-style boxes only.
// Slot 1 = produce colour (basket / crate contents), slot 3 = the workspace colour (bindle cloth).

const WOOD = 0xa0703f, WOOD_D = 0x6e4a2a, METAL = 0xaab4bd, METAL_D = 0x5a646e, STRAW = 0xd9b25a, CAN = 0x5aa9d6, CAN_D = 0x3f86b5;

export const PROP_GROUP = (p: Prop) => 1 + PROPS.indexOf(p);

function propVox(p: Prop, g: number): Vox {
  const v = new Vox();
  const B = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rgb: number, slot = 0) => v.box(cx, cy, cz, sx, sy, sz, slot, rgb, g);
  switch (p) {
    case 'trowel':
      B(0, 0, 0.04, 0.04, 0.04, 0.12, WOOD);
      B(0, 0, 0.11, 0.03, 0.03, 0.03, METAL_D);
      B(0, 0, 0.19, 0.08, 0.014, 0.13, METAL);
      B(0, 0, 0.27, 0.05, 0.014, 0.04, METAL);
      break;
    case 'hoe':
      B(0, 0, 0.26, 0.032, 0.032, 0.96, WOOD);
      B(0, -0.06, 0.74, 0.17, 0.12, 0.022, METAL_D);
      break;
    case 'can':
      B(0, 0.02, 0, 0.12, 0.025, 0.025, METAL_D); // handle through the nub
      B(0, -0.12, 0.02, 0.2, 0.18, 0.2, CAN);
      B(0, -0.035, 0.02, 0.21, 0.025, 0.21, CAN_D);
      for (let i = 0; i < 4; i++) B(0, -0.13 + i * 0.045, 0.14 + i * 0.045, 0.035, 0.035, 0.05, CAN); // spout, stair-stepped
      B(0, 0.05, 0.33, 0.07, 0.07, 0.03, CAN_D); // rose
      break;
    case 'crate':
      B(0, 0.12, 0, 0.44, 0.24, 0.34, WOOD);
      for (const y of [0.05, 0.19]) B(0, y, 0, 0.46, 0.035, 0.36, WOOD_D);
      for (let i = 0; i < 6; i++) B(-0.14 + (i % 3) * 0.14, 0.27, -0.07 + Math.floor(i / 3) * 0.14, 0.11, 0.09, 0.11, 0xffffff, 1);
      B(-0.07, 0.33, 0, 0.1, 0.08, 0.1, 0xf0f0f0, 1);
      break;
    case 'basket':
      B(0, -0.2, 0.03, 0.3, 0.14, 0.22, STRAW);
      B(0, -0.13, 0.03, 0.32, 0.03, 0.24, 0xb8914a);
      for (const x of [-0.13, 0.13]) B(x, -0.05, 0.03, 0.025, 0.14, 0.025, 0xb8914a);
      B(0, 0.02, 0.03, 0.29, 0.025, 0.025, 0xb8914a);
      for (let i = 0; i < 5; i++) B(-0.09 + (i % 3) * 0.09, -0.1 + (i > 2 ? 0.05 : 0), -0.02 + (i % 2) * 0.09, 0.09, 0.08, 0.09, 0xffffff, 1);
      break;
    case 'rod':
      B(0, 0, 0.62, 0.026, 0.026, 1.3, 0x8a5a3a);
      B(0, 0, 0.05, 0.04, 0.04, 0.12, WOOD_D);
      B(0, -0.38, 1.26, 0.006, 0.76, 0.006, 0xeeeeee);
      B(0, -0.78, 1.26, 0.05, 0.05, 0.05, 0xe0404a);
      break;
    case 'notebook':
      B(0, 0, 0.1, 0.2, 0.025, 0.26, 0x7a4a8a);
      B(0.005, 0.016, 0.1, 0.18, 0.012, 0.24, 0xf6f1e6);
      B(0.005, 0.024, 0.08, 0.12, 0.004, 0.012, 0x9a9aa8);
      B(0.005, 0.024, 0.12, 0.1, 0.004, 0.012, 0x9a9aa8);
      break;
    case 'magnifier':
      B(0, 0.04, 0.02, 0.035, 0.12, 0.035, WOOD_D);
      for (const [x, y, w, h] of [[0, 0.24, 0.17, 0.028], [0, 0.1, 0.17, 0.028], [-0.072, 0.17, 0.028, 0.15], [0.072, 0.17, 0.028, 0.15]] as const) B(x, y, 0.02, w, h, 0.03, 0xc9a24a);
      B(0, 0.17, 0.02, 0.12, 0.12, 0.012, 0xcfeeff);
      break;
    case 'hammer':
      B(0, 0, 0.13, 0.035, 0.035, 0.3, WOOD);
      B(0, 0.02, 0.29, 0.075, 0.18, 0.08, METAL_D);
      B(0, 0.1, 0.29, 0.06, 0.04, 0.06, METAL);
      break;
    case 'saw':
      B(0, 0, 0.02, 0.05, 0.1, 0.1, WOOD);
      B(0, -0.03, 0.3, 0.012, 0.13, 0.46, METAL);
      for (let i = 0; i < 6; i++) B(0, -0.1, 0.1 + i * 0.075, 0.012, 0.02, 0.03, METAL_D);
      break;
    case 'letter':
      B(0, 0.1, 0.04, 0.22, 0.15, 0.014, 0xf8f0dc);
      B(0, 0.12, 0.05, 0.2, 0.012, 0.012, 0xe8dcc0);
      B(0.04, 0.09, 0.052, 0.045, 0.045, 0.012, 0xd9453b);
      break;
    case 'bindle':
      B(0, 0, 0.38, 0.026, 0.026, 0.95, WOOD);
      B(0, -0.1, 0.82, 0.22, 0.2, 0.22, 0xffffff, 3);
      B(0, 0.01, 0.82, 0.08, 0.05, 0.08, 0xd8d8d8, 3);
      break;
    case 'broom':
      B(0, 0, 0.3, 0.03, 0.03, 0.85, WOOD);
      B(0, 0, 0.72, 0.18, 0.05, 0.05, 0xb8483a);
      B(0, 0, 0.84, 0.2, 0.06, 0.2, STRAW);
      break;
    case 'brush':
      B(0, 0.01, 0.07, 0.09, 0.05, 0.16, WOOD);
      B(0, -0.035, 0.07, 0.08, 0.04, 0.14, 0x3a2f28);
      break;
    case 'book':
      B(-0.075, 0.1, 0.04, 0.15, 0.2, 0.02, 0x4f7f4a);
      B(0.075, 0.1, 0.04, 0.15, 0.2, 0.02, 0x4f7f4a);
      B(-0.072, 0.1, 0.055, 0.13, 0.18, 0.012, 0xf6f1e6);
      B(0.072, 0.1, 0.055, 0.13, 0.18, 0.012, 0xf6f1e6);
      break;
    case 'lantern':
      // a hand lantern hanging from its bail (the light itself is a LightEmitter at the hand)
      B(0, 0.015, 0.03, 0.09, 0.02, 0.02, METAL_D);
      for (const x of [-0.05, 0.05]) B(x, -0.03, 0.03, 0.016, 0.09, 0.016, METAL_D);
      B(0, -0.08, 0.03, 0.15, 0.03, 0.15, METAL_D);
      B(0, -0.06, 0.03, 0.07, 0.03, 0.07, METAL);
      B(0, -0.165, 0.03, 0.12, 0.14, 0.12, 0xfff0b8);
      B(0, -0.165, 0.03, 0.06, 0.08, 0.06, 0xffffff);
      for (const [x, z] of [[-0.065, -0.035], [0.065, -0.035], [-0.065, 0.095], [0.065, 0.095]] as const) B(x, -0.165, z, 0.018, 0.15, 0.018, METAL_D);
      B(0, -0.25, 0.03, 0.15, 0.03, 0.15, METAL_D);
      break;
  }
  return v;
}

export const propGeometry = () => once('props', () => toGeometry(joinMeshes(PROPS.map((p) => propVox(p, PROP_GROUP(p)).mesh(1)))));

// ducklings ---------------------------------------------------------------------------------------------------------

export const duckBodyGeometry = () => once('duckBody', () => toGeometry(duckBody().mesh(DUCK.u)));
export const duckHeadGeometry = () => once('duckHead', () => toGeometry(duckHead().mesh(DUCK.u)));
export const duckWingGeometry = () => once('duckWing', () => toGeometry(duckWing().mesh(DUCK.u)));
export const duckFootGeometry = () => once('duckFoot', () => toGeometry(duckFoot().mesh(DUCK.u)));
export const eggGeometry = () => once('egg', () => toGeometry(duckEgg().mesh(DUCK.u)));
