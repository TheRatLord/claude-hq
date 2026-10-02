/**
 * Crop models and field layouts. Each kind is a few instanced parts (a plant, its fruit, …); a layout is a list of
 * slots (site-local position, yaw, scale, part) that leaves every farmer spot clear. Growth scales plants and makes
 * fruit appear; the crop shader handles sway, droop and colour.
 */
import * as THREE from 'three';
import type { PlotKind, Season } from '../../model/types.ts';
import { PAL } from '../toon.ts';
import { ball, box, cached, cone, cyl, jitter, leaf, merge, octa, paint, rng, rod, S } from './geo.ts';
import { foliageBlob } from '../surface/index.ts';
import type { FoliageColors } from '../surface/index.ts';

const col = (a: number, b: number, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();

// ---------------------------------------------------------------------------------------------------------------
// Plant models (origin on the ground, +y up)

export function wheatClump(season: Season): THREE.BufferGeometry {
  if (season === 'winter') return winterWheat();
  return cached(`wheat:${season}`, () => {
    const r = rng('wheat');
    const p: THREE.BufferGeometry[] = [];
    const head = season === 'spring' ? col(PAL.wheat, PAL.leafSpring, 0.45) : PAL.wheat;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + r() * 0.6, rad = 0.04 + r() * 0.17, h = 0.8 + r() * 0.35, lean = 0.08 + r() * 0.14;
      const bx = Math.cos(a) * rad, bz = Math.sin(a) * rad;
      const tx = bx + Math.cos(a) * lean, tz = bz + Math.sin(a) * lean;
      p.push(rod([bx, 0, bz], [tx, h, tz], 0.02, 0.014, 3, col(PAL.grassDry, PAL.wheat, 0.4 + r() * 0.3)));
      const dx = Math.cos(a) * 0.05, dz = Math.sin(a) * 0.05;
      p.push(S(rod([tx, h - 0.02, tz], [tx + dx, h + 0.2, tz + dz], 0.042, 0.018, 4, col(head, 0xffffff, r() * 0.15)), 'hay', { scale: 0.35, strength: 0.8 }));
      p.push(rod([tx + dx, h + 0.19, tz + dz], [tx + dx * 1.6, h + 0.3, tz + dz * 1.6], 0.006, 0.004, 3, col(head, 0xfff0c0, 0.4)));
    }
    for (let i = 0; i < 3; i++) p.push(leaf(0.45, 0.07, col(PAL.grassDry, PAL.grass, 0.5), { p: [0, 0.1, 0], r: [-0.7, (i / 3) * Math.PI * 2 + 0.5, 0] }, 0.3));
    return jitter(merge(p), 0.04, 31);
  });
}

/** Winter wheat: a tuft of short, bright green shoots in the cold soil (snow settles on them), a few old straws. */
function winterWheat(): THREE.BufferGeometry {
  return cached('wheat:winter', () => {
    const r = rng('wheatw');
    const p: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + r() * 0.5;
      p.push(leaf(0.4 + r() * 0.2, 0.07, i % 3 ? 0x5fb03c : 0x86cc50, { p: [Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05], r: [-0.25 - r() * 0.35, a + Math.PI / 2, 0] }, 0.3));
    }
    for (let i = 0; i < 3; i++) {
      const a = r() * 6.28, d = 0.12 + r() * 0.08;
      p.push(rod([Math.cos(a) * d, 0, Math.sin(a) * d], [Math.cos(a) * d * 1.3, 0.16 + r() * 0.08, Math.sin(a) * d * 1.3], 0.016, 0.012, 3, col(PAL.grassDry, PAL.wheat, 0.5)));
    }
    return jitter(merge(p), 0.03, 33);
  });
}

function ribbedBall(r: number, color: number, squash: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, 12, 7);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const f = 1 + 0.08 * Math.cos(a * 6);
    const pinch = y > r * 0.75 ? 0.75 : 1;
    pos.setXYZ(i, x * f * pinch, y * squash, z * f * pinch);
  }
  const out = g.toNonIndexed();
  out.deleteAttribute('uv'); out.deleteAttribute('normal');
  const c = new THREE.Color(color), n = out.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  out.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return out;
}

export function pumpkin(): THREE.BufferGeometry {
  return cached('pumpkin', () => {
    const body = ribbedBall(0.4, PAL.pumpkin, 0.72);
    paint(body, 'ribs');
    body.translate(0, 0.27, 0);
    const p = [body];
    p.push(S(rod([0, 0.52, 0], [0.04, 0.68, 0.03], 0.05, 0.035, 5, 0x6a7a2a), 'bark', { scale: 0.35, strength: 0.7 }));
    p.push(leaf(0.3, 0.3, PAL.leafDark, { p: [0.02, 0.56, 0], r: [-0.25, 1.2, 0] }, 0.2));
    return jitter(merge(p), 0.03, 41);
  });
}

