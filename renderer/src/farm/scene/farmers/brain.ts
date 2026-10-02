// @pure
/**
 * The farmer's mind: turns the visible job (+ what happened lately) into an Intent — where to stand, what to do
 * there, how to walk, what to hold. Errands (haul a crate to the shipping bin, fetch a letter from the mailbox) are
 * little leg-by-leg loops; idle farmers pick leisure seats around the valley and chat in pairs.
 *
 * Pure: no three, no clock (times are passed in seconds). The system feeds `arrived` back from the mover.
 */
import type { FarmerView, Job, PlotKind } from '../../model/types.ts';
import type { ToolClass } from '../../../../../shared/protocol.ts';
import type { Site, XZ } from '../../world/map.ts';
import { askSpot, benchSpot, doneSpot, workSpot } from '../../world/spots.ts';
import { siteToWorld } from '../../world/map.ts';
import type { Act, Prop } from './pose.ts';
import { planTrip, seatBeat, tripStep, wantsTrip } from './idle.ts';
import type { Critter, Friend, Trip } from './idle.ts';

export type Gait = 'walk' | 'jog' | 'amble';

export interface Intent {
  /** location identity: the mover re-routes only when this changes (or the point moves > 1 m) */
  key: string;
  x: number;
  z: number;
  /** facing on arrival (model yaw: front = (sin, cos)) */
  yaw: number;
  /** what to do there */
  act: Act;
  /** upper-body act while walking (carrying a crate, reading a letter), else the gait's own arm swing */
  walkAct: Act | null;
  gait: Gait;
  /** in hand at the place (null = empty hands) */
  prop: Prop | null;
  /** prop while walking */
  walkProp: Prop | null;
  /** remove the farmer when it gets there */
  vanish?: boolean;
  /** absolute height of the seat surface (log bench, hammock, dock edge) when the act sits on something built */
  seatY?: number;
  /** seat surface height above the local ground (the plot's hay bale), when there is no absolute one */
  seatRel?: number;
}

export interface Seat extends XZ {
  yaw: number; act: Act; kind: string;
  /** chat / checkers / blanket seats come in pairs: index of the partner seat */
  pair?: number;
  /** seat surface height */
  y?: number;
  /** activity loop played here (idle.ts LOOPS; default: the act's own loop) */
  loop?: string;
}

export interface Errand { kind: 'haul' | 'fetch'; leg: 0 | 1 | 2 | 3; t: number; dest: 'bin' | 'mailbox' | 'well'; once: boolean }

export interface Mind {
  job: Job;
  jobT: number;
  errand: Errand | null;
  seat: number;
  seatUntil: number;
  n: number;
  /** personality phase 0..1 */
  k: number;
  leaving: number | null;
  arriving: boolean;
  /** idle: the seat loop's current beat (−1 = not started), until when, and its act */
  beat: number;
  beatUntil: number;
  beatAct: Act | null;
  /** idle: a short outing between seats (stroll, mailbox, own field, petting, visiting a friend) */
  trip: Trip | null;
  /** the job's tool flavour on show (FarmerView.tool, held for TOOL_DWELL_S so tool churn never flickers the act) */
  tool: ToolClass | null;
  toolT: number;
}

/** A shown tool flavour stays at least this long before a newer one replaces it (same job). */
export const TOOL_DWELL_S = 8;
/** Web / network fetches arrive by carrier pigeon at the work spot; MCP and the rest walk to the mailbox / well. */
export const pigeonPost = (tool: ToolClass | null): boolean => tool === 'web' || tool === 'net';

export const newMind = (job: Job, t: number, k: number): Mind => ({ job, jobT: t, errand: null, seat: -1, seatUntil: 0, n: 0, k, leaving: null, arriving: false, beat: -1, beatUntil: 0, beatAct: null, trip: null, tool: null, toolT: -1e9 });

