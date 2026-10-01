/**
 * The village pets (bodies: petBody.ts).
 *  - Biscuit (dog): pads round the square sniffing in bursts, sits and lies about; gallops to greet you, play-bows
 *    and runs circles round you, then heels at your side; when you stop he comes round, sits and looks up, tilting
 *    his head when you look at him. Visits idle farmers. Sleeps curled on the porch at night, shelters from storms
 *    and shakes himself off after. Pet him: eyes close happy, ears back, leans in, tail blur, hearts, a bark; pet
 *    him three times quickly and he rolls over for belly rubs.
 *  - Mochi (cat): naps (curled, or loafed) in warm spots, stretches front then back when she wakes, grooms, strolls,
 *    kneads before settling on the porch, walks the back fence of a field (hopping the posts), trots over tail-up to
 *    greet you and winds round your legs. Look at her and she slow-blinks. Pet her: purr, head bumps, hearts.
 * Each pet is one skinned mesh (one draw call; real shadow) plus a soft contact blob.
 */
import * as THREE from 'three';
import type { FarmerLocator, FrameInfo, SceneCtx } from '../context.ts';
import { SITES, WORLD, heightAt, siteToWorld, slopeAt, structure } from '../../world/map.ts';
import { seeded } from '../../../core/rng.ts';
import { PetBody, petInput } from './petBody.ts';
import type { PetInput, PetPose } from './petBody.ts';
import { Affection, LookTilt } from './mood.ts';
import type { Activity } from './schedule.ts';
import { TAU, audioOf, clamp, critterSound, damp, dampAngle, groundY, openGround, smooth01, wrap } from './util.ts';
import type { Fx, Rng } from './util.ts';

type DogState = 'wander' | 'greet' | 'play' | 'heel' | 'visit' | 'shelter' | 'sleep' | 'petted' | 'belly' | 'shake';
type CatState = 'nap' | 'watch' | 'stretch' | 'stroll' | 'groom' | 'greet' | 'wind' | 'knead' | 'fence' | 'visit' | 'petted';

interface Mover {
  x: number; z: number; y: number; yaw: number;
  /** commanded speed */
  v: number;
  stuck: number; r: number; wp: number;
  /** measured ground speed along the facing and yaw rate (what the legs animate) */
  gs: number; turn: number;
  px: number; pz: number; pyaw: number;
  /** extra height (jumps, fence rail) */
  lift: number;
  /** how close to the player's feet it may come */
  personal: number;
}

export interface Pets {
  meshes: THREE.Object3D[];
  update(f: FrameInfo, act: Activity): void;
  stats(): Record<string, number | string>;
  dispose(): void;
}

const DOG_SAY = ['Biscuit wiggles all over!', 'Good boy, Biscuit!', 'Biscuit gives you a happy lick.', 'Biscuit\'s tail is a blur.', 'Biscuit leans into your hand.'];
const DOG_BELLY = ['Biscuit flops over for belly rubs!', 'Belly rubs! Biscuit\'s back leg kicks.'];
const CAT_SAY = ['Mochi purrs contentedly.', 'Mochi headbutts your hand.', 'Mochi slow-blinks at you.', 'Mochi kneads the air, very pleased.', 'Mochi tolerates this. Graciously.'];

