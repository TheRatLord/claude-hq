/** Asset registrations for the land package (flora + terrain features): the gallery and the systems build through these. */
import * as THREE from 'three';
import { defineAsset } from '../assets.ts';
import type { AssetBuildOpts } from '../assets.ts';
import { surfaceMaterial } from '../surface/index.ts';
import {
  TREE_KINDS, bushGeometry, cloverGeometry, flowerGeometry, logGeometry, meadowRockGeometry, mushroomGeometry, stumpGeometry,
  treeGeometry, tuftGeometry,
} from './species.ts';
import type { BushKind } from './species.ts';
import { flowerColor } from './scatter.ts';
import { rockGeometry } from '../terrain/rocks.ts';
import { cattailGeometry, lilyFlowerGeometry, lilyPadGeometry, reedGeometry } from '../terrain/shore.ts';
import '../surface/assets.ts';

const solid = (g: THREE.BufferGeometry, double = false) => {
  const m = new THREE.Mesh(g, surfaceMaterial({ vertexColors: true, side: double ? THREE.DoubleSide : THREE.FrontSide }));
  m.castShadow = true;
  return m;
};

const TREE_NOTES: Record<string, string> = {
  round: 'round deciduous; spring green w/ pink flecks, autumn orange', lolly: 'lollipop; cherry blossom in spring, red in autumn',
  bushy: 'broad bushy; white blossom in spring, yellow in autumn', oak: 'oak with roots and limbs', birch: 'white-barked birch',
  pine: 'forest pine (rim forests), snow-laden in winter', fir: 'tall narrow fir', willow: 'weeping willow by the water',
  hero: 'the huge old tree on the southern knoll',
};
for (const kind of TREE_KINDS) {
  defineAsset({
    name: `tree-${kind}`, group: 'plant', note: TREE_NOTES[kind],
    build: (o: AssetBuildOpts) => solid(treeGeometry(kind, o.season, o.seed + ({ round: 2, lolly: 4, bushy: 7, oak: 1, birch: 3, pine: 5, fir: 8, willow: 0, hero: 6 }[kind] ?? 0))),
  });
}
for (const kind of ['bush', 'berry', 'hedge'] as BushKind[]) {
  defineAsset({ name: `bush-${kind}`, group: 'plant', note: kind === 'berry' ? 'berries: blossom → red → purple' : undefined, build: (o) => solid(bushGeometry(kind, o.season, o.seed + 1)) });
}

const tintAll = (g: THREE.BufferGeometry, c: THREE.Color) => {
  const col = g.attributes.color;
  for (let i = 0; i < col.count; i++) col.setXYZ(i, col.getX(i) * c.r, col.getY(i) * c.g, col.getZ(i) * c.b);
  return g;
};
const GRASS = new THREE.Color(0x7fb84e);
defineAsset({ name: 'grass-tuft', group: 'plant', note: 'instanced ×10k, tinted by the ground colour, wind sway', build: (o) => solid(tintAll(tuftGeometry(false, o.season, 1), GRASS), true) });
defineAsset({ name: 'grass-tall', group: 'plant', note: 'meadow grass', build: (o) => solid(tintAll(tuftGeometry(true, o.season, 2), GRASS), true) });

defineAsset({
  name: 'wildflowers', group: 'plant', variants: ['daisy', 'bell', 'tall'], note: 'patch colours follow the season',
  build: (o) => {
    const g = new THREE.Group();
    const kind = (o.variant ?? 'daisy') as 'daisy' | 'bell' | 'tall';
    const c = new THREE.Color();
    for (let i = 0; i < 6; i++) {
      const geo = flowerGeometry(kind, 3);
      flowerColor(o.season === 'winter' ? 'summer' : o.season, i, c);
      const col = geo.attributes.color;
      for (let v = 0; v < col.count; v++) if (col.getX(v) + col.getY(v) + col.getZ(v) > 2.9) col.setXYZ(v, c.r, c.g, c.b);
      const m = solid(geo, true);
      m.position.set((i % 3 - 1) * 0.6, 0, (Math.floor(i / 3) - 0.5) * 0.6);
      g.add(m);
    }
    return g;
  },
});
defineAsset({ name: 'clover', group: 'plant', build: (o) => solid(cloverGeometry(o.season, 1), true) });
defineAsset({ name: 'mushrooms', group: 'plant', variants: ['red', 'brown'], note: 'autumn woods', build: (o) => solid(mushroomGeometry(o.season, o.variant === 'brown' ? 2 : 1)) });
defineAsset({ name: 'fallen-log', group: 'plant', build: (o) => solid(logGeometry(o.season, 1)) });
defineAsset({ name: 'stump', group: 'plant', build: (o) => solid(stumpGeometry(o.season, 1)) });
defineAsset({ name: 'reeds', group: 'plant', note: 'pond + calm river banks', build: (o) => solid(reedGeometry(o.season), true) });
defineAsset({ name: 'cattails', group: 'plant', build: (o) => solid(cattailGeometry(o.season), true) });
defineAsset({
  name: 'lily-pads', group: 'plant', note: 'pads + flowers (hidden in winter: the pond ices over)',
  build: (o) => {
    const g = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const p = solid(lilyPadGeometry(o.season === 'winter' ? 'summer' : o.season));
      p.position.set(Math.cos(i * 2.4) * 0.9 * (i > 0 ? 1 : 0), 0.02, Math.sin(i * 2.4) * 0.9 * (i > 0 ? 1 : 0));
      p.rotation.y = i * 1.3;
      p.scale.setScalar(0.8 + (i % 3) * 0.25);
      g.add(p);
    }
    const f = solid(lilyFlowerGeometry());
    f.position.y = 0.03;
    g.add(f);
    return g;
  },
});

// terrain features
defineAsset({ name: 'meadow-rock', group: 'terrain', build: (o) => solid(meadowRockGeometry(o.season, o.seed)) });
defineAsset({ name: 'outcrop', group: 'terrain', variants: ['strata', 'mossy'], note: 'mountainside outcrops (instanced, scaled 1–4 m)',
  build: (o) => solid(o.variant === 'mossy'
    ? rockGeometry({ seed: 47, season: o.season, detail: 1, flat: 1.1, strata: true, warm: 0.3, moss: 0.25 })
    : rockGeometry({ seed: 31, season: o.season, detail: 1, flat: 0.8, stretch: 1.3, strata: true, warm: 0.6 })) });
defineAsset({ name: 'river-rock', group: 'terrain', note: 'mid-stream boulders + the ford stones (water foams around them)', build: (o) => solid(rockGeometry({ seed: 5, season: o.season, detail: 1, flat: 0.62, moss: 0.5, warm: 0.2 })) });
defineAsset({ name: 'pebble', group: 'terrain', build: (o) => { const m = solid(rockGeometry({ seed: 9, season: o.season, detail: 0, flat: 0.55, warm: 0.5 })); m.scale.setScalar(0.25); return m; } });

