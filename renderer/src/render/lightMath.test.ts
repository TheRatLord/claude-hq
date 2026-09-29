import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAINS, LAMP_CAP, LAMP_SCALE, lightingAt, phaseWeights, shade, lin, KEY_DIR, envGainPeak, type Phase } from './lightMath.ts';
import { BODY, MISC, linearRgbToLab, hexToLab, deltaE2000, type Rgb } from '../../../shared/palette.ts';

test('§5.0 gain invariants: chars/props ≤ 1.0, env ≤ 1.14 per channel (incl. night lamp pools)', () => {
  for (const g of Object.values(GAINS)) {
    const c = g.char.kKey + g.char.kAmb + g.char.kPts;
    assert.ok(c <= 1.0 + 1e-9, `char ${c}`);
  }
  // env: per channel, with the real (normalised, tinted) light colours; every hour incl. the phase cross-fades
  for (let h = 0; h < 24; h += 0.25) assert.ok(envGainPeak(h) <= 1.14 + 1e-9, `h ${h} env peak ${envGainPeak(h).toFixed(3)}`);
  assert.ok(LAMP_CAP * LAMP_SCALE.night <= 0.6);
});

test('phase weights sum to 1 and hit the right phase', () => {
  for (let h = 0; h < 24; h += 0.25) {
    const w = phaseWeights(h);
    assert.ok(Math.abs(w.day + w.golden + w.night - 1) < 1e-9, `h ${h}`);
  }
  assert.equal(lightingAt(13).phase, 'day');
  assert.equal(lightingAt(18).phase, 'golden');
  assert.equal(lightingAt(22).phase, 'night');
});

test('studio key: elevation 60°, from the south-south-west (behind the spawn camera)', () => {
  assert.ok(Math.abs(Math.asin(KEY_DIR[1]) * 180 / Math.PI - 60) < 1e-6);
  assert.ok(KEY_DIR[2] > 0 && KEY_DIR[0] < 0); // toward +z (south) and −x (west)
});

test('CPU toon mirror: lit clay ΔE < 6 and shadow band vs #A1544B < 8 at 13 h', () => {
  const clay = lin(BODY.bodyClay);
  const lab = (l: Rgb) => linearRgbToLab(l);
  const lit = shade(clay, { ndl: 0.95, ny: 0.3 });
  const sh = shade(clay, { ndl: 0.2, ny: 0 });
  assert.ok(deltaE2000(lab(lit), hexToLab(BODY.bodyClay)) < 6);
  assert.ok(deltaE2000(lab(sh), hexToLab(MISC.clayShadow)) < 8);
});

test('skylight gobo (fix r1): elevation clamped, azimuth kept; the 18 h patch lands inside the atrium', async () => {
  const { goboSkyDir, sunDirection, GOBO_SKY_MIN_ELEV } = await import('./lightMath.ts');
  const s = sunDirection(18), g = goboSkyDir(s);
  assert.ok(Math.abs(Math.asin(g[1]) * 180 / Math.PI - GOBO_SKY_MIN_ELEV) < 1e-6);
  assert.ok(Math.abs(Math.atan2(g[0], g[2]) - Math.atan2(s[0], s[2])) < 1e-9, 'same azimuth');
  assert.ok(Math.abs(Math.hypot(...g) - 1) < 1e-9);
  // the patch centre of the 5.5 m skylight (centred on 0,0) on the atrium floor (ATR x −6.5…7.5, z −7…7); fix r2: it
  // must overlap the Pit (r 4) so the golden patch reads from pitOverview / spawn, not only on the atrium's far edge
  const t = 5.5 / g[1], px = -g[0] * t, pz = -g[2] * t;
  assert.ok(px > -6.5 && px < 7.5 && pz > -7 && pz < 7, `patch at ${px.toFixed(2)}, ${pz.toFixed(2)}`);
  assert.ok(Math.hypot(px, pz) < 4, `patch centre ${Math.hypot(px, pz).toFixed(2)} m from the Pit centre`);
  // a sun above the floor is left alone (fix r2: the floor is 60°, above the 13 h sun, so the midday patch sits
  // almost under the glass); below the horizon too (no gobo at night)
  const hi = [0.2, Math.sin(70 * Math.PI / 180), 0.1]; const hn = Math.hypot(...hi); const hiN = hi.map((v) => v / hn);
  if (Math.asin(hiN[1]) * 180 / Math.PI >= GOBO_SKY_MIN_ELEV) assert.deepEqual(goboSkyDir(hiN), hiN);
  const g13 = goboSkyDir(sunDirection(13));
  assert.ok(Math.asin(g13[1]) * 180 / Math.PI >= GOBO_SKY_MIN_ELEV - 1e-6);
  assert.deepEqual(goboSkyDir(sunDirection(22)), sunDirection(22));
});

