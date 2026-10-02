/**
 * Valley Projects in the world (system 'projects'; model/projects.ts is the board, docs/valley/projects.md): the
 * Mayor's projects board on the square (E opens the panel; its cork face shows the six plans live), and the six
 * places themselves, each shown ruined until its project is completed and then, the first time you come near,
 * **unveiled**: the ruin goes, the restored place pops up with a confetti burst, a fanfare and a line from the
 * villager who championed it (the model remembers it was seen). Restored places unlock small things:
 *
 *   lanterns     the posts along the stones' footpath stand up and light at dusk (one by one when unveiled)
 *   footbridge   a walkable deck over the river (wraps 'walkSurface'), rope rails as colliders
 *   glasshouse   E: pick today's sweet violet (into the basket), lit panes at night
 *   millwheel    the wheel turns, river ambience, a bench to sit on
 *   observatory  the visitors' telescope: sit, the view tilts up to the sky and zooms in
 *   halt         ring the bell (the evening train whistles back), a bench under the shelter
 *
 * Budget: ruins are built at start (one solid + at most one glow mesh each), a restored place only when first needed.
 * About 14 draws when everything is in view (+1 confetti while it flies), nothing beyond `FAR`. Per frame: a few
 * uniforms, the wheel's angle, pop-ins; the model is re-read ≈ 4 Hz.
 *
 * Service 'projectsScene' (`ProjectsScene`): go(id) stands you in front of a place (the HUD's "Go see it", dev),
 * unveil(id) plays the moment now (dev), anchor(id) for the map.
 */
import * as THREE from 'three';
import type { AudioService, Interactable, LightEmitter, LightsService, SceneCtx, SystemFactory } from '../context.ts';
import type { Controller } from '../../player/controller.ts';
import { Kit, canvasTex, setGlow, damp } from '../structures/kit.ts';
import { PATHS, WORLD, heightAt, structure } from '../../world/map.ts';
import { projectSite, siteLocal } from '../../world/projects.ts';
import type { ProjectSiteId } from '../../world/projects.ts';
import { PROJECTS, projectDef } from '../../model/projects.ts';
import type { ProjectId, ProjectsService, ProjectsWorld } from '../../model/projects.ts';
import type { WalletService } from '../../model/wallet.ts';
import type { FriendsService } from '../../model/friends.ts';
import { friendDef } from '../../model/friends.ts';
import {
  BOARD_FACE, FOOTBRIDGE, HALT, HALT_BELL, HALT_BENCH, MILL, MILL_BENCH, SCOPE, buildBoard, buildFootbridge, buildGlasshouse, buildHalt,
  buildLanternPath, buildMillHouse, buildObservatory, buildWheel, drawBoardFace, drawHaltSign, footDeck,
} from './models.ts';
import type { FootbridgeOpts, LanternSpot } from './models.ts';
import { PAL } from '../toon.ts';

/** beyond this (m) from the camera a place is hidden */
const FAR = 175;
/** come this close (m, outdoors) to a completed place and it is unveiled */
const UNVEIL_R = 42;
const POP_S = 1.1;
const TAU = Math.PI * 2;
const easeOutBack = (x: number) => { const c1 = 1.7, c3 = c1 + 1; return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2; };

export interface ProjectsScene {
  /** stand in front of a place (or the board), looking at it */
  go(id: ProjectId | 'board'): boolean;
  /** dev: play the unveiling now (completes nothing: the project must be done) */
  unveil(id: ProjectId): boolean;
  /** where each place is (world x / z) for the map and the HUD */
  anchor(id: ProjectId | 'board'): { x: number; z: number } | null;
  /** is the restored version showing */
  restored(id: ProjectId): boolean;
}

interface Place {
  id: ProjectId;
  /** world point the unveiling centres on (confetti, distance checks) */
  anchor: THREE.Vector3;
  /** where to stand to look at it, and the point to look at */
  view: { x: number; z: number; tx: number; ty: number; tz: number };
  ruin: THREE.Group;
  done: THREE.Group | null;
  build(): THREE.Group;
  shown: 'ruin' | 'done' | null;
  /** removers for the showing state's colliders, lights and interactables */
  offs: (() => void)[];
  glows: THREE.MeshBasicMaterial[];
  emitters: LightEmitter[];
  pop: number;
  /** colliders / interactables for a state */
  attach(state: 'ruin' | 'done'): (() => void)[];
}

