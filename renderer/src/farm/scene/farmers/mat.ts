/**
 * Materials for the instanced mascot rig:
 *  - rigMaterial: toon + per-instance palette (slots A..C) + variant masking (glyphs, hats, props share a mesh) +
 *    jiggle (a height shear for follow-through and a lobe wobble for the Codex cloud / scarf tails)
 *  - rigDepthMaterial: the same masking and shear for the shadow pass
 *  - billboardMaterial: camera-facing atlas sprites (emotes, "!" beacons) as one instanced draw
 *  - particleMaterial: round soft points (droplets, confetti, dust, sparkles)
 */
import * as THREE from 'three';
import { toonRamp } from '../toon.ts';

const RIG_VERT_HEAD = /* glsl */ `
attribute vec3 vinfo; // slot, vgroup, wob
attribute vec3 iA;
attribute vec3 iB;
attribute vec3 iC;
attribute vec4 iSel;
attribute vec4 iJig;
`;
const MASK = /* glsl */ `
  float vgroup = vinfo.y, wob = vinfo.z;
  if (vgroup > 0.5 && abs(vgroup - iSel.x) > 0.5 && abs(vgroup - iSel.y) > 0.5 && abs(vgroup - iSel.z) > 0.5 && abs(vgroup - iSel.w) > 0.5) transformed = vec3(0.0);
  // follow-through: the top lags behind (shear by height), lobes and tails wobble
  transformed.x += iJig.x * position.y;
  transformed.z += iJig.y * position.y;
  float wph = iJig.w + position.x * 11.0 + position.y * 7.0;
  transformed.xy += wob * iJig.z * vec2(sin(wph) * 0.6, cos(wph * 1.3));
`;

let rigMat: THREE.MeshToonMaterial | null = null;
export function rigMaterial(): THREE.MeshToonMaterial {
  if (rigMat) return rigMat;
  const m = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: toonRamp() });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = RIG_VERT_HEAD + sh.vertexShader
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${MASK}`)
      .replace('#include <color_vertex>', `#include <color_vertex>
#ifdef USE_COLOR
  if (vinfo.x > 0.5) {
    vec3 pc = vinfo.x < 1.5 ? iA : vinfo.x < 2.5 ? iB : iC;
    vColor.rgb = pc * color.rgb;
  }
#endif`);
  };
  m.customProgramCacheKey = () => 'mascot-rig';
  rigMat = m;
  return m;
}

let rigDepth: THREE.MeshDepthMaterial | null = null;
export function rigDepthMaterial(): THREE.MeshDepthMaterial {
  if (rigDepth) return rigDepth;
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute vec3 vinfo;\nattribute vec4 iSel;\nattribute vec4 iJig;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n${MASK}`);
  };
  m.customProgramCacheKey = () => 'mascot-rig-depth';
  rigDepth = m;
  return m;
}

export const INSTANCE_ATTRS = { iA: 3, iB: 3, iC: 3, iSel: 4, iJig: 4 } as const;
export type InstanceAttr = keyof typeof INSTANCE_ATTRS;

/** Add the per-instance palette / selection / jiggle attributes to a geometry used by an InstancedMesh of `n`. */
export function addInstanceAttrs(g: THREE.BufferGeometry, n: number): void {
  for (const [k, size] of Object.entries(INSTANCE_ATTRS)) {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(n * size).fill(k.startsWith('i') && size === 3 ? 1 : 0), size);
    a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute(k, a);
  }
}

export const EMOTE_COLS = 8, EMOTE_ROWS = 4;
/**
 * Instanced billboards: attributes iPos (vec3 world, the sprite's bottom-centre), iSize (world metres), iCell,
 * iAlpha, iGlow (colour multiplier > 1 blooms), iRot. Geometry: a unit quad from y=0..1.
 */
export function billboardMaterial(atlas: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uMap: { value: atlas } },
    vertexShader: /* glsl */ `
      attribute vec3 iPos; attribute float iSize; attribute float iCell; attribute float iAlpha; attribute float iGlow; attribute float iRot;
      varying vec2 vUv; varying float vAlpha; varying float vGlow;
      void main() {
        float c = mod(iCell, ${EMOTE_COLS}.0), r = floor(iCell / ${EMOTE_COLS}.0);
        vUv = (uv + vec2(c, ${EMOTE_ROWS - 1}.0 - r)) / vec2(${EMOTE_COLS}.0, ${EMOTE_ROWS}.0);
        vAlpha = iAlpha; vGlow = iGlow;
        vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
        vec2 p = position.xy; float cs = cos(iRot), sn = sin(iRot);
        p = vec2(p.x * cs - p.y * sn, p.x * sn + p.y * cs);
        mv.xy += p * iSize;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; varying vec2 vUv; varying float vAlpha; varying float vGlow;
      void main() {
        vec4 t = texture2D(uMap, vUv);
        float a = t.a * vAlpha;
        if (a < 0.02) discard;
        gl_FragColor = vec4(t.rgb * vGlow, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false,
  });
}

/** Points with per-particle colour, size (metres) and alpha; round with a soft edge. */
export function particleMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 500 } },
    vertexShader: /* glsl */ `
      attribute float size; attribute float alpha; attribute vec3 pcolor;
      uniform float uScale; varying vec3 vC; varying float vA;
      void main() {
        vC = pcolor; vA = alpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * uScale / max(0.1, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vC; varying float vA;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r = length(d);
        if (r > 0.5 || vA < 0.01) discard;
        gl_FragColor = vec4(vC, vA * smoothstep(0.5, 0.35, r));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false,
  });
}

/** A soft vertical light column above a farmer who needs you (additive, visible across the valley). */
export function beaconMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(1.0, 0.8, 0.25) } },
    vertexShader: /* glsl */ `
      attribute float iAlpha; varying float vA; varying vec2 vUv; varying float vFacing;
      void main() {
        vUv = uv; vA = iAlpha;
        vec4 wp = instanceMatrix * vec4(position, 1.0);
        vec3 n = normalize(mat3(modelViewMatrix) * mat3(instanceMatrix) * normal);
        vFacing = abs(n.z);
        gl_Position = projectionMatrix * modelViewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uColor; varying float vA; varying vec2 vUv; varying float vFacing;
      void main() {
        float fade = (1.0 - vUv.y) * (1.0 - vUv.y) * smoothstep(0.0, 0.08, vUv.y);
        float band = 0.75 + 0.25 * sin(vUv.y * 30.0 - uTime * 4.0);
        float a = vA * fade * band * pow(vFacing, 1.5) * 0.55;
        if (a < 0.003) discard;
        gl_FragColor = vec4(uColor * 1.6, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}
