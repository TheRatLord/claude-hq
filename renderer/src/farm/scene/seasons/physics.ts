/**
 * Pure rules for the seasonal pastimes (no three, no DOM; tested in seasons.test.ts): the rowboat's water physics
 * (two oars, keel, drift, soft bumps off the shore, the dock and lily pads), skating (low-friction glide, blade grip,
 * carves, snowbank bumps), the figure-eight detector, when the pond freezes and where the rarer fish bite.
 *
 * Conventions: boat yaw is the model convention (front = (sin yaw, cos yaw)); skating takes the camera yaw (forward =
 * (−sin yaw, −cos yaw)). Every step mutates its state in place and allocates nothing.
 */
import type { Season, WeatherKind } from '../../model/types.ts';
import { POND } from '../../world/map.ts';

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const wrap = (a: number) => { a %= TAU; return a > Math.PI ? a - TAU : a < -Math.PI ? a + TAU : a; };

// ---------------------------------------------------------------------------------------------
// The pond

/** Is the pond frozen (0..1 target)? Every winter, unless a long rain has softened it. */
export function pondIce(season: Season, trace: { wet: number }, weather: WeatherKind): number {
  if (season !== 'winter') return 0;
  return trace.wet > 0.75 && (weather === 'rain' || weather === 'storm') ? 0 : 1;
}
/** Enough lying snow to roll a snowball. */
export const SNOW_ROLL = 0.3;
/** Below this the snow has melted: snowmen go. */
export const SNOW_MELT = 0.12;

/** Rare-fish multiplier for a cast at (x, z): ×1 at the edges, up to ×2.6 out in the middle of the pond. */
export function fishBoost(x: number, z: number): number {
  const d = Math.hypot(x - POND.x, z - POND.z) / POND.r;
  return 1 + 1.6 * clamp(1 - d / 0.6, 0, 1);
}

// ---------------------------------------------------------------------------------------------
// The rowboat

export const BOAT = Object.freeze({ len: 3.1, beam: 1.24, draft: 0.32, oarRate: 0.85, thrust: 1.9 });

export interface BoatState {
  x: number; z: number; yaw: number;
  vx: number; vz: number;
  /** yaw rate, rad/s */
  w: number;
  /** oar stroke phase 0..1 (0–0.5 pull: blade in the water; 0.5–1 recovery) */
  phL: number; phR: number;
  /** 0 shipped oars … 1 rowing (eased; the pose blends with it) */
  active: number;
  /** current drive per oar −1..1 (back-water … pull) */
  driveL: number; driveR: number;
  /** metres moved this outing */
  rowed: number;
  /** strongest impact this step (m/s into the obstacle), 0 if none */
  bump: number;
  /** an oar blade entered the water this step: −1 left, 1 right, 2 both, 0 none */
  dip: number;
}
export const boatState = (x: number, z: number, yaw: number): BoatState =>
  ({ x, z, yaw, vx: 0, vz: 0, w: 0, phL: 0.75, phR: 0.75, active: 0, driveL: 0, driveR: 0, rowed: 0, bump: 0, dip: 0 });

export interface RowInput {
  /** W +1 / S −1 */
  fwd: number;
  /** D +1 (turn right) / A −1 */
  turn: number;
}
export interface Pad { x: number; z: number; r: number }
export interface BoatEnv {
  /** water depth at (x, z), metres; ≤ 0 on land and inside solids (the dock), smooth enough for a gradient */
  depth(x: number, z: number): number;
  /** lily pads: soft, they push the boat aside and slow it */
  pads: readonly Pad[];
  /** wind, m/s (a gentle drift) */
  wind?: { x: number; z: number };
}

/** the pull half of a stroke: force profile over the phase */
export const pull = (ph: number): number => (ph < 0.5 ? Math.sin(ph * TAU) : 0);

/**
 * The oar pose for a stroke phase: sweep (rad, + = blade toward the stern) and lift (0 = blade buried … 1 = high).
 * `active` blends from the shipped rest pose (oars along the gunwales, blades up).
 */
export function oarPose(ph: number, active: number, out: { sweep: number; lift: number }): { sweep: number; lift: number } {
  // pull: the blade sweeps from the bow side to the stern side in the water; recovery: it swings back up and over
  const sweep = -Math.cos(ph * TAU) * 0.62;
  const lift = ph < 0.5 ? 0.05 + 0.08 * Math.abs(Math.cos(ph * TAU)) : 0.25 + 0.55 * Math.sin((ph - 0.5) * TAU);
  out.sweep = sweep * active + 1.42 * (1 - active);
  out.lift = lift * active + 0.75 * (1 - active);
  return out;
}

