// @pure
/**
 * Poses for the voxel mascots as flat channel vectors, the looping animation of every activity, the two gaits
 * (Clawd's four-legged scuttle, Codex's hop-waddle), per-channel springs that carry every transition with a little
 * overshoot, and the face → eye-glyph mapping. Pure numbers only (no three), so it is node-testable.
 *
 * Conventions (model faces +z, its left is +x, y up; see mascots.ts for the body plans):
 *   bob     body lift (m)                    drop  0..1 body lowered toward its feet (1 = sitting on the ground / seat)
 *   lean    pitch forward (+, rad)           roll  tilt; + raises the model's left side     twist  yaw (+ turns left)
 *   sq      squash (−) / stretch (+), volume-preserving about the body bottom
 *   lie     0..1 flop over onto the side     tuck  0..1 legs folded forward (sitting)
 *   l0..l3  extra leg swing (+ forward, rad): Clawd FL FR BL BR; Codex L R
 *   aLy aLz aLx aLe (and aR…)  nub swing forward, raise up, twist, extend (0 = normal length)
 *   eyeX eyeY  eye shift in body voxels (looking around)      eyeS  eye scale (+ wide)
 *   pP pY   held prop pitch (+ tips down) / yaw, relative to the body     prop  the prop's action parameter (0..1)
 *   jig     lobe / scarf jiggle energy
 */

export const CH = {
  bob: 0, drop: 1, lean: 2, roll: 3, twist: 4, sq: 5, lie: 6, tuck: 7,
  l0: 8, l1: 9, l2: 10, l3: 11,
  aLy: 12, aLz: 13, aLx: 14, aLe: 15, aRy: 16, aRz: 17, aRx: 18, aRe: 19,
  eyeX: 20, eyeY: 21, eyeS: 22,
  pP: 23, pY: 24, prop: 25, jig: 26,
} as const;
export const NCH = 27;
export type Pose = Float32Array;
export const newPose = (): Pose => new Float32Array(NCH);

export type Body = 'clawd' | 'codex';

export const PROPS = [
  'hoe', 'trowel', 'can', 'crate', 'basket', 'rod', 'notebook', 'magnifier', 'hammer', 'saw', 'letter', 'bindle', 'broom', 'brush', 'book',
  // villagers' night lantern (no act owns it; scene/villagers hands it over after dark)
  'lantern',
  // search: a burlap seed sack to rummage in; web fetch: a carrier pigeon perched on the nub
  'sack', 'pigeon',
  // geometry-only variants (the rig swaps them in while the pigeon flies: wings up / down); no act holds them
  'pigeonup', 'pigeondown',
] as const;
export type Prop = (typeof PROPS)[number];
export type Hold = 'L' | 'R' | 'both' | 'over';

export const FACES = [
  'neutral', 'happy', 'focused', 'stuck', 'sleepy', 'proud', 'worried', 'talk', 'yawn', 'surprised', 'asleep', 'whistle', 'oops', 'sparkle',
] as const;
export type Face = (typeof FACES)[number];

export const ACTS = [
  'stand', 'plant', 'hoe', 'feed', 'brush', 'inspect', 'almanac', 'water', 'hammer', 'saw', 'carry', 'bend', 'read', 'plan',
  'talk', 'delegate', 'stretch', 'sweep', 'ask', 'done', 'campfire', 'fish', 'lean', 'board', 'nap', 'lie', 'chat', 'pet',
  'wave', 'cheer', 'scratch', 'oops', 'bindle', 'sitground', 'sit',
  // leisure loops at the nooks
  'reel', 'catch', 'toast', 'sitread', 'sitchat', 'picnic', 'stargaze', 'telescope', 'checkers', 'ponder', 'soak', 'gaze',
  // work flavours: search = rummage in the seed sack; web fetch = a carrier pigeon flies in to the raised nub
  'rummage', 'pigeon',
] as const;
export type Act = (typeof ACTS)[number];

export interface ActInfo {
  prop: Prop | null;
  /** which nub(s) hold the prop */
  hold?: Hold;
  /** default expression (mood may override) */
  face?: Face;
  /** upper body keeps its pose while walking (carrying something) */
  carryWalk?: boolean;
  /** heavy load: shorter, squashier steps */
  heavy?: boolean;
  /** seated / crouched: the farmer should not be walking in this act */
  grounded?: boolean;
  /** one-shot reaction: the loop runs on time since the act began */
  oneShot?: boolean;
}

export const ACT_INFO: Readonly<Record<Act, ActInfo>> = {
  stand: { prop: null },
  plant: { prop: 'trowel', hold: 'R', face: 'focused', grounded: true },
  hoe: { prop: 'hoe', hold: 'R', face: 'focused' },
  feed: { prop: 'basket', hold: 'L', face: 'happy' },
  brush: { prop: 'brush', hold: 'R', face: 'happy' },
  inspect: { prop: 'magnifier', hold: 'R', face: 'focused', grounded: true },
  almanac: { prop: 'book', hold: 'both', face: 'focused', carryWalk: true },
  water: { prop: 'can', hold: 'R', face: 'focused', carryWalk: true },
  hammer: { prop: 'hammer', hold: 'R', face: 'focused' },
  saw: { prop: 'saw', hold: 'R', face: 'focused' },
  carry: { prop: 'crate', hold: 'over', carryWalk: true, heavy: true },
  bend: { prop: null },
  read: { prop: 'letter', hold: 'R', face: 'focused', carryWalk: true },
  plan: { prop: 'notebook', hold: 'L', face: 'focused', grounded: true },
  talk: { prop: null, face: 'talk' },
  delegate: { prop: null, face: 'whistle' },
  stretch: { prop: null, face: 'yawn' },
  sweep: { prop: 'broom', hold: 'R', face: 'sleepy' },
  ask: { prop: null, face: 'surprised' },
  done: { prop: 'basket', hold: 'both', face: 'proud', carryWalk: true },
  campfire: { prop: null, face: 'happy', grounded: true },
  fish: { prop: 'rod', hold: 'R', face: 'happy', grounded: true },
  lean: { prop: null, face: 'happy' },
  board: { prop: null, face: 'neutral' },
  nap: { prop: null, face: 'asleep', grounded: true },
  lie: { prop: null, face: 'asleep', grounded: true },
  chat: { prop: null, face: 'talk' },
  pet: { prop: null, face: 'happy', grounded: true },
  wave: { prop: null, face: 'happy' },
  cheer: { prop: null, face: 'sparkle', oneShot: true },
  scratch: { prop: null, face: 'stuck' },
  oops: { prop: null, face: 'oops', oneShot: true },
  bindle: { prop: 'bindle', hold: 'R', carryWalk: true },
  sitground: { prop: null, face: 'happy', grounded: true },
  sit: { prop: null, face: 'happy', grounded: true },
  reel: { prop: 'rod', hold: 'R', face: 'surprised', grounded: true },
  catch: { prop: 'rod', hold: 'R', face: 'sparkle', grounded: true },
  toast: { prop: null, face: 'happy', grounded: true },
  sitread: { prop: 'book', hold: 'both', face: 'focused', grounded: true },
  sitchat: { prop: null, face: 'talk', grounded: true },
  picnic: { prop: null, face: 'happy', grounded: true },
  stargaze: { prop: null, face: 'happy', grounded: true },
  telescope: { prop: null, face: 'focused' },
  checkers: { prop: null, face: 'focused', grounded: true },
  ponder: { prop: null, face: 'neutral', grounded: true },
  soak: { prop: null, face: 'happy', grounded: true },
  gaze: { prop: null, face: 'happy' },
  rummage: { prop: 'sack', hold: 'L', face: 'focused' },
  pigeon: { prop: 'pigeon', hold: 'R', face: 'happy' },
};

