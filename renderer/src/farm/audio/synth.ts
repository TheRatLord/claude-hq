/**
 * Synthesis primitives over any BaseAudioContext (so recipes render live and in an OfflineAudioContext alike):
 * shared noise buffers, envelopes, tones with glides and vibrato, filtered noise bursts, additive bells, formant
 * voices. Every helper schedules at an absolute time and returns the time it finishes ringing.
 */

type C = BaseAudioContext;
export type NoiseKind = 'white' | 'pink' | 'brown';

const noiseCache = new WeakMap<C, Record<NoiseKind, AudioBuffer>>();

/** 3 s looped noise buffers, normalised to the same RMS so kinds swap without level jumps. */
export function noises(c: C): Record<NoiseKind, AudioBuffer> {
  const hit = noiseCache.get(c);
  if (hit) return hit;
  const n = Math.floor(c.sampleRate * 3);
  let s = 0x2545f491;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2147483648 - 1; };
  const make = (fill: (d: Float32Array) => void): AudioBuffer => {
    const b = c.createBuffer(1, n, c.sampleRate);
    const d = b.getChannelData(0);
    fill(d);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += d[i] * d[i];
    const k = 0.28 / Math.sqrt(sum / n || 1);
    for (let i = 0; i < n; i++) d[i] = Math.max(-1, Math.min(1, d[i] * k));
    return b;
  };
  const white = make((d) => { for (let i = 0; i < d.length; i++) d[i] = rnd(); });
  const pink = make((d) => {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = rnd();
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
    }
  });
  const brown = make((d) => { let last = 0; for (let i = 0; i < d.length; i++) { last = (last + 0.02 * rnd()) / 1.02; d[i] = last; } });
  const out = { white, pink, brown };
  noiseCache.set(c, out);
  return out;
}

/** A noise source starting at a random offset in the shared buffer. */
export function noiseSrc(c: C, kind: NoiseKind, t: number, dur?: number): AudioBufferSourceNode {
  const src = c.createBufferSource();
  src.buffer = noises(c)[kind];
  src.loop = true;
  src.start(t, Math.random() * 2.4);
  if (dur !== undefined) src.stop(t + dur + 0.05);
  return src;
}

const EPS = 0.0001;
/** Attack–hold–decay (exponential tail) on a gain param. Returns the end time. */
export function ahd(p: AudioParam, t: number, peak: number, a: number, hold: number, d: number): number {
  const pk = Math.max(EPS * 2, peak);
  p.setValueAtTime(EPS, t);
  p.linearRampToValueAtTime(pk, t + Math.max(0.001, a));
  if (hold > 0) p.setValueAtTime(pk, t + a + hold);
  p.exponentialRampToValueAtTime(EPS, t + a + hold + Math.max(0.005, d));
  p.setValueAtTime(0, t + a + hold + d + 0.001);
  return t + a + hold + d;
}

const cleanup = (src: AudioScheduledSourceNode, ...nodes: AudioNode[]) => {
  src.onended = () => { src.disconnect(); for (const n of nodes) n.disconnect(); };
};

export interface ToneOpts {
  type?: OscillatorType;
  f: number;
  /** glide target */
  f2?: number;
  /** glide time (default: whole note) */
  glide?: number;
  /** extra pitch points [time offset, Hz] after the glide (exponential ramps) */
  pts?: readonly (readonly [number, number])[];
  gain: number;
  a?: number;
  hold?: number;
  d: number;
  delay?: number;
  vib?: { rate: number; depth: number };
  /** optional low-pass on the tone */
  lp?: number;
  detune?: number;
}

