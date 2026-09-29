// go-there camera helpers (goThere.ts; reviewer m3-r1 [playtest]: going to gale at the ping-pong table ended facing a
// Nap Nook bunk, hint stuck on "finding a spot…").
import test from 'node:test';
import assert from 'node:assert/strict';
import { goDest, headingToSlot, movedFar, faceTurn, hintDue, GO, slotChanged, noteSeat, keepOffFor, keptOff, faceHidden, trailNote, trailHit, floorSpot } from './goThere.ts';
import { layout } from '../world/layout/hq.ts';
import { createNav } from '../world/nav/index.ts';
import { followWorld } from './follow.ts';
import { pickStand, destOf as uiDestOf } from '../ui/goto.ts';
import type { GoActor, GoSlot, SeatMemo, PoseArr } from './goThere.ts';
import type { Slot } from '../world/layout/schema.ts';

const bunk: GoSlot & { yaw: number } = { id: 'slot:nap:1', tag: 'nap', pos: { x: 19.5, y: 0, z: 9.5 }, yaw: 0 };
const destOf = (a: GoActor) => {
  const slot = a.intent?.slot;
  assert.ok(slot, 'an actor with a slot');
  return { id: a.id, pos: { ...slot.pos }, dest: slot.id, slot };
};

test('goDest: a gig walker (ping-pong) is framed where it is, not at its stale chill slot', () => {
  // walking to the table (path ends 6 m from the bunk its intent still names)
  const gale = { id: 'gale', pos: { x: 13, y: 0, z: 4 }, arrived: false, intent: { slot: bunk }, path: [{ x: 13, z: 4 }, { x: 14.2, z: 3.1 }], pathI: 1 };
  assert.equal(headingToSlot(gale), false);
  assert.equal(goDest(gale, destOf), gale);
  // rallying at the table: path used up, not "arrived" at its slot
  const rally = { ...gale, path: [{ x: 13, z: 4 }, { x: 14.2, z: 3.1 }], pathI: 2 };
  assert.equal(goDest(rally, destOf), rally);
});

test('goDest: a walker whose route ends at its slot is framed at the slot (m2-r3 behaviour kept)', () => {
  const w = { id: 'w', pos: { x: 10, y: 0, z: 4 }, arrived: false, intent: { slot: bunk }, path: [{ x: 10, z: 4 }, { x: 15, z: 8 }, { x: 19.4, z: 9.3 }], pathI: 1 };
  assert.equal(headingToSlot(w), true);
  const dest = goDest(w, destOf);
  assert.ok('dest' in dest, 'framed at the slot, not at itself');
  assert.equal(dest.dest, bunk.id);
  // a fresh plan (no route yet) also counts as heading there; an arrived agent is itself
  assert.equal(headingToSlot({ ...w, path: [], pathI: 0 }), true);
  const here = { ...w, arrived: true };
  assert.equal(goDest(here, destOf), here);
});

test('movedFar: re-target past GO.retargetM only', () => {
  assert.equal(movedFar({ x: 0, z: 0 }, { x: 1.5, z: 1.0 }), false);
  assert.equal(movedFar({ x: 0, z: 0 }, { x: GO.retargetM + 0.1, z: 0 }), true);
  assert.equal(movedFar(null, { x: 9, z: 9 }), false);
});

test('faceTurn: ends facing the agent; no turn when it is already on the view axis', () => {
  const a = { pos: { x: 0, y: 0, z: -2 } };
  // looking straight at it (yaw 0 = −z), pitch at its face
  const pitch = Math.atan2(GO.faceY.stand - GO.eyeH, 2);
  assert.equal(faceTurn([0, 0, 0, 0, pitch], a), null);
  // it walked 2.5 m to the side: turn ≈ 51° toward it
  const t = faceTurn([0, 0, 0, 0, pitch], { pos: { x: -2.5, y: 0, z: -2 } });
  assert.ok(t, 'a turn');
  assert.deepEqual(t.slice(0, 3), [0, 0, 0], 'turns in place');
  assert.ok(Math.abs(t[3] - Math.atan2(2.5, 2)) < 1e-9, `yaw ${t[3]}`);
  // a bunk behind the camera (the reviewer shot) → a turn of ~180° the short way
  const back = faceTurn([0, 0, 0, 0, 0], { pos: { x: 0.1, y: 0, z: 3 } });
  assert.ok(back, 'a turn');
  assert.ok(Math.abs(Math.abs(back[3]) - Math.PI) < 0.1);
});

