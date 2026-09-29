/**
 * Plaza dressing (M2 breadth, §7.1 PLZ: the covered Street ↔ Lobby junction): the map signpost (unknown agents),
 * the street-lamp anchor as a wall lantern on a scrolled bracket, a zig-zag of string lights under the dark ceiling,
 * a community corkboard and prints on the north wall, the bench, a tree tub, a bicycle against the wall, crates, a
 * mailbox, a bin and a flower planter on the south strip (the lane is the north 1.5 m). The phone booths are ENV 3/5's
 * (zones/phones.ts). Nothing sits in the plaza lane, a door apron or a slot. Owner: ENV.
 */
import { W, poseOf, local } from './common.ts';
import type { DressKit } from './common.ts';
import type { HqLayout } from '../../layout/schema.ts';
import { T } from '../kit/tokens.ts';

const PI = Math.PI;
/** Street-lamp anchors in the plaza (hq.ts `lamp('street', …)`): drawn as wall lanterns off the north wall (z21). */
const NORTH_FACE = 21.1;

export function dressPlaza(layout: HqLayout, k: DressKit) {
  if (!layout.zones.some((z) => z.id === 'PLZ')) return;
  for (const f of layout.furniture) {
    if (f.zone !== 'PLZ') continue;
    const p = poseOf(f);
    const [w, h, d] = f.size;
    switch (f.type) {
      case 'signpost': k.put('signpost', { h }, { ...p, yaw: 0.15 }, f.id, 0.2); break;
      case 'planter': k.put('plant', { kind: 'tree', h: 2.3 }, p, f.id, 0.25); break; // the NW corner tree tub
      case 'bench': {
        k.put('bench', { w, d, h }, p, f.id, 0.2);
        k.put('cushion', { w: 0.32, h: 0.26, colors: { body: '#7E918A' } }, { ...local(p, w * 0.28, h, -0.1, -0.2), rx: -0.3 }, `${f.id}:c`, 0);
        k.put('mug', { colors: { body: T.trim } }, local(p, -w * 0.32, h, 0.05, 1), `${f.id}:mug`, 0);
        break;
      }
      default: break; // phoneBooth: zones/phones.ts
    }
  }
  // the street lamp anchors → wall lanterns (bulb exactly on the anchor, so the lamp pool sits under it)
  for (const l of layout.lamps) {
    if (l.kind !== 'street' || layout.zoneAt(l.pos.x, l.pos.z, 0) !== 'PLZ') continue;
    const reach = l.pos.z - (NORTH_FACE - 14);
    k.put('wallLantern', { reach }, { x: l.pos.x, y: l.pos.y, z: NORTH_FACE - 14, yaw: 0 }, l.id, 0);
  }
  // string lights: a zig-zag between the north and south walls under the 3.0 m ceiling (east of the street opening
  // and west of it), each span sagging 0.22 m
  const spans = [[0.6, 21.12, 2.2, 23.38], [2.2, 23.38, 4.6, 21.12], [8.3, 21.12, 9.9, 23.38], [9.9, 23.38, 11.6, 21.12], [11.6, 21.12, 13.4, 23.38]];
  spans.forEach(([x0, z0, x1, z1], i) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    k.put('lamp', { kind: 'string', len, sag: 0.22, n: Math.round(len / 0.42) }, { ...W(x0, z0, 2.82), yaw: Math.atan2(-(z1 - z0), x1 - x0) }, `plzString${i}`, 0);
  });
  // [LVL gap] the west wall is 2.8 m high under the plaza's 3.0 m ceiling: a header beam closes the sky slot
  k.put('beam', { w: 2.5, h: 0.26, d: 0.28 }, W(0.1, 22.25, 2.76, PI / 2), 'plzBeamW', 0);
  // north wall: community corkboard + prints (W3's and E3's back walls)
  k.put('corkboard', { w: 1.3, h: 0.85 }, W(1.9, NORTH_FACE, 1.45, 0), 'plzCork', 0);
  k.put('poster', { w: 0.6, h: 0.8, style: 1 }, W(3.9, NORTH_FACE, 1.6, 0), 'plzPrintA', 0);
  k.put('poster', { w: 0.8, h: 0.6, style: 0 }, W(9.6, NORTH_FACE, 1.7, 0), 'plzPrintB', 0);
  k.put('poster', { w: 0.55, h: 0.75, style: 2 }, W(12.3, NORTH_FACE, 1.6, 0), 'plzPrintC', 0);
  k.put('plant', { kind: 'pothos', drop: 0.55 }, W(11.0, NORTH_FACE + 0.12, 2.45, 0), 'plzPothos', 0);
  // south strip (z22.9–23.4; the lane is z21–22.5): bicycle + crates at the west end, a bin, a mailbox, a planter
  k.put('bicycle', {}, W(1.25, 23.15, 0, PI), 'plzBike', 0.1);
  k.put('crate', { w: 0.5, h: 0.36, d: 0.4 }, W(0.45, 22.75, 0, 0.1), 'plzCrate0', 0.15);
  k.put('crate', { w: 0.42, h: 0.3, d: 0.36 }, W(0.47, 22.75, 0.36, -0.2), 'plzCrate1', 0);
  k.put('bin', { colors: { body: T.teal } }, W(4.2, 23.2), 'plzBin', 0);
  k.put('mailbox', {}, W(6.35, 23.18, 0, PI), 'plzMailbox', 0.12);
  k.put('planter', { w: 1.0, h: 0.42, d: 0.36, colors: { body: T.tealDeep, accent: T.trim } }, W(9.45, 23.22), 'plzPlanter', 0.18);
}
