/**
 * The bee garden's bees: fat, fuzzy, striped, with glassy wings. Each bee loops hive → flower → hive: it leaves the
 * landing board on a looping arc, works a flower in figure-8s (dipping into the bloom at the crossing), flies home
 * and rests inside for a moment. Guards hover at the entrances. At night everyone is home. Two draw calls.
 */
import * as THREE from 'three';
import { toon } from '../toon.ts';
import type { Batch, Batches } from './batch.ts';
import { ball, box, cached, cone, cyl, dodec, leaf, merge, rng, rod } from './geo.ts';

export function beeBody(): THREE.BufferGeometry {
  return cached('bee:body', () => {
    const Y = 0xf6c12e, K = 0x2a2226, F = 0xe8a83a;
    const p: THREE.BufferGeometry[] = [];
    // abdomen: stacked bands, fattest in the middle
    const bands = [[0.034, Y], [0.042, K], [0.045, Y], [0.043, K], [0.036, Y], [0.026, K]] as const;
    bands.forEach(([r, c], i) => p.push(cyl(r, bands[Math.max(0, i - 1)][0], 0.016, 8, c, { p: [0, 0, -0.012 - i * 0.015], r: [Math.PI / 2, 0, 0] })));
    p.push(ball(0.028, Y, { p: [0, 0, -0.005], s: [1.15, 1.1, 0.7] }));
    p.push(cone(0.008, 0.02, 4, K, { p: [0, 0, -0.105], r: [-Math.PI / 2, 0, 0] }));
    // fuzzy thorax
    const r = rng('bee-fuzz');
    p.push(ball(0.03, F, { p: [0, 0.004, 0.022] }, 1));
    for (let i = 0; i < 8; i++) p.push(dodec(0.012, i % 2 ? F : 0xf4c870, { p: [(r() - 0.5) * 0.05, 0.006 + (r() - 0.3) * 0.04, 0.022 + (r() - 0.5) * 0.04] }));
    // head, big eyes, antennae, a smile
    p.push(ball(0.022, K, { p: [0, 0.002, 0.056] }, 1));
    for (const s of [-1, 1]) {
      p.push(ball(0.011, 0xffffff, { p: [s * 0.012, 0.008, 0.07] }), ball(0.007, 0x111111, { p: [s * 0.012, 0.008, 0.078] }));
      p.push(rod([s * 0.006, 0.018, 0.062], [s * 0.018, 0.05, 0.08], 0.0025, 0.002, 3, K), ball(0.006, K, { p: [s * 0.018, 0.05, 0.08] }));
    }
    // tiny legs
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) p.push(box(0.004, 0.02, 0.004, K, { p: [s * 0.018, -0.028, 0.035 - i * 0.018], r: [0.3, 0, s * 0.3] }));
    return merge(p);
  });
}

export function beeWing(): THREE.BufferGeometry {
  return cached('bee:wing', () => merge([
    leaf(0.075, 0.05, 0xffffff, { p: [0.005, 0, 0.005], r: [0, Math.PI / 2 + 0.35, 0] }, 0.05),
    leaf(0.05, 0.035, 0xffffff, { p: [0.004, -0.002, -0.012], r: [0, Math.PI / 2 + 0.9, 0] }, 0.05),
  ]));
}

interface Bee {
  /** 0 hive → flower, 1 working the flower, 2 flower → hive, 3 home, 4 flower → next flower */
  hive: number; flower: number; prev: number; state: 0 | 1 | 2 | 3 | 4; t: number; dur: number;
  seed: number; loops: number; tilt: number;
  x: number; y: number; z: number; yaw: number; bank: number;
}

export interface BeeSite { hives: { x: number; z: number }[]; flowers: { x: number; y: number; z: number }[] }

const Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S = new THREE.Vector3(), M = new THREE.Matrix4(), MW = new THREE.Matrix4();

