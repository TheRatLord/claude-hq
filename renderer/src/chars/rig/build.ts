/**
 * Tiny rig-building helpers shared by clawd.ts, shelly.ts, face.ts, accessories.ts and props.ts. A rig is a pure-math
 * Object3D tree that is never added to the scene (§6.2); parts reference nodes whose world matrix maps a unit
 * geometry (chars/render/geometry.ts) into place. Owner: CHR.
 */
import * as THREE from 'three';
import type { PartType } from '../render/geometry.ts';

/** A vector as an array: position `p`, Euler XYZ rotation `r`, scale `s`. */
export type Vec3Arr = readonly number[];

export interface RigPart {
  /** instanced part type (chars/render/geometry.ts PART_TYPES) */
  type: PartType;
  /** transform source (world matrix after root.updateMatrixWorld) */
  node: THREE.Object3D;
  /** 'body'|'bodyDeep'|'ink'|'ink2'|'paper'|'trim'|'workspace'|'blush'|'#RRGGBB' */
  colorKey: string;
  /** gets an ink hull instance */
  hull: boolean;
  castShadow: boolean;
  /** unlit colour gain (> 1 blooms; §5.0 emissive policy) */
  emissive?: number;
  /** glint: placed per frame in screen space on this eye (§6.1) */
  glintOf?: THREE.Object3D;
  /** 'acc' | 'prop' | 'face' | 'gear' (for LOD: face micro-parts hide beyond 14 m) */
  group?: string;
  /** per-frame colour override written by an animator (Shelly's phosphor / bulb / LED), read by charBatch */
  tint?: THREE.Color;
}

export interface NodeOpts {
  p?: Vec3Arr;
  r?: Vec3Arr;
  s?: Vec3Arr | number;
  name?: string;
  order?: THREE.EulerOrder;
}

export interface PartOpts extends NodeOpts {
  hull?: boolean;
  shadow?: boolean;
  emissive?: number;
  group?: string;
}

/** The rest transform every `node()` records (animators add offsets on top of it). */
export interface NodeBase { p: THREE.Vector3; r: THREE.Euler; s: THREE.Vector3 }

/** What the character code stores in `Object3D.userData`. */
export interface NodeData {
  base: NodeBase;
  /** eye glint placement, written by the animator and read by charBatch */
  glintRy?: number;
  glintCy?: number;
  glintScale?: number;
  /** charBatch: indices of the parts that use this node */
  pi?: number[];
  /** charBatch: the frame this node was last stamped visible */
  vis?: number;
}

/** Typed `userData` of a rig node (the one place the typings' `Record<string, any>` is narrowed). */
export const nodeData = (n: THREE.Object3D): NodeData => n.userData as NodeData;

export type PartFn = (parent: THREE.Object3D, type: PartType, colorKey: string, o?: PartOpts) => THREE.Object3D;
export type NodeFn = (parent: THREE.Object3D, o?: NodeOpts) => THREE.Object3D;

export function makeBuilder(parts: RigPart[]): { part: PartFn; node: NodeFn } {
  const part: PartFn = (parent, type, colorKey, o = {}) => {
    const n = node(parent, o);
    parts.push({ type, node: n, colorKey, hull: !!o.hull, castShadow: !!o.shadow, emissive: o.emissive, group: o.group });
    return n;
  };
  return { part, node };
}

export function node(parent: THREE.Object3D, o: NodeOpts = {}): THREE.Object3D {
  const n = new THREE.Object3D();
  if (o.name) n.name = o.name;
  if (o.order) n.rotation.order = o.order;
  if (o.p) n.position.fromArray(o.p);
  if (o.r) n.rotation.set(o.r[0], o.r[1], o.r[2]);
  if (o.s !== undefined) { if (typeof o.s === 'number') n.scale.setScalar(o.s); else n.scale.fromArray(o.s); }
  nodeData(n).base = { p: n.position.clone(), r: n.rotation.clone(), s: n.scale.clone() };
  parent.add(n);
  return n;
}

/** Limb part scale for a capsule of radius r and total length L (unit limb spans y ∈ [−2, 0], radius 0.5). */
export const limbScale = (r: number, L: number): [number, number, number] => [2 * r, L / 2, 2 * r];

/** Point a hanging limb node (from its own origin) toward (dx, dy) in its parent's xy plane with length L. */
export function aimStroke(n: THREE.Object3D, x0: number, y0: number, x1: number, y1: number, w: number): void {
  const dx = x1 - x0, dy = y1 - y0;
  const L = Math.hypot(dx, dy);
  n.position.set(x0, y0, n.position.z);
  n.rotation.set(0, 0, Math.atan2(dx, -dy));
  n.scale.set(w, Math.max(L / 2, w * 0.5), w);
}
