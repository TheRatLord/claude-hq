/**
 * The farmhouse interior's static room: shell (plank floor, plastered walls over a wainscot, beamed ceiling, window
 * openings that really let the sun in), the hearth, and every piece of furniture, merged by the structures `Kit` into
 * one solid mesh (toon + surfaces) and one glow mesh (lamp glass, candles). Farmhouse-local frame (see layout.ts).
 * Live pieces (fire, clock, collection, tank, CRT screen, window views) are built in pieces.ts / view.ts.
 */
import * as THREE from 'three';
import type { Season } from '../../model/types.ts';
import { PAL } from '../toon.ts';
import { Kit } from '../structures/kit.ts';
import type { Xf } from '../structures/kit.ts';
import { flowerColors } from '../structures/props.ts';
import { DOOR, FURN, ROOM, SHELF_ROWS, WINDOWS } from './layout.ts';
import { tankDressing } from './pieces.ts';

export interface RoomOpts { season: Season; seed?: number; /** gallery: leave out the ceiling and the front and east walls */ cutaway?: boolean }

const F = ROOM.floor, CEIL = ROOM.ceil, T = ROOM.wall;
const WAIN = 0.74; // wainscot height above the floor (below the window sills)
const PLASTER = 0xf3e6c8, WAINSCOT = 0x8a5a36, TRIM = 0x6e4a2a, BEAM = 0x5a3a24, FLOOR = 0xb07a4a;
const QUILT = [0xd9644a, 0xf2c35a, 0x6fa86a, 0x5a86b8, 0xf0e2c0, 0xc0587a];
const BOOKS = [0x9a3a32, 0x3f5f8a, 0x4f7a4a, 0xc9963a, 0x6a4a8a, 0x8a5a36, 0x2f5a5a, 0xb8483a, 0xd8c8a0];

interface Hole { a0: number; a1: number; y0: number; y1: number }

/** A wall along a horizontal axis, with rectangular holes (sorted, non-overlapping): solid boxes around them. */
function holedWall(k: Kit, along: 'x' | 'z', fixed: number, a0: number, a1: number, y0: number, y1: number, th: number, holes: Hole[], color: number): void {
  const box = (b0: number, b1: number, c0: number, c1: number) => {
    if (b1 - b0 < 0.005 || c1 - c0 < 0.005) return;
    const m = (b0 + b1) / 2, l = b1 - b0, h = c1 - c0, y = (c0 + c1) / 2;
    if (along === 'x') k.box(l, h, th, color, { x: m, y, z: fixed });
    else k.box(th, h, l, color, { x: fixed, y, z: m });
  };
  let cur = a0;
  for (const h of [...holes].sort((p, q) => p.a0 - q.a0)) {
    box(cur, h.a0, y0, y1);
    box(h.a0, h.a1, y0, Math.max(y0, h.y0));
    box(h.a0, h.a1, Math.min(y1, h.y1), y1);
    cur = h.a1;
  }
  box(cur, a1, y0, y1);
}

/** A little potted plant (pot base at y = 0). */
function pottedPlant(k: Kit, t: Xf, s = 1, leaf: number = PAL.leaf, pot = 0xb8643a): void {
  k.at(t, () => {
    k.cyl(0.11 * s, 0.16 * s, pot, { y: 0.08 * s }, 7, 0.14 * s);
    k.cyl(0.15 * s, 0.035 * s, 0xa05530, { y: 0.165 * s }, 7);
    k.cyl(0.12 * s, 0.02 * s, PAL.soil, { y: 0.17 * s }, 7);
    for (let i = 0; i < 5; i++) {
      const a = i * 1.26 + 0.3;
      k.blob(0.09 * s, i % 2 ? leaf : PAL.leafDark, { x: Math.sin(a) * 0.07 * s, y: (0.26 + (i % 3) * 0.05) * s, z: Math.cos(a) * 0.07 * s, s: [1, 1.3, 1] });
    }
  });
}

function candle(k: Kit, t: Xf, h = 0.14): void {
  k.at(t, () => {
    k.cyl(0.05, 0.02, PAL.metal, { y: 0.01 }, 7);
    k.cyl(0.025, h, 0xf6eedc, { y: 0.02 + h / 2 }, 6);
    k.emit(false, () => k.box(0.025, 0.05, 0.025, PAL.lampGlow, { y: 0.02 + h + 0.03 }, 'glow'));
  });
}

function book(k: Kit, t: Xf, w: number, h: number, d: number, color: number): void {
  k.at(t, () => {
    k.box(w, h, d, color, { y: h / 2 });
    k.box(w + 0.004, h * 0.86, d * 0.9, 0xf2e8d0, { y: h / 2, z: 0.012 }); // page block peeks out
    k.box(w + 0.006, 0.012, d * 0.2, PAL.yellow, { y: h * 0.8, z: -d / 2 + 0.002 });
  });
}

function chair(k: Kit, t: Xf, color: number = PAL.wood): void {
  k.at(t, () => {
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box(0.05, 0.44, 0.05, color, { x: x * 0.18, y: 0.22, z: z * 0.17 });
    k.box(0.44, 0.05, 0.42, color, { y: 0.46 });
    k.box(0.36, 0.035, 0.34, 0xc9453b, { y: 0.495 }); // cushion
    for (const x of [-0.18, 0.18]) k.box(0.05, 0.5, 0.05, color, { x, y: 0.72, z: -0.18 });
    k.box(0.42, 0.12, 0.04, color, { y: 0.9, z: -0.18 });
    k.box(0.42, 0.06, 0.03, color, { y: 0.66, z: -0.18 });
  });
}

