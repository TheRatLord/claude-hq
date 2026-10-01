import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AXIS_CODE, SURF, SURF_NAMES, packCode, packSurface, surfIds, surfaceSetKey, unpackCode } from './ids.ts';
import type { SurfAxis } from './ids.ts';

test('surface ids are unique, stable and fit in 5 bits', () => {
  const ids = Object.values(SURF);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.ok(Number.isInteger(id) && id >= 0 && id < 32);
  assert.equal(SURF.inherit, 0);
  assert.equal(SURF.plain, 1);
  assert.equal(SURF.planks, 12);
  assert.ok(!SURF_NAMES.includes('inherit'));
  assert.deepEqual(SURF_NAMES.map((n) => SURF[n]), [...SURF_NAMES.map((n) => SURF[n])].sort((a, b) => a - b));
});

test('codes round-trip every id × axis × variant', () => {
  for (const id of Object.values(SURF)) {
    for (const axis of Object.keys(AXIS_CODE) as SurfAxis[]) {
      for (let variant = 0; variant < 4; variant++) {
        const c = packCode(id, axis, variant);
        assert.ok(c < 512 && Number.isInteger(c));
        assert.deepEqual(unpackCode(c), { id, axis, variant });
        // the shader decodes with float → int rounding: survive float32 storage
        assert.deepEqual(unpackCode(Math.fround(c) + 0.3), { id, axis, variant });
      }
    }
  }
});

test('packing clamps variant and strength, rejects bad ids', () => {
  assert.deepEqual(unpackCode(packCode(SURF.metal, 'y', 9)), { id: SURF.metal, axis: 'y', variant: 3 });
  assert.deepEqual(packSurface(SURF.brick, { strength: 3, scale: 0.5 }, 0.2), [SURF.brick, 0.5, 1, 0.2]);
  assert.deepEqual(packSurface(SURF.logs, { axis: 'x' }), [SURF.logs + 32, 1, 1, 0]);
  assert.throws(() => packCode(32));
  assert.throws(() => packCode(-1));
  assert.throws(() => packCode(2.5));
});

test('surface sets key by membership, not order', () => {
  assert.equal(surfaceSetKey([SURF.grass, SURF.dirt]), surfaceSetKey([SURF.dirt, SURF.grass, SURF.grass]));
  assert.notEqual(surfaceSetKey([SURF.grass]), surfaceSetKey([SURF.dirt]));
  assert.deepEqual(surfIds(['bark', SURF.leaves]), [SURF.bark, SURF.leaves]);
  assert.throws(() => surfIds(['nope' as 'bark']));
});
