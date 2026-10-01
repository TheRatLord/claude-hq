/**
 * Countryside nooks: four out-of-the-way places on the open land near the valley's rim, each at the end of its own
 * footpath, so a stroll (yours or an idle farmer's) has somewhere to go.
 *   - the orchard & apiary (north-east): nine fruit trees in rows that blossom, fruit and go bare with the seasons, a
 *     ladder and a picking basket, three beehives with bees about them on fine days, and a honey honesty stand;
 *   - the standing stones (the north knoll): a ring of old stones round a flat altar, one fallen to make a seat, with
 *     runes that glow faintly after dark;
 *   - the hay meadow (south-west): round bales on a mown meadow, a hay wagon, a pitchfork, and bales to doze against;
 *   - the swing tree (the east edge): a big lone oak with a rope swing that sways in the wind (push it with E) and a
 *     bench under the boughs looking back over the valley.
 *
 * Same contract as nooks.ts: local frame (front +z, ground y = 0 on the flattened pad), static parts bake, the
 * exported constants are the anchors the structures system publishes (seats, colliders).
 */
import * as THREE from 'three';
import type { Season } from '../../model/types.ts';
import { PAL, toon } from '../toon.ts';
import { Kit } from './kit.ts';
import type { BuildOpts } from './farmhouse.ts';
import type { NookSeat } from './nooks.ts';
import { bench, crate, hayBale, logBench } from './props.ts';
import type { Env, Rig } from './rig.ts';

const TAU = Math.PI * 2;
const SIT = 0.03;

// ---------------------------------------------------------------------------------------------
// Orchard & apiary

export const ORCHARD = Object.freeze({
  /** fruit trees (local), three rows of three */
  trees: [-4.6, 0, 4.6].flatMap((x, i) => [-3.6, 0, 3.6].map((z, j) => ({ x: x + (j % 2 ? 0.5 : -0.3), z: z - 0.6, s: 0.9 + ((i * 3 + j) * 37 % 10) / 40 }))),
  hives: [{ x: -6.6, z: 4.4 }, { x: -5.3, z: 5.1 }, { x: -7.7, z: 3.2 }] as readonly { x: number; z: number }[],
  stand: { x: 5.9, z: 4.6, ry: -0.5 },
  /** the bench seat, 0.2 m in front of the bench (it faces back into the orchard) */
  bench: { x: 0.3, y: 0.47 + SIT, z: 4.7, yaw: Math.PI } as NookSeat,
});

function fruitTree(k: Kit, x: number, z: number, s: number, season: Season, i: number): void {
  k.part('fruitTree', () => k.at({ x, z, s, ry: i * 1.3 }, () => {
    k.surf(['bark', { axis: 'y', scale: 0.6 }], () => {
      k.cyl(0.15, 1.3, PAL.trunk, { y: 0.65, rz: 0.05 }, 7, 0.12);
      // three boughs splaying out of the crotch
      for (let b = 0; b < 3; b++) { const a = b * 2.1 + 0.4; k.rod(0, 1.2, 0, Math.cos(a) * 0.62, 1.85, Math.sin(a) * 0.62, 0.075, PAL.trunk, 6); }
    });
    if (season === 'winter') {
      for (let b = 0; b < 6; b++) { const a = b * 1.05; k.rod(Math.cos(a) * 0.3, 1.6, Math.sin(a) * 0.3, Math.cos(a) * 0.95, 2.3 + (b % 2) * 0.2, Math.sin(a) * 0.95, 0.03, PAL.trunk, 4); }
      k.ball(0.3, PAL.snow, { y: 1.9, s: [1.4, 0.3, 1.4] });
      return;
    }
    const leaf = season === 'autumn' ? [PAL.leafAutumn2, PAL.leafAutumn, 0xd29a3a] : season === 'spring' ? [0xf6d2e0, 0xfbe8ef, 0xe9aac4] : [PAL.leaf, PAL.leafDark, 0x5aa648];
    const puffs: [number, number, number, number][] = [[0, 2.2, 0, 0.95], [0.6, 2.0, 0.3, 0.7], [-0.55, 2.05, 0.25, 0.68], [0.15, 2.05, -0.6, 0.7], [-0.2, 2.65, -0.1, 0.62]];
    puffs.forEach(([px, py, pz, r], j) => k.surf(['leaves', { scale: 0.6 }], () => k.blob(r, leaf[j % 3], { x: px, y: py, z: pz, s: [1, 0.8, 1], ry: j })));
    if (season === 'summer' || season === 'autumn') {
      for (let f = 0; f < 11; f++) {
        const a = f * 2.39 + i, h = 1.85 + (f % 3) * 0.28, r = 0.78 + (f % 2) * 0.22;
        k.ball(0.085, f % 4 === 0 ? PAL.yellow : PAL.apple, { x: Math.cos(a) * r, y: h, z: Math.sin(a) * r }, 0);
      }
      if (season === 'autumn') for (let f = 0; f < 3; f++) { const a = f * 2.2 + i; k.ball(0.08, PAL.apple, { x: Math.cos(a) * 1.1, y: 0.07, z: Math.sin(a) * 1.0 }); }
    }
  }));
}

