/**
 * Critter models: chunky, smooth low-poly hulls (sculpt.ts) with a few crisp accents, slightly oversized so they read
 * from first person. Every model is one merged
 * geometry + a rig spec (see rig.ts). Front faces +z, feet at y = 0.
 */
import * as THREE from 'three';
import { PAL } from '../toon.ts';
import { loft } from '../sculpt.ts';
import type { Face, LoftOpts, Ring } from '../sculpt.ts';
import { assemble, flatPoly, piece } from './rig.ts';
import type { Piece, RigSpec } from './rig.ts';

const ball = (r: number, w = 6, h = 4) => new THREE.SphereGeometry(r, w, h);
const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);
const cone = (r: number, h: number, s = 4) => new THREE.ConeGeometry(r, h, s);
const cyl = (rt: number, rb: number, h: number, s = 6) => new THREE.CylinderGeometry(rt, rb, h, s);
const mirror = (pts: readonly (readonly [number, number])[]) => pts.map(([x, z]) => [-x, z] as const);

const X = [1, 0, 0] as const, Y = [0, 1, 0] as const, Z = [0, 0, 1] as const;
/** a smooth sculpted hull (sculpt.ts) for `piece(…, null, …)` */
const L = (rings: readonly Ring[], paint: LoftOpts['paint'], o: Partial<LoftOpts> = {}) => loft(rings, { sides: 10, sub: 2, paint, ...o });

export interface Model { geo: THREE.BufferGeometry; spec: RigSpec }

// ---------------------------------------------------------------------------------------------
// Birds. Channels (songbird / crow):
//   0 flap (rad, + = up)  1 fold (0 open … 1 folded: wrist flexes, primaries sweep back)  2 head pitch  3 head yaw
//   4 flight wings (−1 tucks them away: perched)  5 tail pitch  6 head tilt (roll)  7 tail fan  8 legs tuck
//   9 sweep (+ back, − forward: landing flare)
// Masks: 1 = tint (back, crown, wings), 2 = tint2 (breast, cheeks).

const LIGHT = 0xece6dc;

const wingOps = (s: number, flap: number, hide: number, sweep: number) => [
  { axis: Z, ch: flap, gain: s }, { axis: Y, ch: sweep, gain: s * 0.9 }, { axis: 'scale' as const, ch: hide },
];
const tipOps = (s: number, fold: number) => [{ axis: Y, ch: fold, gain: s * 1.5 }, { axis: Z, ch: fold, gain: -s * 0.9 }];

export const BIRD_SPEC: RigSpec = {
  name: 'songbird',
  parts: [
    { id: 1, pivot: [0.055, 0.155, 0.02], ops: wingOps(1, 0, 4, 9) },
    { id: 2, pivot: [-0.055, 0.155, 0.02], ops: wingOps(-1, 0, 4, 9) },
    { id: 5, pivot: [0.128, 0.155, 0.02], parent: 1, ops: tipOps(1, 1) },
    { id: 6, pivot: [-0.128, 0.155, 0.02], parent: 2, ops: tipOps(-1, 1) },
    { id: 3, pivot: [0, 0.17, 0.07], ops: [{ axis: Z, ch: 6 }, { axis: X, ch: 2 }, { axis: Y, ch: 3 }] },
    { id: 4, pivot: [0, 0.14, -0.09], ops: [{ axis: X, ch: 5, gain: -1 }, { axis: X, mode: 'stretch', ch: 7, gain: 0.9 }] },
    { id: 7, pivot: [0, 0.075, 0.01], ops: [{ axis: X, ch: 8, gain: 1.3 }] },
  ],
};

const innerWing = [[0, 0.05], [0.073, 0.045], [0.077, -0.055], [0, -0.07]] as const;
const outerWing = [[0, 0.045], [0.045, 0.035], [0.095, -0.015], [0.075, -0.06], [0.03, -0.075], [0, -0.055]] as const;
const tailFan = [[0, 0.02], [0.03, 0.01], [0.035, -0.1], [0, -0.085], [-0.035, -0.1], [-0.03, 0.01]] as const;

