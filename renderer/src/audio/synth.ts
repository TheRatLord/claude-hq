// @pure
/**
 * Offline DSP for the audio kit (§6.7 / §8 notifications / §6.10 steps): every one-shot is rendered **once** into a
 * Float32Array at boot (≈ 60 ms of CPU total) and later played as a plain AudioBufferSource, so a footstep, a
 * keyclick or a desk-bell ding costs 2–3 audio nodes at play time and no filters. No samples, no fetches: all
 * additive / subtractive synthesis in plain JS. Node-testable (no WebAudio here).
 * Owner: AUD.
 */
import { hash32, mulberry32 } from '../../../shared/identity.ts';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------------- primitives

/** A rendered mono buffer (ArrayBuffer-backed, so it can be handed straight to `AudioBuffer.copyToChannel`). */
export type Samples = Float32Array<ArrayBuffer>;
type Rng = () => number;
type FilterType = 'lp' | 'hp' | 'bp';

const buf = (sr: number, sec: number): Samples => new Float32Array(Math.max(1, Math.ceil(sr * sec)));

/** RBJ biquad (bandpass constant-peak / lowpass / highpass), per-sample, mutable coefficients. */
export function biquad(type: FilterType, f: number, q: number, sr: number) {
  let b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const set = (freq: number, Q = q) => {
    const w = TAU * Math.min(freq, sr * 0.45) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * Q);
    const a0 = 1 + al;
    if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; }
    else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; }
    else { b0 = al; b1 = 0; b2 = -al; } // 'bp' (0 dB peak)
    a1 = -2 * c; a2 = 1 - al;
    b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  };
  set(f);
  const run = (x: number) => {
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
  return { run, set };
}

/** Exponential decay env with a short linear attack. */
const env = (t: number, atk: number, tau: number): number => (t < 0 ? 0 : t < atk ? t / atk : Math.exp(-(t - atk) / tau));

/** Add a decaying sine partial into `out`. */
interface PartialOpts { f: number; amp: number; tau: number; t0?: number; atk?: number; f1?: number; glide?: number; phase?: number }
function partial(out: Samples, sr: number, { f, amp, tau, t0 = 0, atk = 0.002, f1 = f, glide = 0.05, phase = 0 }: PartialOpts) {
  let ph = phase;
  const i0 = Math.floor(t0 * sr);
  const n = Math.min(out.length - i0, Math.ceil((atk + tau * 7) * sr));
  if (f1 === f) { // fast path (bells, marimba): rotating phasor + multiplicative decay, no transcendental per sample
    const w = TAU * f / sr, cr = Math.cos(w), ci = Math.sin(w), k = Math.exp(-1 / (tau * sr)), na = Math.max(1, Math.round(atk * sr));
    let re = Math.cos(phase), im = Math.sin(phase), e = amp;
    for (let i = 0; i < n; i++) {
      out[i0 + i] += (i < na ? amp * i / na : (e *= k)) * im;
      const r2 = re * cr - im * ci; im = re * ci + im * cr; re = r2;
    }
    return;
  }
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const fr = f1 + (f - f1) * Math.exp(-t / glide);
    ph += TAU * fr / sr;
    out[i0 + i] += amp * env(t, atk, tau) * Math.sin(ph);
  }
}

/** Add filtered noise with an exp envelope (the transient of most foley). */
interface NoiseOpts { type?: FilterType; f?: number; q?: number; amp?: number; tau?: number; t0?: number; atk?: number; f1?: number; sweep?: number }
function noiseHit(out: Samples, sr: number, rnd: Rng, { type = 'bp', f = 2000, q = 1, amp = 1, tau = 0.02, t0 = 0, atk = 0.001, f1 = f, sweep = 0 }: NoiseOpts) {
  const flt = biquad(type, f, q, sr);
  const i0 = Math.floor(t0 * sr);
  const n = Math.min(out.length - i0, Math.ceil((atk + tau * 7) * sr));
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if (sweep && (i & 31) === 0) flt.set(f1 + (f - f1) * Math.exp(-t / sweep));
    out[i0 + i] += amp * env(t, atk, tau) * flt.run(rnd() * 2 - 1);
  }
}

/** Peak-normalise to `peak` and fade the tail out (no clicks at the buffer end). */
export function finish<T extends Float32Array>(out: T, peak = 0.9, fadeMs = 8, sr = 48000): T {
  let m = 0;
  for (let i = 0; i < out.length; i++) m = Math.max(m, Math.abs(out[i]));
  const k = m > 0 ? peak / m : 0;
  const fade = Math.min(out.length, Math.floor(sr * fadeMs / 1000));
  for (let i = 0; i < out.length; i++) {
    const j = out.length - 1 - i;
    out[i] *= k * (j < fade ? j / fade : 1);
  }
  return out;
}

const rngFor = (key: string): Rng => mulberry32(hash32(key));

// ---------------------------------------------------------------------------------------------------- footsteps

/**
 * Surface → footstep character. `player.step {surface}` (controller ZONE_SURFACE + stairs) picks one of these; unknown
 * surfaces fall back to `floor` (bay vinyl).
 */
export const SURFACES: readonly string[] = Object.freeze(['floor', 'tile', 'rug', 'carpet', 'wood', 'stairs', 'metal', 'slide']);
/** Relative loudness per surface (soft floors are quieter, metal grating rings a little). */
export const SURFACE_GAIN: Readonly<Record<string, number>> = Object.freeze({ floor: 0.8, tile: 0.95, rug: 0.6, carpet: 0.55, wood: 0.95, stairs: 1.05, metal: 0.6, slide: 0.8 });

