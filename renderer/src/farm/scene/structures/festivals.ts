/**
 * Festivals: the real-calendar holidays of model/calendar.ts dressed in the world. Whatever festival is on today
 * (`ctx.valley.sky.festival.active`, or the `?festival=ID` / `__valley.festival(id)` override) gets its decorations
 * built around the square, the roads and the pond; when the festival changes while you watch, the old set goes and
 * the new one pops in with confetti.
 *
 *   Blossom Fair      a ribboned maypole on the square, flower garlands between the plaza lamps, cherry petals on the breeze
 *   Lantern Night     paper lanterns strung round the pond, lanterns floating on it, sky lanterns rising after dark
 *   Founders' Day     a birthday cake on the square, pennant garlands
 *   Harvest Festival  the giant prize pumpkin (judge it), a cornucopia table, hay stacks, the scarecrow contest (vote)
 *   Hallowtide        jack-o'-lanterns along the roads (real lights at night), bats over the square, wisps by the pond
 *   Starlight         a decorated tree with a star, string lights over the square, snow lanterns along the roads
 *   New Year          string lights, a punch table (raise a glass), fireworks at midnight (the upgrades' show)
 *
 * Every set also hangs a cloth banner with the festival's name over the square's south exit.
 *
 * Draw calls: one set at a time: static parts merge into ≤ 3 meshes (solid toon, "paper" lit by day and glowing at
 * night, "flame" dark by day, glowing at night) + the banner + a plaque, and one InstancedMesh per animated swarm
 * (petals, floating / sky lanterns, bats, wisps): ≤ 9 calls. Glowing things register LightEmitters (scene/lights).
 * Static decorations live in the structures group (the placement audit sees them); animated swarms in their own
 * scene group ('festival-fx').
 */
import * as THREE from 'three';
import type { ActiveFestival, Deco, FestivalId } from '../../model/calendar.ts';
import { festivalById } from '../../model/calendar.ts';
import type { Season, Sky } from '../../model/types.ts';
import { POND, SITES, WORLD, heightAt, inSite } from '../../world/map.ts';
import type { AudioService, LightEmitter, LightsService, SceneCtx } from '../context.ts';
import { PAL, toon } from '../toon.ts';
import { loft } from '../sculpt.ts';
import { warmEmitter } from '../lights/emitters.ts';
import { FONT, Kit, canvasTex, fitText, plaque, rng, roundRect, solidMat } from './kit.ts';
import type { Plaque, Xf } from './kit.ts';
import type { Env } from './rig.ts';
import { PLAZA } from './dressing.ts';
import { hayBale, pumpkin } from './props.ts';
import { nearestRoad, pathDist, structDist, wet } from './upgrades.ts';

const TAU = Math.PI * 2;
const LAMP_HEAD = 2.75;

// ---------------------------------------------------------------------------------------------------------------
// Kits: solid (toon), paper (lit by day, glows at night), flame (dark by day, glows at night)

export interface Kits { s: Kit; p: Kit; f: Kit }
export const kits = (seed: number): Kits => {
  const K = { s: new Kit(seed), p: new Kit(seed + 1), f: new Kit(seed + 2) };
  K.p.jitter = 0.02; K.f.jitter = 0;
  return K;
};
function at(K: Kits, t: Xf, fn: () => void): void {
  K.s.push(t); K.p.push(t); K.f.push(t);
  try { fn(); } finally { K.s.pop(); K.p.pop(); K.f.pop(); }
}
function part(K: Kits, name: string, fn: () => void): void { K.s.part(name, () => K.p.part(name, () => K.f.part(name, fn))); }

/** lit materials: `day` = brightness by day, `night` = at full night (HDR: blooms) */
function litMat(day: number, night: number): THREE.MeshBasicMaterial {
  const m = warmEmitter(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  m.userData.day = day; m.userData.night = night;
  return m;
}
function setLit(m: THREE.MeshBasicMaterial, n: number, boost = 1): void {
  const k = Math.min(1, Math.max(0, n));
  const e = k * k * (3 - 2 * k);
  m.color.setScalar(((m.userData.day as number) + ((m.userData.night as number) - (m.userData.day as number)) * e) * boost);
}

/** the Kits' meshes into `into` (solid, paper, flame); returns the lit materials used */
function kitMeshes(K: Kits, into: THREE.Object3D, paper: THREE.MeshBasicMaterial, flame: THREE.MeshBasicMaterial): void {
  const s = K.s.geometry('solid');
  if (s) { const m = new THREE.Mesh(s, solidMat()); m.name = 'festival:solid'; m.castShadow = true; m.receiveShadow = true; into.add(m); }
  const p = K.p.geometry('solid');
  if (p) { const m = new THREE.Mesh(p, paper); m.name = 'festival:paper'; into.add(m); }
  const f = K.f.geometry('solid');
  if (f) { const m = new THREE.Mesh(f, flame); m.name = 'festival:flame'; into.add(m); }
}

// ---------------------------------------------------------------------------------------------------------------
// Pieces (local space, ground at y = 0, front = +z)

/** a ribbed pumpkin, base on y = 0 (low-poly loft with 8 ribs) */
function ribbed(k: Kit, t: Xf, r: number, color: number = PAL.pumpkin): void {
  const g = loft([
    { p: [0, 0, 0], r: r * 0.45 }, { p: [0, r * 0.22, 0], r: r * 0.88 }, { p: [0, r * 0.7, 0], r },
    { p: [0, r * 1.12, 0], r: r * 0.84 }, { p: [0, r * 1.32, 0], r: r * 0.36 },
  ], { sides: 16, sub: 2, caps: ['flat', 'flat'], paint: color, bump: (a) => 0.96 + 0.08 * Math.abs(Math.cos(a * 4)) });
  k.at(t, () => {
    k.add(g, color);
    k.cyl(r * 0.07, r * 0.32, 0x6b6a2a, { y: r * 1.42, rz: 0.25 }, 5, r * 0.05);
  });
}

/** the pumpkin's radius at height y (matches `ribbed`) */
const ribR = (r: number, y: number): number => {
  const u = y / r;
  return u > 0.7 ? r * (1 - ((u - 0.7) / 0.42) ** 2 * 0.16) : r * (1 - ((0.7 - u) / 0.48) ** 2 * 0.12);
};

/** a carved jack-o'-lantern: the face glows (flame kit) */
export function jackOLantern(K: Kits, t: Xf, r: number, face = 0): void {
  part(K, 'jackOLantern', () => at(K, t, () => {
    ribbed(K.s, {}, r);
    const glow = 0xffb040;
    const on = (a: number, y: number, fn: (d: number) => void) => { const d = ribR(r, y); K.f.at({ x: Math.sin(a) * d, y, z: Math.cos(a) * d, ry: a }, () => fn(d)); };
    // eyes: triangles (or round for a surprised one), a nose, a toothy grin along the curve
    for (const s of [-1, 1]) on(s * 0.36, r * 0.9, () => {
      if (face === 1) K.f.cyl(r * 0.13, r * 0.12, glow, { rx: Math.PI / 2 }, 6);
      else K.f.prism([[-r * 0.16, -r * 0.1], [r * 0.16, -r * 0.1], [s * r * 0.05, r * 0.14]], r * 0.12, glow);
    });
    on(0, r * 0.68, () => K.f.prism([[-r * 0.06, -r * 0.05], [r * 0.06, -r * 0.05], [0, r * 0.06]], r * 0.12, glow));
    for (let i = -2; i <= 2; i++) on(i * 0.17, r * (0.42 + (Math.abs(i) === 2 ? 0.06 : 0)), () => K.f.box(r * 0.15, r * (i % 2 ? 0.12 : 0.2), r * 0.12, glow, { y: i % 2 ? -r * 0.02 : 0 }));
  }));
}

/** a round paper lantern hanging from y = 0 (its hook) */
export function paperLantern(K: Kits, t: Xf, color: number, s = 1): void {
  at(K, t, () => {
    K.s.cyl(0.006, 0.08 * s, PAL.ink, { y: -0.04 * s }, 3);
    K.s.cyl(0.075 * s, 0.035 * s, 0x3a2418, { y: -0.095 * s }, 8);
    K.p.ball(0.15 * s, color, { y: -0.27 * s, s: [1, 1.18, 1] }, 1);
    K.s.cyl(0.075 * s, 0.035 * s, 0x3a2418, { y: -0.45 * s }, 8);
    K.s.cyl(0.018 * s, 0.13 * s, PAL.red, { y: -0.53 * s }, 4);
  });
}

/** a sagging string from a to b (world / kit space); `each` decorates the points between */
function sagged(K: Kits, a: THREE.Vector3, b: THREE.Vector3, step: number, each: (p: THREE.Vector3, i: number, yaw: number) => void, wire: number = PAL.ink, slack = 0.07, maxDroop = 1.0): void {
  const len = a.distanceTo(b), n = Math.max(4, Math.round(len / step)), droop = Math.min(maxDroop, len * slack);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) { const u = i / n; pts.push(new THREE.Vector3().lerpVectors(a, b, u).add(new THREE.Vector3(0, -droop * 4 * u * (1 - u), 0))); }
  for (let i = 0; i < n; i++) K.s.rod(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z, 0.012, wire, 4);
  const yaw = Math.atan2(b.x - a.x, b.z - a.z);
  for (let i = 1; i < n; i++) each(pts[i], i, yaw);
}

/** the maypole (without its spinning crown, `maypoleCrown`) */
export function maypole(K: Kits, t: Xf, season: Season, ground: (lx: number, lz: number) => number = () => 0): void {
  const cols = [PAL.pink, PAL.yellow, PAL.blue, PAL.green, 0xb9a0f0, PAL.red, PAL.white, PAL.orange];
  part(K, 'maypole', () => at(K, t, () => {
    K.s.surf(['rock', { scale: 0.5 }], () => K.s.cyl(0.62, 0.26, PAL.stone, { y: 0.09 }, 10, 0.55));
    K.s.cyl(0.09, 5.3, PAL.wallWhite, { y: 2.65 + 0.2 }, 8, 0.07);
    // a red ribbon wound down the pole
    for (let i = 0; i < 26; i++) {
      const a0 = i * 0.9, a1 = a0 + 0.9, y0 = 0.4 + i * 0.18, y1 = y0 + 0.18;
      K.s.rod(Math.cos(a0) * 0.095, y0, Math.sin(a0) * 0.095, Math.cos(a1) * 0.092, y1, Math.sin(a1) * 0.092, 0.022, PAL.red, 4);
    }
    K.s.ball(0.12, 0xd9a93a, { y: 5.6 }, 1);
    // ribbons from the top to pegs in a ring, each with a flower at the peg
    const fl = [PAL.pink, 0xfff2a8, PAL.white, 0xff9ab8];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU, x = Math.sin(a) * 2.5, z = Math.cos(a) * 2.5, g = ground(x, z);
      K.s.rod(Math.sin(a) * 0.14, 5.0, Math.cos(a) * 0.14, x, g + 0.42, z, 0.026, cols[i], 4);
      K.s.box(0.09, 0.5, 0.09, PAL.woodDark, { x, y: g + 0.19, z });
      K.s.ball(0.08, fl[i % fl.length], { x, y: g + 0.47, z }, 0);
    }
    // a flower ring round the foot
    for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU; K.s.ball(i % 2 ? 0.09 : 0.11, i % 2 ? PAL.leaf : fl[i % fl.length], { x: Math.sin(a) * 0.48, y: 0.27, z: Math.cos(a) * 0.48 }); }
    if (season === 'winter') K.s.cyl(0.6, 0.06, PAL.snow, { y: 0.25 }, 10, 0.5);
  }));
}

