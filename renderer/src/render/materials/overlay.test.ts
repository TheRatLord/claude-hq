// Screen FX must cover the post stack's world mask (alpha) so the edge / AO passes composite under them (RND fix r2:
// ink lines crossed bubbles and nameplates); contact-shadow blobs are floor and must keep it.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { blobMaterial, overlayMaterial } from './overlay.ts';

test('overlay alpha: FX quads cover the world mask, blobs keep it', () => {
  for (const kind of ['particle', 'sprite'] as const) {
    const m = overlayMaterial(new THREE.Color(1, 1, 1), {}, kind);
    assert.equal(m.blending, THREE.CustomBlending);
    assert.equal(m.blendSrcAlpha, THREE.ZeroFactor);
    assert.equal(m.blendDstAlpha, THREE.OneMinusSrcAlphaFactor, `${kind}: dstA' = dstA·(1 − srcA)`);
  }
  const b = blobMaterial(new THREE.Color(0, 0, 0));
  assert.equal(b.blendSrcAlpha, THREE.ZeroFactor);
  assert.equal(b.blendDstAlpha, THREE.OneFactor);
});
