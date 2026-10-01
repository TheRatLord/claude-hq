/**
 * What the farmhouse windows show from inside: the real valley, captured.
 *
 * Each view (layout.ts VIEWS: one wide view for both front windows, one for the east window) renders the outdoor
 * scene once from just outside its panes into a small HDR target with depth (the same linear, pre-post colour the
 * main pass writes, alpha = the toon local-light share). A big backdrop plane outside the window projects that
 * capture back from the capture point and writes the captured depth (pushed out along the view ray, never nearer
 * than the plane), so the post pass outlines, hazes, mists and grades the view exactly like the real valley, and
 * lamps bloom. The world itself stays hidden while you are inside (draw calls); captures refresh when the light or
 * the weather moved on (or every couple of minutes), one view per frame.
 *
 * Also here: the window glass (faint, with rain running down it when it rains) and the sunbeams (dusty shafts
 * slanting in along the real sun direction through each opening, only when the sun is up and on that side).
 */
import * as THREE from 'three';
import { ROOM, VIEWS, WINDOWS } from './layout.ts';
import type { ViewSpot } from './layout.ts';

const CAP_W = 768;

export interface Capture {
  spot: ViewSpot;
  cam: THREE.PerspectiveCamera;
  rt: THREE.WebGLRenderTarget;
  backdrop: THREE.Mesh;
  /** last capture time (s, engine time) and the lighting it saw */
  at: number;
  night: number;
  wet: number;
  sun: THREE.Vector3;
  ok: boolean;
}