export class Bees {
  private readonly bees: Bee[] = [];
  private readonly r: () => number;
  private readonly site: BeeSite;
  private B: { body: Batch; wing: Batch } | null = null;
  private clock = 0;

  constructor(site: BeeSite, key: string, count = 22) {
    this.site = site;
    this.r = rng(`bees:${key}`);
    for (let i = 0; i < count; i++) {
      const b: Bee = { hive: i % Math.max(1, site.hives.length), flower: 0, prev: 0, state: 3, t: 0, dur: this.r() * 4, seed: this.r(), loops: 1, tilt: 0, x: 0, y: 0, z: 0, yaw: 0, bank: 0 };
      this.pickFlower(b);
      this.bees.push(b);
    }
  }

  private pickFlower(b: Bee): void {
    b.prev = b.flower;
    b.flower = Math.floor(this.r() * Math.max(1, this.site.flowers.length));
    b.loops = 1 + Math.floor(this.r() * 2);
    b.tilt = this.r() * Math.PI;
  }

  /** entrance position of hive i (site-local) */
  private door(i: number, out: { x: number; y: number; z: number }, off = 0): void {
    const h = this.site.hives[i];
    out.x = h.x + off; out.y = 0.37; out.z = h.z + 0.4;
  }

  private readonly pa = { x: 0, y: 0, z: 0 };
  private readonly pb = { x: 0, y: 0, z: 0 };

  /** where bee `b` is at its current (state, t) → writes b.x/y/z */
  private place(b: Bee, t: number, time: number): void {
    const f = this.site.flowers[b.flower] ?? { x: 0, y: 0.5, z: 0 };
    const fy = f.y + 0.16;
    if (b.state === 1) {
      // figure-8 over the flower, dipping at the crossing
      const w = (t / b.dur) * b.loops * Math.PI * 2;
      const r = 0.22 + b.seed * 0.1;
      const lx = Math.sin(w) * r, lz = Math.sin(w) * Math.cos(w) * r;
      const c = Math.cos(b.tilt), s = Math.sin(b.tilt);
      const cross = 1 - Math.min(1, Math.abs(Math.sin(w)) * 3);
      b.x = f.x + lx * c - lz * s; b.z = f.z + lx * s + lz * c; b.y = fy + 0.05 - cross * 0.12 + Math.sin(time * 9 + b.seed * 20) * 0.01;
      return;
    }
    // arcs: out from the hive (0), home (2) or on to the next flower (4): a raised quadratic bezier with a swing
    const out = b.state !== 2;
    if (b.state === 4) { const g = this.site.flowers[b.prev] ?? f; this.pa.x = g.x; this.pa.y = g.y + 0.16; this.pa.z = g.z; }
    else this.door(b.hive, this.pa, (b.seed - 0.5) * 0.25);
    const u0 = Math.min(1, t / b.dur), u = u0 * u0 * (3 - 2 * u0);
    const A = out ? this.pa : this.pb, Bp = out ? this.pb : this.pa;
    this.pb.x = f.x; this.pb.y = fy; this.pb.z = f.z;
    const lift = b.state === 4 ? 0.25 : 0.7 + b.seed * 0.5;
    const mx = (A.x + Bp.x) / 2 + (b.seed - 0.5) * (b.state === 4 ? 0.6 : 2.2) * (out ? 1 : -1), my = Math.max(A.y, Bp.y) + lift, mz = (A.z + Bp.z) / 2 + (b.seed - 0.3) * (b.state === 4 ? 0.4 : 1.2);
    const k = 1 - u;
    b.x = k * k * A.x + 2 * k * u * mx + u * u * Bp.x;
    b.y = k * k * A.y + 2 * k * u * my + u * u * Bp.y + Math.sin(time * 7 + b.seed * 30) * 0.03;
    b.z = k * k * A.z + 2 * k * u * mz + u * u * Bp.z;
  }

