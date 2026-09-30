// @pure
/** Terminal grid measurement and letterboxing, independent of its host UI. */
export interface Grid { cols: number; rows: number }

/** Grid that fits a box for a cell size. */
export function gridFor(w: number, h: number, cellW: number, cellH: number): Grid {
  return { cols: Math.max(10, Math.min(500, Math.floor(w / cellW))), rows: Math.max(4, Math.min(200, Math.floor(h / cellH))) };
}

/** Scale down to 0.7× before panning; never draw below 6 px. */
export function hardMinPx(want: number) { return Math.max(6, Math.round(want * 0.7)); }

/** Preserve the child's exact grid: reduce font size to fit, then pan if necessary. */
export function letterbox(o: { boxW: number; boxH: number; cols: number; rows: number; fontPx: number; cellW: (px: number) => number; cellH: (px: number) => number }): { fontPx: number; pan: boolean; w: number; h: number } {
  const min = hardMinPx(o.fontPx);
  for (let px = o.fontPx; px >= min; px--) {
    const w = o.cols * o.cellW(px), h = o.rows * o.cellH(px);
    if (w <= o.boxW && h <= o.boxH) return { fontPx: px, pan: false, w, h };
  }
  return { fontPx: min, pan: true, w: o.cols * o.cellW(min), h: o.rows * o.cellH(min) };
}
