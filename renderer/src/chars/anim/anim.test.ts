import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Spring1D, SPRING } from './springs.ts';
import { SecondOrderDynamics } from './sod.ts';
import { noise1 } from './noise.ts';
import { createPose, blendInto, CH, M, squashScale } from './pose.ts';
import { personality } from './personality.ts';
import { REACTIONS } from './reactions.ts';
import { ACTIVITIES, activity, VOCAB } from './activities/index.ts';
import { reach, ARM } from './ik.ts';

test('springs overshoot and settle; stable at low frame rates', () => {
  const s = new Spring1D(SPRING.bouncy);
  let max = 0;
  for (let i = 0; i < 240; i++) max = Math.max(max, s.update(1 / 60, 1));
  assert.ok(max > 1.2, `bouncy overshoots (${max})`);
  assert.ok(Math.abs(s.x - 1) < 0.02, 'settles');
  const j = new Spring1D(SPRING.jiggle);
  for (let i = 0; i < 20; i++) j.update(0.25, 1); // 4 fps
  assert.ok(Number.isFinite(j.x) && Math.abs(j.x - 1) < 0.5);
});

test('second-order dynamics with r < 0 winds up first (anticipation)', () => {
  const d = new SecondOrderDynamics(2, 0.5, -1.5, 0);
  let min = 0;
  for (let i = 0; i < 120; i++) min = Math.min(min, d.update(1 / 60, 1));
  assert.ok(min < -0.05, `wind-up ${min}`);
});

test('noise is smooth and bounded', () => {
  for (let t = 0; t < 20; t += 0.01) {
    const v = noise1(t, 3);
    assert.ok(v >= -1 && v <= 1);
    assert.ok(Math.abs(noise1(t + 0.01, 3) - v) < 0.05);
  }
});

test('pose blending respects masks; squash preserves volume', () => {
  const a = createPose(), b = createPose();
  b.f[CH.aLp] = 1; b.f[CH.hipY] = 1;
  blendInto(a, b, 0.5, M.ARMS);
  assert.equal(a.f[CH.aLp], 0.5);
  assert.equal(a.f[CH.hipY], 0);
  const [xz, y] = squashScale(-0.2);
  assert.ok(Math.abs(xz * xz * y - 1) < 1e-9);
});

test('personality is deterministic per seedKey and in range', () => {
  const p = personality('host:ws:1'), q = personality('host:ws:1'), r = personality('other');
  assert.deepEqual(p, q);
  assert.notDeepEqual(p, r);
  assert.ok(p.energy >= 0.75 && p.energy <= 1.3 && Math.abs(p.width) <= 0.06 && Math.abs(p.height) <= 0.05);
});

// Motion review (ART §6.1): anticipation crouch → stretch on take-off → squash on landing → overshoot.
const REACTION_VARIANTS: [string, number][] = [['victory', 0], ['victory', 1], ['hop', 0], ['startle', 0]];
for (const [id, variant] of REACTION_VARIANTS) {
  test(`reaction ${id}/${variant}: anticipation, squash & stretch, overshoot`, () => {
    const def = REACTIONS[id];
    const p = createPose();
    const sq = [], y = [];
    for (let t = 0; t <= def.dur; t += 1 / 120) { p.f.fill(0); def.update(t, p, { variant, amp: 1 }); sq.push(p.f[CH.sq]); y.push(p.f[CH.hipY]); }
    const apex = y.indexOf(Math.max(...y));
    const takeoff = y.findIndex((v) => v > 0.01);
    assert.ok(Math.max(...y) > 0.1, 'leaves the ground');
    assert.ok(Math.min(...sq.slice(0, takeoff + 1)) < -0.09, 'anticipation crouch before take-off');
    assert.ok(Math.max(...sq.slice(takeoff, apex)) > 0.1, 'stretch on the way up');
    const land = y.findIndex((v, i) => i > apex && v <= 0.001);
    const after = sq.slice(land);
    assert.ok(Math.min(...after) < -0.15, 'landing squash');
    assert.ok(Math.max(...after) > 0.02, 'overshoots back past rest');
  });
}

