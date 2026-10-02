/**
 * Models for the hillside orchard & apiary (scene/orchard): the instanced fruit tree (a bark trunk + a seasonal crown
 * tinted per tree), the fruit, a bee, a drifting petal / leaf, and the static dressing (dry-stone wall, five-bar gate,
 * the honey house with its cider press, four hives, the wildflower bed, crates, a picking ladder, the gate sign) built
 * with the structures Kit in the orchard's local frame (world/orchard.ts).
 *
 * Crowns are painted grey-to-white (foliageBlob) and take their hue from the instance colour (`crownTint`), so one
 * geometry per season draws every species; fruit bodies are white and tinted the same way (stems and leaves keep their
 * own colour: `whiteTint`).
 */
import * as THREE from 'three';
import type { Season } from '../../model/types.ts';
import type { FruitKind } from '../../model/orchard.ts';
import { ORCHARD_SITE, orchardToWorld } from '../../world/orchard.ts';
import { PAL, paint } from '../toon.ts';
import { Kit } from '../structures/kit.ts';
import { foliageBlob } from '../surface/foliage.ts';
import { chainShader, tagSurface } from '../surface/index.ts';
import { merge } from '../flora/geom.ts';
import { partName } from '../parts.ts';

const O = ORCHARD_SITE;

// ---------------------------------------------------------------------------------------------
// small geometry helpers

type V3 = readonly [number, number, number];
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

function rod(a: V3, b: V3, r0: number, r1: number, seg: number, color: number): THREE.BufferGeometry {
  _a.set(...a); _b.set(...b);
  const len = _d.subVectors(_b, _a).length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1).toNonIndexed();
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  _q.setFromUnitVectors(UP, _d.normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(_a.clone().add(_b).multiplyScalar(0.5), _q, new THREE.Vector3(1, 1, 1)));
  return paint(g, color);
}
function ball(r: number, color: number, p: V3, s: V3 = [1, 1, 1], detail = 0): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, detail);   // polyhedra are already non-indexed (toNonIndexed() only warns)
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g.scale(...s).translate(...p);
  return paint(g, color);
}
/** a deterministic 0..1 noise from a few numbers */
const hash = (a: number, b = 0, c = 0) => { const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return s - Math.floor(s); };

// ---------------------------------------------------------------------------------------------
// The fruit tree (instanced: origin at the foot of the trunk, crown centre about CROWN_Y up)

export const CROWN_Y = 2.15;
/** where the boughs leave the trunk: the crown shakes about this point */
export const CROTCH_Y = 1.2;
const BOUGHS: readonly V3[] = [[0.72, 2.0, 0.28], [-0.66, 2.08, -0.22], [0.12, 2.14, -0.74], [-0.22, 2.02, 0.7], [0.08, 2.62, 0.06]];
const BLOBS: readonly { x: number; y: number; z: number; r: number }[] = [
  { x: 0, y: 2.25, z: 0, r: 0.92 }, { x: 0.62, y: 1.98, z: 0.26, r: 0.68 }, { x: -0.6, y: 2.02, z: -0.22, r: 0.7 },
  { x: 0.12, y: 1.96, z: -0.66, r: 0.64 }, { x: -0.16, y: 2.0, z: 0.64, r: 0.64 }, { x: 0.12, y: 2.78, z: 0.04, r: 0.58 },
];

let trunkGeo: THREE.BufferGeometry | null = null;
/** trunk, boughs and the fine twigs that show once the leaves are down (bark-tagged; tinted per tree) */
export function trunkGeometry(): THREE.BufferGeometry {
  if (trunkGeo) return trunkGeo;
  const p: THREE.BufferGeometry[] = [];
  const bark = (g: THREE.BufferGeometry, scale = 0.6) => tagSurface(g, 'bark', { scale });
  p.push(bark(rod([0, -0.05, 0], [0.05, 1.32, 0.02], 0.17, 0.11, 7, PAL.trunk), 0.8));
  for (const b of BOUGHS) p.push(bark(rod([0.04, 1.15, 0.01], b, 0.085, 0.04, 5, PAL.bark), 0.5));
  // twigs off each bough (they read against the sky in winter; inside the crown the rest of the year)
  BOUGHS.forEach((b, i) => {
    for (let k = 0; k < 2; k++) {
      const a = i * 1.7 + k * 2.4, len = 0.38 + k * 0.12;
      p.push(bark(rod(b, [b[0] * 1.35 + Math.cos(a) * len * 0.5, b[1] + 0.28 + k * 0.12, b[2] * 1.35 + Math.sin(a) * len * 0.5], 0.032, 0.012, 3, PAL.bark), 0.4));
    }
  });
  // a flared foot
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.4; p.push(bark(rod([0, 0.24, 0], [Math.cos(a) * 0.34, -0.04, Math.sin(a) * 0.34], 0.08, 0.035, 4, PAL.trunk), 0.5)); }
  trunkGeo = partName(merge(p), 'trunk');
  return trunkGeo;
}

