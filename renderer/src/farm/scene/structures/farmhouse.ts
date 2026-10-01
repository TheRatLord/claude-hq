/**
 * The farmhouse (the hub): two storeys, timber-framed upper floor, porch with rocking chair, hammock beside the house,
 * a pigeon loft on the ridge, weathervane, chimney smoke = disk IO, warm windows at night, and the "needs you" bell.
 */
import * as THREE from 'three';
import type { Season } from '../../model/types.ts';
import { PAL, toon } from '../toon.ts';
import { Kit, damp, type SurfSpec, type Xf } from './kit.ts';
import { flowerBox, flowerPot, firewood, choppingBlock, wateringCan, bucket } from './props.ts';
import type { Env, Rig } from './rig.ts';

export interface BuildOpts { season: Season; night: number; seed: number }

/** Local anchor points (farmhouse space, front +z, ground y = 0). */
export const FARMHOUSE = Object.freeze({
  bodyZ: -1.2,
  body: { w: 9.4, d: 6.8 },
  porch: { x0: -4.95, x1: 4.95, z0: 2.0, z1: 4.6, y: 0.55 },
  steps: { x0: -0.9, x1: 0.9, z0: 4.6, z1: 5.5 },
  chimney: new THREE.Vector3(4.95, 9.9, -1.2),
  loft: new THREE.Vector3(-3, 9.0, -0.45),
  hammock: new THREE.Vector3(6.2, 0.75, 2.0),
  rocker: new THREE.Vector3(-3.1, 0.55, 3.4),
  bell: new THREE.Vector3(-5.6, 2.2, 5.2),
  door: new THREE.Vector3(0, 0.55, 2.0),
});

const ROOF = PAL.roofRed, ROOF_DARK = 0x9e3d2e, TIMBER = 0x5a3a24, SHUTTER = 0x4f8a6a, DOOR = 0x3f6fa0, TRIM = PAL.wallWhite;

/** A window facing +z: frame, glowing pane, mullions, sill, optional shutters. */
export function windowUnit(k: Kit, t: Xf, w: number, h: number, shutters: number | null = SHUTTER, glow: number = PAL.windowGlow): void {
  k.at(t, () => {
    k.box(w + 0.2, h + 0.2, 0.12, TRIM, { z: 0.02 });
    k.box(w, h, 0.05, glow, { z: 0.07 }, 'glow');
    k.box(0.07, h, 0.06, TRIM, { z: 0.1 });
    k.box(w, 0.07, 0.06, TRIM, { z: 0.1 });
    k.box(w + 0.35, 0.09, 0.26, TRIM, { y: -h / 2 - 0.12, z: 0.1 });
    if (shutters !== null) {
      for (const s of [-1, 1]) {
        k.surf(['planks', { variant: 2, scale: 0.55, strength: 0.8 }], () => k.box(w * 0.5, h + 0.1, 0.06, shutters, { x: s * (w / 2 + w * 0.28 + 0.1), z: 0.05 }));
        k.box(w * 0.36, 0.05, 0.03, 0x3a6a50, { x: s * (w / 2 + w * 0.28 + 0.1), y: h * 0.2, z: 0.09, rz: s * 0.5 });
        k.box(w * 0.36, 0.05, 0.03, 0x3a6a50, { x: s * (w / 2 + w * 0.28 + 0.1), y: -h * 0.2, z: 0.09, rz: -s * 0.5 });
      }
    }
  });
}

