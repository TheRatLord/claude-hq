/**
 * Canvas tile atlas (ART §3.4 / §10: ≤ 4 × 2048² canvas atlases). One CPU mirror canvas + one GPU texture; a tile is
 * drawn into a small scratch canvas, blitted into the mirror (so a context restore re-uploads everything from the
 * mirror) and copied to the GPU with `copyTextureToTexture` (texSubImage2D of just that tile, never a full re-upload).
 *
 * UV convention: `flipY = false`, so canvas row 0 is v = 0 (tile top = v0, tile bottom = v1).
 * Allocation (`createPacker`, pure): shelf packing by exact tile size with a free list per size, so pooled tiles
 * (bubbles, plates) recycle without fragmentation; a full atlas reuses a bigger freed slot, and `alloc` → null (never a
 * throw: `draw(null)` is a no-op) only when nothing fits. Each tile gets a 2 px transparent gutter against mip bleeding.
 * Owner: FX.
 */
import * as THREE from 'three';

const GUTTER = 2;

export interface Tile {
  /** inner rect (px) */
  x: number; y: number; w: number; h: number;
  u0: number; v0: number; u1: number; v1: number;
  sizeKey: string;
  /** the real allocation when this tile is a sub-rect of a larger freed slot (release returns it) */
  slot?: Tile;
}

/**
 * @pure Shelf packer (no DOM, unit-tested): one shelf run per tile height [INT M1.5] (a single mixed shelf wasted most
 * of every row and the atlas filled at ~33 actors). Freed tiles go to a free list per exact size; when no exact-size
 * tile is free and no new shelf fits, the smallest freed slot that is big enough is reused as a sub-rect [FX fix r1],
 * so churn between tile sizes (board ↔ tent) can never strand the atlas. `alloc` returns null only when truly full.
 * `size` = atlas width (px), `height` = atlas height (px; default = size).
 */
export function createPacker(size: number, height = size) {
  const free = new Map<string, Tile[]>();
  const shelves: { y: number; h: number; x: number }[] = [];
  let nextY = 0, used = 0, live = 0;
  const sub = (s: Tile, w: number, h: number): Tile => ({ x: s.x, y: s.y, w, h, u0: s.u0, v0: s.v0, u1: (s.x + w) / size, v1: (s.y + h) / height, sizeKey: s.sizeKey, slot: s });

  function alloc(w: number, h: number): Tile | null {
    const k = `${w}x${h}`;
    const list = free.get(k);
    const reuse = list?.pop();
    if (reuse) { live++; return reuse; }
    const W = w + GUTTER * 2, H = h + GUTTER * 2;
    let shelf = shelves.find((sh) => sh.h === H && sh.x + W <= size);
    if (!shelf && nextY + H <= height) {
      shelf = { y: nextY, h: H, x: 0 };
      shelves.push(shelf);
      nextY += H;
    }
    if (shelf) {
      const x = shelf.x + GUTTER, y = shelf.y + GUTTER;
      shelf.x += W;
      used++; live++;
      return { x, y, w, h, u0: x / size, v0: y / height, u1: (x + w) / size, v1: (y + h) / height, sizeKey: k };
    }
    // full: reuse the smallest freed slot that fits
    let best: Tile | null = null, bestList: Tile[] | null = null;
    for (const l of free.values()) {
      const s = l[l.length - 1];
      if (s && s.w >= w && s.h >= h && (!best || s.w * s.h < best.w * best.h)) { best = s; bestList = l; }
    }
    if (!best || !bestList) return null;
    bestList.pop();
    live++;
    return sub(best, w, h);
  }

  function release(t: Tile | null) {
    if (!t) return;
    let s = t;
    while (s.slot) s = s.slot;
    let list = free.get(s.sizeKey);
    if (!list) free.set(s.sizeKey, (list = []));
    list.push(s);
    live--;
  }

  return { alloc, release, stats: () => ({ tiles: used, live, fillY: nextY / height }) };
}

