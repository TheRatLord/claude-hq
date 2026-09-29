// @pure
/**
 * Desk activities (DESIGN §6.3/§6.5, ART §6.5): one per tool class, seated at a desk facing +z. The shape frame's
 * origin is the body's bottom centre; seated, the desk top sits at y ≈ 0.22 and the keyboard at z ≈ 0.36.
 * Exaggerated on purpose (ART §6.1 #6): working is frenzied, props are toy-sized and readable from across the room.
 * `smear` = stop-motion smears on fast parts, `twos` = key poses held on twos (DESIGN §6.3 stop-motion accents).
 * Owner: CHR.
 */
import { CH, MASK_ALL, type Pose } from '../pose.ts';
import { reach, arm } from '../ik.ts';
import { noise1 } from '../noise.ts';
import { sitBase, TAU, hold, hump, sat, saw, snap, STAND, grepGrip } from './common.ts';
import type { Activity, ActivityArgs } from './index.ts';

const DESK_Y = 0.22, KEY_Z = 0.36;
/** readBook: the held-up book's centre height in the shape frame (body top 0.54; the monitor line ≈ 0.5). */
const BOOK_UP = 0.6;
/** [CHR fix m3-r3] readBook walk-up: the book lowers to chest height (centre BOOK_LOW_Y) over this distance ramp (m). */
export const BOOK_LOW_FAR = 2.6, BOOK_LOW_NEAR = 1.9, BOOK_LOW_Y = 0.27, BOOK_LAP_Y = 0.07;

/** [CHR m2 r2 alloc] typing()'s per-hand tap envelopes (shared scratch, read right after the call; no closure). */
const TAPS = { l: 0, r: 0 };
/** Two-handed typing at `hz` with `lift` (m) key strikes; returns the per-hand tap envelopes {l, r}. */
function typing(p: Pose, t: number, a: ActivityArgs, hz: number, lift: number, spread = 0.16, jit = 0.035): { l: number; r: number } {
  const f = p.f;
  const sl = Math.max(0, Math.sin(TAU * hz * t)), sr = Math.max(0, Math.sin(TAU * hz * t + Math.PI));
  TAPS.l = sl * sl; TAPS.r = sr * sr;
  for (let side = -1; side <= 1; side += 2) {
    const x = side * spread + jit * noise1(t * 1.7, a.seed + side * 11);
    reach(p, side, x, DESK_Y + lift * (side > 0 ? TAPS.r : TAPS.l) * a.amp, KEY_Z + 0.02 * noise1(t * 1.1, a.seed + side));
  }
  f[CH.sq] = -0.02 * (TAPS.l + TAPS.r) * a.amp;
  return TAPS;
}

export const type: Activity = {
  id: 'type', mask: MASK_ALL, sit: true, face: 'focused',
  update(t, p, a) {
    const f = p.f;
    sitBase(p, t, 0.5);
    const tap = typing(p, t, a, 5, 0.05);
    f[CH.pitch] = 0.2 + 0.025 * (tap.l + tap.r) * a.amp;
    f[CH.hipZ] = 0.04;
    f[CH.roll] = 0.03 * noise1(t * 0.8, a.seed);
    f[CH.lookY] = -0.3;
    f[CH.lookX] = 0.45 * noise1(t * 0.9, a.seed + 5);
    // every ~6 s: a satisfied little enter-key slam
    const u = t % 6.3;
    if (u > 5.6) { const k = hump(u - 5.6, 0.7); reach(p, 1, 0.2, DESK_Y + 0.14 * k, KEY_Z, 1); f[CH.sq] -= 0.06 * Math.max(0, k - 0.6); }
  },
};

