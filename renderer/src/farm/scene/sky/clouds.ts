/**
 * Stylised low-poly clouds: puffy clusters of faceted blobs with flat bottoms, one instanced draw. Clouds drift with
 * the wind and wrap around the camera; cover (0..1) decides how many show (each cloud grows / shrinks in smoothly).
 * Lit with a two-tone toon ramp from the sun, a cool underside, a silver rim toward the sun, and fade into the horizon.
 */
import * as THREE from 'three';
import { mulberry32, hash32 } from '../../../../../shared/identity.ts';

export const CLOUD_COUNT = 60;
export const CLOUD_RANGE = 560;

const vert = /* glsl */`
attribute vec4 aCloud; // centre x, z, base height, reveal threshold
attribute float aPuff;  // 0..1 position of this puff within its cloud (for staggered grow)
uniform vec2 uDrift;
uniform vec3 uCam;
uniform float uCover, uRange, uTime;
varying vec3 vN;
varying vec3 vW;
varying float vBottom;
varying float vFade;
void main() {
  vec2 c = aCloud.xy + uDrift;
  c = mod(c - uCam.xz + uRange, 2.0 * uRange) - uRange + uCam.xz;
  float edge = length(c - uCam.xz) / uRange;
  // reveal: clouds with a lower threshold appear first; puffs of one cloud bloom in sequence
  float show = smoothstep(aCloud.w - 0.06, aCloud.w + 0.06 + aPuff * 0.05, uCover);
  show *= 1.0 - smoothstep(0.82, 0.98, edge);
  vec3 local = (instanceMatrix * vec4(position, 1.0)).xyz;
  vec3 pc = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  // gentle breathing
  local = pc + (local - pc) * (0.94 + 0.06 * sin(uTime * 0.23 + aCloud.w * 40.0 + aPuff * 5.0));
  vec3 w = vec3(c.x, aCloud.z, c.y) + local * show;
  float base = aCloud.z - 2.5 * show;
  vBottom = 1.0 - smoothstep(base, base + 6.0, w.y);
  w.y = max(w.y, base); // flat bottoms
  vN = normalize(mat3(instanceMatrix) * normal);
  vW = w;
  vFade = show;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const frag = /* glsl */`
