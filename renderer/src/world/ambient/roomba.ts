/**
 * "Dusty" the roomba (ART §6.7 ambient life): a tiny disc bot with googly slot eyes that patrols the lobby and the
 * atrium ring, bumps into people ("oop!" squint, back up, turn), spins a little victory sparkle after each lap, and
 * parks by the lobby wall at night (22–07, LED breathing). Draws through charBatch. Owner: AMB.
 */
import * as THREE from 'three';
import { makeBuilder, node, limbScale } from '../../chars/rig/build.ts';
import { CORE, ENV } from '../../../../shared/palette.ts';
import { createWalker, W, dampAng, TAU } from './util.ts';
import type { AmbDeps, AmbFrame } from './util.ts';
import type { RigPart } from '../../chars/rig/build.ts';

/** Patrol loop (plan coords): lobby, the atrium ring round the Pit, back through the lobby. */
/** A patrol point in plan coords, with an optional tag (`crumbs` = hoover the pastry case). */
export type PatrolPoint = [x: number, z: number, tag?: string];

const LOOP: PatrolPoint[] = [[22.5, 24.2], [26.4, 25.6], [26.5, 22.4], [25.3, 19.0], [25.2, 12.0], [22.8, 8.6], [18.2, 8.6], [15.4, 11.5], [15.5, 16.5], [18.4, 22.6], [16.8, 25.6], [20.5, 25.2]];
const DOCK: [number, number] = [27.35, 26.1];
/** [AMB fix m2 r2] Café detour, every other lap (inserted after the lobby's east point): through the Lobby door, along
 *  the bar (a crumb hunt at the pastry case), round the tables, back out. The Café is never empty of the cast. */
export const CAFE_DETOUR: PatrolPoint[] = [[28.9, 24.6], [31.6, 26.15], [34.9, 26.15], [37.3, 25.85, 'crumbs'], [37.25, 22.2], [33.9, 21.9], [29.8, 22.6], [28.9, 24.3]];
/** Patrol order for lap `lap` (pure): the café detour on even laps. */
export function patrolFor(lap: number): PatrolPoint[] {
  return lap % 2 === 0 ? [...LOOP.slice(0, 2), ...CAFE_DETOUR, ...LOOP.slice(2)] : LOOP.slice();
}

