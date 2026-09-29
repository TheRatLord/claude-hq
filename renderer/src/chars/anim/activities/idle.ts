// @pure
/** Idle / done activities: lounge, sleepDesk, sitIdle, standIdle, confused. Owner: CHR. */
import { CH, MASK_ALL } from '../pose.ts';
import { reach, arm } from '../ik.ts';
import { noise1 } from '../noise.ts';
import { sitBase, TAU, STAND, hold, hump, sat, saw, snap, hopCurve } from './common.ts';
import type { Activity } from './index.ts';

/** Lounging (sofa / Pit): hands behind the head, legs kicking; every ~9 s a slurp of cocoa. */
export const lounge: Activity = {
  id: 'lounge', mask: MASK_ALL, sit: true, face: 'happy',
  update(t, p, a) {
    const f = p.f;
    sitBase(p, t * 0.8, 1.4);
    f[CH.pitch] = -0.3 + 0.03 * Math.sin(t * 0.9);
    f[CH.hipZ] = -0.04;
    f[CH.roll] = 0.06 * Math.sin(TAU * 0.25 * t);
    f[CH.lookX] = 0.3 * noise1(t * 0.3, a.seed);
    f[CH.lookY] = 0.3;
    const u = (t + (a.seed % 9)) % 9;
    const sip = u > 6 ? hump(u - 6, 3) : 0;
    if (sip > 0.02) {
      const lift = sat(sip * 1.6);
      hold(p, 'mug', 0.02 + 0.06 * (1 - lift), 0.16 + 0.1 * lift, 0.36 - 0.06 * lift, 0, 0, -0.9 * lift * lift);
      reach(p, 1, 0.03 + 0.06 * (1 - lift), 0.16 + 0.1 * lift, 0.36 - 0.06 * lift);
      arm(p, -1, -0.45, 2.35, 1.1, 2.2);
      f[CH.pitch] += 0.25 * lift;
      if (lift > 0.85) { p.eye = 'arc'; f[CH.blush] = 1; }
    } else {
      arm(p, -1, -0.45, 2.35, 1.1, 2.2); // elbows out, hands tucked behind the head
      arm(p, 1, -0.45, 2.35, 1.1, 2.2);
    }
  },
};

export const sleepDesk: Activity = {
  id: 'sleepDesk', mask: MASK_ALL, sit: true, face: 'sleepy',
  update(t, p, a) {
    const f = p.f;
    sitBase(p, t * 0.3, 0.3);
    const br = Math.sin(TAU * 0.2 * t);
    f[CH.pitch] = 0.55 + 0.03 * br;
    f[CH.hipZ] = 0.06;
    f[CH.sq] = -0.12 + 0.05 * br; // flattened, slow breath (±5 % at 0.2 Hz)
    f[CH.roll] = 0.05;
    for (let side = -1; side <= 1; side += 2) reach(p, side, side * 0.2, 0.3, 0.33);
    f[CH.mouthS] = 0.8 + 0.4 * Math.max(0, br);
  },
};

export const sitIdle: Activity = {
  id: 'sitIdle', mask: MASK_ALL, sit: true, face: 'neutral',
  update(t, p, a) {
    const f = p.f;
    sitBase(p, t, 1);
    f[CH.twist] = 0.25 * Math.sin(TAU * 0.11 * t + a.seed); // chair swivel
    f[CH.roll] = 0.03 * Math.sin(TAU * 0.3 * t);
    f[CH.lookX] = 0.6 * noise1(t * 0.35, a.seed);
    f[CH.lookY] = 0.15 * noise1(t * 0.3, a.seed + 1);
    const c = t % 8;
    if (c > 5.5 && c < 7) {
      // Big stretch, arms overhead.
      const k = Math.sin(((c - 5.5) / 1.5) * Math.PI);
      arm(p, -1, 0.1 * k, 1.15 + 1.4 * k, 0, 1 + 1.8 * k);
      arm(p, 1, 0.1 * k, 1.15 + 1.4 * k, 0, 1 + 1.8 * k);
      f[CH.sq] = 0.1 * k;
      f[CH.pitch] = -0.1 * k;
      p.eye = k > 0.5 ? 'closed' : null;
    }
  },
};

