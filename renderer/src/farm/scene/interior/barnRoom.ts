/**
 * The barn interior's static room: the timber shell (board walls, plank floor, the gambrel roof's boards, rafters,
 * collar ties and purlins), the hay loft and its ladder, the stalls and mangers, the coop with its roost and nest
 * boxes, the sheep pen, the workbench under the tool wall, the hay, and the machine-room corner (the panel desk, the
 * dial board, brass pipes), merged by the structures `Kit` into one solid mesh (toon + surfaces) and one glow mesh
 * (lantern glass). Also here: the daylight through the shutters and the plank gaps (`buildDaylight`, one unlit mesh
 * whose colour follows the sky). Barn-local frame (barnLayout.ts). Live pieces (animals, dials, swallows, motes) are
 * in barnPieces.ts.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Season } from '../../model/types.ts';
import { PAL } from '../toon.ts';
import { Kit } from '../structures/kit.ts';
import type { Xf } from '../structures/kit.ts';
import { barrel, bucket, crate, hayBale, sack } from '../structures/props.ts';
import { B, BARN_ROOM, BIG_DOOR, LADDER, LOFT, OPENINGS } from './barnLayout.ts';

export interface BarnRoomOpts { season: Season; seed?: number; /** gallery: leave out the roof, the front and the east wall */ cutaway?: boolean }

const F = BARN_ROOM.floor, WT = BARN_ROOM.wallTop, KX = BARN_ROOM.kneeX, KY = BARN_ROOM.kneeY, RG = BARN_ROOM.ridge;
const { x0: X0, x1: X1, z0: Z0, z1: Z1 } = BARN_ROOM;
const T = BARN_ROOM.wall;
const BOARD = 0x9c6a44, BATTEN = 0x7a5034, TIMBER = 0x6a4630, FLOOR = 0xa27a50, STRAW = 0xe0c068, ROOFB = 0x8a5e3c, BRASS = 0xc9a03a, IRON = 0x3a3a40;

/** roof underside height at |x| (gambrel, inner face) */
export function roofAt(x: number): number {
  const a = Math.abs(x);
  if (a >= KX) return WT + (X1 + 0.18 - a) / (X1 + 0.18 - KX) * (KY - WT);
  return RG - (a / KX) * (RG - KY);
}

interface Hole { a0: number; a1: number; y0: number; y1: number }
/** A board wall along x (front / back) or z (sides) with rectangular holes: solid pieces around them. */
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

/** vertical battens over a board wall (along x or z), skipping holes */
function battens(k: Kit, along: 'x' | 'z', fixed: number, a0: number, a1: number, y0: number, y1: number, holes: Hole[], step = 0.62): void {
  for (let a = a0 + step / 2; a < a1; a += step) {
    let lo = y0;
    const hs = holes.filter((h) => a > h.a0 - 0.05 && a < h.a1 + 0.05).sort((p, q) => p.y0 - q.y0);
    for (const h of [...hs, { a0: 0, a1: 0, y0: y1, y1: y1 }]) {
      const hi = Math.min(h.y0, y1);
      if (hi - lo > 0.05) {
        if (along === 'x') k.box(0.07, hi - lo, 0.035, BATTEN, { x: a, y: (lo + hi) / 2, z: fixed });
        else k.box(0.035, hi - lo, 0.07, BATTEN, { x: fixed, y: (lo + hi) / 2, z: a });
      }
      lo = Math.max(lo, h.y1);
    }
  }
}

/** a gable end above the eaves (x-y polygon at depth z), split around an optional hole in the middle */
function gable(k: Kit, z: number, hole: Hole | null): void {
  const prof = (xa: number, xb: number, yb: number): [number, number][] => {
    // the polygon under the roof between xa and xb (xa < xb), from yb up
    const pts: [number, number][] = [[xa, yb], [xb, yb]];
    const top: [number, number][] = [];
    for (const x of [xb, ...[KX, 0, -KX].filter((v) => v < xb && v > xa), xa]) {
      const y = roofAt(x) + 0.05;
      if (y > yb + 0.01) top.push([x, y]);
    }
    return [...pts, ...top];
  };
  const add = (pts: [number, number][]) => k.prism(pts, T, BOARD, { z });
  k.surf(['planks', { axis: 'y', variant: 2, scale: 1.2 }], () => {
    if (!hole) { add(prof(X0 - T, X1 + T, WT)); return; }
    add(prof(X0 - T, hole.a0, WT));
    add(prof(hole.a1, X1 + T, WT));
    k.box(hole.a1 - hole.a0, hole.y0 - WT, T, BOARD, { x: (hole.a0 + hole.a1) / 2, y: (WT + hole.y0) / 2, z });
    add(prof(hole.a0, hole.a1, hole.y1));
  });
}

/** a hanging lantern (chain from yTop down to the glass at y) */
function lantern(k: Kit, x: number, y: number, z: number, yTop: number): void {
  k.part('lantern', () => k.at({ x, y, z }, () => {
    if (yTop > y + 0.3) k.rod(0, 0.32, 0, 0, yTop - y, 0, 0.01, IRON);
    k.cone(0.13, 0.1, IRON, { y: 0.24 }, 6);
    k.add(new THREE.TorusGeometry(0.035, 0.009, 4, 8), IRON, { y: 0.31 });
    k.box(0.2, 0.025, 0.2, IRON, { y: 0.18 });
    k.box(0.18, 0.03, 0.18, IRON, { y: -0.14 });
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box(0.018, 0.3, 0.018, IRON, { x: a * 0.085, z: b * 0.085 });
    k.emit(false, () => k.box(0.15, 0.26, 0.15, PAL.lampGlow, {}, 'glow'));
  }));
}

/** a fence run of posts and three rails (chicken coop / sheep pen), along x or z */
function pen(k: Kit, ax: number, az: number, bx: number, bz: number, h: number, gapAt?: { a: number; w: number }): void {
  const len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len;
  const n = Math.max(1, Math.round(len / 1.0));
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * len;
    k.box(0.09, h + 0.05, 0.09, TIMBER, { x: ax + dx * t, y: F + (h + 0.05) / 2, z: az + dz * t });
  }
  const segs: [number, number][] = gapAt ? [[0, gapAt.a - gapAt.w / 2], [gapAt.a + gapAt.w / 2, len]] : [[0, len]];
  for (const [s0, s1] of segs) {
    if (s1 - s0 < 0.05) continue;
    const m = (s0 + s1) / 2, l = s1 - s0;
    for (const y of [0.3, h * 0.62, h - 0.04]) k.box(dx ? l : 0.05, 0.07, dz ? l : 0.05, PAL.plank, { x: ax + dx * m, y: F + y, z: az + dz * m });
  }
}

