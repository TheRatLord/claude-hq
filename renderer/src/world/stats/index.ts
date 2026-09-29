/**
 * The stats world (§7.4): instantiates every registered stats object at its layout anchor (`layout.statAnchors`),
 * feeds it `store.stats` once per frame, and runs the crosshair tooltip (aim ≤ 8 m → title, value, a 5-minute
 * sparkline and the source). Objects far from the camera skip their per-frame animation; objects with no clear line
 * of sight past the layout's solid walls are hidden (`visible = false`: no draw, no update, no tooltip), so the Engine
 * Room is not drawn from the street or the bays.
 *
 *   const statsWorld = createStats(ctx, { root: uiRoot, aimedAgent: () => ui.aimed() });
 *   statsWorld.update(ctx)   // once per frame, after world.update (§8.1 step 5)
 *
 * Owner: STAT.
 */
import * as THREE from 'three';
import { statFactory } from './registry.ts';
import type { StatObject } from './registry.ts';
import { lodOf } from './panel.ts';
import type { Ctx } from '../../core/ctx.ts';
import { errMessage } from '../../../../shared/guards.ts';
import { createTooltip } from './tooltip.ts';
import { bakeOccluders, wallBlocks } from '../../ui/aim.ts';
import { hqStatSection } from '../../core/debug.ts';
// every stats module registers its factory on import
import './bigBoard.ts';
import './ramColumn.ts';
import './rack.ts';
import './gauge.ts';
import './drawers.ts';
import './hamster.ts';
import './misc.ts';
import './net.ts';
import './weather.ts';

export const TOOLTIP_MAX_DIST = 8;
/** Beyond this, objects hold still (no per-frame animation; readouts still refresh when they come back). */
const ANIM_DIST = 30;
/**
 * [STAT fix m3 r3 code] Beyond this (camera → object centre, +1 m hysteresis back in) every mesh that carries
 * `userData.lod = {hi, lo}` (createParts meshes and the instanced drawers / fan blades / pulses / rings built from them)
 * draws its low-detail geometry: plain boxes and ~⅓ the segments, so the §5.3 stat triangle cap (60k main pass) holds
 * from every canonical pose (eBayGlass / plan were 70–73k, mostly the drawer wall's rounded fronts at 23–40 m).
 */
export const LOD_DIST = 16;
/** far = low detail; hysteresis so an object at the edge doesn't flip every step (pure, tested). */
export const lodFar = (dist: number, wasFar: boolean) => dist > (wasFar ? LOD_DIST - 1 : LOD_DIST);
/** Swap every lod-carrying mesh under `root` to its hi / lo geometry; returns how many meshes it touched. */
export function applyLod(root: THREE.Object3D, far: boolean): number {
  let n = 0;
  root.traverse((o) => {
    const l = lodOf(o);
    if (!l || !(o instanceof THREE.Mesh)) return;
    n++;
    const g = far ? l.lo : l.hi;
    if (o.geometry !== g) o.geometry = g;
  });
  return n;
}

/** One instantiated stats object with its culling / LOD bookkeeping. */
interface StatItem {
  id: string;
  kind: string;
  obj: StatObject;
  boxes: THREE.Box3[] | null;
  center: THREE.Vector3;
  /** cull sample points (x, y, z triples), null = always drawn */
  pts?: Float32Array | null;
  measured?: boolean;
  hidden?: boolean;
  lodFar?: boolean;
  lodKids?: number;
}

export interface StatsWorld {
  group: THREE.Group | null;
  items: StatItem[];
  /** Currently aimed stats object id (tooltip), or null. */
  aimed: () => string | null;
  update: (c: Ctx) => void;
  stats: () => Record<string, unknown>;
  tooltipOf: (id: string) => ReturnType<StatObject['tooltip']> | null;
  dispose: () => void;
}

