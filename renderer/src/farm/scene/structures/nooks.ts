/**
 * Leisure nooks: small purpose-built places where idle farmers go to do something other than sit.
 *   - the checkers pergola: a wisteria-hung pergola on a flagstone floor, a checkers table with two stools (two
 *     farmers play each other), a spectators' bench and a hanging lantern with festoon bulbs;
 *   - the picnic blanket: a gingham blanket in the meadow with a wicker basket, lemonade, pie and sandwiches, a
 *     striped parasol, a kite in the grass and a firefly jar glowing on a stump at dusk;
 *   - the stargazers' knoll: an octagonal deck on the windmill hill's shoulder with a brass telescope on a tripod,
 *     two benches facing the valley, a lamp post, a pennant in the wind and a painted star sign;
 *   - the hot-spring foot-bath: a stone-ringed steaming pool with slab seats on its rim (feet in the warm water), a
 *     bath-house screen with towels, a bamboo spout, two stone lanterns and a rubber duck bobbing about.
 *
 * Every builder works in its structure's local frame (front +z, ground y = 0 on the flattened pad) and exports the
 * anchors the structures system publishes to the farmers (seats, the telescope's eyepiece stand). Static parts merge
 * into the Kit bake; only the pennant, the rubber duck and the steam move.
 */
import * as THREE from 'three';
import type { Season } from '../../model/types.ts';
import { PAL, toon } from '../toon.ts';
import { Kit } from './kit.ts';
import { bench, bucket, crate, flowerColors, flowerPot, lampPost, stool } from './props.ts';
import type { Env, Rig } from './rig.ts';
import type { BuildOpts } from './farmhouse.ts';

/** A seat or stand anchor in structure-local metres: position, surface height and facing (local yaw). */
export interface NookSeat { x: number; y: number; z: number; yaw: number }

const TAU = Math.PI * 2;
/**
 * Seats are published this far above the seat surface: the seated poses rock the body a few cm below its root
 * (leaning in over a board, tipping back to the stars), so the bottom rests on the surface instead of sinking into it.
 */
const SIT = 0.03;
/** the same surface facing the other way (the underside of a canopy) */
function inside(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  if (n !== g) g.dispose();
  const p = n.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i += 3) {
    const x = p.getX(i + 1), y = p.getY(i + 1), z = p.getZ(i + 1);
    p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
    p.setXYZ(i + 2, x, y, z);
  }
  return n;
}
const leafCols = (s: Season): number[] => s === 'autumn' ? [PAL.leafAutumn, PAL.leafAutumn2, 0xc9782f] : s === 'spring' ? [PAL.leafSpring, PAL.leaf, 0x7cc25a] : [PAL.leaf, PAL.leafDark, 0x4f9440];

// ---------------------------------------------------------------------------------------------
// Checkers pergola

export const PERGOLA = Object.freeze({
  /** flagstone floor top */
  floor: 0.05,
  /** corner post offset (±) */
  post: 2.05,
  /** the two players' stools: facing the table */
  players: [{ x: -0.92, y: 0.53 + SIT, z: 0, yaw: Math.PI / 2 }, { x: 0.92, y: 0.53 + SIT, z: 0, yaw: -Math.PI / 2 }] as readonly NookSeat[],
  /** the spectators' bench along the back */
  bench: { x: 0, y: 0.55 + SIT, z: -1.6, yaw: 0 } as NookSeat,
});