function beehive(k: Kit, x: number, z: number, ry: number): void {
  k.part('beehive', () => k.at({ x, z, ry }, () => {
    k.box(0.08, 0.32, 0.08, PAL.woodDark, { x: -0.22, y: 0.16, z: -0.2 }); k.box(0.08, 0.32, 0.08, PAL.woodDark, { x: 0.22, y: 0.16, z: -0.2 });
    k.box(0.08, 0.32, 0.08, PAL.woodDark, { x: -0.22, y: 0.16, z: 0.2 }); k.box(0.08, 0.32, 0.08, PAL.woodDark, { x: 0.22, y: 0.16, z: 0.2 });
    k.surf(['planks', { axis: 'x', scale: 0.5 }], () => {
      k.box(0.6, 0.06, 0.56, PAL.woodLight, { y: 0.35 });
      const supers = [0xf4efe2, 0xf7e9b8, 0xf4efe2];
      for (let s = 0; s < 3; s++) k.box(0.54, 0.24, 0.5, supers[s], { y: 0.5 + s * 0.25 });
    });
    k.box(0.64, 0.05, 0.6, PAL.metal, { y: 1.15 });
    k.prism([[-0.34, 0], [0.34, 0], [0, 0.16]], 0.62, PAL.roofRed, { y: 1.17, z: -0.31 });
    k.box(0.22, 0.03, 0.06, PAL.ink, { y: 0.4, z: 0.25 }); // the entrance slot
    k.box(0.3, 0.02, 0.12, PAL.woodLight, { y: 0.39, z: 0.3 }); // landing board
  }));
}

