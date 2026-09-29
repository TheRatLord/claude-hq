// @pure
/**
 * One-shot reactions (DESIGN §6.3; ART §6.1: anticipation, squash & stretch, overshoot). Each is
 * `{id, dur, mask, face, update(t, pose, a)}`, t in seconds from the start; the animator blends it in over 0.1 s and
 * out over the last 0.3 s. Scripted curves (not springs) so frame strips are deterministic. Owner: CHR.
 */
import { CH, MASK_ALL, type Pose } from './pose.ts';
import type { ActivityArgs } from './activities/index.ts';
import { arm, reach, ARM } from './ik.ts';
import { easeInOutCubic, easeOutBack, arc } from './easing.ts';
import { M } from './pose.ts';

const hump = (u: number, d: number): number => (u <= 0 || u >= d ? 0 : Math.sin((u / d) * Math.PI));
const sat = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const HOLD = M.BODY | M.ARMS | M.FACE; // keep the prop (and seat legs) of the running action

const TAU = Math.PI * 2;
/** Damped landing wobble on squash: starts at −amp. */
const land = (u: number, amp = 0.28, f = 3.6, k = 7): number => -amp * Math.exp(-u * k) * Math.cos(u * TAU * f);

interface JumpOpts { crouch?: number; air?: number; h?: number; depth?: number; stretch?: number; landAmp?: number }

/**
 * Generic jump: crouch (anticipation) → airborne arc with stretch → land squash wobble.
 */
function jump(t: number, { crouch = 0.14, air = 0.5, h = 0.5, depth = 0.24, stretch = 0.2, landAmp = 0.3 }: JumpOpts): { phase: 'crouch' | 'air' | 'land'; u: number; y: number; sq: number } {
  if (t < crouch) {
    const k = easeInOutCubic(t / crouch);
    return { phase: 'crouch', u: t / crouch, y: -0.03 * k, sq: -depth * k };
  }
  if (t < crouch + air) {
    const u = (t - crouch) / air;
    return { phase: 'air', u, y: h * arc(u), sq: stretch * (1 - u) * (1 - u) + 0.04 * Math.sin(u * Math.PI) - depth * Math.max(0, 1 - u * 8) };
  }
  const u = t - crouch - air;
  return { phase: 'land', u, y: 0, sq: land(u, landAmp) };
}

const legsTuck = (f: Float32Array, k: number): void => { for (let i = 0; i < 4; i++) { f[CH.l0y + i * 2] = 0.05 * k; f[CH.l0s + i * 2] = (i < 2 ? 0.5 : -0.3) * k; } };

export interface Reaction {
  id: string;
  dur: number;
  mask: number;
  face: string | null;
  variants?: number;
  /** stop-motion smears on fast parts */
  smear?: boolean;
  /** a follow-up reaction fired when this one ends (catchPlane → readNote) */
  next?: string;
  /** hold the key poses on twos (true = always, or [[t0, t1], …] windows) */
  twos?: boolean | number[][];
  update: (t: number, p: Pose, a: Partial<ActivityArgs>) => void;
}

