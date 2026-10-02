/**
 * The valley's music, planned as short composed-on-the-fly pieces (pure, deterministic from seed + context).
 *
 * A *piece* is chosen for the moment (`musicScene`: morning / afternoon / evening / night / rain / indoors) and the
 * season (instrumentation), and today's festival adds its own leitmotif. Each piece has a key, a mode, a tempo and a
 * metre, and a small song form (`iAABAo`: intro, sections of 4 or 8 bars, outro). A section's melody is built from a
 * 2-bar motif that is stated, sequenced, restated and cadenced, so tunes repeat and resolve instead of wandering;
 * every pitch is diatonic to the key, strong beats sit on chord tones and weak beats on the mode's pentatonic. After a
 * piece the player rests (`restAfter`) so the valley's own sound carries the silence.
 *
 * music.ts renders `planBar` notes with the instruments in instruments.ts; tests in musicPlan.test.ts.
 */
import { hash32, mulberry32 } from '../../../../shared/identity.ts';

export type MusicScene = 'morning' | 'afternoon' | 'evening' | 'night' | 'rain' | 'indoors';
export const MUSIC_SCENES: readonly MusicScene[] = ['morning', 'afternoon', 'evening', 'night', 'rain', 'indoors'];
export type SeasonName = 'spring' | 'summer' | 'autumn' | 'winter';
export type FestivalName = 'blossom' | 'lantern' | 'founders' | 'harvest' | 'hallowtide' | 'starlight' | 'newyear';
export type WeatherName = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog' | 'snow';

export type Instrument =
  | 'kalimba' | 'marimba' | 'flute' | 'musicbox' | 'glock' | 'guitar' | 'epiano' | 'pad' | 'strings' | 'bass' | 'reed' | 'pizz' | 'horn' | 'shaker';
export const INSTRUMENTS: readonly Instrument[] = ['kalimba', 'marimba', 'flute', 'musicbox', 'glock', 'guitar', 'epiano', 'pad', 'strings', 'bass', 'reed', 'pizz', 'horn', 'shaker'];
export type Role = 'lead' | 'counter' | 'comp' | 'bass' | 'pad' | 'perc';
export interface Note { t: number; midi: number; dur: number; vel: number; inst: Instrument; role: Role }

export type Mode = 'major' | 'minor' | 'dorian' | 'mixolydian';
export const MODES: Readonly<Record<Mode, readonly number[]>> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};
/** Scale degrees (mod 7) safe on weak beats: the mode's pentatonic. */
const PENTA_DEG: Readonly<Record<Mode, readonly number[]>> = {
  major: [0, 1, 2, 4, 5], mixolydian: [0, 1, 2, 4, 5], minor: [0, 2, 3, 4, 6], dorian: [0, 2, 3, 4, 6],
};

export type CompStyle = 'arp' | 'block' | 'waltz' | 'strum' | 'oompah' | 'twinkle';
/** One melody note: `step` in eighth notes from the section start, `deg` a scale degree (0 = tonic), `len` in eighths. */
export interface MotifNote { step: number; deg: number; len: number }

export interface Piece {
  id: string;
  scene: MusicScene;
  season: SeasonName;
  festival: FestivalName | null;
  /** midi of the tonic the lead's degree 0 sits on */
  tonic: number;
  mode: Mode;
  bpm: number;
  beats: 3 | 4;
  sectionBars: 4 | 8;
  /** i = 2 intro bars, o = 2 outro bars, capitals = sections */
  form: string;
  /** chord (scale degree of its root) per bar of each section */
  prog: Record<string, number[]>;
  melody: Record<string, MotifNote[]>;
  lead: Instrument;
  counter: Instrument | null;
  comp: Instrument;
  compStyle: CompStyle;
  bass: Instrument | null;
  pad: Instrument | null;
  perc: Instrument | null;
  /** semitones the lead sits above the tonic octave (bells an octave up, kept below E6) */
  leadOct: number;
  /** comp chords carry the seventh */
  sevenths: boolean;
  /** reverb send 0..1 */
  reverb: number;
  bars: number;
  /** seconds of silence after this piece */
  restAfter: number;
}

export interface Bar { notes: Note[]; barSec: number; chord: number; section: string; inSection: number }

export interface MusicIn {
  hour: number;
  season: SeasonName;
  weather: WeatherName;
  /** 0..1 */
  intensity: number;
  indoors: boolean;
  festival: FestivalName | null;
}

