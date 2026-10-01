/**
 * Critter motion, pure (no three): each function writes rig channels (see the channel tables in models.ts) and a
 * body transform for one moment of a loop. The valley systems and the gallery call the same functions, so what the
 * flipbooks show is what flies over the valley.
 */

export interface Body {
  /** height offset (m, model scale 1) */
  y: number;
  /** nose down + (rad) */
  pitch: number;
  roll: number;
  /** squash & stretch */
  sx: number; sy: number; sz: number;
}
export const body = (): Body => ({ y: 0, pitch: 0, roll: 0, sx: 1, sy: 1, sz: 1 });
const reset = (b: Body) => { b.y = 0; b.pitch = 0; b.roll = 0; b.sx = 1; b.sy = 1; b.sz = 1; };

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (t: number) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const fract = (v: number) => v - Math.floor(v);
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------
// Birds

/**
 * One wingbeat at phase 0..1: a strong downstroke with the wing fully spread, then the upstroke with the wrist
 * flexed and the hand swept back (small birds fold on the recovery stroke), the wing opening again at the top.
 * Writes flap (ch 0), fold (ch 1), sweep (ch 9). `depth` scales the stroke (crows: deeper, slower).
 */
export function wingbeat(ph: number, ch: Float32Array, depth = 1): void {
  const p = fract(ph);
  if (p < 0.5) {
    const u = p / 0.5;
    ch[0] = lerp(1.05, -0.8, smooth(u)) * depth;
    ch[1] = Math.max(0, 0.35 - u * 1.6);
    ch[9] = -0.08 * Math.sin(Math.PI * u);
  } else {
    const u = (p - 0.5) / 0.5;
    ch[0] = lerp(-0.8, 1.05, u * u * (3 - 2 * u)) * depth;
    ch[1] = Math.sin(Math.PI * Math.min(1, u * 1.15)) * 0.95;
    ch[9] = 0.3 * Math.sin(Math.PI * u);
  }
}

export type AirMode = 'flap' | 'glide' | 'bound' | 'flare' | 'soar';

/**
 * A bird in the air: ch (12) + body. `ph` = wingbeat phase, `t` = seconds (glide wobble).
 *  flap: powered; glide: wings spread, slight dihedral; bound: wings tucked (the finch-like undulating flight);
 *  flare: landing — wings up and forward, fast shallow beats, tail fanned down, legs out; soar: crows' long glides.
 */
export function birdAir(mode: AirMode, ph: number, t: number, ch: Float32Array, b: Body, depth = 1): void {
  ch.fill(0); reset(b);
  ch[8] = 1; // legs tucked
  switch (mode) {
    case 'flap': wingbeat(ph, ch, depth); b.y = -Math.sin(fract(ph) * TAU) * 0.012; ch[2] = 0.08; break;
    case 'glide': ch[0] = 0.14 + Math.sin(t * 2.3) * 0.04; ch[1] = 0.08; ch[9] = 0.05; ch[7] = 0.4; break;
    case 'soar': ch[0] = 0.1 + Math.sin(t * 1.3) * 0.05; ch[1] = 0; ch[9] = -0.05; ch[7] = 0.8; b.roll = Math.sin(t * 0.9) * 0.08; break;
    case 'bound': ch[0] = -0.05; ch[1] = 1; ch[9] = 0.9; ch[5] = -0.1; b.sz = 1.05; break;
    case 'flare': {
      wingbeat(ph, ch, 0.55);
      ch[0] += 0.55; ch[9] = -0.45; ch[1] *= 0.4;
      ch[7] = 1; ch[5] = -0.55; ch[8] = 0; ch[2] = -0.25;
      b.pitch = -0.55;
      break;
    }
  }
}

