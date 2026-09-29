// Headless controller sim on the hq greybox (§6.10, M1.5 feel block): the scripted traversal through the real
// controller at a fixed 60 fps, plus targeted checks (stairs level switch, collisions, sit rules, slide).
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Slot } from '../world/layout/schema.ts';
import type { PlayerActor, PlayerDirector, TraversalResult } from './controller.ts';
import { fakeCamera } from './testCamera.ts';

// minimal browser globals the controller touches (listeners are never fired here)
globalThis.addEventListener ??= () => {};
globalThis.removeEventListener ??= () => {};

const { createPlayer } = await import('./controller.ts');
const { layout } = await import('../world/layout/hq.ts');
const { createNav } = await import('../world/nav/index.ts');
const { createBus } = await import('../core/bus.ts');

const nav = createNav(layout);

/** The first seat with `tag`. */
const seatTagged = (tag: string): Slot => { const s = layout.slots.find((q) => q.tag === tag); assert.ok(s, `a ${tag} slot`); return s; };

function rig(o: { director?: PlayerDirector } = {}) {
  let t = 0;
  const camera = fakeCamera();
  const bus = createBus();
  const events: { k: string; t: number; e: Record<string, unknown> }[] = [];
  for (const k of ['player.step', 'player.land', 'player.sit', 'player.stand', 'player.slide'] as const) bus.on(k, (e) => events.push({ k, t, e: { ...e } }));
  const p = createPlayer({ camera, dom: { addEventListener() {}, removeEventListener() {} }, bus, nav, now: () => t, ...o });
  const ctx = { layout, rawDt: 1 / 60 };
  const frame = () => { t += 1000 / 60; p.update(ctx); };
  const run = (n: number) => { for (let i = 0; i < n; i++) frame(); };
  frame();
  return { p, camera, bus, events, frame, run, ms: () => t };
}

test('scripted M1.5 traversal: spawn → Pit sit/stand → stairs → mezzanine → slide → Lobby meets the feel gate', async () => {
  const r = rig();
  const done = r.p.feelTrace('run');
  const box: { out: TraversalResult | null } = { out: null };
  done.then((v) => { assert.ok('run' in v, 'the scripted traversal result'); box.out = v; });
  for (let i = 0; i < 60 * 90 && !box.out; i++) { r.frame(); await new Promise(setImmediate); }
  const out = box.out;
  assert.ok(out, 'traversal finished within 90 s');
  assert.equal(out.error, null, out.error ?? undefined);
  assert.ok(out.run, 'checkpoints');
  const names = out.run.map((c) => c.name);
  for (const n of ['spawn', 'pitGap', 'sit', 'stand', 'stairsFoot', 'mezz', 'ride', 'slideExit', 'lobby']) assert.ok(names.includes(n), `checkpoint ${n}`);
  assert.equal(out.run.find((c) => c.name === 'mezz')?.level, 1, 'on the mezzanine after the stairs');
  assert.equal(out.run.find((c) => c.name === 'slideExit')?.level, 0, 'slide exits on the ground');
  assert.ok((out.maxDyPerFrame ?? Infinity) <= 0.03, `camera pop ${out.maxDyPerFrame} m/frame`);
  assert.ok((out.bobPhaseErrMs ?? Infinity) <= 20, `bob phase error ${out.bobPhaseErrMs} ms`);
  assert.ok((out.fovMax ?? 0) >= 60 + 7.5, `ride FOV kick visible (${out.fovMax})`);
  assert.ok((out.ride?.maxRollDeg ?? 0) > 1 && (out.ride?.maxRollDeg ?? 0) <= 6.001, `ride roll ${out.ride?.maxRollDeg}°`);
  assert.ok(Math.abs((out.ride?.durationMs ?? NaN) - 2200) < 80, `ride ${out.ride?.durationMs} ms`);
  assert.ok(out.lands.length >= 2, 'a jump landing and the slide exit dip');
  assert.ok(r.events.some((e) => e.k === 'player.sit') && r.events.some((e) => e.k === 'player.stand'));
  assert.deepEqual(r.events.filter((e) => e.k === 'player.slide').map((e) => e.e.phase), ['start', 'exit']);
  assert.ok(new Set(r.events.filter((e) => e.k === 'player.step').map((e) => e.e.surface)).size >= 3, 'footstep surfaces vary by zone');
});

