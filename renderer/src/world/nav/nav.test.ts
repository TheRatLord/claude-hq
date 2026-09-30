import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Layout, Portal } from '../layout/schema.ts';
import { createNav } from './index.ts';

const geometry: Layout = {
  bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
  obstacles: [{ pos: { x: 0, z: 0 }, size: [2, 4] }],
  walls: [{ a: [4, -4], b: [4, 4], h: 3, openings: [{ at: 3, w: 2, h: 2 }] }],
  slots: [
    { id: 'left', tag: 'position', pos: { x: -3, y: 0, z: 0 } },
    { id: 'right', tag: 'position', pos: { x: 3, y: 0, z: 0 } },
  ],
};

const from = { x: 0, z: 3.5 }, to = { x: 0, z: -3.5 };

test('navigation reaches positions on both sides of an obstacle', () => {
  const nav = createNav(geometry);
  for (const slot of geometry.slots ?? []) {
    const path = nav.path(from, slot.pos);
    assert.ok(path, `unreachable ${slot.id}`);
    assert.deepEqual(path[0], { ...from, level: 0 });
    assert.deepEqual(path.at(-1), { x: slot.pos.x, z: slot.pos.z, level: 0 });
  }
});

test('a path around a solid footprint stays walkable along every segment', () => {
  const nav = createNav(geometry);
  const path = nav.path(from, to);
  assert.ok(path && path.some((p) => Math.abs(p.x) > 1), 'must route around the footprint');
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    for (let t = 0; t <= 1; t += 0.05) assert.ok(nav.walkable(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t));
  }
});

test('finite bounds and walls block, sufficient wall gaps are open, circles collide with footprints', () => {
  const nav = createNav(geometry);
  assert.equal(nav.walkable(5.6, 0), false);
  assert.equal(nav.walkable(4, 3), false);
  assert.equal(nav.walkable(4, 0), true);
  assert.equal(nav.collides(0, 0, 0.28), true);
  assert.equal(nav.collides(from.x, from.z, 0.28), false);
});

test('reservations are stable and exclusive, choose nearest free positions, and can be released', () => {
  const nav = createNav(geometry);
  const a = nav.reserve('position', 'A', { x: 3, z: 0 });
  const b = nav.reserve('position', 'B', { x: 3, z: 0 });
  assert.equal(a?.id, 'right');
  assert.equal(b?.id, 'left');
  assert.equal(nav.reserve('position', 'C'), null);
  assert.equal(nav.reserve('position', 'A', { x: -3, z: 0 })?.id, a?.id);
  nav.releaseAll('A');
  assert.equal(nav.holder('right'), null);
  assert.equal(nav.holder('left'), 'B');
  assert.equal(nav.reserve('position', 'C')?.id, 'right');
  nav.release('right');
  assert.equal(nav.holder('right'), null);
});

test('budgeted searches resume after a frame reset while cached paths do not consume another search', () => {
  const nav = createNav(geometry, { searchesPerFrame: 1 });
  assert.ok(nav.tryRoute(from, to));
  const acrossFrom = { x: 3, z: 0 }, acrossTo = { x: -3, z: 0 };
  assert.equal(nav.tryRoute(acrossFrom, acrossTo), undefined);
  nav.frame();
  assert.ok(nav.tryRoute(acrossFrom, acrossTo));
  assert.ok(nav.tryRoute(from, to));
  assert.equal(nav.budgetStats().searches, 1);
});

test('generic portals preserve their centreline, distance, arbitrary level ids, and direction', () => {
  const portal: Portal = {
    id: 'connection', a: { x: -3, z: 0, level: 3 }, b: { x: 1, z: 0, level: 7 }, twoWay: true, len: 6,
    path: [{ x: -3, y: 0, z: 0 }, { x: -1, y: 2, z: 1 }, { x: 1, y: 4, z: 0 }],
  };
  const layout: Layout = { bounds: geometry.bounds, levels: [{ id: 3, y: 0 }, { id: 7, y: 4 }], portals: [portal] };
  const nav = createNav(layout);
  const a = { x: -4, z: 0, level: 3 }, b = { x: 2, z: 0, level: 7 };
  const forward = nav.route(a, b), reverse = nav.route(b, a);
  assert.ok(forward && reverse);
  assert.equal(forward.length, 8);
  assert.equal(reverse.length, 8);
  assert.deepEqual(forward.portals, ['connection']);
  assert.ok(forward.points.some((p) => p.x === -1 && p.z === 1 && p.portal === 'connection' && p.level === 3));
  assert.ok(reverse.points.some((p) => p.x === -1 && p.z === 1 && p.portal === 'connection' && p.level === 7));
  const oneWay = createNav({ ...layout, portals: [{ ...portal, twoWay: false }] });
  assert.equal(oneWay.route(b, a), null);
});
