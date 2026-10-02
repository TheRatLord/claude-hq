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

export type InteractKind = 'farmer' | 'helper' | 'animal' | 'structure' | 'prop' | 'plot' | 'villager';
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
  /** optional one-line hint under the prompt (what using it does: "opens the mailbox · 2 unread") */
  hint?(): string;
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
  /** the Valley Almanac (prosperity, ranks, town upgrades) */
  almanac(): void;
  /** the farm ledger (roster of every farmer by field); optional for fakes */
  roster?(): void;
  /** the Collections book (forage + fishing finds); optional for fakes */
  collection?(): void;
  /**
   * The General store panel (scene/yard, hud/shop.ts): buy decor, sell your basket, decorate your yard. `at` says who
   * you're with: 'store' (buy + sell), 'bram' (sell), 'pocket' (look only); default 'store' ('pocket' for the yard).
   * Optional for fakes.
   */
  shop?(tab?: 'buy' | 'sell' | 'yard', at?: 'store' | 'bram' | 'pocket'): void;
  /**
   * The Friends panel (model/friends.ts, hud/friends.ts): hearts, tastes and today's requests. `give` = a villager id:
   * open on the gift picker for them (what's in your basket). Optional for fakes.
   */
  friends?(o?: { give?: string }): void;
  /**
   * Your own pet (model/pet.ts, scene/life/companion.ts, hud/pet.ts): the adoption card (species, coat, a name) at
   * Fern's foundlings basket, or your pet's card once you have one. Optional for fakes.
   */
  pet?(): void;
  /**
   * The photo album (farm/albumstore.ts, hud/album.ts): the scrapbook grid, or one photo opened large (`id`, e.g. from a
   * frame on the farmhouse photo wall). Optional for fakes.
   */
  album?(id?: string): void;
  /** Fern's field notebook (hud/guide.ts), on a page ('rowboat') or a chapter */
  guide?(page?: string): void;
  /**
   * A transient line, drawn as a speech bubble anchored to whoever said it: `o.from` (an interactable id), else the
   * interactable under the crosshair when it was said (most lines come from `use()`), else a small caption low on the
   * screen. `o.who` heads the bubble (the speaker's name) when it is pinned to the screen edge.
   */
  say(text: string, ms?: number, o?: { who?: string; from?: string }): void;
  /**
   * Show an anchored in-world tag (nameplate / speech bubble) this frame. Call every frame while it should show; the
   * HUD copies the fields (reuse one object, no per-frame allocation). Optional for fakes.
   */
  tag?(t: WorldTag): void;
}

/**
 * One in-world label, drawn by the HUD as a DOM overlay anchored to a world point (projected each frame, so it stays
 * crisp and legible at night, in fog and rain). Tags with the same `owner` stack upward from their anchor in `style`
 * order (nameplate, then bubble); different owners nudge apart instead of overlapping.
 *   name      a farmer / helper nameplate: title + optional sub line ("planting · store.ts")
 *   villager  a villager's green role signboard: title = name, sub = role
 *   duck      a duckling label
 *   speech    a speech bubble (full text, wraps, long lines page)
 *   ask       a needs-you bubble (golden, with a "!")
 * For speech / ask, `sub` is the speaker's name (it heads the bubble when the bubble is pinned to the screen edge).
 */