/** What kind of music suits the moment; null = none (a fierce thunderstorm is music enough). */
export function musicScene(m: MusicIn): MusicScene | null {
  if (m.indoors) return 'indoors';
  // a fierce storm is music enough; an ordinary one gets the rain pieces (quieter: ambientLevels.music)
  if (m.weather === 'storm') return m.intensity > 0.85 ? null : 'rain';
  if (m.weather === 'rain' && m.intensity > 0.15) return 'rain';
  const h = ((m.hour % 24) + 24) % 24;
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 17) return 'afternoon';
  if (h >= 17 && h < 21.5) return 'evening';
  return 'night';
}

// ---------------------------------------------------------------------------------------------------------------
// Pitch helpers

export const midiHz = (m: number): number => 440 * 2 ** ((m - 69) / 12);
const mod = (a: number, n: number): number => ((a % n) + n) % n;
export const degMidi = (tonic: number, mode: Mode, deg: number): number => tonic + 12 * Math.floor(deg / 7) + MODES[mode][mod(deg, 7)];
/** Is midi note m diatonic to (tonic, mode)? */
export const inKey = (tonic: number, mode: Mode, m: number): boolean => MODES[mode].includes(mod(m - tonic, 12));
/** Chord-tone degrees (mod 7) of the chord on `root`. */
export const chordDegs = (root: number, seventh = false): number[] => (seventh ? [0, 2, 4, 6] : [0, 2, 4]).map((k) => mod(root + k, 7));

function snap(deg: number, ok: (d7: number) => boolean): number {
  for (let k = 0; k <= 3; k++) {
    if (ok(mod(deg + k, 7))) return deg + k;
    if (ok(mod(deg - k, 7))) return deg - k;
  }
  return deg;
}

// ---------------------------------------------------------------------------------------------------------------
// Festival leitmotifs: 4 bars each, [step, degree, length] in eighths (the last two are traditional tunes)

interface FestivalSpec {
  mode: Mode; beats: 3 | 4; bpm: number; tonic: number;
  lead: Instrument; comp: Instrument; compStyle: CompStyle; perc: Instrument | null; bass: Instrument; counter: Instrument | null;
  motif: readonly (readonly [number, number, number])[];
}
export const FESTIVAL_MUSIC: Readonly<Record<FestivalName, FestivalSpec>> = {
  // Blossom Fair: a skipping flute tune over kalimba
  blossom: { mode: 'major', beats: 4, bpm: 100, tonic: 67, lead: 'flute', comp: 'kalimba', compStyle: 'arp', perc: 'shaker', bass: 'bass', counter: null,
    motif: [[0, 4, 2], [2, 5, 1], [3, 4, 1], [4, 2, 2], [6, 4, 2], [8, 7, 4], [12, 5, 4], [16, 4, 2], [18, 2, 1], [19, 1, 1], [20, 0, 2], [22, 2, 2], [24, 1, 6]] },
  // Lantern Night: a slow lullaby waltz on bells
  lantern: { mode: 'major', beats: 3, bpm: 72, tonic: 65, lead: 'glock', comp: 'guitar', compStyle: 'waltz', perc: null, bass: 'bass', counter: 'strings',
    motif: [[0, 2, 2], [2, 4, 2], [4, 7, 2], [6, 6, 4], [10, 4, 2], [12, 5, 2], [14, 4, 2], [16, 2, 2], [18, 1, 6]] },
  // Founders' Day: "happy birthday", valley-style, on the music box
  founders: { mode: 'major', beats: 3, bpm: 96, tonic: 65, lead: 'musicbox', comp: 'kalimba', compStyle: 'waltz', perc: null, bass: 'bass', counter: null,
    motif: [[0, 4, 1], [1, 4, 1], [2, 5, 2], [4, 4, 2], [6, 7, 2], [8, 6, 4], [12, 4, 1], [13, 4, 1], [14, 5, 2], [16, 4, 2], [18, 8, 2], [20, 7, 4]] },
  // Harvest Festival: a barn-dance reel, oom-pah
  harvest: { mode: 'major', beats: 4, bpm: 108, tonic: 62, lead: 'reed', comp: 'guitar', compStyle: 'oompah', perc: 'shaker', bass: 'pizz', counter: null,
    motif: [[0, 0, 1], [1, 2, 1], [2, 4, 2], [4, 4, 1], [5, 5, 1], [6, 4, 2], [8, 3, 1], [9, 2, 1], [10, 1, 2], [12, 4, 4], [16, 0, 1], [17, 2, 1], [18, 4, 2], [20, 5, 1], [21, 7, 1], [22, 6, 2], [24, 4, 2], [26, 1, 2], [28, 0, 4]] },
  // Hallowtide: a tiptoeing minor tune on celesta and pizzicato
  hallowtide: { mode: 'minor', beats: 4, bpm: 92, tonic: 62, lead: 'musicbox', comp: 'pizz', compStyle: 'oompah', perc: null, bass: 'pizz', counter: null,
    motif: [[0, 0, 2], [2, 2, 2], [4, 4, 1], [5, 5, 1], [6, 4, 2], [8, 6, 1], [9, 5, 1], [10, 4, 2], [12, 1, 4], [16, 0, 2], [18, 2, 2], [20, 4, 1], [21, 5, 1], [22, 6, 2], [24, 7, 2], [26, 6, 1], [27, 5, 1], [28, 4, 4]] },
  // Starlight: jingle bells on the glockenspiel with sleigh bells
  starlight: { mode: 'major', beats: 4, bpm: 104, tonic: 67, lead: 'glock', comp: 'epiano', compStyle: 'block', perc: 'shaker', bass: 'bass', counter: null,
    motif: [[0, 2, 2], [2, 2, 2], [4, 2, 4], [8, 2, 2], [10, 2, 2], [12, 2, 4], [16, 2, 2], [18, 4, 2], [20, 0, 3], [23, 1, 1], [24, 2, 8]] },
  // New Year: auld lang syne on a soft horn
  newyear: { mode: 'major', beats: 4, bpm: 80, tonic: 65, lead: 'horn', comp: 'epiano', compStyle: 'block', perc: null, bass: 'bass', counter: 'strings',
    motif: [[0, -3, 2], [2, 0, 3], [5, 0, 1], [6, 0, 2], [8, 2, 2], [10, 1, 3], [13, 0, 1], [14, 1, 2], [16, 2, 2], [18, 0, 3], [21, 0, 1], [22, 2, 2], [24, 4, 2], [26, 5, 6]] },
};

