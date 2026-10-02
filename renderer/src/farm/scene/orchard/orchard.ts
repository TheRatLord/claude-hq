/**
 * The hillside orchard & apiary (system 'orchard', service 'orchard'; layout world/orchard.ts, rules model/orchard.ts,
 * docs/valley/orchard.md). A walled orchard on the east foothills: three rows of fruit trees that blossom, leaf, fruit
 * and go bare with the seasons, four hives whose bees forage over a wildflower bed, a honey house with a cider press,
 * a dry-stone wall and a five-bar gate.
 *
 * Pastime: look at a tree and press E to shake it. When it's ripe, fruit drops, bounces in the grass and flies into
 * your basket (the Collections book records it; it sells, and some villagers love it). E on a hive with honey to spare
 * takes a jar or two; E on the press turns three apples or pears from the basket into a bottle of cider.
 *
 * Draws: static wall / shed / hives / bed / crates (1 + 1 glow), the sign (1), trunks, crowns and fruit (1 each,
 * instanced), drifting petals / leaves / falling fruit's sparkle (1, only near), bees (1, only near and out). Shadows
 * from the static mesh, trunks, crowns and fruit. Per frame (near): ≤ 18 crowns + their fruit re-posed (sway, shakes),
 * the particle pool and the colony; far away nothing but a distance check. No per-frame allocation.
 */
import * as THREE from 'three';
import type { AudioService, HandsPort, IndoorSpace, Interactable, LightEmitter, LightsService, SceneCtx, SystemFactory } from '../context.ts';
import type { CollectionService } from '../../model/collection.ts';
import type { WalletService } from '../../model/wallet.ts';
import type { Season } from '../../model/types.ts';
import { CIDER_FRUIT, FRUIT, beeActivity, beeMood, createOrchard, pressPlan, treePhase } from '../../model/orchard.ts';
import type { FruitKind, OrchardService, ShakeResult } from '../../model/orchard.ts';
import { ORCHARD_SITE, orchardToWorld } from '../../world/orchard.ts';
import { heightAt } from '../../world/map.ts';
import { localJson } from '../../storage.ts';
import { toon } from '../toon.ts';
import { withSurfaces } from '../surface/index.ts';
import { bakeInto, glowMat, setGlow, solidMat } from '../structures/kit.ts';
import { CROTCH_Y, CROWN_Y, barkTint, beeGeometry, buildOrchardKit, crownGeometry, crownTint, fruitGeometry, fruitLook, fruitSpots, heightIn, petalGeometry, signBoard, trunkGeometry, whiteTint } from './models.ts';
import { Colony } from './bees.ts';

/** browser-local store: today's picks per tree, each hive's last harvest, lifetime totals */
export const ORCHARD_KEY = 'claude-valley.orchard.v1';
let book: OrchardService | null = null;
export function orchardBook(): OrchardService {
  if (!book) book = createOrchard(localJson(ORCHARD_KEY));
  return book;
}

const O = ORCHARD_SITE;
const N = O.trees.length;
/** fruit slots per tree on the branches, windfalls under it, and fruit in the air at once */
const PER_TREE = 6, WINDFALL = 2, FLYING = 18;
const PETALS = 90;
const FORAGERS = 22, GUARDS = 8;
/** metres from the orchard centre: dynamic work only within NEAR, bees and their hum within BEES_NEAR */
const NEAR = 95, BEES_NEAR = 60;

const PLURAL: Record<FruitKind, [string, string]> = { apple: ['apple', 'apples'], pear: ['pear', 'pears'], plum: ['plum', 'plums'], cherry: ['pair of cherries', 'cherries'] };
const TREE_NAME: Record<FruitKind, string> = { apple: 'Apple tree', pear: 'Pear tree', plum: 'Plum tree', cherry: 'Cherry tree' };
const RIPENS: Record<FruitKind, string> = { apple: 'autumn', pear: 'autumn', plum: 'late summer', cherry: 'early summer' };

interface TreeState {
  i: number; kind: FruitKind; s: number; ry: number;
  /** foot of the trunk (local) */
  x: number; y: number; z: number;
  shake: number; phase: number;
  /** the crown's current pose (local), recomputed per frame near */
  m: THREE.Matrix4;
  spots: readonly (readonly [number, number, number])[];
}
interface Flyer {
  on: boolean; kind: FruitKind; phase: 'fall' | 'rest' | 'fly';
  x: number; y: number; z: number; vx: number; vy: number; vz: number; floor: number; t: number;
  sx: number; sy: number; sz: number; spin: number; s: number; sy0: number;
}
interface Petal { on: boolean; x: number; y: number; z: number; vx: number; vy: number; vz: number; floor: number; life: number; rest: number; spin: number; rx: number; ry: number; c: THREE.Color }

/** Service 'orchard' (dev tools, the guide, the map). */
export interface OrchardHandle {
  data(): ReturnType<OrchardService['data']>;
  readonly version: number;
  /** each tree: kind, phase, fruit left today, world position */
  trees(): { i: number; kind: FruitKind; phase: string; left: number; x: number; z: number }[];
  hives(): { i: number; ready: boolean; inDays: number; x: number; z: number }[];
  /** the bees right now */
  bees(): { activity: number; mood: string; out: number };
  /** fruit still falling / flying to your basket */
  inAir(): number;
  /** shake tree i as if you pressed E on it (the result, or null) */
  shake(i: number): ShakeResult | null;
  /** take hive i's honey (jars) */
  honey(i: number): number;
  /** press cider from the basket (true when a bottle was made) */
  press(): boolean;
  /** dev: stand somewhere: 'gate' (default), 'tree' + i, 'hives', 'press', 'top' (above the wall, looking down the rows) */
  go(where?: string, i?: number): boolean;
  refill(): void;
  reset(): void;
}