export function buildBarnRoom(o: BarnRoomOpts): THREE.Group {
  const root = new THREE.Group();
  root.name = 'barn-room';
  const k = new Kit((o.seed ?? 1) * 131 + 7);
  const cut = !!o.cutaway;
  const r = k.r;

  // ---------------------------------------------------------------- floor: wide planks, straw in the stalls and pens
  k.part('floor', () => {
    k.surf(['planks', { axis: 'z', scale: 1.1, variant: 1 }], () => k.box(X1 - X0 + 2 * T, 0.16, Z1 - Z0 + 2 * T, FLOOR, { y: F - 0.08 }));
    k.surf(['hay', { scale: 0.7 }], () => {
      k.box(B.stallX1 - X0, 0.04, B.donkeyStall.z1 - Z0, STRAW, { x: (X0 + B.stallX1) / 2, y: F + 0.02, z: (Z0 + B.donkeyStall.z1) / 2 });
      k.box(X1 - B.coop.x0, 0.03, B.coop.z1 - Z0, 0xd8b45a, { x: (X1 + B.coop.x0) / 2, y: F + 0.015, z: (Z0 + B.coop.z1) / 2 });
      k.box(X1 - B.pen.x0, 0.04, B.pen.z1 - B.pen.z0, STRAW, { x: (X1 + B.pen.x0) / 2, y: F + 0.02, z: (B.pen.z0 + B.pen.z1) / 2 });
    });
    // straw tufts scattered down the aisle and lumps of bedding in the stalls
    for (let i = 0; i < 26; i++) {
      const x = -1.3 + r() * 2.6, z = -3.6 + r() * 7.2;
      k.box(0.12 + r() * 0.2, 0.012, 0.03, i % 3 ? STRAW : 0xc8a048, { x, y: F + 0.006, z, ry: r() * Math.PI });
    }
    for (let i = 0; i < 9; i++) k.blob(0.22 + r() * 0.12, i % 2 ? STRAW : 0xd2ae52, { x: X0 + 0.4 + r() * 2.6, y: F + 0.04, z: Z0 + 0.4 + r() * 5.2, s: [1.4, 0.35, 1.2] });
  });

  // ---------------------------------------------------------------- walls (boards + battens), openings, the big door
  const side = (wall: 'east' | 'west'): Hole[] => OPENINGS.filter((p) => p.wall === wall).map((p) => ({ a0: p.at - p.w / 2, a1: p.at + p.w / 2, y0: p.y - p.h / 2, y1: p.y + p.h / 2 }));
  const hay = OPENINGS.find((p) => p.wall === 'front')!;
  const hayHole: Hole = { a0: hay.at - hay.w / 2, a1: hay.at + hay.w / 2, y0: hay.y - hay.h / 2, y1: hay.y + hay.h / 2 };
  const door: Hole = { a0: BIG_DOOR.x - BIG_DOOR.w / 2, a1: BIG_DOOR.x + BIG_DOOR.w / 2, y0: F - 0.01, y1: BIG_DOOR.h + 0.3 };
  k.part('walls', () => {
    k.surf(['planks', { axis: 'y', variant: 2, scale: 1.2 }], () => {
      holedWall(k, 'x', Z0 - T / 2, X0 - T, X1 + T, F - 0.1, WT, T, [], BOARD);
      holedWall(k, 'z', X0 - T / 2, Z0, Z1, F - 0.1, WT, T, side('west'), BOARD);
      if (!cut) {
        holedWall(k, 'x', Z1 + T / 2, X0 - T, X1 + T, F - 0.1, WT, T, [door], BOARD);
        holedWall(k, 'z', X1 + T / 2, Z0, Z1, F - 0.1, WT, T, side('east'), BOARD);
      }
    });
    gable(k, Z0 - T / 2, null);
    if (!cut) gable(k, Z1 + T / 2, hayHole);
    battens(k, 'x', Z0 + 0.02, X0, X1, F, WT, []);
    battens(k, 'z', X0 + 0.02, Z0, Z1, F, WT, side('west'));
    if (!cut) {
      battens(k, 'x', Z1 - 0.02, X0, X1, F, WT, [door]);
      battens(k, 'z', X1 - 0.02, Z0, Z1, F, WT, side('east'));
    }
    // sill plates and the eave plates
    k.box(X1 - X0, 0.16, 0.16, TIMBER, { y: F + 0.08, z: Z0 + 0.08 });
    for (const x of [X0 + 0.08, X1 - 0.08]) if (!cut || x < 0) k.surf(['logs', { axis: 'z', strength: 0.6 }], () => k.box(0.2, 0.22, Z1 - Z0, TIMBER, { x, y: WT - 0.11 }));
  });

  // the shutters: one leaf closed, one swung half open into the barn; a frame round each opening
  k.part('shutters', () => {
    for (const p of OPENINGS) {
      if (cut && (p.wall === 'east' || p.wall === 'front')) continue;
      const inward = p.wall === 'east' ? -1 : 1;
      const tf: Xf = p.wall === 'front' ? { x: p.at, y: p.y, z: Z1 - 0.02, ry: Math.PI } : { x: p.wall === 'east' ? X1 - 0.02 : X0 + 0.02, y: p.y, z: p.at, ry: p.wall === 'east' ? -Math.PI / 2 : Math.PI / 2 };
      void inward;
      k.at(tf, () => {
        // frame (in the wall's plane, facing into the barn: +z here)
        k.box(p.w + 0.16, 0.1, 0.1, TIMBER, { y: -p.h / 2 - 0.05, z: 0.03 });
        k.box(p.w + 0.16, 0.1, 0.1, TIMBER, { y: p.h / 2 + 0.05, z: 0.03 });
        for (const s of [-1, 1]) k.box(0.1, p.h + 0.2, 0.1, TIMBER, { x: s * (p.w / 2 + 0.05), z: 0.03 });
        // left leaf shut (a crack of light down its edge), right leaf ajar
        const lw = p.w / 2 - 0.03;
        k.surf(['planks', { axis: 'y', variant: 1, scale: 0.7 }], () => k.box(lw, p.h - 0.04, 0.05, 0x8a5e3c, { x: -p.w / 4 - 0.02, z: 0.02 }));
        k.box(lw, 0.07, 0.03, BATTEN, { x: -p.w / 4 - 0.02, y: p.h * 0.3, z: 0.06 });
        k.box(lw, 0.07, 0.03, BATTEN, { x: -p.w / 4 - 0.02, y: -p.h * 0.3, z: 0.06 });
        k.at({ x: p.w / 2, z: 0.03, ry: -1.05 }, () => {
          k.surf(['planks', { axis: 'y', variant: 1, scale: 0.7 }], () => k.box(lw, p.h - 0.04, 0.05, 0x8a5e3c, { x: -lw / 2 }));
          k.box(lw, 0.07, 0.03, BATTEN, { x: -lw / 2, y: p.h * 0.3, z: 0.04 });
          k.box(lw, 0.07, 0.03, BATTEN, { x: -lw / 2, y: -p.h * 0.3, z: 0.04 });
          k.box(0.05, 0.05, 0.05, IRON, { x: -lw + 0.06, z: 0.06 }); // latch
        });
      });
    }
  });

  // the big door from inside: two plank leaves on the rail, shut, an iron bar across
  if (!cut) k.part('bigDoor', () => {
    const dw = BIG_DOOR.w, dh = BIG_DOOR.h, z = Z1 - 0.06;
    for (const s of [-1, 1]) {
      const cx = s * (dw / 4 + 0.01);
      k.surf(['planks', { axis: 'y', variant: 2, scale: 1.2 }], () => k.box(dw / 2 - 0.03, dh, 0.08, 0x8a5a38, { x: cx, y: F + dh / 2, z }));
      for (const y of [0.25, dh / 2, dh - 0.25]) k.box(dw / 2 - 0.05, 0.14, 0.05, BATTEN, { x: cx, y: F + y, z: z - 0.06 });
      const dl = Math.hypot(dw / 2 - 0.2, dh / 2 - 0.3);
      for (const sy of [0.25, dh / 2]) k.box(0.12, dl, 0.04, BATTEN, { x: cx, y: F + sy + (dh / 2 - 0.25) / 2, z: z - 0.07, rz: s * Math.atan2(dw / 2 - 0.2, dh / 2 - 0.3) });
      k.box(0.06, 0.4, 0.06, IRON, { x: s * 0.18, y: F + 1.4, z: z - 0.1 }); // handles
    }
    k.box(dw + 0.5, 0.12, 0.08, IRON, { y: F + 1.15, z: z - 0.14 });           // the bar
    for (const s of [-1, 1]) k.box(0.1, 0.2, 0.12, IRON, { x: s * (dw / 2 + 0.12), y: F + 1.15, z: z - 0.1 });
    k.box(dw + 0.6, 0.18, 0.18, TIMBER, { y: F + dh + 0.12, z: Z1 - 0.09 });   // lintel
  });

  // ---------------------------------------------------------------- roof: boards on rafters, ties, purlins, ridge
  if (!cut) k.part('roof', () => {
    const segs: [number, number, number, number][] = [[X1 + T, WT, KX, KY], [KX, KY, 0, RG]];
    for (const s of [-1, 1]) for (const [ax, ay, bx, by] of segs) {
      const len = Math.hypot(bx - ax, by - ay), nx = (by - ay) / len, ny = -(bx - ax) / len;
      // boards: a slab a little outside the inner line
      k.surf(['planks', { axis: 'z', variant: 1, scale: 1.0, strength: 0.7 }], () =>
        k.beam(s * (ax + nx * 0.06), ay + Math.abs(ny) * 0.06, 0, s * (bx + nx * 0.06), by + Math.abs(ny) * 0.06, 0, 0.1, ROOFB, 'solid', Z1 - Z0 + 2 * T));
    }
    // rafters + collar ties every bay
    for (let z = Z0 + 0.35; z <= Z1 - 0.3; z += 1.32) {
      for (const s of [-1, 1]) for (const [ax, ay, bx, by] of segs) k.beam(s * ax, ay, z, s * bx, by, z, 0.14, TIMBER, 'solid', 0.12);
      k.beam(-KX, KY - 0.05, z, KX, KY - 0.05, z, 0.16, TIMBER, 'solid', 0.14);      // collar tie at the knees
      // tie beams across at the eaves and knee braces (not over the loft: you stand up there)
      if (z > LOFT.z1 + 0.6) {
        k.beam(-X1, WT - 0.05, z, X1, WT - 0.05, z, 0.18, TIMBER, 'solid', 0.16);
        for (const s of [-1, 1]) k.beam(s * (X1 - 0.1), WT - 0.6, z, s * (X1 - 0.75), WT - 0.05, z, 0.12, TIMBER, 'solid', 0.1);
      }
      k.beam(0, KY - 0.05, z, 0, RG - 0.1, z, 0.12, TIMBER, 'solid', 0.1);           // king post
    }
    for (const x of [-KX, KX]) k.surf(['logs', { axis: 'z', strength: 0.6 }], () => k.box(0.16, 0.18, Z1 - Z0, TIMBER, { x, y: KY - 0.1 }));
    k.box(0.18, 0.2, Z1 - Z0, TIMBER, { y: RG - 0.12 });
    // the hay hoist's track under the ridge, a pulley at the front
    k.box(0.08, 0.08, Z1 - Z0 - 0.4, IRON, { y: RG - 0.35 });
    k.cyl(0.12, 0.07, IRON, { y: RG - 0.55, z: Z1 - 0.8, rz: Math.PI / 2 }, 10);
    k.rod(0, RG - 0.6, Z1 - 0.8, 0, LOFT.y + 1.4, Z1 - 1.0, 0.018, PAL.cloth);
    k.add(new THREE.TorusGeometry(0.07, 0.015, 5, 10), IRON, { y: LOFT.y + 1.33, z: Z1 - 1.0 });
  });

  // ---------------------------------------------------------------- timber frame: posts along the aisle, the loft beam
  k.part('frame', () => {
    for (const x of [B.stallX1, B.coop.x0]) for (const z of [LOFT.z1, Z1 - 1.25]) {
      k.surf(['logs', { axis: 'y', strength: 0.6 }], () => k.box(0.2, (z === LOFT.z1 ? LOFT.y : WT) - F, 0.2, TIMBER, { x, y: (F + (z === LOFT.z1 ? LOFT.y : WT)) / 2, z }));
    }
    // posts carrying the eave ties at mid-barn
    for (const x of [B.stallX1, B.coop.x0]) k.box(0.18, WT - F, 0.18, TIMBER, { x, y: (F + WT) / 2, z: B.donkeyStall.z1 });
  });

  // ---------------------------------------------------------------- the hay loft and its ladder
  k.part('loft', () => {
    const ld = LOFT.z1 - LOFT.z0;
    k.surf(['planks', { axis: 'x', variant: 1, scale: 1.0 }], () => k.box(X1 - X0, LOFT.th, ld, PAL.plank, { y: LOFT.y - LOFT.th / 2, z: (LOFT.z0 + LOFT.z1) / 2 }));
    for (let x = X0 + 0.5; x < X1; x += 0.9) k.box(0.1, 0.18, ld, TIMBER, { x, y: LOFT.y - LOFT.th - 0.09, z: (LOFT.z0 + LOFT.z1) / 2 });
    k.surf(['logs', { axis: 'x', strength: 0.6 }], () => k.box(X1 - X0, 0.24, 0.22, TIMBER, { y: LOFT.y - LOFT.th - 0.12, z: LOFT.z1 - 0.1 }));
    // the rail along the edge, open at the ladder
    const lx0 = LADDER.x - LADDER.w / 2, lx1 = LADDER.x + LADDER.w / 2;
    for (const [a, b] of [[X0, lx0], [lx1, X1]]) {
      for (let x = a + 0.05; x <= b; x += Math.max(0.6, (b - a) / Math.max(1, Math.round((b - a) / 1.1)))) k.box(0.08, 1.0, 0.08, TIMBER, { x, y: LOFT.y + 0.5, z: LOFT.z1 - 0.05 });
      k.box(0.08, 1.0, 0.08, TIMBER, { x: b - 0.04, y: LOFT.y + 0.5, z: LOFT.z1 - 0.05 });
      k.box(b - a, 0.08, 0.09, PAL.plank, { x: (a + b) / 2, y: LOFT.y + 1.0, z: LOFT.z1 - 0.05 });
      k.box(b - a, 0.06, 0.06, PAL.plank, { x: (a + b) / 2, y: LOFT.y + 0.55, z: LOFT.z1 - 0.05 });
    }
    // the ladder: two rails from the aisle floor up past the loft edge, rungs every 30 cm
    const rise = LOFT.y - F, run = LADDER.z1 - LADDER.z0;
    for (const s of [-1, 1]) {
      const x = LADDER.x + s * (LADDER.w / 2 - 0.02);
      k.beam(x, F, LADDER.z1 + 0.05, x, LOFT.y + 0.95, LADDER.z0 - (0.95 / rise) * run, 0.08, 0x8a6040, 'solid', 0.06);
    }
    for (let y = 0.3; y < rise + 0.8; y += 0.3) {
      const z = LADDER.z1 + 0.05 - (y / rise) * (run + 0.05);
      k.cyl(0.03, LADDER.w - 0.06, 0x9a7048, { x: LADDER.x, y: F + y, z, rz: Math.PI / 2 }, 6);
    }
    // hay stacked up in the loft, loose hay on the boards
    k.surf(['hay', { scale: 0.8 }], () => {
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) for (let l = 0; l < (i === 2 ? 1 : 2); l++) hayBale(k, { x: X0 + 0.65 + i * 0.95, y: LOFT.y + l * 0.55, z: Z0 + 0.4 + j * 0.68, ry: Math.PI / 2 * 0 + (r() - 0.5) * 0.08 });
      k.blob(0.9, PAL.hay, { x: B.loftHay.x + 0.6, y: LOFT.y + 0.1, z: B.loftHay.z + 0.9, s: [1.3, 0.55, 1.1] });
      k.blob(0.95, PAL.hay, { x: B.loftPile.x, y: LOFT.y + 0.05, z: B.loftPile.z, s: [1.4, 0.5, 1.2] });
      k.blob(0.6, 0xd4b458, { x: B.loftPile.x + 0.7, y: LOFT.y + 0.02, z: B.loftPile.z - 0.6, s: [1.3, 0.45, 1.1] });
    });
    for (let i = 0; i < 14; i++) k.box(0.2 + r() * 0.2, 0.012, 0.03, STRAW, { x: X0 + 0.3 + r() * 9, y: LOFT.y + 0.006, z: Z0 + 0.3 + r() * 2.3, ry: r() * Math.PI });
    // a pitchfork leaning on the stack
    k.at({ x: -0.6, y: LOFT.y, z: Z0 + 0.35, rx: -0.25 }, () => {
      k.cyl(0.022, 1.5, 0xb08050, { y: 0.75 }, 5);
      k.box(0.24, 0.03, 0.03, IRON, { y: 1.5 });
      for (const x of [-0.1, 0, 0.1]) k.cyl(0.012, 0.3, IRON, { x, y: 1.66 }, 4);
    });
  });

  // ---------------------------------------------------------------- stalls: partitions, mangers, name boards
  k.part('stalls', () => {
    const fx = B.stallX1;
    k.surf(['planks', { axis: 'x', variant: 1, scale: 0.9 }], () => {
      // partition between the stalls and the stall ends against the aisle (low walls with a rail on top)
      k.box(fx - X0, 1.35, 0.08, 0x8a5e3c, { x: (X0 + fx) / 2, y: F + 0.675, z: B.cowStall.z1 });
      k.box(fx - X0, 1.35, 0.08, 0x8a5e3c, { x: (X0 + fx) / 2, y: F + 0.675, z: B.donkeyStall.z1 });
    });
    for (const z of [B.cowStall.z1, B.donkeyStall.z1]) k.box(fx - X0 + 0.06, 0.1, 0.14, TIMBER, { x: (X0 + fx) / 2, y: F + 1.4, z });
    // front of each stall: the manger box and a rail above it, a gap for the head
    for (const st of [B.cowStall, B.donkeyStall]) {
      const zc = (st.z0 + st.z1) / 2, d = st.z1 - st.z0 - 0.12;
      k.surf(['planks', { axis: 'z', variant: 2, scale: 0.8 }], () => {
        k.box(B.manger.w, 0.5, d, 0x7a5236, { x: B.manger.x, y: F + 0.55, z: zc });
        k.box(0.06, 0.8, d, 0x7a5236, { x: fx + 0.03, y: F + 0.4, z: zc });
      });
      k.box(B.manger.w - 0.1, 0.04, d - 0.1, 0xc9a54a, { x: B.manger.x, y: F + 0.79, z: zc }); // hay in the manger (dark wood read as a hole)
      k.box(0.1, 0.1, d + 0.1, TIMBER, { x: fx + 0.03, y: F + 1.38, z: zc });
      k.box(0.12, 1.4, 0.12, TIMBER, { x: fx + 0.03, y: F + 0.7, z: st.z0 + 0.06 });
    }
    // tack: a halter on a peg by the donkey's stall, a salt lick
    k.box(0.12, 0.05, 0.05, TIMBER, { x: fx + 0.1, y: F + 1.2, z: B.donkeyStall.z1 - 0.1 });
    k.add(new THREE.TorusGeometry(0.08, 0.016, 4, 10), 0xc0503a, { x: fx + 0.14, y: F + 1.1, z: B.donkeyStall.z1 - 0.1, ry: Math.PI / 2, s: [1, 1.4, 1] });
    k.box(0.14, 0.12, 0.14, 0xf0e8e0, { x: X0 + 0.15, y: F + 1.0, z: -2.1 });
    // a milking stool and a pail by the hay, at the end of Daisy's stall
    k.at({ x: B.stoolPail.x, z: B.stoolPail.z - 0.1 }, () => {
      k.cyl(0.16, 0.05, 0x9a7048, { y: 0.35 }, 8);
      for (let i = 0; i < 3; i++) { const a = i * 2.09; k.cyl(0.02, 0.36, TIMBER, { x: Math.sin(a) * 0.1, y: 0.17, z: Math.cos(a) * 0.1 }, 4); }
    });
    bucket(k, { x: B.stoolPail.x + 0.05, y: F, z: B.stoolPail.z + 0.25 });
  });

  // ---------------------------------------------------------------- the coop: wire fence, roost, nest boxes
  k.part('coop', () => {
    pen(k, B.coop.x0, Z0 + 0.05, B.coop.x0, B.coop.z1, 1.0, { a: 1.15, w: 0.75 });
    pen(k, B.coop.x0, B.coop.z1, X1 - 0.05, B.coop.z1, 1.0);
    // chicken wire: fine laths between the rails
    for (let z = Z0 + 0.15; z < B.coop.z1; z += 0.16) if (Math.abs(z - (Z0 + 1.15 + 0.05)) > 0.42) k.box(0.012, 0.7, 0.012, 0xb8bcc0, { x: B.coop.x0, y: F + 0.62, z });
    for (let x = B.coop.x0 + 0.1; x < X1; x += 0.16) k.box(0.012, 0.7, 0.012, 0xb8bcc0, { x, y: F + 0.62, z: B.coop.z1 });
    // roost: three stepped perches on two A-frame legs
    for (const p of B.roost) k.cyl(0.035, B.roostLen, 0xa0784e, { x: p.x, y: F + p.y, z: p.z, rz: Math.PI / 2 }, 6);
    for (const s of [-1, 1]) {
      const x = B.roost[0].x + s * (B.roostLen / 2 - 0.12);
      k.beam(x, F, B.roost[2].z + 0.3, x, F + B.roost[0].y + 0.1, B.roost[0].z - 0.05, 0.06, TIMBER, 'solid', 0.05);
    }
    // droppings board, a little grain scattered
    for (let i = 0; i < 14; i++) k.box(0.02, 0.01, 0.02, 0xe8c070, { x: B.coop.x0 + 0.3 + r() * 2.6, y: F + 0.035, z: Z0 + 0.3 + r() * 1.6 });
    // nest boxes on the east wall, straw inside
    for (const n of B.nests) k.at({ x: B.nestX, y: F + B.nestY, z: n.z }, () => {
      k.surf(['planks', { axis: 'z', variant: 1, scale: 0.6 }], () => {
        k.box(0.5, 0.04, 0.52, 0x8a5e3c, { y: 0 });
        k.box(0.5, 0.42, 0.04, 0x8a5e3c, { y: 0.21, z: -0.26 });
        k.box(0.5, 0.42, 0.04, 0x8a5e3c, { y: 0.21, z: 0.26 });
        k.box(0.04, 0.42, 0.52, 0x8a5e3c, { x: 0.25, y: 0.21 });
        k.box(0.58, 0.04, 0.6, 0x7a5236, { y: 0.44, x: 0.02, rz: 0.12 });
        k.box(0.04, 0.12, 0.52, 0x8a5e3c, { x: -0.25, y: 0.06 });
      });
      k.blob(0.2, STRAW, { y: 0.08, s: [1.1, 0.4, 1.1] });
    });
    k.box(0.06, 0.06, 2.0, TIMBER, { x: B.nestX - 0.3, y: F + B.nestY - 0.12, z: -2.95 }); // the landing rail
  });

  // ---------------------------------------------------------------- the sheep pen: fence, a hay rack, a water trough
  k.part('sheepPen', () => {
    pen(k, B.pen.x0, B.pen.z0, B.pen.x0, B.pen.z1, 1.0, { a: 2.35, w: 0.8 });
    pen(k, B.pen.x0, B.pen.z0, X1 - 0.05, B.pen.z0, 1.0);
    pen(k, B.pen.x0, B.pen.z1, X1 - 0.05, B.pen.z1, 1.0);
    k.at({ x: B.trough.x + 0.12, z: B.trough.z }, () => {
      k.box(0.35, 0.5, 1.2, 0x7a5236, { y: F + 0.25 });
      k.box(0.27, 0.03, 1.12, 0xc9a54a, { y: F + 0.49 });   // hay in the rack's trough
      for (let i = 0; i < 7; i++) k.box(0.025, 0.55, 0.025, TIMBER, { x: 0.1, y: F + 0.78, z: -0.5 + i * 0.165, rz: -0.25 });
      k.box(0.05, 0.05, 1.15, TIMBER, { x: 0.18, y: F + 1.05 });
    });
    k.at({ x: 4.3, z: 1.15 }, () => {
      k.surf(['metal', { strength: 0.6 }], () => k.cyl(0.32, 0.36, 0x8a949c, { y: F + 0.18, rz: 0 }, 12));
      k.cyl(0.29, 0.02, 0x5a8ab0, { y: F + 0.32 }, 12);
    });
  });

  // ---------------------------------------------------------------- the hay by the loft, the grain bin
  k.part('hayPile', () => {
    k.surf(['hay', { scale: 0.8 }], () => {
      k.blob(0.75, PAL.hay, { x: B.hay.x, y: F + 0.2, z: B.hay.z, s: [1.25, 0.75, 0.95] });
      k.blob(0.45, 0xd4b458, { x: B.hay.x + 0.55, y: F + 0.12, z: B.hay.z + 0.35, s: [1.2, 0.6, 1] });
      hayBale(k, { x: B.hay.x - 0.85, y: F, z: B.hay.z - 0.2, ry: 0.15 });
    });
    k.at({ x: B.hay.x + 0.3, y: F + 0.3, z: B.hay.z + 0.2, rx: 0.35, rz: -0.2 }, () => {
      k.cyl(0.022, 1.45, 0xb08050, { y: 0.72 }, 5);
      k.box(0.24, 0.03, 0.03, IRON, { y: 1.45 });
      for (const x of [-0.1, 0, 0.1]) k.cyl(0.012, 0.28, IRON, { x, y: 1.6 }, 4);
    });
  });
  k.part('grain', () => {
    barrel(k, { x: B.grain.x, y: F, z: B.grain.z, s: 0.8 }, 0x9a7048);
    k.cyl(0.3, 0.05, 0x7a5236, { x: B.grain.x + 0.12, y: F + 0.84, z: B.grain.z + 0.05, rx: 0.3 }, 9);
    k.cyl(0.26, 0.04, 0xe8c87a, { x: B.grain.x, y: F + 0.78, z: B.grain.z }, 9);
    sack(k, { x: B.grain.x + 0.4, y: F, z: B.grain.z + 0.45, ry: 0.6 });
  });

  // ---------------------------------------------------------------- the workbench and the tool wall
  k.part('bench', () => {
    const bx = X0 + B.bench.w / 2, bz = B.bench.z, top = F + 0.9;
    k.surf(['planks', { axis: 'z', variant: 0, scale: 0.9 }], () => k.box(B.bench.w, 0.08, B.bench.d, 0x9a6a40, { x: bx, y: top - 0.04, z: bz }));
    for (const dz of [-1, 1]) for (const dx of [-1, 1]) k.box(0.08, 0.86, 0.08, TIMBER, { x: bx + dx * (B.bench.w / 2 - 0.08), y: F + 0.43, z: bz + dz * (B.bench.d / 2 - 0.08) });
    k.box(B.bench.w - 0.1, 0.04, B.bench.d - 0.1, 0x7a5236, { x: bx, y: F + 0.25, z: bz }); // the low shelf
    crate(k, { x: bx, y: F + 0.27, z: bz - 0.5 }, 0.42);
    bucket(k, { x: bx, y: F + 0.27, z: bz + 0.45 });
    // vise, a mallet, a jar of nails, a horseshoe in progress
    k.box(0.12, 0.1, 0.2, IRON, { x: bx + 0.3, y: top + 0.05, z: bz + 0.7 });
    k.box(0.04, 0.04, 0.3, IRON, { x: bx + 0.42, y: top + 0.06, z: bz + 0.7 });
    k.cyl(0.05, 0.14, 0x8a5e3c, { x: bx + 0.1, y: top + 0.05, z: bz - 0.3, rx: Math.PI / 2 }, 7);
    k.cyl(0.015, 0.3, 0xb08050, { x: bx + 0.1, y: top + 0.03, z: bz - 0.1, rx: Math.PI / 2 }, 4);
    k.cyl(0.06, 0.13, 0xbfd8e0, { x: bx - 0.15, y: top + 0.07, z: bz + 0.2 }, 7);
    k.add(new THREE.TorusGeometry(0.07, 0.016, 4, 10, Math.PI * 1.4), IRON, { x: bx + 0.05, y: top + 0.012, z: bz + 0.35, rx: Math.PI / 2 });
    // the tool wall: a plank backboard with pegs and tools hung on it
    const wx = X0 + 0.04;
    k.surf(['planks', { axis: 'z', variant: 1, scale: 0.8 }], () => k.box(0.04, 1.5, B.bench.d + 0.3, 0xb08458, { x: wx, y: top + 0.95, z: bz }));
    k.at({ x: wx + 0.03, ry: Math.PI / 2 }, () => {
      // rake, shovel, saw, hammer, coiled rope, horseshoe (for luck, open end up), lantern hook
      const hang = (z: number, y: number, fn: () => void) => k.at({ x: -(z - bz), y }, fn);
      hang(bz - 0.8, top + 1.65, () => { k.cyl(0.02, 1.3, 0xb08050, { y: -0.6 }, 5); k.box(0.38, 0.05, 0.04, IRON, { y: -1.25 }); for (let i = 0; i < 6; i++) k.box(0.015, 0.09, 0.02, IRON, { x: -0.16 + i * 0.064, y: -1.31 }); });
      hang(bz - 0.45, top + 1.6, () => { k.cyl(0.022, 0.95, 0xb08050, { y: -0.45 }, 5); k.box(0.22, 0.28, 0.025, PAL.metal, { y: -1.05 }); });
      hang(bz - 0.05, top + 1.25, () => { k.box(0.55, 0.13, 0.012, PAL.metal, { x: 0.05 }); k.box(0.16, 0.12, 0.035, 0x9a6a40, { x: -0.28 }); });
      hang(bz + 0.3, top + 1.5, () => { k.cyl(0.015, 0.32, 0xb08050, { y: -0.16 }, 5); k.box(0.12, 0.05, 0.05, IRON, { y: 0.02 }); });
      hang(bz + 0.6, top + 1.45, () => { for (let i = 0; i < 4; i++) k.add(new THREE.TorusGeometry(0.15 - i * 0.012, 0.02, 4, 12), 0xc8a870, { z: 0.02 + i * 0.012, y: -0.12 }); });
      hang(bz + 0.15, top + 1.85, () => k.add(new THREE.TorusGeometry(0.08, 0.018, 4, 10, Math.PI * 1.4), 0x8a8e94, { rz: -Math.PI * 0.2 - Math.PI / 2 }));
      // the curry brush (the donkey's)
      hang(bz + 0.95, top + 0.95, () => { k.box(0.2, 0.08, 0.06, 0xa0583a, { z: 0.02 }); k.box(0.18, 0.03, 0.05, 0x3a3030, { y: -0.05, z: 0.02 }); k.box(0.1, 0.03, 0.03, 0x9a6a40, { y: 0.06, z: 0.02 }); });
      for (const z of [bz - 0.8, bz - 0.45, bz + 0.3, bz + 0.6, bz + 0.95]) hang(z, top + 1.66, () => k.cyl(0.015, 0.06, TIMBER, { z: 0.03, rx: Math.PI / 2 }, 4));
    });
    // a little paper calendar of chores pinned up (painted in the dial atlas)
  });

  // ---------------------------------------------------------------- Mochi's bales and a bit of yard clutter by the door
  k.part('bales', () => {
    k.surf(['hay', { scale: 0.8 }], () => {
      hayBale(k, { x: B.bales.x - 0.05, y: F, z: B.bales.z, ry: 0.05 });
      hayBale(k, { x: B.bales.x + 0.1, y: F + 0.55, z: B.bales.z - 0.02, ry: -0.12 });
    });
    k.blob(0.3, STRAW, { x: B.bales.x + 0.75, y: F + 0.05, z: B.bales.z - 0.6, s: [1.4, 0.4, 1.2] });
    barrel(k, { x: 1.95, y: F, z: Z1 - 0.55, s: 0.75 }, PAL.woodDark);
    crate(k, { x: -2.2, y: F, z: Z1 - 0.42, ry: 0.2 }, 0.5);
    crate(k, { x: -2.2, y: F + 0.5, z: Z1 - 0.42, ry: -0.15 }, 0.36);
  });

  // ---------------------------------------------------------------- the machine room: panel desk, dial board, pipes
  k.part('machineRoom', () => {
    const P = B.panel, top = F + 0.84;
    k.surf(['planks', { axis: 'x', variant: 0, scale: 0.8 }], () => k.box(P.w, 0.07, P.d, 0x7a4a2c, { x: P.x, y: top, z: P.z }));
    k.box(P.w - 0.06, 0.8, 0.05, 0x5a3622, { x: P.x, y: F + 0.42, z: P.z - P.d / 2 + 0.05 });     // front skirt
    for (const s of [-1, 1]) k.box(0.06, 0.8, P.d, 0x5a3622, { x: P.x + s * (P.w / 2 - 0.03), y: F + 0.42, z: P.z });
    // the dial board on the wall: dark walnut, brass trim, four dial bezels (faces in the atlas), a nameplate
    const bz = Z1 - 0.035;
    k.box(2.25, 1.5, 0.05, 0x4a2c1c, { x: P.x - 0.05, y: F + 1.85, z: bz });
    for (const [w, h, x, y] of [[2.31, 0.06, P.x - 0.05, F + 2.62], [2.31, 0.06, P.x - 0.05, F + 1.08], [0.06, 1.56, P.x - 1.2, F + 1.85], [0.06, 1.56, P.x + 1.1, F + 1.85]] as const) k.box(w, h, 0.06, BRASS, { x, y, z: bz - 0.02 });
    for (const [dx, dy] of DIALS) {
      k.cyl(0.215, 0.06, BRASS, { x: dx, y: F + dy, z: bz - 0.04, rx: Math.PI / 2 }, 18);
      k.cyl(0.035, 0.03, 0x8a6a20, { x: dx, y: F + dy, z: bz - 0.09, rx: Math.PI / 2 }, 8);
    }
    // the thermometer's inside face: a tall brass-cased tube through the wall, a bulb at the foot
    const T2 = B.thermo;
    k.box(0.3, 2.0, 0.06, 0x4a2c1c, { x: T2.x + 0.45, y: F + T2.y - 0.2, z: bz });
    k.box(0.36, 2.06, 0.03, BRASS, { x: T2.x + 0.45, y: F + T2.y - 0.2, z: bz + 0.005 });
    k.cyl(0.09, 0.08, BRASS, { x: T2.x + 0.45, y: F + T2.y - 1.12, z: bz - 0.05, rx: Math.PI / 2 }, 12);
    // chart recorder: a drum box on the desk (its paper strip is in the atlas)
    k.box(0.5, 0.26, 0.3, 0x5a3622, { x: P.x + 0.62, y: top + 0.16, z: P.z + 0.02 });
    k.box(0.52, 0.03, 0.32, BRASS, { x: P.x + 0.62, y: top + 0.3, z: P.z + 0.02 });
    k.cyl(0.07, 0.42, 0xe8dcc0, { x: P.x + 0.62, y: top + 0.17, z: P.z - 0.12, rz: Math.PI / 2 }, 10);
    // a banker's lamp (green shade: its glow is a lamp emitter), a logbook, a mug, a little radio
    k.at({ x: P.x - 0.75, y: top + 0.035, z: P.z + 0.05 }, () => {
      k.cyl(0.08, 0.03, BRASS, { y: 0.015 }, 10);
      k.cyl(0.012, 0.28, BRASS, { y: 0.16 }, 5);
      k.cyl(0.07, 0.1, 0x2e7a4a, { y: 0.31, rz: Math.PI / 2 }, 10, 0.1);
      k.emit(false, () => k.box(0.14, 0.03, 0.12, PAL.lampGlow, { y: 0.275 }, 'glow'));
    });
    k.box(0.32, 0.04, 0.24, 0x8a2a2a, { x: P.x - 0.25, y: top + 0.055, z: P.z + 0.05, ry: 0.2 });
    k.box(0.3, 0.012, 0.22, 0xf0e6cc, { x: P.x - 0.25, y: top + 0.078, z: P.z + 0.05, ry: 0.2 });
    k.cyl(0.04, 0.09, 0xe8dcc8, { x: P.x + 0.15, y: top + 0.08, z: P.z + 0.12 }, 8);
    k.box(0.26, 0.17, 0.12, 0x6a3a22, { x: P.x + 0.2, y: top + 0.12, z: P.z - 0.12 });
    k.cyl(0.05, 0.02, BRASS, { x: P.x + 0.14, y: top + 0.12, z: P.z - 0.05, rx: Math.PI / 2 }, 10);
    // brass pipes from the board up into the rafters, valves
    for (const [x, w] of [[P.x - 1.05, 0.05], [P.x - 0.95, 0.035]] as const) {
      k.cyl(w, WT - (F + 2.6), BRASS, { x, y: (F + 2.6 + WT) / 2, z: Z1 - 0.1 }, 8);
      k.cyl(w + 0.02, 0.05, 0x8a6a20, { x, y: F + 3.2, z: Z1 - 0.1 }, 8);
    }
    k.cyl(0.07, 0.03, 0xb0402a, { x: P.x - 1.05, y: F + 3.0, z: Z1 - 0.18, rx: Math.PI / 2 }, 8);
    // the stool
    k.at({ x: B.stool.x, z: B.stool.z }, () => {
      k.cyl(0.19, 0.06, 0x9a6a40, { y: F + 0.62 }, 10);
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.4; k.beam(Math.sin(a) * 0.12, F + 0.6, Math.cos(a) * 0.12, Math.sin(a) * 0.2, F, Math.cos(a) * 0.2, 0.035, TIMBER); }
    });
  });

  // ---------------------------------------------------------------- swallows' nests: mud cups up on the ties
  k.part('nests', () => {
    for (const n of SWALLOW_NESTS) k.at({ x: n.x, y: n.y, z: n.z }, () => {
      k.cyl(0.11, 0.1, 0x8a6a4a, { y: -0.04 }, 8, 0.08);
      k.ball(0.09, 0x7a5a3a, { y: -0.09, s: [1.1, 0.6, 1.1] });
      for (let i = 0; i < 4; i++) k.box(0.05, 0.012, 0.015, STRAW, { x: Math.sin(i * 1.6) * 0.08, y: 0.012, z: Math.cos(i * 1.6) * 0.08, ry: i });
    });
  });

  // ---------------------------------------------------------------- lanterns (glass glows; their light is barn.ts's)
  for (const l of LANTERNS) lantern(k, l.x, l.y, l.z, l.top);
  // the workbench lantern stands on the bench
  k.part('benchLantern', () => k.at({ x: X0 + 0.35, y: F + 0.9, z: B.bench.z - 0.75 }, () => {
    k.box(0.16, 0.03, 0.16, IRON, { y: 0.015 });
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box(0.016, 0.26, 0.016, IRON, { x: a * 0.07, y: 0.15, z: b * 0.07 });
    k.cone(0.11, 0.09, IRON, { y: 0.33 }, 6);
    k.add(new THREE.TorusGeometry(0.035, 0.008, 4, 8), IRON, { y: 0.4, rx: Math.PI / 2 });
    k.emit(false, () => k.box(0.12, 0.22, 0.12, PAL.lampGlow, { y: 0.15 }, 'glow'));
  }));

  k.build(root);
  for (const m of root.children as THREE.Mesh[]) { m.userData.bake = undefined; m.name = `interior:barn-${m.userData.emitters ? 'glow' : 'solid'}`; }
  return root;
}