export function pumpkinVine(season: Season): THREE.BufferGeometry {
  return cached(`vine:${season}`, () => {
    const r = rng('vine');
    const p: THREE.BufferGeometry[] = [];
    // winter: the vine has died back to a frost-bitten brown mat over straw mulch
    const dead = season === 'winter';
    const lc = season === 'autumn' ? col(PAL.leaf, PAL.grassDry, 0.35) : dead ? 0x8a6a3a : PAL.leaf;
    const ld = dead ? 0x6e5430 : PAL.leafDark;
    if (dead) for (let i = 0; i < 4; i++) p.push(S(box(0.5, 0.05, 0.4, PAL.hay, { p: [(r() - 0.5) * 0.3, 0.03, -0.5 + i * 0.34], r: [0, r(), 0] }), 'hay', { scale: 0.4 }));
    p.push(rod([0, 0.05, -0.7], [0.1, 0.06, 0.7], 0.03, 0.03, 4, dead ? 0x7a6038 : 0x6a8a2a));
    for (let i = 0; i < 6; i++) {
      const z = -0.6 + i * 0.24, side = i % 2 ? 1 : -1;
      const lift = dead ? 0.45 : 1;
      p.push(rod([0.05, 0.1 * lift, z], [0.05 + side * 0.15, (0.22 + r() * 0.12) * lift, z + 0.05], 0.018, 0.014, 3, dead ? 0x7a6038 : 0x6a8a2a));
      p.push(leaf((0.5 + r() * 0.15) * (dead ? 0.8 : 1), 0.52, i % 3 === 0 ? ld : lc, { p: [0.05 + side * 0.15, (0.24 + r() * 0.1) * lift, z + 0.05], r: [-0.15 - r() * 0.3 + (dead ? 0.5 : 0), side * (1.2 + r() * 0.6), 0] }, dead ? 0.45 : 0.18));
    }
    // flowers: spring and summer are full of them, autumn has a few, winter none
    const nf = season === 'spring' ? 6 : season === 'summer' ? 4 : season === 'autumn' ? 2 : 0;
    for (let i = 0; i < nf; i++) p.push(octa(0.06, PAL.yellow, { p: [(r() - 0.5) * 0.5, 0.2, (r() - 0.5) * 1.2], s: [1.2, 0.6, 1.2] }));
    return jitter(merge(p), 0.05, 43);
  });
}

export function cabbage(): THREE.BufferGeometry {
  return cached('cabbage', () => {
    const p: THREE.BufferGeometry[] = [];
    p.push(paint(ball(0.2, 0xe4f4cc, { p: [0, 0.2, 0], s: [1, 0.88, 1] }, 1), 'head'));
    for (let i = 0; i < 5; i++) p.push(leaf(0.3, 0.32, 0xd2ecb8, { p: [0, 0.06, 0], r: [-1.05, (i / 5) * Math.PI * 2, 0] }, 0.35));
    for (let i = 0; i < 7; i++) p.push(leaf(0.38, 0.36, 0xb8dc9c, { p: [0, 0.04, 0], r: [-0.42, (i / 7) * Math.PI * 2 + 0.3, 0] }, 0.25));
    return jitter(merge(p), 0.035, 51);
  });
}

export const SUN_STEM = 1.9;
export function sunflowerPlant(season: Season): THREE.BufferGeometry {
  return cached(`sunplant:${season}`, () => {
    const r = rng('sunflower');
    const p: THREE.BufferGeometry[] = [];
    // winter: a dry, brown stalk, its leaves hanging shrivelled (the seed heads are left for the birds)
    const dry = season === 'winter';
    const lc = season === 'autumn' ? col(PAL.leaf, PAL.grassDry, 0.4) : dry ? 0x7a5a32 : PAL.leaf;
    p.push(rod([0, 0, 0], [0, SUN_STEM, 0], 0.045, 0.03, 5, dry ? 0x8a6c42 : col(PAL.leaf, PAL.grassDry, 0.25)));
    for (let i = 0; i < 6; i++) {
      const y = 0.35 + i * 0.25, yaw = i * 2.4 + r() * 0.5;
      p.push(leaf((0.34 - i * 0.03) * (dry ? 0.75 : 1), 0.3 - i * 0.025, i % 2 ? (dry ? 0x5e4426 : PAL.leafDark) : lc, { p: [0, y, 0], r: [0.1 + r() * 0.2 + (dry ? 1.0 : 0), yaw, 0] }, dry ? 0.5 : 0.3));
    }
    return jitter(merge(p), 0.04, 61);
  });
}

