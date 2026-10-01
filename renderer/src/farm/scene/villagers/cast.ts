// @pure
/**
 * THE VILLAGER CAST FILE. The persistent townsfolk of Claude Valley as plain data: who they are, how they look, where
 * they work, eat, unwind and sleep, and which part of the valley's UI they are a shortcut to. Edit here, reload.
 *
 * Villagers are Clawds like the Claude farmers (the mascot is sacred), but never agents: each wears a body colour no
 * agent kind uses (KIND_COLORS), a role hat instead of a tier hat, one piece of role wear, and a role sign for a
 * nameplate. They are presentation-only: not in ValleyState, not in the roster, the needs-you strip or the mailbox.
 *
 * Places are structure-relative (`at` + local offset, `face` = local yaw, 0 = the structure's own front) so they follow
 * the map; the system nudges each one onto free ground at load.
 */
import type { StructureId } from '../../world/map.ts';
import type { Act } from '../farmers/pose.ts';
import type { RoleHatName, WearName } from '../farmers/mascots.ts';
import type { Look } from '../farmers/look.ts';

/** What talking to the villager opens (UiPort), or 'say' for a spoken report only. */
export type VillagerFn = 'mailbox' | 'roster' | 'stats' | 'noticeboard' | 'map' | 'say';
export type Role = 'postmaster' | 'clerk' | 'miller' | 'mayor' | 'ranger' | 'weather';

/** A beat of a place's loop: act for min..max seconds (`p` = chance it plays when its turn comes). */
export interface Beat { act: Act; min: number; max: number; p?: number }

export interface Place {
  at: StructureId | 'xz';
  /** local offset (metres, structure frame: +z = its front) or world x / z when `at` is 'xz' */
  x: number;
  z: number;
  /** facing: local yaw (0 = the structure's front direction), or world yaw for 'xz'; 'toward' faces the structure */
  face: number | 'toward';
  loop: readonly Beat[];
  /** may wander off to chat with an idle farmer or pet Biscuit / Mochi from here */
  social?: boolean;
  /** going here means going indoors: fade out at the door, lights out */
  indoors?: boolean;
  /** walk at a stroll */
  amble?: boolean;
  /** a waypoint to pass first (local, like x / z): the porch steps, so nobody walks through the rail */
  via?: { x: number; z: number };
}

export type Slot = 'post' | 'lunch' | 'evening' | 'home' | 'round';
/** A day plan entry: from this hour (local, 0..24) the villager heads to `slot`. Cyclic across midnight. */
export interface DayEntry { from: number; slot: Slot }

export interface Villager {
  id: string;
  name: string;
  role: Role;
  /** "Postmaster" — the nameplate's second line */
  title: string;
  /** map pin glyph */
  glyph: string;
  /** body colour (and its darker shade), eye glyph colour */
  color: number;
  dark: number;
  glyph3d: number;
  scarf: number;
  hat: RoleHatName;
  hatColor: number;
  hatBand: number;
  wear: WearName;
  wearColor: number;
  wearTrim: number;
  /** personality: gait tempo (1.75..2.2 like farmers), bounce, voice seed */
  tempo: number;
  bounce: number;
  fn: VillagerFn;
  /** prompt verb for E ('Talk to') and the F alternative ('Chat with') */
  verb: string;
  day: readonly DayEntry[];
  places: Readonly<Record<Exclude<Slot, 'round'>, Place>> & { shelter: Place; round?: readonly Place[] };
}

/** eye glyphs: the farmers' near-black, so faces read on every body colour */
const EYE = 0x1c1614;
const STAND: Beat = { act: 'stand', min: 6, max: 12 };

