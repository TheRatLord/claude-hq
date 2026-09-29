// @pure
/**
 * Seated-idle fidgets (ART §5.5 favoriteFidget, brain `fidget:<name>`): short seated loops, each one a little show.
 * Registered as `fidget:<name>` (plus the personality aliases shimmy/juggle/polish). Owner: CHR.
 */
import { CH, MASK_ALL, type Pose } from '../pose.ts';
import type { Activity } from './index.ts';
import { reach, arm } from '../ik.ts';
import { sitBase, TAU, hold, hump, saw, hopCurve } from './common.ts';
const BODY_H = 0.54; // body height (render/geometry.ts), duplicated to keep this module three-free

const fid = (name: string, face: string, update: (t: number, p: Pose) => void, extra: Partial<Activity> = {}): Activity => ({ id: `fidget:${name}`, mask: MASK_ALL, sit: true, face, update, ...extra });

export const FIDGET_ACTS: Record<string, Activity> = {
  stretch: fid('stretch', 'happy', (t, p) => {
    const f = p.f;
    sitBase(p, t, 0.6);
    const k = hump(t % 3.2, 2.4);
    arm(p, -1, 0.1 * k, 1.15 + 1.5 * k, 0, 1 + 2.4 * k);
    arm(p, 1, 0.1 * k, 1.15 + 1.5 * k, 0, 1 + 2.4 * k);
    f[CH.sq] = 0.16 * k; f[CH.pitch] = -0.14 * k; f[CH.roll] = 0.08 * Math.sin(t * 3) * k;
    p.eye = k > 0.5 ? 'closed' : null;
    p.mouth = k > 0.6 ? 'o' : null;
  }),
  hopInPlace: fid('hopInPlace', 'happy', (t, p) => {
    const f = p.f;
    sitBase(p, t, 1.4);
    const h = hopCurve(t % 0.7, 0.28, 0.1, 0.08);
    f[CH.hipY] = h.y; f[CH.sq] = h.sq;
    arm(p, -1, 0, 1.15 + 0.6 * (h.y / 0.1), 0, 1.2); arm(p, 1, 0, 1.15 + 0.6 * (h.y / 0.1), 0, 1.2);
  }),
  lookAround: fid('lookAround', 'neutral', (t, p) => {
    const f = p.f;
    sitBase(p, t, 0.8);
    const s = Math.sign(Math.sin(TAU * 0.35 * t));
    f[CH.twist] = 0.5 * s; f[CH.lookX] = 0.9 * s; f[CH.lookY] = 0.2 * Math.sin(t);
    f[CH.roll] = 0.05 * s;
  }),
  danceShimmy: fid('danceShimmy', 'happy', (t, p) => {
    const f = p.f;
    sitBase(p, t, 1.6);
    const b = TAU * 2 * t;
    f[CH.roll] = 0.14 * Math.sin(b); f[CH.twist] = 0.2 * Math.sin(b * 0.5); f[CH.hipY] = 0.03 * Math.abs(Math.sin(b));
    f[CH.sq] = 0.06 * Math.sin(b * 2);
    arm(p, -1, 0.4 * Math.sin(b), 1.6 + 0.5 * Math.sin(b), 0.3, 1.4); arm(p, 1, -0.4 * Math.sin(b), 1.6 - 0.5 * Math.sin(b), 0.3, 1.4);
    p.eye = 'arc';
  }),
  yoyo: fid('yoyo', 'happy', (t, p) => {
    const f = p.f;
    sitBase(p, t, 0.6);
    const u = saw(t, 1.1), ext = u < 0.5 ? Math.sin(u * Math.PI) : Math.sin(u * Math.PI);
    const hy = 0.34 + 0.05 * Math.sin(u * TAU);
    hold(p, 'yoyo', 0.26, hy, 0.3);
    f[CH.propA] = ext;
    reach(p, 1, 0.26, hy + 0.02, 0.28);
    f[CH.lookX] = 0.5; f[CH.lookY] = -0.3 - 0.4 * ext;
  }),
  jugglePebbles: fid('jugglePebbles', 'focused', (t, p) => {
    const f = p.f;
    sitBase(p, t, 0.6);
    hold(p, 'balls', 0, 0.36, 0.36);
    f[CH.propA] = t * 1.6; f[CH.propB] = 0;
    const ph = saw(t * 1.6 * 3, 0.5);
    reach(p, -1, -0.11, 0.33 + 0.03 * Math.sin(ph * TAU), 0.36);
    reach(p, 1, 0.11, 0.33 + 0.03 * Math.sin(ph * TAU + Math.PI), 0.36);
    f[CH.lookY] = 0.3 * Math.sin(TAU * 1.6 * t); f[CH.lookX] = 0.3 * Math.cos(TAU * 0.8 * t);
  }),
  spin: fid('spin', 'celebrate', (t, p) => {
    const f = p.f;
    sitBase(p, t, 1.2);
    const u = t % 3;
    f[CH.twist] = u < 1.4 ? TAU * (1 - (1 - u / 1.4) ** 3) : 0;
    arm(p, -1, 0, 1.9, 0, 1.6); arm(p, 1, 0, 1.9, 0, 1.6);
    if (u < 1.4) p.eye = 'star'; else p.eye = 'swirl';
  }, { smear: true }),
  polishAccessory: fid('polishAccessory', 'happy', (t, p) => {
    const f = p.f;
    sitBase(p, t, 0.5);
    const r = Math.sin(TAU * 2.2 * t);
    reach(p, 1, 0.12 + 0.05 * r, BODY_H + 0.08, 0.05 + 0.05 * Math.cos(TAU * 2.2 * t));
    reach(p, -1, -0.16, BODY_H + 0.04, 0.02);
    f[CH.lookY] = 0.9; f[CH.pitch] = -0.1; f[CH.roll] = 0.04 * r;
    p.eye = 'arc';
  }),
};
FIDGET_ACTS.shimmy = FIDGET_ACTS.danceShimmy;
FIDGET_ACTS.juggle = FIDGET_ACTS.jugglePebbles;
FIDGET_ACTS.polish = FIDGET_ACTS.polishAccessory;
