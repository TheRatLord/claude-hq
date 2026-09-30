/**
 * The audio engine: one AudioContext (created lazily on the first user gesture, so nothing warns about autoplay),
 * category buses tied to the volume settings, a shared valley reverb send, a master limiter, and manual
 * positional chains (gain + stereo pan + air-absorption low-pass) driven from the camera.
 *
 *   sfx ─┐
 *   voice┼─▶ master ─▶ limiter ─▶ destination
 *   notify┘     ▲
 *   ambient ─▶ hiddenDuck      (ambience + music hush to 30% while the window is hidden; notify stays full)
 *   reverb send ─▶ convolver ─▶ master
 */
import type { Settings } from '../../core/settings.ts';
import { busGains, spatial } from './mix.ts';
import type { BusGains, Spatial, SpatialOpts, Volumes } from './mix.ts';
import type { BusName } from './sfx.ts';
import { valleyImpulse } from './synth.ts';

export interface PosChain { input: GainNode; pan: StereoPannerNode; lp: BiquadFilterNode }

export interface Listener { x: number; y: number; z: number; rx: number; rz: number }

export interface AudioEngine {
  readonly ac: AudioContext | null;
  bus(name: BusName): GainNode | null;
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
  const buses: Partial<Record<BusName, GainNode>> = {};
  let master: GainNode | null = null, duck: GainNode | null = null, send: GainNode | null = null;
  const ready: ((ac: AudioContext) => void)[] = [];
  const gains = busGains({});
  const listener: Listener = { x: 0, y: 0, z: 0, rx: 1, rz: 0 };
  const sp: Spatial = { gain: 0, pan: 0, cutoff: 20000 };

  const readVolumes = (): Partial<Volumes> => settings ? {
    volumeMaster: settings.get('volumeMaster'), volumeSfx: settings.get('volumeSfx'), volumeAmbient: settings.get('volumeAmbient'),
    volumeNotify: settings.get('volumeNotify'), volumeVoices: settings.get('volumeVoices'), audioMuted: settings.get('audioMuted'),
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
  };
  const offSettings = settings?.onChange((ch) => {
    if (['volumeMaster', 'volumeSfx', 'volumeAmbient', 'volumeNotify', 'volumeVoices', 'audioMuted'].some((k) => k in ch)) apply();
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
    const limiter = ac.createDynamicsCompressor();
    limiter.threshold.value = -9; limiter.knee.value = 6; limiter.ratio.value = 12; limiter.attack.value = 0.003; limiter.release.value = 0.2;
    master = ac.createGain();
    master.connect(limiter).connect(ac.destination);
    duck = ac.createGain();
    duck.gain.value = document.hidden ? 0.3 : 1;
    duck.connect(master);
    for (const b of ['sfx', 'notify', 'voice'] as const) { const g = ac.createGain(); g.connect(master); buses[b] = g; }
    const amb = ac.createGain(); amb.connect(duck); buses.ambient = amb;
    const conv = ac.createConvolver();
    conv.buffer = valleyImpulse(ac);
    send = ac.createGain();
    send.gain.value = 0.6;
    send.connect(conv).connect(master);
    apply();
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
    bus: (n) => buses[n] ?? null,
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
