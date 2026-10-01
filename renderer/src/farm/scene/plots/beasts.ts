/**
 * Pen animal models: cows, sheep, pigs, chickens (+ chicks and eggs). Each species is four rigged parts built facing
 * +z with the ground at y = 0 — body (tail / wings bend in the shader), head (eyes blink, jaw opens, ears flick, the
 * head nods on its neck), upper leg and lower leg (posed by the two-bone solve in gait.ts) — plus the numbers the Herd
 * needs to animate them: hip sockets, bone lengths, gait, neck pivot, lying heights, coats.
 *
 * Left is +x (an animal facing +z has its left side toward +x). Legs are listed LF, RF, LH, RH (bipeds: L, R).
 */
import * as THREE from 'three';
import type { Season } from '../../model/types.ts';
import { PAL } from '../toon.ts';
import type { SfxName } from '../context.ts';
import type { BeastKey } from './behavior.ts';
import type { GaitDef, LieStyle } from './gait.ts';
import { ball, box, cached, cone, cyl, dodec, jitter, rng, sphere, torus } from './geo.ts';
import type { V3 } from './geo.ts';
import { P, gradient, rbox, rigMerge, roundify, tag } from './rig.ts';

export interface Coat {
  /** instance tint on coat vertices */
  tint: number;
  /** pattern kind (rig.ts) */
  pattern: number;
  weight: number;
  name: string;
}

export interface BeastDef {
  key: BeastKey;
  body(season: Season): THREE.BufferGeometry;
  head(): THREE.BufferGeometry;
  upper(): THREE.BufferGeometry;
  lower(): THREE.BufferGeometry;
  /** hip sockets in body rest space (LF, RF, LH, RH | L, R) */
  hips: V3[];
  /** upper / lower bone lengths per leg (the geometry is modelled at `boneGeo` and stretched) */
  bones: [number, number][];
  boneGeo: [number, number];
  /** knee points forward (cow front knee) or back (hocks, bird ankles) per leg */
  kneeFwd: boolean[];
  /** body pivot (centre of mass) in rest space */
  cog: V3;
  /** head pivot (base of the neck) in body rest space */
  neck: V3;
  /** point on the head (head space, before nod) where hearts / Zzz / notes appear */
  mouth: V3;
  /** neck pitch that brings the mouth to the grass, and the extra head nod used while grazing */
  graze: number; grazeNod: number;
  gait: GaitDef;
  /** rest m/s */
  walk: number; trot: number; flee: number;
  /** turn rate (rad/s) at a walk */
  turn: number;
  /** body half-width and half-length (fence clearance, avoidance) */
  r: number; len: number;
  lie: LieStyle;
  /** how far the body drops (rest metres) at the front / hind end when lying */
  lieDrop: [number, number];
  sound: SfxName;
  names: string[];
  coats: Coat[];
  /** how many live in a full pen */
  max: number;
  /** world scale of the whole animal */
  size: number;
}

const INK = 0x1c1818;
const GLINT = 0xffffff;