const PTS: readonly (readonly [number, number])[] = [[0, 0.47], [0, -0.45], [0.48, 0], [-0.48, 0], [0.32, 0.3], [-0.32, 0.3], [0.32, -0.3], [-0.32, -0.3]];

/** One step of the boat (mutates `s`). */
export function stepBoat(s: BoatState, inp: RowInput, dt: number, env: BoatEnv): void {
  s.bump = 0; s.dip = 0;
  const fwd = clamp(inp.fwd, -1, 1), turn = clamp(inp.turn, -1, 1);
  // a right turn pulls the left oar and backs the right one (and a spin in place is all differential)
  const dl = clamp(fwd + turn * (fwd >= 0 ? 1 : -1), -1, 1), dr = clamp(fwd - turn * (fwd >= 0 ? 1 : -1), -1, 1);
  s.driveL += (dl - s.driveL) * Math.min(1, dt * 6);
  s.driveR += (dr - s.driveR) * Math.min(1, dt * 6);
  const rowing = Math.abs(dl) > 0.05 || Math.abs(dr) > 0.05;
  s.active = clamp(s.active + (rowing ? dt * 2.2 : -dt * 0.8), 0, 1);
  // strokes: phases advance while rowing; at rest they ease to the top of the recovery
  const adv = (ph: number, drive: number, side: number): number => {
    let p = ph;
    if (rowing && Math.abs(drive) > 0.05) {
      const n = p + dt * BOAT.oarRate * (0.65 + 0.35 * Math.abs(drive));
      if (p >= 0.5 && n >= 1) s.dip = s.dip ? 2 : side;
      p = n % 1;
    } else if (!rowing) {
      p += wrap((0.75 - p) * TAU) / TAU * Math.min(1, dt * 2);
      p = ((p % 1) + 1) % 1;
    }
    return p;
  };
  s.phL = adv(s.phL, s.driveL, -1);
  s.phR = adv(s.phR, s.driveR, 1);
  const k = s.active;
  const FL = BOAT.thrust * s.driveL * pull(s.phL) * k, FR = BOAT.thrust * s.driveR * pull(s.phR) * k;
  const sy = Math.sin(s.yaw), cy = Math.cos(s.yaw);
  // thrust along the keel; the difference turns her (left oar harder → turn right → yaw decreases)
  s.vx += sy * (FL + FR) * dt;
  s.vz += cy * (FL + FR) * dt;
  s.w += -(FL - FR) * 0.75 * dt;
  // water: little drag along the keel, a lot across it; turning is damped
  let va = s.vx * sy + s.vz * cy, vs = s.vx * -cy + s.vz * sy;
  va -= (0.32 * va + 0.11 * va * Math.abs(va)) * dt;
  vs *= Math.exp(-2.6 * dt);
  s.vx = sy * va - cy * vs;
  s.vz = cy * va + sy * vs;
  s.w *= Math.exp(-1.7 * dt);
  if (env.wind) { s.vx += env.wind.x * 0.018 * dt; s.vz += env.wind.z * 0.018 * dt; }
  // move
  const ox = s.x, oz = s.z;
  s.x += s.vx * dt; s.z += s.vz * dt; s.yaw = wrap(s.yaw + s.w * dt);
  // lily pads: soft, they part around the hull
  for (const p of env.pads) {
    const dx = s.x - p.x, dz = s.z - p.z, d = Math.hypot(dx, dz), m = p.r + BOAT.beam * 0.45;
    if (d >= m || d < 1e-4) continue;
    const o = m - d;
    s.vx += (dx / d) * o * 2.4 * dt; s.vz += (dz / d) * o * 2.4 * dt;
    const drag = Math.exp(-0.9 * dt);
    s.vx *= drag; s.vz *= drag;
  }
  // the shore and the dock: sample the hull outline, push out along the depth gradient, bounce softly
  for (let it = 0; it < 3; it++) {
    const sy2 = Math.sin(s.yaw), cy2 = Math.cos(s.yaw);
    let worst = 0, wx = 0, wz = 0, wlx = 0, wlz = 0;
    for (const [lx, lzk] of PTS) {
      const lz = lzk * BOAT.len, lxx = lx * BOAT.beam;
      // local (x, z) → world: x cos + z sin, −x sin + z cos
      const px = s.x + lxx * cy2 + lz * sy2, pz = s.z - lxx * sy2 + lz * cy2;
      const short = BOAT.draft - env.depth(px, pz);
      if (short > worst) { worst = short; wx = px; wz = pz; wlx = px - s.x; wlz = pz - s.z; }
    }
    if (worst <= 0) break;
    const e = 0.25;
    let nx = env.depth(wx + e, wz) - env.depth(wx - e, wz), nz = env.depth(wx, wz + e) - env.depth(wx, wz - e);
    let nl = Math.hypot(nx, nz);
    if (nl < 1e-5) { nx = ox - s.x; nz = oz - s.z; nl = Math.hypot(nx, nz); if (nl < 1e-5) { nx = POND.x - s.x; nz = POND.z - s.z; nl = Math.hypot(nx, nz) || 1; } }
    nx /= nl; nz /= nl;
    const push = Math.min(0.25, worst * 0.8 + 0.01);
    s.x += nx * push; s.z += nz * push;
    // velocity of the contact point (linear + yaw), and a soft restitution
    const pvx = s.vx + s.w * wlz, pvz = s.vz - s.w * wlx;
    const vn = pvx * nx + pvz * nz;
    if (vn < 0) {
      const j = -(1 + 0.3) * vn;
      s.vx += nx * j * 0.8; s.vz += nz * j * 0.8;
      s.w += (nx * j * wlz - nz * j * wlx) * 0.25;
      s.vx *= 0.92; s.vz *= 0.92;
      s.bump = Math.max(s.bump, -vn);
    }
  }
  s.rowed += Math.hypot(s.x - ox, s.z - oz);
}

