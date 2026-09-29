/**
 * Actors (DESIGN §5.4 wiring, §6.4.3 lifecycle): entity ↔ actor (rig + animator + brain + charBatch handle).
 * Per frame (§8.1 step 3): director.update → per actor: brain.update(entity, now, env) → motor (route to the Intent's
 * slot, sit / stand / stand-on-chair) → animator (action on arrival, face, look, energy, reactions) → fx from the
 * Intent. Only this module calls animator / fx for actors.
 *
 * Lifecycle:
 * - first `world` = cold start: everyone is placed at its Intent slot with `dissolveIn` (nobody walks in, §6.4.3);
 * - later new entities: an `arrived` event → walk in from the door with `arrive`; otherwise cold-start placement;
 * - `gone {reason:'rekeyed', newId}` → the actor is moved to the new id (no leave/arrive);
 * - other disappearances → `leave` + dissolve + poof, removed after `leaveS`.
 * Owner: BRN.
 */
import * as THREE from 'three';
import { createRig } from './rig/clawd.ts';
import * as anim from './anim/animator.ts'; // namespace: REACTIONS is optional (absent in the M0.5 stub)
import { createBrain } from './brain/brain.ts';
import { activity as activityDef } from './anim/activities/index.ts';
import { seatTurn } from './anim/seat.ts'; // [CHR cross-owner m175-r2] fixed seats (Pit lounger) cap the swivel
import { TUNING as T, EVENT_REACTION, SOCIAL_REACTION } from './brain/tuning.ts';
import { dampAngle, wrapAngle, clamp } from '../core/math.ts';
import { setDeskScreen, screenModeFor } from '../render/deskScreens.ts'; // [RND fix r1] honest desk monitors
import { hqRegister, hqStatSection } from '../core/debug.ts';
import { createMetrics } from './brain/metrics.ts';
import { createSocial } from './brain/social.ts';
import { getMaterial } from '../render/materials/index.ts';
import { LAYERS } from '../render/layers.ts';
import { HIRE_CRATE } from '../world/build/dress.ts'; // [BRN M3.5] ENV's Lobby hiring / arrivals crate spot (node-safe)
import type { Entity } from '../../../shared/protocol.ts';
import type { Layout, Slot, Vec3 } from '../world/layout/schema.ts';
import type { NavOpts, NavPoint } from '../world/nav/index.ts';
import type { Store } from '../net/store.ts';
import type { Bus } from '../core/bus.ts';
import type { BubbleSpec, PlacardSpec, PlateSpec, RingSpec, Vec3Like } from '../fx/types.ts';
import type { FxBurstOpts } from '../fx/index.ts';
import type { Rig, RigOptions } from './rig/clawd.ts';
import type { Animator, AnimatorOptions } from './anim/animator.ts';
import type { Brain, BrainEnv, BrainEvent, Intent } from './brain/brain.ts';
import type { CharBatch, CharHandle } from './render/charBatch.ts';
import type { Lite } from './brain/social.ts';
import type { Director } from './brain/director.ts';
import type { Approach } from './brain/directorHq.ts';
import type { MetricsActor, MetricsReading } from './brain/metrics.ts';

/** the waypoints of a walk (`stepOut`: its first leg leaves a seat, so the seat's neighbours are not obstacles) */
export type Path = NavPoint[] & { stepOut?: boolean };
/** a slide ride in progress (time-based along `layout.slide.path`) */
export interface Ride { t: number; dur: number; pts: readonly Vec3[]; cum: number[]; len: number; i: number; y: number }
export type ActorMode = 'cold' | 'wait' | 'arrive' | 'live' | 'leave';
/** what the brain sees (BrainEnv) plus the player scratch record fillEnv rewrites per frame */
export interface ActorEnv extends BrainEnv { _player: { pos: Vec3; dist: number; inFront: boolean } }
type P2 = { x: number; z: number };
/** a steering result: unit direction, speed factor, and (crowd steering) "the waypoint advanced" */
interface Steer { x: number; z: number; k: number; skip: boolean }
/** how close a walk comes to the player (`d0`: where it starts) */
interface Clearance { min: number; d0: number }

/**
 * One character: entity ↔ rig + animator + brain + charBatch handle, plus the motor's per-frame scratch. Every field is
 * declared up front in `spawn` (one hidden class); the optional ones start `undefined` ("not set yet").
 */
export interface Actor extends MetricsActor {
  id: string;
  entity: Entity;
  /** feet, world */
  pos: Vec3;
  yaw: number;
  intent: Intent | null;
  /** settled at the Intent slot */
  arrived: boolean;
  brain: Brain;
  mode: ActorMode;
  bornT: number;
  leaveT: number;
  path: Path;
  pathI: number;
  targetKey: string | null;
  settledAt: string | null;
  moving: boolean;
  lift: number;
  level: number;
  ride: Ride | null;
  zone: string | null;
  lite: Lite;
  neighbours: Lite[];
  nd: Float64Array;
  plate: PlateSpec | null;
  plateSrc: Entity | null;
  visible: boolean;
  env: ActorEnv;
  aheadT: number; crowdSideT: number; ghostT: number; jamX: number; jamZ: number; shuffleT: number; viewD: number; lodSet: number;
  fyX: number; fyZ: number; fy: number; fyL: number;
  avoidLeg?: number; avoidSide?: number; blockedByPlayer?: boolean; callPath?: Path | null; callSpeed?: number;
  crowdLeg?: number; crowdSide?: number; goneWait?: number | null; holdFor?: string | null; holdRetryT?: number;
  holdSince?: number | null; holdWaveT?: number; jamPatience?: number; jamT?: number | null; navWait?: boolean;
  placardAnchor?: string | null; placardSpec?: Intent['placard']; replanT?: number; settledSlot?: Slot | null;
  shuffleKey?: string; slotRef?: Slot; stoppedShort?: boolean; syncU?: number | null; trip?: string | null;
  waitT?: number | null; walkOpts?: NavOpts; yieldT?: number | null;
  progT: number; progX: number; progZ: number; stallStage: number; pushT: number; softT: number; politeT: number; lineT: number;
  rig: Rig;
  animator: Animator;
  handle: CharHandle;
  look3: THREE.Vector3;
  lookKey: number | null;
  face: string | null;
  energy: number;
  action: string | null | undefined;
  outline: Intent['outline'] | undefined;
  gait: string | null;
  colorKey: string;
  inCrate: boolean; crateT0: number; crateStage: number; crateLanded?: boolean;
  leaveStage: 'walk' | 'wave' | 'gone' | null;
  vc: number; att: number;
}

/** What actors call on FX (`Fx` satisfies it; `placard` / `forget` are absent in the headless sim). */
export interface ActorFx {
  bubble(actorId: string, spec: BubbleSpec | null): void;
  ring(actorId: string, spec: RingSpec | null): void;
  plate(actorId: string, spec: PlateSpec | null): void;
  glyph(actorId: string, cls: string | null): void;
  dust(actorId: string, level: 0 | 1 | 2 | 3): void;
  /** `kind` is a `BurstKind`; EVENT_REACTION's `fx` ids are plain strings (checked at FX's table) */
  burst(kind: string, pos: Vec3Like, opts?: FxBurstOpts): void;
  placard?(actorId: string, spec: PlacardSpec | null): void;
  forget?(actorId: string): void;
}
/** test / sim seams: build a rig / an animator */
export interface ActorFactories {
  createRig?(o: RigOptions): Rig;
  createAnimator?(rig: Rig, o: AnimatorOptions): Animator;
}
/** the slice of the per-frame ctx `update` reads */
export interface ActorsCtx {
  dt: number;
  time: number;
  now: number;
  player?: { pos: Vec3; level?: number } | null;
  camera?: THREE.Camera | null;
  scene?: THREE.Object3D | null;
  bus?: Bus | null;
  hour?: number | null;
  ambient?: { catPos?(): { x: number; y?: number; z: number } | null } | null;
}
export interface ActorsDeps {
  store: Pick<Store, 'entities' | 'on'>;
  layout: Layout;
  director: Director;
  charBatch: Pick<CharBatch, 'register'>;
  fx: ActorFx;
  factories?: ActorFactories;
}
export type Social = ReturnType<typeof createSocial>;
export interface Crowd { samples: number; minD: number; minPair: string; clips: number }
export interface StallStats { repaths: number; breaks: number; cleared: number; softReplans: number; maxS: number; maxWho: string; politeS: number }
export interface ActorMetrics extends MetricsReading { social: ReturnType<Social['counts']>; crowd: Crowd; verbs: Record<string, number>; stalls: StallStats }
export type CrateInfo = { id: string; age: number; shown: boolean };
export interface Actors {
  /** observe every reaction as it starts (one listener) */
  tapReactions(fn: ((a: Actor, r: string) => void) | null): void;
  /** set the aimed agent directly (tests, the headless sim; the app uses bus 'aim') */
  setAim(id: string | null | undefined): void;
  /** §8.1 step 3 */
  update(ctx: ActorsCtx): void;
  /**
   * The live actors (not leaving): a READ-ONLY view reused every frame (no allocation; PLY's soft colliders and the
   * aim query call it per frame). Rebuilt at the top of each update; copy it (`slice()`) before sorting / keeping.
   */
  list(): Actor[];
  /** §9.1 metrics (the same object `__hq.metrics()` reads); `reset` = true zeroes it */
  metrics(reset: true): true;
  metrics(reset?: false): ActorMetrics;
  metrics(reset?: boolean): true | ActorMetrics;
  /** a §6.9 player verb on actor `id` (what the bus 'verb' does): the outcome */
  verb(kind: string, id: string): string;
  answered(id: string): void;
  prompted(id: string): void;
  talk(id: string, open: boolean, sent?: boolean): boolean;
  inboxZero(): number;
  /** the hiring crates in flight (id, age s) */
  crates(): CrateInfo[];
  get(id: string): Actor | null;
  /** per-actor bookkeeping sizes (churn soak: they track the live count, never the history) */
  sizes(): { actors: number; arrivedAt: number; rekeys: number; events: number; zoneOf: number; inCall: number; calls: number };
  count(): number;
  /** the social stage manager (brain/social.ts) */
  social: Social;
}

declare global {
  interface Window {
    __hqSocial?: Social;
    __hqActors?: Pick<Actors, 'crates' | 'verb' | 'answered' | 'prompted' | 'get' | 'list' | 'talk' | 'inboxZero'>;
  }
}

/** Brain transition reactions → the social kind bystanders react to (when no server event did it already). */
const REACTION_SOCIAL: Readonly<Record<string, string | undefined>> = Object.freeze({ startle: 'blocked', victory: 'finished', thankYou: 'acked' });
/**
 * Until CHR's reaction set is complete (M1 ships startle/victory/hop/dissolveIn/wave/dizzy), a missing reaction plays
 * its nearest sibling so the moment still reads; each entry disappears by itself once CHR adds the real one.
 */
const REACTION_FALLBACK: Readonly<Record<string, string | undefined>> = Object.freeze({
  clap: 'hop', fistPump: 'hop', bump: 'hop', unblock: 'hop', bow: 'hop', thankYou: 'wave', arrive: 'wave', leave: 'wave',
  workCall: 'startle', wake: 'startle', highFive: 'hop', pat: 'hop', busyFinger: 'wave', sneeze: 'startle',
  // [BRN M3.5] until CHR's M3.5 set lands: the 'shh' glance, pointing at the ticket, the caught paper plane, the crate unwrap
  shh: 'busyFinger', pointTicket: 'busyFinger', catchPlane: 'hop', unwrap: 'hop',
  // [BRN fix m3-r3] Talk's "got it" nod before the plane catch / dash (CHR has no `nod` yet: the small bow reads as one);
  // the inbox-zero cheer (CHR M3.5 ships `cheer`)
  nod: 'bow', cheer: 'hop',
});
/**
 * [INT M3.5 cross-owner] BRN fires generic ids; CHR shipped purpose-built ones for the same moments (§6.9): the working
 * agent's "shh" glance round at the player, and the squish-and-blush pat. Used only when CHR's animator has the target.
 */
const REACTION_UPGRADE: Readonly<Record<string, string | undefined>> = Object.freeze({ shh: 'glanceBack', pat: 'patted' });
/** [BRN M3.5] a reaction that may play while walking (a high-five in passing) */
const WALK_OK: Readonly<Record<string, boolean | undefined>> = Object.freeze({ highFive: true, wave: true });
const idHash = (s: string): number => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h >>> 0; };
const SPAWN_WAIT_S = 0.3; // a post-boot newcomer waits this long for its `arrived` event before cold placement
const NEIGHBOURS = 6;
const NEAR2 = 6 * 6;