export function renderStep(surface: string, variant: number, sr: number, land = false): Samples {
  const r = rngFor(`step|${surface}|${variant}|${land}`);
  const j = (a: number) => 1 + (r() - 0.5) * a; // jitter
  const L = land ? 1.7 : 1;
  const out = buf(sr, land ? 0.45 : 0.3);
  // every step: a soft body thump under the surface texture (the "clay creature" weight)
  partial(out, sr, { f: 95 * j(0.2) / (land ? 1.3 : 1), f1: 140, glide: 0.02, amp: 0.35 * L, tau: land ? 0.07 : 0.035, atk: 0.003 });
  switch (surface) {
    case 'tile': // crisp heel click + a lighter toe tap
      noiseHit(out, sr, r, { f: 3300 * j(0.25), q: 1.3, amp: 1.0 * L, tau: 0.011 });
      partial(out, sr, { f: 1250 * j(0.2), amp: 0.12, tau: 0.02 });
      noiseHit(out, sr, r, { f: 4400 * j(0.25), q: 1.6, amp: 0.45, tau: 0.008, t0: 0.028 * j(0.3) });
      break;
    case 'wood': case 'stairs': { // hollow board knock; stairs lower + a riser boom
      const low = surface === 'stairs' ? 0.8 : 1;
      partial(out, sr, { f: 205 * low * j(0.15), f1: 260 * low, glide: 0.01, amp: 0.5 * L, tau: 0.05 });
      partial(out, sr, { f: 470 * low * j(0.15), amp: 0.22, tau: 0.03 });
      noiseHit(out, sr, r, { f: 1900 * j(0.3), q: 1.4, amp: 1.1 * L, tau: 0.012 });
      if (r() < 0.25 && !land) partial(out, sr, { f: 640 * j(0.1), f1: 590, glide: 0.08, amp: 0.05, tau: 0.09, t0: 0.03 }); // tiny creak
      break;
    }
    case 'metal': // perforated grating: a sharp tick and an inharmonic ring
      noiseHit(out, sr, r, { f: 2900 * j(0.2), q: 2.2, amp: 0.9 * L, tau: 0.01 });
      for (const [ratio, a, tau] of [[1, 0.16, 0.14], [1.63, 0.1, 0.1], [2.57, 0.07, 0.08], [3.62, 0.05, 0.06]]) {
        partial(out, sr, { f: 690 * ratio * j(0.06), amp: a * L, tau, phase: r() * TAU });
      }
      break;
    case 'rug': case 'carpet': // muffled: dull low noise, a little scuff
      noiseHit(out, sr, r, { type: 'lp', f: surface === 'rug' ? 850 : 650, q: 0.8, amp: 1.1 * L, tau: 0.03, atk: 0.004 });
      noiseHit(out, sr, r, { f: 2200, q: 0.7, amp: 0.08, tau: 0.035, t0: 0.02 });
      break;
    case 'slide': // plastic: a bright "tok"
      partial(out, sr, { f: 820 * j(0.1), f1: 1100, glide: 0.006, amp: 0.4 * L, tau: 0.03 });
      noiseHit(out, sr, r, { f: 2400, q: 2, amp: 0.4 * L, tau: 0.01 });
      break;
    default: // 'floor': bay vinyl / sealed concrete: short soft click
      noiseHit(out, sr, r, { f: 1700 * j(0.25), q: 1.0, amp: 0.9 * L, tau: 0.014 });
      noiseHit(out, sr, r, { f: 3600 * j(0.2), q: 1.4, amp: 0.2, tau: 0.006, t0: 0.022 * j(0.3) });
  }
  return finish(out, land ? 0.95 : 0.8, 10, sr);
}

// ---------------------------------------------------------------------------------------------------- keyboard

/** A single mechanical-ish keystroke; variant 5 is the spacebar (lower, with a stabiliser rattle). */
export function renderKey(variant: number, sr: number): Samples {
  const r = rngFor(`key|${variant}`);
  const out = buf(sr, 0.09);
  const space = variant === 5;
  const j = (a: number) => 1 + (r() - 0.5) * a;
  noiseHit(out, sr, r, { f: (space ? 2600 : 4700) * j(0.3), q: 1.4, amp: 1, tau: 0.004 });
  partial(out, sr, { f: (space ? 380 : 1900) * j(0.25), amp: 0.28, tau: space ? 0.02 : 0.009 });
  partial(out, sr, { f: (space ? 160 : 260) * j(0.2), amp: 0.35, tau: 0.012 }); // bottom-out thock
  if (space) noiseHit(out, sr, r, { f: 5200, q: 3, amp: 0.25, tau: 0.004, t0: 0.012 });
  noiseHit(out, sr, r, { f: 5600 * j(0.2), q: 2, amp: 0.25, tau: 0.003, t0: 0.045 * j(0.4) }); // release
  return finish(out, 0.8, 5, sr);
}

// ---------------------------------------------------------------------------------------------------- tuned percussion

export const NOTE = (n: number): number => 440 * 2 ** ((n - 69) / 12); // MIDI → Hz

