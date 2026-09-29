// Owner: RND. m2 fix r3: fixture pools (glowing shades / string lights without a layout lamp anchor get pools).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clusterPoints, fixtureAnchors } from './lamps.ts';

/** a small box of points around (x, y, z) */
const blob = (x: number, y: number, z: number, r = 0.15) => { const a: number[] = []; for (const dx of [-r, r]) for (const dy of [-r, r]) for (const dz of [-r, r]) a.push(x + dx, y + dy, z + dz); return a; };

test('clusterPoints joins touching cells and keeps separate fixtures apart', () => {
  const g = clusterPoints([...blob(0, 2, 0), ...blob(0.2, 2.1, 0.1), ...blob(4, 2, 0)], 0.3);
  assert.equal(g.length, 2);
  const big = g.find((q) => q.n === 16);
  assert.ok(big && big.min[0] < -0.1 && big.max[0] > 0.3);
});

test('fixtureAnchors: a pendant shade without an anchor becomes a downlight under its shade; anchored ones are skipped', () => {
  const shade = [...blob(3, 2.2, 3), ...blob(-5, 2.2, 1)];
  const out = fixtureAnchors([{ cls: 'shade', xyz: shade }, { cls: 'bulb', xyz: [] }], [{ pos: { x: -5, y: 2.1, z: 1 } }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'fixture');
  assert.ok(Math.abs(out[0].pos.x - 3) < 0.01 && Math.abs(out[0].pos.y - 2.05) < 0.01);
});

test('fixtureAnchors: a desk-height shade lights from just above it; floor-level glow is not a lamp', () => {
  const out = fixtureAnchors([{ cls: 'shade', xyz: [...blob(1, 0.9, 1, 0.1), ...blob(6, 0.2, 6, 0.1)] }], []);
  assert.equal(out.length, 1);
  assert.match(out[0].id, /^fixture:desk:/);
  assert.ok(out[0].pos.y > 1.0);
});

test('fixtureAnchors: a string-light run becomes pools of ≤ 3.2 m runs; lone bulbs, low bulbs and stars do not', () => {
  const bulbs: number[] = [];
  for (let i = 0; i < 16; i++) bulbs.push(...blob(-14 + (i % 2) * 0.3, 2.9, i * 0.45, 0.04));   // a 6.75 m zig-zag run
  bulbs.push(...blob(5, 2.9, 5, 0.04));                                                       // a lone bulb
  for (let i = 0; i < 5; i++) bulbs.push(...blob(8 + i * 0.45, 1.2, 0, 0.04));                // a low LED strip
  for (let i = 0; i < 5; i++) bulbs.push(...blob(20 + i * 0.45, 2.9, 0, 0.04));               // "stars" (skipped by zone)
  const out = fixtureAnchors([{ cls: 'bulb', xyz: bulbs }], [], () => 0, (x) => x > 19);
  assert.ok(out.length >= 2 && out.length <= 5, `runs: ${out.length}`);   // 6.75 m → runs of ≤ 3.2 m
  for (const a of out) { assert.equal(a.kind, 'string'); assert.ok(a.pos.x < -13 && a.pos.x > -14.5); assert.ok((a.pool ?? Infinity) <= 1.8); }
});

// RND fix r2 (art review h22-6: banker lamps had no pool on the desks): task lamps light their desk, not the room
test('task (desk) lamps: reach capped to the desk, boosted pool; other kinds untouched', async () => {
  const { createLamps } = await import('./lamps.ts');
  const { U } = await import('./uniforms.ts');
  const L = createLamps({ lamps: [
    { id: 'd', kind: 'desk', pos: { x: 0, y: 0.95, z: 0 }, radius: 2.2, color: '#FFD49A', gain: 0.2 },
    { id: 'p', kind: 'pendant', pos: { x: 1, y: 2.25, z: 0 }, radius: 3.6, color: '#FFD49A', gain: 0.2 },
  ] });
  const cam = { position: { x: 0, y: 1.6, z: 3 }, matrixWorld: null };
  L.update({ camera: cam, rawDt: 0.016, hour: 22, frame: 1 });
  const slots = [...Array(U.uLampPos.value.length).keys()].filter((i) => U.uLampPos.value[i].w !== 0);
  const byX = (x: number): number => {
    const i = slots.find((s) => Math.abs(U.uLampPos.value[s].x - x) < 1e-6);
    assert.ok(i !== undefined, `a pool at x=${x}`);
    return i;
  };
  const reach = (i: number) => Math.abs(U.uLampPos.value[i].w) % 100;
  // RND fix r3: reach 1.3 (the disk reaches the table's front edge + a rim on the rug), pool 1.1 m, task flag (+20000)
  assert.ok(Math.abs(reach(byX(0)) - 1.3) < 1e-4, `desk reach ${reach(byX(0))}`);
  assert.ok(Math.abs(reach(byX(1)) - 3.6) < 1e-4);
  const aw = (i: number) => Math.abs(U.uLampPos.value[i].w);
  assert.ok(aw(byX(0)) >= 20000 && Math.floor((aw(byX(0)) % 10000) / 100) === 11, `desk code ${aw(byX(0))}`);
  assert.ok(aw(byX(1)) < 10000, 'a pendant is not a task lamp');
  const r = (i: number) => U.uLampCol.value[i].r;
  assert.ok(r(byX(0)) > 1.5 * r(byX(1)), 'desk pool runs brighter than a pendant at the same gain');
});