/** a perched / ground bird: wings tucked away, head and tail doing the talking */
export function birdGround(ch: Float32Array, b: Body, peck: number, look: number, tilt: number, tail: number, hopK: number): void {
  ch.fill(0); reset(b);
  ch[4] = -1; ch[0] = -0.3;
  ch[2] = Math.sin(clamp(peck, 0, 1) * Math.PI) * 1.05;
  ch[3] = look; ch[6] = tilt;
  ch[5] = tail; ch[7] = tail > 0.3 ? 0.4 : 0;
  // a hop: crouch, spring (legs trail), land with a squash and a tail flick
  if (hopK > 0 && hopK < 1) {
    b.y = Math.sin(hopK * Math.PI) * 0.06;
    ch[8] = Math.sin(hopK * Math.PI) * 0.5;
    const land = clamp((hopK - 0.75) / 0.25, 0, 1);
    b.sy = 1 + Math.sin(hopK * Math.PI) * 0.08 - Math.sin(land * Math.PI) * 0.12;
    b.sx = b.sz = 1 / Math.sqrt(b.sy);
    ch[5] += Math.sin(land * Math.PI) * 0.5;
  }
}

/**
 * Pigeon strut at stride phase 0..1 (two steps per cycle): the famous head-bob (the head holds still in the world
 * while the body walks under it, then thrusts forward), alternating legs, a little body sway. `len` = step length.
 */
export function pigeonStrut(ph: number, len: number, ch: Float32Array, b: Body): void {
  ch.fill(0); reset(b);
  ch[4] = -1; ch[0] = -0.3;
  const p = fract(ph * 2);
  // hold for 70% of each step (head moves back relative to the body at walking speed), thrust in the last 30%
  const hold = 0.7;
  ch[10] = p < hold ? lerp(len * 0.5, -len * 0.5, p / hold) : lerp(-len * 0.5, len * 0.5, smooth((p - hold) / (1 - hold)));
  ch[2] = p < hold ? 0 : Math.sin(((p - hold) / (1 - hold)) * Math.PI) * 0.15;
  const s = Math.sin(ph * TAU);
  ch[8] = s * 0.55; ch[11] = -s * 0.55;
  b.roll = s * 0.06; b.y = Math.abs(Math.cos(ph * TAU)) * 0.008;
  ch[5] = 0.1;
}

// ---------------------------------------------------------------------------------------------
// Rabbits

/**
 * One hop at progress 0..1: push-off, a stretched body in the air (hind legs trailing, fore legs reaching, ears
 * streaming back), front paws land first, the hind legs swing through past them, a squash, ears flop forward.
 * `h` = height of the hop (m); ch 7 fore, 8 hind, 2/3 ears; body y/pitch/stretch.
 */
export function rabbitHop(k: number, h: number, ch: Float32Array, b: Body): void {
  reset(b);
  const air = clamp((k - 0.12) / 0.62, 0, 1);
  b.y = Math.sin(air * Math.PI) * h;
  // push: hind legs extend back through the push and the flight; then swing forward under the body to land
  const push = smooth(k / 0.3);
  const gather = smooth((k - 0.55) / 0.3);
  ch[8] = push * 1.25 * (1 - gather) - gather * 0.75 * (1 - smooth((k - 0.85) / 0.15));
  ch[7] = -smooth((k - 0.1) / 0.3) * 0.95 * (1 - smooth((k - 0.62) / 0.2)) + smooth((k - 0.62) / 0.15) * 0.35 * (1 - smooth((k - 0.85) / 0.15));
  const stretch = Math.sin(air * Math.PI);
  b.sz = 1 + stretch * 0.24 - Math.sin(clamp((k - 0.74) / 0.26, 0, 1) * Math.PI) * 0.14;
  b.sy = 1 - stretch * 0.1 + Math.sin(clamp((k - 0.74) / 0.26, 0, 1) * Math.PI) * 0.08;
  b.sx = 1 / Math.sqrt(b.sy * b.sz);
  b.pitch = lerp(0.35, -0.3, air) * Math.sin(air * Math.PI) + (k < 0.12 ? 0.12 * Math.sin((k / 0.12) * Math.PI) : 0);
  // ears: stream back in the air, flop forward past upright on landing (a damped overshoot)
  const land = clamp((k - 0.74) / 0.26, 0, 1);
  const ear = stretch * 0.75 - Math.sin(land * Math.PI * 1.5) * Math.exp(-land * 2) * 0.55;
  ch[2] = ear; ch[3] = ear * 0.92;
  ch[0] = -stretch * 0.15;
}

