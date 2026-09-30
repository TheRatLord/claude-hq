// @pure
/** Small math helpers. Forward = (−sin yaw, 0, −cos yaw); yaw 0 faces −z. */

export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number): number => (a === b ? 0 : (v - a) / (b - a));
export const smoothstep = (a: number, b: number, v: number): number => { const t = clamp(invLerp(a, b, v), 0, 1); return t * t * (3 - 2 * t); };
/** Frame-rate independent exponential approach: rate = 1/s (≈ time constant⁻¹). */
export const damp = (cur: number, target: number, rate: number, dt: number): number => lerp(cur, target, 1 - Math.exp(-rate * dt));
/** Wrap an angle to (−π, π]. */
export const wrapAngle = (a: number): number => { const r = (((a + Math.PI) % TAU) + TAU) % TAU - Math.PI; return r <= -Math.PI ? r + TAU : r; };
export const dampAngle = (cur: number, target: number, rate: number, dt: number): number => cur + wrapAngle(target - cur) * (1 - Math.exp(-rate * dt));
/** Yaw that faces along (dx, dz). */
export const yawTo = (dx: number, dz: number): number => Math.atan2(-dx, -dz);
export const forwardX = (yaw: number): number => -Math.sin(yaw);
export const forwardZ = (yaw: number): number => -Math.cos(yaw);
export const dist2 = (ax: number, az: number, bx: number, bz: number): number => (ax - bx) ** 2 + (az - bz) ** 2;
