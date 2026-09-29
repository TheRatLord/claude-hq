// Follow camera (m2-r1 [ui] h04): the followed actor must not be framed behind other actors — no neighbour covering it
// or filling the foreground — nor behind walls; the camera orbits / rises to a clear spot and leaves follow smoothly.
import test from 'node:test';
import assert from 'node:assert/strict';

import type { Layout, Slot } from '../world/layout/schema.ts';
import type { FollowActor, ScoredSpot, FollowOpts, EyePose } from './follow.ts';
import type { Player, PlayerActor } from './controller.ts';
import { fakeCamera } from './testCamera.ts';

globalThis.addEventListener ??= () => {};
globalThis.removeEventListener ??= () => {};

/** A test actor: the controller's actor slice (`pos.y` and `yaw` always set). */
type TActor = PlayerActor;

const { createPlayer } = await import('./controller.ts');
const { frameMetrics, followWorld, worldBlocked, scoreSpots, scoreBegin, scoreStep, followCost, createFollowRig, FOLLOW } = await import('./follow.ts');
const FG_N = 10; // follow.ts FG_RAYS.length
const { TUNING: T } = await import('./tuning.ts');
const { layout } = await import('../world/layout/hq.ts');
const { createNav } = await import('../world/nav/index.ts');
const { createBus } = await import('../core/bus.ts');
const { pointsOf } = await import('./manager.ts');

const nav = createNav(layout);
const W = followWorld(layout);
const slot = (id: string): Slot => { const s = layout.slots.find((q) => q.id === id); assert.ok(s, `slot ${id}`); return s; };
const actor = (id: string, s: Slot): TActor => ({ id, pos: { x: s.pos.x, y: s.pos.y ?? 0, z: s.pos.z }, yaw: s.yaw });

function rig(actors: TActor[]) {
  let t = 0;
  const camera = fakeCamera();
  const p = createPlayer({ camera, dom: { addEventListener() {}, removeEventListener() {} }, bus: createBus(), nav, now: () => t });
  p.setSoftColliders(() => actors);
  const ctx = { layout, rawDt: 1 / 60 };
  const frame = () => { t += 1000 / 60; p.update(ctx); };
  const run = (n: number, each?: (i: number) => void) => { for (let i = 0; i < n; i++) { frame(); each?.(i); } };
  frame();
  return { p, camera, frame, run };
}
/** Put the eye on the far side of `nb` from `a` (the reviewer's h04 start: the neighbour between camera and target). */
function behind(p: Player, a: TActor, nb: TActor, r = 2.4) {
  const dx = nb.pos.x - a.pos.x, dz = nb.pos.z - a.pos.z, l = Math.hypot(dx, dz);
  const x = a.pos.x + (dx / l) * Math.max(r, l + 0.9), z = a.pos.z + (dz / l) * Math.max(r, l + 0.9);
  p.setPose(x, 0, z, Math.atan2(a.pos.x - x, a.pos.z - z) + Math.PI, -0.2);
  return { x, y: T.eyeHeight, z };
}