test('hintDue: the "finding a spot…" hint never outlives GO.hintMaxMs', () => {
  assert.equal(hintDue(1000, 1000 + GO.hintMaxMs - 1), false);
  assert.equal(hintDue(1000, 1000 + GO.hintMaxMs), true);
});

// ---- PLY m3 fix r2 (reviewer m3-r2 [playtest] 29-map-dev-5, 12-now) ----
const slotById = (id: string): Slot => { const s = layout.slots.find((q) => q.id === id); assert.ok(s, `slot ${id}`); return s; };

test('slotChanged: any new slot id re-targets, even a 1.96 m hop (bench → card table)', () => {
  const bench = slotById('slot:shellBench:0'), cards = slotById('slot:cards:3');
  assert.ok(Math.hypot(bench.pos.x - cards.pos.x, bench.pos.z - cards.pos.z) < GO.retargetM, 'the reviewer case is under retargetM');
  const dev = { id: 'dev', pos: { ...bench.pos }, arrived: true, intent: { slot: bench } };
  const track = { slotId: bench.id };
  assert.equal(slotChanged(track, dev), false);
  assert.equal(slotChanged(track, { ...dev, arrived: false, intent: { slot: cards } }), true);
  assert.equal(slotChanged({}, dev), false, 'no slot recorded yet: nothing to compare');
  assert.equal(slotChanged(null, dev), false);
});

test('noteSeat / keepOffFor: its own seats and (while the target is its slot) its body are kept off; the target seat is not', () => {
  const bench = slotById('slot:shellBench:0'), cards = slotById('slot:cards:3');
  const memo: SeatMemo[] = [];
  const dev = { id: 'dev', pos: { ...bench.pos }, arrived: true, settledSlot: bench, intent: { slot: bench } };
  noteSeat(memo, dev, 0);
  noteSeat(memo, dev, 10); // no duplicate
  assert.equal(memo.length, 1);
  // it got up for the card table and hasn't moved yet: the search frames cards:3 (a stand-in)
  const up = { ...dev, arrived: false, settledSlot: null, intent: { slot: cards } };
  const t = uiDestOf(up);
  assert.notEqual(t, up);
  const keep = keepOffFor(up, t, memo);
  assert.ok(keptOff(keep, bench.pos.x, bench.pos.z), 'the bench seat it is leaving');
  assert.ok(keptOff(keep, up.pos.x + 0.3, up.pos.z), 'its body');
  assert.equal(keptOff(keep, cards.pos.x + 2, cards.pos.z), false);
  // settled at the card table: the card seat (the target) is never a keep-off (minDist covers it), the bench still is
  const sat = { ...up, pos: { ...cards.pos }, arrived: true, settledSlot: cards };
  noteSeat(memo, sat, 20);
  const keep2 = keepOffFor(sat, sat, memo);
  assert.equal(keep2.length, 1);
  assert.ok(keptOff(keep2, bench.pos.x, bench.pos.z));
  // old seats are forgotten
  noteSeat(memo, sat, 20 + GO.seatMemoMs + 1);
  assert.equal(memo.length, 1);
});

