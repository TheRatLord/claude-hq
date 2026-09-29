import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCharBatch } from './charBatch.ts';
import { createRig } from '../rig/clawd.ts';
import { createAnimator } from '../anim/animator.ts';
import { EYE_X } from '../rig/face.ts';
import type { Kind } from '../../../../shared/protocol.ts';

const setup = (n: number, kinds: Kind[] = ['claude']) => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 400);
  camera.position.set(0, 1.2, 6); camera.lookAt(0, 0.4, 0); camera.updateMatrixWorld();
  const cb = createCharBatch({ scene, camera, viewportHeight: () => 900 });
  const acts = ['type', 'typeFrenzy', 'readBook', 'think', 'waveBlocked', 'lounge', 'sleepDesk', null, 'sitIdle', 'queueWait', 'confused', null];
  const rigs = [];
  for (let i = 0; i < n; i++) {
    const kind = kinds[i % kinds.length];
    const rig = createRig({ kind, seedKey: `a${i}` });
    rig.root.position.set((i % 6) - 2.5, 0, -Math.floor(i / 6));
    const h = cb.register(rig, { kind, colorIndex: i, cycle: i > 7 ? 1 : 0 });
    const an = createAnimator(rig, { seedKey: `a${i}` });
    an.setAction(acts[i % acts.length]);
    if (i === 3) an.react('victory');
    for (let k = 0; k < 40; k++) an.update(1 / 60, 0);
    rigs.push({ rig, h, an });
  }
  cb.write();
  return { scene, camera, cb, rigs };
};

test('12 mixed Clawds cost ≤ 40 main draws and ≤ 12 shadow draws (§11 M1)', () => {
  const { cb } = setup(12, ['claude', 'claude', 'codex', 'gemini']);
  const s = cb.stats();
  assert.equal(s.visibleActors, 12);
  assert.ok(s.draws <= 40, `draws ${s.draws}`);
  assert.ok(s.shadowDraws <= 12, `shadow ${s.shadowDraws}`);
});

test('meshes are never frustum-culled by three; empty types issue no draw', () => {
  const { scene } = setup(1);
  let meshes = 0;
  scene.traverse((o) => { if (o instanceof THREE.InstancedMesh) { meshes++; assert.equal(o.frustumCulled, false); if (o.count === 0) assert.equal(o.visible, false); } });
  assert.ok(meshes > 10);
});

test('per-actor culling: an actor behind the camera writes no instances', () => {
  const { cb, rigs } = setup(2);
  rigs[1].rig.root.position.set(0, 0, 40); // behind the camera
  cb.write();
  assert.equal(cb.stats().visibleActors, 1);
  rigs[0].h.setVisible(false);
  cb.write();
  assert.equal(cb.stats().instances, 0);
});

test('Clawd proportions: ≈ 0.88 m with accessory, eyes 0.09 × 0.17 at ±0.145', () => {
  const rig = createRig({ kind: 'claude', seedKey: 'x', colorIndex: 0, pers: { width: 0, height: 0 } });
  createAnimator(rig, {}).update(0, 0);
  rig.root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const p of rig.parts) { if (p.type === 'blob' || !p.node.visible) continue; box.expandByPoint(v.setFromMatrixPosition(p.node.matrixWorld)); }
  assert.ok(box.max.y > 0.8 && box.max.y < 1.0, `top ${box.max.y}`);
  assert.equal(EYE_X, 0.145);
});

test('Shelly rig + animator run', () => {
  const rig = createRig({ kind: 'shell', seedKey: 's' });
  const an = createAnimator(rig, {});
  an.setAction('spinnerWatch'); an.setFace('happy');
  for (let i = 0; i < 30; i++) an.update(1 / 60, 0);
  assert.equal(rig.species, 'shelly');
  assert.ok(rig.strokes.some((s) => s.visible));
});

