/**
 * The tray / window / overlay icons, drawn in code (no asset): Clawd's block face (the same figure as the page's tab
 * icon, hud/notify.ts) plus a gold count badge for asks or a blue dot for unseen finishes. Pure: shapes are sampled
 * 4×4 per pixel in a 64-unit space and encoded as a PNG with node:zlib, so the main process needs no canvas.
 */
import { deflateSync } from 'node:zlib';

type RGBA = [number, number, number, number];
const ORANGE: RGBA = [0xd9, 0x77, 0x57, 255];
const INK: RGBA = [0x2a, 0x1a, 0x10, 255];
const GOLD: RGBA = [0xf0, 0xa7, 0x2c, 255];
const BLUE: RGBA = [0x3f, 0x95, 0xd8, 255];
const CREAM: RGBA = [0xff, 0xf6, 0xe0, 255];
const DARK: RGBA = [0x3a, 0x24, 0x00, 255];

/** 3×5 pixel glyphs for the badge count */
const GLYPHS: Record<string, string> = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001111',
  '+': '000010111010000',
};

export interface IconBadge { need: number; done: boolean }

type Shape = (u: number, v: number) => RGBA | null;
const inRect = (u: number, v: number, x: number, y: number, w: number, h: number) => u >= x && u < x + w && v >= y && v < y + h;

function clawd(u: number, v: number): RGBA | null {
  if (inRect(u, v, 20, 22, 5, 8) || inRect(u, v, 39, 22, 5, 8)) return INK;
  if (inRect(u, v, 10, 14, 44, 30) || inRect(u, v, 2, 24, 8, 10) || inRect(u, v, 54, 24, 8, 10)) return ORANGE;
  for (const x of [14, 24, 36, 46]) if (inRect(u, v, x, 44, 5, 10)) return ORANGE;
  return null;
}

/** the badge disc (centre cx, cy, radius r) with an optional count, in 64-units */
function badge(text: string, cx: number, cy: number, r: number, fill: RGBA): Shape {
  const glyphs = [...text];
  const textH = r * 1.1, cell = textH / 5, gap = cell;
  const textW = glyphs.length * 3 * cell + (glyphs.length - 1) * gap;
  const x0 = cx - textW / 2, y0 = cy - textH / 2;
  return (u, v) => {
    const d = Math.hypot(u - cx, v - cy);
    if (d > r) return null;
    if (d > r - Math.max(2, r * 0.16)) return CREAM;
    if (glyphs.length && v >= y0 && v < y0 + textH) {
      const gx = u - x0;
      const i = Math.floor(gx / (3 * cell + gap));
      const lx = gx - i * (3 * cell + gap);
      const g = GLYPHS[glyphs[i]];
      if (g && gx >= 0 && lx < 3 * cell) {
        const col = Math.floor(lx / cell), row = Math.floor((v - y0) / cell);
        if (g[row * 3 + col] === '1') return DARK;
      }
    }
    return fill;
  };
}

/**
 * RGBA pixels of the icon at `size` px. Small sizes (tray) get a larger badge so a count stays legible.
 * `badgeOnly`: just the disc filling the square (the Windows taskbar overlay).
 */
export function paintIcon(size: number, b: IconBadge, o: { badgeOnly?: boolean } = {}): Uint8Array {
  const text = b.need > 0 ? (b.need > 9 ? '9+' : String(Math.floor(b.need))) : '';
  const small = size <= 24;
  const layers: Shape[] = [];
  if (o.badgeOnly) {
    if (b.need > 0 || b.done) layers.push(badge(text, 32, 32, 31, b.need > 0 ? GOLD : BLUE));
  } else {
    if (b.need > 0) { const r = small ? 23 : 18; layers.push(badge(text, 64 - r, r, r, GOLD)); }
    else if (b.done) { const r = small ? 15 : 12; layers.push(badge('', 64 - r, r, r, BLUE)); }
    layers.push(clawd);
  }
  const px = new Uint8Array(size * size * 4);
  const S = 4, k = 64 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, bl = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const u = (x + (sx + 0.5) / S) * k, v = (y + (sy + 0.5) / S) * k;
          let c: RGBA | null = null;
          for (const l of layers) { c = l(u, v); if (c) break; }
          if (c) { r += c[0]; g += c[1]; bl += c[2]; a += c[3]; }
        }
      }
      const n = S * S, i = (y * size + x) * 4;
      // un-premultiply: colours average over covered samples only, alpha over all
      const cov = a / 255;
      px[i] = cov ? Math.round(r / cov) : 0; px[i + 1] = cov ? Math.round(g / cov) : 0; px[i + 2] = cov ? Math.round(bl / cov) : 0;
      px[i + 3] = Math.round(a / n);
    }
  }
  return px;
}

// ---- a minimal PNG encoder (RGBA, 8 bit, no filtering) ----

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
export function encodePng(rgba: Uint8Array, width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))]);
}

/** the icon as PNG bytes (memoised: a handful of badge states exist all day) */
const cache = new Map<string, Buffer>();
export function iconPng(size: number, b: IconBadge, o: { badgeOnly?: boolean } = {}): Buffer {
  const key = `${size}|${b.need > 9 ? 10 : b.need}|${b.done ? 1 : 0}|${o.badgeOnly ? 1 : 0}`;
  let png = cache.get(key);
  if (!png) { png = encodePng(paintIcon(size, b, o), size, size); cache.set(key, png); }
  return png;
}
