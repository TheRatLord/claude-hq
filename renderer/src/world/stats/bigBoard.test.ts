// Big Board I NEED YOU band (m2 r3 art/gameplay): the words fit inside the plate with margins, never clipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandLayout, needYouText } from './bigBoard.ts';

test('needYouText: count first, singular for one', () => {
  assert.equal(needYouText(1), '1 NEEDS YOU');
  assert.equal(needYouText(2), '2 NEED YOU');
  assert.equal(needYouText(12), '12 NEED YOU');
});

test('band words fit between the end badges with margins, and stay big', () => {
  const W = 1024, H = 150; // the band's canvas band (px 1024, 2.26 × 0.33 m)
  for (const nb of [1, 2, 9, 12, 64]) {
    const L = bandLayout(W, H, nb);
    const left = W / 2 - L.textW / 2, right = W / 2 + L.textW / 2;
    assert.ok(left >= L.margin + L.sw + L.gap - 0.5, `${nb}: left edge ${left} clears the badge`);
    assert.ok(right <= W - (L.margin + L.sw + L.gap) + 0.5, `${nb}: right edge ${right} clears the badge`);
    assert.ok(L.ty >= L.by * 2 && L.ty + L.pitch * 7 <= H - L.by * 2 + 0.5, `${nb}: inside the bulb rails`);
    assert.ok(L.pitch * 7 >= H * 0.4, `${nb}: letters ≥ 40 % of the band height (${(L.pitch * 7).toFixed(0)} px)`);
  }
});

// M3.5 carryover: cream / amber lettering on a lit red plate, L* contrast ≥ 40; the underside fits inside its margins.
import { BAND } from './bigBoard.ts';

const lstar = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const Y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y;
};

test('band: cream text on a lit red plate, L* contrast ≥ 40', () => {
  const d = lstar(BAND.text) - lstar(BAND.plate);
  assert.ok(d >= 40, `contrast ${d.toFixed(1)}`);
  assert.ok(lstar(BAND.plate) >= 40, 'the plate is lit red, not a dark red on black');
  assert.ok(lstar(BAND.text) >= 90, 'cream');
  assert.ok(lstar(BAND.text) - lstar(BAND.under) >= 40, 'underside contrast');
});

// m3 r1: the underside is a solid lit plate (no lettering to foreshorten / clip / mirror); lit plate L* ≥ 40
import { UNDER, fitOneLine } from './bigBoard.ts';
test('underside: a solid lit plate, lit vs clear clearly different', () => {
  assert.ok(lstar(UNDER.lit) >= 40, `lit plate L* ${lstar(UNDER.lit).toFixed(1)}`);
  assert.ok(lstar(UNDER.lit) - lstar(UNDER.off) >= 25, 'blocked vs clear reads from below');
  assert.ok(lstar(UNDER.frame) - lstar(UNDER.lit) >= 30, 'the butter frame pops on the red');
});

// m3 r1 art: every STATES row is ONE line (shrink to fit, then "+N"), never an orphaned 4th name
const measure = (t: string, size: number) => t.length * size * 0.55;
test('fitOneLine: fits at the biggest size that works, on one line', () => {
  const f = fitOneLine(['gale', 'ledger', 'claude'], 700, measure, 96, 36);
  assert.equal(f.more, 0);
  assert.deepEqual(f.shown, ['gale', 'ledger', 'claude']);
  assert.ok(measure(f.shown.join(' • '), f.size) <= 700);
  assert.ok(f.size >= 36 && f.size <= 96);
  const four = fitOneLine(['gale', 'ledger', 'claude', 'moss'], 700, measure, 96, 36);
  assert.equal(four.more, 0, 'a 4th name shrinks the row instead of wrapping');
  assert.ok(four.size < f.size);
});
test('fitOneLine: too many names at the floor size → "+N", still one line', () => {
  const names = ['gale', 'ledger', 'claude ×2', 'moss', 'onyx', 'willow', 'tinker', 'lumen', 'flint'];
  const f = fitOneLine(names, 700, measure, 96, 36);
  assert.equal(f.size, 36);
  assert.ok(f.more > 0 && f.shown.length + f.more === names.length);
  assert.ok(measure(f.shown.join(' • ') + ` +${f.more}`, f.size) <= 700);
});

