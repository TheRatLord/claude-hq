// @pure
/**
 * Screen-space label declutter (ART §8.4, DESIGN §8 "screen-space collision nudging"), shared by every in-world label
 * FX draws: blocked alert cards, speech / thought bubbles, nameplates and activity glyphs, with the desk task boards
 * as fixed obstacles. [FX fix r2] r1 decluttered bubbles only (and only among themselves), so nameplates stacked three
 * deep at the Pit, bubbles sat on the plates and the boards, and queued alerts overlapped and ran off the screen edge.
 *
 * `createPlacer()` is a greedy placer in the spirit of UI's minimap label placer (ui/minimap.ts `layoutLabels`):
 * callers feed items in rank order (blocked > selected > hovered > nearest, fx/labels.ts); each item tries its anchor
 * spot, then spots just above / beside every rect already placed (cheapest move first, within `maxUp` / `maxSide`),
 * clamped inside the visible world strip; the caller collapses a loser to its dot / glyph (another `place`) or hides
 * it. Pinned items (blocked alerts) are never hidden: they may climb to the top of the strip or drop below a rect, and
 * ignore the board obstacles. All state lives in preallocated typed arrays: no per-frame allocation.
 * Pure (no three, no DOM): unit-tested in fx.test.ts.
 * Owner: FX.
 */

/** @pure Bubble priority (kept for the redraw budget order): blocked > selected > hovered > nearest working > others. */
export function bubblePriority({ priority = 0, selected = false, hovered = false, dist = 0, working = false }: { priority?: number; selected?: boolean; hovered?: boolean; dist?: number; working?: boolean }): number {
  return priority * 100 + (selected ? 60 : 0) + (hovered ? 40 : 0) + (working ? 10 : 0) - Math.min(dist, 50) * 0.1;
}

/**
 * @pure Agent rank for label placement (higher first): blocked (oldest wait first = queue order) > selected > hovered >
 * nearest. `waitMs` = how long it has been blocked; `queuePos` = its queue slot index (0 = head), -1 when not queued.
 */
export function labelRank({ blocked = false, waitMs = 0, selected = false, hovered = false, dist = 0, queuePos = -1 }: { blocked?: boolean; waitMs?: number; selected?: boolean; hovered?: boolean; dist?: number; queuePos?: number }): number {
  const d = Math.min(dist, 999);
  // [FX fix m2-r3] an agent standing in a queue slot ranks by its slot (0 = at the window, being served) above every
  // blocked agent not (yet) in the queue; the rest by wait
  if (blocked && queuePos >= 0) return 2e8 - Math.min(queuePos, 999) * 1e5 - d * 0.01;
  if (blocked) return 1e8 + Math.min(waitMs, 3.6e6) / 100 - d * 0.01; // queue order first, distance only breaks ties
  return (selected ? 2e5 : 0) + (hovered ? 1e5 : 0) - d * 10;
}

export interface AlertQuery {
  head?: boolean; selected?: boolean; hovered?: boolean; dist: number; cardW: number; chipW: number; chipMinW?: number;
  stripW: number; compactM?: number; slack?: number; compact?: boolean; onPanel?: boolean; plan?: boolean;
}
export interface AlertForm { form: 'card' | 'chip' | 'dot'; k: number }

/**
 * @pure [FX fix r3] Which form a blocked alert takes this frame. The full card for the head of the queue, the selected /
 * hovered agent, or within `compactM`; beyond it the compact "! name · ≥ m:ss" chip (a far queue of full cards buried
 * the queued bodies). A view strip narrower than the card + `slack` falls back to the chip, shrunk to fit down to its
 * readable minimum `chipMinW` (`k` = the chip's scale factor), then to the "!" dot.
 * `plan`: top-down plan / overview view of this agent (see PLAN_FWD_Y / PLAN_H) → the '!' pin unless hovered / selected.
 * `out` is reused by the caller.
 */
