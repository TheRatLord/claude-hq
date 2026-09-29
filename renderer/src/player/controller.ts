/**
 * First-person controller (PLY, §6.10). Modes:
 * - **walk**: WASD 3.6 m/s with exponential accel/decel, Shift sprint 5.6 m/s + FOV kick, Space jump (coyote time,
 *   jump buffer, variable height), circle-vs-grid collision with per-axis slide on the current nav level, stairs ramp
 *   and mezzanine via `layout.floorAt` (level switch at half the rise), head-bob phase-locked to `player.step`,
 *   landing dip spring (`player.land`), camera height critically damped + rate-capped (no pops on steps/stairs).
 * - **glide**: short eased camera moves between states (sit down 0.3 s, stand-up hop, slide mount).
 * - **sit** (E on a free seat): eye 0.78 m above the seat floor, look clamped yaw ±100° / pitch ±60°; WASD / Space /
 *   E stands up with a hop. Never an agent's own desk chair (the hint names the owner instead).
 * - **ride** (E at the slide mouth): camera follows the baked Catmull-Rom slide path (+0.25 m over the centreline),
 *   2.2 s ease-in, FOV +8°, roll into the turns ≤ 6°, look free ±60°; exits with a landing dip and a 0.6 s carry.
 * - **follow** (`follow(actor)`, the UI's F / roster follow): the camera orbits the actor at a spot whose view is clear
 *   of walls, tall furniture and other actors (follow.ts: no neighbour covering the subject or looming in the
 *   foreground; raised spots look over heads); mouse drag nudges the orbit. `follow(null)` / `setPose` end it and the
 *   eye settles back to standing height.
 * - **dive** (`dive(actor)`, E on an agent working at its desk; dive.ts): ~0.6 s glide over its shoulder into its
 *   monitor, FOV narrowing to 34°; on arrival `onScreen(rect)` / bus 'player.dive' {phase:'screen', id, rect} hands
 *   the UI the monitor's on-screen rect to open the drawer from. Esc (outside xterm), movement keys, `undive()` or
 *   the drawer closing pull back out to the exact pre-dive pose (and seat).
 * - **manager** (E on the mezzanine-rail manager's desk; manager.ts): overhead view over the atrium / Pit; WASD pans,
 *   wheel zooms, drag looks, click selects (bus 'player.select' {id}); bus 'player.manager' {on} lets the UI dock the
 *   roster. Esc / E stands up.
 * Mouse look via pointer lock (click the view) or drag. `setPose` holds (no gravity / collision) until movement input,
 * so review poses at any height stay put. Actors are soft circles (soft.ts). Reduced motion disables bob, roll, FOV
 * kicks and the landing dip. Bus: 'player.step' {surface, speed, foot} · 'player.land' {v, surface} · 'player.bump' ·
 * 'player.sit' {slotId, tag, zone, x, z} · 'player.stand' {slotId} · 'player.slide' {phase:'start'|'exit', x, z}.
 * Owner: PLY.
 */
import { clamp, wrapAngle } from '../core/math.ts';
import { TUNING as T } from './tuning.ts';
import { createNav } from '../world/nav/index.ts';
import { bobAdvance, bobShape, stepIndex, landDipImpulse, springStep, analyseFeel } from './feel.ts';
import type { FeelFrame, FeelEvent } from './feel.ts';
import { hqRegister, hqStatSection, faceYaw } from '../core/debug.ts';
import type { FaceRigView } from '../core/debug.ts';
import { createFollowRig } from './follow.ts';
import type { FollowNav, FollowActor } from './follow.ts';
import { softStep } from './soft.ts';
import type { BumpEvent, Contact } from './soft.ts';
import { createCamPath, rideEase, rideSpeed } from './path.ts';
import type { CamPath, PathSample } from './path.ts';
import { sittable, pickSeat } from './seats.ts';
import type { Occupancy } from './seats.ts';
import { createPilot, traversal } from './autopilot.ts';
import type { Checkpoint, PilotNav } from './autopilot.ts';
import { DIVE, diveTrack, diveEnd, screenFromMatrix, screenRectPx, easeInOut as diveEase } from './dive.ts';
import type { CamPose, DeskBox, Screen } from './dive.ts';
import { MANAGER, managerDesk, managerView, panStep, pickAt, pointsOf } from './manager.ts';
import type { ManagerDesk } from './manager.ts';
import { standSpot } from './standSpot.ts';
import type { StandSpot } from './standSpot.ts';
import type { GoActor, PoseArr } from './goThere.ts';
import * as deskScreens from '../render/deskScreens.ts'; // RND: `screenRect(anchor)` when it lands (else a scene scan)
import type { Bus } from '../core/bus.ts';
import type { Layout, Slot } from '../world/layout/schema.ts';
import { isRecord, errMessage } from '../../../shared/guards.ts';
import type * as THREE from 'three';

export const EYE_HEIGHT = T.eyeHeight;
const SOFT_OPTS = Object.freeze({ radius: T.radius, ...T.soft });
const DEG = Math.PI / 180;
const PLAYER_ID = 'player';
/** Footstep surface per zone (AUD picks the material sound). */
const ZONE_SURFACE: Record<string, string | undefined> = { PIT: 'rug', LOB: 'tile', ATR: 'tile', PLZ: 'tile', STR: 'tile', CAF: 'tile', ENG: 'metal', MEZ: 'wood', LIB: 'carpet', NAL: 'carpet', ARC: 'carpet', WAR: 'carpet' };

export type Mode = 'walk' | 'glide' | 'sit' | 'ride' | 'follow' | 'dive' | 'manager';
/** slotId: the seat 'sit' would pick */
export interface Hint { verb: 'sit' | 'ride' | 'stand' | 'manage' | null; text: string; slotId?: string }
/** What the controller reads of an actor (agents are soft colliders, follow / dive / stand-spot targets). */
export interface PlayerActor extends GoActor {
  pos: { x: number; y: number; z: number };
  yaw: number;
  mode?: string;
  radius?: number;
  entity?: { name?: string } | null;
  rig?: FaceRigView | null;
}
/** `__hq.feelTrace({follow, slices?, resetPerf?})`: the follow probe. */
export interface FollowProbeArg { follow?: string | null; slices?: number | null; resetPerf?: boolean }
/** `__hq.feelTrace({dive, hold?} | {undive} | {manager, pan?, zoom?, click?} | {standSpot})`: the dive / manager / stand-spot probe. */
export interface VisitProbeArg {
  standSpot?: string; dive?: string | null; hold?: number | null; undive?: boolean; manager?: boolean;
  pan?: { x?: number; z?: number }; zoom?: number; click?: [number, number];
}
export type FeelProbeArg = FollowProbeArg | VisitProbeArg;
/** The screen rect a dive hands the UI (CSS px). */
export interface ViewRect { left: number; top: number; width: number; height: number }
/** The camera the controller drives (a `THREE.PerspectiveCamera`, or a test double with these members). */
export interface PlayerCamera {
  position: { set(x: number, y: number, z: number): unknown };
  rotation: { set(x: number, y: number, z: number, order?: string): unknown };
  fov: number;
  updateProjectionMatrix(): void;
  updateMatrixWorld?(force?: boolean): void;
  matrixWorldInverse?: { elements: ArrayLike<number> };
  projectionMatrix?: { elements: ArrayLike<number> };
}
/** The canvas the pointer / keyboard events are bound to. */
export interface PlayerDom {
  addEventListener(type: string, fn: (e: MouseEvent) => void): void;
  removeEventListener(type: string, fn: (e: MouseEvent) => void): void;
  getBoundingClientRect?(): ViewRect;
  requestPointerLock?(): Promise<void> | void;
}
/** The nav queries the player makes (world/nav facade). */
export interface PlayerNav extends FollowNav, PilotNav {}
/** A desk's seat as the director hands it out. */
export interface DirectorSlot { id: string; anchor?: string; pos: { x: number; z: number }; yaw?: number }
/** Seat ownership / claims (optional collaborator: chars/brain/director). */
export interface PlayerDirector {
  slotFor?(id: string): DirectorSlot | null | undefined;
  claim?(who: string, tag: string, pos: { x: number; y: number; z: number }): { id: string } | null | undefined;
  unclaim?(who: string): void;
  holds?(actorId: string, slotId: string): boolean;
  pinFor?(actorId: string): { id: string } | null | undefined;
}
/** `feelTrace` argument: ms to record, `'run'` for the scripted traversal, or `{run, ms}`. */
export type FeelArg = number | 'run' | { run?: boolean; ms?: number };
export type FeelAnalysis = ReturnType<typeof analyseFeel>;
export type TraversalResult = FeelAnalysis & { run: Checkpoint[] | null; error: string | null };

