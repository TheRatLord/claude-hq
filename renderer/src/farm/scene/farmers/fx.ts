/**
 * Farmer fx, each a single draw call: instanced atlas billboards (emotes, "!"), round particles (water droplets,
 * confetti, dust, sparkles, egg shell), and soft light columns over farmers who need you.
 */
import * as THREE from 'three';
import { billboardMaterial, beaconMaterial, particleMaterial } from './mat.ts';
import { emoteAtlas } from './atlas.ts';

export class Billboards {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private a: Record<'iPos' | 'iSize' | 'iCell' | 'iAlpha' | 'iGlow' | 'iRot', THREE.InstancedBufferAttribute>;
  private n = 0;
  readonly cap: number;
  constructor(cap = 256) {
    this.cap = cap;
    const q = new THREE.PlaneGeometry(1, 1);
    q.translate(0, 0.5, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.index = q.index;
    g.setAttribute('position', q.attributes.position);
    g.setAttribute('uv', q.attributes.uv);
    const mk = (k: number) => new THREE.InstancedBufferAttribute(new Float32Array(cap * k), k).setUsage(THREE.DynamicDrawUsage);
    this.a = { iPos: mk(3), iSize: mk(1), iCell: mk(1), iAlpha: mk(1), iGlow: mk(1), iRot: mk(1) };
    for (const [k, v] of Object.entries(this.a)) g.setAttribute(k, v);
    g.instanceCount = 0;
    this.geo = g;
    this.mesh = new THREE.Mesh(g, billboardMaterial(emoteAtlas()));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.name = 'farmer-emotes';
  }
  begin(): void { this.n = 0; }
  push(x: number, y: number, z: number, size: number, cell: number, alpha = 1, glow = 1, rot = 0): void {
    if (this.n >= this.cap || alpha <= 0.01 || size <= 0.001) return;
    const i = this.n++;
    const a = this.a;
    a.iPos.setXYZ(i, x, y, z); a.iSize.setX(i, size); a.iCell.setX(i, cell); a.iAlpha.setX(i, alpha); a.iGlow.setX(i, glow); a.iRot.setX(i, rot);
  }
  end(): void {
    this.geo.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    for (const v of Object.values(this.a)) { v.needsUpdate = true; v.clearUpdateRanges(); v.addUpdateRange(0, this.n * v.itemSize); }
  }
}

export class Particles {
  readonly points: THREE.Points;
  private pos: Float32Array; private vel: Float32Array; private life: Float32Array; private max: Float32Array;
  private size0: Float32Array; private grav: Float32Array; private col: Float32Array; private size: Float32Array; private alpha: Float32Array;
  private geo: THREE.BufferGeometry;
  private next = 0;
  readonly cap: number;
  constructor(cap = 800) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3); this.vel = new Float32Array(cap * 3); this.life = new Float32Array(cap); this.max = new Float32Array(cap);
    this.size0 = new Float32Array(cap); this.grav = new Float32Array(cap); this.col = new Float32Array(cap * 3); this.size = new Float32Array(cap); this.alpha = new Float32Array(cap);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.points = new THREE.Points(g, particleMaterial());
    this.points.frustumCulled = false;
    this.points.renderOrder = 9;
    this.points.name = 'farmer-particles';
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: number | THREE.Color, gravity = 9.8): void {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.max[i] = life; this.size0[i] = size; this.grav[i] = gravity;
    const c = typeof color === 'number' ? _c.setHex(color) : color;
    this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
  }
  update(dt: number, scale: number): void {
    let live = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; this.size[i] = 0; continue; }
      live++;
      this.life[i] -= dt;
      const j = i * 3;
      this.vel[j + 1] -= this.grav[i] * dt;
      const drag = Math.exp(-1.5 * dt);
      this.vel[j] *= drag; this.vel[j + 2] *= drag;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      const f = Math.max(0, this.life[i] / this.max[i]);
      this.alpha[i] = Math.min(1, f * 3);
      this.size[i] = this.size0[i] * (0.6 + 0.4 * f);
    }
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = scale;
    this.points.visible = live > 0;
    for (const k of ['position', 'pcolor', 'size', 'alpha']) (this.geo.getAttribute(k) as THREE.BufferAttribute).needsUpdate = true;
  }
}
const _c = new THREE.Color();

export class Beacons {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private alpha: THREE.InstancedBufferAttribute;
  private m = new THREE.Matrix4();
  constructor(cap = 32) {
    const g = new THREE.CylinderGeometry(0.35, 0.6, 1, 12, 1, true);
    g.translate(0, 0.5, 0);
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iAlpha', this.alpha);
    this.mesh = new THREE.InstancedMesh(g, beaconMaterial(), cap);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.name = 'farmer-beacons';
    this.mesh.count = 0;
  }
  begin(time: number): void { this.n = 0; (this.mesh.material as THREE.ShaderMaterial).uniforms.uTime.value = time; }
  push(x: number, y: number, z: number, height: number, width: number, alpha: number): void {
    if (this.n >= this.mesh.instanceMatrix.count || alpha < 0.01) return;
    this.m.makeScale(width, height, width).setPosition(x, y, z);
    this.mesh.setMatrixAt(this.n, this.m);
    this.alpha.setX(this.n, alpha);
    this.n++;
  }
  end(): void {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alpha.needsUpdate = true;
  }
}