test('reviewer h04: following a desk worker behind its neighbour ends on a clear, un-cluttered view', () => {
  const a = actor('claude', slot('slot:desk:E1:0')), nb = actor('ledger', slot('slot:desk:E1:1'));
  const actors = [a, nb];
  const { p, camera, run } = rig(actors);
  const e0 = behind(p, a, nb);
  const before = frameMetrics(a, actors, e0.x, e0.y, e0.z);
  assert.ok(before.occ > 0.5 && before.who === 'ledger', `start is the reviewer's framing (occ ${before.occ})`);
  p.follow(a);
  run(240);
  assert.equal(p.mode, 'follow');
  const c = camera.position;
  const m = frameMetrics(a, actors, c.x, c.y, c.z);
  assert.ok(m.occFace < 0.05 && m.occ < 0.1, `target covered ${m.occFace}/${m.occ} by ${m.who}`);
  assert.ok(m.fg < 0.06, `foreground actors fill ${m.fg} of the frame`);
  assert.ok(m.tgt > 0.03, `target reads (frame share ${m.tgt})`);
  assert.ok(!worldBlocked(W, 0, c.x, c.y, c.z, a.pos.x, a.pos.y + 0.85, a.pos.z, 0.45), 'face sightline free of walls');
  assert.ok(nav.walkable(c.x, c.z, 0, { owner: '*' }), 'camera spot is inside the room');
  // it looks at the target
  const yaw = Math.atan2(-(a.pos.x - c.x), -(a.pos.z - c.z));
  assert.ok(Math.abs(Math.atan2(Math.sin(camera.rotation.y - yaw), Math.cos(camera.rotation.y - yaw))) < 0.1, 'aimed at the target');
  assert.ok(p.followInfo()?.clear, JSON.stringify(p.followInfo()));
});

test('a subject ringed by others: the camera orbits / rises until nobody covers it', () => {
  const s = pointsOf(layout)?.pit ?? { x: 0, z: 0 };
  const a = { id: 't', pos: { x: s.x + 1.2, y: layout.floorY(s.x + 1.2, s.z, 0), z: s.z }, yaw: 0 };
  const actors: TActor[] = [a];
  for (let k = 0; k < 5; k++) {
    const ang = (k / 5) * Math.PI * 2 + 0.3;
    actors.push({ id: `o${k}`, pos: { x: a.pos.x + Math.sin(ang) * 0.95, y: a.pos.y, z: a.pos.z + Math.cos(ang) * 0.95 }, yaw: 0 });
  }
  const { p, camera, run } = rig(actors);
  p.setPose(a.pos.x, a.pos.y, a.pos.z + 2.4, 0, 0);
  p.follow(a);
  run(300);
  const c = camera.position;
  const m = frameMetrics(a, actors, c.x, c.y, c.z);
  assert.ok(m.occFace < 0.05 && m.occ < 0.35, `covered face ${m.occFace} body ${m.occ} by ${m.who} from (${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)})`);
});

test('a walking subject is trailed smoothly: no camera jumps, distance kept, no picks through walls', () => {
  // down Studio Street (plan x 6.5, z 4 → 19) at 2 m/s
  const x0 = 6.5 - 20.5, a = { id: 'w', pos: { x: x0, y: 0, z: 4 - 14 }, yaw: Math.PI };
  const actors = [a, { id: 'n', pos: { x: x0 + 0.6, y: 0, z: 5 - 14 }, yaw: 0 }];
  const { p, camera, run } = rig(actors);
  p.setPose(x0, 0, a.pos.z - 2.3, Math.PI, 0);
  p.follow(a);
  let last: { x: number; y: number; z: number } | null = null, maxStep = 0, minD = 9, maxD = 0;
  run(420, (i) => {
    a.pos.z += 2 / 60;
    const c = camera.position;
    if (last && i > 30) maxStep = Math.max(maxStep, Math.hypot(c.x - last.x, c.y - last.y, c.z - last.z));
    last = { x: c.x, y: c.y, z: c.z };
    if (i > 90) { const d = Math.hypot(c.x - a.pos.x, c.z - a.pos.z); minD = Math.min(minD, d); maxD = Math.max(maxD, d); }
  });
  assert.ok(maxStep < 0.2, `camera step ${maxStep.toFixed(3)} m/frame`);
  assert.ok(minD > 1.2 && maxD < 3.6, `distance ${minD.toFixed(2)}–${maxD.toFixed(2)} m`);
  const c = camera.position;
  assert.ok(!worldBlocked(W, 0, c.x, c.y, c.z, a.pos.x, 0.85, a.pos.z, 0.45), 'still sees the walker');
});