export interface Player {
  /** §8.1 step 1 (camera, aim) */
  update(ctx: { rawDt: number; layout: Layout | null; scene?: Pick<THREE.Scene, 'traverse'> | null }): void;
  /** y = feet */
  setPose(x: number, y: number, z: number, yaw: number, pitch: number): void;
  getPose(): [number, number, number, number, number];
  /** feet position */
  pos: { x: number; y: number; z: number };
  /** horizontal velocity m/s */
  vel: { x: number; z: number };
  yaw: number;
  pitch: number;
  fov: number;
  /** camera height above the feet (1.2 m) */
  eyeHeight: number;
  /** nav level the feet are on (0 ground, 1 mezzanine) */
  level: number;
  readonly mode: Mode;
  /** slot the player sits on (null when not seated) */
  readonly seatId: string | null;
  setFov(fov: number): void;
  /** false while a drawer/UI owns the keyboard */
  inputEnabled: boolean;
  grounded: boolean;
  /** world affordance under the reticle (UI shows "E sit" / "E ride") */
  hint(): Hint | null;
  /** E with no agent aimed: sit / stand / ride; true = consumed */
  interact(): boolean;
  /**
   * §9.1: record + analyse camera feel for ms; `'run'` drives the scripted M1.5 traversal (spawn → Pit sit/stand → stairs
   * → slide → Lobby)
   */
  feelTrace(arg?: FeelArg | null): Promise<FeelAnalysis | TraversalResult>;
  /** actors the player bumps into (§6.10 "agents are soft"); entries with mode 'wait'/'leave' are ignored */
  setSoftColliders(fn: (() => Iterable<PlayerActor>) | null): void;
  /** hook: called on each contact transition */
  onBump: ((e: BumpEvent) => void) | null;
  /** live soft contacts (debug / reactions) */
  contacts: Map<string, Contact>;
  /** held virtual keys (autopilot / tests) */
  virtualKeys: Set<string>;
  /** orbit-follow an actor (UI delegates its follow here); null ends it */
  follow(actor: PlayerActor | null): void;
  followDebug(n?: number): ReturnType<ReturnType<typeof createFollowRig>['debug']>;
  /** current follow spot: {clear, occ, fg, who, wall, …} (review / tests) */
  followInfo(): ({ id: string | null } & Record<string, unknown>) | null;
  /** monitor dive (false: the actor isn't at its desk / no monitor found; the caller opens the terminal the plain way) */
  dive(actor: PlayerActor, o?: DiveOptions): boolean;
  /** pull back out of a dive (false: not diving) */
  undive(): boolean;
  diveInfo(): DiveInfo | null;
  /** enter / leave the manager's desk view */
  manager(on: boolean): boolean;
  managerInfo(): { phase: 'in' | 'on' | 'out'; pan: { x: number; z: number }; zoom: number } | null;
  managerDesk(): ManagerDesk | null;
  managerClick(x: number, y: number): string | null;
  /** face-framing stand pose for an actor (standSpot.ts, + its monitor) */
  standSpot(actor: PlayerActor): StandSpot | null;
  dispose(): void;
}
export interface DiveOptions { onScreen?: ((rect: ViewRect | null) => void) | null; hold?: number | null; track?: Partial<typeof DIVE> }
export interface DiveInfo {
  phase: 'in' | 'hold' | 'out'; id: string; u: number; rect: ViewRect | null; fov: number; minClear: number; endD: number;
  eye: { x: number; y: number; z: number };
}

const isInstancedMesh = (o: THREE.Object3D): o is THREE.InstancedMesh => 'isInstancedMesh' in o && o.isInstancedMesh === true;
/** A plane geometry's width / height (`PlaneGeometry.parameters`), when it has them. */
const planeSize = (g: THREE.BufferGeometry): { width?: number; height?: number } => {
  if (!('parameters' in g) || !isRecord(g.parameters)) return {};
  const { width, height } = g.parameters;
  return { width: typeof width === 'number' ? width : undefined, height: typeof height === 'number' ? height : undefined };
};

const typingTarget = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !!t.closest?.('.xterm'));
/** Column-major 4×4 product A · B[off..off+16] (instance → world), fresh array. */
function mul4(A: ArrayLike<number>, B: ArrayLike<number>, off = 0): number[] {
  const o = new Array<number>(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = A[r] * B[off + c * 4] + A[4 + r] * B[off + c * 4 + 1] + A[8 + r] * B[off + c * 4 + 2] + A[12 + r] * B[off + c * 4 + 3];
  }
  return o;
}
/** Sine ease: peak speed π/2 × the mean (cubic is 3×), so a 0.3 s glide never lurches. */
const easeInOut = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);

interface EyeYP { x: number; y: number; z: number; yaw: number; pitch: number }
interface GlideState { t: number; dur: number; from: EyeYP; to: EyeYP; arc: number; done: (() => void) | null }
interface SeatState { slot: Slot; armed: boolean; prev: { x: number; y: number; z: number } }
interface RideView { head: number; dYaw: number; pitch: number }
interface RideState {
  t: number; lookYaw: number; lookPitch: number; roll: number; head: number; pitch: number; bias: number; biasPitch: number;
  view: RideView; smp: PathSample; ahead: PathSample;
}
/** Everything a dive / manager visit must put back exactly. */
interface Snapshot {
  mode: Mode; pos: { x: number; y: number; z: number }; yaw: number; pitch: number; level: number; held: boolean; camY: number | null; grounded: boolean;
  eye: { x: number; y: number; z: number };
}
interface DiveState {
  phase: 'in' | 'hold' | 'out'; t: number; track: ReturnType<typeof diveTrack>; from: Snapshot; f0: CamPose; screen: Screen;
  sitter: { x: number; y: number; z: number }; id: string; onScreen: ((rect: ViewRect | null) => void) | null; rect: ViewRect | null;
  holdU: number | null; announce: boolean; announced?: boolean; holdT: number; back: number; fov: number; outU?: number; sawOpen?: boolean;
}
interface MgrState {
  phase: 'in' | 'on' | 'out'; t: number; pan: { x: number; z: number }; zoom: number; lookYaw: number; lookPitch: number;
  from: Snapshot; start: CamPose; outFrom?: CamPose;
}
interface Trace { frames: FeelFrame[]; events: FeelEvent[]; t0: number; done: () => void }

/**
 * `director`: seat ownership / claims (optional); `now`: ms clock for traces (tests pass a simulated one). Step sounds
 * are AUD's (audio/); the old clicks.js stand-in was deleted (CORE m2 fix r3)
 */
/** A followed actor with a live rig (the controller's actors are `PlayerActor`s): its face plate decides where it looks. */
const hasFaceRig = (a: FollowActor): a is FollowActor & { yaw: number; rig: FaceRigView } => 'rig' in a && !!a.rig;

