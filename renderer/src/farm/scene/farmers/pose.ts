// @pure
/**
 * Poses for the chibi rig as flat channel vectors, the looping animation for every activity, the walk/jog gait and
 * a cross-fade blender so a farmer never pops between poses. Pure numbers only (no three), so it is node-testable.
 *
 * Rig conventions (model faces +z, its left is +x):
 *   arms: x = swing forward/up (rad), z = raise outward (rad); legs: x = swing forward (rad)
 *   head: p = look down (+), y = turn left (+), r = tilt
 *   lean = torso bends forward (+), drop = hips lowered (m, negative raises: sitting on a bale)
 */

export const CH = {
  bob: 0, lean: 1, roll: 2, twist: 3, drop: 4,
  headP: 5, headY: 6, headR: 7,
  aLx: 8, aLz: 9, aRx: 10, aRz: 11,
  lL: 12, lR: 13,
  sq: 14, prop: 15, lie: 16,
} as const;
export const NCH = 17;
export type Pose = Float32Array;
export const newPose = (): Pose => new Float32Array(NCH);

export const PROPS = [
  'hoe', 'trowel', 'can', 'crate', 'basket', 'rod', 'notebook', 'magnifier', 'hammer', 'saw', 'letter', 'bindle', 'broom', 'brush', 'book', 'post',
] as const;
export type Prop = (typeof PROPS)[number];

/** How a prop is held: in the right hand, the left hand, or in front with both arms. */
export const PROP_HOLD: Readonly<Record<Prop, 'R' | 'L' | 'front'>> = {
  hoe: 'R', trowel: 'R', can: 'R', crate: 'front', basket: 'L', rod: 'R', notebook: 'L', magnifier: 'R', hammer: 'R', saw: 'R',
  letter: 'front', bindle: 'R', broom: 'R', brush: 'R', book: 'front', post: 'L',
};

export const FACES = [
  'neutral', 'happy', 'focused', 'stuck', 'sleepy', 'proud', 'worried', 'talk', 'yawn', 'surprised', 'asleep', 'whistle',
] as const;
export type Face = (typeof FACES)[number];

export const ACTS = [
  'stand', 'plant', 'hoe', 'feed', 'brush', 'inspect', 'almanac', 'water', 'hammer', 'saw', 'carry', 'bend', 'read', 'plan',
  'talk', 'delegate', 'stretch', 'sweep', 'ask', 'done', 'campfire', 'fish', 'lean', 'board', 'nap', 'lie', 'chat', 'pet',
  'wave', 'cheer', 'scratch', 'oops', 'bindle', 'sitground', 'sit',
] as const;
export type Act = (typeof ACTS)[number];

export interface ActInfo {
  prop: Prop | null;
  /** default expression (mood may override) */
  face?: Face;
  /** upper body keeps its pose while walking (carrying something with arms) */
  carryWalk?: boolean;
  /** seated/kneeling: the farmer should not be walking in this act */
  grounded?: boolean;
}

export const ACT_INFO: Readonly<Record<Act, ActInfo>> = {
  stand: { prop: null }, plant: { prop: 'trowel', face: 'focused', grounded: true }, hoe: { prop: 'hoe', face: 'focused' },
  feed: { prop: 'basket', face: 'happy' }, brush: { prop: 'brush', face: 'happy' }, inspect: { prop: 'magnifier', face: 'focused', grounded: true },
  almanac: { prop: 'book', face: 'focused', carryWalk: true }, water: { prop: 'can', face: 'focused', carryWalk: true },
  hammer: { prop: 'hammer', face: 'focused' }, saw: { prop: 'saw', face: 'focused' }, carry: { prop: 'crate', carryWalk: true },
  bend: { prop: null }, read: { prop: 'letter', face: 'focused', carryWalk: true }, plan: { prop: 'notebook', face: 'focused', grounded: true },
  talk: { prop: null, face: 'talk' }, delegate: { prop: null, face: 'whistle' }, stretch: { prop: null, face: 'yawn' },
  sweep: { prop: 'broom', face: 'sleepy' }, ask: { prop: null, face: 'worried' }, done: { prop: 'basket', face: 'proud', carryWalk: true },
  campfire: { prop: null, face: 'happy', grounded: true }, fish: { prop: 'rod', face: 'happy', grounded: true },
  lean: { prop: null, face: 'happy' }, board: { prop: null, face: 'neutral' }, nap: { prop: null, face: 'asleep', grounded: true },
  lie: { prop: null, face: 'asleep', grounded: true }, chat: { prop: null, face: 'talk' }, pet: { prop: null, face: 'happy', grounded: true },
  wave: { prop: null, face: 'happy' }, cheer: { prop: null, face: 'happy' }, scratch: { prop: null, face: 'stuck' },
  oops: { prop: null, face: 'surprised' }, bindle: { prop: 'bindle', carryWalk: true }, sitground: { prop: null, face: 'happy', grounded: true },
  sit: { prop: null, face: 'happy', grounded: true },
};