/** Marimba: fundamental + the bar's 4th / 10th partials + a felt mallet knock. */
function marimbaInto(out: Samples, sr: number, f: number, t0: number, amp: number, r: Rng) {
  partial(out, sr, { f, amp, tau: 0.32, t0, atk: 0.002, phase: 0 });
  partial(out, sr, { f: f * 3.93, amp: amp * 0.22, tau: 0.045, t0, atk: 0.001 });
  partial(out, sr, { f: f * 9.9, amp: amp * 0.06, tau: 0.012, t0, atk: 0.001 });
  noiseHit(out, sr, r, { type: 'lp', f: 1400, q: 0.7, amp: amp * 0.25, tau: 0.004, t0 });
}

/** Glockenspiel / desk-bell tone: bright, long, with a slow shimmer from a detuned twin. */
function bellInto(out: Samples, sr: number, f: number, t0: number, amp: number, r: Rng, { tau = 1.1, bright = 1 }: { tau?: number; bright?: number } = {}) {
  partial(out, sr, { f, amp, tau, t0, atk: 0.001 });
  partial(out, sr, { f: f * 1.0035, amp: amp * 0.5, tau: tau * 0.9, t0, atk: 0.001 });
  partial(out, sr, { f: f * 2.76, amp: amp * 0.32 * bright, tau: tau * 0.28, t0, atk: 0.001 });
  partial(out, sr, { f: f * 5.4, amp: amp * 0.14 * bright, tau: tau * 0.1, t0, atk: 0.001 });
  noiseHit(out, sr, r, { f: 6000, q: 1.5, amp: amp * 0.3 * bright, tau: 0.002, t0 });
}

/**
 * `done` (GP §5.4 "soft marimba arpeggio"): C–E–G–C rolled up, the last note held a touch; warm, never urgent.
 * `transpose` in semitones (per-agent, so two finishes in a row don't sound identical).
 */
export function renderDoneChime(sr: number, transpose = 0): Samples {
  const r = rngFor(`done|${transpose}`);
  const out = buf(sr, 1.5);
  [72, 76, 79, 84].forEach((n, i) => marimbaInto(out, sr, NOTE(n + transpose), i * 0.085, i === 3 ? 1.0 : 0.75, r));
  marimbaInto(out, sr, NOTE(60 + transpose), 0.34, 0.35, r); // a soft root underneath the top note
  return finish(out, 0.85, 40, sr);
}

/**
 * `blocked` global chime (GP §5.4 "a 2-note chime"): up a fourth, glockenspiel bright, twice quick. Urgent by
 * rhythm (a double knock), pleasant by interval: not an alarm.
 */
export function renderBlockedChime(sr: number): Samples {
  const r = rngFor('blocked');
  const out = buf(sr, 1.6);
  bellInto(out, sr, NOTE(81), 0, 0.8, r, { tau: 0.5 }); // A5
  bellInto(out, sr, NOTE(86), 0.13, 1.0, r, { tau: 0.8 }); // D6
  bellInto(out, sr, NOTE(81), 0.44, 0.45, r, { tau: 0.35 });
  bellInto(out, sr, NOTE(86), 0.57, 0.6, r, { tau: 0.7 });
  return finish(out, 0.8, 40, sr);
}

/** The spatial "ding" at a blocked agent / the Help Desk bell (a brass service bell, G6 with its ring). */
export function renderDeskBell(sr: number): Samples {
  const r = rngFor('deskbell');
  const out = buf(sr, 2.2);
  partial(out, sr, { f: 1568, amp: 1, tau: 0.75, atk: 0.0008 });
  partial(out, sr, { f: 1573.5, amp: 0.7, tau: 0.7, atk: 0.0008 });
  partial(out, sr, { f: 1568 * 2.32, amp: 0.35, tau: 0.3, atk: 0.0008 });
  partial(out, sr, { f: 1568 * 4.25, amp: 0.18, tau: 0.12, atk: 0.0008 });
  partial(out, sr, { f: 1568 * 0.5, amp: 0.05, tau: 0.5 });
  noiseHit(out, sr, r, { f: 7000, q: 2, amp: 0.5, tau: 0.0015 }); // the plunger tick
  return finish(out, 0.9, 50, sr);
}

/** Inbox-zero sting (DESIGN §11.5): a bright major-9 marimba roll up, then a glock sparkle. */
export function renderAllClear(sr: number): Samples {
  const r = rngFor('allclear');
  const out = buf(sr, 2.0);
  [67, 71, 74, 78, 81].forEach((n, i) => marimbaInto(out, sr, NOTE(n), i * 0.06, 0.7, r));
  [93, 98].forEach((n, i) => bellInto(out, sr, NOTE(n), 0.34 + i * 0.09, 0.28, r, { tau: 0.6, bright: 0.5 }));
  return finish(out, 0.8, 60, sr);
}

// ---------------------------------------------------------------------------------------------------- event foley

