/**
 * The first-person paws and what they hold (scene/viewmodel). You are a little Clawd-ish valley creature in a cosy
 * knitted jumper: soft orange mitten-paws (a stubby thumb, three toe scallops, pink toe beans underneath) coming out of
 * a sage sleeve with a cream ribbed cuff and a mustard stripe.
 *
 * Paw space: the wrist at the origin, the paw reaching along −z (forward), palm down (−y), the sleeve running back
 * (+z) and a little down out of the bottom of the view. `side` +1 = right paw (thumb on the −x side), −1 = left.
 * The grip point (a held handle runs through the fist) is `GRIP`.
 *
 * Every geometry is non-indexed with position / normal / colour and `aPart` (0 = rigid with the paw, 1 = the swinging
 * / flying part: the lantern and basket on their bails, the flipped coin), so one paw + its item is one draw and the
 * shader moves the part with one matrix. Built lazily per (side, pose, item) and cached.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { paint, PAL } from '../toon.ts';
import { blob, loft } from '../sculpt.ts';
import type { Face } from '../sculpt.ts';
import type { HandItem } from '../context.ts';
import { forageGeometry, rodGeometry } from '../forage/models.ts';

export type PawPose = 'open' | 'grip' | 'thumb';

/** where a handle runs through the closed fist (paw space) */
export const GRIP = Object.freeze({ x: 0, y: -0.004, z: -0.052 });
/** the lantern's glass centre below the grip (paw space, before the swing) */
export const LANTERN_GLASS = Object.freeze({ x: 0, y: GRIP.y - 0.096, z: GRIP.z });
/** the coin's rest spot on the thumb (right paw space) */
export const COIN_REST = Object.freeze({ x: -0.026, y: 0.044, z: -0.05 });
/** the rod leans forward out of the fist by this much (radians) when the paw is level */
export const ROD_TILT = 0.9;

const COL = Object.freeze({
  paw: 0xe58a5c, pawShade: 0xd27349, pad: 0xf5a99a, sleeve: 0x6f9e83, sleeveDark: 0x5f8d73, stripe: 0xe3b04a,
  cuff: 0xf1e3c4, cuffDark: 0xdccdaa, metal: 0x3d434b, brass: 0xc0954e, wicker: 0xcf9c63, wickerDark: 0x9a6a40,
  coin: 0xf2c33a, glass: PAL.lampGlow, flame: 0xfff1c0,
});

/** non-indexed, only position / normal / colour + aPart */
function fin(g: THREE.BufferGeometry, part: 0 | 1, color?: number): THREE.BufferGeometry {
  let f = g.index ? g.toNonIndexed() : g;
  if (f === g) f = g.clone();
  for (const k of Object.keys(f.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') f.deleteAttribute(k);
  if (!f.attributes.normal) f.computeVertexNormals();
  if (color !== undefined || !f.attributes.color) paint(f, color ?? 0xffffff);
  f.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(f.attributes.position.count).fill(part), 1));
  return f;
}
/** a three primitive, faceted, one colour */
const prim = (g: THREE.BufferGeometry, color: number, part: 0 | 1 = 0) => { const f = fin(g, part, color); f.computeVertexNormals(); return f; };

/** a small smooth blob turned and moved: spine along z, then rx / ry about its centre */
function nub(c: readonly [number, number, number], r: readonly [number, number, number], color: number | ((f: Face) => number), rx = 0, ry = 0): THREE.BufferGeometry {
  const g = blob([0, 0, 0], r, { paint: color, sides: 8, rings: 4 });
  g.rotateX(rx); g.rotateY(ry); g.translate(c[0], c[1], c[2]);
  return fin(g, 0);
}

