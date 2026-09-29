/**
 * West bays W1–W3 (§7.1 BAY, §7.2 amenity bays), dressed to the E2 hero standard: the shared E-bay desk kit
 * (bays.ts: desks, monitors, chairs, story props, pod rug, radiators under the storefront display windows, pendants)
 * plus each bay's amenity dressing, which is what the street sees through the storefront while the bay is idle:
 * - W1 Music Room — signature: a teal upright piano with its bench; guitar on a stand, record console + sleeve crate,
 *   amp, acoustic hex panels, a hanging pothos, a lamp pool corner.
 * - W2 Gym — signature: the treadmill; dumbbell rack + kettlebell, yoga mats, exercise ball, wall mirror, band pegboard,
 *   water cooler, trophies in the display window.
 * - W3 Greenhouse — signature: the sun lamp (a dish grow-light with a glowing bulb ring); raised veg beds with a
 *   bean-pole wigwam, potting bench, trellis vine, hanging pothos, watering can, plants on every sill.
 * Pod rugs per bay stay cool (complementary staging, §5.5). Nothing sits on a slot, in a door apron or on the chair
 * aisles; wall items carry no floor AO. Owner: ENV.
 */
import { poseOf, W } from './common.ts';
import type { DressKit } from './common.ts';
import type { HqLayout } from '../../layout/schema.ts';
import { dressBays } from './bays.ts';
import type { BayExtra } from './bays.ts';
import type { Colors } from '../kit/core.ts';
import type { DeskScreen } from './common.ts';
import { T } from '../kit/tokens.ts';

const PI = Math.PI;
/** Pod rug per bay (cool, low chroma; §5.5 hue gap): dusk indigo, sage-teal, moss-teal. */
const RUGS: Record<string, Colors> = {
  W1: { body: '#5F6B85', secondary: '#737F98', accent: '#A9B1C2' },
  W2: { body: '#5C786E', secondary: '#708C82', accent: '#A3B8AF' },
  W3: { body: '#5D7867', secondary: '#728C7B', accent: '#A8BBA9' },
};

/**
 * Extras per bay, plan coords [name, params, [px, pz, y, yaw]]. West wall face x 0.12 (windows z 3.5–6.5 / 10–13 /
 * 16.5–19.5, sill 0.9), street wall face x 4.88 (display windows, sill 0.55), bay walls z 2.12 / 7.88 etc.
 */
