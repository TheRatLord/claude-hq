/**
 * Babble synthesis: one persistent oscillator pair per line (triangle + square blend from the speaker's timbre)
 * through two formant band-passes, with per-syllable pitch glides, formant moves and gain envelopes.
 * About ten nodes per line however many syllables.
 */
import type { VoicePlan } from './voicePlan.ts';

export function renderVoice(c: BaseAudioContext, out: AudioNode, t: number, plan: VoicePlan, gain = 1): number {
  const { timbre, syllables } = plan;
  const end = t + plan.total + 0.08;
  const tri = c.createOscillator(), sq = c.createOscillator();
  tri.type = 'triangle'; sq.type = 'square';
  const triG = c.createGain(), sqG = c.createGain();
  triG.gain.value = 1 - timbre.buzz * 0.6; sqG.gain.value = timbre.buzz * 0.35;
  const mix = c.createGain();
  tri.connect(triG).connect(mix); sq.connect(sqG).connect(mix);
  const fa = c.createBiquadFilter(), fb = c.createBiquadFilter();
  fa.type = 'bandpass'; fb.type = 'bandpass'; fa.Q.value = 3.5; fb.Q.value = 5;
  const fbG = c.createGain(); fbG.gain.value = 0.7;
  const dry = c.createGain(); dry.gain.value = 0.25;
  const env = c.createGain(); env.gain.value = 0;
  mix.connect(fa).connect(env);
  mix.connect(fb).connect(fbG).connect(env);
  mix.connect(dry).connect(env);
  env.connect(out);
  const peak = 0.55 * gain;
  for (const s of syllables) {
    const st = t + s.t, e = st + s.dur;
    for (const o of [tri, sq]) {
      o.frequency.setValueAtTime(s.f0, st);
      o.frequency.exponentialRampToValueAtTime(s.f1, e);
    }
    fa.frequency.setValueAtTime(s.fa, st);
    fb.frequency.setValueAtTime(s.fb, st);
    env.gain.setValueAtTime(0, st);
    env.gain.linearRampToValueAtTime(peak * s.gain, st + 0.012);
    env.gain.setValueAtTime(peak * s.gain * 0.85, e - 0.02);
    env.gain.linearRampToValueAtTime(0, e);
  }
  tri.start(t); sq.start(t); tri.stop(end); sq.stop(end);
  tri.onended = () => { for (const n of [tri, sq, triG, sqG, mix, fa, fb, fbG, dry, env]) n.disconnect(); };
  return end;
}
