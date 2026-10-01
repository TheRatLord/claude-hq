import { test } from 'node:test';
import assert from 'node:assert/strict';
import { footAt, headHold, legOffset, lieStage, phaseStep, solveLeg, spring, springAngle, springTo, strideAmp, trotBlend } from './gait.ts';
import type { FootOut, GaitDef, LegSolve } from './gait.ts';

const COW: GaitDef = { kind: 'quad', walkStride: 1.1, trotStride: 1.5, walkDuty: 0.64, trotDuty: 0.45, walkLift: 0.12, trotLift: 0.18, trotAt: 1.0, fullAt: 0.5 };
const HEN: GaitDef = { kind: 'biped', walkStride: 0.22, trotStride: 0.34, walkDuty: 0.6, trotDuty: 0.42, walkLift: 0.05, trotLift: 0.07, trotAt: 0.8, fullAt: 0.3 };
const foot = (): FootOut => ({ z: 0, y: 0, planted: false, t: 0 });

/** walk a gait at a speed profile and return the worst world-space slide of any planted foot */
function worstSlide(g: GaitDef, legs: number, speedAt: (t: number) => number): number {
  let phase = 0, body = 0, worst = 0;
  const f = foot();
  const plantedAt: (number | null)[] = Array(legs).fill(null);
  const dt = 1 / 240;
  for (let t = 0; t < 12; t += dt) {
    const v = speedAt(t);
    phase += phaseStep(g, v, dt);
    body += v * dt;
    for (let i = 0; i < legs; i++) {
      footAt(g, i, phase, v, f);
      const wz = body + f.z;
      if (f.planted) {
        if (plantedAt[i] === null) plantedAt[i] = wz;
        else worst = Math.max(worst, Math.abs(wz - plantedAt[i]!));
      } else plantedAt[i] = null;
    }
  }
  return worst;
}

test('planted hooves do not slide at a steady walk or trot', () => {
  assert.ok(worstSlide(COW, 4, () => 0.55) < 1e-3, 'walk');
  assert.ok(worstSlide(COW, 4, () => 1.6) < 1e-3, 'trot');
  assert.ok(worstSlide(HEN, 2, () => 0.3) < 1e-3, 'hen walk');
});

test('slowing down shortens the stride instead of skating', () => {
  // decelerate from a walk to a stop (below fullAt the stride shrinks with speed)
  const slide = worstSlide(COW, 4, (t) => Math.max(0, 0.45 - t * 0.05));
  assert.ok(slide < 0.02, `slide ${slide}`);
});

test('walk is a lateral sequence: LH, LF, RH, RF a quarter cycle apart', () => {
  const touchdown = (leg: number) => (1 - legOffset(COW, leg, 0) + 1) % 1; // phase where p wraps to 0
  const order = [2, 0, 3, 1].map(touchdown);
  for (let i = 1; i < 4; i++) {
    const gap = (order[i] - order[i - 1] + 1) % 1;
    assert.ok(Math.abs(gap - 0.75) < 1e-9 || Math.abs(gap - 0.25) < 1e-9, `gap ${gap}`);
  }
  // trot: diagonals together
  assert.equal(legOffset(COW, 0, 1) % 1, legOffset(COW, 3, 1) % 1);
  assert.equal(legOffset(COW, 1, 1) % 1, legOffset(COW, 2, 1) % 1);
});

test('at a walk at least two feet are always down; a trot has diagonal support', () => {
  const f = foot();
  for (let p = 0; p < 1; p += 0.01) {
    let down = 0;
    for (let i = 0; i < 4; i++) if (footAt(COW, i, p, 0.55, f).planted) down++;
    assert.ok(down >= 2, `walk phase ${p}: ${down} down`);
  }
  assert.ok(trotBlend(COW, 1.6) === 1 && trotBlend(COW, 0.5) === 0);
  assert.equal(strideAmp(COW, 0), 0);
  assert.equal(phaseStep(COW, 0, 0.016), 0, 'standing still does not cycle');
});

test('two-bone solve reaches the foot and bends the right way', () => {
  const out: LegSolve = { upper: 0, lower: 0, kz: 0, ky: 0, splay: 0 };
  const a = 0.4, b = 0.38;
  for (const [dz, dy] of [[0.1, -0.7], [-0.15, -0.6], [0.3, -0.5], [0, -0.4]]) {
    for (const fwd of [true, false]) {
      solveLeg(a, b, 0, dy, dz, fwd, out);
      const fz = out.kz + b * Math.sin(out.lower), fy = out.ky - b * Math.cos(out.lower);
      assert.ok(Math.hypot(fz - dz, fy - dy) < 1e-6, `reach ${dz},${dy}`);
      // knee sits in front of (or behind) the hip→foot line
      const cross = dz * out.ky - dy * out.kz;
      assert.ok(fwd ? cross > -1e-9 : cross < 1e-9, `knee side ${fwd}`);
    }
  }
  // out of reach: clamps to a nearly straight leg pointing at the target
  solveLeg(a, b, 0, -2, 0, true, out);
  assert.ok(Math.abs(out.upper) < 0.3 && Math.abs(out.lower) < 0.3);
});

test('cows kneel front first and rise hind first', () => {
  const d = lieStage('cow', true, 0.6), u = lieStage('cow', false, 0.6);
  assert.ok(d.front > d.hind + 0.2, `down ${JSON.stringify(d)}`);
  assert.ok(u.hind < u.front - 0.2, `up ${JSON.stringify(u)}`);
  const end = lieStage('cow', true, 10), up = lieStage('cow', false, 10);
  assert.deepEqual([end.front, end.hind], [1, 1]);
  assert.deepEqual([up.front, up.hind], [0, 0]);
});

test('springs settle without overshoot and take the short way round', () => {
  const s = spring(0);
  let max = 0;
  for (let i = 0; i < 300; i++) max = Math.max(max, springTo(s, 1, 8, 1 / 60));
  assert.ok(Math.abs(s.x - 1) < 1e-3 && max <= 1 + 1e-9);
  const a = spring(3.0);
  for (let i = 0; i < 300; i++) springAngle(a, -3.0, 8, 1 / 60);
  assert.ok(Math.abs(Math.abs(a.x) - 3.0) < 0.01 || Math.abs(a.x - (2 * Math.PI - 3.0)) < 0.01);
});

test('chicken head holds still in the world while the body walks under it', () => {
  const S = 0.22, amp = 1;
  const v = 0.3; let phase = 0, body = 0, held: number | null = null, worst = 0;
  const dt = 1 / 480;
  for (let t = 0; t < 4; t += dt) {
    phase += phaseStep(HEN, v, dt); body += v * dt;
    const q = (phase * 2) % 1;
    const wz = body + headHold(phase, S, amp);
    if (q > 0.02 && q < 0.7) { if (held === null) held = wz; else worst = Math.max(worst, Math.abs(wz - held)); } else held = null;
  }
  assert.ok(worst < 0.03, `head drift ${worst}`);
});
