/**
 * Per-pass draw-call and program accounting for `__hq.stats()` (§5.3 split contract):
 *   drawCalls = {main, shadow, portrait, portraits, post, prepass, total}   programs = {scene, post, total}
 *
 * It wraps `renderer.render` and `renderer.shadowMap.render` (after RND's post.ts installed its own wrapper, so the
 * shadow pass's camera-mask swap still happens inside). Each render call is attributed by the scene it draws:
 * - the world scene → `main`, minus the draws the nested shadow-map render made → `shadow`;
 * - a scene flagged `userData.hqPortrait` (CHR's portrait batch, §5.4) → `portrait`;
 * - anything else (postprocessing fullscreen passes) → `post`.
 * A program is `scene` when it was first compiled during a world/portrait/shadow render, `post` otherwise. Programs
 * that existed before install fall back to the RND cache-key convention (`hq|` / depth shaders = scene).
 *
 *   const split = installDrawSplit(renderer, scene);
 *   split.begin();  …every render of the frame…  split.end(ctx.perf);
 *
 * Works on renderer.info.render.calls deltas, so it is independent of info.reset() timing. No per-frame allocation.
 * Owner: CORE.
 */
import type * as THREE from 'three';

/** §5.3 caps the split is checked against (review/perf report `overBudget`). */
export const DRAW_BUDGET = Object.freeze({ main: 110, shadow: 25, portrait: 35, total: 150, totalHard: 250, scenePrograms: 14, postPrograms: 16 });

/**
 * [RND fix r2/r3, cross-owner CORE] §5.3 "Triangles visible" caps on the main (colour) pass. With ≤ `crowdAt` (12)
 * agents ONLY the main-pass total ≤ 500k (`small`) applies; above that the per-owner caps env ≤ 300k, chars ≤ 250k,
 * stat ≤ 60k apply plus the total ≤ 610k (`crowd`, the sum of the split caps). Shadow / prepass triangles are
 * reported (`render.tris`), not capped.
 */
export const TRI_BUDGET = Object.freeze({ env: 300_000, chars: 250_000, stat: 60_000, small: 500_000, crowd: 610_000, crowdAt: 12 });

/**
 * Triangle keys over their cap (pure). `agents` = actors on stage (`stats().actors`).
 */
export function overTriBudget(t: { main: number; env: number; chars: number; stat: number } | null | undefined, agents = 0): string[] {
  if (!t) return [];
  const out: string[] = [];
  const crowd = agents > TRI_BUDGET.crowdAt;
  if (crowd) { // [RND fix r3] §5.3: per-owner caps only above crowdAt; ≤ 12 agents only the 500k total
    if (t.env > TRI_BUDGET.env) out.push('trianglesEnv');
    if (t.chars > TRI_BUDGET.chars) out.push('trianglesChars');
    if (t.stat > TRI_BUDGET.stat) out.push('trianglesStat');
  }
  if (t.main > (crowd ? TRI_BUDGET.crowd : TRI_BUDGET.small)) out.push('triangles');
  return out;
}

/**
 * Keys of a finished frame's split that are over their §5.3 cap (pure; used by __hq.stats / perf.ts).
 * `total` = all passes (main+shadow+portrait+post+prepass) over the 150 target; `totalHard` = over the 250 hard cap
 * (a frame over the hard cap reports both). Uses `d.total` when present, else sums the per-pass fields it has.
 */
export function overBudget(d: { main: number; shadow: number; portrait: number; post?: number; prepass?: number; total?: number }, p?: { scene: number; post: number }): string[] {
  const out: string[] = [];
  if (d.main > DRAW_BUDGET.main) out.push('main');
  if (d.shadow > DRAW_BUDGET.shadow) out.push('shadow');
  if (d.portrait > DRAW_BUDGET.portrait) out.push('portrait');
  const total = d.total ?? (d.main || 0) + (d.shadow || 0) + (d.portrait || 0) + (d.post || 0) + (d.prepass || 0);
  if (total > DRAW_BUDGET.total) out.push('total');
  if (total > DRAW_BUDGET.totalHard) out.push('totalHard');
  if (p && p.scene > DRAW_BUDGET.scenePrograms) out.push('scenePrograms');
  if (p && p.post > DRAW_BUDGET.postPrograms) out.push('postPrograms');
  return out;
}

/**
 * Fallback classification for programs compiled before install (RND's customProgramCacheKey starts 'hq|').
 * [RND m2 fix r3, cross-owner] exported: post.ts's `render.programs` uses this same rule when no split is attached.
 */
