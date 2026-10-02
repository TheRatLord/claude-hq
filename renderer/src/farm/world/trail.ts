// @pure
/**
 * The summit trail: a hiking path from the south road up the terraced cliff wall to a lookout on the rim.
 *
 * Pure data + maths, fed the valley's own height function by `world/map.ts` (no import back, no cycle). The trail is
 * cut into the land itself: `carveTrail` levels a 2 m tread along it (a flat core blended into the slope beside it,
 * weighted like the map's pads so overlapping bits never fight), so `heightAt` gives a walkable surface everywhere on
 * it and the terrain mesh, scatter, forage and the player all agree.
 *
 * Route (north up; the wall rises to the south; shelves dip a little to the west):
 *
 *        summit knob ── rope bridge ── east knob
 *            ▲ (lookout)                 ║ wooden stairs
 *            ╚═══════ L4 ═══════════ saddle
 *    U3 ╔══════════ L3 ══════════════╗
 *       ╚═══════════ L2 ═════════════╝ U2 (halfway bench)
 *    U1 ╔══════════ L1 ══════════════╗
 *                                    ╚══ trailhead (signpost) ── footpath ── south road
 *
 * Each leg (`L1`…`L4`) climbs along one riser of the strata, following its contour (cut half into the face, half
 * built out), and each hairpin (`U1`…`U3`) crosses the shelf above it. Max grade ≈ 0.45 (the controller climbs up to
 * ≈ 1.4); log steps mark the steeper legs. The last climb, onto the east knob, is a built wooden staircase and the gap
 * from there to the summit knob a rope bridge (both `walkSurface`s published by scene/trail).
 */
import type { XZ } from './map.ts';

export type TrailKind = 'path' | 'cut' | 'stairs' | 'bridge';

/** A dense trail point (≈ every 1.2 m). `kind` is the kind of the segment from this point to the next. */
export interface TrailPt { x: number; z: number; y: number; kind: TrailKind; /** grade of the segment (rise / run) */ grade: number }

/** A level landing (hairpin, knob tops): a disc carved flat at `y`. */
export interface Landing { x: number; z: number; r: number; y: number }

/** Placed things along the trail (scene/trail builds them; world anchors, y = the tread height there). */
export interface TrailAnchors {
  trailhead: { x: number; z: number; y: number; yaw: number };
  /** the halfway rest bench (faces the valley) */
  bench: { x: number; z: number; y: number; yaw: number };
  cairns: readonly { x: number; z: number; y: number; s: number }[];
  /** wooden staircase bottom → top (centre line of the treads) */
  stairs: { a: { x: number; z: number; y: number }; b: { x: number; z: number; y: number }; width: number };
  /** rope bridge anchor → anchor (deck height at the ends) */
  bridge: { a: { x: number; z: number; y: number }; b: { x: number; z: number; y: number }; width: number; sag: number };
  /** the summit lookout platform (front = the valley side) */
  summit: { x: number; z: number; y: number; yaw: number; w: number; d: number; deck: number };
}

export interface Trail {
  pts: readonly TrailPt[];
  landings: readonly Landing[];
  anchors: TrailAnchors;
  /** total length, metres */
  length: number;
  /** summit height above the trailhead */
  climb: number;
  /** xz bounds of everything the trail touches (+ blend) */
  box: { x0: number; x1: number; z0: number; z1: number };
}

/** Tread half-width (flat core) and the blend skirt beside it, metres. */
export const TRAIL_HW = 1.05;
export const TRAIL_BLEND = 1.7;
/** Painted / reserved width (pathAt, clearance). */
export const TRAIL_WIDTH = 1.7;

type Seg = TrailKind | 'contour';
interface Key { x: number; z: number; /** explicit tread height; default the land's height there */ y?: number; /** how to reach the next key */ to: Seg }

