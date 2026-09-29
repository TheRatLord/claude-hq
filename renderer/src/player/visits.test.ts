// Controller-level monitor dive + manager's desk (§6.10 additions, M2/M3 PLY rows): Esc / undive restores the exact
// pre-dive pose, drawer close pulls back out, the manager's desk hint / overhead camera / click-select / stand up.
import test from 'node:test';
import assert from 'node:assert/strict';
import type * as THREE from 'three';
import type { Slot } from '../world/layout/schema.ts';
import type { PlayerActor, PlayerDirector, ViewRect } from './controller.ts';
import { fakeCamera } from './testCamera.ts';
import { fake } from '../core/testDoubles.ts';

/** A seated (or away) worker: the controller's actor slice plus its home desk slot (what the director double answers). */
interface SeatedActor extends PlayerActor { slot?: Slot | null }

globalThis.addEventListener ??= () => {};
globalThis.removeEventListener ??= () => {};

const { createPlayer } = await import('./controller.ts');
const { layout } = await import('../world/layout/hq.ts');
const { createNav } = await import('../world/nav/index.ts');
const { createBus } = await import('../core/bus.ts');
const { hqDesks } = await import('./deskFixture.ts');
const { DIVE } = await import('./dive.ts');
const { MANAGER } = await import('./manager.ts');

const nav = createNav(layout);
const deskSlots = layout.slots.filter((s) => s.tag === 'desk');

/**
 * A scene with one instanced 'env:screens' mesh: a monitor per E-bay desk where world/build really places it
 * (deskFixture.ts: bays.ts + the monitor kit's screen anchor, tilt included; m3 fix r1).
 */
function fakeScene() {
  const D = hqDesks(layout);
  const arr = new Float32Array(D.length * 16);
  D.forEach(({ screen: q }, i) => {
    // columns: right = up × normal, up, normal, position (three.js column-major)
    const rx = q.uy * q.nz - q.uz * q.ny, ry = q.uz * q.nx - q.ux * q.nz, rz = q.ux * q.ny - q.uy * q.nx;
    arr.set([rx, ry, rz, 0, q.ux, q.uy, q.uz, 0, q.nx, q.ny, q.nz, 0, q.x, q.y, q.z, 1], i * 16);
  });
  const mesh = { isInstancedMesh: true, name: 'env:screens', count: D.length, instanceMatrix: { array: arr },
    geometry: { parameters: { width: 0.37, height: 0.155 } }, matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }, updateWorldMatrix() {} };
  return { traverse(cb: (o: THREE.Object3D) => void) { cb(fake<THREE.InstancedMesh>(mesh)); } };
}

function rig(actors: SeatedActor[]) {
  const camera = fakeCamera();
  const bus = createBus();
  const events: { k: string; e: Record<string, unknown> }[] = [];
  for (const k of ['player.dive', 'player.manager', 'player.select'] as const) bus.on(k, (e) => events.push({ k, e: { ...e } }));
  const home = new Map(actors.map((a) => [a.id, a.slot]));
  const director: PlayerDirector = { slotFor: (id: string) => home.get(id) ?? null };
  const p = createPlayer({ camera, dom: { addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1600, height: 900 }) }, bus, nav, director, now: () => 0 });
  p.setSoftColliders(() => actors);
  const ctx = { layout, rawDt: 1 / 60, scene: fakeScene() };
  const frame = () => p.update(ctx);
  const run = (n: number) => { for (let i = 0; i < n; i++) frame(); };
  frame();
  return { p, camera, bus, events, run };
}
const seated = (slot: Slot, id = 'w1'): SeatedActor => ({ id, pos: { ...slot.pos }, yaw: slot.yaw, slot });
/** a standing spot 2 m in front-side of a seated worker (walkable) */
function nearSpot(slot: Slot) {
  for (const r of [2, 2.4, 1.6, 2.8]) for (let k = 0; k < 16; k++) {
    const th = slot.yaw + (k / 16) * Math.PI * 2;
    const x = slot.pos.x + Math.sin(th) * r, z = slot.pos.z + Math.cos(th) * r;
    if (nav.walkable(x, z, 0) && !nav.collides(x, z, 0.3, 0)) return { x, z, yaw: Math.atan2(-(slot.pos.x - x), -(slot.pos.z - z)) };
  }
  return null;
}
const angDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

