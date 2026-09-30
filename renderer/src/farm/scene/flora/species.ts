/**
 * Plant models: every tree, bush, tuft, flower, log and mushroom the valley scatters. Each builder returns one merged,
 * faceted, vertex-coloured geometry (origin at the base, +y up) for a season, so the flora system can instance it
 * and the gallery can show it. Deterministic per seed.
 */
import * as THREE from 'three';
import { mulberry32 } from '../../../../../shared/identity.ts';
import type { Season } from '../../model/types.ts';
import { hash2 } from '../../world/noise.ts';
import { paint } from '../toon.ts';
import { blade, gradient, merge } from './geom.ts';
import { rockGeometry } from '../terrain/rocks.ts';

const C = (h: number) => new THREE.Color(h);
type Rng = () => number;

// ------------------------------------------------------------------------------------------------ primitives

/** Lumpy canopy blob: an icosahedron whose corners move together (position-keyed jitter keeps it watertight). */
function blob(r: number, seed: number, o: { squash?: number; detail?: number; lump?: number } = {}): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, o.detail ?? 1);
  const p = g.attributes.position;
  const lump = o.lump ?? 0.22;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + (hash2(Math.round(x * 997) + seed * 7919, Math.round(y * 991) * 3 + Math.round(z * 983)) - 0.5) * 2 * lump;
    p.setXYZ(i, x * k, y * k * (o.squash ?? 0.82), z * k);
  }
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  return g;
}

/** A tapered limb from a to b (few sides). */
function limb(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, sides = 5): THREE.BufferGeometry {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, sides, 1, false);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate(a.x, a.y, a.z);
  g.deleteAttribute('uv');
  return g;
}

/** Paint per face: pick(faceCentreY, faceNormalY, rng) → colour. */
function paintFaces(g0: THREE.BufferGeometry, pick: (y: number, ny: number, r: Rng) => THREE.Color, seed: number): THREE.BufferGeometry {
  const g = g0.index ? g0.toNonIndexed() : g0;
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal;
  const c = new Float32Array(p.count * 3);
  const r = mulberry32(seed);
  for (let i = 0; i < p.count; i += 3) {
    const y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    const ny = (n.getY(i) + n.getY(i + 1) + n.getY(i + 2)) / 3;
    const col = pick(y, ny, r);
    for (let k = 0; k < 3; k++) { c[(i + k) * 3] = col.r; c[(i + k) * 3 + 1] = col.g; c[(i + k) * 3 + 2] = col.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

const tc = new THREE.Color();
/** Leafy colouring: darker underneath, lighter crowns, a few flecks of `accent`. */
function leafy(dark: THREE.Color, light: THREE.Color, y0: number, y1: number, accent?: THREE.Color, accentP = 0.15, snow = false) {
  return (y: number, ny: number, r: Rng): THREE.Color => {
    const k = Math.min(1, Math.max(0, (y - y0) / (y1 - y0)));
    tc.copy(dark).lerp(light, k * 0.75 + Math.max(0, ny) * 0.3);
    if (accent && r() < accentP) tc.lerp(accent, 0.75);
    tc.multiplyScalar(0.94 + r() * 0.12);
    if (snow && ny > 0.55) tc.set(0xf2f6fb).multiplyScalar(0.94 + ny * 0.06);
    return tc;
  };
}

function bark(g: THREE.BufferGeometry, h: number, dark = C(0x6e4a2e), light = C(0x9a6c44)): THREE.BufferGeometry {
  return gradient(g.index ? g.toNonIndexed() : g, dark, light, 0, h);
}

function trunk(h: number, r0: number, r1: number, seed: number, lean = 0): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, h, 6, 3);
  g.translate(0, h / 2, 0);
  const p = g.attributes.position, rr = mulberry32(seed);
  const bend = [(rr() - 0.5) * 0.25, (rr() - 0.5) * 0.25];
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / h;
    p.setX(i, p.getX(i) + Math.sin(t * Math.PI) * bend[0] + t * t * lean);
    p.setZ(i, p.getZ(i) + Math.sin(t * Math.PI) * bend[1]);
  }
  g.deleteAttribute('uv');
  return g;
}

