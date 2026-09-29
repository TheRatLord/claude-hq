// @pure
/**
 * Player-feel maths (§6.10) shared by the controller and `__hq.feelTrace` (§9.1): head-bob shape phase-locked to
 * footsteps, the landing-dip spring impulse, and the trace analysis the gameplay reviewer reads. Owner: PLY.
 *
 * Bob phase φ advances at stepHz·π rad/s, so one footstep = Δφ of π:
 *   vertical  y = −amp·(1 − cos 2φ)/2 + amp/2   → full cycle per step (walk 1.9 Hz), trough (foot plant) at φ = kπ
 *   lateral   x = lateral·cos φ                  → half the step rate (0.95 Hz), extreme over the planted foot
 *   roll      r = roll·cos φ
 * A `player.step` fires when ⌊φ/π⌋ changes, i.e. exactly at the vertical trough.
 */

/** Phase advance (rad) for dt seconds at a footstep rate of hz. */
export const bobAdvance = (dt: number, hz: number): number => dt * hz * Math.PI;

/** Footstep index for a phase: a new step (and bob trough) begins each time this changes. */
export const stepIndex = (phase: number): number => Math.floor(phase / Math.PI);

/** Normalised bob offsets for a phase (multiply by amplitudes). y ∈ [−0.5, 0.5], trough −0.5 at φ = kπ. */
export function bobShape(phase: number): { y: number; x: number; roll: number } {
  const c = Math.cos(phase);
  return { y: -0.5 * Math.cos(2 * phase), x: c, roll: c };
}

/** Peak displacement of a damped spring (ω, ζ < 1) released from rest position with unit initial velocity. */
export function springPeakPerVelocity(omega: number, zeta: number): number {
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  const tPeak = Math.atan2(wd, zeta * omega) / wd;
  return Math.exp(-zeta * omega * tPeak) * Math.sin(wd * tPeak) / wd;
}

/**
 * Advance an underdamped spring (rest 0) exactly by dt: frame-rate independent, no Euler energy loss
 * (semi-implicit Euler at 60 fps with ω 18 lost ~30% of the dip depth). Returns [x, v].
 */
export function springStep(x: number, v: number, dt: number, omega: number, zeta: number): [number, number] {
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  const e = Math.exp(-zeta * omega * dt), c = Math.cos(wd * dt), s = Math.sin(wd * dt);
  return [e * (x * c + (v + zeta * omega * x) / wd * s), e * (v * c - (omega * omega * x + zeta * omega * v) / wd * s)];
}

/**
 * Initial spring velocity so the landing dip actually reaches `clamp(k·vFall, min, max)` metres at its trough.
 * `vFall` is m/s (positive); the returned `impulse` is the (negative) velocity to add.
 */
export function landDipImpulse(vFall: number, d: { k: number; max: number; min: number; omega: number; zeta: number }): { depth: number; impulse: number } {
  const depth = Math.min(d.max, Math.max(d.min, d.k * vFall));
  return { depth, impulse: -depth / springPeakPerVelocity(d.omega, d.zeta) };
}

/**
 * One sampled frame of a feel trace: `t` in ms; `bobY` = applied vertical bob (m), `bobN` = its normalised shape,
 * `bobAmp` = 0…1 envelope; `mode` 'walk' (default) | 'sit' | 'glide' (sit-down / stand-up / slide mount) | 'ride';
 * `ex`/`ey`/`ez` = final camera position, `roll` in radians.
 */
export interface FeelFrame {
  t: number; camY: number; dip: number; bobY: number; bobN: number; bobAmp: number; fov: number; speed: number; grounded: boolean;
  mode?: string; ex?: number; ey?: number; ez?: number; roll?: number;
}
/** `type`: 'step' | 'land' | 'bump' | 'sit' | 'stand' | 'ride' | 'rideEnd' | … (+ whatever detail the controller adds). */
export interface FeelEvent { t: number; type: string; speed?: number; v?: number; depth?: number; tag?: string; id?: string | null; phase?: string; on?: boolean }

