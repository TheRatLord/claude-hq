// @pure
/**
 * Monitor dive (PLY, M2 UI/PLY row, RND #2): E on an agent working at its desk glides the camera over its shoulder
 * into its monitor in ~0.6 s (FOV narrows), then the UI opens the terminal drawer from the screen's on-screen rect
 * (`openTerminal(id, {fromRect})`); Esc pulls back out to the exact pre-dive pose.
 * This file is the math: the screen descriptor from an instance matrix, the end pose that fills the frame with the
 * screen, and the eased track (cubic Bézier over the shoulder, look blended onto the screen, FOV dolly).
 * No three.js (node-testable).
 * Owner: PLY.
 */
import { createCamPath } from './path.ts';
import type { CamPath, P3 } from './path.ts';
import type { Widen } from './follow.ts';

export const DIVE = Object.freeze({
  dur: 0.6,            // s, in
  outDur: 0.42,        // s, back out
  fovEnd: 34,          // deg: the lens narrows as it closes in (the narrowest; widened when the sitter is close, below)
  fovMax: 62,          // deg: the widest end lens (a sitter hugging its screen; a narrow drawer strip goes to fovHoldMax)
  fovHoldMax: 80,      // deg: while the drawer is docked (the world strip may be < 1:1)
  fill: 0.8,           // share of the frame (the tighter of width / height) the screen fills at the end
  holdFill: 0.92,      // … and while held beside the docked drawer (the strip is narrow: use it)
  aspect: 16 / 9,      // for the end distance (the strip is usually wider; height then governs)
  minD: 0.16,          // m: never closer to the glass than this (near plane 0.05, bezel)
  // m3 fix r1 (reviewer [fun]: the dive ended inside the Clawd): the seated sitter's body as a vertical capsule the
  // lens must stay out of — the 0.72 × 0.46 body box turned any way (half-diagonal 0.43; its face turns toward the
  // player; the 0.43 half-diagonal only at the back corners) + the near plane — and a thin one for the hat. The end pose stops short of it and widens the lens instead.
  bodyR: 0.4, hatR: 0.2, lensGap: 0.06, bodyTop: 0.98, hatTop: 1.24, seatY: 0.25,
  shoulderUp: 0.4,     // m above the seated head top the path passes
  shoulderSide: 0.5,   // m to the side of the body centre (the side the camera comes from; body half-width 0.36)
  shoulderBack: 0.1,   // m behind the body centre (away from the screen)
  headTop: 0.95,       // m above the actor's feet: top of a seated Clawd (0.32 seat + 0.54 body) with a hat
  lookIn: 0.55,        // share of the track over which the look turns onto the screen
  drop: 0.3,           // m above the hat tip the last stretch drops from, in front of the face
  approach: 0.0,       // m the drop point sits in front of the end pose (along the screen normal, toward the sitter)
  dwell: 0.2,          // s held on the full screen before the drawer opens from it (the payoff frame)
  pad: 0.03,           // m clearance margin the track check adds to the capsules / desk box
});

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** Sine ease in-out (peak speed π/2 × mean: no lurch at either end). */
export const easeInOut = (t: number): number => 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, t)));
const smooth = (e0: number, e1: number, x: number) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

export type DiveOpts = Widen<typeof DIVE>;
/** A monitor screen: centre, unit normal (toward the viewer), unit up, size (m). */
export interface Screen { x: number; y: number; z: number; nx: number; ny: number; nz: number; ux: number; uy: number; uz: number; w: number; h: number }
/** eye pose */
export interface CamPose { x: number; y: number; z: number; yaw: number; pitch: number; fov: number }
/** The sitter's position (feet). */
export interface Sitter { x: number; y?: number; z: number }
/** The sitter's desk as an oriented box (rotation.y = yaw): `c`/`s` = cos/sin of the yaw, `hw`/`hd` half extents. */
export interface DeskBox { x: number; z: number; c: number; s: number; hw: number; hd: number; y0: number; y1: number }

/**
 * Screen descriptor from a column-major 4×4 instance world matrix (three.js `elements`) of a PlaneGeometry(w, h)
 * (plane in local xy, facing local +z).
 */
export function screenFromMatrix(e: ArrayLike<number>, w: number, h: number): Screen {
  const sx = Math.hypot(e[0], e[1], e[2]) || 1, sy = Math.hypot(e[4], e[5], e[6]) || 1, sz = Math.hypot(e[8], e[9], e[10]) || 1;
  return { x: e[12], y: e[13], z: e[14], nx: e[8] / sz, ny: e[9] / sz, nz: e[10] / sz, ux: e[4] / sy, uy: e[5] / sy, uz: e[6] / sy, w: w * sx, h: h * sy };
}

