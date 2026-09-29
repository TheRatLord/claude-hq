/**
 * Inverted-hull outline (§5.1, ART §4.1): back faces extruded along the clip-space normal by a distance-scaled pixel
 * width `clamp(mix(3.2, 1.2, (d − 1.5)/16.5), 1.2, 3.2)` × `uHullScale`. depthWrite false, depthTest true, alpha 0
 * (character mask), never a shadow caster. Drawn after all character parts in CharPass.
 * Owner: RND.
 */
import * as THREE from 'three';
import { U, type UniformMap } from '../uniforms.ts';
import type { MaterialOpts } from './index.ts';

export function hullMaterial(color: THREE.Color, opts: Pick<MaterialOpts, 'uniforms'> = {}): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, depthWrite: false });
  const local: UniformMap = { uHullScale: { value: 1 }, ...opts.uniforms };
  m.userData.uniforms = local;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uResolution: U.uResolution, ...local });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uResolution;\nuniform float uHullScale;')
      .replace('#include <project_vertex>', `#include <project_vertex>
  {
    vec3 hqN = normal;
    #ifdef USE_INSTANCING
      hqN = mat3( instanceMatrix ) * hqN;
    #endif
    vec3 nView = normalize( normalMatrix * hqN );
    vec2 nClip = ( projectionMatrix * vec4( nView, 0.0 ) ).xy;
    float d = max( -mvPosition.z, 0.05 );
    float px = clamp( mix( 3.2, 1.2, ( d - 1.5 ) / 16.5 ), 1.2, 3.2 ) * uHullScale;
    float l = length( nClip );
    if ( l > 1e-5 ) gl_Position.xy += nClip / l * px * 2.0 / uResolution * gl_Position.w;
  }`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.a = 0.0;');
  };
  return m;
}
