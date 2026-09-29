// DESIGN §5.5 colour separation checks. A failing pair is fixed by swapping a token, never by relaxing a threshold.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CORE, ENV, STATUS, WORKSPACE, BODY, MISC, PALETTE, KIND_BODY,
  deltaE2000, deltaE, separation, hexToLch, hexToInt, luminance, srgbToLinear, linearToSrgb,
  statusColor, workspaceColor, kindBodyColor,
} from './palette.ts';
import type { Lab } from './palette.ts';

const HEX = /^#[0-9A-F]{6}$/;

test('CIEDE2000 matches Sharma et al. reference pairs', () => {
  const pairs: [Lab, Lab, number][] = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[50, 2.5, 0], [50, 3.1736, 0.5854], 1.0],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
    [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
  ];
  for (const [a, b, want] of pairs) {
    assert.ok(Math.abs(deltaE2000(a, b) - want) < 1e-4, `${a} vs ${b}: ${deltaE2000(a, b)} != ${want}`);
    assert.ok(Math.abs(deltaE2000(b, a) - want) < 1e-4, 'symmetric');
  }
});

test('colour helpers', () => {
  assert.equal(hexToInt('#D97757'), 0xd97757);
  assert.ok(Math.abs(linearToSrgb(srgbToLinear(0.42)) - 0.42) < 1e-9);
  assert.ok(Math.abs(luminance('#FFFFFF') - 1) < 1e-4);
  const [L] = hexToLch('#D97757');
  assert.ok(Math.abs(L - 60) < 1, 'clay is L* 60');
  assert.equal(statusColor('blocked'), STATUS.blocked);
  // @ts-expect-error deliberately not a status: unknown statuses fall back to the `unknown` colour
  assert.equal(statusColor('nonsense'), STATUS.unknown);
  assert.equal(workspaceColor(9), WORKSPACE[1].hex);
  assert.equal(kindBodyColor('codex'), BODY.bodySlate);
  // @ts-expect-error deliberately not a kind: unknown kinds fall back to the pebble body
  assert.equal(kindBodyColor('mystery'), BODY.bodyPebble);
  assert.equal(kindBodyColor('shell'), null);
});

test('every token is a valid uppercase #RRGGBB and names are unique', () => {
  for (const [k, v] of Object.entries(PALETTE)) assert.match(v, HEX, k);
  assert.equal(WORKSPACE.length, 8);
  assert.equal(new Set(WORKSPACE.map((w) => w.token)).size, 8);
  for (const b of Object.values(KIND_BODY)) assert.ok(BODY[b], b);
});

test('workspace colours are deep jewels (L* 27–55)', () => {
  for (const w of WORKSPACE) {
    const [L] = hexToLch(w.hex);
    assert.ok(L >= 27 && L <= 55, `${w.token} L*=${L.toFixed(1)}`);
  }
});

test('status colours are bright (L* 58–83)', () => {
  for (const [k, v] of Object.entries(STATUS)) {
    const [L] = hexToLch(v);
    assert.ok(L >= 58 && L <= 83, `${k} L*=${L.toFixed(1)}`);
  }
});

const fmt = (n: number) => n.toFixed(1).padStart(5);
function printMatrix(title: string, rows: [string, string][], cols: [string, string][]) {
  const lines = [`\n${title}`, '            ' + cols.map(([k]) => k.slice(0, 9).padStart(10)).join('')];
  for (const [rk, rv] of rows) lines.push(rk.slice(0, 11).padEnd(12) + cols.map(([, cv]) => fmt(deltaE(rv, cv)).padStart(10)).join(''));
  console.log(lines.join('\n'));
}

const statusAndClay: [string, string][] = [...Object.entries(STATUS), ['clay', CORE.clay]];
const wsRows = WORKSPACE.map((w): [string, string] => [w.token, w.hex]);
const nonClayBodies = Object.entries(BODY).filter(([k]) => k !== 'bodyClay');

test('workspace vs status + clay: ΔE00 ≥ 20 and (hue gap ≥ 25° or ΔL* ≥ 20)', () => {
  printMatrix('workspace × status (ΔE00)', wsRows, statusAndClay);
  const fails = [];
  for (const [wk, wv] of wsRows) {
    for (const [sk, sv] of statusAndClay) {
      const s = separation(wv, sv);
      if (!(s.dE >= 20 && (s.dh >= 25 || s.dL >= 20))) fails.push(`${wk}↔${sk} ΔE ${s.dE.toFixed(1)} Δh ${s.dh.toFixed(0)} ΔL ${s.dL.toFixed(0)}`);
    }
  }
  assert.deepEqual(fails, []);
});