/** smallest solid of the confetti */
const MAX_BITS = 220;
class Confetti {
  readonly mesh: THREE.InstancedMesh;
  private readonly p = new Float32Array(MAX_BITS * 3);
  private readonly v = new Float32Array(MAX_BITS * 3);
  private readonly life = new Float32Array(MAX_BITS);
  private readonly spin = new Float32Array(MAX_BITS);
  private next = 0;
  private alive = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly s = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();
  constructor() {
    const g = new THREE.PlaneGeometry(0.11, 0.07);
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), MAX_BITS);
    this.mesh.name = 'projects:confetti';
    this.mesh.frustumCulled = false;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BITS * 3), 3);
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < MAX_BITS; i++) this.mesh.setMatrixAt(i, this.m);
    this.mesh.visible = false;
  }
  burst(at: THREE.Vector3, n: number, rand: () => number): void {
    const cols = [0xe0574a, 0xf2c33a, 0x6cc25a, 0x4fb3c8, 0x9a6ad0, 0xf08aa8, 0xffffff];
    const c = new THREE.Color();
    for (let k = 0; k < n; k++) {
      const i = this.next; this.next = (this.next + 1) % MAX_BITS;
      if (this.life[i] <= 0) this.alive++;
      const a = rand() * TAU, out = 1.2 + rand() * 3;
      this.p.set([at.x + (rand() - 0.5), at.y + rand() * 0.6, at.z + (rand() - 0.5)], i * 3);
      this.v.set([Math.cos(a) * out, 4.5 + rand() * 4, Math.sin(a) * out], i * 3);
      this.life[i] = 2.6 + rand() * 1.6;
      this.spin[i] = rand() * 10;
      this.mesh.setColorAt(i, c.setHex(cols[k % cols.length]).multiplyScalar(1.15));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt: number): void {
    if (this.alive <= 0) { this.mesh.visible = false; return; }
    this.mesh.visible = true;
    let alive = 0;
    for (let i = 0; i < MAX_BITS; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, this.m); continue; }
      alive++;
      const v = this.v, p = this.p, j = i * 3;
      const drag = Math.exp(-2.2 * dt);
      v[j] *= drag; v[j + 2] *= drag;
      v[j + 1] = Math.max(-1.1, v[j + 1] * Math.exp(-1.2 * dt) - 7 * dt);
      p[j] += v[j] * dt + Math.sin(this.spin[i] + this.life[i] * 3) * 0.4 * dt; p[j + 1] += v[j + 1] * dt; p[j + 2] += v[j + 2] * dt;
      this.spin[i] += dt * 6;
      this.e.set(this.spin[i], this.spin[i] * 0.7, this.spin[i] * 0.3);
      this.q.setFromEuler(this.e);
      const k = Math.min(1, this.life[i] * 1.5);
      this.s.set(k, k, k);
      this.mesh.setMatrixAt(i, this.m.compose(this.pos.set(p[j], p[j + 1], p[j + 2]), this.q, this.s));
    }
    this.alive = alive;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const rnd = (seed: number) => { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

/** the stones' footpath (world/map.ts PATHS: a nook spur ending at the stones' front), from the road up to the stones */
export function stonesPath(): { x: number; z: number }[] {
  const s = structure('stones');
  const fx = s.x + Math.sin(s.yaw) * (s.size[1] / 2 + 0.9), fz = s.z + Math.cos(s.yaw) * (s.size[1] / 2 + 0.9);
  let best: { x: number; z: number }[] | null = null, bd = Infinity;
  for (const p of PATHS) {
    if (p.width > 1.6) continue;
    for (const end of [p.points[0], p.points[p.points.length - 1]]) {
      const d = Math.hypot(end.x - fx, end.z - fz);
      if (d < bd) { bd = d; best = end === p.points[0] ? [...p.points].reverse() : [...p.points]; }
    }
  }
  return bd < 2 && best ? best : [{ x: fx, z: fz + 20 }, { x: fx, z: fz }];
}

/** Lantern posts along the stones' footpath: every ~6.5 m, alternating sides, plus a pair flanking the stones. */
export function lanternSpots(): LanternSpot[] {
  const pts = stonesPath();
  const out: LanternSpot[] = [];
  let acc = 2.5, side = 1;
  const off = 1.45;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    while (acc < l) {
      const t = acc / l, x = a.x + dx * t + (-dz / l) * off * side, z = a.z + dz * t + (dx / l) * off * side;
      // the arm hangs the lantern over the path: the post's local +x points at it
      out.push({ x, y: heightAt(x, z), z, ry: armYaw((-dz / l) * side, (dx / l) * side) });
      side = -side;
      acc += 6.5;
    }
    acc -= l;
  }
  // a pair at the stones' entrance (by the last point)
  const e = pts[pts.length - 1], p = pts[Math.max(0, pts.length - 2)], dx = e.x - p.x, dz = e.z - p.z, l = Math.hypot(dx, dz) || 1;
  const pair: LanternSpot[] = [];
  for (const s of [1, -1]) {
    const x = e.x - (dx / l) * 0.6 + (-dz / l) * 1.9 * s, z = e.z - (dz / l) * 0.6 + (dx / l) * 1.9 * s;
    pair.push({ x, y: heightAt(x, z), z, ry: armYaw((-dz / l) * s, (dx / l) * s) });
  }
  // (a path post that would crowd the pair makes way for it)
  return [...out.filter((o) => pair.every((q) => Math.hypot(o.x - q.x, o.z - q.z) > 2.5)), ...pair];
}
/** yaw that turns a post's arm (local +x) back toward the path, for a post set off it along (nx, nz) */
function armYaw(nx: number, nz: number): number {
  // local +x after ry is (cos ry, −sin ry): it should point along −n
  return Math.atan2(nz, -nx);
}

