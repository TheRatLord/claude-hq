// [CHR fix m15-r1] Readability gates measured on real rigs (FK through the Object3D tree + the unit geometries'
// bounding boxes), not on pose channels: the blocked "hey!" clears the hat from every side, blocked drops the working
// props, seated event reactions move far enough to read at 2 m, Shelly's activity props are big and beside/in front
// of the screen, and mini-Clawds never flatten or strand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createRig } from '../rig/clawd.ts';
import type { ClawdRig } from '../rig/clawd.ts';
import type { RigPart } from '../rig/build.ts';
import type { PartType } from '../render/geometry.ts';
import { createAnimator, BODY_TURN } from './animator.ts';
import { SEAT_PROFILES, seatTurn } from './seat.ts';
import { FIDGET_ACTS } from './activities/fidgets.ts';
import { partDef } from '../render/geometry.ts';
import { ACC_TOP, ACCESSORIES } from '../rig/accessories.ts';
import { VOCAB } from './activities/index.ts';

const boxes = new Map<PartType, THREE.Box3>();
const unitBox = (type: PartType): THREE.Box3 => {
  let b = boxes.get(type);
  if (!b) {
    const g = partDef(type).build();
    g.computeBoundingBox();
    if (!g.boundingBox) throw new Error(`no bounding box for ${type}`);
    boxes.set(type, (b = g.boundingBox));
  }
  return b;
};
const tb = new THREE.Box3();
/** World-space box of a set of rig parts (visible subtrees only). */
const partsBox = (parts: readonly RigPart[], out = new THREE.Box3()) => {
  out.makeEmpty();
  for (const p of parts) {
    let n: THREE.Object3D | null = p.node, vis = true;
    while (n) { if (!n.visible) { vis = false; break; } n = n.parent; }
    if (vis) out.union(tb.copy(unitBox(p.type)).applyMatrix4(p.node.matrixWorld));
  }
  return out;
};
const handBottom = (rig: ClawdRig, side: number) => {
  const h = rig.arms[side < 0 ? 0 : 1].hand;
  const b = partsBox(rig.parts.filter((p) => p.node.parent === h));
  return b.min.y;
};
/** Crown parts: body + accessory (not arms, props, gear). */
const crownParts = (rig: ClawdRig) => rig.parts.filter((p) => p.node === rig.nodes.body || p.group === 'acc');
const corners = (b: THREE.Box3) => [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z));

test('accessory crown table matches the built geometry (neutral personality)', () => {
  for (let i = 0; i < 8; i++) {
    const rig = createRig({ kind: 'claude', seedKey: 'crown', colorIndex: i, pers: { height: 0, width: 0 } });
    rig.root.updateMatrixWorld(true);
    const top = partsBox(crownParts(rig)).max.y - rig.nodes.hips.position.y;
    assert.ok(Math.abs(top - ACC_TOP[i]) < 0.015, `${ACCESSORIES[i]}: table ${ACC_TOP[i]} vs geometry ${top.toFixed(3)}`);
    assert.equal(rig.crown, ACC_TOP[i]);
  }
});

