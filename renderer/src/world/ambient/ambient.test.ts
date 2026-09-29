// Pure logic of the ambient cast (AMB): selectors, the hottest-cabinet pick, the fan curve, boids bounds, the walker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { oldestBlocked, herdrOffline, offlineKind, createWalker, angDiff, rng } from './util.ts';
import type { Vec2 } from './util.ts';
import { hottestCabinet, RACK_CABS } from './cat.ts';
import { fanRps } from './fans.ts';
import { boidsStep, FISH_N } from './fish.ts';

test('oldestBlocked: smallest statusSince among blocked, stable tie-break, null when none', () => {
  const E = [
    { id: 'a', status: 'working', statusSince: 1 },
    { id: 'b', status: 'blocked', statusSince: 50 },
    { id: 'c', status: 'blocked', statusSince: 20 },
    { id: 'd', status: 'blocked', statusSince: 20 },
  ];
  assert.equal(oldestBlocked(E)?.id, 'c');
  assert.equal(oldestBlocked([{ id: 'x', status: 'idle' }]), null);
  assert.equal(oldestBlocked([]), null);
});

test('herdrOffline: demo never, closed socket or herdr down → offline', () => {
  assert.equal(herdrOffline({ demo: true, conn: { state: 'closed' }, herdr: { connected: false } }), false);
  assert.equal(herdrOffline({ demo: false, conn: { state: 'open' }, herdr: { connected: true } }), false);
  assert.equal(herdrOffline({ demo: false, conn: { state: 'open' }, herdr: { connected: false } }), true);
  assert.equal(herdrOffline({ demo: false, conn: { state: 'reconnecting' }, herdr: { connected: true } }), true);
  assert.equal(herdrOffline(null), false);
  assert.equal(offlineKind({ demo: false, conn: { state: 'open' }, herdr: { connected: false } }), 'herdr');
  assert.equal(offlineKind({ demo: false, conn: { state: 'closed' }, herdr: { connected: false } }), 'hq');
  assert.equal(offlineKind({ demo: false, conn: { state: 'open' }, herdr: { connected: true } }), null);
});

test('hottestCabinet: 16 threads → 4 cabinets, hysteresis keeps the current one', () => {
  const ema = new Array(16).fill(10);
  for (let i = 8; i < 12; i++) ema[i] = 80; // cabinet 2 hot
  assert.equal(hottestCabinet(ema, 0), 2);
  const near = new Array(16).fill(10); near[0] = 20; // cabinet 0 only +10 over the rest
  assert.equal(hottestCabinet(near, 1), 1, 'below the hysteresis the cat stays put');
  assert.equal(hottestCabinet(null, 3), 3);
  const odd = new Array(6).fill(0); odd[5] = 100;
  const c = hottestCabinet(odd, 0);
  assert.ok(c >= 0 && c < RACK_CABS);
});

test('fanRps: lazy at idle, monotonic in load, clamped', () => {
  const idle = fanRps(0, 16), half = fanRps(8, 16), full = fanRps(16, 16), silly = fanRps(500, 16);
  assert.ok(idle > 0 && idle < 0.2);
  assert.ok(half > idle && full > half);
  assert.ok(silly <= 1.61);
  assert.equal(fanRps(null, 16), fanRps(undefined, 0));
});

test('boidsStep: the school stays inside the water box and keeps swimming', () => {
  const r = rng(7);
  const box = { x: 0.7, y0: 0.8, y1: 1.2, z: 0.16 };
  const fish = Array.from({ length: FISH_N }, () => ({ p: [(r() - 0.5) * 1.4, 0.8 + r() * 0.4, (r() - 0.5) * 0.3], v: [0.1, 0, 0] }));
  for (let k = 0; k < 600; k++) boidsStep(fish, 1 / 60, box, k > 300 ? { x: 0.3, y: 1.0, z: 0.14 } : null);
  for (const f of fish) {
    assert.ok(Math.abs(f.p[0]) <= box.x + 1e-9 && f.p[1] >= box.y0 - 1e-9 && f.p[1] <= box.y1 + 1e-9 && Math.abs(f.p[2]) <= box.z + 1e-9);
    const s = Math.hypot(...f.v);
    assert.ok(s >= 0.049 && s <= 0.201, `speed ${s}`);
  }
});

test('walker: follows a routed path, waits while the router is PENDING, hops short off-grid legs', () => {
  const layout = { floorY: () => 0 };
  let pending = 2;
  const nav = { tryRoute: (a: Vec2, b: Vec2) => (pending-- > 0 ? undefined : { points: [a, { x: 1, z: 0 }, b] }) };
  const w = createWalker(nav, layout, { x: 0, z: 0 }, { speed: 1 });
  w.go({ x: 1, z: 1 });
  for (let i = 0; i < 2; i++) { w.update(1 / 60); assert.ok(w.pending, 'still pending'); }
  for (let i = 0; i < 400 && !w.done; i++) w.update(1 / 60);
  assert.ok(w.done);
  assert.ok(Math.hypot(w.pos.x - 1, w.pos.z - 1) < 0.05);
  const w2 = createWalker({ tryRoute: () => null }, layout, { x: 0, z: 0 }, { speed: 1 });
  w2.go({ x: 0.5, z: 0 });
  for (let i = 0; i < 200 && !w2.done; i++) w2.update(1 / 60);
  assert.ok(!w2.failed && Math.abs(w2.pos.x - 0.5) < 0.05, 'unroutable but near: direct hop');
  const w3 = createWalker({ tryRoute: () => null }, layout, { x: 0, z: 0 });
  w3.go({ x: 10, z: 0 }); w3.update(0.016);
  assert.ok(w3.failed, 'unroutable and far: fail, never walk through walls');
});

test('angDiff wraps to (−π, π]', () => {
  assert.ok(Math.abs(angDiff(0.1, Math.PI * 2 - 0.1) + 0.2) < 1e-9);
  assert.ok(Math.abs(angDiff(-3, 3) - (6 - Math.PI * 2)) < 1e-9);
});