// ---------------------------------------------------------------------------------------------------------------
// Scene templates and seasonal instrumentation

interface SceneSpec {
  bpm: [number, number];
  beats: (r: () => number) => 3 | 4;
  modes: Mode[];
  tonics: number[];
  sectionBars: 4 | 8;
  forms: string[];
  density: number;
  compStyle: (beats: 3 | 4) => CompStyle;
  bass: boolean;
  pad: boolean;
  perc: boolean;
  sevenths: boolean;
  reverb: number;
  rest: [number, number];
}
const SCENES: Readonly<Record<MusicScene, SceneSpec>> = {
  morning: { bpm: [84, 96], beats: () => 4, modes: ['major', 'major', 'mixolydian'], tonics: [65, 67, 62], sectionBars: 8, forms: ['iAABAo', 'iABAo'], density: 0.5,
    compStyle: () => 'arp', bass: true, pad: true, perc: false, sevenths: false, reverb: 0.3, rest: [20, 45] },
  afternoon: { bpm: [96, 108], beats: () => 4, modes: ['major', 'mixolydian'], tonics: [60, 67, 69], sectionBars: 8, forms: ['iAABAo', 'iABABo', 'iABAo'], density: 0.6,
    compStyle: () => 'strum', bass: true, pad: false, perc: true, sevenths: false, reverb: 0.25, rest: [20, 45] },
  evening: { bpm: [70, 82], beats: (r) => (r() < 0.6 ? 3 : 4), modes: ['major', 'dorian', 'major'], tonics: [65, 63, 70], sectionBars: 8, forms: ['iAABAo', 'iABAo'], density: 0.45,
    compStyle: (b) => (b === 3 ? 'waltz' : 'block'), bass: true, pad: true, perc: false, sevenths: true, reverb: 0.35, rest: [25, 55] },
  night: { bpm: [56, 66], beats: (r) => (r() < 0.35 ? 3 : 4), modes: ['minor', 'dorian', 'major'], tonics: [62, 69, 64], sectionBars: 4, forms: ['iAABAo', 'iABAo'], density: 0.3,
    compStyle: () => 'twinkle', bass: true, pad: true, perc: false, sevenths: false, reverb: 0.45, rest: [35, 75] },
  rain: { bpm: [62, 72], beats: () => 4, modes: ['dorian', 'major', 'minor'], tonics: [62, 65, 67], sectionBars: 4, forms: ['iAABAo', 'iABABo'], density: 0.32,
    compStyle: () => 'block', bass: true, pad: true, perc: false, sevenths: true, reverb: 0.4, rest: [30, 60] },
  indoors: { bpm: [68, 80], beats: (r) => (r() < 0.7 ? 3 : 4), modes: ['major', 'major', 'dorian'], tonics: [65, 67, 60], sectionBars: 8, forms: ['iAABAo', 'iABAo'], density: 0.42,
    compStyle: (b) => (b === 3 ? 'waltz' : 'arp'), bass: true, pad: true, perc: false, sevenths: true, reverb: 0.12, rest: [14, 32] },
};
type Kit = { lead: Instrument; comp: Instrument; counter: Instrument | null };
const KITS: Readonly<Record<SeasonName, Readonly<Record<MusicScene, Kit>>>> = {
  spring: {
    morning: { lead: 'flute', comp: 'kalimba', counter: null },
    afternoon: { lead: 'kalimba', comp: 'guitar', counter: 'flute' },
    evening: { lead: 'flute', comp: 'guitar', counter: 'strings' },
    night: { lead: 'musicbox', comp: 'kalimba', counter: null },
    rain: { lead: 'musicbox', comp: 'epiano', counter: 'strings' },
    indoors: { lead: 'musicbox', comp: 'guitar', counter: null },
  },
  summer: {
    morning: { lead: 'marimba', comp: 'kalimba', counter: null },
    afternoon: { lead: 'marimba', comp: 'guitar', counter: 'flute' },
    evening: { lead: 'guitar', comp: 'epiano', counter: 'strings' },
    night: { lead: 'glock', comp: 'kalimba', counter: null },
    rain: { lead: 'kalimba', comp: 'epiano', counter: 'strings' },
    indoors: { lead: 'kalimba', comp: 'guitar', counter: null },
  },
  autumn: {
    morning: { lead: 'reed', comp: 'guitar', counter: null },
    afternoon: { lead: 'guitar', comp: 'guitar', counter: 'reed' },
    evening: { lead: 'strings', comp: 'guitar', counter: 'reed' },
    night: { lead: 'musicbox', comp: 'guitar', counter: null },
    rain: { lead: 'guitar', comp: 'epiano', counter: 'strings' },
    indoors: { lead: 'reed', comp: 'guitar', counter: null },
  },
  winter: {
    morning: { lead: 'glock', comp: 'epiano', counter: null },
    afternoon: { lead: 'musicbox', comp: 'epiano', counter: 'strings' },
    evening: { lead: 'epiano', comp: 'epiano', counter: 'strings' },
    night: { lead: 'musicbox', comp: 'epiano', counter: null },
    rain: { lead: 'musicbox', comp: 'epiano', counter: 'strings' },
    indoors: { lead: 'musicbox', comp: 'epiano', counter: null },
  },
};
/** Night-friendly festivals also get a piece after dark. */
const NIGHT_FESTIVALS: readonly FestivalName[] = ['lantern', 'newyear', 'starlight', 'hallowtide'];

