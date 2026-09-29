/**
 * Shared helpers for the ambient cast (§6.4.1, §6.9, P3): plan ↔ world, furniture lookup, a tiny nav path walker
 * (budgeted `nav.tryRoute`), and pure selectors the NPCs read from the store. Owner: AMB.
 */
import { PLAN_OFFSET } from '../layout/schema.ts';
import type { BurstKind } from '../../fx/particles.ts';
import type { Furniture, HqLayout, Layout, Slot, Vec3 } from '../layout/schema.ts';
import { isRecord } from '../../../../shared/guards.ts';
import type { Bus } from '../../core/bus.ts';
import type * as THREE from 'three';
import type { Stats } from '../../../../shared/protocol.ts';

// The seams the ambient cast reads. Narrow local shapes (what AMB actually touches) for the parts whose owners type
// them separately (nav routes, store, actors, charBatch, player, fx); the layout and the bus are the real types.
export interface Vec2 { x: number; z: number }
export type { Vec3 };

/** A route answer: `undefined` = still computing (budgeted router), `null` = no route. */
export type Route = { points?: Vec2[] } | null | undefined;
export interface AmbNav {
  tryRoute?: (from: Vec2 & { level: number }, to: Vec2 & { level: number }) => Route;
  route?: (from: Vec2 & { level: number }, to: Vec2 & { level: number }) => Route;
}
/** The entity fields the cast reads (Ada's blocked-inbox pick, the cat's keyboard honesty). */
export type AmbEntity = { id: string; status?: string; statusSince?: number };
/** What the ambient cast reads from `ctx.store` (a structural subset of net/store's `store`). */
export interface AmbStore {
  demo?: boolean | number;
  conn?: { state?: string };
  herdr?: { connected?: boolean };
  entities?: Map<string, AmbEntity>;
  stats?: Stats | null;
}
/** Per-frame context fields the cast reads (`ctx` after loop.ts rewrites it each tick). */
export interface AmbFrame { dt: number; time: number; hour: number; hidden?: boolean; camZone?: string | null }
/** FX pool (`fx.burst`, §5.4 particles). */
export interface AmbFx { burst?: (kind: BurstKind, at: Vec3, opts?: { count?: number; floor?: number }) => void }
export interface AmbPlayer { pos: Vec3; level?: number }
/** An agent actor (chars/actors.ts) as the cast sees it. */
export interface AmbActor { id: string; pos: Vec3; entity?: AmbEntity | null; lite?: { seated?: boolean }; slotRef?: Slot | null; moving?: boolean }
export interface AmbActors { get?: (id: string) => AmbActor | null | undefined; list?: () => AmbActor[] }
/** A rig registered in charBatch (the prop rigs the cast builds by hand, and Clawd's own). */
export interface CharHandle { setVisible(v: boolean): void; setLod?(l: number): void; remove(): void }
export interface CharBatch { register(rig: object, o: { kind: string; colorIndex: number; cycle: number }): CharHandle }
/** The bus the cast publishes on (`amb.*`) and listens to (`answered`, `away.recap`, `stat.brew`, `stats.hotSpot`). */
export type AmbBus = Pick<Bus, 'on' | 'emit'>;
/** Peers the cast reads from each other (§AMB m2 r2: Bean serves Ada, treats the begging cat). */
export interface AmbPeers {
  ada?: { readonly pos: Vec3; wantsCoffee?: () => boolean; served?: () => void };
  cat?: { readonly pos: Vec3; readonly begging?: boolean; treat?: () => void };
  barista?: { readonly pos: Vec3 };
}
/** Where the cast adds its meshes (the THREE.Scene, or a stub in the tests). */
export interface AmbScene { add(o: THREE.Object3D): unknown; remove(o: THREE.Object3D): unknown }
/** What every ambient part factory receives (createAmbient builds it from the boot deps + ctx). */
export interface AmbDeps {
  layout: HqLayout;
  nav: AmbNav;
  charBatch: CharBatch;
  fx: AmbFx;
  actors: AmbActors;
  player: AmbPlayer;
  /** the UI handle (main.ts); read only through `inboxOpen` */
  ui?: object;
  scene: AmbScene;
  store: AmbStore;
  bus: AmbBus;
  rand: () => number;
  peers?: AmbPeers;
}
/** One ambient cast member as createAmbient drives it. */
export interface AmbPart {
  readonly pos?: Vec3;
  update(c: AmbFrame, camera: THREE.Camera | null | undefined): void;
  debug?(): unknown;
  force?(what?: string, ...rest: unknown[]): unknown;
  teleport?(...rest: number[]): unknown;
  dispose?(): void;
}

export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Shortest signed angle a → b. */
export const angDiff = (a: number, b: number) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
/** Frame-rate independent exponential approach (k = 1/s). */
export const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));
export const dampAng = (a: number, b: number, k: number, dt: number) => a + angDiff(a, b) * (1 - Math.exp(-k * dt));
/** Yaw (three rotation.y, +z forward) that faces along (dx, dz). */
export const yawTo = (dx: number, dz: number) => Math.atan2(dx, dz);
export const smooth01 = (t: number) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };

/** Plan (x, z) → world (x, z). */
export const W = (px: number, pz: number): Vec2 => ({ x: px - PLAN_OFFSET.x, z: pz - PLAN_OFFSET.z });

export const furniture = (layout: Pick<Layout, 'furniture'> | null | undefined, id: string): Furniture | null => (layout?.furniture ?? []).find((f) => f.id === id) ?? null;
export const slotById = (layout: Pick<Layout, 'slots'> | null | undefined, id: string): Slot | null => (layout?.slots ?? []).find((s) => s.id === id) ?? null;