export const standIdle: Activity = {
  id: 'standIdle', mask: 0, sit: false, face: null,
  update() {},
};

/**
 * [CHR M3.5] Portrait poses (portraits.ts): a compact head-and-shoulders silhouette that fits a square tile — mittens
 * tucked in at the sides (no wide nubs), eyes to camera. `portraitAlert` (blocked) raises one mitten beside the face,
 * a compact "hey!" that stays inside the tile.
 */
export const portrait: Activity = {
  id: 'portrait', mask: MASK_ALL, sit: false, face: null,
  update(t, p) {
    const f = p.f;
    arm(p, -1, 0.35, 0.55, 0.5, 1); arm(p, 1, 0.35, 0.55, 0.5, 1);
    f[CH.lookX] = -0.2; f[CH.lookY] = 0.05;
  },
};
export const portraitAlert: Activity = {
  id: 'portraitAlert', mask: MASK_ALL, sit: false, face: null,
  update(t, p) {
    const f = p.f;
    arm(p, -1, 0.35, 0.55, 0.5, 1);
    arm(p, 1, 0.45, 2.2, 1.2, 1.3);
    f[CH.roll] = -0.05; f[CH.lookX] = -0.2; f[CH.lookY] = 0.1;
  },
};

export const confused: Activity = {
  id: 'confused', mask: MASK_ALL, sit: false, face: 'worried',
  update(t, p, a) {
    const f = p.f;
    const s = Math.sin(TAU * 0.35 * t);
    f[CH.roll] = 0.18 * s;
    arm(p, -1, 0.5, 1.45, 0.4, 1);
    arm(p, 1, 0.5, 1.45, 0.4, 1);
    f[CH.lookX] = Math.sign(Math.sin(TAU * 0.5 * t)) * 0.7;
    f[CH.lookY] = 0.2;
    f[CH.sq] = 0.02 * Math.sin(TAU * 0.7 * t);
  },
};

/** Standing done-lounge: leaning back, hands behind the head, a happy sway and a little heel bounce. */
export const standLounge: Activity = {
  id: 'standLounge', mask: STAND, sit: false, face: 'happy',
  update(t, p) {
    const f = p.f;
    arm(p, -1, -0.45, 2.35, 1.1, 2.2); arm(p, 1, -0.45, 2.35, 1.1, 2.2);
    f[CH.pitch] = -0.14 + 0.03 * Math.sin(t * 0.9);
    f[CH.roll] = 0.08 * Math.sin(TAU * 0.3 * t);
    f[CH.hipY] = 0.012 * Math.max(0, Math.sin(TAU * 0.6 * t));
    f[CH.lookY] = 0.25;
  },
};

/** Bunk nap: lying on its side, curled, slow breathing. */
export const sleepBunk: Activity = {
  id: 'sleepBunk', mask: MASK_ALL, sit: true, face: 'sleepy',
  update(t, p) {
    const f = p.f;
    const br = Math.sin(TAU * 0.2 * t);
    f[CH.roll] = 1.32; f[CH.hipX] = -0.16; f[CH.hipY] = -0.1;
    f[CH.sq] = -0.1 + 0.05 * br;
    for (let i = 0; i < 4; i++) { f[CH.l0s + i * 2] = 0.9; f[CH.l0y + i * 2] = 0.02; }
    arm(p, -1, 1.1, 0.6, 0.8, 1); arm(p, 1, 1.2, 0.5, 1.0, 1);
    f[CH.mouthS] = 0.8 + 0.4 * Math.max(0, br);
  },
};

