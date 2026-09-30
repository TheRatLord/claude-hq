/** Shared helpers for the life package: ground sampling, spot finding, shared fx pools (hearts, blob shadows, rings). */
import * as THREE from 'three';
import type { SceneCtx } from '../context.ts';
import type { ValleyAudio } from '../../audio/types.ts';
import { WORLD, clearance, heightAt, slopeAt } from '../../world/map.ts';
import { RigPool } from './rig.ts';
import { blobGeometry, heart, ringGeometry } from './models.ts';

export type Rng = () => number;

export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const damp = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
export const wrap = (a: number) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
export const dampAngle = (cur: number, target: number, rate: number, dt: number) => cur + wrap(target - cur) * (1 - Math.exp(-rate * dt));
export const smooth01 = (t: number) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

/** Ground (or walkable deck/porch) height under x, z. */
export function groundY(ctx: SceneCtx, x: number, z: number): number {
  const h = heightAt(x, z);
  const ws = ctx.services.get('walkSurface') as ((x: number, z: number) => number | null) | undefined;
  const w = ws ? ws(x, z) : null;
  return w !== null && w !== undefined && w > h ? w : h;
}

/** Dry, gentle, open ground that is not inside a registered solid. */
export function openGround(ctx: SceneCtx, x: number, z: number, r = 0.3): boolean {
  if (Math.hypot(x, z) > 118) return false;
  if (heightAt(x, z) < WORLD.water + 0.25) return false;
  if (slopeAt(x, z) > 0.28) return false;
  return !ctx.colliders.blocked(x, z, r);
}

/** Grid-sampled candidate spots in a clearance band (computed once; filtered live with `openGround`). */
export function sampleSpots(step: number, radius: number, minClear: number, maxClear: number, rng: Rng, maxHeight = 14): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let x = -radius; x <= radius; x += step) for (let z = -radius; z <= radius; z += step) {
    const px = x + (rng() - 0.5) * step * 0.8, pz = z + (rng() - 0.5) * step * 0.8;
    if (Math.hypot(px, pz) > radius) continue;
    const c = clearance(px, pz);
    if (c < minClear || c > maxClear) continue;
    const h = heightAt(px, pz);
    if (h < WORLD.water + 0.3 || h > maxHeight || slopeAt(px, pz) > 0.22) continue;
    out.push({ x: px, z: pz });
  }
  return out;
}

export const audioOf = (ctx: SceneCtx): ValleyAudio | undefined => {
  const a = ctx.services.get('audio') as Partial<ValleyAudio> | undefined;
  return a && typeof a.play === 'function' ? a as ValleyAudio : undefined;
};

const _snd = new THREE.Vector3();
/** Positional critter sound if the player is within `range` metres (avoids waking the audio graph for far critters). */
export function critterSound(ctx: SceneCtx, kind: Parameters<ValleyAudio['critter']>[0], x: number, y: number, z: number, range = 30, volume = 1, pitch = 1): void {
  const p = ctx.player.eye;
  if ((p.x - x) ** 2 + (p.z - z) ** 2 > range * range) return;
  const a = audioOf(ctx);
  if (!a || typeof a.critter !== 'function') return;
  a.critter(kind, _snd.set(x, y, z), { volume, pitch });
}

// ---------------------------------------------------------------------------------------------
// Shared fx: pink hearts (pets), blob contact shadows, splash rings

interface Heart { on: boolean; x: number; y: number; z: number; vx: number; vz: number; age: number; life: number; spin: number }
interface Ring { on: boolean; x: number; y: number; z: number; age: number; life: number; size: number }

export class Fx {
  readonly hearts: RigPool;
  readonly shadows: THREE.InstancedMesh;
  readonly rings: THREE.InstancedMesh;
  private readonly hs: Heart[] = [];
  private readonly rs: Ring[] = [];
  private nShadow = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();

