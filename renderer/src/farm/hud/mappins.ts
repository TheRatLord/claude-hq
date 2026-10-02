/**
 * Map pin iconography, shared by the big map, the minimap and the legend (so the key always matches the pins).
 *
 * One rule: the shape says what kind of thing it is, the colour says which.
 *  - **circles** are people with a terminal: farmers (status colour, gold pulsing ring when they need you)
 *  - **houses** are villagers (their body colour), **crosses** are scarecrows
 *  - **rounded tiles** are places: the General store, the mailbox, your yard, leisure nooks, fishing spots,
 *    trail lookouts; a white symbol on the category colour
 *  - **hearts** are today's villager requests (gold when ready to hand over), **the star rosette** is the festival
 *  - **soft washes** are hints, never exact spots: forage areas, wildlife habitats (paw tile + when)
 */
import { POND, STRUCTURES, YARD, type StructureId, type XZ } from '../world/map.ts';

export type Glyph =
  | 'store' | 'mail' | 'yard' | 'fish' | 'nook' | 'heart' | 'festival' | 'paw' | 'leaf' | 'peak' | 'door' | 'bridge' | 'boot'
  | 'pergola' | 'picnic' | 'lookout' | 'hotspring' | 'orchard' | 'stones' | 'haymeadow' | 'swingtree' | 'waterfall'
  // the secret grotto behind the waterfall: a "?" until found, then a cave mouth
  | 'secret' | 'cave';

export const PIN_COLOR = Object.freeze({
  store: '#3f8a5a', mail: '#c0453a', yard: '#8a6a3a', fish: '#3a78ad', nook: '#5f8a3e', heart: '#e0526b', heartReady: '#f0a72c',
  festival: '#e0a526', paw: '#8a5a36', leaf: '#6f9a3a', peak: '#9a3b2a', door: '#b8743a', secret: '#6a5aa8',
});
const INK = '#3b2a1e';

