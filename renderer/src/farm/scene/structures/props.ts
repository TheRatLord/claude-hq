/**
 * Small props that dress the hub and the landmarks. Each writes into a Kit at a local transform, so a structure (or
 * the hub dressing) merges any number of them into its own static mesh.
 */
import type { Season } from '../../model/types.ts';
import { PAL } from '../toon.ts';
import type { Kit, Xf } from './kit.ts';

const FLOWERS: Record<Season, number[]> = {
  spring: [PAL.pink, 0xfff2a8, 0xb9a0f0, PAL.white, 0xff9ab8],
  summer: [PAL.red, PAL.yellow, PAL.purple, PAL.orange, PAL.pink],
  autumn: [PAL.orange, 0xc9452f, PAL.yellow, 0x9a4a8a, PAL.leafAutumn],
  winter: [0xc94040, PAL.white, 0x5a8a5a],
};
export const flowerColors = (s: Season): number[] => FLOWERS[s];

export function barrel(k: Kit, t: Xf, color: number = PAL.wood): void {
  k.at(t, () => {
    k.surf(['planks', { scale: 0.9 }], () => {   // staves
      k.cyl(0.36, 0.5, color, { y: 0.25 }, 9, 0.42);
      k.cyl(0.42, 0.5, color, { y: 0.75 }, 9, 0.36);
    });
    for (const y of [0.12, 0.5, 0.88]) k.cyl(y === 0.5 ? 0.44 : 0.39, 0.06, PAL.metalDark, { y }, 9);
    k.cyl(0.34, 0.03, PAL.woodDark, { y: 1.0 }, 9);
  });
}

export function crate(k: Kit, t: Xf, s = 0.6, color: number = PAL.woodLight): void {
  k.at(t, () => {
    k.surf(['planks', { axis: 'h', scale: Math.max(0.6, s * 1.1) }], () => k.box(s, s, s, color, { y: s / 2 }));
    const e = s * 0.12;
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box(e, s + 0.01, e, PAL.wood, { x: x * (s / 2 - e / 2 + 0.005), y: s / 2, z: z * (s / 2 - e / 2 + 0.005) });
    k.box(s + 0.02, e * 0.8, s + 0.02, PAL.wood, { y: s * 0.5 });
  });
}

export function hayBale(k: Kit, t: Xf, round = false): void {
  k.at(t, () => {
    if (round) {
      k.cyl(0.6, 0.9, PAL.hay, { y: 0.6, rz: Math.PI / 2 }, 10);
      k.cyl(0.45, 0.92, 0xd4b458, { y: 0.6, rz: Math.PI / 2 }, 10);
    } else {
      k.box(1.1, 0.55, 0.65, PAL.hay, { y: 0.28 });
      k.box(1.12, 0.06, 0.67, 0xc9a54a, { y: 0.4 });
      k.box(0.05, 0.57, 0.67, 0x9a7a3a, { x: -0.25, y: 0.28 });
      k.box(0.05, 0.57, 0.67, 0x9a7a3a, { x: 0.25, y: 0.28 });
    }
  });
}

/** Park bench, facing +z, seat top at 0.48. */
export function bench(k: Kit, t: Xf, w = 1.8): void {
  k.at(t, () => {
    for (const x of [-w / 2 + 0.15, w / 2 - 0.15]) {
      k.box(0.1, 0.45, 0.5, PAL.metalDark, { x, y: 0.23 });
      k.box(0.1, 0.55, 0.08, PAL.metalDark, { x, y: 0.73, z: -0.24, rx: -0.15 });
      k.box(0.1, 0.06, 0.5, PAL.metalDark, { x, y: 0.62, z: 0.02 });
    }
    for (let i = 0; i < 3; i++) k.box(w, 0.06, 0.15, i % 2 ? PAL.plank : PAL.woodLight, { y: 0.47, z: -0.17 + i * 0.17 });
    for (let i = 0; i < 2; i++) k.box(w, 0.13, 0.05, PAL.plank, { y: 0.72 + i * 0.18, z: -0.27 - i * 0.03, rx: -0.15 });
  });
}

/** Log bench (campfire), along x. */
export function logBench(k: Kit, t: Xf, w = 2.2): void {
  k.at(t, () => {
    k.cyl(0.26, w, PAL.trunk, { y: 0.3, rz: Math.PI / 2 }, 7);
    k.box(w - 0.1, 0.06, 0.34, PAL.woodLight, { y: 0.52 });
    k.surf(['logs', { axis: 'y' }], () => {
      k.cyl(0.2, 0.05, PAL.woodLight, { x: w / 2, y: 0.3, rz: Math.PI / 2 }, 7);
      k.cyl(0.2, 0.05, PAL.woodLight, { x: -w / 2, y: 0.3, rz: Math.PI / 2 }, 7);
    });
    for (const x of [-w / 2 + 0.3, w / 2 - 0.3]) k.box(0.14, 0.2, 0.5, PAL.bark, { x, y: 0.1 });
  });
}

