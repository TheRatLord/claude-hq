/**
 * Animal-Crossing-style babble: a pure plan of syllables (timing, pitch contour, vowel formants) for a speaker seed
 * and mood. voice.ts turns the plan into sound; tests check the contours.
 */
import { hash32, mulberry32 } from '../../../../shared/identity.ts';

export type VoiceMood = 'happy' | 'question' | 'sad' | 'excited';

export interface Syllable {
  /** start offset (s) */
  t: number;
  dur: number;
  /** start and end pitch (Hz) — each syllable glides */
  f0: number;
  f1: number;
  /** vowel formants (Hz) */
  fa: number;
  fb: number;
  /** 0..1 */
  gain: number;
}
export interface Timbre {
  /** speaking pitch (Hz) */
  base: number;
  /** 0 soft triangle … 1 buzzy square */
  buzz: number;
  /** formant scale (small critters are brighter) */
  bright: number;
  /** syllable rate multiplier */
  speed: number;
}
export interface VoicePlan { timbre: Timbre; syllables: Syllable[]; total: number }

/** Vowel formant pairs (F1, F2): a e i o u, plus "ah-ee" diphthong-ish midpoint. */
const VOWELS: readonly [number, number][] = [[800, 1250], [520, 1850], [330, 2300], [520, 950], [370, 850], [650, 1600]];

export function timbreOf(seed: string): Timbre {
  const r = mulberry32(hash32(`voice:${seed}`));
  return {
    base: 185 + r() * 230,
    buzz: 0.15 + r() * 0.6,
    bright: 1 + r() * 0.35,
    speed: 0.88 + r() * 0.3,
  };
}

/**
 * @param variant makes repeated lines from one speaker differ (callers pass a counter); deterministic per value.
 */
export function planVoice(seed: string, mood: VoiceMood = 'happy', syllables?: number, variant = 0): VoicePlan {
  const timbre = timbreOf(seed);
  const r = mulberry32(hash32(`line:${seed}:${mood}:${variant}`));
  const n = Math.max(1, Math.min(12, Math.round(syllables ?? 3 + Math.floor(r() * 4))));
  const moodRate = mood === 'excited' ? 0.72 : mood === 'sad' ? 1.4 : mood === 'question' ? 0.95 : 0.9;
  const moodPitch = mood === 'excited' ? 1.16 : mood === 'sad' ? 0.86 : 1;
  const out: Syllable[] = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const p = n > 1 ? i / (n - 1) : 1;
    const dur = (0.07 + r() * 0.035) * moodRate / timbre.speed;
    let k = 1 + (r() - 0.5) * 0.12;
    let glide = 1 + (r() - 0.5) * 0.06;
    switch (mood) {
      case 'happy': k *= 1 + 0.08 * Math.sin(i * 2.3 + 0.5) + 0.04 * p; glide *= 1.04; break;
      case 'question': k *= i >= n - 1 ? 1.12 : 1 - 0.03 * p; glide *= i >= n - 1 ? 1.35 : 1; break;
      case 'sad': k *= 1 - 0.16 * p; glide *= 0.94; break;
      case 'excited': k *= i % 2 === 0 ? 1.12 : 0.9; glide *= 1.08; break;
    }
    const f0 = timbre.base * moodPitch * k;
    const [fa, fb] = VOWELS[Math.floor(r() * VOWELS.length)];
    const gain = (mood === 'sad' ? 0.7 : 0.85 + r() * 0.15) * (i === 0 ? 1 : 0.92);
    out.push({ t, dur, f0, f1: f0 * glide, fa: fa * timbre.bright, fb: fb * timbre.bright, gain });
    t += dur + (0.018 + r() * 0.025) * moodRate;
  }
  const last = out[out.length - 1];
  return { timbre, syllables: out, total: last.t + last.dur };
}
