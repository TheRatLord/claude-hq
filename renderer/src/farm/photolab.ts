/**
 * The darkroom for photo mode and the album (docs/valley/album.md): 2D-canvas filters, the frames (a polaroid with a
 * handwritten caption, a "Greetings from Claude Valley" postcard with a stamp and a postmark), baked-in name tags, and
 * the live-preview CSS that photo mode lays over the WebGL canvas so the viewfinder shows what the picture will be.
 * DOM only (no three): the album panel and photo mode both develop through here. Everything is drawn in code.
 */
import type { FilterId, FrameId } from './model/album.ts';
import { hourText } from './model/album.ts';

/** a hand-lettered look without a font file: a script face where there is one, an italic serif otherwise */
export const HAND_FONT = '"Segoe Print", "Bradley Hand", "Comic Sans MS", "Chalkboard SE", "Marker Felt", "DejaVu Serif", Georgia, serif';
const SERIF = 'Georgia, "DejaVu Serif", "Times New Roman", serif';
const SANS = '"Trebuchet MS", "DejaVu Sans", system-ui, sans-serif';

/** the canvas `filter` (and CSS filter for the live preview) each look starts from */
export const FILTER_BASE: Record<FilterId, string> = {
  none: 'none',
  warm: 'sepia(0.2) saturate(1.2) contrast(1.06) brightness(1.04) hue-rotate(-5deg)',
  sepia: 'sepia(0.92) saturate(0.85) contrast(1.08) brightness(1.04)',
  mono: 'grayscale(1) contrast(1.24) brightness(1.05)',
  dreamy: 'saturate(1.12) brightness(1.06) contrast(0.94)',
  tilt: 'saturate(1.35) contrast(1.08) brightness(1.03)',
};

export const canvas2d = (w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return { c, g: c.getContext('2d')! };
};

/** a small deterministic RNG (grain, deckle edges, handwriting jitter) */
function rng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}
const seedOf = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