function sleeve(side: 1 | -1): THREE.BufferGeometry {
  // the forearm runs back, down and out toward the shoulder, so it leaves the view low at the side
  const s = side;
  const g = loft([
    { p: [0, -0.002, -0.006], r: [0.047, 0.041] },
    { p: [0, -0.003, 0.026], r: [0.051, 0.045] },
    { p: [0, -0.006, 0.048], r: [0.046, 0.04] },
    // past the cuff it bends down steeply and slims toward the elbow: the forearm is nearer the camera than the paw, so
    // when a reach (grab, pat, the raised lantern) levels the arm, a straight, flared sleeve filled a third of the view
    { p: [s * 0.022, -0.065, 0.11], r: [0.048, 0.043] },
    { p: [s * 0.055, -0.18, 0.17], r: [0.046, 0.041] },
    { p: [s * 0.09, -0.33, 0.22], r: [0.043, 0.038] },
  ], {
    sides: 12, sub: 2, caps: ['flat', 'open'],
    // the ribbed cuff (alternate shades around), a mustard stripe up the arm, sage knit
    paint: (f) => (f.z < 0.045 ? (Math.floor((f.a + 10) / (Math.PI / 6)) % 2 ? COL.cuff : COL.cuffDark)
      : f.z > 0.14 && f.z < 0.18 ? COL.stripe : f.z < 0.07 ? COL.sleeveDark : COL.sleeve),
  });
  return fin(g, 0);
}

const pawPaint = (f: Face) => (f.ny < -0.55 ? COL.pawShade : COL.paw);

function palm(pose: PawPose): THREE.BufferGeometry {
  const open = pose === 'open';
  const g = loft(open ? [
    { p: [0, 0, 0.012], r: [0.038, 0.03] },
    { p: [0, 0.004, -0.025], r: [0.05, 0.036, 0.03] },
    { p: [0, 0.002, -0.064], r: [0.055, 0.034, 0.028] },
    { p: [0, -0.005, -0.094], r: [0.047, 0.028, 0.024] },
    { p: [0, -0.011, -0.11], r: [0.026, 0.016, 0.014] },
  ] : [
    { p: [0, 0, 0.012], r: [0.038, 0.03] },
    { p: [0, 0.004, -0.024], r: [0.05, 0.04, 0.034] },
    { p: [0, 0.001, -0.056], r: [0.053, 0.043, 0.04] },
    { p: [0, -0.006, -0.079], r: [0.038, 0.033, 0.031] },
  ], { sides: 12, sub: 2, caps: ['open', 'pole'], paint: pawPaint });
  return fin(g, 0);
}

/** one paw (palm + thumb + toes + beans) and its sleeve, no item */
function paw(pose: PawPose, side: 1 | -1): THREE.BufferGeometry[] {
  const parts = [sleeve(side), palm(pose)];
  const s = side;
  if (pose === 'open') {
    // three toe scallops along the front edge, a stubby thumb out to the side, pink beans underneath
    for (const x of [-0.029, 0, 0.029]) parts.push(nub([x, 0.003, -0.098], [0.019, 0.017, 0.021], pawPaint));
    parts.push(nub([-s * 0.05, -0.006, -0.042], [0.017, 0.015, 0.026], pawPaint, 0, s * 0.55));
    parts.push(nub([0, -0.031, -0.052], [0.024, 0.006, 0.02], COL.pad));
    for (const x of [-0.026, 0, 0.026]) parts.push(nub([x, -0.024, -0.096], [0.009, 0.005, 0.009], COL.pad));
  } else {
    // a fist: the toes curled under, the thumb wrapped round (thumbs-up: straight up)
    for (const x of [-0.026, 0, 0.026]) parts.push(nub([x, -0.026, -0.07], [0.018, 0.017, 0.018], pawPaint));
    if (pose === 'grip') parts.push(nub([-s * 0.044, -0.022, -0.05], [0.016, 0.015, 0.026], pawPaint, 0, s * 0.35));
    else parts.push(nub([-s * 0.028, 0.048, -0.034], [0.017, 0.017, 0.03], pawPaint, -Math.PI / 2 + 0.15, 0));
  }
  return parts;
}