/** Sunflower head, facing +z, origin at its centre (attached to the stem top). */
export function sunflowerHead(season: Season = 'summer'): THREE.BufferGeometry {
  const dry = season === 'winter';
  return cached(dry ? 'sunhead:dry' : 'sunhead', () => {
    const p: THREE.BufferGeometry[] = [];
    p.push(paint(cyl(0.2, 0.21, 0.08, 10, dry ? 0x4a3420 : PAL.sunflowerCore, { p: [0, 0, 0.03], r: [Math.PI / 2, 0, 0] }), 'seeds'));
    p.push(paint(cyl(0.12, 0.12, 0.03, 8, dry ? 0x2e2014 : 0x4a2a14, { p: [0, 0, 0.075], r: [Math.PI / 2, 0, 0] }), 'seeds'));
    p.push(cone(0.2, 0.14, 8, dry ? 0x6a5030 : PAL.leafDark, { p: [0, 0, -0.06], r: [-Math.PI / 2, 0, 0] }));
    // dry: a ragged ring of curled brown petals
    if (dry) {
      for (let i = 0; i < 11; i++) {
        const pet = leaf(0.11, 0.07, i % 2 ? 0x9a7038 : 0x7a5428, undefined, 0.5);
        pet.rotateX(-Math.PI / 2 - 0.6);
        pet.translate(0, 0.18, -0.02);
        pet.rotateZ((i / 11) * Math.PI * 2);
        p.push(pet);
      }
      return jitter(merge(p), 0.03, 64);
    }
    for (let ring = 0; ring < 2; ring++) {
      const n = 13;
      for (let i = 0; i < n; i++) {
        const a = ((i + ring * 0.5) / n) * Math.PI * 2;
        const pet = leaf(0.2 + ring * 0.02, 0.1, ring ? col(PAL.sunflower, PAL.orange, 0.25) : PAL.sunflower, undefined, 0.35);
        pet.rotateX(-Math.PI / 2 + 0.25);
        pet.translate(0, 0.17, ring ? 0.0 : 0.02);
        pet.rotateZ(a);
        p.push(pet);
      }
    }
    return jitter(merge(p), 0.03, 63);
  });
}

export interface Blob { x: number; y: number; z: number; r: number }
export const TREE_BLOBS: Blob[] = [
  { x: 0, y: 2.25, z: 0, r: 0.95 }, { x: 0.6, y: 1.95, z: 0.25, r: 0.7 }, { x: -0.6, y: 2.0, z: -0.2, r: 0.72 },
  { x: 0.1, y: 1.95, z: -0.65, r: 0.66 }, { x: -0.15, y: 2.0, z: 0.62, r: 0.66 }, { x: 0.15, y: 2.8, z: 0.05, r: 0.6 },
];
export function fruitTree(season: Season): THREE.BufferGeometry {
  return cached(`tree:${season}`, () => {
    const r = rng('tree');
    const p: THREE.BufferGeometry[] = [];
    let js = 71;
    const bark = (g: THREE.BufferGeometry, sc = 0.7) => jitter(S(g, 'bark', { scale: sc }), 0.05, js++);
    p.push(bark(rod([0, 0, 0], [0.05, 1.5, 0.02], 0.17, 0.11, 6, PAL.trunk), 0.8));
    const br: [number, number, number][] = [[0.7, 2.1, 0.3], [-0.65, 2.15, -0.2], [0.1, 2.2, -0.7], [-0.2, 2.1, 0.7], [0.1, 2.7, 0.1]];
    for (const b of br) p.push(bark(rod([0.04, 1.35, 0.02], b, 0.09, 0.04, 5, PAL.bark), 0.5));
    if (season === 'winter') {
      for (const b of br) {
        p.push(bark(rod(b, [b[0] * 1.5, b[1] + 0.35, b[2] * 1.5], 0.04, 0.02, 4, PAL.bark), 0.4));
        p.push(bark(rod([b[0] * 0.8, b[1] - 0.05, b[2] * 0.8], [b[0] * 1.2 + 0.2, b[1] + 0.5, b[2] * 1.3 - 0.1], 0.03, 0.015, 3, PAL.bark), 0.4));
        p.push(S(box2(b, PAL.snow), 'snow'));
      }
    } else {
      // soft, clumped crown: lumpy blobs painted cool-dark inside to warm-lit tips, normals bent round each blob
      const L: FoliageColors = season === 'autumn' ? { dark: new THREE.Color(0xa8402a), light: new THREE.Color(0xf09a3a), accent: new THREE.Color(0xf6c84a), p: 0.14 }
        : season === 'spring' ? { dark: new THREE.Color(0x4f9a3e), light: new THREE.Color(0xa6dc6a) }
          : { dark: new THREE.Color(PAL.leafDark), light: new THREE.Color(0x86c455) };
      const cc = new THREE.Vector3(0, 2.2, 0);
      TREE_BLOBS.forEach((b, i) => {
        const g = new THREE.IcosahedronGeometry(b.r, 1);
        const q = g.attributes.position;
        for (let v = 0; v < q.count; v++) {
          const x = q.getX(v), y = q.getY(v), z = q.getZ(v);
          const k = 1 + (Math.abs(Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + i * 13.3) * 43758.5453) % 1 - 0.5) * 0.12;
          q.setXYZ(v, x * k, y * k * 0.9, z * k);
        }
        g.rotateY(r() * 6.28).translate(b.x, b.y, b.z);
        g.deleteAttribute('uv');
        p.push(foliageBlob(g, new THREE.Vector3(b.x, b.y, b.z), [cc, cc], L, 1.5, 3.3, 90 + i, { squash: 0.9, crown: 0.2 },
          { scale: Math.max(0.6, b.r / 1.15), strength: 0.9, aux: b.r }));
      });
      if (season === 'spring') {
        for (let i = 0; i < 40; i++) {
          const b = TREE_BLOBS[i % TREE_BLOBS.length];
          const d = new THREE.Vector3(r() - 0.5, r() * 0.8 - 0.1, r() - 0.5).normalize();
          p.push(octa(0.07, i % 3 ? 0xfbd3e0 : 0xffffff, { p: [b.x + d.x * b.r * 1.04, b.y + d.y * b.r * 0.94, b.z + d.z * b.r * 1.04] }));
        }
      }
    }
    // roots
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.4; p.push(bark(rod([0, 0.25, 0], [Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35], 0.08, 0.04, 4, PAL.trunk), 0.5)); }
    return merge(p);
  });
}
const box2 = (b: [number, number, number], c: number) => ball(0.09, c, { p: [b[0], b[1] + 0.06, b[2]], s: [1.3, 0.5, 1.3] });