// ---------------------------------------------------------------------------------------------------------------
// Harmony and melody generation

const PROGS: Readonly<Record<'major' | 'minor', { a: number[][]; b: number[][] }>> = {
  major: {
    a: [[0, 3, 4, 0], [0, 5, 3, 4], [0, 4, 5, 3], [0, 1, 4, 0], [0, 3, 0, 4], [0, 5, 1, 4]],
    b: [[3, 4, 2, 5], [5, 3, 0, 4], [3, 0, 3, 4], [1, 4, 0, 5]],
  },
  minor: {
    a: [[0, 5, 2, 6], [0, 3, 6, 2], [0, 5, 3, 4], [0, 6, 5, 6], [0, 3, 0, 6]],
    b: [[5, 6, 2, 0], [3, 6, 2, 5], [5, 3, 6, 4], [2, 6, 3, 6]],
  },
};
const family = (m: Mode): 'major' | 'minor' => (m === 'major' || m === 'mixolydian' ? 'major' : 'minor');
/** the cadence chord that leads home: V in major, VII (or v) in minor */
const dominant = (m: Mode): number => (family(m) === 'major' ? 4 : 6);

/** A section's chords in 4-bar phrases: an A section ends home on the tonic (8 bars: a half cadence mid-way), a B
 * section hangs on the dominant so it leads back into A. */
function progression(r: () => number, mode: Mode, bars: 4 | 8, kind: 'a' | 'b'): number[] {
  const pool = PROGS[family(mode)][kind];
  const phrase = () => [...pool[Math.floor(r() * pool.length)]];
  const dom = dominant(mode);
  if (kind === 'b') {
    const out = bars === 8 ? [...phrase(), ...phrase()] : phrase();
    out[out.length - 1] = dom;
    return out;
  }
  const p1 = phrase();
  p1[0] = 0;
  if (bars === 4) { p1[2] = dom; p1[3] = 0; return p1; }
  const p2 = phrase();
  p1[3] = dom;
  p2[0] = 0; p2[2] = dom; p2[3] = 0;
  return [...p1, ...p2];
}

