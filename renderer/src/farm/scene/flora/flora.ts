/**
 * Flora: every tree, bush, grass tuft, flower, rock, log, stump and mushroom in the valley, instanced per model and
 * culled per cell (cells.ts). Grass and flowers sway in the wind and shrink away with distance; trees sway gently.
 * Seasons swap the geometries (blossom, lush, autumn colour, bare + snow) and repaint the grass to match the ground.
 * Autumn leaves / spring petals / summer seed fluff drift around the player (GPU-animated cards).
 */
import * as THREE from 'three';
import type { SceneCtx, SystemFactory } from '../context.ts';
import type { Season } from '../../model/types.ts';
import { toon } from '../toon.ts';
import { groundColor } from '../terrain/ground.ts';
import { hash2 } from '../../world/noise.ts';
import { CellInstancer } from './cells.ts';
import type { CellOpts, Item } from './cells.ts';
import { flowerColor, scatter } from './scatter.ts';
import type { FlowerKind } from './scatter.ts';
import {
  TREE_KINDS, bushGeometry, cloverGeometry, flowerGeometry, leafCardGeometry, logGeometry, meadowRockGeometry, molehillGeometry,
  mushroomGeometry, stumpGeometry, treeGeometry, tuftGeometry,
} from './species.ts';
import type { BushKind } from './species.ts';
import { WIND, sway, syncWind } from './wind.ts';
import { ivyMesh, layoutIvy } from './ivy.ts';
import { heightAt } from '../../world/map.ts';
import { SURF, withSurfaces } from '../surface/index.ts';

interface Set_ { inst: CellInstancer; build(season: Season): THREE.BufferGeometry; recolor?(season: Season): void }

const TREE_SEED: Record<string, number> = { round: 3, lolly: 5, bushy: 8, oak: 2, birch: 4, pine: 6, fir: 9, willow: 1, hero: 7 };

