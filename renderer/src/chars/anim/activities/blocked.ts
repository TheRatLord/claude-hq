// @pure
/** Blocked activities: waveBlocked (fresh, "hey!") and queueWait (impatient at the Help Desk). Owner: CHR. */
import { CH, MASK_ALL } from '../pose.ts';
import { reach, arm, ARM } from '../ik.ts';
import { hopCurve, TAU, STAND, hump, saw } from './common.ts';
import type { Activity } from './index.ts';

/** Back-out ease (0 → 1 with a ~12% overshoot past 1 before settling): the snap of each wave stroke. */
function backOut(u: number, c = 2.2): number { const k = u - 1; return 1 + (c + 1) * k * k * k + c * k * k; }

/**
 * [CHR fix r3] Wave stroke in [-1, 1] at `hz` strokes per second (one stroke = one side-to-side swing): each stroke
 * snaps across and overshoots its peak, then settles; alternating direction.
 */
export function waveStroke(t: number, hz: number): number {
  const x = t * hz, n = Math.floor(x), u = x - n;
  const dir = n % 2 ? -1 : 1;
  return dir * (-1 + 2 * backOut(Math.min(1, u / 0.7)));
}

/** Default crown (body + a typical hat) when the rig does not say (a.crown, shape frame). */
const CROWN0 = 0.8;
/** Clearance of the hands' bottoms over the crown (reviewer gate 0.15 m + margin for hop squash and the roll). */
const CLEAR = 0.28;
/**
 * [CHR fix m15-r2] Near the viewer (a.near → 1 inside the 3.5 m placard distance, fx/rules PLACARD_NEAR_M) the noodles
 * stretch less, so both hands stay in a close hero frame; the wave's roll and hop are trimmed there too, so the hands
 * still clear the hat by the 0.15 m gate.
 */
const CLEAR_NEAR = 0.23;
const HAND_R = 0.058;
/**
 * [CHR fix m3-r1] Close-up hop-and-wave (a.close → 1 with the camera inside ~2.6 m, animator CLOSE_M): the noodles
 * shorten to ≈ 0.5 m (hands up beside the hat, not a pole out of the top of the frame) and the hops and wrist whips grow
 * so it still reads as "hey! over here!".
 */
export const CLOSE_LEN = 7.5;
/** Blend a noodle length toward the close-up length (`close` 0..1). */
const closeLen = (len: number, close: number): number => len + (Math.min(len, CLOSE_LEN) - len) * close;

/**
 * Noodle length (forearm ×) that puts the hand's bottom `clear` over `crown` at arm raise `r` (π = straight up).
 * @param near 0 far … 1 inside the near-card distance
 */
export function upLen(crown: number, r: number, near = 0): number {
  const clear = CLEAR + (CLEAR_NEAR - CLEAR) * Math.min(1, Math.max(0, near));
  const L = (crown + clear + HAND_R - ARM.y) / Math.max(0.5, -Math.cos(r));
  return Math.max(1, (L - ARM.upper) / ARM.fore);
}

/**
 * Fresh blocked "hey! over here!" (ART §5.1 silhouette: noodle arms up over the head in EVERY frame). [CHR fix
 * m15-r1] BOTH arms go up in a V and wave in alternation (one snaps out while the other swings in), so the silhouette
 * reads from every side (a single raised arm hid behind the head / desk board from half the angles). The noodles
 * stretch to the rig's crown (`a.crown`: body + hat) so both hands stay ≥ 0.15 m above the hat top in every frame;
 * mouth wide open, impatient hops. No props: the action layer clears whatever the working activity held.
 */
