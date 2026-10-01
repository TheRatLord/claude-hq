import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTS, ACT_INFO, SEAT_H } from './pose.ts';
import type { Act } from './pose.ts';
import { buildSeats, newMind, pickSeat, plan } from './brain.ts';
import type { BuiltSpot, Intent, World } from './brain.ts';
import { LOOPS, TURN, seatBeat } from './idle.ts';
import type { Critter, Friend } from './idle.ts';
import { HANGOUTS, POND, SITES, structure } from '../../world/map.ts';
import type { FarmerView, Job } from '../../model/types.ts';

const view = (job: Job, id = 'f1'): FarmerView => ({
  id, name: 'x', kind: 'claude', seed: id, tier: 'opus', plotId: 'p', spot: 0, status: 'working', job, jobSince: 0, rawJob: job, detail: '',
  title: null, needsYou: false, unseenDone: false, struggle: 0, mood: 'happy', busy: 0, ducklings: [], said: null, question: null,
  options: [], todos: null, work: null, context: null, lastActive: 0,
});

/** a valley's worth of built seats: the campfire, a bench, the nooks (paired kinds two by two) and the telescope */
const BUILT: BuiltSpot[] = [
  { x: 24, y: 1, z: 31, yaw: 0, kind: 'fire' }, { x: -6, y: 0.5, z: 8, yaw: 0, kind: 'bench' },
  { x: 22, y: 3, z: -6, yaw: 1.57, kind: 'checkers' }, { x: 24, y: 3, z: -6, yaw: -1.57, kind: 'checkers' },
  { x: 3, y: 0.5, z: 18.6, yaw: 0, kind: 'blanket' }, { x: 3, y: 0.5, z: 20.3, yaw: 3.14, kind: 'blanket' },
  { x: 66, y: 10.6, z: -25, yaw: 0, kind: 'lookout' }, { x: -43, y: 2.1, z: 56, yaw: 0, kind: 'soak' },
];
const ANCHORS: Record<string, BuiltSpot> = { telescope: { x: 67, y: 10.3, z: -23, yaw: -1.2, kind: 'telescope' }, dockEnd: { x: 38, y: -0.3, z: 41, yaw: 0.35, kind: 'fish' } };
const seats = buildSeats({ hangouts: HANGOUTS, campfire: structure('campfire'), well: structure('well'), board: structure('noticeboard'), pond: POND, built: { seats: BUILT, get: (n) => ANCHORS[n] ?? null } });
const idx = (kind: string) => seats.findIndex((s) => s.kind === kind);

function world(over: Partial<World> = {}): World {
  const occ = new Map<number, string>();
  return {
    site: SITES[0], plotKind: 'cows', bin: structure('shippingBin'), mailbox: structure('mailbox'), well: structure('well'), exit: { x: 0, z: 80 }, hub: { x: 0, z: 0 }, seats,
    claim: (id, kind, t) => { const i = pickSeat(seats, occ, id, kind, ['fire'], 0.5, () => ((t * 7.13) % 1)); occ.set(i, id); return i; },
    release: (id) => { for (const [i, v] of occ) if (v === id) occ.delete(i); },
    ...over,
  };
}

test('every leisure loop uses known acts and keeps one footing (all on the seat, or all standing)', () => {
  for (const [name, prog] of Object.entries(LOOPS)) {
    assert.ok(prog.length >= 2, `${name} loops`);
    const seated = prog.map((b) => SEAT_H[b.act] !== undefined);
    for (const b of prog) assert.ok((ACTS as readonly string[]).includes(b.act), `${name}: ${b.act}`);
    assert.ok(seated.every((x) => x === seated[0]), `${name} mixes seated and standing beats`);
    assert.ok(prog[0].when === undefined || prog.some((b) => b.when === undefined) || name === 'lookout', `${name} has a beat that always plays`);
    for (const b of prog) assert.ok(b.min > 0 && b.max >= b.min);
  }
  // the new nook seats are wired to their loops; paired kinds are paired facing each other
  for (const k of ['checkers', 'blanket', 'soak', 'lookout', 'telescope']) assert.ok(idx(k) >= 0, k);
  for (const k of ['checkers', 'blanket']) { const i = idx(k); assert.equal(seats[seats[i].pair!].pair, i); assert.equal(seats[seats[i].pair!].kind, k); }
});

