/**
 * E-bay dressing (M1.75: E2 is the hero bay seen from the spawn; E1 / E3 share the same kit so the glazing reads as
 * one street of studios): desks with hung drawer units, status monitors (screens = the deskScreens InstancedMesh),
 * keyboards, swivel chairs, seeded desk story props (mugs, sticky notes, book stacks, succulents, a desk lamp), the
 * pod rug, pendants from the lamp anchors, the bay's amenity props (§7.2), radiators under the storefront display
 * windows, wall art and corner greenery. Owner: ENV.
 */
import { W, poseOf, local, hash01 } from './common.ts';
import type { DeskScreen, DressKit } from './common.ts';
import type { Furniture, HqLayout } from '../../layout/schema.ts';
import type { Colors, KitParams } from '../kit/core.ts';
import { lampFixtures } from './atrium.ts';
import { T, NOTES } from '../kit/tokens.ts';
import { DESK, deskLocal } from '../../layout/proto.ts';

/** Per-bay extras (plan coords): wall art, corners. Only spots clear of desks, amenity slots and door aprons. */
const EXTRAS: Record<string, BayExtra[]> = {
  // [ENV M2 breadth] E1 Game Room: dartboard + chalk scoreboard on the north wall, the print moved south, a round rug
  // under the game table, a floor arc lamp over the nap beanbag
  E1: [['dartboard', {}, [9.75, 2.12, 1.45, 0]], ['scoreboard', { w: 0.7, h: 0.5 }, [10.75, 2.12, 1.5, 0]], ['poster', { w: 0.7, h: 0.55, style: 1 }, [11.6, 7.88, 1.85, Math.PI]], ['coatRack', {}, [8.4, 7.62, 0, 0.6]], ['plant', { kind: 'fern', h: 0.8 }, [8.45, 2.45, 0, 0]],
    ['rug', { kind: 'round', r: 0.75, colors: { body: '#5B6F8A', secondary: '#46556B', accent: '#D8CBB4' } }, [10.3, 7.3, 0.002, 0]], ['lamp', { kind: 'floorArc' }, [9.55, 2.3, 0, -0.6]], ['poster', { w: 0.45, h: 0.55, style: 0 }, [8.12, 7.5, 1.9, Math.PI / 2]]],
  E2: [
    ['poster', { w: 0.95, h: 0.6, style: 0 }, [10.75, 8.12, 2.0, 0]], ['corkboard', { w: 0.9, h: 0.6 }, [9.35, 14.88, 0.95, Math.PI]],
    ['poster', { w: 0.5, h: 0.62, style: 2 }, [12.6, 14.88, 1.75, Math.PI]],
    ['waterCooler', {}, [13.6, 8.42, 0, -0.4]], ['coatRack', {}, [8.42, 8.45, 0, 0.8]],
    ['plant', { kind: 'fern', h: 1.0 }, [13.6, 14.52, 0, 0]], ['plant', { kind: 'bush', h: 0.95, flowers: true }, [8.5, 14.52, 0, 0]],
    ['bin', {}, [10.2, 13.9, 0, 0]], ['box', { w: 0.42, h: 0.28, d: 0.34 }, [13.55, 13.4, 0, 0.3]],
  ],
  // [ENV M2 breadth] E3 Nap Lounge: the moon lamp by the atrium glass (signature, glows after dark), a star string over
  // the south hammock, round rugs under the hammocks, a blanket basket, a sleepy cushion pile
  E3: [['poster', { w: 0.8, h: 0.55, style: 2 }, [12.1, 15.12, 1.9, 0]], ['starString', { len: 1.9 }, [9.25, 20.88, 1.95, Math.PI]], ['plant', { kind: 'bush', h: 0.9 }, [8.5, 20.5, 0, 0]], ['lamp', { kind: 'floorArc' }, [8.5, 15.45, 0, 0.9]],
    ['moonLamp', {}, [13.55, 20.5, 0, -0.5]], ['blanketBasket', {}, [8.9, 19.75, 0, 0.4]],
    ['rug', { kind: 'round', r: 0.8, colors: { body: '#6E6A8E', secondary: '#55536F', accent: '#D8CBB4' } }, [10.2, 15.5, 0.002, 0]], ['rug', { kind: 'round', r: 0.8, colors: { body: '#5E7C86', secondary: '#4A626B', accent: '#D8CBB4' } }, [10.2, 20.45, 0.002, 0]]],
};

