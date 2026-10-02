/**
 * Camera-wrapped particle fields: rain streaks, snow flakes, falling leaves / petals, sunbeam motes. Each is one
 * instanced draw. Particles live in a box that wraps around the camera (so the volume never shows an edge: they
 * fade radially and at the box top/bottom); their motion is a CPU-integrated offset so wind changes never jump.
 */
import * as THREE from 'three';
import { mulberry32, hash32 } from '../../../../../shared/identity.ts';

const WRAP = /* glsl */`
attribute vec4 aSeed;
attribute vec2 aCorner;
uniform vec3 uCam, uBox, uOffset;
uniform float uTime;
vec3 wrapPos(out float fade) {
  vec3 p = aSeed.xyz * uBox + uOffset * (0.82 + 0.36 * aSeed.w);
  vec3 origin = uCam - uBox * 0.5;
  vec3 q = mod(p - origin, uBox);
  float radial = length((q.xz - uBox.xz * 0.5) / (uBox.xz * 0.5));
  fade = (1.0 - smoothstep(0.55, 0.95, radial)) * smoothstep(0.0, 0.18, q.y / uBox.y) * smoothstep(1.0, 0.8, q.y / uBox.y);
  return origin + q;
}`;

const rainVert = /* glsl */`
${WRAP}
uniform vec3 uVel;
uniform float uLen, uWidth;
varying vec2 vUv;
varying float vA;
void main() {
  float fade;
  vec3 w = wrapPos(fade);
  vec3 axis = normalize(uVel);
  vec3 toCam = uCam - w;
  float dist = length(toCam);
  vec3 side = normalize(cross(axis, toCam / max(dist, 1e-3)));
  float width = max(uWidth, dist * 0.0011);
  float len = uLen * (0.7 + 0.6 * aSeed.w);
  vec3 pos = w + axis * (aCorner.y - 0.5) * len + side * aCorner.x * width;
  vUv = aCorner;
  vA = fade * sqrt(uWidth / width) * smoothstep(0.8, 3.0, dist);
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
  // invisible (faded) streaks close to the eye would still rasterise as huge quads: collapse them
  if (vA < 0.004) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
}`;
const rainFrag = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
varying float vA;
void main() {
  float a = (1.0 - abs(vUv.x)) * smoothstep(0.0, 0.6, vUv.y) * vA * uOpacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
}`;

const flakeVert = /* glsl */`
${WRAP}
uniform float uSize, uSwirl;
varying vec2 vUv;
varying float vA;
void main() {
  float fade;
  vec3 w = wrapPos(fade);
  float ph = aSeed.w * 40.0;
  w.x += sin(uTime * (0.6 + aSeed.w * 0.8) + ph) * uSwirl;
  w.z += cos(uTime * (0.5 + aSeed.y * 0.7) + ph * 1.3) * uSwirl;
  w.y += sin(uTime * 1.3 + ph) * uSwirl * 0.25;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float dist = length(uCam - w);
  float size = uSize * (0.6 + 0.8 * aSeed.x) ;
  float px = dist * 0.0036;
  vUv = aCorner;
  vA = fade * smoothstep(1.5, 4.5, dist) * min(1.0, size / px * 1.2 + 0.5);
  size = max(size, px);
  gl_Position = projectionMatrix * viewMatrix * vec4(w + (right * aCorner.x + up * aCorner.y) * size, 1.0);
  // flakes within ~1.5 m are faded out but would cover a big patch of screen (overdraw): collapse them
  if (vA < 0.004) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
}`;
const flakeFrag = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
varying float vA;
void main() {
  float r = length(vUv);
  float a = smoothstep(1.0, 0.35, r) * vA * uOpacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
}`;

/** tumbling leaves / petals, lit simply by the sky */
const leafVert = /* glsl */`
${WRAP}
uniform float uSize;
uniform vec3 uC0, uC1, uC2, uC3;
varying vec3 vCol;
varying float vA;
varying vec2 vUv;
varying vec3 vN;
mat3 rot(vec3 ax, float a) {
  float s = sin(a), c = cos(a), oc = 1.0 - c;
  return mat3(oc * ax.x * ax.x + c, oc * ax.x * ax.y + ax.z * s, oc * ax.z * ax.x - ax.y * s,
              oc * ax.x * ax.y - ax.z * s, oc * ax.y * ax.y + c, oc * ax.y * ax.z + ax.x * s,
              oc * ax.z * ax.x + ax.y * s, oc * ax.y * ax.z - ax.x * s, oc * ax.z * ax.z + c);
}
void main() {
  float fade;
  vec3 w = wrapPos(fade);
  float ph = aSeed.w * 50.0;
  // flutter: a side-to-side pendulum on the way down
  w.x += sin(uTime * 1.6 + ph) * 0.45;
  w.z += cos(uTime * 1.1 + ph * 0.7) * 0.3;
  vec3 ax = normalize(vec3(aSeed.y - 0.5, 0.6, aSeed.x - 0.5));
  mat3 R = rot(ax, uTime * (2.0 + aSeed.w * 3.0) + ph);
  // a leaf shape: a diamond elongated along y
  vec3 local = vec3(aCorner.x * 0.6, 0.0, aCorner.y) * uSize * (0.7 + 0.6 * aSeed.x);
  vN = R * vec3(0.0, 1.0, 0.0);
  float k = fract(aSeed.w * 7.13);
  vCol = k < 0.25 ? uC0 : k < 0.5 ? uC1 : k < 0.75 ? uC2 : uC3;
  vA = fade;
  vUv = aCorner;
  gl_Position = projectionMatrix * viewMatrix * vec4(w + R * local, 1.0);
}`;
const leafFrag = /* glsl */`
uniform vec3 uSunDir, uSun, uAmb;
varying vec3 vCol;
varying float vA;
varying vec2 vUv;
varying vec3 vN;
void main() {
  if (abs(vUv.x) + abs(vUv.y) > 1.0 || vA < 0.05) discard;
  float l = abs(dot(normalize(vN), uSunDir));
  vec3 c = vCol * (uAmb + uSun * (0.35 + 0.65 * step(0.35, l)));
  gl_FragColor = vec4(c, 1.0);
}`;

