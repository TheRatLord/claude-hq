// @pure
/**
 * Breadcrumb trail behind a farmer, for ducklings waddling in a line: a crumb every `gap` metres, and a lookup of the
 * point `dist` metres back along the trail. When the farmer stands still the ducklings settle in a little arc behind.
 */
export interface Trail { xs: Float32Array; zs: Float32Array; head: number; n: number; gap: number }

export const newTrail = (x: number, z: number, cap = 64, gap = 0.2): Trail => {
  const t: Trail = { xs: new Float32Array(cap), zs: new Float32Array(cap), head: 0, n: 1, gap };
  t.xs[0] = x; t.zs[0] = z;
  return t;
};

export function trailPush(t: Trail, x: number, z: number): void {
  const hx = t.xs[t.head], hz = t.zs[t.head];
  if (Math.hypot(x - hx, z - hz) < t.gap) return;
  t.head = (t.head + 1) % t.xs.length;
  t.xs[t.head] = x; t.zs[t.head] = z;
  t.n = Math.min(t.n + 1, t.xs.length);
}

/** Point `dist` metres behind the current position (x, z) along the trail; clamps to the oldest crumb. */
export function trailAt(t: Trail, x: number, z: number, dist: number, out: { x: number; z: number }): { x: number; z: number } {
  let px = x, pz = z, left = dist;
  const cap = t.xs.length;
  for (let i = 0; i < t.n; i++) {
    const k = (t.head - i + cap) % cap;
    const qx = t.xs[k], qz = t.zs[k];
    const d = Math.hypot(qx - px, qz - pz);
    if (d >= left && d > 1e-6) {
      const f = left / d;
      out.x = px + (qx - px) * f; out.z = pz + (qz - pz) * f;
      return out;
    }
    left -= d; px = qx; pz = qz;
  }
  out.x = px; out.z = pz;
  return out;
}
