/**
 * A field's git state, drawn in the field (docs/valley/signals.md → "In the valley"):
 *
 *   uncommitted changes = weeds   dandelion tufts between the rows, log-scaled by changed files (1 → 1, 8 → 7, 23+ → 10);
 *                                 a commit (fewer changed files) pulls them: each pops out with a dirt puff
 *   unpushed commits    = crates  one per commit (≤ 5) stacked left of the sign, a chalk slate `+N` for the rest; a push
 *                                 (ahead drops) sends a cart that loads them and trundles off toward the shipping bin
 *   behind upstream     = mail    a sealed envelope `↓N` tucked under the sign's top beam
 *   branch              = pennant on the sign's beam, coloured by a hash of the branch name; main / master fly
 *                                 the valley's own colour (Clawd's terracotta); detached heads a plain grey
 *
 * Draws: the weeds and the pennant are one instanced batch each (no shadows); crates, the cart and the two little
 * atlas cards ride the field's existing batches. Nothing allocates per frame (strings only when a count changes).
 */
import * as THREE from 'three';
import type { PlotRepoView } from '../../model/signals.ts';
import { hash32 } from '../../../../../shared/identity.ts';
import { PAL } from '../toon.ts';
import type { Batch } from './batch.ts';
import type { TextAtlas } from './atlas.ts';
import { chalkPainter, mailPainter } from './atlas.ts';
import type { Clear } from './crops.ts';
import { ball, bounce, cached, clamp01, cyl, leaf, lerp, merge, prism, rng, S, smooth01 } from './geo.ts';
import type { FieldEnv } from './field.ts';

export const GIT_WEEDS = 10;
export const GIT_CRATES = 5;
const CART_LOAD = 4;
const SHIP_S = 6.5;
const PULL_S = 0.55;

/** changed files → weed tufts (log scale, a handful at most) */
export function weedCount(dirty: number): number {
  return dirty > 0 ? Math.min(GIT_WEEDS, 1 + Math.floor(2.2 * Math.log2(dirty))) : 0;
}

/** branch → pennant colour: main / master in the valley's own colour, others a stable pick that never matches it */
const MAIN = 0xd97757;
const BRANCH_COLORS = [0x3fb3a8, 0x5a7fd6, 0x9a6ad0, 0xe07ab0, 0x6cc25a, 0xf2cf4a, 0x6ab8e8] as const;
export function branchColor(branch: string | null): number {
  if (!branch) return 0xa8a8a0;
  if (branch === 'main' || branch === 'master') return MAIN;
  return BRANCH_COLORS[hash32(branch) % BRANCH_COLORS.length];
}

// ---------------------------------------------------------------------------------------------------------------
// Models

/** A dandelion tuft: a toothy rosette, one yellow flower and one seed clock (origin on the soil). */
export function dandelion(): THREE.BufferGeometry {
  return cached('git:dandelion', () => {
    const p: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 7; i++) {
      const yaw = (i / 7) * Math.PI * 2 + (i % 2) * 0.2;
      p.push(leaf(0.24 + (i % 3) * 0.04, 0.09, i % 2 ? 0x5f9a3a : 0x7fb648, { p: [0, 0.015, 0], r: [-0.32 - (i % 3) * 0.12, yaw, 0] }, 0.35));
      // a tooth half way up each leaf
      p.push(leaf(0.08, 0.05, i % 2 ? 0x5f9a3a : 0x7fb648, { p: [Math.sin(yaw) * 0.1, 0.05, Math.cos(yaw) * 0.1], r: [-0.5, yaw + 0.7, 0] }, 0.3));
    }
    // the flower: a short stem, a ring of petals, a deeper yellow eye
    p.push(cyl(0.012, 0.016, 0.24, 4, 0x6a9a3a, { p: [0.03, 0.12, 0.02], r: [0.08, 0, -0.08] }));
    p.push(cyl(0.075, 0.06, 0.035, 9, PAL.yellow, { p: [0.04, 0.25, 0.03], r: [0.12, 0, -0.1] }));
    p.push(ball(0.04, 0xe8a020, { p: [0.04, 0.27, 0.03], s: [1, 0.6, 1] }));
    // the seed clock on a taller stem
    p.push(cyl(0.01, 0.014, 0.33, 4, 0x6a9a3a, { p: [-0.05, 0.165, -0.03], r: [-0.06, 0, 0.1] }));
    p.push(ball(0.075, 0xf6f3ea, { p: [-0.068, 0.36, -0.04] }, 1));
    return merge(p);
  });
}

