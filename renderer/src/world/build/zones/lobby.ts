/**
 * Lobby dressing (M2 breadth, §7.1 LOB / §5.5 value map "Help Desk walnut 38 + brass", matched to the signed hero
 * zones): the Help Desk (signature: pill-shaped walnut teller counter, brass "?" medallion, desk bell at the layout's
 * bell point, NOW SERVING stand under the greybox sign quad), the STAFF mat, the service light, the coffee cart with
 * its awning (AMB steam vent on the brass machine) and chalk menu, the fish tank (AMB fish swim in it), a waiting
 * nook (wingbacks, coffee table, rug, radiator, letter-board directory), the entrance (coir mat, sconces, coat rack,
 * umbrella stand, guest-book podium), a verdigris Clawd statue, Dusty's dock, the fig Ada waters, flower boxes,
 * wall prints and the lamp fixtures on the layout's lamp anchors. Nothing sits in a lane, keep-clear rect or on a
 * slot (build.test.ts). The RAM column is STAT's (world/stats/ramColumn.ts). Owner: ENV.
 */
import { W, poseOf, local, hash01 } from './common.ts';
import type { DressKit } from './common.ts';
import type { HqLayout } from '../../layout/schema.ts';
import { T } from '../kit/tokens.ts';
import { lampFixtures } from './atrium.ts';

const PI = Math.PI;
/**
 * [ENV M3.5] The Lobby hiring / arrivals crate spot (published for BRN: `world.anchors['lobby:hireCrate']`,
 * build/index.ts; node-side import from build/dress.ts). Plan (18.05, 23.35): on the lobby's west side between the
 * STAFF mat and the spawn planters, 24° left of the spawn view axis at 4 m and 18° off the lobbyDesk axis at 3.4 m,
 * clear of every keep-clear rect (main corridor x ≥ 18.5). `yaw` is camera-style (layout/schema.ts: forward =
 * (−sin yaw, −cos yaw)): the crate's front faces between the spawn and the lobbyDesk eye, so an unwrap reads from both.
 * The spot is a flat, walkable inlay (arrivalsPad) with an ARRIVALS post sign behind its west corner.
 */
export const HIRE_CRATE = Object.freeze({ plan: [18.05, 23.35], x: 18.05 - 20.5, y: 0, z: 23.35 - 14, yaw: Math.atan2(-0.734, -0.679), size: [1.0, 1.0] });
/** Cool staging near the queue / desk (§5.5 complementary staging): slate-teal and sage-grey fabrics. */
const SLATE_TEAL = '#4E6E6E', SAGE_GREY = '#7E918A';