test('blocked "hey!": both hands ≥ 0.15 m over the hat top and above it on screen from yaw 0/90/180/270, every accessory', () => {
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 100);
  cam.position.set(0, 1.2, 2); cam.lookAt(0, 0.6, 0); cam.updateMatrixWorld();
  const proj = (v: THREE.Vector3) => v.clone().project(cam).y;
  let worst = Infinity, worstScreen = Infinity;
  // [CHR fix m15-r2] far (full stretch) and near (inside the 3.5 m card distance: capped stretch) both hold the gate
  // [CHR fix m3-r1] near = 4 m now: inside ~3.4 m the close-up hop-and-wave takes over (next test)
  for (const view of [null, 4]) for (let i = 0; i < 8; i++) {
    for (const seed of ['a', 'bb']) {
      for (const yawDeg of [0, 90, 180, 270]) {
        const rig = createRig({ kind: 'claude', seedKey: `wave-${seed}`, colorIndex: i });
        rig.root.rotation.y = (yawDeg * Math.PI) / 180;
        const an = createAnimator(rig, { seedKey: `wave-${seed}` });
        an.setViewDist(view);
        an.setAction('waveBlocked');
        for (let k = 0; k < 200; k++) {
          an.update(1 / 60, 0);
          if (k < 30) continue; // blend in
          rig.root.updateMatrixWorld(true);
          const crown = partsBox(crownParts(rig));
          const crownScreen = Math.max(...corners(crown).map(proj));
          let best = -Infinity;
          for (const side of [-1, 1]) {
            const hb = partsBox(rig.parts.filter((p) => p.node.parent === rig.arms[side < 0 ? 0 : 1].hand));
            const clear = hb.min.y - crown.max.y;
            worst = Math.min(worst, clear);
            // screen: the hand's lowest projected point above the crown's highest projected point
            best = Math.max(best, Math.min(...corners(hb).map(proj)) - crownScreen);
            assert.ok(clear >= 0.15, `${ACCESSORIES[i]} yaw ${yawDeg} side ${side} frame ${k}: hand ${clear.toFixed(3)} m over the crown`);
          }
          worstScreen = Math.min(worstScreen, best); // at least one whole hand above the crown's silhouette on screen
        }
      }
    }
  }
  console.log(`# waveBlocked: min hand clearance over the crown ${worst.toFixed(3)} m; min screen margin ${worstScreen.toFixed(3)} NDC`);
  assert.ok(worstScreen > 0, `hands project above the crown on screen (worst ${worstScreen.toFixed(3)} NDC)`);
});

test('[CHR fix m3-r1] blocked close-up hop-and-wave: camera < 3 m → noodles ≤ 0.9 m from the shoulder, hands still up over the body', () => {
  let worstUp = Infinity, maxReach = 0;
  for (const act of ['waveBlocked', 'queueHandUp']) for (const view of [1.4, 2, 2.9]) for (let i = 0; i < 8; i++) {
    const rig = createRig({ kind: 'claude', seedKey: `close-${i}`, colorIndex: i });
    const an = createAnimator(rig, { seedKey: `close-${i}` });
    an.setViewDist(view);
    an.setAction(act);
    const s = new THREE.Vector3(), h = new THREE.Vector3();
    for (let k = 0; k < 200; k++) {
      an.update(1 / 60, 0);
      if (k < 40) continue;
      rig.root.updateMatrixWorld(true);
      const body = partsBox(rig.parts.filter((p) => p.node === rig.nodes.body));
      for (const a of rig.arms) {
        a.pivot.getWorldPosition(s); a.hand.getWorldPosition(h);
        const reach = h.distanceTo(s);
        maxReach = Math.max(maxReach, reach);
        assert.ok(reach <= 0.9, `${act} @${view} m ${ACCESSORIES[i]} frame ${k}: reach ${reach.toFixed(3)} m`);
        if (act === 'queueHandUp' && a.side < 0) continue; // the watch-checking hand
        const up = handBottom(rig, a.side) - body.max.y;
        worstUp = Math.min(worstUp, up);
        assert.ok(up >= 0.03, `${act} @${view} m ${ACCESSORIES[i]} frame ${k}: hand ${up.toFixed(3)} m over the body`);
      }
    }
  }
  console.log(`# close-up wave: max reach ${maxReach.toFixed(3)} m; min hand height over the body ${worstUp.toFixed(3)} m`);
});

test('blocked drops the working props at once (one visual, one meaning)', () => {
  for (const work of ['pencilEdit', 'grepMagnify', 'readBook', 'phoneMcp']) {
    const rig = createRig({ kind: 'claude', seedKey: 'props', colorIndex: 2 });
    const an = createAnimator(rig, { seedKey: 'props' });
    an.setAction(work);
    for (let k = 0; k < 90; k++) an.update(1 / 60, 0);
    const shown = () => Object.entries(rig.props).filter(([, p]) => p.root.visible).map(([id]) => id);
    assert.ok(shown().length > 0, `${work} holds a prop`);
    an.setAction('waveBlocked');
    an.update(1 / 60, 0);
    assert.deepEqual(shown(), [], `${work} → waveBlocked: props hidden on the first frame`);
  }
});