export const typeFrenzy: Activity = {
  id: 'typeFrenzy', mask: MASK_ALL, sit: true, face: 'determined', smear: true, twos: true,
  update(t, p, a) {
    const f = p.f;
    sitBase(p, t, 1.4);
    const hz = 8;
    f[CH.pitch] = 0.3 + 0.04 * Math.sin(TAU * hz * t);
    f[CH.hipZ] = 0.06;
    f[CH.roll] = 0.06 * Math.sin(TAU * 6.5 * t) * a.amp;
    f[CH.twist] = 0.05 * Math.sin(TAU * 4.3 * t);
    f[CH.sq] = -0.05 + 0.04 * Math.sin(TAU * hz * 2 * t) * a.amp;
    // Noodle arms blur: big 3-frequency jitter so the smear pass catches them.
    for (let side = -1; side <= 1; side += 2) {
      const ph = TAU * hz * t + (side > 0 ? Math.PI : 0);
      const jx = 0.09 * noise1(t * 14, a.seed + side * 7), jy = 0.08 * Math.max(0, Math.sin(ph)) + 0.03 * noise1(t * 17, a.seed + side * 3);
      reach(p, side, side * 0.15 + jx, DESK_Y + jy * a.amp, KEY_Z + 0.05 * noise1(t * 9, side));
    }
    const slam = t % 2.2;
    if (slam < 0.36) {
      // Both hands up… and SLAM (body pump + a hop off the seat).
      const u = slam / 0.36;
      const up = Math.sin(Math.min(1, u / 0.65) * Math.PI * 0.5);
      const down = u > 0.65 ? (u - 0.65) / 0.35 : 0;
      for (let side = -1; side <= 1; side += 2) reach(p, side, side * 0.18, DESK_Y + 0.28 * up * (1 - down), 0.3, 0.95);
      f[CH.sq] += 0.14 * up * (1 - down) - 0.22 * Math.sin(down * Math.PI);
      f[CH.hipY] += 0.05 * up * (1 - down);
      f[CH.pitch] -= 0.12 * up * (1 - down);
    }
    f[CH.lookY] = -0.25;
    f[CH.lookX] = 0.7 * Math.sin(t * 5.3);
    f[CH.browA] = -0.3;
  },
};

/**
 * Read: [CHR fix r3] the open book is held UP in front of the face, cover toward the room and pages tipped down at the
 * eyes, so it reads over the monitor from the front and pokes above the body from the aisle (a lap book was hidden by
 * the desk + monitor in front and by the body from behind). Eyes scan up at the pages line by line; on each page flip
 * (every 3 s) the book lifts and Clawd peeks out from under it at the room; every 9 s something on the page makes it yank the
 * book close, eyebrows up.
 */
