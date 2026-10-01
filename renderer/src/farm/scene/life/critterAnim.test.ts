import { test } from 'node:test';
import assert from 'node:assert/strict';
import { body, butterflyWings, frogJump, rabbitHop, wingbeat } from './critterAnim.ts';

test('wingbeat: wings spread on the downstroke, fold only on the upstroke', () => {
  const ch = new Float32Array(12);
  let maxDownFold = 0, maxUpFold = 0;
  for (let i = 0; i < 100; i++) {
    const p = i / 100;
    wingbeat(p, ch);
    if (p > 0.25 && p < 0.5) maxDownFold = Math.max(maxDownFold, ch[1]);
    if (p > 0.55 && p < 0.95) maxUpFold = Math.max(maxUpFold, ch[1]);
  }
  assert.equal(maxDownFold, 0);
  assert.ok(maxUpFold > 0.8, `upstroke fold ${maxUpFold}`);
});

test('rabbit hop: grounded at both ends, stretched long in the air, squashed on landing', () => {
  const ch = new Float32Array(12), b = body();
  rabbitHop(0, 0.1, ch, b); assert.ok(Math.abs(b.y) < 1e-6);
  rabbitHop(1, 0.1, ch, b); assert.ok(Math.abs(b.y) < 1e-6);
  rabbitHop(0.43, 0.1, ch, b);
  assert.ok(b.y > 0.09 && b.sz > 1.15, `mid-air y ${b.y} stretch ${b.sz}`);
  assert.ok(ch[8] > 0.5, 'hind legs trail behind in the air');
  rabbitHop(0.87, 0.1, ch, b);
  assert.ok(b.sz < 1 && b.sy > 1, 'landing squash');
});

test('frog jump: hind legs fully extend in the air and fold again for landing', () => {
  const ch = new Float32Array(12), b = body();
  frogJump(0.4, 0.1, ch, b); const ext = ch[3];
  frogJump(0.99, 0.1, ch, b);
  assert.ok(ext > 1.5 && ch[3] < 0.2, `ext ${ext} → ${ch[3]}`);
});

test('butterfly: flight has glides between bursts of beats; resting wings stay slow', () => {
  const ch = new Float32Array(12);
  let glides = 0;
  for (let i = 0; i < 200; i++) if (butterflyWings(i * 0.01, 'fly', 0.3, ch) === 0 && Math.abs(ch[0] - 0.35) < 0.06) glides++;
  assert.ok(glides > 20 && glides < 120, `glide frames ${glides}`);
  butterflyWings(0, 'rest', 0, ch); const a = ch[0];
  butterflyWings(0.05, 'rest', 0, ch);
  assert.ok(Math.abs(ch[0] - a) < 0.05);
});