test('dive: glides into the monitor in 0.6 s, announces the screen, undive restores the pose within 0.05 m / 2°', () => {
  const slot = deskSlots[0];
  const a = seated(slot);
  const r = rig([a]);
  const st = nearSpot(slot);
  assert.ok(st, 'a stand spot');
  r.p.setPose(st.x, 0, st.z, st.yaw, -0.2);
  r.run(3);
  const before = { pos: { ...r.p.pos }, yaw: r.p.yaw, pitch: r.p.pitch, cam: { ...r.camera.position }, fov: r.camera.fov };
  let rect: 'unset' | ViewRect | null = 'unset';
  assert.equal(r.p.dive(a, { onScreen: (x) => { rect = x; } }), true);
  assert.equal(r.p.mode, 'dive');
  r.run(Math.round(60 * DIVE.dur) - 2);
  assert.equal(rect, 'unset', 'not announced before arriving');
  r.run(4);
  assert.equal(r.p.diveInfo()?.phase, 'hold');
  // m3 fix r1 (reviewer [fun]): the full screen holds the frame for DIVE.dwell before the drawer opens from it
  assert.equal(rect, 'unset', 'the drawer waits for the screen to fill the frame');
  r.run(Math.ceil(60 * DIVE.dwell) + 1);
  assert.notEqual(rect, 'unset', 'onScreen fired after the dwell');
  assert.ok(r.events.some((x) => x.k === 'player.dive' && x.e.phase === 'screen'));
  assert.ok(r.camera.fov >= DIVE.fovEnd - 1e-2 && r.camera.fov <= DIVE.fovMax + 1e-2, `fov ${r.camera.fov}`);
  // the camera ended in front of the screen, looking into it (close to the monitor), outside the sitter's body
  const eye = r.camera.position;
  assert.ok(Math.hypot(eye.x - slot.pos.x, eye.z - slot.pos.z) < 0.9, 'at the desk');
  assert.ok(Math.hypot(eye.x - a.pos.x, eye.z - a.pos.z) >= DIVE.bodyR + DIVE.lensGap, 'not inside the sitter');
  // Esc path == undive()
  assert.equal(r.p.undive(), true);
  r.run(60);
  assert.equal(r.p.mode, 'walk');
  assert.ok(Math.hypot(r.p.pos.x - before.pos.x, r.p.pos.y - before.pos.y, r.p.pos.z - before.pos.z) <= 0.05, 'feet back');
  assert.ok(Math.hypot(r.camera.position.x - before.cam.x, r.camera.position.y - before.cam.y, r.camera.position.z - before.cam.z) <= 0.05, 'eye back');
  assert.ok(angDiff(r.p.yaw, before.yaw) <= 2 * Math.PI / 180 && Math.abs(r.p.pitch - before.pitch) <= 2 * Math.PI / 180, 'look back');
  assert.ok(Math.abs(r.camera.fov - before.fov) < 1e-2, 'fov back');
  assert.deepEqual(r.events.filter((x) => x.k === 'player.dive').map((x) => x.e.phase), ['start', 'screen', 'out', 'end']);
});

test('dive: Esc halfway backs out from where it is; WASD pulls out; the drawer closing pulls out', () => {
  const slot = deskSlots[3];
  const a = seated(slot);
  const r = rig([a]);
  const st = nearSpot(slot);
  assert.ok(st, 'a stand spot');
  r.p.setPose(st.x, 0, st.z, st.yaw, -0.1);
  r.run(2);
  const b0 = { ...r.camera.position };
  r.p.dive(a); r.run(15); r.p.undive(); r.run(40);
  assert.equal(r.p.mode, 'walk');
  assert.ok(Math.hypot(r.camera.position.x - b0.x, r.camera.position.y - b0.y, r.camera.position.z - b0.z) <= 0.05);
  // WASD
  r.p.dive(a); r.run(50); r.p.virtualKeys.add('KeyW'); r.run(2); r.p.virtualKeys.clear(); r.run(40);
  assert.equal(r.p.mode, 'walk', 'movement pulled out');
  // drawer open → close
  r.p.dive(a); r.run(50);
  r.bus.emit('drawer', { open: true, fullscreen: false }); r.run(2);
  assert.equal(r.p.mode, 'dive');
  r.bus.emit('drawer', { open: false, fullscreen: false }); r.run(40);
  assert.equal(r.p.mode, 'walk', 'drawer close pulled out');
});

