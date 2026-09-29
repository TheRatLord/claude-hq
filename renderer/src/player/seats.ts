// @pure
/**
 * Seats the player can sit on (§6.10 "Sit"): Pit sofas / steps / beanbags, café stools, library and round-table
 * chairs, alley benches, amenity chairs, hot desks and free desk chairs; never an agent's own desk chair ("that's
 * scout's chair") and never Shelly's bench. `pickSeat` chooses the one the player means: in reach (E radius), in
 * front of the view (or very close), not occupied, and not behind a wall. Owner: PLY.
 */

import type { Slot } from '../world/layout/schema.ts';

export const SIT_TAGS: ReadonlySet<string> = new Set([
  'sofa', 'pitStep', 'beanbag', 'cafe', 'alleyBench', 'amenity', 'microfiche', 'filing', 'hotdesk', 'cards',
  'station:library', 'station:roundtable', 'desk', 'seat',
]);

export const sittable = (slots: readonly Slot[] | undefined): Slot[] => (slots ?? []).filter((s) => s.pose === 'sit' && SIT_TAGS.has(s.tag));

/** busy: someone sits/stands there; owner: an agent's own chair */
export type Occupancy = { busy?: boolean; owner?: string | null } | null;
export interface SeatPick { slot: Slot; owner: string | null; d: number; aimed: boolean }

/** Heights above the slot (m) sampled on a seat's vertical extent: cushion → backrest. */
const SEAT_H = [0.1, 0.3, 0.5, 0.75];

/**
 * The seat under the reticle. Aim first: a seat the view ray passes within `aimDeg` of (or within `hitR` metres of,
 * so a big near seat counts as under the reticle) is "aimed"; among aimed seats the nearest along the ray wins, like
 * a raycast. Only when nothing is aimed does it fall back to the smallest angle off the ray, and only among seats in
 * the horizontal cone (or within `nearR`). Distance is just the tie-break. If the seat that ranks first is taken there
 * is no pick at all: E never sits you somewhere other than where you look.
 * `seats` come from `sittable`, `pos` is the player's feet, `ray` = eye + unit view direction, `reachable` e.g. "no
 * wall between the player and the seat".
 */
export function pickSeat(
  seats: readonly Slot[], pos: { x: number; y: number; z: number }, level: number,
  ray: { x: number; y: number; z: number; dx: number; dy: number; dz: number },
  o: { radius: number; cone: number; nearR: number; aimDeg: number; hitR: number },
  occupancy?: (s: Slot) => Occupancy, reachable?: (s: Slot) => boolean,
): SeatPick | null {
  const hl = Math.hypot(ray.dx, ray.dz), hx = hl > 1e-6 ? ray.dx / hl : 0, hz = hl > 1e-6 ? ray.dz / hl : 0;
  const aimCos = Math.cos((o.aimDeg * Math.PI) / 180);
  const cands: { s: Slot; d: number; aimed: boolean; along: number; cos: number }[] = [];
  for (const s of seats) {
    if ((s.level ?? 0) !== level) continue;
    const dx = s.pos.x - pos.x, dz = s.pos.z - pos.z;
    if (Math.abs(dx) > o.radius || Math.abs(dz) > o.radius) continue;
    const d = Math.hypot(dx, dz);
    if (d > o.radius || Math.abs((s.pos.y ?? 0) - pos.y) > 0.9) continue;
    const hdot = d > 1e-6 ? (dx * hx + dz * hz) / d : 1;
    if (d > o.nearR && hdot < o.cone) continue;
    // best point on the seat's vertical extent: largest cos to the ray; `along` = its distance along the ray
    let cos = -2, along = 0, miss = Infinity;
    const vx = s.pos.x - ray.x, vz = s.pos.z - ray.z;
    for (const h of SEAT_H) {
      const vy = (s.pos.y ?? 0) + h - ray.y, n = Math.hypot(vx, vy, vz);
      const a = vx * ray.dx + vy * ray.dy + vz * ray.dz, c = n > 1e-6 ? a / n : 1;
      if (c > cos) { cos = c; along = a; miss = Math.sqrt(Math.max(0, n * n - a * a)); }
    }
    const aimed = along > 0 && (cos >= aimCos || miss <= o.hitR);
    cands.push({ s, d, aimed, along, cos });
  }
  cands.sort((a, b) => (Number(b.aimed) - Number(a.aimed))
    || (a.aimed ? a.along - b.along : b.cos - a.cos)
    || a.d - b.d);
  // the top-ranked reachable seat decides: if it is taken there is no pick (never a different seat than the one in view)
  for (const c of cands) {
    if (reachable && !reachable(c.s)) continue;
    const occ = occupancy?.(c.s) ?? null;
    return occ?.busy ? null : { slot: c.s, owner: occ?.owner ?? null, d: c.d, aimed: c.aimed };
  }
  return null;
}
