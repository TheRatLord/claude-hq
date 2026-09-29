/**
 * Café + Nap Nook dressing (M2 breadth, §7.1 CAF / NAP, §5.5 value map "CAF: sage-teal terrazzo, espresso bar walnut
 * 36", complementary staging: every seat a Clawd uses is cool — teal bistro chairs, a teal channel-tufted banquette).
 * Signature prop: the espresso bar (kit/lounge.ts; AMB steam.ts puffs from its machine + wand). Around it: a hanging
 * chalk menu, a bulb-marquee coffee cup, bunting, café tables with treats, the arcade corner (STAT's HI-SCORE marquee
 * hangs over it: nothing on that wall), a self-serve counter, a reading corner, a games corner by the east window, a
 * booth banquette under the south window, and the Nap Nook's bunks with quilts, a moon night-light and a star mobile.
 * Nothing sits in the café aisle lane or a door apron; layout furniture keeps its pose (slots sit in it). Owner: ENV.
 */
import { W, poseOf, local, hash01 } from './common.ts';
import type { DressKit } from './common.ts';
import type { HqLayout } from '../../layout/schema.ts';
import type { KitParams } from '../kit/core.ts';
import { lampFixtures } from './atrium.ts';
import { T } from '../kit/tokens.ts';
import { LT } from '../kit/lounge.ts';

const PI = Math.PI;
/** Café / nook cells. */
const CELLS = new Set(['CAF', 'NAP']);

