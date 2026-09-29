/**
 * `window.__hq` (§9.1): always present. Every name in the §9.1 surface exists; calls whose owner has not landed yet
 * return `null`. Owners plug in implementations with `hqRegister(name, fn)` instead of editing this file
 * (e.g. RND's probe.ts: `hqRegister('probe', (x, y) => …)`; LVL's walk metrics: `hqRegister('metrics', …)`).
 * Owner: CORE.
 */
import * as THREE from 'three';
import { MASK } from '../render/layers.ts';
import { overBudget, overTriBudget, DRAW_BUDGET, TRI_BUDGET } from './drawSplit.ts';
import type { ProgramSplit } from './drawSplit.ts';
import type { Ctx } from './ctx.ts';
import { isRecord } from '../../../shared/guards.ts';
import type { Entity, ClientMsg, ReplyMsg } from '../../../shared/protocol.ts';
import type { PoseDef } from '../debug/poses.ts';
import type { ProbeApi } from '../debug/probe.ts';
import type { FrameCheckFn } from '../debug/frameCheck.ts';
import type { Layout, Slot } from '../world/layout/schema.ts';
import type { FeelArg, FeelProbeArg } from '../player/controller.ts';

/** Names of the §9.1 surface that owners provide through `hqRegister`. */
export const HQ_PLUGGABLE = Object.freeze([
  'probe', 'lumaStats', 'surfaceStats', 'clayCheck', 'edgeCheck', 'hueGapCheck', 'greyCheck', 'placardCheck', 'feelTrace', 'frameCheck',
  'metrics', 'away', 'keyScope', 'select', 'openTerminal', 'closeTerminal', 'roster',
  'goTo', 'goToSpot', // [LEAD m2 fix r2, cross-owner CORE] UI's ui/index.ts registers them (review); unlisted, boot threw in createUI
  'walkUp', // [UI M3.5, cross-owner CORE] UI's walk-up stand pose for a desk worker (__hq.focus uses it; ui/index.ts)
  'walkUpCheck', // [UI fix r1, cross-owner CORE] review: walk up to every working desk, face + live unoccluded screen
] as const);
export type HqPluggable = (typeof HQ_PLUGGABLE)[number];

/** What UI's `walkUp` reports about a framed desk worker (the fields `focus` reads). */
export interface WalkUpResult { side?: number | null; cf?: number | null; following?: boolean; [k: string]: unknown }
/** The signature of every pluggable `__hq` call: the owner registers an implementation, callers get it typed. */
export interface HqPlug {
  probe: ProbeApi['probe'];
  lumaStats: ProbeApi['lumaStats'];
  surfaceStats: ProbeApi['surfaceStats'];
  clayCheck: ProbeApi['clayCheck'];
  edgeCheck: ProbeApi['edgeCheck'];
  hueGapCheck: ProbeApi['hueGapCheck'];
  greyCheck: ProbeApi['greyCheck'];
  placardCheck: () => unknown;
  feelTrace: (arg?: FeelArg | FeelProbeArg | null) => Promise<unknown>;
  frameCheck: FrameCheckFn;
  metrics: (reset?: boolean) => unknown;
  away: (minutes?: number) => unknown;
  keyScope: () => string | null;
  select: (id: string | null) => unknown;
  openTerminal: (id: string) => unknown;
  closeTerminal: () => unknown;
  roster: (open?: boolean, groupBy?: string) => unknown;
  goTo: (id: string) => unknown;
  /** where "go there" would end (`withLog`: + the candidate log) */
  goToSpot: (id: string, withLog?: boolean) => unknown;
  /** UI's walk-up stand pose for a desk worker: `tier` 0 / 1 = face + screen / side view, 'settle' = follow until it settles */
  walkUp: (id: string, tier?: 0 | 1 | 'settle') => WalkUpResult | null | undefined;
  walkUpCheck: (o?: Record<string, unknown>) => Promise<unknown>;
}

/** Non-fatal boot problems (unknown hqRegister names, …), surfaced as `__hq.stats().bootErrors` / `bootErrorList`. */
export const hqBootErrors: string[] = [];

const plugged = new Map<string, HqPlug[HqPluggable]>();
/** extra `stats()` sections, e.g. ('fx', () => counters) */
const statSections = new Map<string, () => unknown>();
const isPluggable = (name: string): name is HqPluggable => HQ_PLUGGABLE.some((n) => n === name);
// `plugged` holds, under each name, the implementation `hqRegister` accepted for exactly that name's signature.
const pluggedFn = <K extends HqPluggable>(name: K): HqPlug[K] | undefined => plugged.get(name) as HqPlug[K] | undefined;

/**
 * Provide (or replace) the implementation of a pluggable `__hq` call.
 * `ifAbsent`: keep an implementation an owner already registered (main.ts fallbacks)
 */
export function hqRegister<K extends HqPluggable>(name: K, fn: HqPlug[K], { ifAbsent = false }: { ifAbsent?: boolean } = {}): void {
  if (!isPluggable(name)) {
    const msg = `hqRegister: ${name} is not a pluggable __hq call (add it to HQ_PLUGGABLE)`;
    // Under node (tests) a typo must fail loudly; in the running app it must never stop boot (m2 r3 review): log it,
    // count it in `__hq.stats().bootErrors`, and still register it so the owner's call works.
    if (typeof window === 'undefined') throw new Error(msg);
    console.error(msg);
    hqBootErrors.push(msg);
  }
  if (ifAbsent && plugged.has(name)) return;
  plugged.set(name, fn);
}

