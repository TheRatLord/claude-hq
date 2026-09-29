/**
 * Lazily drawn, cached FX tiles in the sprite atlas: particle / ring / prop shapes, activity glyph discs, collapsed
 * bubble dots. Pooled per-actor tiles (bubbles, plates) are allocated by their own modules from the same atlas.
 * Owner: FX.
 */
import { SHAPES, GLYPH_TILE, DOT_TILE, drawShape, drawGlyph, drawDot, type ShapeKey } from './draw.ts';
import type { Atlas, Tile } from './atlas.ts';

const EMPTY: Tile = Object.freeze({ x: 0, y: 0, w: 0, h: 0, u0: 0, v0: 0, u1: 0, v1: 0, sizeKey: '0x0' });

export function createTiles(atlas: Atlas, fontsReady: () => boolean) {
  const cache = new Map<string, Tile>();
  let warned = false;
  const get = (key: string, w: number, h: number, paint: (g: CanvasRenderingContext2D, w: number, h: number) => void): Tile => {
    const hit = cache.get(key);
    if (hit) return hit;
    const t = atlas.alloc(w, h);
    if (!t) {
      // [INT M1.5] never throw from the frame loop: a zero-area tile samples the transparent gutter texel (invisible)
      if (!warned) { warned = true; console.warn('fx: sprite atlas full; dropping new cached tiles'); }
      return EMPTY;
    }
    atlas.draw(t, paint);
    cache.set(key, t);
    return t;
  };
  // shapes that contain lettering wait for fonts (the tile would otherwise bake a fallback face)
  const TEXT = new Set(['z', 'stillHere']);
  // [FX fix m2-r1] hot-path lookups keyed by the raw argument (no template-string key / paint closure per call: the
  // particles, rings, leaders and dots ask for tiles hundreds of times a frame); `get` runs only on a miss
  const shapes = new Map<string, Tile>();
  const glyphs = new Map<string, Tile>();
  const dots = new Map<string, Map<string, Tile>>();
  const keep = (t: Tile) => t !== EMPTY;
  return {
    shape(k: ShapeKey): Tile {
      const hit = shapes.get(k);
      if (hit) return hit;
      const s = SHAPES[k];
      if (TEXT.has(k) && !fontsReady()) return get(`shape:mote`, SHAPES.mote.w, SHAPES.mote.h, (g, w, h) => drawShape(g, 'mote', w, h));
      const t = get(`shape:${k}`, s.w, s.h, (g, w, h) => drawShape(g, k, w, h));
      if (keep(t)) shapes.set(k, t);
      return t;
    },
    glyph(icon: string): Tile {
      const hit = glyphs.get(icon);
      if (hit) return hit;
      const t = get(`glyph:${icon}`, GLYPH_TILE.w, GLYPH_TILE.h, (g, w) => drawGlyph(g, icon, w));
      if (keep(t)) glyphs.set(icon, t);
      return t;
    },
    dot(icon: string, hex: string): Tile {
      let m = dots.get(icon);
      const hit = m?.get(hex);
      if (hit) return hit;
      const t = get(`dot:${icon}:${hex}`, DOT_TILE.w, DOT_TILE.h, (g, w) => drawDot(g, icon, hex, w));
      if (keep(t)) { if (!m) dots.set(icon, (m = new Map())); m.set(hex, t); }
      return t;
    },
  };
}

export type Tiles = ReturnType<typeof createTiles>;