const crownCache = new Map<Season, THREE.BufferGeometry>();
/**
 * The crown for a season, painted grey → white so the instance colour gives it its hue: spring blossom clouds over a
 * little green, summer full and leafy, autumn thinner, winter only snow lying along the boughs.
 */
export function crownGeometry(season: Season): THREE.BufferGeometry {
  const hit = crownCache.get(season);
  if (hit) return hit;
  const p: THREE.BufferGeometry[] = [];
  const cc = new THREE.Vector3(0, CROWN_Y, 0);
  const blob = (b: { x: number; y: number; z: number; r: number }, i: number, dark: number, light: number, k = 1, accent?: number) => {
    const r = b.r * k;
    const g = new THREE.IcosahedronGeometry(r, 1);
    const q = g.attributes.position;
    for (let v = 0; v < q.count; v++) {
      const x = q.getX(v), y = q.getY(v), z = q.getZ(v), w = 1 + (hash(x, y + i, z) - 0.5) * 0.14;
      q.setXYZ(v, x * w, y * w * 0.9, z * w);
    }
    g.rotateY(i * 1.9).translate(b.x * (0.9 + k * 0.1), b.y, b.z * (0.9 + k * 0.1));
    g.deleteAttribute('uv');
    p.push(foliageBlob(g, new THREE.Vector3(b.x, b.y, b.z), [cc, cc], {
      dark: new THREE.Color(dark), light: new THREE.Color(light), ...(accent !== undefined ? { accent: new THREE.Color(accent), p: 0.2 } : {}),
    }, 1.4, 3.3, 40 + i, { squash: 0.9, crown: 0.22, blossom: accent !== undefined }, { scale: Math.max(0.6, r / 1.15), strength: 0.9, aux: r }));
  };
  if (season === 'winter') {
    // snow lying on the boughs and in the crotch
    for (const b of BOUGHS) p.push(tagSurface(ball(0.1, PAL.snow, [b[0] * 0.85, b[1] + 0.02, b[2] * 0.85], [1.5, 0.45, 1.5]), 'snow'));
    p.push(tagSurface(ball(0.14, PAL.snow, [0.04, 1.3, 0.02], [1.3, 0.5, 1.3]), 'snow'));
    BOUGHS.forEach((b, i) => p.push(tagSurface(ball(0.06, PAL.snow, [b[0] * 1.3 + Math.cos(i * 1.7) * 0.15, b[1] + 0.32, b[2] * 1.3 + Math.sin(i * 1.7) * 0.15], [1.4, 0.5, 1.4]), 'snow')));
  } else if (season === 'spring') {
    // a little fresh green inside, clouds of blossom outside, petals flecked over the top
    BLOBS.forEach((b, i) => { if (i % 2 === 0) blob({ ...b, r: b.r * 0.62 }, i + 10, 0x4f8a3e, 0x9ad468); });
    BLOBS.forEach((b, i) => blob(b, i, 0xf8c0c8, 0xffffff, 0.96, 0xfff4f8));
    for (let i = 0; i < 46; i++) {
      const b = BLOBS[i % BLOBS.length];
      _d.set(hash(i, 1) - 0.5, hash(i, 2) * 0.8 - 0.1, hash(i, 3) - 0.5).normalize();
      const g = new THREE.OctahedronGeometry(0.06, 0);
      g.deleteAttribute('uv'); g.deleteAttribute('normal');
      g.translate(b.x + _d.x * b.r * 1.02, b.y + _d.y * b.r * 0.93, b.z + _d.z * b.r * 1.02);
      p.push(tagSurface(paint(g, i % 3 ? 0xfff6fa : 0xffffff), 'leaves', { strength: 0 }));
    }
  } else if (season === 'summer') {
    BLOBS.forEach((b, i) => blob(b, i, 0x5e7a52, 0xffffff));
  } else {
    // autumn: thinner crowns (the leaves are coming down), warm greys the tint turns gold / rust / crimson
    BLOBS.forEach((b, i) => { if (i !== 4) blob(b, i, 0x8a6e60, 0xfff4e4, 0.82, 0xffffff); });
  }
  const g = partName(merge(p), 'crown');
  crownCache.set(season, g);
  return g;
}

