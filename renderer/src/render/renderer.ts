/** Standalone opaque Three renderer with sRGB output and neutral tone mapping. */
import * as THREE from 'three';

export interface RendererHandle {
  renderer: THREE.WebGLRenderer;
  /** CSS dimensions, with an optional resolution scale. */
  resize(w: number, h: number, renderScale?: number): void;
  dispose(): void;
}

/** `antialias: false` when the canvas only receives a full-screen post pass (MSAA there costs bandwidth, buys nothing). */
export function createRenderer(canvas: HTMLCanvasElement, { renderScale = 1, antialias = true }: { renderScale?: number; antialias?: boolean } = {}): RendererHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias, stencil: false, alpha: false, depth: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.info.autoReset = true;
  const resize = (w: number, h: number, scale = renderScale) => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1) * scale);
    renderer.setSize(w, h, false);
  };
  resize(canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight, renderScale);
  return { renderer, resize, dispose: () => renderer.dispose() };
}
