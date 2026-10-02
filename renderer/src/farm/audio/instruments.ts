/**
 * The valley band: small synthesized instruments for the music (a few oscillators per note, everything low-passed;
 * no harsh raw saws or squares reach the speakers). `playNote` schedules one note and returns when it stops ringing.
 * `INSTRUMENT_GAIN` trims each to the same loudness for a mid-register note at velocity 1 (measured offline with
 * `_debug.render('inst:NAME:MIDI')`, see docs/VALLEY.md → Sound).
 */
import type { Instrument } from './musicPlan.ts';
import { midiHz } from './musicPlan.ts';
import { noise, tone } from './synth.ts';

type C = BaseAudioContext;
type Play = (c: C, out: AudioNode, t: number, f: number, dur: number, v: number) => number;

/** Loudness trims: momentary loudness matched to ≈ −6 dBFS at midi 67 (bass 43), velocity 1; sustained voices and the
 * bass sit ~1–2 dB under the plucked ones, which read quieter. */
export const INSTRUMENT_GAIN: Readonly<Record<Instrument, number>> = {
  kalimba: 1.15, marimba: 1, flute: 0.9, musicbox: 0.89, glock: 0.88, guitar: 1.1, epiano: 0.68, pad: 0.9, strings: 1, bass: 0.75, reed: 0.8, pizz: 1.3, horn: 0.75, shaker: 2.5,
};

const min = Math.min, max = Math.max;

