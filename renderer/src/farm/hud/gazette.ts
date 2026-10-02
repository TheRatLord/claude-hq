/**
 * The Valley Gazette (G, the noticeboard's "Read today's paper", or a Gazette letter's "Read the paper"): a newspaper
 * page in a panel. Masthead with a hand-drawn canvas logo, the dateline, the lead story, columns of stories with
 * little canvas engravings, the harvest in numbers, a pull quote, the week's weather and Nimbus's forecast, gossip
 * from over the garden fence, classifieds and the Mayor's editorial. The paper itself is composed in model/gazette.ts
 * (only real facts); this module only prints it.
 *
 * `open('gazette')` shows today's morning edition; `open('gazette', { from: 'YYYY-MM-DD' })` a back issue by the first
 * day it covers, `{ index: n }` the n-th newest back issue, `'latest'` the newest. ← / → step through the editions.
 */
import './gazette.css';
import { hash32, mulberry32 } from '../../../../shared/identity.ts';
import type { Art, Issue, Story } from '../model/gazette.ts';
import { WEATHER_WORD } from '../model/gazette.ts';
import type { IssueRec } from '../model/gazette.ts';
import type { WeatherKind } from '../model/types.ts';
import { stampDef } from '../model/stamps.ts';
import { dayKey } from '../model/almanac.ts';
import { LETTER_ICON } from './icons.ts';
import { stampIconHtml } from './stamps.ts';
import { framePanel, h, typingIn, type HudCtx, type Panel } from './ctx.ts';

/** What the panel reads (farm/newsroom.ts implements it). */
export interface GazetteView {
  readonly version: number;
  today(): Issue;
  issues(): readonly IssueRec[];
  issue(rec: IssueRec): Issue;
}

const INK = '#2b2017';
const INK_SOFT = 'rgba(43,32,23,.55)';
const PAPER = '#f6efdc';

// ---------------------------------------------------------------------------------------------
// ink drawing helpers

type G = CanvasRenderingContext2D;
type Rnd = () => number;

function canvas(w: number, hgt: number, draw: (g: G, r: Rnd) => void, seed: string, cls = 'gz-cv'): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  cv.width = Math.round(w * dpr); cv.height = Math.round(hgt * dpr);
  cv.className = cls;
  cv.style.aspectRatio = `${w} / ${hgt}`;
  cv.setAttribute('aria-hidden', 'true');
  const g = cv.getContext('2d');
  if (g) {
    g.scale(dpr, dpr);
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = INK; g.fillStyle = INK; g.lineWidth = 1.5;
    try { draw(g, mulberry32(hash32(seed))); } catch (err) { console.warn('[gazette] drawing failed', err); }
  }
  return cv;
}

