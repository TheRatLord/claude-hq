/**
 * The hillside orchard's bees (scene/orchard): a little colony per hive that forages out over the wildflower bed (and
 * the blossom in spring), works a flower in loops, flies home and rests inside a while. How many are out follows
 * `beeActivity` (model/orchard.ts): none at night, in rain or snow, or all winter; a couple of guards hover at each
 * entrance whenever any are flying. Orchard-local coordinates (world/orchard.ts), one instanced draw.
 *
 * No per-frame allocation: bees are a fixed pool; the flight maths writes into scratch vectors.
 */
import * as THREE from 'three';

export interface BeeSite {
  /** hive entrances (local; y = landing board height) */
  hives: readonly { x: number; y: number; z: number }[];
  /** flowers (local, y = bloom height); `blossom` points are only worked in spring */
  flowers: readonly { x: number; y: number; z: number }[];
}

const S = { Home: 0, Out: 1, Work: 2, Back: 3, Guard: 4 } as const;
type State = (typeof S)[keyof typeof S];
interface Bee {
  hive: number; state: State; t: number; dur: number;
  fx: number; fy: number; fz: number; tx: number; ty: number; tz: number;
  lift: number; seed: number; x: number; y: number; z: number; yaw: number; px: number; pz: number;
}

/** deterministic little RNG */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class Colony {
  readonly bees: Bee[] = [];
  private readonly r: () => number;
  /** foragers currently out of a hive */
  out = 0;
  private readonly site: BeeSite;
  readonly foragers: number;
  readonly guards: number;
  constructor(site: BeeSite, foragers: number, guards: number, seed = 7) {
    this.site = site; this.foragers = foragers; this.guards = guards;
    this.r = rng(seed);
    const H = site.hives.length;
    for (let i = 0; i < foragers + guards; i++) {
      const hive = i % H, h = site.hives[hive];
      this.bees.push({ hive, state: i < foragers ? S.Home : S.Guard, t: this.r() * 3, dur: 1 + this.r() * 3, fx: h.x, fy: h.y, fz: h.z, tx: h.x, ty: h.y, tz: h.z, lift: 0.8, seed: this.r() * 100, x: h.x, y: h.y, z: h.z, yaw: 0, px: h.x, pz: h.z });
    }
  }

  /**
   * Advance the colony and write the instance matrices. `activity` 0..1 (how many may be out), `spring` adds the
   * blossom points. Returns how many bees are drawn.
   */
  update(dt: number, time: number, activity: number, flowers: number, mesh: THREE.InstancedMesh): number {
    const { site, r } = this;
    const want = Math.round(this.foragers * activity);
    let shown = 0, out = 0;
    for (let i = 0; i < this.bees.length; i++) {
      const b = this.bees[i];
      const h = site.hives[b.hive];
      b.t += dt;
      if (b.state === S.Guard) {
        if (activity < 0.05) { mesh.setMatrixAt(i, ZERO); continue; }
        // a slow figure-of-eight in front of the entrance
        const ph = time * (1.6 + (b.seed % 1) * 0.6) + b.seed;
        b.x = h.x + Math.sin(ph) * 0.22; b.y = h.y + 0.18 + Math.sin(ph * 2.3) * 0.06; b.z = h.z - 0.32 + Math.sin(ph * 2) * 0.12;
      } else {
        if (b.state === S.Home) {
          if (b.t >= b.dur && out < want && flowers > 0) {
            const f = site.flowers[Math.floor(r() * flowers)];
            b.state = S.Out; b.t = 0; b.dur = 2.2 + r() * 2.4; b.lift = 0.6 + r() * 1.1;
            b.fx = h.x; b.fy = h.y; b.fz = h.z - 0.1; b.tx = f.x + (r() - 0.5) * 0.2; b.ty = f.y + 0.08; b.tz = f.z + (r() - 0.5) * 0.2;
          } else { mesh.setMatrixAt(i, ZERO); continue; }
        }
        if (b.state === S.Out || b.state === S.Back) {
          const k = Math.min(1, b.t / b.dur), e = k * k * (3 - 2 * k);
          const wob = Math.sin(time * 7 + b.seed) * 0.12 * Math.sin(k * Math.PI);
          b.x = b.fx + (b.tx - b.fx) * e + wob; b.z = b.fz + (b.tz - b.fz) * e + Math.cos(time * 6.1 + b.seed) * 0.1 * Math.sin(k * Math.PI);
          b.y = b.fy + (b.ty - b.fy) * e + Math.sin(k * Math.PI) * b.lift;
          if (k >= 1) {
            if (b.state === S.Out) { b.state = S.Work; b.t = 0; b.dur = 1.4 + r() * 2.6; }
            else { b.state = S.Home; b.t = 0; b.dur = 1 + r() * 3.5; mesh.setMatrixAt(i, ZERO); continue; }
          }
        }
        if (b.state === S.Work) {
          // loops round the bloom, dipping in at the crossing
          const ph = b.t * 5.5 + b.seed;
          b.x = b.tx + Math.sin(ph) * 0.13; b.z = b.tz + Math.sin(ph * 2) * 0.08; b.y = b.ty + 0.05 + Math.abs(Math.cos(ph)) * 0.08;
          if (b.t >= b.dur) {
            b.state = S.Back; b.t = 0; b.dur = 2 + r() * 2.2; b.lift = 0.5 + r() * 0.9;
            b.fx = b.x; b.fy = b.y; b.fz = b.z; b.tx = h.x; b.ty = h.y; b.tz = h.z - 0.08;
          }
        }
        out++;
      }
      // face the way it's going
      const vx = b.x - b.px, vz = b.z - b.pz;
      if (vx * vx + vz * vz > 1e-7) b.yaw = Math.atan2(vx, vz);
      b.px = b.x; b.pz = b.z;
      _e.set(Math.sin(time * 30 + b.seed) * 0.08, b.yaw, Math.sin(time * 23 + b.seed) * 0.12);
      _q.setFromEuler(_e);
      _p.set(b.x, b.y, b.z);
      _s.setScalar(1);
      mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
      shown++;
    }
    this.out = out;
    mesh.instanceMatrix.needsUpdate = true;
    return shown;
  }

  /** everyone home at once (night fell, rain came, the colony's far away) */
  hideAll(mesh: THREE.InstancedMesh): void {
    for (let i = 0; i < this.bees.length; i++) {
      const b = this.bees[i];
      if (b.state !== S.Guard) { b.state = S.Home; b.t = 0; b.dur = 1 + this.r() * 3; }
      mesh.setMatrixAt(i, ZERO);
    }
    this.out = 0;
    mesh.instanceMatrix.needsUpdate = true;
  }
}
