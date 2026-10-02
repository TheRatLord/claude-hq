/**
 * Where everyone goes at an evening gathering (pure maths, no three; tested in slots.test.ts): the seats round the
 * campfire (two to a log bench, the stool, a ring of spots on the grass between them), the band on the bandstand and
 * the crowd in an arc in front of it, the browsing spots at the market stalls.
 *
 * Frames follow the structures' convention: a local (x, z) offset turns by the frame's yaw like three's rotation.y,
 * and a local yaw of 0 faces the frame's own front (+z).
 */
import type { XZ } from '../../world/map.ts';

export interface Frame extends XZ { yaw: number }
export type SlotKind = 'log' | 'stool' | 'ground' | 'stage' | 'crowd' | 'stall';
export interface Slot extends XZ {
  yaw: number;
  kind: SlotKind;
  /** seat / floor height when it is raised (log top, stool, the stage); undefined = on the ground */
  y?: number;
  /** log bench index (the player sits on a whole bench) */
  bench?: number;
  /** waypoint to pass first (the bandstand steps) */
  via?: XZ;
}

export const toWorld = (f: Frame, lx: number, lz: number): XZ => {
  const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
  return { x: f.x + lx * c + lz * s, z: f.z - lx * s + lz * c };
};
const face = (from: XZ, to: XZ) => Math.atan2(to.x - from.x, to.z - from.z);

/** half the spacing of two sitters on a log bench (≥ the farmers' 1 m personal space apart) */
export const BENCH_HALF = 0.56;
/** the grass ring's radius round the fire (inside the benches, outside the tripod's legs) */
export const RING_R = 2.45;

/**
 * Campfire seats from the structure's bench layout (`benches`: local centres, the first three are log benches, the
 * fourth a stool; `CAMPFIRE_SEATS` in structures/leisure.ts). Sitters face the fire; ground spots fill the widest gaps.
 */
export function campfireSlots(fire: Frame, benches: readonly (readonly [number, number])[], seatY: (bench: number) => number | undefined, ground = 5): Slot[] {
  const out: Slot[] = [];
  benches.forEach(([bx, bz], i) => {
    const y = seatY(i);
    const log = i < 3;
    const ry = Math.atan2(-bx, -bz); // the bench's own rotation (it faces the fire), its length along local x
    const tx = Math.cos(ry), tz = -Math.sin(ry);
    for (const o of log ? [-BENCH_HALF, BENCH_HALF] : [0]) {
      const p = toWorld(fire, bx * 0.88 + tx * o, bz * 0.88 + tz * o);
      out.push({ x: p.x, z: p.z, yaw: face(p, fire), kind: log ? 'log' : 'stool', y, bench: i });
    }
  });
  // the grass between the benches: the middle of the widest angular gaps
  const angs = benches.map(([x, z]) => Math.atan2(x, z)).sort((a, b) => a - b);
  const gaps = angs.map((a, i) => { const b = i + 1 < angs.length ? angs[i + 1] : angs[0] + Math.PI * 2; return { mid: (a + b) / 2, w: b - a }; });
  const picks: number[] = [];
  // split the gaps evenly among the spots, widest first
  const share = gaps.map(() => 0);
  for (let n = 0; n < ground; n++) {
    let best = 0, bw = -1;
    gaps.forEach((g, i) => { const w = g.w / (share[i] + 1); if (w > bw) { bw = w; best = i; } });
    share[best]++;
  }
  gaps.forEach((g, i) => { for (let k = 0; k < share[i]; k++) picks.push(g.mid - g.w / 2 + (g.w * (k + 1)) / (share[i] + 1)); });
  for (const a of picks) {
    const p = toWorld(fire, Math.sin(a) * RING_R, Math.cos(a) * RING_R);
    out.push({ x: p.x, z: p.z, yaw: face(p, fire), kind: 'ground' });
  }
  return out;
}

/**
 * The band on the bandstand (`r` = its radius; `floor` = the stage's height): three players along the front, facing out
 * over the steps; they come up the steps (`via`).
 */
export function bandSlots(stage: Frame, r: number, floor: number): Slot[] {
  const via = toWorld(stage, 0, r + 1.5);
  return [-1.05, 0, 1.05].map((lx) => {
    const p = toWorld(stage, lx, 0.75 - Math.abs(lx) * 0.2);
    return { x: p.x, z: p.z, yaw: stage.yaw, kind: 'stage' as const, y: floor, via };
  });
}

/** The crowd: two rows in an arc in front of the bandstand, facing the band. */
export function crowdSlots(stage: Frame, r: number, n = 12): Slot[] {
  const out: Slot[] = [];
  const rows = [{ d: r + 2.6, k: Math.ceil(n * 0.5) }, { d: r + 4.1, k: Math.floor(n * 0.5) }];
  for (const [ri, row] of rows.entries()) {
    const span = ri === 0 ? 1.15 : 1.0; // radians either side… of the front
    for (let i = 0; i < row.k; i++) {
      const a = row.k === 1 ? 0 : -span / 2 + (span * i) / (row.k - 1) + (ri ? span / (row.k * 2) : 0);
      const p = toWorld(stage, Math.sin(a) * row.d, Math.cos(a) * row.d);
      out.push({ x: p.x, z: p.z, yaw: face(p, stage), kind: 'crowd' });
    }
  }
  return out;
}

/** Browsing spots at the market: two in front of each stall's counter, facing it, and a gossip pair between the stalls. */
export function marketSlots(stalls: readonly Frame[]): Slot[] {
  const out: Slot[] = [];
  for (const s of stalls) for (const lx of [-0.7, 0.7]) {
    const p = toWorld(s, lx, 1.55);
    out.push({ x: p.x, z: p.z, yaw: s.yaw + Math.PI, kind: 'stall' });
  }
  if (stalls.length >= 2) {
    const a = toWorld(stalls[0], 0, 2.6), b = toWorld(stalls[1], 0, 2.6);
    const m = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    for (const sg of [-1, 1]) {
      const p = { x: m.x + (dx / l) * 0.62 * sg, z: m.z + (dz / l) * 0.62 * sg };
      out.push({ x: p.x, z: p.z, yaw: face(p, m), kind: 'stall' });
    }
  }
  return out;
}
