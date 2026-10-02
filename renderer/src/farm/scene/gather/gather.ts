/**
 * The gatherings system: evening get-togethers that make the valley a community (schedule, stories and the shape of
 * an evening are pure in model/gatherings.ts; the seats in slots.ts).
 *
 *  - **Campfire evenings**: idle / finished farmers take the log benches and the stool, off-duty villagers the grass
 *    between them. The evening cycles story → laughter → marshmallows → sing-along → chatter: one sitter tells the
 *    valley's day as speech bubbles (`line`), everyone laughs ("ha!" emotes and giggles), toasts marshmallows, then sways
 *    and sings while the music system plays the campfire song (`music` → audio's 'campfire' scene, placed at the fire).
 *  - **Bandstand concert** (the bandstand upgrade; weekend / festival evenings): three farmers climb the steps with a
 *    fiddle, a banjo and a flute; the crowd (villagers, other free farmers) dances and claps; the music system plays
 *    the band live from the stage (panned, quieter from afar); applause while the band catches its breath.
 *  - **Market morning** (Saturdays, the market stalls): the villagers drop by the stalls in turns to browse and gossip.
 *
 * The player can join: E on a free log bench (or the stool) sits you down by the fire (the controller lowers the eye);
 * the villagers there are glad of the company (friendship, once a day each). Any move key stands you up.
 *
 * Gatherings never hide what matters: only farmers with nothing on attend (canAttend), so a blocked farmer still runs
 * to its gate and working farmers keep working; a farmer called away mid-song just goes.
 *
 * Service 'gatherings' (GatherService): the farmers (World.gather) and the villagers ask it for their spot; the audio
 * asks what live music is within earshot and where it plays; `__valley.gather(kind?, seg?)` forces one (dev / shots).
 * No draw calls of its own (props and emotes ride the farmers' / villagers' instanced meshes); bookkeeping at 4 Hz.
 */
import * as THREE from 'three';
import type { AudioService, FrameInfo, LightEmitter, LightsService, SceneCtx, SystemFactory, VillagersService } from '../context.ts';
import type { StructureSpots } from '../context.ts';
import {
  CAMPFIRE_CYCLE, CAMPFIRE_PERIOD, campfireSeg, canAttend, concertSeg, gatheringAt, hashG, lineAt, storyIn, storyLines, tellerOf, villagerAttends,
} from '../../model/gatherings.ts';
import type { CampfireSeg, ConcertSeg, GatherKind, Gathering, SegAt } from '../../model/gatherings.ts';
import type { FriendsService } from '../../model/friends.ts';
import { heightAt, structure, WORLD } from '../../world/map.ts';
import type { XZ } from '../../world/map.ts';
import { CAMPFIRE_SEATS } from '../structures/leisure.ts';
import { STAGE_LANTERN, STAGE_LANTERN_Y, bandstandSpot, marketSpots } from '../structures/upgrades.ts';
import { propOf } from '../farmers/brain.ts';
import type { GatherSpot } from '../farmers/brain.ts';
import type { Act } from '../farmers/pose.ts';
import { CAST } from '../villagers/cast.ts';
import { bandSlots, campfireSlots, crowdSlots, marketSlots, toWorld } from './slots.ts';
import type { Slot } from './slots.ts';

export interface GatherNow { kind: GatherKind; seg: string; x: number; z: number; forced: boolean; attendees: number }
export interface GatherService {
  /** the gathering on now (null: none) */
  active(): GatherNow | null;
  /** an attending farmer's spot (only idle / finished farmers are ever given one) */
  farmer(id: string): GatherSpot | null;
  /** a villager's spot, if it comes (`slot` = where its day plan has it now; `regular` = its evening spot is the fire) */
  villager(id: string, slot: string, regular: boolean): GatherSpot | null;
  /** what this attendee is saying (the campfire storyteller), else null */
  line(id: string): string | null;
  /** nameplate verb for an attending farmer ('by the campfire', 'in the band'…) */
  label(id: string): string | null;
  /** live music within earshot of (x, z): the campfire sing-along or the band */
  music(x: number, z: number): 'campfire' | 'concert' | null;
  /** where the live music plays from */
  stage(): { x: number; y: number; z: number } | null;
  /** dev / shots: put a gathering on now (null: back to the calendar); `seg` jumps the campfire evening to a moment */
  force(kind: GatherKind | null, seg?: CampfireSeg): GatherNow | null;
  debug(): unknown;
}

