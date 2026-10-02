/**
 * The visitors' things, built into Kits (scene/structures/kit.ts): Barnaby's travelling cart and Odile's easel.
 * Each is built at the origin facing +z (the cart's counter side; its pulling handles stick out at −z).
 */
import { PAL } from '../toon.ts';
import type { Kit } from '../structures/kit.ts';

const PLUM = 0x6a3a6e, PLUM_DARK = 0x4a2650, TEAL = 0x2f8a8a, CANVAS = 0xefe2c4, PATCH = 0xd8b46a, BRASS = 0xc9962a;

/** cart footprint (local): half width, half depth (the handles excluded), and the parked collider */
export const CART = Object.freeze({ hw: 1.15, hd: 0.8, handle: 1.7, r: 1.5 });

/** where the cart's lantern hangs (local), for its light */
export const CART_LANTERN = Object.freeze({ x: 1.12, y: 2.05, z: 0.86 });

/**
 * Barnaby Pell's travelling cart: a plum-and-teal box wagon on two tall spoked wheels, a patched canvas hood on hoops,
 * pots and pans that rattle, a brass lantern, a striped flap propped open over the counter (`open`), crates and a
 * birdcage of curiosities on top. Front (+z) is the counter; the pulling handles stick out behind (−z).
 */
export function buildCart(k: Kit, bk: Kit, open = true): void {
  // wheels: rim, hub, spokes
  for (const s of [-1, 1]) k.at({ x: s * 1.1, y: 0.62, z: -0.05 }, () => {
    k.cyl(0.62, 0.08, PAL.woodDark, { rz: Math.PI / 2 }, 14);
    k.cyl(0.52, 0.09, PLUM_DARK, { rz: Math.PI / 2 }, 14);
    k.cyl(0.11, 0.16, BRASS, { rz: Math.PI / 2 }, 8);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; k.box(0.05, 0.5, 0.04, PAL.woodLight, { y: Math.cos(a) * 0.26, z: Math.sin(a) * 0.26, rx: -a }); }
  });
  k.box(2.3, 0.07, 0.07, PAL.ink, { y: 0.62, z: -0.05 });
  // the body: a box wagon with panelled sides
  k.surf(['planks', { axis: 'x' }], () => k.box(1.95, 0.85, 1.45, PLUM, { y: 1.12 }));
  k.box(2.05, 0.08, 1.55, PAL.woodDark, { y: 0.68 });
  k.box(2.05, 0.08, 1.55, PAL.woodLight, { y: 1.57 });
  for (const s of [-1, 1]) for (const z of [-0.4, 0.4]) k.box(0.02, 0.6, 0.5, TEAL, { x: s * 0.985, y: 1.12, z });
  for (const x of [-0.6, 0, 0.6]) k.box(0.5, 0.6, 0.02, TEAL, { x, y: 1.12, z: -0.73 });
  // the counter front: a drop-down shelf with wares, under a striped flap propped on two poles
  k.box(1.8, 0.06, 0.4, PAL.woodLight, { y: 1.2, z: 0.92 });
  for (const s of [-1, 1]) k.beam(s * 0.8, 1.17, 1.1, s * 0.8, 0.95, 0.74, 0.04, PAL.woodDark);
  // wares on the counter: a bundle of scrolls, a stack of jars, a teapot, a little globe, a fish lure on a card
  for (let i = 0; i < 3; i++) k.cyl(0.035, 0.3, i % 2 ? 0xf1e3c4 : 0xe8d6a8, { x: -0.7 + i * 0.06, y: 1.27, z: 0.92, rz: Math.PI / 2, ry: 0.2 * i }, 6);
  for (let i = 0; i < 3; i++) k.cyl(0.06, 0.12, [0x8ad0ff, 0xb59cff, 0x9ff0b0][i], { x: -0.32 + i * 0.13, y: 1.29, z: 0.95 }, 7);
  k.ball(0.1, 0x3f78c8, { x: 0.2, y: 1.33, z: 0.92 }, 1);
  k.cyl(0.11, 0.015, BRASS, { x: 0.2, y: 1.33, z: 0.92, rx: 0.4 }, 12);
  k.cyl(0.02, 0.06, PAL.woodDark, { x: 0.2, y: 1.24, z: 0.92 }, 5);
  k.ball(0.09, 0xd9453b, { x: 0.52, y: 1.31, z: 0.92, s: [1.2, 0.9, 1] });
  k.cyl(0.02, 0.1, 0xd9453b, { x: 0.62, y: 1.32, z: 0.92, rz: -0.9 }, 5);
  k.box(0.14, 0.18, 0.01, 0xfff6e0, { x: 0.78, y: 1.32, z: 1.0, rx: -0.2 });
  k.ball(0.03, 0xc8d0d8, { x: 0.78, y: 1.32, z: 1.015 });
  // hoops and the patched canvas hood
  const hoops = 4, R = 1.0, top = 1.62;
  for (let i = 0; i < hoops; i++) {
    const z = -0.62 + (i / (hoops - 1)) * 1.24;
    for (let j = 0; j < 8; j++) {
      const a0 = (j / 8) * Math.PI, a1 = ((j + 1) / 8) * Math.PI;
      k.beam(Math.cos(a0) * R, top + Math.sin(a0) * R * 0.85, z, Math.cos(a1) * R, top + Math.sin(a1) * R * 0.85, z, 0.04, PAL.woodDark);
    }
  }
  for (let j = 0; j < 8; j++) {
    const a = ((j + 0.5) / 8) * Math.PI, x = Math.cos(a) * R * 0.98, y = top + Math.sin(a) * R * 0.83;
    const c = j === 2 ? PATCH : j === 6 ? 0xc9b48a : CANVAS;
    k.surf(['fabric', { axis: 'z', scale: 0.7 }], () => k.box(0.42, 0.04, 1.42, c, { x, y, rz: a - Math.PI / 2 }));
  }
  // a stitched patch and the painted name board on the side (two coloured boards; the text lives on the HUD)
  for (const s of [-1, 1]) {
    k.box(0.02, 0.24, 1.1, 0xf2c33a, { x: s * 0.995, y: 1.42, z: 0 });
    k.box(0.022, 0.16, 0.9, PLUM_DARK, { x: s * 0.997, y: 1.42, z: 0 });
  }
  if (open) {
    // the striped flap over the counter
    for (let i = 0; i < 7; i++) {
      const x = -0.9 + (i + 0.5) * (1.8 / 7);
      k.surf(['fabric', { axis: 'z', scale: 0.6 }], () => k.box(1.8 / 7 + 0.004, 0.035, 0.75, i % 2 ? 0xfff3d6 : TEAL, { x, y: 2.05, z: 1.05, rx: -0.42 }));
      k.prism([[-0.12, 0], [0.12, 0], [0, -0.14]], 0.03, i % 2 ? 0xfff3d6 : TEAL, { x, y: 1.88, z: 1.38 });
    }
    for (const s of [-1, 1]) k.box(0.04, 1.65, 0.04, PAL.woodDark, { x: s * 0.86, y: 1.22 + 0.45, z: 1.38, rx: 0.05 });
  }
  // pots and pans hanging along the side
  for (let i = 0; i < 3; i++) {
    const z = -0.45 + i * 0.4;
    k.cyl(0.004, 0.18, PAL.ink, { x: 1.06, y: 1.48, z }, 4);
    k.cyl(0.11 - i * 0.015, 0.07, i === 1 ? 0xb87333 : 0x6f6a64, { x: 1.1, y: 1.34, z, rz: Math.PI / 2 }, 9);
  }
  // the brass lantern on its bracket at the front corner (the glass glows at night)
  k.box(0.04, 0.04, 0.3, PAL.ink, { x: 1.1, y: 2.24, z: 0.73 });
  k.cyl(0.09, 0.05, BRASS, { x: CART_LANTERN.x, y: CART_LANTERN.y + 0.12, z: CART_LANTERN.z }, 6);
  bk.cyl(0.075, 0.17, PAL.lampGlow, { x: CART_LANTERN.x, y: CART_LANTERN.y, z: CART_LANTERN.z }, 6);
  k.cyl(0.09, 0.03, BRASS, { x: CART_LANTERN.x, y: CART_LANTERN.y - 0.1, z: CART_LANTERN.z }, 6);
  // the roof load: a trunk, a rolled rug, a birdcage
  k.surf(['planks', { axis: 'x', scale: 0.5 }], () => k.box(0.6, 0.32, 0.4, 0x7a4a2a, { x: -0.3, y: top + 0.95, z: -0.2 }));
  k.box(0.62, 0.04, 0.42, BRASS, { x: -0.3, y: top + 1.11, z: -0.2 });
  k.cyl(0.11, 0.8, 0xc2533e, { x: 0.25, y: top + 0.92, z: 0.15, rx: Math.PI / 2, ry: 0.3 }, 8);
  k.cyl(0.115, 0.06, 0xf2c33a, { x: 0.25, y: top + 0.92, z: 0.15, rx: Math.PI / 2, ry: 0.3 }, 8);
  k.at({ x: 0.45, y: top + 0.85, z: -0.35 }, () => {
    k.cyl(0.13, 0.03, BRASS, {}, 10);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; k.box(0.01, 0.3, 0.01, BRASS, { x: Math.cos(a) * 0.12, y: 0.15, z: Math.sin(a) * 0.12 }); }
    k.cone(0.14, 0.12, BRASS, { y: 0.36 }, 10);
    k.ball(0.05, 0xf2c33a, { y: 0.12 });
  });
  // the pulling handles (−z) and a prop leg
  for (const s of [-1, 1]) k.beam(s * 0.55, 0.85, -0.75, s * 0.5, 0.95, -CART.handle, 0.06, PAL.wood);
  k.box(1.05, 0.05, 0.05, PAL.wood, { y: 0.95, z: -CART.handle + 0.05 });
  // a step stool and a crate of apples by the counter
  k.surf(['planks', { axis: 'h', scale: 0.6 }], () => k.box(0.42, 0.36, 0.42, PAL.woodLight, { x: -1.45, y: 0.18, z: 0.65, ry: 0.4 }));
  for (let j = 0; j < 4; j++) k.ball(0.07, PAL.apple, { x: -1.5 + (j % 2) * 0.13, y: 0.42, z: 0.6 + Math.floor(j / 2) * 0.13 });
}