export interface World {
  site: Site | null;
  plotKind: PlotKind | null;
  bin: XZ & { yaw: number };
  mailbox: XZ & { yaw: number };
  well: XZ & { yaw: number };
  /** south road, where newcomers appear and leavers vanish */
  exit: XZ;
  hub: XZ;
  seats: readonly Seat[];
  /** stand points published by the structures (in front of the bin / mailbox / well, facing it) */
  stands?: Partial<Record<'bin' | 'mailbox' | 'well', XZ & { yaw: number }>>;
  /** claim a leisure seat for an idle farmer (the system tracks occupancy); returns a seat index */
  claim(id: string, kind: 'leisure' | 'nap', t: number): number;
  // ---- idle life (all optional: without them a farmer just sits) ----
  /** 0 day … 1 night */
  night?: number;
  /** someone else is settled within a few metres of seat i (to chat / play with) */
  company?(i: number): boolean;
  /** give up the current leisure seat (off on an outing) */
  release?(id: string): void;
  /** pettable critters: the village dog and cat, the farmer's own field animals */
  critters?(): readonly Critter[];
  /** other idle farmers settled somewhere (to visit) */
  friends?(): readonly Friend[];
  /** scenic stand points for a stroll, facing the view */
  views?: readonly (XZ & { yaw: number })[];
  /** personality 0..1: how often an outing beats sitting on, how much it likes company */
  restless?: number;
  chatty?: number;
}

const faceYaw = (from: XZ, to: XZ) => Math.atan2(to.x - from.x, to.z - from.z);
const at = (p: XZ & { yaw: number }, dist: number): XZ & { yaw: number } => {
  // stand `dist` in front of a structure, facing it
  const x = p.x + Math.sin(p.yaw) * dist, z = p.z + Math.cos(p.yaw) * dist;
  return { x, z, yaw: p.yaw + Math.PI };
};

/** Acts that cycle in place for a work job (time-sliced, so the farmer keeps doing varied things at one spot). */
export function workAct(job: Job, kind: PlotKind | null, t: number, k: number, tool: ToolClass | null = null): Act {
  const c = (period: number) => ((t + k * 97) % period);
  switch (job) {
    case 'plant': {
      if (kind === 'cows' || kind === 'sheep') return 'brush';
      if (kind === 'chickens' || kind === 'pigs' || kind === 'bees') return 'feed';
      return c(24) < 15 ? 'plant' : 'hoe';
    }
    // reading: the magnifier over the crop, then the seed almanac; searching: rummage through the seed sack
    case 'inspect': return tool === 'search' ? (c(20) < 14 ? 'rummage' : 'inspect') : c(18) < 11 ? 'inspect' : 'almanac';
    // web fetch: a carrier pigeon brings the page, then read the letter it carried
    case 'fetch': return c(13) < 8 ? 'pigeon' : 'read';
    case 'water': return 'water';
    case 'build': return c(21) < 13 ? 'hammer' : 'saw';
    case 'talk': return 'talk';
    case 'delegate': return 'delegate';
    case 'rest': return c(16) < 5 ? 'stretch' : 'sweep';
    default: return 'stand';
  }
}

const PROP_OF: Partial<Record<Act, Prop>> = {
  plant: 'trowel', hoe: 'hoe', feed: 'basket', brush: 'brush', inspect: 'magnifier', almanac: 'book', water: 'can', hammer: 'hammer',
  saw: 'saw', carry: 'crate', read: 'letter', plan: 'notebook', sweep: 'broom', done: 'basket', fish: 'rod', bindle: 'bindle',
  rummage: 'sack', pigeon: 'pigeon',
};
export const propOf = (a: Act): Prop | null => PROP_OF[a] ?? null;

/** The thinking bale the plots package puts behind bench spot 0 (site-local z from the back fence, top height). */
export const BALE = { back: 1.28, h: 0.5 } as const;

const HUB_SPOT = (w: World, spot: number): XZ & { yaw: number } => ({ x: w.hub.x + (spot % 4) * 1.45 - 2.175, z: w.hub.z + 4, yaw: 0 });

/**
 * One planning step. `pos` is where the farmer stands now, `arrived` whether the mover reached the last intent.
 * `cues` collects one-shot moments for the system (e.g. 'ship' when a crate goes in the bin).
 */
