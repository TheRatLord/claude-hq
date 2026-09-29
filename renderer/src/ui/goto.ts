// @pure
/**
 * "Go there" (§8: "an eased glide along the nav path (400–900 ms), ending 1.8 m from the agent, facing it"), reviewer
 * m2-r2 [ui]: the old stand point was 1.8 m along the agent's yaw with no checks and the glide a straight lerp, so from
 * the inbox on a queued agent the camera ended behind the Help Desk counter with three faces filling the frame.
 *
 * `pickStand` runs PLY's follow spot scorer (player/follow.ts scoreSpots) ONCE at standing eye height and then
 * rejects spots that are inside colliders (nav, other actors), have no line of sight to the face or that the player
 * can't reach; a counter / planter between you and the agent (a knee-high line hits solid furniture: the staff side
 * of the Help Desk) costs heavily, so it only wins when nothing else is left. `glidePath` turns the nav route into an arc-length parametrised, eased pose track.
 * No three.js (node-testable).
 * Owner: UI.
 */
import { FOLLOW, followWorld, scoreBegin, scoreStep, worldBlocked } from '../player/follow.ts';
import { DESK, deskLocal } from '../world/layout/proto.ts';
import type { FollowNav, FollowWorld, FollowBox, ScoredSpot, ScoreJob, Cand } from '../player/follow.ts';
import type { GoActor, GoSlot } from '../player/goThere.ts';
import type { GoStand, GoStandJob } from '../player/goThereCtl.ts';
import type { Layout, Rect } from '../world/layout/schema.ts';
import type { Route } from '../world/nav/index.ts';
import { isRecord } from '../../../shared/guards.ts';

/** A layout as the stand search gets it (null = none loaded). */
type Lay = Layout | null | undefined;
interface Pt { x: number; z: number }
interface Vec3 { x: number; y: number; z: number }
/** A position as actors carry it (`y` defaults to 0). */
interface ActorPos { x: number; y?: number; z: number }
/** A slot as go-there sees it, plus the furniture it hangs off (desk slots). */
export interface StandSlot extends GoSlot { anchor?: string; yaw?: number; level?: number }
/** An actor as the stand search sees it. */
export interface StandActor extends GoActor { slot?: StandSlot | null; intent?: { slot?: StandSlot | null } | null }
/** What the sightline helpers read of an actor standing or sitting in the way: its feet and whether it is settled in a seat. */
export interface BodyActor { pos: ActorPos; arrived?: boolean; intent?: { slot?: { pose?: string } | null } | null; slot?: { pose?: string } | null }
/** The screen panel's plane (what the occlusion helpers read of a `Monitor`). */
export type MonitorPlane = Pick<Monitor, 'x' | 'y' | 'z' | 'nx' | 'nz' | 'w' | 'h'>;
/** The desk screen a seated agent looks at (world space; (nx, nz) = the screen normal, toward the agent). */
export interface Monitor { desk: string; x: number; y: number; z: number; nx: number; nz: number; yaw: number; w: number; h: number }
/** A predicted eye point + its face plate's normal. */
export interface Eye { x: number; y: number; z: number; nx: number; ny: number; nz: number }
/** A lens (eye) pose. */
export interface LensPose { x: number; y: number; z: number; yaw: number; pitch?: number }
/** A body capsule: its feet position, seated or standing, radius (default WALKUP.bodyR). */
export interface Body { pos: ActorPos; seated?: boolean; r?: number }
/** A nav route point. */
export interface RoutePt { x: number; z: number; level?: number }
/** Rope runs [x0, z0, x1, z1] + stanchion posts [x, z]. */
export interface Ropes { segs: readonly (readonly number[])[]; posts: readonly (readonly number[])[] }
/** A point of desk-set foreground clutter. */
export interface ClutterPt { x: number; y: number; z: number; w: number; desk: string | null }
/** The metrics `standScore` hangs on a scored spot (all optional: only set once the spot passes the early rejections). */
export interface Spot extends ScoredSpot {
  inPath?: boolean; rope?: number; propOcc?: { face: number; body: number }; bodyOcc?: { face: number; body: number };
  mouthWorld?: boolean; inCone?: boolean; mon?: number | null; mouthOk?: boolean; faceOk?: boolean; monHidden?: number;
  cover?: number; fgDesk?: number; aisle?: boolean; cfLive?: number; fov?: number; eyes?: number; eyesGood?: number; tier?: number;
  clutProbed?: boolean; validated?: boolean; eyesLive?: number; eyesGoodLive?: number;
}
/** The pose of a spot as the lens-space helpers read it (an unscored spot has no yaw: NaN, as `undefined` arithmetic was). */
const lensOf = (s: Spot): LensPose => ({ x: s.x, y: s.y, z: s.z, yaw: s.yaw ?? NaN, pitch: s.pitch ?? 0 });

/** Go-to spot tuning: the follow scorer at the player's standing eye, around §8's 1.8 m. */
export const GOTO = Object.freeze({
  // m2-r3: 1.6–2.4 m preferred (0.8 m behind a back filled 40 % of a 1366 strip); 2.8–3.6: a queued agent's lane
  // is off limits, so its view is from outside the rope, stepped back so the rope isn't at the lens
  dists: [1.7, 2.0, 2.4, 2.8, 3.2, 3.6],
  bestDist: 2.0,
  minDist: 1.6,       // never closer than this to the agent (its destination when it's walking)
  bearings: 32,       // one-shot pass: finer than follow's 16 (and a superset of its bearings), so the side-3/4 gaps between desks are found
  actorClear: 0.62,   // m between the stand point and any other actor's centre
  wallGap: 0.34,      // nav clearance (player radius 0.28 + margin)
  reach: 0.6,         // the straight walk to the agent must be free up to this far short of it (its own chair / desk)
  blockedWalk: 400,   // penalty when something solid stands between you and the agent (a counter, a planter)
  // [LVL m3 fix r2, cross-owner UI] a Help Desk queue member (it faces the teller window) seen across the counter from
  // the staff side: the counter top filled the lower 40 % and cut the face at the mouth (art review m3-r2 pat-b0). With
  // two walkers on the corridor's side-3/4 spots the staff side won 56 of 96 cases; this extra cost makes any queue-side
  // spot (side-3/4 from the corridor, or back-3/4 over the lane) win, the counter view stays the last resort
  // [UI fix r3] 700 → 1200: the new face / body occluder terms (a queue rope across the face, OCCL) must not tip a crowded
  // queue view over to the staff side; the counter view stays the last resort
  counterSide: 1200,
  bodyWall: 260,      // extra penalty when furniture cuts the body sightline (the counter between you and the agent)
  unclear: 150,       // not follow.ts `clear` (a neighbour looming in the foreground, frame clutter): a clean back-3/4 beats it
  // m2-r3: the face must read. A seated worker's face (≈ 0.6 m) sits below its monitor's top, so the front is gone;
  // side / side-3/4 (face beside the monitor) beats back-3/4, which beats the plain back (penalty per cos below −0.3)
  back: 240, backFrom: -0.3,
  // foreground clutter the follow world ignores (see-through for sightlines): stanchion posts and queue ropes
  // crossing the lower frame within `ropeReach` of the lens (reviewer: a post + rope cut across tinker at the queue)
  rope: 60, ropeReach: 1.25, ropeRays: [-26, -16, -8, 0, 8, 16, 26], postW: 3, postHalfFov: 0.62,
  // don't stand in the walker's way: a spot this close to its remaining route makes it stop politely ("after you!")
  // until you move, so it never arrives (m2-r3: maple parked 5 m short of its desk behind the camera)
  pathClear: 1.3, inPath: 350, // > BRN's T.avoidR (1.2 m): the walker plans around the player at that radius
  minMs: 400, maxMs: 900, msPerM: 90,
});

let cacheL: Lay = null, cacheW: FollowWorld | null = null;
const worldOf = (L: Lay): FollowWorld => { if (!cacheW || L !== cacheL) { cacheL = L; cacheW = followWorld(L); } return cacheW; };
/** The (cached) follow world of a layout: sightline boxes for eyesView's world test (ui/index.ts live eye check). */
export const standWorld = worldOf;

/**
 * M3.5 walk-up framing ("walk up to any Claude and see its face and its real screen"): a seated desk worker looks
 * into a monitor ≈ 0.75 m in front of it, a little to one side (proto.ts deskLocal), turned to its eyes. A front view
 * shows the monitor's back, a view from behind shows no face: both read only from beside the desk, where the lens is
 * in front of the face plane but behind the screen plane. Terms (added to the follow scorer's score):
 *   face: bearing (agent → lens) within `faceMaxDeg` of where the face looks (two tiers: in the cone first, the rest
 *     only when the cone is empty); with a monitor the cone widens to `deskFaceMaxDeg` (the face at 3/4-profile beside
 *     its screen — the only place both show); the eye → face line must miss the monitor panel.
 *   monitor: its screen must face the lens (`monMinDot`), the eye → screen line must be free of world geometry and of
 *     the agent's own body; `both` rewards the spot where the weaker of (face, screen) reads best.
 */