/** canvas on the easel (local): centre, size, its lean back (radians about x) */
export const EASEL_CANVAS = Object.freeze({ x: 0, y: 1.22, z: 0.1, w: 0.78, h: 0.58, lean: -0.18 });

/** Odile's easel: three splayed legs, a ledge and a paint box with a palette (the canvas is its own textured quad). */
export function buildEasel(k: Kit): void {
  const C = EASEL_CANVAS;
  for (const s of [-1, 1]) k.box(0.045, 1.7, 0.045, PAL.wood, { x: s * 0.3, y: 0.83, z: 0.12, rz: s * 0.12, rx: C.lean });
  k.box(0.045, 1.7, 0.045, PAL.wood, { y: 0.8, z: -0.32, rx: 0.36 });
  k.box(0.86, 0.04, 0.12, PAL.woodDark, { y: C.y - C.h / 2 - 0.03, z: C.z + 0.08 + Math.sin(-C.lean) * -0.3 });
  k.box(0.06, 0.06, 0.06, PAL.woodDark, { y: C.y + C.h / 2 + 0.05, z: C.z - 0.1 });
  // the canvas's stretcher behind the painted quad
  k.box(C.w + 0.03, C.h + 0.03, 0.025, 0xd8c8a8, { x: C.x, y: C.y, z: C.z - 0.016, rx: C.lean });
  // a paint box on a stool beside it, a palette with blobs, brushes in a jar
  k.at({ x: 0.62, y: 0, z: 0.05 }, () => {
    for (const [x, z] of [[-0.15, -0.15], [0.15, -0.15], [-0.15, 0.15], [0.15, 0.15]]) k.box(0.04, 0.5, 0.04, PAL.woodDark, { x, y: 0.25, z });
    k.box(0.42, 0.04, 0.42, PAL.wood, { y: 0.52 });
    k.box(0.36, 0.1, 0.24, 0x8a5a32, { y: 0.59 });
    k.cyl(0.13, 0.015, 0xd8b48a, { x: 0.02, y: 0.66, z: 0.06 }, 10);
    const blobs = [0xd9453b, 0xf2c33a, 0x3f78c8, 0x5cae4f, 0xffffff];
    blobs.forEach((c, i) => { const a = (i / blobs.length) * Math.PI * 1.6; k.ball(0.022, c, { x: 0.02 + Math.cos(a) * 0.08, y: 0.675, z: 0.06 + Math.sin(a) * 0.08, s: [1, 0.5, 1] }); });
    k.cyl(0.04, 0.1, 0xd8eef4, { x: -0.12, y: 0.69, z: -0.06 }, 7);
    for (let i = 0; i < 3; i++) k.cyl(0.006, 0.2, PAL.woodDark, { x: -0.12 + (i - 1) * 0.015, y: 0.78, z: -0.06, rz: (i - 1) * 0.15 }, 4);
  });
}