/** a hand-drawn line through points (a little wobble per segment) */
function ink(g: G, r: Rnd, pts: [number, number][], w = 1.5, j = 0.7): void {
  if (pts.length < 2) return;
  g.lineWidth = w;
  g.beginPath();
  g.moveTo(pts[0][0] + (r() - 0.5) * j, pts[0][1] + (r() - 0.5) * j);
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const mx = (x0 + x1) / 2 + (r() - 0.5) * j * 2, my = (y0 + y1) / 2 + (r() - 0.5) * j * 2;
    g.quadraticCurveTo(mx, my, x1 + (r() - 0.5) * j, y1 + (r() - 0.5) * j);
  }
  g.stroke();
}
/** parallel hatching inside the current path (clipped) */
function hatch(g: G, r: Rnd, path: () => void, x: number, y: number, w: number, hgt: number, gap = 3.2, ang = -0.8, lw = 0.8): void {
  g.save();
  g.beginPath(); path(); g.clip();
  g.lineWidth = lw; g.strokeStyle = INK_SOFT;
  const d = w + hgt;
  const c = Math.cos(ang), s = Math.sin(ang);
  for (let t = -d; t < d; t += gap) {
    const cx = x + w / 2 + -s * t, cy = y + hgt / 2 + c * t;
    g.beginPath();
    g.moveTo(cx - c * d + (r() - 0.5), cy - s * d);
    g.lineTo(cx + c * d, cy + s * d + (r() - 0.5));
    g.stroke();
  }
  g.restore();
}
const circle = (g: G, x: number, y: number, rad: number) => g.arc(x, y, rad, 0, Math.PI * 2);
function wobblyCircle(g: G, r: Rnd, x: number, y: number, rad: number, w = 1.5): void {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI * 2; pts.push([x + Math.cos(a) * rad, y + Math.sin(a) * rad]); }
  ink(g, r, pts, w, 0.5);
}
function hills(g: G, r: Rnd, w: number, base: number, amp: number, x0 = 0): void {
  const pts: [number, number][] = [];
  for (let x = x0; x <= x0 + w; x += 6) pts.push([x, base - Math.sin((x - x0) / w * Math.PI * 1.6 + 0.4) * amp - Math.sin((x - x0) / 9) * 1.2]);
  ink(g, r, pts, 1.6, 0.4);
  hatch(g, r, () => { g.moveTo(pts[0][0], pts[0][1]); for (const p of pts) g.lineTo(p[0], p[1]); g.lineTo(x0 + w, base + 40); g.lineTo(x0, base + 40); g.closePath(); }, x0, base - amp - 4, w, 50, 3.4);
}
function sunGlyph(g: G, r: Rnd, x: number, y: number, rad: number): void {
  wobblyCircle(g, r, x, y, rad);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.2;
    ink(g, r, [[x + Math.cos(a) * (rad + 3), y + Math.sin(a) * (rad + 3)], [x + Math.cos(a) * (rad + 3 + (i % 2 ? 4 : 7)), y + Math.sin(a) * (rad + 3 + (i % 2 ? 4 : 7))]], 1.3);
  }
}
function cloudGlyph(g: G, r: Rnd, x: number, y: number, s: number, fill = true): void {
  const path = () => {
    g.moveTo(x - 1.6 * s, y + 0.6 * s);
    g.arc(x - 1.0 * s, y, 0.7 * s, Math.PI * 0.75, Math.PI * 1.6);
    g.arc(x, y - 0.4 * s, 0.95 * s, Math.PI * 1.1, Math.PI * 1.95);
    g.arc(x + 1.05 * s, y + 0.05 * s, 0.65 * s, Math.PI * 1.4, Math.PI * 0.3);
    g.lineTo(x - 1.6 * s, y + 0.6 * s);
  };
  if (fill) { g.save(); g.fillStyle = PAPER; g.beginPath(); path(); g.fill(); g.restore(); }
  g.lineWidth = 1.5; g.beginPath(); path(); g.stroke();
  hatch(g, r, path, x - 2 * s, y - 1.5 * s, 4 * s, 2.4 * s, 3, 0.9, 0.7);
}
/** a weather glyph in ink, centred at (x, y), about 2.2·s wide */
function weatherGlyph(g: G, r: Rnd, k: WeatherKind, x: number, y: number, s: number): void {
  switch (k) {
    case 'clear': sunGlyph(g, r, x, y, s * 0.75); break;
    case 'cloudy': sunGlyph(g, r, x + s * 0.7, y - s * 0.5, s * 0.45); cloudGlyph(g, r, x - s * 0.15, y + s * 0.2, s * 0.75); break;
    case 'rain': case 'storm':
      cloudGlyph(g, r, x, y - s * 0.35, s * 0.8);
      if (k === 'storm') { g.beginPath(); g.moveTo(x + s * 0.1, y + s * 0.2); g.lineTo(x - s * 0.25, y + s * 0.75); g.lineTo(x + s * 0.05, y + s * 0.75); g.lineTo(x - s * 0.3, y + s * 1.3); g.lineTo(x + s * 0.4, y + s * 0.6); g.lineTo(x + s * 0.1, y + s * 0.6); g.lineTo(x + s * 0.4, y + s * 0.2); g.closePath(); g.fill(); }
      for (let i = -1; i <= 1; i++) { if (k === 'storm' && i === 0) continue; ink(g, r, [[x + i * s * 0.6, y + s * 0.35], [x + i * s * 0.6 - s * 0.25, y + s * 0.95]], 1.3); }
      break;
    case 'snow':
      cloudGlyph(g, r, x, y - s * 0.35, s * 0.8);
      for (const [dx, dy] of [[-0.6, 0.6], [0.1, 0.95], [0.7, 0.55]] as const) {
        const cx = x + dx * s, cy = y + dy * s, a = s * 0.2;
        for (let i = 0; i < 3; i++) { const t = (i / 3) * Math.PI; ink(g, r, [[cx - Math.cos(t) * a, cy - Math.sin(t) * a], [cx + Math.cos(t) * a, cy + Math.sin(t) * a]], 1.1, 0.2); }
      }
      break;
    case 'fog':
      for (let i = 0; i < 4; i++) {
        const yy = y - s * 0.6 + i * s * 0.42, pts: [number, number][] = [];
        for (let t = 0; t <= 8; t++) pts.push([x - s + (t / 8) * 2 * s + (i % 2) * s * 0.15, yy + Math.sin(t * 1.4 + i) * s * 0.07]);
        ink(g, r, pts, 1.3, 0.3);
      }
      break;
  }
}