export function tone(c: C, out: AudioNode, t0: number, o: ToneOpts): number {
  const t = t0 + (o.delay ?? 0);
  const osc = c.createOscillator();
  osc.type = o.type ?? 'sine';
  if (o.detune) osc.detune.value = o.detune;
  const a = o.a ?? 0.004, hold = o.hold ?? 0;
  const total = a + hold + o.d;
  osc.frequency.setValueAtTime(o.f, t);
  if (o.f2 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + (o.glide ?? total));
  if (o.pts) for (const [dt, f] of o.pts) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f), t + dt);
  const g = c.createGain();
  const end = ahd(g.gain, t, o.gain, a, hold, o.d);
  let head: AudioNode = osc;
  const extra: AudioNode[] = [g];
  if (o.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; osc.connect(f); head = f; extra.push(f); }
  head.connect(g).connect(out);
  if (o.vib) {
    const l = c.createOscillator(), lg = c.createGain();
    l.frequency.value = o.vib.rate; lg.gain.value = o.f * o.vib.depth;
    l.connect(lg).connect(osc.frequency);
    l.start(t); l.stop(end + 0.05);
    cleanup(l, lg);
  }
  osc.start(t); osc.stop(end + 0.05);
  cleanup(osc, ...extra);
  return end;
}

export interface NoiseOpts {
  kind?: NoiseKind;
  gain: number;
  a?: number;
  hold?: number;
  d: number;
  delay?: number;
  filter?: BiquadFilterType;
  f?: number;
  f2?: number;
  q?: number;
  /** second filter in series (e.g. a high-pass under a band) */
  hp?: number;
}

export function noise(c: C, out: AudioNode, t0: number, o: NoiseOpts): number {
  const t = t0 + (o.delay ?? 0);
  const a = o.a ?? 0.003, hold = o.hold ?? 0, total = a + hold + o.d;
  const src = noiseSrc(c, o.kind ?? 'white', t, total);
  const g = c.createGain();
  const end = ahd(g.gain, t, o.gain, a, hold, o.d);
  let head: AudioNode = src;
  const nodes: AudioNode[] = [g];
  if (o.filter) {
    const f = c.createBiquadFilter();
    f.type = o.filter;
    f.frequency.setValueAtTime(o.f ?? 1000, t);
    if (o.f2 !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + total);
    f.Q.value = o.q ?? 0.8;
    head.connect(f); head = f; nodes.push(f);
  }
  if (o.hp) { const h = c.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = o.hp; head.connect(h); head = h; nodes.push(h); }
  head.connect(g).connect(out);
  cleanup(src, ...nodes);
  return end;
}

/** Additive bell: [ratio, amplitude, decay multiplier] partials. */
export const CHIME: readonly (readonly [number, number, number])[] = [[1, 1, 1], [2, 0.32, 0.55], [3, 0.12, 0.35], [4.16, 0.06, 0.22]];
export const BIG_BELL: readonly (readonly [number, number, number])[] = [
  [0.5, 0.35, 1.3], [1, 1, 1], [1.19, 0.4, 0.8], [1.5, 0.3, 0.7], [2, 0.35, 0.55], [2.51, 0.2, 0.4], [3.01, 0.12, 0.3], [4.17, 0.08, 0.2],
];

export function bell(c: C, out: AudioNode, t0: number, o: { f: number; gain: number; d: number; delay?: number; partials?: readonly (readonly [number, number, number])[] }): number {
  let end = t0;
  const parts = o.partials ?? CHIME;
  let sum = 0;
  for (const [, amp] of parts) sum += amp;
  for (const [ratio, amp, dm] of parts) {
    end = Math.max(end, tone(c, out, t0, { f: o.f * ratio, gain: (o.gain * amp) / Math.max(1, sum * 0.7), a: 0.002, d: o.d * dm, delay: o.delay }));
  }
  return end;
}

/** Kalimba-ish pluck: sine + soft octave + a tiny tine click. */
export function pluck(c: C, out: AudioNode, t: number, o: { f: number; gain: number; d?: number; delay?: number }): number {
  const d = o.d ?? 0.9;
  tone(c, out, t, { f: o.f * 2, gain: o.gain * 0.18, a: 0.001, d: d * 0.25, delay: o.delay });
  tone(c, out, t, { f: o.f * 5.4, gain: o.gain * 0.05, a: 0.001, d: 0.05, delay: o.delay });
  return tone(c, out, t, { type: 'triangle', f: o.f, gain: o.gain, a: 0.003, d, delay: o.delay });
}

