// @pure
/**
 * Second-order dynamics (t3ssel8r f/ζ/r form): y + k1·y' + k2·y'' = x + k3·x'. r < 0 gives an automatic wind-up
 * (anticipation) against the direction of a target change; r > 1 overshoots on the way in. Owner: CHR.
 */
export class SecondOrderDynamics {
  k1: number;
  k2: number;
  k3: number;
  xp: number;
  y: number;
  yd: number;
  /** @param f Hz @param z damping @param r response */
  constructor(f: number, z: number, r: number, x0 = 0) {
    this.k1 = z / (Math.PI * f);
    this.k2 = 1 / ((2 * Math.PI * f) ** 2);
    this.k3 = (r * z) / (2 * Math.PI * f);
    this.xp = x0; this.y = x0; this.yd = 0;
  }
  /** @param x target @param xd target velocity (estimated if omitted) */
  update(dt: number, x: number, xd?: number): number {
    if (dt <= 0) return this.y;
    dt = Math.min(dt, 1 / 30);
    if (xd === undefined) { xd = (x - this.xp) / dt; this.xp = x; }
    // Stable k2 clamp (pole matching lite).
    const k2 = Math.max(this.k2, (dt * dt) / 2 + (dt * this.k1) / 2, dt * this.k1);
    this.y += dt * this.yd;
    this.yd += (dt * (x + this.k3 * xd - this.y - this.k1 * this.yd)) / k2;
    return this.y;
  }
  reset(x = 0): void { this.xp = x; this.y = x; this.yd = 0; }
}