/** the story engravings, drawn in a w×h box */
function drawArt(g: G, r: Rnd, art: Art, w: number, hgt: number): void {
  const cx = w / 2, cy = hgt / 2;
  switch (art) {
    case 'crates': {
      const box = (x: number, y: number, s: number) => {
        const path = () => g.rect(x, y, s, s);
        g.save(); g.fillStyle = PAPER; g.beginPath(); path(); g.fill(); g.restore();
        ink(g, r, [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]], 1.7);
        for (let i = 1; i < 3; i++) ink(g, r, [[x, y + (s * i) / 3], [x + s, y + (s * i) / 3]], 1);
        ink(g, r, [[x + 3, y + 3], [x + s - 3, y + s - 3]], 1.2);
        hatch(g, r, path, x, y, s, s, 4, 0.2, 0.6);
      };
      const s = Math.min(w, hgt) * 0.36;
      ink(g, r, [[6, hgt - 8], [w - 6, hgt - 8]], 1.2);
      box(cx - s - 2, hgt - 8 - s, s); box(cx + 2, hgt - 8 - s, s); box(cx - s / 2, hgt - 10 - 2 * s, s);
      break;
    }
    case 'rosette': case 'star': {
      if (art === 'rosette') {
        for (const sx of [-1, 1]) {
          const path = () => { g.moveTo(cx + sx * 6, cy + 8); g.lineTo(cx + sx * 20, cy + 40); g.lineTo(cx + sx * 12, cy + 35); g.lineTo(cx + sx * 9, cy + 43); g.lineTo(cx - sx * 2, cy + 10); g.closePath(); };
          g.save(); g.fillStyle = PAPER; g.beginPath(); path(); g.fill(); g.restore();
          g.lineWidth = 1.5; g.beginPath(); path(); g.stroke();
          hatch(g, r, path, cx - 24, cy, 48, 46, 2.6, sx * 0.9, 0.7);
        }
        const R = Math.min(w, hgt) * 0.3;
        g.save(); g.fillStyle = PAPER; g.beginPath(); circle(g, cx, cy - 4, R + 4); g.fill(); g.restore();
        const pts: [number, number][] = [];
        for (let i = 0; i <= 32; i++) { const a = (i / 32) * Math.PI * 2; const rr = R + (i % 2 ? 4 : 0); pts.push([cx + Math.cos(a) * rr, cy - 4 + Math.sin(a) * rr]); }
        ink(g, r, pts, 1.4, 0.3);
        wobblyCircle(g, r, cx, cy - 4, R * 0.62);
        g.font = `700 ${Math.round(R * 0.7)}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('★', cx, cy - 3);
      } else {
        const R = Math.min(w, hgt) * 0.36, pts: [number, number][] = [];
        for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + (i / 10) * Math.PI * 2; const rr = i % 2 ? R * 0.45 : R; pts.push([cx + Math.cos(a) * rr, cy + 3 + Math.sin(a) * rr]); }
        ink(g, r, pts, 1.8, 0.4);
        hatch(g, r, () => { g.moveTo(pts[0][0], pts[0][1]); for (const p of pts) g.lineTo(p[0], p[1]); g.closePath(); }, cx - R, cy - R, 2 * R, 2 * R, 3, -0.6, 0.7);
        for (const [x, y, s] of [[cx - R - 8, cy - R + 4, 5], [cx + R + 6, cy - 6, 4], [cx + R - 2, cy + R, 3]] as const) {
          ink(g, r, [[x - s, y], [x + s, y]], 1.2, 0.2); ink(g, r, [[x, y - s], [x, y + s]], 1.2, 0.2);
        }
      }
      break;
    }
    case 'sun': hills(g, r, w, hgt - 12, 10); sunGlyph(g, r, cx, cy - 6, Math.min(w, hgt) * 0.18); break;
    case 'rain': weatherGlyph(g, r, 'rain', cx, cy, Math.min(w, hgt) * 0.36); break;
    case 'snow': weatherGlyph(g, r, 'snow', cx, cy, Math.min(w, hgt) * 0.36); break;
    case 'moon': {
      const R = Math.min(w, hgt) * 0.26;
      const path = () => { g.arc(cx, cy - 4, R, 0, Math.PI * 2); };
      g.save(); g.beginPath(); path(); g.clip();
      g.fillStyle = INK; g.beginPath(); circle(g, cx, cy - 4, R); g.fill();
      g.globalCompositeOperation = 'destination-out'; g.beginPath(); circle(g, cx + R * 0.45, cy - 4 - R * 0.25, R * 0.9); g.fill();
      g.restore();
      for (const [x, y] of [[cx - R * 1.8, cy - R], [cx + R * 1.5, cy - R * 1.2], [cx + R * 1.9, cy + R * 0.3], [cx - R * 1.4, cy + R * 0.6]] as const) {
        ink(g, r, [[x - 3, y], [x + 3, y]], 1.1, 0.1); ink(g, r, [[x, y - 3], [x, y + 3]], 1.1, 0.1);
      }
      hills(g, r, w, hgt - 8, 6);
      break;
    }
    case 'fish': {
      const L = w * 0.62, H = hgt * 0.3, x0 = cx - L / 2 - 6, y0 = cy - 2;
      const body = () => { g.moveTo(x0, y0); g.quadraticCurveTo(x0 + L * 0.45, y0 - H * 1.25, x0 + L, y0); g.quadraticCurveTo(x0 + L * 0.45, y0 + H * 1.25, x0, y0); };
      const tail = () => { g.moveTo(x0 + L - 2, y0); g.lineTo(x0 + L + 16, y0 - H * 0.8); g.quadraticCurveTo(x0 + L + 10, y0, x0 + L + 16, y0 + H * 0.8); g.closePath(); };
      g.lineWidth = 1.7; g.beginPath(); body(); g.stroke(); g.beginPath(); tail(); g.stroke();
      hatch(g, r, tail, x0 + L, y0 - H, 20, 2 * H, 2.4, 0.2, 0.7);
      for (let i = 0; i < 4; i++) for (let j = -1; j <= 1; j++) { const sx = x0 + L * (0.35 + i * 0.13), sy = y0 + j * H * 0.45; g.lineWidth = 0.8; g.beginPath(); g.arc(sx, sy, 4, -Math.PI / 2.4, Math.PI / 2.4); g.stroke(); }
      g.beginPath(); circle(g, x0 + L * 0.14, y0 - H * 0.2, 2.4); g.fill();
      ink(g, r, [[x0 + L * 0.26, y0 - H * 0.6], [x0 + L * 0.3, y0], [x0 + L * 0.26, y0 + H * 0.55]], 1.1);
      for (let i = 0; i < 3; i++) { const yy = hgt - 14 + i * 4, pts: [number, number][] = []; for (let t = 0; t <= 10; t++) pts.push([10 + t * (w - 20) / 10, yy + Math.sin(t * 1.3 + i * 2) * 1.6]); ink(g, r, pts, 0.9, 0.2); }
      break;
    }
    case 'farmer': {
      // a little Clawd farmer in a straw hat with a hoe
      const s = Math.min(w, hgt) / 90;
      const bx = cx - 4 * s, by = hgt - 14;
      ink(g, r, [[8, by + 2], [w - 8, by + 2]], 1.1);
      for (let i = 0; i < 6; i++) ink(g, r, [[14 + i * (w - 28) / 5, by + 2], [14 + i * (w - 28) / 5 - 3, by - 4]], 1, 0.3);
      const body = () => { g.roundRect(bx - 18 * s, by - 46 * s, 36 * s, 34 * s, 8 * s); };
      g.save(); g.fillStyle = PAPER; g.beginPath(); body(); g.fill(); g.restore();
      g.lineWidth = 1.8; g.beginPath(); body(); g.stroke();
      hatch(g, r, body, bx - 18 * s, by - 46 * s, 36 * s, 34 * s, 3.4, -0.7, 0.6);
      for (const lx of [-11, -3, 5, 13]) ink(g, r, [[bx + lx * s, by - 12 * s], [bx + lx * s, by]], 1.8, 0.2);
      g.save(); g.fillStyle = PAPER; g.fillRect(bx - 10 * s, by - 38 * s, 20 * s, 9 * s); g.restore();
      g.beginPath(); g.rect(bx - 9 * s, by - 37 * s, 4 * s, 6 * s); g.rect(bx + 5 * s, by - 37 * s, 4 * s, 6 * s); g.fill();
      // hat
      g.save(); g.fillStyle = PAPER; g.beginPath(); g.ellipse(bx, by - 47 * s, 30 * s, 6 * s, 0, 0, Math.PI * 2); g.fill(); g.restore();
      g.lineWidth = 1.5; g.beginPath(); g.ellipse(bx, by - 47 * s, 30 * s, 6 * s, 0, 0, Math.PI * 2); g.stroke();
      const crown = () => { g.moveTo(bx - 15 * s, by - 48 * s); g.quadraticCurveTo(bx - 14 * s, by - 66 * s, bx, by - 65 * s); g.quadraticCurveTo(bx + 14 * s, by - 66 * s, bx + 15 * s, by - 48 * s); g.closePath(); };
      g.save(); g.fillStyle = PAPER; g.beginPath(); crown(); g.fill(); g.restore();
      g.beginPath(); crown(); g.stroke();
      hatch(g, r, crown, bx - 16 * s, by - 67 * s, 32 * s, 20 * s, 2.6, 0.3, 0.6);
      ink(g, r, [[bx - 15 * s, by - 51 * s], [bx + 15 * s, by - 51 * s]], 2.2, 0.2);
      // hoe
      ink(g, r, [[bx + 22 * s, by - 30 * s], [bx + 34 * s, by - 74 * s]], 1.8, 0.3);
      ink(g, r, [[bx + 34 * s, by - 74 * s], [bx + 42 * s, by - 70 * s], [bx + 41 * s, by - 63 * s]], 1.8, 0.3);
      ink(g, r, [[bx + 18 * s, by - 28 * s], [bx + 24 * s, by - 32 * s]], 2.4, 0.2);
      break;
    }
    case 'field': {
      sunGlyph(g, r, w * 0.78, hgt * 0.22, Math.min(w, hgt) * 0.09);
      const hz = hgt * 0.42;
      ink(g, r, [[4, hz], [w - 4, hz]], 1.3);
      for (let i = -5; i <= 5; i++) ink(g, r, [[cx + i * 5, hz], [cx + i * w * 0.16, hgt - 4]], 1, 0.4);
      for (let row = 0; row < 4; row++) {
        const t = (row + 1) / 5, y = hz + (hgt - 4 - hz) * t * t + 4;
        for (let i = -5; i <= 4; i++) {
          const x = cx + (i + 0.5) * (5 + (w * 0.16 - 5) * ((y - hz) / (hgt - 4 - hz)));
          const sz = 2 + 4 * t;
          ink(g, r, [[x, y], [x, y - sz]], 1, 0.2);
          ink(g, r, [[x, y - sz * 0.6], [x - sz * 0.6, y - sz]], 0.9, 0.2); ink(g, r, [[x, y - sz * 0.6], [x + sz * 0.6, y - sz]], 0.9, 0.2);
        }
      }
      break;
    }
    case 'heart': case 'stamp': {
      const s = Math.min(w, hgt) * 0.34;
      const path = () => { g.moveTo(cx, cy + s * 0.95); g.bezierCurveTo(cx - s * 1.5, cy - s * 0.1, cx - s * 0.75, cy - s * 1.2, cx, cy - s * 0.45); g.bezierCurveTo(cx + s * 0.75, cy - s * 1.2, cx + s * 1.5, cy - s * 0.1, cx, cy + s * 0.95); };
      g.lineWidth = 1.8; g.beginPath(); path(); g.stroke();
      hatch(g, r, path, cx - s * 1.5, cy - s * 1.2, s * 3, s * 2.2, 2.6, -0.8, 0.7);
      break;
    }
    case 'lantern': {
      ink(g, r, [[6, 10], [cx, 18], [w - 6, 10]], 1.1);
      const x = cx, y = 20, lw = Math.min(w, hgt) * 0.24, lh = hgt * 0.5;
      ink(g, r, [[x, y - 2], [x, y + 4]], 1.4);
      const body = () => { g.ellipse(x, y + 4 + lh / 2, lw, lh / 2, 0, 0, Math.PI * 2); };
      g.save(); g.fillStyle = PAPER; g.beginPath(); body(); g.fill(); g.restore();
      g.lineWidth = 1.6; g.beginPath(); body(); g.stroke();
      for (let i = -2; i <= 2; i++) { g.lineWidth = 0.9; g.beginPath(); g.ellipse(x, y + 4 + lh / 2, Math.abs(i) * lw * 0.38 + 0.5, lh / 2, 0, 0, Math.PI * 2); g.stroke(); }
      g.fillRect(x - lw * 0.45, y + 2, lw * 0.9, 4); g.fillRect(x - lw * 0.45, y + 4 + lh - 2, lw * 0.9, 4);
      ink(g, r, [[x - 3, y + lh + 8], [x - 4, y + lh + 18]], 1); ink(g, r, [[x + 3, y + lh + 8], [x + 4, y + lh + 18]], 1);
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; ink(g, r, [[x + Math.cos(a) * (lw + 6), y + 4 + lh / 2 + Math.sin(a) * (lh / 2 + 6)], [x + Math.cos(a) * (lw + 10), y + 4 + lh / 2 + Math.sin(a) * (lh / 2 + 10)]], 1, 0.2); }
      break;
    }
    case 'pumpkin': {
      const R = Math.min(w, hgt) * 0.3, y = cy + 6;
      for (const [dx, rx] of [[-R * 0.55, R * 0.6], [R * 0.55, R * 0.6], [0, R * 0.62]] as const) {
        const path = () => g.ellipse(cx + dx, y, rx, R * 0.8, 0, 0, Math.PI * 2);
        g.save(); g.fillStyle = PAPER; g.beginPath(); path(); g.fill(); g.restore();
        g.lineWidth = 1.6; g.beginPath(); path(); g.stroke();
        hatch(g, r, path, cx + dx - rx, y - R, rx * 2, R * 2, 3.2, dx < 0 ? 1.2 : dx > 0 ? -1.2 : 1.57, 0.6);
      }
      ink(g, r, [[cx, y - R * 0.75], [cx + 3, y - R * 1.15], [cx + 9, y - R * 1.25]], 2.6, 0.3);
      ink(g, r, [[cx + 3, y - R * 1.0], [cx + 14, y - R * 1.05], [cx + 18, y - R * 0.85]], 1.1, 0.3);
      ink(g, r, [[8, y + R * 0.8], [w - 8, y + R * 0.8]], 1.1);
      break;
    }
    case 'quill': {
      // an inkpot and a feather quill
      const px = cx - 10, py = hgt - 12;
      const pot = () => { g.moveTo(px - 16, py); g.lineTo(px - 13, py - 20); g.lineTo(px - 7, py - 24); g.lineTo(px + 7, py - 24); g.lineTo(px + 13, py - 20); g.lineTo(px + 16, py); g.closePath(); };
      g.save(); g.fillStyle = PAPER; g.beginPath(); pot(); g.fill(); g.restore();
      g.lineWidth = 1.6; g.beginPath(); pot(); g.stroke();
      hatch(g, r, pot, px - 16, py - 26, 32, 26, 2.4, -0.9, 0.7);
      g.fillRect(px - 8, py - 28, 16, 4);
      const qx0 = px + 2, qy0 = py - 26, qx1 = cx + w * 0.34, qy1 = 8;
      ink(g, r, [[qx0, qy0], [qx1, qy1]], 1.4, 0.2);
      const vane = () => { g.moveTo(qx0 + (qx1 - qx0) * 0.25, qy0 + (qy1 - qy0) * 0.25); g.quadraticCurveTo(qx1 - 30, qy1 + 4, qx1, qy1); g.quadraticCurveTo(qx1 - 4, qy1 + 30, qx0 + (qx1 - qx0) * 0.3, qy0 + (qy1 - qy0) * 0.3); g.closePath(); };
      g.lineWidth = 1.3; g.beginPath(); vane(); g.stroke();
      hatch(g, r, vane, qx0, qy1, qx1 - qx0, qy0 - qy1, 2.2, 0.7, 0.6);
      break;
    }
  }
}

/** The masthead: the paper's name in heavy serif with two little vignettes (sunrise over the hills, the windmill). */
function masthead(no: number): HTMLCanvasElement {
  const W = 880, H = 94;
  return canvas(W, H, (g, r) => {
    // vignettes
    const vignette = (x: number, kind: 'sun' | 'mill') => {
      const R = 38, y = 52;
      g.save(); g.beginPath(); circle(g, x, y, R); g.clip();
      if (kind === 'sun') {
        sunGlyph(g, r, x, y + 4, 10);
        hills(g, r, 2 * R + 8, y + 18, 9, x - R - 4);
      } else {
        hills(g, r, 2 * R + 8, y + 22, 6, x - R - 4);
        // the windmill: a tapered tower, cap and four sails
        const tx = x + 4, ty = y + 18;
        const tower = () => { g.moveTo(tx - 9, ty); g.lineTo(tx - 5, ty - 30); g.lineTo(tx + 5, ty - 30); g.lineTo(tx + 9, ty); g.closePath(); };
        g.save(); g.fillStyle = PAPER; g.beginPath(); tower(); g.fill(); g.restore();
        g.lineWidth = 1.5; g.beginPath(); tower(); g.stroke();
        hatch(g, r, tower, tx - 10, ty - 32, 20, 32, 2.4, 1.2, 0.6);
        ink(g, r, [[tx - 7, ty - 30], [tx, ty - 37], [tx + 7, ty - 30]], 1.5, 0.2);
        for (let i = 0; i < 4; i++) {
          const a = 0.5 + (i * Math.PI) / 2, hx = tx, hy = ty - 31;
          const ex = hx + Math.cos(a) * 26, ey = hy + Math.sin(a) * 26;
          ink(g, r, [[hx, hy], [ex, ey]], 1.4, 0.2);
          const nx = -Math.sin(a) * 5, ny = Math.cos(a) * 5;
          g.lineWidth = 1; g.beginPath(); g.moveTo(hx + Math.cos(a) * 8, hy + Math.sin(a) * 8); g.lineTo(ex, ey); g.lineTo(ex + nx, ey + ny); g.lineTo(hx + Math.cos(a) * 8 + nx, hy + Math.sin(a) * 8 + ny); g.closePath(); g.stroke();
        }
        g.beginPath(); circle(g, tx, ty - 31, 2.2); g.fill();
        // birds
        for (const [bx, by] of [[x - 22, y - 18], [x - 12, y - 24]] as const) ink(g, r, [[bx - 4, by], [bx, by + 2], [bx + 4, by]], 1.1, 0.1);
      }
      g.restore();
      wobblyCircle(g, r, x, y, R, 1.8);
      wobblyCircle(g, r, x, y, R + 4, 0.9);
    };
    vignette(50, 'sun');
    vignette(W - 50, 'mill');
    // the name: heavy serif with a slight ink spread, "The" small above "Valley"
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    const title = 'The Valley Gazette';
    let size = 64;
    g.font = `700 ${size}px Georgia, "DejaVu Serif", "Times New Roman", serif`;
    while (g.measureText(title).width > W - 210 && size > 30) { size -= 2; g.font = `700 ${size}px Georgia, "DejaVu Serif", "Times New Roman", serif`; }
    g.fillStyle = INK;
    g.fillText(title, W / 2, 68);
    g.globalAlpha = 0.35; g.fillText(title, W / 2 + 0.7, 68.6); g.globalAlpha = 1;
    // an engraved hairline through the letters' thick strokes
    g.save(); g.globalCompositeOperation = 'source-atop'; g.strokeStyle = 'rgba(246,239,220,.55)'; g.lineWidth = 0.9;
    g.beginPath(); g.moveTo(130, 50); g.lineTo(W - 130, 50); g.stroke(); g.restore();
    // flourishes under the name: a rule with a leaf in the middle
    ink(g, r, [[150, 84], [W / 2 - 20, 84]], 1.3, 0.3);
    ink(g, r, [[W / 2 + 20, 84], [W - 150, 84]], 1.3, 0.3);
    const lf = (sx: number) => { g.beginPath(); g.moveTo(W / 2, 84); g.quadraticCurveTo(W / 2 + sx * 9, 77, W / 2 + sx * 18, 84); g.quadraticCurveTo(W / 2 + sx * 9, 91, W / 2, 84); g.fill(); };
    lf(-1); lf(1);
  }, `mast|${no}`, 'gz-mast-cv');
}

function signature(name: string): HTMLCanvasElement {
  return canvas(220, 46, (g, r) => {
    g.font = 'italic 600 26px "Brush Script MT", "Segoe Script", "URW Chancery L", Georgia, serif';
    g.textBaseline = 'alphabetic';
    g.fillText(name, 8, 30);
    const w = Math.min(206, g.measureText(name).width + 12);
    ink(g, r, [[6, 38], [w * 0.5, 41], [w, 35], [w - 12, 33]], 1.3, 0.6);
  }, `sig|${name}`, 'gz-sig');
}

// ---------------------------------------------------------------------------------------------
// the page

const ART_W = 132, ART_H = 100;

function storyEl(s: Story, lead = false): HTMLElement {
  const art = s.stamp && stampDef(s.stamp)
    ? h('figure.gz-art.gz-stamp', { html: stampIconHtml(stampDef(s.stamp)!, dayKey(Date.now())) })
    : s.art ? h('figure.gz-art', null, canvas(lead ? 190 : ART_W, lead ? 140 : ART_H, (g, r) => drawArt(g, r, s.art!, lead ? 190 : ART_W, lead ? 140 : ART_H), `${s.id}|${s.head}`)) : null;
  const paras = s.body.map((p) => h('p', { text: p }));
  return h(`article.gz-story${lead ? '.gz-lead' : ''}`, { 'data-testid': lead ? 'gz-lead' : 'gz-story', 'data-id': s.id },
    h('div.gz-kicker', { text: s.kicker }),
    h(lead ? 'h2.gz-head' : 'h3.gz-head', { text: s.head }),
    s.deck ? h('div.gz-deck', { text: s.deck }) : null,
    // the lead: its engraving beside two columns of text; a story: the engraving floated into the text
    lead ? h('div.gz-lead-body', null, h('div.gz-text', null, ...paras), art) : h('div.gz-text', null, art, ...paras));
}

function weatherBox(iss: Issue): HTMLElement {
  const days = iss.weather.days.map((d, i) => h('div.gz-wday', { title: WEATHER_WORD[d.weather] },
    canvas(34, 28, (g, r) => weatherGlyph(g, r, d.weather, 17, 15, 10), `wd|${iss.facts.from}|${i}|${d.weather}`),
    h('span', { text: d.label })));
  return h('section.gz-box.gz-weather', { 'data-testid': 'gz-weather' },
    h('h4', { text: iss.kind === 'weekly' ? 'The week\'s weather' : 'The last seven days' }),
    h('div.gz-wdays', null, ...days),
    h('p.gz-small', { text: iss.weather.line }));
}

function forecastBox(iss: Issue): HTMLElement {
  return h('section.gz-box.gz-forecast', { 'data-testid': 'gz-forecast' },
    h('h4', { text: 'Forecast' }),
    h('div.gz-by', { text: 'by Nimbus, from the knoll' }),
    ...iss.forecast.map((d, i) => h('div.gz-fc', null,
      canvas(40, 32, (g, r) => weatherGlyph(g, r, d.weather, 20, 17, 12), `fc|${iss.facts.date}|${i}|${d.weather}`),
      h('div', null, h('b', { text: `${d.label} · ${WEATHER_WORD[d.weather]}` }), h('span', { text: d.line })))));
}

function numbersBox(iss: Issue): HTMLElement {
  return h('section.gz-box.gz-numbers', { 'data-testid': 'gz-numbers' },
    h('h4', { text: 'The harvest in numbers' }),
    h('table', null, h('tbody', null, ...iss.numbers.map((n) => h('tr', null, h('td', { text: n.label }), h('td.v', { text: n.value }))))),
    h('p.gz-small', { text: `${iss.facts.rank}${iss.facts.next ? ` · ${iss.facts.next.left.toLocaleString('en-US')} to ${iss.facts.next.name}` : ''}${iss.facts.streak > 1 ? ` · ${iss.facts.streak}-day streak` : ''}` }));
}

function page(iss: Issue): HTMLElement {
  const f = iss.facts;
  const ears = h('div.gz-ears', null,
    h('div.gz-ear', null, h('b', { text: iss.edition }), h('span', { text: iss.covers })),
    h('div.gz-ear.r', null, h('b', { text: `Price: ${iss.price}` }), h('span', { text: `${f.season[0].toUpperCase()}${f.season.slice(1)} edition` })));
  const dateline = h('div.gz-dateline', null, h('span', { text: `No. ${iss.no}` }), h('span.c', { text: iss.dateLine }), h('span', { text: iss.motto }));
  const quote = iss.quote ? h('blockquote.gz-quote', { 'data-testid': 'gz-quote' }, h('p', { text: iss.quote.text }), h('cite', { text: `— ${iss.quote.by}` })) : null;
  const gossip = h('section.gz-box.gz-gossip', { 'data-testid': 'gz-gossip' }, h('h4', { text: 'Over the garden fence' }),
    iss.gossip.length ? h('ul', null, ...iss.gossip.map((g) => h('li', { text: g })))
      : h('p.gz-small', { text: 'The garden fence was quiet this week. Pop round and say hello to the neighbours; they like that.' }));
  const classifieds = h('section.gz-box.gz-classifieds', { 'data-testid': 'gz-classifieds' }, h('h4', { text: 'Classifieds' }),
    ...iss.classifieds.map((c) => h('p', null, h('b', { text: `${c.head.toUpperCase()}. ` }), c.text)));
  const ed = iss.editorial;
  const editorial = h('section.gz-editorial', { 'data-testid': 'gz-editorial' },
    h('div.gz-kicker', { text: ed.kicker }), h('h3.gz-head', { text: ed.head }),
    h('div.gz-ed-body', null, h('figure.gz-art', null, canvas(ART_W, ART_H, (g, r) => drawArt(g, r, 'quill', ART_W, ART_H), `ed|${f.from}`)),
      ...ed.body.map((p) => h('p', { text: p })), signature('Mayor Marigold')));
  return h('div.gz-page', { lang: 'en', 'data-testid': 'gz-page', 'data-kind': iss.kind, 'data-no': String(iss.no) },
    f.demo ? h('div.gz-demo', { text: 'Demo valley: an illustrative edition from the demo\'s seeded week.' }) : null,
    ears,
    h('header.gz-masthead', { 'data-testid': 'gz-masthead' }, masthead(iss.no)),
    dateline,
    h('div.gz-top', null, storyEl(iss.lead, true), h('aside.gz-side', null, numbersBox(iss), quote)),
    h('div.gz-cols', null,
      h('div.gz-stories', null, ...iss.stories.map((s) => storyEl(s))),
      h('aside.gz-side', null, weatherBox(iss), forecastBox(iss), gossip, classifieds)),
    editorial,
    h('footer.gz-foot', { text: `Printed at the post office by Posy · ${iss.facts.from === iss.facts.to ? iss.dateLine : iss.covers} · Only true news, as the Almanac recorded it.` }));
}

export function createGazettePanel(ctx: HudCtx, port: () => GazetteView | undefined): Panel {
  const { el, body, closeBtn } = framePanel('gazette', 'The Valley Gazette', LETTER_ICON.news);
  closeBtn.addEventListener('click', () => ctx.panels.close());
  const bar = h('div.gz-editions', { role: 'tablist', 'data-testid': 'gz-editions' });
  const holder = h('div.gz-holder.vh-scroll', { tabindex: '-1' });
  body.append(bar, holder);
  /** -1: today's paper; i ≥ 0: the i-th newest back issue */
  let sel = -1;
  let sig = '';
  const render = (force = false) => {
    const p = port();
    if (!p) { holder.replaceChildren(h('div.vh-empty', { text: 'The presses are warming up.' })); return; }
    const recs = p.issues();
    if (sel >= recs.length) sel = recs.length - 1;
    const iss = sel < 0 ? p.today() : p.issue(recs[sel]);
    const s = `${sel}|${p.version}|${recs.length}|${iss.facts.date}|${iss.facts.points}|${iss.facts.active > 0 ? Math.round(iss.facts.active / 600_000) : 0}`;
    if (!force && s === sig) return;
    sig = s;
    const chip = (i: number, label: string, sub: string) => {
      const b = h('button.gz-ed', { type: 'button', role: 'tab', 'aria-selected': String(i === sel), 'data-testid': i < 0 ? 'gz-edition-today' : `gz-edition-${i}` }, h('b', { text: label }), h('span', { text: sub }));
      b.addEventListener('click', () => { sel = i; render(true); holder.scrollTop = 0; ctx.sfx('page'); });
      return b;
    };
    bar.replaceChildren(chip(-1, 'Today\'s paper', 'Morning edition'),
      ...(recs.length ? [h('span.gz-bi', { text: 'Back issues' })] : []),
      ...recs.map((r, i) => chip(i, `No. ${r.no}`, `${r.facts.from.slice(5).replace('-', '/')} – ${r.facts.to.slice(5).replace('-', '/')}`)));
    const top = holder.scrollTop;
    holder.replaceChildren(page(iss));
    holder.scrollTop = force ? 0 : top;
  };
  const step = (d: number) => {
    const n = port()?.issues().length ?? 0;
    const next = Math.max(-1, Math.min(n - 1, sel + d));
    if (next !== sel) { sel = next; render(true); ctx.sfx('page'); }
  };
  return {
    id: 'gazette', el,
    onOpen(arg) {
      const recs = port()?.issues() ?? [];
      if (arg === 'latest') sel = recs.length ? 0 : -1;
      else if (arg && typeof arg === 'object' && typeof (arg as { from?: unknown }).from === 'string') sel = recs.findIndex((r) => r.facts.from === (arg as { from: string }).from);
      else if (arg && typeof arg === 'object' && typeof (arg as { index?: unknown }).index === 'number') sel = Math.max(-1, Math.min(recs.length - 1, (arg as { index: number }).index));
      else sel = -1;
      render(true);
      holder.focus({ preventScroll: true });
    },
    refresh: () => render(false),
    key(e) {
      if (typingIn(e.target)) return false;
      // ← older, → newer (today's paper is the newest)
      if (e.key === 'ArrowLeft') { step(1); return true; }
      if (e.key === 'ArrowRight') { step(-1); return true; }
      if (e.code === 'KeyG' && !e.ctrlKey && !e.metaKey && !e.altKey) { ctx.panels.close(); return true; }
      return false;
    },
  };
}