export function alertForm({ head = false, selected = false, hovered = false, dist, cardW, chipW, chipMinW = chipW, stripW, compactM = 6, slack = 16, compact = false, onPanel = false, plan = false }: AlertQuery, out: AlertForm = { form: 'card', k: 1 }): AlertForm {
  // [FX fix r2 m2-carry] plan / overview (a steep top-down camera far above the agent): every alert is the small red
  // '!' pin over its agent, the text only on hover / selection (a 390 px queue-head card sat over the atrium, c40-4)
  if (plan && !hovered && !selected) { out.form = 'dot'; out.k = 1; return out; }
  // [FX fix m2-r1] `compact` (serve scope / the queue within arm's reach): only the head keeps its card; `onPanel`: a UI
  // panel (status card, inbox) already shows this question, so the in-world label is the name · timer pill. `out` is
  // reused by the caller (no allocation per alert per frame).
  const cardFits = cardW + slack <= stripW;
  // [FX fix m2-r3] the queue head (the agent at the window, the one being served) always keeps its full card, even while
  // a UI panel shows the same question (serve: the head was a pill and queue #2's card sat on its hat)
  const full = head || (!onPanel && !compact && (selected || hovered || dist <= compactM));
  out.k = 1;
  if (cardFits && full) { out.form = 'card'; return out; }
  if (chipW > 0 && Math.min(chipW, chipMinW) + slack <= stripW) { out.form = 'chip'; out.k = Math.min(1, (stripW - slack) / chipW); return out; }
  out.form = cardFits ? 'card' : 'dot';
  return out;
}

/** [FX fix r2 m2-carry] Plan / overview camera: looks down steeper than ~58° (forward.y below this; = CHR's charBatch
 *  TOPDOWN_FWD_Y) from at least PLAN_H m above the agent's floor (the mezz rail looking into the Pit stays a normal view). */
export const PLAN_FWD_Y = -0.85, PLAN_H = 10;
/** @pure [FX fix r2 m2-carry] Is this a plan / overview view of an agent on floor `floorY`? */
export const planView = (fwdY: number, camY: number, floorY: number): boolean => fwdY < PLAN_FWD_Y && camY - floorY > PLAN_H;

/** [FX fix m2-r2] Edge band (px) = ui/chevrons.ts's inset: an alert anchored in it is the chevron's, not a clamped card. */
export const EDGE_BAND_PX = 28;
/** [FX fix m2-r2] Bottom band (px) = the chevrons' bottom inset. */
export const EDGE_BOTTOM_PX = 40;

/**
 * @pure [FX fix m2-r2] Is a label anchor (the agent's head, screen px) inside the visible world strip [L, R] x [0, vh]?
 * A plate / bubble / glyph whose head is off the strip, above the top or below the bottom (an agent under the
 * mezzanine seen from its rail) is not drawn: clamped to the edge it read as a HUD element pointing nowhere.
 */
export function anchorInView(x: number, y: number, L: number, R: number, vh: number): boolean {
  return x >= L && x <= R && y >= 0 && y <= vh;
}

/**
 * @pure [FX fix m2-r2] Does a blocked agent's alert belong to its edge chevron (UI) rather than a card clamped to the
 * strip edge? True when its head anchor lies within `band` px of the strip's left / right edge, above the top or within
 * `bottom` px of the bottom; with `band` / 2 hysteresis (`was` = last frame's answer) so a card at the edge does not
 * flicker between the two. The chevron carries the name and points at the agent.
 */
export function alertAtEdge(x: number, y: number, L: number, R: number, vh: number, was = false, band: number = EDGE_BAND_PX, bottom: number = EDGE_BOTTOM_PX): boolean {
  const h = was ? band * 0.5 : 0;
  return x < L + band + h || x > R - band - h || y < h || y > vh - bottom - h;
}

export interface PlaceItem {
  /** anchor x, px (the label's bottom centre sits here when unmoved) */
  x: number;
  /** anchor y, px (top-left origin) */
  y: number;
  /** label size, px */
  w: number;
  h: number;
  /** max upward move, px (default 0.8·h + 16) */
  maxUp?: number;
  /** max sideways move, px (default 0.5·w) */
  maxSide?: number;
  /** never hidden: unlimited climb, may drop below a rect, ignores obstacles */
  pinned?: boolean;
  /** override: respect the obstacles (a pinned item's first, bounded try) */
  avoidObs?: boolean;
  /**
   * respect the world sign plates (`sign` rects; default = avoidObs) [FX M1.75]: a pinned alert's second, still bounded
   * try, after it gave up on the task boards
   */
  avoidSigns?: boolean;
  /** may cover the protected bodies (`body` rects; default false) [FX fix r3] */
  overBodies?: boolean;
  /** pinned: climb only, never drop below a rect (the caller tries a smaller form first) */
  noDrop?: boolean;
  /** out: applied horizontal move, px */
  dx?: number;
  /** out: applied vertical move, px (negative = up) */
  dy?: number;
}
/** A label item that lives on an actor state (labels.ts): every field present, one shape [FX fix m2-r1]. */
export interface PlacedItem extends PlaceItem {
  maxUp: number; maxSide: number; pinned: boolean; overBodies: boolean; noDrop: boolean; dx: number; dy: number;
}

