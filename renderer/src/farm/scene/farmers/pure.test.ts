import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTS, ACT_INFO, actPose, blendStep, newBlend, newPose, poseDelta, setAct, gait, NCH } from './pose.ts';
import { lookFor } from './look.ts';
import { newMover, moveStep, separate, place } from './motion.ts';
import { newTrail, trailPush, trailAt } from './trail.ts';
import { buildSeats, newMind, pickSeat, plan } from './brain.ts';
import type { World } from './brain.ts';
import { HANGOUTS, SITES, structure, POND } from '../../world/map.ts';
import { JOBS } from '../../model/types.ts';
import type { FarmerView, Job } from '../../model/types.ts';

test('every act produces a finite pose and loops continuously', () => {
  const a = newPose(), b = newPose();
  for (const act of ACTS) {
    for (let t = 0; t < 20; t += 0.016) {
      actPose(act, t, 0.3, 1, a);
      actPose(act, t + 0.016, 0.3, 1, b);
      for (let i = 0; i < NCH; i++) assert.ok(Number.isFinite(a[i]), `${act} ch${i}`);
      // loops may snap only on deliberate beats (a hammer strike); nothing teleports
      assert.ok(poseDelta(a, b) < 0.35, `${act} jumps ${poseDelta(a, b)} at t=${t}`);
    }
  }
});

test('switching acts mid-fade stays continuous', () => {
  const b = newBlend('plant');
  const out = newPose(), prev = newPose(), tgt = newPose();
  let t = 0;
  const seq = ['plant', 'ask', 'plan', 'lie', 'carry', 'fish', 'stand'] as const;
  for (const act of seq) {
    setAct(b, act, out);
    for (let i = 0; i < 20; i++) {
      t += 0.016;
      prev.set(out);
      actPose(b.act, t, 0.1, 1, tgt);
      gait(tgt, t * 2, 0.5, 0, 1, !!ACT_INFO[b.act].carryWalk);
      blendStep(b, tgt, 0.016, out);
      if (t > 0.05) assert.ok(poseDelta(prev, out) < 0.9, `pop into ${act}`);
    }
  }
});

test('looks are deterministic and follow the model tier', () => {
  const a = lookFor({ seed: 'gale', tier: 'opus', kind: 'claude' }, 0xff0000);
  const b = lookFor({ seed: 'gale', tier: 'opus', kind: 'claude' }, 0xff0000);
  assert.deepEqual(a, b);
  assert.equal(a.hat, 'straw');
  assert.equal(lookFor({ seed: 'x', tier: 'sonnet', kind: 'claude' }, 0).hat, 'cap');
  assert.equal(lookFor({ seed: 'x', tier: 'haiku', kind: 'claude' }, 0).hat, 'bandana');
  assert.equal(lookFor({ seed: 'x', tier: null, kind: 'agent' }, 0).hat, 'beanie');
  assert.equal(lookFor({ seed: 'x', tier: 'opus', kind: 'codex' }, 0).hat, 'goggles');
  const skins = new Set(Array.from({ length: 60 }, (_, i) => lookFor({ seed: `s${i}`, tier: 'opus', kind: 'claude' }, 0).skin));
  assert.ok(skins.size >= 6, 'diverse skin tones');
});

test('mover walks a route, arrives, and holds its spot against small nudges', () => {
  const m = newMover(0, 0, 0);
  const route = (_f: { x: number; z: number }, to: { x: number; z: number }) => [{ x: 5, z: 0 }, to];
  const tgt = { key: 'a', x: 5, z: 5, yaw: 1, gait: 'walk' as const };
  let t = 0;
  while (!m.arrived || t < 0.1) { moveStep(m, tgt, 0.016, route); t += 0.016; assert.ok(t < 20, 'arrives'); }
  assert.ok(Math.hypot(m.x - 5, m.z - 5) < 0.2);
  m.x += 0.3;
  moveStep(m, tgt, 0.016, route);
  assert.ok(m.arrived, 'nudge does not restart the walk');
  place(m, { key: 'b', x: 9, z: 9, yaw: 0, gait: 'walk' });
  assert.equal(m.x, 9);
});

test('separation pushes walkers apart, not settled farmers', () => {
  const pts = [{ x: 0, z: 0, walking: false }, { x: 0.2, z: 0, walking: true }];
  for (let i = 0; i < 60; i++) separate(pts, 0.7, 0.016);
  assert.equal(pts[0].x, 0);
  assert.ok(pts[1].x > 0.6);
});

test('trail returns points behind the walker', () => {
  const tr = newTrail(0, 0);
  for (let x = 0; x <= 10; x += 0.05) trailPush(tr, x, 0);
  const o = { x: 0, z: 0 };
  trailAt(tr, 10, 0, 2, o);
  assert.ok(Math.abs(o.x - 8) < 0.25);
});

const view = (job: Job, spot = 0): FarmerView => ({
  id: 'f1', name: 'x', kind: 'claude', seed: 's', tier: 'opus', plotId: 'p', spot, status: 'working', job, jobSince: 0, rawJob: job, detail: '',
  title: null, needsYou: job === 'ask', unseenDone: false, struggle: 0, mood: 'focused', busy: 0.5, ducklings: [], said: null, question: null,
  options: [], todos: null, work: null, context: null, lastActive: 0,
});

test('every job yields an intent; work jobs share one spot; haul reaches the bin and ships', () => {
  const seats = buildSeats({ hangouts: HANGOUTS, campfire: structure('campfire'), well: structure('well'), board: structure('noticeboard'), pond: POND });
  const occ = new Map<number, string>();
  const bin = structure('shippingBin');
  const w: World = {
    site: SITES[0], plotKind: 'wheat', bin, mailbox: structure('mailbox'), well: structure('well'), exit: { x: 0, z: 80 }, hub: { x: 0, z: 0 }, seats,
    claim: (id, kind, t) => { const i = pickSeat(seats, occ, id, kind, ['fire'], 0.5, () => ((t * 7) % 1)); occ.set(i, id); return i; },
  };
  const keys = new Set<string>();
  for (const job of JOBS) {
    const m = newMind(job, 0, 0.2);
    const i = plan(m, view(job), w, { x: 0, z: 0 }, false, 0, []);
    assert.ok(Number.isFinite(i.x) && Number.isFinite(i.z), job);
    if (['plant', 'inspect', 'build', 'talk', 'delegate', 'rest'].includes(job)) keys.add(i.key);
  }
  assert.deepEqual([...keys], ['work']);
  // haul loop
  const m = newMind('haul', 0, 0);
  const cues: string[] = [];
  let pos = { x: 0, z: 0 };
  let sawBin = false;
  for (let t = 0; t < 30; t += 0.1) {
    const i = plan(m, view('haul'), w, pos, true, t, cues);
    pos = { x: i.x, z: i.z };
    if (Math.hypot(i.x - bin.x, i.z - bin.z) < 3) sawBin = true;
  }
  assert.ok(sawBin);
  assert.ok(cues.includes('ship'));
  // idle picks a leisure seat, away a nap seat
  const mi = newMind('idle', 0, 0.5);
  const ii = plan(mi, view('idle'), w, pos, false, 0, []);
  assert.ok(ii.key.startsWith('seat:'));
  const ma = newMind('away', 0, 0.5);
  const ia = plan(ma, view('away'), w, pos, false, 0, []);
  assert.ok(['nap', 'lie'].includes(ia.act));
});