/**
 * Oldest blocked entity (smallest statusSince), or null. Pure.
 */
export function oldestBlocked<E extends { id: string; status?: string; statusSince?: number }>(entities: Iterable<E | null | undefined>): E | null {
  let best: E | null = null;
  for (const e of entities) {
    if (e?.status !== 'blocked') continue;
    const s = e.statusSince ?? Infinity;
    if (!best || s < (best.statusSince ?? Infinity) || (s === (best.statusSince ?? Infinity) && String(e.id) < String(best.id))) best = e;
  }
  return best;
}

/**
 * What Ada's card should say, or null (pure): 'herdr' = the backend is up but herdr is unreachable (GP §5.8),
 * 'hq' = the HQ backend socket itself is down / reconnecting. Demo mode never shows a card.
 */
export function offlineKind(store: AmbStore | null | undefined): 'hq' | 'herdr' | null {
  if (!store || store.demo) return null;
  const conn = store.conn?.state;
  if (conn && conn !== 'open') return 'hq';
  return store.herdr?.connected ? null : 'herdr';
}

/**
 * Is the Blocked Inbox open? Reads `ui.inbox.isOpen`. Note the UI handle exposes no `inbox` today, so outside the
 * debug `force('serve')` this is always false: Ada's Serve mode never triggers from the real UI (baseline behaviour).
 */
export function inboxOpen(ui: object | undefined): boolean {
  return isRecord(ui) && isRecord(ui.inbox) && !!ui.inbox.isOpen;
}

/** herdr reachable? (§5.8 GP "If no herdr is reachable: Ada holds a sign"). Pure. */
export function herdrOffline(store: AmbStore | null | undefined): boolean {
  if (!store) return false;
  if (store.demo) return false;
  const conn = store.conn?.state;
  if (conn && conn !== 'open') return true;
  return !store.herdr?.connected;
}

export interface Walker {
  pos: Vec3;
  yaw: number;
  speed: number;
  turn: number;
  /** smoothed ground speed (m/s) */
  v: number;
  moving: boolean;
  /** the target still waiting for the router */
  pending: Vec2 | null;
  path: Vec2[];
  i: number;
  failed: boolean;
  go(target: Vec2): void;
  stop(): void;
  readonly done: boolean;
  /** advance; returns whether it is moving */
  update(dt: number): boolean;
}

/**
 * A path walker for one ambient NPC: `go(target)` asks the budgeted router (retrying while it is PENDING), `update(dt)`
 * moves along the polyline at `speed` and turns toward travel. Level 0 only (the cast never takes the stairs).
 */
export function createWalker(nav: AmbNav | null | undefined, layout: Pick<Layout, 'floorY'> | null | undefined, start: Vec2, o: { speed?: number; turn?: number } = {}): Walker {
  const w: Walker = {
    pos: { x: start.x, y: layout?.floorY?.(start.x, start.z, 0) ?? 0, z: start.z },
    yaw: 0, speed: o.speed ?? 0.9, turn: o.turn ?? 7, v: 0, moving: false, pending: null,
    path: [], i: 0, failed: false,
    go(target) {
      w.pending = { x: target.x, z: target.z };
      w.failed = false;
      w.path = []; w.i = 0; w.moving = false;
    },
    stop() { w.pending = null; w.path = []; w.moving = false; },
    get done() { return !w.pending && !w.moving; },
    update(dt) {
      if (w.pending) {
        const from = { x: w.pos.x, z: w.pos.z, level: 0 };
        const to = { x: w.pending.x, z: w.pending.z, level: 0 };
        const r = nav?.tryRoute ? nav.tryRoute(from, to) : nav?.route?.(from, to);
        if (r !== undefined) {
          w.pending = null;
          if (r && r.points?.length) { w.path = r.points.map((p) => ({ x: p.x, z: p.z })); w.path[w.path.length - 1] = to; w.i = 1; w.moving = true; }
          else if (Math.hypot(to.x - from.x, to.z - from.z) < 3) { w.path = [from, to]; w.i = 1; w.moving = true; } // tiny hop off-grid (desk / counter end)
          else w.failed = true;
        }
      }
      let spd = 0;
      if (w.moving) {
        const p = w.path[w.i];
        if (!p) { w.moving = false; }
        else {
          const dx = p.x - w.pos.x, dz = p.z - w.pos.z, d = Math.hypot(dx, dz);
          const want = yawTo(dx, dz);
          w.yaw = dampAng(w.yaw, want, w.turn, dt);
          const facing = Math.cos(angDiff(w.yaw, want));
          spd = w.speed * clamp(facing * 1.2, 0.15, 1);
          const last = w.i === w.path.length - 1;
          if (last) spd *= clamp(d / 0.35, 0.3, 1);
          const step = Math.min(d, spd * dt);
          if (d > 1e-4) { w.pos.x += (dx / d) * step; w.pos.z += (dz / d) * step; }
          if (d - step < 0.03) { w.i++; if (w.i >= w.path.length) w.moving = false; }
        }
      }
      w.v = damp(w.v, spd, 10, dt);
      w.pos.y = layout?.floorY?.(w.pos.x, w.pos.z, 0) ?? 0;
      return w.moving;
    },
  };
  return w;
}

/** Deterministic per-name PRNG (mulberry32) so the cast's rolls are reproducible under `?seed`. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
