/**
 * Foliage blobs for Ghibli / Wind Waker canopies (flora trees and bushes, orchard trees): per-vertex colour graded
 * from a cool dark interior to warm lit tips, and normals bent round each blob so the toon ramp reads soft volumes.
 * Tagged `leaves` with the blob radius in aux, which the leaves shader uses to wrap its clumps round the blob.
 *
 * ```ts
 * const b = new THREE.IcosahedronGeometry(r, 1).translate(x, y, z);   // lumpy is fine
 * parts.push(foliageBlob(b, new THREE.Vector3(x, y, z), [crownCentre, crownCentre], colours, y0, y1, seed, {}, { aux: r }));
 * ```
 * Merge so the normals survive (flora `merge` and plots `merge` keep them for parts flagged `userData.smoothNormals`).
 */
import * as THREE from 'three';
import { hash2 } from '../../world/noise.ts';
import { SURF } from './ids.ts';
import { tagSurface } from './material.ts';
import type { TagOpts } from './material.ts';

/** dark (interior) and light (lit tips) colours, an optional accent (blossom, autumn tints) and its share */
export interface FoliageColors { dark: THREE.Color; light: THREE.Color; accent?: THREE.Color; p?: number }
const tc = new THREE.Color();

/** A crown's core: foliage normals also lean away from it (a point for round crowns, a segment for hedges). */
export type FoliageCore = readonly [THREE.Vector3, THREE.Vector3];
export interface FoliageOpts {
  /** the blob's vertical squash (its normals are the ellipsoid's) */
  squash?: number;
  /** how much normals lean away from the crown core instead of the blob centre (0..1) */
  crown?: number;
  /** accent faces keep their full share and strength (spring blossom) */
  blossom?: boolean;
  /** upward faces are snow */
  snow?: boolean;
}
const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _k = new THREE.Vector3(), _f = new THREE.Vector3(), _ab = new THREE.Vector3();
const COOL = new THREE.Color(0.84, 0.92, 1.1), WARM = new THREE.Color(1.07, 1.03, 0.88), SNOW = new THREE.Color(0xf2f6fb);

/**
 * Paint a (positioned) foliage blob centred at `c` and bend its normals. Colour grades per vertex (smooth across faces,
 * no per-face noise) from a cool, dark interior to warm, lit tips, by height in the crown, facing up and facing out;
 * accent faces only on the sunny outside (blossom keeps more of them). Normals blend the blob's ellipsoid, the crown
 * core and a hint of the facet, so the toon ramp reads each blob as one soft, rounded volume (the leaves shader
 * then scallops its clumps). Returns the part tagged as leaves, flagged to keep its normals through `merge`.
 */
export function foliageBlob(g0: THREE.BufferGeometry, c: THREE.Vector3, core: FoliageCore, L: FoliageColors, y0: number, y1: number, seed: number,
  o: FoliageOpts = {}, tag: TagOpts = {}): THREE.BufferGeometry {
  const g = g0.index ? g0.toNonIndexed() : g0;
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal;
  const col = new Float32Array(p.count * 3), ex = new Float32Array(p.count);
  const sq = o.squash ?? 1, wc = o.crown ?? 0.2;
  const [a, b] = core;
  _ab.subVectors(b, a);
  const ab2 = Math.max(_ab.lengthSq(), 1e-6);
  const dk = new THREE.Color().copy(L.dark).multiply(COOL), lt = new THREE.Color().copy(L.light).multiply(WARM);
  for (let i = 0; i < p.count; i++) {
    _p.fromBufferAttribute(p, i); _f.fromBufferAttribute(n, i);
    _d.set(_p.x - c.x, (_p.y - c.y) / (sq * sq), _p.z - c.z).normalize();
    const t = Math.min(1, Math.max(0, _k.subVectors(_p, a).dot(_ab) / ab2));
    _k.copy(a).addScaledVector(_ab, t);
    _k.subVectors(_p, _k);
    if (_k.lengthSq() < 1e-6) _k.set(0, 1, 0); else _k.normalize();
    const out = _d.dot(_k);
    _d.multiplyScalar(1 - wc).addScaledVector(_k, wc).normalize().multiplyScalar(0.92).addScaledVector(_f, 0.08).normalize();
    n.setXYZ(i, _d.x, _d.y, _d.z);
    const h = Math.min(1, Math.max(0, (_p.y - y0) / (y1 - y0)));
    let e = Math.min(1, Math.max(0, h * 0.55 + (_d.y * 0.5 + 0.5) * 0.35 + out * 0.2 - 0.08));
    e = e * e * (3 - 2 * e);
    ex[i] = e;
    tc.copy(dk).lerp(lt, e);
    col[i * 3] = tc.r; col[i * 3 + 1] = tc.g; col[i * 3 + 2] = tc.b;
  }
  // accents (blossom, autumn tints): soft clusters picked per vertex position, so they blend across faces
  if (L.accent) {
    const share = (L.p ?? 0.12) * (o.blossom ? 2.4 : 1.6), k = o.blossom ? 0.8 : 0.5, e0 = o.blossom ? 0.25 : 0.4;
    for (let i = 0; i < p.count; i++) {
      const hv = hash2(Math.round(p.getX(i) * 331) + seed * 17, Math.round(p.getY(i) * 337) * 7 + Math.round(p.getZ(i) * 347));
      if (hv > share || ex[i] < e0) continue;
      tc.setRGB(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]).lerp(L.accent, k);
      col[i * 3] = tc.r; col[i * 3 + 1] = tc.g; col[i * 3 + 2] = tc.b;
    }
  }
  // snow caps: whole upward faces
  if (o.snow) for (let i = 0; i + 2 < p.count; i += 3) {
    const ny = (n.getY(i) + n.getY(i + 1) + n.getY(i + 2)) / 3;
    if (ny <= 0.5) continue;
    tc.copy(SNOW).multiplyScalar(0.94 + ny * 0.06);
    for (let k = i; k < i + 3; k++) { col[k * 3] = tc.r; col[k * 3 + 1] = tc.g; col[k * 3 + 2] = tc.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.userData.smoothNormals = true;
  return tagSurface(g, SURF.leaves, tag);
}