/** Add a section to `__hq.stats()`. */
export function hqStatSection(key: string, fn: () => unknown): void { statSections.set(key, fn); }

const call = <K extends HqPluggable>(name: K) => (...args: Parameters<HqPlug[K]>): ReturnType<HqPlug[K]> | null => {
  // (TS cannot relate the generic HqPlug[K] to its own parameter list: the one cast)
  const fn = pluggedFn(name) as ((...a: Parameters<HqPlug[K]>) => ReturnType<HqPlug[K]>) | undefined;
  return fn ? fn(...args) : null;
};

/** What `__hq` reads of an actor's rig: the root and the face plate (Clawd `faceRoot` / Shelly `screen`). */
export interface FaceRigView { root: THREE.Object3D; nodes: { faceRoot?: THREE.Object3D | null; screen?: THREE.Object3D | null } }
/** Sight target: [x, y, z, stop-short margin]. */
type Target = [number, number, number, number];
/** The slice of an entity `__hq.match` / `.actors` reads. */
export type HqEntityView = Pick<Entity, 'name' | 'status' | 'kind' | 'activity' | 'process' | 'workspace'>;
/** What `__hq` (focus shots, `actors()`, `match()`) reads of an actor. */
export interface HqActor extends FocusActor {
  entity: HqEntityView;
  hidden?: boolean;
}
/** What the hero-order / settle rules read. */
export interface SettleActor {
  intent?: { slot?: { tag: string; id?: string; pose?: Slot['pose'] } | null; activity?: string | null } | null;
  arrived?: boolean;
  animator?: { debug?: { speed?: number } | null } | null;
}
/** What a focus shot reads of an actor. */
export interface FocusActor extends SettleActor {
  id: string;
  pos: { x: number; y: number; z: number };
  yaw: number;
  rig?: FaceRigView | null;
}
/** What a focus shot reads of the ctx (`Ctx` satisfies it). */
export interface FocusCtx {
  scene: THREE.Object3D;
  player: { eyeHeight?: number };
  layout?: (Pick<Layout, 'floorY'> & Partial<Pick<Layout, 'floorAt'>>) | null;
}
/** What `faceYaw` reads of an actor. */
export interface FaceActor { yaw: number; rig?: FaceRigView | null }
export interface HqActors { list(): HqActor[]; get(id: string): HqActor | null | undefined; count(): number }
/** The nav queries the hero-shot search makes (world/nav facade). */
export interface HqNav { walkable(x: number, z: number, level: number): boolean; collides(x: number, z: number, r: number, level: number): boolean }

/** `__hq.stats()`: the fixed fields, plus one entry per `hqStatSection`. */
export interface HqStats {
  fps: number; frameMs: number; cpuMs: number; gpuMs: number | null;
  drawCalls: { main: number; shadow: number; portrait: number; portraits?: number; post?: number; prepass?: number; total?: number };
  triangles: number;
  programs: ProgramSplit;
  frameErrors: number; bootErrors: number;
  textures: number | null; geometries: number | null;
  entities: number; actors: number; quality: string; renderScale: number;
  zone: string | null; conn: string; herdr: boolean; demo: boolean; frame: number; hidden: boolean;
  pose: number[];
  overBudget: string[];
  budget: Readonly<Record<string, number | object>>;
  trianglesSplit: TriSplit | null;
  [section: string]: unknown;
}
type TriSplit = { main: number; env: number; chars: number; stat: number };
const isTriSplit = (v: unknown): v is TriSplit =>
  isRecord(v) && typeof v.main === 'number' && typeof v.env === 'number' && typeof v.chars === 'number' && typeof v.stat === 'number';

export interface DebugDeps {
  ctx: Ctx;
  ready: Promise<void>;
  actors: HqActors;
  /** store call() */
  call: (msg: ClientMsg) => Promise<ReplyMsg>;
  poses: Readonly<Record<string, PoseDef>>;
  /** world/nav facade (focus() rejects camera spots inside colliders) */
  nav?: HqNav | null;
  /** §5.3 program split (core/drawSplit.ts) */
  programs?: () => ProgramSplit;
}

/**
 * `__hq.focus` framing (§9.1 hero shots): a 3/4 view of an actor. Candidate spots around it, ±50° off its facing first
 * (both sides), then wider angles / distances; a spot is rejected when the player circle collides with the nav grid,
 * stands inside another actor, a sightline (body centre + flanks, eyes / face centre / mouth on the face plate) hits
 * world geometry (raycast, world layers only) or passes through another actor, or another actor stands between the
 * lens and the subject inside the view cone (foreground intruder). Feet are always on the floor.
 *
 * Desk mode (an actor seated at a desk — auto from its slot, or `mode.desk`): the face looks into its monitor, so a
 * ±50° side view only ever shows a cheek. Instead it frames over the monitor from the front 3/4 (0–45° off the face,
 * further back so the eye line clears the screen), aims at the face rather than the body, and requires the face plate
 * to look at the lens (facing ≥ 0.7). Eyes, face and mouth must be visible; the body / frame sightlines are soft (the
 * monitor and desk edge may fill the lower frame).
 * Returns the shot finder. side = degrees off the actor's facing (faceYaw); clear = every sightline free and no
 * foreground intruder (else the best-scoring spot); miss = names of the blocked sightlines, intruders = ids of actors in
 * the foreground.
 */