type Role = 'sitter' | 'musician' | 'crowd' | 'browser';
interface Seat { slot: Slot; spot: GatherSpot; who: string | null; villager: boolean; k: number; role: Role; asked: number; idx: number }

/** the band's instruments, stage left to right */
const BAND: readonly Act[] = ['fiddle', 'banjo', 'flute'];
/** live music carries this far (m) */
const CAMPFIRE_EAR = 80, BAND_EAR = 115;
const keyOf = (s: string): number => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100003; return h; };
const NAMES = new Map(CAST.map((v) => [v.id, v.name]));

export const gatherSystem: SystemFactory = (ctx: SceneCtx) => {
  let time = 0, next = 0, clockBase = NaN, shift = 0;
  let forced: GatherKind | null = null;
  let g: Gathering | null = null;
  let kind: GatherKind | null = null;
  let seats: Seat[] = [];
  const byWho = new Map<string, Seat>();
  let center: { x: number; y: number; z: number } | null = null;
  /** the campfire's benches (seat centres, surface height) for the player's "Sit on" */
  const benchAt: { x: number; y: number; z: number; n: number }[] = CAMPFIRE_SEATS.map(() => ({ x: 0, y: -999, z: 0, n: 0 }));
  const fireSeg: SegAt<CampfireSeg> = { seg: 'story', cycle: 0, t: 0, len: 0 };
  const bandSeg: SegAt<ConcertSeg> = { seg: 'play', cycle: 0, t: 0, len: 0 };
  let seg = '', lastSeg = '';
  let storyCycle = -1, teller: string | null = null, lines: string[] = [], lineNow: string | null = null;
  let playerBench = -1;
  const now: GatherNow = { kind: 'campfire', seg: '', x: 0, z: 0, forced: false, attendees: 0 };
  const tmp = new THREE.Vector3();
  /** a warm lamp under the bandstand's roof while the band plays after dark */
  const stageLight: LightEmitter = { pos: new THREE.Vector3(), color: new THREE.Color(1.0, 0.72, 0.4), intensity: 1.0, radius: 7.5, flicker: 0.05, gain: 0, when: 'night' };
  const stageAt = new THREE.Vector3();
  const lightOff = (ctx.services.get('lights') as LightsService | undefined)?.add(stageLight) ?? (() => {});

  const audio = () => ctx.services.get('audio') as AudioService | undefined;
  const friends = () => ctx.services.get('friends') as FriendsService | undefined;
  const villagersSvc = () => ctx.services.get('villagers') as VillagersService | undefined;
  type Sitter = { sit(at: { x: number; z: number; y: number; yaw: number } | null, onStand?: () => void): void; readonly seated: boolean };
  const controller = () => ctx.services.get('controller') as Sitter | undefined;
  const clock = () => time + clockBase + shift;
  const occupied = () => { let n = 0; for (const s of seats) if (s.who) n++; return n; };

  // ---- building the seats for a kind -----------------------------------------------------------------------------
  /** a ground spot that landed on a prop / in the water: spiral out a little to free, dry ground */
  const free = (p: Slot): Slot | null => {
    const ok = (x: number, z: number) => !ctx.colliders.blocked(x, z, 0.32) && heightAt(x, z) > WORLD.water + 0.15;
    if (p.y !== undefined || ok(p.x, p.z)) return p;
    for (let r = 0.25; r < 1.6; r += 0.25) for (let a = 0; a < 10; a++) {
      const ang = (a / 10) * Math.PI * 2 + r;
      const x = p.x + Math.sin(ang) * r, z = p.z + Math.cos(ang) * r;
      if (ok(x, z)) return { ...p, x, z };
    }
    return null;
  };
  function build(k: GatherKind): void {
    for (const s of seats) if (s.who) byWho.delete(s.who);
    seats = []; center = null;
    let slots: Slot[] = [], roles: Role[] = [];
    if (k === 'campfire') {
      const cf = structure('campfire');
      const fire = { x: cf.x, z: cf.z, yaw: cf.yaw };
      const built = (ctx.services.get('structureSpots') as StructureSpots | undefined)?.seats().filter((s) => s.kind === 'fire') ?? [];
      const seatY = (i: number): number | undefined => {
        const [bx, bz] = CAMPFIRE_SEATS[i];
        const w = toWorld(fire, bx * 0.88, bz * 0.88);
        let best: number | undefined, bd = 1.2;
        for (const s of built) { const d = Math.hypot(s.x - w.x, s.z - w.z); if (d < bd) { bd = d; best = s.y; } }
        return best ?? heightAt(w.x, w.z) + (i < 3 ? 0.5 : 0.45);
      };
      slots = campfireSlots(fire, CAMPFIRE_SEATS, seatY, 6);
      roles = slots.map(() => 'sitter');
      center = { x: cf.x, y: heightAt(cf.x, cf.z) + 1, z: cf.z };
    } else if (k === 'concert') {
      const bs = bandstandSpot();
      if (bs) {
        const st = { x: bs.x, z: bs.z, yaw: bs.yaw };
        const band = bandSlots(st, bs.r, bs.floor), crowd = crowdSlots(st, bs.r, 12);
        slots = [...band, ...crowd];
        roles = [...band.map(() => 'musician' as const), ...crowd.map(() => 'crowd' as const)];
        center = { x: bs.x, y: bs.floor + 1.4, z: bs.z };
        // the stage light sits in the lantern hung under the front of the roof, ahead of and above the band, so it
        // lights their faces (from the stage's middle it lit their backs and the roof kept the moon off)
        stageAt.set(bs.x + Math.sin(bs.yaw) * STAGE_LANTERN, bs.floor + STAGE_LANTERN_Y, bs.z + Math.cos(bs.yaw) * STAGE_LANTERN);
      }
    } else {
      const ms = marketSpots();
      if (ms?.length) {
        slots = marketSlots(ms);
        roles = slots.map(() => 'browser');
        center = { x: (ms[0].x + ms[ms.length - 1].x) / 2, y: ms[0].y + 1, z: (ms[0].z + ms[ms.length - 1].z) / 2 };
      }
    }
    slots.forEach((raw, i) => {
      const s = free(raw);
      if (!s) return;
      seats.push({
        slot: s, idx: seats.length, who: null, villager: false, k: 0, role: roles[i], asked: 0,
        spot: { key: `gather:${k}:${i}`, x: s.x, z: s.z, yaw: s.yaw, act: 'stand', prop: null, y: s.y, via: s.via ?? null },
      });
    });
    for (const b of benchAt) { b.x = 0; b.z = 0; b.n = 0; b.y = -999; }
    for (const s of seats) {
      const b = s.slot.bench !== undefined ? benchAt[s.slot.bench] : undefined;
      if (!b) continue;
      b.x = (b.x * b.n + s.slot.x) / (b.n + 1); b.z = (b.z * b.n + s.slot.z) / (b.n + 1); b.n++;
      b.y = s.slot.y ?? heightAt(s.slot.x, s.slot.z) + 0.5;
    }
  }

  const release = (s: Seat) => { if (s.who) byWho.delete(s.who); s.who = null; };
  const take = (s: Seat, who: string, villager: boolean) => {
    s.who = who; s.villager = villager; s.k = hashG(keyOf(who), 1.7); s.asked = time; byWho.set(who, s);
    return s;
  };
  /** the first free seat this attendee may take (farmers: the benches and the stage first; villagers: the grass) */
  function seatFor(who: string, villager: boolean): Seat | null {
    let best: Seat | null = null, bestP = -1;
    for (const s of seats) {
      if (s.who) continue;
      const raised = s.slot.kind === 'log' || s.slot.kind === 'stool';
      if (raised && s.slot.bench === playerBench) continue;
      let p: number;
      switch (s.role) {
        case 'sitter': p = villager ? (raised ? -1 : 2) : raised ? 3 : -1; break; // farmers sit up on the benches, villagers on the grass
        case 'musician': p = villager ? -1 : 3; break;
        case 'crowd': p = 1; break;
        default: p = villager ? 2 : -1;
      }
      if (p > bestP) { bestP = p; best = s; }
    }
    return best && bestP >= 0 ? take(best, who, villager) : null;
  }

  // ---- the evening's acts ----------------------------------------------------------------------------------------
  function actFor(s: Seat, playing: boolean): Act {
    const raised = s.slot.kind === 'log' || s.slot.kind === 'stool';
    switch (kind) {
      case 'campfire': {
        const k = s.k;
        switch (fireSeg.seg) {
          case 'story': return s.who === teller ? 'sitchat' : k < 0.5 ? 'campfire' : raised ? 'sit' : 'sitground';
          case 'laugh': return 'laugh';
          case 'toast': return k < 0.7 ? 'toast' : 'sitchat';
          case 'sing': return 'sing';
          default: return k < 0.5 ? 'sitchat' : 'campfire';
        }
      }
      case 'concert':
        if (s.role === 'musician') return playing ? BAND[s.idx % BAND.length] : 'wave';
        return playing && s.k < 0.55 ? 'dance' : 'clap';
      case 'market': {
        const beat = Math.floor((clock() + s.k * 40) / 9) % 3;
        return s.slot.kind === 'stall' && s.idx < 4 ? (beat === 1 ? 'chat' : 'board') : beat === 2 ? 'gaze' : 'chat';
      }
      default: return 'stand';
    }
  }

  /** the band plays while the music does (when you can hear it), else on the clock */
  function bandPlaying(): boolean {
    const mn = audio()?.musicNow?.();
    const p = ctx.player.pos;
    if (mn?.on && center && Math.hypot(p.x - center.x, p.z - center.z) < BAND_EAR) return mn.scene === 'concert';
    return bandSeg.seg === 'play';
  }

  type Locator = { position(id: string): { x: number; z: number } | null };
  /** has this attendee got to its seat? */
  function settled(s: Seat): boolean {
    let p: { x: number; z: number } | null | undefined;
    if (s.villager) p = villagersSvc()?.list().find((q) => q.id === s.who);
    else p = (ctx.services.get('farmers') as Locator | undefined)?.position(s.who!);
    return !!p && Math.hypot(p.x - s.spot.x, p.z - s.spot.z) < 1.5;
  }
  const posOf = (s: Seat, out: THREE.Vector3) => out.set(s.spot.x, (s.spot.y ?? heightAt(s.spot.x, s.spot.z)) + 0.6, s.spot.z);
  const seedOf = (who: string) => ctx.valley.farmers.get(who)?.seed ?? who;
  /** a few giggles / cheers from the sitters near you when the moment turns */
  function chorus(mood: 'happy' | 'excited', n: number) {
    const a = audio();
    if (!a) return;
    let said = 0;
    for (const s of seats) {
      if (!s.who || said >= n) continue;
      posOf(s, tmp);
      if (tmp.distanceTo(ctx.player.pos) > 28) continue;
      const who = s.who, at = tmp.clone(), delay = said * 260 + s.k * 200;
      setTimeout(() => a.voice(seedOf(who), { pos: at, mood, syllables: mood === 'happy' ? 4 : 3 }), delay);
      said++;
    }
  }

  // ---- the 4 Hz tick ---------------------------------------------------------------------------------------------
  function tick(): void {
    const sky = ctx.valley.sky;
    const date = new Date(ctx.valley.now || Date.now());
    g = gatheringAt({
      hour: sky.hour, weekday: date.getDay(), dayOfYear: sky.dayOfYear, weather: sky.weather.kind, intensity: sky.weather.intensity,
      festival: sky.festival?.active?.id ?? null, unlocked: ctx.valley.almanac?.unlocked ?? [],
    }, forced);
    const k = g?.kind ?? null;
    if (k !== kind) {
      kind = k;
      if (k) build(k); else { for (const s of seats) release(s); seats = []; center = null; stageLight.gain = 0; }
      storyCycle = -1; teller = null; lineNow = null;
    }
    if (!kind || !seats.length) { seg = ''; return; }

    // farmers: only those with nothing on; the rest let go of their seat (called away mid-song: they just go)
    for (const s of seats) {
      if (!s.who || s.villager) continue;
      const f = ctx.valley.farmers.get(s.who);
      if (!f || !canAttend(f) || (s.slot.bench !== undefined && s.slot.bench === playerBench)) release(s);
    }
    if (kind !== 'market') for (const f of ctx.valley.farmers.values()) if (!byWho.has(f.id) && canAttend(f)) seatFor(f.id, false);
    // villagers ask for themselves (villagers system, 4 Hz); one that stopped asking has gone (indoors, away)
    for (const s of seats) if (s.who && s.villager && time - s.asked > 1.5) release(s);

    // the evening's moment
    const c = clock();
    if (kind === 'campfire') { campfireSeg(c, fireSeg); seg = fireSeg.seg; }
    else if (kind === 'concert') { concertSeg(c, bandSeg); seg = bandPlaying() ? 'play' : 'applause'; }
    else seg = 'browse';
    if (seg !== lastSeg) {
      if (seg === 'laugh') chorus('happy', 3);
      else if (seg === 'applause' && lastSeg === 'play') chorus('excited', 3);
      lastSeg = seg;
    }
    // the story: one sitter tells it from what the valley did today
    if (kind === 'campfire' && fireSeg.seg === 'story') {
      if (storyCycle !== fireSeg.cycle) {
        // the teller is someone already sat down (not still on the road); nobody yet: ask again next tick
        const sitters: string[] = [];
        for (const s of seats) if (s.who && settled(s)) sitters.push(s.who);
        sitters.sort();
        if (sitters.length) storyCycle = fireSeg.cycle;
        const i = tellerOf(fireSeg.cycle, sitters.length);
        teller = i >= 0 ? sitters[i] : null;
        const f = teller ? ctx.valley.farmers.get(teller) : undefined;
        lines = teller ? storyLines(storyIn(ctx.valley, f?.tag ?? NAMES.get(teller) ?? '', f?.tag ?? null), fireSeg.cycle * 7.13 + sky.dayOfYear) : [];
      }
      lineNow = teller && byWho.has(teller) ? lineAt(lines, fireSeg.t) : null;
    } else { lineNow = null; if (kind === 'campfire') storyCycle = -1; }
    const playing = seg === 'play';
    for (const s of seats) {
      if (!s.who) continue;
      const act = actFor(s, playing);
      s.spot.act = act;
      s.spot.prop = propOf(act);
    }
    stageLight.gain = kind === 'concert' && center ? 1 : 0;
    if (center) stageLight.pos.copy(stageAt);
    now.kind = kind; now.seg = seg; now.x = center?.x ?? 0; now.z = center?.z ?? 0; now.forced = !!g?.forced; now.attendees = occupied();
  }

  // ---- the player sits down --------------------------------------------------------------------------------------
  function sit(b: number): void {
    const ctl = controller();
    const at = benchAt[b];
    if (!ctl || !at.n || !center) return;
    const { x, y, z } = at;
    playerBench = b;
    for (const s of seats) if (s.slot.bench === b && s.who && !s.villager) release(s); // they budge up to another seat
    ctl.sit({ x, z, y, yaw: Math.atan2(center.x - x, center.z - z) }, () => { playerBench = -1; });
    // the villagers by the fire are glad of the company (once a day each)
    const pins = villagersSvc()?.list() ?? [];
    const here: string[] = [];
    for (const s of seats) {
      if (!s.who || !s.villager) continue;
      const p = pins.find((q) => q.id === s.who);
      if (p && !p.inside && Math.hypot(p.x - s.spot.x, p.z - s.spot.z) < 2.5) here.push(s.who);
    }
    const gained = here.length ? friends()?.gathered(here) ?? 0 : 0;
    const names = here.map((id) => NAMES.get(id) ?? id);
    const who = names.length === 0 ? '' : names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    const line = seg === 'sing' ? 'You sit down just in time for the chorus. Everybody knows the words.'
      : seg === 'story' ? 'You settle onto the log. Shh, there\'s a story on.'
      : seg === 'toast' ? 'You settle onto the log and somebody hands you a marshmallow on a stick.'
      : 'You settle onto the log. The fire crackles and pops; the stars are out over the valley.';
    ctx.ui.say(gained ? `${line} ${who} scoot${names.length === 1 ? 's' : ''} up to make room. ♥` : `${line}${who ? ` ${who} smile${names.length === 1 ? 's' : ''} at you.` : ''}`, 5200);
    audio()?.play('creak', { pos: tmp.set(x, y, z), volume: 0.4 });
  }
  const unregs: (() => void)[] = [];
  for (let b = 0; b < CAMPFIRE_SEATS.length; b++) {
    const log = b < 3;
    unregs.push(ctx.interact.add({
      id: `gather:bench:${b}`, kind: 'prop', verb: 'Sit on', label: () => (log ? 'Log bench' : 'Stool'), reach: 3,
      pos: (out) => out.set(benchAt[b].x, benchAt[b].y + 0.15, benchAt[b].z),
      enabled: () => kind === 'campfire' && benchAt[b].n > 0 && !controller()?.seated,
      use: () => sit(b),
      hint: () => (seg === 'sing' ? 'join the sing-along' : seg === 'story' ? 'there\'s a story on' : 'join the campfire evening'),
    }));
  }

  // ---- the service -----------------------------------------------------------------------------------------------
  const service: GatherService = {
    active: () => (kind && seats.length ? now : null),
    farmer(id) {
      const s = byWho.get(id);
      return s && !s.villager ? s.spot : null;
    },
    villager(id, slot, regular) {
      const cur = byWho.get(id);
      const sky = ctx.valley.sky;
      const comes = !!kind && !!g && seats.length > 0 && villagerAttends(kind, {
        slot, key: keyOf(id), dayOfYear: sky.dayOfYear, hour: sky.hour, from: g.from, to: g.to, regular: regular && kind === 'campfire', forced: g.forced,
      });
      if (!comes) { if (cur) release(cur); return null; }
      if (cur) { cur.asked = time; return cur.spot; }
      return seatFor(id, true)?.spot ?? null;
    },
    line: (id) => (lineNow && id === teller ? lineNow : null),
    label(id) {
      const s = byWho.get(id);
      if (!s) return null;
      return s.role === 'musician' ? 'playing in the band' : s.role === 'crowd' ? 'at the concert' : s.role === 'browser' ? 'at the market' : 'by the campfire';
    },
    music(x, z) {
      if (!center || !kind) return null;
      const d = Math.hypot(x - center.x, z - center.z);
      if (kind === 'campfire') return seg === 'sing' && d < CAMPFIRE_EAR && occupied() > 0 ? 'campfire' : null;
      if (kind === 'concert') return d < BAND_EAR && seats.some((s) => s.role === 'musician' && s.who) ? 'concert' : null;
      return null;
    },
    stage: () => center,
    force(k, at) {
      forced = k;
      shift = 0;
      if (k === 'campfire' && at) {
        let start = 0;
        for (const [sg, d] of CAMPFIRE_CYCLE) { if (sg === at) break; start += d; }
        const c = time + clockBase;
        shift = ((start + 0.5 - (c % CAMPFIRE_PERIOD)) + CAMPFIRE_PERIOD) % CAMPFIRE_PERIOD;
      }
      next = 0;
      tick();
      return service.active();
    },
    debug: () => ({
      kind, seg, forced, teller, line: lineNow, t: Math.round(fireSeg.t), playerBench,
      seats: seats.map((s) => ({ who: s.who, kind: s.slot.kind, role: s.role, act: s.spot.act, x: +s.spot.x.toFixed(2), z: +s.spot.z.toFixed(2) })),
    }),
  };
  ctx.services.set('gatherings', service);

  return {
    name: 'gather',
    update(f: FrameInfo) {
      time += f.dt;
      if (Number.isNaN(clockBase)) clockBase = (ctx.valley.now || Date.now()) / 1000 - time;
      if (time < next) return;
      next = time + 0.25;
      tick();
    },
    stats: () => ({ gathering: kind ?? '-', seg, attendees: occupied() }),
    dispose() {
      for (const u of unregs) u();
      lightOff();
      if (playerBench >= 0) controller()?.sit(null);
      if (ctx.services.get('gatherings') === service) ctx.services.delete('gatherings');
    },
  };
};

/** Where a gathering happens (dev / shots: stand there). */
export function gatherViewpoint(kind: GatherKind): (XZ & { yaw: number; look: XZ }) | null {
  if (kind === 'campfire') { const c = structure('campfire'); const p = toWorld(c, -1.2, 10.5); return { x: p.x, z: p.z, yaw: 0, look: c }; }
  if (kind === 'concert') { const b = bandstandSpot(); if (!b) return null; const p = toWorld(b, 6.7, 4.3); return { x: p.x, z: p.z, yaw: 0, look: b }; }   // three-quarter view, clear of the crowd's arc
  const m = marketSpots();
  if (!m?.length) return null;
  const p = toWorld(m[0], 2.5, 6.5);
  return { x: p.x, z: p.z, yaw: 0, look: m[0] };
}