test('[CHR r3] glints stay inside the eye slot at oblique angles and fade out edge-on', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 100);
  const cb = createCharBatch({ scene, camera, viewportHeight: () => 900 });
  const rig = createRig({ kind: 'claude', seedKey: 'g' });
  cb.register(rig, { kind: 'claude', colorIndex: 0, cycle: 0 });
  const an = createAnimator(rig, { seedKey: 'g' });
  const findGlint = (): THREE.InstancedMesh | null => { let g: THREE.InstancedMesh | null = null; scene.traverse((o) => { if (o.name === 'char:glint' && o instanceof THREE.InstancedMesh) g = o; }); return g; };
  let glintMesh = findGlint();
  const eyes = rig.parts.flatMap((p) => (p.glintOf ? [p.glintOf] : []));
  const m = new THREE.Matrix4(), inv = new THREE.Matrix4(), c = new THREE.Vector3(), s = new THREE.Vector3(), qq = new THREE.Quaternion();
  for (const face of ['neutral', 'focused', 'worried']) {
    an.setFace(face);
    for (let k = 0; k < 90; k++) an.update(1 / 60, 0);
    for (const yaw of [0, 0.5, 0.9, 1.25, 1.45]) {
      camera.position.set(Math.sin(yaw) * 1.6, 0.75, Math.cos(yaw) * 1.6); camera.lookAt(0, 0.45, 0); camera.updateMatrixWorld();
      cb.write();
      glintMesh = findGlint();
      const n = glintMesh?.count ?? 0;
      if (yaw >= 1.25) { assert.equal(n, 0, `${face} yaw ${yaw}: no glint edge-on`); continue; }
      if (yaw === 0) assert.equal(n, 2, `${face}: both glints frontal`);
      for (let i = 0; i < n; i++) {
        assert.ok(glintMesh);
        glintMesh.getMatrixAt(i, m); m.decompose(c, qq, s);
        // nearest eye → its local frame
        const eye = eyes.reduce((a, e) => (c.distanceTo(new THREE.Vector3().setFromMatrixPosition(e.matrixWorld)) < c.distanceTo(new THREE.Vector3().setFromMatrixPosition(a.matrixWorld)) ? e : a));
        inv.copy(eye.matrixWorld).invert();
        const l = c.clone().applyMatrix4(inv);
        const slotPart = rig.parts.find((p) => p.type === 'eye' && p.node.parent === eye);
        assert.ok(slotPart);
        const slot = slotPart.node;
        const hy = 0.085 * slot.scale.y, cy = slot.position.y;
        const rL = s.x / new THREE.Vector3().setFromMatrixColumn(eye.matrixWorld, 0).length();
        assert.ok(Math.abs(l.x) + rL <= 0.046, `${face} yaw ${yaw}: glint x inside slot (${l.x.toFixed(3)} + ${rL.toFixed(3)})`);
        assert.ok(Math.abs(l.y - cy) + rL <= hy + 0.002, `${face} yaw ${yaw}: glint y inside slot (${(l.y - cy).toFixed(3)} + ${rL.toFixed(3)} vs ${hy.toFixed(3)})`);
        assert.ok(l.z < 0.03, 'glint lies on the slot, not floating in front');
      }
    }
  }
});

test('[CHR M2] full cast with gear (packs, emblems, 4 minis, struggle) + Shellys with props stays in the draw budget', () => {
  const { cb, rigs } = setup(12, ['claude', 'claude', 'codex', 'gemini']);
  for (const { an } of rigs) {
    an.setTraits({ contextTokens: 190_000, modelTier: 'opus', subagents: [{ active: true }, { active: true }, { active: true }, { active: true }], struggle: { level: 2 } });
    an.setAction('grepMagnify');
    for (let k = 0; k < 30; k++) an.update(1 / 60, 0);
  }
  cb.write();
  const s = cb.stats();
  assert.ok(s.draws <= 40, `draws ${s.draws}`);
  assert.ok(s.shadowDraws <= 12, `shadow ${s.shadowDraws}`);
});