export const readBook: Activity = {
  id: 'readBook', mask: MASK_ALL, sit: true, face: 'neutral', prop: 'book',
  update(t, p, a) {
    const f = p.f;
    sitBase(p, t, 0.6);
    const line = (t % 1.25) / 1.25;
    const scan = line < 0.85 ? -0.7 + 1.4 * (line / 0.85) : 0.7 - 1.4 * ((line - 0.85) / 0.15);
    const cyc = t % 3;
    const flip = cyc - 2.35;
    const peek = flip > 0 ? hump(flip, 0.65) : 0; // page turn: the book lifts, the eyes drop to peek at the room
    const w = (t + a.seed % 5) % 9;
    const wow = w < 0.9 ? hump(w, 0.9) : 0; // yank it close
    // [CHR fix m3-r3] Walk-up (reviewer fun: at E3:0 the held-up book hid the face, only the hat and the book's back
    // read): inside BOOK_LOW_FAR m the book comes down to chest height, tipped nearly flat over the desk edge, and the
    // eyes peek over it at the player (two thirds of each 3 s page), dipping back to the page to read a line.
    // Swivelled out from the desk (animator.ts SWIVEL_IN: the chair rolled back, nothing in front) it drops further,
    // into the lap, so the mouth reads over it too.
    const near = sat((BOOK_LOW_FAR - (a.viewD ?? 99)) / (BOOK_LOW_FAR - BOOK_LOW_NEAR)), lap = a.swivel ?? 0;
    const lowY = BOOK_LOW_Y + (BOOK_LAP_Y - BOOK_LOW_Y) * lap, lowZ = 0.33 + 0.09 * lap;
    const yc = BOOK_UP + 0.04 * peek + 0.01 * Math.sin(t * 1.7) - 0.03 * wow + (lowY - BOOK_UP - 0.04 * peek + 0.03 * wow) * near;
    const zc = 0.38 + 0.02 * peek - 0.08 * wow + (lowZ - 0.38 + 0.06 * wow) * near;
    // ry = π turns the pages to −z (Clawd) and the cover to +z; rx < 0 tips the top toward the reader.
    const rx = -0.5 - 0.25 * peek + (-1.3 - 0.1 * lap + 0.5 + 0.25 * peek) * near;
    const rz = 0.05 * Math.sin(t * 0.7);
    hold(p, 'book', 0, yc, zc, rx, Math.PI, rz);
    f[CH.propA] = 1;
    f[CH.propB] = flip > 0 ? Math.min(1, flip / 0.35) : 0;
    // Grip the covers' outer edges a little below the book's centre (behind it: the pages face us).
    for (let side = -1; side <= 1; side += 2) reach(p, side, side * 0.19, yc - 0.04 + 0.02 * near, zc - 0.03 - 0.03 * near);
    f[CH.pitch] = -0.05 - 0.04 * peek + 0.06 * wow + 0.08 * near;
    f[CH.roll] = 0.04 * Math.sin(t * 0.7);
    f[CH.hipZ] = 0.02 * wow;
    const over = near * Math.min(sat(cyc / 0.25), sat((2.1 - cyc) / 0.25)); // peeking over the book at the player
    f[CH.lookX] = scan * (1 - peek) * (1 - over) + Math.max(-1, Math.min(1, (a.viewRel ?? 0) * 0.9)) * over;
    f[CH.lookY] = (0.4 - 0.08 * Math.floor(cyc / 0.75) / 4 - 0.55 * peek) * (1 - near) + (0.15 * over - 0.35 * (1 - over)) * near;
    if (peek > 0.3) { f[CH.eyeS] = 1 + 0.12 * peek; f[CH.browOn] = peek; f[CH.browA] = 0.15; }
    if (wow > 0) { f[CH.eyeS] = 1 + 0.3 * wow; f[CH.browOn] = wow; f[CH.browA] = 0.35; }
    if (over > 0 && !(wow > 0)) { f[CH.browOn] = Math.max(f[CH.browOn], 0.8 * near); f[CH.browA] = 0.2; f[CH.eyeS] = Math.max(f[CH.eyeS], 1 + 0.1 * near); }
  },
};

export const think: Activity = {
  id: 'think', mask: MASK_ALL, sit: true, face: 'neutral',
  update(t, p, a) {
    const f = p.f;
    sitBase(p, t, 0.4);
    const tapU = (t % 2.6);
    const tap = tapU < 0.4 ? Math.abs(Math.sin((tapU / 0.4) * TAU)) : 0;
    f[CH.roll] = -0.15 + 0.04 * Math.sin(t * 0.8);
    f[CH.pitch] = 0.04 + 0.02 * Math.sin(t * 0.6);
    f[CH.twist] = -0.08;
    reach(p, 1, 0.09, 0.18 - 0.025 * tap, 0.31);
    arm(p, -1, 0.5, 1.0, 0.6, 1);
    // Look up-left; dart back and forth sometimes ("hmm…").
    const dart = Math.sin(t * 0.9) > 0.8 ? 0.4 * Math.sign(Math.sin(t * 7)) : 0;
    f[CH.lookX] = -0.7 + dart;
    f[CH.lookY] = 0.7;
    // A slow "hmmm" squint every 7 s.
    const h = t % 7;
    if (h > 5.5) { const k = hump(h - 5.5, 1.5); f[CH.lid] = 0.35 * k; f[CH.browOn] = k; f[CH.browA] = -0.3; }
  },
};

