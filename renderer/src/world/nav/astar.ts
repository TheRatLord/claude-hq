// @pure
/**
 * Octile A* on an occupancy grid (§6.6), no corner cutting, binary heap. Returns cell indices start → goal.
 * Owner: LVL.
 *
 * [BRN fix m2-r1, cross-owner] Allocation-free (§5.3): the per-search `gScore`/`came`/`closed` arrays (~170 KB on the
 * 168×112 grid) and the `[f, idx]` pair heap were the largest allocator at crowd40 (27 KB/frame averaged). Now one
 * scratch set per grid size, validated by a search generation stamp (no fill), and a typed-array heap with the same
 * comparisons as before (identical paths). Single-threaded, non-reentrant: fine for the renderer and node tests.
 */
import type { Grid } from './grid.ts';

const SQ2 = Math.SQRT2;

/** scratch per grid cell count */
interface Scratch { gScore: Float32Array; came: Int32Array; seen: Uint32Array; closed: Uint32Array; gen: number; hf: Float64Array; hi: Int32Array }
const scratch = new Map<number, Scratch>();
function scratchFor(N: number): Scratch {
  let s = scratch.get(N);
  if (!s) {
    s = { gScore: new Float32Array(N), came: new Int32Array(N), seen: new Uint32Array(N), closed: new Uint32Array(N), gen: 0, hf: new Float64Array(1024), hi: new Int32Array(1024) };
    scratch.set(N, s);
  }
  if (++s.gen === 0xffffffff) { s.seen.fill(0); s.closed.fill(0); s.gen = 1; }
  return s;
}

/** Cell indices start → goal, or null when unreachable. */
export function astar(g: Grid, sc: number, sr: number, gc: number, gr: number, maxIter = 60000): number[] | null {
  const { cols, rows } = g;
  const cost = g.cost ?? null; // [BRN fix m3-r3, cross-owner LVL] soft cells (view cones): step × (1 + cost)
  const N = cols * rows;
  const start = sr * cols + sc, goal = gr * cols + gc;
  if (start === goal) return [start];
  const S = scratchFor(N);
  const { gScore, came, seen, closed, gen } = S;
  let hf = S.hf, hi = S.hi, hn = 0;
  const G = (i: number) => (seen[i] === gen ? gScore[i] : Infinity);
  const setG = (i: number, v: number, from: number) => { seen[i] = gen; gScore[i] = v; came[i] = from; };
  const push = (f: number, i: number) => {
    if (hn === hf.length) { const f2 = new Float64Array(hn * 2); f2.set(hf); hf = S.hf = f2; const i2 = new Int32Array(hn * 2); i2.set(hi); hi = S.hi = i2; }
    let k = hn++;
    hf[k] = f; hi[k] = i;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (hf[p] <= hf[k]) break;
      const tf = hf[p], ti = hi[p]; hf[p] = hf[k]; hi[p] = hi[k]; hf[k] = tf; hi[k] = ti;
      k = p;
    }
  };
  const pop = () => {
    const top = hi[0];
    hn--;
    if (hn) {
      hf[0] = hf[hn]; hi[0] = hi[hn];
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < hn && hf[l] < hf[m]) m = l;
        if (r < hn && hf[r] < hf[m]) m = r;
        if (m === k) break;
        const tf = hf[m], ti = hi[m]; hf[m] = hf[k]; hi[m] = hi[k]; hf[k] = tf; hi[k] = ti;
        k = m;
      }
    }
    return top;
  };
  const h = (c: number, r: number) => { const dx = Math.abs(c - gc), dy = Math.abs(r - gr); return (dx + dy) + (SQ2 - 2) * Math.min(dx, dy); };
  setG(start, 0, -1);
  push(h(sc, sr), start);
  let it = 0;
  while (hn && it++ < maxIter) {
    const cur = pop();
    if (cur === goal) break;
    if (closed[cur] === gen) continue;
    closed[cur] = gen;
    const c = cur % cols, r = (cur / cols) | 0;
    const gc0 = gScore[cur];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dc && !dr) continue;
      const c2 = c + dc, r2 = r + dr;
      if (g.blockedCR(c2, r2)) continue;
      if (dc && dr && (g.blockedCR(c + dc, r) || g.blockedCR(c, r + dr))) continue; // no corner cutting
      const n = r2 * cols + c2;
      if (closed[n] === gen) continue;
      const ng = gc0 + (dc && dr ? SQ2 : 1) * (cost === null ? 1 : 1 + cost[n]);
      if (ng < G(n)) { setG(n, ng, cur); push(ng + h(c2, r2), n); }
    }
  }
  if (seen[goal] !== gen || came[goal] === -1) return null;
  const out = [goal];
  for (let k = goal; came[k] !== -1; k = came[k]) out.push(came[k]);
  return out.reverse();
}