export function songbird(): Model {
  const beak = 0x5a4632;
  const p: Piece[] = [
    // one plump body: tinted back, tint2 breast
    piece(L([
      { p: [0, 0.15, -0.12], r: 0.02 }, { p: [0, 0.14, -0.09], r: [0.06, 0.055, 0.05] }, { p: [0, 0.13, -0.03], r: [0.08, 0.075, 0.07] },
      { p: [0, 0.125, 0.04], r: [0.078, 0.075, 0.072] }, { p: [0, 0.14, 0.08], r: [0.06, 0.06, 0.05] }, { p: [0, 0.158, 0.1], r: 0.035 },
    ], (f) => Math.sin(f.a) < -0.25 && f.t > 0.3 ? 0xffffff : LIGHT, { coat: (f) => Math.sin(f.a) < -0.25 && f.t > 0.3 ? 2 : 1 }), null, { mask: 1 }),
    piece(L([
      { p: [0, 0.19, 0.03], r: 0.035 }, { p: [0, 0.196, 0.065], r: [0.06, 0.06, 0.056] }, { p: [0, 0.19, 0.11], r: [0.054, 0.05, 0.05] }, { p: [0, 0.184, 0.142], r: 0.024 },
    ], (f) => Math.sin(f.a) < -0.2 && f.t > 0.35 ? 0xffffff : LIGHT, { coat: (f) => Math.sin(f.a) < -0.2 && f.t > 0.35 ? 2 : 1 }), null, { part: 3, mask: 1 }),
    piece(cone(0.018, 0.05, 5), beak, { at: [0, 0.186, 0.162], rot: [Math.PI / 2, 0, 0], part: 3 }),
    piece(ball(0.013, 6, 5), PAL.ink, { at: [0.046, 0.2, 0.108], part: 3 }),
    piece(ball(0.013, 6, 5), PAL.ink, { at: [-0.046, 0.2, 0.108], part: 3 }),
    piece(ball(0.0045, 3, 2), 0xffffff, { at: [0.054, 0.205, 0.116], part: 3 }),
    piece(ball(0.0045, 3, 2), 0xffffff, { at: [-0.054, 0.205, 0.116], part: 3 }),
    piece(flatPoly(tailFan), 0xb8b0a4, { at: [0, 0.15, -0.1], rot: [0.35, 0, 0], part: 4, mask: 1 }),
    // folded wing covers (what a perched bird shows): smooth leaves with dark primaries
    ...[1, -1].map((s) => piece(L([
      { p: [s * 0.066, 0.15, 0.04], r: [0.012, 0.03] }, { p: [s * 0.074, 0.145, -0.01], r: [0.016, 0.042] }, { p: [s * 0.074, 0.135, -0.07], r: [0.012, 0.03] }, { p: [s * 0.066, 0.125, -0.115], r: [0.006, 0.012] },
    ], (f) => f.t > 0.62 ? 0x8a8276 : 0xc4baac), null, { mask: 1 })),
    // flight wings: inner (shoulder) + outer (hand) that folds at the wrist
    piece(flatPoly(innerWing), 0xd6cec2, { at: [0.055, 0.155, 0.02], part: 1, mask: 1 }),
    piece(flatPoly(mirror(innerWing)), 0xd6cec2, { at: [-0.055, 0.155, 0.02], part: 2, mask: 1 }),
    piece(flatPoly(outerWing), 0xa89e92, { at: [0.128, 0.155, 0.02], part: 5, mask: 1 }),
    piece(flatPoly(mirror(outerWing)), 0xa89e92, { at: [-0.128, 0.155, 0.02], part: 6, mask: 1 }),
    // legs and toes
    piece(box(0.011, 0.07, 0.011), 0xd08a4a, { at: [0.025, 0.04, 0.01], part: 7 }),
    piece(box(0.011, 0.07, 0.011), 0xd08a4a, { at: [-0.025, 0.04, 0.01], part: 7 }),
    piece(box(0.03, 0.008, 0.035), 0xd08a4a, { at: [0.025, 0.005, 0.02], part: 7 }),
    piece(box(0.03, 0.008, 0.035), 0xd08a4a, { at: [-0.025, 0.005, 0.02], part: 7 }),
  ];
  return { geo: assemble(p), spec: BIRD_SPEC };
}

// Pigeon: the songbird channels, plus 6 letter (−1 hides), 8 left leg, 10 head bob (move along z), 11 right leg.
export const PIGEON_SPEC: RigSpec = {
  name: 'pigeon',
  parts: [
    { id: 1, pivot: [0.08, 0.2, 0.02], ops: wingOps(1, 0, 4, 9) },
    { id: 2, pivot: [-0.08, 0.2, 0.02], ops: wingOps(-1, 0, 4, 9) },
    { id: 5, pivot: [0.175, 0.2, 0.02], parent: 1, ops: tipOps(1, 1) },
    { id: 6, pivot: [-0.175, 0.2, 0.02], parent: 2, ops: tipOps(-1, 1) },
    { id: 3, pivot: [0, 0.22, 0.09], ops: [{ axis: Z, mode: 'move', ch: 10 }, { axis: X, ch: 2 }, { axis: Y, ch: 3 }] },
    { id: 4, pivot: [0, 0.18, -0.12], ops: [{ axis: X, ch: 5, gain: -1 }, { axis: X, mode: 'stretch', ch: 7, gain: 0.9 }] },
    { id: 7, pivot: [0.035, 0.09, 0.02], ops: [{ axis: X, ch: 8 }] },
    { id: 9, pivot: [-0.035, 0.09, 0.02], ops: [{ axis: X, ch: 11 }] },
    { id: 8, pivot: [0, 0.14, 0.14], ops: [{ axis: 'scale', ch: 6 }] },
  ],
};

const pInner = [[0, 0.07], [0.1, 0.06], [0.1, -0.08], [0, -0.1]] as const;
const pOuter = [[0, 0.06], [0.06, 0.045], [0.13, -0.02], [0.1, -0.1], [0.04, -0.11], [0, -0.08]] as const;

