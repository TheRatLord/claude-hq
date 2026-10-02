/**
 * The grotto behind the waterfall as a walk-in room (a `RoomDef` for the interior system, scene/interior/space.ts):
 * built in its own frame at the cave mouth (world/grotto.ts `MOUTH`), lazily on the first visit, and only in the
 * scene while you are inside (the valley outside costs nothing; the cave is ~20 draws).
 *
 * In the cave: crystal clusters that glow and slowly cycle through teal, violet and rose (emissive + four real
 * LightEmitters following the same colour), a still pool that mirrors them, stalactites that drip (plips, and rings
 * on the pool), moss where the mouth's daylight reaches, bats roosting in a crack of the dome (they take off in a
 * flutter when you come in), the valley's oldest story painted on the north wall, and an old explorer's camp:
 * bedroll, a cold fire ring, the lantern (a warm LightEmitter) and the journal on a crate (E reads a page at a time).
 *
 * Secrets: today's glow-caps on the mossy log (a forageable that grows nowhere else: model/grotto.ts `grottoSpawn`),
 * the blind cave fish in the pool (E casts a line; model/collection.ts water 'cave'), and a chest tucked in the
 * north-east alcove behind the stalagmites: once, the "Grotto geode lamp" for your yard (model/shop.ts `geode`).
 */
import * as THREE from 'three';
import type { AudioService, Interactable, LightEmitter } from '../context.ts';
import type { Season } from '../../model/types.ts';
import { dayKey } from '../../model/almanac.ts';
import type { CollectionService } from '../../model/collection.ts';
import { biteDelay, rand, rollFish } from '../../model/collection.ts';
import type { WalletService } from '../../model/wallet.ts';
import { createGrotto, grottoSpawn, JOURNAL } from '../../model/grotto.ts';
import type { GrottoService } from '../../model/grotto.ts';
import { decorDef } from '../../model/shop.ts';
import { localJson } from '../../storage.ts';
import { CHEST, MOUTH, PAINTING, POOL, ROOST, caveFloor, caveRay, cavePushOut, floorAt, inCave } from '../../world/grotto.ts';
import { warmEmitter } from '../lights/emitters.ts';
import { toon } from '../toon.ts';
import { bobberGeometry, rodGeometry, ROD_LEN } from '../forage/models.ts';
import { glowcapMaterial } from '../forage/assets.ts';
import { disposeTree } from '../interior/house.ts';
import type { RoomBuilt, RoomDef, RoomHost, RoomView } from '../interior/space.ts';
import {
  BATS, FISH_N, GLOWCAP_TOP, JOURNAL_AT, LANTERN, POOL_LIGHTS, POOL_RIPPLES, batGeometry, batMaterial, buildCamp,
  buildChestLid, buildCrystals, buildShell, crystalClusters, crystalMaterial, crystalTint, curtainGeometry, curtainMaterial,
  dripGeometry, dripMaterial, fishGeometry, glowcapClumps, lanternGlass, motesGeometry, motesMaterial, paintingCanvas,
  paintingGeometry, poolGeometry, poolMaterial, propsMaterial, shaftGeometry, shaftMaterial, shellMaterial,
} from './cave.ts';
import type { PoolUniforms } from './cave.ts';

export const GROTTO_KEY = 'claude-valley.grotto.v1';
let book: GrottoService | null = null;
/** what the player has found in the grotto (persisted), shared by the room, the grotto system and the stamp book */
export function grottoBook(): GrottoService {
  if (!book) book = createGrotto(localJson(GROTTO_KEY));
  return book;
}

/** viewpoints (room-local; `ty` from the floor's level): `__valley.inside('grotto:pool')`, `?pose=grotto:pool` */
export const GROTTO_VIEWS: Readonly<Record<string, RoomView>> = Object.freeze({
  door: { x: 0.1, z: -1.4, tx: 0.6, ty: 1.4, tz: -10 },
  cave: { x: 1.4, z: -5.6, tx: -2.4, ty: 1.0, tz: -14.2 },
  pool: { x: -0.4, z: -8.6, tx: -5.0, ty: 0.0, tz: -12.6 },
  camp: { x: 1.6, z: -6.9, tx: 4.6, ty: 0.55, tz: -9.0 },
  paintings: { x: 0.2, z: -12.0, tx: -1.6, ty: 1.55, tz: -17 },
  chest: { x: 3.7, z: -12.3, tx: 6.3, ty: 0.35, tz: -16.6 },
  // right by the chest, within reach (tests)
  chestside: { x: 5.2, z: -15.0, tx: 6.3, ty: 0.3, tz: -16.6 },
  mouth: { x: 0.4, z: -7.2, tx: 0, ty: 1.4, tz: 1 },
  bats: { x: 0.2, z: -9.0, tx: ROOST.x, ty: 5.2, tz: ROOST.z },
});

