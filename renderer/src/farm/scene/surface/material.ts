/**
 * Surface materials and geometry tagging (see index.ts for the guide).
 */
import * as THREE from 'three';
import type { Quality } from '../context.ts';
import { toon } from '../toon.ts';
import type { ToonOpts } from '../toon.ts';
import { SURF, SURF_NAMES, packSurface, surfIds, surfaceSetKey } from './ids.ts';
import type { SurfId, SurfName, SurfTag } from './ids.ts';
import { SURF_FRAG_BODY, SURF_TILT_FRAG, SURF_VERT_BODY, SURF_VERT_HEAD, surfFragHead } from './glsl.ts';

// ------------------------------------------------------------------------------------------------ global knobs

/** Shared by every surface material: overall strength (0 = off) and the distance (m) where fine detail is gone. */
export const SURFACE_UNIFORMS = {
  uSurfStrength: { value: 1 },
  uSurfFar: { value: 55 },
};

let quality: Quality = 'high';
const live = new Set<WeakRef<THREE.Material>>();
let adds = 0;
/**
 * Global quality switch (the terrain system calls it with ctx.quality; safe at runtime: live surface materials
 * recompile). 'low' compiles surface detail out entirely; 'medium' pulls the fine-detail distance in.
 */
export function setSurfaceQuality(q: Quality): void {
  const changed = q !== quality;
  quality = q;
  SURFACE_UNIFORMS.uSurfFar.value = q === 'medium' ? 40 : 55;
  if (changed) for (const r of live) { const m = r.deref(); if (m) m.needsUpdate = true; else live.delete(r); }
}
// dev hook (A/B the cost from the console or scripts/shoot.ts: eval=__surfaces.quality('low'))
(globalThis as { __surfaces?: unknown }).__surfaces = { quality: setSurfaceQuality, uniforms: SURFACE_UNIFORMS };
export const surfaceQuality = (): Quality => quality;

// ------------------------------------------------------------------------------------------------ composable hooks

type Hook = (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void;
const baseKey = THREE.Material.prototype.customProgramCacheKey;

/**
 * Chain a shader hook onto a material without clobbering hooks it already has (flora wind, crop sway, …).
 * `key` must identify what `hook` does (it joins the program cache key, so equal keys share one program).
 * Every package that patches materials should use this instead of assigning `onBeforeCompile` directly.
 */
export function chainShader<M extends THREE.Material>(m: M, hook: Hook, key: string | (() => string)): M {
  const prev = m.onBeforeCompile;
  const prevKeyFn = m.customProgramCacheKey;
  const prevKey = prevKeyFn === baseKey ? `obc:${hashStr(prev.toString())}` : null;
  m.onBeforeCompile = (sh, r) => { prev.call(m, sh, r); hook(sh, r); };
  m.customProgramCacheKey = () => `${prevKey ?? prevKeyFn.call(m)}|${typeof key === 'function' ? key() : key}`;
  m.needsUpdate = true;
  return m;
}

function hashStr(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

// ------------------------------------------------------------------------------------------------ materials

export interface SurfaceOpts extends SurfTag {
  /** surface for untagged vertices / vertices tagged `SURF.inherit` (default plain = no detail) */
  surface?: SurfId | SurfName;
  /** material-wide strength multiplier (default 1); change later with `setSurfaceAmount` */
  amount?: number;
  /** surfaces compiled into this material (default: all). Fewer = smaller, faster shader. */
  surfaces?: readonly (SurfId | SurfName)[];
  /** replace the default fragment body (advanced: the terrain blends several surfaces itself); runs after color_fragment */
  fragment?: string;
  /** part of the program key identifying a custom `fragment` */
  fragmentKey?: string;
}

interface SurfState { def: { value: THREE.Vector4 } }

const idOf = (s: SurfId | SurfName | undefined): number => (s === undefined ? SURF.plain : typeof s === 'number' ? s : SURF[s]);

/**
 * Give a toon (or any lit built-in) material hand-painted surface detail. Chains onto existing hooks; returns `m`.
 * Keeps everything the material already does (vertex colours, instancing, toon ramp, shadows, fog): the detail only
 * modulates `diffuseColor` after `color_fragment`.
 */
export function withSurfaces<M extends THREE.Material>(m: M, o: SurfaceOpts = {}): M {
  const id = idOf(o.surface);
  const [code, scale, strength] = packSurface(id, o);
  const ids = o.surfaces ? [...new Set([...surfIds(o.surfaces), id])] : SURF_NAMES.map((n) => SURF[n]);
  const state: SurfState = { def: { value: new THREE.Vector4(code, scale, strength, o.amount ?? 1) } };
  m.userData.surface = state;
  // materials come and go with every rebuild (fields, festival dressing, seasons): drop the dead refs now and then, or
  // the set itself grew by ~2k WeakRefs a minute in the soak
  if (++adds % 512 === 0) for (const r of live) if (!r.deref()) live.delete(r);
  live.add(new WeakRef(m));
  const withDefaults = m as M & { defaultAttributeValues?: Record<string, number[]> };
  withDefaults.defaultAttributeValues = { ...(withDefaults.defaultAttributeValues ?? {}), surface: [0, 1, 1, 0] };
  const key = `surf:${surfaceSetKey(ids)}:${o.fragmentKey ?? (o.fragment ? hashStr(o.fragment) : '')}`;
  return chainShader(m, (sh) => {
    // atmosphere (scene/weather/surfaces.ts): puddles and lying snow only on the surface-library world, never on characters
    sh.fragmentShader = `#define VW_SURF\n${quality === 'low' ? '' : '#define VW_SURF_ID\n'}${sh.fragmentShader}`;
    if (quality === 'low') return;
    Object.assign(sh.uniforms, SURFACE_UNIFORMS, { uSurfDef: state.def });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${SURF_VERT_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${SURF_VERT_BODY}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${surfFragHead(ids)}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${o.fragment ?? SURF_FRAG_BODY}`);
    // foliage: leaf clumps bend the lit normal (their rounded tops catch the sun)
    if (ids.includes(SURF.leaves)) sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${SURF_TILT_FRAG}`);
  }, () => `${key}:${quality === 'low' ? 'off' : 'on'}`);
}

/** Change a surface material's strength at runtime (0 = off, 1 = as designed). */
export function setSurfaceAmount(m: THREE.Material, k: number): void {
  const s = m.userData.surface as SurfState | undefined;
  if (s) s.def.value.w = k;
}

const cache = new Map<string, THREE.MeshToonMaterial>();
/**
 * A toon material with surfaces (`toon()` + `withSurfaces`). Shared per options unless `shared: false`.
 * Typical: `surfaceMaterial({ vertexColors: true })` for merged multi-surface meshes (tags pick the surface per
 * vertex), or `surfaceMaterial({ vertexColors: true, surface: 'rock' })` for a single-surface (instanced) mesh.
 */
export function surfaceMaterial(o: SurfaceOpts & ToonOpts & { color?: number } = {}): THREE.MeshToonMaterial {
  const key = JSON.stringify(o);
  if (o.shared !== false) { const m = cache.get(key); if (m) return m; }
  const m = withSurfaces(toon(o.color ?? 0xffffff, { ...o, shared: false }), o);
  if (o.shared !== false) cache.set(key, m);
  return m;
}

// ------------------------------------------------------------------------------------------------ tagging geometry

export interface TagOpts extends SurfTag {
  /** logs: a point on the log's axis (default: the geometry's bounding-box centre); aux = distance from the axis */
  center?: readonly [number, number, number];
  /** explicit aux value (overrides the log ring distance) */
  aux?: number;
}

const AX: Record<string, THREE.Vector3> = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1), h: new THREE.Vector3(0, 1, 0) };
const _v = new THREE.Vector3(), _c = new THREE.Vector3();