/** The route. Tuned against the land (scratch survey): legs on the risers, hairpins on the shelves. */
const KEYS: readonly Key[] = [
  // meadow footpath from the south road, between fields 9 and 10, to the trailhead at the wall's foot
  { x: 0, z: 54.2, to: 'path' }, { x: 0.3, z: 62, to: 'path' }, { x: 0.2, z: 70, to: 'path' }, { x: 1.8, z: 78, to: 'path' },
  { x: 5.5, z: 84.4, to: 'cut' }, { x: 9.6, z: 88.6, to: 'cut' }, { x: 12.6, z: 92.6, to: 'cut' },
  // L1 west along riser 1 (S0 → S1)
  { x: 14.6, z: 95.6, to: 'contour' }, { x: -14, z: 102.3, to: 'cut' },
  // U1
  { x: -16.6, z: 103.5, to: 'cut' },
  // L2 east along riser 2 (S1 → S2)
  { x: -14, z: 104.9, to: 'contour' }, { x: 9.4, z: 104.1, to: 'cut' },
  // U2 (the halfway bench)
  { x: 11.9, z: 105.3, to: 'cut' },
  // L3 west along riser 3 (S2 → S3)
  { x: 9.4, z: 106.4, to: 'contour' }, { x: -14, z: 113.7, to: 'cut' },
  // U3
  { x: -16.8, z: 114.8, to: 'cut' },
  // L4 east along riser 4 (S3 → S4), arriving in the saddle between the two knobs
  { x: -15, z: 116.4, to: 'contour' }, { x: 4.4, z: 115.8, to: 'cut' }, { x: 5.6, z: 116.7, to: 'cut' },
  // the wooden staircase up the east knob
  { x: 6.6, z: 117.0, to: 'stairs' }, { x: 15.2, z: 117.7, y: 44.1, to: 'cut' },
  { x: 15.6, z: 119.0, y: 44.1, to: 'cut' }, { x: 12.8, z: 120.4, y: 43.7, to: 'bridge' },
  // the rope bridge over the saddle to the summit knob
  { x: 3.0, z: 123.9, y: 43.7, to: 'cut' }, { x: 0.4, z: 124.6, y: 43.7, to: 'cut' },
];

