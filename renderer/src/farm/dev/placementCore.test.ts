import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedBy, assetOf, boxDiag, findingId, frame, glob, grow, emptyBox, overlapBox, score, sortFindings, summarize, triangleSamples,
} from './placementCore.ts';
import type { AllowEntry, Box, Finding, ItemRef } from './placementCore.ts';

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box => ({ min: [x0, y0, z0], max: [x1, y1, z1] });
const item = (key: string, owner = key.replace(/#\d+$/, '')): ItemRef => ({ key, owner, asset: assetOf(key), box: box(0, 0, 0, 1, 1, 1) });
const finding = (check: Finding['check'], a: string, b?: string, value = 0.3, extra: Record<string, number> = {}): Finding =>
  ({ check, a: item(a), ...(b ? { b: item(b) } : {}), value, extra, focus: box(0, 0, 0, 1, 1, 1), score: score(check, value, extra) });

test('glob matches whole keys, * and ? only, regex characters literal', () => {
  assert.ok(glob('flora/tree-*').test('flora/tree-pine#3'));
  assert.ok(!glob('flora/tree-*').test('xflora/tree-pine'));
  assert.ok(glob('plots/field/crop:apple').test('plots/field/crop:apple'));
  assert.ok(glob('a?c').test('abc') && !glob('a?c').test('abbc'));
  assert.ok(glob('a.b').test('a.b') && !glob('a.b').test('axb'), 'dot is literal');
  assert.ok(glob('m(1)').test('m(1)'), 'parens are literal');
});

test('assetOf strips instance indices and plot ids', () => {
  assert.equal(assetOf('plots/field:d3/crop:apple#12'), 'plots/field/crop:apple');
  assert.equal(assetOf('structures/hub-dressing/lampPost#6'), 'structures/hub-dressing/lampPost');
  assert.equal(assetOf('terrain/outcrops-a#4'), 'terrain/outcrops-a');
});

test('allowedBy: check, key/owner/asset globs, order-free pairs, max and min', () => {
  const list: AllowEntry[] = [
    { check: 'floating', a: 'plots/field/crop:apple', reason: 'hangs in the tree' },
    { check: 'sunk', a: 'flora/tree-*', max: 0.6, reason: 'slope' },
    { check: 'overlap', a: 'flora/tree-*', b: 'flora/tree-*', min: { sepRatio: 0.5 }, reason: 'crowns' },
    { check: 'overlap', a: 'plots/field/fence', b: 'plots/field/gate', reason: 'joinery' },
    { check: '*', a: 'structures/well/bucket*', reason: 'anything goes for the bucket' },
  ];
  assert.equal(allowedBy(finding('floating', 'plots/field:d1/crop:apple#4'), list)?.reason, 'hangs in the tree', 'matched via asset');
  assert.equal(allowedBy(finding('sunk', 'plots/field:d1/crop:apple#4'), list), null, 'wrong check');
  assert.ok(allowedBy(finding('sunk', 'flora/tree-pine#2', undefined, 0.5), list));
  assert.equal(allowedBy(finding('sunk', 'flora/tree-pine#2', undefined, 0.7), list), null, 'over max still surfaces');
  assert.ok(allowedBy(finding('overlap', 'flora/tree-fir#1', 'flora/tree-pine#9', 1, { sepRatio: 0.6 }), list));
  assert.equal(allowedBy(finding('overlap', 'flora/tree-fir#1', 'flora/tree-pine#9', 1, { sepRatio: 0.2 }), list), null, 'below min');
  assert.equal(allowedBy(finding('overlap', 'flora/tree-fir#1', 'flora/tree-pine#9', 1), list), null, 'missing min metric');
  assert.ok(allowedBy(finding('overlap', 'plots/field:d2/gate#0', 'plots/field:d2/fence#7'), list), 'pair order does not matter');
  assert.equal(allowedBy(finding('overlap', 'plots/field:d2/fence#7', 'flora/bush-bush#1'), list), null);
  assert.ok(allowedBy(finding('floating', 'structures/well/bucket#0'), list), "check '*'");
  // a single-item entry does not cover a pair, and a pair entry does not cover a single item
  assert.equal(allowedBy(finding('overlap', 'plots/field:d1/crop:apple#1', 'flora/tree-pine#1'), [list[0]]), null);
  assert.equal(allowedBy(finding('floating', 'plots/field/fence'), [list[3]]), null);
});

test('overlapBox, grow and boxDiag', () => {
  assert.deepEqual(overlapBox(box(0, 0, 0, 2, 2, 2), box(1, 1, 1, 3, 3, 3)), box(1, 1, 1, 2, 2, 2));
  assert.deepEqual(overlapBox(box(0, 0, 0, 1, 1, 1), box(1, 0, 0, 2, 1, 1)), box(1, 0, 0, 1, 1, 1), 'touching faces overlap (zero thickness)');
  assert.equal(overlapBox(box(0, 0, 0, 1, 1, 1), box(1.1, 0, 0, 2, 1, 1)), null);
  const b = grow(grow(emptyBox(), 1, 2, 3), -1, 0, 5);
  assert.deepEqual(b, box(-1, 0, 3, 1, 2, 5));
  assert.equal(boxDiag(box(0, 0, 0, 3, 4, 0)), 5);
});

test('triangleSamples covers corners and spaces samples by about step', () => {
  const out: number[] = [];
  const n = triangleSamples([0, 0, 0, 1, 0, 0, 0.5, 0, 0.8], 0.5, out); // longest edge 1 m
  assert.equal(n, 6, 'two steps per edge: (n+1)(n+2)/2 points');
  assert.equal(out.length, n * 3);
  const pts = Array.from({ length: n }, (_, i) => out.slice(i * 3, i * 3 + 3).join(','));
  for (const c of ['0,0,0', '1,0,0', '0.5,0,0.8']) assert.ok(pts.includes(c), `corner ${c}`);
  for (let i = 0; i < n; i++) assert.ok(out[i * 3 + 1] === 0 && out[i * 3 + 2] >= 0 && out[i * 3 + 2] <= 0.8 + 1e-9, 'inside the triangle');
  assert.equal(triangleSamples([0, 0, 0, 0, 0, 0, 0, 0, 0], 0.5, []), 3, 'degenerate: one step');
  assert.ok(triangleSamples([0, 0, 0, 1000, 0, 0, 0, 0, 1000], 0.1, []) <= 65 * 66 / 2, 'capped');
});

test('frame looks at the target from the requested side and fits the radius', () => {
  const f = frame([10, 2, -5], 1, 0, 0);
  assert.ok(Math.abs(f.x - 10) < 1e-9 && f.z > -5, 'azimuth 0: south of the target');
  assert.ok(Math.abs(f.yaw) < 1e-9, 'looking north');
  assert.ok(Math.abs(f.pitch) < 1e-9);
  const top = frame([0, 0, 0], 2, 0, Math.PI / 3);
  assert.ok(top.y > 0 && top.pitch < 0, 'from above, looking down');
  assert.ok(Math.abs(Math.hypot(top.x, top.y, top.z) - top.dist) < 1e-9);
  assert.ok(frame([0, 0, 0], 4, 0, 0).dist > frame([0, 0, 0], 1, 0, 0).dist, 'bigger things from further away');
  assert.ok(frame([0, 0, 0], 0.01, 0, 0).dist >= 2.2, 'not inside small things');
  const east = frame([0, 0, 0], 1, Math.PI / 2, 0);
  assert.ok(east.x > 0 && Math.abs(east.yaw - Math.PI / 2) < 1e-9, 'from the east, looking west');
});

test('findingId is stable and order-free; sort and summarize rank by class', () => {
  const a = finding('overlap', 'flora/bush-bush#1', 'flora/bush-bush#2');
  const b = finding('overlap', 'flora/bush-bush#2', 'flora/bush-bush#1');
  assert.equal(findingId(a), findingId(b));
  assert.notEqual(findingId(finding('floating', 'x#1')), findingId(finding('sunk', 'x#1')));
  const list = [finding('floating', 'p/a#1', undefined, 0.1), finding('floating', 'p/a#2', undefined, 0.5), finding('sunk', 'p/b#1', undefined, 0.2)];
  list[2].allowed = 'ok';
  const sorted = sortFindings([...list]).map((f) => f.score);
  assert.deepEqual(sorted, [...sorted].sort((x, y) => y - x), 'worst first');
  assert.equal(sortFindings([...list])[0].value, 0.5);
  const s = summarize(list);
  assert.equal(s[0].cls, 'floating: p/a', 'open classes first');
  assert.equal(s[0].n, 2);
  assert.equal(s[0].worst, 0.5);
  assert.deepEqual(s[1], { cls: 'sunk: p/b', n: 1, worst: 0.2, allowed: 1 });
  assert.equal(summarize([a])[0].cls, 'overlap: flora/bush-bush × flora/bush-bush');
});

test('score: more trouble ranks higher, path always counts', () => {
  assert.ok(score('floating', 0.4, { size: 1 }) > score('floating', 0.1, { size: 1 }));
  assert.ok(score('overlap', 0.2, { depth: 0.5 }) > score('overlap', 0.2, { depth: 0 }));
  assert.ok(score('path', 0) >= 1);
});
