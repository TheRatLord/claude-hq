/**
 * Atmosphere assets for the gallery: a cloud cluster (the same puff layout the sky system instances) and a lightning
 * bolt-free storm cloud variant. The sky dome, sun, moon and stars are shaders on the dome and are not assets.
 * Registered by side-effect import (the lead adds `import './sky/assets.ts'` to scene/assetIndex.ts).
 */
import * as THREE from 'three';
import { defineAsset } from '../assets.ts';
import { cloudPuffs, puffGeometry } from './clouds.ts';
import { toon } from '../toon.ts';

defineAsset({
  name: 'cloud',
  group: 'fx',
  note: 'a drifting low-poly cloud: faceted puffs, flat bottom (the sky instances ~60 of these around the camera)',
  variants: ['fair', 'grey', 'storm'],
  param: 'breathe',
  build(o) {
    const g = new THREE.Group();
    const color = o.variant === 'storm' ? 0x6d7480 : o.variant === 'grey' ? 0xb8bec6 : 0xf8f9fc;
    const mat = toon(color);
    const geo = puffGeometry();
    const puffs = cloudPuffs(o.seed || 1);
    const k = 0.1; // gallery scale: metres → a ~5 m model
    for (const p of puffs) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(p.x * k, Math.max(p.y * k, p.r * k * 0.5), p.z * k);
      m.scale.set(p.r * k, p.r * k * 0.78, p.r * k);
      g.add(m);
    }
    return g;
  },
  animate(obj, t, _dt, param) {
    const s = 1 + Math.sin(t * 0.8) * 0.04 * param;
    obj.scale.setScalar(s);
    obj.position.x = Math.sin(t * 0.3) * 0.3;
  },
});
