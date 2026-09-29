// @pure
/** Player feel numbers (§6.10). Owner: PLY. */
export const TUNING = Object.freeze({
  eyeHeight: 1.2,
  radius: 0.28,
  // agents are soft (§6.10): actor circle, contact time before the player squeezes through, speed while squeezing
  soft: { actorRadius: 0.32, pushThroughS: 0.3, throughSpeedMul: 0.45, releaseGap: 0.15, squeezeOut: 5, maxDy: 1.2 },
  walk: 3.6,
  sprint: 5.6,
  accelTime: 0.14,   // 0 → walk
  decelTime: 0.10,   // walk → 0
  airControl: 0.4,
  sprintFovKick: 5, sprintFovIn: 0.2, sprintFovOut: 0.3,
  bob: { amp: 0.018, lateral: 0.008, rollDeg: 0.35, walkHz: 1.9, sprintHz: 2.6 },
  stepSmooth: 0.08,
  /**
   * Camera height follow (stairs, Pit steps, ENG +0.25): critically damped toward the eye target (ω = 3/stepSmooth, so
   * ~95% in 0.08 s), rate-capped at `camMaxRate` so no step ever moves the eye > 3 cm in a 60 fps frame. The eye
   * target itself averages the floor under the body circle (`floorProbe`), turning a 0.25 m step into a ramp.
   */
  camMaxRate: 1.6, floorProbe: 0.28,
  /** Horizontal speed cap on the stairs ramp: sprinting up still reads fast, and the rise stays ≤ camMaxRate. */
  stairsMax: 3.85,
  jump: { v0: 4.2, g: 12, releaseMul: 1.8, coyote: 0.12, buffer: 0.1 },
  landDip: { k: 0.012, min: 0.02, max: 0.1, omega: 18, zeta: 0.6 },
  lookSens: 0.0022,
  pitchLimit: 1.45,
  /** E radius (§6.10 Interaction), the forward cone a seat must be in (cos) beyond `nearR`, and the reticle aim: a seat
   *  within `aimDeg` of the view ray (or `hitR` m of it) is under the reticle and beats any nearer seat off it. */
  interact: { radius: 1.6, cone: 0.45, nearR: 0.7, aimDeg: 15, hitR: 0.3 },
  sit: {
    glide: 0.3, eye: 0.78, yawClampDeg: 100, pitchClampDeg: 60,
    stand: 0.34, hop: 0.13,          // stand-up glide (s) and its hop arc (m)
    standOut: [0.55, 1.4],           // search range in front of the seat for a free standing spot (m)
  },
  slide: {
    mount: 0.4,                       // glide from where E was pressed into the mouth (s)
    smooth: 0.5,                      // corner rounding of the baked path (m of arc; stays inside the 0.32 m tube)
    // camera above the slide centreline (centreline = path + tubeLift). §6.10 says +0.25, but the greybox chute is a
    // closed 0.32 m tube, so +0.25 put the eye inside it and the near plane sliced the walls (review r1). 0.5 keeps
    // the eye `lipClear` (0.18 m) above the lip: ≥ 2× the near-plane corner reach even pitched down with 6° roll.
    camUp: 0.5,
    tubeLift: 0.3,                    // greybox tube is drawn at path.y + 0.3
    ease: 0.65,                       // s(t) = (1−ease)·t + ease·t²: starts at 35% of the mean speed, ends at 165%
    fovKick: 8, fovIn: 0.35, fovOut: 0.45,
    rollMaxDeg: 6, rollPerYawRate: 0.03, rollSmooth: 0.12,
    pitchFollow: 0.55,                // share of the descent angle (eye → look-ahead point) the camera pitches with
    lookAhead: 0.45,                  // travel direction = chord to this far down the slide (m of arc; ≈ the tangent)
    /**
     * Default look = travel direction + `weight` × direction to the atrium focus (the Pit, aimed `y` m up so the
     * Big Board is in frame too). weight < 1 keeps the sum well defined when the helix faces away from the Pit; the
     * bias (yaw/pitch offset from the travel direction) is smoothed over `smooth` s so that crossing the
     * "facing away" point swings the view round gently instead of whipping.
     */
    focus: { weight: 0.7, y: 2.0, smooth: 0.25 },
    lookClampDeg: 60,
    carry: 0.6, carryMax: 5.2, exitDipV: 4.2,
  },
});
