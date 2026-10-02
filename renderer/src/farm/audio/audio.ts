/**
 * The valley's sound. Publishes service 'audio' (ValleyAudio ⊃ AudioService): synthesised one-shots for every SFX
 * name, farmer babble, critter voices, positional loops for other packages, ambient beds by time/weather/place,
 * composed-on-the-fly music pieces with rests between them (musicPlan.ts), surface-aware footsteps (steps.ts) and event
 * stingers from the valley.
 *
 * Nothing sounds until the first user gesture creates the AudioContext (autoplay policy); sounds requested before
 * that are dropped. Debug: `__valley.ctx.services.get('audio')._debug` (unlock, stats, music, next, render, mix, pcm,
 * renderAll: debug.ts).
 */
import * as THREE from 'three';
import type { AudioService, FarmerLocator, IndoorSpace, SceneCtx, SfxName, SystemFactory } from '../scene/context.ts';
import { SFX } from '../scene/context.ts';
import type { Settings } from '../../core/settings.ts';
import type { ValleyEvent } from '../model/types.ts';
import { SITES, heightAt, pathAt } from '../world/map.ts';
import { createAudioEngine } from './engine.ts';
import type { PosChain } from './engine.ts';
import { createPolyphony, createRateLimiter, spatial } from './mix.ts';
import type { SpatialOpts } from './mix.ts';
import { CRITTER_RECIPES, PUDDLE, SFX_RECIPES, STEP_GAIN, STEP_RECIPES, busOf, sendOf } from './sfx.ts';
import type { BusName, Recipe } from './sfx.ts';
import { planVoice } from './voicePlan.ts';
import type { VoiceMood } from './voicePlan.ts';
import { renderVoice } from './voice.ts';
import { createAmbience } from './ambience.ts';
import { createMusic } from './music.ts';
import type { Music } from './music.ts';
import type { FestivalName, MusicIn } from './musicPlan.ts';
import { buildLoop } from './loops.ts';
import type { LoopKind, LoopVoice } from './loops.ts';
import { PLAZA, stepSurface } from './steps.ts';
import type { StepIn, StepOut } from './steps.ts';
import { CRITTER_SOUNDS } from './types.ts';
import type { CritterSound, ValleyAudio } from './types.ts';

type LoopName = Parameters<AudioService['loop']>[0];

/** Minimum gap between two plays of one name (s): bursts coalesce instead of stacking. */
const GAPS: Record<string, number> = {
  'step-grass': 0.07, 'step-wood': 0.07, 'step-water': 0.07, step: 0.07, 'step:splash': 0.07, 'ui-hover': 0.04, 'ui-click': 0.03,
  alert: 4, bell: 6, 'chime-done': 1.2, 'chime-pass': 1.5, oops: 1, ship: 0.8, mail: 1, thunder: 1.5,
  pop: 0.08, sparkle: 0.3, quack: 0.15, hoe: 0.25, creak: 0.5, bark: 0.3, meow: 0.6, purr: 1.2, moo: 0.8, baa: 0.6,
  'c:chirp': 0.07, 'c:coo': 0.4, 'c:flap': 0.1, 'c:ribbit': 0.1, 'c:plop': 0.08, 'c:hop': 0.05, 'c:hoot': 2, 'c:fish': 0.2, 'c:wag': 0.5, 'c:squeak': 0.3,
};
/** Distance model per bus: notifications carry far, UI/footsteps are not positional anyway. */
const SPATIAL: Record<BusName, SpatialOpts> = {
  sfx: { ref: 3, max: 70 }, notify: { ref: 6, max: 140 }, voice: { ref: 2.5, max: 40 }, ambient: { ref: 2, max: 50 },
};

interface PlayOpts { pos?: THREE.Vector3 | { x: number; y: number; z: number }; volume?: number; pitch?: number; floor?: number }

