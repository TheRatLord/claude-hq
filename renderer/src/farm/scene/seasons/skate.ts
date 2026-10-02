/**
 * Ice skating (winter, while the pond is frozen: physics.ts `pondIce`): walk out onto the ice and you're gliding
 * (physics.ts `stepSkate`: push strides with W, carve with A / D, snowplough with S, very little friction, blade grip
 * turns sideways slide into glide, bumps off the snowbanks at the edge; slow down at the edge to step off). Blades
 * hiss on each push and carve ('skate' sfx), the view leans into turns, and your blades scratch the ice (ice.ts
 * scratch map). A loop one way and a loop the other is a figure eight (`trackLoops`): the "Figure eight" stamp.
 *
 * No draws of its own (the ice is ice.ts).
 */
import type { RideInput, RideOut, Rider } from '../../player/controller.ts';
import { POND, WORLD } from '../../world/map.ts';
import { loops, skateState, stepSkate, trackLoops } from './physics.ts';
import type { SkateEnv } from './physics.ts';
import type { Ice } from './ice.ts';
import { onIce } from './ice.ts';
import type { Pastime, Shared } from './shared.ts';

export function createSkate(sh: Shared, ice: Ice): Pastime {
  const { ctx } = sh;
  const p = ctx.player;
  const st = skateState(0, 0);
  const lp = loops();
  const env: SkateEnv = { onIce, snow: 0, center: { x: POND.x, z: POND.z } };
  let on = false, hinted = false, t = 0, carveIn = 0, brakeIn = 0, bob = 0, roll = 0, eights = 0, leftAt = -1;
  let lastX = 0, lastZ = 0, side = 1;
  const inp = { fwd: 0, side: 0, sprint: false, yaw: 0 };
  let dev: { fwd: number; side: number; until: number; plan: 'eight' | null; k: number } | null = null;

  const rider: Rider = {
    ride(dt: number, input: RideInput, out: RideOut): boolean {
      if (sh.ice() < 0.5 || sh.indoors()) { on = false; return false; }
      inp.fwd = input.fwd; inp.side = input.side; inp.sprint = input.sprint; inp.yaw = p.yaw;
      if (dev) {
        if (t > dev.until) dev = null;
        else if (dev.plan === 'eight') {
          // dev: skate a figure eight (two lobes, ~5.5 s each), pushing to keep the speed up
          const sp = Math.hypot(st.vx, st.vz);
          inp.fwd = sp < 3.2 ? 1 : 0; inp.sprint = false;
          inp.side = t - dev.k < 5.6 ? 0.6 : -0.6;
        } else { inp.fwd = dev.fwd; inp.side = dev.side; }
      }
      env.snow = ctx.valley.sky.trace.snow;
      const res = stepSkate(st, inp, dt, env);
      p.yaw += st.dyaw;
      const sp = Math.hypot(st.vx, st.vz);
      p.pos.set(st.x, WORLD.water + 0.03, st.z);
      p.speed = sp;
      // the body: a dip on each push, leaning into carves
      if (inp.fwd > 0) bob = Math.sin(st.stride * Math.PI * 2) * 0.035; else bob *= Math.exp(-6 * dt);
      roll += (Math.max(-0.11, Math.min(0.11, -st.carve * 0.05)) - roll) * Math.min(1, dt * 5);
      out.eye = 1.6 + bob - (st.brake ? 0.06 : 0);
      out.roll = roll;
      // sounds: a hiss on each push, a crisp scrape in a hard carve, a spray of ice when you stop
      if (st.kick) { side = -side; sh.sfx('skate', p.pos, 0.45 + Math.min(0.4, sp * 0.06), 0.9 + Math.random() * 0.2); }
      carveIn -= dt; brakeIn -= dt;
      if (Math.abs(st.carve) > 0.55 && sp > 2 && carveIn <= 0) { carveIn = 0.3; sh.sfx('skate', p.pos, 0.3, 1.25 + Math.random() * 0.1); }
      if (st.brake && sp > 1.2 && brakeIn <= 0) { brakeIn = 0.22; sh.sfx('skate', p.pos, 0.4, 0.7); }
      if (res === 'bump') sh.sfx('crunch', p.pos, Math.min(1, 0.4 + st.bump * 0.2), 0.8);
      // scratches: the blades write on the ice
      if (sp > 0.35) {
        const rx = Math.cos(p.yaw) * 0.12 * side, rz = -Math.sin(p.yaw) * 0.12 * side;
        ice.scratch(lastX + rx, lastZ + rz, st.x + rx, st.z + rz, Math.min(1, 0.3 + Math.abs(st.carve) * 0.4 + (st.brake ? 0.5 : 0)));
      }
      lastX = st.x; lastZ = st.z;
      if (trackLoops(lp, st.vx, st.vz, dt)) {
        eights++;
        sh.stamp('eight');
        sh.sfx('sparkle', p.pos, 0.7);
        sh.say(eights === 1 ? 'A figure eight! Look back: the ice has kept your drawing.' : 'Another figure eight. Very elegant.', 4000, 'Skating');
      }
      if (res === 'off') { out.vx = st.vx * 0.4; out.vz = st.vz * 0.4; on = false; leftAt = t; return false; }
      out.vx = 0; out.vz = 0;
      return true;
    },
  };

  function start(): void {
    const c = sh.controller();
    if (!c) return;
    st.x = p.pos.x; st.z = p.pos.z;
    // carry the walking speed onto the ice
    st.vx = -Math.sin(p.yaw) * p.speed * 0.8; st.vz = -Math.cos(p.yaw) * p.speed * 0.8;
    st.stride = 0;
    lastX = st.x; lastZ = st.z;
    lp.prev = null; lp.cur = 0; lp.rev = 0; lp.last = null;
    on = true;
    c.ride(rider, () => { on = false; dev = null; });
    sh.sfx('crunch', p.pos, 0.5, 1.3);
    if (!hinted) { hinted = true; sh.say('Out on the ice! W to push off, A / D to carve, S to snowplough to a stop. Slow down at the edge to step off.', 6500, 'Skating'); }
  }

  return {
    update(f) {
      t = f.time;
      const c = sh.controller();
      if (on || !c || c.riding || c.flying || p.frozen || sh.ice() < 0.98 || sh.indoors()) return;
      // stepping onto the ice from the shore (not straight back on just after stepping off: a short grace)
      if (onIce(p.pos.x, p.pos.z) && t - leftAt > 0.3) start();
    },
    dev(cmd, a) {
      const c = sh.controller();
      if (cmd === 'on' || cmd === 'eight' || cmd === 'glide') {
        if (sh.ice() < 0.98) return 'the pond is not frozen (season=winter)';
        if (!on) { c?.teleport(POND.x - 2, POND.z + 3, 0.4, -0.08); start(); }
        if (cmd === 'eight') { st.x = POND.x; st.z = POND.z + 0.5; lastX = st.x; lastZ = st.z; st.vx = -Math.sin(p.yaw) * 3; st.vz = -Math.cos(p.yaw) * 3; dev = { fwd: 0, side: 0, until: t + 12, plan: 'eight', k: t }; }
        if (cmd === 'glide') dev = { fwd: 1, side: 0, until: t + (typeof a === 'number' ? a : 2), plan: null, k: t };
      } else if (cmd === 'off' && on) { c?.ride(null); c?.teleport(POND.x, POND.z + POND.r + 3); }
      return { on, x: +st.x.toFixed(2), z: +st.z.toFixed(2), speed: +Math.hypot(st.vx, st.vz).toFixed(2), eights, ice: +sh.ice().toFixed(2) };
    },
    stats: () => ({ skating: on ? 1 : 0 }),
    dispose() { if (on) sh.controller()?.ride(null); },
  };
}
