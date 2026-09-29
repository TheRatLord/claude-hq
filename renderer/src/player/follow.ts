// @pure
/**
 * Follow camera (PLY, §8 "follow"; reviewer m2-r1 [ui] h04): picks and keeps a camera spot around a followed actor
 * whose view of it is clear of walls, tall furniture and — the reviewer case — *other actors*: no neighbour may cover
 * the target (screen-rect overlap, the analytic cousin of core/debug focusShot's `sightClear` actor test) or loom in
 * the foreground (a nearer actor's on-screen area). Candidates orbit the target (16 bearings × 3 distances × 3 eye
 * heights, raised spots look over heads); the best is kept with hysteresis and approached in polar coordinates around
 * the target, so the camera swings round the subject instead of cutting through its neighbours.
 * PLY m3 fix r3: a camera boom from the subject's face keeps the lens ≥ FOLLOW.boomGap off walls / tall furniture
 * (pull in, swing round a jamb, or cut to a spot the polar swing can't reach), and a face hidden ≥ FOLLOW.losHold
 * (checked every FOLLOW.losEvery, as go-there does) re-seats the camera: best visible spot, over the shoulder, up and back.
 * No three.js: plain math over layout / nav / actor data (node-testable).
 * Owner: PLY.
 */

import { DESK, deskLocal } from '../world/layout/proto.ts';
import type { Layout, Wall, WallOpening, Zone } from '../world/layout/schema.ts';

/** The literal types of a tuning table widened to what an override may hold (`Object.freeze` keeps `16`, not `number`). */
export type Widen<T> = T extends number ? number : T extends string ? string : T extends boolean ? boolean
  : T extends readonly (infer U)[] ? Widen<U>[] : T extends object ? { -readonly [K in keyof T]: Widen<T[K]> } : T;
/** The follow scorer's tuning (weights, distances, boom limits). */
export type FollowOpts = Widen<typeof FOLLOW>;
/** The slice of an actor the follow / stand-spot / go-there scorers read (`y` defaults to 0). */
export interface FollowActor { id: string; pos: { x: number; y?: number; z: number }; yaw?: number; hidden?: boolean }
/** The nav queries the scorers make (world/nav facade). */
export interface FollowNav {
  walkable(x: number, z: number, level: number, opts?: { owner?: string }): boolean;
  collides(x: number, z: number, r: number, level: number): boolean;
}
export interface FollowWall extends Omit<Wall, 'openings'> {
  openings: WallOpening[];
  dx: number; dz: number; len: number; x0: number; x1: number; z0: number; z1: number;
}
/** An oriented furniture box (`R` = bounding radius) for the slab clip. */
export interface FollowBox { x: number; z: number; y0: number; y1: number; c: number; s: number; hw: number; hd: number; R: number; type: string; desk?: string }
export interface FollowWorld { L: Layout | null | undefined; zones: Map<string, Zone>; walls: FollowWall[]; furn: FollowBox[] }
type V3 = [number, number, number];
interface Basis { f: V3; r: V3; u: V3; yaw: number; pitch: number }
interface Rect4 { x0: number; x1: number; y0: number; y1: number }
/** Polar orbit spot around the target: bearing `th` (0 = +z), horizontal distance `r`, eye height `h` above its feet. */
export interface Cand { th: number; r: number; h: number; kept?: boolean }
/** A scored spot; the metric fields are set once the spot passed the early rejections (`why`). */
export interface ScoredSpot extends Cand {
  x: number; z: number; y: number; score: number; why: string | null;
  clear?: boolean; glass?: number; cf?: number; yaw?: number; pitch?: number; faceB?: string | null;
  occ?: number; occBody?: number; fg?: number; who?: string | null; wall?: string | null; clutter?: number;
}

export const FOLLOW = Object.freeze({
  dists: [2.3, 1.8, 3.0],
  heights: [1.2, 1.75, 2.3, 3.0], // eye above the target's feet (3.0: over a crowd, where the ceiling allows)
  bearings: 16,
  bestDist: 2.3,
  aimY: 0.6,                      // look-at point above the target's feet (body centre ≈ face level for a seated Clawd)
  target: { r: 0.36, h: 1.15 },
  faceBand: [0.5, 1.15],          // the subject's part that must stay uncovered (above its feet)   // screen rect of the subject (cylinder)
  other: { r: 0.42, h: 1.3 },     // occluder cylinder for other actors (body + arms + hat)
  fovDeg: 60, aspect: 16 / 9,
  ceilGap: 0.3,
  wallGap: 0.22,                  // nav clearance of the camera spot
  evalEvery: 0.25,                // s between re-evaluations
  evalSlices: 3,                  // frames one re-evaluation is spread over (a few bearings per frame, clutter on the last)
  switchMargin: 25,               // a new spot must beat the kept one by this much
  approach: 2.4,                  // 1/s: polar approach rate toward the chosen spot
  look: 9,                        // 1/s: yaw / pitch approach rate
  userHold: 1.5,                  // s after a mouse nudge before the auto pick moves the camera again
  near: 0.45,                     // world rays ignore geometry this close to the subject (its own chair / desk edge)
  // score weights
  w: { occ: 700, occBody: 150, fg: 450, wallFace: 500, wallBody: 250, furnBody: 30, facing: 45, back: 60, height: 22, dist: 14, turn: 16, crowd: 6, clutter: 14, glass: 90, jamb: 60, otherRoom: 50 },
  clutterReach: 1.2, clutterTop: 12,              // m: world geometry this close to the lens across the frame slices the shot
  // PLY m3 fix r3 (reviewer [playtest] hq-07-after: following tinker through a doorway, the frame was all wall):
  // a camera boom from the subject's face out to the orbit spot; the lens never ends inside or flush against a wall
  pivotY: 0.85,                   // boom pivot above the subject's feet (face height, = the scorer's face sightline)
  boomGap: 0.3,                   // m: hard clearance of the lens from any wall surface / tall furniture side
  boomMin: 0.6,                   // m: the boom never pulls in closer than this; cramped there → cut to a new spot
  boomStep: 0.1,                  // m between sweep samples
  boomIn: 9, boomOut: 2.5,        // 1/s: the boom eases in toward the look-ahead limit / back out once past the wall
  boomLead: 0.35,                 // s: look-ahead along the subject's velocity (pull in before the jamb arrives)
  boomTurn: Math.PI / 12,         // rad: bearing steps tried when the boom is cramped at boomMin (a doorway jamb)
  boomHold: 0.8,                  // s the swung boom holds its bearing (the walker clears the doorway)
  swingMin: 1.2,                  // m: a swing to a new spot whose boom would fold shorter than this on the way cuts instead
  cutCooldown: 0.8,               // s between cuts (nothing had room: a fresh pick)
  // reviewer [fun] t-p-5: the face-occlusion check go-there runs, for the follow rig too
  losEvery: 0.18,                 // s between face sightline checks
  losHold: 0.4,                   // s the face may stay hidden before the camera re-seats
  reseatCooldown: 1.0,            // s after a re-seat before the next
  shoulder: [{ r: 1.4, h: 1.75 }, { r: 1.8, h: 2.3 }], // over-the-shoulder fallback spots (behind its heading)
});
/** Furniture that never blocks a follow view (flat, see-through, or a huge bounding box that isn't solid mass). */
const IGNORE = new Set(['rug', 'podRug', 'mat', 'yogaMat', 'medallion', 'dais', 'stairs', 'slide', 'bigBoard',
  'banner', 'hangingPlant', 'stanchion', 'beacon', 'testLight', 'starChart', 'ladder', 'hammock']);
