/**
 * Archive dressing (M2 breadth, §7.1 ARC / §5.5: floor 48, wall 76, steel wainscot 56). A hushed stacks room
 * round STAT's disk drawer wall (north) and microfiche (disk I/O): the reader's desk + stool the microfiche mounts on,
 * a card catalogue, steel archive shelving of banker's boxes, the map chest (the "cataloguing" hobby), filing
 * cabinets, crates by the window, the filing nook (armchair on a round rug, side table, the lamp pool) and the
 * signature vault door with its nap corner (rug, pillow, blanket; §6.4.1). Aisle z 4–5.4 gets a runner; every slot
 * and door apron stays clear. Owner: ENV.
 */
import { W, poseOf, local } from './common.ts';
import type { DressKit } from './common.ts';
import type { HqLayout } from '../../layout/schema.ts';
import { lampFixtures } from './atrium.ts';
import { T } from '../kit/tokens.ts';

export function dressArchive(layout: HqLayout, k: DressKit) {
  if (!layout.zones.some((z) => z.id === 'ARC')) return;
  let crateN = 0;
  for (const f of layout.furniture) {
    if (f.zone !== 'ARC') continue;
    const p = poseOf(f);
    const [w, h, d] = f.size;
    switch (f.type) {
      // drawerWall: STAT's (world/stats/drawers.ts builds the carcass + drawers)
      case 'microfiche': k.put('microficheDesk', { w, d }, { ...p, y: 0 }, f.id, 0.25); break;
      case 'vaultDoor': k.put('vaultDoor', {}, { ...p, y: 0.1 }, f.id, 0); break;
      // [ENV fix m2 r1] the "central desk" (review m2 r1: a plain walnut slab): a real archive desk — overhanging
      // bevelled top, tapered legs, drawer apron — with a green banker's lamp, a map roll and a cool rug under it
      case 'mapChest': {
        k.put('rug', { kind: 'rect', w: w + 1.0, d: d + 1.2, fringe: true, colors: { body: '#4E6470', secondary: '#3D4F59', accent: '#C9BFAE' } }, { ...p, y: 0.003 }, 'arcDeskRug', 0);
        k.put('archiveDesk', { w, d, h: 0.76 }, p, f.id, 0.2);
        k.put('bankerLamp', {}, local(p, -w / 2 + 0.25, 0.76, -d / 2 + 0.18, 0.4), 'arcDeskLamp', 0);
        k.put('globe', {}, { ...local(p, w / 2 - 0.22, 0.76, -d / 2 + 0.22), s: 0.34 }, 'arcDeskGlobe', 0);
        break;
      }
      case 'armchair': k.put('armchair', { colors: { body: '#5E8C8E', secondary: T.walnut, accent: T.trim } }, p, f.id, 0.25); break;
      case 'crates': {
        const i = crateN++;
        k.put('crate', { w: w * 0.55, h: h * 0.5, d }, local(p, -w * 0.22, 0, 0, 0.05), f.id, 0.22);
        k.put('crate', { w: w * 0.5, h: h * 0.45, d: d * 0.9 }, local(p, w * 0.25, 0, 0.02, -0.08), `${f.id}:b`, 0.2);
        if (i === 0) k.put('crate', { w: w * 0.45, h: h * 0.42, d: d * 0.8 }, local(p, -w * 0.18, h * 0.5, 0, 0.2), `${f.id}:c`, 0);
        else k.put('box', { w: 0.34, h: 0.22, d: 0.3 }, local(p, -w * 0.2, h * 0.5, 0, 0.5), `${f.id}:box`, 0);
        break;
      }
      case 'plant': k.put('plant', { kind: 'monstera', h: h * 1.1 }, p, f.id, 0.2); break;
      case 'bookCart': k.put('bookCart', { w, h, d }, p, f.id, 0.22); break;
      case 'filingCabinet': k.put('filingCabinet', { drawers: 4, w: w * 0.8, d: d * 0.9, colors: { body: '#7E9696', secondary: T.ink2, accent: T.brass } }, p, f.id, 0.25); break; // [ENV fix m2 r1] steel-teal
      default: break;
    }
  }
  // the reader's stool at the microfiche seat
  const mf = layout.slots.find((s) => s.tag === 'microfiche');
  if (mf) k.put('stool', { h: 0.32, colors: { body: '#5E7F68', secondary: T.ink2, accent: T.brass } }, { x: mf.pos.x, y: 0, z: mf.pos.z, yaw: 0 }, 'arcFicheStool', 0.12);
  // stacks: banker's-box shelving on the south wall, the card catalogue by the west door
  k.put('archiveShelf', { w: 2.4, h: 1.75, d: 0.45 }, W(35.55, 10.72, 0, Math.PI), 'arcShelfS', 0.28);
  k.put('cardCatalog', { cols: 4, rows: 6 }, W(33.36, 2.1, 0, Math.PI / 2), 'arcCatalog', 0.25);
  k.put('plant', { kind: 'cactus', h: 0.42 }, W(33.36, 2.05, 0.84), 'arcCatalogCactus', 0);
  // aisle runner + the filing nook (round rug, side table, a throw, books) + the vault nap corner
  k.put('rug', { kind: 'runner', w: 5.4, d: 0.9, colors: { body: '#566A70', secondary: '#3E4E53', accent: '#C9BFAE' } }, W(37.0, 4.7, 0.002), 'arcRunner', 0);
  k.put('rug', { kind: 'round', r: 0.95, colors: { body: '#6B5E78', secondary: '#4B4256', accent: T.butter } }, W(40.45, 5.9, 0.002), 'arcNookRug', 0);
  k.put('table', { kind: 'round', w: 0.42, h: 0.42, colors: { body: T.walnut, secondary: T.ink2, accent: T.trim } }, W(41.45, 6.55), 'arcNookTable', 0.18);
  k.put('mug', { colors: { body: T.trim } }, W(41.5, 6.48, 0.42, 1.2), 'arcNookMug', 0);
  k.put('bookStack', { n: 2 }, W(41.38, 6.62, 0.42, 0.3), 'arcNookBooks', 0);
  k.put('cushion', { kind: 'throw', w: 0.42, colors: { body: T.butter } }, { ...W(40.62, 5.6, 0.62, -Math.PI / 2 - 0.2), s: 0.9 }, 'arcNookThrow', 0);
  k.put('rug', { kind: 'round', r: 0.6, colors: { body: '#5F7A74', secondary: '#435955', accent: T.trim } }, W(40.85, 9.3, 0.002), 'arcNapRug', 0);
  k.put('cushion', { w: 0.36, h: 0.3, colors: { body: T.lavender } }, { ...W(41.55, 9.95, 0, -Math.PI / 2 - 0.3), rx: -0.3 }, 'arcNapPillow', 0);
  k.put('cushion', { kind: 'throw', w: 0.46, colors: { body: '#8FA9A1' } }, { ...W(40.8, 8.85, -0.36, 0.3), s: 0.85 }, 'arcNapBlanket', 0);
  // [ENV fix m2 r1] the vault corner reads from the room: a brass sconce either side of the door
  k.put('sconce', {}, W(41.88, 8.25, 1.75, -Math.PI / 2), 'arcVaultSconceA', 0);
  k.put('sconce', {}, W(41.88, 10.35, 1.75, -Math.PI / 2), 'arcVaultSconceB', 0);
  // walls: a blueprint over the filing cabinets, a map over the crates
  k.put('poster', { w: 0.9, h: 0.6, style: 2 }, W(33.12, 9.15, 1.85, Math.PI / 2), 'arcBlueprint', 0);
  k.put('poster', { w: 0.7, h: 0.5, style: 1 }, W(41.88, 7.4, 1.6, -Math.PI / 2), 'arcMap', 0);
  // floor story props: a box being sorted by the map chest, a dropped folder, a bin
  k.put('box', { w: 0.4, h: 0.26, d: 0.34 }, W(38.55, 8.3, 0, 0.4), 'arcSortBox', 0.12);
  k.put('bookStack', { n: 3 }, W(38.6, 7.72, 0, -0.5), 'arcSortStack', 0);
  k.put('bin', {}, W(34.0, 10.6), 'arcBin', 0);
  lampFixtures(layout, k, new Set(['ARC']));
}
