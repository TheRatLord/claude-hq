/**
 * Scripted traversal for the M1.5 motion-feel sign-off (`__hq.feelTrace('run')`): drives the real controller through
 * virtual keys and yaw steering (no teleports), so the trace measures exactly what a player feels:
 * spawn → sprint to the Pit → sit on a free sofa (look around) → stand with a hop → jump on the way → stairs (sprint)
 * → mezzanine → ride the slide → walk back to the Lobby. Owner: PLY.
 */
import { clamp, wrapAngle } from '../core/math.ts';
import { pointsOf } from './manager.ts';
import type { Player } from './controller.ts';
import type { HqLayout, Layout, Slot } from '../world/layout/schema.ts';

/** The nav route query the pilot walks. */
export interface PilotNav {
  route?(from: { x: number; z: number; level: number }, to: { x: number; z: number; level: number }, o: { owner: string }): { points: { x: number; z: number }[] } | null;
}
/** The slice of the controller the pilot steers. */
export type PilotBody = Pick<Player, 'yaw' | 'pitch' | 'pos' | 'level' | 'eyeHeight' | 'grounded'>;
export type Pilot = ReturnType<typeof createPilot>;
interface Task { fn: (dt: number, t: number) => boolean; resolve: (v: boolean) => void; reject: (e: unknown) => void; t: number; timeout: number; label: string }

export function createPilot(ctl: { p: PilotBody; vkeys: Set<string>; nav: () => PilotNav | null | undefined }) {
  const { p, vkeys } = ctl;
  let cur: Task | null = null;
  const run = (label: string, fn: Task['fn'], timeout = 30000) => new Promise<boolean>((resolve, reject) => {
    cur?.reject(new Error(`${cur.label}: preempted`));
    cur = { fn, resolve, reject, t: 0, timeout, label };
  });
  /** Turn toward a yaw like a hand on a mouse: exponential, max 7 rad/s. Returns the remaining error. */
  const turnTo = (yaw: number, dt: number, rate = 10) => {
    const err = wrapAngle(yaw - p.yaw);
    p.yaw += clamp(err * (1 - Math.exp(-rate * dt)), -7 * dt, 7 * dt);
    return err;
  };
  const yawTo = (x: number, z: number) => Math.atan2(-(x - p.pos.x), -(z - p.pos.z));
  return {
    tick(dt: number) {
      if (!cur) return;
      const c = cur;
      c.t += dt * 1000;
      let r: boolean;
      try { r = c.fn(dt, c.t); } catch (e) { cur = null; vkeys.clear(); c.reject(e); return; }
      if (r) { if (cur === c) cur = null; vkeys.clear(); c.resolve(r); } else if (c.t > c.timeout) { cur = null; vkeys.clear(); c.reject(new Error(`${c.label}: timeout`)); }
    },
    stop() { if (cur) { const c = cur; cur = null; c.reject(new Error('stopped')); } },
    wait: (ms: number) => run('wait', (dt, t) => t >= ms, ms + 1000),
    until: (label: string, pred: () => unknown, timeout = 5000) => run(label, () => !!pred(), timeout),
    /** Hold a key for ms. */
    press: (code: string, ms = 120) => run(`press ${code}`, (dt, t) => { vkeys.add(code); if (t >= ms) { vkeys.delete(code); return true; } return false; }, ms + 1000),
    /** Ease the view to an absolute yaw/pitch over ms. */
    look(yaw: number, pitch: number, ms = 500) {
      let y0: number | null = null, p0 = 0;
      return run('look', (dt, t) => {
        if (y0 === null) { y0 = p.yaw; p0 = p.pitch; }
        const u = Math.min(1, t / ms), e = u * u * (3 - 2 * u);
        p.yaw = y0 + wrapAngle(yaw - y0) * e; p.pitch = p0 + (pitch - p0) * e;
        return u >= 1;
      }, ms + 1000);
    },
    lookAt(x: number, y: number, z: number, ms = 400) {
      const dx = x - p.pos.x, dz = z - p.pos.z;
      return this.look(Math.atan2(-dx, -dz), Math.atan2(y - (p.pos.y + p.eyeHeight), Math.max(0.3, Math.hypot(dx, dz))), ms);
    },
    /**
     * Walk (or sprint) the nav route to a point on a level. `jumpAt`: press Space once after that many metres.
     */
    goto(to: { x: number; z: number; level?: number }, o: { sprint?: boolean; jumpAt?: number; sprintFrom?: number; tol?: number; timeout?: number } = {}) {
      const nav = ctl.nav();
      const route = nav?.route?.({ x: p.pos.x, z: p.pos.z, level: p.level }, { x: to.x, z: to.z, level: to.level ?? 0 }, { owner: '*' });
      if (!route) return Promise.reject(new Error(`goto ${to.x.toFixed(1)},${to.z.toFixed(1)}: no route`));
      const pts = route.points;
      let i = 1, walked = 0, jumped = false, lx = p.pos.x, lz = p.pos.z;
      const tol = o.tol ?? 0.3;
      return run(`goto ${to.x.toFixed(1)},${to.z.toFixed(1)}`, (dt) => {
        walked += Math.hypot(p.pos.x - lx, p.pos.z - lz); lx = p.pos.x; lz = p.pos.z;
        while (i < pts.length) {
          const last = i === pts.length - 1;
          const d = Math.hypot(pts[i].x - p.pos.x, pts[i].z - p.pos.z);
          if (d < (last ? tol : 0.45)) i++; else break;
        }
        vkeys.delete('KeyW'); vkeys.delete('ShiftLeft'); vkeys.delete('Space');
        if (i >= pts.length) return true;
        const tgt = pts[i];
        const err = turnTo(yawTo(tgt.x, tgt.z), dt);
        let left = Math.hypot(tgt.x - p.pos.x, tgt.z - p.pos.z);
        for (let j = i + 1; j < pts.length; j++) left += Math.hypot(pts[j].x - pts[j - 1].x, pts[j].z - pts[j - 1].z);
        if (Math.abs(err) < 0.9) vkeys.add('KeyW');
        if (o.sprint && left > 2.5 && walked >= (o.sprintFrom ?? 0)) vkeys.add('ShiftLeft');
        if (o.jumpAt != null && walked >= o.jumpAt && (!jumped || !p.grounded)) { vkeys.add('Space'); if (!p.grounded) jumped = true; } // hold → full-height hop
        return false;
      }, o.timeout ?? 25000);
    },
  };
}

