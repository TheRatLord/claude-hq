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
