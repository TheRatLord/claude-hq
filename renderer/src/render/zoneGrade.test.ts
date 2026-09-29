import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZONE_GRADE, zoneTints } from './zoneGrade.ts';
import { layout } from '../world/layout/hq.ts';

test('§5.6 zone grade: every tint is chroma-only (max channel 1) and gentle (min channel ≥ 0.75)', () => {
  for (const zone of Object.keys(ZONE_GRADE)) {
    const t = zoneTints(zone);
    for (const [k, c] of Object.entries(t)) {
      assert.ok(Math.abs(Math.max(...c) - 1) < 1e-9, `${zone}.${k} max ${Math.max(...c)}`);
      assert.ok(Math.min(...c) >= 0.75, `${zone}.${k} min ${Math.min(...c).toFixed(3)} (a grade is a mood, not a filter)`);
    }
  }
});

test('§5.6 zone grade covers every hq vis cell (E/W bays share BAY); unknown zones stay white', () => {
  for (const c of layout.visCells) {
    const t = zoneTints(c.id);
    const id = /^[EW]\d$/.test(c.id) ? 'BAY' : c.id;
    assert.ok(id in ZONE_GRADE, `no grade for ${c.id}`);
    assert.ok(t.key.length === 3);
  }
  assert.deepEqual(zoneTints('nope'), { key: [1, 1, 1], sky: [1, 1, 1], ground: [1, 1, 1] });
});

test('§5.5 hue-gap staging: Clawd hotspots (LOB/ATR/PIT/BAY/CAF) cool the key on architecture (b ≥ r)', () => {
  for (const z of ['LOB', 'ATR', 'PIT', 'BAY', 'CAF']) {
    const { key } = zoneTints(z);
    assert.ok(key[2] >= key[0], `${z} key ${key.map((v) => v.toFixed(2))}`);
  }
});

test('m2 fix r1 eye adaptation: only windowless zones, within the env gain invariant (lit-env luminance gain ≤ 1.14)', async () => {
  const { ZONE_EXPO, zoneExpo, EXPO_MAX, expoLimit, createZoneGrade, STAGE_GRADE } = await import('./zoneGrade.ts');
  const { lightingAt, lin, norm } = await import('./lightMath.ts');
  const Y = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const yKey = Y(norm(lin(STAGE_GRADE.key))), ySky = Y(norm(lin(STAGE_GRADE.sky)));
  for (const [z, e] of Object.entries(ZONE_EXPO)) {
    assert.ok(!layout.windows.some((w) => w.zone === z), `${z} has sun windows: no exposure gain allowed`);
    assert.ok(e <= EXPO_MAX + 1e-9);
    for (const h of [13, 22]) { // (golden env gains run past 1.14 globally, lightMath GAINS: not ours to budget)
      const L = lightingAt(h), g = createZoneGrade();
      g.update({ camZone: z, rawDt: 0.016 }, 0);
      const lit = L.env.kKey * yKey + L.env.kAmb * ySky;
      assert.ok(g.expo >= 1 && (g.expo === 1 || lit * g.expo <= 1.14 + 1e-9), `${z} @${h} expo ${g.expo}`);
      assert.ok(Math.abs(expoLimit(L.env.kKey, L.env.kAmb) - 1.14 / lit) < 1e-6);
    }
  }
  assert.equal(zoneExpo('LOB'), 1);
});

test('RND fix r3 night-only eye adaptation (LIB): off by day, within the night env invariant after dark', async () => {
  const { ZONE_EXPO_NIGHT, NIGHT_EXPO_MAX, zoneExpoAt, createZoneGrade, STAGE_GRADE } = await import('./zoneGrade.ts');
  const { lightingAt, lin, norm } = await import('./lightMath.ts');
  const Y = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const yKey = Y(norm(lin(STAGE_GRADE.key))), ySky = Y(norm(lin(STAGE_GRADE.sky)));
  assert.ok(ZONE_EXPO_NIGHT.LIB > 1);
  for (const [z, e] of Object.entries(ZONE_EXPO_NIGHT)) {
    assert.ok(e <= NIGHT_EXPO_MAX + 1e-9, `${z} night expo ${e} over the night headroom`);
    assert.equal(zoneExpoAt(z, 0), 1, `${z}: no lift by day (it may have sun windows)`);
    const L = lightingAt(22), g = createZoneGrade();
    g.update({ camZone: z, rawDt: 0.016 }, 1);
    assert.ok(Math.abs(g.expo - e) < 1e-9);
    assert.ok((L.env.kKey * yKey + L.env.kAmb * ySky) * g.expo <= 1.14 + 1e-9, `${z} @22 lit-env gain`);
    const d = createZoneGrade();
    d.update({ camZone: z, rawDt: 0.016 }, 0);
    assert.equal(d.expo, 1);
  }
  assert.equal(zoneExpoAt('LOB', 1), 1);
});