/** the maypole's flower crown with short streamers (spins) */
export function maypoleCrown(k: Kit): void {
  const cols = [PAL.pink, PAL.yellow, PAL.blue, PAL.green, 0xb9a0f0, PAL.red];
  for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; k.ball(0.1, i % 2 ? PAL.leafDark : [PAL.pink, PAL.white, 0xfff2a8][i % 3], { x: Math.sin(a) * 0.3, z: Math.cos(a) * 0.3 }, 0); }
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + 0.2; k.box(0.06, 0.7, 0.012, cols[i], { x: Math.sin(a) * 0.36, y: -0.36, z: Math.cos(a) * 0.36, ry: a, rx: 0.15 }); }
}

/** the giant prize pumpkin on its pallet, with a blue rosette and a pair of scales */
export function prizePumpkin(K: Kits, t: Xf): void {
  part(K, 'prizePumpkin', () => at(K, t, () => {
    K.s.surf(['planks', { axis: 'x' }], () => { K.s.box(2.1, 0.12, 2.1, PAL.plank, { y: 0.16 }); });
    for (const x of [-0.85, 0, 0.85]) K.s.box(0.16, 0.12, 2.1, PAL.woodDark, { x, y: 0.05 });
    ribbed(K.s, { y: 0.22 }, 0.92, 0xf08a2c);
    // rosette pinned on the front
    const ry = ribR(0.92, 0.7) + 0.02;
    K.s.at({ y: 0.22 + 0.7 * 0.92, z: ry }, () => {
      K.s.cyl(0.18, 0.03, 0x2f6fc8, { rx: Math.PI / 2 }, 10);
      K.s.cyl(0.1, 0.04, 0xf2d24a, { rx: Math.PI / 2, z: 0.01 }, 8);
      for (const s of [-1, 1]) K.s.box(0.07, 0.3, 0.015, 0x2f6fc8, { x: s * 0.06, y: -0.25, rz: s * 0.2 });
    });
    // weighing scale beside it
    K.s.at({ x: 1.45, z: 0.4 }, () => {
      K.s.box(0.5, 0.06, 0.5, PAL.metalDark, { y: 0.03 });
      K.s.cyl(0.04, 0.9, PAL.metalDark, { y: 0.5, z: -0.2 }, 6);
      K.s.cyl(0.17, 0.05, 0xf2efe6, { y: 0.98, z: -0.15, rx: Math.PI / 2 }, 12);
      K.s.box(0.015, 0.12, 0.02, PAL.red, { y: 1.0, z: -0.12, rz: 0.6 });
      K.s.box(0.45, 0.04, 0.45, PAL.metal, { y: 0.1 });
    });
  }));
}

/** a trestle table with a cloth and a wicker horn of plenty spilling produce */
export function cornucopia(K: Kits, t: Xf): void {
  part(K, 'cornucopia', () => at(K, t, () => {
    for (const x of [-0.8, 0.8]) for (const z of [-0.32, 0.32]) K.s.box(0.08, 0.82, 0.08, PAL.woodDark, { x, y: 0.41, z: z, rx: z * 0.18 });
    K.s.surf(['planks', { axis: 'x' }], () => K.s.box(2.1, 0.07, 0.95, PAL.plank, { y: 0.84 }));
    K.s.surf(['fabric', { scale: 0.7 }], () => { K.s.box(2.14, 0.02, 0.99, 0xb8423a, { y: 0.885 }); K.s.box(2.14, 0.28, 0.02, 0xb8423a, { y: 0.76, z: 0.5 }); });
    const horn = loft([
      { p: [-0.92, 1.42, -0.05], r: 0.02 }, { p: [-0.86, 1.2, -0.05], r: 0.07 }, { p: [-0.62, 1.03, 0], r: 0.15 },
      { p: [-0.28, 1.08, 0.04], r: 0.24 }, { p: [0.02, 1.2, 0.06], r: 0.3 },
    ], { sides: 12, sub: 3, caps: ['pole', 'flat'], paint: 0xc8955a });
    K.s.surf(['thatch', { scale: 0.35 }], () => K.s.add(horn, 0xc8955a));
    K.s.cyl(0.28, 0.02, 0x5a3a1e, { x: 0.025, y: 1.2, z: 0.06, rz: Math.PI / 2 }, 12); // the dark mouth
    // produce tumbling out over the cloth
    const P: [number, number, number, number, number][] = [
      [0.2, 1.0, 0.1, 0.12, PAL.apple], [0.42, 0.98, -0.12, 0.11, PAL.apple], [0.15, 1.02, -0.18, 0.1, 0xe6c13a],
      [0.6, 0.97, 0.18, 0.1, PAL.apple], [0.75, 0.97, -0.05, 0.09, 0x8fcf6a],
    ];
    for (const [x, y, z, r, c] of P) K.s.ball(r, c, { x, y, z }, 1);
    // grapes
    for (let i = 0; i < 9; i++) K.s.ball(0.045, PAL.grape, { x: 0.32 + (i % 3) * 0.06, y: 1.0 + Math.floor(i / 3) * 0.05, z: 0.22 - Math.floor(i / 3) * 0.02 });
    // corn cobs with husks, a small pumpkin, a wheat sheaf
    for (const [x, z, a] of [[-0.05, 0.3, 0.4], [0.9, 0.28, -0.5]]) {
      K.s.ball(0.06, 0xf2c33a, { x, y: 0.97, z, ry: a, rz: Math.PI / 2, s: [1, 2.6, 1] });
      K.s.box(0.18, 0.015, 0.07, 0x9fb85a, { x: x - Math.cos(a) * 0.15, y: 0.92, z: z + Math.sin(a) * 0.15, ry: a });
    }
    pumpkin(K.s, { x: -0.72, y: 0.895, z: 0.33 }, 0.14);
    for (let i = 0; i < 9; i++) K.s.cyl(0.012, 0.6, PAL.wheat, { x: 0.82 + (i % 3 - 1) * 0.03, y: 1.2, z: -0.3 + (Math.floor(i / 3) - 1) * 0.03, rz: (i % 3 - 1) * 0.12, rx: (Math.floor(i / 3) - 1) * 0.12 }, 3);
    K.s.cyl(0.05, 0.05, 0xb8423a, { x: 0.82, y: 1.05, z: -0.3 }, 6);
  }));
}

/** two bales and one on top, a couple of pumpkins, a corn shock */
export function hayStack(K: Kits, t: Xf, season: Season, jack = false): void {
  part(K, 'hayStack', () => at(K, t, () => {
    hayBale(K.s, { x: -0.58, ry: 0.04 });
    hayBale(K.s, { x: 0.58, ry: -0.05 });
    hayBale(K.s, { y: 0.55, ry: 0.12 });
    if (jack) jackOLantern(K, { x: 0.05, y: 1.1, z: 0.05 }, 0.22, 1);
    else pumpkin(K.s, { y: 1.1 }, 0.17);
    pumpkin(K.s, { x: -0.95, z: 0.62 }, 0.2);
    pumpkin(K.s, { x: -0.55, z: 0.72 }, 0.14);
    // a corn shock: stalks tied round the middle
    K.s.at({ x: 1.62, z: -0.1 }, () => {
      K.s.surf(['thatch', { scale: 0.5 }], () => {
        K.s.cyl(0.4, 1.25, 0xc9b26a, { y: 0.62 }, 7, 0.1);
        K.s.cone(0.16, 0.42, 0xb59a52, { y: 1.42 }, 7);
      });
      K.s.cyl(0.13, 0.07, 0x8a5a2a, { y: 1.2 }, 7);
    });
    if (season === 'winter') K.s.box(1.0, 0.08, 0.6, PAL.snow, { y: 1.12, ry: 0.12 });
  }));
}

/** a scarecrow-contest entry: 0 classic, 1 Clawd costume, 2 Codex cloud costume */
export function scarecrowEntry(K: Kits, t: Xf, style: number): void {
  const shirt = [0x5a8fd0, 0xe8a23a, 0x8e5fc2][style % 3];
  part(K, 'scarecrowEntry', () => at(K, t, () => {
    K.s.box(0.11, 2.05, 0.11, PAL.woodDark, { y: 1.025 });
    K.s.beam(-0.72, 1.38, 0, 0.72, 1.38, 0, 0.07, PAL.woodDark);
    K.s.surf(['fabric', { scale: 0.6 }], () => {
      K.s.box(0.56, 0.62, 0.3, shirt, { y: 1.18 });
      K.s.box(1.22, 0.18, 0.22, shirt, { y: 1.38 });
      K.s.box(0.48, 0.38, 0.26, 0x4a5f8a, { y: 0.72 });
    });
    for (const s of [-1, 1]) K.s.cone(0.07, 0.2, PAL.hay, { x: s * 0.68, y: 1.38, rz: s * Math.PI / 2 }, 5);
    K.s.box(0.1, 0.14, 0.04, PAL.yellow, { x: -0.12, y: 1.2, z: 0.16 }); // a patch
    if (style === 0) {
      K.s.surf(['fabric', { scale: 0.4 }], () => K.s.ball(0.25, 0xd9c08a, { y: 1.75, s: [1, 1.05, 1] }, 1));
      for (const x of [-0.08, 0.08]) K.s.box(0.06, 0.06, 0.02, PAL.ink, { x, y: 1.8, z: 0.235 });
      K.s.box(0.16, 0.02, 0.02, PAL.ink, { y: 1.67, z: 0.235 });
      K.s.cyl(0.38, 0.03, PAL.hay, { y: 1.95 }, 10);
      K.s.cyl(0.17, 0.18, PAL.hay, { y: 2.05 }, 10, 0.14);
      K.s.cyl(0.175, 0.04, PAL.red, { y: 1.99 }, 10);
    } else if (style === 1) {
      // Clawd: a block head with two eye notches and arm nubs
      K.s.box(0.62, 0.42, 0.4, 0xd97757, { y: 1.8 });
      for (const x of [-0.13, 0.13]) K.s.box(0.07, 0.12, 0.03, PAL.ink, { x, y: 1.85, z: 0.2 });
      for (const s of [-1, 1]) K.s.box(0.14, 0.13, 0.2, 0xd97757, { x: s * 0.38, y: 1.76 });
      K.s.cone(0.16, 0.28, PAL.yellow, { y: 2.15 }, 5); // a party hat
    } else {
      // Codex: a scalloped cloud with a >_ face
      for (const [x, y, r] of [[0, 1.82, 0.26], [-0.26, 1.74, 0.19], [0.27, 1.75, 0.2], [-0.13, 2.0, 0.17], [0.15, 1.99, 0.18]]) K.s.ball(r, 0xf2f4f8, { x, y, z: 0 }, 1);
      K.s.beam(-0.16, 1.9, 0.25, -0.07, 1.84, 0.26, 0.035, PAL.ink);
      K.s.beam(-0.07, 1.84, 0.26, -0.16, 1.78, 0.25, 0.035, PAL.ink);
      K.s.box(0.14, 0.035, 0.03, PAL.ink, { x: 0.06, y: 1.76, z: 0.255 });
    }
    // contest rosette on the post
    K.s.at({ y: 0.95, z: 0.07 }, () => {
      K.s.cyl(0.11, 0.025, [PAL.red, PAL.blue, PAL.yellow][style % 3], { rx: Math.PI / 2 }, 8);
      K.s.cyl(0.05, 0.03, PAL.white, { rx: Math.PI / 2, z: 0.01 }, 6);
    });
  }));
}

