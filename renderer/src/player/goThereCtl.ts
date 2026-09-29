// @pure
/**
 * Go-there controller (PLY m3 fix r3; reviewer [code]: the state machine lived inside UI-owned ui/index.ts, with
 * ~15 cross-owner tags and two engineers editing the same file). "G" / roster "go there" / `__hq.goTo`:
 *
 *  goTo(id) ── walker? ──▶ followWalker: the follow rig (player/follow.ts) trails it; settleStep walks up to it
 *     │                     once it has stood still SETTLE.holdMs (≤ SETTLE.maxMs, then it just keeps following)
 *     ▼
 *  startStand('go') ─▶ budgeted stand search (ctx.standBegin / ctx.standStep, ≤ a slice per frame; the HUD says
 *     │                "finding a spot…", never longer than GO.hintMaxMs) ─▶ glide to the spot (none: follow rig)
 *     ▼
 *  track (trackStep, every 180 ms): while the glide runs (at 30 % and again in its last 30 %) and for GO.trackMs
 *     after G — or, once the glide has landed and the lens is untouched, GO.watchMs — re-search when the agent's
 *     destination changes (goThere.ts destKey / movedFar) or it arrives, and re-aim if the spot moved (≤
 *     GO.maxRetargets); a new slot of a walking agent during the glide hands over to followWalker (slotChanged;
 *     once landed it ends the watch); a face hidden ≥ GO.losHoldMs searches again (losStep; a walker or
 *     > GO.maxLosSearches misses → the watch ends); otherwise a small in-place turn keeps the face on the view axis
 *     (faceStep, ≤ 16 turns, ≤ 1 / 0.6 s).
 *  Any look / move input ends tracking (`cancel`, or a pose off the landed one); an answer or a terminal action ends
 *  whatever it left running (`endAuto`).
 *
 * The UI keeps what is its own — the stand query (ui/goto.ts), glides, the lens, the HUD, selection, follow ids —
 * and hands them in through a small ctx; ui/index.ts only wires. No three.js, no DOM: node-testable (goThereCtl.test.ts).
 * Owner: PLY.
 */
import { goDest, targetPos, movedFar, faceTurn, hintDue, GO, slotChanged, noteSeat, faceHidden, floorSpot } from './goThere.ts';
import type { GoActor, PoseArr, SeatMemo } from './goThere.ts';
import { followWorld } from './follow.ts';
import type { FollowWorld } from './follow.ts';
import type { Layout } from '../world/layout/schema.ts';

/** Go-there on a walker: follow it until it has settled this long, give up waiting after maxMs (keeps following). */
export const SETTLE = Object.freeze({ maxMs: 45_000, holdMs: 700 });
/** ms between tracking checks. */
export const TRACK_MS = 180;

const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));

/** Walking = not arrived, or moving more than a shuffle (1 m) away from its slot. */
export function walkingOf(a: GoActor): boolean {
  return !a.arrived || (!!a.moving && (!a.intent?.slot?.pos || Math.hypot(a.intent.slot.pos.x - a.pos.x, a.intent.slot.pos.z - a.pos.z) > 1));
}

/** What `destOf` returns for a walker: the slot it heads to (with its remaining route); `dest` is its change key. */
export interface GoDest { pos: { x: number; y?: number; z: number }; dest: string }
/** A stand spot the UI's search found (`tier` is set for a desk walk-up; `dest` is stamped on it for a walker). */
export interface GoStand { x: number; z: number; yaw: number; y?: number; pitch?: number; tier?: number | null; dest?: string }
/** A running budgeted stand search; `result` is set once `standStep` returned true. */
export interface GoStandJob { result?: GoStand | null }
/** The camera the go-there reads. */
export interface GoPlayer { getPose(): PoseArr; eyeHeight: number }

