// @pure
/**
 * THE MASCOT DESIGN FILE. Every voxel shape of the farmers lives here as plain data, so the look can be tweaked
 * without touching the rig: edit a string grid, reload, done. geo.ts turns these into meshes; rig.ts reads the derived
 * dimensions (where the legs, nubs, eyes and hats attach).
 *
 * Grids are read the way you see the mascot from the FRONT: column 0 is the viewer's left (= model +x is to the viewer's
 * right, matching three's camera), row 0 is the top. Every character is one cube of `u` metres.
 *
 *   Clawd  (kind 'claude'; villagers are Clawds in their own colours)
 *     The Claude Code banner sprite read as pixel art. Terminal cells are twice as tall as they are wide, so every
 *     sprite pixel is about 1 voxel wide and 2 voxels tall, chunked up into a sturdier toy (2-wide legs, 3-tall nubs):
 *          ▐▛███▜▌
 *         ▝▜█████▛▘
 *           ▘▘ ▝▝
 *     legend:  #  body     e  eye (body voxel; the eye glyph is drawn on top of it, so it can blink)
 *              a  arm nub  l  leg          .  empty
 *     The body is extruded `depth` voxels. A leg is a run of adjacent `l` columns, `legDepth` deep; the outer pair stands toward the front, the inner
 *     pair toward the back, so from the side you see two legs and from the front all four with the gap in the middle.
 *
 *   Codex  (kind 'codex')
 *     OpenAI Codex's mark as a mascot: an off-white scalloped cloud-blob with a flat bottom and a `>_` prompt face.
 *     legend:  #  body     E  centre of the `>` eye glyph     M  centre of the `_` cursor-mouth glyph
 *              a  arm nub  f  foot     .  empty
 *     The body is puffy: its depth grows with the distance from the outline (`edgeDepth` at the rim up to
 *     `maxDepth`), so the lobes read as rounded pillows from every angle.
 *
 *   Glyphs  eyes, `>`, `_`, `^`, X … as small cell grids (`#` filled). A glyph is drawn centred on its anchor, one cell
 *           = `glyphCell` metres for that mascot, and a few cells proud of the body so it catches light and outline.
 *
 *   The other mascots (Gemini sparkle, Aider parrot, OpenCode block, goose, Cursor cube, Amp A-frame, Crush heart, Qwen
 *   ring, Copilot pilot and the sprout-bot for any other agent) are drawn from the shared art in model/mascots.ts
 *   (`ART`: a front grid, a palette, a puffy depth profile and a few extra boxes) by `artBody` / `artPlan` below, so
 *   the HUD portraits read the very same grids. They all stand on two feet (the shared Codex slipper, scaled).
 *
 * Nothing here imports three: the mesher below emits plain arrays (and is unit-tested in node).
 */
import { ART, ART_IDS, MASCOTS, charColor } from '../../model/mascots.ts';
import type { ArtId, MascotArt, MascotId } from '../../model/mascots.ts';

/** Every farmer body: Clawd, the Codex cloud, and the art mascots. */
export type Body = MascotId;
export const BODIES: readonly Body[] = MASCOTS;
/**
 * How a body moves and emotes: `gait` scuttle (Clawd's four legs) / hop (Codex's hop-waddle) / waddle (alternate steps,
 * rocking side to side); `face` clawd (bar eyes) / codex (`>_`) / dot (round eyes); lobe `wobble`; `legs` four legs or
 * two feet.
 */
export interface BodyStyle { gait: 'scuttle' | 'hop' | 'waddle'; face: 'clawd' | 'codex' | 'dot'; wobble: number; legs: 'legs' | 'feet' }
export const BODY_STYLE: Readonly<Record<Body, BodyStyle>> = Object.freeze({
  clawd: { gait: 'scuttle', face: 'clawd', wobble: 0.03, legs: 'legs' },
  codex: { gait: 'hop', face: 'codex', wobble: 0.09, legs: 'feet' },
  ...Object.fromEntries(ART_IDS.map((id) => [id, { gait: ART[id].gait, face: ART[id].eyes === 'dot' ? 'dot' : 'clawd', wobble: ART[id].wobble ?? 0.03, legs: 'feet' }])) as Record<ArtId, BodyStyle>,
});
export const isArt = (b: Body): b is ArtId => (ART_IDS as readonly string[]).includes(b);

// ---------------------------------------------------------------------------------------------------------------------
// Clawd

export const CLAWD = {
  u: 0.088,
  depth: 7,
  legDepth: 3,
  /** z of the leg column centres (voxels from the body centre): outer pair forward, inner pair back */
  legZOuter: 1.8,
  legZInner: -1.8,
  /** the scarf wraps the body on this row (0 = top body row) */
  scarfRow: 4,
  /**
   * The banner sprite, chunked up into a sturdier toy: legs two voxels wide and three tall (the leg band reads in the
   * walk cycle), arm nubs three voxels tall, the body 14 × 9.
   */
  front: [
    '..##############..',
    '..##############..',
    '..##e########e##..',
    '..##e########e##..',
    'aa##############aa',
    'aa##############aa',
    'aa##############aa',
    '..##############..',
    '..##############..',
    '...ll.ll..ll.ll...',
    '...ll.ll..ll.ll...',
    '...ll.ll..ll.ll...',
  ],
  /** Gemini's sparkle, centred on the front face this many voxels below the body top */
  starRow: 6.3,
} as const;

/** Body colours per kind (0xRRGGBB): Clawd and Codex (the gemini / agent recolours are the villagers' yardstick: villager
 * colours stay clear of every agent colour). The art mascots' colours live in model/mascots.ts `ART[id].colors`. */
export const KIND_COLORS = {
  claude: { body: 0xd97757, dark: 0xb65d40, glyph: 0x1f1512 },
  gemini: { body: 0x6f72e6, dark: 0x5456c2, glyph: 0x17163a },
  agent: { body: 0x9c9ea6, dark: 0x7c7e86, glyph: 0x1c1d22 },
  codex: { body: 0xf4f1ea, dark: 0x2c2c33, glyph: 0x1b1b20 },
} as const;
export const STAR_COLOR = 0xfff0a8;

// ---------------------------------------------------------------------------------------------------------------------
// Codex

export const CODEX = {
  u: 0.063,
  /** total depth (voxels) in the middle and at the rim: a slab with a one-voxel bevel, grooved where lobes meet */
  maxDepth: 8,
  edgeDepth: 6,
  /** the scarf wraps the body on this row (0 = top row) */
  scarfRow: 11,
  front: [
    '.........######.........',
    '....###..######..###....',
    '...#####.######.#####...',
    '...##################...',
    '...##################...',
    '....################....',
    '...##################...',
    'aa#######E############aa',
    'aa####################aa',
    'aa############M#######aa',
    '...##################...',
    '....################....',
    '...##################...',
    '...##################...',
    '....################....',
    '......ffff....ffff......',
    '......ffff....ffff......',
  ],
  /** foot depth (voxels) */
  footDepth: 4,
} as const;

// ---------------------------------------------------------------------------------------------------------------------
// Glyphs (eyes and faces)

export const GLYPHS = {
  /** Clawd's open eye: a tall notch */
  bar: ['##', '##', '##', '##'],
  /** happy squint ^ */
  caret: ['.##.', '#..#'],
  /** content / asleep u */
  cup: ['#..#', '.##.'],
  /** closed eye, and the Codex cursor */
  dash: ['####'],
  cursor: ['###'],
  /** oops */
  x: ['#..#', '.##.', '.##.', '#..#'],
  /** frustrated > < */
  chevR: ['#..', '.#.', '..#', '.#.', '#..'],
  chevL: ['..#', '.#.', '#..', '.#.', '..#'],
  /** the Codex prompt `>` */
  prompt: ['##...', '.##..', '..##.', '.##..', '##...'],
  /** Codex happy ^ */
  hat: ['..#..', '.#.#.', '#...#'],
  /** surprised o */
  ring: ['.##.', '#..#', '#..#', '.##.'],
  /** a round open eye (the art mascots' `dot` eyes) */
  dot: ['.###.', '#####', '#####', '#####', '.###.'],
  /** sparkly proud eye */
  plus: ['.#.', '###', '.#.'],
} as const;
export type GlyphName = keyof typeof GLYPHS;
export const GLYPH_NAMES = Object.keys(GLYPHS) as GlyphName[];