/** run one farmer at one seat for `secs`, return the act timeline */
function runSeat(seat: number, secs: number, w: World, k = 0.3, t0 = 0): Act[] {
  const m = newMind('idle', 0, k);
  m.seat = seat;
  const acts: Act[] = [];
  for (let t = t0; t < t0 + secs; t += 0.1) acts.push(seatBeat(m, seats[seat], seat, w, t > t0 + 0.5, t, []));
  return acts;
}
const kinds = (acts: Act[]) => new Set(acts);
const changes = (acts: Act[]) => acts.reduce((n, a, i) => n + (i && a !== acts[i - 1] ? 1 : 0), 0);

test('a fishing spot cycles: wait for a bite, reel in, sometimes a catch; never frantic', () => {
  const fish = idx('fish');
  const acts = runSeat(fish, 600, world());
  assert.deepEqual([...kinds(acts)].sort(), ['catch', 'fish', 'reel']);
  // beats last seconds, not frames: at most one change every ~4 s on average
  assert.ok(changes(acts) < 600 / 4, `${changes(acts)} changes`);
  assert.ok(changes(acts) > 10);
});

test('beats follow company and the hour: chat only with someone there, stars only after dark', () => {
  const blanket = idx('blanket'), bench = idx('lookout');
  assert.ok(!kinds(runSeat(blanket, 400, world({ company: () => false }))).has('sitchat'));
  assert.ok(kinds(runSeat(blanket, 400, world({ company: () => true }))).has('sitchat'));
  const day = kinds(runSeat(bench, 400, world({ night: 0 }))), night = kinds(runSeat(bench, 400, world({ night: 1 })));
  assert.ok(!day.has('stargaze') && day.has('sitread'));
  assert.ok(night.has('stargaze') && !night.has('sitread'));
});

test('two farmers at the checkers table take turns on a shared clock', () => {
  const a = idx('checkers'), b = seats[a].pair!;
  const w = world({ company: () => true });
  const ma = newMind('idle', 0, 0.1), mb = newMind('idle', 0, 0.8);
  let turns = 0;
  for (let t = 0; t < 120; t += 0.5) {
    const x = seatBeat(ma, seats[a], a, w, true, t, []), y = seatBeat(mb, seats[b], b, w, true, t, []);
    assert.notEqual(x, y, `both ${x} at t=${t}`);
    assert.ok(['checkers', 'ponder'].includes(x));
    if (x === 'checkers' && Math.floor(t / TURN) !== Math.floor((t - 0.5) / TURN)) turns++;
  }
  assert.ok(turns >= 6);
});

test('seat choice: the fire and the stars after dark, the blanket by day; a waiting partner is joined', () => {
  const likes = ['blanket', 'fire', 'lookout'];
  const occ = new Map<number, string>();
  const pick = (night: number) => seats[pickSeat(seats, occ, 'me', 'leisure', likes, 0, () => 0.5, -1, night)].kind;
  assert.equal(pick(0), 'blanket');
  assert.ok(['fire', 'lookout', 'telescope'].includes(pick(1)), pick(1));
  // someone is waiting at the checkers table: a chatty farmer sits down opposite
  const c = idx('checkers');
  occ.set(c, 'friend');
  assert.equal(pickSeat(seats, occ, 'me', 'leisure', likes, 1, () => 0.1), seats[c].pair);
});

/** a toy mover: walks to each new intent in a couple of seconds */
function simulate(secs: number, w: World, job: (t: number) => Job = () => 'idle', k = 0.42) {
  const m = newMind('idle', 0, k);
  let pos = { x: 0, z: 10 }, key = '', since = 0, arrived = false;
  const log: { t: number; i: Intent; cues: string[] }[] = [];
  for (let t = 0; t < secs; t += 0.1) {
    const cues: string[] = [];
    const i = plan(m, view(job(t)), w, pos, arrived, t, cues);
    if (i.key !== key) { key = i.key; since = t; arrived = false; }
    if (!arrived && t - since > 2) { arrived = true; pos = { x: i.x, z: i.z }; }
    log.push({ t, i, cues });
  }
  return { m, log };
}

