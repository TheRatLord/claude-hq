/**
 * The villagers system: the valley's persistent townsfolk (cast.ts) — Posy the postmaster, Bram the shipping clerk,
 * Hazel the miller, Mayor Marigold, Fern the ranger and Nimbus the weather-watcher. Presentation-only: they are not in
 * ValleyState and never agents. They read the valley only to talk about it (lines.ts) and are shortcuts into the HUD
 * (UiPort: mailbox, ledger, stats, noticeboard, map).
 *
 * Each keeps a daily routine on the real clock (schedule.ts): their post by day, lunch at a nook, an evening spot,
 * home and lights out at night, shelter in storms. They walk the farmers' roads with the farmers' movement, gait and
 * pose code (scene/farmers: motion, roads, pose, rig), greet you, wave you over when a letter needs you, chat with
 * idle farmers and pet Biscuit and Mochi. After dark they carry a lit hand lantern (a LightEmitter).
 *
 * Draw calls: one Crowd (body, legs, nubs, eyes, role hat, wear, prop ≈ 7 + shadow pass), emotes 1, and a few pooled
 * label sprites. No per-frame allocation in the steady state.
 */
import * as THREE from 'three';
import type { AudioService, FrameInfo, LightEmitter, LightsService, PetsService, SceneCtx, SystemFactory, VillagerPin, VillagersService } from '../context.ts';
import type { ValleyEvent } from '../../model/types.ts';
import { PATHS, SITES, WORLD, heightAt, structure } from '../../world/map.ts';
import type { StructureId, XZ } from '../../world/map.ts';
import { Crowd } from '../farmers/rig.ts';
import type { DrawIn, DrawOut } from '../farmers/rig.ts';
import type { Look } from '../farmers/look.ts';
import { ACT_INFO, CH, actPose, cycleLength, faceGlyphs, gait, holdOf, newGlyphs, newPose, newSprings, springSnap, springStep } from '../farmers/pose.ts';
import type { Act, Face, GaitState, GlyphState, Pose, Prop, Springs } from '../farmers/pose.ts';
import { propOf } from '../farmers/brain.ts';
import { moveStep, newMover, place } from '../farmers/motion.ts';
import type { Mover } from '../farmers/motion.ts';
import { buildRoads, route } from '../farmers/roads.ts';
import { Billboards } from '../farmers/fx.ts';
import { EMOTE } from '../farmers/atlas.ts';
import type { EmoteName } from '../farmers/atlas.ts';
import { Labels } from '../farmers/labels.ts';
import { CAST, villagerLook } from './cast.ts';
import type { Place, Villager } from './cast.ts';
import { hash01, hoursInto, keyOf, nextBeat, roundStop, whereAt } from './schedule.ts';
import type { Where } from './schedule.ts';
import { brief, callOut, lineFor, shipLine } from './lines.ts';

/** Height of the role hat above the body top (labels and emotes clear it). */
const HAT_TOP: Readonly<Record<Villager['hat'], number>> = { postcap: 0.28, eyeshade: 0.18, millcap: 0.3, tophat: 0.45, ranger: 0.34, souwester: 0.34 };

interface Spot { x: number; z: number; yaw: number; via?: { x: number; z: number } }
interface Errand { kind: 'chat' | 'pet'; target: string; x: number; z: number; yaw: number; until: number; arrived: boolean; done: boolean }

