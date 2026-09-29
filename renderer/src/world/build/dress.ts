/**
 * The zone dressers in build order, and their nav dry run ([ENV fix r1]): `dressObstacles(layout)` = the static
 * obstacles of the dressing props for `createNav(layout, {obstacles})` (§6.6). No material / renderer imports, so it
 * runs under node (tests) as well as in main.ts before the world is built. Owner: ENV.
 */
import { KIT } from './kit/registry.ts';
import { rngOf } from './kit/core.ts';
import type { Item } from './kit/core.ts';
import type { Layout } from '../layout/schema.ts';
import { isHqLayout } from '../layout/schema.ts';
import type { HqLayout } from '../layout/schema.ts';
import type { DressKit } from './zones/common.ts';
import { dressAtrium } from './zones/atrium.ts';
import { dressBays } from './zones/bays.ts';
import { dressLobby } from './zones/lobby.ts';
export { HIRE_CRATE } from './zones/lobby.ts'; // [ENV M3.5] the Lobby hiring / arrivals crate spot (BRN)
import { dressPlaza } from './zones/plaza.ts'; // [ENV M2 breadth LOB/PLZ/OUT]
import { dressExterior } from './zones/exterior.ts';
import { dressLibrary } from './zones/library.ts'; // [ENV M2 breadth LIB/MAIL/ARC/phones]
import { dressMailroom } from './zones/mailroom.ts';
import { dressArchive } from './zones/archive.ts';
import { dressPhones } from './zones/phones.ts';
import { dressWestBays } from './zones/wbays.ts'; // [ENV M2 breadth W/STR]
import { dressStreet } from './zones/street.ts';
import { dressLab } from './zones/lab.ts'; // [ENV M2 breadth LAB/ENG]
import { dressEngine } from './zones/engine.ts';
import { dressCafe } from './zones/cafe.ts'; // [ENV M2 breadth CAF/NAP/MEZ/stairs]
import { dressMezz } from './zones/mezz.ts';
import { dressStairs } from './zones/stairs.ts';
import { dressAlley } from './zones/alley.ts'; // [INT M2] the two zones no ENV split covered
import { dressWar } from './zones/war.ts';

/** Every dressing pass, in order (the real build and the nav dry run share it). */
export function dressAll(layout: HqLayout, k: DressKit): void {
  dressAtrium(layout, k);
  const { screens } = dressBays(layout, k, ['E1', 'E2', 'E3']);
  dressLobby(layout, k); dressPlaza(layout, k); dressExterior(layout, k); // [ENV M2 breadth LOB/PLZ/OUT]
  dressLibrary(layout, k); dressMailroom(layout, k); dressArchive(layout, k); dressPhones(layout, k); // [ENV M2 breadth LIB/MAIL/ARC/phones]
  const west = dressWestBays(layout, k); dressStreet(layout, k); // [ENV M2 breadth W/STR]
  dressLab(layout, k); dressEngine(layout, k); // [ENV M2 breadth LAB/ENG]
  dressCafe(layout, k); dressMezz(layout, k); dressStairs(layout, k); // [ENV M2 breadth CAF/NAP/MEZ/stairs]
  dressAlley(layout, k); dressWar(layout, k); // [INT M2] NAL / WAR
  k.screens = [...screens, ...west.screens];
}

/** Kit props that never block a walker: flat (rugs, the dais), seats (their slots sit in them), table-top / wall items. */
const NON_BLOCKING = new Set(['yogaMat', 'treadmill', 'climbWall', 'gymRings', 'vinylWall', 'awning', 'streetBanner', 'starString', 'acousticPanels', 'mirror', 'pegboard', 'trellis', 'dartboard', 'scoreboard', 'trophy', 'rug', 'dais', 'cushion', 'note', 'mug', 'bookStack', 'rope', 'poster', 'keyboard', 'monitor', 'corkboard', 'sign', 'beanbag', 'deskChair', 'stool', 'sofa', 'armchair', 'bench', 'bigBoard', 'hearth', 'hammock', 'libChair', 'ladder', 'vaultDoor']); // hammock: LVL's non-solid nap spot (its lie slot is in it)
for (const n of ['bistroChair', 'rtChair', 'bunk', 'crashMat', 'slippers', 'slideGate']) NON_BLOCKING.add(n); // [ENV M2 breadth CAF/NAP/MEZ] slot seats, lie bunks, flat mats
for (const n of ['rtChair', 'cardDeck', 'laptop']) NON_BLOCKING.add(n); // [INT M2] NAL / WAR seats + table-top items
NON_BLOCKING.add('arrivalsPad'); // [ENV M3.5] flat floor inlay (the crate spot stays walkable)
for (const n of ['roombaDock', 'stoop', 'steppingStones', 'flowerBed', 'wallSconce', 'wallLantern', 'letterBoard', 'serviceLight']) NON_BLOCKING.add(n); // [ENV M2 breadth LOB/PLZ/OUT] flat docks / exterior / wall + counter items

