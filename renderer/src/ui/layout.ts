// @pure
/**
 * Focus & layout model widths (§8.2.1): roster R = 360 px (300 compact), drawer D = clamp(pct·W, 480, W − R − 240),
 * the world keeps ≥ 240 px. If pct·W doesn't fit next to the roster, the roster collapses to a 64 px icon rail and the
 * drawer gets min(pct·W, W − 64 − 240). Owner: UI.
 */
export const WORLD_MIN = 240;
export const RAIL_W = 64;
export const DRAWER_MIN = 480;
export const DRAWER_RAIL_W = 32; // §8.2.1 says 28 px; 32 fits a 20 px portrait + state dot
export const PCT_MIN = 0.35;
export const PCT_MAX = 0.8;

export type DrawerMode = 'closed' | 'docked' | 'collapsed' | 'fullscreen';
export type RosterMode = 'closed' | 'full' | 'rail';

export function computeLayout(o: { W: number; pct: number; roster: boolean; compact?: boolean; drawer: DrawerMode }): { rosterW: number; rosterMode: RosterMode; drawerW: number; worldW: number } {
  const W = o.W;
  const R = o.compact ? 300 : 360;
  const pct = Math.min(PCT_MAX, Math.max(PCT_MIN, o.pct));
  let drawerW = 0;
  let rosterMode: RosterMode = o.roster ? 'full' : 'closed';
  if (o.drawer === 'fullscreen') drawerW = W;
  else if (o.drawer === 'collapsed') drawerW = DRAWER_RAIL_W;
  else if (o.drawer === 'docked') {
    const want = pct * W;
    if (!o.roster) drawerW = Math.min(Math.max(want, DRAWER_MIN), W - WORLD_MIN);
    else if (want <= W - R - WORLD_MIN) drawerW = Math.min(Math.max(want, DRAWER_MIN), W - R - WORLD_MIN);
    else { rosterMode = 'rail'; drawerW = Math.min(want, W - RAIL_W - WORLD_MIN); }
    drawerW = Math.max(0, Math.round(drawerW));
  }
  const rosterW = rosterMode === 'full' ? R : rosterMode === 'rail' ? RAIL_W : 0;
  return { rosterW, rosterMode, drawerW, worldW: Math.max(0, W - rosterW - drawerW) };
}

/**
 * Off-axis projection that centres the perspective on the visible world strip [left, W − right] (§8.2.1): the canvas
 * stays full-screen, but the principal point moves to the strip's centre, so the reticle, the aim ray and WASD forward
 * all sit on the camera axis (NDC 0 of the strip) and the frontage the roster covered slides into view. Feed the result
 * to `camera.aspect = fullW / H; camera.setViewOffset(fullW, H, offsetX, 0, W, H)` (the canvas is a W-wide window of a
 * virtual `fullW`-wide frame centred on the strip). `null` = centred strip → `clearViewOffset()`.
 * `W`, `left`, `right` are CSS px.
 */
export function stripView(W: number, left: number, right: number): { fullW: number; offsetX: number } | null {
  const cx = (left + (W - right)) / 2;
  if (!(W > 0) || Math.abs(cx - W / 2) < 0.5) return null;
  const half = Math.max(cx, W - cx);
  const fullW = 2 * half;
  return { fullW, offsetX: half - cx };
}

/** Strip width below which the compact card is used (reviewer r3: 683 px of world at 1366 with the drawer at 50 %). */
export const COMPACT_STRIP_PX = 900;
/** The card's rect keeps this far from the reticle (strip centre) on at least one axis. */
export const RETICLE_CLEAR_PX = 60;
export const CARD_MARGIN_PX = 12;

/**
 * Pure card geometry for a strip (right-aligned, bottom-anchored with a 12 px margin): width, max height, compact.
 * Horizontal clearance first (card left edge ≥ reticle x + 60); when the strip is too narrow for a 200 px card to
 * clear it sideways, the height is capped so the card's top stays ≥ 60 px below the reticle instead.
 * `free` = width available beside the minimap.
 */
export function statusCardGeometry(stripW: number, H: number, free = stripW): { w: number; maxH: number; compact: boolean } {
  const compact = stripW < COMPACT_STRIP_PX;
  const side = stripW / 2 - RETICLE_CLEAR_PX - CARD_MARGIN_PX; // widest card that clears the reticle sideways
  const cap = compact ? Math.min(0.4 * stripW, 300) : 340;
  let w = Math.max(compact ? 180 : 220, Math.min(cap, side, free));
  let maxH = Math.round(compact ? 0.45 * H : H - 2 * CARD_MARGIN_PX - 60);
  if (w > side) maxH = Math.min(maxH, Math.floor(H / 2 - RETICLE_CLEAR_PX - CARD_MARGIN_PX));
  w = Math.floor(w);
  return { w, maxH: Math.max(120, maxH), compact };
}
