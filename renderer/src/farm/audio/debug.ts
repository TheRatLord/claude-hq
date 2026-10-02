/**
 * Offline measurement for the sound (dev only, reached through `__valley.ctx.services.get('audio')._debug`): render any
 * sound, instrument, footstep, loop or piece into an OfflineAudioContext, mix a whole moment of the valley through the
 * real master chain, and measure it (peak, RMS, momentary loudness, spectral centroid, high-frequency share), or hand
 * the samples back as 16-bit PCM for a WAV. Nothing here runs in normal play.
 */
import type { SfxName } from '../scene/context.ts';
import { buildMaster } from './engine.ts';
import { ambientLevels, busGains, emptyLevels } from './mix.ts';
import type { AmbientIn } from './mix.ts';
import { CRITTER_RECIPES, PUDDLE, SFX_RECIPES, STEP_GAIN, STEP_RECIPES } from './sfx.ts';
import { renderVoice } from './voice.ts';
import { planVoice } from './voicePlan.ts';
import type { VoiceMood } from './voicePlan.ts';
import { buildLoop } from './loops.ts';
import type { LoopKind } from './loops.ts';
import { BED_SCALE } from './ambience.ts';
import { barSeconds, planBar, planPiece } from './musicPlan.ts';
import type { FestivalName, Instrument, MusicScene, SeasonName } from './musicPlan.ts';
import { playNote } from './instruments.ts';
import { MUSIC_LEVEL, ROLE_GAIN } from './music.ts';
import type { CritterSound } from './types.ts';
import type { StepSurface } from './steps.ts';

export interface Measure {
  peak: number;
  /** RMS over the whole render */
  rms: number;
  /** loudest 50 ms window RMS (≈ momentary loudness) */
  loud: number;
  /** RMS over the windows above −50 dBFS (how loud it is while it sounds) */
  active: number;
  /** seconds until the last sample above −54 dBFS */
  len: number;
  /** energy-weighted spectral centroid (Hz) */
  centroid: number;
  /** share of energy above 6 kHz (harshness) */
  hf: number;
  /** fraction of 50 ms windows that are silent (< −60 dBFS) */
  silent: number;
  nan: boolean;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const db = (x: number) => Math.round(20 * Math.log10(Math.max(1e-6, x)) * 10) / 10;

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar; im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar; im[i + k] += ai;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

export function measure(buf: AudioBuffer): Measure {
  const sr = buf.sampleRate, n = buf.length, chs = buf.numberOfChannels;
  const mono = new Float32Array(n);
  let peak = 0, sum = 0, nan = false, last = 0;
  for (let ch = 0; ch < chs; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) {
      const v = d[i];
      if (!Number.isFinite(v)) { nan = true; continue; }
      const av = Math.abs(v);
      if (av > peak) peak = av;
      if (av > 0.002 && i > last) last = i;
      sum += v * v;
      mono[i] += v / chs;
    }
  }
  const win = Math.floor(sr * 0.05);
  let loud = 0, actSum = 0, actN = 0, silentN = 0, wins = 0;
  for (let i = 0; i + win <= n; i += win) {
    let s = 0;
    for (let ch = 0; ch < chs; ch++) { const d = buf.getChannelData(ch); for (let k = i; k < i + win; k++) s += d[k] * d[k]; }
    const w = Math.sqrt(s / (win * chs));
    wins++;
    if (w > loud) loud = w;
    if (w > 0.00316) { actSum += s; actN += win * chs; }
    if (w < 0.001) silentN++;
  }
  // spectrum: average power over 2048-sample frames
  const N = 2048, re = new Float64Array(N), im = new Float64Array(N), pow = new Float64Array(N / 2);
  for (let i = 0; i + N <= n; i += N * 2) {
    for (let k = 0; k < N; k++) { re[k] = mono[i + k] * (0.5 - 0.5 * Math.cos((2 * Math.PI * k) / N)); im[k] = 0; }
    fft(re, im);
    for (let k = 0; k < N / 2; k++) pow[k] += re[k] * re[k] + im[k] * im[k];
  }
  let ps = 0, pc = 0, hi = 0;
  for (let k = 1; k < N / 2; k++) { const f = (k * sr) / N; ps += pow[k]; pc += pow[k] * f; if (f > 6000) hi += pow[k]; }
  return {
    peak: r3(peak), rms: r3(Math.sqrt(sum / (n * chs))), loud: r3(loud), active: r3(actN ? Math.sqrt(actSum / actN) : 0), len: r3(last / sr),
    centroid: Math.round(ps ? pc / ps : 0), hf: r3(ps ? hi / ps : 0), silent: r3(wins ? silentN / wins : 0), nan,
  };
}
/** dBFS view of a measure, for reading at a glance. */
export const inDb = (m: Measure) => ({ peak: db(m.peak), rms: db(m.rms), loud: db(m.loud), active: db(m.active), len: m.len, centroid: m.centroid, hf: m.hf, silent: m.silent, nan: m.nan });