export const isSceneProgram = (p: { cacheKey?: string; name?: string }): boolean => {
  const k = p.cacheKey || '';
  return k.includes('hq|') || k.includes('hqdepth') || /^(depth|distance),/.test(k) || /Mesh(Depth|Distance)Material|MeshLambert|MeshBasic|MeshStandard|MeshToon/.test(p.name || '');
};

/** A finished frame's §5.3 split (`ctx.perf.draws`). */
export interface DrawSplitFrame { main: number; shadow: number; portrait: number; portraits: number; post: number; prepass: number; total: number }
export interface ProgramSplit { scene: number; post: number; total: number }
/** What `ctx.perf` needs of the frame perf object: the split publishes into it. */
export interface DrawSplitPerf { draws: DrawSplitFrame | null; drawCalls: number }

type Bucket = 'main' | 'shadow' | 'portrait' | 'post' | 'prepass';

export interface DrawSplit {
  begin(): void;
  end(perf?: DrawSplitPerf | null): DrawSplitFrame;
  readonly last: DrawSplitFrame;
  programs(): ProgramSplit;
  readonly depth: number;
}

/** @param renderer three WebGLRenderer  @param worldScene the main scene */
export function installDrawSplit(renderer: THREE.WebGLRenderer, worldScene: THREE.Scene): DrawSplit {
  const info = renderer.info;
  const cur: Record<Bucket, number> = { main: 0, shadow: 0, portrait: 0, post: 0, prepass: 0 };
  /** last finished frame */
  const last: DrawSplitFrame = { main: 0, shadow: 0, portrait: 0, portraits: 0, post: 0, prepass: 0, total: 0 };
  const progKind = new WeakMap<object, 'scene' | 'post'>();
  let progLen = -1;
  let depth = 0; // nested render depth (shadow render happens inside the world render)

  const classify = (kind: 'scene' | 'post' | null) => {
    const ps = info.programs;
    if (!ps || ps.length === progLen) return;
    progLen = ps.length;
    for (const p of ps) if (!progKind.has(p)) progKind.set(p, kind ?? (isSceneProgram(p) ? 'scene' : 'post'));
  };
  classify(null); // anything compiled before install

  const render = renderer.render;
  renderer.render = function (this: THREE.WebGLRenderer, sc, cam) {
    // [INTEG m2-r1] RND's depth-only architecture prepass (post.ts: world scene + overrideMaterial 'hq:prepass') is
    // its own bucket, matching render.drawCalls.prepass: not in `main` (the §5.3 colour-draw cap), still in `total`.
    const bucket: Bucket = sc === worldScene ? (worldScene.overrideMaterial?.name === 'hq:prepass' ? 'prepass' : 'main') : sc?.userData?.hqPortrait ? 'portrait' : 'post';
    const before = info.render.calls;
    const shadowBefore = cur.shadow;
    depth++;
    try { return render.call(this, sc, cam); } finally {
      depth--;
      // the shadow draws of a nested shadow-map render were already counted as `shadow`
      const d = info.render.calls - before - (cur.shadow - shadowBefore);
      if (d > 0) cur[bucket] += d;
      classify(bucket === 'post' ? 'post' : 'scene');
    }
  };

  const sm = renderer.shadowMap;
  const smRender = sm.render;
  sm.render = function (this: THREE.WebGLShadowMap, ...args: Parameters<typeof smRender>) {
    const before = info.render.calls;
    try { return smRender.apply(this, args); } finally {
      const d = info.render.calls - before;
      if (d > 0) cur.shadow += d;
      classify('scene');
    }
  };

  const programs = { scene: 0, post: 0, total: 0 };
  return {
    /** Start of a frame: zero the running counters (renders outside begin/end still count toward the next frame). */
    begin() { cur.main = 0; cur.shadow = 0; cur.portrait = 0; cur.post = 0; cur.prepass = 0; },
    /** End of a frame: publish the split into `perf.draws` (and the legacy total into `perf.drawCalls`). */
    end(perf) {
      last.main = cur.main; last.shadow = cur.shadow; last.portrait = last.portraits = cur.portrait; last.post = cur.post; last.prepass = cur.prepass;
      last.total = cur.main + cur.shadow + cur.portrait + cur.post + cur.prepass;
      if (perf) { perf.draws = last; perf.drawCalls = last.total; }
      return last;
    },
    get last() { return last; },
    /** {scene, post, total} over the live program list (call from stats(), not per frame). */
    programs() {
      classify(null);
      let s = 0, p = 0;
      for (const pr of info.programs ?? []) (progKind.get(pr) === 'post' ? p++ : s++);
      programs.scene = s; programs.post = p; programs.total = s + p;
      return { ...programs };
    },
    get depth() { return depth; },
  };
}
