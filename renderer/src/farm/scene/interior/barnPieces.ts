/**
 * The barn's live pieces (barn-local frame, barnLayout.ts), each one draw call:
 *  - the stable: Daisy the cow, Pepper the donkey, two sheep and four hens on the pen animals' rig (scene/plots/rig.ts:
 *    blinking, chewing, ear flicks, tail swishes in the shader). Inside, nobody walks far, so each species is two
 *    instanced meshes: the body with its legs baked standing (a lying animal sinks its legs into the straw) and the
 *    head on its neck (looks at you, eats, nods off at night);
 *  - the eggs in the nest boxes, the hay / grain put out today, the hearts that pop over a happy animal;
 *  - the machine room: dial faces, the thermometer scale, the chart recorder's paper, the stall boards and the chores
 *    slate on one canvas atlas; needles, the thermometer's column and the indicator bulbs as one instanced mesh;
 *  - the swallows that loop round the rafters by day and sit in their nests at night (wings flap in the shader);
 *  - dust motes drifting in the daylight; the thing you are carrying (hay, a grain scoop, the curry brush).
 * Nothing here allocates per frame.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Season } from '../../model/types.ts';
import type { Levels } from '../structures/rig.ts';
import { ioLevel } from '../structures/rig.ts';
import { PAL, toonRamp } from '../toon.ts';
import { FONT, HAND, Kit, canvasTex, fitText, roundRect, woodPanel } from '../structures/kit.ts';
import { Batch } from '../plots/batch.ts';
import { BEASTS, eggGeo } from '../plots/beasts.ts';
import { rigDepthMaterial, rigMaterial } from '../plots/rig.ts';
import { spring, springAngle, springTo, wrapAngle } from '../plots/gait.ts';
import type { Spring } from '../plots/gait.ts';
import type { V3 } from '../plots/geo.ts';
import { DONKEY } from './donkey.ts';
import { B, BARN_ROOM, LOFT } from './barnLayout.ts';
import { DIALS, SWALLOW_NESTS } from './barnRoom.ts';
import type { BarnData, BarnAnimal } from '../../model/barn.ts';

const F = BARN_ROOM.floor;
const TAU = Math.PI * 2;
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _m3 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const ONE = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// ------------------------------------------------------------------------------------------------- the stable

type SpKey = 'cow' | 'donkey' | 'sheep' | 'hen';
interface SpDef {
  body(season: Season): THREE.BufferGeometry; head(): THREE.BufferGeometry; upper(): THREE.BufferGeometry; lower(): THREE.BufferGeometry;
  hips: readonly V3[]; bones: readonly (readonly [number, number])[]; boneGeo: readonly [number, number];
  cog: V3; neck: V3; lieDrop: readonly [number, number];
}
interface Species { key: SpKey; def: SpDef; size: number; eat: number; body: Batch; head: Batch }

/** body + legs hanging straight (rest pose), merged into one rig geometry */
function bakeStanding(def: SpDef, season: Season): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [def.body(season).clone()];
  for (let i = 0; i < def.hips.length; i++) {
    const h = def.hips[i], [bu, bl] = def.bones[i];
    parts.push(def.upper().clone().applyMatrix4(_m.compose(_v.set(h[0], h[1], h[2]), _q.identity(), _s.set(1, bu / def.boneGeo[0], 1))));
    parts.push(def.lower().clone().applyMatrix4(_m.compose(_v.set(h[0], h[1] - bu, h[2]), _q.identity(), _s.set(1, bl / def.boneGeo[1], 1))));
  }
  const g = mergeGeometries(parts, false);
  for (const p of parts.slice(1)) p.dispose();
  if (!g) { console.error('[barn] could not bake legs'); return def.body(season).clone(); }
  g.computeBoundingSphere();
  return g;
}

export type BeastId = 'cow' | 'donkey' | 'sheep0' | 'sheep1' | 'hen0' | 'hen1' | 'hen2' | 'hen3';
export interface Beast {
  id: BeastId; group: BarnAnimal; name: string; sp: Species;
  x: number; z: number; y: number; yaw: number;
  tint: THREE.Color; pattern: number; seed: number;
  bodyY: Spring; pitch: Spring; neck: Spring; headYaw: Spring; tilt: Spring; nod: Spring; jaw: Spring; eyes: Spring;
  earL: Spring; earR: Spring; tail: Spring; tailLift: Spring; wing: Spring; squash: Spring;
  act: 'idle' | 'look' | 'graze' | 'rest' | 'peck' | 'preen' | 'perch'; actT: number; lookYaw: number;
  /** seconds left eating what you put out, being happy (petted, brushed), and the blink / ear / tail timers */
  eatT: number; happyT: number; blinkT: number; earT: number; swishT: number; soundT: number;
  /** hens: hopping from (hx0, hz0, hy0) to the spot */
  hop: number; hx0: number; hz0: number; hy0: number; tx: number; tz: number; ty: number; tyaw: number;
}

export interface StableEnv {
  t: number; dt: number;
  /** the animals sleep (night) */
  sleepy: boolean;
  /** the player's eye, room-local */
  px: number; py: number; pz: number;
  /** what's been put out today */
  data: Readonly<BarnData> | null;
}

export interface Stable {
  meshes: THREE.Object3D[];
  beasts: readonly Beast[];
  get(id: BeastId): Beast;
  update(e: StableEnv): void;
  /** a beast's head, room-local (hearts, sounds) */
  headAt(b: Beast, out: THREE.Vector3): THREE.Vector3;
  dispose(): void;
}

const HEN_DAY: readonly { x: number; z: number; y: number; yaw: number }[] = [
  { x: B.roost[0].x - 0.5, z: B.roost[0].z, y: B.roost[0].y + 0.035, yaw: Math.PI * 0.1 },
  { x: B.nestX - 0.02, z: B.nests[1].z, y: B.nestY + 0.08, yaw: -Math.PI / 2 },
  { x: 2.4, z: -2.15, y: 0.03, yaw: 2.2 },
  { x: 3.6, z: -2.2, y: 0.03, yaw: -2.6 },
];
const HEN_NIGHT: readonly { x: number; z: number; y: number; yaw: number }[] = [
  { x: B.roost[0].x - 0.55, z: B.roost[0].z, y: B.roost[0].y + 0.035, yaw: -Math.PI / 2 + 0.2 },
  { x: B.roost[0].x + 0.05, z: B.roost[0].z, y: B.roost[0].y + 0.035, yaw: -Math.PI / 2 - 0.1 },
  { x: B.roost[1].x + 0.45, z: B.roost[1].z, y: B.roost[1].y + 0.035, yaw: Math.PI / 2 },
  { x: B.roost[1].x - 0.2, z: B.roost[1].z, y: B.roost[1].y + 0.035, yaw: -Math.PI / 2 + 0.3 },
];
/** where the hens peck when grain is down */
const GRAIN_AT = { x: 2.55, z: -2.3 };

