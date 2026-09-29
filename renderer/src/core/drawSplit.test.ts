// @pure-ish: fake renderer, no three. Owner: CORE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type * as THREE from 'three';
import { installDrawSplit, overBudget, DRAW_BUDGET } from './drawSplit.ts';
import type { DrawSplitPerf } from './drawSplit.ts';
import type { AnimClock } from './time.ts';
import { fake } from './testDoubles.ts';

interface FakeProgram { cacheKey: string; name: string }
interface FakeScene { n: number; shadow?: boolean; prog?: string | null; userData: Record<string, unknown>; overrideMaterial?: { name: string } | null }
interface FakeRenderer {
  info: { render: { calls: number; triangles: number }; programs: FakeProgram[] };
  shadowMap: { render(): void };
  render(this: FakeRenderer, sc: FakeScene): void;
}
function fakeRenderer(): FakeRenderer {
  const info: FakeRenderer['info'] = { render: { calls: 0, triangles: 0 }, programs: [] };
  const depthProg = { cacheKey: 'x', name: 'depthish' };
  return {
    info,
    shadowMap: { render() { info.render.calls += 7; info.programs.includes(depthProg) || info.programs.push(depthProg); } },
    // a scene "draws" scene.n objects and may compile scene.prog
    render(sc) {
      if (sc.shadow) this.shadowMap.render();
      const { prog } = sc;
      if (prog && !info.programs.some((p) => p.cacheKey === prog)) info.programs.push({ cacheKey: prog, name: '' });
      info.render.calls += sc.n;
    },
  };
}

test('drawSplit attributes main / shadow / portrait / post and classifies programs', () => {
  const r = fakeRenderer();
  const world: FakeScene = { n: 40, shadow: true, prog: 'toon', userData: {} };
  const split = installDrawSplit(fake<THREE.WebGLRenderer>(r), fake<THREE.Scene>(world));
  const perf: DrawSplitPerf = { draws: null, drawCalls: 0 };
  for (let f = 0; f < 2; f++) {
    split.begin();
    r.render(world);
    r.render({ n: 1, userData: {}, prog: f ? null : 'bloom' });
    r.render({ n: 3, userData: { hqPortrait: true } });
    r.info.render.calls = 0; // info.reset() mid-frame must not matter (deltas)
    r.render({ n: 2, userData: {} });
    split.end(perf);
  }
  assert.deepEqual(perf.draws, { main: 40, shadow: 7, portrait: 3, portraits: 3, post: 3, prepass: 0, total: 53 });
  assert.equal(perf.drawCalls, 53);
  assert.deepEqual(split.programs(), { scene: 2, post: 1, total: 3 });
});

test('drawSplit: RND depth prepass (world + hq:prepass override) is its own bucket, not main [INTEG m2-r1]', () => {
  const r = fakeRenderer();
  const world: FakeScene = { n: 30, prog: 'toon', userData: {}, overrideMaterial: null };
  const split = installDrawSplit(fake<THREE.WebGLRenderer>(r), fake<THREE.Scene>(world));
  const perf: DrawSplitPerf = { draws: null, drawCalls: 0 };
  split.begin();
  world.overrideMaterial = { name: 'hq:prepass' }; world.n = 9; r.render(world);
  world.overrideMaterial = null; world.n = 30; r.render(world);
  split.end(perf);
  assert.equal(perf.draws?.main, 30);
  assert.equal(perf.draws?.prepass, 9);
  assert.equal(perf.draws?.total, 39);
});

test('overBudget flags each §5.3 cap', () => {
  assert.deepEqual(overBudget({ main: 110, shadow: 25, portrait: 15, total: 150 }, { scene: 14, post: 16 }), []);
  assert.deepEqual(overBudget({ main: 111, shadow: 26, portrait: 0, total: 0 }, { scene: 15, post: 17 }), ['main', 'shadow', 'scenePrograms', 'postPrograms']);
  assert.equal(DRAW_BUDGET.main, 110);
});

test('overBudget flags all-pass total > 150 (post + prepass count) [m2-r2]', () => {
  // the plan-pose shape: main over, every other pass in cap, but post + prepass push the total past 150
  const d = { main: 115, shadow: 12, portrait: 5, post: 20, prepass: 9, total: 161 };
  assert.deepEqual(overBudget(d), ['main', 'total']);
  // no `total` field: summed from the passes, post + prepass included
  assert.deepEqual(overBudget({ main: 100, shadow: 20, portrait: 10, post: 20, prepass: 9 }), ['total']);
  assert.deepEqual(overBudget({ main: 100, shadow: 20, portrait: 10, post: 20, prepass: 0 }), []);
});

test('overBudget flags totalHard > 250 separately (and total with it) [m2-r2]', () => {
  assert.deepEqual(overBudget({ main: 100, shadow: 20, portrait: 30, post: 100, prepass: 0, total: 250 }), ['total']);
  assert.deepEqual(overBudget({ main: 100, shadow: 20, portrait: 30, post: 101, prepass: 0, total: 251 }), ['total', 'totalHard']);
  assert.equal(DRAW_BUDGET.total, 150);
  assert.equal(DRAW_BUDGET.totalHard, 250);
});

test('loop counts frames whose callback threw in ctx.perf.frameErrors (exposed by __hq.stats)', async () => {
  const { createLoop } = await import('./loop.ts');
  const { createCtx } = await import('./ctx.ts');
  const q: FrameRequestCallback[] = [];
  const saved = { raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame, doc: globalThis.document, err: console.error };
  globalThis.requestAnimationFrame = (fn) => { q.push(fn); return q.length; };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.document = fake<Document>({ hidden: false, addEventListener() {}, removeEventListener() {} });
  console.error = () => {};
  try {
    const ctx = createCtx({ clock: fake<AnimClock>({ tick() {}, dt: 0, rawDt: 0, time: 0, hour: () => 12 }) });
    assert.equal(ctx.perf.frameErrors, 0);
    let n = 0;
    const loop = createLoop(ctx, () => { if (++n % 2) throw new Error('boom'); });
    loop.start();
    for (let t = 1; t <= 4; t++) q.shift()?.(t * 16.7);
    loop.stop();
    assert.equal(ctx.perf.frameErrors, 2);
  } finally {
    globalThis.requestAnimationFrame = saved.raf; globalThis.cancelAnimationFrame = saved.caf; globalThis.document = saved.doc; console.error = saved.err;
  }
});