/**
 * `renderer` null → mirror-only (tests / no GL): the texture re-uploads on draw. `size` = width; height defaults to size.
 */
export function createAtlas(renderer: THREE.WebGLRenderer | null, { size = 2048, height = size, name = 'fx', premultiply = false }: { size?: number; height?: number; name?: string; premultiply?: boolean } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = height;
  const mirror = canvas.getContext('2d') as CanvasRenderingContext2D; // a fresh canvas always has a 2d context
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = `hq:atlas:${name}`;
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  // premultiplied upload: mip levels average colour × alpha, so transparent texels never darken edges (no dark
  // squares around far sprites); the sprite materials blend with (One, OneMinusSrcAlpha)
  texture.premultiplyAlpha = premultiply;
  let gpuReady = false;

  interface Scratch { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: THREE.DataTexture; data: Uint8Array }
  const scratch = new Map<string, Scratch>();
  const packer = createPacker(size, height);
  const { alloc, release } = packer;
  let uploads = 0;

  const scratchFor = (w: number, h: number): Scratch => {
    const k = `${w}x${h}`;
    let s = scratch.get(k);
    if (!s) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      // tiles go up as raw RGBA (getImageData → DataTexture → texSubImage2D): uploading straight from a canvas
      // left dark / translucent blocks in the GPU copy on ANGLE/Vulkan (text runs, re-drawn tiles)
      const data = new Uint8Array(w * h * 4);
      const tex = new THREE.DataTexture(data, w, h);
      s = { canvas: c, g: c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D, tex, data };
      scratch.set(k, s);
    }
    return s;
  };

  /**
   * Draw a tile: `fn(g, w, h)` paints into a cleared scratch canvas of the tile's size.
   */
  function draw(t: Tile | null, fn: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
    if (!t) return false; // a failed alloc (atlas full): callers skip and retry, never throw in the frame loop
    const s = scratchFor(t.w, t.h);
    s.g.setTransform(1, 0, 0, 1, 0, 0);
    s.g.clearRect(0, 0, t.w, t.h);
    s.g.save();
    fn(s.g, t.w, t.h);
    s.g.restore();
    mirror.clearRect(t.x, t.y, t.w, t.h);
    mirror.drawImage(s.canvas, t.x, t.y);
    uploads++;
    if (renderer && gpuReady && renderer.getContext && !renderer.getContext().isContextLost()) {
      const px = s.g.getImageData(0, 0, t.w, t.h).data, out = s.data;
      if (premultiply) {
        for (let i = 0; i < px.length; i += 4) {
          const a = px[i + 3] / 255;
          out[i] = px[i] * a; out[i + 1] = px[i + 1] * a; out[i + 2] = px[i + 2] * a; out[i + 3] = px[i + 3];
        }
      } else out.set(px);
      const pm = texture.premultiplyAlpha;
      texture.premultiplyAlpha = false; // already premultiplied in JS (UNPACK_PREMULTIPLY never applies to raw data)
      renderer.copyTextureToTexture(s.tex, texture, null, new THREE.Vector2(t.x, t.y));
      texture.premultiplyAlpha = pm;
    } else {
      texture.needsUpdate = true; // first upload (or no GL): the whole mirror goes up once
    }
    return true;
  }

  /** Call once per frame before tiles are drawn: the first full upload happens here. */
  function prepare() {
    if (gpuReady || !renderer) return;
    renderer.initTexture(texture);
    gpuReady = true;
  }

  // After a context restore three re-uploads the mirror lazily; copies must wait until it has.
  const onLost = () => { gpuReady = false; };
  renderer?.domElement?.addEventListener?.('webglcontextlost', onLost);

  return {
    texture, size, height, alloc, release, draw, prepare,
    stats: () => ({ ...packer.stats(), uploads }),
    dispose() { renderer?.domElement?.removeEventListener?.('webglcontextlost', onLost); texture.dispose(); },
  };
}

export type Atlas = ReturnType<typeof createAtlas>;