/** a round table with a three-tier birthday cake, candles lit */
export function cake(K: Kits, t: Xf): void {
  part(K, 'cake', () => at(K, t, () => {
    K.s.cyl(0.25, 0.06, PAL.woodDark, { y: 0.03 }, 8);
    K.s.cyl(0.07, 0.78, PAL.woodDark, { y: 0.42 }, 6);
    K.s.cyl(0.78, 0.05, PAL.plank, { y: 0.82 }, 12);
    K.s.surf(['fabric', { scale: 0.5 }], () => K.s.cyl(0.84, 0.16, PAL.wallWhite, { y: 0.79 }, 14, 0.82));
    const tiers: [number, number, number][] = [[0.42, 0.24, 0xf6e2c8], [0.31, 0.22, 0xf7c9d6], [0.2, 0.2, 0xf6e2c8]];
    let y = 0.87;
    for (const [r, h, c] of tiers) {
      K.s.cyl(r, h, c, { y: y + h / 2 }, 12);
      K.s.cyl(r + 0.012, 0.04, PAL.wallWhite, { y: y + h - 0.01 }, 12);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; K.s.ball(0.035, PAL.strawberry, { x: Math.sin(a) * r * 0.8, y: y + h + 0.02, z: Math.cos(a) * r * 0.8 }); }
      y += h;
    }
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 0.3, x = Math.sin(a) * 0.1, z = Math.cos(a) * 0.1;
      K.s.cyl(0.016, 0.13, [PAL.blue, PAL.yellow, PAL.pink, PAL.green, PAL.orange][i], { x, y: y + 0.065, z }, 5);
      K.p.cone(0.022, 0.06, 0xffc84a, { x, y: y + 0.165, z }, 5);
    }
    // plates and a cake slice
    for (let i = 0; i < 3; i++) K.s.cyl(0.13, 0.012, PAL.wallWhite, { x: 0.52, y: 0.88 + i * 0.014, z: 0.2 }, 10);
    K.s.prism([[0, 0], [0.16, -0.05], [0.16, 0.05]], 0.1, 0xf6e2c8, { x: -0.55, y: 0.92, z: 0.15, rx: -Math.PI / 2 });
  }));
}

/** a decorated pine with ornaments, tinsel, presents and a star (the star and baubles glow) */
export function starTree(K: Kits, t: Xf, season: Season): void {
  const orn = [PAL.red, 0xf2c33a, 0x4fb3c8, 0xe07ab0, 0xffffff, 0x8e5fc2];
  part(K, 'starTree', () => at(K, t, () => {
    K.s.cyl(0.2, 0.7, PAL.trunk, { y: 0.35 }, 7);
    K.s.surf(['fabric', { scale: 0.5 }], () => K.s.cyl(1.25, 0.04, 0xb8423a, { y: 0.02 }, 12));
    const tiers: [number, number, number][] = [[1.55, 1.7, 1.3], [1.22, 1.5, 2.15], [0.9, 1.3, 2.9], [0.56, 1.0, 3.55]];
    const R = rng(77);
    for (const [r, h, y] of tiers) {
      K.s.cone(r, h, PAL.pine, { y }, 9);
      if (season === 'winter') K.s.cone(r * 0.55, h * 0.45, PAL.snow, { y: y + h * 0.3 }, 9);
      // baubles round the lower edge of the tier
      const n = Math.round(r * 7);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + R() * 0.4, u = 0.12 + R() * 0.38, rr = r * (1 - (u + 0.5) * 0.66) + 0.05 + 0.02;
        K.p.ball(0.075, orn[(i + Math.round(y * 3)) % orn.length], { x: Math.sin(a) * rr, y: y - h / 2 + h * u, z: Math.cos(a) * rr }, 1);
      }
    }
    // gold tinsel spiralling up
    let prev: [number, number, number] | null = null;
    for (let i = 0; i <= 40; i++) {
      const u = i / 40, y = 0.6 + u * 3.3, a = u * TAU * 3.2;
      const r = Math.max(0.2, 1.5 * (1 - u * 1.02)) + 0.06;
      const p: [number, number, number] = [Math.sin(a) * r, y, Math.cos(a) * r];
      if (prev) K.s.rod(prev[0], prev[1], prev[2], p[0], p[1], p[2], 0.025, 0xe8c44a, 4);
      prev = p;
    }
    // the star
    const star: [number, number][] = [];
    for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU, r = i % 2 ? 0.13 : 0.32; star.push([Math.sin(a) * r, Math.cos(a) * r]); }
    K.p.prism(star, 0.09, 0xffe066, { y: 4.4 });
    K.s.cyl(0.03, 0.3, 0xc9a54a, { y: 4.07 }, 5);
    // presents
    const gifts: [number, number, number, number, number][] = [[1.05, 0.55, 0.45, PAL.red, PAL.yellow], [-0.95, 0.75, 0.38, PAL.blue, PAL.white], [0.2, 1.15, 0.32, PAL.green, PAL.red], [-0.4, -1.05, 0.42, 0x8e5fc2, PAL.yellow]];
    for (const [x, z, s, c, rb] of gifts) K.s.at({ x, z, ry: x * 2 }, () => {
      K.s.box(s, s * 0.8, s, c, { y: s * 0.4 });
      K.s.box(s + 0.01, s * 0.8 + 0.01, 0.06, rb, { y: s * 0.4 });
      K.s.box(0.06, s * 0.8 + 0.01, s + 0.01, rb, { y: s * 0.4 });
      K.s.ball(0.07, rb, { y: s * 0.8 + 0.04, s: [1.4, 0.7, 1.4] });
    });
  }));
}

/** a stone snow lantern (yukimi-dōrō): three legs, a firebox with paper windows, a wide roof */
export function snowLantern(K: Kits, t: Xf, season: Season): void {
  part(K, 'snowLantern', () => at(K, t, () => {
    K.s.surf(['rock', { scale: 0.4 }], () => {
      for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU; K.s.cyl(0.055, 0.5, PAL.stone, { x: Math.sin(a) * 0.2, y: 0.24, z: Math.cos(a) * 0.2, rx: Math.cos(a) * 0.28, rz: -Math.sin(a) * 0.28 }, 6); }
      K.s.cyl(0.3, 0.08, PAL.stone, { y: 0.52 }, 6);
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) K.s.box(0.06, 0.28, 0.06, PAL.stone, { x: x * 0.13, y: 0.7, z: z * 0.13 });
      K.s.cone(0.55, 0.26, 0xa9a294, { y: 0.97 }, 6);
      K.s.ball(0.07, PAL.stone, { y: 1.13 });
    });
    for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU; K.p.box(0.2, 0.22, 0.02, 0xfff0c8, { x: Math.sin(a) * 0.12, y: 0.7, z: Math.cos(a) * 0.12, ry: a }); }
    if (season === 'winter') K.s.cone(0.48, 0.12, PAL.snow, { y: 1.08 }, 6);
  }));
}

/** a party table: punch bowl, cups and party hats */
export function punchTable(K: Kits, t: Xf): void {
  part(K, 'punchTable', () => at(K, t, () => {
    for (const x of [-0.7, 0.7]) for (const z of [-0.3, 0.3]) K.s.box(0.07, 0.8, 0.07, PAL.woodDark, { x, y: 0.4, z });
    K.s.surf(['planks', { axis: 'x' }], () => K.s.box(1.7, 0.06, 0.8, PAL.plank, { y: 0.82 }));
    K.s.surf(['fabric', { scale: 0.6 }], () => { K.s.box(1.74, 0.02, 0.84, 0x2f4f8a, { y: 0.86 }); K.s.box(1.74, 0.24, 0.02, 0x2f4f8a, { y: 0.75, z: 0.43 }); });
    K.s.cyl(0.28, 0.16, 0xd8e8f0, { y: 0.95 }, 12, 0.32);
    K.s.cyl(0.28, 0.02, 0xd8455a, { y: 1.02 }, 12);
    K.s.cyl(0.015, 0.36, PAL.metal, { x: 0.12, y: 1.12, rz: 0.5 }, 4);
    for (let i = 0; i < 6; i++) K.s.cyl(0.045, 0.12, 0xe8f0f4, { x: 0.4 + (i % 3) * 0.13, y: 0.93, z: -0.12 + Math.floor(i / 3) * 0.2 }, 6, 0.05);
    for (let i = 0; i < 3; i++) K.s.cone(0.08, 0.22, [PAL.pink, PAL.yellow, PAL.green][i], { x: -0.4 - i * 0.18, y: 0.98, z: 0.15 - i * 0.08 }, 6);
  }));
}

