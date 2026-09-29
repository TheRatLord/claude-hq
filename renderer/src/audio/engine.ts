/**
 * WebAudio engine: AudioContext lifecycle (created + resumed on the first user gesture: muted until then, as browsers
 * require), the mixer graph, the pre-rendered buffer bank (synth.ts), one-shot playback (flat or positional) with
 * per-category voice caps, the listener pose, and a meter for debug/tests.
 *
 *   categories (notify | sfx | voices | ambient) ─┬─────────────► master ─► comp ─► destination
 *                                                 └─ send ─► reverb (1 convolver) ─┘
 * Owner: AUD.
 */
import type * as THREE from 'three';
import * as S from './synth.ts';
import { occlusion, type Category } from './mix.ts';

const CAPS: Readonly<Record<Category, number>> = { notify: 8, sfx: 24, voices: 4, ambient: 12 };
const CAT_NAMES = Object.keys(CAPS) as Category[]; // Object.keys() loses the key union; CAPS is the one source of the names
const STEP_VARIANTS = 4;

export interface Vec3 { x: number; y: number; z: number }

export interface PlayOpts {
  cat?: Category;
  gain?: number;
  /** playbackRate */
  rate?: number;
  /** ac time (default now) */
  when?: number;
  /** positional when set */
  pos?: Vec3 | null;
  /** source zone (occlusion vs the listener's zone) */
  zone?: string | null;
  /** HRTF panner (the blocked ding only; equalpower otherwise) */
  hrtf?: boolean;
  /** panner refDistance (m) */
  ref?: number;
  /** reverb send (0..1; default: the room's) */
  rev?: number;
}

/** Debug capture summary: post-compressor level over the recording. */
export interface CaptureResult { peak: number; rms: number; loud50: number }

type BankJob = [string, () => S.Samples | S.Samples[]];
type IdleDeadlineLike = { timeRemaining(): number };

/** Render rate of the bank: AudioBuffers carry their own rate, so a 44.1 kHz device resamples on playback. */
const SR = 48000;

/**
 * The bank's render jobs, cheapest-to-need first (room tone + footsteps before the rare foley). Each job is a few ms,
 * so boot can pump them in idle slices long before the first gesture (no hitch on the unlocking click).
 */
function bankJobs(): BankJob[] {
  const J: BankJob[] = [['pink', () => S.renderPinkLoop(SR)], ['white', () => S.renderWhite(SR)]];
  for (let v = 0; v < STEP_VARIANTS; v++) for (const s of S.SURFACES) J.push([`step:${s}:${v}`, () => S.renderStep(s, v, SR)]);
  for (let v = 0; v < 6; v++) J.push([`key:${v}`, () => S.renderKey(v, SR)]);
  J.push(['blocked', () => S.renderBlockedChime(SR)], ['bell', () => S.renderDeskBell(SR)], ['done', () => S.renderDoneChime(SR)]);
  for (const s of S.SURFACES) J.push([`land:${s}`, () => S.renderStep(s, 0, SR, true)]);
  for (const n of ['testPass', 'testFail', 'error', 'commit', 'stamp', 'whoosh', 'squeak', 'chute', 'sit', 'boop', 'swish']) J.push([n, () => S.renderFoley(n, SR)]);
  for (let v = 0; v < 4; v++) J.push([`pop:${v}`, () => S.renderFoley('pop', SR, v)], [`bubble:${v}`, () => S.renderFoley('bubble', SR, v)]);
  J.push(['allClear', () => S.renderAllClear(SR)]);
  // ambient life (m2 r3): cat / Bean / roomba / steam cues
  for (const n of ['purr', 'meow', 'catHiss', 'catLand', 'pssht', 'ding', 'serve', 'bonk', 'crumbs']) J.push([n, () => S.renderFoley(n, SR)]);
  J.push(['meow:1', () => S.renderFoley('meow', SR, 1)], ['meow:2', () => S.renderFoley('meow', SR, 2)], ['pssht:1', () => S.renderFoley('pssht', SR, 1)]);
  // M3.5 cues. Bank names share a byName prefix with their family: `whoosh:plane` counts as whoosh, `lantern:*`, `crate:*`
  J.push(['whoosh:plane', () => S.renderFoley('plane', SR)], ['squeak:pat', () => S.renderFoley('pat', SR)],
    ['whistle', () => S.renderFoley('whistle', SR)], ['lantern:pop', () => S.renderFoley('lanternPop', SR)],
    ['crate:clack', () => S.renderFoley('crateClack', SR)], ['crate:unwrap', () => S.renderFoley('unwrap', SR)],
    ['thanks', () => S.renderFoley('thanks', SR)], ['spawn', () => S.renderFoley('spawn', SR)], ['slap', () => S.renderFoley('slap', SR)],
    ['inboxZero', () => S.renderInboxZero(SR)]);
  for (let v = 0; v < 3; v++) J.push([`lantern:rise:${v}`, () => S.renderFoley('lanternRise', SR, v)]);
  return J;
}

