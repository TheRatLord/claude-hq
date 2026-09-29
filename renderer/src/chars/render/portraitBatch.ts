/**
 * portraitBatch (DESIGN §5.4 Portraits, M3.5 roster / hotbar / status card): renders posed per-agent portrait rigs into
 * one small atlas render target with ONE `renderer.render` per refresh, then reads it back asynchronously.
 *
 * - A dedicated charBatch in `portrait` mode (own count-N InstancedMeshes, shared geometries + materials: no new
 *   programs) over its own scene flagged `userData.hqPortrait` (drawSplit counts its draws as `portrait`, §5.3).
 * - Tiles live far below the world (y −500, outside the 24 m shadow box, so the reused shadow map reads "lit"): tile
 *   (c, r) is a TILE_M-metre square facing +z; an orthographic camera looks at the whole grid, so every dirty tile is
 *   drawn in the same render (≈ 25 draws, one per part type in use). Clean tiles are neither drawn nor cleared.
 * - Lighting = the world's studio key, borrowed for the render (re-parented into the portrait scene and back), so the
 *   light count, shadow flags and output colour space (linear, render target) match the world's CharPass: the toon /
 *   hull / sprite programs are reused as-is. The shadow map is not re-rendered (autoUpdate off for the call).
 * - The RT is RGBA8 linear; the readback converts to sRGB with a soft shoulder and cuts the background (the clear colour
 *   is a sentinel) to transparent. Output: an `ImageData`-shaped {data, width, height} of the whole atlas.
 * Owner: CHR.
 */
import * as THREE from 'three';
import { createCharBatch, type CharBatch, type CharHandle } from './charBatch.ts';
import type { Rig } from '../rig/clawd.ts';
import { U } from '../../render/uniforms.ts';

/** Metres of world per tile (a Clawd's body + accessory, legs cropped) and the tile's centre above the rig root. */
export const TILE_M = 0.92, TILE_CY = 0.52, TILE_CY_SHELLY = 0.42;
const BASE_Y = -500;
/** Background sentinel (linear, exact in 8 bits): cut to alpha 0 on readback. */
const BG = [1, 0, 1];

/** Linear 8-bit → sRGB 8-bit with a soft shoulder (the composer's NEUTRAL tone map is not in this path). */
const LUT = new Uint8ClampedArray(256);
for (let i = 0; i < 256; i++) {
  let v = i / 255;
  v = v < 0.8 ? v : 0.8 + (1 - Math.exp(-(v - 0.8) * 3)) * 0.2 / (1 - Math.exp(-0.6)); // shoulder above 0.8
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  LUT[i] = Math.round(Math.min(1, s) * 255);
}

export interface PortraitBatchOptions {
  renderer: THREE.WebGLRenderer;
  key: THREE.DirectionalLight | null;
  tile?: number;
  cols?: number;
  rows?: number;
}

/** One tile to render: its atlas slot and the registered rig (every other registered rig must be hidden by the caller). */
export interface PortraitItem { slot: number; rig: Rig; handle: CharHandle }

/** The converted atlas: ImageData-shaped, the same object every time. */
export interface AtlasImage { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number }

export interface PortraitBatch {
  batch: CharBatch;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  rt: THREE.WebGLRenderTarget;
  tile: number;
  cols: number;
  rows: number;
  width: number;
  height: number;
  readonly busy: boolean;
  render(items: PortraitItem[]): Promise<AtlasImage | null>;
  dispose(): void;
}