/** A 2-bar rhythm (onsets + lengths in eighths). Ends on a held note or a breath. */
function motifRhythm(r: () => number, beats: 3 | 4, density: number): { step: number; len: number }[] {
  const out: { step: number; len: number }[] = [];
  const nBeats = beats * 2;
  for (let b = 0; b < nBeats; b++) {
    const s = b * 2;
    const lastBeat = b === nBeats - 1;
    if (lastBeat) break; // breathe at the end of the motif (the previous note may ring into it)
    const x = r();
    if (b === 0 || x < 0.22 + density * 0.9) {
      const y = r();
      if (y < 0.3 * density + 0.1 && b < nBeats - 2) { out.push({ step: s, len: 1 }, { step: s + 1, len: 1 }); }
      else if (y > 0.82 && b < nBeats - 2) { out.push({ step: s, len: 3 }, { step: s + 3, len: 1 }); b++; }
      else if (y > 0.68 && b < nBeats - 2) { out.push({ step: s, len: 4 }); b++; }
      else out.push({ step: s, len: 2 });
    }
  }
  // the motif's last note holds into the breath
  const last = out[out.length - 1];
  last.len = nBeats * 2 - last.step - 1;
  return out;
}

/** Contour: small steps, an occasional leap answered by a step back. */
function contour(r: () => number, n: number, start: number, lo: number, hi: number): number[] {
  const out: number[] = [];
  let d = start, leapDir = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      let mv: number;
      if (leapDir) { mv = -leapDir; leapDir = 0; } else if (r() < 0.14) { mv = (r() < 0.5 ? -1 : 1) * (3 + Math.floor(r() * 2)); leapDir = Math.sign(mv); } else mv = [-2, -1, -1, 0, 1, 1, 2][Math.floor(r() * 7)];
      d += mv;
      if (d < lo) d = lo + (lo - d); else if (d > hi) d = hi - (d - hi);
      d = Math.max(lo, Math.min(hi, d));
    }
    out.push(d);
  }
  return out;
}

/** Fit raw degrees to the harmony: strong beats and long notes on chord tones, the rest on the pentatonic. */
function harmonize(notes: MotifNote[], prog: number[], beats: 3 | 4, mode: Mode, lo: number, hi: number): MotifNote[] {
  const spb = beats * 2, strongEvery = beats === 4 ? 4 : 6;
  return notes.map((n) => {
    const chord = prog[Math.min(prog.length - 1, Math.floor(n.step / spb))];
    const cd = chordDegs(chord);
    const strong = n.step % strongEvery === 0 || n.len >= 3;
    const ok = strong ? (d7: number) => cd.includes(d7) : (d7: number) => cd.includes(d7) || PENTA_DEG[mode].includes(d7);
    let deg = snap(n.deg, ok);
    if (deg < lo) deg = snap(deg + 7, ok); else if (deg > hi) deg = snap(deg - 7, ok);
    return { step: n.step, deg, len: n.len };
  });
}

/** A section melody: motif, its sequence, the motif again, a cadential tail (4-bar sections: motif + tail). */
function sectionMelody(r: () => number, prog: number[], beats: 3 | 4, bars: 4 | 8, mode: Mode, density: number, kind: 'a' | 'b'): MotifNote[] {
  const spb = beats * 2;
  const lo = -2, hi = 10;
  const rhythm = motifRhythm(r, beats, density);
  const start = kind === 'a' ? [2, 4, 4, 7][Math.floor(r() * 4)] : [5, 6, 7][Math.floor(r() * 3)];
  const motif = contour(r, rhythm.length, start, lo + 1, hi - 1).map((deg, i) => ({ step: rhythm[i].step, deg, len: rhythm[i].len }));
  const tailRhythm = motifRhythm(r, beats, density * 0.8);
  // the tail walks down toward home (A) or hangs on the dominant (B)
  const tailEnd = kind === 'a' ? (r() < 0.5 ? 0 : 7) : 4;
  const tailStart = motif[motif.length - 1].deg;
  const tail = tailRhythm.map((x, i) => ({ step: x.step, len: x.len, deg: Math.round(tailStart + ((tailEnd - tailStart) * (i + 1)) / tailRhythm.length + (i < tailRhythm.length - 1 ? (r() - 0.5) * 2 : 0)) }));
  const shift = [1, -1, 2][Math.floor(r() * 3)];
  const at = (ns: MotifNote[], bar: number, dd = 0) => ns.map((n) => ({ step: n.step + bar * spb, deg: n.deg + dd, len: n.len }));
  const raw = bars === 8
    ? [...at(motif, 0), ...at(motif, 2, shift), ...at(motif, 4), ...at(tail, 6)]
    : [...at(motif, 0), ...at(tail, 2)];
  return harmonize(raw, prog, beats, mode, lo, hi);
}