export const grottoRoom: RoomDef = {
  id: 'grotto',
  site: 'waterfall',
  origin: MOUTH,
  entry: { x: 0, z: -1.5, yaw: 0, pitch: 0.02 },
  exit: { x: 0, z: 0.95, yaw: Math.PI, pitch: -0.05 },
  views: GROTTO_VIEWS,
  floor: (lx, lz) => floorAt(lx, lz),
  contains: (lx, lz, r) => inCave(lx, lz, r),
  pushOut: (l, r) => cavePushOut(l, r),
  pet: { x: 4.3, z: -10.9, yaw: 2.3 },
  roof: 0,
  light: { sky: 0.16, skyTint: 0x5a6e96, groundTint: 0x262634, sun: 0 },
  build: buildGrotto,
};

const BED_LINES = [
  'You lie back on the bedroll. The crystals turn slowly from teal to violet overhead. Somewhere, a drip keeps time.',
  'The blanket smells of woodsmoke and old adventures. A bat shifts on the ceiling and settles again.',
  'You could sleep here. The roar of the falls is a hush from this far in.',
];
const PAINT_LINES = [
  'Little orange farmers with hoes and watering cans. Whoever painted them had seen a Clawd up close.',
  'The windmill, sails and all, and the very first field in tidy rows. The windmill looks a little newer than the rest.',
  'A sun with long rays, the waterfall, and handprints, red and ochre: someone signing their work, long ago.',
];
const CRYSTAL_LINES = [
  'Cool and smooth, humming very faintly. The colour creeps along it as you watch.',
  'You tap it and it rings, a clear little note, and the bats all turn to look.',
  'Your reflection in it is violet, then teal. Neither of you looks away first.',
];

type FishPhase = 'idle' | 'cast' | 'wait' | 'bite' | 'reel' | 'show';