export function pigeon(): Model {
  const grey = 0xa9b0c0, dark = 0x6f7688, leather = 0x9a6a3a;
  const p: Piece[] = [
    // body rising into the iridescent neck in one piece
    piece(L([
      { p: [0, 0.18, -0.15], r: 0.03 }, { p: [0, 0.175, -0.11], r: [0.08, 0.075, 0.07] }, { p: [0, 0.16, -0.03], r: [0.11, 0.1, 0.1] },
      { p: [0, 0.16, 0.05], r: [0.105, 0.1, 0.1] }, { p: [0, 0.19, 0.1], r: [0.08, 0.08, 0.08] }, { p: [0, 0.228, 0.115], r: 0.064 }, { p: [0, 0.255, 0.115], r: 0.04 },
    ], (f) => f.t > 0.8 ? 0x7fa39a : Math.sin(f.a) < -0.3 ? 0xb8bfd0 : grey, { coat: (f) => f.t > 0.8 ? 0.3 : 1 }), null, { mask: 1 }),
    piece(L([
      { p: [0, 0.27, 0.07], r: 0.035 }, { p: [0, 0.278, 0.1], r: [0.058, 0.056, 0.054] }, { p: [0, 0.27, 0.14], r: [0.045, 0.04, 0.04] }, { p: [0, 0.266, 0.162], r: 0.018 },
    ], grey), null, { part: 3, mask: 1 }),
    piece(cone(0.016, 0.05, 5), 0x4a4a52, { at: [0, 0.265, 0.18], rot: [Math.PI / 2, 0, 0], part: 3 }),
    piece(ball(0.012, 4, 3), 0xf4f0ea, { at: [0, 0.278, 0.162], scale: [1.4, 0.8, 1], part: 3 }),
    piece(ball(0.014, 6, 5), 0xe8762c, { at: [0.043, 0.285, 0.128], part: 3 }),
    piece(ball(0.014, 6, 5), 0xe8762c, { at: [-0.043, 0.285, 0.128], part: 3 }),
    piece(ball(0.007, 4, 3), PAL.ink, { at: [0.051, 0.287, 0.134], part: 3 }),
    piece(ball(0.007, 4, 3), PAL.ink, { at: [-0.051, 0.287, 0.134], part: 3 }),
    piece(flatPoly(tailFan), dark, { at: [0, 0.18, -0.13], rot: [0.2, 0, 0], scale: [1.35, 1, 1.3], part: 4, mask: 0.6 }),
    ...[1, -1].map((s) => piece(L([
      { p: [s * 0.09, 0.2, 0.05], r: [0.014, 0.04] }, { p: [s * 0.1, 0.19, -0.01], r: [0.02, 0.055] }, { p: [s * 0.1, 0.18, -0.09], r: [0.016, 0.042] }, { p: [s * 0.09, 0.17, -0.15], r: [0.008, 0.016] },
    ], (f) => f.t > 0.58 ? 0x4a4f5e : 0x8d95a8), null, { mask: 1 })),
    piece(flatPoly(pInner), 0x9aa2b4, { at: [0.08, 0.2, 0.02], part: 1, mask: 1 }),
    piece(flatPoly(mirror(pInner)), 0x9aa2b4, { at: [-0.08, 0.2, 0.02], part: 2, mask: 1 }),
    piece(flatPoly(pOuter), 0x7c8498, { at: [0.175, 0.2, 0.02], part: 5, mask: 1 }),
    piece(flatPoly(mirror(pOuter)), 0x7c8498, { at: [-0.175, 0.2, 0.02], part: 6, mask: 1 }),
    // legs (walk one at a time)
    piece(box(0.016, 0.08, 0.016), 0xd9776a, { at: [0.035, 0.05, 0.02], part: 7 }),
    piece(box(0.04, 0.01, 0.045), 0xd9776a, { at: [0.035, 0.008, 0.035], part: 7 }),
    piece(box(0.016, 0.08, 0.016), 0xd9776a, { at: [-0.035, 0.05, 0.02], part: 9 }),
    piece(box(0.04, 0.01, 0.045), 0xd9776a, { at: [-0.035, 0.008, 0.035], part: 9 }),
    // the letter pouch on a strap round the chest, a letter peeking out
    piece(new THREE.TorusGeometry(0.1, 0.009, 3, 10), leather, { at: [0, 0.2, 0.05], rot: [Math.PI / 2 - 0.9, 0, 0], scale: [1, 1.2, 1] }),
    piece(box(0.075, 0.06, 0.03), leather, { at: [0, 0.13, 0.14], rot: [0.25, 0, 0] }),
    piece(box(0.078, 0.025, 0.034), 0x7a4e28, { at: [0, 0.158, 0.148], rot: [0.25, 0, 0] }),
    piece(ball(0.008, 4, 3), PAL.yellow, { at: [0, 0.148, 0.168] }),
    piece(box(0.06, 0.045, 0.006), 0xfaf3e0, { at: [0, 0.165, 0.13], rot: [0.2, 0, 0.1], part: 8 }),
    piece(box(0.014, 0.014, 0.008), PAL.red, { at: [0.012, 0.18, 0.135], rot: [0.2, 0, 0.1], part: 8 }),
  ];
  return { geo: assemble(p), spec: PIGEON_SPEC };
}

// ---------------------------------------------------------------------------------------------
// Butterfly: 0 fore-wing flap, 1 hind-wing flap (lags a touch), 2 body/antennae bob.
// Dragonfly: 0 fore wings, 1 hind wings (out of phase), 2 abdomen pitch.

export const BUTTERFLY_SPEC: RigSpec = {
  name: 'butterfly',
  parts: [
    { id: 1, pivot: [0.004, 0, 0], ops: [{ axis: Z, ch: 0 }] },
    { id: 2, pivot: [-0.004, 0, 0], ops: [{ axis: Z, ch: 0, gain: -1 }] },
    { id: 3, pivot: [0.004, 0, 0], ops: [{ axis: Z, ch: 1 }] },
    { id: 4, pivot: [-0.004, 0, 0], ops: [{ axis: Z, ch: 1, gain: -1 }] },
    { id: 5, pivot: [0, 0.004, 0.04], ops: [{ axis: X, ch: 2 }] },
  ],
};
const foreWing = [[0.004, 0.015], [0.04, 0.075], [0.085, 0.09], [0.115, 0.07], [0.1, 0.01], [0.004, -0.005]] as const;
const hindWing = [[0.004, -0.004], [0.07, -0.012], [0.078, -0.05], [0.055, -0.085], [0.02, -0.08]] as const;
const wingTip = [[0.075, 0.085], [0.115, 0.07], [0.108, 0.045], [0.085, 0.06]] as const;
const wingSpot = [[0.05, -0.03], [0.062, -0.035], [0.058, -0.05], [0.045, -0.045]] as const;