/** Winter / dead crown: a forked branch structure from the trunk top. */
function branches(top: THREE.Vector3, r: Rng, n: number, len: number, rad: number, depth = 2): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const grow = (from: THREE.Vector3, dir: THREE.Vector3, l: number, rd: number, d: number) => {
    const to = from.clone().addScaledVector(dir, l);
    out.push(limb(from, to, rd, rd * 0.55, 4));
    if (d <= 0) return;
    const kids = 2;
    for (let i = 0; i < kids; i++) {
      const nd = dir.clone().add(new THREE.Vector3((r() - 0.5) * 1.2, 0.35 + r() * 0.4, (r() - 0.5) * 1.2)).normalize();
      grow(to, nd, l * (0.55 + r() * 0.2), rd * 0.55, d - 1);
    }
  };
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.8;
    const dir = new THREE.Vector3(Math.cos(a) * 0.8, 0.8 + r() * 0.5, Math.sin(a) * 0.8).normalize();
    grow(top.clone().add(new THREE.Vector3(0, -r() * 0.6, 0)), dir, len * (0.8 + r() * 0.4), rad, depth);
  }
  return out;
}

const bare = (parts: THREE.BufferGeometry[], h: number, snow: boolean, seed: number) =>
  parts.map((g) => paintFaces(g, (y, ny, r) => {
    tc.set(0x6a4a30).lerp(C(0x8f6a48), Math.min(1, y / h) * 0.6).multiplyScalar(0.92 + r() * 0.1);
    if (snow && ny > 0.5) tc.set(0xeef3f8);
    return tc;
  }, seed));

// ------------------------------------------------------------------------------------------------ palettes

interface LeafSet { dark: THREE.Color; light: THREE.Color; accent?: THREE.Color; p?: number }
/** Deciduous leaf colours by season for a "hue slot" (0..3) so neighbouring species differ. */
function leaves(season: Season, slot: number): LeafSet | null {
  switch (season) {
    case 'spring': return [
      { dark: C(0x4f9a3e), light: C(0x9ad866), accent: C(0xf5b0c8), p: 0.14 },
      { dark: C(0xd66f98), light: C(0xf7b7cf), accent: C(0xfff0f5), p: 0.25 }, // cherry blossom
      { dark: C(0xd9cfd8), light: C(0xfff8fb), accent: C(0x9ad866), p: 0.15 }, // white blossom
      { dark: C(0x5aa246), light: C(0xa6dc70), accent: C(0xf2b8cc), p: 0.1 },
    ][slot];
    case 'summer': return [
      { dark: C(0x3a7a36), light: C(0x6fb64c), accent: C(0x8fcf5c), p: 0.12 },
      { dark: C(0x2f6c3a), light: C(0x5ea549) },
      { dark: C(0x4a8a36), light: C(0x86c455), accent: C(0x5fa64a), p: 0.15 },
      { dark: C(0x3a7f3f), light: C(0x78bd57), accent: C(0xa6d56a), p: 0.1 },
    ][slot];
    case 'autumn': return [
      { dark: C(0xb85a24), light: C(0xf0a040), accent: C(0xf6c84a), p: 0.18 },
      { dark: C(0x9c2f24), light: C(0xde5a38), accent: C(0xf09040), p: 0.2 },
      { dark: C(0xc08a22), light: C(0xf6d04a), accent: C(0xe8903a), p: 0.15 },
      { dark: C(0x8a5a26), light: C(0xd88a3a), accent: C(0x9a3a2a), p: 0.15 },
    ][slot];
    default: return null;
  }
}

// ------------------------------------------------------------------------------------------------ trees

export type TreeKind = 'round' | 'lolly' | 'bushy' | 'oak' | 'birch' | 'pine' | 'fir' | 'willow' | 'hero';
export const TREE_KINDS: readonly TreeKind[] = ['round', 'lolly', 'bushy', 'oak', 'birch', 'pine', 'fir', 'willow', 'hero'];