/** Small cute one-shots keyed by name (`test-pass`, `test-fail`, `error`, `commit`, `stamp`, `pop`, `bubble`, `land`…). */
export function renderFoley(name: string, sr: number, variant = 0): Samples {
  const r = rngFor(`foley|${name}|${variant}`);
  let out: Samples;
  switch (name) {
    case 'testPass': // two quick rising glock notes (a "ta-da" in miniature)
      out = buf(sr, 0.9);
      bellInto(out, sr, NOTE(84), 0, 0.6, r, { tau: 0.25, bright: 0.6 });
      bellInto(out, sr, NOTE(91), 0.09, 0.8, r, { tau: 0.45, bright: 0.6 });
      return finish(out, 0.7, 30, sr);
    case 'testFail': { // a soft "wah-wah" (descending muted triangle through a closing filter)
      out = buf(sr, 0.8);
      const lp = biquad('lp', 1200, 2.5, sr);
      let ph = 0;
      for (let i = 0; i < out.length; i++) {
        const t = i / sr, seg = t < 0.28 ? 0 : 1, ts = seg ? t - 0.28 : t;
        const f = seg ? 196 * (1 - 0.06 * Math.min(1, ts / 0.4)) : 220;
        ph += f / sr;
        const tri = 4 * Math.abs(ph - Math.floor(ph + 0.5)) - 1;
        if ((i & 31) === 0) lp.set(300 + 1400 * Math.exp(-ts / 0.12));
        out[i] = lp.run(tri) * env(ts, 0.02, seg ? 0.2 : 0.09) * (seg ? 1 : 0.8);
      }
      return finish(out, 0.55, 30, sr);
    }
    case 'error': { // "boing" + a little puff: spring pitch wobble
      out = buf(sr, 0.7);
      let ph = 0;
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        const f = 180 + 140 * Math.exp(-t / 0.2) * Math.sin(TAU * 11 * t);
        ph += TAU * f / sr;
        out[i] = Math.sin(ph) * env(t, 0.004, 0.18) * 0.8;
      }
      noiseHit(out, sr, r, { type: 'lp', f: 900, q: 0.7, amp: 0.4, tau: 0.08, t0: 0.05, atk: 0.02 });
      return finish(out, 0.6, 30, sr);
    }
    case 'commit': { // pneumatic capsule: a suck-hiss then a hollow "thoonk" in the tube
      out = buf(sr, 0.9);
      noiseHit(out, sr, r, { f: 900, f1: 3000, sweep: 0.12, q: 1.2, amp: 0.5, tau: 0.09, atk: 0.06 });
      partial(out, sr, { f: 110, f1: 190, glide: 0.02, amp: 1, tau: 0.09, t0: 0.26 });
      partial(out, sr, { f: 330, amp: 0.3, tau: 0.05, t0: 0.26 });
      noiseHit(out, sr, r, { f: 700, q: 1.5, amp: 0.4, tau: 0.02, t0: 0.26 });
      return finish(out, 0.7, 30, sr);
    }
    case 'stamp': // sign-off: rubber stamp "ka-chunk" on paper
      out = buf(sr, 0.4);
      noiseHit(out, sr, r, { f: 2500, q: 0.8, amp: 0.3, tau: 0.01 });
      partial(out, sr, { f: 90, f1: 150, glide: 0.01, amp: 1, tau: 0.05, t0: 0.05 });
      noiseHit(out, sr, r, { type: 'lp', f: 1500, q: 0.7, amp: 0.8, tau: 0.02, t0: 0.05 });
      return finish(out, 0.7, 20, sr);
    case 'pop': { // sparkle / subagent spawn: a bubbly pitch-up "bloop"
      out = buf(sr, 0.25);
      partial(out, sr, { f: 1400 + variant * 90, f1: 500, glide: 0.03, amp: 1, tau: 0.04, atk: 0.002 });
      partial(out, sr, { f: 2900 + variant * 150, amp: 0.15, tau: 0.02, t0: 0.02 });
      return finish(out, 0.6, 15, sr);
    }
    case 'bubble': { // fish tank: small rising bloop
      out = buf(sr, 0.15);
      const f0 = 500 + r() * 700;
      partial(out, sr, { f: f0 * 1.8, f1: f0, glide: 0.025, amp: 1, tau: 0.018, atk: 0.001 });
      return finish(out, 0.5, 10, sr);
    }
    case 'whoosh': { // slide: 2.3 s of air rushing, band sweeping up as the ride speeds, turbulence flutter
      out = buf(sr, 2.4);
      const bp = biquad('bp', 400, 0.9, sr), lp = biquad('lp', 5000, 0.7, sr);
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        if ((i & 63) === 0) bp.set(380 + 1500 * Math.min(1, (t / 2.0) ** 1.5) + 180 * Math.sin(t * 17));
        const e = Math.min(1, t / 0.5) * (t > 2.0 ? Math.exp(-(t - 2.0) / 0.12) : 1);
        out[i] = lp.run(bp.run(r() * 2 - 1)) * e * (0.8 + 0.2 * Math.sin(t * 43));
      }
      return finish(out, 0.7, 40, sr);
    }
    case 'squeak': { // a plastic "whee" squeak (rubbery sine with vibrato, rising)
      out = buf(sr, 0.5);
      let ph = 0;
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        const f = (900 + 700 * Math.min(1, t / 0.35)) * (1 + 0.03 * Math.sin(TAU * 24 * t));
        ph += TAU * f / sr;
        out[i] = (Math.sin(ph) + 0.25 * Math.sin(2 * ph)) * env(t, 0.03, 0.14);
      }
      return finish(out, 0.5, 20, sr);
    }
    case 'swish': { // camera glide ("go to"): a soft short air swish, band rising then falling
      out = buf(sr, 0.6);
      const bp = biquad('bp', 500, 1.1, sr);
      for (let i = 0; i < out.length; i++) {
        const t = i / sr, u = t / 0.55;
        if ((i & 31) === 0) bp.set(450 + 1600 * Math.sin(Math.PI * Math.min(1, u)) ** 2);
        out[i] = bp.run(r() * 2 - 1) * Math.sin(Math.PI * Math.min(1, u)) ** 1.5;
      }
      return finish(out, 0.5, 20, sr);
    }
    case 'chute': // OUTBOX chute flap: a papery slide + a flap tock
      out = buf(sr, 0.6);
      noiseHit(out, sr, r, { f: 1800, f1: 900, sweep: 0.2, q: 0.9, amp: 0.5, tau: 0.12, atk: 0.04 });
      partial(out, sr, { f: 240, amp: 0.8, tau: 0.04, t0: 0.3 });
      noiseHit(out, sr, r, { f: 1200, q: 1.5, amp: 0.5, tau: 0.01, t0: 0.3 });
      return finish(out, 0.6, 20, sr);
    case 'sit': // cushion squish
      out = buf(sr, 0.35);
      noiseHit(out, sr, r, { type: 'lp', f: 700, q: 0.9, amp: 1, tau: 0.08, atk: 0.02 });
      partial(out, sr, { f: 120, f1: 90, glide: 0.1, amp: 0.4, tau: 0.08 });
      return finish(out, 0.55, 20, sr);
    case 'boop': { // stand-up hop / UI tick: a tiny rising boop
      out = buf(sr, 0.2);
      partial(out, sr, { f: 820, f1: 520, glide: 0.03, amp: 1, tau: 0.04, atk: 0.003 });
      return finish(out, 0.45, 15, sr);
    }
    // ---- ambient life (m2 r3): the cat, Bean the espresso-bot, Dusty the roomba, steam wands ----
    case 'purr': { // loop body (1.6 s = one breath): a ~26 Hz flutter of throaty noise, exhale louder than inhale
      out = buf(sr, 1.6);
      const lp = biquad('lp', 420, 0.9, sr), bp = biquad('bp', 180, 1.2, sr);
      let ph = 0;
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        const ex = t < 1.0; // exhale 0–1.0 s, inhale 1.0–1.6 s
        const u = ex ? t / 1.0 : (t - 1.0) / 0.6;
        const breath = Math.sin(Math.PI * u) ** 0.6 * (ex ? 1 : 0.6);
        ph += (ex ? 25 : 28.5) / sr;
        const fr = ph - Math.floor(ph);
        const flutter = Math.exp(-fr / 0.14) * (0.8 + 0.2 * Math.sin(TAU * ph * 0.5));
        const n = r() * 2 - 1;
        out[i] = (lp.run(n) * 1.6 + bp.run(n) * 1.2 + 0.25 * Math.sin(TAU * 52 * t)) * flutter * breath;
      }
      return finish(out, 0.8, 30, sr);
    }
    case 'meow': { // "mi-aow": harmonic glide 560 → 800 → 520 Hz through formants sliding i → a → o
      out = buf(sr, 0.7);
      const F1 = biquad('bp', 400, 4, sr), F2 = biquad('bp', 2500, 6, sr);
      const f0b = 560 * (1 + (variant % 3) * 0.07), dur = 0.58;
      let ph = 0;
      for (let i = 0; i < out.length; i++) {
        const t = i / sr, u = Math.min(1, t / dur);
        const f0 = f0b * (u < 0.35 ? 1 + 0.42 * (u / 0.35) : 1.42 - 0.5 * ((u - 0.35) / 0.65)) * (1 + 0.012 * Math.sin(TAU * 7 * t));
        ph += f0 / sr;
        let src = 0;
        for (let h = 1; h <= 9; h++) src += Math.sin(TAU * h * ph) / h;
        if ((i & 31) === 0) {
          F1.set(u < 0.3 ? 390 + 500 * (u / 0.3) : 890 - 250 * ((u - 0.3) / 0.7));
          F2.set(u < 0.3 ? 2600 - 1200 * (u / 0.3) : 1400 - 300 * ((u - 0.3) / 0.7));
        }
        const e = t < 0.04 ? t / 0.04 : t < dur - 0.12 ? 1 : Math.max(0, (dur - t) / 0.12);
        out[i] = (F1.run(src) + 0.7 * F2.run(src)) * e;
      }
      return finish(out, 0.7, 25, sr);
    }
    case 'catHiss': { // startle: a quick "mrrp?!" chirp into a short spitty hiss
      out = buf(sr, 0.75);
      partial(out, sr, { f: 700, f1: 1100, glide: 0.04, amp: 0.7, tau: 0.05, atk: 0.006 });
      partial(out, sr, { f: 1400, f1: 2200, glide: 0.04, amp: 0.2, tau: 0.04, atk: 0.006 });
      noiseHit(out, sr, r, { type: 'hp', f: 3200, q: 0.8, amp: 0.55, tau: 0.16, t0: 0.12, atk: 0.03 });
      noiseHit(out, sr, r, { f: 5200, q: 1.4, amp: 0.4, tau: 0.1, t0: 0.12, atk: 0.02 });
      return finish(out, 0.6, 30, sr);
    }
    case 'catLand': // soft paws on the floor: a padded double thump
      out = buf(sr, 0.3);
      partial(out, sr, { f: 140, f1: 80, glide: 0.02, amp: 1, tau: 0.035 });
      noiseHit(out, sr, r, { type: 'lp', f: 900, q: 0.7, amp: 0.5, tau: 0.015 });
      partial(out, sr, { f: 150, f1: 90, glide: 0.02, amp: 0.6, tau: 0.03, t0: 0.055 });
      noiseHit(out, sr, r, { type: 'lp', f: 900, q: 0.7, amp: 0.3, tau: 0.012, t0: 0.055 });
      return finish(out, 0.5, 20, sr);
    case 'pssht': { // espresso wand / steam vent: a sputtery hiss that swells and gurgles off
      out = buf(sr, variant ? 0.8 : 1.15);
      const len = out.length / sr;
      const bp = biquad('bp', 3000, 0.7, sr), hp = biquad('hp', 1400, 0.7, sr);
      let sput = 1;
      for (let i = 0; i < out.length; i++) {
        const t = i / sr, u = t / len;
        if ((i & 63) === 0) { bp.set(2600 + 2400 * Math.sin(Math.PI * Math.min(1, u * 1.3))); sput = 0.65 + 0.35 * r(); }
        const e = Math.min(1, t / 0.035) * (u > 0.55 ? Math.exp(-(u - 0.55) / 0.13) : 1);
        const n = r() * 2 - 1;
        out[i] = (bp.run(n) * 1.3 + hp.run(n) * 0.5) * e * sput;
      }
      partial(out, sr, { f: 180, f1: 120, glide: 0.2, amp: 0.12, tau: 0.25, t0: len * 0.5 }); // milk gurgle underneath
      return finish(out, 0.6, 40, sr);
    }
    case 'ding': // Bean's "shot's ready": a tiny bright counter-bell (two quick tings, the 2nd higher)
      out = buf(sr, 1.2);
      bellInto(out, sr, NOTE(93), 0, 0.7, r, { tau: 0.35, bright: 0.7 });
      bellInto(out, sr, NOTE(100), 0.11, 1.0, r, { tau: 0.55, bright: 0.6 });
      return finish(out, 0.6, 40, sr);
    case 'serve': // cup set down on its saucer: a porcelain clink-clink
      out = buf(sr, 0.45);
      for (const [t0, a] of [[0, 1], [0.075, 0.5]]) {
        partial(out, sr, { f: 2830, amp: a, tau: 0.05, t0, atk: 0.0005 });
        partial(out, sr, { f: 4170, amp: a * 0.6, tau: 0.035, t0, atk: 0.0005 });
        partial(out, sr, { f: 6310, amp: a * 0.3, tau: 0.02, t0, atk: 0.0005 });
        noiseHit(out, sr, r, { f: 5000, q: 1.2, amp: a * 0.3, tau: 0.003, t0 });
      }
      return finish(out, 0.55, 20, sr);
    case 'bonk': { // roomba bumps a foot: a hollow plastic "bonk" + a sheepish two-tone beep ("oh-oh")
      out = buf(sr, 0.7);
      partial(out, sr, { f: 420, f1: 230, glide: 0.03, amp: 1, tau: 0.05, atk: 0.001 });
      partial(out, sr, { f: 1150, amp: 0.25, tau: 0.02, atk: 0.001 });
      noiseHit(out, sr, r, { f: 1600, q: 1.1, amp: 0.5, tau: 0.008 });
      for (const [t0, f] of [[0.2, 988], [0.34, 740]]) {
        const i0 = Math.floor(t0 * sr), n = Math.floor(0.11 * sr);
        for (let i = 0; i < n; i++) {
          const t = i / sr, sq = Math.sign(Math.sin(TAU * f * t));
          out[i0 + i] += sq * 0.16 * Math.min(1, t / 0.004) * Math.min(1, (0.11 - t) / 0.01);
        }
      }
      return finish(out, 0.55, 20, sr);
    }
    case 'crumbs': { // hoovering pastry crumbs: a slurpy rising suck with crackles, then a happy 3-note beep
      out = buf(sr, 1.3);
      const bp = biquad('bp', 600, 1.4, sr);
      for (let i = 0; i < Math.floor(0.75 * sr); i++) {
        const t = i / sr, u = t / 0.75;
        if ((i & 31) === 0) bp.set(600 + 2200 * u * u);
        const e = Math.min(1, t / 0.05) * (u > 0.8 ? (1 - u) / 0.2 : 1);
        out[i] += bp.run(r() * 2 - 1) * e * 0.9 + (r() < 0.004 ? (r() - 0.5) * 1.6 * e : 0);
      }
      [[0.8, 1319], [0.9, 1568], [1.0, 2093]].forEach(([t0, f]) => {
        const i0 = Math.floor(t0 * sr), n = Math.floor(0.085 * sr);
        for (let i = 0; i < n; i++) {
          const t = i / sr;
          out[i0 + i] += Math.sign(Math.sin(TAU * f * t)) * 0.18 * Math.min(1, t / 0.004) * Math.min(1, (0.085 - t) / 0.012);
        }
      });
      return finish(out, 0.55, 30, sr);
    }
    // ---- M3.5 "walk up and manage" cues: verbs, paper plane, lanterns, inbox zero, hiring crates ----
    case 'plane': { // prompt.sent: a paper plane leaves your hand: a papery "fwip" then a fluttering air trail
      out = buf(sr, 0.95);
      noiseHit(out, sr, r, { f: 2600, q: 1.1, amp: 0.7, tau: 0.02, atk: 0.004 }); // the flick
      const bp = biquad('bp', 900, 1.3, sr);
      for (let i = Math.floor(0.03 * sr); i < out.length; i++) {
        const t = i / sr - 0.03, u = t / 0.85;
        if ((i & 31) === 0) bp.set(900 + 1900 * Math.sin(Math.PI * Math.min(1, u * 0.9)) ** 1.2);
        const e = Math.min(1, t / 0.12) * Math.max(0, 1 - u) ** 1.4;
        const flap = 0.6 + 0.4 * Math.sin(TAU * (34 - 12 * u) * t) ** 2; // paper wings buzzing, slowing as it glides
        out[i] += bp.run(r() * 2 - 1) * e * flap * 1.2;
      }
      return finish(out, 0.6, 40, sr);
    }
    case 'pat': { // verb pat: two soft head pats + a happy rubber squeak
      out = buf(sr, 0.7);
      for (const t0 of [0, 0.17]) {
        noiseHit(out, sr, r, { type: 'lp', f: 900, q: 0.8, amp: 0.8, tau: 0.02, t0, atk: 0.003 });
        partial(out, sr, { f: 170, f1: 120, glide: 0.02, amp: 0.4, tau: 0.03, t0 });
      }
      let ph = 0;
      const i0 = Math.floor(0.32 * sr);
      for (let i = i0; i < out.length; i++) {
        const t = i / sr - 0.32;
        const f = (1150 + 600 * Math.min(1, t / 0.18)) * (1 + 0.04 * Math.sin(TAU * 28 * t));
        ph += TAU * f / sr;
        out[i] += (Math.sin(ph) + 0.3 * Math.sin(2 * ph)) * env(t, 0.02, 0.07) * 0.55;
      }
      return finish(out, 0.55, 20, sr);
    }
    case 'whistle': { // verb summon: a two-note "fwee-fweet!" finger whistle (breathy sine, the 2nd note up a fourth)
      out = buf(sr, 0.8);
      let ph = 0;
      const hp = biquad('bp', 2400, 2, sr);
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        const second = t >= 0.3;
        const ts = second ? t - 0.3 : t, dur = second ? 0.42 : 0.22;
        const f = second ? 1760 * (1 + 0.18 * Math.min(1, ts / 0.08)) : 1320 * (1 + 0.25 * Math.min(1, ts / 0.06));
        ph += TAU * f * (1 + 0.006 * Math.sin(TAU * 6 * t)) / sr;
        const e = ts < 0.015 ? ts / 0.015 : ts < dur - 0.05 ? 1 : Math.max(0, (dur - ts) / 0.05);
        out[i] = (Math.sin(ph) * 0.9 + hp.run(r() * 2 - 1) * 0.15) * e;
      }
      return finish(out, 0.6, 20, sr);
    }
    case 'lanternRise': { // a blocked lantern floats up: an airy "fwoomph" of flame + a warm rising hum (variant = escalation)
      out = buf(sr, 1.4);
      const lp = biquad('lp', 500, 0.9, sr);
      const lift = 1 + variant * 0.12;
      for (let i = 0; i < out.length; i++) {
        const t = i / sr;
        if ((i & 63) === 0) lp.set((400 + 1400 * Math.min(1, t / 0.25)) * lift);
        out[i] = lp.run(r() * 2 - 1) * env(t, 0.06, 0.18) * 0.9;
      }
      partial(out, sr, { f: 262 * lift, f1: 196 * lift, glide: 0.25, amp: 0.35, tau: 0.45, t0: 0.05, atk: 0.12 });
      partial(out, sr, { f: 392 * lift, f1: 294 * lift, glide: 0.25, amp: 0.18, tau: 0.4, t0: 0.08, atk: 0.12 });
      if (variant) bellInto(out, sr, NOTE(84 + variant * 3), 0.25, 0.12, r, { tau: 0.35, bright: 0.4 }); // escalations ting
      return finish(out, 0.55, 60, sr);
    }
    case 'lanternPop': { // the lantern bursts when the block clears: a cork pop + a sparkly tinkle
      out = buf(sr, 0.9);
      partial(out, sr, { f: 700, f1: 240, glide: 0.012, amp: 1, tau: 0.025, atk: 0.001 });
      noiseHit(out, sr, r, { f: 1800, q: 0.9, amp: 0.6, tau: 0.008 });
      [96, 100, 103].forEach((n, i) => bellInto(out, sr, NOTE(n), 0.06 + i * 0.05, 0.22, r, { tau: 0.2, bright: 0.5 }));
      return finish(out, 0.55, 30, sr);
    }
    case 'crateClack': { // a hiring crate is set down: a hollow wooden double knock + a slat rattle
      out = buf(sr, 0.5);
      for (const [t0, a] of [[0, 1], [0.09, 0.55]]) {
        partial(out, sr, { f: 150, f1: 210, glide: 0.01, amp: a, tau: 0.06, t0 });
        partial(out, sr, { f: 395, amp: a * 0.4, tau: 0.035, t0 });
        noiseHit(out, sr, r, { f: 1300, q: 1.2, amp: a * 0.9, tau: 0.014, t0 });
      }
      for (let k = 0; k < 5; k++) noiseHit(out, sr, r, { f: 2200 + r() * 1200, q: 2, amp: 0.15, tau: 0.004, t0: 0.12 + k * 0.03 + r() * 0.02 });
      return finish(out, 0.6, 20, sr);
    }
    case 'unwrap': { // the new hire unwraps: paper crinkles (sparse bright crackles) and a "ta!" pop at the end
      out = buf(sr, 1.0);
      const bp = biquad('bp', 3500, 1.2, sr);
      for (let i = 0; i < Math.floor(0.65 * sr); i++) {
        const t = i / sr;
        const crack = r() < 0.012 ? (r() * 2 - 1) * 3 : 0;
        out[i] += bp.run(crack + (r() * 2 - 1) * 0.08) * Math.min(1, t / 0.05) * (0.7 + 0.3 * Math.sin(TAU * 5 * t));
      }
      partial(out, sr, { f: 1100, f1: 500, glide: 0.03, amp: 0.7, tau: 0.05, t0: 0.7, atk: 0.002 });
      bellInto(out, sr, NOTE(91), 0.72, 0.25, r, { tau: 0.3, bright: 0.5 });
      return finish(out, 0.55, 30, sr);
    }
    case 'thanks': // answered: a tiny "message received" blip (two quick rising sine notes)
      out = buf(sr, 0.4);
      partial(out, sr, { f: NOTE(83), amp: 0.7, tau: 0.05, atk: 0.003 });
      partial(out, sr, { f: NOTE(88), amp: 0.9, tau: 0.09, t0: 0.075, atk: 0.003 });
      partial(out, sr, { f: NOTE(88) * 2, amp: 0.12, tau: 0.04, t0: 0.075, atk: 0.003 });
      return finish(out, 0.5, 20, sr);
    case 'spawn': // spawn.sent: a hiring chime (celesta arpeggio up a sixth, one warm low note underneath)
      out = buf(sr, 1.4);
      [76, 79, 84, 88].forEach((n, i) => bellInto(out, sr, NOTE(n), i * 0.07, i === 3 ? 0.8 : 0.55, r, { tau: 0.4, bright: 0.45 }));
      marimbaInto(out, sr, NOTE(60), 0.21, 0.5, r);
      return finish(out, 0.7, 40, sr);
    case 'slap': // verb highFive: a bright clay "pap!"
      out = buf(sr, 0.25);
      noiseHit(out, sr, r, { f: 2100, q: 0.9, amp: 1, tau: 0.012, atk: 0.001 });
      partial(out, sr, { f: 320, f1: 480, glide: 0.006, amp: 0.4, tau: 0.02 });
      return finish(out, 0.6, 15, sr);
    default:
      return finish(buf(sr, 0.05), 0, 1, sr);
  }
}