export function butterfly(): Model {
  const ink = 0x3a2e28;
  const p: Piece[] = [
    piece(cyl(0.008, 0.005, 0.085, 5), ink, { rot: [Math.PI / 2, 0, 0], at: [0, 0, -0.015] }),
    piece(ball(0.011, 5, 4), ink, { at: [0, 0.002, 0.035] }),
    piece(ball(0.0105, 5, 4), ink, { at: [0, 0.004, 0.05], part: 5 }),
    piece(box(0.003, 0.003, 0.045), ink, { at: [0.012, 0.018, 0.075], rot: [0.55, 0.35, 0], part: 5 }),
    piece(box(0.003, 0.003, 0.045), ink, { at: [-0.012, 0.018, 0.075], rot: [0.55, -0.35, 0], part: 5 }),
    piece(ball(0.005, 3, 2), ink, { at: [0.022, 0.03, 0.093], part: 5 }),
    piece(ball(0.005, 3, 2), ink, { at: [-0.022, 0.03, 0.093], part: 5 }),
    piece(flatPoly(foreWing), 0xffffff, { part: 1, mask: 1 }),
    piece(flatPoly(wingTip), 0x2e2622, { part: 1, at: [0, 0.0015, 0] }),
    piece(flatPoly(hindWing), 0xf2f2f2, { part: 3, mask: 2 }),
    piece(flatPoly(wingSpot), 0x2e2622, { part: 3, at: [0, 0.0015, 0] }),
    piece(flatPoly(mirror(foreWing)), 0xffffff, { part: 2, mask: 1 }),
    piece(flatPoly(mirror(wingTip)), 0x2e2622, { part: 2, at: [0, 0.0015, 0] }),
    piece(flatPoly(mirror(hindWing)), 0xf2f2f2, { part: 4, mask: 2 }),
    piece(flatPoly(mirror(wingSpot)), 0x2e2622, { part: 4, at: [0, 0.0015, 0] }),
  ];
  return { geo: assemble(p), spec: BUTTERFLY_SPEC };
}

export const DRAGONFLY_SPEC: RigSpec = {
  name: 'dragonfly',
  parts: [
    { id: 1, pivot: [0.006, 0.012, 0.018], ops: [{ axis: Z, ch: 0 }] },
    { id: 2, pivot: [-0.006, 0.012, 0.018], ops: [{ axis: Z, ch: 0, gain: -1 }] },
    { id: 3, pivot: [0.006, 0.012, -0.012], ops: [{ axis: Z, ch: 1 }] },
    { id: 4, pivot: [-0.006, 0.012, -0.012], ops: [{ axis: Z, ch: 1, gain: -1 }] },
    { id: 5, pivot: [0, 0.004, -0.02], ops: [{ axis: X, ch: 2 }] },
  ],
};
const dWing = (len: number, w: number) => [[0.005, w * 0.5], [len * 0.6, w * 0.6], [len, w * 0.2], [len + 0.008, -w * 0.3], [len * 0.5, -w * 0.5], [0.005, -w * 0.4]] as const;

export function dragonfly(): Model {
  const wing = 0xe6f4ff;
  const p: Piece[] = [
    piece(box(0.013, 0.013, 0.15), 0xffffff, { at: [0, 0.002, -0.095], part: 5, mask: 1 }),
    piece(box(0.016, 0.004, 0.008), 0x1a2433, { at: [0, 0.009, -0.05], part: 5 }),
    piece(box(0.016, 0.004, 0.008), 0x1a2433, { at: [0, 0.009, -0.09], part: 5 }),
    piece(box(0.016, 0.004, 0.008), 0x1a2433, { at: [0, 0.009, -0.13], part: 5 }),
    piece(ball(0.02, 6, 4), 0xffffff, { at: [0, 0.004, 0.005], scale: [1, 1, 1.5], mask: 1 }),
    piece(ball(0.015, 6, 4), 0x2b3b5a, { at: [0.012, 0.01, 0.04] }),
    piece(ball(0.015, 6, 4), 0x2b3b5a, { at: [-0.012, 0.01, 0.04] }),
    piece(ball(0.004, 3, 2), 0xffffff, { at: [0.016, 0.018, 0.046] }),
    piece(ball(0.004, 3, 2), 0xffffff, { at: [-0.008, 0.018, 0.046] }),
    piece(flatPoly(dWing(0.11, 0.024)), wing, { part: 1, at: [0.006, 0.012, 0.018] }),
    piece(flatPoly(mirror(dWing(0.11, 0.024))), wing, { part: 2, at: [-0.006, 0.012, 0.018] }),
    piece(flatPoly(dWing(0.1, 0.028)), wing, { part: 3, at: [0.006, 0.012, -0.012] }),
    piece(flatPoly(mirror(dWing(0.1, 0.028))), wing, { part: 4, at: [-0.006, 0.012, -0.012] }),
    piece(box(0.012, 0.002, 0.006), 0x3a4a5a, { part: 1, at: [0.1, 0.0125, 0.024] }),
    piece(box(0.012, 0.002, 0.006), 0x3a4a5a, { part: 2, at: [-0.1, 0.0125, 0.024] }),
  ];
  return { geo: assemble(p), spec: DRAGONFLY_SPEC };
}

// ---------------------------------------------------------------------------------------------
// Fish: 0 mid-body yaw, 1 tail yaw, 2 fin yaw (a travelling wave), 3 pectoral flutter.
// Frog: 0 throat sac (−0.55 rest … 0.5 full), 1 blink (0 open … −0.9 shut), 2 thighs (+ kick back),
//       3 shins (+ straighten), 4 arms (− reach forward).

export const FISH_SPEC: RigSpec = {
  name: 'fish',
  parts: [
    { id: 1, pivot: [0, 0, 0.02], ops: [{ axis: Y, ch: 0 }] },
    { id: 2, pivot: [0, 0, -0.07], parent: 1, ops: [{ axis: Y, ch: 1 }] },
    { id: 3, pivot: [0, 0, -0.14], parent: 2, ops: [{ axis: Y, ch: 2 }] },
    { id: 4, pivot: [0.04, -0.02, 0.06], ops: [{ axis: Z, ch: 3 }] },
    { id: 5, pivot: [-0.04, -0.02, 0.06], ops: [{ axis: Z, ch: 3, gain: -1 }] },
  ],
};

