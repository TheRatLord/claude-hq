/** Gallery registrations for the hillside orchard (the system builds through the same models.ts). */
import * as THREE from 'three';
import { defineAsset } from '../assets.ts';
import { toon } from '../toon.ts';
import { withSurfaces } from '../surface/index.ts';
import { solidMat } from '../structures/kit.ts';
import { Kit } from '../structures/kit.ts';
import { treePhase } from '../../model/orchard.ts';
import type { FruitKind } from '../../model/orchard.ts';
import { barkTint, beeGeometry, crownGeometry, crownTint, fruitGeometry, fruitLook, fruitSpots, trunkGeometry, whiteTint } from './models.ts';

const KINDS: readonly FruitKind[] = ['apple', 'pear', 'plum', 'cherry'];

defineAsset({
  name: 'orchard-tree', group: 'plant', note: 'hillside orchard fruit tree: blossom in spring, cherries / plums in summer, apples / pears / plums in autumn, bare (snow on the boughs) in winter; one crown geometry per season, tinted per species',
  variants: KINDS,
  build(o) {
    const kind = (KINDS.includes(o.variant as FruitKind) ? o.variant : 'apple') as FruitKind;
    const g = new THREE.Group();
    const mat = withSurfaces(toon(0xffffff, { vertexColors: true, shared: false }), { surfaces: ['bark', 'leaves', 'snow'] });
    const c = new THREE.Color();
    for (const [geo, tint] of [[trunkGeometry(), barkTint(kind, c).clone()], [crownGeometry(o.season), crownTint(kind, o.season, c).clone()]] as const) {
      const m = new THREE.InstancedMesh(geo, mat, 1);
      m.setMatrixAt(0, new THREE.Matrix4());
      m.setColorAt(0, tint);
      g.add(m);
    }
    const ph = treePhase(kind, o.season);
    if (ph === 'ripe' || ph === 'green') {
      const spots = fruitSpots(3, ph === 'ripe' ? 6 : 4);
      const f = new THREE.InstancedMesh(fruitGeometry(), whiteTint(toon(0xffffff, { vertexColors: true, shared: false })), spots.length);
      const look = fruitLook(kind, ph === 'green', c);
      spots.forEach((p, i) => { f.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion(), new THREE.Vector3(look.s, look.s * look.sy, look.s))); f.setColorAt(i, c); });
      g.add(f);
    }
    return g;
  },
});

defineAsset({
  name: 'orchard-fruit', group: 'prop', note: 'the orchard\'s fruit (one white body tinted per instance; stalks and leaves keep their colour)',
  build() {
    const g = new THREE.Group();
    const f = new THREE.InstancedMesh(fruitGeometry(), whiteTint(toon(0xffffff, { vertexColors: true, shared: false })), 5);
    const c = new THREE.Color();
    [...KINDS, 'green' as const].forEach((k, i) => {
      const look = fruitLook(k === 'green' ? 'apple' : k, k === 'green', c);
      f.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3((i - 2) * 0.24, 0.1, 0), new THREE.Quaternion(), new THREE.Vector3(look.s, look.s * look.sy, look.s)));
      f.setColorAt(i, c);
    });
    g.add(f);
    return g;
  },
});

defineAsset({
  name: 'orchard-bee', group: 'animal', note: 'a hillside orchard bee (instanced: foragers loop hive → flower → hive, guards hover at the entrance)',
  build() { const m = new THREE.Mesh(beeGeometry(), toon(0xffffff, { vertexColors: true })); m.scale.setScalar(6); return m; },
});

defineAsset({
  name: 'orchard-hive', group: 'prop', note: 'one of the hillside orchard\'s four hives (painted supers, a tin roof, the entrance facing +z)',
  build() {
    const k = new Kit(3);
    k.part('hive', () => {
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) k.box(0.08, 0.42, 0.08, 0x6e4a2a, { x: sx * 0.22, y: 0.17, z: sz * 0.2 });
      for (let s = 0; s < 3; s++) k.box(0.55, 0.24, 0.5, s === 1 ? 0xf6e8b8 : 0xb8d4a8, { y: 0.55 + s * 0.25 });
      k.box(0.66, 0.06, 0.62, 0x9aa4ad, { y: 1.2 });
      k.box(0.24, 0.035, 0.06, 0x2b2420, { y: 0.45, z: 0.25 });
    });
    return new THREE.Mesh(k.geometry() ?? new THREE.BufferGeometry(), solidMat());
  },
});