/** a lantern table: lanterns waiting to be lit and floated */
export function lanternTable(K: Kits, t: Xf): void {
  part(K, 'lanternTable', () => at(K, t, () => {
    for (const x of [-0.6, 0.6]) for (const z of [-0.28, 0.28]) K.s.box(0.07, 0.76, 0.07, PAL.woodDark, { x, y: 0.38, z });
    K.s.surf(['planks', { axis: 'x' }], () => K.s.box(1.5, 0.06, 0.74, PAL.plank, { y: 0.78 }));
    const cols = [0xff9a6a, 0xffd27a, 0xff7a9a, 0xfff0c8, 0xffb347];
    for (let i = 0; i < 5; i++) K.s.at({ x: -0.5 + i * 0.25, y: 0.81, z: (i % 2) * 0.16 - 0.08, ry: i }, () => {
      K.s.box(0.18, 0.04, 0.18, PAL.woodDark, { y: 0.02 });
      K.p.box(0.15, 0.17, 0.15, cols[i], { y: 0.125 });
    });
  }));
}

/** a lantern post (a pole with a hanging lantern on a little arm) */
export function lanternPost(K: Kits, t: Xf, color: number): void {
  part(K, 'lanternPost', () => at(K, t, () => {
    K.s.cyl(0.06, 2.4, PAL.woodDark, { y: 1.2 }, 6, 0.05);
    K.s.box(0.5, 0.05, 0.05, PAL.woodDark, { x: 0.2, y: 2.3 });
    paperLantern(K, { x: 0.38, y: 2.28 }, color, 1);
  }));
}

/** the cloth banner (canvas): two quads back to back, w × h, centred */
function bannerMesh(title: string, sub: string, bg: string, fg: string, w = 4.0, h = 0.9): { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial } {
  const c = canvasTex(768, Math.round(768 * (h / w)));
  const g = c.g, W = c.w, H = c.h;
  g.fillStyle = bg; roundRect(g, 0, 0, W, H, 14); g.fill();
  g.strokeStyle = fg; g.lineWidth = 6; g.setLineDash([16, 10]); roundRect(g, 12, 12, W - 24, H - 24, 10); g.stroke(); g.setLineDash([]);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(0,0,0,.25)'; fitText(g, title, W / 2 + 3, H * 0.44 + 3, W - 80, Math.round(H * 0.46));
  g.fillStyle = fg; fitText(g, title, W / 2, H * 0.44, W - 80, Math.round(H * 0.46));
  if (sub) { g.globalAlpha = 0.85; fitText(g, sub, W / 2, H * 0.8, W - 120, Math.round(H * 0.15), FONT, '600'); g.globalAlpha = 1; }
  c.tex.needsUpdate = true;
  const mat = new THREE.MeshBasicMaterial({ map: c.tex });
  const front = new THREE.PlaneGeometry(w, h), back = new THREE.PlaneGeometry(w, h);
  back.rotateY(Math.PI);
  front.translate(0, 0, 0.012); back.translate(0, 0, -0.012);
  const pos = new Float32Array([...front.attributes.position.array, ...back.attributes.position.array]);
  const uv = new Float32Array([...front.attributes.uv.array, ...back.attributes.uv.array]);
  const idx = [...(front.index!.array as ArrayLike<number> as number[])];
  for (const i of back.index!.array as ArrayLike<number> as number[]) idx.push(i + 4);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  front.dispose(); back.dispose();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'hung-banner';
  return { mesh, mat };
}

const BANNER: Record<FestivalId, { bg: string; fg: string; sub: string }> = {
  blossom: { bg: '#f7c6d6', fg: '#8a2f55', sub: 'maypole dancing on the square' },
  lantern: { bg: '#2f3f7a', fg: '#ffd27a', sub: 'lanterns on the pond after dark' },
  founders: { bg: '#d97757', fg: '#fff3dc', sub: 'cake on the square · everyone welcome' },
  harvest: { bg: '#c9572f', fg: '#ffe7a8', sub: 'pumpkin weigh-in · scarecrow contest' },
  hallowtide: { bg: '#3a2448', fg: '#ffb040', sub: 'mind the bats' },
  starlight: { bg: '#2f5a4a', fg: '#fff3c4', sub: 'the tree is lit every night' },
  newyear: { bg: '#1f2a4a', fg: '#ffe27a', sub: 'fireworks at midnight' },
};

// ---------------------------------------------------------------------------------------------------------------
// Gallery: one festival's set around the origin

export function buildFestivalPreview(id: FestivalId, season: Season, night = 0): THREE.Group {
  const root = new THREE.Group();
  const K = kits(31);
  const paper = litMat(0.95, 2.0), flame = litMat(0.22, 2.6);
  const deco = new Set(festivalById(id)?.deco ?? []);
  const lit = [0xff9a6a, 0xffd27a, 0xff7a9a, 0x9be0a0, 0x9cc8ff];
  centerpiece(K, id, season, { x: 0, y: 0, z: 0 });
  if (deco.has('garlands') || deco.has('stringLights') || deco.has('bunting') || deco.has('paperLanterns')) {
    // a string between two stand-in poles
    for (const x of [-3.2, 3.2]) K.s.cyl(0.06, 2.6, PAL.ink, { x, y: 1.3, z: -2.6 }, 6);
    const a = new THREE.Vector3(-3.1, 2.5, -2.6), b = new THREE.Vector3(3.1, 2.5, -2.6);
    sagged(K, a, b, deco.has('garlands') ? 0.35 : 0.6, (p, i, yaw) => {
      if (deco.has('garlands')) garlandBit(K, p, i);
      else if (deco.has('bunting')) pennant(K, p, i, yaw);
      else if (deco.has('paperLanterns')) paperLantern(K, { x: p.x, y: p.y, z: p.z }, lit[i % lit.length], 0.8);
      else K.p.ball(0.07, lit[i % lit.length], { x: p.x, y: p.y - 0.1, z: p.z });
    });
  }
  if (deco.has('cornucopia')) cornucopia(K, { x: -3.6, z: 1.2, ry: 0.4 });
  if (deco.has('hay')) hayStack(K, { x: 3.6, z: 1.3, ry: -0.4 }, season, deco.has('jackOLanterns'));
  if (deco.has('scarecrows')) for (let i = 0; i < 3; i++) scarecrowEntry(K, { x: -1.6 + i * 1.6, z: -3.4 }, i);
  if (deco.has('jackOLanterns')) for (let i = 0; i < 4; i++) jackOLantern(K, { x: -2.2 + i * 1.4, z: 2.6, ry: (i - 1.5) * 0.15 }, 0.2 + (i % 2) * 0.06, i % 2);
  if (deco.has('snowLanterns')) for (const x of [-3.4, 3.4]) snowLantern(K, { x, z: 1.8 }, season);
  if (deco.has('floatingLanterns')) lanternTable(K, { x: 3.2, z: 1.6, ry: -0.5 });
  if (deco.has('paperLanterns')) lanternPost(K, { x: -3.4, z: 1.4 }, 0xff9a6a);
  kitMeshes(K, root, paper, flame);
  if (id === 'blossom') { const ck = new Kit(5); maypoleCrown(ck); const crown = ck.mesh(); crown.position.y = 5.05; root.add(crown); }
  const bn = BANNER[id];
  const b = bannerMesh(festivalById(id)?.name ?? id, bn.sub, bn.bg, bn.fg, 3.2, 0.72);
  b.mesh.position.set(0, 3.2, -4.6);
  root.add(b.mesh);
  setLit(paper, night); setLit(flame, night);
  root.userData.festivalMats = [paper, flame];
  return root;
}

/** the festival's centrepiece on the square (local, ground y = 0) */
function centerpiece(K: Kits, id: FestivalId, season: Season, t: Xf, ground?: (lx: number, lz: number) => number): void {
  switch (id) {
    case 'blossom': maypole(K, t, season, ground); break;
    case 'lantern': lanternTable(K, t); break;
    case 'founders': cake(K, t); break;
    case 'harvest': prizePumpkin(K, t); break;
    case 'hallowtide': at(K, t, () => { jackOLantern(K, { y: 0 }, 0.62, 0); jackOLantern(K, { x: 0.95, z: 0.35, ry: -0.4 }, 0.3, 1); jackOLantern(K, { x: -0.9, z: 0.45, ry: 0.5 }, 0.26, 0); hayBale(K.s, { x: -0.2, z: -1.0, ry: 0.2 }); }); break;
    case 'starlight': starTree(K, t, season); break;
    case 'newyear': punchTable(K, t); break;
  }
}

function garlandBit(K: Kits, p: THREE.Vector3, i: number): void {
  const fl = [PAL.pink, 0xfff2a8, PAL.white, 0xff9ab8, 0xb9a0f0];
  K.s.ball(0.065, PAL.leaf, { x: p.x, y: p.y - 0.03, z: p.z, s: [1.3, 0.8, 1.3] }, 0);
  if (i % 2) K.s.ball(0.055, fl[i % fl.length], { x: p.x, y: p.y - 0.09, z: p.z }, 0);
}
function pennant(K: Kits, p: THREE.Vector3, i: number, yaw: number): void {
  const cols = [0xd97757, 0xfff3dc, 0xe8c44a, 0xd97757, 0x5cae4f];
  K.s.prism([[-0.13, 0], [0.13, 0], [0, -0.3]], 0.012, cols[i % cols.length], { x: p.x, y: p.y - 0.01, z: p.z, ry: yaw + Math.PI / 2 });
}

// ---------------------------------------------------------------------------------------------------------------
// In the world

export interface FestivalsHost {
  season: Season;
  /** the hub dressing's lamp posts (feet) */
  lamps: readonly THREE.Vector3[];
  /** flora trunks / bushes */
  blocked(x: number, z: number, r: number): boolean;
  /** ground the town upgrades already claimed, and the hub dressing's solids (benches, tables…) */
  taken: readonly { x: number; z: number; r: number }[];
  /** where the static decorations go (the structures group, so the placement audit sees them) */
  parent: THREE.Object3D;
  /** the upgrades' sparks: a confetti burst, a firework show */
  confetti(p: THREE.Vector3): void;
  fireworks(seconds: number): void;
}

export interface Festivals {
  update(env: Env, sky: Sky): void;
  dispose(): void;
}

interface Built {
  id: FestivalId;
  root: THREE.Group;
  fx: THREE.Group;
  offs: (() => void)[];
  rig: ((e: Env) => void)[];
  center: THREE.Vector3;
  mats: THREE.Material[];
  textures: THREE.Texture[];
  /** where the pieces stand (dev / shots: service 'festivals') */
  where: Record<string, [number, number, number]>;
}