test('follow(null) hands back to walking without a camera pop; setPose also ends follow', () => {
  const a = actor('claude', slot('slot:desk:E1:0')), nb = actor('ledger', slot('slot:desk:E1:1'));
  const { p, camera, run, frame } = rig([a, nb]);
  behind(p, a, nb);
  p.follow(a);
  run(200);
  const y0 = camera.position.y;
  p.follow(null);
  assert.equal(p.mode, 'walk');
  let maxDy = 0, prev = y0;
  run(90, () => { maxDy = Math.max(maxDy, Math.abs(camera.position.y - prev)); prev = camera.position.y; });
  assert.ok(maxDy <= T.camMaxRate / 60 + 1e-3, `eye moved ${maxDy.toFixed(3)} m in a frame`);
  assert.ok(Math.abs(camera.position.y - (p.pos.y + T.eyeHeight)) < 0.05, 'settled at standing eye height');
  p.follow(a);
  frame();
  p.setPose(0, 0, 12.5, 0, 0);
  assert.equal(p.mode, 'walk');
  assert.equal(p.followInfo(), null);
});

// m2 fix r2: no wall-clock assertion (node --test runs files in parallel; a timing bound flakes under load). The budget
// is deterministic work — sightline rays, wall crossings, furniture clips, zone samples, actor projections — per
// evaluation and per frame slice. Wall-clock is only logged.
type Cost = ReturnType<typeof followCost>;
const units = (c: Cost) => c.walls + c.boxes + c.samples * 0.5 + c.actors * 2; // ≈ relative cost of each counted test
// (Object.keys is string[]; the keys of a cost record are known)
const diff = (b: Cost, a: Cost): Cost => Object.fromEntries((Object.keys(a) as (keyof Cost)[]).map((k) => [k, a[k] - b[k]])) as Cost;
function deskScene() {
  const a = actor('claude', slot('slot:desk:E1:0'));
  const others = layout.slots.filter((s) => s.tag === 'desk').slice(0, 24).map((s, i) => actor(`d${i}`, s));
  return { a, others };
}

test('an evaluation stays cheap (deterministic ray / segment budget, it runs 4× a second on the render thread)', () => {
  const { a, others } = deskScene();
  const c0 = followCost();
  scoreSpots({ a, others, W, nav, level: 0, cur: { th: 1, r: 2.3, h: 1.2 } });
  const c = diff(c0, followCost());
  const spots = FOLLOW.bearings * FOLLOW.dists.length * FOLLOW.heights.length + 1;
  assert.equal(c.spots, spots, 'every candidate scored exactly once');
  // 2 sightlines per viable spot + 10 clutter rays for the front runners and the kept spot
  assert.ok(c.rays <= 2 * spots + FG_N * (FOLLOW.clutterTop + 1), `${c.rays} rays`);
  assert.ok(c.walls <= 400, `${c.walls} wall crossing tests (bbox pre-reject keeps it ≈ 1 per ray)`);
  assert.ok(c.boxes <= 1400, `${c.boxes} furniture box clips`);
  assert.ok(c.samples <= 2600, `${c.samples} zone-ceiling samples`);
  assert.ok(c.actors <= spots * others.length, `${c.actors} actor projections`);
  assert.ok(units(c) <= 5500, `${units(c)} work units per evaluation`);
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) scoreSpots({ a, others, W, nav, level: 0 });
  console.log(`# follow evaluation ${((performance.now() - t0) / 20).toFixed(2)} ms (info only) ${JSON.stringify(c)} units ${units(c)}`);
});