/** Lamp post: returns the lamp head height. The head glass is emitted as 'glow'. */
export function lampPost(k: Kit, t: Xf, h = 2.9): number {
  k.at(t, () => {
    k.cyl(0.2, 0.25, PAL.stone, { y: 0.12 }, 6, 0.16);
    k.cyl(0.07, h - 0.3, PAL.ink, { y: 0.25 + (h - 0.3) / 2 }, 6, 0.06);
    k.cyl(0.1, 0.1, PAL.ink, { y: 0.9 }, 6);
    k.box(0.5, 0.05, 0.05, PAL.ink, { y: h - 0.15, x: 0.12, rz: 0.1 });
    k.at({ y: h }, () => {
      k.cyl(0.15, 0.08, PAL.ink, { y: -0.12 }, 4, 0.19);
      k.cyl(0.16, 0.36, PAL.lampGlow, { y: 0.1, ry: Math.PI / 4 }, 4, 0.2, 'glow');
      k.cyl(0.25, 0.14, PAL.ink, { y: 0.34, ry: Math.PI / 4 }, 4, 0.05);
      k.ball(0.05, PAL.ink, { y: 0.44 });
    });
  });
  return h + 0.1;
}

export function flowerPot(k: Kit, t: Xf, season: Season, seed = 0, big = false): void {
  const fl = FLOWERS[season];
  const s = big ? 1.4 : 1;
  k.at(t, () => {
    k.cyl(0.2 * s, 0.34 * s, PAL.rust, { y: 0.17 * s }, 7, 0.26 * s);
    k.cyl(0.28 * s, 0.07 * s, 0xb86a44, { y: 0.34 * s }, 7);
    k.cyl(0.23 * s, 0.03, PAL.soil, { y: 0.37 * s }, 7);
    if (season === 'winter') { k.cone(0.2 * s, 0.5 * s, PAL.pine, { y: 0.62 * s }, 6); k.ball(0.04, PAL.red, { y: 0.6 * s, x: 0.08 }); return; }
    k.ball(0.2 * s, PAL.leafDark, { y: 0.48 * s }, 0);
    for (let i = 0; i < 5; i++) {
      const a = i * 1.3 + seed, r = 0.12 * s;
      k.ball(0.07 * s, fl[(i + seed) % fl.length], { x: Math.cos(a) * r, y: 0.6 * s + (i % 2) * 0.05, z: Math.sin(a) * r });
    }
  });
}

/** Window flower box, along x, width w. */
export function flowerBox(k: Kit, t: Xf, w: number, season: Season, seed = 0): void {
  const fl = FLOWERS[season];
  k.at(t, () => {
    k.box(w, 0.22, 0.28, PAL.woodDark, { y: 0 });
    k.box(w + 0.06, 0.05, 0.32, PAL.wood, { y: 0.11 });
    const n = Math.max(3, Math.round(w / 0.22));
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + 0.12 + (i * (w - 0.24)) / (n - 1);
      if (season === 'winter') { k.cone(0.07, 0.2, PAL.pine, { x, y: 0.22 }, 5); continue; }
      k.ball(0.09, i % 2 ? PAL.leaf : PAL.leafDark, { x, y: 0.18, z: 0.02 });
      k.ball(0.065, fl[(i * 3 + seed) % fl.length], { x: x + 0.02, y: 0.28 + (i % 3) * 0.03, z: 0.06 });
    }
  });
}

/** Fence run from (ax, az) to (bx, bz) in the kit's local space, on ground height fn. */
export function fenceRun(k: Kit, ax: number, az: number, bx: number, bz: number, gy: (x: number, z: number) => number, color: number = PAL.wallWhite, gap = 1.3): void {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.round(len / gap));
  const yaw = Math.atan2(bx - ax, bz - az);
  for (let i = 0; i <= n; i++) {
    const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n, y = gy(x, z);
    k.box(0.12, 0.85, 0.12, color, { x, y: y + 0.4, z, ry: yaw });
    k.cone(0.09, 0.14, color, { x, y: y + 0.88, z, ry: yaw + Math.PI / 4 }, 4);
    if (i < n) {
      const x2 = ax + ((bx - ax) * (i + 1)) / n, z2 = az + ((bz - az) * (i + 1)) / n, y2 = gy(x2, z2);
      for (const h of [0.35, 0.65]) k.beam(x, y + h, z, x2, y2 + h, z2, 0.07, color, 'solid', 0.1);
    }
  }
}