export function apple(): THREE.BufferGeometry {
  return cached('apple', () => merge([ball(0.095, 0xffffff, { s: [1, 0.92, 1] }, 1), rod([0, 0.08, 0], [0.02, 0.15, 0], 0.012, 0.01, 3, PAL.woodDark)]));
}

/** A grapevine section on a trellis (origin on the ground under the wire). */
export function vineBlob(season: Season): THREE.BufferGeometry {
  return cached(`vineblob:${season}`, () => {
    const r = rng('vineblob');
    const p: THREE.BufferGeometry[] = [];
    p.push(S(rod([0, 0, 0], [0.06, 0.5, 0.05], 0.07, 0.05, 5, PAL.bark), 'bark', { scale: 0.4 }), S(rod([0.06, 0.5, 0.05], [-0.03, 0.95, -0.05], 0.05, 0.04, 5, PAL.bark), 'bark', { scale: 0.4 }));
    if (season === 'winter') {
      p.push(S(rod([-0.03, 0.95, -0.05], [0, 1.0, 0.6], 0.035, 0.02, 4, PAL.bark), 'bark', { scale: 0.3 }), S(rod([-0.03, 0.95, -0.05], [0, 1.0, -0.6], 0.035, 0.02, 4, PAL.bark), 'bark', { scale: 0.3 }));
      return merge(p);
    }
    const c1 = season === 'autumn' ? PAL.leafAutumn2 : PAL.leaf, c2 = season === 'autumn' ? PAL.leafAutumn : PAL.leafDark;
    for (let i = 0; i < 5; i++) {
      const z = -0.5 + i * 0.25, y = 1.05 + r() * 0.4;
      p.push(S(ball(0.2 + r() * 0.09, i % 2 ? c1 : c2, { p: [(r() - 0.5) * 0.2, y, z], s: [0.85, 1, 1.1], r: [r(), r(), 0] }), 'leaves', { scale: 0.35, strength: 0.7 }));
    }
    for (let i = 0; i < 8; i++) {
      const z = -0.55 + r() * 1.1, side = i % 2 ? 1 : -1;
      p.push(leaf(0.24, 0.24, i % 3 ? c1 : c2, { p: [side * 0.12, 0.95 + r() * 0.6, z], r: [-0.3 + r() * 0.5, side * (1.4 + r() * 0.4), 0] }, 0.25));
    }
    return jitter(merge(p), 0.05, 81);
  });
}

/** Grape bunch hanging from its origin (white: tinted per instance). */
export function grapes(): THREE.BufferGeometry {
  return cached('grapes', () => {
    const p: THREE.BufferGeometry[] = [rod([0, 0, 0], [0, -0.1, 0], 0.012, 0.012, 3, PAL.woodDark)];
    const rows = [4, 3, 3, 2, 1];
    rows.forEach((n, k) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + k;
        const rr = n > 1 ? 0.055 * (n / 3) : 0;
        p.push(ball(0.042, 0xffffff, { p: [Math.cos(a) * rr, -0.12 - k * 0.065, Math.sin(a) * rr] }));
      }
    });
    p.push(leaf(0.14, 0.12, PAL.leaf, { p: [0, -0.04, 0], r: [-0.4, 0.8, 0] }));
    return merge(p);
  });
}

export function berryBush(season: Season): THREE.BufferGeometry {
  return cached(`bush:${season}`, () => {
    const r = rng('bush');
    const p: THREE.BufferGeometry[] = [];
    const c1 = season === 'autumn' ? PAL.leafAutumn2 : season === 'winter' ? col(PAL.leafDark, 0x8a8a7a, 0.4) : PAL.leafDark;
    const c2 = season === 'autumn' ? PAL.leafAutumn : PAL.leaf;
    const blobs: [number, number, number, number][] = [[0, 0.38, 0, 0.38], [0.28, 0.3, 0.1, 0.28], [-0.26, 0.3, -0.08, 0.3], [0.05, 0.3, 0.28, 0.27], [-0.05, 0.62, -0.05, 0.25]];
    blobs.forEach(([x, y, z, rad], i) => p.push(S(ball(rad, i % 2 ? c2 : c1, { p: [x, y, z], r: [r(), r(), 0] }, 0), 'leaves', { scale: 0.35, strength: 0.7 })));
    for (let i = 0; i < 6; i++) p.push(leaf(0.18, 0.12, c2, { p: [(r() - 0.5) * 0.5, 0.3 + r() * 0.35, (r() - 0.5) * 0.5], r: [-0.5, r() * 6, 0] }));
    return jitter(merge(p), 0.05, 91);
  });
}

