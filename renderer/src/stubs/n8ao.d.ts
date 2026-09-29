// n8ao 2.0.1 ships no typings. Only what render/post.ts touches is declared (the pass, its live configuration proxy and
// the internals the AO-only mode rewires).
declare module 'n8ao' {
  import type * as THREE from 'three';
  import { Pass } from 'postprocessing';

  /** The pass's configuration proxy (assigning a colour / number triggers a shader rebuild inside n8ao). */
  export interface N8AOConfiguration {
    aoSamples: number;
    aoRadius: number;
    denoiseSamples: number;
    denoiseRadius: number;
    distanceFalloff: number;
    intensity: number;
    denoiseIterations: number;
    color: THREE.Color;
    gammaCorrection: boolean;
    screenSpaceRadius: boolean;
    halfRes: boolean;
    depthAwareUpsampling: boolean;
    transparencyAware: boolean;
    accumulate: boolean;
  }

  /** n8ao's internal full-screen triangle (its `render` is what the AO-only mode turns into a no-op). */
  export interface N8AOQuad {
    material: THREE.ShaderMaterial;
    render(renderer: THREE.WebGLRenderer): void;
  }

  export class N8AOPostPass extends Pass {
    constructor(scene: THREE.Scene, camera: THREE.Camera, width?: number, height?: number);
    configuration: N8AOConfiguration;
    /** N8AO re-renders the scene for transparent materials when it detects any */
    autoDetectTransparency: boolean;
    /** the blurred (half-res) AO lands here */
    writeTargetInternal: THREE.WebGLRenderTarget;
    accumulationRenderTarget: THREE.WebGLRenderTarget;
    accumulationQuad: N8AOQuad;
    effectCompositerQuad: N8AOQuad;
    copyQuad: N8AOQuad;
  }
}
