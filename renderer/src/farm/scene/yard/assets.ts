/** Asset registrations for the yard package (the gallery and the system build through models.ts). */
import * as THREE from 'three';
import { defineAsset } from '../assets.ts';
import type { AssetBuildOpts } from '../assets.ts';
import { DECOR } from '../../model/shop.ts';
import { Kit, solidMat } from '../structures/kit.ts';
import { warmEmitter } from '../lights/emitters.ts';
import { buildDecor, buildStore } from './models.ts';
import type { DecorOut } from './models.ts';

const bulbMaterial = (night = 0): THREE.MeshBasicMaterial => {
  const m = warmEmitter(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  m.color.setScalar(0.8 + night * 1.7);
  return m;
};

function kitGroup(o: AssetBuildOpts, fn: (k: Kit, bk: Kit) => DecorOut | void): THREE.Group {
  const g = new THREE.Group();
  const k = new Kit(o.seed + 3), bk = new Kit(o.seed + 4);
  const out = fn(k, bk);
  // the system swings chime tubes as instances; the gallery hangs them still
  for (const s of out?.swing ?? []) k.cyl(0.013, s.len, 0xc08a5a, { x: s.x, y: s.y - s.len / 2, z: s.z }, 6);
  const sg = k.geometry('solid'), bg = bk.geometry('solid');
  if (sg) { const m = new THREE.Mesh(sg, solidMat()); m.castShadow = true; m.receiveShadow = true; g.add(m); }
  if (bg) g.add(new THREE.Mesh(bg, bulbMaterial(o.night ?? 0)));
  return g;
}

/** variant `id` or `id:style` (e.g. `scarecrow:2` for the witch hat) */
defineAsset({
  name: 'decor', group: 'prop', note: 'yard decor from the General store (your yard, behind the farmhouse)',
  variants: DECOR.flatMap((d) => [d.id, ...(d.styles ?? []).slice(1).map((_, i) => `${d.id}:${i + 1}`)]),
  build(o) {
    const [id, style] = (o.variant ?? DECOR[0].id).split(':');
    return kitGroup(o, (k, bk) => buildDecor(k, bk, id, Number(style) || 0, o.season));
  },
});

defineAsset({
  name: 'general-store', group: 'structure', note: 'the General store cart south-east of the square (E browse, F sell your basket)',
  build: (o) => kitGroup(o, (k, bk) => buildStore(k, bk, o.season)),
});
