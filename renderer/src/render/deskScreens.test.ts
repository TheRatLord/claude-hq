import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { screenModeFor, encodeScreen, SCREEN_MODE, registerDeskScreens, setDeskScreen, deskScreenModes, type ScreenMode } from './deskScreens.ts';

test('desk screens are an honest status cue: mode per owner state', () => {
  assert.equal(screenModeFor(null), 'off');
  assert.equal(screenModeFor({ status: 'working', kind: 'claude' }, 'work'), 'code');
  assert.equal(screenModeFor({ status: 'idle', kind: 'claude' }, 'off'), 'saver');
  assert.equal(screenModeFor({ status: 'done', kind: 'claude' }, 'off'), 'done');
  assert.equal(screenModeFor({ status: 'blocked', kind: 'claude' }, 'blocked'), 'blocked');
  assert.equal(screenModeFor({ status: 'blocked', kind: 'claude' }, null), 'blocked');
  assert.equal(screenModeFor({ status: 'idle', kind: 'shell' }, 'off'), 'prompt');   // shell at its prompt
  assert.equal(screenModeFor({ status: 'idle', kind: 'shell' }, 'work'), 'code');    // busy shell
});

test('instanceColor encoding round-trips through the shader decode (mode = floor(r/2), strip r = r − 2·mode)', () => {
  for (const [mode, id] of Object.entries(SCREEN_MODE) as [ScreenMode, number][]) { // Object.entries key narrowing
    const [r] = encodeScreen(mode);
    const dec = Math.floor(r * 0.5);
    assert.equal(dec, id, mode);
    const strip = r - 2 * dec;
    assert.ok(strip >= 0 && strip <= 1, `${mode} strip ${strip}`);
  }
});

test('registered desks start off, follow reports, and only touch their own instance', () => {
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial(), 3);
  registerDeskScreens(mesh, ['tA', null, 'tB']);
  assert.equal(deskScreenModes().tA, 'off');
  setDeskScreen('tB', 'blocked');
  setDeskScreen('nope', 'code'); // unknown anchors are ignored
  assert.equal(deskScreenModes().tB, 'blocked');
  assert.ok(mesh.instanceColor);
  assert.equal(Math.floor(mesh.instanceColor.array[2 * 3] * 0.5), SCREEN_MODE.blocked);
  assert.equal(Math.floor(mesh.instanceColor.array[0] * 0.5), SCREEN_MODE.off);
});

test('M3.5: live tile encoding (mode 6, g = strip.g + 2·tile) and tally LED encoding round-trip', async () => {
  const { LIVE_MODE, encodeTally, TALLY } = await import('./deskScreens.ts');
  for (let tile = 0; tile < 16; tile++) {
    const [r, g] = encodeScreen('code', tile);
    assert.equal(Math.floor(r * 0.5), LIVE_MODE);
    assert.equal(Math.floor(g * 0.5), tile);
    assert.ok(g - 2 * tile >= 0 && g - 2 * tile <= 1);
  }
  assert.equal(Math.floor(encodeTally('code')[0] * 0.5), TALLY.working);
  assert.equal(Math.floor(encodeTally('blocked')[0] * 0.5), TALLY.blocked);
  assert.equal(Math.floor(encodeTally('done')[0] * 0.5), TALLY.done);
  assert.equal(Math.floor(encodeTally('saver')[0] * 0.5), TALLY.off);
  assert.equal(Math.floor(encodeTally('prompt')[0] * 0.5), TALLY.off);
});

test('M3.5: tally LEDs are one extra instanced mesh; screenRect gives the world corners; tiles switch live ↔ proc', async () => {
  const { setDeskTile, screenRect, deskScreenLive } = await import('./deskScreens.ts');
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.4, 0.2), new THREE.MeshBasicMaterial(), 2);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(1, 0.8, 2), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)), new THREE.Vector3(1, 1, 1));
  mesh.setMatrixAt(0, m); mesh.setMatrixAt(1, m);
  registerDeskScreens(mesh, ['rA', 'rB']);
  const tallies = mesh.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh);
  assert.equal(tallies.length, 1);
  assert.equal(tallies[0].count, 2);
  const r = screenRect('rA');
  assert.ok(r);
  assert.ok(r.center.distanceTo(new THREE.Vector3(1, 0.8, 2)) < 1e-6);
  assert.ok(r.normal.distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-6, 'normal = out of the glass (+z rotated to +x)');
  assert.ok(Math.abs(r.width - 0.4) < 1e-6 && Math.abs(r.height - 0.2) < 1e-6);
  assert.ok(r.corners[0].y > r.corners[3].y, 'top-left above bottom-left');
  assert.equal(screenRect('nope'), null);
  setDeskTile('rA', 3);
  assert.equal(deskScreenLive().rA, 'live');
  assert.ok(mesh.instanceColor);
  assert.equal(Math.floor(mesh.instanceColor.array[1] * 0.5), 3);
  setDeskTile('rA', -1);
  assert.equal(deskScreenLive().rA, 'proc');
});
