// @pure
/**
 * [CHR fix m175-r2] Seat profiles: how far a seated character may turn on a seat and where the seat's backrest is, so
 * seated limbs stay on the near side of it (a Clawd swivelled toward the player on the Pit's low-back lounger poked
 * an arm nub out through the bolster). Desk chairs swivel (the brain's `swivelMax`); a sofa does not: the body turns
 * at most `turn` (root yaw off the slot's yaw + the pose's hip twist, together), the eyes do the rest. Owner: CHR.
 *
 * Frame: the Clawd's model frame at the slot (origin the slot point on the floor, +z toward the seat's front).
 *   back.top  backrest top above the floor (m)            back.z  the backrest's rear face (m, < 0)
 * World geometry this mirrors: world/build/kit/furniture.ts `buildSofa({back:'low'})` (seat 0.40, bolster top
 * 0.575 m, bolster rear 0.245 m and frame rear 0.35 m behind the sofa centre) with the slot 0.08 m ahead of the centre
 * (world/layout/hq.ts), i.e. the bolster rear at z −0.325 and the frame rear at z −0.43 in this frame.
 */

/** The part of a layout slot the seat rules read. */
export interface SeatSlot { tag?: string }

export interface SeatProfile { turn: number; back: { top: number; z: number } | null }

export const SEAT_PROFILES: Readonly<Record<string, SeatProfile>> = Object.freeze({
  sofa: Object.freeze({ turn: 0.28, back: Object.freeze({ top: 0.575, z: -0.325 }) }), // Pit lounger (low bolster back)
});

/** Profile for a slot (by its tag), or null (free seat: the caller's own swivel rule). */
export const seatProfile = (slot: SeatSlot | null | undefined): SeatProfile | null => (slot && slot.tag !== undefined && SEAT_PROFILES[slot.tag]) || null;

/**
 * Max body turn (rad) off the slot's yaw for a seated actor on `slot` (`dflt`: the brain's chair swivel).
 */
export const seatTurn = (slot: SeatSlot | null | undefined, dflt: number): number => { const p = seatProfile(slot); return p ? Math.min(p.turn, dflt) : dflt; };
