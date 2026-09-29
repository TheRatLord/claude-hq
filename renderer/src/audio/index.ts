/**
 * AUD (DESIGN §11 M3): fully procedural WebAudio for the office.
 * - Notifications (§8 "the 7 channels", GP §5.4): → blocked = a global 2-note glockenspiel chime + a spatial (HRTF)
 *   desk-bell ding at the agent; queued agents' 20 s bell taps ring the Help Desk bell. → done = a soft marimba
 *   arpeggio. Rate limit 1 per agent per 10 s, bursts merge into one chime. Driven by store events, so they fire in
 *   hidden tabs. When the last blocked agent clears: a little "all clear" sting.
 * - Player (§6.10): footsteps by floor material on `player.step` (phase-locked with the bob), landing thuds, the slide
 *   whoosh + "wheee", sit squish / stand boop.
 * - Characters: animal-crossing gibberish blips on reactions (voice.ts), per-agent voices; event foley (test pass/fail,
 *   error boing, commit capsule, sign-off stamp, subagent pops) positioned at the agent.
 * - Ambience (ambient.ts): zone room tone, Engine Room hum ∝ CPU, typing near the player, blocked mood undertone.
 * - Ambient life ('amb.*' bus): Segfault's purr loop / meow / hiss / paw landing, Bean's espresso pssht + ding + cup
 *   clink + robot "hi", Dusty's bonk-beep and crumb slurp, Ada's tiny "hi!", steam-vent hisses; all positional.
 * - M3.5 (walk up and manage): verb cues (pat squeak, summon whistle, high-five slap), the prompt paper-plane whoosh,
 *   an answered "thanks" blip + voice, spawn.sent hiring chime, hiring-crate clack/unwrap, blocked-lantern rise (with
 *   1 / 3 min escalations) and pop, the inbox-zero bell + fanfare, and the Help Desk bell that pans (HRTF) and grows
 *   louder with the oldest block's wait (mix.bellGain, capped).
 * - Per-category volumes + mute in settings (mixer.ts); silent until the first user gesture; `?noaudio` = nothing.
 * Owner: AUD.
 */
import type * as THREE from 'three';
import type { Entity, EventMsg, Status } from '../../../shared/protocol.ts';
import { createEngine, type CaptureResult, type PlayOpts, type Vec3 } from './engine.ts';
import { createAmbient, type AmbientActor } from './ambient.ts';
import { voiceProfile, phrasePlan, speak, PHRASES, type Syllable, type VoiceProfile } from './voice.ts';
import {
  createLimiter, categoryGain, masterGain, occlusion, bellGain, lanternLevel, CATEGORY_NAMES, DEFAULT_LEVELS, SILENT_REACTIONS,
  type SettingGet,
} from './mix.ts';
import { SURFACE_GAIN } from './synth.ts';
import { createMixer } from './mixer.ts';
import { hqStatSection } from '../core/debug.ts';
import type { Bus, WorldPos } from '../core/bus.ts';
import type { Settings } from '../core/settings.ts';
import type { Params } from '../core/params.ts';
import type { Layout, HqPoints } from '../world/layout/schema.ts';

const VOICE_R = 16; // m: reactions farther than this stay silent
const VOICE_COOLDOWN = 0.9; // s per agent
const COLD_S = 3; // s after a `world`: cold-start dissolves / waves stay silent

/** What the audio director needs from a character actor (chars/actors owns the real type). */
export interface AudioActor extends AmbientActor {
  entity?: Pick<Entity, 'status' | 'seedKey' | 'kind'> | null;
  brain?: { state?: { chattingWith?: string | null } };
}
/** The actor registry as audio reads it. */
export interface AudioActors {
  get(id: string): AudioActor | null | undefined;
  list(): Iterable<AudioActor>;
}
/** The slice of the renderer store audio subscribes to (net/store owns the real one). */
export interface AudioStore {
  entities: Map<string, Pick<Entity, 'id' | 'status' | 'statusSince'>>;
  on(evt: 'world', fn: () => void): () => void;
  on(evt: 'entity', fn: (e: Pick<Entity, 'id' | 'status'>) => void): () => void;
  on(evt: 'gone', fn: (m: { id: string }) => void): () => void;
  on(evt: 'event', fn: (ev: EventMsg) => void): () => void;
  now?(): number;
  stats?: { cpu?: { total?: number } | null } | null;
}
/** The §8.1 ctx fields audio reads. */
export interface AudioCtx {
  bus: Bus;
  store: AudioStore;
  settings: Settings;
  layout: Layout;
  params?: Pick<Params, 'noaudio'> | null;
  player?: { pos: { x: number; y?: number; z: number } } | null;
  /** the ambient cast (world/ambient): live parts by name */
  ambient?: { parts?: Record<string, { pos?: WorldPos | null } | undefined> } | null;
}
/** Per-frame ctx fields (`update(ctx)`). */
export interface AudioFrameCtx {
  dt: number;
  rawDt?: number;
  camera: THREE.Object3D;
  camZone: string | null;
  hidden?: boolean;
  hour?: number;
  player?: { pos: { x: number; y?: number; z: number } } | null;
}