/** Carrier pigeon timing (s, on the act's local clock): flies in, perches, flies off. `pigeonFly` is 1 far … 0 perched. */
export const PIGEON = { in: 1.8, perch: 3.6, out: 5.4 } as const;
export function pigeonFly(local: number): number {
  if (local < PIGEON.in) { const u = 1 - local / PIGEON.in; return u * u; }
  if (local < PIGEON.perch) return 0;
  const u = Math.min(1, (local - PIGEON.perch) / (PIGEON.out - PIGEON.perch));
  return u < 1 ? u * u : 1;
}

/** Default hold for a prop when the act does not say. */
export const holdOf = (act: Act): Hold => ACT_INFO[act].hold ?? 'R';

/**
 * Body-bottom height above the root for seated acts (m). Seats publish the height of their surface; the system puts
 * the root there minus this, so the body lands on the log / bale / dock.
 */
export const SEAT_H: Readonly<Partial<Record<Act, number>>> = { plan: 0, campfire: 0, fish: 0, nap: 0, sitground: 0, lie: 0, sit: 0,
  reel: 0, catch: 0, toast: 0, sitread: 0, sitchat: 0, picnic: 0, stargaze: 0, checkers: 0, ponder: 0, soak: 0 };

const S = Math.sin, C = Math.cos, TAU = Math.PI * 2, PI = Math.PI;
const fract = (x: number) => x - Math.floor(x);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
/** Smooth 0..1 window: 1 while frac(x) is in [0, on), easing over `edge` at both ends. */
const win = (x: number, on: number, edge = 0.06) => { const f = fract(x); return sstep(0, edge, f) * (1 - sstep(on - edge, on, f)); };
const mix = (a: number, b: number, w: number) => a + (b - a) * w;
/** a smooth bump over [a, b] of the cycle (0 outside) */
const bump = (f: number, a: number, b: number) => (f <= a || f >= b ? 0 : S(((f - a) / (b - a)) * PI));
/** smooth periodic noise, −1..1 */
const wander = (x: number) => (S(x) * 0.6 + S(x * 2.31 + 1.7) * 0.3 + S(x * 4.87 + 4.1) * 0.1);

function arms(o: Pose, ly: number, lz: number, ry: number, rz: number): void {
  o[CH.aLy] = ly; o[CH.aLz] = lz; o[CH.aRy] = ry; o[CH.aRz] = rz;
}
function legs(o: Pose, a: number, b = a, c = a, d = b): void { o[CH.l0] = a; o[CH.l1] = b; o[CH.l2] = c; o[CH.l3] = d; }
/** sitting: body down on the seat, legs folded forward */
function seated(o: Pose): void { o[CH.drop] = 1; o[CH.tuck] = 1; }

/** Relaxed standing base: nubs a touch down, breathing. */
export function basePose(o: Pose, T: number): Pose {
  o.fill(0);
  o[CH.aLz] = -0.12; o[CH.aRz] = -0.12;
  const br = S(T * 1.7);
  o[CH.sq] = br * 0.018;
  o[CH.bob] = 0;
  o[CH.aLz] += br * 0.03; o[CH.aRz] += br * 0.03;
  return o;
}

/**
 * Write the target pose of `act` at time `t` (seconds). `k` is a per-farmer personality phase (0..1) so a crowd is
 * never in sync; `tempo` scales loop speed; `local` is the time since this act began (one-shot reactions).
 */
