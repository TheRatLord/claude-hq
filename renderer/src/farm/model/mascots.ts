// @pure
/**
 * Which mascot a farmer is, and the sprite art of every mascot beyond Clawd and the Codex cloud (those two live in
 * scene/farmers/mascots.ts, with a portrait copy in hud/icons.ts). Pure data, shared by the scene (voxel bodies,
 * scene/farmers/mascots.ts `artBody` / `artPlan`) and the HUD (portraits, hud/icons.ts `farmerFace`), so one grid
 * edit changes both.
 *
 * The sacred-silhouette rule: each mascot evokes its tool's own mark loosely and respectfully (a shape and a colour
 * family, never the logo itself): Gemini a four-point sparkle, Aider a pair-programmer parrot, OpenCode a dark block
 * with an open square frame, Goose a farm goose, Cursor an isometric cube with a pointer facet, Amp an "A"-frame with a
 * crossbar, Crush a heart, Qwen a ringed round "Q", Copilot a goggled pilot helmet. Any other agent is the sprout-bot.
 * Silhouettes differ first (spike, beak, block, neck, hexagon, triangle, heart, ring, helmet, antenna), colour second.
 *
 * Grid legend (read from the FRONT, column 0 = viewer's left, row 0 = top; one character = one cube of `u` metres):
 *   #  body (the mascot's main colour, `colors.body`)        E  eye anchor (a cell coloured like its row neighbour)
 *   a  arm nub (a run on each side)                          f  foot (two runs; the shared slipper, `colors.dark`)
 *   .  empty                                                 any other letter: a baked colour from `pal`
 */
import type { Kind } from '../../../../shared/protocol.ts';

export const MASCOTS = Object.freeze(['clawd', 'codex', 'gemini', 'aider', 'opencode', 'goose', 'cursor', 'amp', 'crush', 'qwen', 'copilot', 'bot'] as const);
export type MascotId = (typeof MASCOTS)[number];
/** The mascots drawn from the art below (Clawd and Codex have their own builders). */
export const ART_IDS = Object.freeze(['gemini', 'aider', 'opencode', 'goose', 'cursor', 'amp', 'crush', 'qwen', 'copilot', 'bot'] as const);
export type ArtId = (typeof ART_IDS)[number];

/** Short names for gallery notes, card tooltips and docs. */
export const MASCOT_NAME: Readonly<Record<MascotId, string>> = Object.freeze({
  clawd: 'Clawd', codex: 'the Codex cloud', gemini: 'the Gemini sparkle', aider: 'the pair-programmer parrot', opencode: 'the OpenCode block',
  goose: 'the goose', cursor: 'the Cursor cube', amp: 'the Amp A-frame', crush: 'the Crush heart', qwen: 'the Qwen ring', copilot: 'the Copilot pilot',
  bot: 'the sprout-bot',
});

/**
 * The mascot for an agent: its vendor's own when it has one (shared/vendors.ts ids), else by kind (Claude → Clawd,
 * Codex → cloud, Gemini → sparkle), else the sprout-bot (Droid, Kimi, an unknown CLI, a pre-rev-3 server's 'agent').
 */
export function mascotOf(kind: Exclude<Kind, 'shell'> | string, vendor?: string | null): MascotId {
  if (vendor === 'claude') return 'clawd';
  if (vendor && (ART_IDS as readonly string[]).includes(vendor) && vendor !== 'bot') return vendor as ArtId;
  if (vendor === 'codex') return 'codex';
  return kind === 'claude' ? 'clawd' : kind === 'codex' ? 'codex' : kind === 'gemini' ? 'gemini' : 'bot';
}

/**
 * One extra box in grid space: x / y in columns / rows (y down, from the grid's top-left edge), size in voxels, `ch` a
 * `pal` key, `wob` how much it follows the jiggle. `z` (voxels, + toward the front) is measured from `from`: the body
 * surface in front of / behind (x, y) (`front` / `back`), or the body's mid-plane (`mid`). Eyes ride on top of any
 * extra in front of them (goggles).
 */
