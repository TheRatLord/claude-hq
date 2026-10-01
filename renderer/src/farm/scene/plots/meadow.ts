/**
 * Wild meadow on every plot site that has no field: tall grass tufts and wildflowers (two instanced meshes for the
 * whole valley) plus a "Plot for rent" sign. A field covers its site's meadow while it exists and lets it grow back
 * when it goes; each site's instances are only rewritten while its cover changes.
 */
import * as THREE from 'three';
import type { Season } from '../../model/types.ts';
import type { Site } from '../../world/map.ts';
import { signSpot } from '../../world/spots.ts';
import type { Batches } from './batch.ts';
import type { TextAtlas } from './atlas.ts';
import { signPainter } from './atlas.ts';
import { grassTuft, wildflower } from './crops.ts';
import { bounce, rng, smooth01 } from './geo.ts';
import { atlasMaterial, propMaterial } from './materials.ts';
import { SIGN_TEXT, signBoard, textQuad } from './models.ts';

interface Tuft { x: number; z: number; yaw: number; s: number; order: number }
interface SiteMeadow { site: Site; m: THREE.Matrix4; grass: Tuft[]; flowers: Tuft[]; g0: number; f0: number; shown: number; target: number; drawn: number }

const _m = new THREE.Matrix4(), _tm = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const FLOWER_TINTS = [0xffffff, 0xfff27a, 0xf49ac0, 0xb49af0, 0xff9a5a, 0x9ac8ff];

export class Meadow {
  readonly group = new THREE.Group();
  private readonly grass: THREE.InstancedMesh;
  private readonly flowers: THREE.InstancedMesh;
  private readonly sites: SiteMeadow[] = [];
  private rentRect: number[] | null = null;

  constructor(sites: readonly Site[], season: Season, mat: THREE.Material) {
    this.group.name = 'meadow';
    let ng = 0, nf = 0;
    for (const site of sites) {
      const r = rng(`meadow:${site.index}`);
      const root = new THREE.Object3D();
      root.position.set(site.x, site.y, site.z);
      root.rotation.y = site.yaw;
      root.updateMatrix();
      const hw = site.w / 2 + 0.3, hd = site.d / 2 + 0.3;
      const grass: Tuft[] = [], flowers: Tuft[] = [];
      // clumpy distribution: tufts gather around a few seeds so it reads as wild, not planted
      const seeds = Array.from({ length: 7 }, () => ({ x: (r() * 2 - 1) * hw, z: (r() * 2 - 1) * hd }));
      for (let i = 0; i < 280; i++) {
        const s = seeds[i % seeds.length];
        const x = i < 90 ? (r() * 2 - 1) * hw : s.x + (r() - 0.5) * 6, z = i < 90 ? (r() * 2 - 1) * hd : s.z + (r() - 0.5) * 5;
        if (Math.abs(x) > hw || Math.abs(z) > hd) continue;
        // taller towards the clump centres
        const d = Math.hypot(x - s.x, z - s.z);
        grass.push({ x, z, yaw: r() * Math.PI * 2, s: (0.85 + r() * 0.45) * (i < 90 ? 0.85 : 1.2 - Math.min(0.4, d * 0.1)), order: r() });
      }
      for (let i = 0; i < 120; i++) {
        const s = seeds[(i * 3) % seeds.length];
        const x = s.x + (r() - 0.5) * 7, z = s.z + (r() - 0.5) * 6;
        if (Math.abs(x) > hw || Math.abs(z) > hd) continue;
        flowers.push({ x, z, yaw: r() * Math.PI * 2, s: 1.0 + r() * 0.7, order: r() });
      }
      this.sites.push({ site, m: root.matrix.clone(), grass, flowers, g0: ng, f0: nf, shown: 1, target: 1, drawn: -1 });
      ng += grass.length; nf += flowers.length;
    }
    this.grass = new THREE.InstancedMesh(grassTuft(season), mat, ng);
    this.flowers = new THREE.InstancedMesh(wildflower(), mat, nf);
    this.flowers.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(nf * 3).fill(1), 3);
    const c = new THREE.Color();
    for (const sm of this.sites) sm.flowers.forEach((f, i) => this.flowers.setColorAt(sm.f0 + i, c.set(FLOWER_TINTS[Math.floor(f.order * 97) % FLOWER_TINTS.length])));
    for (const m of [this.grass, this.flowers]) { m.frustumCulled = false; m.receiveShadow = true; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.group.add(m); }
  }

  /** set how much of each site is covered by a field (0 = full meadow) */
  setCover(index: number, cover: number): void { const s = this.sites[index]; if (s) s.target = 1 - cover; }

  update(dt: number, batches: Batches, atlas: TextAtlas, season: Season, time: number): void {
    const m = _m, q = _q, v = _v, s = _s, up = _up;
    let dirtyG = false;
    for (const sm of this.sites) {
      sm.shown = sm.target < sm.shown ? sm.target : sm.shown + Math.min(sm.target - sm.shown, dt * 0.6);
      if (Math.abs(sm.shown - sm.drawn) > 0.004 || sm.drawn < 0) {
        sm.drawn = sm.shown;
        dirtyG = true;
        const write = (mesh: THREE.InstancedMesh, list: Tuft[], base: number) => list.forEach((t, i) => {
          const k = smooth01((sm.shown * 1.4 - t.order * 0.4));
          q.setFromAxisAngle(up, t.yaw);
          m.compose(v.set(t.x, 0, t.z), q, s.setScalar(Math.max(1e-4, t.s * k))).premultiply(sm.m);
          mesh.setMatrixAt(base + i, m);
        });
        write(this.grass, sm.grass, sm.g0);
        write(this.flowers, sm.flowers, sm.f0);
      }
      // "Plot for rent" sign on bare meadow
      if (sm.shown > 0.6) {
        if (!this.rentRect) this.rentRect = atlas.acquire('sign:rent', signPainter('Plot for rent', 'open a workspace to farm here', 0x8fbf5a));
        const k = bounce((sm.shown - 0.6) / 0.4);
        const sp = signSpot(sm.site);
        const board = batches.get(`sign:${season}`, () => ({ geo: signBoard(season), mat: propMaterial(), cap: 48, shadow: true }));
        const text = batches.get('signtext', () => ({ geo: textQuad().clone(), mat: atlasMaterial(atlas.tex), cap: 160, rect: true }));
        q.setFromAxisAngle(up, sm.site.yaw + 0.12 + Math.sin(time * 0.9 + sm.site.index) * 0.01);
        const bm = m.compose(v.set(sp.x, sm.site.y - 0.05, sp.z), q, s.setScalar(k * 0.85));
        board.push(bm);
        const tm = _tm.compose(v.set(0, SIGN_TEXT.y, SIGN_TEXT.z), q.identity(), s.set(SIGN_TEXT.w, SIGN_TEXT.h, 1)).premultiply(bm);
        text.push(tm, null, this.rentRect);
      }
    }
    if (dirtyG) { this.grass.instanceMatrix.needsUpdate = true; this.flowers.instanceMatrix.needsUpdate = true; }
  }

  dispose(): void { this.group.removeFromParent(); this.grass.dispose(); this.flowers.dispose(); }
}