export function actPose(act: Act, t: number, k: number, tempo: number, o: Pose, local = t, body: Body = 'clawd'): Pose {
  const T = t * tempo + k * 10;
  basePose(o, T);
  switch (act) {
    case 'stand': {
      // look around (eyes lead, the body follows), shift weight, and every so often a little shake
      const look = wander(T * 0.35);
      o[CH.eyeX] = look * 0.9; o[CH.eyeY] = wander(T * 0.21 + 3) * 0.35;
      o[CH.twist] = wander(T * 0.35 - 0.6) * 0.18;
      o[CH.roll] = S(T * 0.45) * 0.035;
      const shake = win(T / 9 + k, 0.05, 0.012);
      o[CH.roll] += S(T * 38) * 0.07 * shake; o[CH.sq] += shake * 0.03;
      const tap = win(T / 6.5 + k * 3, 0.08, 0.02);
      o[CH.l0] = tap * 0.35 * Math.max(0, S(T * 22));
      o[CH.aLy] = S(T * 0.8) * 0.08; o[CH.aRy] = -S(T * 0.8 + 0.5) * 0.08;
      break;
    }
    case 'plant': {
      // crouched over the row: stab the trowel in, wiggle it, pat the soil down with the other nub; the body bobs with it
      const ph = fract(T * 0.95);
      const stab = bump(ph, 0.12, 0.42), wig = ph > 0.42 && ph < 0.62 ? S((ph - 0.42) * TAU * 5) : 0;
      const pat = bump(ph, 0.66, 0.78) + bump(ph, 0.8, 0.92);
      o[CH.drop] = 0.55 + stab * 0.12; o[CH.lean] = 0.32 + stab * 0.1;
      o[CH.sq] -= stab * 0.06 - pat * 0.02;
      o[CH.aRy] = 1.0; o[CH.aRz] = -0.35 - stab * 0.35; o[CH.aRe] = 0.15 + stab * 0.15;
      o[CH.pP] = 1.2 + stab * 0.35 + wig * 0.12; o[CH.pY] = wig * 0.15;
      o[CH.aLy] = 0.9; o[CH.aLz] = -0.2 - pat * 0.45;
      o[CH.eyeY] = -0.5; o[CH.eyeX] = -0.3 + S(T * 0.4) * 0.25;
      o[CH.prop] = stab;
      o[CH.roll] = wig * 0.03;
      legs(o, 0.15, 0.15, -0.1, -0.1);
      break;
    }
    case 'hoe': {
      // lift (slow), chop (fast), tug back
      const ph = fract(T * 0.85);
      const up = ph < 0.6 ? sstep(0, 0.6, ph) : 1 - sstep(0.6, 0.72, ph);
      const hit = bump(ph, 0.7, 0.86);
      o[CH.lean] = 0.1 - up * 0.2 + hit * 0.25; o[CH.sq] += up * 0.06 - hit * 0.08;
      o[CH.aRy] = 1.1; o[CH.aRz] = -0.2 + up * 0.9; o[CH.aLy] = 1.2; o[CH.aLz] = -0.2 + up * 0.8;
      o[CH.pP] = 0.7 - up * 1.3; o[CH.prop] = hit;
      o[CH.eyeY] = -0.4;
      break;
    }
    case 'feed': {
      // basket on the left nub, scatter grain with the right in wide tosses
      const ph = fract(T * 0.75);
      const toss = bump(ph, 0.1, 0.45);
      o[CH.aLy] = 0.7; o[CH.aLz] = -0.35;
      o[CH.aRy] = 0.3 + toss * 1.1; o[CH.aRz] = -0.1 + toss * 0.7; o[CH.aRe] = toss * 0.2;
      o[CH.twist] = -0.2 + toss * 0.4; o[CH.bob] = toss * 0.03; o[CH.sq] += toss * 0.03;
      o[CH.eyeX] = -0.5 + toss * 1.2;
      break;
    }
    case 'brush': {
      const s = S(T * 3.6);
      o[CH.lean] = 0.2 + s * 0.04; o[CH.roll] = s * 0.05; o[CH.twist] = s * 0.08;
      o[CH.aRy] = 1.15 + s * 0.3; o[CH.aRz] = 0.1 + C(T * 3.6) * 0.15; o[CH.pY] = s * 0.3;
      o[CH.aLy] = 0.7; o[CH.aLz] = 0.05;
      o[CH.eyeX] = s * 0.4;
      break;
    }
    case 'inspect': {
      // lean in with the magnifier held up to one eye, sweep slowly across the crop; now and then a "hmm" tilt
      const sweep = S(T * 0.55), hmm = win(T / 7 + k, 0.2, 0.05);
      o[CH.drop] = 0.3; o[CH.lean] = 0.42 + sweep * 0.04;
      o[CH.aRy] = 1.35 + sweep * 0.2; o[CH.aRz] = 0.28 - hmm * 0.1; o[CH.aRe] = 0.1;
      o[CH.pY] = -sweep * 0.25;
      o[CH.aLy] = 0.2; o[CH.aLz] = -0.35 + hmm * 0.5;
      o[CH.twist] = sweep * 0.16; o[CH.roll] = hmm * 0.18;
      o[CH.eyeX] = sweep * 0.6; o[CH.eyeY] = -0.25;
      break;
    }
    case 'rummage': {
      // search: the seed sack hangs from the left nub, the right nub dives in and stirs, the eyes peer in; every couple
      // of seconds it pops out and flings a handful over the shoulder (not this one!); now and then a "found it" hop
      const ph = fract(T * 0.42);
      const dig = 1 - bump(ph, 0.62, 0.92), fling = bump(ph, 0.66, 0.86);
      const stir = S(T * 7.5) * dig;
      const found = win(T / 9 + k * 2, 0.07, 0.02);
      o[CH.drop] = 0.22 * dig; o[CH.lean] = 0.42 * dig - 0.12 * fling;
      o[CH.aLy] = 1.0; o[CH.aLz] = -0.25; o[CH.aLe] = 0.1;
      o[CH.aRy] = mix(1.05 + stir * 0.12, -0.2, fling); o[CH.aRz] = mix(-0.42 + C(T * 7.5) * 0.1 * dig, 1.35, fling); o[CH.aRe] = 0.15 + fling * 0.25;
      o[CH.twist] = 0.18 * dig + stir * 0.05 - fling * 0.25; o[CH.roll] = stir * 0.04;
      o[CH.eyeY] = mix(-0.55, 0.3, fling); o[CH.eyeX] = mix(0.35 + stir * 0.2, -0.6, fling);
      o[CH.prop] = fling;
      o[CH.bob] = found * 0.08; o[CH.sq] += found * 0.08 - dig * 0.02; o[CH.eyeS] = found * 0.3;
      legs(o, 0.1 * dig, 0.1 * dig, -0.05, -0.05);
      break;
    }
    case 'pigeon': {
      // web fetch: nub held up as a perch, eyes on the sky; the pigeon lands (a little dip under it), the farmer leans
      // in to it, it flies off and the nub waves it away. Runs on the act's own clock (`local`), like a one-shot.
      const fly = pigeonFly(local);
      const perched = sstep(PIGEON.in - 0.2, PIGEON.in + 0.2, local) * (1 - sstep(PIGEON.perch - 0.2, PIGEON.perch + 0.2, local));
      const away = sstep(PIGEON.out - 0.4, PIGEON.out, local);
      const landDip = bump(local, PIGEON.in - 0.05, PIGEON.in + 0.35);
      o[CH.aRy] = mix(0.75, 0.4 + S(T * 9) * 0.3, away); o[CH.aRz] = mix(1.05 - landDip * 0.25, 1.1 + S(T * 9 + 1) * 0.25, away); o[CH.aRe] = 0.35;
      o[CH.aLy] = 0.2; o[CH.aLz] = -0.1 + perched * 0.3;
      o[CH.lean] = mix(-0.16, 0.05, perched); o[CH.twist] = perched * 0.22;
      o[CH.sq] -= landDip * 0.05;
      o[CH.eyeY] = mix(mix(0.3, 0.8, fly), 0.3, perched); o[CH.eyeX] = mix(-0.2 + fly * 0.4, -0.6, perched); o[CH.eyeS] = landDip * 0.25;
      o[CH.bob] = perched * Math.abs(S(T * 3)) * 0.015;
      // pY = the wing beat while flying (the rig swaps wings-up / wings-down frames on its sign; no rotation)
      o[CH.prop] = fly; o[CH.pP] = 0; o[CH.pY] = S(local * 40) * Math.min(1, fly * 6) * 0.4;
      break;
    }
    case 'almanac': {
      const flip = win(T * 0.2, 0.12, 0.04);
      arms(o, 1.2, -0.05, 1.2 - flip * 0.3, -0.05 + flip * 0.5);
      o[CH.lean] = 0.1; o[CH.prop] = flip;
      o[CH.eyeY] = -0.4; o[CH.eyeX] = S(T * 1.8) * 0.5; // reading line by line
      o[CH.roll] = S(T * 0.6) * 0.03;
      break;
    }
    case 'water': {
      // can out on the right nub, tipped to pour; body leans with the weight and sways along the row
      const pour = 0.55 + S(T * 1.2) * 0.2;
      o[CH.aRy] = 0.95; o[CH.aRz] = -0.15 + S(T * 1.2) * 0.05; o[CH.aRe] = 0.1;
      o[CH.pP] = pour; o[CH.prop] = pour;
      o[CH.aLy] = 0.25; o[CH.aLz] = 0.15;
      o[CH.lean] = 0.14; o[CH.roll] = -0.07 + S(T * 0.6) * 0.03; o[CH.twist] = S(T * 0.6) * 0.18;
      o[CH.eyeY] = -0.45; o[CH.eyeX] = -0.4;
      break;
    }
    case 'hammer': {
      // the whole body rocks: rear back and stretch, slam down and squash, a little recoil
      const ph = fract(T * 1.25);
      const up = sstep(0.05, 0.62, ph) * (1 - sstep(0.66, 0.74, ph));
      const hit = bump(ph, 0.72, 0.86), recoil = bump(ph, 0.8, 1);
      o[CH.lean] = -0.22 * up + 0.3 * hit + 0.1 * (1 - up); o[CH.sq] += up * 0.07 - hit * 0.12;
      o[CH.bob] = up * 0.03;
      o[CH.aRy] = 0.9 + up * 0.2; o[CH.aRz] = -0.35 + up * 1.35 - hit * 0.1;
      o[CH.pP] = 0.35 - up * 1.8 + recoil * 0.2; o[CH.prop] = hit;
      o[CH.aLy] = 1.05; o[CH.aLz] = -0.4; // steadying the post
      o[CH.eyeY] = -0.3 + up * 0.2;
      legs(o, -0.12 * up + hit * 0.1, -0.12 * up + hit * 0.1, 0.1 * up, 0.1 * up);
      break;
    }
    case 'saw': {
      const s = S(T * 4.6);
      o[CH.lean] = 0.25 + s * 0.06; o[CH.twist] = s * 0.12; o[CH.roll] = s * 0.03;
      o[CH.aRy] = 1.0 + s * 0.35; o[CH.aRz] = -0.3; o[CH.aRe] = 0.1 + s * 0.1;
      o[CH.pP] = 0.45; o[CH.aLy] = 0.8; o[CH.aLz] = -0.45;
      o[CH.eyeY] = -0.4; o[CH.sq] += Math.abs(s) * -0.02;
      break;
    }
    case 'carry': {
      // crate overhead on both nubs, knees (well, body) bent under the weight
      arms(o, 0.25, 1.3, 0.25, 1.3);
      o[CH.aLe] = 0.25; o[CH.aRe] = 0.25;
      o[CH.sq] = -0.06 + S(T * 2.2) * 0.012; o[CH.lean] = -0.04; o[CH.drop] = 0.12;
      o[CH.eyeY] = 0.35; o[CH.pP] = S(T * 2.2) * 0.05;
      break;
    }
    case 'bend': {
      // reach down for something (the crate at the plot, a letter from the box)
      const r = win(T * 0.5, 0.7, 0.15);
      o[CH.drop] = 0.35 + r * 0.2; o[CH.lean] = 0.45 + r * 0.1;
      arms(o, 1.1, -0.55, 1.1, -0.55);
      o[CH.aLe] = 0.15; o[CH.aRe] = 0.15; o[CH.eyeY] = -0.6;
      break;
    }
    case 'read': {
      // letter held up in front, eyes run along the lines; a little excited bounce
      o[CH.aRy] = 1.35; o[CH.aRz] = 0.55; o[CH.aRe] = 0.2; o[CH.pP] = -0.25;
      o[CH.aLy] = 0.9; o[CH.aLz] = 0.2;
      const line = fract(T * 0.55);
      o[CH.eyeX] = line < 0.85 ? -0.7 + line * 1.6 : 0.66 - (line - 0.85) * 9;
      o[CH.eyeY] = 0.25 - Math.floor(fract(T * 0.55 / 4) * 4) * 0.12;
      o[CH.bob] = Math.abs(S(T * 3.2)) * 0.012;
      o[CH.lean] = -0.05;
      break;
    }
    case 'plan': {
      // sitting on the hay bale: notebook on the left nub, scribbling with the right; every few seconds look up and think
      seated(o);
      const think = win(T * 0.11 - 0.7, 0.32, 0.07);
      o[CH.lean] = mix(0.18, -0.1, think); o[CH.roll] = mix(0.05, -0.12, think);
      o[CH.aLy] = 1.25; o[CH.aLz] = -0.1; o[CH.pP] = 0.7;
      o[CH.aRy] = mix(1.15 + S(T * 9) * 0.07, 0.9, think); o[CH.aRz] = mix(-0.15 + C(T * 11) * 0.06, 0.55 + S(T * 5) * 0.08, think);
      o[CH.eyeY] = mix(-0.55, 0.6, think); o[CH.eyeX] = mix(S(T * 2.1) * 0.3, 0.5, think);
      o[CH.prop] = 1 - think;
      legs(o, S(T * 1.4) * 0.25, S(T * 1.4 + 2) * 0.25, 0, 0);
      break;
    }
    case 'talk':
    case 'chat': {
      // bouncy gesturing; the chatter bobs on its words, a laugh now and then
      const calm = act === 'chat' ? 0.65 : 1;
      const g1 = S(T * 2.3), g2 = S(T * 1.7 + 1);
      o[CH.bob] = Math.abs(S(T * 3.4)) * 0.03 * calm; o[CH.sq] += Math.abs(S(T * 3.4)) * 0.03 * calm;
      o[CH.aRy] = (0.5 + g1 * 0.4) * calm; o[CH.aRz] = (0.15 + g2 * 0.45) * calm;
      o[CH.aLy] = (0.4 + S(T * 1.3 + 2) * 0.35) * calm; o[CH.aLz] = (0.05 + S(T * 2.1) * 0.35) * calm;
      o[CH.twist] = S(T * 0.8) * 0.12; o[CH.roll] = S(T * 1.1) * 0.05;
      o[CH.eyeX] = S(T * 0.5) * 0.3;
      if (act === 'chat') {
        const laugh = win(T * 0.18 - 0.85, 0.14, 0.03);
        o[CH.lean] = -0.18 * laugh; o[CH.bob] += Math.abs(S(T * 16)) * 0.035 * laugh; o[CH.sq] += Math.abs(S(T * 16)) * 0.04 * laugh;
      }
      break;
    }
    case 'delegate': {
      // point across the field with an extended nub, then a two-note whistle for the ducklings (stretch up)
      const wh = win(T * 0.28 - 0.65, 0.3, 0.07);
      const sweep = S(T * 0.45);
      o[CH.aRy] = mix(1.45, 0.4, wh); o[CH.aRz] = mix(0.15 + sweep * 0.05, 0.4, wh); o[CH.aRe] = mix(0.55, 0, wh);
      o[CH.aLy] = mix(0.1, 1.2, wh); o[CH.aLz] = mix(-0.25, 0.75, wh);
      o[CH.twist] = mix(sweep * 0.35, 0, wh);
      o[CH.eyeX] = mix(-0.6 + sweep * 0.3, 0, wh); o[CH.eyeY] = wh * 0.3;
      o[CH.sq] += wh * (0.07 + S(T * 14) * 0.015); o[CH.bob] = wh * 0.03;
      break;
    }
    case 'stretch': {
      // big yawn stretch: squash tall with the nubs up, hold (tremble), then melt, then shake it off
      const ph = fract(T * 0.16);
      const up = sstep(0.02, 0.28, ph) * (1 - sstep(0.52, 0.62, ph));
      const melt = sstep(0.55, 0.68, ph) * (1 - sstep(0.8, 0.95, ph));
      const trem = up * sstep(0.3, 0.4, ph) * S(T * 40) * 0.012;
      o[CH.sq] = up * 0.2 - melt * 0.14 + trem; o[CH.bob] = up * 0.05;
      o[CH.lean] = -0.15 * up + 0.25 * melt; o[CH.drop] = melt * 0.55;
      arms(o, 0.2 * up, -0.12 + up * 1.35 - melt * 0.6, 0.2 * up, -0.12 + up * 1.35 - melt * 0.6);
      o[CH.aLe] = up * 0.35; o[CH.aRe] = up * 0.35;
      o[CH.eyeY] = up * 0.4 - melt * 0.3;
      o[CH.roll] = S(T * 0.9) * 0.05 * up + S(T * 26) * 0.05 * bump(ph, 0.9, 1);
      break;
    }
    case 'sweep': {
      const s = S(T * 2.8);
      o[CH.lean] = 0.18; o[CH.twist] = s * 0.22; o[CH.roll] = s * 0.03;
      o[CH.aRy] = 0.9; o[CH.aRz] = -0.35; o[CH.pY] = s * 0.55; o[CH.pP] = 0.3; o[CH.prop] = s;
      o[CH.aLy] = 0.8; o[CH.aLz] = -0.3;
      o[CH.eyeY] = -0.5;
      break;
    }
    case 'ask': {
      // needs you: crouch (anticipation), spring up with both nubs waving, land with a squash, again
      const ph = fract(T * 1.15);
      const crouch = bump(ph, 0, 0.26), air = ph > 0.26 && ph < 0.78 ? (ph - 0.26) / 0.52 : -1;
      const land = bump(ph, 0.76, 0.96);
      o[CH.drop] = crouch * 0.4; o[CH.sq] = -crouch * 0.12 - land * 0.16;
      if (air >= 0) { o[CH.bob] = 4 * air * (1 - air) * 0.3; o[CH.sq] += (1 - air) * 0.16 * (air < 0.5 ? 1 : 0.5) - air * 0.04; }
      const w = S(T * 11);
      const up = 1.05 + (air >= 0 ? 0.3 : -0.25 * crouch);
      arms(o, 0.15 + w * 0.5, up + S(T * 11 + 1.6) * 0.25, 0.15 - w * 0.5, up - S(T * 11 + 1.6) * 0.25);
      o[CH.aLe] = 0.55; o[CH.aRe] = 0.55;
      o[CH.eyeS] = 0.3; o[CH.eyeY] = 0.3;
      o[CH.lean] = -0.1 - crouch * 0.1 + land * 0.1;
      o[CH.jig] = land;
      legs(o, air >= 0 ? S(air * PI) * 0.4 : 0);
      break;
    }
    case 'done': {
      // proud little bounces holding the full basket in front
      const b = Math.abs(S(T * 2.6));
      o[CH.bob] = b * 0.05; o[CH.sq] = (b - 0.5) * 0.06;
      arms(o, 1.05, -0.15, 1.05, -0.15);
      o[CH.lean] = -0.1; o[CH.roll] = S(T * 1.3) * 0.07;
      o[CH.eyeY] = 0.2; o[CH.jig] = 1 - b;
      break;
    }
    case 'campfire': {
      // sitting, nubs held out to the warmth, rubbing now and then, swaying
      seated(o);
      const rub = win(T * 0.13, 0.35, 0.06);
      arms(o, 1.15 + rub * S(T * 9) * 0.15, 0.05, 1.15 - rub * S(T * 9) * 0.15, 0.05);
      o[CH.aLe] = 0.1; o[CH.aRe] = 0.1;
      o[CH.lean] = 0.08; o[CH.roll] = S(T * 0.7) * 0.07; o[CH.eyeX] = S(T * 0.2) * 0.3;
      legs(o, S(T * 0.9) * 0.15, S(T * 0.9 + 1.5) * 0.15, 0, 0);
      break;
    }
    case 'fish': {
      // sitting on the dock edge, rod up, legs dangling and kicking over the water; a nibble makes it jolt
      seated(o);
      const tug = win(T * 0.12, 0.08, 0.02);
      o[CH.aRy] = 1.1; o[CH.aRz] = 0.2 + tug * 0.35; o[CH.pP] = -0.55 - tug * 0.4; o[CH.prop] = tug;
      o[CH.aLy] = 1.0; o[CH.aLz] = 0.05;
      o[CH.lean] = 0.05 - tug * 0.15; o[CH.eyeS] = tug * 0.3; o[CH.eyeY] = 0.1 - tug * 0.2;
      o[CH.roll] = S(T * 0.5) * 0.04;
      legs(o, -1.0 + S(T * 1.3) * 0.35, -1.0 + S(T * 1.3 + 2) * 0.35, -1.0, -1.0);
      break;
    }
    case 'lean': {
      o[CH.lean] = 0.22; o[CH.roll] = 0.07;
      arms(o, 1.3, -0.25, 1.3, -0.25);
      o[CH.eyeX] = wander(T * 0.3) * 0.8; o[CH.eyeY] = -0.2;
      legs(o, 0.1, -0.05, 0, 0.1);
      break;
    }
    case 'board': {
      o[CH.eyeY] = 0.6; o[CH.eyeX] = wander(T * 0.4) * 0.7;
      o[CH.aRy] = 1.0; o[CH.aRz] = 0.35 + Math.max(0, S(T * 6)) * 0.08 * win(T * 0.3, 0.3); // tapping, thinking
      o[CH.aLy] = 0.3; o[CH.aLz] = -0.3;
      o[CH.lean] = -0.1; o[CH.twist] = wander(T * 0.25) * 0.15;
      break;
    }
    case 'nap':
    case 'lie': {
      // flopped over asleep: slow breathing, nubs slack, a leg twitch in a dream
      o[CH.lie] = 1; o[CH.drop] = 1; o[CH.tuck] = 0.2;
      const br = S(T * 1.1);
      o[CH.sq] = br * 0.035; o[CH.bob] = 0;
      arms(o, act === 'lie' ? 0.2 : 0.8, act === 'lie' ? 0.9 : -0.3, 0.3, -0.5 + br * 0.04);
      const twitch = win(T / 11 + k, 0.04, 0.01);
      legs(o, twitch * S(T * 30) * 0.3, 0, 0, 0);
      o[CH.eyeY] = -0.2;
      break;
    }
    case 'pet': {
      // crouch by the animal, nub pats, happy wiggle
      o[CH.drop] = 0.4; o[CH.lean] = 0.3;
      o[CH.aRy] = 1.2; o[CH.aRz] = -0.3 + Math.max(0, S(T * 5)) * 0.25; o[CH.aRe] = 0.2;
      o[CH.aLy] = 0.3; o[CH.aLz] = -0.2;
      o[CH.roll] = S(T * 2.5) * 0.06; o[CH.eyeY] = -0.4;
      break;
    }
    case 'wave': {
      o[CH.aRz] = 1.1 + S(T * 10) * 0.35; o[CH.aRy] = 0.3 + S(T * 10 + 1.2) * 0.3; o[CH.aRe] = 0.5;
      o[CH.roll] = -0.07; o[CH.bob] = Math.abs(S(T * 5)) * 0.02; o[CH.eyeY] = 0.15;
      break;
    }
    case 'cheer': {
      // celebration hops: anticipation squash, pop up with both nubs high, land and wobble
      const ph = fract(local * 1.6);
      const crouch = bump(ph, 0, 0.22), air = ph > 0.22 && ph < 0.75 ? (ph - 0.22) / 0.53 : -1, land = bump(ph, 0.73, 0.95);
      o[CH.drop] = crouch * 0.3; o[CH.sq] = -crouch * 0.1 - land * 0.14;
      if (air >= 0) { o[CH.bob] = 4 * air * (1 - air) * 0.32; o[CH.sq] += (1 - air) * 0.14; }
      arms(o, 0.3, 1.35, 0.3, 1.35); o[CH.aLe] = 0.55; o[CH.aRe] = 0.55;
      o[CH.roll] = air >= 0 ? S(air * PI * 2) * 0.12 : 0; o[CH.jig] = land;
      o[CH.eyeY] = 0.3;
      break;
    }
    case 'scratch': {
      // struggling: nub up on top of the body scratching, tilted, eyes squeezed
      o[CH.aRz] = 1.5; o[CH.aRy] = 0.4 + S(T * 16) * 0.12; o[CH.aRe] = 0.1;
      o[CH.aLz] = -0.3; o[CH.aLy] = 0.2;
      o[CH.roll] = 0.14 + S(T * 1.3) * 0.03; o[CH.eyeX] = 0.3;
      o[CH.sq] -= 0.03;
      break;
    }
    case 'oops': {
      // startle: hop back with the nubs flung up, then shake it off (dust everywhere)
      const st = 1 - sstep(0.05, 0.5, local), sh = sstep(0.4, 0.55, local) * (1 - sstep(1.1, 1.35, local));
      o[CH.lean] = -0.3 * st; o[CH.bob] = st * 0.08 * bump(local, 0, 0.35); o[CH.sq] = st * 0.12 - sh * 0.02;
      arms(o, 0.3 * st, -0.1 + 1.2 * st, 0.3 * st, -0.1 + 1.2 * st);
      o[CH.roll] = S(local * 42) * 0.14 * sh; o[CH.twist] = S(local * 42 + 1) * 0.1 * sh;
      o[CH.eyeS] = 0.25 * st; o[CH.jig] = sh;
      break;
    }
    case 'bindle': {
      // bindle stick over the top, bundle bouncing behind
      o[CH.aRz] = 0.85; o[CH.aRy] = -0.25; o[CH.pP] = -1.05; o[CH.prop] = S(T * 3) * 0.5 + 0.5;
      o[CH.aLy] = S(T * 1.2) * 0.1; o[CH.eyeX] = wander(T * 0.3) * 0.5;
      break;
    }
    case 'sitground': {
      // sitting on the grass, leaning back on the nubs, legs kicking, looking around
      seated(o);
      o[CH.lean] = -0.18; arms(o, -0.55, -0.55, -0.55, -0.55);
      o[CH.eyeX] = wander(T * 0.3) * 0.9; o[CH.eyeY] = 0.2 + S(T * 0.23) * 0.2;
      legs(o, 0.2 + S(T * 1.1) * 0.25, 0.2 + S(T * 1.1 + 2.4) * 0.25, 0, 0);
      o[CH.roll] = S(T * 0.4) * 0.05;
      break;
    }
    case 'sit': {
      seated(o);
      o[CH.lean] = -0.04 + S(T * 0.6) * 0.03;
      arms(o, 0.3, -0.35, 0.3, -0.35);
      legs(o, -0.6 + S(T * 1.6) * 0.35, -0.6 + S(T * 1.6 + 2.2) * 0.35, -0.6, -0.6);
      o[CH.eyeX] = wander(T * 0.3) * 0.8; o[CH.eyeY] = S(T * 0.33) * 0.2;
      break;
    }
    // ---- leisure loops (idle farmers at the valley's nooks) ----
    case 'reel': {
      // a bite! lean back, rod up, the other nub cranks the reel, legs kicking with excitement
      seated(o);
      const crank = S(T * 14);
      o[CH.lean] = -0.2 + S(T * 3) * 0.04; o[CH.roll] = S(T * 5) * 0.05;
      o[CH.aRy] = 1.0; o[CH.aRz] = 0.7 + S(T * 6) * 0.08; o[CH.pP] = -0.95 + S(T * 6) * 0.08; o[CH.prop] = 0.6 + S(T * 6) * 0.3;
      o[CH.aLy] = 0.9 + crank * 0.16; o[CH.aLz] = 0.3 + C(T * 14) * 0.16;
      o[CH.eyeS] = 0.25; o[CH.eyeY] = 0.1;
      legs(o, -0.8 + S(T * 7) * 0.35, -0.8 - S(T * 7) * 0.35, -1.0, -1.0);
      break;
    }
    case 'catch': {
      // the catch held up high with a proud wiggle
      seated(o);
      const w = S(T * 4.2);
      o[CH.aRy] = 0.5; o[CH.aRz] = 1.2 + w * 0.08; o[CH.aRe] = 0.3; o[CH.pP] = -1.25; o[CH.prop] = 1;
      o[CH.aLy] = 0.4; o[CH.aLz] = 1.0 + S(T * 4.2 + 1) * 0.15; o[CH.aLe] = 0.3;
      o[CH.lean] = -0.14; o[CH.roll] = w * 0.08; o[CH.bob] = Math.abs(w) * 0.02; o[CH.sq] += Math.abs(w) * 0.03;
      o[CH.eyeY] = 0.45; o[CH.jig] = Math.abs(w);
      legs(o, -1.0 + Math.abs(S(T * 6)) * 0.4, -1.0 + Math.abs(S(T * 6 + 1.5)) * 0.4, -1.0, -1.0);
      break;
    }
    case 'toast': {
      // a marshmallow held out over the flames, turned slowly; now and then pulled back and blown on
      seated(o);
      const turn = S(T * 2.2), blow = win(T * 0.12 + k, 0.14, 0.04);
      o[CH.aRy] = 1.3; o[CH.aRz] = 0.1 + blow * 0.35; o[CH.aRe] = 0.5 - blow * 0.3; o[CH.aRx] = turn * 0.5;
      o[CH.aLy] = 0.6; o[CH.aLz] = -0.2;
      o[CH.lean] = 0.14 - blow * 0.2; o[CH.eyeY] = -0.25 + blow * 0.2; o[CH.eyeX] = turn * 0.15;
      o[CH.sq] += blow * 0.04;
      legs(o, S(T * 0.9) * 0.15, S(T * 0.9 + 1.5) * 0.15, 0, 0);
      break;
    }
    case 'sitread': {
      // seated with a book in both nubs, eyes running along the lines, a page turned now and then
      seated(o);
      const flip = win(T * 0.09, 0.1, 0.03);
      arms(o, 1.15, 0.0, 1.15 - flip * 0.35, flip * 0.55);
      o[CH.lean] = 0.12; o[CH.prop] = flip; o[CH.pP] = 0.35;
      o[CH.eyeY] = -0.45; o[CH.eyeX] = S(T * 1.6) * 0.45;
      o[CH.roll] = S(T * 0.4) * 0.04;
      legs(o, -0.3 + S(T * 1.2) * 0.2, -0.3 + S(T * 1.2 + 2) * 0.2, -0.3, -0.3);
      break;
    }
    case 'sitchat': {
      // seated chatter: smaller gestures than standing, a laugh that rocks the body back
      seated(o);
      const g1 = S(T * 2.1), g2 = S(T * 1.6 + 1), laugh = win(T * 0.16 - 0.4, 0.14, 0.03);
      o[CH.aRy] = 0.55 + g1 * 0.3; o[CH.aRz] = 0.1 + g2 * 0.35;
      o[CH.aLy] = 0.4 + S(T * 1.3 + 2) * 0.2; o[CH.aLz] = -0.1 + S(T * 2.1) * 0.2;
      o[CH.twist] = S(T * 0.7) * 0.1; o[CH.roll] = S(T * 1.1) * 0.04;
      o[CH.lean] = 0.05 - 0.2 * laugh; o[CH.sq] += Math.abs(S(T * 16)) * 0.04 * laugh;
      o[CH.eyeX] = S(T * 0.5) * 0.25;
      legs(o, -0.3 + S(T * 1.4) * 0.2, -0.3 + S(T * 1.4 + 2.2) * 0.2, -0.3, -0.3);
      break;
    }
    case 'picnic': {
      // on the blanket: reach into the spread, then nibble (chew, chew), lean back on the other nub
      seated(o);
      const ph = fract(T * 0.11 + k);
      const reach = bump(ph, 0.04, 0.22), eat = sstep(0.22, 0.32, ph) * (1 - sstep(0.8, 0.9, ph)), chew = S(T * 9) * eat;
      o[CH.lean] = 0.04 + reach * 0.3;
      o[CH.aRy] = 1.0 + reach * 0.3; o[CH.aRz] = -0.15 + eat * (0.6 + chew * 0.05) - reach * 0.2; o[CH.aRe] = reach * 0.4;
      o[CH.aLy] = -0.3; o[CH.aLz] = -0.45;
      o[CH.sq] += Math.abs(chew) * 0.025; o[CH.eyeY] = -0.35 * reach + eat * 0.1; o[CH.eyeX] = S(T * 0.3) * 0.3 * (1 - reach);
      legs(o, 0.3 + S(T * 0.8) * 0.1, 0.3 + S(T * 0.8 + 2) * 0.1, 0, 0);
      break;
    }
    case 'stargaze': {
      // leaning right back on the bench, eyes on the sky; now and then a nub points out a star
      seated(o);
      const point = win(T * 0.1 + k, 0.22, 0.05);
      o[CH.lean] = -0.14; o[CH.eyeY] = 0.9; o[CH.eyeX] = wander(T * 0.15) * 0.7;
      arms(o, -0.4, -0.45, mix(-0.4, 0.9, point), mix(-0.45, 1.2, point));
      o[CH.aRe] = point * 0.4; o[CH.twist] = wander(T * 0.12) * 0.12;
      legs(o, -0.5 + S(T * 0.8) * 0.15, -0.5 + S(T * 0.8 + 2) * 0.15, -0.5, -0.5);
      break;
    }
    case 'telescope': {
      // stooped at the eyepiece, one nub on the focus knob; every so often straighten up in wonder
      const adj = win(T * 0.17 + k, 0.25, 0.05), wow = win(T * 0.07 + k * 3, 0.1, 0.02);
      o[CH.lean] = 0.28 - wow * 0.3; o[CH.drop] = 0.08 * (1 - wow);
      o[CH.aRy] = 1.25; o[CH.aRz] = 0.35 + adj * S(T * 6) * 0.08; o[CH.aRe] = 0.2; o[CH.aRx] = adj * S(T * 3) * 0.4;
      o[CH.aLy] = 0.7 + wow * 0.4; o[CH.aLz] = -0.2 + wow * 1.1;
      o[CH.eyeX] = 0.3 * (1 - wow); o[CH.eyeY] = 0.35; o[CH.eyeS] = wow * 0.3;
      o[CH.sq] += wow * 0.05; o[CH.bob] = wow * 0.02;
      legs(o, 0.05, 0.05, -0.05, -0.05);
      break;
    }
    case 'checkers': {
      // my move: nub on the chin, eyes over the board… then reach out, hop a piece, tap, sit back
      seated(o);
      const ph = fract(T * 0.16 + k);
      const move = bump(ph, 0.42, 0.8), tap = bump(ph, 0.6, 0.68);
      o[CH.lean] = 0.18 + move * 0.15;
      o[CH.aRy] = mix(0.5, 1.35, move); o[CH.aRz] = -0.1 - tap * 0.15; o[CH.aRe] = move * 0.35;
      o[CH.aLy] = mix(1.0, 0.5, move); o[CH.aLz] = mix(0.45, -0.2, move);
      o[CH.eyeY] = -0.55; o[CH.eyeX] = mix(wander(T * 0.6) * 0.5, 0.1, move);
      o[CH.roll] = (1 - move) * S(T * 0.5) * 0.06; o[CH.sq] -= tap * 0.03;
      legs(o, -0.4 + S(T * 1.3) * 0.1, -0.4 + S(T * 1.3 + 2) * 0.1, -0.4, -0.4);
      break;
    }
    case 'ponder': {
      // the opponent's turn: watching the board, nub on the chin, a sceptical tilt
      seated(o);
      const hmm = win(T * 0.13 + k, 0.25, 0.05);
      o[CH.lean] = 0.1; o[CH.aLy] = 1.0; o[CH.aLz] = 0.5 + S(T * 3) * 0.03 * hmm; o[CH.aRy] = 0.35; o[CH.aRz] = -0.35;
      o[CH.roll] = 0.04 + hmm * 0.12; o[CH.eyeY] = -0.5; o[CH.eyeX] = wander(T * 0.4) * 0.4;
      legs(o, -0.4 + S(T * 1.7) * 0.12, -0.4 + S(T * 1.7 + 2) * 0.12, -0.4, -0.4);
      break;
    }
    case 'soak': {
      // on the rim with the feet in the warm water: propped back on the nubs, a long happy sigh, a splashy kick
      seated(o);
      const sigh = win(T * 0.09 + k, 0.2, 0.06), kick = win(T * 0.21 + k * 2, 0.12, 0.03);
      o[CH.lean] = -0.12 - sigh * 0.1; o[CH.sq] += sigh * 0.04 - 0.01; o[CH.roll] = S(T * 0.35) * 0.05;
      arms(o, -0.5, -0.5, -0.5, -0.5);
      o[CH.eyeY] = 0.2 + sigh * 0.2;
      legs(o, -1.1 + S(T * 1.1) * 0.18 + kick * S(T * 12) * 0.35, -1.1 + S(T * 1.1 + 2) * 0.18 - kick * S(T * 12) * 0.35, -1.1, -1.1);
      break;
    }
    case 'gaze': {
      // standing still to take in the view: nubs back, a slow look round, a contented little bounce
      const sw = wander(T * 0.12), hop = win(T / 11 + k, 0.06, 0.015);
      o[CH.eyeX] = sw * 0.8; o[CH.eyeY] = 0.25 + S(T * 0.17) * 0.12;
      o[CH.twist] = sw * 0.25; o[CH.lean] = -0.06; o[CH.roll] = S(T * 0.4) * 0.04;
      arms(o, -0.45, -0.3, -0.45, -0.3);
      o[CH.bob] = hop * 0.03; o[CH.sq] += hop * 0.04;
      break;
    }
  }
  if (body === 'codex') {
    // the blob sits lower on its tiny feet, so seated legs read as feet sticking out; lobes wobble with any squash
    o[CH.jig] += Math.abs(o[CH.sq]) * 1.5;
  }
  return o;
}