/** tiny glinting motes (additive) */
const moteVert = /* glsl */`
${WRAP}
uniform float uSize;
varying vec2 vUv;
varying float vA;
void main() {
  float fade;
  vec3 w = wrapPos(fade);
  float ph = aSeed.w * 60.0;
  w += vec3(sin(uTime * 0.31 + ph), sin(uTime * 0.23 + ph * 1.7) * 0.6, cos(uTime * 0.27 + ph * 0.9)) * 0.7;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float dist = length(uCam - w);
  vUv = aCorner;
  float tw = 0.5 + 0.5 * sin(uTime * (1.5 + aSeed.x * 3.0) + ph);
  vA = fade * tw * tw * smoothstep(0.5, 1.5, dist);
  gl_Position = projectionMatrix * viewMatrix * vec4(w + (right * aCorner.x + up * aCorner.y) * max(uSize, dist * 0.0016), 1.0);
}`;
const moteFrag = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
varying float vA;
void main() {
  float a = smoothstep(1.0, 0.0, length(vUv)) * vA * uOpacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

export type FieldKind = 'rain' | 'snow' | 'leaf' | 'mote';

export interface Field {
  mesh: THREE.Mesh;
  geo: THREE.InstancedBufferGeometry;
  max: number;
  /** integrated drift (world metres) */
  offset: THREE.Vector3;
  u: Record<string, THREE.IUniform>;
  /** 0..1 of max particles drawn */
  setAmount(k: number): void;
  step(vel: THREE.Vector3, dt: number, time: number, cam: THREE.Vector3): void;
}

export function createField(kind: FieldKind, max: number, box: [number, number, number], seedKey: string): Field {
  const geo = new THREE.InstancedBufferGeometry();
  const corners = kind === 'rain' ? [-1, 0, 1, 0, 1, 1, -1, 1] : [-1, -1, 1, -1, 1, 1, -1, 1];
  geo.setAttribute('aCorner', new THREE.Float32BufferAttribute(corners, 2));
  // three needs a `position` attribute to count vertices
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const r = mulberry32(hash32(seedKey));
  const seeds = new Float32Array(max * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = r();
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  geo.instanceCount = 0;
  const u: Record<string, THREE.IUniform> = {
    uCam: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(...box) }, uOffset: { value: new THREE.Vector3() }, uTime: { value: 0 },
    uColor: { value: new THREE.Color(1, 1, 1) }, uOpacity: { value: 1 },
  };
  let vert: string, frag: string;
  const extra: Partial<THREE.ShaderMaterialParameters> = { transparent: true, depthWrite: false };
  if (kind === 'rain') {
    Object.assign(u, { uVel: { value: new THREE.Vector3(0, -13, 0) }, uLen: { value: 0.65 }, uWidth: { value: 0.012 } });
    vert = rainVert; frag = rainFrag;
  } else if (kind === 'snow') {
    Object.assign(u, { uSize: { value: 0.075 }, uSwirl: { value: 0.6 } });
    vert = flakeVert; frag = flakeFrag;
  } else if (kind === 'leaf') {
    Object.assign(u, {
      uSize: { value: 0.09 }, uC0: { value: new THREE.Color() }, uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() }, uC3: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSun: { value: new THREE.Color() }, uAmb: { value: new THREE.Color() },
    });
    vert = leafVert; frag = leafFrag;
    extra.transparent = false; extra.depthWrite = true; extra.side = THREE.DoubleSide;
  } else {
    Object.assign(u, { uSize: { value: 0.02 } });
    vert = moteVert; frag = moteFrag;
    extra.blending = THREE.AdditiveBlending;
  }
  const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: vert, fragmentShader: frag, fog: false, ...extra });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.name = `weather-${kind}`;
  mesh.renderOrder = kind === 'mote' ? 20 : 10;
  const offset = new THREE.Vector3();
  const wrapLen = new THREE.Vector3(box[0] * 40, box[1] * 40, box[2] * 40);
  return {
    mesh, geo, max, offset, u,
    setAmount(k) {
      geo.instanceCount = Math.round(Math.min(1, Math.max(0, k)) * max);
      mesh.visible = geo.instanceCount > 0;
    },
    step(vel, dt, time, cam) {
      offset.addScaledVector(vel, dt);
      // keep float precision: wrap after a long time (an unnoticeable reshuffle)
      if (Math.abs(offset.x) > wrapLen.x) offset.x %= wrapLen.x;
      if (Math.abs(offset.y) > wrapLen.y) offset.y %= wrapLen.y;
      if (Math.abs(offset.z) > wrapLen.z) offset.z %= wrapLen.z;
      (u.uOffset.value as THREE.Vector3).copy(offset);
      (u.uCam.value as THREE.Vector3).copy(cam);
      u.uTime.value = time;
    },
  };
}