/** Archive vault nap: curled up on the floor, flattened, breathing. */
export const vaultNap: Activity = {
  id: 'vaultNap', mask: MASK_ALL, sit: false, face: 'sleepy',
  update(t, p) {
    const f = p.f;
    const br = Math.sin(TAU * 0.2 * t);
    f[CH.hipY] = -0.13; f[CH.sq] = -0.2 + 0.05 * br; f[CH.pitch] = 0.2; f[CH.roll] = 0.08;
    for (let i = 0; i < 4; i++) { f[CH.l0s + i * 2] = i < 2 ? 1.4 : -1.2; f[CH.l0y + i * 2] = 0.04; }
    arm(p, -1, 0.9, 0.5, 0.6, 1); arm(p, 1, 0.9, 0.5, 0.6, 1);
    f[CH.mouthS] = 0.8 + 0.4 * Math.max(0, br);
  },
};

/** Coffee (standing): sips every ~4 s with a blissful squint; bounces on its heels in between. */
export const coffee: Activity = {
  id: 'coffee', mask: STAND, sit: false, face: 'happy', prop: 'mug',
  update(t, p, a) {
    const f = p.f;
    const u = (t + (a.seed % 4)) % 4;
    const lift = u > 2.6 ? sat(hump(u - 2.6, 1.4) * 1.6) : 0;
    const x = 0.06 + 0.06 * (1 - lift), y = 0.2 + 0.06 * lift, z = 0.36 - 0.04 * lift;
    hold(p, 'mug', x, y, z, 0, 0, -0.9 * lift * lift);
    reach(p, 1, x, y, z);
    reach(p, -1, x - 0.02, y - 0.06, z - 0.02, 1 - lift);
    if (lift < 0.01) arm(p, -1, 0.3, 1.0, 0.5, 1);
    f[CH.pitch] = -0.1 * lift; f[CH.lookY] = -0.3 * lift + 0.2 * (1 - lift);
    if (lift > 0.8) { p.eye = 'arc'; f[CH.blush] = 1; }
    f[CH.hipY] = 0.015 * Math.max(0, Math.sin(TAU * 0.9 * t)) * (1 - lift);
    const ah = u < 0.5 ? hump(u, 0.5) : 0; // "aaah" after the sip
    f[CH.sq] = -0.06 * ah; f[CH.roll] = 0.04 * Math.sin(TAU * 0.35 * t);
  },
};

/** Window gazing: hands behind the back, rocking heel-to-toe, a long sigh; sometimes a spyglass peek. */
export const windowGaze: Activity = {
  id: 'windowGaze', mask: STAND, sit: false, face: 'neutral',
  update(t, p, a) {
    const f = p.f;
    const u = (t + (a.seed % 13)) % 13;
    if (u > 9.5) {
      const k = hump(u - 9.5, 3.5);
      hold(p, 'spyglass', 0.08, 0.36, 0.34, 0, 0, 0);
      reach(p, 1, 0.12, 0.34, 0.3); reach(p, -1, -0.02, 0.34, 0.42);
      f[CH.pitch] = -0.05; f[CH.lookY] = 0.2; f[CH.lookX] = 0.2;
      p.eye = k > 0.3 ? 'closed' : null;
      f[CH.twist] = 0.2 * Math.sin((u - 9.5) * 1.2);
      return;
    }
    arm(p, -1, -0.7, 0.55, 1.0, 1); arm(p, 1, -0.7, 0.55, 1.0, 1);
    f[CH.pitch] = 0.05 * Math.sin(TAU * 0.3 * t);
    f[CH.hipY] = 0.01 * Math.max(0, Math.sin(TAU * 0.3 * t));
    const sigh = u > 6 && u < 8 ? hump(u - 6, 2) : 0;
    f[CH.sq] = 0.08 * sigh - 0.05 * Math.max(0, hump(u - 7.3, 0.7));
    f[CH.lookY] = 0.35; f[CH.lookX] = 0.4 * noise1(t * 0.2, a.seed);
    f[CH.lid] = 0.25 + 0.2 * sigh;
  },
};