/** a tree's crown colour (instance tint) by kind and season */
export function crownTint(kind: FruitKind, season: Season, out: THREE.Color): THREE.Color {
  const T: Record<Season, Record<FruitKind, number>> = {
    spring: { apple: 0xffd8e4, pear: 0xfff4ec, plum: 0xffeef4, cherry: 0xffa4c4 },
    summer: { apple: 0x86c458, pear: 0x7cbd60, plum: 0x8ab84e, cherry: 0x92c44e },
    autumn: { apple: 0xf0a23a, pear: 0xe8b83a, plum: 0xc8603a, cherry: 0xd8402e },
    winter: { apple: 0xffffff, pear: 0xffffff, plum: 0xffffff, cherry: 0xffffff },
  };
  return out.setHex(T[season][kind]);
}
/** bark tint: cherries have a glossy red-brown bark, pears a grey one */
export function barkTint(kind: FruitKind, out: THREE.Color): THREE.Color {
  return out.setHex(kind === 'cherry' ? 0xc8a098 : kind === 'pear' ? 0xc8c0b4 : kind === 'plum' ? 0xb8a8a8 : 0xffffff);
}

/** fruit colour and shape (scale) by kind; `green` = still small and unripe */
export function fruitLook(kind: FruitKind, green: boolean, out: THREE.Color): { s: number; sy: number } {
  if (green) { out.setHex(0x9cc850); return { s: 0.62, sy: kind === 'pear' ? 1.2 : 0.95 }; }
  switch (kind) {
    case 'apple': out.setHex(0xe0402e); return { s: 1, sy: 0.92 };
    case 'pear': out.setHex(0xd8cc58); return { s: 0.95, sy: 1.32 };
    case 'plum': out.setHex(0x7a3a9a); return { s: 0.9, sy: 1.08 };
    case 'cherry': out.setHex(0xd01a36); return { s: 0.7, sy: 1 };
  }
}

/**
 * Fruit hanging spots on a crown (tree-local, before the tree's scale): spread over the lower, outer half of the
 * crown where you'd reach them, deterministic per tree. `n` spots.
 */
export function fruitSpots(tree: number, n: number): V3[] {
  const out: V3[] = [];
  for (let k = 0; k < n; k++) {
    const b = BLOBS[(k + tree) % 5 + (k % 5 === 4 ? 0 : 0)];
    const a = hash(tree, k, 1) * Math.PI * 2, down = 0.15 + hash(tree, k, 2) * 0.55;
    const r = b.r * (0.9 + hash(tree, k, 3) * 0.12);
    out.push([b.x + Math.cos(a) * r * Math.sqrt(1 - down * down), b.y - r * down * 0.85, b.z + Math.sin(a) * r * Math.sqrt(1 - down * down)]);
  }
  return out;
}

let fruitGeo: THREE.BufferGeometry | null = null;
/** one fruit (white body tinted per instance; brown stalk, green leaf), centred on the body */
export function fruitGeometry(): THREE.BufferGeometry {
  if (fruitGeo) return fruitGeo;
  const body = ball(0.085, 0xffffff, [0, 0, 0], [1, 1, 1], 1);
  // a dimple at the top: pull the top vertices down a touch
  const q = body.attributes.position;
  for (let v = 0; v < q.count; v++) { const y = q.getY(v); if (y > 0.07) q.setY(v, y - 0.018); }
  const stalk = rod([0, 0.05, 0], [0.012, 0.13, 0.004], 0.009, 0.007, 3, 0x6a4424);
  const leafG = ball(0.04, 0x5aa040, [0.04, 0.115, 0], [1.1, 0.25, 0.55]);
  fruitGeo = merge([body, stalk, leafG]);
  return fruitGeo;
}

/** the instance colour paints only white vertices (fruit bodies), leaving stalks and leaves their own colour */
export function whiteTint<M extends THREE.Material>(m: M): M {
  return chainShader(m, (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>', `#include <color_vertex>
#if defined( USE_INSTANCING_COLOR ) && defined( USE_COLOR )
  vColor.rgb = color * mix(vec3(1.0), instanceColor.rgb, step(2.9, color.r + color.g + color.b));
#endif`);
  }, 'orchard-white-tint');
}