export const WALKUP = Object.freeze({
  faceMaxDeg: 60, deskFaceMaxDeg: 80,
  // desk candidates: finer bearings over the 1.6–2.4 m band (the pods leave a 0.8 m aisle beside a desk; CHR's
  // walk-up face turn (≤ 25° + eyes) needs the player within 2 m, full at 1.5 m: nearer is better)
  deskBearings: 48, deskDists: [1.6, 1.7, 1.8, 1.95, 2.2, 2.4], deskFar: 90, deskFarFrom: 2.0,
  // [UI fix r1, reviewers art/fun/code] the 1.6 m floor left only spots behind the face plane at a pod desk (the screen
  // sits 0.78 m in front of the face, desks 1.1 m apart): every accepted spot was the back of the head (cf −0.13…−0.61).
  // Desk walk-ups may come as close as `deskMin` (CHR's face turn is full at 1.5 m) and search a finer ring, then
  // rank in TIERS: 0 = face (live facing ≥ faceGood) + its own screen (facing, unoccluded by bodies / world) + no actor
  // filling > maxCover of the frame; 1 = side-3/4 beside the desk (live facing ≥ sideMin, face clear); 2 = anything else
  // (a back view is only taken when no tier-0/1 spot exists at all: the walled-in column-end desks). Face visibility
  // (eyes + mouth unoccluded) weighs above distance.
  // [UI fix r2, playtest "walk-up framing too tight"] at 1.17 m with the 60° lens a seated Clawd filled half the
  // frame, the hat was cropped and its screen was an unreadable slab at the edge. In a pod the face + screen band sits
  // between the face plane and the screen plane (0.6 m apart, desks 1.1 m apart), so a lens ≥ 1.4 m off shows both at
  // only 4 of 36 desks: instead a walk-up never frames TIGHTER than a 60° lens at `frameDist` — nearer than that the
  // lens widens during the glide-in (walkUpFov: ≤ fovMax, eased back when you move), and it never comes nearer than deskMin
  deskMin: 1.15, deskRing: [1.2, 1.35, 1.5, 1.6, 1.7, 1.8, 1.95, 2.2, 2.4], deskRingBearings: 72,
  frameDist: 1.6, fovBase: 60, fovMax: 76,
  // cfLive = the facing the lens sees once CHR's face turn has run (liveFacing; measured on the rig: matches ± 0.05);
  // cfFloor: the slot facing may sit at most this far behind the face plane (the turn covers it, never a back view)
  cfFloor: -0.2, sideMin: 0.3,
  faceGood: 0.6, maxCover: 0.15, tierGap: 3000, faceSeen: 160, liveRank: 900,
  bodyR: 0.3, ownR: 0.38, seatedTop: 1.0, standTop: 1.2, fovV: 60, aspect: 16 / 9,
  gridAlong: [-0.4, 1.2], gridLateral: [0.5, 2.4], gridStep: 0.1,
  deskNear: 1.4, deskClose: 500, // (effective framing distance, walkUpFov) nearer, a seated Clawd fills half the frame: step back when a spot allows
  // [UI fix r2, reviewer art] the lens looked down at the desktop (pitch −0.45…−0.51) with the face at the frame's
  // bottom edge: a desk walk-up never pitches below −0.25 (standing eye 1.2 m ≈ the 1.25 m asked for)
  pitchMin: -0.25,
  // [UI fix r2, reviewer art] tier 0 is decided in screen space, not by facing math alone: both eyes (face.ts EYE_X
  // ±0.145 m, ≈ 0.06 m above the face centre) must project inside the frame (|ndc| ≤ eyeNdc) with their face plate
  // turned to the lens (cos ≥ eyeGoodDot ≈ 60°, the slot facing: no credit for CHR's walk-up turn) and a free line to
  // the lens; a side-3/4 (tier 1) needs one eye at cos ≥ eyeMinDot. Its screen must read too: cos ≥ monReadDot (not
  // an edge-on slab at the frame's edge, playtest d05-onyx)
  eyeX: 0.145, eyeDy: 0.06, eyeMinDot: 0.3, eyeGoodDot: 0.5, eyeNdc: 0.9, monReadDot: 0.3, goodEye: 500,
  // [UI fix r2, reviewer code] the stand search is time-sliced: ≤ sliceMs of scoring per frame (standStep)
  sliceMs: 2, scoreChunk: 24,
  turn: 0.44, turnNear: 2.0, turnFull: 1.5, turnBehind: 2.45, // chars/anim/animator.ts FACE_TURN* (CHR)
  outsideCone: 420,  // penalty for a spot outside the face cone (× 0.35 + how far outside, ≤ 1): the cone wins unless it is blocked
  monMinDot: 0.12,   // cos(screen normal, screen → lens) below this = the back / edge of the monitor
  monBack: 420, both: 420, monBlocked: 260, monBody: 220, faceBehindMon: 360,
  // [UI fix r3] standing face centre measured on the live rig (eyes 0.50–0.54 m over the feet, face centre ≈ eyes − 0.06):
  // 0.85 aimed at the hat, so ropes crossing the real face (≈ 0.47) never counted
  seatedFaceY: 0.62, standFaceY: 0.47,
  routesPerFrame: 2, // budgeted reachability searches (nav.route) per frame for a go-there job
  // [UI fix r3, reviewers art/fun "spots across the pod behind the opposite desk's monitor + lamp"] the MOUTH must read
  // too (tier 0 = both eyes AND the mouth unhidden by world geometry — another desk's monitor —, the own monitor panel
  // and bodies); a face line through world geometry costs `mouthHidden`
  mouthDy: -0.07, mouthHidden: 520,
  // near-foreground clutter: desk-set meshes (monitor, lamp, keyboard, desk edge, chair) of any OTHER desk within
  // fgReach m of the lens and in the lower half of the frame (ndc y ≤ fgNdcY). Sum of weight × nearness (1 at the lens
  // → 0 at fgReach); × fgW off the score, and a spot with fg > fgTier drops a tier (the target's own desk edge is fine)
  fgReach: 1.0, fgNdcY: 0.1, fgW: 700, fgTier: 0.5,
  // prefer the aisle side beside the agent's own chair (the side its desk sits off-centre toward, away from its
  // monitor and the pod centre; CHR's face turn / chair swivel turns toward the player on either side, animator.ts
  // FACE_TURN): lateral ≥ aisleMin on that side, along its facing within aisleAlong
  aisle: 260, aisleMin: 0.3, aisleAlong: [-0.4, 1.3],
  // a neighbour's hat reaches ≈ 0.28 m over the seated capsule top (chars/rig/accessories.ts ACC_TOP): framing cover only
  hatTop: 0.28,
});

/**
 * [UI fix r3, playtest "a stanchion dead centre in front of the body, the rope across the face" + "a neighbour's hat
 * fills the lower-left quarter"] Occluders of the target's FACE and BODY beyond world geometry: queue posts, queue
 * ropes and other characters' bodies (every go-there, not only desk walk-ups). Penalties per spot.
 */
export const OCCL = Object.freeze({
  ropeY: 0.82, ropeSag: 0.1, postH: 0.92, postR: 0.07, // rope height over its floor (kit/decor.ts buildRope), post height / radius (+ margin)
  otherR: 0.42, // another Clawd's silhouette radius incl. arms / hat brim (follow.ts FOLLOW.other.r), not the 0.3 m body capsule
  faceHalfW: 0.22, bodyHalfW: 0.36, // (chars/render/geometry.ts BODY_W 0.72; the face plate ≈ 0.44 m)
  faceTop: 0.16, faceBot: -0.11, // face band around the face centre (m): brow … just under the mouth (face.ts EYE_Y, mouth = eyes − 0.14)
  propFace: 900, propBody: 220, bodyFace: 700, bodyBody: 180, cover: 900,
});

/**
 * Is the desk screen M hidden from the lens s by world geometry? The follow world (PLY follow.ts) boxes each desk top
 * and each desk monitor; the sightline skips the screen's own monitor box (it ends on it). Centre + both edges (0.4 w
 * off centre): hidden when the centre or both edges are blocked. Per-layout cache of the world minus each monitor.
 */
const scrCache = new WeakMap<FollowWorld, Map<string, FollowWorld>>();
export function screenBlocked(L: Lay, level: number, s: Vec3, M: Pick<Monitor, 'desk' | 'x' | 'y' | 'z' | 'nx' | 'nz' | 'w'>): boolean {
  const W = worldOf(L);
  let per = scrCache.get(W);
  if (!per) { per = new Map(); scrCache.set(W, per); }
  let Wm = per.get(M.desk);
  if (!Wm) {
    // fallback for a follow world without monitor boxes: drop the desk box itself (it used to stand 1.0 m tall)
    const own = (f: FollowBox) => (f.type === 'monitor' ? f.desk === M.desk : false);
    Wm = { ...W, furn: W.furn.filter((f) => !own(f)) };
    per.set(M.desk, Wm);
  }
  const tx = M.nz, tz = -M.nx;
  let hid = 0;
  for (const k of [0, -0.4, 0.4]) {
    const px = M.x + tx * M.w * k, pz = M.z + tz * M.w * k;
    if (worldBlocked(Wm, level, s.x, s.y, s.z, px, M.y, pz, 0.05)) { if (k === 0) return true; hid++; }
  }
  return hid >= 2;
}

let monL: Lay = null, monC = new Map<string, Monitor | null>();
/**
 * The desk monitor of a slot (the screen the seated agent looks at), world space, from the layout's furniture + the
 * shared desk geometry (proto.ts deskLocal, same math as the bays' dressing): `{x, y, z, nx, nz, yaw, w, h}` with
 * (nx, nz) the screen normal (toward the agent). null for slots without a desk.
 */