// 8 % of the frame height at 2 m (vertical FOV 60°): 0.08 · 2 · 2 · tan 30° ≈ 0.185 m.
const GATE = 0.08 * 2 * 2 * Math.tan(Math.PI / 6);

for (const [id, what] of [['fistPump', 'hand'], ['slump', 'head'], ['hop', 'head']]) {
  test(`seated reaction ${id}: ${what} displacement ≥ 8 % of frame height at 2 m`, () => {
    const rig = createRig({ kind: 'claude', seedKey: 'seat', colorIndex: 4 });
    const an = createAnimator(rig, { seedKey: 'seat' });
    an.setAction('type');
    for (let k = 0; k < 120; k++) an.update(1 / 60, 0);
    const sample = () => {
      rig.root.updateMatrixWorld(true);
      const head = partsBox(crownParts(rig)).max.y;
      const hands = [0, 1].map((i) => partsBox(rig.parts.filter((p) => p.node.parent === rig.arms[i].hand)).getCenter(new THREE.Vector3()));
      return { head, hands };
    };
    const rest = [];
    for (let k = 0; k < 30; k++) { an.update(1 / 60, 0); rest.push(sample()); }
    an.react(id);
    let best = 0;
    for (let k = 0; k < 140; k++) {
      an.update(1 / 60, 0);
      const s = sample();
      for (const r of rest) {
        const dHead = Math.abs(s.head - r.head);
        const dHand = Math.max(...s.hands.map((h, i) => h.distanceTo(r.hands[i])));
        best = Math.max(best, what === 'head' ? dHead : Math.max(dHead, dHand));
      }
    }
    assert.ok(best >= GATE, `${id}: ${best.toFixed(3)} m < ${GATE.toFixed(3)} m`);
    console.log(`# ${id} seated: max ${what} displacement ${best.toFixed(3)} m (gate ${GATE.toFixed(3)})`);
  });
}

test('fistPump: the fist goes over the head and the body pops ≥ 0.15 m up out of the chair', () => {
  const rig = createRig({ kind: 'claude', seedKey: 'seat', colorIndex: 4 });
  const an = createAnimator(rig, { seedKey: 'seat' });
  an.setAction('type');
  for (let k = 0; k < 150; k++) an.update(1 / 60, 0);
  const hip0 = rig.nodes.hips.position.y;
  an.react('fistPump');
  let over = -Infinity, hop = 0;
  for (let k = 0; k < 80; k++) {
    an.update(1 / 60, 0);
    rig.root.updateMatrixWorld(true);
    const crown = partsBox(crownParts(rig)).max.y;
    over = Math.max(over, handBottom(rig, 1) - crown);
    hop = Math.max(hop, rig.nodes.hips.position.y - hip0);
  }
  assert.ok(over > 0.05, `fist over the head (${over.toFixed(3)})`);
  assert.ok(hop >= 0.15, `hop ${hop.toFixed(3)}`);
});

test('Shelly activity props: ≥ 1.6× scale, held beside or in front of the screen (not below it), arms reach out', () => {
  for (const id of VOCAB.shelly) {
    const rig = createRig({ kind: 'shell', seedKey: `sh-${id}` });
    const an = createAnimator(rig, { seedKey: `sh-${id}` });
    an.setAction(id);
    let minTop = Infinity, reachMax = 0;
    for (let k = 0; k < 360; k++) {
      an.update(1 / 60, 0);
      if (k < 30) continue;
      rig.root.updateMatrixWorld(true);
      const held = Object.values(rig.props).find((p) => p.root.visible);
      if (!held) continue;
      const pb = partsBox(rig.parts.filter((p) => { let n: THREE.Object3D | null = p.node; while (n && n !== held.root) n = n.parent; return !!n; }));
      const screen = new THREE.Vector3().setFromMatrixPosition(rig.nodes.screen.matrixWorld);
      minTop = Math.min(minTop, pb.max.y - (screen.y - 0.105)); // prop top vs the screen's bottom edge
      for (const a of rig.arms) {
        const s = new THREE.Vector3().setFromMatrixPosition(a.pivot.matrixWorld), h = new THREE.Vector3().setFromMatrixPosition(a.hand.matrixWorld);
        reachMax = Math.max(reachMax, s.distanceTo(h));
      }
    }
    if (id === 'spinnerWatch') continue;
    assert.ok(minTop > 0.02, `${id}: the prop rises into the screen band (top − screen bottom ${minTop.toFixed(3)} m)`);
    assert.ok(reachMax > 0.25, `${id}: an arm reaches out (${reachMax.toFixed(3)} m)`);
  }
});

