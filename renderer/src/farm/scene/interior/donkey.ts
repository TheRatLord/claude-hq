/**
 * The barn's donkey: a small, chunky, grey-brown donkey on the pen animals' rig (scene/plots/rig.ts), built like the
 * species in scene/plots/beasts.ts — body (tail swings, tuft lags), head (blinks, chews, long ears flick, nods on the
 * neck joint), upper and lower leg bones modelled hanging from y = 0. Facing +z, ground at y = 0, left = +x, legs
 * LF, RF, LH, RH.
 */
import * as THREE from 'three';
import { ball, box, cached } from '../plots/geo.ts';
import type { V3 } from '../plots/geo.ts';
import { P, rigMerge, tag } from '../plots/rig.ts';
import { blob, loft } from '../sculpt.ts';
import type { Face, Ring } from '../sculpt.ts';

export interface DonkeyDef {
  body(): THREE.BufferGeometry; head(): THREE.BufferGeometry; upper(): THREE.BufferGeometry; lower(): THREE.BufferGeometry;
  hips: V3[]; bones: [number, number][]; boneGeo: [number, number]; cog: V3; neck: V3; mouth: V3; r: number; len: number; lieDrop: [number, number];
}

const COAT = 0x9c8c7c, CREAM = 0xeee4d2, MANE = 0x4a3e36, DARK = 0x3a302a, HOOF = 0x2e2622, NOSE = 0x5a4a44;
const INK = 0x1c1818, GLINT = 0xffffff;

/** a big glossy toon eye (copied from beasts.ts): black oval + two highlights, blink pivot a bit below centre */
function eye(p: V3, r: number, joint: V3, o: { sclera?: number; side?: number } = {}): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const pivot: V3 = [p[0], p[1] - r * 0.55, p[2]];
  const t = { part: P.EYE, pivot, joint };
  const side = o.side ?? 0;
  if (o.sclera !== undefined) out.push(tag(ball(r * 1.3, o.sclera, { p: [p[0], p[1], p[2] - r * 0.25], s: [0.95, 1.15, 0.7], r: [0, side, 0] }, 1), t));
  out.push(tag(ball(r, INK, { p: [p[0] + Math.sin(side) * r * 0.25, p[1], p[2] + r * 0.1], s: [0.85, 1.15, 0.75], r: [0, side, 0] }, 1), t));
  out.push(tag(ball(r * 0.34, GLINT, { p: [p[0] + r * 0.3 * Math.cos(side) + Math.sin(side) * r * 0.55, p[1] + r * 0.38, p[2] + r * 0.55] }), t));
  out.push(tag(ball(r * 0.15, GLINT, { p: [p[0] - r * 0.28 * Math.cos(side) + Math.sin(side) * r * 0.55, p[1] - r * 0.35, p[2] + r * 0.58] }), t));
  return out;
}

const J: V3 = [0, 0.26, 0.2];
const NECK: V3 = [0, 0.98, 0.5];
const MOUTH: V3 = [0, 0.1, 0.66];