// ---------------------------------------------------------------------------------------------------------------------
// Gaits

export type GaitKind = 'walk' | 'jog' | 'amble';

/** Distance covered per gait cycle (m). Clawd: one cycle = two diagonal footfalls; Codex: two hops. */
export function cycleLength(body: Body, jog: number, heavy: boolean): number {
  const c = body === 'clawd' ? 0.5 + jog * 0.28 : 0.68 + jog * 0.38;
  return heavy ? c * 0.72 : c;
}

export interface GaitState {
  /** gait cycles travelled (advance by distance / cycleLength) */
  cyc: number;
  /** 0 standing … 1 moving */
  w: number;
  /** 0..1 jog blend */
  jog: number;
  /** yaw rate (rad/s), for leaning into turns */
  turn: number;
  /** ground speed (m/s) */
  speed: number;
  heavy: boolean;
  /** personality: bounce height multiplier */
  bounce: number;
}

/** Clawd stance fraction (share of a leg's cycle spent planted) and Codex contact fraction per hop. */
const STANCE = { clawd: 0.6, codex: 0.42 } as const;

/**
 * Foot placement relative to the leg's hip for leg `i` (Clawd FL FR BL BR, Codex L R): forward offset `z` (m) and
 * lift `y` (m). A planted foot moves backward at exactly the body's speed, so it stays put on the ground.
 */
