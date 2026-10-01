/** Faceted boulders: river rocks, outcrops, pebbles, stepping stones. Vertex coloured, tagged `rock`, deterministic per seed. */
import * as THREE from 'three';
import { mulberry32 } from '../../../../../shared/identity.ts';
import type { Season } from '../../model/types.ts';
import { facet } from '../toon.ts';
import { hash2 } from '../../world/noise.ts';
import { GROUND } from './ground.ts';
import { SURF, tagSurface } from '../surface/index.ts';

export interface RockOpts {
  seed: number;
  season: Season;
  /** ico detail (0 chunky pebble, 1 boulder, 2 big outcrop) */
  detail?: number;
  /** squash y */
  flat?: number;
  /** mossy tops (river/forest rocks) */
  moss?: number;
  /** warm sandstone (1) vs cool granite (0) */
  warm?: number;
  /** stretch along x (slabs, outcrops) */
  stretch?: number;
  /** add dark strata bands */
  strata?: boolean;
}

const c = new THREE.Color(), tmp = new THREE.Color();

/** A unit-ish boulder (radius ≈ 1, sits with its base at y ≈ −0.15 so it looks embedded). */
export function rockGeometry(o: RockOpts): THREE.BufferGeometry {
  const r = mulberry32(o.seed * 7919 + 13);
  const g0 = new THREE.IcosahedronGeometry(1, o.detail ?? 1);
  const pos = g0.attributes.position;
  const flat = o.flat ?? 0.65, stretch = o.stretch ?? 1;
  // plane cuts give big clean facets (a chiselled look instead of a lumpy ball)
  const cuts = Array.from({ length: 9 }, () => ({ n: new THREE.Vector3(r() - 0.5, (r() - 0.25) * 1.1, r() - 0.5).normalize(), t: 0.55 + r() * 0.3 }));
  cuts.push({ n: new THREE.Vector3(0, 1, 0), t: 0.55 + r() * 0.25 });
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // jitter keyed by position (the icosahedron is non-indexed: shared corners must move together)
    v.multiplyScalar(1 + (hash2(Math.round(v.x * 1e3) + o.seed * 131, Math.round(v.y * 1e3) * 7 + Math.round(v.z * 1e3)) - 0.5) * 0.14);
    for (const { n, t } of cuts) { const d = v.dot(n); if (d > t) v.addScaledVector(n, t - d); }
    v.x *= stretch;
    v.y = v.y * flat + (v.y < 0 ? v.y * 0.3 : 0);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g0.computeBoundingBox();
  g0.translate(0, -g0.boundingBox!.min.y - 0.15 * flat, 0);
  const g = facet(g0);
  const p = g.attributes.position, nrm = g.attributes.normal;
  const col = new Float32Array(p.count * 3);
  const warm = o.warm ?? 0.4, moss = o.moss ?? 0, snowy = o.season === 'winter';
  for (let f = 0; f < p.count; f += 3) {
    const ny = (nrm.getY(f) + nrm.getY(f + 1) + nrm.getY(f + 2)) / 3;
    const y = (p.getY(f) + p.getY(f + 1) + p.getY(f + 2)) / 3;
    c.copy(GROUND.rockCool).lerp(GROUND.rockWarm, warm).lerp(GROUND.rock, 0.3);
    c.multiplyScalar(0.9 + r() * 0.2);
    if (o.strata && Math.sin(y * 5 + r() * 0.6) > 0.5) c.lerp(GROUND.rockDark, 0.45);
    if (ny < -0.2) c.lerp(GROUND.rockDark, 0.35); // undersides
    if (moss > 0 && ny > 0.35 && r() < moss + 0.3) c.lerp(o.season === 'autumn' ? tmp.set(0x8a8a40) : GROUND.moss, 0.7 * moss + 0.2);
    if (snowy && ny > 0.45) c.copy(GROUND.snow).lerp(GROUND.snowShade, 1 - ny);
    for (let k = 0; k < 3; k++) { col[(f + k) * 3] = c.r; col[(f + k) * 3 + 1] = c.g; col[(f + k) * 3 + 2] = c.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  tagSurface(g, SURF.rock);
  g.computeBoundingSphere();
  return g;
}
