/**
 * Animator (DESIGN §6.3, ART §6): locomotion → action → reaction → additive (breath, springs, look-at, blink) per rig.
 * Writes rig node transforms; charBatch reads them. Deterministic per seedKey (personality), staggered phases.
 * Owner: CHR.
 */
import * as THREE from 'three';
import { CH, createPose, resetPose, copyPose, blendInto, ARM_REST } from './pose.ts';
import { Spring1D, SPRING, Jiggle } from './springs.ts';
import { noise1 } from './noise.ts';
import { locomotion, strideHz } from './locomotion.ts';
import { activity, type Activity, type ActivityArgs } from './activities/index.ts';
import { SEAT_OFF } from './activities/common.ts';
import { seatProfile, type SeatProfile, type SeatSlot } from './seat.ts';
import { reaction, REACTIONS, type Reaction } from './reactions.ts';
import { expressionOf, hasExpression, kindEye, blinkAt, BLINK_DUR } from './face.ts';
import { UPPER_L, FORE_L, FORE_SEGS, type ClawdRig, type Rig } from '../rig/clawd.ts';
import type { ShellyRig } from '../rig/shelly.ts';
import { nodeData } from '../rig/build.ts';
import type { EyeShapes, MouthRig } from '../rig/face.ts';
import type { Dyn } from '../rig/accessories.ts';
import type { Prop } from '../rig/props.ts';
/** Share of the noodle curl per forearm joint (shoulder → hand): the tip bends most, like a whip. */
const CURL_W = [0.16, 0.22, 0.28, 0.34];
/** Near-card distance (fx/rules PLACARD_NEAR_M) and where the full-stretch "hey!" is back (m). */
const NEAR_M = 3.5, NEAR_FAR = 5;
/**
 * [CHR fix m3-r1] Close-up (playtest: at the serve counter and desk walk-ups the "hey!" noodle ran out of the top of the
 * frame as a 1 m orange pole over the Big Board): with the camera inside CLOSE_M m (a.close 1 → 0 at CLOSE_FAR) the
 * blocked wave switches to a hop-and-wave with short arms, and no noodle reaches past CLOSE_REACH m from its shoulder.
 */
export const CLOSE_M = 2.6, CLOSE_FAR = 3.4, CLOSE_REACH = 0.85;
const CLOSE_LN = (CLOSE_REACH - UPPER_L) / FORE_L;
import { EYE_X, EYE_Y, FACE_Z } from '../rig/face.ts';
import { createShellyAnimator } from './shellyAnimator.ts';
import { createMinis } from './minis.ts';
import { TIER_EMBLEM } from '../rig/gear.ts';
import { mulberry32, hash32 } from '../../../../shared/identity.ts';
import { VIEWER, viewerRel, claimSwivel, swivelId, swivelScore } from './viewer.ts';
import { VOCAB } from './activities/index.ts';

/**
 * [CHR M3.5] Walk-up face turn: a seated agent doing desk work turns its body (Clawd's head is its body) up to
 * FACE_TURN toward a player standing within FACE_TURN_NEAR m in front / to the side, so the face reads from the 3/4
 * front stand spot UI.goto() uses. Full turn inside FACE_TURN_FULL m; nothing when the player is behind (> 140°, that is
 * BRN's glanceBack) or while a reaction plays.
 */
export const FACE_TURN = 0.44, FACE_TURN_NEAR = 2.0, FACE_TURN_FULL = 1.5, FACE_TURN_BEHIND = 2.45;
const DESK_WORK = new Set(VOCAB.desk);
/** [CHR carryover m3] awake idle / done sitting at its own desk (waiting for sign-off, between tasks): the walk-up
 * swivel + face turn apply too (a lounging done agent's mouth sat behind the monitor on a G high-five walk-up) */
const DESK_IDLE = new Set(['lounge', 'sitIdle']);
/**
 * [CHR fix m3-r3] Walk-up swivel-out (reviewer art + fun: a 0.44 rad head turn left the face behind the monitor in 5 of 7
 * desk walk-ups). The seated desk worker the player walks up to (inside SWIVEL_IN m, not behind; the nearest one: the
 * claim in viewer.ts) swivels its chair toward the player's side, rolls back SWIVEL_BACK m and out sideways (more when
 * the player stands straight across the desk, where the monitor is squarely in the way), and leans toward the player,
 * so the whole face clears the monitor and its own screen shows behind its shoulder. A player to the side (|rel| ≥
 * SWIVEL_SIDE_FULL) gets at least SWIVEL_MIN (70°) of swivel, never more than SWIVEL_PAST past them (the eyes take the
 * rest); straight ahead it rolls out, peeks round the monitor and perks up tall (SWIVEL_PERK) to clear its top. It swivels back once the player is beyond
 * SWIVEL_OUT m. Typing hands come off the keys to the lap (a friendly hand pops up as it arrives); desk props (grep
 * tome, card box, stamp pad, laptop) stay on the desk; held props (book, clipboard, phone, pack) come along.
 */
export const SWIVEL_IN = 2.5, SWIVEL_OUT = 3.1, SWIVEL_BACK = 0.25, SWIVEL_LAT = 0.34, SWIVEL_LAT_SIDE = 0.1;
export const SWIVEL_MIN = 1.22, SWIVEL_MAX = 1.62, SWIVEL_PAST = 0.6, SWIVEL_SIDE_FULL = 0.7, SWIVEL_LEAN = 0.12, SWIVEL_PERK = 0.12;
const DESK_PROPS = new Set(['grep', 'cards', 'stamp', 'laptop', 'pack']);
const HELD_PROPS = new Set(['book', 'clipboard', 'phone', 'note']);
const PENCIL_EAR = [0.3, 0.5, 0.02, 0, 0, 0.9];
/** [CHR M3.5] Dash (§11.5): motor speed above DASH_IN m/s switches the gait to 'dash' (out below DASH_OUT). */
export const DASH_IN = 3.0, DASH_OUT = 2.6;

/** The Entity fields the character wears (DESIGN §6.7); any missing field = none. */
export interface Traits {
  /** backpack 50k/100k/150k, sweat ≥ 180k */
  contextTokens?: number | null;
  /** lanyard emblem */
  modelTier?: string | null;
  /** mini-Clawds (max 4): the subagent records (a record with `active: false` does not count) or a plain count */
  subagents?: readonly ({ active?: boolean } | null | undefined)[] | number;
  /** tufts (1) + eye-bags + paper-ball orbit (≥ 2) */
  struggle?: { level: number } | null;
}

/** A point the character can look at. */
export interface LookTarget { x: number; y: number; z: number }

/** The seat under a seated actor: its tag and yaw. */
export interface AnimSeat extends SeatSlot { yaw?: number }

export interface AnimDebug {
  action: string | null;
  face: string | null;
  reactions: string[];
  speed: number;
  /** Clawd only: the walk-up swivel weight */
  swivel?: number;
}

/** Common animator API (Clawd and Shelly); the Clawd-only extras are optional here. */
export interface Animator {
  /** from the motor: current speed (m/s) */
  setLocomotion(speed: number): void;
  /** brain gait override (Clawd), null = the personality's walk */
  setGait(style: string | null): void;
  /** blend 0.25 s */
  setAction(activityId: string | null): void;
  /** one-shot, preempts ≤ 2.5 s */
  react(reactionId: string, o?: { variant?: number }): void;
  setFace(expression: string | null): void;
  lookAt(target: LookTarget | null): void;
  setEnergy(k: number): void;
  /** writes rig node transforms; `lod` ≥ 1 re-poses at 20 Hz */
  update(dt: number, lod?: number): void;
  /** data-driven gear (§6.7): cheap, call every frame with the entity */
  setTraits(e: Traits | null): void;
  readonly traits: object;
  debug: AnimDebug;
  setSync?(u: number | null): void;
  setSeat?(slot: AnimSeat | null): void;
  setViewDist?(d: number | null): void;
  readonly reacting?: string | null;
  readonly steps?: number;
  readonly dashing?: boolean;
}

/** Gear state the Clawd animator derives from `Traits`. */
export interface GearTraits { pack: number; tier: string | null; minis: number; struggle: number; sweat: boolean }

export interface ClawdAnimator extends Animator {
  setSync(u: number | null): void;
  setSeat(slot: AnimSeat | null): void;
  /** viewer distance (m, horizontal; actors pass the camera's) */
  setViewDist(d: number | null): void;
  readonly traits: GearTraits;
  readonly reacting: string | null;
  /** foot-contact counter (bumps once per footfall while walking) */
  readonly steps: number;
  readonly dashing: boolean;
  debug: AnimDebug & { swivel: number };
}