export function footAt(body: Body, i: number, g: GaitState, out: { z: number; y: number }): { z: number; y: number } {
  const L = cycleLength(body, g.jog, g.heavy);
  if (g.w <= 0.001) { out.z = 0; out.y = 0; return out; }
  if (body === 'clawd') {
    const s = STANCE.clawd - g.jog * 0.1;
    const off = i === 0 || i === 3 ? 0 : 0.5; // diagonal pairs: FL+BR, FR+BL
    const p = fract(g.cyc + off);
    const R = s * L; // stance travel = body travel while planted
    const lift = (0.06 + g.jog * 0.045) * (g.heavy ? 0.6 : 1);
    if (p < s) { out.z = R * (0.5 - p / s); out.y = 0; }
    else { const q = (p - s) / (1 - s); out.z = R * (-0.5 + q * q * (3 - 2 * q)); out.y = lift * S(q * PI); }
  } else {
    // both feet share the hop; the lead foot alternates each hop (waddle)
    const hop = fract(g.cyc * 2), n = Math.floor(g.cyc * 2);
    const s = STANCE.codex - g.jog * 0.08;
    const R = s * (L / 2);
    const lead = (m: number) => (((m & 1) === 0) === (i === 0) ? 0.12 : -0.12);
    if (hop < s) { out.z = R * (0.5 - hop / s + lead(n)); out.y = 0; }
    else {
      const q = (hop - s) / (1 - s), e = q * q * (3 - 2 * q);
      out.z = R * (-0.5 + lead(n) + e * (1 + lead(n + 1) - lead(n)));
      out.y = hopHeight(g) * S(q * PI) * 0.6;
    }
  }
  out.z *= g.w; out.y *= g.w;
  return out;
}

