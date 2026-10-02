/**
 * The farmhouse photo wall (docs/valley/album.md): the album's favourites (service 'album', `AlbumWallSource`:
 * farm/albumstore.ts) in the eight frames over the bed (frames: room.ts, slots: layout.ts `photoWallSlots`).
 *
 * One mesh, one draw call: a quad per frame into a single 1024×512 atlas canvas (8 cells of 256²). Each photo is
 * drawn into its cell cropped to its frame's shape (cover); an empty frame shows a pencilled hint. The atlas is
 * redrawn only when the wall's picks change (`wallVersion`); decoded bitmaps are closed right after drawing, and the
 * texture, geometry and material go with `dispose()`.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AlbumWallSource } from '../context.ts';
import { toonRamp } from '../toon.ts';
import { HAND, canvasTex } from '../structures/kit.ts';
import { PHOTO_WALL, photoWallSlots } from './layout.ts';
import type { WallFrame } from './layout.ts';

const AW = 1024, AH = 512, CELL = 256;

export interface PhotoWall {
  mesh: THREE.Mesh;
  /** the frames (room-local), in hanging order */
  readonly slots: readonly WallFrame[];
  /** which photo hangs in slot i (null: empty) */
  idAt(i: number): string | null;
  captionAt(i: number): string;
  /** call every frame while inside: refreshes the atlas when the favourites changed */
  update(src: AlbumWallSource | undefined): void;
  dispose(): void;
}

export function buildPhotoWall(): PhotoWall {
  const slots = photoWallSlots();
  const atlas = canvasTex(AW, AH);
  const g = atlas.g;
  // each slot's cell: the frame's aspect fitted into 256², centred
  const cells = slots.map((f, i) => {
    const cx = (i % 4) * CELL, cy = Math.floor(i / 4) * CELL;
    const k = Math.min((CELL - 8) / f.w, (CELL - 8) / f.h);
    const w = Math.round(f.w * k), h = Math.round(f.h * k);
    return { x: cx + Math.round((CELL - w) / 2), y: cy + Math.round((CELL - h) / 2), w, h };
  });
  const quads = slots.map((f, i) => {
    const geo = new THREE.PlaneGeometry(f.w, f.h);
    const c = cells[i], uv = geo.attributes.uv;
    for (let j = 0; j < uv.count; j++) uv.setXY(j, (c.x + uv.getX(j) * c.w) / AW, 1 - (c.y + (1 - uv.getY(j)) * c.h) / AH);
    geo.translate(f.x, f.y, PHOTO_WALL.z + 0.0215);
    return geo;
  });
  const geo = mergeGeometries(quads)!;
  for (const q of quads) q.dispose();
  // lit like the room, plus a little of their own light so the prints read on a dim wall (paper under glass)
  const mat = new THREE.MeshToonMaterial({ map: atlas.tex, gradientMap: toonRamp(), emissive: 0xffffff, emissiveMap: atlas.tex, emissiveIntensity: 0.42 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'interior:photowall';
  mesh.receiveShadow = true;

  let version = -1, token = 0;
  let hung: { id: string; caption: string }[] = [];

  function placeholder(i: number): void {
    const c = cells[i];
    g.save();
    g.fillStyle = '#efe4c8'; g.fillRect(c.x, c.y, c.w, c.h);
    g.strokeStyle = 'rgba(110,90,60,0.45)'; g.lineWidth = 3; g.lineJoin = 'round';
    // a pencilled camera
    const s = Math.min(c.w, c.h) * 0.36, mx = c.x + c.w / 2, my = c.y + c.h / 2 - s * 0.15;
    g.strokeRect(mx - s / 2, my - s * 0.3, s, s * 0.62);
    g.beginPath(); g.arc(mx, my, s * 0.2, 0, Math.PI * 2); g.stroke();
    g.strokeRect(mx - s * 0.18, my - s * 0.42, s * 0.36, s * 0.12);
    g.fillStyle = 'rgba(110,90,60,0.6)'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `italic ${Math.round(Math.min(c.w, c.h) * 0.11)}px ${HAND}`;
    g.fillText('your photo ♡', mx, my + s * 0.62);
    g.restore();
  }
  function drawCover(i: number, img: CanvasImageSource & { width: number; height: number }): void {
    const c = cells[i];
    const k = Math.max(c.w / img.width, c.h / img.height);
    const sw = c.w / k, sh = c.h / k;
    g.save();
    g.beginPath(); g.rect(c.x, c.y, c.w, c.h); g.clip();
    g.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, c.x, c.y, c.w, c.h);
    // a little sheen and an inner shadow under the glass
    const gr = g.createLinearGradient(c.x, c.y, c.x + c.w, c.y + c.h);
    gr.addColorStop(0, 'rgba(255,255,255,0.10)'); gr.addColorStop(0.45, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.08)');
    g.fillStyle = gr; g.fillRect(c.x, c.y, c.w, c.h);
    g.strokeStyle = 'rgba(40,25,10,0.25)'; g.lineWidth = 4; g.strokeRect(c.x + 2, c.y + 2, c.w - 4, c.h - 4);
    g.restore();
  }

  async function refill(src: AlbumWallSource): Promise<void> {
    const my = ++token;
    const items = src.wall(slots.length);
    hung = items.map((x) => ({ id: x.id, caption: x.caption }));
    g.fillStyle = '#efe4c8'; g.fillRect(0, 0, AW, AH);
    for (let i = 0; i < slots.length; i++) placeholder(i);
    atlas.tex.needsUpdate = true;
    for (let i = 0; i < items.length; i++) {
      const b = items[i].thumb;
      if (!b) continue;
      let bmp: ImageBitmap | null = null;
      try {
        bmp = await createImageBitmap(b);
        if (my !== token) return;      // the wall changed again meanwhile (or was disposed)
        drawCover(i, bmp);
        atlas.tex.needsUpdate = true;
      } catch (e) { console.warn('[photowall] could not decode a photo', e); }
      finally { bmp?.close(); }
    }
  }

  for (let i = 0; i < slots.length; i++) placeholder(i);
  atlas.tex.needsUpdate = true;

  return {
    mesh, slots,
    idAt: (i) => hung[i]?.id ?? null,
    captionAt: (i) => hung[i]?.caption ?? '',
    update(src) {
      if (!src || src.wallVersion === version) return;
      version = src.wallVersion;
      void refill(src);
    },
    dispose() {
      token++;
      geo.dispose();
      mat.dispose();
      atlas.tex.dispose();
      atlas.canvas.width = atlas.canvas.height = 1;
    },
  };
}