/** Edit: typing with a pencil behind the ear; every ~4 s the pencil comes out for a red-pencil flourish at the monitor. */
export const pencilEdit: Activity = {
  id: 'pencilEdit', mask: MASK_ALL, sit: true, face: 'focused',
  update(t, p, a) {
    const f = p.f;
    sitBase(p, t, 0.5);
    const tap = typing(p, t, a, 5, 0.05);
    f[CH.pitch] = 0.18 + 0.02 * (tap.l + tap.r);
    f[CH.hipZ] = 0.04;
    f[CH.lookY] = -0.25; f[CH.lookX] = 0.4 * noise1(t * 0.8, a.seed);
    const u = t % 4.2;
    const EAR = [0.3, 0.5, 0.02];
    let x = EAR[0], y = EAR[1], z = EAR[2], rz = 0.9, rx = 0;
    if (u > 2.8) {
      const v = (u - 2.8) / 1.4; // 0..1: grab → strike → strike → tuck
      const out = sat(v / 0.2) * sat((1 - v) / 0.2);
      const strike = Math.sin(sat((v - 0.2) / 0.6) * TAU * 2);
      x = EAR[0] + (0.08 - EAR[0]) * out + 0.08 * strike * out;
      y = EAR[1] + (0.42 - EAR[1]) * out - 0.05 * Math.abs(strike) * out;
      z = EAR[2] + (0.48 - EAR[2]) * out;
      rz = 0.9 * (1 - out) - 0.4 * out; rx = -0.9 * out;
      reach(p, 1, x + 0.02, y - 0.05, z - 0.02, Math.max(out, 0.3 * sat(v * 5)));
      f[CH.pitch] += 0.08 * out; f[CH.hipZ] += 0.04 * out;
      f[CH.lookY] = 0.1 * out - 0.25 * (1 - out); f[CH.lookX] = 0.2 * strike * out;
      if (out > 0.5) { p.face = 'determined'; f[CH.browOn] = 1; }
    }
    hold(p, 'pencil', x, y, z, rx, 0, rz);
  },
};

/**
 * Grep: [CHR fix r3] an open book propped up on the desk, a magnifier sweeping its pages line by line, leaning in; on
 * "found!" the magnifier is thrust up over the head with a hop and a surprised face (the old flat book + low lens was
 * hidden by the monitor from the front and by the body from the aisle).
 */
export const grepMagnify: Activity = {
  id: 'grepMagnify', mask: MASK_ALL, sit: true, face: 'focused', prop: 'grep',
  update(t, p, a) {
    const f = p.f;
    sitBase(p, t, 0.5);
    const B = [-0.02, DESK_Y, 0.44];
    hold(p, 'grep', B[0], B[1], B[2], 0, 0, 0);
    // [CHR fix m3-r3] Walk-up (reviewer fun: the propped tome stood in front of the face): inside BOOK_LOW_FAR m the tome
    // lies down nearly flat on the desk (propA = lay, common.ts grepTilt) and the lens reads it from above
    f[CH.propA] = sat((BOOK_LOW_FAR - (a.viewD ?? 99)) / (BOOK_LOW_FAR - BOOK_LOW_NEAR));
    const u = t % 2.5;
    const found = u > 1.65 ? snap(sat((u - 1.65) / 0.18)) * sat((2.5 - u) / 0.2) : 0; // ~1/3 of the time up high
    f[CH.propB] = Math.sin(TAU * 0.5 * t) * (1 - found);
    f[CH.propC] = found;
    const [gx, gy, gz] = grepGrip(f);
    reach(p, 1, B[0] + gx, B[1] + gy + 0.02, B[2] + gz);
    reach(p, -1, -0.22, DESK_Y + 0.12 - 0.08 * found, 0.4); // steadies the book; drops when the lens goes up
    f[CH.pitch] = 0.28 - 0.3 * found;
    f[CH.hipZ] = 0.06 * (1 - found);
    f[CH.lookY] = -0.3 + 0.9 * found; f[CH.lookX] = f[CH.propB] * 0.8 + 0.5 * found;
    f[CH.eyeS] = 1 + 0.35 * found; f[CH.browOn] = found; f[CH.browA] = 0.35;
    f[CH.hipY] = 0.05 * found; f[CH.sq] = 0.1 * found;
    if (found > 0.3) p.face = 'surprised';
  },
};

