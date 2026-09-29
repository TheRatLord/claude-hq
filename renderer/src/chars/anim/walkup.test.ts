// [CHR M3.5] Walk-up-and-manage character work: viewer maths, viewer-aimed reactions, the walk-up face turn, the dash
// gait, the arrival crate and the chained catch → read. Owner: CHR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRig } from '../rig/clawd.ts';
import * as THREE from 'three';
import { createAnimator, FACE_TURN, DASH_IN, SEAT_TILT, SWIVEL_BACK, SWIVEL_MIN, SWIVEL_MAX, SWIVEL_LEAN, SWIVEL_PERK } from './animator.ts';
import { VIEWER, setViewer, viewerRel } from './viewer.ts';
import { REACTIONS, PAT_TURN, PAT_EYES } from './reactions.ts';
import { M } from './pose.ts';
import { SEAT_OFF, grepTilt, grepBookH, GREP_TOME } from './activities/common.ts';
import { ACTIVITIES as ACT } from './activities/index.ts';
import { BOOK_LOW_Y } from './activities/desk.ts';
import { CH, createPose } from './pose.ts';
import { portraitKey } from '../render/portraits.ts';
import type { ClawdRig } from '../rig/clawd.ts';
import type { ClawdAnimator } from './animator.ts';
import type { Activity } from './activities/index.ts';
import type { Vec3Like } from '../../fx/types.ts';

const STEP = 1 / 60;
const run = (anim: ClawdAnimator, secs: number, fn?: (t: number) => void) => { for (let t = 0; t < secs; t += STEP) { fn?.(t); anim.update(STEP, 0); } };
const make = (seed = 'walkup') => { const rig = createRig({ kind: 'claude', seedKey: seed, colorIndex: 0 }); return { rig, anim: createAnimator(rig, { seedKey: seed }) }; };
/** Place a rig facing world yaw `yaw` (actors: rotation.y = yaw + π; here the model's +z is its facing). */
const face = (rig: ClawdRig, x: number, z: number, rotY: number) => { rig.root.position.set(x, 0, z); rig.root.rotation.y = rotY; };

test('viewerRel: ahead = 0, the model\'s +x side = +π/2, behind = ±π, whatever the root yaw', () => {
  const o = { d: 0, rel: 0 };
  setViewer({ x: 0, y: 1.2, z: 3 });
  assert.ok(Math.abs(viewerRel(0, 0, 0, o).rel) < 1e-9); assert.ok(Math.abs(o.d - 3) < 1e-9);
  setViewer({ x: 3, y: 1.2, z: 0 });
  assert.ok(Math.abs(viewerRel(0, 0, 0, o).rel - Math.PI / 2) < 1e-9);
  setViewer({ x: 0, y: 1.2, z: -3 });
  assert.ok(Math.abs(Math.abs(viewerRel(0, 0, 0, o).rel) - Math.PI) < 1e-9);
  // a root turned to face +x sees a viewer at +x straight ahead
  setViewer({ x: 5, y: 1.2, z: 1 });
  assert.ok(Math.abs(viewerRel(1, 1, Math.PI / 2, o).rel) < 1e-9);
  setViewer(null);
  assert.equal(VIEWER.on, false);
});

