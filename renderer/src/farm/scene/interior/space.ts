/**
 * The walk-in room contract (scene/interior): every room (the farmhouse, the barn) is a `RoomDef` the interior system
 * registers. The system owns what all rooms share — the fade, hiding the outdoor scene, registering lights and
 * interactables while you are in, the 'indoors' service, the audio muffle — and a room supplies its floor plan (pure,
 * room-local: floor heights, walls, solids, viewpoints) and, built lazily on the first visit, its meshes, lights,
 * interactables and per-frame life.
 *
 * Every room is built in its structure's own frame (`Frame`: local x across, +z out of the front door, y up from the
 * structure's base), so the outdoor shell and the room line up.
 */
import * as THREE from 'three';
import type { AudioService, FrameInfo, Interactable, LightEmitter, SceneCtx } from '../context.ts';
import type { Season } from '../../model/types.ts';

/** A structure's local frame: world ↔ local helpers (no allocation unless asked for a new vector). */
export interface Frame {
  readonly x: number; readonly y: number; readonly z: number; readonly yaw: number;
  toWorld(lx: number, lz: number, out?: { x: number; z: number }): { x: number; z: number };
  toLocal(x: number, z: number, out?: { x: number; z: number }): { x: number; z: number };
  /** a world-position writer for a local point (for Interactable.pos) */
  vec(lx: number, ly: number, lz: number): (out: THREE.Vector3) => THREE.Vector3;
  /** a new world vector for a local point */
  P(lx: number, ly: number, lz: number): THREE.Vector3;
}

export function frameOf(s: { x: number; y: number; z: number; yaw: number }): Frame {
  const cos = Math.cos(s.yaw), sin = Math.sin(s.yaw);
  const toWorld = (lx: number, lz: number, out = { x: 0, z: 0 }) => { out.x = s.x + lx * cos + lz * sin; out.z = s.z - lx * sin + lz * cos; return out; };
  const toLocal = (x: number, z: number, out = { x: 0, z: 0 }) => { const dx = x - s.x, dz = z - s.z; out.x = dx * cos - dz * sin; out.z = dx * sin + dz * cos; return out; };
  const tmp = { x: 0, z: 0 };
  const vec = (lx: number, ly: number, lz: number) => (out: THREE.Vector3) => { toWorld(lx, lz, tmp); return out.set(tmp.x, s.y + ly, tmp.z); };
  return { x: s.x, y: s.y, z: s.z, yaw: s.yaw, toWorld, toLocal, vec, P: (lx, ly, lz) => vec(lx, ly, lz)(new THREE.Vector3()) };
}

/** stand at (x, z) on the floor at local height y (default: the ground floor), looking at (tx, ty, tz) */
export interface RoomView { x: number; z: number; tx: number; ty: number; tz: number; y?: number }
export interface Spot { x: number; z: number; yaw: number; pitch: number }

/** What the interior system hands a room while it builds and runs it. */
export interface RoomHost {
  ctx: SceneCtx;
  frame: Frame;
  audio(): AudioService | undefined;
  say(text: string, ms?: number, o?: { who?: string; from?: string }): void;
  /** fade to black, run fn, hold `hold` seconds, fade back (real time) */
  fadeThen(fn: () => void, hold?: number): void;
  /** go back outside (with the fade) */
  leave(): void;
  /** run fn with the outdoor scene shown and the room hidden (window captures) */
  withOutdoors(fn: () => void): void;
  /** seconds spent inside this visit (engine time; real time while the clock is frozen) */
  since(): number;
}

/** A room's live half, built on the first visit and kept (rebuilt when the season changes). */
export interface RoomBuilt {
  /** room-local group: the host places it in the structure's frame */
  root: THREE.Group;
  /** world-space extras (the farmhouse window backdrops) */
  extras?: THREE.Object3D[];
  /** world-space emitters, registered while inside */
  emitters: LightEmitter[];
  /** registered while inside; ids must start with 'interior:' */
  interactables(): Interactable[];
  /** you just came in (placed at the entry or a viewpoint) */
  entered?(): void;
  /** you just left */
  left?(): void;
  update(f: FrameInfo, rdt: number): void;
  dispose(): void;
  stats?(): Record<string, number>;
}

export interface RoomDef {
  /** 'farmhouse' | 'barn' (dev views: `barn:loft`) */
  id: string;
  /** the structure it is inside (world/map.ts) */
  site: string;
  /** a frame of its own instead of the structure's (the grotto: its mouth in the cliff behind the waterfall) */
  origin?: { x: number; y: number; z: number; yaw: number };
  /** how the open sky reaches in (sky.ts): `sky` scales the hemisphere fill (default 0.62: a room with windows), tinted
   *  toward `skyTint` / `groundTint` (default warm plaster and planks); a cave keeps only a cool trickle */
  light?: { sky: number; skyTint: number; groundTint: number; sun?: number };
  /** local: where you stand coming in, and outside the door going out */
  entry: Spot;
  exit: Spot;
  views: Readonly<Record<string, RoomView>>;
  /** local floor height under (lx, lz) for feet at ly (undefined = the ground floor), null outside the walls */
  floor(lx: number, lz: number, ly?: number): number | null;
  /** is a body of radius r at (lx, lz) inside the walls? (negative r: a margin outside them) */
  contains(lx: number, lz: number, r: number): boolean;
  /** push a circle out of the room's solids (mutates l); `ly` = feet height (local) for multi-level rooms */
  pushOut(l: { x: number; z: number }, r: number, ly?: number): boolean;
  /** where a visiting pet curls up (local); default none (it stays out) */
  pet?: { x: number; z: number; yaw: number; y?: number };
  /** rain on this roof, relative to the farmhouse shingles (a tin barn roof drums louder) */
  roof?: number;
  /** a door into the room the interior system puts on the outside of the structure (the farmhouse's is structures') */
  door?: { at: readonly [number, number, number]; label: string; hint: string; reach?: number };
  /** once, when the system starts (publish a service); returns its undo */
  init?(ctx: SceneCtx): (() => void) | void;
  build(host: RoomHost, season: Season): RoomBuilt;
}
