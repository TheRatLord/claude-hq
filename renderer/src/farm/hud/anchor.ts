/**
 * Pure maths for the anchored overlays (speech bubbles, nameplates, the interaction tag): text paging, screen-edge
 * clamping for off-screen speakers, and nudging stacks apart. No DOM, no three; tested in anchor.test.ts.
 */

/** Characters per bubble page (≈ 4 lines at the bubble's max width). */
export const PAGE_CHARS = 150;

/**
 * Split a long line into pages of at most `max` characters, breaking after a sentence when one ends late enough,
 * else between words (never mid-word, unless a single word is longer than a page). Short text is one page.
 */
export function pageText(text: string, max = PAGE_CHARS): string[] {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return [t];
  const out: string[] = [];
  let rest = t;
  while (rest.length > max) {
    const head = rest.slice(0, max + 1);
    let cut = -1;
    // the last sentence end in the back half of the page
    for (let i = head.length - 1; i >= max * 0.45; i--) if (/[.!?…]/.test(head[i]) && (head[i + 1] === ' ' || i + 1 === head.length)) { cut = i + 1; break; }
    if (cut < 0) cut = head.lastIndexOf(' ');
    if (cut <= 0) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  // a tiny tail reads badly on its own page: fold it back when it fits
  if (out.length > 1 && out[out.length - 1].length < 24 && out[out.length - 2].length + out[out.length - 1].length < max * 1.15) {
    const tail = out.pop()!;
    out[out.length - 1] += ` ${tail}`;
  }
  return out;
}

/** How long one page stays up (ms): reading time with a floor and a ceiling. */
export const pageMs = (page: string): number => Math.min(6500, Math.max(2400, 900 + page.length * 48));

export interface EdgePoint { x: number; y: number; /** radians, screen space (y down): direction from the point toward the target */ angle: number }

/**
 * Clamp an off-screen (or behind-camera) target to the screen edge. `sx, sy` are the target's projected css px (for a
 * point behind the camera pass the mirrored projection and `behind = true`). The result sits inside the rect
 * [m, w - m] × [m, h - m] on the ray from the screen centre toward the target.
 */
export function edgeClamp(sx: number, sy: number, behind: boolean, w: number, h: number, m: number, out: EdgePoint): EdgePoint {
  const cx = w / 2, cy = h / 2;
  let dx = sx - cx, dy = sy - cy;
  if (behind) { dx = -dx; dy = -dy; if (Math.abs(dy) < 1e-3 && Math.abs(dx) < 1e-3) dy = 1; }
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) dx = 1;
  const hx = Math.max(1, cx - m), hy = Math.max(1, cy - m);
  const k = Math.min(hx / Math.max(1e-6, Math.abs(dx)), hy / Math.max(1e-6, Math.abs(dy)));
  out.x = cx + dx * k;
  out.y = cy + dy * k;
  out.angle = Math.atan2(dy, dx);
  return out;
}

/**
 * Rectangles placed so far this frame, flat [x, y, w, h, …] (reused; `n` = count). `nudgeUp` moves a candidate up
 * (smaller y) until it overlaps none of them, at most `maxShift` px; returns the new y, or NaN when it cannot fit.
 */
export interface Placed { r: Float64Array; n: number }
export const placed = (cap = 64): Placed => ({ r: new Float64Array(cap * 4), n: 0 });

export function nudgeUp(p: Placed, x: number, y: number, w: number, h: number, gap: number, maxShift: number): number {
  const y0 = y;
  for (let pass = 0; pass < 12; pass++) {
    let moved = false;
    for (let i = 0; i < p.n; i++) {
      const rx = p.r[i * 4], ry = p.r[i * 4 + 1], rw = p.r[i * 4 + 2], rh = p.r[i * 4 + 3];
      if (x < rx + rw + gap && x + w + gap > rx && y < ry + rh + gap && y + h + gap > ry) { y = ry - h - gap; moved = true; }
    }
    if (!moved) return y0 - y > maxShift ? Number.NaN : y;
  }
  return Number.NaN;
}

export function addPlaced(p: Placed, x: number, y: number, w: number, h: number): void {
  if ((p.n + 1) * 4 > p.r.length) return;
  p.r[p.n * 4] = x; p.r[p.n * 4 + 1] = y; p.r[p.n * 4 + 2] = w; p.r[p.n * 4 + 3] = h;
  p.n++;
}

/** Tags shrink a little with distance (never below 3/4) so far-off chatter reads as far off. */
export const distScale = (d: number): number => Math.min(1, Math.max(0.74, 1 - (d - 7) / 40));

const QX = new Float64Array(512), QY = new Float64Array(512), QD = new Uint8Array(512);
/**
 * Find the nearest spot for a w × h box wanted at (x, y) that overlaps nothing in `p` and stays inside the screen
 * (W × H, `m` margin): a small breadth-first search that steps the box past whatever it hits (up, sideways, then
 * down; up is cheapest). Writes `out` and returns true, or false when nothing within `maxMove` px fits.
 * Allocation-free.
 */
export function placeRect(p: Placed, x: number, y: number, w: number, h: number, gap: number, W: number, H: number, m: number, maxMove: number,
  out: { x: number; y: number }): boolean {
  // the wanted spot clamped onto the screen is the root
  const x0 = Math.min(W - m - w, Math.max(m, x)), y0 = Math.min(H - m - h, Math.max(m, y));
  let head = 0, tail = 0, best = Infinity;
  QX[tail] = x0; QY[tail] = y0; QD[tail] = 0; tail++;
  while (head < tail) {
    const cx = QX[head], cy = QY[head], depth = QD[head]; head++;
    if (cx < m - 0.5 || cx + w > W - m + 0.5 || cy < m - 0.5 || cy + h > H - m + 0.5) continue;
    const dx = cx - x, dy = cy - y;
    const cost = Math.abs(dx) + (dy < 0 ? -dy : dy * 1.4);
    if (cost >= best || cost > maxMove) continue;
    let hit = -1;
    for (let i = 0; i < p.n; i++) {
      const rx = p.r[i * 4], ry = p.r[i * 4 + 1], rw = p.r[i * 4 + 2], rh = p.r[i * 4 + 3];
      if (cx < rx + rw + gap && cx + w + gap > rx && cy < ry + rh + gap && cy + h + gap > ry) { hit = i; break; }
    }
    if (hit < 0) { best = cost; out.x = cx; out.y = cy; continue; }
    if (depth >= 4 || tail + 4 > QX.length) continue;
    const rx = p.r[hit * 4], ry = p.r[hit * 4 + 1], rw = p.r[hit * 4 + 2], rh = p.r[hit * 4 + 3];
    QX[tail] = cx; QY[tail] = ry - h - gap; QD[tail++] = depth + 1;
    QX[tail] = rx + rw + gap; QY[tail] = cy; QD[tail++] = depth + 1;
    QX[tail] = rx - w - gap; QY[tail] = cy; QD[tail++] = depth + 1;
    QX[tail] = cx; QY[tail] = ry + rh + gap; QD[tail++] = depth + 1;
  }
  return best < Infinity;
}