export function createPortraitBatch({ renderer, key, tile = 64, cols = 8, rows = 8 }: PortraitBatchOptions): PortraitBatch {
  const W = cols * tile, H = rows * tile;
  const scene = new THREE.Scene();
  scene.userData.hqPortrait = true; // §5.3 draw split: `portrait` bucket
  scene.name = 'portraits';
  const camera = new THREE.OrthographicCamera(0, cols * TILE_M, 0, -rows * TILE_M, 0.1, 40);
  // left/right/top/bottom are relative to the camera: put it at the grid's top-left corner, looking −z
  camera.position.set(-TILE_M / 2, BASE_Y + TILE_M / 2, 12);
  camera.layers.enableAll();
  camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  const batch = createCharBatch({ scene, camera, portrait: true, viewportHeight: () => H });
  const rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true, stencilBuffer: false, type: THREE.UnsignedByteType, format: THREE.RGBAFormat, generateMipmaps: false });
  rt.texture.name = 'hq:portraitAtlas';
  const buf = new Uint8Array(W * H * 4);
  const out: AtlasImage = { data: new Uint8ClampedArray(W * H * 4), width: W, height: H };
  const clear = new THREE.Color(), resSave = new THREE.Vector2();
  let busy = false;

  /** World position of tile i's rig root. */
  const tilePos = (i: number) => ({ x: (i % cols) * TILE_M, y: BASE_Y - Math.floor(i / cols) * TILE_M - TILE_CY, z: 0 });

  /**
   * Render the given tiles and read the atlas back. Resolves with the converted atlas (the same object every time) or
   * null if a readback is in flight.
   */
  async function render(items: PortraitItem[]): Promise<AtlasImage | null> {
    if (busy || !items.length) return null;
    busy = true;
    try {
      for (const it of items) {
        const p = tilePos(it.slot);
        it.rig.root.position.set(p.x, p.y + (it.rig.species === 'shelly' ? TILE_CY - TILE_CY_SHELLY : 0), p.z);
      }
      batch.write();
      // borrow the studio key + match the hull shader's pixel maths to the atlas
      const keyParent = key?.parent ?? null;
      if (key) scene.add(key);
      resSave.copy(U.uResolution.value); U.uResolution.value.set(W, H);
      const sm = renderer.shadowMap, smAuto = sm.autoUpdate, smNeeds = sm.needsUpdate;
      sm.autoUpdate = false; sm.needsUpdate = false;
      const prevRT = renderer.getRenderTarget(), prevAuto = renderer.autoClear, prevAlpha = renderer.getClearAlpha();
      renderer.getClearColor(clear);
      const prevScissor = renderer.getScissorTest();
      try {
        renderer.setRenderTarget(rt);
        renderer.autoClear = false;
        renderer.setClearColor(new THREE.Color().setRGB(BG[0], BG[1], BG[2], THREE.LinearSRGBColorSpace), 1);
        renderer.setScissorTest(true);
        for (const it of items) {
          const c = it.slot % cols, r = Math.floor(it.slot / cols);
          renderer.setScissor(c * tile, H - (r + 1) * tile, tile, tile); // scissor origin is bottom-left
          renderer.clear(true, true, false);
        }
        renderer.setScissorTest(false);
        renderer.render(scene, camera);
      } finally {
        renderer.setScissorTest(prevScissor);
        renderer.setRenderTarget(prevRT);
        renderer.autoClear = prevAuto;
        renderer.setClearColor(clear, prevAlpha);
        sm.autoUpdate = smAuto; sm.needsUpdate = smNeeds;
        U.uResolution.value.copy(resSave);
        if (key && keyParent) keyParent.add(key);
      }
      await renderer.readRenderTargetPixelsAsync(rt, 0, 0, W, H, buf);
      convert();
      return out;
    } finally { busy = false; }
  }

  /** GL rows are bottom-up; flip, sRGB-encode, cut the sentinel background to transparent. */
  function convert(): void {
    const d = out.data;
    for (let y = 0; y < H; y++) {
      const src = (H - 1 - y) * W * 4, dst = y * W * 4;
      for (let x = 0; x < W * 4; x += 4) {
        const r = buf[src + x], g = buf[src + x + 1], b = buf[src + x + 2];
        if (r === 255 && g === 0 && b === 255) { d[dst + x + 3] = 0; continue; }
        d[dst + x] = LUT[r]; d[dst + x + 1] = LUT[g]; d[dst + x + 2] = LUT[b]; d[dst + x + 3] = 255;
      }
    }
  }

  return {
    batch, scene, camera, rt, tile, cols, rows, width: W, height: H,
    get busy() { return busy; },
    render,
    dispose() { batch.dispose(); rt.dispose(); },
  };
}
