/**
 * Clawd vocal blips (animal-crossing-style gibberish, §6.7 reactions): each reaction becomes a short phrase of
 * syllables whose pitch contour carries the emotion (startle = one sharp "eep!", victory = a rising "ya-ya-yaaay",
 * slump = a falling "aww"). Every agent has its own voice (pitch, speed, vowel colour) seeded from `seedKey`, so
 * the same Clawd always sounds the same. Shelly speaks in square-wave "bleep-bloop".
 *
 * `phrasePlan` is pure (tested); `speak` realises a plan with ONE oscillator + two formant bandpasses + one noise
 * consonant source, all automated (≈ 8 nodes per phrase, freed when it ends).
 * Owner: AUD.
 */
import { hash32, mulberry32 } from '../../../shared/identity.ts';

/** Cute (small-creature) vowel formants [F1, F2] Hz, raised ~20% over an adult voice. */
export const VOWELS: Readonly<Record<string, readonly [number, number]>> = Object.freeze({
  a: [950, 1550], e: [600, 2350], i: [390, 3000], o: [600, 1100], u: [420, 950],
});

/**
 * Reaction → phrase shape. `n` syllables; `c` = pitch multipliers per syllable (last one repeats); `v` = vowel
 * string cycled; `d` = syllable seconds; `last` = extra length on the final syllable; `vib` vibrato depth; `cons` =
 * consonant burst chance; `amp` loudness. Reactions without an entry are silent (dissolveIn, bellTap: the bell
 * itself speaks, …).
 */
export interface Phrase {
  n: number;
  c: number[];
  v: string;
  d: number;
  amp: number;
  glide?: number;
  last?: number;
  vib?: number;
  cons?: number;
  breathy?: boolean;
  choo?: boolean;
  random?: boolean;
}
export const PHRASES: Readonly<Record<string, Phrase>> = Object.freeze({
  startle: { n: 1, c: [1.55], glide: 1.25, v: 'i', d: 0.12, amp: 1.0, cons: 0 },
  victory: { n: 5, c: [1.0, 1.12, 1.25, 1.33, 1.5], v: 'aaeaa', d: 0.075, last: 0.22, vib: 0.04, amp: 1.0, cons: 0.7 },
  clap: { n: 3, c: [1.2, 1.3, 1.45], v: 'aea', d: 0.07, amp: 0.7, cons: 0.8 },
  wave: { n: 2, c: [1.25, 1.05], v: 'ia', d: 0.09, last: 0.08, amp: 0.8, cons: 0.6 },
  arrive: { n: 3, c: [1.0, 1.3, 1.2], v: 'aii', d: 0.08, last: 0.12, amp: 0.8, cons: 0.6 },
  leave: { n: 4, c: [1.2, 1.0, 1.2, 1.0], v: 'aiai', d: 0.075, amp: 0.7, cons: 0.9 },
  thankYou: { n: 3, c: [1.2, 1.0, 1.3], v: 'aeu', d: 0.085, last: 0.1, amp: 0.8, cons: 0.9 },
  bow: { n: 3, c: [1.2, 1.0, 1.3], v: 'aeu', d: 0.085, last: 0.1, amp: 0.7, cons: 0.9 },
  hop: { n: 1, c: [1.35], glide: 1.15, v: 'e', d: 0.08, amp: 0.55, cons: 0.5 },
  bump: { n: 4, c: [1.4, 1.3, 1.4, 1.3], v: 'eeee', d: 0.055, amp: 0.7, cons: 1, breathy: true }, // giggle "hehehe"
  fistPump: { n: 2, c: [1.1, 1.45], v: 'ee', d: 0.07, last: 0.12, amp: 0.9, cons: 0.8 },
  highFive: { n: 2, c: [1.3, 1.55], v: 'aa', d: 0.07, last: 0.1, amp: 0.9, cons: 0.6 },
  slump: { n: 2, c: [1.0, 0.72], glide: 0.85, v: 'ao', d: 0.12, last: 0.22, amp: 0.7, cons: 0 },
  dizzy: { n: 3, c: [1.2, 0.95, 0.8], v: 'uoa', d: 0.1, vib: 0.12, amp: 0.7, cons: 0.2 },
  sneeze: { n: 3, c: [1.1, 1.3, 0.9], v: 'aau', d: 0.1, last: 0.02, amp: 0.8, cons: 0, choo: true },
  wake: { n: 2, c: [1.3, 0.8], glide: 0.8, v: 'ao', d: 0.2, last: 0.25, amp: 0.55, cons: 0 },
  unblock: { n: 3, c: [1.0, 1.25, 1.5], v: 'oaa', d: 0.08, last: 0.1, amp: 0.8, cons: 0.5 },
  pat: { n: 2, c: [1.1, 1.0], v: 'ee', d: 0.1, amp: 0.5, cons: 0.8 },
  busyFinger: { n: 2, c: [1.0, 0.85], v: 'uu', d: 0.1, amp: 0.45, cons: 0 }, // "mm-mm"
  workCall: { n: 2, c: [1.4, 1.2], v: 'ia', d: 0.08, amp: 0.75, cons: 0.7 },
  whee: { n: 1, c: [1.0], glide: 1.7, v: 'i', d: 0.62, vib: 0.05, amp: 0.9, cons: 1 }, // the player on the slide
  chat: { n: 4, c: [1.0], v: 'aeiouaeo', d: 0.075, amp: 0.6, cons: 0.75, random: true }, // idle chatting pairs (§6.7 fun layer)
  hi: { n: 2, c: [1.15, 1.5], glide: 1.12, v: 'ai', d: 0.075, last: 0.13, amp: 0.95, cons: 0.9 }, // Ada / Bean greeting: "ha-i!"
  exhale: { n: 1, c: [0.85], glide: 0.8, v: 'a', d: 0.35, amp: 0.35, cons: 0, breathy: true },
});

