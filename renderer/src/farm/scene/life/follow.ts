// @pure
/**
 * How your pet keeps up with you (companion.ts), pure and tested (follow.test.ts):
 *
 *  - `Crumbs`: a ring buffer of the player's footsteps, one every `spacing` metres. Where you walked is walkable
 *    (round the pond, over the bridge, through the yard gate), so when the straight line to you is blocked the pet
 *    takes the newest crumb it can see and works along your trail. A jump of more than `jump` metres between pushes is
 *    a teleport (map travel): the trail restarts there.
 *  - `heelSpot`: the comfortable place to be: a little behind and to one side while you walk, round in front where
 *    it can look up at you when you stop.
 *  - `followSpeed`: match your pace, close a gap briskly, sprint when you sprint, ease in on arrival.
 */

export interface XZ { x: number; z: number }

export class Crumbs {
  private readonly xs: Float32Array;
  private readonly zs: Float32Array;
  /** index of the newest crumb */
  private head = -1;
  /** number of crumbs held */
  n = 0;
  readonly spacing: number;
  readonly jump: number;
  constructor(cap = 64, spacing = 0.7, jump = 7) {
    this.xs = new Float32Array(cap); this.zs = new Float32Array(cap);
    this.spacing = spacing; this.jump = jump;
  }
  get cap(): number { return this.xs.length; }
  reset(x: number, z: number): void { this.head = 0; this.n = 1; this.xs[0] = x; this.zs[0] = z; }
  /** record the player's feet; returns 'jump' when it was a teleport (the trail restarted), 'add' when a crumb was laid */
  push(x: number, z: number): 'jump' | 'add' | null {
    if (this.n === 0) { this.reset(x, z); return 'add'; }
    const d = Math.hypot(x - this.xs[this.head], z - this.zs[this.head]);
    if (d > this.jump) { this.reset(x, z); return 'jump'; }
    if (d < this.spacing) return null;
    this.head = (this.head + 1) % this.xs.length;
    this.xs[this.head] = x; this.zs[this.head] = z;
    this.n = Math.min(this.xs.length, this.n + 1);
    return 'add';
  }
  /** crumb `i` (0 = newest … n−1 = oldest) into `out`; false when out of range */
  get(i: number, out: XZ): boolean {
    if (i < 0 || i >= this.n) return false;
    const k = (this.head - i + this.xs.length * 2) % this.xs.length;
    out.x = this.xs[k]; out.z = this.zs[k];
    return true;
  }
}

const _c: XZ = { x: 0, z: 0 };
/**
 * Pick a waypoint toward the player along the trail: the newest crumb visible from `from` (`clear(a, b)` tests a
 * straight line), testing at most `budget` crumbs (newest first, then a sparse sweep back). Writes `out`; returns the
 * crumb index or −1 (then `out` holds the oldest crumb: walk back along the trail).
 */
export function trailWaypoint(c: Crumbs, from: XZ, clear: (ax: number, az: number, bx: number, bz: number) => boolean, budget: number, out: XZ): number {
  if (c.n === 0) return -1;
  const stride = Math.max(1, Math.ceil(c.n / budget));
  for (let i = 0; i < c.n; i += stride) {
    if (!c.get(i, _c)) break;
    if (clear(from.x, from.z, _c.x, _c.z)) { out.x = _c.x; out.z = _c.z; return i; }
  }
  // nothing in sight: the nearest crumb is still the best bet (we are probably next to the trail, round a corner)
  let best = -1, bd = Infinity;
  for (let i = 0; i < c.n; i++) {
    c.get(i, _c);
    const d = Math.hypot(_c.x - from.x, _c.z - from.z);
    if (d < bd) { bd = d; best = i; out.x = _c.x; out.z = _c.z; }
  }
  return best === -1 ? -1 : -1 - best;
}

/**
 * Where the pet wants to be relative to the player at (px, pz) looking along yaw (forward = (−sin yaw, −cos yaw)):
 * walking → `back` m behind, `side` m to the left (side < 0: right); stopped → round in front, a little to the side.
 */
export function heelSpot(px: number, pz: number, yaw: number, stopped: boolean, side: number, out: XZ, back = 1.5): XZ {
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  const fwd = stopped ? 1.85 : -back, lat = stopped ? side * 0.45 : side;
  // left = (−cos yaw, sin yaw)
  out.x = px - sy * fwd - cy * lat;
  out.z = pz - cy * fwd + sy * lat;
  return out;
}

/** commanded speed: the player's pace plus a catch-up term on the gap, never above `max`; eases to 0 at the spot */
export function followSpeed(gap: number, playerSpeed: number, max = 9): number {
  if (gap < 0.25) return 0;
  const catchUp = gap < 1 ? gap * 1.2 : 1.2 + (gap - 1) * 1.7;
  const v = Math.max(playerSpeed * (gap > 0.8 ? 1.05 : gap), 0) + catchUp;
  return Math.min(max, v);
}
