/**
 * Critter models: chunky, faceted, slightly oversized so they read from first person. Every model is one merged
 * geometry + a rig spec (see rig.ts). Front faces +z, feet at y = 0.
 */
import * as THREE from 'three';
import { PAL } from '../toon.ts';
import { assemble, flatPoly, piece } from './rig.ts';
import type { Piece, RigSpec } from './rig.ts';

const ball = (r: number, w = 6, h = 4) => new THREE.SphereGeometry(r, w, h);
const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);
const cone = (r: number, h: number, s = 4) => new THREE.ConeGeometry(r, h, s);
const cyl = (rt: number, rb: number, h: number, s = 6) => new THREE.CylinderGeometry(rt, rb, h, s);
const mirror = (pts: readonly (readonly [number, number])[]) => pts.map(([x, z]) => [-x, z] as const);

const X = [1, 0, 0] as const, Y = [0, 1, 0] as const, Z = [0, 0, 1] as const;

export interface Model { geo: THREE.BufferGeometry; spec: RigSpec }

// ---------------------------------------------------------------------------------------------
// Birds. Channels: 0 wing flap (rad, + = up), 1 head peck (rad), 2 head turn (rad), 3 tail flick, 4 letter (−1 hides)

const LIGHT = 0xece6dc;

export const BIRD_SPEC: RigSpec = {
  name: 'songbird',
  parts: [
    // flight wings: flap about the body axis (ch 0); ch 4 = −1 tucks them away (perched birds show folded covers)
    { id: 1, pivot: [0.06, 0.15, 0.01], ops: [{ axis: Z, ch: 0 }, { axis: 'scale', ch: 4 }] },
    { id: 2, pivot: [-0.06, 0.15, 0.01], ops: [{ axis: Z, ch: 0, gain: -1 }, { axis: 'scale', ch: 4 }] },
    { id: 3, pivot: [0, 0.15, 0.06], ops: [{ axis: X, ch: 1 }, { axis: Y, ch: 2 }] },
    { id: 4, pivot: [0, 0.13, -0.08], ops: [{ axis: X, ch: 3, gain: -1 }] },
  ],
};

const birdWing = [[0, 0.05], [0.1, 0.03], [0.17, -0.03], [0.12, -0.09], [0, -0.07]] as const;

export function songbird(): Model {
  const p: Piece[] = [
    piece(ball(0.085, 7, 5), LIGHT, { at: [0, 0.12, 0], scale: [1, 0.92, 1.3], mask: 1 }),
    piece(ball(0.065, 6, 4), 0xf6ecd6, { at: [0, 0.1, 0.035], scale: [0.95, 0.9, 1.05], mask: 0.25 }),
    piece(ball(0.062, 7, 5), LIGHT, { at: [0, 0.19, 0.085], part: 3, mask: 1 }),
    piece(cone(0.02, 0.055, 4), PAL.orange, { at: [0, 0.185, 0.16], rot: [Math.PI / 2, 0, 0], part: 3 }),
    piece(box(0.018, 0.022, 0.012), PAL.ink, { at: [0.048, 0.2, 0.115], part: 3 }),
    piece(box(0.018, 0.022, 0.012), PAL.ink, { at: [-0.048, 0.2, 0.115], part: 3 }),
    piece(box(0.055, 0.014, 0.1), 0xb0a89c, { at: [0, 0.155, -0.15], rot: [0.45, 0, 0], part: 4, mask: 1 }),
    piece(ball(0.05, 5, 4), 0xc9bfb2, { at: [0.068, 0.13, -0.03], scale: [0.4, 0.75, 1.5], rot: [0.25, 0, 0], mask: 1 }),
    piece(ball(0.05, 5, 4), 0xc9bfb2, { at: [-0.068, 0.13, -0.03], scale: [0.4, 0.75, 1.5], rot: [0.25, 0, 0], mask: 1 }),
    piece(flatPoly(birdWing), 0xd8d0c4, { at: [0.06, 0.15, 0.01], part: 1, mask: 1 }),
    piece(flatPoly(mirror(birdWing)), 0xd8d0c4, { at: [-0.06, 0.15, 0.01], part: 2, mask: 1 }),
    piece(box(0.012, 0.05, 0.012), PAL.orange, { at: [0.025, 0.025, 0.01] }),
    piece(box(0.012, 0.05, 0.012), PAL.orange, { at: [-0.025, 0.025, 0.01] }),
  ];
  return { geo: assemble(p), spec: BIRD_SPEC };
}