/**
 * Inbox zero (M3.5, `inbox.zero`): a Help Desk "ding-ding!" and then a bright fanfare: the all-clear marimba roll up a
 * major 9th, a glock sparkle and a held major chord. Longer and happier than a single `done`.
 */
export function renderInboxZero(sr: number): Samples {
  const r = rngFor('inboxzero');
  const out = buf(sr, 2.6);
  bellInto(out, sr, 1568, 0, 0.55, r, { tau: 0.5 }); bellInto(out, sr, 1568, 0.16, 0.6, r, { tau: 0.7 });
  [67, 71, 74, 78, 81, 86].forEach((n, i) => marimbaInto(out, sr, NOTE(n), 0.42 + i * 0.055, 0.7, r));
  [93, 98, 102].forEach((n, i) => bellInto(out, sr, NOTE(n), 0.8 + i * 0.08, 0.26, r, { tau: 0.6, bright: 0.5 }));
  for (const n of [55, 62, 67, 71]) partial(out, sr, { f: NOTE(n), amp: 0.16, tau: 0.6, t0: 0.78, atk: 0.03 });
  return finish(out, 0.8, 80, sr);
}

// ---------------------------------------------------------------------------------------------------- room tone

/**
 * Pink-ish noise loop (Paul Kellet filter) with a smooth wrap: the ambient bed and the ENG fan share it, each through
 * its own BiquadFilter, so a zone change is a filter sweep, never a new buffer.
 */