test('a re-evaluation is spread over 3 frames: no slice carries the whole pass', () => {
  const { a, others } = deskScene();
  const whole = diff(followCost(), (scoreSpots({ a, others, W, nav, level: 0, cur: { th: 1, r: 2.3, h: 1.2 } }), followCost()));
  const job = scoreBegin({ a, others, W, nav, level: 0, cur: { th: 1, r: 2.3, h: 1.2 } });
  const per: Cost[] = [];
  let list: ScoredSpot[] | null = null;
  while (!job.done) { const c0 = followCost(); if (scoreStep(job)) list = job.list; per.push(diff(c0, followCost())); }
  assert.equal(per.length, FOLLOW.evalSlices);
  const total = per.reduce((s, c) => s + units(c), 0);
  assert.ok(Math.abs(total - units(whole)) < 1e-6, 'slicing does the same work as one pass');
  for (const [i, c] of per.entries()) assert.ok(units(c) <= 0.5 * total, `slice ${i} does ${units(c)} of ${total} units`);
  // same answer as the one-shot pass
  const one = scoreSpots({ a, others, W, nav, level: 0, cur: { th: 1, r: 2.3, h: 1.2 } });
  assert.ok(list, 'the sliced job produced a list');
  assert.deepEqual([list[0].th, list[0].r, list[0].h], [one[0].th, one[0].r, one[0].h]);
  // the rig: follow start picks at once, later re-evaluations run one slice per frame
  const rig = createFollowRig({ layout: () => layout, nav: () => nav, others: () => [a, ...others] });
  rig.start(a, { x: a.pos.x, y: 1.6, z: a.pos.z + 2.4 });
  assert.ok(rig.info, 'a spot is chosen on start');
  const seen: number[] = [];
  for (let f = 0; f < 30; f++) { rig.step(1 / 60); if (rig.pending) seen.push(rig.pending.slice); }
  assert.ok(seen.length > 0 && Math.max(...seen) < FOLLOW.evalSlices, `in-flight slices ${seen}`);
});

// PLY m3 fix r3 (reviewers [playtest] hq-07-after, [fun] t-p-5): following an agent through a doorway / round a
// room the lens must never sit inside or flush against a wall (camera boom, ≥ FOLLOW.boomGap clearance), and a face
// hidden by walls / tall furniture for more than FOLLOW.losHold re-seats the camera (no staring at a wall).
const { lensClearance, boomSweep, faceHiddenFrom } = await import('./follow.ts');
const DOOR_WALKS: [string, { x: number; z: number }, { x: number; z: number }][] = [
  ['atrium → MAIL', { x: 4, z: -5.5 }, { x: 10, z: -9 }],
  ['MAIL → ARC', { x: 10, z: -9 }, { x: 16, z: -9 }],
  ['atrium → E2', { x: 0, z: -4 }, { x: -9, z: -3 }],
  ['Lobby → LAB', { x: -3, z: 12 }, { x: -10, z: 12 }],
  ['ENG → CAF', { x: 13, z: 2 }, { x: 13, z: 10 }],
  ['CAF → ENG', { x: 13, z: 10 }, { x: 10, z: -1 }],
];
/** Walk `a` along the nav path at 1.4 m/s under a follow rig; → {minClear, maxHidden (s), maxStep}. */
function followWalk(from: { x: number; z: number }, to: { x: number; z: number }, o: FollowOpts = FOLLOW) {
  const pts = nav.path({ ...from, level: 0 }, { ...to, level: 0 });
  assert.ok(pts && pts.length >= 2, `route ${JSON.stringify(from)} → ${JSON.stringify(to)}`);
  const a = { id: 'w', pos: { x: pts[0].x, y: 0, z: pts[0].z }, yaw: 0 };
  const rig = createFollowRig({ layout: () => layout, nav: () => nav, others: () => [a], o, faceYaw: () => a.yaw });
  // start behind it (the reviewer's go-there hand-over: the lens trails the walker)
  const d0x = pts[1].x - pts[0].x, d0z = pts[1].z - pts[0].z, l0 = Math.hypot(d0x, d0z) || 1;
  rig.start(a, { x: a.pos.x - (d0x / l0) * 2, y: 1.2, z: a.pos.z - (d0z / l0) * 2, yaw: 0, pitch: 0 });
  let i = 1, minClear = 9, hid = 0, maxHidden = 0, prev: EyePose | null = null, steps = 0, big = 0, pops = 0;
  const dt = 1 / 60;
  for (let f = 0; f < 60 * 30; f++) {
    if (i < pts.length) {
      const q = pts[i], dx = q.x - a.pos.x, dz = q.z - a.pos.z, l = Math.hypot(dx, dz), s = 1.4 * dt;
      if (l <= s) { a.pos.x = q.x; a.pos.z = q.z; i++; } else { a.pos.x += (dx / l) * s; a.pos.z += (dz / l) * s; a.yaw = Math.atan2(-dx, -dz); }
    } else if (f > 60 * 25) break;
    const e = rig.step(dt);
    assert.ok(e, 'the rig has a target');
    minClear = Math.min(minClear, lensClearance(W, 0, e.x, e.y, e.z, 2));
    if (faceHiddenFrom(W, 0, e.x, e.y, e.z, a)) { hid += dt; maxHidden = Math.max(maxHidden, hid); } else hid = 0;
    const st = prev && f > 30 ? Math.hypot(e.x - prev.x, e.y - prev.y, e.z - prev.z) : 0; // (after the start swing)
    if (st > 0.6) big++; else if (st > 0.2) pops++; // a cut / a boom pull-in pop
    prev = e; steps++;
  }
  assert.ok(i >= pts.length, 'the walk finished');
  return { minClear: +minClear.toFixed(3), maxHidden: +maxHidden.toFixed(2), cuts: big, pops, info: rig.info };
}