// ---------------------------------------------------------------------------------------------
// Skating

export const SKATE = Object.freeze({ push: 4.0, pushSprint: 5.4, vmax: 6.2, vmaxSprint: 8.4, carve: 1.7, stride: 1.25 });

export interface SkateState {
  x: number; z: number; vx: number; vz: number;
  /** stride phase 0..1 while pushing */
  stride: number;
  /** a push started this step (sound, bob) */
  kick: boolean;
  /** yaw change this step (A / D carve the body round: add to the camera yaw) */
  dyaw: number;
  /** signed turn rate of the glide direction, rad/s (camera lean, scratch sound) */
  carve: number;
  /** strongest snowbank bump this step (m/s) */
  bump: number;
  /** braking (snowplough) */
  brake: boolean;
}
export const skateState = (x: number, z: number): SkateState => ({ x, z, vx: 0, vz: 0, stride: 0, kick: false, dyaw: 0, carve: 0, bump: 0, brake: false });

export interface SkateInput { fwd: number; side: number; sprint: boolean; /** camera yaw (forward = (−sin, −cos)) */ yaw: number }
export interface SkateEnv {
  /** is (x, z) on the ice? */
  onIce(x: number, z: number): boolean;
  /** lying snow 0..1 on the ice (a little more friction) */
  snow: number;
  /** the middle of the ice (snowbanks bounce you back toward it) */
  center: { x: number; z: number };
}

/**
 * One step of skating (mutates `s`). Returns 'ice' (still gliding), 'off' (stepped off onto the shore: (x, z) is the
 * first point off the ice) or 'bump' (bounced off the snowbank at the edge).
 */