/** `factories`: test seams */
export function createActors({ store, layout, director, charBatch, fx, factories = {} }: ActorsDeps): Actors {
  const makeRig: (o: RigOptions) => Rig = factories.createRig ?? createRig;
  const makeAnimator: (rig: Rig, o: AnimatorOptions) => Animator = factories.createAnimator ?? anim.createAnimator;
  const actors = new Map<string, Actor>();
  const events: (BrainEvent & { id: string })[] = [];
  /** old id → new id */
  const rekeys = new Map<string, string>();
  /** id → local t of its `arrived` event */
  const arrivedAt = new Map<string, number>();
  let sawWorld = false, coldDone = false, t = 0, slideFreeT = 0;
  const metrics = createMetrics({ zoneAt: (x, z, l) => layout.zoneAt?.(x, z, l) ?? null, info: () => director.info?.() });
  let frameNo = 0;
  /** office-wide social scenes (rallies, high-fives, the Pit wave, Board huddles; brain/social.ts) */
  const social = createSocial({ layout, director });
  const lites: Lite[] = [];
  /** [BRN fix m2-fix1] entities spawned cold since the last frame (social.bootCast) */
  const coldQ: Entity[] = [];
  let ballMesh: THREE.InstancedMesh | null = null;

  store.on('event', (ev) => { events.push(ev); if (events.length > 128) events.shift(); if (ev.kind === 'arrived') arrivedAt.set(ev.id, t); });
  store.on('gone', (m) => { if (m.reason === 'rekeyed' && m.newId) rekeys.set(m.id, m.newId); });
  store.on('world', () => { sawWorld = true; });

  const door = doorPoint(layout);
  const frustum = new THREE.Frustum();
  const projView = new THREE.Matrix4();
  const sphere = new THREE.Sphere(new THREE.Vector3(), 0.8);

  /** Reaction with the fallback table (no-op for ids neither CHR nor the table knows). */
  const react = (a: Actor, r: string | null | undefined): void => {
    if (!r) return;
    // [INT M3.5 cross-owner] BRN's verb ids → CHR's dedicated M3.5 reactions when the animator has them
    const up = REACTION_UPGRADE[r];
    const rr = up && anim.REACTIONS && up in anim.REACTIONS ? up : r;
    const known = !anim.REACTIONS || rr in anim.REACTIONS;
    a.animator.react(known ? rr : REACTION_FALLBACK[rr] ?? rr);
    reactTap?.(a, r); // [AUD M3, cross-owner] vocal blips / bell taps (audio/index.ts)
  };
  let reactTap: ((a: Actor, r: string) => void) | null = null;

  // ------------------------------------------------------------------------------------------ M3.5 verbs, arrivals
  /** `__hq.metrics().verbs`: §6.9 verb outcomes, answers, prompts, crate arrivals and door departures */
  const verbs: Record<string, number> = { pat: 0, sneeze: 0, comfort: 0, shh: 0, summon: 0, come: 0, came: 0, refuse: 0, cooldown: 0, beep: 0, highFive: 0,
    cancelled: 0, answered: 0, prompted: 0, crates: 0, departures: 0, attends: 0, listens: 0, zeroCheers: 0 };
  const crates = createCrates(layout);
  /**
   * A player verb on actor `id` (bus 'verb' {verb, id} from the UI; §6.9). The brain decides (never lying about the
   * status); the fx here: hearts for a pat, a dust puff for a sneeze. @returns outcome
   */
  function doVerb(kind: string, id: string): string {
    const a = actors.get(id);
    if (!a || a.mode !== 'live') return 'none';
    const out = a.brain.verb?.(kind, a.env) ?? 'none';
    if (kind === 'summon') verbs.summon++;
    if (out in verbs) verbs[out]++;
    if (out === 'pat' || out === 'comfort') fx.burst('hearts', headPos(a), {});
    else if (out === 'sneeze') fx.burst('dust', headPos(a), {});
    return out;
  }
  const headPos = (a: Actor) => ({ x: a.pos.x, y: a.pos.y + 0.95 + (a.lift ?? 0), z: a.pos.z });
  function onAnswered(id: string) {
    const a = actors.get(id);
    lastAnswered = id; lastAnsweredT = t; // [BRN fix m3-r3] (inbox.zero's victory skip)
    if (a && a.mode === 'live' && a.brain.answered?.()) verbs.answered++;
  }
  let lastAnswered: string | null = null, lastAnsweredT = -1e9;
  /** [BRN fix m3-r3] bus 'talk.open' / 'talk.close' {id, sent?} (UI promptBar): the agent listens (brain.talk) */
  function onTalk(id: string, open: boolean, sent = false): boolean {
    const a = actors.get(id);
    if (!a || a.mode !== 'live' || !a.brain.talk) return false;
    const ok = a.brain.talk(open, a.env, sent);
    if (ok && open) verbs.listens++;
    return ok;
  }
  /**
   * [BRN fix m3-r3] bus 'inbox.zero' (fun review m3-r3: the confetti fired over the Pit and nobody reacted): every free
   * agent (not working; asleep too — it's the moment) within T.zeroR of the player or of the Pit cheers, nearest first,
   * staggered over T.zeroStaggerS; the agent whose answer emptied the inbox does a victory leap and skips home.
   * @returns cheering agents
   */
  function onInboxZero(): number {
    const pp = lastPlayer, c = director.center;
    const cand: { a: Actor; d: number }[] = [];
    for (const a of actors.values()) {
      if (a.mode !== 'live' || a.inCrate) continue;
      const dPl = pp ? Math.hypot(a.pos.x - pp.x, a.pos.z - pp.z) : Infinity;
      const dPit = c ? Math.hypot(a.pos.x - c.x, a.pos.z - c.z) : Infinity;
      const d = Math.min(dPl, dPit);
      if (d > T.zeroR && a.id !== lastAnswered) continue;
      cand.push({ a, d });
    }
    cand.sort((x, y) => x.d - y.d);
    const n = cand.length;
    let k = 0, i = 0;
    const answered = t - lastAnsweredT < 5 ? lastAnswered : null;
    for (const { a } of cand) {
      const delay = n > 1 ? (T.zeroStaggerS * i++) / (n - 1) : 0;
      if (a.brain.cheer?.(delay, a.env, a.id === answered)) k++;
    }
    social.zeroed?.(t); // (its own blocked-count ripple stays quiet: this one is the celebration)
    verbs.zeroCheers += k;
    return k;
  }
  /** the player's feet this frame (inbox zero's centre) */
  let lastPlayer: Vec3 | null = null;
  function onPrompt(id: string) {
    const a = actors.get(id);
    if (a && a.mode === 'live' && a.brain.prompted?.(a.env)) verbs.prompted++;
  }
  let busBound = false;
  /** [INT M3.5 cross-owner] the renderer bus, for the crate topics FX (`crate.unwrap`) and AUD (`crate`) listen to */
  let busRef: Bus | null = null;
  function bindBus(bus: Bus) {
    busBound = true;
    busRef = bus;
    // [UI fix r1, cross-owner BRN] the outcome goes back on the (synchronous) message: UI words its toast by what the
    // agent actually does (a working agent waves from its desk, it doesn't come; P6)
    bus.on?.('verb', (m) => { if (m?.id && m.verb !== 'prompt') m.outcome = doVerb(m.verb, m.id); });
    bus.on?.('answered', (m) => { if (m?.id) onAnswered(m.id); });
    bus.on?.('prompt.sent', (m) => { if (m?.id) onPrompt(m.id); });
    bus.on?.('aim', (m) => { aimId = m?.id ?? null; }); // [BRN fix m2-fix1] the reticle's agent (UI, §6.7): walk-up attention
    // [BRN fix m3-r3] Talk (T) listening + the inbox-zero celebration (fun review m3-r3)
    bus.on?.('talk.open', (m) => { if (m?.id) onTalk(m.id, true); });
    bus.on?.('talk.close', (m) => { if (m?.id) onTalk(m.id, false, !!m.sent); });
    bus.on?.('inbox.zero', () => { onInboxZero(); });
  }
  /** [BRN fix m2-fix1] the agent under the player's reticle (bus 'aim'; `api.setAim` for tests / __hq) */
  let aimId: string | null = null;

  // ------------------------------------------------------------------------------------------ lifecycle
  /** A rig + animator + charBatch handle for `e`; the animator's ground follows the actor's level. */
  const build = (e: Entity, levelOf: () => number) => {
    const rig = makeRig({ kind: e.kind, seedKey: e.seedKey });
    // [CHR fix m15-r1, cross-owner] ground: mini-Clawds stand on the real floor (Pit rings, dais, stairs), not the parent's
    const animator = makeAnimator(rig, { seedKey: e.seedKey, ground: (x, z) => layout.floorY?.(x, z, levelOf()) ?? 0 });
    const handle = charBatch.register(rig, { kind: e.kind, colorIndex: e.workspace?.colorIndex ?? 0, cycle: e.workspace?.cycle ?? 0 });
    return { rig, animator, handle };
  };
  const colorKeyOf = (e: Entity) => `${e.workspace?.colorIndex ?? 0}/${e.workspace?.cycle ?? 0}`;

  /** A kind change / workspace recolour: a new rig in place (a new handle / animator: re-send LOD + view distance). */
  const register = (a: Actor, e: Entity) => {
    Object.assign(a, build(e, () => a.level));
    a.look3 = new THREE.Vector3();
    a.lodSet = -1; a.viewD = -1.5; // [CHR m2 r2 alloc]
    a.lookKey = null; a.face = null; a.energy = -1; a.action = undefined; a.outline = undefined; a.gait = null;
    a.colorKey = colorKeyOf(e);
  };

  const spawn = (e: Entity, mode: ActorMode): Actor => {
    const brain = createBrain(e.id, { director, seedKey: e.seedKey });
    const pos = { x: door.x, y: 0, z: door.z };
    const neighbours: Lite[] = [];
    const parts = build(e, () => a.level);
    const a: Actor = {
      id: e.id, entity: e, pos, yaw: door.yaw, intent: null, arrived: false,
      brain,
      mode, // 'cold' | 'wait' | 'arrive' | 'live' | 'leave'
      bornT: t, leaveT: 0,
      path: [], pathI: 0, targetKey: null, settledAt: null, moving: false, lift: 0, level: 0, ride: null, zone: null,
      lite: {
        id: e.id, pos, yaw: 0, status: e.status, seated: false, chattingWith: null, social: false, pocket: false,
        // for social.ts: where it stands / sits, the brain's committed status + phase, and whether it may be cast
        level: 0, moving: false, settledAt: null, bstatus: null, phase: '', free: false, idleMs: 0, declined: 0,
        // [BRN fix m175-r2] crowd avoidance: riding the slide / hidden until its `arrived` event = not an obstacle
        riding: false, ghost: mode === 'wait', urgent: false, castable: false },
      neighbours, nd: new Float64Array(NEIGHBOURS), plate: null, plateSrc: null, visible: true,
      env: {
        t: 0, self: { pos, yaw: 0, settledAt: null, moving: false, level: 0 }, player: null, neighbours, cat: null,
        partner: (id) => actors.get(id)?.lite ?? null,
        invite: (visitorId, hostId) => {
          const h = actors.get(hostId);
          return !!h && h.mode === 'live' && h.brain.acceptChat(visitorId, a.pos, t + T.chatS[1] + 4);
        },
        poke: (id, r) => { const b = actors.get(id); if (b && b.mode === 'live' && !b.moving) react(b, r); },
        gig: null, rally: null,
        emit: (kind) => { social.signal(kind, a.id, t); if (kind === 'ship') broadcast(a, 'ship'); }, // [BRN M3.5] cheer the ship
        _player: { pos: { x: 0, y: 0, z: 0 }, dist: 0, inFront: false },
        aimed: false, pitSpare: null, // [BRN fix m2-fix1] walk-up attention; the Pit's spare-lounger check (social.ts)
      },
      // [CHR m2 r2 alloc, cross-owner BRN] per-frame numeric scratch declared up front as doubles (fields first added
      // later, or holding null, are stored as tagged values: every double written to them was a fresh HeapNumber).
      // Initial values match the old `?? 0` reads; jamX/jamZ/shuffleT are always written before they are read.
      aheadT: 0, crowdSideT: 0, ghostT: 0, jamX: 0.5, jamZ: 0.5, shuffleT: 0.5, viewD: -1.5, lodSet: -1,
      fyX: 0.5, fyZ: 0.5, fy: 0.5, fyL: -1,
      // ...and every other field motor / steering adds later, so all actors share one hidden class (they used to grow
      // fields in whatever order their walks took: megamorphic stores that boxed each double). undefined = "not set yet",
      // exactly what the old reads of an absent field saw.
      avoidLeg: undefined, avoidSide: undefined, blockedByPlayer: undefined, callPath: undefined, callSpeed: undefined,
      crowdLeg: undefined, crowdSide: undefined, goneWait: undefined, holdFor: undefined, holdRetryT: undefined,
      holdSince: undefined, holdWaveT: undefined, jamPatience: undefined, jamT: undefined, navWait: undefined,
      placardAnchor: undefined, placardSpec: undefined, replanT: undefined, settledSlot: undefined, shuffleKey: undefined,
      slotRef: undefined, stoppedShort: undefined, syncU: undefined, trip: undefined, waitT: undefined, walkOpts: undefined,
      yieldT: undefined,
      // [BRN fix m3-r3] stall watchdog + soft personal-space re-plan (numbers up front: one hidden class)
      progT: 0, progX: 0, progZ: 0, stallStage: 0, pushT: 0, softT: -1e9, politeT: -1e9, lineT: -1e9,
      rig: parts.rig, animator: parts.animator, handle: parts.handle, look3: new THREE.Vector3(), lookKey: null, face: null, energy: -1, action: undefined,
      outline: undefined, gait: null, colorKey: colorKeyOf(e),
      // [BRN M3.5] crate arrival / door departure / verb bookkeeping
      inCrate: false, crateT0: 0, crateStage: 0, leaveStage: null, vc: 0, att: 0,
    };
    if (mode === 'cold') coldQ.push(e); // [BRN fix m2-fix1] social.bootCast before this frame's brains
    if (mode === 'wait') a.handle.setVisible(false);
    if (mode === 'arrive') beginCrate(a);
    actors.set(e.id, a);
    return a;
  };

  const remove = (a: Actor) => {
    metrics.forget(a.id);
    social.forget(a.id);
    a.handle.remove();
    director.forget(a.id);
    fx.forget?.(a.id);
    actors.delete(a.id);
  };

  const startLeave = (a: Actor) => {
    if (a.mode === 'leave') return;
    a.mode = 'leave';
    a.leaveT = t;
    // [BRN M3.5] §6.4.3: a closed pane (post-boot, on its feet) walks to the front door and waves goodbye first
    a.leaveStage = a.visible !== false && a.inCrate !== true && coldDone ? 'walk' : 'gone';
    if (a.leaveStage === 'walk') { a.targetKey = null; a.holdFor = null; a.intent = leaveIntent; verbs.departures++; }
    else react(a, 'leave');
    fx.bubble(a.id, null);
    fx.ring(a.id, null);
    fx.glyph(a.id, null);
    fx.placard?.(a.id, null);
  };

  const rekey = (a: Actor, newId: string, e: Entity) => {
    actors.delete(a.id);
    metrics.rekey(a.id, newId);
    social.rekey(a.id, newId);
    director.rekey(a.id, newId);
    fx.forget?.(a.id);
    a.id = newId;
    a.lite.id = newId;
    a.brain.rekey?.(newId);
    a.entity = e;
    a.plateSrc = null;
    actors.set(newId, a);
  };

  // ------------------------------------------------------------------------------------------ per frame
  function syncEntities(ents: Map<string, Entity>) {
    // Re-keys first (gone{rekeyed} + entity arrive in the same or consecutive frames).
    if (rekeys.size) for (const [oldId, newId] of rekeys) {
      const a = actors.get(oldId);
      const e = ents.get(newId);
      if (a && e && !actors.has(newId)) { rekey(a, newId, e); rekeys.delete(oldId); }
      else if (!a) rekeys.delete(oldId);
    }
    // [CHR m2 r2 alloc, cross-owner BRN] walk a snapshot of the Map (filled by forEach: no iterator result per actor)
    allN = 0; actors.forEach(pushAll); if (all.length > allN) all.length = allN;
    for (let ai = 0; ai < allN; ai++) {
      const a = all[ai];
      if (actors.get(a.id) !== a) continue; // removed / re-keyed away earlier in this walk
      if (a.mode === 'leave') {
        const e = ents.get(a.id);
        if (e) { a.mode = 'live'; a.entity = e; a.leaveStage = null; a.targetKey = null; react(a, 'dissolveIn'); continue; } // flapped back
        if (a.leaveStage === 'gone' && t - a.leaveT >= T.leaveS) { fx.burst('poof', a.pos, {}); remove(a); }
        continue;
      }
      if (ents.has(a.id)) { a.goneWait = null; continue; }
      // Waiting for a re-key's new entity?
      if (rekeys.has(a.id)) {
        a.goneWait ??= t;
        if (t - a.goneWait < T.rekeyWaitS) continue;
        rekeys.delete(a.id);
      }
      if (a.mode === 'wait') { remove(a); continue; }
      startLeave(a);
    }
    syncCold = !coldDone;
    ents.forEach(syncEntity);
    if (sawWorld || ents.size) coldDone = true;
  }

  let syncCold = false;
  /** syncEntities' per-entity step (a hoisted Map.forEach callback). */
  function syncEntity(e: Entity) {
    const a = actors.get(e.id);
    if (a) {
      if (a.entity !== e) onEntityChange(a, e);
      return;
    }
    if (rekeys.size && isRekeyTarget(e.id)) return; // the old actor will take it this frame
    spawn(e, syncCold ? 'cold' : arrivedAt.has(e.id) ? 'arrive' : 'wait');
  }

  function isRekeyTarget(id: string) {
    for (const v of rekeys.values()) if (v === id) return true;
    return false;
  }

  function onEntityChange(a: Actor, e: Entity) {
    const prev = a.entity;
    a.entity = e;
    const shellNow = e.kind === 'shell', shellBefore = prev.kind === 'shell';
    const colorKey = colorKeyOf(e);
    if (shellNow !== shellBefore || (prev.kind !== e.kind) || colorKey !== a.colorKey) {
      // Kind change (agent detected in a shell pane) or workspace recolour: rebuild the rig in place.
      a.handle.remove();
      register(a, e);
      react(a, 'dissolveIn');
      if (shellNow !== shellBefore) fx.burst('poof', a.pos, {});
    }
  }

  /** [BRN fix m2-r3] the cat's position this frame (null = no ambient cast / headless) */
  let catNow: { x: number; y?: number; z: number } | null = null;
  function fillEnv(a: Actor, ctx: ActorsCtx) {
    const env = a.env;
    env.t = t;
    env.self.yaw = a.yaw;
    env.self.settledAt = a.settledAt;
    env.self.moving = a.moving;
    env.self.level = a.level;
    env.gig = social.gigFor(a.id);
    env.roomEmpty = social.roomEmpty; // [BRN fix m2-r2] showcase rooms nobody is using (a done agent's first outing)
    env.pitSpare = social.pitSpare; // [BRN fix m2-fix1] a done lounger leaves the Pit only while T.pitKeep others stay
    env.rally = social.rallyFor(a.id);
    env.hold = a.brain.state.status === 'done' && social.holdFor(a.id);
    env.cat = catNow; // [BRN fix m2-r3] Segfault (AMB ctx.ambient.catPos): a cat-pet beat when it is close
    env.aimed = false;
    const pl = ctx.player?.pos;
    if (pl) {
      const p = env._player;
      p.pos.x = pl.x; p.pos.y = pl.y; p.pos.z = pl.z;
      const dx = pl.x - a.pos.x, dz = pl.z - a.pos.z;
      p.dist = Math.abs(pl.y - a.pos.y) > 1.2 ? Infinity : Math.sqrt(dx * dx + dz * dz); // flying debug cameras don't count
      env.playerLevel = ctx.player?.level ?? (pl.y > 1.5 ? 1 : 0);
      p.inFront = -Math.sin(a.yaw) * dx - Math.cos(a.yaw) * dz > 0;
      env.player = p;
      env.aimed = aimId === a.id && p.dist <= T.attendR; // [BRN fix m2-fix1] (dist is Infinity across levels)
    } else env.player = null;
  }

  /** Nearest ≤ NEIGHBOURS actors within 6 m, nearest first (insertion into a fixed-size sorted list; no allocation). */
  function computeNeighbours(list: Actor[]) {
    // [CHR m2 r2 alloc, cross-owner BRN] index writes + one length set per actor: `n.length = 0` + push() dropped and
    // re-grew each list's backing store every frame
    for (let ai = 0; ai < list.length; ai++) {
      const a = list[ai];
      const n = a.neighbours, d = a.nd;
      let m = 0;
      for (let bi = 0; bi < list.length; bi++) {
        const b = list[bi];
        if (b === a) continue;
        const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z, d2 = dx * dx + dz * dz;
        if (d2 > NEAR2 || (m === NEIGHBOURS && d2 >= d[m - 1])) continue;
        let k = Math.min(m, NEIGHBOURS - 1);
        if (m < NEIGHBOURS) m++;
        while (k > 0 && d[k - 1] > d2) { n[k] = n[k - 1]; d[k] = d[k - 1]; k--; }
        n[k] = b.lite; d[k] = d2;
      }
      if (n.length !== m) n.length = m;
    }
  }

  function handleEvents() {
    for (const ev of events) {
      const a = actors.get(ev.id);
      if (!a || a.mode === 'leave') continue;
      if (a.mode !== 'wait' && a.brain.deferEvent?.(ev)) continue; // replayed by runEvent when the status commits
      runEvent(a, ev);
    }
    events.length = 0;
  }

  /** An event's own reaction + fx burst + the bystanders' social reaction. */
  function runEvent(a: Actor, ev: BrainEvent) {
    const r = a.brain.onEvent(ev);
    const spec = EVENT_REACTION[ev.kind];
    if (r && a.mode !== 'wait') react(a, r);
    if (spec?.fx && a.mode !== 'wait') fx.burst(spec.fx, burstPos(a), { kind: ev.kind, detail: ev.detail, count: ev.kind === 'finished' ? 40 : undefined });
    broadcast(a, ev.kind);
  }

  /** Bystanders within `socialRadius` turn to look; idle ones clap / wave / startle (ART §6.7 fun layer). */
  function broadcast(a: Actor, kind: string) {
    if (kind === 'finished' || kind === 'commit') social.signal(kind, a.id, t); // a pod-mate may come over for a high-five; a Board huddle; [BRN M3.5] cheer the ship
    if (!SOCIAL_REACTION[kind]) return;
    for (const b of actors.values()) {
      if (b === a || b.mode !== 'live') continue;
      const d2 = (a.pos.x - b.pos.x) ** 2 + (a.pos.z - b.pos.z) ** 2;
      if (d2 > T.socialRadius * T.socialRadius) continue;
      const rr = b.brain.onSocial(kind, { id: a.id, pos: a.pos }, t);
      if (rr) react(b, rr);
    }
  }

  const burstPos = (a: Actor) => ({ x: a.pos.x, y: a.pos.y + 0.9, z: a.pos.z });

  /** A reaction social.ts scheduled (a high-five, a clap in the Pit wave, a spectator's applause). */
  function pokeActor(id: string, r: string) {
    const b = actors.get(id);
    if (!b || b.mode !== 'live' || (b.moving && !WALK_OK[r])) return; // ([BRN M3.5] a high-five in passing)
    react(b, r);
    if (r === 'highFive') fx.burst('sparkle', burstPos(b), {});
  }

  /**
   * The rally ball (social.ts): one tiny paper-white sphere on the props layer, created on the first rally, one draw
   * call while visible (never otherwise). The CHR paddles hide their own practice ball while synced.
   */
  function updateBall(ctx: ActorsCtx) {
    const b = social.ball;
    if (!ballMesh) {
      if (!b.visible || !ctx.scene) return;
      // [RND fix r1, cross-owner BRN] count-1 InstancedMesh + instanced material: stays on the §5.4 toonProp program
      // (a plain Mesh compiled an off-matrix program mid-session, over the 14 scene-program cap)
      ballMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.03, 10, 8), getMaterial('toonProp', { color: '#F4EEE2', instanced: true }), 1);
      ballMesh.layers.set(LAYERS.PROPS);
      ballMesh.name = 'hq:rallyBall';
      ballMesh.matrixAutoUpdate = true;
      ctx.scene.add(ballMesh);
    }
    ballMesh.visible = b.visible;
    if (b.visible) ballMesh.position.set(b.x, b.y, b.z);
  }

  // ------------------------------------------------------------------------------------------ crate / door (§6.4.3)
  /** [BRN M3.5] §6.4.3: a newcomer starts in a parcel crate at the lobby hiring anchor (hidden inside until the unwrap) */
  function beginCrate(a: Actor) {
    // one crate on the pad at a time: a second newcomer's crate drops in as the first one clears; a burst beyond
    // crateQueueMaxS of waiting is placed like a cold start (dissolveIn at its slot) instead
    const t0 = crates.spawn(a.id, t);
    if (t0 === null) { a.mode = 'cold'; return; }
    const h = crates.anchor;
    a.pos.x = h.x; a.pos.z = h.z; a.yaw = h.yaw; a.level = 0;
    a.inCrate = true; a.crateT0 = t0; a.crateStage = 0; a.crateLanded = false;
    verbs.crates++;
  }
  /**
   * [BRN M3.5] In the hiring crate: hidden while it drops in and rattles, then the unwrap (CHR `unwrap`, the lid pops,
   * the sides fall open), a wave to the lobby, and after `crateWalkS` the walk to its slot (the motor plans it).
   */
  function crateStep(a: Actor) {
    const u = t - a.crateT0;
    a.moving = false;
    a.lift = 0.05; // standing on the crate floor
    a.animator.setLocomotion(0);
    setAction(a, 'standIdle');
    // [INT M3.5 cross-owner] announce the crate moments on the bus: AUD `crate {id, phase, pos}` (clack / unwrap
    // foley, switches its store-derived fallback off) and FX `crate.unwrap {id, pos}` (dust poof). Nothing emitted them.
    const cpos = () => ({ x: crates.anchor.x, y: 0, z: crates.anchor.z });
    if (!a.crateLanded && u >= T.crateDropS) { a.crateLanded = true; busRef?.emit?.('crate', { id: a.id, phase: 'land', pos: cpos() }); }
    if (a.crateStage === 0 && u >= T.crateUnwrapS) {
      a.crateStage = 1;
      react(a, 'unwrap');
      fx.burst('sparkle', burstPos(a), {});
      busRef?.emit?.('crate', { id: a.id, phase: 'unwrap', pos: cpos() });
      busRef?.emit?.('crate.unwrap', { id: a.id, pos: cpos() });
    }
    if (a.crateStage === 1 && u >= T.crateWaveS) { a.crateStage = 2; react(a, 'wave'); }
    if (u >= T.crateWalkS) { a.inCrate = false; a.targetKey = null; a.settledAt = null; a.arrived = false; }
  }
  const exitSlot: Slot = { id: 'pt:exit', tag: 'exit', pos: { x: door.x, y: 0, z: door.z }, yaw: door.yaw + Math.PI, pose: 'stand', level: 0 };
  const leaveIntent: Intent = { slot: exitSlot, activity: 'standIdle', face: 'happy', speed: T.leaveWalkSpeed, walkActivity: null, gait: 'skip',
    stand: false, look: null, swivel: false, turn: 0, energy: 1, trip: null, via: 'stairs', phase: 'leaving', bubble: null, ring: null,
    // (never read: the leave walk goes through motor() only, not apply())
    glyph: null, lamp: null, outline: null, dust: 0, placard: null };
  /** [BRN M3.5] a closed pane's goodbye: skip to the front door, turn round, wave, dissolve (then poof + remove). */
  function leaveStep(a: Actor, ctx: ActorsCtx, dt: number) {
    if (a.leaveStage === 'walk') {
      fillEnv(a, ctx);
      motor(a, leaveIntent, dt);
      if (a.gait !== 'skip') { a.gait = 'skip'; a.animator.setGait?.('skip'); }
      if (a.face !== 'happy') { a.face = 'happy'; a.animator.setFace('happy'); }
      if ((a.arrived && a.settledAt === exitSlot.id) || t - a.leaveT > T.leaveWalkMaxS) {
        a.leaveStage = 'wave'; a.leaveT = t; a.moving = false; react(a, 'wave');
      }
    } else {
      a.moving = false;
      a.animator.setLocomotion(0);
      if (a.leaveStage === 'wave') {
        a.yaw = dampAngle(a.yaw, door.yaw, 6, dt); // facing back into the office
        if (t - a.leaveT > T.leaveWaveS) { a.leaveStage = 'gone'; a.leaveT = t; react(a, 'leave'); }
      }
    }
    a.animator.update(dt, placeAndCull(a, ctx.camera));
  }

  // ------------------------------------------------------------------------------------------ motor
  const approachLocal = (s: Slot, out: P2): P2 => {
    // Desk chairs are entered from behind (the desk is in front); other seats from the front.
    const k = s.pose !== 'sit' ? 0 : s.tag === 'desk' ? -T.approachBack : 0.5;
    out.x = s.pos.x - Math.sin(s.yaw) * k;
    out.z = s.pos.z - Math.cos(s.yaw) * k;
    return out;
  };
  /** Where a walker steps into / out of slot `s` (the director knows the full office's seats; proto: local rule). */
  const approach = (s: Slot): Approach => {
    const p = director.approach?.(s);
    if (p) return { x: p.x, z: p.z, level: p.level ?? s.level ?? 0 };
    const q = approachLocal(s, { x: 0, z: 0 });
    return { x: q.x, z: q.z, level: s.level ?? 0 };
  };
  const seated = (s: Slot | null | undefined): boolean => !!s && (s.pose === 'sit' || s.pose === 'lie');

  /** The walk to slot `s` from where `a` stands: step out of the seat, the level-aware route, hop into the seat. */
  function buildPath(a: Actor, s: Slot, around: P2 | null = null, via: Intent['via'] = null): Path | null {
    const pts: Path = [{ x: a.pos.x, z: a.pos.z, level: a.level }];
    const cur = a.settledSlot;
    const stepOut = !!(a.settledAt && seated(cur));
    if (stepOut && cur) pts.push(approach(cur)); // step out of the seat
    const ap = approach(s);
    const from = pts[pts.length - 1];
    const o = { actorId: a.id, via, budget: true }; // [LVL fix r1, cross-owner] §5.3 A* budget: null = queued this frame
    // [BRN fix r2] routeAround is budgeted too: undefined = queued this frame (the walker waits, retries next frame)
    const alt = around && director.routeAround ? director.routeAround(from, ap, around, o) : null;
    if (alt === undefined) return null;
    const mid = alt || director.route(from, ap, o);
    if (!mid) return null;
    for (let i = 1; i < mid.length; i++) pts.push({ level: from.level, ...mid[i] });
    if (seated(s)) pts.push({ x: s.pos.x, z: s.pos.z, level: s.level ?? 0 });
    pts.stepOut = stepOut; // [BRN fix m175-r2] the first leg leaves a seat (its seat neighbours are not obstacles)
    return pts;
  }

  /**
   * How close the whole walk comes to the player (review r3 + M1.5 r1: tinker walked into the lens from 1.5 m, and a
   * path that swung back past the camera after its first metres was never checked). Samples every leg on the
   * player's level; the final approach into a destination that itself lies within `T.avoidR` of the player is left
   * out (the walker stops short there, see `stopShort`). `d0` = where it starts: a walker that starts near the player
   * may only walk away from them.
   */
  function pathClearance(pts: readonly NavPoint[], pp: P2, plLevel: number, seatEnd = false, from = 0): Clearance {
    const d0 = Math.sqrt((pts[from].x - pp.x) ** 2 + (pts[from].z - pp.z) ** 2);
    const last = Math.max(from, pts.length - (seatEnd ? 2 : 1)); // the final standing point
    const end = pts[last];
    const endNear = Math.sqrt((end.x - pp.x) ** 2 + (end.z - pp.z) ** 2) < T.avoidR;
    let total = 0;
    for (let i = from + 1; i <= last; i++) total += Math.sqrt((pts[i].x - pts[i - 1].x) ** 2 + (pts[i].z - pts[i - 1].z) ** 2);
    let min = Infinity, run = 0;
    for (let i = from + 1; i <= last; i++) {
      const p = pts[i - 1], q = pts[i];
      const L = Math.sqrt((q.x - p.x) ** 2 + (q.z - p.z) ** 2), n = Math.max(1, Math.ceil(L / 0.2));
      // ([BRN fix m3-r3] a stairs leg — one end on each level — counts: it skipped the whole flight, so a player standing
      // on the stairs was never "in the way" and walkers climbed into the lens)
      const skip = ((p.level ?? 0) !== plLevel && (q.level ?? 0) !== plLevel) || q.portal === 'slide';
      for (let k = 1; k <= n && !skip; k++) {
        const u = k / n, x = p.x + (q.x - p.x) * u, z = p.z + (q.z - p.z) * u;
        if (endNear && total - (run + L * u) < T.avoidR) continue; // the stop-short tail
        const d = Math.sqrt((x - pp.x) ** 2 + (z - pp.z) ** 2);
        if (d < min) min = d;
      }
      run += L;
    }
    return { min, d0 };
  }
  const pathOk = (c: Clearance, r: number = T.departClearR) => c.min >= r || c.min >= c.d0 - 0.02;
  /** [BRN fix m3-r3] a walk's soft cost: its length + T.personalCostK per metre it cuts into the player's personal space
   * (measured from where it starts: a walker already inside who only walks away pays nothing) */
  function pathCost(pts: readonly NavPoint[], c: Clearance, from = 0) {
    let L = 0;
    for (let i = from + 1; i < pts.length; i++) L += Math.sqrt((pts[i].x - pts[i - 1].x) ** 2 + (pts[i].z - pts[i - 1].z) ** 2);
    return L + T.personalCostK * Math.max(0, Math.min(T.personalR, c.d0 - 0.02) - c.min);
  }

  /**
   * Plan the walk to `s`. With the player close by, a route that passes them is swapped for one around them; if even
   * that walks into them (they stand at the chair's step-out, in a dead end) the actor holds where it is, looking at
   * them, until they clear. @returns false = holding (nothing changed); 'nav' = the route is queued
   */
  function plan(a: Actor, s: Slot, via: Intent['via']): boolean | 'nav' {
    const pl = a.env.player;
    let pts = buildPath(a, s, null, via);
    if (!pts) return 'nav'; // [LVL fix r1, cross-owner] route queued (§5.3): wait in place, retry next frame
    if (pl && pl.dist < T.avoidNearM) {
      const lv = a.env.playerLevel ?? 0; // (set whenever the player is: fillEnv)
      // after holding T.holdRelaxS for a player who does not move, accept the mid-walk clearance (still no squeezing);
      // [BRN fix m3-r3] held T.stallMaxS: any way out (the stall cap — it squeezes past at playerMinD)
      const held = a.holdSince != null ? t - a.holdSince : 0;
      const r = held >= T.holdRelaxS ? T.passMinR : T.departClearR;
      const c = pathClearance(pts, pl.pos, lv, seated(s));
      // [BRN fix m3-r3] personal space as a soft cost: a walk that cuts into T.personalR looks for a way round and
      // takes whichever costs less (length + T.personalCostK × the metres it cuts in); the hard floor `r` as before
      if (!pathOk(c, T.personalR)) {
        const alt = buildPath(a, s, pl.pos, via);
        if (!alt) return 'nav';
        const ca = pathClearance(alt, pl.pos, lv, seated(s));
        if (pathCost(alt, ca) < pathCost(pts, c) - 0.05) pts = alt;
        if (!pathOk(pts === alt ? ca : c, r)) { a.politeT = t; return false; }
      }
    }
    a.path = pts;
    a.pathI = 1;
    a.walkOpts = director.walkOpts?.(a.id, pts[0], pts[pts.length - 1]); // [BRN fix m175-r2] side-steps: lane / back door
    a.stoppedShort = false;
    a.settledAt = null;
    a.settledSlot = null;
    a.arrived = false;
    a.trip = a.intent?.trip ?? null;
    return true;
  }

  /**
   * Work-call dash (§6.4.2, [BRN fix r1]): fixed per planned path so the whole remaining leg takes ≤ T.workCallBudgetS,
   * clamped to [the Intent's 2.8 m/s scurry, T.workCallDashMax]. Re-derived when the path is re-planned.
   */
  function callSpeed(a: Actor, base: number): number {
    if (a.callPath !== a.path) {
      a.callPath = a.path;
      let rem = 0, budget = T.workCallBudgetS, x = a.pos.x, z = a.pos.z;
      for (let i = a.pathI; i < a.path.length; i++) {
        const p = a.path[i];
        if (p.portal === 'slide') budget -= layout.slide?.duration ?? 2.2; // the ride is time-based
        else rem += Math.sqrt((p.x - x) ** 2 + (p.z - z) ** 2);
        x = p.x; z = p.z;
      }
      a.callSpeed = clamp(rem / Math.max(budget, 2), base, Math.max(base, T.workCallDashMax));
    }
    return a.callSpeed ?? base; // (always set by the re-derive above)
  }

  /** Ride the helix (§6.4.1 "stairs up, slide down"): time-based along `layout.slide.path`, easing into speed. */
  function rideStep(a: Actor, r: Ride, dt: number): boolean {
    r.t += dt;
    const u = Math.min(1, r.t / r.dur);
    const k = u < 0.15 ? (u / 0.15) ** 2 * 0.075 : 0.075 + (u - 0.15) / 0.85 * 0.925; // a slow tip-over, then whoosh
    const target = k * r.len;
    while (r.i < r.cum.length - 2 && r.cum[r.i + 1] < target) r.i++;
    const p = r.pts[r.i], q = r.pts[r.i + 1], seg = r.cum[r.i + 1] - r.cum[r.i] || 1e-6;
    const f = Math.min(1, Math.max(0, (target - r.cum[r.i]) / seg));
    a.pos.x = p.x + (q.x - p.x) * f; a.pos.z = p.z + (q.z - p.z) * f; r.y = p.y + (q.y - p.y) * f;
    const dx = q.x - p.x, dz = q.z - p.z;
    if (dx * dx + dz * dz > 1e-8) a.yaw = dampAngle(a.yaw, Math.atan2(-dx, -dz), 14, dt);
    return u >= 1;
  }
  const startRide = (a: Actor): boolean => {
    const slide = layout.slide, pts = slide?.path;
    if (!slide || !pts?.length) return false;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z));
    a.ride = { t: 0, dur: slide.duration ?? 2.2, pts, cum, len: cum[cum.length - 1], i: 0, y: pts[0].y };
    return true;
  };

  function motor(a: Actor, intent: Intent, dt: number) {
    const s = intent.slot;
    if (!s) return;
    const key = s.id;
    if (a.mode === 'cold') {
      // Cold start: at the slot already, deterministic, with a dissolve-in (§6.4.3).
      a.pos.x = s.pos.x; a.pos.z = s.pos.z; a.yaw = s.yaw; a.level = s.level ?? 0;
      a.settledAt = key; a.settledSlot = s; a.arrived = true; a.targetKey = key;
      a.lift = intent.stand ? T.seatY : s.lift ?? 0;
      a.mode = 'live';
      react(a, 'dissolveIn');
      return;
    }
    if (a.ride) { // a ride in progress always finishes (a status change re-plans at the bottom)
      a.moving = true;
      a.animator.setLocomotion(0);
      setAction(a, 'slideRide');
      if (rideStep(a, a.ride, dt)) {
        const p = a.path[a.pathI];
        a.ride = null;
        if (p) { a.pos.x = p.x; a.pos.z = p.z; a.level = p.level ?? 0; a.pathI++; }
        metrics.count('slideRides');
        react(a, 'hop');
      }
      return;
    }
    stallTick(a, s, key); // [BRN fix m3-r3] ≤ T.stallMaxS standing still on the way anywhere
    // [BRN fix m175-r2] queue shuffle beat: moving up a place waits a moment, so the served head walks out of the lane
    // before the line closes up (they all used to swap places at once, walking through one another), and never onto a
    // place someone still stands on
    if (key !== a.targetKey && s.tag === 'queue' && !a.holdFor && a.settledAt && a.settledSlot?.tag === 'queue') {
      if (a.shuffleKey !== key) { a.shuffleKey = key; a.shuffleT = t + T.queueShuffleS; }
      if (t < a.shuffleT || spotTaken(a, s)) { a.moving = false; a.lineT = t; a.animator.setLocomotion(0); return; }
    }
    if (key !== a.targetKey || a.holdFor) {
      if (a.settledAt === key) { a.arrived = true; a.holdFor = null; a.targetKey = key; }
      else if (key !== a.targetKey || t >= (a.holdRetryT ?? NaN)) { // (holdFor always comes with a retry time)
        a.targetKey = key;
        a.holdFor = null;
        const planned = plan(a, s, intent.via);
        a.navWait = planned === 'nav'; // [LVL fix r1, cross-owner] queued route: retry next frame, no wave (hold())
        if (a.navWait) { a.holdFor = key; a.holdRetryT = t; }
        else if (!planned) { a.holdFor = key; a.holdRetryT = t + 0.35; a.holdSince ??= t; }
        else a.holdSince = null;
      }
      if (a.holdFor) return hold(a, intent, dt);
    }
    a.slotRef = s;
    const speed = (intent.trip === 'workCall' ? callSpeed(a, intent.speed) : ((a.callPath = null), intent.speed)) * ((a.entity.contextTokens ?? 0) >= 180_000 ? 0.75 : 1);
    if (!a.arrived && a.pathI < a.path.length) {
      a.moving = true;
      let step = speed * dt;
      let turn = 0;
      const pl = a.env.player;
      let waiting = false;
      // [BRN fix r1] Look ahead (4 Hz): the player stepped into the rest of the walk (or the walk began before they
      // came close) → re-plan around them; no way around → wait politely where it is ("after you!") and re-check.
      if (pl && pl.dist < T.avoidNearM && t >= (a.aheadT ?? 0)) {
        a.aheadT = t + 0.25;
        softReplan(a, s, pl.pos); // [BRN fix m3-r3] keep out of the player's personal space when a way round is cheap
        a.blockedByPlayer = !aheadClear(a, s, pl.pos) && !(replanAround(a, s, pl.pos) && aheadClear(a, s, pl.pos));
      } else if (!pl || pl.dist >= T.avoidNearM) a.blockedByPlayer = false;
      // ([BRN fix m3-r3] the stall cap: from T.stallSqueezeS on it no longer waits for the player)
      // (… unless the player really plugs the way — a stair, a door: then it keeps waving "after you!", facing them)
      if (a.blockedByPlayer && pl && (a.stallStage < 2 || !passable(a, s, pl.pos))) { a.moving = false; a.politeT = t; return hold(a, intent, dt); }
      // [BRN fix m175-r2] the queue place ahead is still taken: wait a step short of it
      if (s.tag === 'queue' && near(a.pos, s.pos, 1.1) && spotTaken(a, s)) { a.lineT = t; a.animator.setLocomotion(0); setAction(a, 'standIdle'); return; }
      while (step > 0 && a.pathI < a.path.length) {
        const p = a.path[a.pathI];
        if (p.portal === 'slide') { // at the mouth: ride down to the exit point
          // [BRN fix m175-r2] one rider at a time: wait at the mouth until the one ahead is well down the helix
          if (t < slideFreeT || (exitBusy(a) && a.stallStage < 3)) { a.animator.setLocomotion(0); setAction(a, 'standIdle'); return; }
          slideFreeT = t + T.slideGapS;
          if (startRide(a)) { a.animator.setLocomotion(0); setAction(a, 'slideRide'); return; }
          a.pos.x = p.x; a.pos.z = p.z; a.level = p.level ?? 0; a.pathI++; continue;
        }
        const dx = p.x - a.pos.x, dz = p.z - a.pos.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        // [BRN fix m175-r2] side-stepping someone: a corner waypoint within 0.4 m counts as passed (no snap onto it)
        // ([BRN fix m3-r3] pushing out of a stall: any waypoint but the last within 0.7 m, e.g. a step-in the player stands on)
        const soft = (a.crowdSide !== 0 && a.crowdSide !== undefined && d < 0.4 && a.pathI < a.path.length - 2)
          || (t < a.pushT && d < 0.7 && a.pathI < a.path.length - 1);
        if (d <= Math.max(T.arriveEps, step) || soft) {
          if (!soft) { a.pos.x = p.x; a.pos.z = p.z; step -= d; }
          a.pathI++;
          const lv = p.level ?? a.level;
          if (lv !== a.level && p.portal === 'stairs') metrics.count(lv > a.level ? 'stairClimbs' : 'stairDescents');
          a.level = lv;
          continue;
        }
        let ux = dx / d, uz = dz / d;
        if (pl && pl.dist < T.avoidAheadM + T.avoidR && avoidPlayer(a, ux, uz, p, pl.pos, steer)) {
          ux = steer.x; uz = steer.z;
          step *= steer.k;
          waiting = steer.k === 0;
        } else {
          a.avoidSide = 0; a.waitT = null;
          // [BRN fix m175-r2] other agents are soft dynamic obstacles: side-step seated / standing ones and walkers
          if (crowdSteer(a, ux, uz, p, steer)) {
            if (steer.skip) continue; // the corner waypoint sits on someone: cut to the next one
            ux = steer.x; uz = steer.z;
            step *= steer.k;
            waiting = steer.k === 0;
            unjam(a);
          } else { a.jamT = t; a.jamX = a.pos.x; a.jamZ = a.pos.z; }
        }
        if (pl && a.stallStage < 3 && stopShort(a, s, p, pl.pos)) {
          if (seated(s)) { a.stoppedShort = true; a.holdFor = key; a.holdRetryT = t + 0.35; a.targetKey = null; break; } // wait for the seat
          a.path.length = a.pathI; a.stoppedShort = true; break;
        }
        a.pos.x += ux * step; a.pos.z += uz * step;
        separate(a, dt); // [BRN fix m175-r2] never inside another body (projection; walls win)
        if (pl) keepOffPlayer(a, pl.pos);
        const y0 = a.yaw;
        a.yaw = dampAngle(a.yaw, Math.atan2(-ux, -uz), 12, dt);
        turn = wrapAngle(a.yaw - y0) / Math.max(dt, 1e-4);
        step = 0;
      }
      a.lift = Math.max(0, a.lift - dt * 1.5);
      a.animator.setLocomotion(waiting ? 0 : speed);
      setAction(a, intent.walkActivity);
      if (a.pathI >= a.path.length) {
        a.arrived = true;
        a.settledAt = key;
        a.settledSlot = s;
        a.moving = false;
        a.level = s.level ?? a.level;
        a.animator.setLocomotion(0);
        if (a.trip === 'station') metrics.count('stationTrips');
        a.stallStage = 0; a.pushT = 0;
        a.trip = null;
        if (a.mode === 'arrive') { a.mode = 'live'; react(a, a.crateStage ? 'hop' : 'arrive'); } // (the animator hops onto seats itself)
      }
      return;
    }
    settle(a, intent, s, key, dt); // [CHR m2 r2 alloc, cross-owner BRN] own function: motor ran out of inlining budget
  }

  /** Settled at (or stopped short of) slot `s`: face it / swivel toward the look target, seat lift, stand activity. */
  function settle(a: Actor, intent: Intent, s: Slot, key: string, dt: number) {
    a.moving = false;
    if (s.pose === 'stand' && a.settledAt === key && !intent.stand) makeWay(a, s, dt); // [BRN fix m175-r2]
    // Stopped short of a spot the player stood on: finish the walk once they have moved off it.
    if (a.stoppedShort) {
      const pl = a.env.player;
      if (!pl || Math.sqrt((s.pos.x - pl.pos.x) ** 2 + (s.pos.z - pl.pos.z) ** 2) >= T.avoidR + 0.3) { a.stoppedShort = false; a.settledAt = null; a.targetKey = null; }
    }
    // Settled: face the slot, or swivel / turn toward what the brain is looking at.
    // [CHR cross-owner m175-r2] a sofa does not swivel: seatTurn() caps the turn on fixed seats (anim/seat.ts), and the
    // animator keeps seated limbs in front of the seat's backrest (setSeat)
    const swMax = s.pose === 'sit' ? seatTurn(s, T.swivelMax) : 0;
    a.animator.setSeat?.(s.pose === 'sit' ? s : null);
    let yaw = s.yaw + (s.pose === 'sit' ? clamp(intent.turn ?? 0, -swMax, swMax) : intent.turn ?? 0);
    if (intent.look) {
      const toLook = Math.atan2(-(intent.look.x - a.pos.x), -(intent.look.z - a.pos.z));
      if (s.pose !== 'sit') yaw = toLook; // standing: turn to face it
      else if (intent.swivel) yaw = s.yaw + clamp(wrapAngle(toLook - s.yaw), -swMax, swMax);
    }
    a.yaw = dampAngle(a.yaw, yaw, s.pose === 'sit' ? 5 : 7, dt);
    // Stand on the chair while freshly blocked (hop up / down); an upper bunk lifts the sleeper.
    const lift = intent.stand ? T.seatY : s.lift ?? 0;
    a.lift = lift > a.lift ? Math.min(lift, a.lift + dt * 2.5) : Math.max(lift, a.lift - dt * 2.5);
    a.animator.setLocomotion(0);
    setAction(a, standable(s, intent));
  }

  /**
   * Local avoidance (anim review r2): a walker whose line passes the player's circle sidesteps around it instead of
   * walking through the camera's near plane. Steers perpendicular to the path, away from the player (the side sticks
   * for the pass), only onto open floor; fades out when the waypoint itself lies inside the circle (the player stands
   * at the destination: walk up politely rather than orbit). Writes the unit direction + speed factor into `out`.
   * @returns true when steering
   */
  function avoidPlayer(a: Actor, ux: number, uz: number, wp: NavPoint, pp: P2, out: Steer): boolean {
    const R = T.avoidR;
    const rx = pp.x - a.pos.x, rz = pp.z - a.pos.z;
    const along = rx * ux + rz * uz;
    const lat = -rx * uz + rz * ux; // player's offset along the path's left normal (−uz, ux)
    if (along < -0.25 || along > T.avoidAheadM || Math.abs(lat) >= R) return false;
    let k = (R - Math.abs(lat)) / R; // how deep the line cuts into the circle
    k *= clamp(1 - (along - 0.9) / (T.avoidAheadM - 0.9), 0, 1); // ease in with distance
    const wd = Math.sqrt((wp.x - pp.x) ** 2 + (wp.z - pp.z) ** 2);
    const last = a.pathI >= a.path.length - 1;
    if (wd < R && last) k *= clamp((wd - 0.35) / (R - 0.35), 0, 1); // destination next to the player: walk up to it
    // [BRN fix m3-r3] a corner inside the (now 1.5 m) circle but ≥ passMinR from the player: the soft space gives way —
    // fade the side-step and walk to it (only a corner inside passMinR is unreachable: re-plan / wait below)
    else if (wd < R && !last) k *= clamp((wd - T.passMinR) / (R - T.passMinR), 0, 1);
    if (k <= 0.01) return false;
    // [BRN fix m175-r2] the side is relative to the leg: a side picked on the previous leg (before a corner) would now
    // point anywhere, even at the player
    if (a.avoidLeg !== a.pathI) { a.avoidLeg = a.pathI; a.avoidSide = 0; }
    const pref = a.avoidSide || (lat > 0 ? -1 : 1);
    // a corner waypoint inside the player's circle can't be reached by sidestepping: re-plan (below)
    // ([BRN fix m3-r3] with the 1.5 m circle a full-strength side-step often probes into a wall: gentler ones next)
    if (!(wd < T.passMinR && !last)) for (let fi = 0; fi < 3; fi++) for (let si = 0, side = pref; si < 2; si++, side = -side) {
      const kk = k * (fi === 0 ? 1 : fi === 1 ? 0.6 : 0.35);
      let sx = ux + side * -uz * 2.2 * kk, sz = uz + side * ux * 2.2 * kk;
      const L = Math.sqrt(sx * sx + sz * sz);
      sx /= L; sz /= L;
      if (director.walkable && !director.walkable(a.pos.x + sx * 0.45, a.pos.z + sz * 0.45, a.level)) continue;
      a.avoidSide = side;
      out.x = sx; out.z = sz;
      out.k = 1 - 0.25 * k; // slow a little while squeezing past
      return true;
    }
    // Hemmed in (the player stands in an aisle): re-plan around them (rate-limited); if there is no way around,
    // wait politely in front of them for a while ("excuse me"), then squeeze past.
    out.x = ux; out.z = uz; out.k = 1;
    // [BRN fix m2-r2] a corner waypoint inside the circle can't be sidestepped at all: re-plan / wait from a wider band
    // (it walked up to its corner 0.79 m from a player standing beside the next desk; sim.test hero cameras, mixed seed 2)
    const hard = wd < T.passMinR && !last ? R - 0.2 : T.avoidHardR;
    if (Math.abs(lat) < hard && along > 0 && along < R + 0.6) {
      if (t - (a.replanT ?? -Infinity) > 1.2 && a.slotRef && replanAround(a, a.slotRef, pp)) return avoidPlayer(a, ...dirTo(a), a.path[a.pathI], pp, out);
      // [BRN fix m3-r3] the stall cap: from T.stallSqueezeS on it squeezes past (keepOffPlayer still holds playerMinD)
      if (a.stallStage >= 2 && a.slotRef && passable(a, a.slotRef, pp)) return true;
      a.politeT = t;
      // [BRN fix r1] no squeezing past any more (it walked into the lens): wait, wave "after you!", keep re-planning
      a.waitT ??= t;
      out.k = 0;
      if (t >= (a.holdWaveT ?? 0)) { a.holdWaveT = t + T.holdWaveS; react(a, 'wave'); }
    }
    return true;
  }
  /**
   * A standing destination (a wander / signpost / chill point, a queue or lounge spot) next to the player: arrive where
   * the walker is once it is `T.avoidR` from the player on the last leg, instead of walking up into the camera. Seats
   * and the desk are exempt (the walk must reach the chair; the hop in is the sit animation).
   */
  function stopShort(a: Actor, s: Slot, wp: P2, pp: P2): boolean {
    if (a.pathI !== a.path.length - (seated(s) ? 2 : 1)) return false; // heading for the final standing point
    // [BRN fix m3-r3] (playtest m3-r3: ledger and claude·2 stood 8–20 s a step from their E1 chairs, the player 1.5–2 m
    // off) a seat waits only while the player stands on its step-in (unreachable: < playerMinD + 0.12); otherwise the
    // walker takes its chair — the hop in is the sit animation
    const R = seated(s) ? T.playerMinD + 0.12 : T.stopShortR;
    if (Math.sqrt((wp.x - pp.x) ** 2 + (wp.z - pp.z) ** 2) >= R) return false;
    return Math.sqrt((a.pos.x - pp.x) ** 2 + (a.pos.z - pp.z) ** 2) <= Math.max(R, T.playerMinD + 0.3) + 0.05;
  }
  /** [BRN fix m3-r3] can the rest of the walk get past the player at a polite distance (≥ passMinR all the way)? */
  function passable(a: Actor, s: Slot, pp: P2): boolean {
    ahead.length = 0;
    here.x = a.pos.x; here.z = a.pos.z; here.level = a.level;
    ahead.push(here);
    for (let i = a.pathI; i < a.path.length; i++) ahead.push(a.path[i]);
    if (ahead.length < 2) return true;
    return pathOk(pathClearance(ahead, pp, a.env.playerLevel ?? 0, seated(s)), T.passMinR);
  }
  const dirTo = (a: Actor): [number, number] => {
    const p = a.path[a.pathI];
    const dx = p.x - a.pos.x, dz = p.z - a.pos.z, d = Math.sqrt(dx * dx + dz * dz) || 1;
    return [dx / d, dz / d];
  };
  /** Is the rest of the walk (from where the walker stands) clear of the player? */
  const ahead: NavPoint[] = [], here: NavPoint & { level: number } = { x: 0, z: 0, level: 0 };
  function aheadClear(a: Actor, s: Slot, pp: P2): boolean {
    ahead.length = 0;
    here.x = a.pos.x; here.z = a.pos.z; here.level = a.level;
    ahead.push(here);
    for (let i = a.pathI; i < a.path.length; i++) ahead.push(a.path[i]);
    if (ahead.length < 2) return true;
    return pathOk(pathClearance(ahead, pp, a.env.playerLevel ?? 0, seated(s)), T.passMinR); // the sidestep adds margin
  }
  /** Swap the rest of the path for a route around the player. */
  function replanAround(a: Actor, s: Slot, pp: P2): boolean {
    a.replanT = t;
    const pts = aroundPts(a, s, pp);
    if (!pts) return false; // null: no way round; undefined: this frame's A* budget is spent (§5.3) → wait, re-check
    usePath(a, pts);
    return true;
  }
  /** The rest of the walk to `s` from where `a` stands, round a body at `pp` (null / undefined as routeAround). */
  function aroundPts(a: Actor, s: Slot, pp: P2): NavPoint[] | null | undefined {
    const from = { x: a.pos.x, z: a.pos.z, level: a.level };
    const mid = director.routeAround?.(from, approach(s), pp, { actorId: a.id });
    if (!mid) return mid;
    const pts = [from];
    for (let i = 1; i < mid.length; i++) pts.push({ level: a.level, ...mid[i] });
    if (seated(s)) pts.push({ x: s.pos.x, z: s.pos.z, level: s.level ?? 0 });
    // [INT fix r1, cross-owner] a 1-point route left path[pathI] undefined → dirTo threw ("frame threw", PLY report)
    return pts.length < 2 ? null : pts;
  }
  function usePath(a: Actor, pts: NavPoint[]) {
    a.path = pts;
    a.pathI = 1;
    a.walkOpts = director.walkOpts?.(a.id, pts[0], pts[pts.length - 1]);
  }
  /**
   * [BRN fix m3-r3] Mid-walk personal space (fun review m3-r3: walkers passed a seated / standing camera at 0.8–2 m):
   * the rest of the walk cuts into T.personalR of the player → the route round them (personal-space tiers) when it
   * costs less (pathCost: length + T.personalCostK per metre cut in). ≤ 1 / T.personalReplanS per walker.
   */
  function softReplan(a: Actor, s: Slot, pp: P2) {
    if (t - a.softT < T.personalReplanS || t < a.pushT || a.pathI >= a.path.length) return;
    ahead.length = 0;
    here.x = a.pos.x; here.z = a.pos.z; here.level = a.level;
    ahead.push(here);
    for (let i = a.pathI; i < a.path.length; i++) ahead.push(a.path[i]);
    if (ahead.length < 2) return;
    const lv = a.env.playerLevel ?? 0;
    const c = pathClearance(ahead, pp, lv, seated(s));
    if (pathOk(c, T.personalR)) return;
    const cost0 = pathCost(ahead, c);
    const pts = aroundPts(a, s, pp);
    if (pts === undefined) return; // A* budget spent: ask again next tick
    a.softT = t;
    if (!pts) return;
    const c1 = pathClearance(pts, pp, lv, seated(s));
    if (pathCost(pts, c1) < cost0 - 0.05) { usePath(a, pts); stallStats.softReplans++; }
  }
  /**
   * [BRN fix m3-r3] Stall watchdog (playtest m3-r3: two walkers jammed 8–20 s in the library doorway, lumen 20 s on its
   * way to roundtable:3, speed 0, arrived false). Progress = T.stallMoveM of displacement; a walker on its way (not
   * settled at the Intent's slot; waiting its turn in the help queue and a queued A* route excepted) that makes none escalates:
   * T.stallRepathS a re-plan round whoever is in the way (the nearest body ahead, else the player); T.stallSqueezeS
   * squeeze past bodies at crowdSqueeze and stop waiting on the player / on a yield; T.stallMaxS push along the path for
   * T.stallPushS (no side-steps, no separation, soft waypoints; walls still win) — re-armed while it still gets nowhere.
   * @returns seconds without progress
   */
  function stallTick(a: Actor, s: Slot, key: string): number {
    const going = a.mode !== 'cold' && !a.inCrate && a.settledAt !== key && !a.navWait && t - a.lineT > 0.2
      && !(a.arrived && a.stoppedShort);
    if (!going || (a.pos.x - a.progX) ** 2 + (a.pos.z - a.progZ) ** 2 > T.stallMoveM * T.stallMoveM) {
      if (going && a.stallStage) stallStats.cleared++;
      a.progT = t; a.progX = a.pos.x; a.progZ = a.pos.z; a.stallStage = 0;
      return 0;
    }
    const st = t - a.progT;
    if (a.politeT >= a.progT) stallStats.politeS = Math.max(stallStats.politeS, st); // waiting on a player who plugs the way
    else if (st > stallStats.maxS) { stallStats.maxS = st; stallStats.maxWho = `${a.id} ${a.intent?.phase ?? ''} @${a.pos.x.toFixed(1)},${a.pos.z.toFixed(1)} t=${t.toFixed(1)}`; }
    if (st >= T.stallRepathS && a.stallStage < 1) {
      a.stallStage = 1; stallStats.repaths++;
      if (a.path.length && a.pathI < a.path.length && !a.holdFor) {
        const b = bodyAhead(a);
        const pl = a.env.player;
        if (b) { blocker.x = b.pos.x; blocker.z = b.pos.z; replanAround(a, s, blocker); }
        else if (pl && pl.dist < 3) replanAround(a, s, pl.pos);
      }
    }
    if (st >= T.stallSqueezeS && a.stallStage < 2) { a.stallStage = 2; a.ghostT = t + T.stallPushS; }
    if (st >= T.stallMaxS && t >= a.pushT) {
      if (a.stallStage < 3) stallStats.breaks++;
      a.stallStage = 3; a.pushT = t + T.stallPushS; a.ghostT = a.pushT;
      if (a.holdFor) a.holdRetryT = t; // (a hold re-plans now, with the cap's "any way out")
    }
    return st;
  }
  /** The nearest other body within 1.2 m roughly ahead of the walker (a walker or a settled one), or null. */
  function bodyAhead(a: Actor): Lite | null {
    const p = a.path[a.pathI];
    if (!p) return null;
    const dx = p.x - a.pos.x, dz = p.z - a.pos.z, d = Math.sqrt(dx * dx + dz * dz) || 1, ux = dx / d, uz = dz / d;
    let best: Lite | null = null, bd = 1.2;
    for (let i = 0; i < a.neighbours.length; i++) {
      const b = a.neighbours[i];
      if (!b || b.level !== a.level || b.riding || b.ghost) continue;
      const rx = b.pos.x - a.pos.x, rz = b.pos.z - a.pos.z, r = Math.sqrt(rx * rx + rz * rz);
      if (r < bd && rx * ux + rz * uz > -0.2) { bd = r; best = b; }
    }
    return best;
  }
  const stallStats: StallStats = { repaths: 0, breaks: 0, cleared: 0, softReplans: 0, maxS: 0, maxWho: '', politeS: 0 };
  const steer: Steer = { x: 0, z: 0, k: 1, skip: false };

  /**
   * [BRN fix m175-r2] How much of an obstacle neighbour `b` is for walker `a` right now (a radius factor; 0 = none).
   * None: other levels, a bunk above / below (|dy|), slide riders (until they land), hidden newcomers, and a body on
   * the very spot the walk ends at (the lower bunk under an upper one). Brushed past (0.6 ×): the agents settled next
   * to where the walk ends (hot-desk / sofa neighbours, a chat host, the queue ahead) or begins (stepping out of a seat
   * past its neighbour) — the walk has to get that close.
   */
  function crowdObstacle(a: Actor, b: Lite): number {
    if (b.level !== a.level || b.riding || b.ghost || Math.abs(b.pos.y - a.pos.y) > 0.6) return 0;
    const P = a.path, n = P.length;
    if (n && !b.moving) { // (a passer-by is always a full obstacle: only the agents settled where the walk ends / begins)
      const e = P[n - 1], s = n > 1 && seated(a.slotRef) ? P[n - 2] : e;
      if (near(b.pos, e, 0.3)) return 0;
      if (near(a.pos, s, 1.1) && (near(b.pos, s, 0.95) || near(b.pos, e, 0.95))) return T.crowdNearK;
      if (b.seated && P.stepOut && a.pathI === 1 && near(b.pos, P[0], 0.95)) return T.crowdNearK;
    }
    return 1;
  }
  /** Someone stands / walks within 0.9 m of the slide's landing (the rider would land on them). */
  const exitBusy = (a: Actor) => {
    const e = layout.slide?.exit;
    if (!e) return false;
    for (let i = 0; i < list.length; i++) { const b = list[i]; if (b !== a && !b.ride && b.level === 0 && near(b.pos, e, 0.9)) return true; }
    return false;
  };
  /** Someone else stands (or is walking) on slot `s`'s spot. */
  const spotTaken = (a: Actor, s: Slot) => {
    for (let i = 0; i < list.length; i++) { const b = list[i]; if (b !== a && b.level === (s.level ?? 0) && near(b.pos, s.pos, 0.5)) return true; }
    return false;
  };
  const near = (p: P2, q: P2, r: number) => (p.x - q.x) ** 2 + (p.z - q.z) ** 2 < r * r;

  /**
   * [BRN fix m175-r2] Crowd steering: the walker's line is checked against its (≤ 6, nearest-first) neighbours. A body
   * within `crowdStaticR` / `crowdPassR` of the line ahead bends the heading sideways (the side sticks for the pass;
   * dead ahead = keep to your own right, so two walkers meeting head-on step apart); only onto open floor. A walker
   * that cannot side-step a walker coming the other way in a gap yields (the one with the larger id waits up to
   * `crowdYieldS`); a static body that cannot be side-stepped is left to `separate` (slides round it along the wall).
   * @returns true when steering (out: unit direction + speed factor; out.skip = waypoint advanced)
   */
  function crowdSteer(a: Actor, ux: number, uz: number, wp: NavPoint, out: Steer): boolean {
    out.skip = false;
    if (t < a.pushT) return false; // [BRN fix m3-r3] pushing out of a stall: along the path, through the knot
    const nx = -uz, nz = ux; // lateral axis
    const g = t < (a.ghostT ?? 0) ? T.crowdSqueeze : 1; // breaking a jam (unjam): squeeze past at a brush
    if (a.crowdLeg !== a.pathI) { a.crowdLeg = a.pathI; a.crowdSide = 0; } // (sides are relative to the leg)
    let n = 0, slow = 1, follow = 1, onWp = false, head: Lite | null = null, nearest = Infinity, s0 = a.crowdSide || 0;
    for (let _bi = 0; _bi < a.neighbours.length; _bi++) {
      const b = a.neighbours[_bi];
      if (!b) continue;
      const rx = b.pos.x - a.pos.x, rz = b.pos.z - a.pos.z;
      if (rx * rx + rz * rz > (T.crowdLookM + 0.6) ** 2) continue;
      const f = crowdObstacle(a, b);
      if (!f) continue;
      const R = (b.moving ? T.crowdPassR : T.crowdStaticR) * g * f;
      const along = rx * ux + rz * uz, lat = rx * nx + rz * nz;
      if (along <= -0.05 || along > T.crowdLookM || Math.abs(lat) >= R) continue;
      if (n === OBS) break;
      obs[n * 3] = along; obs[n * 3 + 1] = lat; obs[n * 3 + 2] = R; n++;
      if (near(wp, b.pos, R) && along > 0) onWp = true;
      if (!s0 && along < nearest) nearest = along, s0 = lat > 0.04 ? -1 : lat < -0.04 ? 1 : 1; // dead ahead: keep right
      if (b.moving) {
        const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw); // its heading
        const dot = fx * ux + fz * uz;
        if (dot < -0.3 && along < 1.1) { slow = Math.min(slow, 0.75); head = b; }
        else if (dot > 0.5) follow = Math.min(follow, clamp((along - R) / 0.4, 0, 1)); // tailing it
      }
    }
    // a corner waypoint on top of someone can't be reached by side-stepping: head for the next one when it's in reach
    if (onWp && a.pathI < a.path.length - 1 && !wp.portal && !a.path[a.pathI + 1].portal && (wp.level ?? a.level) === a.level
      && near(a.pos, wp, 1.2) && lineWalkable(a, a.path[a.pathI + 1])) {
      a.pathI++; out.skip = true; return true;
    }
    if (!n) {
      if (t >= (a.crowdSideT ?? 0)) a.crowdSide = 0;
      a.yieldT = null;
      return false;
    }
    // Per side: the lateral offset m that clears every body in the way, and the heading that reaches it by the time
    // the walker draws level with that body (gentle from afar, sharper up close). Open floor first; in a tight spot
    // (the aisle by the ping-pong table, the queue lane, the Reading Alley) hug the wall to squeeze by.
    for (let tr = 0; tr < TRIES.length; tr += 2) for (let si = 0, side = s0; si < 2; si++, side = -side) {
      const r = TRIES[tr], f = TRIES[tr + 1];
      let m = 0, q = 0;
      for (let i = 0; i < n; i++) {
        const need = obs[i * 3 + 2] * f + side * obs[i * 3 + 1];
        if (need <= 0) continue;
        m = Math.max(m, need);
        q = Math.max(q, need / Math.max(obs[i * 3] - 0.15, 0.3));
      }
      q = Math.min(q, 2.5);
      let sx = ux + side * nx * q, sz = uz + side * nz * q;
      const L = Math.sqrt(sx * sx + sz * sz);
      sx /= L; sz /= L;
      const mm = Math.min(m, 0.35);
      if (!walkOk(a, a.pos.x + side * nx * mm, a.pos.z + side * nz * mm, r) || !walkOk(a, a.pos.x + sx * 0.35, a.pos.z + sz * 0.35, r)) continue;
      if (intoCone(a, a.pos.x + sx * 0.5, a.pos.z + sz * 0.5)) continue; // [BRN fix m3-r3] not into a hero view's frame
      a.crowdSide = side; a.crowdSideT = t + 0.6;
      out.x = sx; out.z = sz; out.k = slow * (1 - 0.15 * Math.min(q, 1)) * (tr ? 0.75 : 1);
      a.yieldT = null;
      return true;
    }
    // a seated / standing body blocks the lane (a beanbag lounger in the Pit ring): take another way round (≤ 1 / 1.5 s)
    if (!head && follow === 1 && t - (a.replanT ?? -Infinity) > 1.5 && a.slotRef && blockerAhead(a, ux, uz)
      && replanAround(a, a.slotRef, blocker)) { out.skip = true; return true; }
    // hemmed in: fall in behind a walker going our way; one coming the other way → the larger id waits (bounded)
    out.x = ux; out.z = uz; out.k = g < 1 ? 1 : Math.min(slow, follow);
    // ([BRN M3.5] a work call never yields; everyone else yields to one — §6.4.2's budget, jams by the ping-pong table)
    const urgent = a.intent?.trip === 'workCall';
    if (g === 1 && head && !urgent && a.stallStage < 2 && (head.urgent || a.id > head.id)) {
      a.yieldT ??= t;
      if (t - a.yieldT < T.crowdYieldS) out.k = 0;
    }
    return true;
  }
  /** [BRN fix m3-r3] would a side-step to (x, z) take the walker deeper into a view's soft cone (≥ 0.4 more)? */
  const intoCone = (a: Actor, x: number, z: number) => {
    const sc = director.softCost;
    return !!sc && t >= a.pushT && sc(x, z, a.level) > sc(a.pos.x, a.pos.z, a.level) + 0.4;
  };
  const OBS = 6, obs = new Float64Array(OBS * 3); // scratch: along, lat, R per body in the way
  const blocker = { x: 0, y: 0, z: 0 };
  /** The nearest settled body on the walking line within 1.2 m (into `blocker`). */
  function blockerAhead(a: Actor, ux: number, uz: number): boolean {
    let best = Infinity;
    for (let _bi = 0; _bi < a.neighbours.length; _bi++) {
      const b = a.neighbours[_bi];
      if (!b || b.moving || crowdObstacle(a, b) < 1) continue;
      const rx = b.pos.x - a.pos.x, rz = b.pos.z - a.pos.z, along = rx * ux + rz * uz;
      if (along <= 0 || along > 1.2 || Math.abs(-rx * uz + rz * ux) >= T.crowdStaticR || along >= best) continue;
      best = along; blocker.x = b.pos.x; blocker.z = b.pos.z;
    }
    return best < Infinity;
  }
  /**
   * Jam breaker: steering round people but not getting anywhere (two walkers nose to nose in a tight ring, a knot at
   * the stairs foot) for the walker's patience (0.9–1.8 s, per id so the pair never gives up together): for 1.2 s it
   * squeezes past at a brush (bodies at `crowdSqueeze` × radius, a gentle push, never stopping) instead of stalling.
   */
  function unjam(a: Actor) {
    if (a.jamT == null || (a.pos.x - a.jamX) ** 2 + (a.pos.z - a.jamZ) ** 2 > 0.3 * 0.3) { a.jamT = t; a.jamX = a.pos.x; a.jamZ = a.pos.z; return; }
    a.jamPatience ??= 0.9 + (idHash(a.id) % 7) * 0.15;
    // ([BRN M3.5] a work call squeezes past at once)
    if (t - a.jamT > (a.intent?.trip === 'workCall' ? 0.45 : a.jamPatience)) { a.ghostT = t + 1.2; a.jamT = t + 1.2; metrics.count('crowdJams'); }
  }
  /** Straight line from the walker to `q` over open floor (0.25 m samples). */
  function lineWalkable(a: Actor, q: P2): boolean {
    const L = Math.sqrt((q.x - a.pos.x) ** 2 + (q.z - a.pos.z) ** 2), n = Math.ceil(L / 0.25);
    // ([BRN fix m3-r3] a cut-through never goes deeper into a view's soft cone than its ends: eBayGlass saw a walker
    // skip a corner and cross the frame 1.8–2.4 m off)
    const sc = director.softCost, lim = sc ? Math.max(sc(a.pos.x, a.pos.z, a.level), sc(q.x, q.z, a.level)) + 1e-3 : 0;
    for (let i = 1; i <= n; i++) {
      const u = i / n, x = a.pos.x + (q.x - a.pos.x) * u, z = a.pos.z + (q.z - a.pos.z) * u;
      if (!walkOk(a, x, z) || (sc && sc(x, z, a.level) > lim)) return false;
    }
    return true;
  }
  /**
   * [BRN fix m175-r2] Soft bodies: project the walker out of any obstacle neighbour it overlaps (a static body pushes
   * it the whole way, a walker half — the other walker takes the other half on its own step), never into a wall.
   * Rate-capped so a push never pops the body sideways.
   */
  function separate(a: Actor, dt: number) {
    if (t < a.pushT) return; // [BRN fix m3-r3] pushing out of a stall (a brief overlap beats standing jammed)
    const g = t < (a.ghostT ?? 0) ? T.crowdSqueeze : 1; // squeezing through a jam: a softer, smaller body
    const cap = Math.max(0.01, (g < 1 ? 1.2 : 2.5) * dt); // m/s of push: overlaps resolve in a few frames, no pop
    for (let _bi = 0; _bi < a.neighbours.length; _bi++) {
      const b = a.neighbours[_bi];
      const f = b ? crowdObstacle(a, b) : 0;
      if (!f) continue;
      const R = (b.moving ? T.crowdPassR : T.crowdStaticR) * g * f;
      const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z, d = Math.sqrt(dx * dx + dz * dz);
      if (d >= R) continue;
      const push = Math.min(cap, (R - d) * (b.moving ? 0.5 : 1));
      const ux = d > 1e-4 ? dx / d : Math.cos(a.yaw), uz = d > 1e-4 ? dz / d : -Math.sin(a.yaw);
      const x = a.pos.x + ux * push, z = a.pos.z + uz * push;
      if (walkOk(a, x, z, 0.08)) { a.pos.x = x; a.pos.z = z; }
    }
  }
  /**
   * [BRN fix m175-r2] "Make way": someone standing at a spot (the help queue in its 1 m lane, a chill spot on a
   * walkway) leans / steps up to 0.3 m aside for a walker about to brush past, then drifts back onto the spot.
   */
  function makeWay(a: Actor, s: Slot, dt: number) {
    let tx = s.pos.x, tz = s.pos.z;
    for (let _bi = 0; _bi < a.neighbours.length; _bi++) {
      const b = a.neighbours[_bi];
      if (!b || !b.moving || b.ghost || b.riding || b.level !== a.level) continue;
      const rx = a.pos.x - b.pos.x, rz = a.pos.z - b.pos.z;
      if (rx * rx + rz * rz > 1.1 * 1.1) continue;
      const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw); // its heading
      const along = rx * fx + rz * fz, lat = -rx * fz + rz * fx; // me, in its frame (lat along its (−fz, fx))
      if (along < -0.3 || Math.abs(lat) > T.crowdPassR + 0.1) continue;
      const side = lat >= 0 ? 1 : -1, k = 0.3;
      const x = s.pos.x - fz * side * k, z = s.pos.z + fx * side * k;
      if (walkOk(a, x, z, 0.08) && !director.inView?.(x, z, a.level)) { tx = x; tz = z; } // ([BRN fix m3-r3] not into a hero frame)
      break;
    }
    const dx = tx - a.pos.x, dz = tz - a.pos.z, d = Math.sqrt(dx * dx + dz * dz);
    if (d < 1e-3) return;
    const v = Math.min(d, (tx === s.pos.x && tz === s.pos.z ? 0.6 : 1.4) * dt);
    a.pos.x += (dx / d) * v; a.pos.z += (dz / d) * v;
  }
  /** Open floor for this walker (its route's opts: the queue lane / its bay's back door count as floor). */
  const walkOk = (a: Actor, x: number, z: number, r = 0.22): boolean => clearOfPlayer(a, x, z) && (!director.walkable || director.walkable(x, z, a.level, a.walkOpts, r)
    || (onStairs(a) && director.walkable(x, z, 1 - a.level, a.walkOpts, r))); // the ramp flips level halfway up
  /** A crowd side-step never takes a walker closer to the player than `T.personalR` (the player avoidance wins). */
  const clearOfPlayer = (a: Actor, x: number, z: number) => {
    const pl = a.env.player;
    if (!pl || pl.dist > 3 || (a.env.playerLevel ?? 0) !== a.level) return true;
    const d = Math.sqrt((x - pl.pos.x) ** 2 + (z - pl.pos.z) ** 2);
    return d >= T.personalR || d >= pl.dist - 0.01; // ([BRN fix m3-r3] passMinR → personalR: fun review m3-r3 passers)
  };
  // side-step tries: [probe ring, body radius factor]: open floor, then hugging a wall, then brushing past (0.7 radius: between the two Pit-gap beanbags)
  const TRIES: readonly number[] = [0.22, 1, 0.08, 1, 0.08, 0.7];
  const onStairs = (a: Actor) => a.path[a.pathI]?.portal === 'stairs' || a.path[a.pathI - 1]?.portal === 'stairs';

  /**
   * The soft collider from the actor's side (review r3): the player's circle pushes the player out of an actor, but a
   * walker must not step into the player either. Projects the walker back out to `T.playerMinD` (never into a wall).
   */
  function keepOffPlayer(a: Actor, pp: P2) {
    const dx = a.pos.x - pp.x, dz = a.pos.z - pp.z, d = Math.sqrt(dx * dx + dz * dz);
    if (d >= T.playerMinD) return;
    const ux = d > 1e-4 ? dx / d : -Math.sin(a.yaw), uz = d > 1e-4 ? dz / d : -Math.cos(a.yaw);
    const x = pp.x + ux * T.playerMinD, z = pp.z + uz * T.playerMinD;
    if (!director.walkable || director.walkable(x, z, a.level)) { a.pos.x = x; a.pos.z = z; }
  }

  /**
   * Waiting to leave (the player stands in the way of the first leg): stay put in the current pose (a done agent keeps
   * cheering at its desk), turn (a chair swivels) toward the player and wave now and then ("after you!"); the brain's
   * player look-at does the eyes. Re-plans every 0.35 s.
   */
  function hold(a: Actor, intent: Intent, dt: number) {
    a.moving = false;
    if (a.navWait) { a.animator.setLocomotion(0); return; } // [LVL fix r1, cross-owner] a beat while the route queues
    const pl = a.env.player;
    const cur = a.settledSlot;
    if (pl) {
      const toP = Math.atan2(-(pl.pos.x - a.pos.x), -(pl.pos.z - a.pos.z));
      const sit = cur?.pose === 'sit';
      const swMax = sit ? seatTurn(cur, T.swivelMax) : 0; // [CHR cross-owner m175-r2] a sofa does not swivel (anim/seat.ts)
      a.animator.setSeat?.(sit ? cur : null);
      a.yaw = dampAngle(a.yaw, sit ? cur.yaw + clamp(wrapAngle(toP - cur.yaw), -swMax, swMax) : toP, 6, dt); // a chair swivels
    }
    a.animator.setLocomotion(0);
    if (t >= (a.holdWaveT ?? 0)) { a.holdWaveT = t + T.holdWaveS; react(a, 'wave'); }
  }

  /**
   * A seated activity on a standing spot (an overflow floor home) would sit on thin air: stand instead. `standWork`
   * is the overflow worker's laptop-in-hand loop (falls back to standIdle until CHR adds it).
   */
  function standable(s: Slot, intent: Intent): string | null {
    const id = intent.activity;
    if (s.pose === 'sit' || intent.stand || !id || !activityDef(id)?.sit) return id;
    return intent.lamp === 'work' ? 'standWork' : 'standIdle';
  }

  function setAction(a: Actor, id: string | null) {
    if (a.action === id) return;
    a.action = id;
    a.animator.setAction(id);
  }

  // ------------------------------------------------------------------------------------------ outputs
  /** Root transform from the actor's pos / yaw / lift; per-actor culling (§6.2) + a coarse distance LOD. @returns lod */
  function placeAndCull(a: Actor, cam: THREE.Camera | null | undefined): number {
    if (a.ride) a.pos.y = a.ride.y;
    else {
      // [CHR m2 r2 alloc] floorY (a cross-module call: boxed args + result) only when the actor moved / changed level
      if (a.pos.x !== a.fyX || a.pos.z !== a.fyZ || a.level !== a.fyL) { a.fyX = a.pos.x; a.fyZ = a.pos.z; a.fyL = a.level; a.fy = layout.floorY(a.pos.x, a.pos.z, a.level); }
      a.pos.y = a.fy + a.lift;
    }
    a.rig.root.position.set(a.pos.x, a.pos.y, a.pos.z);
    a.rig.root.rotation.y = a.yaw + Math.PI;
    let lod = 0;
    if (cam) {
      sphere.center.set(a.pos.x, a.pos.y + 0.45, a.pos.z);
      sphere.radius = 2.0; // + shadow reach
      const vis = sphereInFrustum(frustum, sphere); // [CHR m2 r2 alloc] = frustum.intersectsSphere without boxed dots
      const dx = cam.position.x - a.pos.x, dz = cam.position.z - a.pos.z, d = Math.sqrt(dx * dx + dz * dz);
      lod = !vis ? 3 : d < 10 ? 0 : d < 20 ? 1 : 2;
      const show = vis && a.mode !== 'wait' && !(a.inCrate && a.crateStage === 0);
      if (show !== a.visible) { a.visible = show; a.handle.setVisible(show); }
      if (lod !== a.lodSet) { a.lodSet = lod; a.handle.setLod?.(Math.min(lod, 2)); }
      // [CHR fix m15-r2, cross-owner] near-card distance caps the "hey!" noodle stretch; only re-sent on a ≥ 2 cm change
      // (the animator maps 3.5–5 m to 1..0), so a parked camera boxes no double per actor per frame
      if (!(Math.abs(d - a.viewD) < 0.02)) { a.viewD = d; a.animator.setViewDist?.(d); }
    }
    return lod;
  }

  function apply(a: Actor, intent: Intent, ctx: ActorsCtx, dt: number) {
    if (intent.face !== a.face) { a.face = intent.face; a.animator.setFace(intent.face ?? 'neutral'); }
    const gait = intent.gait ?? null;
    if (gait !== a.gait) { a.gait = gait; a.animator.setGait?.(gait); }
    const e = Math.round(intent.energy * 20) / 20;
    if (e !== a.energy) { a.energy = e; a.animator.setEnergy(e); }
    // lookAt only when the target moves ≥ 4 cm (the animator smooths; this keeps per-frame calls/allocations down).
    const L = intent.look;
    if (L) {
      if (a.lookKey === null || (L.x - a.look3.x) ** 2 + (L.y - a.look3.y) ** 2 + (L.z - a.look3.z) ** 2 > 0.0016) {
        a.look3.set(L.x, L.y, L.z);
        a.animator.lookAt(a.look3);
        a.lookKey = 1;
      }
    } else if (a.lookKey !== null) { a.animator.lookAt(null); a.lookKey = null; }
    if (intent.outline !== a.outline) { a.outline = intent.outline; a.handle.setOutline(intent.outline); }
    // [CHR M2] data-driven gear (§6.7: backpack = context, lanyard emblem = model tier, mini-Clawds = subagents,
    // struggle look); cheap per frame, the animator only reads a few fields.
    a.animator.setTraits?.(a.entity);

    // Status events held for the hysteresis (startle → chair wave in one continuous beat).
    for (let ev = a.brain.pullDueEvent?.(); ev; ev = a.brain.pullDueEvent()) runEvent(a, ev);
    // Reactions the brain decided on (transitions, waves, bumps).
    for (let r = a.brain.pullReaction(); r; r = a.brain.pullReaction()) {
      react(a, r);
      if (r === 'victory') fx.burst('confetti', burstPos(a), { count: 40 });
      // A status change the server sent no event for still gets the neighbours' attention.
      const soc = REACTION_SOCIAL[r];
      if (soc) broadcast(a, soc);
    }

    const lod = placeAndCull(a, ctx.camera); // [CHR m2 r2 alloc, cross-owner BRN] split out (inlining budget)
    a.animator.update(dt, lod);

    // fx (idempotent; objects are reused by the brain until their content changes).
    const ent = a.entity;
    fx.ring(a.id, intent.ring);
    if (a.plateSrc !== ent) { // [BRN fix r3] no per-frame key string: compare fields only when the entity object changes
      a.plateSrc = ent;
      const tab = ent.tab?.label ?? '', ci = ent.workspace?.colorIndex ?? 0, p = a.plate;
      if (!p || p.name !== ent.name || p.tab !== tab || p.colorIndex !== ci) a.plate = { name: ent.name, tab, colorIndex: ci };
    }
    fx.plate(a.id, a.plate);
    fx.glyph(a.id, intent.glyph);
    fx.bubble(a.id, intent.bubble);
    fx.dust(a.id, intent.dust);
    // [RND fix r1] the home desk's monitor shows this actor's state (code / saver / red / prompt; render/deskScreens.ts)
    setDeskScreen(director.slotFor(a.id)?.anchor, screenModeFor(ent, intent.lamp), a.id, a.brain.state.seated); // [RND M3.5, cross-owner] owner id + seated → live monitor atlas (render/monitorAtlas.ts)
    if (fx.placard) {
      const home = director.slotFor(a.id);
      if (intent.placard !== a.placardSpec || home?.anchor !== a.placardAnchor) {
        a.placardSpec = intent.placard;
        a.placardAnchor = home?.anchor ?? null;
        fx.placard(a.id, intent.placard && home ? { ...intent.placard, deskAnchor: home.anchor ?? home.id } : null);
      }
    }
  }

  // ------------------------------------------------------------------------------------------ API
  /** [BRN fix m175-r2] `__hq.metrics().crowd`: walker ↔ body distances since the last metrics reset (clips = < 0.3 m) */
  let crowd: Crowd = { samples: 0, minD: Infinity, minPair: '', clips: 0 };
  function crowdSample() {
    crowd.samples++;
    for (let _ai = 0; _ai < list.length; _ai++) {
      const a = list[_ai];
      if (!a.moving || a.ride || a.mode !== 'live') continue;
      for (let _bi = 0; _bi < a.neighbours.length; _bi++) {
        const b = a.neighbours[_bi];
        if (!b || b.level !== a.level || b.riding || b.ghost || Math.abs(b.pos.y - a.pos.y) > 0.6) continue;
        const d = Math.sqrt((a.pos.x - b.pos.x) ** 2 + (a.pos.z - b.pos.z) ** 2);
        if (d < 0.3) crowd.clips++;
        if (d < crowd.minD) { crowd.minD = d; crowd.minPair = `${a.id}/${b.id} @${a.pos.x.toFixed(1)},${a.pos.z.toFixed(1)} L${a.level}`; }
      }
    }
  }
  const list: Actor[] = [];
  /** [CHR m2 r2 alloc] per-frame snapshot of the actor Map (update's walk) */
  const all: Actor[] = [];
  let allN = 0;
  const pushAll = (a: Actor) => { all[allN++] = a; };
  const expireArrived = (at: number, id: string) => { if (t - at > 10) arrivedAt.delete(id); };
  const api: Actors = {
    /** [AUD M3, cross-owner] observe every reaction as it starts (one listener). */
    tapReactions(fn) { reactTap = fn; },
    /** [BRN fix m2-fix1] set the aimed agent directly (tests, the headless sim; the app uses bus 'aim') */
    setAim(id) { aimId = id ?? null; },
    update(ctx) {
      const dt = ctx.dt;
      t = ctx.time;
      if (!busBound && ctx.bus) bindBus(ctx.bus); // [BRN M3.5] verbs / answered / prompt.sent (§6.9, §6.8.1, §6.4.2)
      const now = ctx.now;
      const ents = store.entities;
      syncEntities(ents);
      { // [BRN fix m3-r2] the player's personal space for seat / spot picks (director) and the night hearth (social)
        const p0 = ctx.player?.pos;
        lastPlayer = p0 ?? null;
        director.setPlayer?.(p0 ? { x: p0.x, z: p0.z, level: ctx.player?.level ?? (p0.y > 1.5 ? 1 : 0) } : null);
        social.setHour?.(ctx.hour ?? null);
      }
      director.update(ents, now);
      // [BRN fix m2-fix1] cold start: idle agents of unknown age begin as showcase regulars (placed there, not at desks)
      if (coldQ.length) { social.bootCast(coldQ, t, now); coldQ.length = 0; }
      // [BRN fix m2-fix1] cameos: the zone the player's camera is in gets a visitor (brain/social.ts)
      const pp = ctx.player?.pos;
      social.setView(pp ? ((ctx.player?.level ?? 0) === 1 ? 'MEZ' : layout.zoneAt?.(pp.x, pp.z, 0) ?? null) : null, pp ?? null);
      catNow = ctx.ambient?.catPos?.() ?? null; // (one small object per frame, read by every brain's env)
      metrics.frame(++frameNo, dt);
      handleEvents();

      if (ctx.camera) {
        ctx.camera.updateMatrixWorld();
        projView.multiplyMatrices(ctx.camera.projectionMatrix, ctx.camera.matrixWorldInverse);
        frustum.setFromProjectionMatrix(projView);
      }
      // [CHR m2 r2 alloc, cross-owner BRN] per-frame arrays are rewritten by index (length set once; `length = 0` +
      // push re-grew them every frame) and the actor Map is walked once into a snapshot (no iterator results)
      allN = 0; actors.forEach(pushAll); if (all.length > allN) all.length = allN;
      let ln = 0;
      for (let i = 0; i < allN; i++) if (all[i].mode !== 'leave') list[ln++] = all[i];
      if (list.length !== ln) list.length = ln;
      computeNeighbours(list);

      for (let ai = 0; ai < allN; ai++) {
        const a = all[ai];
        if (actors.get(a.id) !== a) continue; // removed earlier this frame
        if (a.mode === 'wait') {
          if (arrivedAt.has(a.id)) {
            a.mode = 'arrive';
            beginCrate(a);
          } else if (t - a.bornT >= SPAWN_WAIT_S) { a.mode = 'cold'; a.handle.setVisible(true); a.visible = true; }
          else continue;
        }
        if (a.mode === 'leave') { leaveStep(a, ctx, dt); continue; }
        fillEnv(a, ctx);
        const intent = (a.intent = a.brain.update(a.entity, now, a.env));
        if (a.inCrate) crateStep(a);
        else motor(a, intent, dt);
        a.lite.yaw = a.yaw;
        a.lite.status = a.entity.status;
        a.lite.seated = a.brain.state.seated;
        a.lite.chattingWith = a.brain.state.chattingWith;
        a.lite.social = !!a.brain.state.social;
        a.lite.pocket = !!a.brain.state.pocket;
        const L = a.lite, bs = a.brain.state;
        // [BRN fix m2-r2] these were all on one line behind the `riding` comment, so settledAt / bstatus / phase were
        // never set: every social scene (rallies, huddles, coffee invites, the Pit wave) silently never fired
        L.level = a.level; L.moving = a.moving;
        L.riding = !!a.ride && a.ride.t < a.ride.dur * 0.8; // (landing: an obstacle for walkers by the exit)
        if (intent.phase === 'summoned' && L.phase !== 'summoned') verbs.came++; // [BRN M3.5] (before L.phase moves on)
        L.urgent = intent.trip === 'workCall'; // [BRN M3.5] (crowd yield priority)
        L.ghost = false; L.settledAt = a.settledAt; L.bstatus = bs.status; L.phase = intent.phase;
        L.free = !!bs.free; L.idleMs = bs.idleMs ?? 0; L.declined = bs.declined ?? 0; L.castable = !!bs.castable;
        if (bs.verbCancels !== a.vc) { verbs.cancelled += bs.verbCancels - a.vc; a.vc = bs.verbCancels; } // [BRN M3.5]
        if (bs.attends !== a.att) { verbs.attends += bs.attends - a.att; a.att = bs.attends; } // [BRN fix m2-fix1]
        apply(a, intent, ctx, dt);
        metrics.sample(a, intent, dt);
      }
      // the office's social scenes: cast free idle agents, run the ping-pong rally clock, play the queued reactions
      let lc = 0;
      for (let i = 0; i < list.length; i++) if (list[i].mode === 'live') lites[lc++] = list[i].lite;
      if (lites.length !== lc) lites.length = lc;
      social.update(t, lites);
      social.pullPokes(t, pokeActor);
      for (let _ai = 0; _ai < list.length; _ai++) {
        const a = list[_ai];
        const u = social.syncFor(a.id);
        if (u !== null || a.syncU != null) { a.syncU = u; a.animator.setSync?.(u); } // [CHR cross-owner] shared swing clock
      }
      updateBall(ctx);
      crates.update(t, ctx.scene);
      crowdSample();
      if (arrivedAt.size) arrivedAt.forEach(expireArrived);
    },
    /**
     * The live actors (not leaving): a READ-ONLY view reused every frame (no allocation; PLY's soft colliders and the
     * aim query call it per frame). Rebuilt at the top of each update; copy it (`slice()`) before sorting / keeping.
     */
    list: () => list,
    /** §9.1 metrics (the same object `__hq.metrics()` reads); `reset` = true zeroes it */
    metrics: readMetrics,
    /** [BRN M3.5] a §6.9 player verb on actor `id` (what the bus 'verb' does; tests / debug) Returns the outcome. */
    verb: (kind, id) => doVerb(kind, id),
    /** [BRN M3.5] bus 'answered' / 'prompt.sent' (tests / debug) */
    answered: (id) => onAnswered(id),
    prompted: (id) => onPrompt(id),
    /** [BRN fix m3-r3] bus 'talk.open' / 'talk.close' and 'inbox.zero' (tests / debug) */
    talk: (id, open, sent) => onTalk(id, open, sent),
    inboxZero: () => onInboxZero(),
    /** debug / tests: the hiring crates in flight (id, age s) */
    crates: () => crates.list(t),
    get: (id) => actors.get(id) ?? null,
    /** debug / tests: per-actor bookkeeping sizes (churn soak: they track the live count, never the history) */
    sizes: () => ({ actors: actors.size, arrivedAt: arrivedAt.size, rekeys: rekeys.size, events: events.length, ...metrics.sizes() }),
    count: () => list.length,
    /** debug / tests: the social stage manager (brain/social.ts) */
    social,
  };

  function readMetrics(reset: true): true;
  function readMetrics(reset?: false): ActorMetrics;
  function readMetrics(reset?: boolean): true | ActorMetrics;
  function readMetrics(reset?: boolean): true | ActorMetrics {
    if (!reset) return { ...metrics.read(), social: social.counts(), crowd: { ...crowd }, verbs: { ...verbs }, stalls: { ...stallStats } };
    crowd = { samples: 0, minD: Infinity, minPair: '', clips: 0 };
    resetVerbs(); resetStalls();
    return metrics.reset();
  }
  function resetVerbs() { for (const k of Object.keys(verbs)) verbs[k] = 0; }
  function resetStalls() { stallStats.repaths = stallStats.breaks = stallStats.cleared = stallStats.softReplans = stallStats.maxS = stallStats.politeS = 0; stallStats.maxWho = ''; }
  hqRegister('metrics', (reset) => api.metrics(reset));
  // debug / review: stage a social scene (`__hqSocial.stage('rally'|'huddle'|'watch')`); proposed as __hq.social (LEAD)
  if (typeof window !== 'undefined') window.__hqSocial = social;
  // [BRN M3.5] debug / review: crates in flight, a verb on an actor (`__hqActors.verb('summon', id)`), the verb metrics
  if (typeof window !== 'undefined') window.__hqActors = { crates: () => api.crates(), verb: api.verb, answered: api.answered, prompted: api.prompted, get: api.get, list: api.list, talk: api.talk, inboxZero: api.inboxZero };
  hqStatSection('brain', () => {
    const phases: Record<string, number> = {};
    for (const a of actors.values()) { const p = a.intent?.phase ?? a.mode; phases[p] = (phases[p] ?? 0) + 1; }
    return { actors: actors.size, phases, sizes: api.sizes(), director: director.debug?.(), social: social.counts(), nav: director.navStats?.() ?? null };
  });
  return api;
}

