/**
 * Prop models for fields: fence segments, soil clods, pen tiles, signs, shelters, troughs, hives, carts, scarecrows.
 * Every model is one merged vertex-coloured geometry with its origin on the ground (front faces +z).
 */
import * as THREE from 'three';
import type { PlotKind, Season } from '../../model/types.ts';
import { PAL } from '../toon.ts';
import { ball, box, cached, cone, cyl, dodec, jitter, leaf, merge, named, octa, paint, prism, rng, S, sphere, torus } from './geo.ts';
import type { Xf } from './geo.ts';

const snowy = (s: Season) => s === 'winter';
const mix = (a: number, b: number, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();

// ---------------------------------------------------------------------------------------------------------------
// Fence

/** One fence segment of length 2 along +x: a post at x=0 and two rails to x=2. Scale x to fit a run. */
export function fenceSegment(season: Season): THREE.BufferGeometry {
  return cached(`fence:${season}`, () => {
    const p: THREE.BufferGeometry[] = [];
    // weathered posts with sawn end-grain tops, rails with long grain
    // (driven 0.1 m into the ground: where the terrain mesh dips past a field corner the post still meets it)
    p.push(S(box(0.17, 1.26, 0.17, PAL.wood, { p: [0, 0.53, 0] }), 'logs', { axis: 'y', scale: 0.45, strength: 0.85 }));
    // rails nailed on the front of the posts (not flush with them: no z-fighting between differently painted faces)
    p.push(S(box(2.02, 0.12, 0.07, PAL.woodLight, { p: [1, 0.48, 0.07], r: [0, 0, 0.012] }), 'logs', { axis: 'x', scale: 0.42, strength: 0.75 }));
    p.push(S(box(2.02, 0.12, 0.07, PAL.plank, { p: [1, 0.86, 0.07], r: [0, 0, -0.01] }), 'logs', { axis: 'x', scale: 0.42, strength: 0.75 }));
    if (snowy(season)) {
      p.push(S(box(0.22, 0.07, 0.22, PAL.snow, { p: [0, 1.19, 0] }), 'snow'));
      p.push(S(box(1.9, 0.05, 0.1, PAL.snow, { p: [1, 0.945, 0.07] }), 'snow'));
    }
    return jitter(merge(p), 0.04, 13);
  });
}

/** The workspace-colour ribbon tied round each fence post (white: tinted per instance). */
export function fenceRibbon(): THREE.BufferGeometry {
  return cached('fenceribbon', () => merge([
    box(0.2, 0.09, 0.2, 0xffffff, { p: [0, 0.98, 0] }),
    box(0.05, 0.2, 0.03, 0xffffff, { p: [-0.05, 0.86, 0.125], r: [0, 0, 0.35] }),
    box(0.05, 0.18, 0.03, 0xffffff, { p: [0.06, 0.87, 0.125], r: [0, 0, -0.4] }),
  ]));
}

/** Gate posts (tall, with a pennant in the workspace colour) at x = ±hw. */
export function gatePosts(hw: number, color: number, season: Season): THREE.BufferGeometry[] {
  const p: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    p.push(S(box(0.26, 1.6, 0.26, PAL.woodDark, { p: [s * hw, 0.8, 0] }), 'logs', { axis: 'y', scale: 0.6 }));
    p.push(S(box(0.34, 0.12, 0.34, PAL.wood, { p: [s * hw, 1.62, 0] }), 'planks', { axis: 'x', variant: 1, scale: 0.6 }));
    p.push(ball(0.12, PAL.woodLight, { p: [s * hw, 1.76, 0] }));
    if (snowy(season)) p.push(S(box(0.36, 0.07, 0.36, PAL.snow, { p: [s * hw, 1.71, 0] }), 'snow'));
  }
  // pennant pole on the left gate post
  p.push(cyl(0.025, 0.025, 1.0, 5, PAL.woodDark, { p: [-hw, 2.2, 0] }));
  p.push(S(prism([[0, 0], [0.75, -0.18], [0, -0.36]], 0.03, color, { p: [-hw + 0.03, 2.66, 0] }), 'fabric', { axis: 'x', scale: 0.5 }));
  return p;
}

// ---------------------------------------------------------------------------------------------------------------
// Ground

/** A tilled soil ridge (1.3 long along z). Top soil, grass underside: flipping it over is the tilling animation. */
export function clod(season: Season): THREE.BufferGeometry {
  return cached(`clod:${season}`, () => {
    const soil = season === 'winter' ? mix(PAL.soil, 0xdfe6ee, 0.45) : PAL.soil;
    const top = season === 'winter' ? mix(PAL.dirtDark, 0xf0f4f8, 0.6) : mix(PAL.soil, PAL.dirt, 0.3);
    const p = [
      paint(prism([[-0.6, -0.12], [0.6, -0.12], [0.4, 0.05], [0.16, 0.1], [-0.18, 0.1], [-0.42, 0.05]], 1.28, soil), 'tilled'),
      paint(box(0.46, 0.03, 1.22, top, { p: [-0.01, 0.1, 0] }), 'tilled'),
      box(1.0, 0.02, 1.2, PAL.grass, { p: [0, -0.125, 0] }),
    ];
    // a couple of pebbles / lumps
    p.push(dodec(0.07, PAL.dirtDark, { p: [0.28, 0.08, 0.3] }), dodec(0.05, PAL.dirt, { p: [-0.25, 0.08, -0.35] }));
    return jitter(merge(p), 0.05, 11);
  });
}

/** An irregular worn-ground patch (white top: tinted per instance to dirt / straw / mud), grass underside. */
export function penTile(): THREE.BufferGeometry {
  return cached('pentile', () => {
    const r = rng('pentile');
    const n = 11, top: number[] = [], bot: number[] = [];
    const rad = Array.from({ length: n }, () => 0.7 + r() * 0.35);
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, r0 = rad[i], r1 = rad[(i + 1) % n];
      const x0 = Math.cos(a0) * r0, z0 = Math.sin(a0) * r0, x1 = Math.cos(a1) * r1, z1 = Math.sin(a1) * r1;
      top.push(0, 0.035, 0, x1, 0.02, z1, x0, 0.02, z0);
      bot.push(0, -0.035, 0, x0 * 0.95, -0.03, z0 * 0.95, x1 * 0.95, -0.03, z1 * 0.95);
      // rim
      top.push(x0, 0.02, z0, x1, 0.02, z1, x1, -0.03, z1, x0, 0.02, z0, x1, -0.03, z1, x0, -0.03, z0);
    }
    const g1 = new THREE.BufferGeometry(); g1.setAttribute('position', new THREE.Float32BufferAttribute(top, 3));
    const g2 = new THREE.BufferGeometry(); g2.setAttribute('position', new THREE.Float32BufferAttribute(bot, 3));
    return merge([paint(paintAll(g1, 0xffffff), 'worn'), paintAll(g2, PAL.grass)]);
  });
}
const paintAll = (g: THREE.BufferGeometry, c: number) => {
  const col = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
};