export function buildStable(season: Season): Stable {
  const mat = rigMaterial(), depth = rigDepthMaterial();
  const mk = (key: SpKey, def: SpDef, size: number, eat: number, n: number): Species => {
    const body = new Batch(bakeStanding(def, season), mat, n, { shadow: false, rect: true, aux: true, depth, name: `interior:barn-${key}-body` });
    const head = new Batch(def.head().clone(), mat, n, { shadow: false, rect: true, aux: true, depth, name: `interior:barn-${key}-head` });
    return { key, def, size, eat, body, head };
  };
  const cowSp = mk('cow', BEASTS.cow, 1, 0.42, 1);
  const donkeySp = mk('donkey', DONKEY, 1, 0.5, 1);
  const sheepSp = mk('sheep', BEASTS.sheep, 1, 0.12, 2);
  const henSp = mk('hen', BEASTS.chicken, BEASTS.chicken.size, BEASTS.chicken.graze, 4);
  const species = [cowSp, donkeySp, sheepSp, henSp];

  const beast = (id: BeastId, group: BarnAnimal, name: string, sp: Species, x: number, z: number, yaw: number, tint: number, pattern: number, seed: number): Beast => ({
    id, group, name, sp, x, z, y: 0, yaw, tint: new THREE.Color(tint), pattern, seed,
    bodyY: spring(), pitch: spring(), neck: spring(), headYaw: spring(), tilt: spring(), nod: spring(), jaw: spring(), eyes: spring(),
    earL: spring(), earR: spring(), tail: spring(), tailLift: spring(), wing: spring(), squash: spring(1),
    act: 'idle', actT: 2 + seed * 4, lookYaw: 0, eatT: 0, happyT: 0, blinkT: 1 + seed * 3, earT: 2 + seed * 2, swishT: 3 + seed * 5, soundT: 0,
    hop: 1, hx0: x, hz0: z, hy0: 0, tx: x, tz: z, ty: 0, tyaw: yaw,
  });
  const beasts: Beast[] = [
    beast('cow', 'cow', 'Daisy', cowSp, B.cow.x, B.cow.z, B.cow.yaw, 0xffffff, 1, 0.31),
    beast('donkey', 'donkey', 'Pepper', donkeySp, B.donkey.x, B.donkey.z, B.donkey.yaw, 0xffffff, 0, 0.62),
    beast('sheep0', 'sheep', 'Cotton', sheepSp, B.sheep[0].x, B.sheep[0].z, B.sheep[0].yaw, 0xffffff, 0, 0.17),
    beast('sheep1', 'sheep', 'Sooty', sheepSp, B.sheep[1].x, B.sheep[1].z, B.sheep[1].yaw, 0x4a4446, 0, 0.83),
    ...[0xc87444, 0xffffff, 0xeebc78, 0xf4f0e8].map((tint, i) => {
      const s = HEN_DAY[i];
      const b = beast(`hen${i}` as BeastId, 'hens', ['Nugget', 'Henrietta', 'Biscuit', 'Pepper Jr.'][i], henSp, s.x, s.z, s.yaw, tint, i === 3 ? 4 : 0, 0.13 + i * 0.21);
      b.y = b.ty = s.y; b.tyaw = s.yaw;
      return b;
    }),
  ];
  const byId = new Map(beasts.map((b) => [b.id, b]));
  const meshes: THREE.Object3D[] = species.flatMap((s) => [s.body.mesh, s.head.mesh]);
  const R = new Float32Array(4), X = new Float32Array(4);
  let wasSleepy: boolean | null = null;

  /** hens: pick where to be (day: the roost / the nest box / scratching about; night: the roost; grain: round it) */
  function henTarget(b: Beast, i: number, e: StableEnv, grain: boolean): void {
    let s: { x: number; z: number; y: number; yaw: number };
    if (e.sleepy) s = HEN_NIGHT[i];
    else if (grain && i >= 2 && b.eatT > 0) { const a = i * 2.1; s = { x: GRAIN_AT.x + Math.cos(a) * 0.32, z: GRAIN_AT.z + Math.sin(a) * 0.22, y: 0.03, yaw: Math.atan2(GRAIN_AT.x - (GRAIN_AT.x + Math.cos(a) * 0.32), GRAIN_AT.z - (GRAIN_AT.z + Math.sin(a) * 0.22)) }; }
    else if (i >= 2) {
      // scratch about the coop floor
      const r1 = hash(b.seed * 97 + Math.floor(e.t / 9) * 3.1), r2 = hash(b.seed * 31 + Math.floor(e.t / 9) * 7.7);
      s = { x: B.coop.x0 + 0.45 + r1 * (BARN_ROOM.x1 - B.coop.x0 - 1.1), z: BARN_ROOM.z0 + 0.5 + r2 * 1.5, y: 0.03, yaw: (r1 - 0.5) * TAU };
    } else s = HEN_DAY[i];
    if (Math.abs(s.x - b.tx) + Math.abs(s.z - b.tz) + Math.abs(s.y - b.ty) < 0.02) return;
    b.hx0 = b.x; b.hz0 = b.z; b.hy0 = b.y; b.tx = s.x; b.tz = s.z; b.ty = s.y; b.tyaw = s.yaw; b.hop = 0;
  }

  function think(b: Beast, e: StableEnv): void {
    const r = hash(b.seed * 13 + e.t * 0.37);
    if (b.sp.key === 'hen') {
      b.act = r < 0.5 ? 'peck' : r < 0.75 ? 'preen' : 'look';
      b.actT = 1.2 + r * 3;
    } else {
      b.act = r < 0.4 ? 'idle' : r < 0.7 ? 'look' : r < 0.92 || b.sp.key === 'sheep' ? 'graze' : 'rest';
      if (b.act === 'rest' && b.sp.key !== 'cow') b.act = 'idle';
      b.actT = b.act === 'rest' ? 25 + r * 30 : 3 + r * 6;
    }
    b.lookYaw = (hash(b.seed * 7 + e.t) - 0.5) * 1.6;
  }

  function animate(b: Beast, i: number, e: StableEnv): void {
    const dt = e.dt, sp = b.sp, def = sp.def, hen = sp.key === 'hen';
    b.actT -= dt; b.eatT = Math.max(0, b.eatT - dt); b.happyT = Math.max(0, b.happyT - dt);
    if (b.actT <= 0) think(b, e);
    // hens hop between perches, the nest box and the floor
    if (hen) {
      const grain = !!e.data?.fed.includes('hens');
      if (Math.floor((e.t + b.seed * 5) / 0.5) !== Math.floor((e.t - dt + b.seed * 5) / 0.5)) henTarget(b, i, e, grain);
      if (b.hop < 1) {
        b.hop = Math.min(1, b.hop + dt / 0.55);
        const k = b.hop * b.hop * (3 - 2 * b.hop);
        b.x = b.hx0 + (b.tx - b.hx0) * k; b.z = b.hz0 + (b.tz - b.hz0) * k;
        b.y = b.hy0 + (b.ty - b.hy0) * k + Math.sin(b.hop * Math.PI) * (0.18 + Math.abs(b.ty - b.hy0) * 0.4);
        if (Math.hypot(b.tx - b.hx0, b.tz - b.hz0) > 0.05) b.yaw = Math.atan2(b.tx - b.hx0, b.tz - b.hz0);
      } else b.yaw += wrapAngle(b.tyaw - b.yaw) * Math.min(1, dt * 1.5);
    }
    const lying = !hen && (e.sleepy || b.act === 'rest');
    const asleep = e.sleepy;
    const happy = b.happyT > 0;
    // head toward the player when they're close and the animal is awake
    const hx = b.x + Math.sin(b.yaw) * def.neck[2] * sp.size, hz = b.z + Math.cos(b.yaw) * def.neck[2] * sp.size;
    const dx = e.px - hx, dz = e.pz - hz, pd = Math.hypot(dx, dz);
    let yawT = b.act === 'look' ? b.lookYaw : 0;
    if (!asleep && pd < 4.2 && b.eatT <= 0) yawT = Math.max(-1.0, Math.min(1.0, wrapAngle(Math.atan2(dx, dz) - b.yaw)));
    let neckT = asleep ? (hen ? 0.55 : 0.28) : b.eatT > 0 || b.act === 'graze' ? sp.eat : b.act === 'peck' ? sp.eat * (Math.sin(e.t * 9 + b.seed * 9) > 0.2 ? 1 : 0.2) : 0;
    if (!asleep && pd < 4.2 && b.eatT <= 0 && b.act !== 'graze' && b.act !== 'peck') neckT = Math.max(-0.35, Math.min(0.3, -Math.atan2(e.py - (F + b.y + def.neck[1] * sp.size), pd) * 0.6));
    if (b.act === 'preen' && !asleep) { yawT = Math.sin(b.seed * 20) > 0 ? 2.2 : -2.2; neckT = 0.35; }
    springAngle(b.headYaw, asleep ? (hen ? (b.seed > 0.5 ? 2.6 : -2.6) : 0.25) : yawT, 4, dt);
    springTo(b.neck, neckT, 5, dt);
    springTo(b.tilt, happy ? Math.sin(e.t * 2) * 0.15 : b.act === 'look' && !asleep ? 0.12 : 0, 3, dt);
    springTo(b.nod, b.eatT > 0 ? Math.sin(e.t * 5) * 0.12 : asleep ? 0.2 : 0, 6, dt);
    // chewing: hay fast, cud slow; a hen's beak only when pecking
    const chew = hen ? 0 : b.eatT > 0 ? 0.11 * (0.5 + 0.5 * Math.sin(e.t * 9 + b.seed)) : !asleep && b.act !== 'look' ? 0.06 * (0.5 + 0.5 * Math.sin(e.t * 3.2 + b.seed * 4)) : 0;
    springTo(b.jaw, chew, 18, dt);
    // blinks (closed asleep, squinty happy)
    b.blinkT -= dt;
    let eyes = asleep ? 1 : happy ? 0.82 : 0;
    if (b.blinkT < 0.12 && !asleep) eyes = 1;
    if (b.blinkT <= 0) b.blinkT = 2 + hash(b.seed + e.t) * 4;
    springTo(b.eyes, eyes, 30, dt);
    // ear flicks, tail swishes
    b.earT -= dt;
    let flick = 0;
    if (b.earT < 0.25) flick = Math.sin((0.25 - b.earT) / 0.25 * Math.PI) * 0.5;
    if (b.earT <= 0) b.earT = 2.5 + hash(b.seed * 3 + e.t) * 5;
    const earBase = happy ? -0.45 : asleep ? 0.35 : 0;
    springTo(b.earL, earBase + flick, 12, dt);
    springTo(b.earR, earBase - flick * 0.4, 12, dt);
    b.swishT -= dt;
    let sw = happy ? Math.sin(e.t * 9) * 0.5 : 0;
    if (b.swishT < 1.0 && !asleep) sw += Math.sin((1 - b.swishT) * TAU * 1.4) * 0.45;
    if (b.swishT <= 0) b.swishT = 4 + hash(b.seed * 5 + e.t) * 7;
    springTo(b.tail, sw, 10, dt);
    springTo(b.tailLift, hen ? 0.15 : 0, 4, dt);
    springTo(b.wing, hen && b.hop < 1 ? 0.9 * Math.abs(Math.sin(b.hop * Math.PI * 4)) : happy && hen ? 0.25 : 0, 20, dt);
    // lying down into the straw (legs sink under it), breathing
    const drop = (def.lieDrop[0] + def.lieDrop[1]) / 2;
    springTo(b.bodyY, lying ? -drop : 0, lying ? 1.2 : 2, dt);
    const breath = Math.sin(e.t * (asleep ? 1.3 : 2.1) + b.seed * 9) * (asleep ? 0.025 : 0.01);
    springTo(b.squash, (hen && asleep ? 0.88 : 1) + breath, 8, dt);
    springTo(b.pitch, lying ? -0.04 : 0, 2, dt);
  }

  function draw(b: Beast): void {
    const sp = b.sp, def = sp.def, s = sp.size;
    // root: T(x, y, z) × Ry(yaw) × S(size)
    _q.setFromAxisAngle(UP, b.yaw);
    const MR = _m3.compose(_v.set(b.x, F + b.y, b.z), _q, _s.set(s, s, s));
    const cy = def.cog[1];
    _q.setFromEuler(_e.set(b.pitch.x, 0, 0, 'YXZ'));
    const sq = b.squash.x;
    const BL = _m2.compose(_v.set(0, cy + b.bodyY.x, 0), _q, _s.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq)));
    BL.multiply(_m.makeTranslation(0, -cy, 0));
    _m.multiplyMatrices(MR, BL);
    R[0] = b.tail.x; R[1] = b.tailLift.x; R[2] = b.wing.x; R[3] = b.wing.x;
    X[0] = b.seed * 10; X[1] = b.pattern; X[2] = 0; X[3] = 0;
    sp.body.push(_m, b.tint, R, X);
    // head: body × T(neck) × R(neck pitch, head yaw, tilt)
    const n = def.neck;
    _q.setFromEuler(_e.set(b.neck.x, b.headYaw.x, b.tilt.x, 'YXZ'));
    _m.compose(_v.set(n[0], n[1], n[2]), _q, ONE);
    _m.premultiply(BL).premultiply(MR);
    R[0] = b.eyes.x; R[1] = Math.max(0, b.jaw.x); R[2] = b.earL.x; R[3] = b.earR.x;
    X[3] = b.nod.x;
    sp.head.push(_m, b.tint, R, X);
  }

  return {
    meshes,
    beasts,
    get: (id) => byId.get(id)!,
    update(e) {
      if (wasSleepy !== e.sleepy) {
        // wake up / settle down: the hens hop to (or from) the roost
        wasSleepy = e.sleepy;
        beasts.forEach((b) => { b.actT = 0.5 + b.seed; });
      }
      for (const s of species) { s.body.begin(); s.head.begin(); }
      beasts.forEach((b, i) => { animate(b, b.sp.key === 'hen' ? i - 4 : i, e); draw(b); });
      for (const s of species) { s.body.end(); s.head.end(); }
    },
    headAt(b, out) {
      const s = b.sp.size, n = b.sp.def.neck;
      const fwd = (n[2] + 0.35 * (b.sp.key === 'hen' ? 0.3 : 1)) * s;
      return out.set(b.x + Math.sin(b.yaw + b.headYaw.x * 0.5) * fwd, F + b.y + (n[1] + 0.25) * s + b.bodyY.x, b.z + Math.cos(b.yaw + b.headYaw.x * 0.5) * fwd);
    },
    dispose() { for (const s of species) { s.body.mesh.geometry.dispose(); s.head.mesh.geometry.dispose(); s.body.mesh.dispose(); s.head.mesh.dispose(); } },
  };
}