test('[CHR M2] hidden props, gear and minis cost no instances; minis appear with active subagents only', () => {
  const { cb, rigs } = setup(1);
  const { an } = rigs[0];
  an.setAction(null);
  an.setTraits({ subagents: [{ active: false }] });
  for (let k = 0; k < 30; k++) an.update(1 / 60, 0);
  cb.write();
  const base = cb.stats().instances;
  assert.ok(base < 70, `a bare Clawd writes few instances (${base})`);
  an.setTraits({ subagents: [{ active: true }, { active: true }] });
  for (let k = 0; k < 60; k++) an.update(1 / 60, 0);
  cb.write();
  assert.ok(cb.stats().instances > base + 20, 'two minis popped in');
});

test('[CHR M2] stop-motion smear only while the animator flags a fast action and a part moves fast on screen', () => {
  const { cb, rigs } = setup(1);
  const { rig } = rigs[0];
  rig.smear = 1;
  cb.write();
  rig.root.position.x += 0.25; // ≈ 50 px at 6 m / 900 px
  cb.write();
  assert.ok(cb.stats().smeared > 0, 'smeared');
  rig.smear = 0;
  rig.root.position.x += 0.25;
  cb.write();
  assert.equal(cb.stats().smeared, 0);
});

test('[CHR fix r3] §5.3 LOD cadence: lod ≥ 1 re-poses at 20 Hz and replays cached instances (moved with the root) between', () => {
  const { cb, rigs } = setup(2);
  const snap = () => {
    const out = new Map();
    cb.group.children.forEach((m) => { if (m instanceof THREE.InstancedMesh && m.count) out.set(m.name, Array.from(m.instanceMatrix.array.subarray(0, m.count * 16))); });
    return out;
  };
  for (const r of rigs) r.h.setLod(1);
  // one full write at lod 1 captures; then frames without a new pose replay
  for (const r of rigs) r.an.update(1, 1); // force a pose step
  cb.write();
  assert.equal(cb.stats().replayed, 0);
  let steps = 0;
  for (let k = 0; k < 12; k++) {
    const s0 = rigs[0].rig.poseSerial;
    for (const r of rigs) r.an.update(1 / 120, 1);
    if (rigs[0].rig.poseSerial !== s0) steps++;
    cb.write();
  }
  assert.ok(steps >= 2 && steps <= 3, `20 Hz over 0.1 s: ${steps} pose steps`);
  // A replayed frame after a root move equals a full re-pose of the same (unchanged) pose.
  for (const r of rigs) r.an.update(1, 1);
  cb.write(); // capture
  rigs[0].rig.root.position.x += 0.3; rigs[0].rig.root.rotation.y += 0.4;
  cb.write();
  assert.equal(cb.stats().replayed, 2);
  const replayed = snap();
  for (const r of rigs) r.rig.poseSerial = (r.rig.poseSerial ?? 0) + 1; // same pose, but forces the full lod-1 path
  cb.write();
  assert.equal(cb.stats().replayed, 0);
  const full = snap();
  for (const [name, arr] of full) {
    const r = replayed.get(name);
    assert.ok(r && r.length === arr.length, name);
    for (let i = 0; i < arr.length; i++) assert.ok(Math.abs(arr[i] - r[i]) < 1e-4, `${name}[${i}] ${arr[i]} vs ${r[i]}`);
  }
});