// ------------------------------------------------------------------------------------------------- items (paw space)

function rod(): THREE.BufferGeometry[] {
  // the forage rod (scene/forage/models.ts: blank along +y, cork 0.02–0.32): the fist closes round the cork
  return [fin(rodGeometry().translate(0, -0.17, 0).rotateX(-ROD_TILT).translate(GRIP.x, GRIP.y, GRIP.z), 0)];
}

/** the hanging lantern's solid parts (aPart 1; the glass is the glow mesh, `lanternGlow`) */
function lantern(): THREE.BufferGeometry[] {
  const y = GRIP.y, z = GRIP.z, out: THREE.BufferGeometry[] = [];
  // the bail loops up through the fist; the lantern hangs just under it
  out.push(prim(new THREE.TorusGeometry(0.026, 0.0045, 4, 10, Math.PI).translate(0, y - 0.024, z), COL.metal, 1));
  out.push(prim(new THREE.ConeGeometry(0.042, 0.03, 8).translate(0, y - 0.038, z), COL.metal, 1));
  out.push(prim(new THREE.CylinderGeometry(0.04, 0.04, 0.01, 8).translate(0, y - 0.057, z), COL.brass, 1));
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    out.push(prim(new THREE.BoxGeometry(0.008, 0.064, 0.008).translate(Math.cos(a) * 0.034, LANTERN_GLASS.y, z + Math.sin(a) * 0.034), COL.metal, 1));
  }
  out.push(prim(new THREE.CylinderGeometry(0.042, 0.036, 0.018, 8).translate(0, y - 0.138, z), COL.brass, 1));
  return out;
}

/** the lantern's glass and flame (one unlit glow draw; aPart 1 so it swings with the body) */
export function lanternGlow(): THREE.BufferGeometry {
  const g = mergeGeometries([
    prim(new THREE.CylinderGeometry(0.032, 0.032, 0.064, 8, 1, true).translate(LANTERN_GLASS.x, LANTERN_GLASS.y, LANTERN_GLASS.z), COL.glass, 1),
    prim(new THREE.ConeGeometry(0.012, 0.034, 6).translate(LANTERN_GLASS.x, LANTERN_GLASS.y - 0.004, LANTERN_GLASS.z), COL.flame, 1),
  ])!;
  g.computeBoundingSphere();
  return g;
}

function basket(): THREE.BufferGeometry[] {
  const y = GRIP.y, z = GRIP.z, out: THREE.BufferGeometry[] = [];
  out.push(prim(new THREE.TorusGeometry(0.058, 0.006, 4, 12, Math.PI).translate(0, y - 0.07, z), COL.wickerDark, 1));
  const body = new THREE.CylinderGeometry(0.074, 0.058, 0.075, 10, 3, true).translate(0, y - 0.11, z);
  const f = fin(body, 1);
  f.computeVertexNormals();
  // woven bands
  const p = f.attributes.position, c = f.attributes.color;
  const col = new THREE.Color();
  for (let i = 0; i < p.count; i += 3) {
    const band = Math.floor(((p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3 - (y - 0.15)) / 0.025);
    col.set(band % 2 ? COL.wicker : COL.wickerDark);
    for (let j = i; j < i + 3; j++) c.setXYZ(j, col.r, col.g, col.b);
  }
  out.push(f);
  out.push(prim(new THREE.CylinderGeometry(0.058, 0.058, 0.008, 10).translate(0, y - 0.146, z), COL.wickerDark, 1));
  out.push(prim(new THREE.TorusGeometry(0.074, 0.007, 4, 12).rotateX(Math.PI / 2).translate(0, y - 0.072, z), COL.wickerDark, 1));
  // today's finds peeking over the rim
  const find = (id: string, s: number, x: number, dz: number, ry: number, rz = 0) =>
    fin(forageGeometry(id).clone().scale(s, s, s).rotateY(ry).rotateZ(rz).translate(x, y - 0.1, z + dz), 1);
  out.push(find('chanterelle', 0.36, -0.024, 0.012, 0.4), find('berries', 0.34, 0.024, -0.014, 1.2), find('mapleleaf', 0.32, 0.004, 0.022, 2.1, 0.5));
  return out;
}

function hay(): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  // under the palm in paw space: the paw turns palm-up to cradle it
  const y = GRIP.y - 0.07, z = GRIP.z - 0.03;
  out.push(nub([0, y, z], [0.075, 0.045, 0.065], 0xe9bf4c));
  out.push(nub([0.03, y - 0.024, z - 0.01], [0.048, 0.028, 0.042], 0xd29d36));
  for (let i = 0; i < 9; i++) {
    const a = i * 0.7;
    out.push(prim(new THREE.BoxGeometry(0.11, 0.004, 0.004).rotateY(a).rotateZ((i - 4) * 0.12).translate(Math.sin(i) * 0.03, y - 0.03 - (i % 3) * 0.008, z + Math.cos(i * 1.3) * 0.025), i % 2 ? 0xf0cc5a : 0xc9932f));
  }
  return out;
}

