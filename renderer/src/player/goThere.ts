// @pure
/**
 * "Go there" camera helpers (PLY m3 fix r1; reviewer m3-r1 [playtest]: going to gale, who was playing ping-pong in
 * the Café, ended facing a bunk in the Nap Nook / in an Engine Room corridor, with the aim hint stuck on
 * "E finding a spot…" for 7 s+). UI's go-there (ui/index.ts + ui/goto.ts) calls these; the camera side is PLY's:
 *  - `goDest(a, destOf)`: frame the slot an agent walks to only when its walk really ends there. A social gig (a
 *    ping-pong rally, a coffee run, a summon) moves the body while `intent.slot` keeps its chill pick (the bunk it will
 *    nap in later): then the agent itself is the target.
 *  - `movedFar(track, target)`: re-target when the framed point moved more than GO.retargetM since the last search.
 *  - `faceTurn(pose, a)`: the final turn that puts the agent's face on the view axis (null when it already is).
 *  - `hintDue(t0, now)`: the "finding a spot…" hint's lifetime (it is cleared on arrival, and never outlives this).
 * PLY m3 fix r2 (reviewer m3-r2 [playtest] 29-map-dev-5 / 12-now: go-there landed on the agent's own empty seat, or
 * with the agent behind a bookcase and the lens facing the other way):
 *  - `slotChanged(track, a)`: ANY change of the agent's slot re-targets (not only moves > GO.retargetM); the UI then
 *    follows the walker and walks up once it settles, instead of parking the lens at the far slot ahead of it.
 *  - `noteSeat` / `keepOffFor` / `keptOff`: never a stand spot on the agent's own seat (the one it is leaving, or any
 *    seat it held since the go-there began), nor on its body while the target is the slot it walks to.
 *  - `faceHidden(W, level, pose, a)`: line of sight from the lens to the agent's face (the follow world: walls,
 *    tall furniture); checked on arrival and while the go-there watches, a hidden face searches again.
 *  - `trailNote` / `trailHit`: the office map's recent agent positions. 29-map-dev-5 was a map click where dev's dot
 *    had just been: no dot under the cursor → a floor walk to exactly its old seat (11.65, 0.10). A click on a spot an
 *    agent left < GO.trailMs ago now goes to that agent.
 *  - `floorSpot(x, z, q)`: a floor walk never ends on a seat (or off the walkable floor): nearest clear spot.
 * The go-there state machine that drives these is goThereCtl.ts (PLY m3 fix r3; ui/index.ts only wires it).
 * No three.js (node-testable). Owner: PLY.
 */
import { worldBlocked, FOLLOW } from './follow.ts';
import type { FollowActor, FollowWorld } from './follow.ts';

/** The slot an agent's intent points at (only what go-there reads). */
export interface GoSlot { id?: string; tag?: string; pose?: string; pos: { x: number; y?: number; z: number } }
/** An actor as go-there sees it: its route and intent on top of the follow scorers' view. */
export interface GoActor extends FollowActor {
  arrived?: boolean;
  /** walking somewhere (not just shuffling on the spot) */
  moving?: boolean;
  path?: { x: number; z: number }[] | null;
  pathI?: number;
  intent?: { slot?: GoSlot | null } | null;
  settledSlot?: { pos?: { x: number; z: number } } | null;
}
/** [x, feetY, z, yaw, pitch] */
export type PoseArr = readonly [number, number, number, number, number];
/** A remembered seat (`noteSeat`): where, and when it was last held (ms). */
export interface SeatMemo { x: number; z: number; t: number }
/** A keep-off circle for the stand search. */
export interface KeepOff { x: number; z: number; r?: number }

export const GO = Object.freeze({
  retargetM: 2.0,     // m the framed point may move before the stand spot is searched again
  slotEndM: 1.5,      // m between the end of an agent's walk and its intent slot for the slot to count as "where it goes"
  faceTolDeg: 10,     // the agent's face this far off the view axis is fine (no final turn)
  pitchTolDeg: 12,
  faceY: { sit: 0.62, stand: 0.85 }, // face height above the feet
  eyeH: 1.2,
  hintMaxMs: 1500,    // the "finding a spot…" hint never stays longer than this
  maxRetargets: 12,
  trackMs: 14_000,    // a go-there re-aims at a deciding / walking agent this long after G (goThereCtl.ts track)
  // PLY m3 fix r2
  seatClear: 0.62,    // m: a stand spot keeps this far from the agent's own seats (= goto.ts actorClear)
  seatMemoMs: 300_000, // seats noted this long ago are forgotten
  seatMemoMax: 6,
  watchMs: 60_000,    // after landing, the untouched go-there keeps watching the agent this long (slot change / lost sight)
  losHoldMs: 400,     // the face must stay hidden this long before a new search (a walker passing a pillar is fine)
  maxLosSearches: 4,  // per go-there; then it hands over to the follow rig (which keeps the face in view)
  trailMs: 3000,      // office map: a click where an agent's dot was this recently goes to the agent
  trailStepMs: 200,
  trailPx: 14,        // = the map's dot hover radius
});

