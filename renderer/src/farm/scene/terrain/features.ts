/**
 * Deterministic land features shared by terrain (which draws them) and water (which foams around them):
 * mid-stream boulders, the stepping-stone ford, bank pebbles, mountainside outcrops.
 */
import { seeded } from '../../../core/rng.ts';
import { POND, RIVER, RIVER_HALF_WIDTH, WORLD, clearance, distToPolyline, heightAt, normalAt, slopeAt, structure } from '../../world/map.ts';
import type { XZ } from '../../world/map.ts';

/** Height of a river-rock geometry above its base per unit radius (rocks.ts, flat 0.62). */
const STONE_H = 1.25;

export interface Stone { x: number; z: number; y: number; r: number; yaw: number; seed: number; /** height scale */ hy: number }

/** Point and unit tangent along the river polyline at arc fraction t (0 source … 1 mouth). */
export function riverAt(t: number): { x: number; z: number; tx: number; tz: number } {
  const seg: number[] = [];
  let total = 0;
  for (let i = 0; i < RIVER.length - 1; i++) { const l = Math.hypot(RIVER[i + 1].x - RIVER[i].x, RIVER[i + 1].z - RIVER[i].z); seg.push(l); total += l; }
  let d = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i] || i === seg.length - 1) {
      const a = RIVER[i], b = RIVER[i + 1], k = Math.min(1, d / seg[i]);
      return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, tx: (b.x - a.x) / seg[i], tz: (b.z - a.z) / seg[i] };
    }
    d -= seg[i];
  }
  return { x: 0, z: 0, tx: 0, tz: 1 };
}

const bridge = structure('bridge');
const nearBridge = (p: XZ) => Math.hypot(p.x - bridge.x, p.z - bridge.z) < 12;

/** The stepping-stone ford south of the bridge. */
const FORD = (() => { const p = riverAt(0.505); return { x: p.x, z: p.z, tx: p.tx, tz: p.tz }; })();

/** Boulders standing in the river (water foams around them). */
export const RIVER_ROCKS: readonly Stone[] = (() => {
  const r = seeded('land:river-rocks');
  const out: Stone[] = [];
  for (let i = 0; i < 40; i++) {
    const t = 0.03 + r() * 0.72;
    const p = riverAt(t);
    const side = (r() - 0.5) * 2 * RIVER_HALF_WIDTH * 0.95;
    const x = p.x - p.tz * side, z = p.z + p.tx * side;
    if (nearBridge({ x, z }) || Math.hypot(x - FORD.x, z - FORD.z) < 6) continue;
    if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 4)) continue;
    const rad = 0.45 + r() * 0.75;
    const y = heightAt(x, z);
    // most break the surface (a crown of dry rock), a few stay just under it (a riffle of foam)
    const top = WORLD.water + (r() < 0.75 ? 0.1 + r() * 0.35 : -0.12);
    out.push({ x, z, y, r: rad, yaw: r() * 6.28, seed: i, hy: Math.max(0.7, (top - y) / (rad * STONE_H)) });
  }
  return out;
})();

export const FORD_STONES: readonly Stone[] = (() => {
  const r = seeded('land:ford');
  const out: Stone[] = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const s = ((i + 0.5) / n - 0.5) * (RIVER_HALF_WIDTH * 2 + 3.2);
    const wob = (r() - 0.5) * 0.7;
    const x = FORD.x - FORD.tz * s + FORD.tx * wob, z = FORD.z + FORD.tx * s + FORD.tz * wob;
    const y = heightAt(x, z), rad = 0.62 + r() * 0.14;
    out.push({ x, z, y, r: rad, yaw: r() * 6.28, seed: 100 + i, hy: Math.max(0.6, (WORLD.water + 0.2 - y) / (rad * STONE_H)) });
  }
  return out;
})();

/** Pebble scatter along the river and pond margins. */
export const BANK_PEBBLES: readonly Stone[] = (() => {
  const r = seeded('land:pebbles');
  const out: Stone[] = [];
  for (let i = 0; i < 900 && out.length < 420; i++) {
    let x: number, z: number;
    if (r() < 0.8) {
      const p = riverAt(r() * 0.9);
      const side = (r() < 0.5 ? -1 : 1) * (RIVER_HALF_WIDTH + 0.2 + r() * 3.2);
      x = p.x - p.tz * side + (r() - 0.5) * 3; z = p.z + p.tx * side + (r() - 0.5) * 3;
    } else {
      const a = r() * Math.PI * 2, d = POND.r + 0.3 + r() * 2.5;
      x = POND.x + Math.cos(a) * d; z = POND.z + Math.sin(a) * d;
    }
    const h = heightAt(x, z);
    if (h < WORLD.water - 0.25 || h > WORLD.water + 1.2 || nearBridge({ x, z })) continue;
    if (clearance(x, z) < -1.2 && distToPolyline(x, z, RIVER) > RIVER_HALF_WIDTH + 1.6 && Math.hypot(x - POND.x, z - POND.z) > POND.r + 1.6) continue;
    const big = r() < 0.12;
    out.push({ x, z, y: h, r: big ? 0.35 + r() * 0.3 : 0.1 + r() * 0.16, yaw: r() * 6.28, seed: 200 + (i % 12), hy: 0.6 + r() * 0.6 });
  }
  return out;
})();

