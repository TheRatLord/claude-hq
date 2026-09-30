/**
 * Missing-glyph guard for terminal output. Unsupported symbols are replaced with geometric look-alikes.
 * Three-byte replacements are mapped directly in binary term.data; unsupported pictographs retain two-cell width.
 */
import { TERM_FONT } from './styles.ts';

/** source → candidate replacements (first one that renders wins). */
export const GLYPH_FALLBACKS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  '⎿': ['└'], // tool-result elbow
  '⏺': ['●', '•'], // tool bullet
  '⏵': ['▶', '▸', '>'],
  '⏴': ['◀', '◂', '<'],
  '⏸': ['‖', '|'],
  '⏹': ['■'],
  '⎯': ['─'],
  '⏎': ['↵'],
  '✶': ['✻', '*'],
  '✳': ['✻', '*'],
  '✽': ['✻', '*'],
  '✢': ['✻', '*'],
  '✻': ['*'],
});

const enc = new TextEncoder();
const key3 = (b: Uint8Array) => (b[0] << 16) | (b[1] << 8) | b[2];

/** `has`: does the terminal font stack render this character? Returns 3-byte UTF-8 key → replacement bytes. */
export function buildGlyphTable(has: (ch: string) => boolean): Map<number, Uint8Array> {
  const table = new Map<number, Uint8Array>();
  for (const [src, alts] of Object.entries(GLYPH_FALLBACKS)) {
    if (has(src)) continue;
    const alt = alts.find((a) => enc.encode(a).length === 3 && has(a)) ?? alts.find((a) => enc.encode(a).length === 3);
    const sb = enc.encode(src);
    if (!alt || sb.length !== 3) continue;
    table.set(key3(sb), enc.encode(alt));
  }
  return table;
}

/** A missing four-byte, two-cell pictograph becomes '◆ ' without shifting the terminal grid. */
export const EMOJI_STANDIN = new Uint8Array([0xe2, 0x97, 0x86, 0x20]);

/**
 * Stateful per-terminal byte mapper. A multi-byte sequence split across two frames is carried over (≤ 3 bytes).
 * `emojiHas`: does the stack render this pictograph? (null: never swap emoji)
 */
export function glyphMapper(table: Map<number, Uint8Array>, emojiHas: ((cp: number) => boolean) | null = null): (bytes: Uint8Array, full?: boolean) => Uint8Array {
  let carry: Uint8Array | null = null;
  return (bytes, full = false) => {
    if (!table.size && !emojiHas) return bytes;
    if (full) carry = null;
    let b = bytes;
    if (carry) { b = new Uint8Array(carry.length + bytes.length); b.set(carry); b.set(bytes, carry.length); carry = null; }
    let out: Uint8Array | null = b === bytes ? null : b;
    const n = b.length;
    for (let i = 0; i < n; i++) {
      const c = b[i];
      if (c === 0xf0 && emojiHas) {
        if (i + 3 >= n) { carry = b.slice(i); return (out ?? b).subarray(0, i); }
        const cp = ((c & 0x07) << 18) | ((b[i + 1] & 0x3f) << 12) | ((b[i + 2] & 0x3f) << 6) | (b[i + 3] & 0x3f);
        if (cp >= 0x1f000 && cp <= 0x1faff && !emojiHas(cp)) {
          if (!out) out = b.slice();
          out.set(EMOJI_STANDIN, i);
        }
        i += 3;
        continue;
      }
      if (c !== 0xe2 || !table.size) continue;
      if (i + 2 >= n) { carry = b.slice(i); return (out ?? b).subarray(0, i); }
      const r = table.get((0xe2 << 16) | (b[i + 1] << 8) | b[i + 2]);
      if (r) {
        if (!out) out = b.slice();
        out.set(r, i);
      }
      i += 2;
    }
    return out ?? b;
  };
}

let shared: Map<number, Uint8Array> | null = null;

/** Canvas probe: a glyph is missing when it rasterises identically to an unassigned code point (the .notdef box). */
function canvasHas(): (ch: string) => boolean {
  const c = document.createElement('canvas');
  c.width = 24; c.height = 24;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return () => true;
  const px = (ch: string) => {
    ctx.clearRect(0, 0, 24, 24);
    ctx.font = `18px ${TERM_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'white';
    ctx.fillText(ch, 2, 12);
    return ctx.getImageData(0, 0, 24, 24).data;
  };
  const same = (a: Uint8ClampedArray, b: Uint8ClampedArray) => { for (let i = 3; i < a.length; i += 4) if (a[i] !== b[i]) return false; return true; };
  const tofu = [px('\u{10FFFD}'), px('￿')];
  const blank = (a: Uint8ClampedArray) => { for (let i = 3; i < a.length; i += 4) if (a[i]) return false; return true; };
  return (ch) => { const p = px(ch); return !blank(p) && !tofu.some((t) => same(p, t)); };
}

/** Per-code-point emoji coverage, probed once and shared by terminal instances. */
let emojiProbe: ((ch: string) => boolean) | null = null;
const emojiSeen = new Map<number, boolean>();
function emojiHas(cp: number) {
  let v = emojiSeen.get(cp);
  if (v === undefined) {
    try { v = emojiProbe ? emojiProbe(String.fromCodePoint(cp)) : true; } catch { v = true; }
    if (emojiSeen.size < 4096) emojiSeen.set(cp, v);
  }
  return v;
}

/** A mapper for one terminal, using the (lazily probed, then shared) table for this machine's fonts. */
export function createGlyphMapper() {
  if (!shared) {
    try {
      const has = typeof document !== 'undefined' ? canvasHas() : null;
      shared = has ? buildGlyphTable(has) : new Map();
      emojiProbe = has;
    } catch { shared = new Map(); }
  }
  return glyphMapper(shared, emojiProbe ? emojiHas : null);
}

/** String form for the history overlay. Clipboard copies retain the original characters. */
export function mapGlyphText(text: string) {
  createGlyphMapper();
  const dec = new TextDecoder();
  let out = emojiProbe ? text.replace(/[\u{1F000}-\u{1FAFF}]/gu, (ch) => (emojiHas(ch.codePointAt(0) ?? 0) ? ch : '◆ ')) : text;
  if (!shared?.size) return out;
  for (const [k, v] of shared) out = out.replaceAll(dec.decode(new Uint8Array([k >> 16, (k >> 8) & 255, k & 255])), dec.decode(v));
  return out;
}