export function fish(): Model {
  const tail = [[0, 0], [0.075, -0.11], [0.02, -0.075], [0, -0.09], [-0.02, -0.075], [-0.075, -0.11]] as const;
  const belly = (f: Face) => Math.sin(f.a) < -0.45;
  const p: Piece[] = [
    piece(L([
      { p: [0, 0, -0.03], r: [0.042, 0.06] }, { p: [0, 0.002, 0.05], r: [0.048, 0.07, 0.068] }, { p: [0, -0.002, 0.12], r: [0.036, 0.05, 0.048] }, { p: [0, -0.006, 0.16], r: [0.016, 0.02] },
    ], (f) => belly(f) ? 0xf4efe4 : 0xffffff, { coat: (f) => belly(f) ? 0 : 1, caps: ['open', 'pole'] }), null, { mask: 1 }),
    piece(L([
      { p: [0, 0, -0.1], r: [0.03, 0.045] }, { p: [0, 0, -0.03], r: [0.041, 0.06] }, { p: [0, 0, 0.0], r: [0.042, 0.061] },
    ], (f) => belly(f) ? 0xf4efe4 : 0xffffff, { coat: (f) => belly(f) ? 0 : 1, caps: ['pole', 'open'] }), null, { part: 1, mask: 1 }),
    piece(flatPoly([[0, 0.05], [0.07, -0.02], [0, -0.07]]), 0xffffff, { at: [0, 0.065, -0.01], rot: [0, 0, Math.PI / 2], part: 1, mask: 1.8 }),
    piece(L([{ p: [0, 0, -0.08], r: [0.028, 0.04] }, { p: [0, 0, -0.12], r: [0.018, 0.026] }, { p: [0, 0, -0.15], r: [0.008, 0.012] }], 0xffffff), null, { part: 2, mask: 1 }),
    piece(flatPoly(tail), 0xffffff, { at: [0, 0, -0.14], rot: [0, 0, Math.PI / 2], part: 3, mask: 1.8 }),
    piece(flatPoly([[0, 0.012], [0.045, -0.015], [0.03, -0.035], [0, -0.012]]), 0xffffff, { at: [0.04, -0.02, 0.06], part: 4, mask: 1.8 }),
    piece(flatPoly(mirror([[0, 0.012], [0.045, -0.015], [0.03, -0.035], [0, -0.012]])), 0xffffff, { at: [-0.04, -0.02, 0.06], part: 5, mask: 1.8 }),
    piece(ball(0.014, 6, 5), 0xffffff, { at: [0.033, 0.02, 0.122] }),
    piece(ball(0.014, 6, 5), 0xffffff, { at: [-0.033, 0.02, 0.122] }),
    piece(ball(0.009, 4, 3), PAL.ink, { at: [0.042, 0.02, 0.126] }),
    piece(ball(0.009, 4, 3), PAL.ink, { at: [-0.042, 0.02, 0.126] }),
    piece(box(0.03, 0.006, 0.01), 0x8a4a3a, { at: [0, -0.01, 0.168] }),
  ];
  return { geo: assemble(p), spec: FISH_SPEC };
}

export const FROG_SPEC: RigSpec = {
  name: 'frog',
  parts: [
    { id: 1, pivot: [0, 0.045, 0.085], ops: [{ axis: 'scale', ch: 0 }] },
    { id: 2, pivot: [0, 0.12, 0.068], ops: [{ axis: Y, mode: 'stretch', ch: 1 }] },
    { id: 3, pivot: [0.06, 0.055, -0.045], ops: [{ axis: X, ch: 2 }, { axis: Y, ch: 2, gain: -0.4 }] },
    { id: 4, pivot: [0.1, 0.035, 0.04], parent: 3, ops: [{ axis: X, ch: 3, gain: -1 }] },
    { id: 5, pivot: [-0.06, 0.055, -0.045], ops: [{ axis: X, ch: 2 }, { axis: Y, ch: 2, gain: 0.4 }] },
    { id: 6, pivot: [-0.1, 0.035, 0.04], parent: 5, ops: [{ axis: X, ch: 3, gain: -1 }] },
    { id: 7, pivot: [0, 0.07, 0.07], ops: [{ axis: X, ch: 4 }] },
  ],
};