export interface AnimatorOptions {
  seedKey?: string;
  /** world floor height (mini-Clawds) */
  ground?: (x: number, z: number) => number;
}

/** A running activity layer (`sampled`: the layer has been evaluated at least once, for the key-pose holds). */
export interface Layer { def: Activity; t: number; w: number; id: string; sampled?: boolean }
export interface Playing { def: Reaction; t: number; variant: number; sampled?: boolean }

/** Stop-motion accents and big squash are disabled under reduced motion (DESIGN §6.3). */
export const MOTION = { reduced: typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)').matches : false };
export function setReducedMotion(b: boolean): void { MOTION.reduced = !!b; }

/** Is local time t inside a `twos` spec (true | [[t0, t1], …])? */
const inTwos = (spec: boolean | number[][] | undefined, t: number): boolean => {
  if (spec === true) return true;
  if (!Array.isArray(spec)) return false;
  for (let i = 0; i < spec.length; i++) if (t >= spec[i][0] && t < spec[i][1]) return true; // [CHR m2 r2 alloc] no closure
  return false;
};
const MOUTH_KEYS = ['smile', 'o', 'snore', 'grin', 'wobbleA', 'wobbleB'] as const;
const PACK_K = [0, 0.62, 0.9, 1.18];

const TAU = Math.PI * 2;
/** [CHR fix r3] §5.3 LOD row: agents at lod ≥ 1 re-pose at 20 Hz (shellyAnimator.ts mirrors it). */
export const LOD_STEP = 1 / 20;
const BLEND = 0.25;
const SIT_TRANS = 0.5;
/** [CHR fix m175-r2] seatGuard(): max body turn off a fixed backed seat (rad; root swivel + hip twist, soft clamp). */
export const BODY_TURN = 0.34;
/**
 * [CHR fix m3-r1] seatPin(): a seated body turned off its desk (walk-up face turn, glance / pat / look-back layers) keeps
 * its pelvis on the seat: tilt ≤ SEAT_TILT (a desk lean in the turned frame tipped it off the chair), hips on the seat
 * anchor, and the viewer-aimed glances turn the body ≤ SEAT_TWIST (the eyes take the rest) so the legs stay in the chair.
 */
export const SEAT_TILT = 0.1, SEAT_TWIST = 1.2;
const GLANCE_REACT = new Set(['glanceBack', 'lookBackWave', 'summonBusy', 'patted', 'summoned']);
const ARM_CH = [[CH.aLp, CH.aLr, CH.aLb], [CH.aRp, CH.aRr, CH.aRb]];

export function createAnimator(rig: ClawdRig, o?: AnimatorOptions): ClawdAnimator;
export function createAnimator(rig: ShellyRig, o?: AnimatorOptions): Animator;
export function createAnimator(rig: Rig, o?: AnimatorOptions): Animator;
export function createAnimator(rig: Rig, o: AnimatorOptions = {}): Animator {
  if (rig.species === 'shelly') return createShellyAnimator(rig, o);
  return createClawdAnimator(rig, o);
}

