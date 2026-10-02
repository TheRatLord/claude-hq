// @pure
/**
 * The hillside orchard & apiary (scene/orchard, docs/valley/orchard.md): a walled orchard on the east foothills'
 * west-facing slope, between the swing tree and the pond fields. Three rows of fruit trees climb the slope along the
 * contour (apples, pears, plums, cherries), four beehives stand by a wildflower bed in the lower corner, a little honey
 * house with a cider press sits by the gate, and a dry-stone wall runs round it all with a five-bar gate onto a
 * footpath down to the road.
 *
 * Pure layout only (no three, nothing from map.ts: map.ts imports this to reserve the ground and route the footpath).
 * Local frame like a structure: origin on the slope, front (+z) downhill toward the valley (the gate), x along the
 * contour; `toWorld` / `toLocal` convert.
 */

export type FruitKind = 'apple' | 'pear' | 'plum' | 'cherry';
export interface OrchardTree { i: number; x: number; z: number; kind: FruitKind; /** size */ s: number; /** turn of the crown */ ry: number }
export interface OrchardHive { i: number; x: number; z: number; ry: number }

const TREE_X = [-10.4, -6.4, -2.6, 2.6, 6.4, 10.4];
const ROWS: readonly { z: number; kinds: readonly FruitKind[] }[] = [
  // the back row, highest up the slope: apples
  { z: -6.1, kinds: ['apple', 'apple', 'apple', 'apple', 'apple', 'apple'] },
  // the middle row: pears to the left of the alley, plums to the right
  { z: -2.6, kinds: ['pear', 'pear', 'pear', 'plum', 'plum', 'plum'] },
  // the front row: cherries, then more apples
  { z: 0.9, kinds: ['cherry', 'cherry', 'cherry', 'apple', 'apple', 'apple'] },
];

export const ORCHARD_SITE = Object.freeze({
  id: 'hillorchard',
  name: 'Hillside orchard',
  /** origin (world) and yaw (front = (sin yaw, cos yaw), downhill, west-north-west) */
  x: 92.2, z: 37.2, yaw: -2.0,
  /** the dry-stone wall's rectangle (local): x −hw…hw, z back…front */
  hw: 13, back: -8.6, front: 7.6,
  /** the gate in the front wall: centre x, opening width */
  gate: { x: 0, w: 2.6 },
  trees: ROWS.flatMap((r, ri) => r.kinds.map((kind, ci) => ({
    i: ri * TREE_X.length + ci,
    // a hand-planted wobble so the rows don't look ruled
    x: TREE_X[ci] + (((ri * 7 + ci * 3) % 5) - 2) * 0.12,
    z: r.z + (((ri * 5 + ci * 11) % 5) - 2) * 0.1,
    kind,
    s: (kind === 'cherry' ? 0.95 : kind === 'pear' ? 1.04 : 1) * (0.92 + (((ri * 13 + ci * 7) % 9) / 8) * 0.16),
    ry: (ri * 6 + ci) * 1.37,
  }))) as readonly OrchardTree[],
  /** four hives in a row along the lower right, entrances facing the flower bed (−z, up the slope) */
  hives: [{ x: 6.0, z: 5.6 }, { x: 7.9, z: 5.75 }, { x: 9.8, z: 5.6 }, { x: 11.6, z: 5.8 }].map((h, i) => ({ i, ...h, ry: Math.PI + (i - 1.5) * 0.08 })) as readonly OrchardHive[],
  /** the wildflower bed the bees work (local rectangle) */
  bed: { x0: 4.6, x1: 12.4, z0: 2.9, z1: 4.3 },
  /** the honey house & cider press: an open-fronted shed in the lower left corner, its front facing +x (the alley) */
  shed: { x: -9.6, z: 4.4, w: 4.4, d: 3.4, ry: Math.PI / 2 },
  /** the press stands under the shed's roof by its open front (local) */
  press: { x: -8.4, z: 4.5 },
  /** a picking ladder leant into one tree, and its basket */
  ladder: { tree: 9 },
  /** the noticeboard sign beside the gate (outside, to the left) */
  sign: { x: -2.4, z: 8.7 },
  /** the mown alley up the middle: from the gate to the back row */
  alley: { z0: 7.6, z1: -7.6, w: 1.4 },
});

