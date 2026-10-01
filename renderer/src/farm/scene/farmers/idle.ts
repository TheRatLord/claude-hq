// @pure
/**
 * What an idle farmer does with its time (brain.ts calls in here for the 'idle' job):
 *
 *  - **Seat loops.** A leisure seat is not one frozen pose: each kind of seat plays a little loop of beats that varies
 *    over time (fishing: wait for a bite → reel in → hold up the catch, sometimes a miss; the campfire: warm the nubs
 *    → toast a marshmallow; a bench: sit → read a book, or stargaze at night; the checkers table: take turns with the
 *    player opposite). Beats can depend on day / night and on company (someone within a few metres): chat when there
 *    is someone to chat with, play alone otherwise. Every beat of a loop keeps the same footing (all seated on the
 *    seat, or all standing), so the springs blend them without the farmer hopping off its seat.
 *  - **Outings.** When a seat's dwell runs out, a restless farmer may take a short trip before settling again: a
 *    stroll to a viewpoint or two, checking the mailbox, a look at its own field, petting the village dog / cat or one
 *    of its field's animals, or dropping in on a friend sitting somewhere for a chat.
 *
 * Pure: no three, no clock; deterministic given the inputs (random choices hash the farmer's phase and the time).
 */
import type { FarmerView } from '../../model/types.ts';
import type { XZ } from '../../world/map.ts';
import { askSpot, workSpot } from '../../world/spots.ts';
import type { Act, Prop } from './pose.ts';
import type { Gait, Mind, Seat, World } from './brain.ts';

/** a creature an idle farmer may walk up to and pet (the village pets, its own field's animals) */
export interface Critter extends XZ {
  /** 'pet:dog', 'pet:cat', 'animal:<plotId>:<animalId>' */
  id: string;
  /** stand-off distance for petting (body sizes) */
  reach: number;
  /** calm and available (not playing with the player, not mid-fence-walk) */
  free: boolean;
}
/** another idle farmer settled somewhere, who might like a visitor */
export interface Friend extends XZ { id: string }

export type TripKind = 'stroll' | 'mail' | 'field' | 'pet' | 'visit';
export interface Leg {
  key: string;
  x: number;
  z: number;
  yaw: number;
  act: Act;
  /** seconds to stay once there */
  dur: number;
  gait: Gait;
  prop: Prop | null;
  /** keep walking toward this critter / friend while it moves (re-read from the world each step) */
  follow?: string;
  /** one-shot cue for the system on arrival ('pet:dog', 'letter' …) */
  cue?: string;
}
export interface Trip { kind: TripKind; legs: Leg[]; i: number; /** when the current leg began / was reached (−1 = walking) */ since: number; at: number }

export interface Beat { act: Act; min: number; max: number; /** chance the beat plays when its turn comes */ p?: number; when?: 'day' | 'night' | 'company' | 'alone' }

/** Seat loops by loop name (a seat's `loop`, else its act). */
export const LOOPS: Readonly<Record<string, readonly Beat[]>> = {
  fish: [{ act: 'fish', min: 14, max: 32 }, { act: 'reel', min: 2.5, max: 3.5 }, { act: 'catch', min: 3.5, max: 4.5, p: 0.55 }],
  campfire: [{ act: 'campfire', min: 16, max: 30 }, { act: 'toast', min: 9, max: 15, p: 0.75 }, { act: 'sitchat', min: 8, max: 14, when: 'company' }],
  sit: [{ act: 'sit', min: 14, max: 26 }, { act: 'sitread', min: 18, max: 34, when: 'day' }, { act: 'sitchat', min: 8, max: 14, when: 'company' }],
  sitground: [{ act: 'sitground', min: 14, max: 26 }, { act: 'sitread', min: 16, max: 30, p: 0.6, when: 'day' }],
  lie: [{ act: 'lie', min: 20, max: 40 }, { act: 'sitground', min: 10, max: 18 }],
  lean: [{ act: 'lean', min: 12, max: 24 }, { act: 'gaze', min: 6, max: 10 }],
  board: [{ act: 'board', min: 10, max: 18 }, { act: 'gaze', min: 4, max: 7, p: 0.5 }],
  blanket: [{ act: 'picnic', min: 12, max: 22 }, { act: 'sitchat', min: 10, max: 18, when: 'company' }, { act: 'sitground', min: 8, max: 14, when: 'alone' }, { act: 'lie', min: 12, max: 20, p: 0.35 }],
  soak: [{ act: 'soak', min: 18, max: 34 }, { act: 'sitchat', min: 8, max: 14, when: 'company' }],
  lookout: [{ act: 'sit', min: 10, max: 18, when: 'day' }, { act: 'sitread', min: 16, max: 28, when: 'day' }, { act: 'stargaze', min: 18, max: 34, when: 'night' }, { act: 'sitchat', min: 8, max: 12, when: 'company' }],
  telescope: [{ act: 'telescope', min: 10, max: 20 }, { act: 'gaze', min: 5, max: 9 }],
  checkers: [{ act: 'checkers', min: 6, max: 9 }, { act: 'ponder', min: 5, max: 8 }],
};
/** seconds per turn at the checkers table (both players share the clock, so they alternate) */
export const TURN = 7;