const hopHeight = (g: GaitState) => (0.08 + g.jog * 0.08) * g.bounce * (g.heavy ? 0.5 : 1);

/**
 * Walk / jog / hop overlay on the body: bob and squash in time with the footfalls, counter-swinging nubs, leaning
 * forward with speed and into turns. `carry` keeps the nubs (holding something).
 */
export function gait(o: Pose, body: Body, g: GaitState, carry: boolean): void {
  const w = g.w;
  if (w <= 0.001) return;
  const keep = 1 - w;
  const b = g.bounce * (g.heavy ? 0.7 : 1);
  o[CH.drop] *= keep; o[CH.lie] *= keep; o[CH.tuck] *= keep;
  for (const c of [CH.l0, CH.l1, CH.l2, CH.l3]) o[c] *= keep;
  const turnLean = Math.max(-0.3, Math.min(0.3, -g.turn * g.speed * 0.05));
  if (body === 'clawd') {
    const step = fract(g.cyc * 2); // two footfalls per cycle
    const low = S(step * PI) ** 2; // 0 at footfall, 1 mid-stance
    o[CH.bob] += (low * (0.028 + g.jog * 0.05) - (g.heavy ? 0.02 : 0)) * b * w;
    o[CH.sq] += (C((step - 0.12) * TAU) * -0.045 - (g.heavy ? 0.035 : 0)) * b * w * (1 + g.jog * 0.6);
    o[CH.roll] += (S(g.cyc * TAU) * 0.045 + turnLean) * w;
    o[CH.twist] += S(g.cyc * TAU) * 0.05 * w;
    o[CH.lean] = o[CH.lean] * keep + (0.06 + g.jog * 0.16 - (g.heavy ? 0.1 : 0)) * w;
    o[CH.eyeY] = o[CH.eyeY] * keep + (g.jog * 0.2) * w;
  } else {
    const hop = fract(g.cyc * 2), s = STANCE.codex - g.jog * 0.08;
    const n = Math.floor(g.cyc * 2);
    if (hop < s) {
      const c = hop / s;
      o[CH.sq] += -S(c * PI) * (0.1 + g.jog * 0.05) * b * w;
      o[CH.jig] += S(c * PI) * 0.8 * w;
    } else {
      const a = (hop - s) / (1 - s);
      o[CH.bob] += hopHeight(g) * S(a * PI) * w;
      o[CH.sq] += (S(a * PI) * (1 - a) * 0.16 - a * a * 0.03) * b * w;
    }
    const side = (n & 1) === 0 ? 1 : -1;
    o[CH.roll] += (side * S(hop * PI) * 0.1 + turnLean) * w;
    o[CH.twist] += side * S(hop * PI) * 0.07 * w;
    o[CH.lean] = o[CH.lean] * keep + (0.05 + g.jog * 0.12) * w;
  }
  const sw = body === 'clawd' ? S(g.cyc * TAU) : S(g.cyc * TAU * 2) * 0.6;
  const arm = (0.35 + g.jog * 0.3) * w * (carry ? 0.15 : 1);
  o[CH.aLy] += sw * arm;
  o[CH.aRy] -= sw * arm;
  if (!carry) {
    const up = body === 'codex' ? Math.max(0, -Math.cos(fract(g.cyc * 2) * TAU)) * 0.35 * w : 0; // flap on take-off
    o[CH.aLz] = o[CH.aLz] * keep + (-0.05 + g.jog * 0.25 + up) * w;
    o[CH.aRz] = o[CH.aRz] * keep + (-0.05 + g.jog * 0.25 + up) * w;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Springs: every channel follows its target through a damped spring, so act changes blend with a little overshoot
// and nothing ever pops. (frequency Hz, damping ratio)

const SPRING: readonly (readonly [number, number])[] = (() => {
  const s: [number, number][] = Array.from({ length: NCH }, () => [7, 0.55]);
  const set = (chs: number[], f: number, z: number) => { for (const c of chs) s[c] = [f, z]; };
  set([CH.bob], 6, 0.42);
  set([CH.drop, CH.tuck], 4.5, 0.62);
  set([CH.lean, CH.roll], 5, 0.45);
  set([CH.twist], 4, 0.55);
  set([CH.sq], 7.5, 0.32);
  set([CH.lie], 1.6, 0.85);
  set([CH.l0, CH.l1, CH.l2, CH.l3], 9, 0.6);
  set([CH.aLy, CH.aLz, CH.aRy, CH.aRz], 7.5, 0.45);
  set([CH.aLx, CH.aRx], 7, 0.6);
  set([CH.aLe, CH.aRe], 8, 0.38);
  set([CH.eyeX, CH.eyeY], 11, 0.75);
  set([CH.eyeS], 12, 0.35);
  set([CH.pP, CH.pY], 6, 0.38);
  set([CH.prop], 20, 1);
  set([CH.jig], 3.2, 0.12);
  return s;
})();

export interface Springs { x: Pose; v: Pose; init: boolean }
export const newSprings = (): Springs => ({ x: newPose(), v: newPose(), init: false });

/** Advance every channel toward `target`; writes the result into `out` (may be `s.x`). */
export function springStep(s: Springs, target: Pose, dt: number, out: Pose): Pose {
  if (!s.init) { s.x.set(target); s.v.fill(0); s.init = true; }
  const n = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / n;
  for (let i = 0; i < NCH; i++) {
    const [f, z] = SPRING[i];
    const w0 = TAU * f;
    let x = s.x[i], v = s.v[i];
    const tx = target[i];
    // implicit Euler: unconditionally stable even for the stiff channels (w0·h > 1), so a slow frame never explodes
    const k = w0 * w0 * h, den = 1 + 2 * z * w0 * h + k * h;
    for (let j = 0; j < n; j++) {
      v = (v - k * (x - tx)) / den;
      x += v * h;
    }
    s.x[i] = x; s.v[i] = v;
    out[i] = x;
  }
  return out;
}
/** Jump straight to a pose (spawn, gallery). */
export function springSnap(s: Springs, p: Pose): void { s.x.set(p); s.v.fill(0); s.init = true; }

/** Largest per-channel jump between two poses (tests: transitions must stay continuous). */
export function poseDelta(a: Pose, b: Pose): number {
  let m = 0;
  for (let i = 0; i < NCH; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

// ---------------------------------------------------------------------------------------------------------------------
// Faces: which glyph each face slot shows. Clawd: [left eye, right eye]; Codex: [`>` eye, `_` cursor mouth].

export interface GlyphState { g: string; sx: number; sy: number; dy: number; dx: number; roll: number; on: boolean }
export const newGlyphs = (): [GlyphState, GlyphState] => [
  { g: 'bar', sx: 1, sy: 1, dy: 0, dx: 0, roll: 0, on: true }, { g: 'bar', sx: 1, sy: 1, dy: 0, dx: 0, roll: 0, on: true },
];

const setG = (s: GlyphState, g: string, sx = 1, sy = 1, dy = 0, roll = 0, dx = 0) => { s.g = g; s.sx = sx; s.sy = sy; s.dy = dy; s.roll = roll; s.dx = dx; s.on = true; };

/**
 * Resolve a face into glyphs. `blink` 0..1 closes the eyes (1 = shut); `t` drives the terminal cursor (Codex blinks
 * its `_` like a real prompt, and types while talking). dy / dx are in glyph cells.
 */
export function faceGlyphs(body: Body, face: Face, blink: number, t: number, out: [GlyphState, GlyphState]): [GlyphState, GlyphState] {
  const [a, b] = out;
  const shut = 1 - 0.9 * blink;
  if (body === 'clawd') {
    for (const [s, side] of [[a, -1], [b, 1]] as const) {
      switch (face) {
        case 'happy': case 'proud': setG(s, 'caret', 1, 1, 0.5); break;
        case 'focused': setG(s, 'bar', 1, 0.55 * shut); break;
        case 'stuck': setG(s, side < 0 ? 'chevR' : 'chevL'); break;
        case 'sleepy': setG(s, 'bar', 1, 0.42 * shut, -1.1); break;
        case 'worried': setG(s, 'bar', 1, 1.08 * shut, 0, side * 0.22); break;
        case 'yawn': setG(s, 'dash', 1.1, 1.4, -0.3, side * -0.15); break;
        case 'surprised': setG(s, 'bar', 1.3, 1.3 * shut, 0.2); break;
        case 'asleep': setG(s, 'dash', 1, 1, -1.2); break;
        case 'whistle': if (side < 0) setG(s, 'caret', 1, 1, 0.5); else setG(s, 'bar', 1, shut); break;
        case 'oops': setG(s, 'x'); break;
        case 'sparkle': setG(s, 'plus', 1.2, 1.2, 0.3); break;
        default: setG(s, 'bar', 1, shut); break;
      }
    }
    return out;
  }
  // Codex: the prompt eye
  switch (face) {
    case 'happy': case 'proud': case 'whistle': setG(a, 'hat', 1, 1, 0.3); break;
    case 'focused': setG(a, 'prompt', 1, 0.6 * shut); break;
    case 'stuck': setG(a, 'prompt', 0.9, 0.8 * shut, 0, 0.35); break;
    case 'sleepy': setG(a, 'prompt', 1, 0.4 * shut, -1); break;
    case 'worried': setG(a, 'prompt', 1, 1.1 * shut, 0, -0.2); break;
    case 'yawn': case 'asleep': setG(a, 'dash', 1, 1, -1); break;
    case 'surprised': setG(a, 'ring', 1.1, 1.1); break;
    case 'oops': setG(a, 'x'); break;
    case 'sparkle': setG(a, 'plus', 1.2, 1.2); break;
    default: setG(a, 'prompt', 1, shut); break;
  }
  // …and the cursor mouth: blinks on/off every 0.53 s like a terminal; types (block cursor hopping right) while talking
  const cursorOn = fract(t / 1.06) < 0.5;
  switch (face) {
    case 'talk': { const step = Math.floor(fract(t * 1.4) * 5); setG(b, 'cursor', 1, fract(t * 7) < 0.5 ? 2.2 : 1.6, 0.6, 0, step * 0.8 - 1.2); break; }
    case 'surprised': case 'yawn': setG(b, 'ring', face === 'yawn' ? 1.2 : 0.8, face === 'yawn' ? 1.3 : 0.8, 0.8); break;
    case 'asleep': setG(b, 'cursor', 1, 1); b.on = fract(t / 3) < 0.5; break;
    case 'oops': setG(b, 'cursor', 1, 1, 0, 0.3); break;
    case 'happy': case 'proud': case 'sparkle': setG(b, 'cursor', 1, 1); break;
    default: setG(b, 'cursor', 1, 1); b.on = cursorOn; break;
  }
  return out;
}