function grain(): THREE.BufferGeometry[] {
  const y = GRIP.y, z = GRIP.z;
  return [
    prim(new THREE.CylinderGeometry(0.011, 0.011, 0.11, 6).rotateX(Math.PI / 2).translate(0, y, z - 0.04), 0x9a6a40),
    prim(new THREE.CylinderGeometry(0.05, 0.042, 0.05, 10, 1, true).rotateX(-0.25).translate(0, y + 0.02, z - 0.13), PAL.metal),
    prim(new THREE.CylinderGeometry(0.042, 0.042, 0.004, 10).rotateX(-0.25).translate(0, y - 0.004, z - 0.124), PAL.metalDark),
    nub([0, y + 0.04, z - 0.13], [0.045, 0.014, 0.042], 0xf0c860),
  ];
}

function brush(): THREE.BufferGeometry[] {
  const y = GRIP.y - 0.045, z = GRIP.z - 0.012;
  return [
    prim(new THREE.BoxGeometry(0.12, 0.034, 0.07).translate(0, y, z), 0xa0583a),
    prim(new THREE.BoxGeometry(0.112, 0.026, 0.062).translate(0, y - 0.028, z), 0x3a3030),
    prim(new THREE.BoxGeometry(0.1, 0.012, 0.074).translate(0, y + 0.03, z), 0x6a4630),
  ];
}

function coin(side: 1 | -1): THREE.BufferGeometry[] {
  return [prim(new THREE.CylinderGeometry(0.017, 0.017, 0.004, 12).translate(side * COIN_REST.x, COIN_REST.y, COIN_REST.z), COL.coin, 1)];
}

const ITEMS: Record<Exclude<HandItem, 'none'>, (side: 1 | -1) => THREE.BufferGeometry[]> = {
  rod, lantern, basket, hay, grain, brush, coin,
};
/** the pose a paw takes for an item */
export const ITEM_POSE: Readonly<Record<HandItem, PawPose>> = Object.freeze({
  none: 'open', rod: 'grip', lantern: 'grip', basket: 'grip', hay: 'open', grain: 'grip', brush: 'grip', coin: 'grip',
});

const cache = new Map<string, THREE.BufferGeometry>();
/** A paw in a pose holding an item: one geometry (cached). */
export function handGeometry(side: 1 | -1, pose: PawPose, item: HandItem): THREE.BufferGeometry {
  const key = `${side}|${pose}|${item}`;
  let g = cache.get(key);
  if (g) return g;
  const parts = paw(pose, side);
  if (item !== 'none') parts.push(...ITEMS[item](side));
  g = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  g.name = `viewmodel:${key}`;
  cache.set(key, g);
  return g;
}

export const handKey = (side: 1 | -1, pose: PawPose, item: HandItem) => `${side}|${pose}|${item}`;