export interface Audio {
  /** frame step (after fx/ui): listener pose + ambience */
  update(ctx: AudioFrameCtx): void;
  /** actors tap: a reaction just started */
  react(actor: AudioActor | null | undefined, reaction: string | null | undefined): void;
  openMixer(): void;
  toggleMute(): void;
  unlocked(): boolean;
  state(): Record<string, unknown>;
  dispose(): void;
}

/** `window.__hqAudio`: debug/verification handle (not a §9.1 pluggable: AUD owns only src/audio). */
export interface HqAudioDebug {
  state(): Record<string, unknown>;
  openMixer(): void;
  preview(demo: string): void;
  play(name: string, o?: PlayOpts): boolean;
  say(id: string, r: string): void;
  meter(): { rms: number; peak: number };
  bank(): string[];
  capture(sec?: number): Promise<CaptureResult | null>;
  emit(topic: string, payload?: unknown): void;
  cast(): Record<string, Vec3 | null>;
  probe(name: string, o?: PlayOpts, sec?: number): Promise<{ name: string; ok: boolean } & Partial<CaptureResult>>;
}
declare global {
  interface Window { __hqAudio?: HqAudioDebug }
}

/** Layout points hq adds over the proto core (`bell`); proto layouts have none, so it may be absent. */
const bellPoint = (layout: Layout): Vec3 | undefined => (layout.points as Partial<HqPoints> | undefined)?.bell;

const NOOP = (): Audio => ({
  update() {}, react() {}, openMixer() {}, toggleMute() {}, unlocked: () => false, state: () => ({ disabled: true }), dispose() {},
});