export function createStats(ctx: Ctx, o: { root?: HTMLElement; aimedAgent?: () => string | null } = {}): StatsWorld {
  // `?nostats` (perf A/B): no stats objects at all
  try { if (new URLSearchParams(location.search).has('nostats')) return { group: null, items: [], aimed: () => null, update() {}, stats: () => ({ objects: 0 }), tooltipOf: () => null, dispose() {} }; } catch { /* no location */ }
  const layout = ctx.layout;
  const group = new THREE.Group();
  group.name = 'stats';
  ctx.scene.add(group);
  const items: StatItem[] = [];
  const errors: string[] = [];
  for (const a of layout?.statAnchors ?? []) {
    const f = statFactory(a.id);
    if (!f) continue;
    let made: StatObject | StatObject[] | null = null;
    try {
      made = f(ctx, { ...a, cell: layout.zoneAt?.(a.pos.x, a.pos.z, a.pos.y > 3.5 ? 1 : 0) ?? null });
    } catch (e) {
      errors.push(`${a.id}: ${errMessage(e)}`);
      console.warn('[stats]', a.id, e);
    }
    for (const obj of [made].flat()) {
      if (!obj?.object3d) continue;
      group.add(obj.object3d);
      items.push({ id: a.id, kind: a.kind, obj, boxes: null, center: new THREE.Vector3(a.pos.x, a.pos.y, a.pos.z) });
    }
  }
  group.updateMatrixWorld(true);
  // [STAT m2 r2] wall culling: each object keeps a few sample points over its world box (≤ 9 per horizontal axis, 3
  // heights, 12% inset); it is drawn only while at least one point has a clear line from the eye past the layout's
  // solid wall spans (openings, glazing, storefronts and rails see through — the same 2.5D occluders as the tooltip's
  // aim test). Per object rather than per vis cell: the glazed ENG is "visible" from the street as a cell, the rack
  // behind its solid wall is not. Re-evaluated only when the eye moves ≥ 0.25 m (≈ 0.1 ms).
  const occ = bakeOccluders(layout);
  /** (re)measure an object: aim boxes + cull sample points; false while it is still empty (built on first stats) */
  const measure = (it: StatItem) => {
    it.obj.object3d.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(it.obj.object3d);
    // an object drawn inside another's panel set (the chalkboards, boards.ts) has no geometry: its aim boxes are its box
    if (b.isEmpty() && it.obj.hitBoxes?.length) for (const h of it.obj.hitBoxes) b.union(h);
    it.pts = null;
    if (b.isEmpty()) return false;
    it.boxes = it.obj.hitBoxes ?? [b]; b.getCenter(it.center);
    if (!occ.length) return true;
    const sz = b.getSize(new THREE.Vector3());
    const n = (d: number) => Math.max(2, Math.min(9, Math.ceil(d / 1.0) + 1));
    const nx = n(sz.x), nz = n(sz.z), ny = 3;
    const pts: number[] = [];
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) for (let k = 0; k < ny; k++) {
      pts.push(b.min.x + sz.x * (0.12 + 0.76 * i / (nx - 1)), b.min.y + sz.y * (0.12 + 0.76 * k / (ny - 1)), b.min.z + sz.z * (0.12 + 0.76 * j / (nz - 1)));
    }
    it.pts = new Float32Array(pts);
    return true;
  };
  for (const it of items) it.measured = measure(it);
  const lastEye = new THREE.Vector3(Infinity, 0, 0);
  let culled = 0, cullMs = 0, lodSwaps = 0;
  const seesAny = (eye: THREE.Vector3, pts: Float32Array) => {
    for (let i = 0; i < pts.length; i += 3) {
      const dx = pts[i] - eye.x, dy = pts[i + 1] - eye.y, dz = pts[i + 2] - eye.z;
      const T = Math.hypot(dx, dy, dz);
      if (T < 1e-3 || !wallBlocks(occ, eye.x, eye.y, eye.z, dx / T, dy / T, dz / T, T)) return true;
    }
    return false;
  };
  /** Show / hide each object for this eye (only when the eye moved ≥ 0.25 m). */
  const cull = (eye: THREE.Vector3) => {
    if (eye.distanceToSquared(lastEye) < 0.0625) return;
    lastEye.copy(eye);
    const t0 = performance.now();
    culled = 0;
    for (const it of items) {
      if (!it.measured) { it.measured = measure(it); if (it.measured) it.obj.object3d.visible = true; } // lazily built (drawers)
      const on = !it.pts || seesAny(eye, it.pts);
      it.obj.object3d.visible = on;
      it.hidden = !on;
      if (!on) culled++;
    }
    cullMs = performance.now() - t0;
  };

  const tooltip = o.root ? createTooltip(o.root) : null;
  const ray = new THREE.Ray();
  const hitP = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  let aimedId: string | null = null;
  let aimAcc = 0;
  let lastStats: Ctx['store']['stats'] = null;
  let upd = 0;

  const pick = (camera: THREE.Camera) => {
    camera.getWorldPosition(camPos);
    ray.origin.copy(camPos);
    camera.getWorldDirection(ray.direction);
    let best: StatItem | null = null, bestT = TOOLTIP_MAX_DIST;
    for (const it of items) {
      if (!it.boxes || it.obj.noTooltip || it.hidden) continue;
      for (const box of it.boxes) {
        if (box.distanceToPoint(camPos) > TOOLTIP_MAX_DIST) continue;
        const p = ray.intersectBox(box, hitP);
        if (!p) continue;
        const t = p.distanceTo(camPos);
        if (t >= bestT) continue;
        const d = ray.direction;
        if (wallBlocks(occ, camPos.x, camPos.y, camPos.z, d.x, d.y, d.z, t)) continue;
        best = it; bestT = t;
      }
    }
    return best;
  };

  const api: StatsWorld = {
    group,
    items,
    aimed: () => aimedId,
    /** Per frame (§8.1 step 5). */
    update(c) {
      const stats = c.store?.stats ?? null;
      const cam = c.camera;
      cam.getWorldPosition(camPos);
      const t0 = performance.now();
      cull(camPos);
      for (const it of items) {
        if (it.hidden) continue; // culled: no draw, no animation, no canvas redraw (it catches up when it comes back)
        const d2 = it.center.distanceToSquared(camPos);
        // level of detail: re-applied when the level flips or the object grew children (lazily built drawers)
        const lodF = lodFar(Math.sqrt(d2), !!it.lodFar), kids = it.obj.object3d.children.length;
        if (lodF !== it.lodFar || kids !== it.lodKids) { it.lodFar = lodF; it.lodKids = kids; applyLod(it.obj.object3d, lodF); if (lodF) lodSwaps++; }
        const far = d2 > ANIM_DIST * ANIM_DIST;
        const fresh = stats !== lastStats;
        // far objects still take new samples (1 Hz) so their readouts are current, but skip per-frame animation
        if (far && !fresh && !it.obj.always) continue;
        try { it.obj.update(stats, far && !it.obj.always ? 0 : c.dt, c); } catch (e) { if (errors.length < 20) errors.push(`${it.id}: ${errMessage(e)}`); }
      }
      lastStats = stats;
      upd = performance.now() - t0;
      // tooltip at ≤ 20 Hz
      aimAcc += c.rawDt ?? c.dt;
      if (tooltip && aimAcc >= 0.05) {
        aimAcc = 0;
        const agent = o.aimedAgent?.() ?? null;
        const it = !agent && !c.hidden ? pick(cam) : null;
        aimedId = it?.id ?? null;
        if (it) tooltip.show(it.obj.tooltip());
        else tooltip.hide();
      }
    },
    stats: () => ({
      objects: items.length, ids: items.map((i) => i.id), aimed: aimedId, errors: errors.slice(0, 5), updateMs: +upd.toFixed(3),
      culled, cullMs: +cullMs.toFixed(3), lodFar: items.filter((i) => i.lodFar && !i.hidden).map((i) => i.id), lodSwaps, hidden: items.filter((i) => i.hidden).map((i) => i.id),
      redraws: items.reduce((n, i) => n + (i.obj.redraws?.() ?? 0), 0),
      tip: aimedId ? api.tooltipOf(aimedId) && { ...api.tooltipOf(aimedId), spark: undefined } : null,
    }),
    /** Tooltip payload for an anchor id (debug / tests). */
    tooltipOf: (id: string) => items.find((i) => i.id === id)?.obj.tooltip() ?? null,
    dispose() {
      for (const it of items) it.obj.dispose?.();
      ctx.scene.remove(group);
      tooltip?.dispose();
    },
  };
  hqStatSection('statsWorld', api.stats);
  return api;
}