export function monitorOf(L: Lay, slot: { anchor?: string; tag?: string } | null | undefined): Monitor | null {
  if (!L || !slot?.anchor) return null;
  if (L !== monL) { monL = L; monC = new Map(); }
  const memo = monC.get(slot.anchor);
  if (memo !== undefined) return memo;
  const f = (L.furniture ?? []).find((q) => q.id === slot.anchor && q.type === 'desk');
  let m: Monitor | null = null;
  if (f) {
    const { monitor } = deskLocal(f);
    const cs = Math.cos(f.yaw ?? 0), sn = Math.sin(f.yaw ?? 0);
    const h = f.size?.[1] ?? DESK.h;
    const yaw = (f.yaw ?? 0) + monitor.twist;
    // local(pose, lx, ly, lz): three rotation.y convention (local +z faces `yaw`), bays.ts / common.ts
    m = { desk: f.id, x: f.pos.x + monitor.x * cs + monitor.z * sn, y: (f.pos.y ?? 0) + h + DESK.monitor.lift + 0.004, z: f.pos.z - monitor.x * sn + monitor.z * cs,
      nx: Math.sin(yaw), nz: Math.cos(yaw), yaw, w: DESK.monitor.w - 0.05, h: DESK.monitor.h - 0.045 };
  }
  monC.set(slot.anchor, m);
  return m;
}

/**
 * Does the segment (ax, ay, az) → (bx, by, bz) pass through the monitor panel (its screen rectangle, a vertical
 * plane through the screen centre with normal (nx, nz))? The seated face hidden behind its own monitor.
 */
export function segHitsMonitor(M: MonitorPlane, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  const da = (ax - M.x) * M.nx + (az - M.z) * M.nz, db = (bx - M.x) * M.nx + (bz - M.z) * M.nz;
  if ((da > 0) === (db > 0) || Math.abs(da - db) < 1e-9) return false;
  const t = da / (da - db);
  const px = ax + (bx - ax) * t - M.x, py = ay + (by - ay) * t - M.y, pz = az + (bz - az) * t - M.z;
  const along = px * M.nz - pz * M.nx; // along the screen's width (tangent = (nz, −nx))
  return Math.abs(along) <= M.w / 2 + 0.03 && Math.abs(py) <= M.h / 2 + 0.06; // + bezel
}

/** Scorer exceptions are logged (once per message) and counted instead of silently meaning "no spot" (M3.5). */
export const standErrors: { n: number; last: string | null } = { n: 0, last: null };
const seenErr = new Set<string>();
function logErr(err: unknown): void {
  standErrors.n++;
  standErrors.last = String((isRecord(err) ? err.message : undefined) ?? err);
  if (!seenErr.has(standErrors.last)) { seenErr.add(standErrors.last); globalThis.console?.warn?.('[ui goto] stand scorer failed:', err); }
}

/** The nav queries the stand search makes: the follow scorers' plus the route search (`owner: '*'` = the player). */
export interface StandNav extends FollowNav { route?(from: { x: number; z: number; level: number }, to: { x: number; z: number; level: number }, opts: { owner: string }): Route | null }
/**
 * keepOff ([PLY m3 fix r2]): circles no stand spot may lie in (the agent's own seats, its body when `a` is its slot)
 * avoid: the walker's remaining route (don't block it); log: diagnostics (rejections, the front runners);
 * monitor: the desk screen to keep in view (default: monitorOf(layout, a.slot ?? a.intent.slot) when seated there),
 * null = none; face: the face centre (default: the actor position + seated / standing face height)
 * validate: the live rig's check of a walk-up front runner (ui/index.ts)
 */
export interface StandQuery {
  a: StandActor; others: Iterable<StandActor>; layout: Lay; nav?: StandNav | null; eyeH?: number; faceYaw?: number;
  from?: { x: number; z: number; level?: number }; avoid?: Pt[]; log?: string[];
  monitor?: Monitor | null; face?: Face | null; seated?: boolean;
  keepOff?: { x: number; z: number; r: number }[];
  validate?: (pose: LensPose & { pitch: number; fov: number }) => { n: number; good: number } | null;
}
/** A face centre. */
export interface Face { x: number; y: number; z: number }
export interface Stand {
  x: number; y: number; z: number; level: number; yaw: number; pitch: number; score: number; why: string;
  cf: number | undefined; mon: number | null | undefined;
  tier?: number; cfLive?: number; monHidden?: number; faceOk?: boolean; cover?: number; eyes?: number; eyesGood?: number; eyesPred?: number; fov?: number;
  route?: Route;
  /** stamped by the caller for a walker: the slot id its spot frames */
  dest?: string;
}
/** Everything `standScore` needs about the target, built once by `standBegin`. */
interface StandCtx {
  a: StandActor; L: Lay; W: FollowWorld; M: Monitor | null; level: number; ay: number; face: Face; ffy: number; others: StandActor[];
  seated: boolean; queued: boolean; eyes: Eye[] | null; cosMax: number; ropes: Ropes | null; clut: ClutterPt[]; aisle: Pt | null;
  avoid: Pt[] | null; log: string[] | null;
}
export interface StandJob {
  q: StandQuery; scored: { s: Spot; sc: number }[]; i: number; tries: number; done: boolean; result: Stand | null; level: number; routes: number;
  phase: 'score' | 'rank' | 'route'; fjob: ScoreJob | null; list: ScoredSpot[] | null; k: number; c: StandCtx | null; ay: number; steps: number;
}

/**
 * Budgeted stand-spot search (M3.5; time-sliced in UI fix r2, reviewer [code]: the whole desk grid — ≈ 680 spots,
 * each with world raycasts, face / monitor occlusion and body capsules — was scored in ONE frame, 5–27 ms).
 * `standBegin` only sets the job up; `standStep(job, routes, ms)` then advances it: (1) the follow scorer over the
 * candidates in chunks of WALKUP.scoreChunk, (2) the walk-up checks per spot, (3) at most `routes` reachability
 * searches (nav.route from the player) over the front runners; phases 1–2 stop once `ms` is spent this call. Returns
 * true when done (`job.result` = the stand or null; `job.result.route` = the route found, reused for the glide).
 * `q.validate(pose)` (optional, the live rig: ui/index.ts) re-checks a walk-up front runner's eyes in screen space
 * before it is accepted; a spot whose eyes don't both show is demoted out of tier 0. `pickStand` = all in one go.
 */
export function standBegin(q: StandQuery): StandJob {
  const { a, layout: L, nav } = q;
  const job: StandJob = { q, scored: [], i: 0, tries: 0, done: false, result: null, level: 0, routes: 0, phase: 'score', fjob: null, list: null, k: 0, c: null, ay: 0, steps: 0 };
  if (!a?.pos) { job.done = true; return job; }
  const ay = a.pos.y ?? 0;
  job.ay = ay;
  const level = L?.floorAt ? L.floorAt(a.pos.x, a.pos.z, ay + 0.05).level : 0;
  job.level = level;
  const eyeH = q.eyeH ?? 1.2;
  const slot = a.slot ?? a.intent?.slot ?? null;
  const seated = q.seated ?? (!!slot && (slot.pose ?? 'sit') === 'sit' && /desk/.test(slot.tag ?? ''));
  // [LVL m3 fix r2, cross-owner UI] at / walking to a Help Desk queue place; [UI fix r3] or simply standing on one
  // (an agent without a slot intent there is still in the queue: the counter view stays the last resort)
  const queued = slot?.tag === 'queue' || (L?.slots ?? []).some((x) => x.tag === 'queue' && Math.hypot(x.pos.x - a.pos.x, x.pos.z - a.pos.z) < 0.4);
  const M = q.monitor !== undefined ? q.monitor : seated ? monitorOf(L, slot) : null;
  const o = { ...FOLLOW, dists: M ? WALKUP.deskRing : GOTO.dists, bestDist: M ? 1.6 : GOTO.bestDist, bearings: M ? WALKUP.deskRingBearings : GOTO.bearings, heights: [eyeH], wallGap: GOTO.wallGap };
  const W = worldOf(L);
  try {
    const f = scoreBegin({ a, others: q.others, W, nav, level, faceYaw: q.faceYaw, o, slices: 1 });
    // desk walk-up: the follow scorer over a grid beside the desk (deskGrid) + a coarse polar fallback ring; the
    // polar ring alone missed the 0.8 m pass-throughs and the column ends, the only places both face and screen show
    if (M) f.cand = deskGrid(a.pos, q.faceYaw ?? a.yaw ?? 0, eyeH);
    f.perSlice = WALKUP.scoreChunk;
    f.slices = Math.max(1, Math.ceil(f.cand.length / WALKUP.scoreChunk));
    job.fjob = f;
  } catch (err) { logErr(err); job.fjob = null; }
  // a seated face sits ≈ 0.15 m ahead of the body centre (PLY standSpot.ts), toward its monitor
  // [UI fix r3] a standing face plate sits ≈ 0.24 m ahead of the body centre too (face.ts FACE_Z): a stanchion dead
  // centre in front of the face missed the old body-centre line by 13 cm
  const ffy = q.faceYaw ?? a.yaw ?? 0, fAhead = seated ? 0.15 : 0.22;
  const face = q.face ?? { x: a.pos.x - Math.sin(ffy) * fAhead, y: ay + (seated ? WALKUP.seatedFaceY : WALKUP.standFaceY), z: a.pos.z - Math.cos(ffy) * fAhead };
  let others: StandActor[] = [];
  try { others = [...q.others].filter((b) => b?.pos && b !== a && b.id !== a.id && !b.hidden); } catch (err) { logErr(err); }
  job.c = {
    a, L, W, M, level, ay, face, ffy, others, seated, queued,
    eyes: M ? predictEyes(face, ffy) : null,
    cosMax: Math.cos(((M ? WALKUP.deskFaceMaxDeg : WALKUP.faceMaxDeg) * Math.PI) / 180),
    ropes: ropeSegs(L),
    clut: M ? nearClutter(L, a.pos, M.desk) : [],
    aisle: M ? aisleDir(L, M.desk) : null,
    avoid: q.avoid && q.avoid.length ? q.avoid : null,
    log: q.log ?? null,
  };
  return job;
}

