/** Gallery registration for the farmhouse interior (the valley builds the same pieces in interior.ts). */
import * as THREE from 'three';
import { defineAsset } from '../assets.ts';
import { buildRoom } from './room.ts';
import { buildFinds, buildFire, buildPendulum, buildTank } from './pieces.ts';
import type { Fire, Tank } from './pieces.ts';
import { ROOM, SHELF_IDS, TANK_IDS } from './layout.ts';
import type { CollectionData } from '../../model/collection.ts';

/** the gallery shows a completed book: every shelf slot filled, every fish in the tank */
const FULL: CollectionData = { v: 1, picked: { day: '', keys: [] }, found: Object.fromEntries([...SHELF_IDS, ...TANK_IDS].map((id, i) => [id, { n: 1, first: '2026-01-01', best: 20 + i }])) };

defineAsset({
  name: 'farmhouse-interior',
  group: 'structure',
  note: 'walk-in room: hearth, Almanac desk, Collections shelf, CRT terminal desk, fish tank, bed (cutaway = no ceiling)',
  variants: ['cutaway', 'closed'],
  build: (o) => {
    const g = new THREE.Group();
    g.add(buildRoom({ season: o.season, seed: o.seed, cutaway: o.variant !== 'closed' }));
    const fire = buildFire(), pend = buildPendulum(), finds = buildFinds(), tank = buildTank();
    finds.update(FULL, 1);
    tank.update(0, FULL, 1);
    g.add(fire.mesh, pend, finds.mesh, tank.glass, tank.fish);
    // centre the room on the gallery origin, floor at y=0
    g.position.set(0, -ROOM.floor, -(ROOM.z0 + ROOM.z1) / 2);
    const root = new THREE.Group();
    root.add(g);
    root.userData.fire = fire; root.userData.tank = tank; root.userData.pend = pend;
    return root;
  },
  animate: (obj, t, dt) => {
    if (!Number.isFinite(t)) t = obj.userData.clock = ((obj.userData.clock as number | undefined) ?? 0) + (Number.isFinite(dt) ? dt : 0);
    (obj.userData.fire as Fire).update(t, 1);
    (obj.userData.tank as Tank).update(t, FULL, 1);
    (obj.userData.pend as THREE.Mesh).rotation.z = Math.sin(t * Math.PI) * 0.09;
  },
});

// ---------------------------------------------------------------------------------------------------------------
// The barn interior (scene/interior/barn.ts builds the same pieces)

import { buildBarnRoom, buildDaylight } from './barnRoom.ts';
import { buildProps, buildStable, buildSwallows, buildWorks, netLevel } from './barnPieces.ts';
import type { Props, Stable, Swallows, Works } from './barnPieces.ts';
import { BARN_ROOM } from './barnLayout.ts';
import { emptyBarn } from '../../model/barn.ts';
import { levelsFromParam, newLevels } from '../structures/rig.ts';
import { DONKEY } from './donkey.ts';
import { Batch } from '../plots/batch.ts';
import { rigMaterial } from '../plots/rig.ts';

