// @pure
/**
 * Face-framing stand spot (PLY; reviewer m2 carryover [UI] "go there frames the agent's back from 0.8 m"): the best
 * standing camera pose to look at an actor from — 1.6–2.4 m away, 3/4-front (a seated worker from the side-3/4, so
 * its face shows beside the monitor), face + monitor in frame, foreground clutter penalised (walls / jambs via the
 * follow scorer's probe, plus the queue's stanchion posts and ropes, which the follow world treats as see-through).
 * UI's go-to / focus reuse it (`standSpot(actor, q)`), and the monitor dive uses it as its wide "approach" pose.
 * No three.js (node-testable). One scoring pass ≈ the follow scorer's one-shot pass (≤ 1 ms); no A*: the caller checks
 * reachability of the front runners (`standSpots` returns the ranked list) inside its own search budget.
 * Owner: PLY.
 */
import { FOLLOW, followWorld, scoreSpots, worldBlocked } from './follow.ts';
import type { Widen, FollowActor, FollowBox, FollowNav, FollowWorld, ScoredSpot } from './follow.ts';
import type { Layout } from '../world/layout/schema.ts';

export const STAND = Object.freeze({
  dists: [1.6, 1.85, 2.1, 2.4],   // every candidate is inside the reviewer's 1.6–2.4 m band
  minDist: 1.6, maxDist: 2.4,
  bestDist: 1.95,
  bearings: 32,
  deskBearings: 64,               // a seated worker: the side-3/4 gaps between pod desks and neighbours are narrow
  eyeH: 1.2,                      // standing eye (player/tuning.ts eyeHeight)
  wallGap: 0.34,                  // player radius 0.28 + margin
  actorClear: 0.62,               // m between the stand point and any other actor
  // 3/4-front: cf = cos(angle between the actor's facing and the bearing to the camera); 1 = dead front
  cfIdeal: 0.62,
  // m3 fix r1 (reviewer [code]): a seated worker's face and its screen both read only from beside the desk: in front of
  // the face plane, behind the screen plane. In a full pod the neighbours sit exactly there, so the lens may drift to
  // the side-back, as far as CHR's walk-up face turn (≤ 25° + eyes toward a player within 2 m) still shows the face:
  // cf ≥ cfSeatedMin. Behind that the face is gone (the back of its head) and the spot pays `seatBack` per cos.
  cfSeated: 0.05, cfSeatedMin: -0.45, seatBack: 900,
  facing: 140, back: 300,
  // the monitor (when known): in frame, not hidden, its screen not turned fully away
  monIn: 120, monHidden: 90, monAway: 60, monHalfFov: 0.42, // rad off the view axis still "comfortably in frame"
  monBack: 520, monMinDot: 0.12,  // cos(screen normal, screen → lens) under this: the back / edge of the monitor (unreadable)
  monBody: 420,                   // the sitter's own body between the lens and its screen (the screen is the point)
  faceBehindMon: 360,             // the face hidden behind its own monitor panel
  seatedFaceY: 0.62,              // seated face centre above the feet (0.32 seat + ≈ 0.3), 0.15 m ahead of the body centre
  body: { halfW: 0.36, halfD: 0.23, y0: 0.3, y1: 0.98 }, // seated Clawd body box (chars/render/geometry.ts BODY_*)
  // foreground clutter the follow world ignores: posts / ropes within `ropeReach` of the lens
  rope: 60, ropeReach: 1.25, ropeRays: [-26, -16, -8, 0, 8, 16, 26], postW: 3, postHalfFov: 0.62,
  unclear: 150, unclearSeated: 60, // follow.ts `clear` false (a neighbour looming, frame clutter); a busy pod always has one
  bodyFurn: 40,                   // furniture cutting the body line (a desk edge: normal for a desk worker)
});