export const PIGEON_SPEC: RigSpec = {
  name: 'pigeon',
  parts: [
    { id: 1, pivot: [0.08, 0.19, 0.01], ops: [{ axis: Z, ch: 0 }, { axis: 'scale', ch: 5 }] },
    { id: 2, pivot: [-0.08, 0.19, 0.01], ops: [{ axis: Z, ch: 0, gain: -1 }, { axis: 'scale', ch: 5 }] },
    { id: 3, pivot: [0, 0.2, 0.08], ops: [{ axis: X, ch: 1 }, { axis: Y, ch: 2 }] },
    { id: 4, pivot: [0, 0.17, -0.11], ops: [{ axis: X, ch: 3, gain: -1 }] },
    { id: 5, pivot: [0, 0.04, 0.03], ops: [{ axis: 'scale', ch: 4 }] },
  ],
};

const pigeonWing = [[0, 0.07], [0.13, 0.04], [0.23, -0.04], [0.17, -0.12], [0, -0.1]] as const;

export function pigeon(): Model {
  const grey = 0xa9b0c0, dark = 0x6f7688;
  const p: Piece[] = [
    piece(ball(0.11, 7, 5), grey, { at: [0, 0.15, 0], scale: [1, 0.95, 1.35], mask: 1 }),
    piece(ball(0.07, 6, 4), 0x7fa39a, { at: [0, 0.21, 0.07], scale: [1.05, 0.9, 0.9], mask: 0.3 }), // iridescent neck
    piece(ball(0.058, 7, 5), grey, { at: [0, 0.27, 0.11], part: 3, mask: 1 }),
    piece(cone(0.016, 0.05, 4), 0xd9a3a8, { at: [0, 0.26, 0.18], rot: [Math.PI / 2, 0, 0], part: 3 }),
    piece(box(0.018, 0.02, 0.012), 0xe8762c, { at: [0.045, 0.28, 0.14], part: 3 }),
    piece(box(0.018, 0.02, 0.012), 0xe8762c, { at: [-0.045, 0.28, 0.14], part: 3 }),
    piece(box(0.085, 0.018, 0.13), dark, { at: [0, 0.175, -0.19], rot: [0.25, 0, 0], part: 4, mask: 0.6 }),
    piece(ball(0.065, 5, 4), 0x8d95a8, { at: [0.088, 0.165, -0.04], scale: [0.4, 0.75, 1.55], rot: [0.2, 0, 0], mask: 1 }),
    piece(ball(0.065, 5, 4), 0x8d95a8, { at: [-0.088, 0.165, -0.04], scale: [0.4, 0.75, 1.55], rot: [0.2, 0, 0], mask: 1 }),
    piece(box(0.02, 0.015, 0.07), 0x4a4f5e, { at: [0.105, 0.17, -0.06] }),
    piece(box(0.02, 0.015, 0.07), 0x4a4f5e, { at: [-0.105, 0.17, -0.06] }),
    piece(flatPoly(pigeonWing), 0x9aa2b4, { at: [0.08, 0.19, 0.01], part: 1, mask: 1 }),
    piece(flatPoly(mirror(pigeonWing)), 0x9aa2b4, { at: [-0.08, 0.19, 0.01], part: 2, mask: 1 }),
    piece(box(0.016, 0.06, 0.016), 0xd9776a, { at: [0.035, 0.03, 0.02] }),
    piece(box(0.016, 0.06, 0.016), 0xd9776a, { at: [-0.035, 0.03, 0.02] }),
    // the letter, held in the feet
    piece(box(0.11, 0.014, 0.08), 0xfaf3e0, { at: [0, 0.035, 0.03], rot: [0.15, 0, 0], part: 5 }),
    piece(box(0.024, 0.02, 0.024), PAL.red, { at: [0, 0.046, 0.035], part: 5 }),
  ];
  return { geo: assemble(p), spec: PIGEON_SPEC };
}