/** The white symbol inside a tile (unit: r = tile half-size). */
function symbol(g: CanvasRenderingContext2D, k: Glyph, r: number): void {
  g.fillStyle = '#fff8e8'; g.strokeStyle = '#fff8e8'; g.lineWidth = Math.max(1, r * 0.16); g.lineCap = 'round'; g.lineJoin = 'round';
  const s = r * 0.62;
  switch (k) {
    case 'store': {
      // a cart awning: scalloped stripes over a box
      g.fillRect(-s, -s * 0.15, s * 2, s * 0.95);
      g.beginPath(); g.moveTo(-s * 1.1, -s * 0.2); g.lineTo(-s * 0.8, -s * 0.95); g.lineTo(s * 0.8, -s * 0.95); g.lineTo(s * 1.1, -s * 0.2); g.closePath(); g.fill();
      g.fillStyle = PIN_COLOR.store; g.fillRect(-s * 0.35, -s * 0.9, s * 0.3, s * 0.68); g.fillRect(s * 0.3, -s * 0.9, s * 0.3, s * 0.68);
      break;
    }
    case 'mail': {
      g.fillRect(-s, -s * 0.65, s * 2, s * 1.3);
      g.strokeStyle = PIN_COLOR.mail; g.lineWidth = Math.max(1, r * 0.12);
      g.beginPath(); g.moveTo(-s, -s * 0.6); g.lineTo(0, s * 0.15); g.lineTo(s, -s * 0.6); g.stroke();
      break;
    }
    case 'yard': {
      for (const x of [-0.75, -0.25, 0.25, 0.75]) { g.beginPath(); g.moveTo(x * s, s * 0.85); g.lineTo(x * s, -s * 0.55); g.lineTo(x * s + s * 0.1, -s * 0.8); g.stroke(); }
      g.beginPath(); g.moveTo(-s, -s * 0.15); g.lineTo(s, -s * 0.15); g.moveTo(-s, s * 0.45); g.lineTo(s, s * 0.45); g.stroke();
      break;
    }
    case 'fish': {
      g.beginPath(); g.ellipse(-s * 0.1, 0, s * 0.72, s * 0.42, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(s * 0.5, 0); g.lineTo(s * 1.05, -s * 0.48); g.lineTo(s * 1.05, s * 0.48); g.closePath(); g.fill();
      g.fillStyle = PIN_COLOR.fish; g.beginPath(); g.arc(-s * 0.48, -s * 0.08, s * 0.11, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'paw': {
      g.beginPath(); g.ellipse(0, s * 0.3, s * 0.42, s * 0.36, 0, 0, Math.PI * 2); g.fill();
      for (const [x, y] of [[-0.55, -0.2], [-0.2, -0.62], [0.2, -0.62], [0.55, -0.2]]) { g.beginPath(); g.arc(x * s, y * s, s * 0.19, 0, Math.PI * 2); g.fill(); }
      break;
    }
    case 'leaf': {
      g.beginPath(); g.moveTo(-s * 0.8, s * 0.8); g.quadraticCurveTo(-s * 0.9, -s * 0.7, s * 0.85, -s * 0.85); g.quadraticCurveTo(s * 0.7, s * 0.85, -s * 0.8, s * 0.8); g.fill();
      g.strokeStyle = PIN_COLOR.leaf; g.lineWidth = Math.max(0.8, r * 0.1); g.beginPath(); g.moveTo(-s * 0.7, s * 0.7); g.lineTo(s * 0.5, -s * 0.5); g.stroke();
      break;
    }
    case 'peak': {
      g.beginPath(); g.moveTo(-s, s * 0.75); g.lineTo(-s * 0.2, -s * 0.55); g.lineTo(s * 0.2, 0); g.lineTo(s * 0.5, -s * 0.3); g.lineTo(s, s * 0.75); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(-s * 0.2, -s * 0.55); g.lineTo(-s * 0.2, -s * 1.05); g.stroke();
      g.beginPath(); g.moveTo(-s * 0.2, -s * 1.05); g.lineTo(s * 0.3, -s * 0.9); g.lineTo(-s * 0.2, -s * 0.75); g.fill();
      break;
    }
    case 'bridge': {
      g.beginPath(); g.moveTo(-s, s * 0.2); g.quadraticCurveTo(0, s * 0.75, s, s * 0.2); g.stroke();
      g.beginPath(); g.moveTo(-s, -s * 0.45); g.quadraticCurveTo(0, s * 0.1, s, -s * 0.45); g.stroke();
      for (const x of [-0.5, 0, 0.5]) { g.beginPath(); g.moveTo(x * s, -s * 0.2 + Math.abs(x) * -s * 0.3 + s * 0.08); g.lineTo(x * s, s * 0.45 - Math.abs(x) * s * 0.3); g.stroke(); }
      break;
    }
    case 'boot': {
      // a walking boot: the trailhead
      g.beginPath(); g.moveTo(-s * 0.45, -s * 0.9); g.lineTo(s * 0.15, -s * 0.9); g.lineTo(s * 0.2, s * 0.05); g.lineTo(s * 0.9, s * 0.3); g.lineTo(s * 0.9, s * 0.75); g.lineTo(-s * 0.55, s * 0.75); g.closePath(); g.fill();
      g.strokeStyle = PIN_COLOR.peak; g.lineWidth = Math.max(0.8, r * 0.09); g.beginPath(); g.moveTo(-s * 0.55, s * 0.5); g.lineTo(s * 0.9, s * 0.5); g.stroke();
      break;
    }
    case 'door': {
      g.beginPath(); g.moveTo(-s * 0.6, s * 0.85); g.lineTo(-s * 0.6, -s * 0.3); g.arc(0, -s * 0.3, s * 0.6, Math.PI, 0); g.lineTo(s * 0.6, s * 0.85); g.closePath(); g.fill();
      g.fillStyle = PIN_COLOR.door; g.beginPath(); g.arc(s * 0.3, s * 0.2, s * 0.12, 0, Math.PI * 2); g.fill();
      break;
    }
    // ---- leisure nooks ----
    case 'nook': case 'pergola': {
      // a bench
      g.beginPath(); g.moveTo(-s, -s * 0.1); g.lineTo(s, -s * 0.1); g.moveTo(-s, s * 0.25); g.lineTo(s, s * 0.25); g.moveTo(-s * 0.7, s * 0.25); g.lineTo(-s * 0.7, s * 0.85); g.moveTo(s * 0.7, s * 0.25); g.lineTo(s * 0.7, s * 0.85); g.moveTo(-s * 0.85, -s * 0.1); g.lineTo(-s * 0.85, -s * 0.75); g.lineTo(s * 0.85, -s * 0.75); g.lineTo(s * 0.85, -s * 0.1); g.stroke();
      break;
    }
    case 'picnic': {
      g.fillRect(-s * 0.85, -s * 0.85, s * 1.7, s * 1.7);
      g.fillStyle = PIN_COLOR.nook;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if ((i + j) % 2) g.fillRect(-s * 0.85 + i * s * 0.567, -s * 0.85 + j * s * 0.567, s * 0.567, s * 0.567);
      break;
    }
    case 'lookout': {
      // a star
      g.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? s * 0.42 : s; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      g.closePath(); g.fill();
      break;
    }
    case 'hotspring': {
      g.beginPath(); g.ellipse(0, s * 0.55, s * 0.9, s * 0.32, 0, 0, Math.PI * 2); g.fill();
      for (const x of [-0.45, 0, 0.45]) { g.beginPath(); g.moveTo(x * s, s * 0.15); g.bezierCurveTo(x * s - s * 0.3, -s * 0.15, x * s + s * 0.3, -s * 0.4, x * s, -s * 0.85); g.stroke(); }
      break;
    }
    case 'orchard': {
      g.beginPath(); g.arc(0, s * 0.15, s * 0.72, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(0, -s * 0.5); g.lineTo(s * 0.12, -s * 0.95); g.stroke();
      g.fillStyle = PIN_COLOR.nook; g.beginPath(); g.ellipse(s * 0.35, -s * 0.78, s * 0.28, s * 0.14, -0.4, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'stones': {
      for (const [x, hgt] of [[-0.62, 1.2], [0, 1.6], [0.62, 1.2]]) { g.beginPath(); g.moveTo(x * s - s * 0.22, s * 0.8); g.lineTo(x * s - s * 0.2, s * 0.8 - hgt * s * 0.9); g.quadraticCurveTo(x * s, s * 0.8 - hgt * s * 1.05, x * s + s * 0.2, s * 0.8 - hgt * s * 0.9); g.lineTo(x * s + s * 0.22, s * 0.8); g.closePath(); g.fill(); }
      break;
    }
    case 'haymeadow': {
      g.beginPath(); g.arc(0, 0, s * 0.85, 0, Math.PI * 2); g.fill();
      g.strokeStyle = PIN_COLOR.nook; g.lineWidth = Math.max(0.8, r * 0.1);
      g.beginPath(); for (let a = 0; a < Math.PI * 5; a += 0.3) { const rr = (a / (Math.PI * 5)) * s * 0.7; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } g.stroke();
      break;
    }
    case 'swingtree': {
      g.beginPath(); g.moveTo(-s * 0.9, -s * 0.8); g.lineTo(s * 0.9, -s * 0.8); g.stroke();
      g.beginPath(); g.moveTo(-s * 0.35, -s * 0.8); g.lineTo(-s * 0.45, s * 0.45); g.moveTo(s * 0.35, -s * 0.8); g.lineTo(s * 0.45, s * 0.45); g.stroke();
      g.fillRect(-s * 0.65, s * 0.4, s * 1.3, s * 0.3);
      break;
    }
    case 'waterfall': {
      for (const x of [-0.5, 0, 0.5]) { g.beginPath(); g.moveTo(x * s, -s * 0.85); g.lineTo(x * s, s * 0.5); g.stroke(); }
      g.beginPath(); g.ellipse(0, s * 0.72, s * 0.85, s * 0.22, 0, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'secret': {
      g.font = `900 ${Math.round(s * 2.1)}px Georgia, "DejaVu Serif", serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('?', 0, s * 0.08);
      break;
    }
    case 'cave': {
      // a dark arch in the rock, a crystal glinting inside
      g.beginPath(); g.moveTo(-s, s * 0.85); g.quadraticCurveTo(-s * 0.95, -s * 0.9, 0, -s * 0.9); g.quadraticCurveTo(s * 0.95, -s * 0.9, s, s * 0.85); g.closePath(); g.fill();
      g.fillStyle = '#2a2240';
      g.beginPath(); g.moveTo(-s * 0.55, s * 0.85); g.quadraticCurveTo(-s * 0.5, -s * 0.35, 0, -s * 0.38); g.quadraticCurveTo(s * 0.5, -s * 0.35, s * 0.55, s * 0.85); g.closePath(); g.fill();
      g.fillStyle = '#7ff0e0'; g.beginPath(); g.moveTo(s * 0.1, s * 0.75); g.lineTo(s * 0.22, s * 0.1); g.lineTo(s * 0.34, s * 0.75); g.closePath(); g.fill();
      break;
    }
    case 'heart': case 'festival': break;
  }
}

/** A place tile: a rounded square with a soft shadow, an ink edge and a white symbol. */
export function tile(g: CanvasRenderingContext2D, x: number, y: number, r: number, k: Glyph, color: string, o: { hot?: boolean; alpha?: number } = {}): void {
  g.save();
  g.translate(x, y);
  if (o.alpha !== undefined) g.globalAlpha = o.alpha;
  const rr = r * 0.38;
  const path = () => { g.beginPath(); g.moveTo(-r + rr, -r); g.arcTo(r, -r, r, r, rr); g.arcTo(r, r, -r, r, rr); g.arcTo(-r, r, -r, -r, rr); g.arcTo(-r, -r, r, -r, rr); g.closePath(); };
  g.fillStyle = 'rgba(40, 25, 10, .3)'; g.translate(1, 1.5); path(); g.fill(); g.translate(-1, -1.5);
  path(); g.fillStyle = color; g.fill();
  g.lineWidth = o.hot ? 2.6 : Math.max(1.2, r * 0.16); g.strokeStyle = o.hot ? '#fff' : '#fff3d6'; g.stroke();
  g.lineWidth = 1; g.strokeStyle = 'rgba(40, 25, 10, .55)';
  g.beginPath(); g.moveTo(-r - 0.6 + rr, -r - 0.6); g.arcTo(r + 0.6, -r - 0.6, r + 0.6, r + 0.6, rr); g.arcTo(r + 0.6, r + 0.6, -r - 0.6, r + 0.6, rr); g.arcTo(-r - 0.6, r + 0.6, -r - 0.6, -r - 0.6, rr); g.arcTo(-r - 0.6, -r - 0.6, r + 0.6, -r - 0.6, rr); g.closePath(); g.stroke();
  symbol(g, k, r);
  g.restore();
}

/** A heart pin (a request): pink, gold and pulsing when it's ready to hand over. */
export function heart(g: CanvasRenderingContext2D, x: number, y: number, r: number, ready: boolean, time: number, o: { hot?: boolean } = {}): void {
  g.save(); g.translate(x, y);
  if (ready) {
    const ph = (time * 1.1) % 1;
    g.strokeStyle = `rgba(240, 167, 44, ${0.9 * (1 - ph)})`; g.lineWidth = 2.5;
    g.beginPath(); g.arc(0, 0, r * (1.1 + ph * 0.9), 0, Math.PI * 2); g.stroke();
  }
  const path = () => {
    g.beginPath(); g.moveTo(0, r * 0.95);
    g.bezierCurveTo(-r * 1.25, r * 0.05, -r * 0.85, -r * 1.05, 0, -r * 0.4);
    g.bezierCurveTo(r * 0.85, -r * 1.05, r * 1.25, r * 0.05, 0, r * 0.95); g.closePath();
  };
  g.fillStyle = 'rgba(40, 25, 10, .3)'; g.translate(1, 1.5); path(); g.fill(); g.translate(-1, -1.5);
  path(); g.fillStyle = ready ? PIN_COLOR.heartReady : PIN_COLOR.heart; g.fill();
  g.lineWidth = o.hot ? 2.6 : Math.max(1.3, r * 0.18); g.strokeStyle = o.hot ? '#fff' : '#fff3d6'; g.stroke();
  g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.ellipse(-r * 0.42, -r * 0.35, r * 0.18, r * 0.12, -0.6, 0, Math.PI * 2); g.fill();
  if (ready) { g.fillStyle = INK; g.font = `900 ${Math.round(r * 1.05)}px ui-rounded, "DejaVu Sans", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', 0, r * 0.05); }
  g.restore();
}

/** The festival rosette: a gold eight-point star on a ribbon. */
export function rosette(g: CanvasRenderingContext2D, x: number, y: number, r: number, time: number, o: { hot?: boolean } = {}): void {
  g.save(); g.translate(x, y);
  g.fillStyle = '#c0392b';
  g.beginPath(); g.moveTo(-r * 0.5, r * 0.3); g.lineTo(-r * 0.75, r * 1.25); g.lineTo(-r * 0.35, r * 1.0); g.lineTo(-r * 0.1, r * 1.3); g.lineTo(0, r * 0.4); g.fill();
  g.beginPath(); g.moveTo(r * 0.5, r * 0.3); g.lineTo(r * 0.75, r * 1.25); g.lineTo(r * 0.35, r * 1.0); g.lineTo(r * 0.1, r * 1.3); g.lineTo(0, r * 0.4); g.fill();
  g.rotate(Math.sin(time * 0.8) * 0.08);
  g.beginPath();
  for (let i = 0; i < 16; i++) { const a = (i * Math.PI) / 8, rr = i % 2 ? r * 0.72 : r; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  g.closePath();
  g.fillStyle = PIN_COLOR.festival; g.fill(); g.lineWidth = o.hot ? 2.6 : 1.6; g.strokeStyle = o.hot ? '#fff' : '#fff3d6'; g.stroke();
  g.fillStyle = '#fff3d6'; g.beginPath(); g.arc(0, 0, r * 0.42, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#c0392b'; g.beginPath(); g.arc(0, 0, r * 0.22, 0, Math.PI * 2); g.fill();
  g.restore();
}

// ---------------------------------------------------------------------------------------------- place data

export interface PlaceDef { id: string; glyph: Glyph; color: string; name: string; line: string; x: number; z: number; label?: boolean }
const at = (id: StructureId): XZ => { const s = STRUCTURES.find((q) => q.id === id)!; return { x: s.x, z: s.z }; };
const NOOK_LINES: Partial<Record<StructureId, [Glyph, string, string]>> = {
  pergola: ['pergola', 'Pergola', 'A checkers table under the vines; idle farmers play here'],
  picnic: ['picnic', 'Picnic spot', 'Gingham blanket and parasol in the south meadow'],
  lookout: ['lookout', 'Stargazers\' knoll', 'Telescope deck; favoured at night'],
  hotspring: ['hotspring', 'Hot spring', 'A warm foot-bath on the river meadow'],
  orchard: ['orchard', 'Orchard & apiary', 'Fruit trees, beehives and a honey honesty stand'],
  stones: ['stones', 'Standing stones', 'The runes glow cyan after dark'],
  haymeadow: ['haymeadow', 'Hay meadow', 'Round bales and a hay wagon'],
  swingtree: ['swingtree', 'Swing tree', 'A rope swing; E gives it a push'],
};
/** Static places (the store comes from the yard service at runtime). */
export const PLACES: readonly PlaceDef[] = [
  { id: 'place:mailbox', glyph: 'mail', color: PIN_COLOR.mail, name: 'Mailbox', line: 'Letters from your farmers (J)', ...at('mailbox') },
  { id: 'place:yard', glyph: 'yard', color: PIN_COLOR.yard, name: 'Your yard', line: 'Decor from the General store stands here', x: (YARD.x0 + YARD.x1) / 2, z: (YARD.z0 + YARD.z1) / 2, label: true },
  { id: 'place:door', glyph: 'door', color: PIN_COLOR.door, name: 'Farmhouse', line: 'E at the door: go inside (hearth, Almanac, Collections shelf)', x: at('farmhouse').x, z: at('farmhouse').z + 5.6 },
  ...Object.entries(NOOK_LINES).map(([id, [glyph, name, line]]) => ({ id: `place:${id}`, glyph, color: PIN_COLOR.nook, name, line, ...at(id as StructureId) })),
  { id: 'place:waterfall', glyph: 'waterfall', color: PIN_COLOR.fish, name: 'Waterfall', line: 'Where the river begins', ...at('waterfall') },
];
/** Fishing spots: the dock, the pond's beach, the river by the bridge and the upper reach. */
export const FISH_SPOTS: readonly (XZ & { water: 'pond' | 'river'; name: string })[] = [
  { ...at('dock'), water: 'pond', name: 'The dock' },
  { x: POND.x + 0.26 * (POND.r + 1.2), z: POND.z + 0.97 * (POND.r + 1.2), water: 'pond', name: 'Pond beach' },
  { x: -52, z: 20, water: 'river', name: 'River, below the bridge' },
  { x: -47, z: -56, water: 'river', name: 'Upper river' },
];
/** Wildlife habitats (general areas, model/collection.ts SIGHTINGS says where / when). */
export const HABITATS: readonly { id: string; spots: readonly XZ[] }[] = [
  { id: 'deer', spots: [{ x: 14, z: -72 }, { x: 80, z: 32 }, { x: -34, z: 66 }] },
  { id: 'fox', spots: [{ x: -2, z: 48 }] },
  { id: 'heron', spots: [{ x: -52, z: 40 }] },
  { id: 'owl', spots: [{ x: at('stones').x + 7, z: at('stones').z }] },
  { id: 'hedgehog', spots: [{ x: at('orchard').x - 6, z: at('orchard').z + 7 }] },
  { id: 'geese', spots: [{ x: 30, z: -96 }] },
];
export const TIME_SHORT: Record<string, string> = { 'dawn-dusk': 'dawn · dusk', night: 'night', day: 'day', evening: 'evening', 'morning-evening': 'morn · eve' };