test('restless idlers take outings between seats: stroll, mailbox, own field, petting, visiting a friend', () => {
  const critters = (): Critter[] => [{ id: 'pet:dog', x: 5, z: 5, reach: 0.95, free: true }];
  const friends = (): Friend[] => [{ id: 'f2', x: -3, z: 14 }];
  const w = world({ restless: 1, critters, friends, views: [{ x: 10, z: 10, yaw: 0 }, { x: -20, z: 5, yaw: 1 }], company: () => false });
  // three farmers of different temperament, an hour each
  const log = [0.42, 0.13, 0.77].flatMap((k) => simulate(3600, w, () => 'idle', k).log);
  const trips = new Set(log.map((e) => e.i.key.split(':').slice(0, 2).join(':')).filter((k) => k.startsWith('trip:')));
  for (const k of ['trip:pet', 'trip:mail', 'trip:field', 'trip:view', 'trip:visit']) assert.ok(trips.has(k), `${k} in ${[...trips]}`);
  // a pet trip asks the dog to wait, then pets it on arrival, and the farmer settles on a seat afterwards
  const cues = log.flatMap((e) => e.cues);
  assert.ok(cues.includes('hold:pet:dog') && cues.includes('pet:pet:dog'));
  assert.ok(cues.indexOf('hold:pet:dog') < cues.indexOf('pet:pet:dog'));
  const lastPet = log.map((e) => e.i.key).lastIndexOf('trip:pet:pet:dog');
  assert.ok(log.slice(lastPet).some((e) => e.i.key.startsWith('seat:')));
  // outings are interludes: most of the time is still spent on seats
  const seated = log.filter((e) => e.i.key.startsWith('seat:')).length / log.length;
  assert.ok(seated > 0.6, `seated ${seated}`);
});

test('the petting walk follows a moving critter; a gone critter ends the outing', () => {
  let dog = { x: 6, z: 6 };
  let gone = false;
  const w = world({ restless: 1, critters: () => (gone ? [] : [{ id: 'pet:dog', x: dog.x, z: dog.z, reach: 1, free: true }]), views: [], company: () => false });
  const m = newMind('idle', 0, 0.42);
  m.trip = { kind: 'pet', legs: [{ key: 'trip:pet:pet:dog', x: 0, z: 0, yaw: 0, act: 'pet', dur: 5, gait: 'amble', prop: null, follow: 'pet:dog', cue: 'pet:pet:dog' }], i: 0, since: 0, at: -1 };
  const a = plan(m, view('idle'), w, { x: 0, z: 0 }, false, 1, []);
  dog = { x: 12, z: 2 };
  const b = plan(m, view('idle'), w, { x: 0, z: 0 }, false, 1.1, []);
  assert.ok(Math.hypot(a.x - 6, a.z - 6) < 1.1 && Math.hypot(b.x - 12, b.z - 2) < 1.1);
  assert.equal(b.act, 'pet');
  gone = true;
  const c = plan(m, view('idle'), w, { x: 0, z: 0 }, false, 1.2, []);
  assert.equal(m.trip, null);
  assert.ok(c.key.startsWith('seat:'));
});

test('work, needs-you and napping are untouched by idle life', () => {
  const w = world({ restless: 1, critters: () => [{ id: 'pet:dog', x: 5, z: 5, reach: 1, free: true }], views: [{ x: 10, z: 10, yaw: 0 }] });
  // a job change mid-outing drops the outing at once
  const { m, log } = simulate(900, w, (t) => (t < 600 ? 'idle' : t < 700 ? 'ask' : 'plant'));
  assert.equal(m.trip, null);
  for (const e of log.filter((x) => x.t > 600.2 && x.t < 700)) assert.equal(e.i.act, 'ask');
  for (const e of log.filter((x) => x.t > 700.2)) assert.ok(!e.i.key.startsWith('trip:') && !e.i.key.startsWith('seat:'));
  // away farmers nap and never wander off
  const away = simulate(1200, w, () => 'away');
  assert.ok(away.log.every((e) => !e.i.key.startsWith('trip:') && ['nap', 'lie', 'sitground', 'sit', 'stand'].includes(e.i.act)));
  for (const a of ['reel', 'catch', 'toast', 'sitread', 'sitchat', 'picnic', 'stargaze', 'checkers', 'ponder', 'soak'] as const) assert.ok(ACT_INFO[a].grounded, a);
});

