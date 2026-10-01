/**
 * Animal rig: one instanced mesh per body part (body, head, upper leg, lower leg) whose small sub-parts — eyes, jaw,
 * ears, tail, wings — are bent in the vertex shader from per-instance parameters, so a blinking, chewing, ear-flicking,
 * tail-swishing cow still costs four draw calls for the whole valley.
 *
 * Per vertex (baked into the geometry by `tag` + `rigMerge`):
 *   aRig   = (part, pivot.xyz)   which sub-part a vertex belongs to and the point it turns about
 *   aJoint = parent pivot          head parts nod about it (the head/neck joint); tail parts swing about it (the root)
 *   aAxis  = own rotation axis     (ears flap about it, wings lift about it, the tail tip swings about it)
 *   aCoat  = 1 for fur / wool / feathers: takes the instance tint, coat patterns and mud; 0 keeps its paint (eyes, hooves)
 * Per instance (Batch rect + aux):
 *   aRect  = head: (blink 0..1, jaw rad, ear L rad, ear R rad) · body: (tail swing rad, tail lift rad, wing L rad, wing R rad)
 *   aAux   = (pattern seed, pattern kind, mud 0..1, head nod rad)
 * Pattern kinds: 0 plain · 1 dark blotches · 2 brown blotches · 3 belt · 4 speckles · 5 spots · 6 ginger blotches
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toonRamp } from '../toon.ts';
import { painted } from './geo.ts';
import type { V3, Xf } from './geo.ts';

export const P = Object.freeze({
  RIGID: 0, HEAD: 1, EYE: 2, JAW: 3, EAR_L: 4, EAR_R: 5, TAIL: 6, TAIL_TIP: 7, WING_L: 8, WING_R: 9,
});

export interface Tag { part?: number; pivot?: V3; joint?: V3; axis?: V3; coat?: number }

/** Stamp rig attributes on a painted part (from geo.ts) before merging. */
export function tag(g: THREE.BufferGeometry, t: Tag = {}): THREE.BufferGeometry {
  const n = g.attributes.position.count;
  const rig = new Float32Array(n * 4), joint = new Float32Array(n * 3), axis = new Float32Array(n * 3), coat = new Float32Array(n);
  const pv = t.pivot ?? [0, 0, 0], jt = t.joint ?? [0, 0, 0], ax = t.axis ?? [1, 0, 0];
  const al = Math.hypot(ax[0], ax[1], ax[2]) || 1;
  for (let i = 0; i < n; i++) {
    rig[i * 4] = t.part ?? 0; rig[i * 4 + 1] = pv[0]; rig[i * 4 + 2] = pv[1]; rig[i * 4 + 3] = pv[2];
    joint[i * 3] = jt[0]; joint[i * 3 + 1] = jt[1]; joint[i * 3 + 2] = jt[2];
    axis[i * 3] = ax[0] / al; axis[i * 3 + 1] = ax[1] / al; axis[i * 3 + 2] = ax[2] / al;
    coat[i] = t.coat ?? 0;
  }
  g.setAttribute('aRig', new THREE.BufferAttribute(rig, 4));
  g.setAttribute('aJoint', new THREE.BufferAttribute(joint, 3));
  g.setAttribute('aAxis', new THREE.BufferAttribute(axis, 3));
  g.setAttribute('aCoat', new THREE.BufferAttribute(coat, 1));
  return g;
}

/** Tag every untagged part with `t` (default: rigid, no coat) and merge into one faceted geometry. */
export function rigMerge(parts: THREE.BufferGeometry[], t: Tag = {}): THREE.BufferGeometry {
  for (const p of parts) if (!p.attributes.aRig) tag(p, t);
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('[plots] rig merge failed');
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Shorthand: tag a list of parts with the same tag and return them (for spreading into a parts list). */
export const tagAll = (t: Tag, ...gs: THREE.BufferGeometry[]): THREE.BufferGeometry[] => gs.map((g) => tag(g, t));

/** Vertical colour gradient over a painted part (pig pinks, chick fluff, wool shading). */
export function gradient(g: THREE.BufferGeometry, top: number, bottom: number, y0: number, y1: number): THREE.BufferGeometry {
  const pos = g.attributes.position, col = g.attributes.color as THREE.BufferAttribute;
  const a = new THREE.Color(bottom), b = new THREE.Color(top), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const k = Math.min(1, Math.max(0, (pos.getY(i) - y0) / (y1 - y0 || 1)));
    c.copy(a).lerp(b, k * k * (3 - 2 * k));
    col.setXYZ(i, c.r, c.g, c.b);
  }
  return g;
}

