/**
 * WebGL context loss (§5.1): on `webglcontextlost` (preventDefault) show a "Graphics reset, restoring…" banner and
 * skip post (never a dead frame); on `webglcontextrestored` rebuild composer passes/targets, re-upload the LUT and
 * canvas textures, and resume. `__hq.loseContext()` drives it through WEBGL_lose_context.
 * Owner: RND.
 */

import type * as THREE from 'three';

/** The slice of the post pipeline the loss handler flips. */
export interface ContextLossPost { lost: boolean }

export interface ContextLoss { isLost(): boolean; dispose(): void }

export function installContextLoss({ renderer, post, rebuild }: { renderer: THREE.WebGLRenderer; post: ContextLossPost; rebuild: () => void }): ContextLoss {
  const canvas = renderer.domElement;
  const banner = () => document.getElementById('hq-banner');
  let lost = false;
  const onLost = (e: Event) => {
    e.preventDefault();
    lost = true;
    post.lost = true;
    const b = banner();
    if (b) { b.textContent = 'Graphics reset, restoring…'; b.classList.add('show'); b.dataset.owner = 'rnd'; }
  };
  const onRestored = () => {
    lost = false;
    post.lost = false;
    try {
      rebuild();
      // three re-creates programs, render targets and texture uploads lazily after a restore; the composer passes
      // (depth texture, N8AO targets) are rebuilt explicitly
      renderer.shadowMap.needsUpdate = true;
    } catch (err) { console.error('[contextLoss] rebuild failed', err); }
    const b = banner();
    if (b && b.dataset.owner === 'rnd') { b.classList.remove('show'); b.textContent = ''; delete b.dataset.owner; }
  };
  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);
  return { isLost: () => lost, dispose() { canvas.removeEventListener('webglcontextlost', onLost); canvas.removeEventListener('webglcontextrestored', onRestored); } };
}