/** Pick the chord per bar that holds the most of a fixed tune's strong / long notes (festival leitmotifs). */
export function harmonizeTune(tune: readonly MotifNote[], bars: number, beats: 3 | 4, mode: Mode): number[] {
  const spb = beats * 2, strongEvery = beats === 4 ? 4 : 6;
  const cands = family(mode) === 'major' ? [0, 4, 3, 5, 1] : [0, 6, 3, 5, 4];
  const out: number[] = [];
  for (let b = 0; b < bars; b++) {
    let best = cands[0], bestS = -Infinity;
    for (const c of cands) {
      const cd = chordDegs(c);
      // open on the tonic; on a tie, move rather than sit on one chord
      let s = b === 0 && c === 0 ? 0.5 : b > 0 && c === out[b - 1] ? -0.3 : 0;
      for (const n of tune) {
        if (n.step < b * spb || n.step >= (b + 1) * spb) continue;
        const w = n.len * (n.step % strongEvery === 0 ? 3 : 1);
        if (cd.includes(mod(n.deg, 7))) s += w;
      }
      if (s > bestS) { best = c; bestS = s; }
    }
    out.push(best);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Pieces

/** Register offsets (semitones) per instrument relative to the piece's tonic octave. */
const LEAD_OCT: Partial<Record<Instrument, number>> = { musicbox: 12, glock: 12 };
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const sectionLen = (p: Pick<Piece, 'sectionBars'>, ch: string): number => (ch === 'i' || ch === 'o' ? 2 : p.sectionBars);
export const barSeconds = (p: Pick<Piece, 'bpm' | 'beats'>): number => (60 / p.bpm) * p.beats;

/** Should the n-th piece of a festival day be the festival's own? (every other one, outdoors, not in the rain) */
export function festivalTurn(scene: MusicScene, festival: FestivalName | null, n: number): boolean {
  if (!festival || scene === 'indoors' || scene === 'rain') return false;
  if (scene === 'night' && !NIGHT_FESTIVALS.includes(festival)) return false;
  return n % 2 === 0;
}

/** Plan the n-th piece for a scene; deterministic in (scene, season, festival, seed, n). */
export function planPiece(scene: MusicScene, m: Pick<MusicIn, 'season' | 'festival'>, seed = 1, n = 0): Piece {
  const r = mulberry32(hash32(`piece:${seed}:${scene}:${m.season}:${m.festival ?? '-'}:${n}`));
  const S = SCENES[scene];
  const kit = KITS[m.season][scene];
  const fest = festivalTurn(scene, m.festival, n) ? m.festival : null;
  const F = fest ? FESTIVAL_MUSIC[fest] : null;
  const mode: Mode = F ? F.mode : pick(r, S.modes);
  const beats: 3 | 4 = F ? F.beats : S.beats(r);
  const bpm = F ? F.bpm : Math.round(S.bpm[0] + r() * (S.bpm[1] - S.bpm[0]));
  const sectionBars: 4 | 8 = F ? 8 : S.sectionBars;
  let tonic = F ? F.tonic : pick(r, S.tonics);
  // minor keys sit on the relative minor's tonic range
  if (!F && family(mode) === 'minor' && tonic > 66) tonic -= 12;
  const form = F ? 'iAABAo' : pick(r, S.forms);
  const prog: Record<string, number[]> = {};
  const melody: Record<string, MotifNote[]> = {};
  const density = S.density * (0.9 + r() * 0.2);
  for (const ch of new Set(form.replace(/[io]/g, ''))) {
    const kind = ch === 'A' ? 'a' : 'b';
    if (F && ch === 'A') {
      const tune = F.motif.map(([step, deg, len]) => ({ step, deg, len }));
      const spb = beats * 2;
      // the tune twice; the second time it comes home to the tonic
      const twice = [...tune, ...tune.map((x) => ({ ...x, step: x.step + 4 * spb }))];
      const last = twice[twice.length - 1];
      last.deg = Math.round(last.deg / 7) * 7;
      last.len = Math.max(last.len, 8 * spb - last.step - 1);
      const p = harmonizeTune(twice, 8, beats, mode);
      p[7] = 0;
      prog[ch] = p;
      melody[ch] = twice;
    } else {
      prog[ch] = progression(r, mode, sectionBars, kind);
      melody[ch] = sectionMelody(r, prog[ch], beats, sectionBars, mode, density, kind);
    }
  }
  const compStyle = F ? F.compStyle : S.compStyle(beats);
  const lead = F ? F.lead : kit.lead;
  let leadOct = LEAD_OCT[lead] ?? 0;
  const top = Math.max(...Object.values(melody).flat().map((x) => degMidi(tonic, mode, x.deg)));
  while (leadOct > 0 && top + leadOct > 88) leadOct -= 12;
  const bars = [...form].reduce((s, ch) => s + sectionLen({ sectionBars }, ch), 0);
  const rest = S.rest[0] + r() * (S.rest[1] - S.rest[0]);
  return {
    id: `${scene}:${m.season}${fest ? `:${fest}` : ''}:${n}`,
    scene, season: m.season, festival: fest, tonic, mode, bpm, beats, sectionBars, form, prog, melody,
    lead,
    leadOct,
    counter: F ? F.counter : kit.counter,
    comp: F ? F.comp : kit.comp,
    compStyle,
    bass: S.bass ? (F ? F.bass : 'bass') : null,
    pad: S.pad || (F !== null && F.compStyle === 'waltz') ? (scene === 'rain' || scene === 'evening' ? 'strings' : 'pad') : null,
    perc: F ? F.perc : S.perc && (m.season === 'summer' || m.season === 'spring') ? 'shaker' : null,
    sevenths: S.sevenths && !F,
    reverb: S.reverb,
    bars,
    restAfter: Math.round(rest),
  };
}

/** Where bar `bar` falls in the form. */
export function sectionAt(p: Piece, bar: number): { ch: string; inSection: number; pass: number; last: boolean } | null {
  let b = bar;
  const seen: Record<string, number> = {};
  for (let i = 0; i < p.form.length; i++) {
    const ch = p.form[i];
    const len = sectionLen(p, ch);
    if (b < len) {
      const after = p.form.slice(i + 1).replace(/o/g, '');
      return { ch, inSection: b, pass: seen[ch] ?? 0, last: ch !== 'i' && ch !== 'o' && after.length === 0 };
    }
    b -= len;
    seen[ch] = (seen[ch] ?? 0) + 1;
  }
  return null;
}

const humanize = (r: () => number) => (r() - 0.5) * 0.014;

/** The notes of one bar (times in seconds from the bar start). Deterministic per (piece, bar). */
export function planBar(p: Piece, bar: number): Bar {
  const barSec = barSeconds(p);
  const beat = 60 / p.bpm, eighth = beat / 2;
  const spb = p.beats * 2;
  const sec = sectionAt(p, bar);
  const notes: Note[] = [];
  if (!sec) return { notes, barSec, chord: 0, section: '', inSection: 0 };
  const r = mulberry32(hash32(`bar:${p.id}:${bar}`));
  const { ch, inSection, pass, last } = sec;
  const chord = ch === 'i' ? (inSection === 0 ? 0 : dominant(p.mode)) : ch === 'o' ? (inSection === 0 ? 3 : 0) : p.prog[ch][inSection];
  const midiOf = (deg: number, base: number) => degMidi(p.tonic + base, p.mode, deg);
  const push = (t: number, midi: number, dur: number, vel: number, inst: Instrument, role: Role) =>
    notes.push({ t: Math.max(0, t), midi, dur, vel: Math.max(0.05, Math.min(1, vel)), inst, role });
  const outroEnd = ch === 'o' && inSection === 1;
  const section = ch === 'B' ? 1.08 : 1;

  // ---- lead
  if (ch !== 'i' && ch !== 'o') {
    const mel = p.melody[ch];
    const lo = inSection * spb, hi = lo + spb;
    const finalIdx = last ? mel.length - 1 : -1;
    const loct = p.leadOct;
    for (let i = 0; i < mel.length; i++) {
      const n = mel[i];
      if (n.step < lo || n.step >= hi) continue;
      let deg = n.deg, len = n.len;
      if (i === finalIdx) { deg = Math.round(deg / 7) * 7; len = Math.max(len, hi - n.step + spb); }
      const strong = n.step % (p.beats === 4 ? 4 : 6) === 0;
      push((n.step - lo) * eighth + humanize(r), midiOf(deg, loct), len * eighth, (strong ? 0.82 : 0.68) * section + r() * 0.1, p.lead, 'lead');
    }
  } else if (outroEnd) {
    push(0, midiOf(0, p.leadOct), barSec * 1.5, 0.7, p.lead, 'lead');
  }

  // ---- counter line: the second pass of A and every B, held chord tones under the lead
  if (p.counter && (ch === 'B' || (ch === 'A' && pass >= 1))) {
    const cd = chordDegs(chord);
    const deg = cd[1 + (inSection % 2)] - 7;
    const every = p.beats === 4 ? 2 : 3;
    for (let b = 0; b < p.beats; b += every) push(b * beat + humanize(r), midiOf(deg, 0), every * beat * 0.95, 0.45, p.counter, 'counter');
  }

  // ---- comp
  const tones = (base: number) => {
    const cd = [0, 2, 4, ...(p.sevenths ? [6] : [])].map((k) => midiOf(chord + k, base));
    // keep chords in a comfortable middle register
    return cd.map((m) => (m > p.tonic + base + 9 ? m - 12 : m)).sort((a, b) => a - b);
  };
  const ct = tones(-12);
  const compVel = 0.5 * (ch === 'i' || ch === 'o' ? 0.85 : 1) * section;
  if (outroEnd) {
    ct.forEach((m, i) => push(i * 0.03, m, barSec * 1.4, compVel, p.comp, 'comp'));
  } else switch (p.compStyle) {
    case 'arp': {
      const pat = p.beats === 4 ? [0, 2, 1, 2, 3, 2, 1, 2] : [0, 1, 2, 3, 2, 1];
      const up = [...ct.slice(0, 3), ct[0] + 12];
      pat.forEach((k, i) => push(i * eighth + humanize(r), up[k], eighth * 1.8, compVel * (i % 2 ? 0.75 : 0.95), p.comp, 'comp'));
      break;
    }
    case 'block': {
      const hits = p.beats === 4 ? [0, 2] : [0];
      // a four-note chord plays each note softer so the block lands at the same level as a triad
      const k = 3 / ct.length;
      for (const b of hits) ct.forEach((m, i) => push(b * beat + i * 0.012 + humanize(r) * 0.5, m, beat * (p.beats === 4 ? 1.9 : 2.8), compVel * k * (b ? 0.8 : 1), p.comp, 'comp'));
      break;
    }
    case 'waltz': {
      for (const b of p.beats === 3 ? [1, 2] : [1, 3]) ct.forEach((m) => push(b * beat + humanize(r), m, beat * 0.85, compVel * 0.8, p.comp, 'comp'));
      break;
    }
    case 'strum': {
      const hits = p.beats === 4 ? [[0, 1], [3, 0.7], [4, 0.85], [6, 0.7]] : [[0, 1], [2, 0.7], [4, 0.7]];
      for (const [s, v] of hits) ct.forEach((m, i) => push(s * eighth + i * 0.016 + humanize(r) * 0.5, m, eighth * 2.2, compVel * v, p.comp, 'comp'));
      break;
    }
    case 'oompah': {
      for (const b of p.beats === 4 ? [1, 3] : [1, 2]) ct.forEach((m) => push(b * beat + humanize(r), m, beat * 0.6, compVel * 0.85, p.comp, 'comp'));
      break;
    }
    case 'twinkle': {
      const up = tones(0);
      const n = p.beats === 4 ? 4 : 3;
      for (let i = 0; i < n; i++) if (i === 0 || r() < 0.75) push(i * beat + humanize(r), up[i % up.length] + (i >= up.length ? 12 : 0), beat * 2.5, compVel * 0.75, p.comp, 'comp');
      break;
    }
  }

  // ---- bass
  if (p.bass) {
    // bass lives in E1..E3: wrap anything above E3 down an octave
    const low = (m: number) => (m > 52 ? m - 12 : m);
    const lowRoot = low(degMidi(p.tonic - 24, p.mode, mod(chord, 7)));
    const lowFifth = low(degMidi(p.tonic - 24, p.mode, mod(chord, 7) + 4));
    const bv = 0.62;
    if (outroEnd) push(0, lowRoot, barSec * 1.3, bv, p.bass, 'bass');
    else if (p.scene === 'night' && !p.festival) { if (bar % 2 === 0 || ch === 'i') push(0, lowRoot, barSec * 1.6, bv * 0.8, p.bass, 'bass'); }
    else if (p.compStyle === 'oompah') { push(0, inSection % 2 && p.beats === 3 ? lowFifth : lowRoot, beat * 0.8, bv, p.bass, 'bass'); if (p.beats === 4) push(2 * beat, lowFifth, beat * 0.8, bv * 0.8, p.bass, 'bass'); }
    else if (p.beats === 3) push(0, inSection % 2 ? lowFifth : lowRoot, beat * 1.6, bv, p.bass, 'bass');
    else {
      push(0, lowRoot, beat * 1.8, bv, p.bass, 'bass');
      if (p.scene === 'afternoon' || p.festival) push(2 * beat, r() < 0.5 ? lowFifth : lowRoot, beat * 1.6, bv * 0.8, p.bass, 'bass');
    }
  }

  // ---- pad: the chord, the whole bar
  if (p.pad) for (const m of tones(-12)) push(0, m, barSec * (outroEnd ? 1.6 : 1.04), 0.4, p.pad, 'pad');

  // ---- light percussion: off-beat shaker in the sections
  if (p.perc && ch !== 'i' && ch !== 'o') for (let s = 1; s < spb; s += 2) push(s * eighth + humanize(r) * 0.5, 0, eighth * 0.5, s % 4 === 3 ? 0.5 : 0.32, p.perc, 'perc');

  return { notes, barSec, chord, section: ch, inSection };
}

/** Seconds of quiet before the first piece after the valley wakes the audio. */
export const FIRST_REST = 6;
