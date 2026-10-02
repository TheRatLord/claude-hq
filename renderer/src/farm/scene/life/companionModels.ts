/**
 * The player's own pet (companion.ts): a puppy, a kitten or (rare) a fox kit, in a few coats. Each is ONE skinned mesh
 * on the same rig families as Biscuit (dog: puppy, fox kit) and Mochi (cat: kitten), so petBody.ts animates them with
 * the village pets' gait, poses and secondary motion. Sculpted hulls (scene/sculpt.ts): one loft per barrel, neck,
 * head, ear, tail and leg; small accents (eyes, nose, collar tag) as separate pieces.
 *
 * Young-animal proportions: a big round head with the eyes set low and wide, a short muzzle, short thick legs on
 * big paws, a round belly. Authored in the parent's units (a Biscuit-sized puppy / fox, a Mochi-sized kitten) and
 * scaled down uniformly (`scaled`), so the rig numbers stay readable.
 *
 * Also here: the foundlings' basket by the signpost (before you adopt) and the fetch stick.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PAL, toon } from '../toon.ts';
import { blob, loft } from '../sculpt.ts';
import type { Face, Ring } from '../sculpt.ts';
import { arc, buildSkinned, sp } from './skin.ts';
import type { BoneDef, SkinPiece } from './skin.ts';
import type { LegDims, PetDims, PetModel } from './petModels.ts';
import type { Species } from '../../model/pet.ts';

type V3 = readonly [number, number, number];
const ball = (r: number, w = 7, h = 5) => new THREE.SphereGeometry(r, w, h);
const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);
const cyl = (rt: number, rb: number, h: number, s = 6) => new THREE.CylinderGeometry(rt, rb, h, s);
const UP_Z = [0, 0, 1] as const;
const INK = PAL.ink;

// ---------------------------------------------------------------------------------------------
// Coats

/** paint per region; `pattern` (spots, stripes) may override the base colour of fur faces */
export interface Coat {
  fur: number; back: number; light: number; ear: number; earIn: number; sock: number; nose: number; iris: number; tip: number;
  collar: number;
  /** a pale blaze up the middle of the face (beagle) */
  blaze?: boolean;
  /** extra markings: return a colour or null; `part` names the hull */
  pattern?: (f: Face, part: string) => number | null;
}

const spots = (seed: number, k = 0.38, col = 0x2a2627) => (f: Face, part: string): number | null => {
  if (part === 'ear' || part === 'paw') return null;
  const n = Math.sin(f.x * 61 + seed) * Math.sin(f.y * 53 - seed * 0.7) * Math.sin(f.z * 57 + seed * 1.3)
    + 0.45 * Math.sin(f.x * 23 - f.z * 31 + seed);
  return n > k ? col : null;
};
const stripes = (col: number) => (f: Face, part: string): number | null => {
  if (part === 'barrel') return Math.sin(f.a) > -0.15 && Math.sin(f.z * 58 + Math.cos(f.a * 2) * 0.9) > 0.5 ? col : null;
  if (part === 'tail') return f.t > 0.12 && Math.sin(f.t * 22) > 0.35 ? col : null;
  if (part === 'leg') return f.t < 0.55 && Math.sin(f.y * 70) > 0.55 ? col : null;
  if (part === 'head') return f.y > 0.43 && f.t > 0.2 && f.t < 0.65 && Math.abs(f.x) < 0.05 && Math.sin(f.z * 110) > 0.1 ? col : null;
  return null;
};

export const COATS: Record<Species, Record<string, Coat>> = {
  puppy: {
    golden: { fur: 0xe9b866, back: 0xdba552, light: 0xfbe7c3, ear: 0xcf913f, earIn: 0xe0a35a, sock: 0xfbe7c3, nose: INK, iris: 0x3a2418, tip: 0xfbe7c3, collar: 0x3f7fd0 },
    beagle: {
      fur: 0xc98a43, back: 0x2f2a2c, light: 0xfbf5ec, ear: 0x9c6230, earIn: 0xb67a42, sock: 0xfbf5ec, nose: INK, iris: 0x3a2418, tip: 0xfbf5ec, collar: 0xd2443c, blaze: true,
    },
    cocoa: { fur: 0x7d4c2f, back: 0x6c3f26, light: 0x956142, ear: 0x5f371f, earIn: 0x7a4a30, sock: 0x8a5838, nose: 0x3a2420, iris: 0x2c1a12, tip: 0x7d4c2f, collar: 0xf2b630 },
    speckles: { fur: 0xfbf7f0, back: 0xfbf7f0, light: 0xffffff, ear: 0x2f2a2c, earIn: 0x4a4244, sock: 0xfbf7f0, nose: INK, iris: 0x3a2418, tip: 0xfbf7f0, collar: 0xe0567a, pattern: spots(1.7) },
  },
  kitten: {
    ginger: { fur: 0xf0a056, back: 0xe48f45, light: 0xfdebd2, ear: 0xe48f45, earIn: 0xf6a9b2, sock: 0xfdebd2, nose: 0xf08a98, iris: 0x9ccf4a, tip: 0xfdebd2, collar: 0x4f9fd8, pattern: stripes(0xc8692a) },
    tuxedo: { fur: 0x2d2b32, back: 0x2a2830, light: 0xfbf8f3, ear: 0x2d2b32, earIn: 0xe597a3, sock: 0xfbf8f3, nose: 0xf08a98, iris: 0xe6c043, tip: 0x2d2b32, collar: 0xd8443a },
    smoke: { fur: 0x96a0b0, back: 0x86909f, light: 0xd2d8e2, ear: 0x86909f, earIn: 0xe8a4ae, sock: 0xd2d8e2, nose: 0x8a7d86, iris: 0xe9a93a, tip: 0x86909f, collar: 0xf2c43a },
    siamese: { fur: 0xf4e8d4, back: 0xead9be, light: 0xfbf3e6, ear: 0x5a4034, earIn: 0x8a6656, sock: 0x5a4034, nose: 0x4a342c, iris: 0x5fb0ee, tip: 0x5a4034, collar: 0xd04f8c },
  },
  fox: {
    red: { fur: 0xe2742e, back: 0xd06425, light: 0xfbf3e6, ear: 0xe2742e, earIn: 0xfbe6d6, sock: 0x3b2b27, nose: INK, iris: 0x7a4a1c, tip: 0xfbf3e6, collar: 0x3f9a5a },
    arctic: { fur: 0xf2f3f6, back: 0xe1e5ec, light: 0xffffff, ear: 0xe8eaf0, earIn: 0xf7e0e4, sock: 0xc9ced8, nose: 0x3a3a44, iris: 0x4a4a58, tip: 0xffffff, collar: 0x4f8fd8 },
    silver: { fur: 0x4c4852, back: 0x3a3640, light: 0xf2f0f4, ear: 0x3a3640, earIn: 0x8a8090, sock: 0x232126, nose: INK, iris: 0xd8a03a, tip: 0xf8f8fa, collar: 0xe0b63a },
  },
};