export function buildPergola(o: BuildOpts): THREE.Group {
  const root = new THREE.Group();
  root.name = 'pergola';
  const k = new Kit(o.seed + 401);
  const P = PERGOLA, F = P.floor, R = P.post;
  // flagstone floor: a grid of chunky stones, a darker border course
  const cols = [0xc9bfae, 0xb9ae9b, 0xd6cdbd, 0xa89f8e, 0xc2b49c];
  k.surf(['rock', { scale: 0.5 }], () => {
    for (let i = -4; i < 4; i++) for (let j = -4; j < 4; j++) {
      const edge = i === -4 || i === 3 || j === -4 || j === 3;
      k.box(0.52, 0.06, 0.52, edge ? 0x8f887c : cols[Math.floor(k.r() * cols.length)], { x: (i + 0.5) * 0.56, y: 0.02, z: (j + 0.5) * 0.56, ry: (k.r() - 0.5) * 0.05 });
    }
  });
  // four posts on stone footings, two beams, rafters across, knee braces
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const x = sx * R, z = sz * R;
    k.surf(['fieldstone', { scale: 0.6 }], () => k.box(0.42, 0.24, 0.42, PAL.stone, { x, y: F + 0.12, z }));
    k.box(0.22, 2.6, 0.22, PAL.wood, { x, y: F + 0.24 + 1.3, z });
    k.box(0.28, 0.08, 0.28, PAL.woodDark, { x, y: F + 0.28, z });
  }
  const top = F + 2.84;
  for (const sz of [-1, 1]) {
    k.box(4.9, 0.24, 0.16, PAL.woodDark, { y: top, z: sz * R });
    for (const sx of [-1, 1]) k.beam(sx * R, top - 0.62, sz * R, sx * (R - 0.55), top - 0.1, sz * R, 0.1, PAL.wood);
  }
  for (let i = 0; i < 8; i++) {
    const x = -2.1 + i * 0.6;
    k.box(0.1, 0.18, 5.0, PAL.wood, { x, y: top + 0.21, z: 0 });
    for (const sz of [-1, 1]) k.box(0.1, 0.1, 0.16, PAL.woodDark, { x, y: top + 0.16, z: sz * 2.56, rx: sz * 0.5 }); // the cut rafter tails
  }
  // climbing vines: up the two back posts, then a leafy canopy over the back two thirds; wisteria hangs in spring
  const lc = leafCols(o.season), fl = flowerColors(o.season);
  const bare = o.season === 'winter';
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 11; i++) {
      const a = i * 1.9 + sx;
      const x = sx * R + Math.cos(a) * 0.15, z = -R + Math.sin(a) * 0.15, y = F + 0.45 + i * 0.23;
      if (bare) k.rod(x, y, z, sx * R + Math.cos(a + 1.9) * 0.15, y + 0.23, -R + Math.sin(a + 1.9) * 0.15, 0.025, PAL.bark, 4);
      else k.ball(0.13 + k.r() * 0.05, lc[i % lc.length], { x, y, z, s: [1, 0.8, 1] });
    }
  }
  const clumps = bare ? 10 : 30;
  for (let i = 0; i < clumps; i++) {
    const x = -2.2 + k.r() * 4.4, z = -2.3 + k.r() * 3.2;
    if (bare) { k.rod(x, top + 0.31, z, x + (k.r() - 0.5) * 0.9, top + 0.33, z + (k.r() - 0.5) * 0.9, 0.022, PAL.bark, 4); continue; }
    k.blob(0.22 + k.r() * 0.16, lc[i % lc.length], { x, y: top + 0.36, z, s: [1.3, 0.55, 1.1], ry: k.r() * 3 });
  }
  if (o.season === 'spring' || o.season === 'summer') {
    const wis = o.season === 'spring' ? [0xa98ae0, 0xc7b0f0, 0x8f6fd0, PAL.white] : [fl[0], fl[1], PAL.pink];
    for (let i = 0; i < 18; i++) {
      const x = -2.0 + k.r() * 4.0, z = -2.2 + k.r() * 2.9;
      if (Math.hypot(x, z) < 0.9) continue; // keep the lantern's drop clear
      const h = o.season === 'spring' ? 0.32 + k.r() * 0.22 : 0.12;
      if (o.season === 'spring') k.cone(0.08, h, wis[i % wis.length], { x, y: top + 0.12 - h / 2, z, rx: Math.PI }, 5);
      else k.ball(0.07, wis[i % wis.length], { x, y: top + 0.08, z });
    }
  }
  if (bare) for (const sz of [-1, 1]) k.box(4.8, 0.08, 0.2, PAL.snow, { y: top + 0.16, z: sz * R });
  // the checkers table: pedestal, square top, an 8 × 8 board, a game in progress and a few captured pieces
  k.part('checkersTable', () => {
    for (const r of [0, Math.PI / 2]) k.box(0.62, 0.06, 0.1, PAL.woodDark, { y: F + 0.03, ry: r });
    k.cyl(0.09, 0.56, PAL.wood, { y: F + 0.34 }, 7, 0.07);
    k.surf(['planks', { axis: 'x' }], () => k.box(0.84, 0.06, 0.84, PAL.plank, { y: F + 0.65 }));
    const tile = 0.085, by = F + 0.686;
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) k.box(tile, 0.012, tile, (i + j) % 2 ? 0x3a2a20 : 0xefe2c4, { x: (i - 3.5) * tile, y: by, z: (j - 3.5) * tile });
    k.box(0.74, 0.016, 0.03, PAL.woodDark, { y: by - 0.002, z: 0.355 }); k.box(0.74, 0.016, 0.03, PAL.woodDark, { y: by - 0.002, z: -0.355 });
    k.box(0.03, 0.016, 0.68, PAL.woodDark, { x: 0.355, y: by - 0.002 }); k.box(0.03, 0.016, 0.68, PAL.woodDark, { x: -0.355, y: by - 0.002 });
    // pieces sit on the dark squares
    const game: [number, number, 0 | 1, boolean?][] = [[0, 1, 0], [2, 1, 0], [1, 2, 0], [5, 2, 0], [3, 3, 0, true], [6, 3, 0], [4, 4, 1], [1, 4, 1], [2, 5, 1], [7, 6, 1], [5, 6, 1, true], [0, 5, 1]];
    for (const [i, j, side, king] of game) {
      const c = side ? PAL.red : 0xf3ead6;
      k.cyl(0.032, 0.022, c, { x: (i - 3.5) * tile, y: by + 0.017, z: (j - 3.5) * tile }, 8);
      if (king) k.cyl(0.032, 0.022, c, { x: (i - 3.5) * tile, y: by + 0.039, z: (j - 3.5) * tile }, 8);
    }
    for (let n = 0; n < 3; n++) k.cyl(0.032, 0.022, n === 2 ? PAL.red : 0xf3ead6, { x: 0.39 - n * 0.07, y: F + 0.691, z: 0.39 }, 8);
  });
  for (const s of P.players) stool(k, { x: s.x, y: F, z: s.z });
  bench(k, { x: P.bench.x, y: F, z: P.bench.z - 0.15 }, 2.2);
  // the lantern over the table on a chain, festoon bulbs along the front beam
  k.part('lantern', () => {
    k.box(0.9, 0.1, 0.12, PAL.woodDark, { y: top + 0.35 }); // a batten across the two middle rafters
    k.rod(0, top + 0.3, 0, 0, F + 2.22, 0, 0.012, PAL.metalDark, 4);
    k.cone(0.17, 0.14, PAL.ink, { y: F + 2.2, ry: Math.PI / 4 }, 4);
    k.emit({ radius: 6, intensity: 0.65, flicker: 0.3 }, () => k.box(0.2, 0.26, 0.2, PAL.lampGlow, { y: F + 2.0 }, 'glow'));
    k.box(0.24, 0.04, 0.24, PAL.ink, { y: F + 1.85 });
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) k.box(0.025, 0.28, 0.025, PAL.ink, { x: x * 0.105, y: F + 2.0, z: z * 0.105 });
  });
  const sag = (u: number) => top - 0.14 - Math.sin(u * Math.PI) * 0.3;
  const N = 9;
  for (let i = 0; i < N; i++) {
    const u0 = i / N, u1 = (i + 1) / N;
    k.rod(-R + u0 * 2 * R, sag(u0), R + 0.1, -R + u1 * 2 * R, sag(u1), R + 0.1, 0.01, PAL.ink, 3);
    if (i) k.emit(false, () => k.ball(0.045, PAL.lampGlow, { x: -R + u0 * 2 * R, y: sag(u0) - 0.06, z: R + 0.1 }, 0, 'glow'));
  }
  // planters at the front corners
  flowerPot(k, { x: -R - 0.7, z: R + 0.55 }, o.season, 1, true);
  flowerPot(k, { x: R + 0.7, z: R + 0.55 }, o.season, 3, true);
  k.build(root, o.night);
  return root;
}

