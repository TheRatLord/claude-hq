// Monitor dive math (dive.ts): end pose fills the frame, the track clears the head, starts / ends where it should.
import test from 'node:test';
import assert from 'node:assert/strict';
import { diveEnd, diveTrack, screenFromMatrix, screenRectPx, clearance, DIVE } from './dive.ts';
import { hqDesks, deskBox } from './deskFixture.ts';
import { layout } from '../world/layout/hq.ts';
import type { CamPose } from './dive.ts';

const POSE_KEYS = ['x', 'y', 'z', 'yaw', 'pitch', 'fov'] as const;

const screen = { x: 0, y: 0.72, z: 0, nx: 0, ny: 0, nz: 1, ux: 0, uy: 1, uz: 0, w: 0.37, h: 0.155 }; // faces +z
const actor = { x: 0, y: 0, z: 0.75 };
const from: CamPose = { x: 1.8, y: 1.2, z: 2.6, yaw: 0.6, pitch: -0.2, fov: 60 };

test('diveEnd: on the normal, screen fills the frame at the narrowed FOV', () => {
  const e = diveEnd(screen);
  assert.ok(Math.abs(e.x) < 1e-9 && Math.abs(e.y - 0.72) < 1e-9 && e.z > DIVE.minD - 1e-9);
  assert.ok(Math.abs(e.yaw) < 1e-9 && Math.abs(e.pitch) < 1e-9, 'looks straight into the screen');
  const tv = Math.tan((e.fov * Math.PI) / 360);
  const fillH = (screen.h / 2) / (e.d * tv), fillW = (screen.w / 2) / (e.d * tv * DIVE.aspect);
  assert.ok(Math.abs(Math.max(fillH, fillW) - DIVE.fill) < 1e-6, `fill ${fillH.toFixed(2)} / ${fillW.toFixed(2)}`);
});

test('diveTrack: starts at the pre-dive pose, ends in the screen, FOV narrows monotonically', () => {
  const tr = diveTrack(from, screen, actor);
  const a = tr.at(0), b = tr.at(1);
  for (const k of POSE_KEYS) assert.ok(Math.abs(a[k] - from[k]) < 1e-9, `start ${k}`);
  for (const k of POSE_KEYS) assert.ok(Math.abs(b[k] - tr.end[k]) < 1e-9, `end ${k}`);
  let prev = Infinity;
  for (let i = 0; i <= 60; i++) { const f = tr.at(i / 60).fov; assert.ok(f <= prev + 1e-9, 'fov never widens'); prev = f; }
});

// seated Clawd body box (geometry.ts BODY_W/H/D on a 0.32 m seat, + hat) around the slot
const BOX = { x0: -0.36, x1: 0.36, y0: 0.32, y1: 0.95, z0: 0.75 - 0.23, z1: 0.75 + 0.23 };
const boxDist = (p: { x: number; y: number; z: number }) => Math.hypot(Math.max(BOX.x0 - p.x, 0, p.x - BOX.x1), Math.max(BOX.y0 - p.y, 0, p.y - BOX.y1), Math.max(BOX.z0 - p.z, 0, p.z - BOX.z1));

const FROM_POSES: [string, CamPose][] = [['from the side', from], ['from behind', { ...from, x: 0.2, z: 2.4 }], ['from the other side', { ...from, x: -1.9, z: 1.2 }]];
for (const [name, f0] of FROM_POSES) test(`diveTrack: passes over the shoulder, never through the seated body (${name})`, () => {
  const from = f0;
  const tr = diveTrack(from, screen, actor);
  let minD = Infinity, maxY = -Infinity, maxStep = 0, prev: { x: number; y: number; z: number } | null = null;
  for (let i = 0; i <= 600; i++) {
    const p = tr.at(i / 600);
    minD = Math.min(minD, boxDist(p));
    maxY = Math.max(maxY, p.y);
    if (prev) maxStep = Math.max(maxStep, Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z));
    prev = { ...p };
  }
  assert.ok(minD > 0.08, `clears the body by ${minD.toFixed(3)} m (near plane 0.05)`);
  assert.ok(maxY >= 1.2 - 1e-6, 'rises over the shoulder');
  // 60 fps over 0.6 s = 36 frames: no frame jumps more than ~0.2 m (smooth glide)
  assert.ok(maxStep * (600 / 36) < 0.25, `max per-frame step ${(maxStep * 600 / 36).toFixed(3)} m`);
});

