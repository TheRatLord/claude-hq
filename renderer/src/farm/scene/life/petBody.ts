/**
 * The pets' bodies: a skinned model (petModels.ts) posed every frame from a small set of blended pose parameters.
 *
 *  - Legs are IK'd (gait.ts): while walking the feet come from the footfall planner (stance feet stay planted), in
 *    poses they come from the pose's foot targets (sit: front paws stay put while the rump drops), and a few poses
 *    (sleeping curled, belly-up) drive the joints directly. Everything blends through damped parameters, so every
 *    transition is continuous.
 *  - Gait overlays: head bob and hip sway at the walk, bounce at the trot, spine flex + flight at the gallop.
 *  - Secondary motion: ear and collar-tag springs driven by the head's vertical acceleration, a tail wag whose speed
 *    follows joy (with a whole-rear wiggle when overjoyed), blinks, slow blinks, breathing, panting.
 */
import * as THREE from 'three';
import { Legs, ik2, rotX } from './gait.ts';
import { catModel, dogModel } from './petModels.ts';
import type { PetDims, PetModel } from './petModels.ts';

export type PetKind = 'dog' | 'cat';
export type PetPose = 'stand' | 'walk' | 'sit' | 'lie' | 'curl' | 'belly' | 'bow' | 'shake' | 'stretch' | 'loaf' | 'groom' | 'knead';

export interface PetInput {
  pose: PetPose;
  /** ground speed along the facing, m/s */
  speed: number;
  /** yaw rate, rad/s (+ = turning left) */
  turn: number;
  /** 0 calm … 1 overjoyed */
  joy: number;
  /** head look relative to the body (rad) */
  lookYaw: number;
  lookPitch: number;
  /** head tilt (roll, rad): curious */
  tilt: number;
  /** −1 flat back … 0 relaxed … 1 perked forward */
  ears: number;
  /** 0..1 happy closed eyes */
  happy: number;
  /** 0..1 nose to the ground */
  sniff: number;
  /** −1..1 lean sideways (into a hand, against legs) */
  lean: number;
  /** 0..1 feet on a line (fence rail) */
  narrow: number;
  /** 0..1 head bump forward (cat) */
  bump: number;
  /** 0..1 tongue out, panting */
  pant: number;
  /** a slow blink starts on the rising edge */
  slowBlink: boolean;
}

export const petInput = (pose: PetPose = 'stand'): PetInput => ({
  pose, speed: 0, turn: 0, joy: 0.3, lookYaw: 0, lookPitch: 0, tilt: 0, ears: 0, happy: 0, sniff: 0, lean: 0, narrow: 0, bump: 0, pant: 0, slowBlink: false,
});

// ---------------------------------------------------------------------------------------------
// Pose parameters

const Y = 0, PITCH = 1, ROLL = 2, FLEX = 3, CURL = 4, NECKP = 5, HEADP = 6, HEADY = 7, HEADR = 8, EARP = 9, EARO = 10,
  TLIFT = 11, TCURL = 12, TSIDE = 13, EYE = 14, HAPPY = 15, TONGUE = 16, LOCO = 17, BODYZ = 18, EXW = 19, EXA = 23, FOOT = 35,
  NECKY = 43, BREATH = 44, N = 45;
const RATES = new Float32Array(N).fill(6);
RATES[EYE] = 10; RATES[HAPPY] = 7; RATES[TONGUE] = 8; RATES[LOCO] = 5; RATES[EARP] = 9; RATES[EARO] = 9;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth01 = (t: number) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;

/** explicit joint angles for a leg: upper, lower, paw */
function ex(T: Float32Array, leg: number, u: number, l: number, p: number, w = 1): void {
  T[EXW + leg] = w; T[EXA + leg * 3] = u; T[EXA + leg * 3 + 1] = l; T[EXA + leg * 3 + 2] = p;
}
function foot(T: Float32Array, leg: number, dz: number, dy = 0): void { T[FOOT + leg * 2] = dz; T[FOOT + leg * 2 + 1] = dy; }

/**
 * Pose targets (T) and undamped overlays (O) for a pose at time t since it began. `d` = the pet's dimensions.
 * Pure function of its inputs, so the gallery and the valley pose identically.
 */