/** Glob: flipping through a card file box, cards flying out left and right. */
export const globCards: Activity = {
  id: 'globCards', mask: MASK_ALL, sit: true, face: 'focused', prop: 'cards',
  update(t, p, a) {
    const f = p.f;
    sitBase(p, t, 0.9);
    hold(p, 'cards', 0, DESK_Y + 0.045, 0.43);
    f[CH.propA] = saw(t, 0.45);
    for (let side = -1; side <= 1; side += 2) {
      const ph = saw(t * 1.8 + (side > 0 ? 0.5 : 0), 1);
      const flick = ph < 0.5 ? ph * 2 : 2 - ph * 2;
      reach(p, side, side * (0.05 + 0.15 * flick), DESK_Y + 0.06 + 0.16 * flick, 0.42 - 0.06 * flick);
    }
    f[CH.pitch] = 0.22; f[CH.hipZ] = 0.05;
    f[CH.twist] = 0.08 * Math.sin(TAU * 0.9 * t);
    f[CH.lookX] = 0.8 * Math.sin(TAU * 0.9 * t); f[CH.lookY] = -0.4;
  },
};

/** Bash: pounding the keys at 7 Hz, leaning right in. */
export const bashPound: Activity = {
  id: 'bashPound', mask: MASK_ALL, sit: true, face: 'determined', smear: true,
  update(t, p, a) {
    const f = p.f;
    sitBase(p, t, 1);
    const hz = 3.5;
    const tl = Math.max(0, Math.sin(TAU * hz * t)) ** 3, tr = Math.max(0, Math.sin(TAU * hz * t + Math.PI)) ** 3;
    reach(p, -1, -0.13, DESK_Y + 0.13 * tl * a.amp, 0.38); reach(p, 1, 0.13, DESK_Y + 0.13 * tr * a.amp, 0.38);
    const hit = Math.max(tl, tr);
    f[CH.pitch] = 0.32 - 0.05 * hit; f[CH.hipZ] = 0.07;
    f[CH.sq] = -0.07 * (1 - hit) + 0.04 * hit;
    f[CH.roll] = 0.07 * (tr - tl);
    f[CH.lookY] = -0.1; f[CH.browA] = -0.4;
  },
};

/** Long Bash: drumming fingers, chin on a fist, watching the output scroll. */
export const bashWatch: Activity = {
  id: 'bashWatch', mask: MASK_ALL, sit: true, face: 'neutral',
  update(t, p, a) {
    const f = p.f;
    sitBase(p, t, 1.3);
    for (let i = 0; i < 2; i++) f[CH.l0s + i * 2] += 0.3 * Math.max(0, Math.sin(TAU * 2.2 * t + i * Math.PI)); // foot tap
    const drum = Math.abs(Math.sin(TAU * 4 * t)) * (saw(t, 0.5) < 0.6 ? 1 : 0);
    reach(p, 1, 0.2, DESK_Y + 0.03 * drum, 0.4);
    reach(p, -1, -0.02, 0.2, 0.32); // fist under the chin
    f[CH.pitch] = 0.12; f[CH.roll] = -0.1 + 0.03 * Math.sin(t * 0.7);
    f[CH.lookY] = 0.15 + 0.1 * Math.sin(t * 2.1); f[CH.lookX] = 0.2 * Math.sin(t * 0.4);
    f[CH.lid] = 0.25;
    const y = t % 8;
    if (y > 6.6) { const k = hump(y - 6.6, 1.4); f[CH.sq] = 0.1 * k; f[CH.mouthS] = 1 + k; p.mouth = k > 0.2 ? 'o' : null; } // a big yawn
  },
};

const DISH_TUCK_FAR = 2.6, DISH_TUCK_NEAR = 1.9; // m: [CHR fix m2-r2] dish tuck ramp