export function buildOrchard(o: BuildOpts): THREE.Group {
  const root = new THREE.Group();
  root.name = 'orchard';
  const k = new Kit(o.seed + 811);
  const O = ORCHARD;
  O.trees.forEach((t, i) => fruitTree(k, t.x, t.z, t.s, o.season, i));
  // mown alleys between the rows: a few lighter grass strips
  for (const x of [-2.3, 2.3]) k.box(1.3, 0.02, 9.5, o.season === 'winter' ? PAL.snow : PAL.grassDry, { x, y: 0.01, z: -0.6 });
  // a ladder up the middle tree and a picking basket
  k.part('ladder', () => k.at({ x: 0.9, z: 0.1, ry: -0.6 }, () => {
    for (const s of [-0.22, 0.22]) k.box(0.06, 2.5, 0.06, PAL.woodLight, { x: s, y: 1.18, rx: -0.3, z: -0.3 });
    for (let r = 0; r < 6; r++) k.box(0.44, 0.04, 0.05, PAL.woodLight, { y: 0.22 + r * 0.4, z: -0.06 - r * 0.122 });
  }));
  k.part('pickBasket', () => k.at({ x: 1.6, z: 0.9 }, () => {
    k.surf(['hay', { scale: 0.4 }], () => k.cyl(0.28, 0.3, 0xb98a4a, { y: 0.15 }, 9, 0.33));
    k.rod(-0.28, 0.3, 0, 0.28, 0.3, 0, 0.02, 0x8a5a2a, 4);
    if (o.season !== 'winter' && o.season !== 'spring') for (let a = 0; a < 7; a++) k.ball(0.085, PAL.apple, { x: Math.cos(a * 0.9) * 0.15, y: 0.33, z: Math.sin(a * 0.9) * 0.15 });
  }));
  for (const [i, h] of O.hives.entries()) beehive(k, h.x, h.z, 0.4 - i * 0.2);
  // a wildflower strip the bees work, in front of the hives
  if (o.season !== 'winter') for (let i = 0; i < 16; i++) {
    const a = i * 2.39, x = -6.2 + Math.cos(a) * (0.6 + (i % 4) * 0.35), z = 6.0 + Math.sin(a) * 0.5;
    k.ball(0.06, [PAL.purple, PAL.yellow, 0xffffff, PAL.pink][i % 4], { x, y: 0.28, z });
    k.box(0.02, 0.26, 0.02, PAL.leafDark, { x, y: 0.13, z });
  }
  // the honesty stand: a little roofed shelf of honey jars and a tin
  k.part('honeyStand', () => k.at({ x: O.stand.x, z: O.stand.z, ry: O.stand.ry }, () => {
    for (const x of [-0.55, 0.55]) k.box(0.08, 1.7, 0.08, PAL.woodDark, { x, y: 0.85, z: -0.18 });
    for (const x of [-0.55, 0.55]) k.box(0.08, 0.9, 0.08, PAL.woodDark, { x, y: 0.45, z: 0.18 });
    k.surf(['planks', { axis: 'x' }], () => { k.box(1.25, 0.05, 0.48, PAL.plank, { y: 0.9 }); k.box(1.25, 0.05, 0.36, PAL.plank, { y: 1.3, z: -0.06 }); });
    k.slab(1.45, 0.05, 0.75, PAL.roofGreen, ['shingle', { scale: 0.6 }], { y: 1.78, z: 0.02, rx: 0.3 });
    for (let j = 0; j < 5; j++) for (const [y, z] of [[0.99, 0.08], [1.39, -0.06]] as const) {
      if (y > 1 && j % 2) continue;
      k.cyl(0.065, 0.14, 0xe0a02a, { x: -0.44 + j * 0.22, y, z }, 7);
      k.cyl(0.07, 0.03, j % 2 ? PAL.red : 0xf4efe2, { x: -0.44 + j * 0.22, y: y + 0.08, z }, 7);
    }
    k.box(0.16, 0.12, 0.12, PAL.metal, { x: 0.45, y: 0.99, z: 0.1 });
    k.box(0.5, 0.2, 0.02, 0xf6efe0, { y: 0.66, z: 0.25 });
    for (let l = 0; l < 2; l++) k.box(0.32 - l * 0.08, 0.02, 0.01, PAL.ink, { y: 0.7 - l * 0.06, z: 0.262 });
  }));
  bench(k, { x: O.bench.x, z: O.bench.z + 0.2, ry: Math.PI }, 2.2);
  k.build(root, o.night);

  // bees: tiny dots looping round the hives and out to the flowers, only on fine days
  const N = 26;
  const bees = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.03, 0), toon(0x2a2414, { emissive: 0xf2c33a, emissiveIntensity: 0.6 }), N);
  bees.castShadow = false;
  bees.frustumCulled = false;
  root.add(bees);
  const m = new THREE.Matrix4();
  const rig: Rig = {
    update(e: Env) {
      const out = e.night < 0.35 && o.season !== 'winter';
      bees.visible = out;
      if (!out) return;
      for (let i = 0; i < N; i++) {
        const h = O.hives[i % O.hives.length];
        const ph = e.t * (0.6 + (i % 5) * 0.11) + i * 1.7;
        // a lazy figure-of-eight from the hive mouth out over the flower strip, with a jitter
        const rx = 0.6 + (i % 3) * 0.35, rz = 0.45 + (i % 4) * 0.2;
        const x = h.x + Math.sin(ph) * rx + Math.sin(e.t * 11 + i) * 0.05 + 0.4;
        const z = h.z + 0.6 + Math.sin(ph * 2) * rz + Math.cos(e.t * 13 + i) * 0.05;
        const y = 0.5 + (i % 4) * 0.15 + Math.sin(ph * 3) * 0.12;
        m.makeTranslation(x, y, z);
        bees.setMatrixAt(i, m);
      }
      bees.instanceMatrix.needsUpdate = true;
    },
  };
  root.userData.rig = rig;
  return root;
}

