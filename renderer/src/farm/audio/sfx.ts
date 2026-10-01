/**
 * One recipe per sound. Recipes take (context, destination, start time, options) and return when they stop ringing,
 * so the same code plays live and renders in an OfflineAudioContext (audio `_debug.render`). Nominal peak ≈ 0.2–0.6
 * at volume 1; buses and the master limiter do the rest.
 */
import type { SfxName } from '../scene/context.ts';
import type { CritterSound } from './types.ts';
import { BIG_BELL, bell, formant, noise, pluck, tone } from './synth.ts';
import { planVoice } from './voicePlan.ts';
import { renderVoice } from './voice.ts';

export interface RecipeOpts { pitch: number; rnd: () => number }
export type Recipe = (c: BaseAudioContext, out: AudioNode, t: number, o: RecipeOpts) => number;

const PENTA_HI = [2093, 2349, 2637, 3136, 3520, 4186];
const max = Math.max;

function sparkle(c: BaseAudioContext, out: AudioNode, t: number, o: RecipeOpts, n = 6, gain = 0.09): number {
  let end = t;
  for (let i = 0; i < n; i++) {
    const f = PENTA_HI[Math.floor(o.rnd() * PENTA_HI.length)] * o.pitch;
    end = max(end, tone(c, out, t, { f, gain: gain * (1 - i / (n + 2)), a: 0.002, d: 0.22 + o.rnd() * 0.15, delay: i * 0.055 + o.rnd() * 0.02 }));
  }
  return end;
}

function bubble(c: BaseAudioContext, out: AudioNode, t: number, f: number, gain: number): number {
  return tone(c, out, t, { f, f2: f * 2.2, glide: 0.05, gain, a: 0.002, d: 0.05 });
}