export function createAudio(ctx: AudioCtx, { actors, uiRoot }: { actors: AudioActors; uiRoot?: HTMLElement }): Audio {
  if (ctx.params?.noaudio) return NOOP();
  const { bus, store, settings, layout } = ctx;
  const eng = createEngine();
  let amb: ReturnType<typeof createAmbient> | null = null;
  let unlockedFlag = false;
  const limiter = createLimiter();
  const prevStatus = new Map<string, Status>();
  let blockedCount = 0;
  let worldAt = -1e9; // performance.now() of the last `world`
  const lastVoice = new Map<string, number>();
  const lastStamp = new Map<string, number>(); // id → performance.now() of a UI sign-off stamp
  let voiceSeq = 0;
  const profiles = new Map<string, VoiceProfile>();
  const offs: (() => void)[] = [];
  const stats = { notifications: 0, voices: 0, steps: 0, updMs: 0, updMax: 0, oldestBlockedS: 0 };

  // ---- gesture unlock ------------------------------------------------------------------------------------------------
  const gesture = () => {
    if (!eng.unlock()) return;
    if (eng.running || eng.ac) {
      unlockedFlag = true;
      applyLevels();
      removeEventListener('pointerdown', gesture, true);
      removeEventListener('keydown', gesture, true);
      removeEventListener('touchstart', gesture, true);
    }
  };
  addEventListener('pointerdown', gesture, true);
  addEventListener('keydown', gesture, true);
  addEventListener('touchstart', gesture, true);
  eng.onReady(() => { amb = createAmbient(eng, { layout }); });

  // ---- levels ---------------------------------------------------------------------------------------------------------
  const get: SettingGet = (k) => settings?.get?.(k);
  function applyLevels() {
    if (!eng.ac) return;
    eng.setMaster(masterGain(get, unlockedFlag));
    for (const c of CATEGORY_NAMES) eng.setCat(c, categoryGain(get, c) * (c === 'ambient' && document.hidden ? 0.35 : 1));
  }
  if (settings?.onChange) offs.push(settings.onChange((ch) => { if (Object.keys(ch).some((k) => k.startsWith('volume') || k === 'audioMuted')) applyLevels(); }));
  const onVis = () => applyLevels();
  document.addEventListener('visibilitychange', onVis);

  // ---- helpers --------------------------------------------------------------------------------------------------------
  const zoneOf = (p: { x: number; z: number }, level = 0): string | null => layout?.zoneAt?.(p.x, p.z, level) ?? null;
  /** Realise a phrase on a reserved voice slot and release the slot when it ends (`delay` = seconds from now). */
  function speakSlot(slot: NonNullable<ReturnType<typeof eng.voiceSlot>>, plan: Syllable[], prof: VoiceProfile, o: { breathy?: boolean; delay?: number } = {}) {
    const ac = eng.ac;
    if (!ac) return; // a slot only exists while the context is running
    slot.release(speak(ac, slot.node, plan, prof, {
      noise: eng.bank.get('white'), breathy: o.breathy, when: o.delay === undefined ? undefined : ac.currentTime + o.delay,
    }));
  }
  /** Head-height position + zone of an agent, or null when it has no actor (yet). */
  function agentAt(id: string | undefined) {
    if (id === undefined) return null;
    const a = actors?.get?.(id);
    if (!a) return null;
    return { pos: { x: a.pos.x, y: (a.pos.y ?? 0) + 0.9, z: a.pos.z }, zone: zoneOf(a.pos, a.level ?? 0), actor: a };
  }
  const listenerDist = (p: { x: number; z: number }) => { const L = ctx.player?.pos; return L ? Math.hypot(p.x - L.x, p.z - L.z) : 0; };

  function notifyBlocked(id: string) {
    const lim = limiter.check(id, 'blocked', performance.now());
    if (!lim.play) return;
    stats.notifications++;
    if (lim.global) eng.play('blocked', { cat: 'notify', gain: 0.55, rev: 0.12 });
    const at = agentAt(id);
    if (at) eng.play('bell', { cat: 'notify', gain: 0.9, pos: at.pos, zone: at.zone, hrtf: true, ref: 4, when: (eng.ac?.currentTime ?? 0) + (lim.global ? 0.75 : 0) });
  }
  function notifyDone(id: string) {
    const lim = limiter.check(id, 'done', performance.now());
    if (!lim.play) return;
    stats.notifications++;
    if (lim.global) eng.play('done', { cat: 'notify', gain: 0.5, rate: 1 + ((hashId(id) % 5) - 2) * 0.03, rev: 0.18 });
  }
  const hashId = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };

  /** Event foley at the agent (positional, sfx bus). */
  function foleyAt(id: string | undefined, name: string, gain = 0.7, o: PlayOpts & { dy?: number } = {}) {
    const at = agentAt(id);
    if (!at || listenerDist(at.pos) > 30) return;
    const pos = o.dy ? { ...at.pos, y: at.pos.y + o.dy } : at.pos;
    eng.play(name, { cat: 'sfx', gain: gain * 1.8, pos, zone: at.zone, ref: 4, ...o });
  }

  // ---- M3.5 cues: blocked lanterns, inbox zero, hiring crates ----------------------------------------------------------
  /** id → lantern escalation level already voiced (FX draws the lantern; we derive the same moments from the store). */
  const lanterns = new Map<string, number>();
  let fxLanterns = false, brnCrates = false; // set once FX / BRN emit their own `fx.lantern` / `crate` topics
  let lastInboxZero = -1e9;
  function lanternRise(id: string, level: number, delay = 0) {
    lanterns.set(id, level);
    // [INT M3.5 cross-owner] FX's `fx.lantern {ev:'rise'}` fires when its lantern appears (60 s = level 1): that one
    // cue follows FX; the onset (0) and 3-min (2) escalations and the pop stay store-derived (FX has no events for them)
    if (fxLanterns && level === 1) return;
    foleyAt(id, `lantern:rise:${level}`, 0.45 + level * 0.08, { when: (eng.ac?.currentTime ?? 0) + delay, dy: 0.9 });
  }
  function lanternPop(id: string) {
    lanterns.delete(id);
    foleyAt(id, 'lantern:pop', 0.5, { dy: 0.9 }); // [INT M3.5] always store-derived (FX pop/deflate are ignored below)
  }
  function inboxZero(delay = 0) {
    const now = performance.now();
    if (now - lastInboxZero < 20_000) return;
    lastInboxZero = now;
    const t = (eng.ac?.currentTime ?? 0) + delay;
    eng.play('inboxZero', { cat: 'notify', gain: 0.5, rev: 0.22, when: t });
    const bell = bellPoint(layout);
    if (bell && listenerDist(bell) < 30) eng.play('bell', { cat: 'notify', gain: 0.4, pos: bell, zone: zoneOf(bell), ref: 3, hrtf: true, when: t });
  }
  /** A hiring crate lands (`land`) → the new hire unwraps (`unwrap`, auto-follows a land by `unwrapAfter` s). */
  function crateAt(id: string | undefined, phase: 'land' | 'unwrap', unwrapAfter = 0, pos: WorldPos | null = null) {
    const t = eng.ac?.currentTime ?? 0;
    const at = pos ? { pos: { x: pos.x, y: (pos.y ?? 0) + 0.3, z: pos.z }, zone: zoneOf(pos) } : agentAt(id);
    if (!at || listenerDist(at.pos) > 30) return;
    const o: PlayOpts = { cat: 'sfx', pos: at.pos, zone: at.zone, ref: 3 };
    if (phase === 'land') eng.play('crate:clack', { ...o, gain: 0.9 });
    if (phase === 'unwrap' || unwrapAfter > 0) eng.play('crate:unwrap', { ...o, gain: 0.9, when: t + (phase === 'unwrap' ? 0 : unwrapAfter) });
  }

  // ---- store: events + status transitions (fire while hidden) -----------------------------------------------------------
  const recount = () => {
    let n = 0;
    for (const e of store.entities.values()) if (e.status === 'blocked') n++;
    const was = blockedCount;
    blockedCount = n;
    return was;
  };
  offs.push(store.on('world', () => {
    worldAt = performance.now();
    prevStatus.clear();
    for (const e of store.entities.values()) prevStatus.set(e.id, e.status);
    recount();
  }));
  offs.push(store.on('entity', (e) => {
    const was = prevStatus.get(e.id);
    prevStatus.set(e.id, e.status);
    const before = recount();
    if (was && was !== e.status) {
      if (e.status === 'blocked') { notifyBlocked(e.id); lanternRise(e.id, 0, 1.1); }
      else if (e.status === 'done') notifyDone(e.id);
      if (was === 'blocked') lanternPop(e.id);
    }
    // the store-derived inbox zero (UI's `inbox.zero` bus topic, when it fires, lands on the same dedupe)
    if (before > 0 && blockedCount === 0 && performance.now() - worldAt > 5000) inboxZero(0.25);
  }));
  offs.push(store.on('gone', (m) => { prevStatus.delete(m.id); limiter.forget(m.id); lanterns.delete(m.id); recount(); }));
  offs.push(store.on('event', (ev) => {
    if (!ev?.id) return;
    switch (ev.kind) {
      case 'blocked': notifyBlocked(ev.id); break;
      case 'finished': notifyDone(ev.id); break;
      case 'test-pass': foleyAt(ev.id, 'testPass', 0.5); break;
      case 'test-fail': foleyAt(ev.id, 'testFail', 0.6); break;
      case 'error': foleyAt(ev.id, 'error', 0.6); break;
      case 'commit': foleyAt(ev.id, 'commit', 0.7); break;
      case 'acked': if (performance.now() - (lastStamp.get(ev.id) ?? -1e9) > 4000) foleyAt(ev.id, 'stamp', 0.7); break;
      case 'subagent-spawned': foleyAt(ev.id, `pop:${hashId(ev.id) & 3}`, 0.5); break;
      case 'subagent-done': foleyAt(ev.id, `pop:${(hashId(ev.id) + 2) & 3}`, 0.4, { rate: 0.8 }); break;
      case 'compact': foleyAt(ev.id, 'pop:0', 0.4, { rate: 0.55 }); break;
      case 'unblocked': foleyAt(ev.id, 'boop', 0.5); break;
      case 'arrived': if (!brnCrates && performance.now() - worldAt > COLD_S * 1000) crateAt(ev.id, 'land', 1.2); break;
      default:
    }
  }));

  // ---- bus: player feel (§6.10) ---------------------------------------------------------------------------------------
  let stepVar = 0;
  offs.push(bus.on('player.step', (e) => {
    const surface = e?.surface ?? 'floor';
    const sp = e?.speed ?? 3.6;
    stepVar = (stepVar + 1 + Math.floor(Math.random() * 3)) & 3;
    const k = eng.bank.has(`step:${surface}:0`) ? surface : 'floor';
    stats.steps++;
    eng.play(`step:${k}:${stepVar}`, {
      cat: 'sfx', gain: (SURFACE_GAIN[k] ?? 0.8) * (0.32 + Math.min(0.2, sp * 0.035)),
      rate: (e?.foot === 'left' ? 0.96 : 1.02) * (0.97 + Math.random() * 0.06),
    });
  }));
  offs.push(bus.on('player.land', (e) => {
    const v = Math.min(8, e?.v ?? 3);
    const k = eng.bank.has(`land:${e?.surface}`) ? e.surface : 'floor';
    eng.play(`land:${k}`, { cat: 'sfx', gain: 0.3 + v * 0.07, rate: 0.95 + Math.random() * 0.08 });
  }));
  offs.push(bus.on('player.slide', (e) => {
    if (e?.phase !== 'start') return;
    eng.play('whoosh', { cat: 'sfx', gain: 0.55, rev: 0.3 });
    eng.play('squeak', { cat: 'sfx', gain: 0.25, when: (eng.ac?.currentTime ?? 0) + 1.1, rate: 1.1 });
    // the player's own "wheee!" (a bright, fixed voice)
    const slot = eng.voiceSlot({ cat: 'voices', gain: 0.8, rev: 0.3 });
    if (slot) {
      const prof = { robot: false, base: 560, speed: 1, bright: 0.8, vowelShift: 1.05 };
      const plan = phrasePlan('whee', prof, voiceSeq++);
      if (plan) speakSlot(slot, plan, prof, { delay: 0.18 });
    }
  }));
  // UI moments: sign-off stamp right on the click (the server's `acked` event then stays quiet), go-to glide swish
  offs.push(bus.on('signoff', (e) => { if (!e?.id) return; lastStamp.set(e.id, performance.now()); foleyAt(e.id, 'stamp', 0.7); }));
  offs.push(bus.on('cam.glide', () => eng.play('swish', { cat: 'sfx', gain: 0.35 })));
  offs.push(bus.on('player.sit', () => eng.play('sit', { cat: 'sfx', gain: 0.5 })));
  offs.push(bus.on('player.stand', () => eng.play('boop', { cat: 'sfx', gain: 0.3 })));

  // ---- M3.5 bus topics (§3 "M3.5 contract": UI emits; BRN/CHR/FX draw, AUD sounds) --------------------------------------
  offs.push(bus.on('verb', (e) => {
    switch (e?.verb) {
      case 'pat': foleyAt(e.id, 'squeak:pat', 0.55); break; // soft pats + a happy rubber squeak at the agent
      case 'summon': eng.play('whistle', { cat: 'sfx', gain: 0.5, rev: 0.25 }); break; // your own whistle: in-head
      case 'highFive': foleyAt(e.id, 'slap', 0.6, { when: (eng.ac?.currentTime ?? 0) + 0.35 }); break; // hands meet
      default: // 'prompt' opens the bar; the plane sounds on `prompt.sent`
    }
  }));
  offs.push(bus.on('prompt.sent', (e) => {
    eng.play('whoosh:plane', { cat: 'sfx', gain: 0.55, rev: 0.2 }); // the throw, from your hand
    foleyAt(e?.id, 'pop:1', 0.3, { when: (eng.ac?.currentTime ?? 0) + 0.8, rate: 0.7 }); // the plane lands on the desk
  }));
  offs.push(bus.on('answered', (e) => {
    if (!e?.id) return;
    foleyAt(e.id, 'thanks', 0.5);
    const a = actors?.get?.(e.id);
    if (a && eng.running) setTimeout(() => speakAs(a, 'thankYou', 0.75), 250); // "thanks!" in its own voice
  }));
  offs.push(bus.on('inbox.zero', () => inboxZero(0.15)));
  offs.push(bus.on('spawn.sent', () => eng.play('spawn', { cat: 'notify', gain: 0.4, rev: 0.2 })));
  // proposed topics (summary): FX `fx.lantern {id, level, phase:'rise'|'pop'}`, BRN/CHR `crate {id, phase:'land'|'unwrap', pos?}`.
  // The first one seen switches the store-derived fallback off, so a moment never sounds twice.
  offs.push(bus.on('fx.lantern', (e) => {
    if (!e?.id) return;
    // [INT M3.5 cross-owner] FX ships `{ev:'rise'|'pop'|'deflate', id}` (no level): before this, pop/deflate played a
    // rise. Only FX's rise is voiced here (as level 1); pops come from the store transition, so nothing sounds twice.
    // (FX's real payload has only `ev`; the proposed `phase` / `level` are still honoured when present)
    const x: { ev?: string; phase?: string; level?: number } = e;
    const ph = x.phase ?? x.ev;
    fxLanterns = true;
    if (ph !== 'rise') return;
    const lv = x.level !== undefined && Number.isFinite(x.level) ? Math.min(2, Math.max(0, x.level | 0)) : 1;
    foleyAt(e.id, `lantern:rise:${lv}`, 0.45 + lv * 0.08, { dy: 0.9 });
  }));
  offs.push(bus.on('crate', (e) => { if (!e?.phase) return; brnCrates = true; crateAt(e.id, e.phase, 0, e.pos ?? null); }));

  // ---- ambient life (m2 r3): the cat, Bean, Dusty the roomba, Ada, steam vents → positional synth cues ---------------------
  const AMB_R = 22; // m: ambient cues beyond this stay silent
  const ambStats: Record<string, number> = {};
  /** Where an ambient cast member is: the event's pos, else the live part (ctx.ambient.parts[who].pos). */
  const castPos = (who: string, pos: WorldPos | null | undefined): WorldPos | null => pos ?? ctx.ambient?.parts?.[who]?.pos ?? null;
  /** One positional ambient one-shot (sfx bus), culled by distance / hidden tab. */
  function ambAt(key: string, p: WorldPos | null | undefined, name: string, gain: number, o: { dy?: number; ref?: number; rate?: number; when?: number; rev?: number } = {}) {
    if (!p || !eng.running || document.hidden || listenerDist(p) > AMB_R) return false;
    const pos = { x: p.x, y: (p.y ?? 0) + (o.dy ?? 0.2), z: p.z };
    const ok = !!eng.play(name, { cat: 'sfx', gain, pos, zone: zoneOf(p), ref: o.ref ?? 2.5, rate: o.rate, when: o.when, rev: o.rev });
    if (ok) ambStats[key] = (ambStats[key] ?? 0) + 1;
    return ok;
  }
  /** A tiny spoken "hi!" from a non-agent (Ada: a bright Clawd voice; Bean: a bleepy robot). */
  const AMB_VOICES: Record<'ada' | 'bean', VoiceProfile> = { ada: { robot: false, base: 640, speed: 1.1, bright: 0.75, vowelShift: 1.06 }, bean: voiceProfile('bean', 'shell') };
  function ambSay(key: string, who: 'ada' | 'bean', p: WorldPos | null | undefined, r = 'hi') {
    if (!p || !eng.running || document.hidden || listenerDist(p) > VOICE_R) return false;
    const prof = AMB_VOICES[who];
    const plan = phrasePlan(r, prof, voiceSeq++);
    const slot = plan && eng.voiceSlot({ cat: 'voices', gain: 0.85, pos: { x: p.x, y: (p.y ?? 0) + (who === 'ada' ? 1.1 : 0.3), z: p.z }, zone: zoneOf(p), ref: 2.4, rev: eng.roomRev * 0.7 });
    if (!slot) return false;
    speakSlot(slot, plan, prof);
    ambStats[key] = (ambStats[key] ?? 0) + 1;
    return true;
  }
  // Segfault's purr is a live loop (one source + gain + panner, made on the first purr): each 'purr' event keeps it
  // going for ~1.8 s, the gain glides in/out, the panner follows the cat every frame.
  let purr: { src: AudioBufferSourceNode; g: GainNode; p: PannerNode; occ: BiquadFilterNode; occG: GainNode; until: number; on: boolean } | null = null;
  function purrPing(p: WorldPos | null) {
    const ac = eng.ac;
    if (!eng.running || !p || !ac) return;
    if (!purr) {
      const buf = eng.bank.get('purr');
      if (!buf) return;
      const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
      const g = ac.createGain(); g.gain.value = 0;
      const pn = ac.createPanner(); pn.panningModel = 'equalpower'; pn.distanceModel = 'inverse'; pn.refDistance = 1.2; pn.rolloffFactor = 1.3; pn.maxDistance = 30;
      const occ = ac.createBiquadFilter(); occ.type = 'lowpass'; occ.frequency.value = 20000;
      const occG = ac.createGain(); occG.gain.value = 1;
      src.connect(g).connect(pn).connect(occ).connect(occG).connect(eng.cats.sfx);
      src.start();
      purr = { src, g, p: pn, occ, occG, until: 0, on: false };
    }
    eng.setPos(purr.p, { x: p.x, y: (p.y ?? 0) + 0.15, z: p.z });
    purr.until = ac.currentTime + 1.8; // events arrive ~1.5/s at random: bridge the gaps
  }
  function purrUpdate() {
    const ac = eng.ac;
    if (!purr || !ac) return;
    const t = ac.currentTime;
    const p = ctx.ambient?.parts?.cat?.pos;
    const want = t < purr.until && !document.hidden && (!p || listenerDist(p) < AMB_R);
    if (want && p) {
      eng.setPos(purr.p, { x: p.x, y: (p.y ?? 0) + 0.15, z: p.z });
      const occ = occlusion(eng.listenerZone, zoneOf(p));
      purr.occ.frequency.setTargetAtTime(occ.lp, t, 0.1); purr.occG.gain.setTargetAtTime(occ.gain, t, 0.1);
    }
    if (want !== purr.on) {
      purr.on = want;
      purr.g.gain.setTargetAtTime(want ? 1.1 : 0, t, want ? 0.12 : 0.35);
      if (want) { ambStats.purr = (ambStats.purr ?? 0) + 1; eng.counters.byName.purr = (eng.counters.byName.purr ?? 0) + 1; }
    }
  }
  let meowVar = 0;
  offs.push(bus.on('amb.cat', (e) => {
    const p = castPos('cat', e.pos);
    switch (e?.ev) {
      case 'purr': purrPing(p); break;
      case 'meow': ambAt('meow', p, meowVar ? `meow:${meowVar}` : 'meow', 0.55, { rate: 0.97 + Math.random() * 0.08 }); meowVar = (meowVar + 1) % 3; break;
      case 'startle': ambAt('catHiss', p, 'catHiss', 0.6); break;
      case 'land': ambAt('catLand', p, 'catLand', 0.5, { dy: 0 }); break;
      default:
    }
  }));
  offs.push(bus.on('amb.bean', (e) => {
    const p = castPos('barista', e.pos);
    switch (e?.ev) {
      case 'pssht': ambAt('pssht', p, 'pssht', 0.55, { rate: 0.95 + Math.random() * 0.1 }); break;
      case 'ding': ambAt('ding', p, 'ding', 0.45, { rev: 0.25 }); break;
      case 'serve': ambAt('serve', p, 'serve', 0.5); break;
      case 'hello': ambSay('beanHello', 'bean', p); break;
      default:
    }
  }));
  offs.push(bus.on('amb.steam', (e) => { if (e?.ev === 'pssht') ambAt('steam', e.pos, 'pssht:1', 0.42, { dy: 0, rate: 1.05 + Math.random() * 0.1 }); }));
  offs.push(bus.on('amb.roomba', (e) => {
    const p = castPos('roomba', undefined); // the roomba's events carry no pos
    if (e?.ev === 'bump') ambAt('bonk', p, 'bonk', 0.8, { dy: 0.1, rate: 0.97 + Math.random() * 0.06 });
    else if (e?.ev === 'crumbs') ambAt('crumbs', p, 'crumbs', 0.6, { dy: 0.1 });
  }));
  offs.push(bus.on('amb.ada', (e) => { if (e?.ev === 'greet') ambSay('adaHi', 'ada', castPos('ada', undefined)); }));

  // ---- reactions → voices ---------------------------------------------------------------------------------------------
  function react(a: AudioActor | null | undefined, r: string | null | undefined) {
    if (!a || !r || !eng.running) return;
    if (r === 'bellTap') { // the queued agent taps the Help Desk bell (GP §5.4: the ding repeats every 20 s there)
      const bell = bellPoint(layout);
      const p = bell && Math.hypot(bell.x - a.pos.x, bell.z - a.pos.z) < 4 ? bell : { x: a.pos.x, y: (a.pos.y ?? 0) + 1, z: a.pos.z };
      // spatial (HRTF) and louder the longer the OLDEST block has waited (mix.bellGain, capped)
      if (listenerDist(p) < 30) eng.play('bell', { cat: 'notify', gain: bellGain(oldestBlockedS), pos: p, zone: zoneOf(p), ref: 3, hrtf: true });
      return;
    }
    if (SILENT_REACTIONS.has(r) || !PHRASES[r]) return;
    if (performance.now() - worldAt < COLD_S * 1000) return;
    speakAs(a, r);
  }
  /** One gibberish phrase from actor `a` (positional, per-agent voice, cooldown + distance culled). */
  function speakAs(a: AudioActor, r: string, gain = 0.7) {
    const ac = eng.ac;
    if (!ac) return false;
    const t = ac.currentTime;
    if (t - (lastVoice.get(a.id) ?? -1e9) < VOICE_COOLDOWN) return false;
    const pos = { x: a.pos.x, y: (a.pos.y ?? 0) + 0.8, z: a.pos.z };
    if (listenerDist(pos) > VOICE_R || document.hidden) return false;
    const e = a.entity;
    const key = e?.seedKey ?? a.id;
    let prof = profiles.get(key);
    if (!prof) { prof = voiceProfile(key, e?.kind); profiles.set(key, prof); }
    const plan = phrasePlan(r, prof, voiceSeq++);
    if (!plan) return false;
    const slot = eng.voiceSlot({ cat: 'voices', gain, pos, zone: zoneOf(a.pos, a.level ?? 0), ref: 2.2, rev: eng.roomRev * 0.7 });
    if (!slot) return false;
    lastVoice.set(a.id, t);
    stats.voices++;
    speakSlot(slot, plan, prof, { breathy: !!PHRASES[r].breathy });
    return true;
  }

  // ---- idle chatting pairs babble at each other (alternating turns) --------------------------------------------------------
  /** pair key → next line time */
  const chats = new Map<string, { next: number; turn: number }>();
  let chatScan = 0;
  function updateChats(dt: number) {
    chatScan += dt;
    const ac = eng.ac;
    if (chatScan < 0.25 || !actors?.list || !ac) return;
    chatScan = 0;
    const now = ac.currentTime;
    const P = ctx.player?.pos;
    if (!P) return;
    const seen = new Set<string>();
    for (const a of actors.list()) {
      const other = a.brain?.state?.chattingWith;
      if (!other || a.id > other) continue; // one entry per pair
      const b = actors.get(other);
      if (!b || Math.hypot(a.pos.x - P.x, a.pos.z - P.z) > 10) continue;
      const key = `${a.id}|${other}`;
      seen.add(key);
      let c = chats.get(key);
      if (!c) { c = { next: now + 0.4 + Math.random() * 0.8, turn: Math.random() < 0.5 ? 0 : 1 }; chats.set(key, c); }
      if (now < c.next) continue;
      const who = c.turn ? b : a;
      c.turn ^= 1;
      c.next = now + 1.1 + Math.random() * 1.8;
      speakAs(who, 'chat', 0.55);
    }
    for (const k of chats.keys()) if (!seen.has(k)) chats.delete(k);
  }

  // ---- mixer / debug --------------------------------------------------------------------------------------------------
  const levels = (): Record<string, number> => Object.fromEntries((Object.keys(DEFAULT_LEVELS) as (keyof typeof DEFAULT_LEVELS)[]).map((k) => {
    const v = get(k);
    return [k, typeof v === 'number' ? v : DEFAULT_LEVELS[k]];
  }));
  function preview(demo: string) {
    gesture();
    const t = () => (eng.ac?.currentTime ?? 0);
    if (demo === 'done') eng.play('done', { cat: 'notify', gain: 0.5 });
    else if (demo === 'blocked') { eng.play('blocked', { cat: 'notify', gain: 0.55 }); eng.play('bell', { cat: 'notify', gain: 0.8, when: t() + 0.75 }); }
    else if (demo === 'step') for (let i = 0; i < 4; i++) eng.play(`step:tile:${i}`, { cat: 'sfx', gain: 0.45, when: t() + i * 0.26 });
    else if (demo === 'voice') {
      const slot = eng.voiceSlot({ cat: 'voices', gain: 0.8 });
      const prof = voiceProfile(`preview${voiceSeq % 7}`);
      const plan = phrasePlan(['victory', 'wave', 'thankYou', 'bump'][voiceSeq % 4], prof, voiceSeq++);
      if (slot && plan) speakSlot(slot, plan, prof);
    }
  }
  const mixer = uiRoot ? createMixer({ root: uiRoot, settings, preview, isUnlocked: () => unlockedFlag, levels }) : null;

  const state = () => ({
    unlocked: unlockedFlag, ctx: eng.ac?.state ?? 'none', sampleRate: eng.ac?.sampleRate ?? 0,
    master: masterGain(get, unlockedFlag), active: { ...eng.active }, ...eng.counters, ...stats,
    ambient: amb ? { ...amb.state } : null, meter: eng.meter(), blocked: blockedCount, life: { ...ambStats, purring: !!purr?.on },
  });
  hqStatSection('audio', state);
  // debug/verification handle (not a §9.1 pluggable: AUD owns only src/audio)
  if (typeof window !== 'undefined') {
    window.__hqAudio = {
      state, openMixer: () => mixer?.open(), preview,
      play: (name, o) => !!eng.play(name, o), say: (id, r) => react(actors?.get?.(id), r),
      meter: () => eng.meter(), bank: () => eng.bank.keys(), capture: (sec) => eng.capture(sec),
      // verification tours: fire a bus topic (M3.5 cues before their emitters land): the topic is free-form here, so the
      // typed bus is reached through the one cast below
      emit: (topic, payload) => (bus.emit as (topic: string, payload?: unknown) => void)(topic, payload),
      // read the ambient cast's positions
      cast: () => Object.fromEntries(Object.entries(ctx.ambient?.parts ?? {}).map(([k, v]) => [k, v?.pos ? { x: v.pos.x, y: v.pos.y ?? 0, z: v.pos.z } : null])),
      // play `name` and capture its loudness (verification)
      probe: async (name, o = {}, sec = 1) => { const c = eng.capture(sec); const ok = !!eng.play(name, o); return { name, ok, ...(await c) }; },
    };
  }

  /** 1 Hz: the oldest block's wait (Help Desk bell loudness) + lantern escalation (1 / 3 min, mix.LANTERN_STEPS). */
  let oldestBlockedS = 0, blockScan = 0;
  function scanBlocked(dt: number | undefined) {
    blockScan += dt || 0;
    if (blockScan < 1) return;
    blockScan = 0;
    const now = store.now?.() ?? Date.now();
    let oldest = 0;
    for (const e of store.entities.values()) {
      if (e.status !== 'blocked') continue;
      const w = Math.max(0, (now - (e.statusSince ?? now)) / 1000);
      oldest = Math.max(oldest, w);
      const lvl = lanternLevel(w), had = lanterns.get(e.id);
      if (had === undefined) lanterns.set(e.id, lvl); // blocked before we looked (world snapshot): no retro cue
      else if (lvl > had) lanternRise(e.id, lvl);
    }
    oldestBlockedS = oldest;
    stats.oldestBlockedS = Math.round(oldest);
  }

  let lastLevelsHidden = document.hidden;
  return {
    update(c: AudioFrameCtx) {
      if (!eng.ac) return;
      const t0 = performance.now();
      scanBlocked(c.rawDt ?? c.dt);
      eng.setListener(c.camera, c.camZone);
      if (document.hidden !== lastLevelsHidden) { lastLevelsHidden = document.hidden; applyLevels(); }
      if (!c.hidden) updateChats(c.rawDt ?? c.dt);
      purrUpdate();
      amb?.update({
        dt: c.rawDt ?? c.dt, camZone: c.camZone, hour: c.hour ?? 12, player: c.player, actors,
        cpu: store.stats?.cpu?.total ?? null, blocked: blockedCount, hidden: !!c.hidden, reduced: false,
      });
      const ms = performance.now() - t0;
      stats.updMs = stats.updMs * 0.95 + ms * 0.05; stats.updMax = Math.max(stats.updMax * 0.999, ms);
    },
    react,
    openMixer: () => mixer?.open(),
    toggleMute: () => settings.set({ audioMuted: !(get('audioMuted') === true) }),
    unlocked: () => unlockedFlag,
    state,
    dispose() {
      for (const f of offs) f?.();
      document.removeEventListener('visibilitychange', onVis);
      removeEventListener('pointerdown', gesture, true); removeEventListener('keydown', gesture, true); removeEventListener('touchstart', gesture, true);
      try { purr?.src.stop(); } catch { /* not started */ }
      amb?.dispose(); mixer?.close(); eng.close();
    },
  };
}