test('glanceBack swivels ≥ 90° toward a player behind, then back; lookBackWave stays ≤ 120° and waves on the player side', () => {
  for (const side of [1, -1]) {
    const p = createPose();
    const rel = side * 2.8;
    let peak = 0;
    for (let t = 0; t <= REACTIONS.glanceBack.dur; t += 1 / 60) { p.f.fill(0); REACTIONS.glanceBack.update(t, p, { viewRel: rel, amp: 1 }); peak = Math.max(peak, side * p.f[CH.twist]); }
    assert.ok(peak > Math.PI / 2, `glanceBack turns past 90° toward the player (${peak.toFixed(2)})`);
    p.f.fill(0); REACTIONS.glanceBack.update(REACTIONS.glanceBack.dur, p, { viewRel: rel });
    assert.ok(Math.abs(p.f[CH.twist]) < 0.05, 'and ends facing the desk again');
    let lb = 0, armUp = 0;
    for (let t = 0; t <= REACTIONS.lookBackWave.dur; t += 1 / 60) {
      p.f.fill(0); REACTIONS.lookBackWave.update(t, p, { viewRel: side * 3, amp: 1 });
      lb = Math.max(lb, Math.abs(p.f[CH.twist]));
      armUp = Math.max(armUp, side > 0 ? p.f[CH.aRr] : p.f[CH.aLr]);
    }
    assert.ok(lb <= (120 * Math.PI) / 180 + 1e-6 && lb > 1.2, `lookBackWave head yaw ${lb.toFixed(2)} ≤ 120°`);
    assert.ok(armUp > 2.3, 'the wave is on the player side, up over the shoulder');
  }
  assert.equal(REACTIONS.lookBackWave.dur, 1.2);
});

// [CHR fix m3-r3] Reviewer art: the 0.44 rad head turn left the face behind the monitor in 5 of 7 desk walk-ups. The
// worker now swivels its chair toward the player's side, rolls back and out, and leans / perks up. Geometry: an E-bay
// desk (world/layout/hq.ts + proto.ts deskLocal, m 1 row 1): the monitor 0.74 m in front of the slot, 0.17 m to one
// side (either, the animator does not know which), 0.42 m wide, 0.57–0.77 m high.
const MON = { z: 0.74, y0: 0.57, y1: 0.77, w: 0.42 };
const behindMonitor = (e: Vec3Like, p: Vec3Like, mx: number) => {
  if ((e.z - MON.z) * (p.z - MON.z) > 0) return false;
  const t = (MON.z - e.z) / (p.z - e.z), x = e.x + (p.x - e.x) * t, y = e.y + (p.y - e.y) * t;
  return Math.abs(x - mx) < MON.w / 2 && y > MON.y0 && y < MON.y1;
};
const facePoints = (rig: ClawdRig) => {
  rig.root.updateMatrixWorld(true);
  const mouth = rig.nodes.faceRoot.getObjectByName('mouth');
  assert.ok(mouth);
  return [...rig.face.eyes.map((q) => q.node.getWorldPosition(new THREE.Vector3())), mouth.getWorldPosition(new THREE.Vector3())];
};

test('[CHR fix m3-r3] walk-up swivel-out: 70–90° toward a side player, rolled back + out, whole face clear of the monitor', () => {
  for (const act of ['type', 'pencilEdit', 'readBook', 'grepMagnify', 'dishWeb', 'clipboard']) for (const deg of [0, 20, 40, 60, 80]) for (const sg of [1, -1]) {
    setViewer(null);
    const { rig, anim } = make(`sw-${act}-${deg}`);
    face(rig, 0, 0, 0);
    const t = (sg * deg * Math.PI) / 180, eye = new THREE.Vector3(2 * Math.sin(t), 1.2, 2 * Math.cos(t));
    setViewer(eye);
    anim.setAction(act);
    run(anim, 2);
    let hid = 0, n = 0;
    run(anim, 3, () => { const pts = facePoints(rig); n++; for (const mx of [0.17, -0.17]) if (pts.some((p) => behindMonitor(eye, p, mx))) { hid++; break; } });
    const tag = `${act} at ${sg * deg}°`;
    assert.equal(hid, 0, `${tag}: eyes + mouth never behind the monitor (${hid}/${n} frames)`);
    const tw = rig.nodes.hips.rotation.y, hp = rig.nodes.hips.position, base = rig.nodes.hips.userData.base.p;
    assert.ok(hp.z - base.z < -SWIVEL_BACK + 0.08, `${tag}: rolled back (${(hp.z - base.z).toFixed(2)} m)`);
    if (deg >= 40) {
      assert.ok(sg * tw > SWIVEL_MIN - 0.08 && sg * tw < Math.PI / 2 + 0.05, `${tag}: swivel ${(tw * 180 / Math.PI).toFixed(0)}° is 70–90° toward the player`);
      assert.ok(sg * (hp.x - base.x) > 0.05, `${tag}: rolled out toward the player's side`);
    } else assert.ok(Math.abs(hp.x - base.x) > 0.2, `${tag}: straight across the desk it rolls out sideways round the monitor`);
    assert.ok(anim.debug.swivel > 0.9, `${tag}: debug.swivel`);
  }
  setViewer(null);
});