export const SFX_RECIPES: Record<SfxName, Recipe> = {
  // ---- player
  'step-grass': (c, out, t, o) => {
    noise(c, out, t, { kind: 'pink', gain: 0.42, a: 0.006, d: 0.08 + o.rnd() * 0.03, filter: 'bandpass', f: (1800 + o.rnd() * 900) * o.pitch, f2: 1200, q: 0.9 });
    return noise(c, out, t, { kind: 'white', gain: 0.08, a: 0.002, d: 0.05, filter: 'highpass', f: 5200, delay: 0.012 });
  },
  'step-wood': (c, out, t, o) => {
    tone(c, out, t, { f: (150 + o.rnd() * 25) * o.pitch, f2: 85, gain: 0.3, a: 0.002, d: 0.09 });
    tone(c, out, t, { type: 'triangle', f: 430 * o.pitch, f2: 380, gain: 0.05, a: 0.002, d: 0.07 });
    return noise(c, out, t, { gain: 0.1, a: 0.001, d: 0.035, filter: 'bandpass', f: 1100, q: 2 });
  },
  'step-water': (c, out, t, o) => {
    noise(c, out, t, { kind: 'pink', gain: 0.22, a: 0.01, d: 0.2, filter: 'lowpass', f: 2200 * o.pitch, f2: 450, q: 1.5 });
    return bubble(c, out, t + 0.04 + o.rnd() * 0.05, 450 + o.rnd() * 300, 0.06);
  },
  jump: (c, out, t) => {
    tone(c, out, t, { f: 210, f2: 320, gain: 0.08, a: 0.01, d: 0.08 });
    return noise(c, out, t, { kind: 'pink', gain: 0.2, a: 0.02, d: 0.14, filter: 'bandpass', f: 500, f2: 1400, q: 1 });
  },
  land: (c, out, t, o) => {
    tone(c, out, t, { f: 115 * o.pitch, f2: 55, gain: 0.32, a: 0.002, d: 0.13 });
    return noise(c, out, t, { kind: 'pink', gain: 0.14, a: 0.002, d: 0.09, filter: 'lowpass', f: 700 });
  },
  // ---- ui
  'ui-hover': (c, out, t, o) => tone(c, out, t, { f: 2300 * o.pitch, gain: 0.045, a: 0.002, d: 0.025 }),
  'ui-click': (c, out, t, o) => {
    tone(c, out, t, { type: 'triangle', f: 2400 * o.pitch, gain: 0.025, a: 0.001, d: 0.02 });
    return tone(c, out, t, { f: 1250 * o.pitch, f2: 980, gain: 0.13, a: 0.001, d: 0.05 });
  },
  'ui-open': (c, out, t, o) => {
    pluck(c, out, t, { f: 784 * o.pitch, gain: 0.1, d: 0.14 });
    return pluck(c, out, t, { f: 1175 * o.pitch, gain: 0.1, d: 0.2, delay: 0.06 });
  },
  'ui-close': (c, out, t, o) => {
    pluck(c, out, t, { f: 1175 * o.pitch, gain: 0.08, d: 0.12 });
    return pluck(c, out, t, { f: 784 * o.pitch, gain: 0.09, d: 0.18, delay: 0.055 });
  },
  mail: (c, out, t, o) => {
    noise(c, out, t, { kind: 'pink', gain: 0.14, a: 0.01, d: 0.1, filter: 'bandpass', f: 1600, f2: 2600, q: 1 });
    bell(c, out, t, { f: 1318.5 * o.pitch, gain: 0.26, d: 0.6, delay: 0.09 });
    return bell(c, out, t, { f: 1760 * o.pitch, gain: 0.28, d: 0.9, delay: 0.22 });
  },
  'letter-open': (c, out, t, o) => {
    let end = t;
    for (let i = 0; i < 3; i++) end = noise(c, out, t, { kind: 'white', gain: 0.2 + o.rnd() * 0.08, a: 0.012, d: 0.06, filter: 'bandpass', f: 3000 + o.rnd() * 2000, q: 0.7, delay: i * 0.07 });
    return max(end, noise(c, out, t, { kind: 'pink', gain: 0.18, a: 0.04, d: 0.16, filter: 'highpass', f: 1800, delay: 0.22 }));
  },
  // ---- notifications
  alert: (c, out, t, o) => {
    // "ding-ding-DING": a bright, friendly rising arpeggio that cuts through, with a soft sparkle tail
    const p = o.pitch;
    bell(c, out, t, { f: 659.3 * p, gain: 0.34, d: 0.8 });
    bell(c, out, t, { f: 987.8 * p, gain: 0.34, d: 0.8, delay: 0.13 });
    const end = bell(c, out, t, { f: 1318.5 * p, gain: 0.42, d: 1.4, delay: 0.26 });
    tone(c, out, t, { type: 'triangle', f: 659.3 * p, gain: 0.07, a: 0.05, hold: 0.25, d: 0.6, delay: 0.26 });
    sparkle(c, out, t + 0.4, o, 4, 0.05);
    return end;
  },
  'chime-done': (c, out, t, o) => {
    bell(c, out, t, { f: 784 * o.pitch, gain: 0.3, d: 0.9 });
    return bell(c, out, t, { f: 1046.5 * o.pitch, gain: 0.32, d: 1.3, delay: 0.17 });
  },
  'chime-pass': (c, out, t, o) => {
    const notes = [523.3, 659.3, 784, 1046.5];
    notes.forEach((f, i) => pluck(c, out, t, { f: f * o.pitch, gain: 0.22, d: 0.5, delay: i * 0.085 }));
    bell(c, out, t, { f: 1046.5 * o.pitch, gain: 0.18, d: 1.1, delay: 0.36 });
    bell(c, out, t, { f: 1318.5 * o.pitch, gain: 0.14, d: 1.1, delay: 0.36 });
    return max(t + 1.5, sparkle(c, out, t + 0.4, o, 5, 0.06));
  },
  oops: (c, out, t, o) => {
    // cute descending "wah-wah" (muted trombone)
    const p = o.pitch;
    formant(c, out, t, { wave: 'sawtooth', pitch: [[0, 392 * p], [0.16, 370 * p]], formants: [[700, 3, 1, 1100], [1200, 5, 0.4]], gain: 0.3, a: 0.02, hold: 0.1, d: 0.08 });
    return formant(c, out, t, { wave: 'sawtooth', pitch: [[0, 330 * p], [0.45, 262 * p]], formants: [[1100, 3, 1, 600], [1200, 5, 0.3]], gain: 0.3, a: 0.02, hold: 0.25, d: 0.2, delay: 0.24, vib: { rate: 5.5, depth: 0.025 } });
  },
  ship: (c, out, t, o) => {
    tone(c, out, t, { f: 95, f2: 58, gain: 0.35, a: 0.002, d: 0.16 });
    noise(c, out, t, { kind: 'brown', gain: 0.2, a: 0.002, d: 0.12, filter: 'lowpass', f: 500 });
    bell(c, out, t, { f: 1975.5 * o.pitch, gain: 0.18, d: 0.35, delay: 0.14, partials: [[1, 1, 1], [2.76, 0.4, 0.5]] });
    return bell(c, out, t, { f: 2637 * o.pitch, gain: 0.2, d: 0.6, delay: 0.21, partials: [[1, 1, 1], [2.76, 0.35, 0.5]] });
  },
  // ---- tools
  hammer: (c, out, t, o) => {
    tone(c, out, t, { f: 125, f2: 70, gain: 0.3, a: 0.001, d: 0.08 });
    noise(c, out, t, { gain: 0.18, a: 0.001, d: 0.02, filter: 'bandpass', f: 3200, q: 1 });
    tone(c, out, t, { f: 1180 * o.pitch, gain: 0.12, a: 0.001, d: 0.22 });
    return tone(c, out, t, { f: 2950 * o.pitch, gain: 0.06, a: 0.001, d: 0.12 });
  },
  hoe: (c, out, t, o) => {
    noise(c, out, t, { kind: 'pink', gain: 0.24, a: 0.01, d: 0.14, filter: 'bandpass', f: 1000 * o.pitch, f2: 420, q: 1.2 });
    return tone(c, out, t, { f: 150, f2: 80, gain: 0.22, a: 0.002, d: 0.08, delay: 0.07 });
  },
  'water-pour': (c, out, t, o) => {
    const dur = 1.1;
    // gurgle: many short band-passed noise grains with wandering centre + bubbles
    let end = noise(c, out, t, { kind: 'pink', gain: 0.25, a: 0.08, hold: dur - 0.3, d: 0.25, filter: 'bandpass', f: 900, f2: 1300, q: 2 });
    for (let i = 0; i < 14; i++) {
      const at = t + 0.05 + (i / 14) * (dur - 0.2) + o.rnd() * 0.04;
      noise(c, out, at, { kind: 'white', gain: 0.18, a: 0.01, d: 0.06, filter: 'bandpass', f: (700 + o.rnd() * 900) * o.pitch, q: 6 });
      if (o.rnd() < 0.5) end = max(end, bubble(c, out, at, (500 + o.rnd() * 600) * o.pitch, 0.07));
    }
    return end;
  },
  chop: (c, out, t, o) => {
    noise(c, out, t, { gain: 0.3, a: 0.001, d: 0.03, filter: 'bandpass', f: 2300, q: 1.5 });
    tone(c, out, t, { f: 270 * o.pitch, f2: 175, gain: 0.26, a: 0.001, d: 0.12 });
    return noise(c, out, t, { kind: 'brown', gain: 0.18, a: 0.002, d: 0.1, filter: 'lowpass', f: 500 });
  },
  page: (c, out, t) => {
    tone(c, out, t, { f: 3000, gain: 0.015, a: 0.001, d: 0.02 });
    return noise(c, out, t, { kind: 'white', gain: 0.18, a: 0.05, d: 0.12, filter: 'highpass', f: 3200, f2: 1500 });
  },
  whistle: (c, out, t, o) => {
    const p = o.pitch;
    tone(c, out, t, { f: 1400 * p, f2: 1900 * p, glide: 0.12, gain: 0.14, a: 0.03, hold: 0.06, d: 0.06, vib: { rate: 6, depth: 0.012 } });
    return tone(c, out, t, { f: 1900 * p, f2: 1450 * p, glide: 0.3, gain: 0.15, a: 0.03, hold: 0.18, d: 0.12, delay: 0.2, vib: { rate: 6, depth: 0.015 } });
  },
  // ---- animals
  quack: (c, out, t, o) => {
    const p = o.pitch;
    const q = (dt: number, k: number) => formant(c, out, t, { wave: 'sawtooth', pitch: [[0, 560 * p * k], [0.05, 520 * p * k], [0.13, 400 * p * k]], formants: [[1000, 5, 1], [1500, 8, 0.8], [2400, 6, 0.3]], gain: 0.4, a: 0.008, hold: 0.05, d: 0.08, delay: dt, breath: 0.1 });
    q(0, 1);
    return q(0.19, 0.93);
  },
  cluck: (c, out, t, o) => {
    let end = t;
    const p = o.pitch;
    for (let i = 0; i < 3; i++) end = formant(c, out, t, { wave: 'square', pitch: [[0, 430 * p], [0.05, 380 * p]], formants: [[900, 4, 1], [1800, 6, 0.5]], gain: 0.28, a: 0.004, d: 0.06, delay: i * 0.1 + o.rnd() * 0.02 });
    return max(end, formant(c, out, t, { wave: 'square', pitch: [[0, 520 * p], [0.12, 620 * p], [0.22, 480 * p]], formants: [[1000, 4, 1], [2000, 6, 0.5]], gain: 0.28, a: 0.01, hold: 0.08, d: 0.12, delay: 0.34 }));
  },
  moo: (c, out, t, o) => {
    const p = o.pitch;
    return formant(c, out, t, { wave: 'sawtooth', pitch: [[0, 100 * p], [0.3, 126 * p], [0.9, 118 * p], [1.25, 92 * p]], formants: [[380, 3, 1, 700], [900, 4, 0.5, 1100], [180, 2, 0.6]], gain: 0.42, a: 0.12, hold: 0.8, d: 0.4, vib: { rate: 4, depth: 0.012 }, breath: 0.05 });
  },
  baa: (c, out, t, o) => {
    const p = o.pitch;
    return formant(c, out, t, { wave: 'sawtooth', pitch: [[0, 300 * p], [0.1, 345 * p], [0.6, 320 * p]], formants: [[750, 4, 1], [1250, 5, 0.6], [2600, 6, 0.2]], gain: 0.34, a: 0.04, hold: 0.35, d: 0.25, vib: { rate: 7.5, depth: 0.045 }, am: { rate: 7.5, depth: 0.5 } });
  },
  oink: (c, out, t, o) => {
    const p = o.pitch;
    const snort = (dt: number, k: number) => formant(c, out, t, { wave: 'sawtooth', pitch: [[0, 200 * p * k], [0.14, 160 * p * k]], formants: [[650, 3, 1], [1400, 5, 0.4]], gain: 0.38, a: 0.01, hold: 0.06, d: 0.08, delay: dt, am: { rate: 38, depth: 0.8 }, breath: 0.35 });
    snort(0, 1);
    return snort(0.2, 1.12);
  },
  buzz: (c, out, t, o) => {
    const p = o.pitch;
    formant(c, out, t, { wave: 'sawtooth', pitch: [[0, 225 * p], [0.3, 240 * p], [0.7, 220 * p]], formants: [[900, 2, 1], [2200, 3, 0.4]], gain: 0.14, a: 0.08, hold: 0.4, d: 0.2, am: { rate: 11, depth: 0.35 }, vib: { rate: 3, depth: 0.02 } });
    return formant(c, out, t, { wave: 'sawtooth', pitch: [[0, 229 * p], [0.7, 226 * p]], formants: [[900, 2, 1]], gain: 0.1, a: 0.08, hold: 0.4, d: 0.2 });
  },
  bark: (c, out, t, o) => {
    const p = o.pitch;
    const woof = (dt: number, k: number, g: number) => formant(c, out, t, { wave: 'sawtooth', pitch: [[0, 380 * p * k], [0.035, 520 * p * k], [0.15, 290 * p * k]], formants: [[750, 3, 1, 550], [1600, 5, 0.5], [300, 2, 0.4]], gain: g, a: 0.006, hold: 0.04, d: 0.1, delay: dt, breath: 0.25 });
    woof(0, 1, 0.42);
    return woof(0.2, 0.94, 0.34);
  },
  meow: (c, out, t, o) => {
    const p = o.pitch;
    return formant(c, out, t, { wave: 'sawtooth', pitch: [[0, 520 * p], [0.15, 740 * p], [0.45, 580 * p], [0.62, 430 * p]], formants: [[450, 4, 1, 650], [2300, 6, 0.5, 1000], [1200, 5, 0.4]], gain: 0.3, a: 0.05, hold: 0.35, d: 0.22, vib: { rate: 5, depth: 0.02 } });
  },
  purr: (c, out, t, o) => {
    // two breath cycles of a low 25 Hz rattle
    let end = t;
    for (let i = 0; i < 2; i++) {
      const dt = i * 0.85;
      end = formant(c, out, t, { wave: 'sawtooth', pitch: [[0, 50 * o.pitch]], formants: [[180, 1, 1], [420, 2, 0.4]], gain: i === 0 ? 0.5 : 0.4, a: 0.2, hold: 0.25, d: 0.3, delay: dt, am: { rate: 24 + i * 2, depth: 0.95 }, breath: 0.6 });
    }
    return end;
  },
  pet: (c, out, t, o) => {
    noise(c, out, t, { kind: 'pink', gain: 0.24, a: 0.08, d: 0.18, filter: 'lowpass', f: 1100 });
    noise(c, out, t, { kind: 'pink', gain: 0.2, a: 0.08, d: 0.2, filter: 'lowpass', f: 1000, delay: 0.3 });
    return sparkle(c, out, t + 0.2, o, 3, 0.05);
  },
  greet: (c, out, t, o) => renderVoice(c, out, t, planVoice('greet', 'happy', 2, Math.floor(o.rnd() * 8)), 0.9),
  voice: (c, out, t, o) => renderVoice(c, out, t, planVoice('valley', 'happy', 3, Math.floor(o.rnd() * 8)), 0.9),
  // ---- world
  splash: (c, out, t, o) => {
    noise(c, out, t, { kind: 'white', gain: 0.45, a: 0.004, d: 0.35, filter: 'lowpass', f: 5000 * o.pitch, f2: 500 });
    noise(c, out, t, { kind: 'pink', gain: 0.25, a: 0.01, hold: 0.05, d: 0.3, filter: 'bandpass', f: 1300, q: 1 });
    let end = t + 0.45;
    for (let i = 0; i < 4; i++) end = max(end, bubble(c, out, t + 0.1 + o.rnd() * 0.3, (380 + o.rnd() * 500) * o.pitch, 0.05));
    return end;
  },
  bell: (c, out, t, o) => {
    noise(c, out, t, { gain: 0.08, a: 0.001, d: 0.03, filter: 'bandpass', f: 2500, q: 1 });
    return bell(c, out, t, { f: 523.3 * o.pitch, gain: 0.42, d: 2.8, partials: BIG_BELL });
  },
  creak: (c, out, t, o) => formant(c, out, t, { wave: 'sawtooth', pitch: [[0, 32 * o.pitch], [0.25, 58 * o.pitch], [0.55, 41 * o.pitch], [0.7, 47 * o.pitch]], formants: [[700, 6, 1], [1400, 8, 0.5]], gain: 0.4, a: 0.08, hold: 0.4, d: 0.2, breath: 0.1 }),
  pop: (c, out, t, o) => {
    noise(c, out, t, { gain: 0.08, a: 0.001, d: 0.012, filter: 'highpass', f: 4000 });
    return tone(c, out, t, { f: 720 * o.pitch, f2: 230, glide: 0.07, gain: 0.34, a: 0.001, d: 0.08 });
  },
  sparkle: (c, out, t, o) => { tone(c, out, t, { f: 1046.5 * o.pitch, gain: 0.05, a: 0.01, d: 0.5 }); return sparkle(c, out, t, o, 7, 0.09); },
  thunder: (c, out, t, o) => {
    const near = o.pitch > 1.05; // callers pass pitch > 1 for a close strike (crack)
    if (near) noise(c, out, t, { kind: 'white', gain: 0.25, a: 0.002, d: 0.35, filter: 'bandpass', f: 1600, f2: 400, q: 0.7 });
    let end = t;
    const rumbles = [0, 0.35 + o.rnd() * 0.3, 1.0 + o.rnd() * 0.5, 2 + o.rnd() * 0.8];
    rumbles.forEach((dt, i) => {
      end = max(end, noise(c, out, t, { kind: 'brown', gain: (i === 0 ? 0.55 : 0.45 - i * 0.07), a: 0.08 + i * 0.1, hold: 0.2, d: 1.4 + i * 0.5, filter: 'lowpass', f: 700 - i * 120, f2: 140, q: 0.8, delay: dt }));
    });
    return end;
  },
  // ---- the almanac
  fanfare: (c, out, t, o) => {
    // a little brass-and-bells "ta-da-da-DAAA": G C E G' with a held major chord and a sparkle shower
    const p = o.pitch;
    const notes: [number, number, number][] = [[392, 0, 0.12], [523.3, 0.13, 0.12], [659.3, 0.26, 0.12], [784, 0.4, 0.9]];
    let end = t;
    for (const [f, dl, hold] of notes) {
      end = max(end, formant(c, out, t, { wave: 'sawtooth', pitch: [[0, f * p], [0.03, f * p]], formants: [[900, 2.5, 1, 1400], [2200, 4, 0.35]], gain: 0.2, a: 0.015, hold, d: 0.25, delay: dl, vib: dl > 0.3 ? { rate: 5.2, depth: 0.012 } : undefined }));
    }
    for (const f of [523.3, 659.3, 784, 1046.5]) tone(c, out, t, { type: 'triangle', f: f * p, gain: 0.05, a: 0.06, hold: 0.6, d: 0.8, delay: 0.4 });
    bell(c, out, t, { f: 1568 * p, gain: 0.16, d: 1.6, delay: 0.42 });
    return max(end, sparkle(c, out, t + 0.5, o, 9, 0.06));
  },
  firework: (c, out, t, o) => {
    // whistle up, a soft boom, then crackle
    tone(c, out, t, { type: 'sine', f: 900 * o.pitch, f2: 2200 * o.pitch, glide: 0.9, gain: 0.035, a: 0.05, d: 0.9 });
    const boom = 0.95;
    tone(c, out, t, { f: 80, f2: 38, gain: 0.4, a: 0.003, d: 0.6, delay: boom });
    noise(c, out, t, { kind: 'brown', gain: 0.3, a: 0.003, d: 0.5, filter: 'lowpass', f: 600, f2: 200, delay: boom });
    let end = t + boom + 0.6;
    for (let i = 0; i < 14; i++) end = max(end, noise(c, out, t, { kind: 'white', gain: 0.05 + o.rnd() * 0.05, a: 0.001, d: 0.02 + o.rnd() * 0.03, filter: 'highpass', f: 3000 + o.rnd() * 3000, delay: boom + 0.15 + i * 0.05 + o.rnd() * 0.06 }));
    return end;
  },
  // ---- the player's pastimes (scene/forage)
  cast: (c, out, t, o) => {
    // the rod's whoosh, the reel's quick buzz, the bobber's plip as it lands (~0.55 s later)
    noise(c, out, t, { kind: 'pink', gain: 0.22, a: 0.05, d: 0.22, filter: 'bandpass', f: 600 * o.pitch, f2: 2600 * o.pitch, q: 1.4 });
    for (let i = 0; i < 6; i++) noise(c, out, t, { kind: 'white', gain: 0.04, a: 0.001, d: 0.015, filter: 'bandpass', f: 3800, q: 3, delay: 0.12 + i * 0.035 });
    return tone(c, out, t, { f: 360 * o.pitch, f2: 1200 * o.pitch, glide: 0.06, gain: 0.16, a: 0.002, d: 0.08, delay: 0.55 });
  },
  plop: (c, out, t, o) => {
    noise(c, out, t, { kind: 'pink', gain: 0.08, a: 0.002, d: 0.06, filter: 'lowpass', f: 1600 });
    return tone(c, out, t, { f: 320 * o.pitch, f2: 1150 * o.pitch, glide: 0.07, gain: 0.22, a: 0.002, d: 0.08 });
  },
  bite: (c, out, t, o) => {
    // a deep bloop as the float goes under, a splashy kick, and a bright "!" ping so it can't be missed
    tone(c, out, t, { f: 520 * o.pitch, f2: 150 * o.pitch, glide: 0.12, gain: 0.32, a: 0.002, d: 0.16 });
    noise(c, out, t, { kind: 'white', gain: 0.22, a: 0.004, d: 0.22, filter: 'lowpass', f: 3800, f2: 600, delay: 0.03 });
    bubble(c, out, t + 0.12, 620 * o.pitch, 0.08);
    return tone(c, out, t, { type: 'triangle', f: 1760 * o.pitch, gain: 0.09, a: 0.003, d: 0.25, delay: 0.05 });
  },
  coins: (c, out, t, o) => {
    // a little "cha-ching": a pocketful of bits clinking into the till, then a bright bell
    let end = t;
    for (let i = 0; i < 5; i++) end = tone(c, out, t, { type: 'triangle', f: (2300 + o.rnd() * 900) * o.pitch, gain: 0.07, a: 0.001, d: 0.09 + o.rnd() * 0.06, delay: i * 0.045 + o.rnd() * 0.02 });
    noise(c, out, t, { kind: 'white', gain: 0.05, a: 0.001, d: 0.04, filter: 'bandpass', f: 5200, q: 3, delay: 0.02 });
    return max(end, tone(c, out, t, { f: 1568 * o.pitch, f2: 2093 * o.pitch, glide: 0.02, gain: 0.08, a: 0.003, d: 0.35, delay: 0.26 }));
  },
  reel: (c, out, t, o) => {
    let end = t;
    for (let i = 0; i < 14; i++) end = noise(c, out, t, { kind: 'white', gain: 0.1 * (1 - i / 20), a: 0.001, d: 0.018, filter: 'bandpass', f: (2600 + (i % 3) * 300) * o.pitch, q: 4, delay: i * 0.045 });
    return max(end, noise(c, out, t, { kind: 'pink', gain: 0.18, a: 0.01, d: 0.25, filter: 'lowpass', f: 2400, f2: 600, delay: 0.62 }));
  },
};

