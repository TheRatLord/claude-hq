/**
 * Task placards (§6.7): what every agent is working on, readable from across the room. Three forms, one mesh:
 *  - **Desk board**: a double-sided paper board on a stalk clipped to the desk monitor's top edge, lettered with
 *    `taskLabel(entity)` (muted `last: …` when idle), clip in the workspace colour. [FX M1.75] Beyond FAR_REF m the
 *    board grows with distance (up to BOARD.farMax, so the cap height stays ≥ ~7 px at 1600×900 out to the 18 m hide
 *    distance) and grows AWAY from its row neighbours (`deskBoardLimits`: it never reaches past the midpoint to the next
 *    desk's board), keeping its bottom on the stalk. Near (< PLACARD_NEAR_M), blocked with the owner at the desk (the
 *    waving hand owns the air), muted within PLACARD_MUTED_M, or seen edge-on, it glides down into the near card: an
 *    easel card on the viewer's side of the desk top ([FX fix r2]; flips over when the viewer crosses the desk).
 *  - **✓ pennant** [FX M1.75]: a done-and-not-signed-off agent carries a little flag on a pole beside its head (Pit
 *    sofa, outings), lettered `✓ <task>`, a done-green tip, facing the camera with a lazy sway; it grows with distance
 *    like the boards (PENNANT.farRef / farMax), so the Pit reads as "what got done" from `pitOverview`.
 *  - **Storefront strip** [FX M1.75]: a paper strip under each bay sign (street side, and the atrium-side sign of the
 *    E bays) listing `name · task` per desk of the bay (≤ 6 lines; big letters while ≤ 3 lines).
 * Render: tiles in one 2048×3072 task atlas (one PLACARD_SLOT per board / pennant, one STRIP.tile per bay strip),
 * redrawn only when the text changes (≤ 2 tiles / frame); every quad lives in ONE count-1 InstancedMesh with the
 * `screen` program (the same instanced variant as the desk monitors and the HELP sign: no new program). The geometry is
 * rebuilt when a board appears / changes / crosses the hide distance, while one glides or grows with distance, and every
 * frame while a pennant shows (≤ a few hundred quads, no allocation). `rects()` feeds the placed screen rects to the
 * label declutter (fx/labels.ts) as obstacles. Non-emissive paper: the intensity follows the room light.
 * Owner: FX.
 */
import * as THREE from 'three';
import { getMaterial } from '../render/materials/index.ts';
import { U } from '../render/uniforms.ts';
import { CORE, MISC, STATUS, WORKSPACE } from '../../../shared/palette.ts';
import { DESK, deskLocal } from '../world/layout/proto.ts';
import { createAtlas } from './atlas.ts';
import { sortInPlace } from './declutter.ts';
import { FONT_UI, clip } from './draw.ts';
import { PLACARD_HIDE_M, PLACARD_SLOT, placardLayout, placardLowTarget } from './rules.ts';
import { dressObstacles } from '../world/build/dress.ts'; // [FX fix m175-r2] read-only: the dressing props' static footprints (pennant poles)
import { bakeSlabs, slabBlocks, type Slab } from './occlude.ts'; // [FX fix m2-r3] mezzanine floor slab
import { bakeOccluders, wallBlocks, type Occluder } from '../ui/aim.ts'; // same (read-only) wall bake labels.ts uses (carryover: moves to LVL)
import type { Layout, Furniture, HqPoints } from '../world/layout/schema.ts';
import type { Params } from '../core/params.ts';
import type { Tile } from './atlas.ts';
import type { PennantAt, PennantSpec, PlacardSpec } from './types.ts';

/** Boards smaller than this on screen (px tall) are not declutter obstacles: unreadable anyway. */
const RECT_MIN_PX = 9;

// [FX fix r1] stalk 0.26 → 0.45: the board centre sits at 1.355 m (≥ 1.35; +0.3 on the staggered side), clear of a
// seated Clawd's hat from afar; tiles 512×172 → 404×136 (one slot size, PLACARD_SLOT) so 40+ agents fit the task atlas.
// [FX M1.75] farRef / farMax: distance growth (scale = clamp(d / farRef, 1, farMax)).
export const BOARD = Object.freeze({ w: 0.8, h: 0.27, stalk: 0.45, stagger: 0.3, cap: 0.085, maxChars: 30, shift: 0.3, lines: 2, tile: [404, 136], farRef: 8.6, farMax: 2 });
/** [FX M1.75] ✓ pennant (§6.7 "the Pit ✓ pennant is lettered with the task"): flag w × h m (spec 0.5 × 0.14, grown to
 *  hold a 2-line task at a readable cap), pole `side` m to the camera-right of the agent and `back` m behind it, flag
 *  top `above` m over the crown (≥ minTop over the floor); `tip` = the done-green swallow tip length; `band` = the
 *  ✓ band's share of the tile width; [FX fix m175-r1] in the Pit the pole stands on the tread behind the sofa back
 *  (radius ≥ pitPoleR, ≥ pitBehind behind the agent, pitSide m along the ring: between seats), the flag top pitAbove
 *  over the crown, and a crowded flag climbs `fan` flag heights per level; [FX fix m175-r2] `stub`: the pole below the flag
 *  when the pole stands nearer the lens than its agent (× the flag growth, ≤ 0.42 m); `hatAbove`: the crown mini flag's gap; gateM: placardCheck gates pennants within this distance (the Pit from the
 *  Pit's edge; from the spawn they are a bonus). Growth is referred to the lettered cap (a long task wraps smaller). */
export const PENNANT = Object.freeze({ w: 0.62, h: 0.2, cap: 0.058, maxChars: 30, lines: 2, tile: [404, 136], band: 0.18, tip: 0.13, farRef: 6.5, farMax: 2.4, gateM: 14, side: 0.36, back: 0.12, above: 0.2, minTop: 1.3, sway: 0.2, pitPoleR: 3.05, pitBehind: 0.45, pitSide: 0.6, pitAbove: 0.32, fan: 1.15, stub: 0.3, hatAbove: 0.12 });
/** [FX M1.75] Storefront strip (§6.7): width per sign-height (the bay signs are 6:1 plates), line cap (m) for ≤ 3 lines
 *  and for 4–6 lines, padding (m), tile px; farRef / farMax: it grows with distance like the
 *  boards (hanging from the sign's bottom edge), so the E2 strip reads through the atrium glazing from the spawn. */
export const STRIP = Object.freeze({ farRef: 7, farMax: 2.3, wPerSignH: 5.8, capBig: 0.075, capSmall: 0.055, pad: 0.04, maxLines: 6, maxChars: 34, tile: [1016, 392] });
/** [FX fix r1 → r2] Near / blocked / edge-on / muted: the §6.7 near card, a small easel card on the desk's pod-centre
 *  corner (desk-local x = m·lx), never between the lens and the owner's face and never through the monitor.
 *  It stands on the corner on the VIEWER's side of the desk (`front` when the camera is across the desk from the agent,
 *  `back` when it is behind the agent) and leans back `tilt` rad, away from the viewer, like a desk easel; when the
 *  viewer crosses the desk plane the card flips over (`flip` 1/s). `ease` = 1/s. */
export const LOW = Object.freeze({ scale: 0.43, lx: 0.38, front: -0.295, back: 0.24, tilt: (60 * Math.PI) / 180, ease: 4, flip: 3, hyst: 0.12 });
/** [FX fix m175-r1] Collapsed desk board: a workspace-colour pip (half size m, grows like the board) on the stalk;
 *  `ease` 1/s. Boards collapse when the camera is outside their bay (the storefront strip lists every desk's task) or
 *  when their screen rect would overlap a nearer board's (through the E-bay glazing they truncated each other). */
/** [FX fix m175-r2] Strip edge / card rules: hidden or shrunk past `cut` of its rect outside the view strip, back below
 *  `back`; yields to an alert card covering ≥ `cardFrac` of it, for `cardHold` s after. */
export const EDGE = Object.freeze({ cut: 0.15, back: 0.08, cardFrac: 0.04, cardHold: 0.5 });
/** [FX fix m175-r2] Fraction (0..1) of screen rect (x0, y0)–(x1, y1) outside the view strip [L, R] × [0, vh]. */
export function outsideFrac(x0: number, y0: number, x1: number, y1: number, L: number, R: number, vh: number, T = 0): number {
  const area = Math.max(1, (x1 - x0) * (y1 - y0));
  const w = Math.max(0, Math.min(x1, R) - Math.max(x0, L)), h = Math.max(0, Math.min(y1, vh) - Math.max(y0, T));
  return 1 - (w * h) / area;
}
/** [FX fix m175-r2] Strip edge level from its outside fraction at the grown size (`f0`) and at the nominal size
 *  (`f1()`, lazy): 0 = as grown, 1 = shrunk to nominal, 2 = hidden; `prev` = last level (hysteresis EDGE.cut / back). */
export function stripEdgeLevel(f0: number, f1: () => number, prev: number): number {
  const lim = (lv: number) => (prev <= lv ? EDGE.cut : EDGE.back);
  return f0 <= lim(0) ? 0 : f1() <= lim(1) ? 1 : 2;
}
export const PIP = Object.freeze({ m: 0.045, ease: 5 });
const MAX_QUADS = 64 * 10 + 24 * 8 + 12 * 3;
const MAX_TILES_PER_FRAME = 2;
/** The owner counts as "at the desk" within this distance of the desk centre (m, plan). */
const AT_DESK_M = 1.3;

/** [FX fix m2-r1] Plan / 3D lengths without Math.hypot (its boxed result was per-frame garbage in the hot loops). */
const hyp2 = (x: number, z: number) => Math.sqrt(x * x + z * z);
const hyp3 = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z);

const newPose = (): BoardPose => ({ x: 0, y: 0, z: 0, hw: 0, hh: 0, rx: 1, rz: 0, nx: 0, ny: 0, nz: 1, ux: 0, uy: 1, uz: 0, k: 0, sc: 1 });

/** @pure Distance growth of a sign-like label: 1 up close, d / ref beyond `ref`, capped at `max`. */
export const farScale = (d: number, ref: number, max: number): number => Math.min(max, Math.max(1, d / ref));

/** The near card's two stands (world), the desk centre and its +z normal (toward the agent). */
export interface LowAnchor { f: { x: number; z: number }; b: { x: number; z: number }; y: number; cx: number; cz: number; nx: number; nz: number }
/** How far (m, along the board's right axis) a grown board may reach on each side (Infinity when free). */
export interface BoardLimits { l: number; r: number }
/** Where a desk board stands: see `deskBoardAnchor`. */
export interface BoardAnchor {
  x: number; y: number; y0: number; stag: number; z: number; yaw: number;
  stalkY: number;
  stalkX?: number;
  stalkZ?: number;
  dims: typeof BOARD;
  low: LowAnchor | null;
  muted: boolean;
  bay: string | null;
  lim: BoardLimits | null;
}
/** A board's pose in world space (see `boardPoseOf`). */
export interface BoardPose {
  x: number; y: number; z: number; hw: number; hh: number;
  rx: number; rz: number; nx: number; ny: number; nz: number; ux: number; uy: number; uz: number; k: number; sc: number;
}
/** A screen rect handed to the label declutter (reused records). */
export interface PlacardRect { x0: number; y0: number; x1: number; y1: number; id: string }

/**
 * Board anchor for a desk: centre, yaw and monitor-top point (world). Proto / hq desks share DESK + deskLocal.
 * The tall board sits `BOARD.shift` m toward the pod centre (off the agent's hat, seen from the front); `low` holds the
 * near card's two stands (bottom-edge centres, world): `f` on the far side from the agent (where a camera facing the
 * agent looks from) and `b` on the agent's side, plus the desk centre and its +z normal (toward the agent).
 * `y0` = the board bottom without the stagger, `stag` = the stagger (grows with the board).
 */
export function deskBoardAnchor(layout: Layout | null | undefined, deskAnchor: string, muted = false): BoardAnchor | null {
  const f = layout?.furniture?.find((q) => q.id === deskAnchor && q.type === 'desk');
  if (!f) {
    const a = layout?.anchors?.find((q) => q.id === deskAnchor);
    return a ? { x: a.pos.x, y: (a.pos.y ?? 0) + 1.36, y0: (a.pos.y ?? 0) + 1.36 - BOARD.h / 2, stag: 0, z: a.pos.z, yaw: 'yaw' in a && typeof a.yaw === 'number' ? a.yaw : 0, stalkY: (a.pos.y ?? 0) + 0.8, dims: BOARD, low: null, muted: false, bay: null, lim: null } : null;
  }
  const { m, monitor: mon } = deskLocal(f);
  const cs = Math.cos(f.yaw), sn = Math.sin(f.yaw);
  const L = (lx: number, lz: number) => ({ x: f.pos.x + lx * cs + lz * sn, z: f.pos.z - lx * sn + lz * cs });
  const y0 = f.pos.y ?? 0;
  const top = y0 + mon.y + DESK.monitor.h / 2;
  // [FX fix r1] back-to-back desks (a pod's two rows, a bay's two columns) put their boards 0.4 m apart face-to-face:
  // from either side the near board hid the far one. Boards whose normal points to −z (or −x) stand BOARD.stagger
  // higher, so the far board of every pair peeks over the near one.
  const nx = Math.sin(f.yaw), nz = Math.cos(f.yaw);
  const stag = nz < -0.5 || (Math.abs(nz) <= 0.5 && nx < 0) ? BOARD.stagger : 0;
  const p = L(mon.x + m * BOARD.shift, mon.z - 0.03);
  const s = L(mon.x, mon.z - 0.03);
  // yaw = the desk's (no monitor twist [FX fix r1]): the two boards of a row stay coplanar, 0.28 m apart, never crossing
  const lf = L(m * LOW.lx, LOW.front), lb = L(m * LOW.lx, LOW.back);
  return { x: p.x, y: top + BOARD.stalk + stag + BOARD.h / 2, y0: top + BOARD.stalk, stag, z: p.z, yaw: f.yaw, stalkY: top, stalkX: s.x, stalkZ: s.z, dims: BOARD, muted,
    bay: f.bay ?? null, lim: deskBoardLimits(layout, f, p),
    low: { f: lf, b: lb, y: y0 + DESK.h + 0.004, cx: f.pos.x, cz: f.pos.z, nx, nz } };
}

/**
 * @pure [FX M1.75] How far (m, from the board centre along its right axis) a grown board may reach on each side before
 * it meets the midpoint to the nearest coplanar desk board (same yaw, same row plane): {l, r} (Infinity when free).
 * `f` = the desk, `p` = its board centre.
 */