let beeGeo: THREE.BufferGeometry | null = null;
/** a plump little bee, a touch bigger than life so it reads from eye height; faces +z */
export function beeGeometry(): THREE.BufferGeometry {
  if (beeGeo) return beeGeo;
  const p: THREE.BufferGeometry[] = [];
  p.push(ball(0.032, 0xf2b82a, [0, 0, -0.012], [1, 0.95, 1.45], 1));
  for (const z of [-0.022, 0.0, -0.044]) p.push(rod([0, 0, z - 0.006], [0, 0, z + 0.006], 0.0335 - Math.abs(z + 0.02) * 0.25, 0.0335 - Math.abs(z + 0.02) * 0.25, 7, 0x2a2226));
  p.push(ball(0.021, 0x2a2226, [0, 0.004, 0.04]));
  for (const s of [-1, 1]) p.push(ball(0.03, 0xe8f4ff, [s * 0.03, 0.03, -0.004], [1.0, 0.18, 0.62]));
  beeGeo = merge(p);
  return beeGeo;
}

let petalGeo: THREE.BufferGeometry | null = null;
/** a petal / leaf card (white: tinted per instance), double-sided */
export function petalGeometry(): THREE.BufferGeometry {
  if (petalGeo) return petalGeo;
  const g = new THREE.BufferGeometry();
  const s = 0.05;
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -s * 1.3, s, 0, 0, 0, 0.012, s * 1.3, 0, 0, -s * 1.3, 0, 0.012, s * 1.3, -s, 0, 0], 3));
  g.computeVertexNormals();
  petalGeo = g;
  return g;
}

// ---------------------------------------------------------------------------------------------
// The static dressing (orchard-local: x along the contour, z downhill; y = world height)

export type HeightFn = (lx: number, lz: number) => number;
export const heightIn = (heightAt: (x: number, z: number) => number): HeightFn => (lx, lz) => { const w = orchardToWorld(lx, lz); return heightAt(w.x, w.z); };

const STONES = [0xa29a8c, 0xb8b0a0, 0x8f887c, 0x9a8f7c, 0xc9bfae, 0xa89f8e];

/** the dry-stone wall: two courses of rough stones in running bond and a row of upright coping stones, following the ground */
function wall(k: Kit, h: HeightFn): void {
  const sides: [string, number, number, number, number][] = [
    ['wallBack', -O.hw, O.back, O.hw, O.back], ['wallRight', O.hw, O.back, O.hw, O.front],
    ['wallFront', O.hw, O.front, -O.hw, O.front], ['wallLeft', -O.hw, O.front, -O.hw, O.back],
  ];
  const step = 0.5;
  sides.forEach(([name, ax, az, bx, bz], si) => {
    const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len, ry = Math.atan2(ux, uz) + Math.PI / 2;
    const n = Math.round(len / step);
    k.part(name, () => k.surf(['fieldstone', { scale: 0.7 }], () => {
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) * (len / n), x = ax + ux * t, z = az + uz * t;
        // the gate's opening in the front wall
        if (name === 'wallFront' && Math.abs(x - O.gate.x) < O.gate.w / 2 + 0.42) continue;
        const y0 = Math.min(h(x - uz * 0.24, z + ux * 0.24), h(x + uz * 0.24, z - ux * 0.24), h(x, z)) - 0.06;
        const r = (j: number) => hash(si * 1000 + i, j);
        const c = (j: number) => STONES[Math.floor(r(j) * STONES.length)];
        k.box(0.56, 0.36, step * 1.04, c(1), { x, y: y0 + 0.17, z, ry: ry + (r(2) - 0.5) * 0.12 });
        // second course, half a stone along (running bond)
        const t2 = t + step / 2;
        if (t2 < len - 0.1 && !(name === 'wallFront' && Math.abs(ax + ux * t2 - O.gate.x) < O.gate.w / 2 + 0.5)) {
          const x2 = ax + ux * t2, z2 = az + uz * t2;
          const y2 = Math.min(y0, Math.min(h(x2, z2), h(x2 - uz * 0.2, z2 + ux * 0.2), h(x2 + uz * 0.2, z2 - ux * 0.2)) - 0.06);
          k.box(0.48, 0.3, step * 0.98, c(3), { x: x2, y: Math.max(y0, y2) + 0.48, z: z2, ry: ry + (r(4) - 0.5) * 0.1 });
          // coping: stones on edge, leaning a little
          for (const o of [-0.13, 0.12]) k.box(0.42, 0.22 + r(5 + o) * 0.06, 0.11, c(6), { x: x2 + ux * o, y: Math.max(y0, y2) + 0.74, z: z2 + uz * o, ry: ry + Math.PI / 2 * 0, rz: 0, rx: (r(7 + o) - 0.5) * 0.25 });
        }
      }
    }));
  });
}

