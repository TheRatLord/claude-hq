import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandSlots, campfireSlots, crowdSlots, marketSlots, toWorld } from './slots.ts';
import type { Slot } from './slots.ts';
import { newMind, plan } from '../farmers/brain.ts';
import type { GatherSpot, World } from '../farmers/brain.ts';
import type { FarmerView } from '../../model/types.ts';

const SEATS: [number, number][] = [[-2.2, -2.2], [3.0, 2.4], [-3.0, 2.8], [2.9, -1.9]];
const minGap = (s: Slot[]) => { let m = Infinity; for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) m = Math.min(m, Math.hypot(s[i].x - s[j].x, s[i].z - s[j].z)); return m; };
const facing = (s: Slot, t: { x: number; z: number }) => Math.cos(s.yaw - Math.atan2(t.x - s.x, t.z - s.z));

test('campfire: two to a log, the stool, a ring on the grass; everyone faces the fire with elbow room', () => {
  for (const yaw of [0, 0.7, -2.1]) {
    const fire = { x: 26, z: 33, yaw };
    const s = campfireSlots(fire, SEATS, (i) => 1 + i * 0.01);
    assert.equal(s.filter((x) => x.kind === 'log').length, 6);
    assert.equal(s.filter((x) => x.kind === 'stool').length, 1);
    assert.equal(s.filter((x) => x.kind === 'ground').length, 5);
    assert.ok(minGap(s) > 1.02, `slots ${minGap(s).toFixed(2)} m apart`);
    for (const x of s) {
      assert.ok(facing(x, fire) > 0.99, 'faces the fire');
      const d = Math.hypot(x.x - fire.x, x.z - fire.z);
      assert.ok(d > 2 && d < 4, `${x.kind} at ${d.toFixed(2)} m`);
      if (x.kind !== 'ground') assert.equal(x.y, 1 + (x.bench ?? 0) * 0.01);
      else assert.equal(x.y, undefined);
    }
    // the bench pairs sit on their bench's centre line
    const b0 = toWorld(fire, SEATS[0][0] * 0.88, SEATS[0][1] * 0.88);
    const pair = s.filter((x) => x.bench === 0);
    assert.ok(Math.abs((pair[0].x + pair[1].x) / 2 - b0.x) < 1e-6 && Math.abs((pair[0].z + pair[1].z) / 2 - b0.z) < 1e-6);
  }
});

test('the band stands on the stage and climbs the steps; the crowd fans out in front', () => {
  const st = { x: -12, z: 18, yaw: 0.4 };
  const band = bandSlots(st, 2.6, 5.7);
  assert.equal(band.length, 3);
  for (const b of band) {
    assert.ok(Math.hypot(b.x - st.x, b.z - st.z) < 1.6, 'on the stage');
    assert.equal(b.y, 5.7);
    assert.ok(b.via && Math.hypot(b.via.x - st.x, b.via.z - st.z) > 3.5, 'via the steps, outside the rail');
    assert.ok(Math.cos(b.yaw - st.yaw) > 0.99, 'facing out to the audience');
  }
  const crowd = crowdSlots(st, 2.6, 12);
  assert.equal(crowd.length, 12);
  assert.ok(minGap(crowd) > 1.05, `crowd ${minGap(crowd).toFixed(2)} m apart`);
  const front = toWorld(st, 0, 1);
  for (const c of crowd) {
    assert.ok(facing(c, st) > 0.99);
    // in front of the stage, not behind it
    assert.ok((c.x - st.x) * (front.x - st.x) + (c.z - st.z) * (front.z - st.z) > 0);
  }
});

test('market: browsers face the counters', () => {
  const stalls = [{ x: -14, z: 7, yaw: 1.2 }, { x: -15.5, z: 11.5, yaw: 1.0 }];
  const m = marketSlots(stalls);
  assert.equal(m.length, 6);
  assert.ok(minGap(m) > 1.05);
  for (const x of m.slice(0, 4)) assert.ok(facing(x, stalls[m.indexOf(x) < 2 ? 0 : 1]) > 0.9);
});

// ---- the brain's side: an attending farmer goes; a busy or blocked one never does

const view = (o: Partial<FarmerView>): FarmerView => ({
  id: 'f1', name: 'f1', project: 'p', tag: 'p', kind: 'claude', seed: 's', tier: null, plotId: 'w', spot: 0, status: 'idle', job: 'idle', jobSince: 0,
  rawJob: 'idle', detail: '', title: null, needsYou: false, unseenDone: false, struggle: 0, mood: 'happy', busy: 0, ducklings: [], said: null, question: null,
  options: [], todos: null, work: null, context: null, lastActive: 0, ...o,
});
const world = (g: GatherSpot | null): World => ({
  site: null, plotKind: null, bin: { x: 0, z: 0, yaw: 0 }, mailbox: { x: 2, z: 0, yaw: 0 }, well: { x: 4, z: 0, yaw: 0 }, exit: { x: 0, z: 60 }, hub: { x: 0, z: 0 },
  seats: [{ x: 9, z: 9, yaw: 0, act: 'sit', kind: 'bench' }], claim: () => 0, gather: () => g,
});

test('brain: idle and finished farmers go to their gathering spot; asking and working ones do not', () => {
  const spot: GatherSpot = { key: 'gather:campfire:2', x: 20, z: 30, yaw: 1, act: 'toast', prop: 'marshmallow', y: 1.5 };
  for (const job of ['idle', 'done'] as const) {
    const m = newMind(job, 0, 0.3);
    const it = plan(m, view({ job }), world(spot), { x: 0, z: 0 }, false, 1, []);
    assert.equal(it.key, spot.key, job);
    assert.equal(it.act, 'toast');
    assert.equal(it.prop, 'marshmallow');
    assert.equal(it.seatY, 1.5);
  }
  const asking = plan(newMind('ask', 0, 0.3), view({ job: 'ask', needsYou: true }), world(spot), { x: 0, z: 0 }, false, 1, []);
  assert.equal(asking.key, 'ask');
  const working = plan(newMind('plant', 0, 0.3), view({ job: 'plant' }), world(spot), { x: 0, z: 0 }, false, 1, []);
  assert.equal(working.key, 'work');
  // no gathering: back to leisure
  const free = plan(newMind('idle', 0, 0.3), view({}), world(null), { x: 0, z: 0 }, false, 1, []);
  assert.match(free.key, /^seat:/);
});

test('brain: the band climbs the steps first', () => {
  const spot: GatherSpot = { key: 'gather:concert:0', x: 0, z: 0, yaw: 0, act: 'fiddle', prop: 'fiddle', y: 0.7, via: { x: 0, z: 4 } };
  const m = newMind('idle', 0, 0.3);
  const a = plan(m, view({}), world(spot), { x: 0, z: 20 }, false, 1, []);
  assert.equal(a.key, 'gather:concert:0:via');
  const b = plan(m, view({}), world(spot), { x: 0, z: 4.2 }, true, 2, []);
  assert.equal(b.key, 'gather:concert:0');
  assert.equal(b.act, 'fiddle');
});