// m3 r2 code: twins merge into one "name ×N" entry, so the count never sits between • separators as if it were an agent
import { rowNames } from './format.ts';
test('fitOneLine + rowNames: duplicates render "claude ×2" / "dev ×2", never "dev • 2 • dev"', () => {
  const row = rowNames([{ id: 'a', name: 'claude' }, { id: 'b', name: 'gale' }, { id: 'c', name: 'claude' }, { id: 'd', name: 'ledger' }]);
  assert.deepEqual(row, ['claude ×2', 'gale', 'ledger']);
  const f = fitOneLine(row, 700, measure, 96, 36);
  const line = f.shown.join(' • ');
  assert.equal(line, 'claude ×2 • gale • ledger');
  assert.ok(!/•\s*\d/.test(line), 'no bare count after a separator');
  const dev = fitOneLine(rowNames([{ id: 's1', name: 'dev' }, { id: 's2', name: 'dev' }]), 700, measure, 96, 36);
  assert.deepEqual(dev.shown, ['dev ×2']);
});

// m3 r3 art: twins spread over rows keep their boardNames labels ("claude · 2" under BLOCKED), merged only within a row
import { statesNames, boardNames, stateGroups } from './format.ts';
test('statesNames: cross-row twins show their boardNames label; in-row twins still merge', () => {
  const ents = [
    { id: 'a1', name: 'claude', status: 'working', statusSince: 1 },
    { id: 'a2', name: 'claude', status: 'blocked', statusSince: 2 },
    { id: 'b', name: 'gale', status: 'working', statusSince: 3 },
    { id: 's1', kind: 'shell', name: 'dev' }, { id: 's2', kind: 'shell', name: 'dev' },
  ];
  const labels = boardNames(ents);
  const n = statesNames(stateGroups(ents));
  assert.deepEqual(n.blocked, [labels.get('a2')]);
  assert.equal(n.blocked[0], 'claude · 2');
  assert.deepEqual(n.working, ['claude', 'gale']);
  assert.deepEqual(n.shell, ['dev ×2'], 'same-row twins merge');
  // three claudes: two working + one blocked → each working twin is labelled, never a bare duplicate
  const three = [...ents, { id: 'a3', name: 'claude', status: 'working', statusSince: 4 }];
  const n3 = statesNames(stateGroups(three));
  const all = [...n3.blocked, ...n3.working].filter((x) => x.startsWith('claude'));
  assert.equal(new Set(all).size, 3, `distinct labels: ${all}`);
});

// m3 r3 fun: the inbox-zero win band fits inside the plate, both lines big enough
import { winLayout, answeredText, WIN } from './bigBoard.ts';
test('win band: ALL CLEAR ✓ + "+N ANSWERED" inside the plate, butter on green with contrast', () => {
  const W = 1024, H = 150;
  for (const n of [0, 1, 3, 12, 140]) {
    const L = winLayout(W, H, n);
    const lim = L.margin + L.sw + L.gap - 0.5;
    assert.ok(W / 2 - L.w1 / 2 >= lim && W / 2 - L.w2 / 2 >= lim, `${n}: lines clear the badges`);
    assert.ok(L.y1 >= L.by * 2 - 0.5 && L.y2 + L.p2 * 7 <= H - L.by * 2 + 0.5, `${n}: inside the rails`);
    assert.ok(L.p1 * 7 >= H * 0.25, `${n}: headline ≥ 25% of the band`);
    assert.ok(L.p1 > L.p2, 'headline bigger');
  }
  assert.equal(answeredText(3), '+3 ANSWERED');
  assert.ok(lstar(WIN.text) - lstar(WIN.plate) >= 30, 'butter pops on the green');
  assert.ok(lstar(WIN.plate) - lstar('#221E1C') >= 25, 'win plate clearly lit vs the dim idle plate');
});

// m3 r3 code: stat LOD (index.ts) + createParts' low-detail twin
import { createParts } from './panel.ts';
import { lodFar, LOD_DIST, applyLod } from './index.ts';
import * as THREE from 'three';
test('LOD: createParts keeps a low-detail twin with far fewer triangles; lodFar has hysteresis', () => {
  const P = createParts();
  P.box(0, 0, 0, 1, 1, 1, '#fff').cyl(0, 1, 0, 0.2, 0.2, 1, '#fff').sphere(0, 2, 0, 0.3, '#fff').torus(0, 3, 0, 1, 0.1, '#fff');
  const m = P.mesh('t');
  const tris = (g: THREE.BufferGeometry) => g.getAttribute('position').count / 3;
  assert.ok(m.userData.lod && tris(m.userData.lod.lo) * 3 < tris(m.userData.lod.hi), `${tris(m.userData.lod.lo)} vs ${tris(m.userData.lod.hi)}`);
  const root = new THREE.Group(); root.add(m);
  assert.equal(applyLod(root, true), 1); assert.equal(m.geometry, m.userData.lod.lo);
  applyLod(root, false); assert.equal(m.geometry, m.userData.lod.hi);
  assert.equal(lodFar(LOD_DIST + 0.5, false), true);
  assert.equal(lodFar(LOD_DIST - 0.5, true), true, 'stays far inside the hysteresis');
  assert.equal(lodFar(LOD_DIST - 1.5, true), false);
});
