/**
 * Mezzanine dressing (M2 breadth, §7.1 MEZ, §5.5 value map "MEZ: navy carpet 38, ceiling 28 star-map, telescope
 * brass"; zone grade dusk navy). Two signature pieces: the Round Table (`task` station: compass-rose inlay, map on a
 * lazy susan, a candle, eight arch-backed chairs) and the Observatory (three brass telescopes at the high windows, an
 * orrery under a hung star canopy, the star chart, a star rug). The hot-desk row is one long bench desk with laptops;
 * a task corkboard and cubbies on the west wall, flower boxes hung on the atrium face of the balustrade (clear of
 * the `mezzToPit` view), floor lamps / the Round Table pendant from the lamp anchors (level-1 floor = MEZZ_Y). The
 * rail run (layout RAIL_RUN) stays empty. Owner: ENV.
 */
import { W, poseOf, local, hash01 } from './common.ts';
import type { DressKit } from './common.ts';
import type { HqLayout } from '../../layout/schema.ts';
import { T, NOTES } from '../kit/tokens.ts';
import { LT } from '../kit/lounge.ts';

const PI = Math.PI;
const MY = 2.9; // mezzanine floor (floorY.ts MEZZ_Y)

export function dressMezz(layout: HqLayout, k: DressKit) {
  if (!layout.zones.some((z) => z.id === 'MEZ')) return;
  const mine = layout.furniture.filter((f) => f.zone === 'MEZ');
  const rt = mine.find((f) => f.type === 'roundTable');
  const hot = mine.filter((f) => f.type === 'hotDesk').sort((a, b) => a.pos.x - b.pos.x);
  let nt = 0;
  for (const f of mine) {
    const p = poseOf(f);
    const [w, h, d] = f.size;
    switch (f.type) {
      case 'roundTable': k.put('roundTable', { w, h }, p, f.id, 0.3); break;
      case 'stool': {
        if (rt && Math.hypot(rt.pos.x - p.x, rt.pos.z - p.z) < 2) k.put('rtChair', { h }, { ...p, yaw: Math.atan2(rt.pos.x - p.x, rt.pos.z - p.z) }, f.id, 0.1);
        else k.put('stool', { h, r: 0.16, colors: { body: T.oak, secondary: T.ink2, accent: T.brass } }, p, f.id, 0.1);
        break;
      }
      case 'telescope': k.put('telescope', {}, p, f.id, 0.2); break;
      case 'starChart': k.put('starChart', { w, h }, local(p, 0, 0, 0.0), f.id, 0); break;
      case 'plant': k.put('plant', f.id === 'plant7' ? { kind: 'monstera', h: h * 1.05 } : { kind: 'fern', h: h * 0.95 }, p, f.id, 0.2); break;
      case 'beanbag': k.put('beanbag', { w: 0.8, colors: { body: '#5E6894' } }, { ...p, yaw: 0.8 }, f.id, 0.15); break;
      case 'hotDesk': { // per seat: a laptop, and seeded story props (mug, note, a desk lamp at the row ends)
        const i = nt++;
        k.put('laptop', {}, local(p, (hash01(i, 1) - 0.5) * 0.12, h, 0.02, (hash01(i, 2) - 0.5) * 0.3), `${f.id}:laptop`, 0);
        if (hash01(i, 3) > 0.35) k.put('mug', { colors: { body: [T.teal, T.trim, T.lavender, T.butter][i % 4] } }, local(p, 0.27, h, 0.05, i), `${f.id}:mug`, 0);
        if (hash01(i, 4) > 0.6) k.put('note', { colors: { body: NOTES[i % NOTES.length] } }, { ...local(p, -0.25, h + 0.1, -0.2), rx: 0 }, `${f.id}:note`, 0);
        if (i === 0 || i === hot.length - 1 || i === 4) k.put('lamp', { kind: 'desk' }, local(p, i === 0 ? -0.3 : 0.3, h, -0.1, i === 0 ? 0.5 : -0.5), `${f.id}:lamp`, 0);
        break;
      }
      default: break; // lampPost: from the lamp anchors below
    }
  }
  // the hot-desk bench: one long oak top under the eight layout desks (their slots / nav stay per desk)
  if (hot.length) {
    const x0 = hot[0].pos.x - hot[0].size[0] / 2, x1 = hot[hot.length - 1].pos.x + hot[hot.length - 1].size[0] / 2;
    k.put('benchDesk', { w: x1 - x0 + 0.1, d: hot[0].size[2], h: hot[0].size[1] }, { x: (x0 + x1) / 2, y: hot[0].pos.y, z: hot[0].pos.z, yaw: hot[0].yaw }, 'mezHotBench', 0.2);
  }

  // ---- Round Table surroundings: a task corkboard and cubbies on the west wall, a rug under the table
  k.put('rug', { kind: 'round', r: 1.95, colors: { body: '#4C5578', secondary: '#3E4666', accent: T.brass } }, W(17.5, 3.1, MY + 0.002), 'mezRtRug', 0);
  k.put('corkboard', { w: 1.0, h: 0.72 }, W(14.12, 1.6, MY + 1.3, PI / 2), 'mezTaskBoard', 0);
  k.put('cubbies', { w: 1.4, h: 0.8, d: 0.34, cols: 3 }, W(14.24, 4.75, MY, PI / 2), 'mezCubbies', 0.2);
  k.put('plant', { kind: 'bush', h: 0.7, flowers: true }, W(14.3, 4.75, MY + 0.8), 'mezCubbyPlant', 0);
  k.put('whiteboard', { w: 1.1, h: 0.75, wall: true }, W(20.75, 0.12, MY + 1.05, 0), 'mezOrbitBoard', 0);

  // ---- Observatory: star canopy, orrery on a star rug, a telescope case, the stargazing corner
  k.put('starCanopy', { w: 6.6, d: 4.4, hang: 0.18 }, W(24.5, 2.3, 5.24), 'mezCanopy', 0);
  // the Round Table half gets its own (sparser) panel: the whole mezzanine reads as one night sky (§5.5 MEZ ceiling 28)
  k.put('starCanopy', { w: 6.5, d: 4.4, hang: 0.18, stars: 46 }, W(17.55, 2.3, 5.24, PI), 'mezCanopyRT', 0);
  k.put('rug', { kind: 'round', r: 0.95, colors: { body: '#5A6490', secondary: '#454E78', accent: T.butter } }, W(23.7, 2.75, MY + 0.002), 'mezStarRug', 0);
  k.put('orrery', {}, W(23.7, 2.75, MY, 0.4), 'mezOrrery', 0.25);
  k.put('crate', { w: 0.6, h: 0.3, d: 0.36 }, W(27.55, 2.05, MY, -0.2), 'mezScopeCase', 0.2);
  k.put('bookStack', { n: 2 }, W(27.52, 2.05, MY + 0.3, 0.4), 'mezAtlas', 0);
  k.put('cushion', { kind: 'floor', w: 0.44, colors: { body: T.lavender } }, W(21.75, 3.55, MY, 0.4), 'mezGazeCush', 0);
  k.put('cushion', { kind: 'throw', w: 0.4, colors: { body: LT.quiltDusk } }, { ...W(20.55, 3.35, MY + 0.02), s: 0.8 }, 'mezGazeThrow', 0);

  // ---- balustrade flower boxes (atrium face), clear of the slide mouth and the mezzToPit camera (plan x19.85)
  for (const [x, bw] of [[17.4, 1.0], [22.3, 1.2], [24.55, 1.2]]) k.put('railBox', { w: bw }, W(x, 7.05, MY + 0.66, 0), `mezRailBox${x}`, 0);

  // ---- lamps (level 1): floor lamps stand on the mezzanine, the Round Table pendant hangs from the roof (5.5)
  for (const l of layout.lamps) {
    if (!(l.pos.y > 2.95 && layout.zoneAt(l.pos.x, l.pos.z, 1) === 'MEZ')) continue;
    if (l.kind === 'floor') k.put('lamp', { kind: 'floor', bulbY: l.pos.y - MY }, { x: l.pos.x, y: MY, z: l.pos.z, yaw: 0.3 }, l.id, 0.12);
    else if (l.kind === 'pendant') k.put('lamp', { kind: 'pendant', drop: Math.max(0.2, 5.5 - l.pos.y - 0.12), shape: 'dome' }, { x: l.pos.x, y: l.pos.y, z: l.pos.z, yaw: 0 }, l.id, 0);
  }
}