export interface FocusMode {
  /** over-the-monitor desk framing (default: the actor sits at a desk / table slot) */
  desk?: boolean;
  /** min cos(face normal, face→lens) for a `clear` shot (default 0.42 = 65°; desk 0.7) */
  minFacing?: number;
  /** false: skip UI's walk-up framing (hero sheet) */
  walkUp?: boolean;
  /** false: no follow-until-settled fallback */
  settle?: boolean;
}
export interface FocusShot {
  pose: [number, number, number, number, number];
  side: number;
  clear: boolean;
  facing?: number;
  desk?: boolean;
  miss?: string[];
  intruders?: string[];
  score?: number;
}
/** One row of the `focusCandidates` diagnostics log. */
export interface FocusLogRow { deg: number; r: number; skip?: 'nav' | 'actor'; clear?: boolean; facing?: number; hits?: Record<string, string | null> | null; intruders?: string[]; companions?: number; n?: number }
export type FocusShotFn = (a: FocusActor, dist: number, height: number, log?: FocusLogRow[] | null, mode?: FocusMode) => FocusShot;

/** Is the actor seated at (or heading to) a desk slot? */
export const atDesk = (a: SettleActor): boolean => a.intent?.slot?.tag === 'desk';
/** Slots where the actor sits facing a table (desk, hot desk, round table, library table): the face looks across the
 *  table, so a side view only shows a cheek — framed like a desk sitter, over the table from the front 3/4. */
const TABLE_TAGS = new Set(['desk', 'hotdesk', 'station:roundtable', 'station:library']);
export const atTable = (a: SettleActor): boolean => {
  const tag = a.intent?.slot?.tag;
  return tag !== undefined && TABLE_TAGS.has(tag) && (a.intent?.slot?.pose ?? 'sit') === 'sit';
};
/** Hero-shot candidate order (stable): settled at a desk, settled elsewhere, walking to a desk, walking elsewhere. */
export function heroOrder<A extends SettleActor>(list: A[]): A[] {
  const rank = (a: A) => (isSettled(a) ? 0 : 2) + (atDesk(a) ? 0 : 1);
  return list.map((a, i) => ({ a, r: rank(a), i })).sort((x, y) => x.r - y.r || x.i - y.i).map((x) => x.a);
}
/** Has the actor arrived at its slot and stopped (seated at a desk, standing at a station…)? Hero shots want these. */
export const isSettled = (a: SettleActor): boolean => !!a.arrived && (a.animator?.debug?.speed ?? 0) < 0.05;

