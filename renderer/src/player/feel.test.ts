import test from 'node:test';
import assert from 'node:assert/strict';
import { bobAdvance, bobShape, stepIndex, landDipImpulse, springPeakPerVelocity, springStep, analyseFeel } from './feel.ts';
import type { FeelFrame } from './feel.ts';

const bob = { amp: 0.018, walkHz: 1.9, sprintHz: 2.6 };
const landDip = { k: 0.012, min: 0.02, max: 0.1, omega: 18, zeta: 0.6 };

/** Sample bob at a fixed dt, recording footstep times and frames. */
function simBob(hz: number, seconds: number, dt = 1 / 60) {
  let phase = 0, next = 1; const steps: number[] = []; const frames: FeelFrame[] = [];
  for (let t = 0; t < seconds; t += dt) {
    const adv = bobAdvance(dt, hz);
    phase += adv;
    if (phase + adv / 2 >= next * Math.PI) { next = stepIndex(phase + adv / 2) + 1; steps.push(t + dt); }
    frames.push({ t: (t + dt) * 1000, camY: 1.2, dip: 0, bobY: bobShape(phase).y * bob.amp, bobN: bobShape(phase).y, bobAmp: 1, fov: 60, speed: hz > 2 ? 5.6 : 3.6, grounded: true });
  }
  return { steps, frames };
}

test('footstep rate follows the requested frequency (one step per vertical bob cycle)', () => {
  for (const hz of [bob.walkHz, bob.sprintHz]) {
    const { steps } = simBob(hz, 10);
    const iv = ((steps.at(-1) ?? NaN) - steps[0]) / (steps.length - 1);
    assert.ok(Math.abs(1 / iv - hz) < 0.02, `measured ${1 / iv} Hz vs ${hz}`);
  }
});

test('lateral sway runs at half the step rate; vertical trough at each step', () => {
  // over one step (Δφ = π) vertical completes a full cycle, lateral only half
  assert.ok(Math.abs(bobShape(0).y - bobShape(Math.PI).y) < 1e-12);
  assert.ok(Math.abs(bobShape(0).x + bobShape(Math.PI).x) < 1e-12);
  assert.equal(bobShape(0).y, -0.5); // trough exactly at the step
  assert.equal(bobShape(Math.PI / 2).y, 0.5);
});

test('landing spring reaches the requested clamped depth', () => {
  const d = landDip;
  for (const vFall of [1.5, 4.2, 6, 20]) {
    const { depth, impulse } = landDipImpulse(vFall, d);
    let x = 0, v = impulse, min = 0;
    const dt = 1 / 60;
    for (let i = 0; i < 60; i++) { [x, v] = springStep(x, v, dt, d.omega, d.zeta); min = Math.min(min, x); }
    assert.ok(depth >= d.min && depth <= d.max);
    assert.ok(-min >= depth * 0.97 && -min <= depth * 1.001, `vFall ${vFall}: dip ${-min} vs ${depth}`);
  }
  assert.ok(Math.abs(springPeakPerVelocity(18, 0.6) - 0.4988 / 18) < 1e-4);
});

test('analyseFeel: step events align with bob troughs, rates reported', () => {
  const walk = simBob(bob.walkHz, 4);
  const events = walk.steps.map((t) => ({ t: t * 1000, type: 'step', speed: 3.6 }));
  const r = analyseFeel(walk.frames, events);
  assert.ok((r.bobPhaseErrMs ?? Infinity) <= 1000 / 60 / 2 + 0.5, `phase err ${r.bobPhaseErrMs}`);
  assert.ok(Math.abs((r.walkStepHz ?? NaN) - 1.9) < 0.05);
  assert.ok((r.maxDyPerFrame ?? Infinity) < 0.03);
  assert.equal(r.sprintStepHz, null);
});