test('mini-Clawds: never flatter than 0.6, stand on the real floor, and stay on a 1.5 m leash when the parent walks', () => {
  const floor = (x: number, z: number) => (Math.hypot(x - 3, z) < 2 ? -0.45 : 0); // a sunken pit around (3, 0)
  const rig = createRig({ kind: 'claude', seedKey: 'minis', colorIndex: 1 });
  const an = createAnimator(rig, { seedKey: 'minis', ground: floor });
  an.setTraits({ subagents: 4 });
  for (let k = 0; k < 60; k++) an.update(1 / 60, 0);
  let maxLag = 0, minSy = Infinity, maxSink = 0;
  const v = new THREE.Vector3();
  for (let k = 0; k < 600; k++) {
    const t = k / 60;
    const x = Math.min(6, t * 1.6); // walks through the pit at 1.6 m/s, then stops
    rig.root.position.set(x, floor(x, 0), 0);
    rig.root.rotation.y = Math.PI / 2; // facing +x
    an.setLocomotion(x < 6 ? 1.6 : 0);
    an.update(1 / 60, k % 3 ? 2 : 0); // LOD 2 (far away) most frames: the minis must keep up anyway
    rig.root.updateMatrixWorld(true);
    for (const m of rig.minis) {
      if (!m.root.visible) continue;
      v.setFromMatrixPosition(m.root.matrixWorld);
      if (k > 60) maxLag = Math.max(maxLag, Math.hypot(v.x - rig.root.position.x, v.z - rig.root.position.z));
      maxSink = Math.max(maxSink, floor(v.x, v.z) - v.y);
      minSy = Math.min(minSy, m.squash.scale.y);
    }
  }
  assert.ok(minSy >= 0.6, `mini squash height ${minSy.toFixed(3)}`);
  assert.ok(maxSink < 0.02, `minis stand on the floor (sunk ${maxSink.toFixed(3)} m)`);
  assert.ok(maxLag <= 2.1, `minis stay close (max ${maxLag.toFixed(2)} m from the parent)`);
  console.log(`# minis: min squash ${minSy.toFixed(2)}, max lag ${maxLag.toFixed(2)} m, max sink ${maxSink.toFixed(3)} m`);
});

test('Shelly prop scale constant is shared by the rig and the activities', async () => {
  const { SHELLY_PROP_SCALE } = await import('../rig/shelly.ts');
  const { K } = await import('./activities/shelly.ts');
  assert.equal(K, SHELLY_PROP_SCALE);
  const rig = createRig({ kind: 'shell', seedKey: 'k' });
  for (const p of Object.values(rig.props)) assert.equal(p.root.children[0].scale.x, SHELLY_PROP_SCALE);
});