export function createFocusShot({ ctx, actors, nav = null }: { ctx: FocusCtx; actors: { list(): FocusActor[] }; nav?: HqNav | null }): FocusShotFn {
  const ray = new THREE.Raycaster();
  ray.layers.mask = MASK.world; // architecture + props only; characters are checked analytically below
  const v0 = new THREE.Vector3(), v1 = new THREE.Vector3();
  const wp = new THREE.Vector3();
  /**
   * Sight targets [x, y, z, stop-short margin]: body centre + flanks, eyes / face centre / mouth on the face plate
   * (Clawd face / Shelly screen, from the live rig, oriented by faceYaw) so a monitor or lamp pole in front of the face
   * counts as occluding, and two frame-corridor points beside the face.
   */
  const sightTargets = (a: FocusActor): Target[] => {
    const fy = faceYaw(a), fx = -Math.sin(fy), fz = -Math.cos(fy), rx = -fz, rz = fx; // face forward / right in world xz
    const n = a.rig?.nodes;
    const faceNode = n?.faceRoot ?? n?.screen ?? null;
    let cx = a.pos.x, cy = (a.pos.y ?? 0) + 0.8, cz = a.pos.z, fwd = 0.25;
    if (faceNode && a.rig) {
      a.rig.root.updateMatrixWorld(true);
      faceNode.getWorldPosition(wp);
      cx = wp.x; cy = wp.y; cz = wp.z; fwd = n?.faceRoot ? 0.25 : 0.02;
    }
    const by = (a.pos.y ?? 0) + 0.45;
    const t: Target[] = [[a.pos.x, by, a.pos.z, 0.3]];
    for (const s of [-0.2, 0.2]) t.push([a.pos.x + rx * s, by, a.pos.z + rz * s, 0.3]); // body flanks
    // Eyes + the face centre (a thin lamp pole / cable between the eyes counts), and the mouth below: the live Clawd
    // face parts when the rig has them (they sit above / below the faceRoot centre), else estimates on the face plate.
    const eyeL = n?.faceRoot?.getObjectByName('eyeL'), eyeR = n?.faceRoot?.getObjectByName('eyeR');
    const mouth = n?.faceRoot?.getObjectByName('mouth');
    if (eyeL && eyeR && mouth) {
      const pl = eyeL.getWorldPosition(new THREE.Vector3()), pr = eyeR.getWorldPosition(new THREE.Vector3());
      const pm = mouth.getWorldPosition(new THREE.Vector3());
      t.push([pl.x, pl.y, pl.z, 0.02], [(pl.x + pr.x) / 2, (pl.y + pr.y) / 2, (pl.z + pr.z) / 2, 0.02], [pr.x, pr.y, pr.z, 0.02], [pm.x, pm.y, pm.z, 0.02]);
    } else {
      for (const s of [-0.13, 0, 0.13]) t.push([cx + fx * fwd + rx * s, cy, cz + fz * fwd + rz * s, 0.02]);
      t.push([cx + fx * fwd, cy - 0.12, cz + fz * fwd, 0.02]);
    }
    // Frame corridor: just beside the subject at face height, so a lamp pole / plant a hand's width off the face line
    // (slicing the middle of the frame) also rejects the spot. Stops well short of the subject's own depth.
    for (const s of [-0.42, 0.42]) t.push([cx + rx * s, cy, cz + rz * s, 0.35]);
    return t;
  };
  const TARGET_NAMES = ['body', 'bodyL', 'bodyR', 'eyeL', 'face', 'eyeR', 'mouth', 'frameL', 'frameR'];
  const SOFT_TARGETS = new Set(['bodyL', 'bodyR', 'mouth', 'frameL', 'frameR']);
  /** Desk mode: the monitor may hide the body; the whole face (eyes, centre, mouth) may not. */
  const DESK_SOFT = new Set(['body', 'bodyL', 'bodyR', 'frameL', 'frameR']);
  /** Held props / worn items live under a rig on a world layer: never an occluder (actors are handled analytically). */
  let lastHit: string | null = null;
  const onActor = (o: THREE.Object3D): boolean => {
    const roots = new Set<THREE.Object3D>();
    for (const b of actors.list()) if (b.rig) roots.add(b.rig.root);
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (roots.has(p)) return true;
    return false;
  };
  /** Is the segment eye → (tx,ty,tz) free of world geometry and other actors? */
  const sightClear = (a: FocusActor, ex: number, ey: number, ez: number, tx: number, ty: number, tz: number, margin: number): boolean => {
    v0.set(ex, ey, ez); v1.set(tx - ex, ty - ey, tz - ez);
    const len = v1.length(); v1.divideScalar(len);
    ray.set(v0, v1); ray.far = len - margin; // stop just short of the actor itself
    const hit = ray.intersectObject(ctx.scene, true).find((h) => h.object.visible !== false && !onActor(h.object));
    if (hit) { lastHit = hit.object.name || hit.object.parent?.name || hit.object.type; return false; }
    lastHit = null;
    const L = Math.hypot(tx - ex, tz - ez) || 1, ux = (tx - ex) / L, uz = (tz - ez) / L;
    for (const b of actors.list()) { // other characters standing in the sightline (they're not raycastable)
      if (b === a) continue;
      const bx = b.pos.x - ex, bz = b.pos.z - ez;
      const t = bx * ux + bz * uz;
      if (t > 0.3 && t < L - 0.3 && Math.abs(bx * uz - bz * ux) < 0.45) { lastHit = `actor ${b.id}`; return false; } // ~half a Clawd's width + arms
    }
    return true;
  };
  const D = Math.PI / 180;
  /** Foreground-clutter probe directions [yaw, pitch] off the view axis (the centre column is the sightlines' job). */
  const FG_RAYS = ([[-24, -10], [-12, -10], [12, -10], [24, -10], [-24, 8], [-12, 8], [12, 8], [24, 8]] as const).map(([h, v]): [number, number] => [h * D, v * D]);
  const FACE_MIN_COS = Math.cos((65 * Math.PI) / 180); // hero: the face plate within 65° of facing the lens
  const FRAME_COS = Math.cos((50 * Math.PI) / 180); // 16:9 at the default fov ≈ ±45° horizontal, + a margin
  // Candidates in preference order: [degrees off facing, distance factor]; ± sides tried back to back.
  const TRIES: [number, number][] = [[50, 1], [65, 1], [35, 1], [50, 1.35], [80, 1], [80, 1.35], [20, 1.4], [50, 1.8], [0, 1.8], [80, 1.8],
    [50, 2.4], [0, 2.4], [35, 0.75], [0, 0.75], [60, 0.75], [110, 1.2], [140, 1.4], [180, 1.6]];
  // (0.75: a close-up from inside a crowd — the overflow grid leaves no free 1.5 m sightline, but an arm's length does)
  // Desk mode: front 3/4 over the monitor. Nearer spots stand inside the desk pod, so it starts further back; the
  // angle stays within 45° (facing ≥ 0.7). Preference: ~25° off, then nearer, then squarer / wider.
  const DESK_TRIES: [number, number][] = [];
  for (const k of [1.1, 1.3, 1.5, 1.75, 2, 2.4]) for (const deg of [25, 15, 35, 0, 45]) DESK_TRIES.push([deg, k]);
  return (a, dist, height, log = null, mode = {}) => {
    const desk = mode.desk ?? atTable(a); // [CORE fix r2] round/library tables too (cls:task hero at the roundtable)
    const minCos = mode.minFacing ?? (desk ? DESK_MIN_FACING : FACE_MIN_COS);
    const soft = desk ? DESK_SOFT : SOFT_TARGETS;
    const facing = faceYaw(a); // where the face actually looks (body yaw + animated turn)
    const feetA = a.pos.y ?? 0;
    // [INT M1.5] the camera stands on the subject's level (mezzanine subjects were framed from the atrium floor below)
    const lvl = ctx.layout?.floorAt ? ctx.layout.floorAt(a.pos.x, a.pos.z, feetA).level : 0;
    const floor = (x: number, z: number): number => ctx.layout?.floorY?.(x, z, lvl) ?? 0;
    const eyeH = ctx.player.eyeHeight ?? 1.2;
    const targets = sightTargets(a);
    const face = faceFrame(a); // null without a live rig
    // Aim: the body (half the §9.1 `height`: 1.1 → 0.55 m above the feet); desk mode: ~0.18 m under the face centre,
    // so the face sits above the middle of the frame (clear of the centre-screen interaction prompt) and the monitor
    // edge, if any, in the lower part.
    const lookY = desk ? Math.max(0.3, (face ? face.p.y : (targets[4]?.[1] ?? 0)) - feetA - 0.18) : height / 2;
    const tries: [number, number][] = [];
    for (const [deg, k] of desk ? DESK_TRIES : TRIES) {
      for (const s of deg === 0 || deg === 180 ? [1] : [1, -1]) tries.push([deg * s, dist * k]);
    }
    // Every candidate is scored; `clear` ones (core sightlines free, nobody in the foreground) always beat the rest.
    // Among clear spots the soft score prefers: free frame corridor, a true 3/4 angle (side views of a cube face read
    // badly), the TRIES order, and fewer neighbours sharing the frame.
    // `best` is assigned inside the forEach callback, which TS's flow analysis does not see: hold it in a box
    const box: { best: (FocusShot & { n: number }) | null } = { best: null };
    tries.forEach(([deg, r], idx) => {
      const ang = facing + (deg * Math.PI) / 180;
      const x = a.pos.x - Math.sin(ang) * r, z = a.pos.z - Math.cos(ang) * r;
      if (nav && (!nav.walkable(x, z, lvl) || nav.collides(x, z, 0.22, lvl))) { log?.push({ deg, r, skip: 'nav' }); return; }
      if (actors.list().some((b) => b !== a && Math.hypot(b.pos.x - x, b.pos.z - z) < 0.55)) { log?.push({ deg, r, skip: 'actor' }); return; }
      const feet = floor(x, z); // player feet always on the floor (never floating / sunk)
      const ey = feet + eyeH;
      const miss: string[] = [];
      const hits: Record<string, string | null> | null = log ? {} : null;
      targets.forEach(([tx, ty, tz, m], i) => {
        if (sightClear(a, x, ey, z, tx, ty, tz, m)) return;
        const tn = TARGET_NAMES[i] ?? `t${i}`;
        miss.push(tn);
        if (hits) hits[tn] = lastHit;
      });
      const dx = a.pos.x - x, dz = a.pos.z - z;
      // Foreground intruders: another actor nearer than the subject inside the view cone is bigger than it on screen
      // (a Clawd's shoulder filling a third of the frame) even when every sightline is free. Companions at about the
      // subject's depth share the frame (a queue neighbour): allowed, but a spot with fewer of them wins.
      const dl = Math.hypot(dx, dz) || 1;
      const intruders: string[] = [];
      let companions = 0;
      for (const b of actors.list()) {
        if (b === a) continue;
        const bx = b.pos.x - x, bz = b.pos.z - z, bd = Math.hypot(bx, bz);
        if (bd < 1e-3 || bd > dl + 0.5 || (bx * dx + bz * dz) / (bd * dl) <= FRAME_COS) continue;
        if (bd < dl - 0.05) intruders.push(b.id); else companions++; // nearer than the subject → looms larger
      }
      const coreMiss = miss.filter((n) => !soft.has(n)).length; // flanks / frame corridor only lower the score
      // Foreground clutter: world geometry within ~1.2 m of the lens across the middle of the frame (a floor-lamp pole,
      // a plant) — it misses every sightline yet slices the shot. Soft: lowers the score.
      const yaw = Math.atan2(-dx, -dz); // camera forward = (-sin yaw, -cos yaw)
      const pitch = Math.atan2(feetA + lookY - ey, dl);
      const fgFar = Math.min(1.2, dl - 0.45);
      let fg = 0;
      for (const [h, v] of FG_RAYS) {
        const yy = yaw + h, pp = pitch + v;
        v1.set(-Math.sin(yy) * Math.cos(pp), Math.sin(pp), -Math.cos(yy) * Math.cos(pp));
        ray.set(v0.set(x, ey, z), v1); ray.far = fgFar;
        if (fgFar > 0.2 && ray.intersectObject(ctx.scene, true).some((hh) => hh.object.visible !== false && !onActor(hh.object))) fg++;
      }
      if (fg) miss.push(`fg×${fg}`);
      const softMiss = miss.length - coreMiss - (fg ? 1 : 0);
      // How squarely the lens sees the face plate (cos of the angle between its normal and face→eye): catches a lounging
      // or swivelled Clawd whose body yaw says little about where its face points.
      let facing3 = Math.cos((deg * Math.PI) / 180);
      if (face) {
        const ex = x - face.p.x, eyy = ey - face.p.y, ez = z - face.p.z, el = Math.hypot(ex, eyy, ez) || 1;
        facing3 = (ex * face.n.x + eyy * face.n.y + ez * face.n.z) / el;
      }
      const clear = !coreMiss && !intruders.length && facing3 >= minCos; // a side / back view isn't a hero shot
      const n = clear
        // ~3/4 (45°) reads best; desk mode: a squarer face (~25°) over the monitor, the monitor itself is expected
        ? 1000 - softMiss * (desk ? 2 : 6) - fg * (desk ? 2 : 5) - Math.abs(facing3 - (desk ? 0.88 : 0.7)) * 30 - idx * 0.3 - companions * 8
        : (targets.length - coreMiss) * 10 - intruders.length * 15 - softMiss * 3
          - fg * 2 + facing3 * 10 - actors.list().reduce((k, b) => k + (b !== a && Math.hypot(b.pos.x - x, b.pos.z - z) < 1.1 ? 1 : 0), 0);
      log?.push({ deg, r: +r.toFixed(2), clear, facing: +facing3.toFixed(2), hits, intruders, companions, n: +n.toFixed(1) });
      if (!box.best || n > box.best.n) box.best = { pose: [x, feet, z, yaw, pitch], side: deg, clear, facing: +facing3.toFixed(2), desk, miss, intruders, n };
    });
    if (box.best) { const { n, ...shot } = box.best; return { ...shot, score: n }; }
    // Nothing walkable around it (shouldn't happen): straight in front, feet on the floor.
    const x = a.pos.x - Math.sin(facing) * dist, z = a.pos.z - Math.cos(facing) * dist;
    const feet = floor(x, z);
    return { pose: [x, feet, z, facing + Math.PI, Math.atan2(feetA + lookY - feet - eyeH, dist)], side: 0, clear: false };
  };
}