/** Flat tilled-soil bed under the ridges (so no grass shows in the furrows). */
export function soilBed(x0: number, x1: number, z0: number, z1: number, season: Season): THREE.BufferGeometry {
  const c = season === 'winter' ? mix(PAL.soilWet, 0xcfd8e0, 0.4) : PAL.soilWet;
  return S(box(x1 - x0, 0.04, z1 - z0, c, { p: [(x0 + x1) / 2, 0.0, (z0 + z1) / 2] }), 'soil', { axis: 'z', scale: 0.5 });
}

// ---------------------------------------------------------------------------------------------------------------
// Signs

/** A sign: two posts and a board 1.5 × 0.75 whose front is covered by an atlas text quad at z = 0.07, y = 1.15. */
export function signBoard(season: Season): THREE.BufferGeometry {
  return cached(`sign:${season}`, () => {
    const p = [
      S(box(0.12, 1.5, 0.12, PAL.woodDark, { p: [-0.55, 0.75, 0] }), 'logs', { axis: 'y', scale: 0.5 }),
      S(box(0.12, 1.5, 0.12, PAL.woodDark, { p: [0.55, 0.75, 0] }), 'logs', { axis: 'y', scale: 0.5 }),
      S(box(1.56, 0.8, 0.1, PAL.wood, { p: [0, 1.15, 0] }), 'planks', { axis: 'h', variant: 1, scale: 1.08 }),
      S(box(1.66, 0.08, 0.16, PAL.woodDark, { p: [0, 1.58, 0] }), 'logs', { axis: 'x', scale: 0.5 }),
    ];
    if (snowy(season)) p.push(S(box(1.62, 0.07, 0.18, PAL.snow, { p: [0, 1.65, 0] }), 'snow'));
    return merge(p);
  });
}
export const SIGN_TEXT = { y: 1.15, z: 0.056, w: 1.48, h: 0.74 } as const;

export function textQuad(): THREE.BufferGeometry {
  return cached('textquad', () => new THREE.PlaneGeometry(1, 1));
}

/** Little red flag on a pole (blocked plots): origin at the pole foot, cloth flaps in the vertex shader-free way (per frame rotation). */
export function flag(): THREE.BufferGeometry {
  return cached('flag', () => merge([
    S(cyl(0.03, 0.03, 1.2, 5, PAL.metalDark, { p: [0, 0.6, 0] }), 'metal', { scale: 0.4, strength: 0.6 }),
    ball(0.05, PAL.yellow, { p: [0, 1.22, 0] }),
    S(prism([[0, 0], [0.55, -0.14], [0.5, -0.2], [0, -0.38]], 0.03, PAL.alertRed, { p: [0.03, 1.17, 0] }), 'fabric', { axis: 'x', scale: 0.5 }),
  ]));
}

// ---------------------------------------------------------------------------------------------------------------
// Carts, crates, sprinklers

export function cart(): THREE.BufferGeometry {
  return cached('cart', () => {
    const p: THREE.BufferGeometry[] = [];
    p.push(S(box(1.7, 0.1, 1.1, PAL.plank, { p: [0, 0.62, 0] }), 'planks', { axis: 'z', variant: 1, scale: 0.85 }));
    for (const s of [-1, 1]) {
      p.push(S(box(1.74, 0.42, 0.08, PAL.wood, { p: [0, 0.86, s * 0.53] }), 'planks', { axis: 'h', variant: 1, scale: 0.85 }));
      p.push(S(box(0.08, 0.42, 1.1, PAL.wood, { p: [s * 0.85, 0.86, 0] }), 'planks', { axis: 'h', variant: 1, scale: 0.85 }));
      // corner irons
      for (const e of [-1, 1]) p.push(S(box(0.1, 0.44, 0.1, PAL.metalDark, { p: [e * 0.84, 0.86, s * 0.52] }), 'metal', { variant: 2, scale: 0.3 }));
      p.push(S(torus(0.42, 0.06, 5, 10, PAL.woodDark, { p: [0.15, 0.42, s * 0.64] }), 'logs', { axis: 'h', scale: 0.4 }));
      p.push(S(torus(0.47, 0.022, 4, 12, PAL.metalDark, { p: [0.15, 0.42, s * 0.64] }), 'metal', { variant: 2, scale: 0.3 }));
      p.push(S(cyl(0.08, 0.08, 0.1, 6, PAL.metalDark, { p: [0.15, 0.42, s * 0.64], r: [Math.PI / 2, 0, 0] }), 'metal', { scale: 0.3 }));
      for (let k = 0; k < 3; k++) p.push(box(0.8, 0.05, 0.05, PAL.woodDark, { p: [0.15, 0.42, s * 0.64], r: [0, 0, (k * Math.PI) / 3] }));
      p.push(S(box(1.1, 0.07, 0.07, PAL.woodDark, { p: [-1.35, 0.72, s * 0.3], r: [0, 0, 0.18] }), 'logs', { axis: 'h', scale: 0.5 }));
    }
    p.push(S(box(0.08, 0.5, 0.08, PAL.woodDark, { p: [0.72, 0.3, 0] }), 'logs', { axis: 'y', scale: 0.5 }));
    return jitter(merge(p), 0.04, 3);
  });
}

