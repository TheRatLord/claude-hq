// @pure
/**
 * Walking variants (DESIGN §6.3/§6.5): arms + prop (+ face) layer only, blended over the trot/waddle/skip so a working
 * agent keeps animating its tool while it scurries (reading while trotting, typing on a laptop, magnifier sweeping).
 * Also the sign-off `parcelCarry` and the nap `sleepwalk`. Owner: CHR.
 */
import { CH } from '../pose.ts';
import { reach, arm } from '../ik.ts';
import { noise1 } from '../noise.ts';
import { TAU, WALK, hold, saw, hump } from './common.ts';
import { M } from '../pose.ts';
import type { Activity } from './index.ts';

/** Hands bob with the trot so the prop reads as carried, not glued. */
const bob = (t: number, hz = 3): number => 0.012 * Math.sin(TAU * hz * t);

export const walkRead: Activity = {
  id: 'walkRead', mask: WALK, sit: false, face: 'focused', prop: 'book',
  update(t, p) {
    const f = p.f;
    const y = 0.3 + bob(t);
    hold(p, 'book', 0, y, 0.36, -1.25, 0, 0.05 * Math.sin(t * 2));
    f[CH.propA] = 1;
    const flip = (t % 2.4) - 2.0;
    f[CH.propB] = flip > 0 ? Math.min(1, flip / 0.3) : 0;
    for (let side = -1; side <= 1; side += 2) reach(p, side, side * 0.19, y - 0.03, 0.36);
    const line = saw(t, 0.9);
    f[CH.lookX] = line < 0.85 ? -0.6 + 1.2 * (line / 0.85) : 0.6 - 1.2 * ((line - 0.85) / 0.15);
    f[CH.lookY] = -0.6;
  },
};

/** Work call / laptop scurry: laptop open on the left forearm, the right hand pecking away. */
export const walkType: Activity = {
  id: 'walkType', mask: WALK, sit: false, face: 'determined', prop: 'laptop',
  update(t, p, a) {
    const f = p.f;
    // Held low on the forearm so the lid never hides the eyes (lid top ≈ 0.27 m < eye bottom).
    const y = 0.1 + bob(t, 3.2);
    hold(p, 'laptop', -0.02, y, 0.4, 0.28, 0.1, 0);
    f[CH.propA] = 0.78; f[CH.propB] = t;
    reach(p, -1, -0.12, y - 0.02, 0.38);
    const tap = Math.max(0, Math.sin(TAU * 6 * t)) ** 2;
    reach(p, 1, 0.04 + 0.06 * noise1(t * 4, a.seed), y + 0.03 + 0.06 * tap, 0.4);
    f[CH.lookY] = -0.7; f[CH.lookX] = 0.3 * noise1(t * 2, a.seed + 3);
  },
};

export const walkMagnify: Activity = {
  id: 'walkMagnify', mask: WALK, sit: false, face: 'focused', prop: 'magnifier',
  update(t, p) {
    const f = p.f;
    const sw = Math.sin(TAU * 0.7 * t);
    hold(p, 'magnifier', 0.12 + 0.1 * sw, 0.16 + bob(t), 0.42, -0.9, 0, -0.2 * sw);
    reach(p, 1, 0.12 + 0.1 * sw, 0.16 + bob(t), 0.42);
    arm(p, -1, -0.4, 0.9, 0.9, 1); // other hand behind the back, detective style
    f[CH.lookX] = 0.7 * sw; f[CH.lookY] = -0.8;
  },
};

export const walkClipboard: Activity = {
  id: 'walkClipboard', mask: WALK, sit: false, face: 'focused', prop: 'clipboard',
  update(t, p) {
    const f = p.f;
    const y = 0.32 + bob(t);
    hold(p, 'clipboard', -0.1, y, 0.34, -0.5, 0.35, 0.1);
    reach(p, -1, -0.17, y - 0.06, 0.32);
    const u = saw(t, 1.1), row = Math.floor(t * 1.1) % 3;
    f[CH.propA] = u < 0.5 ? u * 2 : 0; f[CH.propB] = row / 3 + 0.1;
    reach(p, 1, -0.05, y + 0.03 - row * 0.05, 0.42);
    f[CH.lookY] = -0.5; f[CH.lookX] = -0.25;
  },
};

export const walkPhone: Activity = {
  id: 'walkPhone', mask: WALK, sit: false, face: 'happy', prop: 'phone',
  update(t, p) {
    const f = p.f;
    hold(p, 'phone', 0.37, 0.4 + bob(t), 0.08, 0.1, 0, 0.35);
    reach(p, 1, 0.34, 0.33, 0.1);
    const g = Math.sin(TAU * 0.9 * t);
    arm(p, -1, 0.3 + 0.3 * g, 1.5 + 0.4 * Math.abs(g), 0.4, 1.4);
    p.mouth = saw(t, 3.5) < 0.5 ? 'o' : 'smile';
    f[CH.lookX] = -0.2; f[CH.lookY] = 0.15;
  },
};

/** Careful flask walk: both hands cradle a sloshing flask up front, eyes glued to it. */
export const walkFlask: Activity = {
  id: 'walkFlask', mask: WALK, sit: false, face: 'worried', prop: 'flask',
  update(t, p) {
    const f = p.f;
    const y = 0.36 + bob(t, 3);
    hold(p, 'flask', 0, y, 0.36, 0, 0, 0.12 * Math.sin(TAU * 1.5 * t));
    f[CH.propA] = saw(t, 1.5);
    reach(p, 1, 0.05, y - 0.02, 0.36); reach(p, -1, -0.05, y - 0.12, 0.34);
    f[CH.lookY] = -0.1; f[CH.lookX] = 0.1 * Math.sin(TAU * 1.5 * t);
    f[CH.browOn] = 1; f[CH.browA] = 0.4;
  },
};

/** Sign-off run: hugging a wrapped parcel, proud as punch. */
export const parcelCarry: Activity = {
  id: 'parcelCarry', mask: WALK, sit: false, face: 'happy', prop: 'parcel',
  update(t, p) {
    const f = p.f;
    const y = 0.3 + bob(t, 3) * 1.5;
    hold(p, 'parcel', 0, y, 0.4, 0, 0.05 * Math.sin(TAU * 1.5 * t), 0.04 * Math.sin(TAU * 1.5 * t));
    for (let side = -1; side <= 1; side += 2) reach(p, side, side * 0.16, y - 0.02, 0.4);
    f[CH.lookY] = 0.1;
    f[CH.blush] = 0.8;
  },
};

/** Nap sleepwalk: arms straight out front, eyes shut, a slow sway. Walking style comes from locomotion. */
export const sleepwalk: Activity = {
  id: 'sleepwalk', mask: WALK | M.BODY, sit: false, face: 'sleepy',
  update(t, p) {
    const f = p.f;
    const s = Math.sin(TAU * 0.4 * t);
    arm(p, -1, 1.55 + 0.06 * s, 1.35, 0, 2.2);
    arm(p, 1, 1.55 - 0.06 * s, 1.35, 0, 2.2);
    f[CH.roll] = 0.12 * s; f[CH.pitch] = -0.08;
    f[CH.hipY] = 0.015 * Math.abs(Math.sin(TAU * 0.8 * t));
    f[CH.sq] = -0.04;
    f[CH.mouthS] = 0.7 + 0.4 * hump(saw(t, 0.25), 1);
  },
};