// ---------------------------------------------------------------------------------------------
// Butterfly (ch 0 flap) and dragonfly (ch 0 flutter)

export const BUTTERFLY_SPEC: RigSpec = {
  name: 'butterfly',
  parts: [
    { id: 1, pivot: [0.004, 0, 0], ops: [{ axis: Z, ch: 0 }] },
    { id: 2, pivot: [-0.004, 0, 0], ops: [{ axis: Z, ch: 0, gain: -1 }] },
  ],
};
const foreWing = [[0.004, 0.015], [0.05, 0.08], [0.11, 0.065], [0.095, 0.005], [0.004, -0.005]] as const;
const hindWing = [[0.004, -0.004], [0.075, -0.02], [0.07, -0.075], [0.025, -0.08]] as const;
const wingTip = [[0.07, 0.07], [0.11, 0.065], [0.1, 0.035], [0.075, 0.045]] as const;

export function butterfly(): Model {
  const p: Piece[] = [
    piece(cyl(0.008, 0.006, 0.09, 5), 0x3a2e28, { rot: [Math.PI / 2, 0, 0], at: [0, 0, -0.01] }),
    piece(ball(0.012, 5, 4), 0x3a2e28, { at: [0, 0.002, 0.042] }),
    piece(box(0.003, 0.003, 0.04), 0x3a2e28, { at: [0.01, 0.012, 0.06], rot: [0.5, 0.35, 0] }),
    piece(box(0.003, 0.003, 0.04), 0x3a2e28, { at: [-0.01, 0.012, 0.06], rot: [0.5, -0.35, 0] }),
    piece(flatPoly(foreWing), 0xffffff, { part: 1, mask: 1 }),
    piece(flatPoly(hindWing), 0xf2f2f2, { part: 1, mask: 1 }),
    piece(flatPoly(wingTip), 0x2e2622, { part: 1, at: [0, 0.002, 0] }),
    piece(flatPoly(mirror(foreWing)), 0xffffff, { part: 2, mask: 1 }),
    piece(flatPoly(mirror(hindWing)), 0xf2f2f2, { part: 2, mask: 1 }),
    piece(flatPoly(mirror(wingTip)), 0x2e2622, { part: 2, at: [0, 0.002, 0] }),
  ];
  return { geo: assemble(p), spec: BUTTERFLY_SPEC };
}

export const DRAGONFLY_SPEC: RigSpec = {
  name: 'dragonfly',
  parts: [
    { id: 1, pivot: [0.006, 0.012, 0], ops: [{ axis: Z, ch: 0 }] },
    { id: 2, pivot: [-0.006, 0.012, 0], ops: [{ axis: Z, ch: 0, gain: -1 }] },
  ],
};
const dWing = (z: number, len: number) => [[0.005, z + 0.012], [len, z + 0.01], [len + 0.01, z - 0.004], [0.005, z - 0.008]] as const;

