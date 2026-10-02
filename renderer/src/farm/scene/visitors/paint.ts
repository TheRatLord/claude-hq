/**
 * Odile's paintings (model/visitors.ts PAINT_SPOTS), drawn in code onto a 2D canvas: a little impressionist landscape
 * of the spot's subject in the season's colours, laid down in passes so a canvas on the easel fills in over her
 * working day (`progress` 0..1: a pencil sketch on linen → the sky → the land → the subject → the last dabs of light).
 * The same picture hangs in the farmhouse once bought, and the HUD shows it as a thumbnail (`paintingUrl`).
 * Deterministic per (spot, season, day).
 */
import type { Season } from '../../model/types.ts';
import { hashKey, rand } from '../../model/collection.ts';

interface Palette { sky: [string, string]; hill: string; far: string; grass: [string, string]; leaf: [string, string, string]; light: string }
const PALETTES: Readonly<Record<Season, Palette>> = {
  spring: { sky: ['#9fd0ef', '#f4e6c8'], hill: '#7fae6a', far: '#a8c4c8', grass: ['#8cc45a', '#6fa84a'], leaf: ['#9fd06a', '#f6b8cc', '#ffffff'], light: '#fff6d8' },
  summer: { sky: ['#6fb7e8', '#e8f2f4'], hill: '#5f9a4a', far: '#8fb0c4', grass: ['#7fb84e', '#5c9a3c'], leaf: ['#4e8a36', '#6fb04a', '#f2c33a'], light: '#fff2c0' },
  autumn: { sky: ['#e8b884', '#f6e2c0'], hill: '#a07a4a', far: '#b8a0a0', grass: ['#b9a85a', '#9a8a3e'], leaf: ['#e8812f', '#d9453b', '#f2c33a'], light: '#ffe0a8' },
  winter: { sky: ['#a8bcd8', '#eef0f4'], hill: '#c8d2dc', far: '#b0bccc', grass: ['#f4f6fa', '#dfe6ee'], leaf: ['#3f6a4a', '#ffffff', '#c8d8e8'], light: '#ffffff' },
};

type Pass = (g: CanvasRenderingContext2D, w: number, h: number, r: () => number, p: Palette) => void;

/** a soft dab (a blurred ellipse of paint) */
function dab(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, c: string, a = 0.85, rot = 0): void {
  g.globalAlpha = a; g.fillStyle = c;
  g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); g.fill();
  g.globalAlpha = 1;
}

const horizon = 0.56;

const sky: Pass = (g, w, h, r, p) => {
  const gr = g.createLinearGradient(0, 0, 0, h * horizon);
  gr.addColorStop(0, p.sky[0]); gr.addColorStop(1, p.sky[1]);
  g.fillStyle = gr; g.fillRect(0, 0, w, h * horizon + 2);
  for (let i = 0; i < 26; i++) dab(g, r() * w, r() * h * 0.35, 8 + r() * 22, 3 + r() * 6, '#ffffff', 0.25 + r() * 0.3);
  // far hills
  g.fillStyle = p.far; g.beginPath(); g.moveTo(0, h * horizon);
  for (let x = 0; x <= w; x += w / 12) g.lineTo(x, h * (horizon - 0.08 - r() * 0.1));
  g.lineTo(w, h * horizon); g.closePath(); g.fill();
};

const land: Pass = (g, w, h, r, p) => {
  g.fillStyle = p.hill; g.beginPath(); g.moveTo(0, h * (horizon + 0.02));
  for (let x = 0; x <= w; x += w / 8) g.lineTo(x, h * (horizon - 0.02 - r() * 0.05));
  g.lineTo(w, h); g.lineTo(0, h); g.closePath(); g.fill();
  const gr = g.createLinearGradient(0, h * horizon, 0, h);
  gr.addColorStop(0, p.grass[0]); gr.addColorStop(1, p.grass[1]);
  g.fillStyle = gr; g.fillRect(0, h * (horizon + 0.04), w, h);
  for (let i = 0; i < 70; i++) { const y = h * (horizon + 0.05) + r() * h * (1 - horizon); dab(g, r() * w, y, 4 + r() * 9, 2 + r() * 3, r() < 0.5 ? p.grass[0] : p.grass[1], 0.6); }
  // trees at the edges
  for (const side of [0, 1]) for (let i = 0; i < 3; i++) {
    const x = side ? w * (0.82 + r() * 0.16) : w * (0.02 + r() * 0.16), y = h * (horizon + 0.02 + r() * 0.08), s = h * (0.07 + r() * 0.05);
    g.fillStyle = '#5a3e26'; g.fillRect(x - 2, y, 4, s * 0.9);
    for (let k = 0; k < 6; k++) dab(g, x + (r() - 0.5) * s, y - r() * s * 0.9, s * 0.45, s * 0.38, p.leaf[k % 3], 0.85);
  }
};

