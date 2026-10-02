import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOAT, boatState, fishBoost, loops, pondIce, skateState, stepBoat, stepSkate, trackLoops } from './physics.ts';
import type { BoatEnv, SkateEnv } from './physics.ts';
import { BALL_MAX, BALL_MIN, MAX_SNOWMEN, ballHeights, decorate, emptySnow, grow, isFriend, nextDecor, parseSnow, placeBall, settle } from './snowman.ts';
import { fishOdds } from '../../model/collection.ts';
import { POND } from '../../world/map.ts';

// a round test pond: 10 m radius, 1.2 m deep in the middle, shelving to the shore
const R = 10, CX = 0, CZ = 0;
const pond: BoatEnv = { depth: (x, z) => 1.2 * (1 - Math.hypot(x - CX, z - CZ) / R), pads: [] };
const DT = 1 / 60;

test('rowing: W pulls her along the keel, speed settles, she glides to a stop', () => {
  const s = boatState(0, -5, 0); // facing +z
  for (let i = 0; i < 60 * 4; i++) stepBoat(s, { fwd: 1, turn: 0 }, DT, pond);
  assert.ok(s.z > -5 + 2, `moved forward: z=${s.z}`);
  assert.ok(Math.abs(s.x) < 0.05, `straight: x=${s.x}`);
  const v = Math.hypot(s.vx, s.vz);
  assert.ok(v > 0.8 && v < 3, `cruising speed ${v}`);
  assert.ok(s.active > 0.9);
  for (let i = 0; i < 60 * 15; i++) stepBoat(s, { fwd: 0, turn: 0 }, DT, pond);
  assert.ok(Math.hypot(s.vx, s.vz) < 0.15, 'drifts to a near stop');
  assert.ok(s.active < 0.05, 'oars shipped');
});

test('rowing: D turns her right (yaw decreases), A left; she spins in place without W', () => {
  const s = boatState(0, 0, 0);
  for (let i = 0; i < 60 * 2; i++) stepBoat(s, { fwd: 0, turn: 1 }, DT, pond);
  assert.ok(s.yaw < -0.3, `turned right: ${s.yaw}`);
  assert.ok(Math.hypot(s.x, s.z) < 0.6, 'roughly in place');
  const t = boatState(0, 0, 0);
  for (let i = 0; i < 60 * 2; i++) stepBoat(t, { fwd: 1, turn: -1 }, DT, pond);
  assert.ok(t.yaw > 0.3, `turned left: ${t.yaw}`);
});

test('rowing: she never runs aground, bumps softly off the shore', () => {
  const s = boatState(0, 0, 0);
  let bumped = 0;
  for (let i = 0; i < 60 * 25; i++) {
    stepBoat(s, { fwd: 1, turn: i > 900 ? 0.4 : 0 }, DT, pond);
    if (s.bump > 0) bumped++;
    // the hull's centre keeps to water deeper than the draft (the outline may touch the shelf)
    assert.ok(pond.depth(s.x, s.z) > BOAT.draft * 0.5, `afloat at step ${i}: depth ${pond.depth(s.x, s.z)}`);
  }
  assert.ok(bumped > 0, 'hit the shore at least once');
  assert.ok(s.rowed > 5);
});

test('rowing: lily pads part around the hull and slow her', () => {
  const env: BoatEnv = { ...pond, pads: [{ x: 0, z: 0, r: 0.5 }] };
  const s = boatState(0.1, -4, 0);
  for (let i = 0; i < 60 * 6; i++) { stepBoat(s, { fwd: 1, turn: 0 }, DT, env); }
  assert.ok(Math.abs(s.x) > 0.3, `pushed aside: x=${s.x}`);
});

const ice: SkateEnv = { onIce: (x, z) => Math.hypot(x, z) < R, snow: 0, center: { x: 0, z: 0 } };

