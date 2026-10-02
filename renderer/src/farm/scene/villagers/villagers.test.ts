import { test } from 'node:test';
import { almanacView, emptyAlmanac } from '../../model/almanac.ts';
import assert from 'node:assert/strict';
import { CAST, villagerLook } from './cast.ts';
import type { Villager } from './cast.ts';
import { entryAt, hoursInto, nextBeat, roundStop, stormy } from './schedule.ts';
import { fairCond, placeIndoors, planFor } from '../../model/routines.ts';
import { festivalAt } from '../../model/calendar.ts';
import { brief, callOut, clock, lineFor, partOfDay, shipLine } from './lines.ts';
import { KIND_COLORS, ROLE_HAT_NAMES, WEAR_NAMES, roleHat, wear } from '../farmers/mascots.ts';
import { ACTS } from '../farmers/pose.ts';
import { STRUCTURE_IDS } from '../../world/map.ts';
import type { FarmerView, Letter, PlotView, ValleyState } from '../../model/types.ts';

const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const dist = (a: number, b: number) => { const [r1, g1, b1] = rgb(a), [r2, g2, b2] = rgb(b); return Math.hypot(r1 - r2, g1 - g2, b1 - b2); };

test('the cast: 4–6 villagers, unique ids / names / colours, never an agent colour', () => {
  assert.ok(CAST.length >= 4 && CAST.length <= 6);
  assert.equal(new Set(CAST.map((v) => v.id)).size, CAST.length);
  assert.equal(new Set(CAST.map((v) => v.name)).size, CAST.length);
  for (const v of CAST) {
    assert.ok(v.id.startsWith('villager:'), v.id);
    for (const k of Object.values(KIND_COLORS)) assert.ok(dist(v.color, k.body) > 60, `${v.name} too close to an agent colour`);
    for (const w of CAST) if (w !== v) assert.ok(dist(v.color, w.color) > 50, `${v.name} vs ${w.name}`);
  }
  assert.equal(new Set(CAST.map((v) => v.hat)).size, CAST.length, 'each role has its own hat');
});

test('villager looks: Clawd bodies with a role hat and wear; every hat / wear builds', () => {
  for (const v of CAST) {
    const l = villagerLook(v);
    assert.equal(l.body, 'clawd');
    assert.equal(l.roleHat, v.hat);
    assert.equal(l.wear, v.wear);
    assert.equal(l.star, false);
  }
  for (const h of ROLE_HAT_NAMES) assert.ok(roleHat(h, 1).cells.size > 20, h);
  for (const w of WEAR_NAMES) assert.ok(wear(w, 1).boxes.length > 3, w);
});

test('places reference real structures / project sites and acts; every place a plan can take them to is in the cast', () => {
  const check = (v: Villager, p: { at: string; loop: readonly { act: string; min: number; max: number }[] }) => {
    assert.ok(p.at === 'xz' || (STRUCTURE_IDS as readonly string[]).includes(p.at) || /^project:(glasshouse|millwheel|observatory|halt|board)$/.test(p.at), `${v.name}: ${p.at}`);
    assert.ok(p.loop.length > 0);
    for (const b of p.loop) { assert.ok((ACTS as readonly string[]).includes(b.act), b.act); assert.ok(b.max >= b.min && b.min > 0); }
  };
  const conds = [fairCond(), fairCond({ weather: 'rain', intensity: 0.6 }), fairCond({ season: 'winter' }), fairCond({ festival: 'harvest' }), fairCond({ dow: 0 }),
    fairCond({ restored: ['glasshouse', 'millwheel', 'observatory', 'halt'] })];
  for (const v of CAST) {
    for (const p of Object.values(v.places)) if (p) check(v, p);
    assert.ok(v.places.shelter.indoors, `${v.name} shelters indoors`);
    for (const c of conds) for (const e of planFor(v.id, c)) {
      for (const k of [e.place, ...(e.stops ?? [])]) assert.ok(v.places[k], `${v.name} has no place for "${k}"`);
      // where the plan says indoors, the cast agrees (and the other way round)
      assert.equal(!!v.places[e.place]?.indoors, placeIndoors(e.place), `${v.name}: ${e.place} indoors?`);
    }
  }
});