export const REACTIONS: Record<string, Reaction> = {
  startle: {
    id: 'startle', dur: 1.0, mask: MASK_ALL, face: 'surprised', smear: true, twos: [[0.06, 0.3]],
    update(t, p) {
      const f = p.f;
      const j = jump(t, { crouch: 0.06, air: 0.34, h: 0.2, depth: 0.1, stretch: 0.28, landAmp: 0.26 });
      f[CH.hipY] = j.y; f[CH.sq] = j.sq;
      const fl = j.phase === 'land' ? Math.exp(-j.u * 5) : 1;
      arm(p, -1, 0.3 * Math.sin(t * 31), 1.15 + 1.35 * fl + 0.25 * Math.sin(t * 37) * fl, 0.2, 1 + 0.4 * fl);
      arm(p, 1, 0.3 * Math.sin(t * 29 + 1), 1.15 + 1.35 * fl + 0.25 * Math.sin(t * 41 + 2) * fl, 0.2, 1 + 0.4 * fl);
      f[CH.pitch] = -0.18 * fl;
      if (j.phase === 'air') legsTuck(f, Math.sin(j.u * Math.PI));
      f[CH.lookY] = 0.2;
    },
  },
  victory: {
    id: 'victory', dur: 1.9, mask: MASK_ALL, face: 'celebrate', variants: 3, smear: true, twos: [[0.18, 0.8]],
    update(t, p, a) {
      const f = p.f;
      const v = a.variant ?? 0;
      if (v === 0) {
        // Spin jump: big crouch → 0.6 m leap with a full 360° → splat landing → arms-up wiggle.
        const j = jump(t, { crouch: 0.18, air: 0.62, h: 0.6, depth: 0.28, stretch: 0.24, landAmp: 0.32 });
        f[CH.hipY] = j.y; f[CH.sq] = j.sq;
        if (j.phase === 'crouch') { arm(p, -1, -0.6, 0.5, 0, 1); arm(p, 1, -0.6, 0.5, 0, 1); f[CH.pitch] = 0.15; }
        else {
          const w = j.phase === 'land' ? Math.sin(j.u * TAU * 3) : 0;
          arm(p, -1, 0.1, 2.55 + 0.25 * w, 0, 2.6);
          arm(p, 1, 0.1, 2.55 - 0.25 * w, 0, 2.6);
          f[CH.pitch] = j.phase === 'air' ? -0.12 : -0.05;
          if (j.phase === 'air') { f[CH.twist] = TAU * easeInOutCubic(j.u) % TAU; legsTuck(f, Math.sin(j.u * Math.PI)); }
          f[CH.roll] = 0.08 * w;
        }
      } else if (v === 1) {
        // Star jump: arms and legs flung wide at the apex.
        const j = jump(t, { crouch: 0.15, air: 0.5, h: 0.42, depth: 0.24, stretch: 0.2 });
        f[CH.hipY] = j.y; f[CH.sq] = j.sq;
        const spread = j.phase === 'air' ? Math.sin(j.u * Math.PI) : j.phase === 'land' ? Math.max(0, 1 - j.u * 3) * 0.5 : 0;
        arm(p, -1, 0, 1.15 + 1.3 * spread + (j.phase === 'land' ? 1.1 * Math.min(1, j.u * 4) : 0), 0, 1.3);
        arm(p, 1, 0, 1.15 + 1.3 * spread + (j.phase === 'land' ? 1.1 * Math.min(1, j.u * 4) : 0), 0, 1.3);
        for (let i = 0; i < 4; i++) { f[CH.l0s + i * 2] = (i % 2 ? 1 : -1) * 0.0 + (i < 2 ? 0.6 : -0.6) * spread; f[CH.l0y + i * 2] = 0.04 * spread; }
        if (j.phase === 'crouch') f[CH.pitch] = 0.18;
      } else {
        // Double fist-pump hops.
        const u = t % 0.85, n = Math.floor(t / 0.85);
        const j = jump(u, { crouch: 0.1, air: 0.34, h: 0.2, depth: 0.2, stretch: 0.16, landAmp: 0.22 });
        f[CH.hipY] = n < 2 ? j.y : 0; f[CH.sq] = n < 2 ? j.sq : land(t - 1.7, 0.1);
        const side = n % 2 ? -1 : 1;
        const pump = j.phase === 'air' ? Math.sin(Math.min(1, j.u * 1.5) * Math.PI * 0.5) : j.phase === 'land' ? Math.max(0, 1 - j.u * 2) : 0;
        arm(p, side, 0.2, 1.15 + 1.45 * pump, 0.4 * (1 - pump), 1 + 1.8 * pump);
        arm(p, -side, 0.4, 1.0, 0.8, 1);
        f[CH.roll] = -0.08 * side * pump;
      }
    },
  },
  /**
   * Commit: a happy hop. [CHR fix m15-r1] Seated it pops right up out of the chair (0.22 m, legs kicking forward, arms
   * flung up in a V) so it reads over the monitor; standing it stays a light 0.16 m hop.
   */
  hop: {
    id: 'hop', dur: 0.9, mask: MASK_ALL, face: 'happy',
    update(t, p, a) {
      const f = p.f;
      const seated = !!a?.seated;
      const j = jump(t, { crouch: 0.11, air: seated ? 0.36 : 0.3, h: seated ? 0.22 : 0.16, depth: 0.2, stretch: 0.18, landAmp: 0.24 });
      f[CH.hipY] = j.y; f[CH.sq] = j.sq;
      const k = j.phase === 'air' ? Math.sin(j.u * Math.PI) : 0;
      const up = seated ? 1.6 : 0.7;
      arm(p, -1, 0.1, 1.15 + up * k, 0, 1 + (seated ? 1.2 : 0) * k); arm(p, 1, 0.1, 1.15 + up * k, 0, 1 + (seated ? 1.2 : 0) * k);
      if (seated) for (let i = 0; i < 4; i++) { f[CH.l0s + i * 2] = (i < 2 ? 1.25 : 1.05) + 0.4 * k; f[CH.l0y + i * 2] = 0; }
      else if (j.phase === 'air') legsTuck(f, k);
    },
  },
  dissolveIn: {
    id: 'dissolveIn', dur: 1.1, mask: MASK_ALL, face: 'happy',
    update(t, p) {
      // Pop into existence: scale from 0 with elastic overshoot, stretch → squash, arms fling out "ta-da".
      const f = p.f;
      const u = Math.min(1, t / 0.55);
      f[CH.grow] = Math.max(0.001, easeOutBack(u) * (1 + 0.06 * Math.sin(t * 20) * Math.exp(-t * 6)));
      f[CH.sq] = t < 0.3 ? 0.3 * (1 - t / 0.3) : land(t - 0.3, 0.22);
      f[CH.hipY] = 0.12 * arc(Math.min(1, t / 0.45));
      const k = Math.min(1, Math.max(0, (t - 0.35) / 0.2)) * Math.max(0, Math.min(1, (1.05 - t) / 0.3));
      arm(p, -1, 0.1, 1.15 + 1.1 * k, 0, 1 + 0.3 * k); arm(p, 1, 0.1, 1.15 + 1.1 * k, 0, 1 + 0.3 * k);
      p.eye = t < 0.35 ? 'star' : null;
    },
  },
  wave: {
    id: 'wave', dur: 1.5, mask: MASK_ALL, face: 'happy',
    update(t, p) {
      const w = Math.sin(TAU * 2.6 * t);
      const k = Math.min(1, t / 0.15) * Math.min(1, (1.5 - t) / 0.3);
      arm(p, 1, 0.3, 1.15 + (1.35 + 0.3 * w) * k, 0.3 * w * k, 1 + 1.6 * k);
      p.f[CH.roll] = -0.06 * w * k;
    },
  },
  // [BRN fix r2] Help-desk bell tap (§6.4 blocked > 10 s, every 20 s). face null: keeps the blocked worried /
  // determined face (hop's ^_^ would read as done, §6.7), and the raised hand stays up so the silhouette still says
  // blocked while the free hand slaps the bell.
  bellTap: {
    id: 'bellTap', dur: 0.9, mask: MASK_ALL, face: null,
    update(t, p) {
      const f = p.f;
      // lean in (0–0.25) → slap down (0.25–0.35) → bounce back up with a squash wobble
      const lean = t < 0.25 ? easeInOutCubic(t / 0.25) : Math.max(0, 1 - (t - 0.35) / 0.4);
      const slap = t < 0.25 ? 0 : t < 0.35 ? (t - 0.25) / 0.1 : Math.max(0, 1 - (t - 0.35) / 0.3);
      f[CH.pitch] = 0.18 * lean;
      f[CH.sq] = t < 0.35 ? -0.06 * lean : land(t - 0.35, 0.12, 3, 8);
      f[CH.hipY] = t > 0.35 && t < 0.6 ? 0.04 * arc((t - 0.35) / 0.25) : 0;
      arm(p, -1, 0.3 + 1.1 * lean, 1.4 - 0.5 * slap, 0.2, 1.3 + 0.9 * lean);
      arm(p, 1, 0.08, 2.95, 0.1, 5.6);
      f[CH.lookY] = -0.25 * lean;
    },
  },
  dizzy: {
    id: 'dizzy', dur: 2.2, mask: MASK_ALL, face: 'dizzy',
    update(t, p) {
      const f = p.f;
      f[CH.roll] = 0.16 * Math.sin(TAU * 1.2 * t);
      f[CH.pitch] = 0.08 * Math.cos(TAU * 1.2 * t);
      f[CH.hipX] = 0.03 * Math.sin(TAU * 1.2 * t);
      f[CH.sq] = t < 0.15 ? -0.2 * (t / 0.15) : land(t - 0.15, 0.2, 2.5, 3);
      arm(p, -1, 0, 1.4, 0, 1); arm(p, 1, 0, 1.4, 0, 1);
    },
  },
};

