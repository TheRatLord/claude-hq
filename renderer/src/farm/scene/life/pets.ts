/**
 * The village pets.
 *  - Biscuit (dog): pads around the square, runs to greet you when you come near, follows you for a while, sits
 *    when you stop, wags; visits idle farmers; sleeps on the porch at night and shelters from storms. Pet him.
 *  - Mochi (cat): naps in warm spots (porch, noticeboard, the campfire at night), stretches, strolls, grooms, looks
 *    at you when you pass, sometimes sits with a farmer. Pet her for a purr.
 * Each pet is one rigged mesh (one draw call + its shadow).
 */
import * as THREE from 'three';
import type { FarmerLocator, FrameInfo, SceneCtx } from '../context.ts';
import { WORLD, heightAt, slopeAt, structure } from '../../world/map.ts';
import { seeded } from '../../../core/rng.ts';
import { rigMaterial } from './rig.ts';
import type { RigMaterial } from './rig.ts';
import { cat, dog } from './models.ts';
import type { Activity } from './schedule.ts';
import { audioOf, clamp, critterSound, damp, dampAngle, groundY, openGround, wrap } from './util.ts';
import type { Fx, Rng } from './util.ts';

export type PetKind = 'dog' | 'cat';
export type PetPose = 'stand' | 'walk' | 'sit' | 'lie' | 'stretch' | 'loaf' | 'curl';

export interface PoseInput {
  pose: PetPose;
  /** m/s over the ground (gait) */
  speed: number;
  /** 0 calm … 1 overjoyed (tail) */
  wag: number;
  /** head turn / tilt relative to the body (rad) */
  lookYaw: number;
  lookPitch: number;
  /** 0..1 excited bouncing on the spot */
  bounce: number;
  /** nose to the ground */
  sniff: boolean;
}

interface PoseTarget { pitch: number; lift: number; legs: [number, number, number, number]; headP: number; tailL: number }

const POSES: Record<PetKind, Record<PetPose, PoseTarget>> = {
  dog: {
    stand: { pitch: 0, lift: 0, legs: [0, 0, 0, 0], headP: 0, tailL: 0.1 },
    walk: { pitch: 0, lift: 0, legs: [0, 0, 0, 0], headP: 0.05, tailL: 0.1 },
    sit: { pitch: -0.55, lift: -0.08, legs: [0.55, 0.55, -1.15, -1.15], headP: -0.35, tailL: -0.3 },
    lie: { pitch: 0, lift: -0.29, legs: [-1.45, -1.45, 1.35, 1.35], headP: 0.3, tailL: -0.5 },
    stretch: { pitch: 0.35, lift: -0.06, legs: [-0.9, -0.9, 0.35, 0.35], headP: -0.4, tailL: 0.4 },
    loaf: { pitch: 0, lift: -0.29, legs: [-1.45, -1.45, 1.35, 1.35], headP: 0.3, tailL: -0.5 },
    curl: { pitch: 0, lift: -0.31, legs: [-1.45, -1.45, 1.35, 1.35], headP: 0.55, tailL: -0.6 },
  },
  cat: {
    stand: { pitch: 0, lift: 0, legs: [0, 0, 0, 0], headP: 0, tailL: 0 },
    walk: { pitch: 0, lift: 0, legs: [0, 0, 0, 0], headP: 0.05, tailL: 0.1 },
    sit: { pitch: -0.6, lift: -0.05, legs: [0.6, 0.6, -1.2, -1.2], headP: -0.45, tailL: -1.1 },
    lie: { pitch: 0, lift: -0.15, legs: [-1.5, -1.5, 1.4, 1.4], headP: 0.15, tailL: -1.2 },
    stretch: { pitch: 0.4, lift: -0.04, legs: [-1.0, -1.0, 0.4, 0.4], headP: -0.5, tailL: 0.5 },
    loaf: { pitch: 0, lift: -0.15, legs: [-1.55, -1.55, -1.5, -1.5], headP: 0.1, tailL: -1.25 },
    curl: { pitch: 0, lift: -0.16, legs: [-1.55, -1.55, -1.5, -1.5], headP: 0.6, tailL: -1.3 },
  },
};