test('dive: refused for an agent away from its desk, or with no monitor', () => {
  const slot = deskSlots[0];
  const away: SeatedActor = { id: 'w2', pos: { x: 0, y: 0, z: 9 }, yaw: 0, slot };
  const r = rig([away]);
  assert.equal(r.p.dive(away), false);
  assert.equal(r.p.mode, 'walk');
  const noDesk: SeatedActor = { id: 'w3', pos: { x: 0, y: 0, z: 9 }, yaw: 0, slot: null };
  assert.equal(rig([noDesk]).p.dive(noDesk), false);
});

test('dive from a seat returns to the seat', () => {
  const slot = deskSlots[5];
  const a = seated(slot);
  const r = rig([a]);
  const sofa = layout.slots.find((s) => s.tag === 'sofa');
  assert.ok(sofa, 'a sofa');
  r.p.setPose(sofa.pos.x - Math.sin(sofa.yaw) * 0.9, sofa.pos.y, sofa.pos.z - Math.cos(sofa.yaw) * 0.9, sofa.yaw + Math.PI, -0.4);
  r.run(2);
  if (!r.p.interact()) { console.log('# sofa not in reach: skipped'); return; }
  r.run(40);
  assert.equal(r.p.mode, 'sit');
  const e0 = { ...r.camera.position };
  assert.equal(r.p.dive(a), true);
  r.run(50); r.p.undive(); r.run(40);
  assert.equal(r.p.mode, 'sit');
  assert.ok(Math.hypot(r.camera.position.x - e0.x, r.camera.position.y - e0.y, r.camera.position.z - e0.z) <= 0.05);
});

test("manager's desk: hint on the mezzanine, E → overhead view, click selects, Esc/E stands back up", () => {
  const actors: SeatedActor[] = [{ id: 'pit1', pos: { ...layout.points.pitCenter, y: -0.45 }, yaw: 0 }];
  const r = rig(actors);
  const md = r.p.managerDesk();
  assert.ok(md, 'desk found');
  // stand north of the desk on the mezzanine, facing it (south)
  r.p.setPose(md.x, md.y, md.z - 1.2, Math.PI, -0.35);
  r.run(3);
  assert.equal(r.p.hint()?.verb, 'manage', JSON.stringify(r.p.hint()));
  const before = { ...r.camera.position }, yaw0 = r.p.yaw;
  assert.equal(r.p.interact(), true);
  assert.equal(r.p.mode, 'manager');
  r.run(Math.ceil(60 * MANAGER.glide) + 2);
  assert.ok(r.camera.position.y > 4, `overhead (${r.camera.position.y.toFixed(2)})`);
  assert.ok(Math.abs(r.camera.fov - MANAGER.fov) < 1e-2);
  assert.ok(r.events.some((x) => x.k === 'player.manager' && x.e.on === true));
  // WASD pans
  const z0 = r.camera.position.z;
  r.p.virtualKeys.add('KeyW'); r.run(20); r.p.virtualKeys.clear();
  assert.ok(Math.abs(r.camera.position.z - z0) > 0.3, 'panned');
  // stand up
  assert.equal(r.p.interact(), true);
  r.run(Math.ceil(60 * MANAGER.glide) + 2);
  assert.equal(r.p.mode, 'walk');
  assert.ok(Math.hypot(r.camera.position.x - before.x, r.camera.position.y - before.y, r.camera.position.z - before.z) <= 0.05);
  assert.ok(angDiff(r.p.yaw, yaw0) < 0.035);
  assert.ok(r.events.some((x) => x.k === 'player.manager' && x.e.on === false));
});
