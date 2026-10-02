/**
 * Yard decor, the General store cart and the yard's fence, built into Kits (scene/structures/kit.ts) so a whole yard
 * merges into one solid mesh + one "bulbs" mesh (lamp glass, fairy lights, a lantern's face: unlit, brightened at
 * night). Every model is built at the origin facing +z and reports its local light sources and swinging bits.
 */
import * as THREE from 'three';
import type { Season } from '../../model/types.ts';
import { PAL } from '../toon.ts';
import type { Kit } from '../structures/kit.ts';
import { bench, fenceRun } from '../structures/props.ts';
import { flowerColors } from '../structures/props.ts';

/** a light the piece gives after dark (local coordinates) */
export interface DecorLight { x: number; y: number; z: number; kind: 'lamp' | 'candle' | 'fairy' }
/** a hanging bit that swings in the wind (chime tubes): pivot, length */
export interface Swinger { x: number; y: number; z: number; len: number }
export interface DecorOut { lights: DecorLight[]; swing: Swinger[] }

const GOLD = 0xf2c33a, GOLD_DARK = 0xc9962a, TARTAN = 0xc95f4a;
const HATS = [PAL.red, PAL.blue, PAL.green];

/** footprint radius per decor id (colliders, spacing) */
export const DECOR_R: Readonly<Record<string, number>> = Object.freeze({
  planter: 0.5, flamingo: 0.25, gnome: 0.3, birdhouse: 0.25, chime: 0.3, petbed: 0.55, bench: 0.85, birdbath: 0.45,
  scarecrow: 0.4, pumpkin: 0.35, snowman: 0.45, sapling: 0.5, parasol: 0.8, lamppost: 0.25, lights: 0.95, topiary: 0.55, goldgnome: 0.45,
  // the villagers' pieces (model/friends.ts, 6 hearts) and their keepsake portraits (10 hearts)
  postbox: 0.3, crates: 0.6, millstone: 0.6, prizepumpkin: 0.6, tent: 0.85, vane: 0.3,
  // the first-run welcome's present (model/onboarding.ts)
  welcome: 0.35,
  'keep-posy': 0.4, 'keep-bram': 0.4, 'keep-hazel': 0.4, 'keep-marigold': 0.4, 'keep-fern': 0.4, 'keep-nimbus': 0.4,
  // the stamp book's trophies (model/stamps.ts)
  'trophy-bronze': 0.35, 'trophy-silver': 0.35, 'trophy-gold': 0.4,
  // the grotto's hidden chest (scene/grotto)
  geode: 0.4,
});

/** keepsake portraits: the villager's body colour, role hat colour and the canvas backdrop */
const KEEP: Readonly<Record<string, readonly [number, number, number]>> = {
  posy: [0x3d9fa8, 0x2f3f6e, 0xf6e0c0], bram: [0xe6c547, 0x6fcf92, 0xd8ecf6], hazel: [0xd9c08a, 0xf1ece0, 0xb8d8a8],
  marigold: [0x9b5a8c, 0x2a2530, 0xf6d8a0], fern: [0x5d8f45, 0xb89a62, 0xcfe6f2], nimbus: [0x6fb7e0, 0xf2c230, 0x3a4a78],
};

/** A painted portrait of a villager (a Clawd in their colours and hat) on a little easel: the 10-heart keepsake. */
function keepsake(k: Kit, who: string): void {
  const [body, hat, bg] = KEEP[who] ?? KEEP.posy;
  const lean = -0.16;
  for (const s of [-1, 1]) k.box(0.05, 1.25, 0.05, PAL.woodDark, { x: s * 0.26, y: 0.6, z: 0.05, rz: s * 0.1, rx: lean });
  k.box(0.05, 1.15, 0.05, PAL.woodDark, { y: 0.55, z: -0.25, rx: 0.32 });
  k.box(0.7, 0.05, 0.1, PAL.wood, { y: 0.52, z: 0.12 });
  // the canvas in a gilt frame, leaning back on the easel; everything painted is a hair proud of the canvas
  const cz = 0.1, cy = 0.9;
  const at = (x: number, y: number, dz = 0) => ({ x, y: cy + y, z: cz + 0.045 + dz - y * Math.sin(-lean), rx: lean });
  k.box(0.68, 0.62, 0.05, GOLD_DARK, { y: cy, z: cz, rx: lean });
  k.box(0.58, 0.52, 0.05, bg, at(0, 0, -0.03));
  k.box(0.3, 0.22, 0.02, body, at(0, -0.07));
  for (const s of [-1, 1]) k.box(0.06, 0.05, 0.02, body, at(s * 0.18, -0.06));
  for (const s of [-1, 1]) k.box(0.035, 0.06, 0.02, PAL.ink, at(s * 0.07, -0.04, 0.008));
  for (const x of [-0.1, -0.035, 0.035, 0.1]) k.box(0.04, 0.06, 0.02, body, at(x, -0.21));
  k.box(0.34, 0.07, 0.02, hat, at(0, 0.07));
  k.box(0.22, 0.08, 0.02, hat, at(0, 0.13));
  k.box(0.58, 0.05, 0.02, 0x6fae4f, at(0, -0.235, -0.005));
}

/** metal, shade per stamp-book trophy tier */
const CUP: Readonly<Record<string, readonly [number, number]>> = {
  bronze: [0xc07a3a, 0x8a5226], silver: [0xd4dbe2, 0x98a4b0], gold: [GOLD, GOLD_DARK],
};

