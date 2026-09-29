/**
 * Crosshair aim (E-to-open): the actor whose body the reticle ray hits first, within `maxDist` (default 9 m, the
 * whole proto room). Each actor is a set of oriented boxes taken from its live rig (Clawd: the body in its `shape`
 * frame incl. legs / arms / ears, plus a hat box up to `rig.crown` from CHR's ACC_TOP table; Shelly: the monitor head
 * in its `shape` frame + the neck / wheel column in the root frame), so lean, squash, sitting and the head bob all
 * follow. The winner is the nearest ray ENTRY depth, i.e. the
 * actor actually drawn at that pixel: a seated Shelly in the foreground no longer steals the aim from a Clawd standing
 * behind and above it. Actors are opaque to each other. Layout WALLS occlude (cheap plan-space segment test of the
 * camera→hit ray against `layout.walls`, honouring every opening — door / arch / glass / window — via its sill/top;
 * glass rails never occlude). Furniture and monitors do not (a monitor in front of a seated agent must not make it
 * un-aimable). Allocation-free per frame.
 * Owner: UI.
 */
import * as THREE from 'three';
import { BODY_W, BODY_H, BODY_D } from '../chars/render/geometry.ts';
import type { Entity } from '../../../shared/protocol.ts';
import type { Layout } from '../world/layout/schema.ts';

/** A world position as actors carry it (`y` is the feet height; absent = 0). */
export interface ActorPos { x: number; y?: number; z: number }

/**
 * What the UI reads from an actor (chars/actors.ts owns the real one; this is the structural view the UI relies on).
 * The rig is only used for aiming: the nodes' world matrices and the accessory crown height.
 */
export interface ActorView {
  id: string;
  entity?: Entity | null;
  pos?: ActorPos | null;
  yaw?: number;
  /** nav level (0 ground, 1 mezzanine) */
  level?: number;
  rig?: {
    species?: string; crown?: number; root: THREE.Object3D;
    nodes?: { shape?: THREE.Object3D; faceRoot?: THREE.Object3D | null; screen?: THREE.Object3D | null };
    /** the live face (eye nodes: local +z is the face plate's normal) */
    face?: { eyes?: { node: THREE.Object3D }[] } | null;
  } | null;
}
/** An actor that is in the world (has a position). */
export type PlacedActor = ActorView & { pos: ActorPos };
export const isPlaced = (a: ActorView | null | undefined): a is PlacedActor => !!a?.pos;

/** Local-frame box [minX, minY, minZ, maxX, maxY, maxZ]. */
type Box = readonly [number, number, number, number, number, number];
/** A wall baked to a plan segment (see `bakeOccluders`). */
export interface Occluder { ax: number; az: number; ux: number; uz: number; len: number; y0: number; y1: number; ops: { s0: number; s1: number; c0: number; c1: number }[] }

export const AIM_MAX_DIST = 9;

// Local-frame boxes [minX, minY, minZ, maxX, maxY, maxZ]; padded a little over the mesh (arms, ears, pillowing).
const CLAWD_BODY: Box = [-(BODY_W / 2 + 0.07), -0.16, -(BODY_D / 2 + 0.04), BODY_W / 2 + 0.07, BODY_H + 0.16, BODY_D / 2 + 0.06];
/**
 * [UI fix r2] Hat box (shape frame) from CHR's crown table (`rig.crown` = ACC_TOP[type]: body + accessory top). The
 * reticle on a tall beanie / cone / propeller now opens its wearer, and p2 stages its "sightline over F" from the same
 * top. Only built when the crown clears the padded body box; reused (one per crown value) so pick() stays allocation-free.
 */
const HAT_CACHE = new Map<number, Box>();
const CLAWD_BODY_TOP = CLAWD_BODY[4];
function hatBox(crown: number | undefined): Box | null {
  if (crown === undefined || !(crown > CLAWD_BODY_TOP - 0.03)) return null;
  let b = HAT_CACHE.get(crown);
  if (!b) HAT_CACHE.set(crown, (b = [-0.3, BODY_H - 0.04, -0.26, 0.3, crown + 0.03, 0.26]));
  return b;
}
const SHELLY_HEAD: Box = [-0.23, -0.03, -0.2, 0.23, 0.36, 0.22];
const SHELLY_COLUMN: Box = [-0.15, 0, -0.13, 0.15, 0.5, 0.13];
/** Fallback (no rig / stale matrices): an upright box around the feet, yawed with the actor. */
const FALLBACK: Record<'clawd' | 'shelly', Box> = { clawd: [-0.42, 0, -0.28, 0.42, 0.78, 0.3], shelly: [-0.23, 0, -0.2, 0.23, 0.75, 0.22] };

/**
 * Slab test of the ray (o, d) against box `b` in the frame of world matrix `m` (inverse `inv`). Returns the entry
 * distance along the world ray (d is unit length in world space), or Infinity.
 */
function hitBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, inv: THREE.Matrix4, b: Box, pad: number): number {
  const e = inv.elements;
  // ray into local space (affine inverse): origin as a point, direction as a vector; t stays in world units because
  // tLocal is measured along the transformed (non-normalised) direction.
  const lx = e[0] * ox + e[4] * oy + e[8] * oz + e[12];
  const ly = e[1] * ox + e[5] * oy + e[9] * oz + e[13];
  const lz = e[2] * ox + e[6] * oy + e[10] * oz + e[14];
  const vx = e[0] * dx + e[4] * dy + e[8] * dz;
  const vy = e[1] * dx + e[5] * dy + e[9] * dz;
  const vz = e[2] * dx + e[6] * dy + e[10] * dz;
  let t0 = 0, t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    const o = k === 0 ? lx : k === 1 ? ly : lz;
    const v = k === 0 ? vx : k === 1 ? vy : vz;
    const lo = b[k] - pad, hi = b[k + 3] + pad;
    if (Math.abs(v) < 1e-9) { if (o < lo || o > hi) return Infinity; continue; }
    let a = (lo - o) / v, c = (hi - o) / v;
    if (a > c) { const s = a; a = c; c = s; }
    if (a > t0) t0 = a;
    if (c < t1) t1 = c;
    if (t0 > t1) return Infinity;
  }
  return t0;
}

/**
 * Bake a layout's walls into flat plan segments for `wallBlocks` (cached per layout object).
 */
export function bakeOccluders(layout: Pick<Layout, 'walls'> | null | undefined): Occluder[] {
  const out: Occluder[] = [];
  for (const w of layout?.walls ?? []) {
    if (w.kind === 'rail') continue; // glass balustrade: see-through
    const [ax, az] = w.a, [bx, bz] = w.b;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-3) continue;
    const y0 = w.y0 ?? 0;
    out.push({
      ax, az, ux: (bx - ax) / len, uz: (bz - az) / len, len, y0, y1: y0 + w.h,
      ops: (w.openings ?? []).map((o) => ({ s0: o.at, s1: o.at + o.w, c0: y0 + (o.sill ?? 0), c1: y0 + (o.sill ?? 0) + o.h })),
    });
  }
  return out;
}

/**
 * Does a solid wall span cut the ray o + t·d for t in (0, T)? Plan-space segment intersection, then the ray's height at
 * the crossing is checked against the wall's [y0, y0+h] minus any opening covering that point.
 */
export function wallBlocks(occ: readonly Occluder[], ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, T: number): boolean {
  for (let i = 0; i < occ.length; i++) {
    const w = occ[i];
    // solve o + t·d = a + s·u (plan); denom = cross(d, u)
    const den = dx * w.uz - dz * w.ux;
    if (Math.abs(den) < 1e-9) continue; // parallel
    const qx = w.ax - ox, qz = w.az - oz;
    const t = (qx * w.uz - qz * w.ux) / den;
    if (t <= 0.05 || t >= T - 0.05) continue;
    const s = (qx * dz - qz * dx) / den;
    if (s < 0 || s > w.len) continue;
    const y = oy + t * dy;
    if (y < w.y0 || y > w.y1) continue;
    let open = false;
    for (let k = 0; k < w.ops.length; k++) {
      const o = w.ops[k];
      if (s >= o.s0 && s <= o.s1 && y >= o.c0 && y <= o.c1) { open = true; break; }
    }
    if (!open) return true;
  }
  return false;
}