// ---------------------------------------------------------------------------------------------------------------------
// Hats (tier) — stacked voxel ellipses, `HAT_VOXEL` metres per cell. slot 3 = hat colour, 2 = band / trim.

export interface HatLayer { rx: number; rz: number; slot: 3 | 2 | 0; shade?: number; rgb?: number; dz?: number; dx?: number }
export const HAT_VOXEL = 0.04;
export const HATS = {
  straw: { layers: [{ rx: 6.6, rz: 5.8, slot: 3 }, { rx: 3.4, rz: 3.0, slot: 2 }, { rx: 3.4, rz: 3.0, slot: 3, shade: 0.94 }, { rx: 3.0, rz: 2.6, slot: 3, shade: 0.94 }] as HatLayer[] },
  cap: { layers: [{ rx: 4.4, rz: 3.8, slot: 3 }, { rx: 4.2, rz: 3.6, slot: 3 }, { rx: 3.4, rz: 2.8, slot: 3, shade: 0.95 }] as HatLayer[] },
  bandana: { layers: [{ rx: 5.4, rz: 4.2, slot: 3 }, { rx: 4.6, rz: 3.4, slot: 3, shade: 0.95 }] as HatLayer[] },
  beanie: { layers: [{ rx: 4.5, rz: 4.0, slot: 3, shade: 0.8 }, { rx: 4.3, rz: 3.8, slot: 3 }, { rx: 3.9, rz: 3.4, slot: 3 }, { rx: 3.1, rz: 2.7, slot: 3 }, { rx: 1.8, rz: 1.6, slot: 3 }] as HatLayer[] },
} as const;
export type HatName = keyof typeof HATS;
export const HAT_NAMES = Object.keys(HATS) as HatName[];

// ---------------------------------------------------------------------------------------------------------------------
// Duckling (subagent) — voxel blobs, `u` metres per cell, feet at y = 0, facing +z.

export const DUCK = {
  u: 0.026,
  body: 0xffd84a,
  fluff: 0xffe98c,
  wing: 0xf5c334,
  bill: 0xf58a2a,
  eye: 0x1d1a18,
  egg: 0xf7f2e6,
  eggSpot: 0x9ccbe2,
} as const;

// =====================================================================================================================
// Voxel mesher (pure)

/** One cube on the integer grid (culled against its neighbours) or a free box (all faces). */
export interface Cell { x: number; y: number; z: number; slot: number; rgb: number; group: number; wob: number }
export interface Box { cx: number; cy: number; cz: number; sx: number; sy: number; sz: number; slot: number; rgb: number; group: number; wob: number; noBack?: boolean }

/** Flat arrays for a BufferGeometry: 3 floats per vertex for position/normal/color, 1 for slot/group/wob. */
export interface VoxMesh { position: Float32Array; normal: Float32Array; color: Float32Array; slot: Float32Array; group: Float32Array; wob: Float32Array; count: number }

const DIRS: readonly (readonly [number, number, number])[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
/** the 4 corners of a unit cube face in direction d (counter-clockwise seen from outside) */
const FACE: readonly (readonly (readonly [number, number, number])[])[] = [
  [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
  [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]],
  [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]],
  [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],
];

const hash3 = (x: number, y: number, z: number, s = 0) => {
  let h = (Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(z | 0, 83492791) ^ Math.imul(s, 2654435761)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export class Vox {
  readonly cells = new Map<string, Cell>();
  readonly boxes: Box[] = [];
  /** ± lightness jitter per cube face, the hand-painted voxel look */
  jitter = 0.035;
  /** per-vertex wobble weight for grid cells (continuous, so neighbouring cubes never crack apart); overrides `wob` */
  wobAt: ((x: number, y: number, z: number) => number) | null = null;
  cell(x: number, y: number, z: number, slot: number, rgb = 0xffffff, group = 0, wob = 0): void {
    this.cells.set(`${x},${y},${z}`, { x, y, z, slot, rgb, group, wob });
  }
  has(x: number, y: number, z: number): boolean { return this.cells.has(`${x},${y},${z}`); }
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, slot: number, rgb = 0xffffff, group = 0, wob = 0, noBack = false): void {
    this.boxes.push({ cx, cy, cz, sx, sy, sz, slot, rgb, group, wob, noBack });
  }
  /** Fill an axis-aligned ellipsoid of cells (centre in cell units, radii in cells). */
  ellipsoid(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, slot: number, rgb: number, group = 0, wob = 0, cut?: (x: number, y: number, z: number) => boolean): void {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, dz = (z + 0.5 - cz) / rz;
      if (dx * dx + dy * dy + dz * dz <= 1 && !(cut?.(x, y, z))) this.cell(x, y, z, slot, rgb, group, wob);
    }
  }

  /**
   * Emit triangles, scaled by `u` metres per cell and shifted by (ox, oy, oz) cells. A face between two cells is
   * culled only when the neighbour is always drawn (group 0) or in the same variant group, so hiding a variant
   * never opens a hole.
   */
  mesh(u: number, ox = 0, oy = 0, oz = 0): VoxMesh {
    const P: number[] = [], N: number[] = [], C: number[] = [], S: number[] = [], G: number[] = [], W: number[] = [];
    const quad = (pts: readonly (readonly [number, number, number])[], n: readonly [number, number, number], rgb: number, shade: number, slot: number, group: number, wob: number) => {
      const r = ((rgb >> 16) & 255) / 255 * shade, g = ((rgb >> 8) & 255) / 255 * shade, b = (rgb & 255) / 255 * shade;
      for (const i of [0, 1, 2, 0, 2, 3]) {
        const p = pts[i];
        P.push(p[0] * u, p[1] * u, p[2] * u);
        N.push(n[0], n[1], n[2]);
        C.push(r, g, b); S.push(slot); G.push(group); W.push(wob);
      }
    };
    const quadW = (pts: readonly (readonly [number, number, number])[], n: readonly [number, number, number], rgb: number, shade: number, slot: number, group: number, wf: (p: readonly [number, number, number]) => number) => {
      const start = W.length;
      quad(pts, n, rgb, shade, slot, group, 0);
      [0, 1, 2, 0, 2, 3].forEach((k, j) => { W[start + j] = wf(pts[k]); });
    };
    for (const c of this.cells.values()) {
      for (let d = 0; d < 6; d++) {
        const [dx, dy, dz] = DIRS[d];
        const nb = this.cells.get(`${c.x + dx},${c.y + dy},${c.z + dz}`);
        if (nb && (nb.group === 0 || nb.group === c.group)) continue;
        const shade = 1 + (hash3(c.x, c.y, c.z, d) - 0.5) * 2 * this.jitter;
        const pts = FACE[d].map(([a, b, e]) => [c.x + a + ox, c.y + b + oy, c.z + e + oz] as const);
        if (this.wobAt) { const f = this.wobAt; quadW(pts, DIRS[d], c.rgb, shade, c.slot, c.group, (p) => f(p[0] - ox, p[1] - oy, p[2] - oz)); }
        else quad(pts, DIRS[d], c.rgb, shade, c.slot, c.group, c.wob);
      }
    }
    for (const b of this.boxes) {
      for (let d = 0; d < 6; d++) {
        if (b.noBack && d === 5) continue;
        const pts = FACE[d].map(([a, bb, e]) => [
          b.cx + (a - 0.5) * b.sx + ox, b.cy + (bb - 0.5) * b.sy + oy, b.cz + (e - 0.5) * b.sz + oz,
        ] as const);
        const shade = 1 + (hash3(Math.round(b.cx * 7), Math.round(b.cy * 7), Math.round(b.cz * 7), d + 11) - 0.5) * 2 * this.jitter;
        quad(pts, DIRS[d], b.rgb, shade, b.slot, b.group, b.wob);
      }
    }
    return {
      position: new Float32Array(P), normal: new Float32Array(N), color: new Float32Array(C), slot: new Float32Array(S), group: new Float32Array(G), wob: new Float32Array(W),
      count: P.length / 3,
    };
  }
}