/** A pet's body: rigged mesh + pose blending + gait. The brain moves `root`; the body animates inside it. */
export class PetBody {
  readonly root = new THREE.Group();
  readonly mesh: THREE.Mesh;
  readonly mat: RigMaterial;
  private pitch = 0; private lift = 0; private readonly legs = [0, 0, 0, 0]; private headP = 0; private headY = 0; private tailL = 0;
  private gait = 0; private wagT = 0; private bounceT = 0; private wagAmp = 0;
  readonly kind: PetKind;
  constructor(kind: PetKind) {
    this.kind = kind;
    const m = kind === 'dog' ? dog() : cat();
    this.mat = rigMaterial(m.spec, { instanced: false });
    this.mesh = new THREE.Mesh(m.geo, this.mat);
    this.mesh.rotation.order = 'YXZ';
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.name = `life:${kind}`;
    this.root.add(this.mesh);
  }
  animate(dt: number, t: number, o: PoseInput): void {
    const T = POSES[this.kind][o.pose];
    const r = 9;
    this.pitch = damp(this.pitch, T.pitch + (o.sniff ? 0.05 : 0), r, dt);
    this.lift = damp(this.lift, T.lift, r, dt);
    this.headP = damp(this.headP, T.headP + o.lookPitch + (o.sniff ? 0.55 + Math.sin(t * 7) * 0.08 : 0), r, dt);
    this.headY = dampAngle(this.headY, clamp(o.lookYaw, -1, 1), 6, dt);
    this.tailL = damp(this.tailL, T.tailL + o.wag * 0.25, 5, dt);
    const moving = o.speed > 0.15 && (o.pose === 'walk' || o.pose === 'stand');
    const legLen = this.kind === 'dog' ? 0.36 : 0.2;
    this.gait += (o.speed / legLen) * dt * 0.95;
    const amp = moving ? Math.min(0.85, 0.25 + o.speed * 0.13) : 0;
    const run = o.speed > 3.2;
    for (let i = 0; i < 4; i++) {
      // trot: diagonal pairs; gallop: front pair then rear pair
      const ph = run ? (i < 2 ? 0 : Math.PI * 0.8) + (i % 2) * 0.35 : (i === 0 || i === 3 ? 0 : Math.PI);
      const swing = Math.sin(this.gait + ph) * amp;
      this.legs[i] = damp(this.legs[i], T.legs[i] + swing, moving ? 30 : r, dt);
    }
    this.wagAmp = damp(this.wagAmp, o.wag, 4, dt);
    this.wagT += dt * (4 + this.wagAmp * (this.kind === 'dog' ? 18 : 3));
    const wag = this.kind === 'dog'
      ? Math.sin(this.wagT) * (0.12 + this.wagAmp * 0.7)
      : (o.pose === 'loaf' || o.pose === 'curl' ? 1.3 + Math.sin(this.wagT * 0.5) * 0.08 : Math.sin(this.wagT * 0.6) * (0.25 + this.wagAmp * 0.25));
    this.bounceT += dt * 11;
    const bob = moving ? Math.abs(Math.sin(this.gait)) * (run ? 0.07 : 0.025) : 0;
    const hop = o.bounce > 0 ? Math.abs(Math.sin(this.bounceT)) * 0.12 * o.bounce : 0;
    const breathe = o.pose === 'lie' || o.pose === 'loaf' || o.pose === 'curl' ? Math.sin(t * 1.6) * 0.012 : Math.sin(t * 2.4) * 0.006;
    this.mesh.position.y = this.lift + bob + hop;
    this.mesh.rotation.x = this.pitch + (run && moving ? Math.sin(this.gait) * 0.08 : 0);
    this.mesh.scale.set(1, 1 + breathe, 1);
    this.mat.userData.animA.set(this.legs[0], this.legs[1], this.legs[2], this.legs[3]);
    this.mat.userData.animB.set(this.headP, this.headY + (o.bounce > 0 ? Math.sin(this.bounceT * 0.5) * 0.25 : 0), wag, this.tailL);
  }
  dispose(): void { this.mesh.geometry.dispose(); this.mat.dispose(); }
}

// ---------------------------------------------------------------------------------------------
// Brains

type DogState = 'home' | 'greet' | 'follow' | 'visit' | 'shelter' | 'sleep' | 'petted';
type CatState = 'nap' | 'stretch' | 'stroll' | 'groom' | 'visit' | 'petted' | 'watch';

interface Mover { x: number; z: number; y: number; yaw: number; v: number; stuck: number; r: number; wp: number }