const S = Math.sin, C = Math.cos, TAU = Math.PI * 2;
const tri = (x: number) => 1 - 2 * Math.abs((x % 1 + 1) % 1 - 0.5) * 2; // triangle -1..1
const pulse = (x: number, w = 0.2) => { const f = (x % 1 + 1) % 1; return f < w ? S((f / w) * Math.PI) : 0; };
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
/** Smooth 0..1 window: 1 while frac(x) is in [0, on), ramping over `edge` at both ends. */
const win = (x: number, on: number, edge = 0.06) => { const f = (x % 1 + 1) % 1; return sstep(0, edge, f) * (1 - sstep(on - edge, on, f)); };
const mix = (a: number, b: number, w: number) => a + (b - a) * w;

/** Hip height above the feet for seated acts (the system lifts the root so the hips land on a real seat). */
export const SEAT_H: Readonly<Partial<Record<Act, number>>> = { plan: 0.42, campfire: 0.32, fish: 0.25, nap: 0.08, sitground: 0.06, lie: 0.2, sit: 0.4 };

/** Relaxed standing base: arms slightly out. */
export function basePose(o: Pose): Pose {
  o.fill(0);
  o[CH.aLz] = 0.14; o[CH.aRz] = 0.14;
  return o;
}

/** Seated legs (on a bale / log / the ground). `seat` = seat height above the ground, m. */
function sit(o: Pose, seat: number) {
  o[CH.drop] = 0.3 - seat;
  o[CH.lL] = 1.45; o[CH.lR] = 1.45;
}
function kneel(o: Pose) {
  o[CH.drop] = 0.2;
  o[CH.lL] = -1.25; o[CH.lR] = -1.1;
}
function crouch(o: Pose) {
  o[CH.drop] = 0.13;
  o[CH.lL] = 0.75; o[CH.lR] = -0.5;
}

/**
 * Write the target pose of `act` at time `t` (seconds). `k` is a per-farmer personality phase (0..1) so a crowd is
 * never in sync; `tempo` scales loop speed.
 */
