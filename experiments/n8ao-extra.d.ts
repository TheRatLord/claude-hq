// The bench also drives n8ao's three.js-composer pass and quality presets, which renderer/src/stubs/n8ao.d.ts (only what
// render/post.ts touches) leaves out. Merged into that module declaration.
declare module 'n8ao' {
  import type { Pass as ThreePass } from 'three/examples/jsm/postprocessing/Pass.js';
  import type * as THREE from 'three';
  export type N8AOQuality = 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra';
  export interface N8AOPostPass { setQualityMode(mode: string): void }
  export class N8AOPass extends ThreePass {
    constructor(scene: THREE.Scene, camera: THREE.Camera, width?: number, height?: number);
    configuration: import('n8ao').N8AOConfiguration;
    setQualityMode(mode: string): void;
  }
}