function poseTargets(d: PetDims, pose: PetPose, t: number, time: number, T: Float32Array, O: Float32Array): void {
  const dog = d.kind === 'dog', s = d.scale;
  T.fill(0); O.fill(0);
  T[Y] = d.standY; T[EYE] = 1; T[LOCO] = 1; T[BREATH] = 1;
  if (dog) { T[TLIFT] = 0.35; T[TCURL] = 0.82; } else { T[TLIFT] = 0.75; T[TCURL] = 0.55; }
  const lying = d.belly + 0.02 * s;
  switch (pose) {
    case 'stand': case 'walk': break;
    case 'sit': {
      T[LOCO] = 0; T[Y] = dog ? 0.3 : 0.19; T[PITCH] = dog ? -0.52 : -0.62; T[BODYZ] = -0.03 * s;
      T[NECKP] = dog ? 0.2 : 0.25; T[HEADP] = dog ? 0.25 : 0.3;
      foot(T, 0, -0.02 * s); foot(T, 1, -0.02 * s);
      foot(T, 2, 0.17 * s); foot(T, 3, 0.17 * s);
      if (dog) { T[TLIFT] = -0.35; } else { T[TLIFT] = -0.35; T[TSIDE] = -1.1; T[TCURL] = 0; }
      break;
    }
    case 'lie': {
      T[LOCO] = 0; T[Y] = lying + 0.015 * s; T[NECKP] = -0.15; T[HEADP] = 0.15;
      foot(T, 0, 0.2 * s, 0); foot(T, 1, 0.23 * s, 0);
      foot(T, 2, 0.14 * s); foot(T, 3, 0.14 * s);
      T[TLIFT] = dog ? -0.9 : -0.2; T[TSIDE] = dog ? 0.3 : 0.9; T[EYE] = 0.85;
      break;
    }
    case 'loaf': {
      T[LOCO] = 0; T[Y] = lying + 0.005; T[NECKP] = 0.12; T[HEADP] = -0.02; T[EYE] = 0.55; T[BREATH] = 1.3;
      // paws folded away under the chest and haunches
      ex(T, 0, 1.25, -2.5, 1.2); ex(T, 1, 1.25, -2.5, 1.2); ex(T, 2, -1.2, 2.45, -1.1); ex(T, 3, -1.2, 2.45, -1.1);
      T[TLIFT] = dog ? -0.9 : -0.3; T[TSIDE] = dog ? 0.4 : -1.1; T[TCURL] = dog ? 0.8 : 0;
      break;
    }
    case 'curl': {
      T[LOCO] = 0; T[Y] = lying; T[ROLL] = dog ? 0.3 : 0.2; T[CURL] = 0.95; T[NECKY] = dog ? 0.7 : 0.7; T[NECKP] = dog ? 0.6 : 0.5; T[HEADP] = dog ? 0.4 : 0.35; T[HEADY] = dog ? 0.75 : 0.85; T[HEADR] = dog ? 0.45 : 0.1;
      T[EARP] = -0.35; T[EYE] = 0; T[BREATH] = 2.2;
      ex(T, 0, -1.15, 0.75, 0.3); ex(T, 1, -0.95, 0.9, 0.3); ex(T, 2, -1.15, 2.1, -0.7); ex(T, 3, -1.0, 2.0, -0.7);
      T[TLIFT] = dog ? -1.45 : -0.3; T[TSIDE] = dog ? -0.75 : -1.2; T[TCURL] = dog ? 0.1 : 0;
      break;
    }
    case 'belly': {
      T[LOCO] = 0; T[Y] = d.belly * 1.05; T[ROLL] = 2.5; T[NECKP] = 0.55; T[NECKY] = 0.2; T[HEADP] = 0.35; T[HEADR] = -0.55;
      T[EARP] = -0.5; T[EARO] = 0.8; T[TONGUE] = 0.9; T[HAPPY] = 1; T[BREATH] = 1.5;
      // lazy paddling paws
      const k = Math.sin(time * 3.1) * 0.18, k2 = Math.sin(time * 2.3 + 1) * 0.15;
      ex(T, 0, -0.85 + k, 1.55, 0.9); ex(T, 1, -0.6 - k, 1.35, 0.8); ex(T, 2, -0.7 + k2, 1.2, 0.4); ex(T, 3, -0.45 - k2, 1.05, 0.4);
      T[TLIFT] = dog ? -1.1 : -0.1; T[TCURL] = dog ? 0.5 : 0.2;
      break;
    }
    case 'bow': {
      T[LOCO] = 0; T[Y] = d.standY * 0.8; T[PITCH] = 0.4; T[BODYZ] = -0.02 * s; T[NECKP] = -0.62; T[HEADP] = -0.12;
      foot(T, 0, 0.19 * s); foot(T, 1, 0.21 * s); foot(T, 2, -0.02 * s); foot(T, 3, -0.02 * s);
      T[TLIFT] = dog ? 0.1 : 1.1; T[EARP] = 0.3;
      O[Y] = Math.abs(Math.sin(time * 5)) * 0.012 * s;
      break;
    }
    case 'stretch': {
      // front stretch (bottom up, chin forward, a yawn), then the back legs one at a time
      T[LOCO] = 0;
      const a = smooth01(t / 0.9) * (1 - smooth01((t - 2.2) / 0.6));
      const b = smooth01((t - 2.4) / 0.5) * (1 - smooth01((t - 3.5) / 0.5));
      T[Y] = d.standY * (1 - 0.34 * a); T[PITCH] = 0.48 * a - 0.12 * b; T[BODYZ] = (-0.04 * a + 0.05 * b) * s;
      T[NECKP] = -0.75 * a + 0.1 * b; T[HEADP] = -0.35 * a;
      const yawn = smooth01((t - 0.7) / 0.4) * (1 - smooth01((t - 1.9) / 0.4));
      T[TONGUE] = yawn * 0.7; T[EYE] = 1 - yawn;
      T[HEADP] -= yawn * 0.25;
      foot(T, 0, 0.26 * s * a); foot(T, 1, 0.27 * s * a); foot(T, 2, (-0.02 * a) * s); foot(T, 3, (-0.02 * a) * s);
      if (b > 0) ex(T, 2, 0.95, -0.15, 0.9, b);
      T[TLIFT] = (dog ? 0.35 : 0.55) + 0.6 * a; T[EARP] = -0.25 * a;
      break;
    }
    case 'shake': {
      const env = Math.sin(Math.PI * clamp(t / 1.35, 0, 1));
      const w = Math.sin(time * TAU * 6.2);
      O[ROLL] = 0.42 * env * w;
      O[HEADR] = -0.55 * env * Math.sin(time * TAU * 6.2 - 0.9);
      O[HEADY] = 0.2 * env * Math.sin(time * TAU * 6.2 - 0.5);
      O[EARO] = 0.7 * env * Math.abs(Math.sin(time * TAU * 6.2 - 1.2));
      O[TSIDE] = 0.7 * env * Math.sin(time * TAU * 6.2 - 1.6);
      O[Y] = 0.012 * env * Math.abs(w);
      T[EYE] = 1 - env * 0.8; T[NECKP] = 0.15 * env;
      break;
    }
    case 'groom': {
      // sitting; lick a front paw, then wipe it over the face
      T[LOCO] = 0; T[Y] = dog ? 0.3 : 0.19; T[PITCH] = dog ? -0.52 : -0.62; T[BODYZ] = -0.03 * s;
      foot(T, 1, -0.02 * s); foot(T, 2, 0.17 * s); foot(T, 3, 0.17 * s);
      T[TLIFT] = -0.35; T[TSIDE] = -1.1; T[TCURL] = 0;
      const cyc = t % 4.2, wipe = smooth01((cyc - 2.4) / 0.3) * (1 - smooth01((cyc - 3.8) / 0.3));
      const lick = 1 - wipe;
      ex(T, 0, -1.55 - 0.35 * wipe, 1.95 - 0.25 * wipe, 0.75);
      T[NECKP] = 0.55 * lick + 0.1 * wipe; T[HEADP] = 0.45 * lick - 0.05 * wipe; T[HEADY] = 0.28 * lick; T[HEADR] = 0.1 + 0.35 * wipe; T[EYE] = 0.25;
      O[HEADP] = lick * Math.max(0, Math.sin(time * TAU * 3.2)) * 0.1 + wipe * Math.sin(time * TAU * 1.6) * 0.12;
      O[EXA] = wipe * Math.sin(time * TAU * 1.6) * 0.25;
      T[TONGUE] = lick * (Math.sin(time * TAU * 3.2) > 0.2 ? 0.55 : 0.1);
      T[EARP] = -0.15 * wipe; T[EARO] = 0.35 * wipe;
      break;
    }
    case 'knead': {
      T[LOCO] = 0; T[Y] = d.standY * 0.7; T[PITCH] = 0.05; T[NECKP] = 0.1; T[EYE] = 0.35; T[HAPPY] = 0.2; T[EARP] = -0.1;
      foot(T, 0, 0.04 * s); foot(T, 1, 0.04 * s); foot(T, 2, 0.02 * s); foot(T, 3, 0.02 * s);
      const k = time * TAU * 1.25;
      O[FOOT + 1] = Math.max(0, Math.sin(k)) * 0.045 * s; O[FOOT + 3] = Math.max(0, Math.sin(k + Math.PI)) * 0.045 * s;
      O[FOOT] = Math.max(0, Math.sin(k)) * 0.02 * s; O[FOOT + 2] = Math.max(0, Math.sin(k + Math.PI)) * 0.02 * s;
      O[ROLL] = Math.sin(k) * 0.04;
      T[TLIFT] = 0.9; T[TCURL] = 0.4;
      break;
    }
  }
}

