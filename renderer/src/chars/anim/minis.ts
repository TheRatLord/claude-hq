/**
 * Mini-Clawd driver (ART §5.7, DESIGN §6.7 "Mini-Clawds = active subagents, max 4"). The minis are sub-rigs of the
 * parent (rig/mini.ts); this module gives each one a tiny life in the parent's root frame, anchored in the WORLD (the
 * parent's own motion is subtracted), so they:
 *   - pop in out of a poof (easeOutBack grow + hop) when a subagent starts, and squash-pop away when it ends;
 *   - [CHR fix m15-r2] at rest stand in a fixed fan (`restSlots`): an arc behind the parent's chair at 0.42 m spacing,
 *     0.85 m from the parent's centre (never beside it, where the pod neighbours sit), facing out so their faces read
 *     from the aisle, and do little jobs in place (type in the air, hop, wave, carry a paper overhead); a soft
 *     separation keeps them from walking through each other on the way to their slots;
 *   - fall in behind the parent in a duckling line when it walks, hopping to keep up;
 *   - [CHR fix m15-r1] stand on the real floor under each of them (the `ground(x, z)` the actor passes: Pit rings,
 *     dais, stairs), never squash below 0.6 height, and stay on a leash: beyond LEASH m from the parent they switch to
 *     a bounding catch-up hop, beyond SNAP m (a teleport, a slide ride) they poof back to the leash.
 * Squeaky-short high-energy gait (energy 1.4). Deterministic per parent seed. Owner: CHR.
 */
import { mulberry32 } from '../../../../shared/identity.ts';
import { easeOutBack } from './easing.ts';
import type { ClawdRig } from '../rig/clawd.ts';
import type { MiniRig } from '../rig/mini.ts';

const TAU = Math.PI * 2;
const FOLLOW_GAP = 0.28; // the 4th mini sits inside the leash
/** [CHR fix m15-r2] Rest fan: radius from the parent's centre, angular step (chord ≈ 0.42 m), minimum separation. */
export const FAN_R = 0.85, FAN_STEP = 0.5, MIN_SEP = 0.36;

/**
 * Rest formation for `n` minis in the parent's root frame (+z = the parent's front, where the desk is): an arc
 * centred behind the parent, slot k at angle (k − (n−1)/2)·FAN_STEP from straight behind.
 */
export function restSlots(n: number): { x: number; z: number; yaw: number }[] {
  const out: { x: number; z: number; yaw: number }[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k - (n - 1) / 2) * FAN_STEP;
    // face out and a bit toward the parent's facing, so both the aisle and a 3/4 view see the faces
    out.push({ x: Math.sin(a) * FAN_R, z: -Math.cos(a) * FAN_R, yaw: Math.atan2(Math.sin(a) * 1.4, -Math.cos(a) + 0.9) });
  }
  return out;
}
/** [CHR m2 r2 alloc] restSlots(n) memoised (read-only): toSlot() runs per mini per frame. */
type Slot = Readonly<{ x: number; z: number; yaw: number }>;
const SLOTS: (readonly Slot[])[] = [];
const slotsFor = (n: number): readonly Slot[] => SLOTS[n] ??= Object.freeze(restSlots(n).map((o) => Object.freeze(o)));
export const LEASH = 1.5, SNAP = 3;
/** Mini squash never flattens below this height (volume-preserving, so they never read as pancakes). */
export const MIN_SQ = 0.6;

/** One mini's simulation state (parent root frame). */
interface MiniState {
  m: MiniRig;
  i: number;
  on: boolean;
  grow: number;
  catchUp: boolean;
  gy: number;
  x: number;
  z: number;
  yaw: number;
  tx: number;
  tz: number;
  speed: number;
  wait: number;
  job: number;
  jobT: number;
  gait: number;
  t: number;
  blinkT: number;
  restYaw: number;
}

/** What the parent tells the minis each frame. */
export interface MiniUpdate { count: number; moving: boolean; seated: boolean; t: number; reduced: boolean }

export interface MiniDriver { update(dt: number, o: MiniUpdate): void }

