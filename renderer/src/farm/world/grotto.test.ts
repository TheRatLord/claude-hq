import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POIS, clearance, heightAt, heightBeforeGrotto, normalAt, pathAt, structure } from './map.ts';
import { CAMP, CHEST, GLOWCAP, LEDGE, LEDGE_HW, MOUTH, POOL, SOLIDS, caveFloor, caveSdf, cavePushOut, floorAt, inCave } from './grotto.ts';

/** the player controller's wall test (player/controller.ts MAX_SLOPE at e = 0.6) */
const walkable = (x: number, z: number) => 1 - normalAt(x, z, 0.6).y < 0.42;

test('grotto ledge: walkable from the road to the mouth, at its designed height, painted and reserved', () => {
  const bad: string[] = [];
  for (let i = 0; i + 1 < LEDGE.length; i++) {
    const p = LEDGE[i], q = LEDGE[i + 1];
    const dx = q.x - p.x, dz = q.z - p.z, l = Math.hypot(dx, dz);
    for (let s = 0; s <= l; s += 0.4) {
      const t = s / l, x = p.x + dx * t, z = p.z + dz * t, y = p.y + (q.y - p.y) * t;
      for (const o of [0, -0.45, 0.45]) {
        const ox = x - (dz / l) * o, oz = z + (dx / l) * o;
        if (!walkable(ox, oz)) bad.push(`#${i} (${ox.toFixed(1)}, ${oz.toFixed(1)}) off ${o}`);
      }
      if (Math.abs(heightAt(x, z) - y) > 0.06) bad.push(`#${i} at ${heightAt(x, z).toFixed(2)}, designed ${y.toFixed(2)}`);
      if (pathAt(x, z) < 0.9) bad.push(`#${i} not painted as a path`);
      if (clearance(x, z) > -LEDGE_HW + 0.05) bad.push(`#${i} not reserved`);
    }
  }
  assert.deepEqual(bad, []);
  // the waterfall is traced on the land before the cut: the gap behind the curtain is real
  const wf = structure('waterfall');
  assert.ok(heightBeforeGrotto(MOUTH.x, MOUTH.z + 1) - heightAt(MOUTH.x, MOUTH.z + 1) > 3, 'the cut opens a gap behind the falls');
  assert.ok(Math.abs(wf.y - heightBeforeGrotto(wf.x, wf.z)) < 1e-9, 'the waterfall keeps its height');
  // and it is a secret on the map
  const poi = POIS.find((p) => p.id === 'grotto');
  assert.ok(poi?.hidden && poi.kind === 'grotto');
});

test('grotto cave: the mouth meets the ledge, every corner is reachable, the pool and solids are not walkable', () => {
  // the threshold: room floor 0 = the ledge's tread outside
  assert.equal(floorAt(0, 0.5), 0);
  assert.ok(Math.abs(heightAt(MOUTH.x, MOUTH.z + 0.5) - MOUTH.y) < 0.06, 'outside the mouth is the ledge');
  assert.ok(inCave(0, -1, 0.3) && !inCave(0, 1.2, 0));
  // flood fill the walkable floor from the mouth (0.25 m grid, body radius 0.3, steps under 0.3 m)
  const step = 0.25, key = (i: number, j: number) => `${i},${j}`;
  const ok = (x: number, z: number) => floorAt(x, z) !== null && inCave(x, z, 0.28) && !SOLIDS.some(([sx, sz, sr]) => Math.hypot(x - sx, z - sz) < sr + 0.28);
  const seen = new Set<string>([key(0, -4)]), open: [number, number][] = [[0, -4]];
  while (open.length) {
    const [i, j] = open.pop()!;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj, k = key(ni, nj);
      if (seen.has(k) || Math.abs(ni) > 60 || nj > 4 || nj < -90) continue;
      const x = ni * step, z = nj * step;
      if (!ok(x, z) || Math.abs(caveFloor(x, z) - caveFloor(i * step, j * step)) > 0.3) continue;
      seen.add(k); open.push([ni, nj]);
    }
  }
  const reach = (x: number, z: number, r = 1.2) => [...seen].some((k) => { const [i, j] = k.split(',').map(Number); return Math.hypot(i * step - x, j * step - z) < r; });
  for (const [n, p] of Object.entries({ bedroll: CAMP.bedroll, crate: CAMP.crate, chest: CHEST, glowcap: GLOWCAP, poolside: { x: POOL.x + POOL.rx + 0.6, z: POOL.z } })) assert.ok(reach(p.x, p.z), `${n} reachable`);
  assert.ok(seen.size > 1500, `${seen.size} cells`);
  assert.equal(floorAt(POOL.x, POOL.z), null, 'the pool is not walkable');
  // push-out keeps a body out of a stalagmite and the walls
  const p = { x: SOLIDS[0][0] + 0.05, z: SOLIDS[0][1] };
  assert.ok(cavePushOut(p, 0.3));
  assert.ok(Math.hypot(p.x - SOLIDS[0][0], p.z - SOLIDS[0][1]) >= SOLIDS[0][2] + 0.29);
  const w = { x: 12, z: -11 };
  cavePushOut(w, 0.3);
  assert.ok(caveSdf(w.x, caveFloor(w.x, w.z) + 0.9, w.z) < 0, 'pushed back inside');
});