/** Push vertices of a box-ish/ball-ish part toward a superellipsoid for chunky rounded shapes (keeps its paint). */
export function roundify(g: THREE.BufferGeometry, k = 0.6): THREE.BufferGeometry {
  g.computeBoundingBox();
  const bb = g.boundingBox!, c = bb.getCenter(new THREE.Vector3()), h = bb.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = (pos.getX(i) - c.x) / h.x, y = (pos.getY(i) - c.y) / h.y, z = (pos.getZ(i) - c.z) / h.z;
    const l = Math.hypot(x, y, z) || 1, m = Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) || 1;
    const s = (1 - k) + k * (m / l);
    pos.setXYZ(i, c.x + x * s * h.x, c.y + y * s * h.y, c.z + z * s * h.z);
  }
  return g;
}

/**
 * A chunky rounded box: a segmented box pushed toward a superellipsoid (k 0 = box … 1 = ellipsoid), painted and
 * placed. `taper` narrows the top (x/z scale at +y relative to -y) for barrels, legs and snouts.
 */
export function rbox(w: number, h: number, d: number, color: number, t?: Xf, k = 0.6, seg = 3, taper = 1): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const pos = g.attributes.position;
  const hx = w / 2, hy = h / 2, hz = d / 2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / hx, y = pos.getY(i) / hy, z = pos.getZ(i) / hz;
    const l = Math.hypot(x, y, z) || 1, m = Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) || 1;
    const s = (1 - k) + k * (m / l);
    const tp = 1 + (taper - 1) * (y * s * 0.5 + 0.5);
    pos.setXYZ(i, x * s * hx * tp, y * s * hy, z * s * hz * tp);
  }
  return painted(g, color, t);
}

// ---------------------------------------------------------------------------------------------------------------
// Shader

const VERT_HEAD = /* glsl */ `
attribute vec4 aRig; attribute vec3 aJoint; attribute vec3 aAxis; attribute float aCoat;
#ifdef USE_INSTANCING
attribute vec4 aRect; attribute vec4 aAux;
#endif
varying vec3 vRest; varying float vCoat; varying vec4 vAuxV;
vec3 rigRot(vec3 v, vec3 k, float a) { float c = cos(a), s = sin(a); return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c); }
void rigApply(inout vec3 p, inout vec3 n, vec4 R, vec4 X) {
  float part = aRig.x; vec3 piv = aRig.yzw;
  if (part < 0.5) return;
  if (part < 1.5) { }
  else if (part < 2.5) { p.y = piv.y + (p.y - piv.y) * max(0.07, 1.0 - R.x); }
  else if (part < 3.5) { p = piv + rigRot(p - piv, aAxis, R.y); n = rigRot(n, aAxis, R.y); }
  else if (part < 4.5) { p = piv + rigRot(p - piv, aAxis, R.z); n = rigRot(n, aAxis, R.z); }
  else if (part < 5.5) { p = piv + rigRot(p - piv, aAxis, R.w); n = rigRot(n, aAxis, R.w); }
  else if (part < 7.5) {
    if (part > 6.5) { float a = R.x * 0.9; p = piv + rigRot(p - piv, aAxis, a); n = rigRot(n, aAxis, a); }
    vec3 q = p - aJoint;
    q = rigRot(q, vec3(1.0, 0.0, 0.0), -R.y); n = rigRot(n, vec3(1.0, 0.0, 0.0), -R.y);
    q = rigRot(q, vec3(0.0, 0.0, 1.0), R.x); n = rigRot(n, vec3(0.0, 0.0, 1.0), R.x);
    p = aJoint + q;
    return;
  }
  else if (part < 8.5) { p = piv + rigRot(p - piv, aAxis, R.z); n = rigRot(n, aAxis, R.z); return; }
  else { p = piv + rigRot(p - piv, aAxis, R.w); n = rigRot(n, aAxis, R.w); return; }
  // head parts nod about the neck joint
  p = aJoint + rigRot(p - aJoint, vec3(1.0, 0.0, 0.0), X.w); n = rigRot(n, vec3(1.0, 0.0, 0.0), X.w);
}
`;

const VERT_NORMAL = /* glsl */ `
#include <beginnormal_vertex>
vec3 rigP = position;
{
  vec4 R = vec4(0.0), X = vec4(0.0);
  #ifdef USE_INSTANCING
    R = aRect; X = aAux;
  #endif
  rigApply(rigP, objectNormal, R, X);
  vRest = position; vCoat = aCoat; vAuxV = X;
}
`;
const VERT_BEGIN = /* glsl */ `
#include <begin_vertex>
transformed = rigP;
`;
const VERT_COLOR = /* glsl */ `
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR )
  vColor = vec4( 1.0 );
#endif
#ifdef USE_COLOR
  vColor.rgb *= color;
#endif
#ifdef USE_INSTANCING_COLOR
  vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, aCoat);
#endif
`;