/** Berries dotted over a bush's surface (white: tinted per instance). */
export function berries(): THREE.BufferGeometry {
  return cached('berries', () => {
    const r = rng('berries');
    const p: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 24; i++) {
      const a = r() * Math.PI * 2, e = r() * 1.0 - 0.1;
      const x = Math.cos(a) * Math.cos(e) * 0.42, y = 0.36 + Math.sin(e) * 0.38, z = Math.sin(a) * Math.cos(e) * 0.42;
      p.push(ball(0.062, 0xffffff, { p: [x, y, z] }));
    }
    return merge(p);
  });
}

export function lavender(): THREE.BufferGeometry {
  return cached('lavender', () => {
    const r = rng('lav');
    const p: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 11; i++) {
      const a = r() * Math.PI * 2, d = r() * 0.12, h = 0.45 + r() * 0.2;
      const tx = Math.cos(a) * (d + 0.12), tz = Math.sin(a) * (d + 0.12);
      p.push(rod([Math.cos(a) * d, 0, Math.sin(a) * d], [tx, h, tz], 0.012, 0.01, 3, 0x7a9a5a));
      p.push(rod([tx, h, tz], [tx * 1.08, h + 0.16, tz * 1.08], 0.035, 0.015, 4, i % 3 ? 0x9a7ad8 : 0x8060c0));
    }
    for (let i = 0; i < 4; i++) p.push(leaf(0.22, 0.06, 0x8aa86a, { r: [-0.9, i * 1.6, 0] }));
    return jitter(merge(p), 0.04, 101);
  });
}

function daisyClump(key: string, petal: number, core: number, n: number): THREE.BufferGeometry {
  return cached(key, () => {
    const r = rng(key);
    const p: THREE.BufferGeometry[] = [];
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2, d = 0.05 + r() * 0.2, h = 0.35 + r() * 0.3;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      p.push(rod([x * 0.3, 0, z * 0.3], [x, h, z], 0.012, 0.01, 3, PAL.grassDark));
      p.push(cyl(0.085, 0.07, 0.03, 7, petal, { p: [x, h, z], r: [r() * 0.5 - 0.25, 0, r() * 0.5 - 0.25] }));
      p.push(cyl(0.03, 0.03, 0.04, 5, core, { p: [x, h + 0.02, z] }));
    }
    for (let i = 0; i < 5; i++) p.push(leaf(0.2, 0.08, PAL.grass, { r: [-0.8, i * 1.3, 0] }));
    return jitter(merge(p), 0.04, 103);
  });
}
export const daisies = () => daisyClump('daisies', 0xfbf6ea, PAL.yellow, 7);
export const cosmos = () => daisyClump('cosmos', 0xf08ab8, 0xf2c33a, 6);

/** Grass tone per season, matched to the terrain's grass (autumn only a hint of straw, not yellow). */
export const grassTone = (season: Season): number =>
  season === 'autumn' ? col(PAL.grass, 0xc9a24e, 0.22) : season === 'winter' ? col(0xa9b08a, 0xe9eff4, 0.45)
    : season === 'spring' ? col(PAL.grass, 0x92d86a, 0.3) : PAL.grass;

/**
 * Meadow: a soft grass clump (a dome of narrow blades: upright in the middle, shorter and leaning out at the rim,
 * dark / mid / sunlit tones) and a wildflower (white head, tinted per instance).
 */
export function grassTuft(season: Season): THREE.BufferGeometry {
  return cached(`tuft:${season}`, () => {
    const r = rng('tuft');
    const p: THREE.BufferGeometry[] = [];
    const base = grassTone(season);
    const dark = col(PAL.grassDark, base, 0.35), sun = col(base, season === 'winter' ? 0xf2f4f0 : 0xd8e070, 0.3);
    for (let i = 0; i < 11; i++) {
      const rim = i / 11;                                     // later blades sit further out, shorter, leaning more
      const c = i % 3 === 0 ? dark : i % 3 === 1 ? base : sun;
      p.push(leaf((0.34 - rim * 0.14) * (0.8 + r() * 0.4), 0.055 + r() * 0.02, c, { r: [-1.35 + rim * 0.55 + r() * 0.15, i * 2.4 + r() * 0.5, 0] }, 0.35));
    }
    return merge(p);
  });
}
export function wildflower(): THREE.BufferGeometry {
  return cached('wildflower', () => merge([
    rod([0, 0, 0], [0.04, 0.5, 0], 0.012, 0.01, 3, PAL.grassDark),
    cyl(0.07, 0.05, 0.03, 6, 0xffffff, { p: [0.04, 0.51, 0] }),
    ball(0.028, PAL.yellow, { p: [0.04, 0.53, 0] }),
    leaf(0.14, 0.06, PAL.grass, { p: [0.01, 0.15, 0], r: [-0.6, 1, 0] }),
  ]));
}