/** Heaped produce inside the cart, tinted per kind (white base colours). */
export function cartHeap(): THREE.BufferGeometry {
  return cached('cartheap', () => {
    const r = rng('heap');
    const p: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 26; i++) {
      const x = (r() - 0.5) * 1.4, z = (r() - 0.5) * 0.85, y = 0.72 + r() * 0.25 + (0.35 - Math.abs(x) * 0.2 - Math.abs(z) * 0.3);
      p.push(ball(0.13 + r() * 0.06, mix(0xffffff, 0xd8d8d0, r()), { p: [x, y, z], s: [1, 0.85, 1] }));
    }
    return merge(p);
  });
}

/** A burlap sack of the field's yield (work done in the workspace), tied at the neck, grain peeking out of the mouth. */
export function sack(): THREE.BufferGeometry {
  return cached('sack', () => {
    const p: THREE.BufferGeometry[] = [];
    p.push(S(sphere(0.25, 9, 6, 0xc9a774, { p: [0, 0.25, 0], s: [1, 1.05, 0.85] }), 'fabric', { scale: 0.35 }));
    p.push(S(cyl(0.11, 0.17, 0.14, 8, 0xc9a774, { p: [0, 0.54, 0] }), 'fabric', { scale: 0.3 }));
    p.push(cyl(0.12, 0.12, 0.04, 8, 0x8a6a40, { p: [0, 0.5, 0] }));
    p.push(S(cyl(0.16, 0.12, 0.1, 8, 0xc9a774, { p: [0, 0.64, 0] }), 'fabric', { scale: 0.3 }));
    for (let i = 0; i < 3; i++) p.push(ball(0.07, PAL.hay, { p: [Math.cos(i * 2.1) * 0.06, 0.7, Math.sin(i * 2.1) * 0.06] }));
    return jitter(merge(p), 0.03, 5);
  });
}
/** Where the sacks stand: inside the front-right corner (site-local offsets from the corner), filling front row first. */
export const SACK_STACK: readonly [number, number, number][] = [[-0.7, 0, -0.68], [-1.26, 0, -0.72], [-0.74, 0, -1.25], [-1.82, 0, -0.68], [-1.3, 0, -1.28], [-1.86, 0, -1.24]];

export function crate(): THREE.BufferGeometry {
  return cached('crate', () => {
    const p: THREE.BufferGeometry[] = [S(box(0.62, 0.42, 0.46, PAL.plank, { p: [0, 0.21, 0] }), 'planks', { axis: 'h', variant: 1, scale: 0.55 })];
    for (const s of [-1, 1]) {
      p.push(S(box(0.66, 0.07, 0.03, PAL.woodDark, { p: [0, 0.12, s * 0.24] }), 'logs', { axis: 'x', scale: 0.4 }), S(box(0.66, 0.07, 0.03, PAL.woodDark, { p: [0, 0.32, s * 0.24] }), 'logs', { axis: 'x', scale: 0.4 }));
    }
    const r = rng('crate');
    for (let i = 0; i < 7; i++) p.push(ball(0.09, [PAL.apple, PAL.pumpkin, PAL.cabbage, PAL.yellow, PAL.grape][i % 5], { p: [(r() - 0.5) * 0.4, 0.35, (r() - 0.5) * 0.3] }));
    return jitter(merge(p), 0.04, 5);
  });
}

export function sprinkler(): THREE.BufferGeometry {
  return cached('sprinkler', () => merge([
    S(cyl(0.05, 0.05, 0.7, 6, PAL.metal, { p: [0, 0.35, 0] }), 'metal', { variant: 2, scale: 0.3, strength: 0.7 }),
    S(cyl(0.09, 0.07, 0.1, 6, PAL.metalDark, { p: [0, 0.74, 0] }), 'metal', { scale: 0.3 }),
    box(0.4, 0.04, 0.05, PAL.metal, { p: [0, 0.8, 0] }),
    cyl(0.12, 0.12, 0.04, 6, PAL.metalDark, { p: [0, 0.02, 0] }),
  ]));
}

// ---------------------------------------------------------------------------------------------------------------
// Scarecrow helpers

