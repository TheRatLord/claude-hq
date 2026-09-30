/**
 * Ducklings = subagents. They waddle in a line behind their farmer (trail following), hop when the farmer whistles
 * (delegate), hatch from an egg with a pop when a subagent spawns, and waddle off to the pond when one finishes.
 * Rendered as one InstancedMesh (+ one for egg shells).
 */
import * as THREE from 'three';
import { ducklingGeometry, eggGeometry } from './geo.ts';
import { addInstanceAttrs, rigDepthMaterial, rigMaterial } from './mat.ts';
import { trailAt } from './trail.ts';
import type { Trail } from './trail.ts';
import type { Duckling } from '../../model/types.ts';

export interface Duck {
  id: string;
  label: string;
  x: number; z: number; y: number; yaw: number;
  phase: number;
  /** 0..1 spawn pop */
  pop: number;
  /** seconds since hatching started (egg shown while < HATCH) */
  hatch: number;
  hop: number;
  speed: number;
  /** waddling home to the pond */
  home: { x: number; z: number } | null;
  fade: number;
  lastH: { x: number; z: number; h: number };
}

const HATCH = 0.9;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _o = { x: 0, z: 0 };

export class Ducks {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private eggs: THREE.InstancedMesh;
  private n = 0;
  private ne = 0;
  constructor(cap = 160) {
    const g = ducklingGeometry().clone();
    addInstanceAttrs(g, cap);
    this.mesh = new THREE.InstancedMesh(g, rigMaterial(), cap);
    this.mesh.customDepthMaterial = rigDepthMaterial();
    const eg = eggGeometry().clone();
    addInstanceAttrs(eg, 32);
    this.eggs = new THREE.InstancedMesh(eg, rigMaterial(), 32);
    for (const m of [this.mesh, this.eggs]) {
      m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
    }
    this.mesh.name = 'farmer-ducklings';
    this.eggs.name = 'farmer-eggs';
  }

  static make(d: Duckling, x: number, z: number, y: number, hatch: boolean): Duck {
    return { id: d.id, label: d.label, x, z, y, yaw: 0, phase: Math.random(), pop: hatch ? 0 : 1, hatch: hatch ? 0 : HATCH + 1, hop: 0, speed: 0, home: null, fade: 1, lastH: { x: 1e9, z: 0, h: y } };
  }

  begin(): void { this.n = 0; this.ne = 0; }

  /**
   * Step a following duckling: target a point `dist` back along the owner's trail; hop when `hop` is true.
   * Returns true when the duckling hatched this frame (for the pop sound / shell particles).
   */
  follow(d: Duck, trail: Trail, ox: number, oz: number, dist: number, dt: number, hop: boolean, height: (x: number, z: number) => number, ownerYaw: number, spot: { x: number; z: number } | null = null): boolean {
    let popped = false;
    if (d.hatch < HATCH) {
      d.hatch += dt;
      if (d.hatch >= HATCH) popped = true;
    } else d.pop = Math.min(1, d.pop + dt * 3);
    if (d.hatch >= HATCH) {
      if (spot) { _o.x = spot.x; _o.z = spot.z; } else trailAt(trail, ox, oz, dist, _o);
      this.walk(d, _o.x, _o.z, dt, 2.8, height);
      if (d.speed < 0.05) d.yaw = damp(d.yaw, Math.atan2(ox - d.x, oz - d.z), 3, dt, true);
    } else {
      d.yaw = ownerYaw + Math.PI;
      d.y = height(d.x, d.z);
    }
    d.hop = hop ? Math.max(0, Math.sin((performance.now() / 1000 + d.phase) * 7)) * 0.12 : damp(d.hop, 0, 8, dt);
    return popped;
  }

