/**
 * Your own pet (life package; the model is model/pet.ts, the adoption card hud/pet.ts, bodies companionModels.ts on
 * the village pets' rig, petBody.ts).
 *
 *  - **Adoption**: until you have one, a basket of foundlings sits by Fern's signpost (a sleeping puppy and kitten,
 *    a "free to good homes" slate). E opens the adoption card (`ui.pet`); Fern's hearts decide the price and whether
 *    the rare fox kit is on offer. The new pet hops out of the basket and runs to you.
 *  - **Following**: a comfortable spot a little behind and to one side (follow.ts `heelSpot`); it matches your pace,
 *    gallops after you when you sprint, and when the straight line is blocked (water, a building, a fence, a ledge)
 *    it works along your own trail of footsteps (`Crumbs`, `trailWaypoint`); round the farmhouse porch and into the
 *    yard it knows the steps and the gate. Lost (map travel, a swim) it catches up out of sight behind you.
 *  - **When you stop**: it comes round in front, sits and looks up (a head tilt / slow blink when you look at it), lies
 *    down after a while, and now and then wanders off a few metres to sniff about.
 *  - **Out and about**: it trots over to greet villagers (sits and looks up at them) and Biscuit / Mochi (nose to nose,
 *    they hold still for it); its nose finds today's forageables (the forage service's `near`): it runs over, points
 *    (a kitten sits and meows), barks, and is delighted when you pick it up.
 *  - **E: pet it** (hearts, happy eyes, a lean; three quick pats and a puppy rolls over). **F: Fetch!** you throw a
 *    stick along your view (never into water or through a wall); it races off, brings it back, drops it at your feet.
 *    A kitten sometimes pounces on it and sits on it instead.
 *  - **Night** (21:30–6): near home it goes to bed: the pet bed in your yard if you've placed one, else the porch by
 *    the door. It sleeps on until morning (F wakes it for the night). **Indoors** it curls up on the hearth rug.
 *
 * Happiness (pats, walks, fetch, finds) lives in the model, persisted per profile (`claude-valley.pet.v1`).
 * Budget: one skinned mesh (one draw call; real shadow), the stick (only while fetching / just dropped) and the
 * basket (only before adopting): ≤ 3 draw calls. Per frame: no allocation (scratch objects, closures made once).
 */
import * as THREE from 'three';
import type { FrameInfo, IndoorSpace, Interactable, PetsService, SceneCtx, VillagersService } from '../context.ts';
import { WORLD, YARD, heightAt, pathAt, slopeAt, structure } from '../../world/map.ts';
import { createPetModel, offerFor } from '../../model/pet.ts';
import type { AdoptResult, CompanionService, PetModelService, Species } from '../../model/pet.ts';
import type { WalletService } from '../../model/wallet.ts';
import type { FriendsService } from '../../model/friends.ts';
import { heartsOf, moodOf } from '../../model/pet.ts';
import type { ForageDebug } from '../forage/forage.ts';
import { FURN, ROOM } from '../interior/layout.ts';
import { SLOTS, WEST_GAP, inYard } from '../yard/layout.ts';
import { localJson } from '../../storage.ts';
import { PetBody, petInput } from './petBody.ts';
import type { PetInput, PetPose } from './petBody.ts';
import { Affection, LookTilt } from './mood.ts';
import { SPECIES_K, basketMesh, companionModel, familyOf, stickMesh } from './companionModels.ts';
import { Crumbs, followSpeed, heelSpot, trailWaypoint } from './follow.ts';
import { TAU, audioOf, clamp, critterSound, damp, dampAngle, groundY, smooth01, wrap } from './util.ts';
import type { Fx } from './util.ts';
import type { Activity } from './schedule.ts';

const STORE_KEY = 'claude-valley.pet.v1';
/** A spot your pet sits and rides along on (service 'petPerch', scene/seasons: the rowboat's bow); mutated in place. */
export interface PetPerch { active: boolean; x: number; y: number; z: number; yaw: number }

type State = 'off' | 'arrive' | 'follow' | 'rest' | 'sniff' | 'greet' | 'find' | 'fetch' | 'carry' | 'play' | 'petted' | 'belly' | 'home' | 'indoor';

export interface Companion {
  meshes: THREE.Object3D[];
  update(f: FrameInfo, act: Activity): void;
  stats(): Record<string, number | string>;
  dispose(): void;
}

const PET_LINES: Record<Species, readonly string[]> = {
  puppy: ['{n} wiggles all over!', 'Good pup, {n}!', '{n} licks your hand.', "{n}'s tail is a blur.", '{n} leans into your hand, eyes shut.'],
  kitten: ['{n} purrs like a tiny engine.', '{n} headbutts your hand.', '{n} slow-blinks at you.', '{n} kneads the air, very pleased.', '{n} allows this.'],
  fox: ['{n} chitters happily.', '{n} nuzzles your palm.', "{n}'s brush of a tail sweeps the grass.", '{n} grins a foxy grin.', '{n} presses close, ears flat.'],
};
const FETCH_LINES: Record<Species, readonly string[]> = {
  puppy: ['{n} drops the stick at your feet. Again! Again!', 'Fetched! {n} looks very proud.', '{n} brings it back, a little soggier.'],
  kitten: ['{n} brings it back! (Don\'t tell the other cats.)', '{n} drops the stick and looks away, unbothered.'],
  fox: ['{n} trots back with the stick held high.', '{n} drops the stick and does a little hop.'],
};
const say = (lines: readonly string[], name: string, r: number) => lines[Math.floor(r * lines.length) % lines.length].replace(/\{n\}/g, name);