/** Concatenate meshes (same attribute layout). */
export function joinMeshes(list: VoxMesh[]): VoxMesh {
  const n = list.reduce((s, m) => s + m.count, 0);
  const out: VoxMesh = { position: new Float32Array(n * 3), normal: new Float32Array(n * 3), color: new Float32Array(n * 3), slot: new Float32Array(n), group: new Float32Array(n), wob: new Float32Array(n), count: n };
  let o = 0;
  for (const m of list) {
    out.position.set(m.position, o * 3); out.normal.set(m.normal, o * 3); out.color.set(m.color, o * 3);
    out.slot.set(m.slot, o); out.group.set(m.group, o); out.wob.set(m.wob, o);
    o += m.count;
  }
  return out;
}

// =====================================================================================================================
// Parsing the grids into cells + attachment points

interface Found { cells: [number, number][]; }
function scan(grid: readonly string[], ch: string): Found {
  const cells: [number, number][] = [];
  grid.forEach((row, r) => { for (let c = 0; c < row.length; c++) if (row[c] === ch) cells.push([c, r]); });
  return { cells };
}
const centroid = (cs: [number, number][]) => { let x = 0, y = 0; for (const [a, b] of cs) { x += a; y += b; } return [x / cs.length, y / cs.length] as const; };
/** split cells into left / right halves of the grid */
const halves = (cs: [number, number][], mid: number) => [cs.filter(([c]) => c + 0.5 > mid), cs.filter(([c]) => c + 0.5 <= mid)] as const;
/** group cells into legs: runs of adjacent columns, left → right */
const legRuns = (cs: [number, number][]) => {
  const cols = [...new Set(cs.map(([c]) => c))].sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const c of cols) { const last = runs[runs.length - 1]; if (last && c === last[last.length - 1] + 1) last.push(c); else runs.push([c]); }
  return runs;
};

/** Everything the rig needs to know about one body plan, in metres (model space: +z front, +x model-left, y up). */
export interface Plan {
  body: Body;
  u: number;
  /** body block, measured from the body pivot (bottom centre of the body) */
  w: number; h: number; d: number;
  /** leg / foot length below the body bottom when standing */
  legLen: number;
  /** leg / foot anchor points under the body (x, z), and their order: Clawd FL, FR, BL, BR; Codex L, R */
  hips: { x: number; z: number }[];
  /** model-left shoulder (the right one mirrors x); the nub extends along +x by `armLen` */
  shoulder: { x: number; y: number; z: number };
  armLen: number;
  armW: number;
  /** glyph anchors on the front face (centre, body space): [left eye (viewer's left), right eye] or [prompt, cursor] */
  glyphs: { x: number; y: number; z: number }[];
  glyphCell: number;
  /** hat anchor (top centre of the body) and scale */
  hat: { x: number; y: number; z: number; s: number };
  /** height of the eyes, for look-at and emote placement */
  eyeY: number;
  /** two-footed bodies: scale of the shared Codex slipper (x, y, z) */
  foot: { x: number; y: number; z: number };
}

/** Grid column / row → body-space metres. */
function mapper(grid: readonly string[], bodyCols: [number, number], bodyRows: [number, number], u: number) {
  const cx = (bodyCols[0] + bodyCols[1] + 1) / 2;
  const bottom = bodyRows[1] + 1;
  return { x: (c: number) => (c + 0.5 - cx) * u, y: (r: number) => (bottom - (r + 0.5)) * u, cx, bottom };
}

function bodyBounds(grid: readonly string[], body: string): { cols: [number, number]; rows: [number, number] } {
  let c0 = 1e9, c1 = -1, r0 = 1e9, r1 = -1;
  grid.forEach((row, r) => { for (let c = 0; c < row.length; c++) if (body.includes(row[c])) { c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r); } });
  return { cols: [c0, c1], rows: [r0, r1] };
}

export const clawdPlan = (): Plan => {
  const g = CLAWD.front, u = CLAWD.u;
  const bb = bodyBounds(g, '#e');
  const m = mapper(g, bb.cols, bb.rows, u);
  const legs = legRuns(scan(g, 'l').cells);
  const eyes = halves(scan(g, 'e').cells, m.cx);
  const arms = halves(scan(g, 'a').cells, m.cx);
  const armL = arms[0];
  const armRows = armL.map(([, r]) => r), armCols = armL.map(([c]) => c);
  const legLen = (Math.max(...scan(g, 'l').cells.map(([, r]) => r)) - bb.rows[1]) * u;
  // legs by column, left→right as seen from the front = −x … +x ; outer pair forward, inner pair back
  const lx = legs.map((run) => (m.x(run[0]) + m.x(run[run.length - 1])) / 2);
  const zo = CLAWD.legZOuter * u, zi = CLAWD.legZInner * u;
  // order: FL (+x outer), FR (−x outer), BL (+x inner), BR (−x inner)
  const hips = [{ x: lx[3], z: zo }, { x: lx[0], z: zo }, { x: lx[2], z: zi }, { x: lx[1], z: zi }];
  const e = [eyes[1], eyes[0]].map((cs) => { const [c, r] = centroid(cs); return { x: m.x(c), y: m.y(r), z: (CLAWD.depth / 2) * u }; });
  const h = (bb.rows[1] - bb.rows[0] + 1) * u;
  return {
    body: 'clawd', u, w: (bb.cols[1] - bb.cols[0] + 1) * u, h, d: CLAWD.depth * u, legLen, hips,
    shoulder: { x: m.x(bb.cols[1]) + u / 2, y: (m.y(Math.min(...armRows)) + m.y(Math.max(...armRows))) / 2, z: 0 },
    armLen: (Math.max(...armCols) - Math.min(...armCols) + 1) * u, armW: (Math.max(...armRows) - Math.min(...armRows) + 1) * u,
    glyphs: e, glyphCell: u * 0.58,
    hat: { x: 0, y: h, z: -0.2 * u, s: 1.22 }, eyeY: e[0].y, foot: { x: 1, y: 1, z: 1 },
  };
};

/**
 * Half-depth (in voxels) of each Codex front cell: a clean pillow. Cells on the rim get `edgeDepth`, one cell in gets a
 * step more, everything further in is `maxDepth`. The flat bottom stays full depth so it stands squarely.
 */
export function codexDepth(): number[][] {
  const g = CODEX.front;
  const bottom = bodyBounds(g, '#EM').rows[1];
  const solid = (c: number, r: number) => r > bottom || (r >= 0 && c >= 0 && c < g[r].length && '#EM'.includes(g[r][c]));
  const ring = (c: number, r: number, k: number) => {
    for (let dr = -k; dr <= k; dr++) for (let dc = -k; dc <= k; dc++) if (Math.abs(dr) + Math.abs(dc) <= k && !solid(c + dc, r + dr)) return true;
    return false;
  };
  const e = CODEX.edgeDepth / 2, m = CODEX.maxDepth / 2;
  return g.map((row, r) => [...row].map((_, c) => {
    if (r > bottom || !solid(c, r)) return 0;
    if (ring(c, r, 1)) return e;
    return m;
  }));
}

export const codexPlan = (): Plan => {
  const g = CODEX.front, u = CODEX.u;
  const bb = bodyBounds(g, '#EM');
  const m = mapper(g, bb.cols, bb.rows, u);
  const depth = codexDepth();
  const feet = halves(scan(g, 'f').cells, m.cx);
  const arms = halves(scan(g, 'a').cells, m.cx);
  const armRows = arms[0].map(([, r]) => r), armCols = arms[0].map(([c]) => c);
  const footRows = scan(g, 'f').cells.map(([, r]) => r);
  const legLen = (Math.max(...footRows) - bb.rows[1]) * u;
  const hips = [feet[0], feet[1]].map((cs) => { const [c] = centroid(cs); return { x: m.x(c), z: 0.3 * u }; });
  const anchor = (ch: string) => { const [[c, r]] = scan(g, ch).cells; return { x: m.x(c), y: m.y(r), z: depth[r][c] * u }; };
  const h = (bb.rows[1] - bb.rows[0] + 1) * u;
  return {
    body: 'codex', u, w: (bb.cols[1] - bb.cols[0] + 1) * u, h, d: CODEX.maxDepth * u, legLen, hips,
    shoulder: { x: m.x(bb.cols[1]) + u / 2 - 0.5 * u, y: (m.y(Math.min(...armRows)) + m.y(Math.max(...armRows))) / 2, z: 0 },
    armLen: (Math.max(...armCols) - Math.min(...armCols) + 1) * u + 0.5 * u, armW: (Math.max(...armRows) - Math.min(...armRows) + 1) * u,
    glyphs: [anchor('E'), anchor('M')], glyphCell: u,
    hat: { x: 0, y: h, z: 0, s: 1.05 }, eyeY: anchor('E').y, foot: { x: 1, y: 1, z: 1 },
  };
};