test('[CHR carryover m3] an idle / done agent lounging at its own desk swivels out too (never on a sofa)', () => {
  const cases: [string, string, boolean][] = [['lounge', 'desk', true], ['sitIdle', 'desk', true], ['lounge', 'sofa', false]];
  for (const [act, tag, want] of cases) {
    setViewer(null);
    const { rig, anim } = make(`sw-idle-${act}-${tag}`);
    face(rig, 0, 0, 0);
    anim.setSeat({ tag, yaw: 0 });
    anim.setAction(act);
    const eye = new THREE.Vector3(1.4, 1.2, 1.4);
    setViewer(eye);
    run(anim, 4);
    if (want) {
      assert.ok(anim.debug.swivel > 0.9, `${act} at a ${tag}: swivels out (${anim.debug.swivel})`);
      let hid = 0;
      run(anim, 2, () => { const pts = facePoints(rig); for (const mx of [0.17, -0.17]) if (pts.some((q) => behindMonitor(eye, q, mx))) { hid++; break; } });
      assert.equal(hid, 0, `${act} at a desk: eyes + mouth never behind the monitor`);
    } else assert.equal(anim.debug.swivel, 0, `${act} on a ${tag}: no chair to swivel`);
  }
  setViewer(null);
});

test('[CHR fix m3-r3] swivel-out: the typing hands leave the keys, desk props stay on the desk, it swivels back when the player leaves', () => {
  setViewer(null);
  const { rig, anim } = make('sw-back');
  face(rig, 0, 0, 0);
  anim.setAction('grepMagnify');
  setViewer({ x: 30, y: 1.2, z: 30 });
  run(anim, 2);
  rig.root.updateMatrixWorld(true);
  const pr = rig.props.grep.root, home = pr.getWorldPosition(new THREE.Vector3());
  const twist0 = rig.nodes.hips.rotation.y;
  setViewer({ x: 1.4, y: 1.2, z: 1.4 });
  run(anim, 3);
  rig.root.updateMatrixWorld(true);
  assert.ok(rig.nodes.hips.rotation.y > 1.1, 'swivelled');
  // (carried by the swivelled body it would sit ≈ 0.45 m off to the side; the activity's own lean + "found!" hop still
  // bob it in y / z as they did before the swivel)
  const now = pr.getWorldPosition(new THREE.Vector3());
  assert.ok(Math.abs(now.x - home.x) < 0.04 && Math.abs(now.z - home.z) < 0.16, `the grep tome stays on the desk (${now.x.toFixed(2)}, ${now.z.toFixed(2)})`);
  const hands = rig.arms.map((a) => a.hand.getWorldPosition(new THREE.Vector3()));
  assert.ok(hands.every((h) => h.distanceTo(now) > 0.15), 'the hands have left the lens / keys');
  assert.ok(Math.abs(rig.props.grep.root.rotation.y + rig.nodes.hips.rotation.y - twist0) < 0.25, 'and keeps facing the chair');
  // walks off: past SWIVEL_OUT it swivels and rolls back in
  setViewer({ x: 2.6, y: 1.2, z: 2.6 });
  run(anim, 3);
  assert.ok(Math.abs(rig.nodes.hips.position.z - rig.nodes.hips.userData.base.p.z) < 0.1 + 1e-6, 'rolled back to the desk');
  assert.ok(Math.abs(rig.nodes.hips.rotation.y - twist0) < 0.1, `swivelled back (${rig.nodes.hips.rotation.y.toFixed(2)})`);
  assert.equal(anim.debug.swivel, 0);
  setViewer(null);
});

