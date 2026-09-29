// @pure
/**
 * Shelly activities (DESIGN §6.7 Shelly table, all at its ENG bench). Written in Shelly's HEAD frame (origin at the
 * head node, CRT centre y +0.16, screen at z +0.17; arms on the CRT's lower sides, `SHELLY_ARM`), flagged `shelly:
 * true` so the Shelly animator takes the arm channels as-is. `face` names a screen glyph (shellyAnimator GLYPHS);
 * `lookX/lookY` move the dot eyes of the `watch` / `talk` glyphs; `l0y` is a wheel bounce. Owner: CHR.
 *
 *   prompt  cursorTap     taps the blinking cursor on its face, sips a green drink
 *   edit    knit          knits; a code-scarf grows
 *   test    juggle        juggles 3 balls (the exit bow is the brain's `bow` reaction)
 *   serve   crank         turns a hand-crank generator (the bench bulb is ENV/STAT)
 *   monitor newspaper     reads a newspaper whose pages show mini bars
 *   remote  walkie        talks into a walkie-talkie; antenna LED blinks
 *   repl    cocktail      shakes a cocktail shaker
 *   git     sortEnvelopes sorts envelopes into a rack
 *   build   shovel        shovels coal into the rack furnace door
 *   run     spinnerWatch  taps a foot (wheel bounce), watching a spinner on its face
 */
import { CH, MASK_ALL, type Pose } from '../pose.ts';
import { reach, SHELLY_ARM as G } from '../ik.ts';
import { TAU, hold, hump, sat, saw, snap } from './common.ts';
import type { Activity } from './index.ts';

const R = (p: Pose, side: number, x: number, y: number, z: number, w = 1): void => reach(p, side, x, y, z, w, G);
const sh = (id: string, face: string, prop: string | null, update: Activity['update']): Activity => ({ id, mask: MASK_ALL, sit: false, face, prop, shelly: true, update });

/**
 * [CHR fix m15-r1] Props are built 1.6× (rig/shelly.ts SHELLY_PROP_SCALE; duplicated here to keep this module
 * three-free, a test pins them equal) and held BESIDE or in FRONT of the screen, never under the chin where the bench
 * and chair hid them; the cable arms swing out in wide reach arcs, so each activity reads from the ENG bench at 4–5 m
 * without its bubble. Screen: centre y 0.16, bottom edge y 0.055, CRT x ±0.21, glass z 0.17.
 */
export const K = 1.6;

export const cursorTap = sh('cursorTap', 'prompt', 'drink', (t, p) => {
  const f = p.f;
  const c = t % 5.2;
  const tap = c < 0.9 ? Math.abs(Math.sin((c / 0.9) * TAU * 1.5)) : 0;
  R(p, 1, 0.05, 0.11, 0.2 + 0.05 * tap); // taps the blinking cursor on its own face
  f[CH.pitch] = 0.06 * tap;
  // the drink rests up beside the screen; a sip swings it in to the screen's corner (the straw at the "mouth")
  const sip = c > 2.4 && c < 4.2 ? hump(c - 2.4, 1.8) : 0;
  const k = sat(sip * 1.6);
  const x = -0.33 + 0.15 * k, y = 0.2 - 0.06 * k, z = 0.12 + 0.12 * k;
  hold(p, 'drink', x, y, z, 0, 0, 0.45 * k);
  R(p, -1, x, y - 0.04, z);
  if (sip > 0.6) p.face = 'happy';
  f[CH.l0y] = 0.008 * Math.max(0, Math.sin(TAU * 0.5 * t));
});

export const knit = sh('knit', 'insert', 'knit', (t, p) => {
  const f = p.f;
  const clk = saw(t, 1.6);
  // needles up beside the right edge of the screen, the code-scarf hanging down past the CRT's side
  const X = 0.33, Y = 0.2, Z = 0.2;
  hold(p, 'knit', X, Y, Z, 0, -0.35, 0);
  f[CH.propA] = sat(saw(t, 1 / 40) * 1.05); f[CH.propB] = clk;
  const c = Math.sin(clk * TAU);
  // both claws on the needles: the far arm sweeps across the front of the chin in a big arc on each stitch
  R(p, -1, X - 0.08 * K + 0.03 * c, Y + 0.05 + 0.03 * Math.abs(c), Z + 0.04);
  R(p, 1, X + 0.08 * K - 0.03 * c, Y + 0.05 + 0.03 * Math.abs(c), Z);
  f[CH.pitch] = 0.05; f[CH.roll] = -0.06 + 0.04 * Math.sin(TAU * 0.3 * t); f[CH.twist] = 0.12;
  f[CH.lookX] = 0.5;
});