export const CRITTER_RECIPES: Record<CritterSound, Recipe> = {
  chirp: (c, out, t, o) => {
    const n = 2 + Math.floor(o.rnd() * 3);
    const f = (3000 + o.rnd() * 1400) * o.pitch;
    let end = t;
    for (let i = 0; i < n; i++) end = tone(c, out, t, { f: f * (1 + i * 0.03), f2: f * 1.3, glide: 0.045, gain: 0.12, a: 0.004, d: 0.05, delay: i * (0.075 + o.rnd() * 0.02) });
    return end;
  },
  coo: (c, out, t, o) => {
    const p = o.pitch;
    const part = (dt: number, a: number, b: number, len: number, g: number) => formant(c, out, t, { wave: 'triangle', pitch: [[0, a * p], [len * 0.5, b * p], [len, a * p * 0.95]], formants: [[420, 2, 1], [900, 3, 0.25]], gain: g, a: 0.03, hold: len * 0.5, d: len * 0.4, delay: dt, am: { rate: 22, depth: 0.35 }, breath: 0.1 });
    part(0, 330, 380, 0.14, 0.3);
    part(0.2, 360, 420, 0.32, 0.34);
    return part(0.6, 330, 300, 0.22, 0.26);
  },
  flap: (c, out, t, o) => {
    let end = t;
    for (let i = 0; i < 5; i++) end = noise(c, out, t, { kind: 'pink', gain: 0.5 * (1 - i * 0.14), a: 0.012, d: 0.045, filter: 'bandpass', f: 900 + o.rnd() * 500, q: 0.8, delay: i * (0.075 + i * 0.008) });
    return end;
  },
  ribbit: (c, out, t, o) => {
    const p = o.pitch;
    const r = (dt: number, len: number, f: number) => formant(c, out, t, { wave: 'sawtooth', pitch: [[0, f * p], [len, f * 0.9 * p]], formants: [[700, 3, 1], [1400, 5, 0.5]], gain: 0.34, a: 0.005, hold: len * 0.6, d: len * 0.4, delay: dt, am: { rate: 55, depth: 0.95 } });
    r(0, 0.08, 190);
    return r(0.13, 0.12, 170);
  },
  plop: (c, out, t, o) => {
    noise(c, out, t, { kind: 'pink', gain: 0.08, a: 0.002, d: 0.06, filter: 'lowpass', f: 1600 });
    return tone(c, out, t, { f: 320 * o.pitch, f2: 1150 * o.pitch, glide: 0.07, gain: 0.22, a: 0.002, d: 0.08 });
  },
  hop: (c, out, t, o) => {
    tone(c, out, t, { f: 95 * o.pitch, f2: 60, gain: 0.14, a: 0.002, d: 0.06 });
    return noise(c, out, t, { kind: 'pink', gain: 0.05, a: 0.002, d: 0.04, filter: 'lowpass', f: 600 });
  },
  squeak: (c, out, t, o) => {
    let end = t;
    const n = 3 + Math.floor(o.rnd() * 3);
    for (let i = 0; i < n; i++) end = tone(c, out, t, { f: (2500 + o.rnd() * 500) * o.pitch, f2: 3300 * o.pitch, glide: 0.03, gain: 0.08, a: 0.003, d: 0.035, delay: i * 0.065 });
    return end;
  },
  wag: (c, out, t, o) => {
    let end = t;
    for (let i = 0; i < 4; i++) end = noise(c, out, t, { kind: 'pink', gain: 0.3, a: 0.02, d: 0.07, filter: 'bandpass', f: 1300 * o.pitch, q: 1.6, delay: i * 0.16 });
    return end;
  },
  sniff: (c, out, t, o) => {
    let end = t;
    const n = 3 + Math.floor(o.rnd() * 2);
    for (let i = 0; i < n; i++) end = noise(c, out, t, { kind: 'white', gain: 0.16, a: 0.012, d: 0.05, filter: 'bandpass', f: 2600 * o.pitch, q: 1.2, delay: i * 0.09 });
    return end;
  },
  shake: (c, out, t, o) => {
    let end = t;
    for (let i = 0; i < 9; i++) end = noise(c, out, t, { kind: 'pink', gain: 0.22 * (1 - i / 11), a: 0.01, d: 0.06, filter: 'bandpass', f: (900 + (i % 2) * 500) * o.pitch, q: 1.1, delay: i * 0.075 });
    for (let i = 0; i < 5; i++) noise(c, out, t, { kind: 'white', gain: 0.05, a: 0.002, d: 0.03, filter: 'highpass', f: 3000, delay: 0.2 + o.rnd() * 0.6 });
    return end;
  },
  caw: (c, out, t, o) => {
    const p = o.pitch;
    let end = t;
    const n = 1 + Math.floor(o.rnd() * 2);
    for (let i = 0; i < n; i++) {
      noise(c, out, t, { kind: 'pink', gain: 0.18, a: 0.02, hold: 0.12, d: 0.14, filter: 'bandpass', f: 1100 * p, q: 3, delay: i * 0.42 });
      end = tone(c, out, t, { f: 560 * p, f2: 470 * p, glide: 0.25, gain: 0.07, a: 0.02, hold: 0.1, d: 0.15, delay: i * 0.42, lp: 1800 });
    }
    return end;
  },
  hoot: (c, out, t, o) => {
    const p = o.pitch;
    const h = (dt: number, len: number, g: number) => {
      noise(c, out, t, { kind: 'pink', gain: g * 0.12, a: 0.04, hold: len * 0.5, d: len * 0.4, filter: 'bandpass', f: 360 * p, q: 4, delay: dt });
      return tone(c, out, t, { f: 370 * p, f2: 345 * p, gain: g, a: 0.05, hold: len * 0.5, d: len * 0.4, delay: dt, lp: 900 });
    };
    h(0, 0.4, 0.22);
    h(0.62, 0.16, 0.16);
    return h(0.85, 0.42, 0.2);
  },
  fish: (c, out, t, o) => {
    noise(c, out, t, { kind: 'white', gain: 0.35, a: 0.003, d: 0.16, filter: 'lowpass', f: 3500, f2: 700 });
    return bubble(c, out, t + 0.05, 500 * o.pitch, 0.12);
  },
};

/** Where a sound goes: the settings category it belongs to. */
export type BusName = 'sfx' | 'notify' | 'voice' | 'ambient';
export function busOf(name: SfxName): BusName {
  switch (name) {
    case 'alert': case 'chime-done': case 'chime-pass': case 'mail': case 'bell': case 'oops': case 'fanfare': return 'notify';
    case 'greet': case 'voice': return 'voice';
    case 'thunder': case 'firework': return 'ambient';
    default: return 'sfx';
  }
}

/** Reverb send per sound (0..1): bells and chimes ring out across the valley, UI stays dry. */
export function sendOf(name: SfxName): number {
  switch (name) {
    case 'bell': return 0.5;
    case 'alert': case 'chime-done': case 'chime-pass': case 'mail': case 'fanfare': return 0.25;
    case 'thunder': case 'firework': return 0.4;
    case 'ui-hover': case 'ui-click': case 'ui-open': case 'ui-close': case 'step-grass': case 'step-wood': case 'step-water': return 0;
    default: return 0.12;
  }
}