test('workspace pairwise ΔE00 ≥ 14', () => {
  printMatrix('workspace × workspace (ΔE00)', wsRows, wsRows);
  for (let i = 0; i < wsRows.length; i++) {
    for (let j = i + 1; j < wsRows.length; j++) {
      const d = deltaE(wsRows[i][1], wsRows[j][1]);
      assert.ok(d >= 14, `${wsRows[i][0]}↔${wsRows[j][0]} ${d.toFixed(1)}`);
    }
  }
});

test('non-clay kind bodies vs status: ΔE00 ≥ 17 and (hue gap ≥ 25° or ΔL* ≥ 20)', () => {
  printMatrix('kind body × status (ΔE00)', Object.entries(BODY), Object.entries(STATUS));
  const fails = [];
  for (const [bk, bv] of nonClayBodies) {
    for (const [sk, sv] of Object.entries(STATUS)) {
      const s = separation(bv, sv);
      if (!(s.dE >= 17 && (s.dh >= 25 || s.dL >= 20))) fails.push(`${bk}↔${sk} ΔE ${s.dE.toFixed(1)}`);
    }
  }
  assert.deepEqual(fails, []);
});

test('every workspace colour vs every kind body ΔE00 ≥ 20', () => {
  printMatrix('kind body × workspace (ΔE00)', Object.entries(BODY), wsRows);
  let min = Infinity, minPair = '';
  for (const [bk, bv] of Object.entries(BODY)) {
    for (const [wk, wv] of wsRows) {
      const d = deltaE(bv, wv);
      if (d < min) [min, minPair] = [d, `${bk}↔${wk}`];
      assert.ok(d >= 20, `${bk}↔${wk} ${d.toFixed(1)}`);
    }
  }
  console.log(`min workspace↔kind = ${min.toFixed(1)} (${minPair})`);
});

test('accessory trim vs every workspace colour ΔE00 ≥ 25', () => {
  for (const [wk, wv] of wsRows) {
    const d = deltaE(MISC.trim, wv);
    assert.ok(d >= 25, `trim↔${wk} ${d.toFixed(1)}`);
  }
});

test('codex body vs its hull ΔE00 ≥ 15 (§5.0 clayCheck().codex)', () => {
  assert.ok(deltaE(BODY.bodySlate, MISC.codexHull) >= 15);
});

// D1: cream (L* 94) and paper are UI-only; lit "cream" means wallCream (walls, L* 84) or trim (small props, L* 92).
test('albedo cap: lit env tokens have Y ≤ 0.80 (paper, cream are UI-only)', () => {
  const { paper, cream, ...core } = CORE; // eslint-disable-line no-unused-vars
  const lit = { ...core, ...ENV, whiteboard: MISC.whiteboard, trim: MISC.trim, ...BODY };
  for (const [k, v] of Object.entries(lit)) assert.ok(luminance(v) <= 0.8, `${k} Y=${luminance(v).toFixed(3)}`);
});

test('STR value map (§5.5, ratified m2 fix r2): pavers/brick within ±4 of 40/62, floor ≥ 15 under wall, cool hues', () => {
  const L = (h: string) => hexToLch(h)[0];
  assert.ok(Math.abs(L(MISC.strPavers) - 40) <= 4, `strPavers L*=${L(MISC.strPavers).toFixed(1)}`);
  assert.ok(Math.abs(L(MISC.strBrick) - 62) <= 4, `strBrick L*=${L(MISC.strBrick).toFixed(1)}`);
  assert.ok(L(MISC.strPavers) <= 52, 'walkable floor ≤ 52');
  assert.ok(L(MISC.strBrick) - L(MISC.strPavers) >= 15, 'floor ≥ 15 L* darker than the wall');
  assert.ok(L(MISC.strMortar) < L(MISC.strBrick) && L(MISC.strMortar) > L(MISC.strPavers), 'mortar between pavers and brick');
  for (const k of ['strPavers', 'strBrick', 'strMortar'] as const) {
    const [, , h] = hexToLch(MISC[k]);
    assert.ok(Math.abs(((h - 44 + 540) % 360) - 180) >= 30, `${k} hue ${h.toFixed(0)}° ≥ 30° from clay (no warm-on-warm)`);
  }
});
