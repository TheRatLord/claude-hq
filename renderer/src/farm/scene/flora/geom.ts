/** Small geometry helpers for hand-built low-poly plants. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { facet } from '../toon.ts';
import { ensureSurface } from '../surface/index.ts';
import { recordParts } from '../parts.ts';

/**
 * Merge parts that each carry a `color` attribute (and optionally a `surface` tag) into one faceted, non-indexed
 * geometry. Parts flagged `userData.smoothNormals` (foliage with sphere-bent normals) keep their normals; the rest
 * get flat ones.
 */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const smooth = parts.some((p) => p.userData.smoothNormals && p.attributes.normal);
  const clean = parts.map((p) => {
    const keep = smooth && !!p.userData.smoothNormals && !!p.attributes.normal;
    const g = p.index ? p.toNonIndexed() : p;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'color' && k !== 'surface' && !(keep && k === 'normal')) g.deleteAttribute(k);
    if (!g.attributes.color) throw new Error('merge: part without colour');
    if (smooth && !keep) g.computeVertexNormals();
    return ensureSurface(g);
  });
  const m = mergeGeometries(clean)!;
  const g = smooth ? m : facet(m);
  recordParts(g, parts); // provenance of named parts (scene/parts.ts)
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Vertical gradient paint: colour a at y0 to b at y1. */
export function gradient(g: THREE.BufferGeometry, a: THREE.Color | number, b: THREE.Color | number, y0: number, y1: number): THREE.BufferGeometry {
  const ca = a instanceof THREE.Color ? a : new THREE.Color(a), cb = b instanceof THREE.Color ? b : new THREE.Color(b);
  const p = g.attributes.position, c = new Float32Array(p.count * 3), t = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const k = Math.min(1, Math.max(0, (p.getY(i) - y0) / (y1 - y0)));
    t.copy(ca).lerp(cb, k);
    c[i * 3] = t.r; c[i * 3 + 1] = t.g; c[i * 3 + 2] = t.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

/** A tapered blade (2 segments), leaning by `lean` toward +x, then turned by yaw. */
export function blade(h: number, w: number, lean: number, yaw: number, curl = 0.35): THREE.BufferGeometry {
  const pos = [
    -w / 2, 0, 0, w / 2, 0, 0, -w * 0.32 + lean * 0.45, h * 0.55, curl * 0.1, w * 0.32 + lean * 0.45, h * 0.55, curl * 0.1, lean, h, curl * 0.3,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4]);
  g.rotateY(yaw);
  return g;
}

/** Per-face colour jitter on a non-indexed geometry (hand-painted variety). */
export function faceJitter(g: THREE.BufferGeometry, k: number, seed: number): THREE.BufferGeometry {
  const c = g.attributes.color;
  let s = seed >>> 0;
  const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < c.count; i += 3) {
    const m = 1 + (r() - 0.5) * 2 * k;
    for (let j = 0; j < 3 && i + j < c.count; j++) c.setXYZ(i + j, c.getX(i + j) * m, c.getY(i + j) * m, c.getZ(i + j) * m);
  }
  c.needsUpdate = true;
  return g;
}