/** Does the ground fall away under a boulder's footprint (radius ≈ 1.35 r)? */
function onLedgeEdge(x: number, z: number, r: number): boolean {
  const h = heightAt(x, z);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; if (h - heightAt(x + Math.cos(a) * r * 1.3, z + Math.sin(a) * r * 1.3) > r * 0.55) return true; }
  return false;
}

/** Big faceted outcrops on the mountain ring and a few cliff boulders at its foot. */
export const OUTCROPS: readonly Stone[] = (() => {
  const r = seeded('land:outcrops');
  const out: Stone[] = [];
  for (let i = 0; i < 2400 && out.length < 110; i++) {
    const a = r() * Math.PI * 2;
    const rr = WORLD.rim - 8 + r() * 44;
    const x = Math.cos(a) * rr, z = (Math.sin(a) * rr) / 1.05;
    if (Math.abs(x) > WORLD.half - 4 || Math.abs(z) > WORLD.half - 4) continue;
    const h = heightAt(x, z);
    const sl = slopeAt(x, z);
    // on the strata shelves and at the foot of the risers, not stuck to the steep faces
    if (h < 2 || clearance(x, z) < 4 || sl < 0.06 || sl > 0.42) continue;
    if (Math.hypot(x + 25, z + 109) < 24) continue; // keep the waterfall face clear
    const big = rr > WORLD.rim + 14 ? 1.8 + r() * 2.2 : 0.9 + r() * 1.4;
    if (out.some((o) => Math.hypot(o.x - x, o.z - z) < (o.r + big) * 1.4 + 1)) continue;
    if (onLedgeEdge(x, z, big)) continue; // would hang off a strata shelf over the riser below
    out.push({ x, z, y: h, r: big, yaw: r() * 6.28, seed: 300 + (i % 6), hy: 0.55 + r() * 0.5 });
  }
  return out;
})();

export interface Trickle {
  /** ribbon centre line, source (top of the wall) first; y already lifted clear of the terrain */
  pts: { x: number; y: number; z: number }[];
  /** 0 calm run across a shelf … 1 white water down a riser, per point */
  steep: number[];
  width: number;
}

/**
 * Little cascades down the cliff wall: a spring high on the strata spills over each ledge in turn (white water on the
 * risers, a glassy run across every shelf) and sinks into the forest at the foot. Water draws them; flora and
 * outcrops keep clear (`trickleDist`).
 */
export const TRICKLES: readonly Trickle[] = (() => {
  const out: Trickle[] = [];
  // around the ring where the wall is in view from the farm (east, south-east, west of the river, north-east)
  for (const a0 of [0.12, 0.95, 3.55, 5.35]) {
    let x = 0, z = 0;
    for (let r = WORLD.rim; r < WORLD.rim + 60; r += 1) {
      x = Math.cos(a0) * r; z = (Math.sin(a0) * r) / 1.05;
      if (heightAt(x, z) > 30) break;
    }
    const pts: Trickle['pts'] = [], steep: number[] = [];
    let len = 0;
    for (let i = 0; i < 160; i++) {
      const h = heightAt(x, z);
      const n = normalAt(x, z, 0.8);
      const inw = Math.hypot(x, z) || 1;
      // mostly straight down the wall toward the valley, bending a little with the slope
      let dx = -x / inw * 0.65 + n.x * 0.35 / Math.max(0.05, Math.hypot(n.x, n.z)), dz = -z / inw * 0.65 + n.z * 0.35 / Math.max(0.05, Math.hypot(n.x, n.z));
      const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
      const up = Math.max(h, heightAt(x - dx * 0.7, z - dz * 0.7), heightAt(x + dz * 0.6, z - dx * 0.6), heightAt(x - dz * 0.6, z + dx * 0.6));
      pts.push({ x, y: up + 0.14, z });
      steep.push(Math.min(1, Math.max(0, (1 - n.y - 0.12) * 2.2)));
      if (h < 7 || Math.hypot(x, z * 1.05) < WORLD.rim - 6) break;
      x += dx * 0.7; z += dz * 0.7; len += 0.7;
    }
    if (len > 12) out.push({ pts, steep, width: 1.1 + out.length * 0.15 });
  }
  return out;
})();

/** Distance (xz) to the nearest cascade's centre line. */
export function trickleDist(x: number, z: number): number {
  let d = Infinity;
  for (const t of TRICKLES) {
    const a = t.pts[0], b = t.pts[t.pts.length - 1];
    if (Math.min(Math.hypot(x - a.x, z - a.z), Math.hypot(x - b.x, z - b.z)) > 80) continue;
    d = Math.min(d, distToPolyline(x, z, t.pts));
  }
  return d;
}

/** Stones in the stream bed (for water foam): river boulders + ford stones. */
export const WATER_STONES: readonly Stone[] = [...RIVER_ROCKS, ...FORD_STONES];