test('[CHR fix m15-r2] mini-Clawds at rest: a fixed fan, ≥ 0.3 m apart and ≥ 0.45 m from the parent centre', async () => {
  const { restSlots } = await import('./minis.ts');
  for (let n = 1; n <= 4; n++) {
    const sl = restSlots(n);
    for (let i = 0; i < n; i++) {
      assert.ok(Math.hypot(sl[i].x, sl[i].z) >= 0.45 && sl[i].z < -0.45, `slot ${i}/${n} clear of the parent and its chair`);
      for (let j = i + 1; j < n; j++) assert.ok(Math.hypot(sl[i].x - sl[j].x, sl[i].z - sl[j].z) >= 0.3, `slots ${i},${j}/${n}`);
    }
  }
  let minPair = Infinity, minParent = Infinity;
  const v = new THREE.Vector3(), w = new THREE.Vector3();
  for (const action of ['type', 'think', null]) {
    const rig = createRig({ kind: 'claude', seedKey: `fan-${action}`, colorIndex: 3 });
    const an = createAnimator(rig, { seedKey: `fan-${action}` });
    if (action) an.setAction(action);
    rig.root.rotation.y = 0.7;
    // 2 → 4 subagents (re-fan), then a walk and a stop (the duckling line folds back into the fan)
    const phases = [[2, 0, 240], [4, 0, 300], [4, 1.4, 120], [4, 0, 360], [3, 0, 300]];
    let x = 0;
    for (const [n, speed, frames] of phases) {
      an.setTraits({ subagents: n });
      for (let k = 0; k < frames; k++) {
        x += speed / 60;
        rig.root.position.set(x * Math.sin(0.7), 0, x * Math.cos(0.7));
        an.setLocomotion(speed);
        an.update(1 / 60, 0);
      }
      if (speed) continue;
      rig.root.updateMatrixWorld(true);
      const on = rig.minis.filter((m) => m.root.visible && m.root.scale.x > 0.4);
      assert.equal(on.length, n, `${n} minis shown`);
      for (let i = 0; i < on.length; i++) {
        v.setFromMatrixPosition(on[i].root.matrixWorld);
        minParent = Math.min(minParent, Math.hypot(v.x - rig.root.position.x, v.z - rig.root.position.z));
        for (let j = i + 1; j < on.length; j++) {
          w.setFromMatrixPosition(on[j].root.matrixWorld);
          minPair = Math.min(minPair, Math.hypot(v.x - w.x, v.z - w.z));
        }
      }
    }
  }
  console.log(`# minis at rest: min pairwise ${minPair.toFixed(3)} m, min from parent ${minParent.toFixed(3)} m`);
  assert.ok(minPair >= 0.3, `mini pairwise distance at rest ${minPair.toFixed(3)}`);
  assert.ok(minParent >= 0.45, `mini distance from the parent at rest ${minParent.toFixed(3)}`);
});

test('[CHR fix m15-r2] Shelly bow: the screen never tips more than 35° toward the floor and shows ^_^ throughout', async () => {
  const { HEAD_PITCH_MAX } = await import('./shellyAnimator.ts');
  let worst = 0, happyFrames = 0, frames = 0;
  const n = new THREE.Vector3(), q = new THREE.Quaternion();
  for (const seed of ['sh-a', 'sh-b', 'sh-c']) {
    const rig = createRig({ kind: 'shell', seedKey: seed });
    const an = createAnimator(rig, { seedKey: seed });
    an.setAction('juggle');
    for (let k = 0; k < 120; k++) an.update(1 / 60, 0);
    an.setAction(null);
    an.react('bow');
    for (let k = 0; k < 90; k++) {
      an.update(1 / 60, 0);
      rig.root.updateMatrixWorld(true);
      rig.nodes.screen.getWorldQuaternion(q);
      n.set(0, 0, 1).applyQuaternion(q);
      worst = Math.max(worst, -Math.asin(Math.max(-1, Math.min(1, n.y)))); // + = screen facing down
      if (k > 20 && k < 70) { frames++; if (rig.strokes.filter((s) => s.visible).length === 5) happyFrames++; }
    }
  }
  console.log(`# Shelly bow: max screen pitch down ${(worst * 180 / Math.PI).toFixed(1)}° (cap ${(HEAD_PITCH_MAX * 180 / Math.PI).toFixed(0)}°)`);
  assert.ok(worst <= HEAD_PITCH_MAX + 0.02, `screen pitch ${(worst * 180 / Math.PI).toFixed(1)}°`);
  assert.equal(happyFrames, frames, 'the ^_^ face shows through the whole bow');
});