export function dragonfly(): Model {
  const wing = 0xdff0ff;
  const p: Piece[] = [
    piece(box(0.014, 0.014, 0.16), 0xffffff, { at: [0, 0, -0.085], mask: 1 }),
    piece(ball(0.02, 6, 4), 0xffffff, { at: [0, 0.004, 0.01], scale: [1, 1, 1.4], mask: 1 }),
    piece(ball(0.014, 5, 4), 0x2b3b5a, { at: [0.012, 0.01, 0.04] }),
    piece(ball(0.014, 5, 4), 0x2b3b5a, { at: [-0.012, 0.01, 0.04] }),
    piece(flatPoly(dWing(0.02, 0.11)), wing, { part: 1, at: [0, 0.012, 0] }),
    piece(flatPoly(dWing(-0.012, 0.1)), wing, { part: 1, at: [0, 0.012, 0] }),
    piece(flatPoly(mirror(dWing(0.02, 0.11))), wing, { part: 2, at: [0, 0.012, 0] }),
    piece(flatPoly(mirror(dWing(-0.012, 0.1))), wing, { part: 2, at: [0, 0.012, 0] }),
  ];
  return { geo: assemble(p), spec: DRAGONFLY_SPEC };
}

// ---------------------------------------------------------------------------------------------
// Water folk. Fish: ch 0 tail wag. Frog: ch 0 throat pouch (0 rest … 1 full), ch 1 blink (unused), ch 2 leg kick

export const FISH_SPEC: RigSpec = {
  name: 'fish',
  parts: [{ id: 1, pivot: [0, 0, -0.14], ops: [{ axis: Y, ch: 0 }] }],
};

export function fish(): Model {
  const tail = [[0, 0], [0.07, -0.12], [0, -0.08], [-0.07, -0.12]] as const;
  const p: Piece[] = [
    piece(ball(0.08, 7, 5), 0xffffff, { scale: [0.62, 0.95, 2.1], mask: 1 }),
    piece(ball(0.06, 6, 4), 0xf4efe4, { at: [0, -0.03, 0.02], scale: [0.6, 0.6, 1.8] }),
    piece(flatPoly(tail), 0xffffff, { at: [0, 0, -0.14], rot: [0, 0, Math.PI / 2], part: 1, mask: 0.8 }),
    piece(flatPoly([[0, 0.05], [0.06, -0.03], [0, -0.07]]), 0xffffff, { at: [0, 0.07, 0], rot: [0, 0, Math.PI / 2], mask: 0.8 }),
    piece(box(0.02, 0.024, 0.02), PAL.ink, { at: [0.045, 0.02, 0.12] }),
    piece(box(0.02, 0.024, 0.02), PAL.ink, { at: [-0.045, 0.02, 0.12] }),
  ];
  return { geo: assemble(p), spec: FISH_SPEC };
}

export const FROG_SPEC: RigSpec = {
  name: 'frog',
  parts: [
    { id: 1, pivot: [0, 0.05, 0.085], ops: [{ axis: 'scale', ch: 0, gain: 1.5, bias: -0.65 }] },
    { id: 2, pivot: [0.06, 0.05, -0.04], ops: [{ axis: X, ch: 2, gain: -1 }] },
    { id: 3, pivot: [-0.06, 0.05, -0.04], ops: [{ axis: X, ch: 2, gain: -1 }] },
  ],
};

export function frog(): Model {
  const g = 0x7fb04a, dk = 0x55803a;
  const p: Piece[] = [
    piece(ball(0.08, 7, 5), g, { at: [0, 0.065, 0], scale: [1.15, 0.72, 1.25], mask: 1 }),
    piece(ball(0.06, 6, 4), 0xe8e0a8, { at: [0, 0.045, 0.03], scale: [1.1, 0.6, 1.1] }),
    piece(ball(0.028, 5, 4), g, { at: [0.045, 0.11, 0.06], mask: 1 }),
    piece(ball(0.028, 5, 4), g, { at: [-0.045, 0.11, 0.06], mask: 1 }),
    piece(ball(0.016, 5, 4), PAL.ink, { at: [0.05, 0.12, 0.078] }),
    piece(ball(0.016, 5, 4), PAL.ink, { at: [-0.05, 0.12, 0.078] }),
    piece(ball(0.038, 6, 4), 0xf3e9b0, { at: [0, 0.045, 0.085], part: 1 }),
    piece(ball(0.045, 5, 4), dk, { at: [0.075, 0.035, -0.05], scale: [0.8, 0.6, 1.4], part: 2, mask: 1 }),
    piece(ball(0.045, 5, 4), dk, { at: [-0.075, 0.035, -0.05], scale: [0.8, 0.6, 1.4], part: 3, mask: 1 }),
    piece(box(0.018, 0.05, 0.018), dk, { at: [0.05, 0.02, 0.07], mask: 1 }),
    piece(box(0.018, 0.05, 0.018), dk, { at: [-0.05, 0.02, 0.07], mask: 1 }),
  ];
  return { geo: assemble(p), spec: FROG_SPEC };
}