// ---------------------------------------------------------------------------------------------------------------------
// The art mascots (model/mascots.ts ART): depth profile, plan and body

const isBodyCh = (a: MascotArt, ch: string | undefined) => charColor(a, ch) !== null;

/** Body rows / columns of an art grid (everything but `.`, `a` and `f`). */
function artBounds(a: MascotArt): { cols: [number, number]; rows: [number, number] } {
  let c0 = 1e9, c1 = -1, r0 = 1e9, r1 = -1;
  a.front.forEach((row, r) => { for (let c = 0; c < row.length; c++) if (isBodyCh(a, row[c])) { c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r); } });
  return { cols: [c0, c1], rows: [r0, r1] };
}

/**
 * Half-depth (voxels) of every grid cell of an art mascot: the rim gets `depth[0]`, each ring further in two voxels
 * more, up to `depth[1]` (or the row's cap); the flat bottom stays full depth so it stands squarely. 0 = no cell.
 */
export function artHalfDepth(id: ArtId): number[][] {
  const a = ART[id], g = a.front;
  const bottom = artBounds(a).rows[1];
  const solid = (c: number, r: number) => r > bottom || (r >= 0 && c >= 0 && c < g[r].length && isBodyCh(a, g[r][c]));
  const ringOpen = (c: number, r: number, k: number) => {
    for (let dr = -k; dr <= k; dr++) for (let dc = -k; dc <= k; dc++) if (Math.abs(dr) + Math.abs(dc) <= k && !solid(c + dc, r + dr)) return true;
    return false;
  };
  const [rim, mid] = a.depth;
  return g.map((row, r) => [...row].map((_, c) => {
    if (r > bottom || !solid(c, r)) return 0;
    let d = 1;
    while (d < 8 && !ringOpen(c, r, d)) d++;
    const cap = a.rowDepth?.[r] ?? mid;
    return Math.max(1, Math.round(Math.min(cap, Math.min(rim, cap) + (d - 1) * 2) / 2));
  }));
}

/** The body character of a cell, an eye (`E`) resolved to the cell it sits on. */
function bedChar(a: MascotArt, r: number, c: number): string {
  const row = a.front[r];
  if (row[c] !== 'E') return row[c];
  for (let k = 1; k < row.length; k++) for (const n of [row[c - k], row[c + k]]) if (n && n !== 'E' && isBodyCh(a, n)) return n;
  return '#';
}

/** Front / back surface z (voxels, rowZ included) of the body at grid point (x, y): the nearest cell in that row. */
function surfaceAt(a: MascotArt, H: number[][], x: number, y: number, side: 1 | -1): number {
  const bb = artBounds(a);
  const r = Math.max(bb.rows[0], Math.min(bb.rows[1], Math.floor(y)));
  const c0 = Math.floor(x);
  let h = 0;
  for (let k = 0; k < 20 && !h; k++) h = H[r][c0 - k] || H[r][c0 + k] || 0;
  return side * h + (a.rowZ?.[r] ?? 0);
}

/** The extra boxes in body-cell space (x right, y up from the body bottom, z front). */
function artExtras(a: MascotArt, H: number[][]) {
  const bb = artBounds(a);
  const cols = bb.cols[1] - bb.cols[0] + 1;
  return (a.extras ?? []).map(([x, y, z, sx, sy, sz, ch, wob, from]) => ({
    x: x - bb.cols[0] - cols / 2, y: bb.rows[1] + 1 - y,
    z: from === 'mid' ? z : surfaceAt(a, H, x, y, from === 'front' ? 1 : -1) + z, sx, sy, sz, ch, wob,
  }));
}

/** An art mascot's body plan (same contract as Clawd's and Codex's). */
export function artPlan(id: ArtId): Plan {
  const a = ART[id], g = a.front, u = a.u;
  const bb = artBounds(a);
  const m = mapper(g, bb.cols, bb.rows, u);
  const H = artHalfDepth(id);
  const rz = (r: number) => a.rowZ?.[r] ?? 0;
  const feet = halves(scan(g, 'f').cells, m.cx);
  const footRows = [...new Set(scan(g, 'f').cells.map(([, r]) => r))];
  const legLen = (Math.max(...footRows) - bb.rows[1]) * u;
  const hips = [feet[0], feet[1]].map((cs) => { const [c] = centroid(cs); return { x: m.x(c), z: 0.3 * u }; });
  const fw = legRuns(feet[0]).reduce((n, run) => Math.max(n, run.length), 0);
  const cfw = Math.max(...CODEX.front.map((r) => (r.match(/f+/) ?? [''])[0].length));
  const cfh = CODEX.front.filter((r) => r.includes('f')).length;
  const arm = halves(scan(g, 'a').cells, m.cx)[0];
  const armRows = [...new Set(arm.map(([, r]) => r))], armCols = arm.map(([c]) => c);
  let edge = -1;
  for (const r of armRows) for (let c = 0; c < g[r].length; c++) if (isBodyCh(a, g[r][c])) edge = Math.max(edge, c);
  const ex = artExtras(a, H);
  const eyes = scan(g, 'E').cells.sort((p, q) => p[0] - q[0]).map(([c, r]) => {
    let z = H[r][c] + rz(r);
    // eyes ride on top of anything proud in front of them (goggles)
    const gx = c - bb.cols[0] - (bb.cols[1] - bb.cols[0] + 1) / 2 + 0.5, gy = bb.rows[1] - r + 0.5;
    for (const b of ex) if (Math.abs(gx - b.x) <= b.sx / 2 && Math.abs(gy - b.y) <= b.sy / 2 && b.z + b.sz / 2 > z) z = b.z + b.sz / 2;
    return { x: m.x(c), y: m.y(r), z: z * u };
  });
  const h = (bb.rows[1] - bb.rows[0] + 1) * u;
  const hatRow = a.hat.row ?? bb.rows[0], topRow = g[hatRow];
  const topCols: number[] = [];
  for (let c = 0; c < topRow.length; c++) if (isBodyCh(a, topRow[c])) topCols.push(c);
  const maxHalf = Math.max(...H.flat());
  return {
    body: id, u, w: (bb.cols[1] - bb.cols[0] + 1) * u, h, d: maxHalf * 2 * u, legLen, hips,
    shoulder: { x: m.x(edge) + u / 2 - 0.5 * u, y: (m.y(Math.min(...armRows)) + m.y(Math.max(...armRows))) / 2, z: (armRows.reduce((s, r) => s + rz(r), 0) / armRows.length) * u },
    armLen: (Math.max(...armCols) - Math.min(...armCols) + 1) * u + 0.5 * u, armW: armRows.length * u,
    glyphs: [eyes[0], eyes[eyes.length - 1]], glyphCell: u * a.glyphCell,
    hat: { x: m.x((topCols[0] + topCols[topCols.length - 1]) / 2), y: (bb.rows[1] + 1 - hatRow) * u, z: (rz(hatRow) - (a.hat.dz ?? 0)) * u, s: a.hat.s },
    eyeY: eyes[0].y,
    foot: { x: (fw * u) / (cfw * CODEX.u), y: (footRows.length * u) / (cfh * CODEX.u), z: (fw * u) / (cfw * CODEX.u) },
  };
}