export const orchardSystem: SystemFactory = (ctx: SceneCtx) => {
  const orchard = orchardBook();
  const audio = () => ctx.services.get('audio') as AudioService | undefined;
  const collection = () => ctx.services.get('collection') as CollectionService | undefined;
  const wallet = () => ctx.services.get('wallet') as WalletService | undefined;
  const hands = () => ctx.services.get('hands') as HandsPort | undefined;
  const indoors = () => ctx.services.get('indoors') as IndoorSpace | undefined;
  const lights = ctx.services.get('lights') as LightsService | undefined;
  const controller = () => ctx.services.get('controller') as { teleport(x: number, z: number, yaw?: number, pitch?: number): void } | undefined;
  const sfx = (n: Parameters<AudioService['play']>[0], pos?: THREE.Vector3, volume = 1, pitch = 1) => { try { audio()?.play(n, { pos, volume, pitch }); } catch { /* audio is optional */ } };
  const say = (t: string, from?: string, ms = 3800) => ctx.ui.say(t, ms, { who: 'Orchard', from });
  const H = heightIn(heightAt);

  const root = new THREE.Group();
  root.name = 'hillorchard'; // not 'orchard': that is the countryside nook's group (structures), and getObjectByName finds the first
  root.position.set(O.x, 0, O.z);
  root.rotation.y = O.yaw;
  ctx.scene.add(root);
  root.updateMatrixWorld(true);
  const toWorld = (v: THREE.Vector3) => v.applyMatrix4(root.matrixWorld);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();

  let season: Season = ctx.valley.sky.season;

  // ------------------------------------------------------------------ the static dressing (rebuilt per season)
  const glow = glowMat(0);
  let baked: THREE.Mesh[] = [];
  const lightOffs: (() => void)[] = [];
  function buildStatic(): void {
    for (const m of baked) { m.removeFromParent(); m.geometry.dispose(); }
    baked = [];
    for (const f of lightOffs.splice(0)) f();
    const kit = buildOrchardKit(season, heightAt);
    const tmp = kit.build(new THREE.Group(), 0);
    for (const o of tmp.children) {
      const src = o as THREE.Mesh;
      const isGlow = src.userData.bake === 'glow';
      const g = bakeInto(src.geometry, new THREE.Matrix4());
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, isGlow ? glow : solidMat());
      mesh.name = isGlow ? 'orchard:glow' : 'orchard:static';
      mesh.castShadow = !isGlow; mesh.receiveShadow = !isGlow;
      root.add(mesh);
      baked.push(mesh);
      if (lights) for (const e of (src.userData.emitters as LightEmitter[] | undefined) ?? []) { toWorld(e.pos); e.dir?.transformDirection(root.matrixWorld); lightOffs.push(lights.add(e)); }
    }
  }
  buildStatic();
  const sign = signBoard();
  {
    const y = H(O.sign.x, O.sign.z);
    sign.position.set(O.sign.x, y + 1.18, O.sign.z + 0.06);
    root.add(sign);
  }
  const signFace = (sign.material as THREE.MeshBasicMaterial[])[4];

  // ------------------------------------------------------------------ the trees
  const treeMat = withSurfaces(toon(0xffffff, { vertexColors: true, shared: false }), { surfaces: ['bark', 'leaves', 'snow'] });
  const trunks = new THREE.InstancedMesh(trunkGeometry(), treeMat, N);
  trunks.name = 'orchard:trunks';
  const crowns = new THREE.InstancedMesh(crownGeometry(season), treeMat, N);
  crowns.name = 'orchard:crowns';
  for (const m of [trunks, crowns]) { m.castShadow = true; m.receiveShadow = true; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(m); }
  const trees: TreeState[] = O.trees.map((t) => ({
    i: t.i, kind: t.kind, s: t.s, ry: t.ry, x: t.x, y: H(t.x, t.z) - 0.04, z: t.z, shake: 0, phase: t.i * 1.37, m: new THREE.Matrix4(),
    spots: fruitSpots(t.i, PER_TREE),
  }));
  const _c = new THREE.Color(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
  const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3();
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const pivotUp = new THREE.Matrix4(), pivotDown = new THREE.Matrix4();
  /** the trunk's pose (base, turn, size) into `out` */
  const trunkPose = (t: TreeState, out: THREE.Matrix4) => out.compose(_p.set(t.x, t.y, t.z), _q.setFromAxisAngle(_v.set(0, 1, 0), t.ry), _s.setScalar(t.s));
  /** the crown's pose: the trunk's, then a tilt about the crotch (wind + shake) */
  function crownPose(t: TreeState, time: number, wind: number): THREE.Matrix4 {
    trunkPose(t, t.m);
    const sh = t.shake;
    const ax = Math.sin(time * 1.3 + t.phase) * 0.012 * wind + sh * sh * Math.sin(time * 34 + t.phase) * 0.11;
    const az = Math.sin(time * 1.7 + t.phase * 1.3) * 0.016 * wind + sh * sh * Math.cos(time * 29 + t.phase) * 0.1;
    if (ax === 0 && az === 0) return t.m;
    pivotUp.makeTranslation(0, CROTCH_Y, 0); pivotDown.makeTranslation(0, -CROTCH_Y, 0);
    _m.makeRotationFromEuler(_e.set(ax, 0, az));
    return t.m.multiply(pivotUp).multiply(_m).multiply(pivotDown);
  }
  function tintTrees(): void {
    for (const t of trees) { trunks.setColorAt(t.i, barkTint(t.kind, _c)); crowns.setColorAt(t.i, crownTint(t.kind, season, _c)); }
    if (trunks.instanceColor) trunks.instanceColor.needsUpdate = true;
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  }

  // ------------------------------------------------------------------ fruit: on the branches, windfalls, in the air
  const fruitMat = whiteTint(toon(0xffffff, { vertexColors: true, shared: false }));
  const FRUITS = N * PER_TREE + N * WINDFALL + FLYING;
  const fruit = new THREE.InstancedMesh(fruitGeometry(), fruitMat, FRUITS);
  fruit.name = 'orchard:fruit';
  fruit.castShadow = true;
  fruit.frustumCulled = false;
  fruit.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < FRUITS; i++) { fruit.setMatrixAt(i, ZERO); fruit.setColorAt(i, _c.setHex(0xffffff)); }
  root.add(fruit);
  const flyers: Flyer[] = Array.from({ length: FLYING }, () => ({ on: false, kind: 'apple' as FruitKind, phase: 'fall' as const, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, floor: 0, t: 0, sx: 0, sy: 0, sz: 0, spin: 0, s: 1, sy0: 1 }));
  /** fruit shown on each tree (refreshed from the model on change) */
  const showing = new Int8Array(N);
  let fruitDirty = true;
  const fruitColorsFor = () => {
    for (const t of trees) {
      const ph = treePhase(t.kind, season);
      fruitLook(t.kind, ph === 'green', _c);
      for (let k = 0; k < PER_TREE; k++) fruit.setColorAt(t.i * PER_TREE + k, _c);
      fruitLook(t.kind, false, _c);
      for (let k = 0; k < WINDFALL; k++) fruit.setColorAt(N * PER_TREE + t.i * WINDFALL + k, _c);
    }
    if (fruit.instanceColor) fruit.instanceColor.needsUpdate = true;
  };
  function refreshFruit(): void {
    for (const t of trees) {
      const ph = treePhase(t.kind, season);
      showing[t.i] = ph === 'ripe' ? Math.min(PER_TREE, orchard.fruitLeft(t.i, season)) : ph === 'green' ? 4 : 0;
    }
    fruitDirty = false;
  }
  /** write the hanging fruit of tree t (its crown pose is in t.m) */
  function poseFruit(t: TreeState): void {
    const ph = treePhase(t.kind, season), green = ph === 'green';
    const look = fruitLook(t.kind, green, _c);
    for (let k = 0; k < PER_TREE; k++) {
      const slot = t.i * PER_TREE + k;
      if (k >= showing[t.i]) { fruit.setMatrixAt(slot, ZERO); continue; }
      const sp = t.spots[k];
      // a little dangle of its own, then the crown's pose
      _m2.compose(_p.set(sp[0], sp[1], sp[2]), _q.setFromEuler(_e.set(0, k * 1.9, 0)), _s.set(look.s, look.s * look.sy, look.s));
      fruit.setMatrixAt(slot, _m.multiplyMatrices(t.m, _m2));
    }
  }
  function poseWindfalls(): void {
    for (const t of trees) {
      const lie = season === 'autumn' && (t.kind === 'apple' || t.kind === 'pear');
      const look = fruitLook(t.kind, false, _c);
      for (let k = 0; k < WINDFALL; k++) {
        const slot = N * PER_TREE + t.i * WINDFALL + k;
        if (!lie) { fruit.setMatrixAt(slot, ZERO); continue; }
        const a = t.i * 2.3 + k * 2.9, r = 0.7 + k * 0.45;
        const lx = t.x + Math.cos(a) * r * t.s, lz = t.z + Math.sin(a) * r * t.s;
        _m.compose(_p.set(lx, H(lx, lz) + 0.07 * look.s, lz), _q.setFromEuler(_e.set(0.4 + k, a, 1.2)), _s.set(look.s, look.s * look.sy, look.s));
        fruit.setMatrixAt(slot, _m);
      }
    }
  }

  // ------------------------------------------------------------------ petals, leaves, snow puffs
  const petalMat = toon(0xffffff, { side: THREE.DoubleSide, shared: false });
  const petals = new THREE.InstancedMesh(petalGeometry(), petalMat, PETALS);
  petals.name = 'orchard:petals';
  petals.frustumCulled = false;
  petals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < PETALS; i++) { petals.setMatrixAt(i, ZERO); petals.setColorAt(i, _c.setHex(0xffffff)); }
  root.add(petals);
  const pool: Petal[] = Array.from({ length: PETALS }, () => ({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, floor: 0, life: 0, rest: 0, spin: 0, rx: 0, ry: 0, c: new THREE.Color() }));
  let petalAt = 0, petalsLive = 0, ambientAcc = 0;
  const rnd = (() => { let s = 12345; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; })();
  const _c2 = new THREE.Color();
  /** colours a tree sheds this season (null: nothing) */
  function shedColor(t: TreeState, out: THREE.Color): THREE.Color | null {
    if (season === 'spring') return crownTint(t.kind, 'spring', out);
    if (season === 'autumn') {
      const opts = [0xe0903a, 0xd0573a, 0xe8b83a, 0xc8603a];
      return out.setHex(opts[Math.floor(rnd() * opts.length)]).lerp(crownTint(t.kind, 'autumn', _c2), 0.4);
    }
    if (season === 'winter') return out.setHex(0xf4f6fa);
    return null;
  }
  function spawnPetal(t: TreeState, burst: boolean): void {
    const c = shedColor(t, _c);
    if (!c) return;
    const p = pool[petalAt++ % PETALS];
    const a = rnd() * Math.PI * 2, r = (0.4 + rnd() * 0.9) * t.s;
    p.on = true;
    p.x = t.x + Math.cos(a) * r; p.z = t.z + Math.sin(a) * r; p.y = t.y + (CROWN_Y - 0.3 + rnd() * 0.9) * t.s;
    const snow = season === 'winter';
    p.vx = (rnd() - 0.5) * (burst ? 1.4 : 0.3); p.vz = (rnd() - 0.5) * (burst ? 1.4 : 0.3); p.vy = snow ? -1.2 - rnd() : burst ? 0.4 + rnd() * 0.8 : -0.3;
    p.floor = H(p.x, p.z) + 0.02; p.life = 0; p.rest = 0; p.spin = rnd() * 6; p.rx = rnd() * 6; p.ry = rnd() * 6;
    p.c.copy(c);
    petals.setColorAt((petalAt - 1) % PETALS, c);
    if (petals.instanceColor) petals.instanceColor.needsUpdate = true;
  }
  function updatePetals(dt: number, time: number, windX: number, windZ: number): void {
    petalsLive = 0;
    for (let i = 0; i < PETALS; i++) {
      const p = pool[i];
      if (!p.on) continue;
      p.life += dt;
      const snow = season === 'winter';
      if (p.y > p.floor) {
        // flutter down: drag toward a slow fall, drift with the wind, sway side to side
        const fall = snow ? -1.6 : -0.45;
        p.vy += (fall - p.vy) * Math.min(1, dt * (snow ? 3 : 1.6));
        p.vx += (windX * 0.25 - p.vx) * Math.min(1, dt * 1.2);
        p.vz += (windZ * 0.25 - p.vz) * Math.min(1, dt * 1.2);
        p.x += (p.vx + Math.sin(time * 2.1 + p.spin) * 0.35) * dt; p.z += (p.vz + Math.cos(time * 1.7 + p.spin) * 0.3) * dt; p.y += p.vy * dt;
        p.rx += dt * 3.1; p.ry += dt * 2.3;
        if (p.y <= p.floor) { p.y = p.floor; p.rx = Math.PI / 2 * 0; }
      } else p.rest += dt;
      const fade = p.rest > 2.5 ? Math.max(0, 1 - (p.rest - 2.5) / 1.5) : 1;
      if (fade <= 0 || p.life > 16) { p.on = false; petals.setMatrixAt(i, ZERO); continue; }
      const s = (snow ? 1.3 : 1) * fade;
      _m.compose(_p.set(p.x, p.y, p.z), _q.setFromEuler(_e.set(p.y > p.floor ? Math.sin(p.rx) * 1.2 : 0, p.ry, p.y > p.floor ? Math.cos(p.rx) * 0.8 : 0)), _s.setScalar(s));
      petals.setMatrixAt(i, _m);
      petalsLive++;
    }
    petals.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------------ the bees
  const beeMat = toon(0xffffff, { vertexColors: true });
  const beeMesh = new THREE.InstancedMesh(beeGeometry(), beeMat, FORAGERS + GUARDS);
  beeMesh.name = 'orchard:bees';
  beeMesh.frustumCulled = false;
  beeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(beeMesh);
  const entrances = O.hives.map((h) => ({ x: h.x, y: H(h.x, h.z) - 0.03 + 0.47, z: h.z - 0.32 }));
  const bedFlowers: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < 24; i++) {
    const x = O.bed.x0 + 0.3 + ((i * 0.6180339) % 1) * (O.bed.x1 - O.bed.x0 - 0.6), z = O.bed.z0 + 0.2 + ((i * 0.381966) % 1) * (O.bed.z1 - O.bed.z0 - 0.4);
    bedFlowers.push({ x, y: H(x, z) + 0.45, z });
  }
  const blossom: { x: number; y: number; z: number }[] = [];
  for (const t of trees) for (let k = 0; k < 3; k++) { const a = k * 2.1 + t.i; blossom.push({ x: t.x + Math.cos(a) * 0.95 * t.s, y: t.y + (CROWN_Y + 0.1) * t.s, z: t.z + Math.sin(a) * 0.95 * t.s }); }
  // spring: the blossom first, then the bed; the rest of the year just the bed
  const springFlowers = [...blossom, ...bedFlowers];
  const colonySpring = new Colony({ hives: entrances, flowers: springFlowers }, FORAGERS, GUARDS, 11);
  const colonyBed = new Colony({ hives: entrances, flowers: bedFlowers }, FORAGERS, GUARDS, 11);
  let colony = season === 'spring' ? colonySpring : colonyBed;
  let beesShown = 0, activity = 0;
  for (let i = 0; i < FORAGERS + GUARDS; i++) beeMesh.setMatrixAt(i, ZERO);
  const hiveCentre = toWorld(new THREE.Vector3((O.hives[0].x + O.hives[O.hives.length - 1].x) / 2, H(O.hives[1].x, O.hives[1].z) + 0.9, O.hives[0].z));
  let hum: { setVolume(v: number): void; stop(): void } | null = null, humQuiet = 0;

  // ------------------------------------------------------------------ colliders
  const offs: (() => void)[] = [];
  const wp = (lx: number, lz: number) => orchardToWorld(lx, lz);
  for (const t of trees) { const w = wp(t.x, t.z); offs.push(ctx.colliders.circle(w.x, w.z, 0.2 * t.s)); }
  for (const h of O.hives) { const w = wp(h.x, h.z); offs.push(ctx.colliders.circle(w.x, w.z, 0.42)); }
  {
    // the honey house (its footprint: the press is reached from the open front), the wall's four runs (gate open)
    const c = wp(O.shed.x, O.shed.z);
    offs.push(ctx.colliders.rect(c.x, c.z, O.shed.d + 0.1, O.shed.w + 0.1, O.yaw));
    const run = (ax: number, az: number, bx: number, bz: number) => {
      const a = wp(ax, az), b = wp(bx, bz), L = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
      offs.push(ctx.colliders.rect((a.x + b.x) / 2, (a.z + b.z) / 2, L, 0.62, Math.atan2(-uz, ux)));
    };
    const gx0 = O.gate.x - O.gate.w / 2 - 0.5, gx1 = O.gate.x + O.gate.w / 2 + 0.5;
    run(-O.hw, O.back, O.hw, O.back);
    run(O.hw, O.back, O.hw, O.front);
    run(-O.hw, O.back, -O.hw, O.front);
    run(-O.hw, O.front, gx0, O.front);
    run(gx1, O.front, O.hw, O.front);
    // the sign's posts
    const s = wp(O.sign.x, O.sign.z);
    offs.push(ctx.colliders.rect(s.x, s.z, 1.2, 0.2, O.yaw));
  }

  // ------------------------------------------------------------------ shaking, honey, the press
  const treePos = (t: TreeState, out: THREE.Vector3) => toWorld(out.set(t.x, t.y + (CROWN_Y - 0.25) * t.s, t.z));
  function launch(t: TreeState, from: number, n: number): void {
    // the n fruit hanging at slots [from, from + n) come down
    const look = fruitLook(t.kind, false, _c);
    for (let k = 0; k < n; k++) {
      const f = flyers.find((x) => !x.on);
      if (!f) return;
      const sp = t.spots[Math.min(PER_TREE - 1, from + k)];
      _p.set(sp[0], sp[1], sp[2]).applyMatrix4(t.m);
      f.on = true; f.kind = t.kind; f.phase = 'fall';
      f.x = _p.x; f.y = _p.y; f.z = _p.z;
      f.vx = (rnd() - 0.5) * 1.2; f.vz = (rnd() - 0.5) * 1.2; f.vy = 0.3 + rnd() * 0.6;
      f.floor = H(f.x, f.z) + 0.08 * look.s; f.t = -k * 0.09; f.spin = rnd() * 6; f.s = look.s; f.sy0 = look.sy;
      fruit.setColorAt(N * PER_TREE + N * WINDFALL + flyers.indexOf(f), _c);
    }
    if (fruit.instanceColor) fruit.instanceColor.needsUpdate = true;
  }

  function shake(t: TreeState): ShakeResult | null {
    const before = showing[t.i];
    const r = orchard.shake(t.i, season);
    if (!r) return null;
    t.shake = 1;
    const at = treePos(t, new THREE.Vector3());
    sfx('creak', at, 0.45, 1.6);
    sfx('step-grass', at, 0.7, 0.55);
    // a burst of petals / leaves / snow off the crown
    const burst = season === 'summer' ? 3 : 14;
    for (let k = 0; k < burst; k++) spawnPetal(t, true);
    const [one, many] = PLURAL[t.kind];
    const id = `orchard:tree:${t.i}`;
    if (r.n > 0) {
      refreshFruit();
      launch(t, Math.max(0, Math.min(before, PER_TREE) - r.n), r.n);
      say(`${r.n === 1 ? `A ${one}` : `${r.n} ${many}`} thump${r.n === 1 ? 's' : ''} into the grass. Into the basket ${r.n === 1 ? 'it goes' : 'they go'}!${r.left ? '' : ' That\'s the last of them today.'}`, id, 3200);
    } else if (r.phase === 'ripe') say(`Picked clean for today. The ${many} will be back tomorrow.`, id, 3200);
    else if (r.phase === 'blossom') say(`A shower of blossom. By ${RIPENS[t.kind]} this one will be ${many}.`, id);
    else if (r.phase === 'green') say(`The ${many} are still small and green. Come back in ${RIPENS[t.kind]}.`, id);
    else if (r.phase === 'turning') say(`Just leaves now: the ${many} were over by the end of summer.`, id);
    else say(ctx.valley.sky.trace.snow > 0.15 ? 'Whumph. A cap of snow slides off the branches, mostly down your collar.' : 'Bare branches. The tree is asleep until spring.', id);
    return r;
  }

  function land(f: Flyer): void {
    // the fruit reached the basket
    f.on = false;
    const res = collection()?.gather(f.kind) ?? null;
    hands()?.gesture('grab');
    sfx('pop', undefined, 0.45, 1.3);
    if (res?.isNew) {
      setTimeout(() => sfx('sparkle', undefined, 0.8), 80);
      say(`${res.def.name}! New for your collection. (K to look)`, undefined, 4200);
    }
  }

  function honey(i: number): number {
    const n = orchard.takeHoney(i, season);
    const h = O.hives[i];
    const at = toWorld(new THREE.Vector3(h.x, H(h.x, h.z) + 1, h.z));
    const id = `orchard:hive:${i}`;
    if (n > 0) {
      for (let k = 0; k < n; k++) collection()?.gather('honey');
      hands()?.gesture('grab');
      sfx('buzz', at, 0.8, 1.1);
      setTimeout(() => sfx('pop', at, 0.5, 0.9), 220);
      say(`You lift the roof gently… ${n === 1 ? 'a jar' : 'two jars'} of wildflower honey. The bees hardly mind.`, id, 4000);
    } else if (season === 'winter') say('The bees are clustered up for winter, keeping each other warm. Leave them be until spring.', id);
    else { const d = orchard.honeyIn(i, season); say(`Not much to spare yet. Give them ${d === 1 ? 'another day' : `${d} more days`}.`, id); }
    return n;
  }

  function press(): boolean {
    const w = wallet();
    const plan = pressPlan((w?.data().basket ?? {}) as Record<string, number>);
    const at = toWorld(new THREE.Vector3(O.press.x, H(O.shed.x, O.shed.z) + 1, O.press.z));
    if (!w || !plan) { say(`The press wants ${CIDER_FRUIT} apples or pears from your basket. Shake a tree or two first.`, 'orchard:press'); return false; }
    if (plan.apple) w.take('apple', plan.apple);
    if (plan.pear) w.take('pear', plan.pear);
    w.stash('cider', 1);
    orchard.pressed();
    hands()?.gesture('grab');
    sfx('creak', at, 0.8, 0.7);
    setTimeout(() => sfx('water-pour', at, 0.7, 1.2), 450);
    say(`Crunch, creak, glug: ${plan.pear ? (plan.apple ? 'apples and pears' : 'three pears') : 'three apples'} become a bottle of cloudy cider. Into the basket!`, 'orchard:press', 4200);
    return true;
  }

  // ------------------------------------------------------------------ interactables
  for (const t of trees) {
    offs.push(ctx.interact.add({
      id: `orchard:tree:${t.i}`, kind: 'prop', verb: 'Shake', reach: 3.6,
      label: () => TREE_NAME[t.kind],
      pos: (out) => treePos(t, out),
      hint: () => {
        const ph = treePhase(t.kind, season), [, many] = PLURAL[t.kind];
        if (ph === 'ripe') { const n = orchard.fruitLeft(t.i, season); return n ? `${n} ${n === 1 ? PLURAL[t.kind][0] : many} ripe · shake some down` : 'picked clean today'; }
        if (ph === 'blossom') return `in blossom · ${many} by ${RIPENS[t.kind]}`;
        if (ph === 'green') return `${many} still green · ripe in ${RIPENS[t.kind]}`;
        if (ph === 'turning') return 'leaves turning · fruit again next summer';
        return 'bare until spring';
      },
      use: () => { shake(t); },
    } satisfies Interactable));
  }
  O.hives.forEach((h, i) => {
    offs.push(ctx.interact.add({
      id: `orchard:hive:${i}`, kind: 'prop', reach: 2.8,
      get verb() { return orchard.honeyReady(i, season) ? 'Collect honey' : 'Look at'; },
      label: () => 'Beehive',
      pos: (out) => toWorld(out.set(h.x, H(h.x, h.z) + 0.85, h.z)),
      hint: () => {
        const mood = beeMood({ hour: ctx.valley.sky.hour, season, weather: ctx.valley.sky.weather.kind });
        const bees = { out: 'the bees are out foraging', waking: 'the bees are waking up', asleep: 'the bees are asleep', sheltering: 'the bees are sheltering from the weather', wintering: 'wintering: the colony is clustered inside' }[mood];
        if (orchard.honeyReady(i, season)) return `honey to spare · ${bees}`;
        const d = orchard.honeyIn(i, season);
        return d < 0 ? bees : `honey again in ${d === 1 ? 'a day' : `${d} days`} · ${bees}`;
      },
      use: () => { honey(i); },
    } as Interactable));
  });
  offs.push(ctx.interact.add({
    id: 'orchard:press', kind: 'prop', reach: 3.2,
    get verb() { return pressPlan((wallet()?.data().basket ?? {}) as Record<string, number>) ? 'Press cider' : 'Look at'; },
    label: () => 'Cider press',
    pos: (out) => toWorld(out.set(O.press.x + 0.2, H(O.shed.x, O.shed.z) + 1.0, O.press.z)),
    hint: () => (pressPlan((wallet()?.data().basket ?? {}) as Record<string, number>) ? `${CIDER_FRUIT} apples or pears → a bottle of cider` : `needs ${CIDER_FRUIT} apples or pears from your basket`),
    use: () => { press(); },
  } as Interactable));
  offs.push(ctx.interact.add({
    id: 'orchard:sign', kind: 'prop', verb: 'Read', reach: 3.4,
    label: () => 'Orchard sign',
    pos: (out) => toWorld(out.set(O.sign.x, H(O.sign.x, O.sign.z) + 1.2, O.sign.z)),
    use: () => {
      const ripe = (['cherry', 'plum', 'apple', 'pear'] as const).filter((k) => FRUIT[k].ripe.includes(season)).map((k) => PLURAL[k][1]);
      say(`"Hillside Orchard. Shake what's ripe, mind the bees, shut the gate behind you (nobody does)." ${ripe.length ? `Ripe now: ${ripe.join(' and ')}.` : season === 'spring' ? 'The trees are in blossom.' : 'Nothing ripe until summer.'}`, 'orchard:sign', 5200);
    },
  }));

  // ------------------------------------------------------------------ season changes
  function applySeason(s: Season): void {
    season = s;
    buildStatic();
    crowns.geometry = crownGeometry(s);
    tintTrees();
    fruitColorsFor();
    refreshFruit();
    poseWindfalls();
    colony.hideAll(beeMesh);
    colony = s === 'spring' ? colonySpring : colonyBed;
    for (const p of pool) p.on = false;
    for (let i = 0; i < PETALS; i++) petals.setMatrixAt(i, ZERO);
    petals.instanceMatrix.needsUpdate = true;
    poseAll(0, 0);
  }
  function poseAll(time: number, wind: number): void {
    for (const t of trees) {
      trunks.setMatrixAt(t.i, trunkPose(t, _m));
      crowns.setMatrixAt(t.i, crownPose(t, time, wind));
      poseFruit(t);
    }
    trunks.instanceMatrix.needsUpdate = true; crowns.instanceMatrix.needsUpdate = true; fruit.instanceMatrix.needsUpdate = true;
  }
  applySeason(season);
  trunks.computeBoundingSphere(); crowns.computeBoundingSphere();
  const offBook = orchard.onChange(() => { fruitDirty = true; });

  // ------------------------------------------------------------------ the service
  const handle: OrchardHandle = {
    data: () => orchard.data(),
    get version() { return orchard.version; },
    trees: () => trees.map((t) => { const w = wp(t.x, t.z); return { i: t.i, kind: t.kind, phase: treePhase(t.kind, season), left: orchard.fruitLeft(t.i, season), x: w.x, z: w.z }; }),
    hives: () => O.hives.map((h, i) => { const w = wp(h.x, h.z); return { i, ready: orchard.honeyReady(i, season), inDays: orchard.honeyIn(i, season), x: w.x, z: w.z }; }),
    bees: () => ({ activity, mood: beeMood({ hour: ctx.valley.sky.hour, season, weather: ctx.valley.sky.weather.kind }), out: colony.out }),
    inAir: () => flyers.filter((f) => f.on).length,
    shake: (i) => (trees[i] ? shake(trees[i]) : null),
    honey: (i) => (O.hives[i] ? honey(i) : 0),
    press: () => press(),
    go(where = 'gate', i = 0) {
      const c = controller();
      if (!c) return false;
      indoors()?.leave(true);
      // (the camera looks along (−sin yaw, −cos yaw))
      const stand = (lx: number, lz: number, tx: number, tz: number, pitch: number) => {
        const a = wp(lx, lz), b = wp(tx, tz);
        c.teleport(a.x, a.z, Math.atan2(-(b.x - a.x), -(b.z - a.z)), pitch);
        return true;
      };
      if (where === 'tree') { const t = trees[Math.max(0, Math.min(N - 1, i))]; return stand(t.x + (t.x > 0 ? -1.2 : 1.2), t.z + 3.0, t.x, t.z, 0.2); }
      if (where === 'hives') return stand(8.8, 1.6, 8.8, 5.6, -0.12);
      if (where === 'press') return stand(O.press.x + 2.6, O.press.z + 0.6, O.press.x, O.press.z, -0.1);
      if (where === 'top') return stand(0, O.back + 1.2, 0, O.front, -0.22);
      return stand(1.2, O.front + 6.5, 0, 0, 0.06);
    },
    refill: () => orchard.devRefill(),
    reset: () => orchard.devReset(),
  };
  ctx.services.set('orchard', handle);

  // ------------------------------------------------------------------ per frame
  let check = 0, near = false, wasNear = true;
  const cam = new THREE.Vector3(), centre = toWorld(new THREE.Vector3(0, 0, (O.back + O.front) / 2));
  return {
    name: 'orchard',
    update(f) {
      check -= f.dt;
      if (check <= 0) {
        check = 1;
        if (ctx.valley.sky.season !== season) applySeason(ctx.valley.sky.season);
        // winter crowns are only the snow lying on the boughs
        crowns.visible = season !== 'winter' || ctx.valley.sky.trace.snow > 0.12;
      }
      if (fruitDirty) { refreshFruit(); if (!near) poseAll(0, 0); }
      setGlow(glow, ctx.lighting.night);
      signFace.color.setScalar(1 - 0.45 * ctx.lighting.night);
      const inside = !!indoors()?.active;
      ctx.camera.getWorldPosition(cam);
      const d = Math.hypot(cam.x - centre.x, cam.z - centre.z);
      near = !inside && d < NEAR;
      if (!near) {
        if (wasNear) { colony.hideAll(beeMesh); petals.visible = false; beesShown = 0; poseAll(0, 0); }
        wasNear = false;
        if (hum) { hum.stop(); hum = null; }
        return;
      }
      wasNear = true;
      petals.visible = true;
      const time = f.time, dt = f.dt;
      const wind = Math.min(2.5, Math.hypot(ctx.lighting.wind.x, ctx.lighting.wind.z) / 2 + 0.3);
      // crowns sway; a shaken one shudders and settles; the fruit hangs on
      for (const t of trees) {
        if (t.shake > 0) t.shake = Math.max(0, t.shake - dt / 0.9);
        crowns.setMatrixAt(t.i, crownPose(t, time, wind));
        poseFruit(t);
      }
      crowns.instanceMatrix.needsUpdate = true;
      // fruit coming down: fall, bounce, rest a beat, then fly up into your basket
      for (let k = 0; k < FLYING; k++) {
        const fl = flyers[k], slot = N * PER_TREE + N * WINDFALL + k;
        if (!fl.on) { fruit.setMatrixAt(slot, ZERO); continue; }
        fl.t += dt;
        if (fl.t < 0) { fruit.setMatrixAt(slot, ZERO); continue; }
        if (fl.phase === 'fall') {
          fl.vy -= 9.8 * dt;
          fl.x += fl.vx * dt; fl.y += fl.vy * dt; fl.z += fl.vz * dt; fl.spin += dt * 8;
          if (fl.y <= fl.floor) {
            fl.y = fl.floor;
            if (fl.vy < -2.2) { fl.vy *= -0.32; fl.vx *= 0.5; fl.vz *= 0.5; sfx('step-grass', toWorld(_w.set(fl.x, fl.y, fl.z)), 0.35, 1.4); }
            else { fl.phase = 'rest'; fl.t = 0; }
          }
        } else if (fl.phase === 'rest') {
          if (fl.t > 0.35) { fl.phase = 'fly'; fl.t = 0; fl.sx = fl.x; fl.sy = fl.y; fl.sz = fl.z; }
        } else {
          // toward the paws' basket: a little below and in front of the eye (local frame)
          _w.copy(cam); ctx.camera.getWorldDirection(_v); _w.addScaledVector(_v, 0.5); _w.y -= 0.45; _w.applyMatrix4(inv);
          const k2 = Math.min(1, fl.t / 0.5), e = k2 * k2;
          fl.x = fl.sx + (_w.x - fl.sx) * e; fl.z = fl.sz + (_w.z - fl.sz) * e;
          fl.y = fl.sy + (_w.y - fl.sy) * e + Math.sin(k2 * Math.PI) * 0.9;
          if (k2 >= 1) { land(fl); fruit.setMatrixAt(slot, ZERO); continue; }
        }
        const shrink = fl.phase === 'fly' ? 1 - Math.min(1, fl.t / 0.5) * 0.6 : 1;
        _m.compose(_p.set(fl.x, fl.y, fl.z), _q.setFromEuler(_e.set(fl.spin, fl.spin * 0.7, 0)), _s.set(fl.s * shrink, fl.s * fl.sy0 * shrink, fl.s * shrink));
        fruit.setMatrixAt(slot, _m);
      }
      fruit.instanceMatrix.needsUpdate = true;
      // a few petals / leaves always drifting down near you (spring blossom, autumn leaves), a breath of it in the rain
      const rate = (season === 'spring' ? 5 : season === 'autumn' ? 4 : 0) * (ctx.comfort.weatherFx ?? 1) * (ctx.comfort.reducedMotion ? 0.4 : 1);
      ambientAcc += rate * dt;
      while (ambientAcc >= 1) { ambientAcc -= 1; spawnPetal(trees[Math.floor(rnd() * N)], false); }
      updatePetals(dt, time, ctx.lighting.wind.x, ctx.lighting.wind.z);
      // the bees
      activity = d < BEES_NEAR ? beeActivity({ hour: ctx.valley.sky.hour, season, weather: ctx.valley.sky.weather.kind }) : 0;
      if (activity > 0 || beesShown > 0) beesShown = colony.update(dt, time, activity, colony === colonySpring ? springFlowers.length : bedFlowers.length, beeMesh);
      beeMesh.visible = beesShown > 0;
      // their hum, from the hives (the audio's own falloff does the distance)
      const want = activity > 0.02 && Math.hypot(cam.x - hiveCentre.x, cam.z - hiveCentre.z) < 45;
      if (want && !hum) { try { hum = audio()?.loop('bees', hiveCentre) ?? null; } catch { hum = null; } }
      if (hum) {
        hum.setVolume(want ? 0.35 + activity * 0.75 : 0);
        humQuiet = want ? 0 : humQuiet + dt;
        if (humQuiet > 4) { hum.stop(); hum = null; humQuiet = 0; }
      }
    },
    stats: () => ({ near: near ? 1 : 0, bees: beesShown, petals: petalsLive, inAir: flyers.filter((x) => x.on).length }),
    dispose() {
      // fruit still in the air goes into the basket anyway
      for (const fl of flyers) if (fl.on) land(fl);
      for (const o of offs.splice(0)) o();
      for (const o of lightOffs.splice(0)) o();
      offBook();
      hum?.stop();
      ctx.scene.remove(root);
      for (const m of baked) m.geometry.dispose();
      glow.dispose(); treeMat.dispose(); fruitMat.dispose(); petalMat.dispose();
      if (ctx.services.get('orchard') === handle) ctx.services.delete('orchard');
    },
  };
};
