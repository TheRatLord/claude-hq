/**
 * Tiny low-poly modelling kit for the plots package: primitives painted with a vertex colour, placed with a compact
 * transform, faceted and merged into one geometry per model (one draw call, one material).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash32, mulberry32 } from '../../../../../shared/identity.ts';
import { ensureSurface, tagSurface } from '../surface/index.ts';
import type { SurfId, SurfName, TagOpts } from '../surface/index.ts';
import { paintCode } from './materials.ts';
import { partName, recordParts } from '../parts.ts';
import type { PaintName } from './materials.ts';

export type V3 = readonly [number, number, number];
/** position, rotation [tilt x, yaw y, roll z] applied roll → tilt → yaw (Euler YXZ), scale (uniform or per axis) */
export interface Xf { p?: V3; r?: V3; s?: number | V3 }

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();

export function place(g: THREE.BufferGeometry, t?: Xf): THREE.BufferGeometry {
  if (!t) return g;
  const s = t.s ?? 1;
  _s.set(...(typeof s === 'number' ? [s, s, s] as const : s));
  const r = t.r ?? [0, 0, 0];
  _q.setFromEuler(_e.set(r[0], r[1], r[2], 'YXZ'));
  _v.set(...(t.p ?? [0, 0, 0] as const));
  g.applyMatrix4(_m.compose(_v, _q, _s));
  return g;
}

function finish(g: THREE.BufferGeometry, color: number | THREE.Color, t?: Xf): THREE.BufferGeometry {
  let f = g.index ? g.toNonIndexed() : g;
  f.deleteAttribute('uv');
  f.deleteAttribute('normal');
  f = place(f, t);
  const c = color instanceof THREE.Color ? color : new THREE.Color(color);
  const n = f.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  f.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return f;
}

export const box = (w: number, h: number, d: number, color: number, t?: Xf) => finish(new THREE.BoxGeometry(w, h, d), color, t);
/** paint + place any geometry (for custom shapes) */
export const painted = (g: THREE.BufferGeometry, color: number, t?: Xf) => finish(g, color, t);
/** cylinder standing on y=0 when `base` (default centred) */
export const cyl = (rt: number, rb: number, h: number, seg: number, color: number, t?: Xf) => finish(new THREE.CylinderGeometry(rt, rb, h, seg), color, t);
export const cone = (r: number, h: number, seg: number, color: number, t?: Xf) => finish(new THREE.ConeGeometry(r, h, seg), color, t);
/** low-poly ball: detail 0 = 20 faces, 1 = 80 */
export const ball = (r: number, color: number, t?: Xf, detail = 0) => finish(new THREE.IcosahedronGeometry(r, detail), color, t);
export const dodec = (r: number, color: number, t?: Xf) => finish(new THREE.DodecahedronGeometry(r, 0), color, t);
export const octa = (r: number, color: number, t?: Xf) => finish(new THREE.OctahedronGeometry(r, 0), color, t);
export const sphere = (r: number, ws: number, hs: number, color: number, t?: Xf) => finish(new THREE.SphereGeometry(r, ws, hs), color, t);
export const plane = (w: number, h: number, color: number, t?: Xf) => finish(new THREE.PlaneGeometry(w, h), color, t);
export const torus = (r: number, tube: number, rs: number, ts: number, color: number, t?: Xf, arc = Math.PI * 2) =>
  finish(new THREE.TorusGeometry(r, tube, rs, ts, arc), color, t);

/** A flat leaf: a diamond card with a slight fold, pointing +z from the origin (painted with veins). */
export function leaf(len: number, wid: number, color: number, t?: Xf, fold = 0.25): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const h = wid / 2, f = wid * fold;
  const p = [
    0, 0, 0, -h, f, len * 0.4, 0, 0, len,
    0, 0, 0, 0, 0, len, h, f, len * 0.4,
    // back faces so the card reads from below too
    0, 0, 0, 0, 0, len, -h, f, len * 0.4,
    0, 0, 0, h, f, len * 0.4, 0, 0, len,
  ];
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  // veins: aux = 0 on the midrib (base → tip) … 1 at the side corners
  const code = paintCode('veins'), sa = new Float32Array(12 * 4);
  for (let i = 0; i < 12; i++) sa.set([code, 1, 1, [1, 5, 8, 10].includes(i) ? 1 : 0], i * 4);
  g.setAttribute('surface', new THREE.BufferAttribute(sa, 4));
  return finish(g, color, t);
}