test('follow through doorways: the lens keeps ≥ boomGap from every wall, the face is never hidden > losHold + a check', () => {
  const OLD = { ...FOLLOW, boomGap: -1, losHold: 1e9 }; // the r2 rig: no boom, no occlusion watch (baseline, logged)
  let oldWorst = 9, oldHidden = 0;
  for (const [name, from, to] of DOOR_WALKS) {
    const r = followWalk(from, to);
    const o = followWalk(from, to, OLD);
    oldWorst = Math.min(oldWorst, o.minClear); oldHidden = Math.max(oldHidden, o.maxHidden);
    console.log(`# ${name}: clearance ${r.minClear} m (r2 rig ${o.minClear}), longest hidden ${r.maxHidden} s (r2 ${o.maxHidden}), cuts ${r.cuts} (r2 ${o.cuts}), pops ${r.pops} (r2 ${o.pops}), reseats ${r.info?.reseats}`);
    assert.ok(r.minClear >= FOLLOW.boomGap - 0.02, `${name}: lens ${r.minClear} m from a wall`);
    assert.ok(r.maxHidden <= FOLLOW.losHold + 2 * FOLLOW.losEvery + 0.05, `${name}: face hidden ${r.maxHidden} s`);
    assert.ok(r.cuts <= 3 && r.pops <= 4, `${name}: ${r.cuts} cuts, ${r.pops} pops`);
  }
  // the scenario is the reviewers': the r2 rig did end flush against / inside a wall on these walks
  assert.ok(oldWorst < 0.1, `baseline clearance ${oldWorst}`);
});

test('lensClearance / boomSweep: door openings count as open at door height, a crossed wall fails the sweep', () => {
  // MAIL door: wall x = 7.5, opening z −6.8…−5.4 (h 1.7)
  assert.ok(lensClearance(W, 0, 7.5, 1.2, -6.1, 2) > 0.55, 'the middle of a door is clear (0.6 m to the jambs)');
  assert.ok(lensClearance(W, 0, 7.5, 1.2, -7.2, 2) < 0.05, 'inside the wall beside it is not');
  assert.ok(Math.abs(lensClearance(W, 0, 7.9, 1.2, -9, 2) - 0.3) < 0.02, '0.4 m off the wall centreline = 0.3 m off its face');
  // boom from the atrium through the wall (not the door): stops short of the wall face
  const b = boomSweep(W, 0, 6, 0.85, -9, 9, 1.6, -9, 3);
  assert.ok(b > 0 && 6 + b <= 7.5 - 0.1 - FOLLOW.boomGap + 0.11, `boom ${b}`);
  // through the door: the full length
  assert.equal(boomSweep(W, 0, 6, 0.85, -6.1, 9, 1.6, -6.1, 3), 3);
});

