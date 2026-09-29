// @pure
/**
 * The ONE settled-fit path (§8.5). Every layout change that can alter the fitted grid calls `invalidate(reason)`;
 * 150 ms after the last invalidation `onSettled(cols, rows, reason)` fires once. Nothing else computes cols/rows.
 * When several reasons land in one window, an explicit one wins (it is what the user did on purpose).
 * Owner: UI.
 */

/** Reasons that may resize the user's pane when we already control it at drawer size (§8.5 table). */
export const EXPLICIT_REASONS = Object.freeze(['drag', 'font', 'fullscreen', 'fitButton'] as const);
export const IMPLICIT_REASONS = Object.freeze(['window', 'roster', 'tab', 'dpr', 'display', 'collapse', 'open'] as const);
export type FitReason = (typeof EXPLICIT_REASONS)[number] | (typeof IMPLICIT_REASONS)[number];

/** A grid in character cells. */
export interface Grid { cols: number; rows: number }

/**
 * `setTimeout` / `clearTimeout` are injectable (tests); `T` is the handle type of that pair (the platform's own when
 * they are left out).
 */
export interface FitOptions<T = ReturnType<typeof setTimeout>> {
  measure: () => Grid | null;
  onSettled: (cols: number, rows: number, reason: FitReason | null) => void;
  delay?: number;
  setTimeout?: (fn: () => void, ms: number) => T;
  clearTimeout?: (handle: T) => void;
}

const isExplicit = (r: FitReason) => EXPLICIT_REASONS.some((x) => x === r);

export function createFit<T = ReturnType<typeof setTimeout>>(o: FitOptions<T>) {
  const delay = o.delay ?? 150;
  // the default pair is the platform's own setTimeout / clearTimeout, so T is their handle type there
  const st = (o.setTimeout ?? setTimeout) as (fn: () => void, ms: number) => T;
  const ct = (o.clearTimeout ?? clearTimeout) as (handle: T) => void;
  let timer: T | null = null;
  let reason: FitReason | null = null;
  const fire = () => {
    timer = null;
    const r = reason;
    reason = null;
    const g = o.measure();
    if (g && g.cols > 0 && g.rows > 0) o.onSettled(g.cols, g.rows, r);
  };
  return {
    invalidate(r: FitReason) {
      if (!reason || (isExplicit(r) && !isExplicit(reason))) reason = r;
      if (timer) ct(timer);
      timer = st(fire, delay);
    },
    /** Fire now if pending (tests / before a promote). */
    flush() { if (timer) { ct(timer); fire(); } },
    get pending() { return !!timer; },
  };
}

/** Grid that fits a box for a cell size. */
export function gridFor(w: number, h: number, cellW: number, cellH: number): Grid {
  return { cols: Math.max(10, Math.min(500, Math.floor(w / cellW))), rows: Math.max(4, Math.min(200, Math.floor(h / cellH))) };
}

/**
 * Readable floor (drawer fix r1, reviewer "the xterm is drawn at 10 px while Settings says 14"): the observe grid this
 * viewer ASKS for is capped at what the glass shows at max(11 px, 0.8×) of the user's size (never above it), so a grid
 * HQ sizes always draws at a readable size; a wider pane is cropped and the notice offers the fit instead.
 */
export const MIN_READABLE_PX = 11;
/** `want` = the user's termFontPx. */
export function minFontPx(want: number) { return Math.min(want, Math.max(MIN_READABLE_PX, Math.round(want * 0.8))); }
/** Hard floor for a grid someone else sized (another window is the sizer, a pane in Control at its layout): scale down
 * to 0.7× before panning, since a pan hides the pane's bottom rows (its prompt). */
export function hardMinPx(want: number) { return Math.max(6, Math.round(want * 0.7)); }

/**
 * Letterbox (§8.5): the xterm grid always equals the child grid. Scale the font down (to hardMinPx, 0.7×) to fit,
 * then centre; if still too small, pan.
 */
