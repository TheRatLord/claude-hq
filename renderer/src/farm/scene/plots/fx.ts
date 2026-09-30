/**
 * Little effects for fields: hearts, Zzz, sparkles, dirt puffs, sprinkler drops, butterflies, crows, bees, lantern
 * halos. Transient particles live in a fixed pool; persistent critters are drawn directly each frame (`put`).
 */
import * as THREE from 'three';
import { PAL, toon } from '../toon.ts';
import type { Batch, Batches } from './batch.ts';
import { ball, box, cached, cone, dodec, leaf, merge, octa } from './geo.ts';

export type FxType = 'heart' | 'zzz' | 'sparkle' | 'puff' | 'drop' | 'butterfly' | 'crow' | 'bee' | 'halo' | 'note';

function heartGeo(): THREE.BufferGeometry {
  return cached('fx:heart', () => merge([
    ball(0.075, 0xffffff, { p: [-0.055, 0.03, 0] }), ball(0.075, 0xffffff, { p: [0.055, 0.03, 0] }),
    cone(0.105, 0.14, 4, 0xffffff, { p: [0, -0.06, 0], r: [Math.PI, Math.PI / 4, 0], s: [1.05, 1, 0.55] }),
  ]));
}
function zGeo(): THREE.BufferGeometry {
  return cached('fx:z', () => merge([
    box(0.16, 0.035, 0.03, 0xffffff, { p: [0, 0.07, 0] }), box(0.16, 0.035, 0.03, 0xffffff, { p: [0, -0.07, 0] }),
    box(0.035, 0.19, 0.03, 0xffffff, { r: [0, 0, -0.78] }),
  ]));
}
function sparkleGeo(): THREE.BufferGeometry {
  return cached('fx:sparkle', () => merge([octa(0.06, 0xffffff, { s: [0.35, 1.6, 0.35] }), octa(0.06, 0xffffff, { s: [1.6, 0.35, 0.35] })]));
}
function butterflyGeo(): THREE.BufferGeometry {
  return cached('fx:butterfly', () => merge([
    leaf(0.12, 0.13, 0xffffff, { r: [0, Math.PI / 2 + 0.4, 0] }), leaf(0.12, 0.13, 0xffffff, { r: [0, -Math.PI / 2 - 0.4, 0] }),
    leaf(0.08, 0.09, 0xffffff, { r: [0, Math.PI / 2 - 0.5, 0] }), leaf(0.08, 0.09, 0xffffff, { r: [0, -Math.PI / 2 + 0.5, 0] }),
    box(0.02, 0.02, 0.12, PAL.ink),
  ]));
}
function crowGeo(): THREE.BufferGeometry {
  return cached('fx:crow', () => merge([
    ball(0.13, 0x2a2630, { s: [0.8, 0.7, 1.4] }), ball(0.08, 0x2a2630, { p: [0, 0.05, 0.18] }),
    cone(0.03, 0.08, 4, 0xe0a030, { p: [0, 0.04, 0.29], r: [Math.PI / 2, 0, 0] }),
    leaf(0.42, 0.2, 0x3a3440, { p: [0.05, 0.02, 0], r: [0, Math.PI / 2, 0] }, 0.1), leaf(0.42, 0.2, 0x3a3440, { p: [-0.05, 0.02, 0], r: [0, -Math.PI / 2, 0] }, 0.1),
    cone(0.08, 0.2, 4, 0x2a2630, { p: [0, 0, -0.22], r: [-Math.PI / 2, 0, 0], s: [1, 1, 0.4] }),
  ]));
}
function beeGeo(): THREE.BufferGeometry {
  return cached('fx:bee', () => merge([
    ball(0.035, PAL.yellow, { s: [0.9, 0.9, 1.3] }), box(0.066, 0.02, 0.02, PAL.ink, { p: [0, 0, -0.005], s: [1.02, 3, 1] }),
    ball(0.025, 0xe8f4ff, { p: [0.03, 0.03, 0], s: [1, 0.3, 0.7] }), ball(0.025, 0xe8f4ff, { p: [-0.03, 0.03, 0], s: [1, 0.3, 0.7] }),
  ]));
}
function noteGeo(): THREE.BufferGeometry {
  return cached('fx:note', () => merge([ball(0.05, 0xffffff, { s: [1.2, 0.9, 0.5] }), box(0.02, 0.2, 0.02, 0xffffff, { p: [0.05, 0.1, 0] }), box(0.08, 0.03, 0.02, 0xffffff, { p: [0.08, 0.19, 0] })]));
}

let haloTex: THREE.Texture | null = null;
function haloTexture(): THREE.Texture {
  if (haloTex) return haloTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0.75)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.3)'); gr.addColorStop(0.65, 'rgba(255,255,255,0.08)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  haloTex = new THREE.CanvasTexture(c);
  return haloTex;
}

interface Particle { type: FxType; x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; size: number; color: THREE.Color; grav: number; spin: number }

const MAX = 600;