export const coatOf = (species: Species, coat: string): Coat => COATS[species][coat] ?? Object.values(COATS[species])[0];

// ---------------------------------------------------------------------------------------------
// Scaling: authored at the parent's size, built at the pet's

function scaled(name: string, bones: BoneDef[], pieces: SkinPiece[], k: number): { mesh: THREE.SkinnedMesh; bones: Record<string, THREE.Bone>; rest: Record<string, THREE.Vector3> } {
  const sv = (v: V3): [number, number, number] => [v[0] * k, v[1] * k, v[2] * k];
  const B = bones.map((b) => ({ ...b, at: sv(b.at) }));
  const P = pieces.map(({ g, color, o }) => {
    const s = o.scale ?? 1;
    return sp(g, color, {
      ...o,
      at: sv(o.at ?? [0, 0, 0]),
      scale: typeof s === 'number' ? s * k : sv(s),
      blend: o.blend ? { ...o.blend, from: o.blend.from * k, till: o.blend.till * k } : undefined,
      chain: o.chain ? { ...o.chain, at: o.chain.at.map((v) => v * k) } : undefined,
    });
  });
  return buildSkinned(name, B, P);
}

function scaleDims(d: PetDims, k: number): PetDims {
  return {
    ...d,
    standY: d.standY * k, restY: d.restY * k, belly: d.belly * k, sitY: d.sitY * k, headTop: d.headTop * k, scale: d.scale * k,
    legs: d.legs.map((l) => ({ ...l, a: l.a * k, b: l.b * k, h: l.h * k })) as PetDims['legs'],
    neutral: d.neutral.map(([x, z]) => [x * k, z * k]) as PetDims['neutral'],
  };
}

function legBones(pre: string, parent: string, x: number, y0: number, y1: number, y2: number, z: number): BoneDef[] {
  return [
    { name: `${pre}0`, parent, at: [x, y0, z] },
    { name: `${pre}1`, parent: `${pre}0`, at: [x, y1, z] },
    { name: `${pre}2`, parent: `${pre}1`, at: [x, y2, z] },
  ];
}
const pick = (c: Coat, f: Face, part: string, base: number): number => {
  if (base !== c.fur && base !== c.back) return base;
  return c.pattern?.(f, part) ?? base;
};

// ---------------------------------------------------------------------------------------------
// Puppy and fox kit (dog rig: body → hips / chest → neck → head; floppy or pricked ears; tail authored backwards)

interface CanineSpec {
  name: string; c: Coat; k: number;
  fox: boolean;
}

