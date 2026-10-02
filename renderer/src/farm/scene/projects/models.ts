/**
 * The Valley Projects' places, each in two states: as you find it (ruined, dark, overgrown) and restored
 * (model/projects.ts; scene/projects/projects.ts shows one or the other; docs/valley/projects.md).
 *
 * Every builder draws into a Kit in its own local frame (front = +z, ground ≈ y 0; `G(lx, lz)` gives the ground's
 * height there relative to the origin for the few that sit on uneven ground), so the gallery and the system build
 * through the same functions. Glow parts (lantern glass, window panes) become light emitters through the Kit.
 * Animated parts (the mill wheel) are built separately (`buildWheel`).
 */
import * as THREE from 'three';
import { Kit } from '../structures/kit.ts';
import { PAL } from '../toon.ts';

/** ground height relative to the model's origin at a local point */
export type Ground = (lx: number, lz: number) => number;
const FLAT: Ground = () => 0;
const TAU = Math.PI * 2;

const WEED = 0x5f9a3e, WEED_DARK = 0x467a33, IVY = 0x4f8a3a;
const PAINT_WHITE = 0xf3eee2, PAINT_GREEN = 0x4f8a5a, PAINT_CREAM = 0xf1e3c4, BRASS = 0xd8a843;
const RUST_DARK = 0x7a4430;
/** greenhouse glass: a pale aqua tint by day (glow parts: lit from inside at night) */
const GLASS = 0x9ed8dc;

/** a tuft of weeds: a few green spikes */
function weeds(k: Kit, x: number, y: number, z: number, s = 1): void {
  k.part('weeds', () => {
    for (let i = 0; i < 4; i++) {
      const a = i * 1.9 + x * 3.1, r = 0.09 * s;
      k.cone(0.07 * s, (0.32 + (i % 3) * 0.12) * s, i % 2 ? WEED : WEED_DARK, { x: x + Math.cos(a) * r, y: y + (0.15 + (i % 3) * 0.05) * s, z: z + Math.sin(a) * r, rx: Math.cos(a) * 0.25, rz: Math.sin(a) * 0.25 }, 4);
    }
  });
}

/** a small pile of rubble stones */
function rubble(k: Kit, x: number, y: number, z: number, s = 1): void {
  k.part('rubble', () => {
    for (let i = 0; i < 5; i++) {
      const a = i * 2.3, r = (0.12 + (i % 3) * 0.1) * s;
      k.blob(0.13 * s + (i % 2) * 0.05 * s, i % 2 ? PAL.stone : PAL.rock, { x: x + Math.cos(a) * r, y: y + 0.07 * s, z: z + Math.sin(a) * r, s: [1, 0.65, 1] });
    }
  });
}

/** a lantern on a post (feet at the origin; glass glows when `lit`) */
export function lanternPost(k: Kit, lit: boolean, lean = 0, leanDir = 0, height = 1.75): void {
  k.at({ rx: Math.cos(leanDir) * lean, rz: Math.sin(leanDir) * lean }, () => {
    k.surf(['fieldstone', { axis: 'h', scale: 0.6 }], () => k.box(0.34, 0.24, 0.34, PAL.stone, { y: 0.06 }));
    k.box(0.13, height, 0.13, PAL.woodDark, { y: height / 2 + 0.1 });
    k.box(0.44, 0.06, 0.08, PAL.woodDark, { y: height + 0.02, x: 0.16 });
    // the lantern hangs off the arm
    const ly = height - 0.24;
    k.rod(0.32, height, 0, 0.32, ly + 0.2, 0, 0.012, PAL.ink, 3);
    k.box(0.24, 0.04, 0.24, PAL.ink, { x: 0.32, y: ly - 0.17 });
    if (lit) k.box(0.18, 0.28, 0.18, PAL.lampGlow, { x: 0.32, y: ly }, 'glow');
    else k.box(0.18, 0.28, 0.18, 0x58606a, { x: 0.32, y: ly });
    k.cone(0.18, 0.16, PAL.ink, { x: 0.32, y: ly + 0.22, ry: Math.PI / 4 }, 4);
  });
}

/** a fallen lantern head lying in the grass */
function fallenLantern(k: Kit, x: number, y: number, z: number, ry: number): void {
  k.part('fallenLantern', () => k.at({ x, y: y + 0.11, z, ry, rz: Math.PI / 2 }, () => {
    k.box(0.18, 0.26, 0.18, 0x58606a);
    k.cone(0.16, 0.14, PAL.ink, { y: 0.2, ry: Math.PI / 4 }, 4);
  }));
}

// ---------------------------------------------------------------------------------------------------------------
// The projects board (on the square)

/** The Mayor's projects board: two posts, a shingled hood, a cork panel (the live face is a separate canvas quad,
 *  `BOARD_FACE`), a lantern on the side and a contributions box with a coin slot. */
export const BOARD_FACE = Object.freeze({ w: 2.2, h: 1.32, y: 1.5, z: 0.075 });
export function buildBoard(k: Kit): void {
  k.part('projectsBoard', () => {
    for (const s of [-1, 1]) k.box(0.16, 2.6, 0.16, PAL.woodDark, { x: s * 1.24, y: 1.3 });
    k.box(2.44, 1.5, 0.1, PAL.wood, { y: BOARD_FACE.y });
    k.box(2.56, 0.1, 0.16, PAL.woodDark, { y: BOARD_FACE.y + 0.8 });
    k.box(2.56, 0.1, 0.16, PAL.woodDark, { y: BOARD_FACE.y - 0.8 });
    // a little shingled hood
    k.slab(2.9, 0.08, 0.62, PAL.roofGreen, ['shingle', { axis: 'z' }], { y: 2.66, z: 0.2, rx: 0.42 });
    k.slab(2.9, 0.08, 0.5, PAL.roofGreen, ['shingle', { axis: 'z' }], { y: 2.66, z: -0.16, rx: 0.42, ry: Math.PI });
    k.box(2.9, 0.08, 0.08, PAL.woodDark, { y: 2.77, z: 0.03 });
    // the lantern on the right post
    k.box(0.3, 0.05, 0.05, PAL.ink, { x: 1.36, y: 2.12, z: 0.02 });
    k.box(0.16, 0.22, 0.16, PAL.lampGlow, { x: 1.48, y: 1.95, z: 0.02 }, 'glow');
    k.cone(0.14, 0.12, PAL.ink, { x: 1.48, y: 2.12, z: 0.02, ry: Math.PI / 4 }, 4);
  });
  k.part('contributionsBox', () => k.at({ x: -0.75, z: 0.62 }, () => {
    k.box(0.5, 0.62, 0.42, PAL.plank, { y: 0.31 });
    k.box(0.56, 0.06, 0.48, PAL.woodDark, { y: 0.64 });
    k.box(0.24, 0.02, 0.05, PAL.ink, { y: 0.675 });
    k.box(0.06, 0.2, 0.44, PAL.woodDark, { y: 0.31, x: 0.27 });
  }));
}