  update(dt: number, time: number, batches: Batches, siteM: THREE.Matrix4, o: { vigor: number; night: number; resting: boolean; alive: number }): void {
    this.clock += dt;
    if (!this.B) {
      const wingMat = new THREE.MeshBasicMaterial({ color: 0xe8f6ff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
      this.B = {
        body: batches.get('bee:body', () => ({ geo: beeBody(), mat: toon(0xffffff, { vertexColors: true }), cap: 240, shadow: false })),
        wing: batches.get('bee:wing', () => ({ geo: beeWing(), mat: wingMat, cap: 480, order: 3 })),
      };
    }
    const home = o.night > 0.6;
    const active = Math.round((o.resting ? 0.25 : 0.5 + 0.5 * o.vigor) * this.bees.length * o.alive);
    for (let i = 0; i < this.bees.length; i++) {
      const b = this.bees[i];
      b.t += dt;
      if (b.t >= b.dur) {
        b.t = 0;
        if (b.state === 3) {
          if (home || i >= active) { b.dur = 2 + this.r() * 3; continue; }
          b.state = 0; this.pickFlower(b); b.dur = 2.4 + this.r() * 2;
        } else if (b.state === 0 || b.state === 4) { b.state = 1; b.dur = 2.2 + this.r() * 2.5; }
        else if (b.state === 1) {
          if (!home && this.r() < 0.45) { this.pickFlower(b); b.state = 4; b.dur = 1.2 + this.r() * 0.8; }
          else { b.state = 2; b.dur = 2.4 + this.r() * 2; }
        } else { b.state = 3; b.dur = 1.5 + this.r() * 5; }
      }
      if (b.state === 3) {
        // a few guards hover at the entrance, the rest are inside
        if (i % 5 !== 0 || home || o.alive < 0.5) continue;
        this.door(b.hive, this.pa, Math.sin(time * 1.3 + i) * 0.14);
        b.x = this.pa.x; b.y = this.pa.y + 0.1 + Math.sin(time * 3 + i) * 0.04; b.z = this.pa.z + 0.14 + Math.cos(time * 2 + i) * 0.05;
        this.draw(b, Math.sin(time * 1.3 + i) > 0 ? -Math.PI / 2 : Math.PI / 2, 0, siteM, time + i);
        continue;
      }
      // heading from the path's direction (look a few ms ahead)
      this.place(b, Math.min(b.dur, b.t + 0.05), time);
      const nx = b.x, nz = b.z, ny = b.y;
      this.place(b, b.t, time);
      const dx = nx - b.x, dz = nz - b.z;
      if (dx * dx + dz * dz > 1e-8) {
        const yaw = Math.atan2(dx, dz);
        let dy = yaw - b.yaw; dy -= Math.PI * 2 * Math.round(dy / (Math.PI * 2));
        b.yaw += dy * Math.min(1, dt * 12);
        b.bank += (Math.max(-0.7, Math.min(0.7, dy * 4)) - b.bank) * Math.min(1, dt * 8);
      }
      this.draw(b, b.yaw, b.bank, siteM, time + i, (ny - b.y) * 6);
    }
  }

  private draw(b: Bee, yaw: number, bank: number, siteM: THREE.Matrix4, t: number, climb = 0): void {
    const B = this.B!;
    const s = 1.35;
    Q.setFromEuler(E.set(-Math.max(-0.5, Math.min(0.5, climb)) + 0.15, yaw, bank, 'YXZ'));
    MW.compose(V.set(b.x, b.y, b.z), Q, S.set(s, s, s)).premultiply(siteM);
    B.body.push(MW);
    const flap = Math.sin(t * 2 * Math.PI * 17);
    for (let side = -1; side <= 1; side += 2) {
      Q.setFromEuler(E.set(0, side > 0 ? 0 : Math.PI, 0.25 + flap * 0.65, 'YXZ'));
      M.compose(V.set(side * 0.012, 0.03, 0.012), Q, S.set(1, 1, 1));
      M.premultiply(MW);
      B.wing.push(M);
    }
  }
}
