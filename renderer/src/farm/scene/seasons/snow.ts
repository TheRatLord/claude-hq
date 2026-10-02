/**
 * Snowmen (winter, with lying snow: sky.trace.snow ≥ 0.3). Look down at snowy ground and E rolls a snowball: it sits
 * in front of you and grows as you push it about (snowman.ts `grow`), scraping a trail through the snow behind it;
 * E sets it down: a base, or on top of a snowman nearby if it's smaller than the ball below (three tall). Then E on
 * the snowman decorates it a piece at a time: eyes (a pinecone pair from your basket, else coal), a carrot nose, a
 * scarf, coal buttons, twig arms, a holly sprig (from your basket) or a little hat. Three balls, eyes and a nose make
 * a snow friend (the stamp). At most three snowmen; they persist for the day (`claude-valley.snowmen.v1`) and melt
 * with the snow.
 *
 * Draws: the snowballs (1, instanced), all decorations merged (1, rebuilt on change), the trail (1, instanced).
 */
import * as THREE from 'three';
import type { HandsPort, Interactable } from '../context.ts';
import type { WalletService } from '../../model/wallet.ts';
import { dayKey } from '../../model/almanac.ts';
import { WORLD, heightAt, normalAt } from '../../world/map.ts';
import { readJson, writeJson } from '../../storage.ts';
import { toon } from '../toon.ts';
import { SNOW_MELT, SNOW_ROLL } from './physics.ts';
import { BALL_MIN, MAX_SNOWMEN, ballHeights, decorate, grow, isFriend, nearSnowman, nextDecor, parseSnow, placeBall, settle } from './snowman.ts';
import type { DecorStep, SnowData, Snowman } from './snowman.ts';
import { snowballGeometry, snowmenDecor, trailGeometry } from './models.ts';
import { onIce } from './ice.ts';
import type { Pastime, Shared } from './shared.ts';

export const SNOWMEN_KEY = 'claude-valley.snowmen.v1';
const BALLS = MAX_SNOWMEN * 3 + 1, CARRY = BALLS - 1, TRAIL = 180;
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

const DECOR_LINE: Readonly<Record<string, string>> = {
  'eyes:coal': 'Two lumps of coal for eyes. It can see you now.',
  'eyes:pinecone': 'Two pinecones from your basket for eyes. Very woodland.',
  'nose:carrot': 'A carrot nose. Perfect.',
  'scarf:red': 'A cosy red scarf.', 'scarf:blue': 'A cosy blue scarf.', 'scarf:green': 'A cosy green scarf.',
  'buttons:coal': 'Coal buttons, all done up.',
  'arms:twig': 'Twig arms, waving hello.',
  'topper:holly': 'A sprig of holly from your basket on top. Festive!',
  'topper:hat': 'A little black hat to finish. Dapper.',
};
const NEXT_HINT: Readonly<Record<string, string>> = {
  eyes: 'next: eyes', nose: 'next: a carrot nose', scarf: 'next: a scarf', buttons: 'next: buttons', arms: 'next: twig arms', topper: 'next: something on top',
};