function body(): THREE.BufferGeometry {
  return cached('donkey:body', () => {
    const p: THREE.BufferGeometry[] = [];
    // one round barrel: a soft rump, a deep belly, a little dip at the back, the chest rising into the neck
    p.push(tag(loft([
      { p: [0, 0.88, -0.66], r: [0.12, 0.1] },
      { p: [0, 0.88, -0.6], r: [0.27, 0.22, 0.22], e: 2.5 },
      { p: [0, 0.86, -0.42], r: [0.33, 0.25, 0.28], e: 2.6 },
      { p: [0, 0.83, -0.15], r: [0.34, 0.24, 0.3], e: 2.4 },
      { p: [0, 0.83, 0.12], r: [0.34, 0.25, 0.3], e: 2.4 },
      { p: [0, 0.87, 0.38], r: [0.31, 0.27, 0.28], e: 2.5 },
      { p: [0, 0.92, 0.56], r: [0.24, 0.26, 0.24], e: 2.3 },
      { p: [0, 0.95, 0.66], r: [0.1, 0.12, 0.1] },
    ], { sides: 14, round: 0.3, paint: (f) => (f.ny < -0.55 ? CREAM : COAT), coat: (f) => (f.ny < -0.55 ? 0 : 1) }), { coat: 1 }));
    // the dorsal stripe and the shoulder cross
    p.push(tag(loft([
      { p: [0, 1.1, -0.55], r: [0.03, 0.012] }, { p: [0, 1.09, 0.0], r: [0.035, 0.014] }, { p: [0, 1.13, 0.48], r: [0.03, 0.012] },
    ], { sides: 6, sub: 2, paint: DARK, caps: ['pole', 'pole'] }), { coat: 1 }));
    for (const s of [-1, 1]) p.push(tag(loft([
      { p: [s * 0.02, 1.12, 0.36], r: [0.03, 0.01], up: [0, 0, 1] }, { p: [s * 0.2, 1.06, 0.36], r: [0.026, 0.01], up: [0, 0, 1] }, { p: [s * 0.29, 0.94, 0.36], r: [0.01, 0.006], up: [0, 0, 1] },
    ], { sides: 6, sub: 2, paint: DARK, caps: ['pole', 'pole'] }), { coat: 1 }));
    // tail: a thin rope that swings about the rump, a dark tuft lagging behind
    const root: V3 = [0, 1.05, -0.62];
    p.push(tag(loft([
      { p: [0, 1.0, -0.66], r: 0.035 }, { p: [0, 0.88, -0.69], r: 0.026 }, { p: [0, 0.76, -0.69], r: 0.022 },
    ], { sides: 6, sub: 2, paint: COAT, caps: ['pole', 'open'] }), { part: P.TAIL, joint: root, coat: 1 }));
    const tip = { part: P.TAIL_TIP, pivot: [0, 0.77, -0.68] as V3, joint: root, axis: [0, 0, 1] as V3 };
    p.push(tag(loft([
      { p: [0, 0.78, -0.69], r: 0.024 }, { p: [0, 0.7, -0.69], r: 0.055 }, { p: [0, 0.6, -0.69], r: 0.05 }, { p: [0, 0.53, -0.69], r: 0.018 },
    ], { sides: 7, sub: 2, paint: MANE }), tip));
    return rigMerge(p);
  });
}

function head(): THREE.BufferGeometry {
  return cached('donkey:head', () => {
    const p: THREE.BufferGeometry[] = [];
    const hd = { part: P.HEAD, joint: J };
    // neck (rigid): a thick trunk rising forward from the shoulders into the skull
    p.push(tag(loft([
      { p: [0, -0.14, -0.14], r: [0.22, 0.26, 0.28] },
      { p: [0, 0.0, 0.0], r: [0.18, 0.22, 0.22] },
      { p: [0, 0.14, 0.12], r: [0.15, 0.18, 0.17] },
      { p: [0, 0.24, 0.2], r: [0.13, 0.15, 0.14] },
    ], { sides: 12, paint: (f) => (f.nz > 0.45 && f.ny < 0 ? CREAM : COAT), caps: ['open', 'pole'], coat: (f) => (f.nz > 0.45 && f.ny < 0 ? 0 : 1) }), { coat: 1 }));
    // the short upright mane along the crest, a forelock between the ears
    p.push(tag(loft([
      { p: [0, 0.06, -0.2], r: [0.03, 0.06] },
      { p: [0, 0.2, -0.08], r: [0.035, 0.08] },
      { p: [0, 0.33, 0.06], r: [0.035, 0.08] },
      { p: [0, 0.42, 0.17], r: [0.03, 0.06] },
      { p: [0, 0.46, 0.24], r: [0.015, 0.03] },
    ], { sides: 6, sub: 2, round: 0.2, paint: MANE }), { coat: 1 }));
    p.push(tag(blob([0, 0.47, 0.34], [0.05, 0.035, 0.06], { paint: MANE, sides: 8, tilt: -0.4 }), { ...hd, coat: 1 }));
    // skull → long soft face → pale muzzle with a dark tip
    p.push(tag(loft([
      { p: [0, 0.36, 0.2], r: [0.12, 0.11] },
      { p: [0, 0.38, 0.3], r: [0.17, 0.15, 0.14], e: 2.3 },
      { p: [0, 0.33, 0.42], r: [0.15, 0.14, 0.14], e: 2.2 },
      { p: [0, 0.24, 0.54], r: [0.12, 0.12, 0.12], e: 2.2 },
      { p: [0, 0.15, 0.64], r: [0.14, 0.12, 0.11], e: 2.4 },
      { p: [0, 0.12, 0.71], r: [0.12, 0.1, 0.08], e: 2.4 },
      { p: [0, 0.12, 0.74], r: [0.07, 0.05, 0.04] },
    ], {
      sides: 14, round: 0.3,
      paint: (f) => (f.t > 0.88 ? NOSE : f.t > 0.55 ? CREAM : COAT),
      coat: (f) => (f.t > 0.55 ? 0 : 1),
    }), hd));
    // nostrils and a little smile
    for (const s of [-1, 1]) p.push(tag(blob([s * 0.06, 0.15, 0.745], [0.022, 0.03, 0.012], { paint: 0x2e2420, sides: 8, rings: 3 }), hd));
    // pale eye rings
    for (const s of [-1, 1]) p.push(tag(blob([s * 0.135, 0.39, 0.39], [0.045, 0.05, 0.035], { paint: CREAM, sides: 8, rings: 3 }), hd));
    // jaw (chews)
    const jaw = { part: P.JAW, pivot: [0, 0.06, 0.5] as V3, joint: J, axis: [1, 0, 0] as V3 };
    p.push(tag(loft([
      { p: [0, 0.07, 0.5], r: [0.09, 0.04] }, { p: [0, 0.05, 0.62], r: [0.11, 0.05] }, { p: [0, 0.06, 0.7], r: [0.08, 0.035] },
    ], { sides: 10, sub: 2, paint: (f) => (f.y > 0.07 ? 0xc87a72 : CREAM) }), jaw));
    p.push(tag(box(0.18, 0.05, 0.1, 0x4a2424, { p: [0, 0.08, 0.66] }), hd));
    // eyes
    for (const s of [-1, 1]) p.push(...eye([s * 0.14, 0.4, 0.4], 0.05, J, { side: s * 0.5 }));
    // long ears: upright leaves, pale inside, dark tips
    for (const s of [-1, 1]) {
      const pivot: V3 = [s * 0.08, 0.48, 0.28];
      const t = { part: s > 0 ? P.EAR_L : P.EAR_R, pivot, joint: J, axis: [0, 0, s] as V3 };
      p.push(tag(loft([
        { p: [s * 0.08, 0.47, 0.28], r: [0.04, 0.025], up: [0, 0, 1] },
        { p: [s * 0.11, 0.58, 0.27], r: [0.065, 0.028], up: [0, 0, 1] },
        { p: [s * 0.14, 0.7, 0.26], r: [0.06, 0.024], up: [0, 0, 1] },
        { p: [s * 0.16, 0.8, 0.25], r: [0.035, 0.016], up: [0, 0, 1] },
        { p: [s * 0.17, 0.85, 0.245], r: [0.008, 0.006], up: [0, 0, 1] },
      ], { sides: 10, sub: 2, paint: (f) => (f.y > 0.76 ? DARK : f.nz > 0.5 ? 0xe8c8c0 : COAT), coat: (f) => (f.y > 0.76 || f.nz > 0.5 ? 0 : 1) }), t));
    }
    return rigMerge(p);
  });
}

