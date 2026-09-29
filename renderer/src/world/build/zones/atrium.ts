/**
 * Atrium + Pit dressing (M1.75 hero zones, §7.1 / §5.5): the queue lane (dais, brass stanchions, sagging teal
 * ropes, overflow rug), the Pit (six piped sage sofas with cushions and throws, beanbags, side tables, the hearth,
 * potted plants on the top tread, the Big Board housing), atrium furniture from the layout (benches, plants, arcade,
 * ping-pong), lamp fixtures on every lamp anchor in these cells, a stair-side and clerestory gallery of framed prints,
 * and corner greenery. Nothing is placed in a circulation lane or keep-clear rect (layout.lanes / keepClear) except
 * the layout's own furniture. Owner: ENV.
 */
import { W, poseOf, local, hash01 } from './common.ts';
import type { DressKit } from './common.ts';
import type { Furniture, HqLayout, Vec3 } from '../../layout/schema.ts';
import { T } from '../kit/tokens.ts';

const PIT_TREAD_Y = -0.15;
/** Cool accents for the Pit (derived: teal/lavender family, hue ≥ 60° from clay). */
const DUSK = '#7FA3B3', SLATE = '#7F92B5';

export function dressAtrium(layout: HqLayout, k: DressKit) {
  const cells = new Set(['ATR', 'PIT']);
  const inCells = (f: Furniture) => f.zone != null && cells.has(f.zone);
  const pit = layout.zones.find((z) => z.id === 'PIT')?.circle; // world [cx, cz, r]
  if (!pit) throw new Error('hq layout: the PIT zone has no circle');
  const pitPt = (r: number, deg: number, y = 0) => ({ x: pit[0] + r * Math.sin((deg * Math.PI) / 180), y, z: pit[1] - r * Math.cos((deg * Math.PI) / 180) });
  const faceIn = (p: { x: number; z: number }) => Math.atan2(pit[0] - p.x, pit[1] - p.z);
  let n = 0;
  for (const f of layout.furniture.filter(inCells)) {
    const p = poseOf(f);
    const [w, h, d] = f.size;
    switch (f.type) {
      case 'dais': k.put('dais', { w, d, h }, p, f.id, 0); break;
      case 'stanchion': k.put('stanchion', {}, p, f.id, 0); break;
      case 'rug': if (!f.round) k.put('rug', { kind: 'rect', w, d, colors: { body: '#44605F', secondary: '#5B7C78', accent: '#C9BFAE' } }, p, f.id, 0); break;
      case 'hearth': k.put('hearth', { w }, p, 'hearth', 0.3); break;
      // [ENV fix r1] no static housing: STAT's Big Board (world/stats/bigBoard.ts) has its own swivelling housing; a
      // fixed box round it poked through the faces whenever the board turned (the black band from the mezzanine)
      case 'bigBoard': break;
      case 'sofa': {
        k.put('sofa', { w, d: 0.72, back: 'low' }, p, f.id, 0.32); // [ENV fix r1] low conversation-pit backs (hearth + faces read from the rim)
        const i = n++;
        // complementary staging (§5.5 hue gap): everything a seated Clawd touches is cool or low-chroma, never clay-adjacent
        const cols = [T.lavender, DUSK, T.trim, T.teal];
        // a cushion propped against one or both arms (inside faces), a throw over every other back
        for (const e of hash01(i, 1) > 0.4 ? [-1, 1] : [hash01(i, 2) > 0.5 ? 1 : -1]) {
          k.put('cushion', { w: 0.3, h: 0.28, colors: { body: cols[(i + (e > 0 ? 1 : 0)) % cols.length] } }, { ...local(p, e * 0.66, 0.38, -0.02, -e * Math.PI / 2 + e * 0.35), rz: 0, rx: -0.25 }, `${f.id}:c${e}`, 0);
        }
        if (i % 2 === 0) k.put('cushion', { kind: 'throw', w: 0.46, colors: { body: [T.sage, T.lavender, DUSK][i % 3] } }, local(p, hash01(i, 3) > 0.5 ? 0.35 : -0.35, 0.425, -0.16), `${f.id}:throw`, 0);
        break;
      }
      case 'beanbag': k.put('beanbag', { colors: { body: [T.teal, T.lavender, '#8FA9A1', SLATE][n++ % 4] } }, { ...p, yaw: hash01(n, 5) * 6 }, f.id, 0.2); break;
      case 'plant': {
        const kind = f.id === 'plant4' ? 'monstera' : f.id === 'plant5' ? 'bush' : 'fern';
        k.put('plant', { kind, h: h * (kind === 'fern' ? 0.9 : 1), flowers: kind === 'bush' }, p, f.id, 0.2);
        break;
      }
      case 'arcade': k.put('arcade', { w, h, d }, p, f.id, 0.28); break;
      case 'pingPong': k.put('pingPong', { w, d, h, props: false }, p, f.id, 0.2); break; // [INT M2] props:false = BRN's rally owns paddles + ball // [ENV fix r1] layout height (BRN toy scale 0.5)
      case 'bench': {
        k.put('bench', { w, d: 0.42, h: 0.42 }, p, f.id, 0.2);
        k.put('cushion', { w: 0.3, h: 0.26, colors: { body: f.id === 'bench1' ? T.lavender : DUSK } }, { ...local(p, w * 0.32, 0.42, -0.08, 0.2), rx: -0.35 }, `${f.id}:c`, 0);
        if (f.id === 'bench1') k.put('bookStack', { n: 2 }, local(p, -w * 0.3, 0.42, 0.02, 0.5), `${f.id}:b`, 0);
        break;
      }
      default: break; // stairs, slide, pit rug: architecture; lampPost: from the lamp anchors
    }
  }
  // queue ropes between the stanchions (on the 0.15 m dais), brass clips, a sag that reads from the spawn
  for (const [x0, z0, x1, z1] of layout.queueRopes ?? []) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    k.put('rope', { len, y: 0.82 }, { x: x0, y: 0.15, z: z0, yaw: Math.atan2(-(z1 - z0), x1 - x0) }, `rope:${x0.toFixed(2)},${z0.toFixed(2)}`, 0);
  }
  // Pit: side tables (with a mug) east and west of the hearth, potted plants on the top tread between the step seats
  const rings = layout.plan.PIT.rings, floorPit = rings[rings.length - 1][1];
  for (const deg of [90, 270]) {
    const q = pitPt(1.05, deg, floorPit); // [ENV fix r1] hearth-side (was 1.5 m: as nav obstacles they cut the Pit floor ring in two)
    k.put('table', { kind: 'round', w: 0.42, h: 0.3, colors: { body: '#7E9C95', secondary: T.ink2, accent: T.trim } }, { ...q, yaw: faceIn(q) }, `pitTable${deg}`, 0.2);
    k.put('mug', { colors: { body: deg === 90 ? T.teal : T.trim } }, { ...q, y: floorPit + 0.3, x: q.x + 0.06, yaw: deg }, `pitMug${deg}`, 0);
    if (deg === 270) k.put('bookStack', { n: 2 }, { ...q, y: floorPit + 0.3, z: q.z + 0.05, yaw: 0.4 }, 'pitBooks', 0);
  }
  for (const deg of [64, 116, 244, 296]) {
    const q = pitPt(3.72, deg, PIT_TREAD_Y);
    k.put('plant', { kind: deg % 3 ? 'bush' : 'fern', h: 0.62, flowers: deg === 116 || deg === 296 }, { ...q, yaw: deg }, `pitPlant${deg}`, 0.15);
  }
  // [ENV fix r1] tread vignettes (the pitOverview / spawn foreground, §7.1 density): someone's stuff left on the top
  // step between the planters and the step seats — a tote against the planter, two floor cushions, an open book; and
  // on the west side a folded blanket + a mug. Clear of the pitStep seats (≥ 12°) and the N/S gaps.
  const tq = (deg: number, r = 3.7) => { const q = pitPt(r, deg, PIT_TREAD_Y); return { ...q, yaw: faceIn(q) }; };
  k.put('tote', { out: 'poster', colors: { body: '#B9C4B0' } }, { ...tq(123, 3.78), rx: -0.1 }, 'pitTote', 0);
  k.put('cushion', { kind: 'floor', w: 0.46, colors: { body: T.butter } }, { ...tq(131), yaw: 0.4 }, 'pitFloorCushion0', 0);
  k.put('cushion', { kind: 'floor', w: 0.4, h: 0.1, colors: { body: DUSK } }, { ...tq(131.5), y: PIT_TREAD_Y + 0.145, yaw: 1.1, rz: 0.05 }, 'pitFloorCushion1', 0);
  k.put('bookStack', { n: 1 }, { ...tq(137, 3.62), yaw: 2.1 }, 'pitOpenBook', 0);
  k.put('cushion', { kind: 'throw', w: 0.4, colors: { body: T.lavender } }, { ...tq(236, 3.75), y: PIT_TREAD_Y - 0.13, s: 0.8 }, 'pitBlanket', 0);
  k.put('mug', { colors: { body: T.butter } }, { ...tq(239, 3.55) }, 'pitStepMug', 0);
  // corner greenery clear of every lane: a tree in a tub in the SE pocket, a monstera behind the RAM column
  k.put('plant', { kind: 'tree', h: 2.5 }, W(27.25, 20.3), 'atrTree', 0.25);
  k.put('plant', { kind: 'monstera', h: 1.3 }, W(23.7, 20.35), 'atrMonstera', 0.2);
  k.put('waterCooler', {}, W(14.35, 7.38, 0, Math.PI / 2), 'atrCooler', 0.25);
  k.put('bin', {}, W(25.45, 12.2), 'atrBin', 0);
  // wall gallery: big framed prints above the E-bay glazing, above the ENG glass (stair side) and over the rope line
  const prints = [
    [14.12, 9.55, 4.0, Math.PI / 2, 1.1, 1.4], [14.12, 13.45, 4.0, Math.PI / 2, 1.1, 1.4], [14.12, 16.2, 4.0, Math.PI / 2, 1.1, 1.4], [14.12, 20.0, 4.0, Math.PI / 2, 1.1, 1.4],
    [27.88, 12.4, 3.95, -Math.PI / 2, 1.2, 1.5], [27.88, 16.0, 3.95, -Math.PI / 2, 1.2, 1.5],
    [18.4, 20.88, 4.45, Math.PI, 1.0, 1.25], [22.6, 20.88, 4.45, Math.PI, 1.0, 1.25], [26.2, 20.88, 4.45, Math.PI, 1.0, 1.25],
  ];
  prints.forEach(([px, pz, y, yaw, w, h], i) => k.put('poster', { w, h, style: i % 3 }, W(px, pz, y, yaw), `atrPrint${i}`, 0));
  // lamp fixtures on the lamp anchors of these cells (pools come from the same anchors, render/lamps.ts)
  lampFixtures(layout, k, cells);
}