export interface FormantOpts {
  wave?: OscillatorType;
  /** pitch points [time offset, Hz]; first is the start */
  pitch: readonly (readonly [number, number])[];
  /** formants [Hz, Q, gain]; optional end frequency (4th) sweeps over the note */
  formants: readonly (readonly [number, number, number, number?])[];
  gain: number;
  a?: number;
  hold?: number;
  d: number;
  delay?: number;
  vib?: { rate: number; depth: number };
  /** amplitude modulation (tremolo / purr / snort), Hz and depth 0..1 */
  am?: { rate: number; depth: number };
  /** noise breath mixed into the source (0..1) */
  breath?: number;
}

/** Buzzy source through parallel band-pass formants: animal voices, babble, quacks. */
export function formant(c: C, out: AudioNode, t0: number, o: FormantOpts): number {
  const t = t0 + (o.delay ?? 0);
  const a = o.a ?? 0.01, hold = o.hold ?? 0, total = a + hold + o.d;
  const osc = c.createOscillator();
  osc.type = o.wave ?? 'sawtooth';
  osc.frequency.setValueAtTime(o.pitch[0][1], t);
  for (let i = 1; i < o.pitch.length; i++) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.pitch[i][1]), t + o.pitch[i][0]);
  const src = c.createGain();
  src.gain.value = 1;
  osc.connect(src);
  const nodes: AudioNode[] = [src];
  let nsrc: AudioBufferSourceNode | null = null;
  if (o.breath) {
    nsrc = noiseSrc(c, 'pink', t, total);
    const ng = c.createGain(); ng.gain.value = o.breath * 2;
    nsrc.connect(ng).connect(src);
    nodes.push(ng);
  }
  const env = c.createGain();
  const end = ahd(env.gain, t, o.gain, a, hold, o.d);
  nodes.push(env);
  for (const [f, q, g, f2] of o.formants) {
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(f, t);
    if (f2 !== undefined) bp.frequency.exponentialRampToValueAtTime(f2, t + total);
    bp.Q.value = q;
    const bg = c.createGain(); bg.gain.value = g;
    src.connect(bp).connect(bg).connect(env);
    nodes.push(bp, bg);
  }
  let head: AudioNode = env;
  if (o.am) {
    const amg = c.createGain();
    amg.gain.value = 1 - o.am.depth / 2;
    const l = c.createOscillator(), lg = c.createGain();
    l.frequency.value = o.am.rate; lg.gain.value = o.am.depth / 2;
    l.connect(lg).connect(amg.gain);
    l.start(t); l.stop(end + 0.05);
    cleanup(l, lg);
    env.connect(amg); head = amg; nodes.push(amg);
  }
  head.connect(out);
  if (o.vib) {
    const l = c.createOscillator(), lg = c.createGain();
    l.frequency.value = o.vib.rate; lg.gain.value = o.pitch[0][1] * o.vib.depth;
    l.connect(lg).connect(osc.frequency);
    l.start(t); l.stop(end + 0.05);
    cleanup(l, lg);
  }
  osc.start(t); osc.stop(end + 0.05);
  cleanup(osc, ...nodes);
  return end;
}

/** Synthetic room/valley impulse response for a ConvolverNode (decaying stereo noise, darker as it tails). */
export function valleyImpulse(c: C, seconds = 2.2): AudioBuffer {
  const n = Math.floor(c.sampleRate * seconds);
  const b = c.createBuffer(2, n, c.sampleRate);
  let s = 12345;
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const w = s / 2147483648 - 1;
      const x = i / n;
      const k = 0.35 + 0.6 * x; // darker tail
      lp = lp + (w - lp) * (1 - k);
      const early = i < c.sampleRate * 0.012 ? 0 : 1;
      d[i] = lp * early * Math.pow(1 - x, 2.6) * 0.5;
    }
  }
  return b;
}