test('[CHR m2 fix r3] far hull LOD: > 10 m and top-down views draw ≤ 40% of the near triangles; chars.tris reported', () => {
  const near = setup(12, ['claude', 'claude', 'codex', 'gemini']);
  const sn = near.cb.stats();
  assert.equal(sn.farActors, 0);
  assert.ok(sn.tris > 0 && sn.shadowTris > 0, `tris ${sn.tris} shadow ${sn.shadowTris}`);
  // same crowd seen from 22 m (medium tier: hulls also end at 18 m)
  const far = setup(12, ['claude', 'claude', 'codex', 'gemini']);
  far.camera.position.set(0, 1.2, 22); far.camera.lookAt(0, 0.4, 0); far.camera.updateMatrixWorld();
  far.cb.write();
  const sf = far.cb.stats();
  assert.equal(sf.farActors, 12);
  assert.ok(sf.tris <= sn.tris * 0.4, `far tris ${sf.tris} vs near ${sn.tris}`);
  assert.ok(sf.shadowTris <= sn.shadowTris * 0.4, `far shadow tris ${sf.shadowTris} vs near ${sn.shadowTris}`);
  // plan-style top-down camera 30 m above: every actor on the far LOD
  const top = setup(12);
  top.camera.position.set(0, 30, 0.01); top.camera.lookAt(0, 0, 0); top.camera.updateMatrixWorld();
  top.cb.write();
  assert.equal(top.cb.stats().farActors, 12);
  // hysteresis: an actor at 9.5 m stays far once far, and is near when approached from close ([CHR fix m3-r1] 10 / 9 m)
  const h = setup(1);
  h.rigs[0].rig.root.position.set(0, 0, 0);
  h.camera.position.set(0, 0.45, 11); h.camera.lookAt(0, 0.45, 0); h.camera.updateMatrixWorld(); h.cb.write();
  assert.equal(h.cb.stats().farActors, 1);
  h.camera.position.set(0, 0.45, 9.5); h.camera.updateMatrixWorld(); h.cb.write();
  assert.equal(h.cb.stats().farActors, 1, 'hysteresis keeps it far at 9.5 m');
  h.camera.position.set(0, 0.45, 8.5); h.camera.updateMatrixWorld(); h.cb.write();
  assert.equal(h.cb.stats().farActors, 0);
});

test('[CHR fix m3-r1] crowd budget: far actors skip thin-part hulls and sub-pixel micro-parts; a 40-crowd at 10–25 m stays ≤ 250k tris', async () => {
  const { FAR_NO_HULL } = await import('./charBatch.ts');
  const kinds: Kind[] = ['claude', 'claude', 'codex', 'gemini', 'shell'];
  const c = setup(40, kinds);
  // spread the crowd 10–25 m in front of the camera (the spawn pose's depth range)
  c.rigs.forEach((r, i) => r.rig.root.position.set(((i % 8) - 3.5) * 1.6, 0, -10 - Math.floor(i / 8) * 3.5));
  c.camera.position.set(0, 1.2, 0); c.camera.lookAt(0, 0.4, -15); c.camera.updateMatrixWorld();
  c.cb.write();
  const st = c.cb.stats();
  assert.equal(st.farActors, 40);
  assert.ok(st.tris <= 250_000, `crowd tris ${st.tris}`);
  const names: string[] = [];
  c.cb.group.traverse((o) => { if (o instanceof THREE.InstancedMesh && o.count > 0) names.push(o.name); });
  for (const t of FAR_NO_HULL) assert.ok(!names.includes(`hull:${t}~lo`), `no far ${t} hulls: ${names.join(' ')}`);
});

test('[CHR m2 fix r3] low-poly variants keep each part type\'s unit bounds (within 10%)', async () => {
  const { PART_TYPES, extentOf, trisOf, hasLo } = await import('./geometry.ts');
  for (const t of PART_TYPES) {
    if (!hasLo(t)) continue;
    const a = extentOf(t), b = extentOf(t, true);
    for (const k of ['x', 'y', 'z'] as const) assert.ok(Math.abs(a[k] - b[k]) <= 0.1 * a[k] + 1e-6, `${t}.${k} ${a[k]} vs ${b[k]}`);
    assert.ok(trisOf(t, true) < trisOf(t), t);
  }
});
