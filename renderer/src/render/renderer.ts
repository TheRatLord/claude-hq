/**
 * WebGLRenderer with the §5.1 fixed settings: no MSAA (SMAA in post), no stencil, opaque canvas, high-performance
 * GPU, sRGB output, NoToneMapping (the composer tone-maps with NEUTRAL). DPR clamped to 1 (1.5 on High) × the
 * quality render scale.
 * Owner: RND.
 */
import * as THREE from 'three';

export interface RendererHandle {
  renderer: THREE.WebGLRenderer;
  /** CSS px + quality render scale */
  resize(w: number, h: number, renderScale?: number, tier?: string): void;
  dispose(): void;
}

export function createRenderer(canvas: HTMLCanvasElement, { renderScale = 1 }: { renderScale?: number } = {}): RendererHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, alpha: false, depth: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.info.autoReset = false; // post.ts resets once per frame so drawCalls counts every pass
  let tierDpr = 1;
  const resize = (w: number, h: number, scale = renderScale, tier?: string) => {
    if (tier) tierDpr = tier === 'high' || tier === 'photo' ? 1.5 : 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tierDpr) * scale);
    renderer.setSize(w, h, false);
  };
  resize(canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight, renderScale);
  return { renderer, resize, dispose: () => renderer.dispose() };
}