export function plan(m: Mind, f: FarmerView, w: World, pos: XZ, arrived: boolean, t: number, cues: string[]): Intent {
  if (m.leaving !== null) {
    if (t - m.leaving < 1.6) return { key: 'wave', x: pos.x, z: pos.z, yaw: faceYaw(pos, w.hub), act: 'wave', walkAct: null, gait: 'walk', prop: null, walkProp: null };
    return { key: 'exit', x: w.exit.x, z: w.exit.z, yaw: 0, act: 'stand', walkAct: 'bindle', gait: 'walk', prop: 'bindle', walkProp: 'bindle', vanish: true };
  }
  if (f.job !== m.job) {
    m.trip = null;
    m.beat = -1;
    // a one-off errand (a crate for a commit) finishes its trip before the next job, unless attention is needed
    const urgent = f.job === 'ask' || f.job === 'away' || f.job === 'done';
    if (!(m.errand?.once && m.errand.leg < 2 && !urgent)) m.errand = null;
    m.job = f.job;
    m.jobT = t;
    m.tool = f.tool ?? null;
    m.toolT = t;
  } else if ((f.tool ?? null) !== m.tool && t - m.toolT >= TOOL_DWELL_S) { m.tool = f.tool ?? null; m.toolT = t; }
  const site = w.site;
  const work = site ? workSpot(site, f.spot) : HUB_SPOT(w, f.spot);
  const walkBindle = m.arriving ? 'bindle' : null;
  const base = (key: string, p: XZ & { yaw: number }, act: Act, gait: Gait = 'walk', walkAct: Act | null = null): Intent => ({
    key, x: p.x, z: p.z, yaw: p.yaw, act, walkAct: walkAct ?? walkBindle, gait, prop: propOf(act),
    walkProp: walkAct ? propOf(walkAct) : walkBindle,
  });

  // errands
  if (!m.errand && m.job === 'haul') m.errand = { kind: 'haul', leg: 0, t, dest: 'bin', once: false };
  if (!m.errand && m.job === 'fetch' && !pigeonPost(m.tool)) {
    m.n++;
    m.errand = { kind: 'fetch', leg: 0, t, dest: (m.n + Math.floor(m.k * 10)) % 2 ? 'mailbox' : 'well', once: false };
  }
  const e = m.errand;
  if (e) {
    const dest = w.stands?.[e.dest] ?? (e.dest === 'bin' ? at(w.bin, 1.3) : e.dest === 'mailbox' ? at(w.mailbox, 0.9) : at(w.well, 1.9));
    const next = (leg: Errand['leg']) => { e.leg = leg; e.t = t; };
    if (e.kind === 'haul') {
      switch (e.leg) {
        case 0: { // at the work spot: bend and pick up a crate
          const i = base('work', work, 'bend');
          i.prop = 'crate';
          if (arrived && t - e.t > 1.3) next(1);
          else if (!arrived) e.t = t;
          return i;
        }
        case 1: { // carry it to the shipping bin, drop it in
          const i = base(`bin`, dest, 'bend', 'walk', 'carry');
          i.prop = arrived && t - e.t > 0.6 ? null : 'crate';
          if (!arrived) e.t = t;
          if (arrived && t - e.t > 1.4) { cues.push('ship'); next(2); }
          return i;
        }
        case 2: { // walk back empty-handed
          const i = base('work', work, 'stand');
          if (arrived) { if (e.once) { m.errand = null; } else next(0); }
          return i;
        }
        default: m.errand = null;
      }
    } else {
      switch (e.leg) {
        case 0: {
          const i = base(`fetch:${e.dest}`, dest, 'bend');
          i.prop = arrived && t - e.t > 0.7 ? 'letter' : null;
          if (!arrived) e.t = t;
          if (arrived && t - e.t > 1.4) next(1);
          return i;
        }
        case 1: { // read it where it came from for a moment
          const i = base(`fetch:${e.dest}`, dest, 'read');
          if (t - e.t > 3.5) { cues.push('letter'); next(2); }
          return i;
        }
        case 2: { // walk back reading
          const i = base('work', work, 'read', 'walk', 'read');
          if (arrived) next(3);
          return i;
        }
        case 3: {
          const i = base('work', work, 'read');
          if (t - e.t > 7) m.errand = null;
          return i;
        }
      }
    }
  }

  switch (m.job) {
    case 'ask': {
      const p = site ? askSpot(site, f.spot) : HUB_SPOT(w, f.spot);
      return base('ask', p, 'ask', 'jog');
    }
    case 'done': {
      const p = site ? doneSpot(site, f.spot) : HUB_SPOT(w, f.spot);
      return base('done', p, 'done', 'walk');
    }
    case 'plan': {
      const p = site ? benchSpot(site, f.spot) : HUB_SPOT(w, f.spot);
      const i = base('bench', p, 'plan');
      if (site && f.spot % 3 === 0) {
        // the first bench spot has the plot's hay bale just behind it: climb up and sit on top
        const b = siteToWorld(site, -site.w / 2 + 1.8, -site.d / 2 + BALE.back);
        i.x = b.x; i.z = b.z; i.seatRel = BALE.h;
      }
      return i;
    }
    case 'water': {
      // walk slowly along the row with the can, back and forth
      const leg = Math.floor((t - m.jobT + m.k * 20) / 7) % 2;
      let p = work;
      if (site) {
        const lx = ((f.spot % 8) % 4 - 1.5) * (site.w / 5) + (leg ? 1.3 : -1.3);
        const lz = (f.spot % 8) < 4 ? -site.d * 0.18 : site.d * 0.12;
        const q = siteToWorld(site, lx, lz);
        p = { x: q.x, z: q.z, yaw: work.yaw };
      }
      return base('work', p, 'water', 'amble', 'water');
    }
    case 'idle':
    case 'away': {
      const kind = m.job === 'away' ? 'nap' : 'leisure';
      // on an outing between seats
      const outing = (): Intent | null => {
        const leg = kind === 'leisure' ? tripStep(m, w, pos, arrived, t, cues) : null;
        if (!leg) return null;
        const i = base(leg.key, leg, leg.act, leg.gait);
        i.prop = leg.prop ?? propOf(leg.act);
        return i;
      };
      if (m.trip) { const i = outing(); if (i) return i; }
      if (m.seat < 0 || t > m.seatUntil || (m.job === 'away') !== (w.seats[m.seat]?.kind === 'nap')) {
        // the dwell ran out: maybe stretch the legs first (never on the very first pick, so a new idler settles)
        if (kind === 'leisure' && m.seat >= 0 && !m.trip && wantsTrip(m, w, t)) {
          const trip = planTrip(m, f, w, pos, t);
          m.n++;
          if (trip) {
            w.release?.(f.id);
            m.seat = -1;
            m.trip = trip;
            const first = trip.legs[0];
            if (first.follow) cues.push(`hold:${first.follow}`);
            const i = outing();
            if (i) return i;
          }
        }
        m.seat = w.claim(f.id, kind, t);
        m.seatUntil = t + (kind === 'nap' ? 1e9 : 60 + ((m.k * 7919 + m.n * 0.618) % 1) * 100);
        m.n++;
        m.beat = -1;
      }
      const s = w.seats[m.seat];
      if (!s) return base('work', work, 'stand');
      const act = kind === 'nap' ? s.act : seatBeat(m, s, m.seat, w, arrived, t, cues);
      const i = base(`seat:${m.seat}`, s, act, 'amble');
      if (s.y !== undefined) i.seatY = s.y;
      return i;
    }
    case 'haul':
      return base('work', work, 'stand');
    case 'fetch':
      if (!pigeonPost(m.tool)) return base('work', work, 'stand');
      return base('work', work, workAct('fetch', w.plotKind, t - m.jobT, m.k, m.tool));
    default: {
      const act = workAct(m.job, w.plotKind, t - m.jobT, m.k, m.tool);
      return base('work', work, act);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Leisure seats

export interface BuiltSpot extends XZ { y: number; yaw: number; kind: string }
export interface SeatSource {
  /** real seats and anchors published by the structures package (optional: falls back to the hangouts) */
  built?: { seats: readonly BuiltSpot[]; get(name: string): BuiltSpot | null };
  hangouts: readonly (XZ & { kind: string })[];
  campfire: XZ;
  well: XZ;
  board: XZ;
  pond: XZ;
}

/** Build the leisure/nap seat list from the valley's hangouts. Each seat has a pose and a facing. */
export function buildSeats(src: SeatSource): Seat[] {
  const seats: Seat[] = [];
  const push = (s: Seat) => { seats.push(s); return seats.length - 1; };
  const b = src.built;
  const has = (k: string) => !!b && b.seats.some((x) => x.kind === k);
  if (b) {
    for (const st of b.seats) {
      const at = { x: st.x, z: st.z, y: st.y, yaw: st.yaw };
      switch (st.kind) {
        case 'fire': push({ ...at, act: 'campfire', kind: 'fire' }); break;
        // the leisure nooks (structures/nooks.ts)
        case 'checkers': push({ ...at, act: 'checkers', kind: 'checkers' }); break;
        case 'blanket': push({ ...at, act: 'picnic', kind: 'blanket', loop: 'blanket' }); break;
        case 'soak': push({ ...at, act: 'soak', kind: 'soak' }); break;
        case 'lookout': push({ ...at, act: 'sit', kind: 'lookout', loop: 'lookout' }); break;
        default: push({ ...at, act: 'sit', kind: st.kind === 'seat' ? 'porch' : 'bench' });
      }
    }
    // the paired nook seats are published two by two, facing each other
    for (const k of PAIRED) {
      const idx = seats.map((s, i) => (s.kind === k ? i : -1)).filter((i) => i >= 0);
      for (let i = 0; i + 1 < idx.length; i += 2) { seats[idx[i]].pair = idx[i + 1]; seats[idx[i + 1]].pair = idx[i]; }
    }
    const tel = b.get('telescope');
    if (tel) push({ x: tel.x, z: tel.z, yaw: tel.yaw, act: 'telescope', kind: 'telescope' });
    const ham = b.get('hammock');
    if (ham) push({ x: ham.x, z: ham.z, y: ham.y, yaw: ham.yaw, act: 'lie', kind: 'nap' });
    // dozing against the round bales in the hay meadow (structures/countryside.ts)
    for (let i = 0; ; i++) { const h = b.get(`haymeadow:nap:${i}`); if (!h) break; push({ x: h.x, z: h.z, y: h.y, yaw: h.yaw, act: 'nap', kind: 'nap' }); }
    const dock = b.get('dockEnd');
    if (dock) push({ x: dock.x, z: dock.z, y: dock.y, yaw: dock.yaw, act: 'fish', kind: 'fish' });
  }
  for (const h of src.hangouts) {
    if (h.kind === 'fire' && has('fire')) continue;
    if (h.kind === 'fish' && b?.get('dockEnd') && Math.hypot(h.x - b.get('dockEnd')!.x, h.z - b.get('dockEnd')!.z) < 5) continue;
    switch (h.kind) {
      case 'fire': {
        // two logs per spot, facing the fire
        for (const off of [-0.8, 0.8]) {
          const dx = h.x - src.campfire.x, dz = h.z - src.campfire.z, l = Math.hypot(dx, dz) || 1;
          const x = h.x + (-dz / l) * off, z = h.z + (dx / l) * off;
          push({ x, z, yaw: faceYaw({ x, z }, src.campfire), act: 'campfire', kind: 'fire' });
        }
        break;
      }
      case 'fish': push({ x: h.x, z: h.z, yaw: faceYaw(h, src.pond), act: 'fish', kind: 'fish' }); break;
      case 'well': {
        push({ x: h.x, z: h.z, yaw: faceYaw(h, src.well), act: 'lean', kind: 'well' });
        break;
      }
      case 'board': {
        for (const off of [-0.7, 0.7]) push({ x: h.x, z: h.z + off, yaw: faceYaw(h, src.board), act: 'board', kind: 'board' });
        break;
      }
      case 'porch': {
        push({ x: h.x, z: h.z, yaw: 0, act: 'sitground', kind: 'porch' });
        push({ x: h.x + 0.1, z: h.z + 0.2, yaw: 0.2, act: 'nap', kind: 'nap' });
        break;
      }
      case 'meadow': {
        push({ x: h.x, z: h.z, yaw: 1.2, act: 'lie', kind: 'meadow' });
        push({ x: h.x + 2.2, z: h.z + 1, yaw: -0.8, act: 'sitground', kind: 'meadow' });
        push({ x: h.x - 1.5, z: h.z + 2.4, yaw: 2.5, act: 'lie', kind: 'nap' });
        push({ x: h.x + 1.8, z: h.z - 2.2, yaw: 0.4, act: 'nap', kind: 'nap' });
        break;
      }
      default: push({ x: h.x, z: h.z, yaw: 0, act: 'stand', kind: h.kind });
    }
  }
  // chat corners: pairs of standing seats facing each other
  const chats: XZ[] = [{ x: 7, z: 12 }, { x: -6, z: 7 }, { x: 10, z: -4 }, { x: -3, z: 14 }, { x: 20, z: 26 }, { x: -18, z: 8 }];
  for (const c of chats) {
    const a = push({ x: c.x - 0.65, z: c.z, yaw: Math.PI / 2, act: 'chat', kind: 'chat' });
    const b = push({ x: c.x + 0.65, z: c.z, yaw: -Math.PI / 2, act: 'chat', kind: 'chat' });
    seats[a].pair = b;
    seats[b].pair = a;
  }
  return seats;
}

/** seats that come in pairs (a partner waiting there is an invitation) */
const PAIRED = ['chat', 'checkers', 'blanket'] as const;
/** the liked-kind a seat kind counts as */
const likeOf = (kind: string): string => (kind === 'telescope' ? 'lookout' : kind);
/** preference shift per seat kind at full night: the fire and the stars after dark, the blanket and the river by day */
const NIGHT: Readonly<Record<string, number>> = { fire: 1.6, lookout: 1.8, telescope: 1.8, soak: 0.8, blanket: -2, fish: -1, meadow: -1.5, board: -1, chat: -0.4 };

/**
 * Pick a seat for `kind`: prefer the farmer's liked kinds, prefer joining a waiting partner at a chat corner, the
 * checkers table or the picnic blanket (chatty farmers), shift with the time of day, prefer nearer seats (`from`),
 * never a taken seat. `occ` maps seat index → farmer id. Deterministic given `r`.
 */
export function pickSeat(seats: readonly Seat[], occ: ReadonlyMap<number, string>, id: string, kind: 'leisure' | 'nap', likes: readonly string[], chatty: number, r: () => number, avoid = -1, night = 0, from?: XZ): number {
  const free = (i: number) => seats[i].kind !== 'off' && (!occ.has(i) || occ.get(i) === id);
  if (kind === 'nap') {
    const naps = seats.map((s, i) => i).filter((i) => seats[i].kind === 'nap' && free(i));
    if (naps.length) return naps[Math.floor(r() * naps.length)];
    const any = seats.map((s, i) => i).filter((i) => free(i));
    return any.length ? any[0] : 0;
  }
  // a lonely chatter waiting for company?
  if (r() < 0.35 + chatty * 0.5) {
    for (let i = 0; i < seats.length; i++) {
      const s = seats[i];
      if ((PAIRED as readonly string[]).includes(s.kind) && s.pair !== undefined && free(i) && occ.has(s.pair) && occ.get(s.pair) !== id && i !== avoid) return i;
    }
  }
  const score = (i: number) => {
    const s = seats[i];
    const li = likes.indexOf(likeOf(s.kind));
    let v = li < 0 ? 1 : 3 - li * 0.4;
    if (s.kind === 'chat') v = 1 + chatty * 1.5;
    v += (NIGHT[s.kind] ?? 0) * night;
    // a long trek across the valley needs a better reason than a short stroll
    if (from) v -= Math.hypot(s.x - from.x, s.z - from.z) / 70;
    if (s.kind === 'nap') v = -10;
    if (i === avoid) v -= 5;
    return v + r() * 1.5;
  };
  let best = -1, bv = -Infinity;
  for (let i = 0; i < seats.length; i++) {
    if (!free(i)) continue;
    const v = score(i);
    if (v > bv) { bv = v; best = i; }
  }
  return best < 0 ? 0 : best;
}