export function treeGeometry(kind: TreeKind, season: Season, seed = 1): THREE.BufferGeometry {
  const r = mulberry32(seed * 2654435761 + kind.length * 97);
  const winter = season === 'winter';
  const parts: THREE.BufferGeometry[] = [];
  const canopy = (blobs: [number, number, number, number][], slot: number, y0: number, y1: number, squash = 0.82, override?: LeafSet) => {
    const L = override ?? leaves(season, slot)!;
    for (const [x, y, z, rad] of blobs) {
      const b = blob(rad, seed * 31 + parts.length, { squash });
      b.translate(x, y, z);
      parts.push(paintFaces(b, leafy(L.dark, L.light, y0, y1, L.accent, L.p ?? 0.12), seed * 13 + parts.length));
    }
  };
  switch (kind) {
    case 'round': case 'lolly': case 'bushy': {
      const slot = kind === 'round' ? 0 : kind === 'lolly' ? 1 : 2;
      const h = kind === 'lolly' ? 2.8 : kind === 'bushy' ? 1.6 : 2.2;
      parts.push(bark(trunk(h + 0.8, 0.26, 0.16, seed), h));
      if (winter) { parts.push(...bare(branches(new THREE.Vector3(0, h + 0.6, 0), r, 4, 1.5, 0.12), h + 3, true, seed)); break; }
      const blobs: [number, number, number, number][] = kind === 'round'
        ? [[0, h + 1.5, 0, 1.75], [0.9, h + 1.0, 0.5, 1.05], [-0.8, h + 1.1, -0.4, 1.1], [0.1, h + 2.6, -0.2, 1.1]]
        : kind === 'lolly'
          ? [[0, h + 1.2, 0, 1.3], [0, h + 2.4, 0, 1.05], [0.4, h + 1.8, 0.4, 0.8]]
          : [[0, h + 1.2, 0, 1.5], [1.2, h + 0.8, 0.3, 1.2], [-1.1, h + 0.9, 0.5, 1.2], [0.2, h + 0.9, -1.2, 1.15], [0, h + 2.1, 0.2, 1.1]];
      canopy(blobs, slot, h, h + 3.5);
      break;
    }
    case 'oak': case 'hero': {
      const big = kind === 'hero' ? 2.1 : 1;
      const h = 2.6 * big;
      parts.push(bark(trunk(h + 0.8 * big, 0.5 * big, 0.3 * big, seed), h * 1.3, C(0x55392a), C(0x7a5236)));
      // roots and main limbs
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + r();
        parts.push(bark(limb(new THREE.Vector3(0, 0.5 * big, 0), new THREE.Vector3(Math.cos(a) * 0.9 * big, -0.15, Math.sin(a) * 0.9 * big), 0.22 * big, 0.08 * big, 4), 1, C(0x4e3424), C(0x6a4a30)));
      }
      const limbs: THREE.Vector3[] = [];
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + r() * 0.6;
        const end = new THREE.Vector3(Math.cos(a) * 1.9 * big, h + (1.3 + r() * 0.6) * big, Math.sin(a) * 1.9 * big);
        limbs.push(end);
        parts.push(bark(limb(new THREE.Vector3(0, h * 0.85, 0), end, 0.2 * big, 0.1 * big, 5), h * 1.6, C(0x55392a), C(0x7a5236)));
      }
      if (winter) { for (const e of limbs) parts.push(...bare(branches(e, r, 2, 1.1 * big, 0.08 * big, 1), h + 4 * big, true, seed)); break; }
      const blobs: [number, number, number, number][] = [[0, h + 2.4 * big, 0, 2.0 * big]];
      for (const e of limbs) blobs.push([e.x * 1.05, e.y + 0.4 * big, e.z * 1.05, (1.35 + r() * 0.35) * big]);
      blobs.push([0.4 * big, h + 3.6 * big, -0.3 * big, 1.4 * big]);
      // the old tree flowers in spring: blossom sprinkled through the green
      const bloom = kind === 'hero' && season === 'spring' ? { dark: C(0x4f9a3e), light: C(0x9ad866), accent: C(0xf5a8c4), p: 0.38 } : undefined;
      canopy(blobs, 3, h + big, h + 4.6 * big, 0.75, bloom);
      break;
    }
    case 'birch': {
      const h = 4.6;
      const t = trunk(h, 0.16, 0.08, seed);
      parts.push(paintFaces(t, (y, _ny, rr) => (rr() < 0.18 || Math.sin(y * 9) > 0.86 ? tc.set(0x3a3430) : tc.set(0xeee8dc).multiplyScalar(0.92 + rr() * 0.1)), seed));
      if (winter) { parts.push(...bare(branches(new THREE.Vector3(0, h - 0.3, 0), r, 4, 1.0, 0.06), h + 2, true, seed)); break; }
      const L = season === 'autumn' ? { dark: C(0xc8962a), light: C(0xf8dc58), accent: C(0xf0b040), p: 0.15 } : season === 'spring' ? leaves(season, 0)! : leaves(season, 2)!;
      const blobs: [number, number, number, number][] = [[0, h - 0.4, 0, 1.05], [0.6, h + 0.3, 0.2, 0.8], [-0.5, h + 0.5, -0.3, 0.75], [0.1, h + 1.2, 0, 0.7], [0.5, h - 1.3, -0.4, 0.7], [-0.6, h - 1.0, 0.4, 0.65]];
      for (const [x, y, z, rad] of blobs) {
        const b = blob(rad, seed * 17 + parts.length, { squash: 1.1 });
        b.translate(x, y, z);
        parts.push(paintFaces(b, leafy(L.dark, L.light, h - 2, h + 1.5, L.accent, L.p ?? 0.1), seed + parts.length));
      }
      break;
    }
    case 'pine': case 'fir': {
      const tiers = kind === 'pine' ? 4 : 5;
      const h0 = kind === 'pine' ? 1.1 : 0.8;
      const H = kind === 'pine' ? 6.8 : 8.2;
      const W = kind === 'pine' ? 2.2 : 1.7;
      parts.push(bark(trunk(h0 + 1, 0.22, 0.14, seed), h0 + 1));
      const dark = kind === 'pine' ? C(0x2c5e3e) : C(0x244f3a), light = kind === 'pine' ? C(0x4f8f52) : C(0x3f7a4c);
      for (let i = 0; i < tiers; i++) {
        const t = i / tiers;
        const rad = W * (1 - t * 0.72);
        const th = (H - h0) / tiers * 1.55;
        const y = h0 + t * (H - h0 - th * 0.6);
        const cone = new THREE.ConeGeometry(rad, th, 7, 1);
        cone.translate(0, th / 2, 0);
        cone.rotateY(r() * 3);
        const p = cone.attributes.position;
        for (let v = 0; v < p.count; v++) {
          if (p.getY(v) > 0.01) continue;
          const k = 1 + (hash2(Math.round(p.getX(v) * 999) + i * 31 + seed, Math.round(p.getZ(v) * 999)) - 0.5) * 0.35;
          p.setXYZ(v, p.getX(v) * k, (hash2(p.getZ(v) * 99, i + seed) - 0.5) * 0.3, p.getZ(v) * k);
        }
        cone.translate(0, y, 0);
        cone.deleteAttribute('uv');
        parts.push(paintFaces(cone, (yy, ny, rr) => {
          tc.copy(dark).lerp(light, Math.min(1, Math.max(0, (yy - y) / th)) * 0.8 + t * 0.25);
          if (ny < -0.3) tc.multiplyScalar(0.7);
          tc.multiplyScalar(0.93 + rr() * 0.12);
          if (winter && ny > 0.35 && rr() < 0.85) tc.set(0xf2f6fb).multiplyScalar(0.9 + ny * 0.1);
          return tc;
        }, seed + i));
      }
      break;
    }
    case 'willow': {
      const h = 2.6;
      parts.push(bark(trunk(h + 0.8, 0.34, 0.2, seed, 0.3), h, C(0x5a4632), C(0x806446)));
      if (winter) {
        const bb = branches(new THREE.Vector3(0.3, h + 0.6, 0), r, 5, 1.3, 0.1, 1);
        parts.push(...bare(bb, h + 3, true, seed));
        break;
      }
      const L = season === 'autumn' ? { dark: C(0x9a9a3a), light: C(0xe0d060), accent: C(0xd8a040), p: 0.2 }
        : season === 'spring' ? { dark: C(0x6aaa4a), light: C(0xb8e070), accent: C(0xd8f09a), p: 0.1 } : { dark: C(0x4f8f45), light: C(0x94c65a), accent: C(0xb0d870), p: 0.1 };
      const dome = blob(2.0, seed, { squash: 0.6, lump: 0.15 });
      dome.translate(0.3, h + 1.6, 0);
      parts.push(paintFaces(dome, leafy(L.dark, L.light, h, h + 2.8, L.accent, L.p), seed));
      // hanging curtains of leaves
      const n = 44;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 * 3.1 + r() * 0.3;
        const rad = 1.1 + r() * 1.0;
        const len = 1.1 + r() * 1.3 + (rad - 1.1) * 0.7;
        const strand = new THREE.ConeGeometry(0.13, len, 3, 1);
        strand.scale(1, 1, 0.4);
        strand.rotateX(Math.PI);
        strand.rotateY(a);
        strand.translate(0.3 + Math.cos(a) * rad, h + 1.6 - len / 2 + 0.3, Math.sin(a) * rad);
        strand.deleteAttribute('uv');
        parts.push(paintFaces(strand, leafy(L.dark, L.light, h + 1.6 - len, h + 1.8, L.accent, L.p), seed + i));
      }
      break;
    }
  }
  return merge(parts);
}