  /** Waddle toward the pond; returns true when gone. */
  goHome(d: Duck, dt: number, height: (x: number, z: number) => number): boolean {
    if (!d.home) return true;
    this.walk(d, d.home.x, d.home.z, dt, 1.6, height);
    if (Math.hypot(d.home.x - d.x, d.home.z - d.z) < 0.4) d.fade -= dt * 1.2;
    return d.fade <= 0;
  }

  private walk(d: Duck, tx: number, tz: number, dt: number, vmax: number, height: (x: number, z: number) => number) {
    const dx = tx - d.x, dz = tz - d.z, dist = Math.hypot(dx, dz);
    const want = dist > 0.08 ? Math.min(vmax, dist * 2.2) : 0;
    d.speed = damp(d.speed, want, 8, dt);
    if (dist > 1e-4) {
      const s = Math.min(dist, d.speed * dt);
      d.x += (dx / dist) * s; d.z += (dz / dist) * s;
      if (d.speed > 0.05) d.yaw = damp(d.yaw, Math.atan2(dx, dz), 10, dt, true);
    }
    d.phase += d.speed * dt * 3.2;
    if (Math.abs(d.x - d.lastH.x) + Math.abs(d.z - d.lastH.z) > 0.08) { d.lastH.x = d.x; d.lastH.z = d.z; d.lastH.h = height(d.x, d.z); }
    d.y = d.lastH.h;
  }

  draw(d: Duck, t: number): void {
    if (this.n >= this.mesh.instanceMatrix.count) return;
    const moving = Math.min(1, d.speed / 0.4);
    const w = Math.sin(d.phase * Math.PI * 2);
    const bob = Math.abs(w) * 0.03 * moving + d.hop;
    const peck = moving < 0.2 ? Math.max(0, Math.sin(t * 1.3 + d.phase * 9) - 0.85) * 3 : 0;
    const sc = d.fade * (d.pop < 1 ? easeOutBack(d.pop) : 1) * 1.1;
    if (d.hatch < HATCH) {
      // egg wobbles, then cracks
      const k = d.hatch / HATCH;
      const wob = Math.sin(t * 30) * 0.25 * k;
      this.egg(d.x, d.y, d.z, d.yaw, wob, 0, true);
      return;
    }
    if (d.hatch < HATCH + 0.6) this.egg(d.x - Math.sin(d.yaw) * 0.25, d.y, d.z - Math.cos(d.yaw) * 0.25, d.yaw, 0.6, (d.hatch - HATCH) / 0.6, false);
    _q.setFromEuler(_e.set(peck * 0.5, d.yaw, w * 0.22 * moving, 'YXZ'));
    _m.compose(_p.set(d.x, d.y + bob, d.z), _q, _s.set(sc, sc * (1 - bob * 0.8), sc));
    this.mesh.setMatrixAt(this.n++, _m);
  }

  private egg(x: number, y: number, z: number, yaw: number, tilt: number, fade: number, whole: boolean) {
    if (this.ne >= this.eggs.instanceMatrix.count) return;
    const sel = this.eggs.geometry.getAttribute('iSel') as THREE.InstancedBufferAttribute;
    sel.setX(this.ne, whole ? 1 : 0);
    sel.needsUpdate = true;
    const s = 1 - fade;
    _q.setFromEuler(_e.set(0, yaw, tilt, 'YXZ'));
    _m.compose(_p.set(x, y, z), _q, _s.set(s, s, s));
    this.eggs.setMatrixAt(this.ne++, _m);
  }

  end(): void {
    this.mesh.count = this.n; this.eggs.count = this.ne;
    this.mesh.visible = this.n > 0; this.eggs.visible = this.ne > 0;
    this.mesh.instanceMatrix.needsUpdate = true; this.eggs.instanceMatrix.needsUpdate = true;
  }
}

function damp(c: number, t: number, rate: number, dt: number, angle = false): number {
  let d = t - c;
  if (angle) d = Math.atan2(Math.sin(d), Math.cos(d));
  return c + d * (1 - Math.exp(-rate * dt));
}
export function easeOutBack(x: number): number { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2; }
