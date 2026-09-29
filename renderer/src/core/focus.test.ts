// __hq.focus framing (createFocusShot): 3/4 offset, occlusion rejection, colliders, feet on the floor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createFocusShot, heroOrder, isSettled } from './debug.ts';
import type { FocusActor, FocusCtx, HqNav } from './debug.ts';
import { LAYERS } from '../render/layers.ts';
import { layout } from '../world/layout/proto.ts';
import { createNav } from '../world/nav/index.ts';

const actor = (id: string, x: number, z: number, yaw: number, y = 0): FocusActor => ({ id, pos: { x, y, z }, yaw });
const setup = (list: FocusActor[], { nav = null, scene = new THREE.Scene() }: { nav?: HqNav | null; scene?: THREE.Scene } = {}) => {
  const ctx: FocusCtx = { scene, player: { eyeHeight: 1.2 }, layout: { floorY: () => 0 } };
  scene.updateMatrixWorld(true);
  return createFocusShot({ ctx, actors: { list: () => list }, nav });
};
const offDeg = (a: FocusActor, pose: readonly number[]) => {
  // angle between the actor's facing and the actor→camera direction
  const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
  const dx = pose[0] - a.pos.x, dz = pose[2] - a.pos.z, l = Math.hypot(dx, dz);
  return (Math.acos((fx * dx + fz * dz) / l) * 180) / Math.PI;
};
const box = (x: number, y: number, z: number, w: number, h: number, d: number) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial());
  m.position.set(x, y, z); m.layers.set(LAYERS.PROPS);
  return m;
};

test('open floor: 3/4 view ~50° off facing, looking at the actor, feet on the floor', () => {
  const a = actor('a', 0, 0, 0.7, 0.32); // raised actor (e.g. on a step): camera feet still on the floor
  const s = setup([a])(a, 1.5, 1.1);
  assert.equal(s.clear, true);
  assert.ok(Math.abs(offDeg(a, s.pose) - 50) < 1, `off ${offDeg(a, s.pose)}`);
  assert.equal(s.pose[1], 0);
  const fx = -Math.sin(s.pose[3]), fz = -Math.cos(s.pose[3]);
  const dx = a.pos.x - s.pose[0], dz = a.pos.z - s.pose[2], l = Math.hypot(dx, dz);
  assert.ok((fx * dx + fz * dz) / l > 0.999, 'camera faces the actor');
  assert.ok(s.pose[4] < 0, 'looks slightly down');
});

test('an occluder on one side flips to the other side', () => {
  const a = actor('a', 0, 0, 0); // faces -z
  const first = setup([a])(a, 1.5, 1.1);
  const mid = [(first.pose[0] + a.pos.x) / 2, (first.pose[2] + a.pos.z) / 2];
  const scene = new THREE.Scene();
  scene.add(box(mid[0], 0.8, mid[1], 0.3, 1.6, 0.3)); // a monitor-ish slab between camera and actor
  const s = setup([a], { scene })(a, 1.5, 1.1);
  assert.equal(s.clear, true);
  assert.equal(s.side, -first.side);
});

test('other actors in the sightline or on the spot are avoided', () => {
  const a = actor('a', 0, 0, 0);
  const first = setup([a])(a, 1.5, 1.1);
  const b = actor('b', (first.pose[0] + a.pos.x) / 2, (first.pose[2] + a.pos.z) / 2, 0);
  const s = setup([a, b])(a, 1.5, 1.1);
  assert.equal(s.clear, true);
  assert.notEqual(s.side, first.side);
});

test('a thin pole between the eyes and a foreground actor beside the lens both count as occluding', () => {
  const a = actor('a', 0, 0, 0);
  const first = setup([a])(a, 1.5, 1.1);
  const dx = a.pos.x - first.pose[0], dz = a.pos.z - first.pose[2], l = Math.hypot(dx, dz);
  const ux = dx / l, uz = dz / l;
  // a 3 cm lamp pole on the camera → face-centre line (misses both eye sightlines and the body centre line)
  const fcx = a.pos.x - Math.sin(a.yaw) * 0.25, fcz = a.pos.z - Math.cos(a.yaw) * 0.25; // rig-less face centre
  const scene = new THREE.Scene();
  const pole = box(first.pose[0] + (fcx - first.pose[0]) * 0.6, 1.0, first.pose[2] + (fcz - first.pose[2]) * 0.6, 0.03, 2, 0.03);
  scene.add(pole);
  const s1 = setup([a], { scene })(a, 1.5, 1.1);
  assert.equal(s1.clear, true);
  assert.notEqual(s1.side, first.side);
  // an actor 0.6 m ahead of the lens, 0.5 m off the sightline (outside the 0.45 m corridor, but filling a frame corner)
  const b = actor('b', first.pose[0] + ux * 0.6 - uz * 0.5, first.pose[2] + uz * 0.6 + ux * 0.5, 0);
  const s2 = setup([a, b])(a, 1.5, 1.1);
  assert.equal(s2.clear, true);
  assert.notEqual(s2.side, first.side);
});