/** Drifting leaves / petals / fluff around the camera: one instanced draw, positions computed in the vertex shader. */
function drifters(): { mesh: THREE.InstancedMesh; u: { uTime: { value: number }; uCam: { value: THREE.Vector3 }; uAmount: { value: number } }; setSeason(s: Season): void } {
  const n = 90;
  const u = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uAmount: { value: 0 } };
  const mat = toon(0xffffff, { shared: false, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, WIND);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uTime, uAmount; uniform vec3 uCam; uniform float uWTime; uniform vec2 uWDir; uniform float uWStrength;
float dh(float n) { return fract(sin(n * 91.345) * 47453.5453); }`)
      .replace('#include <begin_vertex>', `
float id = float(gl_InstanceID);
float life = fract(uTime * (0.05 + dh(id + 4.0) * 0.04) + dh(id + 3.0));
vec3 box = vec3(36.0, 9.0, 36.0);
vec3 p0 = vec3(dh(id) , 1.0 - life, dh(id + 1.0)) * box;
p0.xz += uWDir * life * 10.0 * (0.4 + uWStrength * 0.4);
p0.x += sin(uTime * 1.1 + id) * 0.8; p0.z += cos(uTime * 0.9 + id * 1.3) * 0.8;
vec3 wp = vec3(uCam.x - box.x * 0.5 + mod(p0.x - uCam.x, box.x), uCam.y - 2.5 + p0.y, uCam.z - box.z * 0.5 + mod(p0.z - uCam.z, box.z));
float spin = uTime * (1.5 + dh(id + 7.0) * 2.0) + id;
mat3 R = mat3(cos(spin), sin(spin) * 0.5, sin(spin), 0.0, 1.0, 0.0, -sin(spin), 0.0, cos(spin));
float vis = uAmount * step(dh(id + 9.0), uAmount) * smoothstep(0.0, 0.1, life) * smoothstep(1.0, 0.85, life);
vec3 transformed = wp + R * position * (1.6 * vis);`)
      .replace('#include <project_vertex>', `vec4 mvPosition = viewMatrix * vec4(transformed, 1.0); gl_Position = projectionMatrix * mvPosition;`)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);');
  };
  mat.customProgramCacheKey = () => 'land-drifters';
  const mesh = new THREE.InstancedMesh(leafCardGeometry(), mat, n);
  mesh.frustumCulled = false;
  mesh.name = 'drifters';
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) mesh.setMatrixAt(i, m);
  const colors: Record<Season, number[]> = {
    spring: [0xf7b7cf, 0xfff0f5, 0xf29ab8], summer: [0xfffbe8, 0xf8f4e0, 0xffffff],
    autumn: [0xe07a2a, 0xd0452a, 0xf0b83a, 0xb8652a], winter: [0xffffff],
  };
  const c = new THREE.Color();
  return {
    mesh, u,
    setSeason(s) {
      const pal = colors[s];
      for (let i = 0; i < n; i++) mesh.setColorAt(i, c.set(pal[i % pal.length]));
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      u.uAmount.value = s === 'autumn' ? 0.9 : s === 'spring' ? 0.6 : s === 'summer' ? 0.25 : 0;
    },
  };
}

export const floraSystem: SystemFactory = (ctx: SceneCtx) => {
  let season: Season = ctx.valley.sky.season;
  const S = scatter();
  const root = new THREE.Group();
  root.name = 'flora';
  // what later systems must not plant things in (structures' dressing keeps its lamp posts out of trunks and bushes)
  const solids: { x: number; z: number; r: number }[] = [];
  for (const list of Object.values(S.trees)) for (const t of list) solids.push({ x: t.x, z: t.z, r: 1.2 * t.s });
  for (const list of Object.values(S.bushes)) for (const b of list) solids.push({ x: b.x, z: b.z, r: 0.95 * b.s });
  ctx.services.set('floraSolids', { blocked: (x: number, z: number, r: number) => solids.some((q) => Math.hypot(q.x - x, q.z - z) < q.r + r) });

  // surfaces: parts are tagged in species.ts (bark, leaves, needles, logs, rock); patterns use the rest pose, so wind never swims them
  const treeMat = withSurfaces(sway(toon(0xffffff, { vertexColors: true, shared: false }), { mode: 'tree', amount: 0.07, pivot: 2.2 }), { surfaces: ['bark', 'leaves'] });
  const bushMat = withSurfaces(sway(toon(0xffffff, { vertexColors: true, shared: false }), { amount: 0.05 }), { surface: SURF.leaves, surfaces: ['leaves'] });
  const grassMat = sway(toon(0xffffff, { vertexColors: true, shared: false, side: THREE.DoubleSide }), { amount: 0.5, fade: 40 });
  const tallMat = sway(toon(0xffffff, { vertexColors: true, shared: false, side: THREE.DoubleSide }), { amount: 0.32, fade: 56 });
  const flowerMat = sway(toon(0xffffff, { vertexColors: true, shared: false, side: THREE.DoubleSide }), { amount: 0.4, fade: 60, maskTint: true });
  const cloverMat = sway(toon(0xffffff, { vertexColors: true, shared: false, side: THREE.DoubleSide }), { amount: 0.1, fade: 32 });
  const solidMat = withSurfaces(toon(0xffffff, { vertexColors: true, shared: false }), { surfaces: ['rock', 'logs', 'bark', 'dirt'] });
  const mats = [treeMat, bushMat, grassMat, tallMat, flowerMat, cloverMat, solidMat];

  const sets: Set_[] = [];
  const add = (name: string, items: Item[], build: (s: Season) => THREE.BufferGeometry, mat: THREE.Material, o: CellOpts, recolor?: (s: Season) => void) => {
    if (!items.length) return;
    recolor?.(season);
    const inst = new CellInstancer(name, build(season), mat, items, o, season);
    sets.push({ inst, build, recolor });
    root.add(inst.mesh);
  };

  for (const kind of TREE_KINDS) {
    const tall = kind === 'hero' ? 26 : kind === 'pine' || kind === 'fir' ? 12 : 9;
    add(`tree-${kind}`, S.trees[kind], (s) => treeGeometry(kind, s, TREE_SEED[kind]), treeMat, { cell: 24, far: 420, height: tall, keep: 34, castShadow: true, colors: true });
  }
  for (const kind of ['bush', 'berry', 'hedge'] as BushKind[]) {
    add(`bush-${kind}`, S.bushes[kind], (s) => bushGeometry(kind, s, 2), bushMat, { cell: 20, far: 170, height: 2, keep: 20, castShadow: true, colors: true });
  }
  // grass takes the ground's grass colour (never the path dirt: no yellow tufts at path edges), each tuft a little
  // lighter/darker and warmer/cooler than its neighbours
  const tuftTint = (items: Item[], samples: typeof S.tuftSamples) => (s: Season) => {
    items.forEach((it, i) => {
      const t = (it.tint ??= new THREE.Color());
      groundColor(samples[i], s, t, 'grass');
      const l = (hash2(it.x * 3.7, it.z * 3.7) - 0.5) * 0.16, w = (hash2(it.x * 2.3 + 9, it.z * 2.3) - 0.5) * 0.12;
      t.setRGB(t.r * (1 + l + w), t.g * (1 + l), t.b * (1 + l - w * 1.5));
    });
  };
  add('grass', S.tufts, (s) => tuftGeometry(false, s, 1), grassMat, { cell: 10, far: 40, height: 0.5, colors: true, receiveShadow: true }, tuftTint(S.tufts, S.tuftSamples));
  add('grass-short', S.short, (s) => tuftGeometry(false, s, 3, true), grassMat, { cell: 8, far: 18, height: 0.2, colors: true, receiveShadow: true }, tuftTint(S.short, S.shortSamples));
  add('grass-tall', S.tall, (s) => tuftGeometry(true, s, 2), tallMat, { cell: 10, far: 56, height: 1, colors: true }, tuftTint(S.tall, S.tallSamples));
  for (const kind of ['daisy', 'bell', 'tall'] as FlowerKind[]) {
    const items = S.flowers[kind];
    add(`flowers-${kind}`, items, () => flowerGeometry(kind, 3), flowerMat, { cell: 12, far: 60, height: 0.8, colors: true },
      (s) => { for (const it of items) flowerColor(s, S.flowerSlot.get(it) ?? 0, it.tint!); });
  }
  add('clover', S.clover, (s) => cloverGeometry(s, 1), cloverMat, { cell: 12, far: 32, height: 0.3, colors: false });
  add('meadow-rocks', S.rocks, (s) => meadowRockGeometry(s, 1), solidMat, { cell: 24, far: 170, height: 2, keep: 16, castShadow: true });
  add('logs', S.logs, (s) => logGeometry(s, 1), solidMat, { cell: 24, far: 130, height: 1, keep: 12, castShadow: true });
  add('stumps', S.stumps, (s) => stumpGeometry(s, 1), solidMat, { cell: 24, far: 110, height: 1, keep: 12, castShadow: true });
  add('mushrooms', S.mushrooms, (s) => mushroomGeometry(s, 1), solidMat, { cell: 16, far: 50, height: 0.4 });
  add('molehills', S.molehills, (s) => molehillGeometry(s, 1), solidMat, { cell: 20, far: 90, height: 0.3 });
  // ivy drapes: walked down their risers once, merged into a few sector meshes (three frustum-culls them; no per-frame work)
  const ivyLayout = layoutIvy(S.ivy, heightAt);
  const ivyMat = toon(0xffffff, { vertexColors: true, shared: false });
  mats.push(ivyMat);
  const IVY_SECTORS = 6;
  const ivySectors: number[][] = Array.from({ length: IVY_SECTORS }, () => []);
  S.ivy.forEach((d, i) => ivySectors[Math.floor(((Math.atan2(d.z, d.x) / (Math.PI * 2)) + 1) * IVY_SECTORS) % IVY_SECTORS].push(i));
  const ivyMeshes = ivySectors.filter((l) => l.length).map((list, i) => {
    const m = new THREE.Mesh(ivyMesh(ivyLayout, season, list), ivyMat);
    m.name = `ivy:${i}`;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    root.add(m);
    return { m, list };
  });
  const ivySeason = (s: Season) => { for (const { m, list } of ivyMeshes) { m.geometry.dispose(); m.geometry = ivyMesh(ivyLayout, s, list); } };

  // trunks are solid where the player can walk
  const unCollide: (() => void)[] = [];
  const TRUNK: Partial<Record<string, number>> = { round: 0.3, lolly: 0.28, bushy: 0.32, oak: 0.55, birch: 0.2, pine: 0.3, fir: 0.28, willow: 0.42, hero: 1.2 };
  for (const kind of TREE_KINDS) for (const it of S.trees[kind]) {
    if (Math.hypot(it.x, it.z) < 124) unCollide.push(ctx.colliders.circle(it.x, it.z, (TRUNK[kind] ?? 0.3) * it.s));
  }

  const drift = drifters();
  drift.setSeason(season);
  root.add(drift.mesh);
  ctx.scene.add(root);

  // culling state
  const cam = ctx.camera;
  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4();
  const lastPos = new THREE.Vector3(Infinity, 0, 0), lastDir = new THREE.Vector3(), dir = new THREE.Vector3(), camPos = new THREE.Vector3();
  let sinceCull = 0, cullMs = 0;
  const farScale = ctx.quality === 'low' ? 0.6 : ctx.quality === 'medium' ? 0.8 : 1;

  const setSeason = (s: Season) => {
    season = s;
    for (const set of sets) {
      set.recolor?.(s);
      set.inst.setGeometry(set.build(s));
      set.inst.setSeason(s);
    }
    ivySeason(s);
    drift.setSeason(s);
    lastPos.set(Infinity, 0, 0);
  };

  return {
    name: 'flora',
    update(f) {
      syncWind(ctx, f.dt);
      const s = ctx.valley.sky.season;
      if (s !== season) setSeason(s);
      cam.updateMatrixWorld();
      cam.getWorldPosition(camPos);
      cam.getWorldDirection(dir);
      drift.u.uTime.value = f.time;
      drift.u.uCam.value.copy(camPos);
      sinceCull++;
      if (camPos.distanceToSquared(lastPos) > 2.25 || dir.dot(lastDir) < 0.985 || sinceCull > 90) {
        const t0 = performance.now();
        pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
        frustum.setFromProjectionMatrix(pv);
        for (const set of sets) set.inst.cull(camPos, frustum, farScale);
        lastPos.copy(camPos); lastDir.copy(dir); sinceCull = 0;
        cullMs = performance.now() - t0;
      }
    },
    stats() {
      const out: Record<string, number> = { cullMs: Math.round(cullMs * 100) / 100 };
      for (const set of sets) out[set.inst.mesh.name] = set.inst.visible;
      return out;
    },
    dispose() {
      ctx.scene.remove(root);
      ctx.services.delete('floraSolids');
      for (const u of unCollide) u();
      for (const set of sets) set.inst.dispose();
      for (const { m } of ivyMeshes) m.geometry.dispose();
      for (const m of mats) m.dispose();
      drift.mesh.geometry.dispose();
      (drift.mesh.material as THREE.Material).dispose();
    },
  };
};
