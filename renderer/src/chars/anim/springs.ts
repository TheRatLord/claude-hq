// @pure
/**
 * Damped springs (ART §6.2, DESIGN §6.3). Semi-implicit Euler with k = (2πf)², c = 2ζ·2πf; dt clamped to 1/30 and
 * sub-stepped so stiff presets stay stable at low frame rates. Owner: CHR.
 */

/** A spring preset: f (Hz), z (damping ratio). */
export interface SpringPreset { f: number; z: number }

/** Presets. */
export const SPRING = Object.freeze({
  snappy: { f: 6, z: 0.5 },
  bouncy: { f: 3.5, z: 0.3 },
  floaty: { f: 1.5, z: 0.6 },
  jiggle: { f: 8, z: 0.15 },
  wobble: { f: 5, z: 0.22 }, // body squash settle
  gentle: { f: 2.4, z: 0.45 },
});

export type SpringName = keyof typeof SPRING;

const MAX_DT = 1 / 30;
const SUB = 1 / 120;

export class Spring1D {
  x: number;
  v: number;
  target: number;
  k!: number;
  c!: number;
  constructor(p: SpringPreset = SPRING.snappy, x0 = 0) {
    this.x = x0; this.v = 0; this.target = x0;
    this.set(p);
  }
  set(p: SpringPreset): this {
    const w = 2 * Math.PI * p.f;
    this.k = w * w; this.c = 2 * p.z * w;
    return this;
  }
  /** Integrate toward `target` (or this.target). */
  update(dt: number, target: number = this.target): number {
    this.target = target;
    let t = Math.min(dt, MAX_DT);
    while (t > 1e-6) {
      const h = Math.min(t, SUB);
      this.v += (this.k * (target - this.x) - this.c * this.v) * h;
      this.x += this.v * h;
      t -= h;
    }
    return this.x;
  }
  /**
   * update() without the return value: read `.x` after. [CHR m2 r2 alloc] A double returned from a call that is not
   * inlined is boxed into a fresh HeapNumber; the per-frame animator paths use step() so nothing is boxed.
   */
  step(dt: number, target: number): void {
    this.target = target;
    let t = dt < MAX_DT ? dt : MAX_DT;
    while (t > 1e-6) {
      const h = t < SUB ? t : SUB;
      this.v += (this.k * (target - this.x) - this.c * this.v) * h;
      this.x += this.v * h;
      t -= h;
    }
  }
  /** Add an instantaneous velocity kick (impacts, landings). */
  kick(dv: number): this { this.v += dv; return this; }
  reset(x = 0): this { this.x = x; this.v = 0; this.target = x; return this; }
}

export class Spring3D {
  x: Spring1D;
  y: Spring1D;
  z: Spring1D;
  constructor(p: SpringPreset = SPRING.snappy) {
    this.x = new Spring1D(p); this.y = new Spring1D(p); this.z = new Spring1D(p);
  }
  set(p: SpringPreset): this { this.x.set(p); this.y.set(p); this.z.set(p); return this; }
  update(dt: number, tx: number, ty: number, tz: number): this { this.x.update(dt, tx); this.y.update(dt, ty); this.z.update(dt, tz); return this; }
  kick(vx: number, vy: number, vz: number): this { this.x.kick(vx); this.y.kick(vy); this.z.kick(vz); return this; }
  reset(x = 0, y = 0, z = 0): this { this.x.reset(x); this.y.reset(y); this.z.reset(z); return this; }
}

/**
 * Pendulum-ish secondary motion for a dangling/sticking-up tip (pompom, antenna, cone tip): driven by the
 * acceleration of its anchor in the anchor's local frame. Output (x, z) are small tilt angles in radians.
 */
export class Jiggle {
  sx: Spring1D;
  sz: Spring1D;
  gain: number;
  /** @param gain rad per (m/s²) */
  constructor(p: SpringPreset = SPRING.jiggle, gain = 0.045) {
    this.sx = new Spring1D(p); this.sz = new Spring1D(p); this.gain = gain;
  }
  /** @param ax local lateral accel @param az local forward accel */
  update(dt: number, ax: number, az: number): this {
    // Inertia: the tip lags opposite to the acceleration.
    this.sx.kick(-ax * this.gain * Math.min(dt, MAX_DT) * 60);
    this.sz.kick(-az * this.gain * Math.min(dt, MAX_DT) * 60);
    this.sx.step(dt, 0); this.sz.step(dt, 0);
    const lim = 0.9;
    if (this.sx.x > lim) this.sx.x = lim; else if (this.sx.x < -lim) this.sx.x = -lim;
    if (this.sz.x > lim) this.sz.x = lim; else if (this.sz.x < -lim) this.sz.x = -lim;
    return this;
  }
}
