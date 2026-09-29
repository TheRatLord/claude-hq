// @pure
/**
 * [CHR M3.5] The viewer (the player's camera) every animator reacts to: seated workers turn their face toward a player
 * walking up (§M3.5 walk-up), and `glanceBack` / `lookBackWave` / `summoned*` aim at it. charBatch.write() stores the
 * camera position once per frame (the animators of the next frame read it: one frame of lag, invisible). Pages
 * without a charBatch camera leave `on` false and every viewer-driven turn is skipped. Owner: CHR.
 */
export const VIEWER: { x: number; y: number; z: number; on: boolean; fx: number; fz: number } = { x: 0, y: 0, z: 0, on: false, fx: 0, fz: 0 };

interface Vec3Like { x: number; y: number; z: number }

/**
 * @param fwd [CHR fix m3-r3] the camera's forward (the walk-up swivel goes to the worker the player is looking at,
 *   not a nearer one at the edge of the frame); omitted = no preference
 */
export function setViewer(p: Vec3Like | null, fwd: Vec3Like | null = null): void {
  if (!p) { VIEWER.on = false; SWIVEL.holder = 0; SWIVEL.miss = 0; SWIVEL.d = 99; return; }
  VIEWER.x = p.x; VIEWER.y = p.y; VIEWER.z = p.z; VIEWER.on = true;
  const l = fwd ? Math.hypot(fwd.x, fwd.z) : 0;
  if (fwd && l > 1e-4) { VIEWER.fx = fwd.x / l; VIEWER.fz = fwd.z / l; } else { VIEWER.fx = 0; VIEWER.fz = 0; }
}

/**
 * [CHR fix m3-r3] Walk-up swivel score for an actor at (rx, rz) `d` m from the viewer: the distance plus SWIVEL_AIM m
 * per radian off the camera's heading, so the worker in the middle of the view beats a nearer one at its edge.
 */
export function swivelScore(rx: number, rz: number, d: number): number {
  if (!(VIEWER.fx || VIEWER.fz) || d < 1e-4) return d;
  const c = ((rx - VIEWER.x) * VIEWER.fx + (rz - VIEWER.z) * VIEWER.fz) / d;
  return d + SWIVEL_AIM * Math.acos(c > 1 ? 1 : c < -1 ? -1 : c);
}

/**
 * Where the viewer is, seen from a rig root (model faces +z, root yaw = rotation.y): horizontal distance and the
 * signed yaw to turn the body by to face it (0 = straight ahead, + = toward the model's +x side, ±π = behind).
 * Writes into `out` (no allocation).
 */
export function viewerRel(rx: number, rz: number, yaw: number, out: { d: number; rel: number }): { d: number; rel: number } {
  const dx = VIEWER.x - rx, dz = VIEWER.z - rz;
  out.d = Math.sqrt(dx * dx + dz * dz);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  out.rel = Math.atan2(lx, lz);
  return out;
}

/**
 * [CHR fix m3-r3] The walk-up swivel-out (animator.ts) is one agent's move: the seated worker the player walked up to
 * rolls its chair back and out and swivels to face them. Its neighbours, also inside the radius, keep the mild head
 * turn (two neighbours rolling out toward the same player would collide). The claim goes to the eligible worker
 * with the lowest swivelScore (near, and in the middle of the view); a challenger takes it only when it scores
 * SWIVEL_STEAL lower (no flip-flop between two equidistant desks),
 * and a holder that stops calling (culled, removed, stood up) goes stale after SWIVEL_STALE other calls. @pure state.
 */
export const SWIVEL = { holder: 0, d: 99, miss: 0 };
export const SWIVEL_STEAL = 0.3, SWIVEL_STALE = 90, SWIVEL_AIM = 4;
let swivelIds = 0;
/** A fresh claimant id (one per animator). */
export const swivelId = (): number => ++swivelIds;
/**
 * Called by every seated animator each update: `eligible` = inside the walk-up radius. Returns true while `id` holds
 * the swivel.
 * @param d swivelScore (m)
 */
export function claimSwivel(id: number, d: number, eligible: boolean): boolean {
  if (SWIVEL.holder === id) {
    if (!eligible) { SWIVEL.holder = 0; SWIVEL.d = 99; return false; }
    SWIVEL.d = d; SWIVEL.miss = 0; return true;
  }
  if (!eligible) return false;
  if (SWIVEL.holder === 0 || ++SWIVEL.miss > SWIVEL_STALE || d < SWIVEL.d - SWIVEL_STEAL) { SWIVEL.holder = id; SWIVEL.d = d; SWIVEL.miss = 0; return true; }
  return false;
}