// ---------------------------------------------------------------------------------------------
// Picnic blanket

export const PICNIC = Object.freeze({
  /** blanket top */
  top: 0.022,
  /** two places on the blanket, facing each other over the spread */
  places: [{ x: 0, y: 0.022 + SIT, z: -1.0, yaw: 0 }, { x: 0, y: 0.022 + SIT, z: 1.0, yaw: Math.PI }] as readonly NookSeat[],
  basket: { x: 1.4, z: 0.05 },
  parasol: { x: -2.0, z: -0.45 },
  stump: { x: 1.8, z: -1.6 },
});

export function buildPicnic(o: BuildOpts): THREE.Group {
  const root = new THREE.Group();
  root.name = 'picnic';
  const k = new Kit(o.seed + 411);
  const P = PICNIC, T = P.top;
  // gingham blanket, 10 × 9 squares, with a fold at one corner
  k.part('blanket', () => k.surf(['fabric', { scale: 0.45 }], () => {
    for (let i = 0; i < 10; i++) for (let j = 0; j < 9; j++) {
      if (i === 9 && j === 8) continue;
      const c = (i + j) % 2 ? PAL.red : ((i % 2) && (j % 2) ? 0xe9a39a : 0xf6efe0);
      k.box(0.3, 0.02, 0.3, c, { x: (i - 4.5) * 0.3, y: 0.011, z: (j - 4) * 0.3 });
    }
    k.box(0.3, 0.02, 0.3, 0xf6efe0, { x: 1.29, y: 0.04, z: 1.12, rx: 0.12, rz: 0.08 }); // the folded-over corner
  }));
  // the spread: a sandwich plate, a pie, lemonade and cups, a bowl of fruit
  k.cyl(0.15, 0.025, PAL.white, { y: T + 0.013, z: -0.32 }, 10);
  k.box(0.2, 0.035, 0.13, 0xe8c48a, { y: T + 0.045, z: -0.32, ry: 0.4 });
  k.box(0.21, 0.02, 0.14, PAL.leafSpring, { y: T + 0.072, z: -0.32, ry: 0.4 });
  k.box(0.2, 0.035, 0.13, 0xe8c48a, { y: T + 0.099, z: -0.32, ry: 0.42 });
  k.cyl(0.15, 0.025, PAL.white, { y: T + 0.013, z: 0.32 }, 10);
  k.cyl(0.13, 0.05, 0xd9a45a, { y: T + 0.05, z: 0.32 }, 9);
  k.cyl(0.11, 0.012, 0xb0402f, { y: T + 0.08, z: 0.32 }, 9);
  for (const r of [-0.05, 0.05]) { k.box(0.24, 0.012, 0.025, 0xe8b46a, { x: r, y: T + 0.088, z: 0.32 }); k.box(0.025, 0.012, 0.24, 0xe8b46a, { x: r, y: T + 0.09, z: 0.32 }); }
  k.cyl(0.085, 0.22, 0xf4e7a0, { x: 0.45, y: T + 0.11, z: 0.02 }, 8, 0.07);
  k.cyl(0.075, 0.03, 0xfff3b8, { x: 0.45, y: T + 0.21, z: 0.02 }, 8);
  k.add(new THREE.TorusGeometry(0.06, 0.014, 4, 8, Math.PI), 0xf4e7a0, { x: 0.54, y: T + 0.13, z: 0.02, rz: -Math.PI / 2 });
  k.cyl(0.04, 0.035, 0xffd23a, { x: 0.45, y: T + 0.03, z: 0.02 }, 6); // a lemon slice fallen beside it
  for (const [x, z] of [[0.26, -0.22], [-0.24, 0.24]]) k.cyl(0.045, 0.08, PAL.white, { x, y: T + 0.04, z }, 7, 0.05);
  k.cyl(0.15, 0.07, PAL.woodLight, { x: -0.46, y: T + 0.035, z: 0.0 }, 9, 0.18);
  for (let i = 0; i < 5; i++) { const a = i * 1.26; k.ball(0.055, i === 3 ? PAL.yellow : PAL.apple, { x: -0.46 + Math.cos(a) * 0.07, y: T + 0.1 + (i % 2) * 0.03, z: Math.sin(a) * 0.07 }, 1); }
  for (let i = 0; i < 4; i++) k.ball(0.025, PAL.grape, { x: -0.38 + (i % 2) * 0.03, y: T + 0.11 + Math.floor(i / 2) * 0.03, z: 0.07 });
  // an open book at a corner
  k.box(0.17, 0.02, 0.22, 0xf6f1e6, { x: -1.24, y: T + 0.03, z: 0.92, rz: 0.12, ry: 0.3 });
  k.box(0.17, 0.02, 0.22, 0xf6f1e6, { x: -1.08, y: T + 0.03, z: 0.97, rz: -0.12, ry: 0.3 });
  k.box(0.36, 0.015, 0.24, 0x3f78c8, { x: -1.16, y: T + 0.012, z: 0.94, ry: 0.3 });
  // wicker basket with a red napkin and a baguette
  k.part('basket', () => k.at({ x: P.basket.x, y: T, z: P.basket.z, ry: 0.25 }, () => {
    k.surf(['hay', { scale: 0.35 }], () => k.cyl(0.25, 0.26, 0xc99a64, { y: 0.13 }, 9, 0.29));
    k.cyl(0.3, 0.04, 0xa8844f, { y: 0.27 }, 9);
    k.box(0.28, 0.035, 0.52, 0xc9a26a, { x: -0.1, y: 0.31, rz: 0.45 });
    k.add(new THREE.TorusGeometry(0.24, 0.022, 4, 10, Math.PI), 0xa8844f, { y: 0.28, ry: Math.PI / 2 });
    k.box(0.2, 0.02, 0.18, PAL.red, { x: 0.12, y: 0.3, z: 0.08, rz: -0.3, ry: 0.3 });
    k.cyl(0.045, 0.42, 0xe0b06a, { x: 0.08, y: 0.36, z: -0.08, rx: 0.4, rz: -0.5 }, 6);
  }));
  // striped parasol, its pole pushed into the turf
  k.part('parasol', () => k.at({ x: P.parasol.x, z: P.parasol.z }, () => {
    k.rod(0, 0, 0, 0.1, 2.35, 0.05, 0.035, PAL.white, 6);
    const segs = 8;
    for (let i = 0; i < segs; i++) {
      const wedge = () => new THREE.ConeGeometry(1.3, 0.45, 2, 1, true, (i / segs) * TAU, TAU / segs);
      k.add(wedge(), i % 2 ? PAL.white : 0x3fa8a0, { x: 0.1, y: 2.12, z: 0.05 });
      k.add(inside(wedge()), i % 2 ? 0xe8e2d6 : 0x2f8a84, { x: 0.1, y: 2.12, z: 0.05 }); // the underside, seen from the blanket
    }
    k.ball(0.06, PAL.yellow, { x: 0.1, y: 2.38, z: 0.05 });
  }));
  // a firefly jar on a stump: glows at dusk
  k.part('jarStump', () => k.at({ x: P.stump.x, z: P.stump.z }, () => {
    k.surf(['logs', { axis: 'y', variant: 1 }], () => k.cyl(0.24, 0.38, PAL.trunk, { y: 0.19 }, 8, 0.21));
    k.surf(['logs', { axis: 'y' }], () => k.cyl(0.2, 0.02, PAL.woodLight, { y: 0.385 }, 8));
    k.emit({ radius: 4, intensity: 0.45, flicker: 0.5 }, () => k.cyl(0.075, 0.15, PAL.lampGlow, { y: 0.47 }, 7, 0.065, 'glow'));
    k.cyl(0.07, 0.035, PAL.metal, { y: 0.56 }, 7);
  }));
  // a kite left in the grass, its tail trailing
  k.at({ x: 2.35, y: 0.02, z: 1.35, ry: 0.6 }, () => {
    k.prism([[0, 0.42], [0.25, 0], [0, -0.62], [-0.25, 0]], 0.02, PAL.yellow, { rx: -Math.PI / 2 });
    k.prism([[0, 0.42], [0.25, 0], [0, 0]], 0.022, PAL.red, { rx: -Math.PI / 2 });
    k.prism([[0, -0.62], [-0.25, 0], [0, 0]], 0.022, PAL.red, { rx: -Math.PI / 2 });
    for (let i = 0; i < 5; i++) k.box(0.08, 0.012, 0.06, [PAL.blue, PAL.red, PAL.yellow][i % 3], { x: Math.sin(i * 0.9) * 0.12, y: 0.002, z: 0.75 + i * 0.2, ry: 0.8 });
  });
  // wildflowers round the blanket
  if (o.season !== 'winter') {
    const fl = flowerColors(o.season);
    for (let i = 0; i < 14; i++) {
      const a = i * 2.39 + 0.4, rx = 1.7 + (i % 3) * 0.35, rz = 1.45 + (i % 2) * 0.3;
      const x = Math.cos(a) * rx, z = Math.sin(a) * rz;
      if (Math.abs(x) < 1.3 && Math.abs(z) > 1.1) continue; // where a picnicker flops back for a doze
      if (Math.hypot(x - P.parasol.x, z - P.parasol.z) < 0.5 || Math.hypot(x - P.stump.x, z - P.stump.z) < 0.5 || Math.hypot(x - 2.35, z - 1.7) < 0.7) continue;
      k.cone(0.05, 0.22, PAL.leafDark, { x, y: 0.11, z }, 4);
      k.ball(0.05, fl[i % fl.length], { x, y: 0.24, z });
    }
  }
  k.build(root, o.night);
  return root;
}