/** Options of the W bays' reuse of the dresser. */
export interface BayOpts {
  /** first seeded desk story-prop index */
  seed0?: number;
  extras?: Record<string, BayExtra[]>;
  swapOf?: (f: Furniture) => string | null;
  rugOf?: (zone: string | null | undefined) => Colors | undefined;
}
/** [kit name, params, [plan px, pz, y, yaw]] */
export type BayExtra = [string, KitParams, [number, number, number, number]];
export function dressBays(layout: HqLayout, k: DressKit, bays = ['E1', 'E2', 'E3'], o: BayOpts = {}): { screens: DeskScreen[] } {
  const set = new Set(bays);
  const screens: DeskScreen[] = [];
  let di = o.seed0 ?? 0; // [ENV M2 breadth] o.seed0: W bays start their seeded desk story props elsewhere
  const extras = o.extras ?? EXTRAS;
  for (const f of layout.furniture) {
    if (!f.zone || !set.has(f.zone)) continue;
    const p = poseOf(f);
    const [w, h, d] = f.size;
    k.swap = o.swapOf?.(f) ?? null; // [ENV fix m2 r1] W bays: the desk set is a swappable draw group (index.ts)
    switch (f.type) {
      case 'desk': {
        const i = di++;
        const { m, agentX, monitor: mon } = deskLocal(f);
        k.put('desk', { w, d, h, m }, p, f.id, 0.22);
        const mp = local(p, mon.x, h, mon.z, mon.twist);
        const { item, m: mm } = k.put('monitor', { w: DESK.monitor.w, h: DESK.monitor.h, lift: DESK.monitor.lift }, mp, `${f.id}:mon`, 0);
        const a = item.anchors.screen;
        if (!a) throw new Error('monitor kit: no screen anchor');
        const sp = local(mp, a.x, a.y, a.z);
        screens.push({ p: sp, yaw: mp.yaw, rx: a.rx ?? 0, anchor: f.id });
        k.put('keyboard', {}, local(p, agentX + m * 0.06, h, 0.12, mon.twist * 0.4), `${f.id}:kb`, 0);
        // story props, seeded per desk (stable): mug by the keyboard, a note on the bezel, books / succulent / lamp
        const r = (q: number) => hash01(i + 1, q);
        if (r(1) > 0.3) k.put('mug', { colors: { body: [T.teal, T.trim, T.oat, T.lavender][Math.floor(r(2) * 4)] } }, local(p, m * 0.12, h, 0.12, r(3) * 6), `${f.id}:mug`, 0);
        // [ENV fix m2 r2] the note sticks to the bezel's OUTER EDGE (top-left or top-right, ~1.7 cm on the 2.5 cm side bezel, the rest hanging off the
        // side), never on the glass: the live screen (anchor, sw x sh) stays fully readable. Its origin (= back face) sits
        // on the tilted bezel face, rotated with the monitor body about its centre (0, lift, -0.005), so it no longer
        // floats a centimetre proud of the glass.
        if (r(4) > 0.35) {
          const t = a.rx ?? 0, side = r(6) > 0.5 ? 1 : -1, nx = side * (DESK.monitor.w / 2 + 0.018), ny = DESK.monitor.h / 2 - 0.035, nz = 0.025 + 0.0008;
          k.put('note', { colors: { body: NOTES[Math.floor(r(5) * NOTES.length)] } }, { ...local(mp, nx, DESK.monitor.lift + ny * Math.cos(t) - nz * Math.sin(t), -0.005 + ny * Math.sin(t) + nz * Math.cos(t)), rx: t }, `${f.id}:note`, 0);
        }
        if (r(7) > 0.55) k.put('bookStack', { n: 1 + Math.floor(r(8) * 3) }, local(p, m * 0.34, h, -0.12, r(9)), `${f.id}:books`, 0);
        else if (r(7) > 0.3) k.put('plant', { kind: 'succulent' }, local(p, m * 0.4, h, -0.18), `${f.id}:succ`, 0);
        if (r(10) > 0.7) k.put('lamp', { kind: 'desk' }, local(p, m * 0.44, h, -0.2, -m * 0.6), `${f.id}:lamp`, 0);
        break;
      }
      case 'chair': k.put('deskChair', { back: DESK.back, backTop: DESK.chairBack, colors: { body: [T.fabricTeal, '#6F8E7D', '#56727A'][di % 3] } }, p, f.id, 0.15); break;
      case 'podRug': k.put('rug', { kind: 'rect', w, d, fringe: false, colors: o.rugOf?.(f.zone) ?? { body: '#587A75', secondary: '#6C8D88', accent: '#9DB3AD' } }, p, f.id, 0); break;
      case 'easel': k.put('easel', { h }, p, f.id, 0.12); break;
      case 'gameTable': k.put('gameTable', { w, d, h }, p, f.id, 0.2); break;
      case 'shelf': k.put(f.zone === 'E1' ? 'gameShelf' : 'shelf', { w, h: Math.max(h, 1.0), d, top: true }, p, f.id, 0.25); break; // [ENV M2] E1 = board games
      case 'beanbag': k.put('beanbag', { colors: { body: [T.lavender, T.teal, T.butter][di % 3] } }, { ...p, yaw: hash01(di, 4) * 6 }, f.id, 0.2); break;
      case 'plant': k.put('plant', { kind: 'monstera', h: h * 1.05 }, p, f.id, 0.2); break;
      case 'hammock': k.put('hammock', { w, d }, p, f.id, 0.1); break;
      default: break;
    }
    k.swap = null;
  }
  // radiators under the storefront display windows (street wall, sill 0.55), facing into the bay ([ENV M2] W bays:
  // the x5 wall, facing west)
  for (const b of layout.bays.filter((q) => set.has(q.id))) {
    const [, z0, , z1] = b.rect.map((v, i) => v + (i % 2 ? 14 : 20.5));
    const c = b.storefront.z + 14, west = b.side === 'W';
    for (const [a, e] of [[z0 + 0.4, c - 1.4], [c + 1.4, z1 - 0.4]]) {
      if (e - a < 0.8) continue;
      k.put('radiator', { w: Math.min(1.1, e - a - 0.3), h: 0.3 }, W(west ? 4.8 : 8.2, (a + e) / 2, 0, west ? -Math.PI / 2 : Math.PI / 2), `${b.id}:rad${a.toFixed(1)}`, 0);
    }
    for (const [name, params, [px, pz, y, yaw]] of extras[b.id] ?? []) k.put(name, params, W(px, pz, y, yaw), `${b.id}:${name}:${px},${pz}`, y > 0.5 || name === 'rug' ? 0 : 0.2);
  }
  lampFixtures(layout, k, set);
  return { screens };
}
