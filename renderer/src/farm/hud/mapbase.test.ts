import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePois, parseTrails } from './mapbase.ts';

test('map trails: arrays of lines, bare point lists, a single line or a record', () => {
  const a = [{ x: 0, z: 0 }, { x: 5, z: 5 }];
  assert.equal(parseTrails(undefined).length, 0);
  assert.equal(parseTrails([{ points: a, width: 1.2 }])[0].width, 1.2);
  assert.equal(parseTrails([a, a]).length, 2);
  assert.equal(parseTrails(a).length, 1);
  assert.equal(parseTrails({ points: a }).length, 1);
  assert.equal(parseTrails({ cliff: { points: a }, other: a }).length, 2);
  // junk is skipped, never thrown
  assert.equal(parseTrails([{ points: [{ x: 1 }] }, 3, null]).length, 0);
});

test('map points of interest: arrays or records, any of name / label / title', () => {
  assert.deepEqual(parsePois([{ id: 'summit', name: 'Summit lookout', x: 1, z: 2, kind: 'lookout' }]), [{ id: 'summit', name: 'Summit lookout', x: 1, z: 2, kind: 'lookout' }]);
  assert.equal(parsePois({ summit: { label: 'Summit', x: 1, z: 2 } })[0].name, 'Summit');
  assert.equal(parsePois({ summit: { x: 1, z: 2 } })[0].id, 'summit');
  assert.equal(parsePois([{ name: 'no coords' }, 7]).length, 0);
});
