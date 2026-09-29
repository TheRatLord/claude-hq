/**
 * Speech / thought / alert bubbles (ART §8.1): paper sprites, screen-constant between 2.5 and 14 m, pop-in easeOutBack
 * + a small decaying wobble. The blocked alert is a paper card with the question and the wait time, plus a hot (2.5)
 * "!" badge that bounces: the only strong bloom. Tiles are pooled per actor and redrawn only when the brain hands over
 * a new bubble object (≤ 3 per frame). Placement (declutter, collapse to a dot) is fx/labels.ts's; this module owns the
 * tiles, the on-screen size and the quads.
 * [FX fix r2] Alert cards keep a minimum on-screen size (title ≥ ALERT_MIN_TITLE_PX, the timer ≥ 13 px), so a queued
 * question reads from the spawn (~11 m: it was ≈ 7 px); they draw on the no-depth-test batch (never cut by door
 * frames, rails or lamp posts) and write the character mask, so the Edge / AO passes never draw through them.
 * Owner: FX.
 */
import { STATUS } from '../../../shared/palette.ts';
import { BUBBLE_TILE, CHIP_TILE, DOT_TILE, drawBubble, drawChip } from './draw.ts';
import { bubbleAlpha, BUBBLE_FAR_M } from './rules.ts';
import { QV, type QuadBatch } from './quads.ts'; // [FX fix m2-r1] staged quads (no boxed float arguments)
import type { Atlas, Tile } from './atlas.ts';
import type { BubbleSpec, FxFrame, FxState } from './types.ts';

const MAX_REDRAW = 3;
const POP_S = 0.3;
const BUBBLE_SCALE = 0.42; // screen px per tile px at a 900 px viewport (tiles are drawn at ≈ 2×)
/** Alert title font is 28 tile px (draw.ts): 15.5 px on screen ≈ 11 px cap height, the timer (23 tile px) ≈ 12.7 px. */
export const ALERT_MIN_TITLE_PX = 15.5;
/** [FX fix r3] Compact alert chip: its mono "name · ≥ m:ss" line never below this on screen (px). */
export const CHIP_MIN_TEXT_PX = 13;
const easeOutBack = (x: number) => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2; };

/** STATUS by an arbitrary status string (an entity status the palette may not know falls back below). */
const statusColor = (status: string): string | undefined => (STATUS as Readonly<Record<string, string>>)[status];

/** Status colour of a bubble badge. */
export const badgeHex = (spec: Pick<BubbleSpec, 'kind'>, status: string): string => (spec.kind === 'alert' ? STATUS.blocked : spec.kind === 'thought' ? STATUS.unknown : statusColor(status) ?? STATUS.working);

/** Batches an emitted full bubble draws into: the card, its hot "!" badge and that badge's tile. */
export interface BubbleTargets { card: QuadBatch; badge: QuadBatch; badgeTile: Tile }

