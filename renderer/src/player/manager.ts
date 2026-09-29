// @pure
/**
 * Manager's desk (PLY camera half of the M3 PLY+UI row): E on the mezzanine-rail desk (the hot desk on the Pit axis,
 * or `layout.points.managerDesk` when LVL adds one) lifts the camera to an overhead view over the atrium and the Pit;
 * WASD pans, the wheel zooms, drag looks (clamped), a click selects the agent under the cursor (bus `player.select`),
 * the UI docks the roster (bus `player.manager`). Esc stands up (back to the pose E was pressed from).
 * This file is the math: which desk, the view pose, pan / zoom limits, and the click pick. No three.js.
 * Owner: PLY.
 */
import type { HqPoints, Layout, Vec3 } from '../world/layout/schema.ts';
import type { Widen } from './follow.ts';

export const MANAGER = Object.freeze({
  glide: 0.7,            // s: rise from the desk to the overhead view (and back down)
  dist: 6.6,             // m (horizontal) from the focus back toward the desk
  height: 4.2,           // eye y ≈ 0.4 + height at zoom 1 (4.6 m: under the atrium beams and fans, over the Big Board's bottom)
  maxY: 4.7,
  fov: 54,
  zoom: [0.72, 1.18],    // dist × this range (wheel)
  pan: [4.2, 4.2],       // m: focus may move ± this in x / z from the Pit centre
  panSpeed: 4.0,         // m/s
  lookClamp: [0.55, 0.35], // rad: yaw / pitch freedom around the default look
  pickR: 0.09,           // NDC (height units): click radius around an actor's projected body
  bodyY: 0.45,           // m: projected point above the feet
  deskRadius: 1.6,       // E radius (as §6.10 Interaction)
});

export type ManagerOpts = Widen<typeof MANAGER>;
export interface ManagerDesk { x: number; y: number; z: number; id: string | null; slotId: string | null }
/** The named points the manager view reads: the hq ones, plus the optional `pit` / `managerDesk` LVL may add. */
export type ManagerPoints = Partial<HqPoints> & { pit?: Vec3; managerDesk?: { x: number; y?: number; z: number; id?: string } };
/** A layout's points seen through the hq / optional fields (a proto room has only the base points). */
export const pointsOf = (L: Layout | null | undefined): ManagerPoints | undefined => L?.points as ManagerPoints | undefined; // the base LayoutPoints is the subset every layout has

/** The manager's desk: `layout.points.managerDesk` ({x, y, z, yaw?}) or the level-1 hot desk nearest the Pit's axis. */
export function managerDesk(L: Layout | null | undefined): ManagerDesk | null {
  if (!L) return null;
  const pts = pointsOf(L);
  const pit = pts?.pitCenter ?? pts?.pit ?? { x: 0, z: 0 };
  const pd = pts?.managerDesk;
  let desk: { x: number; y: number; z: number; id: string | null } | null = null;
  if (pd) desk = { x: pd.x, y: pd.y ?? 0, z: pd.z, id: pd.id ?? 'managerDesk' };
  else {
    let bd = Infinity;
    for (const f of L.furniture ?? []) {
      if (f.type !== 'hotDesk') continue;
      const d = Math.abs(f.pos.x - pit.x) + 0.01 * Math.abs(f.pos.z - pit.z);
      if (d < bd) { bd = d; desk = { x: f.pos.x, y: f.pos.y ?? 0, z: f.pos.z, id: f.id ?? null }; }
    }
  }
  if (!desk) return null;
  // its seat (the hot-desk slot nearest), so the desk's chair shows "E manager's desk" instead of "E sit"
  let slotId: string | null = null, bs = 1.2;
  for (const s of L.slots ?? []) {
    if (s.tag !== 'hotdesk' && s.tag !== 'managerDesk') continue;
    const d = Math.hypot(s.pos.x - desk.x, s.pos.z - desk.z);
    if (d < bs) { bs = d; slotId = s.id; }
  }
  return { ...desk, slotId };
}

/**
 * Overhead view: eye `dist` back from the focus toward the desk, `height` up, looking at the focus. `pan` = focus offset
 * from the Pit centre, `zoom` = dist multiplier.
 */
export function managerView(L: Layout | null | undefined, pan: { x: number; z: number } = { x: 0, z: 0 }, zoom = 1, o: ManagerOpts = MANAGER): { x: number; y: number; z: number; yaw: number; pitch: number; fov: number; focus: Vec3 } {
  const pts = pointsOf(L);
  const pit = pts?.pitCenter ?? pts?.pit ?? { x: 0, y: 0, z: 0 };
  const desk = managerDesk(L) ?? { x: pit.x, z: pit.z - 8 };
  let bx = desk.x - pit.x, bz = desk.z - pit.z;
  const bl = Math.hypot(bx, bz) || 1;
  bx /= bl; bz /= bl;
  const fx = pit.x + clamp(pan.x, -o.pan[0], o.pan[0]), fz = pit.z + clamp(pan.z, -o.pan[1], o.pan[1]);
  const fy = L?.floorY ? L.floorY(fx, fz, 0) : 0;
  const z = clamp(zoom, o.zoom[0], o.zoom[1]);
  const d = o.dist * z;
  const ex = fx + bx * d, ez = fz + bz * d;
  // closer = lower; never into the atrium roof beams / fans (≈ 4.9 m) and the Big Board stays a banner along the top
  const ey = Math.min(o.maxY, 0.4 + o.height * (0.55 + 0.45 * z));
  const dx = fx - ex, dy = fy - ey, dz = fz - ez;
  return { x: ex, y: ey, z: ez, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)), fov: o.fov, focus: { x: fx, y: fy, z: fz } };
}

/**
 * Pan step from held keys in the view's ground frame (W = away from the camera); `dir` = forward / right input (−1..1).
 */
export function panStep(pan: { x: number; z: number }, yaw: number, dir: { f: number; r: number }, dt: number, o: ManagerOpts = MANAGER): { x: number; z: number } {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const v = o.panSpeed * dt;
  pan.x = clamp(pan.x + (fx * dir.f + rx * dir.r) * v, -o.pan[0], o.pan[0]);
  pan.z = clamp(pan.z + (fz * dir.f + rz * dir.r) * v, -o.pan[1], o.pan[1]);
  return pan;
}

/**
 * The actor under a click: nearest projected body point within `pickR` (aspect-corrected NDC), nearer depth wins ties.
 * `project` gives NDC x, y, depth (z ≤ 1 in front); `aspect` = width / height.
 */
export function pickAt(
  ndcX: number, ndcY: number, actors: Iterable<{ id: string; pos: { x: number; y?: number; z: number }; hidden?: boolean; mode?: string }>,
  project: (x: number, y: number, z: number) => [number, number, number] | null, aspect = 16 / 9, o: ManagerOpts = MANAGER,
): string | null {
  let best: string | null = null, bd = Infinity;
  for (const a of actors) {
    if (!a?.pos || a.hidden || a.mode === 'leave') continue;
    const q = project(a.pos.x, (a.pos.y ?? 0) + o.bodyY, a.pos.z);
    if (!q || q[2] > 1 || q[2] < -1) continue;
    const d = Math.hypot((q[0] - ndcX) * aspect, q[1] - ndcY);
    if (d > o.pickR) continue;
    const score = d + q[2] * 0.01;
    if (score < bd) { bd = score; best = a.id; }
  }
  return best;
}

function clamp(v: number, a: number, b: number) { return v < a ? a : v > b ? b : v; }