/** The branch pennant (white cloth: tinted per branch) on a short dark pole; origin at the pole foot, cloth along +x. */
export function pennant(): THREE.BufferGeometry {
  return cached('git:pennant', () => merge([
    cyl(0.022, 0.022, 0.64, 5, 0x30241a, { p: [0, 0.32, 0] }),
    ball(0.04, 0xfff4dc, { p: [0, 0.66, 0] }),
    S(prism([[0, 0], [0.52, -0.12], [0, -0.25]], 0.024, 0xffffff, { p: [0.02, 0.61, 0] }), 'fabric', { axis: 'x', scale: 0.5 }),
    // a paler hoist band so the cloth reads two-tone
    S(prism([[0, 0], [0.11, -0.026], [0.11, -0.224], [0, -0.25]], 0.03, 0xd8d0c0, { p: [0.02, 0.61, 0] }), 'fabric', { axis: 'x', scale: 0.5 }),
  ]));
}

// ---------------------------------------------------------------------------------------------------------------
// Where the weeds grow

export interface WeedSpot { x: number; z: number; yaw: number; s: number }

/**
 * Up to GIT_WEEDS spots between the rows (crop fields: the furrows between ridges; pens and the orchard: open ground),
 * clear of the spots farmers use, the props and the plants, spread out, the ones nearer the gate first (they read
 * from the path).
 */
