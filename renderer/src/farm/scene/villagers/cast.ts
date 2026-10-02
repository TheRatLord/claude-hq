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
import type { PlaceKey } from '../../model/routines.ts';

/** What talking to the villager opens (UiPort), or 'say' for a spoken report only. */
export type VillagerFn = 'mailbox' | 'roster' | 'stats' | 'noticeboard' | 'map' | 'say';
export type Role = 'postmaster' | 'clerk' | 'miller' | 'mayor' | 'ranger' | 'weather';

/** A beat of a place's loop: act for min..max seconds (`p` = chance it plays when its turn comes). */
export interface Beat { act: Act; min: number; max: number; p?: number }

export interface Place {
  at: StructureId | ProjectAt | 'xz';
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

/** A Valley Project's site (world/projects.ts): local frame, +z its front */
export type ProjectAt = 'project:glasshouse' | 'project:millwheel' | 'project:observatory' | 'project:halt' | 'project:board';

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
  /** where they stand at each place their day takes them (model/routines.ts `planFor` says when; `shelter` in storms) */
  places: Readonly<Partial<Record<PlaceKey, Place>>> & { shelter: Place };
}

/** eye glyphs: the farmers' near-black, so faces read on every body colour */
const EYE = 0x1c1614;
const STAND: Beat = { act: 'stand', min: 6, max: 12 };

/** the festival centrepiece on the square's north-west quadrant (scene/structures/festivals.ts: PLAZA − (4.7, 4.4)) */
const FEST = { x: -4.7, z: -5.4 };
/** a spot `r` m from the festival centrepiece at bearing `a`, facing it */
const atFest = (a: number, loop: readonly Beat[], r = 3.4): Place => ({ at: 'xz', x: FEST.x + Math.sin(a) * r, z: FEST.z + Math.cos(a) * r, face: a + Math.PI, loop, social: true, amble: true });
const FEST_LOOP: readonly Beat[] = [{ act: 'gaze', min: 6, max: 10 }, { act: 'clap', min: 3, max: 5, p: 0.6 }, { act: 'chat', min: 5, max: 8 }, { act: 'laugh', min: 2, max: 3, p: 0.4 }];