const legLoft = (rings: Ring[], paint: number | ((f: Face) => number), coat?: (f: Face) => number, sides = 9) =>
  loft(rings.map((r) => ({ ...r, up: [0, 0, 1] as V3 })), { sides, sub: 2, paint, coat });

const upper = () => cached('donkey:upper', () => rigMerge([
  tag(legLoft([
    { p: [0, 0.12, -0.01], r: [0.09, 0.1] }, { p: [0, 0.0, 0], r: [0.1, 0.11] }, { p: [0, -0.16, 0.01], r: [0.07, 0.075] }, { p: [0, -0.28, 0], r: [0.055, 0.058] }, { p: [0, -0.32, 0], r: [0.04, 0.04] },
  ], COAT), { coat: 1 }),
]));
const lower = () => cached('donkey:lower', () => rigMerge([
  tag(legLoft([
    { p: [0, 0.03, 0], r: [0.058, 0.06] }, { p: [0, -0.05, 0], r: [0.05, 0.052] }, { p: [0, -0.2, 0], r: [0.042, 0.045] }, { p: [0, -0.26, 0.004], r: [0.048, 0.05] },
  ], (f) => (f.y < -0.17 ? CREAM : COAT), (f) => (f.y < -0.17 ? 0 : 1)), { coat: 1 }),
  legLoft([
    { p: [0, -0.26, 0.006], r: [0.05, 0.054] }, { p: [0, -0.3, 0.01], r: [0.058, 0.062], e: 2.6 }, { p: [0, -0.33, 0.012], r: [0.06, 0.064], e: 2.8 },
  ], HOOF),
]));

export const DONKEY: DonkeyDef = {
  body, head, upper, lower,
  hips: [[0.2, 0.65, 0.42], [-0.2, 0.65, 0.42], [0.2, 0.66, -0.42], [-0.2, 0.66, -0.42]],
  bones: [[0.32, 0.33], [0.32, 0.33], [0.33, 0.33], [0.33, 0.33]],
  boneGeo: [0.32, 0.33],
  cog: [0, 0.85, 0],
  neck: NECK,
  mouth: MOUTH,
  r: 0.4, len: 0.85, lieDrop: [0.55, 0.55],
};