/** An art mascot's body (pivot: bottom centre), the neckerchief in slot 3, extras baked. */
export function artBody(id: ArtId): Vox {
  const a = ART[id], g = a.front;
  const v = new Vox();
  const bb = artBounds(a);
  const cols = bb.cols[1] - bb.cols[0] + 1, rows = bb.rows[1] - bb.rows[0] + 1;
  const H = artHalfDepth(id);
  if ((a.wobble ?? 0) >= 0.05) {
    const cyc = rows / 2, maxR = Math.hypot(cols / 2, rows / 2);
    v.wobAt = (x, y) => Math.max(0, (Math.hypot(x, y - cyc) / maxR - 0.5) / 0.5);
  }
  // baked colours are written straight into the (linear) vertex colours: convert the art's sRGB hex first, so the
  // body shows the very colour the HUD portrait paints (the `#` cells get it through the instance palette)
  const lin = (c: number) => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const shade = (rgb: number, k: number) => (Math.round(lin((rgb >> 16) & 255) * k * 255) << 16) | (Math.round(lin((rgb >> 8) & 255) * k * 255) << 8) | Math.round(lin(rgb & 255) * k * 255);
  for (let r = bb.rows[0]; r <= bb.rows[1]; r++) for (let c = bb.cols[0]; c <= bb.cols[1]; c++) {
    const half = H[r][c];
    if (!half) continue;
    const ch = bedChar(a, r, c);
    const x = c - bb.cols[0] - cols / 2, y = bb.rows[1] - r, zo = a.rowZ?.[r] ?? 0;
    const body = ch === '#';
    const rgb = body ? (y === 0 ? 0xd2d2d2 : 0xffffff) : shade(charColor(a, ch) ?? 0xffffff, y === 0 ? 0.86 : 1);
    for (let z = -half; z < half; z++) v.cell(x, y, z + zo, body ? SLOT.body : SLOT.fixed, rgb);
  }
  // the neckerchief: a band proud of every exposed cell of its row, leaving the face open; knot + tails at the right
  const sr = bb.rows[1] - a.scarf.row;
  let right = -1e9;
  for (const c of [...v.cells.values()]) {
    if (c.y !== sr) continue;
    let exposed = false, faceOn = false;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!v.has(c.x + dx, c.y, c.z + dz)) { exposed = true; if (dz === 1) faceOn = true; }
    if (!exposed || (faceOn && Math.abs(c.x + 0.5) < a.scarf.gap && c.z >= 0)) continue;
    v.box(c.x + 0.5, c.y + 0.5, c.z + 0.5, 1.22, 0.8, 1.22, SLOT.accent, 0xffffff);
    right = Math.max(right, c.x);
  }
  const kx = right + 1 - 2.2;
  let fz = -1e9;
  for (const c of v.cells.values()) if (c.y === sr && c.x === Math.floor(kx)) fz = Math.max(fz, c.z + 1);
  if (fz < -1e8) fz = 3;
  v.box(kx, sr + 0.5, fz + 0.45, 1.4, 1.2, 0.7, SLOT.accent, 0xdddddd);
  v.box(kx - 0.45, sr - 0.65, fz + 0.35, 0.8, 1.3, 0.35, SLOT.accent, 0xeeeeee, 0, 1);
  v.box(kx + 0.5, sr - 0.5, fz + 0.32, 0.7, 1.0, 0.35, SLOT.accent, 0xe4e4e4, 0, 1);
  for (const b of artExtras(a, H)) v.box(b.x, b.y, b.z, b.sx, b.sy, b.sz, SLOT.fixed, shade(a.pal[b.ch] ?? a.colors.body, 1), 0, b.wob);
  return v;
}

// =====================================================================================================================
// Shape builders (pure): cells for each part, in cell units with the part's pivot at the origin

/** slot ids the rig material reads: 0 = baked colour, 1 = body colour (A), 2 = dark / feet / hat trim (B), 3 = scarf or hat (C) */
export const SLOT = { fixed: 0, body: 1, dark: 2, accent: 3 } as const;

/** Clawd's body block (pivot: bottom centre). Group 1 = Gemini's star. Scarf in slot 3. */
export function clawdBody(): Vox {
  const v = new Vox();
  const g = CLAWD.front;
  const bb = bodyBounds(g, '#e');
  const rows = bb.rows[1] - bb.rows[0] + 1, cols = bb.cols[1] - bb.cols[0] + 1;
  const D = CLAWD.depth;
  for (let r = bb.rows[0]; r <= bb.rows[1]; r++) for (let c = bb.cols[0]; c <= bb.cols[1]; c++) {
    if (!'#e'.includes(g[r][c])) continue;
    const y = bb.rows[1] - r;
    for (let z = 0; z < D; z++) v.cell(c - bb.cols[0] - cols / 2, y, z - D / 2, SLOT.body, y === 0 ? 0xd2d2d2 : 0xffffff);
  }
  // scarf: a strip round the sides and back (never across the face: it would read as a mouth), knotted at the
  // front corner with two tails
  const sy = rows - 1 - CLAWD.scarfRow + 0.5, t = 0.55;
  const hw = cols / 2, hd = D / 2;
  v.box(0, sy, -hd - 0.08, cols + 0.3, t, 0.3, SLOT.accent, 0xffffff);
  for (const s of [-1, 1]) v.box(s * (hw + 0.08), sy, -0.25, 0.3, t, D - 0.2, SLOT.accent, 0xffffff);
  v.box(hw - 0.25, sy, hd - 0.3, 0.9, t, 0.9, SLOT.accent, 0xf2f2f2);
  v.box(hw - 0.35, sy, hd + 0.05, 1.0, 0.9, 0.5, SLOT.accent, 0xdddddd);
  v.box(hw - 0.75, sy - 0.85, hd + 0.08, 0.6, 1.1, 0.3, SLOT.accent, 0xeeeeee, 0, 1);
  v.box(hw + 0.05, sy - 0.7, hd + 0.05, 0.55, 0.9, 0.3, SLOT.accent, 0xe4e4e4, 0, 1);
  // Gemini's sparkle (group 1)
  const st = rows - CLAWD.starRow;
  const star = GLYPHS.plus;
  const cell = 0.5;
  star.forEach((row, r) => { for (let c = 0; c < row.length; c++) if (row[c] === '#') v.box((c - 1) * cell, st + (1 - r) * cell, hd + 0.12, cell, cell, 0.4, SLOT.fixed, STAR_COLOR, 1); });
  v.box(0, st, hd + 0.2, 0.5, 0.5, 0.4, SLOT.fixed, 0xffffff, 1);
  return v;
}

/** A Clawd leg: a block column hanging from its hip (pivot at the top centre), as wide as its grid run, `legDepth` deep. */
export function clawdLeg(): Vox {
  const v = new Vox();
  const n = CLAWD.front.filter((r) => r.includes('l')).length;
  const w = legRuns(scan(CLAWD.front, 'l').cells)[0].length;
  for (let y = 0; y < n; y++) for (let x = 0; x < w; x++) for (let z = 0; z < CLAWD.legDepth; z++) v.cell(x - w / 2, -1 - y, z - CLAWD.legDepth / 2, SLOT.body, y === n - 1 ? 0xc4c4c4 : 0xe6e6e6);
  return v;
}

/** An arm nub extending along +x from its pivot (the body side), centred in y and z. */
export function nub(len: number, w: number, d: number, slot: number, rgb = 0xffffff): Vox {
  const v = new Vox();
  for (let x = 0; x < len; x++) for (let y = 0; y < w; y++) for (let z = 0; z < d; z++) v.cell(x, y - w / 2, z - d / 2, slot, rgb);
  return v;
}

/** The Codex blob (pivot: bottom centre): puffy lobes, dark `>_` drawn by the glyph layer. Scarf in slot 3. */
export function codexBody(): Vox {
  const v = new Vox();
  const g = CODEX.front;
  const bb = bodyBounds(g, '#EM');
  const cols = bb.cols[1] - bb.cols[0] + 1, rows = bb.rows[1] - bb.rows[0] + 1;
  const depth = codexDepth();
  // lobes (far from the centre) wobble as secondary motion; weight is a smooth function of position
  const cyc = rows / 2, maxR = Math.hypot(cols / 2, rows / 2);
  v.wobAt = (x, y) => Math.max(0, (Math.hypot(x, y - cyc) / maxR - 0.5) / 0.5);
  for (let r = bb.rows[0]; r <= bb.rows[1]; r++) for (let c = bb.cols[0]; c <= bb.cols[1]; c++) {
    const half = depth[r][c];
    if (!half) continue;
    const x = c - bb.cols[0] - cols / 2, y = bb.rows[1] - r;
    for (let z = -half; z < half; z++) v.cell(x, y, z, SLOT.body, y === 0 ? 0xdcdad4 : 0xffffff);
  }
  // scarf row: a band proud of every exposed cell of that row, except across the face; knot + tails at the side
  const sr = bb.rows[1] - CODEX.scarfRow;
  const faceX = cols / 2 - 4;
  for (const c of [...v.cells.values()]) {
    if (c.y !== sr || c.group) continue;
    let exposed = false, front = false;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!v.has(c.x + dx, c.y, c.z + dz)) { exposed = true; if (dz === 1) front = true; }
    if (!exposed || (front && Math.abs(c.x + 0.5) < faceX && c.z > 0)) continue;
    v.box(c.x + 0.5, c.y + 0.5, c.z + 0.5, 1.22, 0.8, 1.22, SLOT.accent, 0xffffff);
  }
  const kx = cols / 2 - 2.2, fz = depth[CODEX.scarfRow][bb.cols[1] - 2] || 3;
  v.box(kx, sr + 0.5, fz + 0.45, 1.4, 1.2, 0.7, SLOT.accent, 0xdddddd);
  v.box(kx - 0.45, sr - 0.65, fz + 0.35, 0.8, 1.3, 0.35, SLOT.accent, 0xeeeeee, 0, 1);
  v.box(kx + 0.5, sr - 0.5, fz + 0.32, 0.7, 1.0, 0.35, SLOT.accent, 0xe4e4e4, 0, 1);
  return v;
}