export function createEngine() {
  let ac: AudioContext | null = null;
  let master: GainNode | null = null, comp: DynamicsCompressorNode | null = null, reverb: ConvolverNode | null = null;
  let revIn: GainNode | null = null, analyser: AnalyserNode | null = null;
  // Empty until build() creates the context, then holds one GainNode per category (every reader runs after unlock()).
  const cats = {} as Record<Category, GainNode>;
  const active: Record<Category, number> = { notify: 0, sfx: 0, voices: 0, ambient: 0 };
  const counters = { played: 0, dropped: 0, bankMs: 0, byName: {} as Record<string, number> };
  let roomRev = 0.2;
  let listenerZone: string | null = null;
  const readyFns: (() => void)[] = [];
  let meterBuf: Float32Array<ArrayBuffer> | null = null;

  // ---- bank: Float32 renders (idle, pre-gesture) → AudioBuffers (lazily, once a context exists) ----
  const jobs = new Map(bankJobs());
  const data = new Map<string, S.Samples | S.Samples[]>();
  const buffers = new Map<string, AudioBuffer>();
  const runJob = (name: string) => {
    const fn = jobs.get(name);
    if (!fn) return;
    jobs.delete(name);
    const t0 = performance.now();
    data.set(name, fn());
    counters.bankMs += performance.now() - t0;
  };
  /** Pump jobs while the frame has idle time (requestIdleCallback), so boot perf never sees the renders. */
  const ric: (fn: (dl: IdleDeadlineLike) => void, o?: { timeout: number }) => unknown =
    globalThis.requestIdleCallback ?? ((fn) => setTimeout(() => fn({ timeRemaining: () => 4 }), 40));
  let pumpTimer: ReturnType<typeof setTimeout> | undefined, closed = false;
  const idlePump = (dl: IdleDeadlineLike) => {
    let n = 0; // at least one job per callback, so a busy main thread still finishes the bank eventually
    for (const name of jobs.keys()) { if (n++ && dl.timeRemaining() < 3) break; runJob(name); }
    if (jobs.size && !closed) ric(idlePump, { timeout: 4000 });
  };
  pumpTimer = setTimeout(() => ric(idlePump, { timeout: 4000 }), 1000);
  const bank = {
    has: (name: string) => jobs.has(name) || data.has(name),
    get(name: string): AudioBuffer | null {
      let b = buffers.get(name);
      if (b || !ac) return b ?? null;
      if (!data.has(name)) runJob(name); // not rendered yet: render this one now (a few ms)
      const d = data.get(name);
      if (!d || Array.isArray(d)) return null;
      b = ac.createBuffer(1, d.length, SR);
      b.copyToChannel(d, 0);
      buffers.set(name, b);
      return b;
    },
    keys: () => [...data.keys(), ...jobs.keys()],
    get pending() { return jobs.size; },
  };

  /** Create the context and the mixer graph; null when WebAudio is unavailable. */
  function build(): AudioContext | null {
    const AC = globalThis.AudioContext ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try { ac = new AC({ latencyHint: 'interactive' }); } catch { return null; }
    comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    master = ac.createGain(); master.gain.value = 0;
    analyser = ac.createAnalyser(); analyser.fftSize = 1024;
    master.connect(comp).connect(ac.destination);
    comp.connect(analyser);
    reverb = ac.createConvolver();
    // (a ConvolverNode needs the context's own rate: render the ~1.4 s IR here, ≈ 4 ms)
    const [l, r] = S.renderImpulse(ac.sampleRate);
    const ir = ac.createBuffer(2, l.length, ac.sampleRate);
    ir.copyToChannel(l, 0); ir.copyToChannel(r, 1);
    reverb.buffer = ir;
    revIn = ac.createGain(); revIn.gain.value = 0.5;
    revIn.connect(reverb).connect(master);
    for (const k of CAT_NAMES) { cats[k] = ac.createGain(); cats[k].connect(master); }
    return ac;
  }

  /**
   * Positional chain for a one-shot: panner (+ occlusion lowpass) → category (+ reverb send).
   * Returns every node created (disconnect them all when the sound ends).
   */
  function route(o: PlayOpts, gainNode: GainNode): AudioNode[] {
    if (!ac) return [gainNode]; // closed: nothing to route (callers only get here with a running context)
    const cat = cats[o.cat ?? 'sfx'];
    const made: AudioNode[] = [gainNode];
    let head: AudioNode = gainNode;
    if (o.pos) {
      const p = ac.createPanner();
      p.panningModel = o.hrtf ? 'HRTF' : 'equalpower';
      p.distanceModel = 'inverse'; p.refDistance = o.ref ?? 2; p.rolloffFactor = 1.1; p.maxDistance = 60;
      setPos(p, o.pos);
      head.connect(p);
      head = p; made.push(p);
      const occ = occlusion(listenerZone, o.zone ?? null);
      if (occ.lp < 20000) {
        const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = occ.lp;
        const g = ac.createGain(); g.gain.value = occ.gain;
        head.connect(lp).connect(g);
        head = g; made.push(lp, g);
      }
    }
    head.connect(cat);
    const send = o.rev ?? roomRev;
    if (send > 0.01 && revIn) {
      const sg = ac.createGain(); sg.gain.value = send;
      head.connect(sg).connect(revIn);
      made.push(sg);
    }
    return made;
  }

  const setPos = (p: PannerNode, pos: Vec3) => {
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
    else p.setPosition(pos.x, pos.y, pos.z);
  };

  /**
   * Play a banked buffer once.
   */
  function play(name: string, o: PlayOpts = {}): AudioBufferSourceNode | null {
    if (!ac || ac.state !== 'running') return null;
    const b = bank.get(name);
    if (!b) return null;
    const cat = o.cat ?? 'sfx';
    if (active[cat] >= CAPS[cat]) { counters.dropped++; return null; }
    const src = ac.createBufferSource();
    src.buffer = b;
    if (o.rate) src.playbackRate.value = o.rate;
    const g = ac.createGain(); g.gain.value = o.gain ?? 1;
    src.connect(g);
    const made = route({ ...o, cat }, g);
    active[cat]++; counters.played++;
    counters.byName[name.split(':')[0]] = (counters.byName[name.split(':')[0]] ?? 0) + 1;
    src.onended = () => { active[cat]--; src.disconnect(); for (const n of made) n.disconnect(); };
    src.start(o.when ?? 0);
    return src;
  }

  /** Reserve a slot for a live voice (voice.ts builds its own graph); returns the entry node or null when capped. */
  function voiceSlot(o: PlayOpts): { node: GainNode; release: (endT: number) => void } | null {
    const ctx = ac;
    if (!ctx || ctx.state !== 'running') return null;
    const cat = o.cat ?? 'voices';
    if (active[cat] >= CAPS[cat]) { counters.dropped++; return null; }
    const g = ctx.createGain(); g.gain.value = o.gain ?? 1;
    const made = route({ ...o, cat }, g);
    active[cat]++; counters.played++;
    counters.byName.voice = (counters.byName.voice ?? 0) + 1;
    return { node: g, release: (endT) => {
      const ms = Math.max(0, (endT - ctx.currentTime) * 1000) + 150;
      setTimeout(() => { active[cat]--; for (const n of made) n.disconnect(); }, ms);
    } };
  }

  /** Listener pose from the camera (forward = −Z of its world matrix). */
  function setListener(cam: THREE.Object3D, zone?: string | null) {
    listenerZone = zone ?? null;
    if (!ac) return;
    const L = ac.listener, e = cam.matrixWorld.elements;
    const px = e[12], py = e[13], pz = e[14], fx = -e[8], fy = -e[9], fz = -e[10], ux = e[4], uy = e[5], uz = e[6];
    if (L.positionX) {
      L.positionX.value = px; L.positionY.value = py; L.positionZ.value = pz;
      L.forwardX.value = fx; L.forwardY.value = fy; L.forwardZ.value = fz;
      L.upX.value = ux; L.upY.value = uy; L.upZ.value = uz;
    } else { L.setPosition(px, py, pz); L.setOrientation(fx, fy, fz, ux, uy, uz); }
  }

  /** Output level (RMS, peak) of the last ~21 ms after the compressor: debug + the headless verifier. */
  function meter() {
    if (!analyser) return { rms: 0, peak: 0 };
    meterBuf ??= new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(meterBuf);
    let s = 0, m = 0;
    for (let i = 0; i < meterBuf.length; i++) { const v = meterBuf[i]; s += v * v; m = Math.max(m, Math.abs(v)); }
    return { rms: Math.sqrt(s / meterBuf.length), peak: m };
  }

  /**
   * Debug/verification only: record `sec` of the post-compressor mix (mono) → {peak, rms, loudest 50 ms window rms}.
   * A ScriptProcessor exists only for the capture's duration.
   */
  function capture(sec = 1): Promise<CaptureResult | null> {
    const ctx = ac, cmp = comp;
    if (!ctx || !cmp) return Promise.resolve(null);
    return new Promise((res) => {
      const sp = ctx.createScriptProcessor(2048, 1, 1);
      const chunks: Float32Array[] = [];
      let n = 0;
      const need = Math.ceil(sec * ctx.sampleRate);
      const sink = ctx.createGain(); sink.gain.value = 0;
      sp.onaudioprocess = (e) => {
        if (n >= need) return;
        chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
        n += 2048;
        if (n >= need) {
          sp.disconnect(); sink.disconnect();
          const all = new Float32Array(n); let o = 0;
          for (const c of chunks) { all.set(c, o); o += c.length; }
          const win = Math.floor(ctx.sampleRate * 0.05);
          let best = 0;
          for (let i = 0; i + win <= all.length; i += win >> 1) best = Math.max(best, S.rms(all.subarray(i, i + win)));
          res({ peak: +S.peak(all).toFixed(3), rms: +S.rms(all).toFixed(4), loud50: +best.toFixed(3) });
        }
      };
      cmp.connect(sp); sp.connect(sink).connect(ctx.destination);
    });
  }

  return {
    capture,
    get ac() { return ac; },
    get running() { return !!ac && ac.state === 'running'; },
    cats, bank, counters, active,
    /** Create (first call) or resume the context. Must run inside a user-gesture handler. */
    unlock() {
      let c = ac;
      if (!c) { c = build(); if (!c) return false; for (const f of readyFns.splice(0)) f(); }
      if (c.state === 'suspended') c.resume().catch(() => {});
      return true;
    },
    onReady(fn: () => void) { if (ac) fn(); else readyFns.push(fn); },
    setMaster(v: number, t = 0.08) { if (master && ac) master.gain.setTargetAtTime(v, ac.currentTime, t); },
    setCat(k: Category, v: number, t = 0.08) { const g = cats[k]; if (g && ac) g.gain.setTargetAtTime(v, ac.currentTime, t); },
    setRoomReverb(v: number) { roomRev = v; },
    get roomRev() { return roomRev; },
    get listenerZone() { return listenerZone; },
    play, voiceSlot, route, setPos, setListener, meter,
    close() { closed = true; clearTimeout(pumpTimer); ac?.close?.().catch?.(() => {}); ac = null; },
  };
}

export type Engine = ReturnType<typeof createEngine>;
