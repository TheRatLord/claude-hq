/** Asset registrations for the life package (gallery + systems build through these). */
import * as THREE from 'three';
import { defineAsset } from '../assets.ts';
import { rigMaterial } from './rig.ts';
import type { RigMaterial } from './rig.ts';
import { butterfly, dragonfly, fish, frog, heart, pigeon, rabbit, songbird, squirrel } from './models.ts';
import type { Model } from './models.ts';
import { PetBody } from './pets.ts';
import type { PetPose } from './pets.ts';

type Anim = (a: THREE.Vector4, b: THREE.Vector4, t: number, param: number) => void;

function critter(name: string, note: string, make: () => Model, tint: [number, number, number], scale: number, anim: Anim, variants?: Record<string, [number, number, number]>) {
  defineAsset({
    name, group: 'animal', note, variants: variants ? Object.keys(variants) : undefined, param: 'motion',
    build(o) {
      const m = make();
      const mat = rigMaterial(m.spec, { instanced: false, side: THREE.DoubleSide });
      const c = (o.variant && variants?.[o.variant]) || tint;
      mat.userData.tint.setRGB(c[0], c[1], c[2]);
      const mesh = new THREE.Mesh(m.geo, mat);
      mesh.scale.setScalar(scale);
      const g = new THREE.Group();
      g.add(mesh);
      anim(mat.userData.animA, mat.userData.animB, 0, 0.5);
      return g;
    },
    animate(obj, t0, _dt, param) {
      const t = Number.isFinite(t0) ? t0 : performance.now() / 1000;
      const mesh = obj.children[0] as THREE.Mesh | undefined;
      const mat = mesh?.material as RigMaterial | undefined;
      if (mat?.userData.animA) anim(mat.userData.animA, mat.userData.animB, t, param);
    },
  });
}

const flap: Anim = (a, b, t, p) => { a.set(p > 0.5 ? Math.sin(t * 24) * 0.95 + 0.25 : -0.75, p <= 0.5 ? Math.max(0, Math.sin(t * 5)) * 0.9 : 0, p <= 0.5 ? Math.sin(t * 0.8) * 0.6 : 0, 0); b.set(p > 0.5 ? 0 : -1, p > 0.5 ? 0 : -1, 0, 0); };

critter('songbird', 'flocks over the valley; lands, hops and pecks (motion > 0.5 = flying)', songbird, [0.78, 0.55, 0.36], 1.15, flap,
  { sparrow: [0.78, 0.55, 0.36], bluebird: [0.45, 0.66, 1], finch: [0.98, 0.8, 0.32], robin: [0.9, 0.5, 0.42], crow: [0.17, 0.17, 0.22] });
critter('pigeon', 'carrier pigeon = network: flies the farmhouse loft ↔ fields/edges with a letter', pigeon, [1, 1, 1], 1,
  (a, b, t, p) => { flap(a, b, t, p); b.x = 0; });
critter('butterfly', 'meadows and thriving fields on clear days', butterfly, [1, 0.86, 0.3], 1.35,
  (a, _b, t, p) => a.set(0.55 + Math.sin(t * (4 + p * 14)) * 0.75, 0, 0, 0),
  { lemon: [1, 0.86, 0.3], white: [1, 1, 0.97], orange: [1, 0.62, 0.25], blue: [0.55, 0.72, 1], pink: [1, 0.66, 0.82] });
critter('dragonfly', 'darts and hovers over the pond and river', dragonfly, [0.3, 0.85, 0.8], 1.5,
  (a, _b, t) => a.set(Math.sin(t * 55) * 0.35 + 0.05, 0, 0, 0), { teal: [0.3, 0.85, 0.8], blue: [0.35, 0.55, 1], red: [0.95, 0.38, 0.28] });
critter('fish', 'jumps in the pond and river with splash rings; koi circle under the pond', fish, [1, 0.58, 0.28], 1.2,
  (a, _b, t, p) => a.set(Math.sin(t * (4 + p * 26)) * 0.5, 0, 0, 0), { koi: [1, 0.58, 0.28], trout: [0.72, 0.8, 0.78], perch: [0.62, 0.72, 0.5] });
critter('frog', 'pond bank; croaks at night (throat pouch), plops into the water when you come close', frog, [1, 1, 1], 1.6,
  (a, _b, t, p) => { const c = (t % 3) / 3; a.set(c < p ? Math.max(0, Math.sin((c / Math.max(0.05, p)) * Math.PI * 3)) : 0, 0, 0, 0); });
critter('rabbit', 'meadows at dawn and dusk; hops away when approached', rabbit, [0.8, 0.62, 0.46], 1.3,
  (a, _b, t) => a.set(0, 0.45 + Math.max(0, Math.sin(t * 9)) * 0.15, Math.max(0, Math.sin(t * 1.3)) * 0.5, Math.max(0, Math.sin(t * 1.1 + 2)) * 0.5),
  { brown: [0.8, 0.62, 0.46], grey: [0.74, 0.72, 0.7], cream: [0.97, 0.93, 0.85] });
critter('squirrel', 'scampers, stands up, flicks its tail, chatters', squirrel, [1, 1, 1], 1.25,
  (a, _b, t) => a.set(Math.sin(t * 6) * 0.3, 0.2, Math.sin(t * 0.7) * 0.5, 0));

defineAsset({
  name: 'pet-heart', group: 'fx', note: 'hearts that float up when you pet an animal',
  build() {
    const m = heart();
    const mat = rigMaterial(m.spec, { instanced: false, emissive: 0x5a1020 });
    const g = new THREE.Group();
    const mesh = new THREE.Mesh(m.geo, mat);
    mesh.scale.setScalar(3);
    mesh.position.y = 0.3;
    g.add(mesh);
    return g;
  },
  animate(obj, t) { const m = obj.children[0]; if (m) { m.position.y = 0.3 + Math.sin(t * 2) * 0.05; m.rotation.y = Math.sin(t) * 0.4; } },
});

/** gallery pets: body per built root (userData must stay JSON-clonable) */
const petBodies = new WeakMap<THREE.Object3D, { body: PetBody; pose: PetPose }>();

function pet(kind: 'dog' | 'cat', name: string, note: string) {
  const poses: PetPose[] = ['stand', 'walk', 'sit', 'lie', 'stretch', 'loaf', 'curl'];
  defineAsset({
    name, group: 'animal', note, variants: poses, param: 'speed / joy',
    build(o) {
      const b = new PetBody(kind);
      const pose = (o.variant ?? 'stand') as PetPose;
      petBodies.set(b.root, { body: b, pose });
      for (let i = 0; i < 60; i++) b.animate(1 / 30, i / 30, { pose, speed: 0, wag: 0.5, lookYaw: 0, lookPitch: 0, bounce: 0, sniff: false });
      return b.root;
    },
    animate(obj, t0, dt, param) {
      const t = Number.isFinite(t0) ? t0 : performance.now() / 1000;
      const e = petBodies.get(obj);
      if (!e) return;
      const { body: b, pose } = e;
      b.animate(Number.isFinite(dt) ? Math.min(0.1, Math.max(dt, 1 / 120)) : 1 / 60, t, { pose, speed: pose === 'walk' ? param * 7 : 0, wag: param, lookYaw: Math.sin(t * 0.5) * 0.4, lookPitch: 0, bounce: pose === 'stand' && param > 0.8 ? 1 : 0, sniff: false });
    },
  });
}
pet('dog', 'dog', 'Biscuit: greets you, follows you, sits when you stop; pet him (hearts + bark)');
pet('cat', 'cat', 'Mochi: naps on the porch and warm spots, stretches, strolls; pet her (purr + hearts)');