const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));

/**
 * Is `a` walking to its intent slot? true when it has no route yet (a fresh plan: it is about to), or its route ends
 * within GO.slotEndM of the slot; false when the route leads somewhere else (a gig) or it stands away from it.
 */
export function headingToSlot(a: GoActor | null | undefined): boolean {
  const sl = a?.intent?.slot;
  if (!sl?.pos || !a?.pos) return false;
  const P = Array.isArray(a.path) ? a.path : null;
  const walking = !a.arrived && P && (a.pathI ?? 0) < P.length;
  if (!walking || !P) return !a.arrived && !(P && P.length); // not moving: only a not-yet-planned walk counts
  const end = P[P.length - 1];
  return Math.hypot(end.x - sl.pos.x, end.z - sl.pos.z) <= GO.slotEndM;
}

/**
 * The go-there target: `destOf(a)` (UI goto.ts: the slot it walks to, with its remaining route) when the agent really
 * walks there, else the agent itself.
 */
export function goDest<A extends GoActor, T>(a: A, destOf: (a: A) => T): T | A {
  return headingToSlot(a) ? destOf(a) : a;
}

/** The point a go-there frames for target `t` ({pos}). */
export const targetPos = (t: { pos?: { x: number; z: number } } | null | undefined): { x: number; z: number } | null => (t?.pos ? { x: t.pos.x, z: t.pos.z } : null);

/**
 * Has the framed point moved far enough to search a new stand spot? `last` = the point the last search framed.
 */
export function movedFar(last: { x: number; z: number } | null, now: { x: number; z: number } | null): boolean {
  if (!last || !now) return false;
  return Math.hypot(now.x - last.x, now.z - last.z) > GO.retargetM;
}

/**
 * The final turn onto the agent's face: [x, feetY, z, yaw, pitch] = `pose` with yaw / pitch aimed at the face, or
 * null when the face is already within tolerance of the view axis (or the agent is on top of the camera).
 */
export function faceTurn(pose: PoseArr, a: Pick<FollowActor, 'pos'>, o: { seated?: boolean; eyeH?: number } = {}): [number, number, number, number, number] | null {
  if (!a?.pos || !pose) return null;
  const dx = a.pos.x - pose[0], dz = a.pos.z - pose[2], d = Math.hypot(dx, dz);
  if (d < 0.4) return null;
  const fy = (a.pos.y ?? 0) + (o.seated ? GO.faceY.sit : GO.faceY.stand);
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.max(-0.45, Math.min(0.2, Math.atan2(fy - (pose[1] + (o.eyeH ?? GO.eyeH)), d)));
  const off = Math.abs(wrap(yaw - pose[3])), offP = Math.abs(pitch - pose[4]);
  if (off <= (GO.faceTolDeg * Math.PI) / 180 && offP <= (GO.pitchTolDeg * Math.PI) / 180) return null;
  return [pose[0], pose[1], pose[2], pose[3] + wrap(yaw - pose[3]), pitch];
}

/** Is the "finding a spot…" hint (shown at t0) past its lifetime? */
export const hintDue = (t0: number, now: number): boolean => now - t0 >= GO.hintMaxMs;

/**
 * Has the agent's slot changed since the go-there framed it? `track.slotId` = the intent slot id at the last search.
 * Any id change counts (reviewer m3-r2: dev left its bench for the card table 1.96 m away, under GO.retargetM).
 */
export function slotChanged(track: { slotId?: string | null } | null | undefined, a: GoActor | null | undefined): boolean {
  const id = a?.intent?.slot?.id ?? null;
  return !!track && track.slotId !== undefined && id !== track.slotId;
}

/**
 * Remember the seats `a` holds (its settled slot, its intent slot once arrived) in `memo` (newest last); `now` in ms.
 */
export function noteSeat(memo: SeatMemo[], a: GoActor | null | undefined, now: number): SeatMemo[] {
  for (let i = memo.length - 1; i >= 0; i--) if (now - memo[i].t > GO.seatMemoMs) memo.splice(i, 1);
  const add = (p: { x: number; z: number } | null | undefined) => {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return;
    const hit = memo.find((m) => Math.hypot(m.x - p.x, m.z - p.z) < 0.25);
    if (hit) { hit.t = now; return; }
    memo.push({ x: p.x, z: p.z, t: now });
    if (memo.length > GO.seatMemoMax) memo.shift();
  };
  add(a?.settledSlot?.pos);
  if (a?.arrived) add(a?.intent?.slot?.pos);
  return memo;
}

