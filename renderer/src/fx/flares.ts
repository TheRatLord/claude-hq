/**
 * [FX M3.5] Struggle flare (§6.7 struggle row, M3.5 wave): while an agent is working with `struggle.level ≥ 2`, a small
 * paper tag with a signal-flare disc (butter at level 2, coral at 3) floats over its label stack, lettered with the
 * short `struggle.detail` ("3 test fails in a row"; BE2), else a line for the reason. Screen-constant like the plates,
 * never under FLARE_MIN_SCALE, so it reads from the spawn; placed by fx/labels.ts's declutter pass (stacked on the
 * bubble / plate), drawn on the on-top batch, spitting a couple of sparks now and then. The tile is redrawn only when
 * the text / level change. Owner: FX.
 */
import { FLARE_TILE, drawFlare, clip } from './draw.ts';
import type { Atlas } from './atlas.ts';
import type { FxFrame, FxState, UvRect } from './types.ts';

const FLARE_SCALE = 0.42; // screen px per tile px at 900 px (as the plates)
const FLARE_MIN_SCALE = 0.42; // far: the 30 px tile text stays ≥ ~12.5 px on screen (reads from the spawn)
/** Shown within this distance (m), fading out over the last FADE_M. */
export const FLARE_FAR_M = 34;
const FADE_M = 6;

const REASON: Readonly<Record<string, string>> = Object.freeze({ fails: 'tests keep failing', errors: 'errors keep coming', noEdits: 'going in circles', context: 'context nearly full' });

/**
 * @pure The flare's line for a Struggle ({level, reason, detail?}): the detail when given, else the reason's line;
 * ≤ 30 chars. null below level 2.
 */
export function flareText(struggle: { level?: number; reason: string; detail?: unknown } | null | undefined): string | null {
  if (!struggle || (struggle.level ?? 0) < 2) return null;
  const d = typeof struggle.detail === 'string' ? struggle.detail.trim() : '';
  return clip(d || REASON[struggle.reason] || 'struggling', 30);
}

export function createFlares({ atlas, fontsReady }: { atlas: Atlas; fontsReady: () => boolean }) {
  let redraws = 0;
  const release = (S: FxState) => { if (S.fTile) { atlas.release(S.fTile); S.fTile = null; S.fDrawn = null; S.fLayout = null; } };
  return {
    release,
    /**
     * Ready S's flare for this frame (S.flare = {text, level} | null): alpha, tile (≤ budget redraws), on-screen size.
     */
    prepare(S: FxState, F: FxFrame, budget: { n: number }): boolean {
      const f = S.flare;
      if (!f) { if (S.fTile) release(S); return false; }
      const d = S.dist;
      S.fA = S.fade * Math.max(0, Math.min(1, (FLARE_FAR_M - d) / FADE_M));
      if (S.fA <= 0.01) return false;
      if (S.fDrawn !== f) {
        if (budget.n <= 0 || !fontsReady()) { if (!S.fLayout) return false; }
        else {
          if (!S.fTile) S.fTile = atlas.alloc(FLARE_TILE.w, FLARE_TILE.h);
          if (!S.fTile) return false;
          atlas.draw(S.fTile, (g) => { S.fLayout = drawFlare(g, f.text, f.level); });
          S.fDrawn = f; budget.n--; redraws++;
        }
      }
      const dEff = Math.max(2.5, Math.min(14, d));
      const k = F.vh / 900;
      const s = Math.min(Math.max(FLARE_SCALE * (dEff / Math.max(0.3, d)), FLARE_MIN_SCALE), 0.62) * k;
      const lay = S.fLayout;
      if (!lay) return false; // (unreachable: a drawn flare has its layout)
      S.fW = lay.w * s; S.fH = lay.h * s;
      return true;
    },
    /** UV rect of S's flare into `o` (reused). */
    uv(S: FxState, o: UvRect): UvRect {
      const t = S.fTile, lay = S.fLayout, sz = atlas.size;
      if (!t || !lay) return o; // (only asked for a placed, drawn flare)
      const x0 = t.x + (FLARE_TILE.w - lay.w) / 2;
      o.u0 = x0 / sz; o.v0 = t.y / sz; o.u1 = (x0 + lay.w) / sz; o.v1 = (t.y + lay.h) / sz;
      return o;
    },
    stats: () => ({ flareRedraws: redraws }),
  };
}

export type Flares = ReturnType<typeof createFlares>;