export const juggle = sh('juggle', 'watch', 'balls', (t, p) => {
  const f = p.f;
  hold(p, 'balls', 0, 0.02, 0.3);
  const ph = t * 1.4;
  f[CH.propA] = ph; f[CH.propB] = 0.4;
  const u = saw(ph * 3, 0.5);
  R(p, -1, -0.2, 0.0 + 0.06 * Math.sin(u * TAU), 0.3); R(p, 1, 0.2, 0.0 + 0.06 * Math.sin(u * TAU + Math.PI), 0.3);
  f[CH.lookY] = 0.4 * Math.sin(TAU * 1.4 * t); f[CH.lookX] = 0.6 * Math.sin(TAU * 0.7 * t);
  f[CH.roll] = 0.05 * Math.sin(TAU * 0.7 * t);
  f[CH.l0y] = 0.01 * Math.abs(Math.sin(TAU * 1.4 * t));
});

export const crank = sh('crank', 'busy', 'crank', (t, p) => {
  const f = p.f;
  const a = TAU * 1.2 * t;
  // the generator box sits beside the right of the screen; the handle circles out past it in a big wheel
  const X = 0.4, Y = 0.1, Z = 0.14;
  hold(p, 'crank', X, Y, Z);
  f[CH.propA] = a;
  // handle = root + K·((0.09 + 0.04), 0.085·cos a, 0.085·sin a)  (rig/props.ts crank)
  R(p, 1, X + 0.13 * K, Y + 0.085 * K * Math.cos(a), Z + 0.085 * K * Math.sin(a));
  R(p, -1, X - 0.02, Y + 0.06 * K + 0.02, Z); // the other claw pins the box down
  f[CH.pitch] = 0.06 + 0.04 * Math.sin(a); f[CH.roll] = -0.1 + 0.08 * Math.cos(a); f[CH.twist] = 0.15;
  f[CH.sq] = 0.04 * Math.sin(a * 2);
});

export const newspaper = sh('newspaper', 'watch', 'newspaper', (t, p) => {
  const f = p.f;
  const turn = (t % 6) > 5.4 ? hump((t % 6) - 5.4, 0.6) : 0;
  // the broadsheet up in front of the screen, the dot eyes peeking over its top edge as they scan the lines
  hold(p, 'newspaper', 0, -0.035, 0.3, -0.12, 0, 0.03 * Math.sin(t * 0.6));
  f[CH.propA] = 1 - 0.7 * turn;
  R(p, -1, -0.19 * K, -0.02, 0.29); R(p, 1, 0.19 * K, -0.02, 0.29);
  const line = saw(t, 0.7);
  f[CH.lookX] = line < 0.85 ? -0.7 + 1.4 * (line / 0.85) : 0.7 - 1.4 * ((line - 0.85) / 0.15);
  f[CH.lookY] = 0.9; // eyes up at the top of the screen, over the paper
  f[CH.pitch] = 0.04 + 0.05 * turn;
});

export const walkie = sh('walkie', 'talk', 'walkie', (t, p) => {
  const f = p.f;
  hold(p, 'walkie', 0.31, 0.22, 0.14, 0, 0, -0.25);
  f[CH.propA] = saw(t, 2) < 0.5 ? 1 : 0;
  R(p, 1, 0.31, 0.16, 0.14);
  const g = Math.sin(TAU * 0.8 * t);
  R(p, -1, -0.3 - 0.06 * g, 0.16 + 0.12 * Math.abs(g), 0.2); // big "over!" gestures with the free claw
  f[CH.roll] = -0.1 + 0.04 * g; f[CH.pitch] = 0.05 * Math.sin(TAU * 1.3 * t);
  f[CH.lookX] = 0.3;
});

export const cocktail = sh('cocktail', 'happy', 'shaker', (t, p) => {
  const f = p.f;
  const s = Math.sin(TAU * 4 * t);
  const y = 0.24 + 0.08 * s;
  hold(p, 'shaker', 0.32, y, 0.16, 0, 0, 0.45 + 0.25 * s);
  R(p, 1, 0.34, y - 0.06, 0.16); R(p, -1, 0.26, y + 0.1, 0.2);
  f[CH.roll] = 0.08 * s; f[CH.twist] = 0.1 * Math.sin(TAU * 0.5 * t);
  f[CH.l0y] = 0.012 * Math.abs(s);
});