/** Gabled roof along x: ridge at `ridge`, eaves at ±halfD (+over), width w, pitch from rise. `surf` paints the slopes. */
export function gableRoof(k: Kit, w: number, halfD: number, wallTop: number, rise: number, over: number, season: Season, color: number = ROOF, dark: number = ROOF_DARK, surf: SurfSpec = 'tile'): void {
  const th = Math.atan2(rise, halfD);
  const len = Math.hypot(halfD, rise) + over;
  for (const side of [0, Math.PI]) {
    k.at({ y: wallTop + rise, ry: side, rx: 0 }, () => {
      k.at({ rx: th }, () => {
        k.slab(w, 0.22, len + 0.1, color, surf, { y: 0.11, z: len / 2 - 0.05 });
        k.surf(['logs', { axis: 'x', strength: 0.6 }], () => k.box(w + 0.1, 0.14, 0.18, dark, { y: 0.08, z: len - 0.02 }));
        if (season === 'winter') k.box(w - 0.1, 0.14, len - 0.4, PAL.snow, { y: 0.3, z: len / 2 - 0.1 });
      });
    });
  }
  k.surf(['logs', { axis: 'x', strength: 0.6 }], () => k.box(w + 0.1, 0.18, 0.34, dark, { y: wallTop + rise + 0.16 }));
}