export interface Pets {
  meshes: THREE.Object3D[];
  update(f: FrameInfo, act: Activity): void;
  stats(): Record<string, number | string>;
  dispose(): void;
}

const DOG_SAY = ['Biscuit wiggles all over!', 'Good boy, Biscuit!', 'Biscuit gives you a happy lick.', 'Biscuit\'s tail is a blur.', 'Biscuit rolls over for belly rubs.'];
const CAT_SAY = ['Mochi purrs contentedly.', 'Mochi headbutts your hand.', 'Mochi slow-blinks at you.', 'Mochi kneads the air, very pleased.', 'Mochi tolerates this. Graciously.'];

export function createPets(ctx: SceneCtx, fx: Fx): Pets {
  const rng: Rng = seeded('life:pets');
  const player = ctx.player.pos;
  const fh = structure('farmhouse');
  const fire = structure('campfire');
  const board = structure('noticeboard');
  const front = (dist: number, side: number) => ({
    x: fh.x + Math.sin(fh.yaw) * (fh.size[1] / 2 + dist) + Math.cos(fh.yaw) * side,
    z: fh.z + Math.cos(fh.yaw) * (fh.size[1] / 2 + dist) - Math.sin(fh.yaw) * side,
  });
  // the farmhouse porch (farmhouse-local: deck x ±4.95, z 2.0…4.6, railings with a gap at the steps, x ±1.1)
  const L = (lx: number, lz: number) => ({ x: fh.x + lx * Math.cos(fh.yaw) + lz * Math.sin(fh.yaw), z: fh.z - lx * Math.sin(fh.yaw) + lz * Math.cos(fh.yaw) });
  const local = (x: number, z: number, out: { x: number; z: number }) => {
    const dx = x - fh.x, dz = z - fh.z, c = Math.cos(fh.yaw), sn = Math.sin(fh.yaw);
    out.x = dx * c - dz * sn; out.z = dx * sn + dz * c; return out;
  };
  const lp = { x: 0, z: 0 };
  const onPorch = (x: number, z: number) => { local(x, z, lp); return Math.abs(lp.x) <= 4.8 && lp.z >= 1.8 && lp.z <= 4.5; };
  const stepsOut = L(0, 6.3), stepsIn = L(0, 3.7);
  const home = { x: 3, z: -4 };
  const dogBed = L(3.7, 2.9);
  const catSpots = [L(-4.0, 2.7), { x: board.x + 1.6, z: board.z + 1.8 }, front(1.0, 1.4), { x: 9.5, z: 7 }];
  const catNight = { x: fire.x + 2.4, z: fire.z - 2.3 };
  const W = WORLD.water;

  const dogBody = new PetBody('dog'), catBody = new PetBody('cat');
  ctx.scene.add(dogBody.root, catBody.root);

  const dogM: Mover = { x: home.x, z: home.z, y: 0, yaw: 0, v: 0, stuck: 0, r: 0.35, wp: 0 };
  const catM: Mover = { x: catSpots[0].x, z: catSpots[0].z, y: 0, yaw: fh.yaw + 0.9, v: 0, stuck: 0, r: 0.25, wp: 0 };
  const tmp = { x: 0, z: 0 };

  function step(m: Mover, tx: number, tz: number, speed: number, dt: number): number {
    const dx = tx - m.x, dz = tz - m.z, d = Math.hypot(dx, dz);
    if (d < 0.08) { m.v = damp(m.v, 0, 10, dt); return d; }
    const want = Math.atan2(dx, dz);
    m.yaw = dampAngle(m.yaw, want, 7, dt);
    const face = Math.max(0.15, Math.cos(wrap(want - m.yaw)));
    m.v = damp(m.v, Math.min(speed, d * 2.5) * face, 5, dt);
    const nx = m.x + Math.sin(m.yaw) * m.v * dt, nz = m.z + Math.cos(m.yaw) * m.v * dt;
    if (heightAt(nx, nz) < W + 0.12 || slopeAt(nx, nz) > 0.45) { m.v = 0; m.stuck += dt; return d; }
    const px = m.x, pz = m.z;
    tmp.x = nx; tmp.z = nz;
    ctx.colliders.resolve(tmp, m.r);
    // keep a polite distance from the player's feet
    const ex = tmp.x - player.x, ez = tmp.z - player.z, ed = Math.hypot(ex, ez), min = m.r + 0.55;
    if (ed < min && ed > 1e-4) { tmp.x = player.x + (ex / ed) * min; tmp.z = player.z + (ez / ed) * min; }
    m.x = tmp.x; m.z = tmp.z;
    const moved = Math.hypot(m.x - px, m.z - pz);
    m.stuck = moved < m.v * dt * 0.3 ? m.stuck + dt : Math.max(0, m.stuck - dt);
    return d;
  }
  /** step toward a target, going round by the porch steps when the target is on the porch and we are not (or back) */
  function goTo(m: Mover, tx: number, tz: number, speed: number, dt: number): number {
    const tIn = onPorch(tx, tz);
    if (tIn !== onPorch(m.x, m.z)) {
      if (m.wp === 0) m.wp = 1;
      const a = tIn ? stepsOut : stepsIn, b = tIn ? stepsIn : stepsOut;
      const w = m.wp === 1 ? a : b;
      if (step(m, w.x, w.z, speed, dt) < 0.4) m.wp = m.wp === 1 ? 2 : 1;
      return Math.hypot(tx - m.x, tz - m.z) + 1;
    }
    m.wp = 0;
    return step(m, tx, tz, speed, dt);
  }
  const lookAt = (m: Mover, x: number, y: number, z: number, out: { yaw: number; pitch: number }, headY: number) => {
    const dx = x - m.x, dz = z - m.z;
    out.yaw = wrap(Math.atan2(dx, dz) - m.yaw);
    out.pitch = clamp(-(y - (m.y + headY)) / Math.max(1, Math.hypot(dx, dz)), -0.6, 0.5);
    if (Math.abs(out.yaw) > 1.4) { out.yaw = 0; out.pitch = 0; }
  };
  const look = { yaw: 0, pitch: 0 };
  const farmerSpot = (out: { x: number; z: number; id: string }): boolean => {
    const loc = ctx.services.get('farmers') as FarmerLocator | undefined;
    if (!loc) return false;
    let n = 0, pick: string | null = null;
    for (const f of ctx.valley.farmers.values()) {
      if (f.job !== 'idle' && f.job !== 'done' && f.job !== 'plan') continue;
      n++;
      if (rng() < 1 / n) pick = f.id;
    }
    if (!pick) return false;
    const p = loc.position(pick);
    if (!p) return false;
    const a = rng() * Math.PI * 2;
    out.x = p.x + Math.cos(a) * 1.2; out.z = p.z + Math.sin(a) * 1.2; out.id = pick;
    return openGround(ctx, out.x, out.z, 0.3);
  };

  // ------------------------------------------------------------------ Biscuit
  let dogState: DogState = 'home', dogPrev: DogState = 'home';
  let dogT = 0, dogTarget = { x: home.x, z: home.z }, dogGreetCool = 4, dogFollow = 0, dogStill = 0, dogBarkIn = 0, dogPet = 0;
  let dogPose: PetPose = 'stand', dogSniff = false, dogWag = 0.3, dogBounce = 0, dogVisitT = 60 + rng() * 60;
  const dogVisit = { x: 0, z: 0, id: '' };
  const pickHomeSpot = () => {
    for (let i = 0; i < 12; i++) {
      const x = home.x + (rng() - 0.5) * 18, z = home.z + (rng() - 0.5) * 14;
      if (openGround(ctx, x, z, 0.5)) { dogTarget = { x, z }; return; }
    }
    dogTarget = { x: home.x, z: home.z };
  };
  const bark = (n = 1) => { for (let i = 0; i < n; i++) setTimeout(() => critterBark(), i * 280); };
  const critterBark = () => { const a = audioOf(ctx); if (a && Math.hypot(player.x - dogM.x, player.z - dogM.z) < 45) a.play('bark', { pos: dogBody.root.position, pitch: 0.95 + rng() * 0.15 }); };

  function dogBrain(dt: number, act: Activity) {
    dogT -= dt; dogGreetCool -= dt; dogVisitT -= dt;
    const pd = Math.hypot(player.x - dogM.x, player.z - dogM.z);
    const moving = ctx.player.speed > 0.5;
    dogStill = moving ? 0 : dogStill + dt;
    dogSniff = false; dogBounce = damp(dogBounce, 0, 3, dt);
    const rest = act.sleep ? 'sleep' : act.shelter ? 'shelter' : null;
    if (rest && dogState !== rest && dogState !== 'petted' && dogState !== 'follow') { dogState = rest; }
    if (!rest && (dogState === 'sleep' || dogState === 'shelter')) { dogState = 'home'; dogT = 0; }
    switch (dogState) {
      case 'home': {
        if (pd < 16 && pd > 2.5 && dogGreetCool <= 0 && !ctx.player.frozen) {
          dogState = 'greet'; bark(2); critterSound(ctx, 'wag', dogM.x, dogM.y + 0.6, dogM.z, 30, 0.7);
          break;
        }
        if (dogVisitT <= 0 && pd > 25) {
          dogVisitT = 80 + rng() * 80;
          if (farmerSpot(dogVisit)) { dogState = 'visit'; dogT = 60; break; }
        }
        const d = goTo(dogM, dogTarget.x, dogTarget.z, 1.5, dt);
        if (d < 0.3 || dogM.stuck > 1.5) {
          dogM.stuck = 0;
          if (dogT <= 0) { dogT = 3 + rng() * 9; pickHomeSpot(); dogPose = rng() < 0.4 ? 'sit' : rng() < 0.2 ? 'lie' : 'stand'; }
        } else { dogPose = 'walk'; dogSniff = rng() < 0.5 && dogM.v < 1.6 && (Math.floor(dogT) % 3 === 0); }
        dogWag = 0.25;
        break;
      }
      case 'greet': {
        const d = goTo(dogM, player.x, player.z, 6.2, dt);
        dogPose = 'walk'; dogWag = 1;
        if (d < 1.6) { dogState = 'follow'; dogFollow = 45 + rng() * 30; dogBounce = 1; dogT = 1.5; }
        if (pd > 40 || dogM.stuck > 3) { dogState = 'home'; dogGreetCool = 30; dogM.stuck = 0; }
        break;
      }
      case 'follow': {
        dogFollow -= dt;
        // trot beside the player while walking; when they stop, come round in front, sit and look up at them
        const sy = Math.sin(ctx.player.yaw), cy = Math.cos(ctx.player.yaw);
        const front = dogStill > 0.6;
        const fwd = front ? -1.75 : 0.5, side = front ? 0.45 : 1.3;
        const tx = player.x + sy * fwd + cy * side, tz = player.z + cy * fwd - sy * side;
        const d = Math.hypot(tx - dogM.x, tz - dogM.z);
        if (d > 1.0 || moving) {
          goTo(dogM, tx, tz, clamp(d * 1.6, 1.2, 8.5), dt);
          dogPose = dogM.v > 0.2 ? 'walk' : 'stand';
        } else {
          dogM.v = damp(dogM.v, 0, 8, dt);
          dogM.yaw = dampAngle(dogM.yaw, Math.atan2(player.x - dogM.x, player.z - dogM.z), 4, dt);
          dogPose = dogStill > 1.4 ? 'sit' : 'stand';
        }
        dogWag = dogPose === 'sit' ? 0.75 : 0.55;
        if (dogT > 0) dogBounce = 1;
        dogBarkIn -= dt;
        if (dogStill > 1.2 && dogBarkIn <= 0 && pd < 6) { dogBarkIn = 25 + rng() * 30; if (rng() < 0.5) bark(1); else critterSound(ctx, 'wag', dogM.x, dogM.y + 0.6, dogM.z, 15, 0.6); }
        if (dogFollow <= 0 || pd > 35 || rest) { dogState = rest ?? 'home'; dogGreetCool = 150 + rng() * 60; dogT = 0; pickHomeSpot(); }
        break;
      }
      case 'visit': {
        const d = goTo(dogM, dogVisit.x, dogVisit.z, 2.2, dt);
        dogPose = d > 0.3 ? 'walk' : 'sit';
        dogWag = d > 0.3 ? 0.4 : 0.6;
        if (d < 0.3) { dogT = Math.min(dogT, 30); const loc = ctx.services.get('farmers') as FarmerLocator | undefined; const p = loc?.position(dogVisit.id); if (p) dogM.yaw = dampAngle(dogM.yaw, Math.atan2(p.x - dogM.x, p.z - dogM.z), 3, dt); }
        if (dogT <= 0 || dogM.stuck > 3) { dogState = 'home'; dogM.stuck = 0; dogT = 0; }
        if (pd < 12 && dogGreetCool <= 0) { dogState = 'greet'; bark(2); }
        break;
      }
      case 'sleep':
      case 'shelter': {
        const d = goTo(dogM, dogBed.x, dogBed.z, dogState === 'shelter' ? 4 : 1.6, dt);
        if (d < 0.35) { dogPose = dogState === 'sleep' ? 'curl' : 'lie'; dogM.yaw = dampAngle(dogM.yaw, fh.yaw + 0.6, 2, dt); }
        else dogPose = 'walk';
        dogWag = pd < 3 ? 0.35 : 0;
        break;
      }
      case 'petted': {
        dogPet -= dt;
        dogM.v = damp(dogM.v, 0, 10, dt);
        dogWag = 1; dogBounce = dogPrev === 'sleep' ? 0 : 1;
        dogPose = dogPrev === 'sleep' || dogPrev === 'shelter' ? 'lie' : dogPet > 1.2 ? 'stand' : 'sit';
        if (dogPet <= 0) {
          dogState = dogPrev === 'home' || dogPrev === 'visit' || dogPrev === 'greet' ? 'follow' : dogPrev;
          if (dogState === 'follow') { dogFollow = Math.max(dogFollow, 40); dogGreetCool = 60; }
        }
        break;
      }
    }
  }
  function petDog() {
    if (dogState !== 'petted') dogPrev = dogState;
    dogState = 'petted'; dogPet = 2.4;
    const hx = dogM.x + Math.sin(dogM.yaw) * 0.35, hz = dogM.z + Math.cos(dogM.yaw) * 0.35;
    fx.heartsAt(hx, dogM.y + 0.95, hz, 4, rng);
    const a = audioOf(ctx);
    a?.play('pet', { pos: dogBody.root.position });
    setTimeout(() => critterBark(), 380);
    critterSound(ctx, 'wag', dogM.x, dogM.y + 0.6, dogM.z, 10, 0.8);
    ctx.ui.say(DOG_SAY[Math.floor(rng() * DOG_SAY.length)], 2200);
  }

  // ------------------------------------------------------------------ Mochi
  let catState: CatState = 'nap', catT = 30 + rng() * 40, catSpot = 0, catPet = 0, catPrev: CatState = 'nap', catMeowCool = 10, catVisitT = 90 + rng() * 90;
  let catPose: PetPose = 'loaf', catWag = 0;
  const catVisit = { x: 0, z: 0, id: '' };
  let catTarget = { x: catSpots[0].x, z: catSpots[0].z };
  const catNapSpot = (act: Activity) => act.sleep && !act.shelter ? catNight : catSpots[act.shelter ? 0 : catSpot];

  function catBrain(dt: number, act: Activity) {
    catT -= dt; catMeowCool -= dt; catVisitT -= dt;
    const pd = Math.hypot(player.x - catM.x, player.z - catM.z);
    switch (catState) {
      case 'nap': {
        const spot = catNapSpot(act);
        const d = goTo(catM, spot.x, spot.z, act.shelter ? 3 : 1.0, dt);
        catPose = d > 0.3 ? 'walk' : act.sleep || catT > 20 ? 'curl' : 'loaf';
        catWag = 0;
        if (d < 0.3 && pd < 3.5 && !act.sleep && catMeowCool <= 0) { catState = 'watch'; catT = 4; catMeowCool = 25; ctxMeow(); break; }
        if (catT <= 0 && !act.shelter && !act.sleep) { catState = 'stretch'; catT = 2.6; }
        break;
      }
      case 'watch': {
        catM.v = damp(catM.v, 0, 8, dt);
        catPose = 'sit'; catWag = 0.4;
        if (catT <= 0) { catState = 'nap'; catT = 20 + rng() * 30; }
        break;
      }
      case 'stretch':
        catM.v = 0; catPose = 'stretch';
        if (catT <= 0) {
          if (catVisitT <= 0 && farmerSpot(catVisit)) { catVisitT = 120 + rng() * 120; catState = 'visit'; catT = 50; }
          else { catState = 'stroll'; catSpot = (catSpot + 1 + Math.floor(rng() * (catSpots.length - 1))) % catSpots.length; catTarget = catSpots[catSpot]; catT = 60; }
        }
        break;
      case 'stroll': {
        const d = goTo(catM, catTarget.x, catTarget.z, 1.0, dt);
        catPose = 'walk'; catWag = 0.2;
        if (d < 0.3 || catT <= 0 || catM.stuck > 3) { catM.stuck = 0; catState = 'groom'; catT = 4 + rng() * 4; }
        break;
      }
      case 'groom':
        catM.v = damp(catM.v, 0, 8, dt); catPose = 'sit';
        if (catT <= 0) { catState = 'nap'; catT = 45 + rng() * 80; }
        break;
      case 'visit': {
        const d = goTo(catM, catVisit.x, catVisit.z, 1.1, dt);
        catPose = d > 0.3 ? 'walk' : 'loaf';
        if (catT <= 0 || catM.stuck > 3) { catM.stuck = 0; catState = 'stroll'; catTarget = catSpots[catSpot]; catT = 60; }
        break;
      }
      case 'petted':
        catPet -= dt; catWag = 0.9;
        catM.v = 0;
        catPose = catPrev === 'nap' ? 'loaf' : 'sit';
        if (catPet <= 0) { catState = catPrev === 'petted' ? 'nap' : catPrev; if (catState === 'watch') catState = 'nap'; catT = Math.max(catT, 20); }
        break;
    }
  }
  const ctxMeow = () => { const a = audioOf(ctx); if (a) a.play('meow', { pos: catBody.root.position, pitch: 1 + rng() * 0.15 }); };
  function petCat() {
    if (catState !== 'petted') catPrev = catState;
    catState = 'petted'; catPet = 3.2;
    fx.heartsAt(catM.x + Math.sin(catM.yaw) * 0.22, catM.y + 0.55, catM.z + Math.cos(catM.yaw) * 0.22, 3, rng);
    const a = audioOf(ctx);
    a?.play('pet', { pos: catBody.root.position, volume: 0.7 });
    a?.play('purr', { pos: catBody.root.position });
    ctx.ui.say(CAT_SAY[Math.floor(rng() * CAT_SAY.length)], 2200);
  }

  // ------------------------------------------------------------------ interactables
  const headPos = (m: Mover, fwd: number, up: number, out: THREE.Vector3) => out.set(m.x + Math.sin(m.yaw) * fwd, m.y + up, m.z + Math.cos(m.yaw) * fwd);
  const offDog = ctx.interact.add({ id: 'life:dog', kind: 'animal', verb: 'Pet', label: () => 'Biscuit', pos: (o) => headPos(dogM, 0.2, 0.6, o), reach: 3.4, use: petDog });
  const offCat = ctx.interact.add({ id: 'life:cat', kind: 'animal', verb: 'Pet', label: () => 'Mochi', pos: (o) => headPos(catM, 0.1, 0.35, o), reach: 3.2, use: petCat });

  function place(b: PetBody, m: Mover, dt: number, t: number, pose: PetPose, wag: number, bounce: number, sniff: boolean, headY: number) {
    m.y = groundY(ctx, m.x, m.z);
    b.root.position.set(m.x, m.y, m.z);
    b.root.rotation.y = m.yaw;
    const pd = Math.hypot(player.x - m.x, player.z - m.z);
    const asleep = pose === 'curl';
    if (pd < 7 && !asleep) lookAt(m, ctx.player.eye.x, ctx.player.eye.y, ctx.player.eye.z, look, headY);
    else { look.yaw = 0; look.pitch = 0; }
    b.animate(dt, t, { pose, speed: m.v, wag, lookYaw: look.yaw, lookPitch: look.pitch, bounce, sniff });
    fx.shadow(m.x, m.y, m.z, b.kind === 'dog' ? 0.38 : 0.24, 1.6, m.yaw);
  }

  return {
    meshes: [dogBody.root, catBody.root],
    update(f, act) {
      const dt = f.dt;
      dogBrain(dt, act);
      catBrain(dt, act);
      place(dogBody, dogM, dt, f.time, dogPose, dogWag, dogBounce, dogSniff, 0.7);
      place(catBody, catM, dt, f.time, catPose, catWag, 0, false, 0.4);
    },
    stats: () => ({ dog: dogState, cat: catState }),
    dispose() {
      offDog(); offCat();
      ctx.scene.remove(dogBody.root, catBody.root);
      dogBody.dispose(); catBody.dispose();
    },
  };
}