export interface GoThereCtx {
  /** live actor by id (null: gone) */
  actorOf(id: string): GoActor | null | undefined;
  /** stable-identity re-key (rekey.resolve) */
  resolve?(id: string): string;
  /** the player controller or null */
  player(): GoPlayer | null | undefined;
  /** the current layout or null */
  layout(): Layout | null | undefined;
  /** ui/goto.ts destOf (the slot a walker is heading to) */
  destOf(a: GoActor): GoDest;
  /** start a budgeted stand search for `a` (t = goDest target) */
  standBegin(a: GoActor): { t: GoActor | GoDest; job: GoStandJob };
  /** advance it one frame's slice; true once `job.result` is set */
  standStep(job: GoStandJob): boolean;
  /** glide to a stand spot (null: fallback pose) */
  glideTo(a: GoActor, s: GoStand | null, o: { quiet?: boolean; keepTrack?: boolean }): void;
  /** quiet in-place glide to `pose` (keeps tracking) */
  turnTo(pose: PoseArr, id: string): void;
  /** the running UI glide (t: 0…1 progress) or null */
  glide(): { t: number; to: PoseArr } | null;
  /** hand the camera to the follow rig on `id` (auto: started by a go-there) */
  follow(id: string, o?: { auto?: boolean }): void;
  stopFollow(): void;
  followingId(): string | null;
  select(id: string): void;
  hud: { aim(t: string | null, verb?: string): void; flash(t: string): void; toast(kind: string, t: string): void };
  /** display name of an actor */
  label(a: GoActor): string;
  /** sightline world of a layout (default: a cached follow.ts followWorld) */
  world?(L: Layout | null | undefined): FollowWorld;
  /** ms clock (default performance.now) */
  now?(): number;
  /** drop per-agent entries of gone agents (UI prune.ts pruneIfGrown) */
  prune?(memo: Map<string, SeatMemo[]>): void;
}

/** The go-there in flight: what it frames, when it last looked, and the counters that bound its work. */
interface Track {
  id: string; key: string; slotId: string | null; at: number; until: number; n: number;
  pose: PoseArr | null; mid: boolean; late: boolean; settled: boolean;
  tpos?: { x: number; z: number } | null; walkUp?: boolean; watch?: boolean;
  hidSince?: number; los?: number; faced?: number; turnAt?: number;
}
interface StandJob { job: GoStandJob; a: GoActor; t: GoActor | GoDest; kind: 'go' | 'track'; t0: number; force: boolean }