const _q = new THREE.Quaternion(), _f = new THREE.Vector3();
/** Face plate world position + normal ({p, n}) from the live rig, or null. */
function faceFrame(a: FaceActor): { p: THREE.Vector3; n: THREE.Vector3 } | null {
  const n = a.rig?.nodes;
  const node = n?.faceRoot ?? n?.screen ?? null;
  if (!node || !a.rig) return null;
  a.rig.root.updateMatrixWorld(true);
  const p = node.getWorldPosition(new THREE.Vector3());
  const q = node.getWorldQuaternion(new THREE.Quaternion());
  return { p, n: new THREE.Vector3(0, 0, FACE_AXIS).applyQuaternion(q) };
}
/**
 * World yaw the actor's face plate (Clawd faceRoot / Shelly screen) actually looks along — body yaw plus any animated
 * head / body turn (a queue look-back, a swivel, a gesture lean). Same convention as `a.yaw` (forward = -sin, -cos).
 * Falls back to `a.yaw` without a live rig.
 */
export function faceYaw(a: FaceActor): number {
  const n = a.rig?.nodes;
  const node = n?.faceRoot ?? n?.screen ?? null;
  if (!node || !a.rig) return a.yaw;
  a.rig.root.updateMatrixWorld(true);
  node.getWorldQuaternion(_q);
  _f.set(0, 0, FACE_AXIS).applyQuaternion(_q);
  if (Math.hypot(_f.x, _f.z) < 0.3) return a.yaw; // face pointing at the sky / floor: body yaw is the better guess
  // A head turn / look-back shifts the 3/4 view; a lounge / flip that tips the face past vertical must not flip it.
  const off = Math.atan2(Math.sin(Math.atan2(-_f.x, -_f.z) - a.yaw), Math.cos(Math.atan2(-_f.x, -_f.z) - a.yaw));
  if (Math.abs(off) > Math.PI / 2) return a.yaw;
  return a.yaw + Math.max(-FACE_TURN_MAX, Math.min(FACE_TURN_MAX, off));
}
const FACE_TURN_MAX = (60 * Math.PI) / 180;
const DESK_MIN_FACING = 0.7; // desk hero: the face within ~45° of the lens (art review: eyes, glints, focused face)
const FACE_AXIS = 1; // the face plate looks along its local +z