export interface VoiceProfile { robot: boolean; base: number; speed: number; bright: number; vowelShift: number }

/**
 * Per-agent voice from its stable identity.
 * `kind` = entity kind ('shell' → Shelly).
 */
export function voiceProfile(seedKey: string, kind = 'claude'): VoiceProfile {
  const r = mulberry32(hash32(`voice|${seedKey}`));
  if (kind === 'shell') return { robot: true, base: 240 + r() * 120, speed: 0.9 + r() * 0.3, bright: 0.6, vowelShift: 1 };
  // a musical base (pentatonic degree of A4..A5), so two Clawds chatting land on friendly intervals
  const PENTA = [0, 2, 4, 7, 9, 12];
  const base = 392 * 2 ** (PENTA[Math.floor(r() * PENTA.length)] / 12) * (0.97 + r() * 0.06);
  return { robot: false, base, speed: 0.85 + r() * 0.35, bright: 0.35 + r() * 0.5, vowelShift: 0.92 + r() * 0.18 };
}

export interface Syllable { t: number; dur: number; f0: number; f1: number; vowel: string; amp: number; cons: boolean; vib: number }

/**
 * Pure: the syllable timeline for one reaction.
 * `seed` = per-utterance variation.
 */
export function phrasePlan(reaction: string, prof: VoiceProfile, seed = 0): Syllable[] | null {
  const P = PHRASES[reaction];
  if (!P) return null;
  const r = mulberry32((hash32(reaction) ^ (seed * 2654435761)) >>> 0);
  const out: Syllable[] = [];
  let t = 0;
  const n = P.random ? 2 + Math.floor(r() * 5) : P.n + (P.n >= 3 && r() < 0.3 ? 1 : 0); // an occasional extra syllable keeps it from sounding canned
  const ask = P.random && r() < 0.35; // chat: sometimes a question (the last syllable lifts)
  const vowels = P.random ? [...P.v].sort(() => r() - 0.5).join('') : P.v;
  for (let i = 0; i < n; i++) {
    const ci = Math.min(i, P.c.length - 1);
    const isLast = i === n - 1;
    const dur = (P.d * (0.85 + r() * 0.3) + (isLast ? P.last ?? 0 : 0)) / prof.speed;
    const f0 = prof.base * (P.random ? 0.88 + r() * 0.42 : P.c[ci]) * (0.97 + r() * 0.06);
    const f1 = f0 * (ask && isLast ? 1.35 : P.glide && (n === 1 || isLast) ? P.glide : 1 + (r() - 0.5) * 0.06);
    out.push({
      t, dur, f0, f1, vowel: vowels[i % vowels.length], amp: P.amp * (isLast ? 1 : 0.85 + r() * 0.15),
      cons: r() < (P.cons ?? 0.5), vib: P.vib ?? 0,
    });
    t += dur + (0.012 + r() * 0.02) / prof.speed; // a hair of silence between blips
  }
  if (P.choo) out.push({ t: t + 0.05, dur: 0.16, f0: prof.base * 0.9, f1: prof.base * 0.7, vowel: 'u', amp: 1, cons: true, vib: 0 });
  return out;
}

/** Total length of a plan in seconds. */
export const planLength = (plan: Syllable[]): number => (plan.length ? plan[plan.length - 1].t + plan[plan.length - 1].dur : 0);