const EPS = 0.01; // rects that touch (a label stacked exactly one gap above another) do not overlap
const overlap = (R: Float64Array, i: number, x0: number, y0: number, x1: number, y1: number) => R[i] < x1 - EPS && R[i + 2] > x0 + EPS && R[i + 1] < y1 - EPS && R[i + 3] > y0 + EPS;

export function createPlacer({ max = 256, maxCand = 96 }: { max?: number; maxCand?: number } = {}) {
  const R = new Float64Array(max * 4); // placed rects x0 y0 x1 y1
  const obs = new Uint8Array(max); // 1 = fixed obstacle (board), 2 = forced label, 3 = protected body (queued Clawd), 4 = sign plate,
  // 5 = [FX fix m2-r1] UI panel (roster, inbox card, status card, minimap): a hard obstacle every label avoids, pinned included
  const C = new Float64Array(maxCand * 3); // candidates dx dy cost
  let n = 0, L = 0, RT = 0, VH = 0, M = 6, G = 3, T = 6;

  const push = (x0: number, y0: number, x1: number, y1: number, o: number) => {
    if (n >= max) return;
    const i = n * 4;
    R[i] = x0; R[i + 1] = y0; R[i + 2] = x1; R[i + 3] = y1; obs[n] = o; n++;
  };
  let k = 0; // candidate count (place)
  const cand = (dx: number, dy: number, cost: number) => { if (k < maxCand) { C[k * 3] = dx; C[k * 3 + 1] = dy; C[k * 3 + 2] = cost; k++; } };
  const skip = (j: number, useObs: boolean, useBody: boolean, useSign: boolean) => (obs[j] === 1 && !useObs) || (obs[j] === 3 && !useBody) || (obs[j] === 4 && !useSign);
  const isLabel = (o: number) => o === 0 || o === 2;
  const free = (x0: number, y0: number, x1: number, y1: number, useObs: boolean, useBody: boolean, useSign: boolean) => {
    for (let j = 0; j < n; j++) if (!skip(j, useObs, useBody, useSign) && overlap(R, j * 4, x0 - G, y0 - G, x1 + G, y1 + G)) return false;
    return true;
  };

  return {
    /**
     * Start a frame: the visible world strip is [left, vw − right] × [top, vh] (roster / drawer insets, the HUD's pill
     * row on top; CSS px).
     */
    begin(vw: number, vh: number, left = 0, right = 0, margin = 6, gap = 3, top = margin) { n = 0; L = left; RT = vw - right; VH = vh; M = margin; G = gap; T = Math.max(margin, top); },
    /** A fixed rect labels avoid (a task board). */
    obstacle(x0: number, y0: number, x1: number, y1: number) { push(x0, y0, x1, y1, 1); },
    /** [FX M1.75] A world sign plate (HELP DESK, bay signs): like an obstacle, but a pinned alert keeps avoiding it one
     *  bounded try longer (`avoidSigns`) after it gave up on the boards. */
    sign(x0: number, y0: number, x1: number, y1: number) { push(x0, y0, x1, y1, 4); },
    /**
     * [FX fix r3] A protected body rect (a queued Clawd): every label avoids it, pinned alerts included, unless the item
     * says `overBodies` (the last resort before `force`). Not counted by `overlaps`.
     */
    body(x0: number, y0: number, x1: number, y1: number) { push(x0, y0, x1, y1, 3); },
    /** [FX fix m2-r1] A DOM panel over the world (roster, inbox card, status card, minimap; CSS px): no label is ever
     *  placed under it, pinned alerts included (`force` excepted: the caller checks `underPanel` and hides those). */
    panel(x0: number, y0: number, x1: number, y1: number) { push(x0, y0, x1, y1, 5); },
    /** [FX fix m2-r1] Does the rect overlap a UI panel by more than `frac` of its own area? */
    underPanel(x0: number, y0: number, x1: number, y1: number, frac = 0.15): boolean {
      const area = Math.max(1, (x1 - x0) * (y1 - y0));
      for (let j = 0; j < n; j++) {
        if (obs[j] !== 5) continue;
        const i = j * 4, w = Math.min(x1, R[i + 2]) - Math.max(x0, R[i]), h = Math.min(y1, R[i + 3]) - Math.max(y0, R[i + 1]);
        if (w > 0 && h > 0 && (w * h) / area > frac) return true;
      }
      return false;
    },
    /** [FX fix m2-r1] Drop the last placed / forced rect (a forced label the caller then hides). */
    pop() { if (n > 0 && isLabel(obs[n - 1])) n--; },
    /** Width of the visible world strip, px. */
    get stripW() { return RT - L; },
    /** Is the anchor inside the strip, give or take half a label (else the label is not drawn: UI's edge chevrons own it)? */
    inStrip(x: number, w: number): boolean { return x >= L - w * 0.5 && x <= RT + w * 0.5; },
    /**
     * Try to place `it`; on success record its rect, write `it.dx / it.dy` and return true.
     */
    place(it: PlaceItem): boolean {
      const { w, h } = it;
      const pinned = !!it.pinned, useObs = it.avoidObs ?? !pinned, useBody = !it.overBodies, useSign = it.avoidSigns ?? useObs;
      const maxUp = pinned && !useObs && !useSign ? Infinity : it.maxUp ?? h * 0.8 + 16;
      const maxSide = it.maxSide ?? (pinned ? w * 0.25 : w * 0.5);
      // clamp into the strip
      let x0 = it.x - w / 2, y0 = it.y - h;
      const lo = L + M, hi = RT - M - w;
      const dxc = hi < lo ? (L + RT) / 2 - w / 2 - x0 : x0 < lo ? lo - x0 : x0 > hi ? hi - x0 : 0;
      const dyc = y0 < T ? T - y0 : y0 + h > VH - M ? VH - M - h - y0 : 0;
      x0 += dxc; y0 += dyc;
      // candidates: stay, then above / beside / (pinned) below each nearby rect
      k = 0;
      cand(0, 0, 0);
      for (let j = 0; j < n; j++) {
        if (skip(j, useObs, useBody, useSign)) continue;
        const i = j * 4;
        if (R[i + 2] < x0 - maxSide - G || R[i] > x0 + w + maxSide + G) continue;
        const up = R[i + 1] - G - (y0 + h); // < 0: move up so our bottom clears its top
        if (up < 0 && -up <= maxUp) cand(0, up, -up);
        if (R[i + 1] < y0 + h + G && R[i + 3] > y0 - G) { // side moves only for rects at our height
          const left = R[i] - G - (x0 + w), right = R[i + 2] + G - x0;
          if (left < 0 && -left <= maxSide) cand(left, 0, -left * 1.4);
          if (right > 0 && right <= maxSide) cand(right, 0, right * 1.4);
        }
        // only when the climb is out: [FX fix r3] and only on the unbounded pass (a bounded first try that dropped a queue
        // chip under the desk read as detached from its Clawd)
        if (pinned && maxUp === Infinity && !it.noDrop) { const down = R[i + 3] + G - y0; if (down > 0) cand(0, down, down * 4 + 400); }
      }
      // [FX M1.75] diagonal moves: beside the rects at the height of each upward candidate (a queue chip could only go
      // straight up over the HELP DESK sign, never up-and-left into the free wall beside the stack)
      const k1 = k;
      for (let c = 1; c < k1; c++) {
        const dy = C[c * 3 + 1];
        if (dy >= 0 || C[c * 3] !== 0) continue;
        const yy0 = y0 + dy, yy1 = yy0 + h;
        for (let j = 0; j < n && k < maxCand; j++) {
          if (skip(j, useObs, useBody, useSign)) continue;
          const i = j * 4;
          if (!(R[i + 1] < yy1 + G && R[i + 3] > yy0 - G)) continue;
          const left = R[i] - G - (x0 + w), right = R[i + 2] + G - x0;
          if (left < 0 && -left <= maxSide) cand(left, dy, -dy - left * 1.4 + 1);
          if (right > 0 && right <= maxSide) cand(right, dy, -dy + right * 1.4 + 1);
        }
      }
      // cheapest free candidate inside the strip
      for (;;) {
        let best = -1;
        for (let c = 0; c < k; c++) if (C[c * 3 + 2] >= 0 && (best < 0 || C[c * 3 + 2] < C[best * 3 + 2])) best = c;
        if (best < 0) return false;
        const dx = C[best * 3], dy = C[best * 3 + 1];
        C[best * 3 + 2] = -1; // consumed
        const ax = x0 + dx, ay = y0 + dy;
        if (ax < lo - 0.5 || ax > Math.max(lo, hi) + 0.5 || ay < T - 0.5 || ay + h > VH - M + 0.5) continue;
        if (!free(ax, ay, ax + w, ay + h, useObs, useBody, useSign)) continue;
        push(ax, ay, ax + w, ay + h, 0);
        it.dx = dxc + dx; it.dy = dyc + dy;
        return true;
      }
    },
    /** Record `it` at its clamped anchor spot regardless of collisions (a pinned item that found no free spot). */
    force(it: PlaceItem) {
      const { w, h } = it;
      let x0 = it.x - w / 2, y0 = it.y - h;
      const lo = L + M, hi = RT - M - w;
      const dxc = hi < lo ? (L + RT) / 2 - w / 2 - x0 : x0 < lo ? lo - x0 : x0 > hi ? hi - x0 : 0;
      const dyc = y0 < T ? T - y0 : y0 + h > VH - M ? VH - M - h - y0 : 0;
      x0 += dxc; y0 += dyc;
      push(x0, y0, x0 + w, y0 + h, 2); // 2 = forced (a label, but may overlap)
      it.dx = dxc; it.dy = dyc;
    },
    /** Placed label rects (obstacles excluded) that overlap another label or an obstacle: the §8 acceptance metric. */
    overlaps(): number {
      let c = 0;
      for (let a = 0; a < n; a++) {
        if (!isLabel(obs[a])) continue;
        for (let b = 0; b < n; b++) {
          if (b === a || obs[b] === 3 || (b < a && isLabel(obs[b]))) continue;
          const i = b * 4;
          if (overlap(R, a * 4, R[i], R[i + 1], R[i + 2], R[i + 3])) c++;
        }
      }
      return c;
    },
    /** Debug: index pairs of overlapping rects (as counted by `overlaps`). */
    overlapPairs(): [number, number][] {
      const out: [number, number][] = [];
      for (let a = 0; a < n; a++) {
        if (!isLabel(obs[a])) continue;
        for (let b = 0; b < n; b++) {
          if (b === a || obs[b] === 3 || (b < a && isLabel(obs[b]))) continue;
          const i = b * 4;
          if (overlap(R, a * 4, R[i], R[i + 1], R[i + 2], R[i + 3])) out.push([a, b]);
        }
      }
      return out;
    },
    /**
     * [FX fix r3] Fraction (0..1) of the rect x0 y0 x1 y1 left uncovered by the placed labels (a 12 × 12 sample grid):
     * the queue acceptance metric (≥ 50% of every queued body visible).
     */
    clearFrac(x0: number, y0: number, x1: number, y1: number): number {
      let hit = 0;
      const N = 12;
      for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
        const px = x0 + ((a + 0.5) / N) * (x1 - x0), py = y0 + ((b + 0.5) / N) * (y1 - y0);
        for (let j = 0; j < n; j++) {
          if (!isLabel(obs[j])) continue;
          const i = j * 4;
          if (px > R[i] && px < R[i + 2] && py > R[i + 1] && py < R[i + 3]) { hit++; break; }
        }
      }
      return 1 - hit / (N * N);
    },
    get count() { return n; },
    /** Rect i (x0, y0, x1, y1, obstacle) — for tests / debug. */
    rect(i: number): [number, number, number, number, number] { const j = i * 4; return [R[j], R[j + 1], R[j + 2], R[j + 3], obs[i]]; },
  };
}

/**
 * @pure [FX fix m2-r1] Stable in-place insertion sort for the per-frame label / actor lists (≤ a few hundred items,
 * nearly sorted frame to frame): Array.prototype.sort copies into a work array and boxes the comparator's float
 * results every call (≈ 4–8 KB of garbage per sort at crowd40); this allocates nothing.
 */
export function sortInPlace<T>(a: T[], cmp: (x: T, y: T) => number): T[] {
  for (let i = 1; i < a.length; i++) {
    const x = a[i];
    let j = i - 1;
    while (j >= 0 && cmp(a[j], x) > 0) { a[j + 1] = a[j]; j--; }
    a[j + 1] = x;
  }
  return a;
}
