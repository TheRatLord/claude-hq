// @pure
/**
 * Baked camera paths (§6.10 "ride the slide"; the M4 zipline reuses it): a uniform Catmull-Rom spline through the
 * layout's control points, densely sampled once and reparameterised by arc length, so a ride can move at a chosen
 * speed profile along it. `sample(s, out)` is allocation-free. Owner: PLY.
 */

export interface P3 { x: number; y: number; z: number }
/** tangent is unit length */
export interface PathSample { x: number; y: number; z: number; tx: number; ty: number; tz: number }
export interface CamPath { length: number; sample(s: number, out?: PathSample): PathSample; heading(s: number): number }

/**
 * `pts` = control points (≥ 2). `perSeg`: dense samples per segment; `smooth`: corner rounding (m of arc length, a
 * two-pass box filter over a uniform resample, ends pinned). A camera riding inside a 0.32 m tube can round a baked
 * corner by a few cm without anyone seeing it, and a corner is a lateral jerk everyone feels.
 */
export function createCamPath(pts: readonly P3[], o: { perSeg?: number; smooth?: number } = {}): CamPath {
  const perSeg = o.perSeg ?? 12;
  if (!pts || pts.length < 2) throw new Error('createCamPath: need ≥ 2 points');
  const n = pts.length;
  const P = (i: number) => pts[Math.max(0, Math.min(n - 1, i))];
  const xs: number[] = [], ys: number[] = [], zs: number[] = [], acc: number[] = [0];
  const cr = (a: number, b: number, c: number, d: number, t: number) => {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
  };
  for (let i = 0; i < n - 1; i++) {
    const a = P(i - 1), b = P(i), c = P(i + 1), d = P(i + 2);
    for (let k = i === 0 ? 0 : 1; k <= perSeg; k++) {
      const t = k / perSeg;
      xs.push(cr(a.x, b.x, c.x, d.x, t)); ys.push(cr(a.y, b.y, c.y, d.y, t)); zs.push(cr(a.z, b.z, c.z, d.z, t));
    }
  }
  for (let i = 1; i < xs.length; i++) acc.push(acc[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1], zs[i] - zs[i - 1]));
  if (o.smooth !== undefined && o.smooth > 0) smoothInPlace(xs, ys, zs, acc, o.smooth);
  const length = acc[acc.length - 1];
  const m = xs.length;

  /** index i and fraction f with acc[i] ≤ s ≤ acc[i+1] */
  let hint = 0;
  const locate = (s: number): [number, number] => {
    s = Math.max(0, Math.min(length, s));
    let i = hint;
    if (acc[i] > s) i = 0;
    while (i < m - 2 && acc[i + 1] < s) i++;
    hint = i;
    const seg = acc[i + 1] - acc[i];
    return [i, seg > 1e-9 ? (s - acc[i]) / seg : 0];
  };
  const posAt = (s: number, o: P3) => {
    const [i, f] = locate(s);
    o.x = xs[i] + (xs[i + 1] - xs[i]) * f; o.y = ys[i] + (ys[i + 1] - ys[i]) * f; o.z = zs[i] + (zs[i + 1] - zs[i]) * f;
    return o;
  };
  const a = { x: 0, y: 0, z: 0 }, b = { x: 0, y: 0, z: 0 };
  const H = Math.min(0.12, length / 4); // central-difference half width: smooth tangents across the dense samples
  const tangent = (s: number): [number, number, number] => {
    const s0 = Math.max(0, s - H), s1 = Math.min(length, s + H);
    posAt(s0, a); posAt(s1, b);
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    return [dx / l, dy / l, dz / l];
  };
  return {
    length,
    sample(s, out = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: -1 }) {
      posAt(s, out);
      const [tx, ty, tz] = tangent(s);
      out.tx = tx; out.ty = ty; out.tz = tz;
      return out;
    },
    /** Camera yaw (§ yawTo convention: forward = (−sin, −cos)) of the horizontal tangent at s. */
    heading(s: number) { const [tx, , tz] = tangent(s); return Math.atan2(-tx, -tz); },
  };
}

/** Uniform resample at ~2 cm, two box-filter passes of ±w/2, ends pinned (window shrinks), lengths recomputed. */
function smoothInPlace(xs: number[], ys: number[], zs: number[], acc: number[], w: number) {
  const total = acc[acc.length - 1];
  const n = Math.max(2, Math.ceil(total / 0.02) + 1);
  const rx = new Array<number>(n), ry = new Array<number>(n), rz = new Array<number>(n);
  for (let k = 0, i = 0; k < n; k++) {
    const s = (total * k) / (n - 1);
    while (i < acc.length - 2 && acc[i + 1] < s) i++;
    const seg = acc[i + 1] - acc[i], f = seg > 1e-9 ? (s - acc[i]) / seg : 0;
    rx[k] = xs[i] + (xs[i + 1] - xs[i]) * f; ry[k] = ys[i] + (ys[i + 1] - ys[i]) * f; rz[k] = zs[i] + (zs[i + 1] - zs[i]) * f;
  }
  const h = Math.max(1, Math.round(w / 2 / (total / (n - 1))));
  for (let pass = 0; pass < 2; pass++) {
    const ox = rx.slice(), oy = ry.slice(), oz = rz.slice();
    for (let k = 1; k < n - 1; k++) {
      const r = Math.min(h, k, n - 1 - k);
      let sx = 0, sy = 0, sz = 0;
      for (let j = k - r; j <= k + r; j++) { sx += ox[j]; sy += oy[j]; sz += oz[j]; }
      const c = 2 * r + 1;
      rx[k] = sx / c; ry[k] = sy / c; rz[k] = sz / c;
    }
  }
  xs.length = ys.length = zs.length = acc.length = 0;
  for (let k = 0; k < n; k++) {
    xs.push(rx[k]); ys.push(ry[k]); zs.push(rz[k]);
    acc.push(k ? acc[k - 1] + Math.hypot(rx[k] - rx[k - 1], ry[k] - ry[k - 1], rz[k] - rz[k - 1]) : 0);
  }
}

/**
 * Ease-in ride profile: fraction of the path length covered at normalised time t ∈ [0, 1].
 * s(t) = (1 − e)·t + e·t², so speed starts at (1 − e) and ends at (1 + e) times the mean.
 */
export const rideEase = (t: number, e: number): number => { const u = Math.max(0, Math.min(1, t)); return (1 - e) * u + e * u * u; };
/** Speed factor (× mean speed) of `rideEase` at t. */
export const rideSpeed = (t: number, e: number): number => (1 - e) + 2 * e * Math.max(0, Math.min(1, t));
