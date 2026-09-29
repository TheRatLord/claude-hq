// Go-there controller (goThereCtl.ts; PLY m3 fix r3, reviewer [code]: the state machine moved out of ui/index.ts).
// Driven through a fake ctx: a scripted stand search, a fake glide, a fake follow / HUD, and a clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoThereCtl, walkingOf, SETTLE, TRACK_MS } from './goThereCtl.ts';
import { GO } from './goThere.ts';
import type { GoActor, GoSlot, PoseArr } from './goThere.ts';
import type { GoPlayer, GoStand, GoStandJob } from './goThereCtl.ts';
import type { Layout } from '../world/layout/schema.ts';
import { fake } from '../core/testDoubles.ts';
import { layout } from '../world/layout/hq.ts';

const desk: GoSlot & { yaw: number } = { id: 'slot:desk:E1:0', tag: 'desk', pose: 'sit', pos: { x: -10, y: 0, z: -10 }, yaw: 0 };
const sofa: GoSlot & { yaw: number } = { id: 'slot:sofa:1', tag: 'sofa', pose: 'sit', pos: { x: 0, y: 0, z: 0 }, yaw: 0 };
const seated = (o: Partial<GoActor> = {}): GoActor => ({ id: 'ada', pos: { x: -10, y: 0, z: -10 }, yaw: 0, arrived: true, moving: false, intent: { slot: desk }, ...o });

interface Glide { t0: number; to: PoseArr | null }

/** A fake UI around the controller. `spots`: what the next stand searches return (in order; the last repeats). */
function rig({ actor = seated(), spots = [{ x: -10, y: 0, z: -8, yaw: 0, pitch: -0.1, tier: 1 }], slices = 2, L = fake<Layout>({}) }: { actor?: GoActor | null; spots?: GoStand[]; slices?: number; L?: Layout } = {}) {
  let t = 1000;
  const log: unknown[][] = [];
  const S: { actor: GoActor | null; glide: Glide | null; followId: string | null; pose: [number, number, number, number, number]; selected: string | null; hint: string | null; spots: GoStand[]; searches: number } =
    { actor, glide: null, followId: null, pose: [0, 0, 0, 0, 0], selected: null, hint: null, spots: [...spots], searches: 0 };
  // what each running scripted search still has to do (the controller only sees the `GoStandJob` handle)
  const jobs = new WeakMap<GoStandJob, { left: number; r: GoStand | undefined }>();
  const player: GoPlayer = { eyeHeight: 1.2, getPose: () => [...S.pose] };
  const c = createGoThereCtl({
    now: () => t,
    actorOf: (id) => (S.actor && S.actor.id === id ? S.actor : null),
    player: () => player, layout: () => L,
    destOf: (a) => {
      const slot = a.intent?.slot;
      assert.ok(slot?.id, 'an actor with a slot');
      return { id: a.id, pos: { ...slot.pos }, dest: slot.id, slot };
    },
    standBegin: (a) => { S.searches++; const r = S.spots.length > 1 ? S.spots.shift() : S.spots[0]; const job: GoStandJob = { result: undefined }; jobs.set(job, { left: slices, r }); return { t: a, job }; },
    standStep: (job) => { const st = jobs.get(job); if (!st) return true; if (--st.left > 0) return false; job.result = st.r ? { ...st.r } : null; return true; },
    glideTo: (a, s, o) => { log.push(['glide', a.id, s && { x: s.x, z: s.z }, !!o.quiet]); S.glide = { t0: t, to: s ? [s.x, s.y ?? 0, s.z, s.yaw, s.pitch ?? 0] : null }; if (!o.keepTrack) c.dropTrack(); },
    turnTo: (pose, id) => { log.push(['turn', id]); S.glide = { t0: t, to: pose }; },
    glide: () => (S.glide?.to ? { t: Math.min(1, (t - S.glide.t0) / 600), to: S.glide.to } : null),
    follow: (id, o) => { log.push(['follow', id, !!o?.auto]); S.followId = id; c.dropTrack(); },
    stopFollow: () => { log.push(['stopFollow']); S.followId = null; },
    followingId: () => S.followId,
    select: (id) => { S.selected = id; },
    hud: { aim: (x) => { S.hint = x; }, flash: (x) => log.push(['flash', x]), toast: (_k, x) => log.push(['toast', x]) },
    label: (a) => a.id,
  });
  /** advance `ms` in 16 ms frames; a running glide lands at 600 ms (then the pose is its target) */
  const run = (ms: number) => {
    for (let e = 0; e < ms; e += 16) {
      t += 16;
      if (S.glide && t - S.glide.t0 >= 600) { if (S.glide.to) S.pose = [...S.glide.to]; S.glide = null; c.landed([...S.pose]); }
      c.update(t);
    }
  };
  return { c, S, log, run, now: () => t };
}

