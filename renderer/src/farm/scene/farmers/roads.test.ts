import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PATHS, SITES, HANGOUTS, structure } from '../../world/map.ts';
import { workSpot } from '../../world/spots.ts';
import { buildRoads, route, astarNodes, pathLength } from './roads.ts';

const g = buildRoads(PATHS, { x: 0, z: -1, hw: 12, hd: 10 });

test('road graph is connected', () => {
  const seen = new Set<number>([0]);
  const q = [0];
  while (q.length) { const u = q.pop()!; for (const v of g.adj[u]) if (!seen.has(v)) { seen.add(v); q.push(v); } }
  assert.equal(seen.size, g.nodes.length, 'every road node reachable');
});

test('routes between any two plots go gate to gate and are not absurdly long', () => {
  for (const a of SITES) for (const b of SITES) {
    if (a === b) continue;
    const from = workSpot(a, 0), to = workSpot(b, 1);
    const r = route(g, SITES, from, to);
    assert.ok(r.length >= 3);
    const straight = Math.hypot(from.x - to.x, from.z - to.z);
    assert.ok(pathLength(from, r) < straight * 8 + 40, `route ${a.index}→${b.index} too long`);
    const last = r[r.length - 1];
    assert.ok(Math.hypot(last.x - to.x, last.z - to.z) < 1e-6);
  }
});

test('same field walks direct', () => {
  const s = SITES[0];
  assert.equal(route(g, SITES, workSpot(s, 0), workSpot(s, 3)).length, 1);
});

test('hangouts and the shipping bin are reachable from every field', () => {
  const bin = structure('shippingBin');
  for (const s of SITES) {
    for (const h of [...HANGOUTS, { x: bin.x, z: bin.z + 1.5 }]) {
      const r = route(g, SITES, workSpot(s, 0), h);
      assert.ok(r.length >= 2);
    }
  }
  assert.ok(astarNodes(g, 0, g.nodes.length - 1));
});