/** A scarecrow on a post (faces +z), right arm holding a lantern frame at (0.78, 1.3, 0.05). */
export function scarecrow(season: Season): THREE.BufferGeometry {
  return cached(`scarecrow:${season}`, () => {
    const p: THREE.BufferGeometry[] = [];
    p.push(S(box(0.12, 1.9, 0.12, PAL.woodDark, { p: [0, 0.95, -0.05] }), 'logs', { axis: 'y', scale: 0.5 }));
    p.push(S(box(1.7, 0.09, 0.09, PAL.wood, { p: [0, 1.5, -0.05] }), 'logs', { axis: 'x', scale: 0.5 }));
    // shirt + overalls (woven cloth, stitched patches)
    const cloth = (g: THREE.BufferGeometry, sc = 0.45) => S(g, 'fabric', { scale: sc });
    p.push(cloth(box(0.5, 0.5, 0.3, PAL.red, { p: [0, 1.38, 0] })));
    p.push(cloth(box(0.52, 0.34, 0.32, PAL.blue, { p: [0, 1.06, 0] })));
    p.push(cloth(box(0.1, 0.35, 0.02, PAL.blue, { p: [-0.13, 1.4, 0.16] })), cloth(box(0.1, 0.35, 0.02, PAL.blue, { p: [0.13, 1.4, 0.16] })));
    p.push(cloth(box(0.12, 0.12, 0.02, 0xc84a8a, { p: [0.1, 1.05, 0.165] }), 0.12)); // patch
    p.push(cloth(box(0.13, 0.11, 0.02, 0xe8c070, { p: [-0.12, 1.3, 0.155], r: [0, 0, 0.2] }), 0.12)); // patch on the shirt
    for (const s of [-1, 1]) {
      p.push(cloth(box(0.5, 0.2, 0.22, PAL.red, { p: [s * 0.45, 1.5, -0.02] })));
      // straw tufts at the sleeve ends
      for (let k = 0; k < 3; k++) p.push(S(cone(0.05, 0.2, 4, PAL.hay, { p: [s * (0.78 + k * 0.02), 1.5 + (k - 1) * 0.06, -0.02], r: [0, 0, s * (-Math.PI / 2 + (k - 1) * 0.35)] }), 'hay', { scale: 0.4 }));
      p.push(S(cone(0.06, 0.22, 4, PAL.hay, { p: [s * 0.14, 0.82, 0], r: [Math.PI, 0, s * 0.3] }), 'hay', { scale: 0.4 }));
    }
    // sack head with stitched face
    p.push(S(ball(0.23, 0xd9c08f, { p: [0, 1.86, 0], s: [1, 1.05, 0.95] }, 1), 'fabric', { scale: 0.3 }));
    p.push(box(0.05, 0.05, 0.02, PAL.ink, { p: [-0.08, 1.9, 0.215] }), box(0.05, 0.05, 0.02, PAL.ink, { p: [0.08, 1.9, 0.215] }));
    for (let k = 0; k < 4; k++) p.push(box(0.035, 0.012, 0.02, PAL.ink, { p: [-0.06 + k * 0.04, 1.79 - Math.sin((k / 3) * Math.PI) * 0.02, 0.21] }));
    p.push(cone(0.035, 0.07, 4, PAL.orange, { p: [0, 1.85, 0.24], r: [Math.PI / 2, 0, 0] }));
    // straw hat
    p.push(S(cyl(0.4, 0.42, 0.04, 9, PAL.hay, { p: [0, 2.03, 0] }), 'thatch', { scale: 0.3 }));
    p.push(S(cyl(0.18, 0.23, 0.2, 8, PAL.hay, { p: [0, 2.14, 0] }), 'thatch', { scale: 0.3 }));
    p.push(S(cyl(0.235, 0.235, 0.05, 8, PAL.red, { p: [0, 2.07, 0] }), 'fabric', { scale: 0.2 }));
    if (snowy(season)) p.push(S(cyl(0.24, 0.3, 0.06, 8, PAL.snow, { p: [0, 2.27, 0] }), 'snow'), S(box(1.6, 0.04, 0.12, PAL.snow, { p: [0, 1.62, -0.03] }), 'snow'));
    // lantern frame hanging from the right hand
    p.push(cyl(0.012, 0.012, 0.2, 4, PAL.metalDark, { p: [0.78, 1.42, 0.05] }));
    p.push(box(0.16, 0.03, 0.16, PAL.metalDark, { p: [0.78, 1.33, 0.05] }), box(0.16, 0.03, 0.16, PAL.metalDark, { p: [0.78, 1.12, 0.05] }));
    p.push(cone(0.1, 0.07, 4, PAL.metalDark, { p: [0.78, 1.37, 0.05], r: [0, Math.PI / 4, 0] }));
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) p.push(box(0.02, 0.2, 0.02, PAL.metalDark, { p: [0.78 + dx * 0.07, 1.225, 0.05 + dz * 0.07] }));
    return jitter(merge(p), 0.04, 21);
  });
}
export const LANTERN = { x: 0.78, y: 1.225, z: 0.05 } as const;

/** The lantern's flame box (emissive via instance colour). */
export function lanternCore(): THREE.BufferGeometry {
  return cached('lanterncore', () => merge([box(0.12, 0.17, 0.12, 0xffffff), octa(0.05, 0xffffff, { p: [0, 0.0, 0] })]));
}

/** Exit ribbon tied around the post under the crossbar: tinted green / red per instance. */
export function exitRibbon(): THREE.BufferGeometry {
  return cached('exitribbon', () => merge([
    box(0.16, 0.07, 0.16, 0xffffff, { p: [0, 0, -0.05] }),
    box(0.05, 0.3, 0.02, 0xffffff, { p: [-0.04, -0.14, 0.04], r: [0, 0, 0.25] }),
    box(0.05, 0.26, 0.02, 0xffffff, { p: [0.05, -0.12, 0.04], r: [0, 0, -0.3] }),
  ]));
}

// ---------------------------------------------------------------------------------------------------------------
// Per-kind props (merged into the field's static mesh). Local site coordinates; `hw`, `hd` = half extents.

type Parts = THREE.BufferGeometry[];

/** the ground footprints of the hay bales placed by the current kindProps call (half the bale's diagonal) */
let baleFeet: { x: number; z: number; r: number }[] | null = null;
function hayBale(p: Parts, x: number, z: number, yaw: number, s = 1, y = 0): void {
  baleFeet?.push({ x, z, r: 0.59 * s });
  p.push(S(box(1.0 * s, 0.55 * s, 0.6 * s, PAL.hay, { p: [x, y + 0.275 * s, z], r: [0, yaw, 0] }), 'hay', { scale: 0.8 }));
  for (const o of [-0.25, 0.25]) {
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    p.push(S(box(0.04 * s, 0.57 * s, 0.62 * s, 0x8a6a3a, { p: [x + o * s * c, y + 0.275 * s, z - o * s * sn], r: [0, yaw, 0] }), 'fabric', { scale: 0.2, strength: 0.6 }));
  }
}

function trough(p: Parts, x: number, z: number, yaw: number, fill: number, len = 1.8): void {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const at = (lx: number, ly: number, lz: number): Xf['p'] => [x + lx * c + lz * s, ly, z - lx * s + lz * c];
  const pl = (g: THREE.BufferGeometry, v = 1) => S(g, 'planks', { axis: 'h', variant: v, scale: 0.72 });
  p.push(pl(box(len, 0.08, 0.6, PAL.woodDark, { p: at(0, 0.2, 0), r: [0, yaw, 0] })));
  for (const o of [-1, 1]) {
    p.push(pl(box(len, 0.36, 0.08, PAL.wood, { p: at(0, 0.38, o * 0.28), r: [0, yaw, 0] })));
    p.push(pl(box(0.08, 0.36, 0.6, PAL.wood, { p: at(o * len / 2, 0.38, 0), r: [0, yaw, 0] })));
    p.push(S(box(0.1, 0.24, 0.7, PAL.woodDark, { p: at(o * (len / 2 - 0.2), 0.12, 0), r: [0, yaw, 0] }), 'logs', { axis: 'h', scale: 0.5 }));
    // iron bands round the ends
    p.push(S(box(0.06, 0.38, 0.64, PAL.metalDark, { p: at(o * (len / 2 - 0.16), 0.38, 0), r: [0, yaw, 0] }), 'metal', { variant: 2, scale: 0.35 }));
  }
  const water = fill === PAL.water;
  p.push(water ? box(len - 0.1, 0.03, 0.5, fill, { p: at(0, 0.48, 0), r: [0, yaw, 0] })
    : S(box(len - 0.1, 0.03, 0.5, fill, { p: at(0, 0.48, 0), r: [0, yaw, 0] }), 'hay', { scale: 0.5 }));
}

