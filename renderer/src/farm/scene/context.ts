/**
 * The contract between the engine and every visual system. Systems read the ValleyState (never the network), register
 * interactables and colliders, and update once per frame. The only shared mutable state is here.
 */
import type * as THREE from 'three';
import type { AgentPort, ValleyEvent, ValleyState } from '../model/types.ts';

export type Quality = 'low' | 'medium' | 'high';

export interface FrameInfo {
  /** scaled seconds since the last frame (≤ 0.1) */
  dt: number;
  /** scaled seconds since boot (animation time) */
  time: number;
  /** server-clock ms (ValleyState.now extrapolated) */
  now: number;
  frame: number;
}

/** Live lighting the sky system publishes each frame; everything else may read it (lanterns, windows, water). */
export interface Lighting {
  /** unit vector toward the sun (or moon at night) */
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  skyColor: THREE.Color;
  groundColor: THREE.Color;
  fogColor: THREE.Color;
  fogNear: number;
  fogFar: number;
  /** 0 day … 1 deep night: lamps, windows and fireflies fade in with this */
  night: number;
  /** 0..1 current rain/snow wetness */
  wet: number;
  /** wind vector, m/s (x, z) */
  wind: { x: number; z: number };
}

export interface PlayerState {
  /** feet position */
  pos: THREE.Vector3;
  /** eye position (camera) */
  eye: THREE.Vector3;
  yaw: number;
  pitch: number;
  /** horizontal speed m/s */
  speed: number;
  /** a modal UI has the input (pointer unlocked, movement off) */
  frozen: boolean;
}

export type InteractKind = 'farmer' | 'helper' | 'animal' | 'structure' | 'prop' | 'plot';
export interface Interactable {
  id: string;
  kind: InteractKind;
  /** e.g. 'Talk to', 'Pet', 'Read', 'Open' */
  verb: string;
  /** the object name shown after the verb */
  label(): string;
  /** world position of the thing (centre of mass, not feet) */
  pos(out: THREE.Vector3): THREE.Vector3;
  /** reach in metres from the player's eye (default 3.2) */
  reach?: number;
  /** when false the target is skipped */
  enabled?(): boolean;
  use(): void;
  /** optional secondary action on a held / alternate key */
  alt?: { verb: string; use(): void };
}

export interface Interactions {
  add(i: Interactable): () => void;
  /** the target under the crosshair this frame, if any */
  focused(): Interactable | null;
  all(): Iterable<Interactable>;
}

export interface Colliders {
  /** solid rotated rectangle (world metres); returns remove fn */
  rect(x: number, z: number, w: number, d: number, yaw: number): () => void;
  circle(x: number, z: number, r: number): () => void;
  /** push a circle of radius r out of every solid; returns true if it moved */
  resolve(p: { x: number; z: number }, r: number): boolean;
  blocked(x: number, z: number, r: number): boolean;
}

/** UI entry points the 3D world can trigger (a farmer's card, the mailbox, the map). Implemented by the HUD. */
export interface UiPort {
  farmerCard(id: string): void;
  helperCard(id: string): void;
  mailbox(): void;
  map(): void;
  noticeboard(): void;
  /** system stats panel (gauge landmarks call this when read) */
  stats(): void;
  /** transient speech / toast line near the crosshair */
  say(text: string, ms?: number): void;
}

export interface SceneCtx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** read-only view model; the object is replaced in place each tick (keep no references to its members) */
  valley: ValleyState;
  onValley(fn: (e: ValleyEvent) => void): () => void;
  lighting: Lighting;
  player: PlayerState;
  interact: Interactions;
  colliders: Colliders;
  agents: AgentPort;
  ui: UiPort;
  quality: Quality;
  /** debug flags (dev overlay, F-keys) */
  debug: Record<string, boolean>;
  /** systems publish lookups for each other here (e.g. 'farmers' → position of a farmer by id) */
  services: Map<string, unknown>;
}

export interface System {
  name: string;
  update(f: FrameInfo): void;
  dispose?(): void;
  /** optional stats for the perf overlay */
  stats?(): Record<string, number | string>;
}

export type SystemFactory = (ctx: SceneCtx) => System;

/**
 * Well-known services (ctx.services keys) and their publishers:
 *   'farmers'     FarmerLocator                   farmers package
 *   'post'        PostService (engine.ts)          atmosphere package
 *   'audio'       AudioService                     life & sound package
 *   'wind'        WindService                      atmosphere package
 *   'walkSurface' (x, z) => floor height | null    structures package (bridge, dock, porch: walkable tops)
 *   'plots'       PlotLocator (plots/index.ts)     plots package
 *   'structureSpots' StructureSpots               structures package: named anchors + seats
 *   'controller'  Controller (player/controller.ts) lead (main.ts): onStep, teleport, lookAt
 *   'settings'    Settings (core/settings.ts)       lead (main.ts): volumes, quality, reducedMotion…
 *   'lights'      LightsService (scene/lights)      lighting: lamps, lanterns, windows, fires as local light
 * Consumers must tolerate a missing service (optional chaining) — packages land independently.
 */
