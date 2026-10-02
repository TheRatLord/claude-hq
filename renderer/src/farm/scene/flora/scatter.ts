/**
 * Deterministic flora placement. Forest thickens toward the mountain rim so the valley feels enclosed; groves of one
 * or two species dot the valley floor; willows lean over the water; three big hero trees stand at open spots; grass,
 * flowers, clover, rocks, logs, stumps and mushrooms fill in. Everything respects `clearance()` (paths, plots,
 * structures, water). Pure data: the flora system instances it.
 */
import * as THREE from 'three';
import { seeded } from '../../../core/rng.ts';
import type { Season } from '../../model/types.ts';
import { HANGOUTS, PATHS, POND, RIVER, RIVER_HALF_WIDTH, SITES, STRUCTURES, WORLD, clearance, distToPolyline, heightAt, siteToWorld, slopeAt } from '../../world/map.ts';
import type { XZ } from '../../world/map.ts';
import { fbm, hash2 } from '../../world/noise.ts';
import { sampleGround } from '../terrain/ground.ts';
import { wallDist } from '../terrain/paths.ts';
import { OUTCROPS, RIVER_ROCKS, trickleDist } from '../terrain/features.ts';
import { bloomColors, meadowAt } from '../terrain/meadow.ts';
import type { MeadowAt } from '../terrain/meadow.ts';
import type { IvyDrape } from './ivy.ts';
import type { GroundSample } from '../terrain/ground.ts';
import type { Item } from './cells.ts';
import { SEASON_BIT } from './cells.ts';
import type { BushKind, TreeKind } from './species.ts';

export type FlowerKind = 'daisy' | 'bell' | 'tall';

export interface Scatter {
  trees: Record<TreeKind, Item[]>;
  bushes: Record<BushKind, Item[]>;
  tufts: Item[];
  tuftSamples: GroundSample[];
  tall: Item[];
  tallSamples: GroundSample[];
  /** small dense clumps around the open-ground tufts (drawn near the camera only); samples = their parent tuft's */
  short: Item[];
  shortSamples: GroundSample[];
  flowers: Record<FlowerKind, Item[]>;
  /** per flower item: palette slot (recoloured per season) */
  flowerSlot: Map<Item, number>;
  clover: Item[];
  rocks: Item[];
  logs: Item[];
  stumps: Item[];
  mushrooms: Item[];
  /** ivy drapes hanging over the cliff strata ledges, in clusters (ivy.ts walks them down their risers) */
  ivy: IvyDrape[];
  molehills: Item[];
  heroes: XZ[];
}

const ss = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const ringR = (x: number, z: number) => Math.hypot(x, z * 1.05);
const FALL: XZ = { x: -25, z: -104 };
/** Spots kept open for people: the spawn, the hangouts, and the river overlook by the bridge. */
const OPEN: readonly (XZ & { r: number })[] = [
  { ...WORLD.spawn, r: 7 }, { x: -44, z: 12, r: 7 }, { x: 28, z: 40, r: 5 },
  ...HANGOUTS.map((h) => ({ x: h.x, z: h.z, r: 4.5 })),
];
const inOpen = (x: number, z: number) => OPEN.some((o) => Math.hypot(x - o.x, z - o.z) < o.r);
/** Distance to the edge of the nearest outcrop / river boulder (their rendered footprint is about 1.35 r). */
const STONES = [...OUTCROPS, ...RIVER_ROCKS];
const stoneDist = (x: number, z: number) => { let d = Infinity; for (const o of STONES) d = Math.min(d, Math.hypot(x - o.x, z - o.z) - o.r * 1.35); return d; };
/** Canopy radius per kind at scale 1 (spacing: neighbours may interleave their crowns, not fuse them). */
const CROWN: Record<TreeKind, number> = { round: 2.0, lolly: 1.6, bushy: 2.0, oak: 2.6, birch: 1.5, pine: 2.2, fir: 1.7, willow: 2.8, hero: 4.0 };
/** Height of the lowest crown tier above the trunk base at scale 1. */
const CROWN_BASE: Record<TreeKind, number> = { round: 2.0, lolly: 2.0, bushy: 1.5, oak: 2.0, birch: 2.2, pine: 1.1, fir: 0.8, willow: 1.2, hero: 2.5 };
/** Does the hillside rise into the lower crown (a tree on a cliff with its branches in the rock)? */
const crownInSlope = (kind: TreeKind, x: number, z: number, y: number, s: number, rk = 1) => {
  const r = CROWN[kind] * s * 0.8 * rk, top = y + CROWN_BASE[kind] * s * 0.7;
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; if (heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r) > top) return true; }
  return false;
};
/** Does the ground anywhere within radius r (two rings) rise above `top`? (a strata riser behind a ledge plant) */
const slopeRises = (x: number, z: number, r: number, top: number) => {
  for (const k of [0.5, 1]) for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; if (heightAt(x + Math.cos(a) * r * k, z + Math.sin(a) * r * k) > top) return true; }
  return false;
};
/**
 * Ground under a footprint of radius r (centre + 8 around): sit a prop on the lowest point so no side hovers, and
 * reject spots where the spread would bury its uphill side.
 */
