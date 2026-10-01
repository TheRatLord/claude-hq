/**
 * Ivy drapes over the cliff strata ledges. A drape is a run of strands rooted in a leafy mat on the shelf just behind
 * the lip; each strand rolls over the edge and hangs down the riser, hugging its actual profile (walked against the
 * height function, so it follows bulges and never floats off the rock), leaves shrinking and thinning toward a ragged
 * tip, the middle strands longest. Built once (layout), then meshed per season: summer deep green, spring fresh, autumn
 * muted Virginia-creeper rust / burgundy / bronze, winter sparse dark evergreen with frosted mats.
 *
 * Pure geometry (no scene access): the flora system merges the drapes into a few sector meshes, the gallery hangs one
 * on a synthetic step.
 */
import * as THREE from 'three';
import type { Season } from '../../model/types.ts';
import { mulberry32 } from '../../../../../shared/identity.ts';

/** One drape: centred on a lip point (x, z), facing (dx, dz) (toward the valley, unit), `w` wide, strands ≤ `len`. */
export interface IvyDrape { x: number; z: number; dx: number; dz: number; w: number; len: number; seed: number }

/** Leaf record: centre, facing normal, in-plane up, size, depth fraction (0 lip … 1 tip), random, kind. */
interface Leaf { p: THREE.Vector3; n: THREE.Vector3; a: THREE.Vector3; s: number; t: number; r: number; mat: boolean }
interface Strand { pts: THREE.Vector3[]; n: THREE.Vector3 }
export interface IvyLayout { drapes: { leaves: Leaf[]; strands: Strand[]; x: number; z: number }[] }

const UP = new THREE.Vector3(0, 1, 0);

/** Walk every strand of every drape down its riser. `h` is the land height (heightAt). */
export function layoutIvy(drapes: readonly IvyDrape[], h: (x: number, z: number) => number): IvyLayout {
  const out: IvyLayout = { drapes: [] };
  for (const d of drapes) {
    const r = mulberry32(d.seed);
    const D = new THREE.Vector3(d.dx, 0, d.dz), T = new THREE.Vector3(-d.dz, 0, d.dx);
    const leaves: Leaf[] = [], strands: Strand[] = [];
    const n = Math.max(3, Math.round(d.w / 0.32));
    const hangN = D.clone().addScaledVector(UP, 0.3).normalize();
    for (let i = 0; i < n; i++) {
      if (r() < 0.12) continue; // a gap in the curtain
      const u = ((i + 0.5) / n - 0.5) * d.w + (r() - 0.5) * 0.22;
      const bx = d.x + T.x * u, bz = d.z + T.z * u;
      const at = (k: number) => h(bx + D.x * k, bz + D.z * k);
      // the lip: the last point at shelf height before the riser drops away
      const hs = at(-1.1);
      let k0 = NaN;
      for (let k = -1; k <= 2; k += 0.2) if (at(k) < hs - 0.3) {
        let lo = k - 0.2, hi = k; // bisect the edge
        for (let b = 0; b < 3; b++) { const m = (lo + hi) / 2; if (at(m) < hs - 0.3) hi = m; else lo = m; }
        k0 = lo - 0.1;
        break;
      }
      if (Number.isNaN(k0)) continue;
      const yLip = at(k0);
      if (yLip < hs - 0.6) continue; // the shelf behind slopes away: no clean lip here
      // envelope: middle strands longest, ragged edges, now and then a long straggler
      const e = 1 - (2 * u / d.w) ** 2;
      const hem = 0.75 + 0.25 * Math.sin(u * 1.9 + d.seed % 7); // a scalloped hem, not a comb
      let len = d.len * (0.25 + 0.75 * Math.max(0, e) ** 0.6) * hem * (0.45 + 0.55 * r());
      if (r() < 0.14) len *= 1.35;
      const drift = (r() - 0.5) * 0.3;
      const pts: THREE.Vector3[] = [];
      const pos = (k: number, y: number, wob: number) => new THREE.Vector3(bx + D.x * k + T.x * wob, y, bz + D.z * k + T.z * wob);
      // the mat on the shelf: a few leaves lying on the turf behind the lip, one rolling over the edge
      const back = pos(k0 - 0.35 - r() * 0.4, 0, (r() - 0.5) * 0.15);
      back.y = h(back.x, back.z) + 0.05;
      pts.push(back);
      for (let m = 0; m < 3; m++) {
        const k = k0 - 0.08 - m * 0.3 - r() * 0.2, p = pos(k, 0, (r() - 0.5) * 0.25);
        p.y = h(p.x, p.z) + 0.05;
        leaves.push({ p, n: UP.clone().addScaledVector(D, 0.45 + r() * 0.3).normalize(), a: D.clone().multiplyScalar(-1), s: 0.26 + r() * 0.1, t: 0, r: r(), mat: true });
      }
      const roll = pos(k0 + 0.06, yLip + 0.02, 0);
      pts.push(roll);
      leaves.push({ p: roll.clone(), n: D.clone().add(UP).normalize(), a: UP.clone().addScaledVector(D, -1).normalize(), s: 0.28, t: 0, r: r(), mat: true });
      // hang: step down, finding the riser face at each height
      let k = k0, side = r() < 0.5 ? 1 : -1;
      const ph = r() * 6.28;
      for (let dd = 0.16; dd < len; dd += 0.2 + r() * 0.05) {
        const y = yLip - dd, kPrev = k;
        while (k < k0 + 3.5 && at(k) > y) k += 0.1;
        if (k >= k0 + 3.5 || k - kPrev > 0.9) break; // reached the shelf below
        const t = dd / len;
        const wob = Math.sin(dd * 2.1 + ph) * 0.07 + drift * dd;
        const c = pos(k + 0.1, y, wob);
        pts.push(c);
        // a leaf each side (thinning toward the tip)
        for (let s2 = 0; s2 < 2; s2++) {
          side = -side;
          if (r() < t * 0.55) continue;
          const s = (0.3 - 0.15 * t) * (0.8 + r() * 0.4);
          const p = c.clone().addScaledVector(T, side * s * 0.45).addScaledVector(D, 0.02 + r() * 0.03);
          p.y += (r() - 0.5) * 0.05;
          const a = UP.clone().addScaledVector(T, side * (0.25 + r() * 0.35)).normalize();
          const n = hangN.clone().addScaledVector(T, (r() - 0.5) * 0.8).addScaledVector(UP, (r() - 0.5) * 0.5).normalize();
          leaves.push({ p, n, a, s, t, r: r(), mat: false });
        }
      }
      if (pts.length > 2) strands.push({ pts, n: hangN.clone() });
    }
    out.drapes.push({ leaves, strands, x: d.x, z: d.z });
  }
  return out;
}