// ---------------------------------------------------------------------------------------------
// Stargazers' knoll

export const LOOKOUT = Object.freeze({
  /** deck top */
  deck: 0.22,
  /** octagon apothem: room for a telescope stand and two benches with ≥ 1.8 m between farmers */
  apothem: 3.0,
  telescope: { x: 0.2, z: 1.3, yaw: -0.25, pitch: 0.55 },
  /** 2.2 m benches: a Clawd's arm nubs clear the armrests */
  benches: [{ x: -1.6, z: -1.45, ry: 0.55 }, { x: 1.6, z: -1.45, ry: -0.55 }],
  benchW: 2.2,
  lamp: { x: -0.9, z: -2.65 },
  pennant: { x: 0.9, z: -2.65 },
  crate: { x: 2.4, z: 0.55 },
});
/** where a farmer stands at the eyepiece (local), facing along the tube */
export function telescopeStand(): NookSeat {
  const t = LOOKOUT.telescope, cp = Math.cos(t.pitch);
  const hx = Math.sin(t.yaw) * cp, hz = Math.cos(t.yaw) * cp, hl = Math.hypot(hx, hz);
  // the eyepiece is 0.42 behind the mount down the tube; stand ~0.75 m (room for a bigger Clawd) behind it
  const back = 0.42 * cp + 0.75;
  return { x: t.x - (hx / hl) * back, y: LOOKOUT.deck, z: t.z - (hz / hl) * back, yaw: t.yaw };
}
/** the two bench seats (local), facing the view */
export function lookoutSeats(): NookSeat[] {
  return LOOKOUT.benches.map((b) => ({ x: b.x + Math.sin(b.ry) * 0.2, y: LOOKOUT.deck + 0.5 + SIT, z: b.z + Math.cos(b.ry) * 0.2, yaw: b.ry }));
}
/** Is local (x, z) on the deck (or its front step)? Returns the floor height, else null. */
export function lookoutFloor(x: number, z: number): number | null {
  const A = LOOKOUT.apothem + 0.05;
  if (Math.abs(x) <= A && Math.abs(z) <= A && Math.abs(x) + Math.abs(z) <= A * Math.SQRT2 + 0.1) return LOOKOUT.deck;
  if (Math.abs(x) <= 0.65 && z > A && z <= A + 0.45) return LOOKOUT.deck * 0.5;
  return null;
}

