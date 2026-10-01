import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ivyMesh, layoutIvy } from './ivy.ts';

// a strata step: shelf at 3 m for z < 0, a riser leaning out to z = 1, the floor at 0 beyond
const step = (_x: number, z: number) => (z < 0 ? 3 : z > 1 ? 0 : 3 - 3 * Math.min(1, z) ** 0.8);

test('ivy drapes hang from the lip and hug the riser (never float off it)', () => {
  const L = layoutIvy([{ x: 0, z: -0.05, dx: 0, dz: 1, w: 3, len: 2.6, seed: 5 }], step);
  const d = L.drapes[0];
  assert.ok(d.strands.length >= 6, 'a curtain of strands');
  for (const s of d.strands) {
    const top = s.pts[1];
    assert.ok(Math.abs(top.y - 3) < 0.15, `rolls over at the lip (${top.y})`);
    for (const p of s.pts.slice(2)) {
      assert.ok(p.y < 3 && p.y > 0, 'between the lip and the floor');
      // the wall face at this height: where the step drops to p.y
      let k = 0;
      while (step(0, k) > p.y) k += 0.01;
      assert.ok(p.z >= k - 0.02 && p.z - k < 0.3, `in front of the rock, close to it (gap ${(p.z - k).toFixed(2)})`);
    }
  }
  const lens = d.strands.map((s) => s.pts[1].y - s.pts[s.pts.length - 1].y);
  assert.ok(Math.max(...lens) - Math.min(...lens) > 0.5, 'ragged hem, not a comb');
});

test('ivy meshes per season, winter thinner, parts named for the audit', () => {
  const L = layoutIvy([{ x: 0, z: -0.05, dx: 0, dz: 1, w: 3, len: 2.6, seed: 5 }], step);
  const tri = (s: 'summer' | 'winter') => ivyMesh(L, s).attributes.position.count / 3;
  assert.ok(tri('winter') < tri('summer') * 0.8);
  const g = ivyMesh(L, 'autumn');
  assert.deepEqual(g.userData.parts.map((p: { name: string }) => p.name), ['ivy#0']);
  assert.equal(g.userData.parts[0].count, g.attributes.position.count);
});
