/**
 * The farmers system: agents as voxel mascots who live in the valley (Clawd for Claude agents, the Codex cloud for
 * Codex). Each farmer plans where to be from its visible job (brain.ts), walks there along the roads (roads.ts,
 * motion.ts) with its own gait (a four-legged scuttle or a hop-waddle, pose.ts), turns to face its work, plays the
 * job's loop with a prop in its nub, reacts to valley events, greets the player, and drags a line of ducklings.
 *
 * Every pose runs through per-channel springs (overshoot, no pops), and secondary motion rides on top: the hat and
 * the held prop lag behind the body, the body top shears on starts and stops, Codex's lobes wobble on landings.
 *
 * Draw calls: the whole crowd is 8 instanced meshes (+ shadow pass), ducklings 5, emotes 1, particles 1, beacons 1,
 * and a few pooled label sprites — independent of the number of farmers.
 */
import * as THREE from 'three';
import type { AudioService, FarmerLocator, FrameInfo, SceneCtx, SystemFactory } from '../context.ts';
import type { FarmerView, Job, Mood, PlotKind, ValleyEvent } from '../../model/types.ts';
import { HANGOUTS, PATHS, POND, SITES, WORLD, heightAt, structure } from '../../world/map.ts';
import type { XZ } from '../../world/map.ts';
import { PAL, WORKSPACE_COLORS } from '../toon.ts';
import { hash32 } from '../../../../../shared/identity.ts';
import { seeded } from '../../../core/rng.ts';
import { Crowd } from './rig.ts';
import type { DrawIn, DrawOut } from './rig.ts';
import { lookFor } from './look.ts';
import type { Look } from './look.ts';
import { ACT_INFO, CH, SEAT_H, actPose, cycleLength, faceGlyphs, gait, holdOf, newGlyphs, newPose, newSprings, springSnap, springStep } from './pose.ts';
import type { Act, Face, GaitState, GlyphState, Pose, Prop, Springs } from './pose.ts';
import { buildSeats, newMind, pickSeat, plan, propOf } from './brain.ts';
import type { BuiltSpot, Intent, Mind, Seat, World } from './brain.ts';
import { moveStep, newMover, place, separate } from './motion.ts';
import type { Mover } from './motion.ts';
import { buildRoads, route } from './roads.ts';
import { newTrail, trailPush } from './trail.ts';
import type { Trail } from './trail.ts';
import { Ducks, easeOutBack } from './ducks.ts';
import type { Duck } from './ducks.ts';
import { Beacons, Billboards, Particles } from './fx.ts';
import { EMOTE } from './atlas.ts';
import type { EmoteName } from './atlas.ts';
import { Labels } from './labels.ts';

export const PRODUCE: Readonly<Record<PlotKind, number>> = {
  wheat: PAL.wheat, pumpkins: PAL.pumpkin, cabbages: PAL.cabbage, sunflowers: PAL.sunflower, orchard: PAL.apple, vineyard: PAL.grape,
  berries: PAL.strawberry, chickens: 0xf6ecd8, cows: 0xf4f6fa, sheep: 0xf6f1e6, pigs: 0x8a5a3a, bees: 0xf2b33a,
};

export const JOB_VERB: Readonly<Record<Job, string>> = {
  plant: 'planting', inspect: 'inspecting', water: 'watering', build: 'building', haul: 'hauling', fetch: 'fetching', plan: 'planning',
  talk: 'chatting', delegate: 'directing ducklings', rest: 'tidying up', ask: 'needs you', done: 'all done', idle: 'taking a break', away: 'napping',
};

const MOOD_FACE: Readonly<Record<Mood, Face>> = { happy: 'happy', focused: 'focused', stuck: 'stuck', sleepy: 'sleepy', proud: 'proud', worried: 'worried' };

/** Height above the body top that clears any hat (labels, emotes, the "!" beacon). */
export const HAT_CLEAR = 0.3;

interface React { act: Act | null; face: Face | null; until: number; emote: EmoteName | null; emoteUntil: number }
/** a 2-D damped spring (secondary motion) */
interface Spring2 { x: number; z: number; y: number; vx: number; vz: number; vy: number }
const spring2 = (): Spring2 => ({ x: 0, z: 0, y: 0, vx: 0, vz: 0, vy: 0 });

interface Actor {
  id: string;
  view: FarmerView;
  look: Look;
  lookKey: string;
  produce: number;
  mind: Mind;
  mv: Mover;
  intent: Intent;
  nextPlan: number;
  act: Act;
  actSince: number;
  tgt: Pose;
  out: Pose;
  spr: Springs;
  gait: GaitState;
  lastYaw: number;
  glyphs: [GlyphState, GlyphState];
  prop: Prop | null;
  propS: number;
  y: number;
  yGround: number;
  hx: number; hz: number;
  react: React | null;
  blinkAt: number; blinkT: number; blinkAgain: boolean;
  waveW: number;
  lookX: number; lookY: number; lookTw: number;
  greeted: boolean; greetUntil: number; greetCool: number; glanced: boolean; glanceUntil: number; callAt: number;
  nameA: number; bubbleA: number;
  vanish: number;
  trail: Trail;
  ducks: Duck[];
  quackAt: number;
  pos: THREE.Vector3;
  head: THREE.Vector3;
  hand: THREE.Vector3;
  eyes: THREE.Vector3;
  /** secondary motion: last top position / velocity, hat, body shear, prop lag, lobe wobble */
  top0: THREE.Vector3; vel0: THREE.Vector3; hat: Spring2; shear: Spring2; plag: Spring2; wob: number; wobPh: number;
  unreg: () => void;
  lastPropK: number;
  k: number;
  born: number;
}

const tmpV = new THREE.Vector3(), tmpA = new THREE.Vector3();
const duckSpot = { x: 0, z: 0 };
const fwd = new THREE.Vector3();
const frac = (x: number) => x - Math.floor(x);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const damp = (c: number, t: number, r: number, dt: number) => c + (t - c) * (1 - Math.exp(-r * dt));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** step a damped spring toward 0 with forcing (f*) — follow-through driven by acceleration */
function spr(s: Spring2, fx: number, fz: number, fy: number, freq: number, zeta: number, dt: number) {
  const w = Math.PI * 2 * freq;
  const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
  for (let i = 0; i < n; i++) {
    s.vx += (-w * w * s.x - 2 * zeta * w * s.vx + fx) * h; s.x += s.vx * h;
    s.vz += (-w * w * s.z - 2 * zeta * w * s.vz + fz) * h; s.z += s.vz * h;
    s.vy += (-w * w * s.y - 2 * zeta * w * s.vy + fy) * h; s.y += s.vy * h;
  }
}

