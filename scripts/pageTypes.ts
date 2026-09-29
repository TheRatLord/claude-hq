// Types for the renderer's debug surface as the browser-driving scripts (shoot, p2, perf, review-shots, walktimes,
// hqtest-realuse) see it. The scripts run in node and never import renderer code (they only evaluate strings/functions
// in the page), so this is a hand-kept mirror of the parts of `window.__hq` / `window.__hqUi` they touch, typed as
// loosely as the scripts use it (`unknown` where a script only prints or compares the value).
//
// Usage, in each script that passes functions to `page.evaluate`:
//   declare const window: PageWindow;     // module-local shadow of the DOM global: `window.__hq.x` is typed, no casts
// Erasable (type-only), so node strips it. Functions given to `page.evaluate` are serialised: they must not close over
// anything but their argument, and the value they return must be JSON-like.

import type { ClientMsgOf, Entity, Hello, Settings } from '../shared/protocol.ts';
import type { Wall } from '../renderer/src/world/layout/schema.ts';

/** world x, y, z */
export type Vec3 = [number, number, number];
/** world x, y, z, yaw, pitch (y = feet) */
export type Pose5 = [number, number, number, number, number];

/** §5.3 draw split (renderer/src/core/drawSplit.ts). */
export interface DrawCalls { main: number; shadow: number; portrait: number; portraits?: number; post: number; prepass?: number; total: number }
export interface Programs { scene: number; post: number; total: number }
/** §5.3 main-pass triangle split (env + chars + stat), plus the shadow and prepass passes. */
export interface TriSplit { main: number; env: number; chars: number; stat: number; shadow: number; prepass: number }

/** `window.__hq.stats()` as the scripts read it (the renderer's stats object has many more keys). */
export interface HqStats {
  entities?: number;
  actors?: number;
  frame?: number;
  fps?: number;
  drawCalls?: DrawCalls;
  triangles?: number;
  trianglesSplit?: TriSplit | null;
  programs?: Programs;
  /** the §5.3 caps that were exceeded ([] = within budget) */
  overBudget?: string[];
  frameErrors?: number;
  /** the player's pose */
  pose: Pose5;
  [key: string]: unknown;
}

/** The parts of `__hq.ctx` the scripts read. */
export interface HqCtx {
  layout?: { id: string; walls?: Wall[] };
  /** 'greybox' until the prop kit dresses the world */
  worldArt?: string;
  player: { eyeHeight?: number; getPose(): Pose5; vel: { x: number; z: number } };
  settings: { get<K extends keyof Settings>(key: K): Settings[K]; set(patch: Partial<Settings>): unknown };
  bus: { on(event: string, fn: (payload: Record<string, unknown> | undefined) => void): unknown };
}

/** An actor as `__hq.actors()` lists it. */
export interface HqActor { id: string; name: string; kind: string; pos: Vec3; arrived: boolean }

/** One actor matching an `__hq.match(query)` (a `status:x` / `kind:x` / `cls:x` query, or an entity id). */
export interface HqMatch { id: string; settled?: boolean; activity?: string }

/** What `__hq.focus(query)` reports after framing an actor (the checks the review reads; more keys exist). */
export interface HqFocus {
  id: string;
  clear?: boolean;
  facing?: number;
  [key: string]: unknown;
}

/** A terminal's state in the page's store (the `term.state` fields the scripts read). */
export interface HqTermState { state: string; mode: string; cols: number; rows: number; writer: boolean }

/** The parts of `__hq.store` the scripts read. */
export interface HqStore {
  termStates: Map<string, HqTermState>;
  entities: Map<string, Entity>;
  /** mutable on purpose: the hire-gate case flips `allowMutations` in the page */
  hello?: Hello | null;
}

/** The demo backend's control messages (`__hq.demo(msg)`; a no-op on a live backend). */
export type HqDemoMsg = ClientMsgOf<'demo.force' | 'demo.scenario' | 'demo.event'>;

export interface HqPage {
  ready?: Promise<unknown>;
  ctx: HqCtx;
  /** world coords x, y, z, yaw, pitch (y = feet) */
  setPose(...pose: number[]): unknown;
  /** canonical pose by name (§9.2) */
  pose(name: string): unknown;
  stats(): HqStats;
  store: HqStore;
  openTerminal(id: string): unknown;
  closeTerminal?(id: string): unknown;
  setHour(hour: number): unknown;
  /** pause / resume the animation clock */
  freeze(on: boolean): unknown;
  match(query: string): HqMatch[];
  focus(query: string): HqFocus | null;
  entities(): Entity[];
  actors(): HqActor[];
  /** the keymap scope: 'world…' | 'xterm' | 'roster' | 'palette' | 'input' | 'serve' | 'dialog' | 'triage' */
  keyScope(): string;
  select(id: string | null): unknown;
  demo(msg: HqDemoMsg): unknown;
  /** open / close the roster (optionally in a grouping mode) */
  roster(open: boolean, mode?: string): unknown;
  /** simulate coming back after `minutes` away (§6.4.5) */
  away(minutes: number): Promise<unknown>;
}

export type PageWindow = Window & typeof globalThis & { __hq: HqPage };