export function renderPinkLoop(sr: number, sec = 5): Samples {
  const r = rngFor('pink');
  const out = buf(sr, sec);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < out.length; i++) {
    const w = r() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
  }
  // crossfade the last 0.25 s into the head so the loop point is seamless
  const xf = Math.floor(sr * 0.25), n = out.length;
  for (let i = 0; i < xf; i++) { const a = i / xf; out[i] = out[i] * a + out[n - xf + i] * (1 - a); }
  const trimmed = out.subarray(0, n - xf);
  return finish(new Float32Array(trimmed), 0.5, 0, sr);
}

/** A short plain white-noise loop (voice consonants, typing fallback). */
export function renderWhite(sr: number, sec = 1): Samples {
  const r = rngFor('white');
  const out = buf(sr, sec);
  for (let i = 0; i < out.length; i++) out[i] = (r() * 2 - 1) * 0.7;
  return out;
}

/**
 * Procedural room impulse response for the one shared ConvolverNode: exponentially decaying stereo noise with a
 * darkening tail (a "clay studio": warm, short, a little woody).
 */
export function renderImpulse(sr: number, sec = 1.4): [Samples, Samples] {
  const [l, r] = [0, 1].map((c) => {
    const r = rngFor(`ir|${c}`);
    const out = buf(sr, sec);
    const lp = biquad('lp', 7000, 0.6, sr);
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      if ((i & 127) === 0) lp.set(7000 * Math.exp(-t / 0.35) + 600);
      out[i] = lp.run(r() * 2 - 1) * Math.exp(-t / 0.32) * (t < 0.008 ? t / 0.008 : 1);
    }
    return out;
  });
  return [l, r];
}

/** Peak |x| (tests / debug). */
export const peak = (a: ArrayLike<number>): number => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i])); return m; };
/** RMS over the whole buffer (tests / debug). */
export const rms = (a: ArrayLike<number>): number => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, a.length)); };