function surfaceAttr(g: THREE.BufferGeometry): THREE.BufferAttribute {
  const n = g.attributes.position.count;
  let a = g.attributes.surface as THREE.BufferAttribute | undefined;
  if (!a || a.count !== n || a.itemSize !== 4) { a = new THREE.BufferAttribute(new Float32Array(n * 4), 4); g.setAttribute('surface', a); }
  return a;
}

/**
 * Tag every vertex of `g` (in its current local space: tag parts before transforming/merging them) with a surface.
 * Returns `g`. `mergeGeometries` needs every part to carry the attribute: `ensureSurface` the untagged ones.
 */
export function tagSurface(g: THREE.BufferGeometry, surface: SurfId | SurfName, o: TagOpts = {}): THREE.BufferGeometry {
  const id = idOf(surface);
  const a = surfaceAttr(g);
  const [code, scale, strength] = packSurface(id, o);
  const pos = g.attributes.position;
  const rings = id === SURF.logs && o.aux === undefined;
  const axis = AX[o.axis ?? 'y'];
  if (rings) {
    if (o.center) _c.set(o.center[0], o.center[1], o.center[2]);
    else { g.computeBoundingBox(); g.boundingBox!.getCenter(_c); }
  }
  const arr = a.array as Float32Array;
  for (let i = 0; i < pos.count; i++) {
    let aux = o.aux ?? 0;
    if (rings) { _v.fromBufferAttribute(pos, i).sub(_c); aux = _v.addScaledVector(axis, -_v.dot(axis)).length(); }
    arr[i * 4] = code; arr[i * 4 + 1] = scale; arr[i * 4 + 2] = strength; arr[i * 4 + 3] = aux;
  }
  a.needsUpdate = true;
  return g;
}

/**
 * Tag per triangle by a picker (non-indexed geometry; call after `facet`/`toNonIndexed`). `pick` gets the face
 * normal and centre (local space) and returns a surface (or [surface, tag]); e.g. a box whose top is thatch and
 * sides are plaster, or a rock whose flat tops are moss.
 */
export function tagSurfaceBy(g: THREE.BufferGeometry, pick: (n: THREE.Vector3, c: THREE.Vector3) => SurfId | SurfName | readonly [SurfId | SurfName, SurfTag]): THREE.BufferGeometry {
  if (g.index) throw new Error('tagSurfaceBy: non-indexed geometry only');
  const a = surfaceAttr(g), arr = a.array as Float32Array;
  const p = g.attributes.position;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i + 2 < p.count; i += 3) {
    A.fromBufferAttribute(p, i); B.fromBufferAttribute(p, i + 1); C.fromBufferAttribute(p, i + 2);
    n.subVectors(C, B).cross(_v.subVectors(A, B)).normalize();
    c.copy(A).add(B).add(C).multiplyScalar(1 / 3);
    const r = pick(n, c);
    const [s, t] = Array.isArray(r) ? r as readonly [SurfId | SurfName, SurfTag] : [r as SurfId | SurfName, {}];
    const [code, scale, strength] = packSurface(idOf(s), t);
    for (let k = 0; k < 3; k++) { const j = (i + k) * 4; arr[j] = code; arr[j + 1] = scale; arr[j + 2] = strength; arr[j + 3] = 0; }
  }
  a.needsUpdate = true;
  return g;
}

/** Add an all-inherit `surface` attribute if missing (so untagged parts merge with tagged ones). Returns `g`. */
export function ensureSurface(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const a = g.attributes.surface;
  if (!a || a.count !== g.attributes.position.count) surfaceAttr(g);
  return g;
}