const mover = (x: number, z: number, yaw: number, r: number): Mover => ({ x, z, y: 0, yaw, v: 0, stuck: 0, r, wp: 0, gs: 0, turn: 0, px: x, pz: z, pyaw: yaw, lift: 0, personal: 0.6 });

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
  const lp = { x: 0, z: 0 };
  const onPorch = (x: number, z: number) => {
    const dx = x - fh.x, dz = z - fh.z, c = Math.cos(fh.yaw), sn = Math.sin(fh.yaw);
    lp.x = dx * c - dz * sn; lp.z = dx * sn + dz * c;
    return Math.abs(lp.x) <= 4.8 && lp.z >= 1.8 && lp.z <= 4.5;
  };
  const stepsOut = L(0, 6.3), stepsIn = L(0, 3.7);
  const home = { x: 3, z: -4 };
  const dogBed = L(3.7, 2.9);
  const catSpots = [L(-4.0, 2.7), { x: board.x + 1.6, z: board.z + 1.8 }, front(1.0, 1.4), { x: 9.5, z: 7 }];
  const catNight = { x: fire.x + 2.4, z: fire.z - 2.3 };
  const W = WORLD.water;

  const dogBody = new PetBody('dog'), catBody = new PetBody('cat');
  ctx.scene.add(dogBody.root, catBody.root);
  const dogM = mover(home.x, home.z, 0, 0.35), catM = mover(catSpots[0].x, catSpots[0].z, fh.yaw + 0.9, 0.22);
  const di: PetInput = petInput('stand'), ci: PetInput = petInput('loaf');
  const dogAff = new Affection(9, 3, 0.35), catAff = new Affection(30, 99, 0.2);
  const dogTilt = new LookTilt();
  const tmp = { x: 0, z: 0 };
  let now = 0;

  function step(m: Mover, tx: number, tz: number, speed: number, dt: number, turnRate = 7): number {
    const dx = tx - m.x, dz = tz - m.z, d = Math.hypot(dx, dz);
    if (d < 0.06) { m.v = damp(m.v, 0, 10, dt); return d; }
    const want = Math.atan2(dx, dz);
    m.yaw = dampAngle(m.yaw, want, turnRate, dt);
    const face = Math.max(0.1, Math.cos(wrap(want - m.yaw)));
    // ease into the stop (arrive), accelerate like a body with weight
    m.v = damp(m.v, Math.min(speed, d * 2.2) * face, speed > 3 ? 3 : 4.5, dt);
    const nx = m.x + Math.sin(m.yaw) * m.v * dt, nz = m.z + Math.cos(m.yaw) * m.v * dt;
    if (heightAt(nx, nz) < W + 0.12 || slopeAt(nx, nz) > 0.45) { m.v = 0; m.stuck += dt; return d; }
    const px = m.x, pz = m.z;
    tmp.x = nx; tmp.z = nz;
    ctx.colliders.resolve(tmp, m.r);
    // keep a polite distance from the player's feet
    const ex = tmp.x - player.x, ez = tmp.z - player.z, ed = Math.hypot(ex, ez), min = m.r + m.personal;
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
  const halt = (m: Mover, dt: number) => { m.v = damp(m.v, 0, 8, dt); };
  const face = (m: Mover, x: number, z: number, dt: number, rate = 5) => { m.yaw = dampAngle(m.yaw, Math.atan2(x - m.x, z - m.z), rate, dt); };
  const pdist = (m: Mover) => Math.hypot(player.x - m.x, player.z - m.z);
  /** is the player looking (roughly) straight at this pet */
  const lookedAt = (m: Mover, h: number, maxD: number): boolean => {
    const e = ctx.player.eye, dx = m.x - e.x, dz = m.z - e.z, dy = m.y + h - e.y, d = Math.hypot(dx, dz);
    if (d > maxD || d < 0.3) return false;
    const fx = -Math.sin(ctx.player.yaw) * Math.cos(ctx.player.pitch), fz = -Math.cos(ctx.player.yaw) * Math.cos(ctx.player.pitch), fy = Math.sin(ctx.player.pitch);
    const dot = (fx * dx + fy * dy + fz * dz) / Math.hypot(dx, dy, dz);
    return dot > Math.cos(0.2 + 0.25 / d);
  };
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
    const a = rng() * TAU;
    out.x = p.x + Math.cos(a) * 1.2; out.z = p.z + Math.sin(a) * 1.2; out.id = pick;
    return openGround(ctx, out.x, out.z, 0.3);
  };
  const audio = () => audioOf(ctx);

  // ------------------------------------------------------------------ Biscuit
  let dogState: DogState = 'wander', dogPrev: DogState = 'wander';
  let dogT = 0, dogAct: PetPose | 'sniff' | 'walk' = 'stand', dogActT = 0, dogSniffWalk = false;
  let greetCool = 4, heelT = 0, still = 0, barkIn = 0, visitIn = 60 + rng() * 60, sniffIn = 3, pant = 0, circleA = 0, circleN = 0, wet = 0, shakeNext: DogState = 'wander';
  const dogTarget = { x: home.x, z: home.z };
  const dogVisit = { x: 0, z: 0, id: '' };
  const pickHomeSpot = () => {
    for (let i = 0; i < 12; i++) {
      const x = home.x + (rng() - 0.5) * 18, z = home.z + (rng() - 0.5) * 14;
      if (openGround(ctx, x, z, 0.5)) { dogTarget.x = x; dogTarget.z = z; return; }
    }
    dogTarget.x = home.x; dogTarget.z = home.z;
  };
  let barkQ = 0, barkGap = 0;
  const bark = (n = 1) => { barkQ = Math.max(barkQ, n); };
  function barkTick(dt: number) {
    barkGap -= dt;
    if (barkQ > 0 && barkGap <= 0) {
      barkQ--; barkGap = 0.26 + rng() * 0.08;
      if (pdist(dogM) < 45) audio()?.play('bark', { pos: dogBody.root.position, pitch: 0.95 + rng() * 0.15 });
    }
  }
  const setDog = (s: DogState, t = 0) => { dogState = s; dogT = t; };

  function dogBrain(dt: number, act: Activity) {
    dogT -= dt; greetCool -= dt; visitIn -= dt; dogActT -= dt; sniffIn -= dt;
    dogAff.update(dt);
    const pd = pdist(dogM);
    const moving = ctx.player.speed > 0.5;
    still = moving ? 0 : still + dt;
    wet = act.shelter || ctx.lighting.wet > 0.35 ? Math.min(1, wet + dt * 0.05) : wet;
    // defaults for this frame
    di.pose = 'stand'; di.sniff = 0; di.ears = 0; di.happy = 0; di.lean = 0; di.bump = 0; di.tilt = 0; di.narrow = 0;
    let speed = 0;
    const rest = act.sleep ? 'sleep' : act.shelter ? 'shelter' : null;
    if (rest && dogState !== rest && dogState !== 'petted' && dogState !== 'belly' && dogState !== 'heel' && dogState !== 'shake') setDog(rest);
    if (!rest && (dogState === 'sleep' || dogState === 'shelter')) {
      if (wet > 0.3) { setDog('shake', 1.4); shakeNext = 'wander'; } else setDog('wander');
    }
    switch (dogState) {
      case 'wander': {
        if (pd < 16 && pd > 3 && greetCool <= 0 && !ctx.player.frozen) {
          setDog('greet'); bark(2); dogAff.cheer(0.4); critterSound(ctx, 'wag', dogM.x, dogM.y + 0.6, dogM.z, 30, 0.7);
          break;
        }
        if (visitIn <= 0 && pd > 25) { visitIn = 80 + rng() * 80; if (farmerSpot(dogVisit)) { setDog('visit', 60); break; } }
        if (dogAct === 'walk') {
          const d = goTo(dogM, dogTarget.x, dogTarget.z, dogSniffWalk ? 0.55 : 1.05, dt);
          speed = dogM.v;
          if (dogSniffWalk && sniffIn <= 0) { sniffIn = 2 + rng() * 2; critterSound(ctx, 'sniff', dogM.x, dogM.y + 0.4, dogM.z, 10, 0.6); }
          di.sniff = dogSniffWalk ? 1 : 0;
          if (d < 0.3 || dogM.stuck > 1.5) {
            dogM.stuck = 0;
            const r = rng();
            dogAct = r < 0.28 ? 'sit' : r < 0.42 ? 'lie' : r < 0.62 ? 'sniff' : r < 0.7 && wet > 0.3 ? 'shake' : 'stand';
            dogActT = dogAct === 'lie' ? 9 + rng() * 10 : dogAct === 'sniff' ? 2.5 + rng() * 2 : 3 + rng() * 6;
            if (dogAct === 'shake') { setDog('shake', 1.4); shakeNext = 'wander'; dogAct = 'stand'; }
          }
        } else {
          halt(dogM, dt);
          if (dogAct === 'sniff') { di.sniff = 1; if (sniffIn <= 0) { sniffIn = 1.3; critterSound(ctx, 'sniff', dogM.x, dogM.y + 0.3, dogM.z, 10, 0.6); } }
          else if (dogAct !== 'stand') di.pose = dogAct;
          if (dogActT <= 0) { dogAct = 'walk'; pickHomeSpot(); dogSniffWalk = rng() < 0.4; }
        }
        di.joy = dogAff.joy;
        break;
      }
      case 'greet': {
        // gallop in, slow to a trot, arrive with a skid of joy
        const d = goTo(dogM, player.x, player.z, clamp((pd - 1.1) * 1.6, 1.2, 6.4), dt);
        speed = dogM.v; pant = Math.min(1, pant + dt * 0.3);
        di.joy = 1; di.ears = speed > 4 ? -0.4 : 0.6;
        if (d < 1.9 || pd < 1.9) { if (rng() < 0.55) { setDog('play', 1.3); bark(1); circleN = 0; } else { setDog('heel', 0); heelT = 50 + rng() * 40; } }
        if (pd > 40 || dogM.stuck > 3) { setDog('wander'); greetCool = 30; dogM.stuck = 0; }
        break;
      }
      case 'play': {
        // a play-bow, then zoomies round you
        di.joy = 1;
        if (dogT > 0) {
          halt(dogM, dt); face(dogM, player.x, player.z, dt, 8);
          di.pose = 'bow'; di.ears = 1; di.lookPitch = -0.1;
          circleA = Math.atan2(dogM.x - player.x, dogM.z - player.z);
        } else {
          const r = 2.3;
          circleA += dt * 4.4 / r;
          circleN += dt * 4.4 / (TAU * r);
          const tx = player.x + Math.sin(circleA + 0.5) * r, tz = player.z + Math.cos(circleA + 0.5) * r;
          goTo(dogM, tx, tz, 4.6, dt);
          speed = dogM.v; pant = Math.min(1, pant + dt * 0.3); di.ears = -0.3;
          if (circleN > 1.6 || dogM.stuck > 2) { setDog('heel'); heelT = 50 + rng() * 40; bark(1); }
        }
        break;
      }
      case 'heel': {
        heelT -= dt;
        // walk at your left side; when you stop, come round in front, sit and look up at you
        const sy = Math.sin(ctx.player.yaw), cy = Math.cos(ctx.player.yaw);
        const inFront = still > 0.8;
        const fwd = inFront ? 1.5 : -0.15, side = inFront ? 0.1 : 0.95;
        // player forward = (−sin yaw, −cos yaw); left = (−cos yaw, sin yaw)
        const tx = player.x - sy * fwd - cy * side, tz = player.z - cy * fwd + sy * side;
        const d = Math.hypot(tx - dogM.x, tz - dogM.z);
        if (d > 0.35 || moving) {
          goTo(dogM, tx, tz, clamp(ctx.player.speed * 1.05 + d * 2.2, 0.6, 7.5), dt);
          speed = dogM.v;
        } else {
          halt(dogM, dt); face(dogM, player.x, player.z, dt, 4);
          di.pose = still > 14 ? 'lie' : still > 1.6 ? 'sit' : 'stand';
          di.tilt = dogTilt.update(dt, lookedAt(dogM, 0.7, 6));
          if (di.tilt !== 0) di.ears = 1;
        }
        di.joy = Math.max(0.55, dogAff.joy);
        barkIn -= dt;
        if (still > 3 && barkIn <= 0 && pd < 6) { barkIn = 25 + rng() * 30; if (rng() < 0.4) bark(1); else critterSound(ctx, 'wag', dogM.x, dogM.y + 0.6, dogM.z, 15, 0.6); }
        if (heelT <= 0 || pd > 35 || rest) { setDog(rest ?? 'wander'); greetCool = 120 + rng() * 60; dogAct = 'walk'; pickHomeSpot(); }
        break;
      }
      case 'visit': {
        const d = goTo(dogM, dogVisit.x, dogVisit.z, 1.6, dt);
        speed = dogM.v;
        if (d < 0.3) {
          di.pose = 'sit'; dogT = Math.min(dogT, 30);
          const p = (ctx.services.get('farmers') as FarmerLocator | undefined)?.position(dogVisit.id);
          if (p) face(dogM, p.x, p.z, dt, 3);
        }
        di.joy = 0.55;
        if (dogT <= 0 || dogM.stuck > 3) { setDog('wander'); dogM.stuck = 0; dogAct = 'walk'; pickHomeSpot(); }
        if (pd < 12 && greetCool <= 0) { setDog('greet'); bark(2); }
        break;
      }
      case 'sleep':
      case 'shelter': {
        const d = goTo(dogM, dogBed.x, dogBed.z, dogState === 'shelter' ? 2.8 : 1.1, dt);
        speed = dogM.v;
        if (d < 0.35) { di.pose = dogState === 'sleep' ? 'curl' : 'lie'; dogM.yaw = dampAngle(dogM.yaw, fh.yaw + 0.6, 2, dt); }
        di.joy = pd < 3 ? 0.3 : 0.05;
        break;
      }
      case 'shake': {
        halt(dogM, dt); di.pose = 'shake';
        if (dogT > 1.3 && dogT - dt <= 1.3) {
          critterSound(ctx, 'shake', dogM.x, dogM.y + 0.4, dogM.z, 20, 0.9);
          fx.drops(dogM.x, dogM.y + 0.45, dogM.z, 16, 1.6, 0.35);
        }
        if (dogT <= 0) { wet = 0; setDog(shakeNext); dogAct = 'stand'; dogActT = 1; }
        break;
      }
      case 'petted': {
        halt(dogM, dt); face(dogM, player.x, player.z, dt, 5);
        const asleep = dogPrev === 'sleep' || dogPrev === 'shelter';
        di.pose = asleep ? 'lie' : dogT > 1.6 ? 'stand' : 'sit';
        di.happy = 1; di.ears = -1; di.joy = 1; di.lean = Math.sin(now * 1.3) * 0.25 + 0.55; di.lookPitch = -0.35;
        if (dogT <= 0) {
          setDog(dogPrev === 'wander' || dogPrev === 'visit' || dogPrev === 'greet' || dogPrev === 'play' ? 'heel' : dogPrev);
          if ((dogState as DogState) === 'heel') { heelT = Math.max(heelT, 40); greetCool = 60; }
        }
        break;
      }
      case 'belly': {
        halt(dogM, dt);
        di.pose = 'belly'; di.joy = 1; di.happy = 1;
        if (Math.floor(dogT * 1.1) !== Math.floor((dogT + dt) * 1.1)) fx.heartsAt(dogM.x, dogM.y + 0.45, dogM.z, 1, rng);
        if (dogT <= 0) { setDog('shake', 1.4); shakeNext = dogPrev === 'sleep' || dogPrev === 'shelter' ? dogPrev : 'heel'; heelT = Math.max(heelT, 40); greetCool = 60; }
        break;
      }
    }
    pant = Math.max(0, pant - dt * (speed > 3 ? -0.2 : 0.06));
    di.pant = smooth01(pant * 1.4);
    if (di.pose === 'curl') di.pant = 0;
    return speed;
  }
  function petDog() {
    if (dogState !== 'petted' && dogState !== 'belly') dogPrev = dogState === 'shake' ? 'wander' : dogState;
    const r = dogAff.pet(now);
    const hx = dogM.x + Math.sin(dogM.yaw) * 0.35, hz = dogM.z + Math.cos(dogM.yaw) * 0.35;
    if (r === 'rollover' && dogPrev !== 'sleep') {
      setDog('belly', 4.5);
      fx.heartsAt(dogM.x, dogM.y + 0.6, dogM.z, 6, rng);
      ctx.ui.say(DOG_BELLY[Math.floor(rng() * DOG_BELLY.length)], 2400);
    } else {
      setDog('petted', 2.4);
      fx.heartsAt(hx, dogM.y + 0.95, hz, 4, rng);
      ctx.ui.say(DOG_SAY[Math.floor(rng() * DOG_SAY.length)], 2200);
    }
    audio()?.play('pet', { pos: dogBody.root.position });
    barkGap = 0.35; bark(1);
    critterSound(ctx, 'wag', dogM.x, dogM.y + 0.6, dogM.z, 10, 0.8);
  }

  // ------------------------------------------------------------------ Mochi
  let catState: CatState = 'nap', catT = 30 + rng() * 40, catSpot = 0, catPrev: CatState = 'nap', meowCool = 10, catVisitIn = 90 + rng() * 90, catGreetCool = 20, fenceIn = 40 + rng() * 60;
  let catNapPose: PetPose = 'loaf', purrIn = 0, windA = 0, windDir = 1, bumpT = 0;
  const catVisit = { x: 0, z: 0, id: '' };
  const catTarget = { x: catSpots[0].x, z: catSpots[0].z };
  const napSpot = (act: Activity) => (act.sleep && !act.shelter ? catNight : catSpots[act.shelter ? 0 : catSpot]);
  const setCat = (s: CatState, t: number) => { catState = s; catT = t; };
  const meow = () => audio()?.play('meow', { pos: catBody.root.position, pitch: 1 + rng() * 0.15 });
  // fence walk: the back rail of a fenced field
  const fence = { site: -1, y: 0, a: 0, b: 0, lz: 0, phase: 0 as 0 | 1 | 2 | 3, t: 0, fx: 0, fz: 0, fy: 0, tx: 0, tz: 0, ty: 0 };
  function pickFence(): boolean {
    const svc = ctx.services.get('plots') as { field(id: string): { site: { index: number }; built: number } | null } | undefined;
    let best = -1, bd = 45;
    for (const p of ctx.valley.plots.values()) {
      if (p.stage !== 'thriving' && p.stage !== 'growing' && p.stage !== 'resting') continue;
      const f = svc?.field(p.id);
      if (svc && (!f || f.built < 0.95)) continue;
      const st = SITES[p.site];
      const d = Math.hypot(st.x - catM.x, st.z - catM.z);
      if (d < bd) { bd = d; best = p.site; }
    }
    if (best < 0) return false;
    const st = SITES[best];
    const hw = st.w / 2;
    const k = Math.floor(rng() * (Math.round(st.w / 2) - 2));
    const post = -hw + 2 * (k + 1);
    fence.site = best; fence.y = st.y + 0.92; fence.lz = -st.d / 2 + 0.05;
    const dir = rng() < 0.5 ? 1 : -1;
    fence.a = post - dir * 0.7; fence.b = post + dir * (2 + 0.7);
    fence.phase = 0; fence.t = 0;
    return true;
  }
  function fenceWalk(dt: number): boolean {
    const st = SITES[fence.site];
    const out = siteToWorld(st, fence.a, fence.lz - 0.75);
    catM.personal = 0.6;
    ci.narrow = 0;
    if (fence.phase === 0) {
      const d = goTo(catM, out.x, out.z, 1.0, dt);
      if (d < 0.25 || catM.stuck > 3) {
        if (catM.stuck > 3) return false;
        fence.phase = 1; fence.t = 0; fence.fx = catM.x; fence.fz = catM.z; fence.fy = 0;
        const on = siteToWorld(st, fence.a, fence.lz);
        fence.tx = on.x; fence.tz = on.z;
      }
      return true;
    }
    const railDir = Math.atan2(Math.cos(st.yaw) * Math.sign(fence.b - fence.a), -Math.sin(st.yaw) * Math.sign(fence.b - fence.a));
    if (fence.phase === 1 || fence.phase === 3) {
      // crouch, spring, land (a 0.55 s arc)
      fence.t += dt;
      const k = fence.t / 0.75;
      const crouch = k < 0.25;
      const u = smooth01((k - 0.25) / 0.6);
      catM.v = 0; catM.gs = 0;
      const gy = groundY(ctx, catM.x, catM.z);
      if (fence.phase === 1) {
        if (!crouch) { catM.x = fence.fx + (fence.tx - fence.fx) * u; catM.z = fence.fz + (fence.tz - fence.fz) * u; }
        catM.lift = crouch ? 0 : (fence.y - gy) * u + Math.sin(u * Math.PI) * 0.25;
        catM.yaw = dampAngle(catM.yaw, crouch ? Math.atan2(fence.tx - catM.x, fence.tz - catM.z) : railDir, crouch ? 10 : 4, dt);
      } else {
        if (!crouch) { catM.x = fence.fx + (fence.tx - fence.fx) * u; catM.z = fence.fz + (fence.tz - fence.fz) * u; }
        catM.lift = crouch ? fence.y - gy : (fence.y - gy) * (1 - u) + Math.sin(u * Math.PI) * 0.18;
      }
      ci.pose = crouch ? 'sit' : 'stand';
      ci.narrow = fence.phase === 1 ? smooth01(u) : 1 - smooth01(u);
      if (k >= 1) {
        if (fence.phase === 1) { fence.phase = 2; catBody.snap(); }
        else { catM.lift = 0; return false; }
      }
      return true;
    }
    // on the rail: careful little steps, balance, hop the post
    const cur = localX(st, catM.x, catM.z);
    const dir = Math.sign(fence.b - fence.a);
    const next = cur + dir * 0.45 * dt;
    const w = siteToWorld(st, next, fence.lz);
    catM.x = w.x; catM.z = w.z; catM.v = 0.45;
    catM.yaw = dampAngle(catM.yaw, railDir, 6, dt);
    const post = Math.round((next + st.w / 2) / 2) * 2 - st.w / 2;
    const dp = Math.abs(next - post);
    catM.lift = fence.y - groundY(ctx, catM.x, catM.z) + (dp < 0.22 ? Math.cos((dp / 0.22) * Math.PI / 2) * 0.24 : 0);
    ci.narrow = 1; ci.joy = 0.25;
    if ((next - fence.b) * dir >= 0) {
      fence.phase = 3; fence.t = 0; fence.fx = catM.x; fence.fz = catM.z;
      const down = siteToWorld(st, fence.b + dir * 0.2, fence.lz - 0.8);
      fence.tx = down.x; fence.tz = down.z;
    }
    return true;
  }
  const localX = (st: (typeof SITES)[number], x: number, z: number) => { const dx = x - st.x, dz = z - st.z; return dx * Math.cos(st.yaw) - dz * Math.sin(st.yaw); };

  function catBrain(dt: number, act: Activity) {
    catT -= dt; meowCool -= dt; catVisitIn -= dt; catGreetCool -= dt; fenceIn -= dt; purrIn -= dt;
    catAff.update(dt);
    const pd = pdist(catM);
    ci.pose = 'stand'; ci.happy = 0; ci.ears = 0; ci.lean = 0; ci.bump = 0; ci.tilt = 0; ci.narrow = 0; ci.slowBlink = false; ci.sniff = 0; ci.pant = 0;
    ci.joy = catAff.joy;
    catM.personal = 0.6;
    let speed = 0;
    const awake = catState !== 'nap' && catState !== 'fence' && catState !== 'petted' && catState !== 'knead';
    if (act.shelter && catState !== 'nap' && catState !== 'petted') { if (catState === 'fence') catM.lift = 0; setCat('nap', 40); catNapPose = 'loaf'; }
    if (awake && catGreetCool <= 0 && pd < 8 && pd > 2 && !act.sleep && !ctx.player.frozen && catState !== 'greet' && catState !== 'wind') {
      catGreetCool = 90 + rng() * 60;
      if (rng() < 0.55) { setCat('greet', 12); meow(); }
    }
    switch (catState) {
      case 'nap': {
        const spot = napSpot(act);
        const d = goTo(catM, spot.x, spot.z, act.shelter ? 2.2 : 0.8, dt);
        speed = catM.v;
        if (d > 0.3) break;
        ci.pose = act.sleep || catT > 25 ? 'curl' : catNapPose;
        if (ci.pose === 'loaf') { ci.slowBlink = lookedAt(catM, 0.3, 5) && Math.sin(now * 0.9) > 0.3; }
        if (pd < 3.5 && !act.sleep && ci.pose === 'loaf' && meowCool <= 0) { setCat('watch', 5); meowCool = 25; meow(); break; }
        if (catT <= 0 && !act.shelter && !act.sleep) setCat('stretch', 4.3);
        break;
      }
      case 'watch': {
        halt(catM, dt); face(catM, player.x, player.z, dt, 2);
        ci.pose = 'sit'; ci.joy = 0.4; ci.ears = 0.4;
        ci.slowBlink = lookedAt(catM, 0.3, 6) && (catT % 2.5) < 1.2;
        if (catT <= 0) setCat('nap', 20 + rng() * 30);
        break;
      }
      case 'stretch':
        halt(catM, dt); ci.pose = 'stretch';
        if (catT <= 0) {
          if (fenceIn <= 0 && pickFence()) { fenceIn = 120 + rng() * 120; setCat('fence', 60); }
          else if (catVisitIn <= 0 && farmerSpot(catVisit)) { catVisitIn = 120 + rng() * 120; setCat('visit', 50); }
          else { catSpot = (catSpot + 1 + Math.floor(rng() * (catSpots.length - 1))) % catSpots.length; catTarget.x = catSpots[catSpot].x; catTarget.z = catSpots[catSpot].z; setCat('stroll', 60); }
        }
        break;
      case 'stroll': {
        const d = goTo(catM, catTarget.x, catTarget.z, 0.75, dt);
        speed = catM.v; ci.joy = 0.3;
        if (d < 0.3 || catT <= 0 || catM.stuck > 3) { catM.stuck = 0; setCat('groom', 5 + rng() * 4); }
        break;
      }
      case 'groom':
        halt(catM, dt); ci.pose = 'groom';
        if (catT <= 0) {
          catNapPose = rng() < 0.6 ? 'loaf' : 'curl';
          if (catSpot === 0 && rng() < 0.6) setCat('knead', 3.5); else setCat('nap', 45 + rng() * 80);
        }
        break;
      case 'knead':
        halt(catM, dt); ci.pose = 'knead'; ci.joy = 0.7;
        if (purrIn <= 0) { purrIn = 3; audio()?.play('purr', { pos: catBody.root.position, volume: 0.5 }); }
        if (catT <= 0) setCat('nap', 45 + rng() * 80);
        break;
      case 'greet': {
        // tail-up trot over, then wind round your legs
        const d = goTo(catM, player.x, player.z, pd > 3 ? 1.6 : 1.0, dt);
        speed = catM.v; ci.joy = 1; ci.ears = 0.5;
        if (d < 1.0 || pd < 1.0) { setCat('wind', 6 + rng() * 3); windA = Math.atan2(catM.x - player.x, catM.z - player.z); windDir = rng() < 0.5 ? 1 : -1; }
        if (catT <= 0 || pd > 14 || catM.stuck > 3) { catM.stuck = 0; setCat('stroll', 30); catTarget.x = catSpots[catSpot].x; catTarget.z = catSpots[catSpot].z; }
        break;
      }
      case 'wind': {
        // figure-eight round the player's feet, leaning in, tail up, the odd head bump
        catM.personal = 0.05;
        windA += dt * 1.5 * windDir;
        const r = 0.5, a = windA;
        const tx = player.x + Math.sin(a) * r * 1.25, tz = player.z + Math.sin(a) * Math.cos(a) * r * 1.4;
        step(catM, tx, tz, 0.85, dt, 9);
        speed = catM.v; ci.joy = 1; ci.lean = 0.7 * Math.sign(Math.cos(a)) * windDir;
        bumpT -= dt;
        if (bumpT <= 0) { bumpT = 1.6 + rng() * 1.5; }
        ci.bump = bumpT > 1.2 ? Math.sin((bumpT - 1.2) / 0.4 * Math.PI) : 0;
        if (purrIn <= 0) { purrIn = 3; audio()?.play('purr', { pos: catBody.root.position, volume: 0.6 }); }
        if (catT <= 0 || ctx.player.speed > 2.5) setCat('watch', 5);
        break;
      }
      case 'fence':
        ci.pose = 'stand';
        if (!fenceWalk(dt) || catT <= 0) { catM.lift = 0; setCat('stroll', 40); catTarget.x = catSpots[catSpot].x; catTarget.z = catSpots[catSpot].z; }
        speed = catM.v;
        break;
      case 'visit': {
        const d = goTo(catM, catVisit.x, catVisit.z, 0.9, dt);
        speed = catM.v;
        if (d < 0.3) ci.pose = 'loaf';
        if (catT <= 0 || catM.stuck > 3) { catM.stuck = 0; setCat('stroll', 60); catTarget.x = catSpots[catSpot].x; catTarget.z = catSpots[catSpot].z; }
        break;
      }
      case 'petted': {
        halt(catM, dt);
        ci.pose = catPrev === 'nap' || catPrev === 'knead' ? 'loaf' : 'sit';
        ci.happy = catT > 2.4 ? 0.9 : 0.4; ci.joy = 0.9; ci.ears = -0.3;
        ci.bump = catT > 2.2 && catT < 3.0 ? Math.sin((3.0 - catT) / 0.8 * Math.PI) : 0;
        ci.slowBlink = catT < 1.6 && catT > 0.3;
        ci.lean = 0.5;
        face(catM, player.x, player.z, dt, 2);
        if (catT <= 0) { setCat(catPrev === 'petted' || catPrev === 'fence' ? 'nap' : catPrev, 20 + rng() * 20); if ((catState as CatState) === 'watch') setCat('nap', 30); }
        break;
      }
    }
    return speed;
  }
  function petCat() {
    if (catState === 'fence' && catM.lift > 0.2) return;
    if (catState !== 'petted') catPrev = catState;
    catAff.pet(now);
    setCat('petted', 3.4);
    fx.heartsAt(catM.x + Math.sin(catM.yaw) * 0.22, catM.y + catM.lift + 0.55, catM.z + Math.cos(catM.yaw) * 0.22, 3, rng);
    const a = audio();
    a?.play('pet', { pos: catBody.root.position, volume: 0.7 });
    a?.play('purr', { pos: catBody.root.position });
    purrIn = 3;
    ctx.ui.say(CAT_SAY[Math.floor(rng() * CAT_SAY.length)], 2200);
  }

  // ------------------------------------------------------------------ interactables
  const headPos = (m: Mover, fwd: number, up: number, out: THREE.Vector3) => out.set(m.x + Math.sin(m.yaw) * fwd, m.y + m.lift + up, m.z + Math.cos(m.yaw) * fwd);
  const offDog = ctx.interact.add({ id: 'life:dog', kind: 'animal', verb: 'Pet', label: () => 'Biscuit', pos: (o) => headPos(dogM, 0.2, dogBody.headHeight() * 0.8, o), reach: 3.4, use: petDog });
  const offCat = ctx.interact.add({ id: 'life:cat', kind: 'animal', verb: 'Pet', label: () => 'Mochi', pos: (o) => headPos(catM, 0.1, catBody.headHeight() * 0.8, o), reach: 3.2, use: petCat });

  const look = { yaw: 0, pitch: 0 };
  function place(b: PetBody, m: Mover, inp: PetInput, dt: number, t: number, headH: number, lookRange: number) {
    m.y = groundY(ctx, m.x, m.z);
    // measured motion drives the legs, so feet never slide even when a collider or the player blocks the way
    if (dt > 1e-4) {
      const dx = m.x - m.px, dz = m.z - m.pz;
      const gs = (dx * Math.sin(m.yaw) + dz * Math.cos(m.yaw)) / dt;
      m.gs = Math.abs(gs) > 12 ? m.gs : gs;
      m.turn = damp(m.turn, clamp(wrap(m.yaw - m.pyaw) / dt, -8, 8), 12, dt);
    }
    m.px = m.x; m.pz = m.z; m.pyaw = m.yaw;
    b.root.position.set(m.x, m.y + m.lift, m.z);
    b.root.rotation.y = m.yaw;
    const pd = pdist(m);
    const asleep = inp.pose === 'curl';
    if (pd < lookRange && !asleep && inp.pose !== 'belly' && inp.pose !== 'groom' && inp.pose !== 'shake') {
      const e = ctx.player.eye, dx = e.x - m.x, dz = e.z - m.z;
      look.yaw = wrap(Math.atan2(dx, dz) - m.yaw);
      look.pitch = clamp(-(e.y - (m.y + m.lift + headH)) / Math.max(0.8, Math.hypot(dx, dz)), -0.7, 0.5);
      if (Math.abs(look.yaw) > 1.7) { look.yaw = 0; look.pitch = 0; }
      if (inp.sniff > 0) { look.yaw *= 0.3; look.pitch = 0; }
    } else { look.yaw = 0; look.pitch = 0; }
    inp.lookYaw = damp(inp.lookYaw, look.yaw, 5, dt);
    inp.lookPitch = damp(inp.lookPitch, look.pitch + (inp.happy > 0.5 ? -0.3 : 0), 5, dt);
    inp.speed = m.gs; inp.turn = m.turn;
    b.animate(dt, t, inp);
    if (m.lift < 0.3) fx.shadow(m.x, m.y, m.z, b.kind === 'dog' ? 0.3 : 0.18, 1.7, m.yaw);
  }

  // dev hook (scripts / screenshots): __valley.ctx.services.get('lifeDebug').pets
  const debug = {
    state: () => ({ dog: dogState, dogPose: di.pose, cat: catState, catPose: ci.pose, dx: dogM.x, dz: dogM.z, cx: catM.x, cz: catM.z }),
    /** put a pet at (x, z) facing yaw, in a state (dog: wander heel sleep …; cat: nap watch groom …) for t seconds */
    dog(state: DogState, x?: number, z?: number, yaw?: number, t = 30) {
      if (x !== undefined && z !== undefined) { dogM.x = dogM.px = x; dogM.z = dogM.pz = z; dogBody.snap(); }
      if (yaw !== undefined) dogM.yaw = dogM.pyaw = yaw;
      dogPrev = 'wander'; setDog(state, t); heelT = t; greetCool = t;
      if (state === 'shake') shakeNext = 'wander';
    },
    cat(state: CatState, x?: number, z?: number, yaw?: number, t = 30) {
      if (x !== undefined && z !== undefined) { catM.x = catM.px = x; catM.z = catM.pz = z; catBody.snap(); }
      if (yaw !== undefined) catM.yaw = catM.pyaw = yaw;
      catPrev = 'nap'; setCat(state, t); catGreetCool = t;
      if (state === 'fence' && !pickFence()) setCat('stroll', 30);
      if (state === 'wind') { windA = 0; windDir = 1; }
    },
    petDog, petCat,
    fence: () => (fence.site < 0 ? null : { site: fence.site, ...siteToWorld(SITES[fence.site], (fence.a + fence.b) / 2, fence.lz), y: fence.y, yaw: SITES[fence.site].yaw, phase: fence.phase }),
  };
  const dbg = (ctx.services.get('lifeDebug') as Record<string, unknown> | undefined) ?? {};
  dbg.pets = debug;
  ctx.services.set('lifeDebug', dbg);

  return {
    meshes: [dogBody.root, catBody.root],
    update(f, act) {
      const dt = f.dt;
      now = f.time;
      dogBrain(dt, act);
      catBrain(dt, act);
      barkTick(dt);
      place(dogBody, dogM, di, dt, f.time, 0.7, 7);
      place(catBody, catM, ci, dt, f.time, 0.4, 5);
      fx.dogX = dogM.x; fx.dogZ = dogM.z; fx.dogSpeed = Math.abs(dogM.gs);
    },
    stats: () => ({ dog: dogState, cat: catState }),
    dispose() {
      offDog(); offCat();
      ctx.scene.remove(dogBody.root, catBody.root);
      dogBody.dispose(); catBody.dispose();
    },
  };
}