/** Fixtures for every lamp anchor whose cell is in `cells` (pendants hang from the zone ceiling). */
export function lampFixtures(layout: HqLayout, k: DressKit, cells: ReadonlySet<string>): void {
  const cellOf = (p: Vec3) => layout.zoneAt(p.x, p.z, p.y > 2.95 ? 1 : 0);
  for (const l of layout.lamps) {
    const z = cellOf(l.pos);
    if (z === null || !cells.has(z)) continue;
    const zone = layout.zones.find((q) => q.id === z);
    if (l.kind === 'pendant') {
      const ceil = z === 'PIT' || z === 'ATR' ? 5.5 : zone?.ceil ?? 2.8;
      k.put('lamp', { kind: 'pendant', drop: Math.max(0.2, ceil - l.pos.y - 0.12), shape: z === 'ATR' || z === 'PIT' ? 'dome' : 'drum' }, { x: l.pos.x, y: l.pos.y, z: l.pos.z, yaw: 0 }, l.id, 0);
    } else if (l.kind === 'floor') {
      const fy = layout.floorY(l.pos.x, l.pos.z, 0);
      k.put('lamp', { kind: 'floor', bulbY: l.pos.y - fy }, { x: l.pos.x, y: fy, z: l.pos.z, yaw: 0.3 }, l.id, 0.12);
    } else if (l.kind === 'desk') {
      k.put('lamp', { kind: 'desk' }, { x: l.pos.x, y: l.pos.y - 0.33, z: l.pos.z, yaw: 0 }, l.id, 0);
    }
  }
}