/** the gate: two stone pillars and a five-bar gate swung open into the orchard */
function gate(k: Kit, h: HeightFn): void {
  const gx = O.gate.x, gz = O.front, hw = O.gate.w / 2;
  for (const s of [-1, 1]) {
    const x = gx + s * (hw + 0.2), y = Math.min(h(x, gz - 0.25), h(x, gz + 0.25)) - 0.08;
    k.part('gatePost', () => k.surf(['fieldstone', { scale: 0.6 }], () => {
      k.box(0.6, 1.28, 0.6, 0xa89f8e, { x, y: y + 0.64, z: gz });
      k.box(0.7, 0.14, 0.7, 0xc9bfae, { x, y: y + 1.34, z: gz });
    }));
  }
  // the gate, hinged on the left pillar, swung ~100° into the orchard (along the inside of the wall, off the alley)
  const hx = gx - hw + 0.05, hy = h(hx, gz) + 0.12, open = 1.78;
  k.part('gate', () => k.at({ x: hx, y: hy, z: gz - 0.05, ry: open }, () => k.surf(['planks', { axis: 'long', scale: 0.5 }], () => {
    const L = O.gate.w - 0.2;
    k.box(0.09, 1.05, 0.09, PAL.wood, { x: 0.05, y: 0.55 });
    k.box(0.09, 1.0, 0.09, PAL.wood, { x: L - 0.05, y: 0.52 });
    for (let i = 0; i < 5; i++) k.box(L, 0.07, 0.05, PAL.woodLight, { x: L / 2, y: 0.16 + i * 0.2 });
    k.beam(0.08, 0.12, 0, L - 0.08, 0.95, 0, 0.06, PAL.woodLight);
  })));
}

