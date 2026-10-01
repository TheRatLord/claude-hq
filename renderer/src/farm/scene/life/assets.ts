/** Asset registrations for the life package (gallery + systems build through these). */
import * as THREE from 'three';
import { defineAsset } from '../assets.ts';
import { rigMaterial } from './rig.ts';
import type { RigMaterial } from './rig.ts';
import { butterfly, dragonfly, fish, frog, heart, pigeon, rabbit, songbird, squirrel } from './models.ts';
import { birdAir, birdGround, body, butterflyWings, dragonWings, fishWave, frogIdle, frogJump, pigeonStrut, rabbitHop, rabbitIdle, squirrelBound, squirrelTail } from './critterAnim.ts';
import type { Body } from './critterAnim.ts';
import { BUTTERFLIES, DRAGONS, FISH, RABBITS } from './palette.ts';
import type { Model } from './models.ts';
import { CAT_LOOPS, DOG_LOOPS, PetBody, galleryInput, petInput } from './petBody.ts';
import type { PetInput, PetKind } from './petBody.ts';

type Loop = (ch: Float32Array, b: Body, t: number, param: number) => void;
const CH = new Float32Array(12);
const B = body();

/** species tints: [back, breast] */
export const SONGBIRDS: Record<string, [[number, number, number], [number, number, number]]> = {
  sparrow: [[0.8, 0.58, 0.4], [0.97, 0.92, 0.84]],
  bluebird: [[0.45, 0.64, 1], [1, 0.66, 0.42]],
  goldfinch: [[1, 0.84, 0.28], [1, 0.9, 0.45]],
  robin: [[0.62, 0.56, 0.52], [1, 0.52, 0.32]],
  chickadee: [[0.72, 0.74, 0.72], [1, 0.95, 0.85]],
};
const CROW_TINT: [[number, number, number], [number, number, number]] = [[0.17, 0.17, 0.22], [0.22, 0.22, 0.28]];