// ---------------------------------------------------------------------------------------------

const PARENT_PITCH = [0, 0, 0, 0];
const _ik = { upper: 0, lower: 0, reach: 0 };
const _r = { y: 0, z: 0 };

/** A pet's body. The brain moves `root` (feet at y = 0, facing +z) and calls `animate` every frame. */
export class PetBody {
  readonly root = new THREE.Group();
  readonly model: PetModel;
  readonly mesh: THREE.SkinnedMesh;
  readonly kind: PetKind;
  readonly legs: Legs;
  private readonly d: PetDims;
  private readonly b: Record<string, THREE.Bone>;
  private readonly cur = new Float32Array(N);
  private readonly tgt = new Float32Array(N);
  private readonly ovl = new Float32Array(N);
  private readonly ovlCur = new Float32Array(N);
  private pose: PetPose = 'stand';
  private poseT = 0;
  private wagT = 0; private wagAmp = 0; private swayT = 0;
  private blinkIn = 2; private blinkT = -1; private slowT = -1; private lastSlow = false;
  private earX = 0; private earV = 0; private tagX = 0; private tagV = 0; private flickT = -1; private flickIn = 3; private twitchIn = 4; private twitchT = -1; private twitchSide = 1;
  private headY0 = 0; private headY1 = 0; private first = true;
  private seed = 1;
  // joints in their parent frames (rest)
  private readonly jointY: number[] = [];
  private readonly jointZ: number[] = [];
  private readonly parentZ: number[] = [];
  private readonly tail: THREE.Bone[];
  constructor(kind: PetKind) {
    this.kind = kind;
    this.model = kind === 'dog' ? dogModel() : catModel();
    this.mesh = this.model.mesh;
    this.d = this.model.dims;
    this.b = this.model.bones;
    this.legs = new Legs({ neutral: this.d.neutral, scale: this.d.scale });
    this.root.add(this.mesh);
    const r = this.model.rest;
    for (const L of this.d.legs) {
      const j = r[L.bones[0]], par = r[L.parent];
      this.jointY.push(j.y - par.y); this.jointZ.push(j.z - par.z); this.parentZ.push(par.z - r.body.z);
    }
    this.tail = this.d.tail.map((n) => this.b[n]);
    for (const n of ['body', 'hips', 'chest', 'neck', 'head']) this.b[n].rotation.order = 'YXZ';
    this.cur.set(this.tgt);
    poseTargets(this.d, 'stand', 0, 0, this.cur, this.ovl);
    this.ovl.fill(0);
  }