function shedRoof(p: Parts, x: number, z: number, w: number, d: number, h: number, roof: number, season: Season): void {
  // lean-to: posts + sloped roof high at the back
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const ph = sz < 0 ? h + 0.5 : h;
    p.push(S(box(0.16, ph, 0.16, PAL.woodDark, { p: [x + sx * (w / 2 - 0.1), ph / 2, z + sz * (d / 2 - 0.1)] }), 'logs', { axis: 'y', variant: 1, scale: 0.5 }));
  }
  const tilt = Math.atan2(0.5, d);
  // wooden shingles, rows stepping down the slope; a darker ridge board along the high back edge
  p.push(S(box(w + 0.5, 0.1, d + 0.6, roof, { p: [x, h + 0.3, z], r: [tilt, 0, 0] }), 'shingle', { axis: 'z', scale: 1.1 }));
  p.push(S(box(w + 0.56, 0.08, 0.16, mix(roof, 0x000000, 0.3), { p: [x, h + 0.53, z - d / 2 - 0.22], r: [tilt, 0, 0] }), 'logs', { axis: 'x', scale: 0.5 }));
  if (season === 'winter') p.push(S(box(w + 0.4, 0.1, d + 0.4, PAL.snow, { p: [x, h + 0.39, z], r: [tilt, 0, 0] }), 'snow'));
  // back and side walls (weathered board siding)
  p.push(S(box(w, h + 0.4, 0.1, PAL.plank, { p: [x, (h + 0.4) / 2, z - d / 2 + 0.05] }), 'planks', { axis: 'y', variant: 1, scale: 1.2 }));
  for (const sx of [-1, 1]) p.push(S(box(0.1, h * 0.6, d, PAL.wood, { p: [x + sx * (w / 2 - 0.05), h * 0.3, z] }), 'planks', { axis: 'h', variant: 1, scale: 1.2 }));
}

function coop(p: Parts, x: number, z: number, season: Season): void {
  // raised henhouse on stilts with an A roof and a ramp toward +z
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push(S(box(0.14, 0.6, 0.14, PAL.woodDark, { p: [x + sx * 1.05, 0.3, z + sz * 0.7] }), 'logs', { axis: 'y', scale: 0.5 }));
  // painted board-and-batten walls (the battens are the painted seams), white trim, shingle roof
  p.push(S(box(2.3, 1.1, 1.6, PAL.wallRed, { p: [x, 1.15, z] }), 'planks', { axis: 'y', variant: 2, scale: 0.8 }));
  p.push(S(box(2.36, 0.1, 1.66, PAL.wallWhite, { p: [x, 0.62, z] }), 'planks', { axis: 'h', variant: 2, scale: 0.6 }));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push(S(box(0.07, 1.1, 0.07, PAL.wallWhite, { p: [x + sx * 1.14, 1.15, z + sz * 0.79] }), 'planks', { axis: 'y', variant: 2, scale: 0.5 }));
  p.push(S(prism([[-1.08, 0], [1.08, 0], [0, 0.8]], 2.7, PAL.roofBrown, { p: [x, 1.66, z], r: [0, Math.PI / 2, 0] }), 'shingle', { scale: 0.8 }));
  p.push(S(prism([[-0.8, 0], [0.8, 0], [0, 0.6]], 2.3, PAL.wallRed, { p: [x, 1.69, z], r: [0, Math.PI / 2, 0] }), 'planks', { axis: 'y', variant: 2, scale: 0.8 }));
  if (season === 'winter') p.push(S(prism([[-1.1, 0], [1.1, 0], [0, 0.82]], 2.72, PAL.snow, { p: [x, 1.72, z], r: [0, Math.PI / 2, 0] }), 'snow'));
  // door, window, ramp
  p.push(S(box(0.5, 0.55, 0.05, PAL.woodDark, { p: [x + 0.5, 1.0, z + 0.81] }), 'planks', { axis: 'y', variant: 1, scale: 0.55 }));
  p.push(S(box(0.36, 0.3, 0.05, PAL.wallWhite, { p: [x - 0.55, 1.3, z + 0.81] }), 'planks', { axis: 'h', variant: 2, scale: 0.4 }), box(0.28, 0.22, 0.06, PAL.ink, { p: [x - 0.55, 1.3, z + 0.815] }));
  p.push(S(box(0.5, 0.05, 1.3, PAL.plank, { p: [x + 0.5, 0.4, z + 1.35], r: [0.55, 0, 0] }), 'planks', { axis: 'x', variant: 1, scale: 0.5 }));
  for (let k = 0; k < 4; k++) p.push(S(box(0.5, 0.04, 0.04, PAL.woodDark, { p: [x + 0.5, 0.2 + k * 0.14, z + 1.8 - k * 0.27] }), 'logs', { axis: 'x', scale: 0.4 }));
}

function strawNest(p: Parts, x: number, z: number, eggs: number): void {
  const r = rng(`nest${x},${z}`);
  p.push(S(cyl(0.55, 0.65, 0.12, 8, PAL.hay, { p: [x, 0.06, z] }), 'hay', { scale: 0.6 }));
  for (let i = 0; i < 10; i++) p.push(S(box(0.35, 0.03, 0.04, mix(PAL.hay, PAL.wheat, r()), { p: [x + (r() - 0.5) * 1.0, 0.13, z + (r() - 0.5) * 1.0], r: [0, r() * 3, 0] }), 'hay', { scale: 0.4 }));
  for (let i = 0; i < eggs; i++) {
    const a = (i / eggs) * Math.PI * 2 + r();
    p.push(sphere(0.07, 6, 4, i % 3 === 2 ? 0xe8c9a0 : 0xfbf6ea, { p: [x + Math.cos(a) * 0.22, 0.18, z + Math.sin(a) * 0.22], s: [1, 1.3, 1] }));
  }
}

/** A straw nest on its own (gallery). */
export function strawNestGeo(): THREE.BufferGeometry { return cached('strawnest', () => { const p: Parts = []; strawNest(p, 0, 0, 0); return merge(p); }); }

