/** Asset registrations for the forage & fishing package (the gallery and the system build through models.ts). */
import * as THREE from 'three';
import { defineAsset } from '../assets.ts';
import { toon } from '../toon.ts';
import { FISHES, FORAGE } from '../../model/collection.ts';
import { bobberGeometry, catchGeometry, forageGeometry, rodGeometry } from './models.ts';

/** shared materials: the forageables / catch (vertex colours), the frost crystal (a cold inner glow) */
export const forageMaterial = (): THREE.MeshToonMaterial => toon(0xffffff, { vertexColors: true });
export const crystalMaterial = (): THREE.MeshToonMaterial => toon(0xffffff, { vertexColors: true, emissive: 0x2a6a8a, emissiveIntensity: 0.6 });
/** the grotto's glow-cap (scene/grotto): a soft sea-green glow of its own */
export const glowcapMaterial = (): THREE.MeshToonMaterial => toon(0xffffff, { vertexColors: true, emissive: 0x2fb88a, emissiveIntensity: 0.85 });
export const materialFor = (id: string): THREE.MeshToonMaterial => (id === 'crystal' ? crystalMaterial() : id === 'glowcap' ? glowcapMaterial() : forageMaterial());

defineAsset({
  name: 'forage', group: 'prop', note: 'the season\'s forageables (pick up with E; Collections book K)',
  variants: FORAGE.map((d) => d.id),
  build(o) {
    const id = o.variant ?? FORAGE[0].id;
    const g = new THREE.Group();
    const m = new THREE.Mesh(forageGeometry(id), materialFor(id));
    m.scale.setScalar(2.5); // gallery framing
    g.add(m);
    return g;
  },
  animate(obj, t) { obj.rotation.y = t * 0.4; },
});

defineAsset({
  name: 'catch', group: 'animal', note: 'what bites at the pond and the river (and what else comes up)',
  variants: FISHES.map((d) => d.id),
  build(o) {
    const id = o.variant ?? FISHES[0].id;
    const g = new THREE.Group();
    const m = new THREE.Mesh(catchGeometry(id), forageMaterial());
    m.rotation.y = Math.PI / 2;
    m.position.y = 0.4;
    m.scale.setScalar(2);
    g.add(m);
    return g;
  },
  animate(obj, t) { const m = obj.children[0]; if (m) m.rotation.z = Math.sin(t * 6) * 0.15; },
});

defineAsset({
  name: 'fishing-rod', group: 'prop', note: 'the player\'s rod and bobber',
  build() {
    const g = new THREE.Group();
    const rod = new THREE.Mesh(rodGeometry(), forageMaterial());
    rod.rotation.z = -0.5;
    g.add(rod);
    const bob = new THREE.Mesh(bobberGeometry(), forageMaterial());
    bob.position.set(1.1, 0.3, 0);
    bob.scale.setScalar(2);
    g.add(bob);
    return g;
  },
  animate(obj, t) { const b = obj.children[1]; if (b) b.position.y = 0.3 + Math.sin(t * 2.5) * 0.03; },
});