export interface Checkpoint { name: string; t: number; pose: number[]; mode: string; level: number; [extra: string]: unknown }

/** The hq layout (the traversal needs its slide, stairs and Pit gaps). */
const isHqLayout = (L: Layout | null): L is HqLayout => !!L?.slide && !!pointsOf(L)?.pitSouthGap;

/** The M1.5 traversal. Returns checkpoints [{name, t, pose, mode, level}]. */
export async function traversal(
  pilot: Pilot,
  ctl: { p: Player; layout: () => Layout | null; nav: () => PilotNav | null | undefined; now: () => number; freeSeat: (tags: string[], near: { x: number; z: number }) => Slot | null },
): Promise<Checkpoint[]> {
  const { p } = ctl;
  const L = ctl.layout();
  if (!isHqLayout(L)) throw new Error(`traversal needs the hq layout (got ${L?.id})`);
  const P = L.points;
  const log: Checkpoint[] = [];
  const mark = (name: string, extra?: Record<string, unknown>) => log.push({ name, t: Math.round(ctl.now()), pose: p.getPose().map((v) => +v.toFixed(2)), mode: p.mode, level: p.level, ...extra });

  p.setPose(...L.spawn);
  await pilot.wait(400);
  mark('spawn');
  // sprint down the main axis toward the Pit (FOV kick), then walk into the south gap
  const gap = P.pitSouthGap;
  await pilot.goto({ x: gap.x, z: gap.z + 0.6, level: 0 }, { sprint: true });
  mark('pitGap');
  const seat = ctl.freeSeat(['sofa'], gap) ?? ctl.freeSeat(['pitStep', 'beanbag', 'sofa'], gap);
  if (!seat) throw new Error('no free Pit seat');
  const ax = seat.pos.x - Math.sin(seat.yaw) * 0.75, az = seat.pos.z - Math.cos(seat.yaw) * 0.75;
  await pilot.goto({ x: ax, z: az, level: 0 }, { tol: 0.2 });
  await pilot.lookAt(seat.pos.x, seat.pos.y + 0.4, seat.pos.z, 350);
  await pilot.wait(150);
  const aimed = p.hint();
  if (aimed?.slotId !== seat.id) throw new Error(`reticle on ${seat.id} but E would sit on ${aimed?.slotId ?? 'nothing'} (hint ${JSON.stringify(aimed)})`);
  if (!p.interact()) throw new Error(`E did not sit (hint ${JSON.stringify(p.hint())})`);
  await pilot.until('sit', () => p.mode === 'sit', 2000);
  if (p.seatId !== seat.id) throw new Error(`targeted ${seat.id} but sat on ${p.seatId}`);
  mark('sit', { seat: seat.id, sat: p.seatId });
  await pilot.wait(600);
  await pilot.look(seat.yaw + 1.3, -0.05, 800);
  await pilot.look(seat.yaw - 1.3, 0.15, 1100);
  await pilot.look(seat.yaw, -0.05, 600);
  await pilot.press('KeyW', 120);
  await pilot.until('stand', () => p.mode === 'walk', 2000);
  mark('stand');
  // out through the north gap, a hop on the atrium floor, then sprint up the stairs
  await pilot.goto({ x: P.stairsFoot.x, z: P.stairsFoot.z, level: 0 }, { jumpAt: 3.0 });
  mark('stairsFoot');
  await pilot.goto({ x: P.stairsTop.x, z: P.stairsTop.z, level: 1 }, { sprint: true, tol: 0.35 });
  mark('mezz');
  const m = L.slide.mouth;
  await pilot.goto({ x: m.x, z: m.z - 0.9, level: 1 }, { sprint: true, tol: 0.25 });
  await pilot.lookAt(m.x, m.y, m.z + 1.5, 350);
  await pilot.wait(150);
  if (!p.interact()) throw new Error(`E did not ride (hint ${JSON.stringify(p.hint())})`);
  await pilot.until('ride', () => p.mode === 'ride', 2000);
  mark('ride');
  await pilot.until('slideExit', () => p.mode === 'walk', 6000);
  mark('slideExit');
  await pilot.wait(700);
  // walk back to the Lobby
  const sp = L.spawn;
  await pilot.goto({ x: sp[0], z: sp[2] - 1.0, level: 0 }, { sprint: true, sprintFrom: 4 });
  await pilot.wait(300);
  mark('lobby');
  return log;
}