/** Web: a satellite dish pops up on the head and sweeps; typing underneath. */
export const dishWeb: Activity = {
  id: 'dishWeb', mask: MASK_ALL, sit: true, face: 'focused', prop: 'dish',
  update(t, p, a) {
    const f = p.f;
    sitBase(p, t, 0.6);
    typing(p, t, a, 4.2, 0.05);
    // [CHR fix m2-r2] Walk-up: inside ~2 m of the player the dish shrinks, tucks behind the head and stops sweeping,
    // parked facing away from the player (its shaded back toward them), so the pat reaction / face stay clear.
    const near = sat((DISH_TUCK_FAR - (a.viewD ?? 99)) / (DISH_TUCK_FAR - DISH_TUCK_NEAR));
    hold(p, 'dish', -0.18 + 0.06 * near, 0.5, -0.12 - 0.12 * near, 0, 0, 0.2 * (1 - near));
    f[CH.propA] = snap(t / 0.45) * (1 - 0.35 * near);
    const search = t * 1.3 + 0.6 * Math.sin(t * 3.1);
    // body-frame spin that points the dish face away from the viewer (propB = viewRel), with a slow idle wobble
    const away = (a.viewRel ?? 0) * 0.8 + 0.3 * Math.sin(t * 0.9);
    // the sweep's offset from 'away' squeezed toward 0 (stereographic: continuous on the circle, no wrap pop)
    f[CH.propB] = near > 0 ? away + 2 * Math.atan((1 - near) * Math.tan((search - away) / 2)) : search;
    f[CH.pitch] = 0.18; f[CH.lookY] = 0.15 * Math.sin(t * 1.1); f[CH.lookX] = 0.5 * Math.sin(search);
    const ping = t % 3.5;
    if (ping > 3.2) { const k = hump(ping - 3.2, 0.3); f[CH.hipY] = 0.05 * k; f[CH.sq] = 0.1 * k; f[CH.eyeS] = 1 + 0.2 * k; }
  },
};

/** Task: claps twice (mini-Clawds pop out), then supervises, pointing them to work. */
export const delegate: Activity = {
  id: 'delegate', mask: MASK_ALL, sit: true, face: 'determined',
  update(t, p, a) {
    const f = p.f;
    sitBase(p, t, 0.8);
    const u = t % 3.6;
    if (u < 0.9) {
      const c = Math.abs(Math.sin((u / 0.9) * TAU));
      for (let side = -1; side <= 1; side += 2) reach(p, side, side * (0.02 + 0.16 * c), 0.4, 0.34);
      f[CH.sq] = 0.06 * (1 - c); f[CH.pitch] = -0.05;
      f[CH.hipY] = 0.02 * (1 - c);
    } else {
      const k = sat((u - 0.9) / 0.25) * sat((3.6 - u) / 0.3);
      const aim = Math.sin(TAU * 0.35 * t + a.seed);
      arm(p, 1, 1.25 * k, 1.15 + 0.35 * k + 0.35 * aim * k, 0, 1 + 2.4 * k);
      arm(p, -1, -0.3, 0.9, 0.9, 1); // hand on hip
      f[CH.twist] = 0.3 * aim * k; f[CH.pitch] = -0.08 * k;
      f[CH.lookX] = 0.8 * aim; f[CH.lookY] = -0.2;
      // "go go go" bounce on each point
      f[CH.sq] = 0.05 * Math.max(0, Math.sin(TAU * 2.5 * u)) * k;
    }
  },
};

/** TodoWrite: clipboard in one hand, ticking boxes with a pencil; a satisfied nod and squint per tick. */
export const clipboard: Activity = {
  id: 'clipboard', mask: MASK_ALL, sit: true, face: 'focused', prop: 'clipboard',
  update(t, p, a) {
    const f = p.f;
    sitBase(p, t, 0.5);
    // [CHR fix m3-r3] Walk-up: the clipboard drops to the desk edge and tips back (flatter) so the face reads over it
    // (swivelled out from the desk: into the lap, like readBook)
    const near = sat((BOOK_LOW_FAR - (a.viewD ?? 99)) / (BOOK_LOW_FAR - BOOK_LOW_NEAR)), dy = (-0.07 - 0.12 * (a.swivel ?? 0)) * near;
    hold(p, 'clipboard', -0.08, 0.3 + dy, 0.34, -0.55 - 0.45 * near, 0.3, 0.12);
    reach(p, -1, -0.16, 0.24 + dy, 0.32);
    const u = saw(t, 0.8), row = Math.floor(t * 0.8) % 3;
    const tick = u < 0.45 ? u / 0.45 : 0;
    f[CH.propA] = tick; f[CH.propB] = row / 3 + 0.1;
    reach(p, 1, -0.04, 0.33 + dy * 1.2 - row * 0.05 * (1 - 0.4 * near) + 0.03 * Math.sin(tick * Math.PI), 0.42 - 0.03 * near);
    const nod = u > 0.45 && u < 0.8 ? hump(u - 0.45, 0.35) : 0;
    f[CH.pitch] = 0.16 + 0.12 * nod; f[CH.sq] = -0.06 * nod;
    f[CH.lookY] = -0.45; f[CH.lookX] = -0.2;
    if (nod > 0.35) { p.eye = 'arc'; f[CH.blush] = 0.8; }
  },
};