export const sortEnvelopes = sh('sortEnvelopes', 'watch', 'envelopes', (t, p) => {
  const f = p.f;
  const u = saw(t, 1.0), slot = Math.floor(t * 1.0) % 3;
  // the rack stands out front-right of the screen at chin height; each envelope arcs from the claw into a slot
  const X = 0.3, Y = 0.2, Z = 0.14;
  hold(p, 'envelopes', X, Y, Z, 0, -0.4, 0);
  const k = u < 0.6 ? snap(u / 0.6, 1.4) : 0;
  f[CH.propA] = k; f[CH.propB] = slot / 3 + 0.1;
  // envelope = root + K·((−0.08 + 0.08·slot)·k, 0.06·sin(kπ) − 0.04·k, 0.1·k) (rig/props.ts), rack rotated −0.4 about y
  const ex = (-0.08 + slot * 0.08) * k * K, ez = 0.1 * k * K, cy = Math.cos(-0.4), sy = Math.sin(-0.4);
  R(p, 1, X + ex * cy + ez * sy, Y + (0.06 * Math.sin(k * Math.PI) - 0.04 * k) * K - 0.02, Z - ex * sy + ez * cy);
  // the other claw fetches the next one from the in-tray on the left, a wide swing across the front
  const fetch = u > 0.6 ? hump(u - 0.6, 0.4) : 0;
  R(p, -1, -0.28 + 0.4 * fetch, 0.12 + 0.1 * fetch, 0.18 + 0.06 * fetch);
  f[CH.lookX] = 0.5 + 0.3 * (slot - 1) * k; f[CH.lookY] = -0.2;
  f[CH.twist] = 0.1 + 0.08 * (slot - 1) * k;
});

export const shovel = sh('shovel', 'strain', 'shovel', (t, p) => {
  const f = p.f;
  const u = saw(t, 0.7);
  // dig (0–0.45: blade out and down, load) → heave (0.45–0.7) → throw (0.7–1: the blade flings up with the coal).
  // Held beside the right of the screen, the shaft slanting out so the blade swings wide of the CRT.
  const dig = u < 0.45 ? u / 0.45 : 0, heave = u >= 0.45 && u < 0.7 ? (u - 0.45) / 0.25 : 0, thr = u >= 0.7 ? (u - 0.7) / 0.3 : 0;
  const tilt = -0.4 * dig - 0.4 * (1 - heave) * (heave > 0 ? 1 : 0) + 0.8 * snap(thr, 1.2);
  const out = 0.75 + 0.35 * dig - 0.2 * thr; // shaft slant (rad about z, + = blade out to the right)
  const x = 0.26 + 0.04 * dig, y = 0.3 - 0.08 * dig + 0.06 * heave + 0.08 * thr, z = 0.18 + 0.06 * thr;
  hold(p, 'shovel', x, y, z, tilt, 0, out);
  f[CH.propA] = (u > 0.3 && u < 0.85) ? 1 : 0;
  R(p, 1, x, y - 0.02, z); // top grip
  const d = 0.12 * K; // lower claw 0.12 (×K) down the shaft
  R(p, -1, x + Math.sin(out) * d, y - Math.cos(out) * d * Math.cos(tilt), z + Math.sin(tilt) * d * 0.5);
  f[CH.pitch] = 0.2 * dig - 0.12 * thr; f[CH.sq] = -0.08 * dig + 0.06 * thr; f[CH.roll] = -0.08 * dig;
  f[CH.twist] = 0.12;
  f[CH.l0y] = 0.02 * thr;
});

export const spinnerWatch = sh('spinnerWatch', 'busy', null, (t, p) => {
  const f = p.f;
  f[CH.l0y] = Math.max(0, Math.sin(TAU * 2.5 * t)) * 0.022; // foot-tap → wheel bounce
  f[CH.roll] = 0.05 * Math.sin(TAU * 1.25 * t);
  const tap = Math.abs(Math.sin(TAU * 1.25 * t));
  R(p, 1, 0.1, -0.02 + 0.02 * tap, 0.18); // claw drumming on the chin ledge
  R(p, -1, -0.24, -0.1, 0.02);
  f[CH.pitch] = -0.04;
});