test('m2 fix r2: lightingInto (pre-converted palettes, reused state) matches the reference per-call mix', async () => {
  const M = await import('./lightMath.ts');
  const { HEMI, SUN_COL, ENV_TINT, ENV_GROUND_SOFTEN, ENV_SKY_SOFTEN, KEY, SHADOW_TINT, norm } = M;
  // the pre-r2 formula, kept here as the reference
  const ref = (hour: number) => {
    const w = phaseWeights(hour);
    const mix3 = (pick: (p: Phase) => readonly number[]) => [0, 1, 2].map((i) => w.day * pick('day')[i] + w.golden * pick('golden')[i] + w.night * pick('night')[i]);
    // RND fix r1: the morning look blends env tint / env sky / sun toward MORNING (renormalised)
    const m = M.morningWeight(hour);
    const mo = (v: readonly number[], hex: string) => (m > 0 ? norm(v.map((c, i) => c + (norm(lin(hex))[i] - c) * m)) : v);
    return {
      sky: norm(mix3((p) => norm(lin(HEMI[p].sky)))),
      ground: norm(mix3((p) => norm(lin(HEMI[p].ground)))),
      envGround: norm(mix3((p) => norm(lin(HEMI[p].ground)).map((c) => c + (1 - c) * ENV_GROUND_SOFTEN))),
      envSky: mo(norm(mix3((p) => norm(lin(HEMI[p].sky)).map((c) => c + (1 - c) * ENV_SKY_SOFTEN[p]))), M.MORNING.envSky),
      sunCol: mo(norm(mix3((p) => norm(lin(SUN_COL[p])))), M.MORNING.sun),
      keyCol: norm(lin(KEY.color)), shadowTint: lin(SHADOW_TINT),
      envTint: mo(norm(mix3((p) => norm(lin(ENV_TINT[p])))), M.MORNING.envTint),
      sunDir: M.sunDirection(hour),
    };
  };
  const L = M.createLightingState();
  const arrays = [L.sky, L.ground, L.envGround, L.envSky, L.sunCol, L.envTint, L.sunDir, L.weights, L.char, L.env];
  for (let h = 0; h < 24; h += 0.125) {
    M.lightingInto(L, h);
    const r = ref(h), a = lightingAt(h);
    for (const k of Object.keys(r) as (keyof typeof r)[]) for (let i = 0; i < 3; i++) assert.ok(Math.abs(L[k][i] - r[k][i]) < 1e-9, `${k}[${i}] @${h}`);
    assert.deepEqual(L, a);
    const g = GAINS[L.phase];
    if (L.weights[L.phase] === 1 && L.morning === 0) assert.ok(Math.abs(L.env.kKey - g.env.kKey) < 1e-12 && Math.abs(L.char.kAmb - g.char.kAmb) < 1e-12);
  }
  // same objects every call (no per-frame garbage)
  assert.deepEqual([L.sky, L.ground, L.envGround, L.envSky, L.sunCol, L.envTint, L.sunDir, L.weights, L.char, L.env], arrays);
  arrays.forEach((x, i) => assert.equal(x, [L.sky, L.ground, L.envGround, L.envSky, L.sunCol, L.envTint, L.sunDir, L.weights, L.char, L.env][i]));
  const out = [0, 0, 0];
  for (const h of [6, 13, 18, 22]) assert.deepEqual(M.goboSkyDirInto(out, M.sunDirection(h)), M.goboSkyDir(M.sunDirection(h)));
});

test('RND fix r1: hour mood: exposure dims golden and night interiors, morning is its own cool look', async () => {
  const M = await import('./lightMath.ts');
  assert.equal(M.exposureAt(13), 1);
  assert.ok(M.exposureAt(18) < 0.8 && M.exposureAt(18) > 0.65, 'golden hour dims the room so the sun reads');
  assert.ok(M.exposureAt(22) <= 0.55, 'night room ≈ half the day base light (pools carry it)');
  for (let h = 0; h < 24; h += 0.1) { // continuous: no pops as the real clock ticks
    const d = Math.abs(M.exposureAt(h + 0.1) - M.exposureAt(h));
    assert.ok(d < 0.03, `exposure step ${d.toFixed(3)} at ${h.toFixed(1)}`);
  }
  assert.equal(M.morningWeight(8), 1);
  assert.equal(M.morningWeight(13), 0);
  assert.equal(M.morningWeight(18), 0);
  const w = M.lutWeightsInto({ day: 0, golden: 0, night: 0, morning: 0 }, 8);
  assert.ok(Math.abs(w.day + w.golden + w.night + w.morning - 1) < 1e-9 && w.morning === 1 && w.golden === 0);
  const w18 = M.lutWeightsInto({ day: 0, golden: 0, night: 0, morning: 0 }, 18);
  assert.equal(w18.morning, 0); assert.equal(w18.golden, 1);
  // 8 h: env tint cooler (more blue than red) than 13 h; 18 h keeps the warm sun
  const L8 = lightingAt(8), L13 = lightingAt(13), L18 = lightingAt(18);
  assert.ok(L8.envTint[2] - L8.envTint[0] > L13.envTint[2] - L13.envTint[0]);
  assert.ok(L18.sunCol[0] > L18.sunCol[2] && L8.sunCol[2] > L18.sunCol[2]);
  // characters keep their gains at every hour (clayCheck): the mood is env / props only
  assert.deepEqual(lightingAt(22).char, GAINS.night.char);
});

// RND fix r2 (art review: night characters read as unlit stickers): characters take a softened hour exposure
test('character exposure: 1 by day, ≈ 0.8 at night, always ≥ the env exposure', async () => {
  const { charExposure, exposureAt, createLightingState, lightingInto } = await import('./lightMath.ts');
  assert.equal(charExposure(1), 1);
  const night = charExposure(exposureAt(22));
  assert.ok(night > 0.78 && night < 0.82, `night char exposure ${night}`);
  for (let h = 0; h < 24; h += 0.5) assert.ok(charExposure(exposureAt(h)) >= exposureAt(h) - 1e-9);
  const L = lightingInto(createLightingState(), 22);
  assert.equal(L.charExposure, night);
});