export type OrchardSite = typeof ORCHARD_SITE;

const C = Math.cos(ORCHARD_SITE.yaw), S = Math.sin(ORCHARD_SITE.yaw);
/** local (x along the contour, z downhill) → world */
export function orchardToWorld(lx: number, lz: number): { x: number; z: number } {
  return { x: ORCHARD_SITE.x + lx * C + lz * S, z: ORCHARD_SITE.z - lx * S + lz * C };
}
/** world → local */
export function orchardToLocal(x: number, z: number): { x: number; z: number } {
  const dx = x - ORCHARD_SITE.x, dz = z - ORCHARD_SITE.z;
  return { x: dx * C - dz * S, z: dx * S + dz * C };
}

/** where the footpath leaves the gate (world), a step outside the wall */
export const ORCHARD_GATE = Object.freeze(orchardToWorld(ORCHARD_SITE.gate.x, ORCHARD_SITE.front + 1.2));
/** the alley's polyline (world), gate to back row: a worn path up the middle */
export const ORCHARD_ALLEY = Object.freeze([orchardToWorld(0, ORCHARD_SITE.front + 1.2), orchardToWorld(0, ORCHARD_SITE.alley.z1)]);
/** the bounding circle of the whole orchard, wall included (world): quick rejects */
export const ORCHARD_BOUND = Object.freeze({ ...orchardToWorld(0, (ORCHARD_SITE.back + ORCHARD_SITE.front) / 2), r: Math.hypot(ORCHARD_SITE.hw, (ORCHARD_SITE.front - ORCHARD_SITE.back) / 2) + 1.5 });

const rect = (lx: number, lz: number, x0: number, x1: number, z0: number, z1: number) => {
  const qx = Math.max(x0 - lx, lx - x1), qz = Math.max(z0 - lz, lz - z1);
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
};

/**
 * Distance to the orchard's reserved features (negative inside one): the wall line, the trees' trunks and crowns,
 * the hives, the flower bed and the shed. Flora keeps its trees, bushes and rocks off them (clearance), and grass and
 * wildflowers still grow in between the rows. Infinity far away.
 */
export function orchardClearance(x: number, z: number): number {
  const b = ORCHARD_BOUND;
  const dx = x - b.x, dz = z - b.z;
  if (dx * dx + dz * dz > (b.r + 12) ** 2) return Infinity;
  const O = ORCHARD_SITE;
  const l = orchardToLocal(x, z);
  // the wall: a band along the rectangle's edge (0.5 m thick)
  let d = Math.abs(rect(l.x, l.z, -O.hw, O.hw, O.back, O.front)) - 0.35;
  // inside the wall, everything is the orchard's own: the rows, the alley, the corners (scatter keeps out)
  if (rect(l.x, l.z, -O.hw, O.hw, O.back, O.front) < 0) {
    for (const t of O.trees) d = Math.min(d, Math.hypot(l.x - t.x, l.z - t.z) - 1.5 * t.s);
    for (const h of O.hives) d = Math.min(d, Math.hypot(l.x - h.x, l.z - h.z) - 0.6);
    d = Math.min(d, rect(l.x, l.z, O.bed.x0, O.bed.x1, O.bed.z0, O.bed.z1));
    d = Math.min(d, rect(l.x, l.z, O.shed.x - O.shed.d / 2 - 0.3, O.shed.x + O.shed.d / 2 + 0.6, O.shed.z - O.shed.w / 2 - 0.3, O.shed.z + O.shed.w / 2 + 0.3));
    d = Math.min(d, Math.abs(l.x) - O.alley.w / 2);
  }
  // the sign by the gate
  d = Math.min(d, Math.hypot(l.x - O.sign.x, l.z - O.sign.z) - 0.4);
  return d;
}

/** Is (x, z) inside the orchard wall? */
export function inOrchard(x: number, z: number, margin = 0): boolean {
  const l = orchardToLocal(x, z), O = ORCHARD_SITE;
  return rect(l.x, l.z, -O.hw, O.hw, O.back, O.front) < margin;
}