export function createFestivals(ctx: SceneCtx, host: FestivalsHost): Festivals {
  const audio = () => ctx.services.get('audio') as AudioService | undefined;
  const lights = ctx.services.get('lights') as LightsService | undefined;
  const season = host.season;
  const gy = (x: number, z: number) => heightAt(x, z);
  const fxGroup = new THREE.Group();
  fxGroup.name = 'festival-fx';
  ctx.scene.add(fxGroup);
  const plazaLamps = host.lamps.filter((l) => Math.hypot(l.x - PLAZA.x, l.z - PLAZA.z) < PLAZA.r + 1.5);
  const roadLamps = host.lamps.filter((l) => !plazaLamps.includes(l) && Math.hypot(l.x - PLAZA.x, l.z - PLAZA.z) < 40);
  const ring = [...plazaLamps].sort((p, q) => Math.atan2(p.x - PLAZA.x, p.z - PLAZA.z) - Math.atan2(q.x - PLAZA.x, q.z - PLAZA.z));
  const C = { x: PLAZA.x - 4.7, z: PLAZA.z - 4.4 };

  let built: Built | null = null;
  let primed = false;
  let pop = -1;
  let fired = false;

  function build(a: ActiveFestival): Built {
    const id = a.id;
    const deco = new Set<Deco>(a.deco);
    const R = rng(911 + id.length * 7);
    const root = new THREE.Group();
    root.name = 'festival';
    const fx = new THREE.Group();
    const offs: (() => void)[] = [];
    const rig: ((e: Env) => void)[] = [];
    const mats: THREE.Material[] = [];
    const textures: THREE.Texture[] = [];
    const where: Record<string, [number, number, number]> = {};
    const mark = (name: string, x: number, z: number) => { where[name] = [x, gy(x, z), z]; };
    const K = kits(400 + id.length);
    const paper = litMat(0.95, 2.0), flame = litMat(0.22, 2.6);
    mats.push(paper, flame);
    const emit = (x: number, y: number, z: number, color: THREE.Color, intensity: number, radius: number, flicker = 0.1) => {
      if (lights) offs.push(lights.add({ pos: new THREE.Vector3(x, y, z), color, intensity, radius, flicker }));
    };
    const circle = (x: number, z: number, r: number) => offs.push(ctx.colliders.circle(x, z, r));

    // ---- placement (same rules as the town upgrades, plus their claims) ----
    const taken: { x: number; z: number; r: number }[] = [{ x: C.x, z: C.z, r: 2.2 }];
    const free = (x: number, z: number, r: number): boolean => {
      if (Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r + 1.0 + r) return false;
      if (structDist(x, z) < r + 1.0) return false;
      if (SITES.some((s) => inSite(s, x, z, r + 1.0))) return false;
      if (pathDist(x, z) < r + 0.4) return false;
      if (wet(x, z, r)) return false;
      if (host.blocked(x, z, r + 0.2)) return false;
      if (host.lamps.some((l) => Math.hypot(l.x - x, l.z - z) < r + 0.6)) return false;
      if ([...host.taken, ...taken].some((t) => Math.hypot(t.x - x, t.z - z) < r + t.r + 0.5)) return false;
      const h0 = gy(x, z);
      for (let i = 0; i < 6; i++) { const q = (i / 6) * TAU; if (Math.abs(gy(x + Math.cos(q) * r, z + Math.sin(q) * r) - h0) > 0.35) return false; }
      return true;
    };
    const findSpot = (x: number, z: number, r: number, max = 500): { x: number; z: number } | null => {
      for (let i = 0; i < max; i++) {
        const q = i * 2.39996, d = Math.sqrt(i) * 0.6, px = x + Math.cos(q) * d, pz = z + Math.sin(q) * d;
        if (free(px, pz, r)) { taken.push({ x: px, z: pz, r }); return { x: px, z: pz }; }
      }
      return null;
    };
    const faceRoad = (x: number, z: number) => { const p = nearestRoad(x, z); return Math.atan2(p.x - x, p.z - z); };
    /** the lowest ground under a footprint of radius r (a piece sits on it, its uphill side bedded in) */
    const low = (x: number, z: number, r: number) => { let m = gy(x, z); for (let i = 0; i < 8; i++) { const q = (i / 8) * TAU; m = Math.min(m, gy(x + Math.cos(q) * r, z + Math.sin(q) * r)); } return m - 0.02; };
    const facePlaza = (x: number, z: number) => Math.atan2(PLAZA.x - x, PLAZA.z - z);
    /** a spot beside a lamp, on the side away from the road */
    const besideLamp = (l: THREE.Vector3, r: number): { x: number; z: number } | null => {
      const p = nearestRoad(l.x, l.z);
      let dx = l.x - p.x, dz = l.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      dx /= d; dz /= d;
      for (const [along, out] of [[0.9, 0.5], [-0.9, 0.5], [0, 1.0], [1.2, 0.8], [-1.2, 0.8]]) {
        const x = l.x + dx * out - dz * along, z = l.z + dz * out + dx * along;
        if (pathDist(x, z) < r + 0.15 || wet(x, z, r) || host.blocked(x, z, r) || structDist(x, z) < r + 0.3) continue;
        if (SITES.some((s) => inSite(s, x, z, r + 0.3))) continue;
        if ([...host.taken, ...taken].some((t) => Math.hypot(t.x - x, t.z - z) < r + t.r + 0.2)) continue;
        if (host.lamps.some((q) => Math.hypot(q.x - x, q.z - z) < r + 0.3)) continue;
        if (gy(x, z) - low(x, z, r + 0.15) > 0.1) continue; // level ground only
        taken.push({ x, z, r });
        return { x, z };
      }
      return null;
    };
    /** a string from lamp a to lamp b, ending at the posts (a little below the heads) */
    // the droop stops 2.25 m above the lower post's foot: what hangs off the string (pennants, garlands, bulbs) then
    // clears your eye (1.62 m) and every farmer's hat instead of filling the view as you walk the square
    const lampString = (a: THREE.Vector3, b: THREE.Vector3, y: number, step: number, each: (p: THREE.Vector3, i: number, yaw: number) => void, name: string, slack = 0.07) => {
      const d = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize().multiplyScalar(0.075);
      const A = new THREE.Vector3(a.x + d.x, a.y + y, a.z + d.z), B = new THREE.Vector3(b.x - d.x, b.y + y, b.z - d.z);
      const maxDroop = Math.max(0.12, Math.min(A.y, B.y) - Math.min(a.y, b.y) - 2.25);
      part(K, name, () => sagged(K, A, B, step, each, PAL.ink, slack, maxDroop));
    };
    /** plaza ring lamp pairs, then each ring lamp out to its nearest road lamp */
    let skip: [THREE.Vector3, THREE.Vector3] | null = null; // the banner's rope takes that span
    const lampPairs = (): [THREE.Vector3, THREE.Vector3][] => {
      const out: [THREE.Vector3, THREE.Vector3][] = [];
      for (let i = 0; i < ring.length && ring.length > 1; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length];
        if (skip && skip.includes(p) && skip.includes(q)) continue;
        out.push([p, q]);
      }
      const used = new Set<THREE.Vector3>();
      for (const l of ring) {
        const near = roadLamps.filter((r) => !used.has(r) && r.distanceTo(l) < 16).sort((p, q) => p.distanceTo(l) - q.distanceTo(l))[0];
        if (near) { used.add(near); out.push([l, near]); }
      }
      return out;
    };
    const say = (t: string) => ctx.ui.say(t);
    const addUse = (key: string, verb: string, label: string, pos: THREE.Vector3, use: () => void, hint?: string, reach = 3.6) =>
      offs.push(ctx.interact.add({ id: `festival:${key}`, kind: 'structure', verb, label: () => label, pos: (o) => o.copy(pos), reach, use, hint: hint ? () => hint : undefined }));

    // ---- the centrepiece on the square's north-west quadrant ----
    const cy = gy(C.x, C.z);
    const cyaw = facePlaza(C.x, C.z) + 0.5;
    const center = new THREE.Vector3(C.x, cy, C.z);
    centerpiece(K, id, season, { x: C.x, y: cy, z: C.z, ry: id === 'blossom' ? 0 : cyaw }, (lx, lz) => gy(C.x + lx, C.z + lz) - cy);
    circle(C.x, C.z, id === 'blossom' ? 0.65 : id === 'starlight' ? 1.4 : id === 'harvest' ? 1.3 : id === 'hallowtide' ? 0.9 : 0.9);

    // ---- the banner over the square's south exit, hung from the two lamps flanking it ----
    {
      const exit = new THREE.Vector3(PLAZA.x, 0, PLAZA.z + PLAZA.r);
      let pair: [THREE.Vector3, THREE.Vector3] | null = null, best = Infinity;
      for (let i = 0; i < ring.length; i++) for (let j = i + 1; j < ring.length; j++) {
        const p = ring[i], q = ring[j], d = p.distanceTo(q);
        if (d < 3 || d > 10 || (p.x - exit.x) * (q.x - exit.x) > 0) continue;
        const m = Math.hypot((p.x + q.x) / 2 - exit.x, (p.z + q.z) / 2 - exit.z);
        if (m < best) { best = m; pair = [p, q]; }
      }
      const title = a.name + (id === 'newyear' ? ` ${a.end.slice(0, 4)}` : '');
      const bn = BANNER[id];
      let A: THREE.Vector3, B: THREE.Vector3;
      if (pair) { [A, B] = pair; skip = pair; }
      else {
        A = new THREE.Vector3(exit.x - 2.6, gy(exit.x - 2.6, exit.z + 1), exit.z + 1);
        B = new THREE.Vector3(exit.x + 2.6, gy(exit.x + 2.6, exit.z + 1), exit.z + 1);
        part(K, 'bannerPost', () => { for (const p of [A, B]) K.s.cyl(0.07, 2.8, PAL.woodDark, { x: p.x, y: p.y + 1.4, z: p.z }, 6); });
        circle(A.x, A.z, 0.15); circle(B.x, B.z, 0.15);
      }
      // hung high on a tight rope: the bottom clears the player's eye (1.62 m) and every farmer's hat
      const len = A.distanceTo(B), w = Math.min(3.2, len - 1.2), h = w * 0.17, SLACK = 0.018;
      const ban = bannerMesh(title, bn.sub, bn.bg, bn.fg, w, h);
      mats.push(ban.mat);
      textures.push(ban.mat.map!);
      const ROPE = LAMP_HEAD + 0.52; // tied off at the lamp finials
      lampString(A, B, ROPE, 0.8, () => {}, 'hung-rope', SLACK);
      const ropeMid = (A.y + B.y) / 2 + ROPE - len * SLACK;
      ban.mesh.position.set((A.x + B.x) / 2, ropeMid - 0.03 - h / 2, (A.z + B.z) / 2);
      ban.mesh.rotation.y = Math.atan2(B.x - A.x, B.z - A.z) - Math.PI / 2;
      root.add(ban.mesh);
      mark('banner', ban.mesh.position.x, ban.mesh.position.z);
      rig.push((e) => { const k = 1 - 0.5 * e.night; ban.mat.color.setRGB(k, k * 0.97, k * 0.92); ban.mesh.rotation.x = Math.sin(e.t * 1.3) * 0.04 * Math.min(1, Math.hypot(e.wind.x, e.wind.z) / 3); });
    }

    // ---- strings between the lamps ----
    if (deco.has('garlands')) for (const [p, q] of lampPairs()) lampString(p, q, 2.65, 0.32, (pt, i) => garlandBit(K, pt, i), 'hung-garland');
    if (deco.has('bunting')) for (const [p, q] of lampPairs()) lampString(p, q, 2.65, 0.55, (pt, i, yaw) => pennant(K, pt, i, yaw), 'hung-pennants');
    if (deco.has('stringLights')) {
      const cols = id === 'newyear' ? [0xffe27a, 0xfff3c4, 0x9cc8ff, 0xffd0f0] : [0xff5a4a, 0x7be07a, 0xffd23a, 0x6aa8ff, 0xff9ad0];
      let n = 0;
      for (const [p, q] of lampPairs()) {
        lampString(p, q, 2.65, 0.42, (pt, i) => { K.s.box(0.025, 0.05, 0.025, PAL.ink, { x: pt.x, y: pt.y - 0.03, z: pt.z }); K.p.ball(0.055, cols[(i + n) % cols.length], { x: pt.x, y: pt.y - 0.1, z: pt.z, s: [1, 1.3, 1] }); }, 'hung-lights');
        if (n++ % 2 === 0) emit((p.x + q.x) / 2, (p.y + q.y) / 2 + 2.0, (p.z + q.z) / 2, new THREE.Color(1, 0.75, 0.5), 0.3, 5, 0.05);
      }
    }

    // ---- harvest: cornucopia table, hay stacks, scarecrow contest ----
    if (deco.has('cornucopia')) {
      const s = findSpot(C.x - 6, C.z - 3.5, 1.3);
      if (s) {
        const yaw = faceRoad(s.x, s.z);
        cornucopia(K, { x: s.x, y: gy(s.x, s.z), z: s.z, ry: yaw });
        mark('cornucopia', s.x, s.z);
        offs.push(ctx.colliders.rect(s.x, s.z, 2.2, 1.0, yaw));
      }
    }
    if (deco.has('hay')) {
      const n = id === 'harvest' ? 4 : 3;
      for (let i = 0; i < n; i++) {
        const q = 0.7 + i * (TAU / n) + 0.35, rr = PLAZA.r + 3.2;
        const s = findSpot(PLAZA.x + Math.sin(q) * rr, PLAZA.z + Math.cos(q) * rr, 1.6, 120);
        if (!s) continue;
        hayStack(K, { x: s.x, y: (gy(s.x, s.z) + low(s.x, s.z, 0.6)) / 2, z: s.z, ry: facePlaza(s.x, s.z) }, season, id === 'hallowtide');
        mark(`hay${i}`, s.x, s.z);
        offs.push(ctx.colliders.rect(s.x, s.z, 2.6, 0.9, facePlaza(s.x, s.z)));
      }
    }
    if (deco.has('scarecrows')) {
      const s = findSpot(14, 7, 2.4);
      if (s) {
        const yaw = faceRoad(s.x, s.z);
        const ax = Math.cos(yaw), az = -Math.sin(yaw);
        const entrants = ['Old Tom', 'Clawdcrow', 'Cumulus'];
        mark('scarecrows', s.x, s.z);
        for (let i = 0; i < 3; i++) {
          const x = s.x + ax * (i - 1) * 1.6, z = s.z + az * (i - 1) * 1.6;
          scarecrowEntry(K, { x, y: gy(x, z), z, ry: yaw }, i);
          circle(x, z, 0.2);
        }
        let votes = [3 + Math.floor(R() * 4), 4 + Math.floor(R() * 4), 3 + Math.floor(R() * 4)], vote = 0;
        addUse('scarecrows', 'Vote in', 'The scarecrow contest', new THREE.Vector3(s.x, gy(s.x, s.z) + 1.5, s.z), () => {
          const i = vote++ % 3;
          votes = votes.map((v, j) => v + (j === i ? 1 : 0));
          const lead = votes.indexOf(Math.max(...votes));
          audio()?.play('pop', { pos: new THREE.Vector3(s.x, gy(s.x, s.z) + 1.5, s.z), volume: 0.6 });
          say(`A bean in ${entrants[i]}'s jar. ${lead === i ? `${entrants[i]} takes the lead with ${votes[i]}!` : `${entrants[lead]} still leads, ${votes[lead]} to ${votes[i]}.`}`);
        }, 'drop a bean in a jar: Old Tom, Clawdcrow or Cumulus');
      }
    }

    // ---- hallowtide: jack-o'-lanterns by the lamps; the square's big one ----
    if (deco.has('jackOLanterns')) {
      let lit = 0;
      const lamps = [...ring, ...[...roadLamps].sort((p, q) => p.distanceTo(center) - q.distanceTo(center)).slice(0, 12)];
      for (const [i, l] of lamps.entries()) {
        const s = besideLamp(l, 0.35);
        if (!s) continue;
        const r = 0.2 + (i % 3) * 0.05;
        jackOLantern(K, { x: s.x, y: gy(s.x, s.z) - 0.02, z: s.z, ry: faceRoad(s.x, s.z) + (R() - 0.5) * 0.5 }, r, i % 2);
        mark(`jack${i}`, s.x, s.z);
        if (i % 2 === 0) pumpkin(K.s, { x: s.x + 0.35, y: gy(s.x + 0.35, s.z + 0.2), z: s.z + 0.2 }, 0.12);
        if (lit++ < 10) emit(s.x, gy(s.x, s.z) + r * 0.8, s.z, new THREE.Color(1.0, 0.5, 0.15), 0.55, 3.2, 0.35);
      }
      emit(C.x, cy + 0.6, C.z, new THREE.Color(1.0, 0.5, 0.15), 0.9, 6, 0.3);
      const jokes = [
        'Trick or treat! Mayor Marigold left a bowl of toffee apples. You take one.',
        'The big jack grins. You could swear it winked.',
        'A bat swoops low over the square. Somewhere a build passes, spookily, on the first try.',
        'You find a fun-size bar of chocolate wedged behind the pumpkin. Finders keepers.',
      ];
      let j = 0;
      addUse('jack', 'Trick or treat at', "The big jack-o'-lantern", new THREE.Vector3(C.x, cy + 0.8, C.z), () => {
        audio()?.play('sparkle', { pos: new THREE.Vector3(C.x, cy + 0.8, C.z), volume: 0.6 });
        scatter = 3;
        say(jokes[j++ % jokes.length]);
      }, 'knock on the pumpkin and see what you get');
    }

    // ---- harvest centrepiece: judge the giant pumpkin ----
    let pq: Plaque | null = null;
    if (id === 'harvest') {
      const lb = 640 + Math.floor(R() * 260);
      pq = plaque(0.9, 0.5);
      pq.set({ title: 'Giant pumpkin', value: `${lb} lb`, sub: 'weigh-in · grand prize', accent: '#2f6fc8' });
      const fx0 = C.x + Math.sin(cyaw) * 1.25 + Math.cos(cyaw) * -0.9, fz0 = C.z + Math.cos(cyaw) * 1.25 - Math.sin(cyaw) * -0.9;
      part(K, 'plaqueStake', () => K.s.box(0.08, 0.9, 0.06, PAL.woodDark, { x: fx0, y: gy(fx0, fz0) + 0.45, z: fz0, ry: cyaw }));
      pq.mesh.position.set(fx0 + Math.sin(cyaw) * 0.04, gy(fx0, fz0) + 0.92, fz0 + Math.cos(cyaw) * 0.04);
      pq.mesh.rotation.y = cyaw;
      pq.mesh.rotation.x = -0.15;
      root.add(pq.mesh);
      mats.push(pq.mesh.material as THREE.Material);
      textures.push((pq.mesh.material as THREE.MeshBasicMaterial).map!);
      const verdicts = [
        `You heft a corner. Definitely ${lb} lb. Blue ribbon, no contest!`,
        'You tap it: a deep, satisfied thunk. That is a prize-winning pumpkin.',
        `Hazel says she grew a bigger one in '19. Nobody believes her. Still ${lb} lb.`,
        'You award it an extra rosette for roundness. The pumpkin seems pleased.',
      ];
      let v = 0;
      // two lantern posts flank the weigh-in, lit after dark
      for (const s of [-1, 1]) {
        const lx = C.x + Math.cos(cyaw) * 1.7 * s + Math.sin(cyaw) * -0.6, lz = C.z - Math.sin(cyaw) * 1.7 * s + Math.cos(cyaw) * -0.6;
        lanternPost(K, { x: lx, y: gy(lx, lz), z: lz, ry: cyaw + (s < 0 ? Math.PI : 0) }, 0xffb347);
        circle(lx, lz, 0.1);
        emit(lx + Math.cos(cyaw + (s < 0 ? Math.PI : 0)) * 0.38, gy(lx, lz) + 2.0, lz - Math.sin(cyaw + (s < 0 ? Math.PI : 0)) * 0.38, new THREE.Color(1, 0.6, 0.3), 0.6, 4.5, 0.25);
      }
      addUse('pumpkin', 'Judge', 'The giant pumpkin', new THREE.Vector3(C.x, cy + 0.9, C.z), () => {
        audio()?.play('fanfare', { pos: center, volume: 0.5 });
        host.confetti(new THREE.Vector3(C.x, cy + 1.6, C.z));
        say(verdicts[v++ % verdicts.length]);
      }, 'the weigh-in · grand prize: a blue ribbon');
    }

    // ---- blossom: dance round the maypole (its crown spins) ----
    if (id === 'blossom') {
      const ck = new Kit(5);
      maypoleCrown(ck);
      const crown = ck.mesh();
      crown.name = 'festival:crown';
      crown.position.set(C.x, cy + 5.05, C.z);
      fx.add(crown);
      let dance = 0;
      rig.push((e) => { dance = Math.max(0, dance - e.dt); crown.rotation.y += e.dt * (0.35 + Math.min(1, dance) * 2.6); });
      addUse('maypole', 'Dance round', 'The maypole', new THREE.Vector3(C.x, cy + 1.4, C.z), () => {
        dance = 6;
        audio()?.play('fanfare', { pos: center, volume: 0.5 });
        host.confetti(new THREE.Vector3(C.x, cy + 3, C.z));
        say(['Round and round you go, ribbons weaving overhead.', 'Skip, turn, duck under a ribbon… you only trip once.', 'The ribbons plait themselves into a perfect braid. Applause from the benches!'][Math.floor(R() * 3)]);
      }, 'skip round the pole with the ribbons');
    }

    // ---- founders: blow out the candles ----
    if (id === 'founders') {
      emit(C.x, cy + 1.7, C.z, new THREE.Color(1, 0.6, 0.3), 0.6, 4, 0.4);
      addUse('cake', 'Blow out the candles on', "The Founders' Day cake", new THREE.Vector3(C.x, cy + 1.3, C.z), () => {
        audio()?.play('sparkle', { pos: center });
        host.confetti(new THREE.Vector3(C.x, cy + 1.8, C.z));
        say('Fwoo! Every candle out in one breath. Make a wish for the valley.');
      }, 'make a wish for the valley');
    }

    // ---- starlight: the tree, snow lanterns ----
    if (id === 'starlight') {
      emit(C.x, cy + 4.4, C.z, new THREE.Color(1, 0.85, 0.45), 0.8, 7, 0.05);
      emit(C.x, cy + 1.6, C.z, new THREE.Color(1, 0.6, 0.45), 0.6, 5, 0.15);
      let twinkle = 0;
      rig.push((e) => { twinkle = Math.max(0, twinkle - e.dt); setLit(paper, e.night, 1 + Math.max(0, Math.sin(e.t * 2.2)) * 0.08 + twinkle * 0.25); });
      addUse('tree', 'Hang an ornament on', 'The Starlight tree', new THREE.Vector3(C.x, cy + 1.5, C.z), () => {
        twinkle = 2;
        audio()?.play('sparkle', { pos: center });
        say(['You hang a little glass Clawd on a low branch. It suits the tree.', 'A bauble for every field in the valley. You find a spot for yours.', 'The star flickers brighter for a moment. Someone in the valley just shipped.'][Math.floor(R() * 3)]);
      }, 'add a bauble to the tree');
    }
    if (deco.has('snowLanterns')) {
      let lit = 0;
      const lamps = [...roadLamps].sort((p, q) => p.distanceTo(center) - q.distanceTo(center)).slice(0, 14);
      for (const [i, l] of lamps.entries()) {
        if (i % 2) continue;
        const s = besideLamp(l, 0.45);
        if (!s) continue;
        snowLantern(K, { x: s.x, y: gy(s.x, s.z) - 0.02, z: s.z, ry: faceRoad(s.x, s.z) }, season);
        mark(`snowLantern${i}`, s.x, s.z);
        circle(s.x, s.z, 0.3);
        if (lit++ < 6) emit(s.x, gy(s.x, s.z) + 0.7, s.z, new THREE.Color(1, 0.7, 0.4), 0.5, 3.0, 0.25);
      }
    }

    // ---- new year: raise a glass; fireworks at midnight ----
    if (id === 'newyear') {
      addUse('punch', 'Raise a glass at', 'The New Year punch table', new THREE.Vector3(C.x, cy + 1.0, C.z), () => {
        audio()?.play('pop', { pos: center, volume: 0.8 });
        host.confetti(new THREE.Vector3(C.x, cy + 1.6, C.z));
        say(['To the valley, and every farmer in it!', 'To green builds and merged branches in the year ahead!', 'Clink! Here\'s to fewer 3 a.m. pages.'][Math.floor(R() * 3)]);
      }, 'a toast to the year ahead');
    }

    // ---- lantern night: posts round the pond, a lantern table, floating & sky lanterns ----
    if (deco.has('paperLanterns')) {
      const cols = [0xff9a6a, 0xffd27a, 0xff7a9a, 0xffb347, 0xfff0c8];
      const posts: THREE.Vector3[] = [];
      for (let i = 0; i < 16; i++) {
        const q = (i / 16) * TAU;
        for (const extra of [2.2, 3.0, 3.8]) {
          const x = POND.x + Math.sin(q) * (POND.r + extra), z = POND.z + Math.cos(q) * (POND.r + extra);
          if (gy(x, z) < WORLD.water + 0.2 || structDist(x, z) < 0.8 || pathDist(x, z) < 0.35 || host.blocked(x, z, 0.3) || SITES.some((s) => inSite(s, x, z, 0.5))) continue;
          if ([...host.taken, ...taken].some((t) => Math.hypot(t.x - x, t.z - z) < t.r + 0.4)) continue;
          posts.push(new THREE.Vector3(x, gy(x, z), z));
          taken.push({ x, z, r: 0.2 });
          break;
        }
      }
      for (const [i, p] of posts.entries()) {
        part(K, 'lanternPole', () => K.s.cyl(0.06, 2.75, PAL.woodDark, { x: p.x, y: gy(p.x, p.z) + 1.355, z: p.z }, 6, 0.05));
        circle(p.x, p.z, 0.12);
        const q = posts[(i + 1) % posts.length];
        if (q !== p && p.distanceTo(q) < 9) {
          const d = new THREE.Vector3(q.x - p.x, 0, q.z - p.z).normalize().multiplyScalar(0.07);
          const A = new THREE.Vector3(p.x + d.x, p.y + 2.6, p.z + d.z), B = new THREE.Vector3(q.x - d.x, q.y + 2.6, q.z - d.z);
          part(K, 'hung-lanterns', () => sagged(K, A, B, 1.1, (pt, j) => paperLantern(K, { x: pt.x, y: pt.y, z: pt.z }, cols[(i + j) % cols.length], 0.75)));
          if (i % 2 === 0) emit((A.x + B.x) / 2, (A.y + B.y) / 2 - 0.9, (A.z + B.z) / 2, new THREE.Color(1, 0.55, 0.3), 0.4, 5, 0.2);
        }
      }
    }
    if (deco.has('floatingLanterns')) {
      const s = findSpot(POND.x - POND.r - 4, POND.z - 2, 1.0) ?? findSpot(POND.x, POND.z - POND.r - 4, 1.0);
      const at0 = s ?? { x: POND.x - POND.r - 4, z: POND.z };
      const ty = faceRoad(at0.x, at0.z);
      lanternTable(K, { x: at0.x, y: gy(at0.x, at0.z), z: at0.z, ry: ty });
      mark('lanternTable', at0.x, at0.z);
      offs.push(ctx.colliders.rect(at0.x, at0.z, 1.6, 0.8, ty));
      emit(at0.x, gy(at0.x, at0.z) + 1.1, at0.z, new THREE.Color(1, 0.6, 0.35), 0.4, 3.5, 0.2);
      const sw = lanternSwarms(fx, paper);
      rig.push((e) => sw.update(e));
      addUse('lantern', 'Light and release', 'A wish lantern', new THREE.Vector3(at0.x, gy(at0.x, at0.z) + 1.0, at0.z), () => {
        sw.launch(at0.x, gy(at0.x, at0.z) + 1.2, at0.z);
        audio()?.play('sparkle', { pos: new THREE.Vector3(at0.x, gy(at0.x, at0.z) + 1, at0.z), volume: 0.6 });
        say(['You write a wish on the paper, light the wick, and let go. Up it drifts.', 'Your lantern catches the breeze and joins the others over the pond.', 'A wish for the valley: may every farmer find their way home tonight.'][Math.floor(R() * 3)]);
      }, 'write a wish, light it, let it float away');
    }

    // ---- swarms ----
    if (deco.has('petals')) { const p = petals(fx); rig.push((e) => p.update(e, ctx.camera.position)); }
    if (deco.has('bats')) { const b = bats(fx); rig.push((e) => b.update(e, scatter)); }
    if (deco.has('wisps')) {
      const w = wisps(fx);
      const we: LightEmitter[] = [0, 1].map(() => ({ pos: new THREE.Vector3(), color: new THREE.Color(0.35, 1.0, 0.9), intensity: 0.45, radius: 4, flicker: 0.2 }));
      if (lights) for (const e of we) offs.push(lights.add(e));
      rig.push((e) => w.update(e, we));
    }

    // ---- assemble ----
    kitMeshes(K, root, paper, flame);
    rig.push((e) => { if (id !== 'starlight') setLit(paper, e.night); setLit(flame, e.night, 1 + (Math.sin(e.t * 9) * 0.5 + Math.sin(e.t * 23) * 0.5) * 0.06); if (pq) pq.night(e.night); });
    host.parent.add(root);
    fxGroup.add(fx);
    mark('center', C.x, C.z);
    return { id, root, fx, offs, rig, center, mats, textures, where };
  }

  let scatter = 0;
  const svc = { active: () => built?.id ?? null, where: () => ({ ...(built?.where ?? {}) }) };
  ctx.services.set('festivals', svc);

  function teardown(b: Built): void {
    for (const f of b.offs) f();
    b.root.removeFromParent();
    b.fx.removeFromParent();
    for (const g of [b.root, b.fx]) g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
    for (const m of b.mats) m.dispose();
    for (const t of b.textures) t.dispose();
  }

  return {
    update(e, sky) {
      const a = sky.festival?.active ?? null;
      if ((a?.id ?? null) !== (built?.id ?? null)) {
        if (built) teardown(built);
        built = a ? build(a) : null;
        fired = false;
        if (built && primed) {
          pop = 0;
          host.confetti(built.center.clone().add(new THREE.Vector3(0, 2.5, 0)));
          audio()?.play('pop', { pos: built.center, volume: 0.9 });
          const c = built.center;
          setTimeout(() => audio()?.play('sparkle', { pos: c }), 250);
        }
      }
      primed = true;
      if (!built) return;
      if (pop >= 0) {
        pop = Math.min(1, pop + e.dt / 0.8);
        const c1 = 1.9, c3 = c1 + 1, x = pop;
        const s = pop >= 1 ? 1 : Math.max(0.001, 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2);
        built.root.scale.set(1, s, 1);
        if (pop >= 1) pop = -1;
      }
      scatter = Math.max(0, scatter - e.dt);
      for (const r of built.rig) r(e);
      // New Year: fireworks over the south meadow as the clock strikes midnight
      if (built.id === 'newyear') {
        const h = sky.hour;
        if (!fired && (h >= 23.995 || h < 0.35)) { fired = true; host.fireworks(120); }
        if (h > 1 && h < 23) fired = false;
      }
    },
    dispose() {
      if (built) teardown(built);
      built = null;
      ctx.scene.remove(fxGroup);
      if (ctx.services.get('festivals') === svc) ctx.services.delete('festivals');
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Swarms (one InstancedMesh each, zero allocation per frame)

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const frac = (v: number) => v - Math.floor(v);

/** cherry petals drifting down round the player */
function petals(into: THREE.Object3D): { update(e: Env, player: THREE.Vector3): void } {
  const N = 320, BOX = 30, H = 8;
  const g = new THREE.PlaneGeometry(0.12, 0.085);
  const mesh = new THREE.InstancedMesh(g, toon(0xf7b6c8, { side: THREE.DoubleSide }), N);
  mesh.name = 'festival:petals';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  into.add(mesh);
  const R = rng(5150);
  const sx = new Float32Array(N), sz = new Float32Array(N), ph = new Float32Array(N), sp = new Float32Array(N);
  for (let i = 0; i < N; i++) { sx[i] = R() * BOX; sz[i] = R() * BOX; ph[i] = R(); sp[i] = 0.7 + R() * 0.6; }
  return {
    update(e, pl) {
      const gy = heightAt(pl.x, pl.z);
      for (let i = 0; i < N; i++) {
        const fall = frac(e.t * 0.06 * sp[i] + ph[i]);
        const x = pl.x - BOX / 2 + ((((sx[i] + e.wind.x * e.t * 0.35 + Math.sin(e.t * 0.9 + ph[i] * 9) * 0.6 - (pl.x - BOX / 2)) % BOX) + BOX) % BOX);
        const z = pl.z - BOX / 2 + ((((sz[i] + e.wind.z * e.t * 0.35 + Math.cos(e.t * 0.7 + ph[i] * 7) * 0.6 - (pl.z - BOX / 2)) % BOX) + BOX) % BOX);
        const y = gy + 0.1 + H * (1 - fall);
        _e.set(e.t * 2.1 * sp[i] + ph[i] * 6, e.t * 1.3 + ph[i] * 3, e.t * 0.8 * sp[i]);
        _q.setFromEuler(_e);
        const k = fall > 0.96 ? (1 - fall) / 0.04 : 1;
        _s.set(k, k, k);
        _p.set(x, y, z);
        mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

/** floating lanterns on the pond and sky lanterns rising from it after dark */
function lanternSwarms(into: THREE.Object3D, mat: THREE.MeshBasicMaterial): { update(e: Env): void; launch(x: number, y: number, z: number): void } {
  const k = new Kit(77);
  k.jitter = 0;
  k.box(0.26, 0.05, 0.26, 0x5a3a22, { y: 0.025 });
  k.box(0.2, 0.22, 0.2, 0xffffff, { y: 0.16 });
  k.box(0.22, 0.02, 0.22, 0x5a3a22, { y: 0.28 });
  const g = k.geometry('solid')!;
  const NF = 22, NS = 16;
  const cols = [0xffb06a, 0xffd27a, 0xff8aa0, 0xfff0c8, 0xffc07a];
  const float = new THREE.InstancedMesh(g, mat, NF);
  float.name = 'festival:floatLanterns';
  float.castShadow = false;
  const sky = new THREE.InstancedMesh(g, mat, NS);
  sky.name = 'festival:skyLanterns';
  sky.castShadow = false;
  sky.frustumCulled = false;
  const c = new THREE.Color();
  for (let i = 0; i < NF; i++) float.setColorAt(i, c.setHex(cols[i % cols.length]));
  for (let i = 0; i < NS; i++) { sky.setColorAt(i, c.setHex(cols[(i + 2) % cols.length])); sky.setMatrixAt(i, _m.makeScale(0, 0, 0)); }
  into.add(float, sky);
  const R = rng(4343);
  const fa = new Float32Array(NF), fr = new Float32Array(NF), fw = new Float32Array(NF), fp = new Float32Array(NF);
  for (let i = 0; i < NF; i++) { fa[i] = R() * TAU; fr[i] = 1.5 + Math.sqrt(R()) * (POND.r - 2.6); fw[i] = (R() < 0.5 ? -1 : 1) * (0.006 + R() * 0.012); fp[i] = R() * TAU; }
  const sx = new Float32Array(NS), sy = new Float32Array(NS), sz = new Float32Array(NS), age = new Float32Array(NS).fill(-1);
  let next = 0, spawnT = 1;
  const launch = (x: number, y: number, z: number) => { const i = next; next = (next + 1) % NS; sx[i] = x; sy[i] = y; sz[i] = z; age[i] = 0; };
  return {
    launch,
    update(e) {
      for (let i = 0; i < NF; i++) {
        const a = fa[i] + e.t * fw[i];
        _p.set(POND.x + Math.cos(a) * fr[i], WORLD.water - 0.02 + Math.sin(e.t * 1.2 + fp[i]) * 0.025, POND.z + Math.sin(a) * fr[i]);
        _e.set(Math.sin(e.t * 0.9 + fp[i]) * 0.06, a * 0.5 + fp[i], Math.cos(e.t * 1.1 + fp[i]) * 0.06);
        _q.setFromEuler(_e);
        float.setMatrixAt(i, _m.compose(_p, _q, _s.set(1, 1, 1)));
      }
      float.instanceMatrix.needsUpdate = true;
      // after dark, a lantern rises from the pond every few seconds
      spawnT -= e.dt;
      if (e.night > 0.5 && spawnT <= 0) {
        spawnT = 3 + R() * 4;
        const a = R() * TAU, r = Math.sqrt(R()) * (POND.r - 2);
        launch(POND.x + Math.cos(a) * r, WORLD.water + 0.3, POND.z + Math.sin(a) * r);
      }
      for (let i = 0; i < NS; i++) {
        if (age[i] < 0) continue;
        age[i] += e.dt;
        sx[i] += (e.wind.x * 0.12 + Math.sin(age[i] * 0.7 + i) * 0.08) * e.dt;
        sz[i] += (e.wind.z * 0.12 + Math.cos(age[i] * 0.6 + i) * 0.08) * e.dt;
        sy[i] += (0.55 + Math.min(1, age[i] * 0.2) * 0.25) * e.dt;
        const s = age[i] > 70 ? 0 : age[i] > 55 ? (70 - age[i]) / 15 : Math.min(1, age[i] * 2);
        if (s <= 0) { age[i] = -1; sky.setMatrixAt(i, _m.makeScale(0, 0, 0)); continue; }
        _e.set(Math.sin(age[i] * 1.3 + i) * 0.08, age[i] * 0.2, 0);
        _q.setFromEuler(_e);
        sky.setMatrixAt(i, _m.compose(_p.set(sx[i], sy[i], sz[i]), _q, _s.set(s * 1.3, s * 1.5, s * 1.3)));
      }
      sky.instanceMatrix.needsUpdate = true;
    },
  };
}

/** bats looping over the square from dusk */
function bats(into: THREE.Object3D): { update(e: Env, scatter: number): void } {
  const k = new Kit(66);
  k.jitter = 0;
  const D = 0x2b2430;
  k.ball(0.09, D, { s: [0.9, 0.8, 1.3] }, 0);
  k.ball(0.06, D, { y: 0.03, z: 0.11 }, 0);
  for (const s of [-1, 1]) {
    k.cone(0.025, 0.06, D, { x: s * 0.03, y: 0.09, z: 0.11 }, 4);
    k.prism([[0, 0.02], [s * 0.34, 0.06], [s * 0.3, -0.03], [s * 0.2, 0.0], [s * 0.12, -0.05], [0, -0.04]], 0.012, D, { rx: Math.PI / 2 });
  }
  const g = k.geometry('solid')!;
  const N = 14;
  const mesh = new THREE.InstancedMesh(g, toon(0xffffff, { vertexColors: true }), N);
  mesh.name = 'festival:bats';
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  into.add(mesh);
  const R = rng(1313);
  const rad = new Float32Array(N), w = new Float32Array(N), ph = new Float32Array(N), hy = new Float32Array(N), cx = new Float32Array(N), cz = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const pond = i >= 10;
    cx[i] = pond ? POND.x : PLAZA.x + (R() - 0.5) * 6; cz[i] = pond ? POND.z : PLAZA.z + (R() - 0.5) * 6;
    rad[i] = pond ? 4 + R() * 6 : 4 + R() * 9; w[i] = (R() < 0.5 ? -1 : 1) * (0.5 + R() * 0.5); ph[i] = R() * TAU; hy[i] = 5.5 + R() * 5;
  }
  let speed = 1;
  return {
    update(e, scatter) {
      const show = e.night > 0.25;
      mesh.visible = show;
      if (!show) return;
      speed = scatter > 0 ? 2.4 : speed + (1 - speed) * Math.min(1, e.dt);
      for (let i = 0; i < N; i++) {
        const a = ph[i] + e.t * w[i] * speed;
        const r = rad[i] * (1 + Math.sin(e.t * 0.4 + ph[i]) * 0.25) * (scatter > 0 ? 1.4 : 1);
        _p.set(cx[i] + Math.cos(a) * r, heightAt(cx[i], cz[i]) + hy[i] + Math.sin(e.t * 1.7 + ph[i]) * 0.8, cz[i] + Math.sin(a) * r);
        const yaw = Math.atan2(-Math.sin(a) * w[i], Math.cos(a) * w[i]);
        _e.set(0, yaw, Math.sin(e.t * 2 + i) * 0.3);
        _q.setFromEuler(_e);
        const flap = 0.3 + 0.7 * Math.abs(Math.sin(e.t * 13 + ph[i] * 5));
        mesh.setMatrixAt(i, _m.compose(_p, _q, _s.set(1.5 * flap, 1.5, 1.5)));
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

/** will-o'-the-wisps drifting low by the pond and round the square after dark */
function wisps(into: THREE.Object3D): { update(e: Env, em: LightEmitter[]): void } {
  const N = 12;
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 2.6, 2.3), toneMapped: false });
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.11, 1), mat, N);
  mesh.name = 'festival:wisps';
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  into.add(mesh);
  const R = rng(777);
  const bx = new Float32Array(N), bz = new Float32Array(N), ph = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const pond = i < 7, a = R() * TAU;
    const r = pond ? POND.r + 1.5 + R() * 3 : PLAZA.r + 4 + R() * 6;
    bx[i] = (pond ? POND.x : PLAZA.x) + Math.cos(a) * r; bz[i] = (pond ? POND.z : PLAZA.z) + Math.sin(a) * r; ph[i] = R() * TAU;
  }
  return {
    update(e, em) {
      const k = Math.max(0, (e.night - 0.3) / 0.7);
      mesh.visible = k > 0.01;
      for (const l of em) l.gain = k;
      if (!mesh.visible) return;
      for (let i = 0; i < N; i++) {
        const t = e.t * 0.25 + ph[i];
        const x = bx[i] + Math.sin(t * 1.3) * 1.6 + Math.sin(t * 2.9) * 0.4, z = bz[i] + Math.cos(t * 1.1) * 1.6;
        const y = heightAt(x, z) + 0.9 + Math.sin(e.t * 1.6 + ph[i]) * 0.3;
        const s = k * (0.8 + 0.35 * Math.sin(e.t * 5 + ph[i] * 3));
        mesh.setMatrixAt(i, _m.compose(_p.set(x, y, z), _q.identity(), _s.set(s, s, s)));
        if (i === 0 || i === 7) em[i === 0 ? 0 : 1].pos.set(x, y, z);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