export function dressLobby(layout: HqLayout, k: DressKit) {
  if (!layout.zones.some((z) => z.id === 'LOB')) return;
  const bell = layout.points?.bell;
  let chair = 0;
  for (const f of layout.furniture) {
    if (f.zone !== 'LOB') continue;
    const p = poseOf(f);
    const [w, h, d] = f.size;
    switch (f.type) {
      case 'counter': { // the Help Desk (signature)
        const bellX = bell ? (bell.x - p.x) * Math.cos(p.yaw) - (bell.z - p.z) * Math.sin(p.yaw) : -0.65; // world → prop-local x
        k.put('helpDesk', { w, h, d, bellX }, p, f.id, 0.3);
        break;
      }
      case 'beacon': k.put('serviceLight', {}, p, f.id, 0); break;
      case 'mat':
        if (f.color === 'staff') k.put('rug', { kind: 'rect', w, d, fringe: false, colors: { body: '#56625F', secondary: '#3E4643', accent: T.butter } }, p, f.id, 0);
        else k.put('rug', { kind: 'rect', w, d, fringe: false, colors: { body: '#7D6C57', secondary: '#4F4036', accent: '#B8A27E' } }, p, f.id, 0); // coir entrance mat
        break;
      case 'planter': k.put('planter', { w, h, d, colors: { body: T.tealDeep, accent: T.trim } }, p, f.id, 0.2); break;
      case 'flowerBox': k.put('planter', { w: d, h, d: w, colors: { body: T.tealDeep, accent: T.trim } }, { ...p, yaw: PI / 2 }, f.id, 0.2); break;
      case 'coffeeCart': {
        k.put('coffeeCart', { w, d }, p, f.id, 0.25);
        k.put('menuBoard', {}, W(25.95, 22.45, 0, 0.35), 'lobMenu', 0.12);
        k.put('bin', { colors: { body: T.oat } }, W(26.2, 21.55), 'lobCartBin', 0);
        break;
      }
      case 'fishTank': k.put('fishTank', { w, d }, p, f.id, 0.25); break;
      case 'bench': {
        k.put('bench', { w, d, h }, p, f.id, 0.2);
        k.put('cushion', { w: 0.34, h: 0.28, colors: { body: SLATE_TEAL } }, { ...local(p, -w * 0.3, h, -0.1, 0.15), rx: -0.3 }, `${f.id}:c`, 0);
        k.put('bookStack', { n: 1 }, local(p, w * 0.22, h, 0.02, 0.6), `${f.id}:paper`, 0);
        k.put('tote', { out: 'book', colors: { body: '#B9C4B0' } }, { ...local(p, w * 0.42, 0, 0.3, 0.3), rx: -0.1 }, `${f.id}:tote`, 0);
        break;
      }
      case 'armchair': k.put('armchair', { colors: { body: chair++ ? SLATE_TEAL : T.lavender } }, p, f.id, 0.25); break;
      case 'coffeeTable': {
        k.put('table', { kind: 'coffee', w, d, h }, p, f.id, 0.2);
        k.put('bookStack', { n: 3 }, local(p, -0.22, h, 0.05, 0.3), `${f.id}:mags`, 0);
        k.put('mug', { colors: { body: T.teal } }, local(p, 0.12, h, 0.12, 1), `${f.id}:mug`, 0);
        k.put('plant', { kind: 'succulent' }, local(p, 0.3, h, -0.12), `${f.id}:succ`, 0);
        break;
      }
      case 'plant': // plant2 is "the lobby fig" Ada waters (ambient/ada.ts: the plant nearest her post)
        if (p.x < 0) k.put('plant', { kind: 'tree', h: 1.75 }, p, f.id, 0.25);
        else k.put('plant', { kind: 'monstera', h: 1.3 }, p, f.id, 0.22);
        break;
      default: break; // ramColumn: STAT; lampPost: the lamp anchors; rug + medallion: below
    }
  }
  // [LVL fix m175 r2, cross-owner: LVL] the lobby rug + medallion are `kit` layout items (greybox skips them).
  // [ENV fix m2 r2] review m2 r2: the spawn / lobbyDesk foregrounds were ~35% bare planks plus one oversized rug. The
  // rug item is now drawn as a cool sage-teal runner from the entrance mat up the spine (a leading line from the
  // spawn, complementary staging under walking Clawds), and the medallion as an inlaid brass-ringed compass rose at its
  // head; same layout items, same flat (non-blocking) footprint class
  for (const f of layout.furniture) {
    if (!f.kit || f.zone !== 'LOB') continue;
    const p = poseOf(f);
    if (f.type === 'rug') {
      const z0 = p.z + 0.85, z1 = 13.0; // from past the inlay to the entrance mat
      k.put('rug', { kind: 'runner', w: 1.15, d: z1 - z0, colors: { body: '#5B7A74', secondary: '#3F5652', accent: T.trim } } /* [ENV fix m2 r3] fringed, soft edge (new rug) */, { x: p.x, y: 0, z: (z0 + z1) / 2, yaw: 0 }, f.id, 0.1);
    } else if (f.type === 'medallion') k.put('floorInlay', { r: 0.78 }, { ...p, y: p.y + 0.001 }, f.id, 0);
  }
  // [ENV fix m2 r2] lower-right third of the spawn / lobbyDesk frames: a slatted bench against a flower trough,
  // facing the entrance (a place to sit and watch the queue)
  k.put('planter', { w: 1.5, h: 0.5, d: 0.42, colors: { body: T.tealDeep, accent: T.trim } }, W(22.05, 23.52, 0, 0), 'lobBenchTrough', 0.2);
  k.put('bench', { w: 1.3, d: 0.42, h: 0.44 }, W(22.05, 23.98, 0, 0), 'lobSpineBench', 0.2);

  // ---- spawn foreground ([ENV fix r1]): the planter cluster just off the spine, a tote, a dropped book
  k.put('plant', { kind: 'bush', h: 0.72, flowers: true }, W(18.0, 25.3, 0, 0.4), 'lobPlantA', 0.22);
  k.put('plant', { kind: 'cactus', h: 0.52 }, W(18.35, 24.75, 0, 1.2), 'lobPlantB', 0.2);
  k.put('plant', { kind: 'fern', h: 0.45 }, W(18.88, 25.05, 0, 2.2), 'lobPlantC', 0.18);
  k.put('tote', { out: 'bread', colors: { body: T.linen } }, { ...W(18.45, 25.6, 0, 2.5), rx: -0.12 }, 'lobTote', 0);
  k.put('bookStack', { n: 1 }, W(19.05, 25.62, 0, 0.9), 'lobBook', 0);

  // [ENV M3.5] the hiring / arrivals crate spot (HIRE_CRATE): pad + ARRIVALS post sign (front toward spawn / lobbyDesk)
  {
    const fx = -Math.sin(HIRE_CRATE.yaw), fz = -Math.cos(HIRE_CRATE.yaw), front = Math.atan2(fx, fz); // kit yaw: local +z → front
    k.put('arrivalsPad', { w: HIRE_CRATE.size[0], d: HIRE_CRATE.size[1] }, { x: HIRE_CRATE.x, y: 0.001, z: HIRE_CRATE.z, yaw: front }, 'lobArrivalsPad', 0);
    const px = fz, pz = -fx; // perpendicular (the viewer's right)
    k.put('arrivalsSign', {}, { x: HIRE_CRATE.x - 0.45 * fx - 0.5 * px, y: 0, z: HIRE_CRATE.z - 0.45 * fz - 0.5 * pz, yaw: front + 0.25 }, 'lobArrivalsSign', 0.12);
  }

  // a small planter between the RAM column and the east opening (on the z21 line, see-through height)
  k.put('planter', { w: 0.7, h: 0.42, d: 0.4, colors: { body: T.tealDeep, accent: T.trim } }, W(24.05, 21.2), 'lobPlanterE', 0.18);

  // ---- waiting nook (SW): rug under the wingbacks, radiator under the window, letter-board directory, a print
  k.put('rug', { kind: 'rect', w: 2.7, d: 1.25, colors: { body: '#6C8581', secondary: '#4B605D', accent: T.butter } }, W(16.4, 27.2), 'lobNookRug', 0.1);
  k.put('radiator', { w: 1.1, h: 0.42 }, W(16.4, 27.86, 0, PI), 'lobRadiatorW', 0);
  k.put('letterBoard', { w: 0.8, h: 0.62 }, W(14.1, 27.15, 1.55, PI / 2), 'lobDirectory', 0);
  k.put('poster', { w: 0.7, h: 0.9, style: 0 }, W(14.1, 24.35, 2.25, PI / 2), 'lobPrintW', 0);

  // ---- entrance: sconces either side of the doors, coat rack + umbrella stand, guest-book podium
  const sconces: [number, string][] = [[18.55, 'W'], [22.45, 'E']];
  for (const [x, s] of sconces) k.put('wallSconce', {}, { ...W(x, 27.9, 1.95, PI), s: 1.45 }, `lobSconce${s}`, 0);
  k.put('coatRack', {}, W(18.55, 27.55, 0, 0.6), 'lobCoatRack', 0.15);
  k.put('coatRack', { kind: 'umbrella' }, W(22.45, 27.62, 0, 2.2), 'lobUmbrellas', 0.12);
  k.put('podium', {}, W(18.75, 26.0, 0, PI / 2 + 0.25), 'lobPodium', 0.15);

  // ---- SE: the verdigris Clawd statue (waving at the door), Dusty the roomba's dock, prints on the east wall
  k.put('clawdStatue', {}, W(24.9, 25.95, 0, -1.9), 'lobStatue', 0.3);
  k.put('roombaDock', {}, W(27.35, 26.1, 0, 0), 'lobRoombaDock', 0);
  k.put('poster', { w: 0.6, h: 0.8, style: 2 }, W(27.9, 22.55, 1.65, -PI / 2), 'lobPrintE', 0);
  k.put('poster', { w: 0.5, h: 0.62, style: 1 }, W(27.9, 27.0, 1.7, -PI / 2), 'lobPrintSE', 0);
  k.put('plant', { kind: 'fern', h: 0.5 }, W(22.55, 26.9, 0, hash01(3, 1) * 6), 'lobFernSE', 0.15);

  // lamp fixtures on the lamp anchors of the Lobby (pendants + the nook's floor lamp)
  lampFixtures(layout, k, new Set(['LOB']));
}
