// @pure
/**
 * Brain (DESIGN §6.4): one per actor. A small hierarchical FSM: shown status (with the §6.4 1.5 s hysteresis) →
 * phase (by age in status) → spot + activity + face + look target. Deterministic where it matters: idle picks, nap
 * cycles and dust derive from `(seedKey, statusSince, age)`, so two windows and a reload show the same behaviour.
 * The liveliness layer (fidgets, glances at neighbours and the player, chair swivels, chats, reactions to what the
 * neighbours do) is local texture on top, never contradicting the status signals (§6.7, §6.9).
 * No three.js here: the motor and all rendering live in `actors.ts`. Owner: BRN.
 */
import { hash32, mulberry32 } from '../../../../shared/identity.ts';
import { taskLabel } from '../../../../shared/task.ts';
import { waitClock } from '../../../../shared/clock.ts'; // [FX fix r1]
import { MISC, CORE } from '../../../../shared/palette.ts';
import {
  TUNING as T, CLS_ACTIVITY, SHELL_ACTIVITY, CLS_FACE, EVENT_REACTION, SOCIAL_REACTION, FIDGETS, SPOT_ACTIVITY,
  CHILL_WEIGHTS, CHILL_WEIGHTS_HQ, HOBBY_WEIGHTS, OUTING_WEIGHTS, DONE_OUTING_WEIGHTS, PICK_ACTIVITY, STATION_ACTIVITY, WALK_ACTIVITY, SOCIAL_TAGS,
  SIT_VARIETY, STAND_VARIETY, SHELL_TOYS, NO_VARIETY,
} from './tuning.ts';
import { createPhaseTracker, KEY_STATION } from './phase.ts';
import type { PhaseTracker } from './phase.ts';
import type { Entity } from '../../../../shared/protocol.ts';
import type { Slot, Vec3 } from '../../world/layout/schema.ts';
import type { Director } from './director.ts';
import { isHqDirector } from './director.ts';
import type { HqDirector } from './directorHq.ts';
import type { Gig } from './social.ts';

export type V3 = Vec3;
/** a speech / thought / alert bubble */
export interface BubbleSpec { kind: 'speech' | 'thought' | 'alert'; icon: string; title: string; detail?: string; priority: number }
/** §6.4 */
export interface Intent {
  /** where the motor should take the actor (null = stay put) */
  slot: Slot | null;
  /** animator activity id (§6.3), applied on arrival */
  activity: string | null;
  face: string | null;
  bubble: BubbleSpec | null;
  ring: { status: string; pulse: boolean } | null;
  /** ToolClass / ShellActivity pictogram */
  glyph: string | null;
  lamp: 'off' | 'work' | 'blocked' | null;
  outline: { color: string; width: number } | null;
  dust: 0 | 1 | 2 | 3;
  /** m/s when travelling */
  speed: number;
  /** arms-layer activity while walking (§6.5 walking variants); only a working scurry carries one (`walkType`): arms = the status signal */
  walkActivity: string | null;
  /** locomotion style override (null = the personality's walk) */
  gait: string | null;
  /** stand on the chair (fresh blocked, §6.4) */
  stand: boolean;
  /** look-at target (eyes; seated idle actors also swivel) */
  look: V3 | null;
  /** the body may turn toward `look` (seated, not working) */
  swivel: boolean;
  /** settled yaw offset from the slot's yaw (rad): a lazy chair swivel, a queue actor's 3/4 turn toward the room */
  turn: number;
  /** animator energy */
  energy: number;
  placard: { text: string; muted: boolean } | null;
  /** debug: FSM leaf */
  phase: string;
  /** route through this portal when the walk changes level (§6.5) */
  via?: 'slide' | 'stairs' | null;
  /** what the current walk is for (metrics): 'station' | 'workCall' | 'parcel' | 'slide' | null */
  trip?: string | null;
}
export interface Neighbour {
  id: string;
  pos: V3;
  yaw: number;
  status: string;
  seated: boolean;
  chattingWith: string | null;
  /** idle and settled at a social spot (café, coffee, games) */
  social?: boolean;
  /** a Shelly in pocket mode (§6.4.1) */
  pocket?: boolean;
}
/** filled by actors.ts every frame (reused object) */
export interface BrainEnv {
  /** local animation seconds (ctx.time) */
  t: number;
  self: { pos: V3; yaw: number; settledAt: string | null; moving: boolean; level?: number };
  player: { pos: V3; dist: number; inFront: boolean } | null;
  /** nearest first, ≤ 6, within 6 m */
  neighbours: Neighbour[];
  /** look up another actor (chat partner) */
  partner(id: string): Neighbour | null;
  /** ask a host to chat (host must be idle & seated) */
  invite(visitorId: string, hostId: string): boolean;
  /** a cosmetic reaction on another actor (a high-five back) */
  poke?(id: string, reaction: string): void;
  /** the office's social scene this actor is cast in (social.ts) */
  gig?: Gig | null;
  /** the ping-pong ball, while rallying */
  rally?: { x: number; y: number; z: number; visible: boolean } | null;
  /** tell the office something happened here ('pitArrive') */
  emit?(kind: string): void;
  /** a pod-mate is on its way for a high-five: a done agent waits at its desk */
  hold?: boolean;
  /** the player's level (0 ground, 1 mezzanine) */
  playerLevel?: number;
  /** Segfault the cat, when close */
  cat?: { x: number; y?: number; z: number } | null;
  /** the player has been aiming at this agent (walk-up attention) */
  aimed?: boolean;
  /** is this showcase room (zone id) empty right now? a yes books it */
  roomEmpty?: (zone: string) => boolean;
  /** may one more done lounger leave the Pit? */
  pitSpare?: (() => boolean) | null;
}
/** the brain's own readable state (actors.ts / social.ts / tests read it) */
export interface BrainState {
  status: string | null;
  phase: string;
  chattingWith: string | null;
  seated: boolean;
  /** idle, awake and not busy with a run / ride / chat / gig: social.ts may cast it in a scene */
  free: boolean;
  idleMs: number;
  /** key of the gig being played (0 = none) */
  gig: number;
  /** key of the last claim gig it could not take */
  declined: number;
  castable: boolean;
  verbCancels: number;
  attends: number;
  /** idle and settled at a social spot */
  social?: boolean;
  /** Shelly pocket mode */
  pocket?: boolean;
  lookBacks?: number;
  listen?: string | null;
  listens?: number;
  celebs?: number;
}
/** a server event as the brain sees it */
export interface BrainEvent { id?: string; kind: string; detail?: unknown }
export interface Brain {
  update(entity: Entity, now: number, env?: BrainEnv): Intent;
  /** → reaction id (or null) */
  onEvent(event: BrainEvent): string | null;
  /** hold a status event until the hysteresis commits its status (true = held / swallowed) */
  deferEvent(event: BrainEvent): boolean;
  pullDueEvent(): BrainEvent | null;
  /** a neighbour's event */
  onSocial(kind: string, from: { id?: string; pos: V3 }, t: number): string | null;
  /** a player verb (§6.9): the outcome (metrics) */
  verb(kind: string, env?: BrainEnv): string;
  answered(): boolean;
  talk(open: boolean, env?: BrainEnv, sent?: boolean): boolean;
  cheer(delay: number, env?: BrainEnv, answered?: boolean): boolean;
  prompted(env?: BrainEnv): string | false;
  acceptChat(visitorId: string, visitorPos: { x: number; z: number }, untilT: number): boolean;
  /** one-shot reactions the brain decided on (transitions, waves, …) */
  pullReaction(): string | null;
  debug(): { tracker: ReturnType<PhaseTracker['debug']> | null; station: { sid: string; slot: string; arrived: boolean } | null; parcel: string | null; variety: { spot: string; base: string | null; beat: number; act: string | null; next: number; chat: string | null } | null };
  rekey(newId: string): void;
  state: BrainState;
}
/** the office's roaming-capped pick weights for one home (§6.4.1), cached per home / layout version */
interface HqPicks { weights: Record<string, number>; hobby: Record<string, number>; chillLong: Record<string, number>; outingTags: Set<string> }
/** a done stay's current outing */
interface Outing { key: string; spot: Slot | null; tag: string }
/** a done agent back from a scene: the outing it takes right away */
type StayMode = 'awake' | 'nap' | 'shell';
interface PostGig { spot: Slot | null; tag: string; t0: number; t1: number }
/** `map[key]` for a key that may be null (an absent tool class looks nothing up) */
const pick = <V,>(map: Readonly<Record<string, V | undefined>>, key: string | null | undefined): V | undefined => (key == null ? undefined : map[key]);
/** the full-office idle config (roaming-capped weights + nap shares) */
export interface IdleCfg {
  seed: number;
  tags: string[];
  fav: string;
  chatty: number;
  weights?: Record<string, number>;
  hobby?: Record<string, number>;
  chillLong?: Record<string, number>;
  outingTags?: Set<string>;
  napTag?: string;
  napDeskShare?: number;
}
export interface IdleSeg { kind: 'desk' | 'chill' | 'nap' | 'hobby'; tag: string; r: number; start: number; end: number; idx: number; walk: boolean }
/** `idleSegment`'s cache object (`{}` initially; it rewinds itself) */
export interface IdleSch extends IdleSeg { seed: number; rng: () => number; napNext: boolean }

// ------------------------------------------------------------------------------------------------ personality

/** Brain-side personality knobs (salted, so CHR's own draw order is independent). */
export function personality(seedKey: string) {
  const r = mulberry32(hash32(`brain:${seedKey}`));
  const spots = ['window', 'plant', 'coffee', 'sofa', 'chat', 'library', 'arcade'];
  return {
    energy: 0.8 + r() * 0.45,
    favoriteFidget: FIDGETS[Math.floor(r() * FIDGETS.length)],
    favoriteSpot: spots[Math.floor(r() * spots.length)],
    chatty: 0.5 + r(), // weights chat picks and glances
    curious: 0.6 + r() * 0.8, // glance frequency
    shellPocketMs: T.shellPocketMs[0] + r() * (T.shellPocketMs[1] - T.shellPocketMs[0]),
  };
}

// ------------------------------------------------------------------------------------------------ idle schedule

/**
 * Deterministic idle ladder schedule (§6.4.1): segment at `ageMs` for (seedKey, statusSince). Incremental: pass the
 * same `sch` object each call; it rewinds itself if age goes backwards.
 * `cfg.weights` (full office) replaces the proto chill weights: tag → weight with the roaming cap already applied;
 * `cfg.hobby` likewise for the 10–60 min hobby picks; `cfg.napTag` is the non-desk nap pick.
 */
export function idleSegment(cfg: IdleCfg, cache: Partial<IdleSch>, ageMs: number): IdleSeg {
  // (the cache starts empty: the first call, a new seed, or an age that went backwards re-seeds it)
  const sch: IdleSch = isFilled(cache) && cache.seed === cfg.seed && ageMs >= cache.start
    ? cache
    : Object.assign(cache, { seed: cfg.seed, rng: mulberry32(cfg.seed), kind: 'desk' as const, tag: 'desk', r: 0, start: -Infinity, end: T.idleDeskMs, idx: 0, napNext: true, walk: false });
  let guard = 0;
  while (ageMs >= sch.end && guard++ < 10_000) {
    const rng = sch.rng;
    sch.start = sch.end;
    sch.idx++;
    sch.r = rng();
    sch.walk = false;
    if (sch.start < T.idleChillMs) {
      sch.kind = 'chill';
      sch.tag = pickTag(cfg, rng(), true, sch.start >= T.outingIdleMs && cfg.chillLong ? cfg.chillLong : cfg.weights);
      sch.end = Math.min(T.idleChillMs, sch.start + 1000 * (T.chillPickS[0] + rng() * (T.chillPickS[1] - T.chillPickS[0])));
    } else if (sch.napNext) {
      sch.kind = 'nap';
      sch.tag = rng() < (cfg.napDeskShare ?? 0.6) ? 'desk' : cfg.napTag ?? 'sofa';
      const k = sch.start >= 60 * 60_000 ? 1.5 : 1;
      sch.end = sch.start + 1000 * k * (T.napS[0] + rng() * (T.napS[1] - T.napS[0]));
      sch.napNext = false;
      if (cfg.weights) sch.walk = rng() < T.sleepwalkShare; // full office only (proto draws stay unchanged)
    } else {
      sch.kind = 'hobby';
      sch.tag = pickTag(cfg, rng(), false, cfg.hobby ?? cfg.weights);
      sch.end = sch.start + 1000 * (T.hobbyS[0] + rng() * (T.hobbyS[1] - T.hobbyS[0]));
      sch.napNext = true;
    }
  }
  return sch;
}
const isFilled = (c: Partial<IdleSch>): c is IdleSch => c.seed !== undefined;

function pickTag(cfg: IdleCfg, u: number, allowDesk: boolean, weights?: Record<string, number>): string {
  let total = 0;
  const tags = weights ? Object.keys(weights) : cfg.tags;
  const w = (tag: string) => (weights ? weights[tag] : CHILL_WEIGHTS[tag] ?? 1) * (tag === cfg.fav ? 2.5 : 1) * (tag === 'chat' ? cfg.chatty : 1);
  for (const tag of tags) total += w(tag);
  if (allowDesk) total += 2; // stay at the desk doodling
  let x = u * total;
  for (const tag of tags) { x -= w(tag); if (x <= 0) return tag; }
  return allowDesk ? 'desk' : tags[tags.length - 1] ?? 'desk';
}

/** `pickTag` under a name the brain's own `pickTag` (the current pick's tag) does not shadow */
const pickWeighted = pickTag;

// ------------------------------------------------------------------------------------------------ brain

/** Resting activity at a home slot: seated idle on a chair, stand idle on a floor spot. */
const restAct = (slot: Slot | null | undefined) => (slot?.pose === 'sit' ? 'sitIdle' : 'standIdle');
/**
 * Idle at the desk (§6.4.1 < 10 min): lean back in the chair, hands behind the head, lazy swivel. Posture carries the
 * idle-vs-working signal at 6 m (working sits upright, hands on the keyboard, facing the monitor).
 */
const idleRest = (slot: Slot | null | undefined) => (slot?.pose === 'sit' ? 'lounge' : 'standIdle');
/** Server events that announce a status change: their reaction waits for the hysteresis to commit that status. */
const STATUS_EVENTS: Readonly<Record<string, string | undefined>> = Object.freeze({ blocked: 'blocked', finished: 'done' });
/** Statuses whose beat plays at once, before the hysteresis commits the re-target ([BRN fix r2]). */
const BEAT_STATUS: Readonly<Record<string, boolean | undefined>> = Object.freeze({ blocked: true, done: true });
const DEFER_MAX_S = 5;
const a0Since = (e: Entity) => e.activity?.since ?? 0;
const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
// [FX fix r1] one wait clock for every surface (was raw minutes past an hour: '263:55'); ≥ for since-boot ages
const mmss = (ms: number, approx = false) => waitClock(ms, approx);
const CHAT_ICONS = ['coffee', 'gear', 'check', 'heart', 'star', 'bulb', 'note'];
const SLEEP_OUTLINE = Object.freeze({ color: CORE.ink2, width: 0.6 });
const BLOCKED_OUTLINE = Object.freeze({ color: MISC.blockedOutline, width: 1.6 });

export interface BrainDeps { director: Director; seedKey?: string }