function feeder(p: Parts, x: number, z: number, season: Season): void {
  // A-frame hay rack with a little roof
  for (const s of [-1, 1]) {
    p.push(S(box(0.1, 1.3, 0.1, PAL.woodDark, { p: [x + s * 0.8, 0.65, z - 0.3], r: [0.22, 0, 0] }), 'logs', { axis: 'y', scale: 0.5 }));
    p.push(S(box(0.1, 1.3, 0.1, PAL.woodDark, { p: [x + s * 0.8, 0.65, z + 0.3], r: [-0.22, 0, 0] }), 'logs', { axis: 'y', scale: 0.5 }));
  }
  for (let k = 0; k < 6; k++) for (const s of [-1, 1]) p.push(box(0.03, 0.8, 0.03, PAL.wood, { p: [x - 0.6 + k * 0.24, 0.8, z + s * 0.3], r: [s * -0.3, 0, 0] }));
  p.push(S(prism([[-0.5, 0], [0.5, 0], [0, 0.55]], 1.3, PAL.hay, { p: [x, 0.5, z], r: [0, Math.PI / 2, 0] }), 'hay', { scale: 0.7 }));
  p.push(S(prism([[-0.65, 0], [0.65, 0], [0, 0.45]], 1.9, PAL.roofRed, { p: [x, 1.3, z], r: [0, Math.PI / 2, 0] }), 'shingle', { scale: 0.6 }));
  if (season === 'winter') p.push(S(prism([[-0.67, 0], [0.67, 0], [0, 0.47]], 1.92, PAL.snow, { p: [x, 1.34, z], r: [0, Math.PI / 2, 0] }), 'snow'));
}

function sty(p: Parts, x: number, z: number, season: Season): void {
  // fieldstone walls, a clay-tile roof, straw bedding peeking out of the doorway
  p.push(S(box(2.4, 0.9, 1.5, PAL.stone, { p: [x, 0.45, z] }), 'fieldstone', { scale: 0.75 }));
  p.push(box(0.8, 0.65, 0.05, PAL.ink, { p: [x + 0.4, 0.33, z + 0.76] }));
  p.push(S(box(0.72, 0.06, 0.3, PAL.hay, { p: [x + 0.4, 0.03, z + 0.86] }), 'hay', { scale: 0.5 }));
  p.push(S(box(0.9, 0.1, 0.12, PAL.woodDark, { p: [x + 0.4, 0.7, z + 0.79] }), 'logs', { axis: 'x', scale: 0.5 }));
  p.push(S(prism([[-1.0, 0], [1.0, 0], [0, 0.7]], 2.7, PAL.roofRed, { p: [x, 0.88, z], r: [0, Math.PI / 2, 0] }), 'tile', { scale: 0.75 }));
  if (season === 'winter') p.push(S(prism([[-1.02, 0], [1.02, 0], [0, 0.72]], 2.72, PAL.snow, { p: [x, 0.93, z], r: [0, Math.PI / 2, 0] }), 'snow'));
}

function mudPuddle(p: Parts, x: number, z: number): void {
  p.push(S(cyl(1.7, 1.8, 0.05, 11, 0x5a3b22, { p: [x, 0.03, z], s: [1, 1, 0.75] }), 'dirt', { scale: 0.7, strength: 0.7 }));
  p.push(cyl(1.25, 1.25, 0.06, 10, 0x4a2f1b, { p: [x + 0.1, 0.04, z], s: [1, 1, 0.7] }));
  const r = rng('mud');
  for (let i = 0; i < 6; i++) p.push(ball(0.12 + r() * 0.1, 0x6a4a2a, { p: [x + (r() - 0.5) * 3, 0.04, z + (r() - 0.5) * 2], s: [1, 0.35, 1] }));
}

function hive(p: Parts, x: number, z: number, levels: number, tint: number, season: Season): void {
  p.push(S(box(0.8, 0.12, 0.7, PAL.woodDark, { p: [x, 0.25, z] }), 'planks', { axis: 'h', variant: 1, scale: 0.5 }));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push(S(box(0.08, 0.26, 0.08, PAL.woodDark, { p: [x + sx * 0.3, 0.13, z + sz * 0.26] }), 'logs', { axis: 'y', scale: 0.4 }));
  for (let l = 0; l < levels; l++) {
    const c = l % 2 ? tint : mix(tint, 0xffffff, 0.35);
    // painted boxes: boards run round the box, the paint worn at the seams
    p.push(S(box(0.72, 0.32, 0.62, c, { p: [x, 0.47 + l * 0.33, z] }), 'planks', { axis: 'h', variant: 2, scale: 0.64 }));
    p.push(box(0.74, 0.03, 0.64, mix(tint, 0x000000, 0.25), { p: [x, 0.31 + l * 0.33 + 0.33, z] }));
  }
  const top = 0.31 + levels * 0.33;
  p.push(S(box(0.84, 0.08, 0.74, PAL.roofRed, { p: [x, top + 0.04, z] }), 'planks', { axis: 'x', variant: 2, scale: 0.5 }));
  p.push(S(prism([[-0.44, 0], [0.44, 0], [0, 0.18]], 0.78, PAL.roofRed, { p: [x, top + 0.08, z] }), 'shingle', { scale: 0.45 }));
  if (season === 'winter') p.push(S(box(0.86, 0.08, 0.8, PAL.snow, { p: [x, top + 0.2, z] }), 'snow'));
  p.push(box(0.36, 0.05, 0.05, PAL.ink, { p: [x, 0.36, z + 0.31] }));
  p.push(S(box(0.4, 0.03, 0.14, PAL.woodLight, { p: [x, 0.33, z + 0.38] }), 'planks', { axis: 'x', variant: 1, scale: 0.4 }));
}