const PAL: Record<Season, number[]> = {
  spring: [0x5e9a46, 0x6fa84e, 0x4f8a3e, 0x8cbc62],
  summer: [0x46783a, 0x52853e, 0x3b6a36, 0x5e8c42],
  // Virginia creeper turning: wine and burgundy up top, rust and bronze lower, a little olive still at the tips
  autumn: [0x6c2630, 0x7c2c2e, 0x8a382c, 0x92462e, 0x7e5a38],
  winter: [0x3c5640, 0x445e46, 0x354c3a],
};
const STEM: Record<Season, number> = { spring: 0x5a4a34, summer: 0x4a3e2e, autumn: 0x4e3a2c, winter: 0x5a4c40 };

const c0 = new THREE.Color(), c1 = new THREE.Color(), grey = new THREE.Color();
function leafColor(season: Season, l: Leaf, out: THREE.Color): THREE.Color {
  const pal = PAL[season];
  if (season === 'autumn') {
    // depth sorts the turn: dark wine at the lip, rust mid-way, bronze and olive toward the tips
    const f = Math.min(pal.length - 1, Math.max(0, l.t * (pal.length - 0.6) + (l.r - 0.5) * 2.2));
    const i = Math.floor(f);
    out.setHex(pal[i]).lerp(c1.setHex(pal[Math.min(pal.length - 1, i + 1)]), f - i);
    if (l.r > 0.93) out.setHex(0x5f6a36);
  } else out.setHex(pal[Math.floor(l.r * pal.length) % pal.length]);
  if (season === 'winter' && l.mat) out.lerp(c0.setHex(0xe8eef4), 0.65);
  // a touch of dust so it sits in the rock, not on top of the picture
  grey.setScalar((out.r + out.g + out.b) / 3);
  return out.lerp(grey, season === 'autumn' ? 0.26 : 0.12).multiplyScalar(0.92 + (l.r * 7.31 % 1) * 0.16);
}