// ---------------------------------------------------------------------------------------------
// Ground critters. Rabbit: ch 1 head nibble, ch 2 ear twitch L, ch 3 ear twitch R. Squirrel: ch 0 tail, ch 1 head.

export const RABBIT_SPEC: RigSpec = {
  name: 'rabbit',
  parts: [
    { id: 3, pivot: [0, 0.24, 0.1], ops: [{ axis: X, ch: 1 }] },
    { id: 4, pivot: [0, 0.24, 0.1], ops: [{ axis: X, ch: 2, gain: -1, pivot: [0.035, 0.33, 0.1] }, { axis: X, ch: 1 }] },
    { id: 5, pivot: [0, 0.24, 0.1], ops: [{ axis: X, ch: 3, gain: -1, pivot: [-0.035, 0.33, 0.1] }, { axis: X, ch: 1 }] },
  ],
};

export function rabbit(): Model {
  const fur = 0xf2ede6;
  const p: Piece[] = [
    piece(ball(0.13, 7, 5), fur, { at: [0, 0.15, -0.03], scale: [1, 0.92, 1.25], mask: 1 }),
    piece(ball(0.085, 7, 5), fur, { at: [0, 0.26, 0.13], scale: [1, 0.95, 1.1], part: 3, mask: 1 }),
    piece(ball(0.02, 4, 3), 0xe89aa6, { at: [0, 0.255, 0.225], part: 3 }),
    piece(box(0.02, 0.026, 0.014), PAL.ink, { at: [0.05, 0.285, 0.19], part: 3 }),
    piece(box(0.02, 0.026, 0.014), PAL.ink, { at: [-0.05, 0.285, 0.19], part: 3 }),
    piece(box(0.036, 0.15, 0.02), fur, { at: [0.035, 0.4, 0.1], rot: [-0.2, 0, -0.12], part: 4, mask: 1 }),
    piece(box(0.036, 0.15, 0.02), fur, { at: [-0.035, 0.4, 0.1], rot: [-0.2, 0, 0.12], part: 5, mask: 1 }),
    piece(box(0.018, 0.1, 0.012), 0xe9b4b8, { at: [0.035, 0.4, 0.112], rot: [-0.2, 0, -0.12], part: 4 }),
    piece(box(0.018, 0.1, 0.012), 0xe9b4b8, { at: [-0.035, 0.4, 0.112], rot: [-0.2, 0, 0.12], part: 5 }),
    piece(ball(0.045, 5, 4), 0xffffff, { at: [0, 0.17, -0.19] }),
    piece(box(0.05, 0.035, 0.12), fur, { at: [0.07, 0.02, -0.04], mask: 1 }),
    piece(box(0.05, 0.035, 0.12), fur, { at: [-0.07, 0.02, -0.04], mask: 1 }),
    piece(box(0.03, 0.08, 0.03), fur, { at: [0.045, 0.04, 0.09], mask: 1 }),
    piece(box(0.03, 0.08, 0.03), fur, { at: [-0.045, 0.04, 0.09], mask: 1 }),
  ];
  return { geo: assemble(p), spec: RABBIT_SPEC };
}