export class Fx {
  private readonly b: Record<FxType, Batch>;
  private readonly ps: Particle[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  camQuat = new THREE.Quaternion();

  constructor(batches: Batches) {
    const basic = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const lit = toon(0xffffff, { vertexColors: true });
    const halo = new THREE.MeshBasicMaterial({ map: haloTexture(), transparent: true, depthWrite: false, color: 0xffffff, fog: false });
    const mk = (key: FxType, geo: () => THREE.BufferGeometry, mat: THREE.Material, cap: number, shadow = false) =>
      batches.get(`fx:${key}`, () => ({ geo: geo(), mat, cap, shadow }));
    this.b = {
      heart: mk('heart', heartGeo, basic, 80), zzz: mk('zzz', zGeo, basic, 80), sparkle: mk('sparkle', sparkleGeo, basic, 200),
      puff: mk('puff', () => cached('fx:puff', () => merge([dodec(0.1, 0xffffff)])), lit, 200), drop: mk('drop', () => cached('fx:drop', () => merge([octa(0.035, 0xffffff, { s: [1, 1.6, 1] })])), basic, 300),
      butterfly: mk('butterfly', butterflyGeo, lit, 80), crow: mk('crow', crowGeo, lit, 40, true), bee: mk('bee', beeGeo, lit, 200),
      halo: mk('halo', () => cached('fx:halo', () => new THREE.PlaneGeometry(1, 1)), halo, 60), note: mk('note', noteGeo, basic, 40),
    };
    this.b.halo.mesh.renderOrder = 5;
  }

  spawn(type: FxType, x: number, y: number, z: number, o: { vx?: number; vy?: number; vz?: number; life?: number; size?: number; color?: number | THREE.Color; grav?: number; spin?: number } = {}): void {
    let p: Particle;
    if (this.ps.length >= MAX) p = this.ps.shift()!;
    else p = { type, x, y, z, vx: 0, vy: 0, vz: 0, age: 0, life: 1, size: 1, color: new THREE.Color(), grav: 0, spin: 0 };
    p.type = type; p.x = x; p.y = y; p.z = z; p.vx = o.vx ?? 0; p.vy = o.vy ?? 0; p.vz = o.vz ?? 0; p.age = 0; p.life = o.life ?? 1;
    p.size = o.size ?? 1; p.grav = o.grav ?? 0; p.spin = o.spin ?? 0;
    if (o.color instanceof THREE.Color) p.color.copy(o.color); else p.color.set(o.color ?? 0xffffff);
    this.ps.push(p);
  }

  /** draw one instance this frame with a world matrix */
  put(type: FxType, m: THREE.Matrix4, color?: THREE.Color | null): void { this.b[type].push(m, color ?? null); }

  /** camera-facing instance */
  billboard(type: FxType, x: number, y: number, z: number, size: number, color?: THREE.Color | null, spin = 0): void {
    if (spin) this.q.copy(this.camQuat).multiply(this.q2.setFromAxisAngle(Z, spin)); else this.q.copy(this.camQuat);
    this.m.compose(this.v.set(x, y, z), this.q, this.s.set(size, size, size));
    this.b[type].push(this.m, color ?? null);
  }
  private readonly q2 = new THREE.Quaternion();

  update(dt: number): void {
    for (let i = this.ps.length - 1; i >= 0; i--) {
      const p = this.ps[i];
      p.age += dt;
      if (p.age >= p.life) { this.ps.splice(i, 1); continue; }
      p.vy -= p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const k = p.age / p.life;
      let sz = p.size;
      this.c.copy(p.color);
      switch (p.type) {
        case 'heart': case 'note': sz *= Math.min(1, k * 6) * (1 - Math.max(0, k - 0.7) / 0.3); p.x += Math.sin(p.age * 5 + p.spin) * 0.25 * dt; break;
        case 'zzz': sz *= Math.min(1, k * 4) * (1 - Math.max(0, k - 0.6) / 0.4) * (0.6 + k * 0.8); p.x += Math.sin(p.age * 2.5 + p.spin) * 0.2 * dt; break;
        case 'sparkle': sz *= Math.sin(k * Math.PI) * (0.8 + 0.4 * Math.sin(p.age * 20)); break;
        case 'puff': sz *= (0.6 + k * 1.2) * (1 - k); p.vx *= 0.96; p.vz *= 0.96; break;
        case 'drop': if (p.y < -50) p.age = p.life; break;
        default: sz *= 1 - k;
      }
      if (sz <= 0.001) continue;
      if (p.type === 'puff' || p.type === 'drop') {
        this.e.set(p.spin * p.age, p.spin * p.age * 0.7, 0);
        this.q.setFromEuler(this.e);
        this.m.compose(this.v.set(p.x, p.y, p.z), this.q, this.s.set(sz, sz, sz));
        this.b[p.type].push(this.m, this.c);
      } else this.billboard(p.type, p.x, p.y, p.z, sz, this.c, p.type === 'zzz' ? Math.sin(p.age * 2 + p.spin) * 0.3 : 0);
    }
  }

  count(): number { return this.ps.length; }
}
const Z = new THREE.Vector3(0, 0, 1);