export function picnicTable(k: Kit, t: Xf): void {
  k.at(t, () => {
    for (let i = 0; i < 4; i++) k.box(0.2, 0.05, 1.9, i % 2 ? PAL.plank : PAL.woodLight, { x: -0.3 + i * 0.2, y: 0.75 });
    for (const s of [-1, 1]) {
      k.box(0.3, 0.05, 1.9, PAL.plank, { x: s * 0.72, y: 0.44 });
      k.beam(s * 0.1, 0.72, 0.7, s * 0.72, 0, 0.7, 0.08, PAL.wood);
      k.beam(s * 0.1, 0.72, -0.7, s * 0.72, 0, -0.7, 0.08, PAL.wood);
    }
    k.box(1.6, 0.06, 0.08, PAL.wood, { y: 0.42, z: 0.7 });
    k.box(1.6, 0.06, 0.08, PAL.wood, { y: 0.42, z: -0.7 });
    // a checked cloth and a pie
    k.box(0.5, 0.01, 0.5, PAL.red, { y: 0.78, z: 0.2, ry: 0.3 });
    k.cyl(0.14, 0.06, PAL.woodLight, { y: 0.81, z: 0.2 }, 8);
    k.cyl(0.13, 0.02, 0xc0462f, { y: 0.845, z: 0.2 }, 8);
    k.cyl(0.05, 0.1, 0xdde8f0, { y: 0.83, x: -0.3, z: -0.4 }, 6);
  });
}

/** Farm cart, facing +z. */
export function cart(k: Kit, t: Xf, load: 'hay' | 'pumpkins' | 'crates' = 'hay'): void {
  k.at(t, () => {
    k.surf(['planks', { axis: 'z', variant: 1 }], () => k.box(1.4, 0.12, 2.2, PAL.plank, { y: 0.75 }));
    for (const s of [-1, 1]) {
      k.surf(['planks', { axis: 'z', variant: 1 }], () => k.box(0.08, 0.4, 2.2, PAL.wood, { x: s * 0.68, y: 0.98 }));
      k.box(0.12, 0.08, 0.12, PAL.woodDark, { x: s * 0.68, y: 1.2, z: 1.05 });
      k.at({ x: s * 0.8, y: 0.55, z: -0.3 }, () => {
        k.surf(['planks', { axis: 'x', scale: 0.8 }], () => {
          k.cyl(0.55, 0.1, PAL.woodDark, { rz: Math.PI / 2 }, 10);
          k.cyl(0.47, 0.12, PAL.wood, { rz: Math.PI / 2 }, 10);
        });
        k.cyl(0.12, 0.2, PAL.metalDark, { rz: Math.PI / 2 }, 6);
      });
    }
    k.surf(['planks', { axis: 'x', variant: 1 }], () => k.box(1.4, 0.4, 0.08, PAL.wood, { y: 0.98, z: -1.08 }));
    k.beam(-0.4, 0.75, 1.1, -0.35, 0.1, 2.3, 0.08, PAL.woodDark);
    k.beam(0.4, 0.75, 1.1, 0.35, 0.1, 2.3, 0.08, PAL.woodDark);
    k.box(0.15, 0.4, 0.15, PAL.woodDark, { y: 0.35, z: 0.9 });
    if (load === 'hay') { k.box(1.2, 0.5, 1.9, PAL.hay, { y: 1.1 }); k.blob(0.55, PAL.hay, { y: 1.45, z: 0.3, s: [1.1, 0.6, 1.4] }); }
    if (load === 'pumpkins') for (let i = 0; i < 6; i++) k.ball(0.28, PAL.pumpkin, { x: (i % 2) * 0.55 - 0.27, y: 1.05, z: -0.7 + Math.floor(i / 2) * 0.6, s: [1, 0.75, 1] }, 1);
    if (load === 'crates') { crate(k, { x: -0.3, y: 0.8, z: -0.5, ry: 0.1 }, 0.55); crate(k, { x: 0.3, y: 0.8, z: 0.2, ry: -0.2 }, 0.55); crate(k, { x: -0.2, y: 1.35, z: -0.3, ry: 0.4 }, 0.5); }
  });
}