const BACKDROP_VERT = /* glsl */`
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const BACKDROP_FRAG = /* glsl */`
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform mat4 uCapVP;
uniform mat4 uCapInvVP;
uniform mat4 uMainVP;
uniform float uOk;
uniform vec3 uFallback;
varying vec3 vWorld;
void main() {
  vec4 c = uCapVP * vec4(vWorld, 1.0);
  vec2 uv = clamp(c.xy / c.w * 0.5 + 0.5, 0.002, 0.998);
  if (uOk < 0.5) { gl_FragColor = vec4(uFallback, 1.0); return; }
  vec4 col = texture2D(tColor, uv);
  float d = texture2D(tDepth, uv).x;
  float fd = 1.0;
  if (d < 0.999999) {
    // the captured point, back in the world, then into this camera's depth
    vec4 w = uCapInvVP * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    w /= w.w;
    vec4 cl = uMainVP * vec4(w.xyz, 1.0);
    fd = cl.w > 0.0 ? clamp(cl.z / cl.w * 0.5 + 0.5, 0.0, 1.0) : gl_FragCoord.z;
  }
  gl_FragDepth = max(gl_FragCoord.z, fd);
  gl_FragColor = col;
}`;

/** the farmhouse-local → world matrix the views are placed with (root.matrixWorld) */
export function createCaptures(root: THREE.Object3D): Capture[] {
  root.updateMatrixWorld(true);
  const m = root.matrixWorld;
  return VIEWS.map((spot) => {
    const h = Math.round(CAP_W / spot.aspect);
    const depth = new THREE.DepthTexture(CAP_W, h, THREE.FloatType);
    const rt = new THREE.WebGLRenderTarget(CAP_W, h, { type: THREE.HalfFloatType, depthTexture: depth, depthBuffer: true, samples: 0 });
    rt.texture.generateMipmaps = false;
    rt.texture.minFilter = THREE.LinearFilter;
    const cam = new THREE.PerspectiveCamera(spot.fov, spot.aspect, 0.08, 900);
    const p = new THREE.Vector3(spot.x, spot.y, spot.z).applyMatrix4(m);
    const look = new THREE.Vector3(spot.x + spot.nx, spot.y, spot.z + spot.nz).applyMatrix4(m);
    cam.position.copy(p);
    cam.lookAt(look);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const mat = new THREE.ShaderMaterial({
      vertexShader: BACKDROP_VERT, fragmentShader: BACKDROP_FRAG,
      uniforms: {
        tColor: { value: rt.texture }, tDepth: { value: depth },
        uCapVP: { value: vp }, uCapInvVP: { value: vp.clone().invert() }, uMainVP: { value: new THREE.Matrix4() },
        uOk: { value: 0 }, uFallback: { value: new THREE.Color(0.55, 0.7, 0.85) },
      },
      depthWrite: true, fog: false,
    });
    // a big plane well outside the window, facing back at it (only ever seen through the openings)
    const D = 40, size = 2 * D * Math.tan(THREE.MathUtils.degToRad(spot.fov / 2)) * 2.4;
    const geo = new THREE.PlaneGeometry(size * spot.aspect, size);
    const backdrop = new THREE.Mesh(geo, mat);
    backdrop.name = `interior:view:${spot.id}`;
    backdrop.castShadow = false;
    backdrop.receiveShadow = false;
    backdrop.frustumCulled = false;
    const mainVP = mat.uniforms.uMainVP.value as THREE.Matrix4;
    backdrop.onBeforeRender = (_r, _s, camera) => { mainVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); };
    // world placement directly (it is not parented under the room: no farmhouse-local maths at draw time)
    backdrop.position.copy(p).addScaledVector(look.clone().sub(p).normalize(), D);
    backdrop.lookAt(p);
    backdrop.updateMatrixWorld(true);
    backdrop.matrixAutoUpdate = false;
    return { spot, cam, rt, backdrop, at: -1e9, night: -1, wet: -1, sun: new THREE.Vector3(), ok: false };
  });
}

export function setFallback(caps: Capture[], sky: THREE.Color): void {
  for (const c of caps) ((c.backdrop.material as THREE.ShaderMaterial).uniforms.uFallback.value as THREE.Color).copy(sky);
}

/** Render one capture now (the caller shows the outdoors and hides the room around this). */
export function renderCapture(renderer: THREE.WebGLRenderer, scene: THREE.Scene, c: Capture): void {
  const prev = renderer.getRenderTarget();
  const auto = renderer.info.autoReset;
  renderer.info.autoReset = false;
  renderer.setRenderTarget(c.rt);
  renderer.clear();
  renderer.render(scene, c.cam);
  renderer.setRenderTarget(prev);
  renderer.info.autoReset = auto;
  c.ok = true;
  (c.backdrop.material as THREE.ShaderMaterial).uniforms.uOk.value = 1;
}

export function disposeCaptures(caps: Capture[]): void {
  for (const c of caps) { c.rt.depthTexture?.dispose(); c.rt.dispose(); c.backdrop.geometry.dispose(); (c.backdrop.material as THREE.Material).dispose(); }
}

// ------------------------------------------------------------------------------------------------- glass + rain

const GLASS_VERT = /* glsl */`
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const GLASS_FRAG = /* glsl */`
uniform float uTime, uWet, uNight;
varying vec2 vUv;
varying vec3 vWorld;
float h1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
void main() {
  // a faint cool sheen, brighter toward the top
  float a = 0.05 + 0.04 * vUv.y;
  vec3 col = vec3(0.75, 0.85, 0.95);
  if (uWet > 0.01) {
    // streaks: columns of drops sliding down at their own pace, beading at rest
    vec2 p = vWorld.xz * 0.0 + vec2(vUv.x * 26.0, vUv.y);
    float col0 = floor(p.x);
    float r = h1(col0 + 3.1);
    float sp = 0.12 + r * 0.25;
    float y = fract(vUv.y * (1.2 + r) + uTime * sp + r * 7.0);
    float fx = abs(fract(p.x) - 0.5 - 0.15 * sin(vUv.y * 9.0 + r * 6.0));
    float head = smoothstep(0.1, 0.0, fx) * smoothstep(0.06, 0.0, abs(y - 0.92));
    float trail = smoothstep(0.05, 0.0, fx) * smoothstep(0.92, 0.3, y) * step(y, 0.92) * 0.35;
    // still beads
    vec2 q = vUv * vec2(30.0, 22.0);
    vec2 cq = floor(q);
    float rb = h1(cq.x * 13.0 + cq.y * 7.0);
    float bead = step(0.72, rb) * smoothstep(0.22, 0.05, length(fract(q) - 0.5 - (vec2(h1(rb), h1(rb + 1.0)) - 0.5) * 0.4));
    float drops = clamp(head + trail + bead * 0.6, 0.0, 1.0) * step(r, 0.25 + uWet * 0.7);
    drops = max(drops, bead * 0.6 * uWet);
    a += drops * 0.45 * uWet;
    col = mix(col, vec3(0.9, 0.95, 1.0) * (1.0 + uNight * 0.3), drops);
  }
  gl_FragColor = vec4(col, a);
}`;