function createClawdAnimator(rig: ClawdRig, o: AnimatorOptions): ClawdAnimator {
  const pers = rig.pers;
  const rnd = mulberry32(hash32(`${o.seedKey ?? ''}|anim`) ^ pers.seed);
  const seed = pers.seed;
  const lodPhase = ((seed >>> 0) % 997) / 997; // [CHR fix r3] 20 Hz LOD cadence stagger
  // [CHR m2 r2 alloc] Per-frame float state lives in one object with fixed double fields (S.*): a closure `let`
  // holding a double re-boxes a HeapNumber on every store (~16 B × ~20 stores × 40 actors per frame).
  const S = { lodAcc: LOD_STEP * lodPhase, t: pers.phase * 37, energy: pers.energy, userEnergy: 1, speedCmd: 0, speed: 0, gaitPhase: pers.phase, prevYaw: 0, yawRate: 0, seatT: 99, seatYaw: 0, blinkStart: -1, nextBlink: 0, saccX: 0, saccY: 0, nextSacc: 0, prevHipY: 0, prevHipV: 0,
    dt: 0, lod: 0, tempo: 1, accFwd: 0, accLat: 0, seatLevel: 0, blink: 0, skid: 0, prevStep: 0, dashing: 0 };
  const debug: ClawdAnimator['debug'] = { action: null, face: null, reactions: [], speed: 0, swivel: 0 };

  const L = createPose(), A = createPose(), Pp = createPose(), R = createPose(), out = createPose();
  // (S.t: stagger, no two agents in phase)
  // (S.energy / S.userEnergy)
  // locomotion
  // locomotion: S.speedCmd, S.speed, S.gaitPhase
  let gaitOverride: 'skip' | 'trot' | 'waddle' | 'dash' | null = null; // [BRN fix r3] setGait()
  const prevPos = new THREE.Vector3(), vel = new THREE.Vector3(), acc = new THREE.Vector3();
  let havePrev = false;
  const speedS = new Spring1D(SPRING.snappy);
  // action layers
  let cur: Layer | null = null;
  let prev: Layer | null = null;
  let seatTarget = 0, seatDir = 0;
  /** [CHR fix m175-r2] the seat under a seated actor: its yaw + profile (seat.ts), null = a free / swivel seat */
  let seatProf: SeatProfile | null = null, seatSlot: AnimSeat | null = null;
  // reaction
  let react: Playing | null = null;
  // face
  let baseFace: string | null = null;
  const fs = {
    eyeS: new Spring1D(SPRING.bouncy, 1), eyeSY: new Spring1D(SPRING.snappy, 1), lid: new Spring1D(SPRING.snappy),
    browA: new Spring1D(SPRING.snappy), browOn: new Spring1D(SPRING.snappy), blush: new Spring1D(SPRING.floaty),
    lookX: new Spring1D({ f: 9, z: 0.7 }), lookY: new Spring1D({ f: 9, z: 0.7 }), mouthS: new Spring1D(SPRING.bouncy, 1),
  };
  let eyeShown = 'slot', mouthShown: string | null = null;
  S.nextBlink = S.t + 1 + rnd() * 3; let doubleBlink = false;
  S.nextSacc = S.t + rnd();
  let lookTarget: THREE.Vector3 | null = null;
  // springs (additive)
  const leanP = new Spring1D(SPRING.bouncy), leanR = new Spring1D(SPRING.bouncy), twistS = new Spring1D(SPRING.bouncy);
  const sqS = new Spring1D({ f: 4.5 * pers.bounciness, z: 0.25 }), armFlap = new Spring1D(SPRING.bouncy);
  // [CHR fix m15-r2] noodle lag: each forearm's tip trails its arm's raise (underdamped: overshoot on each wave)
  const armLag = [new Spring1D({ f: 3.2, z: 0.32 }, ARM_REST), new Spring1D({ f: 3.2, z: 0.32 }, ARM_REST)];
  // S.prevHipY, S.prevHipV
  // accessory dynamics
  const accPrev = new THREE.Vector3(), accVel = new THREE.Vector3(), accAcc = new THREE.Vector3();
  let accHave = false;
  const dynJiggle = new Map<Dyn, Jiggle>();
  const dynChain = new Map<Dyn, Jiggle[]>();
  const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpV2 = new THREE.Vector3();
  const nodes = rig.nodes;
  const face = rig.face;
  const act: Required<ActivityArgs> = { amp: 1, seed, energy: S.energy, dt: 0, variant: 0, crown: 0.545, seated: false, near: 0, close: 0, sync: null, viewRel: 0, viewD: 99, swivel: 0 };
  const vrel = { d: 99, rel: 0 };
  const faceTurn = new Spring1D({ f: 2.2, z: 0.8 });
  // [CHR fix m3-r3] walk-up swivel-out: weight (slight overshoot on the roll-out), tracked twist, claim id
  const swW = new Spring1D({ f: 1.5, z: 0.62 }), swTw = new Spring1D({ f: 1.8, z: 0.75 });
  const swId = swivelId();
  const SW = { on: 0, side: 1, dx: 0, dz: 0, tw: 0, t: 0 };
  // desk props under the swivel: body transform before / after it (swivelOut → keepOnDesk), preallocated
  const B0 = new Float32Array(8), B1 = new Float32Array(8), swM0 = new THREE.Matrix4(), swM1 = new THREE.Matrix4(), swE = new THREE.Euler(0, 0, 0, 'YXZ');
  const swQ0 = new THREE.Quaternion(), swQ1 = new THREE.Quaternion(), swP = new THREE.Vector3(), swS = new THREE.Vector3();
  const BODY_CH = [CH.hipX, CH.hipY, CH.hipZ, CH.pitch, CH.twist, CH.roll, CH.sq, CH.grow];
  let steps = 0;
  // gear + minis (§6.7)
  const traits: GearTraits = { pack: 0, tier: null, minis: 0, struggle: 0, sweat: false };
  const minis = rig.minis?.length ? createMinis(rig, seed, o.ground ?? null) : null;
  const packJ = new Jiggle(SPRING.bouncy, 0.035), badgeJ = new Jiggle(SPRING.bouncy, 0.06);
  let frameN = 0, lastProp: string | null | undefined = undefined;
  // [CHR m2 r2 alloc] reused per-frame argument objects (fixed shapes)
  const locoArgs = { speed: 0.5, phase: 0.5, style: 'waddle', energy: 0.5, t: 0.5, seed, amp: 0.5 };
  const miniArgs = { count: 0, moving: false, seated: false, t: 0.5, reduced: false };

  const startAction = (id: string | null) => {
    const def = activity(id);
    if ((cur?.id ?? null) === (id ?? null)) return;
    if (cur) prev = { ...cur, w: 1 };
    cur = id && def && def.mask ? { def, t: 0, w: 0, id } : null;
    const wantSeat = def?.sit ? 1 : 0;
    if (wantSeat !== seatTarget) { seatTarget = wantSeat; S.seatT = 0; seatDir = wantSeat ? 1 : -1; }
    debug.action = id;
  };

  const api: ClawdAnimator = {
    debug,
    setLocomotion(s) { S.speedCmd = Math.max(0, s || 0); debug.speed = S.speedCmd; },
    // [BRN fix r3] brain gait override (done → Pit: a happy skip for every personality); null = the personality's walk
    setGait(style) { gaitOverride = style === 'skip' || style === 'trot' || style === 'waddle' || style === 'dash' ? style : null; },
    setAction(id) { startAction(id ?? null); },
    react(id, ro = {}) {
      const def = reaction(id);
      debug.reactions.push(id); if (debug.reactions.length > 8) debug.reactions.shift();
      if (!def) return;
      const variant = ro.variant ?? (def.variants ? Math.floor(rnd() * def.variants) : 0);
      react = { def, t: 0, variant };
    },
    setFace(expr) { baseFace = expr && hasExpression(expr) ? expr : null; debug.face = baseFace; },
    /**
     * [BRN cross-owner, social.ts ping-pong rally] An external phase (0..1) for activities that keep time with another
     * actor (`pingpong` swings on the rally's shared clock); null = the activity's own clock.
     */
    setSync(u) { act.sync = u; },
    /**
     * [CHR fix m175-r2] The slot the actor sits on (or null). Fixed seats with a backrest (seat.ts: the Pit lounger)
     * cap the body's turn (root swivel + hip twist) and keep seated limbs on the near side of the backrest.
     */
    setSeat(slot) {
      if (slot === seatSlot) return;
      seatSlot = slot ?? null; seatProf = seatProfile(slot); S.seatYaw = slot?.yaw ?? 0;
    },
    lookAt(target) { lookTarget = target ? new THREE.Vector3(target.x, target.y, target.z) : null; },
    setEnergy(k) { S.userEnergy = k; },
    /**
     * [CHR fix m15-r2] Viewer distance (m, horizontal; actors pass the camera's). Inside the 3.5 m near-card distance
     * the big "hey!" noodles cap their stretch so both hands stay in a close hero frame (a.near 1 ≤ 3.5 m → 0 at 5 m).
     */
    setViewDist(d) {
      act.near = d == null ? 0 : Math.min(1, Math.max(0, (NEAR_FAR - d) / (NEAR_FAR - NEAR_M)));
      act.close = d == null ? 0 : Math.min(1, Math.max(0, (CLOSE_FAR - d) / (CLOSE_FAR - CLOSE_M))); // [CHR fix m3-r1]
    },
    setTraits(e) {
      const ctx = e?.contextTokens ?? 0;
      traits.pack = ctx >= 150_000 ? 3 : ctx >= 100_000 ? 2 : ctx >= 50_000 ? 1 : 0;
      traits.sweat = ctx >= 180_000;
      traits.tier = e?.modelTier ?? null;
      const sa = e?.subagents;
      let n = 0;
      if (Array.isArray(sa)) { for (let i = 0; i < sa.length; i++) { const x = sa[i]; if (!x || x.active !== false) n++; } } else n = Number(sa) || 0;
      traits.minis = Math.min(4, n); // active subagents only (§6.7)
      traits.struggle = e?.struggle?.level ?? 0;
    },
    /** Current gear state (sheet / debug). */
    get traits() { return { ...traits }; },
    /** Seconds into the current reaction (sheet/debug). */
    get reacting() { return react ? react.def.id : null; },
    /**
     * [CHR M3.5] Foot-contact counter (bumps once per footfall while walking): BRN/FX puff dust per dash step by
     * comparing it with the last value they saw. `dashing` is true while the dash gait plays.
     */
    get steps() { return steps; },
    get dashing() { return S.dashing > 0; },
    update(dtIn, lod = 0) {
      // [CHR fix r3] §5.3 LOD row: lod ≥ 1 (≥ 10 m, or off-screen) re-poses at 20 Hz on its accumulated dt, phases
      // staggered by the seed so a crowd never re-poses on one frame. `rig.poseSerial` tells charBatch when a pose is
      // new; between steps it reuses the last instance data (root motion is still applied every frame there).
      // Mini-Clawds walk the real floor on their own (pit edges, stairs): an agent with subagents keeps full rate.
      if (lod >= 1 && !traits.minis) {
        S.lodAcc += Math.max(dtIn, 0);
        if (S.lodAcc < LOD_STEP - 1e-6 && (rig.poseSerial ?? 0) > 0) return;
        dtIn = S.lodAcc; S.lodAcc = 0;
      } else S.lodAcc = LOD_STEP * lodPhase;
      rig.poseSerial = ((rig.poseSerial ?? 0) | 0) + 1;
      S.dt = Math.min(Math.max(dtIn, 0), 0.1);
      S.lod = lod;
      // [CHR m2 r2 alloc] The step is split into small closures that pass no doubles (state lives in S): one huge
      // function ran out of TurboFan's inlining budget, so every Vector3.set / Euler setter / spring call in its tail
      // was a real call that boxed each double argument and result (~1 HeapNumber per call, ≈ 10 KB/frame at 40).
      stepMotion();
      stepLayers();
      stepAdditive();
      stepFace();
      writeBody();
      writeArms();
      writeLegs();
      writeFace();
      writeProps();
      rig.smear = MOTION.reduced ? 0 : (react?.def.smear || cur?.def.smear || S.dashing > 0) ? 1 : 0;
      writeCrate();
      if (lod < 1) measureBodyAcc();
      writeGear();
      if (lod < 1) writeDyn();
      debug.speed = S.speed;
    },
  };

  /** Root motion: the motor moves root; we only read it (velocity, acceleration, yaw rate, speed). */
  function stepMotion() {
    const dt = S.dt;
    S.energy = pers.energy * S.userEnergy;
    S.tempo = pers.tempo * (0.75 + 0.25 * S.energy);
    S.t += dt;
    act.amp = 0.7 + 0.3 * S.energy; act.energy = S.energy; act.dt = dt;
    act.crown = rig.crown ?? 0.545; act.seated = seatTarget > 0; // [CHR fix m15-r1] head-clearing poses, seated reactions
    const root = rig.root;
    if (havePrev && dt > 0) {
      const d = root.position.distanceTo(prevPos);
      if (d > 1) { vel.set(0, 0, 0); acc.set(0, 0, 0); } // teleport
      else {
        tmpV.subVectors(root.position, prevPos).divideScalar(dt);
        tmpV2.subVectors(tmpV, vel).divideScalar(dt);
        acc.lerp(tmpV2, Math.min(1, dt * 12));
        vel.copy(tmpV);
      }
      let dy = root.rotation.y - S.prevYaw;
      dy = ((dy + Math.PI) % TAU + TAU) % TAU - Math.PI;
      S.yawRate += (dy / dt - S.yawRate) * Math.min(1, dt * 10);
    }
    prevPos.copy(root.position); S.prevYaw = root.rotation.y; havePrev = true;
    const measured = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    speedS.step(dt, Math.max(measured, S.speedCmd));
    S.speed = speedS.x;
    if (S.speed < 0) S.speed = 0;
    const yaw = root.rotation.y;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    S.accFwd = acc.x * sy + acc.z * cy; // model faces +z rotated by yaw
    S.accLat = acc.x * cy - acc.z * sy;
    // [CHR M3.5] the viewer (player camera) in this rig's frame: distance + the body yaw that would face it
    if (VIEWER.on) { viewerRel(root.position.x, root.position.z, yaw, vrel); act.viewD = vrel.d; act.viewRel = vrel.rel; }
    else { act.viewD = 99; act.viewRel = 0; }
  }

  /** Locomotion → action (with the previous one blending out) → reaction → seat. */
  function stepLayers() {
    const dt = S.dt, tempo = S.tempo;
    resetPose(L);
    // [CHR M3.5] dash: any motor speed over DASH_IN (the work-call sprint) whatever the brain's gait
    S.dashing = gaitOverride === 'dash' || S.speed > (S.dashing > 0 ? DASH_OUT : DASH_IN) ? 1 : 0;
    const style = S.dashing > 0 ? 'dash' : gaitOverride ?? (pers.walkStyle === 'skip' && !(baseFace === 'happy' || baseFace === 'celebrate') ? 'trot' : pers.walkStyle);
    S.gaitPhase += dt * strideHz(S.speed, style, S.energy);
    // footfalls: two per stride (the gait's diagonal pairs land at phase 0 and ½)
    const stepN = Math.floor(S.gaitPhase * 2);
    if (stepN !== S.prevStep) { if (S.speed > 0.35 && !seatTarget) steps++; S.prevStep = stepN; }
    locoArgs.speed = seatTarget ? 0 : S.speed; locoArgs.phase = S.gaitPhase; locoArgs.style = style; locoArgs.energy = S.energy; locoArgs.t = S.t * tempo; locoArgs.amp = act.amp;
    locomotion(L, locoArgs);
    copyPose(out, L);

    if (prev) {
      prev.t += dt * tempo;
      resetPose(Pp); prev.def.update(prev.t, Pp, act);
      prev.w -= dt / BLEND;
      if (prev.w <= 0 || (cur && cur.w >= 1)) prev = null;
      else blendInto(out, Pp, cur ? 1 : Math.max(0, prev.w), prev.def.mask);
    }
    frameN++;
    const onTwos = !MOTION.reduced && (frameN & 1) === 1;
    if (cur) {
      cur.t += dt * tempo;
      cur.w = Math.min(1, cur.w + dt / BLEND);
      // Stop-motion: key poses held on twos (the layer is re-sampled every other frame inside its windows).
      if (!(onTwos && cur.def.twos && inTwos(cur.def.twos, cur.t) && cur.sampled)) { resetPose(A); cur.def.update(cur.t, A, act); cur.sampled = true; }
      let w = cur.w;
      if (seatDir > 0 && S.seatT < SIT_TRANS) w = Math.min(w, seatW(S.seatT / SIT_TRANS));
      blendInto(out, A, w, cur.def.mask);
      // [CHR fix m15-r1] One visual, one meaning: an activity that declares `clearProps` (blocked) drops the working
      // props at once instead of letting them linger through the blend.
      if (cur.def.clearProps) out.prop = null;
    }
    if (react) {
      react.t += dt * (0.85 + 0.15 * S.energy);
      act.variant = react.variant;
      if (!(onTwos && react.def.twos && inTwos(react.def.twos, react.t) && react.sampled)) { resetPose(R); react.def.update(react.t, R, act); react.sampled = true; }
      const d = react.def.dur;
      const w = Math.min(1, react.t / 0.1) * Math.min(1, Math.max(0, (d - react.t) / 0.3));
      if (w > 0) blendInto(out, R, w, react.def.mask);
      if (react.t >= d) {
        const nx = react.def.next ? reaction(react.def.next) : null; // [CHR M3.5] chained follow-up (catchPlane → readNote)
        react = nx ? { def: nx, t: Math.max(0, react.t - d), variant: 0, sampled: false } : null;
        if (nx) { debug.reactions.push(nx.id); if (debug.reactions.length > 8) debug.reactions.shift(); }
      }
    }
    // Seat: the body rides SEAT_OFF above standing; transitions hop onto / off the chair (anticipation crouch →
    // arc → splat), and everything above (activities, reactions) is relative to it.
    let seatLevel = seatTarget;
    if (S.seatT < SIT_TRANS) {
      S.seatT += dt;
      const u = Math.min(1, S.seatT / SIT_TRANS);
      seatLevel = seatDir > 0 ? seatW(u) : 1 - seatW(u);
      out.f[CH.hipY] += seatHop(u) * (seatDir > 0 ? 1 : 0.6);
      out.f[CH.sq] += seatSquash(u);
    }
    out.f[CH.hipY] += SEAT_OFF * seatLevel;
    S.seatLevel = seatLevel;
  }

  /** Additive: breath, sway, lean / twist springs, vertical follow-through, seat guard. */
  function stepAdditive() {
    const dt = S.dt, f = out.f;
    const still = 1 - Math.min(1, S.speed / 0.4);
    f[CH.sq] += 0.018 * Math.sin(TAU * 0.3 * S.t + seed) * act.amp;
    f[CH.roll] += 0.018 * noise1(S.t * 0.35, seed + 21) * still;
    f[CH.pitch] += 0.014 * noise1(S.t * 0.3, seed + 31) * still;
    // Lean lags acceleration (start: rock back; stop: skid forward) and overshoots on settle.
    leanP.step(dt, Math.max(-0.35, Math.min(0.35, -S.accFwd * 0.045))); f[CH.pitch] += leanP.x;
    leanR.step(dt, Math.max(-0.3, Math.min(0.3, S.yawRate * S.speed * 0.07 + S.accLat * 0.03))); f[CH.roll] += leanR.x;
    twistS.step(dt, Math.max(-0.5, Math.min(0.5, -S.yawRate * 0.08))); f[CH.twist] += twistS.x;
    // Vertical follow-through: hip acceleration kicks a squash spring and flaps the arms.
    const hy = f[CH.hipY];
    const hv = dt > 0 ? (hy - S.prevHipY) / dt : 0;
    const ha = dt > 0 ? (hv - S.prevHipV) / dt : 0;
    S.prevHipY = hy; S.prevHipV = hv;
    if (dt > 0 && Math.abs(ha) < 400) { sqS.v += -ha * 0.0009 * pers.bounciness; armFlap.v += -ha * 0.0035; }
    sqS.step(dt, 0); f[CH.sq] += sqS.x;
    armFlap.step(dt, 0);
    const flap = armFlap.x;
    f[CH.aLr] += flap; f[CH.aRr] += flap;
    f[CH.aLp] += -S.accFwd * 0.02; f[CH.aRp] += -S.accFwd * 0.02;
    stepWalkUp(f, dt);
    if (seatProf && S.seatLevel > 0) seatGuard(f, S.seatLevel);
    if (seatTarget && S.seatLevel > 0) seatPin(f, S.seatLevel);
    if (swW.x > 0.002 || swW.x < -0.002) swivelOut(f);
  }

  /**
   * [CHR fix m3-r3] Applies the walk-up swivel-out (see SWIVEL_IN) after seatPin: the pin keeps a turned body's hips on
   * the seat anchor, and the roll-out deliberately moves that anchor (the chair rolls back and out).
   */
  function swivelOut(f: Float32Array) {
    const w = Math.max(0, Math.min(1.15, swW.x)), wa = Math.min(1, w);
    for (let i = 0; i < 8; i++) B0[i] = f[BODY_CH[i]];
    const tw0 = f[CH.twist], tw = swTw.x > SWIVEL_MAX ? SWIVEL_MAX : swTw.x < -SWIVEL_MAX ? -SWIVEL_MAX : swTw.x;
    // the larger of the two turns (a pat / summon aimed at the same player), never both
    const twNew = react && Math.abs(tw0) > Math.abs(tw) * wa ? tw0 : tw0 + (tw - tw0) * wa;
    f[CH.twist] = twNew;
    f[CH.hipX] += SW.dx * w; f[CH.hipZ] += SW.dz * w;
    // lean toward the player: forward in the swivelled frame, plus a sideways peek when it only rolled out
    const peek = 1 - Math.min(1, Math.abs(tw) / SWIVEL_MIN);
    f[CH.pitch] += (SWIVEL_LEAN * (1 - peek) - f[CH.pitch]) * wa;
    f[CH.roll] += (SW.side * SWIVEL_LEAN * 1.4 * peek - f[CH.roll]) * wa;
    // straight across the desk it also perks up tall on the seat, chin over the monitor line (whichever side the
    // monitor is offset to: the animator does not know the desk)
    f[CH.hipY] += SWIVEL_PERK * wa * peek; f[CH.sq] += 0.07 * wa * peek;
    // eyes on the player (whatever the activity was looking at)
    const lx = Math.max(-1, Math.min(1, (act.viewRel - twNew) * 0.9));
    f[CH.lookX] += (lx - f[CH.lookX]) * wa; f[CH.lookY] += (0.12 - f[CH.lookY]) * wa;
    const pid = out.prop;
    if (!pid || !HELD_PROPS.has(pid)) {
      // hands off the keys: blend the arms to a relaxed lap rest, the player-side mitten pops up in a little "hi"
      const hi = SW.t < 1.4 ? Math.sin(Math.min(1, SW.t / 1.4) * Math.PI) : 0;
      for (let ai = 0; ai < 2; ai++) {
        const side = ai ? 1 : -1, ip = ARM_CH[ai][0], ir = ARM_CH[ai][1], ib = ARM_CH[ai][2];
        const up = side === SW.side ? hi : 0;
        const raise = ARM_REST - 0.7 + (2.55 - ARM_REST + 0.7) * up + 0.25 * up * Math.sin(S.t * 13);
        f[ip] += (0.55 * (1 - up) + 0.2 * up - f[ip]) * wa; f[ir] += (raise - f[ir]) * wa; f[ib] += (0.9 * (1 - up) - f[ib]) * wa;
      }
      if (pid === 'pencil') { // back behind the ear
        for (let i = 0; i < 6; i++) f[CH.propX + i] += (PENCIL_EAR[i] - f[CH.propX + i]) * wa;
      } else if (pid && DESK_PROPS.has(pid)) {
        keepOnDesk(f); // the prop stays where the unswivelled body had it on the desk
        if (pid === 'grep') { f[CH.propB] *= 1 - wa; f[CH.propC] *= 1 - wa; } // the lens rests on the page
      }
    }
  }

  /** hips + squash + shape transform (writeBody's) for body channels b (hipX hipY hipZ pitch twist roll sq grow). */
  function bodyMatrix(b: Float32Array, m: THREE.Matrix4, q: THREE.Quaternion) {
    const hb = nodeData(nodes.hips).base.p, sh = nodes.shape.scale;
    swE.set(b[3], b[4], -b[5]); q.setFromEuler(swE);
    const ss = Math.max(0.3, 1 + b[6]), sxz = 1 / Math.sqrt(ss), g = b[7];
    swP.set(hb.x + b[0], hb.y + b[1], hb.z + b[2]); swS.set(sxz * g * sh.x, ss * g * sh.y, sxz * g * sh.z);
    m.compose(swP, q, swS);
  }

  /**
   * [CHR fix m3-r3] A desk prop (grep tome, cards, stamp pad, laptop, backpack) is placed in the body frame; while the
   * body swivels out, re-place it so it stays where the unswivelled body (channels B0) had it: P' = M1⁻¹·M0·P.
   */
  function keepOnDesk(f: Float32Array) {
    for (let i = 0; i < 8; i++) B1[i] = f[BODY_CH[i]];
    bodyMatrix(B0, swM0, swQ0); bodyMatrix(B1, swM1, swQ1);
    swM1.invert().multiply(swM0);
    tmpV.set(f[CH.propX], f[CH.propY], f[CH.propZ]).applyMatrix4(swM1);
    f[CH.propX] = tmpV.x; f[CH.propY] = tmpV.y; f[CH.propZ] = tmpV.z;
    swE.set(f[CH.propRx], f[CH.propRy], f[CH.propRz], 'XYZ'); tmpQ.setFromEuler(swE);
    tmpQ.premultiply(swQ0).premultiply(swQ1.invert());
    swE.setFromQuaternion(tmpQ, 'XYZ');
    f[CH.propRx] = swE.x; f[CH.propRy] = swE.y; f[CH.propRz] = swE.z;
    swE.order = 'YXZ';
  }

  /**
   * [CHR fix m3-r1] (code review: the lumen walk-up, a worker hovering over its chair tilted ~20° and yawed off the desk,
   * a foot dangling under the seat) Pins a seated, turned body to its seat; see SEAT_TILT. Only a turned body is
   * touched (|twist| > 0.1), so desk leans, seated hops and the chair-spin fidget keep their motion.
   * @param k seat level (0..1)
   */
  function seatPin(f: Float32Array, k: number) {
    if (react && GLANCE_REACT.has(react.def.id)) {
      const tw = f[CH.twist], lim = SEAT_TWIST;
      const tc = tw > lim ? lim : tw < -lim ? -lim : tw;
      if (tc !== tw) { f[CH.twist] = tw + (tc - tw) * k; f[CH.lookX] = Math.max(-1, Math.min(1, f[CH.lookX] + (tw - tc) * 0.9 * k)); }
    }
    const a = Math.abs(f[CH.twist]);
    const pin = k * (a <= 0.1 ? 0 : a >= 0.3 ? 1 : (a - 0.1) / 0.2);
    if (pin <= 0) return;
    const p = f[CH.pitch], r = f[CH.roll];
    f[CH.pitch] = p + ((p > SEAT_TILT ? SEAT_TILT : p < -SEAT_TILT ? -SEAT_TILT : p) - p) * pin;
    f[CH.roll] = r + ((r > SEAT_TILT ? SEAT_TILT : r < -SEAT_TILT ? -SEAT_TILT : r) - r) * pin;
    f[CH.hipX] *= 1 - pin; f[CH.hipZ] *= 1 - pin;
    const base = SEAT_OFF * S.seatLevel, dy = f[CH.hipY] - base;
    f[CH.hipY] = base + dy + ((dy > 0.06 ? 0.06 : dy < -0.03 ? -0.03 : dy) - dy) * pin;
  }

  /**
   * [CHR M3.5] Walk-up face turn (seated desk work, player ≤ 2 m, not behind) and the dash skid-stop (hard braking
   * out of a dash: lean back, legs braced forward, a squash).
   */
  function stepWalkUp(f: Float32Array, dt: number) {
    let want = 0;
    const deskAct = !!cur && (DESK_WORK.has(cur.id) || (DESK_IDLE.has(cur.id) && seatSlot?.tag === 'desk'));
    // [CHR fix m3-r3] swivel-out: seated desk work, the player inside SWIVEL_IN (out at SWIVEL_OUT), not behind, and
    // this is the nearest such worker (claimSwivel)
    const rel = act.viewRel, arel = Math.abs(rel);
    const elig = !!(seatTarget && S.seatLevel > 0.95 && deskAct && arel < FACE_TURN_BEHIND && act.viewD < (SW.on ? SWIVEL_OUT : SWIVEL_IN));
    const held = claimSwivel(swId, elig ? swivelScore(rig.root.position.x, rig.root.position.z, act.viewD) : 99, elig);
    debug.swivel = held ? swW.x : 0;
    act.swivel = swW.x > 0 ? (swW.x < 1 ? swW.x : 1) : 0; // activities read it next frame (readBook: the book to the lap)
    if (held) {
      if (!SW.on) { SW.side = arel > 0.12 ? Math.sign(rel) : ((seed >>> 0) & 1 ? 1 : -1); SW.t = 0; }
      else if (Math.sign(rel) !== SW.side && arel > 0.45) SW.side = Math.sign(rel);
      SW.t += dt;
      // roll-out target (root frame): back, and out to the player's side (most when straight across the desk)
      const across = 1 - Math.min(1, arel / 1.1);
      SW.dx = SW.side * (SWIVEL_LAT_SIDE + (SWIVEL_LAT - SWIVEL_LAT_SIDE) * across); SW.dz = -SWIVEL_BACK;
      // the player seen from the rolled-out seat; a player to the side gets ≥ SWIVEL_MIN, ≤ SWIVEL_PAST past them
      const vx = act.viewD * Math.sin(rel) - SW.dx, vz = act.viewD * Math.cos(rel) - SW.dz;
      const rel2 = Math.atan2(vx, vz);
      const g = Math.min(1, Math.max(0, (arel - 0.3) / (SWIVEL_SIDE_FULL - 0.3)));
      let tw = Math.max(Math.abs(rel2), SWIVEL_MIN * g);
      tw = Math.min(tw, Math.abs(rel2) + SWIVEL_PAST, SWIVEL_MAX);
      SW.tw = Math.sign(rel2 || SW.side) === SW.side ? SW.side * tw : rel2;
    }
    SW.on = held ? 1 : 0;
    swW.step(dt, held ? 1 : 0);
    swTw.step(dt, held ? SW.tw : 0);
    // [CHR fix m3-r1] a pat (body + face, keeps typing) keeps the walk-up turn: both aim at the same player
    const patted = react !== null && react.def.id === 'patted';
    if (!held && seatTarget && (!react || patted) && deskAct && act.viewD < FACE_TURN_NEAR && Math.abs(act.viewRel) < FACE_TURN_BEHIND) {
      const w = Math.min(1, (FACE_TURN_NEAR - act.viewD) / (FACE_TURN_NEAR - FACE_TURN_FULL));
      want = Math.max(-FACE_TURN, Math.min(FACE_TURN, act.viewRel)) * w;
    }
    faceTurn.step(dt, want);
    const k = faceTurn.x;
    if (k > 0.005 || k < -0.005) {
      if (patted) { if (Math.abs(k) > Math.abs(f[CH.twist])) f[CH.twist] = k; } // the larger of the two turns, not both
      else f[CH.twist] += k;
      const lx = f[CH.lookX] + (Math.max(-1, Math.min(1, (act.viewRel - k) * 0.9)) - f[CH.lookX]) * Math.min(1, Math.abs(k) / FACE_TURN);
      f[CH.lookX] = lx; f[CH.lookY] += (0.1 - f[CH.lookY]) * Math.min(1, Math.abs(k) / FACE_TURN) * 0.6;
    }
    if (S.dashing > 0 && S.accFwd < -5) S.skid = 0.4;
    if (S.skid > 0) {
      S.skid -= dt;
      const s = Math.min(1, S.skid / 0.4);
      f[CH.pitch] -= 0.5 * s; f[CH.sq] -= 0.12 * s;
      for (let i = 0; i < 4; i++) f[CH.l0s + i * 2] += (i < 2 ? 0.9 : 0.6) * s;
      f[CH.aLr] += 0.6 * s; f[CH.aRr] += 0.6 * s;
    }
  }

  /** Face: expression springs, blinks (seeded rate, 12 % doubles; a turn > ~100°/s blinks too), saccades, look-at. */
  function stepFace() {
    const dt = S.dt, f = out.f;
    const reactFace = react && react.def.face && react.t < react.def.dur - 0.15 ? react.def.face : null;
    const exprId = reactFace ?? out.face ?? baseFace ?? cur?.def.face ?? 'neutral';
    const ex = expressionOf(exprId);
    const wantEye = kindEye(rig.kind, out.eye ?? ex.eye);
    const wantMouth = out.mouth ?? ex.mouth;
    fs.eyeS.step(dt, ex.eyeS * (f[CH.eyeS] || 1));
    fs.eyeSY.step(dt, ex.eyeSY * (f[CH.eyeSY] || 1));
    fs.lid.step(dt, Math.max(ex.lid, f[CH.lid]));
    fs.browA.step(dt, ex.browA + f[CH.browA]);
    fs.browOn.step(dt, Math.max(ex.browOn, f[CH.browOn]));
    fs.blush.step(dt, Math.max(ex.blush, f[CH.blush]));
    fs.mouthS.step(dt, f[CH.mouthS] || 1);
    // Shape swaps hide under a blink.
    if (S.blinkStart < 0 && (S.t >= S.nextBlink || wantEye !== eyeShown || Math.abs(S.yawRate) > 3)) {
      S.blinkStart = S.t; doubleBlink = rnd() < 0.12;
    }
    S.blink = 0;
    if (S.blinkStart >= 0) {
      const u = S.t - S.blinkStart;
      S.blink = blinkAt(u) + (doubleBlink ? blinkAt(u - BLINK_DUR) : 0);
      if (S.blink > 0.7 && wantEye !== eyeShown) eyeShown = wantEye;
      if (u > BLINK_DUR * (doubleBlink ? 2 : 1)) {
        S.blinkStart = -1;
        const slow = rig.kind === 'agent' || exprId === 'sleepy' ? 1.6 : 1;
        S.nextBlink = S.t + (0.6 + rnd() * 0.8) * slow / pers.blinkRate;
      }
    }
    if (wantEye !== eyeShown && S.blinkStart < 0) eyeShown = wantEye;
    if (wantMouth !== mouthShown) { mouthShown = wantMouth; fs.mouthS.x = 0.2; }
    // Saccades + look-at.
    if (S.t >= S.nextSacc) { S.saccX = (rnd() * 2 - 1) * 0.35; S.saccY = (rnd() * 2 - 1) * 0.2; S.nextSacc = S.t + (0.5 + rnd()) / pers.saccadeRate; }
    let lx = f[CH.lookX] + S.saccX * 0.5, ly = f[CH.lookY] + S.saccY * 0.5;
    if (lookTarget) {
      tmpV.copy(lookTarget);
      nodes.faceRoot.worldToLocal(tmpV);
      const dz = Math.max(0.2, tmpV.z);
      lx = Math.max(-1, Math.min(1, (tmpV.x / dz) * 1.4)); ly = Math.max(-1, Math.min(1, ((tmpV.y - EYE_Y) / dz) * 1.4));
    }
    fs.lookX.step(dt, Math.max(-1, Math.min(1, lx)));
    fs.lookY.step(dt, Math.max(-1, Math.min(1, ly)));
  }

  /** Hips + squash (volume-preserving: xz = 1/√s, y = s; see pose.squashScale). */
  function writeBody() {
    const f = out.f;
    const hips = nodes.hips;
    const hb = nodeData(hips).base.p;
    hips.position.set(hb.x + f[CH.hipX], hb.y + f[CH.hipY], hb.z + f[CH.hipZ]);
    hips.rotation.set(f[CH.pitch], f[CH.twist], -f[CH.roll]);
    const ss = Math.max(0.3, 1 + f[CH.sq]), sxz = 1 / Math.sqrt(ss); // = squashScale() without its array
    const g = f[CH.grow];
    nodes.squash.scale.set(sxz * g, ss * g, sxz * g);
  }

  function writeArms() {
    const f = out.f, dt = S.dt, arms = rig.arms;
    for (let ai = 0; ai < arms.length; ai++) {
      const a = arms[ai];
      const s = a.side, i = s < 0 ? 0 : 1;
      const p = s < 0 ? f[CH.aLp] : f[CH.aRp], r = s < 0 ? f[CH.aLr] : f[CH.aRr], b = s < 0 ? f[CH.aLb] : f[CH.aRb], len = s < 0 ? f[CH.aLs] : f[CH.aRs];
      a.pivot.rotation.set(-p, 0, s * r);
      a.elbow.rotation.x = -b;
      // [CHR fix m15-r2] noodle: the forearm chain curls by the pose's curl plus a springy lag behind the arm's
      // swing (the tip trails each wave stroke and overshoots when it stops). The lag only bends long noodles, so
      // short IK reaches (keyboard, mug) still land on target.
      armLag[i].step(dt, r);
      const lag = (armLag[i].x - r) * Math.min(1, Math.max(0, (len - 1.6) / 2.5));
      const curl = Math.max(-0.9, Math.min(0.9, (s < 0 ? f[CH.aLc] : f[CH.aRc]) + Math.max(-0.35, Math.min(0.5, lag))));
      // Keep the reach: a curled noodle restretches so a raised hand stays exactly as high as the straight arm's
      // (vertical in the raise plane), any other arm keeps its reach along the arm (chord ratio).
      let th = 0, chord = 0, vert = 0;
      for (let k = 0; k < FORE_SEGS; k++) { th += curl * CURL_W[k]; chord += Math.cos(th); vert -= Math.cos(r + th); }
      const up = -Math.cos(r) * FORE_SEGS;
      let ln = Math.max(0.3, len) * (up > 0.4 * FORE_SEGS && vert > 0.2 ? Math.min(1.6, Math.max(0.7, up / vert)) : FORE_SEGS / chord);
      // [CHR fix m3-r1] close-up cap on the noodle's reach (restretch included), faded out by CLOSE_FAR
      if (act.close > 0) { const cap = CLOSE_LN + (1 - act.close) * 40; if (ln > cap) ln = cap; }
      const seg = (FORE_L / FORE_SEGS) * ln;
      for (let k = 0; k < FORE_SEGS; k++) {
        a.joints[k].rotation.z = s * curl * CURL_W[k];
        if (k) a.joints[k].position.y = -seg;
        a.segs[k].scale.y = ln;
      }
      a.hand.position.y = -seg;
    }
  }

  function writeLegs() {
    const f = out.f;
    for (let i = 0; i < 4; i++) {
      const lg = rig.legs[i];
      lg.position.y = nodeData(lg).base.p.y + f[CH.l0y + i * 2];
      lg.rotation.x = -f[CH.l0s + i * 2];
    }
  }

  /**
   * [CHR fix m175-r2] Seated on a fixed seat with a backrest (seat.ts): the body's total turn off the seat (root swivel
   * + hip twist) is soft-clamped to ±BODY_TURN (a full `fidget:spin` becomes a wiggle against the cushions), and arms
   * / legs never swing back and down into the backrest (an arm below horizontal keeps pitch ≥ 0, its elbow folds
   * forward only; legs swing forward only). Raised arms (hands behind the head) pass over the back and are kept.
   * @param k seat level (0..1, the hop onto the seat blends it in)
   */
  function seatGuard(f: Float32Array, k: number) {
    let sw = rig.root.rotation.y - Math.PI - S.seatYaw;
    sw = ((sw + Math.PI) % TAU + TAU) % TAU - Math.PI;
    let tw = f[CH.twist];
    if (Math.abs(tw) > Math.PI / 2) tw = BODY_TURN * Math.sin(tw);
    const tot = BODY_TURN * Math.tanh((sw + tw) / BODY_TURN);
    f[CH.twist] += (tot - sw - f[CH.twist]) * k;
    if (!seatProf?.back) return; // (seatProf is set: the caller checks it)
    for (let ai = 0; ai < 2; ai++) {
      const ip = ARM_CH[ai][0], ir = ARM_CH[ai][1], ib = ARM_CH[ai][2];
      // weight: 1 for an arm at or below horizontal, fading out 0.25 rad above it (pitch no longer points it back)
      const w = k * Math.min(1, Math.max(0, (Math.PI / 2 + 0.25 - f[ir]) / 0.5));
      if (f[ip] < 0) f[ip] -= f[ip] * w;
      if (f[ib] < 0) f[ib] -= f[ib] * w;
    }
    for (let i = 0; i < 4; i++) { const j = CH.l0s + i * 2; if (f[j] < 0) f[j] -= f[j] * k; }
  }

  function writeFace() {
    if (!face) return;
    const blink = S.blink, time = S.t;
    const eyeS = fs.eyeS.x, sy = fs.eyeSY.x, lid = Math.max(0, Math.min(0.95, fs.lid.x));
    const open = 1 - 0.88 * blink;
    for (let ei = 0; ei < face.eyes.length; ei++) {
      const e = face.eyes[ei];
      const n = e.node;
      n.position.set(e.side * EYE_X + fs.lookX.x * 0.03, EYE_Y + fs.lookY.x * 0.022, FACE_Z);
      n.scale.set(eyeS, eyeS, 1);
      const sh = e.shapes;
      for (const k in sh) sh[k as keyof EyeShapes].visible = false; // (keys are exactly EyeShapes')
      let glint = 1;
      const shape = eyeShown;
      if (shape === 'slot' || shape === 'closed') {
        const s = sh.slot;
        s.visible = true;
        const k = shape === 'closed' ? 0.13 : Math.max(0.1, sy * (1 - lid) * open);
        s.scale.set(shape === 'closed' ? 1.2 : 1, k, 1);
        s.position.y = -(1 - k) * 0.085 * (lid > 0.05 ? 1 : 0.55);
        glint = shape === 'closed' || k < 0.45 ? 0 : 1;
        nodeData(n).glintRy = 0.058 * k;
        nodeData(n).glintCy = s.position.y; // [CHR fix r3] the lidded slot sits lower: centre the glint ellipse on it
      } else if (shape === 'round') {
        sh.round.visible = true; sh.pupil.visible = true;
        const k = Math.max(0.08, open * (1 - lid * 0.8));
        sh.round.scale.set(0.055, 0.055 * k, 0.03);
        sh.pupil.scale.set(0.03, 0.036 * k, 0.02);
        sh.pupil.position.set(fs.lookX.x * 0.012, fs.lookY.x * 0.012 * k, 0.018);
        glint = k > 0.45 ? 0.85 : 0;
        nodeData(n).glintRy = 0.03 * k;
        nodeData(n).glintCy = 0;
      } else {
        const s = shapeOf(sh, shape);
        s.visible = true;
        const b = nodeData(s).base.s;
        s.scale.set(b.x, b.y * open, b.z);
        if (shape === 'swirl') { s.rotation.z = -time * 9; sh.swirl2.visible = true; sh.swirl2.rotation.z = time * 12; }
        glint = shape === 'heart' || shape === 'diamond' ? (open > 0.5 ? 0.8 : 0) : 0;
        nodeData(n).glintRy = 0.03;
        nodeData(n).glintCy = 0;
      }
      e.glint.visible = glint > 0;
      nodeData(e.glint).glintScale = glint;
      nodeData(e.glint).glintRy = nodeData(n).glintRy;
      nodeData(e.glint).glintCy = nodeData(n).glintCy;
      const bOn = fs.browOn.x;
      e.brow.visible = bOn > 0.08;
      if (e.brow.visible) {
        const ang = fs.browA.x;
        e.brow.position.set(e.side * (EYE_X - 0.05 * eyeS) + fs.lookX.x * 0.015, EYE_Y + 0.11 * eyeS + 0.02 * (eyeS - 1) + ang * 0.012 - lid * 0.03, FACE_Z + 0.004);
        e.brow.rotation.z = e.side * (Math.PI / 2 - ang);
        e.brow.scale.set(0.024, 0.05 * Math.min(1, bOn), 0.024);
      }
      const bl = fs.blush.x;
      e.blush.visible = bl > 0.05;
      if (e.blush.visible) e.blush.scale.set(0.05 * bl, 0.01, 0.034 * bl);
    }
    const m = face.mouth;
    for (let k = 0; k < MOUTH_KEYS.length; k++) m[MOUTH_KEYS[k]].visible = false;
    const ms = Math.max(0.01, fs.mouthS.x);
    m.node.scale.set(ms, ms, 1);
    m.node.position.x = fs.lookX.x * 0.012;
    if (mouthShown === 'wobble' || mouthShown === 'squiggle') {
      m.wobbleA.visible = m.wobbleB.visible = true;
      m.wobbleA.position.y = 0.004 * Math.sin(time * 9); m.wobbleB.position.y = -0.004 * Math.sin(time * 9);
    } else if (mouthShown) { const mp = mouthPart(m, mouthShown); if (mp) mp.visible = true; }
  }

  function writeProps() {
    const pose = out, f = out.f, time = S.t;
    const props = rig.props;
    const want = pose.prop && props[pose.prop] ? pose.prop : null;
    if (want !== lastProp) {
      for (const id in props) props[id].root.visible = id === want;
      lastProp = want;
    }
    if (!want) return;
    const pr = props[want];
    pr.root.position.set(f[CH.propX], f[CH.propY], f[CH.propZ]);
    pr.root.rotation.set(f[CH.propRx], f[CH.propRy], f[CH.propRz]);
    pr.update?.(f, time);
  }

  /** [CHR M3.5] The arrival crate (rig/clawd.ts buildCrate) from the pose's crate channels. */
  function writeCrate() {
    const cr = rig.crate;
    if (!cr) return;
    const f = out.f;
    const k = f[CH.crate];
    const on = k > 0.02;
    if (cr.root.visible !== on) cr.root.visible = on;
    if (!on) return;
    cr.root.scale.set(k, k, k);
    const sh = f[CH.crateShake];
    cr.root.rotation.set(sh * 0.4, 0, sh);
    const o = f[CH.crateO] * 1.62, lid = f[CH.crateLid] * 2.3;
    for (let i = 0; i < cr.walls.length; i++) cr.walls[i].rotation.x = o;
    for (let i = 0; i < cr.lids.length; i++) cr.lids[i].rotation.x = lid;
  }

  /** Backpack, lanyard emblem, struggle look, sweat and the mini-Clawds (§6.7), from setTraits(). */
  function writeGear() {
    const dt = S.dt, time = S.t, pose = out;
    const g = rig.gear;
    if (!g) return;
    // backpack (hidden while it is hugged in front for compaction)
    const packOn = traits.pack > 0 && pose.prop !== 'pack';
    g.packPivot.visible = packOn;
    if (packOn) {
      const k = PACK_K[traits.pack];
      g.pack.scale.set(k, k, k * (traits.pack === 3 ? 1.35 : 1));
      for (let i = 0; i < g.papers.length; i++) g.papers[i].visible = traits.pack === 3;
      if (dt > 0) packJ.update(dt, bodyA.x, bodyA.z + bodyA.y * 0.4);
      g.packPivot.rotation.set(-0.08 - packJ.sz.x * 0.6 - S.speed * 0.05, 0, packJ.sx.x * 0.4);
    }
    // lanyard badge + emblem (model tier)
    const emblem = (traits.tier !== null && TIER_EMBLEM[traits.tier]) || null;
    g.lan.visible = !!traits.tier;
    if (g.lan.visible) {
      g.emblems.star.visible = emblem === 'star';
      g.emblems.circle.visible = g.emblems.circleRing.visible = emblem === 'circle';
      g.emblems.leaf.visible = emblem === 'leaf';
      if (dt > 0) badgeJ.update(dt, bodyA.x, bodyA.z + bodyA.y * 0.3);
      g.badgePivot.rotation.set(-badgeJ.sz.x * 0.5 - pose.f[CH.pitch] * 0.8, 0, badgeJ.sx.x * 0.7 + pose.f[CH.roll] * 0.9);
    }
    // struggle: static-frizz tufts (level ≥ 1), eye-bags + orbiting crossed-out paper balls (level ≥ 2)
    const lvl = traits.struggle;
    g.tuftRoot.visible = lvl >= 1;
    if (g.tuftRoot.visible) {
      const zap = Math.floor(time * 12);
      for (let i = 0; i < g.tufts.length; i++) {
        const n = g.tufts[i];
        const b = nodeData(n).base.r;
        const j = MOTION.reduced ? 0 : (((zap * 7 + i * 13) % 5) - 2) * 0.09;
        n.rotation.set(b.x + j * 0.6, b.y, b.z + j);
        n.scale.setScalar(0.9 + 0.2 * (((zap + i * 3) % 4) / 3));
      }
    }
    for (let i = 0; i < g.bags.length; i++) g.bags[i].visible = lvl >= 2;
    g.orbit.visible = lvl >= 2;
    if (lvl >= 2) {
      g.orbit.rotation.y = time * 1.6;
      for (let i = 0; i < g.balls.length; i++) { const b = g.balls[i]; const a = (i / 3) * TAU; b.position.set(Math.sin(a) * 0.44, 0.05 * Math.sin(time * 3 + i * 2), Math.cos(a) * 0.44); b.rotation.set(time * 2 + i, time, 0); }
    }
    // sweat drops at the temples (context ≥ 180k)
    for (let i = 0; i < g.drops.length; i++) {
      const d = g.drops[i];
      d.visible = traits.sweat;
      if (!traits.sweat) continue;
      const u = ((time * 0.7 + i * 0.5) % 1);
      const b = nodeData(d).base.p;
      d.position.set(b.x, b.y - 0.18 * u * u, b.z + 0.02 * u);
      d.scale.setScalar(u < 0.1 ? u / 0.1 : 1 - Math.max(0, (u - 0.8) / 0.2));
    }
    // mini-Clawds
    if (minis) { // [CHR fix m15-r1] always stepped: frozen at LOD 2 they were left behind in the world
      miniArgs.count = traits.minis; miniArgs.moving = S.speed > 0.3; miniArgs.seated = seatTarget > 0; miniArgs.t = time; miniArgs.reduced = MOTION.reduced;
      minis.update(dt, miniArgs); // [CHR m2 r2 alloc] reused args object
    }
  }

  /** Acceleration of the body (incl. animated hops) in the body frame → `bodyA` (drives every accessory spring). */
  const bodyA = new THREE.Vector3();
  function measureBodyAcc() {
    const dt = S.dt;
    if (dt <= 0) return;
    nodes.squash.updateWorldMatrix(true, false);
    tmpV.setFromMatrixPosition(nodes.squash.matrixWorld);
    if (accHave) {
      tmpV2.subVectors(tmpV, accPrev).divideScalar(dt);
      if (tmpV2.lengthSq() > 400) tmpV2.set(0, 0, 0);
      accAcc.subVectors(tmpV2, accVel).divideScalar(dt);
      accVel.copy(tmpV2);
    }
    accPrev.copy(tmpV); accHave = true;
    tmpQ.setFromRotationMatrix(nodes.squash.matrixWorld).invert();
    bodyA.copy(accAcc).clampLength(0, 60).applyQuaternion(tmpQ);
  }

  function writeDyn() {
    const dt = S.dt;
    if (!rig.dyn.length || dt <= 0) return;
    const la = bodyA;
    for (let di = 0; di < rig.dyn.length; di++) {
      const d = rig.dyn[di];
      if (d.kind === 'tip' || d.kind === 'brim') {
        let s = dynJiggle.get(d);
        if (!s) {
          s = new Jiggle((d.kind === 'tip' && d.preset ? SPRING[d.preset] : undefined) ?? SPRING.jiggle, (d.kind === 'tip' ? d.gain : undefined) ?? 0.05);
          dynJiggle.set(d, s);
        }
        if (d.kind === 'tip') {
          s.update(dt, la.x + la.y * 0.3, la.z);
          const b = nodeData(d.node).base.r;
          d.node.rotation.set(b.x + s.sz.x, b.y, b.z - s.sx.x);
        } else {
          s.update(dt, la.x * 0.5, la.z * 0.5 + la.y * 0.2);
          const b = nodeData(d.node).base.r;
          d.node.rotation.set(b.x + s.sz.x * 0.4, b.y, b.z - s.sx.x * 0.4);
        }
      } else if (d.kind === 'spin') {
        d.node.rotation.y += dt * (4 + S.speed * 16 + (cur && cur.def.id !== 'standIdle' ? 10 : 0));
      } else {
        let s = dynChain.get(d);
        if (!s) { s = d.nodes.map(() => new Jiggle(SPRING.bouncy, 0.03)); dynChain.set(d, s); }
        let ax = la.x, az = la.z;
        for (let i = 0; i < d.nodes.length; i++) {
          const j = s[i];
          j.update(dt, ax, az + S.speed * 0.8);
          const b = nodeData(d.nodes[i]).base.r;
          d.nodes[i].rotation.set(b.x + j.sz.x * (1 + i * 0.6) + Math.min(0.9, S.speed * 0.25), b.y, b.z - j.sx.x * (1 + i * 0.6));
          ax *= 1.2; az *= 1.2;
        }
      }
    }
  }

  // Start with the idle rest pose written so a rig is never in its T-pose.
  api.update(0, 0);
  return api;
}