export function wateringCan(k: Kit, t: Xf, color: number = PAL.roofGreen): void {
  k.at(t, () => {
    k.cyl(0.14, 0.3, color, { y: 0.15 }, 8);
    k.beam(0.1, 0.1, 0, 0.36, 0.34, 0, 0.05, color);
    k.cyl(0.05, 0.05, color, { x: 0.37, y: 0.35, rz: -0.8 }, 6, 0.07);
    k.at({ y: 0.34 }, () => { k.beam(-0.12, 0, 0, -0.06, 0.12, 0, 0.035, color); k.beam(-0.06, 0.12, 0, 0.08, 0.12, 0, 0.035, color); k.beam(0.08, 0.12, 0, 0.12, 0, 0, 0.035, color); });
  });
}

export function bucket(k: Kit, t: Xf, water = false): void {
  k.at(t, () => {
    k.cyl(0.14, 0.28, PAL.woodLight, { y: 0.14 }, 8, 0.18);
    k.cyl(0.19, 0.04, PAL.metalDark, { y: 0.24 }, 8);
    k.cyl(0.15, 0.04, PAL.metalDark, { y: 0.06 }, 8);
    if (water) k.cyl(0.165, 0.02, PAL.water, { y: 0.24 }, 8);
  });
}

/** Stacked firewood pile along x, facing +z. */
export function firewood(k: Kit, t: Xf, w = 1.6, rows = 4): void {
  k.at(t, () => {
    k.box(w + 0.2, 0.08, 0.7, PAL.woodDark, { y: 0.04 });
    for (let r = 0; r < rows; r++) {
      const n = Math.floor(w / 0.22) - (r % 2);
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + 0.11 + i * 0.22 + (r % 2) * 0.11;
        k.cyl(0.1, 0.62, PAL.trunk, { x, y: 0.18 + r * 0.19, rx: Math.PI / 2 }, 6);
        k.cyl(0.075, 0.625, PAL.woodLight, { x, y: 0.18 + r * 0.19, rx: Math.PI / 2 }, 6);
      }
    }
    k.box(0.08, 0.3 + rows * 0.19, 0.08, PAL.woodDark, { x: -w / 2 - 0.05, y: (0.3 + rows * 0.19) / 2 });
    k.box(0.08, 0.3 + rows * 0.19, 0.08, PAL.woodDark, { x: w / 2 + 0.05, y: (0.3 + rows * 0.19) / 2 });
  });
}

/** Chopping block with an axe. */
export function choppingBlock(k: Kit, t: Xf): void {
  k.at(t, () => {
    k.cyl(0.3, 0.5, PAL.trunk, { y: 0.25 }, 8);
    k.surf(['logs', { axis: 'y' }], () => k.cyl(0.26, 0.02, PAL.woodLight, { y: 0.51 }, 8));
    k.beam(0.05, 0.52, 0, 0.35, 1.05, 0.1, 0.05, PAL.woodLight);
    k.box(0.05, 0.2, 0.2, PAL.metal, { x: 0.05, y: 0.58, z: 0, rz: -0.5 });
  });
}

export function stool(k: Kit, t: Xf): void {
  k.at(t, () => {
    k.cyl(0.2, 0.06, PAL.woodLight, { y: 0.45 }, 8);
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; k.beam(Math.cos(a) * 0.12, 0.44, Math.sin(a) * 0.12, Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2, 0.05, PAL.wood); }
  });
}

/** Stone (for rings, walls). */
export function stone(k: Kit, t: Xf, r: number, color: number = PAL.stone): void { k.blob(r, color, t); }

/** Sack of grain/seed. */
export function sack(k: Kit, t: Xf): void {
  k.at(t, () => {
    k.blob(0.28, PAL.cloth, { y: 0.26, s: [1, 1.1, 0.85] });
    k.cyl(0.08, 0.14, PAL.cloth, { y: 0.56 }, 6, 0.12);
    k.cyl(0.09, 0.04, PAL.woodDark, { y: 0.52 }, 6);
  });
}

/** Pumpkin pile (autumn dressing). */
export function pumpkin(k: Kit, t: Xf, r = 0.25): void {
  k.at(t, () => {
    k.ball(r, PAL.pumpkin, { y: r * 0.75, s: [1, 0.72, 1] }, 1);
    k.cyl(0.03, 0.12, PAL.leafDark, { y: r * 1.35 }, 5);
  });
}

/** Snow cap on a flat-ish top (winter). */
export function snowCap(k: Kit, t: Xf, w: number, d: number): void {
  k.box(w, 0.12, d, PAL.snow, t);
}