test('every §6.3 activity exists and writes finite poses (props placed, masks sane)', () => {
  for (const [group, ids] of Object.entries(VOCAB)) {
    if (group === 'reactions') continue;
    for (const id of ids) {
      const a = ACTIVITIES[id];
      assert.ok(a, `${group}: ${id} is registered`);
      assert.equal(activity(id), a);
      const p = createPose();
      for (let t = 0; t < 12; t += 1 / 30) {
        p.f.fill(0); p.prop = null;
        a.update(t, p, { amp: 1, seed: 7, energy: 1, dt: 1 / 30 });
        assert.ok([...p.f].every(Number.isFinite), `${id} finite at t=${t.toFixed(2)}`);
        if (a.prop) assert.equal(p.prop === null || typeof p.prop === 'string', true);
      }
    }
  }
  for (const id of VOCAB.walking) assert.equal(ACTIVITIES[id].mask & M.LEGS, 0, `${id} leaves the legs to locomotion`);
  assert.equal(activity('nope')?.id, 'standIdle');
  assert.equal(activity('fidget:unknown')?.id, 'sitIdle');
});

test('every §6.3 reaction exists, stays inside the 2.5 s preempt budget and writes finite poses', () => {
  for (const id of VOCAB.reactions) {
    const r = REACTIONS[id];
    assert.ok(r, id);
    assert.ok(r.dur > 0 && r.dur <= 2.5, `${id} dur ${r.dur}`);
    const p = createPose();
    for (let t = 0; t <= r.dur; t += 1 / 60) {
      p.f.fill(0);
      r.update(t, p, { amp: 1, seed: 3, energy: 1, dt: 1 / 60, variant: 0 });
      assert.ok([...p.f].every(Number.isFinite), `${id} finite`);
    }
  }
});

test('the brain never names an activity CHR lacks (tuning tables ⊂ registry)', async () => {
  const T = await import('../brain/tuning.ts');
  const ids = [...Object.values(T.CLS_ACTIVITY), ...Object.values(T.SHELL_ACTIVITY), ...Object.values(T.SPOT_ACTIVITY),
    ...T.FIDGETS.map((n) => `fidget:${n}`)].flatMap((id) => (id === undefined ? [] : [id]));
  for (const id of ids) assert.ok(ACTIVITIES[id], `${id} registered`);
});

test('stop-motion accents: the fast actions ask for smears and 2-frame holds', () => {
  for (const id of ['typeFrenzy', 'slideRide']) assert.ok(ACTIVITIES[id].smear, id);
  for (const id of ['victory', 'startle', 'workCall']) { assert.ok(REACTIONS[id].smear, id); assert.ok(REACTIONS[id].twos, id); }
  assert.ok(ACTIVITIES.typeFrenzy.twos);
});

test('noodle-arm reach points the arm at its target', () => {
  const p = createPose();
  reach(p, 1, 0.16, 0.2, 0.36);
  assert.ok(p.f[CH.aRp] > 1 && p.f[CH.aRp] < 2, 'reaches forward');
  assert.ok(p.f[CH.aRs] > 1, 'noodle stretches');
  assert.ok(ARM.x > 0.3);
});

test('[CHR r3] blocked silhouette: waveBlocked + queueHandUp keep the hand over the head top in every frame', async () => {
  const { BODY_H } = await import('../render/geometry.ts');
  const { UPPER_L, FORE_L, HAND_R } = await import('../rig/clawd.ts');
  // FK of the right noodle arm in the shape frame (mirrors animator writeRig: pivot Euler XYZ (-p, 0, r), elbow x -b).
  const handY = (f: ArrayLike<number>) => {
    const p = -f[CH.aRp], r = f[CH.aRr], b = -f[CH.aRb], len = Math.max(0.3, f[CH.aRs]);
    // fore vector in pivot frame: (0, -U, 0) + Rx(b)(0, -F·len, 0)
    const vy = -UPPER_L - FORE_L * len * Math.cos(b), vz = -FORE_L * len * Math.sin(b);
    // Rx(p)·Rz(r) applied to (0, vy, vz): Rz → (-vy sin r, vy cos r, vz); Rx → y' = y cos p − z sin p
    const y1 = vy * Math.cos(r), z1 = vz;
    return ARM.y + y1 * Math.cos(p) - z1 * Math.sin(p) - HAND_R;
  };
  for (const id of ['waveBlocked', 'queueHandUp']) {
    const a = ACTIVITIES[id];
    let min = Infinity, max = -Infinity;
    for (let t = 0; t < 12; t += 1 / 60) {
      const pz = createPose();
      a.update(t, pz, { amp: 1.2, seed: 1, energy: 1, dt: 1 / 60 });
      const y = handY(pz.f); min = Math.min(min, y); max = Math.max(max, y);
    }
    assert.ok(min > BODY_H + 0.06, `${id}: hand bottom ≥ 6 cm over the head top in every frame (min ${min.toFixed(3)})`);
    if (id === 'waveBlocked') assert.ok(max - min > 0.02, `${id} visibly waves (${(max - min).toFixed(3)})`);
  }
});