export function deskBoardLimits(layout: Layout | null | undefined, f: Furniture, p: { x: number; z: number }): BoardLimits {
  const rx = Math.cos(f.yaw), rz = -Math.sin(f.yaw), nx = Math.sin(f.yaw), nz = Math.cos(f.yaw);
  let l = Infinity, r = Infinity;
  for (const q of layout?.furniture ?? []) {
    if (q === f || q.type !== 'desk' || Math.abs((q.pos.y ?? 0) - (f.pos.y ?? 0)) > 0.5) continue;
    if (Math.cos(q.yaw - f.yaw) < 0.99) continue; // parallel, same facing
    const dx = q.pos.x - f.pos.x, dz = q.pos.z - f.pos.z;
    if (Math.abs(dx * nx + dz * nz) > 0.35) continue; // same row plane
    const along = dx * rx + dz * rz; // board centres shift alike, so desk offsets = board offsets
    if (along > 0.05) r = Math.min(r, along / 2 - 0.03);
    else if (along < -0.05) l = Math.min(l, -along / 2 - 0.03);
  }
  return { l, r };
}

/**
 * @pure [FX M1.75] Grown tall board extents: scale `s` → half extents (eL, eR) along the right axis within the
 * neighbour limits, the effective uniform scale and the centre offset (into `out`).
 */
export function grownExtent(s: number, lim: BoardLimits | null, halfW: number = BOARD.w / 2, out: { s: number; ox: number } = { s: 1, ox: 0 }): { s: number; ox: number } {
  const h = halfW * s;
  if (!lim) { out.s = s; out.ox = 0; return out; }
  let eL = h, eR = h;
  if (eL > lim.l) { eL = Math.max(halfW, lim.l); eR = Math.min(2 * h - eL, Math.max(halfW, lim.r)); }
  else if (eR > lim.r) { eR = Math.max(halfW, lim.r); eL = Math.min(2 * h - eR, Math.max(halfW, lim.l)); }
  out.s = (eL + eR) / (2 * halfW); out.ox = (eR - eL) / 2;
  return out;
}

/**
 * @pure Pose of a board (world): centre, right axis (horizontal), up axis (tilted for the near card), tilted normal,
 * half sizes. k0: 0 = tall board, 1 = near card (smoothstepped glide); side0: 0 = the far stand `f`, 1 = agent side;
 * s / ox: the tall board's distance growth and centre offset (grownExtent). `P` = out (reused).
 */
export function boardPoseOf(A: BoardAnchor, k0: number, side0: number, P: BoardPose = newPose(), s = 1, ox = 0): BoardPose {
  const k = A.low ? k0 * k0 * (3 - 2 * k0) : 0, sc = s + k * (LOW.scale - s);
  const nx = Math.sin(A.yaw), nz = Math.cos(A.yaw);
  P.rx = Math.cos(A.yaw); P.rz = -Math.sin(A.yaw); P.nx = nx; P.ny = 0; P.nz = nz;
  P.ux = 0; P.uy = 1; P.uz = 0;
  P.hw = (A.dims.w / 2) * sc; P.hh = (A.dims.h / 2) * sc; P.k = k0; P.sc = sc;
  const y0 = A.y0 ?? A.y - A.dims.h / 2, stag = A.stag ?? 0;
  const tx = A.x + P.rx * ox, ty = y0 + stag * s + (A.dims.h / 2) * s, tz = A.z + P.rz * ox;
  P.x = tx; P.y = ty; P.z = tz;
  const lo = A.low;
  if (k === 0 || !lo) return P;
  const sd = side0 * side0 * (3 - 2 * side0);
  // lean back, away from the viewer: the top goes toward +n on the far stand (viewer across the desk), −n behind
  const t = LOW.tilt * (1 - 2 * sd) * k, st = Math.sin(t), ct = Math.cos(t);
  P.ux = nx * st; P.uy = ct; P.uz = nz * st;
  P.nx = nx * ct; P.ny = -st; P.nz = nz * ct;
  const bx = lo.f.x + (lo.b.x - lo.f.x) * sd, bz = lo.f.z + (lo.b.z - lo.f.z) * sd;
  const lx = bx + P.ux * P.hh, ly = lo.y + P.uy * P.hh, lz = bz + P.uz * P.hh;
  P.x = tx + (lx - tx) * k; P.y = ty + (ly - ty) * k; P.z = tz + (lz - tz) * k;
  return P;
}

/** @pure Which near-card stand the viewer wants (0 = far side, 1 = the agent's side), with hysteresis. */
export function lowSideTarget(A: Pick<BoardAnchor, 'low'>, camX: number, camZ: number, prev: number): number {
  if (!A.low) return prev;
  const d = (camX - A.low.cx) * A.low.nx + (camZ - A.low.cz) * A.low.nz;
  return d > LOW.hyst ? 1 : d < -LOW.hyst ? 0 : prev;
}

/** Where a desk's mug steams (§6.7 steaming mug, working streak ≥ 30 min): desk-local (m·0.2, top + 0.1, 0.1). */
export function deskMugSpot(layout: Layout | null | undefined, deskAnchor: string): { x: number; y: number; z: number } | null {
  const f = layout?.furniture?.find((q) => q.id === deskAnchor && q.type === 'desk');
  if (!f) return null;
  const { m } = deskLocal(f);
  const cs = Math.cos(f.yaw), sn = Math.sin(f.yaw), lx = m * 0.2, lz = 0.1;
  return { x: f.pos.x + lx * cs + lz * sn, y: (f.pos.y ?? 0) + DESK.h + 0.1, z: f.pos.z - lx * sn + lz * cs };
}

/** [FX fix r1 m2-carry] Clear gap (m, × the strip's far scale `s`) between a bay sign's plate and the roster strip hung
 *  under it: 0.035 m (+0.05 m per unit of growth) let a grown strip's top edge read as touching / cutting the
 *  'E3 · #1 hq-core' plate from spawn and pitOverview. Scaled with `s` so the gap keeps its screen size as the strip
 *  grows for distance (≥ 0.1 m at s = 1). */
export const STRIP_GAP = 0.1;
/** Top edge (world y) of strip spot `sp` at scale `s`. */
export const stripTop = (sp: { y: number }, s: number): number => sp.y + 0.035 - STRIP_GAP * Math.max(1, s);

/**
 * [FX M1.75] Storefront strip spots per bay (world): under the street sign and, for the E bays that have one, under the
 * atrium-side sign. Mirrors world/build/greybox.ts createBaySigns (sign centre, yaw, 6:1 plate height); contract
 * proposal: ENV publishes `layout.bays[].signs` so FX stops mirroring it.
 */
export function stripSpots(layout: Layout | null | undefined): StripSpotBase[] {
  // (sp.y = the sign plate's bottom − 0.035; the strip's top edge is `stripTop(sp, s)`)
  const out: StripSpotBase[] = [];
  const OX = 20.5; // hq plan → world x (greybox.ts createBaySigns)
  for (const bay of layout?.bays ?? []) {
    if (!bay.sign) continue;
    const east = bay.side === 'E';
    const add = (p: { x: number; y: number; z: number }, yaw: number, h: number) => {
      const nx = Math.sin(yaw), nz = Math.cos(yaw);
      out.push({ bay: bay.id, x: p.x + nx * 0.012, y: p.y - h / 2 - 0.035, z: p.z + nz * 0.012, yaw, w: h * STRIP.wPerSignH });
    };
    // [FX fix r1 m2-carry] ENV moved the street plate onto the STREET face of the 0.2 m storefront wall (greybox.ts
    // createBaySigns: sign.x ∓ 0.26); the strip at sign.x ∓ 0.02 hung inside the wall (never shown from the street)
    add({ ...bay.sign, x: bay.sign.x + (east ? -0.26 : 0.26) }, bay.signYaw, 0.28);
    if (east && bay.id !== 'E1' && bay.storefront) add({ x: 14 - OX + 0.13, y: 2.65, z: bay.storefront.z }, Math.PI / 2, 0.3);
  }
  return out;
}

/** A storefront strip position under a bay sign (world), before per-frame state. */
export interface StripSpotBase { bay: string; x: number; y: number; z: number; yaw: number; w: number }

/**
 * [FX fix m175-r2] Static pole-base test for the ✓ pennants: a pole base must stand clear (≥ `pad` m) of every wall /
 * glass / rail span of its level (thickness included), of solid layout furniture (desks, counters, lamp posts…; the Pit
 * sofas only by their footprint: the Pit pole stands on the tread right behind their backs) and of the dressing
 * props (`dressObstacles`: floor lamps, planters…), and — outside the Pit — the plan segment from the agent to the
 * base must not cross a wall (a pole through the bay glazing / behind a door frame). Pure (no three.js), for tests.
 */
export function createPoleSpots(layout: Layout | null | undefined, obstacles: { x: number; z: number; r: number; level?: number }[] = []) {
  const walls: { ax: number; az: number; ux: number; uz: number; len: number; ht: number; level: number }[] = [];
  for (const w of layout?.walls ?? []) {
    const [ax, az] = w.a, [bx, bz] = w.b, len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-3) continue;
    walls.push({ ax, az, ux: (bx - ax) / len, uz: (bz - az) / len, len, ht: (w.t ?? 0.2) / 2, level: w.level ?? 0 });
  }
  const furn: { x: number; z: number; c: number; s: number; hw: number; hd: number; level: number; soft: boolean }[] = [];
  for (const f of layout?.furniture ?? []) {
    if (!f.solid || !f.size) continue;
    furn.push({ x: f.pos.x, z: f.pos.z, c: Math.cos(f.yaw ?? 0), s: Math.sin(f.yaw ?? 0), hw: f.size[0] / 2, hd: (f.size[2] ?? f.size[0]) / 2, level: f.level ?? 0, soft: f.type === 'sofa' || f.type === 'hearth' });
  }
  const circ = obstacles.map((o) => ({ x: o.x, z: o.z, r: o.r, level: o.level ?? 0 }));
  /** plan distance from (x, z) to wall span w, minus its half thickness */
  const wallGap = (w: (typeof walls)[number], x: number, z: number) => {
    const qx = x - w.ax, qz = z - w.az, t = Math.max(0, Math.min(w.len, qx * w.ux + qz * w.uz));
    const ex = qx - w.ux * t, ez = qz - w.uz * t;
    return Math.sqrt(ex * ex + ez * ez) - w.ht;
  };
  /** does the plan segment (x0, z0) → (x1, z1) cross wall span w? */
  const crosses = (w: (typeof walls)[number], x0: number, z0: number, x1: number, z1: number) => {
    const dx = x1 - x0, dz = z1 - z0, den = dx * w.uz - dz * w.ux;
    if (Math.abs(den) < 1e-9) return false;
    const qx = w.ax - x0, qz = w.az - z0, t = (qx * w.uz - qz * w.ux) / den, s = (qx * dz - qz * dx) / den;
    return t > 0 && t < 1 && s > -w.ht && s < w.len + w.ht;
  };
  return {
    /**
     * Is (x, z) on `level` a free pole base? `from` = the agent (plan), whose line of sight to the base must not cross
     * a wall; `pit`: the Pit sofas / hearth count only by their own footprint (no pad).
     */
    free(x: number, z: number, level: number, pad: number, fx: number | null = null, fz: number | null = null, pit = false): boolean {
      // [FX fix m2-r1] indexed loops, no Math.hypot (heap-number garbage per call); callers cache the result anyway
      for (let i = 0; i < walls.length; i++) {
        const w = walls[i];
        if (w.level !== level) continue;
        if (wallGap(w, x, z) < pad) return false;
        if (fx !== null && fz !== null && crosses(w, fx, fz, x, z)) return false;
      }
      for (let i = 0; i < furn.length; i++) {
        const f = furn[i];
        if (f.level !== level) continue;
        const qx = x - f.x, qz = z - f.z, lx = qx * f.c - qz * f.s, lz = qx * f.s + qz * f.c, m = pit && f.soft ? 0.02 : pad;
        if (Math.abs(lx) < f.hw + m && Math.abs(lz) < f.hd + m) return false;
      }
      for (let i = 0; i < circ.length; i++) {
        const o = circ[i], dx = x - o.x, dz = z - o.z, r = o.r + pad;
        if (o.level === level && dx * dx + dz * dz < r * r) return false;
      }
      return true;
    },
  };
}

export type PoleSpots = ReturnType<typeof createPoleSpots>;

/** [FX fix m175-r2] Pole-base search steps: ring steps (m) either way in the Pit, and the fallbacks elsewhere.
 *  [FX fix m2-r1] The found base is cached per agent (as an offset) until the agent leaves its spot by `moveM` m, turns
 *  by more than `turn` rad of half-angle (≈ 20°, outside the Pit), changes level or enters / leaves the Pit (the
 *  4 Hz re-search ran the wall / furniture scan every frame for some pennant at crowd40: 24 KB/frame of garbage). */
/** [FX fix m2-r3] A pennant whose pole or agent is within `m` (plan) of the lens is not drawn; back past `back`. */
export const PEN_NEAR = Object.freeze({ m: 1.5, back: 1.8 });
/**
 * [FX fix m3-r3, reviewer art] Near ✓ pennants dominated close frames (300–450 px wide at 1.5–3 m, cut by the HUD chip
 * bar; wu22-02 / wu22-09 / wu13-04 / wu13-05): a flag's on-screen width (flag + swallow tip) is capped at `px` (at a
 * `refVh` px tall view, scaled with the view height), shrinking it as the lens closes in (it only binds nearer than
 * ≈ 3 m at the walk-up lens). `hudTop`: the HUD chip bar band (= labels' HUD_TOP_PX) counts as off-frame for the flag
 * edge test. Walk-up: while a subject (selected / followed / walk-up agent) is within `subjM` of the lens, the other
 * agents' flags within `fadeM` (back past `fadeBack`) furl away at `fade` 1/s (the placard batch is opaque: the flag
 * shrinks into its pole top instead of an alpha fade) and are not drawn once furled.
 */
export const PEN_CAP = Object.freeze({ px: 180, refVh: 900, hudTop: 46, subjM: 4, fadeM: 3, fadeBack: 3.4, fade: 5, minK: 0.04 });
/** @pure [FX fix m3-r3] Flag scale that keeps its on-screen width ≤ capPx: `wM` = its width at scale 1 (m), `depth` =
 *  view depth (m), `ppm` = px per metre at depth 1. */
export function penCapScale(s: number, wM: number, depth: number, ppm: number, capPx: number): number {
  const px = (wM * s * ppm) / Math.max(0.2, depth);
  return px > capPx ? (s * capPx) / px : s;
}
export const POLE = Object.freeze({ pad: 0.15, ringStep: 0.3, ringSteps: 8, moveM: 0.3, turn: 0.17 });

/**
 * [FX fix m175-r2] Pit pole base for an agent at (ax, az): radially out behind its sofa back (radius ≥ pitPoleR, ≥
 * pitBehind behind the agent), half a seat pitch along the ring (always the same way round), then stepped along the
 * ring ±POLE.ringStep m at a time to the nearest spot `spots.free` accepts (the floor lamps stand on the same ring)
 * and `taken` does not (another agent's pole already stands there).
 * Writes {x, z} into `out`; returns false when no free spot was found (out = the unstepped spot).
 */