/** Analyse a feel trace. */
export function analyseFeel(frames: FeelFrame[], events: FeelEvent[]) {
  let maxDyPerFrame = 0, maxDyRaw = 0, maxDyGlide = 0, maxD2y = 0, maxDip = 0, fovMin = Infinity, fovMax = -Infinity, speedMax = 0;
  let maxFrameMs = 0, maxDyAt: number | null = null, maxDyPer60 = 0;
  const lands = events.filter((e) => e.type === 'land').map((e) => e.t);
  const nearLand = (t: number) => lands.some((l) => t >= l - 20 && t <= l + 500);
  const mode = (f: FeelFrame) => f.mode ?? 'walk';
  const eyeY = (f: FeelFrame) => f.ey ?? f.camY + f.bobY + f.dip;
  // a frame without ex/ey/ez (hand-built traces) reads as NaN, exactly like the untyped arithmetic did
  const at = (v: number | undefined) => v ?? NaN;
  const ride: { frames: number; t0: number | null; t1: number | null; maxFrameMs: number; maxJerk: number; maxRollDeg: number; fovMax: number; maxDy: number } = { frames: 0, t0: null, t1: null, maxFrameMs: 0, maxJerk: 0, maxRollDeg: 0, fovMax: -Infinity, maxDy: 0 };
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    maxDip = Math.max(maxDip, -f.dip);
    fovMin = Math.min(fovMin, f.fov); fovMax = Math.max(fovMax, f.fov);
    speedMax = Math.max(speedMax, f.speed);
    if (mode(f) === 'ride') {
      ride.frames++; ride.t0 ??= f.t; ride.t1 = f.t;
      ride.maxRollDeg = Math.max(ride.maxRollDeg, Math.abs((f.roll ?? 0) * 180 / Math.PI));
      ride.fovMax = Math.max(ride.fovMax, f.fov);
    }
    if (!i) continue;
    const p = frames[i - 1];
    maxFrameMs = Math.max(maxFrameMs, f.t - p.t);
    const raw = Math.abs(f.camY + f.bobY + f.dip - (p.camY + p.bobY + p.dip));
    maxDyRaw = Math.max(maxDyRaw, raw);
    const mf = mode(f), mp = mode(p);
    if (mf === 'ride' && mp === 'ride') {
      ride.maxFrameMs = Math.max(ride.maxFrameMs, f.t - p.t);
      ride.maxDy = Math.max(ride.maxDy, Math.abs(eyeY(f) - eyeY(p)));
      if (i > 1 && mode(frames[i - 2]) === 'ride' && f.ex != null) {
        const q = frames[i - 2];
        ride.maxJerk = Math.max(ride.maxJerk, Math.hypot(f.ex - 2 * at(p.ex) + at(q.ex), at(f.ey) - 2 * at(p.ey) + at(q.ey), at(f.ez) - 2 * at(p.ez) + at(q.ez)));
      }
    } else if (mf !== mp && (mf === 'ride' || mp === 'ride')) {
      // entering / leaving the slide: the ride's own motion meets the exit landing (the dip is excluded by design)
      ride.maxDy = Math.max(ride.maxDy, Math.abs(eyeY(f) - eyeY(p)));
    } else if (mf === 'glide' || mp === 'glide') {
      maxDyGlide = Math.max(maxDyGlide, Math.abs(eyeY(f) - eyeY(p)));
    } else if (f.grounded && p.grounded) {
      // "no camera pop > 3 cm/frame except the landing dip": ballistic (jump/fall) frames are motion, not pops
      const dy = Math.abs(f.camY + f.bobY - (p.camY + p.bobY));
      if (dy > maxDyPerFrame) { maxDyPerFrame = dy; maxDyAt = f.t; }
      // the same, normalised to a 60 fps frame (a hitch frame covers more motion without being a pop)
      maxDyPer60 = Math.max(maxDyPer60, dy * (1000 / 60) / Math.max(1000 / 60, f.t - p.t));
    }
    // a pop is a discontinuity: the largest change of vertical camera velocity between frames (m/frame), off the dip
    if (i > 1 && f.grounded && p.grounded && frames[i - 2].grounded && !nearLand(f.t) && mf !== 'ride') {
      const q = frames[i - 2];
      maxD2y = Math.max(maxD2y, Math.abs(eyeY(f) - 2 * eyeY(p) + eyeY(q)));
    }
  }
  // bob troughs from the sampled bob *shape* (phase, amplitude-normalised so the start/stop ramps don't fake minima):
  // local minima while the bob is visible (amp ≥ 0.25), refined by a parabola through 3 samples
  const troughs: number[] = [];
  for (let i = 1; i < frames.length - 1; i++) {
    const a = frames[i - 1], b = frames[i], c = frames[i + 1];
    if (!(b.bobN < a.bobN && b.bobN <= c.bobN) || b.bobAmp < 0.25) continue;
    const den = a.bobN - 2 * b.bobN + c.bobN;
    const h = (c.t - a.t) / 2;
    const off = den > 1e-12 ? clamp(0.5 * (a.bobN - c.bobN) / den, -1, 1) * h : 0;
    troughs.push(b.t + off);
  }
  const steps = events.filter((e) => e.type === 'step');
  let errSum = 0, errMax = 0, matched = 0;
  for (const s of steps) {
    let best = Infinity;
    for (const t of troughs) best = Math.min(best, Math.abs(t - s.t));
    if (best < 150) { errSum += best; errMax = Math.max(errMax, best); matched++; }
  }
  const walkIv: number[] = [], sprintIv: number[] = [];
  for (let i = 1; i < steps.length; i++) {
    const iv = steps[i].t - steps[i - 1].t;
    if (iv > 1000) continue;
    ((steps[i].speed ?? 0) > 4.6 ? sprintIv : walkIv).push(iv);
  }
  const mean = (a: number[]): number | null => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  const hz = (a: number[]): number | null => { const m = mean(a); return m === null ? null : 1000 / m; };
  const dur = frames.length > 1 ? frames[frames.length - 1].t - frames[0].t : 0;
  const r = (v: number | null | undefined, n = 4): number | null => (v == null || !Number.isFinite(v) ? null : +v.toFixed(n));
  return {
    frames: frames.length, durationMs: r(dur, 1),
    maxDyPerFrame: r(maxDyPerFrame), maxDyRaw: r(maxDyRaw),
    bobPhaseErrMs: r(matched ? errMax : null, 2), bobPhaseErrMeanMs: r(matched ? errSum / matched : null, 2),
    steps: steps.length, stepsMatched: matched, troughs: troughs.length,
    walkStepMs: r(mean(walkIv), 1), walkStepHz: r(hz(walkIv), 3),
    sprintStepMs: r(mean(sprintIv), 1), sprintStepHz: r(hz(sprintIv), 3),
    stepTimes: steps.map((e) => r(e.t, 1)), troughTimes: troughs.map((t) => r(t, 1)),
    lands: events.filter((e) => e.type === 'land').map((e) => ({ t: r(e.t, 1), v: r(e.v, 2), depth: r(e.depth) })),
    maxDip: r(maxDip), fovMin: r(fovMin, 2), fovMax: r(fovMax, 2), speedMax: r(speedMax, 2),
    maxDyAtMs: r(maxDyAt, 1), maxDyPer60: r(maxDyPer60),
    maxDyGlide: r(maxDyGlide), maxD2y: r(maxD2y), maxFrameMs: r(maxFrameMs, 1),
    fps: r(dur > 0 ? ((frames.length - 1) * 1000) / dur : null, 1),
    ride: ride.frames > 1 ? {
      frames: ride.frames, durationMs: r((ride.t1 ?? NaN) - (ride.t0 ?? NaN), 1), fps: r(((ride.frames - 1) * 1000) / Math.max(1, (ride.t1 ?? NaN) - (ride.t0 ?? NaN)), 1),
      maxFrameMs: r(ride.maxFrameMs, 1), maxJerk: r(ride.maxJerk), maxDy: r(ride.maxDy), maxRollDeg: r(ride.maxRollDeg, 2), fovMax: r(ride.fovMax, 2),
    } : null,
    modes: events.filter((e) => /^(sit|stand|ride|rideEnd)$/.test(e.type)).map((e) => ({ t: r(e.t, 1), type: e.type, ...(e.tag ? { tag: e.tag } : {}) })),
  };
}

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