/** Footprint heights leave out what stands above them: chair backs (0.32 m seat), bench / hot-desk screens. */
const HEIGHT_OVERRIDE: Record<string, number | undefined> = { hotDesk: 0.95, shellBench: 0.95, chair: 0.85 };
/**
 * m3 fix r1: a bay desk is its top (0.55 m) + its monitor as a separate box (the placement bays.ts dresses from
 * proto.ts deskLocal: 0.42 m bezel, ≈ 0.12 m deep with the stand, top ≈ 0.8 m). The old single 1.0 m box hid every
 * screen seen across a neighbouring desk and made the desk-worker framers (standSpot, UI goto) blind to its screen.
 */
const MON_BOX = { hw: DESK.monitor.w / 2, hd: 0.06, top: DESK.h + DESK.monitor.lift + DESK.monitor.h / 2 + 0.03 };
const D = Math.PI / 180;
/** Foreground-clutter probe directions [yaw, pitch] off the view axis (as core/debug focusShot's FG_RAYS). */
const FG_RAYS = ([[-24, -10], [-12, -10], [12, -10], [24, -10], [-24, 8], [-12, 8], [12, 8], [24, 8], [-30, 0], [30, 0]] as const).map(([h, v]) => [h * D, v * D] as const);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Deterministic cost counters (m2 fix r2): the perf test budgets *work* — sightline rays, wall-segment crossings,
 * furniture-box clips, zone samples, actor projections — instead of wall-clock time, which flakes under the parallel
 * `node --test` run. Monotonic; read deltas with `followCost()`.
 */
const COST = { rays: 0, walls: 0, boxes: 0, samples: 0, actors: 0, spots: 0 };
/** Snapshot of the cost counters (diff two snapshots to cost a piece of work). */
export const followCost = () => ({ ...COST });

/** Static world data for occlusion tests, built once per layout. */
export function followWorld(L: Layout | null | undefined): FollowWorld {
  const zones = new Map<string, Zone>();
  for (const z of L?.zones ?? []) zones.set(`${z.level ?? 0}:${z.id}`, z);
  const walls: FollowWall[] = (L?.walls ?? []).map((w) => {
    const dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1];
    return { ...w, openings: w.openings ?? [], dx, dz, len: Math.hypot(dx, dz),
      x0: Math.min(w.a[0], w.b[0]), x1: Math.max(w.a[0], w.b[0]), z0: Math.min(w.a[1], w.b[1]), z1: Math.max(w.a[1], w.b[1]) };
  });
  const furn: FollowBox[] = [];
  for (const f of L?.furniture ?? []) {
    if (IGNORE.has(f.type)) continue;
    const h = HEIGHT_OVERRIDE[f.type] ?? f.size[1];
    if (h < 0.4) continue;
    furn.push({ x: f.pos.x, z: f.pos.z, y0: f.pos.y ?? 0, y1: (f.pos.y ?? 0) + h, c: Math.cos(f.yaw ?? 0), s: Math.sin(f.yaw ?? 0),
      hw: f.size[0] / 2, hd: f.size[2] / 2, R: Math.hypot(f.size[0], f.size[2]) / 2, type: f.type });
    if (f.type === 'desk') {
      const { monitor: m } = deskLocal(f);
      const c = Math.cos(f.yaw ?? 0), sn = Math.sin(f.yaw ?? 0), yaw = (f.yaw ?? 0) + m.twist, y0 = (f.pos.y ?? 0) + f.size[1];
      furn.push({ x: f.pos.x + m.x * c + m.z * sn, z: f.pos.z - m.x * sn + m.z * c, y0, y1: (f.pos.y ?? 0) + MON_BOX.top,
        c: Math.cos(yaw), s: Math.sin(yaw), hw: MON_BOX.hw, hd: MON_BOX.hd, R: Math.hypot(MON_BOX.hw, MON_BOX.hd), type: 'monitor', desk: f.id });
    }
  }
  return { L, zones, walls, furn };
}

const GLASSY: ReadonlySet<string> = new Set(['glass', 'window', 'display', 'highWindow']);
/**
 * Is the world segment (ax,ay,az)→(bx,by,bz) blocked by a wall, a zone ceiling/floor, or tall furniture? Returns what
 * blocks it (or null). `acc` (optional) counts soft hits: `glass` panes crossed, `jamb` openings passed within 0.15 m
 * of their frame (a mullion / door jamb beside the sightline).
 */
