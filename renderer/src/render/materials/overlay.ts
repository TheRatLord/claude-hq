/**
 * Overlay materials drawn in CharPass after hulls (§5.1): blob contact shadows, particles, sprites. Transparent,
 * depth-tested, no depth write.
 * Alpha channel = the post stack's "world" mask (1 world, 0 characters). Blobs keep it (`blendDstAlpha = One`): a
 * contact shadow is floor, it still takes AO and edge lines. Screen-space FX (bubbles, nameplates, glyphs, rings,
 * confetti) *cover* it: `dstA' = dstA·(1 − srcA)`, so the edge pass and the AO apply, which both scale by that mask,
 * fade out under the paper exactly as if the FX were composited after them (edge lines never cross a bubble). Over
 * characters the mask is already 0 and stays 0.
 * Owner: RND.
 */
import * as THREE from 'three';
import { U, type UniformMap } from '../uniforms.ts';
import { WHITE } from './screen.ts';
import type { MaterialOpts } from './index.ts';

const keepAlpha = { blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor };
const coverAlpha = { ...keepAlpha, blendDstAlpha: THREE.OneMinusSrcAlphaFactor };

/** Radial contact shadow on a unit plane (uv 0..1): ink at α 0.28 (ART §3.1). Instanced-friendly. */
export function blobMaterial(color: THREE.Color, opts: MaterialOpts = {}): THREE.ShaderMaterial {
  const local: UniformMap = { uColor: { value: color.clone() }, uAlpha: { value: opts.alpha ?? 0.28 }, ...opts.uniforms };
  const m = new THREE.ShaderMaterial({
    uniforms: local,
    vertexShader: /* glsl */ `
      #include <common>
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 transformed = position;
        #include <project_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uAlpha; varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float a = uAlpha * smoothstep(1.0, 0.25, d);
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true, depthWrite: false, ...keepAlpha,
  });
  m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
  m.userData.uniforms = local;
  return m;
}

/** Particles (confetti 1.2 emissive) / sprites (paper bubbles). `emissiveIntensity` > 1 is scaled by uEmissiveGain. */
export function overlayMaterial(color: THREE.Color, opts: MaterialOpts = {}, kind: 'particle' | 'sprite'): THREE.MeshBasicMaterial {
  // forceSinglePass: a transparent DoubleSide material otherwise draws back faces then front faces (2 draws and a
  // second, flipSided program per material)
  const m = new THREE.MeshBasicMaterial({ color, map: WHITE, vertexColors: !!opts.vertexColors, transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, ...coverAlpha });
  const local: UniformMap = { uIntensity: { value: opts.emissiveIntensity ?? (kind === 'particle' ? 1.2 : 1) }, ...opts.uniforms };
  m.userData.uniforms = local;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uEmissiveGain: U.uEmissiveGain, ...local });
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uIntensity; uniform float uEmissiveGain;')
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.rgb *= mix( min( uIntensity, 1.0 ), uIntensity, uEmissiveGain );');
  };
  return m;
}
