// Manager's desk (manager.ts): the rail desk on the Pit axis, an overhead view of the Pit, pan limits, click pick.
import test from 'node:test';
import assert from 'node:assert/strict';
import { managerDesk, managerView, panStep, pickAt, MANAGER } from './manager.ts';
import { layout } from '../world/layout/hq.ts';

test('managerDesk: the mezzanine hot desk nearest the Pit axis, with its stool', () => {
  const d = managerDesk(layout);
  assert.ok(d && d.slotId, 'desk + seat');
  const pit = layout.points.pitCenter;
  const hot = layout.furniture.filter((f) => f.type === 'hotDesk');
  assert.ok(hot.every((f) => Math.abs(f.pos.x - pit.x) >= Math.abs(d.x - pit.x) - 1e-9));
  assert.ok(d.y > 2.5, 'on the mezzanine');
});

test('managerView: over the atrium, under the roof, the Pit centred ahead', () => {
  const v = managerView(layout);
  assert.ok(v.y > 4 && v.y < 5.5, `eye y ${v.y}`);
  assert.ok(v.pitch < -0.45 && v.pitch > -1.1, `pitch ${v.pitch}`);
  const pit = layout.points.pitCenter;
  const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), dx = pit.x - v.x, dz = pit.z - v.z;
  assert.ok((dx * fx + dz * fz) / Math.hypot(dx, dz) > 0.999, 'Pit on the view axis');
  assert.equal(layout.zoneAt(v.x, v.z, 0), 'ATR', 'hangs over the atrium');
});

test('panStep: W pushes the focus away from the camera, clamped to the pan box', () => {
  const v = managerView(layout);
  const pan = { x: 0, z: 0 };
  panStep(pan, v.yaw, { f: 1, r: 0 }, 0.25);
  const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
  assert.ok(pan.x * fx + pan.z * fz > 0.9, 'moved forward');
  for (let i = 0; i < 100; i++) panStep(pan, v.yaw, { f: 1, r: 1 }, 0.1);
  assert.ok(Math.abs(pan.x) <= MANAGER.pan[0] + 1e-9 && Math.abs(pan.z) <= MANAGER.pan[1] + 1e-9);
});

test('pickAt: the actor under the click (nearest projected body), nothing on empty floor', () => {
  const actors = [{ id: 'a', pos: { x: 0, y: 0, z: 0 } }, { id: 'b', pos: { x: 1, y: 0, z: 0 } }, { id: 'h', pos: { x: 0.02, y: 0, z: 0 }, hidden: true }];
  const project = (x: number, y: number, z: number): [number, number, number] => [x / 5, (y - 0.45) / 5 - z / 5, 0.5];
  assert.equal(pickAt(0.2, 0, actors, project, 1), 'b');
  assert.equal(pickAt(0.01, 0.005, actors, project, 1), 'a');
  assert.equal(pickAt(-0.8, 0.8, actors, project, 1), null);
});
