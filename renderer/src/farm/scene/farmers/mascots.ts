// @pure
/**
 * THE MASCOT DESIGN FILE. Every voxel shape of the farmers lives here as plain data, so the look can be tweaked
 * without touching the rig: edit a string grid, reload, done. geo.ts turns these into meshes; rig.ts reads the derived
 * dimensions (where the legs, nubs, eyes and hats attach).
 *
 * Grids are read the way you see the mascot from the FRONT: column 0 is the viewer's left (= model +x is to the viewer's
 * right, matching three's camera), row 0 is the top. Every character is one cube of `u` metres.
 *
 *   Clawd  (kind 'claude'; 'gemini' and 'agent' are recolours)
 *     The Claude Code banner sprite read as pixel art. Terminal cells are twice as tall as they are wide, so every
 *     sprite pixel is 1 voxel wide and 2 voxels tall:
 *          ▐▛███▜▌
 *         ▝▜█████▛▘
 *           ▘▘ ▝▝
 *     legend:  #  body     e  eye (body voxel; the eye glyph is drawn on top of it, so it can blink)
 *              a  arm nub  l  leg          .  empty
 *     The body is extruded `depth` voxels. Legs are `legDepth` deep; the outer pair stands toward the front, the inner
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
 * Nothing here imports three: the mesher below emits plain arrays (and is unit-tested in node).
 */

// ---------------------------------------------------------------------------------------------------------------------
// Clawd

export const CLAWD = {
  u: 0.08,
  depth: 6,
  legDepth: 2,
  /** z of the leg column centres (voxels from the body centre): outer pair forward, inner pair back */
  legZOuter: 1.5,
  legZInner: -1.5,
  /** the scarf wraps the body on this row (0 = top body row) */
  scarfRow: 4,
  front: [
    '..############..',
    '..############..',
    '..##e######e##..',
    '..##e######e##..',
    'aa############aa',
    'aa############aa',
    '..############..',
    '..############..',
    '...l.l....l.l...',
    '...l.l....l.l...',
  ],
  /** Gemini's sparkle, centred on the front face this many voxels below the body top */
  starRow: 5.6,
} as const;

/** Body colours per kind (0xRRGGBB). */
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
  u: 0.05,
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
    '..#######E############..',
    'aa####################aa',
    'aa############M#######aa',
    '...##################...',
    '....################....',
    '...##################...',
    '...##################...',
    '....################....',
    '.......fff....fff.......',
    '.......fff....fff.......',
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
/** group cells into vertical columns (legs) by column index */
const columns = (cs: [number, number][]) => [...new Set(cs.map(([c]) => c))].sort((a, b) => a - b).map((c) => cs.filter(([x]) => x === c));

/** Everything the rig needs to know about one body plan, in metres (model space: +z front, +x model-left, y up). */
export interface Plan {
  body: 'clawd' | 'codex';
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
  const legs = columns(scan(g, 'l').cells);
  const eyes = halves(scan(g, 'e').cells, m.cx);
  const arms = halves(scan(g, 'a').cells, m.cx);
  const armL = arms[0];
  const armRows = armL.map(([, r]) => r), armCols = armL.map(([c]) => c);
  const legLen = (Math.max(...scan(g, 'l').cells.map(([, r]) => r)) - bb.rows[1]) * u;
  // legs by column, left→right as seen from the front = −x … +x ; outer pair forward, inner pair back
  const lx = legs.map((col) => m.x(col[0][0]));
  const zo = CLAWD.legZOuter * u, zi = CLAWD.legZInner * u;
  // order: FL (+x outer), FR (−x outer), BL (+x inner), BR (−x inner)
  const hips = [{ x: lx[3], z: zo }, { x: lx[0], z: zo }, { x: lx[2], z: zi }, { x: lx[1], z: zi }];
  const e = [eyes[1], eyes[0]].map((cs) => { const [c, r] = centroid(cs); return { x: m.x(c), y: m.y(r), z: (CLAWD.depth / 2) * u }; });
  const h = (bb.rows[1] - bb.rows[0] + 1) * u;
  return {
    body: 'clawd', u, w: (bb.cols[1] - bb.cols[0] + 1) * u, h, d: CLAWD.depth * u, legLen, hips,
    shoulder: { x: m.x(bb.cols[1]) + u / 2, y: (m.y(Math.min(...armRows)) + m.y(Math.max(...armRows))) / 2, z: 0 },
    armLen: (Math.max(...armCols) - Math.min(...armCols) + 1) * u, armW: (Math.max(...armRows) - Math.min(...armRows) + 1) * u,
    glyphs: e, glyphCell: u / 2,
    hat: { x: 0, y: h, z: -0.2 * u, s: 1 }, eyeY: e[0].y,
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
    hat: { x: 0, y: h, z: 0, s: 0.9 }, eyeY: anchor('E').y,
  };
};

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

/** A Clawd leg: a column hanging from its hip (pivot at the top centre), `legDepth` deep. */
export function clawdLeg(): Vox {
  const v = new Vox();
  const n = Math.round(CLAWD.front.filter((r) => r.includes('l')).length);
  for (let y = 0; y < n; y++) for (let z = 0; z < CLAWD.legDepth; z++) v.cell(-0.5, -1 - y, z - CLAWD.legDepth / 2, SLOT.body, y === n - 1 ? 0xc4c4c4 : 0xe6e6e6);
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