export function buildLookout(o: BuildOpts): THREE.Group {
  const root = new THREE.Group();
  root.name = 'lookout';
  const k = new Kit(o.seed + 421);
  const L = LOOKOUT, D = L.deck, A = L.apothem, C = A * Math.SQRT2;
  const side = 2 * A * Math.tan(Math.PI / 8);
  // deck: planks across, clipped to the octagon; fascia boards round the rim; footing posts
  k.surf(['planks', { axis: 'x', scale: 0.9 }], () => {
    for (let z = -A + 0.14; z < A; z += 0.28) {
      const hw = Math.min(A, C - Math.abs(z) - 0.1);
      k.box(hw * 2, 0.07, 0.26, Math.round(z / 0.28) % 3 ? PAL.plank : PAL.woodLight, { y: D - 0.035, z });
    }
  });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    k.box(side + 0.05, 0.16, 0.08, PAL.woodDark, { x: Math.sin(a) * (A - 0.02), y: D - 0.1, z: Math.cos(a) * (A - 0.02), ry: a });
    const va = a + Math.PI / 8, vr = A / Math.cos(Math.PI / 8);
    k.cyl(0.09, D - 0.02, PAL.woodDark, { x: Math.sin(va) * (vr - 0.12), y: (D - 0.02) / 2, z: Math.cos(va) * (vr - 0.12) }, 6);
  }
  // the front step
  k.surf(['planks', { axis: 'x' }], () => k.box(1.2, D * 0.5, 0.4, PAL.wood, { y: D * 0.25, z: A + 0.2 }));
  // railing on every side but the front (the way in)
  const vr = A / Math.cos(Math.PI / 8);
  for (let i = 1; i < 8; i++) {
    const a0 = (i / 8) * TAU - Math.PI / 8, a1 = a0 + TAU / 8;
    const p0 = { x: Math.sin(a0) * (vr - 0.1), z: Math.cos(a0) * (vr - 0.1) }, p1 = { x: Math.sin(a1) * (vr - 0.1), z: Math.cos(a1) * (vr - 0.1) };
    for (const p of i === 1 ? [p0, p1] : [p1]) {
      k.box(0.11, 0.95, 0.11, PAL.wood, { x: p.x, y: D + 0.475, z: p.z, ry: a0 });
      k.cone(0.09, 0.12, PAL.woodDark, { x: p.x, y: D + 1.01, z: p.z, ry: Math.PI / 4 }, 4);
    }
    k.beam(p0.x, D + 0.9, p0.z, p1.x, D + 0.9, p1.z, 0.09, PAL.woodLight, 'solid', 0.12);
    k.beam(p0.x, D + 0.45, p0.z, p1.x, D + 0.45, p1.z, 0.06, PAL.wood);
    // crossed balusters
    k.beam(p0.x, D + 0.05, p0.z, p1.x, D + 0.86, p1.z, 0.045, PAL.wood);
    k.beam(p1.x, D + 0.05, p1.z, p0.x, D + 0.86, p0.z, 0.045, PAL.wood);
  }
  // the telescope: brass tube on a tripod, aimed up over the valley
  k.part('telescope', () => {
    const t = L.telescope;
    const apex = new THREE.Vector3(t.x, D + 0.98, t.z);
    for (let i = 0; i < 3; i++) {
      const a = t.yaw + (i / 3) * TAU + 0.5;
      k.rod(t.x + Math.sin(a) * 0.42, D, t.z + Math.cos(a) * 0.42, apex.x, apex.y - 0.05, apex.z, 0.025, PAL.woodDark, 5);
      k.cyl(0.035, 0.03, PAL.metalDark, { x: t.x + Math.sin(a) * 0.42, y: D + 0.015, z: t.z + Math.cos(a) * 0.42 }, 5);
    }
    k.cyl(0.08, 0.1, PAL.metalDark, { x: apex.x, y: apex.y, z: apex.z }, 6);
    const d = new THREE.Vector3(Math.sin(t.yaw) * Math.cos(t.pitch), Math.sin(t.pitch), Math.cos(t.yaw) * Math.cos(t.pitch));
    const e = apex.clone().addScaledVector(d, -0.42).add(new THREE.Vector3(0, 0.1, 0)), f = apex.clone().addScaledVector(d, 0.75).add(new THREE.Vector3(0, 0.1, 0));
    k.rod(e.x, e.y, e.z, f.x, f.y, f.z, 0.085, 0xc9a24a, 8);
    const g = apex.clone().addScaledVector(d, 0.62).add(new THREE.Vector3(0, 0.1, 0));
    k.rod(g.x, g.y, g.z, f.x + d.x * 0.08, f.y + d.y * 0.08, f.z + d.z * 0.08, 0.105, 0x8a6a2a, 8); // dew shield
    const h = apex.clone().addScaledVector(d, -0.55).add(new THREE.Vector3(0, 0.1, 0));
    k.rod(h.x, h.y, h.z, e.x, e.y, e.z, 0.035, PAL.ink, 6); // eyepiece
    const s0 = apex.clone().addScaledVector(d, -0.1).add(new THREE.Vector3(0, 0.22, 0)), s1 = s0.clone().addScaledVector(d, 0.32);
    k.rod(s0.x, s0.y, s0.z, s1.x, s1.y, s1.z, 0.025, 0xc9a24a, 6); // finder scope
    k.rod(apex.x, apex.y + 0.04, apex.z, apex.x, apex.y + 0.11, apex.z, 0.03, PAL.metalDark, 5);
  });
  for (const b of L.benches) bench(k, { x: b.x, y: D, z: b.z, ry: b.ry }, L.benchW);
  lampPost(k, { x: L.lamp.x, y: D, z: L.lamp.z }, 2.4);
  // a crate of rolled star charts and a folded blanket beside the right bench
  const cr = L.crate;
  crate(k, { x: cr.x, y: D, z: cr.z, ry: 0.4 }, 0.42);
  k.part('starCharts', () => {
    for (let i = 0; i < 3; i++) k.cyl(0.04, 0.38, [0xf3e6cc, 0xe8dcc8, 0xdbe6f0][i], { x: cr.x + (i - 1) * 0.09, y: D + 0.46, z: cr.z, rz: Math.PI / 2, ry: 0.4 + (i - 1) * 0.1 }, 6);
    k.surf(['fabric', { scale: 0.4 }], () => k.box(0.42, 0.1, 0.3, 0x5a7fd6, { x: cr.x - 0.05, y: D + 0.05, z: cr.z + 0.6, ry: -0.2 }));
  });
  // the sign by the step: a painted night sky with a star and a moon
  k.part('starSign', () => k.at({ x: -1.15, z: A + 0.75, ry: 0.2 }, () => {
    k.box(0.1, 1.15, 0.1, PAL.woodDark, { y: 0.575 });
    k.box(0.78, 0.48, 0.06, 0x2f3f6a, { y: 1.12, z: 0.06 });
    k.box(0.84, 0.06, 0.08, PAL.wood, { y: 1.38, z: 0.06 });
    const star: [number, number][] = [];
    for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU, r = i % 2 ? 0.055 : 0.13; star.push([Math.sin(a) * r, Math.cos(a) * r]); }
    k.prism(star, 0.02, PAL.yellow, { x: -0.15, y: 1.13, z: 0.1 });
    k.cyl(0.1, 0.02, 0xf6efc8, { x: 0.18, y: 1.12, z: 0.1, rx: Math.PI / 2 }, 10);
    k.cyl(0.085, 0.022, 0x2f3f6a, { x: 0.22, y: 1.15, z: 0.105, rx: Math.PI / 2 }, 10);
    for (const [x, y] of [[0.0, 1.28], [0.3, 0.98], [-0.3, 0.97], [0.08, 0.96]]) k.box(0.025, 0.025, 0.02, PAL.white, { x, y, z: 0.1, rz: 0.78 });
  }));
  k.build(root, o.night);

  // the pennant on its pole, flapping in the wind
  const pk = new Kit(9);
  pk.rod(0, 0, 0, 0, 2.3, 0, 0.03, PAL.woodDark, 5);
  pk.ball(0.05, PAL.yellow, { y: 2.33 });
  const pole = pk.mesh();
  pole.position.set(L.pennant.x, D, L.pennant.z);
  root.add(pole);
  const fk = new Kit(10);
  fk.prism([[0, 0.16], [0.62, 0], [0, -0.16]], 0.015, 0x3f6ac8, { x: 0 });
  fk.prism([[0, 0.07], [0.3, 0.02], [0, -0.05]], 0.02, PAL.yellow, { x: 0.02 });
  const flag = fk.mesh();
  flag.castShadow = false;
  flag.position.set(L.pennant.x, D + 2.12, L.pennant.z);
  root.add(flag);
  const rig: Rig = {
    update(e: Env) {
      // the flag (built along +x) streams downwind; the root's yaw is the structure's
      flag.rotation.y = Math.atan2(-e.wind.z, e.wind.x) - root.rotation.y + Math.sin(e.t * 2.3) * 0.12;
      const w = Math.min(1, Math.hypot(e.wind.x, e.wind.z) / 3);
      flag.rotation.x = Math.sin(e.t * 7.1) * 0.12 * (0.4 + w);
      flag.scale.set(0.85 + w * 0.15 + Math.sin(e.t * 5) * 0.04, 1, 1);
    },
  };
  root.userData.rig = rig;
  return root;
}

