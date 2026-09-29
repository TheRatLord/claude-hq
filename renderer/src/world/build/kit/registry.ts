/**
 * Prop-kit registry ([ENV fix r1]: split from kit/index.ts so node-side code — the nav obstacle dry run, tests — can
 * build items without the material module): `KIT[name](params, rng) → Item`, the signature set and the prop-sheet list.
 * Owner: ENV.
 */
import type { Builder, SheetEntry } from './core.ts';
import { buildDesk, buildDeskChair, buildStool, buildSofa, buildArmchair, buildBeanbag, buildTable, buildCounter, buildBench, buildShelf, buildBookStack } from './furniture.ts';
import { buildPlant, buildPlanter } from './plants.ts';
import { buildLamp } from './lamps.ts';
import { buildMonitor, buildKeyboard, buildRack } from './tech.ts';
import { buildMug, buildCrate, buildBox, buildRug, buildStanchion, buildRope, buildWhiteboard, buildCorkboard, buildFilingCabinet, buildCoatRack, buildWaterCooler, buildBin, buildSign, buildRadiator, buildCushion, buildNote, buildPoster, buildEasel, buildTote } from './decor.ts';
import { buildHearth, buildBigBoard, buildArcade, buildPingPong, buildDais, buildHammock, buildGameTable } from './signature.ts';
import { STACKS_KIT, STACKS_SIGNATURE, STACKS_SHEET } from './stacks.ts'; // [ENV M2 breadth LIB/MAIL/ARC/phones]
import { AMENITY_KIT, AMENITY_SIGNATURE, AMENITY_SHEET } from './amenity.ts'; // [ENV M2 breadth W/STR] amenity-bay props
import { STREET_KIT, STREET_SIGNATURE, STREET_SHEET } from './street.ts'; // [ENV M2 breadth W/STR] Studio Street props
import { LOUNGE_KIT, LOUNGE_SIGNATURE, LOUNGE_SHEET } from './lounge.ts'; // [ENV M2 breadth CAF/NAP/MEZ] café, nap nook, mezzanine, stairs/slide props
import { LOBBY_KIT, LOBBY_SIGNATURE, LOBBY_SHEET } from './lobby.ts'; // [ENV M2 breadth LOB/PLZ/OUT] help desk, lobby, plaza props
import { EXTERIOR_KIT, EXTERIOR_SHEET } from './exterior.ts'; // [ENV M2 breadth LOB/PLZ/OUT] garden
import { WORKSHOP_KIT, WORKSHOP_SIGNATURE, WORKSHOP_SHEET } from './workshop.ts'; // [ENV M2 breadth LAB/ENG] lab + engine-room props
import { STUDIO_KIT, STUDIO_SIGNATURE, STUDIO_SHEET } from './studio.ts'; // [ENV fix m2 r1] amenity sets, café + archive dressing
import { FINISH_KIT, FINISH_SIGNATURE, FINISH_SHEET } from './finish.ts'; // [ENV fix m2 r3] façade sign, mail east wall, library bridge, hills

/** The 30 §7.5 kit builders (+ bench, note, poster, easel) and the bespoke signature props. */
export const KIT: Readonly<Record<string, Builder>> = Object.freeze({
  desk: buildDesk, deskChair: buildDeskChair, stool: buildStool, sofa: buildSofa, armchair: buildArmchair, beanbag: buildBeanbag,
  table: buildTable, counter: buildCounter, shelf: buildShelf, bookStack: buildBookStack, plant: buildPlant, lamp: buildLamp,
  monitor: buildMonitor, keyboard: buildKeyboard, mug: buildMug, crate: buildCrate, box: buildBox, rug: buildRug,
  stanchion: buildStanchion, rope: buildRope, whiteboard: buildWhiteboard, corkboard: buildCorkboard, filingCabinet: buildFilingCabinet,
  rack: buildRack, coatRack: buildCoatRack, waterCooler: buildWaterCooler, bin: buildBin, sign: buildSign, radiator: buildRadiator,
  planter: buildPlanter, cushion: buildCushion,
  bench: buildBench, note: buildNote, poster: buildPoster, easel: buildEasel, tote: buildTote,
  hearth: buildHearth, bigBoard: buildBigBoard, arcade: buildArcade, pingPong: buildPingPong, dais: buildDais,
  hammock: buildHammock, gameTable: buildGameTable,
  ...AMENITY_KIT, ...STREET_KIT, // [ENV M2 breadth W/STR]
  ...LOUNGE_KIT, // [ENV M2 breadth CAF/NAP/MEZ]
  ...STACKS_KIT, // [ENV M2 breadth LIB/MAIL/ARC/phones]
  ...WORKSHOP_KIT, // [ENV M2 breadth LAB/ENG]
  ...LOBBY_KIT, ...EXTERIOR_KIT, // [ENV M2 breadth LOB/PLZ/OUT]
  ...STUDIO_KIT, // [ENV fix m2 r1]
  ...FINISH_KIT, // [ENV fix m2 r3]
});
/** Signature (bespoke) props: 6k-tri budget instead of 1.5k (§7.5). */
export const SIGNATURE = new Set<string>(['hearth', 'bigBoard', 'arcade', 'pingPong', 'sofa', 'shelf', 'easel', 'dais', ...AMENITY_SIGNATURE, ...STREET_SIGNATURE, ...STACKS_SIGNATURE]);
for (const n of LOUNGE_SIGNATURE) SIGNATURE.add(n); // [ENV M2 breadth CAF/NAP/MEZ]
for (const n of LOBBY_SIGNATURE) SIGNATURE.add(n); // [ENV M2 breadth LOB/PLZ/OUT]
for (const n of WORKSHOP_SIGNATURE) SIGNATURE.add(n); // [ENV M2 breadth LAB/ENG]
for (const n of STUDIO_SIGNATURE) SIGNATURE.add(n); // [ENV fix m2 r1]
for (const n of FINISH_SIGNATURE) SIGNATURE.add(n); // [ENV fix m2 r3]