const smoothstep = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Build the trail against the land (`base` = the valley's height before the trail is cut). */
export function buildTrail(base: (x: number, z: number) => number): Trail {
  const keyY = (k: Key) => k.y ?? base(k.x, k.z);
  const raw: { x: number; z: number; y: number; kind: TrailKind }[] = [];
  for (let i = 0; i < KEYS.length; i++) {
    const a = KEYS[i], b = KEYS[i + 1];
    const ya = keyY(a);
    if (!b) { raw.push({ x: a.x, z: a.z, y: ya, kind: 'cut' }); break; }
    const yb = keyY(b);
    const kind: TrailKind = a.to === 'contour' ? 'cut' : a.to;
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.round(L / (a.to === 'stairs' || a.to === 'bridge' ? 0.8 : 1.2)));
    if (a.to !== 'contour') {
      for (let s = 0; s < n; s++) { const t = s / n; raw.push({ x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t), y: kind === 'path' ? base(lerp(a.x, b.x, t), lerp(a.z, b.z, t)) : lerp(ya, yb, t), kind }); }
      continue;
    }
    // along a riser: the tread climbs evenly while its line follows the face's contour at that height (half cut in,
    // half built out), smoothed so it bends gently
    const zs: number[] = [];
    for (let s = 0; s <= n; s++) {
      const t = s / n, x = lerp(a.x, b.x, t), z0 = lerp(a.z, b.z, t), y = lerp(ya, yb, t);
      let z = z0;
      if (s > 0 && s < n) {
        // first point going up the wall (south) whose land reaches the tread height
        for (let dz = -4; dz <= 4; dz += 0.25) if (base(x, z0 + dz) >= y) { z = z0 + dz; break; }
      }
      zs.push(z);
    }
    for (let pass = 0; pass < 3; pass++) for (let s = 1; s < n; s++) zs[s] = (zs[s - 1] + zs[s] * 2 + zs[s + 1]) / 4;
    for (let s = 0; s < n; s++) { const t = s / n; raw.push({ x: lerp(a.x, b.x, t), z: zs[s], y: lerp(ya, yb, t), kind }); }
  }
  // grades, length
  const pts: TrailPt[] = raw.map((p, i) => {
    const q = raw[i + 1] ?? p;
    const run = Math.hypot(q.x - p.x, q.z - p.z);
    return { ...p, grade: run > 1e-6 ? (q.y - p.y) / run : 0 };
  });
  let length = 0;
  for (let i = 0; i + 1 < pts.length; i++) length += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z);

  const at = (k: number) => KEYS[k < 0 ? KEYS.length + k : k];
  const P = (x: number, z: number) => ({ x, z });
  const stairsI = KEYS.findIndex((k) => k.to === 'stairs'), bridgeI = KEYS.findIndex((k) => k.to === 'bridge');
  const sA = KEYS[stairsI], sB = KEYS[stairsI + 1], bA = KEYS[bridgeI], bB = KEYS[bridgeI + 1];
  const summitY = keyY(at(-1));
  const landings: Landing[] = [
    { ...P(15.6, 118.4), r: 1.9, y: keyY(sB) },
    { ...P(-2.4, 125.2), r: 4.6, y: summitY },
  ];
  // a hairpin's turn is a little level landing
  for (const i of [9, 12, 15]) landings.push({ ...P(KEYS[i].x, KEYS[i].z), r: 1.6, y: keyY(KEYS[i]) });
  const u2 = KEYS[12];
  const th = KEYS[4];
  // cairns stand on the tread: at each hairpin's apex (inside its landing) and beside the tread in the saddle
  const apex = (h: number, s: number) => {
    const k = KEYS[h], mx = (KEYS[h - 1].x + KEYS[h + 1].x) / 2, mz = (KEYS[h - 1].z + KEYS[h + 1].z) / 2;
    const dx = k.x - mx, dz = k.z - mz, l = Math.hypot(dx, dz) || 1, x = k.x + (dx / l) * 1.15, z = k.z + (dz / l) * 1.15;
    return { x, z, y: base(x, z), s };
  };
  const anchors: TrailAnchors = {
    // beside the footpath where the climb begins, facing the walkers coming up from the road
    trailhead: { x: 1.55, z: 81.0, y: base(1.55, 81.0), yaw: Math.PI },
    bench: { x: u2.x + 0.9, z: u2.z - 0.2, y: keyY(u2), yaw: Math.PI - 0.35 },
    cairns: [apex(9, 0.95), apex(15, 0.9), { x: KEYS[18].x - 0.3, z: KEYS[18].z - 0.8, y: base(KEYS[18].x - 0.3, KEYS[18].z - 0.8), s: 0.75 }],
    stairs: { a: { x: sA.x, z: sA.z, y: keyY(sA) }, b: { x: sB.x, z: sB.z, y: keyY(sB) }, width: 1.5 },
    bridge: { a: { x: bA.x, z: bA.z, y: keyY(bA) }, b: { x: bB.x, z: bB.z, y: keyY(bB) }, width: 1.3, sag: 0.4 },
    summit: { x: -2.6, z: 125.3, y: summitY, yaw: Math.PI, w: 4.6, d: 3.8, deck: 0.32 },
  };
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const grow = (x: number, z: number, r: number) => { x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r); z0 = Math.min(z0, z - r); z1 = Math.max(z1, z + r); };
  for (const p of pts) grow(p.x, p.z, TRAIL_HW + TRAIL_BLEND + 0.5);
  for (const l of landings) grow(l.x, l.z, l.r + TRAIL_BLEND + 0.5);
  return { pts, landings, anchors, length, climb: summitY - base(th.x, th.z), box: { x0, x1, z0, z1 } };
}