export type StandOpts = Widen<typeof STAND>;
/** The desk monitor: screen centre (+ its facing normal, horizontal, and its size) when the actor works at a desk. */
export interface StandMonitor { x: number; y: number; z: number; nx?: number; nz?: number; w?: number; h?: number }
export interface StandQuery {
  layout: Layout | null | undefined;
  others?: Iterable<FollowActor>;
  nav?: FollowNav | null;
  faceYaw?: number;
  seated?: boolean;
  monitor?: StandMonitor | null;
  eyeH?: number;
  o?: Partial<StandOpts>;
}
/** Monitor visibility from a stand spot (see `monitorView`). */
export interface MonitorView { inFrame: number; hidden: boolean; facing: number; body: boolean; faceHidden: boolean; aim: { yaw: number; pitch: number } }
/** A stand pose: feet (x, y, z), the eye, the view angles, and how well it scored. */
export interface StandSpot {
  x: number; y: number; z: number; level: number; eye: { x: number; y: number; z: number }; yaw: number; pitch: number;
  dist: number; cf: number; score: number; clear: boolean; rope: number; clutter: number; monitor: MonitorView | null;
}

let cacheL: Layout | null | undefined = null, cacheW: FollowWorld | null = null;
const worldOf = (L: Layout | null | undefined): FollowWorld => {
  if (!cacheW || L !== cacheL) { cacheL = L; cacheW = followWorld(L); }
  return cacheW;
};

/** Ranked stand spots around `a` (best first). */
export function standSpots(a: FollowActor, q: StandQuery): StandSpot[] {
  if (!a?.pos) return [];
  const o = { ...STAND, ...(q.o ?? {}) };
  const L = q.layout;
  const ay = a.pos.y ?? 0;
  const level = L?.floorAt ? L.floorAt(a.pos.x, a.pos.z, ay + 0.05).level : 0;
  const eyeH = q.eyeH ?? o.eyeH;
  const W = worldOf(L);
  const others: FollowActor[] = [];
  for (const b of q.others ?? []) if (b?.pos && b !== a && b.id !== a.id && !b.hidden) others.push(b);
  const mon = q.monitor ?? null;
  const seated = !!q.seated;
  const fy = q.faceYaw ?? a.yaw ?? 0;
  const fo = { ...FOLLOW, dists: o.dists, bestDist: o.bestDist, bearings: mon ? o.deskBearings : o.bearings, heights: [eyeH], wallGap: o.wallGap };
  let list: ScoredSpot[];
  try { list = scoreSpots({ a, others, W, nav: q.nav, level, faceYaw: fy, o: fo }); }
  catch (e) { console.error('[standSpot] scorer', e); list = []; }
  const R = ropeSegs(L);
  // the face: a seated worker's is low and at the front of its body (the follow scorer aims at 0.85 m, the centre)
  const ffx = -Math.sin(fy), ffz = -Math.cos(fy);
  const face = seated
    ? { x: a.pos.x + ffx * 0.15, y: ay + o.seatedFaceY, z: a.pos.z + ffz * 0.15 }
    : { x: a.pos.x, y: ay + 0.85, z: a.pos.z };
  // the monitor sightline skips the subject's own desk (its follow box stands 1.0 m tall to cover the monitor, so a
  // plain world test calls every screen hidden): the world minus the desk the screen stands on
  const Wm = mon ? withoutDeskAt(W, mon) : W; // (only read when there is a monitor)
  const cfIdeal = seated ? o.cfSeated : o.cfIdeal;
  const out: StandSpot[] = [];
  for (const s of list) {
    if (s.score < -1e8) continue;
    if (s.wall === 'wall' || s.wall === 'ceiling') continue;                                  // no line of sight
    if (worldBlocked(W, level, s.x, s.y, s.z, face.x, face.y, face.z, FOLLOW.near)) continue; // face hidden
    const dist = Math.hypot(a.pos.x - s.x, a.pos.z - s.z);
    if (dist < o.minDist - 1e-6 || dist > o.maxDist + 1e-6) continue;
    if (others.some((b) => Math.hypot(b.pos.x - s.x, b.pos.z - s.z) < o.actorClear)) continue;
    if ((s.occ ?? 0) > 0.25) continue;                                                                // a face in front of the subject
    let sc = s.score;
    // re-weigh the facing term for this use: 3/4-front (side-3/4 when seated), never the back of its head
    const cf = s.cf ?? 0; // every spot that got past the early rejections carries its metrics
    sc -= o.facing * Math.abs(cf - cfIdeal);
    if (cf < -0.2) sc -= o.back * (-0.2 - cf);
    if (seated && cf < o.cfSeatedMin) sc -= o.seatBack * (o.cfSeatedMin - cf);
    if (s.wall) sc -= o.bodyFurn;
    if (!s.clear) sc -= seated ? o.unclearSeated : o.unclear;
    const rope = ropeClutter(R, s, a, o);
    sc -= o.rope * rope;
    let yaw = s.yaw ?? 0, pitch = s.pitch ?? 0;
    let monitor: MonitorView | null = null;
    if (mon) {
      monitor = monitorView(Wm, level, s, mon, a, face, fy, o);
      if (monitor.inFrame) sc += o.monIn * monitor.inFrame; else sc -= o.monIn * 0.5;
      if (monitor.hidden) sc -= o.monHidden;
      if (monitor.facing < o.monMinDot) sc -= o.monBack + 400 * Math.min(1, o.monMinDot - monitor.facing);
      if (monitor.body) sc -= o.monBody;
      if (monitor.faceHidden) sc -= o.faceBehindMon;
      // aim between the face and the screen so both sit in frame
      if (monitor.aim) { yaw = monitor.aim.yaw; pitch = monitor.aim.pitch; }
    }
    const floor = L?.floorY ? L.floorY(s.x, s.z, level) : ay;
    out.push({ x: s.x, y: floor, z: s.z, level, eye: { x: s.x, y: s.y, z: s.z }, yaw, pitch: Math.max(-0.5, Math.min(0.25, pitch)),
      dist: +dist.toFixed(3), cf, score: sc, clear: !!s.clear, rope: +rope.toFixed(2), clutter: s.clutter ?? 0, monitor });
  }
  out.sort((x, y) => y.score - x.score);
  return out;
}