// ---------------------------------------------------------------------------------------------
// Standing stones

export const STONES = Object.freeze({
  ring: 4.4,
  count: 9,
  /** the fallen stone (index into the ring) lies along the ring as a seat */
  fallen: 4,
  altar: { r: 0.85, h: 0.42 },
});
/** two seats on the fallen stone, facing the altar */
export function stoneSeats(): NookSeat[] {
  const a = (STONES.fallen / STONES.count) * TAU, r = STONES.ring - 0.35;
  const tx = Math.cos(a), tz = -Math.sin(a); // along the ring
  return [-0.95, 0.95].map((o) => ({ x: Math.sin(a) * r + tx * o, y: 0.5 + SIT, z: Math.cos(a) * r + tz * o, yaw: a + Math.PI }));
}
/** standing stone centres (local), excluding the fallen one */
export function standingStones(): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < STONES.count; i++) { if (i === STONES.fallen) continue; const a = (i / STONES.count) * TAU; out.push({ x: Math.sin(a) * STONES.ring, z: Math.cos(a) * STONES.ring }); }
  return out;
}

export function buildStones(o: BuildOpts): THREE.Group {
  const root = new THREE.Group();
  root.name = 'stones';
  const k = new Kit(o.seed + 907);
  const S = STONES;
  const lichen = [0x9aa07a, 0xb7b78a, 0x8f9a6a];
  const rk = new Kit(3);
  for (let i = 0; i < S.count; i++) {
    const a = (i / S.count) * TAU;
    const x = Math.sin(a) * S.ring, z = Math.cos(a) * S.ring;
    if (i === S.fallen) {
      k.part('fallenStone', () => k.surf(['rock', { scale: 0.6 }], () => {
        k.box(3.2, 0.48, 0.75, 0x9c978c, { x, y: 0.24, z, ry: a + Math.PI / 2, rz: 0.01 });
        k.box(2.6, 0.05, 0.5, 0xb0ab9e, { x, y: 0.5, z, ry: a + Math.PI / 2 });
      }));
      continue;
    }
    // the front gap (i = 0 faces the path) is wider: no stone straight in front
    if (i === 0) continue;
    const h = 2.1 + ((i * 53) % 10) / 10 * 1.1, w = 0.85 + ((i * 31) % 5) / 10;
    // an irregular slab: tapering, with a slanted, broken-off top
    const lean = ((i * 7) % 5 - 2) * 0.06, cut = ((i * 13) % 5 - 2) * 0.12;
    const prof: [number, number][] = [[-w / 2, -0.1], [w / 2, -0.1], [w * 0.42, h * 0.6], [w * 0.3 + lean, h + cut], [-w * 0.15 + lean, h - cut * 0.5], [-w * 0.4, h * 0.75]];
    k.part('standingStone', () => k.at({ x, z, ry: a, rz: ((i * 17) % 7 - 3) * 0.02 }, () => {
      k.surf(['rock', { scale: 0.7 }], () => k.prism(prof, 0.62, [0x9c978c, 0xa8a396, 0x8f8a80][i % 3]));
      // lichen: a couple of soft patches on the outer face
      for (let l = 0; l < 2; l++) k.ball(0.16 + l * 0.05, lichen[(i + l) % 3], { x: (l ? -0.15 : 0.18), y: 0.5 + l * 0.55 + (i % 3) * 0.15, z: 0.29, s: [1.3, 1, 0.25] });
      // a rune carved into the inner face (lit separately: a cool glow after dark)
      const ry = 1.0 + (i % 3) * 0.12;
      rk.at({ x, z, ry: a, rz: ((i * 17) % 7 - 3) * 0.02 }, () => {
        rk.box(0.07, 0.5, 0.02, 0xffffff, { y: ry, z: -0.315 });
        rk.box(0.28, 0.06, 0.02, 0xffffff, { y: ry + (i % 2 ? 0.14 : -0.08), z: -0.315, rz: (i % 2 ? 0.6 : -0.6) });
        rk.box(0.22, 0.06, 0.02, 0xffffff, { y: ry - 0.17, z: -0.315, rz: (i % 2 ? -0.5 : 0.5) });
        if (i % 3 === 0) rk.box(0.06, 0.06, 0.02, 0xffffff, { x: 0.18, y: ry + 0.25, z: -0.315 });
      });
    }));
  }
  // the altar: a low round slab on two footings, a sprig and a candle stub
  k.part('altar', () => k.surf(['rock', { scale: 0.5 }], () => {
    k.cyl(S.altar.r, 0.18, 0xb0ab9e, { y: S.altar.h - 0.09 }, 9);
    k.box(0.5, S.altar.h - 0.18, 0.5, 0x8f8a80, { x: -0.3, y: (S.altar.h - 0.18) / 2 });
    k.box(0.5, S.altar.h - 0.18, 0.5, 0x8f8a80, { x: 0.3, y: (S.altar.h - 0.18) / 2 });
  }));
  k.cyl(0.05, 0.12, 0xf4efe2, { x: 0.3, y: S.altar.h + 0.06, z: 0.1 }, 6);
  k.emit({ radius: 3.5, intensity: 0.35, flicker: 0.6 }, () => k.cone(0.03, 0.07, PAL.lampGlow, { x: 0.3, y: S.altar.h + 0.16, z: 0.1 }, 5, 'glow'));
  k.ball(0.08, o.season === 'winter' ? PAL.berry : PAL.leaf, { x: -0.25, y: S.altar.h + 0.04, z: -0.15, s: [1.6, 0.5, 1] });
  // a worn ring of paler grass and a few toadstools
  for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU; k.box(1.1, 0.015, 0.5, o.season === 'winter' ? PAL.snow : PAL.grassDry, { x: Math.sin(a) * 2.6, y: 0.008, z: Math.cos(a) * 2.6, ry: a }); }
  if (o.season === 'autumn' || o.season === 'summer') for (let i = 0; i < 5; i++) {
    const a = 2.2 + i * 0.35, r = 5.4 + (i % 2) * 0.4;
    k.cyl(0.03, 0.1, 0xf4efe2, { x: Math.sin(a) * r, y: 0.05, z: Math.cos(a) * r }, 5);
    k.ball(0.07, PAL.red, { x: Math.sin(a) * r, y: 0.12, z: Math.cos(a) * r, s: [1, 0.55, 1] });
  }
  k.build(root, o.night);
  // the runes: carved grooves by day, a soft cyan glow after dark (HDR, so the bloom picks them up)
  const runeMat = new THREE.MeshBasicMaterial({ color: 0x5f6a66, toneMapped: false });
  const runes = rk.mesh(runeMat);
  runes.castShadow = false;
  root.add(runes);
  const day = new THREE.Color(0x5f6a66), glow = new THREE.Color(0.45, 2.2, 2.0);
  const rig: Rig = {
    update(e: Env) {
      const n = Math.min(1, Math.max(0, (e.night - 0.3) / 0.5));
      runeMat.color.copy(day).lerp(glow, n * (0.8 + 0.2 * Math.sin(e.t * 0.9)));
    },
  };
  root.userData.rig = rig;
  return root;
}

