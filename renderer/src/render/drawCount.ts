/**
 * post.ts's own §5.3 draw accounting (`__hq.stats().render.drawCalls`), pure so it is unit tested against CORE's
 * drawSplit (drawCount.test.ts: the two contracts must agree).
 *
 * m2 fix r3: post.ts reported `main = calls − shadow − prepass`, so the composer's fullscreen passes (≈ 20 draws:
 * N8AO, bloom mips, SMAA, the effect pass) were counted as main, and `render.drawCalls.main` read 100 where the
 * §5.3 split (`drawCalls.main`) read 80 in the same frame. Now every world-scene colour render (the WorldPass and
 * CharPass renders) is counted explicitly as `main`, minus the shadow-map draws made inside it; the depth prepass is
 * `prepass`; everything else the frame drew is `post`. Same buckets as core/drawSplit.ts.
 * Owner: RND.
 */

/** The slice of three's `renderer.info` that is read. */
export interface RenderInfoLike { render: { calls: number; triangles: number } }

export interface DrawCounts { main: number; shadow: number; prepass: number; post: number; total: number; triangles: number }
export interface DrawTris { main: number; world: number; chars: number; shadow: number; prepass: number }

export function createDrawCount(info: RenderInfoLike) {
  const counts: DrawCounts = { main: 0, shadow: 0, prepass: 0, post: 0, total: 0, triangles: 0 };
  // RND fix r2 (§5.3 triangle caps): the same buckets for triangles. `world` = the WorldPass colour render (env,
  // props, stat objects, fx on the world layer), `chars` = the CharPass renders (chars + hulls + overlay), `main` =
  // world + chars = the visible-triangle budget line; shadow / prepass are reported, not capped.
  const tris: DrawTris = { main: 0, world: 0, chars: 0, shadow: 0, prepass: 0 };
  let t0 = 0;
  return {
    counts,
    tris,
    /** Start of the frame's render (after info.reset or not: everything is a delta). */
    begin() {
      counts.main = counts.shadow = counts.prepass = counts.post = 0; t0 = info.render.calls;
      tris.main = tris.world = tris.chars = tris.shadow = tris.prepass = 0;
    },
    /** Wrap a world-scene colour render (shadow-map draws made inside it go to `shadow` via `shadowDraws`). */
    main<A extends unknown[], S, R>(fn: (this: S, ...args: A) => R, self: S, ...args: A): R {
      const c0 = info.render.calls, s0 = counts.shadow, r0 = info.render.triangles, st0 = tris.shadow;
      try { return fn.call(self, ...args); } finally {
        counts.main += info.render.calls - c0 - (counts.shadow - s0);
        tris.world += info.render.triangles - r0 - (tris.shadow - st0);
      }
    },
    /** Add world-scene colour draws (and their triangles) measured by the caller (CharPass). */
    mainDraws(n: number, t = 0) { counts.main += n; tris.chars += t; },
    /** Add shadow-map draws / triangles (post.ts's shadow wrapper measures them). */
    shadowDraws(n: number, t = 0) { counts.shadow += n; tris.shadow += t; },
    /** Add depth-prepass draws / triangles. */
    prepassDraws(n: number, t = 0) { counts.prepass += n; tris.prepass += t; },
    /** End of the frame: whatever was not main / shadow / prepass is post (fullscreen passes). */
    end(): DrawCounts {
      counts.total = info.render.calls - t0;
      counts.post = Math.max(0, counts.total - counts.main - counts.shadow - counts.prepass);
      counts.triangles = info.render.triangles;
      tris.main = tris.world + tris.chars;
      return counts;
    },
  };
}

/**
 * Scene / post program split by a classifier (post.ts without CORE's drawSplit attached: drawSplit's own cache-key
 * rule `isSceneProgram`; with it attached post.ts reports `split.programs()` itself, so the two never disagree).
 */
export function programSplit<P>(programs: readonly P[] | null | undefined, isScene: (p: P) => boolean) {
  let scene = 0, post = 0;
  for (const p of programs ?? []) if (isScene(p)) scene++; else post++;
  return { scene, post };
}
