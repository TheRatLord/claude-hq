/**
 * The music player: picks a piece for the moment (musicPlan.ts), schedules it a bar ahead on the audio clock, then
 * rests in silence before the next one so it never drones. Going indoors / out or a storm rolling in fades the
 * current piece out within ~1 s and the next one suits the new place; a change of hour or rain lets the piece finish.
 * Ducks under notifications and voices. Output: `dest` (the music bus) plus a reverb send.
 * A gathering's live music (the campfire sing-along, the band: `isGatherScene`) cuts in within a few seconds, and is
 * placed in the world (`place`: pan + distance gain from the campfire / bandstand, set by audio.ts).
 */
import { FIRST_REST, barSeconds, isGatherScene, musicScene, planBar, planPiece } from './musicPlan.ts';
import type { MusicIn, MusicScene, Piece, Role } from './musicPlan.ts';
import { playNote } from './instruments.ts';

/** Overall music level before the music bus (calibrated against the ambient beds, see docs/VALLEY.md → Sound). */
export const MUSIC_LEVEL = 0.36;
/** Role balance inside a piece. */
export const ROLE_GAIN: Readonly<Record<Role, number>> = { lead: 1, counter: 0.5, comp: 0.5, bass: 0.75, pad: 0.4, perc: 0.3 };

export interface MusicStats { phase: 'rest' | 'play'; piece: string | null; scene: MusicScene | null; bar: number; bars: number; restLeft: number }
export interface Music {
  update(now: number, input: MusicIn, level: number): void;
  /** soften the music to `depth` (0..1 of full) for `seconds`, then recover */
  duck(seconds?: number, depth?: number): void;
  setOn(on: boolean): void;
  /** place the live music in the world: stereo pan −1..1 and a distance gain 0..1 (0 / 1 = everywhere) */
  place(pan: number, gain: number): void;
  /** the scene of the piece playing now, null while resting */
  playing(): MusicScene | null;
  /** dev: end the current piece / rest now */
  skip(): void;
  readonly on: boolean;
  stats(now: number): MusicStats;
}

export function createMusic(c: BaseAudioContext, dest: AudioNode, send: AudioNode | null = null, seed = 7): Music {
  const out = c.createGain(), fade = c.createGain(), duckG = c.createGain(), placeG = c.createGain();
  const pan = c.createStereoPanner();
  out.gain.value = 0;
  out.connect(fade).connect(duckG).connect(pan).connect(placeG).connect(dest);
  let lastPan = 0, lastPlace = 1;
  const sendG = c.createGain();
  sendG.gain.value = 0.3;
  if (send) duckG.connect(sendG).connect(send);
  let on = true, target = -1, ducked = 0;
  let phase: 'rest' | 'play' = 'rest', restUntil = -1, piece: Piece | null = null, bar = 0, nextBar = 0, count = 0;

  const fadeOut = (now: number, tc: number) => {
    fade.gain.cancelScheduledValues(now);
    fade.gain.setTargetAtTime(0, now, tc);
  };
  const start = (now: number, scene: MusicScene, input: MusicIn) => {
    piece = planPiece(scene, input, seed, count++);
    phase = 'play'; bar = 0; nextBar = now + 0.12;
    fade.gain.cancelScheduledValues(now);
    fade.gain.setTargetAtTime(1, now, 0.05);
    sendG.gain.setTargetAtTime(piece.reverb, now, 0.1);
  };

  return {
    get on() { return on; },
    setOn(v) { on = v; },
    place(p, g) {
      if (Math.abs(p - lastPan) > 0.01) { lastPan = p; pan.pan.setTargetAtTime(p, c.currentTime, 0.12); }
      if (Math.abs(g - lastPlace) > 0.01) { lastPlace = g; placeG.gain.setTargetAtTime(g, c.currentTime, 0.25); }
    },
    playing: () => (phase === 'play' && piece ? piece.scene : null),
    skip() { if (phase === 'play') { fadeOut(c.currentTime, 0.4); phase = 'rest'; } restUntil = c.currentTime + 1; },
    duck(seconds = 3, depth = 0.25) {
      const t = c.currentTime;
      if (t < ducked && depth > 0.5) return; // a deeper duck is already holding
      duckG.gain.cancelScheduledValues(t);
      duckG.gain.setTargetAtTime(depth, t, 0.08);
      duckG.gain.setTargetAtTime(1, t + seconds, 0.9);
      ducked = t + seconds;
    },
    stats(now) {
      return { phase, piece: piece?.id ?? null, scene: piece?.scene ?? null, bar, bars: piece?.bars ?? 0, restLeft: phase === 'rest' ? Math.max(0, Math.round(restUntil - now)) : 0 };
    },
    update(now, input, level) {
      const want = on ? MUSIC_LEVEL * Math.max(0, level) : 0;
      if (Math.abs(want - target) > 1e-4) { target = want; out.gain.setTargetAtTime(want, now, target === 0 ? 0.4 : 1.2); }
      if (restUntil < 0) restUntil = now + FIRST_REST;
      if (!on) {
        if (phase === 'play') { fadeOut(now, 0.4); phase = 'rest'; }
        restUntil = Math.max(restUntil, now + 2);
        return;
      }
      const scene = musicScene(input);
      if (phase === 'play' && piece) {
        // a new place (in / out), a storm, or a gathering striking up: fade this piece away now
        if (scene !== piece.scene && (scene === null || scene === 'indoors' || piece.scene === 'indoors' || isGatherScene(scene))) {
          fadeOut(now, 0.35);
          phase = 'rest';
          restUntil = now + (scene === 'indoors' || isGatherScene(scene) ? 2.5 : scene === null ? 8 : 5);
          return;
        }
        if (nextBar < now - 0.5) nextBar = now + 0.05; // the tab slept: pick up from here
        while (phase === 'play' && nextBar - now < 0.45) {
          if (bar >= piece.bars) {
            phase = 'rest';
            // the hour changed under the piece: the next one (for the new moment) comes a little sooner
            const rest = scene !== piece.scene ? Math.min(piece.restAfter, 12) : piece.restAfter;
            restUntil = nextBar + 2.5 + rest;
            break;
          }
          const b = planBar(piece, bar);
          for (const n of b.notes) playNote(c, out, nextBar + n.t, n.inst, n.midi, n.dur, n.vel * ROLE_GAIN[n.role]);
          nextBar += barSeconds(piece);
          bar++;
        }
        return;
      }
      // a gathering's music doesn't wait out a long rest (but a song just sung keeps its rest)
      if (isGatherScene(scene) && piece?.scene !== scene) restUntil = Math.min(restUntil, now + 2.5);
      if (scene && now >= restUntil) start(now, scene, input);
    },
  };
}