/** Draw the board's live face: six cards (one per project), a progress bar or a ✓, a lock for the waiting ones. */
export interface BoardCard { title: string; status: 'locked' | 'open' | 'done'; progress: number; ready: boolean }
export function drawBoardFace(g: CanvasRenderingContext2D, W: number, H: number, cards: readonly BoardCard[], done: number): void {
  g.clearRect(0, 0, W, H);
  // cork
  g.fillStyle = '#c4935a'; g.fillRect(0, 0, W, H);
  g.globalAlpha = 0.18;
  for (let i = 0; i < 260; i++) { g.fillStyle = i % 2 ? '#8a5a2e' : '#e8c08a'; g.fillRect((i * 97) % W, (i * 57) % H, 2 + (i % 3), 2); }
  g.globalAlpha = 1;
  // title banner
  g.fillStyle = '#7a3f30';
  g.fillRect(W * 0.18, 8, W * 0.64, H * 0.17);
  g.fillStyle = '#fff3d6';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `bold ${Math.round(H * 0.1)}px "Trebuchet MS", system-ui, sans-serif`;
  g.fillText('VALLEY PROJECTS', W / 2, 8 + H * 0.087);
  g.font = `600 ${Math.round(H * 0.055)}px "Trebuchet MS", system-ui, sans-serif`;
  g.fillStyle = '#4a2e1a';
  g.fillText(`${done} of ${cards.length} restored · press E`, W / 2, H * 0.27);
  // the cards, 3 × 2, slightly askew like pinned paper
  const cw = W * 0.29, ch = H * 0.29;
  cards.forEach((c, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = W * 0.045 + col * (cw + W * 0.03), y = H * 0.33 + row * (ch + H * 0.04);
    g.save();
    g.translate(x + cw / 2, y + ch / 2);
    g.rotate(((i * 37) % 7 - 3) * 0.012);
    g.fillStyle = c.status === 'done' ? '#e9f5dc' : c.status === 'locked' ? '#d9cdb8' : '#fbf3df';
    g.fillRect(-cw / 2, -ch / 2, cw, ch);
    g.strokeStyle = 'rgba(74,46,26,.45)'; g.lineWidth = 2; g.strokeRect(-cw / 2, -ch / 2, cw, ch);
    // pin
    g.fillStyle = c.status === 'done' ? '#3f8a3a' : '#c0392b';
    g.beginPath(); g.arc(0, -ch / 2 + 7, 5, 0, TAU); g.fill();
    g.fillStyle = '#3b2a1e';
    g.font = `bold ${Math.round(ch * 0.2)}px "Trebuchet MS", system-ui, sans-serif`;
    const words = c.title.split(' ');
    const mid = Math.ceil(words.length / 2);
    g.fillText(words.slice(0, mid).join(' '), 0, -ch * 0.16, cw - 10);
    g.fillText(words.slice(mid).join(' '), 0, ch * 0.06, cw - 10);
    if (c.status === 'done') {
      g.strokeStyle = '#3f8a3a'; g.lineWidth = 5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-14, ch * 0.3); g.lineTo(-4, ch * 0.4); g.lineTo(16, ch * 0.2); g.stroke();
    } else if (c.status === 'locked') {
      g.fillStyle = '#6e5a44';
      g.fillRect(-9, ch * 0.26, 18, 13);
      g.strokeStyle = '#6e5a44'; g.lineWidth = 3;
      g.beginPath(); g.arc(0, ch * 0.26, 6, Math.PI, 0); g.stroke();
    } else {
      const bw = cw * 0.72, bh = ch * 0.1, bx = -bw / 2, by = ch * 0.27;
      g.fillStyle = '#8a6a48'; g.fillRect(bx, by, bw, bh);
      g.fillStyle = c.ready ? '#e8b030' : '#5cae4f'; g.fillRect(bx, by, bw * Math.max(0.04, Math.min(1, c.progress)), bh);
    }
    g.restore();
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The lantern path (world space: posts placed by the system along the stones' footpath)

export interface LanternSpot { x: number; y: number; z: number; ry: number }
/** Lantern posts at the given world spots: upright and lit, or knocked askew / fallen with cracked dark glass. */
export function buildLanternPath(k: Kit, spots: readonly LanternSpot[], lit: boolean): void {
  spots.forEach((s, i) => {
    k.part('lanternPost', () => k.at({ x: s.x, y: s.y, z: s.z, ry: s.ry }, () => {
      if (lit) {
        lanternPost(k, true);
        return;
      }
      // dark: every third has lost its lantern (it lies in the grass), the rest lean
      const lean = 0.12 + ((i * 7) % 5) * 0.06, dir = (i * 2.4) % TAU;
      if (i % 3 === 1) {
        k.surf(['fieldstone', { axis: 'h', scale: 0.6 }], () => k.box(0.34, 0.24, 0.34, PAL.stone, { y: 0.06 }));
        k.box(0.13, 0.9, 0.13, PAL.woodDark, { y: 0.55, rz: 0.12 });
      } else {
        lanternPost(k, false, lean, dir);
      }
    }));
    if (!lit && i % 3 === 1) fallenLantern(k, s.x + Math.cos(s.ry) * 0.7, s.y, s.z - Math.sin(s.ry) * 0.7, s.ry + 0.7);
    if (!lit && i % 2 === 0) weeds(k, s.x + 0.25, s.y, s.z + 0.2, 0.8);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The footbridge (local z across the river, world heights: the caller passes the deck ends' ground)

export interface FootbridgeOpts { L: number; w: number; /** ground (world y) at the east (−z) and west (+z) ends */ yA: number; yB: number; water: number; /** the riverbed under a local z (world y) */ bed: (lz: number) => number }
export const FOOTBRIDGE = Object.freeze({ L: 17.2, w: 1.7 });
/** deck top (world y) at local z */
export function footDeck(o: FootbridgeOpts, lz: number): number {
  const u = Math.max(-1, Math.min(1, lz / (o.L / 2)));
  const base = o.yA + (o.yB - o.yA) * (u * 0.5 + 0.5);
  const mid = Math.max(o.water + 1.25, Math.max(o.yA, o.yB) + 0.35);
  const lift = mid - (o.yA + o.yB) / 2;
  return base + lift * Math.cos((u * Math.PI) / 2) ** 1.2;
}
/** the stub ends of the washed-out bridge reach this far in from each bank (|z| ≥ this) */
export const STUB = 5.4;

export function buildFootbridge(k: Kit, o: FootbridgeOpts, restored: boolean): void {
  const { L, w } = o;
  const deckFrom = restored ? -L / 2 : -L / 2, N = 36;
  // stone ends on both banks
  for (const [z, y] of [[-L / 2, o.yA], [L / 2, o.yB]] as const) {
    k.part('abutment', () => {
      k.surf(['fieldstone', { axis: 'h', scale: 0.8 }], () => k.box(w + 0.7, 1.1, 0.9, PAL.stone, { y: y - 0.45, z }));
      for (const s of [-1, 1]) k.surf(['fieldstone', { axis: 'h', scale: 0.55 }], () => k.box(0.3, 1.1, 0.3, PAL.stone, { x: s * (w / 2 + 0.2), y: y + 0.45, z }));
    });
  }
  const span = (za: number, zb: number) => {
    const ya = footDeck(o, za), yb = footDeck(o, zb), len = Math.hypot(zb - za, yb - ya);
    return { ya, yb, len, mid: (za + zb) / 2, my: (ya + yb) / 2, rx: -Math.atan2(yb - ya, zb - za) };
  };
  // the deck: planks across, two stringers under
  k.part('deck', () => {
    for (let i = 0; i < N; i++) {
      const za = deckFrom + (i / N) * L, zb = deckFrom + ((i + 1) / N) * L;
      const keep = restored || Math.abs(za) >= STUB && Math.abs(zb) >= STUB;
      if (!keep) continue;
      const s = span(za, zb);
      k.surf(['planks', { axis: 'x', scale: 0.9 }], () => k.box(w, 0.1, s.len - 0.04, restored ? (i % 2 ? PAL.woodLight : PAL.plank) : (i % 3 ? 0x8f7356 : 0x7d6448), { y: s.my - 0.05, z: s.mid, rx: s.rx }));
      for (const sd of [-1, 1]) k.beam(sd * (w / 2 - 0.18), s.ya - 0.22, za, sd * (w / 2 - 0.18), s.yb - 0.22, zb, 0.16, PAL.woodDark, 'solid', 0.22);
    }
  });
  // trestles into the riverbed (the restored ones whole, the old ones snapped)
  const bents = restored ? [-4.2, 0, 4.2] : [-4.2, 3.9];
  for (const z of bents) {
    k.part('trestle', () => {
      const top = footDeck(o, z) - 0.32, bed = o.bed(z) - 0.25;
      for (const sd of [-1, 1]) {
        if (restored) k.box(0.2, top - bed, 0.2, PAL.woodDark, { x: sd * (w / 2 - 0.12), y: (top + bed) / 2, z });
        else k.box(0.2, o.water + 0.5 - bed, 0.2, 0x5a4434, { x: sd * (w / 2 - 0.12), y: (o.water + 0.5 + bed) / 2, z, rz: sd * 0.08, rx: z * 0.02 });
      }
      if (restored) k.box(w + 0.1, 0.16, 0.2, PAL.woodDark, { y: top - 0.06, z });
    });
  }
  if (restored) {
    // rope rails on little posts
    k.part('rail', () => {
      const PN = 8;
      for (const sd of [-1, 1]) {
        let prev: [number, number] | null = null;
        for (let i = 0; i <= PN; i++) {
          const z = -L / 2 + 0.5 + (i / PN) * (L - 1), y = footDeck(o, z);
          k.box(0.1, 0.95, 0.1, PAL.wood, { x: sd * (w / 2 + 0.02), y: y + 0.42, z });
          k.ball(0.07, PAL.woodDark, { x: sd * (w / 2 + 0.02), y: y + 0.92, z });
          if (prev) {
            const [pz, py] = prev;
            for (const h of [0.86, 0.48]) {
              // a little sag in the rope
              const mz = (pz + z) / 2, my = (py + y) / 2 + h - 0.06;
              k.rod(sd * (w / 2 + 0.02), py + h, pz, sd * (w / 2 + 0.02), my, mz, 0.022, 0xd8c08a, 4);
              k.rod(sd * (w / 2 + 0.02), my, mz, sd * (w / 2 + 0.02), y + h, z, 0.022, 0xd8c08a, 4);
            }
          }
          prev = [z, y];
        }
      }
    });
    // a lantern at each end and a painted name board on the east end
    for (const [z, y, sd] of [[-L / 2 - 0.1, o.yA, 1], [L / 2 + 0.1, o.yB, -1]] as const) {
      k.part('endLantern', () => k.at({ x: sd * (w / 2 + 0.2), y: y + 0.95, z }, () => {
        k.box(0.16, 0.22, 0.16, PAL.lampGlow, { y: 0.2 }, 'glow');
        k.cone(0.15, 0.12, PAL.ink, { y: 0.37, ry: Math.PI / 4 }, 4);
        k.box(0.2, 0.04, 0.2, PAL.ink, { y: 0.07 });
      }));
    }
  } else {
    // the snapped middle: stringers hanging into the water, planks adrift, sawhorse barriers at both ends
    k.part('wreck', () => {
      for (const [z0, dir] of [[-STUB, 1], [STUB, -1]] as const) {
        const y0 = footDeck(o, z0) - 0.22;
        k.beam(-(w / 2 - 0.18), y0, z0, -(w / 2 - 0.3), o.water - 0.35, z0 + dir * 2.4, 0.16, 0x5a4434, 'solid', 0.2);
        k.beam(w / 2 - 0.18, y0, z0, w / 2 - 0.05, o.water - 0.45, z0 + dir * 1.9, 0.16, 0x5a4434, 'solid', 0.2);
      }
      k.box(w * 0.9, 0.08, 0.38, 0x8f7356, { y: o.water + 0.02, z: -1.2, ry: 0.5, rx: 0.06 });
      k.box(w * 0.8, 0.08, 0.36, 0x7d6448, { y: o.water + 0.02, z: 1.6, x: 0.4, ry: -0.9, rz: 0.08 });
    });
    for (const [z, y, s] of [[-L / 2 + 0.75, footDeck(o, -L / 2 + 0.75), 1], [L / 2 - 0.75, footDeck(o, L / 2 - 0.75), -1]] as const) {
      k.part('barrier', () => k.at({ y, z, rx: -s * 0.05 }, () => {
        for (const x of [-0.6, 0.6]) {
          k.beam(x - 0.14, 0, z * 0 - 0.18, x, 0.82, 0, 0.06, PAL.wood);
          k.beam(x - 0.14, 0, 0.18, x, 0.82, 0, 0.06, PAL.wood);
        }
        // the striped bar
        for (let i = 0; i < 5; i++) k.box(0.36, 0.14, 0.06, i % 2 ? PAL.white : PAL.red, { x: -0.72 + i * 0.36, y: 0.78 });
      }));
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The glasshouse (local: 7.6 × 4.8, door at +z)

export const GLASSHOUSE = Object.freeze({ w: 7.6, d: 4.8, wall: 0.55, eave: 2.1, ridge: 3.2 });
export function buildGlasshouse(k: Kit, restored: boolean, G: Ground = FLAT): void {
  const { w, d, wall, eave, ridge } = GLASSHOUSE;
  const y0 = Math.min(G(-w / 2, -d / 2), G(w / 2, -d / 2), G(-w / 2, d / 2), G(w / 2, d / 2));
  k.at({ y: y0 }, () => {
    // brick knee wall (gaps in the old one)
    k.part('kneeWall', () => k.surf(['brick', { axis: 'h', scale: 0.7 }], () => {
      for (const [x, z, ww, dd] of [[0, -d / 2, w, 0.24], [-w / 2, 0, 0.24, d], [w / 2, 0, 0.24, d], [-w / 4 - 0.55, d / 2, w / 2 - 1.1, 0.24], [w / 4 + 0.55, d / 2, w / 2 - 1.1, 0.24]] as const) {
        if (!restored && x === w / 2) {
          k.box(ww, wall, dd * 0.45, 0xa25a46, { x, y: wall / 2 - 0.05, z: -d * 0.28 });
          rubble(k, x + 0.45, 0, d * 0.15, 0.9);
          continue;
        }
        k.box(ww, wall, dd, 0xb0604a, { x, y: wall / 2, z });
      }
    }));
    const frame = restored ? PAINT_WHITE : 0x9a9488;
    const posts: number[] = [];
    for (let i = 0; i <= 6; i++) posts.push(-w / 2 + (i / 6) * w);
    // the frame: posts on the knee wall, eave beams, rafters to the ridge
    k.part('frame', () => {
      posts.forEach((x, i) => {
        for (const z of [-d / 2, d / 2]) {
          if (!restored && (i === 2 && z > 0 || i === 5)) continue;   // a few missing in the old frame
          k.box(0.1, eave - wall, 0.1, frame, { x, y: wall + (eave - wall) / 2, z, rz: !restored && i === 4 ? 0.08 : 0 });
          if (restored || i % 2 === 0) k.beam(x, eave, z, x, ridge, 0, 0.08, frame);
        }
      });
      for (const z of [-d / 2, d / 2]) k.box(w + 0.1, 0.1, 0.1, frame, { y: eave, z });
      if (restored) k.box(w + 0.2, 0.12, 0.14, frame, { y: ridge + 0.02 });
      else k.beam(-w / 2, ridge, 0, w / 2 - 1.4, ridge - 0.35, 0, 0.12, frame);
      // gable ends
      for (const x of [-w / 2, w / 2]) {
        if (!restored && x > 0) continue;
        k.box(0.1, ridge - wall, 0.1, frame, { x, y: wall + (ridge - wall) / 2 });
      }
    });
    // glass: walls, roof slopes, gable triangles (no light of their own: two lamps inside light it at night). The
    // ruin's few loose panes are plain solid glass: dark at night, nothing lit behind them
    const pane = (gw: number, gh: number, t: Parameters<Kit['box']>[4]) => k.box(gw, gh, 0.04, GLASS, t, restored ? 'glow' : 'solid');
    k.emit(false, () => k.part('glass', () => {
      const pw = w / 6 - 0.12, ph = eave - wall - 0.1, slope = Math.hypot(d / 2, ridge - eave), ang = Math.atan2(ridge - eave, d / 2);
      posts.slice(0, 6).forEach((x, i) => {
        const cx = x + w / 12;
        for (const z of [-d / 2, d / 2]) {
          if (z > 0 && (i === 2 || i === 3)) continue;   // the doorway
          if (!restored && (i + (z > 0 ? 1 : 0)) % 3 !== 0) continue;
          pane(pw, ph, { x: cx, y: wall + ph / 2 + 0.05, z });
          if (!restored) continue;
        }
        for (const sd of [-1, 1]) {
          if (!restored && (i + (sd > 0 ? 0 : 1)) % 4 !== 0) continue;
          pane(pw, slope - 0.12, { x: cx, y: (eave + ridge) / 2, z: sd * d / 4, rx: -sd * (Math.PI / 2 - ang) });
        }
      });
      for (const x of [-w / 2, w / 2]) {
        if (!restored) continue;
        for (const sd of [-1, 1]) k.box(0.04, ph, d / 2 - 0.12, GLASS, { x, y: wall + ph / 2 + 0.05, z: sd * d / 4 }, 'glow');
        k.prism([[-d / 2 + 0.06, 0], [d / 2 - 0.06, 0], [0, ridge - eave - 0.06]], 0.04, GLASS, { x, y: eave + 0.02, ry: Math.PI / 2 }, 'glow');
      }
    }));
    if (restored) {
      // the door (open), benches of seedlings and pots, a watering can and a tub of violets by the door
      k.part('door', () => {
        k.box(0.08, eave - 0.06, 0.06, PAINT_WHITE, { x: -0.95, y: (eave - 0.06) / 2, z: d / 2 });
        k.box(0.08, eave - 0.06, 0.06, PAINT_WHITE, { x: 0.95, y: (eave - 0.06) / 2, z: d / 2 });
        k.box(1.95, 0.1, 0.08, PAINT_WHITE, { y: eave - 0.06, z: d / 2 });
        // (swung out onto the step, clear of the benches inside)
        k.at({ x: 0.95, z: d / 2 + 0.06, ry: 1.35 }, () => k.box(0.92, eave - 0.16, 0.05, PAINT_GREEN, { x: -0.46, y: (eave - 0.16) / 2 + 0.04 }));
      });
      k.part('benches', () => {
        for (const sd of [-1, 1]) {
          k.box(w - 1.0, 0.08, 0.7, PAL.plank, { y: 0.8, z: sd * (d / 2 - 0.62) });
          for (const x of [-(w / 2 - 0.7), 0, w / 2 - 0.7]) k.box(0.08, 0.8, 0.6, PAL.woodDark, { x, y: 0.4, z: sd * (d / 2 - 0.62) });
          for (let i = 0; i < 7; i++) {
            const x = -w / 2 + 0.9 + i * 0.95;
            k.cyl(0.13, 0.2, PAL.orange, { x, y: 0.94, z: sd * (d / 2 - 0.62) }, 6, 0.16);
            k.blob(0.2, i % 3 === 0 ? PAL.leafSpring : PAL.leaf, { x, y: 1.16, z: sd * (d / 2 - 0.62), s: [1, 0.8, 1] });
            if (i % 2 === 0) k.ball(0.07, [PAL.pink, PAL.purple, PAL.yellow][i % 3], { x: x + 0.06, y: 1.32, z: sd * (d / 2 - 0.62) });
          }
        }
      });
      k.part('violets', () => k.at({ x: 1.6, z: d / 2 + 0.55 }, () => {
        k.cyl(0.3, 0.32, PAL.plank, { y: 0.16 }, 8, 0.34);
        for (let i = 0; i < 7; i++) {
          const a = i * 0.9;
          k.blob(0.12, PAL.leafDark, { x: Math.cos(a) * 0.16, y: 0.36, z: Math.sin(a) * 0.16 });
          k.ball(0.065, PAL.purple, { x: Math.cos(a) * 0.17, y: 0.46, z: Math.sin(a) * 0.17 });
        }
      }));
      k.part('wateringCan', () => k.at({ x: -1.5, z: d / 2 + 0.5, ry: 0.6 }, () => {
        k.cyl(0.15, 0.3, PAL.metal, { y: 0.15 }, 8);
        k.beam(0.1, 0.18, 0, 0.36, 0.34, 0, 0.04, PAL.metal);
        k.beam(-0.12, 0.3, 0, 0.12, 0.3, 0, 0.03, PAL.metalDark);
      }));
    } else {
      // a heap of spare panes, weeds inside and out, a forgotten wheelbarrow
      k.part('paneHeap', () => {
        for (let i = 0; i < 5; i++) k.box(1.0, 0.04, 0.8, i % 2 ? 0xa8c4cc : 0x9ab6be, { x: -w / 2 - 1.0, y: 0.03 + i * 0.045, z: 1.1, ry: i * 0.12 });
      });
      for (const [x, z] of [[-2.2, -0.8], [0.4, 0.6], [2.4, -1.2], [-0.8, -1.6], [1.6, 1.4], [-3.0, 1.2]] as const) weeds(k, x, 0, z, 1.3);
      k.part('wheelbarrow', () => k.at({ x: w / 2 + 1.0, z: 1.6, ry: 2.2, rz: 0.04 }, () => {
        k.box(0.62, 0.26, 0.9, RUST_DARK, { y: 0.4 });
        k.cyl(0.2, 0.08, PAL.ink, { y: 0.2, z: 0.55, rz: Math.PI / 2 }, 8);
        for (const s of [-1, 1]) k.beam(s * 0.28, 0.32, 0.3, s * 0.32, 0.5, -0.85, 0.05, PAL.woodDark);
        for (const s of [-1, 1]) k.box(0.05, 0.3, 0.05, PAL.woodDark, { x: s * 0.26, y: 0.15, z: -0.3 });
      }));
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The river mill (local: house at the origin, +z toward the river; the wheel turns on an axle along z)

export const MILL = Object.freeze({ w: 4.6, d: 4.0, stone: 1.7, eave: 3.4, ridge: 4.7, wheelZ: 7.8, wheelR: 1.45, wheelW: 0.62 });
/** where the wheel's axle sits (local, relative to the house floor): y is set by the caller from the water level */
export function buildMillHouse(k: Kit, restored: boolean, wheelY: number, bedAt: (lz: number) => number): void {
  const { w, d, stone, eave, ridge } = MILL;
  // stone ground floor (broken along the top in the old one)
  k.part('millStone', () => k.surf(['fieldstone', { axis: 'h', scale: 0.75 }], () => {
    if (restored) {
      k.box(w, stone, d, 0xb0a898, { y: stone / 2 });
    } else {
      k.box(w, stone * 0.55, d, 0xa29a8a, { y: stone * 0.275 });
      for (let i = 0; i < 6; i++) {
        const t = i / 5, h = 0.25 + ((i * 5) % 4) * 0.18;
        k.box(w / 6, h, 0.36, 0xa29a8a, { x: -w / 2 + w / 12 + t * (w - w / 6), y: stone * 0.55 + h / 2, z: -d / 2 + 0.18 });
        if (i % 2) k.box(0.36, h * 0.8, d / 6, 0xa29a8a, { x: w / 2 - 0.18, y: stone * 0.55 + h * 0.4, z: -d / 2 + d / 12 + t * (d - d / 6) });
      }
    }
  }));
  if (restored) {
    // timber upper storey, plaster panels, a shingled roof, windows and a door on the land side
    k.part('millUpper', () => {
      k.surf(['plaster', { axis: 'h' }], () => k.box(w - 0.1, eave - stone, d - 0.1, PAL.wallCream, { y: stone + (eave - stone) / 2 }));
      for (const x of [-w / 2 + 0.06, 0, w / 2 - 0.06]) for (const z of [-d / 2 + 0.02, d / 2 - 0.02]) k.box(0.14, eave - stone, 0.08, PAL.woodDark, { x, y: stone + (eave - stone) / 2, z });
      for (const z of [-d / 2 + 0.02, d / 2 - 0.02]) k.box(w + 0.02, 0.12, 0.1, PAL.woodDark, { y: stone + 0.06, z });
      // gable ends
      for (const x of [-w / 2 + 0.05, w / 2 - 0.05]) k.prism([[-d / 2 + 0.05, 0], [d / 2 - 0.05, 0], [0, ridge - eave]], 0.1, PAL.wallCream, { x, y: eave, ry: Math.PI / 2 });
      const ang = Math.atan2(ridge - eave, d / 2), len = Math.hypot(d / 2, ridge - eave) + 0.45;
      for (const sd of [-1, 1]) k.slab(w + 0.5, 0.12, len, PAL.roofBrown, ['shingle', { axis: 'z' }], { y: (eave + ridge) / 2 + 0.08, z: sd * (d / 4 + 0.08), rx: ang, ry: sd > 0 ? 0 : Math.PI });
      k.box(0.5, 1.3, 0.5, PAL.stone, { x: -w / 2 + 0.7, y: ridge + 0.1, z: -0.6 });
      // windows (the river side and the land side) and the door
      for (const [x, z, yy] of [[-1.1, d / 2 + 0.01, stone + 0.95], [1.1, d / 2 + 0.01, stone + 0.95], [1.2, -d / 2 - 0.01, stone + 0.95]] as const) {
        k.box(0.62, 0.62, 0.04, PAL.windowGlow, { x, y: yy, z }, 'glow');
        k.box(0.72, 0.08, 0.08, PAL.woodDark, { x, y: yy - 0.36, z: z + Math.sign(z) * 0.03 });
      }
      k.box(0.95, 1.55, 0.08, PAL.woodDark, { x: -0.8, y: 0.78, z: -d / 2 - 0.03 });
      k.box(0.12, 0.12, 0.04, BRASS, { x: -0.48, y: 0.8, z: -d / 2 - 0.08 });
      k.box(1.3, 0.12, 0.3, PAL.stone, { x: -0.8, y: 0.06, z: -d / 2 - 0.2 });
      // a sack or two by the door
      for (const [x, s] of [[0.5, 1], [0.85, 0.85]] as const) k.blob(0.3 * s, PAL.cloth, { x, y: 0.26 * s, z: -d / 2 - 0.45, s: [1, 1.15, 0.85] });
    });
  } else {
    // roofless: a few charred rafters, rubble, weeds
    k.part('millRuin', () => {
      for (const x of [-1.4, 0.3]) k.beam(x, stone * 0.55, -d / 2 + 0.2, x + 0.4, stone + 1.4, 0.2, 0.14, 0x4a3a2c);
      rubble(k, 1.5, 0, -d / 2 - 0.6, 1.3);
      rubble(k, -w / 2 - 0.5, 0, 0.6, 1.1);
      for (const [x, z] of [[-1.0, 0.4], [0.9, -0.6], [1.6, 1.2], [-1.8, -d / 2 - 0.4]] as const) weeds(k, x, x > 1.5 ? 0 : stone * 0.55 * (Math.abs(x) < w / 2 - 0.3 && Math.abs(z) < d / 2 - 0.3 ? 1 : 0), z, 1.2);
    });
  }
  // the shaft from the house wall to the wheel, a trestle on the bank and a post in the stream beyond the wheel
  k.part('millShaft', () => {
    const z0 = d / 2, z1 = MILL.wheelZ + MILL.wheelW / 2 + 0.25;
    k.cyl(0.11, z1 - z0, restored ? PAL.woodDark : 0x4a3a2c, { y: wheelY, z: (z0 + z1) / 2, rx: Math.PI / 2 }, 8);
    for (const z of [5.4, MILL.wheelZ + MILL.wheelW / 2 + 0.3]) {
      const bed = bedAt(z) - 0.2;
      k.box(0.26, wheelY - bed + 0.1, 0.26, restored ? PAL.woodDark : 0x4a3a2c, { y: (wheelY + bed) / 2 - 0.1, z });
      k.box(0.4, 0.12, 0.34, PAL.ink, { y: wheelY - 0.12, z });
    }
  });
  if (restored) {
    // the bench by the millrace (faces the wheel)
    k.part('millBench', () => k.at(MILL_BENCH, () => bench(k)));
  }
}
/** the bench beside the mill (local; front +z looks at the wheel) */
export const MILL_BENCH = Object.freeze({ x: 3.2, y: 0, z: 2.5, ry: -0.6 });

/** a plain garden bench, seat at 0.45 m, front +z */
export function bench(k: Kit, color: number = PAL.wood): void {
  k.box(1.5, 0.07, 0.42, color, { y: 0.45 });
  k.box(1.5, 0.32, 0.06, color, { y: 0.72, z: -0.22, rx: -0.12 });
  for (const s of [-1, 1]) {
    k.box(0.08, 0.45, 0.36, PAL.woodDark, { x: s * 0.65, y: 0.225 });
    k.box(0.08, 0.38, 0.06, PAL.woodDark, { x: s * 0.65, y: 0.62, z: -0.21 });
  }
}

/** The water wheel (built about its axle: local z is the axle). Broken: most paddles gone, two spokes snapped, a boot stuck in it. */
export function buildWheel(k: Kit, restored: boolean): void {
  const R = MILL.wheelR, W = MILL.wheelW, N = 12;
  const wood = restored ? PAL.wood : 0x5e4a38, dark = restored ? PAL.woodDark : 0x4a3a2c;
  k.part('wheel', () => {
    k.cyl(0.22, W + 0.1, dark, { rx: Math.PI / 2 }, 8);
    for (const sz of [-W / 2, W / 2]) {
      // rims
      for (let i = 0; i < 16; i++) {
        const a0 = (i / 16) * TAU, a1 = ((i + 1) / 16) * TAU;
        if (!restored && (i === 5 || i === 11)) continue;
        k.beam(Math.cos(a0) * R, Math.sin(a0) * R, sz, Math.cos(a1) * R, Math.sin(a1) * R, sz, 0.1, dark, 'solid', 0.08);
      }
      // spokes
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + 0.26;
        const r = !restored && (i === 1 || i === 4) ? R * 0.5 : R;
        k.beam(0, 0, sz, Math.cos(a) * r, Math.sin(a) * r, sz, 0.08, wood, 'solid', 0.06);
      }
    }
    // paddles
    for (let i = 0; i < N; i++) {
      if (!restored && i % 3 !== 0 && i !== 7) continue;
      const a = (i / N) * TAU;
      k.box(0.42, 0.06, W + 0.06, wood, { x: Math.cos(a) * (R - 0.1), y: Math.sin(a) * (R - 0.1), rz: a + Math.PI / 2 });
    }
    if (!restored) {
      // the soggy old boot that jammed it
      k.part('boot', () => k.at({ x: Math.cos(-1.2) * (R - 0.25), y: Math.sin(-1.2) * (R - 0.25), rz: 0.4 }, () => {
        k.box(0.16, 0.3, 0.14, 0x6e4a2a, { y: 0.1 });
        k.box(0.3, 0.12, 0.15, 0x6e4a2a, { x: 0.08, y: -0.05 });
        k.box(0.32, 0.04, 0.16, 0x3b2a1e, { x: 0.08, y: -0.12 });
      }));
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The observatory (local: a round stone tower at the origin, door at +z)

export const OBSERVATORY = Object.freeze({ r: 2.5, h: 3.3, dome: 2.75 });
/** the visitors' telescope on the terrace in front (local; its stool faces −z, toward the north sky) */
export const SCOPE = Object.freeze({ x: 1.9, z: 3.0 });
export function buildObservatory(k: Kit, restored: boolean): void {
  const { r, h, dome } = OBSERVATORY;
  k.part('tower', () => {
    k.surf(['fieldstone', { axis: 'h', scale: 0.8 }], () => k.cyl(r, h, 0xbab2a2, { y: h / 2 }, 14, r - 0.08));
    k.surf(['fieldstone', { axis: 'h', scale: 0.6 }], () => k.cyl(r + 0.18, 0.3, 0xa29a8a, { y: h + 0.05 }, 14));
    // the door
    k.box(1.05, 1.9, 0.12, restored ? PAINT_GREEN : 0x5a4434, { y: 0.95, z: r - 0.02 });
    k.box(1.25, 0.14, 0.18, PAL.stone, { y: 1.95, z: r - 0.01 });
    if (!restored) {
      // boarded up
      k.box(1.3, 0.14, 0.05, PAL.plank, { y: 1.2, z: r + 0.08, rz: 0.55 });
      k.box(1.3, 0.14, 0.05, 0x8f7356, { y: 0.8, z: r + 0.09, rz: -0.5 });
    }
    // a narrow window either side
    for (const a of [0.9, -0.9]) {
      const x = Math.sin(a) * (r - 0.02), z = Math.cos(a) * (r - 0.02);
      if (restored) k.box(0.42, 0.8, 0.05, PAL.windowGlow, { x, y: 2.2, z, ry: a }, 'glow');
      else k.box(0.42, 0.8, 0.05, 0x3a3640, { x, y: 2.2, z, ry: a });
    }
  });
  // the dome: white with a slit open to the sky and the big telescope peering out, or rusted shut
  k.part('dome', () => {
    const g = new THREE.SphereGeometry(dome, 14, 6, 0, TAU, 0, Math.PI / 2);
    k.add(g, restored ? 0xe8e6e0 : PAL.rust, { y: h + 0.18 });
    if (restored) {
      // the slit: a dark band over the top toward the north (−z), the shutters rolled back beside it
      k.at({ y: h + 0.18, rx: -0.55 }, () => {
        k.box(0.74, 0.06, dome * 0.98, 0x2a2c3a, { y: dome - 0.04, z: -dome * 0.18, rx: 0.05 });
        for (const s of [-1, 1]) k.box(0.1, 0.1, dome * 0.98, 0xc8c4bc, { x: s * 0.42, y: dome - 0.02, z: -dome * 0.18 });
      });
      // the big telescope
      k.cyl(0.24, 2.4, 0xd8d4c8, { y: h + dome - 0.1, z: -1.0, rx: -0.9 }, 10, 0.2);
      k.cyl(0.27, 0.3, BRASS, { y: h + dome + 0.65, z: -1.95, rx: -0.9 }, 10);
      // the weather vane (Nimbus)
      k.rod(0, h + dome + 0.1, 0.7, 0, h + dome + 0.9, 0.7, 0.03, PAL.ink, 4);
      k.box(0.5, 0.18, 0.03, BRASS, { y: h + dome + 0.82, z: 0.7, ry: 0.6 });
    } else {
      // rust streaks and a missing panel, ivy up the tower
      for (let i = 0; i < 6; i++) {
        const a = i * 1.1;
        k.box(0.3, 0.9, 0.06, RUST_DARK, { x: Math.sin(a) * (dome - 0.1) * 0.82, y: h + 0.7, z: Math.cos(a) * (dome - 0.1) * 0.82, ry: a, rx: -0.5 });
      }
      for (let i = 0; i < 9; i++) {
        const a = 2.4 + i * 0.12, y = 0.3 + i * 0.32;
        k.blob(0.24 + (i % 3) * 0.06, IVY, { x: Math.sin(a) * (r + 0.02), y, z: Math.cos(a) * (r + 0.02), s: [1, 1.3, 0.6], ry: a });
      }
      weeds(k, r * 0.6, 0, r + 0.6, 1.2);
      weeds(k, -r - 0.4, 0, 0.6, 1.1);
      rubble(k, -1.6, 0, r + 0.9, 1);
    }
  });
  // the visitors' telescope on the terrace (only once it's open: a brass scope on a tripod and a stool)
  if (restored) {
    k.part('visitorScope', () => k.at({ x: SCOPE.x, z: SCOPE.z }, () => {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU + 0.4;
        k.beam(Math.cos(a) * 0.38, 0, Math.sin(a) * 0.38, 0, 1.1, 0, 0.05, PAL.woodDark);
      }
      k.cyl(0.09, 1.1, BRASS, { y: 1.3, z: -0.15, rx: -0.75 }, 8, 0.07);
      k.cyl(0.11, 0.16, PAL.ink, { y: 1.62, z: -0.48, rx: -0.75 }, 8);
      // stool behind it
      k.cyl(0.22, 0.06, PAL.wood, { y: 0.5, z: 0.75 }, 8);
      for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU; k.beam(Math.cos(a) * 0.16, 0, 0.75 + Math.sin(a) * 0.16, Math.cos(a) * 0.08, 0.48, 0.75 + Math.sin(a) * 0.08, 0.04, PAL.woodDark); }
    }));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The train halt (local: platform along x, the line behind it at −z, the waiting side +z)

export const HALT = Object.freeze({ len: 13, plat: 2.8, platY: 0.62, trackZ: -2.3, trackLen: 18.4 });
/** the bell post and the bench under the shelter (local) */
export const HALT_BELL = Object.freeze({ x: -4.6, z: 1.2 });
export const HALT_BENCH = Object.freeze({ x: 1.6, y: HALT.platY, z: 1.15, ry: Math.PI });
export function buildHalt(k: Kit, restored: boolean): void {
  const { len, plat, platY, trackZ, trackLen } = HALT;
  const pz = plat / 2 - 0.25;   // platform centre z
  // the line: ballast, sleepers, two rails, a buffer stop at each end
  k.part('track', () => {
    k.surf(['rock', { axis: 'y', scale: 0.5 }], () => k.box(trackLen, 0.12, 2.0, restored ? 0x9a948a : 0x8a8478, { y: 0.04, z: trackZ }));
    for (let i = 0; i < 26; i++) {
      const x = -trackLen / 2 + 0.35 + i * ((trackLen - 0.7) / 25);
      k.box(0.24, 0.1, 1.7, restored ? PAL.woodDark : 0x5a4a3a, { x, y: 0.14, z: trackZ, ry: restored ? 0 : ((i * 13) % 5 - 2) * 0.03 });
    }
    for (const s of [-1, 1]) k.box(trackLen - 0.2, 0.1, 0.08, restored ? PAL.metalDark : PAL.rust, { y: 0.24, z: trackZ + s * 0.55 });
    for (const x of [-trackLen / 2 + 0.2, trackLen / 2 - 0.2]) {
      k.box(0.3, 0.6, 1.6, restored ? PAL.red : RUST_DARK, { x, y: 0.5, z: trackZ });
      k.box(0.5, 0.3, 1.2, PAL.woodDark, { x: x - Math.sign(x) * 0.3, y: 0.35, z: trackZ });
    }
    if (!restored) for (let i = 0; i < 7; i++) weeds(k, -trackLen / 2 + 1.5 + i * 2.6, 0.12, trackZ + ((i % 3) - 1) * 0.5, 1.3);
  });
  // the platform: a stone face along the line, planks on top (holes in the old one)
  k.part('platform', () => {
    k.surf(['fieldstone', { axis: 'h', scale: 0.7 }], () => k.box(len, platY, plat, 0xb0a898, { y: platY / 2, z: pz }));
    const N = 18;
    for (let i = 0; i < N; i++) {
      if (!restored && (i === 4 || i === 5 || i === 11 || i === 15)) continue;
      const x = -len / 2 + (i + 0.5) * (len / N);
      k.surf(['planks', { axis: 'z', scale: 0.9 }], () => k.box(len / N - 0.03, 0.06, plat - 0.1, restored ? (i % 2 ? PAL.plank : PAL.woodLight) : (i % 2 ? 0x8f7356 : 0x7d6448), { x, y: platY + 0.03, z: pz }));
    }
    // a white safety edge and steps down at the east end
    if (restored) k.box(len, 0.02, 0.18, PAINT_WHITE, { y: platY + 0.07, z: pz - plat / 2 + 0.14 });
    for (let i = 0; i < 3; i++) k.box(0.42, platY * (3 - i) / 3, plat - 0.4, PAL.stone, { x: len / 2 + 0.21 + i * 0.42, y: platY * (3 - i) / 6, z: pz });
  });
  k.at({ y: platY + 0.06 }, () => {
    // the shelter: four posts, a pitched roof (fallen in on the old one), a bench under it
    k.part('shelter', () => {
      for (const x of [-0.6, 3.8]) for (const z of [pz - 0.95, pz + 0.95]) {
        if (!restored && x > 3 && z > pz) continue;
        k.box(0.14, 2.3, 0.14, restored ? PAINT_GREEN : 0x5a5a4a, { x, y: 1.15, z });
      }
      if (restored) {
        for (const sd of [-1, 1]) k.slab(5.2, 0.1, 1.45, PAL.roofRed, ['shingle', { axis: 'z' }], { x: 1.6, y: 2.55, z: pz + sd * 0.62, rx: 0.38, ry: sd > 0 ? 0 : Math.PI });
        k.box(5.3, 0.1, 0.12, PAINT_GREEN, { x: 1.6, y: 2.82, z: pz });
        k.at(HALT_BENCH, () => k.at({ y: -platY }, () => bench(k, PAINT_GREEN)));
      } else {
        k.slab(5.2, 0.1, 2.3, 0x7a5a48, ['shingle', { axis: 'z' }], { x: 2.0, y: 1.25, z: pz, rx: 0.12, rz: 0.42 });
        // a broken bench
        k.box(1.4, 0.07, 0.4, 0x7d6448, { x: 1.4, y: 0.22, z: pz + 0.5, rz: 0.3 });
      }
    });
    // the name board on two posts
    k.part('nameBoard', () => {
      for (const x of [-3.2, -1.4]) k.box(0.1, restored ? 2.1 : 0.7, 0.1, PAL.woodDark, { x, y: restored ? 1.05 : 0.35, z: pz + 1.05 });
      if (restored) k.box(2.2, 0.5, 0.08, PAINT_CREAM, { x: -2.3, y: 1.95, z: pz + 1.05 });
      else k.box(2.2, 0.5, 0.08, 0xb8ac94, { x: -2.3, y: 0.08, z: pz + 1.6, rx: -Math.PI / 2 + 0.06, ry: 0.25 });
    });
    // the lamp post and the bell
    k.part('haltLamp', () => k.at({ x: 5.4, z: pz + 0.9 }, () => lanternPost(k, restored, restored ? 0 : 0.35, 1.2, 2.0)));
    k.part('bell', () => k.at({ x: HALT_BELL.x, z: HALT_BELL.z }, () => {
      k.box(0.12, 2.1, 0.12, restored ? PAINT_GREEN : 0x5a5a4a, { y: 1.05 });
      k.box(0.6, 0.08, 0.08, restored ? PAINT_GREEN : 0x5a5a4a, { x: 0.22, y: 2.05 });
      if (restored) {
        k.cone(0.2, 0.3, BRASS, { x: 0.42, y: 1.8 }, 10);
        k.ball(0.05, BRASS, { x: 0.42, y: 1.64 });
        k.rod(0.42, 1.62, 0, 0.42, 1.0, 0.05, 0.012, 0xd8c08a, 3);
      }
    }));
    if (restored) {
      // tubs of flowers along the platform
      for (const x of [-5.6, -0.2, 4.6]) k.part('flowerTub', () => k.at({ x, z: pz + 0.95 }, () => {
        k.cyl(0.28, 0.36, PAL.plank, { y: 0.18 }, 8, 0.3);
        for (let i = 0; i < 6; i++) { const a = i * 1.05; k.ball(0.09, [PAL.red, PAL.yellow, PAL.pink][i % 3], { x: Math.cos(a) * 0.15, y: 0.44, z: Math.sin(a) * 0.15 }); }
        k.blob(0.2, PAL.leaf, { y: 0.36, s: [1, 0.6, 1] });
      }));
    } else {
      for (const [x, z] of [[-5.2, pz + 0.3], [-1.0, pz - 0.4], [3.0, pz + 0.6], [5.6, pz - 0.2]] as const) weeds(k, x, 0, z, 1.4);
    }
  });
}

/** The halt's name board face (restored only): a cream enamel sign. */
export function drawHaltSign(g: CanvasRenderingContext2D, W: number, H: number): void {
  g.fillStyle = '#f1e3c4'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#3f6a4a'; g.lineWidth = H * 0.1; g.strokeRect(H * 0.08, H * 0.08, W - H * 0.16, H - H * 0.16);
  g.fillStyle = '#2f4a36'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `bold ${Math.round(H * 0.42)}px "Trebuchet MS", system-ui, sans-serif`;
  g.fillText('CLAUDE VALLEY', W / 2, H * 0.53, W * 0.86);
}
