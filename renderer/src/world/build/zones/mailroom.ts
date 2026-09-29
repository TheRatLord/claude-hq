/**
 * Mailroom dressing (M2 breadth, §7.1 MAIL / §5.5: floor 48, wall 76, kraft wainscot 56). A busy little post office
 * behind the stair landing: the oak pigeonhole wall stuffed with letters, the sorting table (tray rack, brass postal
 * scale, stamps), the pneumatic capsule-tube terminus (commits), parcel stacks + mail sacks + a hand truck, and the
 * signature OUTBOX chute with a "line here" runner under its 4-slot queue (§6.4 sign-off parcel runs). The atrium door
 * apron, the aisle (z 6.3–8.3), the ARC door and every sorter / queue slot stay clear. Owner: ENV.
 */
import { W, poseOf, local } from './common.ts';
import type { DressKit } from './common.ts';
import type { HqLayout } from '../../layout/schema.ts';
import { lampFixtures } from './atrium.ts';
import { T } from '../kit/tokens.ts';

export function dressMailroom(layout: HqLayout, k: DressKit) {
  const zone = layout.zones.find((z) => z.id === 'MAIL');
  if (!zone) return;
  const ceil = zone.ceil ?? 2.8;
  for (const f of layout.furniture) {
    if (f.zone !== 'MAIL') continue;
    const p = poseOf(f);
    const [w, h, d] = f.size;
    switch (f.type) {
      // [ENV fix m2 r1] cool accents (review m2 r1: warm-on-warm kraft / oak / beige): a painted steel-teal pigeonhole
      // wall, green banker's lamps on the sorting table, a cool rug under it; fewer loose boxes
      case 'pigeonholes': k.put('pigeonholes', { w, h, d, colors: { body: '#5B7B7A', secondary: '#E6DCC4', accent: T.brass } }, p, f.id, 0.28); break;
      case 'sortingTable': {
        k.put('rug', { kind: 'rect', w: w + 0.9, d: d + 1.3, fringe: true, colors: { body: '#566A7C', secondary: '#435465', accent: '#C9BFAE' } }, { ...p, y: 0.003 }, 'mailTableRug', 0);
        k.put('sortingTable', { w, d, h }, p, f.id, 0.25);
        for (const e of [-1, 1]) k.put('bankerLamp', {}, local(p, e * (w / 2 - 0.22), h, -d / 2 + 0.16, e * 0.3), `mailLamp${e}`, 0);
        break;
      }
      case 'outboxChute': k.put('outboxChute', { ceil }, p, f.id, 0.3); break;
      case 'capsuleTube': k.put('capsuleTube', { ceil }, { ...p, yaw: Math.PI / 2 }, f.id, 0.2); break;
      case 'parcelStack': k.put('parcelStack', { n: 3 }, p, f.id, 0.25); break;
      default: break;
    }
  }
  // the OUTBOX queue: a kraft "line here" runner under the 4 slots, a stamp post by the chute
  k.put('rug', { kind: 'runner', w: 3.3, d: 0.72, fringe: false, colors: { body: '#6B7F78', secondary: '#4E5F59', accent: T.butter } }, W(30.35, 9.8, 0.002), 'mailQueueRunner', 0);
  // parcels waiting to go, sacks, the hand truck against the west wall
  k.put('mailSack', { full: true }, W(32.55, 2.55, 0, 0.6), 'mailSackA', 0.18);
  k.put('mailSack', {}, W(32.5, 3.25, 0, 2.2), 'mailSackB', 0.18);
  k.put('handTruck', {}, W(28.42, 4.35, 0, Math.PI / 2), 'mailTruck', 0.15);
  k.put('crate', { w: 0.5, h: 0.34, d: 0.4 }, W(28.45, 2.35, 0, Math.PI / 2 + 0.1), 'mailCrate', 0.18);
  // a steel-teal filing locker + a wall clock-style stamp rack instead of the loose box pile (cool, cleaner)
  k.put('filingCabinet', { drawers: 3, w: 0.5, d: 0.55, colors: { body: '#6E8A89', secondary: T.ink2, accent: T.brass } }, W(32.62, 6.05, 0, -Math.PI / 2), 'mailLocker', 0.2);
  k.put('plant', { kind: 'pothos', drop: 0.45 }, W(32.62, 6.05, 2.05), 'mailPothos', 0);
  // walls: a noticeboard by the sorting table, a poster over the queue, the plant in the SW corner
  k.put('corkboard', { w: 1.1, h: 0.7 }, W(28.12, 5.4, 1.1, Math.PI / 2), 'mailCork', 0);
  k.put('poster', { w: 0.8, h: 0.55, style: 0 }, W(30.3, 10.88, 1.6, Math.PI), 'mailPoster', 0);
  k.put('plant', { kind: 'bush', h: 0.85, flowers: true }, W(28.5, 10.45), 'mailPlant', 0.2);
  k.put('bin', {}, W(29.15, 10.5), 'mailBin', 0);
  // story props: a mug on the pigeonhole counter, a note on the chute, a dropped letter by the table
  const pig = layout.furniture.find((f) => f.id === 'pigeonholes');
  if (pig) {
    const p = poseOf(pig);
    k.put('mug', { colors: { body: T.teal } }, local(p, -1.2, 0.5, 0.1), 'mailMug', 0);
    k.put('bookStack', { n: 2 }, local(p, 1.25, 0.5, 0.08, 0.3), 'mailLedger', 0);
  }
  k.put('note', { colors: { body: T.butter } }, { ...W(31.1, 4.55, 0.003, 0.4), rx: -Math.PI / 2 }, 'mailDropped', 0);
  // [ENV fix m2 r3] the east wall (review m2 r3 zones13-4: bare plaster over an empty plank floor next to the ARC
  // door): a sack cart under a notice board, a roller conveyor feeding parcels to the OUTBOX chute under a postage
  // stamp board, and a pneumatic-tube run along the wall dropping into a receiver cup over the conveyor
  const EW = 32.9, E = -Math.PI / 2; // east wall face (plan x), facing west
  k.put('sackCart', {}, W(32.46, 6.78, 0, E), 'mailSackCart', 0.2);
  k.put('corkboard', { w: 0.9, h: 0.72 }, W(EW - 0.02, 6.75, 1.22, E), 'mailNotice', 0);
  k.put('conveyor', { len: 1.95 }, W(32.62, 8.3, 0, E), 'mailConveyor', 0.22);
  k.put('stampBoard', { w: 1.25, h: 0.74 }, W(EW, 8.55, 1.36, E), 'mailStamps', 0);
  k.put('tubeRun', { len: 2.95, dropX: -0.52, drop: 0.86 }, W(EW, 7.875, 2.36, E), 'mailTubes', 0); // starts past the hanging pothos
  lampFixtures(layout, k, new Set(['MAIL']));
}