test('skating: pushes build speed, glide carries far with little friction, S brakes', () => {
  const s = skateState(0, 5);
  for (let i = 0; i < 60 * 1.5; i++) stepSkate(s, { fwd: 1, side: 0, sprint: false, yaw: 0 }, DT, ice); // yaw 0 = north (−z)
  const v0 = Math.hypot(s.vx, s.vz);
  assert.ok(v0 > 2.5, `speed ${v0}`);
  assert.ok(s.vz < 0, 'heading north');
  const z0 = s.z;
  for (let i = 0; i < 60; i++) stepSkate(s, { fwd: 0, side: 0, sprint: false, yaw: 0 }, DT, ice);
  assert.ok(Math.hypot(s.vx, s.vz) > v0 * 0.9, 'glides on');
  assert.ok(z0 - s.z > 2, 'covers ground');
  const b = skateState(0, 5); b.vz = -4;
  for (let i = 0; i < 60; i++) stepSkate(b, { fwd: -1, side: 0, sprint: false, yaw: 0 }, DT, ice);
  assert.ok(Math.hypot(b.vx, b.vz) < 0.6, 'braked');
});

test('skating: carving turns the glide (most of the speed kept); slow at the edge you step off, fast you bounce', () => {
  const s = skateState(0, 0); s.vz = -4;
  let yaw = 0;
  for (let i = 0; i < 60; i++) { stepSkate(s, { fwd: 0, side: 1, sprint: false, yaw }, DT, { ...ice, onIce: () => true }); yaw += s.dyaw; }
  assert.ok(yaw < -0.8, `carved right: ${yaw}`);
  const a = Math.atan2(-s.vx, -s.vz); // velocity heading in camera-yaw terms
  assert.ok(a < -0.5, `glide followed: ${a}`);
  assert.ok(Math.hypot(s.vx, s.vz) > 3, 'kept most of the speed');
  const slow = skateState(0, -R + 0.05); slow.vz = -1;
  assert.equal(stepSkate(slow, { fwd: 0, side: 0, sprint: false, yaw: 0 }, 0.1, ice), 'off');
  const fast = skateState(0, -R + 0.05); fast.vz = -5;
  assert.equal(stepSkate(fast, { fwd: 0, side: 0, sprint: false, yaw: 0 }, 0.1, ice), 'bump');
  assert.ok(fast.vz > 0, 'bounced back');
});

test('figure eight: a lobe one way then the other counts; circling round does not', () => {
  const run = (lobes: number[]) => {
    const l = loops();
    let hits = 0, a = 0;
    for (const dir of lobes) {
      for (let i = 0; i < 60 * 6.3; i++) { // 2π at 1 rad/s
        a += dir * DT;
        if (trackLoops(l, Math.cos(a) * 3, Math.sin(a) * 3, DT)) hits++;
      }
    }
    return hits;
  };
  assert.equal(run([1, -1]), 1);
  assert.equal(run([-1, 1]), 1);
  assert.equal(run([1, 1, 1]), 0);
  assert.equal(run([1]), 0);
  // too slow (standing about) never counts
  const l = loops();
  let hit = false, a = 0;
  for (const dir of [1, -1]) for (let i = 0; i < 400; i++) { a += dir * DT; hit ||= trackLoops(l, Math.cos(a) * 0.3, Math.sin(a) * 0.3, DT); }
  assert.equal(hit, false);
});

test('the pond freezes every winter (a long rain softens it); rare fish favour the middle', () => {
  assert.equal(pondIce('winter', { wet: 0 }, 'snow'), 1);
  assert.equal(pondIce('winter', { wet: 0.9 }, 'rain'), 0);
  assert.equal(pondIce('autumn', { wet: 0 }, 'clear'), 0);
  assert.equal(fishBoost(POND.x + POND.r, POND.z), 1);
  assert.ok(fishBoost(POND.x, POND.z) > 2.5);
  const c = { season: 'summer' as const, hour: 12, weather: 'clear' as const, water: 'pond' as const };
  const plain = fishOdds(c), mid = fishOdds({ ...c, rareBoost: 2.6 });
  const rare = (o: typeof plain) => o.filter((x) => x.def.rare && !x.def.junk).reduce((a, x) => a + x.weight, 0) / o.reduce((a, x) => a + x.weight, 0);
  assert.ok(rare(mid) > rare(plain) * 1.5, `${rare(mid)} vs ${rare(plain)}`);
});