/** MCP: a retro phone at the ear; the other hand gestures; chatty mouth. */
export const phoneMcp: Activity = {
  id: 'phoneMcp', mask: MASK_ALL, sit: true, face: 'happy', prop: 'phone',
  update(t, p, a) {
    const f = p.f;
    sitBase(p, t, 1);
    const nod = Math.sin(TAU * 1.3 * t);
    hold(p, 'phone', 0.37, 0.4, 0.08, 0.1, 0, 0.35);
    reach(p, 1, 0.34, 0.33, 0.1);
    const g = saw(t, 0.4);
    const gest = Math.sin(g * TAU * 2) * hump(g, 1);
    reach(p, -1, -0.3 - 0.08 * gest, 0.35 + 0.12 * Math.abs(gest), 0.3 + 0.05 * gest);
    f[CH.roll] = 0.14 + 0.03 * nod; f[CH.pitch] = 0.05 * nod;
    f[CH.lookX] = -0.3 + 0.2 * Math.sin(t * 0.8); f[CH.lookY] = 0.1;
    p.mouth = saw(t, 4) < 0.5 ? 'o' : 'smile';
    f[CH.mouthS] = 0.8;
    const laugh = t % 6;
    if (laugh > 5) { const k = hump(laugh - 5, 1); f[CH.sq] = 0.08 * Math.sin(TAU * 3 * laugh) * k; p.eye = 'arc'; }
  },
};

/** MCP (cable): plugged into a port from its back, humming with the transfer; types while it pulses. */
export const cableMcp: Activity = {
  id: 'cableMcp', mask: MASK_ALL, sit: true, face: 'focused', prop: 'cable',
  update(t, p, a) {
    const f = p.f;
    sitBase(p, t, 0.4);
    typing(p, t, a, 3.5, 0.04);
    hold(p, 'cable', 0.05, 0.22, -0.24, 0, 0, 0);
    const pulse = saw(t, 1.6);
    f[CH.propA] = Math.exp(-pulse * 5);
    f[CH.sq] = 0.03 * Math.exp(-pulse * 8) * Math.sin(pulse * 60);
    f[CH.pitch] = 0.15; f[CH.lookY] = -0.2; f[CH.lookX] = 0.3 * Math.sin(t * 0.6);
    f[CH.eyeSY] = 0.9 + 0.1 * f[CH.propA];
  },
};

/** Compaction: stuff the backpack, squash it flat with a body slam, it springs back smaller. */
export const compactBackpack: Activity = {
  id: 'compactBackpack', mask: MASK_ALL, sit: true, face: 'determined', prop: 'pack', smear: true,
  update(t, p, a) {
    const f = p.f;
    sitBase(p, t, 1);
    const u = t % 3.4;
    hold(p, 'pack', 0, 0.3, 0.46);
    if (u < 1.8) {
      const s = saw(u, 2.2);
      f[CH.propA] = u / 1.8;
      for (let side = -1; side <= 1; side += 2) {
        const k = side > 0 ? s : saw(u + 0.23, 2.2);
        reach(p, side, side * 0.1, 0.45 + 0.08 * (1 - hump(k, 1)), 0.46);
      }
      f[CH.pitch] = 0.2; f[CH.sq] = -0.03;
    } else {
      const v = (u - 1.8) / 1.6;
      const up = v < 0.25 ? v / 0.25 : 0, slam = v >= 0.25 && v < 0.45 ? (v - 0.25) / 0.2 : v >= 0.45 ? 1 : 0;
      const spring = v > 0.45 ? Math.exp(-(v - 0.45) * 6) * Math.cos((v - 0.45) * 30) : 0;
      f[CH.propA] = 1;
      f[CH.propB] = slam * (0.9 - 0.4 * sat((v - 0.45) * 2)) + 0.1 * spring;
      for (let side = -1; side <= 1; side += 2) reach(p, side, side * 0.12, 0.62 + 0.18 * up - 0.2 * slam, 0.42);
      f[CH.hipY] = 0.06 * up; f[CH.sq] = 0.12 * up - 0.2 * slam * (1 - sat((v - 0.45) * 3)) + 0.06 * spring;
      f[CH.pitch] = 0.1 + 0.25 * slam;
    }
    f[CH.lookY] = -0.5;
  },
};