export function installHq(d: DebugDeps) {
  const { ctx } = d;
  const info = () => ctx.renderer?.info;

  const focusShot = createFocusShot({ ctx, actors: d.actors, nav: d.nav });

  /** Every actor matching an id / name / `status:` `kind:` `cls:` `ws:` `name:` query (an exact id → just that one). */
  const matchActors = (q: string | null | undefined): HqActor[] => {
    const list = d.actors.list();
    if (!q) return list.slice(0, 1);
    const exact = d.actors.get(q);
    if (exact) return [exact];
    const m = /^(status|kind|cls|ws|name):(.+)$/.exec(q);
    return list.filter((a) => {
      const e = a.entity;
      if (!m) return e.name === q;
      const v = m[2];
      switch (m[1]) {
        case 'status': return e.status === v;
        case 'kind': return e.kind === v;
        case 'cls': return e.activity?.cls === v || e.process?.activity === v;
        case 'ws': return e.workspace?.label === v;
        case 'name': return e.name === v;
      }
      return false;
    });
  };
  const matchActor = (q: string | null | undefined) => matchActors(q)[0] ?? null;
  /**
   * The best-framed match for a query: the first matching actor with a clear hero spot, else the best-scoring one
   * (a query like `cls:task` may hit someone buried in a huddle while a twin sits in the open). Actors seated at a
   * desk are tried first — a desk is spaced, lit and framed by design; an overflow floor spot may be in a crowd.
   * [CORE fix r2] Settled actors (arrived + stopped) rank above walkers: a commuter's framing is stale by the time
   * it is shot, and a walker may never settle while the hero camera stands in its path. Order: settled at a desk,
   * settled elsewhere, walking to a desk, walking elsewhere. At most 16 tried.
   */
  const bestFocus = (q: string | null | undefined, dist: number, height: number, mode: FocusMode) => {
    let pick: { a: HqActor; shot: FocusShot; settled: boolean } | null = null;
    for (const a of heroOrder(matchActors(q)).slice(0, 16)) {
      const shot = focusShot(a, dist, height, null, mode);
      const settled = isSettled(a);
      const score = shot.score ?? 0;
      const better = !pick
        || (shot.clear && settled) > (pick.shot.clear && pick.settled)
        || ((shot.clear && settled) === (pick.shot.clear && pick.settled) && (shot.clear > pick.shot.clear || (shot.clear === pick.shot.clear && score > (pick.shot.score ?? 0))));
      if (better) pick = { a, shot, settled };
      if (shot.clear && settled) break;
    }
    return pick;
  };

  const hq = {
    ready: d.ready,
    setPose(x: number, y: number, z: number, yaw: number, pitch: number) { ctx.player.setPose(x, y, z, yaw, pitch); return ctx.player.getPose(); },
    pose(name: string) {
      const p = d.poses[name];
      if (!p) return null;
      ctx.player.setPose(...p.pose);
      return [...p.pose];
    },
    stats() {
      const i = info();
      const out: HqStats = {
        fps: +ctx.perf.fps.toFixed(1),
        frameMs: +ctx.perf.frameMs.toFixed(2),
        cpuMs: +ctx.perf.cpuMs.toFixed(2),
        gpuMs: ctx.perf.gpuMs,
        // §5.3 split contract: drawCalls {main, shadow, portrait(s), post, total}, programs {scene, post, total}.
        // Pages without the split (debug sheets) report main = total, shadow = portrait = 0.
        drawCalls: { ...(ctx.perf.draws ?? { main: ctx.perf.drawCalls, shadow: 0, portrait: 0, portraits: 0, post: 0, total: ctx.perf.drawCalls }) },
        triangles: ctx.perf.triangles,
        programs: d.programs?.() ?? { scene: i?.programs?.length ?? 0, post: 0, total: i?.programs?.length ?? 0 },
        frameErrors: ctx.perf.frameErrors ?? 0,
        bootErrors: hqBootErrors.length,
        ...(hqBootErrors.length ? { bootErrorList: [...hqBootErrors] } : {}),
        textures: i?.memory?.textures ?? null,
        geometries: i?.memory?.geometries ?? null,
        entities: ctx.store.entities.size,
        actors: d.actors.count(),
        quality: ctx.quality.tier,
        renderScale: ctx.quality.renderScale,
        zone: ctx.camZone,
        conn: ctx.store.conn.state,
        herdr: !!ctx.store.herdr.connected,
        demo: ctx.store.demo,
        frame: ctx.frame,
        hidden: ctx.hidden,
        pose: ctx.player.getPose().map((v) => +v.toFixed(3)),
        overBudget: [],
        budget: DRAW_BUDGET,
        trianglesSplit: null,
      };
      out.overBudget = overBudget(out.drawCalls, out.programs); // [] = within the §5.3 caps (DRAW_BUDGET)
      out.budget = DRAW_BUDGET;
      for (const [k, fn] of statSections) { try { out[k] = fn(); } catch { out[k] = null; } }
      // [RND fix r2, cross-owner CORE] §5.3 triangle caps (drawSplit TRI_BUDGET) on RND's main-pass split
      // (`render.tris` {main, env, chars, stat, shadow, prepass}); `triangles` stays the all-pass renderer.info count
      out.trianglesSplit = isRecord(out.render) && isTriSplit(out.render.tris) ? out.render.tris : null;
      out.overBudget.push(...overTriBudget(out.trianglesSplit, out.actors));
      out.budget = { ...DRAW_BUDGET, triangles: TRI_BUDGET };
      return out;
    },
    setQuality: (tier: string) => ctx.quality.set(tier),
    setHour: (h: number | null) => { ctx.clock.setHour(h); return ctx.clock.hourPin; },
    setTimeScale: (k: number) => { ctx.clock.setScale(+k); return ctx.clock.scale; },
    freeze: (b = true) => { ctx.clock.freeze(b); return ctx.clock.frozen; },
    /** 3/4 hero framing of the best-framed matching actor (see createFocusShot, bestFocus); `height` 1.1 → aim 0.55 m
     *  up its body (a desk sitter: over the monitor at its face). `mode` = FocusMode overrides. Pass the returned `id`
     *  to re-frame that same actor later. */
    focus(q: string | null | undefined, dist = 1.5, height = 1.1, mode: FocusMode = {}) {
      // [UI M3.5, cross-owner CORE] walk-up framing: a settled desk worker is framed by UI's go-there scorer (face +
      // its live screen, ui/goto.ts; ≈ 10 ms instead of the raycast pass) unless `mode.walkUp === false` (hero sheet)
      const wu = mode.walkUp !== false ? pluggedFn('walkUp') : undefined;
      if (wu) {
        // [UI fix r1, cross-owner CORE] two passes: a match framed face + its live screen (walk-up tier 0) beats one
        // framed from the side / front only (tier 1), so focus('status:working') lands on a desk where both read
        for (const tier of [0, 1] as const) for (const a of heroOrder(matchActors(q)).slice(0, 16)) {
          if (!atDesk(a) || !isSettled(a)) continue;
          const r = wu(a.id, tier);
          if (r) return { id: a.id, pose: ctx.player.getPose(), side: r.side ?? null, clear: true, facing: r.cf ?? null, desk: true, slot: a.intent?.slot?.id ?? null, miss: [], intruders: [], walkUp: r };
        }
      }
      // [UI fix r2, cross-owner CORE; reviewer fun] no match has settled (all walking: a blocked agent on its way to
      // the queue, an idle one wandering): a pose framed now is stale at once (b-blk: its back over the ropes; i-idle:
      // an empty corner). UI's go-there takes over instead (follow until it settles, then the walk-up stand spot);
      // `pending: true` → poll match(id)[0].settled, then focus(id) again for a still frame.
      if (wu && mode.settle !== false) {
        const ms = heroOrder(matchActors(q)).slice(0, 16);
        if (ms.length && !ms.some(isSettled)) {
          const r = wu(ms[0].id, 'settle');
          if (r) return { id: ms[0].id, pose: ctx.player.getPose(), side: null, clear: false, facing: null, desk: atDesk(ms[0]), slot: ms[0].intent?.slot?.id ?? null, miss: [], intruders: [], pending: true, following: !!r.following };
        }
      }
      const pick = bestFocus(q, dist, height, mode);
      if (!pick) return null;
      const { a, shot } = pick;
      ctx.player.setPose(...shot.pose);
      return { id: a.id, pose: ctx.player.getPose(), side: shot.side, clear: shot.clear, facing: shot.facing ?? null, desk: !!shot.desk, slot: a.intent?.slot?.id ?? null, miss: shot.miss ?? [], intruders: shot.intruders ?? [] };
    },
    /** Actors matching a focus() query in hero order (settled first, desks first), with their settle state —
     *  lets review-shots wait for *a* match to settle without moving the camera (see scripts/review-shots.ts). */
    match: (q: string | null | undefined) => heroOrder(matchActors(q)).map((a) => ({ id: a.id, settled: isSettled(a), desk: atDesk(a), activity: a.intent?.activity ?? null, slot: a.intent?.slot?.id ?? null })),
    /** Every focus() candidate for an actor with why it was (not) taken — framing diagnostics. */
    focusCandidates(q: string | null | undefined, dist = 1.5, height = 1.1, mode: FocusMode = {}) {
      const a = matchActor(q);
      if (!a) return null;
      const log: FocusLogRow[] = [];
      focusShot(a, dist, height, log, mode);
      return log;
    },
    select: call('select'),
    openTerminal: call('openTerminal'),
    closeTerminal: call('closeTerminal'),
    roster: call('roster'),
    goTo: call('goTo'), // §9.1 "go there" verb (UI ui/index.ts); m2-carryover: was listed/registered but never exposed
    goToSpot: call('goToSpot'), // §9.1 where "go there" would end: {x,y,z,yaw,pitch,why} | null (UI ui/index.ts)
    demo: (msg: ClientMsg) => (ctx.store.demo ? d.call(msg) : Promise.resolve({ ok: false, error: 'not_demo' })),
    entities: () => [...ctx.store.entities.values()],
    actors: () => d.actors.list().map((a) => ({
      id: a.id, name: a.entity.name, status: a.entity.status, kind: a.entity.kind,
      pos: [a.pos.x, a.pos.y, a.pos.z], yaw: a.yaw, slot: a.intent?.slot?.id ?? null,
      activity: a.intent?.activity ?? null, arrived: a.arrived, anim: a.animator?.debug ?? null,
      faceYaw: faceYaw(a),
    })),
    store: ctx.store,
    scene: ctx.scene,
    camera: ctx.camera,
    ctx,
    probe: call('probe'),
    lumaStats: call('lumaStats'),
    surfaceStats: call('surfaceStats'),
    clayCheck: call('clayCheck'),
    edgeCheck: call('edgeCheck'),
    hueGapCheck: call('hueGapCheck'), // §5.5 hue gap around Clawds (RND probe.ts)
    greyCheck: call('greyCheck'), // §5.5 / ART §11 #10 greyscale top-10 contrast blobs (RND probe.ts)
    placardCheck: call('placardCheck'),
    feelTrace: call('feelTrace'),
    frameCheck: call('frameCheck'),
    walkUpCheck: call('walkUpCheck'), // [UI fix r1, cross-owner CORE] async; see ui/index.ts
    metrics: call('metrics'),
    loseContext(ms = 250) {
      const ext = ctx.renderer.getContext().getExtension('WEBGL_lose_context');
      if (!ext) return Promise.resolve(false);
      ext.loseContext();
      return new Promise((res) => setTimeout(() => { ext.restoreContext(); res(true); }, ms));
    },
    keyScope: call('keyScope'),
    away: call('away'),
  };
  window.__hq = hq;
  return hq;
}

/** `window.__hq`: what `installHq` builds. */
export type HqApi = ReturnType<typeof installHq>;
declare global {
  interface Window { __hq?: HqApi }
}
