// @pure
/**
 * Soft actor collision: circular actors initially push the player out radially and remove inward velocity.
 * After `pushThroughS` of contact, passage is allowed at `throughSpeedMul` speed if the far side is free.
 * A stopped player inside a passable actor is eased back out by `squeezeOut`.
 * Leaving contact beyond `releaseGap` re-arms the collider.
 *
 * `softStep` mutates position, velocity, and persistent contacts, returning contact transitions and
 * the speed multiplier for the next movement target. It does not own actors, controllers, or events.
 */

export interface SoftCollider { id: string; pos: { x: number; y: number; z: number }; radius?: number }
export interface Contact { t: number; through: boolean; seen: number }
export interface BumpEvent { id: string; phase: 'hit' | 'through'; x: number; z: number; speed: number }
export interface SoftOpts {
  radius: number; actorRadius: number; pushThroughS: number; throughSpeedMul: number; releaseGap: number; squeezeOut: number; maxDy: number;
}

/**
 * `pos` = player feet (mutated), `vel` = player horizontal velocity (mutated), `contacts` = persistent per-actor contact
 * state (mutated), `blocked` = world collision test (the push-out never shoves into a wall), `frame` = monotonically
 * increasing frame stamp (stale contact cleanup). `speedMul` < 1 while squeezing through (scale the walk target).
 */
export function softStep(
  pos: { x: number; y: number; z: number }, vel: { x: number; z: number }, colliders: Iterable<SoftCollider>, contacts: Map<string, Contact>,
  dt: number, o: SoftOpts, blocked: ((x: number, z: number) => boolean) | null = null, frame = 0,
): { events: BumpEvent[]; speedMul: number } {
  const out: BumpEvent[] = [];
  let slow = 1;
  for (const c of colliders) {
    const cp = c?.pos;
    if (!cp || Math.abs(cp.y - pos.y) > o.maxDy) continue; // Vertically separated actors do not collide.
    const R = o.radius + (c.radius ?? o.actorRadius);
    let dx = pos.x - cp.x, dz = pos.z - cp.z;
    let d = Math.hypot(dx, dz);
    let s = contacts.get(c.id);
    if (d >= R) {
      if (s) { s.seen = frame; if (d > R + o.releaseGap) contacts.delete(c.id); }
      continue;
    }
    const speed = Math.hypot(vel.x, vel.z);
    if (!s) {
      s = { t: 0, through: false, seen: frame };
      contacts.set(c.id, s);
      out.push({ id: c.id, phase: 'hit', x: cp.x, z: cp.z, speed });
    }
    s.seen = frame;
    s.t += dt;
    // exactly on top → treat as approaching along the walk direction (or from +z)
    if (d < 1e-6) {
      const l = Math.hypot(vel.x, vel.z);
      if (l > 1e-6) { dx = -vel.x / l; dz = -vel.z / l; } else { dx = 0; dz = 1; }
      d = 1;
    }
    const nx = dx / d, nz = dz / d;
    // push through only when there is room on the far side: never park the camera inside an actor against a wall
    if (!s.through && s.t >= o.pushThroughS && !(blocked && blocked(cp.x - nx * (R + 0.02), cp.z - nz * (R + 0.02)))) {
      s.through = true;
      out.push({ id: c.id, phase: 'through', x: cp.x, z: cp.z, speed });
    }
    if (s.through) {
      slow = Math.min(slow, o.throughSpeedMul);
      // stopped halfway: ease back out instead of resting in its head (skipped while walking on, so it can't stall you)
      if (speed > 0.5) continue;
      const k = Math.min(1, dt * o.squeezeOut) * (R - d);
      const px = pos.x + nx * k, pz = pos.z + nz * k;
      if (!blocked || !blocked(px, pz)) { pos.x = px; pos.z = pz; }
      continue;
    }
    const tx = cp.x + nx * R, tz = cp.z + nz * R;
    if (!blocked || !blocked(tx, tz)) { pos.x = tx; pos.z = tz; }
    else if (!blocked(tx, pos.z)) pos.x = tx;
    else if (!blocked(pos.x, tz)) pos.z = tz;
    // (fully wedged against a wall: stay put; the 0.3 s push-through frees it)
    const vn = vel.x * nx + vel.z * nz;
    if (vn < 0) { vel.x -= vn * nx; vel.z -= vn * nz; } // kill the inward component → slide around the actor
  }
  // actors that vanished (left, re-keyed) while in contact: forget them
  for (const [id, s] of contacts) if (s.seen !== frame) contacts.delete(id);
  return { events: out, speedMul: slow };
}