export interface RabbitIdle { nibble: number; groom: number; alert: number; earL: number; earR: number; turnL: number; turnR: number }

/** grazing / grooming / alert: head, nose twitch (fast bursts), ears. Body pitch lifts for sitting up. */
export function rabbitIdle(t: number, s: RabbitIdle, ch: Float32Array, b: Body): void {
  reset(b);
  const chew = Math.max(0, Math.sin(t * 11)) * 0.12;
  ch[0] = s.nibble * (0.6 + chew) - s.alert * 0.25 + s.groom * (0.25 + Math.sin(t * 7) * 0.12);
  // nose: bursts of fast twitches, faster when alert
  const burst = (Math.sin(t * 1.7) > -0.2 ? 1 : 0) * (1 + s.alert);
  ch[6] = Math.max(0, Math.sin(t * (18 + s.alert * 8))) * 0.18 * burst;
  ch[2] = s.earL * 0.6 - s.alert * 0.2 + s.groom * 0.35; ch[3] = s.earR * 0.6 - s.alert * 0.2 + s.groom * 0.35;
  ch[4] = s.turnL - s.alert * 0.2; ch[5] = s.turnR - s.alert * 0.2;
  // grooming: sit back, both fore paws up and over the face in little strokes
  ch[7] = -s.groom * (2.0 + Math.sin(t * 7) * 0.35);
  ch[8] = -s.groom * 0.3;
  b.pitch = -s.groom * 0.75 - s.alert * 0.32;
  b.y = s.groom * 0.02 + s.alert * 0.015;
}

// ---------------------------------------------------------------------------------------------
// Squirrels

/** bounding run at phase 0..1 (fore and hind legs alternate, the back arches and extends, the tail waves) */
export function squirrelBound(ph: number, h: number, ch: Float32Array, b: Body): void {
  reset(b);
  const p = fract(ph);
  const s = Math.sin(p * TAU);
  b.y = Math.max(0, Math.sin(p * TAU - 0.4)) * h;
  b.pitch = -s * 0.28;
  b.sz = 1 + Math.cos(p * TAU) * 0.12; b.sy = 1 - Math.cos(p * TAU) * 0.06;
  ch[5] = -s * 0.8; ch[6] = s * 0.9;
  ch[2] = -0.35 + s * 0.35; ch[3] = 0.6 + Math.sin(p * TAU - 1) * 0.4; ch[4] = 0.5 + Math.sin(p * TAU - 2) * 0.5;
  ch[0] = s * 0.12;
  ch[7] = -1;
}

/** the tail's resting S-curve and its flicks (chatter), `excite` 0..1; writes ch 2..4 */
export function squirrelTail(t: number, excite: number, ch: Float32Array): void {
  const f = excite > 0 ? Math.sin(t * 16) * excite : 0;
  ch[2] = 0.15 + Math.sin(t * 1.3) * 0.08 + f * 0.25;
  ch[3] = -0.35 + Math.sin(t * 1.3 - 0.8) * 0.12 + f * 0.4;
  ch[4] = 0.85 + Math.sin(t * 1.3 - 1.6) * 0.18 + f * 0.6;
}

// ---------------------------------------------------------------------------------------------
// Frogs