defineAsset({
  name: 'barn-interior',
  group: 'structure',
  note: 'walk-in barn: hay loft + ladder, stalls (Daisy, Pepper), sheep pen, coop with roost and nest boxes, workbench and tool wall, the machine room\'s brass dials (cutaway = no roof / front / east wall; param = the gauges)',
  variants: ['cutaway', 'closed', 'night'],
  param: 'gauges',
  build: (o) => {
    const g = new THREE.Group();
    const cut = o.variant !== 'closed' && o.variant !== 'night';
    g.add(buildBarnRoom({ season: o.season, seed: o.seed, cutaway: cut }));
    const day = buildDaylight({ cutaway: cut });
    day.update(new THREE.Color(0.75, 0.85, 1.0), o.variant === 'night' ? 0 : 1);
    const stable = buildStable(o.season), props = buildProps(), works = buildWorks(), swallows = buildSwallows();
    g.add(day.mesh, ...stable.meshes, ...props.meshes, ...works.meshes, swallows.mesh);
    // centre the barn on the gallery origin, floor at y = 0
    g.position.set(0, -BARN_ROOM.floor, 0);
    const root = new THREE.Group();
    root.add(g);
    const data = emptyBarn();
    data.fed = ['cow', 'donkey', 'sheep', 'hens'];
    root.userData.barn = { stable, props, works, swallows, data, lv: newLevels(), night: o.variant === 'night' };
    return root;
  },
  animate: (obj, t, dt, param) => {
    if (!Number.isFinite(t)) t = obj.userData.clock = ((obj.userData.clock as number | undefined) ?? 0) + (Number.isFinite(dt) ? dt : 0);
    const b = obj.userData.barn as { stable: Stable; props: Props; works: Works; swallows: Swallows; data: ReturnType<typeof emptyBarn>; lv: ReturnType<typeof newLevels>; night: boolean };
    const d = Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 1 / 60;
    b.stable.update({ t, dt: d, sleepy: b.night, px: 0, py: 1.9, pz: 3.2, data: b.data });
    b.props.update(t, d, b.data, 3);
    levelsFromParam(Number.isFinite(param) ? param : 0.5, b.lv);
    b.works.update(t, d, b.lv, netLevel(4e6 * (param || 0.5), 1e6), 'gallery', Array.from({ length: 60 }, (_, i) => 0.4 + 0.3 * Math.sin(i * 0.3)), b.data, 3, b.night ? 1 : 0);
    b.swallows.update(t, d, !b.night);
  },
});

/** the donkey alone (rest pose, the barn's stable mesh) */
defineAsset({
  name: 'donkey',
  group: 'animal',
  note: 'Pepper, the barn\'s donkey (pen-animal rig: blinks, chews, ears flick, tail swishes)',
  build: () => {
    const g = new THREE.Group();
    const body = new Batch(DONKEY.body().clone(), rigMaterial(), 1, { rect: true, aux: true });
    const parts = [body];
    const m = new THREE.Matrix4();
    const R = new Float32Array(4), X = new Float32Array(4);
    body.begin(); body.push(m, null, R, X); body.end();
    const head = new Batch(DONKEY.head().clone(), rigMaterial(), 1, { rect: true, aux: true });
    head.begin(); head.push(new THREE.Matrix4().makeTranslation(DONKEY.neck[0], DONKEY.neck[1], DONKEY.neck[2]), null, R, X); head.end();
    parts.push(head);
    for (let i = 0; i < 4; i++) {
      const h = DONKEY.hips[i], [bu, bl] = DONKEY.bones[i];
      const up = new Batch(DONKEY.upper().clone(), rigMaterial(), 1, { rect: true, aux: true });
      up.begin(); up.push(new THREE.Matrix4().compose(new THREE.Vector3(h[0], h[1], h[2]), new THREE.Quaternion(), new THREE.Vector3(1, bu / DONKEY.boneGeo[0], 1)), null, R, X); up.end();
      const lo = new Batch(DONKEY.lower().clone(), rigMaterial(), 1, { rect: true, aux: true });
      lo.begin(); lo.push(new THREE.Matrix4().compose(new THREE.Vector3(h[0], h[1] - bu, h[2]), new THREE.Quaternion(), new THREE.Vector3(1, bl / DONKEY.boneGeo[1], 1)), null, R, X); lo.end();
      parts.push(up, lo);
    }
    for (const p of parts) g.add(p.mesh);
    g.userData.head = head;
    return g;
  },
  animate: (obj, t) => {
    if (!Number.isFinite(t)) return;
    const head = obj.userData.head as Batch;
    const R = [Math.sin(t * 0.7) > 0.95 ? 1 : 0, 0.05 * (0.5 + 0.5 * Math.sin(t * 3)), Math.sin(t * 1.3) * 0.3, -Math.sin(t * 1.1) * 0.3];
    head.begin(); head.push(new THREE.Matrix4().makeTranslation(DONKEY.neck[0], DONKEY.neck[1], DONKEY.neck[2]), null, R, [0, 0, 0, 0]); head.end();
  },
});