export function buildFarmhouse(o: BuildOpts): THREE.Group {
  const root = new THREE.Group();
  root.name = 'farmhouse';
  const k = new Kit(o.seed * 31 + 7);
  const F = FARMHOUSE;

  // ---- the house body (body-local frame, centred on the house) ----
  k.at({ z: F.bodyZ }, () => {
    const W = 9, D = 6.4, W2 = 9.3, D2 = 6.8;
    // stone foundation
    k.surf(['fieldstone', { axis: 'h', scale: 0.8 }], () => k.box(W + 0.4, 0.55, D + 0.4, PAL.stone, { y: 0.27 }));
    // ground floor: cream plaster, dark corner posts
    k.surf(['plaster', { strength: 0.55 }], () => k.box(W, 2.7, D, PAL.wallCream, { y: 0.5 + 1.35 }));
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box(0.28, 2.75, 0.28, TIMBER, { x: x * (W / 2), y: 1.87, z: z * (D / 2) });
    // jetty beam + upper storey (whitewash + timber frame)
    k.box(W2 + 0.1, 0.25, D2 + 0.1, TIMBER, { y: 3.3 });
    k.surf(['plaster', { strength: 0.6 }], () => k.box(W2, 2.3, D2, TRIM, { y: 3.42 + 1.15 }));
    const up = 3.42, top = 5.72;
    for (const x of [-4.55, -3.6, -1.55, 1.55, 3.6, 4.55]) k.box(0.18, 2.3, 0.1, TIMBER, { x, y: up + 1.15, z: D2 / 2 + 0.03 });
    k.box(W2, 0.16, 0.1, TIMBER, { y: top - 0.05, z: D2 / 2 + 0.03 });
    for (const s of [-1, 1]) {
      k.beam(s * 4.45, up + 0.1, D2 / 2 + 0.04, s * 3.7, top - 0.1, D2 / 2 + 0.04, 0.14, TIMBER, 'solid', 0.08);
      k.beam(s * 1.65, up + 0.1, D2 / 2 + 0.04, s * 0.9, up + 1.0, D2 / 2 + 0.04, 0.14, TIMBER, 'solid', 0.08);
      // side walls: studs
      for (const z of [-3.3, -1.1, 1.1, 3.3]) k.box(0.1, 2.3, 0.18, TIMBER, { x: s * (W2 / 2 + 0.03), y: up + 1.15, z });
    }
    // attic volume (gable ends) + roof
    k.surf(['plaster', { strength: 0.6 }], () => k.prism([[-D2 / 2, 0], [D2 / 2, 0], [0, 2.9]], W2, TRIM, { y: top, ry: Math.PI / 2 }));
    for (const s of [-1, 1]) {
      k.beam(s * (W2 / 2 + 0.02), top, -D2 / 2, s * (W2 / 2 + 0.02), top + 2.9, 0, 0.12, TIMBER, 'solid', 0.16);
      k.beam(s * (W2 / 2 + 0.02), top, D2 / 2, s * (W2 / 2 + 0.02), top + 2.9, 0, 0.12, TIMBER, 'solid', 0.16);
    }
    gableRoof(k, W2 + 0.9, D2 / 2, top, 2.9, 0.6, o.season);
    // front cross-gable over the door (wall dormer) with a round window
    k.at({ z: D2 / 2 - 0.9 }, () => {
      k.surf(['plaster', { strength: 0.6 }], () => {
        k.box(2.8, 1.5, 2.2, TRIM, { y: top + 0.6 });
        k.prism([[-1.4, 0], [1.4, 0], [0, 1.2]], 2.2, TRIM, { y: top + 1.35 });
      });
      k.at({ y: top + 1.35 + 1.2, z: -0.2 }, () => {
        const th = Math.atan2(1.2, 1.4), len = Math.hypot(1.4, 1.2) + 0.4;
        for (const s of [-1, 1]) {
          const dx = s * Math.cos(th), dy = -Math.sin(th), nx = s * Math.sin(th), ny = Math.cos(th);
          const at = (f: number, off: number): Xf => ({ x: dx * len * f + nx * off, y: dy * len * f + ny * off, rz: -s * th });
          k.surf(['tile', { axis: 'x' }], () => k.box(len, 0.2, 3.0, ROOF, at(0.5, 0.1)));
          k.box(0.18, 0.14, 3.1, ROOF_DARK, at(0.98, 0.08));
          if (o.season === 'winter') k.box(len - 0.3, 0.12, 2.8, PAL.snow, at(0.5, 0.26));
        }
        k.box(0.3, 0.18, 3.02, ROOF_DARK, { y: 0.14 });
      });
      k.cyl(0.42, 0.1, PAL.windowGlow, { y: top + 1.3, z: 1.12, rx: Math.PI / 2 }, 10, 0.42, 'glow');
      k.cyl(0.52, 0.08, TRIM, { y: top + 1.3, z: 1.1, rx: Math.PI / 2 }, 10);
      k.box(0.06, 0.84, 0.06, TRIM, { y: top + 1.3, z: 1.18 });
      k.box(0.84, 0.06, 0.06, TRIM, { y: top + 1.3, z: 1.18 });
      k.box(0.18, 0.18, 0.06, TIMBER, { y: top + 2.05, z: 1.12, rz: Math.PI / 4 });
    });
    // chimney (east gable end)
    k.at({ x: 4.95 }, () => {
      k.surf(['fieldstone', { axis: 'h', scale: 0.75 }], () => {
        k.box(1.3, 3.4, 1.4, PAL.stone, { y: 1.7 });
        k.box(0.95, 6.2, 1.0, PAL.stone, { y: 3.4 + 3.1 });
      });
      k.surf('rock', () => { k.box(1.35, 0.3, 1.45, PAL.rockDark, { y: 3.45 }); k.box(1.15, 0.2, 1.2, PAL.rockDark, { y: 9.6 }); });
      k.box(0.7, 0.3, 0.7, 0x3a3430, { y: 9.8 });
    });
    // windows: ground floor either side of the door, upper floor, sides
    for (const s of [-1, 1]) {
      windowUnit(k, { x: s * 2.7, y: 1.95, z: D / 2 }, 1.2, 1.25);
      windowUnit(k, { x: s * 2.65, y: 4.5, z: D2 / 2 }, 1.05, 1.1);
      flowerBox(k, { x: s * 2.65, y: 3.8, z: D2 / 2 + 0.2 }, 1.5, o.season, s + 2);
      windowUnit(k, { x: s * (W / 2), y: 1.95, z: 1.4, ry: s * Math.PI / 2 }, 1.0, 1.2);
      windowUnit(k, { x: s * (W2 / 2), y: 4.5, z: -1.5, ry: s * Math.PI / 2 }, 0.9, 1.0);
    }
    windowUnit(k, { x: -W / 2, y: 1.95, z: -1.6, ry: -Math.PI / 2 }, 1.0, 1.2);
    windowUnit(k, { x: 0, y: 1.95, z: -D / 2, ry: Math.PI }, 1.2, 1.2);
    windowUnit(k, { x: -2.7, y: 4.5, z: -D2 / 2, ry: Math.PI }, 1.0, 1.0);
    k.cyl(0.35, 0.1, PAL.windowGlow, { x: -W2 / 2 - 0.02, y: top + 1.05, rz: Math.PI / 2 }, 8, 0.35, 'glow');
    k.cyl(0.44, 0.08, TRIM, { x: -W2 / 2 - 0.03, y: top + 1.05, rz: Math.PI / 2 }, 8);
    // front door with frame, round pane, knocker, transom
    k.at({ z: D / 2 }, () => {
      k.box(1.5, 2.45, 0.14, TIMBER, { y: 0.55 + 1.2 });
      k.surf(['planks', { variant: 2, scale: 1.15, strength: 0.85 }], () => k.box(1.15, 2.1, 0.1, DOOR, { y: 0.55 + 1.05, z: 0.06 }));
      k.cyl(0.18, 0.05, PAL.windowGlow, { y: 2.15, z: 0.12, rx: Math.PI / 2 }, 8, 0.18, 'glow');
      k.ball(0.06, PAL.yellow, { x: 0.4, y: 1.5, z: 0.14 });
      k.box(1.1, 0.25, 0.06, PAL.windowGlow, { y: 2.83, z: 0.05 }, 'glow');
      k.box(0.5, 0.35, 0.05, PAL.woodLight, { y: 3.08, z: 0.1 });
      // porch lanterns by the door
      for (const s of [-1, 1]) {
        k.box(0.08, 0.3, 0.2, PAL.ink, { x: s * 1.0, y: 2.25, z: 0.12 });
        k.emit({ wall: [0, 0, 1] }, () => k.box(0.2, 0.32, 0.2, PAL.lampGlow, { x: s * 1.0, y: 2.05, z: 0.28 }, 'glow'));   // lights the porch, never the hall behind
        k.cone(0.18, 0.14, PAL.ink, { x: s * 1.0, y: 2.28, z: 0.28 }, 4);
      }
    });
  });

  // ---- porch (farmhouse-local) ----
  const P = F.porch;
  const pw = P.x1 - P.x0, pd = P.z1 - P.z0, pzc = (P.z0 + P.z1) / 2;
  k.surf(['planks', { axis: 'x', scale: 0.8 }], () => k.box(pw, 0.14, pd, PAL.plank, { y: P.y - 0.07, z: pzc }));
  k.box(pw, P.y - 0.14, 0.08, PAL.woodDark, { y: (P.y - 0.14) / 2, z: P.z1 - 0.04 });
  for (let i = 0; i < 16; i++) k.box(0.06, P.y - 0.2, 0.02, PAL.wood, { x: P.x0 + 0.3 + i * 0.62, y: (P.y - 0.14) / 2, z: P.z1 + 0.01, rz: 0.6 });
  // steps
  const S = F.steps;
  for (let i = 0; i < 3; i++) {
    const zz = S.z0 + 0.15 + i * 0.3, h = P.y - (i + 1) * (P.y / 3.3);
    k.surf(['logs', { axis: 'x' }], () => k.box(S.x1 - S.x0, 0.1, 0.34, PAL.plank, { y: h + 0.05, z: zz }));
    k.box(S.x1 - S.x0 - 0.05, h, 0.3, PAL.woodDark, { y: h / 2, z: zz });
  }
  for (const s of [-1, 1]) k.box(0.1, 0.9, 0.1, TRIM, { x: s * 0.95, y: 0.45, z: S.z1 - 0.1 });
  // posts, railings, lean-to roof
  const postZ = P.z1 - 0.2, postH = 2.95 - P.y;
  const posts = [P.x0 + 0.15, -1.1, 1.1, P.x1 - 0.15];
  for (const x of posts) {
    k.box(0.2, postH, 0.2, TRIM, { x, y: P.y + postH / 2, z: postZ });
    k.box(0.3, 0.1, 0.3, TRIM, { x, y: P.y + 0.05, z: postZ });
    k.beam(x, P.y + postH - 0.55, postZ, x + (x > 0 ? -0.45 : 0.45), P.y + postH - 0.02, postZ, 0.08, TRIM);
  }
  for (const [a, b] of [[posts[0], posts[1]], [posts[2], posts[3]]]) {
    k.box(b - a, 0.08, 0.12, TRIM, { x: (a + b) / 2, y: P.y + 0.85, z: postZ });
    k.box(b - a, 0.06, 0.08, TRIM, { x: (a + b) / 2, y: P.y + 0.12, z: postZ });
    for (let x = a + 0.22; x < b - 0.1; x += 0.22) k.box(0.05, 0.72, 0.05, TRIM, { x, y: P.y + 0.48, z: postZ });
  }
  for (const s of [-1, 1]) { // side railings
    const x = s > 0 ? P.x1 - 0.15 : P.x0 + 0.15;
    k.box(0.12, 0.08, pd - 0.3, TRIM, { x, y: P.y + 0.85, z: pzc - 0.1 });
    for (let z = P.z0 + 0.15; z < P.z1 - 0.3; z += 0.22) k.box(0.05, 0.72, 0.05, TRIM, { x, y: P.y + 0.48, z });
  }
  k.box(pw + 0.3, 0.16, 0.2, TRIM, { y: 2.95 + 0.05, z: postZ });
  {
    const y0 = 3.55, y1 = 3.0, z0 = P.z0 - 0.1, z1 = P.z1 + 0.35;
    const th = Math.atan2(y0 - y1, z1 - z0), len = Math.hypot(y0 - y1, z1 - z0);
    k.at({ y: y0, z: z0, rx: th }, () => {
      k.slab(pw + 0.6, 0.16, len, 0x8a5a3a, ['shingle', { variant: 1 }], { y: 0.08, z: len / 2 });
      if (o.season === 'winter') k.box(pw + 0.3, 0.12, len - 0.2, PAL.snow, { y: 0.24, z: len / 2 });
    });
  }
  // porch furniture: side table with lemonade, welcome mat, pots, watering can, a pumpkin in autumn
  k.at({ x: -2.1, y: P.y, z: 2.9 }, () => {
    k.cyl(0.28, 0.06, PAL.woodLight, { y: 0.55 }, 8);
    k.cyl(0.05, 0.55, PAL.wood, { y: 0.27 }, 6);
    k.cyl(0.08, 0.22, 0xf6e58a, { y: 0.69 }, 6, 0.07);
    k.cyl(0.04, 0.12, 0xdde8f0, { x: 0.16, y: 0.64 }, 6);
  });
  k.box(1.2, 0.02, 0.7, 0xb0553e, { y: P.y + 0.01, z: 2.55 });
  k.box(1.0, 0.021, 0.5, 0xd88a5a, { y: P.y + 0.012, z: 2.55 });
  // big pots flank the door, clear of the railing (z 4.4) and the door posts (x ±1.1)
  flowerPot(k, { x: -1.65, y: P.y, z: 3.9 }, o.season, 1, true);
  flowerPot(k, { x: 1.65, y: P.y, z: 3.9 }, o.season, 3, true);
  flowerPot(k, { x: 1.4, y: 0, z: 5.3 }, o.season, 2);
  flowerPot(k, { x: -1.4, y: 0, z: 5.3 }, o.season, 4);
  wateringCan(k, { x: 3.9, y: P.y, z: 3.9, ry: 0.6 });
  if (o.season === 'autumn') { k.ball(0.28, PAL.pumpkin, { x: 0.95, y: 0.4, z: 5.05, s: [1, 0.75, 1] }, 1); k.ball(0.2, PAL.pumpkin, { x: -0.95, y: 0.3, z: 5.15, s: [1, 0.75, 1] }, 1); }

  // woodpile + chopping block on the west wall
  firewood(k, { x: -5.3, z: -1.0, ry: -Math.PI / 2 }, 2.4, 5);
  choppingBlock(k, { x: -6.1, z: 1.6 });
  bucket(k, { x: 5.8, z: -3.0 }, true);

  // hammock frame (east side): two posts and ropes; the cloth is animated
  const H = F.hammock;
  for (const dz of [-1.6, 1.6]) {
    k.box(0.2, 1.9, 0.2, PAL.trunk, { x: H.x, y: 0.95, z: H.z + dz });
    k.beam(H.x, 1.6, H.z + dz, H.x, 0, H.z + dz * 1.45, 0.08, PAL.woodDark);
    k.cyl(0.13, 0.12, PAL.bark, { x: H.x, y: 1.92, z: H.z + dz }, 6);
  }

  // bell post (rings when a farmer needs you)
  const B = F.bell;
  k.box(0.18, 2.6, 0.18, PAL.woodDark, { x: B.x, y: 1.3, z: B.z });
  k.box(0.7, 0.14, 0.14, PAL.woodDark, { x: B.x + 0.28, y: 2.55, z: B.z });
  k.beam(B.x, 2.1, B.z, B.x + 0.35, 2.5, B.z, 0.08, PAL.woodDark);
  k.cyl(0.3, 0.15, PAL.stone, { x: B.x, y: 0.07, z: B.z }, 6);

  // pigeon loft on the roof ridge (the life package flies carrier pigeons from here)
  k.at({ x: F.loft.x, y: 8.3, z: F.bodyZ }, () => {
    k.box(0.3, 0.7, 0.3, TIMBER, { y: 0.1 });
    k.surf(['planks', { axis: 'h', variant: 2, scale: 0.6, strength: 0.7 }], () => k.box(1.4, 0.95, 1.2, TRIM, { y: 0.8 }));
    k.box(1.5, 0.08, 1.3, TIMBER, { y: 0.32 });
    k.surf(['shingle', { scale: 0.6 }], () => k.prism([[-0.75, 0], [0.75, 0], [0, 0.55]], 1.3, PAL.roofBlue, { y: 1.27, ry: Math.PI / 2, s: [1.08, 1, 1.12] }));
    for (const x of [-0.38, 0, 0.38]) {
      k.cyl(0.14, 0.05, PAL.ink, { x, y: 0.88, z: 0.6, rx: Math.PI / 2 }, 8);
      k.box(0.3, 0.04, 0.16, PAL.woodLight, { x, y: 0.7, z: 0.67 });
    }
    k.box(1.6, 0.05, 0.12, PAL.woodLight, { y: 0.52, z: 0.72 });
  });
  // weathervane base on the ridge
  k.at({ x: 1.8, y: 8.5, z: F.bodyZ }, () => {
    k.cyl(0.05, 1.0, PAL.metalDark, { y: 0.5 }, 5);
    k.ball(0.09, PAL.yellow, { y: 1.0 });
    k.box(0.9, 0.04, 0.04, PAL.metalDark, { y: 0.55 });
    k.box(0.04, 0.04, 0.9, PAL.metalDark, { y: 0.55 });
  });
  k.build(root, o.night);

  // ---- animated parts ----
  // weathervane: arrow + rooster
  const vk = new Kit(3);
  vk.box(1.1, 0.05, 0.05, PAL.metalDark, {});
  vk.prism([[0, -0.14], [0.3, 0], [0, 0.14]], 0.04, PAL.metalDark, { x: 0.55 });
  vk.prism([[-0.3, -0.18], [0, -0.05], [0, 0.05], [-0.3, 0.18]], 0.04, PAL.metalDark, { x: -0.5 });
  vk.prism([[-0.25, 0], [0.2, 0], [0.25, 0.22], [0.12, 0.38], [0.02, 0.25], [-0.12, 0.3], [-0.3, 0.45], [-0.25, 0.15]], 0.04, PAL.ink, { y: 0.03 });
  vk.box(0.06, 0.1, 0.05, PAL.red, { x: 0.15, y: 0.42 });
  const vane = vk.mesh();
  vane.position.set(1.8, 8.5 + 1.15, F.bodyZ);
  root.add(vane);

  // rocking chair
  const rk = new Kit(4);
  for (const s of [-1, 1]) {
    rk.prism([[-0.45, 0.02], [-0.3, -0.03], [0, -0.05], [0.3, -0.03], [0.45, 0.02], [0.3, 0.02], [0, 0.0], [-0.3, 0.02]], 0.06, PAL.woodDark, { x: s * 0.26, ry: Math.PI / 2 });
    rk.box(0.06, 0.5, 0.06, PAL.wood, { x: s * 0.26, y: 0.25, z: 0.2 });
    rk.box(0.06, 1.0, 0.06, PAL.wood, { x: s * 0.26, y: 0.5, z: -0.2, rx: -0.12 });
    rk.box(0.07, 0.05, 0.45, PAL.wood, { x: s * 0.28, y: 0.62, z: 0.02 });
  }
  rk.box(0.58, 0.06, 0.5, PAL.woodLight, { y: 0.45 });
  rk.box(0.5, 0.08, 0.44, PAL.red, { y: 0.5 });
  for (let i = 0; i < 4; i++) rk.box(0.5, 0.08, 0.04, PAL.woodLight, { y: 0.62 + i * 0.16, z: -0.23 - i * 0.02, rx: -0.12 });
  const rocker = rk.mesh();
  rocker.position.copy(F.rocker);
  rocker.rotation.y = 0.35;
  root.add(rocker);

  // hammock cloth (pivot along its length, sways)
  const hk = new Kit(5);
  const segs = 8, hl = 2.9;
  for (let i = 0; i < segs; i++) {
    const z = -hl / 2 + (i + 0.5) * (hl / segs);
    const u = (z / (hl / 2));
    const sag = -0.65 * (1 - u * u);
    hk.surf(['fabric', { axis: 'z' }], () => hk.box(0.85, 0.05, hl / segs + 0.02, i % 2 ? 0xe86a5a : 0xf6e6b8, { y: sag, z }));
    hk.box(0.05, 0.12, hl / segs + 0.02, 0xd9453b, { x: 0.43, y: sag + 0.05, z });
    hk.box(0.05, 0.12, hl / segs + 0.02, 0xd9453b, { x: -0.43, y: sag + 0.05, z });
  }
  for (const s of [-1, 1]) { hk.rod(0, 0, s * 1.6, 0.35, -0.2, s * hl / 2, 0.02, PAL.cloth); hk.rod(0, 0, s * 1.6, -0.35, -0.2, s * hl / 2, 0.02, PAL.cloth); }
  hk.box(0.5, 0.14, 0.3, PAL.wallWhite, { y: -0.25, z: -1.05 });
  const hammock = hk.mesh();
  hammock.position.set(H.x, 1.6, H.z);
  root.add(hammock);

  // bell (pivot at the arm)
  const bk = new Kit(6);
  bk.cyl(0.06, 0.16, PAL.metalDark, { y: -0.08 }, 5);
  bk.surf(['metal', { strength: 0.5, scale: 0.4 }], () => {
    bk.cyl(0.26, 0.42, 0xd9a93a, { y: -0.36 }, 10, 0.12);
    bk.cyl(0.28, 0.06, 0xb8862a, { y: -0.57 }, 10);
  });
  bk.ball(0.07, PAL.metalDark, { y: -0.62 });
  const bell = bk.mesh();
  bell.position.set(B.x + 0.52, 2.48, B.z);
  root.add(bell);

  // chimney smoke puffs (instanced)
  const PUFFS = 28;
  const puffGeo = new THREE.IcosahedronGeometry(0.5, 0);
  const smokeMat = toon(0xe9e4dc);
  const smoke = new THREE.InstancedMesh(puffGeo, smokeMat, PUFFS);
  smoke.frustumCulled = false;
  smoke.castShadow = false;
  root.add(smoke);
  const puff = Array.from({ length: PUFFS }, () => ({ age: 1e9, life: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 1, spin: 0 }));
  const dummy = new THREE.Object3D();
  let emitAcc = 0, next = 0, ioS = 0;

  let bellT = 99, rockPhase = 0;
  let vaneYaw = 0, vaneV = 0;
  const rig: Rig = {
    update(e: Env) {
      const { dt, t } = e;
      // weathervane: points into the wind, springy
      const wl = Math.hypot(e.wind.x, e.wind.z);
      const target = wl > 0.05 ? Math.atan2(-e.wind.z, e.wind.x) + Math.PI : vaneYaw;
      let d = target - vaneYaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      vaneV += (d * 6 - vaneV * 2.2) * dt;
      vaneYaw += vaneV * dt + Math.sin(t * 3.1) * 0.002 * wl;
      vane.rotation.y = vaneYaw;
      // rocker drifts gently (someone just got up)
      rockPhase += dt * 1.6;
      rocker.rotation.x = Math.sin(rockPhase) * 0.07 * (0.5 + 0.5 * Math.sin(t * 0.13));
      // hammock sways in the wind
      hammock.rotation.z = Math.sin(t * 0.9) * (0.05 + 0.04 * Math.min(1, wl / 4)) + Math.sin(t * 2.3) * 0.01;
      // bell swing
      bellT += dt;
      bell.rotation.z = bellT < 4 ? Math.sin(bellT * 11) * 0.7 * Math.exp(-bellT * 1.2) : Math.sin(t * 1.3) * 0.02;
      // chimney smoke: rate and size follow disk IO (log scaled)
      ioS = damp(ioS, e.lv.io, 1.5, dt);
      const rate = 0.7 + ioS * 7, size = 0.55 + ioS * 0.9;
      emitAcc += dt * rate;
      while (emitAcc >= 1) {
        emitAcc -= 1;
        const p = puff[next]; next = (next + 1) % PUFFS;
        p.age = 0; p.life = 2.6 + ioS * 1.8 + Math.sin(t * 7.1 + next) * 0.4;
        p.x = F.chimney.x + Math.sin(t * 13 + next) * 0.1; p.y = F.chimney.y; p.z = F.chimney.z + Math.cos(t * 11 + next) * 0.1;
        p.vx = 0; p.vy = 0.9 + ioS * 1.2; p.vz = 0; p.s = size * (0.8 + 0.4 * Math.abs(Math.sin(t * 5 + next))); p.spin = next;
      }
      for (let i = 0; i < PUFFS; i++) {
        const p = puff[i];
        p.age += dt;
        const u = p.age / p.life;
        if (u >= 1) { dummy.scale.setScalar(0); dummy.position.set(0, -100, 0); dummy.updateMatrix(); smoke.setMatrixAt(i, dummy.matrix); continue; }
        p.vx = damp(p.vx, e.wind.x * 0.35, 0.8, dt); p.vz = damp(p.vz, e.wind.z * 0.35, 0.8, dt);
        p.vy *= 1 - dt * 0.25;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        const grow = Math.min(1, u * 5) * (1 - u * u) * (0.45 + u * 1.1);
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(p.spin + p.age * 0.3, p.spin * 1.7, 0);
        dummy.scale.setScalar(p.s * grow);
        dummy.updateMatrix();
        smoke.setMatrixAt(i, dummy.matrix);
      }
      smoke.instanceMatrix.needsUpdate = true;
    },
    poke(what) { if (what === 'blocked') bellT = 0; },
  };
  root.userData.rig = rig;
  return root;
}
