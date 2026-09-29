/**
 * The shared per-frame context (§8.1). One object for the life of the page; `update` paths read it and never
 * allocate. Fields are filled in by main.ts at boot; `dt/time/now/frame` are rewritten by loop.ts each tick.
 * Owner: CORE.
 */

import type * as THREE from 'three';
import type { store } from '../net/store.ts';
import type { Bus } from './bus.ts';
import type { AnimClock } from './time.ts';
import type { Params } from './params.ts';
import type { Settings } from './settings.ts';
import type { DrawSplitFrame } from './drawSplit.ts';
import type { Player } from '../player/controller.ts';
import type { Quality } from '../render/quality.ts';
import type { Layout } from '../world/layout/schema.ts';
import type { createScreenFeed } from '../render/screenFeed.ts';
import type { createPortraits } from '../chars/render/portraits.ts';
import type { createDirector } from '../chars/brain/director.ts';
import type { createAmbient } from '../world/ambient/index.ts';
import type { createAudio } from '../audio/index.ts';

export interface Perf {
  /** EMA over ~1 s */
  fps: number;
  /** EMA of the wall frame interval (rAF delta) */
  frameMs: number;
  /** EMA of the time spent inside the frame callback */
  cpuMs: number;
  /** RND fills when a timer query exists */
  gpuMs: number | null;
  /** last frame, all passes (= draws.total) */
  drawCalls: number;
  /** last frame's §5.3 split (core/drawSplit.ts); null on pages without the split (debug sheets) */
  draws: DrawSplitFrame | null;
  triangles: number;
  /** frames whose callback threw (loop.ts), since boot */
  frameErrors: number;
}

export interface Ctx {
  /** scaled seconds (0 when frozen), ≤ 0.1 */
  dt: number;
  /** unscaled wall seconds, ≤ 0.25 (camera/player use this) */
  rawDt: number;
  /** scaled animation seconds since boot */
  time: number;
  /** server-clock ms (store.now()) sampled at frame start */
  now: number;
  /** frame counter */
  frame: number;
  /** tab hidden → 10 fps, no post (§5.2) */
  hidden: boolean;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  store: typeof store;
  /** player/controller.ts instance (set by main after createPlayer) */
  player: Player;
  /** zone id the camera is in (LVL vis; 'proto' in the M1 room) */
  camZone: string | null;
  /** vis cells visible from camZone (null = all) */
  visibleCells: Set<string> | null;
  perf: Perf;
  /** render/quality.ts instance */
  quality: Quality;
  bus: Bus;
  clock: AnimClock;
  params: Params;
  settings: Settings;
  /** world/layout/{proto,hq}.ts layout */
  layout: Layout;
  /** current time of day (pinned or wall clock) */
  hour: number;
  // Filled in by main.ts after createCtx (absent in the debug sheets / tests):
  screens?: ReturnType<typeof createScreenFeed>;
  worldArt?: string;
  portraits?: ReturnType<typeof createPortraits>;
  director?: ReturnType<typeof createDirector>;
  ambient?: ReturnType<typeof createAmbient>;
  audio?: ReturnType<typeof createAudio>;
  /** loop fps cap mirrored from the drawer (null = uncapped) */
  fpsCap?: number | null;
  /** ENV: greybox is asked to skip what the kit dresses (set only while building) */
  envSkip?: { arch: boolean; cells: Set<string>; types: Set<string> };
  /** ENV debug handle: `__hq.ctx.movingDay.trigger('E1', 'W1')` */
  movingDay?: unknown;
  /** UI: the desk the player last walked up to (RND monitorAtlas reads it) */
  walkUpId?: string | null;
}

/** `T` with every field additionally allowed to be `null` (optional fields stay optional). */
type Nullable<T> = { [K in keyof T]: T[K] | null };

/**
 * Builds the ctx from what the caller has. The fields main.ts fills in later (scene, camera, renderer, store, player,
 * quality, bus, clock, params, settings, layout) start as `null` placeholders exactly as before, so the returned `Ctx`
 * is only complete once the caller has supplied them: tests and the debug sheets pass a subset. `Nullable<Ctx>` types the
 * draft honestly (every field may still be `null`); the one `as Ctx` narrows it, which is the documented contract.
 */
export function createCtx(init: Partial<Ctx>): Ctx {
  const draft: Nullable<Ctx> = {
    dt: 0, rawDt: 0, time: 0, now: 0, frame: 0, hidden: false,
    scene: null, camera: null, renderer: null, store: null, player: null,
    camZone: null, visibleCells: null,
    perf: { fps: 0, frameMs: 0, cpuMs: 0, gpuMs: null, drawCalls: 0, draws: null, triangles: 0, frameErrors: 0 },
    quality: null, bus: null, clock: null, params: null, settings: null, layout: null, hour: 12,
    ...init,
  };
  return draft as Ctx;
}