test('goTo a seated agent: budgeted search ("finding a spot…" meanwhile), glide to the spot, select, hint cleared', () => {
  const { c, S, log, run } = rig();
  c.goTo('ada');
  assert.equal(S.hint, 'finding a spot…');
  assert.equal(c.searching(), true);
  assert.equal(S.selected, 'ada');
  run(16);
  assert.equal(c.searching(), false);
  assert.equal(S.hint, null, 'hint cleared when the search lands');
  assert.deepEqual(log.find((e) => e[0] === 'glide'), ['glide', 'ada', { x: -10, z: -8 }, false]);
  assert.deepEqual(c.trackInfo(), { id: 'ada', key: desk.id, n: 0 });
});

test('the hint never outlives GO.hintMaxMs, even while a slow search runs', () => {
  const { c, S, run } = rig({ slices: 1e6 });
  c.goTo('ada');
  run(GO.hintMaxMs - 100);
  assert.equal(S.hint, 'finding a spot…');
  run(200);
  assert.equal(S.hint, null);
});

test('goTo a walker: the follow rig (auto) until it has settled SETTLE.holdMs, then the walk-up search', () => {
  const a = seated({ arrived: false, moving: true });
  const { c, S, log, run } = rig({ actor: a });
  assert.equal(walkingOf(a), true);
  c.goTo('ada');
  assert.deepEqual(log[0], ['follow', 'ada', true]);
  assert.match(String(log[1][1]), /following ada until it settles/);
  assert.equal(c.searching(), false);
  run(1000);
  assert.ok(c.settleInfo(), 'still waiting');
  a.arrived = true; a.moving = false;
  run(SETTLE.holdMs + 100);
  assert.equal(c.settleInfo(), null);
  assert.ok(log.some((e) => e[0] === 'stopFollow'));
  assert.ok(log.some((e) => e[0] === 'glide'), 'walked up once settled');
});

test('the user taking the follow (another id / none) ends the settle watch', () => {
  const a = seated({ arrived: false, moving: true });
  const { c, S, run } = rig({ actor: a });
  c.goTo('ada');
  S.followId = null;
  run(200);
  assert.equal(c.settleInfo(), null);
});

test('tracking: a new slot while the glide runs hands over to the follow rig; once landed it just ends the watch', () => {
  const a = seated();
  const r1 = rig({ actor: a });
  r1.c.goTo('ada');
  r1.run(100); // gliding
  a.intent = { slot: sofa }; a.arrived = false; a.moving = true;
  r1.run(TRACK_MS + 50);
  assert.ok(r1.log.some((e) => e[0] === 'follow' && e[2] === true), 'followed during the glide');
  assert.equal(r1.c.trackInfo(), null);

  const b = seated();
  const r2 = rig({ actor: b });
  r2.c.goTo('ada');
  r2.run(900); // landed, watching
  assert.ok(r2.c.trackInfo(), 'the landed go-there watches');
  b.intent = { slot: sofa }; b.arrived = false; b.moving = true;
  r2.run(TRACK_MS + 50);
  assert.equal(r2.c.trackInfo(), null, 'watch ended');
  assert.ok(!r2.log.some((e) => e[0] === 'follow'), 'never an automatic follow after landing (UI fix r3)');
});

