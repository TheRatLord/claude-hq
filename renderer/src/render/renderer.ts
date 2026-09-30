/** Standalone opaque Three renderer with sRGB output and neutral tone mapping. */
import * as THREE from 'three';

export interface RendererHandle {
  renderer: THREE.WebGLRenderer;
  /** CSS dimensions, with an optional resolution scale. */
  resize(w: number, h: number, renderScale?: number): void;
  dispose(): void;
}

export function createRenderer(canvas: HTMLCanvasElement, { renderScale = 1 }: { renderScale?: number } = {}): RendererHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: false, alpha: false, depth: true, powerPreference: 'high-performance' });
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