/**
 * Render one named thing into `dest` from t = 0.01:
 *   'alert'  'critter:chirp'  'voice:seed:mood:n'  'loop:river:0.8'  'loop:leaves:1:autumn'  'step:stone'  'step:dirt:wet'
 *   'inst:flute:67'  'piece:morning:spring[:festival][:n]'
 */
export function renderInto(c: BaseAudioContext, dest: AudioNode, name: string, seconds: number, rnd: () => number = Math.random): void {
  const [head, a, b, cc, dd] = name.split(':');
  if (head === 'critter') CRITTER_RECIPES[a as CritterSound](c, dest, 0.01, { pitch: 1, rnd });
  else if (head === 'voice') renderVoice(c, dest, 0.01, planVoice(a, (b ?? 'happy') as VoiceMood, Number(cc) || undefined));
  else if (head === 'step') {
    const g = c.createGain(); g.gain.value = STEP_GAIN[a as StepSurface]; g.connect(dest);
    STEP_RECIPES[a as StepSurface](c, g, 0.01, { pitch: 1, rnd });
    if (b === 'wet') PUDDLE(c, dest, 0.01, { pitch: 1, rnd });
  } else if (head === 'inst') playNote(c, dest, 0.01, a as Instrument, Number(b ?? 67), Number(cc ?? 0.6), 1);
  else if (head === 'loop') {
    const lv = Number(b ?? 1);
    const v = buildLoop(a as LoopKind, c, { cpu: () => 0.6, tempC: () => 55, send: null, season: () => cc ?? 'summer' });
    v.out.gain.value = lv;
    v.out.connect(dest);
    for (let t = 0; t < seconds; t += 0.25) v.tick(t, 0.3, lv);
  } else if (head === 'piece') {
    const fest = cc && Number.isNaN(Number(cc)) ? (cc as FestivalName) : null;
    const n = Number(fest ? dd : cc) || 0;
    renderPiece(c, dest, a as MusicScene, (b ?? 'summer') as SeasonName, fest, n, seconds, 1);
  } else SFX_RECIPES[name as SfxName](c, dest, 0.01, { pitch: 1, rnd });
}

/** Schedule a whole piece (from t = 0.05) at the live role balance; `level` multiplies MUSIC_LEVEL. Returns its length. */
export function renderPiece(c: BaseAudioContext, dest: AudioNode, scene: MusicScene, season: SeasonName, festival: FestivalName | null, n: number, seconds: number, level: number): number {
  const p = planPiece(scene, { season, festival }, 7, n);
  const g = c.createGain();
  g.gain.value = MUSIC_LEVEL * level;
  g.connect(dest);
  let t = 0.05;
  for (let bar = 0; bar < p.bars && t < seconds; bar++) {
    for (const x of planBar(p, bar).notes) playNote(c, g, t + x.t, x.inst, x.midi, x.dur, x.vel * ROLE_GAIN[x.role]);
    t += barSeconds(p);
  }
  return t;
}

export async function renderMeasure(name: string, seconds = 3): Promise<Measure> {
  const oc = new OfflineAudioContext(2, Math.ceil(44100 * seconds), 44100);
  renderInto(oc, oc.destination, name, seconds);
  return measure(await oc.startRendering());
}

/** Base64 16-bit little-endian interleaved PCM of a render (write a WAV header around it). */
export async function renderPcm(name: string, seconds = 3, sr = 44100): Promise<{ sr: number; channels: number; pcm: string; m: Measure }> {
  const oc = new OfflineAudioContext(2, Math.ceil(sr * seconds), sr);
  if (name.startsWith('mix:')) await mixInto(oc, name.slice(4), seconds); else renderInto(oc, oc.destination, name, seconds);
  const buf = await oc.startRendering();
  return { sr, channels: 2, pcm: toPcm(buf), m: measure(buf) };
}

function toPcm(buf: AudioBuffer): string {
  const n = buf.length, L = buf.getChannelData(0), R = buf.getChannelData(1);
  const out = new Uint8Array(n * 4);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < n; i++) {
    dv.setInt16(i * 4, Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), true);
    dv.setInt16(i * 4 + 2, Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), true);
  }
  let s = '';
  for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---------------------------------------------------------------------------------------------------------------
// Mixdowns: a moment of the valley at the default slider settings, through the real master chain

export interface MixSpec {
  hour: number; season: SeasonName; weather: AmbientIn['weather']; intensity: number; wind: number;
  /** distances to the landmarks (m) */
  dRiver?: number; dPond?: number; dWaterfall?: number; dFire?: number; dWindmill?: number; dBees?: number; dHerd?: number; dHub?: number;
  /** in the grotto (0..1), the restored glasshouse (m), snow lying (0..1) */
  cave?: number; dGlasshouse?: number; snowCover?: number;
  /** a piece of music (scene) or none */
  music?: MusicScene | null; festival?: FestivalName | null; piece?: number;
  /** walk on this surface (a step every 0.42 s) */
  steps?: StepSurface | null; wet?: boolean;
  /** which layer(s) to include: all (through the master), or one group before the master */
  only?: 'beds' | 'music' | 'steps';
}