/** Arcade: joystick wiggle + button mashing; every 6 s a win (leap, arms up) or a loss (slump), alternating. */
export const arcade: Activity = {
  id: 'arcade', mask: STAND, sit: false, face: 'determined', smear: true,
  update(t, p, a) {
    const f = p.f;
    const u = t % 6, round = Math.floor(t / 6);
    if (u < 4.6) {
      reach(p, -1, -0.14 + 0.04 * Math.sin(TAU * 3 * t), 0.36 + 0.03 * Math.cos(TAU * 3 * t), 0.44);
      reach(p, 1, 0.14, 0.36 + 0.05 * Math.max(0, Math.sin(TAU * 7 * t)), 0.44);
      f[CH.hipY] = 0.02 * Math.abs(Math.sin(TAU * 2 * t)); f[CH.roll] = 0.08 * Math.sin(TAU * 1.5 * t);
      f[CH.pitch] = 0.12; f[CH.lookY] = 0.2; f[CH.lookX] = 0.3 * Math.sin(t * 4);
      f[CH.browA] = -0.4;
    } else if (round % 2 === 0) {
      const h = hopCurve(u - 4.6, 0.45, 0.22, 0.1);
      f[CH.hipY] = h.y; f[CH.sq] = h.sq;
      arm(p, -1, 0.1, 2.6, 0, 2.4); arm(p, 1, 0.1, 2.6, 0, 2.4);
      p.face = 'celebrate';
    } else {
      const k = hump(u - 4.6, 1.4);
      f[CH.sq] = -0.2 * k; f[CH.pitch] = 0.35 * k;
      arm(p, -1, 0.3, 0.3, 0, 1.4); arm(p, 1, 0.3, 0.3, 0, 1.4);
      p.face = 'worried';
    }
  },
};

/** Ping-pong: forehand swings with a hop and a twist; the ball arcs off the paddle. */
export const pingpong: Activity = {
  id: 'pingpong', mask: STAND, sit: false, face: 'determined', prop: 'paddle', smear: true,
  update(t, p, a) {
    const f = p.f;
    // [BRN cross-owner] in a rally (social.ts) the swing keeps the shared clock and the real ball crosses the table:
    // propA −1 hides the paddle's own practice ball
    const u = a.sync ?? saw(t, 0.9);
    const sw = u < 0.35 ? -snap(u / 0.35, 1) : u < 0.5 ? -1 + 2 * snap((u - 0.35) / 0.15, 1.5) : 1 - (u - 0.5) * 2;
    const x = 0.2 + 0.14 * sw, y = 0.34 + 0.04 * sw, z = 0.3 + 0.14 * Math.max(0, sw);
    hold(p, 'paddle', x, y, z, -0.3, 0.6 * sw, -0.4);
    f[CH.propA] = a.sync == null ? u : -1;
    reach(p, 1, x, y, z);
    arm(p, -1, 0.4, 1.3, 0.5, 1);
    f[CH.twist] = 0.35 * sw; f[CH.roll] = -0.05 * sw;
    const h = hopCurve(u * 0.9 % 0.9, 0.25, 0.04, 0.05);
    f[CH.hipY] = h.y; f[CH.sq] = h.sq * 0.6;
    f[CH.lookX] = 0.6 * Math.sin(u * TAU); f[CH.lookY] = 0.2;
  },
};