/** a big glossy toon eye (black oval + two highlights) facing +z at p; its blink pivot sits a bit below centre */
function eye(p: V3, r: number, joint: V3, o: { sclera?: number; side?: number; look?: number } = {}): THREE.BufferGeometry[] {
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


// ---------------------------------------------------------------------------------------------------------------
// Cow

const COW_J: V3 = [0, 0.14, 0.4];

function cowBody(): THREE.BufferGeometry {
  return cached('beast:cow:body', () => {
    const W = 0xfbf8f0;
    const p: THREE.BufferGeometry[] = [];
    const coat = { coat: 1 };
    // barrel, a deeper chest and a squarer rump
    p.push(tag(rbox(0.9, 0.74, 1.52, W, { p: [0, 1.0, -0.04] }, 0.72), coat));
    p.push(tag(rbox(0.86, 0.78, 0.62, W, { p: [0, 0.99, 0.42] }, 0.8), coat));
    p.push(tag(rbox(0.84, 0.66, 0.5, W, { p: [0, 1.04, -0.5] }, 0.6), coat));
    // udder + teats
    p.push(ball(0.17, 0xf6b4b4, { p: [0, 0.66, -0.38], s: [1.05, 0.7, 1.1] }, 1));
    for (const [x, z] of [[0.075, -0.3], [-0.075, -0.3], [0.075, -0.46], [-0.075, -0.46]]) p.push(cone(0.03, 0.09, 5, 0xe89a9e, { p: [x, 0.56, z], r: [Math.PI, 0, 0] }));
    // tail: the root swings about the rump, the tuft lags behind
    const root: V3 = [0, 1.3, -0.8];
    p.push(tag(cyl(0.032, 0.045, 0.34, 5, W, { p: [0, 1.14, -0.83], r: [0.1, 0, 0] }), { part: P.TAIL, joint: root, coat: 1 }));
    const tipPivot: V3 = [0, 0.98, -0.85];
    p.push(tag(cyl(0.026, 0.032, 0.3, 5, W, { p: [0, 0.84, -0.855] }), { part: P.TAIL_TIP, pivot: tipPivot, joint: root, axis: [0, 0, 1], coat: 1 }));
    for (let i = 0; i < 5; i++) p.push(tag(dodec(0.055, i % 2 ? 0x2a2222 : 0x3a302c, { p: [((i % 3) - 1) * 0.03, 0.66 - (i > 2 ? 0.07 : 0), -0.86 + (i % 2 - 0.5) * 0.03], s: [0.9, 1.6, 0.9] }), { part: P.TAIL_TIP, pivot: tipPivot, joint: root, axis: [0, 0, 1] }));
    return jitter(rigMerge(p), 0.02, 5);
  });
}

function cowHead(): THREE.BufferGeometry {
  return cached('beast:cow:head', () => {
    const W = 0xfbf8f0, J = COW_J;
    const p: THREE.BufferGeometry[] = [];
    const head = { part: P.HEAD, joint: J };
    // neck (does not nod) + collar and bell
    p.push(tag(rbox(0.46, 0.52, 0.62, W, { p: [0, 0.04, 0.18], r: [-0.3, 0, 0] }, 0.75), { coat: 1 }));
    p.push(torus(0.25, 0.04, 4, 14, 0xc2533e, { p: [0, 0.0, 0.28], r: [Math.PI / 2 - 0.3, 0, 0], s: [0.95, 1.08, 1] }));
    p.push(cone(0.075, 0.12, 6, PAL.yellow, { p: [0, -0.27, 0.36], r: [-0.3, 0, 0] }), ball(0.032, 0x8a6a20, { p: [0, -0.33, 0.34] }), box(0.05, 0.08, 0.04, 0x8a3a2e, { p: [0, -0.2, 0.37], r: [-0.3, 0, 0] }));
    // skull, forelock, horns
    p.push(tag(rbox(0.56, 0.5, 0.5, W, { p: [0, 0.2, 0.6] }, 0.62), { ...head, coat: 1 }));
    for (let i = 0; i < 3; i++) p.push(tag(dodec(0.07, W, { p: [(i - 1) * 0.07, 0.46 - Math.abs(i - 1) * 0.025, 0.66 + (i % 2) * 0.04] }), { ...head, coat: 1 }));
    for (const s of [-1, 1]) {
      p.push(tag(cone(0.06, 0.13, 6, 0xf4e6c4, { p: [s * 0.25, 0.46, 0.56], r: [0.1, 0, -s * 1.0] }), head));
      p.push(tag(cone(0.038, 0.1, 6, 0xe8d4a8, { p: [s * 0.33, 0.54, 0.57], r: [0.15, 0, -s * 0.25] }), head));
    }
    // muzzle, nostrils, mouth line, blush
    p.push(tag(rbox(0.5, 0.28, 0.3, 0xf6b6ae, { p: [0, 0.02, 0.85] }, 0.8), head));
    for (const s of [-1, 1]) {
      p.push(tag(ball(0.038, 0x7a3a3a, { p: [s * 0.1, 0.05, 0.985], s: [1, 1.4, 0.45] }), head));
      p.push(tag(ball(0.05, 0xf49a9a, { p: [s * 0.21, 0.13, 0.82], s: [1, 0.55, 0.4] }), head));
    }
    p.push(tag(box(0.2, 0.015, 0.02, 0x9a4a4a, { p: [0, -0.075, 0.975] }), head));
    // jaw (chews and moos)
    const jaw = { part: P.JAW, pivot: [0, -0.08, 0.72] as V3, joint: J, axis: [1, 0, 0] as V3 };
    p.push(tag(rbox(0.38, 0.11, 0.24, 0xf0aaa2, { p: [0, -0.14, 0.82] }, 0.7, 2), jaw));
    p.push(tag(box(0.3, 0.05, 0.2, 0xc86a6a, { p: [0, -0.085, 0.82] }), jaw));
    p.push(tag(box(0.3, 0.1, 0.16, 0x5a2424, { p: [0, -0.1, 0.84] }), head));
    // eyes
    for (const s of [-1, 1]) p.push(...eye([s * 0.14, 0.27, 0.84], 0.058, J));
    // flop ears (pink inside), a yellow tag in the left ear
    for (const s of [-1, 1]) {
      const pivot: V3 = [s * 0.24, 0.3, 0.6];
      const t = { part: s > 0 ? P.EAR_L : P.EAR_R, pivot, joint: J, axis: [0, 0, s] as V3 };
      p.push(tag(ball(0.14, W, { p: [s * 0.39, 0.25, 0.62], s: [1.3, 0.36, 0.75], r: [0.2, s * 0.25, s * -0.4] }, 1), { ...t, coat: 1 }));
      p.push(tag(ball(0.1, 0xf4a8a8, { p: [s * 0.4, 0.235, 0.655], s: [1.2, 0.28, 0.5], r: [0.2, s * 0.25, s * -0.4] }), t));
      if (s > 0) p.push(tag(rbox(0.08, 0.09, 0.025, PAL.yellow, { p: [0.43, 0.19, 0.69], r: [0, 0.2, -0.4] }, 0.5, 1), t));
    }
    return rigMerge(p);
  });
}

const cowUpper = () => cached('beast:cow:upper', () => rigMerge([
  tag(rbox(0.22, 0.5, 0.24, 0xfbf8f0, { p: [0, -0.14, 0] }, 0.65, 2, 1.2), { coat: 1 }),
]));
const cowLower = () => cached('beast:cow:lower', () => rigMerge([
  tag(rbox(0.18, 0.13, 0.19, 0xfbf8f0, { p: [0, -0.01, 0] }, 0.8, 2), { coat: 1 }),
  tag(rbox(0.15, 0.34, 0.16, 0xfbf8f0, { p: [0, -0.17, 0] }, 0.55, 2, 1.1), { coat: 1 }),
  rbox(0.085, 0.1, 0.19, 0x3a2e2c, { p: [0.045, -0.35, 0.012] }, 0.35, 1), rbox(0.085, 0.1, 0.19, 0x3a2e2c, { p: [-0.045, -0.35, 0.012] }, 0.35, 1),
  rbox(0.18, 0.04, 0.18, 0x4a3a36, { p: [0, -0.3, 0.005] }, 0.4, 1),
]));

// ---------------------------------------------------------------------------------------------------------------
// Sheep

const SHEEP_J: V3 = [0, 0.06, 0.16];
const FACE = 0x3a3230;

function sheepBody(season: Season): THREE.BufferGeometry {
  return cached(`beast:sheep:body:${season}`, () => {
    const r = rng('sheep-wool');
    const wool = season === 'winter' ? 0xfffdf8 : 0xf8f3e6, shade = 0xe6dcc8;
    const p: THREE.BufferGeometry[] = [];
    const coat = { coat: 1 };
    p.push(tag(ball(0.34, wool, { p: [0, 0.64, 0], s: [1, 0.92, 1.3] }, 1), coat));
    // lumpy cloud: puffs scattered over an ellipsoid shell, a bit fuller on top
    const N = 44;
    for (let i = 0; i < N; i++) {
      const y = 1 - (i + 0.5) / N * 1.7, rad = Math.sqrt(Math.max(0, 1 - y * y)), th = i * 2.39996 + r() * 0.4;
      const x = Math.cos(th) * rad, z = Math.sin(th) * rad;
      if (y < -0.55) continue;
      const s = 0.12 + r() * 0.05 + (y > 0.3 ? 0.02 : 0);
      p.push(tag(dodec(s, y < -0.2 ? shade : i % 4 ? wool : 0xefe8d8, { p: [x * 0.36, 0.64 + y * 0.32, z * 0.47], r: [r() * 3, r() * 3, 0] }), coat));
    }
    // woolly stub tail
    const root: V3 = [0, 0.72, -0.5];
    p.push(tag(dodec(0.08, wool, { p: [0, 0.66, -0.56], s: [0.9, 1.3, 0.9] }), { part: P.TAIL, joint: root, coat: 1 }));
    p.push(tag(dodec(0.06, wool, { p: [0, 0.57, -0.57] }), { part: P.TAIL, joint: root, coat: 1 }));
    return jitter(rigMerge(p), 0.03, 7);
  });
}

function sheepHead(): THREE.BufferGeometry {
  return cached('beast:sheep:head', () => {
    const J = SHEEP_J, wool = 0xf8f3e6;
    const p: THREE.BufferGeometry[] = [];
    const head = { part: P.HEAD, joint: J };
    p.push(ball(0.12, FACE, { p: [0, 0.03, 0.08], s: [0.9, 1, 1.2] }));
    // face: long soft wedge
    p.push(tag(ball(0.15, FACE, { p: [0, 0.04, 0.3], s: [0.85, 0.95, 1.25], r: [0.25, 0, 0] }, 1), head));
    p.push(tag(ball(0.1, 0x4a4040, { p: [0, -0.04, 0.44], s: [1, 0.85, 0.9] }), head));
    // nose + nostrils
    p.push(tag(ball(0.035, 0xc89090, { p: [0, 0.0, 0.525], s: [1.4, 0.8, 0.6] }), head));
    for (const s of [-1, 1]) p.push(tag(ball(0.014, INK, { p: [s * 0.028, 0.0, 0.545] }), head));
    // wool cap
    for (let i = 0; i < 6; i++) p.push(tag(dodec(0.07 + (i % 2) * 0.015, wool, { p: [Math.cos(i * 1.9) * 0.07, 0.17 + (i % 3) * 0.02, 0.22 + Math.sin(i * 1.9) * 0.06] }), { ...head, coat: 1 }));
    // eyes (white sclera so they read on the dark face)
    for (const s of [-1, 1]) p.push(...eye([s * 0.085, 0.09, 0.4], 0.034, J, { sclera: 0xfbf8f2, side: s * 0.35 }));
    // side ears
    for (const s of [-1, 1]) {
      const pivot: V3 = [s * 0.11, 0.1, 0.25];
      const t = { part: s > 0 ? P.EAR_L : P.EAR_R, pivot, joint: J, axis: [0, 0, s] as V3 };
      p.push(tag(ball(0.09, FACE, { p: [s * 0.2, 0.08, 0.24], s: [1.4, 0.38, 0.7], r: [0, s * 0.3, s * -0.15] }), t));
      p.push(tag(ball(0.06, 0xd89a9a, { p: [s * 0.21, 0.095, 0.25], s: [1.3, 0.2, 0.5], r: [0, s * 0.3, s * -0.15] }), t));
    }
    // jaw + pink mouth (baa!)
    const jaw = { part: P.JAW, pivot: [0, -0.06, 0.36] as V3, joint: J, axis: [1, 0, 0] as V3 };
    p.push(tag(ball(0.06, 0x3e3434, { p: [0, -0.1, 0.44], s: [1, 0.5, 1.2] }), jaw));
    p.push(tag(ball(0.05, 0xd86a78, { p: [0, -0.07, 0.45], s: [1, 0.5, 1.1] }), jaw));
    return rigMerge(p);
  });
}

const sheepUpper = () => cached('beast:sheep:upper', () => rigMerge([
  tag(dodec(0.085, 0xf8f3e6, { p: [0, -0.03, 0], s: [1, 1.2, 1] }), { coat: 1 }),
  box(0.07, 0.2, 0.075, FACE, { p: [0, -0.1, 0] }),
]));
const sheepLower = () => cached('beast:sheep:lower', () => rigMerge([
  box(0.06, 0.2, 0.065, FACE, { p: [0, -0.1, 0] }), box(0.075, 0.045, 0.085, 0x221c1c, { p: [0, -0.2, 0.008] }),
]));

// ---------------------------------------------------------------------------------------------------------------
// Pig

const PIG_J: V3 = [0, 0.0, 0.04];
const PINK_TOP = 0xffd2d6, PINK_BOTTOM = 0xf09aa8;

function pigBody(): THREE.BufferGeometry {
  return cached('beast:pig:body', () => {
    const p: THREE.BufferGeometry[] = [];
    const coat = { coat: 1 };
    p.push(tag(gradient(ball(0.36, 0xffffff, { p: [0, 0.46, -0.02], s: [0.9, 0.82, 1.3] }, 1), PINK_TOP, PINK_BOTTOM, 0.2, 0.75), coat));
    p.push(tag(gradient(ball(0.26, 0xffffff, { p: [0, 0.47, 0.26], s: [1.1, 1.05, 1] }, 1), PINK_TOP, PINK_BOTTOM, 0.22, 0.72), coat));
    // haunches and shoulders
    for (const s of [-1, 1]) {
      p.push(tag(gradient(ball(0.15, 0xffffff, { p: [s * 0.2, 0.4, -0.3], s: [0.8, 1, 1.1] }), PINK_TOP, PINK_BOTTOM, 0.25, 0.6), coat));
      p.push(tag(gradient(ball(0.13, 0xffffff, { p: [s * 0.2, 0.4, 0.28], s: [0.8, 1, 1] }), PINK_TOP, PINK_BOTTOM, 0.25, 0.6), coat));
    }
    // belly row
    for (const z of [-0.12, 0.02, 0.16]) for (const s of [-1, 1]) p.push(ball(0.018, 0xe07a8a, { p: [s * 0.08, 0.2, z] }));
    // curly tail: a corkscrew that wiggles about the rump
    const root: V3 = [0, 0.56, -0.47];
    const t = { part: P.TAIL, joint: root, coat: 1 };
    p.push(tag(torus(0.045, 0.016, 4, 10, 0xf6a8b4, { p: [0, 0.6, -0.52], r: [0, Math.PI / 2, 0] }, Math.PI * 1.7), t));
    p.push(tag(torus(0.032, 0.014, 4, 8, 0xf6a8b4, { p: [0.012, 0.61, -0.555], r: [0.3, Math.PI / 2, 0.4] }, Math.PI * 1.5), t));
    p.push(tag(cyl(0.017, 0.02, 0.07, 4, 0xf6a8b4, { p: [0, 0.57, -0.49], r: [-1.1, 0, 0] }), t));
    return jitter(rigMerge(p), 0.02, 9);
  });
}

function pigHead(): THREE.BufferGeometry {
  return cached('beast:pig:head', () => {
    const J = PIG_J;
    const p: THREE.BufferGeometry[] = [];
    const head = { part: P.HEAD, joint: J };
    const coatHead = { ...head, coat: 1 };
    p.push(tag(gradient(ball(0.25, 0xffffff, { p: [0, 0.03, 0.15], s: [1, 0.92, 0.95] }, 1), PINK_TOP, PINK_BOTTOM, -0.2, 0.25), coatHead));
    // jowls
    for (const s of [-1, 1]) p.push(tag(gradient(ball(0.12, 0xffffff, { p: [s * 0.12, -0.1, 0.22] }), PINK_TOP, PINK_BOTTOM, -0.2, 0.05), coatHead));
    // snout disc + nostrils
    p.push(tag(cyl(0.105, 0.115, 0.13, 10, 0xf6a6b2, { p: [0, -0.03, 0.4], r: [Math.PI / 2, 0, 0] }), head));
    p.push(tag(cyl(0.1, 0.1, 0.02, 10, 0xffc0c8, { p: [0, -0.03, 0.47], r: [Math.PI / 2, 0, 0] }), head));
    for (const s of [-1, 1]) p.push(tag(ball(0.026, 0x8a3a4a, { p: [s * 0.04, -0.03, 0.478], s: [0.8, 1.3, 0.4] }), head));
    // blush
    for (const s of [-1, 1]) p.push(tag(ball(0.05, 0xff8a9a, { p: [s * 0.17, -0.02, 0.3], s: [1, 0.6, 0.35], r: [0, s * 0.6, 0] }), head));
    // eyes
    for (const s of [-1, 1]) p.push(...eye([s * 0.105, 0.1, 0.35], 0.042, J));
    // triangle ears that flop forward
    for (const s of [-1, 1]) {
      const pivot: V3 = [s * 0.14, 0.2, 0.12];
      const t = { part: s > 0 ? P.EAR_L : P.EAR_R, pivot, joint: J, axis: [1, 0, s * 0.3] as V3, coat: 1 };
      p.push(tag(gradient(cone(0.1, 0.19, 3, 0xffffff, { p: [s * 0.18, 0.28, 0.16], r: [0.55, s * 0.5, -s * 0.45], s: [1, 1, 0.45] }), 0xffd2d6, 0xffb6c0, 0.2, 0.36), t));
      p.push(tag(cone(0.065, 0.13, 3, 0xff9aaa, { p: [s * 0.18, 0.27, 0.185], r: [0.55, s * 0.5, -s * 0.45], s: [1, 1, 0.3] }), { ...t, coat: 0 }));
    }
    // jaw (oink!)
    const jaw = { part: P.JAW, pivot: [0, -0.1, 0.24] as V3, joint: J, axis: [1, 0, 0] as V3 };
    p.push(tag(ball(0.08, 0xf2a2ae, { p: [0, -0.15, 0.33], s: [1.1, 0.45, 1] }), jaw));
    p.push(tag(ball(0.06, 0xc85a6a, { p: [0, -0.12, 0.34], s: [1.1, 0.35, 0.9] }), jaw));
    return rigMerge(p);
  });
}

const pigUpper = () => cached('beast:pig:upper', () => rigMerge([
  tag(gradient(ball(0.08, 0xffffff, { p: [0, -0.05, 0], s: [1, 1.3, 1.1] }), PINK_TOP, PINK_BOTTOM, -0.12, 0.02), { coat: 1 }),
]));
const pigLower = () => cached('beast:pig:lower', () => rigMerge([
  tag(cyl(0.05, 0.045, 0.14, 6, PINK_BOTTOM, { p: [0, -0.07, 0] }), { coat: 1 }),
  box(0.045, 0.045, 0.08, 0x8a5a5a, { p: [0.024, -0.13, 0.01] }), box(0.045, 0.045, 0.08, 0x8a5a5a, { p: [-0.024, -0.13, 0.01] }),
]));

// ---------------------------------------------------------------------------------------------------------------
// Chicken

const HEN_J: V3 = [0, 0.1, 0.03];
const COMB = 0xe8423a, BEAK = 0xf2a830, SHANK = 0xf2b640;

function chickenBody(): THREE.BufferGeometry {
  return cached('beast:chicken:body', () => {
    const W = 0xfbf8f0, S = 0xece6d8;
    const p: THREE.BufferGeometry[] = [];
    const coat = { coat: 1 };
    p.push(tag(ball(0.17, W, { p: [0, 0.31, -0.02], s: [0.88, 0.88, 1.12], r: [-0.25, 0, 0] }, 1), coat));
    p.push(tag(ball(0.13, W, { p: [0, 0.33, 0.1], s: [0.95, 1, 0.9] }, 1), coat));
    p.push(tag(ball(0.12, S, { p: [0, 0.22, -0.02], s: [0.9, 0.6, 1.1] }), coat));
    // feather tiers down the flanks
    for (const s of [-1, 1]) for (let row = 0; row < 3; row++) for (let k = 0; k < 4; k++) {
      const z = 0.06 - k * 0.07 - row * 0.02, y = 0.36 - row * 0.05;
      p.push(tag(ball(0.045, row % 2 ? S : W, { p: [s * (0.135 - row * 0.005), y, z], s: [0.35, 0.55, 1], r: [0.2, s * 0.15, 0] }), coat));
    }
    // tail feathers: a fan of tiers
    const root: V3 = [0, 0.38, -0.15];
    const tail = { part: P.TAIL, joint: root, coat: 1 };
    for (let i = 0; i < 5; i++) {
      const a = (i - 2) * 0.28;
      p.push(tag(ball(0.07, i % 2 ? S : W, { p: [Math.sin(a) * 0.05, 0.47 + Math.cos(a) * 0.02, -0.2], s: [0.28, 1.2, 0.7], r: [-0.55, 0, a] }), tail));
    }
    for (let i = 0; i < 3; i++) p.push(tag(ball(0.06, W, { p: [(i - 1) * 0.045, 0.42, -0.2], s: [0.3, 1, 0.7], r: [-0.9, 0, (i - 1) * 0.3] }), tail));
    // wings with a darker trailing tier
    for (const s of [-1, 1]) {
      const pivot: V3 = [s * 0.12, 0.38, 0.04];
      const t = { part: s > 0 ? P.WING_L : P.WING_R, pivot, axis: [0, 0.15 * s, s] as V3, coat: 1 };
      p.push(tag(ball(0.13, W, { p: [s * 0.145, 0.31, -0.04], s: [0.3, 0.62, 1.05], r: [0.15, 0, s * 0.08] }), t));
      p.push(tag(ball(0.1, S, { p: [s * 0.15, 0.28, -0.11], s: [0.28, 0.5, 1], r: [0.35, 0, s * 0.1] }), t));
      for (let k = 0; k < 2; k++) p.push(tag(ball(0.05, k % 2 ? W : S, { p: [s * 0.155, 0.27 - k * 0.012, -0.13 - k * 0.035], s: [0.25, 0.4, 1.0], r: [0.5, 0, 0] }), t));
    }
    return jitter(rigMerge(p), 0.025, 3);
  });
}

function chickenHead(): THREE.BufferGeometry {
  return cached('beast:chicken:head', () => {
    const J = HEN_J, W = 0xfbf8f0;
    const p: THREE.BufferGeometry[] = [];
    const head = { part: P.HEAD, joint: J };
    p.push(tag(ball(0.085, W, { p: [0, 0.04, 0.0], s: [1, 1.2, 1] }, 1), { coat: 1 }));
    p.push(tag(ball(0.08, W, { p: [0, 0.16, 0.05] }, 1), { ...head, coat: 1 }));
    // beak: upper fixed, lower opens
    p.push(tag(cone(0.03, 0.08, 5, BEAK, { p: [0, 0.155, 0.155], r: [Math.PI / 2 + 0.15, 0, 0], s: [1, 1, 0.75] }), head));
    p.push(tag(cone(0.022, 0.05, 5, 0xe0902a, { p: [0, 0.13, 0.14], r: [Math.PI / 2 + 0.4, 0, 0], s: [1, 1, 0.6] }), { part: P.JAW, pivot: [0, 0.135, 0.11], joint: J, axis: [1, 0, 0] }));
    // comb (wobbles) and wattle (swings)
    const comb = { part: P.EAR_L, pivot: [0, 0.22, 0.06] as V3, joint: J, axis: [0, 0, 1] as V3 };
    for (let i = 0; i < 4; i++) p.push(tag(ball(0.03 - Math.abs(i - 1.2) * 0.003, COMB, { p: [0, 0.255 + (i === 1 || i === 2 ? 0.015 : 0), 0.0 + i * 0.035], s: [0.55, 1.2, 0.9] }), comb));
    const wat = { part: P.EAR_R, pivot: [0, 0.12, 0.12] as V3, joint: J, axis: [1, 0, 0] as V3 };
    for (const s of [-1, 1]) p.push(tag(ball(0.022, COMB, { p: [s * 0.014, 0.085, 0.125], s: [0.7, 1.4, 0.7] }), wat));
    // eyes on the sides, a red cheek
    for (const s of [-1, 1]) {
      p.push(...eye([s * 0.058, 0.18, 0.09], 0.024, J, { side: s * 0.7 }));
      p.push(tag(ball(0.02, COMB, { p: [s * 0.07, 0.13, 0.06], s: [0.4, 1, 1] }), head));
    }
    return rigMerge(p);
  });
}

const chickenUpper = () => cached('beast:chicken:upper', () => rigMerge([
  tag(ball(0.055, 0xf4efe4, { p: [0, -0.02, 0], s: [1, 1.3, 1.1] }), { coat: 1 }),
]));
const chickenLower = () => cached('beast:chicken:lower', () => {
  const p: THREE.BufferGeometry[] = [];
  // scaly shank: alternating bands
  for (let i = 0; i < 4; i++) p.push(cyl(0.017 - i * 0.001, 0.018 - i * 0.001, 0.03, 5, i % 2 ? SHANK : 0xe0a030, { p: [0, -0.015 - i * 0.03, 0] }));
  // three toes forward, one back
  for (const a of [-0.45, 0, 0.45]) p.push(box(0.016, 0.012, 0.075, SHANK, { p: [Math.sin(a) * 0.035, -0.114, Math.cos(a) * 0.035], r: [0, a, 0] }));
  p.push(box(0.014, 0.012, 0.04, SHANK, { p: [0, -0.114, -0.02] }));
  return rigMerge(p);
});

// ---------------------------------------------------------------------------------------------------------------
// Chick and egg

export const CHICK_J: V3 = [0, 0.1, 0.02];
export function chickBody(): THREE.BufferGeometry {
  return cached('beast:chick', () => {
    const r = rng('chick');
    const Y = 0xffe070, Y2 = 0xf6c848;
    const p: THREE.BufferGeometry[] = [];
    p.push(tag(gradient(ball(0.07, 0xffffff, { p: [0, 0.075, 0], s: [1, 0.95, 1.1] }, 1), 0xfff0a0, Y2, 0.02, 0.13), { coat: 1 }));
    for (let i = 0; i < 6; i++) {
      const a = i * 2.4 + 2, e = 0.3 + r() * 0.6;
      p.push(tag(dodec(0.022, i % 3 ? Y : Y2, { p: [Math.cos(a) * Math.cos(e) * 0.06, 0.075 + Math.sin(e) * 0.06, Math.sin(a) * Math.cos(e) * 0.07 - 0.01] }), { coat: 1 }));
    }
    p.push(tag(ball(0.022, Y, { p: [0, 0.1, -0.075], s: [1, 0.8, 1] }), { coat: 1 }));
    const head = { part: P.HEAD, joint: CHICK_J };
    p.push(tag(ball(0.05, Y, { p: [0, 0.14, 0.035] }, 1), { ...head, coat: 1 }));
    p.push(tag(dodec(0.018, 0xfff0a0, { p: [0, 0.19, 0.03] }), { ...head, coat: 1 }));
    p.push(tag(cone(0.014, 0.03, 4, BEAK, { p: [0, 0.135, 0.09], r: [Math.PI / 2, 0, 0] }), head));
    for (const s of [-1, 1]) p.push(...eye([s * 0.028, 0.155, 0.072], 0.012, CHICK_J));
    for (const s of [-1, 1]) {
      const t = { part: s > 0 ? P.WING_L : P.WING_R, pivot: [s * 0.06, 0.1, 0] as V3, axis: [0, 0, s] as V3, coat: 1 };
      p.push(tag(ball(0.035, Y2, { p: [s * 0.07, 0.075, -0.01], s: [0.35, 0.8, 1.1] }), t));
    }
    return rigMerge(p);
  });
}
export const chickLeg = () => cached('beast:chickleg', () => rigMerge([
  cyl(0.007, 0.008, 0.035, 4, SHANK, { p: [0, -0.017, 0] }),
  box(0.03, 0.006, 0.025, SHANK, { p: [0, -0.035, 0.008] }),
]));
export const eggGeo = () => cached('beast:egg', () => rigMerge([sphere(0.06, 8, 6, 0xffffff, { p: [0, 0.07, 0], s: [1, 1.3, 1] })], { coat: 1 }));

// ---------------------------------------------------------------------------------------------------------------
// Species table

/** find the neck pitch that brings the mouth down to `groundY` (rest space) for grazing */
function grazePitch(neck: V3, mouth: V3, nod: number, joint: V3, groundY: number): number {
  const v = new THREE.Vector3(), e = new THREE.Euler();
  for (let a = 0; a < 1.6; a += 0.01) {
    v.set(mouth[0] - joint[0], mouth[1] - joint[1], mouth[2] - joint[2]).applyEuler(e.set(nod, 0, 0)).add(new THREE.Vector3(...joint)).applyEuler(e.set(a, 0, 0));
    if (neck[1] + v.y <= groundY) return a;
  }
  return 1.5;
}

const quadKnees = [true, true, false, false];

const COW_NECK: V3 = [0, 1.16, 0.62], COW_MOUTH: V3 = [0, -0.1, 0.9];
const SHEEP_NECK: V3 = [0, 0.72, 0.36], SHEEP_MOUTH: V3 = [0, -0.08, 0.48];
const PIG_NECK: V3 = [0, 0.5, 0.42], PIG_MOUTH: V3 = [0, -0.12, 0.44];
const HEN_NECK: V3 = [0, 0.37, 0.11], HEN_MOUTH: V3 = [0, 0.14, 0.17];

export const BEASTS: Record<BeastKey, BeastDef> = {
  cow: {
    key: 'cow', body: () => cowBody(), head: cowHead, upper: cowUpper, lower: cowLower,
    hips: [[0.25, 0.76, 0.5], [-0.25, 0.76, 0.5], [0.25, 0.78, -0.5], [-0.25, 0.78, -0.5]],
    bones: [[0.37, 0.4], [0.37, 0.4], [0.38, 0.41], [0.38, 0.41]], boneGeo: [0.37, 0.4], kneeFwd: quadKnees,
    cog: [0, 1.0, 0], neck: COW_NECK, mouth: COW_MOUTH, grazeNod: 0.35, graze: grazePitch(COW_NECK, COW_MOUTH, 0.35, COW_J, 0.08),
    gait: { kind: 'quad', walkStride: 1.05, trotStride: 1.45, walkDuty: 0.64, trotDuty: 0.46, walkLift: 0.11, trotLift: 0.17, trotAt: 0.95, fullAt: 0.45 },
    walk: 0.55, trot: 1.35, flee: 1.8, turn: 1.6, r: 0.5, len: 1.05, lie: 'cow', lieDrop: [0.62, 0.6],
    sound: 'moo', max: 4, size: 1,
    names: ['Daisy', 'Buttercup', 'Clover', 'Bessie', 'Mabel', 'Marigold', 'Petunia', 'Honey', 'Dolly', 'Maple', 'Moomin', 'Toffee'],
    coats: [
      { tint: 0xffffff, pattern: 1, weight: 3, name: 'Holstein' }, { tint: 0xffffff, pattern: 2, weight: 2, name: 'brown & white' },
      { tint: 0xe0b078, pattern: 0, weight: 1.2, name: 'Jersey' }, { tint: 0x3a3232, pattern: 3, weight: 0.8, name: 'belted' },
      { tint: 0xa8683c, pattern: 6, weight: 1, name: 'Hereford-ish' },
    ],
  },
  sheep: {
    key: 'sheep', body: sheepBody, head: sheepHead, upper: sheepUpper, lower: sheepLower,
    hips: [[0.14, 0.41, 0.25], [-0.14, 0.41, 0.25], [0.14, 0.41, -0.25], [-0.14, 0.41, -0.25]],
    bones: [[0.2, 0.22], [0.2, 0.22], [0.2, 0.22], [0.2, 0.22]], boneGeo: [0.2, 0.22], kneeFwd: quadKnees,
    cog: [0, 0.64, 0], neck: SHEEP_NECK, mouth: SHEEP_MOUTH, grazeNod: 0.3, graze: grazePitch(SHEEP_NECK, SHEEP_MOUTH, 0.3, SHEEP_J, 0.06),
    gait: { kind: 'quad', walkStride: 0.62, trotStride: 0.9, walkDuty: 0.62, trotDuty: 0.45, walkLift: 0.07, trotLift: 0.1, trotAt: 0.8, fullAt: 0.35 },
    walk: 0.5, trot: 1.2, flee: 1.8, turn: 2.2, r: 0.38, len: 0.6, lie: 'sheep', lieDrop: [0.33, 0.33],
    sound: 'baa', max: 6, size: 1,
    names: ['Woolly', 'Cotton', 'Fluffy', 'Shaun', 'Baabara', 'Cloud', 'Lamby', 'Muffin', 'Pearl', 'Nimbus', 'Dumpling', 'Tufty'],
    coats: [
      { tint: 0xffffff, pattern: 0, weight: 5, name: 'white' }, { tint: 0xfff0dc, pattern: 0, weight: 2, name: 'cream' },
      { tint: 0x4a4446, pattern: 0, weight: 1, name: 'black' }, { tint: 0xc8a888, pattern: 0, weight: 0.6, name: 'brown' },
    ],
  },
  pig: {
    key: 'pig', body: () => pigBody(), head: pigHead, upper: pigUpper, lower: pigLower,
    hips: [[0.17, 0.27, 0.26], [-0.17, 0.27, 0.26], [0.17, 0.28, -0.28], [-0.17, 0.28, -0.28]],
    bones: [[0.12, 0.15], [0.12, 0.15], [0.12, 0.155], [0.12, 0.155]], boneGeo: [0.12, 0.15], kneeFwd: quadKnees,
    cog: [0, 0.46, 0], neck: PIG_NECK, mouth: PIG_MOUTH, grazeNod: 0.25, graze: grazePitch(PIG_NECK, PIG_MOUTH, 0.25, PIG_J, 0.04),
    gait: { kind: 'quad', walkStride: 0.46, trotStride: 0.68, walkDuty: 0.62, trotDuty: 0.45, walkLift: 0.06, trotLift: 0.085, trotAt: 0.7, fullAt: 0.3 },
    walk: 0.5, trot: 1.2, flee: 1.6, turn: 2.2, r: 0.36, len: 0.62, lie: 'pig', lieDrop: [0.2, 0.22],
    sound: 'oink', max: 5, size: 1,
    names: ['Truffle', 'Hamlet', 'Pickles', 'Wilbur', 'Peaches', 'Snuffles', 'Pudding', 'Rosie', 'Babe', 'Mochi', 'Sprout', 'Bean'],
    coats: [
      { tint: 0xffffff, pattern: 0, weight: 4, name: 'pink' }, { tint: 0xffffff, pattern: 5, weight: 1.5, name: 'spotted' },
      { tint: 0x4a4042, pattern: 3, weight: 0.8, name: 'saddleback' }, { tint: 0xf0b080, pattern: 0, weight: 0.8, name: 'ginger' },
    ],
  },
  chicken: {
    key: 'chicken', body: () => chickenBody(), head: chickenHead, upper: chickenUpper, lower: chickenLower,
    hips: [[0.07, 0.2, 0.0], [-0.07, 0.2, 0.0]],
    bones: [[0.08, 0.12], [0.08, 0.12]], boneGeo: [0.08, 0.12], kneeFwd: [false, false],
    cog: [0, 0.3, 0], neck: HEN_NECK, mouth: HEN_MOUTH, grazeNod: 0.5, graze: grazePitch(HEN_NECK, HEN_MOUTH, 0.5, HEN_J, 0.02),
    gait: { kind: 'biped', walkStride: 0.17, trotStride: 0.3, walkDuty: 0.6, trotDuty: 0.4, walkLift: 0.05, trotLift: 0.07, trotAt: 0.5, fullAt: 0.22 },
    walk: 0.3, trot: 0.9, flee: 1.9, turn: 5, r: 0.18, len: 0.22, lie: 'bird', lieDrop: [0.16, 0.16],
    sound: 'cluck', max: 9, size: 1.35,
    names: ['Nugget', 'Pip', 'Henrietta', 'Peep', 'Clucky', 'Popcorn', 'Dotty', 'Waffles', 'Biscuit', 'Marge', 'Omelette', 'Sunny', 'Pepper', 'Custard'],
    coats: [
      { tint: 0xffffff, pattern: 0, weight: 2, name: 'white' }, { tint: 0xc87444, pattern: 0, weight: 2.5, name: 'red' },
      { tint: 0xeebc78, pattern: 0, weight: 1.5, name: 'buff' }, { tint: 0xf4f0e8, pattern: 4, weight: 1.5, name: 'speckled' },
      { tint: 0x48424c, pattern: 0, weight: 0.7, name: 'black' },
    ],
  },
};

/** pick a coat by weight with a 0..1 roll */
export function pickCoat(def: BeastDef, roll: number): Coat {
  const total = def.coats.reduce((s, c) => s + c.weight, 0);
  let r = roll * total;
  for (const c of def.coats) { r -= c.weight; if (r <= 0) return c; }
  return def.coats[0];
}