const PRESETS: Record<string, Partial<MixSpec>> = {
  square: { hour: 10, dHub: 2 },
  meadow: { hour: 15, dHub: 45, dHerd: 18, dBees: 20 },
  river: { hour: 9, dRiver: 3, dHub: 50 },
  pond: { hour: 22, dPond: 4, dHub: 40 },
  campfire: { hour: 21, dFire: 3, dHub: 35, dPond: 20 },
  mill: { hour: 13, dWindmill: 6, dHub: 60 },
  falls: { hour: 11, dWaterfall: 14, dHub: 100, dRiver: 20 },
  dawn: { hour: 6.6, dHub: 30 },
  rain: { hour: 14, weather: 'rain', intensity: 0.7, dHub: 20 },
  storm: { hour: 16, weather: 'storm', intensity: 0.9, dHub: 20 },
  snow: { hour: 12, season: 'winter', weather: 'snow', intensity: 0.6, dHub: 30 },
  grotto: { hour: 12, cave: 1, dWaterfall: 6, dRiver: 25, dHub: 110 },
  glasshouse: { hour: 11, dGlasshouse: 2, dHub: 40 },
  spring: { hour: 6.8, season: 'spring', dHub: 40 },
  autumn: { hour: 15, season: 'autumn', wind: 7, dHub: 45 },
};

/** 'preset[,key=value…]' → spec, e.g. 'meadow,music=afternoon,steps=grass' */
export function parseMix(s: string): MixSpec {
  const [preset, ...kv] = s.split(',');
  const spec: MixSpec = { hour: 12, season: 'summer', weather: 'clear', intensity: 0, wind: 3, music: null, steps: null, ...(PRESETS[preset] ?? {}) };
  for (const p of kv) {
    const [k, v] = p.split('=');
    const num = Number(v);
    (spec as unknown as Record<string, unknown>)[k] = v === undefined ? true : v === 'null' ? null : Number.isFinite(num) ? num : v;
  }
  return spec;
}

const daylightAt = (h: number) => Math.max(0, Math.min(1, Math.sin(((h - 6) / 12) * Math.PI) * 1.3));

export async function mixInto(c: BaseAudioContext, specStr: string, seconds: number): Promise<void> {
  const s = parseMix(specStr);
  const g = busGains({});
  const master = c.createGain();
  master.gain.value = g.master;
  if (s.only) master.connect(c.destination); else master.connect(buildMaster(c, c.destination));
  const bus = (k: number) => { const b = c.createGain(); b.gain.value = k; b.connect(master); return b; };
  const amb = bus(g.ambient), mus = bus(g.music), sfx = bus(g.sfx);
  if (!s.only || s.only === 'beds') {
    const inp: AmbientIn = {
      hour: s.hour, daylight: daylightAt(s.hour), season: s.season, weather: s.weather, intensity: s.intensity, wind: s.wind, cpu: 0.5, altitude: 0,
      dRiver: s.dRiver ?? 300, dPond: s.dPond ?? 300, dWaterfall: s.dWaterfall ?? 300, dFire: s.dFire ?? 300, dWindmill: s.dWindmill ?? 300,
      dBees: s.dBees ?? Infinity, dHerd: s.dHerd ?? Infinity, dHub: s.dHub ?? 20,
      cave: s.cave ?? 0, dGlasshouse: s.dGlasshouse ?? Infinity, snowCover: s.snowCover ?? 0,
    };
    const lv = ambientLevels(inp, emptyLevels());
    for (const kind of Object.keys(BED_SCALE) as LoopKind[]) {
      if (kind === 'roof') continue;
      const level = (lv as unknown as Record<string, number>)[kind] ?? 0;
      if (level < 0.004) continue;
      const v = buildLoop(kind, c, { cpu: () => 0.5, tempC: () => 55, send: null, season: () => s.season });
      v.out.gain.value = level * BED_SCALE[kind];
      v.out.connect(amb);
      for (let t = 0; t < seconds; t += 0.25) v.tick(t, 0.3, level);
    }
  }
  if (s.music && (!s.only || s.only === 'music')) renderPiece(c, mus, s.music, s.season, s.festival ?? null, s.piece ?? 0, seconds, 1);
  if (s.steps && (!s.only || s.only === 'steps')) {
    for (let t = 0.3; t < seconds; t += 0.42) {
      const pg = c.createGain(); pg.gain.value = 0.96 * STEP_GAIN[s.steps]; pg.connect(sfx);
      const o = { pitch: 0.97 + Math.random() * 0.06, rnd: Math.random };
      STEP_RECIPES[s.steps](c, pg, t, o);
      if (s.wet) PUDDLE(c, pg, t, o);
    }
  }
}

export async function mixMeasure(spec: string, seconds = 20): Promise<Record<string, ReturnType<typeof inDb>>> {
  const out: Record<string, ReturnType<typeof inDb>> = {};
  for (const only of ['beds', 'music', 'steps', ''] as const) {
    const oc = new OfflineAudioContext(2, Math.ceil(44100 * seconds), 44100);
    await mixInto(oc, only ? `${spec},only=${only}` : spec, seconds);
    out[only || 'mix'] = inDb(measure(await oc.startRendering()));
  }
  return out;
}