/** Foosball: both hands on the rods, twisting frantically, whole body shimmying. */
export const foosball: Activity = {
  id: 'foosball', mask: STAND, sit: false, face: 'determined',
  update(t, p) {
    const f = p.f;
    for (let side = -1; side <= 1; side += 2) reach(p, side, side * 0.22, 0.3 + 0.03 * Math.sin(TAU * 5 * t + side), 0.44 + 0.06 * Math.sin(TAU * 3.3 * t + side * 2));
    f[CH.twist] = 0.14 * Math.sin(TAU * 3.3 * t); f[CH.roll] = 0.06 * Math.sin(TAU * 5 * t);
    f[CH.pitch] = 0.2; f[CH.lookX] = 0.8 * Math.sin(TAU * 0.7 * t); f[CH.lookY] = -0.4;
    const goal = t % 7;
    if (goal > 6.2) { const k = hump(goal - 6.2, 0.8); f[CH.hipY] = 0.12 * k; f[CH.sq] = 0.14 * k; p.face = 'celebrate'; arm(p, 1, 0.1, 2.5 * k + 1, 0, 2); }
  },
};

/** Watering plants: tipping the can, humming (bounce), happy. */
export const waterPlants: Activity = {
  id: 'waterPlants', mask: STAND, sit: false, face: 'happy', prop: 'wateringCan',
  update(t, p) {
    const f = p.f;
    const tip = 0.5 + 0.5 * Math.sin(TAU * 0.25 * t);
    hold(p, 'wateringCan', 0.08, 0.4, 0.32, 0.9 * tip, 0.2, 0);
    reach(p, 1, 0.08, 0.38, 0.32); reach(p, -1, -0.02, 0.3, 0.4, 0.7);
    f[CH.pitch] = 0.1 + 0.08 * tip; f[CH.lookY] = -0.5; f[CH.lookX] = 0.3;
    f[CH.hipY] = 0.012 * Math.abs(Math.sin(TAU * 1.2 * t)); f[CH.roll] = 0.06 * Math.sin(TAU * 0.6 * t);
    p.mouth = 'smile';
  },
};
export const waterGreenhouse = { ...waterPlants, id: 'waterGreenhouse' };

/** Petting the cat: crouched low, patting, heart eyes. */
export const petCat: Activity = {
  id: 'petCat', mask: MASK_ALL, sit: false, face: 'love',
  update(t, p) {
    const f = p.f;
    const pat = Math.max(0, Math.sin(TAU * 1.6 * t));
    f[CH.hipY] = -0.05; f[CH.sq] = -0.14; f[CH.pitch] = 0.35;
    for (let i = 0; i < 4; i++) { f[CH.l0s + i * 2] = i < 2 ? 0.5 : -0.3; }
    reach(p, 1, 0.1, 0.02 + 0.06 * pat, 0.5);
    arm(p, -1, 0.6, 1.0, 0.4, 1);
    f[CH.lookY] = -0.8; f[CH.roll] = 0.08 * Math.sin(TAU * 0.4 * t);
  },
};

/** Fish tank: face right up to the glass, eyes following a fish, mouth going "o" like a fish. */
export const fishStare: Activity = {
  id: 'fishStare', mask: STAND, sit: false, face: 'surprised',
  update(t, p, a) {
    const f = p.f;
    const fish = Math.sin(TAU * 0.18 * t + a.seed) + 0.3 * Math.sin(TAU * 0.7 * t);
    f[CH.pitch] = 0.18; f[CH.hipZ] = 0.08;
    f[CH.lookX] = 0.9 * fish; f[CH.lookY] = 0.1 * Math.sin(t * 0.9);
    f[CH.twist] = 0.12 * fish;
    arm(p, -1, 1.2, 1.3, 0.4, 1.8); arm(p, 1, 1.2, 1.3, 0.4, 1.8); // hands on the glass
    p.mouth = saw(t, 1.4) < 0.5 ? 'o' : null;
    f[CH.mouthS] = 0.7 + 0.5 * hump(saw(t, 1.4), 0.5);
  },
};

