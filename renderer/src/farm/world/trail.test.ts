import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SITES, STRUCTURES, TRAIL, TRAILS, POIS, heightAt, inSite, normalAt, pathAt } from './map.ts';
import { TRAIL_HW } from './trail.ts';
import { bridgeFloor, flightOf, platformFloor, spanOf, stairsFloor, STEP, treadTop } from '../scene/trail/decks.ts';

/** the player controller's wall test (player/controller.ts MAX_SLOPE at e = 0.6) */
const walkable = (x: number, z: number) => 1 - normalAt(x, z, 0.6).y < 0.42;

test('summit trail: the cut tread is walkable, centre and both edges, and as high as designed', () => {
  const bad: string[] = [];
  const pts = TRAIL.pts;
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i], q = pts[i + 1];
    if (p.kind === 'stairs' || p.kind === 'bridge') continue;
    const dx = q.x - p.x, dz = q.z - p.z, l = Math.hypot(dx, dz) || 1;
    for (const o of [0, -0.75, 0.75]) {
      const x = p.x - (dz / l) * o, z = p.z + (dx / l) * o;
      if (!walkable(x, z)) bad.push(`#${i} ${p.kind} (${x.toFixed(1)}, ${z.toFixed(1)}) off ${o}`);
    }
    if (p.kind === 'cut' && Math.abs(heightAt(p.x, p.z) - p.y) > 0.08) bad.push(`#${i} tread at ${heightAt(p.x, p.z).toFixed(2)}, designed ${p.y.toFixed(2)}`);
    if (p.kind === 'cut' && Math.abs(p.grade) > 0.5) bad.push(`#${i} grade ${p.grade.toFixed(2)}`);
  }
  assert.deepEqual(bad, []);
  assert.ok(TRAIL.climb > 35, `climbs ${TRAIL.climb.toFixed(1)} m`);
});

test('summit trail: stays out of fields and structures, is painted as a path, and is on the map', () => {
  for (const p of TRAIL.pts) {
    for (const s of SITES) assert.ok(!inSite(s, p.x, p.z, 1.2), `trail point (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) in field ${s.index}`);
    for (const s of STRUCTURES) assert.ok(Math.hypot(p.x - s.x, p.z - s.z) > Math.max(...s.size) / 2 + 1, `trail point near ${s.id}`);
    if (p.kind === 'cut' || p.kind === 'path') assert.ok(pathAt(p.x, p.z) > 0.6, `unpainted at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
  }
  assert.equal(TRAILS[0].id, 'summit');
  assert.ok(TRAILS[0].points.length === TRAIL.pts.length);
  assert.ok(POIS.some((p) => p.kind === 'lookout') && POIS.some((p) => p.kind === 'trailhead'));
});

test('summit trail: staircase treads climb in even steps above the land, the bridge spans the saddle, the deck is level', () => {
  const A = TRAIL.anchors;
  const f = flightOf(A.stairs);
  assert.ok(Math.abs(f.rise / f.n - STEP) < 0.03);
  assert.ok(Math.abs(treadTop(f, f.n - 1) - A.stairs.b.y) < 1e-6, 'the last tread is the top landing');
  for (let i = 0; i < f.n; i++) {
    const u = ((i + 0.5) / f.n) * f.run, x = f.ax + f.ux * u, z = f.az + f.uz * u;
    assert.equal(stairsFloor(f, x, z), treadTop(f, i));
    assert.ok(heightAt(x, z) <= treadTop(f, i) + 0.02, `land pokes through tread ${i}`);
  }
  assert.equal(stairsFloor(f, f.ax - f.uz * 2, f.az + f.ux * 2), null, 'beside the flight');
  const s = spanOf(A.bridge);
  const mid = bridgeFloor(s, s.ax + s.ux * s.len / 2, s.az + s.uz * s.len / 2)!;
  assert.ok(mid < A.bridge.a.y && mid > A.bridge.a.y - 0.6, 'a gentle sag');
  assert.ok(heightAt(s.ax + s.ux * s.len / 2, s.az + s.uz * s.len / 2) < mid - 4, 'a real drop under the bridge');
  // the bridge ends meet the land (no step at either end)
  assert.ok(Math.abs(heightAt(A.bridge.a.x, A.bridge.a.z) - A.bridge.a.y) < 0.1);
  assert.ok(Math.abs(heightAt(A.bridge.b.x, A.bridge.b.z) - A.bridge.b.y) < 0.1);
  const S = A.summit;
  assert.equal(platformFloor(S, S.x, S.z), S.y + S.deck);
  assert.equal(platformFloor(S, S.x + S.w, S.z), null);
  assert.ok(Math.abs(heightAt(S.x, S.z) - S.y) < 0.05, 'the knob top is levelled under the lookout');
  assert.ok(TRAIL_HW > 0.9);
});