/** the four brass dials on the board (x, height above the floor): CPU, RAM, disk, network */
export const DIALS: readonly (readonly [number, number])[] = Object.freeze([[3.35, 2.2], [2.8, 2.2], [3.35, 1.55], [2.8, 1.55]]);
/** swallows' nests up on the collar ties / rafters (local) */
export const SWALLOW_NESTS: readonly { x: number; y: number; z: number }[] = Object.freeze([
  { x: -1.6, y: BARN_ROOM.kneeY + 0.12, z: -2.62 }, { x: 1.9, y: BARN_ROOM.kneeY + 0.12, z: 0.02 }, { x: -0.7, y: BARN_ROOM.kneeY + 0.12, z: 2.66 },
]);
/** hanging lanterns: glass centre (x, y, z) and where the chain is hung (top) */
export const LANTERNS: readonly { x: number; y: number; z: number; top: number }[] = Object.freeze([
  { x: -0.6, y: 2.75, z: 1.05, top: BARN_ROOM.wallTop - 0.1 },
  { x: -0.3, y: 2.6, z: -0.45, top: BARN_ROOM.wallTop - 0.1 },
  { x: 2.4, y: 2.15, z: -2.45, top: LOFT.y - LOFT.th - 0.2 },   // over the coop, under the loft
  { x: -2.4, y: 2.1, z: -2.2, top: LOFT.y - LOFT.th - 0.2 },    // over Daisy's stall
  { x: 3.6, y: LOFT.y + 1.6, z: -3.45, top: BARN_ROOM.wallTop + 1.6 }, // up in the loft, by the east wall
]);

