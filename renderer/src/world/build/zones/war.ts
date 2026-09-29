/**
 * War Room dressing (§7.1 WAR: the todo / think station; value map WAR 48 floor, cork / kraft / steel). [INT M2] WAR
 * was not in any ENV breadth split, so it was still greybox; dressed here from the existing kit as a cosy planning
 * room: two rolling whiteboards on casters in front of the south window (the station:war slots stand at them),
 * an oak planning table on a slate rug with laptops, sticky notes, a planning-poker deck and mugs, arch-backed
 * chairs round it, a flip-chart easel, a roadmap chart + corkboard on the walls, cubbies under the west window,
 * a filing cabinet, a monstera. The north door apron (x2.5–3.9) and the four station slots stay clear. Owner: ENV
 * (added by INT).
 */
import { W, poseOf, local } from './common.ts';
import type { DressKit } from './common.ts';
import type { HqLayout } from '../../layout/schema.ts';
import { lampFixtures } from './atrium.ts';
import { T, NOTES } from '../kit/tokens.ts';

const RUG = { body: '#556474', secondary: '#3F4B58', accent: '#C9BFAE' };
const CHAIR = ['#5E7F68', '#56727A', '#7A6A8E'];

export function dressWar(layout: HqLayout, k: DressKit) {
  if (!layout.zones.some((z) => z.id === 'WAR')) return;
  for (const f of layout.furniture) {
    if (f.zone !== 'WAR') continue;
    const p = poseOf(f);
    const [w, h, d] = f.size;
    switch (f.type) {
      case 'whiteboard': {
        // a rolling board on casters just off the window wall (layout pos is the wall plane, y = board centre)
        k.put('whiteboard', { w: w - 0.2, h: 0.95 }, local({ ...p, y: 0 }, 0, 0, 0.3), f.id, 0.2);
        break;
      }
      case 'meetingTable': {
        k.put('readingTable', { w, d, h, colors: { body: T.oak, secondary: '#6E5A48', accent: T.brass } }, p, f.id, 0.26);
        k.put('rug', { kind: 'rect', w: w + 1.1, d: d + 1.3, colors: RUG }, { ...p, y: 0.002 }, `${f.id}:rug`, 0);
        k.put('laptop', {}, local(p, -0.55, h, 0.18, 0.1), `${f.id}:lapA`, 0);
        k.put('laptop', {}, local(p, 0.5, h, -0.2, Math.PI - 0.15), `${f.id}:lapB`, 0);
        k.put('cardDeck', {}, local(p, 0.05, h, 0.05, 0.3), `${f.id}:poker`, 0);
        k.put('mug', { colors: { body: T.teal } }, local(p, -0.82, h, -0.22), `${f.id}:mugA`, 0);
        k.put('mug', { colors: { body: T.butter } }, local(p, 0.86, h, 0.24), `${f.id}:mugB`, 0);
        for (let i = 0; i < 5; i++) k.put('note', { colors: { body: NOTES[i % NOTES.length] } }, { ...local(p, -0.3 + i * 0.16, h + 0.002, -0.28 + (i % 2) * 0.1, i * 0.4), rx: -Math.PI / 2 }, `${f.id}:note${i}`, 0);
        k.put('plant', { kind: 'succulent' }, local(p, 0.32, h, 0.12), `${f.id}:succ`, 0);
        // arch-backed chairs: two per long side, one at each end (seats face the table)
        const seats = [[-0.5, -0.72, 0], [0.5, -0.72, 0], [-0.5, 0.72, Math.PI], [0.5, 0.72, Math.PI], [-1.28, 0, Math.PI / 2], [1.28, 0, -Math.PI / 2]];
        seats.forEach(([lx, lz, yaw], i) => k.put('rtChair', { h: 0.34, back: 0.34, colors: { body: CHAIR[i % 3], secondary: T.walnut } }, { ...local(p, lx, 0, lz), yaw: p.yaw + yaw + (i % 2 ? 0.12 : -0.08) }, `${f.id}:chair${i}`, 0.14));
        break;
      }
      case 'plant': k.put('plant', { kind: 'monstera', h: 1.15 }, p, f.id, 0.22); break;
      default: break;
    }
  }
  // north wall (z23.5, faces +z): the roadmap (stacked-bar "gantt" print) left of the door, a corkboard right of it
  k.put('poster', { w: 1.3, h: 0.72, style: 1 }, W(1.45, 23.62, 1.7, 0), 'warRoadmap', 0);
  k.put('corkboard', { w: 1.2, h: 0.75 }, W(5.1, 23.62, 1.35, 0), 'warCork', 0);
  // east wall (x6.5, faces -x): flip-chart easel in the NE corner, a filing cabinet, a print
  k.put('easel', { h: 1.45 }, W(5.85, 24.35, 0, -2.2), 'warEasel', 0.16);
  k.put('filingCabinet', { drawers: 3 }, W(6.2, 26.3, 0, -Math.PI / 2), 'warFiling', 0.2);
  k.put('plant', { kind: 'succulent' }, W(6.2, 26.3, 0.96), 'warFilingSucc', 0);
  k.put('poster', { w: 0.6, h: 0.8, style: 2 }, W(6.38, 25.3, 1.6, -Math.PI / 2), 'warPrintE', 0);
  // west wall (x0, window z24.5–27): low cubbies of binders under the sill
  k.put('cubbies', { w: 1.6, h: 0.78, d: 0.34 }, W(0.2, 25.75, 0, Math.PI / 2), 'warCubbies', 0.18);
  k.put('plant', { kind: 'cactus', h: 0.3 }, W(0.2, 25.1, 0.78), 'warCubbyCactus', 0);
  k.put('bookStack', { n: 2 }, W(0.2, 26.3, 0.78, 0.4), 'warCubbyBooks', 0);
  // SE / SW corners: a bin, a crate of rolled plans
  k.put('bin', {}, W(6.1, 27.6), 'warBin', 0);
  k.put('crate', { w: 0.42, h: 0.3, d: 0.34 }, W(0.35, 27.55, 0, 0.3), 'warCrate', 0.16);
  lampFixtures(layout, k, new Set(['WAR']));
}