export function actPose(act: Act, t: number, k: number, tempo: number, o: Pose): Pose {
  basePose(o);
  const T = t * tempo + k * 10;
  const breathe = S(T * 1.6) * 0.012;
  o[CH.bob] = breathe;
  o[CH.sq] = S(T * 1.6) * 0.015;
  switch (act) {
    case 'stand': {
      // look around now and then, shift weight
      const look = S(T * 0.23) * 0.6 * clamp01(S(T * 0.11) * 2);
      o[CH.headY] = look; o[CH.headP] = -0.05 + S(T * 0.37) * 0.06;
      o[CH.roll] = S(T * 0.5) * 0.03; o[CH.lL] = S(T * 0.5) * 0.05;
      o[CH.aLx] = S(T * 0.8) * 0.05; o[CH.aRx] = -S(T * 0.8) * 0.05;
      break;
    }
    case 'plant': {
      kneel(o);
      o[CH.lean] = 0.45;
      const dig = win(T * 1.1 / 6, 0.7, 0.08); // stab the trowel into the soil, then pat the soil with both hands
      const ph = T * 2.2;
      const pat = Math.abs(S(T * 7)) * 0.25;
      o[CH.aRx] = mix(0.95 - pat, 0.7 + pulse(ph, 0.35) * 0.55, dig); o[CH.aRz] = mix(0.2, 0.1, dig); o[CH.prop] = pulse(ph, 0.35) * dig;
      o[CH.aLx] = mix(0.95 - Math.abs(S(T * 7 + 1.5)) * 0.25, 0.7, dig); o[CH.aLz] = mix(0.2, 0.3, dig);
      o[CH.headP] = 0.45; o[CH.headY] = S(T * 0.3) * 0.15;
      o[CH.bob] += Math.abs(S(ph * Math.PI)) * 0.01;
      break;
    }
    case 'hoe': {
      const ph = (T * 0.9) % 1;
      const up = ph < 0.55 ? ph / 0.55 : 1 - (ph - 0.55) / 0.45 * 1;
      const e = up < 0 ? 0 : up;
      o[CH.lean] = 0.15 + (1 - e) * 0.25;
      o[CH.aRx] = 0.5 + e * 1.6; o[CH.aLx] = 0.45 + e * 1.5; o[CH.aRz] = 0.05; o[CH.aLz] = 0.05;
      o[CH.prop] = e;
      o[CH.headP] = 0.25; o[CH.sq] += (1 - e) * -0.03;
      o[CH.lL] = 0.2; o[CH.lR] = -0.15;
      break;
    }
    case 'feed': {
      const ph = (T * 0.8) % 1;
      o[CH.aLx] = 0.9; o[CH.aLz] = 0.05;
      const toss = pulse(ph, 0.3);
      o[CH.aRx] = 0.4 + toss * 1.1; o[CH.aRz] = 0.3 + toss * 0.4; o[CH.twist] = -0.2 + toss * 0.3;
      o[CH.headP] = 0.2; o[CH.headY] = -0.2 + toss * 0.3;
      o[CH.bob] += toss * 0.02;
      break;
    }
    case 'brush': {
      o[CH.lean] = 0.3;
      o[CH.aRx] = 1.1 + S(T * 4) * 0.25; o[CH.aRz] = 0.25 + S(T * 4 + 1) * 0.3;
      o[CH.aLx] = 0.8; o[CH.aLz] = 0.4;
      o[CH.headP] = 0.25; o[CH.headR] = S(T * 0.7) * 0.12;
      o[CH.lL] = 0.15; o[CH.lR] = -0.1;
      break;
    }
    case 'inspect': {
      crouch(o);
      o[CH.lean] = 0.4;
      const peer = S(T * 0.4);
      o[CH.aRx] = 1.25 + peer * 0.15; o[CH.aRz] = -0.2 + peer * 0.1;
      o[CH.aLx] = 0.5; o[CH.aLz] = 0.25;
      o[CH.headP] = 0.35 + S(T * 0.6) * 0.1; o[CH.headY] = peer * 0.3; o[CH.headR] = S(T * 0.9) * 0.15;
      break;
    }
    case 'almanac': {
      o[CH.aLx] = 1.15; o[CH.aRx] = 1.15; o[CH.aLz] = -0.25; o[CH.aRz] = -0.25;
      const flip = pulse(T * 0.25, 0.12);
      o[CH.aRz] += flip * 0.6; o[CH.aRx] += flip * 0.25;
      o[CH.headP] = 0.4 + S(T * 1.3) * 0.05; o[CH.headY] = S(T * 0.8) * 0.12;
      o[CH.prop] = flip;
      break;
    }
    case 'water': {
      o[CH.aRx] = 1.0; o[CH.aRz] = 0.15;
      o[CH.aLx] = 0.3; o[CH.aLz] = 0.35;
      o[CH.prop] = 0.7 + S(T * 1.1) * 0.25;
      o[CH.lean] = 0.1; o[CH.headP] = 0.35; o[CH.twist] = S(T * 0.5) * 0.25;
      o[CH.roll] = S(T * 0.5) * 0.04;
      break;
    }
    case 'hammer': {
      const ph = (T * 1.6) % 1;
      // wind up slowly, strike fast
      const e = ph < 0.7 ? ph / 0.7 : 1 - (ph - 0.7) / 0.3;
      o[CH.lean] = 0.25;
      o[CH.aRx] = 0.7 + e * 1.6; o[CH.aRz] = 0.1;
      o[CH.aLx] = 0.9; o[CH.aLz] = -0.1;
      o[CH.headP] = 0.35;
      o[CH.sq] += ph > 0.95 || ph < 0.05 ? -0.04 : 0;
      o[CH.prop] = e;
      o[CH.lL] = 0.25; o[CH.lR] = -0.2;
      break;
    }
    case 'saw': {
      const s = S(T * 5);
      o[CH.lean] = 0.35;
      o[CH.aRx] = 0.9 + s * 0.35; o[CH.aRz] = 0.05;
      o[CH.aLx] = 0.8; o[CH.aLz] = 0.35;
      o[CH.twist] = s * 0.12; o[CH.headP] = 0.4;
      o[CH.lL] = 0.3; o[CH.lR] = -0.2;
      break;
    }
    case 'carry': {
      o[CH.aLx] = 1.2; o[CH.aRx] = 1.2; o[CH.aLz] = 0.05; o[CH.aRz] = 0.05;
      o[CH.lean] = -0.08; o[CH.headP] = -0.05;
      break;
    }
    case 'bend': {
      o[CH.lean] = 0.75; o[CH.drop] = 0.08;
      o[CH.aLx] = 1.0; o[CH.aRx] = 1.0; o[CH.aLz] = 0.1; o[CH.aRz] = 0.1;
      o[CH.headP] = 0.3; o[CH.lL] = 0.3; o[CH.lR] = 0.3;
      break;
    }
    case 'read': {
      o[CH.aLx] = 1.2; o[CH.aRx] = 1.2; o[CH.aLz] = -0.3; o[CH.aRz] = -0.3;
      o[CH.headP] = 0.45; o[CH.headR] = S(T * 0.5) * 0.1; o[CH.headY] = S(T * 1.7) * 0.08;
      break;
    }
    case 'plan': {
      sit(o, SEAT_H.plan!);
      o[CH.lean] = 0.2;
      const think = win(T * 0.12 - 0.7, 0.3, 0.07); // look up, tap chin with the pencil
      o[CH.aLx] = 1.0; o[CH.aLz] = -0.2;
      o[CH.aRx] = mix(1.05 + S(T * 9) * 0.05, 2.2, think); o[CH.aRz] = mix(-0.35 + S(T * 7) * 0.08, -0.45 + S(T * 6) * 0.04, think);
      o[CH.headP] = mix(0.45, -0.35, think); o[CH.headY] = mix(S(T * 0.7) * 0.1, 0.3, think); o[CH.headR] = 0.15 * think;
      o[CH.lL] += S(T * 1.3) * 0.12; o[CH.lR] += S(T * 1.3 + 2) * 0.12;
      break;
    }
    case 'talk':
    case 'chat': {
      const calm = act === 'chat' ? 0.6 : 1;
      const g1 = S(T * 2.1), g2 = S(T * 1.7 + 1);
      o[CH.aRx] = (0.6 + g1 * 0.4) * calm; o[CH.aRz] = (0.3 + g2 * 0.3) * calm;
      o[CH.aLx] = (0.4 + S(T * 1.3 + 2) * 0.35) * calm; o[CH.aLz] = 0.3 + S(T * 2.3) * 0.2 * calm;
      o[CH.headP] = -0.05 + S(T * 3.1) * 0.08; o[CH.headR] = S(T * 1.1) * 0.12; o[CH.headY] = S(T * 0.9) * 0.15;
      o[CH.bob] += Math.abs(S(T * 3.1)) * 0.012;
      o[CH.twist] = S(T * 0.8) * 0.1;
      if (act === 'chat') { const l = win(T * 0.2 - 0.85, 0.15, 0.04); o[CH.lean] = -0.15 * l; o[CH.headP] = mix(o[CH.headP], -0.3, l); o[CH.bob] += Math.abs(S(T * 18)) * 0.02 * l; } // laugh
      break;
    }
    case 'delegate': {
      const wh = win(T * 0.3 - 0.65, 0.35, 0.08); // fingers to the mouth, else point sweeping across the field
      o[CH.aLx] = mix(0.1, 2.4, wh); o[CH.aLz] = mix(0.45, -0.6, wh); o[CH.headP] = -0.1 * wh;
      o[CH.aRx] = mix(1.5 + S(T * 2.5) * 0.08, 0.2, wh); o[CH.aRz] = mix(0.25 + S(T * 0.4) * 0.35, 0.2, wh);
      o[CH.headY] = mix(-0.2 + S(T * 0.4) * 0.35, 0, wh);
      o[CH.twist] = S(T * 0.4) * -0.2;
      break;
    }
    case 'stretch': {
      const ph = (T * 0.18) % 1;
      const up = clamp01(S(ph * Math.PI) * 1.6);
      o[CH.aLz] = 0.14 + up * 2.6; o[CH.aRz] = 0.14 + up * 2.6; o[CH.aLx] = up * 0.4; o[CH.aRx] = up * 0.4;
      o[CH.lean] = -0.2 * up; o[CH.headP] = -0.4 * up; o[CH.sq] += up * 0.06;
      o[CH.roll] = S(T * 0.9) * 0.1 * up;
      break;
    }
    case 'sweep': {
      const s = S(T * 3.2);
      o[CH.lean] = 0.2;
      o[CH.aRx] = 0.7 + s * 0.2; o[CH.aRz] = -0.1 + s * 0.35; o[CH.aLx] = 0.8; o[CH.aLz] = -0.15 + s * 0.3;
      o[CH.twist] = s * 0.25; o[CH.headP] = 0.3;
      o[CH.prop] = s;
      break;
    }
    case 'ask': {
      // hop, wave both arms overhead
      const ph = (T * 1.4) % 1;
      const hop = Math.max(0, S(ph * TAU)) ;
      o[CH.bob] = hop * 0.22;
      o[CH.sq] = hop > 0.05 ? 0.08 * hop : -0.07;
      const w = S(T * 9);
      o[CH.aLz] = 2.05 + w * 0.5; o[CH.aRz] = 2.05 - w * 0.5; o[CH.aLx] = 0.25; o[CH.aRx] = 0.25;
      o[CH.headP] = -0.15; o[CH.headR] = w * 0.08;
      o[CH.lL] = hop * 0.3; o[CH.lR] = hop * 0.3;
      break;
    }
    case 'done': {
      o[CH.aLx] = 0.35; o[CH.aLz] = 0.45; // basket on the hip
      o[CH.aRz] = 0.25; o[CH.aRx] = 0.05 + S(T * 0.9) * 0.05;
      o[CH.roll] = S(T * 1.1) * 0.06; o[CH.headR] = S(T * 1.1 + 0.4) * 0.12; o[CH.headP] = -0.12;
      o[CH.lean] = -0.06;
      break;
    }
    case 'campfire': {
      sit(o, SEAT_H.campfire!);
      o[CH.lean] = 0.1;
      const warm = win(T * 0.1, 0.5, 0.08);
      o[CH.aLx] = mix(0.6, 1.3, warm); o[CH.aRx] = mix(0.6, 1.3, warm); o[CH.aLz] = mix(0.1, -0.15, warm); o[CH.aRz] = mix(0.1, -0.15, warm);
      o[CH.roll] = S(T * 0.7) * 0.07; o[CH.headR] = S(T * 0.7) * 0.1; o[CH.headP] = 0.05;
      break;
    }
    case 'fish': {
      sit(o, SEAT_H.fish!);
      const tug = pulse(T * 0.15, 0.08);
      o[CH.aRx] = 1.1 + tug * 0.6; o[CH.aLx] = 1.0 + tug * 0.5; o[CH.aRz] = -0.1; o[CH.aLz] = -0.25;
      o[CH.prop] = tug; o[CH.headP] = 0.1 - tug * 0.2; o[CH.lean] = 0.05 - tug * 0.1;
      o[CH.lL] += S(T * 1.1) * 0.25; o[CH.lR] += S(T * 1.1 + 1.8) * 0.25; // swinging feet over the water
      break;
    }
    case 'lean': {
      o[CH.lean] = 0.25; o[CH.roll] = 0.08;
      o[CH.aLx] = 1.35; o[CH.aRx] = 1.35; o[CH.aLz] = -0.35; o[CH.aRz] = -0.35; // arms folded on the rim
      o[CH.headP] = 0.15; o[CH.headY] = S(T * 0.2) * 0.4;
      o[CH.lL] = 0.1; o[CH.lR] = -0.25;
      break;
    }
    case 'board': {
      o[CH.headP] = -0.2; o[CH.headY] = S(T * 0.3) * 0.3; o[CH.headR] = S(T * 0.5) * 0.08;
      o[CH.aRx] = 2.1; o[CH.aRz] = -0.5; // hand on chin
      o[CH.aLx] = 0.7; o[CH.aLz] = -0.3;
      break;
    }
    case 'nap': {
      sit(o, SEAT_H.nap!);
      o[CH.lean] = -0.1 + S(T * 0.9) * 0.02; o[CH.headP] = 0.45; o[CH.headR] = 0.25;
      o[CH.aLx] = 0.4; o[CH.aRx] = 0.4; o[CH.aLz] = 0.05; o[CH.aRz] = 0.05;
      o[CH.sq] = S(T * 0.9) * 0.025;
      break;
    }
    case 'lie': {
      o[CH.lie] = 1;
      o[CH.aLz] = 2.4; o[CH.aRz] = 2.4; // hands behind the head
      o[CH.aLx] = 0.2; o[CH.aRx] = 0.2; o[CH.lL] = 0.1; o[CH.lR] = 0.35;
      o[CH.headY] = S(T * 0.15) * 0.2; o[CH.sq] = S(T * 0.9) * 0.02;
      break;
    }
    case 'pet': {
      crouch(o);
      o[CH.lean] = 0.35;
      o[CH.aRx] = 1.05; o[CH.aRz] = 0.1 + S(T * 3) * 0.25;
      o[CH.aLx] = 0.4; o[CH.aLz] = 0.3; o[CH.headP] = 0.3; o[CH.headR] = S(T * 0.8) * 0.15;
      break;
    }
    case 'wave': {
      o[CH.aRz] = 2.1 + S(T * 10) * 0.45; o[CH.aRx] = 0.3;
      o[CH.headR] = 0.15; o[CH.headP] = -0.1; o[CH.roll] = -0.05;
      o[CH.bob] += Math.abs(S(T * 5)) * 0.015;
      break;
    }
    case 'cheer': {
      const ph = (T * 1.8) % 1;
      const hop = Math.max(0, S(ph * TAU));
      o[CH.bob] = hop * 0.3; o[CH.sq] = hop * 0.08;
      o[CH.aRz] = 2.35; o[CH.aRx] = 0.3 + hop * 0.3; o[CH.aLz] = 0.4 + hop * 1.7; o[CH.aLx] = 0.5;
      o[CH.headP] = -0.3; o[CH.lL] = hop * 0.4; o[CH.lR] = -hop * 0.2;
      break;
    }
    case 'scratch': {
      o[CH.aRx] = 2.0; o[CH.aRz] = 0.9 + S(T * 14) * 0.12; // hand on the head, scratching
      o[CH.aLz] = 0.3; o[CH.aLx] = 0.3;
      o[CH.headR] = 0.25; o[CH.headP] = 0.1; o[CH.roll] = 0.05;
      break;
    }
    case 'oops': {
      o[CH.lean] = -0.25; o[CH.bob] = 0.05;
      o[CH.aLz] = 1.2; o[CH.aRz] = 1.2; o[CH.aLx] = 0.6; o[CH.aRx] = 0.6;
      o[CH.headP] = -0.2; o[CH.sq] = 0.08;
      break;
    }
    case 'bindle': {
      o[CH.aRx] = 2.3; o[CH.aRz] = -0.35; // bindle stick over the shoulder
      o[CH.headP] = -0.05;
      break;
    }
    case 'sit': {
      // on a bench / rocker: hands on the knees, swinging feet, looking around
      sit(o, SEAT_H.sit!);
      o[CH.lean] = -0.05 + S(T * 0.6) * 0.04;
      o[CH.aLx] = 0.75; o[CH.aRx] = 0.75; o[CH.aLz] = -0.05; o[CH.aRz] = -0.05;
      o[CH.lL] += S(T * 1.6) * 0.3; o[CH.lR] += S(T * 1.6 + 2.2) * 0.3;
      o[CH.headY] = S(T * 0.21) * 0.5; o[CH.headP] = -0.05 + S(T * 0.33) * 0.08; o[CH.headR] = S(T * 0.5) * 0.08;
      break;
    }
    case 'sitground': {
      sit(o, SEAT_H.sitground!);
      o[CH.lean] = -0.25; o[CH.aLx] = -0.6; o[CH.aRx] = -0.6; o[CH.aLz] = 0.3; o[CH.aRz] = 0.3; // leaning back on hands
      o[CH.headP] = -0.2; o[CH.headY] = S(T * 0.25) * 0.4;
      o[CH.lL] = 1.35 + S(T * 1.2) * 0.1; o[CH.lR] = 1.35 - S(T * 1.2) * 0.1;
      break;
    }
  }
  return o;
}

