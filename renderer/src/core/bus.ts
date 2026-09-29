// @pure
/**
 * Tiny synchronous event bus shared by renderer modules via `ctx.bus` (§8.1).
 * `BusEvents` is the single registry of topics (an unknown topic is a type error); owners append theirs here.
 * Owner: CORE.
 */
import type { BumpEvent } from '../player/soft.ts';

/** Where a dive / glide / sit lands: the player's pose is `{x, y, z, yaw, pitch}`. */
export interface PosePayload { x: number; y: number; z: number; yaw: number; pitch: number }
/** A world point published by an ambient / FX owner (audio positions the sound there). */
export interface WorldPos { x: number; y?: number; z: number }
/** CSS-px rectangle `[x0, y0, x1, y1]` (screen obstacles for label declutter). */
export type ScreenRect = [number, number, number, number];

export interface BusEvents {
  // player (PLY)
  'player.step': { surface: string; speed: number; foot: 'left' | 'right' };
  'player.land': { v: number; surface: string };
  'player.sit': { slotId: string; tag: string; zone: string | null; x: number; z: number };
  'player.stand': { slotId: string };
  'player.slide': { phase: 'start' | 'exit'; x: number; z: number };
  'player.dive': { phase: 'start' | 'out' | 'end' | 'screen'; id: string; rect?: unknown; cancelled?: boolean };
  'player.manager': { on: boolean };
  'player.select': { id: string | null; via: string };
  'player.bump': BumpEvent;
  pose: PosePayload;
  // core / UI
  select: { id: string | null };
  quality: { tier: string; renderScale: number };
  drawer: { open: boolean; fullscreen: boolean; state?: string };
  viewStrip: { left: number; right: number };
  /** `outcome` is written by BRN's actors (synchronous bus): what the agent did in answer. */
  verb: { verb: string; id: string; outcome?: unknown };
  'prompt.sent': { id: string };
  answered: { id: string; key?: string };
  signoff: { id: string; via: string };
  notify: { kind: 'blocked' | 'done'; id: string; pos: WorldPos | null };
  onboarding: { done: boolean; skipped?: boolean };
  'spawn.sent': { paneId: string; kind: string };
  'inbox.zero': { answered: number; ms: number };
  'talk.open': { id: string };
  'talk.close': { id: string; sent: boolean };
  'cam.follow': { id: string | null };
  'cam.glide': { to: unknown; id: string | null; ms: number };
  aim: { id: string | null };
  'ws.hover': { id: string | null };
  'roster.hover': { id: string | null };
  'ui.obstacles': { key: string; rects: ScreenRect[]; ids?: string[]; serve?: boolean };
  /** UI asks FX for its per-frame "alert card placed" tests; the payload is the callback FX calls with them. */
  'fx.alertsQuery': (alertShown: (id: string) => boolean, more?: { alertEdge?: (id: string) => boolean }) => void;
  'away.recap': { minutes: number; lines: string[] };
  // world / FX / audio
  'stat.brew': { tps: number; steam: number };
  'stats.hotSpot': { x: number; y: number; z: number; tempC: number };
  'stats.weather': { heat: number; fog: number };
  crate: { id: string; phase: 'land' | 'unwrap'; pos: WorldPos | null };
  'crate.unwrap': { id: string; pos: WorldPos | null };
  'fx.lantern': { ev: 'pop' | 'deflate' | 'rise'; id: string };
  'amb.cat': { ev: 'purr' | 'meow' | 'land' | 'startle'; pos: WorldPos | null };
  'amb.ada': { ev: 'greet' };
  'amb.roomba': { ev: 'bump' | 'crumbs'; who?: string };
  'amb.steam': { ev: 'pssht'; pos: WorldPos | null };
  'amb.bean': { ev: 'pssht' | 'ding' | 'serve' | 'hello'; pos?: WorldPos | null; who?: string };
}

export interface Bus<E extends object = BusEvents> {
  /** returns an unsubscribe fn */
  on<K extends keyof E>(topic: K, fn: (payload: E[K]) => void): () => void;
  once<K extends keyof E>(topic: K, fn: (payload: E[K]) => void): () => void;
  off<K extends keyof E>(topic: K, fn: (payload: E[K]) => void): void;
  /** listener errors are caught and logged, never propagate */
  emit<K extends keyof E>(topic: K, payload: E[K]): void;
}

export function createBus<E extends object = BusEvents>(): Bus<E> {
  type Listener = (payload: E[keyof E]) => void;
  const topics = new Map<keyof E, Set<Listener>>();
  // The one cast: a listener for topic K is stored in the shared per-topic set, and only ever called with topic K's payload.
  const store = <K extends keyof E>(fn: (payload: E[K]) => void) => fn as Listener;
  const off: Bus<E>['off'] = (topic, fn) => { topics.get(topic)?.delete(store(fn)); };
  const on: Bus<E>['on'] = (topic, fn) => {
    let s = topics.get(topic);
    if (!s) topics.set(topic, (s = new Set()));
    s.add(store(fn));
    return () => off(topic, fn);
  };
  const once: Bus<E>['once'] = (topic, fn) => {
    const w = (p: E[typeof topic]) => { off(topic, w); fn(p); };
    return on(topic, w);
  };
  const emit: Bus<E>['emit'] = (topic, payload) => {
    const s = topics.get(topic);
    if (!s) return;
    for (const fn of [...s]) {
      try { fn(payload); } catch (e) { console.error(`[bus] ${String(topic)} listener threw`, e); }
    }
  };
  return { on, once, off, emit };
}