/** jump at progress 0..1: crouch, hind legs fully extend, arms reach, tuck for the landing */
export function frogJump(k: number, h: number, ch: Float32Array, b: Body): void {
  reset(b);
  const air = clamp((k - 0.1) / 0.8, 0, 1);
  b.y = Math.sin(air * Math.PI) * h;
  const ext = Math.sin(clamp(air / 0.45, 0, 1) * Math.PI * 0.5) * (1 - smooth((air - 0.55) / 0.4));
  ch[2] = ext * 1.5 - (k < 0.1 ? Math.sin(k / 0.1 * Math.PI) * 0.2 : 0);
  ch[3] = ext * 2.2;
  ch[4] = -ext * 0.9 + smooth((air - 0.7) / 0.3) * 0.2;
  b.pitch = -0.5 * Math.sin(air * Math.PI) * (1 - air) + 0.35 * Math.sin(air * Math.PI) * air;
  b.sz = 1 + ext * 0.2; b.sy = 1 - ext * 0.08;
  if (k < 0.1) b.sy -= Math.sin(k / 0.1 * Math.PI) * 0.12;
  ch[0] = -0.55; ch[1] = 0;
}

/** sitting frog: throat pulse (croak 0..1 envelope), breathing throat flutter, blink (0..1) */
export function frogIdle(t: number, croak: number, blink: number, ch: Float32Array, b: Body): void {
  reset(b);
  const flutter = Math.sin(t * 9) * 0.04;
  ch[0] = -0.55 + flutter + croak * (1.05 + Math.sin(t * 22) * 0.08);
  ch[1] = -0.9 * blink;
  ch[2] = 0; ch[3] = 0; ch[4] = 0;
  b.sy = 1 + Math.sin(t * 2) * 0.025 + croak * 0.03;
}

// ---------------------------------------------------------------------------------------------
// Fish, butterflies, dragonflies

/** body wave: a travelling wave down the body, amplitude growing to the tail. `speed` 0..1 */
export function fishWave(t: number, speed: number, ch: Float32Array): void {
  const w = t * (5 + speed * 14), a = 0.12 + speed * 0.25;
  ch[0] = Math.sin(w) * a * 0.5;
  ch[1] = Math.sin(w - 0.9) * a * 0.9;
  ch[2] = Math.sin(w - 1.8) * a * 1.3;
  ch[3] = 0.4 + Math.sin(t * 7) * 0.25;
}

/**
 * Butterfly wings. `mode` fly: bursts of beats with little glides (wings held half open); rest: slow open/close
 * (basking on a flower). ch 0 fore, 1 hind (lags), 2 antennae bob. Returns the beat's lift (0..1) for the bob.
 */
export function butterflyWings(t: number, mode: 'fly' | 'rest', seed: number, ch: Float32Array): number {
  if (mode === 'rest') {
    const s = 0.5 + 0.5 * Math.sin(t * 1.4 + seed);
    ch[0] = 0.05 + s * 1.15; ch[1] = 0.05 + (0.5 + 0.5 * Math.sin(t * 1.4 + seed - 0.3)) * 1.1; ch[2] = Math.sin(t * 2.2 + seed) * 0.1;
    return 0;
  }
  // 4–6 beats, then a short glide
  const cyc = (t * 0.9 + seed) % 1;
  const gliding = cyc > 0.72;
  const w = t * 17 + seed * 10;
  const beat = Math.sin(w);
  ch[0] = gliding ? 0.35 + Math.sin(t * 3) * 0.05 : 0.5 + beat * 0.85;
  ch[1] = gliding ? 0.3 : 0.5 + Math.sin(w - 0.35) * 0.8;
  ch[2] = beat * 0.08;
  return gliding ? 0 : Math.max(0, -Math.cos(w));
}

/** dragonfly: fore and hind pairs beat out of phase; `hover` 0..1 blurs them faster and shallower */
export function dragonWings(t: number, seed: number, perched: boolean, ch: Float32Array): void {
  if (perched) { ch[0] = -0.05; ch[1] = -0.08; ch[2] = Math.sin(t * 1.3 + seed) * 0.05; return; }
  const w = t * 58 + seed;
  ch[0] = Math.sin(w) * 0.4 + 0.08;
  ch[1] = Math.sin(w + 1.9) * 0.4 + 0.05;
  ch[2] = Math.sin(t * 3 + seed) * 0.06;
}