// ---------------------------------------------------------------------------------------------------------------
// Daylight: the open half of each shutter, the cracks round the big door and the gaps between wall boards

export interface Daylight { mesh: THREE.Mesh; update(sky: THREE.Color, day: number): void }
export function buildDaylight(o: { cutaway?: boolean } = {}): Daylight {
  const parts: THREE.BufferGeometry[] = [];
  const quad = (w: number, h: number, m: THREE.Matrix4) => { const g = new THREE.PlaneGeometry(w, h); g.applyMatrix4(m); parts.push(g); };
  const M = (x: number, y: number, z: number, ry: number) => new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);
  for (const p of OPENINGS) {
    if (o.cutaway && (p.wall === 'east' || p.wall === 'front')) continue;
    // a sky card just outside the opening (seen past the open leaf) and a crack down the shut leaf's edge
    if (p.wall === 'front') { quad(p.w, p.h, M(p.at, p.y, Z1 + T + 0.02, Math.PI)); }
    else if (p.wall === 'east') quad(p.w, p.h, M(X1 + T + 0.02, p.y, p.at, -Math.PI / 2));
    else quad(p.w, p.h, M(X0 - T - 0.02, p.y, p.at, Math.PI / 2));
  }
  if (!o.cutaway) {
    // round the big door: a crack down the middle, under the leaves and along the top
    const dz = Z1 - 0.115;
    quad(0.03, BIG_DOOR.h - 0.1, M(0, F + BIG_DOOR.h / 2, dz, Math.PI));
    quad(BIG_DOOR.w - 0.1, 0.025, M(0, F + 0.012, dz, Math.PI));
    for (const s of [-1, 1]) quad(0.02, BIG_DOOR.h - 0.2, M(s * (BIG_DOOR.w / 2 - 0.01), F + BIG_DOOR.h / 2, dz, Math.PI));
  }
  // gaps between wall boards: thin bright slits, a few per wall, at varying heights
  const rr = (() => { let s = 7; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
  const slit = (x: number, z: number, ry: number, y: number, h: number) => quad(0.016, h, M(x, y, z, ry));
  for (let i = 0; i < 9; i++) slit(X0 + 0.02 + 0.001, Z0 + 0.4 + rr() * (Z1 - Z0 - 0.8), Math.PI / 2, F + 0.5 + rr() * 2.6, 0.4 + rr() * 1.2);
  for (let i = 0; i < 8; i++) slit(X0 + 0.5 + rr() * (X1 - X0 - 1), Z0 + 0.022, 0, F + 0.4 + rr() * 2.2, 0.3 + rr() * 1.1);
  if (!o.cutaway) for (let i = 0; i < 9; i++) slit(X1 - 0.022, Z0 + 0.4 + rr() * (Z1 - Z0 - 0.8), -Math.PI / 2, F + 0.5 + rr() * 2.6, 0.4 + rr() * 1.2);
  const geo = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false)!;
  for (const p of parts) p.dispose();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'interior:barn-daylight';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  const night = new THREE.Color(0.05, 0.07, 0.13);
  return {
    mesh,
    update(sky, day) {
      // bright, slightly warm daylight by day; a deep blue glimmer at night (HDR: blooms a touch)
      mat.color.copy(night).lerp(sky, day).multiplyScalar(0.55 + 1.25 * day);
    },
  };
}
