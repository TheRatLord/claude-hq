/**
 * Cell-culled instancing. Instances are bucketed into a grid of cells; `cull()` copies the matrices (and colours) of
 * the cells that are near enough and inside the (padded) view frustum into one InstancedMesh. Cheap to refresh (a few
 * typed-array copies), so it only runs when the camera has moved or turned noticeably.
 */
import * as THREE from 'three';
import type { Season } from '../../model/types.ts';

export const SEASON_BIT: Record<Season, number> = { spring: 1, summer: 2, autumn: 4, winter: 8 };
export const ALL_SEASONS = 15;

export interface Item {
  x: number; y: number; z: number;
  /** uniform scale (or sx/sy/sz) */
  s: number;
  yaw: number;
  sy?: number;
  /** small tilt (radians) about x/z */
  tx?: number; tz?: number;
  /** instance colour (multiplies vertex colours) */
  tint?: THREE.Color;
  /** seasons the item shows in (SEASON_BIT mask); default all */
  seasons?: number;
}

interface Cell { cx: number; cz: number; cy: number; mats: Float32Array; cols: Float32Array | null; n: number }

export interface CellOpts {
  /** cell edge in metres */
  cell: number;
  /** cull cells further than this from the camera (xz) */
  far: number;
  /** tallest item (pads the cell's bounding sphere) */
  height: number;
  /** cells within this distance are always kept (shadow casters behind the camera) */
  keep?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  colors?: boolean;
}

const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), vp = new THREE.Vector3(), vs = new THREE.Vector3();
const sphere = new THREE.Sphere();

export class CellInstancer {
  readonly mesh: THREE.InstancedMesh;
  readonly items: Item[];
  private cells: Cell[] = [];
  private o: CellOpts;
  visible = 0;

  constructor(name: string, geo: THREE.BufferGeometry, mat: THREE.Material, items: Item[], o: CellOpts, season: Season) {
    this.items = items;
    this.o = o;
    this.mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = !!o.castShadow;
    this.mesh.receiveShadow = o.receiveShadow ?? true;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (o.colors) {
      this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, items.length) * 3), 3);
      this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    this.setSeason(season);
  }

  /** Re-bucket for a season (items outside the season's mask drop out). */
  setSeason(season: Season): void {
    const bit = SEASON_BIT[season], C = this.o.cell;
    const byKey = new Map<string, Item[]>();
    for (const it of this.items) {
      if (it.seasons !== undefined && !(it.seasons & bit)) continue;
      const k = `${Math.floor(it.x / C)},${Math.floor(it.z / C)}`;
      let a = byKey.get(k);
      if (!a) byKey.set(k, (a = []));
      a.push(it);
    }
    this.cells = [];
    for (const [k, list] of byKey) {
      const [i, j] = k.split(',').map(Number);
      const mats = new Float32Array(list.length * 16);
      const cols = this.o.colors ? new Float32Array(list.length * 3) : null;
      let cy = 0;
      list.forEach((it, n) => {
        e.set(it.tx ?? 0, it.yaw, it.tz ?? 0);
        m4.compose(vp.set(it.x, it.y, it.z), q.setFromEuler(e), vs.set(it.s, it.s * (it.sy ?? 1), it.s));
        m4.toArray(mats, n * 16);
        if (cols) { const t = it.tint; cols[n * 3] = t ? t.r : 1; cols[n * 3 + 1] = t ? t.g : 1; cols[n * 3 + 2] = t ? t.b : 1; }
        cy += it.y;
      });
      this.cells.push({ cx: (i + 0.5) * C, cz: (j + 0.5) * C, cy: cy / list.length, mats, cols, n: list.length });
    }
  }

  setGeometry(g: THREE.BufferGeometry): void {
    const old = this.mesh.geometry;
    this.mesh.geometry = g;
    if (old !== g) old.dispose();
  }

  cull(cam: THREE.Vector3, frustum: THREE.Frustum, farScale = 1): void {
    const o = this.o, far = o.far * farScale, keep = o.keep ?? 0;
    const rad = o.cell * 0.72 + o.height;
    const dst = this.mesh.instanceMatrix.array as Float32Array;
    const cdst = this.mesh.instanceColor?.array as Float32Array | undefined;
    let n = 0;
    for (const c of this.cells) {
      const d = Math.hypot(c.cx - cam.x, c.cz - cam.z);
      if (d - o.cell * 0.72 > far) continue;
      if (d > keep + o.cell) {
        sphere.center.set(c.cx, c.cy + o.height * 0.5, c.cz);
        sphere.radius = rad + 4;
        if (!frustum.intersectsSphere(sphere)) continue;
      }
      dst.set(c.mats, n * 16);
      if (cdst && c.cols) cdst.set(c.cols, n * 3);
      n += c.n;
    }
    this.mesh.count = n;
    this.visible = n;
    const im = this.mesh.instanceMatrix;
    im.clearUpdateRanges();
    im.addUpdateRange(0, n * 16);
    im.needsUpdate = true;
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.clearUpdateRanges();
      this.mesh.instanceColor.addUpdateRange(0, n * 3);
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void { this.mesh.geometry.dispose(); this.mesh.dispose(); }
}