export function stepSkate(s: SkateState, inp: SkateInput, dt: number, env: SkateEnv): 'ice' | 'off' | 'bump' {
  s.kick = false; s.bump = 0;
  const fwd = clamp(inp.fwd, -1, 1), side = clamp(inp.side, -1, 1);
  const vmax = inp.sprint ? SKATE.vmaxSprint : SKATE.vmax;
  const prevA = Math.atan2(s.vz, s.vx), prevSp = Math.hypot(s.vx, s.vz);
  // A / D carve: the body (and the view) turns, faster the faster you go (a skater leans into it)
  const sp0 = prevSp;
  s.dyaw = -side * SKATE.carve * clamp(0.35 + sp0 / 3, 0.35, 1.2) * dt;
  const yaw = inp.yaw + s.dyaw;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  // push strides along the facing direction
  if (fwd > 0) {
    const was = s.stride;
    s.stride = (s.stride + dt * SKATE.stride * (inp.sprint ? 1.3 : 1)) % 1;
    if (s.stride < was || was === 0) s.kick = true;
    const pulse = 0.35 + 0.65 * Math.max(0, Math.sin(s.stride * TAU));
    const room = clamp(1 - sp0 / vmax, 0, 1);
    const a = (inp.sprint ? SKATE.pushSprint : SKATE.push) * fwd * pulse * room;
    s.vx += fx * a * dt; s.vz += fz * a * dt;
  } else s.stride = 0;
  s.brake = fwd < 0;
  if (fwd < 0) {
    const k = Math.exp(-2.4 * dt);
    s.vx *= k; s.vz *= k;
    if (sp0 < 0.6) { s.vx -= fx * 0.9 * dt; s.vz -= fz * 0.9 * dt; } // a little backward shuffle
  }
  // slow: A / D also shuffle sideways a touch
  if (side && sp0 < 1.2) { s.vx += rx * side * 0.9 * dt; s.vz += rz * side * 0.9 * dt; }
  // the blades grip across their length: sideways slide bleeds off, most of it turned into glide (carving)
  const va = s.vx * fx + s.vz * fz, vs = s.vx * rx + s.vz * rz;
  const keep = Math.exp(-2.4 * dt);
  const lost = Math.abs(vs) * (1 - keep);
  const va2 = va + Math.sign(va || 1) * lost * 0.75;
  const vs2 = vs * keep;
  s.vx = fx * va2 + rx * vs2;
  s.vz = fz * va2 + rz * vs2;
  // ice: almost no friction (a dusting of snow slows you a little)
  const fr = Math.exp(-(0.07 + env.snow * 0.18) * dt);
  s.vx *= fr; s.vz *= fr;
  const sp = Math.hypot(s.vx, s.vz);
  s.carve = sp > 0.4 && prevSp > 0.4 ? wrap(Math.atan2(s.vz, s.vx) - prevA) / Math.max(dt, 1e-4) : 0;
  const nx = s.x + s.vx * dt, nz = s.z + s.vz * dt;
  if (env.onIce(nx, nz)) { s.x = nx; s.z = nz; return 'ice'; }
  // the edge: walk off when slow and heading out, else bounce off the snowbank
  let ix = env.center.x - s.x, iz = env.center.z - s.z;
  const il = Math.hypot(ix, iz) || 1;
  ix /= il; iz /= il;
  const vn = s.vx * ix + s.vz * iz;
  if (sp < 2.4) { s.x = nx; s.z = nz; return 'off'; }
  if (vn < 0) { s.vx -= 1.4 * vn * ix; s.vz -= 1.4 * vn * iz; }
  s.vx *= 0.7; s.vz *= 0.7;
  s.bump = Math.max(0, -vn);
  return 'bump';
}

// ---------------------------------------------------------------------------------------------
// Figure eights

/** Accumulates how far the glide direction has turned: a lobe one way then a lobe the other is a figure eight. */
export interface Loops {
  /** signed turning of the current lobe (rad) */
  cur: number;
  /** turning against it since (rad) */
  rev: number;
  prev: number | null;
  /** the lobe before this one: sign, when it ended (s), and whether it was a full lobe */
  last: { sign: number; t: number; big: boolean } | null;
  t: number;
}
export const loops = (): Loops => ({ cur: 0, rev: 0, prev: null, last: null, t: 0 });
/** a lobe counts once it has turned this far (a figure eight's lobe is a bit less than a full circle) */
export const LOBE = Math.PI * 1.4;

/** Feed one step of glide velocity; true when a figure eight completes. */
export function trackLoops(l: Loops, vx: number, vz: number, dt: number): boolean {
  l.t += dt;
  const sp = Math.hypot(vx, vz);
  if (sp < 0.9) { l.prev = null; l.cur *= Math.exp(-0.8 * dt); l.rev = 0; return false; }
  const a = Math.atan2(vz, vx);
  if (l.prev === null) { l.prev = a; return false; }
  const d = wrap(a - l.prev);
  l.prev = a;
  if (l.cur === 0 || Math.sign(d) === Math.sign(l.cur)) {
    l.cur += d;
    l.rev = Math.max(0, l.rev - Math.abs(d));
    // circling round and round is not an eight: keep the lobe from growing without bound
    if (Math.abs(l.cur) > TAU * 1.3) l.cur -= Math.sign(l.cur) * TAU;
  } else {
    l.rev += Math.abs(d);
    if (l.rev > Math.PI * 0.3) {
      // the turn reversed: this lobe is done
      l.last = { sign: Math.sign(l.cur), t: l.t, big: Math.abs(l.cur) >= LOBE };
      l.cur = -Math.sign(l.cur) * l.rev;
      l.rev = 0;
    }
  }
  if (l.last && l.last.big && Math.abs(l.cur) >= LOBE && Math.sign(l.cur) === -l.last.sign && l.t - l.last.t < 25) {
    l.last = null; l.cur = 0; l.rev = 0;
    return true;
  }
  return false;
}