export type TagStyle = 'name' | 'villager' | 'duck' | 'speech' | 'ask';
export interface WorldTag {
  /** stable key (DOM nodes are reused per key) */
  key: string;
  /** who the tag belongs to (farmer / villager / interactable id): same-owner tags stack */
  owner: string;
  style: TagStyle;
  title: string;
  sub: string;
  /** world anchor: the tag's bottom centre (just above the head) */
  pos: THREE.Vector3;
  /** 0..1 (distance / occlusion fades applied by the caller) */
  alpha: number;
  /** metres from the camera (priority: nearer wins the spot, farther tags nudge away; also scales the tag down) */
  dist: number;
  /** nameplates: a slim gauge under the name, 0..1 (a farmer's context fill once it runs high); absent / < 0 = none */
  meter?: number;
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
  /**
   * comfort settings systems may read each frame (main.ts keeps it current from the browser-local prefs, model/prefs.ts):
   * `weatherFx` scales rain / snow / leaves / motes (0–1); `reducedMotion` asks for calmer motion (softer lightning
   * flashes, fewer particles, no camera bob); `headBob` (Settings → Controls) also calms the held-item bob;
   * `hands` = Settings → Interface → Show hands (the first-person paws, scene/viewmodel; absent = shown)
   */
  comfort: { weatherFx: number; reducedMotion: boolean; headBob?: boolean; hands?: boolean };
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
 *   'pets'        PetsService                       life package: the village dog and cat (idle farmers pet them)
 *   'villagers'   VillagersService                  villagers package: the persistent villager cast (map pins, dev)
 *   'indoors'     IndoorSpace                       interior package: the walk-in farmhouse and barn (controller, engine, sky, audio read it)
 *   'gatherings'  GatherService (scene/gather)      evening gatherings: campfire, bandstand concert, market (farmers, villagers, audio read it)
 *   'hands'       HandsPort (scene/viewmodel)      the first-person paws: held items, gestures, the lantern (forage, barn, seasons, HUD use it)
 * Consumers must tolerate a missing service (optional chaining) — packages land independently.
 */
export interface FarmerLocator {
  /** world position (feet) of a farmer or helper by id, null if not placed */
  position(id: string): THREE.Vector3 | null;
  /** head position for markers and camera focus */
  head(id: string): THREE.Vector3 | null;
}

/** The village pets, for idle farmers who walk over to pet them. Published by the life package as service 'pets'. */
export interface PetsService {
  /** where each pet is (feet), and whether it is calm enough for a visit (not greeting / playing with the player) */
  list(): readonly { id: 'dog' | 'cat'; name: string; x: number; z: number; free: boolean }[];
  /** a farmer is on its way: the pet stays put (sits, watches the farmer come) for up to `secs` */
  hold(id: 'dog' | 'cat', farmerId: string, secs: number): void;
  /** a farmer standing at (x, z) pets it: hearts, a happy wiggle, facing the farmer */
  pet(id: 'dog' | 'cat', x: number, z: number): void;
}

/**
 * The persistent villagers (postmaster, shipping clerk, miller, mayor, ranger, weather-watcher): presentation-only
 * townsfolk, never agents. Published by the villagers package as service 'villagers' (the HUD map draws them as
 * role pins, dev tools walk up to them).
 */
export interface VillagerPin {
  id: string;
  name: string;
  /** 'Postmaster', 'Shipping clerk', … */
  role: string;
  /** one glyph for map pins (a letter or a symbol) */
  glyph: string;
  /** body colour, css hex */
  color: string;
  x: number;
  z: number;
  /** indoors (asleep): not in the world right now */
  inside: boolean;
}
export interface VillagersService {
  list(): readonly VillagerPin[];
  /** dev: what a villager is doing right now */
  debug(id: string): unknown;
}

/** Sound effects every package may trigger (audio package synthesises them; no sample files). */
export const SFX = Object.freeze([
  'step-grass', 'step-wood', 'step-water', 'jump', 'land',
  'ui-open', 'ui-close', 'ui-click', 'ui-hover', 'mail', 'letter-open',
  'alert', 'chime-done', 'chime-pass', 'oops', 'ship', 'hammer', 'hoe', 'water-pour', 'chop', 'page', 'whistle',
  'quack', 'cluck', 'moo', 'baa', 'oink', 'buzz', 'pet', 'purr', 'bark', 'meow',
  'greet', 'voice', 'splash', 'bell', 'creak', 'pop', 'sparkle', 'thunder',
  // the almanac: the valley reached a new rank; fireworks over the square
  'fanfare', 'firework',
  // the player's pastimes (scene/forage): a cast whoosh, a bobber plop / nibble, the bite, reeling in
  'cast', 'plop', 'bite', 'reel',
  // the economy (scene/yard, hud/shop): bits changing hands
  'coins',
  // the stamp book (model/stamps.ts, hud/stamps.ts): a stamp inked into the book
  'stamp',
  // seasonal pastimes (scene/seasons): an oar dipping in, a skate blade's push / carve, packing snow
  'oar', 'skate', 'crunch',
] as const);
export type SfxName = (typeof SFX)[number];

export interface AudioService {
  /** one-shot; `pos` makes it positional (falls off with distance, panned) */
  play(name: SfxName, o?: { pos?: THREE.Vector3; volume?: number; pitch?: number }): void;
  /** a farmer's cute vocal blip (pitch from their seed); `mood` shapes the contour */
  voice(seed: string, o?: { pos?: THREE.Vector3; mood?: 'happy' | 'question' | 'sad' | 'excited'; syllables?: number }): void;
  /** positional loop (fire crackle, water, windmill creak); returns a handle */
  loop(name: 'fire' | 'river' | 'waterfall' | 'windmill' | 'bees' | 'rain' | 'crickets' | 'birds', pos?: THREE.Vector3): { setVolume(v: number): void; stop(): void };
  /** 0 outdoors … 1 indoors: the valley's ambience goes muffled behind walls, rain drums on the roof (optional);
   *  `roof` scales the rain on the roof (the barn's tin drums louder than the farmhouse shingles = 1) */
  indoors?(k: number, o?: { roof?: number }): void;
  /** what the music is doing (optional): `on` = it can be heard at all (unlocked, enabled, not silenced); `scene` = the
   *  piece playing now (musicPlan.ts MusicScene: 'campfire' / 'concert' at a gathering), null while it rests */
  musicNow?(): { on: boolean; scene: string | null };
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

/**
 * A walk-in room the player can be inside (the farmhouse or the barn, scene/interior; service 'indoors'). While
 * `active` the controller walks on its floors and collides with its solids instead of the terrain and the valley's
 * colliders, the engine only offers the room's own interactables (`owns`), the sky dims its open-air fill, and the
 * audio muffles the outdoors. Outdoor systems keep running; the room hides the outdoor scene while you are in it.
 */
export interface IndoorSpace {
  readonly active: boolean;
  /** which room you are in ('farmhouse' | 'barn' | 'grotto'), null outdoors */
  readonly room?: string | null;
  /** how much open sky reaches the room you are in and its tint (scene/interior/space.ts RoomDef.light; null = a room
   *  with windows: the default warm fill) */
  readonly light?: { sky: number; skyTint: number; groundTint: number; sun?: number } | null;
  /** world floor height at (x, z) inside the room for feet at world height y (a loft above, the floor below; omitted =
   *  the ground floor), null outside its walls (not walkable) */
  floor(x: number, z: number, y?: number): number | null;
  /** push a circle of radius r (world x / z, mutated; y = feet height for multi-level rooms) out of the room's solids */
  resolve(p: { x: number; z: number; y?: number }, r: number): void;
  /** is this interactable part of the room (offered while inside)? */
  owns(i: Interactable): boolean;
  /** go in / out (a short fade; `instant` skips it: shots, dev, map travel); `room` defaults to the farmhouse */
  enter(instant?: boolean, room?: string): void;
  leave(instant?: boolean): void;
  /** dev / shots: stand at a named viewpoint inside (entering first): 'hearth', 'barn', 'barn:loft'; false if unknown */
  view?(name: string): boolean;
  /** where a pet that came in with you curls up (world; reused object), null when this room has no spot */
  petSpot?(): { x: number; y: number; z: number; yaw: number } | null;
}

/**
 * Photo mode (farm/photo.ts), published as service 'photo'. `on` while the camera flies free and the HUD steps away:
 * anything drawn in front of the camera for the player (the first-person viewmodel, held items) hides while it is on.
 * `cheese()` is the "say cheese" cue: when the player focuses on someone (F in photo mode) or the self-timer runs,
 * nearby farmers, villagers and your pet glance at the camera and pose for a moment (scene/cheese.ts `cheeseWeight`).
 */
export interface PhotoService {
  readonly on: boolean;
  /** the live cue, null when nobody is being asked to smile */
  cheese(): CheeseCue | null;
}
export interface CheeseCue {
  /** the camera (world) */
  x: number; y: number; z: number;
  /** the camera's horizontal look direction (unit) */
  dx: number; dz: number;
  /** when it started and ends (performance.now() ms: real time, works at timescale 0) */
  from: number; until: number;
  /** the subject in focus (farmer / helper / villager id, or 'pet'), who does a bigger pose; null = everyone in view */
  focus: string | null;
}

/**
 * The photo album's favourites for the farmhouse wall (farm/albumstore.ts), published as service 'album'. Images are
 * small thumbnails (Blob); the reader makes and disposes its own textures.
 */
export interface AlbumWallSource {
  /** the favourites to hang, latest first (at most `n`) */
  wall(n: number): readonly { id: string; caption: string; thumb: Blob | null }[];
  /** bumps whenever the wall's picks or their images change */
  readonly wallVersion: number;
}

/** Something a paw holds (scene/viewmodel). Systems that own the thing claim it each frame (`HandsPort.carry`). */
export type HandItem = 'none' | 'lantern' | 'basket' | 'rod' | 'hay' | 'grain' | 'brush' | 'coin';
/** What a system can ask the paws to carry for it, renewed every frame while it lasts */
export type HandCarry = 'hay' | 'grain' | 'brush' | 'snowball' | 'decor';
/** One-shot paw gestures */
export type HandGesture = 'grab' | 'pat' | 'wave' | 'cheer' | 'shield' | 'coin' | 'poke';
/**
 * The first-person paws (scene/viewmodel, service 'hands'). They draw in their own overlay (own field of view,
 * depth squeezed in front of everything) and hold whatever you are doing: the rod, the barn's hay / grain scoop /
 * brush, the lantern at night, the basket after a find; they row, skate, push a snowball, grip the summit viewer, and
 * gesture (grab, pat, wave, cheer, shield, coin). Owners renew per-frame claims; a claim not renewed lapses.
 */
export interface HandsPort {
  /** the paws are drawing this frame (Settings → Show hands on, no photo mode, no menu): hide your own held mesh */
  readonly shown: boolean;
  /** per frame while you hold it (barn chores, a snowball, yard decor): true when the paws show it for you */
  carry(what: HandCarry): boolean;
  /**
   * per frame while fishing: the rod's tilt (radians forward, forage's `swing`); writes the rod tip's world position
   * (where it shows on screen, for the line) into `tip` and returns true while the paws hold the rod
   */
  rod(swing: number, tip: THREE.Vector3): boolean;
  /** per frame while rowing: the oar grips (world); the paws hold them */
  oars(left: THREE.Vector3, right: THREE.Vector3): void;
  /** play a gesture (dropped when no paw is free) */
  gesture(g: HandGesture): void;
  /** the player used an interactable (HUD, use / alt key): the matching gesture (pick up → grab, pet → pat, …) */
  used(i: Pick<Interactable, 'kind' | 'verb' | 'id' | 'pos'>): void;
  /** the lantern key: light it / put it away (back to automatic at the next dusk or dawn); true when now lit */
  lantern(): boolean;
  /** is the lantern lit right now */
  readonly lanternLit: boolean;
}