  get currentPose(): PetPose { return this.pose; }
  /** 0 (lying / low) … 1 standing: how "up" the body is right now (for the brain's timing) */
  get standing(): number { return clamp((this.cur[Y] - this.d.belly) / (this.d.standY - this.d.belly), 0, 1); }
  /** world-ish height of the head top above the root, for hearts and look-at */
  headHeight(): number { return this.cur[Y] + (this.kind === 'dog' ? 0.38 : 0.2); }

  private rnd(): number { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }

  animate(dt: number, time: number, inp: PetInput): void {
    const d = this.d, s = d.scale, dog = this.kind === 'dog';
    const C = this.cur, T = this.tgt, O = this.ovl, OC = this.ovlCur;
    if (inp.pose !== this.pose && !(inp.pose === 'walk' && this.pose === 'stand') && !(inp.pose === 'stand' && this.pose === 'walk')) this.poseT = 0;
    this.pose = inp.pose;
    this.poseT += dt;
    poseTargets(d, inp.pose, this.poseT, time, T, O);

    // ---- behaviour overlays on the targets
    const sn = inp.sniff;
    if (sn > 0) {
      T[NECKP] += 0.9 * sn * (T[LOCO] > 0.5 ? 1 : 0.5); T[HEADP] += 0.4 * sn; T[EARP] += 0.2 * sn;
      const burst = (time % 1.3) < 0.55 ? 1 : 0;
      O[HEADP] += burst * sn * Math.sin(time * TAU * 8.5) * 0.045;
      O[NECKP] += burst * sn * Math.sin(time * TAU * 4.2) * 0.03;
    }
    T[HEADR] += inp.tilt;
    T[EARP] += inp.ears > 0 ? inp.ears * 0.35 : inp.ears * 0.95;
    T[EARO] += inp.ears < 0 ? -inp.ears * 0.45 : 0;
    T[HAPPY] = Math.max(T[HAPPY], inp.happy);
    T[TONGUE] = Math.max(T[TONGUE], inp.pant * (0.75 + 0.15 * Math.sin(time * TAU * 3)));
    T[ROLL] += inp.lean * 0.14;
    T[HEADR] += inp.lean * 0.25;
    if (inp.bump > 0) { T[NECKP] -= 0.35 * inp.bump; T[HEADP] += 0.25 * inp.bump; T[BODYZ] += 0.03 * inp.bump * s; T[EYE] *= 1 - inp.bump; T[EARP] -= 0.3 * inp.bump; }
    if (inp.happy > 0) T[HEADP] -= 0.12 * inp.happy;
    // cat tail up when greeting / trotting
    if (!dog && inp.speed > 0.2 && T[LOCO] > 0.5) { const up = clamp(inp.joy, 0, 1); T[TLIFT] = 0.5 + up * 0.9; T[TCURL] = 0.25 + up * 0.35; }
    if (dog && inp.joy > 0.6 && T[LOCO] > 0.5) T[TLIFT] += 0.1;

    // ---- damp towards targets
    for (let i = 0; i < N; i++) {
      C[i] += (T[i] - C[i]) * (1 - Math.exp(-RATES[i] * dt));
      OC[i] += (O[i] - OC[i]) * (1 - Math.exp(-45 * dt));
    }

    // ---- locomotion
    const loco = C[LOCO];
    this.legs.narrow = inp.narrow;
    if (loco > 0.02) this.legs.update(dt, inp.speed * (loco > 0.5 ? 1 : 0), inp.turn);
    else this.legs.reset();
    const L = this.legs, ph = L.phase, str = L.stride * loco, w = L.w;
    let bob = 0, lPitch = 0, lFlex = 0, lRoll = 0, lHipsYaw = 0, lNeck = 0;
    bob += w.walk * -0.007 * Math.cos(4 * Math.PI * ph) * s;
    lRoll += w.walk * 0.035 * Math.sin(TAU * ph);
    lHipsYaw += w.walk * 0.07 * Math.sin(TAU * ph);
    lNeck += w.walk * 0.05 * Math.sin(4 * Math.PI * ph + 0.6);
    bob += w.trot * -0.018 * Math.cos(4 * Math.PI * (ph - 0.23)) * s;
    lNeck += w.trot * 0.06 * Math.cos(4 * Math.PI * (ph - 0.1));
    lRoll += w.trot * 0.025 * Math.sin(TAU * ph);
    bob += w.gallop * (0.03 * Math.cos(TAU * (ph - 0.47)) + 0.012) * s;
    lFlex += w.gallop * 0.2 * Math.cos(TAU * (ph - 0.9));
    lPitch += w.gallop * -0.1 * Math.cos(TAU * (ph - 0.2));
    lNeck += w.gallop * 0.16 * Math.cos(TAU * (ph - 0.55));
    bob *= str; lPitch *= str; lFlex *= str; lRoll *= str; lHipsYaw *= str; lNeck *= str;
    const run = w.gallop * str;
    // fence balance: a slow wobble the tail answers
    const wobble = inp.narrow * Math.sin(time * 1.7) * 0.05;

    // ---- wag, joy wiggle
    this.wagAmp += (inp.joy - this.wagAmp) * (1 - Math.exp(-4 * dt));
    const joy = this.wagAmp;
    this.wagT += dt * (dog ? 4 + joy * 46 : 1.3 + joy * 2.2);
    this.swayT += dt * (1.1 + inp.narrow * 0.8);
    const wag = Math.sin(this.wagT);
    const wiggle = dog ? Math.max(0, joy - 0.78) / 0.22 : 0;

    // ---- breathing
    const asleep = C[EYE] < 0.15 && inp.happy < 0.2;
    const period = inp.pant > 0.3 ? 0.36 : asleep ? 3.4 : 1.6;
    const breath = Math.sin(time * TAU / period) * (inp.pant > 0.3 ? 0.012 : 0.02) * C[BREATH];

    // ---- body chain
    const b = this.b;
    const bodyY = C[Y] + OC[Y] + bob;
    const bodyP = C[PITCH] + lPitch;
    b.body.position.set(0, bodyY, C[BODYZ]);
    b.body.rotation.set(bodyP, 0, C[ROLL] + OC[ROLL] + lRoll + wiggle * wag * 0.06 + wobble);
    const flex = C[FLEX] + lFlex;
    const hipsP = -flex, chestP = flex;
    b.hips.rotation.set(hipsP, -C[CURL] + lHipsYaw - wiggle * wag * 0.22, 0);
    b.chest.rotation.set(chestP, C[CURL] + wiggle * wag * 0.05, 0);
    b.hips.scale.set(1 + breath * 0.6, 1 + breath * 0.6, 1);
    b.chest.scale.set(1 + breath, 1 + breath, 1);
    const ly = clamp(inp.lookYaw, -1.2, 1.2), lp = clamp(inp.lookPitch, -0.7, 0.6);
    b.neck.rotation.set(C[NECKP] + OC[NECKP] + lp * 0.35 + lNeck, C[NECKY] + ly * 0.35 + OC[HEADY] * 0.3, 0);
    b.head.rotation.set(C[HEADP] + OC[HEADP] + lp * 0.65 - lNeck * 0.6 + (run > 0 ? -0.1 * run : 0), C[HEADY] + ly * 0.65 + OC[HEADY], C[HEADR] + OC[HEADR] - wobble * 0.5);

    // ---- secondary: ears + tag spring on the head's vertical acceleration
    const hy = bodyY + C[NECKP] * 0.1;
    if (this.first) { this.headY0 = this.headY1 = hy; this.first = false; }
    const acc = dt > 1e-4 ? (hy - 2 * this.headY0 + this.headY1) / (dt * dt) : 0;
    this.headY1 = this.headY0; this.headY0 = hy;
    const drive = clamp(acc, -60, 60) * (dog ? 0.012 : 0.008);
    this.earV += (-260 * this.earX - 14 * this.earV - drive * 60) * dt; this.earX += this.earV * dt;
    this.earX = clamp(this.earX, -0.5, 0.5);
    this.tagV += (-120 * this.tagX - 5 * this.tagV - drive * 80) * dt; this.tagX = clamp(this.tagX + this.tagV * dt, -0.8, 0.8);
    // ear twitches (cat: now and then, especially asleep; swivels toward sounds)
    this.twitchIn -= dt;
    if (this.twitchIn <= 0) { this.twitchIn = (dog ? 5 : 2.2) + this.rnd() * 6; this.twitchT = 0; this.twitchSide = this.rnd() < 0.5 ? 1 : -1; }
    let twL = 0, twR = 0;
    if (this.twitchT >= 0) {
      this.twitchT += dt;
      const k = this.twitchT < 0.25 ? Math.sin((this.twitchT / 0.25) * Math.PI) : 0;
      if (this.twitchSide > 0) twL = k; else twR = k;
      if (this.twitchT > 0.5) this.twitchT = -1;
    }
    const swivel = dog ? 0 : Math.sin(time * 0.37) * 0.25 * (1 - Math.abs(inp.ears));
    const earBack = -run * 0.55;
    const eP = C[EARP] + OC[EARP] + this.earX + earBack;
    const eO = C[EARO] + OC[EARO] + Math.abs(this.earX) * 0.6;
    b.earL.rotation.set(eP - twL * 0.35, swivel + twL * 0.6, -eO - twL * 0.2);
    b.earR.rotation.set(eP - twR * 0.35, -swivel - twR * 0.6, eO + twR * 0.2);
    b.tag.rotation.set(-(bodyP + chestP + C[NECKP]) * 0.8 + this.tagX, 0, -(C[ROLL] + OC[ROLL]) * 0.8);

    // ---- eyes: blink, slow blink, happy
    this.blinkIn -= dt;
    if (this.blinkIn <= 0 && this.blinkT < 0) { this.blinkT = 0; this.blinkIn = 1.8 + this.rnd() * 3.5; if (this.rnd() < 0.15) this.blinkIn = 0.25; }
    let blink = 0;
    if (this.blinkT >= 0) { this.blinkT += dt; blink = Math.sin(clamp(this.blinkT / 0.15, 0, 1) * Math.PI); if (this.blinkT > 0.15) this.blinkT = -1; }
    if (inp.slowBlink && !this.lastSlow) this.slowT = 0;
    this.lastSlow = inp.slowBlink;
    if (this.slowT >= 0) {
      this.slowT += dt;
      const st = this.slowT;
      blink = Math.max(blink, st < 0.45 ? smooth01(st / 0.45) * 0.88 : st < 0.95 ? 0.88 : 0.88 * (1 - smooth01((st - 0.95) / 0.55)));
      if (st > 1.5) this.slowT = -1;
    }
    const open = clamp(C[EYE] * (1 - blink), 0.07, 1);
    const hap = clamp(C[HAPPY], 0, 1);
    const eyeS = hap > 0.5 ? 0.001 : 1 - hap;
    b.eyeL.scale.set(eyeS, open * eyeS, eyeS); b.eyeR.scale.set(eyeS, open * eyeS, eyeS);
    const hs = hap > 0.5 ? smooth01((hap - 0.5) * 2) : 0.001;
    b.happyL.scale.setScalar(Math.max(hs, 0.001)); b.happyR.scale.setScalar(Math.max(hs, 0.001));
    b.tongue.scale.setScalar(Math.max(0.001, C[TONGUE]));

    // ---- tail
    const tl = this.tail;
    if (dog) {
      const amp = (0.12 + joy * 0.55) * (1 - asleepK(C[EYE]) * 0.9);
      tl[0].rotation.set(C[TLIFT] - run * 0.4, 0, wag * amp + C[TSIDE] + OC[TSIDE]);
      for (let i = 1; i < tl.length; i++) tl[i].rotation.set(C[TCURL] * (1 - run * 0.35), 0, Math.sin(this.wagT - i * 0.7) * amp * 0.3 + C[TSIDE] * 0.8);
    } else {
      // tip flicks: a quick separate motion of the last two segments
      this.flickIn -= dt;
      if (this.flickIn <= 0) { this.flickIn = 1.2 + this.rnd() * 3; this.flickT = 0; }
      let flick = 0;
      if (this.flickT >= 0) { this.flickT += dt; flick = Math.sin(clamp(this.flickT / 0.35, 0, 1) * TAU) * (1 - this.flickT / 0.35); if (this.flickT > 0.35) this.flickT = -1; }
      const sway = (0.18 + joy * 0.12 + inp.narrow * 0.35) * (1 - asleepK(C[EYE]) * 0.85);
      const n = tl.length;
      const curlW = [0.05, 0.2, 0.35, 0.8, 1.25];
      for (let i = 0; i < n; i++) {
        const side = Math.sin(this.swayT * TAU * 0.45 - i * 0.75) * sway * (0.4 + i * 0.18) + (i === 0 ? C[TSIDE] * 0.6 + OC[TSIDE] + wobble * -6 : C[TSIDE] * 0.48);
        const lift = i === 0 ? C[TLIFT] : C[TCURL] * curlW[i] - (i === 1 ? C[TLIFT] * 0.15 : 0);
        tl[i].rotation.set(lift + (i >= 3 ? flick * 0.35 : 0), side + (i >= 3 ? flick * 0.4 : 0), 0);
      }
    }

    // ---- legs: IK to foot targets (gait or pose), blended with explicit joint angles
    PARENT_PITCH[0] = PARENT_PITCH[1] = chestP; PARENT_PITCH[2] = PARENT_PITCH[3] = hipsP;
    for (let i = 0; i < 4; i++) {
      const LD = d.legs[i];
      const f = L.feet[i];
      const nz = d.neutral[i][1];
      const pz = nz + C[FOOT + i * 2] + OC[FOOT + i * 2], py = C[FOOT + i * 2 + 1] + OC[FOOT + i * 2 + 1];
      const fz = loco * f.z + (1 - loco) * pz;
      const fy = loco * f.y + (1 - loco) * py;
      const fx = loco * f.x + (1 - loco) * d.neutral[i][0];
      // target (paw joint) into the leg's parent frame: undo body, then parent
      const pp = PARENT_PITCH[i];
      rotX(fy + LD.h - bodyY, fz - C[BODYZ], -bodyP, _r);
      rotX(_r.y, _r.z - this.parentZ[i], -pp, _r);
      ik2(LD.a, LD.b, _r.y - this.jointY[i], _r.z - this.jointZ[i], LD.bend, _ik);
      const swingK = loco * (f.swing ? Math.sin(f.s * Math.PI) : 0);
      const pawIk = -(bodyP + pp + _ik.upper + _ik.lower) + swingK * (i < 2 ? 1.1 : 0.6) * clamp(str + 0.3, 0, 1);
      const we = C[EXW + i];
      const u = _ik.upper * (1 - we) + C[EXA + i * 3] * we + (i === 0 ? OC[EXA] : 0);
      const l = _ik.lower * (1 - we) + C[EXA + i * 3 + 1] * we;
      const p = pawIk * (1 - we) + C[EXA + i * 3 + 2] * we;
      const bu = b[LD.bones[0]], bl = b[LD.bones[1]], bp = b[LD.bones[2]];
      const splay = Math.atan2(fx - d.neutral[i][0], LD.a + LD.b) * (1 - we);
      bu.rotation.set(u, 0, splay);
      bl.rotation.set(l, 0, 0);
      bp.rotation.set(p, 0, 0);
    }
  }