test('any look / move off the landed pose ends tracking; cancel / endAuto drop it and a pending re-aim', () => {
  const { c, S, run } = rig();
  c.goTo('ada');
  run(900);
  assert.ok(c.trackInfo());
  S.pose[3] += 0.1; // looked away
  run(50);
  assert.equal(c.trackInfo(), null);
  c.goTo('ada');
  assert.equal(c.active, true);
  c.cancel();
  assert.equal(c.active, false);
  c.goTo('ada'); run(900);
  c.endAuto();
  assert.equal(c.trackInfo(), null);
});

test('re-aims: the agent arriving somewhere new re-searches; re-glides only when the spot moved, ≤ GO.maxRetargets', () => {
  const a = seated();
  const spots = Array.from({ length: 40 }, (_, i) => ({ x: -10 + (i % 2), y: 0, z: -8, yaw: 0, pitch: -0.1, tier: 1 }));
  const { c, S, log, run } = rig({ actor: a, spots });
  // it keeps re-deciding (a new slot key each time, same place, arrived): each is a new destination to re-frame
  c.goTo('ada');
  for (let k = 0; k < 20; k++) {
    a.intent = { slot: { ...desk, id: `slot:desk:X:${k}`, pos: { x: -10, y: 0, z: -10 } } }; // new key, same place, arrived
    run(TRACK_MS + 40);
  }
  const re = log.filter((e) => e[0] === 'glide').length - 1;
  assert.ok(re >= 1, 're-aimed');
  assert.ok((c.trackInfo()?.n ?? GO.maxRetargets) <= GO.maxRetargets && re <= GO.maxRetargets, `${re} re-aims`);
});

test('line of sight: a face hidden ≥ GO.losHoldMs after landing searches again (forced re-glide)', () => {
  // hq layout: the lens in the atrium, the agent behind the MAIL wall (x = 7.5, solid at z = −10)
  const a = seated({ pos: { x: 9.5, y: 0, z: -10 }, intent: { slot: { ...desk, pos: { x: 9.5, y: 0, z: -10 } } } });
  const spot = { x: 5.5, y: 0, z: -10, yaw: -Math.PI / 2, pitch: 0, tier: null }; // behind the wall
  const { c, S, log, run } = rig({ actor: a, spots: [spot], L: layout });
  c.goTo('ada');
  run(900);
  const before = S.searches;
  run(GO.losHoldMs + 2 * TRACK_MS);
  assert.ok(S.searches > before, 'searched again');
  assert.ok(log.filter((e) => e[0] === 'glide').length >= 2, 'forced re-glide');
});

test('seat memo: per agent, pruned through the ctx hook; floorPoint never ends on a seat', () => {
  const { c } = rig({ L: layout });
  c.seatsOf('ada'); c.seatsOf('bob');
  assert.equal(c.seatMemo.size, 2);
  const seat = layout.slots.find((q) => q.pose === 'sit' && (q.level ?? 0) === 0);
  assert.ok(seat, 'a ground-floor seat');
  const p = c.floorPoint(seat.pos.x, seat.pos.z);
  assert.ok(Math.hypot(p.x - seat.pos.x, p.z - seat.pos.z) >= GO.seatClear - 1e-6, 'moved off the seat');
  let pruned = 0;
  const c2 = createGoThereCtl({ actorOf: () => null, player: () => null, layout: () => null, destOf: () => ({ pos: { x: 0, z: 0 }, dest: '' }), standBegin: (a) => ({ t: a, job: {} }), standStep: () => true, glideTo() {}, turnTo() {}, glide: () => null, follow() {}, stopFollow() {}, followingId: () => null, select() {}, hud: { aim() {}, flash() {}, toast() {} }, label: () => '', prune: () => { pruned++; } });
  c2.seatsOf('x');
  assert.equal(pruned, 1);
});

test('no player / unknown agent: a toast, nothing started', () => {
  const { c, log } = rig({ actor: null });
  c.goTo('ada');
  assert.deepEqual(log, [['toast', 'Not in this room.']]);
  assert.equal(c.active, false);
});