/**
 * Every builder with its variants, for `?sheet=props` and the kit test. [name, params, label]
 */
export const KIT_SHEET: readonly SheetEntry[] = Object.freeze<SheetEntry[]>([
  ['desk', {}, 'desk'], ['desk', { m: -1, drawers: false }, 'desk · no drawers'],
  ['deskChair', {}, 'deskChair'], ['deskChair', { colors: { body: '#7E9A86' } }, 'deskChair · sage'],
  ['stool', {}, 'stool · bar'], ['stool', { h: 0.3 }, 'stool · low'],
  ['sofa', {}, 'sofa · 2 seat'], ['sofa', { back: 'low' }, 'sofa · pit lounger'], ['sofa', { w: 2.3, seats: 3, arms: 'track', colors: { body: '#4E7C78' } }, 'sofa · 3 seat track'],
  ['armchair', {}, 'armchair'], ['armchair', { colors: { body: '#5E9EA0' } }, 'armchair · teal'],
  ['beanbag', {}, 'beanbag'], ['beanbag', { colors: { body: '#A99BD3' } }, 'beanbag · lavender'],
  ['table', { kind: 'round' }, 'table · round'], ['table', { kind: 'coffee' }, 'table · coffee'], ['table', { kind: 'meeting', w: 1.4, d: 0.8 }, 'table · meeting'],
  ['counter', {}, 'counter'], ['bench', {}, 'bench'],
  ['shelf', {}, 'shelf'], ['shelf', { w: 1.8, h: 1.25, fill: 0.6 }, 'shelf · tall sparse'],
  ['bookStack', { n: 3 }, 'bookStack'],
  ['plant', { kind: 'bush', h: 1.0, flowers: true }, 'plant · bush'], ['plant', { kind: 'monstera', h: 1.2 }, 'plant · monstera'],
  ['plant', { kind: 'fern', h: 0.9 }, 'plant · fern'], ['plant', { kind: 'cactus', h: 0.9 }, 'plant · cactus'],
  ['plant', { kind: 'pothos', drop: 0.5 }, 'plant · pothos'], ['plant', { kind: 'tree', h: 2.2 }, 'plant · tree'], ['plant', { kind: 'succulent' }, 'plant · succulent'],
  ['lamp', { kind: 'desk' }, 'lamp · desk'], ['lamp', { kind: 'floor' }, 'lamp · floor'], ['lamp', { kind: 'floorArc' }, 'lamp · arc'],
  ['lamp', { kind: 'pendant', shape: 'dome' }, 'lamp · pendant'], ['lamp', { kind: 'street' }, 'lamp · street'], ['lamp', { kind: 'string', len: 1.6 }, 'lamp · string'],
  ['monitor', {}, 'monitor'], ['keyboard', {}, 'keyboard + mouse'], ['mug', {}, 'mug'],
  ['crate', {}, 'crate'], ['box', {}, 'box'],
  ['rug', { kind: 'rect', w: 1.4, d: 1.0 }, 'rug · rect'], ['rug', { kind: 'round', r: 0.7 }, 'rug · round'], ['rug', { kind: 'runner', w: 1.6, d: 0.5, fringe: false }, 'rug · runner'],
  ['stanchion', {}, 'stanchion'], ['rope', { len: 0.9 }, 'rope'],
  ['whiteboard', {}, 'whiteboard'], ['corkboard', {}, 'corkboard'], ['filingCabinet', {}, 'filingCabinet'], ['rack', {}, 'rack'],
  ['coatRack', {}, 'coatRack'], ['coatRack', { kind: 'umbrella' }, 'umbrella stand'], ['waterCooler', {}, 'waterCooler'], ['bin', {}, 'bin'],
  ['sign', {}, 'sign / plaque'], ['radiator', {}, 'radiator'], ['radiator', { kind: 'pipe', len: 1.0 }, 'pipe'], ['radiator', { kind: 'vent' }, 'vent'],
  ['planter', {}, 'planter'], ['cushion', {}, 'cushion'], ['cushion', { kind: 'throw' }, 'throw'], ['cushion', { kind: 'floor' }, 'floor cushion'], ['note', {}, 'note'],
  ['poster', { style: 0 }, 'poster'], ['easel', {}, 'easel'], ['tote', { out: 'poster' }, 'tote'],
  ['hearth', {}, 'hearth ★'], ['arcade', {}, 'arcade ★'], ['pingPong', {}, 'pingPong ★'], ['dais', { w: 1.6, d: 1.0 }, 'dais ★'],
  ['hammock', {}, 'hammock'], ['gameTable', {}, 'gameTable'],
  ...AMENITY_SHEET, ...STREET_SHEET, // [ENV M2 breadth W/STR]
  ...LOUNGE_SHEET, // [ENV M2 breadth CAF/NAP/MEZ]
  ...STACKS_SHEET, // [ENV M2 breadth LIB/MAIL/ARC/phones]
  ...WORKSHOP_SHEET, // [ENV M2 breadth LAB/ENG]
  ...LOBBY_SHEET, ...EXTERIOR_SHEET, // [ENV M2 breadth LOB/PLZ/OUT]
  ...STUDIO_SHEET, // [ENV fix m2 r1]
  ...FINISH_SHEET, // [ENV fix m2 r3]
]);