function canine({ name, c, k, fox }: CanineSpec): PetModel {
  // authored in Biscuit units: body bone at 0.37 (puppy) / 0.39 (fox kit: a touch leggier)
  const by = fox ? 0.39 : 0.37;
  const lx = fox ? 0.085 : 0.095;
  const fz = fox ? 0.17 : 0.16, hz = fox ? -0.17 : -0.16;
  const legTop = by - 0.02, knee = fox ? 0.2 : 0.19;
  const head: V3 = fox ? [0, 0.63, 0.27] : [0, 0.6, 0.26];
  const bones: BoneDef[] = [
    { name: 'body', parent: null, at: [0, by, 0] },
    { name: 'hips', parent: 'body', at: [0, by, -0.1] },
    { name: 'chest', parent: 'body', at: [0, by, 0.1] },
    { name: 'neck', parent: 'chest', at: [0, by + 0.1, 0.2] },
    { name: 'head', parent: 'neck', at: head },
    { name: 'earL', parent: 'head', at: fox ? [0.1, 0.77, 0.24] : [0.15, 0.74, 0.27] },
    { name: 'earR', parent: 'head', at: fox ? [-0.1, 0.77, 0.24] : [-0.15, 0.74, 0.27] },
    { name: 'eyeL', parent: 'head', at: [0.082, 0.655, 0.41] },
    { name: 'eyeR', parent: 'head', at: [-0.082, 0.655, 0.41] },
    { name: 'happyL', parent: 'head', at: [0.082, 0.655, 0.41] },
    { name: 'happyR', parent: 'head', at: [-0.082, 0.655, 0.41] },
    { name: 'tongue', parent: 'head', at: [0, 0.555, 0.47] },
    { name: 'tag', parent: 'neck', at: [0, by + 0.04, 0.3] },
    { name: 'tail0', parent: 'hips', at: [0, by + 0.05, -0.27] },
    { name: 'tail1', parent: 'tail0', at: [0, by + 0.06, -0.35] },
    { name: 'tail2', parent: 'tail1', at: [0, by + 0.07, -0.43] },
    { name: 'tail3', parent: 'tail2', at: [0, by + 0.08, -0.5] },
    ...legBones('lf', 'chest', lx, legTop, knee, 0.055, fz),
    ...legBones('rf', 'chest', -lx, legTop, knee, 0.055, fz),
    ...legBones('lh', 'hips', lx, legTop + 0.01, knee + 0.01, 0.055, hz),
    ...legBones('rh', 'hips', -lx, legTop + 0.01, knee + 0.01, 0.055, hz),
  ];
  const p: SkinPiece[] = [];
  const top = (f: Face) => Math.sin(f.a);
  // barrel: a round little belly, a saddle (beagle / fox back) and a pale underside
  const barrel = { bone: 'hips', blend: { to: 'chest', axis: 2 as const, from: -0.13, till: 0.13 } };
  p.push(sp(loft([
    { p: [0, by + 0.02, -0.29], r: 0.05 },
    { p: [0, by + 0.015, -0.25], r: [0.125, 0.115, 0.105] },
    { p: [0, by + 0.01, -0.15], r: [0.16, 0.145, 0.155] },
    { p: [0, by, -0.02], r: [0.165, 0.145, 0.165] },
    { p: [0, by + 0.01, 0.1], r: [0.165, 0.15, 0.155] },
    { p: [0, by + 0.04, 0.19], r: [0.13, 0.135, 0.125] },
    { p: [0, by + 0.07, 0.24], r: 0.055 },
  ], { sides: 14, paint: (f) => pick(c, f, 'barrel', top(f) < -0.45 || (f.t > 0.78 && top(f) < 0.2) ? c.light : top(f) > (fox ? 0.55 : 0.7) && f.t < 0.85 ? c.back : c.fur) }), null, barrel));
  // neck: a soft ruff into the head, pale down the throat
  p.push(sp(loft([
    { p: [0, by + 0.04, 0.15], r: [0.11, 0.11] }, { p: [0, by + 0.12, 0.22], r: [0.108, 0.105] }, { p: [0, head[1] - 0.03, head[2]], r: [0.095, 0.09] },
  ], { sides: 12, sub: 2, caps: ['open', 'pole'], paint: (f) => pick(c, f, 'neck', top(f) < -0.25 ? c.light : c.fur) }), null, { bone: 'neck' }));
  // collar + tag
  p.push(sp(new THREE.TorusGeometry(0.11, 0.024, 6, 14), c.collar, { bone: 'neck', at: [0, by + 0.115, 0.235], rot: [Math.PI / 2 - 0.55, 0, 0] }));
  p.push(sp(new THREE.TorusGeometry(0.012, 0.0045, 3, 6), PAL.metal, { bone: 'tag', at: [0, by + 0.075, 0.31] }));
  p.push(sp(cyl(0.028, 0.028, 0.011, 8), PAL.yellow, { bone: 'tag', at: [0, by + 0.045, 0.315], rot: [Math.PI / 2, 0, 0] }));
  // head: a big round skull and a short muzzle (fox: a longer, finer snout; white cheeks)
  const H = { bone: 'head' };
  const hy = head[1];
  const skull: Ring[] = fox ? [
    { p: [0, hy + 0.02, 0.12], r: [0.09, 0.09] },
    { p: [0, hy + 0.03, 0.19], r: [0.175, 0.16, 0.14] },
    { p: [0, hy + 0.02, 0.28], r: [0.18, 0.15, 0.135] },
    { p: [0, hy - 0.005, 0.37], r: [0.12, 0.1, 0.1] },
    { p: [0, hy - 0.03, 0.45], r: [0.065, 0.055, 0.055] },
    { p: [0, hy - 0.035, 0.5], r: [0.032, 0.03, 0.026] },
  ] : [
    { p: [0, hy + 0.02, 0.12], r: [0.09, 0.09] },
    { p: [0, hy + 0.035, 0.19], r: [0.175, 0.165, 0.14] },
    { p: [0, hy + 0.035, 0.28], r: [0.18, 0.16, 0.14] },
    { p: [0, hy + 0.01, 0.36], r: [0.14, 0.12, 0.115] },
    { p: [0, hy - 0.01, 0.41], r: [0.08, 0.07, 0.07] },
    { p: [0, hy - 0.015, 0.43], r: [0.035, 0.03, 0.03] },
  ];
  const headPaint = (f: Face) => {
    if (fox) return f.t > 0.55 && top(f) < 0.3 ? c.light : f.t > 0.3 && top(f) < -0.35 ? c.light : c.fur;
    // puppy: a pale chin; a blaze up the middle of the face (beagle)
    if (f.t > 0.5 && top(f) < -0.4) return c.light;
    if (c.blaze && Math.abs(f.x) < 0.035 && f.t > 0.45 && top(f) > 0.2) return c.light;
    return pick(c, f, 'head', c.fur);
  };
  p.push(sp(loft(skull, { sides: 14, round: 0.45, paint: headPaint }), null, H));
  // puppy: a short round muzzle; fox: white cheek tufts
  if (!fox) p.push(sp(blob([0, hy - 0.042, 0.42], [0.085, 0.064, 0.078], { paint: c.light, sides: 12, rings: 5 }), null, H));
  if (fox) for (const s of [1, -1]) p.push(sp(blob([s * 0.118, hy - 0.05, 0.3], [0.05, 0.04, 0.058], { paint: c.light, sides: 8, rings: 3 }), null, H));
  // nose, mouth
  const nz = fox ? 0.505 : 0.488, ny = fox ? hy - 0.025 : hy - 0.008;
  p.push(sp(blob([0, ny, nz], [0.032, 0.024, 0.022], { paint: c.nose, sides: 10, rings: 4 }), null, H));
  p.push(sp(ball(0.009, 4, 3), 0xffffff, { ...H, at: [0.011, ny + 0.013, nz + 0.016] }));
  p.push(sp(box(0.005, 0.026, 0.005), INK, { ...H, at: [0, ny - 0.035, nz - 0.012] }));
  for (const s of [1, -1]) p.push(sp(box(0.03, 0.006, 0.006), INK, { ...H, at: [s * 0.016, ny - 0.049, nz - 0.016], rot: [0, s * 0.35, s * 0.3] }));
  p.push(sp(box(0.045, 0.011, 0.065), 0xf2899a, { bone: 'tongue', at: [0, ny - 0.06, nz - 0.03], rot: [0.5, 0, 0] }));
  p.push(sp(box(0.004, 0.012, 0.045), 0xd06a7a, { bone: 'tongue', at: [0, ny - 0.057, nz - 0.026], rot: [0.5, 0, 0] }));
  // eyes: big, low and wide, two highlights (happy ∩ arcs when petted); a little brow bump over each
  for (const [s, e, hh] of [[1, 'eyeL', 'happyL'], [-1, 'eyeR', 'happyR']] as const) {
    const ex = s * (fox ? 0.082 : 0.08), ey = fox ? 0.655 : 0.648, ez = fox ? 0.415 : 0.412;
    p.push(sp(ball(0.039, 8, 6), c.iris === 0x3a2418 ? INK : c.iris, { bone: e, at: [ex, ey, ez], scale: [0.95, 1.12, 0.62], rot: [0, s * 0.42, 0] }));
    if (c.iris !== 0x3a2418) p.push(sp(ball(0.024, 7, 5), INK, { bone: e, at: [ex + s * 0.004, ey, ez + 0.012], scale: [0.95, 1.1, 0.6], rot: [0, s * 0.42, 0] }));
    p.push(sp(ball(0.012, 4, 3), 0xffffff, { bone: e, at: [ex + 0.012 * s + 0.004, ey + 0.017, ez + 0.022] }));
    p.push(sp(ball(0.006, 4, 3), 0xffffff, { bone: e, at: [ex - 0.01 * s, ey - 0.013, ez + 0.022] }));
    p.push(sp(arc(0.028, 0.0085), INK, { bone: hh, at: [ex, ey - 0.008, ez + 0.012], rot: [-0.2, s * 0.42, 0] }));
  }
  // ears
  for (const [s, e] of [[1, 'earL'], [-1, 'earR']] as const) {
    if (fox) {
      // big pricked triangles, dark backs, pale fluffy insides
      p.push(sp(loft([
        { p: [s * 0.1, 0.76, 0.24], r: [0.082, 0.03], up: UP_Z },
        { p: [s * 0.13, 0.845, 0.245], r: [0.06, 0.024], up: UP_Z },
        { p: [s * 0.158, 0.925, 0.25], r: [0.028, 0.015], up: UP_Z },
        { p: [s * 0.17, 0.965, 0.252], r: [0.008, 0.006], up: UP_Z },
      ], { sides: 8, sub: 2, paint: (f) => (f.nz > 0.55 && f.t > 0.12 && f.t < 0.8 ? c.earIn : f.t > 0.62 ? c.sock : c.ear) }), null, { bone: e }));
    } else {
      // floppy: a soft flap from the top of the head down beside the cheek
      p.push(sp(loft([
        { p: [s * 0.14, 0.75, 0.27], r: [0.032, 0.058], up: UP_Z },
        { p: [s * 0.195, 0.72, 0.275], r: [0.034, 0.076], up: UP_Z },
        { p: [s * 0.218, 0.63, 0.282], r: [0.03, 0.078], up: UP_Z },
        { p: [s * 0.212, 0.54, 0.29], r: [0.024, 0.062], up: UP_Z },
        { p: [s * 0.2, 0.495, 0.293], r: [0.012, 0.03], up: UP_Z },
      ], { sides: 9, sub: 2, round: 0.7, paint: (f) => (f.nx * s < -0.55 && f.t > 0.2 ? c.earIn : c.ear) }), null, { bone: e }));
    }
  }
  // tail, authored straight back (petBody: `tailBack`): puppy a short happy otter tail, fox a big bushy brush with a white tip
  const ty = by + 0.05;
  const tailRings: Ring[] = fox ? [
    { p: [0, ty, -0.24], r: 0.045 },
    { p: [0, ty + 0.01, -0.3], r: 0.075 },
    { p: [0, ty + 0.02, -0.4], r: 0.095 },
    { p: [0, ty + 0.03, -0.5], r: 0.09 },
    { p: [0, ty + 0.04, -0.58], r: 0.06 },
    { p: [0, ty + 0.045, -0.625], r: 0.02 },
  ] : [
    { p: [0, ty, -0.24], r: 0.045 },
    { p: [0, ty + 0.01, -0.3], r: 0.048 },
    { p: [0, ty + 0.02, -0.38], r: 0.042 },
    { p: [0, ty + 0.03, -0.45], r: 0.032 },
    { p: [0, ty + 0.035, -0.49], r: 0.016 },
  ];
  p.push(sp(loft(tailRings, { sides: 10, round: 0.7, caps: ['open', 'pole'], paint: (f) => pick(c, f, 'tail', f.t > (fox ? 0.8 : 0.82) ? c.tip : fox && top(f) > 0.6 ? c.back : c.fur) }), null,
    { bone: 'tail0', chain: { bones: ['tail0', 'tail1', 'tail2', 'tail3'], axis: 2, at: [-0.27, -0.35, -0.43, -0.5] } }));
  // legs: short and thick, socks (fox: black stockings), big round paws with toe beans
  const leg = (pre: string, x: number, z: number, y0: number, y1: number, hind: boolean) => {
    p.push(sp(loft(([
      { p: [x, y0 + 0.05, z], r: [0.064, 0.07] },
      { p: [x, y0 - 0.05, z - (hind ? 0.01 : 0)], r: [0.058, 0.062] },
      { p: [x, y1, z], r: [0.048, 0.05] },
      { p: [x, 0.11, z + 0.004], r: [0.045, 0.047] },
      { p: [x, 0.05, z + 0.01], r: [0.044, 0.046] },
    ] as Ring[]).map((r) => ({ ...r, up: UP_Z })), {
      sides: 9, sub: 2, caps: ['pole', 'open'],
      paint: (f) => (fox ? (f.t > (hind ? 0.62 : 0.5) ? c.sock : c.fur) : pick(c, f, 'leg', f.t > (hind ? 0.68 : 0.55) ? c.sock : c.fur)),
    }), null, { bone: `${pre}0`, chain: { bones: [`${pre}0`, `${pre}1`, `${pre}2`], axis: 1, at: [y0, y1, 0.055] } }));
    p.push(sp(blob([x, 0.034, z + 0.022], [0.056, 0.036, 0.07], { paint: (f) => (f.ny < -0.6 ? 0x5e3b3e : fox ? c.sock : c.sock), sides: 10, rings: 4 }), null, { bone: `${pre}2` }));
    for (const t of [-1, 0, 1]) p.push(sp(ball(0.0115, 4, 3), fox ? 0x2a1f1c : 0x5e3b3e, { bone: `${pre}2`, at: [x + t * 0.024, 0.008, z + 0.066 - Math.abs(t) * 0.008], scale: [1, 0.4, 1] }));
  };
  leg('lf', lx, fz, legTop, knee, false); leg('rf', -lx, fz, legTop, knee, false);
  leg('lh', lx, hz, legTop + 0.01, knee + 0.01, true); leg('rh', -lx, hz, legTop + 0.01, knee + 0.01, true);
  const m = scaled(name, bones, p, k);
  const lf = (bn: [string, string, string], parent: 'hips' | 'chest', a: number, b: number, bend: number): LegDims => ({ bones: bn, parent, a, b, h: 0.055, bend });
  const a = legTop - knee, b = knee - 0.055;
  const dims: PetDims = {
    kind: 'dog', standY: by - 0.012, restY: by, scale: 0.82, belly: 0.16, sitY: by * 0.69, headTop: 0.4,
    tailBack: true, flopEars: !fox, tailLift: fox ? 0.1 : 0.75, tailCurl: fox ? 0.12 : 0.18,
    legs: [lf(['lf0', 'lf1', 'lf2'], 'chest', a, b, 1), lf(['rf0', 'rf1', 'rf2'], 'chest', a, b, 1),
      lf(['lh0', 'lh1', 'lh2'], 'hips', a, b + 0.01, -1), lf(['rh0', 'rh1', 'rh2'], 'hips', a, b + 0.01, -1)],
    neutral: [[lx, fz + 0.015], [-lx, fz + 0.015], [lx, hz - 0.005], [-lx, hz - 0.005]],
    tail: ['tail0', 'tail1', 'tail2', 'tail3'],
  };
  return { ...m, dims: scaleDims(dims, k) };
}

