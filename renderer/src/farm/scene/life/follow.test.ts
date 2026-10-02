import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Crumbs, followSpeed, heelSpot, trailWaypoint } from './follow.ts';

test('crumbs: one per spacing, newest first, a ring that keeps the latest, a teleport restarts the trail', () => {
  const c = new Crumbs(8, 1, 6);
  assert.equal(c.push(0, 0), 'add');
  assert.equal(c.push(0.5, 0), null);
  assert.equal(c.push(1.1, 0), 'add');
  for (let i = 2; i < 20; i++) c.push(i * 1.1, 0);
  assert.equal(c.n, 8);
  const p = { x: 0, z: 0 };
  assert.ok(c.get(0, p));
  assert.ok(Math.abs(p.x - 19 * 1.1) < 1e-4);
  assert.ok(c.get(7, p));
  assert.ok(Math.abs(p.x - 12 * 1.1) < 1e-4);
  assert.equal(c.get(8, p), false);
  assert.equal(c.push(100, 0), 'jump');
  assert.equal(c.n, 1);
});

test('trail waypoint: the newest visible crumb; round a wall it walks back along your trail', () => {
  // you walked east along z = 0 then north (−z) past a wall at x ∈ [4, 6], z ∈ [−10, −1]
  const c = new Crumbs(64, 1, 6);
  for (let x = 0; x <= 10; x++) c.push(x, 0);
  for (let z = -1; z >= -8; z--) c.push(10, z);
  const wall = (ax: number, az: number, bx: number, bz: number) => {
    for (let k = 0; k <= 20; k++) {
      const x = ax + (bx - ax) * k / 20, z = az + (bz - az) * k / 20;
      if (x > 4 && x < 6 && z < -1 && z > -10) return false;
    }
    return true;
  };
  const out = { x: 0, z: 0 };
  // the pet is west of the wall, north: it can't see the newest crumbs (east of the wall), so it heads for the trail
  const i = trailWaypoint(c, { x: 2, z: -6 }, wall, 64, out);
  assert.ok(i > 0, `index ${i}`);
  assert.ok(wall(2, -6, out.x, out.z));
  assert.ok(out.z >= -1, 'goes back down to the open stretch of trail');
  // in the open it takes the newest
  assert.equal(trailWaypoint(c, { x: 9, z: -3 }, () => true, 64, out), 0);
  assert.deepEqual(out, { x: 10, z: -8 });
  // nothing visible: the nearest crumb, flagged negative
  assert.ok(trailWaypoint(c, { x: 5, z: 1 }, () => false, 8, out) < 0);
  assert.deepEqual(out, { x: 5, z: 0 });
});

test('heel spot: behind and to the left while walking, round in front when stopped', () => {
  const o = { x: 0, z: 0 };
  // yaw 0 looks north (−z): behind is +z, left is −x
  heelSpot(0, 0, 0, false, 0.9, o);
  assert.ok(o.z > 1 && o.x < -0.5, JSON.stringify(o));
  heelSpot(0, 0, 0, true, 0.9, o);
  assert.ok(o.z < -1 && o.x < 0, JSON.stringify(o));
  heelSpot(0, 0, Math.PI / 2, false, -0.9, o);
  // looking west (−x): behind is +x, right is −z
  assert.ok(o.x > 1 && o.z < -0.5, JSON.stringify(o));
});

test('follow speed: keeps your pace, sprints after a sprinter, eases in, never above max', () => {
  assert.equal(followSpeed(0.1, 0), 0);
  assert.ok(followSpeed(0.6, 0) < 1);
  assert.ok(followSpeed(1.5, 4.6) >= 4.6, 'walking: at least your pace');
  assert.ok(followSpeed(3, 8.2) >= 8.2 || followSpeed(3, 8.2) === 9, 'sprinting: runs to catch up');
  assert.equal(followSpeed(40, 8.2), 9);
  assert.equal(followSpeed(40, 8.2, 6), 6);
  let prev = 0;
  for (let g = 0.3; g < 10; g += 0.3) { const v = followSpeed(g, 2); assert.ok(v >= prev - 1e-9); prev = v; }
});