/** A stamp-book trophy: a loving cup with two handles on a wooden plinth, a red ink stamp on the plinth's face. */
function trophy(k: Kit, tier: string): void {
  const [metal, dark] = CUP[tier] ?? CUP.bronze;
  const big = tier === 'gold' ? 1.15 : 1;
  k.surf(['planks', { scale: 0.5 }], () => k.box(0.44 * big, 0.34, 0.44 * big, PAL.woodDark, { y: 0.17 }));
  k.box(0.5 * big, 0.04, 0.5 * big, PAL.wood, { y: 0.36 });
  // the inked stamp on the front of the plinth: a square of red with a cream centre
  k.box(0.18, 0.18, 0.012, 0xc8402e, { y: 0.18, z: 0.22 * big + 0.004 });
  k.box(0.12, 0.12, 0.012, 0xf3e6c8, { y: 0.18, z: 0.22 * big + 0.01 });
  k.ball(0.035, 0xc8402e, { y: 0.18, z: 0.22 * big + 0.016, s: [1, 1, 0.4] });
  // foot, stem, knop, bowl, rim
  k.cyl(0.13 * big, 0.05, dark, { y: 0.405 }, 10, 0.1 * big);
  k.cyl(0.035 * big, 0.14, metal, { y: 0.5 }, 8);
  k.ball(0.055 * big, metal, { y: 0.57 });
  k.cyl(0.06 * big, 0.26 * big, metal, { y: 0.6 + 0.13 * big }, 12, 0.17 * big);
  k.cyl(0.17 * big, 0.03, dark, { y: 0.6 + 0.26 * big }, 12);
  // handles: three short beams each side
  for (const s of [-1, 1]) {
    const x0 = s * 0.12 * big, x1 = s * 0.24 * big, y0 = 0.62 + 0.05 * big, y1 = 0.6 + 0.22 * big;
    k.beam(x0, y1, 0, x1, y1, 0, 0.03, metal);
    k.beam(x1, y1, 0, x1, y0, 0, 0.03, metal);
    k.beam(x1, y0, 0, x0 * 0.7, y0 - 0.04, 0, 0.03, metal);
  }
  if (tier === 'gold') k.cone(0.05, 0.08, GOLD, { y: 0.6 + 0.3 * big }, 5);
}

function gnome(k: Kit, hat: number, gold: boolean): void {
  const tunic = gold ? GOLD : 0x3f78c8, skin = gold ? GOLD : PAL.skin, beard = gold ? 0xffe9a0 : PAL.white, boot = gold ? GOLD_DARK : PAL.woodDark;
  for (const x of [-0.08, 0.08]) k.box(0.11, 0.08, 0.17, boot, { x, y: 0.04, z: 0.02 });
  k.cyl(0.13, 0.32, tunic, { y: 0.24 }, 7, 0.17);
  k.cyl(0.18, 0.05, gold ? GOLD_DARK : PAL.woodDark, { y: 0.36 }, 7);
  for (const s of [-1, 1]) k.ball(0.055, skin, { x: s * 0.18, y: 0.3, z: 0.05 });
  k.ball(0.12, skin, { y: 0.5 }, 1);
  k.cone(0.12, 0.22, beard, { y: 0.4, z: 0.07, rx: Math.PI }, 6);
  k.ball(0.04, gold ? GOLD_DARK : 0xf09a8a, { y: 0.51, z: 0.12 });
  k.cyl(0.14, 0.04, gold ? GOLD_DARK : hat, { y: 0.58 }, 8);
  k.cone(0.12, 0.34, gold ? GOLD : hat, { y: 0.76, rx: -0.15 }, 7);
}

function scarecrowHat(k: Kit, style: number): void {
  if (style === 1) { // top hat
    k.cyl(0.26, 0.03, PAL.ink, { y: 0 }, 10);
    k.cyl(0.15, 0.32, PAL.ink, { y: 0.17 }, 10);
    k.cyl(0.155, 0.06, PAL.red, { y: 0.06 }, 10);
  } else if (style === 2) { // witch hat
    k.cyl(0.32, 0.03, 0x4a2f6a, { y: 0 }, 10);
    k.cone(0.17, 0.45, 0x5a3a7a, { y: 0.24, rx: -0.2, z: -0.03 }, 8);
    k.cyl(0.17, 0.05, PAL.orange, { y: 0.04 }, 8);
  } else { // straw hat
    k.cyl(0.34, 0.03, PAL.hay, { y: 0 }, 10);
    k.cyl(0.17, 0.16, PAL.hay, { y: 0.08 }, 10, 0.15);
    k.cyl(0.175, 0.04, PAL.red, { y: 0.03 }, 10);
  }
}

/**
 * Build one decor piece into `k` (solid) and `bk` (bulbs), at the Kit's current transform. `style` picks the
 * variant (hat, colours), `season` dresses the plants.
 */