/** "still here?" sign held up high (≥ 6 h idle, player within 4 m). */
export const holdSign: Activity = {
  id: 'holdSign', mask: STAND, sit: false, face: 'worried', prop: 'sign',
  update(t, p) {
    const f = p.f;
    const b = Math.sin(TAU * 0.9 * t);
    hold(p, 'sign', 0.02, 0.3 + 0.03 * b, 0.34, 0, 0, 0.06 * b);
    reach(p, 1, 0.04, 0.36 + 0.03 * b, 0.34); reach(p, -1, 0.0, 0.3 + 0.03 * b, 0.36);
    f[CH.hipY] = 0.02 * Math.max(0, b); f[CH.lookY] = 0.2;
    f[CH.roll] = 0.05 * b;
  },
};

/** Piano: both hands bouncing across the keys, swaying, eyes closed in the good bits. */
export const piano: Activity = {
  id: 'piano', mask: MASK_ALL, sit: true, face: 'happy',
  update(t, p, a) {
    const f = p.f;
    sitBase(p, t, 0.4);
    const sway = Math.sin(TAU * 0.4 * t);
    for (let side = -1; side <= 1; side += 2) {
      const run = 0.1 * Math.sin(TAU * 0.3 * t + side);
      reach(p, side, side * 0.14 + run, 0.22 + 0.05 * Math.max(0, Math.sin(TAU * (side > 0 ? 3 : 2.25) * t)), 0.4);
    }
    f[CH.roll] = 0.1 * sway; f[CH.pitch] = 0.1 + 0.05 * Math.max(0, Math.sin(TAU * 0.8 * t));
    if (Math.sin(TAU * 0.11 * t + a.seed) > 0.3) p.eye = 'arc';
  },
};

/** Treadmill: running in place, arms pumping, grim determination. */
export const treadmill: Activity = {
  id: 'treadmill', mask: MASK_ALL, sit: false, face: 'determined',
  update(t, p) {
    const f = p.f;
    const ph = TAU * 2.2 * t;
    for (let i = 0; i < 4; i++) {
      const lp = ph + (i === 0 || i === 3 ? 0 : Math.PI);
      f[CH.l0y + i * 2] = Math.max(0, Math.sin(lp)) * 0.07; f[CH.l0s + i * 2] = Math.cos(lp) * 0.7;
    }
    f[CH.hipY] = Math.abs(Math.sin(ph)) * 0.05; f[CH.sq] = (-0.6 + Math.abs(Math.sin(ph))) * 0.1;
    f[CH.pitch] = 0.22;
    const s = Math.sin(ph);
    arm(p, -1, 0.8 * s, 0.9, 1.0, 1); arm(p, 1, -0.8 * s, 0.9, 1.0, 1);
    f[CH.browA] = -0.3; f[CH.lookY] = 0.1;
  },
};

/** Board game: holding a pawn, a long think, then a triumphant move and a small hop. */
export const boardGame: Activity = {
  id: 'boardGame', mask: MASK_ALL, sit: true, face: 'focused', prop: 'pawn',
  update(t, p, a) {
    const f = p.f;
    sitBase(p, t, 0.7);
    const u = (t + a.seed % 6) % 6;
    let x = 0.2, y = 0.3, z = 0.3;
    if (u < 3.2) {
      reach(p, -1, -0.05, 0.2, 0.32); // chin in hand
      f[CH.roll] = -0.1; f[CH.lookY] = -0.4; f[CH.lookX] = 0.5 * Math.sin(u * 1.5);
      f[CH.lid] = 0.3;
    } else {
      const k = sat((u - 3.2) / 0.8);
      x = 0.2 - 0.18 * k; y = 0.3 + 0.12 * Math.sin(k * Math.PI) - 0.06 * k; z = 0.3 + 0.2 * k;
      reach(p, -1, -0.2, 0.22, 0.4);
      if (u > 4.1) { const h = hopCurve(u - 4.1, 0.3, 0.06, 0.06); f[CH.hipY] = h.y; f[CH.sq] = h.sq; p.face = 'happy'; }
      f[CH.lookY] = -0.5; f[CH.lookX] = -0.2;
    }
    hold(p, 'pawn', x, y, z);
    reach(p, 1, x + 0.02, y - 0.02, z - 0.03);
  },
};

