/**
 * Per-frame instance batches: every animal part, helper, sign, cart and particle of every field is one InstancedMesh
 * per geometry, refilled each frame (begin → push… → end). Draw calls stay flat no matter how many fields exist.
 */
import * as THREE from 'three';

export class Batch {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private readonly cap: number;
  private readonly rect: THREE.InstancedBufferAttribute | null;
  private colored = false;

  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, o: { shadow?: boolean; rect?: boolean; name?: string } = {}) {
    this.cap = cap;
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.name = o.name ?? 'batch';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = !!o.shadow;
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;
    this.rect = null;
    if (o.rect) {
      this.rect = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      this.rect.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aRect', this.rect);
    }
  }

  begin(): void { this.n = 0; }

  /** returns the slot index or -1 when full */
  push(m: THREE.Matrix4, color?: THREE.Color | null, rect?: readonly number[]): number {
    if (this.n >= this.cap) return -1;
    const i = this.n++;
    this.mesh.setMatrixAt(i, m);
    if (color) {
      if (!this.colored) {
        this.colored = true;
        this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3).fill(1), 3);
        this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      }
      this.mesh.setColorAt(i, color);
    } else if (this.colored) this.mesh.instanceColor!.setXYZ(i, 1, 1, 1);
    if (rect && this.rect) this.rect.setXYZW(i, rect[0], rect[1], rect[2], rect[3]);
    return i;
  }

  /** append `count` precomputed world matrices (and optional rgb colours) in one copy */
  pushArray(mats: Float32Array, count: number, colors?: Float32Array | null): void {
    const n = Math.min(count, this.cap - this.n);
    if (n <= 0) return;
    (this.mesh.instanceMatrix.array as Float32Array).set(mats.subarray(0, n * 16), this.n * 16);
    if (colors) {
      if (!this.colored) {
        this.colored = true;
        this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3).fill(1), 3);
        this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      }
      (this.mesh.instanceColor!.array as Float32Array).set(colors.subarray(0, n * 3), this.n * 3);
    } else if (this.colored) (this.mesh.instanceColor!.array as Float32Array).fill(1, this.n * 3, (this.n + n) * 3);
    this.n += n;
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    if (!this.n) return;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, this.n * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.colored) { this.mesh.instanceColor!.clearUpdateRanges(); this.mesh.instanceColor!.addUpdateRange(0, this.n * 3); this.mesh.instanceColor!.needsUpdate = true; }
    if (this.rect) { this.rect.clearUpdateRanges(); this.rect.addUpdateRange(0, this.n * 4); this.rect.needsUpdate = true; }
  }

  get count(): number { return this.n; }
}

/** A named set of batches added under one parent. */
export class Batches {
  readonly group = new THREE.Group();
  private readonly map = new Map<string, Batch>();

  constructor() { this.group.name = 'plots-batches'; }

  get(key: string, make: () => { geo: THREE.BufferGeometry; mat: THREE.Material; cap: number; shadow?: boolean; rect?: boolean }): Batch {
    let b = this.map.get(key);
    if (!b) {
      const d = make();
      b = new Batch(d.geo, d.mat, d.cap, { shadow: d.shadow, rect: d.rect, name: `plots:${key}` });
      this.map.set(key, b);
      this.group.add(b.mesh);
    }
    return b;
  }

  begin(): void { for (const b of this.map.values()) b.begin(); }
  end(): void { for (const b of this.map.values()) b.end(); }
  stats(): Record<string, number> { const o: Record<string, number> = {}; for (const [k, b] of this.map) o[k] = b.count; return o; }
  dispose(): void { for (const b of this.map.values()) { b.mesh.geometry.dispose(); b.mesh.dispose(); } this.map.clear(); }
}