const FRAG_HEAD = /* glsl */ `
varying vec3 vRest; varying float vCoat; varying vec4 vAuxV;
float rigBlob(vec3 p, float s) {
  return sin(p.x * 3.1 + s * 6.0) * sin(p.y * 2.7 + s * 11.0 + 1.3) * sin(p.z * 2.3 - s * 7.0 + 0.4)
       + 0.55 * sin(p.x * 5.3 - s * 3.0 + p.z * 1.7) * sin(p.y * 4.9 + s * 5.0 - p.z * 2.1);
}
`;
const FRAG_BODY = /* glsl */ `
#include <color_fragment>
if (vCoat > 0.5) {
  float kind = floor(vAuxV.y + 0.5), seed = vAuxV.x;
  vec3 p = vRest;
  float m = 0.0; vec3 pc = vec3(0.0);
  if (kind > 0.5 && kind < 2.5) { m = step(0.28, rigBlob(p * 2.2, seed)); pc = kind < 1.5 ? vec3(0.13, 0.11, 0.11) : vec3(0.42, 0.22, 0.12); }
  else if (kind > 2.5 && kind < 3.5) { m = step(abs(p.z - 0.05 + sin(p.y * 6.0 + seed) * 0.05), 0.2); pc = vec3(0.97, 0.95, 0.9); }
  else if (kind > 3.5 && kind < 4.5) { m = step(0.72, sin(p.x * 61.0 + seed * 9.0) * sin(p.y * 57.0 + seed * 4.0) * sin(p.z * 63.0)); m = max(m, step(0.8, sin(p.x * 37.0 - seed) * sin(p.z * 41.0 + p.y * 29.0))); pc = vec3(0.16, 0.14, 0.14); }
  else if (kind > 4.5 && kind < 5.5) { m = step(0.45, rigBlob(p * 4.2, seed)); pc = vec3(0.16, 0.13, 0.13); }
  else if (kind > 5.5) { m = step(0.2, rigBlob(p * 2.0, seed)); pc = vec3(0.98, 0.96, 0.92); }
  diffuseColor.rgb = mix(diffuseColor.rgb, pc, m);
  float mud = vAuxV.z;
  if (mud > 0.01) {
    float lowK = 1.0 - smoothstep(0.1, 0.75, p.y);
    float n = rigBlob(p * 3.4, seed + 3.0) * 0.5 + 0.5;
    float mm = step(1.0 - mud * (0.55 + lowK * 0.8), n + lowK * 0.35);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.36, 0.25, 0.15), mm);
  }
}
`;

function inject(sh: THREE.WebGLProgramParametersWithUniforms, frag: boolean): void {
  sh.vertexShader = VERT_HEAD + sh.vertexShader
    .replace('#include <beginnormal_vertex>', VERT_NORMAL)
    .replace('#include <begin_vertex>', VERT_BEGIN)
    .replace('#include <color_vertex>', VERT_COLOR);
  if (frag) sh.fragmentShader = FRAG_HEAD + sh.fragmentShader.replace('#include <color_fragment>', FRAG_BODY);
}

let mat: THREE.MeshToonMaterial | null = null;
let depth: THREE.MeshDepthMaterial | null = null;

/** The one material every animal part uses (toon, vertex colours, rig deformation, coat patterns). */
export function rigMaterial(): THREE.MeshToonMaterial {
  if (mat) return mat;
  const m = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: toonRamp() });
  m.onBeforeCompile = (sh) => inject(sh, true);
  m.customProgramCacheKey = () => 'plots-rig';
  return (mat = m);
}

/** Shadow depth material that bends the same sub-parts (ears, heads, tails) as the lit one. */
export function rigDepthMaterial(): THREE.MeshDepthMaterial {
  if (depth) return depth;
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = VERT_HEAD + sh.vertexShader
      .replace('#include <begin_vertex>', `vec3 objectNormal = vec3(0.0, 1.0, 0.0);\nvec3 rigP = position;\n{ vec4 R = vec4(0.0), X = vec4(0.0);\n#ifdef USE_INSTANCING\nR = aRect; X = aAux;\n#endif\nrigApply(rigP, objectNormal, R, X); vRest = position; vCoat = aCoat; vAuxV = X; }\n#include <begin_vertex>\ntransformed = rigP;`);
  };
  m.customProgramCacheKey = () => 'plots-rig-depth';
  return (depth = m);
}