const EXTRAS: Record<string, BayExtra[]> = {
  W1: [
    ['acousticPanels', { n: 5 }, [2.6, 2.12, 1.72, 0]],
    ['acousticPanels', { n: 3, cols: [T.lavender, T.tealDeep, T.teal] }, [1.4, 7.88, 1.72, PI]],
    ['amp', {}, [2.62, 7.62, 0, PI]],
    ['vinylWall', { n: 3 }, [3.45, 7.88, 1.62, PI]],
    ['lamp', { kind: 'floor', bulbY: 1.35 }, [0.35, 7.55, 0, 0]],
    ['poster', { w: 0.5, h: 0.62, style: 2 }, [0.12, 2.85, 1.9, PI / 2]],
    ['poster', { w: 0.42, h: 0.55, style: 0 }, [0.12, 7.2, 1.85, PI / 2]],
    ['plant', { kind: 'pothos', drop: 0.5 }, [0.55, 3.2, 1.95, 0]],
    ['rug', { kind: 'round', r: 0.55, colors: { body: '#6E6A8E', secondary: '#55536F', accent: '#D8CBB4' } }, [4.3, 2.55, 0.002, 0]],
    ['plant', { kind: 'cactus', h: 0.3 }, [4.72, 3.0, 0.56, 0]],
    ['bookStack', { n: 2 }, [4.72, 3.7, 0.56, 0.3]],
    ['cushion', { w: 0.3, h: 0.28, colors: { body: T.lavender } }, [4.66, 2.28, 0, -2.2]],
  ],
  W2: [
    ['mirror', { w: 1.5, h: 1.0 }, [1.75, 14.88, 1.2, PI]],
    ['climbWall', { w: 1.1, h: 1.35, y0: 1.05 }, [0.12, 8.95, 0, PI / 2]],
    ['climbWall', { w: 1.1, h: 1.9, y0: 0.35 }, [0.12, 13.95, 0, PI / 2]],
    ['gymRings', { drop: 0.72 }, [2.1, 13.75, 2.8, 0]],
    ['pegboard', { kind: 'gym', w: 0.9, h: 0.55 }, [3.9, 8.12, 1.45, 0]],
    ['gymBall', { colors: { body: T.teal } }, [0.38, 13.55, 0, 0]],
    ['gymBall', { r: 0.2, colors: { body: T.lavender } }, [3.05, 14.55, 0, 0]],
    ['waterCooler', {}, [4.62, 9.2, 0, -PI / 2]],
    ['poster', { w: 0.8, h: 0.5, style: 1 }, [2.45, 8.12, 1.85, 0]],
    ['trophy', {}, [4.72, 13.3, 0.56, -PI / 2]], ['trophy', { s: 0.8 }, [4.72, 13.75, 0.56, -PI / 2]],
    ['trophy', { s: 1.2 }, [4.72, 9.0, 0.56, -PI / 2]],
    ['rug', { kind: 'round', r: 0.55, colors: { body: '#5E7C86', secondary: '#4A626B', accent: '#D8CBB4' } }, [4.3, 14.4, 0.002, 0]],
    ['box', { w: 0.36, h: 0.2, d: 0.3 }, [0.35, 9.25, 0, 0.2]],
  ],
  W3: [
    ['trellis', { w: 1.1, h: 1.5 }, [1.75, 15.12, 0.05, 0]],
    ['pottingBench', { w: 0.85 }, [4.47, 20.64, 0, PI]],
    ['wateringCan', {}, [2.36, 20.72, 0, 2.2]],
    ['plant', { kind: 'fern', h: 0.7 }, [0.32, 20.62, 0, 0]],
    ['plant', { kind: 'monstera', h: 1.1 }, [4.62, 16.25, 0, 0]],
    ['plant', { kind: 'pothos', drop: 0.55 }, [1.0, 18.9, 1.95, 0]],
    ['plant', { kind: 'pothos', drop: 0.5 }, [3.9, 16.0, 1.95, 0]],
    ['plant', { kind: 'pothos', drop: 0.45 }, [0.75, 16.1, 2.0, 1.1]],
    ['plant', { kind: 'pothos', drop: 0.5 }, [4.4, 19.9, 1.95, 2.0]],
    ['plant', { kind: 'succulent' }, [4.72, 15.7, 0.56, 0]], ['plant', { kind: 'cactus', h: 0.32 }, [4.72, 16.2, 0.56, 0]],
    ['plant', { kind: 'succulent' }, [4.72, 19.7, 0.56, 0]], ['plant', { kind: 'bush', h: 0.35, flowers: true }, [4.72, 20.25, 0.56, 0]],
    ['plant', { kind: 'succulent' }, [0.3, 16.9, 0.9, 0]], ['plant', { kind: 'cactus', h: 0.3 }, [0.3, 17.6, 0.9, 0]], ['plant', { kind: 'bush', h: 0.36, flowers: true }, [0.3, 18.8, 0.9, 0]],
    ['rug', { kind: 'round', r: 0.55, colors: { body: '#5E7C86', secondary: '#4A626B', accent: '#D8CBB4' } }, [4.35, 15.5, 0.002, 0]],
  ],
};

/**
 * [ENV fix m2 r1] The amenity SET that replaces the desk pods while a W bay is unallocated (§7.2; review m2 r1: the
 * bays read as dead offices through the street glass). Everything stands inside the desk pods' solid footprints
 * (x 1.87–3.13, the two pod rows), so the nav grid (desks stay solid in the layout) walks round it either way; rugs are
 * flat. Plan coords [name, params, [px, pz, y, yaw]]. Desk pods: W1 z 2.8–5.0 / 5.8–6.9, W2 +6.5, W3 +13.
 */
