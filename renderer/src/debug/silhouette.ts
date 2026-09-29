/**
 * Silhouette-check render (`?silhouette=1`, DESIGN §9.1 params; ART §11 checklist item 2, ART §5.1 rules): the same
 * office frame with every character part forced to flat ink on paper, so poses (typing / waving / jumping / sleeping)
 * and Clawd vs Shelly must read from shape alone. The world is drawn in paper first, so it still occludes characters
 * exactly as in the normal frame (desks hide legs), but contributes no shape of its own. Hulls, blobs, bubbles and
 * glints are left out (the sheet's silhouette view does the same). No post and no shadow render: the plain frame goes
 * straight to the canvas.
 * Owner: RND.
 */
import * as THREE from 'three';
import { CORE } from '../../../shared/palette.ts';
import { MASK } from '../render/layers.ts';

/** One flat colour: three still multiplies instanceColor / vertex colours into an override, so drop that term. */
function flat(hex: THREE.ColorRepresentation): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color: hex });
  m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', ''); };
  m.customProgramCacheKey = () => 'hq|silhouette';
  return m;
}

export function createSilhouette({ renderer, scene, camera }: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera }): { render: () => void; dispose: () => void } {
  const paper = flat(CORE.cream);
  const ink = flat(CORE.ink);
  const bg = new THREE.Color(CORE.cream);
  return {
    render() {
      const mask = camera.layers.mask, background = scene.background, auto = renderer.autoClear, override = scene.overrideMaterial;
      scene.background = bg;
      renderer.setRenderTarget(null);
      try {
        camera.layers.mask = MASK.world;
        scene.overrideMaterial = paper;
        renderer.render(scene, camera);
        renderer.autoClear = false;
        scene.background = null;
        camera.layers.mask = MASK.chars;
        scene.overrideMaterial = ink;
        renderer.render(scene, camera);
      } finally {
        camera.layers.mask = mask; scene.background = background; scene.overrideMaterial = override;
        renderer.autoClear = auto;
      }
    },
    dispose() { paper.dispose(); ink.dispose(); },
  };
}
