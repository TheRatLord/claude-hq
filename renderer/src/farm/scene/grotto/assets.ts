/** Gallery registrations for the grotto behind the waterfall (the room and the system build through the same functions). */
import * as THREE from 'three';
import { defineAsset } from '../assets.ts';
import { toon } from '../toon.ts';
import { CAMP, CHEST, MOUTH, caveFloor } from '../../world/grotto.ts';
import {
  batGeometry, batMaterial, buildCamp, buildChestLid, buildCrystals, buildShell, crystalClusters, crystalMaterial, glowcapClumps,
  lanternGlass, paintingCanvas, paintingGeometry, propsMaterial, shellMaterial,
} from './cave.ts';
import { glowcapMaterial } from '../forage/assets.ts';
import { buildOutside, glowCard } from './outside.ts';

const T = { value: 0 };

defineAsset({
  name: 'grotto-cave', group: 'structure', note: 'the cavern behind the waterfall: shell + dripstones, crystals, the camp (cut open: seen from above)',
  variants: ['whole', 'shell', 'crystals'],
  build(o) {
    const g = new THREE.Group();
    const v = o.variant ?? 'whole';
    if (v !== 'crystals') { const m = new THREE.Mesh(buildShell(0.45).geometry, shellMaterial()); m.material.side = THREE.DoubleSide; g.add(m); }
    if (v !== 'shell') g.add(new THREE.Mesh(buildCrystals(crystalClusters()), crystalMaterial(T)));
    if (v === 'whole') g.add(new THREE.Mesh(buildCamp(), propsMaterial()));
    g.position.set(-0.5, 0, 10);
    return g;
  },
  animate(_obj, t) { T.value = t * 6; },
});

defineAsset({
  name: 'cave-crystals', group: 'prop', note: 'glowing crystal clusters and glow-caps (the colour wheel turns: param = time)',
  build() {
    const g = new THREE.Group();
    const m = new THREE.Mesh(buildCrystals(crystalClusters().slice(0, 1).map((c) => ({ ...c, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0 }))), crystalMaterial(T));
    m.scale.setScalar(1.6);
    g.add(m);
    return g;
  },
  animate(_obj, t) { T.value = t * 8; },
});

defineAsset({
  name: 'cave-bat', group: 'animal', note: 'the grotto\'s bats: roosting (wings folded, hanging) and flying (wings beating in the shader)',
  variants: ['fly', 'roost'],
  build(o) {
    const geo = batGeometry();
    const st = new THREE.InstancedBufferAttribute(new Float32Array([o.variant === 'roost' ? 0 : 1, 0]), 2);
    geo.setAttribute('batState', st);
    const m = new THREE.InstancedMesh(geo, batMaterial(T), 1);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(o.variant === 'roost' ? -Math.PI / 2 : 0, 0.6, 0, 'YXZ'));
    m.setMatrixAt(0, new THREE.Matrix4().compose(new THREE.Vector3(0, 0.5, 0), q, new THREE.Vector3(5, 5, 5)));
    const g = new THREE.Group();
    g.add(m);
    return g;
  },
  animate(_obj, t) { T.value = t; },
});

defineAsset({
  name: 'explorer-camp', group: 'prop', note: 'the old explorer\'s camp: bedroll, crate with journal and lantern, cold fire ring, pack, pick, the chest (variant open)',
  variants: ['closed', 'open'],
  build(o) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(buildCamp(), propsMaterial()));
    const lid = new THREE.Mesh(buildChestLid(), toon(0xffffff, { vertexColors: true }));
    lid.position.set(CHEST.x - Math.sin(CHEST.yaw) * 0.25, caveFloor(CHEST.x, CHEST.z) + 0.42, CHEST.z - Math.cos(CHEST.yaw) * 0.25);
    lid.rotation.order = 'YXZ'; lid.rotation.y = CHEST.yaw; lid.rotation.x = o.variant === 'open' ? -1.75 : 0;
    g.add(lid);
    g.add(new THREE.Mesh(lanternGlass(), new THREE.MeshBasicMaterial({ color: 0xffc566 })));
    g.add(new THREE.Mesh(glowcapClumps(), glowcapMaterial()));
    g.position.set(-CAMP.crate.x, 0, -CAMP.crate.z - 4);
    return g;
  },
});

defineAsset({
  name: 'cave-paintings', group: 'prop', note: 'the valley\'s oldest story on the grotto\'s north wall: Clawd farmers, the windmill, the first field',
  build() {
    const tex = new THREE.CanvasTexture(paintingCanvas() as HTMLCanvasElement);
    tex.colorSpace = THREE.SRGBColorSpace;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 1.9), toon(0x6c6774));
    const front = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.7), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    front.position.z = 0.01;
    const g = new THREE.Group();
    g.add(back, front);
    g.position.y = 1.2;
    void paintingGeometry;
    return g;
  },
});

defineAsset({
  name: 'grotto-mouth', group: 'structure', note: 'outside: the stepping slabs along the ledge and the cave mouth behind the falls (world placed)',
  build() {
    const g = new THREE.Group();
    const m = new THREE.Mesh(buildOutside(), toon(0xffffff, { vertexColors: true, side: THREE.DoubleSide }));
    g.add(m, glowCard());
    g.position.set(-MOUTH.x, -MOUTH.y, -MOUTH.z - 6);
    return g;
  },
});