export function worldBlocked(W: FollowWorld, level: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, skipNear = 0, acc: { glass: number; jamb: number } | null = null): string | null {
  const dx = bx - ax, dz = bz - az;
  COST.rays++;
  const sx0 = Math.min(ax, bx), sx1 = Math.max(ax, bx), sz0 = Math.min(az, bz), sz1 = Math.max(az, bz);
  // walls (2D crossing, then the crossing height vs the wall and its openings)
  for (const w of W.walls) {
    if ((w.level ?? 0) !== level && w.kind !== 'lintel') continue;
    if (w.x0 > sx1 || w.x1 < sx0 || w.z0 > sz1 || w.z1 < sz0) continue; // bounding boxes apart: can't cross
    COST.walls++;
    const den = dx * w.dz - dz * w.dx;
    if (Math.abs(den) < 1e-9) continue;
    const ex = w.a[0] - ax, ez = w.a[1] - az;
    const u = (ex * w.dz - ez * w.dx) / den; // along the ray
    const s = (ex * dz - ez * dx) / den;     // along the wall (0..1)
    if (u <= 0.02 || u >= 0.98 || s < 0 || s > 1) continue;
    const y = ay + (by - ay) * u - (w.y0 ?? 0);
    if (y < 0 || y > w.h) continue;
    const along = s * w.len;
    let open = false;
    for (const o of w.openings) {
      if (along >= o.at && along <= o.at + o.w && y >= o.sill && y <= o.sill + o.h) {
        open = true;
        if (acc) {
          if (GLASSY.has(o.kind)) acc.glass++;
          if (Math.min(along - o.at, o.at + o.w - along) < 0.15) acc.jamb++;
        }
        break;
      }
    }
    if (!open) return 'wall';
  }
  const len = Math.hypot(dx, dz);
  const n = Math.max(2, Math.ceil(len / 0.25));
  const L = W.L;
  // zone ceilings / floors (a raised eye looking under the mezzanine slab, the Pit rim)
  if (L?.zoneAt) {
    for (let i = 1; i < n; i++) {
      COST.samples++;
      const t = i / n, x = ax + dx * t, z = az + dz * t, y = ay + (by - ay) * t;
      const id = L.zoneAt(x, z, level);
      const zn = id ? W.zones.get(`${level}:${id}`) : undefined;
      if (!zn) continue;
      if (y > (zn.ceil ?? NaN) - 0.05) return 'ceiling'; // a zone without a ceiling never blocks (NaN compares false)
    }
  }
  // furniture: oriented boxes near the segment (slab clip in the box frame, then the height over the clipped span)
  const mx = (ax + bx) / 2, mz = (az + bz) / 2, half = len / 2;
  const tMax = skipNear > 0 && len > 0 ? 1 - skipNear / len : 1;
  if (tMax <= 0) return null;
  for (const f of W.furn) {
    if (Math.abs(f.x - mx) > half + f.R || Math.abs(f.z - mz) > half + f.R) continue;
    COST.boxes++;
    const rx = ax - f.x, rz = az - f.z;
    const lx = rx * f.c - rz * f.s, lz = rx * f.s + rz * f.c; // world → local (rotation.y = yaw)
    const ldx = dx * f.c - dz * f.s, ldz = dx * f.s + dz * f.c;
    let t0 = 0, t1 = tMax;
    if (Math.abs(ldx) < 1e-9) { if (Math.abs(lx) > f.hw) continue; } else {
      let u0 = (-f.hw - lx) / ldx, u1 = (f.hw - lx) / ldx;
      if (u0 > u1) { const q = u0; u0 = u1; u1 = q; }
      t0 = Math.max(t0, u0); t1 = Math.min(t1, u1);
    }
    if (t0 >= t1) continue;
    if (Math.abs(ldz) < 1e-9) { if (Math.abs(lz) > f.hd) continue; } else {
      let u0 = (-f.hd - lz) / ldz, u1 = (f.hd - lz) / ldz;
      if (u0 > u1) { const q = u0; u0 = u1; u1 = q; }
      t0 = Math.max(t0, u0); t1 = Math.min(t1, u1);
    }
    if (t0 >= t1) continue;
    const y0 = ay + (by - ay) * t0, y1 = ay + (by - ay) * t1;
    if (Math.min(y0, y1) <= f.y1 && Math.max(y0, y1) >= f.y0) return f.type;
  }
  return null;
}

/** Camera basis looking from e at (tx,ty,tz). */
function basis(ex: number, ey: number, ez: number, tx: number, ty: number, tz: number): Basis {
  const dx = tx - ex, dy = ty - ey, dz = tz - ez, hl = Math.hypot(dx, dz) || 1e-6;
  const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, hl);
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
  const f: V3 = [-sy * cp, sp, -cy * cp], r: V3 = [cy, 0, -sy];
  const u: V3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { f, r, u, yaw, pitch };
}

/**
 * Screen rect (NDC, clipped to the frame) + depth of a vertical cylinder seen from e with basis B.
 * Returns null when it is fully behind the lens.
 */
export function cylRect(B: Basis, ex: number, ey: number, ez: number, cx: number, y0: number, cz: number, rad: number, h: number, tanV: number, aspect: number): (Rect4 & { depth: number }) | null {
  let x0 = Infinity, x1 = -Infinity, yy0 = Infinity, yy1 = -Infinity, dMin = Infinity;
  const px = cx - ex, pz = cz - ez, hl = Math.hypot(px, pz) || 1e-6;
  // silhouette edges: ± radius perpendicular to the horizontal line of sight
  const sx = -pz / hl * rad, sz = px / hl * rad;
  for (let k = 0; k < 6; k++) { // 3 silhouette columns (left, right, near) × bottom / top, allocation-free
    const col = k >> 1;
    const ox = col === 0 ? sx : col === 1 ? -sx : -px / hl * rad, oz = col === 0 ? sz : col === 1 ? -sz : -pz / hl * rad;
    {
      const vx = px + ox, vy = (k & 1 ? y0 + h : y0) - ey, vz = pz + oz;
      let d = vx * B.f[0] + vy * B.f[1] + vz * B.f[2];
      dMin = Math.min(dMin, d);
      if (d < 0.05) d = 0.05; // straddling the lens: huge on screen
      const X = (vx * B.r[0] + vy * B.r[1] + vz * B.r[2]) / (d * tanV * aspect);
      const Y = (vx * B.u[0] + vy * B.u[1] + vz * B.u[2]) / (d * tanV);
      x0 = Math.min(x0, X); x1 = Math.max(x1, X); yy0 = Math.min(yy0, Y); yy1 = Math.max(yy1, Y);
    }
  }
  if (dMin < 0.05 && x1 - x0 < 1e-6) return null;
  const depth = px * B.f[0] + pz * B.f[2];
  if (depth <= 0) return null;
  return { x0: Math.max(-1, x0), x1: Math.min(1, x1), y0: Math.max(-1, yy0), y1: Math.min(1, yy1), depth };
}
const area = (r: Rect4 | null | undefined): number => (r && r.x1 > r.x0 && r.y1 > r.y0 ? (r.x1 - r.x0) * (r.y1 - r.y0) : 0);
const inter = (a: Rect4, b: Rect4): Rect4 => ({ x0: Math.max(a.x0, b.x0), x1: Math.min(a.x1, b.x1), y0: Math.max(a.y0, b.y0), y1: Math.min(a.y1, b.y1) });

/**
 * Frame metrics for a camera at e looking at the target: `occ` share of the target's on-screen rect covered by nearer
 * actors, `fg` summed frame share of nearer actors (foreground clutter), `crowd` actors sharing the frame, `who` the
 * worst offender, `tgt` the target's frame share.
 */
