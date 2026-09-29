/**
 * Exterior near layer (§7.3 "south: garden"; the far hill / tree / skyline cards are the sky shader's): what the Lobby
 * entrance and the south windows (War Room, Lab, Lobby, Café) look out on. A stone stoop down from the entrance sill to
 * the garden (the ground plane sits 0.55 m below the floor), stepping stones, clipped hedges under every south window,
 * flower beds, lollipop trees, a pond seen from the Lobby's east window, garden lamps, and a picket fence in front of
 * the sky card. All `OUT` cell, merged into the kit groups (no extra draws). Owner: ENV.
 */
import { W, OX } from './common.ts';
import type { DressKit } from './common.ts';
import type { HqLayout } from '../../layout/schema.ts';
import { T } from '../kit/tokens.ts';
import { rngOf, withDetail } from '../kit/core.ts';
import { FAR_DETAIL } from '../kit/index.ts'; // [ENV fix m2 r3b] the west garden's low twin
import { hillCrest } from '../kit/finish.ts'; // [ENV fix m3 r1] cottages on the far ridge

const G = -0.55; // garden ground (architecture.ts exterior ground plane)
const FACE = 28.12; // south façade, outside face

export function dressExterior(layout: HqLayout, k: DressKit) {
  if (layout.id !== 'hq') return;
  // the stoop: landing at the sill, three steps down to the garden, then a curving stepping-stone path
  k.put('stoop', { w: 4.2, land: 1.0, drop: -G, n: 3, noContact: true }, W(20.5, FACE, 0, 0), 'outStoop', 0);
  k.put('steppingStones', { n: 5, len: 2.8, bend: 0.35 }, W(20.5, FACE + 2.15, G, 0), 'outPath', 0);
  // hedges under the south windows (tops ≈ 0.3 m under the sills, so the view out starts with foliage)
  for (const [x, w] of [[3.3, 3.6], [10.3, 4.5], [16.5, 3.1], [25.0, 4.1], [33.0, 6.8], [39.6, 2.6]]) k.put('hedge', { w, d: 0.6, h: 0.72 }, W(x, FACE + 0.42, G, 0), `outHedge${x}`, 0);
  // flower beds flanking the path, garden lamps at the foot of the steps
  k.put('flowerBed', { w: 1.1, d: 0.7 }, W(19.05, FACE + 2.75, G, 0.1), 'outBedW', 0);
  k.put('flowerBed', { w: 1.1, d: 0.7 }, W(22.0, FACE + 3.1, G, -0.15), 'outBedE', 0);
  for (const x of [18.05, 22.95]) k.put('lamp', { kind: 'street', bulbY: 1.9 }, W(x, FACE + 1.35, G, 0), `outLamp${x}`, 0);
  // lollipop trees (seeded heights), a pond off the Lobby's east window
  const trees = [[1.2, 30.6, 2.8], [6.4, 31.4, 3.1], [12.6, 30.9, 2.6], [15.2, 31.9, 3.2], [26.9, 30.3, 2.4], [29.6, 31.6, 3.3], [35.8, 30.8, 2.9], [40.6, 31.7, 3.0], [9.0, 32.6, 2.2], [31.8, 32.9, 2.4], [18.6, 32.8, 2.7], [22.9, 32.4, 2.3]];
  // [ENV fix m2 r2] smooth blob-cluster / capsule-poplar crowns, all in ONE always-near foliage group (`K~trees`, index.ts)
  k.group = 'K~trees';
  // [ENV fix m3 r1] `lo` 1 (window-scenery detail) except the four flanking the entrance path, which the player walks up to
  trees.forEach(([x, z, h], i) => k.put('gardenTree', { h, kind: i % 4 === 3 ? 'poplar' : 'round', lo: Math.abs(x - 20.5) < 7 ? 0 : 1 }, W(x, z, G, i * 1.3), `outTree${i}`, 0));
  // the plan view's side lawns (beyond the W / E sky cards: never seen from inside, they frame the diorama from above)
  const side: [number, number, number, string?][] = [[-8.2, 3.5, 3.0], [-9.6, 9.8, 2.6], [-7.8, 15.6, 3.3, 'poplar'], [-9.2, 22.4, 2.8], [-8.0, 29.0, 3.1],
    [50.2, 2.8, 2.9], [51.6, 9.0, 3.2, 'poplar'], [49.8, 15.2, 2.7], [51.2, 21.6, 3.0], [50.0, 28.4, 2.6, 'poplar']];
  // [ENV fix m2 r3] the west garden (review m2 r3: the W-bay windows showed a flat pastel card, a sea band and evenly
  // spaced green lozenges): two layers of rolling clay hills (a darker near berm, a hazier far ridge just in front of
  // the sky card) and a varied row of round / poplar trees, one close to every west window so it parallaxes against
  // the hills; `K~treesW` (build/index.ts) is drawn only from the west half and the plan view
  // [ENV fix m2 r3b] §5.3 tris (review m2 r3: the street pose drew the whole west garden at full detail through the
  // W-bay storefronts): built twice from the same seeds, `K~treesW` (full) and `K~treesWLo` (FAR_DETAIL hills /
  // cottages, plan-view `lo` 2 trees); index.ts draws the full one only within LOD_M line-of-sight of the eye, the
  // low twin beyond that, and neither when no window gives a line of sight (occlusion.ts)
  const westGarden = (twin: boolean) => {
    const WX = 0; // plan x of the west façade (world −20.5); the sky card stands 6 m out
    // three hill layers, each one value step lighter / hazier with distance, tops stepping up with distance (near ≈ 0.8,
    // mid ≈ 1.3, far ≈ 1.9 m) so from the bay each ridge sits in the window's lower half under a band of sky
    const layers: [dx: number, d: number, hs: number[], dark: string, light: string, zs: number[], w: number][] = [
      [5.5, 3.4, [2.3, 2.7, 2.2, 2.6, 2.4], '#8DA487', '#C2CDB6', [-2.5, 6.0, 14.5, 23.0, 31.5], 9.5],
      [4.1, 2.6, [1.8, 2.05, 1.75, 1.95], '#6F8C69', '#A4B892', [1.5, 10.0, 18.0, 26.5], 8.0],
      [2.7, 1.9, [1.3, 1.5, 1.35, 1.45, 1.25], '#55714F', '#86A073', [-1.0, 5.5, 12.5, 19.5, 27.0], 6.2],
    ];
    const hillP = (L: number, i: number) => { const [, d, hs, dark, light, , w] = layers[L]; return { w: w * (0.9 + 0.2 * ((i * 7 + L) % 3) / 2), d, h: hs[i % hs.length], dark, light, ...(twin ? { ws: 16, hs: 5 } : {}) }; }; // twin: ≈ 160 tris a hill
    const hillYaw = (L: number, i: number) => Math.PI / 2 + ((i + L) % 2 ? 0.07 : -0.06);
    layers.forEach(([dx, , , , , zs], L) => zs.forEach((z, i) => k.put('hill', hillP(L, i), W(WX - dx, z, G, hillYaw(L, i)), `outHill${L}:${i}`, 0)));
    // [ENV fix m3 r1] a few far-off cottages standing on the far ridge (review m3 r1 art: at 22 h the window hills need
    // "a few warm house-window dots"): their windows are `shade`-class panes, lit only after dark. [hill index, offset
    // along the ridge (local x, m), cottage width]; placed where each W-bay window's view lands on the far ridge
    for (const [i, ox, cw] of [[1, 1.8, 0.5], [1, -1.2, 0.4], [2, 2.2, 0.52], [2, -2.9, 0.44], [3, -3.0, 0.5], [4, -1.0, 0.46]]) {
      const [dx, , , , , zs] = layers[0], hp = hillP(0, i), yaw = hillYaw(0, i);
      const cy = hillCrest(hp, rngOf(`outHill0:${i}`), ox) - (twin ? 0.12 : 0.05); // sunk a little into the crest (the mesh is faceted; the twin coarser)
      // hill-local x → world (x, z) offset (ox·cos yaw, −ox·sin yaw) (common.ts local(); yaw ≈ π/2: along −z)
      k.put('cottage', { w: cw, windows: 1 + (i % 3) }, W(WX - dx + ox * Math.cos(yaw), zs[i] - ox * Math.sin(yaw), G + cy, Math.PI / 2 + (i % 2 ? 0.25 : -0.2)), `outCottage${i}:${ox}`, 0);
    }
    // trees in front of the hills, off to the sides of each west window (plan z 5, 11.5, 18, 25.75) so the hills show
    const west: [number, number, number, string][] = [[-2.3, 0.9, 2.7, 'round'], [-3.4, 3.1, 3.4, 'poplar'], [-2.6, 7.3, 2.5, 'round'], [-3.7, 9.4, 3.0, 'round'], [-2.4, 14.2, 3.5, 'poplar'],
      [-3.2, 16.0, 2.6, 'round'], [-2.5, 20.4, 2.9, 'round'], [-3.8, 23.4, 3.6, 'poplar'], [-2.6, 28.0, 2.6, 'round']];
    west.forEach(([dx, z, h, kind], i) => k.put('gardenTree', { h, kind, lo: twin ? 2 : 1 }, W(WX + dx, z, G, i * 1.7), `outWestTree${i}`, 0));
  };
  k.group = 'K~treesW';
  westGarden(false);
  k.group = 'K~treesWLo';
  withDetail(FAR_DETAIL, () => westGarden(true));
  k.group = 'K~treesPlan'; // shown only from the plan camera (index.ts), so they cost nothing at eye level
  side.forEach(([x, z, h, kind], i) => k.put('gardenTree', { h, kind: kind ?? 'round', lo: 2 }, W(x, z, G, i * 2.1), `outSideTree${i}`, 0));
  k.group = null;
  // [ENV fix m2 r3] the façade dressing (review m2 r3: "a grey box"): the CLAUDE HQ clay name board in the frieze over
  // the entrance, a striped teal / cream awning over the door, brass wall lanterns flanking it, window boxes under
  // every south window (the stone trims themselves are architecture.ts facade())
  // (all in `K~facade`, build/index.ts: drawn only from outside the building or the plan view; from the café / lobby
  // windows they are below the sill or behind the wall, and they were 20k tris + shadow casters in the café pose)
  k.group = 'K~facade';
  k.put('hqSign', { w: 3.0, h: 0.46 }, W(20.5, FACE, 3.005, 0), 'outSign', 0);
  k.put('awning', { w: 3.7, d: 0.85, colors: { body: T.trim, secondary: '#3F6B67' } }, { ...W(20.5, FACE, 2.72, 0), rx: 0.42 }, 'outAwning', 0); // tipped: from eye height a 15° canopy read edge-on
  for (const x of [18.35, 22.65]) k.put('wallLantern', { reach: 0.3 }, W(x, FACE, 1.55, 0), `outWallLantern${x}`, 0);
  const b = layout.bounds;
  for (const w of layout.walls) {
    if (w.kind === 'rail' || Math.abs(w.a[1] - b.maxZ) > 1e-3 || Math.abs(w.b[1] - b.maxZ) > 1e-3) continue;
    const ux = Math.sign(w.b[0] - w.a[0]);
    for (const q of w.openings ?? []) {
      if (q.kind !== 'window') continue;
      const n = q.w > 4.6 ? 2 : 1, bw = n > 1 ? Math.min(2.6, q.w / 2 - 0.4) : q.w - 0.1;
      for (let i = 0; i < n; i++) {
        const s = n > 1 ? q.at + (q.w * (i + 0.5)) / n : q.at + q.w / 2, x = w.a[0] + ux * s + OX;
        k.put('windowBox', { w: bw }, W(x, FACE + 0.005, q.sill - 0.13, 0), `outWinBox${x.toFixed(1)}`, 0);
      }
    }
  }
  k.group = null;
  k.put('pond', { w: 2.6, d: 1.3 }, W(25.2, 31.9, G, 0.12), 'outPond', 0);
  k.put('bench', { w: 1.3, d: 0.4, h: 0.42 }, W(28.1, 32.2, G, -2.2), 'outBench', 0);
  // picket fence in front of the sky card, gate gap on the path
  for (const [x0, x1] of [[-1, 5], [5, 11], [11, 16.6], [16.6, 19.6], [21.4, 25], [25, 30.5], [30.5, 36], [36, 43]]) {
    k.put('picketFence', { len: x1 - x0 }, W((x0 + x1) / 2, 33.5, G, 0), `outFence${x0}`, 0);
  }
}