test('foreground clutter near the lens (a lamp pole off the sightlines) moves the camera', () => {
  const a = actor('a', 0, 0, 0);
  const first = setup([a])(a, 1.5, 1.1);
  const yaw = first.pose[3] + (12 * Math.PI) / 180; // 12° left of the view axis, 0.8 m out: in frame, off every sightline
  const scene = new THREE.Scene();
  scene.add(box(first.pose[0] - Math.sin(yaw) * 0.8, 1.0, first.pose[2] - Math.cos(yaw) * 0.8, 0.04, 2, 0.04));
  const s = setup([a], { scene })(a, 1.5, 1.1);
  assert.equal(s.clear, true);
  assert.ok(!s.miss?.length, `picked a spot with ${s.miss}`);
  assert.notEqual(s.side, first.side);
});

test('proto room: every desk seat gets a walkable, clear 3/4 spot (no camera inside colliders)', () => {
  const nav = createNav(layout);
  const seats = (layout.slots ?? []).filter((sl) => /desk/.test(sl.tag ?? sl.id));
  assert.ok(seats.length > 0);
  for (const sl of seats) {
    const a = actor(sl.id, sl.pos.x, sl.pos.z, sl.yaw ?? 0);
    const s = setup([a], { nav })(a, 1.5, 1.1);
    assert.ok(nav.walkable(s.pose[0], s.pose[2]) && !nav.collides(s.pose[0], s.pose[2], 0.22), `${sl.id} camera in a collider`);
    assert.ok(offDeg(a, s.pose) < 100, `${sl.id} camera behind the actor (${offDeg(a, s.pose)}°)`);
  }
});

test('desk mode: over-the-monitor front 3/4 — face ≥ 0.7 toward the lens, the monitor may hide the body', () => {
  const a = actor('a', 0, 0, 0); // faces -z; rig-less face centre at y 0.8
  const scene = new THREE.Scene();
  // a monitor 0.6 m in front of it, up to 0.75 m (the default side framing avoids it; desk mode looks over it)
  scene.add(box(0, 0.55, -0.6, 3, 0.4, 0.05));
  const plain = setup([a], { scene })(a, 1.5, 1.1);
  assert.ok(offDeg(a, plain.pose) > 45, 'default framing goes wide around the monitor');
  const s = setup([a], { scene })(a, 1.5, 1.1, null, { desk: true });
  assert.equal(s.clear, true);
  assert.equal(s.desk, true);
  assert.ok((s.facing ?? 0) >= 0.7, `facing ${s.facing}`);
  assert.ok(offDeg(a, s.pose) <= 45.5, `off ${offDeg(a, s.pose)}°`);
  assert.equal(s.pose[1], 0, 'feet on the floor');
});

test('desk mode: no front spot shows the face → not clear (never falls back to a side view)', () => {
  const a = actor('a', 0, 0, 0);
  const scene = new THREE.Scene();
  scene.add(box(0, 1.5, -0.5, 6, 3, 0.05)); // a floor-to-ceiling screen across the front
  const s = setup([a], { scene })(a, 1.5, 1.1, null, { desk: true });
  assert.equal(s.clear, false);
});

test('proto room: every desk seat gets a walkable front 3/4 spot in desk mode', () => {
  const nav = createNav(layout);
  const seats = (layout.slots ?? []).filter((sl) => sl.tag === 'desk');
  for (const sl of seats) {
    const a = actor(sl.id, sl.pos.x, sl.pos.z, sl.yaw ?? 0);
    a.intent = { slot: sl }; // auto desk mode from the slot tag
    const s = setup([a], { nav })(a, 1.5, 1.1);
    assert.equal(s.desk, true);
    assert.ok(nav.walkable(s.pose[0], s.pose[2]) && !nav.collides(s.pose[0], s.pose[2], 0.22), `${sl.id} camera in a collider`);
    assert.ok(s.clear && offDeg(a, s.pose) <= 45.5, `${sl.id}: off ${offDeg(a, s.pose)}° clear ${s.clear}`);
  }
});

test('heroOrder: settled actors first (desk before station), walkers last — a commuter is never the hero pick', () => {
  const mk = (id: string, tag: string, arrived: boolean, speed: number) => ({ id, arrived, intent: { slot: { tag } }, animator: { debug: { speed } } });
  const list = [
    mk('walkDesk', 'desk', false, 2), mk('walkStation', 'station:roundtable', false, 2),
    mk('station', 'station:roundtable', true, 0), mk('desk', 'desk', true, 0.01), mk('deskShuffle', 'desk', true, 0.5),
  ];
  assert.deepEqual(heroOrder(list).map((a) => a.id), ['desk', 'station', 'walkDesk', 'deskShuffle', 'walkStation']);
  assert.equal(isSettled(list[2]), true);
  assert.equal(isSettled(list[4]), false); // arrived but still moving (settling into the chair)
});