const TESTS_REACTIONS: Record<string, Reaction> = {
  /** test-pass: a double fist pump with a little hop on the second. */
  /**
   * Test pass: "YES!" [CHR fix m15-r1] Wind-up (fist at the chest, crouch) → pop up ≥ 0.15 m (out of the chair when
   * seated) with the fist punched straight up over the hat → a second smaller pump → landing squash. The noodle
   * stretches to the rig's crown so the fist always clears the head.
   */
  fistPump: {
    id: 'fistPump', dur: 1.4, mask: HOLD, face: 'determined', smear: true, twos: [[0.12, 0.3]],
    update(t, p, a) {
      const f = p.f;
      const crown = a?.crown ?? 0.7;
      const fistLen = Math.max(1, ((crown + 0.12 + 0.058 - 0.29) / 0.99 - 0.075) / 0.065);
      const j = jump(t, { crouch: 0.14, air: 0.44, h: 0.19, depth: 0.22, stretch: 0.22, landAmp: 0.22 });
      f[CH.hipY] = j.y; f[CH.sq] = j.sq;
      // second pump at 0.8 s: the fist dips and punches again with a little bounce
      const u2 = t - 0.8;
      const dip = u2 > 0 && u2 < 0.3 ? Math.sin((u2 / 0.3) * Math.PI) : 0;
      if (u2 > 0 && u2 < 0.3) { f[CH.hipY] += 0.05 * Math.sin((u2 / 0.3) * Math.PI); f[CH.sq] += 0.06 * Math.sin((u2 / 0.3) * Math.PI) - 0.05 * dip * (u2 < 0.08 ? 1 : 0); }
      const up = j.phase === 'crouch' ? 0 : sat((t - 0.14) / 0.12) * sat((1.4 - t) / 0.3);
      // wind-up: fist at the chest, elbow folded
      arm(p, 1, 0.6 * (1 - up) + 0.08 * up, 0.9 + (2.95 - 0.35 * dip - 0.9) * up, 1.6 * (1 - up), 1 + (fistLen - 1) * up * (1 - 0.25 * dip));
      // the other arm pulls down hard ("yes!")
      arm(p, -1, 0.45, 0.85 - 0.2 * up, 1.7, 1);
      f[CH.roll] = -0.12 * up; f[CH.pitch] = -0.1 * up;
      p.mouth = up > 0.3 ? 'grin' : null;
      f[CH.browA] = -0.5;
      if (a?.seated) for (let i = 0; i < 4; i++) { f[CH.l0s + i * 2] = (i < 2 ? 1.25 : 1.05) + 0.3 * up; f[CH.l0y + i * 2] = 0; }
    },
  },
  /**
   * Test fail: the air goes out of it. [CHR fix m15-r1] Seated: a big head-drop squash onto the desk, both arms flop
   * forward onto it with a floppy bounce, then a sad little wobble. Standing: flattens, pitches forward, noodle arms
   * droop to the floor.
   */
  slump: {
    id: 'slump', dur: 2.2, mask: HOLD, face: 'worried',
    update(t, p, a) {
      const f = p.f;
      const k = sat(t / 0.3) * sat((2.2 - t) / 0.5);
      const flop = t < 0.3 ? 0 : Math.exp(-(t - 0.3) * 7) * Math.cos((t - 0.3) * 22); // arms bounce on landing
      const wob = 0.03 * Math.sin(t * 6) * k;
      if (a?.seated) {
        f[CH.sq] = -0.34 * k + wob + 0.05 * flop * k; f[CH.pitch] = 0.5 * k; f[CH.hipY] = -0.06 * k;
        for (let side = -1; side <= 1; side += 2) arm(p, side, (1.2 - 0.25 * flop) * k + 0.2 * (1 - k), 1.15 - 0.35 * k, 0, 1 + 1.4 * k);
      } else {
        f[CH.sq] = -0.3 * k + wob; f[CH.pitch] = 0.32 * k; f[CH.hipY] = -0.04 * k;
        for (let side = -1; side <= 1; side += 2) arm(p, side, 0.25 * k + 0.1 * flop * k, 1.15 - 1.0 * k, 0, 1 + 1.0 * k);
      }
      f[CH.eyeSY] = 1 - 0.3 * k; f[CH.lid] = 0.4 * k; f[CH.lookY] = -0.7 * k;
    },
  },
  /** Applause: quick claps with a bounce. */
  clap: {
    id: 'clap', dur: 1.3, mask: HOLD, face: 'happy',
    update(t, p) {
      const f = p.f;
      const c = Math.abs(Math.sin(TAU * 3 * t));
      const k = sat(t / 0.15) * sat((1.3 - t) / 0.25);
      for (let side = -1; side <= 1; side += 2) arm(p, side, 1.3 * k, 1.15 + (0.1 - 0.75 * (1 - c)) * k, 0.6 * k, 1 + 1.3 * k);
      f[CH.hipY] = 0.03 * c * k; f[CH.sq] = 0.06 * (c - 0.5) * k;
    },
  },
  /** Front-door arrival: "ta-da!" arms out with a hop. */
  arrive: {
    id: 'arrive', dur: 1.2, mask: MASK_ALL, face: 'happy',
    update(t, p) {
      const f = p.f;
      const j = jump(t, { crouch: 0.12, air: 0.36, h: 0.22, depth: 0.2, stretch: 0.2, landAmp: 0.26 });
      f[CH.hipY] = j.y; f[CH.sq] = j.sq;
      const k = j.phase === 'crouch' ? 0 : Math.min(1, j.phase === 'air' ? j.u * 2 : 1) * sat((1.2 - t) / 0.3);
      arm(p, -1, 0.15, 1.15 + 1.1 * k, 0, 1 + 1.2 * k); arm(p, 1, 0.15, 1.15 + 1.1 * k, 0, 1 + 1.2 * k);
      if (j.phase === 'air') legsTuck(f, Math.sin(j.u * Math.PI));
      p.eye = t > 0.3 && t < 0.9 ? 'star' : null;
    },
  },
  /** Goodbye: a wave, then a squash-and-pop shrink (the actor is removed after it). */
  leave: {
    id: 'leave', dur: 0.8, mask: MASK_ALL, face: 'happy',
    update(t, p) {
      const f = p.f;
      const w = Math.sin(TAU * 3 * t);
      arm(p, 1, 0.3, 2.5 + 0.3 * w, 0.3 * w, 2.4);
      const s = sat((t - 0.45) / 0.3);
      f[CH.sq] = s < 0.4 ? -0.25 * (s / 0.4) : 0.4 * (s - 0.4);
      f[CH.grow] = Math.max(0.001, 1 - s * s);
    },
  },
  /** Bumped into (by the player or a neighbour): squash, wobble, giggle squint. */
  bump: {
    id: 'bump', dur: 0.9, mask: HOLD, face: 'happy',
    update(t, p) {
      const f = p.f;
      f[CH.sq] = land(t, 0.3, 3.2, 5);
      f[CH.roll] = 0.25 * Math.exp(-t * 4) * Math.sin(t * 22);
      f[CH.pitch] = -0.12 * Math.exp(-t * 5);
      p.eye = t < 0.6 ? 'arc' : null; f[CH.blush] = 1;
    },
  },
  /** Moral support: pats a (blocked) teammate on the back. */
  pat: {
    id: 'pat', dur: 1.4, mask: HOLD, face: 'happy',
    update(t, p) {
      const f = p.f;
      const k = sat(t / 0.2) * sat((1.4 - t) / 0.3);
      const pat = Math.max(0, Math.sin(TAU * 2.5 * t));
      arm(p, 1, 1.0 * k, 1.15 + 0.5 * k, 0.3, 1 + (1.6 + 0.3 * pat) * k);
      f[CH.roll] = -0.08 * k; f[CH.sq] = -0.03 * pat * k;
    },
  },
  /** "Busy, one sec!": index finger up, a quick shake of the body, back to work. */
  busyFinger: {
    id: 'busyFinger', dur: 1.1, mask: HOLD, face: 'determined',
    update(t, p) {
      const f = p.f;
      const k = sat(t / 0.12) * sat((1.1 - t) / 0.25);
      arm(p, -1, 0.9 * k, 1.15 + 0.9 * k, 0.8 * k, 1 + 0.8 * k);
      f[CH.roll] = 0.1 * Math.sin(TAU * 4 * t) * k;
      f[CH.lookX] = -0.5 * k; f[CH.lid] = 0.3 * k;
    },
  },
  /** High-five: crouch, leap, slap overhead (hitstop at the slap), land. */
  highFive: {
    id: 'highFive', dur: 1.2, mask: MASK_ALL, face: 'celebrate', smear: true, twos: [[0.3, 0.46]],
    update(t, p) {
      const f = p.f;
      const j = jump(t, { crouch: 0.14, air: 0.42, h: 0.3, depth: 0.24, stretch: 0.22, landAmp: 0.28 });
      f[CH.hipY] = j.y; f[CH.sq] = j.sq;
      const up = j.phase === 'crouch' ? 0 : j.phase === 'air' ? Math.min(1, j.u * 2.5) : sat(1 - j.u * 2);
      arm(p, 1, 0.5 * up, 1.15 + 1.75 * up, 0, 1 + 3.2 * up);
      arm(p, -1, 0.1, 1.15 + 0.5 * up, 0, 1.2);
      f[CH.roll] = -0.15 * up;
      if (j.phase === 'air') legsTuck(f, Math.sin(j.u * Math.PI) * 0.7);
    },
  },
  /** A polite bow (thankYou and Shelly's post-juggle bow). */
  bow: {
    id: 'bow', dur: 1.3, mask: HOLD, face: 'happy',
    update(t, p) {
      const f = p.f;
      const k = hump(t, 1.3) ** 0.7;
      f[CH.pitch] = 0.7 * k; f[CH.hipZ] = 0.05 * k; f[CH.sq] = -0.06 * k;
      arm(p, -1, -0.35 * k, 1.15 - 0.6 * k, 0.4, 1); arm(p, 1, 0.8 * k, 1.15 - 0.4 * k, 0.9 * k, 1);
      p.eye = k > 0.4 ? 'arc' : null;
    },
  },
  /** Wake from a nap: jolt up, "!" eyes, Z's pop (FX), blink it off. */
  wake: {
    id: 'wake', dur: 1.0, mask: MASK_ALL, face: 'surprised', smear: true,
    update(t, p) {
      const f = p.f;
      const j = jump(t, { crouch: 0.04, air: 0.28, h: 0.14, depth: 0.08, stretch: 0.3, landAmp: 0.2 });
      f[CH.hipY] = j.y; f[CH.sq] = j.sq;
      const fl = j.phase === 'land' ? Math.exp(-j.u * 5) : 1;
      arm(p, -1, 0, 1.15 + 1.2 * fl, 0, 1 + 0.5 * fl); arm(p, 1, 0, 1.15 + 1.2 * fl, 0, 1 + 0.5 * fl);
      f[CH.eyeS] = 1 + 0.2 * fl;
      if (t > 0.7) p.eye = 'closed';
    },
  },
  /** Dust sneeze: ah… ah… (inhale stretch) CHOO (snap forward, squash). */
  sneeze: {
    id: 'sneeze', dur: 1.5, mask: HOLD, face: 'surprised', smear: true,
    update(t, p) {
      const f = p.f;
      if (t < 0.9) {
        const k = sat(t / 0.9) ** 1.5;
        f[CH.sq] = 0.18 * k + 0.02 * Math.sin(t * 30) * k; f[CH.pitch] = -0.25 * k; f[CH.lookY] = 0.5 * k;
        p.eye = t > 0.4 ? 'closed' : null; p.mouth = 'o';
      } else {
        const u = t - 0.9;
        f[CH.pitch] = 0.45 * Math.exp(-u * 5); f[CH.sq] = land(u, 0.3, 3, 6);
        p.eye = u < 0.3 ? 'closed' : null; p.mouth = u < 0.2 ? 'grin' : null;
      }
    },
  },
  /** Unblocked: a relieved hop and a thank-you wave at the player. */
  unblock: {
    id: 'unblock', dur: 1.6, mask: MASK_ALL, face: 'happy',
    update(t, p, a) {
      REACTIONS.hop.update(Math.min(t, 0.8), p, a);
      if (t > 0.6) {
        const w = Math.sin(TAU * 2.6 * (t - 0.6)), k = sat((t - 0.6) / 0.15) * sat((1.6 - t) / 0.3);
        arm(p, 1, 0.3, 1.15 + 1.35 * k, 0.3 * w * k, 1 + 1.6 * k);
        p.f[CH.blush] = 1;
      }
    },
  },
  /** Done signed off: bow, then a big wave. */
  thankYou: {
    id: 'thankYou', dur: 2.3, mask: MASK_ALL, face: 'happy',
    update(t, p, a) {
      if (t < 1.2) REACTIONS.bow.update(t * 1.3 / 1.2, p, a);
      else REACTIONS.wave.update(t - 1.2 + 0.2, p, a);
      p.f[CH.blush] = 1;
    },
  },
  /**
   * Work call (§6.4.2, 0.5 s): jolt + "!" (surprised pop), a spin toward home and the laptop snapped open into the
   * walkType hold, so the scurry that follows starts with the laptop already in hand.
   */
  workCall: {
    id: 'workCall', dur: 0.75, mask: MASK_ALL, face: 'surprised', smear: true, twos: [[0, 0.3]],
    update(t, p) {
      const f = p.f;
      const j = jump(t, { crouch: 0.05, air: 0.24, h: 0.16, depth: 0.12, stretch: 0.3, landAmp: 0.22 });
      f[CH.hipY] = j.y; f[CH.sq] = j.sq;
      const grab = sat((t - 0.2) / 0.2);
      p.prop = 'laptop';
      // the laptop is snatched up from the side, low (clear of the face), and flipped open into the walkType hold
      f[CH.propX] = -0.02 - 0.3 * (1 - grab); f[CH.propY] = 0.1 - 0.04 * (1 - grab); f[CH.propZ] = 0.4 - 0.1 * (1 - grab);
      f[CH.propRx] = 0.28 - 1.4 * (1 - grab); f[CH.propRz] = 0.8 * (1 - grab);
      f[CH.propA] = 0.78 * grab;
      // arms fling up with the jolt ("!"), then come down to hold the laptop
      arm(p, -1, 1.1 * grab, 1.15 + 1.3 * (1 - grab) - 0.4 * grab, 0.5 * grab, 1 + 0.8 * (1 - grab) + 0.6 * grab);
      arm(p, 1, 1.1 * grab, 1.15 + 1.3 * (1 - grab) - 0.4 * grab, 0.5 * grab, 1 + 0.8 * (1 - grab) + 0.6 * grab);
      f[CH.eyeS] = 1 + 0.3 * (1 - grab);
      f[CH.pitch] = 0.15 * grab;
      if (j.phase === 'air') legsTuck(f, Math.sin(j.u * Math.PI));
    },
  },
  /** Struggle cleared: a big relieved exhale (inflate… deflate with a shudder), then a small happy bounce. */
  exhale: {
    id: 'exhale', dur: 2.0, mask: HOLD, face: 'happy',
    update(t, p) {
      const f = p.f;
      if (t < 0.7) { const k = sat(t / 0.7); f[CH.sq] = 0.16 * k; f[CH.grow] = 1 + 0.04 * k; f[CH.pitch] = -0.15 * k; p.eye = 'closed'; }
      else {
        const u = t - 0.7;
        f[CH.sq] = 0.16 * Math.exp(-u * 4) - 0.14 * hump(u, 0.8) + 0.02 * Math.sin(u * 40) * Math.exp(-u * 4);
        f[CH.pitch] = 0.2 * hump(u, 0.9);
        arm(p, -1, 0, 1.15 - 0.7 * hump(u, 1), 0, 1.3); arm(p, 1, 0, 1.15 - 0.7 * hump(u, 1), 0, 1.3);
        p.mouth = u < 0.6 ? 'o' : 'smile';
        if (u < 0.4) p.eye = 'closed';
      }
    },
  },
};
Object.assign(REACTIONS, TESTS_REACTIONS);