export function frameMetrics(a: FollowActor, others: Iterable<FollowActor>, ex: number, ey: number, ez: number, o: FollowOpts = FOLLOW) {
  const ay = a.pos.y ?? 0;
  const B = basis(ex, ey, ez, a.pos.x, ay + o.aimY, a.pos.z);
  const tanV = Math.tan((o.fovDeg * Math.PI) / 360);
  const T = cylRect(B, ex, ey, ez, a.pos.x, ay, a.pos.z, o.target.r, o.target.h, tanV, o.aspect);
  const tA = area(T) || 1e-6;
  // the upper body + face (what reads): a crowd may hide the subject's feet, never its face
  const U = cylRect(B, ex, ey, ez, a.pos.x, ay + o.faceBand[0], a.pos.z, o.target.r, o.faceBand[1] - o.faceBand[0], tanV, o.aspect);
  const uA = area(U) || 1e-6;
  let occFace = 0, occ = 0, fg = 0, crowd = 0, who: string | null = null, worst = 0;
  for (const b of others) {
    if (!b?.pos || b === a || b.id === a.id || b.hidden) continue;
    if (Math.hypot(b.pos.x - ex, b.pos.z - ez) > 12) continue;
    COST.actors++;
    const R = cylRect(B, ex, ey, ez, b.pos.x, b.pos.y ?? 0, b.pos.z, o.other.r, o.other.h, tanV, o.aspect);
    if (!R) continue;
    const bA = area(R) / 4; // frame is 2×2 in NDC
    if (bA <= 0) continue;
    crowd++;
    if (R.depth >= (T?.depth ?? 0) - 0.15) continue; // behind / beside the subject: shares the frame, doesn't cover it
    const c = T ? area(inter(R, T)) / tA : 0;
    occ = Math.max(occ, c);
    if (U) occFace = Math.max(occFace, area(inter(R, U)) / uA);
    fg += bA;
    const bad = c * 2 + bA;
    if (bad > worst) { worst = bad; who = b.id; }
  }
  return { occ: Math.min(1, occ), occFace: Math.min(1, occFace), fg, crowd, who, tgt: area(T) / 4, yaw: B.yaw, pitch: B.pitch };
}

export interface ScoreQuery {
  a: FollowActor;
  others: Iterable<FollowActor>;
  W: FollowWorld;
  nav?: FollowNav | null;
  level: number;
  cur?: Cand | null;
  faceYaw?: number;
  o?: FollowOpts;
  slices?: number;
}
interface ScoreTarget { id: string; yaw?: number; pos: { x: number; y: number; z: number } }
interface ScoreOther { id: string; pos: { x: number; y: number; z: number } }
/** Everything one evaluation reads, snapshotted at `scoreBegin` so every slice scores the same frame. */
export interface ScoreEnv {
  a: ScoreTarget; ay: number; others: ScoreOther[]; W: FollowWorld; nav?: FollowNav | null; level: number; L: Layout | null | undefined;
  fx: number; fz: number; o: FollowOpts; cur?: Cand | null; zone: string | null;
}
export interface ScoreJob { e: ScoreEnv; cand: Cand[]; out: ScoredSpot[]; i: number; slice: number; slices: number; perSlice: number; done: boolean; list: ScoredSpot[] | null }

/**
 * Start an incremental evaluation (m2 fix r2: the ≈ 0.6–1.2 ms pass is spread over `o.evalSlices` frames instead of
 * landing as one spike every `evalEvery`). The target pose is snapshotted so every slice scores the same frame.
 * Advance with `scoreStep(job)`; `job.done` / `job.list` (best-first) once finished.
 */
export function scoreBegin(q: ScoreQuery): ScoreJob {
  const o = q.o ?? FOLLOW, { W, nav, level } = q;
  const a: ScoreTarget = { id: q.a.id, yaw: q.a.yaw, pos: { x: q.a.pos.x, y: q.a.pos.y ?? 0, z: q.a.pos.z } };
  const others: ScoreOther[] = [];
  for (const b of q.others) {
    if (!b?.pos || b === q.a || b.id === a.id || b.hidden) continue;
    others.push({ id: b.id, pos: { x: b.pos.x, y: b.pos.y ?? 0, z: b.pos.z } });
  }
  const ay = a.pos.y;
  const L = W.L;
  const fy = q.faceYaw ?? a.yaw ?? 0;
  const fx = -Math.sin(fy), fz = -Math.cos(fy);
  const cand: Cand[] = [];
  if (q.cur) cand.push({ ...q.cur, kept: true });
  for (let k = 0; k < o.bearings; k++) {
    const th = (k / o.bearings) * Math.PI * 2;
    for (const r of o.dists) for (const h of o.heights) cand.push({ th, r, h });
  }
  const zone = L?.zoneAt ? L.zoneAt(a.pos.x, a.pos.z, level) : null;
  const e: ScoreEnv = { a, ay, others, W, nav, level, L, fx, fz, o, cur: q.cur, zone };
  const slices = Math.max(1, Math.round(q.slices ?? o.evalSlices ?? 1));
  // the last slice also runs the clutter probe (≈ a third of the work), so it scores a smaller share of the spots
  const perSlice = slices === 1 ? cand.length : Math.ceil(cand.length / (slices - 0.5));
  return { e, cand, out: [], i: 0, slice: 0, slices, perSlice, done: false, list: null };
}

/** Run one slice of an evaluation job; returns true once the job is done (then `job.list` is best-first). */
export function scoreStep(job: ScoreJob): boolean {
  if (job.done) return true;
  const { e, cand, out } = job;
  const last = job.slice >= job.slices - 1;
  const end = last ? cand.length : Math.min(cand.length, job.i + job.perSlice);
  for (; job.i < end; job.i++) out.push(scoreSpot(cand[job.i], e));
  job.slice++;
  if (job.i < cand.length) return false;
  out.sort((x, y) => y.score - x.score);
  // the foreground-clutter probe (10 short rays) only for the front runners + the kept spot: keeps an evaluation ≈ 1 ms
  for (let i = 0; i < out.length; i++) if ((i < e.o.clutterTop || out[i].kept) && out[i].score > -1e8) addClutter(out[i], e);
  out.sort((x, y) => y.score - x.score);
  job.done = true; job.list = out;
  return true;
}

