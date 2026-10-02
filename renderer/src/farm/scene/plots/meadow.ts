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
import { bounce, rng, singleSided, smooth01 } from './geo.ts';
import { atlasMaterial, propMaterial } from './materials.ts';
import { SIGN_TEXT, signBoard, textQuad } from './models.ts';

interface Tuft { x: number; z: number; yaw: number; s: number; order: number }
interface SiteMeadow {
  site: Site; m: THREE.Matrix4; grass: Tuft[]; flowers: Tuft[]; shown: number; target: number; drawn: number;
  /** this site's showing tufts, packed (world matrices; flower tints): rewritten while its cover changes */
  gArr: Float32Array; gN: number; fArr: Float32Array; fCol: Float32Array; fN: number;
  /** bounds for the view test */
  sphere: THREE.Sphere;
}

const _c = new THREE.Color(), _frustum = new THREE.Frustum(), _pm = new THREE.Matrix4();
const _m = new THREE.Matrix4(), _tm = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const FLOWER_TINTS = [0xffffff, 0xfff27a, 0xf49ac0, 0xb49af0, 0xff9a5a, 0x9ac8ff];

export class Meadow {
  readonly group = new THREE.Group();
  private readonly grass: THREE.InstancedMesh;
  private readonly flowers: THREE.InstancedMesh;
  private readonly sites: SiteMeadow[] = [];
  private rentRect: number[] | null = null;
  /** bit per site: drawn now */
  private mask = -1;

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
      this.sites.push({
        site, m: root.matrix.clone(), grass, flowers, shown: 1, target: 1, drawn: -1,
        gArr: new Float32Array(grass.length * 16), gN: 0, fArr: new Float32Array(flowers.length * 16), fCol: new Float32Array(flowers.length * 3), fN: 0,
        sphere: new THREE.Sphere(new THREE.Vector3(site.x, site.y + 0.4, site.z), Math.hypot(hw, hd) + 1.5),
      });
      ng += grass.length; nf += flowers.length;
    }
    this.grass = new THREE.InstancedMesh(singleSided(grassTuft(season)), mat, ng);
    this.flowers = new THREE.InstancedMesh(singleSided(wildflower()), mat, nf);
    this.flowers.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(nf * 3).fill(1), 3);
    // the placement audit (dev/placement.ts) wants every tuft, not just the sites in view
    this.group.userData.uncull = () => { this.mask = -1; this.pack(); };
    for (const m of [this.grass, this.flowers]) { m.count = 0; m.frustumCulled = false; m.receiveShadow = true; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.group.add(m); }
  }

  /** set how much of each site is covered by a field (0 = full meadow) */
  setCover(index: number, cover: number): void { const s = this.sites[index]; if (s) s.target = 1 - cover; }

  /**
   * `camera`: only the sites in view are drawn (both meshes span the valley, so three cannot cull them): the packed
   * per-site blocks are copied into the instance buffers whenever the set in view (or a site's cover) changes.
   */
  update(dt: number, batches: Batches, atlas: TextAtlas, season: Season, time: number, camera?: THREE.Camera): void {
    const m = _m, q = _q, v = _v, s = _s, up = _up;
    let dirtyG = false;
    if (camera) {
      camera.updateMatrixWorld();
      _frustum.setFromProjectionMatrix(_pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    }
    let mask = 0;
    for (const sm of this.sites) {
      sm.shown = sm.target < sm.shown ? sm.target : sm.shown + Math.min(sm.target - sm.shown, dt * 0.6);
      if (Math.abs(sm.shown - sm.drawn) > 0.004 || sm.drawn < 0) { sm.drawn = sm.shown; this.writeSite(sm); dirtyG = true; }
      if (sm.gN + sm.fN > 0 && (!camera || _frustum.intersectsSphere(sm.sphere))) mask |= 1 << sm.site.index;
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
    if (dirtyG || mask !== this.mask) { this.mask = mask; this.pack(); }
  }

  /** a site's showing tufts (k > 0) into its packed block: covered sites (most of them in a busy valley) cost nothing */
  private writeSite(sm: SiteMeadow): void {
    const m = _m, q = _q, v = _v, s = _s, up = _up, c = _c;
    const write = (list: Tuft[], arr: Float32Array, col: Float32Array | null): number => {
      let n = 0;
      if (sm.shown <= 0) return 0;
      for (const t of list) {
        const k = smooth01((sm.shown * 1.4 - t.order * 0.4));
        if (k <= 0) continue;
        q.setFromAxisAngle(up, t.yaw);
        m.compose(v.set(t.x, 0, t.z), q, s.setScalar(Math.max(1e-4, t.s * k))).premultiply(sm.m).toArray(arr, n * 16);
        if (col) c.set(FLOWER_TINTS[Math.floor(t.order * 97) % FLOWER_TINTS.length]).toArray(col, n * 3);
        n++;
      }
      return n;
    };
    sm.gN = write(sm.grass, sm.gArr, null);
    sm.fN = write(sm.flowers, sm.fArr, sm.fCol);
  }

  /** copy the blocks of the sites in view into the instance buffers and draw just those */
  private pack(): void {
    const gm = this.grass.instanceMatrix.array as Float32Array, fm = this.flowers.instanceMatrix.array as Float32Array;
    const fc = this.flowers.instanceColor!.array as Float32Array;
    let ng = 0, nf = 0;
    for (const sm of this.sites) {
      if (!(this.mask & (1 << sm.site.index))) continue;
      gm.set(sm.gArr.subarray(0, sm.gN * 16), ng * 16); ng += sm.gN;
      fm.set(sm.fArr.subarray(0, sm.fN * 16), nf * 16);
      fc.set(sm.fCol.subarray(0, sm.fN * 3), nf * 3); nf += sm.fN;
    }
    this.grass.count = ng;
    this.flowers.count = nf;
    this.grass.instanceMatrix.needsUpdate = true;
    this.flowers.instanceMatrix.needsUpdate = true;
    this.flowers.instanceColor!.needsUpdate = true;
  }

  dispose(): void { this.group.removeFromParent(); this.grass.dispose(); this.flowers.dispose(); }
}