function trellisRow(p: Parts, x: number, z0: number, z1: number, season: Season): void {
  const n = Math.max(2, Math.round((z1 - z0) / 2.4) + 1);
  for (let i = 0; i < n; i++) {
    const z = z0 + ((z1 - z0) * i) / (n - 1);
    p.push(S(box(0.12, 1.75, 0.12, PAL.woodDark, { p: [x, 0.875, z] }), 'logs', { axis: 'y', scale: 0.45 }));
    p.push(S(box(0.5, 0.08, 0.08, PAL.wood, { p: [x, 1.6, z] }), 'logs', { axis: 'x', scale: 0.45 }));
    if (season === 'winter') p.push(S(box(0.16, 0.06, 0.16, PAL.snow, { p: [x, 1.78, z] }), 'snow'));
  }
  const len = z1 - z0, mid = (z0 + z1) / 2;
  for (const y of [0.85, 1.25]) p.push(box(0.025, 0.025, len, PAL.metalDark, { p: [x, y, mid] }));
  for (const s of [-1, 1]) p.push(box(0.02, 0.02, len, PAL.metalDark, { p: [x + s * 0.23, 1.62, mid] }));
}

function wellPump(p: Parts, x: number, z: number): void {
  p.push(S(box(0.3, 0.9, 0.3, PAL.metalDark, { p: [x, 0.45, z] }), 'metal', { variant: 2, scale: 0.35 }));
  p.push(S(box(0.6, 0.08, 0.08, PAL.metal, { p: [x + 0.25, 0.95, z], r: [0, 0, 0.3] }), 'metal', { scale: 0.3 }));
  p.push(cyl(0.05, 0.05, 0.3, 5, PAL.metal, { p: [x, 0.7, z + 0.2], r: [Math.PI / 2.4, 0, 0] }));
  // stave bucket with two iron hoops
  p.push(S(cyl(0.3, 0.26, 0.4, 8, PAL.wood, { p: [x, 0.2, z + 0.55] }), 'planks', { axis: 'y', variant: 1, scale: 0.5 }));
  for (const hy of [0.08, 0.31]) p.push(S(cyl(0.3 - (0.31 - hy) * 0.1 + 0.012, 0.3 - (0.31 - hy) * 0.1 + 0.01, 0.04, 8, PAL.metalDark, { p: [x, hy, z + 0.55] }), 'metal', { variant: 2, scale: 0.3 }));
  p.push(cyl(0.26, 0.26, 0.02, 8, PAL.water, { p: [x, 0.38, z + 0.55] }));
}

function wheelbarrow(p: Parts, x: number, z: number, yaw: number, load: number): void {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const at = (lx: number, ly: number, lz: number): Xf['p'] => [x + lx * c + lz * s, ly, z - lx * s + lz * c];
  p.push(S(box(0.6, 0.3, 0.8, PAL.green, { p: at(0, 0.45, 0), r: [0, yaw, 0] }), 'planks', { axis: 'h', variant: 2, scale: 0.6 }));
  p.push(torus(0.18, 0.05, 4, 8, PAL.ink, { p: at(0, 0.2, 0.55), r: [0, yaw + Math.PI / 2, 0] }));
  for (const o of [-1, 1]) p.push(S(box(0.05, 0.05, 0.9, PAL.woodDark, { p: at(o * 0.24, 0.45, -0.6), r: [0.25, yaw, 0] }), 'logs', { axis: 'h', scale: 0.4 }));
  for (let i = 0; i < 4; i++) p.push(ball(0.13, load, { p: at((i % 2 - 0.5) * 0.25, 0.64, (i < 2 ? -0.15 : 0.15)) }));
}

export interface KindProps {
  geo: Parts;
  /** solid footprints for animals + player colliders (local circles) */
  solids: { x: number; z: number; r: number }[];
  /** every prop's ground footprint, solid or not (hay bales, barrows, baskets …): small things placed later (git weeds) keep off them */
  footprints: { x: number; z: number; r: number }[];
}

/**
 * Props for a kind, around the fixed spots (bench back-left, helpers right, ask/done by the gate). The gate posts +
 * pennant are added by the field.
 */