// ------------------------------------------------------------------------------------------------ bushes, logs, stumps

export type BushKind = 'bush' | 'berry' | 'hedge';
export function bushGeometry(kind: BushKind, season: Season, seed = 1): THREE.BufferGeometry {
  const r = mulberry32(seed * 7 + kind.length);
  const parts: THREE.BufferGeometry[] = [];
  const winter = season === 'winter';
  const L = kind === 'berry' ? { dark: C(0x2f6a3a), light: C(0x5ea04c) }
    : season === 'autumn' ? { dark: C(0x5a6a2a), light: C(0xa8a040), accent: C(0xe0803a) } : leaves(season === 'winter' ? 'autumn' : season, kind === 'hedge' ? 1 : 3)!;
  const dark = winter ? C(0x6a6040) : L.dark;
  const light = winter ? C(0x9a8a5a) : L.light;
  const blobs: [number, number, number, number][] = kind === 'hedge'
    ? [[-1.2, 0.55, 0, 0.7], [-0.4, 0.6, 0.05, 0.75], [0.4, 0.58, -0.05, 0.75], [1.2, 0.55, 0, 0.7]]
    : [[0, 0.45, 0, 0.62], [0.45, 0.35, 0.2, 0.45], [-0.4, 0.35, -0.15, 0.48], [0.1, 0.72, -0.1, 0.42]];
  for (const [x, y, z, rad] of blobs) {
    const b = blob(rad, seed * 5 + parts.length, { squash: 0.8, lump: 0.25 });
    b.translate(x, y, z);
    parts.push(paintFaces(b, leafy(dark, light, 0, 1.1, winter ? C(0xf2f6fb) : L.accent, winter ? 0.3 : 0.14, winter), seed + parts.length));
  }
  if (kind === 'berry' && !winter) {
    const berry = season === 'spring' ? C(0xfbf2f6) : season === 'summer' ? C(0xd8343a) : C(0x5a3a9a);
    for (let i = 0; i < 10; i++) {
      const a = r() * 6.28, e = 0.2 + r() * 0.9;
      const b = new THREE.OctahedronGeometry(0.07, 0);
      b.translate(Math.cos(a) * 0.6 * Math.cos(e), 0.4 + Math.sin(e) * 0.5, Math.sin(a) * 0.6 * Math.cos(e));
      parts.push(paint(b, berry));
    }
  }
  return merge(parts);
}