/** Ask: half-raised hand ("one question…"), head tilted, fingers wiggling; not the blocked straight-up wave. */
export const ask: Activity = {
  id: 'ask', mask: MASK_ALL, sit: true, face: 'worried',
  update(t, p, a) {
    const f = p.f;
    sitBase(p, t, 0.7);
    const w = Math.sin(TAU * 1.6 * t);
    arm(p, 1, 0.55, 2.05 + 0.08 * w, 0.5 + 0.2 * w, 1.6);
    arm(p, -1, 0.5, 1.0, 0.5, 1);
    f[CH.roll] = -0.12 + 0.03 * w; f[CH.pitch] = -0.03;
    f[CH.lookX] = 0.4; f[CH.lookY] = 0.3;
    f[CH.sq] = 0.03 * Math.max(0, Math.sin(TAU * 0.8 * t));
  },
};

/** Git (desk): stamping envelopes, big wind-up → THUNK with a body squash; the envelope gets its mark. */
export const stampEnvelope: Activity = {
  id: 'stampEnvelope', mask: MASK_ALL, sit: true, face: 'determined', prop: 'stamp', smear: true, twos: true,
  update(t, p, a) {
    const f = p.f;
    sitBase(p, t, 0.8);
    const B = [-0.04, DESK_Y + 0.004, 0.44];
    hold(p, 'stamp', B[0], B[1], B[2]);
    const u = saw(t, 1.05);
    const up = u < 0.55 ? snap(u / 0.55, 1.2) : u < 0.68 ? 1 - (u - 0.55) / 0.13 : 0;
    const impact = u >= 0.68 ? Math.exp(-(u - 0.68) * 12) : 0;
    f[CH.propA] = up;
    f[CH.propB] = u > 0.68 || u < 0.15 ? 1 : 0;
    reach(p, 1, B[0] + 0.05, B[1] + 0.1 + 0.14 * up, B[2] + 0.03);
    reach(p, -1, B[0] - 0.1, B[1] + 0.02, B[2] - 0.02);
    f[CH.pitch] = 0.2 - 0.1 * up + 0.12 * impact; f[CH.hipZ] = 0.05;
    f[CH.sq] = 0.08 * up - 0.18 * impact;
    f[CH.hipY] = 0.03 * up;
    f[CH.lookY] = -0.5; f[CH.browA] = -0.4 * up;
    if (impact > 0.5) p.eye = 'closed';
  },
};

/** Overflow worker (floor home, no chair): standing, laptop on the forearm, pecking at it. */
export const standWork: Activity = {
  id: 'standWork', mask: STAND, sit: false, face: 'focused', prop: 'laptop',
  update(t, p, a) {
    const f = p.f;
    hold(p, 'laptop', 0, 0.1, 0.4, 0.28, 0, 0);
    f[CH.propA] = 0.78; f[CH.propB] = t;
    reach(p, -1, -0.1, 0.08, 0.38);
    const tap = Math.max(0, Math.sin(TAU * 4.5 * t)) ** 2;
    reach(p, 1, 0.06 + 0.05 * noise1(t * 3, a.seed), 0.13 + 0.05 * tap, 0.4);
    f[CH.pitch] = 0.12; f[CH.lookY] = -0.7; f[CH.lookX] = 0.3 * noise1(t, a.seed);
    f[CH.roll] = 0.03 * Math.sin(t * 1.3);
  },
};