export function pitPoleSpot(ax: number, az: number, pitC: { x: number; z: number }, spots: PoleSpots | null, out: { x: number; z: number }, taken: ((x: number, z: number) => boolean) | null = null): boolean {
  const dx = ax - pitC.x, dz = az - pitC.z, r = Math.hypot(dx, dz) || 1e-6;
  const R = Math.max(PENNANT.pitPoleR, r + PENNANT.pitBehind);
  const a0 = Math.atan2(dz, dx) + PENNANT.pitSide / R;
  for (let k = 0; k <= POLE.ringSteps * 2; k++) {
    const off = (k & 1 ? 1 : -1) * Math.ceil(k / 2) * POLE.ringStep;
    const a = a0 + off / R, x = pitC.x + Math.cos(a) * R, z = pitC.z + Math.sin(a) * R;
    if ((!spots || spots.free(x, z, 0, POLE.pad, null, null, true)) && !taken?.(x, z)) { out.x = x; out.z = z; return true; }
  }
  out.x = pitC.x + Math.cos(a0) * R; out.z = pitC.z + Math.sin(a0) * R;
  return false;
}

/**
 * [FX fix m175-r2] Pole-base candidates outside the Pit, in the agent's own frame (world-fixed: from its body yaw,
 * never from the camera): its right (PENNANT.side, a little behind), its left, straight behind, then 'hat' (a mini
 * flag on the crown). Returns the candidate index (0..2, 3 = hat) and writes the base into `out`.
 * `prefer` = the last pick, kept while it is still free (no flip-flopping as the agent turns).
 */
export const POLE_CANDS = Object.freeze([[1, PENNANT.back], [-1, PENNANT.back], [0, 0.45]]);
export function sidePoleSpot(ax: number, az: number, yaw: number, level: number, spots: PoleSpots | null, prefer: number, out: { x: number; z: number }): number {
  const rx = Math.cos(yaw), rz = -Math.sin(yaw), bx = Math.sin(yaw), bz = Math.cos(yaw); // right, back (forward = -sin, -cos)
  const at = (i: number) => { const [sd, bk] = POLE_CANDS[i], sw = sd * PENNANT.side; out.x = ax + rx * sw + bx * bk; out.z = az + rz * sw + bz * bk; };
  const ok = (i: number) => { at(i); return !spots || spots.free(out.x, out.z, level, POLE.pad, ax, az); };
  if (prefer >= 0 && prefer < POLE_CANDS.length && ok(prefer)) return prefer;
  for (let i = 0; i < POLE_CANDS.length; i++) if (i !== prefer && ok(i)) return i;
  out.x = ax; out.z = az;
  return POLE_CANDS.length;
}

/** A world sign plate the label declutter keeps clear (see `signQuads`). */
export interface SignQuad { c: Float32Array; hard: boolean; two: boolean; nx: number; nz: number; x: number; z: number }

/**
 * [FX M1.75] World sign plates the label declutter keeps clear: the bay signs (street + atrium side; one-sided, soft
 * obstacles like the boards) and the HELP DESK sign hung under the lintel 0.2 m in front of the counter at 3.1 m
 * (two-sided, `hard`: a queued alert keeps clear of it one bounded try longer — the queue's alert stack sat on it from
 * the spawn). Mirrors greybox.ts (same contract proposal as `stripSpots`).
 */
export function signQuads(layout: Layout | null | undefined): SignQuad[] {
  const out: SignQuad[] = [];
  const q = (x: number, y: number, z: number, yaw: number, w: number, h: number, hard: boolean, two: boolean) => {
    const rx = Math.cos(yaw) * (w / 2), rz = -Math.sin(yaw) * (w / 2), hh = h / 2;
    out.push({ c: Float32Array.of(x - rx, y - hh, z - rz, x + rx, y - hh, z + rz, x + rx, y + hh, z + rz, x - rx, y + hh, z - rz), hard, two, x, z, nx: Math.sin(yaw), nz: Math.cos(yaw) });
  };
  for (const sp of stripSpots(layout)) {
    const h = sp.w / STRIP.wPerSignH;
    q(sp.x, sp.y + 0.035 + h / 2, sp.z, sp.yaw, h * 6, h, false, false);
  }
  const counter = layout?.furniture?.find((f) => f.id === 'counter0');
  if (counter) q(counter.pos.x, 3.1, counter.pos.z - 0.2, Math.PI, 1.55, 0.34, true, true);
  return out;
}

/** A desk board (one per placard'd agent). */
interface Board {
  id: string; kind: 'desk'; text: string; muted: boolean; desk: string; colorIndex: number;
  slot: Tile | null; tile: Tile | null; capM: number; dirty: boolean; anchor: BoardAnchor; shown: boolean;
  low: number; lowT: number; side: number; sideT: number; sideInit: boolean; s: number; ox: number; dist: number;
  c: Float32Array; sEff: number; pip: number; pipT: number; pipWhy: string; occ: boolean; occT: number;
  /** hidden by the near-lens rule (hysteresis) */
  nearHid?: boolean;
}
/** Where a ✓ pennant's pole stands (cached as an offset from its agent). */
interface PoleBase {
  px: number; pz: number; footY: number; topY: number; pit: boolean; cand: number; hat: boolean; t: number;
  ax: number; az: number; yaw: number; ox: number; oz: number; stub: boolean; lvl: number;
}
/** A ✓ pennant (one per done, not signed-off agent). */
interface Pennant {
  id: string; kind: 'pennant'; text: string; colorIndex: number; at: PennantAt;
  slot: Tile | null; tile: Tile | null; capM: number; dirty: boolean; shown: boolean; dist: number; c: Float32Array; sEff: number;
  dims: typeof PENNANT; side: number; sideT: number; lift: number; liftT: number; base: PoleBase | null; penHidden: boolean;
  nearHid?: boolean; edgeOk?: boolean;
  /** walk-up furl target / eased scale (set on first update) */
  furlT?: number; furlK?: number | null;
}
interface StripLine { name: string; task: string; muted: boolean; ci: number }
interface StripSpot extends StripSpotBase {
  shown: boolean; legible: boolean; dist: number; s: number; c: Float32Array; occ: boolean; occT: number; occList: Occluder[] | null;
  edge: number; cardT: number; cardHid: boolean;
}
/** A bay's storefront strip: one tile, drawn at every spot of the bay. */
interface Strip {
  bay: string; key: string; lines: StripLine[]; tile: Tile | null; slot: Tile | null; dirty: boolean; h: number; cap: number; spots: StripSpot[];
  _n?: number;
}
/** What the placard update asks the rest of FX (all optional). */
export interface PlacardQuery {
  statusOf?: (id: string) => string | undefined;
  posOf?: (id: string) => { x: number; z: number } | null | undefined;
  nameOf?: (id: string) => string | undefined;
  stripTaskOf?: (id: string) => { text: string; muted: boolean } | null;
  cards?: () => { n: number; r: Float64Array };
  strip?: () => { left: number; right: number };
  subject?: () => string | null;
}