/** Entry point for walk-ins: a door opening if the layout has one, else a point just inside the player spawn. */
/**
 * [CHR m2 r2 alloc, cross-owner BRN] = frustum.intersectsSphere(s), spelled out (Plane.distanceToPoint → Vector3.dot
 * returned a boxed double per plane per actor when not inlined).
 */
function sphereInFrustum(f: THREE.Frustum, sp: THREE.Sphere): boolean {
  const c = sp.center, r = sp.radius, pl = f.planes;
  for (let i = 0; i < 6; i++) { const n = pl[i].normal; if (n.x * c.x + n.y * c.y + n.z * c.z + pl[i].constant < -r) return false; }
  return true;
}

function doorPoint(layout: Pick<Layout, 'bounds' | 'walls' | 'spawn'> & EntryLayout): { x: number; z: number; yaw: number } {
  const b = layout.bounds;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const pts: EntryPoints = layout.points ?? {};
  const p = pts.entrance ?? pts.door ?? null;
  if (p) return { x: p.x, z: p.z, yaw: Math.atan2(-(cx - p.x), -(cz - p.z)) };
  for (const w of layout.walls ?? []) {
    for (const o of w.openings ?? []) {
      if (o.kind !== 'door') continue;
      const dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1];
      const L = Math.sqrt(dx * dx + dz * dz) || 1;
      let x = w.a[0] + (dx / L) * (o.at + o.w / 2), z = w.a[1] + (dz / L) * (o.at + o.w / 2);
      x += Math.sign(cx - x) * 0.6 * Math.abs(dz / L); z += Math.sign(cz - z) * 0.6 * Math.abs(dx / L);
      return { x, z, yaw: Math.atan2(-(cx - x), -(cz - z)) };
    }
  }
  const s = layout.spawn ?? [cx, 0, b.maxZ - 0.6];
  const x = clamp(s[0], b.minX + 0.6, b.maxX - 0.6), z = clamp(s[2], b.minZ + 0.6, b.maxZ - 0.6);
  return { x, z, yaw: Math.atan2(-(cx - x), -(cz - z)) };
}