export const CAST: readonly Villager[] = [
  {
    id: 'villager:posy', name: 'Posy', role: 'postmaster', title: 'Postmaster', glyph: '✉',
    color: 0x3d9fa8, dark: 0x2b7d86, glyph3d: EYE, scarf: 0xd9453b,
    hat: 'postcap', hatColor: 0x2f3f6e, hatBand: 0x1f2a48, wear: 'satchel', wearColor: 0x9a6438, wearTrim: 0x6a4224,
    tempo: 2.05, bounce: 1.05, fn: 'mailbox', verb: 'Talk to',
    day: [{ from: 6.5, slot: 'post' }, { from: 12, slot: 'lunch' }, { from: 13, slot: 'post' }, { from: 18.5, slot: 'evening' }, { from: 22, slot: 'home' }],
    places: {
      post: { at: 'mailbox', x: 1.45, z: 0.45, face: 0, loop: [STAND, { act: 'read', min: 7, max: 12 }, { act: 'lean', min: 5, max: 9, p: 0.6 }, { act: 'sweep', min: 6, max: 9, p: 0.35 }] },
      lunch: { at: 'picnic', x: -3.6, z: 3.4, face: 'toward', loop: [{ act: 'sitground', min: 14, max: 26 }, { act: 'stretch', min: 3, max: 4, p: 0.5 }], social: true, amble: true },
      evening: { at: 'farmhouse', x: 4.6, z: 6.4, face: 0, loop: [STAND, { act: 'lean', min: 8, max: 14 }, { act: 'read', min: 6, max: 10, p: 0.5 }], social: true },
      home: { at: 'farmhouse', x: 0.6, z: 5.65, via: { x: 0, z: 7.6 }, face: 'toward', loop: [STAND], indoors: true },
      shelter: { at: 'farmhouse', x: 0.6, z: 5.65, face: 'toward', via: { x: 0, z: 7.6 }, loop: [STAND], indoors: true },
    },
  },
  {
    id: 'villager:bram', name: 'Bram', role: 'clerk', title: 'Shipping clerk', glyph: '▣',
    color: 0xe6c547, dark: 0xbf9e2c, glyph3d: EYE, scarf: 0x3f6e9a,
    hat: 'eyeshade', hatColor: 0x6fcf92, hatBand: 0x6a4a32, wear: 'apron', wearColor: 0xe9dcc0, wearTrim: 0x8a6a48,
    tempo: 1.85, bounce: 0.85, fn: 'roster', verb: 'Talk to',
    day: [{ from: 7, slot: 'post' }, { from: 12.5, slot: 'lunch' }, { from: 13.5, slot: 'post' }, { from: 18, slot: 'evening' }, { from: 21.5, slot: 'home' }],
    places: {
      post: { at: 'shippingBin', x: -2.0, z: 0.7, face: 0.25, loop: [STAND, { act: 'read', min: 6, max: 10 }, { act: 'inspect', min: 5, max: 8, p: 0.5 }, { act: 'sweep', min: 5, max: 8, p: 0.4 }] },
      lunch: { at: 'pergola', x: 0.4, z: 4.4, face: 'toward', loop: [{ act: 'gaze', min: 10, max: 18 }, { act: 'lean', min: 6, max: 10 }, { act: 'chat', min: 6, max: 9, p: 0.5 }], social: true, amble: true },
      evening: { at: 'campfire', x: -2.4, z: -4.6, face: 'toward', loop: [{ act: 'sitground', min: 16, max: 30 }, { act: 'stretch', min: 3, max: 4, p: 0.4 }], social: true, amble: true },
      home: { at: 'toolshed', x: 0, z: 2.6, face: 'toward', loop: [STAND], indoors: true },
      shelter: { at: 'barn', x: 1.2, z: 6.2, face: 'toward', loop: [STAND], indoors: true },
    },
  },
  {
    id: 'villager:hazel', name: 'Hazel', role: 'miller', title: 'Miller', glyph: '✣',
    color: 0xd9c08a, dark: 0xb39a66, glyph3d: EYE, scarf: 0x8a5a3a,
    hat: 'millcap', hatColor: 0xf1ece0, hatBand: 0xd8cdb8, wear: 'smock', wearColor: 0xf1ece2, wearTrim: 0xc9b89a,
    tempo: 1.8, bounce: 0.9, fn: 'stats', verb: 'Talk to',
    day: [{ from: 6, slot: 'post' }, { from: 11.75, slot: 'lunch' }, { from: 12.75, slot: 'post' }, { from: 18, slot: 'evening' }, { from: 21, slot: 'home' }],
    places: {
      post: { at: 'windmill', x: 2.2, z: 5.6, face: 0.35, loop: [STAND, { act: 'sweep', min: 7, max: 11 }, { act: 'inspect', min: 5, max: 8, p: 0.6 }, { act: 'stretch', min: 3, max: 4, p: 0.3 }] },
      lunch: { at: 'well', x: -2.6, z: 1.6, face: 'toward', loop: [{ act: 'sitground', min: 14, max: 24 }, STAND], social: true },
      evening: { at: 'windmill', x: -2.4, z: 5.2, face: 0, loop: [{ act: 'sitground', min: 14, max: 24 }, { act: 'gaze', min: 6, max: 10 }] },
      home: { at: 'windmill', x: 0, z: 4.6, face: 'toward', loop: [STAND], indoors: true },
      shelter: { at: 'windmill', x: 0.5, z: 4.6, face: 'toward', loop: [STAND], indoors: true },
    },
  },
  {
    id: 'villager:marigold', name: 'Mayor Marigold', role: 'mayor', title: 'Mayor', glyph: '★',
    color: 0x9b5a8c, dark: 0x7a4470, glyph3d: EYE, scarf: 0xf0c860,
    hat: 'tophat', hatColor: 0x2a2530, hatBand: 0xc23b5a, wear: 'sash', wearColor: 0xc8384a, wearTrim: 0xf0c860,
    tempo: 1.75, bounce: 0.8, fn: 'noticeboard', verb: 'Talk to',
    day: [{ from: 8, slot: 'post' }, { from: 12.25, slot: 'lunch' }, { from: 13.75, slot: 'post' }, { from: 17.5, slot: 'evening' }, { from: 22.5, slot: 'home' }],
    places: {
      post: { at: 'noticeboard', x: 2.2, z: 1.9, face: 0.3, loop: [STAND, { act: 'talk', min: 5, max: 8 }, { act: 'board', min: 6, max: 10, p: 0.6 }, { act: 'wave', min: 2, max: 3, p: 0.3 }] },
      lunch: { at: 'xz', x: -4.5, z: 7.5, face: Math.PI, loop: [{ act: 'gaze', min: 8, max: 14 }, { act: 'talk', min: 4, max: 6, p: 0.4 }], social: true, amble: true },
      evening: { at: 'pergola', x: -1.4, z: 4.6, face: 'toward', loop: [{ act: 'gaze', min: 8, max: 14 }, { act: 'chat', min: 5, max: 8 }, STAND], social: true, amble: true },
      home: { at: 'farmhouse', x: -0.6, z: 5.65, via: { x: 0, z: 7.6 }, face: 'toward', loop: [STAND], indoors: true },
      shelter: { at: 'farmhouse', x: -0.6, z: 5.65, face: 'toward', via: { x: 0, z: 7.6 }, loop: [STAND], indoors: true },
    },
  },
  {
    id: 'villager:fern', name: 'Fern', role: 'ranger', title: 'Ranger', glyph: '⌖',
    color: 0x5d8f45, dark: 0x46702f, glyph3d: EYE, scarf: 0xe0a030,
    hat: 'ranger', hatColor: 0xb89a62, hatBand: 0x6a4a32, wear: 'pack', wearColor: 0x8a7a48, wearTrim: 0x5a4a2a,
    tempo: 2.15, bounce: 1.1, fn: 'map', verb: 'Talk to',
    day: [{ from: 6.5, slot: 'post' }, { from: 9, slot: 'round' }, { from: 11.5, slot: 'post' }, { from: 12.5, slot: 'lunch' }, { from: 13.5, slot: 'round' }, { from: 16, slot: 'post' }, { from: 19, slot: 'evening' }, { from: 23.5, slot: 'home' }],
    places: {
      post: { at: 'signpost', x: 1.4, z: 1.2, face: 0.2, loop: [STAND, { act: 'almanac', min: 6, max: 10 }, { act: 'wave', min: 2, max: 3, p: 0.3 }, { act: 'gaze', min: 5, max: 8, p: 0.5 }] },
      lunch: { at: 'campfire', x: 2.6, z: 4.4, face: 'toward', loop: [{ act: 'campfire', min: 16, max: 28 }], social: true },
      evening: { at: 'campfire', x: 2.6, z: 4.4, face: 'toward', loop: [{ act: 'campfire', min: 16, max: 28 }, { act: 'stretch', min: 3, max: 4, p: 0.3 }], social: true },
      // the ranger sleeps out under the stars by the fire
      home: { at: 'campfire', x: 3.4, z: 3.6, face: 'toward', loop: [{ act: 'nap', min: 60, max: 90 }] },
      shelter: { at: 'barn', x: -1.2, z: 6.2, face: 'toward', loop: [STAND], indoors: true },
      // rounds: the bridge, the pond's beach, the waterfall pool, back past the hot spring
      round: [
        { at: 'bridge', x: 0, z: -9.5, face: Math.PI, loop: [{ act: 'gaze', min: 8, max: 12 }, { act: 'almanac', min: 5, max: 7 }], amble: true },
        { at: 'xz', x: -33, z: -92, face: Math.PI, loop: [{ act: 'gaze', min: 8, max: 12 }], amble: true },
        { at: 'hotspring', x: 0, z: 5.6, face: 'toward', loop: [{ act: 'gaze', min: 6, max: 10 }], amble: true },
        { at: 'xz', x: 43.5, z: 55.6, face: Math.PI, loop: [{ act: 'gaze', min: 8, max: 12 }, { act: 'almanac', min: 5, max: 7 }], amble: true },
      ],
    },
  },
  {
    id: 'villager:nimbus', name: 'Nimbus', role: 'weather', title: 'Weather-watcher', glyph: '☂',
    color: 0x6fb7e0, dark: 0x4d93bd, glyph3d: EYE, scarf: 0xe8eef2,
    hat: 'souwester', hatColor: 0xf2c230, hatBand: 0xc89a10, wear: 'cape', wearColor: 0xf0c040, wearTrim: 0xb88a20,
    tempo: 1.9, bounce: 1.0, fn: 'say', verb: 'Talk to',
    // a night owl: up at the knoll after dark, asleep in the mill's loft all morning
    day: [{ from: 1.5, slot: 'home' }, { from: 10.5, slot: 'lunch' }, { from: 13, slot: 'round' }, { from: 16.5, slot: 'post' }, { from: 19, slot: 'evening' }],
    places: {
      post: { at: 'lookout', x: -2.2, z: 5.6, face: 0, loop: [STAND, { act: 'inspect', min: 5, max: 8 }, { act: 'almanac', min: 6, max: 9 }, { act: 'gaze', min: 6, max: 10 }] },
      lunch: { at: 'dock', x: -1.9, z: -4.6, face: 0, loop: [{ act: 'gaze', min: 10, max: 16 }, { act: 'almanac', min: 6, max: 9 }], social: true, amble: true },
      evening: { at: 'lookout', x: 2.4, z: 5.4, face: 0, loop: [{ act: 'gaze', min: 10, max: 16 }, { act: 'inspect', min: 5, max: 8 }, STAND] },
      home: { at: 'windmill', x: 0, z: 4.6, face: 'toward', loop: [STAND], indoors: true },
      shelter: { at: 'windmill', x: -0.5, z: 4.6, face: 'toward', loop: [STAND], indoors: true },
      round: [
        { at: 'xz', x: 14, z: -0.5, face: Math.PI / 2, loop: [{ act: 'gaze', min: 8, max: 14 }, { act: 'almanac', min: 5, max: 8 }], amble: true },
        { at: 'well', x: 2.6, z: 1.4, face: 'toward', loop: [{ act: 'inspect', min: 5, max: 8 }, STAND], amble: true },
      ],
    },
  },
];

export const villagerById = (id: string): Villager | undefined => CAST.find((v) => v.id === id);

/** A villager's look: a Clawd in its own colours, role hat and wear (never an agent kind colour). */
export function villagerLook(v: Villager): Look {
  return {
    kind: 'claude', body: 'clawd', color: v.color, dark: v.dark, glyph: v.glyph3d, star: false, scarf: v.scarf,
    hat: 'cap', hatColor: v.hatColor, hatBand: v.hatBand, tempo: v.tempo, bounce: v.bounce, fidget: 1, chatty: 0.6,
    blinkEvery: 3.2, doubleBlink: 0.2, scale: 1, likes: [], restless: 0,
    roleHat: v.hat, wear: v.wear, wearColor: v.wearColor, wearTrim: v.wearTrim,
  };
}