/** Walk-up checks + ranking for one scored spot → job.scored (phase 2 of standStep). */
function standScore(job: StandJob, c: StandCtx, s: Spot): void {
  const { a, L, W, M, level, ay, face, others, cosMax, ropes, avoid, log, seated, queued } = c;
  // an unscored spot has no facing: NaN keeps every comparison false, as `undefined` did
  const cf = s.cf ?? NaN;
  const rej = (why: string | null) => { if (log && s.score > -1e8) log.push(`${s.x.toFixed(2)},${s.z.toFixed(2)} r${s.r} s${s.score.toFixed(0)} ✗ ${why}`); };
  if (s.score < -1e8) { if (log && s.why !== 'nav') rej(s.why); return; }
  if (s.wall === 'wall' || s.wall === 'ceiling') { rej('wall'); return; }           // no line of sight at all
  if (worldBlocked(W, level, s.x, s.y, s.z, face.x, face.y, face.z, FOLLOW.near)) { rej('face'); return; } // face hidden
  if (others.some((b) => Math.hypot(b.pos.x - s.x, b.pos.z - s.z) < GOTO.actorClear)) { rej('actor'); return; } // inside an actor
  // [PLY m3 fix r2, cross-owner] never on the agent's own seat / body (q.keepOff: player/goThere.ts keepOffFor)
  if (job.q.keepOff?.some((k) => Math.hypot(k.x - s.x, k.z - s.z) < k.r)) { rej('seat'); return; }
  const dd = Math.hypot(a.pos.x - s.x, a.pos.z - s.z);
  if (dd < (M ? WALKUP.deskMin : GOTO.minDist) - 1e-6) { rej('close'); return; }
  if (avoid && polyDist(avoid, s.x, s.z) < GOTO.pathClear) s.inPath = true;
  let sc = s.score;
  if (s.wall) sc -= GOTO.bodyWall;
  if (s.inPath) sc -= GOTO.inPath;
  if (cf < GOTO.backFrom) sc -= GOTO.back * (GOTO.backFrom - cf);  // the back of its head
  const rc = ropeClutter(ropes, lensOf(s), a);
  s.rope = rc;
  sc -= GOTO.rope * rc;                                    // stanchions / ropes across the lower frame
  // [UI fix r3] posts / ropes / other bodies in front of the FACE or BODY (not only the eyes, not only desks)
  // (the lens stands on the floor under the spot: the follow scorer's s.y is the target's floor + eye, 0.15 m off
  // beside the Help Desk dais — exactly the margin a rope crossing the face lives in)
  const lens = { x: s.x, y: (L?.floorY ? L.floorY(s.x, s.z, level) : ay) + (job.q.eyeH ?? 1.2), z: s.z };
  const po = propOcclusion(ropes, L, level, lens, face, ay);
  const bo = bodyOcclusion(lens, face, ay, others);
  s.propOcc = po; s.bodyOcc = bo;
  sc -= OCCL.propFace * po.face + OCCL.propBody * po.body + OCCL.bodyFace * bo.face + OCCL.bodyBody * bo.body;
  // [UI fix r3] the mouth must read too: world geometry (another desk's monitor, the Help Desk counter top seen from
  // the staff side) across it costs WALKUP.mouthHidden; the eyes-only test let those through
  s.mouthWorld = mouthWorldHidden(L, W, level, lens, face, M);
  if (s.mouthWorld) sc -= WALKUP.mouthHidden;
  if (!s.clear) sc -= GOTO.unclear;                                   // three queue faces filling the frame
  // behind a counter reads as 'staff side': a knee-high line to the agent must clear solid furniture (a rope or a
  // dais doesn't count; follow.ts IGNORE), up to `reach` short of it (its own chair / desk)
  if (worldBlocked(W, level, s.x, ay + 0.35, s.z, a.pos.x, ay + 0.35, a.pos.z, GOTO.reach)) sc -= GOTO.blockedWalk + (queued ? GOTO.counterSide : 0);
  if ((s.occ ?? 0) > 0.25) { rej('occ'); return; }                      // a queue face in front of the subject
  // M3.5 face cone + monitor
  s.inCone = cf >= cosMax - 1e-6;
  s.mon = null;
  if (M) {
    // face: eyes + mouth, each line must miss the monitor panel and every body (own head excluded: it IS the face)
    const faceHidden = faceOccluded(M, s, face, others);
    // [UI fix r3] … and world geometry: another desk's monitor / lamp covering the mouth (the eyes cleared it)
    s.mouthOk = !faceHidden && !s.mouthWorld;
    s.faceOk = !faceHidden;
    if (faceHidden) sc -= WALKUP.faceBehindMon;
    else sc += WALKUP.faceSeen;
    const vx = s.x - M.x, vy = s.y - M.y, vz = s.z - M.z, vl = Math.hypot(vx, vy, vz) || 1;
    const dot = (vx * M.nx + vz * M.nz) / vl;
    s.mon = +dot.toFixed(2);
    s.monHidden = 1;
    if (dot < WALKUP.monMinDot) sc -= WALKUP.monBack;
    else {
      sc += WALKUP.both * Math.min(cf, dot, 0.6);
      // (the desk's follow-world box stands 1.0 m tall to cover its monitor: stop short of the desk depth)
      const wb = screenBlocked(L, level, s, M);
      if (wb) sc -= WALKUP.monBlocked;
      // bodies between the lens and its screen: the agent's own head / body AND its neighbours (capsules), sampled
      // at the screen's centre and both edges (reviewer [code]: `mon` 0.34–0.87 while the body covered the glass)
      s.monHidden = wb ? 1 : screenBodyHidden(M, s, [{ pos: a.pos, seated, r: WALKUP.ownR }, ...others.map((b) => ({ pos: b.pos, seated: bodySeated(b) }))]);
      if (s.monHidden > 0) sc -= WALKUP.monBody * (1 + s.monHidden);
    }
  }
  // [UI fix r3] a neighbour (hat included) filling the frame of any go-there (desks: below, with the walk-up pose)
  if (!M && s.yaw != null) { s.cover = +maxCover(lensOf(s), others).toFixed(3); sc -= OCCL.cover * Math.max(0, s.cover - 0.05); }
  if (!s.inCone) sc -= WALKUP.outsideCone * Math.min(1, 0.35 + (cosMax - cf));
  if (M && dd > WALKUP.deskFarFrom) sc -= WALKUP.deskFar * (dd - WALKUP.deskFarFrom);    // out of the face-turn range
  const fov = M ? walkUpFov(dd) : WALKUP.fovBase;
  const de = dd * Math.tan((fov * Math.PI) / 360) / Math.tan((WALKUP.fovBase * Math.PI) / 360); // framing distance at the 60° lens
  if (M && de < WALKUP.deskNear) sc -= WALKUP.deskClose * (WALKUP.deskNear - de);         // looming over the head
  if (M) {
    // aim: the face, pulled toward the screen so both sit in frame (a seated worker); never steeper than pitchMin
    // (reviewer art: at −0.45…−0.51 the lens looked at the desktop, the face at the frame's bottom edge)
    const k = s.mon != null && s.mon >= WALKUP.monMinDot ? 0.38 : 0;
    const tx = face.x * (1 - k) + M.x * k, ty = face.y * (1 - k) + M.y * k, tz = face.z * (1 - k) + M.z * k;
    s.yaw = Math.atan2(-(tx - s.x), -(tz - s.z));
    s.pitch = Math.max(WALKUP.pitchMin, Math.atan2(ty - s.y, Math.hypot(tx - s.x, tz - s.z)));
    // tiers (WALKUP): 0 = both eyes in frame + its live screen, clean frame; 1 = side-3/4 (≥ 1 eye shows, face
    // clear); 2 = the rest. The eyes are projected into the frame this pose really shows (screen space).
    s.cover = +maxCover(lensOf(s), others).toFixed(3);
    sc -= OCCL.cover * Math.max(0, s.cover - 0.05); // [UI fix r3] a neighbour (hat included) looming in the frame
    // [UI fix r3] near-foreground desk clutter (other desks' monitors, lamps, keyboards, chairs within fgReach)
    s.fgDesk = +fgClutter(c.clut, lensOf(s), fov).toFixed(2);
    sc -= WALKUP.fgW * s.fgDesk;
    // [UI fix r3] the aisle side beside its own chair
    s.aisle = aisleSide(c.aisle, a.pos, c.ffy, s);
    if (s.aisle) sc += WALKUP.aisle;
    s.cfLive = +liveFacing(cf, dd).toFixed(2);
    s.fov = +fov.toFixed(1);
    const ev = eyesView(lensOf(s), c.eyes, { M, others, W, level, fovV: fov });
    s.eyes = ev.n; s.eyesGood = ev.good;
    const side = cf >= WALKUP.cfFloor && s.faceOk && s.cover <= WALKUP.maxCover;
    const t0 = side && s.eyesGood === 2 && s.mouthOk && s.mon != null && s.mon >= WALKUP.monReadDot && s.monHidden === 0;
    s.tier = t0 ? 0 : side && s.eyes >= 1 && s.cfLive >= WALKUP.sideMin ? 1 : 2;
    if (s.fgDesk > WALKUP.fgTier && s.tier < 2) s.tier++; // [UI fix r3] a cluttered foreground is never the top framing
    sc -= WALKUP.tierGap * s.tier;
    // [UI fix r2, reviewer art] below tier 0 the FACE wins: both eyes squarely in view (a front view across the
    // monitor) beats a profile beside a screen seen edge-on; ranked by the slot facing, no credit for the face turn
    sc += 60 * s.eyes + WALKUP.goodEye * s.eyesGood;
    if (s.tier >= 1) sc += WALKUP.liveRank * cf; // side-3/4 or worse: the most face wins
  }
  job.scored.push({ s, sc });
}