/**
 * Points the stand search must keep off (radius GO.seatClear): the agent's body when the target `t` is a stand-in for
 * the slot it walks to (the search skips the target's id as an obstacle, so the seat it is about to leave looked free),
 * and every remembered seat of it except the one the target frames. `t` = goDest(a).
 */
export function keepOffFor(a: GoActor, t: { pos?: { x: number; y?: number; z: number } } | null | undefined, seats: { x: number; z: number }[] = []): { x: number; z: number; r: number }[] {
  const out: { x: number; z: number; r: number }[] = [];
  if (!a?.pos) return out;
  if (t && t !== a) out.push({ x: a.pos.x, z: a.pos.z, r: GO.seatClear });
  const tp = t?.pos ?? a.pos;
  for (const s of seats) if (Math.hypot(s.x - tp.x, s.z - tp.z) > 0.3) out.push({ x: s.x, z: s.z, r: GO.seatClear });
  return out;
}

/** Is (x, z) inside a keep-off circle? */
export function keptOff(keep: readonly KeepOff[] | null | undefined, x: number, z: number): boolean {
  if (!keep) return false;
  for (const k of keep) if (Math.hypot(k.x - x, k.z - z) < (k.r ?? GO.seatClear)) return true;
  return false;
}

/**
 * Is the agent's face hidden from the lens? World sightline (walls, tall furniture: player/follow.ts followWorld)
 * from the eye to the face centre and to the top of the head; hidden when both are blocked. The subject's own
 * chair / desk edge (FOLLOW.near) doesn't count. `W` = followWorld(layout).
 */
export function faceHidden(W: FollowWorld | null | undefined, level: number, pose: PoseArr | null | undefined, a: Pick<FollowActor, 'pos'> | null | undefined, o: { seated?: boolean; eyeH?: number } = {}): boolean {
  if (!W || !a?.pos || !pose) return false;
  const ex = pose[0], ey = pose[1] + (o.eyeH ?? GO.eyeH), ez = pose[2];
  const fy = (a.pos.y ?? 0) + (o.seated ? GO.faceY.sit : GO.faceY.stand);
  const c = worldBlocked(W, level, ex, ey, ez, a.pos.x, fy, a.pos.z, FOLLOW.near);
  if (!c) return false;
  return !!worldBlocked(W, level, ex, ey, ez, a.pos.x, fy + 0.25, a.pos.z, FOLLOW.near);
}

/**
 * Record `id`'s map position (world x, z) at time `t` (ms) in `trail` (Map id → {x, z, t}[]), ≤ 1 sample / trailStepMs,
 * samples older than GO.trailMs dropped.
 */
export function trailNote(trail: Map<string, SeatMemo[]>, id: string, x: number, z: number, t: number): void {
  let q = trail.get(id);
  if (!q) trail.set(id, (q = []));
  const last = q[q.length - 1];
  if (last && t - last.t < GO.trailStepMs) { last.x = x; last.z = z; return; }
  q.push({ x, z, t });
  while (q.length && t - q[0].t > GO.trailMs) q.shift();
}

/**
 * The agent whose trail passed nearest (x, z) within `r` m in the last GO.trailMs (null: none).
 */
export function trailHit(trail: Map<string, SeatMemo[]>, x: number, z: number, t: number, r: number): string | null {
  let best: string | null = null, bd = r;
  for (const [id, q] of trail) {
    for (const p of q) {
      if (t - p.t > GO.trailMs) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) { bd = d; best = id; }
    }
  }
  return best;
}

/**
 * Where a floor walk to (x, z) should end: the point itself, or the nearest spot (rings of 0.15 m out to 1.5 m) that
 * is walkable and ≥ GO.seatClear from every seat (a sit slot: a chair, a stool, a bench seat, a sofa place).
 */
export function floorSpot(x: number, z: number, q: { walkable?: (x: number, z: number) => boolean; seats?: { x: number; z: number }[] } = {}): { x: number; z: number } {
  const seats = q.seats ?? [];
  const ok = (px: number, pz: number) => (!q.walkable || q.walkable(px, pz)) && !seats.some((s) => Math.hypot(s.x - px, s.z - pz) < GO.seatClear);
  if (ok(x, z)) return { x, z };
  for (let r = 0.15; r <= 1.5 + 1e-9; r += 0.15) {
    let best: { x: number; z: number } | null = null;
    for (let i = 0; i < 24; i++) {
      const b = (i / 24) * Math.PI * 2, px = x + Math.sin(b) * r, pz = z + Math.cos(b) * r;
      if (ok(px, pz)) { best = { x: px, z: pz }; break; }
    }
    if (best) return best;
  }
  return { x, z };
}