export function logGeometry(season: Season, seed = 1): THREE.BufferGeometry {
  const r = mulberry32(seed + 404);
  const parts: THREE.BufferGeometry[] = [];
  const len = 2.6, rad = 0.26;
  const body = new THREE.CylinderGeometry(rad, rad * 1.1, len, 7, 1, true).rotateZ(Math.PI / 2).translate(0, rad * 0.8, 0);
  parts.push(paintFaces(body, (_y, ny, rr) => {
    tc.set(0x6e4a2e).multiplyScalar(0.88 + rr() * 0.2);
    if (ny > 0.4 && rr() < 0.55) tc.set(season === 'winter' ? 0xf2f6fb : season === 'autumn' ? 0x8a8a40 : 0x5f8f3f);
    return tc;
  }, seed));
  for (const s of [-1, 1]) {
    const cap = new THREE.CircleGeometry(s < 0 ? rad * 1.1 : rad, 7).rotateY((s * Math.PI) / 2).translate((s * len) / 2, rad * 0.8, 0);
    parts.push(paintFaces(cap, (_y, _n, rr) => tc.set(0xd9ae78).multiplyScalar(0.92 + rr() * 0.12), seed + 1));
  }
  const stub = limb(new THREE.Vector3(0.3, rad * 1.4, 0.05), new THREE.Vector3(0.6, rad * 2.6, 0.35), 0.07, 0.04, 4);
  parts.push(bark(stub, 1));
  if (season !== 'winter' && r() < 2) {
    // a shelf fungus
    const f = new THREE.CylinderGeometry(0.16, 0.12, 0.05, 6).translate(-0.6, rad * 0.9, rad * 0.95);
    parts.push(paint(f.toNonIndexed(), C(0xe0b06a)));
  }
  return merge(parts);
}