// ---------------------------------------------------------------------------------------------
// Kitten (cat rig, Mochi's units): a big round head, huge ears and eyes, short legs, a short thick tail

function kitten(name: string, c: Coat, k: number): PetModel {
  const by = 0.235;
  const bones: BoneDef[] = [
    { name: 'body', parent: null, at: [0, by, 0] },
    { name: 'hips', parent: 'body', at: [0, by, -0.09] },
    { name: 'chest', parent: 'body', at: [0, by, 0.09] },
    { name: 'neck', parent: 'chest', at: [0, by + 0.05, 0.17] },
    { name: 'head', parent: 'neck', at: [0, 0.37, 0.22] },
    { name: 'earL', parent: 'head', at: [0.07, 0.47, 0.215] },
    { name: 'earR', parent: 'head', at: [-0.07, 0.47, 0.215] },
    { name: 'eyeL', parent: 'head', at: [0.05, 0.4, 0.33] },
    { name: 'eyeR', parent: 'head', at: [-0.05, 0.4, 0.33] },
    { name: 'happyL', parent: 'head', at: [0.05, 0.4, 0.33] },
    { name: 'happyR', parent: 'head', at: [-0.05, 0.4, 0.33] },
    { name: 'tongue', parent: 'head', at: [0, 0.35, 0.33] },
    { name: 'tag', parent: 'neck', at: [0, by + 0.025, 0.235] },
    { name: 'tail0', parent: 'hips', at: [0, by + 0.04, -0.2] },
    { name: 'tail1', parent: 'tail0', at: [0, by + 0.04, -0.26] },
    { name: 'tail2', parent: 'tail1', at: [0, by + 0.04, -0.32] },
    { name: 'tail3', parent: 'tail2', at: [0, by + 0.04, -0.38] },
    { name: 'tail4', parent: 'tail3', at: [0, by + 0.04, -0.43] },
    ...legBones('lf', 'chest', 0.05, by - 0.01, 0.125, 0.03, 0.115),
    ...legBones('rf', 'chest', -0.05, by - 0.01, 0.125, 0.03, 0.115),
    ...legBones('lh', 'hips', 0.052, by, 0.13, 0.03, -0.115),
    ...legBones('rh', 'hips', -0.052, by, 0.13, 0.03, -0.115),
  ];
  const p: SkinPiece[] = [];
  const top = (f: Face) => Math.sin(f.a);
  const siamese = c.sock !== c.light && c.sock === c.ear;
  const barrel = { bone: 'hips', blend: { to: 'chest', axis: 2 as const, from: -0.12, till: 0.12 } };
  p.push(sp(loft([
    { p: [0, by + 0.02, -0.215], r: 0.035 },
    { p: [0, by + 0.016, -0.18], r: [0.085, 0.08, 0.075] },
    { p: [0, by + 0.01, -0.09], r: [0.104, 0.095, 0.1] },
    { p: [0, by, 0.02], r: [0.1, 0.09, 0.1] },
    { p: [0, by + 0.01, 0.11], r: [0.1, 0.094, 0.095] },
    { p: [0, by + 0.03, 0.17], r: [0.08, 0.082, 0.08] },
    { p: [0, by + 0.045, 0.205], r: 0.038 },
  ], { sides: 14, paint: (f) => pick(c, f, 'barrel', top(f) < -0.5 || (f.t > 0.8 && top(f) < 0) ? c.light : top(f) > 0.75 ? c.back : c.fur) }), null, barrel));
  p.push(sp(loft([
    { p: [0, by + 0.02, 0.14], r: [0.076, 0.076] }, { p: [0, by + 0.08, 0.19], r: [0.07, 0.068] }, { p: [0, 0.37, 0.22], r: [0.06, 0.058] },
  ], { sides: 12, sub: 2, caps: ['open', 'pole'], paint: (f) => (top(f) < -0.2 ? c.light : c.fur) }), null, { bone: 'neck' }));
  p.push(sp(new THREE.TorusGeometry(0.07, 0.012, 5, 14), c.collar, { bone: 'neck', at: [0, by + 0.065, 0.195], rot: [Math.PI / 2 - 0.5, 0, 0] }));
  p.push(sp(ball(0.017, 6, 4), PAL.yellow, { bone: 'tag', at: [0, by + 0.012, 0.243] }));
  // head: wide and round with full cheeks, a tiny muzzle
  const H = { bone: 'head' };
  p.push(sp(loft([
    { p: [0, 0.4, 0.12], r: [0.07, 0.07] },
    { p: [0, 0.405, 0.18], r: [0.128, 0.112, 0.1] },
    { p: [0, 0.398, 0.255], r: [0.132, 0.11, 0.1] },
    { p: [0, 0.385, 0.305], r: [0.095, 0.078, 0.07] },
    { p: [0, 0.37, 0.33], r: [0.045, 0.036, 0.034] },
  ], {
    sides: 14, round: 0.45,
    paint: (f) => {
      if (siamese) return f.t > 0.55 ? c.sock : c.fur;
      if (c.light !== c.fur && f.t > 0.72 && top(f) < 0.35) return c.light;
      if (c.light !== c.fur && f.t > 0.5 && top(f) < -0.45) return c.light;
      return pick(c, f, 'head', c.fur);
    },
  }), null, H));
  // muzzle puffs, chin, nose, whiskers
  for (const s of [1, -1]) p.push(sp(blob([s * 0.024, 0.363, 0.318], [0.034, 0.028, 0.028], { paint: siamese ? c.sock : c.light, sides: 8, rings: 3 }), null, H));
  p.push(sp(blob([0, 0.35, 0.316], [0.018, 0.014, 0.016], { paint: siamese ? c.sock : c.light, sides: 8, rings: 3 }), null, H));
  p.push(sp(new THREE.ConeGeometry(0.012, 0.013, 3), c.nose, { ...H, at: [0, 0.38, 0.346], rot: [Math.PI, 0, 0], scale: [1.3, 1, 0.8] }));
  for (const s of [1, -1]) for (const kk of [-1, 0, 1]) {
    p.push(sp(box(0.095, 0.005, 0.005), siamese ? 0xf4e8d4 : 0xffffff, { ...H, at: [s * 0.095, 0.367 + kk * 0.009, 0.315], rot: [0, s * 0.18, s * kk * 0.16] }));
  }
  // eyes: huge, round pupils (kitten), two highlights
  for (const [s, e, hh] of [[1, 'eyeL', 'happyL'], [-1, 'eyeR', 'happyR']] as const) {
    const ex = s * 0.05, ey = 0.4, ez = 0.328;
    p.push(sp(ball(0.031, 8, 6), c.iris, { bone: e, at: [ex, ey, ez], scale: [1, 1.08, 0.55], rot: [0, s * 0.32, 0] }));
    p.push(sp(ball(0.021, 7, 5), INK, { bone: e, at: [ex + s * 0.003, ey, ez + 0.009], scale: [0.85, 1.05, 0.55], rot: [0, s * 0.32, 0] }));
    p.push(sp(ball(0.0085, 4, 3), 0xffffff, { bone: e, at: [ex + 0.01, ey + 0.012, ez + 0.019] }));
    p.push(sp(ball(0.0045, 4, 3), 0xffffff, { bone: e, at: [ex - 0.008, ey - 0.01, ez + 0.019] }));
    p.push(sp(arc(0.023, 0.0065), INK, { bone: hh, at: [ex, ey - 0.006, ez + 0.01], rot: [-0.2, s * 0.32, 0] }));
  }
  p.push(sp(box(0.03, 0.007, 0.04), 0xf2a3ae, { bone: 'tongue', at: [0, 0.342, 0.332], rot: [0.3, 0, 0] }));
  // big ears, set wide
  for (const [s, e] of [[1, 'earL'], [-1, 'earR']] as const) {
    p.push(sp(loft([
      { p: [s * 0.07, 0.465, 0.215], r: [0.058, 0.024], up: UP_Z },
      { p: [s * 0.084, 0.52, 0.218], r: [0.04, 0.018], up: UP_Z },
      { p: [s * 0.096, 0.57, 0.222], r: [0.01, 0.007], up: UP_Z },
    ], { sides: 8, sub: 2, paint: (f) => (f.nz > 0.55 && f.t > 0.12 && f.t < 0.8 ? c.earIn : c.ear) }), null, { bone: e }));
  }
  // a short thick tail (kittens' tails are stubby), dark tip / stripes / points from the coat
  p.push(sp(loft([
    { p: [0, by + 0.035, -0.19], r: 0.036 },
    { p: [0, by + 0.04, -0.27], r: 0.033 },
    { p: [0, by + 0.04, -0.36], r: 0.03 },
    { p: [0, by + 0.04, -0.43], r: 0.026 },
    { p: [0, by + 0.04, -0.47], r: 0.02 },
  ], { sides: 9, caps: ['open', 'pole'], round: 0.8, paint: (f) => pick(c, f, 'tail', f.t > 0.8 ? c.tip : siamese && f.t > 0.3 ? c.sock : c.fur) }), null,
    { bone: 'tail0', chain: { bones: ['tail0', 'tail1', 'tail2', 'tail3', 'tail4'], axis: 2, at: [-0.2, -0.26, -0.32, -0.38, -0.43] } }));
  const leg = (pre: string, x: number, z: number, y0: number, y1: number) => {
    p.push(sp(loft(([
      { p: [x, y0 + 0.035, z], r: [0.042, 0.044] },
      { p: [x, y0 - 0.04, z], r: [0.036, 0.038] },
      { p: [x, y1, z], r: [0.03, 0.031] },
      { p: [x, 0.065, z + 0.003], r: [0.028, 0.029] },
      { p: [x, 0.028, z + 0.006], r: [0.027, 0.028] },
    ] as Ring[]).map((r) => ({ ...r, up: UP_Z })), { sides: 8, sub: 2, caps: ['pole', 'open'], paint: (f) => pick(c, f, 'leg', f.t > 0.62 ? c.sock : c.fur) }), null,
      { bone: `${pre}0`, chain: { bones: [`${pre}0`, `${pre}1`, `${pre}2`], axis: 1, at: [y0, y1, 0.03] } }));
    p.push(sp(blob([x, 0.019, z + 0.012], [0.033, 0.02, 0.043], { paint: (f) => (f.ny < -0.6 ? 0xf2a3ae : c.sock), sides: 9, rings: 4 }), null, { bone: `${pre}2` }));
    for (const t of [-1, 1]) p.push(sp(ball(0.0075, 4, 3), 0xf2a3ae, { bone: `${pre}2`, at: [x + t * 0.012, 0.004, z + 0.04], scale: [1, 0.4, 1] }));
  };
  leg('lf', 0.05, 0.115, by - 0.01, 0.125); leg('rf', -0.05, 0.115, by - 0.01, 0.125);
  leg('lh', 0.052, -0.115, by, 0.13); leg('rh', -0.052, -0.115, by, 0.13);
  const m = scaled(name, bones, p, k);
  const lf = (bn: [string, string, string], parent: 'hips' | 'chest', a: number, b: number, bend: number): LegDims => ({ bones: bn, parent, a, b, h: 0.03, bend });
  const dims: PetDims = {
    kind: 'cat', standY: by - 0.01, restY: by, scale: 0.56, belly: 0.095, sitY: 0.175, headTop: 0.2, tailLift: 0.85, tailCurl: 0.45,
    legs: [lf(['lf0', 'lf1', 'lf2'], 'chest', by - 0.01 - 0.125, 0.095, 1), lf(['rf0', 'rf1', 'rf2'], 'chest', by - 0.01 - 0.125, 0.095, 1),
      lf(['lh0', 'lh1', 'lh2'], 'hips', by - 0.13, 0.1, -1), lf(['rh0', 'rh1', 'rh2'], 'hips', by - 0.13, 0.1, -1)],
    neutral: [[0.05, 0.125], [-0.05, 0.125], [0.052, -0.115], [-0.052, -0.115]],
    tail: ['tail0', 'tail1', 'tail2', 'tail3', 'tail4'],
  };
  return { ...m, dims: scaleDims(dims, k) };
}