test('screenFromMatrix + screenRectPx: a face-on screen projects to a centred rect', () => {
  // identity rotation, translation (0, 0.72, 0)
  const e = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0.72, 0, 1];
  const s = screenFromMatrix(e, 0.37, 0.155);
  assert.deepEqual([s.nx, s.ny, s.nz, s.ux, s.uy, s.uz], [0, 0, 1, 0, 1, 0]);
  const end = diveEnd(s);
  const tv = Math.tan((end.fov * Math.PI) / 360), asp = 16 / 9;
  // pinhole projector at the end pose looking down −z
  const project = (x: number, y: number, z: number): [number, number, number] => { const dz = end.z - z; return [(x - end.x) / (dz * tv * asp), (y - end.y) / (dz * tv), 0.5]; };
  const r = screenRectPx(s, project, { left: 0, top: 0, width: 1600, height: 900 });
  assert.ok(r, 'a rect');
  assert.ok(Math.abs(r.left + r.width / 2 - 800) <= 1 && Math.abs(r.top + r.height / 2 - 450) <= 1, JSON.stringify(r));
  assert.ok(r.width >= 1600 * DIVE.fill - 4 || r.height >= 900 * DIVE.fill - 4, 'fills the frame');
});

// m3 fix r1 (reviewer [fun]: every frame of lumen's dive at E3:2 and its end pose were a salmon / brown slab: the lens
// inside the Clawd or its desk). The real desks: bays.ts screen + the seated sitter at its slot.
const real = hqDesks(layout);

test('diveEnd (real desks): the end pose stays out of the sitter and still fills the frame (wider lens)', () => {
  assert.equal(real.length, 18);
  for (const d of real) {
    const a = { x: d.slot.pos.x, y: 0, z: d.slot.pos.z };
    const e = diveEnd(d.screen, {}, a);
    assert.ok(clearance(e, a, deskBox(d.desk)) >= DIVE.pad - 1e-6, `${d.slot.id}: end clear of body / desk (${clearance(e, a, deskBox(d.desk)).toFixed(3)})`);
    assert.ok(e.fov >= DIVE.fovEnd && e.fov <= DIVE.fovMax, `${d.slot.id}: fov ${e.fov.toFixed(1)}`);
    const tv = Math.tan((e.fov * Math.PI) / 360);
    const fill = Math.max((d.screen.h / 2) / (e.d * tv), (d.screen.w / 2) / (e.d * tv * DIVE.aspect));
    assert.ok(fill >= DIVE.fill - 1e-3, `${d.slot.id}: screen fills ${fill.toFixed(2)}`);
    // the old end (no sitter) was inside the body capsule
    assert.ok(clearance(diveEnd(d.screen), a, null) < 0, `${d.slot.id}: fixture reproduces the old bug`);
  }
});

test('diveTrack (real desks): from any side, no frame of the track is inside the sitter or its desk', () => {
  for (const d of real) {
    const a = { x: d.slot.pos.x, y: 0, z: d.slot.pos.z }, box = deskBox(d.desk);
    for (let k = 0; k < 16; k++) {
      const th = (k / 16) * Math.PI * 2;
      const f = { x: a.x + Math.sin(th) * 1.9, y: 1.2, z: a.z + Math.cos(th) * 1.9, yaw: th, pitch: -0.2, fov: 60 };
      if (clearance(f, a, box) < 0.3) continue; // the player can't stand in the desk
      const tr = diveTrack(f, d.screen, a, { desk: box });
      let worst = Infinity;
      for (let i = 3; i <= 120; i++) worst = Math.min(worst, clearance(tr.at(i / 120), a, box));
      assert.ok(worst >= 0, `${d.slot.id} from ${(th * 180 / Math.PI).toFixed(0)}°: clearance ${worst.toFixed(3)} m`);
    }
  }
});

test('dive hold: a narrow drawer strip widens the lens instead of backing into the sitter', () => {
  const d = real[2], a = { x: d.slot.pos.x, y: 0, z: d.slot.pos.z };
  const end = diveEnd(d.screen, {}, a);
  const held = diveEnd(d.screen, { aspect: 725 / 900, fill: DIVE.holdFill, fovMax: DIVE.fovHoldMax }, a);
  assert.ok(held.d <= end.d + 1e-9, `no pull-back (${held.d.toFixed(3)} vs ${end.d.toFixed(3)})`);
  assert.ok(held.fov > end.fov && held.fov <= DIVE.fovHoldMax, `fov ${held.fov.toFixed(1)}`);
  assert.ok(clearance(held, a, deskBox(d.desk)) >= 0);
});