test('sprint FOV kick reaches +5° and the sprint step rate is 2.6 Hz', async () => {
  const r = rig();
  r.p.setPose(0, 0, 12.5, 0, 0); // spawn, facing north up the main axis
  const tr = r.p.feelTrace(0);
  r.p.virtualKeys.add('KeyW'); r.p.virtualKeys.add('ShiftLeft');
  r.run(150);
  r.p.virtualKeys.clear();
  r.run(30);
  const a = await r.p.feelTrace(1); // starting a new trace ends the running one
  void a;
  const b = await tr;
  assert.ok((b.fovMax ?? 0) >= 64.8, `fov ${b.fovMax}`);
  assert.ok(Math.abs((b.sprintStepHz ?? NaN) - 2.6) < 0.05, `sprint steps ${b.sprintStepHz} Hz`);
  assert.ok((b.bobPhaseErrMs ?? Infinity) <= 20);
});

test('stairs switch the level at half the rise and the camera never pops', () => {
  const r = rig();
  const foot = layout.points.stairsFoot, top = layout.points.stairsTop;
  r.p.setPose(foot.x, 0, foot.z + 0.3, 0, 0); // facing −z = north, up the stairs
  const tr = r.p.feelTrace(0);
  const vk = r.p.virtualKeys;
  vk.add('KeyW'); vk.add('ShiftLeft');
  let maxDy = 0, prev: number | null = null;
  for (let i = 0; i < 240 && r.p.pos.z > top.z + 0.2; i++) {
    r.frame();
    if (prev !== null) maxDy = Math.max(maxDy, Math.abs(r.camera.position.y - prev));
    prev = r.camera.position.y;
  }
  vk.clear();
  assert.equal(r.p.level, 1);
  assert.ok(Math.abs(r.p.pos.y - 2.9) < 0.05, `feet ${r.p.pos.y}`);
  assert.ok(maxDy <= 0.03, `max camera dy ${maxDy}`);
  void tr;
});

test('walls stop the player (per-axis slide) and the ENG +0.25 step is smoothed', () => {
  const r = rig();
  // walk west from the atrium into the E-bay glazing at plan x14 (world −6.5) away from its doors
  r.p.setPose(-5.3, 0, 2.2, Math.PI / 2, 0); // plan (15.2, 16.2), facing −x (west)
  r.p.virtualKeys.add('KeyW');
  r.run(120);
  r.p.virtualKeys.clear();
  assert.ok(r.p.pos.x > -6.5 + 0.2, `stopped at the glass (x ${r.p.pos.x.toFixed(2)})`);
  // ENG door x28 (world 7.5), z17.5–19 (world 3.5–5): walk east through it
  r.p.setPose(6.3, 0, 4.25, -Math.PI / 2, 0);
  r.p.virtualKeys.add('KeyW');
  let maxDy = 0, prev: number | null = null;
  for (let i = 0; i < 60; i++) { r.frame(); if (prev !== null) maxDy = Math.max(maxDy, Math.abs(r.camera.position.y - prev)); prev = r.camera.position.y; }
  r.p.virtualKeys.clear();
  assert.ok(Math.abs(r.p.pos.y - 0.25) < 1e-6, `on the ENG platform (y ${r.p.pos.y})`);
  assert.ok(maxDy <= 0.03, `step dy ${maxDy}`);
});

test('sit: E on a free Pit sofa glides to 0.78 m eye height, look is clamped, W stands up with a hop', () => {
  const r = rig();
  const s = seatTagged('sofa');
  const ax = s.pos.x - Math.sin(s.yaw) * 0.8, az = s.pos.z - Math.cos(s.yaw) * 0.8;
  r.p.setPose(ax, layout.floorY(ax, az, 0), az, s.yaw + Math.PI, 0); // facing the seat
  r.run(2);
  assert.equal(r.p.hint()?.verb, 'sit');
  assert.ok(r.p.interact());
  r.run(30);
  assert.equal(r.p.mode, 'sit');
  assert.ok(Math.abs(r.camera.position.y - (s.pos.y + 0.78)) < 0.02, `eye ${r.camera.position.y}`);
  r.p.yaw = s.yaw + 3; r.run(1);
  assert.ok(Math.abs(r.p.yaw - s.yaw) <= (100 * Math.PI) / 180 + 1e-6, 'yaw clamp ±100°');
  r.p.virtualKeys.add('KeyW'); r.run(1); r.p.virtualKeys.clear();
  assert.equal(r.p.mode, 'glide');
  r.run(40);
  assert.equal(r.p.mode, 'walk');
  assert.ok(!nav.collides(r.p.pos.x, r.p.pos.z, 0.28, 0), 'stood up on free floor');
});

