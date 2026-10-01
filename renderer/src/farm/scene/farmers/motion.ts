// @pure
/**
 * Locomotion: follow a route with a look-ahead carrot, turn smoothly (farmers walk in arcs, and turn on the spot
 * when the heading is way off), ease in and out, settle on the spot with hysteresis so a nudge doesn't restart a
 * walk. `moveStep` returns the distance covered so the gait can advance with it (planted feet never skate). Pure.
 */
import type { XZ } from '../../world/map.ts';
import type { Gait } from './brain.ts';

export interface Mover {
  x: number;
  z: number;
  yaw: number;
  speed: number;
  path: XZ[];
  pi: number;
  key: string;
  goal: XZ;
  /** standing at the goal (hysteresis: leaves only when displaced by > LEAVE) */
  arrived: boolean;
  /** 0..1 gait weight (smoothed from speed) */
  moving: number;
  /** 0..1 jog blend */
  jog: number;
  /** extra speed multiplier this frame (squeezing past the player) */
  slow: number;
}

export const SPEED: Readonly<Record<Gait, number>> = { walk: 1.4, jog: 3.0, amble: 0.95 };
const ARRIVE = 0.1;
const LEAVE = 0.7;

export const newMover = (x: number, z: number, yaw: number): Mover => ({
  x, z, yaw, speed: 0, path: [], pi: 0, key: '', goal: { x, z }, arrived: true, moving: 0, jog: 0, slow: 1,
});

const wrap = (a: number) => { const r = (((a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return r; };
const damp = (c: number, t: number, rate: number, dt: number) => c + (t - c) * (1 - Math.exp(-rate * dt));

export interface Target { key: string; x: number; z: number; yaw: number; gait: Gait }

/** Snap onto a target (initial load: everyone is already where they belong). */
export function place(m: Mover, t: Target): void {
  m.x = t.x; m.z = t.z; m.yaw = t.yaw; m.key = t.key; m.goal = { x: t.x, z: t.z }; m.path = []; m.pi = 0; m.arrived = true; m.speed = 0; m.moving = 0;
}

/**
 * Advance one frame. `route(from, to)` returns waypoints (not including `from`). Returns the distance moved.
 */
export function moveStep(m: Mover, t: Target, dt: number, route: (from: XZ, to: XZ) => XZ[]): number {
  const gd = Math.hypot(t.x - m.goal.x, t.z - m.goal.z);
  if (t.key !== m.key || gd > 1.0) {
    m.key = t.key;
    m.goal = { x: t.x, z: t.z };
    const dd = Math.hypot(t.x - m.x, t.z - m.z);
    m.path = dd < ARRIVE ? [] : route({ x: m.x, z: m.z }, m.goal);
    m.pi = 0;
    if (dd >= LEAVE) m.arrived = false;
  } else if (gd > 1e-4) {
    // small drift of the same place: slide the last waypoint
    m.goal = { x: t.x, z: t.z };
    if (m.path.length) m.path[m.path.length - 1] = m.goal;
    else if (!m.arrived || Math.hypot(t.x - m.x, t.z - m.z) > 0.25) m.path = [m.goal];
  }
  const fd = Math.hypot(m.goal.x - m.x, m.goal.z - m.z);
  if (m.arrived && fd > LEAVE) { m.arrived = false; m.path = [m.goal]; m.pi = 0; }
  let moved = 0;
  if (!m.arrived && m.path.length) {
    // advance the carrot
    while (m.pi < m.path.length - 1) {
      const p = m.path[m.pi];
      if (Math.hypot(p.x - m.x, p.z - m.z) < 1.3) m.pi++;
      else break;
    }
    const p = m.path[m.pi];
    const last = m.pi === m.path.length - 1;
    const dx = p.x - m.x, dz = p.z - m.z;
    const dist = Math.hypot(dx, dz);
    if (last && dist < ARRIVE) {
      m.arrived = true; m.path = [];
    } else {
      const want = Math.atan2(dx, dz);
      const err = wrap(want - m.yaw);
      m.yaw = wrap(m.yaw + err * (1 - Math.exp(-9 * dt)));
      const turnSlow = Math.max(0, Math.cos(Math.min(Math.PI / 2, Math.abs(err))));
      const remaining = last ? dist : 99;
      const vmax = SPEED[t.gait] * m.slow * Math.min(1, 0.35 + remaining / 1.2);
      m.speed = damp(m.speed, vmax * turnSlow, 6, dt);
      let step = m.speed * dt;
      if (last && step > dist) step = dist;
      // steer toward the waypoint but through the facing, so paths curve
      const fx = Math.sin(m.yaw), fz = Math.cos(m.yaw);
      const bx = dx / (dist || 1), bz = dz / (dist || 1);
      const mx = fx * 0.6 + bx * 0.4, mz = fz * 0.6 + bz * 0.4, ml = Math.hypot(mx, mz) || 1;
      m.x += (mx / ml) * step;
      m.z += (mz / ml) * step;
      moved = step;
    }
  }
  if (m.arrived) {
    m.speed = damp(m.speed, 0, 10, dt);
    m.yaw = wrap(m.yaw + wrap(t.yaw - m.yaw) * (1 - Math.exp(-5 * dt)));
    // settle gently onto the exact spot
    m.x = damp(m.x, m.goal.x, 2, dt);
    m.z = damp(m.z, m.goal.z, 2, dt);
  }
  const jogT = t.gait === 'jog' ? 1 : 0;
  m.jog = damp(m.jog, jogT, 4, dt);
  m.moving = damp(m.moving, Math.min(1, m.speed / 0.6), 10, dt);
  return moved;
}

/**
 * Soft separation between farmers: walkers yield to anyone within `r`; settled farmers barely move. Mutates x/z.
 * `pts` entries: x, z, walking flag.
 */
export function separate(pts: { x: number; z: number; walking: boolean }[], r: number, dt: number): void {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    for (let j = i + 1; j < n; j++) {
      const b = pts[j];
      const dx = b.x - a.x, dz = b.z - a.z;
      if (Math.abs(dx) > r || Math.abs(dz) > r) continue;
      const d = Math.hypot(dx, dz);
      if (d >= r || d < 1e-5) continue;
      const push = (r - d) * Math.min(1, dt * 6);
      const nx = dx / d, nz = dz / d;
      const wa = a.walking ? (b.walking ? 0.5 : 1) : b.walking ? 0 : 0.5;
      const wb = 1 - wa;
      a.x -= nx * push * wa; a.z -= nz * push * wa;
      b.x += nx * push * wb; b.z += nz * push * wb;
    }
  }
}