/**
 * Advance a stand search (see standBegin): scoring (≤ `ms` this call), then ≤ `budget` nav.route searches. → true when done.
 */
export function standStep(job: StandJob, budget = Infinity, ms = Infinity): boolean {
  if (job.done) return true;
  const c = job.c;
  if (!c) { job.done = true; return true; } // standBegin only leaves `c` unset when it finished the job itself
  const t0 = ms < Infinity ? performance.now() : 0;
  const over = () => ms < Infinity && performance.now() - t0 >= ms;
  job.steps++;
  if (job.phase === 'score') {
    try {
      if (job.fjob) while (!scoreStep(job.fjob)) if (over()) return false;
      job.list = job.fjob?.list ?? [];
    } catch (err) { logErr(err); job.list = []; }
    job.phase = 'rank';
    if (over()) return false;
  }
  if (job.phase === 'rank') {
    const list = job.list ?? [];
    while (job.k < list.length) {
      try { standScore(job, c, list[job.k]); } catch (err) { logErr(err); }
      job.k++;
      if ((job.k & 7) === 0 && job.k < list.length && over()) return false;
    }
    job.scored.sort((x, y) => y.sc - x.sc);
    job.phase = 'route';
    if (!job.scored.length) { job.done = true; return true; }
  }
  const { q } = job;
  const { nav, layout: L } = q;
  const log = q.log ?? null;
  let used = 0;
  while (job.i < job.scored.length && job.tries < 10) {
    const cur = job.scored[job.i];
    const { s } = cur;
    // [UI fix r3] a front runner the follow scorer never probed for foreground clutter (it only probes ITS top 12;
    // the occluder terms here reorder the list): a wall / jamb / pillar filling half the frame (demo: onyx framed past
    // the lobby wall) costs what follow.ts would have charged, then the list re-ranks
    if (s.clutter === undefined && !s.clutProbed) {
      s.clutProbed = true;
      const cl = lensClutter(c.W, job.level, s, c.a);
      s.clutter = cl;
      if (cl > 0) {
        cur.sc -= FOLLOW.w.clutter * cl + (cl > 2 && s.clear !== false ? GOTO.unclear : 0);
        const rest = job.scored.slice(job.i).sort((x, y) => y.sc - x.sc);
        job.scored.splice(job.i, rest.length, ...rest);
        continue;
      }
    }
    // [UI fix r2] the live rig's eyes, projected from this very pose: a walk-up front runner that doesn't show both
    // eyes is demoted (tier 0 → 1 → 2) and the rest re-ranked, never reported as a face + screen view
    if (q.validate && s.tier != null && !s.validated) {
      s.validated = true;
      let v: { n: number; good: number } | null = null;
      try { v = q.validate({ x: s.x, y: s.y, z: s.z, yaw: s.yaw ?? NaN, pitch: s.pitch ?? NaN, fov: s.fov ?? WALKUP.fovBase }); } catch (err) { logErr(err); }
      if (v) {
        s.eyesLive = v.n; s.eyesGoodLive = v.good;
        const nt = Math.max(s.tier, v.good >= 2 ? 0 : v.n >= 1 ? 1 : 2);
        if (nt !== s.tier) {
          cur.sc -= WALKUP.tierGap * (nt - s.tier);
          s.tier = nt;
          const rest = job.scored.slice(job.i).sort((x, y) => y.sc - x.sc);
          job.scored.splice(job.i, rest.length, ...rest);
          continue;
        }
      }
    }
    let route: Route | null = null;
    if (nav?.route && q.from) {
      if (used >= budget) return false;
      used++; job.routes++;
      try { route = nav.route({ x: q.from.x, z: q.from.z, level: q.from.level ?? 0 }, { x: s.x, z: s.z, level: job.level }, { owner: '*' }); } catch (err) { logErr(err); route = null; }
      job.tries++;
      if (!route) { job.i++; if (log) log.push(`${s.x.toFixed(2)},${s.z.toFixed(2)} ✗ unreachable`); continue; } // unreachable pocket
    }
    const floor = L?.floorY ? L.floorY(s.x, s.z, job.level) : job.ay;
    if (log) log.push(...job.scored.slice(0, 12).map(({ s: c, sc: v }) => `${c.x.toFixed(2)},${c.z.toFixed(2)} r${c.r} ${v.toFixed(0)} fg${c.fg} cl${c.clutter} rp${c.rope?.toFixed(1)} po${c.propOcc?.face ?? '-'}/${c.propOcc?.body ?? '-'} bo${c.bodyOcc?.face?.toFixed?.(2) ?? '-'} mw${c.mouthWorld ? 1 : 0} fgd${c.fgDesk ?? '-'} ai${c.aisle ? 1 : 0} cf${c.cf}/${c.cfLive} eyes${c.eyes}/${c.eyesLive ?? '-'} good${c.eyesGood}/${c.eyesGoodLive ?? '-'} mon${c.mon} mh${c.monHidden} face${c.faceOk ? 1 : 0} cov${c.cover} t${c.tier} w${c.wall}`));
    job.result = { x: s.x, y: floor, z: s.z, level: job.level, yaw: s.yaw ?? NaN, pitch: Math.max(s.tier != null ? WALKUP.pitchMin : -0.45, Math.min(0.2, s.pitch ?? NaN)), score: cur.sc, why: s.wall ? `body:${s.wall}` : 'clear', cf: s.cf, mon: s.mon,
      ...(s.tier != null ? { tier: s.tier, cfLive: s.cfLive, monHidden: s.monHidden, faceOk: s.faceOk, cover: s.cover, eyes: s.eyesLive ?? s.eyes, eyesGood: s.eyesGoodLive ?? s.eyesGood, eyesPred: s.eyes, fov: s.fov } : {}), ...(route ? { route } : {}) };
    job.done = true;
    return true;
  }
  job.done = true;
  return true;
}

/**
 * The walk-up lens for a desk spot `d` m from the agent: the 60° lens at ≥ WALKUP.frameDist, wider nearer so the frame
 * shows as much as the 60° lens would from frameDist (≤ fovMax). Degrees, vertical.
 */
export function walkUpFov(d: number): number {
  const t = Math.tan((WALKUP.fovBase * Math.PI) / 360) * WALKUP.frameDist / Math.max(0.5, d);
  return Math.min(WALKUP.fovMax, Math.max(WALKUP.fovBase, (Math.atan(t) * 360) / Math.PI));
}

/**
 * Predicted eye points of a seated / standing face (face.ts: EYE_X ±0.145, a little above the face centre), each with
 * the face plate's normal (the slot facing: CHR's walk-up turn is not credited). 
 */
export function predictEyes(face: Face, faceYaw: number): Eye[] {
  const fx = -Math.sin(faceYaw), fz = -Math.cos(faceYaw), rx = -fz, rz = fx;
  return [-1, 1].map((sd) => ({ x: face.x + rx * WALKUP.eyeX * sd + fx * 0.05, y: face.y + WALKUP.eyeDy, z: face.z + rz * WALKUP.eyeX * sd + fz * 0.05, nx: fx, ny: 0, nz: fz }));
}

/**
 * Where point p lands in the frame of pose {x, y, z (the eye), yaw, pitch}: NDC {x, y} (±1 = the frame edge) or
 * null behind the lens. Same camera convention as maxCover (forward = −sin yaw, −cos yaw).
 */
export function frameNdc(pose: LensPose, p: Vec3, fovV: number = WALKUP.fovV, aspect: number = WALKUP.aspect): { x: number; y: number } | null {
  const sy = Math.sin(pose.yaw), cy = Math.cos(pose.yaw), sp = Math.sin(pose.pitch ?? 0), cp = Math.cos(pose.pitch ?? 0);
  const vx = p.x - pose.x, vy = p.y - pose.y, vz = p.z - pose.z;
  const fz = -vx * sy * cp + vy * sp - vz * cy * cp;
  if (fz < 0.05) return null;
  const ty = Math.tan((fovV * Math.PI) / 360), tx = ty * aspect;
  return { x: (vx * cy - vz * sy) / fz / tx, y: (vx * sy * sp + vy * cp + vz * cy * sp) / fz / ty };
}

/**
 * Screen-space eye check (reviewer [art]: "tier 0 by facing math" showed the back of the head): per eye — inside the
 * frame (|ndc| ≤ WALKUP.eyeNdc), its plate turned to the lens (cos ≥ eyeMinDot), and a free line to the lens (the
 * monitor panel, other bodies, world geometry). → {n: eyes that read (cos ≥ eyeMinDot), good: of those at cos ≥
 * eyeGoodDot (a face, not a profile), inFrame, facing, hidden}.
 */