const subject = (spot: string): Pass => (g, w, h, r, p) => {
  const cx = w * 0.5, base = h * (horizon + 0.12);
  g.lineJoin = 'round'; g.lineCap = 'round';
  switch (spot) {
    case 'windmill': {
      g.fillStyle = '#e8dcc0'; g.beginPath(); g.moveTo(cx - w * 0.07, base); g.lineTo(cx - w * 0.045, base - h * 0.32); g.lineTo(cx + w * 0.045, base - h * 0.32); g.lineTo(cx + w * 0.07, base); g.closePath(); g.fill();
      g.fillStyle = '#b8483a'; g.beginPath(); g.moveTo(cx - w * 0.055, base - h * 0.32); g.lineTo(cx, base - h * 0.4); g.lineTo(cx + w * 0.055, base - h * 0.32); g.closePath(); g.fill();
      g.strokeStyle = '#6e4a2a'; g.lineWidth = Math.max(2, w * 0.012);
      const hx = cx, hy = base - h * 0.33, L = h * 0.28, a0 = r() * Math.PI;
      for (let i = 0; i < 4; i++) { const a = a0 + (i * Math.PI) / 2; g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx + Math.cos(a) * L, hy + Math.sin(a) * L); g.stroke(); }
      g.fillStyle = '#6e4a2a'; g.fillRect(cx - w * 0.012, base - h * 0.08, w * 0.024, h * 0.08);
      break;
    }
    case 'pond': {
      g.fillStyle = '#4aa3c9'; g.beginPath(); g.ellipse(cx, base + h * 0.1, w * 0.34, h * 0.12, 0, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 14; i++) dab(g, cx + (r() - 0.5) * w * 0.55, base + h * 0.06 + r() * h * 0.1, 6 + r() * 10, 1.5, p.sky[1], 0.55);
      for (let i = 0; i < 4; i++) dab(g, cx + (r() - 0.5) * w * 0.4, base + h * 0.12 + r() * h * 0.06, 6, 3, '#6fa84a', 0.9);
      g.strokeStyle = '#4e7a36'; g.lineWidth = 2;
      for (let i = 0; i < 12; i++) { const x = cx - w * 0.32 + r() * w * 0.14; g.beginPath(); g.moveTo(x, base + h * 0.12); g.lineTo(x + (r() - 0.5) * 6, base - h * 0.02); g.stroke(); }
      break;
    }
    case 'farmhouse': case 'barn': {
      const red = spot === 'barn', bw = w * (red ? 0.3 : 0.34), bh = h * 0.18;
      g.fillStyle = red ? '#b8483a' : '#f1e3c4'; g.fillRect(cx - bw / 2, base - bh, bw, bh);
      g.fillStyle = red ? '#7a2e24' : '#c2533e'; g.beginPath(); g.moveTo(cx - bw / 2 - 6, base - bh); g.lineTo(cx, base - bh - h * (red ? 0.14 : 0.12)); g.lineTo(cx + bw / 2 + 6, base - bh); g.closePath(); g.fill();
      g.fillStyle = red ? '#f6f1e6' : '#7a5236'; g.fillRect(cx - bw * 0.1, base - bh * 0.62, bw * 0.2, bh * 0.62);
      if (red) { g.strokeStyle = '#f6f1e6'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx - bw * 0.1, base - bh * 0.62); g.lineTo(cx + bw * 0.1, base); g.moveTo(cx + bw * 0.1, base - bh * 0.62); g.lineTo(cx - bw * 0.1, base); g.stroke(); }
      else for (const s of [-1, 1]) { g.fillStyle = '#ffd27a'; g.fillRect(cx + s * bw * 0.3 - bw * 0.06, base - bh * 0.7, bw * 0.12, bh * 0.3); }
      if (!red) { g.fillStyle = '#9a958c'; g.fillRect(cx + bw * 0.22, base - bh - h * 0.12, bw * 0.08, h * 0.08); }
      break;
    }
    case 'bridge': {
      g.fillStyle = '#4aa3c9'; g.fillRect(0, base, w, h * 0.12);
      for (let i = 0; i < 12; i++) dab(g, r() * w, base + h * 0.02 + r() * h * 0.09, 8 + r() * 12, 1.5, '#e8f6ff', 0.5);
      g.strokeStyle = '#8a5a32'; g.lineWidth = Math.max(4, h * 0.03);
      g.beginPath(); g.moveTo(cx - w * 0.32, base + 2); g.quadraticCurveTo(cx, base - h * 0.18, cx + w * 0.32, base + 2); g.stroke();
      g.lineWidth = 2; g.strokeStyle = '#6e4a2a';
      for (let i = -3; i <= 3; i++) { const x = cx + i * w * 0.08, y = base - h * 0.16 * (1 - (i / 3.6) ** 2); g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - h * 0.06); g.stroke(); }
      break;
    }
    default: { // the standing stones
      g.fillStyle = '#9a958c';
      for (const [dx, hh] of [[-0.18, 0.2], [-0.06, 0.26], [0.07, 0.22], [0.19, 0.17]] as const) {
        const x = cx + dx * w, wd = w * 0.045;
        g.beginPath(); g.moveTo(x - wd, base); g.lineTo(x - wd * 0.8, base - h * hh); g.quadraticCurveTo(x, base - h * (hh + 0.03), x + wd * 0.8, base - h * hh); g.lineTo(x + wd, base); g.closePath(); g.fill();
      }
      for (let i = 0; i < 6; i++) dab(g, cx + (r() - 0.5) * w * 0.4, base - h * (0.05 + r() * 0.12), 2, 2, '#7ff0e0', 0.5);
    }
  }
};