test('day plan: cyclic across midnight, jittered a little per day', () => {
  const day = planFor('posy', fairCond());
  const kind = (h: number, d = 0, k = 0) => day[entryAt(day, h, d, k)].kind;
  assert.equal(kind(9), 'work');
  assert.equal(kind(12.5), 'lunch');
  assert.equal(kind(20), 'evening');
  assert.equal(kind(23), 'sleep');
  assert.equal(kind(3), 'sleep', 'wraps past midnight');
  // jitter moves boundaries by at most ±0.3 h and differs between days
  const starts = new Set<number>();
  for (let d = 0; d < 20; d++) {
    for (let h = 7.4; h < 11.6; h += 0.05) assert.equal(kind(h, d, 42), 'work', `day ${d} ${h}`);
    for (let h = 6.5; h < 7.4; h += 0.01) if (kind(h, d, 42) === 'work') { starts.add(Math.round(h * 100)); break; }
  }
  assert.ok(starts.size > 3, 'the morning start varies by day');
});

test('storms', () => {
  assert.ok(stormy('storm', 0) && !stormy('fog', 1) && !stormy('clear', 1) && stormy('rain', 0.9) && !stormy('rain', 0.4));
});

test('rounds and beats are deterministic', () => {
  assert.equal(roundStop(4, 0), 0);
  assert.equal(roundStop(4, 0.7), 1);
  assert.equal(roundStop(4, 2.5), 0);
  assert.equal(roundStop(0, 1), -1);
  const day = [{ from: 22 }, { from: 6 }];
  assert.ok(Math.abs(hoursInto(day, 0, 1) - 3) <= 0.31, "3 h into the night, give or take the jitter");
  const loop = CAST[0].places.mailbox!.loop;
  const a = nextBeat(loop, -1, 5, 0), b = nextBeat(loop, -1, 5, 0);
  assert.deepEqual(a, b);
  assert.equal(a.i, 0);
  let seen = new Set<number>(), prev = -1;
  for (let n = 0; n < 60; n++) { const r = nextBeat(loop, prev, 5, n); seen.add(r.i); prev = r.i; assert.ok(r.secs >= loop[r.i].min && r.secs <= loop[r.i].max); }
  assert.ok(seen.size >= 3);
  seen = new Set();
});

const farmer = (name: string, o: Partial<FarmerView> = {}): FarmerView => ({
  id: name, name, project: name, tag: name, kind: 'claude', seed: name, tier: 'opus', plotId: 'p1', spot: 0, status: 'working', job: 'plant', jobSince: 0, rawJob: 'plant',
  detail: '', title: null, needsYou: false, unseenDone: false, struggle: 0, mood: 'happy', busy: 0, ducklings: [], said: null, question: null,
  options: [], todos: null, work: null, context: null, lastActive: 0, ...o,
});
const plot = (id: string, stage: PlotView['stage']): PlotView => ({ id, label: id, site: 0, kind: 'wheat', colorIndex: 0, stage, stageSince: 0, growth: 0.5, vigor: 0.5, status: 'working', farmers: [], helpers: [] });
const letter = (id: string, o: Partial<Letter> = {}): Letter => ({ id, at: 0, kind: 'finished', farmerId: 'x', farmerName: 'x', plotLabel: '', title: '', body: '', read: false, resolved: false, ...o });
function state(o: Partial<ValleyState> = {}): ValleyState {
  return {
    now: 0, link: 'live', demo: true, farmers: new Map(), helpers: new Map(), plots: new Map(), letters: [], commitsToday: 0, gauges: null,
    sky: { hour: 14.5, daylight: 1, season: 'autumn', dayOfYear: 274, weather: { kind: 'rain', intensity: 0.5, clouds: 0.8, wind: 3, windDir: 0 }, trace: { wet: 1, snow: 0, sinceRain: null }, festival: { active: null, next: null } },
    almanac: almanacView(emptyAlmanac(), 0),
    timeline: { day: '', now: 0, farmers: new Map(), rev: 0, past: [] },
    ...o,
  };
}

test('brief + lines: the postmaster counts letters and names who needs you', () => {
  const s = state({
    farmers: new Map([['flint', farmer('flint', { needsYou: true, jobSince: 5 })], ['gale', farmer('gale', { needsYou: true, jobSince: 2 })], ['onyx', farmer('onyx')]]),
    letters: [letter('a', { kind: 'needs-you' }), letter('b'), letter('c', { read: true })],
  });
  const b = brief(s);
  assert.deepEqual(b.needs, ['Gale', 'Flint'], 'longest-waiting first, capitalised');
  assert.equal(b.unread, 2);
  assert.equal(lineFor('postmaster', b), '2 letters waiting, Gale and Flint need you!');
  assert.equal(callOut('postmaster', b), 'Letter for you! Gale needs you.');
  const one = brief(state({ farmers: new Map([['flint', farmer('flint', { needsYou: true })]]), letters: [letter('a', { kind: 'needs-you' }), letter('b')] }));
  assert.equal(lineFor('postmaster', one), '2 letters waiting, Flint needs you!');
  const none = brief(state());
  assert.match(lineFor('postmaster', none), /No new mail|caught up/);
  assert.equal(callOut('postmaster', none), null);
  assert.equal(callOut('miller', b), null);
});