export type Extra = readonly [x: number, y: number, z: number, sx: number, sy: number, sz: number, ch: string, wob: number, from: 'front' | 'back' | 'mid'];

export interface MascotArt {
  /** metres per voxel */
  u: number;
  front: readonly string[];
  /** baked colours for the grid's other letters and the extras (0xRRGGBB) */
  pal: Readonly<Record<string, number>>;
  /** body (`#`, nubs), dark (feet) and glyph (eyes) colours */
  colors: { body: number; dark: number; glyph: number };
  /** full depth in voxels at the rim and in the middle: the body puffs up from its outline (even numbers) */
  depth: readonly [rim: number, mid: number];
  /** per-row cap on the depth (thin stalks, a neck); null = no cap */
  rowDepth?: readonly (number | null)[];
  /** per-row shift toward the front in voxels (a goose's neck and head ride forward of its body) */
  rowZ?: readonly number[];
  /** walk: `hop` = the Codex hop-waddle (bouncy shapes), `waddle` = alternate steps with a side-to-side rock */
  gait: 'hop' | 'waddle';
  /** eye glyph family: round `dot`s or Clawd-like `bar`s */
  eyes: 'dot' | 'bar';
  /** glyph cell size as a share of `u` */
  glyphCell: number;
  /** the neckerchief wraps this row; `gap` = half-width (voxels) of the front opening it leaves for the face */
  scarf: { row: number; gap: number };
  /** tier hat scale (1 ≈ a Codex-sized hat), a nudge back (voxels), and the row it sits on (default: the top row; a
   * lower row lets a spike, a crest or an antenna poke up through the hat) */
  hat: { s: number; dz?: number; row?: number };
  extras?: readonly Extra[];
  /** lobe / tuft wobble strength (Codex 0.09, Clawd 0.03) */
  wobble?: number;
}

const WHITE = 0xf7f5ef;