export function createCompanion(ctx: SceneCtx, fx: Fx): Companion {
  // ------------------------------------------------------------------ model + service
  const model: PetModelService = createPetModel(localJson(STORE_KEY));
  const wallet = () => ctx.services.get('wallet') as WalletService | undefined;
  const friends = () => ctx.services.get('friends') as FriendsService | undefined;
  const indoors = () => ctx.services.get('indoors') as IndoorSpace | undefined;
  const forage = () => ctx.services.get('forage') as ForageDebug | undefined;
  const audio = () => audioOf(ctx);
  const fernHearts = () => { try { return friends()?.hearts('fern') ?? 0; } catch { return 0; } };
  let seed = 0x9e3779b9;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const player = ctx.player.pos;
  const W = WORLD.water;

  // ------------------------------------------------------------------ places
  const fh = structure('farmhouse');
  const sign = structure('signpost');
  const cosF = Math.cos(fh.yaw), sinF = Math.sin(fh.yaw);
  const L = (lx: number, lz: number, out = { x: 0, z: 0 }) => { out.x = fh.x + lx * cosF + lz * sinF; out.z = fh.z - lx * sinF + lz * cosF; return out; };
  const lp = { x: 0, z: 0 };
  const onPorch = (x: number, z: number) => {
    const dx = x - fh.x, dz = z - fh.z;
    lp.x = dx * cosF - dz * sinF; lp.z = dx * sinF + dz * cosF;
    return Math.abs(lp.x) <= 4.8 && lp.z >= 1.8 && lp.z <= 4.5;
  };
  const stepsOut = L(0.4, 6.3), stepsIn = L(0.4, 3.7);
  const porchBed = L(-2.0, 3.0);
  const porchYaw = fh.yaw + 0.5;
  // into the yard through the west gap (round the west side of the house: between it and the laundry line)
  const houseCorner = L(-7.55, 3.5), houseBack = { x: YARD.x0 - 1.5, z: WEST_GAP.z }, gapIn = { x: YARD.x0 + 1.1, z: WEST_GAP.z };
  // the hearth rug (farmhouse-local room frame), facing the room
  const rug = L(FURN.rug.x + 0.55, FURN.rug.z + 0.7);   // fireside of the armchair, in view of the room
  let rugYaw = Math.atan2(-0.6 * cosF + 0.8 * sinF, 0.6 * sinF + 0.8 * cosF), rugY = fh.y + ROOM.floor;
  /** the room you are in may name its own spot (the barn: the hay by the door); else the farmhouse hearth rug */
  const roomSpot = (): void => {
    const sp = indoors()?.petSpot?.();
    if (sp) { rug.x = sp.x; rug.z = sp.z; rugYaw = sp.yaw; rugY = sp.y; }
  };
  // the foundlings' basket: a clear patch of meadow beside the signpost
  const basketAt = { x: sign.x + 1.6, z: sign.z + 1.2, yaw: 0 };
  {
    let best = -1;
    for (let i = 0; i < 24 && best < 0; i++) {
      const a = (i / 24) * TAU + 0.6, r = 1.6 + (i % 3) * 0.6;
      const x = sign.x + Math.cos(a) * r, z = sign.z + Math.sin(a) * r;
      if (pathAt(x, z) > 0.15 || heightAt(x, z) < W + 0.3 || slopeAt(x, z) > 0.2 || ctx.colliders.blocked(x, z, 0.7)) continue;
      best = i; basketAt.x = x; basketAt.z = z; basketAt.yaw = Math.atan2(sign.x - x, sign.z - z) + 1.2;
    }
  }

  // ------------------------------------------------------------------ scene objects
  let basket: THREE.Mesh | null = null, offBasketCol: (() => void) | null = null;
  const stick = stickMesh();
  stick.visible = false;
  ctx.scene.add(stick);
  let body: PetBody | null = null, species: Species = 'puppy', name = '';
  const inp: PetInput = petInput('stand');
  const aff = new Affection(9, 3, 0.4);
  const tilt = new LookTilt();

  function showBasket(on: boolean): void {
    if (on && !basket) {
      basket = basketMesh();
      basket.position.set(basketAt.x, heightAt(basketAt.x, basketAt.z), basketAt.z);
      basket.rotation.y = basketAt.yaw;
      ctx.scene.add(basket);
      offBasketCol = ctx.colliders.circle(basketAt.x, basketAt.z, 0.45);
    } else if (!on && basket) {
      ctx.scene.remove(basket);
      basket.geometry.dispose(); (basket.material as THREE.Material).dispose();
      basket = null;
      offBasketCol?.(); offBasketCol = null;
    }
  }

  // ------------------------------------------------------------------ movement
  interface Mover { x: number; z: number; y: number; yaw: number; v: number; stuck: number; gs: number; turn: number; px: number; pz: number; pyaw: number; lift: number; r: number; personal: number; wp: number }
  const m: Mover = { x: basketAt.x, z: basketAt.z, y: 0, yaw: 0, v: 0, stuck: 0, gs: 0, turn: 0, px: basketAt.x, pz: basketAt.z, pyaw: 0, lift: 0, r: 0.22, personal: 0.55, wp: 0 };
  const ws = () => ctx.services.get('walkSurface') as ((x: number, z: number) => number | null) | undefined;
  /** can a pet stand here: dry ground or a deck, not too steep */
  const walkable = (x: number, z: number): boolean => dry(x, z) && slopeAt(x, z) <= 0.7;
  /** dry ground or a deck (the cheap test: steps and lines check ledges by height instead of slope) */
  const dry = (x: number, z: number): boolean => {
    const h = heightAt(x, z);
    const w = ws()?.(x, z);
    if (w !== null && w !== undefined && w > h - 0.05) return true;
    return h >= W + 0.1 && x * x + z * z < 125 * 125;
  };
  /** a straight walk with no water, no solid, no ledge in the way */
  // (the terrain tests are cheap; a collider query walks every solid in the valley, so those go every ~0.9 m: the
  //  pet's radius plus the smallest solid still covers the gap)
  const clearLine = (ax: number, az: number, bx: number, bz: number): boolean => {
    const d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(d / 0.45));
    let py = groundY(ctx, ax, az);
    for (let i = 1; i <= n; i++) {
      const x = ax + (bx - ax) * (i / n), z = az + (bz - az) * (i / n);
      if (!dry(x, z)) return false;
      const y = groundY(ctx, x, z);
      if (Math.abs(y - py) > 0.32) return false;
      py = y;
    }
    for (let i = 1; i <= n; i += 2) {
      const k = Math.min(1, i / n);
      if (ctx.colliders.blocked(ax + (bx - ax) * k, az + (bz - az) * k, m.r * 0.8)) return false;
    }
    return n % 2 === 1 || !ctx.colliders.blocked(bx, bz, m.r * 0.8);
  };
  const tmp = { x: 0, z: 0 };
  const freeAt = { x: 0, z: 0, r: 0 };
  /** one step toward (tx, tz) at up to `speed`; returns the distance left */
  function step(tx: number, tz: number, speed: number, dt: number, turnRate = 8): number {
    const dx = tx - m.x, dz = tz - m.z, d = Math.hypot(dx, dz);
    if (d < 0.05) { m.v = damp(m.v, 0, 10, dt); return d; }
    const want = Math.atan2(dx, dz);
    m.yaw = dampAngle(m.yaw, want, turnRate, dt);
    const facing = Math.max(0.15, Math.cos(wrap(want - m.yaw)));
    m.v = damp(m.v, Math.min(speed, d * 2.4) * facing, speed > 3 ? 3.2 : 5, dt);
    const nx = m.x + Math.sin(m.yaw) * m.v * dt, nz = m.z + Math.cos(m.yaw) * m.v * dt;
    if (!dry(nx, nz) || Math.abs(groundY(ctx, nx, nz) - groundY(ctx, m.x, m.z)) > 0.3) { m.v = 0; m.stuck += dt; return d; }
    const px = m.x, pz = m.z;
    tmp.x = nx; tmp.z = nz;
    // no colliders right at a bed (the decor's own collider would push it off its cushion)
    if (!(freeAt.r > 0 && Math.hypot(nx - freeAt.x, nz - freeAt.z) < freeAt.r)) ctx.colliders.resolve(tmp, m.r);
    const ex = tmp.x - player.x, ez = tmp.z - player.z, ed = Math.hypot(ex, ez), min = m.r + m.personal;
    if (ed < min && ed > 1e-4) { tmp.x = player.x + (ex / ed) * min; tmp.z = player.z + (ez / ed) * min; }
    m.x = tmp.x; m.z = tmp.z;
    const moved = Math.hypot(m.x - px, m.z - pz);
    m.stuck = moved < m.v * dt * 0.3 ? m.stuck + dt : Math.max(0, m.stuck - dt * 2);
    return d;
  }
  const halt = (dt: number) => { m.v = damp(m.v, 0, 8, dt); };
  const face = (x: number, z: number, dt: number, rate = 5) => { m.yaw = dampAngle(m.yaw, Math.atan2(x - m.x, z - m.z), rate, dt); };

  // pathing toward a goal: porch steps, the yard gap, the straight line, else your trail
  const crumbs = new Crumbs(72, 0.7, 7);
  const way = { x: 0, z: 0 }, goalP = { x: 0, z: 0 };
  let pathIn = 0, wayOk = false;
  function nav(tx: number, tz: number, speed: number, dt: number, useTrail: boolean): number {
    const left = Math.hypot(tx - m.x, tz - m.z);
    // the porch: up / down by the steps
    const tP = onPorch(tx, tz), mP = onPorch(m.x, m.z);
    if (tP !== mP) {
      if (m.wp === 0 || m.wp > 2) m.wp = 1;
      const a = tP ? stepsOut : stepsIn, b = tP ? stepsIn : stepsOut;
      const w = m.wp === 1 ? a : b;
      if (step(w.x, w.z, speed, dt) < 0.45) m.wp = m.wp === 1 ? 2 : 1;
      return left + 1;
    }
    // the yard: round the west side of the house and in through the gap in the fence
    const tY = inYard(tx, tz, 0.3), mY = inYard(m.x, m.z, 0.3);
    if (tY !== mY) {
      if (!mY) {
        // heading in: (round the house's west corner) → behind the house → through the gap
        if (m.wp < 3 || m.wp > 5) m.wp = clearLine(m.x, m.z, houseBack.x, houseBack.z) ? 4 : 3;
        if (m.wp === 3) { if (step(houseCorner.x, houseCorner.z, speed, dt) < 0.6 || clearLine(m.x, m.z, houseBack.x, houseBack.z)) m.wp = 4; }
        else if (m.wp === 4) { if (step(houseBack.x, houseBack.z, speed, dt) < 0.5) m.wp = 5; }
        else step(gapIn.x, gapIn.z, speed, dt);
      } else {
        // heading out: to the gap, then through it
        if (m.wp < 6) m.wp = 6;
        if (m.wp === 6) { if (step(gapIn.x, gapIn.z, speed, dt) < 0.5) m.wp = 7; }
        else step(houseBack.x, houseBack.z, speed, dt);
      }
      return left + 1;
    }
    m.wp = 0;
    pathIn -= dt;
    if (pathIn <= 0 || Math.abs(goalP.x - tx) + Math.abs(goalP.z - tz) > 0.8) {
      pathIn = 0.3;
      goalP.x = tx; goalP.z = tz;
      if (clearLine(m.x, m.z, tx, tz)) { way.x = tx; way.z = tz; wayOk = true; }
      else if (useTrail) { wayOk = trailWaypoint(crumbs, m, clearLine, 6, way) >= 0; if (!wayOk && Math.hypot(way.x - m.x, way.z - m.z) < 0.4) { way.x = tx; way.z = tz; } }
      else { way.x = tx; way.z = tz; wayOk = false; }
    }
    if (wayOk && way.x === goalP.x && way.z === goalP.z) return step(tx, tz, speed, dt);
    step(way.x, way.z, speed, dt);
    if (Math.hypot(way.x - m.x, way.z - m.z) < 0.4) pathIn = 0;
    return left;
  }
  /** pop the pet down somewhere sensible near the player, out of the way (behind, else beside) */
  const PLACES = [[0, 1.8], [-1.4, 1.2], [1.4, 1.2], [-1.6, 0], [1.6, 0], [0, 2.8], [-1.2, -1.2], [1.2, -1.2]] as const;
  function snapNear(): boolean {
    const sy = Math.sin(ctx.player.yaw), cy = Math.cos(ctx.player.yaw);
    for (const [lat, back] of PLACES) {
      // behind = +(sin yaw, cos yaw) (forward is (−sin, −cos)); left = (−cos, sin)
      const x = player.x + sy * back - cy * lat, z = player.z + cy * back + sy * lat;
      if (!walkable(x, z) || ctx.colliders.blocked(x, z, m.r)) continue;
      m.x = m.px = x; m.z = m.pz = z; m.yaw = m.pyaw = ctx.player.yaw + Math.PI; m.v = 0; m.stuck = 0; m.lift = 0; m.wp = 0;
      body?.snap();
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ state
  let state: State = 'off', prev: State = 'rest', t = 0, now = 0;
  let perched = false;
  let still = 0, sniffIn = 6, sniffT = 0, greetIn = 4, findIn = 3, barkQ = 0, barkGap = 0, pant = 0, voiceIn = 0, tickIn = 0;
  let ms = 0;
  let walkAcc = 0, walkIn = 1, side = 1, wokeUntil = -1, napPose: PetPose = 'lie';
  const target = { x: 0, z: 0, yaw: 0, id: '' };
  const find = { key: '', name: '', x: 0, y: 0, z: 0 };
  const findScratch = { key: '', name: '', x: 0, y: 0, z: 0 };
  const shown = new Set<string>();
  const greeted = new Map<string, number>();
  const setState = (s: State, dur = 0) => { if (s !== state) prev = state; state = s; t = dur; };
  const night = () => { const h = ctx.valley.sky.hour; return h >= 21.5 || h < 6; };
  const kitten = () => species === 'kitten';
  const home = { x: 0, z: 0, yaw: 0, lift: 0, bed: false };
  function homeSpot(): typeof home {
    const w = wallet();
    const bed = w?.data().pieces.find((p) => p.id === 'petbed' && p.slot !== null);
    if (bed && bed.slot !== null && SLOTS[bed.slot]) {
      const s = SLOTS[bed.slot];
      home.x = s.x; home.z = s.z; home.yaw = (bed.rot / 8) * TAU + 0.4; home.lift = 0.13 * (SPECIES_K[species] / 0.8); home.bed = true;
    } else { home.x = porchBed.x; home.z = porchBed.z; home.yaw = porchYaw; home.lift = 0; home.bed = false; }
    return home;
  }

  // ------------------------------------------------------------------ voice
  const bark = (n = 1) => { barkQ = Math.max(barkQ, n); };
  function voiceTick(dt: number): void {
    barkGap -= dt;
    if (barkQ <= 0 || barkGap > 0 || !body) return;
    barkQ--; barkGap = species === 'kitten' ? 0.9 : 0.3 + rnd() * 0.08;
    if (Math.hypot(player.x - m.x, player.z - m.z) > 40) return;
    const a = audio();
    if (species === 'puppy') a?.play('bark', { pos: body.root.position, pitch: 1.32 + rnd() * 0.15, volume: 0.75 });
    else if (species === 'kitten') a?.play('meow', { pos: body.root.position, pitch: 1.3 + rnd() * 0.15, volume: 0.8 });
    else critterSound(ctx, 'yip', m.x, m.y + 0.4, m.z, 30, 0.8, 1.25);
  }

  // ------------------------------------------------------------------ the stick
  const stk = { on: false, flying: false, held: false, t: 0, dur: 1, fx: 0, fy: 0, fz: 0, tx: 0, ty: 0, tz: 0, arc: 1, life: 0, spin: 0 };
  const mouth = new THREE.Vector3();
  const _w = new THREE.Vector3();
  function throwStick(): boolean {
    if (!body || stk.flying || stk.held) return false;
    const sy = Math.sin(ctx.player.yaw), cy = Math.cos(ctx.player.yaw);
    let dist = 9.5;
    for (; dist >= 2.5; dist -= 0.75) {
      const x = player.x - sy * dist, z = player.z - cy * dist;
      if (walkable(x, z) && clearLine(player.x, player.z, x, z) && !inYard(x, z, 0.2) === !inYard(player.x, player.z, 0.2)) break;
    }
    if (dist < 2.5) { ctx.ui.say('No room for a throw here. Somewhere more open?', 2000); return false; }
    const e = ctx.player.eye;
    stk.fx = e.x - sy * 0.35 - cy * 0.25; stk.fy = e.y - 0.25; stk.fz = e.z - cy * 0.35 + sy * 0.25;
    stk.tx = player.x - sy * dist; stk.tz = player.z - cy * dist; stk.ty = groundY(ctx, stk.tx, stk.tz) + 0.025;
    stk.t = 0; stk.dur = 0.45 + dist * 0.05; stk.arc = 1.1 + dist * 0.14; stk.flying = true; stk.on = true; stk.held = false; stk.life = 0; stk.spin = rnd() * TAU;
    if (stick.parent !== ctx.scene) ctx.scene.add(stick);
    stick.position.set(stk.fx, stk.fy, stk.fz);
    stick.visible = true;
    audio()?.play('cast', { volume: 0.5, pitch: 1.2 });
    target.x = stk.tx; target.z = stk.tz;
    setState('fetch', 0);
    inp.ears = 1;
    bark(1);
    return true;
  }
  function holdStick(): void {
    if (!body) return;
    const head = body.model.bones.head;
    const k = SPECIES_K[species];
    head.add(stick);
    if (species === 'kitten') stick.position.set(0, -0.026 * k, 0.118 * k);
    else stick.position.set(0, -0.047 * k, (species === 'fox' ? 0.235 : 0.218) * k);
    stick.rotation.set(0, 0, 0.12);
    stk.held = true; stk.flying = false;
  }
  function dropStick(): void {
    if (!stk.held) return;
    stick.getWorldPosition(_w);
    ctx.scene.add(stick);
    stk.held = false; stk.flying = true; stk.t = 0; stk.dur = 0.35; stk.arc = 0.05;
    stk.fx = _w.x; stk.fy = _w.y; stk.fz = _w.z;
    stk.tx = _w.x; stk.tz = _w.z; stk.ty = groundY(ctx, _w.x, _w.z) + 0.025;
    stk.life = 5;
  }
  function stickTick(dt: number): void {
    if (!stk.on) return;
    if (stk.flying) {
      stk.t += dt;
      const k = clamp(stk.t / stk.dur, 0, 1);
      stick.position.set(stk.fx + (stk.tx - stk.fx) * k, stk.fy + (stk.ty - stk.fy) * k + Math.sin(k * Math.PI) * stk.arc, stk.fz + (stk.tz - stk.fz) * k);
      stick.rotation.set(0, stk.spin + k * 2.2, k < 1 ? k * TAU * 1.5 : 0);
      if (k >= 1) { stk.flying = false; stick.rotation.set(0, stk.spin, 0); if (stk.arc > 0.3) audio()?.play('plop', { pos: stick.position, volume: 0.25, pitch: 1.6 }); }
    }
    if (stk.life > 0 && !stk.held && !stk.flying) {
      stk.life -= dt;
      if (stk.life <= 0) { stk.on = false; stick.visible = false; }
    }
  }

  // ------------------------------------------------------------------ actions
  function petIt(): void {
    if (!body) return;
    const g = model.act('pet');
    const r = aff.pet(now);
    const hx = m.x + Math.sin(m.yaw) * 0.25, hz = m.z + Math.cos(m.yaw) * 0.25;
    if (state === 'home' && body.currentPose === 'curl') {
      fx.heartsAt(hx, m.y + m.lift + 0.45, hz, 2, rnd);
      ctx.ui.say(`${name} sighs happily in their sleep.`, 2200, { from: 'life:companion' });
      audio()?.play(kitten() ? 'purr' : 'pet', { pos: body.root.position, volume: 0.5 });
      return;
    }
    if (stk.held) dropStick();
    if (r === 'rollover' && !kitten() && state !== 'indoor') {
      setState('belly', 4.2);
      fx.heartsAt(m.x, m.y + 0.5, m.z, 6, rnd);
      ctx.ui.say(`${name} flops over for belly rubs!`, 2400, { from: 'life:companion' });
    } else {
      if (state !== 'petted' && state !== 'belly') prev = state === 'indoor' ? 'indoor' : 'rest';
      state = 'petted'; t = 2.6;
      fx.heartsAt(hx, m.y + m.lift + body.headHeight() + 0.25, hz, g > 0 ? 4 : 3, rnd);
      ctx.ui.say(say(PET_LINES[species], name, rnd()), 2200, { from: state === 'petted' && indoors()?.active ? 'interior:companion' : 'life:companion' });
    }
    const a = audio();
    a?.play('pet', { pos: body.root.position, volume: 0.8 });
    if (kitten()) a?.play('purr', { pos: body.root.position });
    else bark(1);
  }
  function altUse(): void {
    if (!body) return;
    if (state === 'home') { wokeUntil = now + 900; setState('follow'); inp.happy = 0; bark(1); ctx.ui.say(`${name} stretches, yawns and trots after you.`, 2000, { from: 'life:companion' }); return; }
    throwStick();
  }

  // ------------------------------------------------------------------ interactables + service
  const headPos = (o: THREE.Vector3) => o.set(m.x + Math.sin(m.yaw) * 0.12, m.y + m.lift + (body ? body.headHeight() * 0.85 : 0.3), m.z + Math.cos(m.yaw) * 0.12);
  const hint = (): string => {
    const d = model.data();
    const h = heartsOf(d.happy);
    return `${'♥'.repeat(h)}${'♡'.repeat(5 - h)} ${moodOf(d.happy)} · ${d.today.pets} pat${d.today.pets === 1 ? '' : 's'} today${state === 'home' ? ' · asleep' : ''}`;
  };
  const alt = { verb: 'Fetch!', use: altUse };
  const petI: Interactable = {
    id: 'life:companion', kind: 'animal', verb: 'Pet', label: () => name, pos: headPos, reach: 3.3,
    enabled: () => !!body && state !== 'indoor' && state !== 'off', use: petIt, alt, hint,
  };
  const petIn: Interactable = {
    id: 'interior:companion', kind: 'animal', verb: 'Pet', label: () => name, pos: headPos, reach: 3.0,
    enabled: () => !!body && state === 'indoor', use: petIt, hint,
  };
  const basketI: Interactable = {
    id: 'life:foundlings', kind: 'prop', verb: 'Peek in', label: () => "Fern's foundlings", reach: 3.2,
    pos: (o) => o.set(basketAt.x, heightAt(basketAt.x, basketAt.z) + 0.35, basketAt.z),
    enabled: () => !model.data().pet && !!basket,
    use: () => { audio()?.play(rnd() < 0.5 ? 'bark' : 'meow', { volume: 0.35, pitch: 1.5 }); if (ctx.ui.pet) ctx.ui.pet(); else ctx.ui.say('A puppy and a kitten asleep in a basket. "Free to good homes, ask Fern."'); },
    hint: () => { const o = offerFor(fernHearts()); return o.fee ? `free to good homes · ${o.fee} bits to the kibble fund until Fern has ♥2` : 'free to a good home · Fern trusts you'; },
  };
  const offs = [ctx.interact.add(petI), ctx.interact.add(petIn), ctx.interact.add(basketI)];

  function spawn(): void {
    const p = model.data().pet;
    if (!p) return;
    if (body) { ctx.scene.remove(body.root); body.dispose(); }
    species = p.species; name = p.name;
    body = new PetBody(familyOf(species), companionModel(species, p.coat));
    body.root.name = 'life:companion';
    ctx.scene.add(body.root);
    alt.verb = kitten() ? 'Play!' : 'Fetch!';
    side = rnd() < 0.5 ? 1 : -1;
    crumbs.reset(player.x, player.z);
  }
  function despawn(): void {
    if (body) { ctx.scene.remove(body.root); body.dispose(); body = null; }
    if (stk.held) { ctx.scene.add(stick); stk.held = false; }
    stk.on = false; stick.visible = false;
    state = 'off';
  }
  const offModel = model.onChange((c) => {
    if (c.kind === 'adopt') {
      spawn();
      // out of the basket and off to you
      m.x = m.px = basketAt.x + 0.5; m.z = m.pz = basketAt.z + 0.3; m.yaw = m.pyaw = Math.atan2(player.x - m.x, player.z - m.z);
      body?.snap();
      showBasket(false);
      setState('arrive', 0);
      bark(2);
      fx.heartsAt(m.x, heightAt(m.x, m.z) + 0.5, m.z, 5, rnd);
      ctx.ui.say(`${name} tumbles out of the basket and races over to you! Fern waves from the signpost.`, 3200);
    } else if (c.kind === 'rename') name = c.name;
    else if (c.kind === 'dev') { if (!model.data().pet) { despawn(); showBasket(true); } }
  });

  const service: CompanionService = {
    model,
    offer: () => ({ ...offerFor(fernHearts()), coins: wallet()?.coins() ?? 0 }),
    adopt(sp, coat, nm): AdoptResult {
      const w = wallet();
      const r = model.adopt(sp, coat, nm, { fernHearts: fernHearts(), coins: w?.coins() ?? 0 });
      if (r.ok && r.fee > 0 && !w?.spend(r.fee, 'kibble fund')) { model.devReset(); return { ok: false, reason: 'coins' }; }
      return r;
    },
    dev(cmd, a, b) {
      if (cmd === 'puppy' || cmd === 'kitten' || cmd === 'fox') {
        if (model.data().pet) { model.devReset(); }
        const sd = cmd;
        model.adopt(sd, a ?? '', b ?? '', { fernHearts: 9, coins: 0, free: true });
        // stand it in front of you, sitting, looking up
        const sy = Math.sin(ctx.player.yaw), cy = Math.cos(ctx.player.yaw);
        m.x = m.px = player.x - sy * 2.2; m.z = m.pz = player.z - cy * 2.2; m.yaw = m.pyaw = ctx.player.yaw; m.lift = 0;
        (ctx.services.get('controller') as { teleport(x: number, z: number, yaw?: number, pitch?: number): void } | undefined)?.teleport(player.x, player.z, ctx.player.yaw, -0.42);
        body?.snap();
        setState('rest', 0); still = 3;
        return service.dev('state');
      }
      if (cmd === 'fetch') return throwStick();
      if (cmd === 'pet') { petIt(); return state; }
      if (cmd === 'home') { wokeUntil = -1; homeSpot(); setState('home'); return { x: home.x, z: home.z, bed: home.bed }; }
      if (cmd === 'sniff') { sniffIn = 0; still = 10; setState('rest'); return true; }
      if (cmd === 'find') {
        const f = forage();
        if (!f || !f.near(player.x, player.z, 400, findScratch)) return null;
        Object.assign(find, findScratch);
        const c = ctx.services.get('controller') as { teleport(x: number, z: number, yaw?: number, pitch?: number): void } | undefined;
        const dx = find.x - player.x, dz = find.z - player.z, l = Math.hypot(dx, dz) || 1;
        const px = find.x - (dx / l) * 5, pz = find.z - (dz / l) * 5;
        c?.teleport(px, pz, Math.atan2(-(find.x - px), -(find.z - pz)), -0.32);
        m.x = m.px = px + (dx / l) * 1.2 + (dz / l) * 0.8; m.z = m.pz = pz + (dz / l) * 1.2 - (dx / l) * 0.8; body?.snap();
        shown.add(find.key); setState('find', 30); target.x = find.x; target.z = find.z;
        return { name: find.name, x: find.x, z: find.z };
      }
      if (cmd === 'reset') { model.devReset(); return null; }
      return { state, pose: inp.pose, x: +m.x.toFixed(2), z: +m.z.toFixed(2), name, species, happy: model.data().happy, stick: stk.held ? 'held' : stk.on ? 'out' : 'none', gait: body?.legs.gait ?? null, dist: +Math.hypot(player.x - m.x, player.z - m.z).toFixed(2), ms: +ms.toFixed(3) };
    },
  };
  ctx.services.set('companion', service);
  if (model.data().pet) { spawn(); snapNear(); setState('rest'); } else showBasket(true);

  // ------------------------------------------------------------------ the brain
  const heel = { x: 0, z: 0 };
  let lastPX = player.x, lastPZ = player.z;
  const look = { yaw: 0, pitch: 0 };
  const lookedAt = (h: number, maxD: number): boolean => {
    const e = ctx.player.eye, dx = m.x - e.x, dz = m.z - e.z, dy = m.y + h - e.y, d = Math.hypot(dx, dz);
    if (d > maxD || d < 0.3) return false;
    const fxv = -Math.sin(ctx.player.yaw) * Math.cos(ctx.player.pitch), fzv = -Math.cos(ctx.player.yaw) * Math.cos(ctx.player.pitch), fyv = Math.sin(ctx.player.pitch);
    return (fxv * dx + fyv * dy + fzv * dz) / Math.hypot(dx, dy, dz) > Math.cos(0.2 + 0.25 / d);
  };

  function lookAround(): void {
    // greet: a villager or Biscuit / Mochi close to both of you; a find within sniffing range
    greetIn = 2 + rnd();
    const pd = Math.hypot(player.x - m.x, player.z - m.z);
    if (pd > 9 || ctx.player.speed > 3) return;
    const pets = ctx.services.get('pets') as PetsService | undefined;
    for (const p of pets?.list() ?? []) {
      if ((greeted.get(p.id) ?? -1e9) > now - 90) continue;
      const d = Math.hypot(p.x - m.x, p.z - m.z);
      if (d > 8 || d < 0.6 || Math.hypot(p.x - player.x, p.z - player.z) > 11) continue;
      greeted.set(p.id, now);
      target.x = p.x; target.z = p.z; target.id = p.id; target.yaw = 1;
      pets?.hold(p.id, 'companion', 8);
      setState('greet', 12);
      return;
    }
    const vs = ctx.services.get('villagers') as VillagersService | undefined;
    for (const v of vs?.list() ?? []) {
      if (v.inside || (greeted.get(v.id) ?? -1e9) > now - 150) continue;
      const d = Math.hypot(v.x - m.x, v.z - m.z);
      if (d > 7 || Math.hypot(v.x - player.x, v.z - player.z) > 9) continue;
      greeted.set(v.id, now);
      target.x = v.x; target.z = v.z; target.id = v.id; target.yaw = 0;
      setState('greet', 12);
      return;
    }
  }
  function sniffFind(): void {
    findIn = 2.5 + rnd();
    const f = forage();
    if (!f || !f.near(m.x, m.z, 10, findScratch) || shown.has(findScratch.key)) return;
    if (Math.hypot(findScratch.x - player.x, findScratch.z - player.z) > 14) return;
    if (!clearLine(m.x, m.z, findScratch.x, findScratch.z)) return;
    shown.add(findScratch.key);
    find.key = findScratch.key; find.name = findScratch.name; find.x = findScratch.x; find.y = findScratch.y; find.z = findScratch.z;
    target.x = find.x; target.z = find.z;
    setState('find', 30);
  }

  function brain(dt: number): number {
    t -= dt; greetIn -= dt; findIn -= dt; sniffIn -= dt;
    aff.update(dt);
    const pd = Math.hypot(player.x - m.x, player.z - m.z);
    const moving = ctx.player.speed > 0.5;
    still = moving ? 0 : still + dt;
    inp.pose = 'stand'; inp.sniff = 0; inp.ears = 0; inp.happy = 0; inp.lean = 0; inp.bump = 0; inp.tilt = 0; inp.narrow = 0; inp.slowBlink = false;
    inp.joy = aff.joy;
    m.personal = 0.55; freeAt.r = 0;
    // a perch (scene/seasons: the rowboat's bow): sit there and ride along, then hop off by you
    const pp = ctx.services.get('petPerch') as PetPerch | undefined;
    if (pp?.active && state !== 'off' && state !== 'indoor' && state !== 'home') {
      if (!perched) { if (stk.held) dropStick(); setState('rest'); body?.snap(); bark(1); }
      perched = true;
      m.x = m.px = pp.x; m.z = m.pz = pp.z; m.yaw = m.pyaw = pp.yaw; m.v = 0; m.lift = 0; m.stuck = 0;
      inp.pose = 'sit'; inp.joy = Math.max(0.5, aff.joy); inp.ears = 0.6; still = 1;
      return 0;
    }
    if (perched) { perched = false; snapNear(); setState('rest'); crumbs.reset(player.x, player.z); }
    let speed = 0;
    const room = indoors();
    const awayOk = state === 'follow' || state === 'rest' || state === 'sniff' || state === 'arrive';
    // indoors: by the hearth
    if (room?.active && state !== 'indoor' && state !== 'petted') {
      if (stk.held) dropStick();
      stk.on = false; stick.visible = false;
      roomSpot();
      m.x = m.px = rug.x; m.z = m.pz = rug.z; m.yaw = m.pyaw = rugYaw; m.lift = 0; m.v = 0;
      body?.snap();
      napPose = night() ? 'curl' : 'lie';
      setState('indoor');
    }
    if (!room?.active && state === 'indoor') { snapNear(); setState('rest'); crumbs.reset(player.x, player.z); still = 2; }
    // bedtime: near home after dark, unless you woke it
    if (awayOk && night() && now > wokeUntil) {
      homeSpot();
      if (Math.hypot(player.x - home.x, player.z - home.z) < 20) setState('home');
    }
    // lost: far behind (a teleport, a swim, a stuck corner) → catches up out of sight
    if ((awayOk || state === 'greet' || state === 'find') && (pd > 45 || (m.stuck > 3 && pd > 8))) { if (snapNear()) { setState('follow'); bark(1); } }

    switch (state) {
      case 'off': return 0;
      case 'arrive': {
        const d = nav(player.x, player.z, clamp((pd - 1.2) * 1.6, 1.5, 6.5), dt, true);
        speed = m.v; inp.joy = 1; inp.ears = speed > 3.5 ? -0.4 : 0.7; pant = Math.min(1, pant + dt * 0.3);
        if (d < 1.8 || pd < 1.8) { setState('rest'); still = 1.8; bark(1); fx.heartsAt(m.x, m.y + 0.45, m.z, 3, rnd); }
        break;
      }
      case 'follow':
      case 'rest': {
        const stopped = still > 0.7;
        heelSpot(player.x, player.z, ctx.player.yaw, stopped, side * 0.9, heel);
        const gap = Math.hypot(heel.x - m.x, heel.z - m.z);
        if (state === 'follow' || gap > (stopped ? 0.6 : 1.4)) {
          const v = followSpeed(gap, ctx.player.speed, kitten() ? 7 : 9.5);
          if (v > 0.01) { nav(heel.x, heel.z, Math.max(v, 0.6), dt, true); speed = m.v; }
          else halt(dt);
          if (stopped && gap < 0.45) setState('rest');
          else if (!stopped) state = 'follow';
          // a quick sniff of the grass now and then on a slow walk
          if (speed > 0.3 && speed < 1.8) { sniffT -= dt; if (sniffT < -6 - rnd() * 6) sniffT = 1.4; if (sniffT > 0) inp.sniff = 1; }
        } else {
          halt(dt); face(player.x, player.z, dt, 4);
          const lying = still > 26;
          inp.pose = night() && still > 70 ? 'curl' : lying ? (kitten() ? 'loaf' : 'lie') : still > 1.6 ? 'sit' : 'stand';
          const looked = lookedAt(0.35, 6);
          if (kitten()) inp.slowBlink = looked && Math.sin(now * 0.9) > 0.3;
          else { inp.tilt = tilt.update(dt, looked); if (inp.tilt !== 0) inp.ears = 1; }
          inp.joy = Math.max(0.45, aff.joy);
          voiceIn -= dt;
          if (voiceIn <= 0 && still > 4 && pd < 6) { voiceIn = 30 + rnd() * 40; if (rnd() < 0.35) bark(1); }
          if (sniffIn <= 0 && still > 5 && inp.pose !== 'curl') {
            sniffIn = 9 + rnd() * 12;
            for (let i = 0; i < 6; i++) {
              const a = rnd() * TAU, r = 1.6 + rnd() * 2.2, x = player.x + Math.cos(a) * r, z = player.z + Math.sin(a) * r;
              if (walkable(x, z) && clearLine(m.x, m.z, x, z)) { target.x = x; target.z = z; setState('sniff', 9); break; }
            }
          }
        }
        if (greetIn <= 0) lookAround();
        if (findIn <= 0 && (state as State) !== 'greet') sniffFind();
        break;
      }
      case 'sniff': {
        const d = nav(target.x, target.z, 0.75, dt, false);
        speed = m.v; inp.sniff = 1;
        if (d < 0.3 || m.stuck > 1.5) { halt(dt); if (sniffIn > -2.5) { sniffIn = Math.min(sniffIn, -0.01); } }
        if (sniffIn < -0.01 && sniffIn > -2.8) { inp.sniff = 1; if (Math.floor(sniffIn * 1.4) !== Math.floor((sniffIn + dt) * 1.4)) critterSound(ctx, 'sniff', m.x, m.y + 0.2, m.z, 8, 0.5, 1.3); }
        if (sniffIn <= -2.8 || t <= 0 || moving) { sniffIn = 10 + rnd() * 12; setState(moving ? 'follow' : 'rest'); }
        break;
      }
      case 'greet': {
        // trot over; stop a polite distance away, then say hello (nose to nose with a pet, sit up for a villager)
        const pets = target.yaw === 1;
        const dx = target.x - m.x, dz = target.z - m.z, dl = Math.hypot(dx, dz) || 1;
        const stop = pets ? 0.55 : 1.15;
        if (dl > stop + 0.05 && t > 4) { nav(target.x - (dx / dl) * stop, target.z - (dz / dl) * stop, 2.4, dt, false); speed = m.v; inp.joy = 0.9; inp.ears = 0.6; }
        else {
          if (t > 4) { t = 4; bark(1); if (!pets) fx.heartsAt(m.x, m.y + 0.45, m.z, 1, rnd); }
          halt(dt); face(target.x, target.z, dt, 5);
          inp.pose = pets ? 'stand' : 'sit'; inp.joy = 1; inp.ears = 0.8;
          if (pets) { inp.sniff = t > 2 ? 0.7 : 0; inp.lookPitch = -0.2; }
          else inp.lookPitch = 0.35;
        }
        if (t <= 0 || pd > 15 || m.stuck > 2.5) { m.stuck = 0; setState(moving ? 'follow' : 'rest'); }
        break;
      }
      case 'find': {
        const f = forage();
        const gone = !f || !f.near(find.x, find.z, 0.25, findScratch) || findScratch.key !== find.key;
        if (gone) {
          // you picked it up: delight
          model.act('find');
          aff.cheer(0.6); fx.heartsAt(m.x, m.y + 0.45, m.z, 3, rnd); bark(2);
          setState('rest'); still = 1.8;
          break;
        }
        const dx = find.x - m.x, dz = find.z - m.z, dl = Math.hypot(dx, dz) || 1;
        if (dl > 0.55 && t > 26) { nav(find.x - (dx / dl) * 0.45, find.z - (dz / dl) * 0.45, 3.2, dt, false); speed = m.v; inp.sniff = 0.6; inp.joy = 0.8; if (m.stuck > 2) t = 0; }
        else {
          if (t > 26) { t = 26; bark(2); ctx.ui.say(`${name} found something! ${kitten() ? 'Sitting by' : 'Nose pointing at'}: ${find.name.toLowerCase()}.`, 2800, { from: 'life:companion' }); }
          halt(dt); face(find.x, find.z, dt, 6);
          inp.pose = kitten() ? 'sit' : 'point'; inp.ears = 1; inp.joy = 0.85; inp.lookPitch = -0.25;
          voiceIn -= dt;
          if (voiceIn <= 0 && pd > 2.2) { voiceIn = 2.8; if (t > 12) bark(1); }
        }
        if (t <= 0 || pd > 22) setState(moving ? 'follow' : 'rest');
        break;
      }
      case 'fetch': {
        // race to where the stick will land; wait for it if early
        const d = nav(stk.tx, stk.tz, kitten() ? 5 : 8.5, dt, false);
        speed = m.v; inp.joy = 1; inp.ears = speed > 4 ? -0.5 : 0.6; pant = Math.min(1, pant + dt * 0.25);
        if (d < 0.38 && !stk.flying) {
          if (kitten() && rnd() < 0.5) { setState('play', 3.6); target.x = stk.tx; target.z = stk.tz; break; }
          holdStick(); setState('carry'); critterSound(ctx, 'wag', m.x, m.y + 0.4, m.z, 12, 0.6);
        }
        if (m.stuck > 2.5 || d > 30) { m.stuck = 0; stk.life = 3; setState('rest'); ctx.ui.say(`${name} can't reach it. Never mind!`, 1800, { from: 'life:companion' }); }
        break;
      }
      case 'carry': {
        // bring it back: to your feet, in front of you
        heelSpot(player.x, player.z, ctx.player.yaw, true, side * 0.2, heel, 1.5);
        const d = nav(heel.x, heel.z, followSpeed(Math.hypot(heel.x - m.x, heel.z - m.z), ctx.player.speed, kitten() ? 4 : 7), dt, true);
        speed = m.v; inp.joy = 1; inp.ears = 0.5;
        if (d < 0.5 || pd < 1.35) {
          dropStick(); model.act('fetch'); aff.cheer(0.4);
          ctx.ui.say(say(FETCH_LINES[species], name, rnd()), 2200, { from: 'life:companion' });
          setState('rest'); still = 2; bark(1);
        }
        if (m.stuck > 3) { dropStick(); setState('rest'); }
        break;
      }
      case 'play': {
        // a kitten pounces on the stick, bats it about and sits on it: fetch is negotiable
        halt(dt); face(target.x, target.z, dt, 8);
        const k = 3.6 - t;
        inp.pose = k < 0.7 ? 'bow' : k < 1.1 ? 'stand' : k < 2.4 ? 'knead' : 'loaf';
        if (k > 0.7 && k < 1.1) m.lift = Math.sin(((k - 0.7) / 0.4) * Math.PI) * 0.12; else m.lift = 0;
        inp.joy = 1; inp.ears = k < 0.7 ? 1 : 0.2;
        if (t <= 0) {
          model.act('fetch'); m.lift = 0; stk.life = 3;
          ctx.ui.say(`${name} pounces on the stick and sits on it. Fetch is negotiable.`, 2400, { from: 'life:companion' });
          setState('rest');
        }
        break;
      }
      case 'petted': {
        halt(dt);
        if (prev !== 'indoor') face(player.x, player.z, dt, 5);
        inp.pose = prev === 'indoor' ? (kitten() ? 'loaf' : 'lie') : kitten() ? 'sit' : t > 1.6 ? 'stand' : 'sit';
        inp.happy = 1; inp.ears = -1; inp.joy = 1; inp.lean = Math.sin(now * 1.3) * 0.25 + 0.55; inp.lookPitch = -0.35;
        if (kitten()) { inp.bump = t > 1.6 && t < 2.4 ? Math.sin((2.4 - t) / 0.8 * Math.PI) : 0; inp.slowBlink = t < 1.2; }
        if (t <= 0) setState(prev === 'indoor' ? 'indoor' : 'rest');
        break;
      }
      case 'belly': {
        halt(dt); inp.pose = 'belly'; inp.joy = 1; inp.happy = 1;
        if (Math.floor(t * 1.1) !== Math.floor((t + dt) * 1.1)) fx.heartsAt(m.x, m.y + 0.35, m.z, 1, rnd);
        if (t <= 0) setState('rest');
        break;
      }
      case 'home': {
        homeSpot();
        freeAt.x = home.x; freeAt.z = home.z; freeAt.r = home.bed ? 0.9 : 0;
        // amble when close, trot when the bed is a way off (it was walking home from the square at 1.4 m/s)
        const d = nav(home.x, home.z, clamp(Math.hypot(home.x - m.x, home.z - m.z) * 0.5, 1.4, 3.4), dt, true);
        speed = m.v;
        if (d < 0.3) {
          m.x = damp(m.x, home.x, 4, dt); m.z = damp(m.z, home.z, 4, dt);
          m.yaw = dampAngle(m.yaw, home.yaw, 2, dt);
          m.lift = damp(m.lift, home.lift, 5, dt);
          inp.pose = pd < 2.5 && night() ? 'lie' : 'curl';
          if (!night() && pd < 30) { m.lift = 0; setState('follow'); bark(1); }
        } else m.lift = damp(m.lift, 0, 6, dt);
        if (m.stuck > 4) { m.stuck = 0; m.x = m.px = home.x; m.z = m.pz = home.z; body?.snap(); }
        break;
      }
      case 'indoor': {
        halt(dt);
        m.x = rug.x; m.z = rug.z;
        const pdIn = Math.hypot(player.x - m.x, player.z - m.z);
        inp.pose = napPose === 'curl' && pdIn > 2.2 ? 'curl' : kitten() ? 'loaf' : 'lie';
        if (kitten()) inp.slowBlink = lookedAt(0.25, 5) && Math.sin(now * 0.9) > 0.3;
        break;
      }
    }
    pant = Math.max(0, pant - dt * (speed > 3 ? -0.2 : 0.07));
    inp.pant = kitten() ? 0 : smooth01(pant * 1.4);
    if (inp.pose === 'curl') inp.pant = 0;
    if (state !== 'play' && state !== 'home') m.lift = damp(m.lift, 0, 8, dt);
    return speed;
  }

  function place(dt: number, time: number): void {
    if (!body) return;
    const room = indoors();
    const inside = state === 'indoor' || (state === 'petted' && prev === 'indoor');
    m.y = perched ? (ctx.services.get('petPerch') as PetPerch).y : inside && room?.active ? rugY : groundY(ctx, m.x, m.z);
    if (dt > 1e-4) {
      const dx = m.x - m.px, dz = m.z - m.pz;
      const gs = (dx * Math.sin(m.yaw) + dz * Math.cos(m.yaw)) / dt;
      m.gs = Math.abs(gs) > 14 ? m.gs : gs;
      m.turn = damp(m.turn, clamp(wrap(m.yaw - m.pyaw) / dt, -8, 8), 12, dt);
    }
    m.px = m.x; m.pz = m.z; m.pyaw = m.yaw;
    body.root.position.set(m.x, m.y + m.lift, m.z);
    body.root.rotation.y = m.yaw;
    body.root.userData.indoors = inside;
    if (inside) body.root.visible = true;
    // look at you (not while sniffing, asleep or rolling about)
    const pd = Math.hypot(player.x - m.x, player.z - m.z);
    if (pd < 8 && inp.pose !== 'curl' && inp.pose !== 'belly' && inp.pose !== 'point' && state !== 'fetch' && state !== 'greet') {
      const e = ctx.player.eye, dx = e.x - m.x, dz = e.z - m.z;
      look.yaw = wrap(Math.atan2(dx, dz) - m.yaw);
      look.pitch = clamp(-(e.y - (m.y + m.lift + body.headHeight())) / Math.max(0.8, Math.hypot(dx, dz)), -0.7, 0.5);
      if (Math.abs(look.yaw) > 1.7) { look.yaw = 0; look.pitch = 0; }
      if (inp.sniff > 0) { look.yaw *= 0.3; look.pitch = 0; }
    } else { look.yaw = 0; look.pitch = state === 'greet' ? inp.lookPitch : 0; }
    inp.lookYaw = damp(inp.lookYaw, look.yaw, 5, dt);
    inp.lookPitch = damp(inp.lookPitch, look.pitch + (inp.happy > 0.5 ? -0.3 : 0), 5, dt);
    inp.speed = m.gs; inp.turn = m.turn;
    body.animate(dt, time, inp);
    if (!inside && m.lift < 0.3) fx.shadow(m.x, m.y, m.z, kitten() ? 0.16 : 0.22, 1.7, m.yaw);
  }

  return {
    meshes: [stick],
    update(f, _act) {
      const t0 = performance.now();
      try { tick(f); } finally { ms += (performance.now() - t0 - ms) * 0.05; }
    },
    stats: () => ({ companion: state, petGait: body?.legs.gait ?? '-', petMs: +ms.toFixed(3) }),
    dispose() {
      offModel();
      for (const o of offs) o();
      if (ctx.services.get('companion') === service) ctx.services.delete('companion');
      showBasket(false);
      despawn();
      ctx.scene.remove(stick);
      stick.geometry.dispose(); (stick.material as THREE.Material).dispose();
    },
  };
  function tick(f: FrameInfo): void {
    {
      const dt = f.dt;
      now = f.time;
      tickIn -= dt;
      if (tickIn <= 0) { tickIn = 30; model.tick(); }
      if (!body) { stickTick(dt); return; }
      // your trail (outdoors only), and walks together
      if (!indoors()?.active) {
        const r = crumbs.push(player.x, player.z);
        if (r === 'jump' && (state === 'follow' || state === 'rest' || state === 'sniff')) { snapNear(); }
        const moved = Math.hypot(player.x - lastPX, player.z - lastPZ);
        if (moved < 3 && (state === 'follow' || state === 'carry' || state === 'fetch') && Math.hypot(player.x - m.x, player.z - m.z) < 14) walkAcc += moved;
      }
      lastPX = player.x; lastPZ = player.z;
      walkIn -= dt;
      if (walkIn <= 0) { walkIn = 1; if (walkAcc > 0) { model.walked(walkAcc); walkAcc = 0; } }
      alt.verb = state === 'home' ? 'Wake up' : kitten() ? 'Play!' : 'Fetch!';
      brain(dt);
      voiceTick(dt);
      stickTick(dt);
      place(dt, f.time);
    }
  }
}