/** `getLayout` = the current layout (`ctx.layout`); its walls occlude the aim. */
export function createAim<A extends ActorView>(actors: { list(): A[] } | null, getLayout: () => Pick<Layout, 'walls'> | null = () => null) {
  let occLayout: Pick<Layout, 'walls'> | null = null;
  let occ: Occluder[] = [];
  const inv = new THREE.Matrix4();
  const fb = new THREE.Matrix4();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);

  /** Is the rig's world matrix current (charBatch refreshes it only for on-screen actors)? */
  const fresh = (a: PlacedActor) => {
    const m = a.rig?.root?.matrixWorld?.elements;
    return !!m && Math.abs(m[12] - a.pos.x) < 0.05 && Math.abs(m[14] - a.pos.z) < 0.05 && Math.abs(m[13] - (a.pos.y ?? 0)) < 0.05;
  };
  const test = (node: THREE.Object3D | undefined, box: Box, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, pad: number) => {
    if (!node?.matrixWorld) return Infinity;
    inv.copy(node.matrixWorld).invert();
    return hitBox(ox, oy, oz, dx, dy, dz, inv, box, pad);
  };

  /** Entry depth of the reticle ray into actor `a`'s body, or Infinity. */
  function depth(a: PlacedActor, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, pad: number): number {
    const rig = a.rig;
    const n = rig?.nodes;
    if (n && fresh(a)) {
      if (rig.species === 'shelly') {
        return Math.min(test(n.shape, SHELLY_HEAD, ox, oy, oz, dx, dy, dz, pad), test(rig.root, SHELLY_COLUMN, ox, oy, oz, dx, dy, dz, pad));
      }
      if (n.shape) {
        const hat = hatBox(rig.crown);
        const t = test(n.shape, CLAWD_BODY, ox, oy, oz, dx, dy, dz, pad);
        return hat ? Math.min(t, test(n.shape, hat, ox, oy, oz, dx, dy, dz, pad)) : t;
      }
    }
    const kind = rig?.species === 'shelly' || a.entity?.kind === 'shell' ? 'shelly' : 'clawd';
    quat.setFromAxisAngle(up, a.yaw ?? 0);
    fb.compose(pos.set(a.pos.x, a.pos.y ?? 0, a.pos.z), quat, one);
    inv.copy(fb).invert();
    return hitBox(ox, oy, oz, dx, dy, dz, inv, FALLBACK[kind], pad);
  }

  /** Highest world y of box `b` in node `node`'s frame. */
  const boxTop = (node: THREE.Object3D, b: Box) => {
    const e = node.matrixWorld.elements;
    let top = -Infinity;
    for (let i = 0; i < 8; i++) {
      const x = b[i & 1 ? 3 : 0], y = b[i & 2 ? 4 : 1], z = b[i & 4 ? 5 : 2];
      top = Math.max(top, e[1] * x + e[5] * y + e[9] * z + e[13]);
    }
    return top;
  };

  return {
    /**
     * World-space top (max y) of actor `a`'s aim boxes: exactly the boxes pick() tests, hat included (p2 stages a
     * sightline "just over F" from it). Refreshes the rig's matrices when charBatch has not (actor off screen).
     */
    top(a: PlacedActor | null | undefined): number {
      const rig = a?.rig, n = rig?.nodes;
      if (a && rig && n && !fresh(a)) rig.root.updateMatrixWorld(true);
      if (a && rig && n && fresh(a)) {
        if (rig.species === 'shelly') return Math.max(n.shape ? boxTop(n.shape, SHELLY_HEAD) : -Infinity, boxTop(rig.root, SHELLY_COLUMN));
        if (n.shape) { const hat = hatBox(rig.crown); return Math.max(boxTop(n.shape, CLAWD_BODY), hat ? boxTop(n.shape, hat) : -Infinity); }
      }
      const kind = rig?.species === 'shelly' || a?.entity?.kind === 'shell' ? 'shelly' : 'clawd';
      return (a?.pos?.y ?? 0) + FALLBACK[kind][4];
    },
    /** Is the straight segment a → b (world) cut by a solid wall span? (p2: pick staging spots with a clear view) */
    sightBlocked(a: readonly number[], b: readonly number[]): boolean {
      const L = getLayout();
      if (L !== occLayout) { occLayout = L; occ = bakeOccluders(L); }
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], T = Math.hypot(dx, dy, dz) || 1;
      return wallBlocks(occ, a[0], a[1], a[2], dx / T, dy / T, dz / T, T);
    },
    /**
     * The actor the reticle ray hits first. `ndcX` = the ray's x in NDC around the camera axis (0 = the reticle: main.ts
     * centres the projection on the world strip); `walls: false` ignores wall occlusion (p2 diagnostics only).
     */
    pick(camera: THREE.PerspectiveCamera, maxDist = AIM_MAX_DIST, ndcX = 0, walls = true): (A & PlacedActor) | null {
      if (!actors) return null;
      const e = camera.matrixWorld.elements;
      // ray through (ndcX, 0): camera-space dir (ndcX·tan(fov/2)·aspect, 0, -1) → world (columns 0 and 2 of matrixWorld)
      const sx = ndcX * Math.tan((camera.fov * Math.PI) / 360) * camera.aspect;
      let dx = e[0] * sx - e[8], dy = e[1] * sx - e[9], dz = e[2] * sx - e[10];
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l; dy /= l; dz /= l;
      const ox = e[12], oy = e[13], oz = e[14];
      let best: (A & PlacedActor) | null = null;
      let bestT = Infinity;
      for (const a of actors.list()) {
        if (!isPlaced(a) || !a.entity) continue;
        // cheap reject: the actor's centre must be ahead and within reach (+ its own size)
        const cx = a.pos.x - ox, cy = (a.pos.y ?? 0) + 0.4 - oy, cz = a.pos.z - oz;
        const along = cx * dx + cy * dy + cz * dz;
        if (along < -0.5 || along > maxDist + 0.6) continue;
        if (cx * cx + cy * cy + cz * cz - along * along > 1.2) continue; // > ~1.1 m off the ray
        const t = depth(a, ox, oy, oz, dx, dy, dz, 0.004 * along); // a hair of forgiveness at range
        if (t < 0.15 || t > maxDist || t >= bestT) continue;
        best = a; bestT = t;
      }
      if (best && walls) {
        const L = getLayout();
        if (L !== occLayout) { occLayout = L; occ = bakeOccluders(L); }
        if (occ.length && wallBlocks(occ, ox, oy, oz, dx, dy, dz, bestT)) return null;
      }
      return best;
    },
  };
}