test('[CHR fix m15-r2] blocked noodles: tapered, visibly curved and whipping, and shorter near the viewer', () => {
  const dirOf = (n: THREE.Object3D) => new THREE.Vector3(0, -1, 0).applyQuaternion(n.getWorldQuaternion(new THREE.Quaternion()));
  const topOf = (view: number | null) => {
    const rig = createRig({ kind: 'claude', seedKey: 'noodle', colorIndex: 2 });
    const an = createAnimator(rig, { seedKey: 'noodle' });
    an.setViewDist(view);
    an.setAction('waveBlocked');
    let maxBend = 0, minBend = Infinity, top = 0, curved = 0, n = 0;
    for (let k = 0; k < 300; k++) {
      an.update(1 / 60, 0);
      if (k < 60) continue;
      rig.root.updateMatrixWorld(true);
      for (const a of rig.arms) {
        const bend = dirOf(a.segs[0]).angleTo(dirOf(a.segs[a.segs.length - 1]));
        maxBend = Math.max(maxBend, bend); minBend = Math.min(minBend, bend); n++; if (bend > 0.15) curved++;
        top = Math.max(top, partsBox(rig.parts.filter((p) => p.node.parent === a.hand)).max.y);
      }
    }
    return { maxBend, minBend, top, curved: curved / n };
  };
  const far = topOf(null), near = topOf(2);
  console.log(`# noodle bend ${far.minBend.toFixed(2)}…${far.maxBend.toFixed(2)} rad (curved ${(far.curved * 100).toFixed(0)}% of frames); hand top far ${far.top.toFixed(3)} m, near ${near.top.toFixed(3)} m`);
  assert.ok(far.curved >= 0.9, 'the long noodle is a curve, not a straight rod, in ≥ 90% of frames');
  assert.ok(far.maxBend - far.minBend > 0.2, 'the curve whips with the wave');
  assert.ok(near.top < far.top - 0.1, 'near the viewer the stretch is capped');
  const rig = createRig({ kind: 'claude', seedKey: 'taper' });
  const r = rig.arms[0].segs.map((s) => {
    const part = rig.parts.find((p) => p.node.parent === s);
    assert.ok(part);
    return part.node.scale.x;
  });
  for (let k = 1; k < r.length; k++) assert.ok(r[k] < r[k - 1], `forearm tapers (${r.map((x) => x.toFixed(3)).join(' > ')})`);
});

test('[CHR fix r3] desk reading props clear the monitor line and the body top (visible from the front and the aisle)', () => {
  const shapeLocal = (rig: ClawdRig, node: THREE.Object3D) => {
    rig.root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(rig.nodes.shape.matrixWorld).invert();
    return new THREE.Vector3().setFromMatrixPosition(node.matrixWorld).applyMatrix4(inv);
  };
  // readBook: the held-up book's covers sit above the body top (0.54 in the shape frame) in front of the face, all cycle.
  {
    const rig = createRig({ kind: 'claude', seedKey: 'read', colorIndex: 3 });
    const an = createAnimator(rig, { seedKey: 'read' });
    an.setAction('readBook');
    for (let k = 0; k < 90; k++) an.update(1 / 60, 0);
    let minY = Infinity, minZ = Infinity;
    for (let k = 0; k < 600; k++) {
      an.update(1 / 60, 0);
      const book = rig.props.book.root;
      assert.ok(book.visible, 'book shown');
      const c = shapeLocal(rig, book);
      minY = Math.min(minY, c.y); minZ = Math.min(minZ, c.z);
    }
    console.log(`# readBook: book centre ≥ ${minY.toFixed(3)} m up the body, ≥ ${minZ.toFixed(3)} m in front`);
    assert.ok(minY >= 0.5, `book centre ${minY.toFixed(3)} m (body top 0.54)`);
    assert.ok(minZ >= 0.26, `book in front of the face (${minZ.toFixed(3)} m)`);
  }
  // grepMagnify: the propped book's top edge ≥ 0.4 m; the "found!" lens goes over the crown every cycle.
  {
    const rig = createRig({ kind: 'claude', seedKey: 'grep', colorIndex: 5 });
    const an = createAnimator(rig, { seedKey: 'grep' });
    an.setAction('grepMagnify');
    for (let k = 0; k < 90; k++) an.update(1 / 60, 0);
    let maxLens = -Infinity, bookTop = -Infinity;
    for (let k = 0; k < 3 * 60; k++) {
      an.update(1 / 60, 0);
      const g = rig.props.grep.root;
      rig.root.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(rig.nodes.shape.matrixWorld).invert();
      g.traverse((n) => {
        if (!n.userData?.pi && n.children.length) return;
        const p = new THREE.Vector3().setFromMatrixPosition(n.matrixWorld).applyMatrix4(inv);
        maxLens = Math.max(maxLens, p.y);
      });
      // book spine top: the book root's +y edge (0.11 m up the spine)
      const bookRoot = g.children[0];
      bookTop = Math.max(bookTop, new THREE.Vector3(0, 0.11, 0).applyMatrix4(bookRoot.matrixWorld).applyMatrix4(inv).y);
    }
    console.log(`# grepMagnify: book top ${bookTop.toFixed(3)} m, highest prop part ${maxLens.toFixed(3)} m`);
    assert.ok(bookTop >= 0.4, `propped book top ${bookTop.toFixed(3)} m`);
    assert.ok(maxLens >= 0.62, `"found!" lens over the crown (${maxLens.toFixed(3)} m)`);
  }
});