/** The eye shape part named `key`, or the slot eye for an unknown shape id (`pose.eye` is free text). */
function shapeOf(sh: EyeShapes, key: string): THREE.Object3D {
  return (sh as Record<string, THREE.Object3D | undefined>)[key] ?? sh.slot; // (index widened: the key comes from pose data)
}
/** The mouth part named `key`, if any (`pose.mouth` is free text). */
function mouthPart(m: MouthRig, key: string): THREE.Object3D | undefined {
  return key in m ? m[key as keyof MouthRig] : undefined; // (key widened: it comes from pose data)
}

/** Action weight during a stand→sit hop (0 → 1 by the landing at u ≈ 0.7). */
function seatW(u: number): number { const k = Math.min(1, Math.max(0, (u - 0.18) / 0.5)); return k * k * (3 - 2 * k); }
/** Extra hop arc over the seat transition. */
function seatHop(u: number): number { return u < 0.18 ? -0.03 * (u / 0.18) : u < 0.7 ? 0.14 * Math.sin(((u - 0.18) / 0.52) * Math.PI) : 0; }
/** Squash over the seat transition: crouch, stretch on the way up, splat on landing. */
function seatSquash(u: number): number {
  if (u < 0.18) return -0.17 * (u / 0.18);
  if (u < 0.7) return 0.12 * (1 - (u - 0.18) / 0.52);
  const w = (u - 0.7) * SIT_TRANS;
  return -0.22 * Math.exp(-w * 9) * Math.cos(w * 26);
}

export { REACTIONS, UPPER_L };
