import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRUCTURES, clearance, heightAt } from '../../world/map.ts';
import { TRICKLES, trickleDist } from './features.ts';
import { meadowAt } from './meadow.ts';
import { WALL_RUNS } from './paths.ts';

test('cliff cascades run from high on the wall down to its foot, clear of the farm', () => {
  assert.ok(TRICKLES.length >= 3);
  for (const t of TRICKLES) {
    const a = t.pts[0], b = t.pts[t.pts.length - 1];
    assert.ok(a.y > 25, `spring high on the wall (${a.y})`);
    assert.ok(heightAt(b.x, b.z) < 9, 'ends at the foot of the wall');
    assert.equal(t.steep.length, t.pts.length);
    for (const p of t.pts) assert.ok(clearance(p.x, p.z) > 3, 'never crosses a road, field or structure');
    for (const p of t.pts) assert.ok(p.y >= heightAt(p.x, p.z) + 0.1, 'rides on top of the ground');
  }
  for (const s of STRUCTURES) assert.ok(trickleDist(s.x, s.z) > 10, `${s.id} is not in a cascade`);
});

test('meadow mosaic: soft weights in 0..1, three drift colours, deterministic', () => {
  const seen = new Set<number>();
  let clover = 0, sun = 0, bloom = 0;
  for (let z = -80; z <= 80; z += 4) for (let x = -80; x <= 80; x += 4) {
    const m = meadowAt(x, z);
    for (const v of [m.clover, m.sun, m.bloom]) assert.ok(v >= 0 && v <= 1);
    seen.add(m.slot);
    clover += +(m.clover > 0.5); sun += +(m.sun > 0.5); bloom += +(m.bloom > 0.5);
    assert.deepEqual(meadowAt(x, z), m);
  }
  assert.ok([...seen].every((s) => s === 0 || s === 1 || s === 2));
  // patches, not a wash: each kind covers some but far from all of the floor
  const n = 41 * 41;
  for (const k of [clover, sun, bloom]) assert.ok(k > n * 0.03 && k < n * 0.4, `coverage ${k / n}`);
});

test('dry-stone walls keep off the roads and fields', () => {
  for (const run of WALL_RUNS) for (const p of run) assert.ok(clearance(p.x, p.z) > 1.4);
});