export const projectsSystem: SystemFactory = (ctx: SceneCtx) => {
  const model = () => ctx.services.get('projects') as ProjectsService | undefined;
  const lights = () => ctx.services.get('lights') as LightsService | undefined;
  const audio = () => ctx.services.get('audio') as AudioService | undefined;
  const controller = () => ctx.services.get('controller') as Controller | undefined;
  const wallet = () => ctx.services.get('wallet') as WalletService | undefined;
  const friends = () => ctx.services.get('friends') as FriendsService | undefined;
  const root = new THREE.Group();
  root.name = 'projects';
  ctx.scene.add(root);
  const R = rnd(77);
  const confetti = new Confetti();
  root.add(confetti.mesh);
  const say = (text: string, who?: string, ms = 5200) => ctx.ui.say(text, ms, who ? { who } : undefined);

  // ---- build helpers: everything is built in world space (kit space = world), so Kit emitters are world positions ----
  const xf = (id: ProjectSiteId) => { const s = projectSite(id); return { s, y: s.id === 'footbridge' ? 0 : heightAt(s.x, s.z) }; };
  const finish = (k: Kit, name: string): THREE.Group => {
    const g = new THREE.Group();
    g.name = name;
    k.build(g, ctx.lighting.night);
    return g;
  };
  const glowsOf = (g: THREE.Object3D) => {
    const out: THREE.MeshBasicMaterial[] = [];
    g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.userData.bake === 'glow') out.push(m.material as THREE.MeshBasicMaterial); });
    return out;
  };
  const emittersOf = (g: THREE.Object3D) => {
    const out: LightEmitter[] = [];
    g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.userData.emitters) out.push(...(m.userData.emitters as LightEmitter[])); });
    return out;
  };

  // ---- the places ----
  const places = new Map<ProjectId, Place>();
  const rect = (sid: ProjectSiteId, lx: number, lz: number, w: number, d: number, yawLocal = 0) => {
    const s = projectSite(sid), p = siteLocal(s, lx, lz);
    return ctx.colliders.rect(p.x, p.z, w, d, s.yaw + yawLocal);
  };
  const circ = (sid: ProjectSiteId, lx: number, lz: number, r: number) => { const s = projectSite(sid), p = siteLocal(s, lx, lz); return ctx.colliders.circle(p.x, p.z, r); };
  const interact = (i: Interactable) => ctx.interact.add(i);
  const at = (sid: ProjectSiteId, lx: number, ly: number, lz: number, out: THREE.Vector3) => { const { s, y } = xf(sid); const p = siteLocal(s, lx, lz); return out.set(p.x, y + ly, p.z); };
  const viewOf = (sid: ProjectSiteId, dist: number, lookY: number, side = 0) => {
    const { s, y } = xf(sid); const p = siteLocal(s, side, dist);
    return { x: p.x, z: p.z, tx: s.x, ty: y + lookY, tz: s.z };
  };
  /** a "look at it" interactable for a place still in ruins (or completed but not yet seen) */
  const lookAtRuin = (id: ProjectId, pos: (o: THREE.Vector3) => THREE.Vector3, reach = 4.5): Interactable => {
    const def = projectDef(id)!;
    return {
      id: `project:${id}:ruin`, kind: 'prop', verb: 'Look at', reach,
      label: () => `${def.name[0].toUpperCase()}${def.name.slice(1)}`,
      hint: () => (model()?.data().p[id]?.done ? 'restored! come closer' : 'a valley project: the board on the square has the plan'),
      pos, use: () => { say(`${def.blurb} (The Mayor's projects board on the square has a plan for it.)`, undefined, 7500); },
    };
  };
  const sitOn = (sid: ProjectSiteId, seat: { x: number; y: number; z: number; ry: number }, after?: () => void, onStand?: () => void) => {
    const { s, y } = xf(sid);
    const p = siteLocal(s, seat.x, seat.z);
    // the bench's front (+z local, turned by ry) is the way the seat faces
    controller()?.sit({ x: p.x + Math.sin(s.yaw + seat.ry) * 0.12, z: p.z + Math.cos(s.yaw + seat.ry) * 0.12, y: y + seat.y + 0.45, yaw: s.yaw + seat.ry }, onStand);
    after?.();
  };

  // lanterns: posts along the stones' footpath
  const spots = lanternSpots();
  const lanternCentre = spots.reduce((a, s) => a.set(a.x + s.x / spots.length, Math.max(a.y, s.y + 1.6), a.z + s.z / spots.length), new THREE.Vector3(0, -99, 0));
  const lanternIgnite = { t: -1 };
  places.set('lanterns', {
    id: 'lanterns', anchor: lanternCentre.clone(),
    view: (() => { const a = spots[0], b = spots[Math.min(spots.length - 1, 3)]; return { x: a.x + (a.x - b.x) * 0.4, z: a.z + (a.z - b.z) * 0.4, tx: b.x, ty: b.y + 1.2, tz: b.z }; })(),
    ruin: (() => { const k = new Kit(301); buildLanternPath(k, spots, false); return finish(k, 'lanterns'); })(),
    done: null,
    build() { const k = new Kit(302); buildLanternPath(k, spots, true); return finish(k, 'lanterns'); },
    shown: null, offs: [], glows: [], emitters: [], pop: -1,
    attach(state) {
      const offs = spots.map((s) => ctx.colliders.circle(s.x, s.z, 0.22));
      if (state === 'ruin') offs.push(interact(lookAtRuin('lanterns', (o) => o.set(spots[0].x, spots[0].y + 1.0, spots[0].z), 3.6)));
      return offs;
    },
  });

  // the footbridge
  const fbSite = projectSite('footbridge');
  const fbL = FOOTBRIDGE.L, fbW = FOOTBRIDGE.w;
  const fbWorld = (lz: number) => siteLocal(fbSite, 0, lz);
  const fbO: FootbridgeOpts = {
    L: fbL, w: fbW, water: WORLD.water,
    yA: (() => { const p = fbWorld(-fbL / 2); return heightAt(p.x, p.z) + 0.1; })(),
    yB: (() => { const p = fbWorld(fbL / 2); return heightAt(p.x, p.z) + 0.1; })(),
    bed: (lz) => { const p = fbWorld(lz); return heightAt(p.x, p.z); },
  };
  const fbBuild = (restored: boolean, seed: number) => {
    const k = new Kit(seed);
    k.at({ x: fbSite.x, z: fbSite.z, ry: fbSite.yaw }, () => buildFootbridge(k, fbO, restored));
    return finish(k, 'footbridge');
  };
  places.set('footbridge', {
    id: 'footbridge', anchor: new THREE.Vector3(fbSite.x, footDeck(fbO, 0) + 1, fbSite.z),
    view: (() => { const a = siteLocal(fbSite, 4.5, -fbL / 2 - 3.5); return { x: a.x, z: a.z, tx: fbSite.x, ty: footDeck(fbO, 0), tz: fbSite.z }; })(),
    ruin: fbBuild(false, 311), done: null, build: () => fbBuild(true, 312),
    shown: null, offs: [], glows: [], emitters: [], pop: -1,
    attach(state) {
      const offs: (() => void)[] = [];
      if (state === 'done') {
        for (const sd of [-1, 1]) offs.push(rect('footbridge', sd * (fbW / 2 + 0.06), 0, 0.2, fbL - 1.0));
      } else {
        // the stubs and their barriers: keep off them
        for (const sd of [-1, 1]) offs.push(rect('footbridge', 0, sd * (fbL / 2 + 5.4 - 0.4) / 2, fbW + 0.5, fbL / 2 - 5.4 + 0.8));
        const e = fbWorld(-fbL / 2 + 0.75);
        offs.push(interact(lookAtRuin('footbridge', (o) => o.set(e.x, fbO.yA + 0.8, e.z), 4.2)));
      }
      return offs;
    },
  });

  // the glasshouse
  const ghSite = projectSite('glasshouse');
  const ghBuild = (restored: boolean, seed: number) => {
    const k = new Kit(seed), { s, y } = xf('glasshouse');
    k.at({ x: s.x, y, z: s.z, ry: s.yaw }, () => buildGlasshouse(k, restored, (lx, lz) => { const p = siteLocal(s, lx, lz); return heightAt(p.x, p.z) - y; }));
    if (restored) {
      // two warm lamps hung from the ridge light the panes at night
      k.part('lamps', () => k.at({ x: s.x, y, z: s.z, ry: s.yaw }, () => {
        for (const lx of [-1.9, 1.9]) {
          k.rod(lx, 2.08, 0, lx, 3.22, 0, 0.012, PAL.ink, 4);
          k.box(0.2, 0.05, 0.2, PAL.metalDark, { x: lx, y: 2.1 });
          k.emit({ radius: 6.5, intensity: 0.45 }, () => k.box(0.12, 0.16, 0.12, 0xffc566, { x: lx, y: 2.0 }, 'glow'));
        }
      }));
    }
    return finish(k, 'glasshouse');
  };
  places.set('glasshouse', {
    id: 'glasshouse', anchor: at('glasshouse', 0, 2, 0, new THREE.Vector3()),
    view: viewOf('glasshouse', 8.5, 1.4, 1.5),
    ruin: ghBuild(false, 321), done: null, build: () => ghBuild(true, 322),
    shown: null, offs: [], glows: [], emitters: [], pop: -1,
    attach(state) {
      const offs: (() => void)[] = [rect('glasshouse', 0, -0.2, 7.6, 4.2)];
      if (state === 'ruin') offs.push(interact(lookAtRuin('glasshouse', (o) => at('glasshouse', 0, 1.2, 2.4, o))));
      else {
        offs.push(interact({
          id: 'project:glasshouse:violet', kind: 'prop', verb: 'Pick', reach: 3.6,
          label: () => (model()?.picked() ? 'Sweet violets' : 'A sweet violet'),
          hint: () => (model()?.picked() ? 'picked today: more tomorrow' : 'one a day from the glasshouse · Posy adores them'),
          pos: (o) => at('glasshouse', 1.6, 0.5, 2.95, o),
          use: () => {
            const m = model();
            if (m?.pick()) { audio()?.play('pop', { pos: at('glasshouse', 1.6, 0.5, 2.95, new THREE.Vector3()) }); say('A sweet violet from the glasshouse, into your basket. It smells of spring, whatever the weather.'); }
            else say('You already picked today\'s violet. The glasshouse grows another overnight.');
          },
        }));
      }
      return offs;
    },
  });

  // the mill
  const millSite = projectSite('millwheel');
  const millY = heightAt(millSite.x, millSite.z);
  const wheelY = WORLD.water + 0.72 - millY;
  const bedAt = (lz: number) => { const p = siteLocal(millSite, 0, lz); return heightAt(p.x, p.z) - millY; };
  let wheel: THREE.Object3D | null = null, wheelOn = false;
  const millBuild = (restored: boolean, seed: number) => {
    const k = new Kit(seed);
    k.at({ x: millSite.x, y: millY, z: millSite.z, ry: millSite.yaw }, () => buildMillHouse(k, restored, wheelY, bedAt));
    const g = finish(k, 'millwheel');
    const wk = new Kit(seed + 5);
    buildWheel(wk, restored);
    const wm = wk.mesh();
    wm.name = 'wheel';
    wm.receiveShadow = true;
    const pivot = new THREE.Group();
    pivot.name = 'wheelPivot';
    const wp = siteLocal(millSite, 0, MILL.wheelZ);
    pivot.position.set(wp.x, millY + wheelY, wp.z);
    pivot.rotation.y = millSite.yaw;
    if (!restored) wm.rotation.set(0.05, 0, 0.6);
    pivot.add(wm);
    g.add(pivot);
    g.userData.wheel = wm;
    return g;
  };
  let millLoop: { setVolume(v: number): void; stop(): void } | null = null;
  places.set('millwheel', {
    id: 'millwheel', anchor: at('millwheel', 0, 3, 2, new THREE.Vector3()),
    view: (() => { const a = siteLocal(millSite, -12, 2.5); return { x: a.x, z: a.z, tx: siteLocal(millSite, 0, 4).x, ty: millY + 0.6, tz: siteLocal(millSite, 0, 4).z }; })(),
    ruin: millBuild(false, 331), done: null, build: () => millBuild(true, 332),
    shown: null, offs: [], glows: [], emitters: [], pop: -1,
    attach(state) {
      const offs: (() => void)[] = [rect('millwheel', 0, 0, MILL.w, MILL.d), rect('millwheel', 0, 5.0, 0.6, 1.0)];
      if (state === 'ruin') offs.push(interact(lookAtRuin('millwheel', (o) => at('millwheel', 0, 1.4, MILL.d / 2 + 0.4, o))));
      else {
        offs.push(rect('millwheel', MILL_BENCH.x, MILL_BENCH.z, 1.5, 0.45, MILL_BENCH.ry));
        offs.push(interact({
          id: 'project:millwheel:bench', kind: 'prop', verb: 'Sit', reach: 3,
          label: () => 'Bench by the millrace', hint: () => 'listen to the wheel turn',
          pos: (o) => at('millwheel', MILL_BENCH.x, 0.6, MILL_BENCH.z, o),
          use: () => sitOn('millwheel', MILL_BENCH, () => say('The wheel creaks round, the race chatters, and the river does the rest.')),
        }));
      }
      return offs;
    },
  });

  // the observatory
  const obsBuild = (restored: boolean, seed: number) => {
    const k = new Kit(seed), { s, y } = xf('observatory');
    k.at({ x: s.x, y, z: s.z, ry: s.yaw }, () => buildObservatory(k, restored));
    return finish(k, 'observatory');
  };
  const stargaze = { on: false, fov0: 0, k: 0 };
  places.set('observatory', {
    id: 'observatory', anchor: at('observatory', 0, 4.5, 0, new THREE.Vector3()),
    view: viewOf('observatory', 11, 3.2, -3),
    ruin: obsBuild(false, 341), done: null, build: () => obsBuild(true, 342),
    shown: null, offs: [], glows: [], emitters: [], pop: -1,
    attach(state) {
      const offs: (() => void)[] = [circ('observatory', 0, 0, 2.7)];
      if (state === 'ruin') offs.push(interact(lookAtRuin('observatory', (o) => at('observatory', 0, 1.4, 2.8, o))));
      else {
        offs.push(circ('observatory', SCOPE.x, SCOPE.z, 0.35));
        offs.push(interact({
          id: 'project:observatory:scope', kind: 'prop', verb: 'Look through', reach: 3.2,
          label: () => 'The visitors\' telescope', hint: () => (ctx.lighting.night > 0.5 ? 'a clear look at tonight\'s sky' : 'best after dark'),
          pos: (o) => at('observatory', SCOPE.x, 1.4, SCOPE.z - 0.2, o),
          use: () => {
            const { s, y } = xf('observatory');
            const seat = siteLocal(s, SCOPE.x, SCOPE.z + 0.75);
            const look = siteLocal(s, SCOPE.x, SCOPE.z - 30);
            stargaze.on = true;
            audio()?.play('scope', { pos: at('observatory', SCOPE.x, 1.4, SCOPE.z, new THREE.Vector3()), volume: 0.8 });
            controller()?.sit({ x: seat.x, z: seat.z, y: y + 0.53, yaw: s.yaw + Math.PI }, () => { stargaze.on = false; });
            controller()?.lookAt(look.x, y + 26, look.z);
            say(ctx.lighting.night > 0.5 ? 'The stars jump close: the Plough, a smudge of the Milky Way, and a satellite ticking over. Move to stand up.' : 'Just sky and a passing cloud for now. It\'s best after dark. Move to stand up.', 'Telescope');
          },
        }));
      }
      return offs;
    },
  });

  // the train halt
  const haltSite = projectSite('halt');
  let haltSign: THREE.Mesh | null = null;
  const haltBuild = (restored: boolean, seed: number) => {
    const k = new Kit(seed), { s, y } = xf('halt');
    k.at({ x: s.x, y, z: s.z, ry: s.yaw }, () => buildHalt(k, restored));
    const g = finish(k, 'halt');
    if (restored) {
      const c = canvasTex(512, 116);
      drawHaltSign(c.g, c.w, c.h);
      c.tex.needsUpdate = true;
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.46), new THREE.MeshBasicMaterial({ map: c.tex }));
      sign.name = 'haltSign';
      const pz = HALT.plat / 2 - 0.25;
      const p = siteLocal(s, -2.3, pz + 1.05 + 0.045);
      sign.position.set(p.x, y + HALT.platY + 0.06 + 1.95, p.z);
      sign.rotation.y = s.yaw;
      g.add(sign);
      haltSign = sign;
    }
    return g;
  };
  let lastBell = 0;
  places.set('halt', {
    id: 'halt', anchor: at('halt', 0, 2, 0.5, new THREE.Vector3()),
    view: viewOf('halt', 9, 1.2, 3),
    ruin: haltBuild(false, 351), done: null, build: () => haltBuild(true, 352),
    shown: null, offs: [], glows: [], emitters: [], pop: -1,
    attach(state) {
      const pz = HALT.plat / 2 - 0.25;
      const offs: (() => void)[] = [rect('halt', 0, HALT.trackZ, HALT.trackLen, 0.4), rect('halt', -0.4, pz - HALT.plat / 2 + 0.1, HALT.len, 0.2)];
      if (state === 'ruin') offs.push(interact(lookAtRuin('halt', (o) => at('halt', -2.3, 1.0, pz + 1.4, o))));
      else {
        offs.push(circ('halt', HALT_BELL.x, HALT_BELL.z, 0.18), rect('halt', HALT_BENCH.x, HALT_BENCH.z, 1.5, 0.45));
        offs.push(interact({
          id: 'project:halt:bell', kind: 'prop', verb: 'Ring', reach: 3.2,
          label: () => 'The halt\'s bell', hint: () => 'the evening train answers',
          pos: (o) => at('halt', HALT_BELL.x + 0.42, HALT.platY + 1.8, HALT_BELL.z, o),
          use: () => {
            const now = performance.now();
            if (now - lastBell < 2500) return;
            lastBell = now;
            const p = at('halt', HALT_BELL.x + 0.42, HALT.platY + 1.8, HALT_BELL.z, new THREE.Vector3());
            audio()?.play('bell', { pos: p, volume: 0.9 });
            setTimeout(() => audio()?.play('bell', { pos: p, volume: 0.7, pitch: 1.02 }), 380);
            setTimeout(() => { audio()?.play('train', { pos: at('halt', HALT.trackLen / 2 + 25, 3, HALT.trackZ, new THREE.Vector3()), volume: 0.9 }); say(ctx.lighting.night > 0.3 || ctx.valley.sky.hour >= 17 ? 'Far off down the line, the evening train whistles back. Toot toot!' : 'A faint whistle comes back from somewhere far down the line. The evening train will be along later.', 'The halt'); }, 2200);
          },
        }));
        offs.push(interact({
          id: 'project:halt:bench', kind: 'prop', verb: 'Sit', reach: 3,
          label: () => 'Bench on the platform', hint: () => 'wait for the evening train',
          pos: (o) => at('halt', HALT_BENCH.x, HALT.platY + 0.6, HALT_BENCH.z, o),
          use: () => sitOn('halt', HALT_BENCH, () => say('You sit on the platform bench. The rails tick in the sun.')),
        }));
      }
      return offs;
    },
  });

  // ---- the board on the square ----
  const boardSite = projectSite('board');
  const boardY = heightAt(boardSite.x, boardSite.z);
  const boardK = new Kit(361);
  boardK.at({ x: boardSite.x, y: boardY, z: boardSite.z, ry: boardSite.yaw }, () => buildBoard(boardK));
  const board = finish(boardK, 'board');
  const face = canvasTex(512, 308);
  const faceMat = new THREE.MeshBasicMaterial({ map: face.tex });
  const faceMesh = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_FACE.w, BOARD_FACE.h), faceMat);
  faceMesh.name = 'boardFace';
  { const p = siteLocal(boardSite, 0, BOARD_FACE.z); faceMesh.position.set(p.x, boardY + BOARD_FACE.y, p.z); faceMesh.rotation.y = boardSite.yaw; }
  board.add(faceMesh);
  root.add(board);
  const boardGlows = glowsOf(board);
  const boardOffs: (() => void)[] = [rect('board', 0, 0, 2.7, 0.3), rect('board', -0.75, 0.62, 0.5, 0.42)];
  { const L = lights(); for (const e of emittersOf(board)) if (L) boardOffs.push(L.add(e)); }
  const projWorld = (): ProjectsWorld => ({ friends: friends()?.data() ?? null, coins: wallet()?.coins() ?? 0, basket: wallet()?.data().basket ?? {} });
  boardOffs.push(interact({
    id: 'project:board', kind: 'structure', verb: 'Read', reach: 3.6,
    label: () => 'Valley projects board',
    hint: () => {
      const m = model();
      if (!m) return 'the Mayor\'s restoration plans';
      const v = m.view(projWorld());
      const ready = v.entries.filter((e) => e.pending).length;
      return `${v.done} of ${v.total} restored${ready ? ` · ${ready} finished: go and see!` : v.canGive ? ` · you can help with ${v.canGive}` : ''}`;
    },
    pos: (o) => o.set(faceMesh.position.x, faceMesh.position.y, faceMesh.position.z),
    use: () => ctx.ui.projects?.(),
  }));
  let faceSig = '';
  const redrawFace = () => {
    const m = model();
    const v = m?.view(projWorld());
    const cards = PROJECTS.map((d, i) => { const e = v?.entries[i]; return { title: d.name.replace(/^the /, '').replace(/^\w/, (c) => c.toUpperCase()), status: e?.status ?? 'locked', progress: e?.progress ?? 0, ready: !!e?.ready || !!e?.pending }; });
    const sig = cards.map((c) => `${c.status}${Math.round(c.progress * 30)}${c.ready ? 1 : 0}`).join('|');
    if (sig === faceSig) return;
    faceSig = sig;
    drawBoardFace(face.g, face.w, face.h, cards, v?.done ?? 0);
    face.tex.needsUpdate = true;
  };
  redrawFace();

  // ---- showing / hiding a place's state ----
  const show = (pl: Place, state: 'ruin' | 'done', pop: boolean) => {
    if (pl.shown === state) return;
    // take the other state down
    for (const f of pl.offs) f();
    pl.offs = [];
    if (pl.shown === 'ruin') root.remove(pl.ruin);
    if (pl.shown === 'done' && pl.done) root.remove(pl.done);
    pl.shown = state;
    const g = state === 'ruin' ? pl.ruin : (pl.done ??= pl.build());
    root.add(g);
    pl.glows = glowsOf(g);
    pl.emitters = emittersOf(g);
    const L = lights();
    if (L) for (const e of pl.emitters) pl.offs.push(L.add(e));
    pl.offs.push(...pl.attach(state));
    if (pl.id === 'millwheel') { wheel = (g.userData.wheel as THREE.Object3D | undefined) ?? null; wheelOn = state === 'done'; }
    g.scale.set(1, 1, 1); g.position.set(0, 0, 0);
    if (pop) {
      if (pl.id === 'lanterns') {
        lanternIgnite.t = 0;
        for (const e of pl.emitters) e.gain = 0;
      } else if (!ctx.comfort.reducedMotion) {
        // (calmer motion: the place is simply there, no spring)
        pl.pop = 0;
        scaleAbout(pl, g, 0.001, 0.001);
      }
    }
  };
  const pivotOf = (pl: Place) => new THREE.Vector3(pl.anchor.x, pl.id === 'footbridge' ? WORLD.water : heightAt(pl.anchor.x, pl.anchor.z), pl.anchor.z);
  const scaleAbout = (pl: Place, g: THREE.Object3D, sx: number, sy: number) => {
    const p = pivotOf(pl);
    g.scale.set(sx, sy, sx);
    g.position.set(p.x * (1 - sx), p.y * (1 - sy), p.z * (1 - sx));
  };

  const unveilNow = (pl: Place) => {
    const m = model();
    m?.unveil(pl.id);
    show(pl, 'done', true);
    const def = projectDef(pl.id)!;
    const n = ctx.comfort.reducedMotion ? 60 : 160;
    confetti.burst(pl.anchor, n, R);
    const a = audio();
    a?.play('fanfare', { pos: pl.anchor, volume: 0.85 });
    a?.play('pop', { pos: pl.anchor, volume: 0.9 });
    setTimeout(() => audio()?.play('sparkle', { pos: pl.anchor }), 320);
    const who = friendDef(def.who);
    say(`${def.done}`, who?.name ?? 'The valley', 7000);
    // the finale: a firework show over the south meadow
    const v = m?.view();
    if (v && v.done === v.total) (ctx.services.get('upgrades') as { fireworks?(s: number): void } | undefined)?.fireworks?.(24);
  };

  const sync = () => {
    const m = model();
    for (const pl of places.values()) {
      const s = m?.data().p[pl.id];
      const want = s?.done && s.unveiled ? 'done' : 'ruin';
      if (want === 'ruin' && pl.shown === 'done') show(pl, 'ruin', false);
      else if (want === 'done') show(pl, 'done', false);
      else if (!pl.shown) show(pl, 'ruin', false);
    }
  };
  sync();

  // the restored footbridge is a deck you can walk on (wrap whatever 'walkSurface' was: structures, trail)
  const prevWalk = ctx.services.get('walkSurface') as ((x: number, z: number) => number | null) | undefined;
  const fbC = Math.cos(fbSite.yaw), fbS = Math.sin(fbSite.yaw);
  const walk = (x: number, z: number): number | null => {
    const fb = places.get('footbridge')!;
    if (fb.shown === 'done') {
      const dx = x - fbSite.x, dz = z - fbSite.z;
      if (dx * dx + dz * dz < 100) {
        const lx = dx * fbC - dz * fbS, lz = dx * fbS + dz * fbC;
        if (Math.abs(lx) <= fbW / 2 + 0.08 && Math.abs(lz) <= fbL / 2) return footDeck(fbO, lz);
      }
    }
    return prevWalk ? prevWalk(x, z) : null;
  };
  ctx.services.set('walkSurface', walk);

  const handle: ProjectsScene = {
    go(id) {
      const ctl = controller();
      if (!ctl) return false;
      if (id === 'board') {
        const p = siteLocal(boardSite, 0.3, 3.4);
        ctl.teleport(p.x, p.z, Math.atan2(-(boardSite.x - p.x), -(boardSite.z - p.z)), -0.05);
        return true;
      }
      const pl = places.get(id);
      if (!pl) return false;
      const v = pl.view;
      ctl.teleport(v.x, v.z, Math.atan2(-(v.tx - v.x), -(v.tz - v.z)), 0);
      ctl.lookAt(v.tx, v.ty, v.tz);
      return true;
    },
    unveil(id) {
      const pl = places.get(id);
      if (!pl || !model()?.data().p[id]?.done) return false;
      unveilNow(pl);
      return true;
    },
    anchor(id) {
      if (id === 'board') return { x: boardSite.x, z: boardSite.z };
      const pl = places.get(id);
      return pl ? { x: pl.anchor.x, z: pl.anchor.z } : null;
    },
    restored: (id) => places.get(id)?.shown === 'done',
  };
  ctx.services.set('projectsScene', handle);

  let acc = 0, lastVersion = -1, faceAcc = 0;
  const cam = new THREE.Vector3();
  return {
    name: 'projects',
    update(f) {
      const night = ctx.lighting.night;
      const p = ctx.player.pos;
      cam.copy(ctx.camera.position);
      const indoors = !!(ctx.services.get('indoors') as { active?: boolean } | undefined)?.active;
      acc += f.dt;
      if (acc > 0.25) {
        acc = 0;
        const m = model();
        if (m && m.version !== lastVersion) { lastVersion = m.version; sync(); }
        // unveil a completed place the first time you come near it
        if (m && !indoors && !ctx.player.frozen) {
          for (const pl of places.values()) {
            const s = m.data().p[pl.id];
            if (!s?.done || s.unveiled) continue;
            if (Math.hypot(p.x - pl.anchor.x, p.z - pl.anchor.z) < UNVEIL_R) { unveilNow(pl); break; }
          }
        }
        // hide far places (the board stays: it's on the square)
        for (const pl of places.values()) {
          const g = pl.shown === 'done' ? pl.done : pl.ruin;
          if (g) g.visible = !indoors && Math.hypot(cam.x - pl.anchor.x, cam.z - pl.anchor.z) < FAR + (pl.id === 'lanterns' ? 30 : 0);
        }
        board.visible = !indoors;
      }
      faceAcc += f.dt;
      if (faceAcc > 1.5) { faceAcc = 0; redrawFace(); }
      // night glow
      for (const m of boardGlows) setGlow(m, night);
      const dim = 1 - 0.5 * night;
      faceMat.color.setRGB(dim, dim * 0.97, dim * 0.92);
      if (haltSign) (haltSign.material as THREE.MeshBasicMaterial).color.setRGB(dim, dim, dim);
      for (const pl of places.values()) {
        for (const m of pl.glows) setGlow(m, night);
        if (pl.pop >= 0) {
          const g = pl.shown === 'done' ? pl.done : pl.ruin;
          pl.pop += f.dt / POP_S;
          if (g) {
            if (pl.pop >= 1) { pl.pop = -1; scaleAbout(pl, g, 1, 1); } else scaleAbout(pl, g, Math.max(0.001, easeOutBack(pl.pop)), Math.max(0.001, easeOutBack(Math.min(1, pl.pop * 1.12))));
          }
        }
      }
      // the lanterns light one by one along the path when unveiled
      if (lanternIgnite.t >= 0) {
        lanternIgnite.t += f.dt;
        const pl = places.get('lanterns')!;
        pl.emitters.forEach((e, i) => {
          const was = e.gain ?? 1;
          e.gain = Math.min(1, Math.max(0, (lanternIgnite.t - i * 0.35) * 3));
          if (was === 0 && e.gain > 0) audio()?.play('sparkle', { pos: e.pos, volume: 0.35, pitch: 1 + i * 0.04 });
        });
        if (lanternIgnite.t > pl.emitters.length * 0.35 + 1) { lanternIgnite.t = -1; for (const e of pl.emitters) e.gain = 1; }
      }
      // the wheel turns
      if (wheel && wheelOn && (wheel.parent?.parent as THREE.Object3D | null)?.visible !== false) wheel.rotation.z -= f.dt * 0.9;
      // the millrace's chatter while the wheel turns (the audio system builds after this one: start it lazily)
      const near = wheelOn ? Math.max(0, 1 - Math.hypot(p.x - millSite.x, p.z - millSite.z) / 40) : 0;
      if (near > 0 && !millLoop) millLoop = audio()?.loop('millwheel', at('millwheel', 0, 0, MILL.wheelZ, new THREE.Vector3())) ?? null;
      if (millLoop) { if (near > 0) millLoop.setVolume(0.5 * near); else { millLoop.stop(); millLoop = null; } }
      // stargazing: the view narrows while you sit at the telescope
      const ctl = controller();
      if (stargaze.on && !ctl?.seated) stargaze.on = false;
      const target = stargaze.on ? 1 : 0;
      if (target || stargaze.k > 0.001) {
        if (stargaze.k <= 0.001 && target) stargaze.fov0 = ctx.camera.fov;
        stargaze.k = damp(stargaze.k, target, 3, f.dt);
        if (!target && stargaze.k < 0.01) stargaze.k = 0;
        const fov = stargaze.fov0 + (24 - stargaze.fov0) * stargaze.k;
        if (Math.abs(ctx.camera.fov - fov) > 0.01) { ctx.camera.fov = fov; ctx.camera.updateProjectionMatrix(); }
      }
      confetti.update(f.dt);
    },
    stats: () => ({ shown: [...places.values()].filter((p) => p.shown === 'done').length, confetti: confetti.mesh.visible ? 1 : 0 }),
    dispose() {
      for (const pl of places.values()) { for (const f of pl.offs) f(); pl.offs = []; }
      for (const f of boardOffs) f();
      millLoop?.stop(); millLoop = null;
      if (ctx.services.get('walkSurface') === walk) { if (prevWalk) ctx.services.set('walkSurface', prevWalk); else ctx.services.delete('walkSurface'); }
      if (ctx.services.get('projectsScene') === handle) ctx.services.delete('projectsScene');
      const geos = new Set<THREE.BufferGeometry>(), mats = new Set<THREE.Material>();
      const collect = (o: THREE.Object3D) => { const m = o as THREE.Mesh; if (m.isMesh) { geos.add(m.geometry); (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => mats.add(x)); } };
      root.traverse(collect);
      for (const pl of places.values()) { pl.ruin.traverse(collect); pl.done?.traverse(collect); }
      ctx.scene.remove(root);
      for (const g of geos) g.dispose();
      // (the Kit's shared toon material stays: other packages use it)
      for (const m of mats) {
        if ((m as THREE.MeshToonMaterial).isMeshToonMaterial) continue;
        (m as THREE.MeshBasicMaterial).map?.dispose();
        m.dispose();
      }
    },
  };
};
