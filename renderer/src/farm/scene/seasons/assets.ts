/** Gallery registrations for the seasonal pastimes (the system builds through the same models.ts / ice.ts). */
import * as THREE from 'three';
import { defineAsset } from '../assets.ts';
import { solidMat } from '../structures/kit.ts';
import { toon } from '../toon.ts';
import { POND, WORLD } from '../../world/map.ts';
import { oarPose } from './physics.ts';
import { BOAT_SPOTS, buildBoat, oarGeometry, snowballGeometry, snowmenDecor } from './models.ts';
import { ballHeights, decorate, nextDecor } from './snowman.ts';
import type { Snowman } from './snowman.ts';
import { createIce } from './ice.ts';

defineAsset({
  name: 'rowboat', group: 'prop', note: 'the pond rowboat (spring–autumn): row with W / S, A / D; the oars stroke (param = pull)',
  variants: ['rowing', 'shipped', 'winter'],
  param: 'pull',
  build(o) {
    const g = new THREE.Group();
    const boat = buildBoat(7, o.night ?? 0);
    g.add(boat);
    if (o.variant === 'winter') { boat.rotation.z = Math.PI; boat.position.y = 0.34; return g; }
    boat.position.y = 0.3;
    const oars = new THREE.InstancedMesh(oarGeometry(), solidMat(), 2);
    oars.position.y = 0.3;
    g.add(oars);
    g.userData.oars = oars;
    g.userData.shipped = o.variant === 'shipped';
    return g;
  },
  animate(obj, t, _dt, param) {
    const oars = obj.userData.oars as THREE.InstancedMesh | undefined;
    if (!oars) return;
    const pose = { sweep: 0, lift: 0 }, m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ');
    const ph = (t * 0.85 * (0.4 + param)) % 1;
    for (let i = 0; i < 2; i++) {
      oarPose(ph, obj.userData.shipped ? 0 : 1, pose);
      e.set(0, i === 0 ? pose.sweep : Math.PI - pose.sweep, -0.3 + pose.lift * 0.62);
      oars.setMatrixAt(i, m.compose(i === 0 ? BOAT_SPOTS.lockL : BOAT_SPOTS.lockR, q.setFromEuler(e), new THREE.Vector3(1, 1, 1)));
    }
    oars.instanceMatrix.needsUpdate = true;
  },
});

const STAGES = ['base', 'two', 'three', 'face', 'dressed', 'pinecone'] as const;
defineAsset({
  name: 'snowman', group: 'prop', note: 'a snowman, stage by stage (roll, stack three, decorate: winter with lying snow)',
  variants: STAGES,
  build(o) {
    const st = o.variant ?? 'dressed';
    const sm: Snowman = { id: 1, x: 0, z: 0, yaw: 0, balls: [0.62], decor: {} };
    if (st !== 'base') sm.balls.push(0.46);
    if (st !== 'base' && st !== 'two') sm.balls.push(0.32);
    const pieces = st === 'face' ? 2 : st === 'dressed' || st === 'pinecone' ? 6 : 0;
    for (let i = 0; i < pieces; i++) { const s = nextDecor(sm, (id) => st === 'pinecone' && (id === 'pinecone' || id === 'holly')); if (s) decorate(sm, s); }
    const g = new THREE.Group();
    const balls = new THREE.InstancedMesh(snowballGeometry(), toon(0xf4f6fa), 3);
    const hs = ballHeights(sm.balls);
    const m = new THREE.Matrix4();
    sm.balls.forEach((r, i) => balls.setMatrixAt(i, m.compose(new THREE.Vector3(0, hs[i], 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 1.3), new THREE.Vector3(r, r, r))));
    balls.count = sm.balls.length;
    g.add(balls);
    if (pieces) g.add(snowmenDecor([sm], () => 0));
    return g;
  },
  animate(obj, t) { obj.rotation.y = Math.sin(t * 0.4) * 0.5; },
});

defineAsset({
  name: 'pond-ice', group: 'terrain', note: 'the frozen pond: ice sheet (cracks, scratches, snow dusting = param), snowbanks, the iced dock',
  param: 'snow',
  build() {
    const g = new THREE.Group();
    const ice = createIce();
    ice.setFrozen(1);
    ice.mesh.position.set(-POND.x, -WORLD.water, -POND.z);
    g.add(ice.mesh);
    g.scale.setScalar(0.12);
    g.userData.ice = ice;
    // a few scratches, as if someone had been skating
    for (let i = 0; i < 40; i++) { const a = i * 0.16; ice.scratch(POND.x + Math.cos(a) * 3, POND.z + Math.sin(a * 2) * 2, POND.x + Math.cos(a + 0.16) * 3, POND.z + Math.sin((a + 0.16) * 2) * 2); }
    return g;
  },
  animate(obj, t, dt, param) {
    const ice = obj.userData.ice as ReturnType<typeof createIce> | undefined;
    ice?.update(t, { sunDir: new THREE.Vector3(0.4, 0.8, 0.3).normalize(), sunColor: new THREE.Color(0xfff1d6), sunIntensity: 2.2, skyColor: new THREE.Color(0x9fd3ff), groundColor: new THREE.Color(0x7a8a4a), fogColor: new THREE.Color(0xcfe6f0), fogNear: 60, fogFar: 320, night: 0, wet: 0, wind: { x: 1, z: 0 } }, param, dt);
  },
});