export interface EyesOpts { M?: MonitorPlane | null; others?: readonly BodyActor[]; W?: FollowWorld | null; level?: number; fovV?: number; aspect?: number }
export function eyesView(pose: LensPose, eyes: readonly Eye[] | null | undefined, o: EyesOpts = {}) {
  let n = 0, good = 0, inFrame = 0, facing = 0, hidden = 0;
  for (const e of eyes ?? []) {
    const p = frameNdc(pose, e, o.fovV, o.aspect);
    const inF = !!p && Math.abs(p.x) <= WALKUP.eyeNdc && Math.abs(p.y) <= WALKUP.eyeNdc;
    const lx = pose.x - e.x, ly = pose.y - e.y, lz = pose.z - e.z, ll = Math.hypot(lx, ly, lz) || 1;
    const dot = (lx * e.nx + ly * e.ny + lz * e.nz) / ll;
    const face = dot >= WALKUP.eyeMinDot;
    let hid = false;
    if (inF && face) {
      if (o.M && segHitsMonitor(o.M, pose.x, pose.y, pose.z, e.x, e.y, e.z)) hid = true;
      if (!hid) for (const b of o.others ?? []) if (segHitsBody(pose.x, pose.y, pose.z, e.x, e.y, e.z, b.pos.x, b.pos.z, b.pos.y ?? 0, bodyTop({ pos: b.pos, seated: bodySeated(b) }))) { hid = true; break; }
      if (!hid && o.W && worldBlocked(o.W, o.level ?? 0, pose.x, pose.y, pose.z, e.x, e.y, e.z, 0.05)) hid = true;
    }
    inFrame += inF ? 1 : 0; facing += face ? 1 : 0; hidden += hid ? 1 : 0;
    if (inF && face && !hid) { n++; if (dot >= WALKUP.eyeGoodDot) good++; }
  }
  return { n, good, inFrame, facing, hidden };
}

/**
 * One-shot stand spot (all reachability searches at once).
 */
export function pickStand(q: StandQuery): Stand | null {
  const job = standBegin(q);
  standStep(job);
  return job.result;
}

/** 2D distance from point (px, pz) to the segment (ax, az) → (bx, bz). */
export function segNearPoint(ax: number, az: number, bx: number, bz: number, px: number, pz: number): number {
  const ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez;
  const u = L2 > 1e-9 ? Math.max(0, Math.min(1, ((px - ax) * ex + (pz - az) * ez) / L2)) : 0;
  return Math.hypot(ax + ex * u - px, az + ez * u - pz);
}

/**
 * Desk walk-up candidates as follow-scorer polar spots {th, r, h} (th: bearing agent → lens, 0 = +z): a 0.1 m grid in
 * the agent's face frame, `along` (toward its monitor) × ±`lateral`, inside WALKUP.deskMin..2.4 m, plus a polar ring
 * (32 bearings × 1.6 / 2.0 / 2.4 m) as the fallback. ≈ 700 spots (one follow pass ≈ 5–10 ms, once per G / focus).
 */
export function deskGrid(pos: Pt, faceYaw: number, eyeH: number): Cand[] {
  const fx = -Math.sin(faceYaw), fz = -Math.cos(faceYaw), rx = -fz, rz = fx;
  const out: Cand[] = [];
  const [a0, a1] = WALKUP.gridAlong, [l0, l1] = WALKUP.gridLateral, st = WALKUP.gridStep;
  for (let al = a0; al <= a1 + 1e-6; al += st) {
    for (let la = l0; la <= l1 + 1e-6; la += st) {
      for (const sg of [-1, 1]) {
        const dx = fx * al + rx * la * sg, dz = fz * al + rz * la * sg, r = Math.hypot(dx, dz);
        if (r < WALKUP.deskMin - 1e-6 || r > 2.4 + 1e-6) continue;
        out.push({ th: Math.atan2(dx, dz), r: +r.toFixed(3), h: eyeH });
      }
    }
  }
  for (let k = 0; k < 32; k++) for (const r of [1.6, 2.0, 2.4]) out.push({ th: (k / 32) * Math.PI * 2, r, h: eyeH });
  return out;
}

/**
 * The seated face's live facing toward the lens (cos) once CHR's walk-up face turn has run (animator.ts FACE_TURN
 * 0.44 rad toward a player ≤ 2 m, full at ≤ 1.5 m, not from behind > 140°): cf is the slot facing, cfLive what shows.
 */
export function liveFacing(cf: number, dist: number): number {
  const th = Math.acos(Math.max(-1, Math.min(1, cf)));
  if (th > WALKUP.turnBehind || dist >= WALKUP.turnNear) return cf;
  const w = Math.min(1, (WALKUP.turnNear - dist) / (WALKUP.turnNear - WALKUP.turnFull));
  return Math.cos(Math.max(0, th - WALKUP.turn * w));
}

/** Is an actor settled in a seat (its body capsule is the short, seated one)? */
export const bodySeated = (b: BodyActor | null | undefined): boolean => !!b?.arrived && (b.intent?.slot?.pose ?? b.slot?.pose ?? 'stand') === 'sit';

/**
 * Does the 3D segment A → B pass through a body capsule (vertical cylinder of radius r from y0 up to y1 at (px, pz))?
 * 2D closest approach, then the segment's height there.
 */
export function segHitsBody(ax: number, ay: number, az: number, bx: number, by: number, bz: number, px: number, pz: number, y0: number, y1: number, r: number = WALKUP.bodyR): boolean {
  const ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez;
  const u = L2 > 1e-9 ? Math.max(0, Math.min(1, ((px - ax) * ex + (pz - az) * ez) / L2)) : 0;
  if (Math.hypot(ax + ex * u - px, az + ez * u - pz) >= r) return false;
  const y = ay + (by - ay) * u;
  return y >= y0 && y <= y1;
}
const bodyTop = (b: Body): number => (b.pos.y ?? 0) + (b.seated ? WALKUP.seatedTop : WALKUP.standTop);

/**
 * Fraction (0..1) of the desk screen hidden by bodies from the lens s: centre + both edges (0.4 w off centre), each a
 * line to the lens tested against every body capsule (the agent's own first). 0 = the whole screen reads.
 * `bodies`: r = capsule radius, default WALKUP.bodyR; the sitter's own, turned body: ownR.
 */
export function screenBodyHidden(M: MonitorPlane, s: Vec3, bodies: readonly Body[]): number {
  const tx = M.nz, tz = -M.nx; // along the screen's width
  let hit = 0;
  for (const k of [0, -0.4, 0.4]) {
    const px = M.x + tx * M.w * k, pz = M.z + tz * M.w * k;
    if (bodies.some((b) => segHitsBody(s.x, s.y, s.z, px, M.y, pz, b.pos.x, b.pos.z, b.pos.y ?? 0, bodyTop(b), b.r))) hit++;
  }
  return hit / 3;
}

/**
 * Eyes or mouth hidden from the lens: behind the monitor panel, or behind another actor's body (reviewer [art]:
 * score face visibility above distance).
 */
export function faceOccluded(M: MonitorPlane | null, s: Vec3, face: Face, others: readonly BodyActor[]): boolean {
  for (const dy of [0.06, -0.07]) {
    const fy = face.y + dy;
    if (M && segHitsMonitor(M, s.x, s.y, s.z, face.x, fy, face.z)) return true;
    for (const b of others) {
      const seated = bodySeated(b);
      if (segHitsBody(s.x, s.y, s.z, face.x, fy, face.z, b.pos.x, b.pos.z, b.pos.y ?? 0, bodyTop({ pos: b.pos, seated }))) return true;
    }
  }
  return false;
}

/**
 * Largest share of the frame (0..1) one other actor covers from pose s = {x, y, z, yaw, pitch} (its body as a
 * WALKUP.bodyR-wide box up to its crown, projected into a WALKUP.fovV / aspect frustum). Reviewer [art]: a neighbour
 * filled ≈ 40 % of goto-working-claude; > WALKUP.maxCover drops the spot out of tier 0/1.
 */
export function maxCover(s: LensPose, others: readonly BodyActor[]): number {
  const sy = Math.sin(s.yaw), cy = Math.cos(s.yaw), sp = Math.sin(s.pitch ?? 0), cp = Math.cos(s.pitch ?? 0);
  const f = [-sy * cp, sp, -cy * cp], r = [cy, 0, -sy], u = [sy * sp, cp, cy * sp];
  const ty = Math.tan((WALKUP.fovV * Math.PI) / 360), tx = ty * WALKUP.aspect;
  let best = 0;
  for (const b of others) {
    const st = bodySeated(b);
    const top = bodyTop({ pos: b.pos, seated: st }) - (b.pos.y ?? 0) + (st ? WALKUP.hatTop : 0); // [UI fix r3] its hat too
    const v = [b.pos.x - s.x, (b.pos.y ?? 0) + top / 2 - s.y, b.pos.z - s.z];
    const fz = v[0] * f[0] + v[1] * f[1] + v[2] * f[2];
    if (fz < 0.2) continue;
    const x = (v[0] * r[0] + v[2] * r[2]) / fz, y = (v[0] * u[0] + v[1] * u[1] + v[2] * u[2]) / fz;
    const hw = WALKUP.bodyR / fz, hh = top / 2 / fz;
    const w = Math.max(0, Math.min(tx, x + hw) - Math.max(-tx, x - hw)), h = Math.max(0, Math.min(ty, y + hh) - Math.max(-ty, y - hh));
    best = Math.max(best, (w * h) / (4 * tx * ty));
  }
  return best;
}

/** Distance from (x, z) to a polyline of {x, z} points. */
export function polyDist(pts: readonly Pt[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[i + 1] ?? p;
    const ex = q.x - p.x, ez = q.z - p.z, L2 = ex * ex + ez * ez;
    const u = L2 > 1e-9 ? Math.max(0, Math.min(1, ((x - p.x) * ex + (z - p.z) * ez) / L2)) : 0;
    best = Math.min(best, Math.hypot(p.x + ex * u - x, p.z + ez * u - z));
  }
  return best;
}

