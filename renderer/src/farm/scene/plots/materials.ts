/**
 * Materials for fields: a toon material with wind sway, droop and "life" tints computed in the shader (so a whole
 * field breathes without touching instance matrices), and the sign atlas material (instanced text regions).
 */
import * as THREE from 'three';
import { toonRamp } from '../toon.ts';

export interface CropUniforms {
  uTime: { value: number };
  /** wind in world xz (m/s-ish, ~0..3) */
  uWind: { value: THREE.Vector2 };
  /** sway amount per metre² of height */
  uBend: { value: number };
  /** 0..1 tips hang down (resting) */
  uDroop: { value: number };
  /** 0..1 greens turn golden-dry */
  uDry: { value: number };
  /** 0..1 non-green colours turn unripe green */
  uGreen: { value: number };
  /** saturation multiplier (thriving > 1) */
  uSat: { value: number };
  /** 0..1 frost/snow on upward faces */
  uSnow: { value: number };
}

export function cropUniforms(bend = 0.12): CropUniforms {
  return {
    uTime: { value: 0 }, uWind: { value: new THREE.Vector2(0.8, 0.3) }, uBend: { value: bend }, uDroop: { value: 0 },
    uDry: { value: 0 }, uGreen: { value: 0 }, uSat: { value: 1 }, uSnow: { value: 0 },
  };
}

const VERT_HEAD = /* glsl */ `
uniform float uTime; uniform vec2 uWind; uniform float uBend; uniform float uDroop;
varying float vUp;
`;
const VERT_BODY = /* glsl */ `
#include <begin_vertex>
{
  float hgt = max(position.y, 0.0);
  float k = hgt * hgt * uBend;
  vec3 ip = vec3(0.0);
  mat3 im = mat3(1.0);
  #ifdef USE_INSTANCING
    ip = instanceMatrix[3].xyz;
    im = mat3(instanceMatrix);
  #endif
  vec3 wp = (modelMatrix * vec4(ip, 1.0)).xyz;
  mat3 toWorld = mat3(modelMatrix) * im;
  float sc2 = max(1e-4, dot(toWorld[0], toWorld[0]));
  float ph = uTime * 1.9 + wp.x * 0.31 + wp.z * 0.23;
  float gust = 0.55 + 0.45 * sin(uTime * 0.7 + wp.x * 0.05 - wp.z * 0.04);
  float s = sin(ph) * 0.55 + sin(ph * 2.37 + 1.3) * 0.2;
  vec3 ww = vec3(uWind.x * (0.6 + 0.4 * s) * gust + s * 0.25, 0.0, uWind.y * (0.6 + 0.4 * s) * gust + cos(ph * 1.3) * 0.18);
  vec3 wl = transpose(toWorld) * ww / sc2;
  transformed.xz += wl.xz * k;
  // droop: tips fall toward local +x and down
  float dk = hgt * hgt * uDroop * 0.35;
  transformed.x += dk;
  transformed.y -= dk * 0.6;
  vUp = normalize(toWorld * objectNormal).y;
}
`;
const FRAG_HEAD = /* glsl */ `
uniform float uDry; uniform float uGreen; uniform float uSat; uniform float uSnow;
varying float vUp;
`;
const FRAG_BODY = /* glsl */ `
#include <color_fragment>
{
  vec3 c = diffuseColor.rgb;
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  float green = clamp((c.g - max(c.r, c.b)) * 4.0, 0.0, 1.0);
  vec3 gold = vec3(luma) * vec3(1.55, 1.2, 0.55);
  c = mix(c, gold, green * uDry);
  c = mix(c, c * vec3(1.12, 0.96, 0.72), uDry * 0.6);
  vec3 unripe = vec3(luma) * vec3(0.85, 1.45, 0.55);
  c = mix(c, unripe, (1.0 - green) * uGreen);
  c = mix(vec3(luma), c, uSat);
  c = mix(c, vec3(0.93, 0.96, 1.0), smoothstep(0.55, 0.9, vUp) * uSnow);
  diffuseColor.rgb = c;
}
`;

/** Toon material with the crop shader; `u` is per material (one per field) but the program is shared. */
export function cropMaterial(u: CropUniforms, o: { side?: THREE.Side } = {}): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: toonRamp(), side: o.side ?? THREE.FrontSide });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = VERT_HEAD + sh.vertexShader.replace('#include <begin_vertex>', VERT_BODY);
    sh.fragmentShader = FRAG_HEAD + sh.fragmentShader.replace('#include <color_fragment>', FRAG_BODY);
  };
  m.customProgramCacheKey = () => 'plots-crop';
  m.userData.u = u;
  return m;
}

/** Depth material for shadows that sways with the crop (keeps shadow and mesh in sync). */
export function cropDepthMaterial(u: CropUniforms): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = VERT_HEAD + sh.vertexShader.replace('#include <begin_vertex>', `vec3 objectNormal = vec3(0.0, 1.0, 0.0);\n${VERT_BODY}`);
  };
  m.customProgramCacheKey = () => 'plots-crop-depth';
  return m;
}

/**
 * Instanced text material: each instance shows the atlas rect in attribute `aRect` (u0, v0, du, dv). The mesh is lit
 * like the rest of the world (toon) so signs sit in the scene, with a touch of emissive so text stays readable.
 */
export function atlasMaterial(tex: THREE.Texture): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ map: tex, gradientMap: toonRamp(), transparent: true, alphaTest: 0.5 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute vec4 aRect;\n' + sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
#if defined(USE_MAP) && defined(USE_INSTANCING)
  vMapUv = vMapUv * aRect.zw + aRect.xy;
#endif`);
  };
  m.customProgramCacheKey = () => 'plots-atlas';
  return m;
}