// ------------------------------------------------------------------------------------------------- eggs, feed, hearts

export interface Props { meshes: THREE.Object3D[]; update(t: number, dt: number, data: Readonly<BarnData> | null, eggs: number): void; hearts(x: number, y: number, z: number, n?: number): void; dispose(): void }

const NEST_EGG: readonly [number, number][] = [[0, 0], [0.07, 0.05], [-0.06, 0.06], [0.02, -0.07], [-0.05, -0.04]];
export function buildProps(): Props {
  // eggs: rig material like the hens (shares the program), up to five
  const eggs = new Batch(eggGeo().clone(), rigMaterial(), 5, { shadow: false, rect: true, aux: true, name: 'interior:barn-eggs' });
  // what you put out today: hay in the mangers and the rack, grain scattered in the coop
  const feedGeo = new THREE.DodecahedronGeometry(1, 0);
  const feedMat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonRamp() });
  const feed = new THREE.InstancedMesh(feedGeo, feedMat, 16);
  feed.name = 'interior:barn-feed';
  feed.frustumCulled = false;
  feed.castShadow = false;
  feed.receiveShadow = true;
  feed.count = 0;
  // hearts: unlit, pop and float up
  const hk = new Kit(5);
  hk.ball(0.06, 0xff5a7a, { x: -0.042, y: 0.03 }, 1);
  hk.ball(0.06, 0xff5a7a, { x: 0.042, y: 0.03 }, 1);
  hk.cone(0.083, 0.11, 0xff5a7a, { y: -0.04, rz: Math.PI }, 8);
  const heartGeo = hk.geometry('solid')!;
  const heartMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 0.45, 0.6), fog: false });
  const hearts = new THREE.InstancedMesh(heartGeo, heartMat, 12);
  hearts.name = 'interior:barn-hearts';
  hearts.frustumCulled = false;
  hearts.castShadow = false;
  const H = Array.from({ length: 12 }, () => ({ x: 0, y: 0, z: 0, t: 9, ph: 0 }));
  let hi = 0;
  const R = new Float32Array(4), X = new Float32Array(4);
  const tint = new THREE.Color(), hay = new THREE.Color(PAL.hay), hay2 = new THREE.Color(0xd4b458), grain = new THREE.Color(0xf0c860);
  const put = (i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry: number, c: THREE.Color) => {
    _q.setFromAxisAngle(UP, ry);
    feed.setMatrixAt(i, _m.compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz)));
    feed.setColorAt(i, c);
  };
  let lastFed = '-';
  return {
    meshes: [eggs.mesh, feed, hearts],
    update(t, dt, data, nEggs) {
      eggs.begin();
      R.fill(0); X.fill(0);
      for (let i = 0; i < nEggs && i < 5; i++) {
        const nest = B.nests[i % B.nests.length], o = NEST_EGG[Math.floor(i / B.nests.length) + (i % 2)];
        _q.setFromEuler(_e.set(0.4, i * 1.7, 0.3, 'YXZ'));
        _m.compose(_v.set(B.nestX - 0.02 + o[0], F + B.nestY + 0.04, nest.z + o[1]), _q, _s.set(0.85, 0.85, 0.85));
        tint.set(i % 3 === 1 ? 0xe8c49a : 0xfdf8ec);
        eggs.push(_m, tint, R, X);
      }
      eggs.end();
      // feed (only rewritten when what's been fed changes)
      const key = data ? data.fed.join(',') : '';
      if (key !== lastFed) {
        lastFed = key;
        let n = 0;
        const has = (a: BarnAnimal) => !!data?.fed.includes(a);
        for (const [a, st] of [['cow', B.cowStall], ['donkey', B.donkeyStall]] as const) if (has(a)) {
          const zc = (st.z0 + st.z1) / 2;
          put(n++, B.manger.x, F + 0.8, zc - 0.2, 0.2, 0.09, 0.32, 0.3, hay);
          put(n++, B.manger.x + 0.02, F + 0.83, zc + 0.25, 0.17, 0.08, 0.26, 1.1, hay2);
        }
        if (has('sheep')) for (let i = 0; i < 3; i++) put(n++, B.trough.x + 0.13, F + 0.55, B.trough.z - 0.35 + i * 0.35, 0.14, 0.07, 0.2, i, i % 2 ? hay2 : hay);
        if (has('hens')) for (let i = 0; i < 6; i++) { const a = i * 1.05; put(n++, GRAIN_AT.x + Math.cos(a) * 0.18, F + 0.035, GRAIN_AT.z + Math.sin(a) * 0.12, 0.09, 0.012, 0.08, a, grain); }
        feed.count = n;
        feed.visible = n > 0;
        feed.instanceMatrix.needsUpdate = true;
        if (feed.instanceColor) feed.instanceColor.needsUpdate = true;
      }
      // hearts
      let live = 0;
      for (const h of H) {
        if (h.t > 1.5) continue;
        h.t += dt;
        const k = h.t / 1.5, s = Math.min(1, h.t * 6) * (1 - k * k) * 1.1;
        _q.setFromAxisAngle(UP, Math.sin(t * 2 + h.ph) * 0.4);
        hearts.setMatrixAt(live++, _m.compose(_v.set(h.x + Math.sin(h.t * 3 + h.ph) * 0.06, h.y + h.t * 0.45, h.z), _q, _s.set(s, s, s)));
      }
      hearts.count = live;
      hearts.visible = live > 0;
      if (live) hearts.instanceMatrix.needsUpdate = true;
    },
    hearts(x, y, z, n = 3) {
      for (let i = 0; i < n; i++) {
        const h = H[hi++ % H.length];
        h.x = x + (i - (n - 1) / 2) * 0.16; h.y = y + (i % 2) * 0.08; h.z = z; h.t = -i * 0.18; h.ph = i * 1.7;
      }
    },
    dispose() { eggs.mesh.geometry.dispose(); feedGeo.dispose(); heartGeo.dispose(); feedMat.dispose(); heartMat.dispose(); },
  };
}