export const SQUIRREL_SPEC: RigSpec = {
  name: 'squirrel',
  parts: [
    { id: 1, pivot: [0, 0.1, -0.08], ops: [{ axis: X, ch: 0, gain: -1 }] },
    { id: 3, pivot: [0, 0.14, 0.06], ops: [{ axis: X, ch: 1 }, { axis: Y, ch: 2 }] },
  ],
};

export function squirrel(): Model {
  const fur = 0xc0643a, belly = 0xf4dcc0;
  const p: Piece[] = [
    piece(ball(0.07, 6, 5), fur, { at: [0, 0.1, 0], scale: [0.9, 1, 1.3] }),
    piece(ball(0.05, 5, 4), belly, { at: [0, 0.09, 0.03], scale: [0.9, 0.9, 1.2] }),
    piece(ball(0.05, 6, 5), fur, { at: [0, 0.17, 0.09], part: 3 }),
    piece(cone(0.018, 0.04, 4), fur, { at: [0.025, 0.22, 0.085], part: 3 }),
    piece(cone(0.018, 0.04, 4), fur, { at: [-0.025, 0.22, 0.085], part: 3 }),
    piece(box(0.014, 0.018, 0.01), PAL.ink, { at: [0.03, 0.18, 0.13], part: 3 }),
    piece(box(0.014, 0.018, 0.01), PAL.ink, { at: [-0.03, 0.18, 0.13], part: 3 }),
    piece(ball(0.012, 4, 3), 0x5a3020, { at: [0, 0.165, 0.14], part: 3 }),
    // the big bushy tail, curling up and over
    piece(ball(0.05, 6, 4), 0xd07a48, { at: [0, 0.12, -0.12], scale: [0.9, 1.1, 1], part: 1 }),
    piece(ball(0.058, 6, 4), 0xd07a48, { at: [0, 0.22, -0.15], scale: [0.9, 1.2, 1], part: 1 }),
    piece(ball(0.05, 6, 4), 0xe0905a, { at: [0, 0.31, -0.1], scale: [0.9, 1, 1.1], part: 1 }),
    piece(box(0.024, 0.06, 0.03), fur, { at: [0.035, 0.03, 0.05] }),
    piece(box(0.024, 0.06, 0.03), fur, { at: [-0.035, 0.03, 0.05] }),
    piece(box(0.03, 0.03, 0.08), fur, { at: [0.045, 0.015, -0.04] }),
    piece(box(0.03, 0.03, 0.08), fur, { at: [-0.045, 0.015, -0.04] }),
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

// ---------------------------------------------------------------------------------------------
// Pets. Channels: 0..3 legs FL FR BL BR (swing, rad), 4 head pitch, 5 head yaw, 6 tail wag (yaw), 7 tail lift (pitch)

const legOps = (ch: number) => [{ axis: X, ch }];

export const DOG_SPEC: RigSpec = {
  name: 'dog',
  parts: [
    { id: 1, pivot: [0.12, 0.36, 0.2], ops: legOps(0) },
    { id: 2, pivot: [-0.12, 0.36, 0.2], ops: legOps(1) },
    { id: 3, pivot: [0.12, 0.36, -0.22], ops: legOps(2) },
    { id: 4, pivot: [-0.12, 0.36, -0.22], ops: legOps(3) },
    { id: 5, pivot: [0, 0.6, 0.26], ops: [{ axis: X, ch: 4 }, { axis: Y, ch: 5 }] },
    { id: 6, pivot: [0, 0.56, -0.3], ops: [{ axis: X, ch: 7, gain: -1 }, { axis: Y, ch: 6 }] },
  ],
};

/** Biscuit: a round, biscuit-coloured shiba-ish village dog with a red collar. */
export function dog(): Model {
  const fur = 0xdf9f58, cream = 0xfbf0dc, dark = 0xa8683a;
  const leg = (x: number, z: number, part: number) => [
    piece(cyl(0.058, 0.05, 0.34, 6), fur, { at: [x, 0.19, z], part }),
    piece(ball(0.058, 6, 4), cream, { at: [x, 0.035, z + 0.02], scale: [1, 0.7, 1.25], part }),
  ];
  const p: Piece[] = [
    piece(ball(0.23, 8, 6), fur, { at: [0, 0.47, -0.02], scale: [0.92, 0.82, 1.45] }),
    piece(ball(0.17, 7, 5), cream, { at: [0, 0.42, 0.12], scale: [0.88, 0.82, 1.25] }),
    ...leg(0.12, 0.2, 1), ...leg(-0.12, 0.2, 2), ...leg(0.12, -0.22, 3), ...leg(-0.12, -0.22, 4),
    // head
    piece(ball(0.175, 8, 6), fur, { at: [0, 0.74, 0.34], part: 5 }),
    piece(ball(0.1, 7, 5), cream, { at: [0, 0.67, 0.47], scale: [1.1, 0.8, 1.15], part: 5 }),
    piece(ball(0.07, 6, 4), cream, { at: [0.09, 0.7, 0.42], part: 5 }),
    piece(ball(0.07, 6, 4), cream, { at: [-0.09, 0.7, 0.42], part: 5 }),
    piece(ball(0.036, 6, 4), PAL.ink, { at: [0, 0.7, 0.575], scale: [1.2, 0.9, 1], part: 5 }),
    piece(ball(0.026, 5, 4), PAL.ink, { at: [0.075, 0.79, 0.47], scale: [1, 1.2, 0.8], part: 5 }),
    piece(ball(0.026, 5, 4), PAL.ink, { at: [-0.075, 0.79, 0.47], scale: [1, 1.2, 0.8], part: 5 }),
    piece(ball(0.008, 3, 2), 0xffffff, { at: [0.082, 0.8, 0.49], part: 5 }),
    piece(ball(0.008, 3, 2), 0xffffff, { at: [-0.068, 0.8, 0.49], part: 5 }),
    piece(box(0.05, 0.012, 0.05), 0xf07a8a, { at: [0, 0.625, 0.52], rot: [0.3, 0, 0], part: 5 }),
    piece(cone(0.07, 0.14, 4), fur, { at: [0.1, 0.9, 0.3], rot: [0.1, Math.PI / 4, -0.28], part: 5 }),
    piece(cone(0.07, 0.14, 4), fur, { at: [-0.1, 0.9, 0.3], rot: [0.1, Math.PI / 4, 0.28], part: 5 }),
    piece(cone(0.04, 0.08, 4), dark, { at: [0.1, 0.885, 0.315], rot: [0.1, Math.PI / 4, -0.28], part: 5 }),
    piece(cone(0.04, 0.08, 4), dark, { at: [-0.1, 0.885, 0.315], rot: [0.1, Math.PI / 4, 0.28], part: 5 }),
    // collar + tag
    piece(new THREE.TorusGeometry(0.135, 0.028, 4, 10), PAL.red, { at: [0, 0.6, 0.25], rot: [Math.PI / 2 - 0.5, 0, 0] }),
    piece(ball(0.03, 5, 4), PAL.yellow, { at: [0, 0.5, 0.36] }),
    // curly tail
    piece(ball(0.08, 6, 5), fur, { at: [0, 0.66, -0.36], part: 6 }),
    piece(ball(0.065, 6, 5), cream, { at: [0, 0.76, -0.3], part: 6 }),
  ];
  return { geo: assemble(p), spec: DOG_SPEC };
}

export const CAT_SPEC: RigSpec = {
  name: 'cat',
  parts: [
    { id: 1, pivot: [0.07, 0.2, 0.13], ops: legOps(0) },
    { id: 2, pivot: [-0.07, 0.2, 0.13], ops: legOps(1) },
    { id: 3, pivot: [0.07, 0.2, -0.14], ops: legOps(2) },
    { id: 4, pivot: [-0.07, 0.2, -0.14], ops: legOps(3) },
    { id: 5, pivot: [0, 0.33, 0.17], ops: [{ axis: X, ch: 4 }, { axis: Y, ch: 5 }] },
    { id: 6, pivot: [0, 0.3, -0.21], ops: [{ axis: X, ch: 7, gain: -1 }, { axis: Y, ch: 6 }] },
  ],
};

/** Mochi: a round calico cat, mostly cream with orange and charcoal patches. */
export function cat(): Model {
  const fur = 0xf5eee2, orange = 0xe8a060, char = 0x5a5250, pink = 0xf2a0a8;
  const leg = (x: number, z: number, part: number, c: number) => [
    piece(cyl(0.034, 0.03, 0.2, 5), c, { at: [x, 0.1, z], part }),
    piece(ball(0.034, 5, 4), fur, { at: [x, 0.02, z + 0.01], scale: [1, 0.7, 1.2], part }),
  ];
  const p: Piece[] = [
    piece(ball(0.14, 8, 6), fur, { at: [0, 0.27, 0], scale: [0.92, 0.85, 1.55] }),
    piece(ball(0.1, 6, 5), orange, { at: [0.03, 0.33, -0.1], scale: [0.95, 0.55, 1.1] }),
    piece(ball(0.06, 6, 4), char, { at: [-0.06, 0.32, 0.06], scale: [0.8, 0.6, 1.1] }),
    ...leg(0.07, 0.13, 1, fur), ...leg(-0.07, 0.13, 2, fur), ...leg(0.07, -0.14, 3, orange), ...leg(-0.07, -0.14, 4, fur),
    piece(ball(0.115, 8, 6), fur, { at: [0, 0.42, 0.24], scale: [1.12, 0.95, 1], part: 5 }),
    piece(ball(0.07, 6, 4), orange, { at: [0.05, 0.47, 0.22], scale: [1, 0.7, 1], part: 5 }),
    piece(cone(0.05, 0.1, 4), orange, { at: [0.065, 0.53, 0.22], rot: [0, Math.PI / 4, -0.25], part: 5 }),
    piece(cone(0.05, 0.1, 4), char, { at: [-0.065, 0.53, 0.22], rot: [0, Math.PI / 4, 0.25], part: 5 }),
    piece(cone(0.026, 0.05, 4), pink, { at: [0.063, 0.52, 0.235], rot: [0, Math.PI / 4, -0.25], part: 5 }),
    piece(cone(0.026, 0.05, 4), pink, { at: [-0.063, 0.52, 0.235], rot: [0, Math.PI / 4, 0.25], part: 5 }),
    piece(ball(0.05, 6, 4), 0xffffff, { at: [0, 0.39, 0.32], scale: [1.2, 0.75, 0.8], part: 5 }),
    piece(ball(0.014, 4, 3), pink, { at: [0, 0.415, 0.355], part: 5 }),
    piece(box(0.03, 0.036, 0.012), PAL.ink, { at: [0.048, 0.44, 0.335], part: 5 }),
    piece(box(0.03, 0.036, 0.012), PAL.ink, { at: [-0.048, 0.44, 0.335], part: 5 }),
    piece(new THREE.TorusGeometry(0.085, 0.016, 4, 10), 0x4fa3c9, { at: [0, 0.34, 0.17], rot: [Math.PI / 2 - 0.4, 0, 0] }),
    piece(ball(0.018, 4, 3), PAL.yellow, { at: [0, 0.27, 0.23] }),
    // long tail up behind, orange tip
    piece(cyl(0.024, 0.03, 0.3, 5), fur, { at: [0, 0.42, -0.26], rot: [-0.35, 0, 0], part: 6 }),
    piece(ball(0.03, 5, 4), orange, { at: [0, 0.57, -0.31], part: 6 }),
  ];
  return { geo: assemble(p), spec: CAT_SPEC };
}