// ------------------------------------------------------------------------------------------------ hiring crates
/**
 * [BRN M3.5] The lobby hiring crate (§6.4.3 spectacular arrivals, post-boot only): ENV's hiring anchor
 * (`HIRE_CRATE`, world/build/zones/lobby.ts: the ARRIVALS pad; `layout.points.hiring` overrides; other layouts: a spot
 * ahead-left of the spawn). One small
 * clay crate per arrival — an oak base, four strapped oak sides hinged at the floor, a kraft lid with a butter ribbon —
 * built lazily (the first arrival) and pooled; ~12 draw calls only while one is on stage (≈ 5 s). It drops in and
 * squashes, rattles, pops its lid (which flips off and lands beside it) as the sides fall open around the newcomer
 * (actors.ts crateStep plays CHR `unwrap` then), lies open while it waves and walks off, then shrinks away.
 * Renderer only; timings in TUNING (crate*).
 */
const CRATE_W = 0.92, CRATE_H = 0.8, CRATE_D = 0.84, SIDE_T = 0.045;
export function hiringAnchor(layout: EntryLayout | null | undefined): { x: number; z: number; yaw: number } {
  const p = layout?.points?.hiring ?? (layout?.zones?.some?.((z) => z.id === 'LOB') ? HIRE_CRATE : null);
  if (p) return { x: p.x, z: p.z, yaw: p.yaw ?? 0 };
  const s = layout?.points?.spawn;
  // (fallback: 3.2 m ahead-left of the spawn, on the lobby floor, facing the spawn view)
  if (s) return { x: s.x - 2.4, z: s.z - 3.0, yaw: Math.atan2(-2.4, -3.0) }; // (a yaw faces (−sin, −cos): toward the spawn)
  return { x: 0, z: 0, yaw: 0 };
}
/** the optional named points doorPoint / hiringAnchor read beyond `LayoutPoints` (only the office authors `door` / `hiring`) */
interface EntryPoints { entrance?: P2; door?: P2; hiring?: P2 & { yaw?: number }; spawn?: P2 }
interface EntryLayout { points?: EntryPoints; zones?: readonly { id: string }[] }
interface CrateParts { g: THREE.Group; sides: THREE.Group[]; lid: THREE.Group }
interface LiveCrate { id: string; t0: number; parts: CrateParts | null }
function createCrates(layout: Layout) {
  const anchor = hiringAnchor(layout);
  const live: LiveCrate[] = [];
  /** pooled crate groups */
  const pool: CrateParts[] = [];
  let assets: { geo: Record<'base' | 'fb' | 'lr' | 'strapFB' | 'strapLR' | 'lid' | 'ribX' | 'ribZ' | 'bow', THREE.BoxGeometry>; mats: Record<'oak' | 'ink' | 'kraft' | 'ribbon', THREE.Material> } | null = null;
  function build(): CrateParts {
    if (!assets) {
      const geo = {
        base: new THREE.BoxGeometry(CRATE_W, 0.06, CRATE_D),
        fb: new THREE.BoxGeometry(CRATE_W, CRATE_H, SIDE_T), lr: new THREE.BoxGeometry(SIDE_T, CRATE_H, CRATE_D - 2 * SIDE_T),
        strapFB: new THREE.BoxGeometry(CRATE_W + 0.01, 0.07, SIDE_T + 0.012), strapLR: new THREE.BoxGeometry(SIDE_T + 0.012, 0.07, CRATE_D - 2 * SIDE_T + 0.01),
        lid: new THREE.BoxGeometry(CRATE_W + 0.05, 0.06, CRATE_D + 0.05),
        ribX: new THREE.BoxGeometry(CRATE_W + 0.06, 0.07, 0.09), ribZ: new THREE.BoxGeometry(0.09, 0.07, CRATE_D + 0.06),
        bow: new THREE.BoxGeometry(0.22, 0.1, 0.12),
      };
      const mats = {
        oak: getMaterial('toonProp', { color: '#B7834F', pattern: 'wood', instanced: true }),
        ink: getMaterial('toonProp', { color: '#3A3733', instanced: true }),
        kraft: getMaterial('toonProp', { color: '#C9A67C', instanced: true }),
        ribbon: getMaterial('toonProp', { color: '#F1C66E', instanced: true }),
      };
      assets = { geo, mats };
    }
    const { geo, mats } = assets;
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
      const o = new THREE.InstancedMesh(g, m, 1); // [RND fix r1, cross-owner BRN] on the §5.4 matrix (see updateBall)
      o.position.set(x, y, z);
      o.layers.set(LAYERS.PROPS);
      o.castShadow = true; o.receiveShadow = true;
      parent.add(o);
      return o;
    };
    const g = new THREE.Group();
    g.name = 'hq:hiringCrate';
    mesh(geo.base, mats.oak, g, 0, 0.03, 0);
    const sides: THREE.Group[] = [];
    // hinges at the floor edge: front (+z), back (−z), left (−x), right (+x); each panel stands up from its hinge
    for (const [hx, hz, fb] of [[0, CRATE_D / 2 - SIDE_T / 2, 1], [0, -(CRATE_D / 2 - SIDE_T / 2), 1], [-(CRATE_W / 2 - SIDE_T / 2), 0, 0], [CRATE_W / 2 - SIDE_T / 2, 0, 0]]) {
      const hinge = new THREE.Group();
      hinge.position.set(hx, 0.02, hz);
      g.add(hinge);
      mesh(fb ? geo.fb : geo.lr, mats.oak, hinge, 0, CRATE_H / 2, 0);
      for (const y of [0.16, CRATE_H - 0.14]) mesh(fb ? geo.strapFB : geo.strapLR, mats.ink, hinge, 0, y, 0);
      sides.push(hinge);
    }
    const lid = new THREE.Group();
    g.add(lid);
    mesh(geo.lid, mats.kraft, lid, 0, 0.03, 0);
    mesh(geo.ribX, mats.ribbon, lid, 0, 0.035, 0);
    mesh(geo.ribZ, mats.ribbon, lid, 0, 0.035, 0);
    mesh(geo.bow, mats.ribbon, lid, 0, 0.1, 0).rotation.y = 0.5;
    return { g, sides, lid };
  }
  const bounceOut = (x: number) => { // ease-out with one small bounce: the side slaps the floor
    if (x >= 1) return 1;
    if (x < 0.72) { const u = x / 0.72; return u * u; }
    const u = (x - 0.86) / 0.14;
    return 1 - 0.08 * (1 - u * u);
  };
  function pose(parts: CrateParts, u: number) {
    const { g, sides, lid } = parts;
    const drop = T.crateDropS, un = T.crateUnwrapS, [f0, f1] = T.crateFadeS;
    // drop in from 1.6 m, a squash on landing, then a rattle that builds until the unwrap
    let y = 0, sy = 1, sxz = 1, rz = 0, rx = 0;
    if (u < drop) { const k = u / drop; y = 1.6 * (1 - k * k); sy = 1.06; sxz = 0.96; }
    else if (u < drop + 0.22) { const k = Math.sin(Math.PI * (u - drop) / 0.22); sy = 1 - 0.16 * k; sxz = 1 + 0.08 * k; }
    else if (u < un) {
      const ramp = (u - drop - 0.22) / Math.max(0.05, un - drop - 0.22);
      rz = 0.07 * ramp * Math.sin(u * 38); rx = 0.04 * ramp * Math.sin(u * 29 + 1);
      y = Math.max(0, Math.sin(u * 19)) * 0.05 * ramp;
    }
    const fade = u < f0 ? 1 : Math.max(0, 1 - (u - f0) / (f1 - f0));
    g.position.set(anchor.x, (layout.floorY?.(anchor.x, anchor.z, 0) ?? 0) + y, anchor.z);
    g.rotation.set(rx, anchor.yaw, rz);
    g.scale.set(sxz * fade, sy * fade, sxz * fade);
    const v = u - un;
    // the sides fall open (hinged at the floor), staggered a little: front first (toward the view)
    for (let i = 0; i < 4; i++) {
      const k = v <= 0 ? 0 : bounceOut(Math.min(1, (v - i * 0.05) / 0.38)) * (Math.PI / 2 - 0.04);
      const h = sides[i];
      h.rotation.set(i === 0 ? k : i === 1 ? -k : 0, 0, i === 2 ? k : i === 3 ? -k : 0);
    }
    // the lid: on top, then pops up, flips over and lands flat beside the crate
    if (v <= 0) { lid.position.set(0, CRATE_H + 0.02, 0); lid.rotation.set(0, 0, 0); }
    else {
      const k = Math.min(1, v / 0.62);
      const top = CRATE_H + 0.02 + 1.9 * v - 5.6 * v * v;
      lid.position.set(-0.95 * k, Math.max(0.04, top), 0.25 * k);
      lid.rotation.set(0.3 * k, 0.4 * k, Math.PI * k);
    }
  }
  return {
    anchor,
    /** @returns when its crate drops in (null = the queue is too long: no crate) */
    spawn(id: string, t: number): number | null {
      let t0 = t;
      for (const c of live) t0 = Math.max(t0, c.t0 + T.crateNextS);
      if (t0 - t > T.crateQueueMaxS) return null;
      live.push({ id, t0, parts: null });
      return t0;
    },
    /** per frame: pose every crate on stage; lazily build / return meshes (no scene: timeline only, headless) */
    update(t: number, scene?: THREE.Object3D | null) {
      for (let i = live.length - 1; i >= 0; i--) {
        const c = live[i], u = t - c.t0;
        if (u < 0) continue; // queued behind the crate on the pad
        if (u > T.crateFadeS[1]) {
          if (c.parts) { c.parts.g.visible = false; pool.push(c.parts); }
          live.splice(i, 1);
          continue;
        }
        if (!c.parts && scene) { c.parts = pool.pop() ?? build(); if (!c.parts.g.parent) scene.add(c.parts.g); c.parts.g.visible = true; }
        if (c.parts) pose(c.parts, u);
      }
    },
    list: (t: number): CrateInfo[] => live.map((c) => ({ id: c.id, age: +(t - c.t0).toFixed(2), shown: !!c.parts })),
  };
}