test('stand search (goto.ts pickStand + keepOff): no spot on the seat it just left, nor on its body', () => {
  const nav = createNav(layout);
  const bench = slotById('slot:shellBench:0'), cards = slotById('slot:cards:3');
  const up = { id: 'dev', pos: { ...bench.pos }, yaw: bench.yaw, arrived: false, path: [], pathI: 0, intent: { slot: cards } };
  const t = uiDestOf(up);
  const base = { a: t, others: [up], layout, nav, eyeH: 1.2, faceYaw: t.yaw, from: { x: 0, z: 12.5, level: 0 } };
  const keep = keepOffFor(up, t, [{ ...bench.pos }]);
  const s = pickStand({ ...base, keepOff: keep });
  assert.ok(s, 'a spot');
  assert.ok(Math.hypot(s.x - bench.pos.x, s.z - bench.pos.z) >= GO.seatClear, `on the bench seat: ${s.x.toFixed(2)},${s.z.toFixed(2)}`);
  // the filter itself: keep the unconstrained winner off → the next search lands elsewhere
  const free = pickStand(base);
  assert.ok(free, 'an unconstrained spot');
  const s2 = pickStand({ ...base, keepOff: [{ x: free.x, z: free.z, r: GO.seatClear }] });
  assert.ok(s2 && Math.hypot(s2.x - free.x, s2.z - free.z) >= GO.seatClear);
});

test('faceHidden: a wall between the lens and the face hides it; the same spot on its side does not', () => {
  const W = followWorld(layout);
  const wall = layout.walls.find((w) => (w.level ?? 0) === 0 && (w.kind ?? 'wall') === 'wall' && Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) > 4 && !(w.openings?.length));
  assert.ok(wall, 'a plain wall');
  const mx = (wall.a[0] + wall.b[0]) / 2, mz = (wall.a[1] + wall.b[1]) / 2;
  const L = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]), nx = -(wall.b[1] - wall.a[1]) / L, nz = (wall.b[0] - wall.a[0]) / L;
  const a = { pos: { x: mx + nx * 0.8, y: 0, z: mz + nz * 0.8 } };
  const behind: PoseArr = [mx - nx * 1.4, 0, mz - nz * 1.4, 0, 0], front: PoseArr = [mx + nx * 2.6, 0, mz + nz * 2.6, 0, 0];
  assert.equal(faceHidden(W, 0, behind, a), true);
  assert.equal(faceHidden(W, 0, front, a), false);
});

test('trailHit: a map click where an agent just was goes to it (29-map-dev-5: dev left its bench for the cards)', () => {
  const bench = slotById('slot:shellBench:0'), cards = slotById('slot:cards:3');
  const trail = new Map();
  // dev walks bench → card table over 2 s, sampled every frame
  for (let t = 0; t <= 2000; t += 16) { const u = t / 2000; trailNote(trail, 'dev', bench.pos.x + (cards.pos.x - bench.pos.x) * u, bench.pos.z + (cards.pos.z - bench.pos.z) * u, t); }
  trailNote(trail, 'git', 20, 20, 2000);
  assert.ok(trail.get('dev').length <= GO.trailMs / GO.trailStepMs + 2, 'bounded samples');
  const r = 0.5; // ≈ 14 px on the overview
  assert.equal(trailHit(trail, bench.pos.x, bench.pos.z, 2500, r), 'dev', 'its old seat, 0.5 s after it left');
  assert.equal(trailHit(trail, bench.pos.x, bench.pos.z, 2000 + GO.trailMs + 1, r), null, 'too long ago: a floor walk');
  assert.equal(trailHit(trail, 5, 5, 2500, r), null);
});

test('floorSpot: a floor walk never ends on a seat; a free spot is kept', () => {
  const seats = layout.slots.filter((q) => q.pose === 'sit' && (q.level ?? 0) === 0).map((q) => q.pos);
  const nav = createNav(layout);
  const walkable = (x: number, z: number) => nav.walkable(x, z, 0, { owner: '*' });
  const bench = slotById('slot:shellBench:0');
  const p = floorSpot(bench.pos.x, bench.pos.z, { walkable, seats });
  assert.ok(seats.every((q) => Math.hypot(q.x - p.x, q.z - p.z) >= GO.seatClear - 1e-9), `on a seat: ${p.x},${p.z}`);
  assert.ok(walkable(p.x, p.z));
  assert.ok(Math.hypot(p.x - bench.pos.x, p.z - bench.pos.z) <= 1.5);
  assert.deepEqual(floorSpot(0, 12.5, { walkable, seats }), { x: 0, z: 12.5 }, 'spawn is free');
});