/** the honey house: an open-fronted shed on a stone plinth, the cider press inside, barrels, a shelf of jars, a lantern */
function shed(k: Kit, h: HeightFn, season: Season): void {
  const S = O.shed, y = h(S.x, S.z), W = S.w, D = S.d;
  k.at({ x: S.x, y, z: S.z, ry: S.ry }, () => {
    k.part('shed', () => {
      k.surf(['fieldstone', { scale: 0.7 }], () => k.box(W + 0.2, 0.42, D + 0.2, 0xa29a8c, { y: -0.12 }));
      k.surf(['planks', { axis: 'x', variant: 1 }], () => k.box(W, 0.06, D, PAL.plank, { y: 0.12 }));
      k.surf(['planks', { axis: 'y', variant: 1, scale: 0.8 }], () => {
        k.box(W, 2.1, 0.1, 0xb07a4a, { y: 1.2, z: -D / 2 + 0.05 });
        for (const s of [-1, 1]) {
          k.box(0.1, 2.1, D, 0xb07a4a, { x: s * (W / 2 - 0.05), y: 1.2 });
          k.prism([[-D / 2, 0], [D / 2, 0], [0, 0.85]], 0.1, 0xb07a4a, { x: s * (W / 2 - 0.05), y: 2.25, ry: Math.PI / 2 });
        }
      });
      // corner posts and the lintel over the open front
      for (const s of [-1, 1]) k.box(0.16, 2.2, 0.16, PAL.woodDark, { x: s * (W / 2 - 0.08), y: 1.2, z: D / 2 - 0.08 });
      k.box(W, 0.16, 0.16, PAL.woodDark, { y: 2.22, z: D / 2 - 0.08 });
      // the gable roof, ridge along x
      for (const s of [-1, 1]) k.slab(W + 0.5, 0.08, D / 2 + 0.55, PAL.roofRed, ['shingle', { scale: 0.7, variant: 1 }], { y: 2.66, z: s * (D / 4 + 0.13), rx: s * 0.47 + (s > 0 ? 0 : Math.PI) * 0, ry: s > 0 ? 0 : Math.PI });
      k.box(W + 0.55, 0.1, 0.12, PAL.woodDark, { y: 3.12 });
      // a board over the door: HONEY · CIDER in painted blobs (no text at this size)
      k.box(1.4, 0.3, 0.05, 0xf1e3c4, { y: 2.5, z: D / 2 + 0.01 });
      for (let i = 0; i < 5; i++) k.box(0.16, 0.08, 0.02, i === 2 ? PAL.red : 0x8a5a2a, { x: -0.5 + i * 0.25, y: 2.5, z: D / 2 + 0.04 });
    });
    // the cider press: a stone trough, a slatted tub, the oak frame and its great wooden screw
    k.part('press', () => k.at({ x: -0.55, z: 0.25 }, () => {
      k.surf(['fieldstone', { scale: 0.5 }], () => k.box(1.25, 0.4, 1.25, 0xb8b0a0, { y: 0.35 }));
      k.box(0.12, 0.08, 0.36, 0x9a8f7c, { y: 0.42, z: 0.75 });
      k.surf(['planks', { axis: 'y', scale: 0.4 }], () => {
        for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; k.box(0.1, 0.5, 0.05, i % 2 ? PAL.wood : PAL.woodLight, { x: Math.cos(a) * 0.38, y: 0.81, z: Math.sin(a) * 0.38, ry: -a + Math.PI / 2 }); }
        for (const yy of [0.66, 0.96]) k.cyl(0.42, 0.04, PAL.metalDark, { y: yy }, 12, 0.42);
        k.cyl(0.36, 0.08, PAL.woodDark, { y: 1.12 }, 10);
        for (const s of [-1, 1]) k.box(0.16, 1.9, 0.18, PAL.woodDark, { x: s * 0.62, y: 1.32 });
        k.box(1.5, 0.2, 0.22, PAL.woodDark, { y: 2.12 });
      });
      k.cyl(0.07, 0.95, 0x8a6a42, { y: 1.62 }, 8);
      for (let i = 0; i < 5; i++) k.cyl(0.085, 0.03, 0x6e4a2a, { y: 1.3 + i * 0.16 }, 8);
      k.rod(-0.5, 1.98, 0, 0.5, 1.98, 0, 0.035, PAL.wood);
      // a pail under the spout
      k.cyl(0.13, 0.22, PAL.metal, { y: 0.26, z: 0.9 }, 9, 0.15);
      if (season !== 'winter') k.cyl(0.12, 0.02, 0xe8b04a, { y: 0.34, z: 0.9 }, 9);
    }));
    // barrels against the back wall
    k.part('barrel', () => {
      for (const [x, z] of [[1.2, -1.05], [1.75, -0.85]] as const) {
        k.surf(['planks', { axis: 'y', scale: 0.4 }], () => k.cyl(0.36, 0.86, 0xa0703f, { x, y: 0.58, z }, 10, 0.33));
        for (const yy of [0.32, 0.84]) k.cyl(0.375, 0.05, PAL.metalDark, { x, y: yy, z }, 10);
      }
    });
    // a shelf of honey jars and cider bottles on the back wall
    k.part('jars', () => {
      k.surf(['planks', { axis: 'x' }], () => k.box(1.9, 0.05, 0.3, PAL.plank, { x: -0.7, y: 1.55, z: -D / 2 + 0.25 }));
      for (let i = 0; i < 7; i++) {
        const x = -1.5 + i * 0.26;
        if (i % 3 === 2) { k.cyl(0.055, 0.22, 0x5a8a4a, { x, y: 1.69, z: -D / 2 + 0.24 }, 7); k.cyl(0.02, 0.06, 0x5a8a4a, { x, y: 1.83, z: -D / 2 + 0.24 }, 5); }
        else { k.cyl(0.07, 0.14, 0xe0a02a, { x, y: 1.65, z: -D / 2 + 0.24 }, 8); k.cyl(0.078, 0.04, i % 2 ? PAL.red : 0xf4efe2, { x, y: 1.74, z: -D / 2 + 0.24 }, 8); }
      }
      // a bee smoker and a stack of spare frames on the floor
      k.cyl(0.08, 0.2, PAL.metal, { x: 0.6, y: 0.27, z: -1.2 }, 8);
      k.cone(0.08, 0.09, PAL.metal, { x: 0.6, y: 0.42, z: -1.2 }, 8);
      for (let i = 0; i < 4; i++) k.box(0.48, 0.03, 0.26, PAL.woodLight, { x: 0.15, y: 0.17 + i * 0.035, z: -1.15, ry: i * 0.06 });
    });
    // the lantern hanging from the lintel
    k.part('lantern', () => {
      k.rod(1.1, 2.14, D / 2 - 0.08, 1.1, 1.92, D / 2 - 0.08, 0.012, PAL.ink);
      k.box(0.2, 0.04, 0.2, PAL.metalDark, { x: 1.1, y: 1.9, z: D / 2 - 0.08 });
      k.emit({ radius: 6.5, intensity: 0.6 }, () => k.box(0.15, 0.22, 0.15, PAL.lampGlow, { x: 1.1, y: 1.76, z: D / 2 - 0.08 }, 'glow'));
      k.box(0.2, 0.04, 0.2, PAL.metalDark, { x: 1.1, y: 1.63, z: D / 2 - 0.08 });
    });
  });
}