/** Field-edge / pasture clump: grass blades with a couple of baked buttercups and daisies. */
export function decorClump(season: Season): THREE.BufferGeometry {
  return cached(`decor:${season}`, () => {
    const r = rng('decor');
    const p: THREE.BufferGeometry[] = [];
    const base = grassTone(season);
    const dark = col(PAL.grassDark, base, 0.35), sun = col(base, PAL.meadow, 0.6);
    for (let i = 0; i < 9; i++) {
      const rim = i / 9;
      const c = i % 3 === 0 ? dark : i % 3 === 1 ? base : sun;
      p.push(leaf((0.3 - rim * 0.12) * (0.8 + r() * 0.4), 0.06 + r() * 0.02, c, { r: [-1.35 + rim * 0.55 + r() * 0.15, i * 2.4 + r() * 0.5, 0] }, 0.35));
    }
    if (season !== 'winter') {
      const heads: [number, number][] = [[PAL.yellow, 0xf2a830], [0xfbf6ea, PAL.yellow], [0xf4b0c8, PAL.yellow]];
      for (let i = 0; i < 2; i++) {
        const a = r() * 6.28, d = 0.08 + r() * 0.12, h = 0.28 + r() * 0.16, [pc, cc] = heads[i % 3];
        p.push(rod([Math.cos(a) * d * 0.4, 0, Math.sin(a) * d * 0.4], [Math.cos(a) * d, h, Math.sin(a) * d], 0.01, 0.008, 3, PAL.grassDark));
        p.push(cyl(0.05, 0.04, 0.025, 6, pc, { p: [Math.cos(a) * d, h, Math.sin(a) * d] }), ball(0.022, cc, { p: [Math.cos(a) * d, h + 0.018, Math.sin(a) * d] }));
      }
    }
    return merge(p);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Parts and layouts

export type Growth = 'grow' | 'fruit' | 'head' | 'decor';
export interface PartDef {
  key: string;
  geo(season: Season): THREE.BufferGeometry;
  /** sway per m² of height */
  bend: number;
  droop: number;
  shadow: boolean;
  growth: Growth;
  /** scale at growth 0 (grow parts) */
  min?: number;
  /** unripe tint follows growth */
  ripens?: boolean;
  /** hide in winter (fruit) */
  noWinter?: boolean;
  /** 0..1 how much the crop parts round a farmer / the player standing in it (tall crops only) */
  part?: number;
  /** stays in the ground at harvest (trees, vines, bushes): only its fruit goes to the cart; fallow leaves it bare and dry */
  perennial?: boolean;
  /** what an annual leaves standing in fallow soil: [height, width] scale of the plant as stubble (0 = cleared) */
  stubble?: [number, number];
}

export interface Slot {
  part: number;
  x: number; y: number; z: number;
  yaw: number;
  s: number;
  /** fruit: growth (0..1 of the ripening range) at which it appears */
  th: number;
  /** index of the parent slot (fruit rides its plant) or -1 */
  parent: number;
  ox: number; oy: number; oz: number;
  color: number | null;
  /** 0..1 order of the tilling sprout wave (left → right) and the harvest (back → gate) */
  sow: number;
  reap: number;
  /** tilt (fallen fruit, leaning plants) */
  tilt: number;
}

export interface Clear { x: number; z: number; r: number }
export interface CropLayout { parts: PartDef[]; slots: Slot[] }

const P = (key: string, geo: (s: Season) => THREE.BufferGeometry, o: Partial<PartDef> = {}): PartDef =>
  ({ key, geo, bend: 0.06, droop: 0.4, shadow: true, growth: 'grow', ...o });

const PARTS: Partial<Record<PlotKind, PartDef[]>> = {
  wheat: [P('wheat', wheatClump, { bend: 0.16, droop: 0.35, ripens: true, min: 0.5, part: 1, stubble: [0.16, 0.9] })],
  pumpkins: [P('vine', pumpkinVine, { bend: 0.05, droop: 0.2, min: 0.72, shadow: false, stubble: [0.35, 0.7] }), P('pumpkin', () => pumpkin(), { bend: 0, droop: 0, growth: 'fruit', ripens: true })],
  cabbages: [P('cabbage', () => cabbage(), { bend: 0.04, droop: 0.4, min: 0.68, shadow: false, stubble: [0.3, 0.55] })],
  sunflowers: [P('sunplant', sunflowerPlant, { bend: 0.008, droop: 0.012, min: 0.45, stubble: [0.22, 1] }), P('sunhead', sunflowerHead, { bend: 0, droop: 0, growth: 'head', ripens: true })],
  orchard: [P('tree', fruitTree, { bend: 0.004, droop: 0.01, min: 0.45, perennial: true }), P('apple', () => apple(), { bend: 0.004, droop: 0, growth: 'fruit', ripens: true, noWinter: true })],
  vineyard: [P('vineblob', vineBlob, { bend: 0.035, droop: 0.1, min: 0.7, perennial: true }), P('grapes', () => grapes(), { bend: 0.03, droop: 0, growth: 'fruit', ripens: true, noWinter: true })],
  berries: [P('bush', berryBush, { bend: 0.05, droop: 0.15, min: 0.62, perennial: true }), P('berries', () => berries(), { bend: 0.05, droop: 0.15, growth: 'fruit', ripens: true, noWinter: true })],
  bees: [P('lavender', () => lavender(), { bend: 0.3, droop: 0.4, min: 0.6, shadow: false }), P('daisies', () => daisies(), { bend: 0.3, droop: 0.4, min: 0.6, shadow: false }), P('cosmos', () => cosmos(), { bend: 0.3, droop: 0.4, min: 0.6, shadow: false })],
};
const DECOR = P('decor', decorClump, { bend: 0.25, droop: 0.3, shadow: false, growth: 'decor' });

/**
 * `lanes`: work lanes (site-local x of each work-spot column, z where the lane starts): tall crops leave a tramline
 * from there to the headland so a farmer at work, and on the way there, is never buried in the crop.
 */
export function cropLayout(kind: PlotKind, hw: number, hd: number, clears: Clear[], seed: string, lanes: { x: number; z: number }[] = []): CropLayout {
  const parts = [...(PARTS[kind] ?? []), DECOR];
  const decor = parts.length - 1;
  const slots: Slot[] = [];
  const r = rng(`${seed}:${kind}`);
  const ridge = kind === 'orchard' ? 0.03 : 0.17;
  const x0 = -hw + 0.9, x1 = hw - 2.0, z0 = -hd + 0.9, z1 = hd - 2.6;
  const free = (x: number, z: number, rad: number) => {
    for (const c of clears) if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + rad) ** 2) return false;
    return x > x0 - 0.3 && x < x1 + 0.3 && z > z0 - 0.3 && z < z1 + 0.3;
  };
  const add = (part: number, x: number, z: number, o: Partial<Slot> = {}) => {
    const s: Slot = {
      part, x, y: ridge, z, yaw: r() * Math.PI * 2, s: 0.85 + r() * 0.3, th: 0, parent: -1, ox: 0, oy: 0, oz: 0, color: null,
      sow: (x - x0) / (x1 - x0) * 0.75 + r() * 0.25, reap: 1 - (z - z0) / (z1 - z0) * 0.8 - r() * 0.2, tilt: 0, ...o,
    };
    slots.push(s);
    return slots.length - 1;
  };
  const child = (parent: number, part: number, ox: number, oy: number, oz: number, o: Partial<Slot> = {}) => {
    const p = slots[parent];
    return add(part, p.x, p.z, { parent, ox, oy, oz, sow: p.sow + 0.05, reap: p.reap, yaw: 0, s: 1, ...o });
  };
  const rows = (dx: number, offset: number) => { const xs: number[] = []; for (let x = x0 + offset; x <= x1 + 1e-3; x += dx) xs.push(x); return xs; };
  const along = (x: number, step: number, jit: number, f: (z: number) => void) => { for (let z = z0; z <= z1 + 1e-3; z += step) f(z + (r() - 0.5) * jit); };

  switch (kind) {
    case 'wheat': {
      const lane = (x: number, z: number) => lanes.some((l) => Math.abs(x - l.x) < 0.5 && z > l.z - 0.6);
      for (const x of rows(1.2, 0.3)) along(x, 0.3, 0.12, (z) => { const px = x + (r() - 0.5) * 0.25; if (free(px, z, 0.25) && !lane(px, z)) add(0, px, z); });
      // a second, offset pass so the field reads as a dense golden carpet between the furrows
      for (const x of rows(1.2, 0.3)) along(x, 0.45, 0.2, (z) => { const px = x + (r() < 0.5 ? -0.28 : 0.28); if (free(px, z, 0.25) && !lane(px, z)) add(0, px, z, { s: 0.75 + r() * 0.25 }); });
      break;
    }
    case 'pumpkins':
      rows(1.2, 0.3).forEach((x, i) => {
        along(x, 1.0, 0.25, (z) => { if (free(x, z, 0.4) && z > z0 + 0.3) add(0, x + (r() - 0.5) * 0.2, z, { yaw: (r() - 0.5) * 0.6 + (r() < 0.5 ? Math.PI : 0) }); });
        if (i % 2) return;
        along(x, 1.25, 0.4, (z) => {
          const px = x + (r() - 0.5) * 0.5;
          if (free(px, z, 0.45)) add(1, px, z, { th: r() * 0.55, s: 0.75 + r() * 0.55, color: r() < 0.1 ? 0xfff0c0 : r() < 0.3 ? 0xffc080 : null });
        });
      });
      break;
    case 'cabbages': {
      const xs = rows(1.2, 0.3);
      xs.forEach((x, i) => along(x, 0.52, 0.06, (z) => {
        if (!free(x, z, 0.3)) return;
        const tint = [0x9ee07a, 0xa6e38a, 0xb488d8, 0x86cfa0][i % 4];
        add(0, x + (r() - 0.5) * 0.1, z, { color: tint, s: 1.0 + r() * 0.3 });
      }));
      break;
    }
    case 'sunflowers':
      for (const x of rows(1.2, 0.3)) along(x, 0.85, 0.2, (z) => {
        const px = x + (r() - 0.5) * 0.2;
        if (!free(px, z, 0.35)) return;
        const pi = add(0, px, z, { s: 0.8 + r() * 0.35 });
        child(pi, 1, 0, SUN_STEM, 0, { th: 0, s: 1 });
      });
      break;
    case 'orchard': {
      for (const tz of [-hd + 2.2, -0.4, hd - 3.3]) for (const tx of [-hw + 2.7, -3.3, 0.3, 3.8, hw - 2.6]) {
        const x = tx + (r() - 0.5) * 0.5, z = tz + (r() - 0.5) * 0.5;
        if (!free(x, z, 0.5)) continue;
        const ti = add(0, x, z, { s: 1.15 + r() * 0.25, yaw: r() * Math.PI * 2 });
        for (let k = 0; k < 14; k++) {
          const b = TREE_BLOBS[k % TREE_BLOBS.length];
          const d = new THREE.Vector3(r() - 0.5, r() * 0.9 - 0.35, r() - 0.5).normalize();
          child(ti, 1, b.x + d.x * b.r * 1.02, b.y + d.y * b.r * 0.92, b.z + d.z * b.r * 1.02, { th: r() * 0.75, color: [0xff5a4a, 0xff4838, 0xffa040, 0xc8e060][k % 4] });
        }
        for (let k = 0; k < 3; k++) {
          const a = r() * Math.PI * 2, d = 0.5 + r() * 0.8;
          child(ti, 1, Math.cos(a) * d, 0.08, Math.sin(a) * d, { th: 0.7 + r() * 0.3, color: 0xff5a4a, tilt: 1.2 });
        }
      }
      break;
    }
    case 'vineyard':
      for (const x of [-6.9, -3.6, 0, 3.6, 6.3]) {
        for (let z = z0 + 0.3; z <= hd - 3.1; z += 1.05) {
          if (!free(x, z, 0.3)) continue;
          const vi = add(0, x, z, { yaw: r() < 0.5 ? 0 : Math.PI, s: 0.9 + r() * 0.2 });
          for (let k = 0; k < 3; k++) child(vi, 1, (k - 1) * 0.22 + (r() - 0.5) * 0.1, 0.95 + r() * 0.12, (r() - 0.5) * 0.9, { th: r() * 0.7, s: 0.85 + r() * 0.4, color: x < 0 ? 0x9a58c0 : x > 3 ? 0xc8e878 : 0x7040a8 });
        }
      }
      break;
    case 'berries': {
      const xs = rows(1.2, 0.3);
      xs.forEach((x, i) => along(x, 1.05, 0.15, (z) => {
        z += i % 2 ? 0.5 : 0;
        const px = x + (r() - 0.5) * 0.2;
        if (!free(px, z, 0.45)) return;
        const bi = add(0, px, z, { s: 1.1 + r() * 0.35 });
        child(bi, 1, 0, 0, 0, { th: r() * 0.5, color: [0x5a78f0, 0xff4a5a, 0x8a4ad0][i % 3], s: 1 });
      }));
      break;
    }
    case 'bees': {
      const xs = rows(1.2, 0.3);
      xs.forEach((x, i) => along(x, 0.55, 0.15, (z) => {
        const px = x + (r() - 0.5) * 0.2;
        if (free(px, z, 0.3)) add(i % 3, px, z, { s: 0.85 + r() * 0.35 });
      }));
      break;
    }
    default: break;
  }
  // grass and flowers along the inside of the fence (and over the pasture / orchard floor)
  const edge = (x: number, z: number) => {
    for (const c of clears) if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + 0.2) ** 2) return;
    if (Math.abs(x) < 1.9 && z > hd - 1.5) return;
    add(decor, x, z, { y: 0, s: 0.7 + r() * 0.7, sow: r(), reap: r() });
  };
  for (let x = -hw + 0.4; x <= hw - 0.4; x += 0.55) { edge(x + (r() - 0.5) * 0.3, -hd + 0.35 + r() * 0.3); edge(x + (r() - 0.5) * 0.3, hd - 0.35 - r() * 0.3); }
  for (let z = -hd + 0.9; z <= hd - 0.9; z += 0.55) { edge(-hw + 0.35 + r() * 0.3, z + (r() - 0.5) * 0.3); edge(hw - 0.35 - r() * 0.3, z + (r() - 0.5) * 0.3); }
  const pasture = ['chickens', 'cows', 'sheep', 'pigs', 'orchard'].includes(kind);
  if (pasture) {
    const n = kind === 'pigs' ? 60 : kind === 'chickens' ? 90 : 150;
    for (let i = 0; i < n; i++) {
      const x = (r() * 2 - 1) * (hw - 0.8), z = (r() * 2 - 1) * (hd - 0.8);
      if (clears.some((c) => (x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + 0.15) ** 2)) continue;
      add(decor, x, z, { y: 0, s: 0.6 + r() * 0.6, sow: r(), reap: r() });
    }
  }
  // children inherit their parent's yaw / scale at pose time; resolve positions relative to parents there
  return { parts, slots };
}