/**
 * The best stand pose for `a` (see `standSpots`), or null when nothing in the 1.6–2.4 m band has a view of its face.
 */
export function standSpot(a: FollowActor, q: StandQuery): StandSpot | null {
  return standSpots(a, q)[0] ?? null;
}

/**
 * Monitor visibility from stand spot s: in-frame share (0..1), hidden by world geometry (own desk excluded), screen
 * facing (cos; +1 = square on), the sitter's own body in the way (`body`), the face behind its own monitor panel
 * (`faceHidden`), and the aim pose (between the face and the screen).
 */
function monitorView(W: FollowWorld, level: number, s: ScoredSpot, mon: StandMonitor, a: FollowActor, face: { x: number; y: number; z: number }, fy: number, o: StandOpts): MonitorView {
  const dx = mon.x - s.x, dz = mon.z - s.z, dh = Math.hypot(dx, dz) || 1e-6;
  // aim at the midpoint of the face and the screen centre
  const fx = (face.x + mon.x) / 2, fz = (face.z + mon.z) / 2, fyy = (face.y + mon.y) / 2;
  const hx = fx - s.x, hz = fz - s.z, hy = fyy - s.y;
  const yaw = Math.atan2(-hx, -hz), pitch = Math.atan2(hy, Math.hypot(hx, hz) || 1e-6);
  const off = Math.abs(Math.atan2(Math.sin(Math.atan2(-dx, -dz) - yaw), Math.cos(Math.atan2(-dx, -dz) - yaw)));
  const faceOff = Math.abs(Math.atan2(Math.sin(Math.atan2(-(face.x - s.x), -(face.z - s.z)) - yaw), Math.cos(Math.atan2(-(face.x - s.x), -(face.z - s.z)) - yaw)));
  const inFrame = Math.max(0, 1 - Math.max(off, faceOff) / o.monHalfFov);
  const hidden = !!worldBlocked(W, level, s.x, s.y, s.z, mon.x, mon.y, mon.z, 0.05);
  const mnx = mon.nx, mnz = mon.nz; // both or neither
  const hn = mnx == null || mnz == null ? 0 : Math.hypot(mnx, mnz) || 1;
  const facing = mnx == null || mnz == null ? 0 : (-dx * mnx + -dz * mnz) / (dh * hn); // +1: looking straight at the screen
  const body = segHitsBody(s.x, s.y, s.z, mon.x, mon.y, mon.z, a, fy, o.body);
  const faceHidden = mon.nx != null && segHitsPanel(mon, s.x, s.y, s.z, face.x, face.y, face.z);
  return { inFrame: +inFrame.toFixed(3), hidden, facing: +facing.toFixed(3), body, faceHidden, aim: { yaw, pitch } };
}

