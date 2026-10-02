import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAZA, stepSurface } from './steps.ts';
import type { StepIn } from './steps.ts';

const meadow: StepIn = { ctrl: 'grass', indoors: false, path: 0, plaza: 40, season: 'summer', weather: 'clear', wet: 0, snow: 0, height: 0 };

test('footstep surfaces', () => {
  assert.equal(stepSurface(meadow).surface, 'grass');
  assert.equal(stepSurface({ ...meadow, path: 0.9 }).surface, 'dirt');
  assert.equal(stepSurface({ ...meadow, plaza: PLAZA.r - 1, path: 1 }).surface, 'stone');
  assert.equal(stepSurface({ ...meadow, ctrl: 'wood' }).surface, 'deck');
  assert.equal(stepSurface({ ...meadow, ctrl: 'wood', indoors: true }).surface, 'floor');
  assert.equal(stepSurface({ ...meadow, ctrl: 'water' }).surface, 'water');
  // snow: lying snow anywhere, or winter up above the snow line
  assert.equal(stepSurface({ ...meadow, snow: 0.6, path: 0.9 }).surface, 'snow');
  assert.equal(stepSurface({ ...meadow, season: 'winter', height: 20 }).surface, 'snow');
  assert.equal(stepSurface({ ...meadow, season: 'winter', height: 2 }).surface, 'grass');
  assert.equal(stepSurface({ ...meadow, plaza: 3, snow: 0.4 }).surface, 'stone', 'a dusting leaves the pavers');
  assert.equal(stepSurface({ ...meadow, plaza: 3, snow: 0.8 }).surface, 'snow');
  assert.equal(stepSurface({ ...meadow, ctrl: 'wood', snow: 0.9 }).surface, 'deck');
});

test('puddles splash in the wet and linger after the rain', () => {
  assert.equal(stepSurface(meadow).splash, 0);
  const road = { ...meadow, path: 0.9 };
  const pour = stepSurface({ ...road, weather: 'rain', wet: 0.9 }).splash;
  assert.ok(pour > 0.8);
  assert.ok(stepSurface({ ...road, weather: 'rain', wet: 0 }).splash > 0, 'it splashes as soon as it rains');
  assert.ok(stepSurface({ ...road, wet: 0.6 }).splash > 0, 'puddles linger');
  assert.ok(stepSurface({ ...meadow, weather: 'rain', wet: 0.9 }).splash < pour, 'grass squelches less than the road splashes');
  assert.equal(stepSurface({ ...meadow, snow: 0.8, wet: 1 }).splash, 0);
  assert.equal(stepSurface({ ...meadow, ctrl: 'water', wet: 1, weather: 'rain' }).splash, 0);
});
