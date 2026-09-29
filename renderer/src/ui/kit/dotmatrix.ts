/**
 * Readout dot-matrix (docs/design/ui-kit.md §2.1, §3 Readout): the Big Board's own 5×7 bitmap (`drawDots` from
 * world/stats/dotfont.ts) on a small canvas. ONLY three uses are allowed (the kit lint test enforces who imports this):
 * the HUD needs-you digit, the drawer blocked counter and the triage progress. Redraws only when the text changes.
 * Owner: UI (kit).
 */
import { drawDots, dotWidth } from '../../world/stats/dotfont.ts';

/**
 * Draw `text` into `cv` at `pitch` CSS px per dot (≥ 2), DPR-sharp, with faint ghost dots and a soft glow.
 * `o.dot` = lit dot radius as a fraction of the pitch (default .42); `o.glow` = glow blur in pitches (default 1.4);
 * `o.core` = a hot bulb-centre colour drawn over each lit dot — the HUD needs-you digit uses fatter dots with a hot
 * core so it out-reads the system numerals beside it.
 */
export function paintDots(cv: HTMLCanvasElement, text: string, color: string, pitch = 2, o: { dot?: number; glow?: number; core?: string } = {}) {
  const s = String(text).toUpperCase();
  const dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
  const w = Math.max(1, Math.ceil(dotWidth(s) * pitch)), h = Math.ceil(7 * pitch);
  cv.width = w * dpr; cv.height = h * dpr;
  cv.style.width = `${w}px`; cv.style.height = `${h}px`;
  const g = cv.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  // unlit cells: a warm ghost, like the Big Board's bulbs
  drawDots(g, ' '.repeat(s.length), 0, 0, pitch, 'rgb(255,236,210)', { dot: 0.42, ghost: 0.08 });
  const dot = o.dot ?? 0.42;
  g.shadowColor = color; g.shadowBlur = pitch * (o.glow ?? 1.4);
  drawDots(g, s, 0, 0, pitch, color, { dot });
  g.shadowBlur = 0;
  if (o.core) drawDots(g, s, 0, 0, pitch, o.core, { dot: dot * 0.5 });
  g.shadowBlur = 0;
}