/**
 * Realise a plan on a live AudioContext.
 * Returns the end time (ac seconds).
 */
export function speak(
  ac: AudioContext, dest: AudioNode, plan: Syllable[], prof: VoiceProfile,
  o: { noise: AudioBuffer | null; when?: number; gain?: number; breathy?: boolean },
): number {
  const t0 = (o.when ?? ac.currentTime) + 0.01;
  const end = t0 + planLength(plan) + 0.08;
  const osc = ac.createOscillator();
  osc.type = prof.robot ? 'square' : 'sawtooth';
  const g = ac.createGain();
  g.gain.value = 0;
  const out = ac.createGain();
  out.gain.value = o.gain ?? 1;
  let f1n: BiquadFilterNode | null = null, f2n: BiquadFilterNode | null = null, dry: BiquadFilterNode | null = null;
  if (prof.robot) {
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200; lp.Q.value = 3;
    osc.connect(lp).connect(g);
  } else {
    // two parallel formant bands + a little dry body for warmth
    f1n = ac.createBiquadFilter(); f1n.type = 'bandpass'; f1n.Q.value = 5;
    f2n = ac.createBiquadFilter(); f2n.type = 'bandpass'; f2n.Q.value = 7;
    dry = ac.createBiquadFilter(); dry.type = 'lowpass'; dry.frequency.value = 700;
    const f2g = ac.createGain(); f2g.gain.value = 0.55 + prof.bright * 0.5;
    const dg = ac.createGain(); dg.gain.value = 0.18;
    osc.connect(f1n).connect(g);
    osc.connect(f2n).connect(f2g).connect(g);
    osc.connect(dry).connect(dg).connect(g);
  }
  g.connect(out).connect(dest);
  // consonants: one looped noise source, gated per syllable through a highpass
  const nz = ac.createBufferSource(); nz.buffer = o.noise; nz.loop = true;
  const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3200;
  const ng = ac.createGain(); ng.gain.value = 0;
  nz.connect(hp).connect(ng).connect(out);

  const breathy = !!o.breathy;
  const lvl = prof.robot ? 0.22 : 0.9;
  for (const s of plan) {
    const a = t0 + s.t, b = a + s.dur;
    osc.frequency.setValueAtTime(s.f0, a);
    if (s.vib > 0) {
      const steps = Math.max(2, Math.floor(s.dur / 0.03));
      for (let k = 1; k <= steps; k++) {
        const u = k / steps;
        osc.frequency.linearRampToValueAtTime((s.f0 + (s.f1 - s.f0) * u) * (1 + s.vib * Math.sin(u * Math.PI * 4)), a + s.dur * u);
      }
    } else osc.frequency.exponentialRampToValueAtTime(Math.max(40, s.f1), b);
    if (f1n && f2n) {
      const [F1, F2] = VOWELS[s.vowel] ?? VOWELS.a;
      f1n.frequency.setValueAtTime(F1 * prof.vowelShift, a);
      f2n.frequency.setValueAtTime(F2 * prof.vowelShift, a);
    }
    if (prof.robot) {
      // bleep-bloop: hard pitch steps, sharp gate
      g.gain.setValueAtTime(0, a);
      g.gain.linearRampToValueAtTime(s.amp * lvl, a + 0.006);
      g.gain.setValueAtTime(s.amp * lvl, b - 0.012);
      g.gain.linearRampToValueAtTime(0, b);
    } else {
      const pk = s.amp * lvl * (breathy ? 0.35 : 1);
      g.gain.setValueAtTime(0, a);
      const atk = Math.min(0.018, s.dur * 0.3), rel = Math.min(0.03, s.dur * 0.35);
      g.gain.linearRampToValueAtTime(pk, a + atk);
      g.gain.linearRampToValueAtTime(pk * 0.6, b - rel);
      g.gain.linearRampToValueAtTime(0, b);
    }
    if (s.cons || breathy) {
      const na = breathy ? s.amp * 0.5 : s.amp * 0.35;
      ng.gain.setValueAtTime(0, a);
      ng.gain.linearRampToValueAtTime(na, a + 0.004);
      ng.gain.exponentialRampToValueAtTime(0.0005, a + (breathy ? s.dur : 0.03));
      ng.gain.setValueAtTime(0, a + (breathy ? s.dur : 0.031));
    }
  }
  osc.start(t0); nz.start(t0, Math.random() * 0.5);
  osc.stop(end); nz.stop(end);
  osc.onended = () => { try { out.disconnect(); } catch { /* already gone */ } };
  return end;
}