/** Score every candidate spot around the target in one go; returns the list best-first. */
export function scoreSpots(q: ScoreQuery): ScoredSpot[] {
  const job = scoreBegin({ ...q, slices: 1 });
  scoreStep(job);
  return job.list ?? job.out; // a one-slice job is always done here
}

/** Score one polar spot {th, r, h} (th: world bearing target → camera, 0 = +z). */
export function scoreSpot(c: Cand, e: ScoreEnv): ScoredSpot {
  const { a, ay, others, W, nav, level, L, fx, fz, o } = e;
  const x = a.pos.x + Math.sin(c.th) * c.r, z = a.pos.z + Math.cos(c.th) * c.r;
  const res: ScoredSpot = { ...c, x, z, y: ay + c.h, score: -1e9, why: null };
  COST.spots++;
  if (L?.zoneAt && !L.zoneAt(x, z, level)) { res.why = 'outside'; return res; }
  if (nav && (!nav.walkable(x, z, level, { owner: '*' }) || nav.collides(x, z, o.wallGap, level))) { res.why = 'nav'; return res; }
  const floor = L?.floorY ? L.floorY(x, z, level) : ay;
  let ey = ay + c.h;
  if (ey < floor + 0.9) ey = floor + 0.9;
  const zid = L?.zoneAt?.(x, z, level);
  const zn = zid ? W.zones.get(`${level}:${zid}`) : undefined;
  if (zn && ey > (zn.ceil ?? NaN) - o.ceilGap) { res.why = 'ceiling'; return res; }
  res.y = ey;
  // world sightlines: face-ish and body
  const acc = { glass: 0, jamb: 0 };
  const faceB = worldBlocked(W, level, x, ey, z, a.pos.x, ay + 0.85, a.pos.z, o.near, acc);
  const bodyB = worldBlocked(W, level, x, ey, z, a.pos.x, ay + 0.45, a.pos.z, o.near);
  const m = frameMetrics(a, others, x, ey, z, o);
  // how squarely the face looks at the lens (prefer a 3/4 front view)
  const cf = (Math.sin(c.th) * fx + Math.cos(c.th) * fz);
  const w = o.w;
  let s = 1000;
  if (faceB) s -= w.wallFace;
  // furniture hiding the lower body is how a desk worker looks from the front (monitor, desk edge); a wall is not
  if (bodyB) s -= bodyB === 'wall' || bodyB === 'ceiling' ? w.wallBody : w.furnBody;
  s -= w.occ * m.occFace + w.occBody * m.occ + w.fg * m.fg;
  s -= w.facing * Math.abs(cf - 0.7) + (cf < 0 ? w.back * -cf : 0);
  s -= w.height * (c.h - o.heights[0]);
  s -= w.dist * Math.abs(c.r - o.bestDist);
  s -= w.crowd * Math.max(0, m.crowd - 1);
  // same room reads best: a view through the E-bay glass shows mullions, reflections and the subject's back
  s -= w.glass * acc.glass + w.jamb * acc.jamb;
  if (e.zone && L?.zoneAt && L.zoneAt(x, z, level) !== e.zone) s -= w.otherRoom;
  if (e.cur) s -= w.turn * Math.abs(wrap(c.th - e.cur.th)) + 8 * Math.abs(c.h - e.cur.h);
  res.score = s;
  res.clear = !faceB && m.occFace < 0.05 && m.occ < 0.35 && m.fg < 0.06 && !acc.jamb;
  res.glass = acc.glass; res.cf = +cf.toFixed(2);
  res.yaw = m.yaw; res.pitch = m.pitch;
  res.faceB = faceB || null;
  res.occ = +m.occFace.toFixed(3); res.occBody = +m.occ.toFixed(3); res.fg = +m.fg.toFixed(3); res.who = m.who; res.wall = faceB || bodyB || null;
  return res;
}

/**
 * Foreground clutter: a door jamb / pillar / plant right in front of the lens misses both sightlines yet slices the
 * frame (review: the follow cam parked against the E-bay door frame). Lowers the score; > 2 rays → not `clear`.
 */
function addClutter(r: ScoredSpot, e: ScoreEnv) {
  const { a, W, level, o } = e;
  let clutter = 0;
  const reach = Math.min(o.clutterReach, Math.hypot(a.pos.x - r.x, a.pos.z - r.z) - 0.45);
  if (reach > 0.2) {
    for (const [h, v] of FG_RAYS) {
      const yy = (r.yaw ?? 0) + h, pp = (r.pitch ?? 0) + v, cp = Math.cos(pp); // a scored spot always has both
      if (worldBlocked(W, level, r.x, r.y, r.z, r.x - Math.sin(yy) * cp * reach, r.y + Math.sin(pp) * reach, r.z - Math.cos(yy) * cp * reach)) clutter++;
    }
  }
  r.clutter = clutter;
  r.score -= o.w.clutter * clutter;
  if (clutter > 2) r.clear = false;
}

/** Furniture this tall counts as a wall for the lens clearance (bookcases, lockers, pillars, partitions). */
const TALL = 1.5;
/** Horizontal distance from (x, z) to the point `c` m along wall w's centreline. */
const wallPt = (w: FollowWall, c: number, x: number, z: number) => Math.hypot(x - (w.a[0] + (w.dx * c) / (w.len || 1)), z - (w.a[1] + (w.dz * c) / (w.len || 1)));

/**
 * Clearance of a lens at (x, y, z): the distance to the nearest solid wall surface (openings the height y passes
 * through don't count; walls are `t` thick) or the side of tall (≥ 1.5 m) furniture covering y, capped at `reach`. PLY m3 fix r3.
 */
