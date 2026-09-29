/**
 * `__hq.frameCheck(dist = 4)` (§6.1 framing rule, §9.1): the projected screen height of a real standing Clawd rig
 * `dist` m straight in front of the camera, as a fraction of the viewport height (target ≥ 0.18 at 1600×900, FOV 60).
 * Borrows one Clawd actor's rig for a single synchronous measurement: its root is moved in front of the camera,
 * its visible parts' geometry bounding boxes are projected, and the transform is restored before the next frame (the animator rewrites
 * the pose every frame anyway). Every part counts, accessory included (the 0.88 m in §6.1).
 * Owner: integration glue (INT M1.5); CHR may take it over.
 */
import * as THREE from 'three';
import { geometryFor } from '../chars/render/geometry.ts';
import type { PartType } from '../chars/render/geometry.ts';
import type { RigPart } from '../chars/rig/build.ts';

/** The slice of an actor the check reads. */
export interface FrameActor {
  id: string;
  rig?: { species?: string; root: THREE.Object3D; parts?: RigPart[] } | null;
  entity?: { status?: string } | null;
  intent?: { activity?: string | null } | null;
}
export interface FrameCheckResult {
  pass: boolean; min: number; heightFrac: number; heightPx: number; viewportH: number; actor: string; dist: number;
  worldH: number; topPart: string; activity: string | null;
}
export type FrameCheckFn = (dist?: number) => FrameCheckResult | null;

/** The 8 corners of the part geometry's bounding box. */
const cornerCache = new Map<PartType, THREE.Vector3[]>();
function corners(type: PartType): THREE.Vector3[] {
  let c = cornerCache.get(type);
  if (!c) {
    const b = geometryFor(type).boundingBox;
    if (!b) throw new Error(`frameCheck: ${type} geometry has no bounding box`); // geometryFor always computes it
    c = [];
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) c.push(new THREE.Vector3(x, y, z));
    cornerCache.set(type, c);
  }
  return c;
}
/** A part is drawn only when its node and every ancestor are visible (charBatch.updateVisible). */
const shown = (n: THREE.Object3D): boolean => { for (let o: THREE.Object3D | null = n; o; o = o.parent) if (!o.visible) return false; return true; };

export function createFrameCheck({ camera, actors }: { camera: THREE.PerspectiveCamera; actors: { list(): FrameActor[] } }): FrameCheckFn {
  const v = new THREE.Vector3(), fwd = new THREE.Vector3();
  return (dist = 4) => {
    const list = actors.list().filter((a) => a.rig?.species === 'clawd' && a.rig.root);
    // prefer a standing agent (not seated / riding): working agents sit, so pick idle/unknown/blocked first
    list.sort((a, b) => rank(a) - rank(b));
    const a = list[0];
    if (!a) return null;
    if (!a.rig) return null; // (the filter above kept only actors with a rig)
    const root = a.rig.root;
    const save = { p: root.position.clone(), r: root.rotation.y };
    camera.updateMatrixWorld();
    camera.getWorldDirection(fwd);
    if (Math.abs(fwd.y) > 0.6) return null; // top-down / steep poses (plan): the framing rule is about eye-level views
    fwd.y = 0; fwd.normalize();
    const feetY = camera.position.y - 1.2; // eye height 1.2 m (§6.1)
    root.position.set(camera.position.x + fwd.x * dist, feetY, camera.position.z + fwd.z * dist);
    root.rotation.y = Math.atan2(-fwd.x, -fwd.z) + Math.PI; // facing the camera (actors.ts convention: yaw + π)
    root.updateMatrixWorld(true);
    let lo = Infinity, hi = -Infinity, wlo = Infinity, whi = -Infinity, topPart = '';
    for (const p of a.rig.parts ?? []) {
      if (!shown(p.node)) continue;
      for (const c of corners(p.type)) {
        v.copy(c).applyMatrix4(p.node.matrixWorld);
        if (v.y < wlo) wlo = v.y;
        if (v.y > whi) { whi = v.y; topPart = p.type; }
        v.project(camera);
        if (v.y < lo) lo = v.y;
        if (v.y > hi) hi = v.y;
      }
    }
    root.position.copy(save.p); root.rotation.y = save.r; root.updateMatrixWorld(true);
    if (!Number.isFinite(lo)) return null;
    const heightFrac = (hi - lo) / 2;
    const viewportH = innerHeight;
    return { pass: heightFrac >= MIN_FRAC, min: MIN_FRAC, heightFrac: +heightFrac.toFixed(4), heightPx: Math.round(heightFrac * viewportH), viewportH, actor: a.id, dist,
      worldH: +(whi - wlo).toFixed(3), topPart, activity: a.intent?.activity ?? null };
  };
}

const MIN_FRAC = 0.18; // §6.1 / M1.5: ≥ 18% of frame height at 4 m
const RANK: Record<string, number> = { idle: 0, unknown: 1, blocked: 2, done: 3, working: 4 };
const rank = (a: FrameActor): number => (RANK[a.entity?.status ?? ''] ?? 5);