function footprint(x: number, z: number, r: number): { min: number; spread: number } {
  let lo = heightAt(x, z), hi = lo;
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2, h = heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r); if (h < lo) lo = h; if (h > hi) hi = h; }
  return { min: lo, spread: hi - lo };
}
const nearWater = (x: number, z: number) => Math.min(distToPolyline(x, z, RIVER) - RIVER_HALF_WIDTH, Math.hypot(x - POND.x, z - POND.z) - POND.r);

/** Open spots for the hero trees: the most clearance near each wish. */
function heroSpots(): XZ[] {
  const wishes: XZ[] = [{ x: -20, z: 58 }, { x: 30, z: -18 }, { x: -44, z: 22 }];
  return wishes.map((w) => {
    let best = w, bc = -Infinity;
    for (let dz = -22; dz <= 22; dz += 2) for (let dx = -22; dx <= 22; dx += 2) {
      const x = w.x + dx, z = w.z + dz;
      const c = Math.min(clearance(x, z), 12) - Math.hypot(dx, dz) * 0.12 - slopeAt(x, z) * 30;
      if (c > bc) { bc = c; best = { x, z }; }
    }
    return best;
  });
}

/** Instance tint around white: overall lightness ±l/2, warm/cool shift ±h/2. */
const tint = (r: () => number, l: number, h = 0.03) => { const k = 1 + (r() - 0.5) * l, w = (r() - 0.5) * h; return new THREE.Color(k + w, k, k - w); };