/** Rope runs + stanchion posts as 2D segments / points (world), cached per layout. */
let ropeL: Lay = null, ropeC: Ropes | null = null;
export function ropeSegs(L: Lay): Ropes | null {
  if (L === ropeL) return ropeC;
  ropeL = L;
  // a run is a Rect tuple in the schema; the {x0, z0, x1, z1} object form is still accepted (older layouts / test fixtures)
  const runs: readonly (Rect | { x0: number; z0: number; x1: number; z1: number })[] = L?.queueRopes ?? [];
  const segs = runs.map((r): [number, number, number, number] => (Array.isArray(r) ? [r[0], r[1], r[2], r[3]] : [r.x0, r.z0, r.x1, r.z1]));
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
 * Foreground rope / stanchion clutter for a stand spot looking at `a` (0 = none): fan `GOTO.ropeRays` across the
 * view and sum, per ray that meets a rope run or post within `ropeReach` (and in front of the agent), how near it is
 * (1 at the lens → 0 at the reach): a rope a step in front of you fills the lower frame; one 2 m off is scenery. A post
 * inside the view (± postHalfFov) within the reach adds postW × nearness. Plain 2D; cheap (≤ 7 rays × ~15 segments).
*/
export function ropeClutter(R: Ropes | null, s: { x: number; z: number; yaw: number }, a: { pos: Pt }): number {
  if (!R || (!R.segs.length && !R.posts.length)) return 0;
  const dA = Math.hypot(a.pos.x - s.x, a.pos.z - s.z);
  const reach = Math.min(GOTO.ropeReach, dA - 0.35);
  if (reach <= 0.1) return 0;
  let sum = 0;
  for (const deg of GOTO.ropeRays) {
    const yy = s.yaw + (deg * Math.PI) / 180;
    const dx = -Math.sin(yy), dz = -Math.cos(yy);
    let t = Infinity;
    for (const g of R.segs) t = Math.min(t, raySeg(s.x, s.z, dx, dz, g[0], g[1], g[2], g[3]));
    if (t < reach) sum += 1 - t / reach; // 1 at the lens → 0 at the reach
  }
  // posts: a 0.9 m bar a step from the lens is a big vertical slab anywhere in the frame (it slipped between rays)
  const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
  for (const p of R.posts) {
    const px = p[0] - s.x, pz = p[1] - s.z;
    const along = px * fx + pz * fz;
    if (along <= 0.05 || along >= reach) continue;
    if (Math.abs(Math.atan2(px * fz - pz * fx, along)) < GOTO.postHalfFov) sum += GOTO.postW * (1 - along / reach);
  }
  return sum;
}

/** follow.ts addClutter's probe (FG_RAYS: [yaw, pitch] degrees off the view axis), for spots it never probed. */
const FG_PROBE = ([[-24, -10], [-12, -10], [12, -10], [24, -10], [-24, 8], [-12, 8], [12, 8], [24, 8], [-30, 0], [30, 0]] as const).map(([h, v]): [number, number] => [(h * Math.PI) / 180, (v * Math.PI) / 180]);
/** Rays (of 10) from lens s that hit world geometry within FOLLOW.clutterReach (short of the agent a). */
export function lensClutter(W: FollowWorld | null | undefined, level: number, s: { x: number; y: number; z: number; yaw?: number; pitch?: number }, a: { pos: Pt }): number {
  const reach = Math.min(FOLLOW.clutterReach, Math.hypot(a.pos.x - s.x, a.pos.z - s.z) - 0.45);
  if (!W || reach <= 0.2 || s.yaw == null) return 0;
  let n = 0;
  for (const [h, v] of FG_PROBE) {
    const yy = s.yaw + h, pp = (s.pitch ?? 0) + v, cp = Math.cos(pp);
    if (worldBlocked(W, level, s.x, s.y, s.z, s.x - Math.sin(yy) * cp * reach, s.y + Math.sin(pp) * reach, s.z - Math.cos(yy) * cp * reach)) n++;
  }
  return n;
}

/**
 * [UI fix r3] Desk-set clutter points of a layout (world): per desk its monitor (centre + both edges), the lamp /
 * book spot, the keyboard, the desk-top corners; per chair its seat and backrest top. Same desk-local placement as
 * the bays' dressing (bays.ts: local(p, x, y, z) with the three rotation.y convention). Cached per layout.
 */
let clutL: Lay = null, clutC: ClutterPt[] = [];
export function clutterPts(L: Lay): ClutterPt[] {
  if (L === clutL) return clutC;
  clutL = L; clutC = [];
  for (const f of L?.furniture ?? []) {
    const cs = Math.cos(f.yaw ?? 0), sn = Math.sin(f.yaw ?? 0), y0 = f.pos.y ?? 0;
    const at = (lx: number, ly: number, lz: number, w: number, desk: string | null) => clutC.push({ x: f.pos.x + lx * cs + lz * sn, y: y0 + ly, z: f.pos.z - lx * sn + lz * cs, w, desk });
    if (f.type === 'desk') {
      const { m, agentX, monitor: mon } = deskLocal(f);
      const [w, h, d] = f.size ?? [DESK.w, DESK.h, DESK.d];
      const my = h + DESK.monitor.lift + DESK.monitor.h / 2;
      for (const k of [0, -0.5, 0.5]) at(mon.x + k * DESK.monitor.w * Math.cos(mon.twist), my, mon.z - k * DESK.monitor.w * Math.sin(mon.twist), 1, f.id);
      at(m * 0.44, h + 0.28, -0.2, 0.8, f.id);          // desk lamp / book stack / succulent
      at(agentX + m * 0.06, h + 0.03, 0.12, 0.5, f.id); // keyboard
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) at(sx * w / 2, h, sz * d / 2, 0.45, f.id);
    } else if (f.type === 'chair') {
      at(0, 0.36, 0, 0.6, `chair:${f.id}`);
      at(0, DESK.chairBack + 0.3, DESK.back.z, 0.7, `chair:${f.id}`);
    }
  }
  return clutC;
}

/** The clutter points within 3.6 m of the target, minus its own desk and its own chair (the nearest one ≤ 0.9 m). */
export function nearClutter(L: Lay, pos: Pt, ownDesk: string): ClutterPt[] {
  const all = clutterPts(L);
  let ownChair: string | null = null, bd = 0.9;
  for (const p of all) {
    if (!p.desk?.startsWith('chair:')) continue;
    const d = Math.hypot(p.x - pos.x, p.z - pos.z);
    if (d < bd) { bd = d; ownChair = p.desk; }
  }
  return all.filter((p) => p.desk !== ownDesk && p.desk !== ownChair && Math.hypot(p.x - pos.x, p.z - pos.z) < 3.6);
}

/**
 * Near-foreground clutter of spot s (lens {x, y, z, yaw, pitch}) at vertical fov `fov`: Σ weight × nearness over the
 * clutter points within WALKUP.fgReach of the lens that project into the frame's lower half (a slab of monitor, a
 * lamp, a chair back filling the bottom of the shot). 0 = a clean foreground.
 */
export function fgClutter(pts: readonly ClutterPt[], s: LensPose, fov: number = WALKUP.fovBase): number {
  let sum = 0;
  for (const p of pts) {
    const d = Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z);
    if (d >= WALKUP.fgReach) continue;
    const n = frameNdc(s, p, fov);
    if (!n || Math.abs(n.x) > 1.15 || n.y > WALKUP.fgNdcY || n.y < -1.4) continue;
    sum += p.w * (1 - d / WALKUP.fgReach);
  }
  return sum;
}

/** World direction (unit {x, z}) from a desk toward its aisle: desk-local −m·x (the side its sitter shifts to). */
export function aisleDir(L: Lay, deskId: string): Pt | null {
  const f = (L?.furniture ?? []).find((q) => q.id === deskId && q.type === 'desk');
  if (!f) return null;
  const { m } = deskLocal(f);
  const cs = Math.cos(f.yaw ?? 0), sn = Math.sin(f.yaw ?? 0);
  return { x: -m * cs, z: m * sn };
}

/** Is spot s beside the chair on the aisle side (WALKUP.aisleMin sideways, within aisleAlong of the facing)? */
export function aisleSide(dir: Pt | null, pos: Pt, faceYaw: number, s: Pt): boolean {
  if (!dir) return false;
  const dx = s.x - pos.x, dz = s.z - pos.z;
  const lat = dx * dir.x + dz * dir.z;
  const along = dx * -Math.sin(faceYaw) + dz * -Math.cos(faceYaw);
  return lat >= WALKUP.aisleMin && along >= WALKUP.aisleAlong[0] && along <= WALKUP.aisleAlong[1];
}

/**
 * Does world geometry (another desk's monitor box, a lamp post…) hide the mouth from the lens? The target's own
 * monitor box is left out (its panel is segHitsMonitor's job, eyes + mouth, in faceOccluded).
 */
export function mouthWorldHidden(L: Lay, W: FollowWorld, level: number, s: Vec3, face: Face, M: Monitor | null | undefined): boolean {
  let Wm: FollowWorld | undefined = W;
  if (M) {
    let per = scrCache.get(W);
    if (!per) { per = new Map(); scrCache.set(W, per); }
    Wm = per.get(M.desk);
    if (!Wm) { Wm = { ...W, furn: W.furn.filter((f) => !(f.type === 'monitor' && f.desk === M.desk)) }; per.set(M.desk, Wm); }
  }
  return !!worldBlocked(Wm, level, s.x, s.y, s.z, face.x, face.y + WALKUP.mouthDy, face.z, 0.05);
}