export function createPlacards({ renderer, scene, layout, params = null }: { renderer: THREE.WebGLRenderer | null; scene: THREE.Scene; layout: Layout; params?: Params | null }) {
  const atlas = createAtlas(renderer, { size: 2048, height: 3072, name: 'task' });
  // swatches: ink2 (stalk) + paper + done green + 8 workspace colours, 8×8 px each
  const SW = [CORE.ink2, MISC.whiteboard, STATUS.done, ...WORKSPACE.map((w) => w.hex)];
  const SW_WS = 3;
  const swTile = atlas.alloc(SW.length * 8, 8);
  if (!swTile) throw new Error('fx: the task atlas has no room for its swatch row');
  atlas.draw(swTile, (g) => SW.forEach((c, i) => { g.fillStyle = c; g.fillRect(i * 8, 0, 8, 8); }));
  const swUV = (i: number) => ({ u: swTile.u0 + ((i * 8 + 4) / 8 / SW.length) * (swTile.u1 - swTile.u0), v: (swTile.v0 + swTile.v1) / 2 });
  const SWUV = SW.map((_, i) => swUV(i));
  const wsUV = (ci: number) => SWUV[SW_WS + (((ci % 8) + 8) % 8)];

  const mat = getMaterial('screen', { color: '#FFFFFF', emissive: 0.72, instanced: true, strip: null, uniforms: {} }) as THREE.MeshBasicMaterial; // the `screen` kind is a MeshBasicMaterial
  mat.map = atlas.texture;
  mat.side = THREE.FrontSide;
  const uIntensity = (mat.userData as { uniforms: { uIntensity: THREE.IUniform<number> } }).uniforms.uIntensity; // the material kit's userData shape

  const n4 = MAX_QUADS * 4;
  const pos = new Float32Array(n4 * 3), uv = new Float32Array(n4 * 2);
  const idx = new Uint16Array(MAX_QUADS * 6);
  for (let q = 0; q < MAX_QUADS; q++) { const v = q * 4, o = q * 6; idx.set([v, v + 1, v + 2, v, v + 2, v + 3], o); }
  const geo = new THREE.BufferGeometry();
  const aPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const aUv = new THREE.BufferAttribute(uv, 2).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', aPos); geo.setAttribute('uv', aUv); geo.setIndex(new THREE.BufferAttribute(idx, 1));
  // unlit, but a normal attribute keeps the program key identical to the monitors' PlaneGeometry (vertexNormals bit)
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n4 * 3).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));
  geo.setDrawRange(0, 0);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4); // frustumCulled is off; never recomputed per frame
  const mesh = new THREE.InstancedMesh(geo, mat, 1);
  mesh.name = 'fx:placards';
  mesh.setMatrixAt(0, new THREE.Matrix4());
  mesh.setColorAt(0, new THREE.Color('#FFFFFF'));
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);

  /** Desk boards by actor id. */
  const boards = new Map<string, Board>();
  /** ✓ pennants by actor id. */
  const pennants = new Map<string, Pennant>();
  /** Storefront strips by bay id (one tile per bay, drawn at every spot of the bay). */
  const strips = new Map<string, Strip>();
  const spots = stripSpots(layout);
  const signs = signQuads(layout);
  // [FX fix m175-r1] Big Board box (stat anchor 'stat:summary'; housing 2.44 × 1.46 m, world/stats/bigBoard.ts)
  const bbA = layout?.statAnchors?.find((a) => a.kind === 'stat:summary') ?? null;
  const bigBoard = bbA ? { x: bbA.pos.x, y: bbA.pos.y, z: bbA.pos.z, hw: 1.22, hh: 0.73 } : null;
  for (const sp of spots) {
    let st = strips.get(sp.bay);
    if (!st) strips.set(sp.bay, (st = { bay: sp.bay, key: '', lines: [], tile: null, slot: null, dirty: false, h: 0, cap: 0, spots: [] } as Strip));
    st.spots.push({ ...sp, shown: false, legible: false, dist: 99, s: 1, c: new Float32Array(12), occ: false, occT: 0, occList: null, edge: 0, cardT: 0, cardHid: false });
  }
  // [FX fix m2-r1] array mirrors of the maps for the per-frame loops (a Map iterator per loop per frame was garbage)
  let boardList: Board[] = [];
  let pennantList: Pennant[] = [];
  const stripList = [...strips.values()];
  const deskBay = new Map<string, { bay: string; order: number }>();
  for (const f of layout?.furniture ?? []) if (f.type === 'desk' && f.bay) deskBay.set(f.id, { bay: f.bay, order: Number(String(f.id).split(':').pop()) || 0 });

  let dirtyGeo = false;
  let redraws = 0;
  // [FX fix m2-r1] desk board anchors are static per (desk, muted): cached (set() re-derived one per placard change)
  const anchors: [Map<string, BoardAnchor | null>, Map<string, BoardAnchor | null>] = [new Map(), new Map()];
  const anchorOf = (desk: string, muted: boolean): BoardAnchor | null => {
    const m = anchors[muted ? 1 : 0];
    let a = m.get(desk);
    if (a === undefined) { a = deskBoardAnchor(layout, desk, muted); m.set(desk, a); }
    return a;
  };

  function set(id: string, spec: PlacardSpec | null, colorIndex = 0) {
    const b = boards.get(id);
    if (!spec || !spec.deskAnchor || !spec.text) {
      if (b) { atlas.release(b.slot); boards.delete(id); boardList = [...boards.values()]; dirtyGeo = true; }
      return;
    }
    if (b && b.text === spec.text && b.muted === spec.muted && b.desk === spec.deskAnchor && b.colorIndex === colorIndex) return;
    const anchor = anchorOf(spec.deskAnchor, spec.muted);
    if (!anchor) return;
    if (b) Object.assign(b, { text: spec.text, muted: spec.muted, desk: spec.deskAnchor, colorIndex, anchor, dirty: true });
    else { boards.set(id, { id, kind: 'desk', text: spec.text, muted: spec.muted, desk: spec.deskAnchor, colorIndex, slot: null, tile: null, capM: anchor.dims.cap, dirty: true, anchor, shown: false, low: spec.muted ? 1 : 0, lowT: spec.muted ? 1 : 0, side: 0, sideT: 0, sideInit: false, s: 1, ox: 0, dist: 99, c: new Float32Array(12), sEff: 1, pip: 0, pipT: 0, pipWhy: '', occ: false, occT: 0 }); boardList = [...boards.values()]; }
    dirtyGeo = true;
  }

  /**
   * [FX M1.75] ✓ pennant for a done, not signed-off agent (null = none). `at` is read every frame (actor state).
   */
  function pennant(id: string, spec: PennantSpec | null) {
    const p = pennants.get(id);
    if (!spec || !spec.text) {
      if (p) { atlas.release(p.slot); pennants.delete(id); pennantList = [...pennants.values()]; dirtyGeo = true; }
      return;
    }
    if (!p) { pennants.set(id, { id, kind: 'pennant', text: spec.text, colorIndex: spec.colorIndex, at: spec.at, slot: null, tile: null, capM: PENNANT.cap, dirty: true, shown: false, dist: 99, c: new Float32Array(12), sEff: 1, dims: PENNANT, side: 1, sideT: 1, lift: 0, liftT: 0, base: null, penHidden: false }); pennantList = [...pennants.values()]; dirtyGeo = true; return; }
    p.at = spec.at;
    if (p.text !== spec.text || p.colorIndex !== spec.colorIndex) { p.text = spec.text; p.colorIndex = spec.colorIndex; p.dirty = true; }
  }

  /** [FX fix r1] One PLACARD_SLOT per board / pennant for its whole life. A null slot (atlas full) leaves it dirty and
   *  unshown; `update` retries after a release. Never throws. */
  function ensureTile(b: { slot: Tile | null; tile: Tile | null }, w: number, h: number, slotW: number = PLACARD_SLOT[0], slotH: number = PLACARD_SLOT[1]): boolean {
    if (!b.slot) b.slot = atlas.alloc(slotW, slotH);
    if (!b.slot) { b.tile = null; return false; }
    const s = b.slot;
    b.tile = { ...s, w, h, u1: (s.x + w) / atlas.size, v1: (s.y + h) / atlas.height, slot: s };
    return true;
  }

  const measureWith = (g: CanvasRenderingContext2D, weight: number) => (s: string, px: number) => { g.font = `${weight} ${px}px ${FONT_UI}`; return g.measureText(s).width; };

  function paintBoard(b: Board): boolean {
    const [w, h] = b.anchor.dims.tile;
    if (!ensureTile(b, w, h)) return false;
    atlas.draw(b.tile, (g, W, H) => {
      const r = Math.round(H * 0.105), lw = Math.max(4, Math.round(H * 0.036));
      g.fillStyle = MISC.whiteboard;
      g.beginPath(); g.roundRect(lw / 2, lw / 2, W - lw, H - lw, r); g.fill();
      g.lineWidth = lw; g.strokeStyle = CORE.ink; g.stroke();
      const dims = b.anchor.dims;
      const text = clip(b.text, dims.maxChars);
      // cap height (§6.7: 0.085 m on the board; × LOW.scale on the near card) → font px (cap ≈ 0.72 em)
      const fontPx0 = Math.round(((dims.cap / dims.h) * H) / 0.72);
      const lay = placardLayout(measureWith(g, 800), text, { maxW: W - 24, fontPx: fontPx0, lines: dims.lines });
      b.capM = ((lay.fontPx * 0.72) / H) * dims.h;
      g.font = `800 ${lay.fontPx}px ${FONT_UI}`;
      g.fillStyle = b.muted ? CORE.slate : CORE.ink;
      g.textBaseline = 'middle';
      g.textAlign = 'center';
      const lh = lay.fontPx * 0.98;
      lay.lines.forEach((ln, i) => {
        g.save(); g.translate(W / 2, H / 2 + 3 + (i - (lay.lines.length - 1) / 2) * lh); g.scale(lay.sx, 1); g.fillText(ln, 0, 0); g.restore();
      });
    });
    return true;
  }

  function paintPennant(p: Pennant): boolean {
    const [w, h] = PENNANT.tile;
    if (!ensureTile(p, w, h)) return false;
    atlas.draw(p.tile, (g, W, H) => {
      const lw = Math.max(4, Math.round(H * 0.036)), band = Math.round(W * PENNANT.band);
      g.fillStyle = MISC.whiteboard; g.fillRect(0, 0, W, H);
      // ✓ band on the pole side, in done green
      g.fillStyle = STATUS.done; g.fillRect(0, 0, band, H);
      g.strokeStyle = '#FFFFFF'; g.lineWidth = Math.round(H * 0.11); g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(band * 0.24, H * 0.52); g.lineTo(band * 0.44, H * 0.72); g.lineTo(band * 0.78, H * 0.3); g.stroke();
      g.strokeStyle = CORE.ink; g.lineWidth = lw; g.strokeRect(lw / 2, lw / 2, W - lw, H - lw);
      g.beginPath(); g.moveTo(band, 0); g.lineTo(band, H); g.stroke();
      const text = clip(p.text, PENNANT.maxChars);
      const fontPx0 = Math.round(((PENNANT.cap / PENNANT.h) * H) / 0.72);
      const lay = placardLayout(measureWith(g, 800), text, { maxW: W - band - 20, fontPx: fontPx0, lines: 2, minPx: 22 });
      p.capM = ((lay.fontPx * 0.72) / H) * PENNANT.h;
      g.font = `800 ${lay.fontPx}px ${FONT_UI}`;
      g.fillStyle = CORE.ink; g.textBaseline = 'middle'; g.textAlign = 'center';
      const lh = lay.fontPx * 0.98, cx = band + (W - band) / 2;
      lay.lines.forEach((ln, i) => {
        g.save(); g.translate(cx, H / 2 + 3 + (i - (lay.lines.length - 1) / 2) * lh); g.scale(lay.sx, 1); g.fillText(ln, 0, 0); g.restore();
      });
    });
    return true;
  }

  /** Strip world size for n lines: {cap, pitch, h} (m). */
  const stripDims = (n: number) => {
    const cap = n <= 3 ? STRIP.capBig : STRIP.capSmall, pitch = (cap / 0.72) * 1.08;
    return { cap, pitch, h: n * pitch + STRIP.pad * 2 };
  };

  function paintStrip(st: Strip): boolean {
    const [W] = STRIP.tile, n = st.lines.length;
    const w0 = st.spots[0].w, d = stripDims(n), ppm = W / w0;
    const H = Math.min(STRIP.tile[1], Math.ceil(d.h * ppm));
    if (!ensureTile(st, W, H, STRIP.tile[0], STRIP.tile[1])) return false;
    atlas.draw(st.tile, (g) => {
      const lw = Math.max(3, Math.round(ppm * 0.012));
      g.fillStyle = MISC.whiteboard; g.fillRect(0, 0, W, H);
      g.strokeStyle = CORE.ink; g.lineWidth = lw; g.strokeRect(lw / 2, lw / 2, W - lw, H - lw);
      const fontPx0 = Math.round((d.cap * ppm) / 0.72), pitchPx = d.pitch * ppm, pad = STRIP.pad * ppm;
      const mName = measureWith(g, 800), mTask = measureWith(g, 600);
      // one common font size: the widest line decides (condensed to ≥ 78% first)
      let px = fontPx0;
      const widthAt = (ln: StripLine, p: number) => mName(`${ln.name} · `, p) + mTask(ln.task, p) + p * 0.9;
      while (px > 20 && Math.max(...st.lines.map((ln) => widthAt(ln, px))) * 0.78 > W - 28) px -= 2;
      st.cap = ((px * 0.72) / ppm);
      st.lines.forEach((ln, i) => {
        const y = pad + pitchPx * (i + 0.5) + 2;
        const full = widthAt(ln, px), sx = Math.min(1, (W - 28) / full);
        g.save(); g.translate(14, y); g.scale(sx, 1);
        g.textBaseline = 'middle';
        // workspace dot, then the name (bold) and the task (muted when idle)
        g.fillStyle = WORKSPACE[((ln.ci % 8) + 8) % 8].hex;
        g.beginPath(); g.arc(px * 0.3, 0, px * 0.24, 0, Math.PI * 2); g.fill();
        g.font = `800 ${px}px ${FONT_UI}`; g.fillStyle = CORE.ink;
        const nm = `${ln.name} · `;
        g.fillText(nm, px * 0.7, 0);
        g.font = `600 ${px}px ${FONT_UI}`; g.fillStyle = ln.muted ? CORE.slate : CORE.ink;
        g.fillText(ln.task, px * 0.7 + mName(nm, px), 0);
        g.restore();
      });
    });
    st.h = d.h;
    return true;
  }

  const cam = new THREE.Vector3(), camR = new THREE.Vector3(), camF = new THREE.Vector3(), camU = new THREE.Vector3();
  let lastShownKey = -1;
  let time = 0;

  const P = newPose();
  /** Current board pose: k = 0 tall board (grown with distance) → 1 near card (glide + shrink + lean). */
  const boardPose = (b: Board) => boardPoseOf(b.anchor, b.low, b.side, P, b.s, b.ox);

  // ---- geometry (no allocation) ----
  let q = 0;
  // [FX fix m2-r1] staged geometry writers: callers store the floats into PQ / PP / TQ / CQ and call quadQ / postQ /
  // triQ / cornersQ (rebuild runs every frame while a pennant shows, and its non-inlined float-argument calls boxed
  // ~9 KB of heap numbers per frame at crowd40)
  const PQ = new Float64Array(13), PP = new Float64Array(7), TQ = new Float64Array(9), CQ = new Float64Array(9);
  /** centre ± r ± u (faces r × u): PQ = cx cy cz rx ry rz ux uy uz u0 v0 u1 v1 */
  function quadQ() {
    if (q >= MAX_QUADS) return;
    const cx = PQ[0], cy = PQ[1], cz = PQ[2], rx = PQ[3], ry = PQ[4], rz = PQ[5], ux = PQ[6], uy = PQ[7], uz = PQ[8];
    let p = q * 12;
    pos[p++] = cx - rx - ux; pos[p++] = cy - ry - uy; pos[p++] = cz - rz - uz;
    pos[p++] = cx + rx - ux; pos[p++] = cy + ry - uy; pos[p++] = cz + rz - uz;
    pos[p++] = cx + rx + ux; pos[p++] = cy + ry + uy; pos[p++] = cz + rz + uz;
    pos[p++] = cx - rx + ux; pos[p++] = cy - ry + uy; pos[p] = cz - rz + uz;
    const o = q * 8, u0 = PQ[9], v0 = PQ[10], u1 = PQ[11], v1 = PQ[12];
    uv[o] = u0; uv[o + 1] = v1; uv[o + 2] = u1; uv[o + 3] = v1; uv[o + 4] = u1; uv[o + 5] = v0; uv[o + 6] = u0; uv[o + 7] = v0;
    q++;
  }
  /** a solid-colour triangle (a degenerate quad), both sides: TQ = ax ay az bx by bz cx cy cz, `s` = swatch uv */
  function triQ(s: { u: number; v: number }) {
    for (let side = 0; side < 2 && q < MAX_QUADS; side++) {
      let p = q * 12;
      pos[p++] = TQ[0]; pos[p++] = TQ[1]; pos[p++] = TQ[2];
      const b = side ? 6 : 3, c = side ? 3 : 6;
      pos[p++] = TQ[b]; pos[p++] = TQ[b + 1]; pos[p++] = TQ[b + 2];
      pos[p++] = TQ[c]; pos[p++] = TQ[c + 1]; pos[p++] = TQ[c + 2];
      pos[p++] = TQ[c]; pos[p++] = TQ[c + 1]; pos[p] = TQ[c + 2];
      const o = q * 8;
      for (let k = 0; k < 8; k += 2) { uv[o + k] = s.u; uv[o + k + 1] = s.v; }
      q++;
    }
  }
  /** a thin square post from y0 to y1 at (px, pz), both horizontal axes (4 outward quads): PP = px pz y0 y1 rx rz w */
  function postQ(s: { u: number; v: number }) {
    const px = PP[0], pz = PP[1], y0 = PP[2], y1 = PP[3], rx = PP[4], rz = PP[5], w = PP[6];
    const sh = (y1 - y0) / 2, sy = y0 + sh, nx = -rz, nz = rx;
    PQ[1] = sy; PQ[4] = 0; PQ[6] = 0; PQ[7] = sh; PQ[8] = 0; PQ[9] = s.u; PQ[10] = s.v; PQ[11] = s.u; PQ[12] = s.v;
    PQ[0] = px + nx * w; PQ[2] = pz + nz * w; PQ[3] = rx * w; PQ[5] = rz * w; quadQ();
    PQ[0] = px - nx * w; PQ[2] = pz - nz * w; PQ[3] = -rx * w; PQ[5] = -rz * w; quadQ();
    PQ[0] = px + rx * w; PQ[2] = pz + rz * w; PQ[3] = -nx * w; PQ[5] = -nz * w; quadQ();
    PQ[0] = px - rx * w; PQ[2] = pz - rz * w; PQ[3] = nx * w; PQ[5] = nz * w; quadQ();
  }
  /** record a label's 4 world corners (for check / rects): CQ = x y z rx ry rz ux uy uz */
  function cornersQ(c: Float32Array) {
    const x = CQ[0], y = CQ[1], z = CQ[2], rx = CQ[3], ry = CQ[4], rz = CQ[5], ux = CQ[6], uy = CQ[7], uz = CQ[8];
    c[0] = x - rx - ux; c[1] = y - ry - uy; c[2] = z - rz - uz; c[3] = x + rx - ux; c[4] = y + ry - uy; c[5] = z + rz - uz;
    c[6] = x + rx + ux; c[7] = y + ry + uy; c[8] = z + rz + uz; c[9] = x - rx + ux; c[10] = y - ry + uy; c[11] = z - rz + uz;
  }

  function rebuild() {
    q = 0;
    const stalkS = SWUV[0];
    for (const b of boardList) {
      if (!b.shown || !b.tile) continue;
      const A = b.anchor;
      const pose = boardPose(b), off = 0.004;
      const { x, y, z, rx, rz, ux, uy, uz, sc } = pose;
      const nx = P.nx, ny = P.ny, nz = P.nz; // tilted normal (near card leans back)
      b.sEff = sc;
      // [FX fix m175-r1] collapsed to a colour pip (the bay's storefront strip carries the text, or the board would
      // overlap a nearer one): the board shrinks into a workspace-colour tag on its stalk
      const pk = b.pip * b.pip * (3 - 2 * b.pip), keep = 1 - pk;
      if (pk > 0) {
        const c = wsUV(b.colorIndex), px = A.stalkX ?? x, pz = A.stalkZ ?? z, sp = PIP.m * Math.max(1, b.s) * pk;
        const py = (A.y0 ?? y) + (A.stag ?? 0) * b.s + sp;
        if (A.stalkY !== null && A.stalkY !== undefined && pk >= keep) (PP[0] = px, PP[1] = pz, PP[2] = A.stalkY, PP[3] = py - sp, PP[4] = rx, PP[5] = rz, PP[6] = 0.009 * Math.min(1.6, b.s), postQ(stalkS));
        const bw = sp + 0.012 * pk;
        (PQ[0] = px + nx * 0.006, PQ[1] = py, PQ[2] = pz + nz * 0.006, PQ[3] = rx * bw, PQ[4] = 0, PQ[5] = rz * bw, PQ[6] = 0, PQ[7] = bw, PQ[8] = 0, PQ[9] = stalkS.u, PQ[10] = stalkS.v, PQ[11] = stalkS.u, PQ[12] = stalkS.v, quadQ());
        (PQ[0] = px - nx * 0.006, PQ[1] = py, PQ[2] = pz - nz * 0.006, PQ[3] = -rx * bw, PQ[4] = 0, PQ[5] = -rz * bw, PQ[6] = 0, PQ[7] = bw, PQ[8] = 0, PQ[9] = stalkS.u, PQ[10] = stalkS.v, PQ[11] = stalkS.u, PQ[12] = stalkS.v, quadQ());
        (PQ[0] = px + nx * 0.009, PQ[1] = py, PQ[2] = pz + nz * 0.009, PQ[3] = rx * sp, PQ[4] = 0, PQ[5] = rz * sp, PQ[6] = 0, PQ[7] = sp, PQ[8] = 0, PQ[9] = c.u, PQ[10] = c.v, PQ[11] = c.u, PQ[12] = c.v, quadQ());
        (PQ[0] = px - nx * 0.009, PQ[1] = py, PQ[2] = pz - nz * 0.009, PQ[3] = -rx * sp, PQ[4] = 0, PQ[5] = -rz * sp, PQ[6] = 0, PQ[7] = sp, PQ[8] = 0, PQ[9] = c.u, PQ[10] = c.v, PQ[11] = c.u, PQ[12] = c.v, quadQ());
        if (keep < 0.02) { (CQ[0] = px, CQ[1] = py, CQ[2] = pz, CQ[3] = rx * sp, CQ[4] = 0, CQ[5] = rz * sp, CQ[6] = 0, CQ[7] = sp, CQ[8] = 0, cornersQ(b.c)); continue; }
      }
      const hw = pose.hw * keep, hh = pose.hh * keep;
      // the stalk shortens with the sinking board (gone once the board bottom passes the monitor top)
      const stalkY = A.stalkY !== null && y - hh > A.stalkY + 0.02 ? A.stalkY : null;
      const t = b.tile;
      const Ux = ux * hh, Uy = uy * hh, Uz = uz * hh;
      (CQ[0] = x, CQ[1] = y, CQ[2] = z, CQ[3] = rx * hw, CQ[4] = 0, CQ[5] = rz * hw, CQ[6] = Ux, CQ[7] = Uy, CQ[8] = Uz, cornersQ(b.c));
      // front (faces +normal) and back (faces −normal, mirrored u so it reads correctly from behind)
      (PQ[0] = x + nx * off, PQ[1] = y + ny * off, PQ[2] = z + nz * off, PQ[3] = rx * hw, PQ[4] = 0, PQ[5] = rz * hw, PQ[6] = Ux, PQ[7] = Uy, PQ[8] = Uz, PQ[9] = t.u0, PQ[10] = t.v0, PQ[11] = t.u1, PQ[12] = t.v1, quadQ());
      (PQ[0] = x - nx * off, PQ[1] = y - ny * off, PQ[2] = z - nz * off, PQ[3] = -rx * hw, PQ[4] = 0, PQ[5] = -rz * hw, PQ[6] = Ux, PQ[7] = Uy, PQ[8] = Uz, PQ[9] = t.u0, PQ[10] = t.v0, PQ[11] = t.u1, PQ[12] = t.v1, quadQ());
      const c = wsUV(b.colorIndex);
      if (stalkY !== null && pk < keep) {
        // stalk: a thin square post from the monitor top to the board bottom; the clip in the workspace colour
        const px = A.stalkX ?? x, pz = A.stalkZ ?? z, sw = 0.009 * Math.min(1.6, sc);
        (PP[0] = px, PP[1] = pz, PP[2] = stalkY, PP[3] = y - hh, PP[4] = rx, PP[5] = rz, PP[6] = sw, postQ(stalkS));
        const cy = y - hh + 0.012 * sc, cw = 0.04 * sc, ch = 0.028 * sc;
        (PQ[0] = px + nx * 0.012, PQ[1] = cy, PQ[2] = pz + nz * 0.012, PQ[3] = rx * cw, PQ[4] = 0, PQ[5] = rz * cw, PQ[6] = 0, PQ[7] = ch, PQ[8] = 0, PQ[9] = c.u, PQ[10] = c.v, PQ[11] = c.u, PQ[12] = c.v, quadQ());
        (PQ[0] = px - nx * 0.012, PQ[1] = cy, PQ[2] = pz - nz * 0.012, PQ[3] = -rx * cw, PQ[4] = 0, PQ[5] = -rz * cw, PQ[6] = 0, PQ[7] = ch, PQ[8] = 0, PQ[9] = c.u, PQ[10] = c.v, PQ[11] = c.u, PQ[12] = c.v, quadQ());
      } else if (stalkY === null) {
        // near card: a workspace-colour foot strip along the bottom edge, both sides
        const fk = hh - 0.008;
        const fx = x - ux * fk, fy = y - uy * fk, fz = z - uz * fk;
        (PQ[0] = fx + nx * 0.008, PQ[1] = fy + ny * 0.008, PQ[2] = fz + nz * 0.008, PQ[3] = rx * hw, PQ[4] = 0, PQ[5] = rz * hw, PQ[6] = ux * 0.008, PQ[7] = uy * 0.008, PQ[8] = uz * 0.008, PQ[9] = c.u, PQ[10] = c.v, PQ[11] = c.u, PQ[12] = c.v, quadQ());
        (PQ[0] = fx - nx * 0.008, PQ[1] = fy - ny * 0.008, PQ[2] = fz - nz * 0.008, PQ[3] = -rx * hw, PQ[4] = 0, PQ[5] = -rz * hw, PQ[6] = ux * 0.008, PQ[7] = uy * 0.008, PQ[8] = uz * 0.008, PQ[9] = c.u, PQ[10] = c.v, PQ[11] = c.u, PQ[12] = c.v, quadQ());
      }
    }
    // ✓ pennants: pole behind the agent (Pit: behind the sofa back, on the tread), the flag streaming to the side the
    // pennant declutter picked (camera-right first), lifted to its fan level, camera-facing with a sway
    const green = SWUV[2];
    for (const p of pennantList) {
      const B = p.base;
      if (!p.shown || !p.tile || !B) continue;
      const a = p.at, s = p.sEff, sd = p.side;
      const sway = PENNANT.sway * Math.sin(time * 1.9 + a.phase) + 0.06 * Math.sin(time * 3.7 + a.phase * 2);
      const cs = Math.cos(sway), sn = Math.sin(sway);
      // flag axis from the pole toward its free end (camera-right, or camera-left when flipped)
      const rx = (camR.x * cs - camR.z * sn) * sd, rz = (camR.x * sn + camR.z * cs) * sd;
      const px = B.px, pz = B.pz;
      const W = PENNANT.w * s, H = PENNANT.h * s;
      const topY = B.topY + p.lift * H * PENNANT.fan;
      const droop = 0.03 * s * Math.sin(time * 2.3 + a.phase);
      const cx = px + rx * (W / 2 + 0.012), cy = topY - H / 2 - droop * 0.5, cz = pz + rz * (W / 2 + 0.012);
      const t = p.tile, hw = W / 2, hh = H / 2;
      // the tile reads left → right from the camera side on both flags (a flipped flag carries its ✓ band at the free end)
      const fx = rx * sd, fz = rz * sd;
      (CQ[0] = cx, CQ[1] = cy, CQ[2] = cz, CQ[3] = fx * hw, CQ[4] = -droop * 0.5 * sd, CQ[5] = fz * hw, CQ[6] = 0, CQ[7] = hh, CQ[8] = 0, cornersQ(p.c));
      (PQ[0] = cx, PQ[1] = cy, PQ[2] = cz, PQ[3] = fx * hw, PQ[4] = -droop * 0.5 * sd, PQ[5] = fz * hw, PQ[6] = 0, PQ[7] = hh, PQ[8] = 0, PQ[9] = t.u0, PQ[10] = t.v0, PQ[11] = t.u1, PQ[12] = t.v1, quadQ());
      (PQ[0] = cx, PQ[1] = cy, PQ[2] = cz, PQ[3] = -fx * hw, PQ[4] = droop * 0.5 * sd, PQ[5] = -fz * hw, PQ[6] = 0, PQ[7] = hh, PQ[8] = 0, PQ[9] = t.u0, PQ[10] = t.v0, PQ[11] = t.u1, PQ[12] = t.v1, quadQ()); // back (reads correctly from behind)
      // swallow tip in done green at the free end
      const ex = cx + rx * hw, ey = cy - droop * 0.5, ez = cz + rz * hw, L = PENNANT.tip * s;
      (TQ[0] = ex, TQ[1] = ey + hh, TQ[2] = ez, TQ[3] = ex + rx * L, TQ[4] = ey + hh * 0.2 - droop * 0.4, TQ[5] = ez + rz * L, TQ[6] = ex, TQ[7] = ey, TQ[8] = ez, triQ(green));
      (TQ[0] = ex, TQ[1] = ey, TQ[2] = ez, TQ[3] = ex + rx * L, TQ[4] = ey - hh * 0.8 - droop * 0.4, TQ[5] = ez + rz * L, TQ[6] = ex, TQ[7] = ey - hh, TQ[8] = ez, triQ(green));
      // the pole (ink2) from the tread / floor, with a workspace-colour knob
      // [FX fix m175-r2] a pole nearer the lens than its agent is only a short stub under the flag (no floor-to-flag
      // line through the near sofa and the agent from pitOverview)
      const poleY0 = B.stub ? Math.max(B.footY, topY - H - droop - PENNANT.stub * Math.min(1.4, s)) : B.footY;
      (PP[0] = px, PP[1] = pz, PP[2] = poleY0, PP[3] = topY + 0.02, PP[4] = camR.x, PP[5] = camR.z, PP[6] = 0.008, postQ(stalkS)); // [FX fix m175-r1] thinner: the Pit poles stand in view
      const k = wsUV(p.colorIndex);
      (PP[0] = px, PP[1] = pz, PP[2] = topY + 0.02, PP[3] = topY + 0.06, PP[4] = camR.x, PP[5] = camR.z, PP[6] = 0.022, postQ(k));
    }
    // storefront strips
    for (const st of stripList) {
      if (!st.tile || !st.lines.length) continue;
      const t = st.tile;
      for (const sp of st.spots) {
        if (!sp.shown) continue;
        const rx = Math.cos(sp.yaw), rz = -Math.sin(sp.yaw), hw = (sp.w / 2) * sp.s, hh = (st.h / 2) * sp.s;
        const cy = stripTop(sp, sp.s) - hh; // [FX fix m175-r1] the hanging gap grows with the strip (it grazed its plate from afar)
        (CQ[0] = sp.x, CQ[1] = cy, CQ[2] = sp.z, CQ[3] = rx * hw, CQ[4] = 0, CQ[5] = rz * hw, CQ[6] = 0, CQ[7] = hh, CQ[8] = 0, cornersQ(sp.c));
        (PQ[0] = sp.x, PQ[1] = cy, PQ[2] = sp.z, PQ[3] = rx * hw, PQ[4] = 0, PQ[5] = rz * hw, PQ[6] = 0, PQ[7] = hh, PQ[8] = 0, PQ[9] = t.u0, PQ[10] = t.v0, PQ[11] = t.u1, PQ[12] = t.v1, quadQ());
      }
    }
    geo.setDrawRange(0, q * 6);
    // upload only the quads in use (pennants rebuild every frame)
    aPos.clearUpdateRanges(); aPos.addUpdateRange(0, Math.max(1, q * 12)); aPos.needsUpdate = true;
    aUv.clearUpdateRanges(); aUv.addUpdateRange(0, Math.max(1, q * 8)); aUv.needsUpdate = true;
    mesh.visible = q > 0;
  }

  /** Strip content per bay from the desk boards (name · task per desk, desk order). */
  function syncStrips(nameOf: PlacardQuery['nameOf'], taskOf: PlacardQuery['stripTaskOf']) {
    if (!strips.size) return;
    for (const st of stripList) st._n = 0;
    const rows: { bay: string; order: number; name: string; task: string; muted: boolean; ci: number }[] = [];
    for (const b of boardList) {
      const db = deskBay.get(b.desk);
      if (!db || !strips.has(db.bay)) continue;
      // [FX fix r2 m2-carry] the task line is the strip's own (task → last todo → 'idle' / 'done ✓'): the desk board
      // falls back to the project ('moss · tinker' read the workspace as a task, h13-2 / c40-2)
      const tk = taskOf?.(b.id);
      rows.push({ bay: db.bay, order: db.order, name: nameOf?.(b.id) || b.id, task: tk?.text ?? b.text, muted: tk ? tk.muted : b.muted, ci: b.colorIndex });
    }
    rows.sort((p, r) => (p.bay < r.bay ? -1 : p.bay > r.bay ? 1 : p.order - r.order));
    for (const st of stripList) {
      const lines = rows.filter((r) => r.bay === st.bay).slice(0, STRIP.maxLines)
        .map((r) => ({ name: clip(r.name, 14), task: clip(r.task, Math.max(8, STRIP.maxChars - Math.min(14, r.name.length))), muted: r.muted, ci: r.ci }));
      const key = lines.map((l) => `${l.name}|${l.task}|${+l.muted}|${l.ci}`).join('\n');
      if (key === st.key) continue;
      st.key = key; st.lines = lines;
      if (!lines.length) { atlas.release(st.slot); st.slot = null; st.tile = null; st.dirty = false; dirtyGeo = true; }
      else st.dirty = true;
    }
  }

  // ---- [FX fix m175-r1] pennant anchoring + declutter ----
  // Pit: the pole stands behind the agent's sofa back on the tread (radially out from the Pit centre, ≥ PIT_POLE_R),
  // never at the seat (poles speared cushions and crossed faces); elsewhere beside / behind the agent as before.
  // proto layouts only carry the LayoutPoints core; hq adds pitCenter (HqPoints). The one cast.
  const pitC = (layout?.points as Partial<HqPoints> | undefined)?.pitCenter ?? null;
  const pitR = layout?.plan?.PIT?.rings?.[0]?.[0] ?? 4;
  const floorOf = (x: number, z: number, y: number) => (typeof layout?.floorAt === 'function' ? layout.floorAt(x, z, y).y : y);
  // [FX fix m175-r2] static pole-base test (walls / glass / solid furniture / dressing props), baked on first use
  let poleSpots: PoleSpots | null = null;
  const spotsOf = (): PoleSpots => (poleSpots ??= createPoleSpots(layout, layout?.id === 'hq' && !params?.greybox ? dressObstacles(layout, params ?? {}) : []));
  const PS = { x: 0, z: 0 };
  // two Pit poles never share a spot (crowd40 put two on one tread spot): the one that got there first keeps it
  let penSelf: Pennant | null = null;
  const poleTaken = (x: number, z: number) => {
    const lim = POLE.ringStep * 0.9;
    for (const q of pennantList) if (q !== penSelf && q.base?.pit && (q.base.px - x) ** 2 + (q.base.pz - z) ** 2 < lim * lim) return true;
    return false;
  };
  let searches = 0;
  function pennantBase(p: Pennant): PoleBase {
    const a = p.at, B = p.base ?? (p.base = { px: 0, pz: 0, footY: 0, topY: 0, pit: false, cand: -1, hat: false, t: 0, ax: 1e9, az: 1e9, yaw: 1e9, ox: 0, oz: 0, stub: false, lvl: -1 });
    const H = PENNANT.h * p.sEff;
    let dx = 0, dz = 0, r = 0;
    if (pitC) { dx = a.x - pitC.x; dz = a.z - pitC.z; r = Math.sqrt(dx * dx + dz * dz); }
    // [FX fix m2-r1] the (static) spot search reruns only when the agent left its spot / turned / changed level (see
    // POLE); the base follows the agent between, as a cached offset
    const lvl = a.floorY > 2 ? 1 : 0, mx = a.x - B.ax, mz = a.z - B.az, inPit = !!pitC && r < pitR && r > 0.2;
    const search = mx * mx + mz * mz > POLE.moveM * POLE.moveM || lvl !== B.lvl || inPit !== B.pit
      || (!inPit && Math.abs(Math.sin(((a.yaw ?? 0) - B.yaw) / 2)) > Math.sin(POLE.turn));
    if (inPit) {
      // [FX fix m175-r2] behind the sofa back, half a seat along the ring, stepped along the ring off the floor lamps
      if (search) { penSelf = p; pitPoleSpot(a.x, a.z, pitC, spotsOf(), PS, poleTaken); B.ox = PS.x - a.x; B.oz = PS.z - a.z; searches++; }
      B.px = a.x + B.ox; B.pz = a.z + B.oz; B.pit = true; B.hat = false;
      B.footY = floorOf(B.px, B.pz, a.floorY);
      B.topY = Math.max(a.top + PENNANT.pitAbove, B.footY + PENNANT.minTop) + H * 0.5;
    } else {
      // [FX fix m175-r2] world-fixed: the agent's own right (body yaw), else its left, else behind, else a mini flag on
      // the crown; never a spot through a wall / the bay glazing / in a desk (the old camera-relative spot walked with
      // the viewer and stood in the E2 front mullion)
      if (search) {
        B.cand = sidePoleSpot(a.x, a.z, a.yaw ?? 0, lvl, spotsOf(), B.pit ? -1 : B.cand, PS);
        B.ox = PS.x - a.x; B.oz = PS.z - a.z; searches++;
      }
      B.px = a.x + B.ox; B.pz = a.z + B.oz; B.pit = false; B.hat = B.cand >= POLE_CANDS.length;
      if (B.hat) {
        // on the crown: a short staff from the hat, the flag just over it
        B.footY = a.top - 0.04;
        B.topY = a.top + PENNANT.hatAbove + H;
      } else {
        B.topY = Math.max(a.top + PENNANT.above, a.floorY + PENNANT.minTop) + H * 0.5;
        B.footY = Math.max(a.floorY + 0.35, B.topY - 1.05);
      }
    }
    if (search) { B.ax = a.x; B.az = a.z; B.yaw = a.yaw ?? 0; B.lvl = lvl; }
    // [FX fix m175-r2] a pole standing nearer the lens than its agent (the Pit's near side from pitOverview) would draw
    // a floor-to-flag line through the sofa and the agent: it becomes a short stub under the flag (hysteresis 0.1 m)
    const dB = hyp2(B.px - cam.x, B.pz - cam.z), dA = hyp2(a.x - cam.x, a.z - cam.z);
    B.stub = B.hat ? false : B.stub ? dB < dA + 0.1 : dB < dA - 0.1;
    return B;
  }
  /** Screen rect (px) of a pennant's flag for side sd (±1) at fan level `lift`, into `out`; false if behind the lens. */
  const pv = new THREE.Vector3();
  function flagRect(p: Pennant, sd: number, lift: number, camera: THREE.Camera, vw: number, vh: number, out: number[]): boolean {
    const B = p.base, s = p.sEff;
    if (!B) return false; // (every shown pennant has its base)
    const W = PENNANT.w * s + PENNANT.tip * s, H = PENNANT.h * s;
    const top = B.topY + lift * H * PENNANT.fan, x0 = B.px, z0 = B.pz, x1 = B.px + camR.x * sd * (W + 0.012), z1 = B.pz + camR.z * sd * (W + 0.012);
    let a0 = Infinity, b0 = Infinity, a1 = -Infinity, b1 = -Infinity;
    for (let k = 0; k < 4; k++) {
      pv.set(k & 1 ? x1 : x0, k & 2 ? top : top - H, k & 1 ? z1 : z0).project(camera);
      if (pv.z > 1 || pv.z < -1) return false;
      const px = (pv.x * 0.5 + 0.5) * vw, py = (-pv.y * 0.5 + 0.5) * vh;
      if (px < a0) a0 = px; if (px > a1) a1 = px; if (py < b0) b0 = py; if (py > b1) b1 = py;
    }
    out[0] = a0; out[1] = b0; out[2] = a1; out[3] = b1;
    return true;
  }
  const PEN_CAND: [number, number][] = [[1, 0], [-1, 0], [1, 1], [-1, 1], [1, 2], [-1, 2]];
  let penSlabs: Slab[] | null = null, penNearHidden = 0, penEdgeHidden = 0, penSlabHidden = 0;
  /** [FX fix m2-r3] is a flag rect inside the frame enough to draw? (> EDGE.cut outside → no; back in below EDGE.back) */
  // [FX fix m3-r3] the HUD chip bar band is off-frame too (wu22-02: 'Write migration guide' cut by the chips)
  const penInFrame = (r: ArrayLike<number>, was: boolean | undefined) => outsideFrac(r[0], r[1], r[2], r[3], 0, ctx0.vw, ctx0.vh, PEN_CAP.hudTop * (ctx0.vh / PEN_CAP.refVh)) <= (was ? EDGE.cut : EDGE.back);
  const PEN_MAX = 160, penOrder: Pennant[] = [], penR = new Float64Array(4 * PEN_MAX), penSoft = new Uint8Array(PEN_MAX), candR = [0, 0, 0, 0], penObs: PlacardRect[] = [];
  let penDeclutterHidden = 0, penN = 0;
  /** is screen rect r clear of the placed flags (and, `soft`, of the strips / signs)? (hoisted: no closure per frame) */
  function penFree(r: ArrayLike<number>, soft: boolean): boolean {
    for (let j = 0; j < penN; j++) {
      if (penSoft[j] && !soft) continue;
      const i = j * 4; if (r[0] < penR[i + 2] + 3 && r[2] > penR[i] - 3 && r[1] < penR[i + 3] + 3 && r[3] > penR[i + 1] - 3) return false;
    }
    return true;
  }
  /**
   * [FX fix m175-r1] Screen-space pennant declutter (crowd40 at the Pit stacked 'Dedupe ETL rows' behind 'Tune nginx'):
   * nearest first, each flag keeps its last spot if still free, else takes the first free candidate (camera-right,
   * camera-left, then one / two fan levels up); a flag with no free spot is hidden (its agent's plate still names it).
   * The fan lift eases (no pop); the side flips at once.
   */
  function declutterPennants(camera: THREE.PerspectiveCamera, dt: number) {
    const vw = ctx0.vw, vh = ctx0.vh;
    penOrder.length = 0;
    for (const p of pennantList) { p.penHidden = false; if (p.shown) penOrder.push(p); }
    sortInPlace(penOrder, byDist);
    // soft obstacles first: the storefront strips and sign plates in view (a flag steps aside / up off them if it can)
    let n = 0;
    penDeclutterHidden = 0;
    if (penOrder.length) {
      const m = rects(camera, vw, vh, penObs, true);
      for (let i = 0; i < m && n < PEN_MAX; i++) { const r = penObs[i]; penR[n * 4] = r.x0; penR[n * 4 + 1] = r.y0; penR[n * 4 + 2] = r.x1; penR[n * 4 + 3] = r.y1; penSoft[n] = 1; n++; }
    }
    penN = n;
    penNearHidden = 0; penEdgeHidden = 0; penSlabHidden = 0;
    penSlabs ??= bakeSlabs(layout);
    for (let pi = 0; pi < penOrder.length; pi++) {
      const p = penOrder[pi];
      // [FX fix m2-r3] a flag whose pole or agent is within PEN_NEAR.m of the lens (pitOverview h13: a done pennant just
      // outside the frame filled the lower-left corner, 150 × 300 px of green flag + card) is not drawn, back past
      // PEN_NEAR.back; nor one on the other side of a floor slab (under the mezzanine seen from it)
      const B = p.base;
      if (!B) continue; // (every shown pennant has its base)
      const dPole = hyp2(B.px - cam.x, B.pz - cam.z), dNear = Math.min(dPole, p.dist);
      const flagY = B.topY - PENNANT.h * p.sEff * 0.5;
      p.nearHid = dNear < (p.nearHid ? PEN_NEAR.back : PEN_NEAR.m);
      if (p.nearHid) { p.shown = false; p.penHidden = true; p.edgeOk = false; penNearHidden++; continue; }
      if (penSlabs.length && slabBlocks(penSlabs, cam.x, cam.y, cam.z, B.px, flagY, B.pz)) { p.shown = false; p.penHidden = true; p.edgeOk = false; penSlabHidden++; continue; }
      let pick = -1, prev = -1, framed = false;
      for (let c = 0; c < PEN_CAND.length; c++) if (PEN_CAND[c][0] === p.sideT && PEN_CAND[c][1] === p.liftT) { prev = c; break; }
      for (let pass = 0; pass < 2 && pick < 0; pass++) {
        for (let c = -1; c < PEN_CAND.length; c++) {
          const ci = c < 0 ? prev : c;
          if (ci < 0) continue;
          // [FX fix m2-r3] a flag reaching behind the lens (it projected huge) or cut by the frame edge (> EDGE.cut
          // outside, the same off-view rule the nameplates follow) is no spot: try the other side / lift, else hide
          if (!flagRect(p, PEN_CAND[ci][0], PEN_CAND[ci][1], camera, vw, vh, candR) || !penInFrame(candR, p.edgeOk)) continue;
          framed = true;
          if (penFree(candR, pass === 0)) { pick = ci; break; }
        }
      }
      p.edgeOk = pick >= 0;
      if (pick < 0) { p.shown = false; p.penHidden = true; if (framed) penDeclutterHidden++; else penEdgeHidden++; continue; }
      p.sideT = PEN_CAND[pick][0]; p.liftT = PEN_CAND[pick][1];
      if (flagRect(p, p.sideT, p.liftT, camera, vw, vh, candR) && penN < PEN_MAX) { penR.set(candR, penN * 4); penSoft[penN] = 0; penN++; }
      if (p.side !== p.sideT) p.side = p.sideT;
      const step = 4 * dt;
      p.lift = Math.abs(p.liftT - p.lift) <= step ? p.liftT : p.lift + Math.sign(p.liftT - p.lift) * step;
    }
  }
  const ctx0 = { vw: 1600, vh: 900 };
  const fwd3 = new THREE.Vector3(0, 0, -1);
  let penFurled = 0; // [FX fix m3-r3] non-subject flags furled by a walk-up this frame

  // ---- [FX fix m175-r1] desk board collapse (pip) ----
  const bayHasStrip = (bay: string | null) => {
    const st = bay ? strips.get(bay) : null;
    if (!st?.lines.length) return false;
    for (let i = 0; i < st.spots.length; i++) if (st.spots[i].legible) return true;
    return false;
  };
  const byDist = (x: { dist: number }, y: { dist: number }) => (x.dist < y.dist ? -1 : x.dist > y.dist ? 1 : 0); // small-int result (no boxed float)
  const boardOrder: Board[] = [], boardR = new Float64Array(4 * 128), PB = { ...P };
  /** Screen rect of a board's full (uncollapsed) current pose into `out`; false when behind the lens / off screen. */
  let boardBehind = false; // [FX fix m2-r3] set by boardRect: a corner is behind the lens
  function boardRect(b: Board, camera: THREE.Camera, vw: number, vh: number, out: number[]): boolean {
    boardBehind = false;
    const Q = boardPoseOf(b.anchor, b.low, b.side, PB, b.s, b.ox);
    let a0 = Infinity, b0 = Infinity, a1 = -Infinity, b1 = -Infinity;
    for (let k = 0; k < 4; k++) {
      const sr = k & 1 ? 1 : -1, su = k & 2 ? 1 : -1;
      pv.set(Q.x + Q.rx * Q.hw * sr + Q.ux * Q.hh * su, Q.y + Q.uy * Q.hh * su, Q.z + Q.rz * Q.hw * sr + Q.uz * Q.hh * su).project(camera);
      if (pv.z > 1 || pv.z < -1) { boardBehind = true; return false; }
      const px = (pv.x * 0.5 + 0.5) * vw, py = (-pv.y * 0.5 + 0.5) * vh;
      if (px < a0) a0 = px; if (px > a1) a1 = px; if (py < b0) b0 = py; if (py > b1) b1 = py;
    }
    if (a1 < 0 || a0 > vw || b1 < 0 || b0 > vh) return false;
    out[0] = a0; out[1] = b0; out[2] = a1; out[3] = b1;
    return true;
  }
  /** [FX fix m175-r1] Is a board (full pose) partly behind a solid wall from the camera? ≈ 5 Hz per board, 5 rays. */
  function boardWalled(b: Board, dt: number): boolean {
    if ((b.occT = (b.occT ?? 0) - dt) > 0) return b.occ;
    b.occT = 0.2 + Math.random() * 0.05;
    occ ??= bakeOccluders(layout);
    const Q = boardPoseOf(b.anchor, b.low, b.side, PB, b.s, b.ox), o = occ;
    const hw = Q.hw * 0.8, hh = Q.hh * 0.8; // inset: a frame grazing the very edge is not a cut
    b.occ = !!o.length && (ray(o, Q.x, Q.y, Q.z) || ray(o, Q.x + Q.rx * hw, Q.y + hh, Q.z + Q.rz * hw) || ray(o, Q.x - Q.rx * hw, Q.y + hh, Q.z - Q.rz * hw)
      || ray(o, Q.x + Q.rx * hw, Q.y - hh, Q.z + Q.rz * hw) || ray(o, Q.x - Q.rx * hw, Q.y - hh, Q.z - Q.rz * hw));
    return b.occ;
  }
  /**
   * [FX fix m175-r1] Each frame: a desk board whose bay strip lists its task collapses to its pip while the camera is
   * outside that bay and one of the bay's strips is legible from it (shown, unoccluded, facing within 70°): the placard
   * repeated the strip and, seen through the glazing, boards truncated each other. Every remaining board, nearest first, collapses when its screen rect would overlap a nearer shown board's (never a
   * clipped / overlapped placard). Rects use the full pose, so the choice does not feed back on itself.
   */
  let boardNearHidden = 0;
  function declutterBoards(camera: THREE.PerspectiveCamera, dt: number) {
    boardNearHidden = 0;
    const camZone = layout?.zoneAt?.(cam.x, cam.z, cam.y > 2.6 ? 1 : 0) ?? null;
    boardOrder.length = 0;
    for (const b of boardList) {
      const bay = b.anchor.bay;
      if (bay && camZone !== bay && bayHasStrip(bay)) { b.pipT = 1; b.pipWhy = 'bay'; }
      else if (b.shown && camZone !== bay && boardWalled(b, dt)) { b.pipT = 1; b.pipWhy = 'wall'; } // a solid wall would cut it
      else { b.pipT = 0; b.pipWhy = ''; if (b.shown) boardOrder.push(b); }
    }
    sortInPlace(boardOrder, byDist);
    let n = 0;
    for (let bi = 0; bi < boardOrder.length; bi++) {
      const b = boardOrder[bi];
      const inView = boardRect(b, camera, ctx0.vw, ctx0.vh, candR);
      // [FX fix m2-r3] a task card within PEN_NEAR.m of the lens (plan, to its anchor) or reaching behind it (it
      // projects huge over a frame corner) is not drawn, like the pennants
      const near = boardBehind || b.dist < (b.nearHid ? PEN_NEAR.back : PEN_NEAR.m);
      if (near !== !!b.nearHid) { b.nearHid = near; dirtyGeo = true; }
      if (near) { b.shown = false; boardNearHidden++; continue; }
      if (!inView) continue;
      let hit = false;
      for (let j = 0; j < n && !hit; j++) { const i = j * 4; hit = candR[0] < boardR[i + 2] + 2 && candR[2] > boardR[i] - 2 && candR[1] < boardR[i + 3] + 2 && candR[3] > boardR[i + 1] - 2; }
      if (hit) { b.pipT = 1; b.pipWhy = 'overlap'; continue; }
      if (n < 128) { boardR.set(candR, n * 4); n++; }
    }
    for (const b of boardList) {
      if (b.pip === b.pipT) continue;
      const step = PIP.ease * dt;
      b.pip = Math.abs(b.pipT - b.pip) <= step ? b.pipT : b.pip + Math.sign(b.pipT - b.pip) * step;
      if (b.shown) dirtyGeo = true;
    }
  }

  // ---- [FX fix m175-r1] strip wall occlusion ----
  let occ: Occluder[] | null = null;
  const ray = (o: Occluder[], x: number, y: number, z: number) => { const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z, T = hyp3(dx, dy, dz) || 1; return wallBlocks(o, cam.x, cam.y, cam.z, dx / T, dy / T, dz / T, T - 0.08); };
  /** The wall bake minus the strip's own host wall(s) (signs sit within the wall's thickness, behind its centreline). */
  function occFor(sp: StripSpot): Occluder[] {
    occ ??= bakeOccluders(layout);
    const rx = Math.cos(sp.yaw), rz = -Math.sin(sp.yaw);
    return occ.filter((w) => {
      if (Math.abs(w.ux * rx + w.uz * rz) < 0.98) return true;
      const qx = sp.x - w.ax, qz = sp.z - w.az, along = qx * w.ux + qz * w.uz, off = Math.abs(qx * w.uz - qz * w.ux);
      return !(off < 0.35 && along > -0.5 && along < w.len + 0.5);
    });
  }
  function stripWalled(sp: StripSpot, st: Strip): boolean {
    const o = sp.occList ??= occFor(sp);
    if (!o.length) return false;
    const rx = Math.cos(sp.yaw), rz = -Math.sin(sp.yaw), nx = Math.sin(sp.yaw) * 0.03, nz = Math.cos(sp.yaw) * 0.03;
    const hw = (sp.w / 2) * sp.s * 0.92, h = (st.h || 0.3) * sp.s, top = stripTop(sp, sp.s) - 0.02, bot = top + 0.02 - h * 0.9;
    return ray(o, sp.x + nx, (top + bot) / 2, sp.z + nz) || ray(o, sp.x + rx * hw + nx, top, sp.z + rz * hw + nz) || ray(o, sp.x - rx * hw + nx, top, sp.z - rz * hw + nz)
      || ray(o, sp.x + rx * hw + nx, bot, sp.z + rz * hw + nz) || ray(o, sp.x - rx * hw + nx, bot, sp.z - rz * hw + nz);
  }

  // ---- [FX fix m175-r2] strip vs the view-strip edge and the alert cards ----
  const SR = [0, 0, 0, 0];
  /** Screen rect (px) of strip spot `sp` at scale `sc` (tile height h m) into SR; false if a corner is behind the lens. */
  function stripRect(sp: StripSpot, h: number, sc: number, camera: THREE.Camera): boolean {
    const rx = Math.cos(sp.yaw), rz = -Math.sin(sp.yaw), hw = (sp.w / 2) * sc, hh = (h / 2) * sc, cy = stripTop(sp, sc) - hh;
    let a0 = Infinity, b0 = Infinity, a1 = -Infinity, b1 = -Infinity;
    for (let k = 0; k < 4; k++) {
      const sr = k & 1 ? 1 : -1, su = k & 2 ? 1 : -1;
      pv.set(sp.x + rx * hw * sr, cy + hh * su, sp.z + rz * hw * sr).project(camera);
      if (pv.z > 1 || pv.z < -1) return false;
      const px = (pv.x * 0.5 + 0.5) * ctx0.vw, py = (-pv.y * 0.5 + 0.5) * ctx0.vh;
      if (px < a0) a0 = px; if (px > a1) a1 = px; if (py < b0) b0 = py; if (py > b1) b1 = py;
    }
    SR[0] = a0; SR[1] = b0; SR[2] = a1; SR[3] = b1;
    return true;
  }
  /** Fraction (0..1) of the strip's screen rect outside the visible world strip (roster / drawer insets `vs`). */
  function stripOut(sp: StripSpot, h: number, sc: number, camera: THREE.Camera, vs: { left?: number; right?: number } | null | undefined): number {
    if (!stripRect(sp, h, sc, camera)) return 1;
    return outsideFrac(SR[0], SR[1], SR[2], SR[3], vs?.left ?? 0, ctx0.vw - (vs?.right ?? 0), ctx0.vh);
  }
  /** Does a placed alert card (last frame) cover ≥ EDGE.cardFrac of the strip's rect (or its text band)? */
  function cardsOver(sp: StripSpot, h: number, sc: number, camera: THREE.Camera, cards: { n: number; r: Float64Array } | null | undefined): boolean {
    if (!cards?.n || !stripRect(sp, h, sc, camera)) return false;
    const area = Math.max(1, (SR[2] - SR[0]) * (SR[3] - SR[1]));
    for (let j = 0; j < cards.n; j++) {
      const i = j * 4, r = cards.r;
      const w = Math.min(SR[2], r[i + 2]) - Math.max(SR[0], r[i]), hh = Math.min(SR[3], r[i + 3]) - Math.max(SR[1], r[i + 1]);
      if (w > 0 && hh > 0 && (w * hh) / area >= EDGE.cardFrac) return true;
    }
    return false;
  }

  let stripT = 0;
  const G = { s: 1, ox: 0 };
  let budget = 0;
  /** paint a dirty tile within this frame's budget (hoisted: no closure per frame) */
  function paint<T extends { dirty: boolean }>(r: T, fn: (r: T) => boolean) { if (!r.dirty || budget <= 0) return; budget--; if (fn(r)) { r.dirty = false; redraws++; dirtyGeo = true; } }
  // [FX fix m2-r1] the strip edge test's lazy nominal-size probe, hoisted (was a closure per strip spot per frame)
  let eSp: StripSpot | null = null, eH = 0, eSg = 1, eCam: THREE.Camera | null = null, eVs: { left?: number; right?: number } | null = null;
  const nominalOut = () => (eSp && eCam && eSg > 1.01 ? stripOut(eSp, eH, 1, eCam, eVs) : 1);
  function update(ctx: { camera: THREE.PerspectiveCamera; dt?: number }, query: PlacardQuery | ((id: string) => string | undefined) = {}) {
    // (the legacy form passes just the status lookup)
    const qy: PlacardQuery = typeof query === 'function' ? { statusOf: query } : query;
    const { statusOf, posOf, nameOf, stripTaskOf } = qy;
    atlas.prepare();
    const dt = Math.min(0.1, ctx.dt || 0.016);
    time += dt;
    const vs = qy.strip?.() ?? null;
    ctx.camera.updateMatrixWorld();
    ctx.camera.matrixWorld.extractBasis(camR, camU, camF);
    camF.negate(); camF.y = 0; camR.y = 0;
    if (camF.lengthSq() < 1e-6) camF.set(0, 0, -1);
    if (camR.lengthSq() < 1e-6) camR.set(1, 0, 0);
    camF.normalize(); camR.normalize();
    ctx.camera.getWorldPosition(cam);
    const el = renderer?.domElement;
    ctx0.vw = el?.clientWidth || globalThis.innerWidth || 1600; ctx0.vh = el?.clientHeight || globalThis.innerHeight || 900;
    // strips follow the boards (≤ 4 Hz: names / tasks change rarely)
    if ((stripT -= dt) <= 0) { stripT = 0.25; syncStrips(nameOf, stripTaskOf); }
    budget = MAX_TILES_PER_FRAME;
    for (const b of boardList) paint(b, paintBoard);
    for (const p of pennantList) paint(p, paintPennant);
    for (const st of stripList) paint(st, paintStrip);
    // hide beyond 18 m (rebuild only when the shown set changes); drop active boards near the camera / when blocked
    // shown-set signature (no per-frame string building): rolling hash over the iteration order + shown flags
    let key = boards.size * 7919 + pennants.size * 104729, ki = 0;
    for (const b of boardList) {
      const id = b.id, A = b.anchor;
      const d = hyp2(A.x - cam.x, A.z - cam.z);
      b.dist = d;
      b.shown = !b.dirty && !!b.tile && d < PLACARD_HIDE_M;
      ki++; if (b.shown) key = (Math.imul(key, 33) + ki) | 0;
      // [FX M1.75] distance growth (tall form), away from the row neighbours
      // referred to the lettered cap: a long task that wrapped smaller grows a little more
      const g = grownExtent(farScale(hyp2(d, A.y - cam.y), (BOARD.farRef * b.capM) / BOARD.cap, BOARD.farMax), A.lim, BOARD.w / 2, G);
      if (Math.abs(g.s - b.s) > 0.004 || Math.abs(g.ox - b.ox) > 0.002) { b.s = g.s; b.ox = g.ox; if (b.shown && b.low < 1) dirtyGeo = true; }
      if (!A.low) continue;
      // [FX fix r2] the near card stands on the viewer's side of the desk (flips over when the viewer crosses it)
      b.sideT = lowSideTarget(A, cam.x, cam.z, b.sideInit ? b.sideT : lowSideTarget(A, cam.x, cam.z, 0));
      if (!b.sideInit) { b.sideInit = true; b.side = b.sideT; }
      if (b.side !== b.sideT) {
        const step = LOW.flip * dt;
        b.side = Math.abs(b.sideT - b.side) <= step ? b.sideT : b.side + Math.sign(b.sideT - b.side) * step;
        if (b.shown && b.low > 0) dirtyGeo = true;
      }
      const facing = Math.abs((cam.x - A.x) * Math.sin(A.yaw) + (cam.z - A.z) * Math.cos(A.yaw)) / Math.max(1e-6, d);
      // [FX M1.75] blocked drops the board only while the owner is at the desk (its "hey!" hand owns the air); at the
      // queue the board keeps saying what it was doing
      let blockedHere = false;
      if (statusOf?.(id) === 'blocked') {
        const o = posOf?.(id);
        blockedHere = !o || hyp2(o.x - A.low.cx, o.z - A.low.cz) < AT_DESK_M;
      }
      b.lowT = placardLowTarget(d, b.lowT, blockedHere, facing, b.muted);
      if (b.pipT && b.pipWhy === 'bay') b.lowT = b.low; // a collapsed board does not glide to the near card meanwhile
      if (b.low !== b.lowT) {
        const step = LOW.ease * dt;
        b.low = Math.abs(b.lowT - b.low) <= step ? b.lowT : b.low + Math.sign(b.lowT - b.low) * step;
        if (b.shown) dirtyGeo = true;
      }
    }
    declutterBoards(ctx.camera, dt);
    // [FX fix m3-r3] pennant width cap + walk-up furl inputs (PEN_CAP)
    ctx.camera.getWorldDirection(fwd3);
    const ppm = ctx0.vh / (2 * Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov ?? 60) / 2)), capPx = PEN_CAP.px * (ctx0.vh / PEN_CAP.refVh);
    let subj = qy.subject?.() ?? null;
    if (subj) { const sp = posOf?.(subj); if (!sp || hyp2(sp.x - cam.x, sp.z - cam.z) > PEN_CAP.subjM) subj = null; }
    penFurled = 0;
    for (const p of pennantList) {
      const d = hyp2(p.at.x - cam.x, p.at.z - cam.z);
      p.dist = d;
      p.shown = !p.dirty && !!p.tile && d < PLACARD_HIDE_M && p.at.vis !== false;
      p.sEff = farScale(hyp2(d, p.at.top - cam.y), (PENNANT.farRef * p.capM) / PENNANT.cap, PENNANT.farMax);
      const B = pennantBase(p);
      // grow for the flag's own distance (the Pit pole stands ~1 m behind its agent)
      const dF = hyp2(B.px - cam.x, B.pz - cam.z);
      if (dF > d) { p.sEff = farScale(hyp2(dF, B.topY - cam.y), (PENNANT.farRef * p.capM) / PENNANT.cap, PENNANT.farMax); pennantBase(p); }
      // [FX fix m3-r3] on-screen width cap (PEN_CAP): view depth of the flag's middle (pole + half a flag camera-right)
      const hwF = (PENNANT.w * p.sEff) / 2, depth = (B.px + camR.x * hwF * p.side - cam.x) * fwd3.x + (B.topY - cam.y) * fwd3.y + (B.pz + camR.z * hwF * p.side - cam.z) * fwd3.z;
      const sCap = penCapScale(p.sEff, PENNANT.w + PENNANT.tip, depth, ppm, capPx);
      // [FX fix m3-r3] walk-up: a non-subject flag within PEN_CAP.fadeM furls away (eased), back past fadeBack
      const near = subj && p.id !== subj && Math.min(d, dF) < (p.furlT ? PEN_CAP.fadeBack : PEN_CAP.fadeM);
      p.furlT = near ? 1 : 0;
      const kT = near ? 0 : 1, stepK = PEN_CAP.fade * dt;
      p.furlK = p.furlK == null ? kT : Math.abs(kT - p.furlK) <= stepK ? kT : p.furlK + Math.sign(kT - p.furlK) * stepK;
      if (sCap !== p.sEff || p.furlK < 1) { p.sEff = sCap * Math.max(PEN_CAP.minK, p.furlK); pennantBase(p); }
      if (p.furlK <= PEN_CAP.minK) { if (p.shown) penFurled++; p.shown = false; }
      ki++; if (p.shown) { key = (Math.imul(key, 33) + ki) | 0; dirtyGeo = true; } // sways + follows its agent: rebuilt every frame while shown
    }
    if (pennants.size) declutterPennants(ctx.camera, dt);
    for (const st of stripList) {
      for (let i = 0; i < st.spots.length; i++) {
        const sp = st.spots[i];
        sp.dist = hyp2(sp.x - cam.x, sp.z - cam.z);
        // single-sided on the wall: only from the front
        const front = (cam.x - sp.x) * Math.sin(sp.yaw) + (cam.z - sp.z) * Math.cos(sp.yaw) > 0.05;
        // [FX fix m175-r1] never a clipped strip: one a solid wall cuts (the W2 strip through E2's storefront from
        // eBayGlass read 'rbor · … trel') is not drawn at all (≈ 5 Hz, 5 rays)
        if (front && (sp.occT -= dt) <= 0) { sp.occT = 0.2 + Math.random() * 0.05; sp.occ = stripWalled(sp, st); }
        sp.shown = !st.dirty && !!st.tile && st.lines.length > 0 && front && !sp.occ && sp.dist < PLACARD_HIDE_M + 6;
        // legible from here (the desk boards of its bay collapse to pips only then): shown, facing the lens within 70°
        const fcos = ((cam.x - sp.x) * Math.sin(sp.yaw) + (cam.z - sp.z) * Math.cos(sp.yaw)) / Math.max(1e-6, hyp2(sp.dist, sp.y - cam.y));
        sp.legible = sp.shown && fcos >= 0.35; // (before the edge / card rules below: the bay's boards stay pips)
        const nominal = st.lines.length <= 3 ? STRIP.capBig : STRIP.capSmall; // = stripDims(n).cap, no object per spot per frame
        let sg = farScale(hyp2(sp.dist, sp.y - cam.y), (STRIP.farRef * (st.cap || nominal)) / nominal, STRIP.farMax);
        // [FX fix m175-r2] never a strip the view-strip edge cuts (pitOverview drew E3's as 130 px fragments at the left
        // edge): > EDGE.cut of its rect outside the strip → it shrinks to its nominal size, and if that is still cut it
        // is not drawn (back only below EDGE.back: no flicker at the threshold)
        if (sp.shown && st.h > 0) {
          eSp = sp; eH = st.h; eSg = sg; eCam = ctx.camera; eVs = vs;
          sp.edge = stripEdgeLevel(stripOut(sp, st.h, sg, ctx.camera, vs), nominalOut, sp.edge ?? 0);
          if (sp.edge === 1) sg = 1;
          // [FX fix m175-r2] …and a strip under a placed alert card yields to it (onyx's card covered E3's strip at the
          // spawn / lobbyDesk: the card is pinned, the strip is not); back 0.5 s after the card has left
          if (sp.edge < 2 && cardsOver(sp, st.h, sg, ctx.camera, qy.cards?.())) sp.cardT = EDGE.cardHold;
          else sp.cardT = Math.max(0, (sp.cardT ?? 0) - dt);
          // a strip hidden under a card stays a label obstacle (its last rect): the card keeps trying to move off it,
          // and the strip is back once the card found a spot clear of it (mutual avoidance, no ping-pong)
          sp.cardHid = sp.edge < 2 && sp.cardT > 0;
          if (sp.cardHid) { const hw = (sp.w / 2) * sg, hh = (st.h / 2) * sg; (CQ[0] = sp.x, CQ[1] = stripTop(sp, sg) - hh, CQ[2] = sp.z, CQ[3] = Math.cos(sp.yaw) * hw, CQ[4] = 0, CQ[5] = -Math.sin(sp.yaw) * hw, CQ[6] = 0, CQ[7] = hh, CQ[8] = 0, cornersQ(sp.c)); }
          if (sp.edge === 2 || sp.cardT > 0) sp.shown = false;
        } else { sp.edge = 0; sp.cardT = 0; sp.cardHid = false; }
        if (Math.abs(sg - sp.s) > 0.004) { sp.s = sg; if (sp.shown) dirtyGeo = true; }
        ki++; if (sp.shown) key = (Math.imul(key, 33) + ki) | 0;
      }
    }
    if (key !== lastShownKey) { lastShownKey = key; dirtyGeo = true; }
    if (dirtyGeo) { dirtyGeo = false; rebuild(); }
    // non-emissive paper: follow the room's light (day ≈ lit whiteboard, night dimmer)
    uIntensity.value = 0.74 - 0.2 * U.uNight.value;
  }

  const v = new THREE.Vector3();
  interface ShownLabel { id: string; kind: 'desk' | 'pennant' | 'strip'; text: string; c: Float32Array; capM: number; sEff: number; low: number; bay: string | null; muted: boolean }
  /** Every shown label as {id, kind, text, c (corners), capM, sEff, low, bay} (check / rects). */
  function* shownLabels(): Generator<ShownLabel> {
    for (const [id, b] of boards) if (b.shown && b.pip < 0.5) yield { id, kind: 'desk', text: b.text, c: b.c, capM: b.capM, sEff: b.sEff, low: b.low, bay: b.anchor.bay, muted: b.muted };
    for (const [id, p] of pennants) if (p.shown) yield { id, kind: 'pennant', text: p.text, c: p.c, capM: p.capM, sEff: p.sEff, low: 0, bay: null, muted: false };
    for (const st of stripList) for (let i = 0; i < st.spots.length; i++) {
      const sp = st.spots[i];
      if (sp.shown) yield { id: `strip:${st.bay}:${i}`, kind: 'strip', text: st.lines.map((l) => `${l.name} · ${l.task}`).join(' / '), c: sp.c, capM: st.cap, sEff: sp.s, low: 0, bay: st.bay, muted: false };
    }
  }

  /**
   * `__hq.placardCheck()` (§6.7 sightline acceptance): for every label in view (desk boards, ✓ pennants, storefront
   * strips), the projected cap height (px) and the fraction of a 5×3 sample grid that is inside the frustum × a
   * grazing-angle factor. `pass`: every gated label has capPx ≥ 6 and visibleFrac ≥ 0.7 (null = n/a: nothing gated in
   * view and no strip cut). Gated = labels whose centre is
 * in the frame with ≥ 80% of the sample grid (a label the frame edge cuts is framing, not placard legibility) and that
 * face the lens within 70°
 * (|cos| ≥ 0.35: a facade strip seen edge-on down the street is not "in view" as text) among: E-bay desk boards
   * (every board on a layout without bays) in their tall form, pennants, and strips within 18 m. Near cards (a board
   * that dropped because the owner is blocked at the desk / the viewer is close) are listed, not gated.
   * (Depth occlusion is not sampled; the reviewer reads the shots for that.)
   * @param vh viewport height px
   */
  function check(camera: THREE.PerspectiveCamera, vh: number) {
    camera.updateMatrixWorld();
    camera.getWorldPosition(cam);
    const items = [];
    const f = 1 / Math.tan((camera.fov * Math.PI) / 360);
    let pass = true, minCap = Infinity, minVis = Infinity, cutN = 0;
    for (const L of shownLabels()) {
      const c = L.c;
      const ex = c[3] - c[0], ey = c[4] - c[1], ez = c[5] - c[2], fx = c[9] - c[0], fy = c[10] - c[1], fz = c[11] - c[2];
      let inside = 0, n = 0;
      for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) {
        n++;
        const a = i / 4, b = j / 2;
        v.set(c[0] + ex * a + fx * b, c[1] + ey * a + fy * b, c[2] + ez * a + fz * b).project(camera);
        if (v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1) inside++;
      }
      if (!inside) continue;
      const mx = c[0] + (ex + fx) / 2, my = c[1] + (ey + fy) / 2, mz = c[2] + (ez + fz) / 2;
      v.set(mx, my, mz).project(camera);
      const centreIn = v.z < 1 && Math.abs(v.x) <= 0.98 && Math.abs(v.y) <= 0.98;
      const d = Math.hypot(cam.x - mx, cam.y - my, cam.z - mz);
      // facing: normal = e × f
      let nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const facing = Math.abs((cam.x - mx) * nx + (cam.y - my) * ny + (cam.z - mz) * nz) / Math.max(1e-6, d);
      const capPx = (L.capM * L.sEff * f * vh) / (2 * d);
      const visibleFrac = (inside / n) * Math.min(1, facing / 0.35);
      const gated = centreIn && inside / n >= 0.8 && facing >= 0.35 && ((L.kind === 'pennant' && d < PENNANT.gateM) || (L.kind === 'strip' && d < PLACARD_HIDE_M)
        || (L.kind === 'desk' && L.low < 0.5 && (!L.bay || String(L.bay).startsWith('E'))));
      if (gated) {
        minCap = Math.min(minCap, capPx); minVis = Math.min(minVis, visibleFrac);
        if (capPx < 6 || visibleFrac < 0.7) pass = false;
      }
      // [FX fix m175-r2] a drawn strip the frame edge cuts (> 15% of its sample grid outside) fails, gated or not
      const cut = L.kind === 'strip' && d < PLACARD_HIDE_M + 6 && inside / n < 1 - EDGE.cut;
      if (cut) { pass = false; cutN++; }
      items.push({ id: L.id, kind: L.kind, text: L.text, low: +L.low.toFixed(2), dist: +d.toFixed(2), capPx: +capPx.toFixed(1), visibleFrac: +visibleFrac.toFixed(2), gated, ...(cut ? { cut } : {}) });
    }
    const gatedN = items.filter((x) => x.gated).length;
    // [FX fix m2-r3] no gated label in view (cafe; plan at 33 m) = n/a (`pass: null`, review status 'info'), not a fail:
    // a red-by-construction check hid real regressions. A gated miss or a cut strip still fails.
    return { pass: !pass ? false : gatedN > 0 ? true : null, na: pass && !gatedN, gated: gatedN, stripsCut: cutN, minCapPx: gatedN ? +minCap.toFixed(1) : null, minVisibleFrac: gatedN ? +minVis.toFixed(2) : null, items };
  }

  /**
   * [FX fix r2] Screen rects (px, top-left origin) of the labels in view, for the label declutter (fx/labels.ts): a
   * bubble or nameplate must not cover a task board / pennant / strip. Fills `out` with reused {x0, y0, x1, y1, id}
   * records (no per-frame allocation) and returns the count.
   */
  // [FX fix m2-r1] rects() state + its per-label projector, hoisted (a closure per call, and Map-entry arrays, were
  // allocated every frame by both the label declutter and the pennant declutter)
  let rN = 0, rCam: THREE.Camera | null = null, rVw = 0, rVh = 0, rOut: PlacardRect[] | null = null;
  function one(c: Float32Array, id: string) {
    if (!rCam || !rOut) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k < 4; k++) {
      v.set(c[k * 3], c[k * 3 + 1], c[k * 3 + 2]).project(rCam);
      if (v.z > 1 || v.z < -1) return;
      const px = (v.x * 0.5 + 0.5) * rVw, py = (-v.y * 0.5 + 0.5) * rVh;
      if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
    }
    if (y1 - y0 < RECT_MIN_PX || x1 < 0 || x0 > rVw || y1 < 0 || y0 > rVh) return;
    const r = rOut[rN] ?? (rOut[rN] = { x0: 0, y0: 0, x1: 0, y1: 0, id: '' });
    r.x0 = x0; r.y0 = y0; r.x1 = x1; r.y1 = y1; r.id = id;
    rN++;
  }
  function rects(camera: THREE.Camera, vw: number, vh: number, out: PlacardRect[], noLabels = false): number {
    rN = 0; rCam = camera; rVw = vw; rVh = vh; rOut = out;
    if (!noLabels) {
      for (const b of boardList) if (b.shown && b.pip < 0.5) one(b.c, b.id); // a pip is no text obstacle
      for (const p of pennantList) if (p.shown) one(p.c, p.id);
    }
    for (const st of stripList) for (let i = 0; i < st.spots.length; i++) { const sp = st.spots[i]; if ((sp.shown || sp.cardHid) && sp.dist < PLACARD_HIDE_M) one(sp.c, st.bay); } // [FX fix m175-r2] cardHid: see update
    for (let i = 0; i < signs.length; i++) {
      const sg = signs[i], dx = cam.x - sg.x, dz = cam.z - sg.z;
      if (dx * dx + dz * dz > 400 || (!sg.two && dx * sg.nx + dz * sg.nz < 0)) continue; // far, or seen from behind
      one(sg.c, 'sign'); // [FX fix m175-r1] bay header plates are sign obstacles too (a card's 2nd try kept clear only of HELP DESK)
    }
    // [FX fix m175-r1] the Big Board (swivelling box over the Pit): its projected box is a sign obstacle for cards and
    // labels (onyx's alert card covered the STATES rows at mezzToPit). Skipped within 3 m (it fills the view then).
    if (bigBoard) {
      const dx = cam.x - bigBoard.x, dz = cam.z - bigBoard.z;
      if (dx * dx + dz * dz > 9) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, ok = true;
        for (let k = 0; k < 8 && ok; k++) {
          v.set(bigBoard.x + (k & 1 ? 1 : -1) * bigBoard.hw, bigBoard.y + (k & 2 ? 1 : -1) * bigBoard.hh, bigBoard.z + (k & 4 ? 1 : -1) * bigBoard.hw).project(camera);
          if (v.z > 1 || v.z < -1) { ok = false; break; }
          const px = (v.x * 0.5 + 0.5) * vw, py = (-v.y * 0.5 + 0.5) * vh;
          if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
        }
        if (ok && x1 > 0 && x0 < vw && y1 > 0 && y0 < vh) {
          const r = out[rN] ?? (out[rN] = { x0: 0, y0: 0, x1: 0, y1: 0, id: '' });
          r.x0 = x0; r.y0 = y0; r.x1 = x1; r.y1 = y1; r.id = 'sign';
          rN++;
        }
      }
    }
    return rN;
  }

  return {
    set, pennant, update, check, rects, mesh,
    /** [FX fix m175-r2] Debug: every shown pennant's pole ({id, x, z, pit, side: 'right'|'left'|'behind'|'hat', stub,
     *  clear: the pole base's free-spot test (walls / glass / furniture / props + 0.15 m)}). */
    poles: () => [...pennants.values()].flatMap((p) => {
      const B = p.base, lvl = p.at.floorY > 2 ? 1 : 0;
      if (!p.shown || !B) return [];
      return [{ id: p.id, x: +B.px.toFixed(2), z: +B.pz.toFixed(2), pit: B.pit, side: B.pit ? 'ring' : ['right', 'left', 'behind', 'hat'][B.cand] ?? '?', stub: B.stub,
        clear: B.hat || spotsOf().free(B.px, B.pz, lvl, POLE.pad - 0.01, B.pit ? null : p.at.x, B.pit ? null : p.at.z, B.pit) }];
    }),
    stats: () => ({ boards: boards.size, pennants: pennants.size, pennantsDecluttered: penDeclutterHidden, pennantsNear: penNearHidden, pennantsEdge: penEdgeHidden, pennantsSlab: penSlabHidden, pennantsFurled: penFurled, boardsNear: boardNearHidden, poleSearches: searches, strips: [...strips.values()].filter((s) => s.lines.length).length, redraws, quads: q, ...atlas.stats() }),
    dispose() { scene.remove(mesh); geo.dispose(); atlas.dispose(); },
  };
}

export type Placards = ReturnType<typeof createPlacards>;
