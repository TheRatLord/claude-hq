/**
 * The generative background music player: schedules `planBar` a bar ahead on the audio clock, crossfades moods at
 * bar lines, and ducks under notifications. Very quiet by default (≈ −24 dB under the ambient bed).
 */
import { barSeconds, midiHz, planBar } from './musicPlan.ts';
import type { Note } from './musicPlan.ts';
import type { MusicMood } from './mix.ts';
import { pluck, tone } from './synth.ts';

export const MUSIC_LEVEL = 0.08;

export interface Music {
  update(now: number, mood: MusicMood, level: number): void;
  duck(seconds?: number): void;
  setOn(on: boolean): void;
  readonly on: boolean;
  readonly bar: number;
}

function renderNote(c: BaseAudioContext, out: AudioNode, t: number, n: Note): void {
  const f = midiHz(n.midi);
  switch (n.voice) {
    case 'pluck': pluck(c, out, t, { f, gain: 0.3 * n.vel, d: n.dur }); break;
    case 'bell':
      tone(c, out, t, { f, gain: 0.22 * n.vel, a: 0.002, d: n.dur });
      tone(c, out, t, { f: f * 4, gain: 0.03 * n.vel, a: 0.001, d: n.dur * 0.3 });
      tone(c, out, t, { f: f * 5.9, gain: 0.015 * n.vel, a: 0.001, d: 0.08 });
      break;
    case 'pad':
      for (const det of [-7, 7]) tone(c, out, t, { type: 'triangle', f, detune: det, gain: 0.07 * n.vel, a: n.dur * 0.35, hold: n.dur * 0.3, d: n.dur * 0.45, lp: 900 });
      break;
    case 'bass': tone(c, out, t, { f, gain: 0.22 * n.vel, a: 0.02, hold: n.dur * 0.3, d: n.dur * 0.7, lp: 500 }); break;
  }
}

export function createMusic(c: BaseAudioContext, dest: AudioNode, seed = 7): Music {
  const out = c.createGain();
  out.gain.value = 0;
  const duckG = c.createGain();
  out.connect(duckG).connect(dest);
  let on = true, bar = 0, nextBar = 0, target = 0;
  return {
    get on() { return on; },
    get bar() { return bar; },
    setOn(v) { on = v; },
    duck(seconds = 3) {
      const t = c.currentTime;
      duckG.gain.cancelScheduledValues(t);
      duckG.gain.setTargetAtTime(0.2, t, 0.08);
      duckG.gain.setTargetAtTime(1, t + seconds, 0.9);
    },
    update(now, mood, level) {
      const want = on ? MUSIC_LEVEL * level : 0;
      if (Math.abs(want - target) > 1e-4) { target = want; out.gain.setTargetAtTime(want, now, 1.5); }
      if (!on) { nextBar = 0; return; }
      if (nextBar < now) nextBar = now + 0.1;
      if (nextBar - now > 0.4) return;
      const plan = planBar(bar, mood, seed);
      for (const n of plan.notes) renderNote(c, out, nextBar + n.t, n);
      nextBar += barSeconds(mood);
      bar++;
    },
  };
}
