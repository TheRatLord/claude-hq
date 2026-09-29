/**
 * Nameplates (ART §8.2 as amended by §5.5/§6.7): a pill in the workspace colour with the agent's display name (the Big
 * Board's, " · 2" for a same-named twin [FX fix m2-r2]) (+ the tab as an inset tab chip, never " · tab" [FX fix m2-r2], only
 * when the tab says something: [FX fix r2] not the agent kind's default 'claude' / 'codex' tab or a copy of the name,
 * rules.plateTab), 0.08 m above the head/accessory. Shown within 6 m (fading to 9 m), and always when hovered /
 * selected / blocked. Screen-constant like the bubbles; the pill tile is redrawn only when name / tab / colour change.
 * Placement is fx/labels.ts's (one declutter pass with the bubbles, glyphs and boards); this module owns the tile and
 * the size. Owner: FX.
 */
import { workspaceColor } from '../../../shared/palette.ts';
import { PLATE_TILE, drawPlate } from './draw.ts';
import { plateAlpha, plateTab } from './rules.ts';
import type { Atlas } from './atlas.ts';
import type { FxFrame, FxState, UvRect } from './types.ts';

const PLATE_SCALE = 0.42; // screen px per tile px at 900 px viewport height
const PLATE_MAX_H = 36; // [LVL fix m2 r2, cross-owner FX] max on-screen pill height (px at 900 px viewport height)

export function createNameplates({ atlas, fontsReady }: { atlas: Atlas; fontsReady: () => boolean }) {
  let redraws = 0;
  const PQ = { dist: 0, hovered: false, selected: false, blocked: false }; // [FX fix m2-r1] reused plateAlpha query
  const release = (S: FxState) => { if (S.pTile) { atlas.release(S.pTile); S.pTile = null; S.pDrawn = null; } };
  return {
    release,
    /**
     * Ready S's plate for this frame: alpha, tile (≤ budget redraws) and on-screen size. false = no plate. `budget` =
     * redraw budget, `kind` = agent kind.
     */
    prepare(S: FxState, F: FxFrame, budget: { n: number }, kind?: string): boolean {
      PQ.dist = S.dist; PQ.hovered = S.hovered; PQ.selected = S.selected; PQ.blocked = S.status === 'blocked';
      const plate = S.plate;
      S.pA = plate ? plateAlpha(PQ) * S.fade : 0;
      if (!plate || S.pA <= 0.01) return false;
      // [FX fix m2-r2] the board's display name (S.name: "dev · 2" for a twin), so a redraw also when it changes
      const nm = S.name || plate.name;
      if (S.pDrawn !== plate || S.pName !== nm) {
        if (budget.n <= 0 || !fontsReady()) { if (!S.pDrawn) return false; }
        else {
          if (!S.pTile) S.pTile = atlas.alloc(PLATE_TILE.w, PLATE_TILE.h);
          if (!S.pTile) return false;
          atlas.draw(S.pTile, (g) => { S.pLayout = drawPlate(g, nm, plateTab(plate.name, plate.tab, kind), workspaceColor(plate.colorIndex ?? 0)); });
          S.pDrawn = plate; S.pName = nm; budget.n--; redraws++;
        }
      }
      const lay = S.pLayout;
      if (!lay) return false; // (unreachable: a drawn plate has its layout)
      const d = S.dist, dEff = Math.max(2.5, Math.min(14, d));
      // [LVL fix m2 r2, cross-owner FX] close-range cap: the < 2.5 m growth stops at a 36 px (@900) tall pill (an agent
      // 1 m from the street lens drew a ~60 px plate; gameplay review m2-r2 allStates-h18-2)
      const s = Math.min(PLATE_SCALE * (F.vh / 900) * (dEff / Math.max(0.3, d)), (PLATE_MAX_H * F.vh / 900) / Math.max(1, lay.h));
      S.pW = lay.w * s; S.pH = lay.h * s;
      return true;
    },
    /** UV rect of S's plate into `o` (reused). */
    uv(S: FxState, o: UvRect): UvRect {
      const t = S.pTile, lay = S.pLayout, sz = atlas.size;
      if (!t || !lay) return o; // (only asked for a placed, drawn plate)
      const x0 = t.x + (PLATE_TILE.w - lay.w) / 2;
      o.u0 = x0 / sz; o.v0 = t.y / sz; o.u1 = (x0 + lay.w) / sz; o.v1 = (t.y + lay.h) / sz;
      return o;
    },
    stats: () => ({ plateRedraws: redraws }),
  };
}

export type Nameplates = ReturnType<typeof createNameplates>;