test('[CHR fix m3-r3] swivel-out is one worker\'s: the one in the middle of the view; a nearer neighbour at the edge only turns its head', () => {
  setViewer(null);
  const A = make('sw-a'), B = make('sw-b');
  face(A.rig, 0, 0, 0); face(B.rig, 1.1, 0, 0);
  A.anim.setAction('type'); B.anim.setAction('type');
  // the player 2.1 m in front of A, looking at A; B (its neighbour, 1.1 m to the side) is nearer to the player
  setViewer({ x: 0.9, y: 1.2, z: 1.9 }, { x: -0.9, y: -0.3, z: -1.9 });
  for (let i = 0; i < 180; i++) { A.anim.update(STEP, 0); B.anim.update(STEP, 0); }
  assert.ok(A.anim.debug.swivel > 0.9, 'A (looked at) swivels out');
  assert.equal(B.anim.debug.swivel, 0, 'B does not');
  assert.ok(Math.abs(B.rig.nodes.hips.rotation.y) < FACE_TURN * 1.3 + 0.1, 'B keeps the mild head turn');
  assert.ok(Math.abs(B.rig.nodes.hips.position.x - B.rig.nodes.hips.userData.base.p.x) < 0.05, 'B stays at its desk');
  setViewer(null);
});

test('walk-up: nothing at 3 m, nothing when the player is behind (BRN plays glanceBack); the non-holder turn stays ~25°', () => {
  const twistAt = (vx: number, vz: number) => {
    setViewer(null);
    const { rig, anim } = make('typist');
    face(rig, 0, 0, 0);
    setViewer({ x: vx, y: 1.2, z: vz });
    anim.setAction('type');
    run(anim, 3);
    return rig.nodes.hips.rotation.y;
  };
  const baseline = twistAt(0, 30);
  assert.ok(Math.abs(twistAt(2.3, 2.1) - baseline) < 0.05, 'nothing at 3.1 m');
  assert.ok(Math.abs(twistAt(0.2, -1.2) - baseline) < 0.05, 'nothing when the player is behind');
  setViewer(null);
});

test('dash gait: over DASH_IN m/s the animator dashes (leaning, smeared) and counts footfalls', () => {
  const { rig, anim } = make('dasher');
  face(rig, 0, 0, 0);
  anim.setLocomotion(1.0); run(anim, 1);
  assert.equal(anim.dashing, false);
  const s0 = anim.steps;
  anim.setLocomotion(DASH_IN + 0.8); run(anim, 1.5);
  assert.equal(anim.dashing, true);
  assert.ok(anim.steps - s0 >= 6, `footfalls counted (${anim.steps - s0})`);
  assert.ok(rig.nodes.hips.rotation.x > 0.25, 'leans into the sprint');
  assert.equal(rig.smear, 1, 'smears the whirling legs');
  anim.setLocomotion(0); run(anim, 1.5);
  assert.equal(anim.dashing, false);
});

test('crateUnwrap shows the root-level crate, opens it, and it is gone when the reaction ends', () => {
  const { rig, anim } = make('crate');
  face(rig, 0, 0, 0);
  anim.react('crateUnwrap');
  run(anim, 0.5);
  assert.equal(rig.crate.root.visible, true, 'crate shown while the Clawd is inside');
  assert.ok(rig.crate.walls[0].rotation.x < 0.05, 'closed');
  run(anim, 0.9);
  assert.ok(rig.crate.walls[0].rotation.x > 1.2, 'walls fallen open');
  assert.ok(rig.crate.lids[0].rotation.x > 1.5, 'lid flaps burst open');
  run(anim, 1.3);
  assert.equal(rig.crate.root.visible, false, 'gone at the end');
  assert.equal(rig.crate.root.parent, rig.root, 'on the root (stays on the floor while the body hops)');
});

test('catchPlane chains into readNote; the note prop is held, unfolded, then tucked away', () => {
  const { rig, anim } = make('reader');
  face(rig, 0, 0, 0);
  anim.react('catchPlane');
  run(anim, 0.8);
  assert.equal(rig.props.note.root.visible, true, 'caught');
  run(anim, 0.8);
  assert.equal(anim.reacting, 'readNote', 'flows into readNote');
  run(anim, 1.0);
  assert.equal(rig.props.note.root.visible, true, 'reading');
  run(anim, 1.6);
  assert.equal(anim.reacting, null);
  assert.equal(rig.props.note.root.visible, false, 'tucked away');
});