const light: Pass = (g, w, h, r, p) => {
  // a sun or moon, the last bright dabs, and a signature
  dab(g, w * (0.15 + r() * 0.15), h * 0.14, w * 0.045, w * 0.045, p.light, 0.95);
  for (let i = 0; i < 40; i++) dab(g, r() * w, h * (horizon + r() * (1 - horizon)), 2 + r() * 3, 1.5 + r() * 2, r() < 0.5 ? p.light : p.leaf[i % 3], 0.75);
  g.fillStyle = '#3b2a1e'; g.globalAlpha = 0.8;
  g.font = `italic ${Math.round(h * 0.06)}px Georgia, "DejaVu Serif", serif`; g.textAlign = 'right'; g.textBaseline = 'bottom';
  g.fillText('O.V.', w * 0.96, h * 0.97);
  g.globalAlpha = 1;
};

/**
 * Draw the painting of `spot` in `season` (seeded by `day`) into `g` (w × h), `progress` 0..1 of the way done.
 * Unfinished: linen and a pencil sketch, then each pass fading in over its share of the day.
 */
export function drawPainting(g: CanvasRenderingContext2D, w: number, h: number, spot: string, season: Season, day: string, progress = 1): void {
  const p = PALETTES[season] ?? PALETTES.summer;
  // linen
  g.fillStyle = '#efe6d2'; g.fillRect(0, 0, w, h);
  const lr = rand(hashKey(`linen|${day}`));
  g.globalAlpha = 0.08; g.fillStyle = '#6e5a3a';
  for (let i = 0; i < 120; i++) g.fillRect(lr() * w, lr() * h, 1 + lr() * 2, 1);
  g.globalAlpha = 1;
  // the pencil sketch: the horizon and the subject's outline (drawn from the subject pass, faintly)
  g.save(); g.globalAlpha = 0.18; g.filter = 'grayscale(1)';
  subject(spot)(g, w, h, rand(hashKey(`subject|${spot}|${day}`)), p);
  g.restore();
  g.strokeStyle = 'rgba(80, 64, 48, .35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, h * horizon); g.lineTo(w, h * (horizon - 0.02)); g.stroke();
  const passes: [Pass, string][] = [[sky, 'sky'], [land, 'land'], [subject(spot), 'subject'], [light, 'light']];
  const k = Math.max(0, Math.min(1, progress)) * passes.length;
  for (let i = 0; i < passes.length && i < k; i++) {
    g.save();
    g.globalAlpha = 1;
    const a = Math.min(1, k - i);
    if (a < 1) { g.globalAlpha = a; }
    // each pass reseeds so a pass looks the same however far along the canvas is
    const r = rand(hashKey(`${passes[i][1]}|${spot}|${season}|${day}`));
    if (a < 1) {
      // a pass in progress: paint it to the side and lay it over at partial strength
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const cg = c.getContext('2d')!;
      passes[i][0](cg, w, h, r, p);
      g.drawImage(c, 0, 0);
    } else passes[i][0](g, w, h, r, p);
    g.restore();
  }
}

/** A data URL of a painting (the HUD's thumbnails), cached. */
const cache = new Map<string, string>();
export function paintingUrl(spot: string, season: Season, day: string, progress = 1, w = 192, h = 144): string {
  const q = Math.round(Math.max(0, Math.min(1, progress)) * 20) / 20;
  const key = `${spot}|${season}|${day}|${q}|${w}x${h}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  drawPainting(c.getContext('2d')!, w, h, spot, season, day, q);
  const url = c.toDataURL('image/png');
  if (cache.size > 24) cache.delete(cache.keys().next().value!);
  cache.set(key, url);
  return url;
}