test('a face hidden (a partition between lens and face) for > losHold re-seats the camera: a cut, no staring at it', () => {
  // a free-standing 1.4 m partition in the Café (below the boom's "tall = wall" height, so only the occlusion watch
  // can fix it): subject north of it, the lens parked south of it at face height
  const L2: Layout = { ...layout, furniture: [...layout.furniture, { id: 'test:screen', type: 'partition', pos: { x: 15, y: 0, z: 11.2 }, size: [3, 1.4, 0.2], yaw: 0, solid: false }] };
  const W2 = followWorld(L2);
  // the subject stands just north of it; a mouse nudge swings the lens round to the south side (behind the partition)
  const run = (o: FollowOpts) => {
    const a: TActor = { id: 's', pos: { x: 15, y: 0, z: 12 }, yaw: Math.PI };
    const rig = createFollowRig({ layout: () => L2, nav: () => nav, others: () => [a], o });
    rig.start(a, { x: 15, y: 1.4, z: 14, yaw: 0, pitch: 0 });
    for (let f = 0; f < 60; f++) rig.step(1 / 60);
    const e0 = rig.step(1 / 60);
    assert.ok(e0, 'the rig has a target');
    rig.nudge(Math.atan2(e0.x - 15, e0.z - 12) - Math.PI); // th → due south (the partition between)
    let hid = 0, maxHid = 0, e: EyePose = e0;
    for (let f = 0; f < 360; f++) {
      const stepped = rig.step(1 / 60);
      assert.ok(stepped, 'the rig has a target');
      e = stepped;
      if (f < FOLLOW.userHold * 60) continue; // the user's own framing is left alone while the nudge holds
      if (faceHiddenFrom(W2, 0, e.x, e.y, e.z, a)) { hid += 1 / 60; maxHid = Math.max(maxHid, hid); } else hid = 0;
    }
    return { maxHid, e, a, info: rig.info, hiddenAtNudge: faceHiddenFrom(W2, 0, 15, 1.4, 9.7, a) };
  };
  // the live rig: the scorer's own re-picks + the watch
  const live = run(FOLLOW);
  assert.ok(live.maxHid <= FOLLOW.losHold + 2 * FOLLOW.losEvery + 0.05, `live: hidden ${live.maxHid.toFixed(2)} s`);
  // the watch alone (re-picks frozen — the kept-spot hysteresis case): it must re-seat; without it the lens stares on
  const FROZEN = { ...FOLLOW, evalEvery: 1e9 };
  const r = run(FROZEN), old = run({ ...FROZEN, losHold: 1e9 });
  const { e, a } = r;
  assert.ok(r.hiddenAtNudge, 'south of the partition the face is hidden');
  assert.ok(old.maxHid > 4, `baseline stares at the partition (${old.maxHid.toFixed(2)} s)`);
  assert.ok(r.maxHid <= FOLLOW.losHold + 2 * FOLLOW.losEvery + 0.05, `hidden ${r.maxHid.toFixed(2)} s`);
  assert.ok((r.info?.reseats ?? 0) >= 1, 'the watch re-seated it');
  assert.ok(!faceHiddenFrom(W2, 0, e.x, e.y, e.z, a), 'sees the face');
  assert.ok(lensClearance(W2, 0, e.x, e.y, e.z, 1) >= FOLLOW.boomGap - 0.02, 'clear of walls');
  const maxHid = r.maxHid, ohMax = old.maxHid, rig = { info: r.info };
  console.log(`# partition: longest hidden ${maxHid.toFixed(2)} s with the watch (reseats ${rig.info?.reseats}), ${ohMax.toFixed(2)} s without (re-picks frozen); live rig ${live.maxHid.toFixed(2)} s`);
});