export function letterbox(o: { boxW: number; boxH: number; cols: number; rows: number; fontPx: number; cellW: (px: number) => number; cellH: (px: number) => number }): { fontPx: number; pan: boolean; w: number; h: number } {
  const min = hardMinPx(o.fontPx);
  for (let px = o.fontPx; px >= min; px--) {
    const w = o.cols * o.cellW(px), h = o.rows * o.cellH(px);
    if (w <= o.boxW && h <= o.boxH) return { fontPx: px, pan: false, w, h };
  }
  return { fontPx: min, pan: true, w: o.cols * o.cellW(min), h: o.rows * o.cellH(min) };
}

/**
 * Grid to request for the *observe* child (§4.7/§8.5). Observe never resizes the PTY, so a child narrower than the
 * pane's `layoutRect` crops it (the blocked question sits at the right edge). Ask for max(drawer grid, layoutRect) per
 * axis, capped at `cap` = the grid the drawer shows at the minimum font (minFontPx), so letterbox() always fits it without
 * panning. A pane wider than even that stays cropped and the drawer says so ("Cropped: pane is C×R" chip).
 * `term.fit`/`term.open` therefore carry "the observe grid this viewer wants" (the hub treats it as the sizer's grid);
 * `term.promote` keeps sending the plain drawer grid (control size policy).
 */
export function observeGrid(drawer: Grid, lr: Grid | null | undefined, cap?: Grid | null): Grid;
export function observeGrid(drawer: Grid | null, lr: Grid | null | undefined, cap?: Grid | null): Grid | null;
export function observeGrid(drawer: Grid | null, lr: Grid | null | undefined, cap: Grid | null = null): Grid | null {
  if (!drawer) return lr ? { cols: lr.cols, rows: lr.rows } : null;
  if (!lr || !(lr.cols > 0) || !(lr.rows > 0)) return drawer;
  const want = (d: number, l: number, c: number | undefined) => Math.max(d, Math.min(l, c ?? l));
  return { cols: Math.min(500, want(drawer.cols, lr.cols, cap?.cols)), rows: Math.min(200, want(drawer.rows, lr.rows, cap?.rows)) };
}

/**
 * [drawer fix r3, reviewer "fullscreen still says 'cropped' when the whole pane is on the glass"] The pane grid this
 * view can vouch for. Normally the pane's `layoutRect`; but when we are the observe sizer and the backend keeps the
 * child at a grid other than the one we asked for (larger than the ask on some axis, or still different once a
 * respawn had time to land), that child is the pane's own screen, shown whole: nothing is hidden, so it is the grid.
 * A child still at our PREVIOUS ask is a respawn in flight, not a refusal (until it goes stale).
 * `ask` = the last observe grid we sent (term.open / term.fit) and the one before it; `staleMs` = respawn rate limit + slack.
 */
export function paneGridSeen(lr: Grid | null | undefined, ts: (Partial<Grid> & { mode?: string; sizer?: boolean }) | null | undefined, ask: (Grid & { at: number; prev?: Grid | null }) | null | undefined, now: number, staleMs = 2600): Grid | null {
  if (!lr || !ts || ts.mode !== 'observe' || !ts.sizer || !ask) return lr ?? null;
  const { cols, rows } = ts;
  if (cols === undefined || rows === undefined || !(cols > 0)) return lr;
  const same = (a: Grid | null | undefined) => !!a && cols === a.cols && rows === a.rows;
  const ignored = !same(ask) && (now - ask.at > staleMs || ((cols > ask.cols || rows > ask.rows) && !same(ask.prev)));
  return ignored ? { cols, rows } : lr;
}

/**
 * [drawer fix r3, reviewer "fullscreen Peek doesn't refit; 'cropped' with ~700 px of empty glass"] Fullscreen is where
 * you go to see the whole pane: when the pane fits the glass at the hard floor (hardMinPx, 0.7×; one cell of slack for
 * pixel snapping) the observe child asks for exactly the pane's grid (a child cropped at the readable floor hides the
 * pane's bottom rows, its prompt; columns past the pane's edge would only be blank padding).
 * `floor` = the glass grid at hardMinPx.
 */
export function wholePaneFits(lr: Grid | null | undefined, floor: Grid | null): boolean {
  return !!(lr && floor && lr.cols > 0 && lr.rows > 0 && lr.cols <= floor.cols - 1 && lr.rows <= floor.rows - 1);
}