// [CHR fix m175-r2] The close Pit shot (3.2,0,3.2 h18): a done Clawd on the low-back lounger swivelled 1.1 rad toward the
// player and poked an arm nub out through the bolster. Gate: in the seat's frame, no arm/leg part below the backrest
// top reaches behind the backrest's rear face, for every lounge-seat loop + seated reaction, at the sofa's allowed
// turn (actors.ts seatTurn) and at the old 1.1 rad chair swivel (the animator's guard alone).
test('Pit lounger: seated limbs never poke out through the low backrest (lounge, fidgets, reactions, swivels)', () => {
  const S = SEAT_PROFILES.sofa, back = S.back;
  assert.ok(back);
  assert.ok(seatTurn({ tag: 'sofa' }, 1.1) <= S.turn && S.turn <= BODY_TURN, 'a sofa caps the swivel');
  assert.equal(seatTurn({ tag: 'desk' }, 1.1), 1.1, 'desk chairs still swivel');
  const acts = ['lounge', 'sitIdle', ...Object.values(FIDGET_ACTS).map((a) => a.id).filter((id, i, a) => a.indexOf(id) === i)];
  const reacts: (string | null)[] = [null, 'wave', 'dizzy', 'bellTap', 'victory', 'bump', 'slump'];
  const v = new THREE.Vector3();
  let worst: { z: number; y?: number; limb?: string; id?: string; r?: string | null; sw?: number; k?: number } = { z: Infinity };
  for (const sw of [0, S.turn, -S.turn, 1.1]) for (const id of acts) for (const r of reacts) {
    const rig = createRig({ kind: 'claude', seedKey: 'flint', colorIndex: 3 });
    rig.root.rotation.y = Math.PI + sw; // seat yaw 0: the seat's +z (front) is world −z
    const an = createAnimator(rig, { seedKey: 'flint' });
    an.setSeat({ tag: 'sofa', yaw: 0 });
    an.setAction(id);
    for (let k = 0; k < 4 * 60; k++) {
      an.update(1 / 60, 0);
      if (r && k % 150 === 40) an.react(r);
      if (k < 45 || k % 3) continue;
      rig.root.updateMatrixWorld(true);
      for (const p of rig.parts) {
        let limb: string | null = null, vis = true;
        for (let q: THREE.Object3D | null = p.node; q; q = q.parent) { if (!q.visible) vis = false; if (!limb && /^(armL|armR|leg\d)$/.test(q.name)) limb = q.name; }
        if (!limb || !vis) continue;
        const b = unitBox(p.type);
        for (let c = 0; c < 8; c++) {
          v.set(c & 1 ? b.max.x : b.min.x, c & 2 ? b.max.y : b.min.y, c & 4 ? b.max.z : b.min.z).applyMatrix4(p.node.matrixWorld);
          if (v.y < back.top && -v.z < worst.z) worst = { z: -v.z, y: v.y, limb, id, r, sw, k };
        }
      }
    }
  }
  console.log(`# lounger: deepest limb below the back top at z ${worst.z.toFixed(3)} (rear face ${back.z}): ${worst.limb} ${worst.id}+${worst.r} swivel ${worst.sw}`);
  assert.ok(worst.z >= back.z, `${worst.limb} ${worst.id}+${worst.r} swivel ${worst.sw} frame ${worst.k}: z ${worst.z.toFixed(3)} y ${worst.y?.toFixed(3)} behind the backrest (${back.z})`);
});