// ------------------------------------------------------------------------------------------------- the machine room

/** atlas regions (px) in a 1024 × 512 canvas */
const AT = {
  dial0: [0, 0, 200, 200], dial1: [200, 0, 200, 200], dial2: [400, 0, 200, 200], dial3: [600, 0, 200, 200],
  thermo: [800, 0, 96, 512],
  plate: [0, 200, 512, 64], chart: [0, 264, 512, 64],
  daisy: [512, 200, 288, 64], pepper: [512, 264, 288, 64],
  slate: [0, 328, 400, 184], coop: [400, 328, 400, 64], sheep: [400, 392, 400, 64],
} as const;
type Region = readonly [number, number, number, number];
const DIAL_NAMES = ['CPU', 'RAM', 'DISK', 'NET'] as const;
const DIAL_R = 0.19;

export interface Works {
  meshes: THREE.Object3D[];
  /** dials, thermometer, chart (1 Hz canvas), the slate when the chores change */
  update(t: number, dt: number, lv: Levels, net: number, host: string, cpuHistory: readonly number[] | null, data: Readonly<BarnData> | null, eggs: number, night: number): void;
  dispose(): void;
}

export function buildWorks(): Works {
  const W = 1024, Hh = 512;
  const c = canvasTex(W, Hh);
  const g = c.g;
  const quads: THREE.BufferGeometry[] = [];
  const quad = (w: number, h: number, r: Region, m: THREE.Matrix4, circle = false) => {
    const geo = circle ? new THREE.CircleGeometry(w / 2, 28) : new THREE.PlaneGeometry(w, h);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (r[0] + uv.getX(i) * r[2]) / W, 1 - (r[1] + (1 - uv.getY(i)) * r[3]) / Hh);
    geo.applyMatrix4(m);
    quads.push(geo.index ? geo.toNonIndexed() : geo);
  };
  const M = (x: number, y: number, z: number, ry = 0, rx = 0) => new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, 0, 'YXZ')).setPosition(x, y, z);
  const bz = BARN_ROOM.z1 - 0.112; // faces toward the room (−z), just proud of the bezels
  DIALS.forEach(([x, y], i) => quad(DIAL_R * 2, DIAL_R * 2, [AT.dial0, AT.dial1, AT.dial2, AT.dial3][i], M(x, F + y, bz, Math.PI), true));
  quad(0.22, 1.9, AT.thermo, M(B.thermo.x + 0.45, F + B.thermo.y - 0.15, BARN_ROOM.z1 - 0.09, Math.PI));
  quad(1.2, 0.15, AT.plate, M(B.panel.x - 0.3, F + 2.74, BARN_ROOM.z1 - 0.07, Math.PI));
  // the chart recorder's paper, curling off the drum on the desk
  quad(0.4, 0.05, AT.chart, M(B.panel.x + 0.62, F + 0.84 + 0.16, B.panel.z - 0.195, Math.PI, -0.25));
  // stall boards over each stall front, the coop and pen signs, the chores slate by the door
  quad(0.62, 0.14, AT.daisy, M(B.stallX1 + 0.1, F + 1.62, (B.cowStall.z0 + B.cowStall.z1) / 2, Math.PI / 2));
  quad(0.62, 0.14, AT.pepper, M(B.stallX1 + 0.1, F + 1.62, (B.donkeyStall.z0 + B.donkeyStall.z1) / 2, Math.PI / 2));
  quad(0.7, 0.11, AT.coop, M(B.coop.x0 - 0.05, F + 1.15, -2.9, -Math.PI / 2));
  quad(0.7, 0.11, AT.sheep, M(B.pen.x0 - 0.05, F + 1.15, -0.4, -Math.PI / 2));
  quad(0.86, 0.4, AT.slate, M(SLATE.x, F + SLATE.y, BARN_ROOM.z1 - 0.13, Math.PI));
  const geo = mergeGeometries(quads)!;
  for (const q of quads) q.dispose();
  geo.computeVertexNormals();
  const paperMat = new THREE.MeshToonMaterial({ map: c.tex, gradientMap: toonRamp() });
  const paper = new THREE.Mesh(geo, paperMat);
  paper.name = 'interior:barn-paper';
  paper.receiveShadow = true;

  // the slate's frame and the boards behind the signs are in the room; the frame round the slate here
  // needles (4), the thermometer column, three bulbs: one unlit instanced box
  const nGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const nMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  const needles = new THREE.InstancedMesh(nGeo, nMat, 8);
  needles.name = 'interior:barn-needles';
  needles.frustumCulled = false;
  needles.castShadow = false;
  const ink = new THREE.Color(0.06, 0.04, 0.03), red = new THREE.Color(0.85, 0.12, 0.08);
  const BULBS: readonly [number, number][] = [[3.66, 2.47], [3.79, 2.47], [3.92, 2.47]];
  const bulbOn = [new THREE.Color(0.4, 2.2, 0.6), new THREE.Color(2.4, 1.5, 0.3), new THREE.Color(2.4, 0.5, 0.3)];
  const bulbOff = new THREE.Color(0.12, 0.08, 0.06);
  const val = [0, 0, 0, 0];
  let temp = 0.3, nextDraw = 0, slateKey = '';
  const nz = BARN_ROOM.z1 - 0.125;

  const clip = (r: Region, fn: () => void) => { g.save(); g.beginPath(); g.rect(r[0], r[1], r[2], r[3]); g.clip(); g.translate(r[0], r[1]); fn(); g.restore(); };

  function drawDial(i: number, v: number, text: string): void {
    clip([AT.dial0, AT.dial1, AT.dial2, AT.dial3][i], () => {
      const R0 = 100;
      g.fillStyle = '#c9a03a'; g.fillRect(0, 0, 200, 200);
      const gr = g.createRadialGradient(R0 - 20, R0 - 25, 10, R0, R0, R0);
      gr.addColorStop(0, '#fbf3df'); gr.addColorStop(1, '#e2d2a8');
      g.fillStyle = gr; g.beginPath(); g.arc(R0, R0, R0 - 4, 0, TAU); g.fill();
      // the scale: green → amber → red arc, ticks
      const a0 = Math.PI * 0.75, span = Math.PI * 1.5;
      for (const [f0, f1, col] of [[0, 0.6, '#6aa84f'], [0.6, 0.85, '#e0a030'], [0.85, 1, '#c9452f']] as const) {
        g.strokeStyle = col; g.lineWidth = 9; g.beginPath(); g.arc(R0, R0, R0 - 22, a0 + span * f0, a0 + span * f1); g.stroke();
      }
      g.strokeStyle = '#2b2420';
      for (let k = 0; k <= 10; k++) {
        const a = a0 + span * (k / 10), r1 = R0 - (k % 5 ? 30 : 36);
        g.lineWidth = k % 5 ? 2 : 4;
        g.beginPath(); g.moveTo(R0 + Math.cos(a) * (R0 - 17), R0 + Math.sin(a) * (R0 - 17)); g.lineTo(R0 + Math.cos(a) * r1, R0 + Math.sin(a) * r1); g.stroke();
      }
      g.fillStyle = '#2b2420'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `bold 26px ${FONT}`; g.fillText(DIAL_NAMES[i], R0, R0 + 36);
      // the odometer window
      g.fillStyle = '#2b2420'; roundRect(g, R0 - 42, R0 + 54, 84, 26, 5); g.fill();
      g.fillStyle = v > 0.85 ? '#ff8a6a' : '#f6e8c0'; g.font = `bold 20px ${FONT}`; g.fillText(text, R0, R0 + 68);
      g.font = `italic 12px ${HAND}`; g.fillStyle = '#6e4a2a'; g.fillText('Valley Works', R0, R0 - 40);
    });
  }
  function drawStatic(): void {
    clip(AT.thermo, () => {
      g.fillStyle = '#f6efe0'; g.fillRect(0, 0, 96, 512);
      g.fillStyle = '#2b2420'; g.textAlign = 'right'; g.textBaseline = 'middle'; g.font = `bold 16px ${FONT}`;
      for (let k = 0; k <= 15; k++) {
        const y = 470 - k * 28;
        g.fillRect(k % 5 ? 70 : 60, y - 1, k % 5 ? 18 : 28, 2);
        if (k % 5 === 0) g.fillText(`${25 + k * 5}°`, 56, y);
      }
      g.textAlign = 'center'; g.font = `bold 14px ${FONT}`; g.fillText('°C', 48, 20);
    });
    for (const [r, t] of [[AT.daisy, 'DAISY'], [AT.pepper, 'PEPPER'], [AT.coop, 'THE LADIES'], [AT.sheep, 'COTTON & SOOTY']] as const) clip(r, () => {
      woodPanel(g, r[2], r[3], '#b98555', r[0] + 1);
      g.fillStyle = '#fff4dc'; g.textAlign = 'center'; g.textBaseline = 'middle';
      fitText(g, t, r[2] / 2, r[3] / 2 + 2, r[2] - 20, 38, HAND);
    });
  }
  function drawPlate(host: string): void {
    clip(AT.plate, () => {
      g.fillStyle = '#c9a03a'; g.fillRect(0, 0, 512, 64);
      g.fillStyle = '#3a2a14'; roundRect(g, 6, 6, 500, 52, 8); g.fill();
      g.fillStyle = '#f2d27a'; g.textAlign = 'center'; g.textBaseline = 'middle';
      fitText(g, host ? `VALLEY WORKS · ${host}` : 'VALLEY WORKS', 256, 33, 470, 30, FONT);
    });
  }
  function drawChart(h: readonly number[] | null): void {
    clip(AT.chart, () => {
      g.fillStyle = '#f4ecd8'; g.fillRect(0, 0, 512, 64);
      g.strokeStyle = '#c8b8a0'; g.lineWidth = 1;
      for (let x = 0; x < 512; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 64); g.stroke(); }
      for (let y = 8; y < 64; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
      if (!h || h.length < 2) return;
      g.strokeStyle = '#b02a2a'; g.lineWidth = 3; g.beginPath();
      for (let i = 0; i < h.length; i++) { const x = (i / (h.length - 1)) * 512, y = 58 - Math.max(0, Math.min(1, h[i])) * 52; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
    });
  }
  function drawSlate(data: Readonly<BarnData> | null, eggs: number): void {
    clip(AT.slate, () => {
      g.fillStyle = '#7a5236'; g.fillRect(0, 0, 400, 184);
      g.fillStyle = '#2e3a34'; g.fillRect(10, 10, 380, 164);
      g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(10, 10, 380, 60);
      g.fillStyle = '#f2f0e6'; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.font = `bold 26px ${HAND}`; g.fillText('Barn chores', 24, 34);
      const rows: [string, boolean][] = [
        ['hay for Daisy', !!data?.fed.includes('cow')], ['hay for Pepper', !!data?.fed.includes('donkey')],
        ['hay for the sheep', !!data?.fed.includes('sheep')], ['grain for the hens', !!data?.fed.includes('hens')],
      ];
      g.font = `20px ${HAND}`;
      rows.forEach(([t, done], i) => {
        const x = 24 + (i % 2) * 186, y = 74 + Math.floor(i / 2) * 34;
        g.strokeStyle = '#f2f0e6'; g.lineWidth = 2; g.strokeRect(x, y - 9, 18, 18);
        if (done) { g.strokeStyle = '#a8e08a'; g.lineWidth = 4; g.beginPath(); g.moveTo(x + 2, y); g.lineTo(x + 8, y + 7); g.lineTo(x + 22, y - 12); g.stroke(); }
        g.fillStyle = done ? '#a8c8a0' : '#f2f0e6';
        g.fillText(t, x + 26, y + 1);
      });
      g.fillStyle = '#f2e8a0'; g.font = `18px ${HAND}`;
      g.fillText(`${eggs ? `${eggs} egg${eggs === 1 ? '' : 's'} in the boxes` : 'no eggs waiting'} · ${data?.milked ? 'milked' : 'not milked yet'}`, 24, 156);
    });
  }
  drawStatic();
  drawPlate('');
  for (let i = 0; i < 4; i++) drawDial(i, 0, '--');
  drawChart(null);
  drawSlate(null, 0);
  c.tex.needsUpdate = true;

  return {
    meshes: [paper, needles],
    update(t, dt, lv, net, host, hist, data, eggs, night) {
      const live = lv.live;
      const target = [live ? lv.cpu : 0, live ? lv.mem : 0, live ? lv.disk : 0, live ? net : 0];
      for (let i = 0; i < 4; i++) val[i] += (target[i] - val[i]) * (1 - Math.exp(-dt * 2.5));
      temp += ((live && lv.tempC != null ? lv.temp : 0.06) - temp) * (1 - Math.exp(-dt));
      // needles: −135° … +135° over the dial; a little flutter on CPU and NET
      for (let i = 0; i < 4; i++) {
        const [x, y] = DIALS[i];
        const flutter = i === 0 || i === 3 ? Math.sin(t * 13 + i) * 0.012 * val[i] : 0;
        const a = (-0.75 + 1.5 * Math.min(1, Math.max(0, val[i] + flutter))) * Math.PI;
        _q.setFromEuler(_e.set(0, 0, a));
        needles.setMatrixAt(i, _m.compose(_v.set(x, F + y, nz), _q, _s.set(0.014, DIAL_R * 0.82, 0.008)));
        needles.setColorAt(i, i === 0 ? red : ink);
      }
      // the thermometer: a red column up the tube (0..1 of 25..100 °C)
      const tx = B.thermo.x + 0.45, ty0 = F + B.thermo.y - 1.08;
      needles.setMatrixAt(4, _m.compose(_v.set(tx, ty0, BARN_ROOM.z1 - 0.1), _q.identity(), _s.set(0.035, 0.08 + temp * 1.62, 0.02)));
      needles.setColorAt(4, red);
      // bulbs: network in / out, disk busy (blink with activity)
      const act = [live ? net : 0, live ? lv.io : 0, live ? lv.cpu : 0];
      for (let i = 0; i < 3; i++) {
        const [x, y] = BULBS[i];
        const on = act[i] > 0.05 && Math.sin(t * (4 + act[i] * 14) + i * 2) > 0.2 - act[i];
        needles.setMatrixAt(5 + i, _m.compose(_v.set(x, F + y - 0.02, nz + 0.01), _q.identity(), _s.set(0.06, 0.05, 0.03)));
        _c.copy(on ? bulbOn[i] : bulbOff);
        if (on) _c.multiplyScalar(0.6 + 0.4 * night);
        needles.setColorAt(5 + i, _c);
      }
      needles.instanceMatrix.needsUpdate = true;
      if (needles.instanceColor) needles.instanceColor.needsUpdate = true;
      // the canvas: dial readouts and the chart once a second, the slate when the chores change
      let dirty = false;
      if (t >= nextDraw || t < nextDraw - 5) {
        nextDraw = t + 1;
        const fmtGB = (x: number) => (x >= 100 ? x.toFixed(0) : x.toFixed(1));
        const texts = live
          ? [`${Math.round(lv.cpu * 100)}%`, `${fmtGB(lv.memUsedGB)}G`, `${Math.round(lv.disk * 100)}%`, `${Math.round(net * 100)}%`]
          : ['--', '--', '--', '--'];
        for (let i = 0; i < 4; i++) drawDial(i, val[i], texts[i]);
        drawChart(hist);
        drawPlate(host);
        dirty = true;
      }
      const sk = `${data?.fed.join(',') ?? ''}|${data?.milked ? 1 : 0}|${eggs}`;
      if (sk !== slateKey) { slateKey = sk; drawSlate(data, eggs); dirty = true; }
      if (dirty) c.tex.needsUpdate = true;
    },
    dispose() { geo.dispose(); c.tex.dispose(); paperMat.dispose(); nGeo.dispose(); nMat.dispose(); },
  };
}
/** the chores slate, on the front wall west of the big door */
export const SLATE = Object.freeze({ x: -2.9, y: 1.62 });