export const audioSystem: SystemFactory = (ctx: SceneCtx) => {
  const settings = ctx.services.get('settings') as Settings | undefined;
  const eng = createAudioEngine(settings);
  const limiter = createRateLimiter(GAPS);
  const poly = createPolyphony(44);
  const rnd = Math.random;
  const voiceEnds = new Float64Array(3);
  let voiceCount = 0, lastExternalThunder = -1e9, dropped = 0, played = 0;
  let music: Music | null = null;
  const sp = { gain: 0, pan: 0, cutoff: 20000 };
  const now = () => eng.ac?.currentTime ?? 0;

  /** one-shot routing: volume → (pan → low-pass) → bus (+ reverb send); nodes are released after `end` */
  function route(bus: BusName, volume: number, pos: PlayOpts['pos'], floor: number, send: number, opts: SpatialOpts): { input: AudioNode; release(end: number): void } | null {
    const ac = eng.ac, dest = eng.bus(bus);
    if (!ac || !dest) return null;
    let gain = volume, pan = 0, cutoff = 20000;
    if (pos) {
      const L = eng.listener;
      spatial(pos.x - L.x, pos.y - L.y, pos.z - L.z, L.rx, L.rz, opts, sp);
      gain *= Math.max(floor, sp.gain); pan = sp.pan; cutoff = sp.cutoff;
      if (gain < 0.006) return null;
    }
    const g = ac.createGain();
    g.gain.value = gain;
    const nodes: AudioNode[] = [g];
    let head: AudioNode = g;
    if (pos) {
      const p = ac.createStereoPanner(); p.pan.value = pan;
      head.connect(p); head = p; nodes.push(p);
      if (cutoff < 19000) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 0.5; head.connect(f); head = f; nodes.push(f); }
    }
    head.connect(dest);
    if (send > 0 && eng.send) { const s = ac.createGain(); s.gain.value = send; head.connect(s).connect(eng.send); nodes.push(s); }
    return {
      input: g,
      release(end) { setTimeout(() => { for (const n of nodes) n.disconnect(); }, Math.max(0, end - ac.currentTime) * 1000 + 400); },
    };
  }

  function fire(key: string, recipe: Recipe, bus: BusName, o: PlayOpts, send: number, opts: SpatialOpts, priority = false): void {
    const ac = eng.ac;
    if (!ac || ac.state === 'closed') return;
    const t = ac.currentTime;
    if (!limiter.allow(key, t)) { dropped++; return; }
    const r = route(bus, o.volume ?? 1, o.pos, o.floor ?? 0, send, opts);
    if (!r) return;
    if (!poly.admit(t, t + 1.2, priority)) { dropped++; r.release(t); return; }
    try {
      const jitter = bus === 'notify' ? 1 : 0.97 + rnd() * 0.06;
      const end = recipe(ac, r.input, t + 0.005, { pitch: (o.pitch ?? 1) * jitter, rnd });
      r.release(end);
      played++;
    } catch (e) { console.error('[audio]', key, e); r.release(t); }
  }

  function play(name: SfxName, o: PlayOpts = {}): void {
    const recipe = SFX_RECIPES[name];
    if (!recipe) return;
    const bus = busOf(name);
    if (bus === 'notify') music?.duck(3, 0.25);
    fire(name, recipe, bus, o, sendOf(name), SPATIAL[bus], bus === 'notify');
  }

  function voice(seed: string, o: { pos?: THREE.Vector3; mood?: VoiceMood; syllables?: number } = {}): void {
    const ac = eng.ac;
    if (!ac) return;
    const t = ac.currentTime;
    if (!limiter.allow(`v:${seed}`, t, 0.35)) return;
    let slot = -1;
    for (let i = 0; i < voiceEnds.length; i++) if (voiceEnds[i] <= t) { slot = i; break; }
    if (slot < 0) { dropped++; return; }
    const r = route('voice', 1, o.pos, 0, 0.08, SPATIAL.voice);
    if (!r) return;
    const plan = planVoice(seed, o.mood ?? 'happy', o.syllables, voiceCount++);
    const end = renderVoice(ac, r.input, t + 0.01, plan);
    // the music leans back a little while someone near you talks
    if (!o.pos || Math.hypot(o.pos.x - eng.listener.x, o.pos.z - eng.listener.z) < 12) music?.duck(plan.total + 0.4, 0.6);
    voiceEnds[slot] = end;
    r.release(end);
  }

  function critter(kind: CritterSound, pos: THREE.Vector3, o: { volume?: number; pitch?: number } = {}): void {
    const recipe = CRITTER_RECIPES[kind];
    if (recipe) fire(`c:${kind}`, recipe, 'ambient', { pos, volume: o.volume, pitch: o.pitch }, kind === 'hoot' || kind === 'coo' ? 0.3 : 0.1, SPATIAL.ambient);
  }

  // ---- positional loops for other packages
  interface ExtLoop { kind: LoopKind; pos: THREE.Vector3 | null; vol: number; voice: LoopVoice | null; chain: PosChain | null; dead: boolean }
  const loops = new Set<ExtLoop>();
  function startLoop(l: ExtLoop): void {
    const ac = eng.ac, dest = eng.dry();
    if (!ac || !dest || l.voice || l.dead) return;
    l.voice = buildLoop(l.kind, ac, amb.env);
    l.voice.out.gain.value = 1;
    if (l.pos) { l.chain = eng.chain(dest); l.voice.out.connect(l.chain.input); eng.aim(l.chain, l.pos.x, l.pos.y, l.pos.z, l.vol, SPATIAL.sfx, true, 0); }
    else { l.chain = eng.chain(dest); l.voice.out.connect(l.chain.input); l.chain.input.gain.value = l.vol; }
  }
  function loop(name: LoopName, pos?: THREE.Vector3): { setVolume(v: number): void; stop(): void } {
    const l: ExtLoop = { kind: name, pos: pos ?? null, vol: 1, voice: null, chain: null, dead: false };
    loops.add(l);
    eng.onReady(() => startLoop(l));
    return {
      setVolume(v) { l.vol = Math.max(0, v); if (!l.pos && l.chain && eng.ac) l.chain.input.gain.setTargetAtTime(l.vol, eng.ac.currentTime, 0.1); },
      stop() {
        l.dead = true; loops.delete(l);
        l.voice?.stop();
        const ch = l.chain;
        if (ch) setTimeout(() => { ch.input.disconnect(); ch.pan.disconnect(); ch.lp.disconnect(); }, 800);
        l.voice = null; l.chain = null;
      },
    };
  }

  let indoorK = 0, roofK = 1;
  const amb = createAmbience(ctx, eng, () => fire('thunder:ambient', SFX_RECIPES.thunder, 'ambient', { volume: 0.35 + rnd() * 0.3, pitch: 0.9 }, 0.4, SPATIAL.ambient), () => now() - lastExternalThunder, () => indoorK, () => roofK);

  // ---- the service
  const svc: ValleyAudio & { _debug: unknown } = {
    play(name, o) {
      if (name === 'thunder') lastExternalThunder = now();
      play(name, o);
    },
    voice,
    loop,
    critter,
    indoors(k, o) { indoorK = Math.max(0, Math.min(1, k)); roofK = Math.max(0, Math.min(3, o?.roof ?? 1)); eng.setIndoor(indoorK); },
    musicNow: () => ({ on: !!music && music.on && eng.ac?.state === 'running', scene: music?.playing() ?? null }),
    _debug: {
      unlock: () => eng.unlock(),
      stats: () => ({
        state: eng.ac?.state ?? 'locked', time: now(), played, dropped, active: poly.active(now()), loops: loops.size,
        beds: amb.stats(), levels: { ...amb.levels }, music: music ? { on: music.on, ...music.stats(now()) } : null, gains: { ...eng.gains },
      }),
      music: (on: boolean) => { music?.setOn(on); return on; },
      /** dev: end the current piece (or rest) so the next one starts in a second */
      next: () => { music?.skip(); return music?.stats(now()); },
      // offline measurement (debug.ts, loaded on demand): see its header for the names
      render: async (name: string, seconds = 3) => (await import('./debug.ts')).renderMeasure(name, seconds),
      pcm: async (name: string, seconds = 3, sr = 44100) => (await import('./debug.ts')).renderPcm(name, seconds, sr),
      mix: async (spec: string, seconds = 20) => (await import('./debug.ts')).mixMeasure(spec, seconds),
      async renderAll(seconds = 3) {
        const d = await import('./debug.ts');
        const names = [...SFX, ...CRITTER_SOUNDS.map((c) => `critter:${c}`), 'voice:ann:happy:4', 'voice:bob:question:5', 'voice:cy:sad:4', 'voice:di:excited:8',
          ...['grass', 'dirt', 'stone', 'deck', 'floor', 'water', 'snow'].map((k) => `step:${k}`), 'step:stone:wet',
          ...(['wind', 'rain', 'roof', 'river', 'waterfall', 'pond', 'fire', 'windmill', 'bees', 'crickets', 'birds', 'owls', 'frogs', 'leaves', 'cowbells'] as const).map((k) => `loop:${k}:1`)];
        const out: Record<string, unknown> = {};
        for (const n of names) out[n] = d.inDb(await d.renderMeasure(n, n.startsWith('loop:') ? 8 : seconds));
        return out;
      },
    },
  };
  ctx.services.set('audio', svc);

  // ---- music once unlocked: its own bus (volumeMusic), a reverb send, tunes seeded per real day
  eng.onReady((ac) => {
    const dest = eng.bus('music');
    if (dest) music = createMusic(ac, dest, eng.send, 7 + ctx.valley.sky.dayOfYear * 31);
  });
  const musicIn: MusicIn = { hour: 12, season: 'summer', weather: 'clear', intensity: 0, indoors: false, festival: null, gathering: null };
  /** evening gatherings (scene/gather, service 'gatherings'): whose live music is within earshot, and where it plays */
  type GatherAudio = { music(x: number, z: number): 'campfire' | 'concert' | null; stage(): { x: number; y: number; z: number } | null };
  const gatherSvc = () => ctx.services.get('gatherings') as GatherAudio | undefined;
  const LIVE: SpatialOpts = { ref: 9, max: 170 };
  const live = { gain: 0, pan: 0, cutoff: 20000 };
  const readMusicIn = (): MusicIn => {
    const sky = ctx.valley.sky;
    musicIn.hour = sky.hour; musicIn.season = sky.season; musicIn.weather = sky.weather.kind; musicIn.intensity = sky.weather.intensity;
    musicIn.indoors = indoorK > 0.5;
    musicIn.festival = (sky.festival?.active?.id ?? null) as FestivalName | null;
    musicIn.gathering = musicIn.indoors ? null : gatherSvc()?.music(eng.listener.x, eng.listener.z) ?? null;
    return musicIn;
  };

  // ---- footsteps + jump/land
  let stepOff: (() => void) | null = null;
  const trySubscribeSteps = () => {
    if (stepOff) return;
    const ctrl = ctx.services.get('controller') as { onStep?(fn: (speed: number, surface: 'grass' | 'water' | 'wood') => void): () => void } | undefined;
    if (!ctrl?.onStep) return;
    stepOff = ctrl.onStep((speed, surface) => step(speed, surface));
  };
  const stepIn: StepIn = { ctrl: 'grass', indoors: false, path: 0, plaza: 99, season: 'summer', weather: 'clear', wet: 0, snow: 0, height: 0 };
  const stepOut: StepOut = { surface: 'grass', splash: 0 };
  let stepSide = 1;
  /** one footstep: the surface under the player (steps.ts), a puddle splash in the wet, a touch of left / right */
  function step(speed: number, ctrlSurface: 'grass' | 'water' | 'wood'): void {
    const p = ctx.player.pos, sky = ctx.valley.sky;
    const trace = (sky as { trace?: { wet: number; snow: number } }).trace;
    stepIn.ctrl = ctrlSurface;
    stepIn.indoors = !!(ctx.services.get('indoors') as IndoorSpace | undefined)?.active;
    stepIn.plaza = Math.hypot(p.x - PLAZA.x, p.z - PLAZA.z);
    stepIn.path = stepIn.plaza < PLAZA.r || stepIn.indoors || ctrlSurface !== 'grass' ? 0 : pathAt(p.x, p.z);
    stepIn.season = sky.season; stepIn.weather = sky.weather.kind;
    stepIn.wet = trace?.wet ?? ctx.lighting?.wet ?? 0;
    stepIn.snow = trace?.snow ?? 0;
    stepIn.height = p.y;
    stepSurface(stepIn, stepOut);
    const recipe = STEP_RECIPES[stepOut.surface];
    stepSide = -stepSide;
    const vol = Math.min(1, 0.45 + speed / 9);
    const pos = stepPos.set(eng.listener.x + eng.listener.rx * 0.35 * stepSide, eng.listener.y - 1.5, eng.listener.z + eng.listener.rz * 0.35 * stepSide);
    fire('step', recipe, 'sfx', { volume: vol * STEP_GAIN[stepOut.surface], pitch: speed > 6 ? 1.06 : 1, pos }, 0, SPATIAL.sfx);
    if (stepOut.splash > 0.05) fire('step:splash', PUDDLE, 'sfx', { volume: vol * stepOut.splash, pos }, 0, SPATIAL.sfx);
  }
  const stepPos = new THREE.Vector3();
  trySubscribeSteps();
  let air = false, airTime = 0, prevY = ctx.player.pos.y, lastAim = 0;

  // ---- valley events
  const tmp = new THREE.Vector3();
  const farmerPos = (id: string): THREE.Vector3 | null => {
    const loc = ctx.services.get('farmers') as FarmerLocator | undefined;
    const p = loc?.position(id);
    return p ? tmp.copy(p).setY(p.y + 1) : null;
  };
  /**
   * Event layer. Other packages already voice their events where they happen (structures: the farmhouse bell on
   * 'blocked', the bin creak on 'ship'; farmers: chime-pass / oops / ship / duckling pop+quack at the farmer), so
   * this layer only adds what must reach the player ANYWHERE: the needs-you alert and the done chime always, and a
   * non-positional copy of celebrate / oops when the farmer is too far away to hear their own. Its own limiter keys
   * (`ev:*`) so a positional copy played a moment earlier never swallows the notification.
   */
  const notify = (name: SfxName, o: PlayOpts = {}, gap?: number) => {
    const recipe = SFX_RECIPES[name];
    const ac = eng.ac;
    if (!recipe || !ac) return;
    if (gap !== undefined && !limiter.allow(`ev:gap:${name}`, ac.currentTime, gap)) return;
    const bus = busOf(name);
    if (bus === 'notify') music?.duck(3, 0.25);
    fire(`ev:${name}`, recipe, bus, o, sendOf(name), SPATIAL[bus], true);
  };
  const farFrom = (id: string, d: number) => {
    const p = (ctx.services.get('farmers') as FarmerLocator | undefined)?.position(id);
    return !p || Math.hypot(p.x - ctx.player.pos.x, p.z - ctx.player.pos.z) > d;
  };
  const offValley = ctx.onValley((e: ValleyEvent) => {
    try {
      switch (e.kind) {
        case 'blocked': notify('alert', {}, 4); break; // everywhere, not positional: the player must hear it
        case 'finished': notify('chime-done', {}, 1.5); break;
        case 'celebrate': if (farFrom(e.id, 22)) notify('chime-pass', { volume: 0.8 }, 2); break;
        case 'oops': if (farFrom(e.id, 22)) notify('oops', { volume: 0.5 }, 2); break;
        case 'plot-opened': {
          const plot = ctx.valley.plots.get(e.id);
          const s = plot ? SITES[plot.site] : null;
          const p = s ? new THREE.Vector3(s.x, s.y + 0.5, s.z) : undefined;
          play('hoe', { pos: p, floor: 0.15 });
          setTimeout(() => play('sparkle', { pos: p, floor: 0.15 }), 220);
          break;
        }
        case 'plot-closed': {
          const plot = ctx.valley.plots.get(e.id);
          const s = plot ? SITES[plot.site] : null;
          play('creak', { pos: s ? tmp.set(s.x, s.y + 0.5, s.z) : undefined, volume: 0.7 });
          break;
        }
        case 'arrived': {
          const f = ctx.valley.farmers.get(e.id);
          if (f && limiter.allow('ev:arrived', now(), 0.6)) voice(f.seed, { pos: farmerPos(e.id) ?? undefined, mood: 'excited', syllables: 3 });
          break;
        }
        case 'unblocked': notify('pop', { volume: 0.4, pitch: 1.3 }, 1); break;
        default: break;
      }
    } catch (err) { console.error('[audio] event', err); }
  });

  return {
    name: 'audio',
    update(f) {
      if (!stepOff) trySubscribeSteps();
      const cam = ctx.camera;
      eng.setListener(cam.position.x, cam.position.y, cam.position.z, cam.rotation.y);
      // jump / land from the player's feet vs the floor under them
      const p = ctx.player.pos;
      const ws = ctx.services.get('walkSurface') as ((x: number, z: number) => number | null) | undefined;
      const room = ctx.services.get('indoors') as IndoorSpace | undefined;
      const floor = room?.active ? room.floor(p.x, p.z, p.y) ?? p.y : Math.max(heightAt(p.x, p.z), ws?.(p.x, p.z) ?? -Infinity);
      const vy = f.dt > 0 ? (p.y - prevY) / f.dt : 0;
      prevY = p.y;
      if (!air && p.y - floor > 0.12 && vy > 2) { air = true; airTime = 0; play('jump'); }
      else if (air) {
        airTime += f.dt;
        if (p.y - floor < 0.03) { air = false; if (airTime > 0.15) play('land', { volume: Math.min(1, 0.4 + airTime) }); }
      }
      const ac = eng.ac;
      if (!ac || ac.state !== 'running') return;
      const t = ac.currentTime;
      amb.update(t);
      music?.update(t, readMusicIn(), amb.levels.music);
      const aimNow = t - lastAim > 0.066;
      if (aimNow) lastAim = t;
      // a gathering's live music comes from the campfire / the bandstand: panned, quieter from afar (never silent)
      if (music && aimNow) {
        const sc = music.playing();
        const st = sc === 'campfire' || sc === 'concert' ? gatherSvc()?.stage() : null;
        if (st) {
          const L = eng.listener;
          spatial(st.x - L.x, st.y - L.y, st.z - L.z, L.rx, L.rz, LIVE, live);
          music.place(live.pan * 0.75, Math.max(0.22, live.gain));
        } else music.place(0, 1);
      }
      for (const l of loops) if (l.voice) {
        if (l.chain && l.pos && aimNow) eng.aim(l.chain, l.pos.x, l.pos.y, l.pos.z, l.vol, SPATIAL.sfx, true, 0.1);
        l.voice.tick(t, 0.3, Math.min(1, l.vol));
      }
    },
    stats: () => ({ audio: eng.ac?.state ?? 'locked', played, dropped }),
    dispose() {
      offValley();
      stepOff?.();
      for (const l of [...loops]) l.voice?.stop();
      amb.dispose();
      eng.dispose();
      if (ctx.services.get('audio') === svc) ctx.services.delete('audio');
    },
  };
};