export function stumpGeometry(season: Season, seed = 1): THREE.BufferGeometry {
  const r = mulberry32(seed + 77);
  const parts: THREE.BufferGeometry[] = [];
  const h = 0.55;
  const body = new THREE.CylinderGeometry(0.34, 0.42, h, 8).translate(0, h / 2, 0);
  parts.push(paintFaces(body, (y, ny, rr) => {
    if (ny > 0.9) return tc.set(season === 'winter' ? 0xf2f6fb : 0xd9ae78).multiplyScalar(0.94 + rr() * 0.08);
    return tc.set(0x5e3f28).lerp(C(0x7a5236), y / h).multiplyScalar(0.9 + rr() * 0.15);
  }, seed));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * 6.28 + r();
    parts.push(bark(limb(new THREE.Vector3(0, 0.25, 0), new THREE.Vector3(Math.cos(a) * 0.62, -0.05, Math.sin(a) * 0.62), 0.13, 0.05, 4), 0.4));
  }
  if (season !== 'winter') {
    const ring = new THREE.RingGeometry(0.1, 0.13, 8).rotateX(-Math.PI / 2).translate(0, h + 0.005, 0);
    parts.push(paint(ring, C(0xa87a4e)));
  }
  return merge(parts);
}

export function mushroomGeometry(season: Season, seed = 1): THREE.BufferGeometry {
  const r = mulberry32(seed + 9);
  const parts: THREE.BufferGeometry[] = [];
  const red = seed % 2 === 1;
  for (let i = 0; i < 4; i++) {
    const s = 0.55 + r() * 0.6, x = (r() - 0.5) * 0.35, z = (r() - 0.5) * 0.35;
    parts.push(paint(new THREE.CylinderGeometry(0.03 * s, 0.045 * s, 0.16 * s, 5).translate(x, 0.08 * s, z), C(0xf4ecdc)));
    const cap = new THREE.SphereGeometry(0.11 * s, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1).translate(x, 0.15 * s, z);
    parts.push(paintFaces(cap, (_y, ny, rr) => (red ? (rr() < 0.18 && ny > 0.3 ? tc.set(0xfff8ee) : tc.set(0xd8372c)) : tc.set(0xa8784a).multiplyScalar(0.9 + rr() * 0.2)), seed + i));
  }
  if (season === 'winter') parts.push(paint(new THREE.CylinderGeometry(0.2, 0.25, 0.03, 6).translate(0, 0.015, 0), C(0xf2f6fb)));
  return merge(parts);
}

// ------------------------------------------------------------------------------------------------ ground cover

/** Grass tuft; vertex colours are a light/dark gradient around 1 so the instance colour (ground tint) shows. */
export function tuftGeometry(tall: boolean, season: Season, seed = 1): THREE.BufferGeometry {
  const r = mulberry32(seed + (tall ? 50 : 0));
  const parts: THREE.BufferGeometry[] = [];
  const n = tall ? 12 : 11;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 * 2.618 + r() * 0.8;
    const h = (tall ? 0.5 : 0.24) * (0.65 + r() * 0.7);
    const d = Math.sqrt(r()) * (tall ? 0.3 : 0.34);
    const b = blade(h, tall ? 0.085 : 0.075, h * (0.2 + r() * 0.35), a + (r() - 0.5), 0.1);
    b.translate(Math.cos(a) * d, 0, Math.sin(a) * d);
    parts.push(gradient(b, new THREE.Color(0.62, 0.68, 0.58), season === 'winter' ? new THREE.Color(1.3, 1.32, 1.36) : new THREE.Color(1.16, 1.24, 1.02), 0, h));
  }
  if (tall && season === 'summer') {
    // a couple of seed heads
    for (let i = 0; i < 2; i++) {
      const a = r() * 6.28, h = 0.7 + r() * 0.2;
      const s = new THREE.ConeGeometry(0.03, 0.14, 4).translate(Math.cos(a) * 0.12, h, Math.sin(a) * 0.12);
      parts.push(paint(s, C(0xf8e8b0)));
      parts.push(gradient(blade(h - 0.05, 0.025, 0, a, 0).translate(Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12), new THREE.Color(0.62, 0.68, 0.58), new THREE.Color(1.1, 1.15, 0.95), 0, h));
    }
  }
  return merge(parts);
}