export function createGoThereCtl(c: GoThereCtx) {
  const now = c.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
  const resolve = c.resolve ?? ((id: string) => id);
  let WL: Layout | null | undefined = null, WW: FollowWorld | null = null;
  const world = c.world ?? ((L: Layout | null | undefined): FollowWorld => { if (!WW || L !== WL) { WL = L; WW = followWorld(L); } return WW; });
  let track: Track | null = null;
  let standJob: StandJob | null = null;
  let settleWatch: { id: string; since: number; until: number } | null = null;
  let goHintAt = 0;
  /** seats each agent held since a go-there on it began (goThere.ts noteSeat / keepOffFor) */
  const seatMemo = new Map<string, SeatMemo[]>();
  function seatsOf(id: string) { c.prune?.(seatMemo); let m = seatMemo.get(id); if (!m) seatMemo.set(id, (m = [])); return m; }
  /** ground-floor seats (sit slots) of the layout, cached per layout */
  let seatL: Layout | null = null, seatP: { x: number; y: number; z: number }[] = [];
  function seatPts(L: Layout) { if (L !== seatL) { seatL = L; seatP = (L.slots ?? []).filter((q) => (q.pose ?? '') === 'sit' && (q.level ?? 0) === 0).map((q) => q.pos); } return seatP; }
  const levelOf = (L: Layout | null | undefined, a: GoActor) => (L?.floorAt ? L.floorAt(a.pos.x, a.pos.z, (a.pos.y ?? 0) + 0.05).level : 0);
  /** reaching the slot it walked to is not a new destination: one re-frame via `settled` */
  const destKey = (a: GoActor): string => { const t = goDest(a, c.destOf); return 'dest' in t ? t.dest : a.intent?.slot?.id ?? (a.arrived ? 'here' : 'self'); };
  const newTrack = (a: GoActor, t: number, o: Partial<Track> = {}): Track => ({ id: a.id, key: destKey(a), slotId: a.intent?.slot?.id ?? null, at: t, until: t + GO.trackMs, n: 0, pose: null, mid: false, late: false, settled: !!a.arrived, ...o });

  function clearGoHint() { if (!goHintAt) return; goHintAt = 0; c.hud.aim(null); }
  function glideToStand(a: GoActor, s: GoStand | null, quiet: boolean) {
    c.glideTo(a, s, { keepTrack: true, quiet });
    if (track && s?.tier != null) track.walkUp = true;
  }
  function startStand(a: GoActor, kind: 'go' | 'track', force = false) {
    if (!c.layout()) { if (kind === 'go') { track = null; c.glideTo(a, null, {}); } return; }
    const { t, job } = c.standBegin(a);
    standJob = { job, a, t, kind, t0: now(), force }; // force: re-glide even to a near spot (lost sight)
    if (kind === 'go') { c.hud.aim('finding a spot…', ''); goHintAt = now(); }
    if (track) track.tpos = targetPos(t); // the point this search frames (re-target when it moves)
    stepStand();
  }
  function stepStand() {
    const J = standJob;
    if (!J || !c.standStep(J.job)) return; // more next frame
    standJob = null;
    const s = J.job.result;
    if (s && J.t !== J.a && 'dest' in J.t) s.dest = J.t.dest;
    // no stand spot with a view of the face: the follow rig (keeps the face in view), not a blind pose along its yaw
    if (J.kind === 'go') { clearGoHint(); if (s) glideToStand(J.a, s, false); else followWalker(J.a, false); return; }
    if (!track) return;
    if (!s) { if (J.force) followWalker(J.a, false); return; }
    const player = c.player();
    if (!player) return;
    const g = c.glide();
    const cur = g ? g.to : player.getPose();
    const moved = Math.hypot(s.x - cur[0], s.z - cur[2]) > 0.4 || Math.abs(wrap(s.yaw - cur[3])) > 0.35;
    if ((moved || J.force) && track.n < GO.maxRetargets) {
      track.n++;
      glideToStand(J.a, s, true);
      track.pose = null;
    }
  }
  function trackStep(t: number) {
    const P = c.player();
    if (!track || !P) return;
    const g = c.glide();
    if (!g && track.pose) {
      const p = P.getPose();
      const tp = track.pose;
      if (p.some((v, i) => Math.abs(v - tp[i]) > 1e-3)) { track = null; return; } // the user looked / moved
      // landed and untouched: keep watching the agent (a new slot, a lost sightline)
      if (!track.watch) { track.watch = true; track.until = Math.max(track.until, t + GO.watchMs); }
    }
    if (t > track.until) { track = null; return; }
    if (t - track.at < TRACK_MS || standJob) return;
    track.at = t;
    const a = c.actorOf(track.id);
    if (!a) { track = null; return; }
    noteSeat(seatsOf(a.id), a, t); // the seat it may be about to leave
    // ANY new slot (not only a > 2 m move): it got up and walks off → during the go-there glide, follow it and walk up
    // once it settles; once landed (UI fix r3, playtest "the camera switches to follow on its own": you answered it,
    // it went back to work) the watch just ends instead of carrying you off
    if (slotChanged(track, a) && walkingOf(a)) { if (g) followWalker(a); else track = null; return; }
    const key = destKey(a);
    const u = g ? g.t : 1;
    // a wanderer keeps its destination key while it walks off: re-target once the framed point moved > GO.retargetM
    const changed = key !== track.key || movedFar(track.tpos ?? null, targetPos(goDest(a, c.destOf)));
    if (changed) track.settled = false; // a new destination: frame it again once it arrives there
    const late = !!g && u >= 0.7 && !track.late;
    const settled = !g && a.arrived && !track.settled;
    if (!changed && !late && !settled && !(g && u >= 0.3 && !track.mid)) { if (!g && !losStep(a, t)) faceStep(a, t); return; }
    if (g && u >= 0.3) track.mid = true;
    if (late) track.late = true;
    if (settled) track.settled = true;
    track.key = key;
    track.slotId = a.intent?.slot?.id ?? null;
    startStand(a, 'track');
  }
  /**
   * Line of sight on arrival and while the landed go-there watches (goThere.ts faceHidden): a face hidden ≥
   * GO.losHoldMs searches again (forced re-glide); a walker, or > GO.maxLosSearches misses, hands over to the follow
   * rig (landed: the watch ends). → true when it acted (or is waiting out the hold), so no face turn runs.
   */
  function losStep(a: GoActor, t: number) {
    const L = c.layout(), P = c.player();
    if (!L || !P || !track) return false;
    const seated = !!a.arrived && (a.intent?.slot?.pose ?? 'stand') === 'sit';
    if (!faceHidden(world(L), levelOf(L, a), P.getPose(), a, { seated, eyeH: P.eyeHeight })) { track.hidSince = 0; return false; }
    if (!track.hidSince) { track.hidSince = t; return true; }
    if (t - track.hidSince < GO.losHoldMs) return true;
    track.hidSince = 0;
    track.los = (track.los ?? 0) + 1;
    // landed (no glide): a walker or a face that stays hidden ends the watch, never an automatic follow (UI fix r3)
    if (walkingOf(a) || track.los > GO.maxLosSearches) { track = null; return true; }
    track.slotId = a.intent?.slot?.id ?? null;
    startStand(a, 'track', true);
    return true;
  }
  /** Hand a go-there over to the follow rig; `settle`: walk up to the stand spot once the agent has settled. */
  function followWalker(a: GoActor, settle = true) {
    track = null; standJob = null;
    c.follow(a.id, { auto: true }); // auto: an answer / a terminal action ends it (UI endAutoCamera → endAuto)
    settleWatch = settle ? { id: a.id, since: 0, until: now() + SETTLE.maxMs } : null;
    c.hud.flash(`following ${c.label(a)}${settle ? ' until it settles' : ''} · move to stop`);
  }
  /** Between searches the camera stays facing the agent: a short in-place turn onto its face (goThere.ts faceTurn). */
  function faceStep(a: GoActor, t: number) {
    if (!track) return;
    if ((track.faced ?? 0) >= 16 || t - (track.turnAt ?? 0) < 600) return;
    // a desk walk-up is framed face + screen by the stand search: re-centring on the face would pitch onto the desktop
    if (track.walkUp && a.arrived && /desk/.test(a.intent?.slot?.tag ?? '')) return;
    const P = c.player();
    if (!P) return;
    const seated = !!a.arrived && /desk|sofa|seat|chair|stool|bench|nap/.test(a.intent?.slot?.tag ?? '');
    const turn = faceTurn(P.getPose(), a, { seated, eyeH: P.eyeHeight });
    if (!turn) return;
    track.faced = (track.faced ?? 0) + 1; track.turnAt = t;
    c.turnTo(turn, a.id);
  }
  function settleStep(t: number) {
    const w = settleWatch;
    if (!w) return;
    if (c.followingId() !== w.id) { settleWatch = null; return; } // the user moved / looked away: follow ended
    const a = c.actorOf(w.id);
    if (!a) { settleWatch = null; c.stopFollow(); return; }
    if (walkingOf(a)) { w.since = 0; if (t > w.until) settleWatch = null; return; } // (keeps following after the cap)
    if (!w.since) { w.since = t; return; }
    if (t - w.since < SETTLE.holdMs) return;
    settleWatch = null;
    c.stopFollow();
    goTo(w.id); // settled: the walk-up stand spot, 3/4 front
  }
  function goTo(id: string) {
    const a = c.actorOf(resolve(id));
    if (!a || !c.player()) { c.hud.toast('info', 'Not in this room.'); return; }
    noteSeat(seatsOf(a.id), a, now()); // its seat: never a stand spot once it leaves
    if (walkingOf(a)) { followWalker(a); return; }
    settleWatch = null;
    track = newTrack(a, now());
    startStand(a, 'go');
    c.select(id);
  }

  return {
    goTo,
    /** Per frame: the budgeted search slice, the hint lifetime, tracking and the settle watch. */
    update(t: number = now()) {
      if (standJob) stepStand();
      if (goHintAt && (standJob?.kind !== 'go' || hintDue(goHintAt, t))) clearGoHint();
      if (track) trackStep(t);
      if (settleWatch) settleStep(t);
    },
    /** The user took the camera (look / move / deselect): stop tracking and drop a pending search. */
    cancel() { track = null; standJob = null; },
    /** An answer / a terminal action: end what the go-there left running (the landed watch, a settle-follow, a re-aim). */
    endAuto() { track = null; settleWatch = null; if (standJob?.kind === 'track') standJob = null; },
    /** Another camera move took over (a glide elsewhere, a manual follow): stop tracking only. */
    dropTrack() { track = null; },
    /** The UI glide landed at `pose`: from now on any change of it is the user's. */
    landed(pose: PoseArr) { if (track) track.pose = pose; },
    /** Keep watching `a` from the current (already placed) pose, as a landed go-there (`__hq.walkUp`). */
    watch(a: GoActor, pose: PoseArr, o: Partial<Track> = {}) { track = newTrack(a, now(), { pose, mid: true, late: true, settled: true, ...o }); },
    get active() { return !!(track || standJob); },
    seatsOf,
    /** per-agent seat memo (the UI drops / re-keys ids on the store's 'gone' / rekey) */
    seatMemo,
    /**
     * Where a floor walk to (x, z) ends (minimap overview): never on a seat (an agent's empty chair: reviewer m3-r2
     * 29-map-dev-5) nor off the walkable floor. `walkable(x, z)` optional.
     */
    floorPoint(x: number, z: number, walkable?: (x: number, z: number) => boolean) { const L = c.layout(); return floorSpot(x, z, { walkable, seats: L ? seatPts(L) : [] }); },
    walking: walkingOf,
    // diagnostics (`__hq` ui debug)
    trackInfo: () => (track ? { id: track.id, key: track.key, n: track.n } : null),
    settleInfo: () => (settleWatch ? { ...settleWatch } : null),
    searching: () => !!standJob,
  };
}
