/**
 * Library dressing (M2 breadth, §7.1 LIB / §5.5 value map: walnut floor 44, oat plaster 74, green wainscot 40,
 * shelves walnut ≈ 32, spines 45–65). Under the mezzanine, so it is a low, warm, lamp-lit reading room: a wall of
 * crowned bookcases with a brass ladder rail and two rolling ladders, two long reading tables with green banker's
 * lamps and spindle-back chairs on deep-green runners, the signature globe by the west arch, the tea trolley and the
 * tea corner, a card catalogue on the arch pier, a reading-nook armchair, swan-neck sconces, and story props
 * (open books, mugs, a stack on the floor). Nothing in the library aisle (z 1.6–2.4) or a door apron. Owner: ENV.
 */
import { W, poseOf, local, hash01 } from './common.ts';
import type { DressKit } from './common.ts';
import type { HqLayout } from '../../layout/schema.ts';
import { T } from '../kit/tokens.ts';

/** Deep library greens / neutrals (value-map derived, all ≤ L* 45 on the floor; hue ≥ 60° from clay). */
const RUNNER = { body: '#3F5B4B', secondary: '#2F4539', accent: '#B8A67E' };
const NOOK_RUG = { body: '#5A6E7A', secondary: '#3F4F58', accent: '#C9BFAE' };
/** Shelves that stand clear of the north windows (x17–25, sill 1.45) grow to full height. */
const TALL = new Set([15.6, 25.6]);
/** [RND fix r3] banker-lamp shade tip (rad): mouth down toward the south readers, a sliver of lining at eye height. */
const LAMP_TILT = 1.25;