export function frog(): Model {
  const g = 0x7fb04a, dk = 0x55803a, belly = 0xe8e0a8;
  const p: Piece[] = [
    // one squat body: wide flat head end, round rump, pale belly, a few darker spots
    piece(L([
      { p: [0, 0.07, -0.1], r: 0.03 }, { p: [0, 0.07, -0.07], r: [0.075, 0.05, 0.04] }, { p: [0, 0.072, -0.01], r: [0.092, 0.058, 0.045] },
      { p: [0, 0.07, 0.05], r: [0.088, 0.055, 0.042] }, { p: [0, 0.066, 0.095], r: [0.066, 0.04, 0.03] }, { p: [0, 0.064, 0.115], r: [0.03, 0.02] },
    ], (f) => {
      if (Math.sin(f.a) < -0.35) return belly;
      return Math.sin(f.x * 70 + 1) * Math.sin(f.z * 60) > 0.72 && f.ny > 0.5 ? dk : g;
    }, { sides: 14, coat: (f) => Math.sin(f.a) < -0.35 ? 0 : 1 }), null, { mask: 1 }),
    // eyes on top (blink squashes them)
    piece(ball(0.03, 8, 6), g, { at: [0.045, 0.112, 0.062], part: 2, mask: 1 }),
    piece(ball(0.03, 8, 6), g, { at: [-0.045, 0.112, 0.062], part: 2, mask: 1 }),
    piece(ball(0.018, 7, 5), 0xf2e6a0, { at: [0.052, 0.12, 0.08], part: 2 }),
    piece(ball(0.018, 7, 5), 0xf2e6a0, { at: [-0.052, 0.12, 0.08], part: 2 }),
    piece(box(0.024, 0.01, 0.01), PAL.ink, { at: [0.055, 0.121, 0.096], part: 2 }),
    piece(box(0.024, 0.01, 0.01), PAL.ink, { at: [-0.055, 0.121, 0.096], part: 2 }),
    piece(box(0.07, 0.006, 0.01), 0x3a5a2a, { at: [0, 0.066, 0.108], rot: [0, 0, 0] }),
    // throat sac
    piece(ball(0.036, 7, 5), 0xf3e9b0, { at: [0, 0.045, 0.085], part: 1 }),
    // hind legs: a fat thigh and a folded shin + webbed foot (fold at the sides; extend on a jump)
    ...[1, -1].flatMap((s) => [
      piece(L([{ p: [s * 0.055, 0.06, -0.06], r: 0.03 }, { p: [s * 0.085, 0.045, -0.02], r: [0.03, 0.028] }, { p: [s * 0.1, 0.035, 0.03], r: [0.02, 0.018] }], dk), null, { part: s > 0 ? 3 : 5, mask: 1 }),
      piece(L([{ p: [s * 0.1, 0.03, 0.035], r: 0.016 }, { p: [s * 0.105, 0.016, -0.01], r: [0.016, 0.012] }, { p: [s * 0.1, 0.01, -0.04], r: 0.01 }], dk), null, { part: s > 0 ? 4 : 6, mask: 1 }),
      piece(L([{ p: [s * 0.1, 0.006, 0.03], r: [0.012, 0.004], up: [0, 1, 0] }, { p: [s * 0.108, 0.005, 0.075], r: [0.028, 0.004], up: [0, 1, 0] }, { p: [s * 0.11, 0.005, 0.1], r: [0.02, 0.003], up: [0, 1, 0] }], dk), null, { part: s > 0 ? 4 : 6, mask: 1 }),
    ]),
    // arms
    // short splayed forearms, elbows out, hands turned out with little finger pads
    piece(box(0.016, 0.042, 0.016), g, { at: [0.058, 0.026, 0.074], rot: [0.25, 0, -0.45], part: 7, mask: 1 }),
    piece(box(0.016, 0.042, 0.016), g, { at: [-0.058, 0.026, 0.074], rot: [0.25, 0, 0.45], part: 7, mask: 1 }),
    piece(box(0.034, 0.006, 0.026), g, { at: [0.07, 0.004, 0.09], rot: [0, -0.5, 0], part: 7, mask: 1 }),
    piece(box(0.034, 0.006, 0.026), g, { at: [-0.07, 0.004, 0.09], rot: [0, 0.5, 0], part: 7, mask: 1 }),
    piece(ball(0.006, 3, 2), belly, { at: [0.086, 0.006, 0.1], part: 7 }),
    piece(ball(0.006, 3, 2), belly, { at: [0.074, 0.006, 0.108], part: 7 }),
    piece(ball(0.006, 3, 2), belly, { at: [-0.086, 0.006, 0.1], part: 7 }),
    piece(ball(0.006, 3, 2), belly, { at: [-0.074, 0.006, 0.108], part: 7 }),
  ];
  return { geo: assemble(p), spec: FROG_SPEC };
}

// ---------------------------------------------------------------------------------------------
// Rabbit: 0 head pitch, 1 head yaw, 2/3 ear L/R flop (+ back), 4/5 ear L/R turn (swivel), 6 nose twitch,
//         7 fore legs (− reach forward / raise to groom), 8 hind legs (+ kick back), 9 tail puff.
// Squirrel: 0 head pitch, 1 head yaw, 2..4 tail segments (base → tip), 5 fore paws (− raise to the mouth),
//           6 hind legs, 7 nut (−1 hides).

export const RABBIT_SPEC: RigSpec = {
  name: 'rabbit',
  parts: [
    { id: 1, pivot: [0, 0.24, 0.1], ops: [{ axis: X, ch: 0 }, { axis: Y, ch: 1 }] },
    { id: 2, pivot: [0.035, 0.32, 0.1], parent: 1, ops: [{ axis: Y, ch: 4 }, { axis: X, ch: 2, gain: -1 }] },
    { id: 3, pivot: [-0.035, 0.32, 0.1], parent: 1, ops: [{ axis: Y, ch: 5, gain: -1 }, { axis: X, ch: 3, gain: -1 }] },
    { id: 4, pivot: [0, 0.255, 0.225], parent: 1, ops: [{ axis: 'scale', ch: 6 }] },
    { id: 5, pivot: [0, 0.13, 0.08], ops: [{ axis: X, ch: 7 }] },
    { id: 6, pivot: [0, 0.14, -0.1], ops: [{ axis: X, ch: 8 }] },
    { id: 7, pivot: [0, 0.17, -0.19], ops: [{ axis: 'scale', ch: 9 }, { axis: X, ch: 9, gain: -0.6 }] },
  ],
};

