/**
 * The farmers system: agents as chibi farmers who live in the valley. Each farmer plans where to be from its visible
 * job (brain.ts), walks there along the roads (roads.ts, motion.ts), plays the job's loop with props (pose.ts),
 * reacts to valley events, greets the player, and drags a line of ducklings (its subagents).
 *
 * Draw calls: the whole crowd is ~6 instanced meshes (+ shadow pass), ducklings 2, emotes 1, particles 1, beacons 1,
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
import { lookFor } from './look.ts';
import type { Look } from './look.ts';
import { ACT_INFO, CH, SEAT_H, actPose, blendStep, gait, newBlend, newPose, setAct } from './pose.ts';
import type { Act, Blend, Face, Pose, Prop } from './pose.ts';
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
import { EMOTE, faceCell } from './atlas.ts';
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

interface React { act: Act | null; face: Face | null; until: number; emote: EmoteName | null; emoteUntil: number }

interface Actor {
  id: string;
  slot: number;
  view: FarmerView;
  look: Look;
  lookKey: string;
  mind: Mind;
  mv: Mover;
  intent: Intent;
  nextPlan: number;
  blend: Blend;
  tgt: Pose;
  out: Pose;
  prop: Prop | null;
  propS: number;
  y: number;
  yTarget: number;
  yGround: number;
  hx: number; hz: number;
  react: React | null;
  blinkAt: number;
  blinkUntil: number;
  waveW: number;
  lookY: number; lookP: number;
  greeted: boolean; greetUntil: number; greetCool: number; glanced: boolean; glanceUntil: number; callAt: number;
  nameA: number; bubbleA: number;
  vanish: number;
  trail: Trail;
  ducks: Duck[];
  quackAt: number;
  pos: THREE.Vector3;
  head: THREE.Vector3;
  unreg: () => void;
  lastPropK: number;
  k: number;
  born: number;
}

const tmpV = new THREE.Vector3();
const duckSpot = { x: 0, z: 0 };
const fwd = new THREE.Vector3();
const frac = (x: number) => x - Math.floor(x);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const damp = (c: number, t: number, r: number, dt: number) => c + (t - c) * (1 - Math.exp(-r * dt));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

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
  const freeSlots: number[] = [];
  let nextSlot = 0;
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
    const slot = freeSlots.length ? freeSlots.pop()! : nextSlot++;
    crowd.ensure(slot + 1);
    const { look, key, produce } = lookOf(f);
    crowd.setLook(slot, look, produce);
    const k = frac(hash32(f.seed) / 4294967296 * 7.31);
    const mind = newMind(f.job, time, k);
    mind.arriving = walkIn;
    const a: Actor = {
      id: f.id, slot, view: f, look, lookKey: key, mind, mv: newMover(0, 0, 0), intent: null as unknown as Intent, nextPlan: 0,
      blend: newBlend('stand'), tgt: newPose(), out: newPose(), prop: null, propS: 0, y: 0, yTarget: 0, yGround: 0, hx: 1e9, hz: 0, react: null,
      blinkAt: time + 1 + k * 3, blinkUntil: 0, waveW: 0, lookY: 0, lookP: 0, greeted: false, greetUntil: 0, greetCool: 0, glanced: false,
      glanceUntil: 0, callAt: 0, nameA: 0, bubbleA: 0, vanish: 0, trail: newTrail(0, 0), ducks: [], quackAt: time + 5 + k * 10,
      pos: new THREE.Vector3(), head: new THREE.Vector3(), unreg: () => {}, lastPropK: 0, k, born: time,
    };
    const start = walkIn ? exit : null;
    if (start) { a.mv = newMover(start.x, start.z, Math.PI); }
    a.intent = plan(a.mind, f, worldFor(a), a.mv, false, time, cues);
    cues.length = 0;
    if (!walkIn) {
      place(a.mv, { key: a.intent.key, x: a.intent.x, z: a.intent.z, yaw: a.intent.yaw, gait: a.intent.gait });
      a.blend = newBlend(a.intent.act);
      a.prop = a.intent.prop; a.propS = 1;
    } else { a.prop = 'bindle'; a.propS = 1; }
    crowd.setProp(slot, a.prop);
    a.trail = newTrail(a.mv.x, a.mv.z);
    a.y = a.yTarget = a.yGround = ground(a.mv.x, a.mv.z);
    if (!walkIn && a.intent.seatY !== undefined && SEAT_H[a.intent.act] !== undefined) a.y = a.intent.seatY - SEAT_H[a.intent.act]!;
    a.hx = a.mv.x; a.hz = a.mv.z;
    for (const d of f.ducklings) a.ducks.push(Ducks.make(d, a.mv.x, a.mv.z, a.y, false));
    a.unreg = ctx.interact.add({
      id: f.id, kind: 'farmer', verb: 'Talk to', label: () => a.view.name, reach: 3.4,
      pos: (out) => out.set(a.pos.x, a.pos.y + 0.75 * a.look.scale, a.pos.z),
      enabled: () => a.mind.leaving === null,
      use: () => ctx.ui.farmerCard(a.id),
      alt: { verb: 'Open terminal', use: () => ctx.agents.openTerminal(a.id) },
    });
    actors.set(f.id, a);
    return a;
  }

  function remove(a: Actor) {
    a.unreg();
    crowd.hide(a.slot);
    freeSlots.push(a.slot);
    if (a.mind.seat >= 0 && occ.get(a.mind.seat) === a.id) occ.delete(a.mind.seat);
    actors.delete(a.id);
  }

  const reactTo = (a: Actor, act: Act | null, face: Face | null, dur: number, emote: EmoteName | null, emoteDur = dur) => {
    a.react = { act, face, until: time + dur, emote, emoteUntil: time + emoteDur };
  };

  function burst(x: number, y: number, z: number, n: number, kind: 'confetti' | 'dust' | 'sparkle' | 'shell' | 'splash') {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random();
      switch (kind) {
        case 'confetti': parts.emit(x, y, z, Math.cos(a) * 1.6 * r, 3 + Math.random() * 2.5, Math.sin(a) * 1.6 * r, 1.6 + Math.random(), 0.07, [0xff5a7a, 0xffd23a, 0x6ad16a, 0x5ab0ff, 0xc08aff][i % 5], 5); break;
        case 'dust': parts.emit(x + Math.cos(a) * 0.2, y, z + Math.sin(a) * 0.2, Math.cos(a) * 0.9, 0.4 + r * 0.6, Math.sin(a) * 0.9, 0.7 + r * 0.4, 0.22, 0xe8dcc0, -0.3); break;
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
      case 'celebrate': if (a) { reactTo(a, 'cheer', 'happy', 2.4, 'heart', 3); burst(a.pos.x, a.pos.y + 1.2, a.pos.z, 36, 'confetti'); audio()?.play('chime-pass', { pos: a.pos, volume: 0.6 }); } break;
      case 'finished': if (a) { reactTo(a, 'cheer', 'proud', 2, 'star', 3); burst(a.pos.x, a.pos.y + 1.2, a.pos.z, 12, 'sparkle'); } break;
      case 'oops': if (a) { reactTo(a, 'oops', 'surprised', 1.4, 'sweat', 3); burst(a.pos.x, a.pos.y + 0.1, a.pos.z, 10, 'dust'); a.propS = 0; audio()?.play('oops', { pos: a.pos, volume: 0.7 }); } break;
      case 'struggle': if (a) reactTo(a, 'scratch', 'stuck', 2.6, 'question', 3); break;
      case 'compact': if (a) reactTo(a, 'stretch', 'yawn', 3, null); break;
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
      if (lk.key !== a.lookKey) { a.look = lk.look; a.lookKey = lk.key; crowd.setLook(a.slot, lk.look, lk.produce); }
      // ducklings: hatch new ones, send finished ones home
      for (const d of f.ducklings) if (!a.ducks.some((x) => x.id === d.id)) {
        const b = Ducks.make(d, a.mv.x - Math.sin(a.mv.yaw) * 0.6, a.mv.z - Math.cos(a.mv.yaw) * 0.6, a.y, true);
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
    const act0 = a.react && time < a.react.until && a.react.act && !walking ? a.react.act : walking ? (it.walkAct ?? 'stand') : it.act;
    const grounded = !!ACT_INFO[act0].grounded;
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
    moveStep(mv, { key: it.key, x: it.x, z: it.z, yaw: yawT, gait: a.mind.leaving !== null && a.intent.key === 'exit' ? 'walk' : it.gait }, dt, routeFn);
    // pose
    const act = act0;
    setAct(a.blend, act, a.out, walking ? 0.35 : 0.55);
    actPose(a.blend.act, time, a.k, a.look.tempo / 1.9, a.tgt);
    gait(a.tgt, mv.phase, mv.moving, mv.jog, a.look.bounce, !!ACT_INFO[a.blend.act].carryWalk);
    blendStep(a.blend, a.tgt, dt, a.out);
    const o = a.out;
    // wave overlay (greeting, done farmers when you pass)
    const waveT = greeting || (f.job === 'done' && pd < 6 && f.unseenDone) ? 1 : 0;
    a.waveW = damp(a.waveW, waveT, 6, dt);
    if (a.waveW > 0.01 && act !== 'ask') {
      const w = a.waveW;
      o[CH.aRz] += (2.1 + Math.sin(time * 11) * 0.45 - o[CH.aRz]) * w;
      o[CH.aRx] += (0.25 - o[CH.aRx]) * w;
    }
    // look at the player
    const wantLook = greeting || time < a.glanceUntil || (pd < 5 && f.busy < 0.6) || (f.needsYou && pd < 25);
    let ly = 0, lp = 0;
    if (wantLook) {
      ly = clamp(wrap(toPlayer - mv.yaw), -1.1, 1.1);
      lp = clamp(-Math.atan2(1.6 - 1.0, Math.max(0.5, pd)), -0.5, 0.2);
      if (Math.abs(wrap(toPlayer - mv.yaw)) > 2.2) ly = 0;
    }
    a.lookY = damp(a.lookY, ly, 5, dt); a.lookP = damp(a.lookP, lp, 5, dt);
    o[CH.headY] += a.lookY; o[CH.headP] += a.lookP * (1 - Math.min(1, Math.abs(o[CH.headP]) * 1.5));
    // props: put away the old one, take out the new one
    let want: Prop | null = walking ? it.walkProp : it.prop;
    if (a.react && time < a.react.until && a.react.act && !walking) {
      const rp = propOf(a.react.act);
      want = a.react.act === 'oops' ? null : rp ?? (ACT_INFO[a.react.act].carryWalk ? want : null);
    }
    if (a.prop !== want) {
      a.propS -= dt / 0.2;
      if (a.propS <= 0) { a.propS = 0; a.prop = want; crowd.setProp(a.slot, want); }
    } else a.propS = Math.min(1, a.propS + dt / 0.3);
    // face
    const react = a.react && time < a.react.until ? a.react : null;
    let face: Face = react?.face ?? (walking ? (f.mood === 'focused' ? 'neutral' : MOOD_FACE[f.mood]) : ACT_INFO[act].face ?? MOOD_FACE[f.mood]);
    if (!react) {
      if (f.mood === 'stuck' && (face === 'focused' || face === 'neutral')) face = 'stuck';
      if (f.needsYou) face = 'worried';
      if (greeting) face = 'happy';
      if (face === 'talk') {
        const listen = act === 'chat' && Math.sin(time * 0.45 + (a.mind.seat % 2) * Math.PI) < 0;
        face = listen ? 'happy' : Math.sin(time * 13 + a.k * 5) > 0.1 ? 'talk' : 'neutral';
      }
    }
    if (time > a.blinkAt) { a.blinkUntil = time + 0.13; a.blinkAt = time + 2 + frac(a.k * 13 + time * 0.37) * 3.5; }
    const blink = time < a.blinkUntil && face !== 'asleep' && face !== 'happy' && face !== 'proud';
    crowd.setFace(a.slot, faceCell(face, blink));
  }

  function writeActor(a: Actor, dt: number) {
    const mv = a.mv;
    if (Math.abs(mv.x - a.hx) + Math.abs(mv.z - a.hz) > 0.05) { a.hx = mv.x; a.hz = mv.z; a.yGround = ground(mv.x, mv.z); }
    const sh = SEAT_H[a.blend.act];
    a.yTarget = mv.arrived && a.intent.seatY !== undefined && sh !== undefined && a.blend.act === a.intent.act ? a.intent.seatY - sh : a.yGround;
    a.y = damp(a.y, a.yTarget, a.yTarget > a.yGround + 0.05 || a.y > a.yGround + 0.05 ? 7 : 18, dt);
    trailPush(a.trail, mv.x, mv.z);
    let s = a.look.scale;
    if (a.vanish > 0) s *= Math.max(0, 1 - a.vanish / 0.5);
    const ps = a.prop === (a.mv.arrived ? a.intent.prop : a.intent.walkProp) ? easeOutBack(a.propS) : a.propS * a.propS;
    crowd.write(a.slot, { x: mv.x, y: a.y, z: mv.z, yaw: mv.yaw, scale: s }, a.out, a.prop, ps);
    a.pos.set(mv.x, a.y, mv.z);
    a.head.copy(crowd.headPos[a.slot]);
  }

  // --------------------------------------------------------------------------------------------------------------
  function fx(a: Actor, cam: THREE.Vector3) {
    const f = a.view;
    const hp = a.head;
    const d = cam.distanceTo(hp);
    const top = hp.y + 0.42 * a.look.scale + (a.look.hat === 'straw' ? 0.1 : 0);
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
    if (a.react && time < a.react.emoteUntil && a.react.emote) {
      const k = 1 - (a.react.emoteUntil - time) / 3;
      bills.push(hp.x + 0.25, top + 0.05 + k * 0.3, hp.z, 0.45 * easeOutBack(clamp(k * 5, 0, 1)), EMOTE[a.react.emote], far * clamp((a.react.emoteUntil - time) * 2, 0, 1), 1.2);
    } else if (f.struggle >= 3) {
      bills.push(hp.x, top + 0.25 + Math.sin(t * 1.5) * 0.04, hp.z, 0.75, EMOTE.storm, far, 1);
      if (d < 35 && Math.random() < 0.35) parts.emit(hp.x + (Math.random() - 0.5) * 0.5, top + 0.35, hp.z + (Math.random() - 0.5) * 0.3, 0, -2, 0, 0.35, 0.035, 0x9fc8ff, 4);
    } else if (f.struggle >= 1) {
      const c = frac(t * 0.6);
      bills.push(hp.x + Math.cos(a.mv.yaw) * 0.26, hp.y + 0.2 - c * 0.2, hp.z - Math.sin(a.mv.yaw) * 0.26, 0.2, EMOTE.sweat, far * Math.sin(c * Math.PI), 1);
      if (f.struggle >= 2) bills.push(hp.x - 0.3, top, hp.z, 0.32, EMOTE.scribble, far * 0.8, 1, t);
    } else if (f.job === 'away' || a.intent.act === 'nap') {
      const c = frac(t * 0.3);
      bills.push(hp.x + 0.15 + c * 0.3, hp.y + 0.3 + c * 0.5, hp.z, 0.4 + c * 0.2, EMOTE.zzz, far * Math.sin(c * Math.PI), 1);
    } else if (a.mv.arrived && a.intent.act === 'plan') {
      const bulb = frac(t / 9) > 0.78;
      bills.push(hp.x + 0.35, top + 0.1 + Math.sin(t * 1.3) * 0.03, hp.z, 0.5, bulb ? EMOTE.bulb : EMOTE.thought, far, bulb ? 1.5 : 1);
    } else if (a.mv.arrived && (a.intent.act === 'fish' || a.intent.act === 'campfire' || a.intent.act === 'lie' || a.intent.act === 'sweep')) {
      const c = frac(t / 7);
      if (c < 0.35) bills.push(hp.x + 0.2 + c * 0.4, top + c * 0.6, hp.z, 0.3, EMOTE.note, far * Math.sin((c / 0.35) * Math.PI), 1.1, Math.sin(t * 3) * 0.2);
    } else if (a.mv.arrived && a.intent.act === 'delegate' && a.ducks.length) {
      const c = frac(t * 0.3 - 0.65);
      if (c < 0.35) bills.push(hp.x - 0.3, top, hp.z, 0.3, EMOTE.note, far * Math.sin((c / 0.35) * Math.PI), 1.2);
    }
    // water droplets from the can's rose
    if (a.prop === 'can' && a.propS > 0.9 && a.mv.arrived && d < 50) {
      const yaw = a.mv.yaw;
      fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
      const hx = crowd.handPos[a.slot];
      for (let i = 0; i < 2; i++) {
        parts.emit(hx.x + fwd.x * 0.32, hx.y - 0.05, hx.z + fwd.z * 0.32, fwd.x * 0.7 + (Math.random() - 0.5) * 0.3, -0.2, fwd.z * 0.7 + (Math.random() - 0.5) * 0.3, 0.5, 0.045, 0x8fd0ff, 6);
      }
    }
    // tool beats: a little dirt at the bottom of a stroke
    const pk = a.out[CH.prop];
    if (a.mv.arrived && d < 30 && (a.intent.act === 'hammer' || a.intent.act === 'hoe' || a.intent.act === 'plant') && a.lastPropK > 0.25 && pk <= 0.25 && a.prop) {
      const hx = crowd.handPos[a.slot];
      burst(hx.x + Math.sin(a.mv.yaw) * 0.3, a.y + 0.05, hx.z + Math.cos(a.mv.yaw) * 0.3, 3, 'dust');
      if (d < 16) audio()?.play(a.intent.act === 'hammer' ? 'hammer' : 'hoe', { pos: a.pos, volume: 0.35 });
    }
    a.lastPropK = pk;
  }

  // --------------------------------------------------------------------------------------------------------------
  const locator: FarmerLocator & { debug(id: string): unknown } = {
    position(id) { const a = actors.get(id); return a ? a.pos.clone() : null; },
    head(id) { const a = actors.get(id); return a ? a.head.clone() : null; },
    /** dev: what a farmer is doing right now */
    debug(id) {
      const a = actors.get(id);
      if (!a) return null;
      return { job: a.view.job, act: a.blend.act, intent: { key: a.intent.key, act: a.intent.act, x: a.intent.x, z: a.intent.z }, x: a.mv.x, z: a.mv.z, arrived: a.mv.arrived, path: a.mv.path.length, prop: a.prop, react: a.react?.act ?? null, errand: a.mind.errand };
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
      separate(sepPts, 0.62, dt);
      for (let i = 0; i < order.length; i++) {
        const a = order[i];
        a.mv.x = sepPts[i].x; a.mv.z = sepPts[i].z;
        if (!a.mv.arrived && Math.hypot(a.mv.goal.x - a.mv.x, a.mv.goal.z - a.mv.z) > 1.5) ctx.colliders.resolve(a.mv, 0.25);
      }
      // leaving: vanish at the exit
      for (const a of order) {
        if (a.mind.leaving !== null && a.intent?.vanish && a.mv.arrived) a.vanish += dt;
        if (a.mind.arriving && a.mv.arrived && a.mv.key !== 'exit') a.mind.arriving = false;
      }
      let maxSlot = 0;
      for (const a of order) {
        if (a.vanish > 0.5) { for (const d of a.ducks) { d.home = { x: a.mv.x, z: a.mv.z }; d.fade = Math.min(d.fade, 0.4); leftovers.push(d); } remove(a); continue; }
        writeActor(a, dt);
        maxSlot = Math.max(maxSlot, a.slot + 1);
      }
      crowd.setCount(maxSlot);

      // ducklings
      ducks.begin();
      for (const a of actors.values()) {
        const hop = a.blend.act === 'delegate' && a.mv.arrived;
        const settled = a.mv.arrived && a.mv.moving < 0.1;
        const n = a.ducks.length;
        for (let i = 0; i < n; i++) {
          const d = a.ducks[i];
          let spot: { x: number; z: number } | null = null;
          if (settled) {
            // a little arc behind the farmer, facing them
            const ang = a.mv.yaw + Math.PI + (i - (n - 1) / 2) * 0.55;
            const r = 0.75 + (i % 2) * 0.25;
            spot = duckSpot; duckSpot.x = a.mv.x + Math.sin(ang) * r; duckSpot.z = a.mv.z + Math.cos(ang) * r;
          }
          if (ducks.follow(d, a.trail, a.mv.x, a.mv.z, 0.6 + i * 0.4, dt, hop, ground, a.mv.yaw, spot)) {
            burst(d.x, d.y, d.z, 8, 'shell');
            audio()?.play('pop', { pos: tmpV.set(d.x, d.y, d.z), volume: 0.5 });
          }
          ducks.draw(d, time);
        }
        if (a.ducks.length && time > a.quackAt) {
          a.quackAt = time + 6 + Math.random() * 14;
          const d = a.ducks[Math.floor(Math.random() * a.ducks.length)];
          if (Math.hypot(d.x - ctx.player.pos.x, d.z - ctx.player.pos.z) < 18) audio()?.play('quack', { pos: tmpV.set(d.x, d.y, d.z), volume: 0.4, pitch: 1.2 + Math.random() * 0.4 });
        }
      }
      for (let i = leftovers.length - 1; i >= 0; i--) {
        const d = leftovers[i];
        if (ducks.goHome(d, dt, ground)) { if (d.fade <= 0 && d.home && Math.hypot(d.home.x - POND.x, d.home.z - POND.z) < POND.r + 1) burst(d.x, d.y, d.z, 5, 'splash'); leftovers.splice(i, 1); continue; }
        ducks.draw(d, time);
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
        tmpV.set(a.head.x, a.head.y + 0.42 * a.look.scale + (a.look.hat === 'straw' ? 0.12 : 0), a.head.z);
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
        tmpV.set(a.head.x, a.head.y + 0.42 * a.look.scale + (a.look.hat === 'straw' ? 0.12 : 0) + a.nameA * 0.4 * k, a.head.z);
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
      if (bestDuck) labels.show('duck', 'duck', bestDuck.label || 'duckling', '', tmpV.set(bestDuck.x, bestDuck.y + 0.35, bestDuck.z), 0.2, 1);
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