test('snowballs grow as you push them, more slowly as they get heavy, never past the max', () => {
  let r = BALL_MIN;
  const steps: number[] = [];
  for (let i = 0; i < 6; i++) { const b = r; r = grow(r, 2); steps.push(r - b); }
  assert.ok(steps[0] > steps[5], 'slows down');
  for (let i = 0; i < 400; i++) r = grow(r, 1);
  assert.equal(r, BALL_MAX);
  assert.equal(grow(0.3, 0), 0.3);
});

test('snowmen: base, stack (only smaller on top, three tall), decorate, at most three, persist for the day', () => {
  const d = emptySnow('2026-01-10');
  assert.equal(placeBall(d, 0, 0, 0.18, 0).kind, 'too-small');
  const a = placeBall(d, 0, 0, 0.6, 0);
  assert.equal(a.kind, 'new');
  assert.equal(placeBall(d, 0.4, 0, 0.7, 0).kind, 'too-big');
  assert.equal(placeBall(d, 0.4, 0, 0.45, 0).kind, 'stack');
  assert.equal(placeBall(d, 0, 0.3, 0.3, 0).kind, 'stack');
  assert.equal(placeBall(d, 0, 0.3, 0.2, 0).kind, 'tall');
  const sm = d.list[0];
  assert.deepEqual(sm.balls, [0.6, 0.45, 0.3]);
  const h = ballHeights(sm.balls);
  assert.ok(h[0] < h[1] && h[1] < h[2]);
  // decorating: a pinecone from the basket makes the eyes, then a carrot nose → a snow friend
  assert.equal(isFriend(sm), false);
  const basket = new Set(['pinecone']);
  const e = nextDecor(sm, (id) => basket.has(id))!;
  assert.deepEqual(e, { part: 'eyes', value: 'pinecone', take: 'pinecone' });
  decorate(sm, e);
  decorate(sm, nextDecor(sm, () => false)!);
  assert.equal(sm.decor.nose, 'carrot');
  assert.equal(isFriend(sm), true);
  for (let i = 0; i < 4; i++) decorate(sm, nextDecor(sm, () => false)!);
  assert.equal(sm.decor.topper, 'hat');
  assert.equal(nextDecor(sm, () => true), null);
  // three at most
  assert.equal(placeBall(d, 5, 0, 0.5, 0).kind, 'new');
  assert.equal(placeBall(d, 10, 0, 0.5, 0).kind, 'new');
  assert.equal(placeBall(d, 15, 0, 0.5, 0).kind, 'full');
  assert.equal(d.list.length, MAX_SNOWMEN);
  // round-trip, tolerant
  const back = parseSnow(JSON.parse(JSON.stringify(d)), '2026-01-10');
  assert.deepEqual(back.list, d.list);
  assert.equal(parseSnow(JSON.parse(JSON.stringify(d)), '2026-01-11').list.length, 0, 'another day: gone');
  assert.equal(parseSnow({ v: 1, day: '2026-01-10', list: [{ id: 'x' }, null, { id: 3, x: 1, z: 2, yaw: 0, balls: [0.5], decor: { nose: 'banana' } }] }, '2026-01-10').list.length, 1);
  assert.equal(parseSnow('nope', 'd').list.length, 0);
  // the snow melts (or a new day): they go
  assert.equal(settle(d, '2026-01-10', true), false);
  assert.equal(settle(d, '2026-01-10', false), true);
  assert.equal(d.list.length, 0);
  placeBall(d, 0, 0, 0.5, 0);
  assert.equal(settle(d, '2026-01-11', true), true);
  assert.equal(d.list.length, 0);
});
