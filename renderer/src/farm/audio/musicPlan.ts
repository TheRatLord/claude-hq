/**
 * Gentle generative background music, planned bar by bar (pure, deterministic from bar index + seed).
 *   day   — F major pentatonic, kalimba plucks over a soft pad, 84 bpm
 *   night — D minor pentatonic music box, sparser, 62 bpm
 *   rain  — the day scale, slower and lower, 70 bpm
 * Every 16 bars two bars breathe (pad only) so it never nags.
 */
import { hash32, mulberry32 } from '../../../../shared/identity.ts';
import type { MusicMood } from './mix.ts';

export type MusicVoice = 'pluck' | 'bell' | 'pad' | 'bass';
export interface Note { t: number; midi: number; dur: number; vel: number; voice: MusicVoice }
export interface Bar { notes: Note[]; barSec: number; chord: string }

/** F, G, A, C, D — the same five pitch classes serve F major and D minor pentatonic. */
export const PENTA: readonly number[] = [0, 2, 5, 7, 9];
const CHORDS: Record<string, { root: number; tones: number[] }> = {
  F: { root: 53, tones: [5, 9, 0] },
  Dm: { root: 50, tones: [2, 5, 9] },
  Bb: { root: 46, tones: [10, 2, 5, 9] },
  C: { root: 48, tones: [0, 7, 2] },
};
const PROG: Record<MusicMood, string[]> = { day: ['F', 'Dm', 'Bb', 'C'], night: ['Dm', 'Bb', 'F', 'C'], rain: ['Bb', 'F', 'Dm', 'C'] };
const BPM: Record<MusicMood, number> = { day: 84, night: 62, rain: 70 };
const DENSITY: Record<MusicMood, number> = { day: 0.42, night: 0.22, rain: 0.28 };
const REGISTER: Record<MusicMood, [number, number]> = { day: [69, 86], night: [74, 91], rain: [65, 81] };

export const barSeconds = (mood: MusicMood): number => (60 / BPM[mood]) * 4;
export const inScale = (midi: number): boolean => PENTA.includes(((midi % 12) + 12) % 12);

/** All pentatonic notes within [lo, hi]. */
function scaleNotes(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if (inScale(m)) out.push(m);
  return out;
}

export function planBar(bar: number, mood: MusicMood, seed = 1): Bar {
  const r = mulberry32(hash32(`music:${seed}:${mood}:${bar}`));
  const barSec = barSeconds(mood);
  const beat = barSec / 4;
  const name = PROG[mood][((bar % 4) + 4) % 4];
  const chord = CHORDS[name];
  const notes: Note[] = [];
  // pad: the chord, whole bar, very soft
  const padBase = chord.root + 12;
  for (const pc of chord.tones.slice(0, 3)) {
    let m = padBase;
    while (((m % 12) + 12) % 12 !== pc) m++;
    notes.push({ t: 0, midi: m, dur: barSec * 1.05, vel: 0.35, voice: 'pad' });
  }
  if (mood !== 'night' || bar % 2 === 0) notes.push({ t: 0, midi: chord.root, dur: beat * 2.5, vel: 0.4, voice: 'bass' });
  const phrase = ((bar % 16) + 16) % 16;
  if (phrase >= 14) return { notes, barSec, chord: name }; // breathe
  const [lo, hi] = REGISTER[mood];
  const scale = scaleNotes(lo, hi);
  let idx = Math.floor(r() * scale.length);
  const density = DENSITY[mood] * (phrase % 8 === 7 ? 0.5 : 1);
  const voice: MusicVoice = mood === 'night' ? 'bell' : 'pluck';
  for (let step = 0; step < 8; step++) {
    const strong = step % 2 === 0;
    if (r() > density * (strong ? 1.3 : 0.7)) continue;
    // small melodic steps, occasional leaps
    const move = r() < 0.15 ? (r() < 0.5 ? -3 : 3) : Math.round((r() - 0.5) * 3);
    idx = Math.max(0, Math.min(scale.length - 1, idx + move));
    let m = scale[idx];
    // strong beats lean onto chord tones when one is adjacent
    if (strong) {
      for (const d of [0, 1, -1]) {
        const c = scale[idx + d];
        if (c !== undefined && chord.tones.includes(c % 12)) { m = c; idx += d; break; }
      }
    }
    const t = step * (beat / 2) + (r() - 0.5) * 0.012;
    notes.push({ t: Math.max(0, t), midi: m, dur: beat * (mood === 'night' ? 2 : 1.2), vel: (strong ? 0.75 : 0.55) + r() * 0.2, voice });
  }
  return { notes, barSec, chord: name };
}

export const midiHz = (m: number): number => 440 * 2 ** ((m - 69) / 12);