interface Folk {
  v: Villager;
  look: Look;
  k: number;
  key: number;
  pin: VillagerPin;
  spots: Record<Exclude<Where, 'round'>, Spot>;
  rounds: Spot[];
  /** passed the current place's `via` waypoint */
  viaDone: boolean;
  /** current place */
  where: Where;
  placeKey: string;
  place: Place;
  spot: Spot;
  beat: number; beatN: number; beatUntil: number; beatAct: Act;
  errand: Errand | null; socialAt: number;
  inside: boolean; fade: number;
  mv: Mover;
  act: Act; actSince: number;
  tgt: Pose; out: Pose; spr: Springs; gait: GaitState; lastYaw: number; glyphs: [GlyphState, GlyphState];
  prop: Prop | null; propS: number;
  y: number; yGround: number; hx: number; hz: number;
  react: { act: Act | null; face: Face | null; until: number } | null;
  emote: EmoteName | null; emoteUntil: number;
  blinkAt: number; blinkT: number;
  greeted: boolean; greetUntil: number; greetCool: number; callAt: number; waveW: number;
  lookX: number; lookY: number; lookTw: number;
  talkUntil: number; talks: number;
  line: string; lineUntil: number; bubbleA: number; nameA: number; sayKey: string;
  hatV: number; hatX: number; hatW: number; topY: number;
  /** wedged-walker detection (the farmers' trick): last progress point and time, sidestep count */
  stuckX: number; stuckZ: number; stuckT: number; stuckN: number;
  pos: THREE.Vector3; head: THREE.Vector3; hand: THREE.Vector3;
  light: LightEmitter; lightOff: () => void;
  unreg: () => void;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const damp = (c: number, t: number, r: number, dt: number) => c + (t - c) * (1 - Math.exp(-r * dt));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const tmpV = new THREE.Vector3();
const LANTERN = new THREE.Color(1.0, 0.6, 0.24);

export const villagersSystem: SystemFactory = (ctx: SceneCtx) => {
  const crowd = new Crowd(CAST.length, true);
  crowd.group.name = 'villagers';
  const bills = new Billboards(48);
  bills.mesh.name = 'villager-emotes';
  const labels = new Labels(6);
  labels.group.name = 'villager-labels';
  const root = new THREE.Group();
  root.name = 'villagers-root';
  root.add(crowd.group, bills.mesh, labels.group);
  ctx.scene.add(root);

  const roads = buildRoads(PATHS, { x: 0, z: -1, hw: 12, hd: 10 });
  const routeFn = (from: XZ, to: XZ) => route(roads, SITES, from, to).filter((p, i, all) => i === all.length - 1 || !ctx.colliders.blocked(p.x, p.z, 0.3));
  const audio = () => ctx.services.get('audio') as AudioService | undefined;
  const pets = () => ctx.services.get('pets') as PetsService | undefined;
  const lights = ctx.services.get('lights') as LightsService | undefined;
  const surface = () => ctx.services.get('walkSurface') as ((x: number, z: number) => number | null) | undefined;
  const ground = (x: number, z: number): number => {
    const s = surface()?.(x, z);
    if (typeof s === 'number') return s;
    const h = heightAt(x, z);
    return h < WORLD.water + 0.1 ? WORLD.water + 0.12 : h;
  };
  const dry = (x: number, z: number) => heightAt(x, z) > WORLD.water + 0.15 || typeof surface()?.(x, z) === 'number';

  /** a place → a world spot on free, dry ground (spiral out from the authored point when a prop is in the way) */
  const resolve = (p: Place): Spot => {
    let x = p.x, z = p.z, yaw = typeof p.face === 'number' ? p.face : 0;
    if (p.at !== 'xz') {
      const s = structure(p.at as StructureId);
      const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
      x = s.x + p.x * c + p.z * sn; z = s.z - p.x * sn + p.z * c;
      yaw = p.face === 'toward' ? Math.atan2(s.x - x, s.z - z) : s.yaw + (p.face as number);
    }
    if (ctx.colliders.blocked(x, z, 0.6) || !dry(x, z)) {
      for (let r = 0.3; r < 4; r += 0.3) {
        let found = false;
        for (let a = 0; a < 12; a++) {
          const ang = (a / 12) * Math.PI * 2 + r;
          const qx = x + Math.sin(ang) * r, qz = z + Math.cos(ang) * r;
          if (!ctx.colliders.blocked(qx, qz, 0.6) && dry(qx, qz)) { x = qx; z = qz; found = true; break; }
        }
        if (found) break;
      }
    }
    let via: Spot['via'];
    if (p.via && p.at !== 'xz') { const s = structure(p.at as StructureId), c = Math.cos(s.yaw), sn = Math.sin(s.yaw); via = { x: s.x + p.via.x * c + p.via.z * sn, z: s.z - p.via.x * sn + p.via.z * c }; }
    return { x, z, yaw, via };
  };

  const folks: Folk[] = [];
  let time = 0;
  const events: ValleyEvent[] = [];
  const offValley = ctx.onValley((e) => { if (e.kind === 'ship') events.push(e); });

  const sky = () => ctx.valley.sky;
  const placeOf = (f: Folk, where: Where, hour: number, entry: number): { key: string; place: Place; spot: Spot } => {
    if (where === 'round' && f.v.places.round?.length) {
      const stops = f.v.places.round;
      const i = roundStop(stops.length, hoursInto(f.v.day, entry, hour, sky().dayOfYear, f.key));
      return { key: `round:${i}`, place: stops[i], spot: f.rounds[i] };
    }
    const w = (where === 'round' ? 'post' : where) as Exclude<Where, 'round'>;
    return { key: w, place: w === 'shelter' ? f.v.places.shelter : f.v.places[w], spot: f.spots[w] };
  };

  for (const v of CAST) {
    const k = hash01(keyOf(v.id), 3.3);
    const look = villagerLook(v);
    const spots = {
      post: resolve(v.places.post), lunch: resolve(v.places.lunch), evening: resolve(v.places.evening), home: resolve(v.places.home), shelter: resolve(v.places.shelter),
    };
    const rounds = (v.places.round ?? []).map(resolve);
    const light: LightEmitter = { pos: new THREE.Vector3(), color: LANTERN.clone(), intensity: 0.95, radius: 4.6, flicker: 0.3, gain: 0, when: 'night' };
    const f: Folk = {
      v, look, k, key: keyOf(v.id),
      pin: { id: v.id, name: v.name, role: v.title, glyph: v.glyph, color: `#${v.color.toString(16).padStart(6, '0')}`, x: 0, z: 0, inside: false },
      spots, rounds, viaDone: true, where: 'post', placeKey: '', place: v.places.post, spot: spots.post,
      beat: -1, beatN: 0, beatUntil: 0, beatAct: 'stand', errand: null, socialAt: 20 + k * 40,
      inside: false, fade: 1, mv: newMover(spots.post.x, spots.post.z, spots.post.yaw),
      act: 'stand', actSince: 0, tgt: newPose(), out: newPose(), spr: newSprings(),
      gait: { cyc: k * 3, w: 0, jog: 0, turn: 0, speed: 0, heavy: false, bounce: v.bounce }, lastYaw: 0, glyphs: newGlyphs(),
      prop: null, propS: 0, y: 0, yGround: 0, hx: 1e9, hz: 0, react: null, emote: null, emoteUntil: 0,
      blinkAt: 1 + k * 3, blinkT: 99, greeted: false, greetUntil: 0, greetCool: 0, callAt: 6 + k * 6, waveW: 0,
      lookX: 0, lookY: 0, lookTw: 0, talkUntil: 0, talks: 0, line: '', lineUntil: 0, bubbleA: 0, nameA: 0, sayKey: `${v.id}:say`,
      hatV: 0, hatX: 0, hatW: 0, topY: 1e9, stuckX: 0, stuckZ: 0, stuckT: 0, stuckN: 0,
      pos: new THREE.Vector3(), head: new THREE.Vector3(), hand: new THREE.Vector3(),
      light, lightOff: lights ? lights.add(light) : () => {},
      unreg: () => {},
    };
    // start where the clock says, already settled (the valley was here before you)
    const s = sky();
    const { slot, entry } = whereAt(v.day, s.hour, s.weather.kind, s.weather.intensity, s.dayOfYear, f.key, !!v.places.home.indoors);
    const p = placeOf(f, slot, s.hour, entry);
    f.where = slot; f.placeKey = p.key; f.place = p.place; f.spot = p.spot;
    place(f.mv, { key: p.key, x: p.spot.x, z: p.spot.z, yaw: p.spot.yaw, gait: 'walk' });
    if (p.place.indoors) { f.inside = true; f.fade = 0; }
    f.y = f.yGround = ground(f.mv.x, f.mv.z);
    f.lastYaw = f.mv.yaw;
    actPose('stand', 0, k, v.tempo / 1.9, f.tgt, 0, 'clawd');
    springSnap(f.spr, f.tgt);
    f.unreg = ctx.interact.add({
      id: v.id, kind: 'villager', verb: v.verb, label: () => (v.role === 'mayor' ? v.name : `${v.name} the ${v.title.toLowerCase()}`), reach: 3.4,
      pos: (out) => out.set(f.pos.x, f.pos.y + 0.6, f.pos.z),
      enabled: () => !f.inside && f.fade > 0.5,
      use: () => talk(f, false),
      alt: { verb: v.fn === 'say' ? 'Ask more' : 'Just chat', use: () => talk(f, true) },
      hint: () => hintFor(f.v),
    });
    folks.push(f);
  }

  /** E: a line about the valley, then the villager's shortcut (the panel opens a beat later so the line reads first) */
  function talk(f: Folk, chatOnly: boolean): void {
    const b = brief(ctx.valley);
    const line = lineFor(f.v.role, b, f.talks + (chatOnly ? 1 : 0));
    f.talks++;
    f.talkUntil = time + 6;
    f.greeted = true; f.greetCool = time + 25;
    f.lineUntil = 0; // the caption carries the line; drop any call-out bubble so it doesn't show twice
    ctx.ui.say(`${f.v.name}: ${line}`, 4200);
    audio()?.voice(f.v.id, { pos: f.pos, mood: 'happy', syllables: 3 + Math.floor(f.k * 3) });
    if (chatOnly || f.v.fn === 'say') return;
    const fn = f.v.fn;
    setTimeout(() => {
      switch (fn) {
        case 'mailbox': ctx.ui.mailbox(); break;
        case 'roster': if (ctx.ui.roster) ctx.ui.roster(); else ctx.ui.noticeboard(); break;
        case 'stats': ctx.ui.stats(); break;
        case 'noticeboard': ctx.ui.noticeboard(); break;
        case 'map': ctx.ui.map(); break;
      }
    }, 850);
  }

  /** the prompt's second line: what talking to them opens, with the number that matters */
  function hintFor(v: Villager): string {
    const s = ctx.valley;
    switch (v.fn) {
      case 'mailbox': { const n = s.letters.filter((l) => !l.read && !(l.kind === 'needs-you' && l.resolved)).length; return `${v.title} · opens the mailbox${n ? ` · ${n} unread` : ''}`; }
      case 'roster': return `${v.title} · opens the farm ledger · ${s.commitsToday} shipped today`;
      case 'stats': return `${v.title} · opens the system stats${s.gauges ? ` · CPU ${Math.round(s.gauges.cpu * 100)}%` : ''}`;
      case 'noticeboard': return `${v.title} · opens the noticeboard`;
      case 'map': return `${v.title} · opens the valley map`;
      case 'say': return `${v.title} · the weather report`;
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  /** pick something social near a social place: an idle farmer to chat with, or a pet to fuss over */
  function social(f: Folk): Errand | null {
    const r = hash01(f.key + f.beatN * 0.77, Math.floor(time));
    if (r < 0.5) {
      const loc = ctx.services.get('farmers') as { position(id: string): THREE.Vector3 | null } | undefined;
      if (!loc) return null;
      let best: { id: string; x: number; z: number } | null = null, bd = 26;
      for (const fv of ctx.valley.farmers.values()) {
        if (fv.job !== 'idle') continue;
        const p = loc.position(fv.id);
        if (!p) continue;
        const d = Math.hypot(p.x - f.spot.x, p.z - f.spot.z);
        if (d < bd) { bd = d; best = { id: fv.id, x: p.x, z: p.z }; }
      }
      if (!best) return null;
      const ang = Math.atan2(f.mv.x - best.x, f.mv.z - best.z);
      const x = best.x + Math.sin(ang) * 1.35, z = best.z + Math.cos(ang) * 1.35;
      if (ctx.colliders.blocked(x, z, 0.35) || !dry(x, z)) return null;
      return { kind: 'chat', target: best.id, x, z, yaw: ang + Math.PI, until: 0, arrived: false, done: false };
    }
    const ps = pets();
    if (!ps) return null;
    for (const p of ps.list()) {
      if (!p.free) continue;
      if (Math.hypot(p.x - f.spot.x, p.z - f.spot.z) > 22) continue;
      const reach = p.id === 'dog' ? 1.3 : 1.15;
      const ang = Math.atan2(f.mv.x - p.x, f.mv.z - p.z);
      const x = p.x + Math.sin(ang) * reach, z = p.z + Math.cos(ang) * reach;
      if (ctx.colliders.blocked(x, z, 0.35) || !dry(x, z)) continue;
      ps.hold(p.id, f.v.id, 30);
      return { kind: 'pet', target: p.id, x, z, yaw: ang + Math.PI, until: 0, arrived: false, done: false };
    }
    return null;
  }

  /** a walker pressed against a solid (the sundial bed, a prop) makes no progress: sidestep it */
  function unwedge(f: Folk): void {
    const mv = f.mv;
    if (mv.arrived || !mv.path.length) { f.stuckX = mv.x; f.stuckZ = mv.z; f.stuckT = time; f.stuckN = 0; return; }
    if (Math.hypot(mv.x - f.stuckX, mv.z - f.stuckZ) > 0.35) { f.stuckX = mv.x; f.stuckZ = mv.z; f.stuckT = time; return; }
    if (time - f.stuckT < 1.2) return;
    const p = mv.path[mv.pi], dx = p.x - mv.x, dz = p.z - mv.z, l = Math.hypot(dx, dz) || 1;
    const side = (f.stuckN + Math.floor(f.k * 2)) % 2 ? 1 : -1, r = 1.4 + (f.stuckN % 3) * 0.6;
    const qx = mv.x + (-dz / l) * side * r + (dx / l) * 0.6, qz = mv.z + (dx / l) * side * r + (dz / l) * 0.6;
    if (!ctx.colliders.blocked(qx, qz, 0.3)) mv.path.splice(mv.pi, 0, { x: qx, z: qz });
    else if (mv.pi < mv.path.length - 1) mv.pi++;
    f.stuckN++; f.stuckT = time; f.stuckX = mv.x; f.stuckZ = mv.z;
  }

  // ---------------------------------------------------------------------------------------------------------------
  const target = { key: '', x: 0, z: 0, yaw: 0, gait: 'walk' as 'walk' | 'jog' | 'amble' };

  function plan(f: Folk): void {
    const s = sky();
    const { slot, entry } = whereAt(f.v.day, s.hour, s.weather.kind, s.weather.intensity, s.dayOfYear, f.key, !!f.v.places.home.indoors);
    const p = placeOf(f, slot, s.hour, entry);
    if (p.key !== f.placeKey) {
      f.where = slot; f.placeKey = p.key; f.place = p.place; f.spot = p.spot; f.beat = -1; f.beatUntil = 0; f.viaDone = !p.spot.via;
      if (f.errand) { if (f.errand.kind === 'pet') pets()?.hold(f.errand.target as 'dog' | 'cat', f.v.id, 0); f.errand = null; }
      if (f.inside && !p.place.indoors) { f.inside = false; f.fade = Math.min(f.fade, 0.01); } // steps out of the door
      else if (f.inside) { place(f.mv, { key: p.key, x: p.spot.x, z: p.spot.z, yaw: p.spot.yaw, gait: 'walk' }); f.viaDone = true; } // indoors → indoors (home ↔ storm shelter): stays in
    }
  }

  function stepFolk(f: Folk, dt: number, night: number): void {
    const mv = f.mv;
    const at = f.placeKey;
    const settled = mv.arrived && mv.key === at;
    // indoors: fade out at the door, stay in
    if (f.place.indoors && settled && !f.errand) {
      f.fade = Math.max(0, f.fade - dt / 0.6);
      if (f.fade <= 0) f.inside = true;
    } else if (!f.inside) f.fade = Math.min(1, f.fade + dt / 0.6);
    if (f.inside) return;

    // the loop at the place, with now and then a social errand
    if (settled && !f.errand && time >= f.beatUntil) {
      const nb = nextBeat(f.place.loop, f.beat, f.key, f.beatN++);
      f.beat = nb.i; f.beatUntil = time + nb.secs;
      let act = nb.i >= 0 ? f.place.loop[nb.i].act : 'stand';
      // after dark the hands are full with the lantern: no tool acts
      if (night > 0.45 && ACT_INFO[act].prop && !ACT_INFO[act].grounded) act = act === 'read' || act === 'almanac' ? 'gaze' : 'stand';
      f.beatAct = act;
      if (f.place.social && time > f.socialAt && f.where !== 'shelter') {
        f.socialAt = time + 35 + hash01(f.key, f.beatN) * 50;
        const e = social(f);
        if (e) f.errand = e;
      }
    }
    const er = f.errand;
    if (er) {
      if (!er.arrived && mv.arrived && mv.key === `errand:${er.target}`) {
        er.arrived = true; er.until = time + (er.kind === 'chat' ? 8 + f.k * 5 : 3.2);
        if (er.kind === 'pet') { pets()?.pet(er.target as 'dog' | 'cat', mv.x, mv.z); f.emote = 'heart'; f.emoteUntil = time + 2.6; }
        else if (f.pos.distanceTo(ctx.player.pos) < 22) audio()?.voice(f.v.id, { pos: f.pos, mood: 'happy', syllables: 2 });
      }
      if (er.arrived && time > er.until) { f.errand = null; f.beatUntil = 0; }
    }

    // player
    const px = ctx.player.pos.x, pz = ctx.player.pos.z;
    const pdx = px - mv.x, pdz = pz - mv.z, pd = Math.hypot(pdx, pdz), toPlayer = Math.atan2(pdx, pdz);
    const talking = time < f.talkUntil;
    // the postmaster waves you over while a letter needs you
    const call = f.v.role === 'postmaster' && pd > 5 && pd < 30 && !talking && settled && ctx.valley.farmers.size > 0 && time > f.callAt;
    if (call) {
      f.callAt = time + 12;
      const b = brief(ctx.valley);
      const line = callOut(f.v.role, b);
      if (line) {
        f.line = line; f.lineUntil = time + 4.5; f.greetUntil = time + 2.6; f.emote = 'mail'; f.emoteUntil = time + 4;
        audio()?.voice(f.v.id, { pos: f.pos, mood: 'question', syllables: 3 });
      }
    }
    if (pd > 11) f.greeted = false;
    if (pd < 7 && !f.greeted && time > f.greetCool && pd > 1) {
      f.greeted = true; f.greetCool = time + 25; f.greetUntil = time + 2.4;
      audio()?.voice(f.v.id, { pos: f.pos, mood: 'happy', syllables: 2 + Math.floor(f.k * 3) });
    }
    const greeting = time < f.greetUntil;
    const beckon = time < f.lineUntil && f.emote === 'mail';

    // where to stand
    if (er) { target.key = `errand:${er.target}`; target.x = er.x; target.z = er.z; target.yaw = er.yaw; }
    else if (!f.viaDone && f.spot.via) {
      // the approach waypoint first (porch steps); done once reached or when already close to the spot
      const vx = f.spot.via.x, vz = f.spot.via.z;
      if (Math.hypot(mv.x - vx, mv.z - vz) < 0.5 || Math.hypot(mv.x - f.spot.x, mv.z - f.spot.z) < 1.2) f.viaDone = true;
      target.key = `${at}:via`; target.x = vx; target.z = vz; target.yaw = Math.atan2(f.spot.x - vx, f.spot.z - vz);
    }
    if (!er && f.viaDone) { target.key = at; target.x = f.spot.x; target.z = f.spot.z; target.yaw = f.spot.yaw; }
    target.gait = f.place.amble && !er ? 'amble' : 'walk';
    const walking0 = !mv.arrived;
    if (!walking0 && (talking || greeting || beckon)) target.yaw = toPlayer;
    // stop and talk when spoken to
    if (talking) { target.key = mv.key; target.x = mv.x; target.z = mv.z; }
    const moved = moveStep(mv, target, dt, routeFn);
    const walking = !mv.arrived;
    if (walking && Math.hypot(mv.goal.x - mv.x, mv.goal.z - mv.z) > 1.5) ctx.colliders.resolve(mv, 0.3);
    unwedge(f);
    // yield to the player: never stand inside them
    if (pd < 0.75 && pd > 1e-3) { mv.x -= (pdx / pd) * (0.75 - pd); mv.z -= (pdz / pd) * (0.75 - pd); }

    // act
    const react = f.react && time < f.react.until ? f.react : null;
    let act: Act = walking ? 'stand' : react?.act ?? (talking ? 'talk' : er?.arrived ? (er.kind === 'chat' ? 'chat' : 'pet') : f.beatAct);
    if (!walking && !react && !talking && Math.abs(wrap(target.yaw - mv.yaw)) > 0.6 && !ACT_INFO[act].grounded) act = 'stand';
    if (act !== f.act) { f.act = act; f.actSince = time; }

    // gait
    const turn = dt > 0 ? wrap(mv.yaw - f.lastYaw) / dt : 0;
    f.lastYaw = mv.yaw;
    const g = f.gait;
    g.cyc += (moved + Math.abs(turn) * dt * 0.28 * (walking ? 0 : 1)) / cycleLength('clawd', mv.jog, false);
    g.w = Math.max(mv.moving, damp(g.w, walking ? 0 : Math.min(1, Math.abs(turn) * 0.6), 10, dt) * (walking ? 0 : 1));
    g.jog = mv.jog; g.turn = turn; g.speed = mv.speed; g.heavy = false;
    actPose(act, time, f.k, f.look.tempo / 1.9, f.tgt, time - f.actSince, 'clawd');
    springStep(f.spr, f.tgt, dt, f.out);
    const o = f.out;
    gait(o, 'clawd', g, false);
    // wave (greeting, beckoning)
    const waveT = (greeting || (beckon && Math.sin(time * 1.4) > -0.3)) && !ACT_INFO[act].grounded ? 1 : 0;
    f.waveW = damp(f.waveW, waveT, 6, dt);
    if (f.waveW > 0.01) {
      const w = f.waveW;
      o[CH.aLz] += (1.1 + Math.sin(time * 10) * 0.35 - o[CH.aLz]) * w;
      o[CH.aLy] += (0.3 + Math.sin(time * 10 + 1.2) * 0.3 - o[CH.aLy]) * w;
      o[CH.aLe] += (0.5 - o[CH.aLe]) * w;
    }
    // eyes on the player when close or talking
    const wantLook = talking || greeting || beckon || pd < 4.5;
    let lx = 0, ly = 0, tw = 0;
    if (wantLook) {
      const rel = wrap(toPlayer - mv.yaw);
      if (Math.abs(rel) < 2.2) { lx = clamp(rel * 1.1, -1, 1); tw = clamp(rel * 0.45, -0.45, 0.45); }
      ly = clamp(Math.atan2(1.1, Math.max(0.5, pd)) * 1.2, -0.3, 0.9);
    }
    f.lookX = damp(f.lookX, lx, 5, dt); f.lookY = damp(f.lookY, ly, 5, dt); f.lookTw = damp(f.lookTw, tw, 3, dt);
    const lw = Math.min(1, Math.abs(f.lookX) + Math.abs(f.lookY));
    o[CH.eyeX] = o[CH.eyeX] * (1 - lw) + f.lookX; o[CH.eyeY] = o[CH.eyeY] * (1 - lw * 0.7) + f.lookY;
    o[CH.twist] += f.lookTw;

    // props: the act's tool by day, the lantern after dark (not when sitting by the fire or asleep)
    const grounded = !!ACT_INFO[act].grounded;
    let want: Prop | null = propOf(act);
    if (night > 0.45 && !grounded && !want && act !== 'oops') want = 'lantern';
    if (f.prop !== want) { f.propS -= dt / 0.18; if (f.propS <= 0) { f.propS = 0; f.prop = want; } }
    else f.propS = Math.min(1, f.propS + dt / 0.3);

    // face + blinks
    let face: Face = react?.face ?? ACT_INFO[act].face ?? 'neutral';
    if (f.where === 'shelter' && !talking) face = 'worried';
    if (greeting || beckon) face = 'happy';
    if (talking && Math.sin(time * 5) < 0) face = 'talk';
    if (time > f.blinkAt) { f.blinkT = 0; f.blinkAt = time + f.look.blinkEvery * (0.5 + hash01(f.key, time)); }
    f.blinkT += dt;
    const blink = f.blinkT < 0.14 ? Math.sin((f.blinkT / 0.14) * Math.PI) : 0;
    faceGlyphs('clawd', face, face === 'asleep' || face === 'happy' ? 0 : blink, time + f.k * 3, f.glyphs);
  }

  const din: DrawIn = {
    look: null as unknown as Look, at: { x: 0, y: 0, z: 0, yaw: 0, scale: 1 }, pose: newPose(), gait: null as unknown as GaitState, glyphs: newGlyphs(),
    prop: null, hold: 'R', propScale: 1, produce: 0xf6efdc, hatLag: { x: 0, z: 0, y: 0 }, propLag: { x: 0, z: 0 }, shear: { x: 0, z: 0 }, wobble: 0, wobblePhase: 0,
  };
  const dout: DrawOut = { head: new THREE.Vector3(), hand: new THREE.Vector3(), eyes: new THREE.Vector3() };

  function draw(f: Folk, dt: number): void {
    const mv = f.mv;
    if (Math.abs(mv.x - f.hx) + Math.abs(mv.z - f.hz) > 0.05) { f.hx = mv.x; f.hz = mv.z; f.yGround = ground(mv.x, mv.z); }
    f.y = damp(f.y, f.yGround, 18, dt);
    // hat follow-through from the body's vertical motion
    if (f.topY < 1e8 && dt > 1e-4) {
      const vy = (f.head.y - f.topY) / dt;
      f.hatW += ((vy - f.hatV) / dt * -0.004 - f.hatX * 90 - f.hatW * 5) * dt;
      f.hatX = clamp(f.hatX + f.hatW * dt, -0.35, 0.35);
      f.hatV = vy;
    }
    f.topY = f.head.y;
    const d = din;
    d.look = f.look; d.pose.set(f.out); d.gait = f.gait; d.glyphs = f.glyphs;
    d.at.x = mv.x; d.at.y = f.y; d.at.z = mv.z; d.at.yaw = mv.yaw;
    const s = f.fade < 1 ? f.fade * f.fade * (3 - 2 * f.fade) : 1;
    d.at.scale = f.look.scale * s;
    d.prop = f.prop; d.hold = f.prop === 'lantern' ? 'R' : holdOf(f.act);
    d.propScale = f.propS;
    d.hatLag.x = f.hatX; d.hatLag.z = 0; d.hatLag.y = 0;
    crowd.draw(d, dout);
    f.pos.set(mv.x, f.y, mv.z);
    f.head.copy(dout.head); f.hand.copy(dout.hand);
    // the lantern lights the villager and the path around them
    const lit = f.prop === 'lantern' ? f.propS * s : 0;
    f.light.gain = lit;
    if (lit > 0) f.light.pos.set(f.hand.x, f.hand.y - 0.16, f.hand.z);
    f.pin.x = mv.x; f.pin.z = mv.z; f.pin.inside = f.inside;
  }

  // ---------------------------------------------------------------------------------------------------------------
  const camPos = new THREE.Vector3();
  const order: Folk[] = [];
  const near: { f: Folk; d: number }[] = [];
  for (let i = 0; i < CAST.length; i++) near.push({ f: null as unknown as Folk, d: 0 });
  let nearN = 0;
  let planAt = 0;
  const byDist = (a: { d: number }, b: { d: number }) => a.d - b.d;

  const pins: VillagerPin[] = folks.map((f) => f.pin);
  const service: VillagersService = {
    list: () => pins,
    debug(id) {
      const f = folks.find((x) => x.v.id === id);
      if (!f) return null;
      return { where: f.where, place: f.placeKey, act: f.act, beat: f.beatAct, inside: f.inside, fade: f.fade, x: f.mv.x, z: f.mv.z, arrived: f.mv.arrived, path: f.mv.path.length, prop: f.prop, errand: f.errand ? `${f.errand.kind}:${f.errand.target}` : null, spot: f.spot };
    },
  };
  ctx.services.set('villagers', service);

  return {
    name: 'villagers',
    update(fi: FrameInfo) {
      const dt = fi.dt;
      time += dt;
      const night = ctx.lighting.night;
      // the clerk cheers every crate that ships
      for (let i = 0; i < events.length; i++) {
        const clerk = folks.find((x) => x.v.role === 'clerk');
        if (clerk && !clerk.inside) {
          clerk.react = { act: 'cheer', face: 'sparkle', until: time + 2.2 };
          clerk.line = shipLine(ctx.valley.commitsToday); clerk.lineUntil = time + 4.5; clerk.emote = 'star'; clerk.emoteUntil = time + 3;
          if (clerk.pos.distanceTo(ctx.player.pos) < 30) audio()?.voice(clerk.v.id, { pos: clerk.pos, mood: 'excited', syllables: 3 });
        }
      }
      events.length = 0;
      // plan at 4 Hz (cheap: a few comparisons per villager)
      if (time >= planAt) { planAt = time + 0.25; for (const f of folks) plan(f); }
      order.length = 0;
      for (const f of folks) { stepFolk(f, dt, night); if (!f.inside) order.push(f); }
      crowd.begin();
      for (const f of order) draw(f, dt);
      for (const f of folks) if (f.inside) { f.light.gain = 0; f.pin.inside = true; f.pin.x = f.mv.x; f.pin.z = f.mv.z; }
      crowd.end();

      // emotes + labels
      ctx.camera.getWorldPosition(camPos);
      bills.begin();
      labels.begin();
      nearN = 0;
      const focused = ctx.interact.focused();
      for (const f of order) {
        const hp = f.head;
        const dist = camPos.distanceTo(hp);
        const top = hp.y + HAT_TOP[f.v.hat];
        const far = clamp(1 - (dist - 40) / 20, 0, 1);
        if (f.emote && time < f.emoteUntil) {
          const left = f.emoteUntil - time;
          const pop = clamp((4 - left) * 5, 0, 1);
          bills.push(hp.x + 0.32, top + 0.1 + Math.sin(time * 3) * 0.04, hp.z, 0.46 * pop, EMOTE[f.emote], far * clamp(left * 2, 0, 1), 1.3);
        } else if (f.act === 'nap') {
          const c = (time * 0.3 + f.k) % 1;
          bills.push(hp.x + 0.15 + c * 0.3, hp.y + 0.1 + c * 0.5, hp.z, 0.4 + c * 0.2, EMOTE.zzz, far * Math.sin(c * Math.PI), 1);
        } else if (f.act === 'chat' && f.mv.arrived) {
          const c = (time * 0.4 + f.k) % 1;
          if (c < 0.3) bills.push(hp.x + 0.3, top, hp.z, 0.34, EMOTE.dots, far * Math.sin((c / 0.3) * Math.PI), 1);
        }
        const isF = focused?.id === f.v.id;
        f.nameA = damp(f.nameA, dist < 10 || isF || ctx.debug.labels ? f.fade : 0, 6, dt);
        f.bubbleA = damp(f.bubbleA, time < f.lineUntil && dist < 24 ? 1 : 0, time < f.lineUntil ? 5 : 8, dt);
        if (f.nameA > 0.02 || f.bubbleA > 0.02) { const n = near[nearN++]; n.f = f; n.d = isF ? -1 : dist; }
      }
      // sort the few in range (insertion sort: no allocation)
      for (let i = 1; i < nearN; i++) { const x = near[i]; let j = i - 1; while (j >= 0 && byDist(near[j], x) > 0) { near[j + 1] = near[j]; j--; } near[j + 1] = x; }
      for (let i = 0; i < nearN && i < 3; i++) {
        const { f, d } = near[i];
        const kk = Math.max(1, Math.abs(d) / 7);
        tmpV.set(f.head.x, f.head.y + HAT_TOP[f.v.hat] + 0.02, f.head.z);
        if (f.nameA > 0.02) labels.show(f.v.id, 'villager', f.v.name, f.v.title, tmpV, 0.36 * kk, f.nameA);
        if (f.bubbleA > 0.02) {
          tmpV.y += f.nameA * 0.42 * kk;
          labels.show(f.sayKey, 'speech', f.line, '', tmpV, 0.5 * kk, f.bubbleA);
        }
      }
      labels.end();
      bills.end();
    },
    stats() {
      let walking = 0, inside = 0;
      for (const f of folks) { if (!f.mv.arrived) walking++; if (f.inside) inside++; }
      return { villagers: folks.length, walking, inside, labels: labels.visible() };
    },
    dispose() {
      offValley();
      for (const f of folks) { f.unreg(); f.lightOff(); }
      ctx.scene.remove(root);
      crowd.dispose();
      if (ctx.services.get('villagers') === service) ctx.services.delete('villagers');
    },
  };
};
