import test from 'node:test';
import assert from 'node:assert/strict';
import { createCamPath, rideEase, rideSpeed } from './path.ts';

test('cam path: arc length, endpoints, unit tangents, smoothing keeps the ends', () => {
  const line = createCamPath([{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -2 }, { x: 0, y: 0, z: -4 }]);
  assert.ok(Math.abs(line.length - 4) < 1e-6);
  const s = line.sample(1);
  assert.ok(Math.abs(s.z + 1) < 1e-6 && Math.abs(s.tz + 1) < 1e-6);
  assert.ok(Math.abs(line.heading(2)) < 1e-9, 'heading north = yaw 0');
  const corner = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }];
  const sm = createCamPath(corner, { smooth: 0.4 });
  const a = sm.sample(0), b = sm.sample(sm.length);
  assert.ok(Math.hypot(a.x, a.z) < 1e-9 && Math.hypot(b.x - 1, b.z - 1) < 1e-9, 'ends pinned');
});

test('path traversal profile clamps endpoints and accelerates from the requested initial speed', () => {
  assert.equal(rideEase(-1, 0.65), 0);
  assert.equal(rideEase(2, 0.65), 1);
  assert.equal(rideSpeed(0, 0.65), 0.35);
  assert.equal(rideSpeed(1, 0.65), 1.65);
  const path = createCamPath([{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 4 }]);
  const halfwayInTime = path.sample(rideEase(0.5, 0.65) * path.length);
  assert.ok(Math.abs(halfwayInTime.z - 1.35) < 1e-9);
});

