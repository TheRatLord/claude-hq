/**
 * The audio engine: one AudioContext (created lazily on the first user gesture, so nothing warns about autoplay),
 * category buses tied to the volume settings, a shared valley reverb send, a master limiter, and manual
 * positional chains (gain + stereo pan + air-absorption low-pass) driven from the camera.
 *
 *   sfx ─┐
 *   voice┼─▶ master ─▶ glue compressor ─▶ limiter ─▶ destination        (buildMaster)
 *   notify┘     ▲
 *   ambient ─┬▶ hiddenDuck      (ambience + music hush to 30% while the window is hidden; notify stays full)
 *   music ───┘                 (its own bus and slider: volumeMusic; never muffled indoors)
 *   outdoor ─▶ muffle ─▶ ambient   (bus('ambient'): the valley's beds and critters, low-passed indoors; loops and
 *                                  the rain on the roof go to `dry()`, the ambient bus itself)
 *   reverb send ─▶ convolver ─▶ master
 */
import type { Settings } from '../../core/settings.ts';
import { busGains, spatial } from './mix.ts';
import type { BusGains, Spatial, SpatialOpts, Volumes } from './mix.ts';
import type { BusName } from './sfx.ts';

/** sound buses plus the music bus */
export type EngineBus = BusName | 'music';
import { valleyImpulse } from './synth.ts';

/**
 * The master chain (live and offline mixdowns share it): a gentle glue compressor that keeps the beds and the music
 * together, then a fast limiter that catches stacked one-shots. WebAudio compressors add automatic make-up gain (here
 * ≈ +7 dB for quiet material); with the trim at 1 a needs-you alert lands where it did behind the old single limiter
 * (≈ −5 dBFS peak at default sliders) while the quiet beds come up ~2.5 dB (measured, docs/VALLEY.md → Sound).
 */
export function buildMaster(c: BaseAudioContext, dest: AudioNode): GainNode {
  const input = c.createGain();
  const glue = c.createDynamicsCompressor();
  glue.threshold.value = -16; glue.knee.value = 10; glue.ratio.value = 2; glue.attack.value = 0.02; glue.release.value = 0.3;
  const limiter = c.createDynamicsCompressor();
  limiter.threshold.value = -4; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.1;
  const trim = c.createGain();
  trim.gain.value = MASTER_TRIM;
  input.connect(glue).connect(limiter).connect(trim).connect(dest);
  return input;
}
export const MASTER_TRIM = 1;

export interface PosChain { input: GainNode; pan: StereoPannerNode; lp: BiquadFilterNode }

export interface Listener { x: number; y: number; z: number; rx: number; rz: number }

export interface AudioEngine {
  readonly ac: AudioContext | null;
  bus(name: EngineBus): GainNode | null;
  /** the ambient bus without the indoor muffle (other packages' loops, the rain on the roof) */
  dry(): GainNode | null;
  /** 0 outdoors … 1 indoors: muffle the outdoor ambience (low-pass, quieter, less valley reverb) */
  setIndoor(k: number): void;
  /** reverb send input (null until unlocked) */
  readonly send: GainNode | null;
  readonly listener: Listener;
  unlock(): void;
  /** fn runs once the context exists (immediately if it already does) */
  onReady(fn: (ac: AudioContext) => void): void;
  setListener(x: number, y: number, z: number, yaw: number): void;
  /** a pan + low-pass chain feeding `dest` */
  chain(dest: AudioNode): PosChain;
  /** aim a chain at a world point; `gain` multiplies the distance gain (or replaces it when `distanceGain` is false) */
  aim(ch: PosChain, x: number, y: number, z: number, gain: number, o?: SpatialOpts, distanceGain?: boolean, tc?: number): Spatial;
  readonly gains: BusGains;
  dispose(): void;
}

const GESTURES = ['pointerdown', 'keydown', 'click', 'touchstart'] as const;