/** scale per species: how big the young one is next to its parent model */
export const SPECIES_K: Record<Species, number> = { puppy: 0.8, kitten: 0.95, fox: 0.78 };

/** Build the player's pet: species + coat → one skinned mesh and its rig dimensions. */
export function companionModel(species: Species, coat: string): PetModel {
  const c = coatOf(species, coat);
  const name = `pet-${species}`;
  if (species === 'kitten') return kitten(name, c, SPECIES_K.kitten);
  return canine({ name, c, k: SPECIES_K[species], fox: species === 'fox' });
}
/** which rig family animates a species */
export const familyOf = (species: Species): 'dog' | 'cat' => (species === 'kitten' ? 'cat' : 'dog');

// ---------------------------------------------------------------------------------------------
// Props: the fetch stick and the foundlings' basket (plain merged meshes, vertex colours)

function painted(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(n.attributes)) if (k !== 'position') n.deleteAttribute(k);
  n.computeVertexNormals();
  const c = new THREE.Color(color), cnt = n.attributes.position.count, col = new Float32Array(cnt * 3);
  for (let i = 0; i < cnt; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  n.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.dispose();
  return n;
}
function keepLoft(g: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
  return g;
}
const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry => {
  g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z); return g;
};

/** A thrown stick: a bent twig with a side shoot and a leaf, centred on its middle, lying along x. */
export function stickMesh(): THREE.Mesh {
  const bark = 0x8a5a33, end = 0xd9b07a;
  const parts = [
    keepLoft(loft([
      { p: [-0.21, 0, 0], r: 0.017 }, { p: [-0.08, 0.012, 0.004], r: 0.019 }, { p: [0.06, 0.004, -0.004], r: 0.018 }, { p: [0.2, 0.016, 0.006], r: 0.014 },
    ], { sides: 6, caps: ['flat', 'flat'], paint: (f) => (f.t < 0.02 || f.t > 0.98 ? end : bark) })),
    keepLoft(loft([{ p: [0.02, 0.006, 0], r: 0.009 }, { p: [0.08, 0.01, 0.05], r: 0.007 }, { p: [0.11, 0.012, 0.085], r: 0.004 }], { sides: 5, paint: bark })),
    painted(at(new THREE.SphereGeometry(0.03, 5, 3), 0.12, 0.014, 0.1, 0, 0.6, 0).scale(1, 0.25, 1.6), 0x6fa64a),
  ];
  const g = mergeGeometries(parts, false)!;
  for (const x of parts) x.dispose();
  const m = new THREE.Mesh(g, toon(0xffffff, { vertexColors: true, shared: false }));
  m.name = 'life:pet-stick';
  m.castShadow = true;
  return m;
}