export function dressLibrary(layout: HqLayout, k: DressKit) {
  if (!layout.zones.some((z) => z.id === 'LIB')) return;
  let chairN = 0, shelfN = 0;
  for (const f of layout.furniture) {
    if (f.zone !== 'LIB' || f.level) continue;
    const p = poseOf(f);
    const [w, h, d] = f.size;
    const px = +(f.pos.x + 20.5).toFixed(2);
    switch (f.type) {
      case 'shelf': {
        const tall = TALL.has(px);
        k.put('shelf', { w, h: tall ? 1.85 : Math.max(h, 1.25), d, fill: 0.78 + hash01(shelfN++, 3) * 0.17, colors: { body: T.walnutDark } }, p, f.id, 0.28);
        break;
      }
      case 'readingTable': {
        k.put('readingTable', { w, d, h }, p, f.id, 0.25);
        k.put('rug', { kind: 'rect', w: w + 0.9, d: d + 1.5, colors: RUNNER }, { ...p, y: 0.002 }, `${f.id}:rug`, 0);
        // story props on the table: an open book, a stack, a mug, a note
        const i = chairN;
        k.put('bookStack', { n: 1 }, local(p, -0.35, h, 0.12, 0.3), `${f.id}:open`, 0);
        k.put('bookStack', { n: 3 }, local(p, 0.62, h, -0.18, -0.4), `${f.id}:stack`, 0);
        k.put('mug', { colors: { body: [T.teal, T.trim][i % 2] } }, local(p, 0.3, h, 0.22), `${f.id}:mug`, 0);
        if (hash01(i, 7) > 0.4) k.put('note', { colors: { body: T.butter } }, { ...local(p, -0.62, h + 0.002, -0.05, 0.5), rx: -Math.PI / 2 }, `${f.id}:note`, 0);
        break;
      }
      case 'chair': k.put('libChair', { colors: { body: ['#5E7F68', '#56727A'][chairN++ % 2] } }, { ...p, yaw: p.yaw + Math.PI }, f.id, 0.15); break;
      case 'ladder': k.put('ladder', { h: 1.33, lean: 0.24 }, { ...p, y: 0 }, f.id, 0.1); break;
      case 'globe': k.put('globe', { h: 1.08 }, p, f.id, 0.25); break;
      case 'coffeeCart': k.put('teaTrolley', { w, h, d }, p, f.id, 0.25); break;
      case 'cafeTable': k.put('table', { kind: 'round', w, h, colors: { body: T.walnut, secondary: T.ink2, accent: T.trim } }, p, f.id, 0.2); break;
      case 'stool': k.put('stool', { h, colors: { body: '#5E7F68', secondary: T.ink2, accent: T.brass } }, p, f.id, 0.12); break;
      case 'armchair': k.put('armchair', { colors: { body: '#6F8E9A', secondary: T.walnut, accent: T.trim } }, p, f.id, 0.25); break;
      default: break;
    }
  }
  // banker's lamps on the reading tables, at the layout's desk-lamp anchors (their pools light the tables)
  for (const l of layout.lamps) {
    if (l.kind !== 'desk' || layout.zoneAt(l.pos.x, l.pos.z, 0) !== 'LIB') continue;
    // [RND fix r3, cross-owner ENV] the shade faces the two south readers (and the hero camera), tipped down so only a
    // sliver of its lit lining shows from standing eye height (it faced north, away from both: a dark olive shade)
    k.put('bankerLamp', { tilt: LAMP_TILT }, { x: l.pos.x - 0.2, y: 0.5, z: l.pos.z - 0.12, yaw: Math.PI }, l.id, 0);
  }
  // the brass ladder rail along the bookcase fronts, the ladders hook over it
  k.put('brassRail', { len: 11.4 }, W(20.6, 0.45, 1.33, 0), 'libRail', 0);
  // tea corner + reading nook story props
  k.put('bookStack', { n: 2 }, W(24.95, 5.72, 0.55, 0.6), 'libCafeBooks', 0);
  k.put('mug', { colors: { body: T.lavender } }, W(24.75, 5.9, 0.55, 2), 'libCafeMug', 0);
  k.put('table', { kind: 'round', w: 0.42, h: 0.42, colors: { body: T.walnut, secondary: T.ink2, accent: T.trim } }, W(27.55, 4.8), 'libNookTable', 0.18);
  k.put('bookStack', { n: 3 }, W(27.55, 4.8, 0.42, 1.1), 'libNookBooks', 0);
  k.put('rug', { kind: 'round', r: 0.85, colors: NOOK_RUG }, W(27.0, 5.55, 0.002), 'libNookRug', 0);
  k.put('cushion', { kind: 'throw', w: 0.42, colors: { body: T.lavender } }, { ...W(27.2, 5.7, 0.62, -1.9), s: 0.9 }, 'libNookThrow', 0);
  // the reading rug in the middle (the zone's walkable point stays on it), a card catalogue on the arch pier
  k.put('rug', { kind: 'round', r: 1.25, colors: { body: '#6C5A6E', secondary: '#4A3F4D', accent: '#C9B98E' } }, W(21.0, 4.7, 0.002), 'libRug', 0);
  k.put('cardCatalog', {}, W(20.5, 6.62, 0, Math.PI), 'libCatalog', 0.25);
  k.put('plant', { kind: 'fern', h: 0.55 }, W(20.52, 6.62, 0.95), 'libCatalogFern', 0);
  // corner greenery (clear of the doors, the aisle and the browse slots)
  k.put('plant', { kind: 'monstera', h: 1.25 }, W(27.45, 0.62), 'libMonstera', 0.22);
  k.put('plant', { kind: 'bush', h: 0.8, flowers: true }, W(14.5, 2.78), 'libBush', 0.2);
  k.put('plant', { kind: 'pothos', drop: 0.55 }, W(17.3, 0.3, 1.26), 'libPothos', 0);
  k.put('plant', { kind: 'succulent' }, W(23.9, 0.28, 1.26), 'libCactus', 0);
  // books left on the floor by the stacks (someone's mid-sort), a bin by the tea trolley
  k.put('bookStack', { n: 4 }, W(19.05, 0.72, 0, 0.3), 'libFloorStack', 0);
  k.put('bookStack', { n: 2 }, W(24.62, 0.75, 0, 1.4), 'libFloorStack2', 0);
  k.put('bin', {}, W(15.35, 4.3), 'libBin', 0);
  // wall dressing: framed maps over the end bookcases, swan-neck sconces on the arch piers and the east wall
  k.put('poster', { w: 0.9, h: 0.6, style: 1 }, W(14.12, 5.6, 1.9, Math.PI / 2), 'libMapW', 0);
  k.put('poster', { w: 1.0, h: 0.62, style: 2 }, W(27.88, 3.2, 1.9, -Math.PI / 2), 'libMapE', 0);
  // [ENV fix m2 r3] the south wall (review m2 r3 h13-6 / h22-6: the hero view showed no bookshelves): tall bookcases
  // flank both arches (the end piers and either side of the card catalogue), a walnut book bridge spans each arch
  // over its head, and a station clock hangs over the catalogue (the pier sconces moved off the south wall)
  const SW = 6.9, S = Math.PI; // south wall face (plan z), facing north
  const southCases: [number, number, string][] = [[15.02, 1.62, 'libSouthW'], [19.88, 0.44, 'libPierW'], [21.12, 0.44, 'libPierE'], [26.0, 1.7, 'libSouthE']];
  for (const [x, w, id] of southCases) {
    k.put('shelf', { w, h: 2.28, d: 0.28, fill: 0.86, top: false, cast: false, colors: { body: T.walnutDark } }, W(x, SW - 0.14, 0, S), id, 0.25);
  }
  const bridges: [number, string][] = [[17.755, 'libBridgeW'], [23.245, 'libBridgeE']];
  for (const [x, id] of bridges) k.put('bookBridge', { w: 3.82, h: 0.27, d: 0.26, y: 0 }, W(x, SW, 2.3, S), id, 0); // posed at its ledge height: not a floor obstacle
  k.put('wallClock', { r: 0.2, hour: 4, min: 20 }, W(20.5, SW, 1.86, S), 'libClock', 0);
  for (const [px, pz, yaw] of [[27.9, 1.3, -Math.PI / 2], [27.9, 5.05, -Math.PI / 2], [14.1, 4.9, Math.PI / 2]]) {
    k.put('sconce', { colors: { body: T.linen } }, { ...W(px, pz, 1.58, yaw), s: 1.45 }, `libSconce${px},${pz}`, 0);
  }
}