// ---------------------------------------------------------------------------------------------
// Hay meadow

export const HAY = Object.freeze({
  /** round bales (local centres, axis yaw) */
  bales: [{ x: -3.6, z: -1.8, ry: 0.3 }, { x: -1.4, z: -3.0, ry: 1.2 }, { x: 2.2, z: -2.2, ry: -0.4 }, { x: 4.2, z: 0.4, ry: 0.9 }, { x: -4.4, z: 1.6, ry: 1.6 }] as readonly { x: number; z: number; ry: number }[],
  wagon: { x: 1.6, z: 2.0, ry: -1.3 },
  /** where farmers doze, leaning back against a bale (front side, facing out) */
  naps: [{ x: -3.6, z: -0.65, yaw: 0.3 }, { x: 2.2, z: -1.0, yaw: -0.4 }] as readonly { x: number; z: number; yaw: number }[],
});
export function hayNaps(): NookSeat[] { return HAY.naps.map((n) => ({ x: n.x, y: 0, z: n.z, yaw: n.yaw })); }

export function buildHayMeadow(o: BuildOpts): THREE.Group {
  const root = new THREE.Group();
  root.name = 'haymeadow';
  const k = new Kit(o.seed + 997);
  const H = HAY;
  const mown = o.season === 'winter' ? PAL.snow : o.season === 'spring' ? PAL.grass : PAL.grassDry;
  // mown stripes
  for (let i = 0; i < 6; i++) k.box(1.6, 0.015, 9.5, i % 2 ? mown : PAL.wheat, { x: -4.6 + i * 1.85, y: 0.008, z: -0.4, ry: 0.05 });
  for (const b of H.bales) k.part('roundBale', () => k.at({ x: b.x, z: b.z, ry: b.ry }, () => {
    k.surf(['hay', { scale: 0.7 }], () => k.cyl(0.72, 1.15, PAL.hay, { y: 0.72, rz: Math.PI / 2 }, 12));
    k.surf(['hay', { scale: 0.4, axis: 'x' }], () => {
      k.cyl(0.6, 0.02, 0xd9b864, { x: 0.58, y: 0.72, rz: Math.PI / 2 }, 12);
      k.cyl(0.6, 0.02, 0xd9b864, { x: -0.58, y: 0.72, rz: Math.PI / 2 }, 12);
    });
    for (const x of [-0.3, 0.3]) k.cyl(0.735, 0.04, 0xc9a24a, { x, y: 0.72, rz: Math.PI / 2 }, 12); // twine
    if (o.season === 'winter') k.ball(0.55, PAL.snow, { y: 1.35, s: [1.1, 0.25, 0.9] });
  }));
  // the hay wagon, loaded with square bales
  k.part('hayWagon', () => k.at({ x: H.wagon.x, z: H.wagon.z, ry: H.wagon.ry }, () => {
    k.surf(['planks', { axis: 'z' }], () => k.box(1.6, 0.1, 3.0, PAL.plank, { y: 0.78 }));
    for (const s of [-1, 1]) {
      k.box(0.06, 0.5, 3.0, PAL.wood, { x: s * 0.78, y: 1.08 });
      for (const z of [-1.0, 1.0]) {
        k.cyl(0.42, 0.1, PAL.woodDark, { x: s * 0.86, y: 0.42, z, rz: Math.PI / 2 }, 10);
        k.cyl(0.1, 0.13, PAL.metalDark, { x: s * 0.88, y: 0.42, z, rz: Math.PI / 2 }, 6);
      }
    }
    k.box(0.1, 0.1, 1.6, PAL.woodDark, { y: 0.5, z: 2.2 }); // the tongue
    k.box(0.9, 0.08, 0.08, PAL.woodDark, { y: 0.5, z: 2.95 });
    for (let l = 0; l < 2; l++) for (let r = 0; r < 3 - l; r++) for (const x of l ? [0] : [-0.36, 0.36]) {
      k.surf(['hay', { scale: 0.5 }], () => k.box(0.7, 0.42, 0.9, PAL.hay, { x, y: 1.05 + l * 0.42, z: -0.95 + r * 0.95 + l * 0.45 }));
    }
  }));
  // a pitchfork stuck in a bale, a jug, and a straw hat left on another
  k.part('pitchfork', () => {
    const b = H.bales[2];
    k.rod(b.x + 0.2, 1.25, b.z + 0.1, b.x + 0.75, 2.75, b.z + 0.4, 0.03, PAL.woodLight, 5);
    for (const o2 of [-0.07, 0, 0.07]) k.rod(b.x + 0.2 + o2, 1.25, b.z + 0.1, b.x + 0.12 + o2, 1.0, b.z + 0.06, 0.012, PAL.metal, 4);
  });
  k.at({ x: H.bales[0].x + 0.2, y: 1.45, z: H.bales[0].z }, () => { k.cyl(0.3, 0.03, 0xe8c86a, {}, 12); k.cyl(0.16, 0.13, 0xe8c86a, { y: 0.07 }, 10, 0.14); k.cyl(0.165, 0.04, PAL.red, { y: 0.04 }, 10); });
  k.cyl(0.12, 0.26, 0xc9a07a, { x: -0.6, y: 0.13, z: -0.2 }, 8, 0.08);
  k.cyl(0.04, 0.06, 0xc9a07a, { x: -0.6, y: 0.29, z: -0.2 }, 6);
  hayBale(k, { x: -0.4, z: 0.9, ry: 0.4 });
  crate(k, { x: 3.4, y: 0, z: 3.4, ry: 0.3 }, 0.5);
  k.build(root, o.night);
  return root;
}

