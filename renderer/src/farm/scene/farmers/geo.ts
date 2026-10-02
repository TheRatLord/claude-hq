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
    case 'sack': {
      // a burlap seed sack hanging from its tied neck: open top, seeds (produce colour) showing
      const BUR = 0xc9a46a, BUR_D = 0x9c7a46;
      B(0, -0.03, 0.05, 0.05, 0.06, 0.05, BUR_D); // gathered neck in the nub
      B(0, -0.2, 0.06, 0.26, 0.24, 0.2, BUR);
      B(0, -0.31, 0.06, 0.28, 0.06, 0.22, BUR_D); // bottom seam
      B(0, -0.075, 0.06, 0.22, 0.03, 0.16, BUR_D); // rolled rim
      B(0, -0.07, 0.06, 0.17, 0.02, 0.11, 0xffffff, 1); // seeds in the mouth
      B(-0.04, -0.055, 0.04, 0.05, 0.03, 0.05, 0xffffff, 1);
      B(0.05, -0.055, 0.08, 0.04, 0.03, 0.04, 0xffffff, 1);
      B(-0.06, -0.2, 0.162, 0.06, 0.06, 0.012, 0x6e8a3a); // a stitched patch
      break;
    }
    case 'marshmallow':
      // a toasting stick with a marshmallow, golden on top (the campfire)
      B(0, 0, 0.34, 0.022, 0.022, 0.7, 0xc9a26a);
      B(0, 0, 0.74, 0.09, 0.09, 0.1, 0xf6efe2);
      B(0, 0.035, 0.74, 0.075, 0.03, 0.085, 0xd9a35a);
      break;
    case 'fiddle': {
      // a fiddle under the chin (left nub), neck forward, the bow resting across the strings
      const F = 0xa8552c, F_D = 0x6e3418;
      B(0, 0, 0.06, 0.2, 0.06, 0.14, F); // lower bout
      B(0, 0, 0.17, 0.13, 0.06, 0.08, F); // waist
      B(0, 0, 0.25, 0.18, 0.06, 0.1, F); // upper bout
      B(0, 0.033, 0.13, 0.05, 0.012, 0.05, 0x2a1a12); // chinrest / tailpiece
      B(0, 0.01, 0.42, 0.045, 0.04, 0.24, F_D); // neck
      B(0, 0.025, 0.56, 0.05, 0.07, 0.05, F_D); // scroll
      B(0, 0.036, 0.3, 0.03, 0.006, 0.5, 0xeeeeee); // strings
      B(-0.12, 0.07, 0.2, 0.62, 0.016, 0.016, 0x5a3a20); // bow stick
      B(-0.12, 0.055, 0.2, 0.58, 0.008, 0.024, 0xf2ecd8); // bow hair
      break;
    }
    case 'banjo': {
      // a banjo across the body: the drum at the strumming nub, the neck up to the left
      const RIM = 0x8a6a48, HEAD = 0xf2e8d0;
      B(0.08, 0, -0.012, 0.36, 0.26, 0.05, RIM);
      B(0.08, 0, -0.012, 0.26, 0.36, 0.05, RIM);
      B(0.08, 0, 0.004, 0.3, 0.22, 0.04, HEAD);
      B(0.08, 0, 0.004, 0.22, 0.3, 0.04, HEAD);
      B(0.08, -0.04, 0.03, 0.05, 0.03, 0.012, 0x3a2f28); // bridge
      for (let i = 0; i < 6; i++) B(0.26 + i * 0.075, 0.05 + i * 0.045, 0.004, 0.085, 0.045, 0.04, WOOD); // neck, stair-stepped
      B(0.72, 0.34, 0.004, 0.09, 0.11, 0.05, WOOD_D); // peghead
      break;
    }
    case 'flute':
      // a silver flute along the lips, out to the right
      B(-0.14, 0, 0, 0.6, 0.036, 0.036, 0xc9cfd6);
      B(0.14, 0, 0, 0.05, 0.044, 0.044, 0x9aa3ad); // head joint cap
      for (let i = 0; i < 5; i++) B(-0.06 - i * 0.07, 0.02, 0, 0.022, 0.008, 0.022, METAL_D);
      B(0.07, 0.02, 0, 0.03, 0.008, 0.02, 0x2a2a30); // embouchure hole
      break;
    case 'pigeon': case 'pigeonup': case 'pigeondown': {
      // a carrier pigeon standing on the nub (feet at y 0, facing +z), a letter in its beak
      const G = 0xa9b2c2, G_D = 0x7d8798, NECK = 0x6fa58f, WHITE = 0xf4f2ee;
      B(0, 0.1, -0.01, 0.12, 0.11, 0.19, G); // body
      B(0, 0.07, 0.03, 0.1, 0.06, 0.1, WHITE); // pale breast
      B(0, 0.08, -0.13, 0.08, 0.03, 0.09, G_D); // tail
      B(0, 0.19, 0.07, 0.085, 0.08, 0.085, G); // head
      B(0, 0.15, 0.065, 0.095, 0.035, 0.095, NECK); // iridescent neck band
      for (const x of [-0.044, 0.044]) B(x, 0.205, 0.095, 0.006, 0.02, 0.02, 0x1d1a18); // eyes
      B(0, 0.18, 0.125, 0.03, 0.022, 0.035, 0xe7a23a); // beak
      B(0, 0.175, 0.16, 0.11, 0.07, 0.01, 0xf8f0dc); // the letter
      B(0.02, 0.175, 0.166, 0.03, 0.03, 0.006, 0xd9453b); // its seal
      for (const x of [-0.03, 0.03]) B(x, 0.02, 0.0, 0.02, 0.04, 0.02, 0xd06a5a); // legs
      if (p === 'pigeon') for (const x of [-0.066, 0.066]) B(x, 0.11, -0.03, 0.02, 0.08, 0.15, G_D); // folded wings
      else {
        const up = p === 'pigeonup';
        for (const sx of [-1, 1]) {
          B(sx * 0.12, up ? 0.19 : 0.08, -0.01, 0.13, 0.025, 0.13, G_D);
          B(sx * 0.215, up ? 0.26 : 0.04, -0.02, 0.09, 0.02, 0.1, WHITE);
        }
      }
      break;
    }
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