export function rabbit(): Model {
  const fur = 0xf2ede6, cream = 0xfff8f0;
  const p: Piece[] = [
    // a soft loaf of a body, cream underneath
    piece(L([
      { p: [0, 0.17, -0.2], r: 0.04 }, { p: [0, 0.165, -0.16], r: [0.1, 0.1, 0.085] }, { p: [0, 0.155, -0.07], r: [0.13, 0.12, 0.1] },
      { p: [0, 0.15, 0.03], r: [0.115, 0.11, 0.095] }, { p: [0, 0.17, 0.1], r: [0.085, 0.085, 0.08] }, { p: [0, 0.2, 0.13], r: 0.05 },
    ], (f) => Math.sin(f.a) < -0.45 ? cream : fur, { sides: 14, coat: (f) => Math.sin(f.a) < -0.45 ? 0 : 1 }), null, { mask: 1 }),
    // head: round, a little snout, cream cheeks
    piece(L([
      { p: [0, 0.255, 0.05], r: 0.05 }, { p: [0, 0.262, 0.1], r: [0.085, 0.08, 0.078] }, { p: [0, 0.255, 0.16], r: [0.08, 0.075, 0.07] },
      { p: [0, 0.245, 0.205], r: [0.048, 0.042, 0.04] }, { p: [0, 0.248, 0.225], r: 0.02 },
    ], (f) => f.t > 0.55 && Math.sin(f.a) < 0.2 ? cream : fur, { sides: 12, coat: (f) => f.t > 0.55 && Math.sin(f.a) < 0.2 ? 0 : 1 }), null, { part: 1, mask: 1 }),
    piece(ball(0.016, 5, 4), 0xe89aa6, { at: [0, 0.256, 0.226], part: 4 }),
    piece(ball(0.022, 8, 6), PAL.ink, { at: [0.062, 0.28, 0.158], scale: [0.6, 1.1, 0.95], rot: [0, 0.6, 0], part: 1 }),
    piece(ball(0.022, 8, 6), PAL.ink, { at: [-0.062, 0.28, 0.158], scale: [0.6, 1.1, 0.95], rot: [0, -0.6, 0], part: 1 }),
    piece(ball(0.007, 4, 3), 0xffffff, { at: [0.072, 0.289, 0.166], part: 1 }),
    piece(ball(0.007, 4, 3), 0xffffff, { at: [-0.072, 0.289, 0.166], part: 1 }),
    // long ears, pink inside
    ...[1, -1].map((s) => piece(L([
      { p: [s * 0.032, 0.3, 0.1], r: [0.022, 0.014], up: [0, 0, 1] }, { p: [s * 0.04, 0.37, 0.095], r: [0.036, 0.016], up: [0, 0, 1] },
      { p: [s * 0.045, 0.45, 0.085], r: [0.03, 0.013], up: [0, 0, 1] }, { p: [s * 0.046, 0.5, 0.08], r: [0.01, 0.008], up: [0, 0, 1] },
    ], (f) => f.nz > 0.55 && f.t > 0.15 && f.t < 0.9 ? 0xe9b4b8 : fur, { coat: (f) => f.nz > 0.55 && f.t > 0.15 && f.t < 0.9 ? 0 : 1 }), null, { part: s > 0 ? 2 : 3, mask: 1 })),
    piece(L([{ p: [0, 0.175, -0.17], r: 0.03 }, { p: [0, 0.18, -0.2], r: 0.045 }, { p: [0, 0.18, -0.235], r: 0.02 }], 0xffffff, { sides: 9 }), null, { part: 7 }),
    // hind: a big haunch running into a long foot
    ...[1, -1].flatMap((s) => [
      piece(L([{ p: [s * 0.07, 0.15, -0.13], r: [0.035, 0.05] }, { p: [s * 0.08, 0.1, -0.08], r: [0.042, 0.06] }, { p: [s * 0.08, 0.06, -0.05], r: [0.03, 0.035] }], fur), null, { part: 6, mask: 1 }),
      piece(L([{ p: [s * 0.078, 0.025, -0.1], r: [0.022, 0.018], up: [0, 1, 0] }, { p: [s * 0.078, 0.018, -0.03], r: [0.024, 0.016], up: [0, 1, 0] }, { p: [s * 0.078, 0.014, 0.025], r: [0.016, 0.01], up: [0, 1, 0] }], fur), null, { part: 6, mask: 1 }),
    ]),
    ...[1, -1].map((s) => piece(L(([{ p: [s * 0.045, 0.13, 0.09], r: 0.02 }, { p: [s * 0.045, 0.06, 0.095], r: 0.017 }, { p: [s * 0.045, 0.012, 0.105], r: [0.016, 0.02] }] as Ring[]).map((r) => ({ ...r, up: [0, 0, 1] as const })), fur), null, { part: 5, mask: 1 })),
  ];
  return { geo: assemble(p), spec: RABBIT_SPEC };
}

export const SQUIRREL_SPEC: RigSpec = {
  name: 'squirrel',
  parts: [
    { id: 1, pivot: [0, 0.14, 0.06], ops: [{ axis: X, ch: 0 }, { axis: Y, ch: 1 }] },
    { id: 2, pivot: [0, 0.09, -0.08], ops: [{ axis: X, ch: 2, gain: -1 }] },
    { id: 3, pivot: [0, 0.17, -0.13], parent: 2, ops: [{ axis: X, ch: 3, gain: -1 }] },
    { id: 4, pivot: [0, 0.26, -0.13], parent: 3, ops: [{ axis: X, ch: 4, gain: -1 }] },
    { id: 5, pivot: [0, 0.1, 0.06], ops: [{ axis: X, ch: 5 }] },
    { id: 6, pivot: [0, 0.1, 0.06], parent: 5, ops: [{ axis: 'scale', ch: 7 }] },
    { id: 7, pivot: [0, 0.07, -0.03], ops: [{ axis: X, ch: 6 }] },
  ],
};