function critter(name: string, note: string, make: () => Model, scale: number, loops: Record<string, Loop>,
  tints: (variant: string, param: number) => [[number, number, number], [number, number, number]]) {
  const names = Object.keys(loops);
  defineAsset({
    name, group: 'animal', note, variants: names, param: 'speed / species',
    build(o) {
      const m = make();
      const mat = rigMaterial(m.spec, { instanced: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(m.geo, mat);
      mesh.rotation.order = 'YXZ';
      const g = new THREE.Group();
      g.add(mesh);
      g.userData.loop = o.variant ?? names[0];
      g.userData.scale = scale;
      apply(g, loops[g.userData.loop as string] ?? loops[names[0]], 0, 0.5, tints);
      return g;
    },
    animate(obj, t0, _dt, param) {
      const t = Number.isFinite(t0) ? t0 : performance.now() / 1000;
      apply(obj, loops[obj.userData.loop as string] ?? loops[names[0]], t, param, tints);
    },
  });
}
function apply(g: THREE.Object3D, loop: Loop, t: number, param: number, tints: (v: string, p: number) => [[number, number, number], [number, number, number]]) {
  const mesh = g.children[0] as THREE.Mesh | undefined;
  const mat = mesh?.material as RigMaterial | undefined;
  if (!mesh || !mat?.userData.animA) return;
  CH.fill(0);
  loop(CH, B, t, param);
  const u = mat.userData;
  u.animA.set(CH[0], CH[1], CH[2], CH[3]); u.animB.set(CH[4], CH[5], CH[6], CH[7]); u.animC.set(CH[8], CH[9], CH[10], CH[11]);
  const [a, b] = tints(g.userData.loop as string, param);
  u.tint.setRGB(a[0], a[1], a[2]); u.tint2.setRGB(b[0], b[1], b[2]);
  const s = g.userData.scale as number;
  mesh.position.y = B.y * s;
  mesh.rotation.set(B.pitch, 0, B.roll);
  mesh.scale.set(s * B.sx, s * B.sy, s * B.sz);
}
const pick = <T,>(o: Record<string, T>, p: number): T => { const v = Object.values(o); return v[Math.min(v.length - 1, Math.floor(p * v.length))]; };
const same = (c: [number, number, number]) => (): [[number, number, number], [number, number, number]] => [c, c];

critter('songbird', 'flocks: bounding flight, glides, a landing flare; hops, pecks and head tilts on the ground (param = species)', songbird, 1.3, {
  fly: (ch, b, t) => birdAir('flap', t * 12, t, ch, b),
  glide: (ch, b, t) => birdAir('glide', 0, t, ch, b),
  bound: (ch, b, t) => { const c = t % 1.1; if (c < 0.55) birdAir('flap', c * 13, t, ch, b); else birdAir('bound', 0, t, ch, b); b.y += Math.sin(c / 1.1 * Math.PI * 2) * 0.03; },
  flare: (ch, b, t) => birdAir('flare', t * 16, t, ch, b),
  hop: (ch, b, t) => { const c = t % 0.9; birdGround(ch, b, 0, 0, 0, 0, c < 0.22 ? c / 0.22 : 0); },
  peck: (ch, b, t) => { const c = t % 1.3; birdGround(ch, b, c < 0.3 ? c / 0.3 : c > 0.5 && c < 0.8 ? (c - 0.5) / 0.3 : 0, Math.sin(t * 0.8) * 0.4, 0, 0, 0); },
  tilt: (ch, b, t) => { const c = t % 3; birdGround(ch, b, 0, c < 1.5 ? 0.3 : -0.3, c < 1.5 ? 0.5 : -0.45, c > 2.6 ? 0.6 : 0, 0); },
  crow: (ch, b, t) => { const c = t % 3; if (c < 1.3) birdAir('flap', t * 4.2, t, ch, b, 1.25); else birdAir('soar', 0, t, ch, b); },
}, (v, p) => (v === 'crow' ? CROW_TINT : pick(SONGBIRDS, p)));

critter('pigeon', 'carrier pigeon = network: flies loft ↔ fields with a letter in its pouch; struts with a head-bob', pigeon, 1.15, {
  fly: (ch, b, t) => { birdAir('flap', t * 9, t, ch, b); ch[6] = 0; },
  strut: (ch, b, t) => pigeonStrut(t * 1.6, 0.05, ch, b),
  land: (ch, b, t) => { birdAir('flare', t * 12, t, ch, b); ch[6] = 0; },
  coo: (ch, b, t) => { ch.fill(0); b.y = 0; b.pitch = 0; b.roll = 0; b.sx = b.sz = 1; ch[4] = -1; ch[0] = -0.3; const c = t % 2.4; const k = c < 0.9 ? Math.sin(c / 0.9 * Math.PI) : 0; b.sy = 1 + k * 0.06; b.sx = b.sz = 1 + k * 0.08; ch[2] = -k * 0.3; ch[10] = Math.sin(t * 2.2) * 0.01; ch[6] = -1; },
}, same([1, 1, 1]));

critter('butterfly', 'flutters in bursts with little glides; lands on flowers and basks, wings slowly opening and closing (param = colour)', butterfly, 1.6, {
  fly: (ch, b, t) => { const lift = butterflyWings(t, 'fly', 0.3, ch); b.y = 0.2 + lift * 0.02 + Math.sin(t * 1.3) * 0.03; b.pitch = -0.2; b.roll = 0; b.sx = b.sy = b.sz = 1; },
  rest: (ch, b, t) => { butterflyWings(t, 'rest', 0.3, ch); b.y = 0; b.pitch = 0.1; b.roll = 0; b.sx = b.sy = b.sz = 1; },
}, (_v, p) => pick(BUTTERFLIES, p));

critter('dragonfly', 'hovers, darts, hovers; perches on reeds (param = colour)', dragonfly, 1.8, {
  hover: (ch, b, t) => { dragonWings(t, 0.4, false, ch); b.y = 0.15 + Math.sin(t * 3) * 0.01; b.pitch = 0.05; b.roll = 0; b.sx = b.sy = b.sz = 1; },
  dart: (ch, b, t) => { dragonWings(t, 0.4, false, ch); const c = t % 1.2; b.y = 0.15; b.pitch = c < 0.2 ? 0.45 * Math.sin(c / 0.2 * Math.PI) : 0; b.roll = 0; b.sx = b.sy = b.sz = 1; },
  perch: (ch, b, t) => { dragonWings(t, 0.4, true, ch); b.y = 0; b.pitch = 0; b.roll = 0; b.sx = b.sy = b.sz = 1; },
}, (_v, p) => pick(DRAGONS, p));

critter('fish', 'koi glide under the pond with a body wave; trout and perch leap with a spin and a splash (param = species)', fish, 1.4, {
  swim: (ch, b, t) => { fishWave(t, 0.2, ch); b.y = 0.1; b.pitch = 0; b.roll = 0; b.sx = b.sy = b.sz = 1; },
  dash: (ch, b, t) => { fishWave(t, 1, ch); b.y = 0.1; b.pitch = 0; b.roll = 0; b.sx = b.sy = b.sz = 1; },
  jump: (ch, b, t) => { const k = (t % 1.6) / 1.1; fishWave(t, 1, ch); b.y = k < 1 ? 0.1 + Math.sin(k * Math.PI) * 0.5 : 0.1; b.pitch = k < 1 ? -Math.cos(k * Math.PI) * 1.1 : 0; b.roll = k < 1 ? k * Math.PI * 2 : 0; b.sx = b.sy = b.sz = 1; },
}, (_v, p) => pick(FISH, p));

critter('frog', 'pond bank: breathes, blinks, croaks with a throat sac; leaps with legs flung out and plops in', frog, 1.8, {
  sit: (ch, b, t) => { const c = t % 4; frogIdle(t, c < 1.2 ? Math.max(0, Math.sin(c / 1.2 * Math.PI * 2)) : 0, c > 2.5 && c < 2.7 ? Math.sin((c - 2.5) / 0.2 * Math.PI) : 0, ch, b); },
  jump: (ch, b, t) => { const k = (t % 1.4) / 0.7; if (k < 1) frogJump(k, 0.13, ch, b); else frogIdle(t, 0, 0, ch, b); },
}, same([1, 1, 1]));

critter('rabbit', 'meadows at dawn and dusk: nibbles, twitches its nose, turns its ears, grooms; freezes, then bolts', rabbit, 1.5, {
  hop: (ch, b, t) => { const c = t % 0.9; if (c < 0.42) rabbitHop(c / 0.42, 0.14, ch, b); else rabbitIdle(t, { nibble: 0, groom: 0, alert: 0, earL: 0, earR: 0, turnL: 0, turnR: 0 }, ch, b); },
  bolt: (ch, b, t) => { rabbitHop((t % 0.33) / 0.33, 0.3, ch, b); ch[9] = 0.5; },
  graze: (ch, b, t) => rabbitIdle(t, { nibble: 1, groom: 0, alert: 0, earL: Math.max(0, Math.sin(t * 0.7)) * 0.4, earR: 0, turnL: Math.sin(t * 0.5) * 0.4, turnR: Math.sin(t * 0.4 + 1) * 0.5 }, ch, b),
  groom: (ch, b, t) => rabbitIdle(t, { nibble: 0, groom: 1, alert: 0, earL: 0, earR: 0, turnL: 0, turnR: 0 }, ch, b),
  alert: (ch, b, t) => rabbitIdle(t, { nibble: 0, groom: 0, alert: 1, earL: 0, earR: 0, turnL: Math.sin(t * 1.3) * 0.5, turnR: Math.sin(t * 1.1 + 2) * 0.5 }, ch, b),
}, (_v, p) => { const c = pick(RABBITS, p); return [c, c]; });

critter('squirrel', 'bounds with an S-curved tail, sits up to nibble a nut, chatters with tail flicks', squirrel, 1.4, {
  bound: (ch, b, t) => squirrelBound(t * 2.6, 0.08, ch, b),
  nibble: (ch, b, t) => { b.y = 0; b.roll = 0; b.sx = b.sy = b.sz = 1; b.pitch = -1.05; squirrelTail(t, 0, ch); ch[2] -= 0.95; ch[5] = -1.7; ch[0] = 0.55 + Math.max(0, Math.sin(t * 14)) * 0.08; ch[7] = 0; ch[6] = 0.9; },
  chatter: (ch, b, t) => { b.y = 0; b.roll = 0; b.sx = b.sy = b.sz = 1; b.pitch = -0.2; squirrelTail(t, 1, ch); ch[0] = -0.2 + Math.sin(t * 20) * 0.04; ch[7] = -1; },
}, same([1, 1, 1]));

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
const petBodies = new WeakMap<THREE.Object3D, { body: PetBody; loop: string; inp: PetInput }>();

function pet(kind: PetKind, name: string, note: string, loops: readonly string[]) {
  defineAsset({
    name, group: 'animal', note, variants: loops, param: 'speed / joy',
    build(o) {
      const b = new PetBody(kind);
      const loop = o.variant ?? 'stand';
      const inp = petInput();
      petBodies.set(b.root, { body: b, loop, inp });
      for (let i = 0; i < 90; i++) b.animate(1 / 30, i / 30, galleryInput(kind, loop, i / 30, 0.5, inp));
      return b.root;
    },
    animate(obj, t0, dt, param) {
      const t = Number.isFinite(t0) ? t0 : performance.now() / 1000;
      const e = petBodies.get(obj);
      if (!e) return;
      e.body.animate(Number.isFinite(dt) ? Math.min(0.1, Math.max(dt, 1 / 120)) : 1 / 60, t, galleryInput(kind, e.loop, t, param, e.inp));
    },
  });
}
pet('dog', 'dog', 'Biscuit: greets you at a gallop, heels, sits, plays, sleeps curled on the porch; pet him (hearts + bark)', DOG_LOOPS);
pet('cat', 'cat', 'Mochi: naps, loafs, stretches, grooms, kneads, walks the fence; pet her (purr + slow blink)', CAT_LOOPS);