/**
 * [ENV fix r1] Static nav obstacles for the dressing props that are not solid layout furniture (§6.6): every floor-standing
 * kit prop placed by the zone dressers (planters, trees, coolers, bins, coat racks, side tables, boxes, floor lamps…)
 * as circles for `createNav(layout, {obstacles})`. A dry run of the same dressers: nothing is built except the items
 * a dresser reads back (monitors), so it costs ~ms. Rect footprints become a row of circles along their long side.
 * `params` = URL params (`?greybox` = no dressing).
 */
export interface DressObstacle { x: number; z: number; r: number; level: number; id: string; name: string }
export function dressObstacles(layout: Layout, params: { greybox?: unknown } | null = {}): DressObstacle[] {
  if (!isHqLayout(layout) || params?.greybox) return [];
  const solidIds = new Set(layout.furniture.filter((f) => f.solid).map((f) => f.id));
  const out: DressObstacle[] = [];
  const k: DressKit = {
    swap: null,
    put(name, p, pose, seed) {
      // [ENV fix m2 r1] the W bays' amenity sets stand inside the (solid) desk-pod footprints: no extra obstacles
      const build = (): Item => {
        const builder = KIT[name];
        if (!builder) throw new Error(`dressObstacles: unknown kit prop '${name}'`);
        return builder(p ?? {}, rngOf(seed ?? name));
      };
      if (k.swap?.startsWith('amen:')) return { get item() { return build(); }, m: null };
      let item: Item | null = null;
      const get = (): Item => (item ??= build());
      // [ENV M2 breadth MEZ] props standing on the mezzanine / landing are level-1 obstacles (orrery, crates, lamps…)
      const lvl = (pose.y ?? 0) > 2.5 && layout.plan?.onMezz?.(pose.x + 20.5, pose.z + 14) ? 1 : 0;
      const fy = layout.floorY(pose.x, pose.z, lvl);
      if ((!NON_BLOCKING.has(name) || (name === 'cushion' && p?.kind === 'floor')) && !(name === 'lamp' && p?.kind !== 'floor' && p?.kind !== 'floorArc') && !solidIds.has(String(seed)) && Math.abs((pose.y ?? 0) - fy) < 0.06) {
        const fp = get().collider ?? get().footprint;
        if ('r' in fp && fp.r) out.push({ x: pose.x, z: pose.z, r: Math.max(0.18, fp.r), level: lvl, id: String(seed), name });
        else if ('w' in fp) {
          const long = Math.max(fp.w, fp.d), short = Math.min(fp.w, fp.d), r = Math.max(0.18, short / 2);
          const n = Math.max(1, Math.ceil(long / (2 * r))), yaw = pose.yaw ?? 0, alongX = fp.w >= fp.d;
          for (let i = 0; i < n; i++) {
            const t = n === 1 ? 0 : (i / (n - 1) - 0.5) * (long - 2 * r);
            const lx = alongX ? t : 0, lz = alongX ? 0 : t;
            out.push({ x: pose.x + lx * Math.cos(yaw) + lz * Math.sin(yaw), z: pose.z - lx * Math.sin(yaw) + lz * Math.cos(yaw), r, level: lvl, id: String(seed), name });
          }
        }
      }
      return { get item() { return get(); }, m: null };
    },
  };
  dressAll(layout, k);
  return out;
}