export function dressCafe(layout: HqLayout, k: DressKit) {
  if (!layout.zones.some((z) => z.id === 'CAF')) return;
  const mine = layout.furniture.filter((f) => f.zone != null && CELLS.has(f.zone));
  const tables = mine.filter((f) => f.type === 'cafeTable');
  let nStool = 0, nArc = 0;
  for (const f of mine) {
    const p = poseOf(f);
    const [w, h, d] = f.size;
    switch (f.type) {
      case 'espressoBar': k.put('espressoBar', { w, h, d }, p, f.id, 0.1); break;
      case 'cafeTable': {
        const i = tables.indexOf(f);
        k.put('table', { kind: 'round', w, h, colors: { body: T.oak, secondary: T.ink2, accent: T.trim } }, p, f.id, 0.05);
        // story props: a treat and a mug or two, seeded per table
        k.put('treat', { kind: ['donut', 'croissant', 'cake'][i % 3] }, local(p, 0.12, h, -0.08, hash01(i, 1) * 6), `${f.id}:treat`, 0);
        k.put('mug', { colors: { body: [T.teal, T.trim, T.lavender][i % 3] } }, local(p, -0.14, h, 0.1, hash01(i, 2) * 6), `${f.id}:mug`, 0);
        if (i !== 1) k.put('mug', { colors: { body: T.trim } }, local(p, 0.05, h, 0.2, 1.2), `${f.id}:mug2`, 0);
        else k.put('bookStack', { n: 1 }, local(p, -0.05, h, -0.22, 0.5), `${f.id}:book`, 0);
        break;
      }
      case 'stool': { // café seats → bistro chairs facing their table (the `cafe` slot sits in them)
        const t = tables.reduce((a, b) => (Math.hypot(b.pos.x - p.x, b.pos.z - p.z) < Math.hypot(a.pos.x - p.x, a.pos.z - p.z) ? b : a));
        k.put('bistroChair', { h, colors: { body: [T.fabricTeal, '#6F8E7D', T.teal][nStool++ % 3] } }, { ...p, yaw: Math.atan2(t.pos.x - p.x, t.pos.z - p.z) }, f.id, 0);
        break;
      }
      case 'arcade': k.put('arcade', { w, h, d, colors: { body: ['#3A3F5C', LT.chalk][nArc++ % 2] } }, p, f.id, 0.17); break;
      case 'foosball': k.put('foosball', { w, h, d }, p, f.id, 0.15); break;
      case 'plant': k.put('plant', f.id === 'plant11' ? { kind: 'monstera', h: h * 1.05 } : { kind: 'fern', h: h * 0.95 }, p, f.id, 0.12); break;
      case 'bunk': { // the nook: bunk 2 stands along the east wall; turned so its open (ladder) side faces the room
        const flip = Math.abs(f.yaw) > 0.1 ? PI : 0;
        k.put('bunk', { w, h, d, quilt: [T.lavender, LT.quiltDusk, T.sage][nStool % 3], quilt2: [T.rose, T.lavender, LT.quiltDusk][nStool++ % 3] }, { ...p, yaw: f.yaw + flip }, f.id, 0.09);
        break;
      }
      default: break; // lampPost: from the lamp anchors below
    }
  }

  // ---- the bar: hanging chalk menu over it, the bulb-marquee cup on the wall east of the window, bunting
  k.put('cafeMenu', { w: 1.5, h: 0.62, hang: 0.36 }, W(35.0, 27.5, 2.13, PI), 'cafMenu', 0);
  k.put('marqueeCup', { s: 0.78 }, W(37.45, 27.89, 1.9, PI), 'cafMarquee', 0);
  k.put('bunting', { len: 6.4, sag: 0.16 }, W(31.3, 20.14, 2.62, 0), 'cafBuntN', 0);
  k.put('bunting', { len: 2.5, sag: 0.14, flags: [T.butter, T.teal, T.lavender, T.trim] }, W(28.12, 20.3, 2.62, -PI / 2), 'cafBuntW', 0);
  k.put('bunting', { len: 4.6, sag: 0.18, flags: [T.lavender, T.trim, T.teal, T.butter] }, W(37.9, 27.86, 2.62, PI), 'cafBuntS', 0);

  // ---- a print by the nook door (no rug under the middle table: it covered the pendant-lit floor the `cafe` surfaceStats
  // floor probe reads, −1.1 L* at 22 h)
  k.put('poster', { w: 0.8, h: 0.6, style: 1 }, W(40.75, 23.12, 1.6, 0), 'cafPrintC', 0);

  // ---- booth under the south window: a channel-tufted banquette + two little tables with treats
  k.put('banquette', { w: 3.8 }, W(30.95, 27.6, 0, PI), 'cafBanquette', 0.18);
  for (const [x, i] of [[29.95, 0], [32.0, 1]]) {
    const q = W(x, 26.95);
    k.put('table', { kind: 'round', w: 0.6, h: 0.5, colors: { body: T.oak, secondary: T.ink2, accent: T.trim } }, q, `cafBoothT${i}`, 0.05);
    k.put('treat', { kind: i ? 'donut' : 'croissant' }, local(q, 0.08, 0.5, 0.02, i), `cafBoothTreat${i}`, 0);
    k.put('mug', { colors: { body: i ? T.teal : T.butter } }, local(q, -0.12, 0.5, -0.06, 2 + i), `cafBoothMug${i}`, 0);
    k.put('cushion', { w: 0.34, h: 0.3, colors: { body: i ? T.butter : T.lavender } }, { ...W(x - 0.55 + i * 1.3, 27.72, 0.44, PI), rx: -0.3 }, `cafBoothCush${i}`, 0);
  }
  k.put('plant', { kind: 'pothos', drop: 0.55 }, W(29.2, 27.5, 2.1), 'cafPothosA', 0);
  k.put('plant', { kind: 'pothos', drop: 0.7 }, W(32.75, 27.5, 1.95), 'cafPothosB', 0);

  // ---- self-serve counter (NW pocket, beside the arcade corner): cups, sugar, a succulent; cooler + bin either side
  const ss = W(32.0, 20.36, 0, 0);
  k.put('counter', { w: 1.3, h: 0.8, d: 0.42, colors: { body: T.walnut, secondary: T.sand, accent: T.brass } }, ss, 'cafSelfServe', 0.15);
  for (let i = 0; i < 3; i++) k.put('mug', { colors: { body: [T.trim, T.teal, T.trim][i] } }, local(ss, -0.42 + i * 0.13, 0.8, 0.02, i), `cafSSMug${i}`, 0);
  k.put('plant', { kind: 'succulent' }, local(ss, 0.42, 0.8, -0.02), 'cafSSSucc', 0);
  k.put('treat', { kind: 'cake' }, local(ss, 0.1, 0.8, 0.02), 'cafSSCake', 0);
  k.put('waterCooler', {}, W(31.05, 20.38, 0, 0), 'cafCooler', 0.15);
  k.put('bin', {}, W(32.82, 20.32), 'cafBin', 0);

  // ---- reading corner (NE pocket between the ENG door and the nook): two armchairs, a side table, a rug, the board
  k.put('rug', { kind: 'round', r: 0.95, colors: { body: '#6F8D8A', secondary: '#58716E', accent: T.butter } }, W(36.45, 21.15, 0.002), 'cafReadRug', 0);
  k.put('armchair', { colors: { body: T.teal } }, W(35.55, 20.72, 0, 0.45), 'cafArmA', 0.15);
  // [ENV fix m2 r1] the east side of the reading corner is a teal booth: a banquette against the Nap Nook wall + a table
  k.put('banquette', { w: 2.5, colors: { body: '#4E7C78' } }, W(37.7, 21.6, 0, -Math.PI / 2), 'cafBanquetteE', 0.18);
  k.put('table', { kind: 'round', w: 0.62, h: 0.62, colors: { body: T.oak, secondary: T.ink2, accent: T.trim } }, W(36.95, 21.75), 'cafBoothTE', 0.05);
  k.put('treat', { kind: 'cake' }, W(36.9, 21.7, 0.62, 0.4), 'cafBoothTreatE', 0);
  k.put('mug', { colors: { body: T.lavender } }, W(37.08, 21.9, 0.62, 2), 'cafBoothMugE', 0);
  k.put('cushion', { w: 0.34, h: 0.3, colors: { body: T.butter } }, { ...W(37.82, 20.85, 0.44, -Math.PI / 2), rx: -0.3 }, 'cafBoothCushE', 0);
  k.put('table', { kind: 'round', w: 0.42, h: 0.42, colors: { body: T.walnut, secondary: T.ink2, accent: T.trim } }, W(36.48, 20.5), 'cafSideT', 0.09);
  k.put('bookStack', { n: 3 }, W(36.44, 20.5, 0.42, 0.3), 'cafSideBooks', 0);
  k.put('mug', { colors: { body: T.butter } }, W(36.62, 20.62, 0.42, 1), 'cafSideMug', 0);
  k.put('corkboard', { w: 1.0, h: 0.66 }, W(36.45, 20.12, 1.45, 0), 'cafBoard', 0);

  // ---- games corner by the east window: game cubbies under the sill, beanbags, a tree in the corner
  k.put('cubbies', { w: 1.4, h: 0.8, d: 0.34, cols: 3 }, W(41.74, 24.55, 0, -PI / 2), 'cafCubbies', 0.12);
  k.put('beanbag', { colors: { body: LT.quiltDusk } }, W(38.55, 24.55, 0, 0.6), 'cafBeanA', 0.09);
  k.put('beanbag', { colors: { body: T.butter } }, W(39.4, 27.45, 0, 2.1), 'cafBeanB', 0.09);
  k.put('plant', { kind: 'tree', h: 2.2 }, W(41.42, 27.42), 'cafTree', 0.15);

  // ---- by the Lobby door: an A-frame chalk board; wall prints on the west wall
  k.put('sandwichBoard', {}, W(28.75, 26.6, 0, -2.4), 'cafAFrame', 0.06);
  k.put('poster', { w: 0.8, h: 0.6, style: 0 }, W(28.12, 21.85, 1.6, PI / 2), 'cafPrintA', 0);
  k.put('poster', { w: 0.55, h: 0.72, style: 2 }, W(28.12, 27.05, 1.65, PI / 2), 'cafPrintB', 0);

  // ---- Nap Nook: rug, moon night-light (on the nook's floor-lamp anchor), star mobile, slippers, a floor cushion
  k.put('rug', { kind: 'round', r: 0.78, colors: { body: '#8A84AE', secondary: '#6F6A94', accent: T.trim } }, W(39.75, 21.9, 0.002), 'napRug', 0);
  k.put('mobile', { drop: 0.55 }, W(39.8, 21.75, 2.8), 'napMobile', 0);
  k.put('slippers', {}, W(38.95, 21.12, 0, 0.2), 'napSlippersA', 0);
  k.put('slippers', { colors: { body: T.lavender } }, W(40.75, 21.1, 0, -0.3), 'napSlippersB', 0);
  k.put('cushion', { kind: 'floor', w: 0.46, colors: { body: LT.quiltDusk } }, W(40.7, 22.4, 0, 0.3), 'napFloorCush', 0);
  k.put('poster', { w: 0.5, h: 0.6, style: 2 }, W(38.12, 22.3, 1.55, PI / 2), 'napPrint', 0);

  // ---- [ENV fix m2 r1] density (review m2 r1: big empty floor, sparse sets, bare walls, bar cut off): rugs under the
  // table groups, the pastry case at the bar's east end, a pendant cluster over the bar, a wall shelf over the
  // self-serve counter, plant clusters in the open corners, a row of trailing pothos in the east window
  const tableRugs: [number, number, string, string][] = [[31.0, 23.5, '#5E7F86', '#4B676D'], [33.2, 24.9, '#6E6A8E', '#57547A'], [36.0, 23.4, '#5F7A74', '#4A625D']];
  tableRugs.forEach(([x, z, a, b], i) => {
    k.put('rug', { kind: 'round', r: 1.05, colors: { body: a, secondary: b, accent: T.trim } }, W(x, z, 0.003), `cafTableRug${i}`, 0);
  });
  k.put('pastryCase', { w: 1.3 }, W(38.05, 26.95, 0, -Math.PI / 2), 'cafPastry', 0.15);
  for (const [x, y] of [[34.3, 2.12], [35.5, 1.98], [36.7, 2.12]]) k.put('lamp', { kind: 'pendant', shape: 'dome', drop: 2.8 - y - 0.1, colors: { body: T.tealDeep } }, W(x, 27.3, y), `cafBarPendant${x}`, 0);
  k.put('wallShelf', { w: 1.3 }, W(32.0, 20.1, 1.42, 0), 'cafShelfN', 0);
  const clusters: [string, KitParams, number, number][] = [['plant', { kind: 'monstera', h: 1.25 }, 37.55, 23.75], ['plant', { kind: 'fern', h: 0.7 }, 37.15, 24.15], ['plant', { kind: 'bush', h: 0.55, flowers: true }, 37.85, 24.25],
    ['plant', { kind: 'fern', h: 0.9 }, 28.45, 21.45], ['plant', { kind: 'cactus', h: 0.6 }, 28.9, 21.8]];
  for (const [name, params, px, pz] of clusters) k.put(name, params, W(px, pz), `cafCluster${px},${pz}`, 0.15);
  for (const [z, drop] of [[24.35, 0.5], [25.6, 0.65], [26.85, 0.45]]) k.put('plant', { kind: 'pothos', drop }, W(41.55, z, 2.15), `cafEastPothos${z}`, 0);

  // ---- lamps: café pendants from the anchors; the nook's floor lamp is the moon night-light
  lampFixtures(layout, k, new Set(['CAF']));
  for (const l of layout.lamps) {
    if (l.kind !== 'floor' || layout.zoneAt(l.pos.x, l.pos.z, 0) !== 'NAP') continue;
    k.put('nightMoon', { bulbY: l.pos.y }, { x: l.pos.x, y: 0, z: l.pos.z, yaw: -0.6 }, l.id, 0.07);
  }
}