/**
 * The trail cut into the land: the height at (x, z) given the land's height `h` there. Treads and landings blend as
 * a weighted mean (weight unbounded toward a flat core, like map.ts's pads), so a hairpin's two legs keep their own
 * level treads with a bank between; under the staircase the land is only ever lowered (never above the treads).
 */
export function carveTrail(t: Trail, x: number, z: number, h: number): number {
  const b = t.box;
  if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) return h;
  const pts = t.pts, reach = TRAIL_HW + TRAIL_BLEND;
  let wsum = 1, hsum = h, kmax = 0, under = Infinity, uk = 0, lk = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i];
    if (p.kind === 'path' || p.kind === 'bridge') continue;
    const q = pts[i + 1];
    const minx = Math.min(p.x, q.x) - reach, maxx = Math.max(p.x, q.x) + reach;
    if (x < minx || x > maxx) continue;
    const minz = Math.min(p.z, q.z) - reach, maxz = Math.max(p.z, q.z) + reach;
    if (z < minz || z > maxz) continue;
    const dx = q.x - p.x, dz = q.z - p.z, l2 = dx * dx + dz * dz || 1;
    const u = ((x - p.x) * dx + (z - p.z) * dz) / l2, s = Math.max(0, Math.min(1, u));
    const ex = p.x + dx * s - x, ez = p.z + dz * s - z;
    const d = Math.sqrt(ex * ex + ez * ez) - TRAIL_HW;
    if (d >= TRAIL_BLEND) continue;
    const y = p.y + (q.y - p.y) * s;
    const k = 1 - smoothstep(0, TRAIL_BLEND, d);
    if (p.kind === 'stairs') {
      // only beside a flight's own run (its neighbours cover the joints; past either end the landings take over)
      if (u < -0.02 || u > 1.02) continue;
      // keep the land under the treads (a little clearance), never raise it; a narrow cut, the flight is 1.5 m wide
      const ks = 1 - smoothstep(0, 0.9, d + TRAIL_HW - 0.85);
      if (ks > uk) { uk = ks; under = y - (q.kind === 'stairs' ? 0.45 : 0.45 * (1 - s) + 0.02); }
      continue;
    }
    const w = d < 0 ? 1e4 * Math.exp(Math.min(600, -d * 12)) : k / (1 - k + 1e-4);
    wsum += w; hsum += w * y;
    if (k > kmax) kmax = k;
  }
  for (const l of t.landings) {
    const dd = Math.hypot(x - l.x, z - l.z) - l.r;
    if (dd >= TRAIL_BLEND) continue;
    const k = 1 - smoothstep(0, TRAIL_BLEND, dd);
    const w = dd < 0 ? 1e4 * Math.exp(Math.min(600, -dd * 12)) : k / (1 - k + 1e-4);
    wsum += w; hsum += w * l.y;
    if (k > kmax) kmax = k;
    if (k > lk) lk = k;
  }
  let out = kmax > 0 ? hsum / wsum : h;
  if (uk > 0 && under < out) out = lerp(out, under, uk);
  return out;
}

/** Distance (xz) to the trail's centre line, counting only the kinds given (Infinity outside its box). */
export function trailDist(t: Trail, x: number, z: number, kinds: (k: TrailKind) => boolean): number {
  const b = t.box;
  if (x < b.x0 - 4 || x > b.x1 + 4 || z < b.z0 - 4 || z > b.z1 + 4) return Infinity;
  const pts = t.pts;
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    if (!kinds(pts[i].kind)) continue;
    const p = pts[i], q = pts[i + 1];
    const dx = q.x - p.x, dz = q.z - p.z, l2 = dx * dx + dz * dz || 1;
    const s = Math.max(0, Math.min(1, ((x - p.x) * dx + (z - p.z) * dz) / l2));
    const ex = p.x + dx * s - x, ez = p.z + dz * s - z;
    const d = ex * ex + ez * ez;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** Polyline of the whole trail (for maps). */
export const trailLine = (t: Trail): XZ[] => t.pts.map((p) => ({ x: p.x, z: p.z }));