/** Yaw / pitch (controller convention: forward = (−sin yaw·cos p, sin p, −cos yaw·cos p)) of direction (dx, dy, dz). */
export function lookOf(dx: number, dy: number, dz: number): { yaw: number; pitch: number } {
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz) || 1e-9) };
}

/**
 * The largest distance along the screen normal at which the lens still stays out of the sitter's body capsule
 * (horizontal radius bodyR + lensGap around its feet position), or Infinity when the normal misses it.
 */
export function clearDist(s: Screen, a: { x: number; z: number } | null | undefined, O: DiveOpts = DIVE): number {
  if (!a) return Infinity;
  const R = O.bodyR + O.lensGap + O.pad;
  const vx = s.x - a.x, vz = s.z - a.z;
  const A = s.nx * s.nx + s.nz * s.nz, B = 2 * (vx * s.nx + vz * s.nz), C = vx * vx + vz * vz - R * R;
  if (A < 1e-9) return Infinity;
  if (C <= 0) return 0; // the screen itself is inside the capsule
  const disc = B * B - 4 * A * C;
  if (disc < 0) return Infinity;
  const d1 = (-B - Math.sqrt(disc)) / (2 * A);
  return d1 < 0 ? Infinity : d1;
}

/** Vertical FOV (deg) at which a w × h screen at distance d fills `fill` of a frame of `aspect`. */
export const fovToFill = (s: Screen, d: number, fill: number, aspect: number): number => (360 / Math.PI) * Math.atan(Math.max((s.h / 2) / (fill * d), (s.w / 2) / (fill * d * aspect)));

/**
 * End pose: on the screen normal, far enough that the screen fills `fill` of the frame at `fovEnd` — unless that is
 * inside the sitter (`a`, feet position): then it stops at the capsule and widens the lens (≤ fovMax) to fill.
 */
export function diveEnd(s: Screen, o: Partial<DiveOpts> = {}, a: Sitter | null = null): CamPose & { d: number; dMax: number } {
  const O = { ...DIVE, ...o };
  const tv = Math.tan((O.fovEnd * Math.PI) / 360);
  const dFill = Math.max(O.minD, (s.h / 2) / (O.fill * tv), (s.w / 2) / (O.fill * tv * O.aspect));
  const dMax = Math.max(O.minD, clearDist(s, a, O));
  const d = Math.min(dFill, dMax);
  const fov = Math.min(O.fovMax, Math.max(O.fovEnd, fovToFill(s, d, O.fill, O.aspect)));
  const x = s.x + s.nx * d, y = s.y + s.ny * d, z = s.z + s.nz * d;
  const l = lookOf(-s.nx, -s.ny, -s.nz);
  return { x, y, z, yaw: l.yaw, pitch: l.pitch, fov, d, dMax };
}

/**
 * Smallest clearance (m; < 0 = inside) of point p to the sitter's body / hat capsules and the desk box (both padded
 * by the lens gap). `desk` = the oriented desk box or null.
 */
export function clearance(p: P3, a: Sitter | null, desk: DeskBox | null, O: DiveOpts = DIVE): number {
  let m = Infinity;
  if (a) {
    const ay = a.y ?? 0, r = Math.hypot(p.x - a.x, p.z - a.z);
    if (p.y > ay + O.seatY && p.y < ay + O.bodyTop + O.lensGap) m = Math.min(m, r - (O.bodyR + O.lensGap));
    else if (p.y > ay + O.seatY && p.y < ay + O.hatTop + O.lensGap) m = Math.min(m, r - (O.hatR + O.lensGap));
  }
  if (desk) {
    const rx = p.x - desk.x, rz = p.z - desk.z;
    const lx = rx * desk.c - rz * desk.s, lz = rx * desk.s + rz * desk.c;
    const ox = Math.abs(lx) - desk.hw, oz = Math.abs(lz) - desk.hd, oy = Math.max(desk.y0 - p.y, p.y - desk.y1);
    const out = Math.hypot(Math.max(ox, 0), Math.max(oz, 0), Math.max(oy, 0));
    const inside = Math.max(ox, oz, oy);
    m = Math.min(m, (inside > 0 ? out : inside) - O.lensGap);
  }
  return m;
}

/**
 * The dive track from `from` (eye pose) into screen `s`, passing over the shoulder of the actor at `a` (feet pos).
 * `at(u)` (u ∈ 0..1 normalised time, eased inside) → CamPose (allocation-free with `out`).
 * m3 fix r1: the track is checked against the sitter's capsules and its desk box (`o.desk`, see `clearance`); a track
 * that grazes them is rebuilt with a wider, higher shoulder point and a higher drop (≤ 4 tries); `minClear` reports
 * the result (m).
 */
