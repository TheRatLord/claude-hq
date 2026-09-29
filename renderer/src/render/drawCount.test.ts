// @pure-ish: fake renderer, no three. Owner: RND.
// m2 fix r3: post.ts's `render.drawCalls` / `render.programs` and CORE drawSplit's `drawCalls` / `programs` are one
// contract (§5.3): the same frame must report the same main / shadow / prepass / post and scene / post programs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type * as THREE from 'three';
import { createDrawCount, programSplit } from './drawCount.ts';
import { installDrawSplit, isSceneProgram, type DrawSplitPerf } from '../core/drawSplit.ts';

/** A scene that "draws" `n` objects, may run the nested shadow render and may compile program `prog`. */
interface FakeScene {
  n: number;
  userData: Record<string, unknown>;
  overrideMaterial?: { name: string } | null;
  shadow?: boolean;
  prog?: string | null;
}
interface FakeRenderer {
  info: { render: { calls: number; triangles: number }; programs: { cacheKey: string; name: string }[] };
  shadowMap: { render(this: FakeRenderer['shadowMap']): void };
  render(this: FakeRenderer, sc: FakeScene): void;
}

function fakeRenderer(): FakeRenderer {
  const info: FakeRenderer['info'] = { render: { calls: 0, triangles: 0 }, programs: [] };
  return {
    info,
    shadowMap: { render() { info.render.calls += 7; } },
    render(sc) {
      if (sc.shadow) this.shadowMap.render();
      if (sc.prog && !info.programs.some((p) => p.cacheKey === sc.prog)) info.programs.push({ cacheKey: sc.prog, name: '' });
      info.render.calls += sc.n;
    },
  };
}

// The doubles implement only the members drawSplit touches; three's real classes have dozens more.
const asRenderer = (r: FakeRenderer) => r as unknown as THREE.WebGLRenderer;
const asScene = (s: FakeScene) => s as unknown as THREE.Scene;

test('post.ts draw count agrees with CORE drawSplit (main excludes the fullscreen post draws)', () => {
  const r = fakeRenderer();
  const world: FakeScene = { n: 0, userData: {}, overrideMaterial: null };
  // post.ts wraps the shadow map first (drawSplit installs after it, main.ts order)
  const dc = createDrawCount(r.info);
  const smInner = r.shadowMap.render;
  r.shadowMap.render = function () { const b = r.info.render.calls; smInner.call(this); dc.shadowDraws(r.info.render.calls - b); };
  const split = installDrawSplit(asRenderer(r), asScene(world));
  const perf: DrawSplitPerf = { draws: null, drawCalls: 0 };
  for (let f = 0; f < 3; f++) {
    split.begin(); dc.begin();
    // WorldPass: depth prepass, then the colour render with the nested shadow render
    world.overrideMaterial = { name: 'hq:prepass' }; world.n = 9; world.shadow = false;
    const b = r.info.render.calls; r.render(world); dc.prepassDraws(r.info.render.calls - b);
    world.overrideMaterial = null; world.n = 52; world.shadow = true; world.prog = 'hq|toonEnv';
    dc.main(r.render, r, world);
    world.shadow = false; world.prog = null;
    // CharPass: three layer renders of the same scene
    const c0 = r.info.render.calls;
    for (const n of [14, 6, 3]) { world.n = n; r.render(world); }
    dc.mainDraws(r.info.render.calls - c0);
    // composer fullscreen passes (N8AO, bloom mips, SMAA, effect pass …): 20 draws, a couple of post programs
    for (let i = 0; i < 20; i++) r.render({ n: 1, userData: {}, prog: i < 2 ? `post${i}` : null });
    dc.end(); split.end(perf);
  }
  const d = perf.draws;
  assert.ok(d);
  assert.equal(dc.counts.main, 75);
  assert.equal(dc.counts.post, 20);
  for (const k of ['main', 'shadow', 'prepass', 'post', 'total'] as const) assert.equal(dc.counts[k], d[k], `drawCalls.${k}`);
  // programs: post.ts with the split attached reports split.programs(); without, the same key rule
  const viaSplit = split.programs();
  const byKey = programSplit(r.info.programs, isSceneProgram);
  assert.deepEqual({ scene: viaSplit.scene, post: viaSplit.post }, byKey);
  assert.deepEqual(byKey, { scene: 1, post: 2 });
});

// RND fix r2 (§5.3 triangle caps): the main-pass triangle split excludes shadow / prepass / post triangles, and the
// caps (CORE drawSplit TRI_BUDGET) flag each owner's share plus the agent-count-dependent total.
test('triangle split: world colour minus the nested shadow render, chars from the CharPass, prepass apart', () => {
  const info = { render: { calls: 0, triangles: 0 } };
  const dc = createDrawCount(info);
  const draw = (calls: number, tris: number) => { info.render.calls += calls; info.render.triangles += tris; };
  dc.begin();
  const b = info.render.triangles; draw(9, 40_000); dc.prepassDraws(9, info.render.triangles - b);
  dc.main(() => { draw(30, 200_000); const s = info.render.triangles; draw(12, 90_000); dc.shadowDraws(12, info.render.triangles - s); draw(20, 50_000); }, null);
  const c = info.render.triangles; draw(18, 120_000); dc.mainDraws(18, info.render.triangles - c);
  draw(20, 40); // fullscreen post
  dc.end();
  assert.deepEqual({ ...dc.tris }, { main: 370_000, world: 250_000, chars: 120_000, shadow: 90_000, prepass: 40_000 });
  assert.equal(dc.counts.main, 30 + 20 + 18);
});

test('triangle caps (§5.3): ≤ 12 agents only the 500k total; per-owner caps only above 12', async () => {
  const { overTriBudget, TRI_BUDGET } = await import('../core/drawSplit.ts');
  assert.deepEqual(overTriBudget({ main: 480_000, env: 280_000, chars: 150_000, stat: 50_000 }, 12), []);
  assert.deepEqual(overTriBudget({ main: 560_000, env: 290_000, chars: 220_000, stat: 50_000 }, 12), ['triangles']);
  assert.deepEqual(overTriBudget({ main: 560_000, env: 290_000, chars: 220_000, stat: 50_000 }, 40), []);
  assert.deepEqual(overTriBudget({ main: 640_000, env: 320_000, chars: 260_000, stat: 61_000 }, 40), ['trianglesEnv', 'trianglesChars', 'trianglesStat', 'triangles']);
  // ≤ 12 agents: over-cap env / stat shares (measured: street env 324k, eBayGlass stat 70k) are NOT flagged,
  // only the 500k main-pass total is.
  assert.deepEqual(overTriBudget({ main: 470_000, env: 324_000, chars: 80_000, stat: 70_000 }, 12), []);
  assert.deepEqual(overTriBudget({ main: 400_000, env: 310_000, chars: 260_000, stat: 72_000 }, 0), []);
  assert.deepEqual(overTriBudget({ main: 520_000, env: 324_000, chars: 120_000, stat: 76_000 }, 12), ['triangles']);
  // 13 agents: the same shares are flagged per owner
  assert.deepEqual(overTriBudget({ main: 470_000, env: 324_000, chars: 80_000, stat: 70_000 }, 13), ['trianglesEnv', 'trianglesStat']);
  assert.deepEqual(overTriBudget(null, 40), []);
  assert.equal(TRI_BUDGET.env + TRI_BUDGET.chars + TRI_BUDGET.stat, TRI_BUDGET.crowd);
});