export interface Glass { mesh: THREE.Mesh; update(t: number, wet: number, night: number): void }
export function buildGlass(): Glass {
  const parts: THREE.BufferGeometry[] = [];
  for (const w of WINDOWS) {
    const g = new THREE.PlaneGeometry(w.w - 0.02, w.h - 0.02);
    // just inside the mullions, facing the room
    if (w.wall === 'front') g.rotateY(Math.PI).translate(w.at, w.y, ROOM.z1 + 0.04);
    else g.rotateY(-Math.PI / 2).translate(ROOM.x1 + 0.04, w.y, w.at);
    parts.push(g);
  }
  const geo = mergeAll(parts);
  const u = { uTime: { value: 0 }, uWet: { value: 0 }, uNight: { value: 0 } };
  const mat = new THREE.ShaderMaterial({ vertexShader: GLASS_VERT, fragmentShader: GLASS_FRAG, uniforms: u, transparent: true, depthWrite: false, fog: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'interior:glass';
  mesh.renderOrder = 3;
  return { mesh, update(t, wet, night) { u.uTime.value = t; u.uWet.value = wet; u.uNight.value = night; } };
}

// ------------------------------------------------------------------------------------------------- sunbeams

const BEAM_VERT = /* glsl */`
attribute vec3 aCorner;   // x, y on the opening (local, metres), z = 0 at the window, 1 at the far end
attribute vec3 aOrigin;   // the opening's centre (farmhouse-local)
attribute vec3 aRight;
attribute vec3 aUp;
uniform vec3 uSunLocal;   // unit, toward the sun, farmhouse-local
uniform float uLen;
varying float vT;
varying vec2 vEdge;
varying vec2 vHalf;
void main() {
  vec3 p = aOrigin + aRight * aCorner.x + aUp * aCorner.y - uSunLocal * uLen * aCorner.z;
  vT = aCorner.z;
  vEdge = aCorner.xy;
  vHalf = vec2(length(aRight), length(aUp));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const BEAM_FRAG = /* glsl */`
uniform float uK;
uniform vec3 uColor;
uniform float uTime;
varying float vT;
varying vec2 vEdge;
void main() {
  float edge = smoothstep(0.5, 0.32, abs(vEdge.x)) * smoothstep(0.5, 0.3, abs(vEdge.y));
  float fall = pow(1.0 - vT, 1.6) * smoothstep(0.0, 0.08, vT);
  float shimmer = 0.85 + 0.15 * sin(vT * 20.0 - uTime * 0.7 + vEdge.x * 9.0);
  gl_FragColor = vec4(uColor * uK * edge * fall * shimmer, 1.0);
}`;

export interface Beams { mesh: THREE.Mesh; update(t: number, sunLocal: THREE.Vector3, k: readonly number[], color: THREE.Color): void }
/** one beam per window; `k[i]` (0..1) is how much sun window i lets in right now */
export function buildBeams(): Beams {
  const corners: number[] = [], origin: number[] = [], right: number[] = [], up: number[] = [], index: number[] = [];
  const beamK: number[] = [];
  WINDOWS.forEach((w, wi) => {
    const o = w.wall === 'front' ? [w.at, w.y, ROOM.z1 + 0.05] : [ROOM.x1 + 0.05, w.y, w.at];
    const r = w.wall === 'front' ? [w.w, 0, 0] : [0, 0, -w.w];
    const u = [0, w.h, 0];
    const base = corners.length / 3;
    // a box swept from the opening: 4 corners × near/far
    for (const z of [0, 1]) for (const [x, y] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
      corners.push(x, y, z); origin.push(...o); right.push(...r); up.push(...u); beamK.push(wi);
    }
    const q = (a: number, b: number, c: number, d: number) => index.push(base + a, base + b, base + c, base + a, base + c, base + d);
    q(0, 1, 5, 4); q(1, 2, 6, 5); q(2, 3, 7, 6); q(3, 0, 4, 7);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(corners, 3)); // unused by the shader; keeps three happy
  geo.setAttribute('aCorner', new THREE.Float32BufferAttribute(corners, 3));
  geo.setAttribute('aOrigin', new THREE.Float32BufferAttribute(origin, 3));
  geo.setAttribute('aRight', new THREE.Float32BufferAttribute(right, 3));
  geo.setAttribute('aUp', new THREE.Float32BufferAttribute(up, 3));
  geo.setAttribute('aWin', new THREE.Float32BufferAttribute(beamK, 1));
  geo.setIndex(index);
  const u = { uSunLocal: { value: new THREE.Vector3(0, 1, 0) }, uLen: { value: 5 }, uK: { value: 0 }, uColor: { value: new THREE.Color(1, 0.9, 0.7) }, uTime: { value: 0 }, uWinK: { value: [0, 0, 0] } };
  const mat = new THREE.ShaderMaterial({
    vertexShader: BEAM_VERT.replace('uniform float uLen;', 'uniform float uLen;\nattribute float aWin;\nuniform float uWinK[3];\nvarying float vK;').replace('vT = aCorner.z;', 'vT = aCorner.z;\nvK = uWinK[int(aWin)];'),
    fragmentShader: BEAM_FRAG.replace('varying float vT;', 'varying float vT;\nvarying float vK;').replace('uColor * uK *', 'uColor * uK * vK *'),
    uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'interior:beams';
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  return {
    mesh,
    update(t, sun, k, color) {
      u.uTime.value = t;
      u.uSunLocal.value.copy(sun);
      for (let i = 0; i < 3; i++) u.uWinK.value[i] = k[i] ?? 0;
      u.uK.value = 1;
      u.uColor.value.copy(color);
      // reach the floor: the beam is as long as it takes to drop the sill height
      u.uLen.value = Math.min(7, (WINDOWS[0].y - ROOM.floor + 0.6) / Math.max(0.2, sun.y));
      mesh.visible = k.some((x) => x > 0.01);
    },
  };
}

function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const ni = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const n = ni.reduce((s, p) => s + p.attributes.position.count, 0);
  const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const p of ni) {
    pos.set(p.attributes.position.array as Float32Array, o * 3);
    uv.set(p.attributes.uv.array as Float32Array, o * 2);
    o += p.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