export function scatter(): Scatter {
  const out: Scatter = {
    trees: { round: [], lolly: [], bushy: [], oak: [], birch: [], pine: [], fir: [], willow: [], hero: [] },
    bushes: { bush: [], berry: [], hedge: [] },
    tufts: [], tuftSamples: [], tall: [], tallSamples: [], short: [], shortSamples: [],
    flowers: { daisy: [], bell: [], tall: [] }, flowerSlot: new Map(),
    clover: [], rocks: [], logs: [], stumps: [], mushrooms: [], ivy: [], molehills: [], heroes: heroSpots(),
  };
  const H = WORLD.half - 2;
  const trees: XZ[] = [];
  // spatial hash for tree spacing (the list gets long)
  const grid = new Map<string, (XZ & { r: number })[]>();
  const gk = (x: number, z: number) => `${Math.floor(x / 8)},${Math.floor(z / 8)}`;
  const addTree = (kind: TreeKind, x: number, z: number, s: number, r: () => number, sink = 0.1, crownK = 1) => {
    // low-skirted conifers keep their lowest tier off the old stone walls
    if (wallDist(x, z) < (CROWN_BASE[kind] < 1.5 ? Math.max(1.5, CROWN[kind] * s * 1.05) : 1.5) || inOpen(x, z) || stoneDist(x, z) < 0.6 + CROWN[kind] * s * 0.5) return;
    if (trickleDist(x, z) < 1.2 + CROWN[kind] * s * 0.6) return;
    if (!spaced(x, z, 0, CROWN[kind] * s)) return;
    const fp = footprint(x, z, 0.3 * s);
    if (fp.spread > 0.45) return; // too steep under the trunk: its uphill side would vanish into the slope
    const y = fp.min - sink; // the trunk's downhill side meets the ground
    if (crownInSlope(kind, x, z, y, s, crownK)) return;
    // up on the strata wall: no riser right behind the trunk (it would swallow the lower crown)
    if (ringR(x, z) > 92 && ((slopeRises(x, z, CROWN[kind] * s * 0.9, y + 0.3 + CROWN_BASE[kind] * s * 0.2) || slopeRises(x, z, CROWN[kind] * s * 1.15, y + CROWN_BASE[kind] * s * 0.6)) || footprint(x, z, 0.55 * s).spread > 0.3)) return;
    const it: Item = { x, y, z, s, yaw: r() * Math.PI * 2, tint: tint(r, kind === 'pine' || kind === 'fir' ? 0.16 : 0.12, 0.06), tx: (r() - 0.5) * 0.08, tz: (r() - 0.5) * 0.08 };
    out.trees[kind].push(it);
    const p = { x, z, r: CROWN[kind] * s };
    trees.push(p);
    const k = gk(x, z);
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(p);
  };
  /** at least `gap` from every tree, and (for a tree of crown radius r) crowns overlapping by no more than ~30% */
  const spaced = (x: number, z: number, gap: number, r = 0) => {
    const reach = Math.max(gap, r * 2 + 1);
    const i0 = Math.floor((x - reach) / 8), i1 = Math.floor((x + reach) / 8), j0 = Math.floor((z - reach) / 8), j1 = Math.floor((z + reach) / 8);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (const t of grid.get(`${i},${j}`) ?? []) {
      const d = Math.hypot(t.x - x, t.z - z);
      if (d < gap || (r && d < 0.7 * (r + t.r))) return false;
    }
    return true;
  };

  // hero trees first (everything else keeps its distance)
  const rh = seeded('flora:hero');
  out.heroes.forEach((p, i) => { if (i === 2) addTree('willow', p.x, p.z, 1.9, rh); else addTree('hero', p.x, p.z, i === 0 ? 1.25 : 1.0, rh, 0.3); });

  // willows along the water
  const rw = seeded('flora:willows');
  for (let i = 0; i < 160; i++) {
    const t = rw();
    let x: number, z: number;
    if (i % 5 === 0) { const a = rw() * 6.28; x = POND.x + Math.cos(a) * (POND.r + 4 + rw() * 2); z = POND.z + Math.sin(a) * (POND.r + 4 + rw() * 2); }
    else {
      const k = Math.min(RIVER.length - 2, Math.floor(t * (RIVER.length - 1))), f = t * (RIVER.length - 1) - k;
      const a = RIVER[k], b = RIVER[k + 1], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
      const side = rw() < 0.5 ? -1 : 1, off = RIVER_HALF_WIDTH + 5 + rw() * 3;
      x = a.x + dx * f - (dz / l) * off * side; z = a.z + dz * f + (dx / l) * off * side;
    }
    if (ringR(x, z) > 112 || clearance(x, z) < 1.2 || heightAt(x, z) > 8 || slopeAt(x, z) > 0.3 || !spaced(x, z, 6)) continue;
    if (rw() < 0.3) continue;
    addTree('willow', x, z, 0.85 + rw() * 0.35, rw);
  }

  // forest: pines/firs on the foothills and lower slopes, thickest at the rim
  const rf = seeded('flora:forest');
  for (let z = -H; z < H; z += 3.6) for (let x = -H; x < H; x += 3.6) {
    const px = x + (rf() - 0.5) * 3.4, pz = z + (rf() - 0.5) * 3.4;
    const R = ringR(px, pz);
    if (R < 62) { rf(); continue; }
    const h = heightAt(px, pz);
    const sl = slopeAt(px, pz);
    const n = fbm(px / 34 + 11, pz / 34 - 5, 3);
    const dens = ss(64, 96, R) * (1 - ss(34, 44, h)) * (1 - ss(0.42, 0.62, sl)) * (0.55 + 0.6 * ss(-0.4, 0.4, n));
    if (rf() > dens * 0.95) continue;
    if (h < WORLD.water + 0.8 || nearWater(px, pz) < 3.5 || clearance(px, pz) < 3) continue;
    if (Math.hypot(px - FALL.x, pz - FALL.z) < 16) continue;
    if (!spaced(px, pz, 2.6)) continue;
    const deciduous = R < 88 && rf() < 0.3 * (1 - ss(78, 90, R));
    const kind: TreeKind = deciduous ? (rf() < 0.5 ? 'birch' : 'round') : rf() < 0.55 ? 'pine' : 'fir';
    addTree(kind, px, pz, 0.85 + rf() * 0.45 + ss(90, 120, R) * 0.2, rf, 0.2);
  }

  // valley groves: each grove leans to one or two species
  const rg = seeded('flora:groves');
  const groveKinds: TreeKind[][] = [['round', 'lolly'], ['oak', 'round'], ['birch', 'birch', 'lolly'], ['bushy', 'round'], ['oak', 'bushy'], ['birch', 'pine']];
  for (let z = -H; z < H; z += 5) for (let x = -H; x < H; x += 5) {
    const px = x + (rg() - 0.5) * 4.6, pz = z + (rg() - 0.5) * 4.6;
    const R = ringR(px, pz);
    if (R > 90) continue;
    const g = fbm(px / 42 - 3, pz / 42 + 8, 3);
    const p = g > 0.05 ? 0.3 + 0.55 * ss(0.05, 0.4, g) : 0.08;
    if (rg() > p) continue;
    if (clearance(px, pz) < 2.4 || nearWater(px, pz) < 4 || !spaced(px, pz, 3.7)) continue;
    const set = groveKinds[Math.floor(hash2(Math.floor(px / 40), Math.floor(pz / 40)) * groveKinds.length)];
    addTree(set[Math.floor(rg() * set.length)], px, pz, 0.8 + rg() * 0.45, rg);
  }

  const bushAt: (XZ & { r: number })[] = [];
  // bushes: forest edges, grove margins, a few hedges along clear strips
  const rb = seeded('flora:bushes');
  for (let z = -H; z < H; z += 4) for (let x = -H; x < H; x += 4) {
    const px = x + (rb() - 0.5) * 3.8, pz = z + (rb() - 0.5) * 3.8;
    const R = ringR(px, pz);
    if (R > 108) continue;
    const g = fbm(px / 42 - 3, pz / 42 + 8, 3);
    const edge = ss(60, 80, R) * (1 - ss(96, 108, R));
    const p = 0.05 + edge * 0.3 + ss(0.1, 0.35, g) * 0.25;
    if (rb() > p) continue;
    const c = clearance(px, pz);
    if (c < 1.3 || nearWater(px, pz) < 1.5 || slopeAt(px, pz) > 0.5 || !spaced(px, pz, 1.8) || wallDist(px, pz) < 1.2 || stoneDist(px, pz) < 1) continue;
    const kind: BushKind = rb() < 0.25 ? 'berry' : 'bush';
    const bs = 0.75 + rb() * 0.6, yaw = rb() * 6.28, bt = tint(rb, 0.14, 0.05);
    const fp = footprint(px, pz, 0.8 * bs);
    if (fp.spread > Math.min(0.4 * bs, 0.42) || slopeRises(px, pz, 1.1 * bs, fp.min + 0.45 * bs)) continue; // too steep: the uphill half would vanish into the slope
    if (bushAt.some((b) => Math.hypot(b.x - px, b.z - pz) < 0.75 * (b.r + 0.9 * bs))) continue; // two bushes fused into one blob
    bushAt.push({ x: px, z: pz, r: 0.9 * bs });
    out.bushes[kind].push({ x: px, y: fp.min - 0.06, z: pz, s: bs, yaw, tint: bt });
  }

  // cliff strata: bushes and small pines cling to the shelves, ivy hangs over the ledges (terraced wall, map.ts)
  const rl = seeded('flora:ledges');
  for (let z = -H; z < H; z += 2.3) for (let x = -H; x < H; x += 2.3) {
    const px = x + (rl() - 0.5) * 2.1, pz = z + (rl() - 0.5) * 2.1;
    const roll = rl(), pick = rl();
    const R = ringR(px, pz);
    if (R < 92 || R > 150) continue;
    const h = heightAt(px, pz);
    if (h < 8 || h > 42 || slopeAt(px, pz) > 0.22 || trickleDist(px, pz) < 2.5 || Math.hypot(px - FALL.x, pz - FALL.z) < 22) continue;
    if (clearance(px, pz) < 1.2) continue; // the summit trail's tread and landings (world/trail.ts)
    // outward (up the wall) and inward (toward the valley): a shelf has a riser behind it and/or a drop in front
    const ox = px / Math.hypot(px, pz), oz = pz / Math.hypot(px, pz);
    const behind = heightAt(px + ox * 3, pz + oz * 3) - h;
    const front = h - heightAt(px - ox * 1.4, pz - oz * 1.4);
    if (behind < 1.8 && front < 1.2) continue;
    if (front > 1.2 && heightAt(px - ox * 0.35, pz - oz * 0.35) > h - 0.25 && roll < 0.9) {
      // ivy drapes from the lip, in clusters: a few ledges carry long runs of curtains, most stay bare rock
      const heavy = ss(-0.25, 0.2, fbm(px / 46 + 11, pz / 46 - 7, 2));
      if (rl() > 0.02 + 0.98 * heavy) continue;
      let drop = 0;
      for (let k = 0.5; k <= 5; k += 0.5) drop = Math.max(drop, h - heightAt(px - ox * k, pz - oz * k));
      if (drop < 2) continue;
      // never a lone speck: even an outlier is a proper curtain, and the heavy ledges carry long, wide runs
      const w = 1.9 + rl() * 1.4 + heavy * 2.4;
      const len = Math.min(drop * 0.92, 1.9 + rl() * 1.3 + heavy * 2);
      if (trickleDist(px, pz) < 1.5 + w * 0.5 || clearance(px, pz) < 1 + w * 0.5 || stoneDist(px, pz) < 1 + w * 0.5 || !spaced(px, pz, 0.8 + w * 0.3) || bushAt.some((b) => Math.hypot(b.x - px, b.z - pz) < b.r + w * 0.45)
        || out.ivy.some((q) => Math.hypot(q.x - px, q.z - pz) < (q.w + w) * 0.42)) continue;
      out.ivy.push({ x: px, z: pz, dx: -ox, dz: -oz, w, len, seed: Math.floor(rl() * 1e6) });
      continue;
    }
    if (front > 1.2 || roll > 0.55) continue;
    if (pick < 0.3 && slopeAt(px, pz) < 0.14 && h < 36) {
      addTree(rl() < 0.6 ? 'pine' : 'fir', px, pz, 0.42 + rl() * 0.3, rl, 0.15);
    } else {
      const bs = 0.5 + rl() * 0.45, fp = footprint(px, pz, 1.05 * bs);
      if (fp.spread > 0.26 * bs || slopeRises(px, pz, 1.6 * bs, fp.min + 0.3 * bs) || stoneDist(px, pz) < 1.2 || !spaced(px, pz, 2.6) || bushAt.some((b) => Math.hypot(b.x - px, b.z - pz) < 0.75 * (b.r + 0.9 * bs))) continue;
      bushAt.push({ x: px, z: pz, r: 0.9 * bs });
      out.bushes[rl() < 0.2 ? 'berry' : 'bush'].push({ x: px, y: fp.min - 0.05, z: pz, s: bs, yaw: rl() * 6.28, tint: tint(rl, 0.16, 0.06) });
    }
  }

  // hedgerows: along the farm tracks (runs with gaps) and round the back and sides of the field sites, never on a
  // road, a plot or a structure; now and then a hedgerow oak or round tree stands in the line
  const rhg = seeded('flora:hedgerows');
  let sinceTree = 0;
  const hedge = (x: number, z: number, dx: number, dz: number) => {
    const R = ringR(x, z);
    if (R < 24 || R > 88 || Math.hypot(x, z + 1) < 26) return;
    let ok = clearance(x, z) > 1.1;
    for (const e of [-1.6, 1.6]) ok = ok && clearance(x + dx * e, z + dz * e) > 0.9;
    if (!ok || nearWater(x, z) < 2.5 || wallDist(x, z) < 2 || stoneDist(x, z) < 1.2 || inOpen(x, z) || trickleDist(x, z) < 3 || slopeAt(x, z) > 0.18) return;
    if (++sinceTree > 6 && rhg() < 0.3 && clearance(x, z) > 2.6 && footprint(x, z, 1.3).spread < 0.18) {
      const n = out.trees.oak.length + out.trees.round.length;
      addTree(rhg() < 0.6 ? 'oak' : 'round', x, z, 0.75 + rhg() * 0.3, rhg);
      if (out.trees.oak.length + out.trees.round.length > n) { sinceTree = 0; return; }
    }
    if (!spaced(x, z, 2.2) || bushAt.some((q) => Math.hypot(q.x - x, q.z - z) < q.r + 0.8)) return;
    // a hedge is ~3.8 m long at scale 1: neighbours in a row overlap a little (step 2.6 m) so a run reads as one
    // continuous hedge, not a dotted line, from above
    if (out.bushes.hedge.some((q) => Math.hypot(q.x - x, q.z - z) < 2.4)) return;
    const hs = 0.8 + rhg() * 0.08, fp = footprint(x, z, 1.4);
    if (fp.spread > 0.32) return;
    bushAt.push({ x, z, r: 0.75 });
    out.bushes.hedge.push({ x, y: fp.min - 0.04, z, s: hs, sy: 0.9 + rhg() * 0.25, yaw: Math.atan2(-dz, dx) + (rhg() - 0.5) * 0.12, tint: tint(rhg, 0.1, 0.05) });
  };
  for (const [pi, path] of PATHS.entries()) {
    const pts = path.points;
    for (const side of [-1, 1]) {
      let d = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
        for (let t = 0; t < l; t += 2.6, d += 2.6) {
          // runs of hedge where a slow noise along the track says so (hash per path and side)
          if (fbm(d / 26 + pi * 7.3 + side * 3.1, pi * 1.7) < -0.08) continue;
          const off = path.width / 2 + 2;
          hedge(a.x + dx * (t / l) - (dz / l) * off * side, a.z + dz * (t / l) + (dx / l) * off * side, dx / l, dz / l);
        }
      }
    }
  }
  for (const site of SITES) {
    // back (−lz) and both sides; the front is the gate side
    const c = Math.cos(site.yaw), sn = Math.sin(site.yaw);
    const edges: [number, number, number, number][] = [
      [-site.w / 2 - 0.5, -site.d / 2 - 2.1, site.w / 2 + 0.5, -site.d / 2 - 2.1],
      [-site.w / 2 - 2.1, -site.d / 2 - 0.5, -site.w / 2 - 2.1, site.d / 2 - 1],
      [site.w / 2 + 2.1, -site.d / 2 - 0.5, site.w / 2 + 2.1, site.d / 2 - 1],
    ];
    for (const [ax, az, bx, bz] of edges) {
      const l = Math.hypot(bx - ax, bz - az);
      // edge direction in world space (local x → (c, −s), local z → (s, c))
      const lx = (bx - ax) / l, lz = (bz - az) / l, wx = lx * c + lz * sn, wz = -lx * sn + lz * c;
      for (let t = 1.2; t < l - 1; t += 2.6) {
        const p = siteToWorld(site, ax + lx * t, az + lz * t);
        if (fbm(p.x / 14 + 4, p.z / 14 - 2) < -0.25) continue;
        hedge(p.x, p.z, wx, wz);
      }
    }
  }

  // ground cover: short grass everywhere open, tall grass in meadows, clover, wildflower patches
  const rt = seeded('flora:tufts'), rsh = seeded('flora:short');
  const md: MeadowAt = { clover: 0, sun: 0, bloom: 0, slot: 0 };
  const step = 1.05;
  for (let z = -120; z < 120; z += step) for (let x = -124; x < 124; x += step) {
    const px = x + (rt() - 0.5) * step * 0.95, pz = z + (rt() - 0.5) * step * 0.95;
    const R = ringR(px, pz);
    const roll = rt(), roll2 = rt();
    if (R > 122) continue;
    const meadow = fbm(px / 30 + 3.1, pz / 30 - 7.7, 3);
    const dens = 0.55 + 0.35 * ss(-0.2, 0.4, meadow) - ss(95, 120, R) * 0.4;
    if (roll > dens) continue;
    const h = heightAt(px, pz);
    if (h < WORLD.water + 0.15) continue;
    const c = clearance(px, pz);
    if (c < 0.25 && nearWater(px, pz) > 1.5) continue;
    if (h > 26 || slopeAt(px, pz) > 0.45) continue;
    { const bx = px - POND.x, bz = pz - POND.z, bd = Math.hypot(bx, bz); if (bd < POND.r + 7 && (bx * 0.26 + bz * 0.97) / bd > 0.25) continue; }
    const sm = sampleGround(px, pz, h);
    meadowAt(px, pz, md);
    // tall grass in the meadows, and in rough clumps across the sunny bleached patches
    const tall = c > 2.2 && ((meadow > 0.05 && roll2 < 0.45 + meadow * 0.5) || (md.sun > 0.5 && roll2 < 0.4));
    const it: Item = { x: px, y: h - 0.03, z: pz, s: (0.8 + rt() * 0.5 + (c > 3 ? 0.15 : 0)) * (c < 1.2 ? 0.75 : 1), yaw: rt() * 6.28, sy: (0.8 + rt() * 0.5) * (c < 1.2 ? 0.7 : 1) };
    // keep off the painted path dirt (its edge sits at path ≈ 0.45); tufts right at the edge creep over it
    if (sm.path > 0.4) continue;
    // a wide tall tuft on a slope buries its uphill blades: smaller clumps there
    if (tall) { it.s *= 1 - Math.min(0.4, slopeAt(px, pz) * 4); out.tall.push(it); out.tallSamples.push(sm); } else { out.tufts.push(it); out.tuftSamples.push(sm); }
    // a little crowd of small soft clumps around it: dense, varied ground cover near the camera
    if (sm.path < 0.2) {
      const k = 2 + Math.floor(rsh() * 3);
      for (let i = 0; i < k; i++) {
        const a = rsh() * 6.28, d = 0.25 + rsh() * 0.45;
        const sx = px + Math.cos(a) * d, sz = pz + Math.sin(a) * d;
        if (c < 1 && clearance(sx, sz) < 0.3) continue;
        out.short.push({ x: sx, y: heightAt(sx, sz) - 0.02, z: sz, s: 0.75 + rsh() * 0.6, yaw: rsh() * 6.28, sy: 0.7 + rsh() * 0.6 });
        out.shortSamples.push(sm);
      }
    }
    // clover close to the edges of paths and in lawns, thick in the painted clover drifts (meadow.ts)
    const cl = rt();
    if (c > 0.3 && (cl < (c < 2.5 ? 0.07 : 0) + md.clover * 0.45)) out.clover.push({ x: px + 0.3, y: h - 0.02, z: pz - 0.2, s: 0.8 + rt() * 0.6, yaw: rt() * 6.28, seasons: 15 });
    // wildflowers thick in the painted drifts, in the drift's colour (flowerColor slots 6..8)
    if (md.bloom > 0.4 && c > 0.8 && rt() < 0.32 * md.bloom && h < 22) {
      const fx = px + (rt() - 0.5) * 0.6, fz = pz + (rt() - 0.5) * 0.6, kr = rt();
      const kind: FlowerKind = kr < 0.55 ? 'daisy' : kr < 0.75 ? 'bell' : 'tall';
      const it: Item = { x: fx, y: heightAt(fx, fz) - 0.02, z: fz, s: 0.8 + rt() * 0.5, yaw: rt() * 6.28, seasons: SEASON_BIT.spring | SEASON_BIT.summer | (rt() < 0.5 ? SEASON_BIT.autumn : 0), tint: new THREE.Color(1, 1, 1) };
      out.flowers[kind].push(it);
      out.flowerSlot.set(it, 6 + md.slot);
    }
  }

  // wildflower patches (colour slot per patch; the flora system paints them per season)
  const rfl = seeded('flora:flowers');
  for (let z = -115; z < 115; z += 3) for (let x = -118; x < 118; x += 3) {
    const n = fbm(x / 16 - 9, z / 16 + 2, 3);
    if (n < 0.3 || rfl() > 0.75) continue;
    const slot = Math.floor(hash2(Math.floor(x / 9) + 7, Math.floor(z / 9) - 3) * 6);
    const count = 3 + Math.floor(rfl() * 6);
    for (let i = 0; i < count; i++) {
      const px = x + (rfl() - 0.5) * 3.4, pz = z + (rfl() - 0.5) * 3.4;
      if (ringR(px, pz) > 110) continue;
      const h = heightAt(px, pz);
      if (h < WORLD.water + 0.3 || h > 22 || clearance(px, pz) < 0.7 || slopeAt(px, pz) > 0.4) continue;
      const kind: FlowerKind = rfl() < 0.5 ? 'daisy' : rfl() < 0.55 ? 'bell' : 'tall';
      const seasons = SEASON_BIT.spring | SEASON_BIT.summer | (rfl() < 0.35 ? SEASON_BIT.autumn : 0);
      const it: Item = { x: px, y: h - 0.02, z: pz, s: 0.8 + rfl() * 0.5, yaw: rfl() * 6.28, seasons, tint: new THREE.Color(1, 1, 1) };
      out.flowers[kind].push(it);
      out.flowerSlot.set(it, (slot + (rfl() < 0.25 ? 1 : 0)) % 6);
    }
  }

  // rocks, logs, stumps, mushrooms
  const rr = seeded('flora:props');
  for (let z = -H; z < H; z += 7) for (let x = -H; x < H; x += 7) {
    const px = x + (rr() - 0.5) * 6.5, pz = z + (rr() - 0.5) * 6.5;
    const R = ringR(px, pz), roll = rr();
    if (R > 118) continue;
    const c = clearance(px, pz);
    if (c < 1.5 || nearWater(px, pz) < 1 || wallDist(px, pz) < 1.5 || stoneDist(px, pz) < 1) continue;
    const h = heightAt(px, pz);
    const forest = ss(66, 92, R);
    const near = trees.length && !spaced(px, pz, 5);
    const byBush = bushAt.some((b) => Math.hypot(b.x - px, b.z - pz) < b.r + 2.2); // hedges and bushes keep their room
    // slope-aware: props sit on the lowest ground under their footprint, and skip spots too steep for them (and trunks: a stump inside a fir)
    if (byBush && roll < 0.13 + forest * 0.16) continue;
    if (roll < 0.08 + forest * 0.08) {
      const s = 0.35 + rr() * 0.6 + forest * 0.5, yaw = rr() * 6.28, sy = 0.8 + rr() * 0.5, fp = footprint(px, pz, 0.8 * s);
      if (fp.spread < 0.5 * s * sy && spaced(px, pz, 1.2) && !slopeRises(px, pz, 1.1 * s, fp.min + 0.45 * s * sy)) out.rocks.push({ x: px, y: Math.min(h - 0.1, fp.min + 0.05), z: pz, s, yaw, sy });
    } else if (roll < 0.1 + forest * 0.12 && slopeAt(px, pz) < 0.3 && c > 2.5) {
      const s = 0.8 + rr() * 0.4, yaw = rr() * 6.28, fp = footprint(px, pz, 1.1 * s);
      if (fp.spread < 0.2 && spaced(px, pz, 1.8)) out.logs.push({ x: px, y: fp.min - 0.03, z: pz, s, yaw });
    } else if (roll < 0.13 + forest * 0.16) {
      const s = 0.8 + rr() * 0.5, yaw = rr() * 6.28, fp = footprint(px, pz, 0.55 * s);
      if (fp.spread < Math.min(0.22 * s, 0.24) && spaced(px, pz, 1.6)) out.stumps.push({ x: px, y: fp.min - 0.04, z: pz, s, yaw });
    }
    else if (near && roll < 0.3 && spaced(px, pz, 1.1)) {
      const autumnOnly = rr() < 0.65;
      out.mushrooms.push({ x: px, y: h - 0.02, z: pz, s: 0.9 + rr() * 0.6, yaw: rr() * 6.28, seasons: autumnOnly ? SEASON_BIT.autumn : SEASON_BIT.autumn | SEASON_BIT.summer | SEASON_BIT.spring });
    }
  }
  // fairy rings: mushrooms in a circle out in the open meadow (summer and autumn)
  const rm = seeded('flora:rings');
  for (let tries = 0, rings = 0; tries < 1500 && rings < 9; tries++) {
    const a = rm() * 6.28, d = 22 + rm() * 62, cx = Math.cos(a) * d, cz = Math.sin(a) * d, rad = 1.5 + rm() * 1.1;
    if (clearance(cx, cz) < rad + 1.5 || slopeAt(cx, cz) > 0.12 || STRUCTURES.some((st) => Math.hypot(st.x - cx, st.z - cz) < Math.max(st.size[0], st.size[1]) / 2 + 7 + rad) || nearWater(cx, cz) < 4 || !spaced(cx, cz, rad + 1.5) || wallDist(cx, cz) < rad + 2) continue;
    if (bushAt.some((b) => Math.hypot(b.x - cx, b.z - cz) < b.r + rad + 1) || stoneDist(cx, cz) < rad + 1) continue;
    rings++;
    const n = 9 + Math.floor(rm() * 5);
    for (let i = 0; i < n; i++) {
      if (rm() < 0.12) continue; // a gap or two
      const t = (i / n) * 6.28 + (rm() - 0.5) * 0.25, rr = rad * (0.92 + rm() * 0.16);
      const x = cx + Math.cos(t) * rr, z = cz + Math.sin(t) * rr;
      if (out.mushrooms.some((m) => Math.hypot(m.x - x, m.z - z) < 0.8)) continue;
      out.mushrooms.push({ x, y: footprint(x, z, 0.22).min - 0.01, z, s: 0.75 + rm() * 0.4, yaw: rm() * 6.28, seasons: SEASON_BIT.summer | SEASON_BIT.autumn });
    }
  }

  // molehills: little runs of fresh earth mounds across the open grass
  const rmh = seeded('flora:molehills');
  for (let tries = 0, runs = 0; tries < 600 && runs < 16; tries++) {
    const a = rmh() * 6.28, d = 18 + rmh() * 70;
    let x = Math.cos(a) * d, z = Math.sin(a) * d, dir = rmh() * 6.28;
    if (clearance(x, z) < 3 || slopeAt(x, z) > 0.15 || nearWater(x, z) < 4 || inOpen(x, z)) continue;
    runs++;
    const n = 3 + Math.floor(rmh() * 4);
    for (let i = 0; i < n; i++) {
      x += Math.sin(dir) * (0.9 + rmh() * 0.9); z += Math.cos(dir) * (0.9 + rmh() * 0.9); dir += (rmh() - 0.5) * 1.2;
      const s = 0.7 + rmh() * 0.5;
      if (clearance(x, z) < 1.2 || !spaced(x, z, 1.2) || [...out.stumps, ...out.logs, ...out.rocks].some((q) => Math.hypot(q.x - x, q.z - z) < 1.3 + q.s) || wallDist(x, z) < 1 || stoneDist(x, z) < 0.6 || bushAt.some((b) => Math.hypot(b.x - x, b.z - z) < b.r + 0.4)) continue;
      const fp = footprint(x, z, 0.32 * s);
      if (fp.spread > 0.08) continue;
      out.molehills.push({ x, y: fp.min, z, s, sy: 0.7 + rmh() * 0.4, yaw: rmh() * 6.28 });
    }
  }
  return out;
}

const BLOOM: [THREE.Color, THREE.Color, THREE.Color] = [new THREE.Color(), new THREE.Color(), new THREE.Color()];
/** Wildflower colours by season and palette slot (6..8: the painted drift colours, meadow.ts). */
export function flowerColor(season: Season, slot: number, out: THREE.Color): THREE.Color {
  const pal: Record<Season, number[]> = {
    spring: [0xf6d23a, 0xffffff, 0xf08aa8, 0xb08ae0, 0x6a9ae8, 0xfff0a0],
    summer: [0xf6c830, 0xffffff, 0xe8463a, 0xf08a2f, 0x9a6ad0, 0x5a8ae0],
    autumn: [0x9a6ad0, 0xf0a030, 0xf6d23a, 0xc05a8a, 0xe8703a, 0xb070d0],
    winter: [0xffffff, 0xffffff, 0xffffff, 0xffffff, 0xffffff, 0xffffff],
  };
  if (slot >= 6) { bloomColors(season, BLOOM); return out.copy(BLOOM[Math.min(2, slot - 6)]); }
  return out.set(pal[season][slot % 6]);
}