/** the network dial's level: log-scaled bytes/s in + out (same scale as the disk IO) */
export const netLevel = (rx: number, tx: number): number => ioLevel(rx + tx);

// ------------------------------------------------------------------------------------------------- swallows

export interface Swallows { mesh: THREE.InstancedMesh; update(t: number, dt: number, day: boolean): void; dispose(): void }

export function buildSwallows(): Swallows {
  const k = new Kit(9);
  const BACK = 0x2a3a6a, BELLY = 0xf2e8d8, THROAT = 0xc8583a;
  k.ball(0.05, BACK, { s: [0.75, 0.7, 1.5], y: 0.01 }, 1);
  k.ball(0.04, BELLY, { s: [0.72, 0.6, 1.3], y: -0.012 }, 1);
  k.ball(0.032, BACK, { z: 0.07, y: 0.018 }, 1);
  k.ball(0.018, THROAT, { z: 0.085, y: 0.0 }, 0);
  k.cone(0.012, 0.03, 0x2a2a2a, { z: 0.11, y: 0.015, rx: Math.PI / 2 }, 4);
  // wings (flap in the shader: vertices out past |x| > 0.035), forked tail
  for (const s of [-1, 1]) k.box(0.17, 0.008, 0.06, BACK, { x: s * 0.11, y: 0.02, z: -0.005, ry: s * 0.25 });
  for (const s of [-1, 1]) k.box(0.012, 0.006, 0.11, BACK, { x: s * 0.018, y: 0.012, z: -0.11, ry: s * 0.28 });
  const geo = k.geometry('solid')!;
  const N = 3;
  const flap = new THREE.InstancedBufferAttribute(new Float32Array(N * 2), 2);
  flap.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aFlap', flap);
  const mat = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: toonRamp() });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aFlap;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