export const waveBlocked: Activity = {
  id: 'waveBlocked', mask: MASK_ALL, sit: false, face: 'worried', clearProps: true,
  update(t, p, a) {
    const f = p.f;
    const w = waveStroke(t, 4.4); // alternating strokes
    const peak = Math.min(1, Math.max(0, Math.abs(w) - 0.9) / 0.4);
    const amp = Math.min(1.2, Math.max(0.6, a.amp));
    const crown = a.crown ?? CROWN0;
    const near = Math.min(1, Math.max(0, a.near ?? 0)), calm = 1 - 0.7 * near;
    const close = Math.min(1, Math.max(0, a.close ?? 0));
    // raise < π = the hand out on its own side; the V opens and closes arm by arm (wider close up: the short arms
    // flank the hat instead of crossing in front of it).
    const rc = 2.78 - 0.14 * close, ws = 0.2;
    const rL = rc + ws * w * amp, rR = rc - ws * w * amp;
    arm(p, -1, 0.1 - 0.05 * w, rL, -0.15 * w, closeLen(upLen(crown, Math.min(rL, 2.98), near) + 0.3 * calm * peak * (w > 0 ? 1 : 0), close));
    arm(p, 1, 0.1 + 0.05 * w, rR, 0.15 * w, closeLen(upLen(crown, Math.min(rR, 2.98), near) + 0.3 * calm * peak * (w < 0 ? 1 : 0), close));
    // [CHR fix m15-r2] noodle curve: the tips curl in over the head and whip with each stroke (the animator adds the
    // springy lag on top), so the long arms read as noodles, not rods. [CHR fix m3-r1] close up the mittens whip at
    // the wrist with each stroke instead.
    f[CH.aLc] = 0.45 + 0.35 * close * w; f[CH.aRc] = 0.45 - 0.35 * close * w;
    f[CH.roll] = -0.08 * w * amp * calm;
    f[CH.twist] = 0.08 * Math.sin(TAU * 1.5 * t);
    // Impatient hops every 1.1 s, plus a little stretch up with each wave peak.
    const h = hopCurve(t % 1.1, 0.26, 0.075 * calm + 0.075 * close, 0.07 + 0.03 * close);
    f[CH.hipY] = h.y * amp;
    f[CH.sq] = h.sq * amp * 0.4 + 0.03 * peak; // light squash: the whole shape frame (arms too) squashes
    for (let i = 0; i < 4; i++) f[CH.l0y + i * 2] = h.y > 0.01 ? 0.03 : 0;
    f[CH.lookY] = 0.25; f[CH.lookX] = 0.2 * Math.sin(t * 1.3);
    p.mouth = 'o'; // "hey!"
    f[CH.mouthS] = 1.1 + 0.25 * peak;
    if ((t % 1.6) < 0.3) p.face = 'surprised'; // worried → surprised pulses
  },
};

export const queueWait: Activity = {
  id: 'queueWait', mask: MASK_ALL, sit: false, face: 'worried', clearProps: true,
  update(t, p, a) {
    const f = p.f;
    const cyc = t % 4;
    // Foot tap.
    f[CH.l1y] = Math.max(0, Math.sin(TAU * 3 * t)) * 0.035;
    f[CH.l1s] = 0.2;
    f[CH.roll] = 0.04 * Math.sin(TAU * 1.5 * t);
    if (cyc < 1.4) {
      // Check the (imaginary) watch.
      const k = Math.min(1, cyc / 0.25) * Math.min(1, (1.4 - cyc) / 0.25);
      arm(p, -1, 1.25 * k, 1.15 - 0.6 * k, 1.1 * k, 1);
      f[CH.lookX] = -0.5 * k; f[CH.lookY] = -0.3 * k;
      f[CH.pitch] = 0.08 * k;
    } else if (cyc > 2.6 && cyc < 3.4) {
      const h = hopCurve(cyc - 2.6, 0.28, 0.07);
      f[CH.hipY] = h.y; f[CH.sq] = h.sq;
    }
    reach(p, 1, 0.25, 0.1, 0.12, 0.3);
  },
};

/**
 * [BRN fix r2] Queue hold between "hey!" waves (ART §5.1: the blocked silhouette, arm straight up, in every frame):
 * the noodle arm stays up with a slow sway and a hopeful little tiptoe stretch now and then, the other hand checks the
 * (imaginary) watch, the foot taps. Pairs with waveBlocked in the brain's queue loop.
 */