export function squirrel(): Model {
  const fur = 0xc0643a, belly = 0xf4dcc0, tail = 0xd07a48, tip = 0xe8a070;
  const p: Piece[] = [
    piece(L([
      { p: [0, 0.1, -0.09], r: 0.03 }, { p: [0, 0.1, -0.06], r: [0.06, 0.065, 0.06] }, { p: [0, 0.1, 0.0], r: [0.064, 0.07, 0.065] },
      { p: [0, 0.115, 0.05], r: [0.05, 0.055, 0.05] }, { p: [0, 0.14, 0.075], r: 0.03 },
    ], (f) => Math.sin(f.a) < -0.3 ? belly : fur), null),
    piece(L([
      { p: [0, 0.17, 0.05], r: 0.03 }, { p: [0, 0.175, 0.08], r: [0.05, 0.048, 0.046] }, { p: [0, 0.165, 0.12], r: [0.038, 0.033, 0.03] }, { p: [0, 0.163, 0.142], r: 0.012 },
    ], (f) => f.t > 0.5 && Math.sin(f.a) < 0 ? belly : fur), null, { part: 1 }),
    piece(L([{ p: [0.022, 0.205, 0.08], r: [0.016, 0.008], up: [0, 0, 1] }, { p: [0.026, 0.23, 0.08], r: [0.01, 0.006], up: [0, 0, 1] }, { p: [0.027, 0.252, 0.08], r: 0.002, up: [0, 0, 1] }], fur), null, { part: 1 }),
    piece(L([{ p: [-0.022, 0.205, 0.08], r: [0.016, 0.008], up: [0, 0, 1] }, { p: [-0.026, 0.23, 0.08], r: [0.01, 0.006], up: [0, 0, 1] }, { p: [-0.027, 0.252, 0.08], r: 0.002, up: [0, 0, 1] }], fur), null, { part: 1 }),
    piece(ball(0.012, 6, 5), PAL.ink, { at: [0.033, 0.182, 0.112], scale: [0.9, 1.1, 0.7], part: 1 }),
    piece(ball(0.012, 6, 5), PAL.ink, { at: [-0.033, 0.182, 0.112], scale: [0.9, 1.1, 0.7], part: 1 }),
    piece(ball(0.004, 3, 2), 0xffffff, { at: [0.037, 0.187, 0.12], part: 1 }),
    piece(ball(0.004, 3, 2), 0xffffff, { at: [-0.037, 0.187, 0.12], part: 1 }),
    piece(ball(0.01, 5, 4), 0x5a3020, { at: [0, 0.166, 0.145], part: 1 }),
    // big bushy S-curved tail in three overlapping sections
    piece(L([{ p: [0, 0.09, -0.07], r: 0.03 }, { p: [0, 0.11, -0.115], r: [0.045, 0.05] }, { p: [0, 0.16, -0.14], r: [0.05, 0.052] }, { p: [0, 0.19, -0.145], r: 0.04 }], tail, { bump: (a, t) => 1 + 0.08 * Math.cos(a * 6 + t * 9) }), null, { part: 2 }),
    piece(L([{ p: [0, 0.16, -0.14], r: 0.04 }, { p: [0, 0.21, -0.15], r: [0.058, 0.062] }, { p: [0, 0.26, -0.135], r: [0.055, 0.058] }, { p: [0, 0.285, -0.12], r: 0.04 }], tail, { bump: (a, t) => 1 + 0.08 * Math.cos(a * 6 + t * 9 + 1) }), null, { part: 3 }),
    piece(L([{ p: [0, 0.26, -0.13], r: 0.04 }, { p: [0, 0.3, -0.11], r: [0.055, 0.055] }, { p: [0, 0.33, -0.08], r: [0.042, 0.042] }, { p: [0, 0.345, -0.055], r: 0.015 }], (f) => f.t > 0.45 ? tip : tail, { bump: (a, t) => 1 + 0.08 * Math.cos(a * 6 + t * 9 + 2) }), null, { part: 4 }),
    // paws (hold a nut when nibbling) and hind legs
    ...[1, -1].map((s) => piece(L(([{ p: [s * 0.03, 0.095, 0.065], r: 0.014 }, { p: [s * 0.03, 0.06, 0.07], r: 0.012 }, { p: [s * 0.028, 0.032, 0.075], r: 0.013 }] as Ring[]).map((r) => ({ ...r, up: [0, 0, 1] as const })), fur), null, { part: 5 })),
    piece(ball(0.02, 5, 4), 0x9a6a2a, { at: [0, 0.035, 0.08], scale: [1, 1.2, 1], part: 6 }),
    piece(cone(0.014, 0.012, 5), 0x6a4a1a, { at: [0, 0.058, 0.08], part: 6 }),
    ...[1, -1].map((s) => piece(L([{ p: [s * 0.045, 0.06, -0.05], r: [0.025, 0.035] }, { p: [s * 0.047, 0.03, -0.03], r: [0.022, 0.025] }, { p: [s * 0.045, 0.012, 0.01], r: [0.016, 0.01] }], fur), null, { part: 7 })),
  ];
  return { geo: assemble(p), spec: SQUIRREL_SPEC };
}

// ---------------------------------------------------------------------------------------------
// Little fx: hearts (pet reactions), blob shadows, splash rings, firefly glow

export const PLAIN_SPEC: RigSpec = { name: 'plain', parts: [] };

export function heart(): Model {
  const c = 0xff6f96;
  const p: Piece[] = [
    piece(ball(0.06, 7, 5), c, { at: [0.045, 0.05, 0], scale: [1, 1, 0.6], mask: 1 }),
    piece(ball(0.06, 7, 5), c, { at: [-0.045, 0.05, 0], scale: [1, 1, 0.6], mask: 1 }),
    piece(cone(0.085, 0.12, 4), c, { at: [0, -0.02, 0], rot: [Math.PI, Math.PI / 4, 0], scale: [1.2, 1, 0.55], mask: 1 }),
    piece(ball(0.018, 4, 3), 0xffffff, { at: [0.05, 0.08, 0.032] }),
  ];
  return { geo: assemble(p), spec: PLAIN_SPEC };
}

export function blobGeometry(): THREE.BufferGeometry {
  return new THREE.CircleGeometry(0.5, 12).rotateX(-Math.PI / 2);
}

export function ringGeometry(): THREE.BufferGeometry {
  return new THREE.RingGeometry(0.82, 1, 22, 1).rotateX(-Math.PI / 2);
}

let glowTex: THREE.CanvasTexture | null = null;
/** soft round glow sprite (canvas), shared */
export function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    r.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
  }
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}
