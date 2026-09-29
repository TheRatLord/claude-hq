// RND fix r1: the auto-scaler judges load, not a capped frame interval (playtest: drawer cap → low/0.6 for the session).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuality, type Quality, type QualityCtx } from './quality.ts';

/** A ctx whose fields the driver rewrites every frame. */
interface RunCtx extends QualityCtx { perf: { cpuMs: number | null; gpuMs: number | null } }
interface RunOpts { intervalMs: number; cpuMs?: number | null; gpuMs?: number | null | ((q: Quality) => number); fpsCap?: number | null }

/** Drive `q.update` for `s` seconds of frames. */
function run(q: Quality, ctx: RunCtx, s: number, { intervalMs, cpuMs = 3, gpuMs = 5, fpsCap = null }: RunOpts) {
  const n = Math.round((s * 1000) / intervalMs);
  for (let i = 0; i < n; i++) {
    ctx.frame++;
    ctx.rawDt = intervalMs / 1000;
    ctx.fpsCap = fpsCap;
    ctx.perf.cpuMs = cpuMs;
    ctx.perf.gpuMs = typeof gpuMs === 'function' ? gpuMs(q) : gpuMs;
    q.update(ctx);
  }
}
const mk = (): { q: Quality; ctx: RunCtx } => ({ q: createQuality({ storage: false }), ctx: { frame: 0, rawDt: 0, hidden: false, fpsCap: null, perf: { cpuMs: 0, gpuMs: null } } });

test('a drawer fps cap (30 / 10 fps intervals) never lowers quality', () => {
  const { q, ctx } = mk();
  run(q, ctx, 3, { intervalMs: 16.7 });
  run(q, ctx, 30, { intervalMs: 33.3, fpsCap: 30 });
  run(q, ctx, 10, { intervalMs: 100, fpsCap: 10 });
  run(q, ctx, 10, { intervalMs: 16.7 });
  assert.equal(q.tier, 'medium');
  assert.equal(q.renderScale, 1);
});

test('the long intervals right after the cap lifts are not counted (settle)', () => {
  const { q, ctx } = mk();
  run(q, ctx, 3, { intervalMs: 16.7 });
  run(q, ctx, 5, { intervalMs: 33.3, fpsCap: 30 });
  run(q, ctx, 1.4, { intervalMs: 33.3 }); // a few stale capped-looking frames, uncapped
  run(q, ctx, 5, { intervalMs: 16.7 });
  assert.equal(q.renderScale, 1);
});

test('real GPU overload steps down, and a 60 Hz vsync frame with headroom steps back up', () => {
  const { q, ctx } = mk();
  let heavy = true;
  const gpu = (qq: Quality) => (heavy ? 24 : 6) * qq.renderScale * qq.renderScale;
  run(q, ctx, 2, { intervalMs: 16.7 });
  run(q, ctx, 8, { intervalMs: 25, gpuMs: gpu });
  assert.ok(q.renderScale < 1, `stepped down (scale ${q.renderScale})`);
  heavy = false;
  run(q, ctx, 60, { intervalMs: 16.7, gpuMs: gpu });
  assert.equal(q.tier, 'medium');
  assert.equal(q.renderScale, 1, 'recovers at interval 16.7 ms (≤ 17.5) with GPU headroom');
});

test('with no work measurement at all, a long interval steps down and interval ≤ 17.5 ms steps back up', () => {
  const { q, ctx } = mk();
  run(q, ctx, 2, { intervalMs: 16.7, gpuMs: null, cpuMs: null });
  run(q, ctx, 5, { intervalMs: 30, gpuMs: null, cpuMs: null });
  assert.ok(q.renderScale < 1);
  run(q, ctx, 60, { intervalMs: 16.7, gpuMs: null, cpuMs: null });
  assert.equal(q.renderScale, 1);
});

test('RND fix r2: no GPU timer (gpuMs null) + slow interval + low measured cpuMs is a throttled display, not overload', () => {
  const { q, ctx } = mk();
  run(q, ctx, 2, { intervalMs: 16.7, gpuMs: null, cpuMs: 3 });
  run(q, ctx, 30, { intervalMs: 33.3, gpuMs: null, cpuMs: 3 }); // 30 Hz throttled display
  run(q, ctx, 30, { intervalMs: 22, gpuMs: null, cpuMs: 4 }); // 45 Hz
  assert.equal(q.renderScale, 1);
  assert.equal(q.tier, 'medium');
  assert.equal(q.debug.workMs, 4, 'work falls back to the measured cpuMs');
});

test('RND fix r2: no GPU timer but measured cpuMs > 12 ms with a slow interval still steps down', () => {
  const { q, ctx } = mk();
  run(q, ctx, 2, { intervalMs: 16.7, gpuMs: null, cpuMs: 3 });
  run(q, ctx, 5, { intervalMs: 30, gpuMs: null, cpuMs: 18 });
  assert.ok(q.renderScale < 1);
});

test('long intervals with little work of ours (throttled display) are not overload', () => {
  const { q, ctx } = mk();
  run(q, ctx, 20, { intervalMs: 33.3, gpuMs: 4, cpuMs: 3 });
  assert.equal(q.renderScale, 1);
  assert.equal(q.tier, 'medium');
});

test('a GPU-bound scene does not oscillate: the step-up wait backs off', () => {
  const { q, ctx } = mk();
  // at scale 1 the frame costs 21 ms of GPU (over), at 0.9 it fits: the predictor must refuse the step back up
  const gpu = (qq: Quality) => 21 * qq.renderScale * qq.renderScale;
  const interval = () => Math.max(16.7, gpu(q) + 1);
  let changes = 0;
  q.onChange(() => changes++);
  run(q, ctx, 2, { intervalMs: 16.7, gpuMs: 5 });
  for (let i = 0; i < 120 * 10; i++) run(q, ctx, 0.1, { intervalMs: interval(), gpuMs: gpu });
  assert.ok(q.renderScale < 1);
  assert.ok(changes <= 3, `changed ${changes}× in 120 s`);
});

test('pinned quality never auto-scales', () => {
  const q = createQuality({ pinned: 'high', storage: false });
  const ctx: RunCtx = { frame: 0, rawDt: 0, hidden: false, perf: { cpuMs: 30, gpuMs: 30 } };
  run(q, ctx, 10, { intervalMs: 40, cpuMs: 30, gpuMs: 30 });
  assert.equal(q.tier, 'high');
  assert.equal(q.renderScale, 1);
});