// ---------------------------------------------------------------------------------------------
// Hot-spring foot-bath

export const SPRING = Object.freeze({
  /** pool centre (local) and inner radius */
  cx: 0, cz: 0.2, r: 1.75,
  /** water surface height */
  water: 0.36,
  /** rim slab top */
  rim: 0.46,
  /** slab seats on the rim: angle round the pool (0 = front), at `seatR` from its centre (1.87 m apart: a Clawd with
   * its arm nubs is 1.6–1.75 m wide) */
  seatAngles: [Math.PI, Math.PI - 0.95, Math.PI + 0.95] as readonly number[],
  seatR: 2.05,
  lanterns: [{ x: -2.75, z: 1.45 }, { x: 2.95, z: -1.75 }],
  spout: { x: 2.3, z: 1.85 },
});
/** rim seats (local): on the slab, facing the pool centre, feet in the water */
export function springSeats(): NookSeat[] {
  const S = SPRING;
  return S.seatAngles.map((a) => ({ x: S.cx + Math.sin(a) * S.seatR, y: S.rim + SIT, z: S.cz + Math.cos(a) * S.seatR, yaw: a + Math.PI }));
}

export function buildHotSpring(o: BuildOpts): THREE.Group {
  const root = new THREE.Group();
  root.name = 'hotspring';
  const k = new Kit(o.seed + 431);
  const S = SPRING;
  // the pool: basin, water and the lumpy rim stones (one part: soakers' feet dangle into it)
  const seatA = S.seatAngles, B = S.r + 0.13;
  // rim stones keep clear of a seated farmer's width (body and arm nubs ±0.9 m round the seat)
  const near = (a: number) => seatA.some((s) => Math.abs(Math.atan2(Math.sin(a - s), Math.cos(a - s))) < 1.1 / S.seatR);
  k.part('pool', () => {
    k.surf(['fieldstone', { axis: 'h', scale: 0.5 }], () => k.cyl(B, 0.33, PAL.rockDark, { x: S.cx, y: 0.165, z: S.cz }, 18));
    k.surf(['plain', {}], () => k.cyl(S.r, 0.04, 0x6cc9c4, { x: S.cx, y: S.water - 0.02, z: S.cz }, 18));
    k.cyl(0.7, 0.012, 0x9fe0da, { x: S.cx + 0.3, y: S.water + 0.004, z: S.cz + 0.25 }, 10); // a lighter shallow patch
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * TAU + 0.1;
      if (near(a)) continue;
      k.surf('rock', () => k.blob(0.27 + k.r() * 0.08, [PAL.stone, 0xa9a294, PAL.rock][i % 3], { x: S.cx + Math.sin(a) * (B + 0.08), y: 0.3, z: S.cz + Math.cos(a) * (B + 0.08), s: [1.15, 0.8, 1], ry: a }));
    }
  });
  // flat slab seats on the back rim, each on a footing
  for (const a of seatA) k.part('seatSlab', () => k.surf(['fieldstone', { scale: 0.5 }], () => {
    k.box(1.0, 0.14, 0.56, 0xc9c2b4, { x: S.cx + Math.sin(a) * (S.seatR + 0.02), y: S.rim - 0.07, z: S.cz + Math.cos(a) * (S.seatR + 0.02), ry: a });
    k.box(0.86, S.rim - 0.14, 0.34, 0xa9a294, { x: S.cx + Math.sin(a) * (S.seatR + 0.11), y: (S.rim - 0.14) / 2, z: S.cz + Math.cos(a) * (S.seatR + 0.11), ry: a });
  }));
  // stepping stones up from the path
  for (const [x, z, r] of [[0.1, 2.85, 0.2], [-0.2, 3.35, 0.5]] as const) k.surf(['rock', { scale: 0.5 }], () => k.cyl(0.24, 0.05, 0xb8b0a0, { x, y: 0.02, z, ry: r }, 7));
  // the bath-house screen behind: four posts, slatted back wall, a small shingled roof, towels on a rail
  k.part('bathScreen', () => {
    for (const [x, z, h] of [[-1.6, -2.95, 2.25], [1.6, -2.95, 2.25], [-1.6, -3.55, 1.95], [1.6, -3.55, 1.95]] as const) k.box(0.14, h, 0.14, PAL.woodDark, { x, y: h / 2, z });
    for (let i = 0; i < 15; i++) k.box(0.16, 1.7, 0.05, i % 2 ? PAL.plank : PAL.woodLight, { x: -1.47 + i * 0.21, y: 0.95, z: -3.56 });
    k.box(3.3, 0.1, 0.12, PAL.woodDark, { y: 1.85, z: -3.56 });
    k.slab(3.9, 0.08, 1.2, PAL.roofGreen, ['shingle', { scale: 0.8 }], { y: 2.18, z: -3.25, rx: 0.32 });
    k.box(3.0, 0.05, 0.05, PAL.metal, { y: 1.25, z: -3.44 });
    const towels = [0xf08aa8, 0x7fb8e0, 0xf6efe0, 0xf2c33a];
    for (let i = 0; i < 4; i++) k.surf(['fabric', { scale: 0.4 }], () => k.box(0.42, 0.62, 0.03, towels[i], { x: -1.05 + i * 0.7, y: 0.96, z: -3.41 }));
    // a stool of folded towels and a wooden bucket with a ladle
    k.surf(['fabric', { scale: 0.4 }], () => { for (let i = 0; i < 3; i++) k.box(0.36, 0.07, 0.28, towels[(i + 1) % 4], { x: -2.75, y: 0.52 + i * 0.07, z: -2.45, ry: 0.15 * i }); });
  });
  stool(k, { x: -2.75, z: -2.45 });
  bucket(k, { x: 2.5, z: -2.75 }, true);
  // bamboo spout from a mossy rock, a trickle into the pool
  k.part('spout', () => k.at({ x: S.spout.x, z: S.spout.z }, () => {
    k.surf('rock', () => k.blob(0.42, PAL.rock, { y: 0.32, s: [1, 0.85, 1] }));
    k.ball(0.2, PAL.leafDark, { x: -0.05, y: 0.62, z: 0.1, s: [1.4, 0.4, 1.2] });
    k.rod(0.0, 0.62, 0.0, -0.85, 0.74, -0.75, 0.05, 0x8fb04a, 6);
    k.cyl(0.055, 0.04, 0x6f8f3a, { x: -0.42, y: 0.68, z: -0.37, rz: Math.PI / 2, ry: 0.85 }, 6);
    k.rod(-0.89, 0.72, -0.79, -0.91, S.water + 0.01, -0.82, 0.022, 0xbfe8f0, 5);
  }));
  // stone lanterns (tōrō) with a warm flame
  for (const l of S.lanterns) k.part('stoneLantern', () => k.at({ x: l.x, z: l.z, ry: 0.3 }, () => {
    k.surf('rock', () => {
      k.box(0.52, 0.12, 0.52, PAL.stone, { y: 0.06 });
      k.cyl(0.1, 0.55, 0xa9a294, { y: 0.395 }, 6);
      k.box(0.44, 0.08, 0.44, PAL.stone, { y: 0.71 });
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) k.box(0.06, 0.26, 0.06, PAL.stone, { x: x * 0.15, y: 0.88, z: z * 0.15 });
      k.cone(0.4, 0.24, PAL.stone, { y: 1.13, ry: Math.PI / 4 }, 4);
      k.ball(0.06, PAL.stone, { y: 1.29 });
    });
    k.emit({ radius: 4.5, intensity: 0.5, flicker: 0.45 }, () => k.box(0.24, 0.22, 0.24, PAL.lampGlow, { y: 0.87 }, 'glow'));
  }));
  // a little sign: three wavy steam lines over a bowl
  k.part('springSign', () => k.at({ x: -2.05, z: 2.85, ry: 0.35 }, () => {
    k.box(0.09, 0.95, 0.09, PAL.woodDark, { y: 0.475 });
    k.box(0.56, 0.42, 0.05, PAL.plank, { y: 0.92, z: 0.05 });
    k.cyl(0.13, 0.02, 0x3fa8a0, { y: 0.83, z: 0.09, rx: Math.PI / 2 }, 10, 0.13);
    k.box(0.3, 0.06, 0.02, PAL.plank, { y: 0.86, z: 0.095 });
    for (let i = -1; i <= 1; i++) for (let j = 0; j < 3; j++) k.box(0.025, 0.06, 0.02, PAL.ink, { x: i * 0.09 + (j % 2 ? 0.015 : -0.015), y: 0.93 + j * 0.05, z: 0.095, rz: j % 2 ? 0.5 : -0.5 });
  }));
  // reeds and ferns round the back
  if (o.season !== 'winter') for (let i = 0; i < 9; i++) {
    const a = Math.PI * 0.55 + (i / 8) * Math.PI * 0.9, r = 2.75 + (i % 2) * 0.25;
    const x = S.cx + Math.sin(a) * r, z = S.cz + Math.cos(a) * r;
    if (Math.hypot(x + 2.75, z + 2.45) < 0.5 || Math.hypot(x - 2.5, z + 2.75) < 0.45 || Math.hypot(x - S.lanterns[1].x, z - S.lanterns[1].z) < 0.5) continue;
    if (z < -2.75 && Math.abs(x) < 1.8) continue; // not through the bath screen
    k.cone(0.16, 0.5, i % 2 ? PAL.leaf : PAL.leafDark, { x, y: 0.25, z }, 5);
  }
  k.build(root, o.night);

  // steam puffs and the rubber duck
  const PUFFS = 22;
  const steamMat = toon(0xf4f8ff, { transparent: true, opacity: 0.3, shared: false });
  steamMat.depthWrite = false;
  const steam = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.15, 1), steamMat, PUFFS);
  steam.frustumCulled = false;
  steam.castShadow = false;
  root.add(steam);
  const puffs = Array.from({ length: PUFFS }, (_, i) => ({ age: (i / PUFFS) * 3.2, life: 3.2, x: 0, z: 0, s: 0.8 + ((i * 37) % 10) / 20 }));
  const reset = (p: (typeof puffs)[number], i: number) => {
    const a = i * 2.39 + p.age * 3.1, r = Math.sqrt(((i * 53) % 17) / 17) * (S.r - 0.25);
    p.x = S.cx + Math.cos(a) * r; p.z = S.cz + Math.sin(a) * r;
  };
  puffs.forEach(reset);
  const dk = new Kit(11);
  dk.ball(0.09, PAL.yellow, { y: 0.03, s: [1.25, 0.8, 1] }, 1);
  dk.ball(0.062, PAL.yellow, { y: 0.12, z: 0.07 }, 1);
  dk.box(0.06, 0.02, 0.05, PAL.orange, { y: 0.11, z: 0.14 });
  dk.box(0.012, 0.025, 0.012, PAL.ink, { x: 0.04, y: 0.14, z: 0.11 });
  dk.box(0.012, 0.025, 0.012, PAL.ink, { x: -0.04, y: 0.14, z: 0.11 });
  dk.cone(0.04, 0.06, PAL.yellow, { y: 0.07, z: -0.1, rx: -1.0 }, 4);
  const duck = dk.mesh();
  duck.castShadow = false;
  root.add(duck);
  const d = new THREE.Object3D();
  const rig: Rig = {
    update(e: Env) {
      const t = e.t;
      const cool = 0.75 + e.night * 0.5;
      for (let i = 0; i < PUFFS; i++) {
        const p = puffs[i];
        p.age += e.dt;
        if (p.age > p.life) { p.age = 0; p.life = 2.6 + ((i * 29) % 10) / 10; reset(p, i); }
        const u = p.age / p.life;
        p.x += (e.wind.x * 0.06 + Math.sin(t * 0.9 + i) * 0.05) * e.dt;
        p.z += (e.wind.z * 0.06 + Math.cos(t * 0.8 + i * 1.3) * 0.05) * e.dt;
        d.position.set(p.x, S.water + 0.05 + u * 1.7, p.z);
        d.rotation.set(t * 0.3 + i, t * 0.2, 0);
        d.scale.set(1.25, 0.8, 1.25).multiplyScalar(p.s * cool * Math.sin(Math.min(1, u * 1.15) * Math.PI) * (0.5 + u * 1.1));
        d.updateMatrix();
        steam.setMatrixAt(i, d.matrix);
      }
      steam.instanceMatrix.needsUpdate = true;
      // the duck drifts round the pool on the current from the spout, bobbing
      const a = t * 0.11;
      duck.position.set(S.cx + Math.cos(a) * 0.55, S.water - 0.005 + Math.sin(t * 2.2) * 0.012, S.cz + Math.sin(a) * 0.55 * 0.8);
      duck.rotation.set(Math.sin(t * 1.7) * 0.08, -a + Math.PI, Math.sin(t * 2.1) * 0.1);
    },
  };
  root.userData.rig = rig;
  return root;
}
