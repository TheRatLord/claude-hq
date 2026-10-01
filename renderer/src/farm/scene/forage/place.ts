/**
 * Where today's forageables lie. Each spawn (model/collection.ts `forageDay`) gets a spot in its habitat, found by a
 * seeded search so every window agrees: meadows (open grass a short walk off a road, so they are findable), the
 * woods (beside trees, never in a trunk or bush), the water's edge (the pond's beach and the river banks) and the foot
 * of the cliffs (flat ground under a steep rise, near the rim). Never on a road, in a field, in water or a structure;
 * spread apart; set on the lowest ground under the footprint so nothing hovers.
 */
import { rand } from '../../model/collection.ts';
import type { ForageDef, ForageSpawn, Habitat } from '../../model/collection.ts';
import { PATHS, POND, RIVER, RIVER_HALF_WIDTH, SITES, STRUCTURES, WORLD, clearance, distToPolyline, heightAt, inSite, isWater, slopeAt } from '../../world/map.ts';
import { BANK_PEBBLES, FORD_STONES, OUTCROPS, RIVER_ROCKS } from '../terrain/features.ts';

export interface Spot { x: number; y: number; z: number; yaw: number; s: number; habitat: Habitat }
export interface PlaceDeps {
  /** flora trunks / bushes (service 'floraSolids'): is a circle blocked? */
  blocked?(x: number, z: number, r: number): boolean;
}

const STONES = [...OUTCROPS, ...RIVER_ROCKS, ...FORD_STONES, ...BANK_PEBBLES];
const stoneClear = (x: number, z: number, pad: number) => STONES.every((o) => Math.hypot(x - o.x, z - o.z) > o.r * 1.35 + pad);
const pathDist = (x: number, z: number) => { let d = Infinity; for (const p of PATHS) d = Math.min(d, distToPolyline(x, z, p.points) - p.width / 2); return d; };
const ringR = (x: number, z: number) => Math.hypot(x, z * 1.05);
const waterDist = (x: number, z: number) => Math.min(distToPolyline(x, z, RIVER) - RIVER_HALF_WIDTH, Math.hypot(x - POND.x, z - POND.z) - POND.r);
/** footprint: lowest ground under a circle (centre + 8), and how much it varies */
function footprint(x: number, z: number, r: number): { min: number; spread: number } {
  let lo = heightAt(x, z), hi = lo;
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2, h = heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r); lo = Math.min(lo, h); hi = Math.max(hi, h); }
  return { min: lo, spread: hi - lo };
}
/** structure footprints (+ pad), for the shore where clearance() is all water */
const inStructure = (x: number, z: number, pad: number) => STRUCTURES.some((s) => {
  const c = Math.cos(s.yaw), sn = Math.sin(s.yaw), dx = x - s.x, dz = z - s.z;
  const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
  return Math.abs(lx) < s.size[0] / 2 + pad && Math.abs(lz) < s.size[1] / 2 + pad;
});

function candidate(h: Habitat, r: () => number): { x: number; z: number } {
  switch (h) {
    case 'shore': {
      if (r() < 0.45) { const a = r() * Math.PI * 2, d = POND.r + 0.7 + r() * 1.6; return { x: POND.x + Math.cos(a) * d, z: POND.z + Math.sin(a) * d }; }
      // a river bank in the walkable middle reach
      const i = 2 + Math.floor(r() * 6), t = r();
      const a = RIVER[i], b = RIVER[i + 1];
      const px = a.x + (b.x - a.x) * t, pz = a.z + (b.z - a.z) * t;
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1, nx = -(b.z - a.z) / l, nz = (b.x - a.x) / l;
      const side = r() < 0.7 ? 1 : -1, d = RIVER_HALF_WIDTH + 0.7 + r() * 1.6;
      return { x: px + nx * d * side, z: pz + nz * d * side };
    }
    case 'cliff': { const a = r() * Math.PI * 2, d = 78 + r() * 22; return { x: Math.cos(a) * d, z: (Math.sin(a) * d) / 1.05 }; }
    default: { const a = r() * Math.PI * 2, d = 12 + Math.sqrt(r()) * 68; return { x: Math.cos(a) * d, z: Math.sin(a) * d }; }
  }
}

function ok(h: Habitat, x: number, z: number, rad: number, deps: PlaceDeps, taken: readonly Spot[]): boolean {
  if (ringR(x, z) > 104 || isWater(x, z)) return false;
  if (taken.some((t) => Math.hypot(t.x - x, t.z - z) < 7)) return false;
  if (!stoneClear(x, z, 0.4 + rad)) return false;
  if (deps.blocked?.(x, z, 0.55 + rad)) return false;
  const slope = slopeAt(x, z);
  if (h === 'shore') {
    const wd = waterDist(x, z);
    if (wd < 0.5 || wd > 3 || slope > 0.2) return false;
    if (heightAt(x, z) - WORLD.water < 0.06) return false;
    if (pathDist(x, z) < 1.4 || inStructure(x, z, 1.6) || SITES.some((s) => inSite(s, x, z, 1.5))) return false;
    return true;
  }
  if (clearance(x, z) < 1.3 || slope > (h === 'cliff' ? 0.2 : 0.16)) return false;
  if (h === 'meadow') {
    const pd = pathDist(x, z);
    return pd > 1.6 && pd < 16 && !deps.blocked?.(x, z, 2.2);
  }
  if (h === 'wood') return pathDist(x, z) > 1.6 && !!deps.blocked?.(x, z, 3.6);
  // cliff foot: level here, a steep rise within a few metres
  let steep = 0;
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; steep = Math.max(steep, slopeAt(x + Math.cos(a) * 3, z + Math.sin(a) * 3)); }
  return steep > 0.32 && pathDist(x, z) > 1.5;
}

/** A spot for each spawn (in order; spawns that find nowhere are dropped). `radius(id)` = the model's footprint. */
export function placeForage(spawns: readonly ForageSpawn[], defs: (id: string) => ForageDef | undefined, radius: (id: string) => number, deps: PlaceDeps): (Spot & { spawn: ForageSpawn })[] {
  const out: (Spot & { spawn: ForageSpawn })[] = [];
  for (const sp of spawns) {
    const def = defs(sp.id);
    if (!def) continue;
    const r = rand(sp.seed);
    const rad = radius(sp.id) * 1.4;
    // its own habitat first; the woods / meadows if the rare kind finds nowhere today
    const tries: Habitat[] = [def.habitat, def.habitat === 'meadow' ? 'wood' : 'meadow'];
    let hit: Spot | null = null;
    for (const h of tries) {
      for (let i = 0; i < 500 && !hit; i++) {
        const c = candidate(h, r);
        if (!ok(h, c.x, c.z, rad, deps, out)) continue;
        const fp = footprint(c.x, c.z, rad);
        if (fp.spread > 0.06) continue;
        hit = { x: c.x, z: c.z, y: fp.min - 0.008 - fp.spread * 0.6, yaw: r() * Math.PI * 2, s: 1.15 + r() * 0.25, habitat: h };
      }
      if (hit) break;
    }
    if (hit) out.push({ ...hit, spawn: sp });
  }
  return out;
}