export const queueHandUp: Activity = {
  id: 'queueHandUp', mask: MASK_ALL, sit: false, face: 'worried', clearProps: true,
  update(t, p, a) {
    const f = p.f;
    const sway = Math.sin(TAU * 0.55 * t);
    const cyc = t % 5;
    // "Pick me": every 5 s a tiptoe stretch that pushes the raised hand higher.
    const tip = cyc > 3.2 && cyc < 4.2 ? Math.sin(((cyc - 3.2) / 1.0) * Math.PI) : 0;
    // [CHR fix m15-r2] the noodle reaches the same clearance over the hat as waveBlocked (was a fixed 5.6×, under a
    // tall hat), shorter near the viewer, with a lazy S-curl swaying against the arm
    const r = 2.95 + 0.1 * sway * a.amp + 0.08 * tip;
    // calm hold: near clearance; [CHR fix m3-r1] short close up (a.close)
    arm(p, 1, 0.08 + 0.05 * sway, r - 0.3 * (a.close ?? 0), 0.1 * sway, closeLen(upLen(a.crown ?? CROWN0, Math.min(r, 3.05), 1) + 0.4 * tip, a.close ?? 0));
    f[CH.aRc] = 0.2 + 0.3 * sway;
    f[CH.roll] = -0.05 * sway * a.amp - 0.04 * tip;
    f[CH.hipY] = 0.03 * tip;
    f[CH.sq] = 0.06 * tip + 0.015 * Math.sin(TAU * 1.1 * t);
    // Foot tap.
    f[CH.l1y] = Math.max(0, Math.sin(TAU * 3 * t)) * 0.03;
    f[CH.l1s] = 0.2;
    if (cyc < 1.3) {
      // Watch check with the free hand.
      const k = Math.min(1, cyc / 0.25) * Math.min(1, (1.3 - cyc) / 0.25);
      arm(p, -1, 1.25 * k, 1.15 - 0.6 * k, 1.1 * k, 1);
      f[CH.lookX] = -0.45 * k; f[CH.lookY] = -0.25 * k;
    } else {
      arm(p, -1, 0.15, 1.1 + 0.05 * sway, 0.2, 1);
      f[CH.lookY] = 0.12 + 0.1 * tip;
    }
  },
};

/**
 * NOW SERVING: the queue head steps up to the counter, both hands on it, up on tiptoe, bouncing with hopeful
 * anticipation; the arm shoots up again every few seconds so the blocked silhouette never goes away for long.
 */
export const serveStepUp: Activity = {
  id: 'serveStepUp', mask: STAND, sit: false, face: 'worried',
  update(t, p, a) {
    const f = p.f;
    const u = t % 3.2;
    const tip = 0.5 + 0.5 * Math.sin(TAU * 1.6 * t);
    f[CH.hipY] = 0.035 * tip; f[CH.sq] = 0.05 * tip; f[CH.pitch] = 0.12;
    reach(p, -1, -0.2, 0.46, 0.4);
    if (u > 2.2) {
      const k = hump(u - 2.2, 1);
      arm(p, 1, 0.1, 1.15 + 1.8 * k, 0.1, 1 + 4.5 * k);
      f[CH.hipY] += 0.04 * k;
    } else reach(p, 1, 0.2, 0.46, 0.4);
    f[CH.lookY] = 0.35; f[CH.lookX] = 0.15 * Math.sin(t * 1.3);
    f[CH.browOn] = 1; f[CH.browA] = 0.5;
  },
};

/** Holding the ticket up to the player and jabbing a finger at it ("this one! mine!"). */
export const pointTicket: Activity = {
  id: 'pointTicket', mask: STAND, sit: false, face: 'worried',
  update(t, p) {
    const f = p.f;
    const jab = Math.max(0, Math.sin(TAU * 2.2 * t)) ** 2;
    arm(p, -1, 0.5, 2.3, 0.2, 2.6); // ticket held up high (FX draws the ticket at this hand)
    reach(p, 1, -0.12 + 0.03 * jab, 0.62 + 0.04 * jab, 0.28 + 0.04 * jab);
    f[CH.roll] = 0.08; f[CH.hipY] = 0.02 * jab; f[CH.lookY] = 0.35; f[CH.lookX] = -0.2 * saw(t, 0.5);
  },
};