// ---------------------------------------------------------------------------------------------------------------------
// [CHR M3.5] "Walk up and manage" reactions (consumed by BRN). Viewer-aimed ones read `a.viewRel` (signed body yaw to
// the player, 0 = ahead, ±π = behind; animator.ts from viewer.ts) live every frame, so they track a moving player.
// `next` chains a follow-up reaction when this one ends (catchPlane → readNote), so BRN fires one id.
// ---------------------------------------------------------------------------------------------------------------------
const BODY_FACE = M.BODY | M.FACE;
/** [CHR fix m3-r1] patted: max body (= head) turn toward the player (rad, ≈ 20°) and max eye look (−1..1) on top. */
export const PAT_TURN = 0.35, PAT_EYES = 0.55;
const clampAbs = (v: number, m: number): number => (v > m ? m : v < -m ? -m : v);
/** Ease-in-out 0→1 over [t0, t0 + d]. */
const ramp = (t: number, t0: number, d: number): number => easeInOutCubic(sat((t - t0) / d));
/** Turn-toward envelope: anticipation lean away (−8 %), overshoot on arrival, hold, ease back. */
function turnEnv(t: number, dur: number, inT = 0.32, outT = 0.35): number {
  if (t < inT) { const u = t / inT; return u < 0.2 ? -0.08 * (u / 0.2) : easeOutBack((u - 0.2) / 0.8); }
  if (t < dur - outT) return 1;
  return 1 - easeInOutCubic((t - (dur - outT)) / outT);
}
/** The arm on the viewer's side (+1 = the model's +x arm). */
const sideOf = (rel: number): number => (rel >= 0 ? 1 : -1);
/**
 * Mitten centre (+ `tip` m further along the arm) of a straight noodle arm in the body frame: FK of the animator's
 * writeArms (pivot Euler XYZ (−pitch, 0, side·raise), bend 0, no curl). Writes a shared scratch object.
 */