/**
 * The foundlings' basket by the signpost: a wicker basket on a tartan blanket with a sleeping puppy and a kitten
 * curled in it (ears, a tail over the rim), and a little "free to good homes" slate with a paw print. Origin on the
 * ground, front +z.
 */
export function basketMesh(): THREE.Mesh {
  const wick = 0xc9965a, wickD = 0xa87640, blanket = 0xc95f4a, blanket2 = 0x2f5a3a;
  const parts: THREE.BufferGeometry[] = [];
  // the basket: one lofted bowl (open top), woven bands, a rolled rim, two handles
  parts.push(keepLoft(loft([
    { p: [0, 0.02, 0], r: [0.3, 0.22], up: UP_Z },
    { p: [0, 0.1, 0], r: [0.36, 0.27], up: UP_Z },
    { p: [0, 0.2, 0], r: [0.4, 0.3], up: UP_Z },
    { p: [0, 0.24, 0], r: [0.41, 0.31], up: UP_Z },
  ], { sides: 16, sub: 2, caps: ['flat', 'open'], paint: (f) => (Math.sin(f.y * 90) > 0 !== Math.sin(f.a * 8) > 0 ? wick : wickD) })));
  parts.push(painted(at(new THREE.TorusGeometry(0.41, 0.035, 5, 18), 0, 0.245, 0, Math.PI / 2).scale(1, 1, 0.76), wickD));
  for (const s of [1, -1]) parts.push(painted(at(new THREE.TorusGeometry(0.09, 0.016, 4, 8, Math.PI), s * 0.36, 0.26, 0, 0, Math.PI / 2, 0), wickD));
  // the blanket inside, draped over the front rim
  parts.push(painted(at(new THREE.CylinderGeometry(0.36, 0.36, 0.04, 14), 0, 0.2, 0).scale(1, 1, 0.75), blanket));
  parts.push(painted(at(new THREE.BoxGeometry(0.34, 0.012, 0.16), 0.02, 0.2, 0.3, 0.9, 0.15, 0), blanket2));
  // a puppy asleep: round back, head on paws, floppy ear
  parts.push(keepLoft(blob([-0.1, 0.27, -0.03], [0.17, 0.1, 0.13], { paint: 0xe9b866, sides: 12, rings: 5 })));
  parts.push(keepLoft(blob([-0.02, 0.27, 0.11], [0.1, 0.085, 0.09], { paint: (f) => (f.nz > 0.6 && f.y < 0.27 ? 0xfbe7c3 : 0xe9b866), sides: 12, rings: 5 })));
  parts.push(keepLoft(blob([0.06, 0.255, 0.115], [0.022, 0.016, 0.016], { paint: PAL.ink, sides: 6, rings: 3 })));
  parts.push(keepLoft(blob([-0.07, 0.29, 0.12], [0.03, 0.07, 0.045], { paint: 0xcf913f, sides: 8, rings: 4, tilt: 0.4 })));
  for (const s of [1, -1]) parts.push(painted(at(new THREE.TorusGeometry(0.014, 0.004, 3, 5, Math.PI), -0.01 + s * 0.035, 0.29, 0.195, Math.PI, 0, 0), PAL.ink));
  // a kitten curled beside it: a grey swirl, pointed ears, a tail curled round the front
  parts.push(keepLoft(blob([0.16, 0.26, -0.06], [0.12, 0.08, 0.11], { paint: (f) => (Math.sin(f.z * 70 + f.x * 20) > 0.45 && f.ny > 0.2 ? 0x6e7888 : 0x96a0b0), sides: 12, rings: 5 })));
  parts.push(keepLoft(blob([0.2, 0.28, 0.05], [0.075, 0.065, 0.065], { paint: 0x96a0b0, sides: 10, rings: 4 })));
  for (const s of [1, -1]) parts.push(painted(at(new THREE.ConeGeometry(0.026, 0.06, 4), 0.2 + s * 0.04, 0.345, 0.045, -0.2, 0, -s * 0.35), s > 0 ? 0x86909f : 0x96a0b0));
  parts.push(keepLoft(loft([{ p: [0.06, 0.25, 0.06], r: 0.022 }, { p: [0.12, 0.245, 0.12], r: 0.02 }, { p: [0.22, 0.25, 0.13], r: 0.016 }], { sides: 6, paint: 0x86909f })));
  // the slate: a little board on a stake, a white paw print and a heart
  parts.push(painted(at(new THREE.BoxGeometry(0.03, 0.42, 0.03), 0.52, 0.21, 0.12), PAL.woodDark));
  parts.push(painted(at(new THREE.BoxGeometry(0.3, 0.2, 0.025), 0.52, 0.44, 0.14, 0, -0.35, 0), 0x3b4a44));
  parts.push(painted(at(new THREE.BoxGeometry(0.32, 0.22, 0.02), 0.52, 0.44, 0.13, 0, -0.35, 0), PAL.wood));
  const sy = 0.43, sx = 0.52, sz = 0.157, ry = -0.35;
  const onSlate = (dx: number, dy: number, r: number, col: number) => {
    const g = new THREE.CircleGeometry(r, 8);
    g.translate(dx, dy, 0); g.rotateY(ry); g.translate(sx, sy, sz);
    parts.push(painted(g, col));
  };
  onSlate(-0.05, -0.02, 0.03, 0xf4efe4);
  for (let i = 0; i < 4; i++) onSlate(-0.05 + (i - 1.5) * 0.024, 0.03 + (i === 0 || i === 3 ? -0.006 : 0.004), 0.011, 0xf4efe4);
  onSlate(0.06, 0.0, 0.026, 0xe0566a); onSlate(0.082, 0.0, 0.026, 0xe0566a);
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0.045, -0.006, 0, 0.097, -0.006, 0, 0.071, -0.045, 0]), 3));
  tri.translate(0, 0, 0); tri.rotateY(ry); tri.translate(sx, sy, sz);
  parts.push(painted(tri, 0xe0566a));
  const g = mergeGeometries(parts, false)!;
  for (const x of parts) x.dispose();
  const m = new THREE.Mesh(g, toon(0xffffff, { vertexColors: true, shared: false }));
  m.name = 'life:foundlings';
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