/** deterministic 0..1 hash */
export const hashR = (a: number, b: number): number => { const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return v - Math.floor(v); };
const faceYaw = (from: XZ, to: XZ) => Math.atan2(to.x - from.x, to.z - from.z);

/**
 * The act a farmer plays at seat `idx` right now: advances the seat's loop when the current beat runs out.
 * Pushes `beat:<act>` cues when a new beat starts (catch splash, a checkers tap…).
 */
export function seatBeat(m: Mind, s: Seat, idx: number, w: World, arrived: boolean, t: number, cues: string[]): Act {
  const prog = LOOPS[s.loop ?? s.act];
  if (!prog) return s.act;
  const company = !!w.company?.(idx);
  const night = (w.night ?? 0) > 0.5;
  // two players at the board take turns on a shared clock
  if (s.kind === 'checkers' && company && s.pair !== undefined) {
    const act: Act = Math.floor(t / TURN) % 2 === (idx < s.pair ? 0 : 1) ? 'checkers' : 'ponder';
    if (act !== m.beatAct && arrived) cues.push(`beat:${act}`);
    m.beatAct = act;
    return act;
  }
  const holds = (b: Beat) => !b.when || (b.when === 'day' ? !night : b.when === 'night' ? night : b.when === 'company' ? company : !company);
  if (!arrived || m.beat < 0) {
    // on the way (or just arrived at a new seat): the loop starts at its first beat that fits
    const j = Math.max(0, prog.findIndex(holds));
    m.beat = arrived ? j : -1;
    m.beatAct = prog[j].act;
    m.beatUntil = t + prog[j].min + hashR(m.k * 31 + m.n, j) * (prog[j].max - prog[j].min);
    return prog[j].act;
  }
  // a conditional beat whose condition lapsed (night fell, the friend left) ends early
  const cur = prog[m.beat];
  if (t >= m.beatUntil || (cur && !holds(cur))) {
    for (let n = 1; n <= prog.length; n++) {
      const j = (m.beat + n) % prog.length, b = prog[j];
      if (!holds(b) || (b.p !== undefined && hashR(m.k * 97 + m.n * 13.1 + j, Math.floor(t * 10)) >= b.p)) continue;
      m.beat = j;
      m.beatAct = b.act;
      m.beatUntil = t + b.min + hashR(m.k * 53 + m.n + j, Math.floor(t)) * (b.max - b.min);
      cues.push(`beat:${b.act}`);
      break;
    }
    if (t >= m.beatUntil) m.beatUntil = t + 5; // nothing fits (cannot happen with a first beat that always holds): hold on
  }
  return m.beatAct ?? s.act;
}

/** Does the farmer take an outing now (its seat dwell just ran out)? Restless farmers wander more. */
export function wantsTrip(m: Mind, w: World, t: number): boolean {
  return hashR(m.k * 7.7 + m.n * 0.37, Math.floor(t)) < 0.28 + (w.restless ?? 0.5) * 0.35;
}

const stand = (target: XZ, from: XZ, reach: number): { x: number; z: number; yaw: number } => {
  const dx = from.x - target.x, dz = from.z - target.z, l = Math.hypot(dx, dz) || 1;
  const x = target.x + (dx / l) * reach, z = target.z + (dz / l) * reach;
  return { x, z, yaw: faceYaw({ x, z }, target) };
};