export function createSnow(sh: Shared): Pastime {
  const { ctx } = sh;
  const p = ctx.player;
  const wallet = () => ctx.services.get('wallet') as WalletService | undefined;
  const has = (id: string) => (wallet()?.data().basket[id] ?? 0) > 0;
  const today = () => dayKey(Date.now());
  let data: SnowData = parseSnow(readJson(SNOWMEN_KEY), today());
  const save = () => writeJson(SNOWMEN_KEY, data);

  const root = new THREE.Group();
  root.name = 'seasons:snow';
  ctx.scene.add(root);
  const balls = new THREE.InstancedMesh(snowballGeometry(), toon(0xf4f6fa), BALLS);
  balls.name = 'seasons:snowballs';
  balls.castShadow = true; balls.receiveShadow = true;
  balls.frustumCulled = false;
  balls.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(balls);
  let decor: THREE.Mesh | null = null;
  const trailMat = new THREE.MeshBasicMaterial({ color: 0xa9b89a, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const trailBase = new THREE.Color(0xa9b89a);
  const trail = new THREE.InstancedMesh(trailGeometry(), trailMat, TRAIL);
  trail.name = 'seasons:trail';
  trail.frustumCulled = false;
  trail.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < TRAIL; i++) trail.setMatrixAt(i, ZERO);
  trail.count = 0;
  root.add(trail);
  let trailAt = 0, trailN = 0;

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), n = new THREE.Vector3();
  const hs: number[] = [];
  let colliders: (() => void)[] = [];

  /** rebuild every placed snowman (balls, decorations, colliders): only when one changes */
  function rebuild(): void {
    let k = 0;
    for (const off of colliders) off();
    colliders = [];
    for (const sm of data.list) {
      const gy = heightAt(sm.x, sm.z);
      ballHeights(sm.balls, hs);
      sm.balls.forEach((r, i) => {
        q.setFromAxisAngle(UP, sm.yaw + i * 1.3);
        balls.setMatrixAt(k++, m.compose(v.set(sm.x, gy + hs[i], sm.z), q, s.setScalar(r)));
      });
      colliders.push(ctx.colliders.circle(sm.x, sm.z, sm.balls[0] * 0.85));
    }
    for (; k < CARRY; k++) balls.setMatrixAt(k, ZERO);
    balls.instanceMatrix.needsUpdate = true;
    if (decor) { root.remove(decor); decor.geometry.dispose(); decor = null; }
    if (data.list.some((sm) => sm.balls.length >= 2 && Object.keys(sm.decor).length)) {
      decor = snowmenDecor(data.list, heightAt);
      decor.name = 'seasons:snowman-decor';
      decor.castShadow = true;
      root.add(decor);
    }
  }

  // ------------------------------------------------------------------ the ball you're rolling
  const carry = { on: false, x: 0, z: 0, r: BALL_MIN, rot: new THREE.Quaternion(), sinceTrail: 0 };
  const aim = new THREE.Vector3();
  let aimOk = false, hinted = false, lyingK = 0;
  const fwd = new THREE.Vector3();
  const snowy = () => ctx.valley.sky.season === 'winter' && ctx.valley.sky.trace.snow >= SNOW_ROLL;
  const rollable = (x: number, z: number) => heightAt(x, z) > WORLD.water + 0.05 && !onIce(x, z);

  function aimAtGround(): void {
    aimOk = false;
    const c = sh.controller();
    if (carry.on || !snowy() || p.frozen || sh.indoors() || c?.riding || c?.flying || p.pitch > -0.3) return;
    ctx.camera.getWorldDirection(fwd);
    for (let d = 0.8; d <= 3.6; d += 0.15) {
      const x = p.eye.x + fwd.x * d, y = p.eye.y + fwd.y * d, z = p.eye.z + fwd.z * d;
      const g = heightAt(x, z);
      if (y > g) continue;
      if (!rollable(x, z)) return;
      aim.set(x, g, z); aimOk = true;
      return;
    }
  }

  function startRoll(): void {
    if (!aimOk) return;
    carry.on = true; carry.x = aim.x; carry.z = aim.z; carry.r = BALL_MIN; carry.rot.identity(); carry.sinceTrail = 0;
    sh.sfx('crunch', aim, 0.6, 1.1);
    if (!hinted) { hinted = true; sh.say('Push it through the snow to make it bigger (watch it grow), then E to set it down. Big one first!', 5500, 'Snowman'); }
  }
  function dropCarry(): void { carry.on = false; balls.setMatrixAt(CARRY, ZERO); balls.instanceMatrix.needsUpdate = true; }

  function place(): void {
    if (!carry.on) return;
    const yaw = Math.atan2(p.pos.x - carry.x, p.pos.z - carry.z);
    const res = placeBall(data, carry.x, carry.z, carry.r, yaw);
    v.set(carry.x, heightAt(carry.x, carry.z) + carry.r, carry.z);
    switch (res.kind) {
      case 'new': sh.say('A good solid base. Now roll a smaller one for the middle and bring it here.', 4200, 'Snowman'); break;
      case 'stack': sh.say(res.sm.balls.length === 2 ? 'Up it goes! One more, smaller still, for the head.' : 'A head! Now E on your snowman to give it a face.', 4200, 'Snowman'); break;
      case 'too-big': sh.say('Too big to lift on top: the one above has to be smaller. Set it down somewhere else for a new base?', 4200, 'Snowman'); return;
      case 'tall': sh.say('This one is three balls tall already. E on it to decorate it.', 3600, 'Snowman'); return;
      case 'too-small': sh.say('A bit small for a base: push it round some more.', 3200, 'Snowman'); return;
      case 'full': sh.say('Three snowmen is plenty for one day. They\'ll keep you company till the thaw.', 4000, 'Snowman'); dropCarry(); sh.sfx('crunch', v, 0.6, 0.8); return;
    }
    dropCarry();
    save();
    rebuild();
    sh.sfx('crunch', v, 0.9, 0.85);
  }

  function decorateOne(sm: Snowman): void {
    if (sm.balls.length < 3) { sh.say(sm.balls.length === 1 ? 'Roll a smaller snowball and bring it here to stack on top.' : 'One more for the head: roll a small one and bring it here.', 3600, 'Snowman'); return; }
    const step: DecorStep | null = nextDecor(sm, has);
    if (!step) { sh.say('Your snowman looks very pleased with itself.', 3000, 'Snowman'); return; }
    if (step.take) wallet()?.take(step.take, 1);
    const was = isFriend(sm);
    decorate(sm, step);
    save();
    rebuild();
    ballHeights(sm.balls, hs);
    v.set(sm.x, heightAt(sm.x, sm.z) + hs[2], sm.z);
    sh.sfx('pop', v, 0.7, 1.1);
    sh.say(DECOR_LINE[`${step.part}:${step.value}`] ?? 'There.', 3200, 'Snowman');
    if (!was && isFriend(sm)) { sh.stamp('snowman'); setTimeout(() => sh.sfx('sparkle', v, 0.7), 200); }
  }

  // ------------------------------------------------------------------ interactables
  const groundI: Interactable = {
    id: 'seasons:snow', kind: 'prop', verb: 'Roll a snowball', reach: 4,
    label: () => (carry.on ? 'Snowball' : 'Snow'),
    pos: (out) => (carry.on ? out.set(carry.x, heightAt(carry.x, carry.z) + carry.r, carry.z) : out.copy(aim)),
    enabled: () => carry.on || aimOk,
    hint: () => carry.on ? `${Math.round(carry.r * 200)} cm across · push it about to grow it` : 'push it through the snow, then stack three',
    use: () => (carry.on ? place() : startRoll()),
  };
  const smI: Interactable[] = Array.from({ length: MAX_SNOWMEN }, (_x, i) => ({
    id: `seasons:snowman:${i}`, kind: 'prop' as const, verb: 'Decorate', reach: 3.2,
    label: () => 'Snowman',
    pos: (out: THREE.Vector3) => {
      const sm = data.list[i];
      if (!sm) return out.set(0, -100, 0);
      ballHeights(sm.balls, hs);
      return out.set(sm.x, heightAt(sm.x, sm.z) + hs[hs.length - 1], sm.z);
    },
    enabled: () => !!data.list[i] && !carry.on,
    hint: () => { const sm = data.list[i]; if (!sm) return ''; if (sm.balls.length < 3) return `${sm.balls.length} of 3 balls · roll another`; const nx = nextDecor(sm, has); return nx ? NEXT_HINT[nx.part] : 'all dressed up'; },
    use: () => { const sm = data.list[i]; if (sm) decorateOne(sm); },
  }));
  const offs = [ctx.interact.add(groundI), ...smI.map((x) => ctx.interact.add(x))];
  const verbs = () => {
    groundI.verb = !carry.on ? 'Roll a snowball' : nearSnowman(data, carry.x, carry.z, carry.r) ? 'Stack it on the snowman' : 'Set it down';
    for (let i = 0; i < MAX_SNOWMEN; i++) { const sm = data.list[i]; smI[i].verb = !sm ? 'Decorate' : sm.balls.length < 3 ? 'Look at' : nextDecor(sm, has) ? 'Decorate' : 'Admire'; }
  };
  // E while rolling even when the crosshair has wandered off the ball (the HUD only passes unhandled keys on)
  const onKey = (e: KeyboardEvent) => {
    if (e.code !== 'KeyE' || e.repeat || e.defaultPrevented || p.frozen || !carry.on) return;
    place();
  };
  addEventListener('keydown', onKey);

  rebuild();
  let checkIn = 0, goneFor = 0;
  const dirY = new THREE.Vector3(), probe = { x: 0, z: 0 };
  let verbIn = 0;
  return {
    update(f) {
      const dt = f.dt;
      checkIn -= dt;
      if (checkIn <= 0) {
        checkIn = 2;
        // melting needs the snow gone for a little while (not a flicker of the trace, or a page still loading its sky)
        const lyingNow = ctx.valley.sky.season === 'winter' && ctx.valley.sky.trace.snow >= SNOW_MELT;
        goneFor = lyingNow ? 0 : goneFor + 2;
        const lying = lyingNow || goneFor < 10;
        if (settle(data, today(), lying)) { save(); rebuild(); }
        if (!lying && trailN) { trailN = 0; trail.count = 0; }
      }
      aimAtGround();
      verbIn -= dt;
      if (verbIn <= 0) { verbIn = 0.2; verbs(); }
      lyingK = ctx.valley.sky.trace.snow;
      // the first-person paws (scene/viewmodel) push it
      if (carry.on) (ctx.services.get('hands') as HandsPort | undefined)?.carry('snowball');
      // the ball in front of you: pushed along, rolling, growing in the snow, leaving a scraped trail
      if (carry.on) {
        const c = sh.controller();
        if (!snowy() || sh.indoors() || c?.riding || Math.hypot(p.pos.x - carry.x, p.pos.z - carry.z) > 4) { dropCarry(); }
        else {
          const reach = 0.55 + carry.r;
          const tx = p.pos.x - Math.sin(p.yaw) * reach, tz = p.pos.z - Math.cos(p.yaw) * reach;
          const k = 1 - Math.exp(-dt * 9);
          let nx = carry.x + (tx - carry.x) * k, nz = carry.z + (tz - carry.z) * k;
          probe.x = nx; probe.z = nz;
          if (!rollable(nx, nz) || ctx.colliders.resolve(probe, carry.r * 0.8)) { nx = carry.x; nz = carry.z; }
          const dx = nx - carry.x, dz = nz - carry.z, d = Math.hypot(dx, dz);
          if (d > 1e-4) {
            carry.r = grow(carry.r, d * Math.min(1, lyingK / 0.6));
            // roll about the horizontal axis across the motion
            dirY.set(dz / d, 0, -dx / d);
            q.setFromAxisAngle(dirY, d / carry.r);
            carry.rot.premultiply(q);
            carry.sinceTrail += d;
          }
          carry.x = nx; carry.z = nz;
          const gy = heightAt(carry.x, carry.z);
          balls.setMatrixAt(CARRY, m.compose(v.set(carry.x, gy + carry.r * 0.92, carry.z), carry.rot, s.setScalar(carry.r)));
          balls.instanceMatrix.needsUpdate = true;
          if (carry.sinceTrail > 0.14) {
            carry.sinceTrail = 0;
            const nn = normalAt(carry.x, carry.z, 0.4);
            n.set(nn.x, nn.y, nn.z);
            q.setFromUnitVectors(UP, n);
            trail.setMatrixAt(trailAt, m.compose(v.set(carry.x, gy + 0.02, carry.z), q, s.set(carry.r * 0.7, 1, carry.r * 0.7)));
            trailAt = (trailAt + 1) % TRAIL; trailN = Math.min(TRAIL, trailN + 1);
            trail.count = trailN;
            trail.instanceMatrix.needsUpdate = true;
          }
        }
      }
      // the scraped trail is unlit: dim it with the light
      trailMat.color.copy(trailBase).multiplyScalar(0.3 + 0.7 * (1 - ctx.lighting.night) * Math.min(1.1, ctx.lighting.sunIntensity / 2));
    },
    dev(cmd, a) {
      if (cmd === 'reset') { data.list = []; save(); rebuild(); dropCarry(); trailN = 0; trail.count = 0; }
      else if (cmd === 'roll') {
        if (!snowy()) return 'no lying snow (season=winter, __valley.atmo({ snow: 1 }))';
        aim.set(p.pos.x - Math.sin(p.yaw) * 1.4, 0, p.pos.z - Math.cos(p.yaw) * 1.4); aim.y = heightAt(aim.x, aim.z);
        aimOk = true; startRoll();
        if (typeof a === 'number') carry.r = Math.max(BALL_MIN, Math.min(0.78, a));
      } else if (cmd === 'place') place();
      else if (cmd === 'build') {
        // a whole snowman in front of you (dressed up to `a` pieces: default all)
        if (!snowy()) return 'no lying snow (season=winter, __valley.atmo({ snow: 1 }))';
        const x = p.pos.x - Math.sin(p.yaw) * 2.6, z = p.pos.z - Math.cos(p.yaw) * 2.6;
        const yaw = Math.atan2(p.pos.x - x, p.pos.z - z);
        const r0 = placeBall(data, x, z, 0.62, yaw);
        if (r0.kind !== 'new') return r0.kind;
        placeBall(data, x, z, 0.46, yaw); placeBall(data, x, z, 0.32, yaw);
        const nd = typeof a === 'number' ? a : 6;
        for (let i = 0; i < nd; i++) { const sm = r0.sm; const st = nextDecor(sm, has); if (!st) break; if (st.take) wallet()?.take(st.take, 1); decorate(sm, st); }
        if (isFriend(r0.sm)) sh.stamp('snowman');
        save(); rebuild();
      }
      return { carrying: carry.on ? +carry.r.toFixed(3) : null, snowy: snowy(), snowmen: data.list.map((sm) => ({ x: +sm.x.toFixed(2), z: +sm.z.toFixed(2), balls: sm.balls.map((r) => +r.toFixed(2)), decor: { ...sm.decor }, friend: isFriend(sm) })), trail: trailN };
    },
    stats: () => ({ snowmen: data.list.length, rolling: carry.on ? 1 : 0 }),
    dispose() {
      for (const o of offs) o();
      for (const off of colliders) off();
      removeEventListener('keydown', onKey);
      ctx.scene.remove(root);
      balls.geometry.dispose(); trail.geometry.dispose(); trailMat.dispose();
      if (decor) decor.geometry.dispose();
    },
  };
}