/** A Codex foot: a rounded slipper under the body (pivot: top centre, toes toward +z). */
export function codexFoot(): Vox {
  const v = new Vox();
  const rows = CODEX.front.filter((r) => r.includes('f')).length;
  const w = Math.max(...CODEX.front.map((r) => (r.match(/f+/) ?? [''])[0].length));
  const d = CODEX.footDepth;
  for (let y = 0; y < rows; y++) for (let x = 0; x < w; x++) for (let z = 0; z < d + 1; z++) {
    const corner = (x === 0 || x === w - 1) && (z === 0 || z === d);
    if (corner && y === rows - 1) continue;
    if (z === d && y === 0) continue; // toe cap slopes
    v.cell(x - w / 2, -1 - y, z - d / 2, SLOT.dark);
  }
  return v;
}

/** A glyph as proud cells (pivot: glyph centre on the front surface; depth goes back into the body). */
export function glyph(name: GlyphName, group: number): Vox {
  const v = new Vox();
  v.jitter = 0;
  const g = GLYPHS[name];
  const h = g.length, w = g[0].length;
  g.forEach((row, r) => { for (let c = 0; c < w; c++) if (row[c] === '#') v.box(c + 0.5 - w / 2, h / 2 - r - 0.5, -0.9, 1, 1, 2.2, SLOT.body, 0xffffff, group, 0, true); });
  return v;
}

/** A tier hat as stacked voxel ellipses (pivot: bottom centre), plus the details each hat needs. */
export function hat(name: HatName, group: number): Vox {
  const v = new Vox();
  HATS[name].layers.forEach((L, y) => {
    for (let x = -Math.ceil(L.rx); x < Math.ceil(L.rx); x++) for (let z = -Math.ceil(L.rz); z < Math.ceil(L.rz); z++) {
      const dx = (x + 0.5 - (L.dx ?? 0)) / L.rx, dz = (z + 0.5 - (L.dz ?? 0)) / L.rz;
      if (dx * dx + dz * dz <= 1) v.cell(x, y, z, L.slot, L.rgb ?? Math.round((L.shade ?? 1) * 255) * 0x010101, group);
    }
  });
  const top = HATS[name].layers.length;
  switch (name) {
    case 'straw': {
      // woven lighter speckles on the brim
      for (const c of v.cells.values()) if (c.y === 0 && hash3(c.x, 5, c.z) < 0.18) c.rgb = 0xf0f0f0;
      break;
    }
    case 'cap': {
      for (let x = -3; x < 3; x++) for (let z = 4; z < 6; z++) v.cell(x, 0, z, 3, z === 5 ? 0xb8b8b8 : 0xc8c8c8, group); // visor
      v.box(0, top + 0.3, 0, 1, 0.6, 1, 2, 0xffffff, group); // button
      break;
    }
    case 'bandana': {
      for (const c of v.cells.values()) if (c.y === 1 && hash3(c.x, 9, c.z) < 0.22) c.rgb = 0xffffff; // dots (tinted by slot)
      for (const c of v.cells.values()) if (c.y === 1 && hash3(c.x, 9, c.z) < 0.22) { c.slot = 0; c.rgb = 0xfaf4e6; }
      v.box(0, 0.6, -4.6, 1.6, 1.2, 1.2, 3, 0xd8d8d8, group); // knot
      v.box(-0.7, 0.1, -5.4, 1, 0.8, 1.6, 3, 0xe8e8e8, group, 1);
      v.box(0.8, 0.3, -5.3, 1, 0.8, 1.4, 3, 0xe0e0e0, group, 1);
      break;
    }
    case 'beanie': {
      v.ellipsoid(0, top + 1.1, 0, 1.6, 1.5, 1.6, 2, 0xffffff, group); // pompom
      break;
    }
  }
  return v;
}

// =====================================================================================================================
// Villager dressing (scene/villagers): role hats and body wear. Villagers are Clawds too, so the mascot stays sacred;
// what marks them as villagers (not agents) is a non-agent body colour, a role hat instead of a tier hat, and one
// piece of wear over the body. All role hats share one instanced mesh (vgroup = ROLE_HAT_GROUP), all wear another.

/** Role hats — same stacked-ellipse format as HATS (HAT_VOXEL cells); slot 3 = hat colour, 2 = band / trim. */
export const ROLE_HATS = {
  /** postmaster: a tall peaked cap with a dark visor and a brass badge */
  postcap: { layers: [{ rx: 4.6, rz: 4.0, slot: 2 }, { rx: 4.6, rz: 4.0, slot: 3 }, { rx: 4.8, rz: 4.2, slot: 3 }, { rx: 5.2, rz: 4.6, slot: 3, shade: 0.94 }] as HatLayer[] },
  /** shipping clerk: a green celluloid eyeshade on a band */
  eyeshade: { layers: [{ rx: 4.5, rz: 3.9, slot: 2 }, { rx: 4.5, rz: 3.9, slot: 2, shade: 0.9 }] as HatLayer[] },
  /** miller: a floppy linen cap slumped to one side */
  millcap: { layers: [{ rx: 4.6, rz: 4.0, slot: 3 }, { rx: 5.4, rz: 4.8, slot: 3, dx: 0.4 }, { rx: 5.2, rz: 4.6, slot: 3, dx: 0.9, shade: 0.97 }, { rx: 4.0, rz: 3.6, slot: 3, dx: 1.4, shade: 0.93 }] as HatLayer[] },
  /** mayor: a top hat with a ribbon band */
  tophat: { layers: [{ rx: 6.0, rz: 5.2, slot: 3, shade: 0.9 }, { rx: 3.6, rz: 3.2, slot: 2 }, { rx: 3.6, rz: 3.2, slot: 2 }, { rx: 3.6, rz: 3.2, slot: 3 }, { rx: 3.6, rz: 3.2, slot: 3 }, { rx: 3.6, rz: 3.2, slot: 3 }, { rx: 3.7, rz: 3.3, slot: 3, shade: 0.92 }] as HatLayer[] },
  /** ranger: a wide-brimmed campaign hat with a pinched crown */
  ranger: { layers: [{ rx: 7.0, rz: 6.2, slot: 3 }, { rx: 3.8, rz: 3.4, slot: 2 }, { rx: 3.6, rz: 3.2, slot: 3, shade: 0.96 }, { rx: 3.0, rz: 2.6, slot: 3, shade: 0.93 }, { rx: 1.8, rz: 1.5, slot: 3, shade: 0.9 }] as HatLayer[] },
  /** weather-watcher: a sou'wester, the brim long at the back to shed the rain */
  souwester: { layers: [{ rx: 5.8, rz: 5.8, slot: 3, dz: -1.0 }, { rx: 4.2, rz: 3.8, slot: 3 }, { rx: 3.9, rz: 3.5, slot: 3, shade: 0.96 }, { rx: 3.1, rz: 2.7, slot: 3, shade: 0.92 }, { rx: 1.6, rz: 1.4, slot: 3, shade: 0.9 }] as HatLayer[] },
} as const;
export type RoleHatName = keyof typeof ROLE_HATS;
export const ROLE_HAT_NAMES = Object.keys(ROLE_HATS) as RoleHatName[];