function buildGrotto(host: RoomHost, _season: Season): RoomBuilt {
  const { ctx, frame } = host;
  const P = frame.P, vec = frame.vec;
  const audio = host.audio;
  const grotto = grottoBook();
  const collection = () => ctx.services.get('collection') as CollectionService | undefined;
  const wallet = () => ctx.services.get('wallet') as WalletService | undefined;
  const say = (t: string, ms = 4200, who?: string) => host.say(t, ms, who ? { who } : undefined);
  const time = { value: 0 };

  const root = new THREE.Group();
  root.name = 'interior:grotto';

  // ---- the shell (+ dripstones), crystals, camp
  const shell = buildShell();
  const shellMesh = new THREE.Mesh(shell.geometry, shellMaterial());
  shellMesh.name = 'grotto:shell';
  // no sun in here (the room light's sun: 0 shuts the key light out) and nothing casts: the shadow pass draws nothing
  const clusters = crystalClusters();
  const crystals = new THREE.Mesh(buildCrystals(clusters), crystalMaterial(time));
  crystals.name = 'grotto:crystals';
  crystals.receiveShadow = false;
  const camp = new THREE.Mesh(buildCamp(), propsMaterial());
  camp.name = 'grotto:camp';

  const lid = new THREE.Mesh(buildChestLid(), toon(0xffffff, { vertexColors: true }));
  lid.name = 'grotto:chest-lid';
  lid.position.set(CHEST.x - Math.sin(CHEST.yaw) * 0.25, caveFloor(CHEST.x, CHEST.z) + 0.42, CHEST.z - Math.cos(CHEST.yaw) * 0.25);
  lid.rotation.order = 'YXZ';
  lid.rotation.y = CHEST.yaw;
  const glassMat = warmEmitter(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.0, 0.45), toneMapped: true }));
  const glass = new THREE.Mesh(lanternGlass(), glassMat);
  glass.name = 'grotto:lantern-glass';
  const caps = new THREE.Mesh(glowcapClumps(), glowcapMaterial());
  caps.name = 'grotto:glowcaps';

  // ---- the pool and its fish
  const poolU: PoolUniforms = {
    uTime: time,
    uLights: { value: Array.from({ length: POOL_LIGHTS }, () => new THREE.Vector3(0, -99, 0)) },
    uLightCols: { value: Array.from({ length: POOL_LIGHTS }, () => new THREE.Color(0, 0, 0)) },
    uRipples: { value: Array.from({ length: POOL_RIPPLES }, () => new THREE.Vector3(0, 0, -99)) },
    uDay: { value: 1 },
  };
  const pool = new THREE.Mesh(poolGeometry(), poolMaterial(poolU));
  pool.name = 'grotto:pool';
  pool.renderOrder = 2;
  const fishMat = toon(0xffffff, { vertexColors: true, emissive: 0x3a2228, emissiveIntensity: 0.6, shared: false });
  const fish = new THREE.InstancedMesh(fishGeometry(), fishMat, FISH_N);
  fish.name = 'grotto:fish';
  fish.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  fish.frustumCulled = false;
  fish.renderOrder = 1;

  // ---- the cave paintings
  const paintTex = new THREE.CanvasTexture(paintingCanvas() as HTMLCanvasElement);
  paintTex.colorSpace = THREE.SRGBColorSpace;
  paintTex.anisotropy = 4;
  const paintMat = toon(0xffffff, { transparent: true, shared: false });
  paintMat.map = paintTex;
  paintMat.alphaTest = 0.04;
  paintMat.depthWrite = false;
  paintMat.polygonOffset = true; paintMat.polygonOffsetFactor = -2; paintMat.polygonOffsetUnits = -2;
  const paintings = new THREE.Mesh(paintingGeometry(), paintMat);
  paintings.name = 'grotto:paintings';
  paintings.renderOrder = 1;

  // ---- the bats
  const batGeo = batGeometry();
  const batState = new THREE.InstancedBufferAttribute(new Float32Array(BATS * 2), 2);
  batState.setUsage(THREE.DynamicDrawUsage);
  batGeo.setAttribute('batState', batState);
  const bats = new THREE.InstancedMesh(batGeo, batMaterial(time), BATS);
  bats.name = 'grotto:bats';
  bats.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  bats.frustumCulled = false;
  const roostY = caveFloor(ROOST.x, ROOST.z) + 1 + caveRay(ROOST.x, caveFloor(ROOST.x, ROOST.z) + 1, ROOST.z, 0, 1, 0, 9);
  const bat = Array.from({ length: BATS }, (_, i) => {
    const a = i * 2.4, rr = 0.25 + (i % 3) * 0.22;
    const hx = ROOST.x + Math.cos(a) * rr, hz = ROOST.z + Math.sin(a) * rr * 0.8;
    const hy = caveFloor(hx, hz) + 1 + caveRay(hx, caveFloor(hx, hz) + 1, hz, 0, 1, 0, 9) - 0.1;
    return { hx, hy, hz, fly: 0, t: 0, dur: 0, phase: i * 0.37, k: 0, yaw: a };
  });
  const batUntil = { v: 0 };

  // ---- drips
  const drips = shell.drips;
  const dripGeo = dripGeometry(drips);
  const dripPts = new THREE.Points(dripGeo, dripMaterial(time));
  dripPts.name = 'grotto:drips';
  dripPts.frustumCulled = false;
  const dripData = dripGeo.attributes.drip as THREE.BufferAttribute;
  const dripCount = new Float64Array(drips.length).fill(-1);
  const dripPos = drips.map((d) => P(d.x, d.floor, d.z));
  let rippleAt = 0;

  // ---- the mouth seen from inside: backlit water, shafts, spray
  const mouthU = { uTime: time, uDay: { value: 1 }, uSky: { value: new THREE.Color(0.6, 0.75, 0.9) } };
  const curtain = new THREE.Mesh(curtainGeometry(), curtainMaterial(mouthU));
  curtain.name = 'grotto:curtain';
  const shafts = new THREE.Mesh(shaftGeometry(), shaftMaterial(mouthU));
  shafts.name = 'grotto:shafts';
  shafts.renderOrder = 3;
  const motes = new THREE.Points(motesGeometry(), motesMaterial(mouthU));
  motes.name = 'grotto:motes';
  motes.renderOrder = 3;

  root.add(shellMesh, crystals, camp, lid, glass, caps, fish, pool, paintings, bats, dripPts, curtain, shafts, motes);

  // ---- lights (world): four crystal clusters, the lantern, the glow-caps, daylight through the curtain
  const big = [0, 4, 7, 5].map((i) => clusters[i]);
  const crystalLights: LightEmitter[] = big.map((c) => ({
    pos: P(c.x + c.nx * 0.6, c.y + c.ny * 0.6, c.z + c.nz * 0.6), color: new THREE.Color(), intensity: 0.85 * Math.min(1.2, c.size + 0.15), radius: 5.2 + c.size * 2, flicker: 0, when: 'always',
  }));
  const lantern: LightEmitter = { pos: P(LANTERN.x, LANTERN.y, LANTERN.z), color: new THREE.Color(1.0, 0.56, 0.22), intensity: 0.75, radius: 5.4, flicker: 0.35, when: 'always' };
  const capLight: LightEmitter = { pos: P(GLOWCAP_TOP.x, GLOWCAP_TOP.y + 0.15, GLOWCAP_TOP.z), color: new THREE.Color(0.3, 1.0, 0.7), intensity: 0.4, radius: 2.4, flicker: 0, when: 'always' };
  const daylight: LightEmitter = { pos: P(0, 1.9, 0.6), color: new THREE.Color(0.7, 0.85, 1.0), intensity: 0.8, radius: 9, dir: new THREE.Vector3(0, -0.28, -1).normalize(), cone: 0.85, when: 'always' };
  const emitters = [...crystalLights, lantern, capLight, daylight];
  let lanternOn = true;

  // ---- fishing in the pool (E on the water): a rod held in view, a bobber, a line
  const fishRig = new THREE.Group();
  fishRig.name = 'grotto:rod';
  const rodMat = toon(0xffffff, { vertexColors: true });
  const rod = new THREE.Mesh(rodGeometry(), rodMat);
  rod.position.set(0.3, -0.36, -0.42);
  fishRig.add(rod);
  const held = new THREE.Mesh(fishGeometry(), fishMat);
  held.position.set(0, -0.1, -0.7);
  held.visible = false;
  fishRig.add(held);
  fishRig.visible = false;
  const bobber = new THREE.Mesh(bobberGeometry(), rodMat);
  bobber.scale.setScalar(1.6);
  bobber.visible = false;
  const linePos = new Float32Array(2 * 3);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3).setUsage(THREE.DynamicDrawUsage));
  const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xfffaf0 }));
  line.frustumCulled = false;
  line.visible = false;
  const fr = rand(Date.now() >>> 0);
  const fs = { phase: 'idle' as FishPhase, t: 0, dur: 0, swing: 1, chances: 0, nibble: 0, cm: 0, caught: '', stand: new THREE.Vector3(), aim: new THREE.Vector3(), tip: new THREE.Vector3(), from: new THREE.Vector3() };
  const poolW = P(POOL.x, POOL.water, POOL.z);
  const _f = new THREE.Vector3();

  function aimAtPool(out: THREE.Vector3): THREE.Vector3 {
    // where the view meets the water plane, kept inside the pool
    ctx.camera.getWorldDirection(_f);
    const eye = ctx.player.eye, wy = poolW.y;
    let t = _f.y < -0.05 ? (eye.y - wy) / -_f.y : 4;
    t = Math.min(9, Math.max(1.5, t));
    out.set(eye.x + _f.x * t, wy, eye.z + _f.z * t);
    const ex = (out.x - poolW.x) / (POOL.rx * 0.8), ez = (out.z - poolW.z) / (POOL.rz * 0.8), er = Math.hypot(ex, ez);
    if (er > 1) { out.x = poolW.x + (ex / er) * POOL.rx * 0.8; out.z = poolW.z + (ez / er) * POOL.rz * 0.8; }
    return out;
  }
  function ripple(x: number, z: number): void {
    const r = poolU.uRipples.value[rippleAt++ % POOL_RIPPLES];
    r.set(x, z, time.value);
  }
  function setFish(ph: FishPhase, dur = 0): void { fs.phase = ph; fs.t = 0; fs.dur = dur; }
  function endFishing(): void { setFish('idle'); fishRig.visible = false; held.visible = false; bobber.visible = false; line.visible = false; }
  function pressPool(): void {
    switch (fs.phase) {
      case 'idle': {
        aimAtPool(fs.aim);
        fs.stand.copy(ctx.player.pos);
        fs.chances = 2;
        fishRig.visible = true; rod.visible = true; held.visible = false;
        bobber.visible = true; line.visible = true;
        placeRig(0);
        fs.from.copy(fs.tip);
        setFish('cast', 0.55);
        audio()?.play('cast', { volume: 0.8 });
        return;
      }
      case 'wait': say(fs.nibble > 0 ? 'Just a nibble... wait for it to go right under.' : 'Nothing yet. They are slow in the dark.', 2200, 'Fishing'); return;
      case 'bite': {
        const c = rollFish(fr, { season: ctx.valley.sky.season, hour: ctx.valley.sky.hour, weather: ctx.valley.sky.weather.kind, water: 'cave' });
        fs.caught = c.id; fs.cm = c.cm;
        setFish('reel', 0.7);
        audio()?.play('reel', { volume: 0.85 });
        return;
      }
      case 'show': endFishing(); return;
      default: return;
    }
  }
  function placeRig(dt: number): void {
    fishRig.position.copy(ctx.camera.position);
    fishRig.quaternion.copy(ctx.camera.quaternion);
    const tilt = fs.phase === 'cast' ? 0.3 : fs.phase === 'bite' ? 1.2 + Math.sin(fs.t * 30) * 0.03 : fs.phase === 'show' ? 0.6 : 1.0;
    fs.swing += (tilt - fs.swing) * Math.min(1, dt * 12 || 1);
    rod.rotation.set(-fs.swing, 0, 0.16, 'YXZ');
    fishRig.updateMatrixWorld(true);
    fs.tip.set(0, ROD_LEN, 0);
    rod.localToWorld(fs.tip);
  }
  function updateFishing(dt: number): void {
    if (fs.phase === 'idle') return;
    fs.t += dt;
    const p = ctx.player;
    if (p.frozen || Math.hypot(p.pos.x - fs.stand.x, p.pos.z - fs.stand.z) > 1.8) { endFishing(); return; }
    placeRig(dt);
    const wy = poolW.y;
    switch (fs.phase) {
      case 'cast': {
        const k = Math.min(1, fs.t / fs.dur);
        bobber.position.lerpVectors(fs.from, fs.aim, k);
        bobber.position.y = fs.from.y + (wy - fs.from.y) * k + Math.sin(k * Math.PI) * 0.9;
        if (k >= 1) { ripple(fs.aim.x, fs.aim.z); audio()?.play('plop', { pos: fs.aim, volume: 0.35, pitch: 1.6 }); setFish('wait', biteDelay(fr, { hour: ctx.valley.sky.hour, weather: 'clear' }) + 1.2); fs.nibble = 0; }
        break;
      }
      case 'wait': {
        fs.nibble = Math.max(0, fs.nibble - dt);
        if (fs.nibble <= 0 && fs.t > 1 && fs.t < fs.dur - 0.8 && fr() < dt * 0.6) { fs.nibble = 0.3; ripple(fs.aim.x, fs.aim.z); audio()?.play('plop', { pos: fs.aim, volume: 0.2, pitch: 1.9 }); }
        bobber.position.set(fs.aim.x, wy + 0.01 + Math.sin(time.value * 2.4) * 0.01 - Math.sin((fs.nibble / 0.3) * Math.PI) * 0.03, fs.aim.z);
        if (fs.t >= fs.dur) { setFish('bite', 1.3); ripple(fs.aim.x, fs.aim.z); audio()?.play('bite', { pos: fs.aim, volume: 1 }); }
        break;
      }
      case 'bite': {
        bobber.position.set(fs.aim.x, wy - 0.06 * Math.min(1, fs.t / 0.12), fs.aim.z);
        if (fs.t >= fs.dur) {
          if (--fs.chances > 0) { say('It slipped away into the dark... there is another one about. Press E when it dips!', 2600, 'Fishing'); setFish('wait', 1.6 + fr() * 1.8); }
          else { say('The cave fish have gone shy. Try again in a moment.', 2400, 'Fishing'); endFishing(); }
        }
        break;
      }
      case 'reel': {
        const k = Math.min(1, fs.t / fs.dur);
        bobber.position.lerpVectors(fs.aim, fs.tip, k * k);
        if (k >= 1) {
          const res = collection()?.catch(fs.caught, fs.cm) ?? null;
          held.visible = true; bobber.visible = false; line.visible = false;
          setFish('show', 2.8);
          audio()?.play('splash', { pos: fs.aim, volume: 0.5, pitch: 1.4 });
          setTimeout(() => audio()?.play(res?.isNew ? 'chime-pass' : 'sparkle', { volume: res?.isNew ? 0.7 : 0.5 }), 150);
          say(res?.isNew ? `A blind cave fish, ${fs.cm} cm! Pale as moonlight and new for your collection. A rare one, too!` : res?.record ? `A whopping ${fs.cm} cm cave fish: your biggest yet!` : `A blind cave fish, ${fs.cm} cm. It doesn't seem to mind. That's ${res?.n ?? 1} caught.`, 4400, 'Fishing');
        }
        break;
      }
      case 'show': {
        const k = Math.min(1, fs.t / 0.35), out = fs.t > fs.dur - 0.3 ? Math.max(0, (fs.dur - fs.t) / 0.3) : 1;
        held.scale.setScalar(2.4 * Math.sin(k * Math.PI * 0.5) * out);
        held.rotation.set(0.15, Math.PI / 2 + Math.sin(time.value * 1.3) * 0.25, Math.sin(time.value * 9) * 0.18 * (1 - k * 0.5));
        if (fs.t >= fs.dur) endFishing();
        break;
      }
    }
    if (line.visible) {
      linePos[0] = fs.tip.x; linePos[1] = fs.tip.y; linePos[2] = fs.tip.z;
      linePos[3] = bobber.position.x; linePos[4] = bobber.position.y + 0.08; linePos[5] = bobber.position.z;
      (lineGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
  }
  // E while fishing even when the crosshair has wandered off the pool
  const onKey = (e: KeyboardEvent) => {
    if (e.code !== 'KeyE' || e.repeat || e.defaultPrevented || ctx.player.frozen || fs.phase === 'idle') return;
    if (ctx.interact.focused()?.id === 'interior:grotto:pool') return;   // the interaction handles it
    pressPool();
  };
  addEventListener('keydown', onKey);

  // ---- today's glow-caps
  const today = () => dayKey(Date.now());
  const capSpawn = () => grottoSpawn(today());
  const capsHere = () => { const s = capSpawn(); return !!s && !(collection()?.picked(today()).has(s.key) ?? false); };
  let capPop = 0, capsAt = -1, capsOn = false;

  // ---- the chest
  let lidK = grotto.chestOpen ? 1 : 0, lidTo = lidK;

  // ---- interactables (ids 'interior:*': offered only while inside)
  const tmp = new THREE.Vector3();
  let paintLine = 0, crystalLine = 0, bedLine = 0;
  const I = (id: string, verb: string | (() => string), label: () => string, at: readonly [number, number, number], use: () => void, o: Partial<Interactable> = {}): Interactable => {
    const it: Interactable = { id: `interior:grotto:${id}`, kind: 'prop', verb: typeof verb === 'string' ? verb : verb(), label, pos: vec(at[0], at[1], at[2]), use, ...o };
    if (typeof verb === 'function') Object.defineProperty(it, 'verb', { get: verb });
    return it;
  };
  const clusterAt = clusters[0];
  const interactables = (): Interactable[] => [
    I('journal', 'Read', () => 'Explorer\'s journal', [JOURNAL_AT.x, JOURNAL_AT.y + 0.05, JOURNAL_AT.z], () => {
      const page = grotto.readPage();
      audio()?.play('page', { volume: 0.6 });
      say(`"${JOURNAL[page]}"`, 7000, `Journal · page ${page + 1} of ${JOURNAL.length}`);
    }, { hint: () => `an old notebook, open on the crate · ${grotto.data().pages}/${JOURNAL.length} pages read`, reach: 2.6 }),
    I('lantern', () => (lanternOn ? 'Turn down' : 'Turn up'), () => 'Explorer\'s lantern', [LANTERN.x, LANTERN.y, LANTERN.z], () => {
      lanternOn = !lanternOn;
      audio()?.play('ui-click', { volume: 0.5 });
      say(lanternOn ? 'The wick catches and the camp is warm again.' : 'You turn the wick right down. Now it\'s just you and the crystals.', 3000);
    }, { reach: 2.6 }),
    I('bedroll', 'Rest on', () => 'Bedroll', [4.9, caveFloor(5.3, -9.4) + 0.25, -9.4], () => { audio()?.play('hoe', { volume: 0.25, pitch: 0.7 }); say(BED_LINES[bedLine++ % BED_LINES.length], 4800); }, { reach: 2.6 }),
    I('glowcap', 'Pick', () => 'Glow-caps', [GLOWCAP_TOP.x, GLOWCAP_TOP.y, GLOWCAP_TOP.z], () => {
      const s = capSpawn();
      if (!s || !capsHere()) return;
      const r = collection()?.pick(s) ?? null;
      capPop = 1; capsAt = -1;
      audio()?.play('pop', { pos: tmp.copy(capLight.pos), volume: 0.8, pitch: 1.2 });
      setTimeout(() => audio()?.play('sparkle', { volume: r?.isNew ? 0.9 : 0.5 }), 90);
      say(r?.isNew ? 'Glow-caps! They grow nowhere else in the valley. New for your collection (K).' : `Glow-caps, softly shining in your hand. That's ${r?.n ?? 1} now.`, 4200, 'Foraging');
    }, { enabled: () => capsOn, hint: () => { const f = collection()?.data().found.glowcap; return f ? `in your collection · ${f.n} found` : 'something new for your collection!'; }, reach: 2.6 }),
    I('pool', () => (fs.phase === 'idle' ? 'Cast a line' : fs.phase === 'bite' ? 'Hook it!' : fs.phase === 'show' ? 'Let go' : 'Reel in'), () => (fs.phase === 'idle' ? 'Still pool' : 'Bobber'),
      [POOL.x + POOL.rx * 0.45, POOL.water, POOL.z + POOL.rz * 0.3], () => pressPool(),
      { hint: () => (fs.phase === 'idle' ? 'something pale moves down there' : fs.phase === 'bite' ? 'it\'s biting!' : 'wait for the bobber to dip, then E'), reach: 6.5, enabled: () => fs.phase !== 'cast' && fs.phase !== 'reel' }),
    I('chest', () => (grotto.chestOpen ? 'Look in' : 'Open'), () => 'Old sea chest', [CHEST.x, caveFloor(CHEST.x, CHEST.z) + 0.5, CHEST.z], () => {
      if (grotto.openChest()) {
        lidTo = 1;
        const gift = wallet()?.gift('geode');
        audio()?.play('creak', { volume: 0.7, pitch: 0.8 });
        setTimeout(() => audio()?.play('chime-pass', { volume: 0.8 }), 450);
        say(gift ? `Inside, wrapped in a scarf: a ${decorDef('geode')?.name ?? 'geode lamp'}, still glowing. A note: "For the curious. — R." It's waiting in your yard.` : 'Inside, wrapped in a scarf: a glowing geode lamp. A note: "For the curious. — R."', 6500, 'Hidden chest');
      } else { lidTo = lidTo > 0.5 ? 0 : 1; say('Empty now, except for the scarf and the smell of old adventures.', 3200); }
    }, { hint: () => (grotto.chestOpen ? 'you found what was inside' : 'tucked away behind the stalagmites'), reach: 2.6 }),
    I('paintings', 'Look at', () => 'Cave paintings', [PAINTING.x, caveFloor(PAINTING.x, PAINTING.z) + PAINTING.y, PAINTING.z - 0.4], () => say(PAINT_LINES[paintLine++ % PAINT_LINES.length], 5200), { reach: 4.5 }),
    I('crystal', 'Touch', () => 'Crystals', [clusterAt.x + clusterAt.nx * 0.4, clusterAt.y + clusterAt.ny * 0.4, clusterAt.z + clusterAt.nz * 0.4], () => {
      audio()?.play('sparkle', { volume: 0.6, pitch: 0.8 + Math.random() * 0.4 });
      say(CRYSTAL_LINES[crystalLine++ % CRYSTAL_LINES.length], 3800);
      flutter(2);
    }, { reach: 3.2 }),
    I('bats', 'Watch', () => 'Bats', [ROOST.x, roostY - 0.4, ROOST.z], () => {
      say(ctx.lighting.night > 0.5 ? 'Most of them are out hunting moths over the pond. The sleepy ones stay home.' : 'Seven bats in a row, wrapped up like tiny umbrellas. One opens an ear at you.', 4000);
    }, { reach: 6.5 }),
    I('mouth', 'Step out', () => 'Behind the falls', [0, 1.4, 0.2], () => host.leave(), { hint: () => 'back out onto the ledge', reach: 2.4 }),
  ];

  // ---- the bats: take off when you come in (or startle), loop the dome, settle back
  function flutter(n: number): void {
    let woke = 0;
    for (const b of bat) {
      if (woke >= n || b.dur > 0) continue;
      b.t = -Math.random() * 0.8; b.dur = 4 + Math.random() * 4; woke++;
    }
    if (woke) {
      const a = audio() as (AudioService & { critter?(k: string, p: THREE.Vector3, o?: { volume?: number; pitch?: number }): void }) | undefined;
      a?.critter?.('flap', tmp.copy(P(ROOST.x, roostY - 0.5, ROOST.z)), { volume: 0.9 });
      setTimeout(() => a?.critter?.('squeak', P(ROOST.x, roostY - 0.5, ROOST.z), { volume: 0.4, pitch: 1.8 }), 300);
    }
  }
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
  const centre = new THREE.Vector3(ROOST.x - 0.4, roostY - 1.9, ROOST.z + 0.6);
  function updateBats(dt: number): void {
    const t = time.value;
    for (let i = 0; i < BATS; i++) {
      const b = bat[i];
      let flying = 0;
      if (b.dur > 0) {
        b.t += dt;
        if (b.t >= b.dur) { b.dur = 0; b.t = 0; }
        else if (b.t > 0) flying = Math.min(1, b.t / 0.4, (b.dur - b.t) / 0.5);
      }
      b.k += (flying - b.k) * Math.min(1, dt * 6);
      if (b.k > 0.01) {
        // a lissajous loop round the dome, each bat its own
        const u = (b.t + b.phase * 3) * (0.9 + i * 0.07);
        const fx = centre.x + Math.sin(u) * (3.6 + i * 0.25), fy = centre.y + Math.sin(u * 2.1 + i) * 0.6, fz = centre.z + Math.sin(u * 2) * (2.4 + (i % 3) * 0.3);
        _p.set(b.hx + (fx - b.hx) * b.k, b.hy + (fy - b.hy) * b.k, b.hz + (fz - b.hz) * b.k);
        const vx = Math.cos(u) * (3.6 + i * 0.25), vz = Math.cos(u * 2) * 2 * (2.4 + (i % 3) * 0.3);
        _e.set(-Math.PI / 2 * (1 - b.k), Math.atan2(vx, vz) * b.k + b.yaw * (1 - b.k), Math.sin(u * 2) * 0.4 * b.k);
      } else {
        // roosting: hanging head-down under the rock, a slow sway
        _p.set(b.hx, b.hy, b.hz);
        _e.set(-Math.PI / 2, b.yaw, Math.sin(t * 0.7 + i) * 0.06);
      }
      _q.setFromEuler(_e);
      // hanging by the feet: the body hangs below the roost point
      if (b.k < 0.99) _p.y -= 0.07 * (1 - b.k);
      bats.setMatrixAt(i, _m.compose(_p, _q, _s.setScalar(1.15)));
      batState.setXY(i, b.k, b.phase);
    }
    bats.instanceMatrix.needsUpdate = true;
    batState.needsUpdate = true;
  }

  // ---- the fish: slow loops under the still water
  function updateFish(): void {
    const t = time.value;
    for (let i = 0; i < FISH_N; i++) {
      const u = t * (0.16 + i * 0.05) + i * 2.1, rr = 0.55 + i * 0.42;
      _p.set(POOL.x + Math.cos(u) * rr * (POOL.rx / POOL.rz) * 0.8, POOL.water - 0.2 - i * 0.07, POOL.z + Math.sin(u) * rr * 0.8);
      _e.set(0, -u + (i % 2 ? Math.PI : 0) + Math.sin(t * 3 + i) * 0.08, 0);
      if (i % 2) _p.z = POOL.z - Math.sin(u) * rr * 0.8;
      _q.setFromEuler(_e);
      fish.setMatrixAt(i, _m.compose(_p, _q, _s.setScalar(1.7)));
    }
    fish.instanceMatrix.needsUpdate = true;
  }

  const tint = new THREE.Color();
  const dayC = new THREE.Color();
  let firstLine = false;

  return {
    root,
    extras: [fishRig, bobber, line],
    emitters,
    interactables,
    entered() {
      firstLine = grotto.data().visits === 0;
      grotto.visit();
      flutter(BATS);
      endFishing();
      if (firstLine) setTimeout(() => say('Your eyes adjust. Crystals glimmer all over the walls, a still pool shines in the dark, and someone has camped here before you.', 6500, 'The grotto'), 900);
    },
    left() { endFishing(); },
    update(f, rdt) {
      const dt = f.dt > 0 ? f.dt : 0;
      time.value = f.time;
      const L = ctx.lighting;
      const day = Math.max(0, Math.min(1, (1 - L.night * 1.1) * Math.min(1, L.sunIntensity / 1.6 + 0.35)));
      // daylight through the water at the mouth
      dayC.copy(L.skyColor).lerp(L.sunColor, 0.3);
      mouthU.uDay.value = day;
      mouthU.uSky.value.copy(dayC);
      daylight.color.copy(dayC).lerp(tint.setRGB(0.6, 0.8, 1.0), 0.5);
      daylight.intensity = 0.15 + 0.75 * day;
      poolU.uDay.value = day;
      // the crystals' colours (the same wheel as the shader) and their mirror in the pool
      for (let i = 0; i < crystalLights.length; i++) {
        const e = crystalLights[i];
        crystalTint(big[i].phase, f.time, e.color);
        poolU.uLights.value[i].copy(e.pos);
        poolU.uLightCols.value[i].copy(e.color).multiplyScalar(e.intensity);
      }
      lantern.gain = lanternOn ? 1 : 0.12;
      glassMat.color.setRGB(1.6, 1.0, 0.45).multiplyScalar(lanternOn ? 1 : 0.25);
      poolU.uLights.value[4].copy(lantern.pos);
      poolU.uLightCols.value[4].copy(lantern.color).multiplyScalar(lanternOn ? 0.8 : 0.1);
      poolU.uLights.value[5].copy(daylight.pos);
      poolU.uLightCols.value[5].copy(daylight.color).multiplyScalar(daylight.intensity * 0.8);
      // today's glow-caps
      if (capsAt < 0 || f.time - capsAt > 1) { capsAt = f.time; capsOn = capsHere(); }   // (a day key string: once a second)
      if (capPop > 0) { capPop = Math.max(0, capPop - rdt / 0.35); caps.scale.setScalar(capPop > 0 ? 1 + (1 - capPop) * 0.4 : 1); }
      caps.visible = capsOn || capPop > 0;
      capLight.gain = caps.visible ? 1 : 0;
      // the chest's lid
      if (lidK !== lidTo) { lidK += Math.sign(lidTo - lidK) * Math.min(Math.abs(lidTo - lidK), (dt || rdt) * 1.6); }
      lid.rotation.x = -lidK * 1.75;
      // life
      updateBats(dt);
      updateFish();
      // drips: a plip and a ring on the pool as each lands
      for (let i = 0; i < drips.length; i++) {
        const period = dripData.getY(i), phase = dripData.getZ(i);
        const c = Math.floor(f.time / period + phase);
        if (dripCount[i] < 0) { dripCount[i] = c; continue; }
        if (c !== dripCount[i]) {
          dripCount[i] = c;
          const d = drips[i];
          const onPool = d.floor === POOL.water;
          if (onPool) ripple(d.x, d.z);
          const pp = dripPos[i];
          if (Math.hypot(pp.x - ctx.player.pos.x, pp.z - ctx.player.pos.z) < 12) audio()?.play('plop', { pos: pp, volume: onPool ? 0.22 : 0.12, pitch: 2.0 + (i % 4) * 0.18 });
        }
      }
      // now and then a bat stirs
      if (f.time > batUntil.v) { batUntil.v = f.time + 22 + Math.random() * 30; if (Math.random() < 0.5) flutter(1); }
      updateFishing(dt || rdt);
    },
    dispose() {
      removeEventListener('keydown', onKey);
      disposeTree(root);
      for (const o of [fishRig, bobber, line]) disposeTree(o);
      lineGeo.dispose();
      paintTex.dispose();
    },
    stats: () => ({ tris: (shell.geometry.attributes.position.count / 3) | 0, drips: drips.length, fishing: fs.phase === 'idle' ? 0 : 1, caps: capsHere() ? 1 : 0 }),
  };
}