export function createBubbles({ atlas, fontsReady }: { atlas: Atlas; fontsReady: () => boolean }) {
  let redraws = 0;
  const budget = { n: MAX_REDRAW };
  const AQ = { dist: 0, kind: '' }; // [FX fix m2-r1] reused bubbleAlpha query

  const release = (S: FxState) => {
    if (S.bTile) { atlas.release(S.bTile); S.bTile = null; S.bDrawn = null; }
    if (S.cTile) { atlas.release(S.cTile); S.cTile = null; S.cDrawn = null; S.cLayout = null; }
  };

  /** [FX fix r3] Ensure the actor's compact alert chip tile ("! name · ≥ m:ss") shows its current spec. */
  function ensureChip(S: FxState): boolean {
    const spec = S.bubble;
    if (!spec) return false; // (only called for a shown bubble)
    const who = S.name || S.plate?.name || ''; // [FX fix m2-r2] the board's display name
    if (S.cDrawn === S.bubble && S.cWho === who) return !!S.cLayout;
    if (budget.n <= 0 || !fontsReady()) return !!S.cLayout; // keep the old timer a frame
    if (!S.cTile) S.cTile = atlas.alloc(CHIP_TILE.w, CHIP_TILE.h);
    if (!S.cTile) return false;
    atlas.draw(S.cTile, (g) => { S.cLayout = drawChip(g, who, spec.detail ?? ''); });
    S.cDrawn = spec; S.cWho = who;
    budget.n--;
    redraws++;
    return true;
  }

  /** Ensure the actor's bubble tile shows its current spec. Returns true when ready. */
  function ensure(S: FxState): boolean {
    const spec = S.bubble;
    if (!spec) return false; // (only called for a shown bubble)
    const who = spec.kind === 'alert' ? S.name || S.plate?.name || '' : ''; // [FX fix m2-r2] board display name
    if (S.bDrawn === S.bubble && S.bWho === who) return true;
    if (budget.n <= 0 || !fontsReady()) return !!S.bDrawn && S.bDrawn.kind === spec.kind; // keep the old text a frame
    if (!S.bTile) S.bTile = atlas.alloc(BUBBLE_TILE.w, BUBBLE_TILE.h);
    if (!S.bTile) return false;
    atlas.draw(S.bTile, (g) => { S.bLayout = drawBubble(g, spec, badgeHex(spec, S.status), undefined, undefined, who); });
    S.bWho = who;
    const popKey = `${spec.kind}|${spec.icon}|${spec.kind === 'alert' ? '' : spec.title}`;
    if (popKey !== S.bPopKey) { S.bPopKey = popKey; S.bPopT = S.nowT; }
    S.bDrawn = spec;
    budget.n--;
    redraws++;
    return true;
  }

  return {
    release,
    /** Once per frame, before `prepare` calls (states in redraw-priority order). */
    begin() { budget.n = MAX_REDRAW; },
    /**
     * Ready S's bubble: alpha, tile, on-screen size (S.bW, S.bH px; S.bDot = collapsed dot diameter), pop factor.
     * Returns false when there is nothing to draw this frame.
     */
    prepare(S: FxState, F: FxFrame): boolean {
      if (!S.bubble) { if ((S.bTile || S.cTile) && S.nowT - (S.bGoneT ?? 0) > 2) release(S); return false; }
      S.bGoneT = S.nowT;
      const alert = S.bubble.kind === 'alert';
      AQ.dist = S.dist; AQ.kind = S.bubble.kind;
      S.bA = bubbleAlpha(AQ) * S.fade;
      if (S.bA <= 0.01 || (!alert && S.dist > BUBBLE_FAR_M)) return false;
      if (!ensure(S) || !S.bLayout) return false;
      const dEff = Math.max(2.5, Math.min(14, S.dist));
      let s = BUBBLE_SCALE * (F.vh / 900) * (dEff / Math.max(0.3, S.dist)); // screen px per tile px
      if (alert) {
        // [FX fix r2] readable from the spawn: the (possibly fit-shrunk) title never below ALERT_MIN_TITLE_PX, even at
        // 768 px tall; a long question may widen the card up to 32% of the viewport
        const want = (ALERT_MIN_TITLE_PX / (S.bLayout.titlePx || 28)) * Math.min(1.25, Math.max(1, F.vh / 900));
        s = Math.max(s, Math.min(want, (0.32 * F.vw) / S.bLayout.w));
      }
      S.bS = s; S.bW = S.bLayout.w * s; S.bH = S.bLayout.h * s; S.bDot = DOT_TILE.w * s * 0.55;
      // [FX fix r3] alerts also ready the compact chip (labels.ts picks card / chip / dot per frame)
      S.cW = S.cH = 0;
      const cl = alert && ensureChip(S) ? S.cLayout : null;
      if (cl) {
        const sd = BUBBLE_SCALE * (F.vh / 900) * (dEff / Math.max(0.3, S.dist));
        const cs = Math.max(sd, (CHIP_MIN_TEXT_PX / cl.titlePx) * Math.min(1.25, Math.max(1, F.vh / 900)));
        S.cS = cs; S.cW = cl.w * cs; S.cH = cl.h * cs;
        S.cMinW = cl.w * (CHIP_MIN_TEXT_PX * 0.85 / cl.titlePx); // the smallest still-readable chip
      }
      const pop = Math.min(1, (S.nowT - S.bPopT) / POP_S);
      S.bK = pop < 1 ? easeOutBack(pop) : 1;
      S.bWob = pop < 1 ? Math.sin(pop * 18) * (1 - pop) * 0.035 : 0; // ≈ 2°
      return true;
    },
    /**
     * Push S's full bubble into the `to` batches. Centre (cx, cy, cz) world, hw / hh world half sizes, axes R / U
     * (camera, wobbled here). `chip`: the compact alert chip instead of the full card [FX fix r3].
     */
    emitFull(S: FxState, F: FxFrame, to: BubbleTargets, cx: number, cy: number, cz: number, hw: number, hh: number, chip = false) {
      const c = Math.cos(S.bWob), sn = Math.sin(S.bWob);
      const Rx = F.R.x * c + F.U.x * sn, Ry = F.R.y * c + F.U.y * sn, Rz = F.R.z * c + F.U.z * sn;
      const Ux = -F.R.x * sn + F.U.x * c, Uy = -F.R.y * sn + F.U.y * c, Uz = -F.R.z * sn + F.U.z * c;
      const lay = chip ? S.cLayout : S.bLayout, t = chip ? S.cTile : S.bTile, sz = atlas.size, TW = chip ? CHIP_TILE.w : BUBBLE_TILE.w;
      if (!lay || !t) return; // (a label is only placed once its tile is drawn)
      const x0 = t.x + (TW - lay.w) / 2;
      (QV[0] = cx, QV[1] = cy, QV[2] = cz, QV[3] = Rx * hw, QV[4] = Ry * hw, QV[5] = Rz * hw, QV[6] = Ux * hh, QV[7] = Uy * hh, QV[8] = Uz * hh, QV[9] = x0 / sz, QV[10] = t.y / sz, QV[11] = (x0 + lay.w) / sz, QV[12] = (t.y + lay.h) / sz, QV[13] = 1, QV[14] = 1, QV[15] = 1, QV[16] = S.bA, to.card.pushQ());
      if (lay.badge) {
        // hot "!" badge over the painted one, bouncing
        const bt = to.badgeTile;
        const tpx = (2 * hh) / lay.h; // world per tile px
        const ox = (lay.badge.x - TW / 2) * tpx, oy = (lay.h / 2 - lay.badge.y) * tpx;
        const bounce = Math.abs(Math.sin(S.nowT * 4.2));
        const r = lay.badge.r * tpx * (1.12 + 0.12 * bounce);
        const lift = bounce * 0.25 * r;
        (QV[0] = cx + Rx * ox + Ux * (oy + lift) - F.F.x * 0.01, QV[1] = cy + Ry * ox + Uy * (oy + lift) - F.F.y * 0.01, QV[2] = cz + Rz * ox + Uz * (oy + lift) - F.F.z * 0.01, QV[3] = Rx * r, QV[4] = Ry * r, QV[5] = Rz * r, QV[6] = Ux * r, QV[7] = Uy * r, QV[8] = Uz * r, QV[9] = bt.u0, QV[10] = bt.v0, QV[11] = bt.u1, QV[12] = bt.v1, QV[13] = 1, QV[14] = 1, QV[15] = 1, QV[16] = S.bA, to.badge.pushQ());
      }
    },
    stats: () => ({ bubbleRedraws: redraws }),
  };
}

export type Bubbles = ReturnType<typeof createBubbles>;