/** Height of the sightline lens s → target at plan parameter u (0 lens … 1 target), for a target height ty. */
const lineY = (s: { y: number }, ty: number, u: number): number => s.y + (ty - s.y) * u;
/** Plan parameter u (along lens → (tx, tz)) where it crosses rope run g, or -1. */
function crossU(s: Pt, tx: number, tz: number, g: readonly number[]): number {
  const dx = tx - s.x, dz = tz - s.z, ex = g[2] - g[0], ez = g[3] - g[1];
  const den = dx * ez - dz * ex;
  if (Math.abs(den) < 1e-9) return -1;
  const u = ((g[0] - s.x) * ez - (g[1] - s.z) * ex) / den;
  const v = ((g[0] - s.x) * dz - (g[1] - s.z) * dx) / den;
  return u > 0.02 && u < 0.97 && v >= 0 && v <= 1 ? u : -1;
}

/**
 * [UI fix r3, playtest hq-04-goto-b] Queue ropes and stanchion posts in front of the target's face / body, as seen
 * from lens s. A rope crosses the face when, where the view to the face meets the run in plan, the rope's height
 * (floor + OCCL.ropeY − sag) lies between the sightlines to the top and the bottom of the face; a post covers it when
 * the view passes within its radius below its top. → {face: 0..1, body: 0..1} (1 = fully crossed).
 */
export function propOcclusion(R: Ropes | null, L: Lay, level: number, s: Vec3, face: Face, ay: number): { face: number; body: number } {
  const out = { face: 0, body: 0 };
  if (!R || (!R.segs.length && !R.posts.length)) return out;
  const fTop = face.y + OCCL.faceTop, fBot = face.y + OCCL.faceBot, bBot = ay + 0.12;
  const floorAt = (x: number, z: number): number => (L?.floorY ? L.floorY(x, z, level) : ay);
  for (const g of R.segs) {
    const u = crossU(s, face.x, face.z, g);
    if (u < 0) continue;
    const px = s.x + (face.x - s.x) * u, pz = s.z + (face.z - s.z) * u;
    const t = Math.max(0, Math.min(1, Math.hypot(px - g[0], pz - g[1]) / (Math.hypot(g[2] - g[0], g[3] - g[1]) || 1)));
    const ry = floorAt(px, pz) + OCCL.ropeY - OCCL.ropeSag * 4 * t * (1 - t);
    if (ry <= lineY(s, fTop, u) && ry >= lineY(s, fBot, u)) out.face = 1;
    else if (ry <= lineY(s, fBot, u) && ry >= lineY(s, bBot, u)) out.body = Math.max(out.body, 0.1); // a rope across the legs: mild (any view from outside the lane has one)
  }
  const ex = face.x - s.x, ez = face.z - s.z, L2 = ex * ex + ez * ez || 1;
  for (const p of R.posts) {
    const u = Math.max(0, Math.min(1, ((p[0] - s.x) * ex + (p[1] - s.z) * ez) / L2)); // closest approach
    if (u <= 0.02 || u >= 0.97) continue;
    // the face (≈ 0.44 m wide) / body (0.72 m) seen at the post's depth: u × half-width, plus the post itself
    const d = segNearPoint(s.x, s.z, face.x, face.z, p[0], p[1]);
    const fw = OCCL.faceHalfW * u + OCCL.postR, bw = OCCL.bodyHalfW * u + OCCL.postR;
    if (d >= bw) continue;
    const top = floorAt(p[0], p[1]) + OCCL.postH;
    // a thin pole off to one side is scenery; one dead centre (the playtest's) is the problem
    if (d < fw && top >= lineY(s, fBot, u)) out.face = Math.max(out.face, d < fw * 0.5 && top >= lineY(s, face.y, u) ? 1 : 0.2);
    if (top >= lineY(s, bBot, u)) out.body = Math.max(out.body, d < bw * 0.35 ? 1 : 0.15); // a post in front of the body
  }
  return out;
}

/**
 * [UI fix r3] Other characters' bodies (hats included) in front of the target's face (eyes, face centre, mouth) and
 * body (belly, chest): share of the sample lines hidden. {face: 0..1, body: 0..1}.
 */
export function bodyOcclusion(s: Vec3, face: Face, ay: number, others: readonly BodyActor[]): { face: number; body: number } {
  const out = { face: 0, body: 0 };
  if (!others?.length) return out;
  const fys = [face.y + 0.06, face.y, face.y + WALKUP.mouthDy], bys = [ay + 0.3, (ay + face.y) / 2];
  const hits = (ty: number): boolean => {
    for (const b of others) {
      const st = bodySeated(b);
      if (segHitsBody(s.x, s.y, s.z, face.x, ty, face.z, b.pos.x, b.pos.z, b.pos.y ?? 0, bodyTop({ pos: b.pos, seated: st }) + (st ? WALKUP.hatTop : 0), OCCL.otherR)) return true;
    }
    return false;
  };
  for (const y of fys) if (hits(y)) out.face += 1 / fys.length;
  for (const y of bys) if (hits(y)) out.body += 1 / bys.length;
  return out;
}

/**
 * Where "go there" should look for a walking agent (reviewer m2-r3 [gameplay]): the slot it is walking to (a blocked
 * agent's Help Desk queue place, its desk…), not where it happens to be when G is pressed. A settled / standing-still
 * agent is itself. Returns a stand-in `{id, pos, yaw, dest}` (dest = the slot id) or the actor.
 */
export interface Dest { id: string; pos: { x: number; y: number; z: number }; yaw: number | undefined; level: number; dest: string; slot: StandSlot; route: Pt[] }
export function destOf<A extends StandActor | null | undefined>(a: A): A | Dest {
  const sl = a?.intent?.slot;
  if (!a || !sl?.pos || a.arrived) return a;
  if (Math.hypot(sl.pos.x - a.pos.x, sl.pos.z - a.pos.z) < 0.5) return a;
  // the rest of its walk (to keep the stand point off it); the last 1.2 m into the seat doesn't count
  const route: Pt[] = [{ x: a.pos.x, z: a.pos.z }];
  const P = Array.isArray(a.path) ? a.path : [];
  for (let i = Math.max(0, a.pathI ?? 0); i < P.length; i++) route.push({ x: P[i].x, z: P[i].z });
  while (route.length > 1 && Math.hypot(route[route.length - 1].x - sl.pos.x, route[route.length - 1].z - sl.pos.z) < 1.2) route.pop();
  return { id: a.id, pos: { x: sl.pos.x, y: sl.pos.y ?? a.pos.y ?? 0, z: sl.pos.z }, yaw: sl.yaw ?? a.yaw, level: sl.level ?? 0, dest: sl.id ?? 'slot', slot: sl, route };
}

/**
 * Pose track along a nav route: arc-length parametrised with an ease-in-out, looking along the walk and turning to the
 * final yaw / pitch over the last 40 %. `at(t)` (t ∈ 0..1) → [x, feetY, z, yaw, pitch].
 * `pts`: the route incl. both ends; `from` / `to`: [x, y, z, yaw, pitch].
 */
export function glidePath(pts: readonly RoutePt[] | null | undefined, from: readonly number[], to: readonly number[], floorY?: (x: number, z: number, level: number) => number) {
  const P = (pts && pts.length >= 2 ? pts : [{ x: from[0], z: from[2] }, { x: to[0], z: to[2] }]).map((p) => ({ x: p.x, z: p.z, level: p.level ?? 0 }));
  P[0] = { ...P[0], x: from[0], z: from[2] };
  P[P.length - 1] = { ...P[P.length - 1], x: to[0], z: to[2] };
  const cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z));
  const len = cum[cum.length - 1];
  const wrap = (x: number): number => Math.atan2(Math.sin(x), Math.cos(x));
  const ms = Math.min(GOTO.maxMs, Math.max(GOTO.minMs, len * GOTO.msPerM));
  const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const walkYaw = (i: number): number => { const a = P[Math.max(0, i - 1)], b = P[Math.max(1, i)]; return Math.hypot(b.x - a.x, b.z - a.z) > 1e-3 ? Math.atan2(-(b.x - a.x), -(b.z - a.z)) : from[3]; };
  return {
    len, ms, points: P,
    at(t: number): [number, number, number, number, number] {
      const k = ease(Math.min(1, Math.max(0, t)));
      const s = k * len;
      let i = 1;
      while (i < P.length - 1 && cum[i] < s) i++;
      const seg = cum[i] - cum[i - 1] || 1;
      const u = Math.min(1, Math.max(0, (s - cum[i - 1]) / seg));
      const x = P[i - 1].x + (P[i].x - P[i - 1].x) * u, z = P[i - 1].z + (P[i].z - P[i - 1].z) * u;
      const lv = u < 0.5 ? P[i - 1].level : P[i].level;
      const y = k >= 1 ? to[1] : floorY ? floorY(x, z, lv) : from[1] + (to[1] - from[1]) * k;
      // yaw: start → along the walk → final; a short hop (< 2.5 m) just turns
      const wy = len > 2.5 ? walkYaw(i) : to[3];
      const a0 = Math.min(1, k / 0.25), a1 = Math.max(0, (k - 0.6) / 0.4);
      let yaw = from[3] + wrap(wy - from[3]) * a0;
      yaw += wrap(to[3] - yaw) * a1;
      const pitch = from[4] + (to[4] - from[4]) * k;
      return [x, y, z, yaw, pitch];
    },
  };
}

/** Narrow the go-there controller's opaque job handle back to the search this module started. */
export const isStandJob = (j: GoStandJob): j is StandJob => 'phase' in j;
/** Narrow the controller's stand handle back to the spot `standStep` produced. */
export const isStand = (s: GoStand): s is Stand => 'pitch' in s && 'y' in s;
