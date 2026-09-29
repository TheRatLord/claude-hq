/**
 * Activity glyphs (§6.7): a small non-emissive paper pictogram with an ink outline above the head, shown only beyond
 * 8 m (the bubble carries the detail up close), for the current tool class (agents) or process activity (shells).
 * Screen-constant (≈ 30 px at 900 px) so it reads across the office. One cached tile per icon.
 * [FX fix r2] Placed by the shared label declutter (fx/labels.ts): the lowest-ranked label of an agent, hidden when it
 * has no free spot. Owner: FX.
 */
import { glyphAlpha, bubbleAlpha } from './rules.ts';
import { QV, type QuadBatch } from './quads.ts'; // [FX fix m2-r1] staged quads (no boxed float arguments)
import type { Tiles } from './tiles.ts';
import type { FxFrame, FxState } from './types.ts';

const GLYPH_PX = 30;

export function createGlyphs({ tiles }: { tiles: Tiles }) {
  const GQ = { dist: 0, blocked: false }, BQ = { dist: 0, kind: '' }; // [FX fix m2-r1] reused rule queries
  return {
    /** Ready S's glyph: alpha and size (S.gA, S.gPx). Returns false when there is none. */
    prepare(S: FxState, F: FxFrame): boolean {
      if (!S.glyph) return false;
      GQ.dist = S.dist; GQ.blocked = S.status === 'blocked';
      let a = glyphAlpha(GQ) * S.fade;
      if (S.bubble) { BQ.dist = S.dist; BQ.kind = S.bubble.kind; a *= 1 - bubbleAlpha(BQ); }
      S.gA = a;
      if (a <= 0.01) return false;
      S.gPx = GLYPH_PX * (F.vh / 900);
      return true;
    },
    /** Push S's glyph centred at world (cx, cy, cz), world half size h (bobs a little). */
    emit(S: FxState, F: FxFrame, sprite: QuadBatch, cx: number, cy: number, cz: number, h: number) {
      if (!S.glyph) return; // (only emitted for a prepared glyph)
      const tl = tiles.glyph(S.glyph);
      const bob = Math.sin(S.nowT * 2.2 + S.phase) * 0.15 * h;
      (QV[0] = cx + F.U.x * bob, QV[1] = cy + F.U.y * bob, QV[2] = cz + F.U.z * bob, QV[3] = F.R.x * h, QV[4] = F.R.y * h, QV[5] = F.R.z * h, QV[6] = F.U.x * h, QV[7] = F.U.y * h, QV[8] = F.U.z * h, QV[9] = tl.u0, QV[10] = tl.v0, QV[11] = tl.u1, QV[12] = tl.v1, QV[13] = 1, QV[14] = 1, QV[15] = 1, QV[16] = S.gA, sprite.pushQ());
    },
  };
}

export type Glyphs = ReturnType<typeof createGlyphs>;