export function kindProps(kind: PlotKind, hw: number, hd: number, season: Season): KindProps {
  const p: Parts = [], solids: KindProps['solids'] = [], footprints: KindProps['footprints'] = [];
  const foot = (x: number, z: number, r: number) => { footprints.push({ x, z, r }); };
  baleFeet = footprints;
  // every field: the thinking bench (a hay bale) at the bench spot, a water pump by the back fence
  named(p, 'hayBale', () => hayBale(p, -hw + 1.8, -hd + 1.25, 0.1, 0.9));
  const crops = !['chickens', 'cows', 'sheep', 'pigs'].includes(kind);
  if (crops && kind !== 'bees') { named(p, 'wellPump', () => wellPump(p, -hw + 0.7, 0.8)); solids.push({ x: -hw + 0.7, z: 1.1, r: 0.5 }); }
  switch (kind) {
    case 'pumpkins': named(p, 'wheelbarrow', () => wheelbarrow(p, -hw + 1.2, hd - 1.6, 0.6, PAL.pumpkin)); foot(-hw + 1.2, hd - 1.6, 0.85); named(p, 'hayBale', () => hayBale(p, hw - 3.2, hd - 1.1, -0.2, 0.8)); break;
    case 'wheat': named(p, 'hayBale', () => hayBale(p, hw - 3.2, hd - 1.1, 0.25)); named(p, 'hayBale', () => hayBale(p, hw - 3.15, hd - 1.12, 0.3, 0.7, 0.55)); break; // the second bale is stacked on the first (it sat inside it)
    case 'orchard': {
      // ladder against nothing: a leaning ladder + baskets of apples near the gate
      named(p, 'ladder', () => {
      for (const s of [-1, 1]) p.push(S(box(0.06, 2.0, 0.06, PAL.wood, { p: [-hw + 1.1 + s * 0.2, 0.95, hd - 1.2], r: [0.25, 0, 0] }), 'logs', { axis: 'y', scale: 0.4 }));
      for (let k = 0; k < 6; k++) p.push(S(box(0.4, 0.04, 0.05, PAL.woodDark, { p: [-hw + 1.1, 0.2 + k * 0.3, hd - 1.2 - 0.05 - k * 0.075] }), 'logs', { axis: 'x', scale: 0.4 }));
      });
      foot(-hw + 1.1, hd - 1.5, 0.6);
      for (const [bx, bz] of [[hw - 3.2, hd - 1.1], [hw - 2.5, hd - 0.8]]) foot(bx, bz, 0.35);
      for (const [bx, bz] of [[hw - 3.2, hd - 1.1], [hw - 2.5, hd - 0.8]]) named(p, 'appleBasket', () => {
        p.push(S(cyl(0.28, 0.22, 0.3, 8, PAL.woodLight, { p: [bx, 0.15, bz] }), 'thatch', { scale: 0.25 }));
        for (let i = 0; i < 5; i++) p.push(ball(0.09, PAL.apple, { p: [bx + Math.cos(i * 1.3) * 0.13, 0.32, bz + Math.sin(i * 1.3) * 0.13] }));
      });
      break;
    }
    // the first row starts past the thinking-bench hay bale (it ran through the bale)
    case 'vineyard': for (const x of [-6.9, -3.6, 0, 3.6, 6.3]) named(p, 'trellisRow', () => trellisRow(p, x, -hd + (x < -6 ? 2.1 : 1.0), hd - 3.0, season)); break;
    case 'berries': named(p, 'wheelbarrow', () => wheelbarrow(p, hw - 3.2, hd - 1.2, -0.5, PAL.berry)); foot(hw - 3.2, hd - 1.2, 0.85); break;
    case 'cabbages': named(p, 'hayBale', () => hayBale(p, hw - 3.2, hd - 1.1, 0.25, 0.8)); break;
    case 'sunflowers': break;
    case 'chickens':
      named(p, 'coop', () => coop(p, 0.6, -hd + 1.3, season)); solids.push({ x: 0.6, z: -hd + 1.3, r: 1.4 }, { x: -0.5, z: -hd + 1.3, r: 1.0 }, { x: 1.7, z: -hd + 1.3, r: 1.0 });
      named(p, 'strawNest', () => strawNest(p, -3.4, -hd + 1.4, 0)); named(p, 'strawNest', () => strawNest(p, 3.6, -hd + 1.3, 0)); foot(-3.4, -hd + 1.4, 0.7); foot(3.6, -hd + 1.3, 0.7);
      named(p, 'trough', () => trough(p, -4.5, 1.2, Math.PI / 2, PAL.wheat, 1.4)); solids.push({ x: -4.5, z: 1.2, r: 0.8 });
      break;
    case 'cows':
      named(p, 'shedRoof', () => shedRoof(p, 0.5, -hd + 1.5, 5.2, 2.6, 2.1, PAL.roofRed, season)); solids.push({ x: 0.5, z: -hd + 0.5, r: 1.0 }, { x: -1.6, z: -hd + 0.6, r: 1.0 }, { x: 2.6, z: -hd + 0.6, r: 1.0 });
      named(p, 'trough', () => trough(p, -4.4, 1.0, Math.PI / 2, PAL.water, 2.0)); solids.push({ x: -4.4, z: 0.6, r: 0.7 }, { x: -4.4, z: 1.4, r: 0.7 });
      named(p, 'hayBale', () => hayBale(p, 3.6, 0.6, 0.4)); named(p, 'hayBale', () => hayBale(p, 3.5, 1.3, 0.1, 0.9)); solids.push({ x: 3.6, z: 0.9, r: 0.9 });
      break;
    case 'sheep':
      named(p, 'feeder', () => feeder(p, 0.5, -hd + 2.2, season)); solids.push({ x: 0.0, z: -hd + 2.2, r: 1.0 }, { x: 1.0, z: -hd + 2.2, r: 1.0 });
      named(p, 'trough', () => trough(p, -4.4, 1.2, Math.PI / 2, PAL.water, 1.6)); solids.push({ x: -4.4, z: 1.2, r: 0.9 });
      named(p, 'hayBale', () => hayBale(p, 4.2, -hd + 1.3, 0.2, 0.9));
      break;
    case 'pigs':
      named(p, 'sty', () => sty(p, 1.0, -hd + 1.3, season)); solids.push({ x: 0.4, z: -hd + 1.3, r: 1.1 }, { x: 1.6, z: -hd + 1.3, r: 1.1 });
      named(p, 'mudPuddle', () => mudPuddle(p, -3.4, -0.6)); foot(-3.4, -0.6, 1.6);
      named(p, 'trough', () => trough(p, 4.0, 1.0, Math.PI / 2, 0xa0803a, 1.6)); solids.push({ x: 4.0, z: 1.0, r: 0.9 });
      break;
    case 'bees': break;
  }
  if (kind === 'bees') foot(hw - 3.4, hd - 1.1, 0.75);
  if (kind === 'bees') named(p, 'honeyStand', () => {
    // hives are added by the field (interactable); a bench + a honey stand
    p.push(S(box(1.0, 0.08, 0.6, PAL.plank, { p: [hw - 3.4, 0.8, hd - 1.1] }), 'planks', { axis: 'x', variant: 1, scale: 0.6 }));
    for (const s of [-1, 1]) p.push(S(box(0.08, 0.8, 0.5, PAL.woodDark, { p: [hw - 3.4 + s * 0.42, 0.4, hd - 1.1] }), 'planks', { axis: 'y', variant: 1, scale: 0.6 }));
    for (let i = 0; i < 4; i++) {
      p.push(cyl(0.1, 0.1, 0.2, 7, PAL.yellow, { p: [hw - 3.75 + i * 0.23, 0.94, hd - 1.1] }));
      p.push(cyl(0.11, 0.11, 0.05, 7, PAL.red, { p: [hw - 3.75 + i * 0.23, 1.06, hd - 1.1] }));
    }
  });
  baleFeet = null;
  for (const s of solids) footprints.push(s);
  return { geo: p, solids, footprints };
}

/** Hive for the bees field (a separate call so hives can be interactable positions; merged into props). */
export function hiveGeo(parts: Parts, x: number, z: number, i: number, season: Season): void {
  named(parts, 'hive', () => hive(parts, x, z, 2 + (i % 2), [PAL.wallWhite, PAL.yellow, 0x9fd0e0, 0xf0b0b8][i % 4], season));
}

/** A weed tuft for fallow soil. */
export function weed(): THREE.BufferGeometry {
  return cached('weed', () => {
    const p: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 5; i++) p.push(leaf(0.35 + (i % 2) * 0.12, 0.12, i % 2 ? PAL.grassDark : 0x8aa84a, { r: [-1.0 + (i % 3) * 0.2, (i / 5) * Math.PI * 2, 0] }));
    p.push(ball(0.04, PAL.yellow, { p: [0.05, 0.3, 0.02] }));
    return merge(p);
  });
}