test('lines: clerk, miller, mayor, ranger, weather-watcher', () => {
  assert.match(lineFor('clerk', brief(state())), /Nothing shipped/);
  assert.equal(lineFor('clerk', brief(state({ commitsToday: 3 }))), '3 crates shipped today. Here\'s the ledger.');
  assert.equal(lineFor('clerk', brief(state({ commitsToday: 1 }))), '1 crate shipped today. Here\'s the ledger.');
  assert.equal(shipLine(4), 'Another crate! That\'s 4 today.');
  assert.match(lineFor('miller', brief(state())), /gauges are quiet/);
  const g = { at: 0, host: 'h', cpu: 0.91, cores: [], load1: 1, mem: 0.5, memUsedGB: 8, memTotalGB: 16, swap: 0, disk: 0.4, diskUsedGB: 1, diskTotalGB: 2, ioRead: 0, ioWrite: 0, netRx: 0, netTx: 0, gpu: null, tempC: 55, cpuHistory: [], memHistory: [] };
  assert.equal(lineFor('miller', brief(state({ gauges: g }))), 'The sails are fair screaming — CPU at 91%, the tower\'s 50% full!');
  assert.match(lineFor('miller', brief(state({ gauges: { ...g, cpu: 0.05 } }))), /CPU 5%/);
  const plots = new Map([['a', plot('a', 'thriving')], ['b', plot('b', 'thriving')], ['c', plot('c', 'tilling')], ['d', plot('d', 'resting')], ['e', plot('e', 'fallow')]]);
  assert.equal(lineFor('mayor', brief(state({ plots, farmers: new Map([['x', farmer('x')]]) }))), 'Welcome to the valley! 3 fields busy, 1 resting.');
  assert.match(lineFor('mayor', brief(state())), /quiet valley/);
  assert.equal(lineFor('mayor', brief(state()), 2), 'We\'re a proud Homestead now — 40 more prosperity and we\'ll be a Smallholding, with bunting over the square. The almanac (H) has it all.');
  assert.match(lineFor('mayor', brief(state({ almanac: almanacView({ ...emptyAlmanac(), points: 9000 }, 0) })), 2), /Golden Valley!.*Fireworks/);
  assert.match(lineFor('ranger', brief(state())), /map/);
  assert.match(lineFor('ranger', brief(state({ farmers: new Map([['flint', farmer('flint', { needsYou: true })]]) }))), /Flint/);
  assert.equal(lineFor('weather', brief(state())), '14:30 on a rainy autumn afternoon. Steady rain. The crops are grateful.');
  assert.equal(partOfDay(22), 'night');
  assert.equal(clock(9.25), '9:15');
});

test('lines: festivals on alternate chats, the next one when it is near', () => {
  const on = (d: Date) => state({ sky: { ...state().sky, festival: festivalAt(d) } });
  const harvest = brief(on(new Date(2026, 9, 1, 12)));
  assert.deepEqual(harvest.festival, { id: 'harvest', name: 'Harvest Festival', day: 10, days: 23 });
  assert.match(lineFor('mayor', harvest, 1), /giant pumpkin/);
  assert.match(lineFor('mayor', harvest, 0), /quiet valley/);   // the useful report comes first
  assert.match(lineFor('weather', harvest, 3), /Harvest weather/);
  // last day: the mayor says so
  assert.match(lineFor('mayor', brief(on(new Date(2026, 9, 14, 12))), 1), /^Last day of the Harvest Festival!/);
  // somebody needs you: the postmaster says that instead
  const needy = brief(state({ sky: on(new Date(2026, 9, 1)).sky, farmers: new Map([['flint', farmer('flint', { needsYou: true })]]) }));
  assert.match(lineFor('postmaster', needy, 1), /Flint/);
  // no festival on, Hallowtide in 5 days: every fourth chat mentions it
  const soon = brief(on(new Date(2026, 9, 19, 12)));
  assert.equal(soon.festival, null);
  assert.deepEqual(soon.upcoming, { id: 'hallowtide', name: 'Hallowtide', inDays: 5 });
  assert.match(lineFor('mayor', soon, 1), /Hallowtide is in 5 days/);
  assert.doesNotMatch(lineFor('mayor', soon, 3), /Hallowtide/);
  // far off: nothing
  assert.equal(brief(on(new Date(2026, 6, 1))).upcoming, null);
});