export interface FarmerLocator {
  /** world position (feet) of a farmer or helper by id, null if not placed */
  position(id: string): THREE.Vector3 | null;
  /** head position for markers and camera focus */
  head(id: string): THREE.Vector3 | null;
}

/** Sound effects every package may trigger (audio package synthesises them; no sample files). */
export const SFX = Object.freeze([
  'step-grass', 'step-wood', 'step-water', 'jump', 'land',
  'ui-open', 'ui-close', 'ui-click', 'ui-hover', 'mail', 'letter-open',
  'alert', 'chime-done', 'chime-pass', 'oops', 'ship', 'hammer', 'hoe', 'water-pour', 'chop', 'page', 'whistle',
  'quack', 'cluck', 'moo', 'baa', 'oink', 'buzz', 'pet', 'purr', 'bark', 'meow',
  'greet', 'voice', 'splash', 'bell', 'creak', 'pop', 'sparkle', 'thunder',
] as const);
export type SfxName = (typeof SFX)[number];

export interface AudioService {
  /** one-shot; `pos` makes it positional (falls off with distance, panned) */
  play(name: SfxName, o?: { pos?: THREE.Vector3; volume?: number; pitch?: number }): void;
  /** a farmer's cute vocal blip (pitch from their seed); `mood` shapes the contour */
  voice(seed: string, o?: { pos?: THREE.Vector3; mood?: 'happy' | 'question' | 'sad' | 'excited'; syllables?: number }): void;
  /** positional loop (fire crackle, water, windmill creak); returns a handle */
  loop(name: 'fire' | 'river' | 'waterfall' | 'windmill' | 'bees' | 'rain' | 'crickets' | 'birds', pos?: THREE.Vector3): { setVolume(v: number): void; stop(): void };
}

/**
 * A local light source (lamp, lantern, window, fire). Register with the 'lights' service (`LightsService.add`); the
 * service picks the nearest few that can touch the view each frame and feeds them to every toon material as
 * stylised, banded warm pools (see scene/lights). Mutate the fields freely (moving lanterns, gauges, flicker);
 * they are read every frame.
 */
export interface LightEmitter {
  /** world position of the light (centre of the glass / flame, or a little behind a window pane) */
  pos: THREE.Vector3;
  /** linear colour */
  color: THREE.Color;
  /** ~1 = the core lights a surface at its full albedo; pools get softer bands further out */
  intensity: number;
  /** metres: nothing beyond this is touched */
  radius: number;
  /** window spill: unit direction the light pours out along (omitted = all around) */
  dir?: THREE.Vector3;
  /** spill half-angle in radians (default π/2: the whole half-space in front of the wall) */
  cone?: number;
  /** 0..1 candle / fire flicker */
  flicker?: number;
  /** extra 0..1 gain (a scarecrow lantern lit only while its process runs); default 1 */
  gain?: number;
  /** 'night' (default): fades with `lighting.night` (dusk, storms); 'always': lit by day too (the campfire) */
  when?: 'night' | 'always';
}

/**
 * A solid building volume that blocks freestanding lamps (a lamp behind the farmhouse does not light the plaza in
 * front of it). World-space box: centre x/z, yaw (same convention as `Colliders.rect`), size w (local x) × d (local z),
 * floor y0 to top y1. Keep it a little inside the real walls so the walls themselves still catch the light.
 */
export interface LightOccluder { x: number; z: number; yaw: number; w: number; d: number; y0: number; y1: number }

export interface LightsService {
  /** register an emitter; returns the remove fn */
  add(e: LightEmitter): () => void;
  /** register a building volume that shadows point lights; returns the remove fn */
  occluder(o: LightOccluder): () => void;
  /** 0..1 how much local light is on right now (night factor after easing) */
  readonly level: number;
  /** every registered emitter (debug overlays, shots) */
  all(): readonly LightEmitter[];
  /** every registered occluder (debug overlays, shots) */
  occluders(): readonly LightOccluder[];
}

/** Wind for foliage sway, cloth, smoke, particles. Published by the atmosphere package as service 'wind'. */
export interface WindService {
  /** gust-modulated wind at a point, m/s (writes out) */
  at(x: number, z: number, t: number, out: { x: number; z: number }): { x: number; z: number };
  /** shared shader uniforms: { uWindTime, uWindDir (vec2), uWindStrength } — plug into onBeforeCompile */
  uniforms: Record<string, { value: unknown }>;
}

/** A spot other packages can send characters to (seat, nap, drop-off, perch). */
export interface StructureSpot { x: number; y: number; z: number; yaw: number; kind: string }
export interface StructureSpots {
  /** named anchors: 'hammock', 'rocker', 'pigeonLoft', 'binDrop', 'mailbox', 'well', 'noticeboard', 'dockEnd', 'campfire', 'bell' */
  get(name: string): StructureSpot | null;
  /** every seat (bench, log bench, picnic, porch rocker) */
  seats(): readonly StructureSpot[];
}