/**
 * @param rig parent Clawd rig (rig.minis from rig/mini.ts)
 * @param ground world floor height under a point (null = the parent's floor)
 */
export function createMinis(rig: ClawdRig, seed: number, ground: ((x: number, z: number) => number) | null = null): MiniDriver {
  const rnd = mulberry32((seed * 2654435761) >>> 0);
  const S: MiniState[] = rig.minis.map((m, i): MiniState => ({
    m, i, on: false, grow: 0, catchUp: false, gy: 0, x: 0, z: 0, yaw: 0, tx: 0, tz: 0, speed: 0, wait: 0, job: 0, jobT: 0, gait: rnd(), t: rnd() * 10,
    blinkT: 1 + rnd() * 3, restYaw: 0,
  }));
  // [CHR m2 r2 alloc] parent pose last frame as fixed double fields (closure lets re-box on every store)
  const P = { have: false, x: 0, z: 0, yaw: 0, dt: 0 };

  /** Target = this mini's fan slot for the current count (slots re-fan when a subagent starts or ends). */
  const toSlot = (s: MiniState, n: number) => {
    const sl = slotsFor(Math.max(n, s.i + 1))[s.i];
    s.tx = sl.x; s.tz = sl.z; s.restYaw = sl.yaw;
  };

  return {
    update(dt, o) {
      const root = rig.root;
      // World-anchor: undo the parent's own translation + turn since last frame (in its local frame).
      let dx = 0, dz = 0, dyaw = 0;
      if (P.have) {
        const wx = root.position.x - P.x, wz = root.position.z - P.z;
        if (wx * wx + wz * wz < 1) {
          const c = Math.cos(root.rotation.y), s = Math.sin(root.rotation.y);
          dx = wx * c - wz * s; dz = wx * s + wz * c;
          dyaw = root.rotation.y - P.yaw;
          dyaw = ((dyaw + Math.PI) % TAU + TAU) % TAU - Math.PI;
        }
      }
      P.have = true; P.x = root.position.x; P.z = root.position.z; P.yaw = root.rotation.y;
      for (let si = 0; si < S.length; si++) {
        const s = S[si];
        const want = s.i < o.count;
        if (want && !s.on) {
          // poof in right at its fan slot (never out of the parent's body)
          s.on = true; s.grow = 0.001; toSlot(s, o.count); s.x = s.tx; s.z = s.tz; s.yaw = s.restYaw;
          s.wait = 0.4; s.job = 2;
        } else if (!want && s.on && s.grow >= 1) s.on = false;
        // grow: in with an overshoot, out with a squash-pop
        if (s.on) s.grow = Math.min(1, s.grow + dt / 0.4);
        else s.grow = Math.max(0, s.grow - dt / 0.3);
        const m = s.m;
        m.root.visible = s.grow > 0;
        if (!m.root.visible) continue;
        s.t += dt;
        // world anchoring
        if (dyaw) { const c = Math.cos(dyaw), sn = Math.sin(dyaw); const x = s.x * c - s.z * sn; s.z = s.x * sn + s.z * c; s.x = x; s.yaw -= dyaw; }
        s.x -= dx; s.z -= dz;
        // leash: stranded minis poof back beside the parent; far ones bound after it
        let dp = Math.sqrt(s.x * s.x + s.z * s.z);
        if (dp > SNAP) { const k = LEASH / dp; s.x *= k; s.z *= k; dp = LEASH; s.grow = Math.min(s.grow, 0.35); }
        s.catchUp = dp > LEASH || (s.catchUp && dp > 0.9);
        // behaviour target
        // [CHR fix m15-r2] a catch-up bounds toward the line (walking) or the fan (stopped): targeting the line while
        // stopped parked the 4th mini, whose line spot is past the 0.9 m hysteresis, in catch-up for good.
        const run = s.catchUp ? 5 : o.moving ? 3.2 : 0.9;
        if (o.moving) {
          s.tx = (s.i % 2 ? 0.14 : -0.14); s.tz = -0.6 - FOLLOW_GAP * s.i; s.wait = 0;
        } else {
          toSlot(s, o.count);
          if (s.wait > 0) s.wait -= dt;
        }
        let ddx = s.tx - s.x, ddz = s.tz - s.z;
        const d = Math.sqrt(ddx * ddx + ddz * ddz);
        let tspeed = 0;
        if (d > 0.015) {
          tspeed = Math.min(run, d * (o.moving ? 5 : 3) + 0.25);
          ddx /= d; ddz /= d;
          // steer around the parent's body box
          const px = s.x + ddx * 0.2, pz = s.z + ddz * 0.2;
          if (Math.abs(px) < 0.48 && Math.abs(pz) < 0.4) { const side = s.x >= 0 ? 1 : -1; ddx = side; ddz = 0.3 * Math.sign(ddz || 1); }
          // [CHR fix m15-r2] ...and around the other minis: sidestep a sibling in the way (the one farther from the
          // parent passes behind), so a late arrival never deadlocks against a resting sibling.
          for (let bi = 0; bi < S.length; bi++) {
            const b = S[bi];
            if (b === s || !b.on) continue;
            const bx = b.x - s.x, bz = b.z - s.z, along = bx * ddx + bz * ddz;
            if (along <= 0 || along > Math.min(d, 0.6)) continue;
            const perp = bx * ddz - bz * ddx; // > 0: b is on our left-hand side of the path
            if (Math.abs(perp) > MIN_SEP + 0.04) continue;
            const out = s.x * s.x + s.z * s.z >= b.x * b.x + b.z * b.z ? 1 : -1; // pass on the outside of the fan
            let sx = -ddz, sz = ddx; // lateral (right-hand side of the path)
            if ((s.x * sx + s.z * sz) * out < 0) { sx = -sx; sz = -sz; }
            ddx += sx * 1.2; ddz += sz * 1.2;
            const k = Math.sqrt(ddx * ddx + ddz * ddz); ddx /= k; ddz /= k;
            break;
          }
        } else if (!o.moving && s.wait <= 0) {
          s.wait = 1.2 + rnd() * 2; s.job = Math.floor(rnd() * 4); s.jobT = 0;
        }
        s.speed += (tspeed - s.speed) * Math.min(1, dt * 8);
        s.x += ddx * s.speed * dt; s.z += ddz * s.speed * dt;
        // body box push-out
        if (Math.abs(s.x) < 0.46 && Math.abs(s.z) < 0.36) s.x = (s.x >= 0 ? 1 : -1) * 0.46;
        const wantYaw = s.speed > 0.1 ? Math.atan2(ddx, ddz) : o.moving ? 0 : s.job === 2 ? Math.atan2(-s.x, -s.z) : s.restYaw; // wave at the parent
        let dy = wantYaw - s.yaw; dy = ((dy + Math.PI) % TAU + TAU) % TAU - Math.PI;
        s.yaw += dy * Math.min(1, dt * 10);
      }
      // [CHR fix m15-r2] soft separation: minis never walk through each other (their slots are MIN_SEP+ apart already)
      for (let ai = 0; ai < S.length; ai++) for (let bi = 0; bi < S.length; bi++) {
        const a = S[ai], b = S[bi];
        if (b.i <= a.i || !a.on || !b.on) continue;
        const ex = b.x - a.x, ez = b.z - a.z, d = Math.sqrt(ex * ex + ez * ez);
        if (d >= MIN_SEP) continue;
        // a mini resting at its slot holds its ground; the one still walking gives way
        const rax = a.tx - a.x, raz = a.tz - a.z, rbx = b.tx - b.x, rbz = b.tz - b.z;
        const restA = rax * rax + raz * raz < 0.03 * 0.03, restB = rbx * rbx + rbz * rbz < 0.03 * 0.03;
        const wa = restA && !restB ? 0 : restB && !restA ? 1 : 0.5;
        const push = Math.min(MIN_SEP - d, dt * 1.5) / Math.max(d, 1e-3);
        const px = d > 1e-3 ? ex : (b.i % 2 ? 1 : -1), pz = d > 1e-3 ? ez : 0;
        a.x -= px * push * wa; a.z -= pz * push * wa; b.x += px * push * (1 - wa); b.z += pz * push * (1 - wa);
      }
      const c = Math.cos(root.rotation.y), sn = Math.sin(root.rotation.y);
      P.dt = dt;
      for (let si = 0; si < S.length; si++) {
        const s = S[si];
        if (!s.m.root.visible) continue;
        // floor under this mini (after the separation push), in the parent's root frame
        if (ground) {
          const gy = ground(root.position.x + s.x * c + s.z * sn, root.position.z - s.x * sn + s.z * c) - root.position.y;
          s.gy = Math.max(-1.5, Math.min(1.5, gy));
        }
        writeMini(s, P, o);
      }
    },
  };
}