/** The follow world without the desk the monitor stands on and that monitor's own box (follow.ts splits them). */
let wmW: FollowWorld | null = null, wmKey = '', wmC: FollowWorld | null = null;
function withoutDeskAt(W: FollowWorld, mon: StandMonitor): FollowWorld {
  const key = `${mon.x.toFixed(3)},${mon.z.toFixed(3)}`;
  if (wmC && W === wmW && key === wmKey) return wmC;
  let desk: FollowBox | null = null, bd = 0.8, own: FollowBox | null = null, bm = 0.35;
  for (const f of W.furn) {
    const d = Math.hypot(f.x - mon.x, f.z - mon.z);
    if ((f.type === 'desk' || f.type === 'hotDesk' || f.type === 'shellBench') && d < bd) { bd = d; desk = f; }
    if (f.type === 'monitor' && d < bm) { bm = d; own = f; }
  }
  wmW = W; wmKey = key;
  const c = desk || own ? { ...W, furn: W.furn.filter((f) => f !== desk && f !== own) } : W;
  wmC = c;
  return c;
}

/**
 * Does the segment (ax, ay, az) → (bx, by, bz) pass through the seated body box of `a` (yaw `fy`, local +z = behind)?
 * Slab clip in the body frame.
 */
export function segHitsBody(ax: number, ay: number, az: number, bx: number, by: number, bz: number, a: FollowActor, fy: number, B: { halfW: number; halfD: number; y0: number; y1: number }): boolean {
  const c = Math.cos(fy), sn = Math.sin(fy), oy = a.pos.y ?? 0;
  const rx = ax - a.pos.x, rz = az - a.pos.z, dx = bx - ax, dz = bz - az, dy = by - ay;
  const lx = rx * c - rz * sn, lz = rx * sn + rz * c, ldx = dx * c - dz * sn, ldz = dx * sn + dz * c;
  let t0 = 0, t1 = 1;
  const slabs: [number, number, number | null][] = [[lx, ldx, B.halfW], [lz, ldz, B.halfD], [ay - oy, dy, null]];
  for (const [p, d, h] of slabs) {
    const lo = h == null ? B.y0 : -h, hi = h == null ? B.y1 : h;
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return false; continue; }
    let u0 = (lo - p) / d, u1 = (hi - p) / d;
    if (u0 > u1) { const q = u0; u0 = u1; u1 = q; }
    t0 = Math.max(t0, u0); t1 = Math.min(t1, u1);
    if (t0 >= t1) return false;
  }
  return true;
}

/**
 * Does the segment a → b pass through the monitor panel (the screen rectangle + bezel; a vertical plane through the
 * screen centre with horizontal normal (nx, nz))? The seated face hidden behind its own monitor.
 */