/**
 * Walk / jog gait overlay: legs, arm swing, bob, lean. `phase` advances with distance travelled (so feet don't
 * skate), `w` is the gait weight (0 standing … 1 moving), `jog` 0..1, `carry` keeps the arms (holding something).
 */
export function gait(o: Pose, phase: number, w: number, jog: number, bounce: number, carry: boolean): void {
  if (w <= 0) return;
  const s = S(phase * TAU);
  const leg = (0.55 + jog * 0.35) * w;
  const keep = 1 - w;
  o[CH.lL] = o[CH.lL] * keep + s * leg;
  o[CH.lR] = o[CH.lR] * keep - s * leg;
  o[CH.drop] *= keep;
  o[CH.lie] *= keep;
  o[CH.bob] += Math.abs(C(phase * TAU)) * (0.045 + jog * 0.05) * bounce * w;
  o[CH.sq] += (Math.abs(C(phase * TAU)) - 0.5) * 0.04 * bounce * w;
  o[CH.lean] = o[CH.lean] * keep + (0.06 + jog * 0.14) * w;
  o[CH.roll] += s * 0.05 * w;
  if (!carry) {
    const arm = (0.5 + jog * 0.45) * w;
    o[CH.aLx] = o[CH.aLx] * keep - s * arm + jog * 0.3 * w;
    o[CH.aRx] = o[CH.aRx] * keep + s * arm + jog * 0.3 * w;
    o[CH.aLz] = o[CH.aLz] * keep + 0.18 * w;
    o[CH.aRz] = o[CH.aRz] * keep + 0.18 * w;
  }
  o[CH.headP] = o[CH.headP] * keep + (-0.04 + tri(phase) * 0.02) * w;
}

/**
 * Cross-fading pose blender. When the act changes, the current output is frozen as `from` and the new act fades in
 * over `dur` seconds with smoothstep, so every transition is continuous no matter when it happens (even mid-fade).
 */
export interface Blend {
  act: Act;
  from: Pose;
  w: number;
  dur: number;
}
export const newBlend = (act: Act): Blend => ({ act, from: newPose(), w: 1, dur: 0.5 });

export function setAct(b: Blend, act: Act, current: Pose, dur = 0.55): void {
  if (b.act === act) return;
  b.from.set(current);
  b.act = act;
  b.w = 0;
  b.dur = dur;
}

/** out = mix(from, target, ease(w)); advances w. */
export function blendStep(b: Blend, target: Pose, dt: number, out: Pose): Pose {
  b.w = Math.min(1, b.w + dt / Math.max(0.01, b.dur));
  const e = b.w * b.w * (3 - 2 * b.w);
  for (let i = 0; i < NCH; i++) out[i] = b.from[i] + (target[i] - b.from[i]) * e;
  return out;
}

/** Largest per-channel jump between two poses (tests: transitions must stay continuous). */
export function poseDelta(a: Pose, b: Pose): number {
  let m = 0;
  for (let i = 0; i < NCH; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}
