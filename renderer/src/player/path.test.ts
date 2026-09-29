import test from 'node:test';
import assert from 'node:assert/strict';
import { createCamPath, rideEase, rideSpeed } from './path.ts';
import { sittable, pickSeat } from './seats.ts';
import { layout } from '../world/layout/hq.ts';
import type { Slot } from '../world/layout/schema.ts';
import type { P3 } from './path.ts';
import type { Occupancy } from './seats.ts';

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

test('slide path: ease-in profile, corner-free at ride speed', () => {
  assert.equal(rideEase(0, 0.65), 0); assert.equal(rideEase(1, 0.65), 1);
  assert.ok(rideSpeed(0, 0.65) < rideSpeed(1, 0.65));
  const P = createCamPath(layout.slide.path, { smooth: 0.5 });
  let prev: number[] | null = null, prev2: number[] | null = null, jerk = 0;
  for (let i = 0; i <= 132; i++) {
    const q = P.sample(rideEase(i / 132, 0.65) * P.length);
    const c = [q.x, q.y, q.z];
    if (prev && prev2) { const p1 = prev, p2 = prev2; jerk = Math.max(jerk, Math.hypot(...c.map((v, k) => v - 2 * p1[k] + p2[k]))); }
    prev2 = prev; prev = c;
  }
  assert.ok(jerk < 0.015, `max Δ² position ${jerk} m/frame² at 60 fps`);
});

test('seats: Pit sofas are sittable, Shelly benches and queue spots are not; the pick is the one under the reticle', () => {
  const seats = sittable(layout.slots);
  assert.ok(seats.some((s) => s.tag === 'sofa') && !seats.some((s) => s.tag === 'shellBench' || s.tag === 'queue'));
  const o = { radius: 1.6, cone: 0.45, nearR: 0.7, aimDeg: 15, hitR: 0.3 };
  const EYE = 1.2;
  const byId = (id: string): Slot => { const s = seats.find((q) => q.id === id); assert.ok(s, `seat ${id}`); return s; };
  /** Feet `dist` m in front of seat `s`, and a view ray from the eye at `yaw`/`pitch` (pitch null: aim at the cushion). */
  const stand = (s: Slot, dist = 1.0): P3 => ({ x: s.pos.x - Math.sin(s.yaw) * dist, y: s.pos.y, z: s.pos.z - Math.cos(s.yaw) * dist });
  const ray = (pos: P3, tx: number, ty: number, tz: number) => {
    const e = { x: pos.x, y: pos.y + EYE, z: pos.z }, dx = tx - e.x, dy = ty - e.y, dz = tz - e.z, n = Math.hypot(dx, dy, dz);
    return { ...e, dx: dx / n, dy: dy / n, dz: dz / n };
  };
  const level = (pos: P3, tx: number, tz: number) => ray(pos, tx, pos.y + EYE, tz);
  const pick = (pos: P3, r: ReturnType<typeof ray>, occ?: (s: Slot) => Occupancy) => pickSeat(seats, pos, 0, r, o, occ)?.slot.id ?? null;

  // stand 1 m in front of sofa:0 → sofa:0 (the spot is right on the N-gap beanbag: nearest-first used to pick it)
  const s0 = byId('slot:sofa:0'), pos = stand(s0);
  assert.ok(seats.some((q) => q.tag === 'beanbag' && Math.hypot(q.pos.x - pos.x, q.pos.z - pos.z) < o.nearR), 'a beanbag is nearer than the sofa');
  assert.equal(pick(pos, ray(pos, s0.pos.x, s0.pos.y + 0.4, s0.pos.z)), 'slot:sofa:0', 'reticle on the cushion');
  assert.equal(pick(pos, level(pos, s0.pos.x, s0.pos.z)), 'slot:sofa:0', 'eye-level view toward the sofa');
  // every Pit sofa, as the autopilot approaches it (0.75 m out, look at the cushion)
  for (const s of seats.filter((q) => q.tag === 'sofa')) {
    const at = stand(s, 0.75);
    assert.equal(pick(at, ray(at, s.pos.x, s.pos.y + 0.4, s.pos.z)), s.id, `aiming at ${s.id}`);
  }
  // looking down at the beanbag underfoot picks the beanbag
  const bb = seats.filter((q) => q.tag === 'beanbag').sort((a, b) => Math.hypot(a.pos.x - pos.x, a.pos.z - pos.z) - Math.hypot(b.pos.x - pos.x, b.pos.z - pos.z))[0];
  assert.equal(pick(pos, ray(pos, bb.pos.x, bb.pos.y + 0.2, bb.pos.z)), bb.id, 'reticle on the beanbag');
  // not when looking away; a taken seat under the reticle is not swapped for the beanbag
  assert.notEqual(pick(pos, level(pos, 2 * pos.x - s0.pos.x, 2 * pos.z - s0.pos.z)), 'slot:sofa:0', 'not when looking away');
  const taken = (q: Slot): Occupancy => (q.id === s0.id ? { busy: true } : null);
  assert.equal(pick(pos, ray(pos, s0.pos.x, s0.pos.y + 0.4, s0.pos.z), taken), null, 'taken: no sit hint, not a different seat');
  assert.equal(pick(pos, level(pos, s0.pos.x, s0.pos.z), taken), null, 'taken, eye-level view: still not the beanbag underfoot');
});