float wingK = smoothstep(0.03, 0.2, abs(transformed.x));
transformed.y += wingK * sin(aFlap.x) * aFlap.y * abs(transformed.x) * 1.6;
transformed.x *= 1.0 - wingK * (1.0 - aFlap.y) * 0.55;`);
  };
  mat.customProgramCacheKey = () => 'barn-swallow';
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.name = 'interior:barn-swallows';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  const S = Array.from({ length: N }, (_, i) => ({ ph: i * 2.1, home: SWALLOW_NESTS[i], k: 0, x: SWALLOW_NESTS[i].x, y: SWALLOW_NESTS[i].y, z: SWALLOW_NESTS[i].z, wing: 0, out: 1 }));
  const p = new THREE.Vector3(), nxt = new THREE.Vector3();
  /** the loop a swallow flies: a wobbly figure-eight under the roof */
  const path = (i: number, t: number, out: THREE.Vector3) => {
    const a = t * (0.55 + i * 0.07) + i * 2.1;
    return out.set(Math.sin(a) * 3.2 + Math.sin(a * 2.3 + i) * 0.5, BARN_ROOM.wallTop + 1.0 + Math.sin(a * 1.7 + i) * 0.6 + i * 0.25, Math.sin(a * 2) * 2.6 + 0.2);
  };
  return {
    mesh,
    update(t, dt, day) {
      S.forEach((s, i) => {
        // by day: out on the wing most of the time, home to the nest now and then; at night: in the nest
        const home = !day || Math.sin(t * 0.07 + i * 2.4) > 0.75;
        s.out += ((home ? 0 : 1) - s.out) * Math.min(1, dt * 0.7);
        path(i, t, p); path(i, t + 0.05, nxt);
        const k = s.out * s.out * (3 - 2 * s.out);
        const hx = s.home.x, hy = s.home.y + 0.05, hz = s.home.z;
        s.x = hx + (p.x - hx) * k; s.y = hy + (p.y - hy) * k; s.z = hz + (p.z - hz) * k;
        const yaw = k > 0.05 ? Math.atan2(nxt.x - p.x, nxt.z - p.z) : 1.2 + i;
        const bank = k > 0.05 ? Math.max(-0.7, Math.min(0.7, (Math.atan2(nxt.x - p.x, nxt.z - p.z) - Math.atan2(p.x - path(i, t - 0.05, _v).x, p.z - _v.z)) * 8)) : 0;
        _q.setFromEuler(_e.set(0, yaw, -bank, 'YXZ'));
        mesh.setMatrixAt(i, _m.compose(_v.set(s.x, s.y, s.z), _q, _s.set(1.25, 1.25, 1.25)));
        s.wing += dt * (k > 0.05 ? 20 + Math.sin(t * 0.5 + i) * 6 : 2);
        const glide = Math.sin(t * 0.9 + i * 1.3) > 0.55;
        flap.setXY(i, s.wing, k > 0.05 ? (glide ? 0.15 : 1) * k : 0);
      });
      mesh.instanceMatrix.needsUpdate = true;
      flap.needsUpdate = true;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

// ------------------------------------------------------------------------------------------------- dust motes

export interface Motes { mesh: THREE.Points; update(t: number, k: number): void; dispose(): void }
export function buildMotes(): Motes {
  const N = 220;
  const pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = -4.2 + hash(i * 1.3) * 8.4;
    pos[i * 3 + 1] = F + 0.3 + hash(i * 2.7) * 3.6;
    pos[i * 3 + 2] = -3.6 + hash(i * 4.1) * 7.2;
    seed[i] = hash(i * 9.7);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const u = { uTime: { value: 0 }, uK: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: /* glsl */`
      attribute float aSeed; uniform float uTime; varying float vA;
      void main() {
        vec3 p = position;
        float t = uTime * (0.05 + aSeed * 0.06) + aSeed * 40.0;
        p.x += sin(t * 1.3) * 0.25; p.z += cos(t * 1.1) * 0.25; p.y += sin(t * 0.7 + aSeed * 6.0) * 0.18;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (1.2 + aSeed * 1.8) * 7.0 / max(0.6, -mv.z);
        vA = 0.5 + 0.5 * sin(uTime * (0.6 + aSeed) + aSeed * 30.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uK; varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vA * uK;
        gl_FragColor = vec4(vec3(1.0, 0.88, 0.66) * a * 0.55, 1.0);
      }`,
  });
  const mesh = new THREE.Points(geo, mat);
  mesh.name = 'interior:barn-motes';
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return { mesh, update(t, k) { u.uTime.value = t; u.uK.value = k; mesh.visible = k > 0.01; }, dispose() { geo.dispose(); mat.dispose(); } };
}

// ------------------------------------------------------------------------------------------------- what you carry

export type Carry = 'hay' | 'grain' | 'brush';
export interface Carried { mesh: THREE.Group; set(c: Carry | null): void; place(camera: THREE.Camera, t: number, walking: number): void; dispose(): void }
export function buildCarried(): Carried {
  const mk = (fn: (k: Kit) => void) => { const k = new Kit(3); fn(k); const m = k.mesh(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp() })); m.castShadow = false; m.visible = false; m.frustumCulled = false; return m; };
  const hay = mk((k) => {
    k.blob(0.12, PAL.hay, { s: [1.5, 0.75, 1.0] });
    k.blob(0.08, 0xd4b458, { x: 0.08, y: 0.04, z: 0.03, s: [1.4, 0.7, 1] });
    for (let i = 0; i < 7; i++) k.box(0.18, 0.008, 0.008, PAL.hay, { x: Math.sin(i) * 0.06, y: 0.06, z: Math.cos(i * 1.3) * 0.05, ry: i * 0.9, rz: (i - 3) * 0.08 });
  });
  const grain = mk((k) => {
    k.cyl(0.07, 0.08, PAL.metal, { y: 0 }, 9, 0.08);
    k.cyl(0.062, 0.02, 0xf0c860, { y: 0.035 }, 9);
    k.cyl(0.015, 0.12, 0x9a6a40, { z: -0.1, rx: Math.PI / 2 }, 5);
  });
  const brush = mk((k) => {
    k.box(0.16, 0.06, 0.08, 0xa0583a);
    k.box(0.15, 0.03, 0.07, 0x3a3030, { y: -0.04 });
    k.add(new THREE.TorusGeometry(0.035, 0.01, 4, 8, Math.PI), 0x6a4630, { y: 0.03, rz: 0 });
  });
  const mesh = new THREE.Group();
  mesh.name = 'interior:barn-carried';
  mesh.add(hay, grain, brush);
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
  let cur: THREE.Mesh | null = null;
  return {
    mesh,
    set(c) { for (const m of [hay, grain, brush]) m.visible = false; cur = c === 'hay' ? hay : c === 'grain' ? grain : c === 'brush' ? brush : null; if (cur) cur.visible = true; },
    place(camera, t, walking) {
      if (!cur) return;
      // low in the right of the view, bobbing with your steps (the room's root is the world frame's parent: set world)
      camera.getWorldDirection(fwd);
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      up.setFromMatrixColumn(camera.matrixWorld, 1);
      const bob = Math.sin(t * 8) * 0.012 * walking;
      mesh.position.copy(camera.position).addScaledVector(fwd, 0.55).addScaledVector(right, 0.26).addScaledVector(up, -0.24 + bob);
      mesh.quaternion.copy(camera.quaternion);
      mesh.updateMatrixWorld(true);
    },
    dispose() { for (const m of [hay, grain, brush]) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } },
  };
}

/** a hen's beak / a beast's mouth height helper for sounds (room-local) */
export const loftY = LOFT.y;