export function gitWeedSpots(o: { hw: number; hd: number; rows: readonly number[] | null; clears: readonly Clear[]; /** every prop's footprint (kept off whole: a tuft is ~0.4 m across) */ props?: readonly Clear[]; plants: readonly { x: number; z: number }[]; key: string }): WeedSpot[] {
  const { hw, hd } = o;
  const r = rng(`gitweeds:${o.key}`);
  const cand: { x: number; z: number; score: number }[] = [];
  const add = (x: number, z: number) => {
    if (Math.abs(x) > hw - 0.7 || z < -hd + 0.9 || z > hd - 0.55) return;
    if (Math.abs(x) < 1.3 && z > hd - 3.6) return; // the gate lane
    for (const c of o.clears) { const rr = c.r * 0.7 + 0.12; if ((c.x - x) ** 2 + (c.z - z) ** 2 < rr * rr) return; }
    if (o.props) for (const c of o.props) { const rr = c.r + 0.3; if ((c.x - x) ** 2 + (c.z - z) ** 2 < rr * rr) return; }
    for (const p of o.plants) if ((p.x - x) ** 2 + (p.z - z) ** 2 < 0.34 * 0.34) return;
    cand.push({ x, z, score: z / hd + r() * 1.2 });
  };
  if (o.rows && o.rows.length > 1) {
    for (let i = 0; i + 1 < o.rows.length; i++) {
      const mx = (o.rows[i] + o.rows[i + 1]) / 2;
      for (let z = -hd + 1; z <= hd - 0.6; z += 0.55) add(mx + (r() - 0.5) * 0.16, z + (r() - 0.5) * 0.2);
    }
  } else {
    for (let x = -hw + 1; x <= hw - 1; x += 0.9) for (let z = -hd + 1; z <= hd - 0.6; z += 0.9) add(x + (r() - 0.5) * 0.4, z + (r() - 0.5) * 0.4);
  }
  // the headland in front of the beds (where it is free)
  for (let x = -hw + 0.9; x <= hw - 0.9; x += 0.7) add(x, hd - 0.8 - r() * 0.4);
  cand.sort((a, b) => b.score - a.score);
  const out: WeedSpot[] = [];
  for (const c of cand) {
    if (out.length >= GIT_WEEDS) break;
    if (out.some((w) => (w.x - c.x) ** 2 + (w.z - c.z) ** 2 < 1.4 * 1.4)) continue;
    out.push({ x: c.x, z: c.z, yaw: r() * Math.PI * 2, s: 1.35 + r() * 0.45 });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------

/**
 * crates waiting to ship, left of the sign (site-local offsets from the first one, front row first): the bottom row
 * stands a hand apart (0.74 m for a 0.66 m crate, so the slight yaws never touch), the upper ones rest on the rims
 */
const STACK: readonly (readonly [number, number, number])[] = [[0, 0, 0], [-0.74, 0, 0.03], [-0.37, 0.43, 0.015], [-1.48, 0, -0.02], [-1.11, 0.43, 0]];
/** the four places on the cart bed (cart-local) */
const LOAD: readonly (readonly [number, number, number])[] = [[-0.38, 0.67, -0.24], [0.38, 0.67, -0.24], [-0.38, 0.67, 0.24], [0.38, 0.67, 0.24]];

export interface GitBatches { weed: Batch; pennant: Batch; crate: Batch; cart: Batch; text: Batch }

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const _cartM = new THREE.Matrix4(), _p = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();

export class FieldGit {
  private readonly weedK = new Float32Array(GIT_WEEDS);
  /** < 0: not pulled; ≥ 0: seconds into the pull (a negative start staggers a row of pulls) */
  private readonly pullT = new Float32Array(GIT_WEEDS).fill(-1);
  private readonly pulling = new Uint8Array(GIT_WEEDS);
  private readonly crateK = new Float32Array(GIT_CRATES);
  private lastDirty = -1;
  private lastAhead = -1;
  /** the push cart: progress 0..1 (-1 idle), crates aboard, the stack slots they hop from */
  private shipT = -1;
  private shipN = 0;
  private readonly shipFrom = new Uint8Array(CART_LOAD);
  private shipDir = -1;
  private mailKey = '';
  private mailRect: number[] | null = null;
  private chalkKey = '';
  private chalkRect: number[] | null = null;
  private colorFor = '\u0000';
  private readonly flagColor = new THREE.Color();

  private readonly spots: readonly WeedSpot[];
  private readonly o: { hd: number; siteIndex: number; siteM: THREE.Matrix4; signX: number; /** +1 / −1: the shipping bin's side along the front */ binSide: number };

  constructor(spots: readonly WeedSpot[], o: FieldGit['o']) { this.spots = spots; this.o = o; }

  /**
   * `live` 0..1: the field is up (tilled, not harvested or closing). `sign` = the sign's world matrix (with its pop-in
   * scale) and `signK` its scale, for the pennant and the letter.
   */
  update(env: FieldEnv, git: PlotRepoView | null | undefined, live: boolean, b: GitBatches, sign: THREE.Matrix4, signK: number): void {
    const dt = env.dt, t = env.time, M = this.o.siteM;
    const dirty = git?.dirty ?? 0;
    const ahead = git?.ahead ?? 0;
    // ---- weeds ----
    const n = live ? weedCount(dirty) : 0;
    const commit = live && this.lastDirty >= 0 && dirty < this.lastDirty;
    this.lastDirty = live ? dirty : -1;
    let popped = false;
    for (let i = 0; i < this.spots.length; i++) {
      const w = this.spots[i];
      if (i < n && !this.pulling[i]) this.weedK[i] = Math.min(1, this.weedK[i] + dt * (1.1 - i * 0.04));
      else if (i >= n && this.weedK[i] > 0 && !this.pulling[i]) {
        // a commit pulls the weeds it cleared (staggered, front ones first); anything else just wilts away
        if (commit && this.weedK[i] > 0.4) { this.pulling[i] = 1; this.pullT[i] = -(i - n) * 0.13; }
        else this.weedK[i] = Math.max(0, this.weedK[i] - dt * 2);
      }
      if (this.pulling[i]) {
        const before = this.pullT[i];
        this.pullT[i] += dt;
        if (before < 0 && this.pullT[i] >= 0) {
          const p = _p.set(w.x, 0.15, w.z).applyMatrix4(M);
          for (let k = 0; k < 4; k++) env.fx.spawn('puff', p.x, p.y, p.z, { vx: (Math.random() - 0.5) * 1.2, vy: 0.9 + Math.random() * 0.6, vz: (Math.random() - 0.5) * 1.2, grav: 3, life: 0.7, size: 0.9, color: k % 2 ? 0x7a5534 : 0x9ac060, spin: 4 });
          if (!popped) { env.sound('pop', p.x, p.y, p.z, 0.6); popped = true; }
        }
        if (this.pullT[i] >= PULL_S) { this.pulling[i] = 0; this.pullT[i] = -1; this.weedK[i] = 0; }
      }
      const k = this.weedK[i];
      if (k < 0.01) continue;
      let y = 0.02, sc = w.s * bounce(k), yaw = w.yaw;
      if (this.pulling[i] && this.pullT[i] >= 0) {
        const u = this.pullT[i] / PULL_S;
        y += Math.sin(Math.PI * Math.min(1, u * 1.3)) * 0.55;
        sc *= (1 + 0.3 * Math.sin(Math.PI * Math.min(1, u * 2))) * (1 - smooth01((u - 0.45) / 0.55));
        yaw += u * 7;
      } else if (this.pulling[i]) sc *= 1 + Math.sin(-this.pullT[i] * 40) * 0.05; // a tug before it comes out
      const sway = env.wind.x * 0.04 + Math.sin(t * 1.7 + i * 2.3) * 0.06;
      _q.setFromEuler(_e.set(Math.sin(t * 1.3 + i) * 0.05, yaw, sway, 'YXZ'));
      _m.compose(_v.set(w.x, y, w.z), _q, _s.set(sc, sc, sc)).premultiply(M);
      b.weed.push(_m);
    }

    // ---- crates waiting to ship, and the cart that takes them on a push ----
    const shown = live ? Math.min(GIT_CRATES, ahead) : 0;
    if (live && this.lastAhead >= 0 && ahead < this.lastAhead && git?.ahead != null) {
      // pushed: the crates past the new count hop onto the cart (more than the stack shows: the top one goes)
      this.shipN = Math.min(CART_LOAD, this.lastAhead - ahead);
      for (let j = 0; j < this.shipN; j++) { const from = Math.min(GIT_CRATES - 1, shown + j); this.shipFrom[j] = from; }
      for (let i = shown; i < GIT_CRATES; i++) this.crateK[i] = 0;
      this.shipT = 0;
      this.shipDir = this.o.binSide;
      const p = _p.set(this.o.signX - 2, 0.8, this.o.hd + 2.3).applyMatrix4(M);
      env.sound('creak', p.x, p.y, p.z, 0.6);
    }
    this.lastAhead = live ? ahead : -1;
    const baseX = this.o.signX - 1.45, baseZ = this.o.hd + 1.2;
    for (let i = 0; i < GIT_CRATES; i++) {
      const want = i < shown ? 1 : 0;
      this.crateK[i] = want ? Math.min(1, this.crateK[i] + dt * 1.6) : Math.max(0, this.crateK[i] - dt * 3);
      const k = this.crateK[i];
      if (k < 0.01) continue;
      const st = STACK[i], x = st[0], y = st[1], z = st[2];
      _q.setFromAxisAngle(_v.set(0, 1, 0), ((i * 0.37 + this.o.siteIndex * 0.21) % 0.16) - 0.08);
      _m.compose(_v.set(baseX + x, y + (1 - bounce(k)) * 1.4, baseZ + z), _q, _s.set(k, k, k)).premultiply(M);
      b.crate.push(_m);
    }
    // more than the stack holds: a chalk slate leaning on the front crate
    const extra = live ? Math.max(0, ahead - GIT_CRATES) : 0;
    if (extra > 0 && this.crateK[0] > 0.5) {
      const key = `git:chalk:${Math.min(99, extra)}`;
      if (key !== this.chalkKey) {
        if (this.chalkKey) env.atlas.release(this.chalkKey);
        this.chalkKey = key;
        this.chalkRect = env.atlas.acquire(key, chalkPainter(`+${Math.min(99, extra)}`));
      }
      const k = smooth01((this.crateK[0] - 0.5) * 2);
      _q.setFromEuler(_e.set(-0.22, 0.12, 0, 'YXZ'));
      _m.compose(_v.set(baseX + 0.05, 0.2, baseZ + 0.3), _q, _s.set(0.34 * k, 0.17 * k, 1)).premultiply(M);
      b.text.push(_m, null, this.chalkRect!);
    } else if (this.chalkKey && extra === 0) { env.atlas.release(this.chalkKey); this.chalkKey = ''; this.chalkRect = null; }

    if (this.shipT >= 0) this.drawShip(env, b);

    // ---- on the sign: the branch pennant and mail from upstream ----
    if (!git || signK < 0.02) return;
    const id = git.branch ?? '';
    if (id !== this.colorFor) { this.colorFor = id; this.flagColor.set(branchColor(git.branch)); }
    const flap = Math.sin(t * 3.1 + this.o.siteIndex) * 0.22 + Math.sin(t * 7.3 + this.o.siteIndex * 2) * 0.06 + env.wind.x * 0.1;
    _q.setFromEuler(_e.set(0, flap, 0, 'YXZ'));
    _m.compose(_v.set(-0.72, 1.6, 0), _q, _s.set(1 + Math.sin(t * 6.1 + this.o.siteIndex) * 0.06, 1, 1)).premultiply(sign);
    b.pennant.push(_m, this.flagColor);
    const behind = git.behind ?? 0;
    if (behind > 0) {
      const key = `git:mail:${Math.min(100, behind)}`;
      if (key !== this.mailKey) {
        if (this.mailKey) env.atlas.release(this.mailKey);
        this.mailKey = key;
        this.mailRect = env.atlas.acquire(key, mailPainter(behind));
      }
      _q.setFromEuler(_e.set(Math.sin(t * 2.2 + this.o.siteIndex) * 0.08, 0, -0.2, 'YXZ'));
      _m.compose(_v.set(0.48, 1.44, 0.09), _q, _s.set(0.48, 0.24, 1)).premultiply(sign);
      b.text.push(_m, null, this.mailRect!);
    } else if (this.mailKey) { env.atlas.release(this.mailKey); this.mailKey = ''; this.mailRect = null; }
  }

  /** the push cart: rolls in along the front, the crates hop aboard, it trundles off toward the shipping bin */
  private drawShip(env: FieldEnv, b: GitBatches): void {
    const M = this.o.siteM, dir = this.shipDir;
    const u = (this.shipT += env.dt / SHIP_S);
    if (u >= 1) { this.shipT = -1; env.shipped?.(); return; }
    const cx = this.o.signX - 2.1, cz = this.o.hd + 2.35;
    let x: number, k = 1;
    if (u < 0.22) x = lerp(cx - dir * 9, cx, 1 - (1 - u / 0.22) ** 2);
    else if (u < 0.55) x = cx;
    else { const e = (u - 0.55) / 0.45; x = cx + dir * 13 * e * e; k = 1 - smooth01((e - 0.7) / 0.3); }
    if (u < 0.08) k = smooth01(u / 0.08);
    const rolling = u < 0.22 || u > 0.55;
    // the handle (−x end) leads
    _q.setFromEuler(_e.set(0, dir < 0 ? 0 : Math.PI, rolling ? Math.sin(env.time * 9) * 0.02 : 0, 'YXZ'));
    _m.compose(_v.set(x, 0, cz), _q, _s.set(k, k, k)).premultiply(M);
    b.cart.push(_m);
    _cartM.compose(_v.set(x, 0, cz), _q, ONE);
    if (u > 0.55 && u - env.dt / SHIP_S <= 0.55) {
      const p = _p.set(x, 1.2, cz).applyMatrix4(M);
      for (let i = 0; i < 6; i++) env.fx.spawn('sparkle', p.x + (Math.random() - 0.5) * 1.2, p.y + Math.random() * 0.4, p.z + (Math.random() - 0.5) * 0.8, { vy: 0.7, life: 0.9, color: 0xfff0a0 });
    }
    const baseX = this.o.signX - 1.45, baseZ = this.o.hd + 1.2;
    for (let j = 0; j < this.shipN; j++) {
      // hop: from the stack (site-local) up into the cart bed (cart-local → site-local through the cart's matrix)
      const h0 = 0.25 + j * 0.06, hv = clamp01((u - h0) / 0.1);
      const sf = STACK[this.shipFrom[j]], sx = sf[0], sy = sf[1], sz = sf[2];
      const ld = LOAD[j], lx = ld[0], ly = ld[1], lz = ld[2];
      _b.set(lx, ly, lz).applyMatrix4(_cartM);
      if (hv <= 0) _a.set(baseX + sx, sy, baseZ + sz);
      else if (hv < 1) {
        const e = smooth01(hv);
        _a.set(baseX + sx, sy, baseZ + sz).lerp(_b, e);
        _a.y += Math.sin(Math.PI * e) * 0.9;
      } else _a.copy(_b);
      if (hv > 0 && hv - env.dt / SHIP_S / 0.1 <= 0) { const p = _p.copy(_a).applyMatrix4(M); env.sound('pop', p.x, p.y, p.z, 0.4); }
      _e.set(0, (hv > 0 && hv < 1 ? hv * 3 : 0) + (dir < 0 ? 0 : Math.PI), 0, 'YXZ');
      // (they wait on the stack at full size while the cart pops in; aboard, they fade out with it)
      const ck = hv >= 1 ? k : 1;
      _m.compose(_a, _q.setFromEuler(_e), _s.set(ck, ck, ck)).premultiply(M);
      b.crate.push(_m);
    }
  }

  dispose(atlas: TextAtlas | null): void {
    if (this.mailKey) atlas?.release(this.mailKey);
    if (this.chalkKey) atlas?.release(this.chalkKey);
    this.mailKey = this.chalkKey = '';
  }

  stats(): { weeds: number; crates: number; shipping: boolean } {
    let w = 0, c = 0;
    for (let i = 0; i < GIT_WEEDS; i++) if (this.weedK[i] > 0.01) w++;
    for (let i = 0; i < GIT_CRATES; i++) if (this.crateK[i] > 0.01) c++;
    return { weeds: w, crates: c, shipping: this.shipT >= 0 };
  }
}
const ONE = new THREE.Vector3(1, 1, 1);