  /** Put the feet home (after a teleport) */
  snap(): void { this.legs.reset(); }

  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); this.mesh.skeleton.dispose(); }
}

const asleepK = (eye: number) => clamp(1 - eye / 0.3, 0, 1);

// ---------------------------------------------------------------------------------------------
// Gallery loops (the same bodies, driven by scripted inputs)

export const DOG_LOOPS = ['stand', 'walk', 'trot', 'run', 'sit', 'sitdown', 'lie', 'sleep', 'belly', 'bow', 'sniff', 'shake', 'tilt', 'pet'] as const;
export const CAT_LOOPS = ['stand', 'walk', 'trot', 'sit', 'loaf', 'sleep', 'stretch', 'groom', 'knead', 'fence', 'pet', 'slowblink', 'bump'] as const;

/** Scripted input for a gallery loop at time t (param 0..1 scales speed / joy). Writes into `o`. */
export function galleryInput(kind: PetKind, loop: string, t: number, param: number, o: PetInput): PetInput {
  Object.assign(o, petInput('stand'));
  o.joy = 0.35;
  const dog = kind === 'dog';
  switch (loop) {
    case 'walk': o.speed = dog ? 1.1 : 0.7; o.joy = 0.4; break;
    case 'trot': o.speed = dog ? 2.6 : 1.5; o.joy = dog ? 0.7 : 1; break;
    case 'run': o.speed = 6.2; o.joy = 1; o.pant = 1; break;
    case 'sit': o.pose = 'sit'; o.lookYaw = Math.sin(t * 0.6) * 0.5; o.joy = 0.6; break;
    case 'sitdown': o.pose = (t % 5) < 2.5 ? 'sit' : 'stand'; o.joy = 0.5; break;
    case 'lie': o.pose = 'lie'; o.lookYaw = Math.sin(t * 0.4) * 0.6; break;
    case 'sleep': o.pose = 'curl'; o.joy = 0; break;
    case 'belly': o.pose = 'belly'; o.joy = 1; o.happy = 1; break;
    case 'bow': o.pose = 'bow'; o.joy = 1; o.ears = 1; break;
    case 'sniff': o.sniff = 1; o.speed = (t % 4) < 2 ? 0.45 : 0; o.joy = 0.3; break;
    case 'shake': o.pose = (t % 2.6) < 1.4 ? 'shake' : 'stand'; break;
    case 'tilt': o.tilt = Math.sin(t * 0.9) > 0 ? 0.45 : -0.4; o.ears = 1; o.joy = 0.6; break;
    case 'pet': o.happy = 1; o.ears = -1; o.joy = 1; o.lean = 0.6; o.pose = dog ? 'stand' : 'loaf'; o.lookPitch = -0.3; break;
    case 'loaf': o.pose = 'loaf'; break;
    case 'stretch': o.pose = (t % 5) < 4.2 ? 'stretch' : 'stand'; break;
    case 'groom': o.pose = 'groom'; break;
    case 'knead': o.pose = 'knead'; o.joy = 0.8; break;
    case 'fence': o.narrow = 1; o.speed = 0.45; o.joy = 0.3; break;
    case 'slowblink': o.pose = 'sit'; o.slowBlink = (t % 3) < 1.5; break;
    case 'bump': o.pose = 'stand'; o.bump = Math.max(0, Math.sin(t * 2.2)); o.happy = 0.3; o.joy = 0.8; break;
  }
  if (loop === 'walk' || loop === 'trot' || loop === 'run') o.speed *= 0.6 + param * 0.8;
  return o;
}