export function diveTrack(from: CamPose, s: Screen, a: Sitter | null, o: Partial<DiveOpts> & { desk?: DeskBox | null } = {}) {
  const O = { ...DIVE, ...o };
  const desk = o.desk ?? null;
  const end = diveEnd(s, O, a);
  // horizontal screen normal (toward the sitter) and its right-hand side
  const hn = Math.hypot(s.nx, s.nz) || 1, nx = s.nx / hn, nz = s.nz / hn;
  const rx = -nz, rz = nx;
  const P0 = { x: from.x, y: from.y, z: from.z };
  const E = { x: end.x, y: end.y, z: end.z };
  const side = a ? Math.sign((from.x - a.x) * rx + (from.z - a.z) * rz) || 1 : 1;
  let path: CamPath | null = null, P1: P3 | null = null, P2: P3 | null = null, minClear = Infinity;
  for (let k = 0; k < 5; k++) {
    const up = k * 0.12, out = k * 0.12;
    // drop point: straight above the end pose, over the hat tip (the sitter is behind the lens at the end)
    P2 = { x: end.x - s.nx * O.approach, y: a ? Math.max(end.y + 0.3, (a.y ?? 0) + O.hatTop + O.drop + up) : end.y + 0.1, z: end.z - s.nz * O.approach };
    if (a) {
      // the shoulder on the side the camera comes from, above and a little behind the head
      P1 = {
        x: a.x + nx * O.shoulderBack + rx * (O.shoulderSide + out) * side,
        y: (a.y ?? 0) + O.headTop + O.shoulderUp + up,
        z: a.z + nz * O.shoulderBack + rz * (O.shoulderSide + out) * side,
      };
    } else {
      P1 = { x: (from.x + P2.x) / 2, y: Math.max(from.y, P2.y) + 0.2, z: (from.z + P2.z) / 2 };
    }
    // Catmull-Rom through start → shoulder → drop → screen, arc-length parametrised (path.ts), so the eased time is
    // the eased distance: no bunching at the control points
    path = createCamPath([P0, P1, P2, E], { perSeg: 16 });
    minClear = trackClear(path, a, desk, O);
    if (minClear >= O.pad - 1e-6 || (!a && !desk)) break;
  }
  const smp = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: -1 };
  const fov0 = from.fov;
  if (!path) throw new Error('diveTrack: no path'); // unreachable: the loop above runs at least once
  const track = path;
  return {
    end, P1, P2, dur: O.dur, length: track.length, minClear,
    /** `u` = normalised time */
    at(u: number, out: CamPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: 0 }): CamPose {
      const t = easeInOut(u);
      track.sample(t * track.length, smp);
      out.x = smp.x; out.y = smp.y; out.z = smp.z;
      // look: from the starting view onto the screen centre (then held on it)
      const l = lookOf(s.x - out.x, s.y - out.y, s.z - out.z);
      const k = smooth(0, O.lookIn, u);
      if (u >= 1) { out.yaw = end.yaw; out.pitch = end.pitch; }
      else { out.yaw = wrap(from.yaw + wrap(l.yaw - from.yaw) * k); out.pitch = from.pitch + (l.pitch - from.pitch) * k; }
      out.fov = fov0 + (end.fov - fov0) * smooth(0.15, 1, t);
      return out;
    },
  };
}

/** Worst clearance along a path (48 samples, the start excluded: the player stands where it stands). */
function trackClear(path: CamPath, a: Sitter | null, desk: DeskBox | null, O: DiveOpts): number {
  const q = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: -1 };
  let m = Infinity;
  for (let i = 2; i <= 48; i++) { path.sample((i / 48) * path.length, q); m = Math.min(m, clearance(q, a, desk, O)); }
  return m;
}

/**
 * Screen rect (CSS px, `{left, top, width, height}`) of the screen's corners given a projector `(x,y,z) → [ndcX, ndcY]`
 * (camera.project) and the canvas' client rect. Null if any corner is behind the lens.
 */
export function screenRectPx(s: Screen, project: (x: number, y: number, z: number) => [number, number, number] | null, view: { left: number; top: number; width: number; height: number }): { left: number; top: number; width: number; height: number } | null {
  const rx = s.uy * s.nz - s.uz * s.ny, ry = s.uz * s.nx - s.ux * s.nz, rz = s.ux * s.ny - s.uy * s.nx; // up × normal = right
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const px = s.x + rx * a * s.w / 2 + s.ux * b * s.h / 2;
    const py = s.y + ry * a * s.w / 2 + s.uy * b * s.h / 2;
    const pz = s.z + rz * a * s.w / 2 + s.uz * b * s.h / 2;
    const q = project(px, py, pz);
    if (!q || q[2] > 1) return null;
    const cx = view.left + (q[0] + 1) / 2 * view.width, cy = view.top + (1 - q[1]) / 2 * view.height;
    x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
  }
  return { left: Math.round(x0), top: Math.round(y0), width: Math.round(x1 - x0), height: Math.round(y1 - y0) };
}