/** Plan a short outing from `pos`, or null if nothing fits. */
export function planTrip(m: Mind, f: Pick<FarmerView, 'spot'>, w: World, pos: XZ, t: number): Trip | null {
  const r = (i: number) => hashR(m.k * 1000 + m.n * 7.31 + i, Math.floor(t));
  const near = (p: XZ, d: number) => Math.hypot(p.x - pos.x, p.z - pos.z) < d;
  const critters = (w.critters?.() ?? []).filter((c) => c.free && near(c, 55));
  const friends = (w.friends?.() ?? []).filter((q) => near(q, 45));
  const views = (w.views ?? []).filter((v) => near(v, 75));
  const opts: [TripKind, number][] = [];
  if (critters.length) opts.push(['pet', 1.3]);
  if (friends.length) opts.push(['visit', 0.6 + (w.chatty ?? 0.5)]);
  if (w.site) opts.push(['field', 1.0]);
  opts.push(['mail', 0.5]);
  if (views.length) opts.push(['stroll', 1.0]);
  let u = r(0) * opts.reduce((a, [, wt]) => a + wt, 0), kind: TripKind = opts[0][0];
  for (const [k, wt] of opts) { if (u < wt) { kind = k; break; } u -= wt; }
  const leg = (key: string, p: { x: number; z: number; yaw: number }, act: Act, dur: number, extra: Partial<Leg> = {}): Leg =>
    ({ key, x: p.x, z: p.z, yaw: p.yaw, act, dur, gait: 'amble', prop: null, ...extra });
  const trip = (legs: Leg[]): Trip => ({ kind, legs, i: 0, since: t, at: -1 });
  switch (kind) {
    case 'pet': {
      const c = critters[Math.floor(r(1) * critters.length) % critters.length];
      const p = stand(c, pos, c.reach);
      return trip([leg(`trip:pet:${c.id}`, p, 'pet', 6 + r(2) * 4, { follow: c.id, cue: `pet:${c.id}` }), leg(`trip:pet:${c.id}`, p, 'gaze', 2.5)]);
    }
    case 'visit': {
      const q = friends[Math.floor(r(1) * friends.length) % friends.length];
      const p = stand(q, pos, 1.45);
      return trip([leg(`trip:visit:${q.id}`, p, 'chat', 12 + r(2) * 10, { follow: q.id })]);
    }
    case 'field': {
      const s = w.site!;
      const a = workSpot(s, f.spot), g = askSpot(s, f.spot);
      return trip([leg('trip:field', a, 'inspect', 7 + r(1) * 5, { prop: 'magnifier' }), leg('trip:gate', g, 'gaze', 4 + r(2) * 3)]);
    }
    case 'mail': {
      const mb = w.stands?.mailbox ?? (() => { const b = w.mailbox; return { x: b.x + Math.sin(b.yaw) * 0.9, z: b.z + Math.cos(b.yaw) * 0.9, yaw: b.yaw + Math.PI }; })();
      return trip([leg('trip:mail', mb, 'bend', 1.6), leg('trip:mail', mb, 'read', 4.5 + r(1) * 2, { prop: 'letter', cue: 'letter' })]);
    }
    case 'stroll': {
      const pick = views.map((v, i) => ({ v, s: Math.hypot(v.x - pos.x, v.z - pos.z) * (0.6 + r(10 + i)) })).sort((a, b) => a.s - b.s);
      const n = r(1) < 0.4 && pick.length > 1 ? 2 : 1;
      return trip(pick.slice(0, n).map(({ v }, i) => leg(`trip:view:${i}:${Math.round(v.x)},${Math.round(v.z)}`, v, 'gaze', 7 + r(2 + i) * 5)));
    }
  }
}

/**
 * One step of an outing: the leg to walk to / act at now, or null when the trip is over (or fell through: the
 * critter wandered off too far). Arrival counts only a moment after a leg begins (the mover reports `arrived` for the
 * previous key on the first step of a new one).
 */
export function tripStep(m: Mind, w: World, pos: XZ, arrived: boolean, t: number, cues: string[]): Leg | null {
  const tr = m.trip;
  if (!tr) return null;
  const leg = tr.legs[tr.i];
  if (!leg) { m.trip = null; return null; }
  if (leg.follow && tr.at < 0) {
    const c = leg.follow.startsWith('pet:') || leg.follow.startsWith('animal:') ? w.critters?.().find((q) => q.id === leg.follow) : w.friends?.().find((q) => q.id === leg.follow);
    if (!c || Math.hypot(c.x - pos.x, c.z - pos.z) > 70 || t - tr.since > 90) { m.trip = null; return null; }
    const p = stand(c, pos, (c as Partial<Critter>).reach ?? 1.45);
    // chase it while walking (the mover re-routes when the point moves > 1 m)
    for (const l of tr.legs) if (l.key === leg.key) { l.x = p.x; l.z = p.z; l.yaw = p.yaw; }
  }
  const there = arrived && t - tr.since > 0.25;
  if (there && tr.at < 0) { tr.at = t; if (leg.cue) cues.push(leg.cue); }
  if (tr.at >= 0 && t - tr.at > leg.dur) {
    tr.i++;
    tr.since = t;
    const next = tr.legs[tr.i];
    if (!next) { m.trip = null; return null; }
    // a follow-up leg at the same spot starts at once
    tr.at = next.key === leg.key ? t : -1;
    if (tr.at >= 0 && next.cue) cues.push(next.cue);
    return next;
  }
  return leg;
}
