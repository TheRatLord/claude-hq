/**
 * Reading Alley dressing (§7.1 NAL: the 2 m book-lined link from Studio Street / W1 / E1 to the Library; laptop
 * overflow benches). [INT M2] NAL was not in any ENV breadth split, so it was still greybox; dressed here from the
 * existing kit, in the Library's palette so the alley reads as the Library spilling west: oak window benches with
 * cushions, laptops and book piles (the alleyBench slots sit on them), the two book carts, a tall bookcase closing
 * the street's north vista (x5–8, opposite the NAL-STR opening), sill succulents, floating wall shelves, framed maps
 * and swan-neck sconces on the south wall, a long green runner. Walkway z0.9–2, the zone point (6.5, 1.0) and the
 * Library side door (x14, z0.3–1.7) stay clear. Owner: ENV (added by INT).
 */
import { W, poseOf, local, hash01 } from './common.ts';
import type { DressKit } from './common.ts';
import type { HqLayout } from '../../layout/schema.ts';
import { lampFixtures } from './atrium.ts';
import { T } from '../kit/tokens.ts';

const RUNNER = { body: '#43604F', secondary: '#324839', accent: '#B8A67E' };
const BENCH = { body: T.oak, secondary: T.ink2, accent: T.brass };
const CUSHION = ['#6F8E9A', '#8C7AA0', '#B98E5C'];

export function dressAlley(layout: HqLayout, k: DressKit) {
  if (!layout.zones.some((z) => z.id === 'NAL')) return;
  let bn = 0;
  for (const f of layout.furniture) {
    if (f.zone !== 'NAL') continue;
    const p = poseOf(f);
    const [w, h, d] = f.size;
    if (f.type === 'bench') {
      const i = bn++;
      k.put('bench', { w, d, h, colors: BENCH }, p, f.id, 0.24);
      // a seat cushion under each alleyBench slot (slots at local x ±0.4), a laptop / books between them
      for (const e of [-1, 1]) k.put('cushion', { kind: 'floor', w: 0.42, h: 0.06, colors: { body: CUSHION[(i + (e > 0 ? 1 : 0)) % 3] } }, local(p, e * 0.4, h, 0.02, e * 0.05), `${f.id}:cush${e}`, 0);
      k.put('laptop', {}, local(p, i % 2 ? -0.72 : 0.72, h, -0.02, i % 2 ? 0.4 : -0.3), `${f.id}:laptop`, 0);
      k.put('bookStack', { n: 2 + (i % 2) }, local(p, i % 2 ? 0.72 : -0.72, h, 0.0, 0.5 + i), `${f.id}:books`, 0);
      if (i === 1) k.put('mug', { colors: { body: T.teal } }, local(p, 0.0, h, -0.14), `${f.id}:mug`, 0);
    } else if (f.type === 'bookCart') {
      k.put('bookCart', { w, h, d }, p, f.id, 0.22);
    }
  }
  // the street's north vista: a tall crowned bookcase with a fern beside it (the alley point at z1.0 stays clear)
  k.put('shelf', { w: 2.0, h: 2.05, d: 0.36, fill: 0.86, colors: { body: T.walnutDark } }, W(6.5, 0.2, 0, 0), 'nalCase', 0.28);
  k.put('plant', { kind: 'fern', h: 0.5 }, W(6.5, 0.22, 2.05), 'nalCaseFern', 0);
  k.put('plant', { kind: 'monstera', h: 1.05 }, W(5.05, 0.32), 'nalMonstera', 0.2);
  k.put('plant', { kind: 'bush', h: 0.85, flowers: true }, W(0.42, 0.42), 'nalBushW', 0.2);
  k.put('plant', { kind: 'fern', h: 0.6 }, W(11.0, 0.3), 'nalFernMid', 0.14);
  // sill succulents / cacti on the two north windows (sill 0.9)
  const sills: [number, string][] = [[1.25, 'succulent'], [3.75, 'cactus'], [9.25, 'cactus'], [11.75, 'succulent']];
  for (const [px, kind] of sills) k.put('plant', { kind, h: 0.3 }, W(px, 0.12, 0.9), `nalSill${px}`, 0);
  // the long green runner down the walkway (flat, never blocks)
  k.put('rug', { kind: 'runner', w: 13.2, d: 0.8, colors: RUNNER }, W(7.0, 1.42, 0.002), 'nalRunner', 0);
  // south wall (z2, faces -z): floating book shelves, framed maps, sconces; nothing below 1.3 m (walkway)
  for (const [px, n] of [[2.2, 0], [11.2, 1]]) {
    k.put('shelf', { w: 1.1, h: 0.4, d: 0.2, fill: 0.7, colors: { body: T.walnut } }, W(px, 1.79, 1.45, Math.PI), `nalWallShelf${n}`, 0);
    k.put('plant', { kind: 'pothos', drop: 0.4 }, W(px + 0.42, 1.8, 1.85, Math.PI), `nalShelfPothos${n}`, 0);
  }
  k.put('poster', { w: 0.9, h: 0.6, style: 1 }, W(4.0, 1.88, 1.7, Math.PI), 'nalMapA', 0);
  k.put('poster', { w: 0.7, h: 0.55, style: 2 }, W(9.3, 1.88, 1.7, Math.PI), 'nalMapB', 0);
  k.put('poster', { w: 0.55, h: 0.75, style: 0 }, W(13.03, 1.88, 1.65, Math.PI), 'nalMapC', 0);
  k.put('poster', { w: 0.6, h: 0.8, style: 0 }, W(0.12, 1.3, 1.6, Math.PI / 2), 'nalMapW', 0);
  for (const px of [0.9, 3.1, 8.6, 12.3]) k.put('sconce', { colors: { body: T.linen } }, { ...W(px, 1.89, 1.6, Math.PI), s: 1.35 }, `nalSconce${px}`, 0);
  // a small floor pile by the east bench (someone mid-sort), a tote
  k.put('bookStack', { n: 3 }, W(13.3, 0.35, 0, 0.7 + hash01(3, 1)), 'nalFloorStack', 0);
  k.put('tote', {}, W(1.2, 0.35, 0, 0.4), 'nalTote', 0);
  lampFixtures(layout, k, new Set(['NAL']));
}