test('an agent\'s own desk chair is not sittable: the hint names the owner', () => {
  const desk = seatTagged('desk');
  const actor: PlayerActor = { id: 'a1', entity: { name: 'scout' }, pos: { x: 50, y: 0, z: 50 }, yaw: 0 };
  const director: PlayerDirector = { slotFor: (id: string) => (id === 'a1' ? desk : null), holds: () => false, pinFor: () => null, claim: () => null, unclaim() {} };
  const r = rig({ director });
  r.p.setSoftColliders(() => [actor]);
  const ax = desk.pos.x + Math.sin(desk.yaw) * 0.6, az = desk.pos.z + Math.cos(desk.yaw) * 0.6; // behind the chair
  r.p.setPose(ax, 0, az, desk.yaw, 0);
  r.run(2);
  assert.equal(r.p.hint()?.text, "that's scout's chair");
  assert.equal(r.p.hint()?.verb, null);
  assert.equal(r.p.interact(), false);
});

test('slide: E at the mouth rides 2.2 s along the path and exits walking at the bottom with a carry', () => {
  const r = rig();
  const m = layout.slide.mouth;
  r.p.setPose(m.x, 2.9, m.z - 0.9, Math.PI, 0); // facing +z (south), toward the mouth
  r.run(2);
  assert.equal(r.p.level, 1);
  assert.equal(r.p.hint()?.verb, 'ride');
  assert.ok(r.p.interact());
  let n = 0;
  while (r.p.mode !== 'walk' && n < 400) { r.frame(); n++; }
  const ex = layout.slide.exit;
  assert.ok(Math.hypot(r.p.pos.x - ex.x, r.p.pos.z - ex.z) < 0.3, 'at the exit');
  assert.equal(r.p.level, 0);
  assert.ok(Math.hypot(r.p.vel.x, r.p.vel.z) > 3, 'carried out of the slide');
  r.run(60);
  assert.ok(Math.hypot(r.p.vel.x, r.p.vel.z) < 0.1, 'carry decays');
});

test('slide ride camera: stays above the chute lip (near-plane margin) and leans toward the Pit / Big Board', async () => {
  const THREE = await import('three');
  const r = rig();
  const m = layout.slide.mouth;
  r.p.setPose(m.x, 2.9, m.z - 0.9, Math.PI, 0);
  r.run(2);
  assert.ok(r.p.interact());
  // the greybox chute: a tube of radius `slide.tube` along the path lifted 0.3 m (world/build/greybox.ts)
  const cs = new THREE.CatmullRomCurve3(layout.slide.path.map((q) => new THREE.Vector3(q.x, q.y + 0.3, q.z)), false, 'centripetal').getSpacedPoints(1500);
  const near = 0.05, nearReach = Math.hypot(near, near * Math.tan((60 + 8) / 2 * Math.PI / 180) * (16 / 9), near * Math.tan(34 * Math.PI / 180));
  const bb = layout.points.bigBoard;
  let minClear = Infinity, n = 0, ahead = 0;
  for (let i = 0; i < 400 && r.p.mode !== 'walk'; i++) {
    r.frame();
    const c = r.camera.position;
    let d = Infinity;
    for (const q of cs) d = Math.min(d, Math.hypot(q.x - c.x, q.y - c.y, q.z - c.z));
    minClear = Math.min(minClear, d - layout.slide.tube); // glide + ride: eye → nearest chute wall
    if (r.p.mode !== 'ride') continue;
    n++;
    const yaw = r.camera.rotation.y, dx = bb.x - c.x, dz = bb.z - c.z;
    if ((-Math.sin(yaw) * dx - Math.cos(yaw) * dz) / Math.hypot(dx, dz) > Math.cos(45 * Math.PI / 180)) ahead++;
  }
  assert.ok(n > 100, `rode ${n} frames`);
  assert.ok(minClear > nearReach + 0.03, `eye ${minClear.toFixed(3)} m clear of the chute (near-plane reach ${nearReach.toFixed(3)})`);
  assert.ok(ahead / n >= 0.6, `Big Board within 45° of the view for ${(100 * ahead / n).toFixed(0)}% of the ride`);
});
