// @pure
/**
 * Station activities (DESIGN §6.3/§6.5): posed against the station furniture ENV places in front of the slot (+z).
 * Standing ones keep the locomotion idle leg shift (mask STAND). Owner: CHR.
 */
import { CH, MASK_ALL } from '../pose.ts';
import { reach, arm } from '../ik.ts';
import { noise1 } from '../noise.ts';
import { TAU, STAND, hold, hump, sat, saw, snap, sitBase } from './common.ts';
import type { Activity } from './index.ts';

/** Library: reading standing up; every 6 s tiptoes to pull another book off a high shelf. */
export const libraryRead: Activity = {
  id: 'libraryRead', mask: STAND, sit: false, face: 'neutral', prop: 'book',
  update(t, p, a) {
    const f = p.f;
    const u = t % 6;
    const reachUp = u > 4.6 ? hump(u - 4.6, 1.4) : 0;
    hold(p, 'book', -0.05, 0.28, 0.36, -1.15, 0.2, 0.05);
    f[CH.propA] = 1 - 0.5 * reachUp;
    f[CH.propB] = sat(((t % 3) - 2.6) / 0.3);
    reach(p, -1, -0.22, 0.26, 0.34);
    if (reachUp > 0) {
      arm(p, 1, 0.5, 1.15 + 1.6 * reachUp, 0, 1 + 3 * reachUp);
      f[CH.hipY] = 0.06 * reachUp; f[CH.sq] = 0.12 * reachUp; f[CH.pitch] = -0.1 * reachUp;
      f[CH.lookY] = 0.8 * reachUp; f[CH.lookX] = 0.4 * reachUp;
    } else {
      reach(p, 1, 0.14, 0.26, 0.36);
      f[CH.lookY] = -0.6; f[CH.lookX] = -0.6 + 1.2 * saw(t, 0.8);
      f[CH.pitch] = 0.08;
    }
  },
};

/** Library ladder: climbing up to the top shelf (hands over hands, knees up), then peeking at a spine. */
export const ladder: Activity = {
  id: 'ladder', mask: MASK_ALL, sit: false, face: 'determined',
  update(t, p) {
    const f = p.f;
    const c = saw(t, 1.2);
    for (let side = -1; side <= 1; side += 2) {
      const ph = side > 0 ? c : (c + 0.5) % 1;
      reach(p, side, side * 0.2, 0.62 + 0.14 * Math.sin(ph * TAU), 0.3);
    }
    for (let i = 0; i < 4; i++) {
      const ph = ((i % 2 ? c : c + 0.5) % 1);
      f[CH.l0y + i * 2] = 0.06 * Math.max(0, Math.sin(ph * TAU));
      f[CH.l0s + i * 2] = 0.5 * Math.max(0, Math.sin(ph * TAU));
    }
    f[CH.hipY] = 0.03 * Math.abs(Math.sin(c * TAU * 2));
    f[CH.sq] = 0.06 * Math.sin(c * TAU * 2);
    f[CH.pitch] = -0.06;
    f[CH.lookY] = 0.7; f[CH.lookX] = 0.3 * Math.sin(t * 0.7);
  },
};

/** Lab: pouring a sloshing flask into a (world) beaker, very carefully; now and then it fizzes and startles them. */
export const labPour: Activity = {
  id: 'labPour', mask: STAND, sit: false, face: 'focused', prop: 'flask',
  update(t, p) {
    const f = p.f;
    const u = t % 5;
    const pour = u < 3.5 ? hump(u, 3.5) : 0;
    const fizz = u > 3.6 ? hump(u - 3.6, 0.8) : 0;
    hold(p, 'flask', 0.12, 0.4 + 0.05 * pour, 0.36, 0, 0, 1.3 * pour);
    f[CH.propA] = saw(t, 0.9);
    reach(p, 1, 0.14, 0.36 + 0.05 * pour, 0.34);
    reach(p, -1, -0.1, 0.24, 0.42);
    f[CH.pitch] = 0.1 + 0.08 * pour - 0.15 * fizz;
    f[CH.lookX] = -0.3 * pour; f[CH.lookY] = -0.3;
    f[CH.lid] = 0.25 * pour; f[CH.browOn] = pour; f[CH.browA] = -0.2;
    f[CH.hipY] = 0.08 * fizz; f[CH.sq] = 0.15 * fizz;
    if (fizz > 0.2) p.face = 'surprised';
  },
};

/** Mailroom: flicking envelopes into sorting slots, quick and pleased with itself. */
export const mailSort: Activity = {
  id: 'mailSort', mask: STAND, sit: false, face: 'happy', prop: 'envelopes',
  update(t, p) {
    const f = p.f;
    const u = saw(t, 1.3), slot = Math.floor(t * 1.3) % 3;
    hold(p, 'envelopes', 0, 0.22, 0.28);
    f[CH.propA] = u < 0.6 ? snap(u / 0.6, 1.4) : 0; f[CH.propB] = slot / 3 + 0.1;
    const k = f[CH.propA];
    reach(p, 1, (-0.08 + slot * 0.08) * k + 0.05 * (1 - k), 0.26 + 0.06 * Math.sin(k * Math.PI), 0.3 + 0.1 * k);
    reach(p, -1, -0.18, 0.2, 0.34);
    f[CH.twist] = 0.15 * (slot - 1) * k; f[CH.lookX] = 0.5 * (slot - 1) * k; f[CH.lookY] = -0.3;
    f[CH.sq] = 0.04 * hump(u, 0.6);
  },
};