/** Painting at the easel: dabbing brush strokes, then a step back to admire with a head tilt. */
export const paint: Activity = {
  id: 'paint', mask: STAND, sit: false, face: 'focused', prop: 'brush',
  update(t, p) {
    const f = p.f;
    const u = t % 5;
    if (u < 3.6) {
      const x = 0.12 * Math.sin(TAU * 0.7 * u), y = 0.38 + 0.08 * Math.sin(TAU * 1.9 * u);
      hold(p, 'brush', x + 0.06, y, 0.46, -1.1, 0, 0.2);
      reach(p, 1, x + 0.06, y - 0.03, 0.44);
      arm(p, -1, 0.3, 1.1, 0.6, 1);
      f[CH.pitch] = 0.1; f[CH.lookX] = x * 4; f[CH.lookY] = 0.3;
      f[CH.hipZ] = 0.03;
    } else {
      const k = hump(u - 3.6, 1.4);
      hold(p, 'brush', 0.3, 0.3, 0.2, 0, 0, 0.3);
      reach(p, 1, 0.3, 0.3, 0.2);
      reach(p, -1, -0.02, 0.2, 0.32);
      f[CH.hipZ] = -0.08 * k; f[CH.roll] = 0.2 * k; f[CH.lookY] = 0.3;
      p.face = 'happy';
    }
  },
};

/** Hammock: lying back, gently swinging, hands behind the head. */
export const hammock: Activity = {
  id: 'hammock', mask: MASK_ALL, sit: true, face: 'sleepy',
  update(t, p) {
    const f = p.f;
    sitBase(p, t * 0.3, 0.3);
    f[CH.pitch] = -0.95; f[CH.hipY] = -0.04; f[CH.hipZ] = -0.1;
    f[CH.roll] = 0.12 * Math.sin(TAU * 0.28 * t);
    arm(p, -1, -0.45, 2.35, 1.1, 2.2); arm(p, 1, -0.45, 2.35, 1.1, 2.2);
    f[CH.sq] = 0.03 * Math.sin(TAU * 0.2 * t);
  },
};

/**
 * Slide ride (mezzanine → atrium): a timed sequence the brain holds for SLIDE_S while the motor moves the root down
 * the chute: 0–0.5 s scoot into the sit, 0.5–2.2 s "wheee" (arms up, star eyes, wind wobble), 2.2–3.0 s tumble-roll
 * out (a full forward flip) and a splat landing, then a happy shake. Loops harmlessly on the shake.
 */
export const SLIDE_S = 3.4;
export const slideRide: Activity = {
  id: 'slideRide', mask: MASK_ALL, sit: false, face: 'celebrate', smear: true, twos: [[2.2, 3.0]],
  update(t, p) {
    const f = p.f;
    if (t < 0.5) {
      const k = snap(t / 0.5, 1.5);
      f[CH.hipY] = -0.08 * k; f[CH.sq] = -0.12 * k; f[CH.pitch] = -0.25 * k;
      for (let i = 0; i < 4; i++) f[CH.l0s + i * 2] = 1.2 * k;
      arm(p, -1, 0.4, 1.3, 0.4, 1); arm(p, 1, 0.4, 1.3, 0.4, 1);
      p.face = 'happy';
    } else if (t < 2.2) {
      const w = Math.sin(TAU * 4 * t);
      f[CH.hipY] = -0.08; f[CH.sq] = -0.08 + 0.03 * w; f[CH.pitch] = -0.4; f[CH.roll] = 0.08 * w;
      for (let i = 0; i < 4; i++) f[CH.l0s + i * 2] = 1.3 + 0.1 * w;
      arm(p, -1, 0.3, 2.7 + 0.1 * w, 0, 2.6); arm(p, 1, 0.3, 2.7 - 0.1 * w, 0, 2.6);
      p.mouth = 'o'; f[CH.mouthS] = 1.3;
    } else if (t < 3.0) {
      const u = (t - 2.2) / 0.8;
      f[CH.pitch] = -0.4 + (TAU + 0.4) * snap(u, 0.6);
      f[CH.hipY] = 0.25 * Math.sin(u * Math.PI);
      f[CH.sq] = u < 0.85 ? 0.1 : -0.3;
      arm(p, -1, 0, 2.2, 0, 1.5); arm(p, 1, 0, 2.2, 0, 1.5);
      p.eye = 'swirl';
    } else {
      const u = t - 3.0;
      f[CH.sq] = -0.25 * Math.exp(-u * 5) * Math.cos(u * 24);
      f[CH.roll] = 0.2 * Math.sin(TAU * 3 * u) * Math.exp(-u * 1.5); // happy shake
      arm(p, -1, 0.1, 2.3, 0, 2); arm(p, 1, 0.1, 2.3, 0, 2);
      p.face = 'happy';
    }
  },
};