  private readonly ctx: SceneCtx;
  constructor(ctx: SceneCtx) {
    this.ctx = ctx;
    const h = heart();
    this.hearts = new RigPool(h.geo, h.spec, 24, { emissive: 0x5a1020 });
    for (let i = 0; i < 24; i++) this.hs.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vz: 0, age: 0, life: 1, spin: 0 });
    const sm = new THREE.MeshBasicMaterial({ color: 0x1a1830, transparent: true, opacity: 0.22, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.shadows = new THREE.InstancedMesh(blobGeometry(), sm, 48);
    this.shadows.frustumCulled = false;
    this.shadows.count = 0;
    this.shadows.renderOrder = 1;
    this.shadows.name = 'life:shadows';
    const rm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.rings = new THREE.InstancedMesh(ringGeometry(), rm, 24);
    this.rings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(24 * 3), 3);
    this.rings.frustumCulled = false;
    this.rings.count = 0;
    this.rings.name = 'life:rings';
    for (let i = 0; i < 24; i++) this.rs.push({ on: false, x: 0, y: 0, z: 0, age: 0, life: 1, size: 1 });
    this.hearts.mesh.name = 'life:hearts';
    ctx.scene.add(this.hearts.mesh, this.shadows, this.rings);
  }

  /** puff of hearts rising from a point */
  heartsAt(x: number, y: number, z: number, n = 4, rng: Rng = Math.random): void {
    for (let k = 0; k < n; k++) {
      const h = this.hs.find((v) => !v.on);
      if (!h) return;
      h.on = true; h.x = x + (rng() - 0.5) * 0.3; h.y = y + rng() * 0.15; h.z = z + (rng() - 0.5) * 0.3;
      h.vx = (rng() - 0.5) * 0.35; h.vz = (rng() - 0.5) * 0.35; h.age = -k * 0.14; h.life = 1.5 + rng() * 0.5; h.spin = rng() * TAU;
    }
  }

  ring(x: number, y: number, z: number, size = 1, life = 1.6): void {
    let r = this.rs.find((v) => !v.on);
    if (!r) { r = this.rs[0]; for (const v of this.rs) if (v.age / v.life > r.age / r.life) r = v; }
    r.on = true; r.x = x; r.y = y; r.z = z; r.age = 0; r.life = life; r.size = size;
  }

  begin(): void { this.nShadow = 0; }

  /** contact shadow under a critter (call every frame while it should show) */
  shadow(x: number, y: number, z: number, r: number, stretch = 1, yaw = 0): void {
    if (this.nShadow >= 48) return;
    this.e.set(0, yaw, 0);
    this.m.compose(this.p.set(x, y + 0.03, z), this.q.setFromEuler(this.e), this.s.set(r * 2, 1, r * 2 * stretch));
    this.shadows.setMatrixAt(this.nShadow++, this.m);
  }

  end(dt: number): void {
    this.shadows.count = this.nShadow;
    this.shadows.instanceMatrix.needsUpdate = true;
    // hearts: pop in, float up with a wobble, shrink out
    this.hearts.begin();
    const cam = this.ctx.camera.position;
    for (const h of this.hs) {
      if (!h.on) continue;
      h.age += dt;
      if (h.age < 0) continue;
      if (h.age > h.life) { h.on = false; continue; }
      const k = h.age / h.life;
      h.x += h.vx * dt; h.z += h.vz * dt; h.y += (0.55 - k * 0.2) * dt;
      const pop = k < 0.15 ? smooth01(k / 0.15) * 1.25 : k > 0.75 ? 1 - smooth01((k - 0.75) / 0.25) : 1.25 - (k - 0.15) * 0.4;
      const yaw = Math.atan2(cam.x - h.x, cam.z - h.z) + Math.sin(h.age * 5 + h.spin) * 0.35;
      const s = pop * 1.1;
      this.hearts.put(h.x + Math.sin(h.age * 4 + h.spin) * 0.06, h.y, h.z, yaw, 0, Math.sin(h.age * 3 + h.spin) * 0.2, s, s, s);
    }
    this.hearts.end();
    let n = 0;
    for (const r of this.rs) {
      if (!r.on) continue;
      r.age += dt;
      if (r.age > r.life) { r.on = false; continue; }
      const k = r.age / r.life;
      const s = r.size * (0.25 + 1.1 * (1 - (1 - k) * (1 - k)));
      this.m.compose(this.p.set(r.x, r.y + 0.02, r.z), this.q.identity(), this.s.set(s, 1, s));
      this.rings.setMatrixAt(n, this.m);
      const a = (1 - k) * (1 - k) * 0.55;
      this.rings.setColorAt(n, this.c.setRGB(a, a, a));
      n++;
    }
    this.rings.count = n;
    this.rings.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.ctx.scene.remove(this.hearts.mesh, this.shadows, this.rings);
    this.hearts.dispose();
    this.shadows.geometry.dispose(); (this.shadows.material as THREE.Material).dispose();
    this.rings.geometry.dispose(); (this.rings.material as THREE.Material).dispose();
  }
}