export function createBrain(actorId: string, { director, seedKey }: BrainDeps): Brain {
  let id = actorId;
  const P = personality(seedKey ?? actorId);
  const fr = mulberry32(hash32(`fidget:${seedKey ?? actorId}`)); // local (non-shared) texture randomness
  const range = (a: readonly number[]) => a[0] + fr() * (a[1] - a[0]);
  const tags = [...director.chillTags.filter((t) => t !== 'queue'), 'chat', 'stroll'];
  // ---- full office (M1.5): stations, level changes, parcel runs, slide rides, sleepwalks, Shelly pocket mode
  const hq = !!director.isHq;
  const tracker = hq ? createPhaseTracker() : null;
  /** the office director: the members below exist only there (every use sits behind an `hq` check) */
  const hqDir = (): HqDirector => {
    if (!isHqDirector(director)) throw new Error('brain: office-only director member used on the proto room');
    return director;
  };
  /** current station visit */
  let st: { sid: string; slot: Slot; arrived: boolean } | null = null;
  let tripSeq = 0;
  /** last `now` a working frame was accounted (the walk budget, phase.ts); 0 = not working */
  let lastWorkNow = 0;
  /** the portal a level change takes on the current walk (decided once per walk: slide half the time, §6.5) */
  let viaKey = '', viaPick: 'slide' | 'stairs' | null = null;
  let cfgKey = '', cfg: HqPicks | null = null;
  /** parcel run after sign-off (§6.4 done → acked) */
  let parcel: { stage: 'away' | 'go' | 'drop' | 'receipt'; slot: Slot | null; t: number; away?: { x: number; z: number; level: number; yaw: number } | null } | null = null;
  /** slide ride pick: 0 = to the mouth, 1 = riding / to the exit, 2 = happy beat at the exit, 3 = done */
  let slideStage = 0, slideT = 0;
  let walkIdx = -1, walkHop = 0, walkT = 0;
  let pitGreeted = '';
  let victoryLap = false;
  /** the social gig being played (social.ts): its key, the claimed spot (if a claim gig), whether it could not take it */
  let gig: { key: number; spot: Slot | null; failed: boolean } | null = null;

  const intent: Intent = {
    slot: null, activity: null, face: 'neutral', bubble: null, ring: null, glyph: null, lamp: 'off', outline: null, dust: 0,
    speed: T.walkSpeed, walkActivity: null, gait: null, stand: false, look: null, swivel: false, turn: 0, energy: P.energy, placard: null, phase: 'init',
  };
  const state: BrainState = { status: null, phase: 'init', chattingWith: null, seated: false,
    /** idle, awake and not busy with a run / ride / chat / gig: social.ts may cast it in a scene */
    free: false, idleMs: 0, gig: 0, declined: 0, castable: false, verbCancels: 0, attends: 0 };
  const reactions: string[] = [];
  const push = (r: string | null | undefined) => { if (r && reactions.length < 6) reactions.push(r); };

  // status hysteresis
  let pend: string | null = null, pendAt = 0, first = true, lastEventAt = -Infinity, lastEventKind = '';
  /** the pending status whose beat (reaction + face + head snap) already played ([BRN fix r2]); null = none */
  let beat: string | null = null;
  // liveliness timers
  let nextFidgetAt = 2 + range(T.fidgetS), fidgetUntil = 0, fidgetName = ''; // first fidget: settle into the pose, desynced
  let nextGlanceAt = 0, glanceUntil = 0, glanceId: string | null = null;
  let socialUntil = 0, socialFace: string | null = null;
  const socialPos = { x: 0, y: 0.6, z: 0 }, glancePos = { x: 0, y: 0.6, z: 0 };
  const lookV = { x: 0, y: 0.6, z: 0 };
  let lastWaveAt = -Infinity, lastBumpAt = -Infinity, noticedPlayer = false, nextCheerAt = 0;
  // status-change events held until the hysteresis commits their status (continuous working → startle → chair wave)
  const deferred: { ev: BrainEvent; t: number }[] = [], dueEvents: BrainEvent[] = [];
  const swivelPhase = fr() * Math.PI * 2;
  // idle schedule + current pick
  const sch = {};
  let pickIdx = -1, pickSpot: Slot | null = null, pickKind = '', pickTag = '';
  const virt: Slot = { id: 'pt:none', tag: 'point', pos: { x: 0, y: 0, z: 0 }, yaw: 0, pose: 'stand', level: 0 };
  // chat
  let chatWith: string | null = null, chatUntil = 0, chatHost = false, chatBubbleFlip = 0;
  // shells
  let procAct: string | null = null, procSince = 0;
  // cached bubble/placard objects (replaced only on content change; fx is idempotent)
  let bubbleKey = '', bubble: BubbleSpec | null = null, placardKey = '', lastEntity: Entity | null = null, lastRing: { status: string; pulse: boolean } | null = null;
  let curT = 0, curNow = 0;
  /** statusSince of the committed status (§6.4 hysteresis) */
  let cSince = 0;
  let effObj: Entity | null = null, effSrc: Entity | null = null;
  const effEntity = (e: Entity): Entity => { if (!effObj || effSrc !== e || effObj.statusSince !== cSince) { effSrc = e; effObj = { ...e, statusSince: cSince }; } return effObj; };
  /** last entity seen while status was working (held through the hysteresis window) */
  let workEnt: Entity | null = null;
  // [BRN M3.5] §6.9 verbs, the answered sprint and the prompt work call
  /** R summon under way */
  let summon: { t0: number; stage: 'go' | 'here'; hereT: number; px: number; pz: number; x: number | undefined; z: number; level: number } | null = null;
  /** status the current in-place verb (glance / busy finger) was given in; any change cancels it */
  let lastRaw: string | null = null, verbSwivel = false;
  let verbStatus: string | null = null, verbLookUntil = 0, verbFaceUntil = 0, verbFace = 'happy', lastSummonT = -Infinity, wakeUntil = 0;
  let patT0 = -Infinity, patT1 = -Infinity; // [CHR fix m3-r1, cross-owner BRN] the last two pats on a working agent
  /** answered (§6.8.1): dash home once the status lets go of the queue */
  let dash: { t0: number; until: number; left: boolean } | null = null, thanksUntil = 0;
  /** prompt.sent while idle / done away from the desk */
  let promptCall: { until: number; caught: boolean } | null = null;
  const vLook = { x: 0, y: 0, z: 0 };
  // [BRN fix m2-fix1] walk-up attention (attendOverlay)
  let aimSince = -1, aimLastT = -Infinity, attendN = 0;
  /** the point and activity it holds while attending */
  let attend: { slot: Slot; act: string | null } | null = null;
  /** the intent's slot / activity as of the end of the last frame (what it was settled at when the aim began) */
  let prevSlot: Slot | null = null, prevAct: string | null = null;
  const attendPt: Slot = { id: 'pt:attend', tag: 'attend', pos: { x: 0, y: 0, z: 0 }, yaw: 0, pose: 'stand', level: 0 };
  /** [BRN fix m3-r2] the sign-off celebration (celebOverlay) */
  let celeb: { t0: number; until: number; maxT: number; hi5: boolean; slot: Slot | null; act: string | null; own: boolean } | null = null, celebN = 0, lastEnv: BrainEnv | null = null, attendMuteUntil = -Infinity;
  /** [BRN fix m3-r3] Talk (T) listening (listenOverlay) */
  let listen: { stage: 'come' | 'listen' | 'nod'; slot: Slot | null; act: string | null; own: boolean; t0: number; nodUntil: number; px?: number; pz?: number; call?: boolean } | null = null, listenN = 0, promptAfter = -1;
  /** [BRN fix m3-r3] inbox-zero cheer (zeroOverlay); the answered agent's victory skip */
  let zero: { at: number; until: number; played: boolean; slot: Slot | null; r: string; stay: boolean; act?: string | null } | null = null, skipUntil = -1;
  /** [BRN fix m3-r2] the Pit's look-back-and-wave at the player (liveliness) */
  let nextLookBackAt = -1, lookBackUntil = 0;
  /**
   * [BRN fix m3-r2] A standing point for (x, z) at least T.attendMinR from the player (fun review m3-r2: a summoned /
   * attending agent came to 0.4 m, its face filling the screen): (x, z) itself when far enough, else stepped back along
   * the player → (x, z) ray (fanned out when that is not walkable).
   */
  function standBack(env: BrainEnv | null | undefined, x: number, z: number, level: number): { x: number; z: number } {
    const pl = env?.player, R = T.attendMinR;
    if (!pl || (env.playerLevel ?? 0) !== level) return { x, z };
    const dx = x - pl.pos.x, dz = z - pl.pos.z, d = Math.hypot(dx, dz);
    if (d >= R) return { x, z };
    const a0 = d > 1e-3 ? Math.atan2(dx, dz) : fr() * Math.PI * 2;
    for (const k of [0, 0.4, -0.4, 0.8, -0.8, 1.3, -1.3, 2, -2]) for (const r of [R, R + 0.4]) {
      const px = pl.pos.x + Math.sin(a0 + k) * r, pz = pl.pos.z + Math.cos(a0 + k) * r;
      if (!director.walkable || director.walkable(px, pz, level)) return { x: px, z: pz };
    }
    return { x, z };
  }

  /**
   * [BRN fix m3-r3] A point of its own (celebration / attention / Talk / inbox-zero stop) never inside an authored view's
   * no-stand cone (keep-clear test: a sign-off celebrated 2.9 m into pitOverview's frame): the nearest walkable point
   * outside every cone, ≤ 2.4 m off (else the point itself)
   */
  function outOfView<Q extends { x: number; z: number }>(q: Q, level: number): Q | { x: number; z: number } {
    const iv = director.inView;
    // (a 0.35 m margin: a body there, nudged by a passer, must not step into the frame)
    const bad = (x: number, z: number) => !!iv && (iv(x, z, level) || iv(x + 0.35, z, level) || iv(x - 0.35, z, level) || iv(x, z + 0.35, level) || iv(x, z - 0.35, level));
    if (!iv || !bad(q.x, q.z)) return q;
    for (const r of [0.6, 1.0, 1.5, 2.0, 2.4]) for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2, x = q.x + Math.sin(a) * r, z = q.z + Math.cos(a) * r;
      if (bad(x, z) || (director.walkable && !director.walkable(x, z, level))) continue;
      return { x, z };
    }
    return q;
  }

  const setBubble = (key: string, make: (() => BubbleSpec) | null) => {
    if (key !== bubbleKey) { bubbleKey = key; bubble = make ? make() : null; }
    intent.bubble = bubble;
  };

  const setVirt = (tag: string, x: number, z: number, yaw: number, level = 0): Slot => {
    // the id string only when the point moves (a gig / chat point is re-set every frame: no per-frame garbage)
    if (virt.tag !== tag || virt.pos.x !== x || virt.pos.z !== z) virt.id = `pt:${tag}:${x.toFixed(2)},${z.toFixed(2)}`;
    virt.tag = tag; virt.pos.x = x; virt.pos.z = z; virt.yaw = yaw; virt.level = level;
    return virt;
  };

  const releasePick = () => { if (pickSpot && pickSpot !== virt) director.unclaim(id); pickSpot = null; pickIdx = -1; pickKind = ''; };
  const endChat = () => { chatWith = null; chatHost = false; state.chattingWith = null; };

  /** Resolve a chill/hobby pick tag to a spot (claim / chat partner / wander point). */
  function resolvePick(tag: string, r: number, env: BrainEnv | null | undefined, home: Slot | null): Slot | null {
    if (tag === 'desk') return home;
    if (tag === 'stroll') {
      const near = home?.pos ?? env?.self.pos;
      const p = director.wanderPoint(r, near, 5);
      return setVirt('stroll', p.x, p.z, r * Math.PI * 2);
    }
    if (tag === 'chat') {
      if (!env) return home;
      for (const n of env.neighbours) {
        if (n.status !== 'idle' || !n.seated || n.chattingWith) continue;
        if (!env.invite(id, n.id)) continue;
        chatWith = n.id; chatHost = false; state.chattingWith = n.id; chatUntil = env.t + range(T.chatS);
        // Stand behind-beside the host's chair (the aisle side), facing it.
        const fx = -Math.sin(n.yaw), fz = -Math.cos(n.yaw);
        const side = r < 0.5 ? 1 : -1;
        const x = n.pos.x - fx * 0.75 + fz * side * 0.35, z = n.pos.z - fz * 0.75 - fx * side * 0.35;
        return setVirt('chat', x, z, Math.atan2(-(n.pos.x - x), -(n.pos.z - z)));
      }
      return home;
    }
    const s = director.claim(id, tag, home?.pos);
    return s ?? home;
  }

  function lookAtPos(p: { x: number; y?: number; z: number }, y = 0.6) { lookV.x = p.x; lookV.y = (p.y ?? 0) + y; lookV.z = p.z; intent.look = lookV; }

  /** Glances, player attention, fidgets: texture shared by every calm phase. */
  function liveliness(env: BrainEnv | null | undefined, { seated, working, sleeping, fidget = false }: { seated: boolean; working: boolean; sleeping: boolean; fidget?: boolean }) {
    const t = env ? env.t : 0;
    intent.look = null;
    intent.swivel = false;
    if (!env || sleeping) return;
    // 1) the player (ART §5.3 look priority): close and in front → look; seated idle actors swivel to face them.
    const pl = env.player;
    if (pl && pl.dist < T.playerLookRadius && (pl.inFront || !working)) {
      lookAtPos(pl.pos, 1.1);
      intent.swivel = seated && !working;
      if (!noticedPlayer && !working && fr() < 0.5) push('wave');
      noticedPlayer = true;
      return;
    }
    if (pl && pl.dist > T.playerNoticeRadius) noticedPlayer = false;
    // 1b) [BRN fix m3-r2] (fun review m3-r2: the hero Pit view never showed a face) a Pit lounger with the player within
    // T.lookBackR looks round at them and waves, T.lookBackS every ~T.lookBackEveryS
    if (pl && !working && pl.dist < T.lookBackR && env.self.settledAt && !env.self.moving && (seated || intent.activity === 'lounge')) {
      if (nextLookBackAt < 0) nextLookBackAt = t + fr() * T.lookBackEveryS[1];
      else if (t >= nextLookBackAt) {
        nextLookBackAt = t + range(T.lookBackEveryS);
        if (director.zoneAt?.(env.self.pos.x, env.self.pos.z, env.self.level ?? 0) === 'PIT') { lookBackUntil = t + T.lookBackS; push('wave'); state.lookBacks = (state.lookBacks ?? 0) + 1; }
      }
      if (t < lookBackUntil) { lookAtPos(pl.pos, 1.1); return; }
    }
    // 2) a neighbour just did something (social reaction window).
    if (t < socialUntil) { lookAtPos(socialPos, 0.6); intent.swivel = seated && !working; if (socialFace && !working) intent.face = socialFace; return; }
    // 3) chat partner.
    if (chatWith) {
      const n = env.partner(chatWith);
      if (n) { lookAtPos(n.pos, 0.7); intent.swivel = seated; return; }
    }
    // 4) glances at neighbours / around.
    if (t >= nextGlanceAt) {
      nextGlanceAt = t + range(working ? T.workGlanceS : T.glanceS) / P.curious;
      glanceUntil = t + range(T.glanceHoldS);
      const ns = env.neighbours;
      glanceId = ns.length && fr() < 0.8 ? ns[Math.floor(fr() * Math.min(3, ns.length))].id : null;
      if (!glanceId) { glancePos.x = env.self.pos.x + (fr() - 0.5) * 6; glancePos.z = env.self.pos.z + (fr() - 0.5) * 6; glancePos.y = 0.3 + fr(); }
    }
    if (t < glanceUntil) {
      const n = glanceId ? env.partner(glanceId) : null;
      if (n) lookAtPos(n.pos, 0.7);
      else if (!glanceId) { lookV.x = glancePos.x; lookV.y = glancePos.y; lookV.z = glancePos.z; intent.look = lookV; }
      intent.swivel = seated && !working;
    }
    // 5) fidgets (seated idle only: CHR's `fidget:*` are chair fidgets; lounge/nap/station loops keep their own signal).
    const lounging = intent.activity === 'lounge';
    if (fidget && !working && env.self.settledAt && !env.self.moving && (intent.activity === 'sitIdle' || lounging)) {
      if (t >= nextFidgetAt) {
        nextFidgetAt = t + range(T.fidgetS) * (lounging ? 2.2 : 1); // leaning back is the signal: fidget less
        fidgetName = fr() < 0.55 ? P.favoriteFidget : FIDGETS[Math.floor(fr() * FIDGETS.length)];
        fidgetUntil = t + 1.6 + fr() * 1.6;
      }
      if (t < fidgetUntil) intent.activity = `fidget:${fidgetName}`;
    }
  }

  /**
   * "Excuse me" (anim review r2): a walker squeezing past the player (the motor sidesteps) looks up at them; idle
   * walkers add a polite smile. Status faces stay (blocked worried, done happy, working focused): §6.7 one visual =
   * one meaning, so no new face is borrowed for this.
   */
  function excuseMe(env: BrainEnv | null | undefined) {
    const pl = env?.player;
    if (!pl || !env.self.moving || pl.dist >= T.excuseR || intent.face === 'sleepy') return;
    lookAtPos(pl.pos, 1.1);
    if (state.status === 'idle') intent.face = 'happy';
  }

  function playerBump(env: BrainEnv | null | undefined) {
    const pl = env?.player;
    if (!pl || pl.dist > T.bumpRadius || env.t - lastBumpAt < T.bumpCooldownS) return;
    lastBumpAt = env.t;
    push('bump');
  }

  // ---------------------------------------------------------------------------------------------- phases

  function working(eIn: Entity, env: BrainEnv | null | undefined, home: Slot | null, atHome: boolean): string {
    // While a new status is pending (§6.4 hysteresis) keep acting on the last committed working entity: the tool
    // activity, face and bubble must not pop to plain `type` before the startle / victory plays (one visible change).
    if (eIn.status === 'working') workEnt = eIn;
    const e = workEnt ?? eIn;
    const cls = e.activity?.cls ?? null;
    // §6.5 stations: the dominant phase (not the current tool) decides; the 2× rule keeps commutes honest.
    const target = hq ? stationTarget(cls, env) ?? home : home;
    const atTarget = !!(env && target && env.self.settledAt === target.id);
    intent.slot = target;
    if (st && target === st.slot) {
      const a = STATION_ACTIVITY[st.sid];
      intent.activity = (a && (target.pose === 'sit' ? a.sit : a.stand)) ?? a?.stand ?? a?.sit ?? pick(CLS_ACTIVITY, cls) ?? 'type';
      if (atTarget && !st.arrived) st.arrived = true;
    } else {
      intent.activity = pick(CLS_ACTIVITY, cls) ?? 'type';
      if (cls === 'bash' && a0Since(e) && curNow - a0Since(e) > 10_000) intent.activity = 'bashWatch'; // §6.5 long Bash
    }
    // The scurry back to the desk is one committed look (after the work-call jolt): determined, whatever it was before.
    intent.face = atTarget ? pick(CLS_FACE, cls) ?? 'focused' : 'determined';
    // §6.5 walking variants: the arms keep doing the tool on a working commute (reading while trotting, …)
    intent.walkActivity = (hq && pick(WALK_ACTIVITY, cls)) || 'walkType';
    intent.speed = atTarget ? T.scurrySpeed : state.phase === 'workCall' ? T.workCallSpeed : T.scurrySpeed;
    intent.trip = state.phase === 'workCall' ? 'workCall' : st && target === st.slot ? 'station' : null;
    intent.energy = P.energy * 1.1;
    intent.glyph = cls; // honesty backstop: always the CURRENT tool class, at a station or mid-walk
    intent.lamp = 'work';
    const a = e.activity;
    const think = cls === 'think';
    setBubble(`w|${cls}|${a?.tool ?? ''}|${a?.detail ?? ''}`, () => ({
      kind: think ? 'thought' : 'speech', icon: cls ?? 'talk', title: think ? 'thinking…' : a?.tool ?? cls ?? 'working', detail: a?.detail || undefined, priority: 1,
    }));
    liveliness(env, { seated: atTarget && target.pose === 'sit', working: true, sleeping: false });
    if (st && target === st.slot) return atTarget ? `station:${st.sid}` : 'toStation';
    return atTarget ? 'working' : state.phase === 'workCall' ? 'workCall' : 'toDesk';
  }

  /**
   * §6.5: sample the tool class, keep / chain / end the station visit. Returns the station slot, or null (desk).
   * Full station → desk variant; the cooldown starts when a visit ends.
   */
  function stationTarget(cls: string | null, env: BrainEnv | null | undefined): Slot | null {
    if (!tracker) return null; // (office only)
    tracker.sample(cls, curNow);
    // [BRN fix m2-r1] the walk budget's books: working time, and how much of it this actor spent walking
    if (lastWorkNow > 0) tracker.account(Math.min(0.5, (curNow - lastWorkNow) / 1000), !!env?.self.moving);
    lastWorkNow = curNow;
    const key = tracker.key();
    const want = key ? KEY_STATION[key] : null;
    if (st) {
      if (want === st.sid && director.holds(id, st.slot.id)) return st.slot;
      const prev = st.sid, was = st.slot;
      if (st.arrived) tracker.visitEnded(curNow);
      director.unclaim(id);
      st = null;
      // chain: straight to the next dominant phase's station if the 2× rule passes (no cooldown between)
      if (want && want !== prev) return goStation(want, true, was);
      return null;
    }
    if (want && state.phase !== 'workCall') return goStation(want, false, null);
    return null;
  }
  /** starts a station visit: the reserved slot, or null (too far, or full: desk variant) */
  function goStation(sid: string, chain: boolean, from: Slot | null): Slot | null {
    if (!tracker || !director.station?.(sid)) return null;
    const hd = hqDir();
    const tr = hd.travelS(id, sid);
    if (!Number.isFinite(tr) || !tracker.worthTrip(tr, curNow, chain)) return null;
    const slot = hd.reserveStation(id, sid, from ? hd.approach(from) : undefined);
    if (!slot) return null; // full: desk variant
    st = { sid, slot, arrived: false };
    tripSeq++;
    return slot;
  }

  function blocked(e: Entity, now: number, env: BrainEnv | null | undefined, home: Slot | null): string {
    const age = now - (e.statusSince ?? now);
    const pin = age >= T.blockedChairMs ? director.pinFor(id) : null;
    intent.lamp = 'blocked';
    intent.outline = BLOCKED_OUTLINE;
    intent.energy = P.energy * 1.3;
    intent.speed = T.scurrySpeed;
    intent.walkActivity = null;
    const q = e.prompt?.question || 'needs you';
    const sec = Math.floor(age / 1000);
    setBubble(`b|${q}|${sec}`, () => ({ kind: 'alert', icon: '!', title: q, detail: mmss(age, e.statusSinceApprox), priority: 3 }));
    if (pin) {
      const t = env?.t ?? 0;
      intent.slot = pin;
      // Stand 3/4 toward the spawn view (not back-to-room at the counter) so the status reads from every pose; alternate a
      // "hey!" wave with a raised-hand hold (ART §5.1: arm straight up in every frame, never a neutral arms-down pose),
      // and look back over the shoulder at the player / the room now and then.
      intent.turn = T.queueTurn * wrapA((director.faceSpawn ?? director.faceRoom)(pin.pos) - pin.yaw);
      const cyc = (t + swivelPhase) % T.queueCycleS;
      // [BRN fix m2-r1] only the head (NOW SERVING) waves / holds its hand up and taps the bell (gameplay review m2: four
      // raised arms hid the Big Board from the counter); the rest wait their turn: foot tap, watch check, glance back
      const head = !director.queueHead || director.queueHead() === id;
      intent.activity = !head ? 'queueWait' : cyc < T.queueWaveS ? 'waveBlocked' : 'queueHandUp';
      intent.face = age > 120_000 && cyc >= T.queueWaveS ? 'determined' : 'worried';
      // Tap the bell every 20 s: CHR's `bellTap` keeps the blocked face and the raised hand (never hop's ^_^, §6.7).
      if (head && env && sec > 0 && sec % T.bellTapS === 0 && env.t - lastWaveAt > 2) { lastWaveAt = env.t; push('bellTap'); }
      liveliness(env, { seated: false, working: true, sleeping: false });
      const lb = (t + swivelPhase * 0.7) % T.lookBackS;
      if (env && lb < T.lookBackHoldS) {
        const pl = env.player;
        if (pl && pl.dist < 10) lookAtPos(pl.pos, 1.1);
        else { const c = director.center; lookV.x = c.x; lookV.y = 0.9; lookV.z = c.z; intent.look = lookV; }
      } else if (intent.look && !(env?.player && env.player.dist < T.playerLookRadius)) intent.look = null; // hold the 3/4 turn
      return 'queue';
    }
    intent.slot = home;
    intent.stand = true;
    intent.activity = 'waveBlocked';
    intent.face = (env?.t ?? 0) % 1.6 < 0.8 ? 'worried' : 'surprised';
    // lane + rug full (§6.4.4): waits at its desk on the chair; the ticket says so
    if (age >= T.blockedChairMs && director.queueFull?.(id)) setBubble(`bf|${q}|${sec}`, () => ({ kind: 'alert', icon: '!', title: q, detail: `${mmss(age, e.statusSinceApprox)} · queue full`, priority: 3 }));
    intent.look = null;
    const pl = env?.player;
    if (pl && pl.dist < 6) lookAtPos(pl.pos, 1.1); // "hey! you!"
    return age >= T.blockedChairMs ? 'queueFull' : 'chair';
  }

  /** [BRN fix m2-fix1] statusSince of a done stay first seen at cold start with an unknown age (no desk victory) */
  let coldDone = NaN;
  function done(e: Entity, now: number, env: BrainEnv | null | undefined, home: Slot | null, atHome: boolean): string {
    const age = now - (e.statusSince ?? now);
    // Off to the Pit: a happy, bouncy skip with free arms (a laptop-typing walk would read as `working`, §6.7).
    intent.energy = P.energy * (env?.self.moving ? 1.3 : 1);
    intent.speed = T.doneWalkSpeed;
    intent.walkActivity = null;
    intent.gait = 'skip';
    intent.face = 'happy';
    setBubble('', null);
    if (promptCall) { const ph = promptRun(env, home, atHome); if (ph) return ph; } // [BRN M3.5]
    // (a pod-mate is on its way for a high-five, social.ts: wait for it at the desk, at most 4 s more)
    // ([BRN fix m2-fix1] cold start with an unknown done age: already lounging in the Pit, no desk victory, §6.4.3)
    if (coldDone !== e.statusSince && (age < T.doneVictoryMs || (env?.hold && age < T.doneVictoryMs + 4000))) {
      intent.slot = home;
      intent.activity = restAct(home);
      liveliness(env, { seated: atHome, working: false, sleeping: false });
      return 'victory';
    }
    const pin = director.pinFor(id);
    const standing = !!pin && pin.pose !== 'sit';
    intent.slot = pin ?? home;
    if (summon) { const ph = summonRun(env, pin ?? home); if (ph) return ph; } // [BRN M3.5] §6.9 R: comes over, then back to the Pit
    // [BRN M3.5] a done lounger cast in a point scene (a Board huddle, the rally audience): its Pit seat stays held
    const g = env?.gig;
    // (time spent in scenes shifts the stay's own outing schedule: a huddle / rally never eats an outing)
    if (gigAccSince !== cSince) { gigAccSince = cSince; gigAcc = 0; }
    const acc = () => { gigAcc += Math.min(500, Math.max(0, now - gigAccNow)); };
    if (hq && pin && g?.mode === 'done' && !g.tag) { const ph = gigRun(g, env, pin); if (ph) { acc(); gigAccNow = now; return ph; } }
    else if (gig && !(g?.mode === 'done' && g.tag)) { endGig(); postGig = { spot: null, tag: '', t0: 0, t1: curNow }; }
    const stint = hq && pin ? regularStint(env, pin) : null;
    if (stint && !regWasRegular) acc(); // (a showcase stint is an outing in all but name: it does not shift them)
    gigAccNow = now;
    const out = stint ?? (hq && pin && postGig ? postGigOuting(env, pin) : null) ?? (hq && pin ? doneOuting(age - gigAcc, env, pin) : null);
    if (out) return out;
    // Arriving in the Pit: high-five a done neighbour already lounging there (the lounge grows into a little party).
    if (hq && pin && env?.self.settledAt === pin.id && pitGreeted !== pin.id) {
      pitGreeted = pin.id;
      const n = env.neighbours.find((q) => q.status === 'done' && q.seated && Math.hypot(q.pos.x - env.self.pos.x, q.pos.z - env.self.pos.z) < T.highFiveR);
      if (n) { push('highFive'); env.poke?.(n.id, 'highFive'); lookAtPos(n.pos, 0.7); env.emit?.('highFive'); } // (counted, social.ts)
      else push('hop');
      env.emit?.('pitArrive'); // the others clap in turn around the ring (social.ts welcome wave)
    }
    // Sofa full → a stand-around spot on the lounge rug (never the desk chair, where done would read as idle/working).
    intent.activity = standing ? 'standLounge' : 'lounge';
    const sleepy = age >= T.doneNapMs && !standing;
    if (sleepy) { intent.face = 'sleepy'; intent.outline = SLEEP_OUTLINE; intent.energy = 0.4; }
    liveliness(env, { seated: !standing, working: false, sleeping: sleepy });
    if (standing && env?.self.settledAt && env.t >= nextCheerAt) { // a happy little clap / hop now and then
      if (nextCheerAt) push(fr() < 0.5 ? 'clap' : 'hop');
      nextCheerAt = env.t + range(T.cheerS);
    }
    const pl = env?.player;
    if (!sleepy && pl && pl.dist < T.waveRadius && env.t - lastWaveAt > T.waveCooldownS && env.self.settledAt) {
      lastWaveAt = env.t;
      push('wave');
    }
    return pin ? (sleepy ? 'pitNap' : standing ? 'pitStand' : 'pit') : 'doneAtDesk';
  }

  /**
   * [BRN fix r2] A done agent lounging in the Pit takes a short outing now and then (seeded per done stay): a cocoa
   * refill at the Café, a peek into an amenity bay, a bounce on the Nap Nook bunks — pennant and happy face along — and
   * skips back to its Pit seat, which stays held (the pin). Returns the phase, or null (in the Pit).
   */
  function doneOuting(age: number, env: BrainEnv | null | undefined, pin: Slot): string | null {
    const hu = (k: string) => (hash32(`${id}|outing|${k}|${cSince}`) % 10007) / 10007;
    const at0 = T.doneOutingAtMs[0] + hu('at') * (T.doneOutingAtMs[1] - T.doneOutingAtMs[0]);
    const k = Math.floor((age - at0) / (1000 * T.doneOutingEveryS));
    const start = at0 + k * 1000 * T.doneOutingEveryS;
    const end = start + 1000 * (T.doneOutingS[0] + hu(`len${k}`) * (T.doneOutingS[1] - T.doneOutingS[0]));
    const key = `${cSince}|${k}`;
    // [BRN fix m2-r1] a slide ride under way (Pit → stairs → whee → back) always finishes, even past its window
    const riding = outing?.tag === 'slide' && outing.spot && slideStage < 3 && (slideStage > 0 || (env?.self.level ?? 0) === 1);
    if (riding) return slideOuting(env, pin);
    if (outing?.spot && outing.key !== key) { director.unclaim(id); outing.spot = null; }
    // [BRN fix m2-r1] the first outing of every stay always happens (the Café or the street: those poses were empty in
    // every review sample); later ones are seeded by doneOutingShare
    if (age < at0 || age >= end || (k > 0 && hu(`go${k}`) >= T.doneOutingShare) || (outing && outing.key === key && !outing.spot)) return null;
    // [BRN fix m2-fix1] the Pit is the done agents' default rest: an outing starts only while T.pitKeep others lounge there
    if ((!outing || outing.key !== key) && env?.pitSpare && !env.pitSpare()) return null;
    let cur = outing;
    if (!cur || cur.key !== key) {
      cur = outing = { key, spot: null, tag: '' };
      // weighted (seeded) with a freshness bias — a destination the office visited less lately weighs more — the first
      // tag with a free spot within the outing cap of the seat wins
      const near = director.approach?.(pin) ?? pin.pos;
      const cand = Object.entries(DONE_OUTING_WEIGHTS).filter(([t]) => director.chillTags.includes(t))
        .map(([t, w]): [string, number] => [t, (w / (1 + (director.tagVisits?.(t) ?? 0))) * (t === 'slide' && (director.tagIdleMs?.('slide', curNow) ?? 0) > T.slideDroughtMs ? 6 : 1)]);
      let u = hu(`tag${k}`) * cand.reduce((a, [, w]) => a + w, 0);
      // the first outing of a stay: a cocoa refill at the Café or a stroll down Studio Street (the review's empty poses),
      // then a bounce on the Nap Nook bunks, a slide ride or a peek into an amenity bay; after that, anything (weighted)
      const h2 = hu('second');
      // ([BRN fix m2-r2] an empty Café wins the first outing outright)
      // ([BRN fix m2-fix1] with the Café already in use, the first outing goes to the least visited far room instead:
      // Studio Street, the Nap Nook bunks or an amenity bay — they keep their visitors now that outings are rarer)
      const far = ['street', 'bunk', 'amenity'].filter((t) => director.chillTags.includes(t)).sort((a, b) => (director.tagVisits?.(a) ?? 0) - (director.tagVisits?.(b) ?? 0))[0] ?? 'street';
      const firstTag = k === 0 ? (env?.roomEmpty?.('CAF') || (!env?.roomEmpty && hu('cocoa') < T.doneCocoaShare) ? 'caf' : far) : k === 1 ? (h2 < 0.5 ? 'bunk' : h2 < 0.8 ? 'slide' : 'amenity') : null;
      const first = firstTag && cand.some(([t]) => t === firstTag) ? cand.findIndex(([t]) => t === firstTag) : cand.findIndex(([, w]) => (u -= w) <= 0);
      for (let j = 0; j < cand.length && !cur.spot; j++) {
        const tag = cand[(Math.max(0, first) + j) % cand.length][0];
        const s = director.claim(id, tag, near, T.outingCapM, { withPin: true });
        if (s) { cur.spot = s; cur.tag = tag; }
      }
      if (!cur.spot) return null;
      if (cur.tag === 'slide') { slideStage = 0; slideT = 0; }
    }
    const spot = cur.spot;
    if (!spot || !director.holds(id, spot.id)) { cur.spot = null; return null; } // (a kept outing always has its spot)
    if (cur.tag === 'slide') return slideOuting(env, pin);
    intent.slot = spot;
    intent.activity = cur.tag === 'cafe' && spot.pose !== 'sit' ? 'coffee' : pickActivity(cur.tag, spot);
    liveliness(env, { seated: spot.pose === 'sit' && env?.self.settledAt === spot.id, working: false, sleeping: false });
    stayBeat(env, spot, env?.self.settledAt === spot.id, 'awake'); // [BRN fix m2-r3]
    return `outing:${cur.tag}`;
  }
  /** [BRN fix m2-r1] a done agent's slide outing: up the stairs, whee, a happy beat, back to its (held) Pit seat */
  function slideOuting(env: BrainEnv | null | undefined, pin: Slot): string | null {
    const o = outing;
    if (!o?.spot) return null; // (only entered with a slide outing under way)
    const r = rideSlide(env, o.spot, pin);
    if (r) return `outing:${r}`;
    o.spot = null; // stage 3: the claim is released; back to the Pit
    intent.slot = pin;
    return null;
  }
  /** the current done stay's outing: {key: statusSince of the stay, spot, tag} */
  let outing: Outing | null = null;
  /** [BRN M3.5] ms of the current done stay spent in social scenes (the outing schedule runs on the rest) */
  let gigAcc = 0, gigAccSince = -1, gigAccNow = 0;
  /**
   * [BRN fix m2-r2] A done agent cast as a showcase room's regular (social.ts: a Café cocoa, a Library read, a lap of
   * the street) — an outing in all but its timing: the Pit seat stays held (the pin), pennant and happy face along.
   * Returns the phase, or null (no stint: the seeded outings / the Pit).
   */
  let regSpot: Slot | null = null, regKey = 0, regWasRegular = false;
  /**
   * [BRN M3.5] A done agent back from a scene (a rally, a huddle, the audience) takes one of its outings right away — to
   * the room the office visited least lately (the Café, the Nap Nook bunks, an amenity bay) — so a scene never costs the
   * far rooms their visitors: {spot, tag, t0 (settled at, ms), t1 (started, ms)}
   */
  let postGig: PostGig | null = null;
  function postGigOuting(env: BrainEnv | null | undefined, pin: Slot): string | null {
    const pg = postGig;
    if (!pg) return null; // (only entered with a postGig)
    // [BRN fix m2-fix1] back from a scene: straight to the Pit seat unless T.pitKeep others lounge there
    if (!pg.spot && env?.pitSpare && !env.pitSpare()) { postGig = null; return null; }
    if (!pg.spot) {
      const near = director.approach?.(pin) ?? pin.pos;
      // (an empty Café first — the showcase dwell floor — else the least visited of the far rooms)
      const cafFirst = !!env?.roomEmpty?.('CAF');
      const tags = T.postGigTags.filter((t) => director.chillTags.includes(t))
        .sort((a, b) => (cafFirst ? Number(b === 'caf') - Number(a === 'caf') : 0) || (director.tagVisits?.(a) ?? 0) - (director.tagVisits?.(b) ?? 0));
      for (const tag of tags) { const s = director.claim(id, tag, near, T.outingCapM, { withPin: true }); if (s) { pg.spot = s; pg.tag = tag; break; } }
      if (!pg.spot) { postGig = null; return null; }
      if (outing?.spot) outing = null;
    }
    const spot = pg.spot, settled = !!(env && env.self.settledAt === spot.id);
    if (settled && !pg.t0) pg.t0 = curNow;
    const len = 1000 * (T.doneOutingS[0] + ((hash32(`${id}|pg|${pg.t1}`) % 1000) / 1000) * (T.doneOutingS[1] - T.doneOutingS[0]));
    if (!director.holds(id, spot.id) || (pg.t0 && curNow - pg.t0 > len) || curNow - pg.t1 > len + 40_000) {
      if (director.holds(id, spot.id)) director.unclaim(id);
      postGig = null;
      return null;
    }
    intent.slot = spot;
    intent.activity = pg.tag === 'caf' && spot.pose !== 'sit' ? 'coffee' : pickActivity(pg.tag, spot);
    liveliness(env, { seated: spot.pose === 'sit' && settled, working: false, sleeping: false });
    stayBeat(env, spot, settled, 'awake');
    return `outing:${pg.tag}`;
  }
  function regularStint(env: BrainEnv | null | undefined, pin: Slot): string | null {
    const g = env?.gig;
    // [BRN M3.5] any claim gig of a done agent (a showcase stint, a ping-pong rally), not only a regular's
    if (!g?.tag || g.mode !== 'done') {
      if (regSpot) {
        if (director.holds(id, regSpot.id)) director.unclaim(id);
        if (!regWasRegular) postGig = { spot: null, tag: '', t0: 0, t1: curNow }; // [BRN M3.5] after a game: an outing
        regSpot = null; regKey = 0;
      }
      return null;
    }
    regWasRegular = !!g.regular;
    if (regKey !== g.key) {
      regKey = g.key;
      if (outing?.spot) { director.unclaim(id); outing = null; } // ([BRN M3.5] re-picked after the stint, if its window lasts)
      postGig = null; // (the claim below replaces its spot)
      if (g.maxLen !== undefined) director.unclaim(id); // ([BRN fix m2-fix1] a cameo: its one spot, not a held one elsewhere)
      regSpot = director.claim(id, g.tag, g.near, g.maxLen ?? 60, { withPin: true });
      if (g.spotId && regSpot && regSpot.id !== g.spotId) { director.unclaim(id); regSpot = null; } // (that one or none)
      if (!regSpot) { state.declined = g.key; return null; }
    }
    if (!regSpot || !director.holds(id, regSpot.id)) { regSpot = null; state.declined = g.key; return null; }
    intent.slot = regSpot;
    intent.speed = g.speed ?? T.doneWalkSpeed;
    const settled = !!(env && env.self.settledAt === regSpot.id);
    intent.activity = pickActivity(g.tag, regSpot);
    liveliness(env, { seated: regSpot.pose === 'sit' && settled, working: false, sleeping: false });
    socialSpot(env, settled, g.tag, regSpot);
    intent.face = 'happy';
    stayBeat(env, regSpot, settled, 'awake'); // [BRN fix m2-r3]
    return `outing:${g.tag}`;
  }

  function idle(e: Entity, now: number, env: BrainEnv | null | undefined, home: Slot | null, atHome: boolean): string {
    const since = e.statusSince ?? now;
    const age = now - since;
    const seed = hash32(`${seedKey ?? id}|${since}`);
    const seg = hq
      ? staggered(seed, age, now) ?? idleSegment(hqCfg(seed), sch, age)
      : idleSegment({ seed, tags, fav: P.favoriteSpot, chatty: P.chatty }, sch, age);
    intent.speed = T.walkSpeed;
    intent.walkActivity = null;
    intent.energy = P.energy * 0.9;
    intent.face = 'neutral';
    setBubble('', null);
    const lvl: 0 | 1 | 2 | 3 = age >= T.dustMs[2] ? 3 : age >= T.dustMs[1] ? 2 : age >= T.dustMs[0] ? 1 : 0;
    intent.dust = e.statusSinceApprox && lvl > 1 ? 1 : lvl;
    if (promptCall) { const ph = promptRun(env, home, atHome); if (ph) return ph; } // [BRN M3.5]
    if (summon) { if (chatHost || chatWith) endChat(); const ph = summonRun(env, home); if (ph) return ph; }

    if (chatHost) {
      // Someone came over to chat: stay seated, swivel toward them, alternate glyph bubbles.
      intent.slot = home; intent.activity = idleRest(home); intent.face = 'happy';
      chatBubbles(env, false);
      liveliness(env, { seated: true, working: false, sleeping: false, fidget: true });
      const v = env?.partner(chatWith ?? '');
      if (!env || env.t > chatUntil || !v || v.chattingWith !== id) endChat();
      return 'chatHost';
    }
    if (hq) return idleHq(seg, age, env, home, atHome);

    if (seg.idx !== pickIdx) {
      releasePick();
      if (chatWith) endChat();
      pickIdx = seg.idx;
      pickKind = seg.kind;
      if (seg.kind === 'desk') pickSpot = home;
      else if (seg.kind === 'nap') pickSpot = seg.tag === 'sofa' ? (director.claim(id, 'sofa', home?.pos) ?? home) : home;
      else pickSpot = resolvePick(seg.tag, seg.r, env, home);
    }
    // A claim can be evicted by a pin (a done agent needs the seat) → go home.
    if (pickSpot && pickSpot !== home && pickSpot !== virt && !director.holds(id, pickSpot.id)) pickSpot = home;
    const spot = pickSpot ?? home;
    intent.slot = spot;

    if (pickKind === 'nap') {
      const onSofa = spot && spot !== home;
      intent.activity = onSofa ? 'lounge' : 'sleepDesk';
      intent.face = 'sleepy';
      intent.outline = SLEEP_OUTLINE;
      intent.energy = 0.4;
      liveliness(env, { seated: true, working: false, sleeping: true });
      // Walking past a sleeper within 1.5 m wakes it briefly (ART §6.4 idle > 10 min).
      if (env?.player && env.player.dist < 1.5 && env.t - lastWaveAt > 20) { lastWaveAt = env.t; push('wake'); }
      return onSofa ? 'napSofa' : 'napDesk';
    }
    if (!spot || spot === home) { // (no spot means no home either)
      intent.activity = idleRest(home);
      // Lazy chair swivel while leaning back (the look/swivel logic overrides it while glancing at something).
      if (home?.pose === 'sit' && env) intent.turn = T.idleSwivel * Math.sin(env.t * T.idleSwivelHz * Math.PI * 2 + swivelPhase);
      liveliness(env, { seated: atHome, working: false, sleeping: false, fidget: true });
      return age < T.idleDeskMs ? 'idleDesk' : 'chillDesk';
    }
    if (spot === virt && virt.tag === 'chat') {
      intent.activity = 'standIdle'; // standing chat: look-at + glyph bubbles + reactions
      intent.face = 'happy';
      chatBubbles(env, true);
      liveliness(env, { seated: false, working: false, sleeping: false });
      if (env && (env.t > chatUntil || !env.partner(chatWith ?? ''))) { endChat(); pickSpot = home; }
      return 'chat';
    }
    intent.activity = SPOT_ACTIVITY[spot.tag] ?? (spot.pose === 'sit' ? 'lounge' : 'standIdle');
    liveliness(env, { seated: spot.pose === 'sit' && !!env?.self.settledAt, working: false, sleeping: false });
    return `${pickKind}:${spot.tag}`;
  }

  /** The full-office idle config (roaming-capped weights + nap shares), one object per seed / weights change. */
  let hqCfgObj: IdleCfg | null = null, hqCfgSeed = 0, hqCfgW: HqPicks | null = null;
  function hqCfg(seed: number): IdleCfg {
    const w = hqWeights();
    if (!hqCfgObj || hqCfgSeed !== seed || hqCfgW !== w) {
      hqCfgSeed = seed; hqCfgW = w;
      hqCfgObj = { seed, tags, fav: P.favoriteSpot, chatty: P.chatty, napTag: 'napSpot', napDeskShare: T.napDeskShare, ...w };
    }
    return hqCfgObj;
  }
  /**
   * [BRN fix m2-r1] The staggered 10–60 min tier (§6.4.1; gameplay review m2: in `longIdle` 3 of 4 agents dozed at once
   * and the Pit / café / street stayed empty). All long-idle agents share one nap / hobby cycle (TUNING.idleCycleS) and
   * each is offset by its rank k / n among them (director.idleRank): a hobby window of share max(0.4, 1/n + 0.08) means
   * with n ≥ 2 somebody is always up and about. Deterministic (server clock + id order): two windows agree. null = the
   * plain per-agent ladder (below 10 min, or the director has not ranked it yet).
   */
  const stag: IdleSeg = { kind: 'nap', tag: 'desk', r: 0, start: 0, end: 0, idx: -1, walk: false };
  function staggered(seed: number, age: number, now: number): IdleSeg | null {
    if (age < T.idleChillMs) return null;
    const rk = director.idleRank?.(id);
    if (!rk || rk.n < 1) return null;
    const Pd = 1000 * T.idleCycleS;
    const h = rk.n >= 2 ? Math.min(0.55, Math.max(0.4, 1 / rk.n + 0.08)) : 0.4;
    const x = now / Pd + rk.k / rk.n;
    const c = Math.floor(x), u = x - c;
    const hobby = u < h;
    const idx = 1_000_000 + c * 2 + (hobby ? 0 : 1);
    if (stag.idx !== idx) {
      const cfg0 = hqCfg(seed);
      const rng = mulberry32(hash32(`${seed}|stag|${c}|${hobby ? 1 : 0}`));
      stag.idx = idx;
      stag.kind = hobby ? 'hobby' : 'nap';
      stag.r = rng();
      stag.tag = hobby ? pickWeighted(cfg0, rng(), false, cfg0.hobby ?? cfg0.weights) : rng() < T.napDeskShare ? 'desk' : 'napSpot';
      stag.walk = !hobby && rng() < T.sleepwalkShare;
      stag.start = age - (hobby ? u : u - h) * Pd;
      stag.end = age + (hobby ? h - u : 1 - u) * Pd;
    }
    return stag;
  }

  /** Roaming-capped pick weights for this actor's home (§6.4.1), cached per home / office layout version. */
  function hqWeights(): HqPicks {
    const hd = hqDir();
    const h = director.slotFor(id);
    const key = `${h?.id ?? ''}|${director.version?.() ?? 0}`;
    if (key === cfgKey && cfg) return cfg;
    cfgKey = key;
    const weights: Record<string, number> = {}, hobby: Record<string, number> = {};
    const nearStairs = director.nearStairs?.(id) ?? false;
    const factor = (tag: string) => {
      const d = hd.tagDist(id, tag);
      if (!Number.isFinite(d)) return null;
      if (d > T.roamCapM && !(hd.farPick(tag) && nearStairs)) return null;
      return 1 / (1 + d / T.roamWeightM);
    };
    for (const [tag, w] of Object.entries(CHILL_WEIGHTS_HQ)) {
      if (tag === 'chat' || tag === 'stroll') { weights[tag] = w; continue; }
      if (!director.chillTags.includes(tag)) continue;
      const k = factor(tag);
      if (k !== null) weights[tag] = w * k;
    }
    for (const [tag, w] of Object.entries(HOBBY_WEIGHTS)) {
      if (!director.chillTags.includes(tag)) continue;
      const k = factor(tag);
      if (k !== null) hobby[tag] = w * k;
    }
    if (weights[P.favoriteSpot]) hobby[P.favoriteSpot] = (hobby[P.favoriteSpot] ?? 0) + weights[P.favoriteSpot];
    if (!Object.keys(hobby).length) hobby.stroll = 1;
    // [BRN fix r2] outings: tags past the roaming cap but within outingCapM, at a low weight (long chill + hobby tiers)
    const outing: Record<string, number> = {};
    for (const [tag, w] of Object.entries(OUTING_WEIGHTS)) {
      if (!director.chillTags.includes(tag) || weights[tag] !== undefined) continue;
      const d = hd.tagDist(id, tag);
      if (Number.isFinite(d) && d <= T.outingCapM) outing[tag] = w * T.outingWeight / (1 + d / T.roamWeightM);
    }
    const hobbyAll = { ...hobby };
    for (const [tag, w] of Object.entries(outing)) hobbyAll[tag] = (hobbyAll[tag] ?? 0) + w;
    cfg = { weights, hobby: hobbyAll, chillLong: { ...weights, ...outing }, outingTags: new Set(Object.keys(outing)) };
    return cfg;
  }

  /** Resolve a full-office pick to a spot (claims are roaming-capped; far picks only for bays near the stairs). */
  function resolveHq(seg: IdleSeg, env: BrainEnv | null | undefined, home: Slot | null): Slot | null {
    const tag = seg.tag;
    if (tag === 'desk') return home;
    // [BRN fix m2-r3] a hobby stretch with the Library empty: now and then a reading chair there (the showcase room's
    // dwell; its armchairs are an outing away from most bays)
    if (seg.kind === 'hobby' && (seg.r * 7.3) % 1 < T.hobbyLibShare && env?.roomEmpty?.('LIB')) {
      const s = director.claim(id, 'libRead', undefined, T.outingCapM);
      if (s) { pickTag = 'libRead'; return s; }
    }
    if (tag === 'stroll' || tag === 'chat') return resolvePick(tag, seg.r, env, home);
    let cap = hqDir().farPick(tag) && director.nearStairs?.(id) ? Infinity : T.roamCapM;
    if (cfg?.outingTags?.has(tag)) cap = Math.max(cap, T.outingCapM); // [BRN fix r2] an outing pick
    if (tag === 'napSpot') {
      // [BRN fix r2] now and then the Nap Nook's proper bunks (an outing), else the nearest nap spot within the cap
      // [BRN fix m2-r3] an empty Library: dozing off over a book in a reading chair (gameplay review m2-r3: the Library
      // regular was seated in 2 of 5 samples; in longIdle most agents nap, so few are free to be cast as regulars)
      if ((seg.r * 13.7) % 1 < T.napLibShare && env?.roomEmpty?.('LIB')) { const s = director.claim(id, 'libRead', undefined, T.outingCapM); if (s) return s; }
      if (seg.r < T.napBunkShare && director.chillTags.includes('bunk')) { const s = director.claim(id, 'bunk', undefined, T.outingCapM); if (s) return s; }
      // [BRN fix m2-r1] a Pit beanbag / sofa nap (the atrium's life; a done agent's pin still evicts the claim)
      if (seg.r < T.napBunkShare + T.napPitShare) for (const t of ['beanbag', 'sofa']) { const s = director.claim(id, t, undefined, T.outingCapM); if (s) return s; }
      const order = ['nap', 'bunk', 'beanbag'].filter((t) => director.chillTags.includes(t)).sort((a, b) => hqDir().tagDist(id, a) - hqDir().tagDist(id, b));
      for (const t of order) { const s = director.claim(id, t, undefined, T.roamCapM); if (s) return s; }
      return home;
    }
    if (tag === 'slide') { slideStage = 0; slideT = 0; }
    return director.claim(id, tag, undefined, cap) ?? home;
  }

  /** Activity at a picked spot: by pick tag, amenity (+ pose) or the spot's own tag. */
  function pickActivity(tag: string, spot: Slot): string {
    const a = PICK_ACTIVITY[spot.amenity && tag === 'amenity' ? spot.amenity : tag] ?? PICK_ACTIVITY[spot.tag];
    if (a && typeof a === 'object') return a[spot.pose] ?? a.stand ?? a.sit ?? a.lie ?? 'standIdle';
    return a ?? SPOT_ACTIVITY[spot.tag] ?? (spot.pose === 'sit' ? 'lounge' : 'standIdle');
  }

  /**
   * The full-office idle ladder (§6.4.1): parcel run first (after a sign-off), then the deterministic segment's pick —
   * chill (coffee, games, the slide, the telescope …), nap (desk / bay nap spot / bunk / Pit beanbag, 10 % sleepwalks),
   * hobby (amenity bays, board game, stargazing, cataloguing, vault nap). Two idle agents at social spots chat.
   */
  function idleHq(seg: IdleSeg, age: number, env: BrainEnv | null | undefined, home: Slot | null, atHome: boolean): string {
    if (parcel) return parcelRun(env, home);
    const g = env?.gig ?? null;
    const ridingNow = pickTag === 'slide' && pickSpot && pickSpot !== home && slideStage > 0 && slideStage < 3;
    if (g && !ridingNow && !victoryLap) { const ph = gigRun(g, env, home); if (ph) return ph; }
    else if (gig) endGig();
    if (victoryLap) {
      // the shipping victory lap: stairs up, the slide home (a chill pick in all but name; this segment only)
      victoryLap = false;
      releasePick();
      const s2 = director.claim(id, 'slide', undefined, Infinity);
      if (s2) { pickIdx = seg.idx; pickKind = 'chill'; pickTag = 'slide'; pickSpot = s2; slideStage = 0; slideT = 0; }
    }
    // [BRN fix r1] a slide ride under way (up the stairs, riding, the happy beat) finishes before the next pick: the
    // idle schedule's segment boundary used to cancel it on the mezzanine (up the stairs, then back down them)
    const riding = pickTag === 'slide' && pickSpot && pickSpot !== home && slideStage < 3;
    if (seg.idx !== pickIdx && !riding) {
      releasePick();
      if (chatWith) endChat();
      pickIdx = seg.idx;
      pickKind = seg.kind;
      pickTag = seg.tag;
      walkIdx = -1;
      pickSpot = seg.kind === 'desk' ? home : resolveHq(seg, env, home);
    }
    if (pickSpot && pickSpot !== home && pickSpot !== virt && !director.holds(id, pickSpot.id)) pickSpot = home; // evicted
    let spot = pickSpot ?? home;
    const settled = !!(env && env.self.settledAt === spot?.id);

    if (pickKind === 'nap' && spot) {
      // 10 % of naps start as a sleepwalk: eyes shut, arms forward, a ≤ 10 m loop at 0.4 m/s round the desk, then the nap
      if (seg.walk && age - seg.start < sleepwalkMs(seg)) {
        intent.slot = sleepwalkPoint(env, home);
        intent.speed = T.sleepwalkSpeed; intent.walkActivity = 'sleepwalk'; intent.activity = 'sleepwalk';
        intent.face = 'sleepy'; intent.outline = SLEEP_OUTLINE; intent.energy = 0.35;
        liveliness(env, { seated: false, working: false, sleeping: true });
        return 'sleepwalk';
      }
      intent.slot = spot;
      if (env && env.t < wakeUntil) { // [BRN M3.5] patted awake (§6.9 Q on a sleeper): up for a while, blinking
        intent.activity = spot.pose === 'sit' || spot === home ? 'sitIdle' : spot.pose === 'lie' ? 'lounge' : 'standIdle';
        intent.face = 'surprised';
        liveliness(env, { seated: spot.pose !== 'stand', working: false, sleeping: false });
        return 'napWoke';
      }
      intent.activity = spot === home ? 'sleepDesk' : spot.tag === 'bunk' ? 'sleepBunk' : spot.amenity === 'napLounge' ? 'hammock' : 'lounge';
      intent.face = 'sleepy';
      intent.outline = SLEEP_OUTLINE;
      intent.energy = 0.4;
      liveliness(env, { seated: true, working: false, sleeping: true });
      stayBeat(env, spot, settled, 'nap'); // [BRN fix m2-r3] a nap stirs now and then (yawn-stretch, roll over)
      if (env?.player && env.player.dist < 1.5 && env.t - lastWaveAt > 20) { lastWaveAt = env.t; push('wake'); }
      return spot === home ? 'napDesk' : `nap:${spot.tag}`;
    }
    if (pickTag === 'slide' && spot && spot !== home) {
      // stairs up → the mouth → ride down (route via the slide) → a happy beat at the exit → home
      const r = rideSlide(env, spot, home);
      if (r) return r;
      spot = home;
    }
    intent.slot = spot;
    if (!spot || spot === home) { // (no spot means no home either)
      intent.activity = idleRest(home);
      if (home?.pose === 'sit' && env) intent.turn = T.idleSwivel * Math.sin(env.t * T.idleSwivelHz * Math.PI * 2 + swivelPhase);
      liveliness(env, { seated: atHome, working: false, sleeping: false, fidget: true });
      return age < T.idleDeskMs ? 'idleDesk' : 'chillDesk';
    }
    if (spot === virt && virt.tag === 'chat') {
      intent.activity = 'standIdle';
      intent.face = 'happy';
      chatBubbles(env, true);
      liveliness(env, { seated: false, working: false, sleeping: false });
      if (env && (env.t > chatUntil || !env.partner(chatWith ?? ''))) { endChat(); pickSpot = home; }
      return 'chat';
    }
    intent.activity = pickActivity(pickTag, spot);
    liveliness(env, { seated: spot.pose === 'sit' && settled, working: false, sleeping: false });
    socialSpot(env, settled, pickTag, spot);
    stayBeat(env, spot, settled, 'awake'); // [BRN fix m2-r3]
    return `${pickKind}:${pickTag}`;
  }

  // ---------------------------------------------------------------------------------------------- in-stay variety
  /**
   * [BRN fix m2-r3] In-stay variety (gameplay review m2-r3: in `longIdle` 4 of 6 agents kept one slot and one activity
   * for 140 s+; P3 'nothing static for 60 s' in behaviour, not only in the idle loop). Settled at a pick / gig /
   * regular / nap spot, the stay runs in beats of TUNING.stayBeatS: the spot's own activity, a variant, the spot's own
   * again, … Awake variants (by pose, weighted, never the base): read, doodle, sip, stretch, yo-yo, a chat with a settled
   * neighbour (face them, glyph bubbles, a wave both ways), petting Segfault when the cat is close. Naps stir: a yawning
   * stretch for TUNING.stirS, or a roll between the curled and the sprawled pose. Shelly at its bench: toys. Call after
   * liveliness() / socialSpot() (it may take over the look and the bubble). Local texture: status signals untouched.
   * `mode`: 'awake' | 'nap' | 'shell'.
   */
  let vSpot: Slot | null = null, vBase: string | null = null, vN = 0, vNext = 0;
  let vAct: string | null = null, vChat: string | null = null;
  const vHash = (k: string) => (hash32(`${id}|v|${vSpot?.id}|${k}`) % 10007) / 10007;
  const beatS = (k: number | string) => T.stayBeatS[0] + vHash(`len${k}`) * (T.stayBeatS[1] - T.stayBeatS[0]);
  let vUsed = false;
  function stayBeat(env: BrainEnv | null | undefined, spot: Slot | null | undefined, settled: boolean, mode: StayMode) {
    vUsed = true;
    const base = intent.activity;
    if (!env || !settled || !spot || spot === virt || env.rally || !base || NO_VARIETY.has(base)) { vSpot = null; vChat = null; vAct = null; return; }
    const t = env.t;
    if (vSpot !== spot || vBase !== base) {
      // a new stay (or the spot's own activity changed): start on the base; the first beat is desynced per actor
      vSpot = spot; vBase = base; vN = 0; vAct = null; vChat = null;
      vNext = t + beatS(0) * (0.6 + 0.4 * vHash('first'));
    }
    if (t >= vNext) {
      vN++;
      vAct = null; vChat = null;
      if (vN % 2 === 1) vAct = pickVariant(env, spot, base, mode);
      vNext = t + (vAct && mode === 'nap' && vAct.startsWith('fidget:') ? T.stirS : beatS(vN));
      if (vAct === 'chat') { push('wave'); if (vChat) env.poke?.(vChat, 'wave'); } // a wave both ways, then the chat
    }
    if (!vAct) return;
    if (vAct === 'chat') {
      const n = vChat ? env.partner(vChat) : null;
      if (!n || n.status !== 'idle' || Math.hypot(n.pos.x - env.self.pos.x, n.pos.z - env.self.pos.z) > 3.2) { vAct = null; vChat = null; return; }
      intent.activity = spot.pose === 'stand' ? 'standIdle' : 'sitIdle';
      intent.face = 'happy';
      if (!(env.player && env.player.dist < T.playerLookRadius)) { lookAtPos(n.pos, 0.7); intent.swivel = spot.pose !== 'stand'; }
      chatBubbles(env, id < n.id);
      return;
    }
    if (vAct === 'petCat') {
      const c = env.cat;
      if (!c || Math.hypot(c.x - env.self.pos.x, c.z - env.self.pos.z) > T.catPetR + 0.6) { vAct = null; return; }
      intent.activity = 'petCat';
      intent.face = 'happy';
      if (!(env.player && env.player.dist < T.playerLookRadius)) lookAtPos(c, 0);
      return;
    }
    intent.activity = vAct;
  }
  /** one variant for beat vN (seeded per actor / spot / beat) */
  function pickVariant(env: BrainEnv, spot: Slot, base: string, mode: StayMode): string | null {
    const u = vHash(`pick${vN}`);
    const pose = spot.pose === 'stand' ? 'stand' : 'sit';
    if (mode === 'shell') return pickFrom(SHELL_TOYS, base, u);
    if (mode === 'nap') {
      // curled ↔ sprawled on a sofa / beanbag / nap spot; elsewhere (the desk, a bunk) a yawning stretch, then back
      if (base === 'lounge' && u < 0.6) return 'hammock';
      if (base === 'hammock' && u < 0.6) return 'lounge';
      return 'fidget:stretch';
    }
    // Segfault close by and on the floor: a standing agent crouches to pet it
    const c = env.cat;
    if (pose === 'stand' && c && Math.abs((c.y ?? 0) - (env.self.pos.y ?? 0)) < 0.4
      && Math.hypot(c.x - env.self.pos.x, c.z - env.self.pos.z) < T.catPetR && u < 0.8) return 'petCat';
    // a settled idle neighbour close by (not already chatting at a social spot): a chat
    if (!state.social && vHash(`chat${vN}`) < 0.45 * P.chatty) {
      for (const n of env.neighbours) {
        if (n.status !== 'idle' || n.chattingWith || Math.hypot(n.pos.x - env.self.pos.x, n.pos.z - env.self.pos.z) > 2.6) continue;
        vChat = n.id;
        return 'chat';
      }
    }
    return pickFrom(pose === 'stand' ? STAND_VARIETY : SIT_VARIETY, base, u);
  }
  function pickFrom(menu: Readonly<Record<string, number>>, base: string, u: number): string | null {
    let total = 0;
    for (const k in menu) if (k !== base) total += menu[k];
    let x = u * total, last: string | null = null;
    for (const k in menu) { if (k === base) continue; last = k; if ((x -= menu[k]) <= 0) return k; }
    return last;
  }

  /**
   * Water-cooler moment: another idle agent settled at a social spot close by → face each other and chat. At the
   * ping-pong table in a rally (social.ts) the eyes follow the ball instead, and a won point is a happy face.
   */
  function socialSpot(env: BrainEnv | null | undefined, settled: boolean, tag: string, spot: Slot) {
    state.social = settled && (SOCIAL_TAGS.has(tag) || SOCIAL_TAGS.has(spot.tag));
    if (!state.social || !env) return;
    if (env.rally) {
      // eyes (and so the standing body) on the ball, even with the player close by: a rally faces the table
      intent.face = 'determined';
      lookAtPos(env.rally, 0);
      setBubble('', null);
      return;
    }
    const n = env.neighbours.find((q) => q.social && Math.hypot(q.pos.x - env.self.pos.x, q.pos.z - env.self.pos.z) < T.socialR);
    if (n) {
      if (!(env.player && env.player.dist < T.playerLookRadius)) lookAtPos(n.pos, 0.7);
      intent.face = 'happy';
      chatBubbles(env, id < n.id);
    }
  }

  // ---------------------------------------------------------------------------------------------- verbs (§6.9)
  /**
   * [BRN M3.5] R summon (§6.9): an idle / done agent skips over to the player, stops summonGapM short facing them, waves,
   * stays summonStayS and goes back (idle: its ladder pick again; done: its Pit seat, still held). The target is where
   * the player stands, re-aimed when they move > 2 m. Only reached from the idle / done branches: any status change
   * ends it on the same frame (update() cancels it). Returns the phase, null = over.
   */
  function summonRun(env: BrainEnv | null | undefined, back: Slot | null): string | null {
    const sm = summon;
    if (!env || !sm) return null;
    const t = env.t, pl = env.player;
    if (t - sm.t0 > T.summonMaxS || (!pl && sm.stage === 'go' && sm.x === undefined)) { summon = null; pickIdx = -1; return null; }
    if (pl && sm.stage === 'go' && (sm.x === undefined || Math.hypot(pl.pos.x - sm.px, pl.pos.z - sm.pz) > 2)) aimSummon(env, pl, sm);
    // [BRN fix m3-r2] never into the player's face: inside T.attendMinR on the way, it stops (stepped back) right there
    if (pl && sm.stage === 'go' && env.self.moving && pl.dist < T.attendMinR) {
      const q = standBack(env, env.self.pos.x, env.self.pos.z, env.self.level ?? 0);
      sm.x = q.x; sm.z = q.z; sm.level = env.self.level ?? 0;
    }
    const sx = sm.x ?? 0; // (aimed above: the target always exists here)
    const face = pl ? Math.atan2(-(pl.pos.x - sx), -(pl.pos.z - sm.z)) : 0;
    intent.slot = setVirt('summon', sx, sm.z, face, sm.level);
    intent.speed = T.summonSpeed;
    intent.gait = 'skip';
    intent.walkActivity = null;
    intent.face = 'happy';
    intent.activity = 'standIdle';
    const here = env.self.settledAt === virt.id || (!env.self.moving && pl && pl.dist < T.summonGapM + 0.9 && pl.dist >= T.attendMinR - 0.1);
    if (sm.stage === 'go' && here) { sm.stage = 'here'; sm.hereT = t; push('wave'); }
    liveliness(env, { seated: false, working: false, sleeping: false });
    if (pl) lookAtPos(pl.pos, 1.1);
    if (sm.stage === 'here') {
      if (t - sm.hereT > T.summonStayS) { summon = null; pickIdx = -1; push('hop'); intent.slot = back; return null; }
      return 'summoned';
    }
    return 'summon';
  }
  /** the stand point summonGapM from the player, on the agent's side (walkable; else fanned out round the player) */
  function aimSummon(env: BrainEnv, pl: { pos: V3 }, sm: { px: number; pz: number; x: number | undefined; z: number; level: number }) {
    const me = env.self.pos, lv = env.playerLevel ?? 0;
    const dx = me.x - pl.pos.x, dz = me.z - pl.pos.z, d = Math.hypot(dx, dz) || 1;
    const a0 = Math.atan2(dx / d, dz / d);
    sm.px = pl.pos.x; sm.pz = pl.pos.z; sm.level = lv;
    for (const k of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.4, -2.4, Math.PI]) for (const r of [T.summonGapM, T.summonGapM + 0.6]) {
      const x = pl.pos.x + Math.sin(a0 + k) * r, z = pl.pos.z + Math.cos(a0 + k) * r;
      if (!director.walkable || director.walkable(x, z, lv)) { sm.x = x; sm.z = z; return; }
    }
    sm.x = pl.pos.x + (dx / d) * T.summonGapM; sm.z = pl.pos.z + (dz / d) * T.summonGapM;
  }
  /**
   * [BRN M3.5] prompt.sent to an idle / done agent away from its desk (§6.4.2): the work call starts at once (the status
   * flip follows when herdr reports it); `catchPlane` on arrival at the desk (update()).
   */
  function promptRun(env: BrainEnv | null | undefined, home: Slot | null, atHome: boolean): string | null {
    const pc = promptCall;
    if (!env || !home || !pc || env.t > pc.until) return null;
    intent.slot = home;
    if (atHome) { // caught the plane: waits at the desk, upright, for the work to start
      intent.activity = restAct(home); intent.face = 'determined';
      liveliness(env, { seated: true, working: true, sleeping: false });
      return 'promptWait';
    }
    intent.speed = T.workCallSpeed;
    intent.trip = 'workCall';
    intent.walkActivity = 'walkType';
    intent.gait = null;
    intent.face = 'determined';
    intent.activity = idleRest(home);
    intent.energy = P.energy * 1.1;
    liveliness(env, { seated: false, working: true, sleeping: false });
    return 'workCall';
  }

  /**
   * Play a social gig (social.ts): a claim gig takes a pick spot next to whoever invited it (the other ping-pong bat,
   * the coffee cart) and then behaves like that pick; a point gig (watch a rally, congratulate a pod-mate, huddle under
   * the Big Board) walks to a standing point and looks at the scene. Only reached from the idle branch, so a status
   * change ends it at once. Returns the phase, or null = declined (fall through to the idle ladder)
   */
  function gigRun(g: Gig, env: BrainEnv | null | undefined, home: Slot | null): string | null {
    if (!gig || gig.key !== g.key) {
      if (gig?.spot) director.unclaim(id);
      releasePick();
      if (chatWith) endChat();
      gig = { key: g.key, spot: null, failed: false };
      if (g.tag) {
        if (g.maxLen !== undefined) director.unclaim(id); // ([BRN fix m2-fix1] a cameo: its one spot, not a held one elsewhere)
        gig.spot = director.claim(id, g.tag, g.near, g.maxLen ?? 40);
        if (g.spotId && gig.spot && gig.spot.id !== g.spotId) { director.unclaim(id); gig.spot = null; } // (that one or none)
        if (!gig.spot) gig.failed = true;
      }
      if (!gig.failed && g.kind !== 'watch') push(g.kind === 'congrats' ? 'hop' : null); // "oh! yes!" and off it goes
    }
    state.gig = g.key;
    if (gig.failed || (gig.spot && !director.holds(id, gig.spot.id))) { gig.failed = true; state.declined = g.key; return null; }
    const spot = gig.spot ?? setVirt(g.kind, g.x, g.z, g.yaw, g.level ?? 0);
    const settled = !!(env && env.self.settledAt === spot.id);
    intent.slot = spot;
    intent.speed = g.speed ?? T.walkSpeed * 1.4;
    if (g.gait) intent.gait = g.gait;
    intent.face = 'happy';
    intent.energy = P.energy * 1.1;
    if (gig.spot) {
      intent.activity = pickActivity(g.tag ?? '', spot);
      liveliness(env, { seated: spot.pose === 'sit' && settled, working: false, sleeping: false });
      socialSpot(env, settled, g.tag ?? '', spot);
      stayBeat(env, spot, settled, 'awake'); // [BRN fix m2-r3] a regular's long stint is not a still life
      return `gig:${g.tag}`;
    }
    intent.activity = 'standIdle';
    liveliness(env, { seated: false, working: false, sleeping: false });
    if (settled && env) {
      const pl = env.player;
      const L = g.kind === 'watch' && g.look && !g.look.visible ? g.lookRest : g.look;
      if (L && !(pl && pl.dist < T.playerLookRadius && g.kind !== 'congrats')) lookAtPos(L, g.kind === 'congrats' ? 0.7 : 0);
      if (g.chat) chatBubbles(env, !!g.lead, g.icons);
      else setBubble('', null);
    }
    return `gig:${g.kind}`;
  }
  function endGig() {
    if (gig?.spot) director.unclaim(id);
    gig = null;
    state.gig = 0;
    pickIdx = -1; // back to the idle ladder: the current segment's pick resolves again
  }

  const sleepwalkMs = (seg: IdleSeg) => 1000 * (T.sleepwalkS[0] + (seg.r * 7919 % 1) * (T.sleepwalkS[1] - T.sleepwalkS[0]));
  /** A slow ≤ 10 m loop of 4 points round the desk's step-out (deterministic per segment). */
  function sleepwalkPoint(env: BrainEnv | null | undefined, home: Slot | null): Slot {
    const c: { x: number; z: number; level?: number } = home ? director.approach?.(home) ?? home.pos : env?.self.pos ?? { x: 0, z: 0 };
    if (walkIdx !== pickIdx) { walkIdx = pickIdx; walkHop = 0; }
    if (env && env.self.settledAt === virt.id && env.t - walkT > 0.8) { walkHop++; walkT = env.t; }
    else if (env && env.self.settledAt !== virt.id) walkT = env.t;
    const u = mulberry32(hash32(`${id}:sw:${pickIdx}:${walkHop % 4}`))();
    const p = director.wanderPoint(u, c, 2.5);
    return setVirt('sleepwalk', p.x, p.z, u * Math.PI * 2, c.level ?? 0);
  }

  /** Slide pick stages; returns a phase name while riding, null when done (→ home). */
  function rideSlide(env: BrainEnv | null | undefined, spot: Slot, home: Slot | null): string | null {
    const t = env?.t ?? 0;
    intent.speed = T.slideTrotSpeed; // a keen skip up the stairs: the slide is the fun bit
    intent.gait = 'skip';
    intent.face = 'happy';
    if (slideStage === 0) {
      intent.slot = spot; intent.activity = 'standLounge';
      liveliness(env, { seated: false, working: false, sleeping: false });
      if (env?.self.settledAt === spot.id) { slideStage = 1; slideT = t; push('hop'); }
      return 'toSlide';
    }
    if (slideStage === 1) {
      const ex = director.slideExit?.();
      if (!ex) return null;
      intent.slot = ex; intent.via = 'slide'; intent.trip = 'slide'; intent.activity = 'standLounge';
      liveliness(env, { seated: false, working: false, sleeping: false });
      // "whee!" from the mouth down (an idle rider's shout: idle agents' glyph bubbles are chat, never a tool)
      if ((env?.self.level ?? 0) === 1 || env?.self.moving) setBubble('whee', () => ({ kind: 'speech', icon: 'star', title: 'whee!', priority: 0 }));
      if (env?.self.settledAt === ex.id) { slideStage = 2; slideT = t; push('victory'); }
      return 'sliding';
    }
    if (slideStage === 2) {
      setBubble('', null);
      const ex = director.slideExit?.();
      intent.slot = ex ?? null; intent.activity = 'standLounge';
      liveliness(env, { seated: false, working: false, sleeping: false });
      if (t - slideT > T.slideHangS[0] + (P.chatty - 0.5) * (T.slideHangS[1] - T.slideHangS[0])) { slideStage = 3; director.unclaim(id); }
      return 'slideExit';
    }
    return null;
  }

  /**
   * After a sign-off: carry a wrapped parcel to the Mailroom OUTBOX chute, drop it in (§6.4 table), then — the joy of
   * shipping — file its receipt in the Archive drawers next door, or take a victory lap (stairs up, slide home), or
   * just trot home. The pick is seeded per sign-off; any new status cancels the run (work call rules apply).
   */
  function parcelRun(env: BrainEnv | null | undefined, home: Slot | null): string {
    const t = env?.t ?? 0;
    const pr = parcel;
    if (!pr) return idleRestPhase(env, home); // (only entered mid-run)
    if (pr.stage === 'receipt') {
      if (!pr.slot) pr.slot = director.claim(id, 'receipt', undefined, Infinity);
      if (!pr.slot) { parcel = null; return idleRestPhase(env, home); }
      intent.slot = pr.slot; intent.face = 'happy'; intent.speed = T.walkSpeed * 1.4; intent.activity = 'fileNook';
      liveliness(env, { seated: false, working: false, sleeping: false });
      if (env?.self.settledAt === pr.slot.id) {
        if (!pr.t) pr.t = t;
        if (t - pr.t > T.parcelHoldS * 2) {
          director.unclaim(id); parcel = null; pickIdx = -1;
          // [BRN fix r1] receipt filed: often the lap too (Archive → stairs next door → the slide home, which ends by
          // the E-bay back doors, so a work call from it stays short)
          const u2 = (hash32(`${id}|lap|${cSince}`) % 1000) / 1000;
          if (u2 < T.lapAfterReceiptShare && director.chillTags.includes('slide')) victoryLap = true;
        }
      }
      return 'fileReceipt';
    }
    if (pr.stage === 'away') {
      // [BRN fix m3-r2] the exit leads away from the camera: first a few steps straight away from the player (never
      // across the frame toward them), then on to the OUTBOX
      const pl = env?.player;
      if (!pr.away) {
        const self = env?.self;
        pr.away = null;
        if (self && pl && pl.dist < T.exitAwayR && (env.playerLevel ?? 0) === (self.level ?? 0)) {
          const dx = self.pos.x - pl.pos.x, dz = self.pos.z - pl.pos.z, d = Math.hypot(dx, dz) || 1, a0 = Math.atan2(dx / d, dz / d);
          for (const k of [0, 0.35, -0.35, 0.7, -0.7]) {
            const x = self.pos.x + Math.sin(a0 + k) * T.exitAwayM, z = self.pos.z + Math.cos(a0 + k) * T.exitAwayM;
            if (director.walkable?.(x, z, self.level ?? 0) && (!director.inView?.(x, z, self.level ?? 0))) { pr.away = { x, z, level: self.level ?? 0, yaw: Math.atan2(-(x - self.pos.x), -(z - self.pos.z)) }; break; }
          }
        }
        if (!pr.away) pr.stage = 'go';
        pr.t = env?.t ?? 0;
      }
      if (pr.stage === 'away' && pr.away) {
        const q = pr.away;
        intent.slot = setVirt('exit', q.x, q.z, q.yaw, q.level);
        intent.face = 'happy'; intent.gait = 'skip'; intent.speed = T.doneWalkSpeed; intent.walkActivity = 'parcelCarry'; intent.activity = 'standIdle';
        liveliness(env, { seated: false, working: false, sleeping: false });
        const self = env?.self;
        if (!self || self.settledAt === virt.id || Math.hypot(self.pos.x - q.x, self.pos.z - q.z) < 0.4 || (env.t - pr.t) > 6) { pr.stage = 'go'; pr.t = 0; }
        return 'parcelRun';
      }
    }
    if (!pr.slot) pr.slot = director.claim(id, 'outbox', undefined, Infinity);
    if (!pr.slot) { parcel = null; return idleRestPhase(env, home); }
    intent.slot = pr.slot;
    intent.face = 'happy';
    intent.gait = 'skip';
    intent.speed = T.doneWalkSpeed;
    intent.walkActivity = 'parcelCarry';
    intent.trip = 'parcel';
    intent.activity = pr.stage === 'drop' ? 'mailSort' : 'standLounge';
    liveliness(env, { seated: false, working: false, sleeping: false });
    if (pr.stage === 'go' && env?.self.settledAt === pr.slot.id) { pr.stage = 'drop'; pr.t = t; push('hop'); env?.emit?.('ship'); } // [BRN M3.5] cheer the ship
    if (pr.stage === 'drop' && t - pr.t > T.parcelHoldS) {
      director.unclaim(id);
      const u = (hash32(`${id}|ship|${cSince}`) % 1000) / 1000;
      const near = director.nearStairs?.(id); // Archive / slide extras: only bays near the stairs foot (§6.4.1 exemption)
      if (near && u < T.receiptShare && director.chillTags.includes('receipt')) { parcel = { stage: 'receipt', slot: null, t: 0 }; return 'fileReceipt'; }
      parcel = null;
      pickIdx = -1;
      // the lap only from bays near the stairs foot (the §6.4.1 exemption), so a work call from it stays short
      const lapOk = director.nearSlideExit?.(id) ?? near; // [BRN fix r1] the lap ends at the slide exit
      if (lapOk && u < T.receiptShare + T.lapShare && director.chillTags.includes('slide')) victoryLap = true;
    }
    return 'parcelRun';
  }
  function idleRestPhase(env: BrainEnv | null | undefined, home: Slot | null): string {
    intent.slot = home; intent.activity = idleRest(home);
    liveliness(env, { seated: true, working: false, sleeping: false, fidget: true });
    return 'idleDesk';
  }

  function chatBubbles(env: BrainEnv | null | undefined, visitor: boolean, icons: readonly string[] = CHAT_ICONS) {
    if (!env) return;
    const beat = Math.floor(env.t / 1.7);
    const mine = (beat % 2 === 0) === visitor;
    if (!mine) { setBubble('', null); return; }
    if (beat !== chatBubbleFlip) chatBubbleFlip = beat;
    const icon = icons[(hash32(`${id}:${beat}`) >>> 0) % icons.length];
    setBubble(`c|${icon}|${beat}`, () => ({ kind: 'speech', icon, title: '', priority: 0 }));
    if (beat % 5 === 2 && fr() < 0.02) push('hop'); // a laugh bounce now and then
  }

  function unknown(e: Entity, env: BrainEnv | null | undefined): string {
    intent.speed = T.wanderSpeed;
    intent.walkActivity = null;
    intent.face = 'neutral';
    intent.energy = P.energy * 0.7;
    intent.activity = 'confused';
    setBubble('u', () => ({ kind: 'thought', icon: '?', title: '?', priority: 0 }));
    const t = env?.t ?? 0;
    const slotIdx = Math.floor(t / (7 + (hash32(id) % 5)));
    if (slotIdx !== pickIdx || !pickSpot) {
      releasePick();
      pickIdx = slotIdx;
      const u = mulberry32(hash32(`${id}:${slotIdx}`))();
      const sp = hq ? director.signpost : null;
      if (sp && slotIdx % 3 === 2) {
        // full office: stares at the map signpost now and then ("where am I?")
        const a = u * Math.PI * 2, x = sp.x + Math.sin(a) * 1.1, z = sp.z + Math.cos(a) * 1.1;
        pickSpot = setVirt('signpost', x, z, Math.atan2(-(sp.x - x), -(sp.z - z)));
      } else {
        const p = director.wanderPoint(u, undefined, Infinity, hq); // hq: Studio Street ↔ Plaza
        pickSpot = setVirt('wander', p.x, p.z, fr() * Math.PI * 2);
      }
    }
    intent.slot = pickSpot;
    liveliness(env, { seated: false, working: false, sleeping: false });
    if (hq && pickSpot.tag === 'signpost' && env?.self.settledAt === pickSpot.id && !(env.player && env.player.dist < T.playerLookRadius)) {
      const sp = hqDir().signpost;
      if (sp) { lookV.x = sp.x; lookV.y = 1.6; lookV.z = sp.z; intent.look = lookV; }
    }
    return 'wander';
  }

  function shell(e: Entity, now: number, env: BrainEnv | null | undefined, home: Slot | null, atHome: boolean): string {
    const act = e.process?.activity ?? 'prompt';
    if (act !== procAct) {
      if (procAct !== null && !first) push(act === 'prompt' ? 'bow' : 'hop'); // process done / snap back to work
      procAct = act;
      procSince = first ? e.statusSince ?? now : now;
      releasePick();
    }
    intent.glyph = act;
    intent.ring = null;
    intent.lamp = act === 'prompt' ? 'off' : 'work';
    intent.face = act === 'prompt' ? 'neutral' : 'focused';
    intent.energy = P.energy;
    intent.walkActivity = null;
    setBubble('', null);
    const age = now - procSince;
    if (act !== 'prompt') {
      intent.slot = home; intent.activity = SHELL_ACTIVITY[act] ?? 'spinnerWatch'; intent.speed = T.scurrySpeed;
      liveliness(env, { seated: atHome, working: true, sleeping: false });
      return 'shellBusy';
    }
    intent.speed = T.walkSpeed * 0.8;
    // [BRN fix m2-r3] the full office: past shellDozeMs the doze is one of the pocket picks (TUNING.shellDozeShare), not
    // for good (gameplay review m2-r3: two Shellys sat at their benches dozing for the whole longIdle run)
    if (age >= T.shellDozeMs && !hq) {
      intent.slot = home; intent.activity = 'cursorTap'; intent.face = 'sleepy'; intent.energy = 0.4;
      liveliness(env, { seated: true, working: false, sleeping: true });
      return 'shellDoze';
    }
    if (age >= P.shellPocketMs && hq) return shellPocketHq(age - P.shellPocketMs, env, home, age >= T.shellDozeMs);
    if (age >= P.shellPocketMs) {
      // Pocket mode: a pick every 30–90 s (proto room: window / stroll / back at the bench).
      const k = Math.floor((age - P.shellPocketMs) / 60_000);
      if (k !== pickIdx) {
        releasePick();
        pickIdx = k;
        const u = mulberry32(hash32(`${id}:pocket:${k}`))();
        pickSpot = u < 0.35 ? home : resolvePick(u < 0.65 && tags.includes('window') ? 'window' : 'stroll', u, env, home);
      }
      const sl = pickSpot ?? home;
      intent.slot = sl;
      intent.activity = !sl || sl === home ? 'cursorTap' : SPOT_ACTIVITY[sl.tag] ?? 'standIdle';
      liveliness(env, { seated: sl === home, working: false, sleeping: false });
      return 'shellPocket';
    }
    intent.slot = home; intent.activity = 'cursorTap'; intent.speed = T.scurrySpeed;
    liveliness(env, { seated: atHome, working: false, sleeping: false });
    if (hq) stayBeat(env, home, atHome, 'shell'); // [BRN fix m2-r3] bench toys now and then (juggle, spinner, paper)
    return 'shellPrompt';
  }

  /**
   * Shelly pocket mode in the Engine Room (§6.4.1; never leaves ENG): a pick every 30–90 s — tend the racks, read
   * the boiler gauge, water the fern, roll a slow lap along the glass waving at the atrium — or, with another pocket
   * Shelly around, the card game at the break table. The face keeps `>_` (the bench plate carries the true state).
   */
  const pocketSch = { k: -1, end: 0, idx: -1, rng: mulberry32(0), seed: 0, start: -Infinity, u: 0 };
  function shellPocketHq(pocketMs: number, env: BrainEnv | null | undefined, home: Slot | null, dozy = false): string {
    const t = env?.t ?? 0;
    const seed = hash32(`${id}:pocket:${procSince}`);
    if (pocketSch.seed !== seed || pocketMs < pocketSch.start) { Object.assign(pocketSch, { seed, rng: mulberry32(seed), idx: -1, start: -Infinity, end: 0 }); }
    while (pocketMs >= pocketSch.end) {
      pocketSch.idx++; pocketSch.start = pocketSch.end;
      pocketSch.end += 1000 * (T.shellPickS[0] + pocketSch.rng() * (T.shellPickS[1] - T.shellPickS[0]));
      pocketSch.u = pocketSch.rng();
    }
    state.pocket = true;
    intent.speed = T.walkSpeed * 0.7; // a slow roll
    if (pocketSch.idx !== pickIdx) {
      const wasHome = !!home && (pickSpot ?? home) === home && pickIdx >= 0; // [BRN fix m3-r2] (the last pick kept it at its bench)
      releasePick();
      pickIdx = pocketSch.idx;
      const u = pocketSch.u;
      const mates = env?.neighbours.some((n) => n.pocket) ?? false;
      const u2 = (u * 91.7) % 1;
      // (never two dozes in a row, [BRN fix m3-r2] nor a doze straight after bench time: the same seat at the same prompt
      // loop read as one still stay of 70–80 s, P3)
      const pick = dozy && u2 < T.shellDozeShare && pickTag !== 'doze' && !wasHome ? 'doze'
        : mates && u < 0.45 && pickTag !== 'cards' ? 'cards' // ([BRN fix m2-r3] nor two card games: a round, then up)
        : ['rack', 'rack', 'gauge', 'fern', 'glass', 'glass', 'bench'][Math.floor(((u * 7.13) % 1) * 7)];
      pickTag = pick;
      walkHop = 0;
      if (pick === 'bench' || pick === 'doze') pickSpot = home;
      else if (pick === 'gauge' || pick === 'glass') pickSpot = null; // virtual points below
      else pickSpot = director.claim(id, pick, undefined, 20) ?? home;
    }
    let spot = pickSpot;
    if (pickTag === 'gauge' || pickTag === 'glass') {
      const pp = director.pocketPoints?.[pickTag];
      if (!pp?.length) spot = home;
      else {
        if (pickTag === 'glass' && env && env.self.settledAt === virt.id && t - walkT > 2.5) { walkHop++; walkT = t; push('wave'); }
        else if (env && env.self.settledAt !== virt.id) walkT = t;
        const q = pp[walkHop % pp.length];
        spot = setVirt(pickTag, q.x, q.z, q.yaw);
      }
    }
    spot ??= home;
    intent.slot = spot;
    const settled = env?.self.settledAt === spot?.id;
    if (pickTag === 'doze') {
      // ≥ 30 min at prompt (§6.4.1): parked at its bench, screen dimmed, Z's — now one pick among the others
      intent.activity = 'cursorTap'; intent.face = 'sleepy'; intent.energy = 0.4;
      liveliness(env, { seated: true, working: false, sleeping: true });
      return 'shellDoze';
    }
    // [BRN fix m2-r3] the bench pick is toy time (juggling, the spinner, the paper), not the prompt loop again
    // ([BRN fix m3-r2] a pick whose spot was taken falls back to bench toy time too, not the bare prompt loop)
    const pa = PICK_ACTIVITY[pickTag];
    intent.activity = spot === home ? pickFrom(SHELL_TOYS, 'cursorTap', pocketSch.u) : typeof pa === 'string' ? pa : 'standIdle';
    liveliness(env, { seated: spot === home || spot?.pose === 'sit', working: false, sleeping: false });
    if (pickTag !== 'cards') stayBeat(env, spot, !!settled, 'shell'); // [BRN fix m2-r3]
    if (pickTag === 'cards' && settled && env) {
      // drawn suit glyphs in bubbles; a winner ^_^ every ~40 s
      const beat = Math.floor((t + swivelPhase * 3) / 2.6);
      const icon = ['heart', 'star', 'gear', 'check'][(hash32(`${id}:c${beat}`) >>> 0) % 4];
      if (beat % 3 === 0) setBubble(`k|${icon}|${beat}`, () => ({ kind: 'speech', icon, title: '', priority: 0 }));
      else setBubble('', null);
      const round = Math.floor((t + swivelPhase * 6) / 40);
      if (round !== cardRound) { if (cardRound >= 0 && (hash32(`${id}:${round}`) & 3) === 0) { intent.face = 'happy'; push('hop'); } cardRound = round; }
      return 'shellCards';
    }
    return spot === home ? 'shellPocket' : `shellPocket:${pickTag}`;
  }
  let cardRound = -1;

  // ---------------------------------------------------------------------------------------------- API

  return {
    state,
    update(e: Entity, now: number, env?: BrainEnv): Intent {
      const t = env?.t ?? 0;
      curT = t; curNow = now; lastEnv = env ?? null;
      const home = director.slotFor(id);
      const atHome = !!(env && home && env.self.settledAt === home.id);
      state.seated = !!(env?.self.settledAt && (env.self.settledAt === home?.id || /sofa|beanbag/.test(env.self.settledAt)));
      const raw = e.kind === 'shell' ? 'shell' : e.status === 'done' && e.ack ? 'idle' : e.status;

      // Status hysteresis (§6.4): 1.5 s, except the first sight (cold start) and → working while away (§6.4.2).
      if (first) { state.status = raw; pend = null; cSince = e.statusSince; if (raw === 'done' && e.statusSinceApprox) coldDone = e.statusSince; }
      else if (raw !== state.status) {
        if (pend !== raw) { pend = raw; pendAt = t; beat = null; if (BEAT_STATUS[raw]) earlyBeat(raw); }
        const immediate = raw === 'working' && (!atHome || !!promptCall); // ([BRN M3.5] a prompt was just sent: no 1.5 s wait)
        if (immediate || t - pendAt >= T.hysteresisS) {
          const from = state.status;
          state.status = raw;
          pend = null;
          cSince = e.statusSince;
          onTransition(from, raw, t, atHome);
        }
      } else { pend = null; beat = null; }
      lastRaw = raw;
      if (promptAfter >= 0 && t >= promptAfter) { promptAfter = -1; doPrompted(env, true); } // [BRN fix m3-r3] the catch / call after Talk's nod
      // [BRN M3.5] §6.9: any status change cancels a verb at once; the agent goes where the status says
      if (verbStatus !== null && (raw !== verbStatus || state.status !== verbStatus)) {
        if (summon || t < verbLookUntil || t < wakeUntil) state.verbCancels++;
        if (summon) pickIdx = -1;
        summon = null; verbLookUntil = 0; verbFaceUntil = 0; wakeUntil = 0; verbStatus = null;
      }
      // A held status event whose status never committed (flapped back, or too old) is dropped silently.
      for (let i = deferred.length - 1; i >= 0; i--) {
        const d = deferred[i];
        if (raw !== STATUS_EVENTS[d.ev.kind] || t - d.t > DEFER_MAX_S) deferred.splice(i, 1);
      }

      // Reset per-frame outputs.
      intent.turn = 0;
      intent.gait = null;
      intent.via = null; intent.trip = null;
      state.social = false; state.pocket = false;
      intent.stand = false; intent.outline = null; intent.dust = 0; intent.glyph = null; intent.lamp = 'off';
      if (e.kind === 'shell') intent.ring = null;
      else if ((pend === null || beat === pend) && (!lastRing || lastRing.status !== e.status)) intent.ring = lastRing = { status: e.status, pulse: e.status === 'blocked' };
      else intent.ring = lastRing; // a pending status keeps the old ring until it commits (it changes with the reaction)
      if (e !== lastEntity) {
        lastEntity = e;
        const label = taskLabel(e);
        const muted = e.status !== 'working' && e.status !== 'blocked';
        const text = label ? (muted && e.kind !== 'shell' ? `last: ${label}` : label) : e.project ?? '';
        const key = `${text}|${muted}`;
        if (key !== placardKey) { placardKey = key; intent.placard = text ? { text, muted } : null; }
      }

      // While a new status is pending, the committed one keeps its own clock (a done → idle flip must not replay the
      // 4 s desk victory with the idle entity's fresh statusSince).
      const rawEnt = e; // [BRN fix r3] the pending status's own clock (the early blocked card must not show the old age)
      if (pend !== null && e.statusSince !== cSince && e.kind !== 'shell') e = effEntity(e);
      else if (e.statusSince !== cSince && raw === state.status) cSince = e.statusSince; // same status, new since (seq bump)
      let phase;
      vUsed = false;
      switch (state.status) {
        case 'working': phase = working(e, env, home, atHome); break;
        case 'blocked': phase = blocked(e, now, env, home); break;
        case 'done': phase = done(e, now, env, home, atHome); break;
        case 'idle': phase = idle(e, now, env, home, atHome); break;
        case 'shell': phase = shell(e, now, env, home, atHome); break;
        default: phase = unknown(e, env);
      }
      if (!vUsed) { vSpot = null; vAct = null; vChat = null; } // [BRN fix m2-r3] no stay this frame: the next one starts afresh
      if (state.status !== 'idle' && state.status !== 'shell' && state.status !== 'unknown' && pickSpot) { releasePick(); if (chatWith && !chatHost) endChat(); }
      if (state.status !== 'idle' && chatHost) endChat();
      if (state.status !== 'working') {
        workEnt = null;
        if (st) { director.unclaim(id); st = null; }
        tracker?.stop(now);
        lastWorkNow = 0;
      }
      if (state.status !== 'idle') parcel = null;
      // Leaving the mezzanine for level 0: the slide half the time, the stairs otherwise (§6.5), decided once per walk;
      // a work call takes whichever is shorter (§6.4.2).
      // [BRN fix r1] a working commute (station → desk) also takes the shorter way: it is walking while working (§6.5).
      if (hq && env && (env.self.level ?? 0) === 1 && intent.slot && (intent.slot.level ?? 0) === 0 && !intent.via && state.status !== 'working') {
        const k = `${intent.slot.id}|${tripSeq}|${pickIdx}`;
        if (k !== viaKey) { viaKey = k; viaPick = (hash32(`${id}|via|${k}`) % 1000) / 1000 < T.slideBackShare ? 'slide' : 'stairs'; }
        intent.via = viaPick;
      }
      if (dash || promptCall || t < thanksUntil || t < verbLookUntil || t < verbFaceUntil) phase = verbOverlay(phase, env, atHome);
      phase = attendOverlay(phase, env); // [BRN fix m2-fix1] walk-up attention (after the verbs: a summon / dash wins)
      phase = celebOverlay(phase, env); // [BRN fix m3-r2] the sign-off celebration beat (wins over attention)
      if (zero) phase = zeroOverlay(phase, env); // [BRN fix m3-r3] the inbox-zero cheer
      if (listen) phase = listenOverlay(phase, env); // [BRN fix m3-r3] Talk: the player is speaking to it (wins)
      state.listen = listen ? listen.stage : null; // (debug / tests)
      if (t < skipUntil && env?.self.moving && state.status !== 'blocked') intent.gait = 'skip'; // [BRN fix m3-r3] inbox zero's victory skip
      if (beat !== null && beat === pend) pendingBeat(rawEnt, env, home, atHome);
      if (phase === 'working' && state.phase === 'workCall') phase = 'working';
      state.phase = phase;
      intent.phase = phase;
      if (state.status !== 'blocked' && state.status !== 'done' && env) playerBump(env);
      excuseMe(env);
      if (((workEnt ?? e).struggle?.level ?? 0) >= 2 && state.status === 'working') intent.face = 'worried';
      if (first) reactions.length = 0; // cold start: no reactions for pre-existing states (§6.4.3)
      if (state.status !== 'idle' && state.status !== 'done' && gig) { gig = null; state.gig = 0; }
      state.idleMs = state.status === 'idle' ? now - (e.statusSince ?? now) : 0;
      // [BRN M3.5] castable: free but for a gig (social.ts may end an idle regular's stint early for a rally)
      state.castable = hq && !first && state.status === 'idle' && pend === null && e.kind !== 'shell' && !parcel && !victoryLap && !summon && !attend
        && pickKind !== 'nap' && !chatWith && !chatHost && !(pickTag === 'slide' && pickSpot && slideStage < 3) && !phase.startsWith('nap');
      state.free = state.castable && !gig;
      first = false;
      return intent;
    },
    onEvent(ev) {
      const r = EVENT_REACTION[ev.kind];
      if (!r) return null;
      if (ev.kind === 'unblocked' && dash && curT - dash.t0 < 6) return null; // [BRN M3.5] the answer's hop already played
      lastEventAt = curT; lastEventKind = ev.kind;
      return r.react;
    },
    /**
     * Should this event wait for the status hysteresis? (§6.4: the reaction plays when the actor re-targets, so a
     * startle flows straight into the chair wave instead of startle → back to typing → chair.) The held event comes
     * back from `pullDueEvent()` on commit; the caller then runs its reaction, fx and social broadcast as usual.
     */
    deferEvent(ev) {
      const target = STATUS_EVENTS[ev.kind];
      if (!target || first || state.status === target) return false;
      // [BRN fix r2] the status is already pending: the event plays now (its fx + neighbours), unless the transition
      // beat already stood in for it
      // [BRN fix r2] the beat for this status already played (startle / victory + confetti + neighbours): swallowed
      if (pend === target && beat === target) return true;
      deferred.push({ ev, t: curT });
      return true;
    },
    pullDueEvent: () => dueEvents.shift() ?? null,
    onSocial(kind, from, t) {
      const s = SOCIAL_REACTION[kind];
      if (!s || state.status === 'blocked') return null;
      if (state.phase === 'napDesk' || state.phase === 'napSofa' || state.phase === 'pitNap') return null; // sleepers sleep through it
      socialUntil = t + T.socialLookS;
      socialFace = state.status === 'working' ? null : s.face;
      socialPos.x = from.pos.x; socialPos.y = from.pos.y ?? 0; socialPos.z = from.pos.z;
      if (state.status === 'working' || !s.react) return null;
      return fr() < s.chance * P.chatty ? s.react : null;
    },
    /**
     * [BRN M3.5] A player verb (§6.9 table; bus 'verb' from the UI): what this agent does about it, never lying about its
     * status — a working agent never leaves its desk, a blocked one never leaves its queue place. Plays the reaction(s)
     * via pullReaction(). Returns the outcome (metrics): pat · sneeze ·
     * comfort · shh · come · refuse · cooldown · beep · highFive · none
     */
    verb(kind, env) {
      const t = env?.t ?? curT;
      const st = state.status;
      if (pend !== null) { push('wave'); return 'none'; } // mid status change: the new status decides, not the verb
      const asleep = /nap|Nap|sleep|Doze/.test(state.phase);
      if (kind === 'pat') {
        verbStatus = st;
        if (st === 'shell') { push('hop'); verbFace = 'happy'; verbFaceUntil = t + 2; return 'pat'; }
        if (st === 'working') {
          // [CHR fix m3-r1, cross-owner BRN] §6.9 "squash in place, keeps typing": a pat is CHR's `patted` (squash + a
          // happy ≤ 40° glance over the shoulder, body at the desk); only pat spam (the 3rd pat within 5 s) earns the
          // grumpy "shh" glance round, a funny escalation (fun review m3-r1: every pat read as an angry turn).
          const spam = t - patT0 <= 5;
          patT0 = patT1; patT1 = t;
          if (spam) { push('shh'); verbLookUntil = t + T.verbLookS; verbSwivel = false; return 'shh'; }
          push('pat'); return 'pat';
        }
        if (st === 'blocked') { push('pat'); return 'comfort'; }
        if (st === 'idle' || st === 'done') {
          if (asleep) { push('sneeze'); wakeUntil = t + T.patWakeS; return 'sneeze'; }
          push('pat'); verbFace = 'happy'; verbFaceUntil = t + 1.6; return 'pat';
        }
        push('hop');
        return 'pat';
      }
      if (kind === 'summon') {
        if (t - lastSummonT < T.summonCooldownS) { push('wave'); return 'cooldown'; }
        lastSummonT = t;
        verbStatus = st;
        if (st === 'idle' || st === 'done') {
          if (!env?.player) { push('wave'); return 'refuse'; }
          summon = { t0: t, stage: 'go', hereT: 0, px: 0, pz: 0, x: undefined, z: 0, level: 0 };
          if (gig) endGig();
          push(asleep ? 'wake' : 'hop');
          return 'come';
        }
        if (st === 'working') { push('busyFinger'); verbLookUntil = t + T.verbLookS; verbSwivel = true; return 'refuse'; }
        if (st === 'blocked') { push('pointTicket'); verbLookUntil = t + T.verbLookS; verbSwivel = false; return 'refuse'; }
        if (st === 'shell') { push('wave'); return 'beep'; }
        push('wave');
        return 'refuse';
      }
      if (kind === 'highFive') {
        if (st === 'blocked') return 'none';
        push(st === 'shell' ? 'fistPump' : 'highFive');
        // [BRN fix m3-r2] G on a done agent is the sign-off: hold the celebration in frame, facing the player, until the
        // ack commits (then the hop + '✓ thanks!' beat, onTransition) — at most celebWaitS if it never does
        if (st === 'done' && hq) startCeleb(env, t, T.celebHi5S, true);
        return 'highFive';
      }
      return 'none';
    },
    /** [BRN M3.5] §6.8.1 answered (bus 'answered'): the queued agent hops "thanks!" now; the dash home follows the status */
    answered() {
      if (state.status !== 'blocked' && lastRaw !== 'blocked') return false;
      push('unblock');
      thanksUntil = curT + T.thanksS;
      dash = { t0: curT, until: curT + T.answeredDashS, left: false };
      lastEventAt = curT; lastEventKind = 'unblocked';
      return true;
    },
    /**
     * [BRN fix m3-r3] Talk (T) opened / closed on this agent (bus 'talk.open' / 'talk.close', UI promptBar). Open: it
     * stops, turns to the player (from listenMinR–listenMaxR; walks up when farther) and listens ('…' bubble) until the
     * bar closes. Closed with a send: a nod first (listenNodS), then prompt.sent's plane catch / work-call dash.
     */
    talk(open, env, sent = false) {
      const t = env?.t ?? curT;
      if (open) {
        if (listen && listen.stage !== 'nod') return true;
        listen = { stage: 'listen', slot: null, act: null, own: false, t0: t, nodUntil: 0 };
        state.listens = (state.listens ?? 0) + 1;
        return true;
      }
      if (!listen) return false;
      if (sent) { listen.stage = 'nod'; listen.nodUntil = t + T.listenNodS; } else listen = null;
      return true;
    },
    /** [BRN fix m3-r3] bus 'inbox.zero': cheer after `delay` s (held in place for zeroCheerS); `answered` = the agent
     *  whose answer emptied the inbox: a victory skip home instead */
    cheer(delay, env, answered = false) {
      const t = env?.t ?? curT, st = state.status;
      if (st === 'working' && !answered) return false;
      if (answered) { skipUntil = t + T.zeroAnsweredS; zero = { at: t + delay, until: t + delay + 0.1, played: false, slot: null, r: 'victory', stay: false }; return true; }
      zero = { at: t + delay, until: t + delay + T.zeroCheerS, played: false, slot: null, r: st === 'shell' ? 'fistPump' : 'cheer', stay: st !== 'blocked' };
      return true;
    },
    /** [BRN M3.5] prompt.sent: an idle / done agent away from its desk starts the work call at once (§6.4.2) */
    prompted(env) {
      // [BRN fix m3-r3] (fun review m3-r3: Talk felt like shouting at someone's back) a listening agent nods first; the
      // catch / call follows listenNodS later (update → doPrompted)
      if (listen && (state.status === 'idle' || state.status === 'done' || state.status === 'working')) {
        push('nod');
        listen.stage = 'nod'; listen.nodUntil = curT + T.listenNodS;
        promptAfter = curT + T.listenNodS;
        return state.status === 'working' ? false : 'call';
      }
      return doPrompted(env);
    },
    acceptChat(visitorId, visitorPos, untilT) {
      if (state.status !== 'idle' || chatWith || !state.seated || state.phase.startsWith('nap')) return false;
      chatWith = visitorId; chatHost = true; state.chattingWith = visitorId; chatUntil = untilT;
      socialPos.x = visitorPos.x; socialPos.z = visitorPos.z;
      return true;
    },
    pullReaction: () => reactions.shift() ?? null,
    /** debug: the §6.5 phase tracker + the current station visit */
    debug: () => ({ tracker: tracker?.debug() ?? null, station: st ? { sid: st.sid, slot: st.slot.id, arrived: st.arrived } : null, parcel: parcel?.stage ?? null,
      variety: vSpot ? { spot: vSpot.id, base: vBase, beat: vN, act: vAct, next: vNext, chat: vChat } : null }), // [BRN fix m2-r3]
    rekey(newId) { id = newId; },
  };

  /**
   * [BRN M3.5] Verb / answer / prompt overlays on this frame's intent: the answered dash home (§6.8.1: a CHR `dash`
   * once the status lets go of the queue; the "thanks!" bubble), the plane caught at the desk, a working / blocked agent's
   * glance at the player (it never leaves its place), a verb's face. Returns the phase.
   */
  /**
   * [BRN fix m2-fix1] Walk-up attention (fun review m2: focus('status:done') framed flint at the Café and flint walked out
   * of frame within 0.6 s, so G hit 'sit' instead of the high-five). The player within T.attendR aiming at an idle / done
   * agent (env.aimed, from actors.ts) for T.attendAimS → it pauses where it is (its seat, its spot, or mid-walk), turns to
   * the player and waves; T.attendReleaseS after the aim leaves it carries on with its outing. Cosmetic (§6.9): only while
   * idle / done with no status change pending; never wakes a sleeper (Q does) nor stops a rally mid-point; a summon, an
   * answer or a prompt wins.
   */
  // (its state is declared up top with the other verb state: this function is below the API's `return`)
  function attendOverlay(phase: string, env: BrainEnv | null | undefined): string {
    const t = env?.t ?? 0;
    const ok = !!env && (state.status === 'idle' || state.status === 'done') && pend === null && !summon && !dash && !promptCall && !env.rally
      && t >= attendMuteUntil // ([BRN fix m3-r2] after a sign-off celebration it goes on its way, even while still aimed at)
      && !/^nap|Nap$|napDesk|sleep|Doze|pitNap|sliding|slideRide/.test(phase);
    if (ok && env.aimed) { if (aimSince < 0) aimSince = t; aimLastT = t; } else aimSince = -1;
    if (!ok) { attend = null; return keepPrev(phase); }
    if (!attend) {
      if (aimSince < 0 || t - aimSince < T.attendAimS) return keepPrev(phase);
      const self = env.self;
      const at = !self.moving && self.settledAt && prevSlot && prevSlot.id === self.settledAt ? prevSlot : null;
      let slot;
      if (at && at !== virt) slot = at;
      else {
        // mid-walk (or at a virtual point, reused every frame): a point of its own right here
        // ([BRN fix m3-r2] at least T.attendMinR from the player: a walker already closer steps back first)
        const q = at ? self.pos : outOfView(standBack(env, self.pos.x, self.pos.z, self.level ?? 0), self.level ?? 0);
        slot = { ...attendPt, pos: { x: q.x, y: 0, z: q.z }, yaw: self.yaw, level: self.level ?? 0,
          id: at ? at.id : `pt:attend:${id}:${++attendN}`, pose: at ? at.pose : 'stand' };
      }
      attend = { slot, act: at ? prevAct : null };
      push('wave');
      state.attends++;
    }
    if (t - aimLastT > T.attendReleaseS) { attend = null; return keepPrev(phase); }
    const s = attend.slot;
    intent.slot = s; intent.via = null; intent.trip = null; intent.turn = 0;
    intent.activity = attend.act && !NO_VARIETY.has(attend.act) ? attend.act : s.pose === 'sit' ? 'sitIdle' : s.pose === 'lie' ? 'lounge' : 'standIdle';
    intent.face = 'happy';
    intent.speed = T.walkSpeed;
    if (env.player) { lookAtPos(env.player.pos, 1.1); intent.swivel = true; }
    return keepPrev('attend');
  }
  function keepPrev(phase: string): string { prevSlot = intent.slot; prevAct = intent.activity; return phase; }

  /**
   * [BRN fix m3-r3] Talk (T) listening (fun review m3-r3: ledger kept walking away, its back to the player, while they
   * typed and even after the send). A free (idle / done) agent stops — its seat when it sits in range, else a point
   * of its own right there (stepped back to ≥ listenMinR), or, when farther than listenMaxR (≤ listenComeR), it walks
   * up to listenGapM from the player — faces the player and shows a '…' bubble until the bar closes; a working /
   * blocked agent / shell stays where the status puts it and turns to listen. After a send: 'on it!' and the nod
   * (prompted), then the plane catch / work-call dash (doPrompted).
   */
  function listenOverlay(phase: string, env: BrainEnv | null | undefined): string {
    const L = listen;
    if (!L) return phase;
    const t = env?.t ?? curT, st = state.status, pl = env?.player;
    if (!env || t - L.t0 > T.listenMaxS || (L.stage === 'nod' && t > L.nodUntil)) {
      // (the prompt already made it working during the nod — the demo / a fast herdr: the work-call jolt now)
      const hs = director.slotFor(id);
      if (L.call && state.status === 'working' && !promptCall && !(env && hs && env.self.settledAt === hs.id)) push('workCall');
      listen = null;
      return phase;
    }
    // (the nod holds its place whatever the status says by now: nod first, then the catch / the dash)
    const nodding = L.stage === 'nod' && !!L.slot;
    const free = nodding || ((st === 'idle' || st === 'done') && !dash && !summon && !(promptCall && !promptCall.caught));
    if (free) {
      const self = env.self, lv = self.level ?? 0;
      const d = pl ? pl.dist : Infinity;
      const moved = pl && L.px !== undefined && L.pz !== undefined && Math.hypot(pl.pos.x - L.px, pl.pos.z - L.pz) > 1.0;
      if (!L.slot || (moved && L.own)) {
        const at = !self.moving && self.settledAt && prevSlot && prevSlot.id === self.settledAt && prevSlot !== virt ? prevSlot : null;
        L.act = null; L.own = true;
        if (at && (!pl || (d >= T.listenMinR - 0.1 && d <= T.listenMaxR) || d > T.listenComeR || at.pose !== 'stand')) { L.slot = at; L.act = prevAct; L.own = false; }
        else {
          let q;
          // (walks up only on a clear straight line — a detour round furniture read as walking away; else turns in place)
          if (pl && d > T.listenMaxR && d <= T.listenComeR) {
            q = listenPoint(env, pl, lv);
            if (!clearLine(self.pos, q, lv)) { // (a short way round is fine: ≤ 1.4 × the straight line + 0.6 m)
              const straight = Math.hypot(q.x - self.pos.x, q.z - self.pos.z);
              const L = director.pathLen ? director.pathLen({ x: self.pos.x, z: self.pos.z, level: lv }, { x: q.x, z: q.z, level: lv }, id) : Infinity;
              if (!(L <= straight * 1.4 + 0.6)) q = { x: self.pos.x, z: self.pos.z };
            }
          }
          else q = pl && d < T.listenMinR ? standBack2(env, self.pos.x, self.pos.z, lv, T.listenMinR) : { x: self.pos.x, z: self.pos.z };
          q = outOfView(q, lv);
          L.slot = { ...attendPt, id: `pt:listen:${id}:${++listenN}`, tag: 'listen', pos: { x: q.x, y: 0, z: q.z }, yaw: self.yaw ?? 0, level: lv, pose: 'stand' };
        }
        if (pl) { L.px = pl.pos.x; L.pz = pl.pos.z; }
      }
      const s = L.slot;
      if (L.own && pl) s.yaw = Math.atan2(-(pl.pos.x - s.pos.x), -(pl.pos.z - s.pos.z)); // (its own point: face the player)
      intent.slot = s; intent.via = null; intent.trip = null; intent.turn = 0; intent.gait = null; intent.walkActivity = null;
      intent.activity = L.act && !NO_VARIETY.has(L.act) ? L.act : s.pose === 'sit' ? 'sitIdle' : s.pose === 'lie' ? 'lounge' : 'standIdle';
      intent.speed = T.walkSpeed;
    }
    if (pl && pl.dist < 20) { lookAtPos(pl.pos, 1.1); intent.swivel = true; }
    intent.face = 'happy';
    if (L.stage === 'nod') setBubble('listenOk', () => ({ kind: 'speech', icon: 'check', title: 'on it!', priority: 3 }));
    else setBubble('listen', () => ({ kind: 'speech', icon: 'dots', title: '…', priority: 3 }));
    return free ? (nodding ? 'nod' : 'listen') : phase;
  }
  /** open floor all along a → b (0.25 m samples) */
  function clearLine(a: { x: number; z: number }, b: { x: number; z: number }, lv: number): boolean {
    if (!director.walkable) return true;
    const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.ceil(L / 0.25);
    for (let i = 1; i <= n; i++) { const u = i / n; if (!director.walkable(a.x + (b.x - a.x) * u, a.z + (b.z - a.z) * u, lv)) return false; }
    return true;
  }
  /** listenGapM from the player on the agent's side (walkable; fanned out round the player) */
  function listenPoint(env: BrainEnv, pl: { pos: V3 }, lv: number): { x: number; z: number } {
    const self = env.self, dx = self.pos.x - pl.pos.x, dz = self.pos.z - pl.pos.z, d = Math.hypot(dx, dz) || 1;
    const a0 = Math.atan2(dx, dz);
    for (const k of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.4, -2.4, Math.PI]) for (const r of [T.listenGapM, T.listenGapM + 0.5]) {
      const x = pl.pos.x + Math.sin(a0 + k) * r, z = pl.pos.z + Math.cos(a0 + k) * r;
      if (!director.walkable || (director.walkable(x, z, lv) && clearLine(self.pos, { x, z }, lv))) return { x, z };
    }
    return { x: pl.pos.x + (dx / d) * T.listenGapM, z: pl.pos.z + (dz / d) * T.listenGapM };
  }
  /** standBack with its own minimum radius */
  function standBack2(env: BrainEnv, x: number, z: number, level: number, R: number): { x: number; z: number } {
    const pl = env.player;
    if (!pl) return { x, z };
    const dx = x - pl.pos.x, dz = z - pl.pos.z, d = Math.hypot(dx, dz);
    const a0 = d > 1e-3 ? Math.atan2(dx, dz) : fr() * Math.PI * 2;
    for (const k of [0, 0.4, -0.4, 0.8, -0.8, 1.3, -1.3, 2, -2]) for (const r of [R, R + 0.4]) {
      const px = pl.pos.x + Math.sin(a0 + k) * r, pz = pl.pos.z + Math.cos(a0 + k) * r;
      if (!director.walkable || director.walkable(px, pz, level)) return { x: px, z: pz };
    }
    return { x, z };
  }
  /**
   * [BRN fix m3-r3] Inbox zero (fun review m3-r3: the confetti landed on nobody — the Pit's loungers kept neutral faces).
   * bus 'inbox.zero' → actors.ts → cheer(): after its stagger the agent cheers (CHR `cheer`; a shell fist-pumps), holding
   * its place (its seat, or right where it walks) for zeroCheerS, beaming at the player; the answered agent's victory
   * leap, then a skip home (update: gait 'skip' while it walks, ≤ zeroAnsweredS).
   */
  function zeroOverlay(phase: string, env: BrainEnv | null | undefined): string {
    const Z = zero;
    if (!Z) return phase;
    const t = env?.t ?? curT, st = state.status;
    if (t > Z.until || st === 'working') { zero = null; return phase; }
    if (!Z.played && t >= Z.at) { Z.played = true; push(Z.r); }
    if (Z.stay && env && (st === 'idle' || st === 'done' || st === 'shell') && !dash && !listen) {
      if (!Z.slot) {
        const self = env.self;
        const at = !self.moving && self.settledAt && prevSlot && prevSlot.id === self.settledAt && prevSlot !== virt ? prevSlot : null;
        if (at) Z.slot = at;
        else {
          const q = outOfView({ x: self.pos.x, z: self.pos.z }, self.level ?? 0);
          Z.slot = { ...attendPt, id: `pt:zero:${id}:${++listenN}`, tag: 'zero', pos: { x: q.x, y: 0, z: q.z }, yaw: self.yaw ?? 0, level: self.level ?? 0, pose: 'stand' };
        }
        Z.act = at ? prevAct : null;
      }
      const s = Z.slot;
      intent.slot = s; intent.via = null; intent.trip = null; intent.walkActivity = null;
      intent.activity = Z.act && !NO_VARIETY.has(Z.act) ? Z.act : s.pose === 'sit' ? 'sitIdle' : s.pose === 'lie' ? 'lounge' : 'standIdle';
    }
    intent.face = 'happy';
    const pl = env?.player;
    if (pl && pl.dist < T.zeroR) { lookAtPos(pl.pos, 1.1); intent.swivel = true; }
    return Z.stay && t >= Z.at ? 'cheer' : phase;
  }
  /** [BRN M3.5] prompt.sent: an idle / done agent away from its desk starts the work call at once (§6.4.2) */
  function doPrompted(env: BrainEnv | null | undefined, afterNod = false): string | false {
      const st = state.status;
      // ([BRN fix m3-r3] after Talk's nod the prompt may already have made it working: the plane is still caught at the desk)
      if (st !== 'idle' && st !== 'done' && !(afterNod && st === 'working' && lastRaw !== 'blocked')) return false;
      if (promptCall && curT <= promptCall.until) return promptCall.caught ? 'catch' : 'call'; // (one prompt, one reaction)
      const home = director.slotFor(id);
      if (env && home && env.self.settledAt === home.id) { push('catchPlane'); promptCall = { until: curT + T.promptCallS, caught: true }; return 'catch'; }
      summon = null;
      promptCall = { until: curT + T.promptCallS, caught: false };
      push(/nap|Nap|sleep/.test(state.phase) ? 'wake' : 'workCall');
      state.phase = 'workCall';
      return 'call';
  }

  /**
   * [BRN fix m3-r2] The sign-off celebration (fun review m3-r2: signing a done agent off — the payoff of a G high-five —
   * happened off camera: gale leapt and tumbled out of frame in < 0.7 s, tinker left the camera on an empty corner). The
   * agent holds its place (its seat, or a standing point ≥ T.attendMinR from the player), faces the player and beams:
   * after a G high-five it waits for the ack to commit (≤ T.celebWaitS), then hops with a '✓ thanks!' bubble for
   * T.celebS; a sign-off from the inbox plays the bow-and-wave thank-you (T.celebThanksS). Only then the parcel run,
   * which first steps away from the camera. Cosmetic (§6.9): any other status ends it on the same frame.
   */
  function startCeleb(env: BrainEnv | null | undefined, t: number, dur: number, hi5: boolean) {
    const self = env?.self, prev = celeb && t < Math.max(celeb.until, celeb.maxT) ? celeb : null;
    celeb = { t0: t, until: t + dur, maxT: hi5 ? t + T.celebWaitS : t + dur, hi5: hi5 || !!prev?.hi5, slot: prev?.slot ?? null, act: prev?.act ?? null, own: prev?.own ?? false };
    if (!celeb.slot && self) {
      const at = !self.moving && self.settledAt && prevSlot && prevSlot.id === self.settledAt ? prevSlot : null;
      if (at && at !== virt) { celeb.slot = at; celeb.act = prevAct; }
      else {
        const q = outOfView(standBack(env, self.pos.x, self.pos.z, self.level ?? 0), self.level ?? 0);
        celeb.slot = { ...attendPt, id: `pt:celeb:${id}:${++celebN}`, tag: 'celeb', pos: { x: q.x, y: 0, z: q.z }, yaw: self.yaw ?? 0, level: self.level ?? 0, pose: 'stand' };
        celeb.own = true;
      }
    }
    state.celebs = (state.celebs ?? 0) + (prev ? 0 : 1);
  }
  function celebOverlay(phase: string, env: BrainEnv | null | undefined): string {
    const cb = celeb;
    if (!cb) return phase;
    const t = env?.t ?? curT, st = state.status;
    const waiting = cb.hi5 && st === 'done' && t < cb.maxT; // (the ack has not committed yet)
    if (!env || (st !== 'idle' && st !== 'done') || (t > cb.until && !waiting) || summon || dash || promptCall) {
      if (st === 'idle' && t > cb.until) attendMuteUntil = t + T.celebMuteS;
      celeb = null;
      return phase;
    }
    const s = cb.slot, pl = env.player;
    if (s) {
      if (cb.own && pl) s.yaw = Math.atan2(-(pl.pos.x - s.pos.x), -(pl.pos.z - s.pos.z)); // (its own point: stand facing the player)
      intent.slot = s; intent.via = null; intent.trip = null; intent.turn = 0; intent.gait = null; intent.walkActivity = null;
      intent.activity = cb.act && !NO_VARIETY.has(cb.act) ? cb.act : s.pose === 'sit' ? 'sitIdle' : s.pose === 'lie' ? 'lounge' : 'standIdle';
    }
    intent.face = 'happy';
    if (pl && pl.dist < 14) { lookAtPos(pl.pos, 1.1); intent.swivel = true; }
    else if (typeof director.faceSpawn === 'function' && env.self) intent.look = null;
    if (st === 'idle') setBubble('celeb', () => ({ kind: 'speech', icon: 'check', title: 'thanks!', priority: 2 }));
    return 'celebrate';
  }

  function verbOverlay(phase: string, env: BrainEnv | null | undefined, atHome: boolean): string {
    const t = curT;
    if (dash) {
      if (state.status !== 'blocked') dash.left = true;
      if (t > dash.until || state.status === 'done' || state.status === 'shell' || (dash.left && state.status === 'blocked') || (dash.left && atHome)) {
        if (dash.left && atHome && (state.status === 'working' || state.status === 'idle')) push('hop'); // sit-hop into the chair
        dash = null;
      } else if (dash.left && (state.status === 'working' || state.status === 'idle') && env?.self.moving !== undefined) {
        intent.gait = t < skipUntil ? 'skip' : 'dash'; // ([BRN fix m3-r3] the inbox-zero answer: a victory skip)
        intent.speed = Math.max(intent.speed, T.answeredDashSpeed);
        if (phase === 'toDesk' || phase === 'idleDesk' || phase === 'chillDesk') phase = 'answeredDash';
      }
    }
    if (t < thanksUntil) setBubble('thanks', () => ({ kind: 'speech', icon: 'heart', title: 'thanks!', priority: 2 }));
    if (promptCall) {
      if (state.status === 'blocked' || t > promptCall.until) promptCall = null;
      else if (atHome && !promptCall.caught) { promptCall.caught = true; push('catchPlane'); }
      else if (promptCall.caught && state.status === 'working') promptCall = null;
    }
    const pl = env?.player;
    if (t < verbLookUntil && pl) { lookAtPos(pl.pos, 1.1); intent.swivel = verbSwivel && atHome; }
    if (t < verbFaceUntil) intent.face = verbFace;
    return phase;
  }

  /**
   * [BRN fix r2] (anim review r2: the FX switched within 100 ms, the Clawd kept pencil-editing with a focused face for
   * 1.4 s) The hysteresis still holds the re-target (the chair / queue / Pit, §6.4), but the beat plays the moment
   * blocked / done shows up: the held server event (startle / victory, with its fx and the neighbours' reaction) or the
   * transition reaction, then `pendingBeat` keeps face, hands and head on the new status until it commits. A flap
   * back inside the window is a false alarm: it returns to the work (a startle, then back to typing, reads fine).
   */
  function earlyBeat(to: string) {
    beat = to;
    const i = deferred.findIndex((d) => STATUS_EVENTS[d.ev.kind] === to);
    const kind = to === 'done' ? 'finished' : to;
    if (i >= 0) { const ev = deferred[i].ev; deferred.splice(i, 1); dueEvents.push(ev); lastEventAt = curT; lastEventKind = ev.kind; }
    else if (!(curT - lastEventAt < 3 && lastEventKind === kind)) push(to === 'blocked' ? 'startle' : 'victory'); // not played yet
  }
  /** The pending window after an early beat: hands off the keyboard, the new face, a head snap to the player. */
  function pendingBeat(e: Entity, env: BrainEnv | null | undefined, home: Slot | null, atHome: boolean) {
    const blockedNow = beat === 'blocked';
    intent.face = blockedNow ? 'surprised' : 'happy';
    const at = env?.self.settledAt && intent.slot?.id === env.self.settledAt ? intent.slot : null; // desk or a station
    if (at) intent.activity = restAct(at);
    intent.walkActivity = null;
    intent.glyph = null;
    if (blockedNow) {
      intent.lamp = 'blocked';
      intent.outline = BLOCKED_OUTLINE;
      const q = e.prompt?.question || 'needs you';
      const age = Math.max(0, curNow - (e.statusSince ?? curNow));
      setBubble(`b|${q}|${Math.floor(age / 1000)}`, () => ({ kind: 'alert', icon: '!', title: q, detail: mmss(age, e.statusSinceApprox), priority: 3 }));
    } else setBubble('', null);
    const pl = env?.player;
    if (pl && pl.dist < 12) { lookAtPos(pl.pos, 1.1); intent.swivel = atHome; }
    else if (typeof director.faceSpawn === 'function' && env?.self) { // no player close by: toward the room (the spawn view)
      const c = director.center; lookV.x = c.x; lookV.y = 0.9; lookV.z = c.z; intent.look = lookV;
    }
  }

  /** Status-change reactions when the server sent no matching event (and the §6.4.2 work call). */
  function onTransition(from: string | null, to: string, t: number, atHome: boolean) {
    if (beat === to) { // [BRN fix r2] the reaction already played when the status first showed up (earlyBeat)
      beat = null;
      releasePick();
      director.unclaim(id);
      st = null;
      if (chatWith) endChat();
      parcel = null; victoryLap = false; outing = null; gig = null; state.gig = 0; regSpot = null; regKey = 0; postGig = null;
      return;
    }
    outing = null; gig = null; state.gig = 0; regSpot = null; regKey = 0; postGig = null;
    const heldIdx = deferred.findIndex((d) => STATUS_EVENTS[d.ev.kind] === to);
    if (heldIdx >= 0) { dueEvents.push(deferred[heldIdx].ev); deferred.splice(heldIdx, 1); lastEventAt = t; lastEventKind = to === 'done' ? 'finished' : to; }
    const recentEvent = heldIdx >= 0 || t - lastEventAt < 3;
    releasePick();
    director.unclaim(id); // every casual claim (pick, station, parcel chute) ends with the status
    st = null;
    if (chatWith) endChat();
    if (to === 'working') {
      socialUntil = 0; socialFace = null; // a neighbour's cheer must not carry a smile into the work call
      // answered (§6.8.1): `unblock` (hop, "thanks!", bow) and a 2.0 m/s scurry home — not a work call
      if (from === 'blocked') { if (!(recentEvent && lastEventKind === 'unblocked') && !dash) push(atHome ? 'hop' : 'unblock'); }
      else if (!atHome) { if (listen?.stage === 'nod') listen.call = true; else if (!promptCall) push('workCall'); state.phase = 'workCall'; } // ([BRN M3.5] prompt.sent: already jolted; [BRN fix m3-r3] after Talk's nod)
      else if (!promptCall?.caught) push('hop'); // sit-hop straight into the work (or the plane was just caught)
    } else if (to === 'blocked' && !(recentEvent && lastEventKind === 'blocked')) push('startle');
    else if (to === 'done' && !(recentEvent && lastEventKind === 'finished')) push('victory');
    else if (to === 'idle' && from === 'working') { fidgetName = 'stretch'; fidgetUntil = t + 2.2; nextFidgetAt = t + 6; }
    else if (to === 'idle' && from === 'done') {
      // [BRN fix m3-r2] (fun review m3-r2: the sign-off happened off camera — gale leapt out of frame in < 0.7 s) a
      // celebration beat in place, facing the player: after a G high-five the slap has landed, so a hop + '✓ thanks!';
      // from the inbox the bow-and-wave thank-you. The parcel run starts after it, heading away from the camera.
      const hi5 = !!celeb?.hi5 && t < celeb.maxT;
      if (hi5) push(recentEvent && lastEventKind === 'acked' ? null : 'hop');
      else push(recentEvent && lastEventKind === 'acked' ? null : 'thankYou');
      if (hq) startCeleb(lastEnv, t, hi5 ? T.celebS : T.celebThanksS, false);
    }
    // Signed off (acked in HQ, or seen in herdr): wrap the work up as a parcel and ship it at the OUTBOX (§6.4 table).
    if (hq && to === 'idle' && from === 'done') parcel = { stage: 'away', slot: null, t: 0, away: null };
    if (to !== 'idle') { parcel = null; victoryLap = false; }
    if (to !== 'idle' && to !== 'done') celeb = null;
  }
}
