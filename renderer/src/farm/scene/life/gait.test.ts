import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAITS, Legs, fk2, ik2, pickGait } from './gait.ts';
import type { GaitName } from './gait.ts';

const NEUTRAL = [[0.1, 0.24], [-0.1, 0.24], [0.1, -0.24], [-0.1, -0.24]] as const;

test('gait choice has hysteresis', () => {
  let g: GaitName = 'walk';
  const seq: GaitName[] = [];
  for (const v of [1, 1.6, 1.8, 1.5, 1.4, 1.3, 3, 4.2, 3.5, 3.2, 1]) { g = pickGait(g, v); seq.push(g); }
  assert.deepEqual(seq, ['walk', 'walk', 'trot', 'trot', 'trot', 'walk', 'trot', 'gallop', 'gallop', 'trot', 'walk']);
  // smaller legs switch sooner
  assert.equal(pickGait('walk', 1.3, 0.6), 'trot');
});

for (const [v, name] of [[1.1, 'walk'], [2.6, 'trot'], [6, 'gallop']] as const) {
  test(`stance feet stay put in the world (${name})`, () => {
    const legs = new Legs({ neutral: NEUTRAL, scale: 1 });
    const dt = 1 / 60;
    let bodyZ = 0;
    for (let i = 0; i < 240; i++) { legs.update(dt, v, 0); bodyZ += v * dt; }
    assert.equal(legs.gait, name);
    const prev = legs.feet.map((f) => ({ swing: f.swing, wz: bodyZ + f.z }));
    let maxSlide = 0, stanceFrames = 0;
    for (let i = 0; i < 240; i++) {
      legs.update(dt, v, 0); bodyZ += v * dt;
      legs.feet.forEach((f, k) => {
        const wz = bodyZ + f.z;
        if (!f.swing && !prev[k].swing) { maxSlide = Math.max(maxSlide, Math.abs(wz - prev[k].wz)); stanceFrames++; }
        prev[k] = { swing: f.swing, wz };
      });
    }
    assert.ok(stanceFrames > 100);
    assert.ok(maxSlide < 1e-6, `slide ${maxSlide}`);
  });
}

test('feet land ahead and lift behind (the stride sweeps under the body)', () => {
  const legs = new Legs({ neutral: NEUTRAL, scale: 1 });
  let minZ = 9, maxZ = -9, maxY = 0;
  for (let i = 0; i < 300; i++) { legs.update(1 / 60, 1.2, 0); const f = legs.feet[0]; minZ = Math.min(minZ, f.z); maxZ = Math.max(maxZ, f.z); maxY = Math.max(maxY, f.y); }
  assert.ok(maxZ > 0.24 + 0.1 && minZ < 0.24 - 0.1, `z ${minZ}..${maxZ}`);
  assert.ok(maxY > 0.04 && maxY < 0.12, `lift ${maxY}`);
});

test('gallop has a flight phase; walk always has two or more feet down', () => {
  for (const [v, needFlight] of [[6.5, true], [1.0, false]] as const) {
    const legs = new Legs({ neutral: NEUTRAL, scale: 1 });
    let flight = 0, minDown = 4;
    for (let i = 0; i < 600; i++) {
      legs.update(1 / 120, v, 0);
      if (i < 200) continue;
      const down = legs.feet.filter((f) => !f.swing).length;
      if (down === 0) flight++;
      minDown = Math.min(minDown, down);
    }
    if (needFlight) assert.ok(flight > 5, `flight frames ${flight}`);
    else assert.ok(minDown >= 2, `walk min feet down ${minDown}`);
  }
});

test('stopping settles every foot home with steps, not slides', () => {
  const legs = new Legs({ neutral: NEUTRAL, scale: 1 });
  for (let i = 0; i < 120; i++) legs.update(1 / 60, 2.4, 0);
  const prev = legs.feet.map((f) => ({ swing: f.swing, z: f.z }));
  let slide = 0;
  for (let i = 0; i < 180; i++) {
    legs.update(1 / 60, 0, 0);
    legs.feet.forEach((f, k) => { if (!f.swing && !prev[k].swing) slide = Math.max(slide, Math.abs(f.z - prev[k].z)); prev[k] = { swing: f.swing, z: f.z }; });
  }
  assert.ok(!legs.unsettled(), 'feet home');
  assert.ok(slide < 1e-6, `slide while settling ${slide}`);
  assert.equal(legs.freq, 0);
});

test('two-bone IK reaches reachable targets with the joint on the requested side', () => {
  const out = { upper: 0, lower: 0, reach: 0 };
  for (const [ty, tz] of [[-0.3, 0.1], [-0.25, -0.15], [-0.36, 0], [-0.1, 0.2]] as const) {
    for (const bend of [1, -1]) {
      ik2(0.2, 0.18, ty, tz, bend, out);
      const e = fk2(0.2, 0.18, out.upper, out.lower);
      assert.ok(Math.hypot(e.y - ty, e.z - tz) < 1e-6, `reach ${ty},${tz}`);
      // middle joint: behind the line for +1 (elbow), in front for −1 (knee)
      const my = -Math.cos(out.upper) * 0.2, mz = -Math.sin(out.upper) * 0.2;
      const side = Math.sign(tz * my - ty * mz); // cross((t),(m)) sign
      assert.equal(side, bend > 0 ? -1 : 1); // elbow behind the hip→target line
    }
  }
  ik2(0.2, 0.18, -2, 0, 1, out);
  assert.ok(Math.abs(out.upper) < 0.06 && Math.abs(out.lower) < 0.12 && out.reach > 1);
});

test('gait table is sane', () => {
  for (const g of Object.values(GAITS)) { assert.ok(g.duty > 0.2 && g.duty < 0.8); for (const o of g.offsets) assert.ok(o >= 0 && o < 1); }
});