export function createPlayer({ camera, dom, bus = null, fov = 60, nav = null, director = null, now = () => performance.now() }: {
  camera: PlayerCamera; dom: PlayerDom; bus?: Bus | null; fov?: number; nav?: PlayerNav | null; director?: PlayerDirector | null; now?: () => number;
}): Player {
  const keys = new Set<string>();
  const vkeys = new Set<string>();     // autopilot (feelTrace 'run') virtual keys
  let dragging = false;
  let held = true;             // setPose hold: no physics until movement input
  let navLayout: Layout | null = null, L: Layout | null = null;
  let vy = 0, airT = 0, jumpBufT = 9, jumpHeld = false;
  let camY: number | null = null, camV = 0, camOff = 0; // smoothed eye height (world), its velocity, airborne offset
  let dip = 0, dipV = 0;       // landing dip spring
  let bobPhase = 0, bobAmp = 0, nextStep = 1; // nextStep: index k of the next trough (φ = kπ) to announce
  let trace: Trace | null = null; // __hq.feelTrace recording {frames, events, t0}
  let fovKick = 0, rideKick = 0, roll = 0;
  let softColliders: (() => Iterable<PlayerActor>) | null = null;
  const contacts = new Map<string, Contact>();
  let softMul = 1, frameNo = 0;
  const softList: PlayerActor[] = [];
  let seats: Slot[] = [], slidePath: CamPath | null = null, focusPt: { x: number; y: number; z: number } | null = null; // focusPt: where the ride's default look leans (atrium centre)
  let mode: Mode = 'walk';
  let glide: GlideState | null = null, seat: SeatState | null = null, ride: RideState | null = null;
  let carryT = 0, carryX = 0, carryZ = 0;
  let lift: { from: number; t: number; dur: number } | null = null; // eye below standing height, eased back up (sliding out on your bum)
  let hint: Hint | null = null;
  const followRig = createFollowRig({
    layout: () => L, nav: () => nav, others: () => actorsNow(), faceYaw: (a) => (hasFaceRig(a) ? faceYaw(a) : a.yaw ?? 0),
    levelOf: (a) => (L?.floorAt ? L.floorAt(a.pos.x, a.pos.z, a.pos.y ?? 0).level : 0),
  });
  let hintSeat: Slot | null = null;
  const eye = { x: 0, y: 0, z: 0 };
  // ---- monitor dive / manager's desk state ----
  let dive: DiveState | null = null;
  let mgr: MgrState | null = null;
  let camFov: number | null = null; // lens override while diving / managing (null → p.fov + kicks)
  let sceneRef: Pick<THREE.Scene, 'traverse'> | null = null, screensL: Layout | null = null, screenList: Screen[] | null = null, deskMgr: ManagerDesk | null = null, deskMgrL: Layout | null = null;
  const diveOut: CamPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: 60 };
  const mouse = { downX: 0, downY: 0, moved: 0, mgrDrag: false };
  let strip = { left: 0, right: 0 }; // visible world strip (UI 'viewStrip', CSS px): the dive refits the screen to it
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ev = (type: string, extra?: Omit<FeelEvent, 't' | 'type'>) => trace?.events.push({ t: now() - trace.t0, type, ...extra });

  const surfaceAt = (x: number, z: number, y: number): { y: number; level: number } => (L?.floorAt ? L.floorAt(x, z, y) : { y: L?.floorY?.(x, z, 0) ?? 0, level: 0 });
  const hit = (x: number, z: number, level: number = p.level) => nav?.collides?.(x, z, T.radius, level) ?? false;
  const onStairs = (x: number, z: number) => { const r = L?.stairs?.rect; return !!r && x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]; };
  const footSurface = () => {
    if (!L || L.id === 'proto') return 'carpet';
    if (onStairs(p.pos.x, p.pos.z)) return 'stairs';
    const zone = L.zoneAt?.(p.pos.x, p.pos.z, p.level);
    return (zone ? ZONE_SURFACE[zone] : undefined) ?? 'floor';
  };
  /** Floor averaged over the body circle (cliffs > 0.35 m ignored): a step becomes a short ramp for the eye. */
  const probeFloor = (x: number, z: number, y0: number) => {
    let sum = 2 * y0, w = 2;
    const r = T.floorProbe;
    for (let i = 0; i < 4; i++) {
      const s = surfaceAt(x + (i === 0 ? r : i === 1 ? -r : 0), z + (i === 2 ? r : i === 3 ? -r : 0), p.pos.y);
      if (Math.abs(s.y - y0) <= 0.35) { sum += s.y; w++; }
    }
    return sum / w;
  };
  const actorsNow = (): Iterable<PlayerActor> => { try { return softColliders?.() ?? []; } catch { return []; } };

  /** Who sits on / owns this seat. */
  const occupancy = (s: Slot): Occupancy => {
    let owner: string | null = null;
    for (const a of actorsNow()) {
      if (!a?.pos || a.mode === 'leave') continue;
      if (s.tag === 'desk' && director?.slotFor?.(a.id)?.id === s.id) owner = a.entity?.name ?? a.id;
      if ((a.pos.x - s.pos.x) ** 2 + (a.pos.z - s.pos.z) ** 2 < 0.45 * 0.45 && Math.abs((a.pos.y ?? 0) - s.pos.y) < 1) return { busy: true };
      if (director?.holds?.(a.id, s.id) || director?.pinFor?.(a.id)?.id === s.id) return { busy: true };
    }
    return owner ? { owner } : null;
  };
  /** No wall/furniture between the player and the seat (stops 0.3 m short: the seat sits inside its sofa). */
  const reachable = (s: Slot) => {
    const dx = s.pos.x - p.pos.x, dz = s.pos.z - p.pos.z, d = Math.hypot(dx, dz);
    for (let t = 0.15; t < d - 0.3; t += 0.15) if (nav?.walkable && !nav.walkable(p.pos.x + dx * t / d, p.pos.z + dz * t / d, p.level, { owner: '*' })) return false;
    return true;
  };

  function startGlide(to: EyeYP, dur: number, arc: number, done: (() => void) | null) {
    glide = { t: 0, dur, from: { x: eye.x, y: eye.y, z: eye.z, yaw: p.yaw, pitch: p.pitch }, to, arc, done };
    mode = 'glide';
    p.vel.x = 0; p.vel.z = 0; vy = 0; held = false;
  }

  function sitDown(s: Slot) {
    const c = director?.claim?.(PLAYER_ID, s.tag, s.pos);
    if (c && c.id !== s.id) director?.unclaim?.(PLAYER_ID);
    seat = { slot: s, armed: false, prev: { x: p.pos.x, y: p.pos.y, z: p.pos.z } };
    p.pos.x = s.pos.x; p.pos.y = s.pos.y; p.pos.z = s.pos.z; p.level = s.level ?? 0;
    contacts.clear();
    startGlide({ x: s.pos.x, y: s.pos.y + T.sit.eye, z: s.pos.z, yaw: s.yaw, pitch: -0.1 }, T.sit.glide, 0.03, () => {
      mode = 'sit';
      bus?.emit('player.sit', { slotId: s.id, tag: s.tag, zone: s.zone ?? null, x: s.pos.x, z: s.pos.z });
    });
    ev('sit', { tag: s.tag });
  }

  function standUp() {
    const s = seat?.slot;
    if (!s || !seat) return;
    director?.unclaim?.(PLAYER_ID);
    const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
    let spot: { x: number; z: number; y: number; level: number } | null = null;
    for (let d = T.sit.standOut[0]; d <= T.sit.standOut[1] + 1e-6 && !spot; d += 0.1) {
      const x = s.pos.x + fx * d, z = s.pos.z + fz * d;
      const f = surfaceAt(x, z, s.pos.y + 0.3);
      if (!hit(x, z, f.level) && Math.abs(f.y - s.pos.y) < 0.35) spot = { x, z, y: f.y, level: f.level };
    }
    if (!spot) spot = { ...seat.prev, level: surfaceAt(seat.prev.x, seat.prev.z, seat.prev.y).level };
    const slotId = s.id;
    seat = null;
    p.pos.x = spot.x; p.pos.y = spot.y; p.pos.z = spot.z; p.level = spot.level;
    bus?.emit('player.stand', { slotId });
    ev('stand');
    startGlide({ x: spot.x, y: spot.y + T.eyeHeight, z: spot.z, yaw: p.yaw, pitch: clamp(p.pitch, -0.5, 0.3) }, T.sit.stand, T.sit.hop, () => {
      mode = 'walk'; p.grounded = true; camY = spot.y + T.eyeHeight; camV = 0;
      if (!reduced) dipV += landDipImpulse(1.8, T.landDip).impulse * 0.6; // soft settle after the hop
    });
  }

  /**
   * Default ride view at arc position `sNow` from `eyeP`: travel direction (chord `lookAhead` down the slide, carried
   * along the exit tangent past the end) plus `focus.weight` × the direction to the atrium focus (Pit + Big Board).
   * Writes the travel heading, the biased view's yaw offset from it and the biased pitch into `out`.
   */
  function rideView(sNow: number, eyeP: { x: number; y: number; z: number }, out: RideView): RideView {
    const sp = slidePath, rd = ride;
    if (!sp || !rd) return out; // only called while a ride is set up
    const S = T.slide, F = S.focus, Lp = sp.length;
    const smp = sp.sample(sNow, rd.smp);
    const q = sp.sample(Math.min(Lp, sNow + S.lookAhead), rd.ahead);
    const over = Math.max(0, sNow + S.lookAhead - Lp);
    const ax = q.x + q.tx * over - smp.x, ay = q.y + q.ty * over - smp.y, az = q.z + q.tz * over - smp.z;
    const hl = Math.hypot(ax, az);
    out.head = hl > 1e-4 ? Math.atan2(-ax, -az) : out.head;
    const tPitch = Math.atan2(ay, Math.max(1e-4, hl)) * S.pitchFollow;
    out.dYaw = 0; out.pitch = tPitch;
    const fp = focusPt;
    if (!fp) return out;
    // yaw: horizontal unit travel vector + weight × horizontal unit vector to the focus
    let vx = -Math.sin(out.head), vz = -Math.cos(out.head);
    const fx = fp.x - eyeP.x, fy = fp.y - eyeP.y, fz = fp.z - eyeP.z, fl = Math.hypot(fx, fz) || 1;
    vx += F.weight * fx / fl; vz += F.weight * fz / fl;
    out.dYaw = wrapAngle(Math.atan2(-vx, -vz) - out.head);
    // pitch: lean toward the focus only while it is roughly ahead (a vector sum dives the view when it is behind)
    const c = Math.max(0, Math.cos(wrapAngle(Math.atan2(-fx, -fz) - out.head))), k = F.weight * c / (1 + F.weight * c);
    out.pitch = tPitch + (Math.atan2(fy, Math.hypot(fx, fz)) - tPitch) * k;
    return out;
  }

  function startRide() {
    if (!slidePath) return;
    const S = T.slide;
    const s0 = slidePath.sample(0);
    const at = { x: s0.x, y: s0.y + S.tubeLift + S.camUp, z: s0.z };
    const r: RideState = { t: 0, lookYaw: 0, lookPitch: 0, roll: 0, head: 0, pitch: 0, bias: 0, biasPitch: 0,
      view: { head: 0, dYaw: 0, pitch: 0 }, smp: { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: -1 }, ahead: { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: -1 } };
    ride = r;
    // the mount glide ends exactly on the ride's first view (no yaw/pitch snap when the ride starts)
    const v = rideView(0, at, r.view);
    r.head = v.head; r.bias = v.dYaw; r.biasPitch = v.pitch; r.pitch = v.pitch;
    contacts.clear();
    startGlide({ ...at, yaw: v.head + v.dYaw, pitch: v.pitch }, S.mount, 0.06, () => {
      mode = 'ride'; r.t = 0;
      bus?.emit('player.slide', { phase: 'start', x: s0.x, z: s0.z });
      ev('ride');
    });
  }

  function endRide() {
    const P = slidePath, rd = ride;
    if (!P || !rd) return; // only called from the ride mode
    const S = T.slide, Lp = P.length, dur = L?.slide?.duration ?? 2.2;
    const end = P.sample(Lp);
    const hl = Math.hypot(end.tx, end.tz) || 1;
    const dx = end.tx / hl, dz = end.tz / hl;
    const v = Math.min(S.carryMax, rideSpeed(1, S.ease) * (Lp / dur) * hl);
    const f = surfaceAt(end.x, end.z, end.y);
    p.pos.x = end.x; p.pos.y = f.y; p.pos.z = end.z; p.level = f.level;
    p.vel.x = dx * v; p.vel.z = dz * v; carryX = p.vel.x; carryZ = p.vel.z; carryT = S.carry;
    p.yaw = wrapAngle(rd.head + rd.bias + rd.lookYaw); p.pitch = rd.pitch; // continue the ride's last view
    camY = eye.y; camV = 0; vy = 0; p.grounded = true; airT = 0;
    lift = { from: Math.max(0, f.y + T.eyeHeight - eye.y), t: 0, dur: S.carry };
    const { depth, impulse } = landDipImpulse(S.exitDipV, T.landDip);
    if (!reduced) dipV += impulse;
    bus?.emit('player.land', { v: S.exitDipV, surface: 'slide' });
    bus?.emit('player.slide', { phase: 'exit', x: end.x, z: end.z });
    ev('land', { v: S.exitDipV, depth: reduced ? 0 : depth });
    ev('rideEnd');
    ride = null; mode = 'walk';
  }

  // ------------------------------------------------------------------ monitor dive (dive.ts)
  /** Every status-screen instance in the scene (ENV `env:screens` / greybox `kit:screens`), world space, cached per layout. */
  function sceneScreens(): Screen[] {
    if (screenList && screensL === L) return screenList;
    const list: Screen[] = [];
    screensL = L; screenList = list;
    const meshes: THREE.InstancedMesh[] = [];
    sceneRef?.traverse?.((o) => { if (isInstancedMesh(o) && /(^|:)screens$/.test(o.name ?? '')) meshes.push(o); });
    for (const m of meshes) {
      m.updateWorldMatrix?.(true, false);
      const g = planeSize(m.geometry);
      const w = g.width ?? 0.37, h = g.height ?? 0.155;
      const inst = m.instanceMatrix?.array;
      if (!inst) continue;
      for (let i = 0; i < m.count; i++) {
        const e = mul4(m.matrixWorld.elements, inst, i * 16);
        if (!Number.isFinite(e[0]) || Math.hypot(e[0], e[1], e[2]) < 1e-4) continue; // hidden (W-bay swap: scale 0)
        list.push(screenFromMatrix(e, w, h));
      }
    }
    return list;
  }
  /** The monitor of desk `anchor` (RND `screenRect` when present, else the nearest scene screen to the desk). */
  function screenOf(anchor: string, a: PlayerActor | null | undefined): Screen | null {
    try {
      // m3 fix r1 (reviewer [fun]): RND's rect is {corners, center, normal, width, height}; the old `r.w && r.h` test
      // never matched it, so every dive fell back to the scene scan. The real glass (monitor atlas tile) wins now.
      // (RND's ScreenRect has exactly these fields; the old `pos` / `p` / `n` / `w` / `h` / `up` aliases never existed)
      const r = deskScreens.screenRect(anchor);
      if (r && r.width > 1e-3 && r.height > 1e-3) {
        const c = r.center, n = r.normal, w = r.width, h = r.height;
        // up = bottom-left → top-left corner (corners: [top-left, top-right, bottom-right, bottom-left])
        const k = r.corners, ul = k.length >= 4 ? Math.hypot(k[0].x - k[3].x, k[0].y - k[3].y, k[0].z - k[3].z) : 0;
        const u = ul > 1e-6 ? { x: (k[0].x - k[3].x) / ul, y: (k[0].y - k[3].y) / ul, z: (k[0].z - k[3].z) / ul } : { x: 0, y: 1, z: 0 };
        return orient({ x: c.x, y: c.y, z: c.z, nx: n.x, ny: n.y, nz: n.z, ux: u.x, uy: u.y, uz: u.z, w, h }, a);
      }
    } catch (e) { console.error('[dive] screenRect', e); }
    const f = (L?.furniture ?? []).find((q) => q.id === anchor);
    const ref = f?.pos ?? a?.pos;
    if (!ref) return null;
    let best: Screen | null = null, bd = 1.0;
    for (const s of sceneScreens()) {
      const d = Math.hypot(s.x - ref.x, s.z - ref.z) + (f ? 0 : 0.3);
      if (d < bd && Math.abs(s.y - (ref.y ?? 0)) < 1.6) { bd = d; best = s; }
    }
    return best ? orient({ ...best }, a) : null;
  }
  /** Normal toward the sitter (flip a plane that faces away). */
  function orient(s: Screen, a: PlayerActor | null | undefined): Screen {
    if (a?.pos && (a.pos.x - s.x) * s.nx + (a.pos.z - s.z) * s.nz < 0) { s.nx = -s.nx; s.ny = -s.ny; s.nz = -s.nz; }
    return s;
  }
  /** The home-desk monitor of an actor working at its desk, else null. */
  function deskScreenFor(a: PlayerActor): { screen: Screen; slot: DirectorSlot } | null {
    const slot = director?.slotFor?.(a?.id);
    if (!slot?.anchor || !a?.pos) return null;
    if (Math.hypot(a.pos.x - slot.pos.x, a.pos.z - slot.pos.z) > 0.6) return null; // away from its desk
    const s = screenOf(slot.anchor, a);
    return s ? { screen: s, slot } : null;
  }
  /** World → [ndcX, ndcY, ndcZ] through the live camera (view offset included). */
  function project(x: number, y: number, z: number): [number, number, number] | null {
    camera.updateMatrixWorld?.(true);
    const V = camera.matrixWorldInverse?.elements, P = camera.projectionMatrix?.elements;
    if (!V || !P) return null;
    const vx = V[0] * x + V[4] * y + V[8] * z + V[12], vy = V[1] * x + V[5] * y + V[9] * z + V[13], vz = V[2] * x + V[6] * y + V[10] * z + V[14];
    const cx = P[0] * vx + P[4] * vy + P[8] * vz + P[12], cy = P[1] * vx + P[5] * vy + P[9] * vz + P[13];
    const cz = P[2] * vx + P[6] * vy + P[10] * vz + P[14], cw = P[3] * vx + P[7] * vy + P[11] * vz + P[15];
    if (cw <= 1e-6) return null;
    return [cx / cw, cy / cw, cz / cw];
  }
  const viewRect = (): ViewRect => {
    const r = dom.getBoundingClientRect?.();
    return r ? { left: r.left, top: r.top, width: r.width, height: r.height } : { left: 0, top: 0, width: globalThis.innerWidth ?? 1920, height: globalThis.innerHeight ?? 1080 };
  };
  /** Snapshot of everything a dive / manager visit must put back exactly. */
  const snapshot = (): Snapshot => ({
    mode, pos: { ...p.pos }, yaw: p.yaw, pitch: p.pitch, level: p.level, held, camY, grounded: p.grounded,
    eye: { x: eye.x, y: mode === 'walk' ? camY ?? p.pos.y + T.eyeHeight : eye.y, z: eye.z },
  });
  function restore(from: Snapshot) {
    p.pos.x = from.pos.x; p.pos.y = from.pos.y; p.pos.z = from.pos.z; p.yaw = from.yaw; p.pitch = from.pitch; p.level = from.level;
    p.vel.x = 0; p.vel.z = 0; vy = 0; dip = 0; dipV = 0; camV = 0; camOff = 0; fovKick = 0; rideKick = 0; bobAmp = 0;
    held = from.held; p.grounded = true; camFov = null;
    if (from.mode === 'sit' && seat) { mode = 'sit'; seat.armed = false; eye.x = from.eye.x; eye.y = from.eye.y; eye.z = from.eye.z; }
    else { mode = 'walk'; camY = from.eye.y; eye.x = from.pos.x; eye.y = from.eye.y; eye.z = from.pos.z; }
  }
  function startDive(a: PlayerActor, o: DiveOptions = {}): boolean {
    if (!a?.pos || (mode !== 'walk' && mode !== 'sit')) return false;
    const found = deskScreenFor(a);
    if (!found) return false;
    const from = snapshot();
    const ex = mode === 'walk' ? p.pos.x : eye.x, ez = mode === 'walk' ? p.pos.z : eye.z;
    const f0: CamPose = { x: ex, y: from.eye.y, z: ez, yaw: p.yaw, pitch: p.pitch, fov: camera.fov ?? p.fov };
    const sitter = { x: a.pos.x, y: a.pos.y ?? 0, z: a.pos.z };
    const df = (L?.furniture ?? []).find((q) => q.id === found.slot.anchor && q.size);
    const desk: DeskBox | null = df ? { x: df.pos.x, z: df.pos.z, c: Math.cos(df.yaw ?? 0), s: Math.sin(df.yaw ?? 0), hw: df.size[0] / 2, hd: df.size[2] / 2, y0: df.pos.y ?? 0, y1: (df.pos.y ?? 0) + df.size[1] } : null;
    const track = diveTrack(f0, found.screen, sitter, { ...(o.track ?? {}), desk });
    dive = { phase: 'in', t: 0, track, from, f0, screen: found.screen, sitter, id: a.id, onScreen: o.onScreen ?? null, rect: null,
      holdU: o.hold == null ? null : Math.max(0, Math.min(1, +o.hold)), announce: false, holdT: 0, back: 0, fov: track.end.fov };
    mode = 'dive'; glide = null; contacts.clear();
    if (globalThis.document?.pointerLockElement === dom) { try { globalThis.document.exitPointerLock?.(); } catch { /* headless */ } }
    bus?.emit('player.dive', { phase: 'start', id: a.id });
    ev('dive', { id: a.id });
    return true;
  }
  function endDive() {
    if (!dive) return false;
    if (dive.phase === 'out') return true;
    // back out along the same track, from wherever the dive is now
    dive.outU = dive.phase === 'hold' ? 1 : Math.min(1, dive.t / dive.track.dur, dive.holdU ?? 1);
    dive.phase = 'out'; dive.t = 0; dive.holdU = null;
    bus?.emit('player.dive', { phase: 'out', id: dive.id });
    return true;
  }
  function stepDive(dt: number) {
    const d = dive;
    if (!d) return;
    if (d.phase === 'in') {
      d.t += dt;
      let u = Math.min(1, d.t / d.track.dur);
      if (d.holdU != null) u = Math.min(u, d.holdU);
      d.track.at(u, diveOut);
      if (u >= 1) { d.phase = 'hold'; d.holdT = 0; }
    } else if (d.phase === 'hold') {
      d.track.at(1, diveOut);
      // the payoff: the screen fills the frame for DIVE.dwell before the drawer opens from it (m3 fix r1)
      d.holdT += dt;
      if (!d.announced && d.holdT >= DIVE.dwell) { d.announced = true; d.announce = true; }
      // the drawer docking narrows the world strip: refit the screen to the strip by widening the lens, never by
      // backing into the sitter (m3 fix r1: the old pull-back along the normal parked the camera inside its body)
      const W = globalThis.innerWidth ?? 0, H = globalThis.innerHeight ?? 0;
      const sw = W - strip.left - strip.right;
      if (sw > 0 && H > 0) {
        const narrow = sw / H < DIVE.aspect - 1e-3;
        const want = diveEnd(d.screen, narrow ? { aspect: sw / H, fill: DIVE.holdFill, fovMax: DIVE.fovHoldMax } : {}, d.sitter);
        const k = 1 - Math.exp(-dt * 6);
        d.back += (want.d - d.track.end.d - d.back) * k;
        d.fov += (want.fov - d.fov) * k;
        const sc = d.screen;
        diveOut.x += sc.nx * d.back; diveOut.y += sc.ny * d.back; diveOut.z += sc.nz * d.back;
        diveOut.fov = d.fov;
      }
    } else {
      d.t += dt;
      const outU = d.outU ?? 0; // set by endDive() before the phase turns 'out'
      const k = Math.min(1, d.t / (DIVE.outDur * Math.max(0.35, outU)));
      d.track.at(outU * (1 - diveEase(k)), diveOut);
      const k3 = 1 - diveEase(Math.min(1, k * 3));
      if (d.back) { const sc = d.screen, b = d.back * k3; diveOut.x += sc.nx * b; diveOut.y += sc.ny * b; diveOut.z += sc.nz * b; }
      if (outU >= 1) diveOut.fov += (d.fov - d.track.end.fov) * k3; // the held lens eases back onto the track's
      if (k >= 1) {
        const id = d.id;
        dive = null; restore(d.from);
        bus?.emit('player.dive', { phase: 'end', id });
        ev('diveEnd', { id });
        return;
      }
    }
    eye.x = diveOut.x; eye.y = diveOut.y; eye.z = diveOut.z; p.yaw = diveOut.yaw; p.pitch = diveOut.pitch;
    camFov = diveOut.fov;
  }
  /** After the camera is placed: announce the monitor's on-screen rect once the dive arrives. */
  function announceDive() {
    const d = dive;
    if (!d?.announce) return;
    d.announce = false;
    d.rect = screenRectPx(d.screen, project, viewRect());
    bus?.emit('player.dive', { phase: 'screen', id: d.id, rect: d.rect });
    try { d.onScreen?.(d.rect); } catch (e) { console.error('[dive] onScreen', e); }
  }

  // ------------------------------------------------------------------ manager's desk (manager.ts)
  const mgrDesk = () => { if (deskMgrL !== L) { deskMgrL = L; deskMgr = managerDesk(L); } return deskMgr; };
  function enterManager() {
    if (mgr || (mode !== 'walk' && mode !== 'sit')) return false;
    if (!L) return false;
    const from = snapshot();
    const start: CamPose = { x: mode === 'walk' ? p.pos.x : eye.x, y: from.eye.y, z: mode === 'walk' ? p.pos.z : eye.z, yaw: p.yaw, pitch: p.pitch, fov: camera.fov ?? p.fov };
    mgr = { phase: 'in', t: 0, pan: { x: 0, z: 0 }, zoom: 1, lookYaw: 0, lookPitch: 0, from, start };
    mode = 'manager'; glide = null; contacts.clear();
    if (globalThis.document?.pointerLockElement === dom) { try { globalThis.document.exitPointerLock?.(); } catch { /* headless */ } }
    bus?.emit('player.manager', { on: true });
    ev('manager', { on: true });
    return true;
  }
  function exitManager() {
    if (!mgr) return false;
    if (mgr.phase !== 'out') {
      mgr.phase = 'out'; mgr.t = 0;
      mgr.outFrom = { x: eye.x, y: eye.y, z: eye.z, yaw: p.yaw, pitch: p.pitch, fov: camFov ?? p.fov };
      bus?.emit('player.manager', { on: false });
    }
    return true;
  }
  function stepManager(dt: number, dirF: number, dirR: number) {
    const m = mgr, O = MANAGER;
    if (!m) return;
    const v = managerView(L, m.pan, m.zoom);
    const tgt: CamPose = { x: v.x, y: v.y, z: v.z, yaw: wrapAngle(v.yaw + m.lookYaw), pitch: v.pitch + m.lookPitch, fov: v.fov };
    let a: CamPose, b: CamPose, k: number;
    if (m.phase === 'in') { m.t += dt; k = diveEase(m.t / O.glide); a = m.start; b = tgt; if (m.t >= O.glide) m.phase = 'on'; }
    else if (m.phase === 'on') {
      if (dirF || dirR) panStep(m.pan, v.yaw, { f: dirF, r: dirR }, dt);
      k = 1; a = tgt; b = tgt;
    } else {
      m.t += dt; k = diveEase(m.t / O.glide); a = m.outFrom ?? tgt; // outFrom is set by exitManager() before the phase turns 'out'
      const f = m.from;
      b = { x: f.mode === 'walk' ? f.pos.x : f.eye.x, y: f.eye.y, z: f.mode === 'walk' ? f.pos.z : f.eye.z, yaw: f.yaw, pitch: f.pitch, fov: p.fov };
      if (m.t >= O.glide) { mgr = null; restore(f); ev('manager', { on: false }); return; }
    }
    // rise / settle along an arc (up first, then over the rail) so the move reads as "lifting off the desk"
    const arc = m.phase === 'on' ? 0 : 0.35 * Math.sin(Math.PI * k);
    eye.x = a.x + (b.x - a.x) * k; eye.y = a.y + (b.y - a.y) * k + arc; eye.z = a.z + (b.z - a.z) * k;
    p.yaw = wrapAngle(a.yaw + wrapAngle(b.yaw - a.yaw) * k); p.pitch = a.pitch + (b.pitch - a.pitch) * k;
    camFov = a.fov + (b.fov - a.fov) * k;
  }
  /** The actor under a canvas click (manager view): → bus 'player.select'. */
  function managerClick(clientX: number, clientY: number): string | null {
    const r = viewRect();
    if (!r.width || !r.height) return null;
    const nx = ((clientX - r.left) / r.width) * 2 - 1, ny = 1 - ((clientY - r.top) / r.height) * 2;
    const id = pickAt(nx, ny, actorsNow(), project, r.width / r.height);
    bus?.emit('player.select', { id, via: 'manager' });
    ev('managerSelect', { id });
    return id;
  }

  const p: Player = {
    pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, z: 0 }, yaw: 0, pitch: 0, fov, inputEnabled: true, eyeHeight: EYE_HEIGHT,
    grounded: true, level: 0,
    get mode() { return mode; },
    /** Slot id of the seat the player sits on (or is gliding into), else null. */
    get seatId() { return seat?.slot?.id ?? null; },
    update(ctx) {
      const dt = Math.min(0.05, ctx.rawDt || 0);
      if (ctx.layout && (!nav || navLayout !== ctx.layout)) {
        if (navLayout !== null || !nav) nav = createNav(ctx.layout);
        navLayout = ctx.layout;
      }
      if (ctx.scene) sceneRef = ctx.scene;
      if (L !== ctx.layout) {
        L = ctx.layout ?? null;
        seats = sittable(L?.slots);
        const sl = L?.slide;
        slidePath = sl && sl.path.length > 1 ? createCamPath(sl.path, { smooth: T.slide.smooth }) : null;
        const pts = pointsOf(L);
        const fb = pts?.bigBoard ?? pts?.pit;
        focusPt = slidePath && fb ? { x: fb.x, y: T.slide.focus.y, z: fb.z } : null;
      }
      pilot.tick(dt);
      const input = p.inputEnabled;
      const k = (c: string) => (input && keys.has(c)) || vkeys.has(c);
      let mx = 0, mz = 0;
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      if (k('KeyW')) { mx += fx; mz += fz; }
      if (k('KeyS')) { mx -= fx; mz -= fz; }
      if (k('KeyA')) { mx += fz; mz -= fx; }
      if (k('KeyD')) { mx -= fz; mz += fx; }
      const l = Math.hypot(mx, mz);
      if (l > 0) { mx /= l; mz /= l; }
      const wantsJump = k('Space');
      if (held && mode === 'walk' && (l > 0 || wantsJump)) { held = false; }
      const sprint = k('ShiftLeft') || k('ShiftRight');
      let hs = 0;
      roll = 0;

      if (mode === 'walk') {
        if (!held) {
          // horizontal: exponential approach (frame-rate independent), 40% air control; stairs cap; slide carry
          let speed = (sprint ? T.sprint : T.walk) * softMul;
          if (onStairs(p.pos.x, p.pos.z)) speed = Math.min(speed, T.stairsMax);
          let tx = mx * speed, tz = mz * speed;
          if (carryT > 0) {
            carryT = Math.max(0, carryT - dt);
            const w = carryT / T.slide.carry;
            tx = carryX * w + tx * (1 - w); tz = carryZ * w + tz * (1 - w);
          }
          const tau = (l > 0 || carryT > 0 ? T.accelTime : T.decelTime) / 3; // reach ~95% in accel/decel time
          const ctrl = p.grounded ? 1 : T.airControl;
          const a = 1 - Math.exp(-(dt * ctrl) / tau);
          p.vel.x += (tx - p.vel.x) * a; p.vel.z += (tz - p.vel.z) * a;
          if (l === 0 && carryT <= 0 && Math.hypot(p.vel.x, p.vel.z) < 0.02) { p.vel.x = 0; p.vel.z = 0; }
          // per-axis slide against the occupancy grid of the current level
          const nx = p.pos.x + p.vel.x * dt, nz = p.pos.z + p.vel.z * dt;
          // started inside something (e.g. a pose): let it walk out, but never let the centre cross a solid cell
          const stuck = hit(p.pos.x, p.pos.z);
          const blockedAt: (x: number, z: number) => boolean = stuck ? (x, z) => nav?.collides?.(x, z, 0, p.level) ?? false : hit;
          if (!blockedAt(nx, p.pos.z)) p.pos.x = nx; else { p.vel.x = 0; carryX = 0; }
          if (!blockedAt(p.pos.x, nz)) p.pos.z = nz; else { p.vel.z = 0; carryZ = 0; }
          // soft actor circles: block, slide around, push through after 0.3 s (§6.10)
          softMul = 1;
          if (softColliders) {
            softList.length = 0;
            for (const a2 of actorsNow()) if (a2 && a2.mode !== 'wait' && a2.mode !== 'leave') softList.push(a2);
            const r = softStep(p.pos, p.vel, softList, contacts, dt, SOFT_OPTS, stuck ? null : (x, z) => hit(x, z), ++frameNo);
            softMul = r.speedMul;
            for (const e of r.events) {
              bus?.emit('player.bump', e);
              try { p.onBump?.(e); } catch (err) { console.error(err); }
              ev('bump', { id: e.id, phase: e.phase });
            }
          }

          // vertical: jump with coyote time + buffer, variable height, auto-step ≤ 0.3 m, level switch on the stairs
          const surf = surfaceAt(p.pos.x, p.pos.z, p.pos.y);
          const ground = surf.y;
          jumpBufT = wantsJump && !jumpHeld ? 0 : jumpBufT + dt;
          jumpHeld = wantsJump;
          if (p.grounded) airT = 0; else airT += dt;
          if (jumpBufT <= T.jump.buffer && airT <= T.jump.coyote && vy <= 0) {
            vy = T.jump.v0; p.grounded = false; jumpBufT = 9; airT = T.jump.coyote + 1;
          }
          if (!p.grounded || p.pos.y > ground + 0.3) {
            if (p.grounded) camOff = camY === null ? 0 : camY - (p.pos.y + T.eyeHeight);
            const g = T.jump.g * (vy > 0 && !wantsJump ? T.jump.releaseMul : 1);
            vy -= g * dt;
            p.pos.y += vy * dt;
            if (p.pos.y <= ground) {
              const vFall = -vy;
              p.pos.y = ground; p.grounded = true; p.level = surf.level; camV = 0;
              if (vFall > 1) {
                const { depth, impulse } = landDipImpulse(vFall, T.landDip);
                if (!reduced) dipV += impulse;
                bus?.emit('player.land', { v: vFall, surface: footSurface() });
                ev('land', { v: vFall, depth: reduced ? 0 : depth });
              }
              vy = 0;
            } else p.grounded = false;
          } else {
            p.pos.y = ground; vy = 0; p.grounded = true; p.level = surf.level;
          }
        }

        // camera height: critically damped toward the probed floor + eye, rate-capped; ballistic while airborne
        let eyeTarget = (p.grounded && !held ? probeFloor(p.pos.x, p.pos.z, p.pos.y) : p.pos.y) + T.eyeHeight;
        if (lift) {
          lift.t += dt;
          const u = Math.min(1, lift.t / lift.dur);
          eyeTarget -= lift.from * (1 - easeInOut(u));
          if (u >= 1) lift = null;
        }
        if (camY === null || held) { camY = eyeTarget; camV = 0; camOff = 0; }
        else if (!p.grounded) { camOff *= Math.exp(-dt / 0.05); camY = eyeTarget + camOff; }
        else if (dt > 0) {
          const w = 3 / T.stepSmooth, x = camY - eyeTarget, e = Math.exp(-w * dt);
          const nxv = (x + (camV + w * x) * dt) * e, nv = (camV - w * (camV + w * x) * dt) * e;
          const cap = T.camMaxRate * dt;
          camY += clamp(eyeTarget + nxv - camY, -cap, cap);
          camV = clamp(nv, -T.camMaxRate, T.camMaxRate);
        }

        // head-bob, phase-locked: φ advances π per footstep; a step event at each vertical trough (φ = kπ, feel.ts)
        hs = Math.hypot(p.vel.x, p.vel.z);
        const moving = p.grounded && hs > 0.3 && !held;
        bobAmp += ((moving ? Math.min(1, hs / T.walk) : 0) - bobAmp) * (1 - Math.exp(-dt / 0.08));
        if (moving) {
          const hz = hs > (T.walk + T.sprint) / 2 ? T.bob.sprintHz : T.bob.walkHz;
          const adv = bobAdvance(dt, hz);
          bobPhase += adv;
          // fire on the frame nearest the trough: up to half a frame early (assuming the next dt ≈ this one), so the
          // footstep lands within ±½ frame of the camera's lowest point instead of 0…1 frame late
          if (bobPhase + adv / 2 >= nextStep * Math.PI) {
            nextStep = stepIndex(bobPhase + adv / 2) + 1;
            bus?.emit('player.step', { surface: footSurface(), speed: hs, foot: nextStep & 1 ? 'right' : 'left' });
            ev('step', { speed: hs });
          }
        }
      } else {
        bobAmp += (0 - bobAmp) * (1 - Math.exp(-dt / 0.08));
        carryT = 0;
      }

      const g = glide;
      if (mode === 'glide' && g) {
        g.t += dt;
        const u = Math.min(1, g.t / g.dur), e = easeInOut(u);
        eye.x = g.from.x + (g.to.x - g.from.x) * e;
        eye.y = g.from.y + (g.to.y - g.from.y) * e + g.arc * Math.sin(Math.PI * u);
        eye.z = g.from.z + (g.to.z - g.from.z) * e;
        p.yaw = g.from.yaw + wrapAngle(g.to.yaw - g.from.yaw) * e;
        p.pitch = g.from.pitch + (g.to.pitch - g.from.pitch) * e;
        if (u >= 1) { glide = null; mode = 'walk'; g.done?.(); }
      }

      if (mode === 'sit' && seat) {
        const s = seat.slot;
        const rel = clamp(wrapAngle(p.yaw - s.yaw), -T.sit.yawClampDeg * DEG, T.sit.yawClampDeg * DEG);
        p.yaw = s.yaw + rel;
        p.pitch = clamp(p.pitch, -T.sit.pitchClampDeg * DEG, T.sit.pitchClampDeg * DEG);
        eye.x = s.pos.x; eye.y = s.pos.y + T.sit.eye; eye.z = s.pos.z;
        const anyKey = l > 0 || wantsJump;
        if (!seat.armed) { if (!anyKey) seat.armed = true; } else if (anyKey) standUp();
      }

      if (mode === 'follow') {
        const fp = followRig.step(dt);
        if (!fp) stopFollowing();
        else {
          eye.x = fp.x; eye.y = fp.y; eye.z = fp.z; p.yaw = fp.yaw; p.pitch = fp.pitch;
          p.pos.x = fp.x; p.pos.z = fp.z; p.vel.x = 0; p.vel.z = 0;
          const f = surfaceAt(fp.x, fp.z, fp.y - T.eyeHeight + 0.3);
          p.pos.y = f.y; p.level = f.level;
        }
      }
      if (mode === 'dive') {
        if (l > 0 || wantsJump) { if (dive && dive.phase !== 'out') endDive(); } // walking away pulls back out
        stepDive(dt);
      }
      if (mode === 'manager') {
        const f = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
        const r = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
        stepManager(dt, f, r);
      }
      let camYaw = p.yaw, camPitch = p.pitch;
      if (mode === 'ride' && ride && slidePath) {
        const S = T.slide, dur = L?.slide?.duration ?? 2.2;
        ride.t += dt;
        const u = Math.min(1, ride.t / dur);
        const sNow = rideEase(u, S.ease) * slidePath.length;
        const smp = slidePath.sample(sNow, ride.smp);
        eye.x = smp.x; eye.y = smp.y + S.tubeLift + S.camUp; eye.z = smp.z;
        p.pos.x = smp.x; p.pos.y = smp.y; p.pos.z = smp.z;
        // coaster cam: look along the travel direction, biased toward the atrium focus (Pit + Big Board) so the helix
        // shows the atrium rather than the E2 wall; the bias is smoothed (it swings round where the helix faces away)
        const v = rideView(sNow, eye, ride.view);
        const head = v.head;
        const yawRate = dt > 0 ? wrapAngle(head - ride.head) / dt : 0;
        ride.head = head;
        const kb = 1 - Math.exp(-dt / S.focus.smooth);
        ride.bias += wrapAngle(v.dYaw - ride.bias) * kb;
        ride.biasPitch += (v.pitch - ride.biasPitch) * kb;
        const rollT = reduced ? 0 : clamp(yawRate * S.rollPerYawRate, -S.rollMaxDeg * DEG, S.rollMaxDeg * DEG);
        ride.roll += (rollT - ride.roll) * (1 - Math.exp(-dt / S.rollSmooth));
        roll = ride.roll;
        hs = rideSpeed(u, S.ease) * slidePath.length / dur;
        camYaw = wrapAngle(head + ride.bias + ride.lookYaw);
        camPitch = clamp(ride.biasPitch + ride.lookPitch, -1.4, 1.4);
        p.yaw = camYaw; p.pitch = camPitch; ride.pitch = camPitch;
        if (u >= 1) { endRide(); camYaw = p.yaw; camPitch = p.pitch; }
      }
      [dip, dipV] = springStep(dip, dipV, dt, T.landDip.omega, T.landDip.zeta);

      // affordance under the reticle (E): ride at the slide mouth, sit on a free seat, stand while seated
      hint = null; hintSeat = null;
      if (mode === 'sit') hint = { verb: 'stand', text: 'stand up' };
      else if (mode === 'manager') hint = { verb: 'stand', text: 'stand up (Esc)' };
      else if (mode === 'walk' && p.grounded && L) {
        const m = L.slide?.mouth;
        const ffx = -Math.sin(p.yaw), ffz = -Math.cos(p.yaw);
        if (slidePath && m && p.level === 1) {
          const dx = m.x - p.pos.x, dz = m.z - p.pos.z, d = Math.hypot(dx, dz);
          if (d <= T.interact.radius && (d < T.interact.nearR || (dx * ffx + dz * ffz) / d > 0)) hint = { verb: 'ride', text: 'ride the slide' };
        }
        if (!hint && seats.length) {
          const cp = Math.cos(p.pitch), ray = {
            x: p.pos.x, y: camY ?? p.pos.y + T.eyeHeight, z: p.pos.z, dx: ffx * cp, dy: Math.sin(p.pitch), dz: ffz * cp,
          };
          const pick = pickSeat(seats, p.pos, p.level, ray, T.interact, occupancy, reachable);
          // the manager's desk: its own stool, or the desk in reach ahead with no other seat under the reticle
          const md = p.level === 1 ? mgrDesk() : null;
          if (md) {
            const dx = md.x - p.pos.x, dz = md.z - p.pos.z, d = Math.hypot(dx, dz);
            const ahead = d <= T.interact.radius + 0.4 && (d < T.interact.nearR || (dx * ffx + dz * ffz) / d > T.interact.cone);
            if ((pick && pick.slot.id === md.slotId) || (ahead && !pick?.aimed)) hint = { verb: 'manage', text: "manager's desk" };
          }
          if (!hint && pick) {
            if (pick.owner) hint = { verb: null, text: `that's ${pick.owner}'s chair` };
            else { hint = { verb: 'sit', text: 'sit', slotId: pick.slot.id }; hintSeat = pick.slot; }
          }
        }
      }

      // walk-mode head-bob + sprint FOV kick; ride FOV kick
      const bobOn = !reduced && mode === 'walk';
      const shape = bobShape(bobPhase);
      const by = bobOn ? shape.y * T.bob.amp * bobAmp : 0;
      const bx = bobOn ? shape.x * T.bob.lateral * bobAmp : 0;
      if (bobOn) roll = shape.roll * (T.bob.rollDeg * DEG) * bobAmp;
      const kickT = !reduced && mode === 'walk' && sprint && hs > T.walk + 0.3 ? T.sprintFovKick : 0;
      fovKick += (kickT - fovKick) * (1 - Math.exp(-dt / ((kickT > fovKick ? T.sprintFovIn : T.sprintFovOut) / 3)));
      const rideT = !reduced && mode === 'ride' ? T.slide.fovKick : 0;
      rideKick += (rideT - rideKick) * (1 - Math.exp(-dt / ((rideT > rideKick ? T.slide.fovIn : T.slide.fovOut) / 3)));

      if (mode === 'walk') {
        const rx = -Math.sin(p.yaw + Math.PI / 2) * bx, rz = -Math.cos(p.yaw + Math.PI / 2) * bx;
        eye.x = p.pos.x + rx; eye.y = (camY ?? 0) + by; eye.z = p.pos.z + rz; // camY is set by the walk block above
      }
      const dipOn = reduced ? 0 : dip;
      camera.position.set(eye.x, eye.y + dipOn, eye.z);
      camera.rotation.set(camPitch, camYaw, roll, 'YXZ');
      const f = camFov ?? p.fov + fovKick + rideKick;
      if (Math.abs(camera.fov - f) > 1e-3) { camera.fov = f; camera.updateProjectionMatrix(); }
      if (dive?.announce) announceDive();
      if (trace) {
        trace.frames.push({
          t: now() - trace.t0, camY: mode === 'walk' ? camY ?? 0 : eye.y, dip: dipOn, bobY: by, bobN: shape.y, bobAmp, fov: f, speed: hs,
          grounded: mode !== 'walk' || p.grounded, mode, ex: eye.x, ey: eye.y + dipOn, ez: eye.z, roll,
        });
        if (trace.frames.length > 36000) trace.done();
      }
    },
    hint: () => hint,
    interact() {
      if (mode === 'manager') { exitManager(); return true; }
      if (mode === 'dive') { endDive(); return true; }
      if (mode === 'sit') { standUp(); return true; }
      if (mode !== 'walk') return true;
      if (hint?.verb === 'manage') { enterManager(); return true; }
      if (hint?.verb === 'ride') { startRide(); return true; }
      if (hint?.verb === 'sit' && hintSeat) { sitDown(hintSeat); return true; }
      return false;
    },
    /**
     * Record camera y, fov, speed and step/land events for `ms`, then analyse (§9.1 `__hq.feelTrace`). With 'run'
     * (or {run:true}) drive the scripted M1.5 traversal instead and return its analysis + checkpoints.
     */
    feelTrace(arg = 3000) {
      const o = typeof arg === 'object' && arg !== null ? arg : null; // (`__hq.feelTrace(null)` reaches here too)
      if (arg === 'run' || o?.run) return runTraversal();
      return startTrace(Number(o ? o.ms : arg) || 0).promise;
    },
    follow(actor) {
      if (!actor?.pos) { if (mode === 'follow') stopFollowing(); return; }
      cancelVisits();
      if (seat) { director?.unclaim?.(PLAYER_ID); seat = null; }
      glide = null; ride = null; carryT = 0; lift = null;
      const ey = mode === 'walk' ? camY ?? p.pos.y + T.eyeHeight : eye.y;
      followRig.start(actor, { x: mode === 'walk' ? p.pos.x : eye.x, y: ey, z: mode === 'walk' ? p.pos.z : eye.z, yaw: p.yaw, pitch: p.pitch });
      mode = 'follow'; held = false; contacts.clear();
    },
    followDebug: (n) => followRig.debug(n),
    dive: (actor, o) => startDive(actor, o),
    undive: () => endDive(),
    /** Dive state (review / tests): {phase, id, u, rect, fov} or null. */
    diveInfo: () => (dive ? { phase: dive.phase, id: dive.id, u: +(dive.phase === 'hold' ? 1 : Math.min(1, dive.t / dive.track.dur, dive.holdU ?? 1)).toFixed(3), rect: dive.rect, fov: +(camFov ?? 0).toFixed(2), minClear: +dive.track.minClear.toFixed(3), endD: +dive.track.end.d.toFixed(3), eye: { x: +eye.x.toFixed(3), y: +eye.y.toFixed(3), z: +eye.z.toFixed(3) } } : null),
    manager: (on) => (on ? enterManager() : exitManager()),
    managerInfo: () => (mgr ? { phase: mgr.phase, pan: { ...mgr.pan }, zoom: mgr.zoom } : null),
    managerDesk: () => mgrDesk(),
    /** Pick + select the actor under a client-px point in the manager view (tests / review; a click does the same). */
    managerClick: (x, y) => (mode === 'manager' ? managerClick(x, y) : null),
    standSpot(actor) {
      if (!actor?.pos) return null;
      const ds = deskScreenFor(actor);
      const sc = ds?.screen;
      // a desk worker is framed on its seated body yaw (the slot's), not the live head turn toward the player (m3 fix r1)
      return standSpot(actor, { layout: L, nav, others: actorsNow(), faceYaw: ds ? ds.slot.yaw ?? actor.yaw ?? 0 : actor.rig ? faceYaw(actor) : actor.yaw ?? 0, seated: !!ds,
        monitor: sc ? { x: sc.x, y: sc.y, z: sc.z, nx: sc.nx, nz: sc.nz, w: sc.w, h: sc.h } : null });
    },
    followInfo: () => (mode === 'follow' ? { id: followRig.target?.id ?? null, ...followRig.info } : null),
    setPose(x, y, z, yaw, pitch) {
      if (mode === 'follow') followRig.start(null);
      cancelVisits();
      if (seat) director?.unclaim?.(PLAYER_ID);
      mode = 'walk'; glide = null; seat = null; ride = null; carryT = 0; lift = null;
      p.pos.x = +x || 0; p.pos.y = +y || 0; p.pos.z = +z || 0; p.yaw = +yaw || 0; p.pitch = clamp(+pitch || 0, -1.5708, 1.5708);
      p.vel.x = 0; p.vel.z = 0; vy = 0; dip = 0; dipV = 0; bobAmp = 0; fovKick = 0; rideKick = 0; camY = null; camV = 0; held = true; p.grounded = true;
      p.level = L?.floorAt ? L.floorAt(p.pos.x, p.pos.z, p.pos.y).level : 0;
      bus?.emit('pose', { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, pitch: p.pitch });
    },
    contacts,
    /** Virtual held keys (event.code) merged with the keyboard: the feelTrace autopilot and tests drive through it. */
    virtualKeys: vkeys,
    onBump: null,
    setSoftColliders(fn) { softColliders = typeof fn === 'function' ? fn : null; if (!softColliders) contacts.clear(); },
    getPose: () => [p.pos.x, p.pos.y, p.pos.z, p.yaw, p.pitch],
    setFov(f) { p.fov = clamp(f, 30, 100); },
    dispose() {
      trace?.done();
      removeEventListener('keydown', kd); removeEventListener('keydown', kdEsc, true); removeEventListener('keyup', ku); removeEventListener('blur', blur);
      dom.removeEventListener('mousedown', md); removeEventListener('mouseup', mu); removeEventListener('mousemove', mm);
      removeEventListener('wheel', wheel); removeEventListener('mousedown', mdWin, true); offDrawer?.(); offStrip?.();
    },
  };

  /** setPose / follow take the camera: a dive or a manager visit ends on the spot (no glide back). */
  function cancelVisits() {
    if (dive) { const id = dive.id; dive = null; bus?.emit('player.dive', { phase: 'end', id, cancelled: true }); }
    if (mgr) { mgr = null; bus?.emit('player.manager', { on: false }); }
    camFov = null;
    if (mode === 'dive' || mode === 'manager') mode = 'walk';
  }

  /** Leave follow: the feet drop to the floor under the camera spot (or the nearest free spot) and the eye eases down. */
  function stopFollowing() {
    followRig.start(null);
    if (mode !== 'follow') return;
    mode = 'walk';
    const f = surfaceAt(eye.x, eye.z, eye.y - T.eyeHeight + 0.3);
    p.pos.x = eye.x; p.pos.z = eye.z; p.pos.y = f.y; p.level = f.level;
    p.vel.x = 0; p.vel.z = 0; vy = 0; p.grounded = true; held = false;
    camY = eye.y; camV = 0; camOff = 0;
    lift = null;
  }

  function startTrace(ms: number) {
    trace?.done();
    let resolve: (v: FeelAnalysis) => void = () => {}; // replaced synchronously by the executor below
    const promise = new Promise<FeelAnalysis>((r) => { resolve = r; });
    const t: Trace = { frames: [], events: [], t0: now(), done: () => {} };
    const timer = ms > 0 ? setTimeout(() => t.done(), ms) : undefined;
    t.done = () => { clearTimeout(timer); if (trace === t) trace = null; resolve(analyseFeel(t.frames, t.events)); };
    trace = t;
    return { promise, stop: () => { t.done(); return promise; } };
  }

  const pilot = createPilot({ p, vkeys, nav: () => nav });
  async function runTraversal(): Promise<TraversalResult> {
    const tr = startTrace(0);
    let run: Checkpoint[] | null = null, error: string | null = null;
    try {
      run = await traversal(pilot, {
        p, layout: () => L, nav: () => nav, now: () => now() - (trace?.t0 ?? 0),
        freeSeat: (tags, near) => {
          let best: Slot | null = null, bd = Infinity;
          for (const s of seats) {
            if (!tags.includes(s.tag) || occupancy(s)) continue;
            const ax = s.pos.x - Math.sin(s.yaw) * 0.75, az = s.pos.z - Math.cos(s.yaw) * 0.75;
            if (hit(ax, az, s.level ?? 0)) continue;
            const d = (s.pos.x - near.x) ** 2 + (s.pos.z - near.z) ** 2;
            if (d < bd) { bd = d; best = s; }
          }
          return best;
        },
      });
    } catch (e) { error = errMessage(e); }
    pilot.stop(); vkeys.clear();
    const a = await tr.stop();
    return { ...a, run, error };
  }

  // Esc outside xterm / text fields pulls back out of a dive and stands up from the manager's desk (not consumed:
  // the UI's Esc still runs for its own scope)
  const kdEsc = (e: KeyboardEvent) => {
    if (e.code !== 'Escape' || (mode !== 'dive' && mode !== 'manager') || typingTarget(e.target)) return;
    if (mode === 'dive') endDive(); else exitManager();
  };
  const kd = (e: KeyboardEvent) => {
    if (!p.inputEnabled || e.ctrlKey || e.metaKey || e.altKey || typingTarget(e.target)) return;
    keys.add(e.code);
    if (e.code === 'Space' && document.pointerLockElement === dom) e.preventDefault();
  };
  const ku = (e: KeyboardEvent) => keys.delete(e.code);
  const blur = () => keys.clear();
  /**
   * A press "on the world": the canvas itself, or a full-viewport overlay layer above it (the UI root, a stat
   * tooltip layer, an FX canvas) rather than a widget. The manager view listens on the window for this, because
   * those layers can sit over the canvas and swallow its events.
   */
  const onWorld = (e: Event) => {
    const t = e?.target;
    if (t === dom) return true;
    if (!globalThis.Element || !(t instanceof globalThis.Element) || typingTarget(t) || t.closest?.('button,a,input,select,textarea,[role],[tabindex]')) return false;
    if (t.tagName === 'CANVAS') return true;
    const r = t.getBoundingClientRect?.();
    return !!r && r.width >= (globalThis.innerWidth ?? 0) * 0.9 && r.height >= (globalThis.innerHeight ?? 0) * 0.9;
  };
  const mdWin = (e: MouseEvent) => {
    if (mode !== 'manager' || e.button !== 0 || !onWorld(e)) return;
    mouse.mgrDrag = true; mouse.moved = 0; mouse.downX = e.clientX; mouse.downY = e.clientY;
  };
  const md = (e: MouseEvent) => {
    if (mode === 'manager' || mode === 'dive') return; // no pointer lock: the cursor picks agents (manager) / the camera is on rails (dive)
    if (e.button === 0) { dragging = true; try { dom.requestPointerLock?.()?.catch?.(() => {}); } catch { /* headless */ } } };
  const mu = (e: MouseEvent) => {
    dragging = false;
    if (mouse.mgrDrag) {
      mouse.mgrDrag = false;
      if (mode === 'manager' && mgr?.phase === 'on' && mouse.moved < 6 && onWorld(e)) managerClick(e.clientX, e.clientY);
    }
  };
  const wheel = (e: WheelEvent) => {
    if (mode !== 'manager' || !mgr || !onWorld(e)) return;
    e.preventDefault?.();
    mgr.zoom = clamp(mgr.zoom * Math.exp((e.deltaY ?? 0) * 0.001), MANAGER.zoom[0], MANAGER.zoom[1]);
  };
  const mm = (e: MouseEvent) => {
    if (mouse.mgrDrag && mode === 'manager' && mgr) {
      mouse.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
      const c = MANAGER.lookClamp;
      mgr.lookYaw = clamp(mgr.lookYaw - e.movementX * T.lookSens, -c[0], c[0]);
      mgr.lookPitch = clamp(mgr.lookPitch - e.movementY * T.lookSens, -c[1], c[1]);
      return;
    }
    if (!p.inputEnabled || !(dragging || document.pointerLockElement === dom) || mode === 'glide' || mode === 'dive' || mode === 'manager') return;
    const dx = e.movementX * T.lookSens, dy = e.movementY * T.lookSens;
    if (mode === 'ride' && ride) {
      const c = T.slide.lookClampDeg * DEG;
      ride.lookYaw = clamp(ride.lookYaw - dx, -c, c);
      ride.lookPitch = clamp(ride.lookPitch - dy, -c, c);
      return;
    }
    if (mode === 'follow') { followRig.nudge(dx * 1.5); return; }
    p.yaw -= dx;
    p.pitch = clamp(p.pitch - dy, -T.pitchLimit, T.pitchLimit);
  };
  // `__hq.feelTrace({follow: id|null, resetPerf?})` is the follow probe (review / shots; no new pluggable __hq name):
  // follows an actor by id (null ends it) → {info, perf: worst per-frame scoring slice / last full pass, ms}
  const followProbe = (o: FollowProbeArg) => {
    if ('follow' in o) {
      const a = o.follow == null ? null : [...actorsNow()].find((x) => x?.id === o.follow) ?? null;
      if (o.follow != null && !a) return { error: `no actor ${o.follow}`, ids: [...actorsNow()].map((x) => x?.id) };
      p.follow(a);
    }
    if ('slices' in o) followRig.slices = o.slices;
    if (o.resetPerf) followRig.resetPerf();
    return { info: p.followInfo(), perf: followRig.perf };
  };
  // `__hq.feelTrace({dive: id, hold?: u} | {undive: true} | {manager: bool, click?: [x, y]} | {standSpot: id})`: the
  // dive / manager / stand-spot probe (review shots; `hold` freezes the dive at normalised time u for frame sequences)
  const byId = (id: string | null | undefined) => [...actorsNow()].find((x) => x?.id === id) ?? null;
  const visitProbe = (o: VisitProbeArg) => {
    if ('standSpot' in o) { const a = byId(o.standSpot); return a ? { spot: p.standSpot(a) } : { error: `no actor ${o.standSpot}` }; }
    if ('dive' in o) {
      if (o.dive == null) return { ok: endDive(), dive: p.diveInfo() };
      const a = byId(o.dive);
      if (!a) return { error: `no actor ${o.dive}` };
      if (dive && o.hold != null && dive.id === a.id) { dive.holdU = Math.max(0, Math.min(1, +o.hold)); return { ok: true, dive: p.diveInfo() }; }
      return { ok: startDive(a, { hold: o.hold }), dive: p.diveInfo() };
    }
    if ('undive' in o) return { ok: endDive(), dive: p.diveInfo() };
    if ('manager' in o) {
      const ok = o.manager ? enterManager() : exitManager();
      if (mgr && o.pan) { mgr.pan.x = o.pan.x ?? 0; mgr.pan.z = o.pan.z ?? 0; }
      if (mgr && o.zoom) mgr.zoom = o.zoom;
      const sel = o.click && mode === 'manager' ? managerClick(o.click[0], o.click[1]) : undefined;
      return { ok, manager: p.managerInfo(), desk: mgrDesk(), select: sel };
    }
    return null;
  };
  const PROBE_KEYS = ['follow', 'resetPerf', 'slices'], VISIT_KEYS = ['dive', 'undive', 'manager', 'standSpot'];
  const isVisitProbe = (a: object): a is VisitProbeArg => VISIT_KEYS.some((k) => k in a);
  const isFollowProbe = (a: object): a is FollowProbeArg => PROBE_KEYS.some((k) => k in a);
  hqRegister('feelTrace', (arg?: FeelArg | FeelProbeArg | null) => {
    if (arg && typeof arg === 'object') {
      if (isVisitProbe(arg)) return Promise.resolve(visitProbe(arg));
      if (isFollowProbe(arg)) return Promise.resolve(followProbe(arg));
    }
    return p.feelTrace(arg);
  });
  hqStatSection('player', () => ({ mode, dive: p.diveInfo(), manager: p.managerInfo(), follow: p.followInfo(), level: p.level, grounded: p.grounded, hint: hint?.text ?? null, hintSeat: hintSeat?.id ?? null, seat: seat?.slot?.id ?? null, speed: +Math.hypot(p.vel.x, p.vel.z).toFixed(2) }));
  // capture phase, registered before the UI's (main.ts creates the player first): the UI's key table consumes Esc
  addEventListener('keydown', kdEsc, true);
  addEventListener('keydown', kd); addEventListener('keyup', ku); addEventListener('blur', blur);
  dom.addEventListener('mousedown', md); addEventListener('mouseup', mu); addEventListener('mousemove', mm);
  addEventListener('wheel', wheel, { passive: false });
  addEventListener('mousedown', mdWin, true);
  // the drawer the dive opened collapsing / closing pulls the camera back out of the screen
  const offStrip = bus?.on('viewStrip', (v) => { strip = { left: +v?.left || 0, right: +v?.right || 0 }; });
  const offDrawer = bus?.on('drawer', (d) => {
    if (!dive || dive.phase !== 'hold') return;
    if (d?.open) dive.sawOpen = true;
    else if (dive.sawOpen) endDive();
  });
  return p;
}