export function buildRoom(o: RoomOpts): THREE.Group {
  const root = new THREE.Group();
  root.name = 'interior-room';
  const k = new Kit((o.seed ?? 1) * 97 + 11);
  const { x0, x1, z0, z1 } = ROOM;
  const flowers = flowerColors(o.season);

  // ---------------------------------------------------------------- shell
  k.part('floor', () => {
    k.surf(['planks', { axis: 'x', scale: 0.85, variant: 0 }], () => k.box(x1 - x0 + 2 * T, 0.12, z1 - z0 + 2 * T, FLOOR, { y: F - 0.06, z: (z0 + z1) / 2 }));
    // skirting
    k.box(x1 - x0, 0.1, 0.03, TRIM, { y: F + 0.05, z: z0 + 0.015 });
    k.box(0.03, 0.1, z1 - z0, TRIM, { x: x0 + 0.015, y: F + 0.05, z: (z0 + z1) / 2 });
    k.box(0.03, 0.1, z1 - z0, TRIM, { x: x1 - 0.015, y: F + 0.05, z: (z0 + z1) / 2 });
  });
  const front: Hole[] = [{ a0: DOOR.x - DOOR.w / 2, a1: DOOR.x + DOOR.w / 2, y0: F - 0.01, y1: F + DOOR.h }];
  const east: Hole[] = [];
  for (const w of WINDOWS) (w.wall === 'front' ? front : east).push({ a0: w.at - w.w / 2, a1: w.at + w.w / 2, y0: w.y - w.h / 2, y1: w.y + w.h / 2 });
  k.part('walls', () => {
    k.surf(['plaster', { strength: 0.45, scale: 0.8 }], () => {
      holedWall(k, 'x', z0 - T / 2, x0 - T, x1 + T, F, CEIL + 0.05, T, [], PLASTER);
      holedWall(k, 'z', x0 - T / 2, z0, z1, F, CEIL + 0.05, T, [], PLASTER);
      if (!o.cutaway) {
        holedWall(k, 'x', z1 + T / 2, x0 - T, x1 + T, F, CEIL + 0.05, T, front, PLASTER);
        holedWall(k, 'z', x1 + T / 2, z0, z1, F, CEIL + 0.05, T, east, PLASTER);
      }
    });
    // wainscot (boards up to below the sills) and a chair rail
    const wy = F + WAIN / 2;
    k.surf(['planks', { axis: 'y', scale: 0.7, variant: 2, strength: 0.7 }], () => {
      holedWall(k, 'x', z0 + 0.02, x0, x1, F, F + WAIN, 0.04, [], WAINSCOT);
      holedWall(k, 'z', x0 + 0.02, z0, z1, F, F + WAIN, 0.04, [], WAINSCOT);
      if (!o.cutaway) {
        holedWall(k, 'x', z1 - 0.02, x0, x1, F, F + WAIN, 0.04, front.slice(0, 1), WAINSCOT);
        holedWall(k, 'z', x1 - 0.02, z0, z1, F, F + WAIN, 0.04, [], WAINSCOT);
      }
    });
    void wy;
    k.box(x1 - x0, 0.05, 0.07, TRIM, { y: F + WAIN + 0.02, z: z0 + 0.035 });
    k.box(0.07, 0.05, z1 - z0, TRIM, { x: x0 + 0.035, y: F + WAIN + 0.02, z: (z0 + z1) / 2 });
    if (!o.cutaway) {
      for (const [a, b] of [[x0, DOOR.x - DOOR.w / 2 - 0.1], [DOOR.x + DOOR.w / 2 + 0.1, x1]]) k.box(b - a, 0.05, 0.07, TRIM, { x: (a + b) / 2, y: F + WAIN + 0.02, z: z1 - 0.035 });
      k.box(0.07, 0.05, z1 - z0, TRIM, { x: x1 - 0.035, y: F + WAIN + 0.02, z: (z0 + z1) / 2 });
    }
  });
  if (!o.cutaway) k.part('ceiling', () => {
    k.surf(['planks', { axis: 'z', scale: 0.8, variant: 1, strength: 0.6 }], () => k.box(x1 - x0 + 2 * T, 0.1, z1 - z0 + 2 * T, 0xc89a68, { y: CEIL + 0.05, z: (z0 + z1) / 2 }));
    for (let x = x0 + 0.75; x < x1 - 0.3; x += 1.45) k.surf(['logs', { axis: 'z', strength: 0.7 }], () => k.box(0.2, 0.2, z1 - z0, BEAM, { x, y: CEIL - 0.1, z: (z0 + z1) / 2 }));
    k.surf(['logs', { axis: 'x', strength: 0.7 }], () => k.box(x1 - x0, 0.24, 0.26, BEAM, { y: CEIL - 0.12, z: -1.2 }));
  });
  // corner posts (the timber frame shows inside too)
  for (const [x, z] of [[x0 + 0.08, z0 + 0.08], [x1 - 0.08, z0 + 0.08], [x0 + 0.08, z1 - 0.08], [x1 - 0.08, z1 - 0.08]]) if (!o.cutaway || z < 0 && x < 0) k.box(0.16, CEIL - F, 0.16, BEAM, { x, y: (F + CEIL) / 2, z });

  // ---------------------------------------------------------------- windows (inner frame, sill, mullions, curtains)
  for (const w of WINDOWS) {
    if (o.cutaway) continue;
    const isFront = w.wall === 'front';
    const t: Xf = isFront ? { x: w.at, y: w.y, z: z1 } : { x: x1, y: w.y, z: w.at, ry: Math.PI / 2 };
    k.part(`window:${w.id}`, () => k.at(t, () => {
      // reveal: the opening runs through the wall (local −z is the room, +z is outside)
      k.box(w.w + 0.16, 0.08, 0.06, PAL.wallWhite, { y: w.h / 2 + 0.04, z: -0.03 });
      for (const s of [-1, 1]) k.box(0.08, w.h + 0.16, 0.06, PAL.wallWhite, { x: s * (w.w / 2 + 0.04), z: -0.03 });
      k.box(w.w + 0.3, 0.06, 0.26, PAL.wallWhite, { y: -w.h / 2 - 0.03, z: -0.06 }); // deep sill
      // mullions: a cross in the middle of the opening (they throw a cross into the sun patch)
      k.box(0.05, w.h, 0.05, PAL.wallWhite, { z: T * 0.5 });
      k.box(w.w, 0.05, 0.05, PAL.wallWhite, { z: T * 0.5 });
      // sill plants
      pottedPlant(k, { x: -w.w * 0.28, y: -w.h / 2, z: -0.08 }, 0.8, isFront ? PAL.leaf : 0x6fae5a, 0xc8743a);
      if (isFront) k.at({ x: w.w * 0.3, y: -w.h / 2, z: -0.08 }, () => {
        k.cyl(0.06, 0.12, 0xdde8f0, { y: 0.06 }, 7, 0.045);
        for (let i = 0; i < 3; i++) { k.rod(0, 0.1, 0, (i - 1) * 0.05, 0.22, 0.01, 0.006, PAL.leafDark); k.ball(0.03, flowers[i % flowers.length], { x: (i - 1) * 0.05, y: 0.23, z: 0.01 }); }
      });
      // curtain rod and gingham curtains tied back
      k.rod(-w.w / 2 - 0.3, w.h / 2 + 0.16, -0.1, w.w / 2 + 0.3, w.h / 2 + 0.16, -0.1, 0.015, PAL.woodDark);
      for (const s of [-1, 1]) {
        k.surf(['fabric', { strength: 0.8 }], () => {
          k.box(0.26, w.h + 0.2, 0.05, isFront ? 0xc8574a : 0x5a86b8, { x: s * (w.w / 2 + 0.12), y: 0.04, z: -0.12 });
          k.box(0.2, 0.3, 0.06, isFront ? 0xe8d6c0 : 0xf0e2c0, { x: s * (w.w / 2 + 0.12), y: -w.h * 0.2, z: -0.13 });
        });
      }
    }));
  }

  // ---------------------------------------------------------------- the door (inside face) and doormat, coat hooks
  if (!o.cutaway) k.part('door', () => k.at({ x: DOOR.x, z: z1 }, () => {
    k.surf(['planks', { variant: 2, scale: 1.1, strength: 0.8 }], () => k.box(DOOR.w, DOOR.h, 0.08, 0x3f6fa0, { y: F + DOOR.h / 2, z: 0.02 }));
    for (const y of [0.4, 1.7]) k.box(DOOR.w - 0.1, 0.12, 0.04, 0x355f8a, { y: F + y, z: -0.03 });
    k.beam(-DOOR.w / 2 + 0.1, F + 0.46, -0.03, DOOR.w / 2 - 0.1, F + 1.64, -0.03, 0.1, 0x355f8a, 'solid', 0.04);
    k.ball(0.05, PAL.yellow, { x: DOOR.w / 2 - 0.16, y: F + 1.0, z: -0.07 });
    k.box(DOOR.w + 0.24, 0.12, 0.06, TRIM, { y: F + DOOR.h + 0.06, z: -0.03 });
    for (const s of [-1, 1]) k.box(0.1, DOOR.h, 0.06, TRIM, { x: s * (DOOR.w / 2 + 0.05), y: F + DOOR.h / 2, z: -0.03 });
    // a horseshoe over the door, for luck
    k.add(new THREE.TorusGeometry(0.09, 0.018, 4, 10, Math.PI * 1.3), PAL.metalDark, { y: F + DOOR.h + 0.28, z: -0.03, rz: -Math.PI * 0.15 + Math.PI });
  }));
  k.part('doormat', () => {
    k.surf(['fabric', { strength: 0.9, scale: 0.6 }], () => k.box(1.1, 0.02, 0.62, 0xa0703f, { y: F + 0.01, z: z1 - 0.5 }));
    k.box(0.9, 0.022, 0.42, 0xc89a58, { y: F + 0.012, z: z1 - 0.5 });
  });
  k.part('hooks', () => k.at({ x: FURN.hooks.x + 0.25, y: F + 1.65, z: z1 - 0.03 }, () => {
    k.box(0.8, 0.12, 0.04, PAL.woodLight);
    for (let i = 0; i < 3; i++) k.rod(-0.28 + i * 0.28, 0, -0.02, -0.28 + i * 0.28, 0.04, -0.12, 0.018, PAL.woodDark);
    // a straw hat and a knitted scarf
    k.at({ x: -0.28, y: -0.04, z: -0.16, rx: -0.5 }, () => { k.cyl(0.2, 0.025, PAL.hay, {}, 10); k.cyl(0.1, 0.1, PAL.hay, { y: 0.06 }, 10, 0.08); k.cyl(0.105, 0.03, PAL.red, { y: 0.03 }, 10); });
    k.surf(['fabric', { strength: 0.9 }], () => { k.box(0.12, 0.6, 0.04, 0x5a86b8, { x: 0.28, y: -0.32, z: -0.1 }); k.box(0.12, 0.45, 0.04, 0xf2c35a, { x: 0.36, y: -0.26, z: -0.08 }); });
    k.box(0.3, 0.42, 0.18, 0x7a5a3a, { x: 0, y: -0.3, z: -0.12 }); // satchel
  }));
  // an umbrella in a crock by the door
  k.part('umbrella', () => k.at({ x: -0.95, y: F, z: z1 - 0.2 }, () => {
    k.cyl(0.11, 0.38, 0x8a6a4a, { y: 0.19 }, 8, 0.13);
    k.cyl(0.03, 0.75, PAL.red, { y: 0.55, rz: 0.08 }, 6, 0.06);
    k.add(new THREE.TorusGeometry(0.05, 0.012, 4, 8, Math.PI), PAL.woodDark, { x: 0.07, y: 0.95, rz: 0 });
  }));

  // ---------------------------------------------------------------- the hearth (east wall)
  const H = FURN.hearth, hz0 = H.z - H.d / 2, hz1 = H.z + H.d / 2, hx0 = H.x - H.w / 2;
  const OW = 0.95, OH = 0.9; // firebox opening
  k.part('hearth', () => {
    k.surf(['fieldstone', { axis: 'h', scale: 0.55 }], () => {
      // piers either side of the opening, the breast above it
      k.box(H.w, CEIL - F, (H.d - OW) / 2, PAL.stone, { x: H.x, y: (F + CEIL) / 2, z: hz0 + (H.d - OW) / 4 });
      k.box(H.w, CEIL - F, (H.d - OW) / 2, PAL.stone, { x: H.x, y: (F + CEIL) / 2, z: hz1 - (H.d - OW) / 4 });
      k.box(H.w, CEIL - F - OH, OW, PAL.stone, { x: H.x, y: F + OH + (CEIL - F - OH) / 2, z: H.z });
      // raised hearth slab
      k.box(FURN.hearthSlab.w + H.w, 0.12, FURN.hearthSlab.d, 0xa8a196, { x: FURN.hearthSlab.x + H.w / 2, y: F + 0.06, z: H.z });
    });
    // sooty firebox
    k.box(0.08, OH, OW, 0x2a221e, { x: x1 - 0.06, y: F + OH / 2, z: H.z });
    k.box(H.w - 0.1, 0.05, OW, 0x3a302a, { x: H.x + 0.05, y: F + 0.14, z: H.z });
    for (const s of [-1, 1]) k.box(H.w - 0.1, OH, 0.05, 0x3a302a, { x: H.x + 0.05, y: F + OH / 2, z: H.z + s * (OW / 2 - 0.02) });
    k.box(H.w - 0.1, 0.06, OW, 0x2a221e, { x: H.x + 0.05, y: F + OH - 0.03, z: H.z });
    // lintel beam and the mantel shelf
    k.surf(['logs', { axis: 'z', strength: 0.7 }], () => k.box(0.18, 0.2, OW + 0.5, BEAM, { x: hx0 - 0.02, y: F + OH + 0.1, z: H.z }));
    k.surf(['planks', { axis: 'z', strength: 0.7 }], () => k.box(0.32, 0.07, H.d + 0.2, PAL.woodDark, { x: hx0 - 0.08, y: F + 1.3, z: H.z }));
    for (const s of [-1, 1]) k.box(0.1, 0.14, 0.1, PAL.woodDark, { x: hx0 - 0.05, y: F + 1.2, z: H.z + s * (H.d / 2 - 0.05) });
    // andirons and logs (the fire itself is live, pieces.ts)
    for (const s of [-1, 1]) { k.box(0.32, 0.04, 0.04, PAL.ink, { x: H.x - 0.02, y: F + 0.2, z: H.z + s * 0.24 }); k.box(0.04, 0.16, 0.04, PAL.ink, { x: hx0 + 0.05, y: F + 0.26, z: H.z + s * 0.24 }); k.ball(0.03, PAL.metalDark, { x: hx0 + 0.05, y: F + 0.36, z: H.z + s * 0.24 }); }
    k.surf(['logs', { axis: 'z' }], () => {
      k.cyl(0.07, 0.62, PAL.bark, { x: H.x, y: F + 0.28, z: H.z, rx: Math.PI / 2 }, 6);
      k.cyl(0.065, 0.58, 0x6a4a30, { x: H.x - 0.1, y: F + 0.36, z: H.z + 0.05, rx: Math.PI / 2, ry: 0.4 }, 6);
      k.cyl(0.06, 0.55, PAL.bark, { x: H.x + 0.06, y: F + 0.36, z: H.z - 0.05, rx: Math.PI / 2, ry: -0.5 }, 6);
    });
    // mantel things: candles, a jar of matches, a little framed photo of the farmers, a sprig of dried flowers
    const my = F + 1.335;
    candle(k, { x: hx0 - 0.1, y: my, z: hz0 + 0.12 }, 0.18);
    candle(k, { x: hx0 - 0.1, y: my, z: hz0 + 0.24 }, 0.12);
    candle(k, { x: hx0 - 0.1, y: my, z: hz1 - 0.12 }, 0.16);
    k.cyl(0.05, 0.12, 0xdde8f0, { x: hx0 - 0.12, y: my + 0.06, z: hz1 - 0.3 }, 7);
    k.at({ x: hx0 - 0.1, y: my, z: H.z - 0.48, ry: -Math.PI / 2 - 0.25 }, () => {
      k.box(0.2, 0.16, 0.03, PAL.woodLight, { y: 0.09, rx: -0.15 });
      k.box(0.15, 0.11, 0.032, 0xe8a04a, { y: 0.09, rx: -0.15 });
      k.box(0.05, 0.05, 0.034, 0xd9773a, { x: -0.03, y: 0.08, rx: -0.15 });
      k.box(0.05, 0.05, 0.034, 0x9ad0e8, { x: 0.035, y: 0.085, rx: -0.15 });
    });
    k.at({ x: hx0 - 0.1, y: my, z: H.z + 0.45 }, () => {
      k.cyl(0.04, 0.14, 0x8aa0b8, { y: 0.07 }, 6, 0.03);
      for (let i = 0; i < 4; i++) k.ball(0.035, i % 2 ? flowers[0] : PAL.hay, { x: (i - 1.5) * 0.03, y: 0.2 + (i % 2) * 0.04, z: (i % 2) * 0.02 });
    });
    // poker and brush leaning on the slab
    k.rod(hx0 - 0.25, F + 0.12, hz1 + 0.02, hx0 - 0.12, F + 0.95, hz1 - 0.05, 0.012, PAL.ink);
    k.rod(hx0 - 0.3, F + 0.12, hz1 - 0.02, hx0 - 0.16, F + 0.8, hz1 - 0.1, 0.014, PAL.woodDark);
    k.box(0.08, 0.14, 0.05, PAL.hay, { x: hx0 - 0.29, y: F + 0.16, z: hz1 - 0.01 });
  });
  // dried herbs and garlic hanging from the beam by the hearth
  if (!o.cutaway) k.part('herbs', () => {
    for (let i = 0; i < 4; i++) {
      const x = 2.4 + i * 0.32, z = -1.2 + (i % 2 ? 0.06 : -0.06);
      k.rod(x, CEIL - 0.24, z, x, CEIL - 0.48, z, 0.006, PAL.cloth);
      if (i === 2) { for (let j = 0; j < 3; j++) k.ball(0.06, 0xf2e8d8, { x: x + (j - 1) * 0.05, y: CEIL - 0.55 - (j % 2) * 0.06, z }); }
      else {
        // a tied bundle: stems up top, a loose fan of leaves below
        k.box(0.03, 0.03, 0.03, PAL.cloth, { x, y: CEIL - 0.49, z });
        k.cone(0.045, 0.16, i % 2 ? 0x7a8a4a : 0x8a7a8a, { x, y: CEIL - 0.58, z, rx: Math.PI }, 5);
        k.blob(0.04, i % 2 ? 0x6a7a3a : 0x9a7aa0, { x, y: CEIL - 0.64, z, s: [1, 0.7, 1] });
      }
    }
  });

  // ---------------------------------------------------------------- the armchair, side table, rug, log basket, cat bed
  const A = FURN.armchair;
  k.part('armchair', () => k.at({ x: A.x, y: F, z: A.z, ry: A.yaw }, () => {
    const fab = 0x4f7a5a;
    k.surf(['fabric', { strength: 0.8, scale: 0.8 }], () => {
      k.box(0.86, 0.32, 0.8, fab, { y: 0.28 });
      k.box(0.62, 0.14, 0.62, 0x5f8a68, { y: 0.5, z: 0.05 });            // seat cushion
      k.box(0.82, 0.72, 0.2, fab, { y: 0.68, z: -0.32, rx: -0.12 });      // back
      k.box(0.6, 0.42, 0.12, 0x5f8a68, { y: 0.78, z: -0.2, rx: -0.12 });  // back cushion
      for (const s of [-1, 1]) {
        k.box(0.14, 0.3, 0.74, fab, { x: s * 0.37, y: 0.56, z: 0.0 });
        k.cyl(0.09, 0.74, fab, { x: s * 0.37, y: 0.72, z: 0, rx: Math.PI / 2 }, 8);
      }
      // a crocheted throw over the left arm
      k.box(0.36, 0.03, 0.5, 0xf2c35a, { x: 0.36, y: 0.82, z: 0.02, rz: -0.1 });
      k.box(0.03, 0.38, 0.48, 0xf2c35a, { x: 0.47, y: 0.6, z: 0.02 });
      k.box(0.34, 0.032, 0.12, 0xd9644a, { x: 0.36, y: 0.823, z: 0.1, rz: -0.1 });
    });
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.cyl(0.035, 0.12, PAL.woodDark, { x: x * 0.36, y: 0.06, z: z * 0.33 }, 6, 0.025);
    // a cushion with a heart
    k.box(0.3, 0.26, 0.1, 0xf0e2c0, { x: -0.18, y: 0.7, z: -0.1, rx: -0.2, rz: 0.2 });
    k.ball(0.05, PAL.red, { x: -0.18, y: 0.71, z: -0.04, s: [1, 0.9, 0.4] });
  }));
  k.part('sideTable', () => k.at({ x: FURN.sideTable.x, y: F, z: FURN.sideTable.z }, () => {
    k.cyl(0.26, 0.04, PAL.woodLight, { y: 0.6 }, 9);
    k.cyl(0.04, 0.58, PAL.wood, { y: 0.3 }, 6);
    k.cyl(0.18, 0.04, PAL.wood, { y: 0.02 }, 8);
    // reading lamp: brass stem, fabric shade, glowing bulb (lit at night, pieces.ts registers its light)
    k.cyl(0.07, 0.03, 0xc9963a, { x: -0.08, y: 0.635 }, 8);
    k.cyl(0.012, 0.36, 0xc9963a, { x: -0.08, y: 0.82 }, 5);
    k.surf(['fabric', { strength: 0.5 }], () => k.cyl(0.16, 0.18, 0xf2d6a0, { x: -0.08, y: 1.04 }, 8, 0.09));
    k.emit(false, () => k.ball(0.045, PAL.lampGlow, { x: -0.08, y: 0.96 }, 0, 'glow'));
    // tea and a book
    k.cyl(0.045, 0.08, 0xf0e8dc, { x: 0.12, y: 0.66, z: 0.06 }, 7);
    k.cyl(0.035, 0.005, 0x8a4a2a, { x: 0.12, y: 0.7, z: 0.06 }, 7);
    k.add(new THREE.TorusGeometry(0.025, 0.008, 4, 6), 0xf0e8dc, { x: 0.17, y: 0.66, z: 0.06, ry: Math.PI / 2 });
    book(k, { x: 0.08, y: 0.62, z: -0.1, ry: 0.4 }, 0.15, 0.035, 0.2, 0x3f5f8a);
  }));
  k.part('rug', () => {
    const R0 = FURN.rug;
    const rings = [0xb8483a, 0xf2c35a, 0x5a86b8, 0xf0e2c0, 0xd9644a, 0x6fa86a, 0xb8483a];
    rings.forEach((c, i) => {
      const r = 1 - i * 0.13;
      k.surf(['fabric', { strength: 0.9, scale: 0.4 }], () => k.cyl(r * 0.85, 0.012, c, { x: R0.x, y: F + 0.006 + i * 0.0025, z: R0.z, s: [R0.d / 1.7, 1, R0.w / 1.7] }, 18));
    });
  });
  k.part('logBasket', () => k.at({ x: FURN.logBasket.x, y: F, z: FURN.logBasket.z }, () => {
    k.surf(['hay', { strength: 0.8 }], () => k.cyl(0.25, 0.32, 0x9a7a4a, { y: 0.16 }, 9, 0.28));
    k.surf(['logs', { axis: 'long' }], () => {
      for (let i = 0; i < 5; i++) k.cyl(0.055, 0.5, i % 2 ? PAL.bark : 0x6a4a30, { x: (i % 3 - 1) * 0.1, y: 0.36 + Math.floor(i / 3) * 0.08, z: (i % 2 - 0.5) * 0.08, rx: Math.PI / 2, ry: 0.3 * (i - 2) }, 6);
    });
  }));
  k.part('catBed', () => k.at({ x: FURN.catBed.x, y: F, z: FURN.catBed.z }, () => {
    k.surf(['fabric', { strength: 0.9 }], () => {
      k.add(new THREE.TorusGeometry(0.24, 0.08, 6, 12), 0xc0587a, { y: 0.1, rx: Math.PI / 2 });
      k.cyl(0.25, 0.06, 0xa04a68, { y: 0.03 }, 12);
      k.cyl(0.2, 0.05, 0xf6e6c8, { y: 0.07 }, 12);
    });
    // a toy mouse on a string, and a name plate
    k.blob(0.04, 0x9aa0a8, { x: 0.36, y: 0.03, z: -0.12, s: [1.4, 0.8, 1] });
    k.ball(0.015, PAL.pink, { x: 0.41, y: 0.06, z: -0.12 });
    k.rod(0.31, 0.02, -0.12, 0.2, 0.01, -0.22, 0.005, PAL.pink);
    k.box(0.16, 0.06, 0.012, PAL.woodLight, { y: 0.1, z: 0.33, rx: -0.3 });
    k.box(0.12, 0.012, 0.013, PAL.woodDark, { y: 0.1, z: 0.336, rx: -0.3 });
  }));
  k.part('plantSE', () => k.at({ x: FURN.plantSE.x, y: F, z: FURN.plantSE.z }, () => {
    k.cyl(0.2, 0.36, 0x6a8aa0, { y: 0.18 }, 8, 0.24);
    k.cyl(0.25, 0.04, 0x5a7a90, { y: 0.36 }, 8);
    k.rod(0, 0.36, 0, 0.04, 1.2, 0.02, 0.02, PAL.trunk);
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4, y = 0.75 + i * 0.09, r = 0.18 + (i % 3) * 0.05;
      k.blob(0.13, i % 2 ? PAL.leafDark : 0x4f9a48, { x: Math.sin(a) * r, y, z: Math.cos(a) * r, s: [1.3, 0.55, 0.9], ry: a });
    }
  }));

  // ---------------------------------------------------------------- the Collections shelf (back wall, centre)
  const S = FURN.shelf, sx0 = S.x - S.w / 2, sz = S.z;
  k.part('shelf', () => {
    k.surf(['planks', { axis: 'y', strength: 0.7, variant: 1 }], () => k.box(S.w, S.h, 0.03, 0x7a5232, { x: S.x, y: F + S.h / 2, z: sz - S.d / 2 + 0.015 }));
    for (const s of [-1, 1]) k.box(0.06, S.h, S.d, PAL.wood, { x: S.x + s * (S.w / 2 - 0.03), y: F + S.h / 2, z: sz });
    k.box(S.w + 0.14, 0.08, S.d + 0.06, PAL.woodDark, { x: S.x, y: F + S.h + 0.04, z: sz + 0.02 });
    k.box(S.w + 0.2, 0.05, S.d + 0.1, PAL.wood, { x: S.x, y: F + S.h + 0.1, z: sz + 0.03 });
    // lower cupboard
    k.box(S.w - 0.08, 0.6, S.d - 0.04, PAL.wood, { x: S.x, y: F + 0.3, z: sz });
    for (let i = 0; i < 4; i++) {
      const x = sx0 + 0.06 + (i + 0.5) * ((S.w - 0.12) / 4);
      k.surf(['planks', { axis: 'y', variant: 2, scale: 0.6 }], () => k.box((S.w - 0.12) / 4 - 0.04, 0.5, 0.03, 0x4f7a5a, { x, y: F + 0.31, z: sz + S.d / 2 - 0.01 }));
      k.ball(0.025, 0xc9963a, { x: x + (i % 2 ? -1 : 1) * 0.28, y: F + 0.36, z: sz + S.d / 2 + 0.02 });
    }
    // display boards with a little lip, and the paper tags for what is still to find (pieces.ts places the finds)
    for (const r of SHELF_ROWS) {
      k.box(S.w - 0.1, 0.04, S.d - 0.02, PAL.woodLight, { x: S.x, y: F + r - 0.02, z: sz });
      k.box(S.w - 0.1, 0.05, 0.02, PAL.woodDark, { x: S.x, y: F + r - 0.015, z: sz + S.d / 2 - 0.01 });
    }
    // a sign on top: a carved board
    k.box(1.2, 0.2, 0.04, PAL.woodLight, { x: S.x, y: F + S.h + 0.25, z: sz - 0.08 });
    k.box(1.1, 0.03, 0.045, PAL.woodDark, { x: S.x, y: F + S.h + 0.25, z: sz - 0.075 });
    // jars and a trophy cup up top
    for (const [x, c] of [[-1.35, 0xc9e0e8], [-1.15, 0xe8c8a0], [1.2, 0xd8e8c0]] as const) { k.cyl(0.07, 0.18, c, { x: S.x + x, y: F + S.h + 0.22, z: sz }, 7); k.cyl(0.075, 0.04, 0xb8483a, { x: S.x + x, y: F + S.h + 0.33, z: sz }, 7); }
    k.at({ x: S.x + 1.42, y: F + S.h + 0.13, z: sz }, () => { k.cyl(0.06, 0.03, PAL.woodDark, { y: 0.015 }, 6); k.cyl(0.015, 0.08, 0xd9a93a, { y: 0.07 }, 5); k.cyl(0.07, 0.1, 0xd9a93a, { y: 0.16 }, 8, 0.1); });
  });

  // ---------------------------------------------------------------- tank cabinet, grandfather clock case
  const TK = FURN.tank;
  k.part('tankCabinet', () => k.at({ x: TK.x, y: F, z: TK.z }, () => {
    k.surf(['planks', { axis: 'x', strength: 0.7 }], () => k.box(TK.w, 0.72, TK.d, PAL.wood, { y: 0.36 }));
    k.box(TK.w + 0.06, 0.04, TK.d + 0.04, PAL.woodDark, { y: 0.74 });
    for (const s of [-1, 1]) { k.box(TK.w / 2 - 0.08, 0.56, 0.02, 0x8a5a36, { x: s * TK.w / 4, y: 0.36, z: TK.d / 2 }); k.ball(0.02, 0xc9963a, { x: s * 0.06, y: 0.42, z: TK.d / 2 + 0.02 }); }
    // fish food and a net
    k.cyl(0.035, 0.08, 0xf2c35a, { x: TK.w / 2 - 0.06, y: 0.8, z: 0.15 }, 6);
    k.rod(-TK.w / 2 - 0.02, 0.76, 0.2, -TK.w / 2 + 0.05, 1.3, 0.18, 0.008, PAL.woodDark);
  }));
  tankDressing(k);
  const CK = FURN.clock;
  k.part('clock', () => k.at({ x: CK.x, y: F, z: CK.z }, () => {
    const wood = 0x6e3f22;
    k.surf(['planks', { axis: 'y', strength: 0.6, variant: 2 }], () => {
      k.box(0.56, 0.5, 0.38, wood, { y: 0.25 });                 // plinth
      k.box(0.44, 1.05, 0.3, wood, { y: 0.5 + 0.525 });          // waist
      k.box(0.54, 0.56, 0.38, wood, { y: 1.55 + 0.28 });         // hood
    });
    k.box(0.6, 0.05, 0.42, PAL.woodDark, { y: 0.52 });
    k.box(0.6, 0.06, 0.42, PAL.woodDark, { y: 1.55 });
    k.prism([[-0.3, 0], [0.3, 0], [0.18, 0.14], [0, 0.2], [-0.18, 0.14]], 0.4, PAL.woodDark, { y: 2.13 });
    k.ball(0.04, 0xd9a93a, { y: 2.36 });
    // the waist window the pendulum swings behind (pieces.ts), and the dial bezel (face texture: pieces.ts)
    k.box(0.26, 0.8, 0.02, 0x2a1e18, { y: 1.02, z: 0.151 });
    k.cyl(0.21, 0.03, 0xd9a93a, { y: 1.84, z: 0.19, rx: Math.PI / 2 }, 14);
    for (const s of [-1, 1]) k.cyl(0.025, 0.56, 0xd9a93a, { x: s * 0.24, y: 1.84, z: 0.19 }, 6);
  }));

  // ---------------------------------------------------------------- the bed (north-west), nightstand
  const B = FURN.bed, bx0 = B.x - B.w / 2, bx1 = B.x + B.w / 2;
  k.part('bed', () => {
    const wood = 0x8a5a36;
    k.surf(['planks', { axis: 'z', strength: 0.7 }], () => {
      k.box(0.08, 1.15, B.d + 0.06, wood, { x: bx0 + 0.04, y: F + 0.575, z: B.z });   // headboard (west)
      k.box(0.08, 0.72, B.d + 0.06, wood, { x: bx1 - 0.04, y: F + 0.36, z: B.z });    // footboard
      for (const s of [-1, 1]) k.box(B.w - 0.1, 0.18, 0.06, wood, { x: B.x, y: F + 0.3, z: B.z + s * (B.d / 2) });
    });
    for (const [x, s] of [[bx0 + 0.04, 1.2], [bx1 - 0.04, 0.8]] as const) for (const z of [-1, 1]) k.ball(0.06, PAL.woodDark, { x, y: F + s - 0.02, z: B.z + z * (B.d / 2 + 0.02) });
    // heart cut-out on the headboard
    k.ball(0.09, 0xd9644a, { x: bx0 + 0.09, y: F + 0.95, z: B.z, s: [0.3, 1, 1] });
    k.surf(['fabric', { strength: 0.6 }], () => k.box(B.w - 0.16, 0.24, B.d - 0.06, 0xf6f1e6, { x: B.x, y: F + 0.42, z: B.z }));  // mattress
    // patchwork quilt: squares over the top, a hanging edge
    const cols = 6, rows = 4, qx0 = bx0 + 0.55, qw = (bx1 - 0.08 - qx0) / cols, qd = (B.d + 0.02) / rows;
    k.surf(['fabric', { strength: 0.9, scale: 0.5 }], () => {
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) k.box(qw + 0.002, 0.05, qd + 0.002, QUILT[(i * 3 + j * 2) % QUILT.length], { x: qx0 + (i + 0.5) * qw, y: F + 0.565, z: B.z - B.d / 2 - 0.01 + (j + 0.5) * qd });
      for (const s of [-1, 1]) for (let i = 0; i < cols; i++) k.box(qw + 0.002, 0.26, 0.03, QUILT[(i * 5 + (s > 0 ? 1 : 3)) % QUILT.length], { x: qx0 + (i + 0.5) * qw, y: F + 0.46, z: B.z + s * (B.d / 2 + 0.01) });
      k.box(0.32, 0.07, B.d - 0.02, 0xf0e2c0, { x: qx0 + 0.02, y: F + 0.585, z: B.z });    // folded-back sheet
      // pillows
      for (const s of [-1, 1]) k.box(0.34, 0.14, 0.5, 0xf6f1e6, { x: bx0 + 0.3, y: F + 0.62, z: B.z + s * 0.3, rz: -0.15 });
    });
    // a knitted blanket folded at the foot, and a sleeping-cap on the post
    k.surf(['fabric', { strength: 1 }], () => k.box(0.3, 0.08, B.d - 0.2, 0x5a86b8, { x: bx1 - 0.3, y: F + 0.62, z: B.z }));
    k.cone(0.06, 0.18, PAL.red, { x: bx1 - 0.04, y: F + 0.84, z: B.z + B.d / 2 + 0.02, rz: -0.4 }, 6);
    k.ball(0.03, PAL.white, { x: bx1 + 0.03, y: F + 0.9, z: B.z + B.d / 2 + 0.02 });
  });
  const N = FURN.nightstand;
  k.part('nightstand', () => k.at({ x: N.x, y: F, z: N.z }, () => {
    k.box(0.48, 0.52, 0.44, PAL.wood, { y: 0.26 });
    k.box(0.52, 0.04, 0.48, PAL.woodDark, { y: 0.54 });
    k.box(0.38, 0.16, 0.02, 0x8a5a36, { x: 0.25, y: 0.38, ry: Math.PI / 2 });
    k.ball(0.022, 0xc9963a, { x: 0.26, y: 0.38 });
    // candle lantern (lit at night), a book, spectacles
    k.at({ x: -0.06, y: 0.56, z: -0.08 }, () => {
      k.box(0.14, 0.02, 0.14, PAL.metalDark, { y: 0.01 });
      k.box(0.14, 0.02, 0.14, PAL.metalDark, { y: 0.23 });
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box(0.015, 0.22, 0.015, PAL.metalDark, { x: x * 0.065, y: 0.12, z: z * 0.065 });
      k.emit(false, () => k.box(0.1, 0.18, 0.1, PAL.lampGlow, { y: 0.12 }, 'glow'));
      k.add(new THREE.TorusGeometry(0.04, 0.008, 4, 8, Math.PI), PAL.metalDark, { y: 0.25 });
    });
    book(k, { x: 0.05, y: 0.56, z: 0.1, ry: 0.3 }, 0.14, 0.03, 0.2, 0x9a3a32);
    k.add(new THREE.TorusGeometry(0.025, 0.004, 4, 8), PAL.ink, { x: 0.1, y: 0.6, z: 0.12, rx: Math.PI / 2 });
    k.add(new THREE.TorusGeometry(0.025, 0.004, 4, 8), PAL.ink, { x: 0.16, y: 0.6, z: 0.12, rx: Math.PI / 2 });
  }));
  // a stitched sampler over the bed
  k.part('sampler', () => k.at({ x: B.x + 0.1, y: F + 1.65, z: z0 + 0.03 }, () => {
    k.box(0.9, 0.55, 0.04, PAL.woodDark);
    k.box(0.8, 0.45, 0.042, 0xf0e2c0, { z: 0.003 });
    // "home" in cross-stitch blocks, a heart, a little house
    k.ball(0.06, PAL.red, { x: -0.25, y: 0.02, z: 0.03, s: [1, 1, 0.3] });
    k.box(0.16, 0.1, 0.01, 0x5a86b8, { x: 0.18, y: -0.05, z: 0.026 });
    k.prism([[-0.1, 0], [0.1, 0], [0, 0.08]], 0.01, PAL.roofRed, { x: 0.18, y: 0.0, z: 0.026 });
    for (let i = 0; i < 9; i++) k.box(0.03, 0.03, 0.01, QUILT[i % QUILT.length], { x: -0.32 + i * 0.08, y: -0.17, z: 0.026 });
  }));

  // ---------------------------------------------------------------- the bookshelf (west wall)
  const BS = FURN.bookshelf;
  k.part('bookshelf', () => k.at({ x: BS.x, y: F, z: BS.z, ry: Math.PI / 2 }, () => {
    const H2 = 2.15, W2 = BS.d, D2 = BS.w;
    k.surf(['planks', { axis: 'y', strength: 0.7 }], () => k.box(W2, H2, 0.03, 0x7a5232, { y: H2 / 2, z: -D2 / 2 + 0.015 }));
    for (const s of [-1, 1]) k.box(0.05, H2, D2, PAL.wood, { x: s * (W2 / 2 - 0.025), y: H2 / 2 });
    k.box(W2 + 0.08, 0.06, D2 + 0.06, PAL.woodDark, { y: H2 + 0.03 });
    const rng = k.r;
    for (let r = 0; r < 5; r++) {
      const y = 0.06 + r * 0.42;
      k.box(W2 - 0.08, 0.03, D2 - 0.04, PAL.woodLight, { y });
      let x = -W2 / 2 + 0.07;
      while (x < W2 / 2 - 0.12) {
        const w = 0.035 + rng() * 0.035, h = 0.24 + rng() * 0.1, lean = rng() < 0.12 ? 0.25 : 0;
        if (rng() < 0.08 && x < W2 / 2 - 0.3) { // a little ornament instead
          if (rng() < 0.5) k.cyl(0.05, 0.12, 0xdde8f0, { x: x + 0.06, y: y + 0.075, z: 0 }, 7);
          else k.ball(0.06, 0xd9a93a, { x: x + 0.06, y: y + 0.075, z: 0 });
          x += 0.14; continue;
        }
        k.box(w, h, 0.18 + rng() * 0.05, BOOKS[Math.floor(rng() * BOOKS.length)], { x: x + w / 2, y: y + 0.015 + h / 2, z: (rng() - 0.5) * 0.03, rz: lean });
        x += w + 0.004 + (lean ? 0.04 : 0);
      }
    }
  }));
  pottedPlant(k, { x: BS.x, y: F + 2.18, z: BS.z + 0.5 }, 1.1, PAL.leaf, 0xc8743a);
  k.part('plantW', () => k.at({ x: FURN.plantW.x, y: F, z: FURN.plantW.z }, () => {
    k.cyl(0.17, 0.3, 0xb8643a, { y: 0.15 }, 8, 0.2);
    for (let i = 0; i < 8; i++) { const a = i * 0.8; k.cone(0.06, 0.6, i % 2 ? PAL.leaf : PAL.leafDark, { x: Math.sin(a) * 0.12, y: 0.55, z: Math.cos(a) * 0.12, rx: Math.cos(a) * 0.5, rz: -Math.sin(a) * 0.5 }, 4); }
  }));

  // ---------------------------------------------------------------- the terminal desk (CRT: pieces.ts draws the screen)
  const CD = FURN.crtDesk;
  k.part('crtDesk', () => k.at({ x: CD.x, y: F, z: CD.z, ry: Math.PI / 2 }, () => {
    // desk: local x along the wall (z in the room), local +z faces into the room (+x)
    k.surf(['planks', { axis: 'x', strength: 0.7 }], () => k.box(CD.d, 0.05, CD.w, PAL.woodLight, { y: 0.74 }));
    for (const s of [-1, 1]) k.box(0.05, 0.72, CD.w - 0.06, PAL.wood, { x: s * (CD.d / 2 - 0.04), y: 0.36 });
    k.box(0.36, 0.5, CD.w - 0.12, PAL.wood, { x: -CD.d / 2 + 0.2, y: 0.47, z: 0 });
  }));
  // the CRT monitor + keyboard, in room frame (facing +x)
  k.part('crt', () => k.at({ x: CD.x - 0.08, y: F + 0.765, z: CD.z + 0.12, ry: Math.PI / 2 }, () => {
    const beige = 0xe2d6b8;
    k.box(0.5, 0.42, 0.42, beige, { y: 0.26, z: -0.05 });
    k.box(0.4, 0.32, 0.22, 0xd2c6a8, { y: 0.24, z: -0.34 });     // the tube's back
    k.box(0.44, 0.06, 0.3, 0xd2c6a8, { y: 0.03, z: -0.08 });      // stand
    k.box(0.43, 0.35, 0.02, 0x2a2a2a, { y: 0.28, z: 0.165 });     // bezel recess (screen quad sits in front)
    k.box(0.06, 0.03, 0.02, 0x5aa04a, { x: 0.18, y: 0.07, z: 0.17 }); // power led
    k.box(0.06, 0.012, 0.02, 0x9a9080, { x: -0.12, y: 0.07, z: 0.17 });
    // a sticky note on the corner
    k.box(0.07, 0.07, 0.005, 0xf2e05a, { x: 0.22, y: 0.42, z: 0.172, rz: 0.15 });
  }));
  k.part('keyboard', () => k.at({ x: CD.x + 0.22, y: F + 0.765, z: CD.z + 0.12, ry: Math.PI / 2 }, () => {
    k.box(0.42, 0.035, 0.15, 0xd8ccae, { y: 0.018, rx: 0.08 });
    for (let r = 0; r < 4; r++) for (let c = 0; c < 11; c++) k.box(0.028, 0.012, 0.025, r === 3 && c > 2 && c < 8 ? 0xc8bc9e : 0xeee6d0, { x: -0.17 + c * 0.034, y: 0.04 + r * 0.004, z: 0.045 - r * 0.03 });
    k.box(0.06, 0.025, 0.09, 0xd8ccae, { x: 0.3, y: 0.014 });
    k.rod(0.3, 0.02, -0.045, 0.22, 0.02, -0.2, 0.004, 0x4a4a4a);
  }));
  // a mug of pens, a little cactus, a stack of floppy disks
  k.at({ x: CD.x + 0.05, y: F + 0.765, z: CD.z - 0.48 }, () => {
    k.cyl(0.045, 0.1, 0x5a86b8, { y: 0.05 }, 7);
    for (let i = 0; i < 3; i++) k.rod((i - 1) * 0.015, 0.08, 0, (i - 1) * 0.025, 0.18, 0.01, 0.006, [PAL.red, PAL.yellow, PAL.ink][i]);
    for (let i = 0; i < 4; i++) k.box(0.09, 0.006, 0.09, [0x3a3a4a, 0x3f5f8a, 0x9a3a32, 0x3a3a4a][i], { x: 0.16, y: 0.004 + i * 0.007, z: 0.03, ry: i * 0.12 });
  });
  pottedPlant(k, { x: CD.x - 0.15, y: F + 0.765, z: CD.z + 0.55 }, 0.6, 0x6fae5a, 0xd88a5a);
  chair(k, { x: FURN.crtChair.x, y: F, z: FURN.crtChair.z, ry: -Math.PI / 2 - 0.2 });

  // ---------------------------------------------------------------- the Almanac writing desk (under the front-left window)
  const AD = FURN.almanacDesk;
  k.part('almanacDesk', () => k.at({ x: AD.x, y: F, z: AD.z }, () => {
    k.surf(['planks', { axis: 'x', strength: 0.7 }], () => k.box(AD.w, 0.05, AD.d, 0x9a6a3e, { y: 0.74 }));
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box(0.06, 0.72, 0.06, 0x7a5232, { x: x * (AD.w / 2 - 0.05), y: 0.36, z: z * (AD.d / 2 - 0.05) });
    k.box(AD.w - 0.1, 0.12, 0.04, 0x7a5232, { y: 0.66, z: -AD.d / 2 + 0.05 });
    k.ball(0.02, 0xc9963a, { y: 0.66, z: -AD.d / 2 + 0.02 });
    // the Valley Almanac: a fat leather book, open (pages: pieces.ts), with a ribbon
    k.at({ x: -0.1, y: 0.765, z: -0.02 }, () => {
      k.box(0.62, 0.025, 0.42, 0x7a2e22, { y: 0.012 });
      for (const s of [-1, 1]) k.box(0.28, 0.04, 0.38, 0xf6ecd4, { x: s * 0.145, y: 0.04, rz: s * 0.06 });
      k.box(0.02, 0.012, 0.3, PAL.red, { x: 0.02, y: 0.065, z: 0.08 });
    });
    // inkpot and quill, a candle, the desk lamp (lit at night)
    k.cyl(0.04, 0.06, 0x2a2a3a, { x: 0.38, y: 0.795, z: 0.05 }, 7);
    k.cone(0.012, 0.32, 0xf6f1e6, { x: 0.38, y: 0.93, z: 0.04, rz: -0.35 }, 4);
    k.at({ x: 0.48, y: 0.765, z: -0.16 }, () => {
      k.cyl(0.07, 0.03, PAL.metalDark, { y: 0.015 }, 8);
      k.rod(0, 0.03, 0, -0.05, 0.36, 0.02, 0.012, PAL.metalDark);
      k.cone(0.1, 0.12, 0x3f6f4a, { x: -0.07, y: 0.38, z: 0.04, rz: 0.4 }, 8);
      k.emit(false, () => k.ball(0.035, PAL.lampGlow, { x: -0.08, y: 0.34, z: 0.04 }, 0, 'glow'));
    });
    for (let j = 0; j < 3; j++) book(k, { x: -0.52, y: 0.765 + j * 0.04, z: 0.12, ry: (j - 1) * 0.15 }, 0.2, 0.04, 0.26, BOOKS[j + 2]);
  }));
  chair(k, { x: FURN.almanacChair.x, y: F, z: FURN.almanacChair.z, ry: 0.12 });

  // ---------------------------------------------------------------- the round table and stools (centre-west)
  const TB = FURN.table;
  k.part('table', () => k.at({ x: TB.x, y: F, z: TB.z }, () => {
    k.cyl(TB.r, 0.05, PAL.woodLight, { y: 0.72 }, 12);
    k.surf(['fabric', { strength: 0.9, scale: 0.5 }], () => {
      k.cyl(TB.r - 0.08, 0.008, 0xf0e2c0, { y: 0.748 }, 12);
      k.box(0.7, 0.01, 0.16, 0xc8574a, { y: 0.751, ry: 0.5 });
      k.box(0.7, 0.01, 0.16, 0xc8574a, { y: 0.752, ry: 0.5 + Math.PI / 2 });
    });
    k.cyl(0.06, 0.7, PAL.wood, { y: 0.35 }, 7);
    for (let i = 0; i < 3; i++) { const a = i * 2.09; k.beam(0, 0.1, 0, Math.sin(a) * 0.32, 0.0, Math.cos(a) * 0.32, 0.05, PAL.wood); }
    // teapot, cups, a pie, a jug of flowers
    k.at({ x: 0.1, y: 0.755, z: 0.1 }, () => {
      k.ball(0.1, 0x5a86b8, { y: 0.09, s: [1, 0.85, 1] });
      k.cyl(0.04, 0.03, 0x5a86b8, { y: 0.18 }, 7);
      k.ball(0.02, PAL.white, { y: 0.21 });
      k.cyl(0.015, 0.12, 0x5a86b8, { x: 0.11, y: 0.11, rz: -0.9 }, 5);
      k.add(new THREE.TorusGeometry(0.05, 0.012, 4, 8), 0x5a86b8, { x: -0.1, y: 0.1 });
    });
    for (const [x, z] of [[-0.22, 0.12], [0.2, -0.2]]) { k.cyl(0.04, 0.06, 0xf6f1e6, { x, y: 0.785, z }, 7); k.cyl(0.06, 0.008, 0xf6f1e6, { x, y: 0.758, z }, 8); }
    k.at({ x: -0.12, y: 0.755, z: -0.18 }, () => {
      k.cyl(0.15, 0.015, 0xf6f1e6, { y: 0.008 }, 10);
      k.cyl(0.12, 0.05, 0xd9a35a, { y: 0.04 }, 10, 0.11);
      for (let i = 0; i < 4; i++) k.box(0.2, 0.012, 0.015, 0xb87a3a, { y: 0.067, ry: i * Math.PI / 4 });
      k.box(0.11, 0.051, 0.06, 0xb83a4a, { x: 0.08, y: 0.04, z: 0.06, ry: 0.6 }); // a slice missing: cherries
    });
    k.at({ x: 0.18, y: 0.755, z: 0.28 }, () => {
      k.cyl(0.05, 0.16, 0xe8dcc8, { y: 0.08 }, 7, 0.04);
      for (let i = 0; i < 5; i++) { const a = i * 1.25; k.rod(0, 0.14, 0, Math.sin(a) * 0.06, 0.28, Math.cos(a) * 0.06, 0.005, PAL.leafDark); k.ball(0.035, flowers[i % flowers.length], { x: Math.sin(a) * 0.06, y: 0.29, z: Math.cos(a) * 0.06 }); }
    });
  }));
  for (const s of FURN.stools) k.part('stool', () => k.at({ x: s.x, y: F, z: s.z }, () => {
    k.cyl(0.17, 0.05, PAL.wood, { y: 0.46 }, 8);
    k.surf(['fabric', { strength: 0.8 }], () => k.cyl(0.14, 0.03, 0xd9644a, { y: 0.5 }, 8));
    for (let i = 0; i < 3; i++) { const a = i * 2.09 + 0.4; k.beam(Math.sin(a) * 0.08, 0.44, Math.cos(a) * 0.08, Math.sin(a) * 0.15, 0, Math.cos(a) * 0.15, 0.04, PAL.woodDark); }
  }));

  // ---------------------------------------------------------------- the hanging lantern over the table, pictures
  if (!o.cutaway) k.part('lantern', () => k.at({ x: TB.x, y: CEIL - 0.24, z: TB.z }, () => {
    k.rod(0, 0, 0, 0, -0.55, 0, 0.008, PAL.metalDark);
    k.at({ y: -0.85 }, () => {
      k.cone(0.16, 0.12, PAL.metalDark, { y: 0.24 }, 6);
      k.box(0.24, 0.02, 0.24, PAL.metalDark, { y: 0.17 });
      k.box(0.2, 0.03, 0.2, PAL.metalDark, { y: -0.15 });
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box(0.02, 0.32, 0.02, PAL.metalDark, { x: x * 0.1, z: z * 0.1 });
      k.emit(false, () => k.box(0.17, 0.28, 0.17, PAL.lampGlow, {}, 'glow'));
      k.add(new THREE.TorusGeometry(0.04, 0.01, 4, 8), PAL.metalDark, { y: 0.31 });
    });
  }));
  // a painting of the valley on the east wall (north of the hearth) and a little one by the door
  k.part('paintings', () => {
    k.at({ x: x1 - 0.03, y: F + 1.6, z: -3.15, ry: -Math.PI / 2 }, () => {
      k.box(0.95, 0.7, 0.04, 0xc9963a);
      k.box(0.85, 0.6, 0.045, 0x9fd3ff, { z: 0.002 });
      k.box(0.85, 0.22, 0.048, 0x7fb84e, { y: -0.19, z: 0.002 });
      k.prism([[-0.42, -0.08], [-0.1, 0.15], [0.12, 0.02], [0.42, 0.18], [0.42, -0.08]], 0.048, 0x5c9a3c, { y: -0.03, z: 0.002 });
      k.box(0.14, 0.1, 0.05, PAL.wallCream, { x: 0.1, y: -0.12, z: 0.004 });
      k.prism([[-0.09, 0], [0.09, 0], [0, 0.07]], 0.05, PAL.roofRed, { x: 0.1, y: -0.07, z: 0.004 });
      k.ball(0.05, 0xfff1a0, { x: -0.28, y: 0.18, z: 0.03, s: [1, 1, 0.3] });
      for (let i = 0; i < 3; i++) k.box(0.04, 0.025, 0.052, 0xf2e8d8, { x: 0.2 + i * 0.05, y: 0.04 + i * 0.03, z: 0.002 });
      k.box(0.03, 0.12, 0.05, PAL.wallWhite, { x: 0.32, y: 0.0, z: 0.003 });  // the windmill on the hill
    });
    if (!o.cutaway) k.at({ x: -1.0, y: F + 1.65, z: z1 - 0.03, ry: Math.PI }, () => {
      k.box(0.36, 0.44, 0.03, PAL.woodDark);
      k.box(0.3, 0.38, 0.032, 0xf0e2c0, { z: 0.002 });
      k.ball(0.07, 0xd9773a, { y: 0.02, z: 0.02, s: [1.3, 1, 0.3] }); // a portrait of Clawd, sort of
      for (const s of [-1, 1]) k.box(0.02, 0.04, 0.035, PAL.ink, { x: s * 0.03, y: 0.04, z: 0.003 });
    });
  });

  k.build(root);
  for (const m of root.children as THREE.Mesh[]) { m.userData.bake = undefined; m.name = `interior:${m.userData.emitters ? 'glow' : 'solid'}`; }
  return root;
}