const BRASS = 0xe2b64a, LEATHER_D = 0x5a3a22, PAPER = 0xf6efdc, SEAL = 0xd9453b, FLOUR = 0xf3eee4;

/** A role hat (pivot: bottom centre, HAT_VOXEL cells, front = +z). */
export function roleHat(name: RoleHatName, group: number): Vox {
  const v = new Vox();
  ROLE_HATS[name].layers.forEach((L, y) => {
    for (let x = -Math.ceil(L.rx) - 1; x < Math.ceil(L.rx) + 1; x++) for (let z = -Math.ceil(L.rz) - 2; z < Math.ceil(L.rz) + 1; z++) {
      const dx = (x + 0.5 - (L.dx ?? 0)) / L.rx, dz = (z + 0.5 - (L.dz ?? 0)) / L.rz;
      if (dx * dx + dz * dz <= 1) v.cell(x, y, z, L.slot, L.rgb ?? Math.round((L.shade ?? 1) * 255) * 0x010101, group);
    }
  });
  const top = ROLE_HATS[name].layers.length;
  switch (name) {
    case 'postcap':
      for (let x = -3; x < 3; x++) for (let z = 4; z < 7; z++) v.cell(x, 0, z, 2, z === 6 ? 0x9a9a9a : 0xb8b8b8, group); // visor
      v.box(0, 2.0, 4.35, 1.6, 1.4, 0.5, 0, BRASS, group); // badge
      v.box(0, 2.0, 4.6, 0.6, 0.6, 0.2, 0, 0xfff2b8, group);
      break;
    case 'eyeshade':
      // the translucent-green visor, angled down over the eyes
      for (let x = -4; x < 4; x++) { for (let z = 4; z < 7; z++) v.cell(x, 0, z, 3, z === 6 ? 0xc8c8c8 : 0xffffff, group); for (let z = 7; z < 8; z++) v.cell(x, -1, z, 3, 0xb0b0b0, group); }
      break;
    case 'millcap':
      for (const c of v.cells.values()) if (c.y >= 1 && hash3(c.x, 4, c.z) < 0.16) { c.slot = 0; c.rgb = FLOUR; } // flour dust
      v.box(-4.2, 1.6, 0.8, 1.2, 0.6, 1.2, 0, 0xc9a46a, group); // a wheat sprig tucked in
      v.box(-4.6, 2.3, 0.8, 0.5, 1.2, 0.5, 0, 0xe6c46a, group);
      break;
    case 'tophat':
      v.box(2.6, 1.5, 2.6, 1.6, 1.6, 0.5, 0, 0xf2c94c, group); // a buttonhole flower on the band
      v.box(2.6, 1.5, 2.95, 0.7, 0.7, 0.3, 0, 0xd96a3a, group);
      break;
    case 'ranger':
      // pinch the crown front-to-back (the Montana dent)
      for (const c of v.cells.values()) if (c.y >= top - 2 && Math.abs(c.x + 0.5) < 0.9) c.rgb = 0xc8c8c8;
      v.box(-3.4, 1.3, 2.4, 0.4, 1.2, 1.4, 0, 0xc23b2a, group); // a red feather in the band
      v.box(-3.6, 2.4, 2.0, 0.3, 1.2, 0.9, 0, 0xe8603f, group);
      break;
    case 'souwester':
      for (const x of [-4, 3]) v.box(x + 0.5, -2.2, 0.5, 0.35, 4.2, 0.35, 2, 0xffffff, group); // chin ties
      break;
  }
  return v;
}

/**
 * Wear — one piece over the body, in Clawd body cells (CLAWD.u; pivot bottom centre, body x ∈ [−7, 7], y ∈ [0, 9],
 * z ∈ [−3.5, 3.5], front +z). Eyes sit at y 5..7, x ±4.5; the scarf rings the sides and back at y ≈ 4.5; the arm
 * nubs leave the sides at y 2..5. Slot 3 = the wear colour, slot 2 = its trim, 0 = baked details.
 */
export const WEAR_NAMES = ['satchel', 'apron', 'smock', 'sash', 'pack', 'cape'] as const;
export type WearName = (typeof WEAR_NAMES)[number];

export function wear(name: WearName, group: number): Vox {
  const v = new Vox();
  const B = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, slot: number, rgb = 0xffffff) => v.box(cx, cy, cz, sx, sy, sz, slot, rgb, group);
  const F = 3.5; // front face z
  switch (name) {
    case 'satchel': {
      // a mail bag on the right hip, a strap up the side and over the shoulder, a letter peeking out
      B(-7.75, 2.0, 0.6, 1.3, 2.8, 3.6, 3);
      B(-7.85, 3.0, 0.6, 1.4, 1.2, 3.75, 2, 0xe8e8e8); // flap
      B(-8.6, 2.6, 0.6, 0.2, 0.6, 0.8, 0, BRASS); // buckle
      B(-7.6, 3.95, -0.5, 0.6, 0.5, 1.2, 0, PAPER); // letters
      B(-7.6, 3.85, 1.0, 0.6, 0.5, 1.0, 0, 0xeadfc4);
      B(-7.62, 3.8, -0.55, 0.62, 0.25, 0.35, 0, SEAL);
      B(-7.32, 6.3, 0.6, 0.3, 5.0, 0.8, 2, 0xd0d0d0); // strap up the side (over the scarf)
      B(-6.2, 9.1, 0.6, 2.4, 0.25, 0.8, 2, 0xd0d0d0); // …and over the shoulder
      break;
    }
    case 'apron': case 'smock': {
      const smock = name === 'smock';
      B(0, 1.75, F + 0.12, 9.4, 4.3, 0.24, 3); // bib + skirt
      B(0, 3.95, F + 0.13, 9.6, 0.3, 0.26, 2); // top hem
      B(0, -0.35, F + 0.14, 9.0, 0.3, 0.24, 3, 0xe6e6e6); // skirt hangs just past the body
      B(1.8, 1.3, F + 0.3, 3.0, 1.4, 0.16, 2); // pocket
      if (!smock) { B(1.2, 1.9, F + 0.42, 0.25, 1.2, 0.12, 0, 0x3a3a44); B(2.2, 1.8, F + 0.42, 0.25, 1.0, 0.12, 0, 0xd9453b); } // pencils
      // ties round the sides and back, bow at the back
      for (const s of [-1, 1]) B(s * 7.1, 3.3, 0, 0.2, 0.32, 7.2, 3, 0xe0e0e0);
      B(0, 3.3, -3.62, 14.3, 0.32, 0.2, 3, 0xe0e0e0);
      B(0, 3.3, -3.8, 1.0, 1.0, 0.3, 3, 0xd8d8d8); B(-0.9, 3.0, -3.78, 0.9, 0.6, 0.2, 3, 0xe8e8e8); B(0.9, 3.0, -3.78, 0.9, 0.6, 0.2, 3, 0xe8e8e8);
      if (smock) {
        // flour dusting: on the top and shoulders (clear of the hat in the middle), the apron and the toes of the body
        for (let x = -7; x < 7; x++) for (let z = -3; z < 3; z++) {
          const hx = x + 0.5, hz = z + 0.5;
          if (Math.abs(hx) < 3.3 && Math.abs(hz) < 2.8) continue;
          if (hash3(x, 91, z) < 0.42) B(hx, 9.04, hz, 0.9, 0.08, 0.9, 0, FLOUR);
        }
        for (let i = 0; i < 9; i++) B(-3.6 + (i % 5) * 1.8 + (i > 4 ? 0.9 : 0), 0.5 + (i > 4 ? 1.9 : 0.5) + (i % 2) * 0.6, F + 0.27, 0.7, 0.5, 0.06, 0, FLOUR);
        for (const s of [-1, 1]) for (let i = 0; i < 3; i++) B(s * 7.03, 6.6 + i * 0.8, -1.5 + i * 1.4, 0.06, 0.6, 0.8, 0, FLOUR);
      }
      break;
    }
    case 'sash': {
      // a ribbon sash across the front, under the eyes, with the mayoral medal; it wraps the sides and back
      const n = 14;
      for (let i = 0; i < n; i++) {
        const x = 6.5 - i, y = 3.7 - i * (3.1 / (n - 1));
        B(x, y, F + 0.1, 1.08, 1.05, 0.2, 3);
        B(-x, y, -F - 0.1, 1.08, 1.05, 0.2, 3);
      }
      B(7.1, 3.7, 0, 0.2, 1.05, 7.2, 3); B(-7.1, 0.6, 0, 0.2, 1.05, 7.2, 3);
      for (let i = 0; i < n; i++) { const x = 6.5 - i, y = 3.7 - i * (3.1 / (n - 1)); B(x, y + 0.38, F + 0.22, 1.08, 0.18, 0.06, 2); B(x, y - 0.38, F + 0.22, 1.08, 0.18, 0.06, 2); }
      B(0.2, 2.15, F + 0.35, 1.5, 1.5, 0.25, 0, BRASS); // medal
      B(0.2, 2.15, F + 0.5, 0.7, 0.7, 0.1, 0, 0xfff2b8);
      B(-0.25, 0.95, F + 0.3, 0.5, 1.0, 0.12, 2); B(0.65, 0.95, F + 0.3, 0.5, 1.0, 0.12, 2);
      break;
    }
    case 'pack': {
      // a rucksack with a rolled blanket on top; two straps over the shoulders, beside the eyes
      B(0, 3.4, -F - 0.85, 7.4, 4.8, 1.7, 3);
      B(0, 5.25, -F - 1.0, 7.6, 1.3, 2.0, 2); // flap
      B(0, 2.4, -F - 1.85, 4.2, 1.8, 0.4, 2); // pocket
      B(0, 2.9, -F - 2.08, 0.6, 0.6, 0.1, 0, BRASS);
      B(0, 6.5, -F - 1.0, 8.6, 1.3, 1.3, 0, 0x9a4a3a); // bedroll
      for (const x of [-2.4, 2.4]) B(x, 6.5, -F - 1.0, 0.3, 1.4, 1.4, 0, 0x5a3a22);
      for (const s of [-1, 1]) {
        B(s * 6.05, 9.07, 0, 0.8, 0.14, 7.1, 2, 0xd0d0d0); // over the top
        B(s * 6.05, 7.1, F + 0.08, 0.8, 4.0, 0.16, 2, 0xd0d0d0); // down the front
        B(s * 6.05, 5.6, F + 0.2, 0.5, 0.5, 0.1, 0, BRASS);
      }
      break;
    }
    case 'cape': {
      // an oilskin cape over the shoulders and back, a collar round the top, a hem in trim
      B(0, 5.2, -F - 0.35, 14.6, 7.8, 0.3, 3);
      B(0, 1.45, -F - 0.37, 14.7, 0.4, 0.34, 2);
      for (const s of [-1, 1]) { B(s * 7.22, 7.25, -0.4, 0.3, 3.5, 6.6, 3); B(s * 7.24, 5.55, -0.4, 0.34, 0.35, 6.7, 2); }
      B(0, 9.12, -3.0, 14.8, 0.3, 1.4, 3, 0xe4e4e4); // collar
      for (const s of [-1, 1]) B(s * 6.6, 9.12, 0, 1.6, 0.3, 7.2, 3, 0xe4e4e4);
      B(6.4, 8.2, F + 0.1, 1.2, 1.0, 0.2, 0, BRASS); // clasp
      break;
    }
  }
  return v;
}