export function buildDecor(k: Kit, bk: Kit, id: string, style: number, season: Season): DecorOut {
  const out: DecorOut = { lights: [], swing: [] };
  const fl = flowerColors(season);
  switch (id) {
    case 'planter': {
      k.surf(['planks', { scale: 0.8 }], () => k.cyl(0.4, 0.42, PAL.wood, { y: 0.21 }, 10, 0.46));
      for (const y of [0.08, 0.34]) k.cyl(y > 0.2 ? 0.465 : 0.41, 0.05, PAL.metalDark, { y }, 10);
      k.cyl(0.42, 0.04, PAL.soil, { y: 0.41 }, 10);
      if (season === 'winter') {
        k.cone(0.26, 0.6, PAL.pine, { y: 0.72 }, 7);
        for (let i = 0; i < 5; i++) { const a = i * 1.26; k.ball(0.04, PAL.red, { x: Math.cos(a) * 0.17, y: 0.6 + (i % 2) * 0.12, z: Math.sin(a) * 0.17 }); }
        break;
      }
      const pals = [[PAL.red, PAL.orange, PAL.yellow], [PAL.purple, 0x6a8ad8, PAL.white], [PAL.sunflower, PAL.sunflower, PAL.orange]];
      const pal = style === 0 ? fl : pals[style] ?? fl;
      for (let i = 0; i < 6; i++) { const a = i * 1.05; k.ball(0.15, i % 2 ? PAL.leaf : PAL.leafDark, { x: Math.cos(a) * 0.22, y: 0.5, z: Math.sin(a) * 0.22, s: [1, 0.8, 1] }); }
      if (style === 2) {
        for (let i = 0; i < 3; i++) {
          const a = i * 2.1 + 0.4, x = Math.cos(a) * 0.15, z = Math.sin(a) * 0.15, h = 0.85 + i * 0.12;
          k.cyl(0.025, h, PAL.leafDark, { x, y: 0.42 + h / 2, z }, 5);
          k.cyl(0.15, 0.04, PAL.sunflower, { x, y: 0.42 + h, z: z + 0.03, rx: 1.2 }, 9);
          k.cyl(0.07, 0.05, PAL.sunflowerCore, { x, y: 0.42 + h + 0.01, z: z + 0.05, rx: 1.2 }, 8);
        }
      } else {
        for (let i = 0; i < 9; i++) { const a = i * 0.7 + style, r = 0.1 + (i % 3) * 0.08; k.ball(0.075, pal[i % pal.length], { x: Math.cos(a) * r, y: 0.62 + (i % 2) * 0.06, z: Math.sin(a) * r }); }
      }
      break;
    }
    case 'flamingo': {
      for (const x of [-0.05, 0.05]) k.rod(x, 0, 0.0, x * 1.2, 0.55, 0.0, 0.016, 0xe07a98, 4);
      k.ball(0.17, PAL.pink, { y: 0.66, z: -0.03, s: [0.75, 0.62, 1.25] }, 1);
      k.cone(0.09, 0.2, 0xe07a98, { y: 0.7, z: -0.25, rx: -1.9 }, 5);
      k.rod(0, 0.7, 0.12, 0, 0.95, 0.16, 0.032, PAL.pink, 6);
      k.rod(0, 0.95, 0.16, 0, 1.03, 0.07, 0.032, PAL.pink, 6);
      k.ball(0.065, PAL.pink, { y: 1.04, z: 0.08 }, 1);
      k.cone(0.03, 0.12, PAL.ink, { y: 1.0, z: 0.17, rx: 2.0 }, 5);
      k.ball(0.012, PAL.ink, { x: 0.05, y: 1.06, z: 0.1 });
      k.ball(0.012, PAL.ink, { x: -0.05, y: 1.06, z: 0.1 });
      break;
    }
    case 'gnome': gnome(k, HATS[style] ?? PAL.red, false); break;
    case 'goldgnome': {
      k.surf(['fieldstone', { axis: 'h' }], () => k.box(0.7, 0.3, 0.7, PAL.stone, { y: 0.15 }));
      k.box(0.76, 0.05, 0.76, 0xcfc8ba, { y: 0.32 });
      k.at({ y: 0.345, s: 1.35 }, () => gnome(k, GOLD, true));
      break;
    }
    case 'birdhouse': {
      k.box(0.09, 1.35, 0.09, PAL.woodDark, { y: 0.675 });
      k.box(0.3, 0.04, 0.3, PAL.wood, { y: 1.36 });
      k.surf(['planks', { axis: 'y', scale: 0.4 }], () => k.box(0.26, 0.28, 0.24, 0x5a8fd6, { y: 1.52 }));
      k.prism([[-0.2, 0], [0.2, 0], [0, 0.17]], 0.32, PAL.roofRed, { y: 1.66, z: -0.16 });
      k.cyl(0.045, 0.02, PAL.ink, { y: 1.55, z: 0.12, rx: Math.PI / 2 }, 8);
      k.rod(0, 1.47, 0.12, 0, 1.47, 0.2, 0.012, PAL.woodLight, 4);
      k.ball(0.05, PAL.yellow, { y: 1.82, z: 0.02, s: [1, 0.9, 1.25] });
      k.ball(0.035, PAL.yellow, { y: 1.88, z: 0.07 });
      k.cone(0.012, 0.035, PAL.orange, { y: 1.88, z: 0.11, rx: Math.PI / 2 }, 4);
      break;
    }
    case 'chime': {
      k.cyl(0.14, 0.06, PAL.stone, { y: 0.03 }, 6);
      k.cyl(0.03, 1.7, PAL.ink, { y: 0.88 }, 6);
      // the shepherd's crook
      const pts: [number, number][] = [[0, 1.73], [0.06, 1.86], [0.18, 1.9], [0.3, 1.85], [0.34, 1.74]];
      for (let i = 0; i < pts.length - 1; i++) k.rod(pts[i][0], pts[i][1], 0, pts[i + 1][0], pts[i + 1][1], 0, 0.022, PAL.ink, 5);
      k.rod(0.34, 1.74, 0, 0.34, 1.6, 0, 0.008, PAL.ink, 3);
      k.cyl(0.12, 0.03, PAL.woodLight, { x: 0.34, y: 1.58 }, 8);
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; out.swing.push({ x: 0.34 + Math.cos(a) * 0.08, y: 1.54, z: Math.sin(a) * 0.08, len: 0.26 + (i % 3) * 0.07 }); }
      k.rod(0.34, 1.56, 0, 0.34, 1.3, 0, 0.006, PAL.cloth, 3);
      k.box(0.05, 0.08, 0.005, PAL.woodLight, { x: 0.34, y: 1.25 });
      break;
    }
    case 'petbed': {
      k.surf(['fabric', { scale: 0.4 }], () => {
        k.cyl(0.55, 0.16, TARTAN, { y: 0.08, s: [1, 1, 0.75] }, 12);
        k.cyl(0.42, 0.06, 0xe8d6b8, { y: 0.17, s: [1, 1, 0.72] }, 12);
      });
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; if (Math.sin(a) > 0.75) continue; k.ball(0.11, i % 2 ? TARTAN : 0x2f5a3a, { x: Math.cos(a) * 0.5, y: 0.2, z: Math.sin(a) * 0.37, s: [1.2, 0.9, 1.2] }); }
      k.box(0.2, 0.04, 0.05, PAL.white, { x: 0.12, y: 0.215, z: 0.08, ry: 0.5 });
      for (const s of [-1, 1]) for (const t of [-1, 1]) k.ball(0.03, PAL.white, { x: 0.12 + Math.cos(0.5) * s * 0.1 + Math.sin(0.5) * t * 0.025, y: 0.215, z: 0.08 - Math.sin(0.5) * s * 0.1 + Math.cos(0.5) * t * 0.025 });
      break;
    }
    case 'bench': bench(k, { z: 0.1 }, 1.6); break;
    case 'birdbath': {
      k.cyl(0.24, 0.08, PAL.stone, { y: 0.04 }, 8);
      k.cyl(0.1, 0.62, PAL.stone, { y: 0.39 }, 7, 0.13);
      k.cyl(0.42, 0.13, PAL.stone, { y: 0.76 }, 10, 0.24);
      k.cyl(0.37, 0.02, PAL.water, { y: 0.83 }, 10);
      k.ball(0.06, 0x8a6a4a, { x: 0.32, y: 0.9, z: 0.08, s: [1, 0.85, 1.3], ry: 1.2 });
      k.ball(0.04, 0x8a6a4a, { x: 0.36, y: 0.95, z: 0.1 });
      k.cone(0.012, 0.03, PAL.orange, { x: 0.39, y: 0.95, z: 0.12, rz: -Math.PI / 2 }, 4);
      break;
    }
    case 'scarecrow': {
      k.box(0.08, 1.45, 0.08, PAL.woodDark, { y: 0.72 });
      k.box(1.0, 0.07, 0.07, PAL.woodDark, { y: 1.15 });
      k.surf(['fabric', { scale: 0.5 }], () => k.box(0.42, 0.5, 0.24, style === 2 ? 0x6a8a3a : 0x5a7fd6, { y: 1.05 }));
      for (const s of [-1, 1]) {
        k.box(0.32, 0.14, 0.15, style === 2 ? 0x6a8a3a : 0x5a7fd6, { x: s * 0.36, y: 1.15 });
        k.cone(0.06, 0.16, PAL.hay, { x: s * 0.56, y: 1.15, rz: s * Math.PI / 2 }, 5);
      }
      k.cone(0.07, 0.16, PAL.hay, { y: 0.74, rx: Math.PI }, 5);
      k.box(0.14, 0.14, 0.02, PAL.red, { x: 0.1, y: 1.12, z: 0.125 });
      k.ball(0.19, 0xe8d6a8, { y: 1.47 }, 1);
      k.box(0.05, 0.05, 0.02, PAL.ink, { x: -0.07, y: 1.5, z: 0.17 });
      k.box(0.05, 0.05, 0.02, PAL.ink, { x: 0.07, y: 1.5, z: 0.17 });
      k.box(0.12, 0.02, 0.02, PAL.ink, { y: 1.4, z: 0.175 });
      k.at({ y: 1.6 }, () => scarecrowHat(k, style));
      break;
    }
    case 'pumpkin': {
      // one ribbed gourd (ribs: darker lobes just proud of the body), a curly stem
      k.ball(0.33, PAL.pumpkin, { y: 0.25, s: [1, 0.76, 1] }, 1);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + 0.2; if (Math.abs(Math.sin(a) - 1) < 0.3) continue; k.ball(0.17, 0xd8702a, { x: Math.cos(a) * 0.2, y: 0.25, z: Math.sin(a) * 0.2, s: [0.7, 1.45, 0.7], ry: -a }, 1); }
      k.cyl(0.035, 0.14, 0x5a7a2a, { y: 0.52, rz: 0.25 }, 5);
      // the carved face glows (eyes, nose, a toothy grin), set into the front of the gourd
      bk.prism([[-0.055, 0], [0.055, 0], [0, 0.08]], 0.05, PAL.fire, { x: -0.11, y: 0.29, z: 0.27, ry: -0.35 });
      bk.prism([[-0.055, 0], [0.055, 0], [0, 0.08]], 0.05, PAL.fire, { x: 0.11, y: 0.29, z: 0.27, ry: 0.35 });
      bk.prism([[-0.028, 0], [0.028, 0], [0, 0.045]], 0.05, PAL.fire, { y: 0.235, z: 0.3 });
      bk.box(0.2, 0.05, 0.05, PAL.fire, { y: 0.16, z: 0.28 });
      out.lights.push({ x: 0, y: 0.3, z: 0.42, kind: 'candle' });
      break;
    }
    case 'snowman': {
      k.ball(0.32, PAL.snow, { y: 0.28 }, 1);
      k.ball(0.23, PAL.snow, { y: 0.7 }, 1);
      k.ball(0.17, PAL.snow, { y: 1.03 }, 1);
      k.cone(0.035, 0.18, PAL.orange, { y: 1.03, z: 0.22, rx: Math.PI / 2 }, 5);
      for (const s of [-1, 1]) k.ball(0.025, PAL.ink, { x: s * 0.06, y: 1.08, z: 0.15 });
      for (const y of [0.62, 0.74, 0.86]) k.ball(0.025, PAL.ink, { y, z: 0.22 - Math.abs(y - 0.74) * 0.3 });
      k.cyl(0.2, 0.07, PAL.red, { y: 0.88 }, 9);
      k.box(0.08, 0.25, 0.04, PAL.red, { x: 0.1, y: 0.75, z: 0.17, rz: 0.15 });
      for (const s of [-1, 1]) k.rod(s * 0.2, 0.75, 0, s * 0.55, 0.95, 0, 0.018, PAL.bark, 4);
      break;
    }
    case 'sapling': {
      k.surf(['planks', { scale: 0.6 }], () => k.box(0.6, 0.4, 0.6, PAL.woodLight, { y: 0.2 }));
      k.box(0.54, 0.04, 0.54, PAL.soil, { y: 0.4 });
      k.cyl(0.05, 0.8, PAL.trunk, { y: 0.8 }, 6, 0.04);
      const bloom = [0xf6b8cc, 0xf8c8d8, 0xf09ab8];
      for (let i = 0; i < 7; i++) { const a = i * 0.9; k.ball(0.22, bloom[i % 3], { x: Math.cos(a) * 0.22, y: 1.3 + (i % 3) * 0.1, z: Math.sin(a) * 0.22 }); }
      k.ball(0.26, bloom[0], { y: 1.5 });
      break;
    }
    case 'parasol': {
      k.cyl(0.18, 0.06, PAL.stone, { x: -0.35, y: 0.03 }, 8);
      k.cyl(0.025, 2.0, PAL.white, { x: -0.35, y: 1.0 }, 6);
      // eight wedge panels, alternating stripes
      for (let i = 0; i < 8; i++) k.add(new THREE.ConeGeometry(0.95, 0.38, 1, 1, false, (i / 8) * Math.PI * 2, Math.PI / 4), i % 2 ? PAL.white : 0x4fb3c8, { x: -0.35, y: 2.05 });
      k.ball(0.05, PAL.white, { x: -0.35, y: 2.27 });
      // a deckchair under it
      k.at({ x: 0.2, z: 0.1, ry: -0.3 }, () => {
        k.beam(-0.25, 0, -0.35, -0.25, 0.45, 0.25, 0.04, PAL.woodLight);
        k.beam(0.25, 0, -0.35, 0.25, 0.45, 0.25, 0.04, PAL.woodLight);
        k.beam(-0.25, 0, 0.3, -0.25, 0.75, -0.3, 0.04, PAL.woodLight);
        k.beam(0.25, 0, 0.3, 0.25, 0.75, -0.3, 0.04, PAL.woodLight);
        k.surf(['fabric', { axis: 'x', scale: 0.4 }], () => k.box(0.46, 0.02, 0.75, 0x4fb3c8, { y: 0.38, z: -0.02, rx: 0.9 }));
      });
      break;
    }
    case 'lamppost': {
      const h = 2.4;
      k.cyl(0.18, 0.22, PAL.stone, { y: 0.11 }, 6, 0.14);
      k.cyl(0.06, h - 0.25, PAL.ink, { y: 0.22 + (h - 0.25) / 2 }, 6, 0.05);
      k.cyl(0.09, 0.08, PAL.ink, { y: 0.8 }, 6);
      bk.cyl(0.14, 0.32, PAL.lampGlow, { y: h + 0.09, ry: Math.PI / 4 }, 4, 0.18); // (bk has its own transform stack: no k.at here)
      k.at({ y: h }, () => {
        k.cyl(0.13, 0.07, PAL.ink, { y: -0.1 }, 4, 0.17);
        for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) k.box(0.025, 0.32, 0.025, PAL.ink, { x: x * 0.12, y: 0.09, z: z * 0.12 });
        k.cyl(0.23, 0.12, PAL.ink, { y: 0.3, ry: Math.PI / 4 }, 4, 0.04);
        k.ball(0.045, PAL.ink, { y: 0.4 });
      });
      out.lights.push({ x: 0, y: h + 0.1, z: 0, kind: 'lamp' });
      break;
    }
    case 'lights': {
      const w = 0.85, h = 1.7, r = w;
      for (const s of [-1, 1]) k.box(0.1, h, 0.1, PAL.woodLight, { x: s * w, y: h / 2 });
      const N = 9;
      let px = -r, py = h;
      for (let i = 1; i <= N; i++) {
        const a = Math.PI - (i / N) * Math.PI, x = Math.cos(a) * r, y = h + Math.sin(a) * 0.55;
        k.beam(px, py, 0, x, y, 0, 0.09, PAL.woodLight);
        px = x; py = y;
      }
      // vines and fairy bulbs along the arch
      const bulb = [0xffd27a, 0xffb36a, 0xfff0b0];
      for (let i = 0; i < 17; i++) {
        const t = i / 16, a = Math.PI - t * Math.PI;
        const x = Math.cos(a) * r, y = h + Math.sin(a) * 0.55;
        bk.ball(0.04, bulb[i % 3], { x, y: y - 0.09, z: 0.06 }, 0);
        if (i % 2) k.ball(0.09, PAL.leaf, { x, y: y + 0.05, z: -0.03, s: [1.2, 0.8, 1] });
      }
      for (let i = 0; i < 6; i++) for (const s of [-1, 1]) {
        const y = 0.25 + i * 0.26;
        bk.ball(0.035, bulb[(i + (s > 0 ? 1 : 0)) % 3], { x: s * (w + 0.07), y, z: 0.03 }, 0);
        k.ball(0.08, i % 2 ? PAL.leafDark : PAL.leaf, { x: s * w, y: y + 0.12, z: 0.06, s: [0.9, 0.8, 0.8] });
      }
      out.lights.push({ x: 0, y: h + 0.3, z: 0.3, kind: 'fairy' });
      break;
    }
    case 'topiary': {
      // a box hedge clipped into Clawd: block body, two eye notches, arm nubs, four stubby legs, in a square planter
      k.surf(['planks', { axis: 'y', scale: 0.6 }], () => k.box(1.0, 0.36, 0.8, PAL.woodDark, { y: 0.18 }));
      k.box(0.94, 0.04, 0.74, PAL.soil, { y: 0.37 });
      const G = PAL.leafDark, G2 = PAL.leaf;
      for (const x of [-0.27, -0.1, 0.1, 0.27]) k.box(0.12, 0.2, 0.2, G, { x, y: 0.48 });
      k.box(0.82, 0.55, 0.5, G2, { y: 0.84 });
      for (const s of [-1, 1]) k.box(0.14, 0.14, 0.22, G, { x: s * 0.48, y: 0.82 });
      for (const s of [-1, 1]) k.box(0.09, 0.15, 0.05, 0x1f3a1a, { x: s * 0.17, y: 0.95, z: 0.25 }); // the eye notches
      break;
    }
    case 'postbox': {
      // Posy's red pillar box: a round post with a domed cap, a slot and a gold crown
      k.cyl(0.24, 0.08, PAL.ink, { y: 0.04 }, 10);
      k.cyl(0.2, 0.86, PAL.red, { y: 0.51 }, 10);
      k.cyl(0.225, 0.07, PAL.ink, { y: 0.97 }, 10);
      k.ball(0.21, PAL.red, { y: 1.0, s: [1, 0.55, 1] }, 1);
      k.box(0.18, 0.035, 0.05, PAL.ink, { y: 0.8, z: 0.19 });
      k.box(0.12, 0.08, 0.02, PAL.white, { y: 0.6, z: 0.2 });
      k.ball(0.04, GOLD, { y: 1.13 });
      break;
    }
    case 'crates': {
      // Bram's stencilled crates: two side by side, one on top, a little askew
      const crate = (x: number, y: number, z: number, ry: number, c: number) => {
        k.surf(['planks', { scale: 0.7 }], () => k.box(0.5, 0.42, 0.46, c, { x, y: y + 0.21, z, ry }));
        for (const dy of [0.05, 0.37]) k.box(0.52, 0.05, 0.48, PAL.woodDark, { x, y: y + dy, z, ry });
        k.box(0.16, 0.12, 0.01, PAL.ink, { x: x + Math.sin(ry) * 0.235, y: y + 0.22, z: z + Math.cos(ry) * 0.235, ry });
      };
      crate(-0.27, 0, 0, 0.05, PAL.plank); crate(0.27, 0, 0.02, -0.08, PAL.woodLight); crate(0.02, 0.42, 0.01, 0.2, PAL.wood);
      break;
    }
    case 'millstone': {
      // a retired millstone on a stump, a flour sack leaning on it
      k.surf(['bark', { scale: 0.7 }], () => k.cyl(0.2, 0.5, PAL.trunk, { y: 0.25 }, 8, 0.17));
      k.surf(['rock', { scale: 0.9 }], () => k.cyl(0.55, 0.16, PAL.stone, { y: 0.58 }, 14));
      k.cyl(0.1, 0.17, PAL.rockDark, { y: 0.585 }, 8);
      for (let i = 0; i < 6; i++) { const a = i * 1.047; k.box(0.34, 0.012, 0.02, PAL.rockDark, { x: Math.cos(a) * 0.3, y: 0.665, z: Math.sin(a) * 0.3, ry: -a + 0.4 }); }
      k.ball(0.17, PAL.cloth, { x: 0.38, y: 0.17, z: 0.34, s: [1, 1.2, 0.9] }, 1);
      k.cyl(0.06, 0.08, PAL.cloth, { x: 0.38, y: 0.38, z: 0.34 }, 6);
      break;
    }
    case 'prizepumpkin': {
      // the Mayor's prize pumpkin: giant, ribbed, wearing a blue first-prize rosette
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; k.ball(0.32, i % 2 ? PAL.pumpkin : 0xd8742a, { x: Math.cos(a) * 0.2, y: 0.36, z: Math.sin(a) * 0.2, s: [0.75, 1, 0.75] }, 1); }
      k.ball(0.38, PAL.pumpkin, { y: 0.36, s: [1, 0.9, 1] }, 1);
      k.cyl(0.05, 0.2, PAL.leafDark, { y: 0.74, rz: 0.2 }, 6);
      k.cyl(0.11, 0.03, PAL.blue, { x: 0.2, y: 0.5, z: 0.47, rx: Math.PI / 2 - 0.3 }, 10);
      k.cyl(0.05, 0.035, GOLD, { x: 0.2, y: 0.5, z: 0.49, rx: Math.PI / 2 - 0.3 }, 8);
      for (const s of [-1, 1]) k.box(0.05, 0.16, 0.01, PAL.blue, { x: 0.2 + s * 0.04, y: 0.36, z: 0.5, rz: s * 0.25, rx: -0.3 });
      break;
    }
    case 'tent': {
      // Fern's pup tent: a canvas A-frame, open door flap, a guy-line pole and a pennant
      const w = 0.8, h = 0.95, d = 1.3, a = Math.atan2(h, w);
      for (const s of [-1, 1]) k.box(0.03, Math.hypot(w, h), d, 0xb8a46a, { x: s * w / 2, y: h / 2, z: 0, rz: s * (Math.PI / 2 - a) });
      k.box(0.03, 0.03, d + 0.06, PAL.woodDark, { y: h, z: 0 });
      k.box(0.5, 0.6, 0.02, 0x5a4a2a, { y: 0.32, z: d / 2 - 0.05 });
      k.box(0.28, 0.7, 0.02, 0xc8b47a, { x: 0.3, y: 0.36, z: d / 2 + 0.02, ry: -0.6, rz: 0.4 });
      for (const z of [-1, 1]) k.cyl(0.02, h + 0.2, PAL.woodDark, { y: (h + 0.2) / 2, z: z * (d / 2 + 0.02) }, 5);
      k.box(0.18, 0.11, 0.01, PAL.red, { x: 0.09, y: h + 0.13, z: d / 2 + 0.02 });
      k.box(0.6, 0.06, 0.24, 0x7a8a48, { x: -0.05, y: 0.04, z: 0.15 });
      break;
    }
    case 'vane': {
      // Nimbus's weather vane: an iron pole, compass arms N/E/S/W, a brass cockerel and arrow on top
      k.cyl(0.14, 0.06, PAL.stone, { y: 0.03 }, 8);
      k.cyl(0.025, 1.7, PAL.metalDark, { y: 0.88 }, 6);
      for (const r of [0, Math.PI / 2]) k.box(0.62, 0.025, 0.025, PAL.metalDark, { y: 1.42, ry: r });
      for (const [x, z] of [[0.31, 0], [-0.31, 0], [0, 0.31], [0, -0.31]] as const) k.box(0.07, 0.09, 0.02, PAL.ink, { x, y: 1.42, z, ry: x ? Math.PI / 2 : 0 });
      k.box(0.7, 0.025, 0.025, 0xc89a10, { y: 1.74, ry: 0.6 });
      k.cone(0.06, 0.12, 0xc89a10, { x: Math.cos(0.6) * 0.38, y: 1.74, z: -Math.sin(0.6) * 0.38, rz: -Math.PI / 2, ry: 0.6 }, 4);
      k.ball(0.11, 0xf2c230, { y: 1.88, s: [1.4, 1, 0.5] });
      k.ball(0.06, 0xf2c230, { x: 0.12, y: 1.98, s: [1, 1, 0.6] });
      k.cone(0.07, 0.16, 0xf2c230, { x: -0.16, y: 1.96, rz: 0.5, s: [1, 1, 0.4] }, 4);
      k.box(0.03, 0.05, 0.02, PAL.red, { x: 0.13, y: 2.05 });
      break;
    }
    case 'welcome': {
      // Posy's welcome sign: a post with a hanging board painted with a teal envelope, a flower box at its foot
      const TEAL = 0x3d9fa8, CREAM = 0xf6e8c8;
      k.surf(['planks', { scale: 0.6 }], () => k.box(0.1, 1.35, 0.1, PAL.wood, { x: -0.32, y: 0.675 }));
      k.box(0.62, 0.06, 0.08, PAL.woodDark, { x: -0.04, y: 1.3 });
      for (const x of [-0.24, 0.16]) k.box(0.015, 0.14, 0.015, PAL.metalDark, { x, y: 1.2 });
      k.surf(['planks', { axis: 'x', scale: 0.5 }], () => k.box(0.58, 0.36, 0.05, CREAM, { x: -0.04, y: 0.95 }));
      k.box(0.62, 0.04, 0.06, PAL.woodDark, { x: -0.04, y: 1.13 });
      k.box(0.62, 0.04, 0.06, PAL.woodDark, { x: -0.04, y: 0.77 });
      // the envelope, a hair proud of the board on both faces
      for (const z of [-1, 1]) {
        k.box(0.3, 0.2, 0.01, TEAL, { x: -0.04, y: 0.94, z: z * 0.03 });
        for (const s of [-1, 1]) k.box(0.18, 0.025, 0.01, CREAM, { x: -0.04 + s * 0.07, y: 0.98, z: z * 0.036, rz: s * -0.55 });
        k.ball(0.03, PAL.red, { x: -0.04, y: 0.93, z: z * 0.04, s: [1, 1, 0.4] });
      }
      // a flower box at the foot of the post
      k.surf(['planks', { scale: 0.6 }], () => k.box(0.5, 0.18, 0.26, PAL.woodLight, { x: 0.05, y: 0.09, z: 0.1 }));
      k.box(0.46, 0.03, 0.22, PAL.soil, { x: 0.05, y: 0.18, z: 0.1 });
      for (let i = 0; i < 5; i++) {
        const x = -0.13 + i * 0.09;
        k.ball(0.07, i % 2 ? PAL.leaf : PAL.leafDark, { x, y: 0.23, z: 0.1, s: [1, 0.8, 1] });
        k.ball(0.04, fl[i % fl.length], { x, y: 0.3, z: 0.12 + (i % 2) * 0.03 });
      }
      break;
    }
    case 'geode': {
      // the grotto's hidden chest (scene/grotto): a split geode on a driftwood stump, its crystals glowing after dark
      k.cyl(0.24, 0.34, PAL.woodDark, { y: 0.17 }, 7, 0.19);
      k.cyl(0.2, 0.03, PAL.woodLight, { y: 0.345 }, 7);
      k.ball(0.3, PAL.rockDark, { y: 0.56, z: -0.06, s: [1, 0.82, 0.7] }, 1);
      k.ball(0.22, 0x3a2c58, { y: 0.58, z: 0.04, s: [0.95, 0.8, 0.55] }, 1);
      const cr = [0xb79cff, 0x7ff0e0, 0xd8b0ff, 0x9ad8ff, 0xc39cff];
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2, r = 0.05 + (i % 3) * 0.045;
        bk.cone(0.035 + (i % 2) * 0.012, 0.13 + (i % 3) * 0.04, cr[i % cr.length], { x: Math.cos(a) * r, y: 0.6 + Math.sin(a) * r * 0.8, z: 0.13, rx: Math.PI / 2 - 0.3, rz: Math.cos(a) * 0.4 }, 5);
      }
      out.lights.push({ x: 0, y: 0.6, z: 0.25, kind: 'candle' });
      break;
    }
    default:
      if (id.startsWith('keep-')) keepsake(k, id.slice(5));
      else if (id.startsWith('trophy-')) trophy(k, id.slice(7));
  }
  return out;
}