export function createAudioEngine(settings: Settings | undefined): AudioEngine {
  let ac: AudioContext | null = null;
  const buses: Partial<Record<EngineBus, GainNode>> = {};
  let master: GainNode | null = null, duck: GainNode | null = null, send: GainNode | null = null;
  let outdoor: GainNode | null = null, muffle: BiquadFilterNode | null = null, muffleGain: GainNode | null = null, indoor = 0;
  const applyIndoor = () => {
    if (!ac || !muffle || !muffleGain || !send) return;
    const t = ac.currentTime;
    muffle.frequency.setTargetAtTime(20000 * Math.pow(650 / 20000, indoor), t, 0.15);
    muffleGain.gain.setTargetAtTime(1 - 0.45 * indoor, t, 0.15);
    send.gain.setTargetAtTime(0.6 * (1 - 0.65 * indoor), t, 0.2);
  };
  const ready: ((ac: AudioContext) => void)[] = [];
  const gains = busGains({});
  const listener: Listener = { x: 0, y: 0, z: 0, rx: 1, rz: 0 };
  const sp: Spatial = { gain: 0, pan: 0, cutoff: 20000 };

  const readVolumes = (): Partial<Volumes> => settings ? {
    volumeMaster: settings.get('volumeMaster'), volumeSfx: settings.get('volumeSfx'), volumeAmbient: settings.get('volumeAmbient'),
    volumeNotify: settings.get('volumeNotify'), volumeVoices: settings.get('volumeVoices'), volumeMusic: settings.get('volumeMusic'), audioMuted: settings.get('audioMuted'),
  } : {};
  const apply = () => {
    busGains(readVolumes(), gains);
    if (!ac || !master) return;
    const t = ac.currentTime;
    master.gain.setTargetAtTime(gains.master, t, 0.05);
    buses.sfx?.gain.setTargetAtTime(gains.sfx, t, 0.05);
    buses.notify?.gain.setTargetAtTime(gains.notify, t, 0.05);
    buses.voice?.gain.setTargetAtTime(gains.voice, t, 0.05);
    buses.ambient?.gain.setTargetAtTime(gains.ambient, t, 0.05);
    buses.music?.gain.setTargetAtTime(gains.music, t, 0.05);
  };
  const offSettings = settings?.onChange((ch) => {
    if (['volumeMaster', 'volumeSfx', 'volumeAmbient', 'volumeNotify', 'volumeVoices', 'volumeMusic', 'audioMuted'].some((k) => k in ch)) apply();
  });
  apply();

  const onVisibility = () => {
    if (!ac || !duck) return;
    duck.gain.setTargetAtTime(document.hidden ? 0.3 : 1, ac.currentTime, 0.4);
  };

  const build = () => {
    if (ac) return;
    const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!Ctor) return;
    ac = new Ctor({ latencyHint: 'interactive' });
    master = ac.createGain();
    master.connect(buildMaster(ac, ac.destination));
    duck = ac.createGain();
    duck.gain.value = document.hidden ? 0.3 : 1;
    duck.connect(master);
    for (const b of ['sfx', 'notify', 'voice'] as const) { const g = ac.createGain(); g.connect(master); buses[b] = g; }
    const amb = ac.createGain(); amb.connect(duck); buses.ambient = amb;
    const mus = ac.createGain(); mus.connect(duck); buses.music = mus;
    outdoor = ac.createGain();
    muffle = ac.createBiquadFilter(); muffle.type = 'lowpass'; muffle.Q.value = 0.4; muffle.frequency.value = 20000;
    muffleGain = ac.createGain();
    outdoor.connect(muffle).connect(muffleGain).connect(amb);
    const conv = ac.createConvolver();
    conv.buffer = valleyImpulse(ac);
    send = ac.createGain();
    send.gain.value = 0.6;
    send.connect(conv).connect(master);
    apply();
    applyIndoor();
    document.addEventListener('visibilitychange', onVisibility);
    for (const fn of ready.splice(0)) { try { fn(ac); } catch (e) { console.error('[audio] ready hook', e); } }
  };

  const gesture = () => {
    build();
    if (ac && ac.state === 'suspended') void ac.resume();
  };
  for (const g of GESTURES) addEventListener(g, gesture, { capture: true, passive: true });

  return {
    get ac() { return ac; },
    bus: (n) => (n === 'ambient' ? outdoor : buses[n] ?? null),
    dry: () => buses.ambient ?? null,
    setIndoor(k) { indoor = Math.max(0, Math.min(1, k)); applyIndoor(); },
    get send() { return send; },
    listener,
    gains,
    unlock: gesture,
    onReady(fn) { if (ac) fn(ac); else ready.push(fn); },
    setListener(x, y, z, yaw) {
      listener.x = x; listener.y = y; listener.z = z;
      listener.rx = Math.cos(yaw); listener.rz = -Math.sin(yaw);
    },
    chain(dest) {
      const c = ac!;
      const input = c.createGain(), pan = c.createStereoPanner(), lp = c.createBiquadFilter();
      lp.type = 'lowpass'; lp.Q.value = 0.5; lp.frequency.value = 20000;
      input.connect(pan).connect(lp).connect(dest);
      return { input, pan, lp };
    },
    aim(ch, x, y, z, gain, o, distanceGain = true, tc = 0.06) {
      spatial(x - listener.x, y - listener.y, z - listener.z, listener.rx, listener.rz, o, sp);
      const t = ac?.currentTime ?? 0;
      const g = distanceGain ? gain * sp.gain : gain;
      if (tc <= 0) {
        ch.input.gain.value = g; ch.pan.pan.value = sp.pan; ch.lp.frequency.value = sp.cutoff;
      } else {
        ch.input.gain.setTargetAtTime(g, t, tc);
        ch.pan.pan.setTargetAtTime(sp.pan, t, tc);
        ch.lp.frequency.setTargetAtTime(sp.cutoff, t, tc);
      }
      return sp;
    },
    dispose() {
      for (const g of GESTURES) removeEventListener(g, gesture, { capture: true });
      document.removeEventListener('visibilitychange', onVisibility);
      offSettings?.();
      void ac?.close();
      ac = null;
    },
  };
}
