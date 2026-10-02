/**
 * Gallery registrations for your own pet (companion.ts builds through the same models: companionModels.ts on the
 * village pets' rig, petBody.ts). Assets `puppy`, `kitten`, `fox-kit`: variant = a loop (`walk`, `run`, `sit`, `point`,
 * `fetch` …; the first coat), `sit:<coat>` for each coat, or `coats` (every coat side by side). Also `foundlings` (the adoption basket) and `fetch-stick`.
 */
import * as THREE from 'three';
import { defineAsset } from '../assets.ts';
import { PetBody, galleryInput, petInput } from './petBody.ts';
import type { PetInput } from './petBody.ts';
import { COATS, SPECIES_K, basketMesh, companionModel, familyOf, stickMesh } from './companionModels.ts';
import type { Species } from '../../model/pet.ts';

const LOOPS: Record<Species, readonly string[]> = {
  puppy: ['stand', 'walk', 'trot', 'run', 'sit', 'lie', 'sleep', 'belly', 'bow', 'sniff', 'tilt', 'pet', 'point', 'fetch', 'shake', 'coats'],
  kitten: ['stand', 'walk', 'trot', 'run', 'sit', 'loaf', 'sleep', 'stretch', 'groom', 'pet', 'slowblink', 'bump', 'bow', 'fetch', 'coats'],
  fox: ['stand', 'walk', 'trot', 'run', 'sit', 'lie', 'sleep', 'sniff', 'tilt', 'pet', 'point', 'fetch', 'coats'],
};

interface Live { bodies: PetBody[]; loop: string; inp: PetInput }
const live = new WeakMap<THREE.Object3D, Live>();

function input(species: Species, loop: string, t: number, param: number, o: PetInput): PetInput {
  const fam = familyOf(species);
  if (loop === 'point') { Object.assign(o, petInput('point')); o.joy = 0.8; o.ears = 1; return o; }
  if (loop === 'fetch') { galleryInput(fam, 'trot', t, param, o); o.speed = fam === 'cat' ? 1.6 : 3.2; o.joy = 1; o.ears = 0.4; o.pant = 0; return o; }
  if (loop === 'bow') { Object.assign(o, petInput('bow')); o.joy = 1; o.ears = 1; return o; }
  if (loop === 'run') { galleryInput(fam, fam === 'cat' ? 'trot' : 'run', t, param, o); o.speed = fam === 'cat' ? 4.2 : 6.5; o.pant = fam === 'cat' ? 0 : 1; return o; }
  if (loop === 'sit' || loop === 'coats') { Object.assign(o, petInput('sit')); o.joy = 0.7; o.lookYaw = Math.sin(t * 0.6) * 0.3; return o; }
  return galleryInput(fam, loop, t, param, o);
}

function asset(species: Species, name: string, note: string) {
  const coats = Object.keys(COATS[species]);
  defineAsset({
    name, group: 'animal', note, variants: [...LOOPS[species], ...coats.map((c) => `sit:${c}`)], param: 'speed',
    build(o) {
      const [loop, coatV] = (o.variant ?? 'sit').split(':');
      const g = new THREE.Group();
      const bodies: PetBody[] = [];
      const list = loop === 'coats' ? coats : [coatV && coats.includes(coatV) ? coatV : coats[0]];
      const gap = species === 'kitten' ? 0.42 : 0.6;
      list.forEach((c, i) => {
        const b = new PetBody(familyOf(species), companionModel(species, c));
        b.root.position.x = (i - (list.length - 1) / 2) * gap;
        if (loop === 'coats') b.root.rotation.y = 0.35;
        if (loop === 'fetch') {
          const s = stickMesh(), k = SPECIES_K[species];
          b.model.bones.head.add(s);
          if (species === 'kitten') s.position.set(0, -0.026 * k, 0.118 * k); else s.position.set(0, -0.047 * k, (species === 'fox' ? 0.235 : 0.218) * k);
          s.rotation.z = 0.12;
        }
        g.add(b.root);
        bodies.push(b);
      });
      const inp = petInput();
      live.set(g, { bodies, loop, inp });
      for (let i = 0; i < 90; i++) for (const b of bodies) b.animate(1 / 30, i / 30, input(species, loop, i / 30, 0.5, inp));
      return g;
    },
    animate(obj, t0, dt, param) {
      const e = live.get(obj);
      if (!e) return;
      const t = Number.isFinite(t0) ? t0 : performance.now() / 1000;
      const d = Number.isFinite(dt) ? Math.min(0.1, Math.max(dt, 1 / 120)) : 1 / 60;
      for (const b of e.bodies) b.animate(d, t, input(species, e.loop, t, param, e.inp));
    },
  });
}
asset('puppy', 'puppy', 'your pet puppy (adopt at Fern\'s foundlings basket): floppy ears, big paws, follows you, fetches, points at finds; coats golden, beagle, cocoa, speckles');
asset('kitten', 'kitten', 'your pet kitten: huge ears and eyes, a stubby tail; follows you, slow-blinks, plays with the stick; coats ginger, tuxedo, smoke, siamese');
asset('fox', 'fox-kit', 'your pet fox kit (rare: Fern ♥4): big pricked ears, black stockings, a white-tipped brush; coats red, arctic, silver');

defineAsset({
  name: 'foundlings', group: 'prop', note: "Fern's foundlings: a basket by the signpost with a puppy and a kitten asleep in it (E: adopt)",
  build() { const g = new THREE.Group(); g.add(basketMesh()); return g; },
});
defineAsset({
  name: 'fetch-stick', group: 'prop', note: 'the stick you throw for your pet (F)',
  build() { const g = new THREE.Group(); const s = stickMesh(); s.scale.setScalar(3); s.position.y = 0.1; g.add(s); return g; },
});