/** Wildflower clump. Heads are white (the instance colour paints them); stems keep their green. */
export function flowerGeometry(kind: 'daisy' | 'bell' | 'tall', seed = 1): THREE.BufferGeometry {
  const r = mulberry32(seed + kind.length * 11);
  const parts: THREE.BufferGeometry[] = [];
  const n = kind === 'tall' ? 3 : 5;
  for (let i = 0; i < n; i++) {
    const a = r() * 6.28, d = r() * 0.22;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const h = (kind === 'tall' ? 0.55 : 0.28) * (0.75 + r() * 0.5);
    parts.push(gradient(blade(h, 0.035, 0.02, a, 0).translate(x, 0, z), C(0x3f7a38), C(0x6aa64a), 0, h));
    if (kind === 'daisy') {
      const head = new THREE.CylinderGeometry(0.07, 0.05, 0.03, 6).translate(x, h, z);
      parts.push(paint(head, C(0xffffff)));
      parts.push(paint(new THREE.CylinderGeometry(0.03, 0.03, 0.035, 5).translate(x, h + 0.01, z), C(0xf2c94a)));
    } else if (kind === 'bell') {
      parts.push(paint(new THREE.ConeGeometry(0.06, 0.09, 5).rotateX(Math.PI).translate(x, h, z), C(0xffffff)));
    } else {
      for (let k = 0; k < 4; k++) parts.push(paint(new THREE.IcosahedronGeometry(0.045, 0).translate(x, h - k * 0.07, z), C(0xffffff)));
    }
    // a leaf or two
    parts.push(gradient(blade(0.12, 0.06, 0.1, a + 1.5).translate(x, 0, z), C(0x3f7a38), C(0x6aa64a), 0, 0.12));
  }
  return merge(parts);
}

export function cloverGeometry(season: Season, seed = 1): THREE.BufferGeometry {
  const r = mulberry32(seed + 3);
  const parts: THREE.BufferGeometry[] = [];
  const leaf = season === 'autumn' ? C(0x7a9a3a) : season === 'winter' ? C(0xc8d8c8) : C(0x4f9a3f);
  for (let i = 0; i < 7; i++) {
    const a = r() * 6.28, d = r() * 0.25, x = Math.cos(a) * d, z = Math.sin(a) * d, h = 0.05 + r() * 0.06;
    for (let k = 0; k < 3; k++) {
      const la = (k / 3) * 6.28 + r();
      const l = new THREE.CircleGeometry(0.045, 5).rotateX(-Math.PI / 2 + 0.25).rotateY(la).translate(x + Math.cos(la) * 0.04, h, z + Math.sin(la) * 0.04);
      parts.push(paint(l, leaf.clone().multiplyScalar(0.9 + r() * 0.2)));
    }
  }
  if (season === 'spring' || season === 'summer') for (let i = 0; i < 2; i++) parts.push(paint(new THREE.IcosahedronGeometry(0.035, 0).translate((r() - 0.5) * 0.3, 0.13, (r() - 0.5) * 0.3), C(0xf4e4f0)));
  return merge(parts);
}

export function meadowRockGeometry(season: Season, seed = 1): THREE.BufferGeometry {
  return rockGeometry({ seed: 60 + seed, season, detail: 1, flat: 0.6, moss: 0.35, warm: 0.45 });
}

/** A falling leaf / petal card. */
export function leafCardGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.05, 0, 0, 0.05, 0, 0, 0, 0, 0.09, 0, 0, -0.05], 3));
  g.setIndex([0, 2, 1, 0, 1, 3]);
  return g;
}