/** Mezzanine hot desk: leaning on the rail, doodling on a clipboard, tongue-out concentration. */
export const hotDeskDoodle: Activity = {
  id: 'hotDeskDoodle', mask: STAND, sit: false, face: 'happy', prop: 'clipboard',
  update(t, p) {
    const f = p.f;
    hold(p, 'clipboard', 0, 0.3, 0.38, -1.1, 0, 0);
    f[CH.propA] = saw(t, 1.7); f[CH.propB] = saw(t, 0.3);
    reach(p, -1, -0.14, 0.3, 0.36);
    reach(p, 1, 0.02 + 0.05 * Math.sin(TAU * 1.7 * t), 0.36, 0.4 + 0.03 * Math.cos(TAU * 1.7 * t));
    f[CH.pitch] = 0.2; f[CH.lookY] = -0.7; f[CH.lookX] = 0.2 * Math.sin(TAU * 1.7 * t);
    f[CH.roll] = 0.08;
    p.mouth = 'smile';
  },
};

/** Archive microfiche: seated, cranking the reel knob and peering at the (world) screen, wide-eyed. */
export const microfiche: Activity = {
  id: 'microfiche', mask: MASK_ALL, sit: true, face: 'surprised',
  update(t, p) {
    const f = p.f;
    sitBase(p, t, 0.5);
    const c = TAU * 1.2 * t;
    reach(p, 1, 0.24 + 0.04 * Math.cos(c), 0.3 + 0.04 * Math.sin(c), 0.4);
    reach(p, -1, -0.16, 0.26, 0.42);
    f[CH.pitch] = 0.22; f[CH.hipZ] = 0.06;
    f[CH.lookY] = 0.1; f[CH.lookX] = -0.5 + saw(t, 1.2);
  },
};

/** Archive filing nook: reading a pulled drawer file, flipping it open; an "aha!" every so often. */
export const fileNook: Activity = {
  id: 'fileNook', mask: STAND, sit: false, face: 'focused', prop: 'folder',
  update(t, p, a) {
    const f = p.f;
    const u = (t + a.seed % 5) % 5;
    hold(p, 'folder', 0, 0.3, 0.34, -0.9, 0, 0);
    f[CH.propA] = 0.9 + 0.1 * Math.sin(t);
    reach(p, -1, -0.12, 0.26, 0.34); reach(p, 1, 0.12, 0.26, 0.34);
    f[CH.lookY] = -0.5; f[CH.lookX] = -0.5 + saw(t, 0.9);
    if (u > 4.2) { const k = hump(u - 4.2, 0.8); f[CH.hipY] = 0.06 * k; f[CH.sq] = 0.12 * k; f[CH.eyeS] = 1 + 0.3 * k; p.face = 'surprised'; }
  },
};