const H = Math.PI / 2;
const SETS: Record<string, BayExtra[]> = {
  W1: [ // Music Room: drum kit on a round rug facing the street, a synth on its X-stand, mic + music stands, a lamp
    ['rug', { kind: 'round', r: 1.05, colors: { body: '#5B5F86', secondary: '#474A6B', accent: '#D8CBB4' } }, [2.5, 3.9, 0.003, 0]],
    ['drumKit', {}, [2.45, 3.75, 0, H]],
    ['micStand', {}, [2.95, 4.75, 0, H + 0.4]],
    ['musicStand', {}, [2.1, 4.8, 0, H - 0.3]],
    ['rug', { kind: 'rect', w: 0.9, d: 1.5, fringe: true, colors: { body: '#4F6F74', secondary: '#3E575B', accent: '#C9BFAE' } }, [2.5, 6.35, 0.003, 0]],
    ['synthStand', {}, [2.5, 6.35, 0, H]],
  ],
  W2: [ // Gym: rubber floor, weight bench + barbell rack, heavy bag, mat stack, kettlebells
    ['rug', { kind: 'rect', w: 1.5, d: 4.3, fringe: false, colors: { body: '#3F4A52', secondary: '#35403F', accent: '#8FA9A1' } }, [2.5, 11.35, 0.003, 0]],
    ['weightBench', {}, [2.5, 10.35, 0, H]],
    ['punchBag', { top: 2.8 }, [2.78, 12.85, 0, 0]],
    ['gymMatStack', {}, [2.08, 12.62, 0, H]],
    ['kettlebells', {}, [2.85, 13.32, 0, 0]],
  ],
  W3: [ // Greenhouse: two seedling tables under grow bars, a ladder plant stand, a jute runner, crates of pots
    ['rug', { kind: 'runner', w: 1.1, d: 4.2, fringe: true, colors: { body: '#8A7F63', secondary: '#6E654E', accent: '#C9BFAE' } }, [2.5, 17.85, 0.003, 0]],
    ['seedlingTable', { w: 1.1, top: 2.8 }, [2.5, 16.4, 0, H]],
    ['seedlingTable', { w: 1.05, top: 2.8 }, [2.5, 17.55, 0, H]],
    ['plantStand', { w: 0.8 }, [2.5, 19.35, 0, H]],
    ['plant', { kind: 'fern', h: 0.55 }, [2.05, 19.85, 0, 0]],
  ],
};

export function dressWestBays(layout: HqLayout, k: DressKit): { screens: DeskScreen[] } {
  const bays = ['W1', 'W2', 'W3'].filter((id) => layout.bays.some((b) => b.id === id));
  if (!bays.length) return { screens: [] };
  const DESK_SET = new Set(['desk', 'chair', 'podRug']);
  const { screens } = dressBays(layout, k, bays, { seed0: 23, extras: EXTRAS, rugOf: (z) => (z ? RUGS[z] : undefined), swapOf: (f) => (DESK_SET.has(f.type) ? `desk:${f.zone}` : null) });
  for (const b of bays) {
    k.swap = `amen:${b}`;
    for (const [name, params, [px, pz, y, yaw]] of SETS[b] ?? []) k.put(name, params, W(px, pz, y, yaw), `${b}:set:${name}:${px},${pz}`, name === 'rug' ? 0 : 0.2);
    k.swap = null;
  }
  const set = new Set(bays);
  // the amenity furniture of the layout (LVL ids = its solid footprint; bays.ts only knows the E-bay amenity types)
  for (const f of layout.furniture) {
    if (!f.zone || !set.has(f.zone)) continue;
    const p = poseOf(f);
    const [w, h, d] = f.size;
    switch (f.type) {
      case 'piano': k.put('piano', { w, h, d }, p, f.id, 0.3); break;
      case 'recordPlayer': k.put('recordPlayer', { w, d }, p, f.id, 0.22); break;
      case 'guitar': k.put('guitar', {}, p, f.id, 0.12); break;
      case 'treadmill': k.put('treadmill', { w, d }, p, f.id, 0.25); break;
      case 'dumbbells': k.put('dumbbells', { w, d }, p, f.id, 0.22); break;
      case 'yogaMat': k.put('yogaMat', { w, d, colors: { body: f.id.endsWith('0') ? T.lavender : T.sage } }, p, f.id, 0); break;
      case 'planterBox': k.put('raisedBed', { w, h, d, wigwam: w > 1.5 }, p, f.id, 0.25); break;
      case 'sunLamp': k.put('sunLamp', { h: 1.5 }, { ...p, yaw: -0.75 }, f.id, 0.15); break;
      case 'hangingPlant': k.put('plant', { kind: 'pothos', drop: Math.max(0.3, 2.75 - f.pos.y - 0.2) }, p, f.id, 0); break;
      default: break;
    }
  }
  return { screens };
}