/** @param P (dt via an object: a double argument is boxed per call) */
function writeMini(s: MiniState, P: { dt: number }, o: MiniUpdate): void {
  const dt = P.dt;
  const m = s.m;
  const g = s.grow;
  const pop = s.on ? easeOutBack(Math.min(1, g)) : g * g;
  m.root.position.set(s.x, s.gy, s.z);
  m.root.rotation.y = s.yaw;
  const k = 0.45 * Math.max(0.001, pop);
  m.root.scale.setScalar(k);
  const walk = Math.min(1, s.speed / 0.3);
  s.gait += dt * (3.2 + s.speed * 2.2);
  const ph = s.gait * TAU;
  const bound = s.catchUp ? 2.2 : 1; // catch-up: big eager bounds
  let hipY = Math.abs(Math.sin(ph)) * 0.09 * walk * bound, sq = (-0.5 + Math.abs(Math.sin(ph))) * 0.14 * walk, pitch = 0.18 * walk;
  let aL = 1.15 + Math.sin(ph) * 0.7 * walk, aR = 1.15 - Math.sin(ph) * 0.7 * walk, aP = 0;
  if (walk < 0.2 && !o.moving) {
    // a little job while standing: 0 type-in-the-air, 1 hop, 2 wave, 3 paper overhead
    s.jobT += dt;
    const jt = s.jobT;
    if (s.job === 0) { aL = 1.4 + 0.25 * Math.sin(jt * 30); aR = 1.4 + 0.25 * Math.sin(jt * 30 + 2); aP = 1.1; pitch = 0.15; }
    else if (s.job === 1) { const u = (jt % 0.6) / 0.6; hipY = 0.22 * 4 * u * (1 - u); sq = u < 0.1 ? -0.2 : 0.12 * (1 - u); aL = aR = 1.15 + 0.8 * Math.sin(u * Math.PI); }
    else if (s.job === 2) { aR = 2.7 + 0.3 * Math.sin(jt * 16); aL = 1.1; }
    else { aL = aR = 2.9; hipY = 0.02 * Math.abs(Math.sin(jt * 8)); }
  }
  if (!s.on) sq = -0.3 * (1 - g); // squash before popping away
  if (o.reduced) { hipY *= 0.5; sq *= 0.5; }
  m.hips.position.y = 0.16 + hipY;
  m.hips.rotation.set(pitch, 0, 0.1 * Math.sin(ph) * walk);
  const sy = Math.max(MIN_SQ, 1 + sq);
  m.squash.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
  m.arms[0].rotation.set(-aP, 0, -aL);
  m.arms[1].rotation.set(-aP, 0, aR);
  for (let i = 0; i < 4; i++) {
    const lp = ph + (i === 0 || i === 3 ? 0 : Math.PI);
    m.legs[i].rotation.x = -Math.cos(lp) * 0.7 * walk;
    m.legs[i].position.y = 0.02 + Math.max(0, Math.sin(lp)) * 0.07 * walk;
  }
  // blink
  s.blinkT -= dt;
  const closed = s.blinkT < 0.12;
  if (s.blinkT < 0) s.blinkT = 1.5 + ((s.i * 0.37 + s.t) % 1) * 2.5;
  for (let i = 0; i < m.eyes.length; i++) m.eyes[i].scale.y = closed ? 0.15 : 1.15;
  for (let i = 0; i < m.glints.length; i++) m.glints[i].visible = !closed;
  m.sprout.rotation.z = 0.25 * Math.sin(ph * 0.5) * walk + 0.1 * Math.sin(s.t * 3);
}