export const CAST: readonly Villager[] = [
  {
    id: 'villager:posy', name: 'Posy', role: 'postmaster', title: 'Postmaster', glyph: '✉',
    color: 0x3d9fa8, dark: 0x2b7d86, glyph3d: EYE, scarf: 0xd9453b,
    hat: 'postcap', hatColor: 0x2f3f6e, hatBand: 0x1f2a48, wear: 'satchel', wearColor: 0x9a6438, wearTrim: 0x6a4224,
    tempo: 2.05, bounce: 1.05, fn: 'mailbox', verb: 'Talk to',
    places: {
      porch: { at: 'farmhouse', x: 1.9, z: 7.0, face: 0, loop: [STAND, { act: 'stretch', min: 3, max: 4 }, { act: 'sweep', min: 6, max: 9, p: 0.5 }, { act: 'gaze', min: 6, max: 10 }] },
      mailbox: { at: 'mailbox', x: 1.45, z: 0.45, face: 0, loop: [STAND, { act: 'read', min: 7, max: 12 }, { act: 'lean', min: 5, max: 9, p: 0.6 }, { act: 'pigeon', min: 6, max: 9, p: 0.3 }, { act: 'sweep', min: 6, max: 9, p: 0.35 }] },
      picnic: { at: 'picnic', x: -3.6, z: 3.4, face: 'toward', loop: [{ act: 'sitground', min: 14, max: 26 }, { act: 'stretch', min: 3, max: 4, p: 0.5 }], social: true, amble: true },
      pergola: { at: 'pergola', x: 1.8, z: 3.8, face: 'toward', loop: [{ act: 'read', min: 8, max: 14 }, { act: 'chat', min: 5, max: 8 }, STAND], social: true, amble: true },
      orchard: { at: 'orchard', x: -2.2, z: 6.8, face: 'toward', loop: [{ act: 'gaze', min: 8, max: 12 }, { act: 'inspect', min: 5, max: 8 }, STAND], amble: true },
      pond: { at: 'dock', x: 3.4, z: -3.2, face: 0, loop: [{ act: 'gaze', min: 8, max: 14 }, { act: 'clap', min: 2, max: 4, p: 0.5 }, STAND], social: true, amble: true },
      glasshouse: { at: 'project:glasshouse', x: 1.8, z: 3.4, face: 'toward', loop: [{ act: 'inspect', min: 6, max: 10 }, { act: 'water', min: 6, max: 9 }, { act: 'gaze', min: 5, max: 8 }], amble: true },
      festival: atFest(0.4, FEST_LOOP),
      yard: { at: 'farmhouse', x: 4.6, z: 6.4, face: 0, loop: [STAND, { act: 'lean', min: 8, max: 14 }, { act: 'read', min: 6, max: 10, p: 0.5 }], social: true },
      farmhouse: { at: 'farmhouse', x: 0.6, z: 5.65, via: { x: 0, z: 7.6 }, face: 'toward', loop: [STAND], indoors: true },
      shelter: { at: 'farmhouse', x: 0.6, z: 5.65, face: 'toward', via: { x: 0, z: 7.6 }, loop: [STAND], indoors: true },
    },
  },
  {
    id: 'villager:bram', name: 'Bram', role: 'clerk', title: 'Shipping clerk', glyph: '▣',
    color: 0xe6c547, dark: 0xbf9e2c, glyph3d: EYE, scarf: 0x3f6e9a,
    hat: 'eyeshade', hatColor: 0x6fcf92, hatBand: 0x6a4a32, wear: 'apron', wearColor: 0xe9dcc0, wearTrim: 0x8a6a48,
    tempo: 1.85, bounce: 0.85, fn: 'roster', verb: 'Talk to',
    places: {
      shedDoor: { at: 'toolshed', x: 1.3, z: 2.4, face: 0.4, loop: [{ act: 'sweep', min: 8, max: 12 }, STAND, { act: 'stretch', min: 3, max: 4, p: 0.5 }] },
      bin: { at: 'shippingBin', x: -2.0, z: 0.7, face: 0.25, loop: [STAND, { act: 'read', min: 6, max: 10 }, { act: 'inspect', min: 5, max: 8, p: 0.5 }, { act: 'sweep', min: 5, max: 8, p: 0.4 }] },
      pergola: { at: 'pergola', x: 0.4, z: 4.4, face: 'toward', loop: [{ act: 'gaze', min: 10, max: 18 }, { act: 'lean', min: 6, max: 10 }, { act: 'chat', min: 6, max: 9, p: 0.5 }], social: true, amble: true },
      bridge: { at: 'bridge', x: 1.3, z: 2.6, face: Math.PI / 2, loop: [{ act: 'fish', min: 20, max: 40 }, { act: 'reel', min: 4, max: 6, p: 0.5 }, { act: 'read', min: 6, max: 10, p: 0.4 }] },
      festival: atFest(1.6, FEST_LOOP),
      campfire: { at: 'campfire', x: -2.4, z: -4.6, face: 'toward', loop: [{ act: 'sitground', min: 16, max: 30 }, { act: 'stretch', min: 3, max: 4, p: 0.4 }], social: true, amble: true },
      toolshed: { at: 'toolshed', x: 0, z: 2.6, face: 'toward', loop: [STAND], indoors: true },
      shelter: { at: 'barn', x: 1.2, z: 6.2, face: 'toward', loop: [STAND], indoors: true },
    },
  },
  {
    id: 'villager:hazel', name: 'Hazel', role: 'miller', title: 'Miller', glyph: '✣',
    color: 0xd9c08a, dark: 0xb39a66, glyph3d: EYE, scarf: 0x8a5a3a,
    hat: 'millcap', hatColor: 0xf1ece0, hatBand: 0xd8cdb8, wear: 'smock', wearColor: 0xf1ece2, wearTrim: 0xc9b89a,
    tempo: 1.8, bounce: 0.9, fn: 'stats', verb: 'Talk to',
    places: {
      mill: { at: 'windmill', x: 2.2, z: 5.6, face: 0.35, loop: [STAND, { act: 'sweep', min: 7, max: 11 }, { act: 'inspect', min: 5, max: 8, p: 0.6 }, { act: 'stretch', min: 3, max: 4, p: 0.3 }] },
      well: { at: 'well', x: -2.6, z: 1.6, face: 'toward', loop: [{ act: 'sitground', min: 14, max: 24 }, STAND], social: true },
      // Nan's old river mill (a Valley Project: the ruin until it's mended), on the land side, looking at the wheel
      millwheel: { at: 'project:millwheel', x: -3.4, z: 2.6, face: 0.9, loop: [{ act: 'sitground', min: 20, max: 36 }, { act: 'gaze', min: 8, max: 12 }], amble: true },
      festival: atFest(2.8, FEST_LOOP),
      sails: { at: 'windmill', x: -2.4, z: 5.2, face: 0, loop: [{ act: 'sitground', min: 14, max: 24 }, { act: 'gaze', min: 6, max: 10 }] },
      windmill: { at: 'windmill', x: 0, z: 4.6, face: 'toward', loop: [STAND], indoors: true },
      shelter: { at: 'windmill', x: 0.5, z: 4.6, face: 'toward', loop: [STAND], indoors: true },
    },
  },
  {
    id: 'villager:marigold', name: 'Mayor Marigold', role: 'mayor', title: 'Mayor', glyph: '★',
    color: 0x9b5a8c, dark: 0x7a4470, glyph3d: EYE, scarf: 0xf0c860,
    hat: 'tophat', hatColor: 0x2a2530, hatBand: 0xc23b5a, wear: 'sash', wearColor: 0xc8384a, wearTrim: 0xf0c860,
    tempo: 1.75, bounce: 0.8, fn: 'noticeboard', verb: 'Talk to',
    places: {
      porch: { at: 'farmhouse', x: -1.9, z: 7.0, face: 0, loop: [{ act: 'read', min: 10, max: 16 }, STAND, { act: 'gaze', min: 5, max: 8 }] },
      noticeboard: { at: 'noticeboard', x: 2.2, z: 1.9, face: 0.3, loop: [STAND, { act: 'talk', min: 5, max: 8 }, { act: 'board', min: 6, max: 10, p: 0.6 }, { act: 'wave', min: 2, max: 3, p: 0.3 }] },
      board: { at: 'project:board', x: 1.6, z: 1.8, face: 'toward', loop: [{ act: 'board', min: 8, max: 12 }, STAND, { act: 'talk', min: 4, max: 6, p: 0.4 }] },
      square: { at: 'xz', x: -4.5, z: 7.5, face: Math.PI, loop: [{ act: 'gaze', min: 8, max: 14 }, { act: 'talk', min: 4, max: 6, p: 0.4 }], social: true, amble: true },
      picnic: { at: 'picnic', x: 3.4, z: 3.2, face: 'toward', loop: [{ act: 'sitground', min: 14, max: 26 }, { act: 'read', min: 6, max: 10, p: 0.5 }], social: true, amble: true },
      hotspring: { at: 'hotspring', x: 2.6, z: 4.4, face: 'toward', loop: [{ act: 'sitground', min: 20, max: 36 }, { act: 'stretch', min: 3, max: 4, p: 0.4 }], amble: true },
      halt: { at: 'project:halt', x: 3.6, z: 4.2, face: Math.PI, loop: [{ act: 'gaze', min: 10, max: 16 }, STAND, { act: 'wave', min: 2, max: 3, p: 0.3 }], amble: true },
      festival: atFest(-1.2, [{ act: 'talk', min: 6, max: 9 }, ...FEST_LOOP]),
      pergola: { at: 'pergola', x: -1.4, z: 4.6, face: 'toward', loop: [{ act: 'gaze', min: 8, max: 14 }, { act: 'chat', min: 5, max: 8 }, STAND], social: true, amble: true },
      farmhouse: { at: 'farmhouse', x: -0.6, z: 5.65, via: { x: 0, z: 7.6 }, face: 'toward', loop: [STAND], indoors: true },
      shelter: { at: 'farmhouse', x: -0.6, z: 5.65, face: 'toward', via: { x: 0, z: 7.6 }, loop: [STAND], indoors: true },
    },
  },
  {
    id: 'villager:fern', name: 'Fern', role: 'ranger', title: 'Ranger', glyph: '⌖',
    color: 0x5d8f45, dark: 0x46702f, glyph3d: EYE, scarf: 0xe0a030,
    hat: 'ranger', hatColor: 0xb89a62, hatBand: 0x6a4a32, wear: 'pack', wearColor: 0x8a7a48, wearTrim: 0x5a4a2a,
    tempo: 2.15, bounce: 1.1, fn: 'map', verb: 'Talk to',
    places: {
      signpost: { at: 'signpost', x: 1.4, z: 1.2, face: 0.2, loop: [STAND, { act: 'almanac', min: 6, max: 10 }, { act: 'wave', min: 2, max: 3, p: 0.3 }, { act: 'gaze', min: 5, max: 8, p: 0.5 }] },
      campfire: { at: 'campfire', x: 2.6, z: 4.4, face: 'toward', loop: [{ act: 'campfire', min: 16, max: 28 }, { act: 'stretch', min: 3, max: 4, p: 0.3 }], social: true },
      // the ranger sleeps out under the stars by the fire
      campbed: { at: 'campfire', x: 3.4, z: 3.6, face: 'toward', loop: [{ act: 'nap', min: 60, max: 90 }] },
      // rounds: the stones, the orchard, the bridge, the waterfall pool, the hot spring, the east ridge
      stones: { at: 'stones', x: 0, z: 6.6, face: 'toward', loop: [{ act: 'gaze', min: 8, max: 12 }, { act: 'almanac', min: 5, max: 7 }], amble: true },
      orchard: { at: 'orchard', x: 2.5, z: 7.6, face: 'toward', loop: [{ act: 'gaze', min: 6, max: 10 }], amble: true },
      bridge: { at: 'bridge', x: 0, z: -9.5, face: Math.PI, loop: [{ act: 'gaze', min: 8, max: 12 }, { act: 'almanac', min: 5, max: 7 }], amble: true },
      falls: { at: 'xz', x: -33, z: -92, face: Math.PI, loop: [{ act: 'gaze', min: 8, max: 12 }], amble: true },
      hotspring: { at: 'hotspring', x: 0, z: 5.6, face: 'toward', loop: [{ act: 'gaze', min: 6, max: 10 }], amble: true },
      ridge: { at: 'xz', x: 43.5, z: 55.6, face: Math.PI, loop: [{ act: 'gaze', min: 8, max: 12 }, { act: 'almanac', min: 5, max: 7 }], amble: true },
      glasshouse: { at: 'project:glasshouse', x: -2.2, z: 3.4, face: 'toward', loop: [{ act: 'almanac', min: 8, max: 12 }, { act: 'inspect', min: 5, max: 8 }, { act: 'gaze', min: 5, max: 8 }], amble: true },
      festival: atFest(-2.4, FEST_LOOP),
      shelter: { at: 'barn', x: -1.2, z: 6.2, face: 'toward', loop: [STAND], indoors: true },
    },
  },
  {
    id: 'villager:nimbus', name: 'Nimbus', role: 'weather', title: 'Weather-watcher', glyph: '☂',
    color: 0x6fb7e0, dark: 0x4d93bd, glyph3d: EYE, scarf: 0xe8eef2,
    hat: 'souwester', hatColor: 0xf2c230, hatBand: 0xc89a10, wear: 'cape', wearColor: 0xf0c040, wearTrim: 0xb88a20,
    tempo: 1.9, bounce: 1.0, fn: 'say', verb: 'Talk to',
    places: {
      // a night owl: up at the knoll after dark, asleep in the mill's loft all morning
      knoll: { at: 'lookout', x: -2.2, z: 5.6, face: 0, loop: [STAND, { act: 'inspect', min: 5, max: 8 }, { act: 'almanac', min: 6, max: 9 }, { act: 'gaze', min: 6, max: 10 }] },
      dock: { at: 'dock', x: -1.9, z: -4.6, face: 0, loop: [{ act: 'gaze', min: 10, max: 16 }, { act: 'almanac', min: 6, max: 9 }], social: true, amble: true },
      meadow: { at: 'xz', x: 14, z: -0.5, face: Math.PI / 2, loop: [{ act: 'gaze', min: 8, max: 14 }, { act: 'almanac', min: 5, max: 8 }], amble: true },
      well: { at: 'well', x: 2.6, z: 1.4, face: 'toward', loop: [{ act: 'inspect', min: 5, max: 8 }, STAND], amble: true },
      observatory: { at: 'project:observatory', x: -1.8, z: 4.2, face: 0, loop: [{ act: 'stargaze', min: 12, max: 20 }, { act: 'almanac', min: 6, max: 9 }, { act: 'gaze', min: 6, max: 10 }], amble: true },
      festival: atFest(-0.2, FEST_LOOP, 4.4),
      loft: { at: 'windmill', x: 0, z: 4.6, face: 'toward', loop: [STAND], indoors: true },
      shelter: { at: 'windmill', x: -0.5, z: 4.6, face: 'toward', loop: [STAND], indoors: true },
    },
  },
];

/** A villager's look: a Clawd in its own colours, role hat and wear (never an agent kind colour). */
export function villagerLook(v: Villager): Look {
  return {
    kind: 'claude', body: 'clawd', color: v.color, dark: v.dark, glyph: v.glyph3d, star: false, scarf: v.scarf,
    hat: 'cap', hatColor: v.hatColor, hatBand: v.hatBand, tempo: v.tempo, bounce: v.bounce, fidget: 1, chatty: 0.6,
    blinkEvery: 3.2, doubleBlink: 0.2, scale: 1, likes: [], restless: 0,
    roleHat: v.hat, wear: v.wear, wearColor: v.wearColor, wearTrim: v.wearTrim,
  };
}
