import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layout } from '../layout/proto.ts';
import { createNav } from './index.ts';

const nav = createNav(layout);

test('proto nav: every slot reachable from spawn', () => {
  const from = { x: layout.spawn[0], z: layout.spawn[2] };
  for (const s of layout.slots) {
    const p = nav.path(from, { x: s.pos.x, z: s.pos.z });
    assert.ok(p && p.length >= 2, `unreachable ${s.id}`);
  }
});

test('proto nav: path avoids solid furniture (samples stay walkable on the raw grid)', () => {
  const p = nav.path({ x: 0, z: 3.5 }, { x: 0, z: -3.8 });
  assert.ok(p && p.length > 2, 'must route around the middle pod');
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i];
    for (let t = 0; t <= 1; t += 0.05) assert.ok(nav.walkable(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t));
  }
});

test('proto nav: walls block, door is open, player circle collides with desks', () => {
  assert.equal(nav.walkable(0, -4.6), false);
  assert.equal(nav.walkable(5.9, 0.6), true, 'east door opening');
  const desk = layout.furniture.find((f) => f.type === 'desk');
  assert.ok(desk);
  assert.ok(nav.collides(desk.pos.x, desk.pos.z, 0.28));
  assert.ok(!nav.collides(0, 3.5, 0.28));
});

test('reservations: stable, no double booking', () => {
  const a = nav.reserve('desk', 'A'), b = nav.reserve('desk', 'B');
  assert.ok(a && b);
  assert.notEqual(a.id, b.id);
  assert.equal(nav.reserve('desk', 'A')?.id, a.id);
  nav.releaseAll('A');
  assert.equal(nav.holder(a.id), null);
});