// =====================================================================================================================
// Duckling parts (cells of DUCK.u; feet on y = 0, facing +z)

export const DUCK_DIM = {
  /** body pivot (belly centre above the ground) and head pivot (neck), in cells */
  hipY: 2.0, neck: { y: 5.2, z: 2.2 }, shoulder: { x: 2.9, y: 3.6, z: 0.2 }, foot: { x: 1.2, z: 0.6 },
};

export function duckBody(): Vox {
  const v = new Vox();
  v.jitter = 0.05;
  v.ellipsoid(0, 3.2, -0.2, 3.1, 2.7, 3.9, 0, DUCK.body);
  // a fluffy bib under the chin so the head's underside never shows as a dark overhang
  v.ellipsoid(0, 4.9, 1.9, 2.3, 1.7, 2.1, 0, DUCK.fluff);
  // fluffy lighter chest and back top
  for (const c of v.cells.values()) if (c.y >= 5 || (c.z >= 2 && c.y >= 3)) c.rgb = DUCK.fluff;
  // tail tuft: a little upturned fluff at the back
  v.cell(0, 5, -4, 0, DUCK.fluff, 0, 1); v.cell(-1, 5, -4, 0, DUCK.fluff, 0, 1); v.cell(0, 6, -4, 0, DUCK.fluff, 0, 1); v.cell(0, 6, -5, 0, DUCK.fluff, 0, 1); v.cell(0, 5, -5, 0, DUCK.body, 0, 1);
  // shift so the pivot (hipY) is at the origin
  const out = new Vox(); out.jitter = v.jitter;
  for (const c of v.cells.values()) out.cell(c.x, c.y - DUCK_DIM.hipY, c.z, c.slot, c.rgb, c.group, c.wob);
  return out;
}

/** Head with bill and eyes; group 1 = bill open (peep), group 2 = bill closed. Pivot at the neck. */
export function duckHead(): Vox {
  const v = new Vox();
  v.jitter = 0.05;
  const N = DUCK_DIM.neck;
  v.ellipsoid(0, 2.6, 0.4, 2.6, 2.5, 2.5, 0, DUCK.fluff);
  // a single fluff sprig on top
  v.cell(0, 5, 0, 0, DUCK.fluff); v.cell(0, 6, -1, 0, DUCK.fluff);
  // eyes
  for (const s of [-1, 1]) v.box(s * 2.25 + 0.0, 3.1, 1.9, 0.6, 1.1, 0.9, 0, DUCK.eye);
  for (const s of [-1, 1]) v.box(s * 2.3 + 0.0, 3.4, 2.1, 0.3, 0.35, 0.5, 0, 0xffffff);
  // bill: upper always, lower closed (group 2) or dropped open (group 1)
  v.box(0, 2.35, 3.4, 2.6, 0.8, 2.2, 0, DUCK.bill);
  v.box(0, 1.75, 3.3, 2.2, 0.5, 1.9, 0, 0xe0701e, 2);
  v.box(0, 1.35, 3.1, 2.2, 0.5, 1.8, 0, 0xe0701e, 1);
  v.box(0, 1.9, 2.9, 1.6, 0.5, 1.0, 0, 0x8a2a2a, 1); // mouth inside
  void N;
  return v;
}

/** Wing stub (pivot at the shoulder, hanging back and down along the body side). */
export function duckWing(): Vox {
  const v = new Vox();
  v.jitter = 0.05;
  for (let y = 0; y < 3; y++) for (let z = 0; z < 4; z++) if (!(y === 2 && z === 3) && !(y === 0 && z === 0)) v.cell(0, -y - 1 + 1, -z + 1, 0, y === 0 ? DUCK.fluff : DUCK.wing);
  v.cell(0, -2 + 1, -3, 0, DUCK.wing, 0, 1); // tip feather
  return v;
}

/** Webbed foot with a stubby leg (pivot at the hip, sole at y = −hipY). */
export function duckFoot(): Vox {
  const v = new Vox();
  v.jitter = 0.04;
  v.box(0, -0.8, 0, 0.7, 1.6, 0.7, 0, 0xe8781e);
  v.box(0, -DUCK_DIM.hipY + 0.2, 0.7, 1.8, 0.4, 2.2, 0, DUCK.bill);
  v.box(0, -DUCK_DIM.hipY + 0.2, 1.9, 2.3, 0.4, 0.6, 0, DUCK.bill);
  return v;
}

/** Egg, split by a zigzag crack: group 1 = the top shell (pops off), group 2 = the bottom. */
export function duckEgg(): Vox {
  const v = new Vox();
  v.jitter = 0.03;
  const crack = (x: number, z: number) => 4 + ((x + z + 20) % 2 === 0 ? 0 : 1);
  v.ellipsoid(0, 4.2, 0, 3.2, 4.4, 3.2, 0, DUCK.egg, 0, 0);
  const out = new Vox(); out.jitter = 0.03;
  for (const c of v.cells.values()) {
    const top = c.y >= crack(c.x, c.z);
    const spot = hash3(c.x, c.y, c.z, 3) < 0.1;
    out.cell(c.x, c.y, c.z, 0, spot ? DUCK.eggSpot : DUCK.egg, top ? 1 : 2);
  }
  return out;
}