uniform vec3 uSunDir, uLit, uShade, uHorizon, uRim, uCam;
uniform float uFlash;
varying vec3 vN;
varying vec3 vW;
varying float vBottom;
varying float vFade;
void main() {
  if (vFade < 0.02) discard;
  vec3 n = normalize(vN);
  float ndl = dot(n, uSunDir);
  float band = smoothstep(-0.05, 0.05, ndl) * 0.55 + smoothstep(0.45, 0.55, ndl) * 0.45;
  vec3 col = mix(uShade, uLit, band);
  col = mix(col, uShade * 0.85, vBottom * 0.6);
  vec3 v = normalize(vW - uCam);
  float rim = pow(1.0 - abs(dot(n, v)), 3.0) * pow(max(dot(v, uSunDir), 0.0), 2.0);
  col += uRim * rim * 1.4;
  col += vec3(0.8, 0.85, 1.0) * uFlash * 0.6;
  float dist = length(vW.xz - uCam.xz);
  col = mix(col, uHorizon, smoothstep(220.0, 560.0, dist) * 0.8);
  gl_FragColor = vec4(col, 1.0);
}`;

export interface Clouds {
  mesh: THREE.InstancedMesh;
  u: {
    uDrift: { value: THREE.Vector2 }; uCam: { value: THREE.Vector3 }; uCover: { value: number }; uRange: { value: number }; uTime: { value: number };
    uSunDir: { value: THREE.Vector3 }; uLit: { value: THREE.Color }; uShade: { value: THREE.Color }; uHorizon: { value: THREE.Color };
    uRim: { value: THREE.Color }; uFlash: { value: number };
  };
}

/** a single cloud's puffs (offsets relative to its centre, radii), deterministic by seed */
export function cloudPuffs(seed: number): { x: number; y: number; z: number; r: number }[] {
  const r = mulberry32(seed);
  const len = 26 + r() * 40, wid = 14 + r() * 14;
  const n = 5 + Math.floor(r() * 5);
  const puffs: { x: number; y: number; z: number; r: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const along = (t - 0.5) * len;
    const mid = 1 - Math.abs(t - 0.5) * 2; // bigger in the middle
    const rad = 7 + mid * 8 + r() * 4;
    puffs.push({ x: along + (r() - 0.5) * 6, y: rad * 0.35 + mid * 4 + r() * 2, z: (r() - 0.5) * wid * 0.6, r: rad });
  }
  // a couple of top puffs for the cauliflower look
  const tops = 1 + Math.floor(r() * 3);
  for (let i = 0; i < tops; i++) puffs.push({ x: (r() - 0.5) * len * 0.5, y: 10 + r() * 6, z: (r() - 0.5) * wid * 0.3, r: 7 + r() * 5 });
  return puffs;
}

export function puffGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1);
  g.computeVertexNormals();
  return g;
}

export function createClouds(): Clouds {
  const rnd = mulberry32(hash32('valley-clouds'));
  const clouds: { x: number; z: number; y: number; th: number; puffs: ReturnType<typeof cloudPuffs>; yaw: number; s: number }[] = [];
  for (let i = 0; i < CLOUD_COUNT; i++) {
    // thresholds spread over 0..1 so cover maps to count; a few always-on wisps for clear days
    const th = (i + rnd() * 0.8) / CLOUD_COUNT;
    clouds.push({
      x: (rnd() * 2 - 1) * CLOUD_RANGE, z: (rnd() * 2 - 1) * CLOUD_RANGE, y: 150 + rnd() * 90, th,
      puffs: cloudPuffs(hash32(`cloud${i}`)), yaw: rnd() * Math.PI, s: 1.2 + rnd() * 0.9,
    });
  }
  const total = clouds.reduce((s, c) => s + c.puffs.length, 0);
  const geo = puffGeometry();
  const aCloud = new Float32Array(total * 4), aPuff = new Float32Array(total);
  const u: Clouds['u'] = {
    uDrift: { value: new THREE.Vector2() }, uCam: { value: new THREE.Vector3() }, uCover: { value: 0.2 }, uRange: { value: CLOUD_RANGE },
    uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uLit: { value: new THREE.Color(1, 1, 1) },
    uShade: { value: new THREE.Color(0.6, 0.65, 0.75) }, uHorizon: { value: new THREE.Color() }, uRim: { value: new THREE.Color() }, uFlash: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: vert, fragmentShader: frag, fog: false });
  const mesh = new THREE.InstancedMesh(geo, mat, total);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), e = new THREE.Euler();
  let k = 0;
  for (const c of clouds) {
    const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
    c.puffs.forEach((pf, j) => {
      const x = pf.x * c.s, z = pf.z * c.s;
      p.set(x * cy + z * sy, pf.y * c.s, -x * sy + z * cy);
      e.set(0, c.yaw + j, 0);
      q.setFromEuler(e);
      s.set(pf.r * c.s, pf.r * c.s * 0.78, pf.r * c.s);
      mesh.setMatrixAt(k, m.compose(p, q, s));
      aCloud.set([c.x, c.z, c.y, c.th], k * 4);
      aPuff[k] = j / c.puffs.length;
      k++;
    });
  }
  geo.setAttribute('aCloud', new THREE.InstancedBufferAttribute(aCloud, 4));
  geo.setAttribute('aPuff', new THREE.InstancedBufferAttribute(aPuff, 1));
  mesh.frustumCulled = false;
  mesh.name = 'clouds';
  mesh.renderOrder = -900;
  return { mesh, u };
}