/** FM electric piano: a sine carrier, a 1:1 modulator whose index decays (bright tine attack → round tone). */
function epiano(c: C, out: AudioNode, t: number, f: number, dur: number, v: number): number {
  const car = c.createOscillator(), md = c.createOscillator(), mg = c.createGain(), g = c.createGain();
  car.frequency.value = f; md.frequency.value = f;
  const d = 0.8 + min(dur, 2) * 0.7;
  mg.gain.setValueAtTime(f * 1.1, t);
  mg.gain.exponentialRampToValueAtTime(f * 0.12, t + 0.35);
  mg.gain.exponentialRampToValueAtTime(f * 0.04, t + d);
  md.connect(mg).connect(car.frequency);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(v, t + 0.004);
  g.gain.exponentialRampToValueAtTime(v * 0.35, t + 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  car.connect(g).connect(out);
  car.start(t); md.start(t); car.stop(t + d + 0.05); md.stop(t + d + 0.05);
  car.onended = () => { car.disconnect(); md.disconnect(); mg.disconnect(); g.disconnect(); };
  return t + d;
}

const PLAY: Readonly<Record<Instrument, Play>> = {
  kalimba: (c, out, t, f, dur, v) => {
    tone(c, out, t, { f: f * 2, gain: v * 0.16, a: 0.001, d: 0.25 });
    tone(c, out, t, { f: f * 5.4, gain: v * 0.04, a: 0.001, d: 0.05 });
    return tone(c, out, t, { type: 'triangle', f, gain: v, a: 0.003, d: 0.7 + min(dur, 1.2) * 0.5 });
  },
  marimba: (c, out, t, f, dur, v) => {
    tone(c, out, t, { f: f * 4, gain: v * 0.2, a: 0.001, d: 0.08 });
    if (f * 10 < 12000) tone(c, out, t, { f: f * 10, gain: v * 0.04, a: 0.001, d: 0.025 });
    return tone(c, out, t, { f, gain: v, a: 0.002, d: 0.45 + min(dur, 1) * 0.25 });
  },
  flute: (c, out, t, f, dur, v) => {
    const hold = max(0, dur - 0.12);
    noise(c, out, t, { kind: 'pink', gain: v * 0.06, a: 0.012, d: 0.09, filter: 'bandpass', f: f * 2, q: 2.5 });
    tone(c, out, t, { f: f * 2, gain: v * 0.07, a: 0.07, hold, d: 0.18 });
    return tone(c, out, t, { type: 'triangle', f, gain: v * 0.8, a: 0.06, hold, d: 0.2, lp: 2600, vib: { rate: 5, depth: 0.005 } });
  },
  musicbox: (c, out, t, f, _dur, v) => {
    tone(c, out, t, { f: f * 2, gain: v * 0.22, a: 0.001, d: 0.45 });
    tone(c, out, t, { f: f * 3, gain: v * 0.07, a: 0.001, d: 0.2 });
    if (f * 4.2 < 12000) tone(c, out, t, { f: f * 4.2, gain: v * 0.04, a: 0.001, d: 0.1 });
    return tone(c, out, t, { f, gain: v, a: 0.002, d: 1.4 });
  },
  glock: (c, out, t, f, _dur, v) => {
    if (f * 2.76 < 12000) tone(c, out, t, { f: f * 2.76, gain: v * 0.22, a: 0.001, d: 0.3 });
    if (f * 5.4 < 12000) tone(c, out, t, { f: f * 5.4, gain: v * 0.05, a: 0.001, d: 0.07 });
    return tone(c, out, t, { f, gain: v, a: 0.001, d: 1.5 });
  },
  guitar: (c, out, t, f, dur, v) => {
    noise(c, out, t, { kind: 'white', gain: v * 0.05, a: 0.001, d: 0.014, filter: 'bandpass', f: min(9000, f * 5), q: 2 });
    tone(c, out, t, { type: 'sawtooth', f, gain: v * 0.22, a: 0.002, d: 0.22, lp: 1700 });
    return tone(c, out, t, { type: 'triangle', f, gain: v, a: 0.003, d: 0.4 + min(dur, 1.5) * 0.55, lp: 2600 });
  },
  pizz: (c, out, t, f, _dur, v) => {
    tone(c, out, t, { type: 'sawtooth', f, gain: v * 0.18, a: 0.002, d: 0.07, lp: 1200 });
    return tone(c, out, t, { type: 'triangle', f, gain: v, a: 0.003, d: 0.3, lp: 1500 });
  },
  epiano,
  pad: (c, out, t, f, dur, v) => {
    const a = min(1.2, dur * 0.35), hold = max(0, dur * 0.35), d = max(0.3, dur * 0.4);
    let end = t;
    for (const det of [-7, 7]) end = tone(c, out, t, { type: 'triangle', f, detune: det, gain: v * 0.5, a, hold, d, lp: 900 });
    return end;
  },
  strings: (c, out, t, f, dur, v) => {
    const a = min(0.4, dur * 0.3), hold = max(0, dur - a - 0.2), d = 0.45;
    let end = t;
    for (const det of [-8, 8]) end = tone(c, out, t, { type: 'sawtooth', f, detune: det, gain: v * 0.5, a, hold, d, lp: 1100, vib: { rate: 5.2, depth: 0.004 } });
    return end;
  },
  bass: (c, out, t, f, dur, v) => {
    tone(c, out, t, { f, gain: v * 0.6, a: 0.012, hold: dur * 0.35, d: dur * 0.65 + 0.1 });
    return tone(c, out, t, { type: 'triangle', f, gain: v * 0.7, a: 0.012, hold: dur * 0.3, d: dur * 0.6 + 0.1, lp: 420 });
  },
  reed: (c, out, t, f, dur, v) => {
    const hold = max(0, dur - 0.1);
    tone(c, out, t, { type: 'sawtooth', f, gain: v * 0.32, a: 0.04, hold, d: 0.14, lp: 1300 });
    return tone(c, out, t, { type: 'triangle', f, detune: 9, gain: v * 0.7, a: 0.04, hold, d: 0.16, lp: 2200, vib: { rate: 5.5, depth: 0.004 } });
  },
  horn: (c, out, t, f, dur, v) => {
    const hold = max(0, dur - 0.15);
    tone(c, out, t, { type: 'sawtooth', f, gain: v * 0.35, a: 0.07, hold, d: 0.2, lp: 850 });
    return tone(c, out, t, { type: 'triangle', f, gain: v * 0.75, a: 0.06, hold, d: 0.22, lp: 1500, vib: { rate: 4.8, depth: 0.004 } });
  },
  shaker: (c, out, t, _f, _dur, v) => noise(c, out, t, { kind: 'white', gain: v * 0.5, a: 0.006, d: 0.05, filter: 'highpass', f: 6500 }),
};

/** Schedule one note; returns its end time. */
export function playNote(c: C, out: AudioNode, t: number, inst: Instrument, midi: number, dur: number, vel: number): number {
  return PLAY[inst](c, out, t, midiHz(midi), dur, vel * INSTRUMENT_GAIN[inst]);
}