test('patted keeps the typing arms (body + face only) and blushes', () => {
  assert.equal(REACTIONS.patted.mask & (2 | 4), 0);
  const p = createPose();
  REACTIONS.patted.update(0.15, p, {});
  assert.ok(p.f[CH.sq] < -0.25, 'squished');
  assert.equal(p.f[CH.blush], 1);
});

test('portraitKey changes with what the portrait shows, not with activity churn', () => {
  const e = { id: 'a', kind: 'claude', status: 'working', workspace: { colorIndex: 2 }, seedKey: 's', activity: { tool: 'Edit' } };
  const k = portraitKey(e);
  const churned = { ...e, activity: { tool: 'Bash' }, title: 'x' };
  assert.equal(portraitKey(churned), k);
  assert.notEqual(portraitKey({ ...e, status: 'blocked' }), k);
  assert.notEqual(portraitKey({ ...e, workspace: { colorIndex: 3 } }), k);
  assert.notEqual(portraitKey({ ...e, status: 'done', ack: true }), portraitKey({ ...e, status: 'done' }));
});

test('[CHR fix m3-r1] seated + turned toward a player (walk-up turn, glances): pelvis pinned to the seat, tilt ≤ SEAT_TILT (swivel lean), twist ≤ SWIVEL_MAX', () => {
  for (const act of ['type', 'pencilEdit', 'grepMagnify', 'readBook']) for (const side of [1, -1]) for (const react of [null, 'glanceBack', 'patted', 'lookBackWave']) {
    const { rig, anim } = make(`pin-${act}`);
    face(rig, 0, 0, 0);
    // the lumen walk-up (code review m3-r1): the player 1.3 m away, 130° round behind the desk-facing body
    setViewer({ x: side * 1.3 * Math.sin(2.27), y: 1.2, z: 1.3 * Math.cos(2.27) });
    anim.setAction(act);
    run(anim, 1.5);
    if (react) anim.react(react);
    const base = rig.nodes.hips.userData.base.p.y;
    let worstTilt = 0, maxTwist = 0, lo = 9, hi = -9;
    run(anim, 2.2, () => {
      const r = rig.nodes.hips.rotation;
      maxTwist = Math.max(maxTwist, Math.abs(r.y));
      if (Math.abs(r.y) >= 0.3) {
        worstTilt = Math.max(worstTilt, Math.abs(r.x), Math.abs(r.z));
        const y = rig.nodes.hips.position.y - base - SEAT_OFF;
        lo = Math.min(lo, y); hi = Math.max(hi, y);
      }
    });
    const tag = `${act} ${react ?? 'walk-up'} side ${side}`;
    // [CHR fix m3-r3] the walk-up swivel-out (this player is inside SWIVEL_IN, 130° round) leans toward the player
    // (≤ SWIVEL_LEAN·1.4) and swivels up to SWIVEL_MAX; the glance reactions keep their SEAT_TWIST cap on top of it
    assert.ok(worstTilt <= Math.max(SEAT_TILT, SWIVEL_LEAN * 1.4) + 1e-6, `${tag}: tilt ${worstTilt.toFixed(3)} while turned`);
    assert.ok(maxTwist <= SWIVEL_MAX + 1e-6, `${tag}: twist ${maxTwist.toFixed(2)}`);
    if (lo < 9) assert.ok(lo >= -0.03 - 1e-6 && hi <= 0.06 + SWIVEL_PERK + 1e-6, // [CHR fix m3-r3] + the swivel's perk-up
      `${tag}: hips ${lo.toFixed(3)}…${hi.toFixed(3)} m off the seat`);
  }
  setViewer(null);
});

