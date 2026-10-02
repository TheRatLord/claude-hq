/**
 * Wild visitors: shy, larger wildlife that rewards being in the right place at the right time (pure rhythm and
 * shyness in `wild.ts`, models in `wildModels.ts`, motion in `wildAnim.ts`).
 *
 *   deer      a doe and her fawn graze the edge of the woods near the rim at dawn and dusk; look up, then bound off
 *   fox       trots the hedgerows round a field after dark, stops to sniff and listen; eyes catch the lamplight
 *   heron     stands in the river shallows on mornings / late afternoons, stabs for fish; lifts off and lands downriver
 *   owl       sits on a standing stone on the north knoll at night, head following you round; hoots; flits stone to stone
 *   hedgehog  snuffles under the orchard trees on mild evenings; curls up when you come close, uncurls when you're still
 *   geese     greylags go over in a long V in autumn (south) and spring (north), mornings and evenings, honking
 *
 * Each visit's spot is seeded by the date. Getting a good look at one (in view, in range, not running) records a
 * sighting in the Collections book's field guide (`collection.sight`). One instanced draw per species, plus one for
 * the eyeshine glints after dark: ≤ 7 draws, only while something is about. Zero allocation per frame.
 *
 * Service 'wildlife' (`WildlifeService`): list(), summon(id, here?) for dev hooks and shots (`__valley.wildlife`).
 */
import * as THREE from 'three';
import type { FrameInfo, IndoorSpace, SceneCtx } from '../context.ts';
import { RIVER, SITES, STRUCTURES, WORLD, heightAt, siteToWorld, structure } from '../../world/map.ts';
import type { Structure } from '../../world/map.ts';
import { dayKey } from '../../model/almanac.ts';
import type { CollectionService } from '../../model/collection.ts';
import { seeded } from '../../../core/rng.ts';
import { ORCHARD, HAY, standingStones } from '../structures/countryside.ts';
import { RigPool } from './rig.ts';
import { body } from './critterAnim.ts';
import type { Legs } from './gait.ts';
import { glowTexture } from './models.ts';
import { DEER_LOOK, DEER_WINTER, FAWN_LOOK, deer as deerModel, fox as foxModel, goose as gooseModel, hedgehog as hogModel, heron as heronModel, owl as owlModel } from './wildModels.ts';
import { gooseFly, grazeNeck, heronFly, heronLift, heronStand, hogPose, owlFly, owlPerch, quadBody, quadHead, quadLegPose, quadLegs, quadRig, resetBody } from './wildAnim.ts';
import type { HeronPose, OwlPose, QuadHead } from './wildAnim.ts';
import { PACE, Shy, WILD, WILD_IDS, geesePass, sees, wildDay, wildVisiting } from './wild.ts';
import type { ShyState, WildDay, WildId } from './wild.ts';
import type { Activity } from './schedule.ts';
import { TAU, clamp, critterSound, damp, dampAngle, groundY, lerp, openGround, sampleSpots, smooth01, wrap } from './util.ts';
import type { Fx } from './util.ts';

export interface WildView { x: number; z: number; yaw: number; pitch: number }
export interface WildlifeService {
  /** what is about right now */
  list(): { id: WildId; on: boolean; state: string; x: number; z: number; visiting: boolean }[];
  /** bring a visitor out now (its habitat spot, calm) and return a viewpoint; `here`: in front of the camera instead */
  summon(id: WildId, here?: boolean): WildView | null;
  /** startle a visitor that's out (dev / shots: the flee, the take-off, the curl) */
  spook(id: WildId): void;
}

export interface Wildlife {
  update(f: FrameInfo, act: Activity): void;
  stats(): Record<string, number>;
  dispose(): void;
}

const CH = new Float32Array(12);
const BD = body();
const GROUND = new Float32Array(4);
const SCALE = { deer: 1, fawn: 0.62, fox: 1.15, heron: 1.15, owl: 1.25, hog: 1.5, goose: 1.3 };

function emit(pool: RigPool, x: number, y: number, z: number, yaw: number, s: number): number {
  const slot = pool.put(x, y + BD.y * s, z, yaw, BD.pitch, BD.roll, s * BD.sx, s * BD.sy, s * BD.sz,
    CH[0], CH[1], CH[2], CH[3], CH[4], CH[5], CH[6], CH[7]);
  pool.chC(slot, CH[8], CH[9], CH[10], CH[11]);
  return slot;
}

const toWorld = (s: Structure, lx: number, lz: number) => ({ x: s.x + lx * Math.cos(s.yaw) + lz * Math.sin(s.yaw), z: s.z - lx * Math.sin(s.yaw) + lz * Math.cos(s.yaw) });

/** a walker: position, heading, ground speed (world m/s) */
interface Mover { x: number; y: number; z: number; yaw: number; v: number; turn: number }
/** steer toward (tx, tz) at `want` m/s (easing in over the last `ease` metres); returns the remaining distance */
function steer(m: Mover, tx: number, tz: number, want: number, dt: number, rate = 3, ease = 1.2): number {
  const dx = tx - m.x, dz = tz - m.z, d = Math.hypot(dx, dz);
  const y0 = m.yaw;
  if (d > 0.05) m.yaw = dampAngle(m.yaw, Math.atan2(dx, dz), rate, dt);
  m.turn = dt > 0 ? wrap(m.yaw - y0) / dt : 0;
  const face = Math.max(0, Math.cos(wrap(Math.atan2(dx, dz) - m.yaw)));
  m.v = damp(m.v, want * clamp(d / ease, 0, 1) * (0.35 + 0.65 * face), want > 3 ? 4 : 2.5, dt);
  m.x += Math.sin(m.yaw) * m.v * dt; m.z += Math.cos(m.yaw) * m.v * dt;
  return d;
}
function stop(m: Mover, dt: number): void {
  m.v = damp(m.v, 0, 4, dt); m.turn = 0;
  m.x += Math.sin(m.yaw) * m.v * dt; m.z += Math.cos(m.yaw) * m.v * dt;
}

