// @pure
/**
 * Zone-dressing helpers (plan ↔ world, furniture poses, prop-local offsets). Owner: ENV.
 */
import type * as THREE from 'three';
import type { Item, KitParams, Pose } from '../kit/core.ts';
import type { Furniture } from '../../layout/schema.ts';

export const OX = 20.5, OZ = 14;
/** A pose with every field set (`Pose` with y and yaw required). */
export interface WorldPose extends Pose { y: number; yaw: number }
/** What `put` returns: the built item and its placement matrix (null in the nav dry run, which bakes nothing). */
export interface Placed { item: Item; m: THREE.Matrix4 | null }
/** A live monitor screen a dresser reports (world pose of the glass). */
export interface DeskScreen { p: { x: number; y: number; z: number }; yaw: number; rx: number; anchor: string }
/** The lab's TEST light: the fume-hood lens spots (world). */
export interface LabLightSpec { yaw: number; lenses: { x: number; y: number; z: number; r: number }[] }
/**
 * The dressing surface every zone dresser gets: `put(name, params, pose, seed, aoK)` places a kit prop (`aoK` > 0 also
 * darkens the floor under its footprint); `swap` / `group` name the draw group the next puts join; `screens` and
 * `labLight` are what dressers report back.
 */
export interface DressKit {
  put: (name: string, params: KitParams | null, pose: Pose, seed?: string | number, aoK?: number) => Placed;
  swap: string | null;
  group?: string | null;
  screens?: DeskScreen[];
  labLight?: LabLightSpec;
}
/** Plan (px, pz) → world pose. */
export const W = (px: number, pz: number, y = 0, yaw = 0): WorldPose => ({ x: px - OX, y, z: pz - OZ, yaw });
/** A layout furniture item's pose. */
export const poseOf = (f: Furniture, dy = 0): WorldPose => ({ x: f.pos.x, y: f.pos.y + dy, z: f.pos.z, yaw: f.yaw });
/** Prop-local (lx, ly, lz) of a pose → world pose (three rotation.y convention: local +z faces `yaw`). */
export function local(p: Pose, lx: number, ly: number, lz: number, dyaw = 0): WorldPose {
  const cs = Math.cos(p.yaw ?? 0), sn = Math.sin(p.yaw ?? 0);
  return { x: p.x + lx * cs + lz * sn, y: (p.y ?? 0) + ly, z: p.z - lx * sn + lz * cs, yaw: (p.yaw ?? 0) + dyaw };
}
/** Seeded 0..1 from ints (stable story-prop variation). */
export const hash01 = (a: number, b = 0) => { const v = Math.sin(a * 91.7 + b * 13.1 + 7.3) * 43758.5453; return v - Math.floor(v); };