/** a hive on its stand: painted supers, a tin roof, the entrance and its landing board (front = +z) */
function hive(k: Kit, x: number, y: number, z: number, ry: number, i: number): void {
  const paints = [0xf4efe2, 0xf2dc8a, 0xb8d4a8, 0xa8c8e0];
  k.part('hive', () => k.at({ x, y, z, ry }, () => {
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) k.box(0.08, 0.42, 0.08, PAL.woodDark, { x: sx * 0.22, y: 0.17, z: sz * 0.2 });
    k.surf(['planks', { axis: 'x', scale: 0.5, variant: 2 }], () => {
      k.box(0.62, 0.06, 0.58, PAL.woodLight, { y: 0.4 });
      for (let s = 0; s < 3; s++) k.box(0.55, 0.24, 0.5, s === 1 ? 0xf6e8b8 : paints[i % paints.length], { y: 0.55 + s * 0.25 });
    });
    k.surf(['metal', { scale: 0.6 }], () => k.box(0.66, 0.06, 0.62, PAL.metal, { y: 1.2 }));
    k.prism([[-0.35, 0], [0.35, 0], [0, 0.15]], 0.64, paints[(i + 2) % paints.length] === 0xf4efe2 ? PAL.roofRed : PAL.roofGreen, { y: 1.22 });
    k.box(0.24, 0.035, 0.06, PAL.ink, { y: 0.45, z: 0.25 });
    k.box(0.32, 0.025, 0.14, PAL.woodLight, { y: 0.43, z: 0.31 });
  }));
}

const BED_COLORS: Record<Season, number[]> = {
  spring: [0x9a72d8, 0xf2c33a, 0xffffff, 0xf08aa8, 0x7ab0f0],
  summer: [0xa88ae0, 0xf6cf3a, 0xffffff, 0xf08aa8, 0x5a8ae8, 0xe85a4a],
  autumn: [0x8a5ac0, 0xe0a030, 0xb8483a, 0xa878d8],
  winter: [],
};
/** the wildflower bed the bees work: a kerb of stones and clumps of flowers (dry stalks in winter) */
function bed(k: Kit, h: HeightFn, season: Season): void {
  const B = O.bed;
  k.part('bedKerb', () => k.surf(['rock', { scale: 0.5 }], () => {
    for (let x = B.x0; x <= B.x1 + 0.01; x += 0.45) for (const z of [B.z0 - 0.12, B.z1 + 0.12]) k.blob(0.13, STONES[Math.floor(hash(x, z) * 6)], { x, y: h(x, z) + 0.02, z, s: [1.2, 0.6, 1] });
  }));
  const cols = BED_COLORS[season];
  k.part('flowers-bed', () => {
    for (let i = 0; i < 84; i++) {
      const x = B.x0 + 0.2 + hash(i, 11) * (B.x1 - B.x0 - 0.4), z = B.z0 + 0.15 + hash(i, 12) * (B.z1 - B.z0 - 0.3), y = h(x, z);
      const ht = 0.28 + hash(i, 13) * 0.3;
      k.box(0.025, ht, 0.025, season === 'winter' ? 0x8a7a5a : PAL.leafDark, { x, y: y + ht / 2 - 0.02, z, rz: (hash(i, 14) - 0.5) * 0.3 });
      if (cols.length) k.add(new THREE.OctahedronGeometry(0.055, 0), cols[i % cols.length], { x, y: y + ht, z, s: [1.2, 0.7, 1.2] });
      if (i % 3 === 0) k.box(0.12, 0.02, 0.05, season === 'winter' ? 0x8a7a5a : PAL.leaf, { x, y: y + ht * 0.4, z, ry: i });
    }
  });
}