export function createWildlife(ctx: SceneCtx, fx: Fx): Wildlife {
  const rng = seeded('life:wild');
  const player = ctx.player.pos;
  const cam = ctx.camera;
  const W = WORLD.water;
  const fwd = new THREE.Vector3();
  const book = () => ctx.services.get('collection') as CollectionService | undefined;
  const indoors = () => (ctx.services.get('indoors') as IndoorSpace | undefined)?.active ?? false;

  // ------------------------------------------------------------------ pools
  const mk = (m: { geo: THREE.BufferGeometry; spec: import('./rig.ts').RigSpec }, n: number) => { const p = new RigPool(m.geo, m.spec, n); p.mesh.castShadow = true; return p; };
  const dm = deerModel(), fm = foxModel();
  const deerPool = mk(dm, 2), foxPool = mk(fm, 1), heronPool = mk(heronModel(), 1), owlPool = mk(owlModel(), 1), hogPool = mk(hogModel(), 1);
  const gm = gooseModel();
  const goosePool = new RigPool(gm.geo, gm.spec, 9);
  const pools = [deerPool, foxPool, heronPool, owlPool, hogPool, goosePool];
  const deerRig = quadRig(dm.dims), foxRig = quadRig(fm.dims);
  // eyeshine: soft additive glints, one draw
  const EYES = 8;
  const eyeMat = new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const eyes = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), eyeMat, EYES);
  eyes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(EYES * 3), 3);
  eyes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  eyes.frustumCulled = false; eyes.count = 0; eyes.name = 'life:eyeshine'; eyes.renderOrder = 2;
  ctx.scene.add(...pools.map((p) => p.mesh), eyes);
  let nEyes = 0;
  const em = new THREE.Matrix4(), ep = new THREE.Vector3(), es = new THREE.Vector3(), ec = new THREE.Color();
  const eyeT = { x: 0, y: 0, z: 0 };
  /** model-space point → world (head pitch about pivot, then head yaw, then the body's yaw / scale / position) */
  function headPoint(lx: number, ly: number, lz: number, px: number, py: number, pz: number, pitch: number, hyaw: number, x: number, y: number, z: number, yaw: number, s: number) {
    let dy = ly - py, dz = lz - pz, dx = lx - px;
    const c = Math.cos(pitch), sn = Math.sin(pitch);
    const ny = dy * c - dz * sn, nz = dy * sn + dz * c; dy = ny; dz = nz;
    const cy = Math.cos(hyaw), sy = Math.sin(hyaw);
    const nx = dx * cy + dz * sy, nz2 = -dx * sy + dz * cy; dx = nx; dz = nz2;
    const mx = (px + dx) * s, my = (py + dy) * s, mz = (pz + dz) * s;
    const cb = Math.cos(yaw), sb = Math.sin(yaw);
    eyeT.x = x + mx * cb + mz * sb; eyeT.y = y + my; eyeT.z = z - mx * sb + mz * cb;
  }
  /** a pair of glints at the eyes when the head faces the camera after dark (lamplight caught in the tapetum) */
  function eyeshine(ex: number, ey: number, ez: number, px: number, py: number, pz: number, pitch: number, hyaw: number, x: number, y: number, z: number, yaw: number, s: number, r: number, g: number, b: number) {
    const night = ctx.lighting.night;
    if (night < 0.25 || nEyes > EYES - 2) return;
    const fy = yaw + hyaw;
    const tx = cam.position.x - x, tz = cam.position.z - z, d = Math.hypot(tx, tz);
    if (d > 55 || d < 0.5) return;
    const face = Math.max(0, (Math.sin(fy) * tx + Math.cos(fy) * tz) / d);
    const k = Math.pow(face, 3) * smooth01((night - 0.25) / 0.4) * (1 - smooth01((d - 30) / 25)) * (0.45 + 0.55 * smooth01((d - 3) / 10));
    if (k < 0.03) return;
    for (let side = 1; side >= -1; side -= 2) {
      headPoint(ex * side, ey, ez, px, py, pz, pitch, hyaw, x, y, z, yaw, s);
      const size = (0.12 + d * 0.007) * (0.6 + 0.4 * k);
      // a little proud of the eye, toward the camera, so the eyeball doesn't hide it
      em.compose(ep.set(eyeT.x + (tx / d) * 0.06 * s, eyeT.y, eyeT.z + (tz / d) * 0.06 * s), cam.quaternion, es.set(size, size, size));
      eyes.setMatrixAt(nEyes, em);
      eyes.setColorAt(nEyes, ec.setRGB(r * k, g * k, b * k));
      nEyes++;
    }
  }

  // ------------------------------------------------------------------ shared state
  const day = { key: '', recheck: 0 };
  const plans = {} as Record<WildId, WildDay>;
  const shy = {} as Record<WildId, Shy>;
  const seenT = {} as Record<WildId, number>;
  const sighted = {} as Record<WildId, string>;
  /** summoned: visiting regardless of the clock for this many seconds */
  const forced = {} as Record<WildId, number>;
  /** just summoned: ignores you for a few seconds (shots at close range) */
  const tame = {} as Record<WildId, number>;
  for (const id of WILD_IDS) { shy[id] = new Shy(); seenT[id] = 0; sighted[id] = ''; forced[id] = 0; tame[id] = 0; }
  const clock = { hour: 12, season: 'summer' as import('../../model/types.ts').Season, weather: 'clear' as import('../../model/types.ts').WeatherKind };
  const visiting = (id: WildId, act: Activity) => forced[id] > 0 || (!act.shelter && wildVisiting(plans[id], clock.hour, clock.season, clock.weather));
  const pdist = (x: number, z: number) => Math.hypot(player.x - x, player.z - z);
  /** cosine between the view direction and the direction to a point (−1 when behind) */
  const viewCos = (x: number, y: number, z: number) => {
    const dx = x - cam.position.x, dy = y - cam.position.y, dz = z - cam.position.z, l = Math.hypot(dx, dy, dz) || 1;
    return (dx * fwd.x + dy * fwd.y + dz * fwd.z) / l;
  };
  const inView = (x: number, y: number, z: number, range: number) => viewCos(x, y, z) > 0.55 && Math.hypot(x - cam.position.x, z - cam.position.z) < range;
  /** step the shyness, and the field guide: a good look for ~0.8 s records a sighting (once a day) */
  function watch(id: WildId, x: number, y: number, z: number, dt: number, stateForSight?: ShyState): ShyState {
    const s = WILD[id];
    const d = tame[id] > 0 ? Math.max(pdist(x, z), s.notice * 2) : pdist(x, z);
    const st = s.notice > 0 ? shy[id].step(dt, d, ctx.player.speed, s) : 'calm';
    const look = !indoors() && sees(Math.hypot(x - cam.position.x, y - cam.position.y, z - cam.position.z), viewCos(x, y, z), stateForSight ?? st, s.sight);
    seenT[id] = look ? seenT[id] + dt : Math.max(0, seenT[id] - dt * 0.5);
    if (seenT[id] > 0.8 && sighted[id] !== day.key) {
      sighted[id] = day.key;
      try { book()?.sight(id); } catch (e) { console.error('[life] sighting', e); }
    }
    return st;
  }

  // ------------------------------------------------------------------ habitats (computed once)
  // the meadow just in front of the woods: out toward the rim, but on open, gentle ground
  const floraBlocked = (x: number, z: number, r: number) => (ctx.services.get('floraSolids') as { blocked(x: number, z: number, r: number): boolean } | undefined)?.blocked(x, z, r) ?? false;
  const deerSpots = sampleSpots(7, 96, 6, 60, rng, 12).filter((p) => { const r = Math.hypot(p.x, p.z); return r > 58 && r < 86 && !floraBlocked(p.x, p.z, 3); });
  const nearStructure = (x: number, z: number, pad: number) => STRUCTURES.some((s) => Math.hypot(x - s.x, z - s.z) < Math.max(s.size[0], s.size[1]) / 2 + pad);
  const heronSpots: { x: number; z: number; yaw: number }[] = [];
  for (let i = 0; i < RIVER.length - 1; i++) {
    const a = RIVER[i], b = RIVER[i + 1], len = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
    for (let t = 3; t < len; t += 7) {
      for (const side of [1, -1]) {
        for (const o of [2.2, 2.8, 3.3]) {
          const x = a.x + ux * t - uz * o * side, z = a.z + uz * t + ux * o * side;
          const h = heightAt(x, z);
          if (Math.hypot(x, z) > 112 || h > W - 0.04 || h < W - 0.42 || nearStructure(x, z, 5)) continue;
          heronSpots.push({ x, z, yaw: Math.atan2(ux, uz) + (side > 0 ? 0.6 : -0.6) });
          break;
        }
      }
    }
  }
  const orchard = structure('orchard');
  const trees = ORCHARD.trees.map((t) => toWorld(orchard, t.x, t.z));
  // owl perches: the tops of the standing stones (and the hay bales), found by raycasting the built nooks once
  const perches: { x: number; y: number; z: number; out: number }[] = [];
  let perchTry = 0;
  const ray = new THREE.Raycaster();
  function findPerches(): void {
    if (perches.length || perchTry > 4) return;
    perchTry++;
    const hits: THREE.Intersection[] = [];
    // the nooks are baked into the structures' merged meshes: ray the whole set (once)
    const g = ctx.scene.getObjectByName('structures');
    if (!g) return;
    const scan = (_name: string, s: Structure, pts: { x: number; z: number }[], minH: number) => {
      for (const p of pts) {
        const w = toWorld(s, p.x, p.z);
        ray.set(ep.set(w.x, heightAt(w.x, w.z) + 8, w.z), es.set(0, -1, 0));
        hits.length = 0;
        ray.intersectObject(g, true, hits);
        const h = hits.find((x) => (x.object as THREE.Mesh).isMesh);
        if (h && h.point.y > heightAt(w.x, w.z) + minH) perches.push({ x: w.x, y: h.point.y, z: w.z, out: Math.atan2(w.x - s.x, w.z - s.z) });
      }
    };
    const st = structure('stones');
    scan('stones', st, standingStones().map((p) => ({ x: p.x * 0.97, z: p.z * 0.97 })), 1.4);
    scan('haymeadow', structure('haymeadow'), HAY.bales.map((b) => ({ x: b.x, z: b.z })), 0.6);
  }

  // ------------------------------------------------------------------ deer (a doe and her fawn)
  type DMode = 'graze' | 'walk' | 'alert' | 'flee' | 'leave';
  interface Deer extends Mover { legs: Legs; head: QuadHead; ph: number }
  const doe: Deer = { x: 0, y: 0, z: 0, yaw: 0, v: 0, turn: 0, legs: quadLegs(deerRig), head: { neck: 0, yaw: 0, ears: 0, tail: 0 }, ph: 0.3 };
  const fawn: Deer = { x: 0, y: 0, z: 0, yaw: 0, v: 0, turn: 0, legs: quadLegs(deerRig), head: { neck: 0, yaw: 0, ears: 0, tail: 0 }, ph: 0.7 };
  const D = { on: false, mode: 'graze' as DMode, ax: 0, az: 0, tx: 0, tz: 0, timer: 0, cool: 0, flushes: 0 };
  function deerAt(x: number, z: number, yaw: number) {
    D.on = true; D.mode = 'graze'; D.ax = x; D.az = z; D.timer = 3 + rng() * 6;
    doe.x = x; doe.z = z; doe.yaw = yaw; doe.v = 0; doe.legs.reset();
    fawn.x = x - Math.sin(yaw) * 1.4 + Math.cos(yaw) * 1; fawn.z = z - Math.cos(yaw) * 1.4 - Math.sin(yaw) * 1; fawn.yaw = yaw + 0.5; fawn.v = 0; fawn.legs.reset();
    shy.deer.reset();
  }
  function pickAway(m: Mover, dist: number, out: { x: number; z: number }, bias = 0): boolean {
    const away = Math.atan2(m.x - player.x, m.z - player.z);
    // lean toward the rim (the woods)
    const rim = Math.atan2(m.x, m.z);
    const dir = away + clamp(wrap(rim - away), -0.7, 0.7) * bias;
    for (let k = 0; k < 9; k++) {
      const a = dir + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.35;
      const x = m.x + Math.sin(a) * dist, z = m.z + Math.cos(a) * dist;
      if (Math.hypot(x, z) > 118 || heightAt(x, z) < W + 0.2 || !openGround(ctx, x, z, 0.5) || !openGround(ctx, (x + m.x) / 2, (z + m.z) / 2, 0.5)) continue;
      out.x = x; out.z = z; return true;
    }
    return false;
  }
  const tmp = { x: 0, z: 0 };
  function poseDeer(m: Deer, s: number, dt: number, fold: number): void {
    m.legs.update(dt, m.v / s, m.turn);
    CH.fill(0); resetBody(BD);
    // feet on the slope: terrain under each neutral foot relative to the body origin
    const sy = Math.sin(m.yaw), cy = Math.cos(m.yaw);
    for (let i = 0; i < 4; i++) {
      const nz = deerRig.neutral[i][1] * s;
      GROUND[i] = (groundY(ctx, m.x + sy * nz, m.z + cy * nz) - m.y) / s;
    }
    BD.pitch = -Math.atan2((GROUND[0] + GROUND[1] - GROUND[2] - GROUND[3]) / 2, deerRig.neutral[0][1] - deerRig.neutral[2][1]) * 0.7;
    BD.y = (GROUND[0] + GROUND[1] + GROUND[2] + GROUND[3]) / 4 * 0.6;
    quadBody(m.legs, BD);
    quadLegPose(deerRig, m.legs, BD, CH, fold, GROUND);
    quadHead(m.head, CH);
  }
  function updateDeer(dt: number, t: number, act: Activity) {
    const want = visiting('deer', act);
    D.cool -= dt;
    if (!D.on) {
      if (!want || D.cool > 0 || !deerSpots.length) return;
      // arrive out of sight: the day's spot, or the next free one
      const base = (D.flushes ? plans.deer.alt : plans.deer.spot) % deerSpots.length;
      for (let k = 0; k < deerSpots.length; k++) {
        const p = deerSpots[(base + k * 3) % deerSpots.length];
        const y = groundY(ctx, p.x, p.z);
        if (pdist(p.x, p.z) < 32 || inView(p.x, y + 1, p.z, 80) || !openGround(ctx, p.x, p.z, 0.6)) continue;
        deerAt(p.x, p.z, rng() * TAU);
        break;
      }
      if (!D.on) { D.cool = 5; return; }
    }
    doe.y = groundY(ctx, doe.x, doe.z);
    const st = watch('deer', doe.x, doe.y + 1, doe.z, dt);
    const away = Math.atan2(doe.x - player.x, doe.z - player.z);
    const look = clamp(wrap(away + Math.PI - doe.yaw), -1.1, 1.1);
    if (D.mode !== 'flee' && st === 'flee') {
      D.mode = 'flee'; D.flushes++;
      critterSound(ctx, 'snort', doe.x, doe.y + 1.1, doe.z, 45, 1);
      if (!pickAway(doe, 45, tmp, 0.8)) { tmp.x = doe.x + Math.sin(away) * 40; tmp.z = doe.z + Math.cos(away) * 40; }
      D.tx = tmp.x; D.tz = tmp.z;
    } else if (D.mode !== 'flee' && D.mode !== 'leave') {
      if (!want) { D.mode = 'leave'; if (pickAway(doe, 40, tmp, 1)) { D.tx = tmp.x; D.tz = tmp.z; } }
      else if (st === 'alert') D.mode = 'alert';
      else if (D.mode === 'alert') { D.mode = 'graze'; D.timer = 2 + rng() * 3; }
    }
    const h = doe.head;
    switch (D.mode) {
      case 'graze': {
        stop(doe, dt);
        D.timer -= dt;
        h.neck = damp(h.neck, grazeNeck(t, doe.ph, h), 4, dt);
        h.ears = damp(h.ears, 0.05 + Math.max(0, Math.sin(t * 1.7)) * 0.15, 6, dt); h.tail = damp(h.tail, 0.05, 4, dt);
        if (D.timer <= 0) {
          // amble to a new patch near the anchor
          for (let k = 0; k < 6; k++) {
            const a = rng() * TAU, r = 1.5 + rng() * 4;
            const x = D.ax + Math.sin(a) * r, z = D.az + Math.cos(a) * r;
            if (openGround(ctx, x, z, 0.5)) { D.tx = x; D.tz = z; D.mode = 'walk'; break; }
          }
          D.timer = 6 + rng() * 10;
        }
        break;
      }
      case 'walk': {
        const d = steer(doe, D.tx, D.tz, 0.55, dt, 2);
        h.neck = damp(h.neck, 0.3 + Math.sin(t * 2.2) * 0.04, 3, dt); h.yaw = damp(h.yaw, 0, 3, dt); h.ears = damp(h.ears, 0.15, 4, dt);
        if (d < 0.3) { D.mode = 'graze'; D.timer = 5 + rng() * 9; }
        break;
      }
      case 'alert':
        stop(doe, dt);
        h.neck = damp(h.neck, -0.2, 5, dt); h.yaw = damp(h.yaw, look, 4, dt); h.ears = damp(h.ears, 0.35 + Math.sin(t * 6) * 0.05 * shy.deer.nerves, 8, dt);
        h.tail = damp(h.tail, 0.25 + shy.deer.nerves * 0.6, 5, dt);
        break;
      case 'flee': case 'leave': {
        const run = D.mode === 'flee';
        const d = steer(doe, D.tx, D.tz, run ? 7.5 : 0.9, dt, run ? 4 : 2, 3);
        h.neck = damp(h.neck, run ? -0.1 : 0.3, 5, dt); h.yaw = damp(h.yaw, 0, 5, dt); h.ears = damp(h.ears, run ? -0.5 : 0.1, 6, dt); h.tail = damp(h.tail, run ? 1.3 : 0.1, 8, dt);
        const gone = pdist(doe.x, doe.z) > 45 && !inView(doe.x, doe.y + 1, doe.z, 70);
        if (gone || pdist(doe.x, doe.z) > 90) { D.on = false; D.cool = run ? 240 + rng() * 120 : 600; break; }
        if (d < 3) { if (pickAway(doe, 35, tmp, 1)) { D.tx = tmp.x; D.tz = tmp.z; } }
        break;
      }
    }
    // the fawn keeps to her flank, mirrors her mood, and runs with her
    const fx0 = doe.x - Math.sin(doe.yaw) * 1.3 + Math.cos(doe.yaw) * 0.9, fz0 = doe.z - Math.cos(doe.yaw) * 1.3 - Math.sin(doe.yaw) * 0.9;
    const fd = Math.hypot(fx0 - fawn.x, fz0 - fawn.z);
    const fh = fawn.head;
    if (fd > 0.4) steer(fawn, fx0, fz0, Math.min(8.5, doe.v * 1.15 + fd * 0.8), dt, 4, 0.8);
    else { stop(fawn, dt); fawn.yaw = dampAngle(fawn.yaw, doe.yaw + 0.3, 1, dt); }
    fawn.y = groundY(ctx, fawn.x, fawn.z);
    if (D.mode === 'graze') { fh.neck = damp(fh.neck, grazeNeck(t + 3, fawn.ph, fh) * 0.9, 4, dt); fh.ears = damp(fh.ears, 0.25, 4, dt); }
    else if (D.mode === 'alert') { fh.neck = damp(fh.neck, -0.3, 5, dt); fh.yaw = damp(fh.yaw, clamp(wrap(Math.atan2(player.x - fawn.x, player.z - fawn.z) - fawn.yaw), -1.1, 1.1), 4, dt); fh.ears = damp(fh.ears, 0.5, 6, dt); }
    else { fh.neck = damp(fh.neck, 0.1, 4, dt); fh.yaw = damp(fh.yaw, 0, 4, dt); fh.ears = damp(fh.ears, D.mode === 'flee' ? -0.5 : 0.2, 6, dt); }
    fh.tail = damp(fh.tail, D.mode === 'flee' ? 1.2 : 0.1 + Math.max(0, Math.sin(t * 5)) * 0.2, 6, dt);
    if (!D.on) return;
    // draw
    drawDeer(doe, SCALE.deer, DEER_LOOK, dt);
    drawDeer(fawn, SCALE.fawn, FAWN_LOOK, dt);
  }
  function drawDeer(m: Deer, s: number, look: typeof DEER_LOOK, dt: number): void {
    if (pdist(m.x, m.z) > 140) return;
    const w = clock.season === 'winter' ? DEER_WINTER : null;
    poseDeer(m, s, dt, 0);
    const slot = emit(deerPool, m.x, m.y, m.z, m.yaw, s);
    deerPool.tintAt(slot, look[0][0] * (w ? w[0] : 1), look[0][1] * (w ? w[1] : 1), look[0][2] * (w ? w[2] : 1));
    deerPool.tint2At(slot, look[1][0], look[1][1], look[1][2]);
    fx.shadow(m.x, m.y, m.z, 0.42 * s, 2.0, m.yaw);
    eyeshine(0.07, 1.18, 0.515, 0, 0.86, 0.28, m.head.neck, m.head.yaw, m.x, m.y + BD.y * s, m.z, m.yaw, s, 0.7, 1.4, 0.9);
  }

  // ------------------------------------------------------------------ fox
  type FMode = 'trot' | 'pause' | 'alert' | 'flee' | 'leave';
  const fox: Deer = { x: 0, y: 0, z: 0, yaw: 0, v: 0, turn: 0, legs: quadLegs(foxRig), head: { neck: 0, yaw: 0, ears: 0, tail: 0 }, ph: 0 };
  const route: { x: number; z: number }[] = [];
  for (let i = 0; i < 8; i++) route.push({ x: 0, z: 0 });
  const F = { on: false, mode: 'trot' as FMode, wp: 0, dir: 1, timer: 0, cool: 0, sniff: 0, yipIn: 20, tx: 0, tz: 0, flushes: 0 };
  function foxRoute(site: number): void {
    const s = SITES[site % SITES.length];
    const hx = s.w / 2 + 3.2, hz = s.d / 2 + 3.2;
    const pts: [number, number][] = [[-hx, -hz], [0, -hz - 0.6], [hx, -hz], [hx + 0.6, 0], [hx, hz], [0, hz + 0.6], [-hx, hz], [-hx - 0.6, 0]];
    pts.forEach(([lx, lz], i) => { const w = siteToWorld(s, lx, lz); route[i].x = w.x; route[i].z = w.z; });
  }
  function updateFox(dt: number, t: number, act: Activity) {
    const want = visiting('fox', act);
    F.cool -= dt;
    if (!F.on) {
      if (!want || F.cool > 0) return;
      const base = (F.flushes ? plans.fox.alt : plans.fox.spot) % SITES.length;
      for (let k = 0; k < SITES.length; k++) {
        foxRoute(base + k * 7);
        const i = Math.floor(rng() * 8), p = route[i];
        if (pdist(p.x, p.z) < 25 || inView(p.x, groundY(ctx, p.x, p.z) + 0.4, p.z, 60) || !openGround(ctx, p.x, p.z, 0.3)) continue;
        F.on = true; F.mode = 'trot'; F.wp = (i + 1) % 8; F.dir = rng() < 0.5 ? 1 : -1;
        fox.x = p.x; fox.z = p.z; fox.v = 0; fox.legs.reset(); fox.yaw = Math.atan2(route[F.wp].x - p.x, route[F.wp].z - p.z);
        shy.fox.reset();
        break;
      }
      if (!F.on) { F.cool = 5; return; }
    }
    fox.y = groundY(ctx, fox.x, fox.z);
    const st = watch('fox', fox.x, fox.y + 0.4, fox.z, dt);
    const h = fox.head;
    const toP = wrap(Math.atan2(player.x - fox.x, player.z - fox.z) - fox.yaw);
    if (F.mode !== 'flee' && st === 'flee') {
      F.mode = 'flee'; F.flushes++;
      if (!pickAway(fox, 40, tmp, 0.2)) { const a = Math.atan2(fox.x - player.x, fox.z - player.z); tmp.x = fox.x + Math.sin(a) * 35; tmp.z = fox.z + Math.cos(a) * 35; }
      F.tx = tmp.x; F.tz = tmp.z;
    } else if (F.mode !== 'flee' && F.mode !== 'leave') {
      if (!want) { F.mode = 'leave'; if (pickAway(fox, 40, tmp, 1)) { F.tx = tmp.x; F.tz = tmp.z; } }
      else if (st === 'alert') F.mode = 'alert';
      else if (F.mode === 'alert') { F.mode = 'pause'; F.timer = 1.5; F.sniff = 0; }
    }
    switch (F.mode) {
      case 'trot': {
        const p = route[F.wp];
        const d = steer(fox, p.x, p.z, 1.8, dt, 3, 0.5);
        h.neck = damp(h.neck, 0.4 + Math.sin(t * 1.3) * 0.05, 4, dt); h.yaw = damp(h.yaw, Math.sin(t * 0.7) * 0.15, 3, dt); h.ears = damp(h.ears, 0.5, 4, dt); h.tail = damp(h.tail, -0.15, 4, dt);
        if (d < 0.8) {
          F.wp = (F.wp + F.dir + 8) % 8;
          if (rng() < 0.4) { F.mode = 'pause'; F.timer = 2 + rng() * 4; F.sniff = rng() < 0.6 ? 1 : 0; }
        }
        break;
      }
      case 'pause':
        stop(fox, dt);
        F.timer -= dt;
        h.neck = damp(h.neck, F.sniff ? 0.95 + Math.max(0, Math.sin(t * 9)) * 0.08 : -0.15, 5, dt);
        h.yaw = damp(h.yaw, F.sniff ? Math.sin(t * 0.8) * 0.35 : Math.sin(t * 0.5) * 0.7, 3, dt);
        h.ears = damp(h.ears, F.sniff ? 0.4 : 0.9, 6, dt); h.tail = damp(h.tail, -0.3, 4, dt);
        if (F.timer <= 0) F.mode = 'trot';
        break;
      case 'alert':
        stop(fox, dt);
        h.neck = damp(h.neck, -0.25, 6, dt); h.yaw = damp(h.yaw, clamp(toP, -1.2, 1.2), 5, dt); h.ears = damp(h.ears, 1, 8, dt); h.tail = damp(h.tail, 0.05, 4, dt);
        break;
      case 'flee': case 'leave': {
        const run = F.mode === 'flee';
        const d = steer(fox, F.tx, F.tz, run ? 6.5 : 1.6, dt, run ? 5 : 3, 2);
        h.neck = damp(h.neck, run ? 0.25 : 0.4, 5, dt); h.yaw = damp(h.yaw, 0, 5, dt); h.ears = damp(h.ears, run ? -0.6 : 0.4, 6, dt); h.tail = damp(h.tail, run ? 0.1 : -0.15, 5, dt);
        if ((pdist(fox.x, fox.z) > 35 && !inView(fox.x, fox.y + 0.4, fox.z, 60)) || pdist(fox.x, fox.z) > 80) { F.on = false; F.cool = run ? 150 + rng() * 120 : 600; return; }
        if (d < 2 && pickAway(fox, 30, tmp, 0.5)) { F.tx = tmp.x; F.tz = tmp.z; }
        break;
      }
    }
    // a yip now and then in the dark
    F.yipIn -= dt;
    if (F.yipIn <= 0) { F.yipIn = 25 + rng() * 40; if (F.mode !== 'flee') critterSound(ctx, 'yip', fox.x, fox.y + 0.5, fox.z, 50, 0.8, 0.95 + rng() * 0.15); }
    if (pdist(fox.x, fox.z) > 140) return;
    const s = SCALE.fox;
    fox.legs.update(dt, fox.v / s, fox.turn);
    CH.fill(0); resetBody(BD);
    quadBody(fox.legs, BD);
    quadLegPose(foxRig, fox.legs, BD, CH);
    quadHead(h, CH);
    emit(foxPool, fox.x, fox.y, fox.z, fox.yaw, s);
    fx.shadow(fox.x, fox.y, fox.z, 0.22 * s, 2.2, fox.yaw);
    eyeshine(0.045, 0.49, 0.325, 0, 0.4, 0.2, h.neck, h.yaw, fox.x, fox.y + BD.y * s, fox.z, fox.yaw, s, 0.9, 1.6, 0.5);
  }

  // ------------------------------------------------------------------ heron
  type HMode = 'stand' | 'wade' | 'strike' | 'alert' | 'takeoff' | 'fly' | 'land' | 'leave';
  const H = { on: false, mode: 'stand' as HMode, x: 0, y: 0, z: 0, yaw: 0, t: 0, timer: 0, cool: 0, flushes: 0, fx: 0, fy: 0, fz: 0, tx: 0, ty: 0, tz: 0, dur: 1, ph: 0, wade: 0, catch: 0 };
  const hp: HeronPose = { reach: 0.2, strike: 0, yaw: 0, stride: -1, crest: 0 };
  const heronY = (x: number, z: number) => Math.max(heightAt(x, z), W - 0.28);
  function heronTo(spot: number): boolean {
    for (let k = 0; k < heronSpots.length; k++) {
      const p = heronSpots[(spot + k * 5) % heronSpots.length];
      if (pdist(p.x, p.z) < 40) continue;
      H.tx = p.x; H.tz = p.z; H.ty = heronY(p.x, p.z);
      return true;
    }
    return false;
  }
  function updateHeron(dt: number, t: number, act: Activity) {
    const want = visiting('heron', act);
    H.cool -= dt;
    if (!H.on) {
      if (!want || H.cool > 0 || !heronSpots.length) return;
      const base = plans.heron.spot % heronSpots.length;
      for (let k = 0; k < heronSpots.length; k++) {
        const p = heronSpots[(base + k * 5) % heronSpots.length];
        const y = heronY(p.x, p.z);
        if (pdist(p.x, p.z) < 35 || inView(p.x, y + 0.8, p.z, 90)) continue;
        H.on = true; H.mode = 'stand'; H.x = p.x; H.z = p.z; H.y = y; H.yaw = p.yaw; H.timer = 4 + rng() * 8; shy.heron.reset();
        break;
      }
      if (!H.on) { H.cool = 5; return; }
    }
    const flying = H.mode === 'takeoff' || H.mode === 'fly' || H.mode === 'land' || H.mode === 'leave';
    const st = watch('heron', H.x, H.y + 0.8, H.z, flying ? 0 : dt, flying ? 'calm' : undefined);
    const toP = wrap(Math.atan2(player.x - H.x, player.z - H.z) - H.yaw);
    if (!flying && st === 'flee') {
      H.flushes++;
      H.mode = 'takeoff'; H.t = 0; H.fx = H.x; H.fy = H.y; H.fz = H.z;
      critterSound(ctx, 'caw', H.x, H.y + 1, H.z, 60, 1, 0.55);
      critterSound(ctx, 'flap', H.x, H.y + 1, H.z, 40, 1, 0.6);
      const leaving = H.flushes >= 3 || !want;
      if (leaving || !heronTo(plans.heron.alt + H.flushes * 11)) { H.tx = H.x + Math.sin(H.yaw) * 120; H.tz = H.z + Math.cos(H.yaw) * 120; H.ty = H.y + 25; H.flushes = 99; }
    } else if (!flying && !want) {
      H.mode = 'takeoff'; H.t = 0; H.fx = H.x; H.fy = H.y; H.fz = H.z; H.flushes = 99;
      H.tx = H.x - Math.sin(H.yaw) * 120; H.tz = H.z - Math.cos(H.yaw) * 120; H.ty = H.y + 25;
    } else if (!flying) {
      if (st === 'alert' && H.mode !== 'strike') H.mode = 'alert';
      else if (st === 'calm' && H.mode === 'alert') { H.mode = 'stand'; H.timer = 3 + rng() * 5; }
    }
    H.t += dt;
    let air = 0;
    switch (H.mode) {
      case 'stand':
        H.timer -= dt;
        hp.reach = damp(hp.reach, 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * 0.15 + 2)), 1.5, dt);
        hp.yaw = damp(hp.yaw, Math.sin(t * 0.21) * 0.35, 1.5, dt); hp.crest = damp(hp.crest, 0, 2, dt); hp.stride = -1; hp.strike = 0;
        if (H.timer <= 0) {
          if (rng() < 0.6) { H.mode = 'strike'; H.t = 0; H.catch = rng() < 0.4 ? 1 : 0; }
          else { H.mode = 'wade'; H.t = 0; H.wade = 1.2 + rng() * 2; H.yaw += (rng() - 0.5) * 1.2; }
          H.timer = 6 + rng() * 12;
        }
        break;
      case 'strike': {
        // lean in, freeze, stab, (maybe) a wriggling catch tossed back
        hp.reach = damp(hp.reach, 1, 4, dt); hp.yaw = damp(hp.yaw, 0, 3, dt);
        const k = H.t - 1.4;
        hp.strike = k > 0 && k < 0.5 ? Math.sin(k / 0.5 * Math.PI) : 0;
        if (k > 0.2 && k - dt <= 0.2) {
          const bx = H.x + Math.sin(H.yaw) * 0.45 * SCALE.heron, bz = H.z + Math.cos(H.yaw) * 0.45 * SCALE.heron;
          fx.ring(bx, W, bz, 0.5, 1.4); fx.drops(bx, W + 0.05, bz, 6, 1.2, 0.35, W - 0.05, rng);
          critterSound(ctx, 'fish', bx, W, bz, 30, 0.6, 1.2);
        }
        if (k > 0.5 && H.catch) { hp.reach = damp(hp.reach, 0.2, 3, dt); hp.crest = Math.sin(t * 20) * 0.3; }
        if (H.t > (H.catch ? 3.2 : 2.3)) { H.mode = 'stand'; H.timer = 5 + rng() * 10; }
        break;
      }
      case 'wade': {
        hp.reach = damp(hp.reach, 0.85, 2, dt); hp.stride = H.t * 0.35; hp.strike = 0;
        const v = 0.16 * Math.max(0, Math.sin(H.t * 0.35 * TAU * 2));
        const nx = H.x + Math.sin(H.yaw) * v * dt, nz = H.z + Math.cos(H.yaw) * v * dt;
        const h = heightAt(nx, nz);
        if (h < W - 0.04 && h > W - 0.45) { H.x = nx; H.z = nz; H.y = damp(H.y, heronY(nx, nz), 4, dt); } else H.yaw += dt * 0.8;
        if (H.t * 0.35 > H.wade) { H.mode = 'stand'; hp.stride = -1; }
        break;
      }
      case 'alert':
        hp.reach = damp(hp.reach, 1, 4, dt); hp.crest = damp(hp.crest, 0.7, 4, dt); hp.yaw = damp(hp.yaw, clamp(toP, -1.4, 1.4), 3, dt); hp.stride = -1; hp.strike = 0;
        break;
      case 'takeoff': {
        // a crouch and a couple of heavy beats, rising over the water toward where it's going
        const k = clamp(H.t / 1.3, 0, 1);
        H.yaw = dampAngle(H.yaw, Math.atan2(H.tx - H.x, H.tz - H.z), 2.5, dt);
        H.x += Math.sin(H.yaw) * 2.2 * k * dt; H.z += Math.cos(H.yaw) * 2.2 * k * dt;
        H.y = H.fy + smooth01(k) * 1.4;
        air = k;
        if (k >= 1) { H.mode = 'fly'; H.t = 0; H.fx = H.x; H.fy = H.y; H.fz = H.z; H.dur = Math.max(2, Math.hypot(H.tx - H.x, H.tz - H.z) / 6); }
        break;
      }
      case 'fly': {
        const k = clamp(H.t / H.dur, 0, 1), e = smooth01(k);
        H.x = lerp(H.fx, H.tx, e); H.z = lerp(H.fz, H.tz, e);
        H.y = lerp(H.fy, H.ty + (H.flushes >= 99 ? 0 : 1.2), e) + Math.sin(k * Math.PI) * (H.flushes >= 99 ? 6 : 3.5);
        H.yaw = dampAngle(H.yaw, Math.atan2(H.tx - H.fx, H.tz - H.fz), 3, dt);
        if (H.flushes >= 99 && pdist(H.x, H.z) > 60 && !inView(H.x, H.y, H.z, 120)) { H.on = false; H.cool = 900; H.flushes = 0; return; }
        if (k >= 1) { if (H.flushes >= 99) { H.on = false; H.cool = 900; H.flushes = 0; return; } H.mode = 'land'; H.t = 0; H.fy = H.y; }
        break;
      }
      case 'land': {
        const k = clamp(H.t / 1.1, 0, 1);
        H.y = lerp(H.fy, H.ty, smooth01(k));
        air = 1 - k;
        if (k >= 1) { H.mode = 'stand'; H.timer = 4 + rng() * 6; shy.heron.reset(); }
        break;
      }
    }
    if (pdist(H.x, H.z) > 160) return;
    H.ph += dt * 1.7;
    if (H.mode === 'fly') heronFly(H.ph, t, 0.25 + 0.25 * Math.sin(t * 0.6), CH, BD);
    else if (H.mode === 'takeoff' || H.mode === 'land') heronLift(H.ph * 1.6, air, CH, BD);
    else heronStand(t, hp, CH, BD);
    emit(heronPool, H.x, H.y, H.z, H.yaw, SCALE.heron);
    if (!flying) fx.shadow(H.x, Math.max(H.y, W), H.z, 0.25, 1.6, H.yaw);
  }

  // ------------------------------------------------------------------ owl
  type OMode = 'perch' | 'alert' | 'turn' | 'fly';
  const O = { on: false, mode: 'perch' as OMode, perch: 0, x: 0, y: 0, z: 0, yaw: 0, t: 0, cool: 0, flushes: 0, hootIn: 4, hoot: 0, blinkT: 0, fx: 0, fy: 0, fz: 0, tx: 0, ty: 0, tz: 0, ty2: 0, dur: 1, ph: 0, turnTo: 0 };
  const op: OwlPose = { yaw: 0, tilt: 0, blink: 0, fluff: 0, tufts: 0, hoot: 0 };
  function updateOwl(dt: number, t: number, act: Activity) {
    const want = visiting('owl', act);
    O.cool -= dt;
    if (!O.on) {
      if (!want || O.cool > 0) return;
      findPerches();
      if (!perches.length) { O.cool = 3; return; }
      const base = (O.flushes ? plans.owl.alt : plans.owl.spot) % perches.length;
      for (let k = 0; k < perches.length; k++) {
        const i = (base + k) % perches.length, p = perches[i];
        if (pdist(p.x, p.z) < 20 || inView(p.x, p.y, p.z, 60)) continue;
        O.on = true; O.mode = 'perch'; O.perch = i; O.x = p.x; O.y = p.y; O.z = p.z; O.yaw = p.out; shy.owl.reset();
        break;
      }
      if (!O.on) { O.cool = 5; return; }
    }
    const flying = O.mode === 'fly';
    const st = watch('owl', O.x, O.y + 0.4, O.z, flying ? 0 : dt, flying ? 'calm' : undefined);
    const toP = wrap(Math.atan2(player.x - O.x, player.z - O.z) - O.yaw);
    const near = pdist(O.x, O.z) < 30;
    if (!flying && (st === 'flee' || !want)) {
      O.flushes++;
      // off to another stone, or away for the night after a third fright
      let ok = false;
      if (want && O.flushes < 3 && perches.length > 1) {
        for (let k = 1; k < perches.length; k++) {
          const p = perches[(O.perch + k * 3) % perches.length];
          if (pdist(p.x, p.z) < 10) continue;
          O.perch = (O.perch + k * 3) % perches.length; O.tx = p.x; O.ty = p.y; O.tz = p.z; ok = true; break;
        }
      }
      if (!ok) { const a = Math.atan2(O.x - player.x, O.z - player.z); O.tx = O.x + Math.sin(a) * 90; O.tz = O.z + Math.cos(a) * 90; O.ty = O.y + 20; O.flushes = 99; }
      O.mode = 'fly'; O.t = 0; O.fx = O.x; O.fy = O.y; O.fz = O.z; O.dur = Math.max(1.5, Math.hypot(O.tx - O.x, O.tz - O.z) / 5.5);
    } else if (!flying) {
      O.mode = st === 'alert' ? 'alert' : 'perch';
      // can't turn the head that far: shuffle round on the perch
      if (near && Math.abs(toP) > 2.4) { O.turnTo = O.yaw + toP; O.mode = 'turn'; }
    }
    O.t += dt;
    switch (O.mode) {
      case 'perch': case 'alert': case 'turn': {
        const alert = O.mode === 'alert' ? 1 : 0;
        if (O.mode === 'turn') { O.yaw = dampAngle(O.yaw, O.turnTo, 4, dt); if (Math.abs(wrap(O.turnTo - O.yaw)) < 0.1) O.mode = 'perch'; }
        // the head keeps you in view when you're about; otherwise a slow survey of the knoll
        const target = near ? clamp(toP, -2.5, 2.5) : Math.sin(t * 0.23) * 1.6 + Math.sin(t * 0.71) * 0.4;
        op.yaw = dampAngle(op.yaw, target, near ? 5 : 1.2, dt);
        op.tilt = damp(op.tilt, near ? Math.sin(t * 0.9) * 0.22 * (1 - alert) : 0, 2, dt);
        op.tufts = damp(op.tufts, alert ? 0.6 : 0.1, 4, dt); op.fluff = damp(op.fluff, alert ? -0.6 : 0.25, 3, dt);
        // slow blinks (sleepier when nobody's about)
        O.blinkT -= dt;
        if (O.blinkT <= 0) O.blinkT = 2.5 + rng() * 5;
        op.blink = O.blinkT < 0.35 ? Math.sin(O.blinkT / 0.35 * Math.PI) : near ? 0.1 : 0.45;
        O.hootIn -= dt;
        if (O.hootIn <= 0 && !alert) { O.hootIn = 7 + rng() * 12; O.hoot = 1.3; critterSound(ctx, 'hoot', O.x, O.y + 0.4, O.z, 70, 1, 0.95 + rng() * 0.1); }
        O.hoot = Math.max(0, O.hoot - dt);
        op.hoot = O.hoot > 0 ? Math.sin((1 - O.hoot / 1.3) * Math.PI) : 0;
        owlPerch(t, op, CH, BD);
        break;
      }
      case 'fly': {
        const k = clamp(O.t / O.dur, 0, 1), e = smooth01(k);
        O.x = lerp(O.fx, O.tx, e); O.z = lerp(O.fz, O.tz, e);
        O.y = lerp(O.fy, O.ty, e) + Math.sin(k * Math.PI) * 1.5 - Math.sin(k * Math.PI * 2) * 0.4;
        O.yaw = dampAngle(O.yaw, Math.atan2(O.tx - O.fx, O.tz - O.fz), 6, dt);
        O.ph += dt * 2.3;
        owlFly(O.ph, k > 0.2 && k < 0.75 ? 1 : 0, CH, BD);
        if (k >= 1) {
          if (O.flushes >= 99) { O.on = false; O.cool = 900; O.flushes = 0; return; }
          O.mode = 'perch'; O.yaw = perches[O.perch].out; shy.owl.reset(); op.yaw = 0;
        }
        break;
      }
    }
    if (pdist(O.x, O.z) > 140) return;
    emit(owlPool, O.x, O.y, O.z, O.yaw, SCALE.owl);
    if (O.mode !== 'fly') eyeshine(0.046, 0.385, 0.11, 0, 0.29, 0, 0, op.yaw, O.x, O.y + BD.y * SCALE.owl, O.z, O.yaw, SCALE.owl, 1.6, 1.1, 0.5);
  }

  // ------------------------------------------------------------------ hedgehog
  type GMode = 'walk' | 'snuffle' | 'curl' | 'leave';
  const hog: Mover = { x: 0, y: 0, z: 0, yaw: 0, v: 0, turn: 0 };
  const G = { on: false, mode: 'snuffle' as GMode, tx: 0, tz: 0, timer: 0, cool: 0, curl: 0, still: 0, ph: 0, look: 0 };
  function hogTarget(): void {
    const tr = trees[Math.floor(rng() * trees.length)];
    for (let k = 0; k < 6; k++) {
      const a = rng() * TAU, r = 0.9 + rng() * 1.6, x = tr.x + Math.sin(a) * r, z = tr.z + Math.cos(a) * r;
      if (!ctx.colliders.blocked(x, z, 0.2)) { G.tx = x; G.tz = z; return; }
    }
    G.tx = hog.x + (rng() - 0.5) * 3; G.tz = hog.z + (rng() - 0.5) * 3;
  }
  function updateHog(dt: number, t: number, act: Activity) {
    const want = visiting('hedgehog', act);
    G.cool -= dt;
    if (!G.on) {
      if (!want || G.cool > 0 || !trees.length) return;
      const tr = trees[(plans.hedgehog.spot) % trees.length];
      const x = tr.x + 1.1, z = tr.z + 0.6;
      if (pdist(x, z) < 12 || inView(x, groundY(ctx, x, z), z, 25)) { G.cool = 3; return; }
      G.on = true; G.mode = 'snuffle'; G.timer = 3; hog.x = x; hog.z = z; hog.yaw = rng() * TAU; hog.v = 0; G.curl = 0; shy.hedgehog.reset();
    }
    hog.y = groundY(ctx, hog.x, hog.z);
    const st = watch('hedgehog', hog.x, hog.y + 0.1, hog.z, dt, G.mode === 'curl' ? 'alert' : undefined);
    if (st === 'flee' && G.mode !== 'curl' && G.mode !== 'leave') { G.mode = 'curl'; G.still = 0; critterSound(ctx, 'sniff', hog.x, hog.y, hog.z, 12, 0.6, 1.6); }
    if (!want && G.mode !== 'curl' && G.mode !== 'leave') { G.mode = 'leave'; G.tx = hog.x + Math.sin(hog.yaw) * 30; G.tz = hog.z + Math.cos(hog.yaw) * 30; }
    switch (G.mode) {
      case 'snuffle':
        stop(hog, dt); G.timer -= dt;
        G.look = damp(G.look, Math.sin(t * 0.9) * 0.5, 3, dt);
        if (G.timer <= 0) { hogTarget(); G.mode = 'walk'; }
        if (st === 'alert') G.look = damp(G.look, 0, 3, dt);
        break;
      case 'walk': case 'leave': {
        const d = steer(hog, G.tx, G.tz, st === 'alert' ? 0 : G.mode === 'leave' ? 0.5 : 0.32, dt, 3, 0.3);
        G.look = damp(G.look, Math.sin(t * 1.7) * 0.2, 3, dt);
        if (G.mode === 'leave' && (pdist(hog.x, hog.z) > 20 && !inView(hog.x, hog.y, hog.z, 30) || d < 0.3)) { G.on = false; G.cool = 600; return; }
        if (G.mode === 'walk' && d < 0.25) { G.mode = 'snuffle'; G.timer = 3 + rng() * 5; }
        break;
      }
      case 'curl': {
        stop(hog, dt);
        G.still = ctx.player.speed < PACE.still ? G.still + dt : 0;
        if (G.still > 3.5 || pdist(hog.x, hog.z) > WILD.hedgehog.notice * 1.6) { G.mode = 'snuffle'; G.timer = 2 + rng() * 2; shy.hedgehog.reset(); }
        break;
      }
    }
    G.curl = damp(G.curl, G.mode === 'curl' ? 1 : 0, G.mode === 'curl' ? 9 : 1.6, dt);
    G.ph += hog.v * dt * 6;
    if (pdist(hog.x, hog.z) > 70) return;
    hogPose(t, G.ph, clamp(hog.v / 0.3, 0, 1), G.curl, G.mode === 'snuffle' ? 1 : 0.4, G.look, CH, BD);
    emit(hogPool, hog.x, hog.y, hog.z, hog.yaw, SCALE.hog);
    fx.shadow(hog.x, hog.y, hog.z, 0.17 * SCALE.hog, 1.3, hog.yaw);
  }

  // ------------------------------------------------------------------ geese
  const GV = { k: -1, n: -1, ax: 0, az: 0, bx: 0, bz: 0, y: 40, honkIn: 0, forceT: -1, x: 0, z: 0, yaw: 0 };
  function geesePath(n: number): void {
    const r = seeded(`geese:${day.key}:${n}`);
    const south = clock.season !== 'spring';
    const yaw = (south ? 0 : Math.PI) + (r() - 0.5) * 1.1;
    const px = (r() - 0.5) * 70, pz = (r() - 0.5) * 70;
    const dx = Math.sin(yaw), dz = Math.cos(yaw);
    GV.ax = px - dx * 170; GV.az = pz - dz * 170; GV.bx = px + dx * 170; GV.bz = pz + dz * 170;
    GV.y = W + 30 + r() * 10; GV.yaw = yaw; GV.n = n;
  }
  function updateGeese(dt: number, t: number, act: Activity) {
    let k = -1, n = -1;
    if (GV.forceT >= 0) {
      GV.forceT += dt; k = GV.forceT / 27; n = -7;
      if (k > 1) { GV.forceT = -1; k = -1; }
    } else if (visiting('geese', act)) {
      const p = geesePass(plans.geese, clock.hour);
      k = p.k; n = p.n;
    }
    if (k < 0) { GV.n = -1; return; }
    if (n !== GV.n) geesePath(n);
    GV.x = lerp(GV.ax, GV.bx, k); GV.z = lerp(GV.az, GV.bz, k);
    watch('geese', GV.x, GV.y, GV.z, dt, 'calm');
    // honking: placed between you and the skein so it carries
    GV.honkIn -= dt;
    const d = Math.hypot(GV.x - player.x, GV.z - player.z, GV.y - player.y);
    if (GV.honkIn <= 0 && d < 170) {
      GV.honkIn = 1.6 + rng() * 2.4;
      const f = Math.min(1, 24 / d);
      critterSound(ctx, 'honk', lerp(player.x, GV.x, f), lerp(player.y, GV.y, f), lerp(player.z, GV.z, f), 60, clamp(1.4 - d / 140, 0.25, 1), 0.92 + rng() * 0.16);
    }
    const sx = Math.cos(GV.yaw), sz = -Math.sin(GV.yaw), bx = -Math.sin(GV.yaw), bz = -Math.cos(GV.yaw);
    for (let i = 0; i < 9; i++) {
      const rank = Math.ceil(i / 2), side = i === 0 ? 0 : i % 2 ? 1 : -1;
      const ox = sx * side * rank * 1.9 + bx * rank * 2.1, oz = sz * side * rank * 1.9 + bz * rank * 2.1;
      const wob = Math.sin(t * 0.7 + i * 1.3) * 0.25;
      gooseFly(t * 2.4 + i * 0.37, t + i, CH, BD);
      emit(goosePool, GV.x + ox + wob * sx, GV.y - rank * 0.25 + Math.sin(t * 0.9 + i) * 0.15, GV.z + oz + wob * sz, GV.yaw, SCALE.goose);
    }
  }

  // ------------------------------------------------------------------ service
  const svc: WildlifeService = {
    spook: () => undefined,
    list: () => WILD_IDS.map((id) => {
      const on = id === 'deer' ? D.on : id === 'fox' ? F.on : id === 'heron' ? H.on : id === 'owl' ? O.on : id === 'hedgehog' ? G.on : GV.n !== -1;
      const st = id === 'deer' ? D.mode : id === 'fox' ? F.mode : id === 'heron' ? H.mode : id === 'owl' ? O.mode : id === 'hedgehog' ? G.mode : 'fly';
      const p = id === 'deer' ? doe : id === 'fox' ? fox : id === 'heron' ? H : id === 'owl' ? O : id === 'hedgehog' ? hog : GV;
      return { id, on, state: st, x: +p.x.toFixed(1), z: +p.z.toFixed(1), visiting: !!plans[id] && wildVisiting(plans[id], clock.hour, clock.season, clock.weather) };
    }),
    summon(id, here = false) {
      if (!WILD_IDS.includes(id)) return null;
      forced[id] = 600; tame[id] = 12; shy[id].reset(); seenT[id] = 0;
      if (!day.key) refreshDay();
      const fy = Math.atan2(-Math.sin(ctx.player.yaw), -Math.cos(ctx.player.yaw)); // the way the camera faces (world yaw)
      const ahead = (dist: number) => ({ x: player.x + Math.sin(fy) * dist, z: player.z + Math.cos(fy) * dist });
      /** stand `dist` from (x, z) on open ground, facing it */
      const viewFrom = (x: number, y: number, z: number, dist: number, pref: number): WildView => {
        for (let k = 0; k < 16; k++) {
          const a = pref + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.4;
          const px = x + Math.sin(a) * dist, pz = z + Math.cos(a) * dist;
          const solids = ctx.services.get('floraSolids') as { blocked(x: number, z: number, r: number): boolean } | undefined;
          if ((!openGround(ctx, px, pz, 0.4) || solids?.blocked(px, pz, 2.2)) && k < 15) continue;
          const eye = groundY(ctx, px, pz) + 1.62;
          if (k < 15 && !clearLine(px, eye, pz, x, y, z)) continue;
          return { x: px, z: pz, yaw: Math.atan2(-(x - px), -(z - pz)), pitch: Math.atan2(y - eye, dist) };
        }
        return { x, z: z + dist, yaw: 0, pitch: 0 };
      };
      switch (id) {
        case 'deer': {
          let p = ahead(16);
          if (!here) p = deerSpots[plans.deer.spot % Math.max(1, deerSpots.length)] ?? p;
          deerAt(p.x, p.z, fy + Math.PI / 2); D.cool = 0;
          doe.y = groundY(ctx, p.x, p.z);
          return here ? null : viewFrom(p.x, doe.y + 0.8, p.z, 8.5, Math.atan2(-p.x, -p.z));
        }
        case 'fox': {
          foxRoute(plans.fox.spot);
          const p = here ? ahead(11) : route[0];
          F.on = true; F.mode = 'pause'; F.timer = 4; F.sniff = 1; F.cool = 0; fox.x = p.x; fox.z = p.z; fox.v = 0; fox.legs.reset(); F.wp = 1; F.dir = 1;
          fox.yaw = here ? fy + Math.PI / 2 : Math.atan2(route[1].x - p.x, route[1].z - p.z);
          return here ? null : viewFrom(p.x, groundY(ctx, p.x, p.z) + 0.3, p.z, 5.5, fox.yaw + Math.PI / 2);
        }
        case 'heron': {
          const p = here ? { ...ahead(14), yaw: fy + Math.PI / 2 } : heronSpots[plans.heron.spot % Math.max(1, heronSpots.length)];
          if (!p) return null;
          H.on = true; H.mode = 'stand'; H.timer = 3; H.cool = 0; H.flushes = 0; H.x = p.x; H.z = p.z; H.y = heronY(p.x, p.z); H.yaw = p.yaw;
          return here ? null : viewFrom(p.x, H.y + 0.7, p.z, 7, p.yaw + Math.PI / 2);
        }
        case 'owl': {
          findPerches();
          const i = plans.owl.spot % Math.max(1, perches.length);
          const p = here || !perches.length ? { ...ahead(7), y: groundY(ctx, ahead(7).x, ahead(7).z) + 1.2, out: fy + Math.PI } : perches[i];
          O.on = true; O.mode = 'perch'; O.perch = here ? 0 : i; O.cool = 0; O.flushes = 0; O.x = p.x; O.y = p.y; O.z = p.z; O.yaw = p.out;
          return here ? null : viewFrom(p.x, p.y + 0.35, p.z, 4.5, p.out);
        }
        case 'hedgehog': {
          const tr = trees[plans.hedgehog.spot % trees.length];
          const p = here ? ahead(4) : { x: tr.x + 1.1, z: tr.z + 0.6 };
          G.on = true; G.mode = 'snuffle'; G.timer = 5; G.cool = 0; G.curl = 0; hog.x = p.x; hog.z = p.z; hog.v = 0; hog.yaw = fy + Math.PI * 0.6;
          return here ? null : viewFrom(p.x, groundY(ctx, p.x, p.z), p.z, 2.2, hog.yaw);
        }
        case 'geese': {
          GV.forceT = 0; GV.n = -99;
          // straight over your head, along the way you're looking
          const r = seeded(`geese:summon:${Math.round(performance.now())}`);
          GV.yaw = fy + (r() - 0.5) * 0.6;
          // from 110 m ahead, straight toward you and over (they pass overhead ~9 s later)
          const dx = Math.sin(GV.yaw), dz = Math.cos(GV.yaw);
          GV.ax = player.x + dx * 110; GV.az = player.z + dz * 110; GV.bx = player.x - dx * 214; GV.bz = player.z - dz * 214; GV.y = player.y + 22; GV.n = -7;
          GV.yaw += Math.PI;
          return { x: player.x, z: player.z, yaw: ctx.player.yaw, pitch: 0.42 };
        }
      }
      return null;
    },
  };
  svc.spook = (id) => { if (!WILD_IDS.includes(id)) return; tame[id] = 0; shy[id].scare(); };
  ctx.services.set('wildlife', svc);
  /** viewpoints: no tree / bush / building / hill between the eye and the animal (sampled along the line) */
  function clearLine(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const solids = ctx.services.get('floraSolids') as { blocked(x: number, z: number, r: number): boolean } | undefined;
    const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / 0.8);
    for (let i = 1; i < n - 1; i++) {
      const k = i / n, x = lerp(ax, bx, k), z = lerp(az, bz, k), y = lerp(ay, by, k);
      if (solids?.blocked(x, z, 0.5) || ctx.colliders.blocked(x, z, 0.05) || heightAt(x, z) > y - 0.1) return false;
    }
    return true;
  }

  function refreshDay(): void {
    const k = dayKey(Date.now());
    if (k === day.key) return;
    day.key = k;
    for (const id of WILD_IDS) plans[id] = wildDay(k, id);
  }

  return {
    update(f, act) {
      const dt = Math.min(f.dt, 0.1);
      day.recheck -= f.dt;
      if (day.recheck <= 0 || !day.key) { day.recheck = 30; refreshDay(); }
      const sky = ctx.valley.sky;
      clock.hour = sky.hour; clock.season = sky.season; clock.weather = sky.weather.kind;
      for (const id of WILD_IDS) { forced[id] = Math.max(0, forced[id] - dt); tame[id] = Math.max(0, tame[id] - f.dt); }
      cam.getWorldDirection(fwd);
      for (const p of pools) p.begin();
      nEyes = 0;
      updateDeer(dt, f.time, act);
      updateFox(dt, f.time, act);
      updateHeron(dt, f.time, act);
      updateOwl(dt, f.time, act);
      updateHog(dt, f.time, act);
      updateGeese(dt, f.time, act);
      for (const p of pools) p.end();
      CH.fill(0);
      eyes.count = nEyes;
      eyes.instanceMatrix.needsUpdate = true;
      if (eyes.instanceColor) eyes.instanceColor.needsUpdate = true;
    },
    stats: () => ({ wild: deerPool.size + foxPool.size + heronPool.size + owlPool.size + hogPool.size + (goosePool.size ? 1 : 0), eyeshine: nEyes }),
    dispose() {
      ctx.services.delete('wildlife');
      ctx.scene.remove(...pools.map((p) => p.mesh), eyes);
      for (const p of pools) p.dispose();
      eyes.geometry.dispose(); eyeMat.dispose();
    },
  };
}