export const ART: Readonly<Record<ArtId, MascotArt>> = Object.freeze({
  // A four-point sparkle, blue at the tip shading to violet and rose at the base; the side points are its arms.
  gemini: {
    u: 0.066,
    front: [
      '.........b.........',
      '.........b.........',
      '........bbb........',
      '.......bbbbb.......',
      '......bbbbbbb......',
      '......ccccccc......',
      '....ccccccccccc....',
      '...#############...',
      'aa###############aa',
      'aa#####E###E#####aa',
      'aa###############aa',
      '...vvvvvvvvvvvvv...',
      '....vvvvvvvvvvv....',
      '......ppppppp......',
      '......ppppppp......',
      '......fff.fff......',
      '......fff.fff......',
    ],
    pal: { b: 0x5a9cf2, c: 0x6c8cf0, v: 0x9479e2, p: 0xb877cf, h: 0xffffff },
    colors: { body: 0x7d82ec, dark: 0x5a4fb0, glyph: 0x151438 },
    depth: [4, 8],
    rowDepth: [2, 2, 2, 4, 4, 6, 6, null],
    gait: 'hop', eyes: 'dot', glyphCell: 0.5,
    scarf: { row: 11, gap: 3 },
    hat: { s: 0.62, row: 3 },
    // a glint on the upper face
    extras: [[6.5, 7.6, 0.2, 0.8, 0.8, 0.5, 'h', 0, 'front'], [5.6, 7.2, 0.15, 0.45, 0.45, 0.4, 'h', 0, 'front']],
    wobble: 0.05,
  },
  // Polly, the pair-programmer parrot: green with a yellow belly, a hooked beak, a red crest and a long blue tail.
  aider: {
    u: 0.068,
    front: [
      '.......r.r......',
      '......rrrrr.....',
      '.....######.....',
      '....########....',
      '...##########...',
      '...#ww####ww#...',
      '...#wE####Ew#...',
      '...###kkkk###...',
      'aa####kkkk####aa',
      'aa####ykky####aa',
      'aa###yyyyyy###aa',
      '...#yyyyyyyy#...',
      '...#yyyyyyyy#...',
      '....##yyyy##....',
      '.....######.....',
      '.....ff..ff.....',
      '.....ff..ff.....',
    ],
    pal: { r: 0xe0453a, w: 0xfbf7ea, k: 0xf2b134, y: 0xf3d54e, K: 0x3a2f2a, t: 0x3b7dd8, T: 0xe0453a },
    colors: { body: 0x4fb04a, dark: 0x8c8f99, glyph: 0x1a1a1a },
    depth: [6, 10],
    rowDepth: [2, 4, null],
    gait: 'waddle', eyes: 'dot', glyphCell: 0.42,
    scarf: { row: 13, gap: 2.5 },
    hat: { s: 0.72, dz: 0.5, row: 2 },
    extras: [
      [8, 8.4, 0.9, 3.2, 2.6, 2.2, 'k', 0, 'front'], // the beak, out front…
      [8, 9.9, 1.3, 2.0, 1.4, 1.4, 'K', 0, 'front'], // …hooked down to a dark tip
      [8, 13.6, -0.6, 3.0, 4.4, 1.4, 't', 1, 'back'], // the long tail feathers down the back
      [8, 16.3, -0.8, 2.2, 1.2, 1.2, 'T', 1, 'back'],
    ],
    wobble: 0.04,
  },
  // A tall dark block with an open square frame for a face (the frame's gap at the bottom keeps it "open").
  opencode: {
    u: 0.072,
    front: [
      '..############..',
      '..############..',
      '..#wwwwwwwwww#..',
      '..#w########w#..',
      '..#w##E##E##w#..',
      '..#w########w#..',
      '..#w########w#..',
      '..#w########w#..',
      '..#ww######ww#..',
      '..#wwww##wwww#..',
      'aa############aa',
      'aa############aa',
      'aa############aa',
      '..############..',
      '..############..',
      '..############..',
      '....ff....ff....',
      '....ff....ff....',
    ],
    pal: { w: 0xefeee9 },
    colors: { body: 0x2e2f35, dark: 0x16161a, glyph: 0xf4f3ee },
    depth: [8, 10],
    gait: 'waddle', eyes: 'bar', glyphCell: 0.55,
    scarf: { row: 12, gap: 4 },
    hat: { s: 0.95 },
    wobble: 0.02,
  },
  // A grey farm goose (a Toulouse): plump body, a white bib down the long neck that carries the head forward, an
  // orange beak and orange feet.
  goose: {
    u: 0.066,
    front: [
      '......####......',
      '......####......',
      '......E##E......',
      '......#oo#......',
      '......#oo#......',
      '......####......',
      '......####......',
      '......#ww#......',
      '......wwww......',
      '....##wwww##....',
      '..####wwww####..',
      'aa####wwww####aa',
      'aa#####ww#####aa',
      'aa############aa',
      '..############..',
      '...##########...',
      '....ff....ff....',
      '....ff....ff....',
    ],
    pal: { o: 0xf08a24, n: 0x3a2a20, g: 0x8c7a6a, w: 0xf6f3ec },
    colors: { body: 0xa89482, dark: 0xf08a24, glyph: 0x1d1a18 },
    depth: [8, 14],
    rowDepth: [6, 6, 6, 6, 6, 4, 4, 4, 4, null],
    rowZ: [3, 3, 3, 3, 3, 2, 2, 1, 1, 0],
    gait: 'waddle', eyes: 'dot', glyphCell: 0.4,
    scarf: { row: 7, gap: 1 },
    hat: { s: 0.6 },
    extras: [
      [8, 4.3, 1.0, 2.2, 1.6, 2.4, 'o', 0, 'front'], // the beak, out from the face
      [8, 4.3, 2.3, 1.2, 1.0, 0.6, 'n', 0, 'front'], // its nail
      [8, 10.6, -0.6, 5.0, 2.0, 2.4, 'g', 1, 'back'], // an upturned tail
      [8, 9.7, -1.6, 3.0, 1.6, 1.4, 'g', 1, 'back'],
    ],
    wobble: 0.04,
  },
  // An isometric cube on a corner: a light top face with a white pointer facet, a mid left face, a dark right face.
  cursor: {
    u: 0.064,
    front: [
      '........##........',
      '......######......',
      '....##########....',
      '..######ww######..',
      'llllll#wwww#rrrrrr',
      'lllllll#ww#rrrrrrr',
      'llllllll##rrrrrrrr',
      'lllllllllrrrrrrrrr',
      'lllElllllrrrrrErrr',
      'aallllllllrrrrrraa',
      'aallllllllrrrrrraa',
      '.llllllllrrrrrrrr.',
      '...llllllrrrrrr...',
      '.....llllrrrr.....',
      '.....ff....ff.....',
      '.....ff....ff.....',
    ],
    pal: { l: 0x6a6e78, r: 0x3a3c43, w: 0xfbfbfb },
    colors: { body: 0xb9bcc6, dark: 0x26272c, glyph: 0xf6f6f2 },
    depth: [10, 10],
    gait: 'waddle', eyes: 'bar', glyphCell: 0.5,
    scarf: { row: 12, gap: 3 },
    hat: { s: 0.62 },
    wobble: 0.02,
  },
  // An "A"-frame: a red triangle with a cream crossbar for a face, standing on the A's two legs.
  amp: {
    u: 0.068,
    front: [
      '.......##.......',
      '......####......',
      '......####......',
      '.....######.....',
      '.....######.....',
      '....########....',
      '....########....',
      '...##########...',
      '..wwwwwwwwwwww..',
      'aawwEwwwwwwEwwaa',
      'aawwwwwwwwwwwwaa',
      '.##############.',
      '.######..######.',
      '#######..#######',
      '#######..#######',
      '..ff........ff..',
      '..ff........ff..',
    ],
    pal: { w: 0xfaf0dc },
    colors: { body: 0xd8344a, dark: 0x5a1c24, glyph: 0x2a1418 },
    depth: [6, 10],
    rowDepth: [4, 4, 6, 6, 8, null],
    gait: 'waddle', eyes: 'dot', glyphCell: 0.42,
    scarf: { row: 11, gap: 3 },
    hat: { s: 0.55 },
    wobble: 0.02,
  },
  // A heart in Charm's pinks, a shine on the left lobe.
  crush: {
    u: 0.064,
    front: [
      '...####....####...',
      '..######..######..',
      '.#ww#############.',
      '#ww###############',
      '##################',
      'aa####E####E####aa',
      'aa##############aa',
      'aa##############aa',
      '..##############..',
      '...############...',
      '....##########....',
      '.....########.....',
      '......######......',
      '......ff..ff......',
      '......ff..ff......',
    ],
    pal: { w: 0xffe6f6 },
    colors: { body: 0xf05bbd, dark: 0x8a2f8c, glyph: 0x3a0f2c },
    depth: [6, 12],
    gait: 'hop', eyes: 'dot', glyphCell: 0.48,
    scarf: { row: 9, gap: 3 },
    hat: { s: 0.62, dz: 0 },
    wobble: 0.07,
  },
  // A round purple body ringed in white, the ring's tail flicking out at the bottom right like a Q.
  qwen: {
    u: 0.07,
    front: [
      '..###........###..',
      '..####......####..',
      '..##############..',
      '..#####wwww#####..',
      '..###ww####ww###..',
      '..##w########w##..',
      'aa##w#E####E#w##aa',
      'aa##w########w##aa',
      'aa##w########w##aa',
      '..###ww####wwq##..',
      '..#####wwww##qq#..',
      '...###########qq..',
      '.....########.....',
      '......ff..ff......',
      '......ff..ff......',
    ],
    pal: { w: 0xf3f0ff, q: 0xf3f0ff },
    colors: { body: 0x6b52e8, dark: 0x2e2366, glyph: 0x161038 },
    depth: [6, 12],
    gait: 'hop', eyes: 'dot', glyphCell: 0.45,
    scarf: { row: 11, gap: 3 },
    hat: { s: 0.68, row: 2 },
    wobble: 0.06,
  },
  // A pilot's helmet: big goggles, little ear cups, the helmet is the whole body.
  copilot: {
    u: 0.064,
    front: [
      '.....##########.....',
      '...##############...',
      '..################..',
      'pp################pp',
      'pp#gggggg##gggggg#pp',
      'pp#gggggg##gggggg#pp',
      'pp#ggEggg##gggEgg#pp',
      '..#gggggg##gggggg#..',
      '..##gggg####gggg##..',
      '..aa############aa..',
      '..aa#####mm#####aa..',
      '......########......',
      '.......######.......',
      '.......ff..ff.......',
      '.......ff..ff.......',
    ],
    pal: { g: 0xd9f1ff, p: 0x9a7cf0, m: 0x2a2c3e },
    colors: { body: 0x4d5170, dark: 0x22243a, glyph: 0x141626 },
    depth: [8, 12],
    gait: 'waddle', eyes: 'bar', glyphCell: 0.5,
    scarf: { row: 11, gap: 3 },
    hat: { s: 0.82 },
    // the goggles stand proud of the helmet
    extras: [[5, 6.5, 0.3, 6.4, 4.6, 0.8, 'g', 0, 'front'], [13, 6.5, 0.3, 6.4, 4.6, 0.8, 'g', 0, 'front']],
    wobble: 0.02,
  },
  // Any other agent: a friendly tin sprout-bot, a cream screen face and a seedling on its antenna.
  bot: {
    u: 0.068,
    front: [
      '.......l.l......',
      '.......lll......',
      '........s.......',
      '........s.......',
      '...##########...',
      '..############..',
      '..#wwwwwwwwww#..',
      '..#wwEwwwwEww#..',
      '..#wwwwwwwwww#..',
      'aa#wwwwmmwwww#aa',
      'aa############aa',
      'aa############aa',
      '..############..',
      '...##########...',
      '....ff....ff....',
      '....ff....ff....',
    ],
    pal: { l: 0x6cc04a, s: 0x8a8f96, w: WHITE, m: 0x3b4a44 },
    colors: { body: 0x6fb3a0, dark: 0x3d5a52, glyph: 0x1f2a26 },
    depth: [8, 10],
    rowDepth: [2, 2, 2, 2, null],
    gait: 'waddle', eyes: 'dot', glyphCell: 0.45,
    scarf: { row: 12, gap: 4 },
    hat: { s: 0.82, dz: 0.5, row: 4 },
    wobble: 0.03,
  },
});

/** The baked colour of one grid character (null = empty, arm or foot). */
export function charColor(a: MascotArt, ch: string | undefined): number | null {
  if (!ch || ch === '.' || ch === 'a' || ch === 'f') return null;
  return ch === '#' || ch === 'E' ? a.colors.body : a.pal[ch] ?? a.colors.body;
}

/** The colour of one grid cell: `E` (an eye) takes its nearest row neighbour's colour (an eye sits on its bed). */
export function cellColor(a: MascotArt, r: number, c: number): number | null {
  const row = a.front[r] ?? '';
  if (row[c] !== 'E') return charColor(a, row[c]);
  for (let k = 1; k < row.length; k++) for (const n of [row[c - k], row[c + k]]) if (n && n !== 'E' && charColor(a, n) !== null) return charColor(a, n);
  return a.colors.body;
}