let grainTile: HTMLCanvasElement | null = null;
function grain(): HTMLCanvasElement {
  if (grainTile) return grainTile;
  const { c, g } = canvas2d(160, 160);
  const img = g.createImageData(160, 160), r = rng(7);
  for (let i = 0; i < img.data.length; i += 4) { const v = 128 + (r() - 0.5) * 150; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  g.putImageData(img, 0, 0);
  return (grainTile = c);
}
function addGrain(g: CanvasRenderingContext2D, w: number, h: number, a: number): void {
  g.save(); g.globalCompositeOperation = 'overlay'; g.globalAlpha = a;
  g.fillStyle = g.createPattern(grain(), 'repeat')!; g.fillRect(0, 0, w, h); g.restore();
}
function vignette(g: CanvasRenderingContext2D, w: number, h: number, a: number, color = '20,12,4', mode: GlobalCompositeOperation = 'multiply'): void {
  const r = Math.hypot(w, h) / 2;
  const gr = g.createRadialGradient(w / 2, h / 2, r * 0.45, w / 2, h / 2, r * 1.02);
  gr.addColorStop(0, `rgba(${color},0)`); gr.addColorStop(1, `rgba(${color},${a})`);
  g.save(); g.globalCompositeOperation = mode; g.fillStyle = gr; g.fillRect(0, 0, w, h); g.restore();
}

/** focus for tilt-shift: where the sharp band sits (0..1 of the height) and how wide it is (0..1) */
export interface Focus { x: number; y: number; band: number }

/**
 * Develop a picture: `src` (already cropped and sized to w×h) through a filter. Returns a new canvas.
 */
export function develop(src: CanvasImageSource, w: number, h: number, filter: FilterId, focus: Focus = { x: 0.5, y: 0.5, band: 0.22 }): HTMLCanvasElement {
  const { c, g } = canvas2d(w, h);
  const S = Math.max(w, h) / 1600;
  g.filter = FILTER_BASE[filter];
  g.drawImage(src, 0, 0, w, h);
  g.filter = 'none';
  switch (filter) {
    case 'warm': {
      g.save(); g.globalCompositeOperation = 'soft-light'; g.fillStyle = 'rgba(255,164,82,0.32)'; g.fillRect(0, 0, w, h);
      // faded film: blacks lift to a warm brown
      g.globalCompositeOperation = 'lighten'; g.fillStyle = 'rgb(34,22,14)'; g.fillRect(0, 0, w, h); g.restore();
      // a light leak in the top corner
      const lk = g.createRadialGradient(w * 0.95, h * 0.02, 0, w * 0.95, h * 0.02, w * 0.45);
      lk.addColorStop(0, 'rgba(255,150,70,0.38)'); lk.addColorStop(1, 'rgba(255,150,70,0)');
      g.save(); g.globalCompositeOperation = 'screen'; g.fillStyle = lk; g.fillRect(0, 0, w, h); g.restore();
      vignette(g, w, h, 0.42); addGrain(g, w, h, 0.1);
      break;
    }
    case 'sepia':
      g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = 'rgb(255,242,220)'; g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'lighten'; g.fillStyle = 'rgb(40,28,18)'; g.fillRect(0, 0, w, h); g.restore();
      vignette(g, w, h, 0.55, '50,30,10'); addGrain(g, w, h, 0.13);
      break;
    case 'mono':
      vignette(g, w, h, 0.5, '0,0,0'); addGrain(g, w, h, 0.14);
      break;
    case 'dreamy': {
      // bloom: a blurred, brightened copy screened over the top
      g.save(); g.globalCompositeOperation = 'screen'; g.globalAlpha = 0.5;
      g.filter = `blur(${Math.max(2, 14 * S)}px) brightness(1.3) saturate(1.25)`; g.drawImage(src, 0, 0, w, h); g.restore();
      g.save(); g.globalCompositeOperation = 'screen'; g.fillStyle = 'rgba(255,214,232,0.12)'; g.fillRect(0, 0, w, h); g.restore();
      const lk = g.createRadialGradient(0, 0, 0, 0, 0, w * 0.6);
      lk.addColorStop(0, 'rgba(255,200,225,0.35)'); lk.addColorStop(1, 'rgba(255,200,225,0)');
      g.save(); g.globalCompositeOperation = 'screen'; g.fillStyle = lk; g.fillRect(0, 0, w, h); g.restore();
      vignette(g, w, h, 0.3, '255,240,248', 'screen');
      break;
    }
    case 'tilt': {
      // the whole frame blurred, then the sharp copy masked to a band through the focus point
      const sharp = canvas2d(w, h);
      sharp.g.drawImage(c, 0, 0);
      g.save(); g.filter = `blur(${Math.max(2, 9 * S)}px)`; g.drawImage(sharp.c, 0, 0); g.restore();
      const fy = Math.min(0.92, Math.max(0.08, focus.y)), b = Math.min(0.45, Math.max(0.08, focus.band));
      const mask = sharp.g.createLinearGradient(0, 0, 0, h);
      const st = (t: number, a: number) => mask.addColorStop(Math.min(1, Math.max(0, t)), `rgba(0,0,0,${a})`);
      st(0, 0); st(fy - b / 2 - 0.2, 0); st(fy - b / 2, 1); st(fy + b / 2, 1); st(fy + b / 2 + 0.2, 0); st(1, 0);
      sharp.g.globalCompositeOperation = 'destination-in'; sharp.g.fillStyle = mask; sharp.g.fillRect(0, 0, w, h);
      g.drawImage(sharp.c, 0, 0);
      vignette(g, w, h, 0.25);
      break;
    }
    default: break;
  }
  return c;
}

/** the farmers' / villagers' name tags drawn into a picture (sx, sy = 0..1 over their heads) */
export function drawTags(c: HTMLCanvasElement, tags: readonly { name: string; sx: number; sy: number; kind: string }[]): void {
  const g = c.getContext('2d')!;
  const S = Math.max(c.width, c.height) / 1600, fs = Math.round(Math.max(13, 25 * S));
  g.save();
  g.font = `bold ${fs}px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const t of tags) {
    const tw = g.measureText(t.name).width + fs * 1.1, th = fs * 1.55;
    // keep the whole pill in the picture
    const x = Math.min(c.width - tw / 2 - 4, Math.max(tw / 2 + 4, t.sx * c.width)), y = Math.max(th / 2 + 4, t.sy * c.height - fs * 1.1);
    g.fillStyle = 'rgba(40,28,16,0.28)'; pill(g, x - tw / 2 + 2 * S, y - th / 2 + 3 * S, tw, th, th / 2); g.fill();
    g.fillStyle = t.kind === 'villager' ? '#fff3d6' : '#fffaf0'; pill(g, x - tw / 2, y - th / 2, tw, th, th / 2); g.fill();
    g.strokeStyle = t.kind === 'villager' ? '#c9963a' : '#7a5231'; g.lineWidth = Math.max(1.5, 2.4 * S); g.stroke();
    g.beginPath(); g.moveTo(x - fs * 0.35, y + th / 2 - 1); g.lineTo(x, y + th / 2 + fs * 0.45); g.lineTo(x + fs * 0.35, y + th / 2 - 1); g.closePath(); g.fill();
    g.fillStyle = '#3b2a1e'; g.fillText(t.name, x, y + 1);
  }
  g.restore();
}
function pill(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/**
 * Handwriting: each letter on its own slightly wobbling baseline and slant, ink pressure varying a touch; centred on
 * `cx`, shrunk to fit `maxW` (down to 60 %), wrapped to two lines when still too long.
 */
export function handwrite(g: CanvasRenderingContext2D, text: string, cx: number, cy: number, size: number, maxW: number, ink = '#24305e', seed = 1): void {
  if (!text) return;
  const r = rng(seed);
  let fs = size;
  const font = (s: number) => `italic 500 ${s}px ${HAND_FONT}`;
  g.save();
  g.font = font(fs);
  let lines = [text];
  if (g.measureText(text).width > maxW) {
    fs = Math.max(size * 0.6, (size * maxW) / g.measureText(text).width);
    g.font = font(fs);
    if (g.measureText(text).width > maxW) {
      fs = size * 0.62; g.font = font(fs);
      const words = text.split(' ');
      let best = 1, bestD = Infinity;
      for (let i = 1; i < words.length; i++) {
        const d = Math.abs(g.measureText(words.slice(0, i).join(' ')).width - g.measureText(words.slice(i).join(' ')).width);
        if (d < bestD) { bestD = d; best = i; }
      }
      lines = words.length > 1 ? [words.slice(0, best).join(' '), words.slice(best).join(' ')] : [text];
      const wide = Math.max(...lines.map((l) => g.measureText(l).width));
      if (wide > maxW) { fs *= maxW / wide; g.font = font(fs); }
    }
  }
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  const lh = fs * 1.12;
  lines.forEach((line, li) => {
    const chars = [...line];
    const widths = chars.map((ch) => g.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0);
    let x = cx - total / 2;
    const y0 = cy + (li - (lines.length - 1) / 2) * lh + fs * 0.32;
    const tilt = (r() - 0.5) * 0.03;
    chars.forEach((ch, i) => {
      const jy = (r() - 0.5) * fs * 0.07 + Math.sin(i * 0.7 + seed) * fs * 0.025 + (x - cx) * tilt;
      g.save();
      g.translate(x + widths[i] / 2, y0 + jy);
      g.rotate((r() - 0.5) * 0.09);
      g.globalAlpha = 0.82 + r() * 0.18;
      g.fillStyle = ink;
      g.fillText(ch, -widths[i] / 2, 0);
      g.restore();
      x += widths[i] * (0.97 + r() * 0.04);
    });
  });
  g.restore();
}

export interface FrameText { caption: string; place: string; at: number; hour: number; id: string }

/** paper with a whisper of fibre */
function paper(g: CanvasRenderingContext2D, w: number, h: number, base: string, seed: number): void {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  const r = rng(seed);
  g.save(); g.globalAlpha = 0.05;
  for (let i = 0; i < (w * h) / 900; i++) { g.fillStyle = r() < 0.5 ? '#8a7350' : '#ffffff'; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1); }
  g.restore();
}

/**
 * The picture in its frame, at `scale` of the stored size (1 = full: export; smaller for the album's big view).
 * 'none' returns the photo as is (a copy).
 */
export function compose(photo: CanvasImageSource, pw: number, ph: number, frame: FrameId, t: FrameText, scale = 1): HTMLCanvasElement {
  const w = Math.round(pw * scale), h = Math.round(ph * scale);
  const seed = seedOf(t.id);
  if (frame === 'polaroid') {
    const side = Math.round(w * 0.06), top = side, bottom = Math.round(w * 0.27);
    const W = w + side * 2, H = h + top + bottom;
    const { c, g } = canvas2d(W, H);
    paper(g, W, H, '#fbf8ef', seed);
    g.drawImage(photo, side, top, w, h);
    // the print sits a hair below the card surface
    g.save(); g.strokeStyle = 'rgba(60,40,20,0.22)'; g.lineWidth = Math.max(1, w * 0.002); g.strokeRect(side, top, w, h); g.restore();
    const ig = g.createLinearGradient(0, top, 0, top + h * 0.05);
    ig.addColorStop(0, 'rgba(0,0,0,0.16)'); ig.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = ig; g.fillRect(side, top, w, h * 0.05);
    handwrite(g, t.caption || t.place, W / 2, top + h + bottom * 0.45, Math.round(w * 0.07), w * 0.94, '#24305e', seed);
    // a pencilled date in the corner
    g.save(); g.font = `italic ${Math.round(w * 0.028)}px ${HAND_FONT}`; g.fillStyle = 'rgba(90,80,70,0.7)'; g.textAlign = 'right';
    const d = new Date(t.at);
    g.fillText(`${d.getDate()}·${d.getMonth() + 1}·${String(d.getFullYear()).slice(2)}`, W - side * 1.1, H - bottom * 0.14); g.restore();
    return c;
  }
  if (frame === 'postcard') {
    const b = Math.round(w * 0.035);
    const W = w + b * 2, H = h + b * 2;
    const { c, g } = canvas2d(W, H);
    paper(g, W, H, '#f8f2e2', seed);
    g.drawImage(photo, b, b, w, h);
    g.save(); g.strokeStyle = 'rgba(80,50,20,0.25)'; g.lineWidth = Math.max(1, w * 0.002); g.strokeRect(b, b, w, h); g.restore();
    greetings(g, b + w * 0.04, b + h * 0.96, w, photo, b, b, w, h);
    const sw = w * 0.13, sx = b + w * 0.965 - sw, sy = b + h * 0.05;
    stamp(g, sx + sw, sy, sw, seed);
    postmark(g, sx - sw * 0.05, sy + sw * 1.02, w * 0.058, t);
    if (t.caption) {
      // the caption on a little paper label pinned in the top-left corner
      g.save();
      const fs = Math.round(w * 0.024);
      g.font = `italic 500 ${fs}px ${HAND_FONT}`;
      const tw = Math.min(w * 0.5, g.measureText(t.caption).width + w * 0.035), th = fs * 2;
      const x = b + w * 0.03, y = b + h * 0.045;
      g.translate(x + tw / 2, y + th / 2); g.rotate(-0.02);
      g.shadowColor = 'rgba(0,0,0,0.28)'; g.shadowBlur = w * 0.006; g.shadowOffsetY = w * 0.0025;
      g.fillStyle = '#fffbea'; g.fillRect(-tw / 2, -th / 2, tw, th);
      g.shadowColor = 'transparent';
      // a strip of tape over its top
      g.fillStyle = 'rgba(255,246,200,0.7)'; g.fillRect(-tw * 0.12, -th / 2 - fs * 0.35, tw * 0.24, fs * 0.7);
      g.restore();
      handwrite(g, t.caption, x + tw / 2, y + th / 2, fs, tw * 0.9, '#3a2a6a', seed);
    }
    return c;
  }
  const { c, g } = canvas2d(w, h);
  g.drawImage(photo, 0, 0, w, h);
  return c;
}

/** "Greetings from" + big outlined letters filled with the photo itself (a large-letter postcard) */
function greetings(g: CanvasRenderingContext2D, x: number, base: number, w: number, photo: CanvasImageSource, px: number, py: number, pw: number, ph: number): void {
  const big = Math.round(w * 0.105), small = Math.round(w * 0.045);
  const word = 'CLAUDE VALLEY';
  g.save();
  g.font = `900 ${big}px ${SERIF}`;
  g.textBaseline = 'alphabetic';
  // squeeze to fit 70 % of the width
  const mw = g.measureText(word).width, sx = Math.min(1, (w * 0.7) / mw);
  g.translate(x, base); g.scale(sx, 1);
  // extruded shadow
  for (let i = Math.round(big * 0.09); i > 0; i -= Math.max(1, Math.round(big * 0.015))) { g.fillStyle = '#4a2a14'; g.fillText(word, i * 0.8, i); }
  g.lineJoin = 'round';
  g.lineWidth = big * 0.13; g.strokeStyle = '#4a2a14'; g.strokeText(word, 0, 0);
  g.lineWidth = big * 0.07; g.strokeStyle = '#fff6dc'; g.strokeText(word, 0, 0);
  g.restore();
  // letters filled with a saturated, brightened, warm-tinted copy of the picture behind them (an offscreen layer)
  const fill = canvas2d(g.canvas.width, g.canvas.height);
  const f = fill.g;
  f.save(); f.translate(x, base); f.scale(sx, 1); f.font = `900 ${big}px ${SERIF}`; f.textBaseline = 'alphabetic'; f.fillStyle = '#000'; f.fillText(word, 0, 0); f.restore();
  f.globalCompositeOperation = 'source-in';
  f.filter = 'saturate(1.7) brightness(1.15) contrast(1.1)';
  f.drawImage(photo, px, py, pw, ph);
  f.filter = 'none';
  f.globalCompositeOperation = 'source-atop';
  const tint = f.createLinearGradient(0, base - big, 0, base);
  tint.addColorStop(0, 'rgba(255,214,90,0.45)'); tint.addColorStop(1, 'rgba(240,110,50,0.45)');
  f.fillStyle = tint; f.fillRect(px, base - big * 1.1, pw, big * 1.3);
  g.drawImage(fill.c, 0, 0);
  // "Greetings from" in script over the top-left of the big word
  g.save();
  g.font = `italic 700 ${small}px ${HAND_FONT}`;
  g.translate(x + w * 0.01, base - big * 0.92); g.rotate(-0.06);
  g.lineJoin = 'round'; g.lineWidth = small * 0.22; g.strokeStyle = '#4a2a14'; g.strokeText('Greetings from', 0, 0);
  g.fillStyle = '#fff3c8'; g.fillText('Greetings from', 0, 0);
  g.restore();
}

/** a perforated stamp (top-right corner at x, y) with a little painted valley: sun, hills, the windmill */
function stamp(g: CanvasRenderingContext2D, right: number, top: number, sw: number, seed: number): void {
  const sh = sw * 1.2, x = right - sw, y = top;
  const r = sw * 0.035;
  g.save();
  g.translate(x + sw / 2, y + sh / 2); g.rotate(0.04 + (seed % 7) * 0.004); g.translate(-sw / 2, -sh / 2);
  g.shadowColor = 'rgba(0,0,0,0.3)'; g.shadowBlur = sw * 0.04; g.shadowOffsetY = sw * 0.015;
  // perforations: a white card with semicircles bitten out of every edge
  g.beginPath(); g.rect(0, 0, sw, sh);
  const nx = Math.round(sw / (r * 3)), ny = Math.round(sh / (r * 3));
  for (let i = 0; i <= nx; i++) for (const yy of [0, sh]) { g.moveTo((i * sw) / nx + r, yy); g.arc((i * sw) / nx, yy, r, 0, Math.PI * 2, true); }
  for (let i = 0; i <= ny; i++) for (const xx of [0, sw]) { g.moveTo(xx + r, (i * sh) / ny); g.arc(xx, (i * sh) / ny, r, 0, Math.PI * 2, true); }
  g.fillStyle = '#fffdf6'; g.fill('evenodd');
  g.shadowColor = 'transparent';
  // the picture
  const m = sw * 0.1, iw = sw - m * 2, ih = sh - m * 2 - sw * 0.16;
  g.save(); g.beginPath(); g.rect(m, m, iw, ih); g.clip();
  const sky = g.createLinearGradient(0, m, 0, m + ih);
  sky.addColorStop(0, '#7fc3ef'); sky.addColorStop(0.6, '#ffe2a8'); sky.addColorStop(1, '#ffd08a');
  g.fillStyle = sky; g.fillRect(m, m, iw, ih);
  g.fillStyle = '#ffd34d'; g.beginPath(); g.arc(m + iw * 0.3, m + ih * 0.42, iw * 0.14, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#6aab48'; g.beginPath(); g.moveTo(m, m + ih); g.quadraticCurveTo(m + iw * 0.3, m + ih * 0.5, m + iw * 0.65, m + ih * 0.72); g.quadraticCurveTo(m + iw * 0.85, m + ih * 0.62, m + iw, m + ih * 0.66); g.lineTo(m + iw, m + ih); g.fill();
  g.fillStyle = '#4c8a36'; g.beginPath(); g.moveTo(m, m + ih); g.quadraticCurveTo(m + iw * 0.5, m + ih * 0.7, m + iw, m + ih * 0.84); g.lineTo(m + iw, m + ih); g.fill();
  // the windmill
  const wx = m + iw * 0.72, wy = m + ih * 0.66;
  g.fillStyle = '#f7efe0'; g.beginPath(); g.moveTo(wx - iw * 0.06, wy); g.lineTo(wx - iw * 0.035, wy - ih * 0.28); g.lineTo(wx + iw * 0.035, wy - ih * 0.28); g.lineTo(wx + iw * 0.06, wy); g.fill();
  g.fillStyle = '#c0533a'; g.beginPath(); g.moveTo(wx - iw * 0.05, wy - ih * 0.28); g.lineTo(wx, wy - ih * 0.36); g.lineTo(wx + iw * 0.05, wy - ih * 0.28); g.fill();
  g.strokeStyle = '#6b4a2e'; g.lineWidth = iw * 0.025;
  for (let i = 0; i < 4; i++) { const a = 0.4 + (i * Math.PI) / 2; g.beginPath(); g.moveTo(wx, wy - ih * 0.3); g.lineTo(wx + Math.cos(a) * iw * 0.2, wy - ih * 0.3 + Math.sin(a) * iw * 0.2); g.stroke(); }
  g.restore();
  g.strokeStyle = 'rgba(80,50,20,0.35)'; g.lineWidth = sw * 0.01; g.strokeRect(m, m, iw, ih);
  g.fillStyle = '#7a3a28'; g.font = `bold ${Math.round(sw * 0.1)}px ${SERIF}`; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillText('2 bits', m, sh - m * 0.8);
  g.textAlign = 'right'; g.font = `bold ${Math.round(sw * 0.058)}px ${SANS}`; g.fillText('VALLEY POST', sw - m, sh - m * 0.85);
  g.restore();
}

/** a round postmark (place and date) with wavy cancellation lines */
function postmark(g: CanvasRenderingContext2D, cx: number, cy: number, R: number, t: FrameText): void {
  g.save();
  g.globalAlpha = 0.72;
  g.strokeStyle = '#2a2a3a'; g.fillStyle = '#2a2a3a';
  g.lineWidth = R * 0.06;
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
  g.lineWidth = R * 0.035;
  g.beginPath(); g.arc(cx, cy, R * 0.66, 0, Math.PI * 2); g.stroke();
  // text round the ring
  const ring = 'CLAUDE VALLEY · POST · ';
  g.font = `bold ${Math.round(R * 0.19)}px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < ring.length; i++) {
    const a = -Math.PI * 1.5 + ((i + 0.5) / ring.length) * Math.PI * 2;
    g.save(); g.translate(cx + Math.cos(a) * R * 0.84, cy + Math.sin(a) * R * 0.84); g.rotate(a + Math.PI / 2); g.fillText(ring[i], 0, 0); g.restore();
  }
  const d = new Date(t.at);
  const mo = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getMonth()];
  g.font = `bold ${Math.round(R * 0.24)}px ${SANS}`;
  g.fillText(`${d.getDate()} ${mo}`, cx, cy - R * 0.13);
  g.font = `bold ${Math.round(R * 0.17)}px ${SANS}`;
  g.fillText(`${d.getFullYear()} · ${hourText(t.hour)}`, cx, cy + R * 0.17);
  // cancellation waves to the right, over the stamp
  g.lineWidth = R * 0.05;
  for (let k = 0; k < 4; k++) {
    g.beginPath();
    const y = cy - R * 0.45 + k * R * 0.3;
    for (let i = 0; i <= 34; i++) { const xx = cx + R * 1.12 + i * R * 0.06; const yy = y + Math.sin(i * 0.55) * R * 0.08; if (i) g.lineTo(xx, yy); else g.moveTo(xx, yy); }
    g.stroke();
  }
  g.restore();
}

/** canvas → Blob (null when the browser refuses) */
export function toBlob(c: HTMLCanvasElement, type = 'image/png', q?: number): Promise<Blob | null> {
  return new Promise((res) => { try { c.toBlob((b) => res(b), type, q); } catch { res(null); } });
}

/** a Blob → something drawable (ImageBitmap where supported) */
export async function decode(b: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(b);
  const url = URL.createObjectURL(b);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}

/** save a Blob as a download */
export function download(b: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