/** War Room whiteboard: big zig-zag marker strokes; steps back to admire, hands on hips. */
export const whiteboard: Activity = {
  id: 'whiteboard', mask: STAND, sit: false, face: 'determined', prop: 'pencil', smear: true,
  update(t, p) {
    const f = p.f;
    const u = t % 5.5;
    if (u < 4) {
      const x = -0.2 + 0.4 * saw(u, 0.5), y = 0.4 + 0.12 * Math.sin(TAU * 2.2 * u) + 0.15 * (1 - saw(u, 0.25));
      hold(p, 'pencil', x, y, 0.5, -1.2, 0, 0);
      reach(p, 1, x + 0.02, y - 0.04, 0.46);
      arm(p, -1, -0.3, 0.95, 0.9, 1);
      f[CH.twist] = 0.3 * (x / 0.2); f[CH.roll] = -0.06 * Math.sin(TAU * 2.2 * u);
      f[CH.lookX] = x * 3; f[CH.lookY] = 0.4;
    } else {
      const k = hump(u - 4, 1.5);
      hold(p, 'pencil', 0.34, 0.24, 0.12, 0, 0, 0.3);
      arm(p, 1, -0.35, 0.95, 0.9, 1); arm(p, -1, -0.35, 0.95, 0.9, 1);
      f[CH.hipZ] = -0.06 * k; f[CH.pitch] = -0.12 * k; f[CH.roll] = 0.1 * k;
      f[CH.lookY] = 0.4; p.face = 'happy';
      f[CH.sq] = 0.05 * Math.max(0, Math.sin(TAU * 2 * (u - 4))) * k;
    }
  },
};

/** Observatory: bent over the eyepiece, hands on the tube; gasps and bounces at a shooting star. */
export const telescope: Activity = {
  id: 'telescope', mask: STAND, sit: false, face: 'focused',
  update(t, p, a) {
    const f = p.f;
    const u = (t + (a.seed % 7)) % 8;
    const wow = u > 6.4 ? hump(u - 6.4, 1.6) : 0;
    for (let side = -1; side <= 1; side += 2) reach(p, side, side * 0.14, 0.44 + 0.04 * wow, 0.36 - 0.06 * wow);
    f[CH.pitch] = 0.3 * (1 - wow) - 0.15 * wow;
    f[CH.hipZ] = 0.05 * (1 - wow);
    f[CH.twist] = 0.08 * noise1(t * 0.3, a.seed);
    f[CH.lookY] = 0.4; f[CH.lookX] = 0.2 * noise1(t * 0.5, a.seed + 2);
    f[CH.lid] = 0.3 * (1 - wow);
    if (wow > 0.1) { p.face = 'celebrate'; f[CH.hipY] = 0.06 * Math.abs(Math.sin(TAU * 2 * u)) * wow; f[CH.sq] = 0.1 * wow; }
  },
};
export const telescopeGaze = { ...telescope, id: 'telescopeGaze' };

/** Radio corner: twiddling the tuning knob, other hand on the ear, bobbing to what it finds. */
export const radio: Activity = {
  id: 'radio', mask: STAND, sit: false, face: 'neutral',
  update(t, p) {
    const f = p.f;
    const knob = Math.sin(TAU * 0.4 * t) * 0.03;
    reach(p, 1, 0.1 + knob, 0.26 + 0.01 * Math.sin(t * 7), 0.44);
    reach(p, -1, -0.34, 0.42, 0.06);
    const tuned = saw(t, 0.15) > 0.5;
    const beat = tuned ? Math.abs(Math.sin(TAU * 1.1 * t)) : 0;
    f[CH.hipY] = 0.02 * beat; f[CH.sq] = 0.05 * beat - 0.02;
    f[CH.roll] = tuned ? 0.1 * Math.sin(TAU * 0.55 * t) : 0.14;
    f[CH.lookX] = tuned ? 0 : 0.5; f[CH.lookY] = -0.2;
    if (tuned) { p.face = 'happy'; p.eye = 'arc'; }
  },
};

/** Round Table: seated discussion: points at the table, nods, a triple-bounce laugh. */
export const roundTable: Activity = {
  id: 'roundTable', mask: MASK_ALL, sit: true, face: 'neutral',
  update(t, p, a) {
    const f = p.f;
    sitBase(p, t, 0.8);
    const u = (t + a.seed % 5) % 7;
    if (u < 2.2) {
      const g = Math.sin(TAU * 1.8 * u);
      reach(p, 1, 0.1 + 0.06 * g, 0.3 + 0.06 * Math.abs(g), 0.48);
      arm(p, -1, 0.5, 1.2, 0.5, 1);
      p.mouth = saw(u, 3) < 0.5 ? 'o' : null;
      f[CH.pitch] = 0.1; f[CH.lookX] = 0.2;
    } else if (u < 4.6) {
      reach(p, 1, 0.2, 0.22, 0.4); reach(p, -1, -0.2, 0.22, 0.4);
      f[CH.pitch] = 0.06 * Math.max(0, Math.sin(TAU * 1.5 * u));
      f[CH.lookX] = -0.6 * Math.sin(u * 0.8); f[CH.lookY] = 0.1;
    } else {
      const k = hump(u - 4.6, 2.4);
      f[CH.sq] = 0.1 * Math.abs(Math.sin(TAU * 3 * u)) * k; f[CH.hipY] = 0.03 * Math.abs(Math.sin(TAU * 3 * u)) * k;
      arm(p, -1, 0.9, 1.1, 0.8, 1); arm(p, 1, 0.9, 1.1, 0.8, 1);
      p.face = 'happy'; p.mouth = 'grin';
    }
  },
};