function excerpt(s: string | null, max = 70): string {
  if (!s) return '';
  let t = s.replace(/[`*_#>]/g, '').replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.{12,}?[.!?])(\s|$)/);
  if (m && m[1].length <= max) t = m[1];
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export const farmersSystem: SystemFactory = (ctx: SceneCtx) => {
  const crowd = new Crowd(48, true);
  const bills = new Billboards(320);
  const parts = new Particles(900);
  const beacons = new Beacons(32);
  const labels = new Labels(10);
  const ducks = new Ducks(200);
  const root = new THREE.Group();
  root.name = 'farmers-root';
  root.add(crowd.group, ducks.group, bills.mesh, parts.points, beacons.mesh, labels.group);
  ctx.scene.add(root);

  const roads = buildRoads(PATHS, { x: 0, z: -1, hw: 12, hd: 10 });
  type Spots = { get(name: string): BuiltSpot | null; seats(): readonly BuiltSpot[] };
  const spotsSvc = () => ctx.services.get('structureSpots') as Spots | undefined;
  const seatSrc = { hangouts: HANGOUTS, campfire: structure('campfire'), well: structure('well'), board: structure('noticeboard'), pond: POND };
  /** hangout seats that landed inside a structure / prop are switched off (built seats are trusted) */
  const vet = (list: Seat[]): Seat[] => {
    list.forEach((st) => {
      if (st.y !== undefined) return;
      if (ctx.colliders.blocked(st.x, st.z, 0.3)) { st.kind = 'off'; if (st.pair !== undefined) list[st.pair].kind = 'off'; }
    });
    return list;
  };
  let seats: Seat[] = buildSeats(seatSrc);
  let vetted = false;
  let builtSeats = false;
  /** once the structures publish their real benches / hammock / dock, re-seat everyone on them */
  const refreshSeats = () => {
    if (!vetted && time > 1) { vetted = true; if (!builtSeats) vet(seats); }
    if (builtSeats) return;
    const sp = spotsSvc();
    if (!sp || !sp.seats().length) return;
    builtSeats = true;
    seats = vet(buildSeats({ ...seatSrc, built: { seats: sp.seats(), get: (n) => sp.get(n) } }));
    occ.clear();
    for (const a of actors.values()) { a.mind.seat = -1; a.nextPlan = 0; }
  };
  const occ = new Map<number, string>();
  const actors = new Map<string, Actor>();
  const leftovers: Duck[] = [];
  const events: ValleyEvent[] = [];
  const arrivals = new Set<string>();
  const offValley = ctx.onValley((e) => events.push(e));
  let firstSeen = -1;
  let time = 0;
  const cues: string[] = [];
  const audio = () => ctx.services.get('audio') as AudioService | undefined;
  const surface = () => ctx.services.get('walkSurface') as ((x: number, z: number) => number | null) | undefined;
  const ground = (x: number, z: number): number => {
    const s = surface()?.(x, z);
    if (typeof s === 'number') return s;
    const h = heightAt(x, z);
    return h < WORLD.water + 0.1 ? WORLD.water + 0.12 : h;
  };

  // south road: newcomers walk in from here, leavers walk off here
  let south: XZ = { x: 0, z: 60 };
  for (const p of PATHS) for (const q of p.points) if (q.x > -50 && q.z > south.z) south = q;
  const exit: XZ = { x: south.x - 4, z: Math.min(WORLD.rim - 6, south.z + 18) };
  const bin = structure('shippingBin'), mailbox = structure('mailbox'), well = structure('well');
  const hub: XZ = { x: 0, z: -1 };

  const routeFn = (from: XZ, to: XZ) => route(roads, SITES, from, to);
  const worldFor = (a: Actor): World => {
    const plot = ctx.valley.plots.get(a.view.plotId);
    return {
      site: plot ? SITES[plot.site] ?? null : null, plotKind: plot?.kind ?? null,
      bin, mailbox: { x: mailbox.x, z: mailbox.z, yaw: mailbox.yaw }, well: { x: well.x, z: well.z, yaw: well.yaw }, exit, hub, seats,
      stands: stands(),
      claim: (id, kind, t) => {
        const prev = a.mind.seat;
        if (prev >= 0 && occ.get(prev) === id) occ.delete(prev);
        const i = pickSeat(seats, occ, id, kind, a.look.likes, a.look.chatty, seeded(`${id}:${a.mind.n}:${Math.floor(t)}`), prev);
        occ.set(i, id);
        return i;
      },
    };
  };

  const stands = (): World['stands'] => {
    const sp = spotsSvc();
    if (!sp) return undefined;
    const o: NonNullable<World['stands']> = {};
    const bd = sp.get('binDrop'), mb = sp.get('mailbox'), wl = sp.get('well');
    if (bd) o.bin = { x: bd.x, z: bd.z, yaw: bd.yaw };
    if (mb) o.mailbox = { x: mb.x, z: mb.z, yaw: mb.yaw };
    if (wl) o.well = { x: wl.x, z: wl.z, yaw: wl.yaw };
    return o;
  };

  const lookOf = (f: FarmerView): { look: Look; key: string; produce: number } => {
    const plot = ctx.valley.plots.get(f.plotId);
    const ci = plot?.colorIndex ?? hash32(f.plotId) % WORKSPACE_COLORS.length;
    return { look: lookFor(f, WORKSPACE_COLORS[ci % WORKSPACE_COLORS.length]), key: `${ci}|${f.tier}|${f.kind}|${plot?.kind}`, produce: PRODUCE[plot?.kind ?? 'wheat'] };
  };

  function create(f: FarmerView, walkIn: boolean): Actor {
    const { look, key, produce } = lookOf(f);
    const k = frac(hash32(f.seed) / 4294967296 * 7.31);
    const mind = newMind(f.job, time, k);
    mind.arriving = walkIn;
    const a: Actor = {
      id: f.id, view: f, look, lookKey: key, produce, mind, mv: newMover(0, 0, 0), intent: null as unknown as Intent, nextPlan: 0,
      act: 'stand', actSince: time, tgt: newPose(), out: newPose(), spr: newSprings(),
      gait: { cyc: k * 3, w: 0, jog: 0, turn: 0, speed: 0, heavy: false, bounce: look.bounce }, lastYaw: 0, glyphs: newGlyphs(),
      prop: null, propS: 0, y: 0, yGround: 0, hx: 1e9, hz: 0, react: null,
      blinkAt: time + 1 + k * 3, blinkT: 99, blinkAgain: false, waveW: 0, lookX: 0, lookY: 0, lookTw: 0, greeted: false, greetUntil: 0, greetCool: 0, glanced: false,
      glanceUntil: 0, callAt: 0, nameA: 0, bubbleA: 0, vanish: 0, trail: newTrail(0, 0), ducks: [], quackAt: time + 5 + k * 10,
      pos: new THREE.Vector3(), head: new THREE.Vector3(), hand: new THREE.Vector3(), eyes: new THREE.Vector3(),
      top0: new THREE.Vector3(1e9, 0, 0), vel0: new THREE.Vector3(), hat: spring2(), shear: spring2(), plag: spring2(), wob: 0, wobPh: k * 10,
      unreg: () => {}, lastPropK: 0, k, born: time,
    };
    const start = walkIn ? exit : null;
    if (start) { a.mv = newMover(start.x, start.z, Math.PI); }
    a.intent = plan(a.mind, f, worldFor(a), a.mv, false, time, cues);
    cues.length = 0;
    if (!walkIn) {
      place(a.mv, { key: a.intent.key, x: a.intent.x, z: a.intent.z, yaw: a.intent.yaw, gait: a.intent.gait });
      a.act = a.intent.act;
      a.prop = a.intent.prop; a.propS = 1;
    } else { a.prop = 'bindle'; a.propS = 1; a.act = 'bindle'; }
    a.lastYaw = a.mv.yaw;
    actPose(a.act, time, k, look.tempo / 1.9, a.tgt, 0, look.body);
    springSnap(a.spr, a.tgt);
    a.trail = newTrail(a.mv.x, a.mv.z);
    a.y = a.yGround = ground(a.mv.x, a.mv.z);
    const sy = seatHeight(a);
    if (!walkIn && sy !== null) a.y = sy;
    a.hx = a.mv.x; a.hz = a.mv.z;
    for (const d of f.ducklings) a.ducks.push(Ducks.make(d, a.mv.x, a.mv.z, a.y, false));
    a.unreg = ctx.interact.add({
      id: f.id, kind: 'farmer', verb: 'Talk to', label: () => a.view.name, reach: 3.4,
      pos: (out) => out.set(a.pos.x, a.pos.y + 0.5 * a.look.scale, a.pos.z),
      enabled: () => a.mind.leaving === null,
      use: () => ctx.ui.farmerCard(a.id),
      alt: { verb: 'Open terminal', use: () => ctx.agents.openTerminal(a.id) },
    });
    actors.set(f.id, a);
    return a;
  }

  /** root height when sitting on something (built seat, the plot's hay bale), else null */
  function seatHeight(a: Actor): number | null {
    const it = a.intent;
    const sh = SEAT_H[it.act];
    if (sh === undefined) return null;
    if (it.seatY !== undefined) return it.seatY - sh;
    if (it.seatRel !== undefined) return a.yGround + it.seatRel - sh;
    return null;
  }

  function remove(a: Actor) {
    a.unreg();
    if (a.mind.seat >= 0 && occ.get(a.mind.seat) === a.id) occ.delete(a.mind.seat);
    actors.delete(a.id);
  }

  const reactTo = (a: Actor, act: Act | null, face: Face | null, dur: number, emote: EmoteName | null, emoteDur = dur) => {
    a.react = { act, face, until: time + dur, emote, emoteUntil: time + emoteDur };
  };

  function burst(x: number, y: number, z: number, n: number, kind: 'confetti' | 'dust' | 'soil' | 'sparkle' | 'shell' | 'splash' | 'chips') {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random();
      switch (kind) {
        case 'confetti': parts.emit(x, y, z, Math.cos(a) * 1.6 * r, 3 + Math.random() * 2.5, Math.sin(a) * 1.6 * r, 1.6 + Math.random(), 0.07, [0xff5a7a, 0xffd23a, 0x6ad16a, 0x5ab0ff, 0xc08aff][i % 5], 5); break;
        case 'dust': parts.emit(x + Math.cos(a) * 0.2, y, z + Math.sin(a) * 0.2, Math.cos(a) * 0.9, 0.4 + r * 0.6, Math.sin(a) * 0.9, 0.7 + r * 0.4, 0.22, 0xe8dcc0, -0.3); break;
        case 'soil': parts.emit(x + Math.cos(a) * 0.06, y + 0.02, z + Math.sin(a) * 0.06, Math.cos(a) * 0.7 * r, 1.2 + r * 1.2, Math.sin(a) * 0.7 * r, 0.5 + r * 0.3, 0.07 + r * 0.05, i % 3 ? 0x7a5534 : 0x9a7048, 7); break;
        case 'chips': parts.emit(x, y, z, Math.cos(a) * 1.1 * r, 1.4 + r * 1.4, Math.sin(a) * 1.1 * r, 0.45, 0.05, i % 2 ? 0xcf9c63 : 0xe8dcc0, 8); break;
        case 'sparkle': parts.emit(x + (Math.random() - 0.5) * 0.6, y + Math.random() * 0.4, z + (Math.random() - 0.5) * 0.6, 0, 0.5 + r, 0, 0.8 + r * 0.6, 0.06, 0xfff2a0, 0); break;
        case 'shell': parts.emit(x, y + 0.12, z, Math.cos(a) * 0.8, 1.4 + r, Math.sin(a) * 0.8, 0.8, 0.05, 0xf6f1e6, 7); break;
        case 'splash': parts.emit(x, y, z, Math.cos(a) * 0.5, 1 + r, Math.sin(a) * 0.5, 0.6, 0.05, 0x9fd8ff, 7); break;
      }
    }
  }

  function handleEvent(e: ValleyEvent) {
    const a = actors.get(e.id);
    switch (e.kind) {
      case 'arrived': if (!a) arrivals.add(e.id); break;
      case 'left': if (a && a.mind.leaving === null) a.mind.leaving = time; break;
      case 'celebrate': if (a) { reactTo(a, 'cheer', 'sparkle', 2.4, 'heart', 3); burst(a.pos.x, a.pos.y + 1.1, a.pos.z, 36, 'confetti'); audio()?.play('chime-pass', { pos: a.pos, volume: 0.6 }); } break;
      case 'finished': if (a) { reactTo(a, 'cheer', 'proud', 2, 'star', 3); burst(a.pos.x, a.pos.y + 1.1, a.pos.z, 12, 'sparkle'); } break;
      case 'oops': if (a) { reactTo(a, 'oops', 'oops', 1.5, 'sweat', 3); burst(a.pos.x, a.pos.y + 0.1, a.pos.z, 10, 'dust'); a.propS = 0; audio()?.play('oops', { pos: a.pos, volume: 0.7 }); } break;
      case 'struggle': if (a) reactTo(a, 'scratch', 'stuck', 2.6, 'question', 3); break;
      case 'compact': if (a) reactTo(a, 'stretch', 'yawn', 3.4, null); break;
      case 'ship': if (a && !a.mind.errand && !['ask', 'done', 'away', 'idle'].includes(a.view.job)) a.mind.errand = { kind: 'haul', leg: 0, t: time, dest: 'bin', once: true }; break;
      case 'blocked': if (a) { const d = a.pos.distanceTo(ctx.player.pos); if (d < 40) audio()?.voice(a.view.seed, { pos: a.pos, mood: 'excited', syllables: 3 }); } break;
      default: break;
    }
  }

  // --------------------------------------------------------------------------------------------------------------
  function sync() {
    const farmers = ctx.valley.farmers;
    if (firstSeen < 0 && farmers.size) firstSeen = time;
    let fresh = 0;
    for (const id of farmers.keys()) if (!actors.has(id)) fresh++;
    const massLoad = firstSeen < 0 || time - firstSeen < 3 || fresh > 4;
    for (const f of farmers.values()) {
      let a = actors.get(f.id);
      if (!a) a = create(f, !massLoad || arrivals.has(f.id));
      arrivals.delete(f.id);
      a.view = f;
      if (a.mind.leaving !== null) { a.mind.leaving = null; a.vanish = 0; } // came back
      const lk = lookOf(f);
      if (lk.key !== a.lookKey) { a.look = lk.look; a.lookKey = lk.key; a.produce = lk.produce; a.gait.bounce = lk.look.bounce; }
      // ducklings: hatch new ones, send finished ones home
      for (const d of f.ducklings) if (!a.ducks.some((x) => x.id === d.id)) {
        const b = Ducks.make(d, a.mv.x - Math.sin(a.mv.yaw) * 0.8, a.mv.z - Math.cos(a.mv.yaw) * 0.8, a.y, true);
        a.ducks.push(b);
      }
      for (let i = a.ducks.length - 1; i >= 0; i--) {
        const d = a.ducks[i];
        const still = f.ducklings.find((x) => x.id === d.id);
        if (still) { d.label = still.label; continue; }
        a.ducks.splice(i, 1);
        const ang = Math.atan2(d.x - POND.x, d.z - POND.z);
        d.home = { x: POND.x + Math.sin(ang) * (POND.r - 1), z: POND.z + Math.cos(ang) * (POND.r - 1) };
        if (Math.hypot(d.x - ctx.player.pos.x, d.z - ctx.player.pos.z) < 25) audio()?.play('quack', { pos: tmpV.set(d.x, d.y, d.z), pitch: 1.3 });
        leftovers.push(d);
      }
    }
    for (const a of actors.values()) if (!farmers.has(a.id) && a.mind.leaving === null) a.mind.leaving = time;
  }

  // --------------------------------------------------------------------------------------------------------------
  const sepPts: { x: number; z: number; walking: boolean }[] = [];
  const order: Actor[] = [];
  const _near: { a: Actor; d: number }[] = [];

  function stepActor(a: Actor, dt: number) {
    const f = a.view;
    const mv = a.mv;
    // plan at ~10 Hz (staggered)
    if (time >= a.nextPlan) {
      a.intent = plan(a.mind, f, worldFor(a), mv, mv.arrived, time, cues);
      a.nextPlan = time + 0.1;
      for (const c of cues) {
        if (c === 'ship') { burst(bin.x, bin.y + 1.1, bin.z, 8, 'sparkle'); audio()?.play('ship', { pos: tmpV.set(bin.x, bin.y + 1, bin.z), volume: 0.7 }); }
        if (c === 'letter') audio()?.play('letter-open', { pos: a.pos, volume: 0.4 });
      }
      cues.length = 0;
      if (a.mind.seat >= 0 && f.job !== 'idle' && f.job !== 'away' && a.mind.leaving === null) {
        if (occ.get(a.mind.seat) === a.id) occ.delete(a.mind.seat);
        a.mind.seat = -1;
      }
    }
    const it = a.intent;
    // player
    const px = ctx.player.pos.x, pz = ctx.player.pos.z;
    const pdx = px - mv.x, pdz = pz - mv.z;
    const pd = Math.hypot(pdx, pdz);
    const toPlayer = Math.atan2(pdx, pdz);
    const walking = !mv.arrived;
    const reacting = a.react && time < a.react.until && a.react.act && !walking;
    let act: Act = reacting ? a.react!.act! : walking ? (it.walkAct ?? 'stand') : it.act;
    const grounded = !!ACT_INFO[act].grounded;
    // greeting
    if (pd > 11) { a.greeted = false; a.glanced = false; }
    if (pd < 7 && a.mind.leaving === null && !f.needsYou) {
      if (!a.greeted && f.busy < 0.6 && time > a.greetCool && pd > 1.0) {
        a.greeted = true; a.greetCool = time + 25; a.greetUntil = time + 2.4;
        audio()?.voice(f.seed, { pos: a.pos, mood: 'happy', syllables: 2 + Math.floor(a.k * 3) });
      } else if (!a.glanced && f.busy >= 0.6) { a.glanced = true; a.glanceUntil = time + 1.8; }
    }
    if (f.needsYou && pd < 16 && time > a.callAt) {
      a.callAt = time + 5 + a.k * 4;
      audio()?.voice(f.seed, { pos: a.pos, mood: 'question', syllables: 3 });
    }
    const greeting = time < a.greetUntil;
    let yawT = it.yaw;
    if (!walking && !grounded && (greeting || (f.needsYou && pd < 25))) yawT = toPlayer;
    const moved = moveStep(mv, { key: it.key, x: it.x, z: it.z, yaw: yawT, gait: a.mind.leaving !== null && a.intent.key === 'exit' ? 'walk' : it.gait }, dt, routeFn);
    // turn to face the work before starting it (legs shuffle round)
    const yawErr = Math.abs(wrap(yawT - mv.yaw));
    if (!walking && !reacting && yawErr > 0.55 && !(it.seatY !== undefined || it.seatRel !== undefined)) act = 'stand';
    if (act !== a.act) { a.act = act; a.actSince = time; }
    // gait: advance with the distance covered (and with turning on the spot, so the feet step round)
    const turn = dt > 0 ? wrap(mv.yaw - a.lastYaw) / dt : 0;
    a.lastYaw = mv.yaw;
    const heavy = walking && !!ACT_INFO[act].heavy;
    const g = a.gait;
    const L = cycleLength(a.look.body, mv.jog, heavy);
    const turnStep = walking ? 0 : Math.min(1, Math.abs(turn) * 0.6);
    g.cyc += (moved + Math.abs(turn) * dt * 0.28 * (walking ? 0 : 1)) / L;
    g.w = Math.max(mv.moving, damp(g.w, turnStep, 10, dt) * (walking ? 0 : 1));
    g.jog = mv.jog; g.turn = turn; g.speed = mv.speed; g.heavy = heavy; g.bounce = a.look.bounce;
    // pose: loop → springs → gait overlay
    const local = time - a.actSince;
    actPose(act, time, a.k, a.look.tempo / 1.9, a.tgt, local, a.look.body);
    springStep(a.spr, a.tgt, dt, a.out);
    const o = a.out;
    gait(o, a.look.body, g, !!ACT_INFO[act].carryWalk);
    // wave overlay (greeting, done farmers when you pass)
    const waveT = greeting || (f.job === 'done' && pd < 6 && f.unseenDone) ? 1 : 0;
    a.waveW = damp(a.waveW, waveT, 6, dt);
    if (a.waveW > 0.01 && act !== 'ask') {
      const w = a.waveW;
      o[CH.aLz] += (1.1 + Math.sin(time * 10) * 0.35 - o[CH.aLz]) * w;
      o[CH.aLy] += (0.3 + Math.sin(time * 10 + 1.2) * 0.3 - o[CH.aLy]) * w;
      o[CH.aLe] += (0.5 - o[CH.aLe]) * w;
    }
    // look at the player: the eyes slide over, the body turns a little (a block has no neck)
    const wantLook = greeting || time < a.glanceUntil || (pd < 5 && f.busy < 0.6) || (f.needsYou && pd < 25);
    let lx = 0, ly = 0, tw = 0;
    if (wantLook) {
      const rel = wrap(toPlayer - mv.yaw);
      if (Math.abs(rel) < 2.2) { lx = clamp(rel * 1.1, -1, 1); tw = clamp(rel * 0.45, -0.45, 0.45) * (grounded ? 0.4 : 1); }
      ly = clamp(Math.atan2(1.6 - 0.5, Math.max(0.5, pd)) * 1.2, -0.3, 0.9);
    }
    a.lookX = damp(a.lookX, lx, 5, dt); a.lookY = damp(a.lookY, ly, 5, dt); a.lookTw = damp(a.lookTw, tw, 3, dt);
    const lw = Math.min(1, Math.abs(a.lookX) + Math.abs(a.lookY));
    o[CH.eyeX] = o[CH.eyeX] * (1 - lw) + a.lookX; o[CH.eyeY] = o[CH.eyeY] * (1 - lw * 0.7) + a.lookY;
    o[CH.twist] += a.lookTw;
    // props: put away the old one, take out the new one
    let want: Prop | null = walking ? it.walkProp : it.prop;
    if (reacting) {
      const rp = propOf(a.react!.act!);
      want = a.react!.act === 'oops' ? null : rp ?? (ACT_INFO[a.react!.act!].carryWalk ? want : null);
    }
    if (a.prop !== want) {
      a.propS -= dt / 0.18;
      if (a.propS <= 0) { a.propS = 0; a.prop = want; }
    } else a.propS = Math.min(1, a.propS + dt / 0.3);
    // face
    const react = a.react && time < a.react.until ? a.react : null;
    let face: Face = react?.face ?? (walking ? (f.mood === 'focused' ? 'neutral' : MOOD_FACE[f.mood]) : ACT_INFO[act].face ?? MOOD_FACE[f.mood]);
    if (!react) {
      if (f.mood === 'stuck' && (face === 'focused' || face === 'neutral')) face = 'stuck';
      if (f.needsYou) face = 'surprised';
      if (greeting) face = 'happy';
      if (face === 'talk' && act === 'chat' && Math.sin(time * 0.45 + (a.mind.seat % 2) * Math.PI) < 0) face = 'happy'; // listening
    }
    // blinks: personality timing, sometimes a double blink
    if (time > a.blinkAt) {
      a.blinkT = 0;
      a.blinkAgain = !a.blinkAgain && frac(a.k * 17 + time * 0.13) < a.look.doubleBlink;
      a.blinkAt = time + (a.blinkAgain ? 0.2 : a.look.blinkEvery * (0.5 + frac(a.k * 13 + time * 0.37)));
    }
    a.blinkT += dt;
    const blink = a.blinkT < 0.14 ? Math.sin((a.blinkT / 0.14) * Math.PI) : 0;
    faceGlyphs(a.look.body, face, face === 'asleep' || face === 'happy' || face === 'proud' ? 0 : blink, time + a.k * 3, a.glyphs);
  }

  /** which nub holds the current prop: the act that uses it decides (a crate rides on top) */
  const holdFor = (a: Actor) => {
    for (const act of [a.act, a.intent.act, a.intent.walkAct]) if (act && ACT_INFO[act].prop === a.prop) return holdOf(act);
    return a.prop === 'crate' && a.act !== 'bend' ? 'over' as const : 'R' as const;
  };

  const drawIn: DrawIn = {
    look: null as unknown as Look, at: { x: 0, y: 0, z: 0, yaw: 0, scale: 1 }, pose: newPose(), gait: null as unknown as GaitState,
    glyphs: newGlyphs(), prop: null, hold: 'R', propScale: 1, produce: 0xffffff, hatLag: { x: 0, z: 0, y: 0 }, propLag: { x: 0, z: 0 },
    shear: { x: 0, z: 0 }, wobble: 0, wobblePhase: 0,
  };
  const drawOut: DrawOut = { head: new THREE.Vector3(), hand: new THREE.Vector3(), eyes: new THREE.Vector3() };

  function writeActor(a: Actor, dt: number) {
    const mv = a.mv;
    if (Math.abs(mv.x - a.hx) + Math.abs(mv.z - a.hz) > 0.05) { a.hx = mv.x; a.hz = mv.z; a.yGround = ground(mv.x, mv.z); }
    const seat = mv.arrived && a.act === a.intent.act ? seatHeight(a) : null;
    const yT = seat ?? a.yGround;
    const climbing = yT > a.yGround + 0.05 || a.y > a.yGround + 0.05;
    a.y = damp(a.y, yT, climbing ? 6 : 18, dt);
    trailPush(a.trail, mv.x, mv.z);
    let s = a.look.scale;
    if (a.vanish > 0) s *= Math.max(0, 1 - a.vanish / 0.5);
    // secondary motion, driven by the body top's acceleration in the farmer's own frame
    if (dt > 1e-4 && a.top0.x < 1e8) {
      tmpV.subVectors(a.head, a.top0).divideScalar(dt);
      tmpA.subVectors(tmpV, a.vel0).divideScalar(dt);
      a.vel0.copy(tmpV);
      const c = Math.cos(mv.yaw), sn = Math.sin(mv.yaw);
      const ax = clamp(tmpA.x * c - tmpA.z * sn, -40, 40), az = clamp(tmpA.x * sn + tmpA.z * c, -40, 40), ay = clamp(tmpA.y, -60, 60);
      spr(a.hat, ax * 1.2, -az * 1.2, -ay * 0.012, 3.2, 0.3, dt);
      spr(a.shear, -ax * 0.35, -az * 0.35, 0, 2.6, 0.35, dt);
      spr(a.plag, -az * 0.9 - ay * 0.5, ax * 0.6, 0, 3, 0.28, dt);
      // lobe wobble: kicked by squashes and bumps, rings down slowly (the shader supplies the oscillation)
      const wobT = Math.min(1, Math.abs(a.out[CH.jig]) * 0.35 + Math.abs(ay) * 0.006);
      a.wob = Math.max(wobT, a.wob * Math.exp(-2.2 * dt));
    }
    a.top0.copy(a.head);
    a.wobPh += dt * 13;
    const d = drawIn;
    d.look = a.look; d.pose.set(a.out); d.gait = a.gait;
    d.at.x = mv.x; d.at.y = a.y; d.at.z = mv.z; d.at.yaw = mv.yaw; d.at.scale = s;
    d.glyphs = a.glyphs;
    d.prop = a.prop; d.hold = holdFor(a);
    const intended = a.prop === (a.mv.arrived ? a.intent.prop : a.intent.walkProp);
    d.propScale = intended ? easeOutBack(a.propS) : a.propS * a.propS;
    d.produce = a.produce;
    d.hatLag.x = clamp(a.hat.z, -0.5, 0.5); d.hatLag.z = clamp(a.hat.x, -0.5, 0.5); d.hatLag.y = clamp(a.hat.y, -0.02, 0.08);
    d.propLag.x = clamp(a.plag.x, -0.7, 0.7); d.propLag.z = clamp(a.plag.z, -0.5, 0.5);
    d.shear.x = clamp(a.shear.x, -0.12, 0.12); d.shear.z = clamp(a.shear.z, -0.12, 0.12);
    // world shear → body-local (the shader shears in model space)
    d.wobble = a.look.body === 'codex' ? a.wob * 0.09 : a.wob * 0.03; d.wobblePhase = a.wobPh;
    crowd.draw(d, drawOut);
    a.pos.set(mv.x, a.y, mv.z);
    a.head.copy(drawOut.head); a.hand.copy(drawOut.hand); a.eyes.copy(drawOut.eyes);
  }

  // --------------------------------------------------------------------------------------------------------------
  function fx(a: Actor, cam: THREE.Vector3) {
    const f = a.view;
    const hp = a.head;
    const d = cam.distanceTo(hp);
    const top = hp.y + HAT_CLEAR * a.look.scale;
    const far = clamp(1 - (d - 45) / 25, 0, 1);
    const t = time + a.k * 10;
    if (f.needsYou && a.mind.leaving === null) {
      const bounce = Math.abs(Math.sin(t * 3.2)) * 0.22;
      const size = Math.max(0.6, d * 0.065);
      const lift = a.nameA * 0.5 * Math.max(1, d / 7) + a.bubbleA * 0.7 * Math.max(1, d / 7);
      const y = top + 0.2 + lift + bounce * Math.max(1, size);
      bills.push(hp.x, y - size * 0.25, hp.z, size * 1.8, EMOTE.halo, 0.55 + Math.sin(t * 4) * 0.15, 1.6);
      bills.push(hp.x, y, hp.z, size, EMOTE.bang, 1, 2.2, Math.sin(t * 2.2) * 0.12);
      beacons.push(hp.x, top, hp.z, 16 + d * 0.1, 0.8 + d * 0.01, clamp((d - 8) / 20, 0, 1));
    } else if (f.unseenDone && a.mind.leaving === null) {
      const p = 0.5 + 0.5 * Math.sin(t * 2);
      bills.push(hp.x, top + 0.1 + p * 0.06, hp.z, 0.42, EMOTE.check, far, 1.3);
      if (Math.random() < 0.05 && d < 30) burst(hp.x, top, hp.z, 1, 'sparkle');
    }
    const side = Math.cos(a.mv.yaw), sideZ = -Math.sin(a.mv.yaw);
    if (a.react && time < a.react.emoteUntil && a.react.emote) {
      const k = 1 - (a.react.emoteUntil - time) / 3;
      bills.push(hp.x + side * 0.3, top + 0.05 + k * 0.3, hp.z + sideZ * 0.3, 0.45 * easeOutBack(clamp(k * 5, 0, 1)), EMOTE[a.react.emote], far * clamp((a.react.emoteUntil - time) * 2, 0, 1), 1.2);
    } else if (f.struggle >= 3) {
      bills.push(hp.x, top + 0.25 + Math.sin(t * 1.5) * 0.04, hp.z, 0.75, EMOTE.storm, far, 1);
      if (d < 35 && Math.random() < 0.35) parts.emit(hp.x + (Math.random() - 0.5) * 0.5, top + 0.35, hp.z + (Math.random() - 0.5) * 0.3, 0, -2, 0, 0.35, 0.035, 0x9fc8ff, 4);
    } else if (f.struggle >= 1) {
      const c = frac(t * 0.6);
      bills.push(hp.x + side * 0.5, hp.y - 0.05 - c * 0.2, hp.z + sideZ * 0.5, 0.2, EMOTE.sweat, far * Math.sin(c * Math.PI), 1);
      if (f.struggle >= 2) bills.push(hp.x - side * 0.4, top, hp.z - sideZ * 0.4, 0.32, EMOTE.scribble, far * 0.8, 1, t);
    } else if (f.job === 'away' || a.act === 'nap' || a.act === 'lie') {
      const c = frac(t * 0.3);
      bills.push(hp.x + 0.15 + c * 0.3, hp.y + 0.1 + c * 0.5, hp.z, 0.4 + c * 0.2, EMOTE.zzz, far * Math.sin(c * Math.PI), 1);
    } else if (a.mv.arrived && a.act === 'plan') {
      const bulb = frac(t / 9) > 0.78;
      bills.push(hp.x + side * 0.45, top + 0.1 + Math.sin(t * 1.3) * 0.03, hp.z + sideZ * 0.45, 0.5, bulb ? EMOTE.bulb : EMOTE.thought, far, bulb ? 1.5 : 1);
    } else if (a.mv.arrived && (a.act === 'fish' || a.act === 'campfire' || a.act === 'sweep')) {
      const c = frac(t / 7);
      if (c < 0.35) bills.push(hp.x + 0.2 + c * 0.4, top + c * 0.6, hp.z, 0.3, EMOTE.note, far * Math.sin((c / 0.35) * Math.PI), 1.1, Math.sin(t * 3) * 0.2);
    } else if (a.mv.arrived && a.act === 'delegate') {
      const c = frac(t * 0.28 - 0.65);
      if (c < 0.3) {
        bills.push(hp.x - side * 0.35, top + c * 0.8, hp.z - sideZ * 0.35, 0.3, EMOTE.note, far * Math.sin((c / 0.3) * Math.PI), 1.2, -0.2);
        if (c > 0.1) bills.push(hp.x + side * 0.1, top + 0.15 + (c - 0.1) * 0.9, hp.z + sideZ * 0.1, 0.24, EMOTE.note, far * Math.sin(((c - 0.1) / 0.2) * Math.PI), 1.2, 0.25);
      }
    } else if (a.mv.arrived && (a.act === 'talk' || a.act === 'chat') && !a.bubbleA) {
      const c = frac(t * 0.4);
      if (c < 0.3) bills.push(hp.x + side * 0.4, top - 0.05, hp.z + sideZ * 0.4, 0.34, EMOTE.dots, far * Math.sin((c / 0.3) * Math.PI), 1);
    }
    // water droplets from the can's rose
    if (a.prop === 'can' && a.propS > 0.9 && d < 50 && (a.act === 'water')) {
      const yaw = a.mv.yaw;
      fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
      const pour = a.out[CH.prop];
      const hx = a.hand;
      for (let i = 0; i < 2; i++) {
        if (Math.random() > 0.3 + pour) continue;
        parts.emit(hx.x + fwd.x * 0.33, hx.y + 0.02 - pour * 0.12, hx.z + fwd.z * 0.33, fwd.x * 0.8 + (Math.random() - 0.5) * 0.3, -0.3, fwd.z * 0.8 + (Math.random() - 0.5) * 0.3, 0.5, 0.045, 0x8fd0ff, 6);
      }
    }
    // tool beats: soil puffs at the trowel stab, dust at the hoe chop, chips at the hammer strike
    const pk = a.out[CH.prop];
    if (a.mv.arrived && d < 30 && a.prop && a.lastPropK < 0.6 && pk >= 0.6 && (a.act === 'hammer' || a.act === 'hoe' || a.act === 'plant')) {
      const h = a.hand;
      fwd.set(Math.sin(a.mv.yaw), 0, Math.cos(a.mv.yaw));
      const tx = h.x + fwd.x * 0.3, tz = h.z + fwd.z * 0.3;
      if (a.act === 'plant') burst(tx, a.y + 0.02, tz, 6, 'soil');
      else if (a.act === 'hoe') { burst(h.x + fwd.x * 0.75, a.y + 0.02, h.z + fwd.z * 0.75, 7, 'soil'); burst(h.x + fwd.x * 0.75, a.y + 0.05, h.z + fwd.z * 0.75, 2, 'dust'); }
      else burst(tx, h.y + 0.05, tz, 5, 'chips');
      if (d < 16) audio()?.play(a.act === 'hammer' ? 'hammer' : 'hoe', { pos: a.pos, volume: 0.35 });
    }
    a.lastPropK = pk;
    // landing puffs for big hops
    if (a.act === 'ask' || a.act === 'cheer') {
      const land = a.tgt[CH.sq] < -0.12 && a.out[CH.bob] < 0.02;
      if (land && d < 25 && Math.random() < 0.25) burst(a.pos.x, a.y + 0.02, a.pos.z, 2, 'dust');
    }
  }

  // --------------------------------------------------------------------------------------------------------------
  const locator: FarmerLocator & { debug(id: string): unknown } = {
    position(id) { const a = actors.get(id); return a ? a.pos.clone() : null; },
    head(id) { const a = actors.get(id); return a ? a.head.clone() : null; },
    /** dev: what a farmer is doing right now */
    debug(id) {
      const a = actors.get(id);
      if (!a) return null;
      return { job: a.view.job, act: a.act, body: a.look.body, intent: { key: a.intent.key, act: a.intent.act, x: a.intent.x, z: a.intent.z }, x: a.mv.x, z: a.mv.z, arrived: a.mv.arrived, path: a.mv.path.length, prop: a.prop, react: a.react?.act ?? null, errand: a.mind.errand };
    },
  };
  ctx.services.set('farmers', locator);

  const camPos = new THREE.Vector3(), camDir = new THREE.Vector3();

  return {
    name: 'farmers',
    update(fi: FrameInfo) {
      const dt = fi.dt;
      time += dt;
      refreshSeats();
      for (const e of events.splice(0)) handleEvent(e);
      sync();
      for (const e of events.splice(0)) handleEvent(e);
      order.length = 0;
      for (const a of actors.values()) order.push(a);
      for (const a of order) stepActor(a, dt);
      // soft separation among farmers and around the player
      sepPts.length = order.length + 1;
      for (let i = 0; i < order.length; i++) {
        const a = order[i];
        const p = (sepPts[i] ??= { x: 0, z: 0, walking: false });
        p.x = a.mv.x; p.z = a.mv.z; p.walking = !a.mv.arrived;
      }
      const pp = (sepPts[order.length] ??= { x: 0, z: 0, walking: false });
      pp.x = ctx.player.pos.x; pp.z = ctx.player.pos.z; pp.walking = false;
      separate(sepPts, 0.85, dt);
      for (let i = 0; i < order.length; i++) {
        const a = order[i];
        a.mv.x = sepPts[i].x; a.mv.z = sepPts[i].z;
        if (!a.mv.arrived && Math.hypot(a.mv.goal.x - a.mv.x, a.mv.goal.z - a.mv.z) > 1.5) ctx.colliders.resolve(a.mv, 0.3);
      }
      // leaving: vanish at the exit
      for (const a of order) {
        if (a.mind.leaving !== null && a.intent?.vanish && a.mv.arrived) a.vanish += dt;
        if (a.mind.arriving && a.mv.arrived && a.mv.key !== 'exit') a.mind.arriving = false;
      }
      crowd.ensure(order.length);
      crowd.begin();
      for (const a of order) {
        if (a.vanish > 0.5) { for (const d of a.ducks) { d.home = { x: a.mv.x, z: a.mv.z }; d.fade = Math.min(d.fade, 0.4); leftovers.push(d); } remove(a); continue; }
        writeActor(a, dt);
      }
      crowd.end();

      // ducklings
      ducks.begin();
      for (const a of actors.values()) {
        const hop = a.act === 'delegate' && a.mv.arrived && Math.sin(time * 0.28 * Math.PI * 2) > 0.3;
        const settled = a.mv.arrived && a.mv.moving < 0.1;
        const n = a.ducks.length;
        for (let i = 0; i < n; i++) {
          const d = a.ducks[i];
          let spot: { x: number; z: number } | null = null;
          if (settled) {
            // a little arc behind the farmer, facing them
            const ang = a.mv.yaw + Math.PI + (i - (n - 1) / 2) * 0.5;
            const r = 1.0 + (i % 2) * 0.3;
            spot = duckSpot; duckSpot.x = a.mv.x + Math.sin(ang) * r; duckSpot.z = a.mv.z + Math.cos(ang) * r;
          }
          if (ducks.follow(d, a.trail, a.mv.x, a.mv.z, 0.9 + i * 0.42, dt, hop, ground, a.mv.yaw, spot)) {
            burst(d.x, d.y, d.z, 8, 'shell');
            audio()?.play('pop', { pos: tmpV.set(d.x, d.y, d.z), volume: 0.5 });
          }
          ducks.draw(d, time, dt);
        }
        if (a.ducks.length && time > a.quackAt) {
          a.quackAt = time + 6 + Math.random() * 14;
          const d = a.ducks[Math.floor(Math.random() * a.ducks.length)];
          Ducks.peep(d);
          if (Math.hypot(d.x - ctx.player.pos.x, d.z - ctx.player.pos.z) < 18) audio()?.play('quack', { pos: tmpV.set(d.x, d.y, d.z), volume: 0.4, pitch: 1.2 + Math.random() * 0.4 });
        }
      }
      for (let i = leftovers.length - 1; i >= 0; i--) {
        const d = leftovers[i];
        if (ducks.goHome(d, dt, ground)) { if (d.fade <= 0 && d.home && Math.hypot(d.home.x - POND.x, d.home.z - POND.z) < POND.r + 1) burst(d.x, d.y, d.z, 5, 'splash'); leftovers.splice(i, 1); continue; }
        ducks.draw(d, time, dt);
      }
      ducks.end();

      // fx + labels
      ctx.camera.getWorldPosition(camPos);
      ctx.camera.getWorldDirection(camDir);
      bills.begin();
      beacons.begin(time);
      labels.begin();
      _near.length = 0;
      const focused = ctx.interact.focused();
      for (const a of actors.values()) {
        fx(a, camPos);
        const d = camPos.distanceTo(a.head);
        const isF = focused?.id === a.id;
        const nameT = (d < 9 || isF || ctx.debug.labels) && a.mind.leaving === null ? 1 : 0;
        a.nameA = damp(a.nameA, nameT, 6, dt);
        if (a.nameA > 0.02) _near.push({ a, d: isF ? -1 : d });
      }
      _near.sort((x, y) => x.d - y.d);
      let bubbles = 0;
      for (let i = 0; i < _near.length && i < (ctx.debug.labels ? 8 : 4); i++) {
        const { a } = _near[i];
        const f = a.view;
        const verb = ctx.debug.labels ? `${f.job} ← ${f.rawJob}` : JOB_VERB[f.job];
        const sub = f.detail && !f.needsYou && f.job !== 'idle' && f.job !== 'away' ? `${verb} · ${f.detail}` : verb;
        const k = Math.max(1, _near[i].d / 7);
        tmpV.set(a.head.x, a.head.y + HAT_CLEAR * a.look.scale, a.head.z);
        labels.show(a.id, 'name', f.name, sub, tmpV, 0.36 * k, a.nameA);
      }
      // speech bubbles: talkers you can hear, and farmers asking for you
      const talkers = [...actors.values()].filter((a) => a.mind.leaving === null && ((a.view.job === 'talk' && a.view.said) || (a.view.needsYou && a.view.question)))
        .map((a) => ({ a, d: camPos.distanceTo(a.head) })).filter((x) => x.d < (x.a.view.needsYou ? 14 : 20)).sort((x, y) => x.d - y.d);
      const said = new Set<Actor>();
      for (const { a, d } of talkers) {
        if (bubbles >= 3) break;
        bubbles++;
        said.add(a);
        a.bubbleA = damp(a.bubbleA, 1, 5, dt);
        const ask = a.view.needsYou;
        const k = Math.max(1, d / 7);
        tmpV.set(a.head.x, a.head.y + HAT_CLEAR * a.look.scale + a.nameA * 0.4 * k, a.head.z);
        labels.show(`${a.id}:say`, ask ? 'ask' : 'speech', excerpt(ask ? a.view.question : a.view.said), '', tmpV, 0.5 * k, a.bubbleA * clamp((20 - d) / 4, 0, 1));
      }
      for (const a of actors.values()) if (!said.has(a)) a.bubbleA = damp(a.bubbleA, 0, 8, dt);
      // duckling labels on hover: the one closest to the crosshair
      let bestDuck: Duck | null = null, bestCos = 0.985;
      for (const a of actors.values()) for (const d of a.ducks) {
        tmpV.set(d.x - camPos.x, d.y + 0.15 - camPos.y, d.z - camPos.z);
        const l = tmpV.length();
        if (l > 8) continue;
        const c = tmpV.dot(camDir) / l;
        if (c > bestCos) { bestCos = c; bestDuck = d; }
      }
      if (bestDuck) labels.show('duck', 'duck', bestDuck.label || 'duckling', '', tmpV.set(bestDuck.x, bestDuck.y + 0.4, bestDuck.z), 0.2, 1);
      labels.end();
      bills.end();
      beacons.end();
      parts.update(dt, ctx.renderer.domElement.height / (2 * Math.tan((ctx.camera.fov * Math.PI) / 360)));
    },
    stats() {
      let walking = 0;
      for (const a of actors.values()) if (!a.mv.arrived) walking++;
      return { farmers: actors.size, walking, ducklings: [...actors.values()].reduce((n, a) => n + a.ducks.length, 0), labels: labels.visible() };
    },
    dispose() {
      offValley();
      for (const a of [...actors.values()]) remove(a);
      ctx.scene.remove(root);
      crowd.dispose();
      if (ctx.services.get('farmers') === locator) ctx.services.delete('farmers');
    },
  };
};