test('[CHR fix m3-r1] patted: a squash + happy ^_^ glance over the shoulder (≤ 40° with the eyes), body + face only (keeps typing)', () => {
  assert.equal(REACTIONS.patted.mask & M.ARMS, 0, 'the typing arms are untouched');
  assert.ok(PAT_TURN + PAT_EYES * 0.5 <= (40 * Math.PI) / 180 + 0.05, 'head yaw budget');
  for (const rel of [2.8, -2.8, 1.0, 0.2]) {
    const p = createPose();
    let tw = 0, sq = 0, arc = false;
    for (let t = 0; t <= REACTIONS.patted.dur; t += 1 / 60) {
      p.f.fill(0); p.eye = null; REACTIONS.patted.update(t, p, { viewRel: rel, amp: 1, seated: true });
      tw = Math.max(tw, Math.sign(rel) * p.f[CH.twist]);
      sq = Math.min(sq, p.f[CH.sq]);
      arc ||= p.eye === 'arc';
      assert.ok(Math.abs(p.f[CH.twist]) <= PAT_TURN * 1.12, `rel ${rel}: twist ${p.f[CH.twist].toFixed(2)}`);
    }
    assert.ok(tw > Math.min(Math.abs(rel), PAT_TURN) * 0.8, `rel ${rel}: glances toward the player (${tw.toFixed(2)})`);
    assert.ok(sq < -0.2 && arc, 'squash + ^_^ eyes');
  }
});

test('[CHR fix m3-r3] walk-up: readBook lowers the book under the eyes and peeks over it; the grep tome lies down; the clipboard drops', () => {
  const EYES = 0.27 + 0.08; // shape frame: face root at BODY_H / 2, eyes EYE_Y above it (rig/face.ts)
  const sample = (def: Activity, viewD: number, swivel = 0) => {
    const p = createPose(), rows = [];
    for (let t = 0; t < 9; t += 1 / 30) {
      p.f.fill(0); p.prop = null;
      def.update(t, p, { viewD, viewRel: 0.6, swivel, seed: 7, amp: 1, energy: 1, dt: 1 / 30 }); // (dt: no activity reads it)
      rows.push({ y: p.f[CH.propY], z: p.f[CH.propZ], rx: p.f[CH.propRx], a: p.f[CH.propA], lookX: p.f[CH.lookX] });
    }
    return rows;
  };
  // the book is 0.22 m tall: its top edge = centre + 0.11·|cos rx| (rx from the upright)
  const top = (r: { y: number; rx: number }) => r.y + 0.11 * Math.abs(Math.cos(r.rx));
  const far = sample(ACT.readBook, 8), near = sample(ACT.readBook, 1.8), lap = sample(ACT.readBook, 1.8, 1);
  assert.ok(far.some((r) => r.y > BOOK_LOW_Y + 0.2), 'far: still held up high (reads over the monitor from across the room)');
  assert.ok(near.every((r) => top(r) < EYES - 0.02), `near: the book's top edge stays under the eyes (${Math.max(...near.map(top)).toFixed(2)})`);
  assert.ok(lap.every((r) => top(r) < EYES - 0.15), 'swivelled out: down in the lap, under the mouth too');
  assert.ok(near.filter((r) => r.lookX > 0.4).length > near.length * 0.5, 'and peeks over it at the player most of the time');
  // grep: the tome (DESK_Y + spine + half the tome) no longer stands in front of the eyes
  const tomeTop = (a: number) => { const f = new Float32Array(CH.propC + 1); f[CH.propA] = a; const tl = grepTilt(f); return 0.22 + grepBookH(tl) + 0.11 * GREP_TOME * Math.cos(tl); };
  assert.ok(tomeTop(0) > EYES + 0.05, 'far: the tome stands propped up (reads from the aisle)');
  const gn = sample(ACT.grepMagnify, 1.8);
  assert.ok(gn.every((r) => r.a > 0.99) && tomeTop(1) < EYES - 0.04, `near: laid down (top ${tomeTop(1).toFixed(2)} m)`);
  const cf = sample(ACT.clipboard, 8), cn = sample(ACT.clipboard, 1.8);
  assert.ok(cn[0].y < cf[0].y - 0.05 && cn[0].rx < cf[0].rx - 0.3, 'clipboard: lower and tipped back');
});