export function createRoomba(d: Pick<AmbDeps, 'layout' | 'nav' | 'charBatch' | 'fx' | 'actors' | 'player' | 'rand' | 'bus'>) {
  const { layout, nav, charBatch, fx, actors, player, rand } = d;
  const parts: RigPart[] = [];
  const { part } = makeBuilder(parts);
  const root = new THREE.Object3D();
  part(root, 'blob', 'ink', { p: [0, 0.004, 0], s: [0.25, 1, 0.25] });
  const bodyN = node(root, { name: 'body' });
  part(bodyN, 'cyl', CORE.ink2, { hull: true, shadow: true, s: [0.19, 0.07, 0.19], p: [0, 0.045, 0] });
  part(bodyN, 'cyl', '#B8B2A6', { hull: false, s: [0.165, 0.02, 0.165], p: [0, 0.084, 0] });
  part(bodyN, 'band', CORE.ink, { s: [0.196, 0.196, 0.4], p: [0, 0.045, 0], r: [Math.PI / 2, 0, 0] });
  part(bodyN, 'cyl', ENV.teal, { s: [0.06, 0.012, 0.06], p: [0, 0.096, -0.07] }); // button
  const led = node(bodyN, { p: [0, 0.1, -0.07] });
  part(led, 'sphere', ENV.butter, { s: [0.02, 0.012, 0.02], emissive: 1.6 });
  const eyes = [-1, 1].map((s) => {
    const e = node(bodyN, { p: [s * 0.058, 0.1, 0.095], r: [-0.95, 0, 0] });
    part(e, 'eye', CORE.ink, { s: [0.7, 0.55, 0.5], group: 'face' });
    return e;
  });
  // whip antenna with a little pennant (findable across the lobby, bobs as it drives)
  const whip = node(bodyN, { p: [-0.1, 0.09, -0.1], order: 'XYZ' });
  part(whip, 'limb', CORE.ink2, { s: limbScale(0.005, 0.3), r: [Math.PI, 0, 0] });
  const flag = node(whip, { p: [0, 0.29, 0] });
  part(flag, 'cone', ENV.butter, { hull: true, s: [0.045, 0.09, 0.01], p: [0.0, -0.04, 0], r: [0, 0, -Math.PI / 2] });
  const brush = node(root, { p: [0.13, 0.012, 0.12] });
  for (let k = 0; k < 3; k++) {
    const b = node(brush, { r: [0, (k * TAU) / 3, 0] });
    part(node(b, { r: [0, 0, Math.PI / 2 - 0.08] }), 'limb', CORE.ink2, { s: limbScale(0.006, 0.07) });
  }
  const rig = { root, parts, species: 'prop', kind: 'prop', pers: {}, version: 0, smear: 0, accessory: { index: 0, cycle: 0 }, setAccessory() {} };
  const handle = charBatch.register(rig, { kind: 'prop', colorIndex: 0, cycle: 0 });

  const toPts = (lap: number) => patrolFor(lap).map(([x, z, tag]) => ({ ...W(x, z), tag }));
  let pts = toPts(0);
  const dock = W(...DOCK);
  const walker = createWalker(nav, layout, pts[0], { speed: 0.32, turn: 3.2 });
  const S = { i: 1, pause: 0, bump: 0, spin: 0, lap: 0, t: 0, docked: false, led: 0, crumbs: 0, turnDir: undefined as number | undefined };
  walker.go(pts[1]);
  const tmp = new THREE.Vector3();

  const blockedAhead = () => {
    const fx_ = Math.sin(walker.yaw), fz = Math.cos(walker.yaw);
    const chk = (x: number, z: number, r: number) => {
      const dx = x - walker.pos.x, dz = z - walker.pos.z, dd = Math.hypot(dx, dz);
      return dd < r && (dx * fx_ + dz * fz) / (dd || 1) > 0.35;
    };
    if (chk(player.pos.x, player.pos.z, 0.55) && (player.level ?? 0) === 0) return 'player';
    for (const a of actors?.list?.() ?? []) if (a.pos && chk(a.pos.x, a.pos.z, 0.5)) return 'agent';
    return null;
  };

  function update(c: AmbFrame, camera: { position: { x: number; z: number } } | null | undefined) {
    const dt = Math.min(c.dt, 0.1);
    S.t += dt;
    const night = c.hour >= 22 || c.hour < 7;
    let moving = false;
    if (S.crumbs > 0) S.crumbs -= dt;
    if (S.spin > 0) {
      S.spin -= dt; walker.yaw += dt * 7;
      if (S.spin <= 0) walker.go(pts[S.i]);
    } else if (S.pause > 0) {
      S.pause -= dt;
      if (S.pause < 0.5) walker.yaw += dt * 2.6 * (S.turnDir ?? 1); // turn away
      if (S.pause <= 0) walker.go(night ? dock : pts[S.i]);
    } else {
      const who = walker.moving ? blockedAhead() : null;
      if (who) {
        S.pause = 1.1; S.bump = 1; S.turnDir = rand() < 0.5 ? -1 : 1; walker.stop();
        d.bus?.emit?.('amb.roomba', { ev: 'bump', who });
      } else {
        moving = walker.update(dt);
        if (!moving && !walker.pending) {
          if (night) { S.docked = Math.hypot(walker.pos.x - dock.x, walker.pos.z - dock.z) < 0.3; if (!S.docked) walker.go(dock); else walker.yaw = dampAng(walker.yaw, Math.PI, 2, dt); }
          else {
            S.docked = false;
            if (walker.failed) { S.i = (S.i + 1) % pts.length; walker.go(pts[S.i]); }
            else {
              const arrived = pts[S.i];
              S.i = (S.i + 1) % pts.length;
              if (arrived?.tag === 'crumbs') { // hoover the pastry-case crumbs: a happy wiggle + sparkle
                S.pause = 2.6; S.crumbs = 2.6; S.turnDir = 1;
                tmp.set(walker.pos.x, walker.pos.y + 0.12, walker.pos.z); fx?.burst?.('sparkle', tmp, { count: 6 });
                d.bus?.emit?.('amb.roomba', { ev: 'crumbs' });
              } else if (S.i === 1) { S.spin = 1.2; S.lap++; pts = toPts(S.lap); tmp.set(walker.pos.x, walker.pos.y + 0.25, walker.pos.z); fx?.burst?.('sparkle', tmp, { count: 10 }); }
              else walker.go(pts[S.i]);
            }
          }
        }
      }
    }
    S.bump = Math.max(0, S.bump - dt * 1.4);
    root.position.set(walker.pos.x, walker.pos.y, walker.pos.z);
    root.rotation.y = walker.yaw;
    const far = camera ? Math.hypot(camera.position.x - walker.pos.x, camera.position.z - walker.pos.z) : 0;
    handle.setVisible(far < 30);
    if (far >= 30) return;
    // body bounce on bumps, a wobble while driving, the brush spins, the LED blinks (breathes when docked)
    bodyN.position.y = Math.abs(Math.sin(S.t * 11)) * 0.004 * (moving ? 1 : 0) + S.bump * 0.02 * Math.abs(Math.sin(S.bump * 12));
    bodyN.rotation.x = -S.bump * 0.12;
    bodyN.rotation.z = S.crumbs > 0 ? 0.08 * Math.sin(S.t * 22) : 0;
    whip.rotation.x = -0.25 * (moving ? 1 : 0) + Math.sin(S.t * 7) * 0.06 + S.bump * 0.4 * Math.sin(S.t * 30);
    whip.rotation.z = Math.sin(S.t * 3.1) * 0.08;
    brush.rotation.y += dt * (moving || S.spin > 0 || S.crumbs > 0 ? 14 : 1.5);
    const on = S.docked ? 0.5 + 0.5 * Math.sin(S.t * 1.6) : Math.sin(S.t * 5) > 0 ? 1 : 0.25;
    led.scale.setScalar(0.6 + 0.4 * on);
    for (const e of eyes) {
      e.scale.y = S.docked ? 0.15 : S.bump > 0.3 ? 0.35 : Math.sin(S.t * 0.8) > 0.985 ? 0.15 : 1; // squint on a bump, blink
      e.scale.x = S.bump > 0.3 ? 1.25 : 1;
    }
  }

  return {
    update,
    get pos() { return walker.pos; },
    get yaw() { return walker.yaw; },
    get moving() { return walker.moving; },
    debug: () => ({ i: S.i, lap: S.lap, docked: S.docked, x: +walker.pos.x.toFixed(2), z: +walker.pos.z.toFixed(2) }),
    teleport(x: number, z: number, yaw = 0) { walker.stop(); walker.pos.x = x; walker.pos.z = z; walker.yaw = yaw; },
    dispose() { handle.remove(); },
  };
}