export function lensClearance(W: FollowWorld, level: number, x: number, y: number, z: number, reach = 1): number {
  let best = reach;
  for (const w of W.walls) {
    if ((w.level ?? 0) !== level && w.kind !== 'lintel') continue;
    const ht = (w.t ?? 0.2) / 2;
    if (x < w.x0 - best - ht || x > w.x1 + best + ht || z < w.z0 - best - ht || z > w.z1 + best + ht) continue;
    const yy = y - (w.y0 ?? 0);
    const dy = yy < 0 ? -yy : yy > w.h ? yy - w.h : 0;
    if (dy >= best) continue;
    COST.walls++;
    const along = w.len > 0 ? Math.max(0, Math.min(w.len, ((x - w.a[0]) * w.dx + (z - w.a[1]) * w.dz) / w.len)) : 0;
    // nearest solid point at this height: `along` itself, or the edges of the (merged) openings y passes through there
    let lo = along, hi = along, moved = true, open = false;
    const ops = w.openings;
    for (let it = 0; moved && it < 8; it++) {
      moved = false;
      for (const o of ops) {
        if (yy < o.sill || yy > o.sill + o.h) continue;
        if (o.at <= lo && lo < o.at + o.w && o.at < lo) { lo = o.at; moved = open = true; }
        if (o.at < hi && hi <= o.at + o.w && o.at + o.w > hi) { hi = o.at + o.w; moved = open = true; }
        if (o.at <= along && along <= o.at + o.w) open = true;
      }
    }
    let near = Infinity;
    if (!open) near = wallPt(w, along, x, z);
    else {
      if (lo > 1e-6) near = Math.min(near, wallPt(w, lo, x, z));
      if (hi < w.len - 1e-6) near = Math.min(near, wallPt(w, hi, x, z));
    }
    if (!Number.isFinite(near)) continue;
    const d = Math.hypot(Math.max(0, near - ht), dy);
    if (d < best) best = d;
  }
  for (const f of W.furn) {
    if (f.y1 - f.y0 < TALL) continue; // desks, monitors, chairs: a lens beside them is fine; a bookcase / pillar is a wall
    if (f.y1 < y - best || f.y0 > y + best) continue;
    if (Math.abs(f.x - x) > f.R + best || Math.abs(f.z - z) > f.R + best) continue;
    COST.boxes++;
    const rx = x - f.x, rz = z - f.z;
    const lx = rx * f.c - rz * f.s, lz = rx * f.s + rz * f.c;
    const dx = Math.max(0, Math.abs(lx) - f.hw), dz = Math.max(0, Math.abs(lz) - f.hd);
    const dy = y < f.y0 ? f.y0 - y : y > f.y1 ? y - f.y1 : 0;
    const d = Math.hypot(dx, dz, dy);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Camera boom (PLY m3 fix r3): sweep from the pivot (the subject's face) out toward the lens spot (x, y, z) in
 * `o.boomStep` steps from `o.boomMin`; → the farthest horizontal boom length whose whole sweep keeps `o.boomGap`
 * clearance (a wall crossed on the way always fails it), or `-1` when even `o.boomMin` is cramped (a doorway jamb
 * beside the subject). `r` = the horizontal pivot → spot distance.
 */
export function boomSweep(W: FollowWorld, level: number, px: number, py: number, pz: number, x: number, y: number, z: number, r: number, o: FollowOpts = FOLLOW): number {
  if (r <= o.boomMin) return lensClearance(W, level, x, y, z, o.boomGap) < o.boomGap ? -1 : r;
  let hard = -1;
  const n = Math.max(1, Math.ceil((r - o.boomMin) / o.boomStep));
  for (let i = 0; i <= n; i++) {
    const s = o.boomMin + ((r - o.boomMin) * i) / n, t = s / r;
    if (lensClearance(W, level, px + (x - px) * t, py + (y - py) * t, pz + (z - pz) * t, o.boomGap) < o.boomGap) break;
    hard = s;
  }
  return hard;
}

/**
 * Is the subject's face hidden from the lens at (x, y, z)? Face centre (o.pivotY) and head top (+0.25) both blocked by
 * walls / tall furniture (the go-there check, goThere.ts faceHidden).
 */
export function faceHiddenFrom(W: FollowWorld, level: number, x: number, y: number, z: number, a: Pick<FollowActor, 'pos'>, o: FollowOpts = FOLLOW): boolean {
  const ay = a.pos.y ?? 0;
  if (!worldBlocked(W, level, x, y, z, a.pos.x, ay + o.pivotY, a.pos.z, o.near)) return false;
  return !!worldBlocked(W, level, x, y, z, a.pos.x, ay + o.pivotY + 0.25, a.pos.z, o.near);
}

export interface FollowRigDeps {
  nav?: () => FollowNav | null | undefined;
  layout: () => Layout | null | undefined;
  others: () => Iterable<FollowActor>;
  levelOf?: (a: FollowActor) => number;
  faceYaw?: (a: FollowActor) => number;
  o?: FollowOpts;
}
/** The follow camera's eye pose. */
export interface EyePose { x: number; y: number; z: number; yaw: number; pitch: number }
export type FollowRig = ReturnType<typeof createFollowRig>;

/** Stateful follow rig: `start(actor, eye)`, `step(dt) → {x, y, z, yaw, pitch}` (eye pose), `nudge(dYaw)`. */
export function createFollowRig(d: FollowRigDeps) {
  const o = d.o ?? FOLLOW;
  let W: FollowWorld | null = null, WL: Layout | null | undefined = null;
  let a: FollowActor | null = null, cur: Cand | null = null, goal: Cand | null = null, evalT = 0, userT = 0, yaw = 0, pitch = 0, last: ScoredSpot | null = null, job: ScoreJob | null = null;
  // `a` / `cur` are set by `start(actor)` before any of the helpers below run (`step` returns early without a target).
  const tgt = (): FollowActor => { if (!a) throw new Error('followRig: no target'); return a; };
  const orbit = (): Cand => { if (!cur) throw new Error('followRig: no orbit'); return cur; };
  // PLY m3 fix r3: boom (lim: eased boom length, null → snap), cuts, face-occlusion watch, subject velocity
  let lim: number | null = null, holdT = 0, arcT = 0, cutT = 0, losT = 0, hidT = 0, reseatT = 0, snapLook = false, boomR = 0, cramped = false;
  let vx = 0, vz = 0, px0 = NaN, pz0 = NaN;
  const count = { cuts: 0, reseats: 0 };
  const boomArc = new Float64Array(Math.round((2 * Math.PI) / o.boomTurn));
  const levelOf = () => (d.levelOf ? d.levelOf(tgt()) : 0);
  // per-frame scoring cost (diagnostics: `__hq.stats().player.follow` / followProbe): worst slice + last full pass, ms
  const now = () => globalThis.performance?.now?.() ?? 0;
  const perf = { sliceMax: 0, evalMs: 0, acc: 0, evals: 0, slices: 0, sum: 0, over1: 0 };
  const world = (): FollowWorld => {
    const L = d.layout();
    if (!W || L !== WL) { WL = L; W = followWorld(L); }
    return W;
  };
  let slicesOverride: number | null = null; // diagnostics A/B (followProbe {slices}); null → o.evalSlices
  const query = (slices: number | undefined = slicesOverride ?? undefined): ScoreQuery => {
    const a = tgt();
    return { a, others: d.others(), W: world(), nav: d.nav?.(), level: d.levelOf ? d.levelOf(a) : 0, cur: goal, faceYaw: d.faceYaw?.(a), o, slices };
  };
  /** Apply a finished evaluation: switch spots only with hysteresis (or when the kept one lost its clear view). */
  function pick(list: ScoredSpot[]) {
    const best = list[0];
    const kept = list.find((s) => s.kept);
    if (!goal || !kept || kept.score < -1e8 || !kept.clear && best.clear || best.score > kept.score + o.switchMargin) {
      if (best && best.score > -1e8) goal = { th: best.th, r: best.r, h: best.h };
      last = best;
    } else last = kept;
  }
  /** Whole evaluation now (follow start: the first goal can't wait for a sliced pass). */
  function evaluateNow() { job = null; const j = scoreBegin(query(1)); scoreStep(j); pick(j.list ?? j.out); }
  /** Jump the orbit straight onto the goal (no polar swing through what hid the subject). */
  function cutTo(g: Cand) { cur = { th: g.th, r: g.r, h: g.h }; goal = { th: g.th, r: g.r, h: g.h }; lim = null; snapLook = true; }
  /** Would the polar swing cur → goal fold the boom (shorter than o.swingMin somewhere on the way)? */
  function swingBlocked(goal: Cand) {
    const a = tgt(), cur = orbit();
    const d = wrap(goal.th - cur.th);
    if (Math.abs(d) < 0.3 && Math.abs(goal.r - cur.r) < 0.5) return false;
    const W0 = world(), level = levelOf(), ay = a.pos.y ?? 0, py = ay + o.pivotY;
    for (let i = 1; i <= 4; i++) {
      const t = i / 4, th = cur.th + d * t, r = cur.r + (goal.r - cur.r) * t, h = cur.h + (goal.h - cur.h) * t;
      const b = boomSweep(W0, level, a.pos.x, py, a.pos.z, a.pos.x + Math.sin(th) * r, ay + h, a.pos.z + Math.cos(th) * r, r, o);
      if (b < Math.min(r, o.swingMin)) return true;
    }
    return false;
  }
  /** Cramped boom (a jamb beside the subject): a fresh pick, cut straight to it. */
  function cut() { evaluateNow(); if (goal) cutTo(goal); cutT = o.cutCooldown; count.cuts++; }
  /**
   * The face stayed hidden (walls / tall furniture) ≥ o.losHold: re-seat on the best spot that sees it; none → over the
   * shoulder (behind its heading), then up and back. Cut, no swing. → true when it moved.
   */
  function reseat() {
    const a = tgt(), cur = orbit();
    job = null;
    const j = scoreBegin(query(1));
    scoreStep(j);
    let s = (j.list ?? j.out).find((q) => q.score > -1e8 && !q.faceB) ?? null;
    if (!s) {
      const mv = Math.hypot(vx, vz) > 0.3;
      const back = mv ? Math.atan2(-vx, -vz) : d.faceYaw?.(a) ?? a.yaw ?? 0;
      const tries = [...o.shoulder.map((q) => ({ th: back, r: q.r, h: q.h })), { th: cur.th, r: cur.r + 0.6, h: cur.h + 0.8 }];
      for (const c of tries) { const q = scoreSpot(c, j.e); if (q.score > -1e8 && !q.faceB) { s = q; break; } }
    }
    reseatT = o.reseatCooldown;
    if (!s) return false;
    last = s;
    cutTo(s);
    count.reseats++;
    return true;
  }
  /** Lens point for the current orbit: boom-clipped (never within o.boomGap of a wall), under the zone ceiling. */
  function place(dt: number) {
    const a = tgt(), cur = orbit();
    const W0 = world(), level = levelOf();
    const ay = a.pos.y ?? 0, ax = a.pos.x, az = a.pos.z, py = ay + o.pivotY;
    const R = Math.max(1e-3, cur.r), y0 = ay + cur.h;
    const sweep = (th: number) => boomSweep(W0, level, ax, py, az, ax + Math.sin(th) * R, y0, az + Math.cos(th) * R, R, o);
    let b = sweep(cur.th);
    if (b < 0 && arcT <= 0) {
      // the boom is cramped even at boomMin (a jamb beside the subject: it walks through a doorway) — cut it into the
      // middle of the nearest arc of bearings with room (along the doorway: behind / ahead of it) and hold it there a
      // beat, rather than re-snapping every few steps or approaching straight back into the jamb
      const N = Math.round((2 * Math.PI) / o.boomTurn);
      for (let k = 0; k < N; k++) boomArc[k] = sweep(wrap(cur.th + k * o.boomTurn));
      let near = -1;
      for (let k = 1; k <= N >> 1 && near < 0; k++) { if (boomArc[k % N] >= 0) near = k % N; else if (boomArc[(N - k) % N] >= 0) near = (N - k) % N; }
      if (near >= 0) {
        let lo = near, hi = near;
        while (boomArc[(lo - 1 + N) % N] >= 0 && (lo - 1 + N) % N !== hi) lo = (lo - 1 + N) % N;
        while (boomArc[(hi + 1) % N] >= 0 && (hi + 1) % N !== lo) hi = (hi + 1) % N;
        const span = (hi - lo + N) % N, mid = (lo + Math.floor(span / 2)) % N;
        cur.th = wrap(cur.th + mid * o.boomTurn); b = boomArc[mid]; lim = null; snapLook = true; holdT = o.boomHold;
      } else arcT = 0.3; // nowhere roomier (a nook): keep the short boom, look again in a moment
    }
    cramped = b < 0;
    const hard = cramped ? Math.min(R, o.boomMin) : b;
    // look ahead (where the subject will be in o.boomLead s): the boom starts pulling in before the jamb reaches it
    let want = hard;
    if (!cramped && Math.hypot(vx, vz) > 0.2) {
      const fx = ax + vx * o.boomLead, fz = az + vz * o.boomLead;
      const bf = boomSweep(W0, level, fx, py, fz, fx + Math.sin(cur.th) * R, y0, fz + Math.cos(cur.th) * R, R, o);
      if (bf >= 0) want = Math.min(want, bf);
    }
    // ease in toward the look-ahead limit (fast) or out (slow); the current limit is hard (never within boomGap)
    if (lim == null || dt <= 0) lim = want;
    else lim += (want - lim) * (1 - Math.exp(-dt * (want < lim ? o.boomIn : o.boomOut)));
    const r = Math.min(R, lim, hard);
    const x0 = ax + Math.sin(cur.th) * R, z0 = az + Math.cos(cur.th) * R;
    boomR = r;
    const t = r / R;
    const x = ax + (x0 - ax) * t, z = az + (z0 - az) * t;
    let y = py + (y0 - py) * t;
    const L = W0.L;
    const zid = L?.zoneAt?.(x, z, level), zn = zid ? W0.zones.get(`${level}:${zid}`) : undefined;
    if (zn && y > (zn.ceil ?? NaN) - o.ceilGap) y = Math.max(py, (zn.ceil ?? NaN) - o.ceilGap);
    return { x, y, z };
  }
  return {
    get target() { return a; },
    /** Top-n scored spots right now (framing diagnostics). */
    debug(n = 8) {
      if (!a) return null;
      return scoreSpots(query(1))
        .slice(0, n).map((r) => ({ th: +r.th.toFixed(2), r: r.r, h: r.h, s: +r.score.toFixed(1), clear: r.clear, occ: r.occ, fg: r.fg, cl: r.clutter, gl: r.glass, cf: r.cf, wall: r.wall, why: r.why, kept: !!r.kept }));
    },
    get info() { return last ? { th: +last.th.toFixed(2), r: last.r, h: last.h, clear: !!last.clear, occ: last.occ, fg: last.fg, clutter: last.clutter, who: last.who, wall: last.wall, score: +last.score.toFixed(1),
      boom: +boomR.toFixed(2), cramped, cuts: count.cuts, reseats: count.reseats } : null; },
    start(actor: FollowActor | null, eye?: { x: number; y: number; z: number; yaw?: number; pitch?: number }) {
      a = actor;
      lim = null; holdT = 0; arcT = 0; cutT = 0; losT = 0; hidT = 0; reseatT = 0; vx = vz = 0; px0 = pz0 = NaN; count.cuts = count.reseats = 0;
      if (!a || !eye) { cur = goal = last = job = null; return; }
      const dx = eye.x - a.pos.x, dz = eye.z - a.pos.z;
      // start from where the eye is (no jump), then approach the chosen spot around the subject
      const r = Math.max(o.dists[1] * 0.8, Math.hypot(dx, dz));
      cur = { th: Math.atan2(dx, dz), r, h: Math.max(0.9, Math.min(o.heights[2] + 1, eye.y - (a.pos.y ?? 0))) };
      goal = null; evalT = 0; userT = 0;
      yaw = eye.yaw ?? 0; pitch = eye.pitch ?? 0;
      evaluateNow();
    },
    nudge(dYaw: number) { if (!cur) return; cur.th = wrap(cur.th - dYaw); if (goal) goal.th = cur.th; userT = o.userHold; job = null; },
    /** Scoring cost so far: {sliceMax, sliceAvg, over1ms, slices, evalMs (last full pass), evals} (ms; `resetPerf`). */
    get perf() {
      return { sliceMax: +perf.sliceMax.toFixed(3), sliceAvg: +(perf.sum / (perf.slices || 1)).toFixed(3), over1ms: perf.over1,
        slices: perf.slices, evalMs: +perf.evalMs.toFixed(3), evals: perf.evals };
    },
    set slices(n: number | null | undefined) { slicesOverride = n == null ? null : Math.max(1, n | 0); },
    resetPerf() { perf.sliceMax = 0; perf.evals = 0; perf.slices = 0; perf.sum = 0; perf.over1 = 0; },
    /** In-flight evaluation slices (diagnostics / tests): {slice, slices} or null. */
    get pending() { return job ? { slice: job.slice, slices: job.slices } : null; },
    step(dt: number): EyePose | null {
      if (!a) return null;
      userT = Math.max(0, userT - dt);
      evalT -= dt;
      // a re-evaluation runs a slice per frame (a few bearings each, clutter + pick on the last), never one spike
      if (!job && evalT <= 0 && userT <= 0 && holdT <= 0) { evalT = o.evalEvery; job = scoreBegin(query()); }
      if (job) {
        const t0 = now();
        const done = scoreStep(job);
        const ms = now() - t0;
        perf.sliceMax = Math.max(perf.sliceMax, ms); perf.acc += ms; perf.slices++; perf.sum += ms; if (ms > 1) perf.over1++;
        if (done) {
          const j = job, g0 = goal;
          job = null; pick(j.list ?? j.out); perf.evalMs = perf.acc; perf.acc = 0; perf.evals++;
          // a new spot the polar swing can't reach without the boom folding against a wall (it's through a doorway,
          // round a jamb): cut to it instead of swinging through the wall
          if (goal && goal !== g0 && swingBlocked(goal)) { cutTo(goal); count.cuts++; }
        }
      }
      holdT = Math.max(0, holdT - dt);
      if (goal && userT <= 0 && holdT <= 0 && cur) {
        const k = 1 - Math.exp(-dt * o.approach);
        cur.th = wrap(cur.th + wrap(goal.th - cur.th) * k);
        cur.r += (goal.r - cur.r) * k; cur.h += (goal.h - cur.h) * k;
      }
      // subject velocity (over-the-shoulder re-seat)
      if (dt > 0 && Number.isFinite(px0)) { const kv = 1 - Math.exp(-dt * 4); vx += ((a.pos.x - px0) / dt - vx) * kv; vz += ((a.pos.z - pz0) / dt - vz) * kv; }
      px0 = a.pos.x; pz0 = a.pos.z;
      arcT = Math.max(0, arcT - dt); cutT = Math.max(0, cutT - dt); reseatT = Math.max(0, reseatT - dt);
      let e = place(dt);
      if (cramped && cutT <= 0) { cut(); e = place(0); }
      // face occlusion (the go-there check, o.losEvery): hidden ≥ o.losHold → re-seat
      losT += dt;
      if (losT >= o.losEvery) {
        const el = losT;
        losT = 0;
        if (userT <= 0 && faceHiddenFrom(world(), levelOf(), e.x, e.y, e.z, a, o)) {
          hidT += el;
          if (hidT >= o.losHold && reseatT <= 0) { hidT = 0; if (reseat()) e = place(0); }
        } else hidT = 0;
      }
      const { x, y, z } = e;
      const ay = a.pos.y ?? 0;
      const dx = a.pos.x - x, dz = a.pos.z - z;
      const tYaw = Math.atan2(-dx, -dz), tPitch = Math.atan2(ay + o.aimY - y, Math.hypot(dx, dz) || 1e-3);
      const kl = dt > 0 && !snapLook ? 1 - Math.exp(-dt * o.look) : 1;
      snapLook = false;
      yaw = wrap(yaw + wrap(tYaw - yaw) * kl); pitch += (tPitch - pitch) * kl;
      return { x, y, z, yaw, pitch };
    },
  };
}