// ---------------------------------------------------------------------------------------------
// Swing tree

export const SWING = Object.freeze({
  /** trunk centre (local) */
  trunk: { x: -0.6, z: -1.2, r: 0.55 },
  /** the bough the swing hangs from: pivot height and position */
  pivot: { x: 1.6, y: 3.6, z: -0.6 },
  rope: 2.95,
  /** on the log bench (0.3 m in front of the log), looking back over the valley */
  bench: { x: -0.4, y: 0.52 + SIT, z: 2.4, yaw: 0 } as NookSeat,
});

export function buildSwingTree(o: BuildOpts): THREE.Group {
  const root = new THREE.Group();
  root.name = 'swingtree';
  const k = new Kit(o.seed + 1201);
  const S = SWING;
  const T = S.trunk;
  k.part('oak', () => {
    k.surf(['bark', { axis: 'y', scale: 0.8 }], () => {
      k.cyl(T.r * 1.35, 0.5, PAL.trunk, { x: T.x, y: 0.25, z: T.z }, 9, T.r);
      k.cyl(T.r, 3.1, PAL.trunk, { x: T.x, y: 2.0, z: T.z }, 9, T.r * 0.75);
      // roots
      for (let i = 0; i < 5; i++) { const a = i * 1.26 + 0.3; k.rod(T.x, 0.35, T.z, T.x + Math.cos(a) * 1.1, 0.02, T.z + Math.sin(a) * 1.1, 0.16, PAL.trunk, 5); }
      // big limbs: the swing bough reaches out over the bench side
      k.rod(T.x, 3.0, T.z, S.pivot.x + 0.9, S.pivot.y + 0.1, S.pivot.z, 0.2, PAL.trunk, 7);
      for (let i = 0; i < 4; i++) { const a = i * 1.57 + 2.0; k.rod(T.x, 3.2, T.z, T.x + Math.cos(a) * 2.2, 4.3 + (i % 2) * 0.4, T.z + Math.sin(a) * 2.2, 0.16, PAL.trunk, 6); }
    });
    if (o.season === 'winter') {
      for (let i = 0; i < 10; i++) { const a = i * 0.63; k.rod(T.x + Math.cos(a) * 1.4, 4.4, T.z + Math.sin(a) * 1.4, T.x + Math.cos(a) * 2.8, 5.4 + (i % 3) * 0.3, T.z + Math.sin(a) * 2.8, 0.05, PAL.trunk, 4); }
      return;
    }
    const leaf = o.season === 'autumn' ? [PAL.leafAutumn, PAL.leafAutumn2, 0xc9782f] : o.season === 'spring' ? [PAL.leafSpring, PAL.leaf, 0x7cc25a] : [PAL.leaf, PAL.leafDark, 0x4f9440];
    const puffs: [number, number, number, number][] = [
      [0, 5.4, 0, 2.2], [1.9, 4.9, 0.6, 1.6], [-1.9, 4.9, -0.3, 1.7], [0.4, 5.0, -2.0, 1.6], [-0.4, 5.1, 1.8, 1.5], [0.6, 6.4, 0.2, 1.4],
      [2.2, 4.6, -1.4, 1.2], [-2.0, 4.5, 1.5, 1.2],
    ];
    puffs.forEach(([x, y, z, r], j) => k.surf(['leaves', { scale: 1.2 }], () => k.blob(r, leaf[j % 3], { x: T.x + x, y, z: T.z + z, s: [1, 0.78, 1], ry: j * 0.7 })));
  });
  logBench(k, { x: S.bench.x, z: S.bench.z - 0.3 }, 2.2);
  if (o.season === 'autumn') for (let i = 0; i < 18; i++) { const a = i * 2.39, r = 1.4 + (i % 5) * 0.55; k.box(0.12, 0.012, 0.09, [PAL.leafAutumn, PAL.leafAutumn2, 0xc9782f][i % 3], { x: T.x + Math.cos(a) * r, y: 0.01, z: T.z + Math.sin(a) * r, ry: a }); }
  k.build(root, o.night);

  // the swing: two ropes and a seat plank, hung from the bough, swaying in the wind (and harder when pushed)
  const sk = new Kit(7);
  for (const x of [-0.3, 0.3]) sk.rod(x, 0, 0, x, -S.rope, 0, 0.02, 0xd9c08a, 4);
  sk.surf(['planks', { axis: 'x', scale: 0.5 }], () => sk.box(0.75, 0.06, 0.28, PAL.woodLight, { y: -S.rope }));
  const swing = sk.mesh();
  const hinge = new THREE.Group();
  hinge.position.set(S.pivot.x, S.pivot.y, S.pivot.z);
  hinge.add(swing);
  root.add(hinge);
  let amp = 0.05, ph = 0;
  const rig: Rig = {
    poke(what) { if (what === 'push') amp = Math.min(0.75, amp + 0.4); },
    update(e: Env) {
      const w = Math.min(1, Math.hypot(e.wind.x, e.wind.z) * 0.3);
      amp += ((0.04 + w * 0.08) - amp) * (1 - Math.exp(-e.dt * 0.12));
      ph += e.dt * Math.sqrt(9.8 / S.rope);
      hinge.rotation.x = Math.sin(ph) * amp;
      hinge.rotation.z = Math.sin(ph * 0.5 + 1) * amp * 0.08;
    },
  };
  root.userData.rig = rig;
  return root;
}