/** crates by the honey house (with apples in autumn), and a picking ladder leant into one tree with a basket at its foot */
function dressing(k: Kit, h: HeightFn, season: Season): void {
  const crate = (x: number, z: number, y: number, ry: number, fruit: number | null) => k.at({ x, y, z, ry }, () => {
    k.surf(['planks', { axis: 'x', scale: 0.5 }], () => {
      for (const s of [-1, 1]) k.box(0.62, 0.32, 0.04, PAL.woodLight, { y: 0.17, z: s * 0.2 });
      for (const s of [-1, 1]) k.box(0.04, 0.32, 0.4, PAL.woodLight, { x: s * 0.29, y: 0.17 });
      k.box(0.6, 0.03, 0.4, PAL.wood, { y: 0.03 });
    });
    if (fruit !== null) for (let i = 0; i < 6; i++) k.ball(0.075, fruit, { x: -0.18 + (i % 3) * 0.18, y: 0.3, z: i < 3 ? -0.08 : 0.08 }, 0);
  });
  const cx = O.shed.x + 2.6, cz = O.shed.z + 2.4, cy = h(cx, cz);
  k.part('crate', () => {
    crate(cx, cz, cy - 0.02, 0.2, season === 'autumn' ? 0xd8402e : null);
    crate(cx + 0.72, cz - 0.1, h(cx + 0.72, cz - 0.1) - 0.02, -0.1, season === 'autumn' ? 0xd8cc58 : season === 'summer' ? 0xc81a36 : null);
    crate(cx + 0.36, cz - 0.05, Math.max(cy, h(cx + 0.72, cz - 0.1)) + 0.33, 0.05, null);
  });
  const t = O.trees[O.ladder.tree];
  const fx = t.x + 1.25, fz = t.z + 1.0, fy = h(fx, fz);
  k.part('ladder', () => k.at({ x: fx, y: fy - 0.04, z: fz, ry: Math.atan2(t.x - fx, t.z - fz) }, () => {
    for (const s of [-0.21, 0.21]) k.box(0.06, 2.55, 0.06, PAL.woodLight, { x: s, y: 1.2, z: 0.36, rx: 0.3 });
    for (let r = 0; r < 6; r++) k.box(0.42, 0.04, 0.05, PAL.woodLight, { y: 0.22 + r * 0.4, z: 0.06 + r * 0.125 });
  }));
  k.part('pickBasket', () => k.at({ x: fx + 0.55, y: h(fx + 0.55, fz + 0.2), z: fz + 0.2 }, () => {
    k.surf(['hay', { scale: 0.4 }], () => k.cyl(0.26, 0.28, 0xb98a4a, { y: 0.14 }, 9, 0.31));
    k.rod(-0.27, 0.28, 0, 0.27, 0.28, 0, 0.02, 0x8a5a2a, 4);
  }));
}

/** the post of the sign by the gate (the board itself is a canvas plaque: `signBoard`) */
function signPost(k: Kit, h: HeightFn): void {
  const s = O.sign, y = h(s.x, s.z);
  k.part('signPost', () => {
    for (const o of [-0.5, 0.5]) k.box(0.1, 1.5, 0.1, PAL.woodDark, { x: s.x + o, y: y + 0.7, z: s.z });
  });
}

/** Everything static, merged per material (rebuilt when the season turns). */
export function buildOrchardKit(season: Season, heightAt: (x: number, z: number) => number, seed = 5): Kit {
  const h = heightIn(heightAt);
  const k = new Kit(seed);
  wall(k, h);
  gate(k, h);
  shed(k, h, season);
  for (const v of O.hives) hive(k, v.x, h(v.x, v.z) - 0.03, v.z, v.ry, v.i);
  bed(k, h, season);
  dressing(k, h, season);
  signPost(k, h);
  return k;
}

/** the sign's board: a painted canvas plaque (orchard-local position / turn applied by the caller) */
export function signBoard(): THREE.Mesh {
  const W = 512, H = 200;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#5a3a22'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#c99a64'; g.fillRect(8, 8, W - 16, H - 16);
  for (let i = 0; i < 6; i++) { g.fillStyle = `rgba(90,58,34,${0.08 + (i % 2) * 0.05})`; g.fillRect(8, 8 + i * 31, W - 16, 2); }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#3b2412';
  g.font = 'bold 54px "Trebuchet MS", "Segoe UI", system-ui, sans-serif';
  g.fillText('Hillside Orchard', W / 2, 74);
  g.font = '600 25px "Trebuchet MS", "Segoe UI", system-ui, sans-serif';
  g.fillStyle = '#4a2e1a';
  g.fillText('apples · pears · plums · cherries', W / 2, 128);
  g.fillText('honey · cider · mind the bees', W / 2, 162);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff });
  const geo = new THREE.BoxGeometry(1.4, 0.55, 0.05);
  // the canvas on the front (+z) and back faces only; the edges stay wood
  const m = new THREE.Mesh(geo, [new THREE.MeshBasicMaterial({ color: 0x5a3a22 }), new THREE.MeshBasicMaterial({ color: 0x5a3a22 }), new THREE.MeshBasicMaterial({ color: 0x5a3a22 }), new THREE.MeshBasicMaterial({ color: 0x5a3a22 }), mat, mat]);
  m.name = 'orchard:sign';
  return m;
}