/** Tag a part with a library surface (returns it): `S(box(…), 'planks', { axis: 'h' })`. */
export const S = (g: THREE.BufferGeometry, surf: SurfId | SurfName, o?: TagOpts): THREE.BufferGeometry => tagSurface(g, surf, o);
/** Tag a part with a field-only paint (pumpkin ribs, leaf veins, sunflower seeds, tilled soil). */
export const paint = (g: THREE.BufferGeometry, p: PaintName, strength = 1): THREE.BufferGeometry => {
  tagSurface(g, 'plain', { strength });
  const a = g.attributes.surface.array as Float32Array, code = paintCode(p);
  for (let i = 0; i < a.length; i += 4) a[i] = code;
  return g;
}

/** An extruded prism from a 2D outline in the xy plane, depth along z (centred). */
export function prism(pts: readonly [number, number][], depth: number, color: number, t?: Xf): THREE.BufferGeometry {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return finish(g, color, t);
}

/**
 * Merge painted parts into one faceted geometry (flat normals). Parts flagged `userData.smoothNormals` (foliage blobs
 * from `foliageBlob`) keep their bent normals.
 */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (parts.some((p) => p.attributes.surface)) for (const p of parts) ensureSurface(p);
  const smooth = parts.some((p) => p.userData.smoothNormals && p.attributes.normal);
  if (smooth) for (const p of parts) if (!p.userData.smoothNormals || !p.attributes.normal) p.computeVertexNormals();
  const g = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
  if (!g) throw new Error('[plots] merge failed');
  recordParts(g, parts);
  if (!smooth) g.computeVertexNormals();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

const partCounts = new WeakMap<object, Map<string, number>>();
/** Name everything fn pushes onto `parts` as one placed object `name#n` (provenance for dev tools, scene/parts.ts). */
export function named(parts: THREE.BufferGeometry[], name: string, fn: () => void): void {
  const c = partCounts.get(parts) ?? new Map<string, number>();
  partCounts.set(parts, c);
  const n = c.get(name) ?? 0;
  c.set(name, n + 1);
  const n0 = parts.length;
  fn();
  for (let i = n0; i < parts.length; i++) partName(parts[i], `${name}#${n}`);
}

/** Per-vertex lightness jitter by face, so large merged meshes look hand painted. */
export function jitter(g: THREE.BufferGeometry, k = 0.05, seed = 7): THREE.BufferGeometry {
  const col = g.attributes.color as THREE.BufferAttribute;
  const r = mulberry32(seed);
  for (let i = 0; i < col.count; i += 3) {
    const d = (r() - 0.5) * 2 * k;
    for (let j = i; j < Math.min(col.count, i + 3); j++) col.setXYZ(j, Math.max(0, col.getX(j) + d), Math.max(0, col.getY(j) + d), Math.max(0, col.getZ(j) + d));
  }
  return g;
}

/** Deterministic RNG for a key. */
export const rng = (key: string) => mulberry32(hash32(key));

/** Geometry cache by key (season-dependent keys include the season). */
const cache = new Map<string, THREE.BufferGeometry>();
export function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) { g = make(); cache.set(key, g); }
  return g;
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smooth01 = (v: number) => { const t = clamp01(v); return t * t * (3 - 2 * t); };
/** 0..1 → squash-bounce overshoot curve ending at 1 */
export function bounce(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const c1 = 1.70158 * 1.4, c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}
/** damped approach: move `cur` toward `to` with time constant `k` (per second) */
export const damp = (cur: number, to: number, k: number, dt: number) => cur + (to - cur) * (1 - Math.exp(-k * dt));

const _up = new THREE.Vector3(0, 1, 0), _dir = new THREE.Vector3(), _mid = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
/** A tapered rod from `a` to `b` (radius r0 at a, r1 at b). */
export function rod(a: V3, b: V3, r0: number, r1: number, seg: number, color: number, capped = false): THREE.BufferGeometry {
  _dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _dir.length() || 1e-4;
  _dir.divideScalar(len);
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, !capped);
  _q.setFromUnitVectors(_up, _dir);
  _mid.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  g.applyMatrix4(_m.compose(_mid, _q, _one));
  return finish(g, color);
}

/** Apply raw BufferGeometry ops after painting (rotateX etc. keep colours). */
export const raw = (g: THREE.BufferGeometry, f: (g: THREE.BufferGeometry) => void): THREE.BufferGeometry => { f(g); return g; };
