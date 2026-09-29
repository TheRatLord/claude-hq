// [FX fix m175-r1] Collapsed label dots must always carry their glyph (never a blank paper disc).
// There is no DOM canvas under node --test, so this uses a tiny point-sampling 2D context: it replays the painter's
// paths (transforms, arcs, curves, rects) and keeps the colour of one sample pixel, which is exactly what a canvas
// would show there (last fill / stroke covering the point wins; alpha is always 1 in these painters).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawDot, ICON_OF, DOT_TILE } from './draw.ts';
import { CORE, STATUS } from '../../../shared/palette.ts';

type Pt = [number, number];
type Mat = [number, number, number, number, number, number];

function samplerCtx(px: number, py: number) {
  let m: Mat = [1, 0, 0, 1, 0, 0];
  const stack: [Mat, string, string, number][] = [];
  let subs: Pt[][] = [];
  let cur: Pt[] | null = null;
  const st = { fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1, globalAlpha: 1 };
  let colour: string | null = null;
  const T = (x: number, y: number): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const scaleOf = () => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  const add = (x: number, y: number) => { const p = T(x, y); if (!cur) { cur = [p]; subs.push(cur); } else cur.push(p); };
  let last: Pt = [0, 0];
  const ctx = {
    ...st,
    save() { stack.push([[...m], ctx.fillStyle, ctx.strokeStyle, ctx.lineWidth]); },
    restore() { const s = stack.pop(); if (s) [m, ctx.fillStyle, ctx.strokeStyle, ctx.lineWidth] = s; },
    translate(x: number, y: number) { m[4] += m[0] * x + m[2] * y; m[5] += m[1] * x + m[3] * y; },
    scale(a: number, b: number) { m[0] *= a; m[1] *= a; m[2] *= b; m[3] *= b; },
    rotate(r: number) { const c = Math.cos(r), s = Math.sin(r); m = [m[0] * c + m[2] * s, m[1] * c + m[3] * s, m[2] * c - m[0] * s, m[3] * c - m[1] * s, m[4], m[5]]; },
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number) { m = [a, b, c, d, e, f]; },
    beginPath() { subs = []; cur = null; },
    moveTo(x: number, y: number) { cur = null; add(x, y); last = [x, y]; },
    lineTo(x: number, y: number) { add(x, y); last = [x, y]; },
    closePath() { if (cur && cur.length) cur.push(cur[0]); cur = null; },
    arcTo(x1: number, y1: number) { add(x1, y1); last = [x1, y1]; },
    quadraticCurveTo(cx: number, cy: number, x: number, y: number) { const [x0, y0] = last; for (let i = 1; i <= 12; i++) { const t = i / 12, u = 1 - t; add(u * u * x0 + 2 * u * t * cx + t * t * x, u * u * y0 + 2 * u * t * cy + t * t * y); } last = [x, y]; },
    bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) { const [x0, y0] = last; for (let i = 1; i <= 16; i++) { const t = i / 16, u = 1 - t; add(u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x, u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y); } last = [x, y]; },
    ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number) { const n = 48, sp = a1 - a0; for (let i = 0; i <= n; i++) { const a = a0 + (sp * i) / n, ex = Math.cos(a) * rx, ey = Math.sin(a) * ry; const c = Math.cos(rot), s = Math.sin(rot); add(x + ex * c - ey * s, y + ex * s + ey * c); } last = [x + Math.cos(a1) * rx, y + Math.sin(a1) * ry]; },
    arc(x: number, y: number, r: number, a0: number, a1: number) { let sp = a1 - a0; if (sp < 0) sp += Math.PI * 2; ctx.ellipse(x, y, r, r, 0, a0, a0 + sp); },
    rect(x: number, y: number, w: number, h: number) { const p0 = T(x, y); subs.push([p0, T(x + w, y), T(x + w, y + h), T(x, y + h), p0]); cur = null; },
    fill() { if (inside()) colour = ctx.fillStyle; },
    stroke() { if (nearStroke(ctx.lineWidth * scaleOf() / 2)) colour = ctx.strokeStyle; },
    fillRect(x: number, y: number, w: number, h: number) { const a = T(x, y), b = T(x + w, y + h); if (px >= Math.min(a[0], b[0]) && px <= Math.max(a[0], b[0]) && py >= Math.min(a[1], b[1]) && py <= Math.max(a[1], b[1])) colour = ctx.fillStyle; },
    fillText() {}, strokeText() {}, measureText: (s: string) => ({ width: String(s).length * 10 }),
    get colour() { return colour; },
  };
  function inside() { // non-zero winding over all subpaths (implicitly closed)
    let w = 0;
    for (const s of subs) for (let i = 0; i < s.length; i++) {
      const [x0, y0] = s[i], [x1, y1] = s[(i + 1) % s.length];
      if (y0 <= py) { if (y1 > py && (x1 - x0) * (py - y0) - (px - x0) * (y1 - y0) > 0) w++; } else if (y1 <= py && (x1 - x0) * (py - y0) - (px - x0) * (y1 - y0) < 0) w--;
    }
    return w !== 0;
  }
  function nearStroke(hw: number) {
    for (const s of subs) for (let i = 0; i + 1 < s.length; i++) {
      const [x0, y0] = s[i], [x1, y1] = s[i + 1], dx = x1 - x0, dy = y1 - y0, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / L)) : 0;
      if (Math.hypot(px - x0 - t * dx, py - y0 - t * dy) <= hw) return true;
    }
    return false;
  }
  return ctx;
}

const centre = (icon: string, hex: string) => {
  const W = DOT_TILE.w, g = samplerCtx(W / 2 + 0.5, W / 2 + 0.5);
  // the sampler implements just the 2D-context surface the painters use
  drawDot(g as unknown as CanvasRenderingContext2D, icon, hex, W);
  return g.colour;
};

test('[FX fix m175-r1] the collapsed alert dot shows its "!" glyph: centre pixel is ink, not paper', () => {
  const c = centre('!', STATUS.blocked);
  assert.ok(c, 'something covers the centre');
  assert.notEqual(c.toLowerCase(), CORE.paper.toLowerCase(), 'the centre is not paper (was a blank white disc)');
  assert.equal(c.toLowerCase(), CORE.ink.toLowerCase());
});

test('[FX fix m175-r1] every activity dot carries a visible icon on a tinted disc: centre pixel never paper', () => {
  for (const icon of [...Object.keys(ICON_OF), 'dots', 'unknown-tool']) {
    for (const hex of [STATUS.working, STATUS.idle ?? STATUS.working, STATUS.unknown ?? STATUS.working]) {
      const c = centre(icon, hex);
      assert.ok(c, `${icon}: centre painted`);
      assert.notEqual(String(c).toLowerCase(), CORE.paper.toLowerCase(), `${icon} @ ${hex}: centre pixel is paper`);
    }
  }
});