export function segHitsPanel(M: StandMonitor, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  const mnx = M.nx ?? NaN, mnz = M.nz ?? NaN; // callers check the normal exists
  const hn = Math.hypot(mnx, mnz) || 1, nx = mnx / hn, nz = mnz / hn;
  const da = (ax - M.x) * nx + (az - M.z) * nz, db = (bx - M.x) * nx + (bz - M.z) * nz;
  if ((da > 0) === (db > 0) || Math.abs(da - db) < 1e-9) return false;
  const t = da / (da - db);
  const px = ax + (bx - ax) * t - M.x, py = ay + (by - ay) * t - M.y, pz = az + (bz - az) * t - M.z;
  const along = px * nz - pz * nx;
  return Math.abs(along) <= (M.w ?? 0.37) / 2 + 0.03 && Math.abs(py) <= (M.h ?? 0.155) / 2 + 0.06;
}

/** Rope runs + stanchion posts as 2D segments / points (world), cached per layout. */
export interface RopeSegs { segs: (readonly number[])[]; posts: [number, number][] }
let ropeL: Layout | null | undefined = null, ropeC: RopeSegs | null = null;
export function ropeSegs(L: Layout | null | undefined): RopeSegs {
  if (L === ropeL && ropeC) return ropeC;
  ropeL = L;
  const segs = (L?.queueRopes ?? []).map((r: readonly number[] | { x0: number; z0: number; x1: number; z1: number }) => ('x0' in r ? [r.x0, r.z0, r.x1, r.z1] : r));
  const posts = (L?.furniture ?? []).filter((f) => f.type === 'stanchion').map((f): [number, number] => [f.pos.x, f.pos.z]);
  ropeC = { segs, posts };
  return ropeC;
}

/** Distance along the 2D ray (ox, oz) + t·(dx, dz) to segment [x0, z0, x1, z1], or Infinity. */
function raySeg(ox: number, oz: number, dx: number, dz: number, x0: number, z0: number, x1: number, z1: number): number {
  const ex = x1 - x0, ez = z1 - z0;
  const den = dx * ez - dz * ex;
  if (Math.abs(den) < 1e-9) return Infinity;
  const t = ((x0 - ox) * ez - (z0 - oz) * ex) / den;
  const u = ((x0 - ox) * dz - (z0 - oz) * dx) / den;
  return t > 0 && u >= 0 && u <= 1 ? t : Infinity;
}

/**
 * Foreground rope / post clutter of a view from s = {x, z, yaw} toward `a` (0 = none): per ray of a fan across the
 * view that meets a rope within `ropeReach`, its nearness (1 at the lens → 0 at the reach); a post in view within the
 * reach adds postW × nearness.
 */
export function ropeClutter(R: RopeSegs | null | undefined, s: { x: number; z: number; yaw?: number }, a: Pick<FollowActor, 'pos'>, o: StandOpts = STAND): number {
  if (!R || (!R.segs.length && !R.posts.length)) return 0;
  const syaw = s.yaw ?? 0;
  const dA = Math.hypot(a.pos.x - s.x, a.pos.z - s.z);
  const reach = Math.min(o.ropeReach, dA - 0.35);
  if (reach <= 0.1) return 0;
  let sum = 0;
  for (const deg of o.ropeRays) {
    const yy = syaw + (deg * Math.PI) / 180;
    const dx = -Math.sin(yy), dz = -Math.cos(yy);
    let t = Infinity;
    for (const g of R.segs) t = Math.min(t, raySeg(s.x, s.z, dx, dz, g[0], g[1], g[2], g[3]));
    if (t < reach) sum += 1 - t / reach;
  }
  const fx = -Math.sin(syaw), fz = -Math.cos(syaw);
  for (const p of R.posts) {
    const px = p[0] - s.x, pz = p[1] - s.z;
    const along = px * fx + pz * fz;
    if (along <= 0.05 || along >= reach) continue;
    if (Math.abs(Math.atan2(px * fz - pz * fx, along)) < o.postHalfFov) sum += o.postW * (1 - along / reach);
  }
  return sum;
}