const HAND = { x: 0, y: 0, z: 0 };
function handFK(side: number, pitch: number, raise: number, len: number, tip = 0): { x: number; y: number; z: number } {
  const L = ARM.upper + ARM.fore * Math.max(0.3, len) + tip; // shoulder → mitten (+ tip)
  const sr = Math.sin(raise), cr = Math.cos(raise), sp = Math.sin(pitch), cp = Math.cos(pitch);
  HAND.x = side * (ARM.x + L * sr); HAND.y = ARM.y - L * cr * cp; HAND.z = L * cr * sp;
  return HAND;
}
const seatLegs = (f: Float32Array, k = 0): void => { for (let i = 0; i < 4; i++) { f[CH.l0s + i * 2] = (i < 2 ? 1.25 : 1.05) + k; f[CH.l0y + i * 2] = 0; } };

const MANAGE_REACTIONS: Record<string, Reaction> = {
  /**
   * Seated worker, player lingering ≤ 1.5 m behind: the torso swivels round (≤ 115°, eyes do the rest), a mitten
   * "shh" finger to the mouth with two tiny nods ("busy, one sec"), then back to the keyboard. The typing arm keeps
   * typing (mask: body + face + the shushing arm only).
   */
  glanceBack: {
    id: 'glanceBack', dur: 1.9, mask: BODY_FACE | M.ARMS, face: null,
    update(t, p, a) {
      const f = p.f;
      const rel = a?.viewRel ?? Math.PI * 0.8;
      const k = turnEnv(t, 1.9, 0.34, 0.4);
      const turn = clampAbs(rel, 2.1);
      f[CH.twist] = turn * k;
      f[CH.pitch] = 0.05 - 0.08 * k;
      f[CH.lookX] = clampAbs((rel - turn) * 0.9, 1) * sat(k); f[CH.lookY] = 0.15 * k;
      // the finger (the arm on the player's side): up to the mouth 0.3–1.45 s; the other mitten stays on the desk
      const s = sideOf(rel);
      const up = ramp(t, 0.3, 0.22) * (1 - ramp(t, 1.35, 0.3));
      const nod = 0.03 * (hump(t - 0.7, 0.18) + hump(t - 0.98, 0.18));
      arm(p, s, 0.9, 0.95, 0.6, 1.3);
      if (up > 0) reach(p, s, s * 0.05, 0.29 - nod * 1.5, 0.31, up);
      arm(p, -s, 0.9 * (1 - k) + 0.5 * k, 0.95, 0.6, 1.3);
      f[CH.sq] = -0.04 * hump(t, 0.25) - nod;
      f[CH.pitch] += nod * 2.5;
      if (up > 0.5) { p.mouth = 'o'; f[CH.mouthS] = 0.7; }
      f[CH.lid] = 0.3 * up; f[CH.browA] = -0.25 * up; f[CH.browOn] = up;
    },
  },
  /**
   * Done and still at the desk (BRN: ~every 20 s while the player is within 12 m): a quick 1.2 s look back over the
   * shoulder (≤ 120° of body + eyes) with a happy wave from the arm on the player's side.
   */
  lookBackWave: {
    id: 'lookBackWave', dur: 1.2, mask: HOLD, face: 'happy',
    update(t, p, a) {
      const f = p.f;
      const rel = a?.viewRel ?? 0;
      const k = turnEnv(t, 1.2, 0.26, 0.3);
      const turn = clampAbs(rel, 2.09) * 0.85;
      f[CH.twist] = turn * k;
      f[CH.lookX] = clampAbs((rel - turn) * 0.9, 1) * sat(k);
      const s = sideOf(rel);
      const w = sat(k) * Math.sin(TAU * 3.2 * t);
      const up = sat(k);
      arm(p, s, 0.35 * up, 1.15 + 1.35 * up + 0.28 * w, 0.3 * w, 1 + 1.4 * up);
      arm(p, -s, 0.2, 1.1, 0.3, 1);
      f[CH.roll] = -0.05 * s * w; f[CH.blush] = 1;
      f[CH.sq] = 0.05 * hump(t, 0.3);
    },
  },
  /**
   * The paper plane (T prompt) arrives: eyes up, a stretchy noodle snatch overhead (smear, held on twos at the catch),
   * a squash when it lands in the mitten, then it flows into `readNote`.
   */
  catchPlane: {
    id: 'catchPlane', dur: 1.25, mask: HOLD | M.PROP, face: 'surprised', smear: true, twos: [[0.38, 0.56]], next: 'readNote',
    update(t, p, a) {
      const f = p.f;
      const crown = a?.crown ?? 0.6;
      const reachUp = ramp(t, 0.12, 0.28);
      const down = ramp(t, 0.62, 0.5);
      const catchT = 0.42;
      const len = Math.max(1.2, ((crown + 0.25) - 0.29) / 0.065 * 0.95);
      // right arm: rest → overhead snatch → down to the chest (straight noodle, so the mitten is known by FK below)
      const pitch = 0.25 * reachUp + (1.25 - 0.25) * down;
      const raise = 1.15 + 1.8 * reachUp - (2.95 - 0.75) * down;
      const ln = 1 + (len - 1) * reachUp - (len - 2.2) * down;
      arm(p, 1, pitch, raise, 0, ln);
      arm(p, -1, 0.3 * reachUp * (1 - down), 1.15 + 0.4 * reachUp * (1 - down), 0.4, 1);
      f[CH.lookY] = 0.9 * reachUp * (1 - down) - 0.3 * down; f[CH.lookX] = 0.25 * reachUp * (1 - down);
      f[CH.pitch] = -0.16 * reachUp * (1 - down);
      f[CH.sq] = 0.12 * reachUp * (1 - down) - 0.18 * hump(t - catchT, 0.25);
      f[CH.hipY] = (a?.seated ? 0.05 : 0.09) * hump(t - 0.2, 0.4);
      if (t > catchT) {
        // the dart sits in the mitten (FK of the straight arm), nose forward, wings up; it steadies as it comes down
        const h = handFK(1, pitch, raise, ln, 0.06);
        p.prop = 'note';
        f[CH.propA] = 0.1 * down;
        f[CH.propX] = h.x; f[CH.propY] = h.y; f[CH.propZ] = h.z + 0.02;
        f[CH.propRx] = Math.PI / 2 - 0.4 * down; f[CH.propRy] = -0.5 * (1 - down); f[CH.propRz] = 0.25 * Math.sin(t * 14) * (1 - down);
      }
      if (a?.seated) seatLegs(f, 0.2 * reachUp);
    },
  },
  /**
   * Unfold the caught plane into a sheet held in both mittens, eyes scan it line by line, a little "!" and a
   * determined nod, then it is tucked away (the prompt is now work: BRN/FX turn the ring working-blue).
   */
  readNote: {
    id: 'readNote', dur: 2.4, mask: HOLD | M.PROP, face: 'focused',
    update(t, p, a) {
      const f = p.f;
      const unfold = ramp(t, 0.0, 0.45);
      const tuck = ramp(t, 2.0, 0.3);
      p.prop = tuck < 0.95 ? 'note' : null;
      f[CH.propA] = unfold; // 0 folded dart → 1 flat sheet
      // held low (the sheet's top edge under the eyes) and tipped back toward the face, like a newspaper
      const y = 0.26 - 0.08 * unfold - 0.2 * tuck, z = 0.36 + 0.04 * unfold;
      f[CH.propX] = 0.22 * (1 - unfold); f[CH.propY] = y; f[CH.propZ] = z;
      f[CH.propRx] = (Math.PI / 2 - 0.3) * (1 - unfold) - 0.55 * unfold; f[CH.propRy] = 0; f[CH.propRz] = 0;
      // both mittens on the sheet's side edges
      reach(p, 1, 0.14 + 0.08 * (1 - unfold), y - 0.02, z - 0.03, 1);
      reach(p, -1, -0.14, y - 0.02, z - 0.03, unfold);
      // reading: the eyes sweep each line left → right, dropping a line each sweep
      const r = sat((t - 0.45) / 1.2);
      const line = Math.floor(r * 3), u = r * 3 - line;
      f[CH.lookX] = r > 0 && r < 1 ? -0.6 + 1.2 * u : 0;
      f[CH.lookY] = -0.35 - 0.12 * line;
      f[CH.pitch] = 0.08;
      // "!" + nod at 1.7 s
      const aha = hump(t - 1.65, 0.3);
      f[CH.hipY] = 0.03 * aha; f[CH.eyeS] = 1 + 0.25 * aha; f[CH.sq] = 0.06 * aha - 0.05 * hump(t - 1.9, 0.2);
      f[CH.pitch] += 0.18 * hump(t - 1.9, 0.25);
      if (t > 1.65) { f[CH.browA] = -0.5; f[CH.browOn] = 1; }
      if (a?.seated) seatLegs(f);
    },
  },
  /**
   * Patted (Q): squished flat from above, a jelly wobble back up, ^_^ eyes and a blush. Body + face only, so a worker
   * keeps typing through it (§6.9). [CHR fix m3-r1] (fun review: a pat on a worker read as an angry full turn) plus a
   * happy glance over the shoulder at the player: the body (Clawd's head) turns ≤ PAT_TURN, the squinting ^_^ eyes do
   * the rest (≤ 40° together), so it never leaves the desk. The grumpy "shh" glanceBack is BRN's pat-spam escalation.
   */
  patted: {
    id: 'patted', dur: 1.3, mask: BODY_FACE, face: 'happy',
    update(t, p, a) {
      const f = p.f;
      const press = t < 0.16 ? easeInOutCubic(t / 0.16) : 0;
      f[CH.sq] = t < 0.16 ? -0.3 * press : land(t - 0.16, 0.3, 3.4, 4.2);
      f[CH.hipY] = t < 0.16 ? -0.02 * press : 0;
      f[CH.roll] = 0.07 * Math.sin(TAU * 2.2 * t) * Math.exp(-t * 2);
      const rel = a?.viewRel ?? 0;
      const k = turnEnv(t, 1.3, 0.3, 0.35);
      const turn = clampAbs(rel, PAT_TURN);
      f[CH.twist] = turn * k;
      f[CH.lookX] = clampAbs((rel - turn) * 0.9, PAT_EYES) * sat(k); f[CH.lookY] = 0.12 * sat(k);
      p.eye = t < 1.1 ? 'arc' : null; p.mouth = 'smile';
      f[CH.blush] = 1;
    },
  },
  /**
   * Summoned (R) and free to come: perk up with a hop and turn toward the player, a big two-arm "coming!" wave, then
   * lean into the trot (BRN starts the walk as it ends).
   */
  summoned: {
    id: 'summoned', dur: 1.4, mask: MASK_ALL, face: 'happy',
    update(t, p, a) {
      const f = p.f;
      const rel = a?.viewRel ?? 0;
      const j = jump(t, { crouch: 0.1, air: 0.3, h: 0.14, depth: 0.16, stretch: 0.2, landAmp: 0.2 });
      f[CH.hipY] = j.y; f[CH.sq] = j.sq;
      const k = turnEnv(t, 1.4, 0.3, 0.15);
      f[CH.twist] = clampAbs(rel, 1.2) * 0.7 * sat(k);
      f[CH.lookX] = clampAbs(rel * 0.8, 1) * sat(k);
      const wv = ramp(t, 0.15, 0.15) * (1 - ramp(t, 1.05, 0.25));
      const w = Math.sin(TAU * 2.8 * t);
      arm(p, 1, 0.25 * wv, 1.15 + 1.45 * wv + 0.25 * w * wv, 0.3 * w * wv, 1 + 1.6 * wv);
      arm(p, -1, 0.25 * wv, 1.15 + 1.45 * wv - 0.25 * w * wv, -0.3 * w * wv, 1 + 1.6 * wv);
      f[CH.pitch] = 0.18 * ramp(t, 1.15, 0.2); // lean into the trot
      if (j.phase === 'air') legsTuck(f, Math.sin(j.u * Math.PI));
      p.eye = t > 0.1 && t < 0.4 ? 'star' : null;
    },
  },
  /**
   * Summoned while working (§6.9: "turns, waves, holds up a busy finger; stays"): swivel toward the player, a quick
   * wave, then the finger up with an apologetic lid-squint, back to work.
   */
  summonBusy: {
    id: 'summonBusy', dur: 2.0, mask: HOLD, face: null,
    update(t, p, a) {
      const f = p.f;
      const rel = a?.viewRel ?? 0;
      const k = turnEnv(t, 2.0, 0.3, 0.35);
      const turn = clampAbs(rel, 1.9) * 0.75;
      f[CH.twist] = turn * k; f[CH.lookX] = clampAbs((rel - turn) * 0.9, 1) * sat(k);
      const s = sideOf(rel);
      const wv = ramp(t, 0.2, 0.15) * (1 - ramp(t, 0.8, 0.2));
      const w = Math.sin(TAU * 3 * t);
      arm(p, s, 0.3 * wv, 1.15 + 1.3 * wv + 0.25 * w * wv, 0.3 * w * wv, 1 + 1.3 * wv);
      const fin = ramp(t, 0.85, 0.2) * (1 - ramp(t, 1.6, 0.3));
      if (fin > 0) arm(p, -s, 0.7 * fin, 1.15 + 1.0 * fin, 0.9 * fin, 1 + 0.9 * fin);
      if (wv <= 0 && fin <= 0) arm(p, s, 0.2, 1.1, 0.3, 1);
      f[CH.roll] = 0.08 * Math.sin(TAU * 4 * t) * fin;
      f[CH.lid] = 0.3 * fin; f[CH.browA] = 0.35 * fin; f[CH.browOn] = fin;
      p.mouth = wv > 0.5 ? 'smile' : fin > 0.5 ? 'wobble' : null;
      if (a?.seated) seatLegs(f);
    },
  },
  /**
   * Arrival in a parcel crate (§11.5 spectacular arrivals; BRN places the actor where the crate lands): the closed
   * crate rattles twice, the lid flaps burst open, the Clawd springs out as the walls fall flat, "ta-da" + a wave,
   * and the crate shrinks away. The crate is a root-level rig node (it stays on the floor while the body hops).
   */
  crateUnwrap: {
    id: 'crateUnwrap', dur: 2.45, mask: MASK_ALL, face: 'happy', smear: true, twos: [[0.9, 1.1]],
    update(t, p) {
      const f = p.f;
      const burst = 0.9;
      f[CH.crate] = 1 - ramp(t, 1.9, 0.3);
      f[CH.crateShake] = t < burst ? 0.09 * (hump(t - 0.15, 0.22) * Math.sin(t * 60) + hump(t - 0.5, 0.25) * Math.sin(t * 55)) : 0;
      f[CH.crateLid] = easeOutBack(sat((t - burst) / 0.2));
      f[CH.crateO] = easeInOutCubic(sat((t - burst - 0.12) / 0.35));
      if (t < burst) {
        // hidden inside: tucked small and low (the rattles are it wriggling)
        f[CH.grow] = 0.55; f[CH.hipY] = -0.1; f[CH.sq] = -0.2 + 0.05 * Math.sin(t * 40) * hump(t - 0.15, 0.6);
        arm(p, -1, 0, 0.6, 0, 1); arm(p, 1, 0, 0.6, 0, 1);
        p.eye = 'closed';
        return;
      }
      const j = jump(t - burst, { crouch: 0.02, air: 0.5, h: 0.55, depth: 0.05, stretch: 0.3, landAmp: 0.3 });
      f[CH.grow] = 0.55 + 0.45 * easeOutBack(sat((t - burst) / 0.3));
      f[CH.hipY] = j.y - 0.1 * (1 - sat((t - burst) / 0.15)); f[CH.sq] = j.sq;
      if (j.phase === 'air') legsTuck(f, Math.sin(j.u * Math.PI));
      const ta = sat((t - burst) / 0.12) * (1 - ramp(t, 1.75, 0.2));
      arm(p, -1, 0.15, 1.15 + 1.2 * ta, 0, 1 + 1.2 * ta);
      const wv = ramp(t, 1.75, 0.15);
      const w = Math.sin(TAU * 2.6 * t);
      arm(p, 1, 0.15 + 0.15 * wv, 1.15 + 1.2 * ta + wv * (1.35 + 0.3 * w), 0.3 * w * wv, 1 + 1.2 * ta + 1.4 * wv);
      p.eye = t < burst + 0.6 ? 'star' : null;
      f[CH.blush] = 1;
    },
  },
  /** Cheer (rallies, slide landings, inbox zero): arms pumping a V overhead on two hops, grin, star eyes. */
  cheer: {
    id: 'cheer', dur: 1.6, mask: HOLD, face: 'celebrate',
    update(t, p, a) {
      const f = p.f;
      const u = t % 0.72, n = Math.floor(t / 0.72);
      const j = jump(u, { crouch: 0.1, air: 0.3, h: a?.seated ? 0.07 : 0.14, depth: 0.16, stretch: 0.16, landAmp: 0.18 });
      f[CH.hipY] = n < 2 ? j.y : 0; f[CH.sq] = n < 2 ? j.sq : land(t - 1.44, 0.12);
      const k = sat(t / 0.12) * sat((1.6 - t) / 0.3);
      const pump = Math.sin(TAU * 2.8 * t);
      arm(p, -1, 0.05, 1.15 + (1.5 + 0.18 * pump) * k, 0.1, 1 + 1.9 * k);
      arm(p, 1, 0.05, 1.15 + (1.5 - 0.18 * pump) * k, 0.1, 1 + 1.9 * k);
      f[CH.roll] = 0.06 * pump * k;
      p.mouth = 'grin';
      if (a?.seated) seatLegs(f, 0.3 * k * Math.max(0, pump));
    },
  },
};
Object.assign(REACTIONS, MANAGE_REACTIONS);

export const reaction = (id: string): Reaction | null => REACTIONS[id] ?? null;