/** Geometry writer: flat-shaded triangles, each turned to face `f`. */
class Writer {
  pos: number[] = []; nrm: number[] = []; col: number[] = [];
  private e1 = new THREE.Vector3(); private e2 = new THREE.Vector3(); private nn = new THREE.Vector3();
  get count(): number { return this.pos.length / 3; }
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, f: THREE.Vector3, col: THREE.Color): void {
    this.nn.crossVectors(this.e1.subVectors(b, a), this.e2.subVectors(c, a));
    if (this.nn.dot(f) < 0) { const t = b; b = c; c = t; this.nn.negate(); }
    this.nn.normalize();
    for (const p of [a, b, c]) { this.pos.push(p.x, p.y, p.z); this.nrm.push(this.nn.x, this.nn.y, this.nn.z); this.col.push(col.r, col.g, col.b); }
  }
}

const va = new THREE.Vector3(), vb = new THREE.Vector3(), top = new THREE.Vector3(), bot = new THREE.Vector3(), lft = new THREE.Vector3(),
  rgt = new THREE.Vector3(), apex = new THREE.Vector3(), q0 = new THREE.Vector3(), q1 = new THREE.Vector3(), q2 = new THREE.Vector3(),
  q3 = new THREE.Vector3(), dir = new THREE.Vector3(), lc = new THREE.Color(), sc = new THREE.Color();

/**
 * Mesh a set of drapes for a season (indices into `layout.drapes`; all when omitted). Winter drops most of the
 * creeper's leaves. Each drape is a named part `ivy#<index>` for the placement audit.
 */
export function ivyMesh(layout: IvyLayout, season: Season, which?: readonly number[]): THREE.BufferGeometry {
  const w = new Writer();
  const parts: { name: string; start: number; count: number }[] = [];
  sc.setHex(STEM[season]);
  for (const di of which ?? layout.drapes.map((_, i) => i)) {
    const d = layout.drapes[di];
    const start = w.count;
    // stems: thin ribbons facing out of the wall
    for (const s of d.strands) {
      for (let i = 0; i + 1 < s.pts.length; i++) {
        const p0 = s.pts[i], p1 = s.pts[i + 1];
        dir.subVectors(p1, p0);
        va.crossVectors(dir, s.n).normalize().multiplyScalar(0.035);
        q0.copy(p0).sub(va); q1.copy(p0).add(va); q2.copy(p1).add(va); q3.copy(p1).sub(va);
        w.tri(q0, q1, q2, s.n, sc); w.tri(q0, q2, q3, s.n, sc);
      }
    }
    // leaves: low pyramids (a raised midrib), tip down
    for (const l of d.leaves) {
      if (season === 'winter' && !l.mat && l.r < 0.55) continue;
      leafColor(season, l, lc);
      const s = season === 'winter' ? l.s * 0.85 : l.s;
      va.copy(l.a).addScaledVector(l.n, -l.n.dot(l.a)).normalize(); // in-plane up
      vb.crossVectors(va, l.n); // in-plane right
      top.copy(l.p).addScaledVector(va, 0.5 * s);
      bot.copy(l.p).addScaledVector(va, -0.72 * s);
      lft.copy(l.p).addScaledVector(vb, -0.55 * s).addScaledVector(va, 0.05 * s);
      rgt.copy(l.p).addScaledVector(vb, 0.55 * s).addScaledVector(va, 0.05 * s);
      apex.copy(l.p).addScaledVector(l.n, 0.22 * s);
      w.tri(apex, rgt, top, l.n, lc); w.tri(apex, top, lft, l.n, lc);
      w.tri(apex, lft, bot, l.n, lc); w.tri(apex, bot, rgt, l.n, lc);
    }
    if (w.count > start) parts.push({ name: `ivy#${di}`, start, count: w.count - start });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(w.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(w.nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(w.col, 3));
  g.userData = { parts };
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Gallery / test: one drape over a synthetic strata step (a 3 m riser leaning out 0.3, shelves either side). */
export function ivySample(season: Season, w = 3, len = 2.6): { geo: THREE.BufferGeometry; step: (x: number, z: number) => number } {
  const step = (_x: number, z: number) => (z < 0 ? 3 : z > 1 ? 0 : 3 - 3 * Math.min(1, z / 1) ** 0.8);
  const layout = layoutIvy([{ x: 0, z: -0.05, dx: 0, dz: 1, w, len, seed: 5 }], step);
  return { geo: ivyMesh(layout, season), step };
}