/** The General store: a little wooden cart with a striped awning and wares on the counter, front +z. */
export function buildStore(k: Kit, bk: Kit, season: Season): DecorOut {
  const out: DecorOut = { lights: [], swing: [] };
  // wheels and body
  for (const s of [-1, 1]) {
    k.cyl(0.42, 0.1, PAL.woodDark, { x: s * 1.0, y: 0.42, z: -0.15, rz: Math.PI / 2 }, 10);
    k.cyl(0.12, 0.14, PAL.metalDark, { x: s * 1.0, y: 0.42, z: -0.15, rz: Math.PI / 2 }, 8);
  }
  k.box(2.0, 0.08, 0.1, PAL.woodDark, { y: 0.42, z: -0.15 });
  k.surf(['planks', { axis: 'x' }], () => k.box(1.8, 0.75, 1.0, 0x5f8f4a, { y: 0.88 }));
  k.box(1.9, 0.07, 1.12, PAL.woodLight, { y: 1.29 });
  k.box(1.7, 0.6, 0.02, 0x4f7a3e, { y: 0.88, z: 0.505 });
  for (const s of [-1, 1]) k.box(0.08, 0.62, 0.04, PAL.woodLight, { x: s * 0.86, y: 0.88, z: 0.51 });
  // shafts and a prop leg
  for (const s of [-1, 1]) k.beam(s * 0.55, 0.62, -0.5, s * 0.6, 0.18, -1.6, 0.07, PAL.wood);
  k.box(0.08, 0.2, 0.08, PAL.wood, { y: 0.1, z: -1.55 });
  // posts and a striped awning sloping to the front
  for (const [x, z] of [[-0.86, 0.48], [0.86, 0.48], [-0.86, -0.48], [0.86, -0.48]]) k.box(0.07, z > 0 ? 1.15 : 1.35, 0.07, PAL.woodLight, { x, y: 1.32 + (z > 0 ? 1.15 : 1.35) / 2, z });
  for (let i = 0; i < 8; i++) {
    const x = -1.0 + (i + 0.5) * (2.0 / 8);
    k.surf(['fabric', { axis: 'z', scale: 0.6 }], () => k.box(2.0 / 8 + 0.005, 0.04, 1.35, i % 2 ? 0xfff3d6 : 0x5cae4f, { x, y: 2.58, z: 0.02, rx: -0.3 }));
    k.prism([[-0.12, 0], [0.12, 0], [0, -0.16]], 0.03, i % 2 ? 0xfff3d6 : 0x5cae4f, { x, y: 2.39, z: 0.66 });
  }
  // wares on the counter: a gnome, potted flowers, a little birdhouse, a jar of sweets, a ledger
  k.at({ x: -0.6, y: 1.33, z: 0.12, s: 0.6 }, () => gnome(k, PAL.red, false));
  const fl = flowerColors(season);
  for (let i = 0; i < 2; i++) {
    const x = -0.15 + i * 0.3;
    k.cyl(0.09, 0.15, PAL.rust, { x, y: 1.4, z: 0.2 }, 7, 0.11);
    k.ball(0.1, PAL.leafDark, { x, y: 1.52, z: 0.2 });
    for (let j = 0; j < 3; j++) k.ball(0.045, fl[(i * 2 + j) % fl.length], { x: x + Math.cos(j * 2) * 0.06, y: 1.58, z: 0.2 + Math.sin(j * 2) * 0.06 });
  }
  k.at({ x: 0.55, y: 1.33, z: 0.0, s: 0.45 }, () => { k.surf(['planks', { axis: 'y', scale: 0.4 }], () => k.box(0.26, 0.28, 0.24, 0x5a8fd6, { y: 0.14 })); k.prism([[-0.2, 0], [0.2, 0], [0, 0.17]], 0.32, PAL.roofRed, { y: 0.28, z: -0.16 }); });
  k.cyl(0.08, 0.2, 0xd8eef4, { x: 0.62, y: 1.43, z: 0.32 }, 8);
  for (let j = 0; j < 4; j++) k.ball(0.03, [PAL.red, PAL.yellow, PAL.green, PAL.pink][j], { x: 0.6 + (j % 2) * 0.04, y: 1.38 + j * 0.03, z: 0.32 });
  k.box(0.26, 0.04, 0.2, 0x8a3a2a, { x: 0.25, y: 1.35, z: 0.35, ry: 0.2 });
  // the bell on its bracket (ring for service)
  k.box(0.04, 0.3, 0.04, PAL.ink, { x: 0.86, y: 1.48, z: 0.52 });
  k.cone(0.07, 0.1, GOLD, { x: 0.86, y: 1.58, z: 0.6 }, 8);
  // a hanging lantern on the front post
  k.box(0.3, 0.03, 0.03, PAL.ink, { x: -0.72, y: 2.3, z: 0.55 });
  k.cyl(0.08, 0.05, PAL.ink, { x: -0.6, y: 2.13, z: 0.55 }, 6);
  bk.cyl(0.07, 0.14, PAL.lampGlow, { x: -0.6, y: 2.04, z: 0.55 }, 6);
  k.cyl(0.08, 0.03, PAL.ink, { x: -0.6, y: 1.96, z: 0.55 }, 6);
  out.lights.push({ x: -0.6, y: 2.04, z: 0.65, kind: 'lamp' });
  // crates and a barrel beside it
  k.surf(['planks', { axis: 'h', scale: 0.6 }], () => k.box(0.5, 0.5, 0.5, PAL.woodLight, { x: 1.45, y: 0.25, z: 0.25, ry: 0.3 }));
  for (let j = 0; j < 4; j++) k.ball(0.08, season === 'autumn' ? PAL.pumpkin : PAL.apple, { x: 1.38 + (j % 2) * 0.15, y: 0.55, z: 0.2 + Math.floor(j / 2) * 0.15 });
  // the sign board frame (the painted face is a canvas texture, yard.ts)
  k.box(1.5, 0.42, 0.06, PAL.woodDark, { y: 2.98, z: 0.42, rx: -0.3 });
  for (const s of [-1, 1]) k.box(0.05, 0.4, 0.05, PAL.woodDark, { x: s * 0.6, y: 2.72, z: 0.4 });
  return out;
}

/** world-space fence along the yard (picket runs + posts); `gy` = ground height */
export function buildYardFence(k: Kit, runs: readonly [number, number, number, number][], gy: (x: number, z: number) => number): void {
  k.part('yardFence', () => { for (const [ax, az, bx, bz] of runs) fenceRun(k, ax, az, bx, bz, gy, PAL.wallWhite, 1.2); });
}

/** the yard's sign post (the painted face is a canvas texture, yard.ts), front +z */
export function buildYardSign(k: Kit): void {
  k.box(0.1, 1.15, 0.1, PAL.woodDark, { x: -0.42, y: 0.575 });
  k.box(0.1, 1.15, 0.1, PAL.woodDark, { x: 0.42, y: 0.575 });
  k.box(1.04, 0.5, 0.05, PAL.woodDark, { y: 0.92, z: -0.01 });
  // a flower box at its foot
  k.box(0.7, 0.16, 0.22, PAL.wood, { y: 0.08, z: 0.12 });
}
