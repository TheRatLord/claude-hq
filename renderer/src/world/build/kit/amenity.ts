/**
 * Prop kit: amenity-bay props (§7.2 W1 Music Room, W2 Gym, W3 Greenhouse, E1 Game Room, E3 Nap Lounge) and the bay
 * wall dressing that makes them read from the street (acoustic panels, wall mirror, pegboard, trellis, dartboard,
 * scoreboard). Same contract as every kit builder (§7.5): bevelled, ≤ 3 palette tokens (+ literal multi-token groups
 * the table allows: keys, sleeves, weights, veg), one hero detail, ≤ 1.5k tris (signature ≤ 6k).
 * Signature props: `piano` (W1), `treadmill` (W2), `sunLamp` (W3), `moonLamp` (E3). Owner: ENV.
 */
import * as THREE from 'three';
import { rbox, cyl, lathe, sphere, capsule, torus, tube, slab, disc, at, part, vary, between } from './core.ts';
import type { Grad, KitParams, Part, PartOpts, Rng, SheetEntry, SlotName } from './core.ts';
import { T, SPINES } from './tokens.ts';

const PI = Math.PI;
/** Cool lacquer for the Music Room piano (tealDeep family, L* ≈ 34): hue-far from clay, keys pop against it. */
const PIANO = '#2F5553';
/** Gym rubber (a warm-free graphite, L* ≈ 30). */
const RUBBER = '#45434A';
const G = (y0: number, y1: number, lo: string = T.leafDark, hi: string = T.leafLight): Grad => [lo, hi, y0, y1];

/**
 * W1 signature · upright piano with its bench (the amenity `sit` slot is the bench, 0.57 m in front). Front = +z.
 * Hero: open fallboard over cream / ink keys, a sheet-music desk, brass candle sconces and pedals.
 */
export function buildPiano(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 1.4, h = p.h ?? 1.0, d = p.d ?? 0.5;
  const parts: Part[] = [];
  const cz = -d / 2 + 0.16; // cabinet depth centre (the tall back case)
  parts.push(part(at(rbox(w, h, 0.32, 0.03, 2), 0, h / 2, cz), 'body', { mat: 'wood' }));
  parts.push(part(at(rbox(w + 0.05, 0.04, 0.37, 0.015), 0, h + 0.02, cz + 0.01), 'body', { mat: 'wood' })); // lid
  parts.push(part(at(rbox(w - 0.2, h * 0.34, 0.02, 0.008), 0, h * 0.74, cz + 0.165), 'body', { mat: 'wood', ao: 0.8 })); // upper panel
  parts.push(part(at(rbox(w - 0.3, 0.012, 0.006), 0, h * 0.74, cz + 0.178), 'accent', { cast: false })); // brass inlay line
  const ky = 0.5; // key height (toy scale: a seated Clawd's hands)
  parts.push(part(at(rbox(w - 0.02, 0.08, 0.26, 0.02), 0, ky - 0.04, cz + 0.27), 'body', { mat: 'wood' })); // keybed
  parts.push(part(at(rbox(w - 0.22, 0.022, 0.13, 0.004), 0, ky + 0.011, cz + 0.33), 'secondary', { cast: false })); // white keys
  const nW = 22, kw = (w - 0.22) / nW;
  for (let i = 1; i < nW; i++) parts.push(part(at(rbox(0.004, 0.024, 0.13), -(w - 0.22) / 2 + i * kw, ky + 0.012, cz + 0.33), 'accent', { color: '#C9BFAE', cast: false })); // key gaps
  for (let i = 0; i < nW - 1; i++) {
    if (i % 7 === 2 || i % 7 === 6) continue; // C# D# · F# G# A# groups
    parts.push(part(at(rbox(kw * 0.55, 0.02, 0.075, 0.003), -(w - 0.22) / 2 + (i + 1) * kw, ky + 0.03, cz + 0.3), 'accent', { color: T.ink, cast: false, mat: 'small' }));
  }
  for (const e of [-1, 1]) {
    parts.push(part(at(rbox(0.07, 0.14, 0.3, 0.02), e * (w / 2 - 0.045), ky + 0.02, cz + 0.28), 'body', { mat: 'wood' })); // cheek blocks
    parts.push(part(at(cyl(0.03, 0.025, ky - 0.08, 10), e * (w / 2 - 0.06), (ky - 0.08) / 2, cz + 0.36), 'body', { mat: 'wood' })); // front legs
    parts.push(part(at(rbox(0.08, 0.04, 0.12, 0.012), e * (w / 2 - 0.06), 0.02, cz + 0.36), 'accent')); // brass toe caps
    parts.push(part(at(cyl(0.012, 0.012, 0.08, 8), e * 0.42, 0.78, cz + 0.2), 'accent')); // sconce arm
    parts.push(part(at(lathe([[0, 0], [0.03, 0], [0.028, 0.02], [0.012, 0.03], [0, 0.03]], 10), e * 0.42, 0.82, cz + 0.22), 'accent')); // sconce cup
    parts.push(part(at(cyl(0.012, 0.012, 0.07, 8), e * 0.42, 0.88, cz + 0.22), 'secondary')); // candle
  }
  // music desk: a tilted board with open sheet music
  parts.push(part(at(rbox(0.62, 0.2, 0.02, 0.006), 0, ky + 0.2, cz + 0.2, -0.22), 'body', { mat: 'wood' }));
  for (const e of [-1, 1]) {
    parts.push(part(at(rbox(0.19, 0.25, 0.004, 0.001), e * 0.1, ky + 0.25, cz + 0.225, -0.22, e * 0.08, 0), 'secondary', { cast: false }));
    for (let l = 0; l < 4; l++) parts.push(part(at(rbox(0.15, 0.006, 0.002), e * 0.1, ky + 0.19 + l * 0.04, cz + 0.232 - l * 0.009, -0.22, e * 0.08, 0), 'accent', { color: T.ink2, cast: false, mat: 'small' }));
  }
  for (let i = -1; i <= 1; i++) parts.push(part(at(rbox(0.035, 0.015, 0.07, 0.005), i * 0.07, 0.05, cz + 0.2), 'accent'));
  // bench (seat 0.3 m, the Clawd sit slot), cream cushion, four tapered legs
  const bz = cz + 0.72, bh = 0.3;
  parts.push(part(at(rbox(0.64, 0.05, 0.3, 0.02, 2), 0, bh - 0.05, bz), 'body', { mat: 'wood' }));
  parts.push(part(at(rbox(0.6, 0.045, 0.27, 0.02, 2), 0, bh + 0.0, bz), 'secondary', { mat: 'fabric' }));
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(part(at(cyl(0.02, 0.013, bh - 0.06, 8), sx * 0.27, (bh - 0.06) / 2, bz + sz * 0.11), 'body', { mat: 'wood' }));
  if (v.chance(0.7)) parts.push(part(at(rbox(0.2, 0.012, 0.26, 0.003), 0.14, bh + 0.03, bz, 0, 0.3, 0), 'secondary', { cast: false })); // a score left on the bench
  return { parts, footprint: { w, d }, solid: true, anchors: { seat: [0, bh, cz + 0.72] }, colors: { body: p.colors?.body ?? PIANO, secondary: T.trim, accent: T.brass }, hero: 'open keys + sheet music, brass sconces' };
}

/** Acoustic guitar on an A-frame stand (W1). Front = +z; leans back 12°. */
export function buildGuitar(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), lean = -0.2;
  const parts: Part[] = [];
  const body = (r: number, y: number) => at(cyl(r, r, 0.075, 22), 0, y, 0, PI / 2, 0, 0);
  const add = (geo: THREE.BufferGeometry, slot: SlotName, o?: PartOpts) => { at(geo, 0, 0, 0, lean, 0, 0); parts.push(part(geo, slot, o)); };
  add(at(body(0.15, 0.32), 0, 0, 0.0), 'body', { mat: 'wood' });
  add(body(0.115, 0.53), 'body', { mat: 'wood' });
  add(at(cyl(0.046, 0.046, 0.004, 16), 0, 0.46, 0.04, PI / 2, 0, 0), 'accent', { cast: false, color: T.ink }); // sound hole
  add(at(torus(0.055, 0.005, 3, 18), 0, 0.46, 0.039), 'accent', { cast: false, color: T.trim }); // rosette
  add(at(rbox(0.1, 0.02, 0.012, 0.004), 0, 0.26, 0.042), 'secondary', { cast: false }); // bridge
  add(at(rbox(0.05, 0.42, 0.03, 0.01), 0, 0.84, 0.01), 'secondary', { mat: 'wood' }); // neck
  add(at(rbox(0.075, 0.13, 0.025, 0.01), 0, 1.1, 0.0, -0.18, 0, 0), 'secondary', { mat: 'wood' }); // headstock
  for (const e of [-1, 1]) for (let k = 0; k < 3; k++) add(at(cyl(0.008, 0.008, 0.03, 6), e * 0.045, 1.07 + k * 0.035, 0.0, 0, 0, PI / 2), 'accent', { cast: false, color: T.brass, mat: 'small' });
  for (let s = 0; s < 4; s++) add(tube([[-0.018 + s * 0.012, 0.26, 0.046], [-0.012 + s * 0.008, 1.02, 0.03]], 0.0015, 1, 3), 'accent', { cast: false, color: T.trim, mat: 'small' });
  // stand: A-frame legs + a padded cradle
  for (const e of [-1, 1]) {
    parts.push(part(tube([[e * 0.16, 0, 0.14], [e * 0.1, 0.2, 0.06], [0, 0.62, -0.1]], 0.009, 3, 5), 'secondary', { color: T.ink2 }));
    parts.push(part(at(sphere(0.02, 8, 6), e * 0.16, 0.012, 0.14), 'accent', { color: T.ink2 }));
  }
  parts.push(part(tube([[-0.13, 0.15, 0.1], [0, 0.13, 0.12], [0.13, 0.15, 0.1]], 0.014, 4, 6), 'secondary', { color: T.ink2 }));
  void v;
  return { parts, footprint: { w: 0.35, d: 0.3 }, solid: false, anchors: {}, colors: { body: p.colors?.body ?? '#C79A6B', secondary: T.walnut, accent: T.brass }, hero: 'figure-eight body, sound hole rosette, stand' };
}

/** Record player (W1): mid-century walnut console, turntable + tonearm, speaker grilles, a crate of sleeves. */
export function buildRecordPlayer(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 0.6, d = p.d ?? 0.4, h = 0.52;
  const parts = [part(at(rbox(w, h - 0.14, d, 0.025, 2), 0, 0.14 + (h - 0.14) / 2, 0), 'body', { mat: 'wood' })];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(part(at(cyl(0.018, 0.01, 0.15, 8), sx * (w / 2 - 0.06), 0.075, sz * (d / 2 - 0.06), sz * 0.12, 0, -sx * 0.12), 'body', { mat: 'wood' }));
  for (const e of [-1, 1]) {
    parts.push(part(at(rbox(w * 0.4, h - 0.24, 0.012, 0.005), e * w * 0.24, 0.14 + (h - 0.14) / 2, d / 2 + 0.004), 'secondary', { mat: 'fabric', cast: false, color: T.oat }));
    parts.push(part(at(cyl(0.008, 0.008, 0.012, 8), e * 0.035, h - 0.06, d / 2 + 0.006, PI / 2), 'accent', { mat: 'small' })); // knobs
  }
  parts.push(part(at(disc(0.14, 0.02, 28, 0.004), -0.06, h, 0), 'secondary')); // platter
  parts.push(part(at(disc(0.13, 0.008, 28, 0.002), -0.06, h + 0.02, 0), 'secondary', { color: T.ink, cast: false })); // vinyl
  parts.push(part(at(disc(0.042, 0.003, 16, 0.001), -0.06, h + 0.028, 0), 'accent', { color: v.pick([T.rose, T.butter, T.teal]), cast: false })); // label
  parts.push(part(at(cyl(0.02, 0.02, 0.05, 10), 0.19, h + 0.025, -0.1), 'accent'));
  parts.push(part(tube([[0.19, h + 0.05, -0.1], [0.17, h + 0.05, 0.05], [0.06, h + 0.045, 0.1]], 0.005, 4, 4), 'accent', { cast: false }));
  // a crate of sleeves beside it (literal sleeve tokens, like book spines)
  const cx = w / 2 + 0.2;
  parts.push(part(at(rbox(0.3, 0.22, 0.3, 0.01), cx, 0.11, 0.02), 'body', { mat: 'wood', ao: 0.7 }));
  for (let i = 0; i < 9; i++) parts.push(part(at(rbox(0.28, 0.28, 0.008, 0.003), cx, 0.18 + v.r(0, 0.03), -0.1 + i * 0.028, v.r(-0.12, 0.05)), 'accent', { color: SPINES[(i * 3) % SPINES.length], cast: false }));
  return { parts, footprint: { w: w + 0.4, d }, collider: { w, d }, solid: true, anchors: {}, colors: { body: T.walnut, secondary: T.ink2, accent: T.brass }, hero: 'turntable + tonearm, crate of sleeves' };
}

/** Wall acoustic panel cluster (W1): rounded fabric hexes / slabs in 2 cool tones. Origin = wall face centre, +z out. */
export function buildAcousticPanels(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), n = p.n ?? 5, parts: Part[] = [];
  const hex = (r: number) => { const g = cyl(r, r, 0.05, 6); return at(g, 0, 0, 0.025, PI / 2, 0, PI / 6); };
  const cols = Array.isArray(p.cols) ? p.cols : [T.teal, T.tealDeep, T.lavender];
  for (let i = 0; i < n; i++) {
    const r = 0.17, x = (i - (n - 1) / 2) * r * 1.55, y = (i % 2 ? r * 0.9 : -r * 0.0);
    parts.push(part(at(hex(r), x, y, 0), 'body', { mat: 'fabric', color: cols[(i + v.int(2)) % cols.length] }));
    parts.push(part(at(cyl(r * 0.8, r * 0.8, 0.012, 6), x, y, 0.055, PI / 2, 0, PI / 6), 'secondary', { mat: 'fabric', cast: false, ao: 0.9 }));
  }
  return { parts, footprint: { w: n * 0.27, d: 0.06 }, solid: false, anchors: {}, colors: { body: T.teal, secondary: T.tealDeep, accent: T.trim }, hero: 'hex fabric tiles' };
}

/** Floor amp / speaker cabinet (W1): rounded tolex box, fabric grille, brass knobs, a coiled cable. */
export function buildAmp(p: KitParams = {}, rng: Rng) {
  const w = p.w ?? 0.42, h = p.h ?? 0.36, d = p.d ?? 0.24;
  const parts = [part(at(rbox(w, h, d, 0.03, 2), 0, h / 2, 0), 'body')];
  parts.push(part(at(rbox(w - 0.07, h - 0.13, 0.012, 0.01), 0, h / 2 - 0.03, d / 2), 'secondary', { mat: 'fabric', cast: false }));
  parts.push(part(at(rbox(w - 0.05, 0.05, 0.01, 0.005), 0, h - 0.045, d / 2), 'secondary', { cast: false, color: T.trim }));
  for (let i = 0; i < 4; i++) parts.push(part(at(cyl(0.012, 0.012, 0.015, 8), -0.12 + i * 0.07, h - 0.045, d / 2 + 0.008, PI / 2), 'accent', { mat: 'small' }));
  parts.push(part(at(torus(0.07, 0.008, 4, 16), w / 2 + 0.1, 0.008, 0.02, PI / 2), 'accent', { color: T.ink2, cast: false }));
  parts.push(part(at(rbox(0.14, 0.03, 0.03, 0.01), 0, h + 0.015, 0), 'accent', { color: T.ink2 })); // handle
  return { parts, footprint: { w, d }, solid: false, anchors: {}, colors: { body: '#3F4A4E', secondary: T.oat, accent: T.brass }, hero: 'grille, knobs, coiled cable' };
}

/**
 * W2 signature · treadmill: deck along local x (console at −x), teal belt with slats, twin uprights to a console
 * with a tiny screen and butter buttons, rear roller caps. The agent's `stand` slot is on the belt.
 */
export function buildTreadmill(p: KitParams = {}, rng: Rng) {
  const w = p.w ?? 1.5, d = (p.d ?? 0.7) * 0.8;
  const parts = [part(at(rbox(w, 0.1, d, 0.035, 2), 0, 0.06, 0), 'body')];
  parts.push(part(at(rbox(w - 0.3, 0.02, d - 0.14, 0.008), 0.07, 0.12, 0), 'secondary', { mat: 'fabric' })); // belt
  for (let i = 0; i < 12; i++) parts.push(part(at(rbox(0.006, 0.004, d - 0.16), -w / 2 + 0.3 + i * ((w - 0.34) / 12), 0.132, 0), 'accent', { color: '#3B5856', cast: false, mat: 'small' }));
  for (const e of [-1, 1]) parts.push(part(at(rbox(w - 0.22, 0.03, 0.06, 0.012), 0.05, 0.12, e * (d / 2 - 0.04)), 'body')); // side rails
  parts.push(part(at(rbox(0.28, 0.2, d + 0.02, 0.05, 2), -w / 2 + 0.14, 0.14, 0), 'body')); // motor hood
  parts.push(part(at(rbox(0.2, 0.03, d - 0.06, 0.012), -w / 2 + 0.14, 0.25, 0), 'accent', { cast: false })); // hood stripe
  for (const e of [-1, 1]) {
    parts.push(part(at(cyl(0.05, 0.05, 0.03, 16), w / 2 - 0.02, 0.07, e * (d / 2 + 0.005), PI / 2), 'secondary', { color: T.ink2 })); // roller caps
    parts.push(part(tube([[-w / 2 + 0.2, 0.2, e * (d / 2 - 0.02)], [-w / 2 + 0.12, 0.7, e * (d / 2 - 0.01)], [-w / 2 + 0.1, 0.98, e * (d / 2 - 0.02)]], 0.025, 6, 8), 'body'));
    parts.push(part(tube([[-w / 2 + 0.1, 0.9, e * (d / 2 - 0.02)], [-w / 2 + 0.34, 0.86, e * (d / 2 - 0.02)]], 0.018, 3, 6), 'secondary', { color: T.ink2 })); // handlebar
    parts.push(part(at(capsule(0.024, 0.12, 2, 8), -w / 2 + 0.3, 0.865, e * (d / 2 - 0.02), 0, 0, PI / 2 - 0.15), 'secondary', { mat: 'fabric', color: RUBBER }));
  }
  parts.push(part(at(rbox(0.2, 0.14, d - 0.04, 0.03, 2), -w / 2 + 0.12, 1.0, 0, 0, 0, 0.5), 'body')); // console
  parts.push(part(at(rbox(0.004, 0.07, 0.2, 0.002), -w / 2 + 0.2, 1.04, 0, 0, 0, 0.5), 'secondary', { color: T.screenOff, cast: false }));
  for (let i = 0; i < 3; i++) parts.push(part(at(cyl(0.013, 0.013, 0.01, 8), -w / 2 + 0.2, 0.975, -0.08 + i * 0.08, 0, 0, 0.5 + PI / 2), 'accent', { cast: false, mat: 'small' }));
  parts.push(part(at(lathe([[0, 0], [0.032, 0], [0.034, 0.14], [0.02, 0.17], [0.012, 0.19], [0, 0.19]], 12), -w / 2 + 0.2, 0.93, d / 2 - 0.1), 'accent', { color: T.teal })); // water bottle
  return { parts, footprint: { w, d: p.d ?? 0.7 }, solid: false, anchors: { belt: 0.13 }, colors: { body: '#5E5A60', secondary: '#2E4745', accent: T.butter }, hero: 'belt slats, twin uprights + console, bottle' };
}

/** Dumbbell rack (W2): two-tier A-frame in graphite, hex dumbbell pairs by weight colour, a kettlebell at its foot. */
export function buildDumbbells(p: KitParams = {}, rng: Rng) {
  const w = p.w ?? 1.0, d = p.d ?? 0.35, parts: Part[] = [];
  for (const e of [-1, 1]) {
    parts.push(part(tube([[e * (w / 2 - 0.05), 0, d / 2 - 0.03], [e * (w / 2 - 0.05), 0.55, 0]], 0.022, 2, 6), 'secondary'));
    parts.push(part(tube([[e * (w / 2 - 0.05), 0, -d / 2 + 0.03], [e * (w / 2 - 0.05), 0.55, 0]], 0.022, 2, 6), 'secondary'));
    parts.push(part(at(rbox(0.06, 0.02, d, 0.008), e * (w / 2 - 0.05), 0.01, 0), 'secondary'));
  }
  const tiers = [[0.28, 0.08, 0.12], [0.5, -0.05, 0.1]];
  const cols = [T.butter, T.teal, T.lavender, T.rose, T.sage];
  tiers.forEach(([y, z, r], ti) => {
    parts.push(part(at(rbox(w - 0.06, 0.03, 0.14, 0.01), 0, y - 0.04, z, -0.25), 'secondary'));
    const n = ti ? 4 : 3;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + 0.15 + i * ((w - 0.3) / Math.max(1, n - 1)), hr = r * (1 - i * 0.12) * (ti ? 0.7 : 1);
      for (const s of [-1, 1]) parts.push(part(at(cyl(hr * 0.55, hr * 0.55, 0.05, 6), x + s * 0.065, y, z, 0, 0, PI / 2), 'accent', { color: cols[(i + ti * 2) % cols.length] }));
      parts.push(part(at(cyl(0.012, 0.012, 0.09, 6), x, y, z, 0, 0, PI / 2), 'secondary', { mat: 'small' }));
    }
  });
  // kettlebell
  parts.push(part(at(sphere(0.09, 14, 10), w / 2 + 0.12, 0.085, 0.05, 0, 0, 0, 1, 0.95, 1), 'body'));
  parts.push(part(at(torus(0.055, 0.016, 5, 14, PI), w / 2 + 0.12, 0.16, 0.05), 'body'));
  return { parts, footprint: { w: w + 0.2, d }, collider: { w, d }, solid: true, anchors: {}, colors: { body: RUBBER, secondary: T.ink2, accent: T.butter }, hero: 'hex dumbbells by weight colour, kettlebell' };
}

/** Yoga mat (W2 `lie` slot): unrolled with a soft curl at the head end and a rolled towel. Flat; walkable. */
export function buildYogaMat(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 0.6, d = p.d ?? 1.4;
  const parts = [part(slab(w, d - 0.12, 0.012, 0.04, 0.004, 3), 'body', { mat: 'fabric', ao: false, cast: false })];
  parts.push(part(at(cyl(0.045, 0.045, w - 0.01, 14), 0, 0.045, -d / 2 + 0.04, 0, 0, PI / 2), 'body', { mat: 'fabric', ao: false })); // curl
  parts.push(part(at(slab(w - 0.08, 0.02, 0.013, 0.005, 0.002, 1), 0, 0.001, d / 2 - 0.12), 'accent', { cast: false, ao: false }));
  if (v.chance(0.6)) parts.push(part(at(capsule(0.04, 0.3, 3, 10), v.r(-0.1, 0.1), 0.05, d / 2 - 0.25, 0, 0.1, PI / 2), 'secondary', { mat: 'fabric' })); // towel
  return { parts, footprint: { w, d }, solid: false, anchors: {}, colors: { body: p.colors?.body ?? v.pick([T.lavender, T.sage]), secondary: T.trim, accent: T.trim }, hero: 'curled head end + towel roll' };
}

/** Exercise ball (W2): a teal ball with a seam and a cream valve. */
export function buildGymBall(p: KitParams = {}, rng: Rng) {
  const r = p.r ?? 0.26;
  const parts = [part(at(sphere(r, 24, 16), 0, r * 0.96, 0, 0, 0, 0, 1, 0.94, 1), 'body')];
  parts.push(part(at(torus(r * 1.0, 0.004, 3, 32), 0, r * 0.96, 0, 0.3, 0, 0.2), 'accent', { cast: false }));
  parts.push(part(at(sphere(0.015, 6, 4), 0, r * 1.9, 0.02), 'accent', { cast: false }));
  return { parts, footprint: { r }, solid: true, anchors: {}, colors: { body: p.colors?.body ?? T.teal, accent: T.trim }, hero: 'seam + valve' };
}

/** Wall mirror (W2): tall oak frame, a pale sky-grey face (no reflection pass: a soft diagonal streak). */
export function buildMirror(p: KitParams = {}, rng: Rng) {
  const w = p.w ?? 0.8, h = p.h ?? 1.3;
  const parts = [part(at(rbox(w, h, 0.04, 0.018, 2), 0, 0, 0.02), 'secondary', { mat: 'wood' })];
  parts.push(part(at(rbox(w - 0.1, h - 0.1, 0.006, 0.002), 0, 0, 0.042), 'body', { cast: false }));
  for (let i = 0; i < 2; i++) parts.push(part(at(rbox(0.05 - i * 0.02, h * 0.7, 0.002), -0.1 + i * 0.1, 0.02, 0.046, 0, 0, 0.5), 'accent', { cast: false }));
  return { parts, footprint: { w, d: 0.05 }, solid: false, anchors: {}, colors: { body: '#A9BCC0', secondary: T.oak, accent: '#D3DDDC' }, hero: 'streak highlight' };
}

/**
 * Raised veg bed (W3 planterBox): plank sides with corner posts, dark soil, rows of lettuce heads / carrot tops /
 * a bean pole wigwam, cream plant tags. Front = +z (the `stand` slots are in front).
 */
export function buildRaisedBed(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 1.6, h = p.h ?? 0.6, d = p.d ?? 0.45;
  const parts: Part[] = [];
  for (let i = 0; i < 3; i++) {
    const y = 0.04 + i * (h - 0.06) / 3 + (h - 0.06) / 6;
    for (const e of [-1, 1]) parts.push(part(at(rbox(w, (h - 0.06) / 3 - 0.012, 0.035, 0.01), 0, y, e * (d / 2 - 0.018)), 'body', { mat: 'wood' }));
    for (const e of [-1, 1]) parts.push(part(at(rbox(0.035, (h - 0.06) / 3 - 0.012, d - 0.07, 0.01), e * (w / 2 - 0.018), y, 0), 'body', { mat: 'wood' }));
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(part(at(rbox(0.06, h + 0.04, 0.06, 0.015), sx * (w / 2 - 0.02), (h + 0.04) / 2, sz * (d / 2 - 0.02)), 'secondary', { mat: 'wood' }));
  parts.push(part(at(rbox(w - 0.07, 0.03, d - 0.07, 0.01), 0, h - 0.06, 0), 'secondary', { color: '#5A4636', ao: 0.6, cast: false })); // soil
  const n = Math.max(3, Math.round(w / 0.28));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + 0.17 + i * ((w - 0.34) / (n - 1)), kind = (i + v.int(2)) % 3;
    if (kind === 0) { // lettuce head
      parts.push(part(at(sphere(v.r(0.08, 0.1), 10, 8), x, h - 0.01, v.r(-0.04, 0.04), 0, 0, 0, 1, 0.7, 1), 'body', { mat: 'foliage', grad: G(h - 0.05, h + 0.12, T.moss, '#A9C08F') }));
    } else if (kind === 1) { // carrot / herb tops
      for (let k = 0; k < 5; k++) { const a = k * 1.3; parts.push(part(at(capsule(0.012, 0.12, 2, 5), x + Math.cos(a) * 0.03, h + 0.04, Math.sin(a) * 0.03, Math.sin(a) * 0.4, 0, Math.cos(a) * 0.4), 'body', { mat: 'foliage', grad: G(h - 0.05, h + 0.15) })); }
    } else { // a leafy bush with butter blossoms (squash)
      parts.push(part(at(sphere(0.1, 10, 7), x, h + 0.02, 0, 0, 0, 0, 1.2, 0.75, 1), 'body', { mat: 'foliage', grad: G(h - 0.05, h + 0.14) }));
      for (let k = 0; k < 2; k++) parts.push(part(at(sphere(0.022, 6, 4), x + (k ? 0.06 : -0.05), h + 0.1, 0.05), 'accent', { color: T.butter, cast: false, mat: 'small' }));
    }
    if (i % 2 === 0) { // plant tag
      parts.push(part(at(rbox(0.05, 0.035, 0.004, 0.001), x + 0.08, h + 0.03, d / 2 - 0.06, -0.3), 'accent', { color: T.trim, cast: false, mat: 'small' }));
    }
  }
  if (p.wigwam !== false) { // bean poles
    const x = w / 2 - 0.22;
    for (let k = 0; k < 3; k++) { const a = k * 2.1; parts.push(part(between(cyl(0.008, 0.008, 1, 5), [x + Math.cos(a) * 0.12, h - 0.04, Math.sin(a) * 0.1], [x, h + 0.62, 0]), 'secondary', { mat: 'wood' })); }
    for (let k = 0; k < 6; k++) parts.push(part(at(sphere(0.045, 6, 5), x + v.r(-0.08, 0.08), h + 0.1 + k * 0.08, v.r(-0.07, 0.07), 0, 0, 0, 1, 0.6, 1), 'body', { mat: 'foliage', grad: G(h, h + 0.6) }));
  }
  return { parts, footprint: { w, d }, solid: true, anchors: {}, colors: { body: T.oakDark, secondary: T.walnut, accent: T.trim }, hero: 'veg rows, bean-pole wigwam, plant tags' };
}

/**
 * W3 signature · the sun lamp: a tripod grow-light with a big butter dish reflector on a knuckled arm, a ring of warm
 * bulbs under it, tilted toward the seedlings. Glows (bulb class) — "the greenhouse has its own sun".
 */
export function buildSunLamp(p: KitParams = {}, rng: Rng) {
  const H = p.h ?? 1.6, parts: Part[] = [];
  for (let k = 0; k < 3; k++) { const a = k * 2.094 + 0.3; parts.push(part(tube([[Math.cos(a) * 0.28, 0, Math.sin(a) * 0.28], [Math.cos(a) * 0.1, 0.35, Math.sin(a) * 0.1], [0, 0.6, 0]], 0.014, 4, 6), 'secondary')); parts.push(part(at(sphere(0.022, 8, 6), Math.cos(a) * 0.28, 0.012, Math.sin(a) * 0.28), 'accent')); }
  parts.push(part(at(cyl(0.022, 0.026, H - 0.6, 10), 0, 0.6 + (H - 0.6) / 2, 0), 'secondary'));
  parts.push(part(at(torus(0.03, 0.01, 4, 12), 0, 0.62, 0, PI / 2), 'accent'));
  parts.push(part(at(sphere(0.04, 10, 8), 0, H, 0), 'accent')); // knuckle
  const hx = 0.36, hy = H + 0.12; // dish centre
  parts.push(part(tube([[0, H, 0], [0.16, H + 0.16, 0], [hx - 0.04, hy + 0.08, 0]], 0.016, 6, 6), 'secondary'));
  const tilt = 0.55; // opening faces +x and down (toward the beds)
  const dish = lathe([[0.3, -0.02], [0.28, 0.03], [0.22, 0.08], [0.12, 0.115], [0, 0.125]], 32);
  parts.push(part(at(dish, hx, hy, 0, 0, 0, tilt), 'body'));
  const cav = lathe([[0, 0.105], [0.11, 0.095], [0.2, 0.06], [0.26, 0.015], [0.27, -0.015]], 32);
  parts.push(part(at(cav, hx, hy - 0.004, 0, 0, 0, tilt), 'body', { color: '#8A6F3E', ao: 0.8, cast: false }));
  const rim = at(torus(0.3, 0.014, 5, 32), 0, -0.02, 0, PI / 2);
  rim.applyMatrix4(new THREE.Matrix4().makeRotationZ(tilt)).translate(hx, hy, 0);
  parts.push(part(rim, 'accent', { cast: false }));
  // bulb ring on the underside
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * PI * 2, r = k === 6 ? 0 : 0.15;
    const g = at(sphere(k === 6 ? 0.05 : 0.035, 12, 8), Math.cos(a) * r * (k === 6 ? 0 : 1), 0.02, Math.sin(a) * r);
    g.applyMatrix4(new THREE.Matrix4().makeRotationZ(tilt)).translate(hx, hy, 0);
    parts.push(part(g, 'bulb', { mat: 'bulb', cast: false }));
  }
  return { parts, footprint: { r: 0.3 }, solid: true, anchors: { bulb: [hx, hy, 0] }, colors: { body: T.butter, secondary: T.ink2, accent: T.brass }, hero: 'big dish reflector + bulb ring on a knuckled arm' };
}

/** Watering can (W3 story prop): lathed body, a long spout with a rose head, a loop handle. */
export function buildWateringCan(p: KitParams = {}, rng: Rng) {
  const s = p.s ?? 1, parts: Part[] = [];
  parts.push(part(at(lathe([[0, 0], [0.09, 0], [0.095, 0.01], [0.09, 0.16], [0.07, 0.19], [0, 0.19]], 16), 0, 0, 0, 0, 0, 0, s, s, s), 'body'));
  parts.push(part(at(tube([[0.07, 0.05, 0], [0.16, 0.14, 0], [0.24, 0.24, 0]], 0.012, 5, 6), 0, 0, 0, 0, 0, 0, s, s, s), 'body'));
  parts.push(part(at(lathe([[0.012, 0], [0.03, 0.03], [0.032, 0.04], [0, 0.042]], 10), 0.24 * s, 0.24 * s, 0, 0, 0, -0.8, s, s, s), 'accent'));
  parts.push(part(at(torus(0.07, 0.01, 4, 12, PI), -0.02 * s, 0.19 * s, 0, 0, PI / 2, 0, s, s, s), 'body'));
  parts.push(part(at(torus(0.09, 0.006, 3, 16), 0, 0.1 * s, 0, PI / 2, 0, 0, s, s, s), 'accent', { cast: false }));
  return { parts, footprint: { r: 0.12 * s }, solid: false, anchors: {}, colors: { body: p.colors?.body ?? T.teal, accent: T.brass }, small: true, hero: 'spout rose + loop handle' };
}

/** Potting bench (W3): slatted oak bench, a shelf of pots, seed trays with sprouts, a trowel. Front = +z. */
export function buildPottingBench(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 1.1, d = p.d ?? 0.42, h = p.h ?? 0.62;
  const parts: Part[] = [];
  for (let i = 0; i < 5; i++) parts.push(part(at(rbox(w, 0.03, d / 5 - 0.01, 0.008), 0, h - 0.015, -d / 2 + (i + 0.5) * d / 5), 'body', { mat: 'wood' }));
  parts.push(part(at(rbox(w, 0.025, d - 0.06, 0.008), 0, 0.2, 0), 'body', { mat: 'wood' })); // lower shelf
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(part(at(rbox(0.045, h + (sz < 0 ? 0.42 : 0), 0.045, 0.01), sx * (w / 2 - 0.03), (h + (sz < 0 ? 0.42 : 0)) / 2, sz * (d / 2 - 0.03)), 'body', { mat: 'wood' }));
  parts.push(part(at(rbox(w, 0.03, 0.14, 0.008), 0, h + 0.3, -d / 2 + 0.07), 'body', { mat: 'wood' })); // back shelf
  for (let i = 0; i < 4; i++) { // small pots on the back shelf with sprouts
    const x = -w / 2 + 0.16 + i * ((w - 0.32) / 3);
    parts.push(part(at(lathe([[0, 0], [0.04, 0], [0.05, 0.07], [0.055, 0.075], [0, 0.075]], 12), x, h + 0.315, -d / 2 + 0.07), 'secondary'));
    parts.push(part(at(sphere(0.05, 8, 6), x, h + 0.41, -d / 2 + 0.07, 0, 0, 0, 1, 0.8, 1), 'body', { mat: 'foliage', grad: G(h + 0.35, h + 0.46) }));
  }
  for (let t = 0; t < 2; t++) { // seed trays
    const x = -0.22 + t * 0.4;
    parts.push(part(at(rbox(0.32, 0.05, 0.22, 0.008), x, h + 0.025, 0.04), 'secondary', { color: T.ink2 }));
    for (let k = 0; k < 8; k++) parts.push(part(at(capsule(0.012, 0.03, 2, 5), x - 0.12 + (k % 4) * 0.08, h + 0.075, 0.0 + Math.floor(k / 4) * 0.09), 'body', { mat: 'foliage', grad: G(h + 0.05, h + 0.12, T.moss, '#A9C08F') }));
  }
  parts.push(part(at(rbox(0.04, 0.012, 0.16, 0.004), 0.36, h + 0.006, 0.1, 0, 0.5), 'accent', { mat: 'small' })); // trowel
  for (let i = 0; i < 3; i++) parts.push(part(at(lathe([[0, 0], [0.07, 0], [0.085, 0.12], [0.09, 0.13], [0, 0.13]], 12), -w / 2 + 0.2 + i * 0.12, 0.215, 0.03 * (i % 2)), 'secondary')); // stacked pots below
  void v;
  return { parts, footprint: { w, d }, solid: true, anchors: { top: h }, colors: { body: T.oak, secondary: T.oat, accent: T.brass }, hero: 'seed trays with sprouts, pots on the back shelf' };
}

/** Wall trellis (W3): an oak lattice with a climbing vine and a few flowers. Origin = wall face centre bottom. */
export function buildTrellis(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 1.0, h = p.h ?? 1.4, parts: Part[] = [];
  for (let i = 0; i <= 4; i++) parts.push(part(at(rbox(0.025, h, 0.02, 0.006), -w / 2 + i * (w / 4), h / 2, 0.02), 'body', { mat: 'wood' }));
  for (let j = 0; j <= 5; j++) parts.push(part(at(rbox(w, 0.025, 0.02, 0.006), 0, 0.05 + j * ((h - 0.1) / 5), 0.04), 'body', { mat: 'wood' }));
  const pts: number[][] = []; for (let k = 0; k <= 10; k++) { const t = k / 10; pts.push([Math.sin(t * 7 + v.r(0, 1)) * w * 0.35, 0.05 + t * (h - 0.05), 0.065]); }
  parts.push(part(tube(pts, 0.008, 20, 4), 'secondary', { mat: 'foliage', grad: G(0, h) }));
  for (let k = 0; k < 16; k++) { const q = pts[1 + (k % 9)]; parts.push(part(at(sphere(0.05, 6, 4), q[0] + v.r(-0.1, 0.1), q[1] + v.r(-0.05, 0.05), 0.075, v.r(-0.5, 0.5), 0, v.r(0, PI), 1, 0.4, 0.8), 'secondary', { mat: 'foliage', grad: G(0, h) })); }
  for (let k = 0; k < 5; k++) { const q = pts[2 + k]; parts.push(part(at(sphere(0.025, 6, 4), q[0] + 0.05, q[1], 0.1), 'accent', { color: v.pick([T.butter, T.lavender, T.trim]), cast: false, mat: 'small' })); }
  return { parts, footprint: { w, d: 0.1 }, solid: false, anchors: {}, colors: { body: T.oak, secondary: T.moss, accent: T.butter }, hero: 'climbing vine + flowers' };
}

/** Pegboard (W3 tools / W2 bands): oat board with dot holes, hanging tools on pegs. Origin = wall face centre. */
export function buildPegboard(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 0.9, h = p.h ?? 0.6, parts: Part[] = [];
  parts.push(part(at(rbox(w, h, 0.02, 0.01), 0, 0, 0.02), 'body'));
  parts.push(part(at(rbox(w + 0.04, h + 0.04, 0.012, 0.006), 0, 0, 0.008), 'secondary', { mat: 'wood' }));
  const tools = p.kind === 'gym' ? ['band', 'band', 'rope', 'towel'] : ['trowel', 'fork', 'shears', 'gloves', 'twine'];
  tools.forEach((t, i) => {
    const x = -w / 2 + 0.13 + i * ((w - 0.26) / Math.max(1, tools.length - 1)), y = 0.12;
    parts.push(part(at(cyl(0.006, 0.006, 0.04, 5), x, y + 0.02, 0.05, PI / 2), 'accent', { mat: 'small' }));
    if (t === 'trowel') { parts.push(part(at(rbox(0.07, 0.14, 0.01, 0.004), x, y - 0.12, 0.05), 'accent', { color: T.steel })); parts.push(part(at(capsule(0.014, 0.08, 2, 6), x, y - 0.02, 0.05), 'secondary', { mat: 'wood' })); }
    else if (t === 'fork') { for (let k = -1; k <= 1; k++) parts.push(part(at(rbox(0.008, 0.12, 0.008), x + k * 0.025, y - 0.14, 0.05), 'accent', { color: T.steel, mat: 'small' })); parts.push(part(at(capsule(0.014, 0.08, 2, 6), x, y - 0.03, 0.05), 'secondary', { mat: 'wood' })); }
    else if (t === 'shears') { for (const e of [-1, 1]) parts.push(part(at(rbox(0.012, 0.2, 0.008, 0.004), x + e * 0.02, y - 0.1, 0.05, 0, 0, e * 0.15), 'accent', { color: T.steel })); }
    else if (t === 'gloves') { for (const e of [-1, 1]) parts.push(part(at(capsule(0.03, 0.08, 2, 6), x + e * 0.03, y - 0.09, 0.05), 'accent', { color: T.butter, mat: 'fabric' })); }
    else if (t === 'twine') { parts.push(part(at(cyl(0.04, 0.04, 0.05, 12), x, y - 0.06, 0.06, PI / 2), 'accent', { color: T.kraft })); }
    else if (t === 'band') { parts.push(part(at(torus(0.07, 0.01, 4, 14), x, y - 0.07, 0.05, 0, 0, 0, 0.6, 1, 1), 'accent', { color: v.pick([T.teal, T.lavender, T.butter]) })); }
    else if (t === 'rope') { parts.push(part(at(torus(0.06, 0.01, 4, 14), x, y - 0.06, 0.05), 'accent', { color: T.kraft })); parts.push(part(at(torus(0.05, 0.01, 4, 14), x, y - 0.09, 0.055), 'accent', { color: T.kraft })); }
    else if (t === 'towel') { parts.push(part(at(rbox(0.12, 0.26, 0.02, 0.008), x, y - 0.12, 0.05), 'accent', { color: T.trim, mat: 'fabric' })); }
  });
  return { parts, footprint: { w, d: 0.1 }, solid: false, anchors: {}, colors: { body: T.oat, secondary: T.oak, accent: T.brass }, hero: 'hanging tools on pegs' };
}

/** Dartboard (E1 game room): layered disc rings on a walnut backer, three darts stuck in. Origin = wall face centre. */
export function buildDartboard(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), r = p.r ?? 0.22, parts: Part[] = [];
  parts.push(part(at(rbox(r * 2.6, r * 2.6, 0.02, 0.03, 2), 0, 0, 0.01), 'secondary', { mat: 'wood' }));
  const rings: [number, string][] = [[r, T.ink], [r * 0.8, T.trim], [r * 0.62, T.tealDeep], [r * 0.45, T.trim], [r * 0.27, T.tealDeep], [r * 0.1, T.butter]];
  rings.forEach(([rr, c], i) => parts.push(part(at(cyl(rr, rr, 0.02, 28), 0, 0, 0.03 + i * 0.003, PI / 2), 'body', { color: c, cast: i === 0 })));
  for (let k = 0; k < 3; k++) {
    const x = v.r(-r * 0.5, r * 0.5), y = v.r(-r * 0.5, r * 0.5);
    parts.push(part(at(cyl(0.004, 0.006, 0.09, 6), x, y, 0.1, PI / 2 - 0.15, 0, 0), 'accent', { color: T.brass }));
    parts.push(part(at(rbox(0.03, 0.03, 0.002), x, y + 0.012, 0.15, 0, 0, PI / 4), 'accent', { color: [T.rose, T.butter, T.lavender][k], cast: false, mat: 'small' }));
  }
  return { parts, footprint: { w: r * 2.6, d: 0.16 }, solid: false, anchors: {}, colors: { body: T.ink, secondary: T.walnut, accent: T.brass }, hero: 'rings + three darts stuck in' };
}

/** Board-game shelf (E1): a low walnut shelf of stacked game boxes (lids in jewel/paper tokens), dice on top. */
export function buildGameShelf(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 1.4, h = p.h ?? 1.0, d = p.d ?? 0.35, parts: Part[] = [];
  parts.push(part(at(rbox(w, 0.03, d, 0.01), 0, h - 0.015, 0), 'body', { mat: 'wood' }));
  parts.push(part(at(rbox(w + 0.05, 0.035, d + 0.03, 0.012), 0, h + 0.017, 0.005), 'body', { mat: 'wood' })); // crown
  parts.push(part(at(rbox(w, h, 0.02, 0.006), 0, h / 2, -d / 2 + 0.01), 'body', { mat: 'wood', color: T.walnutDark }));
  for (const e of [-1, 1]) parts.push(part(at(rbox(0.035, h, d, 0.01), e * (w / 2 - 0.017), h / 2, 0), 'body', { mat: 'wood' }));
  const shelves = 3;
  for (let s = 0; s < shelves; s++) {
    const y0 = 0.06 + s * (h - 0.1) / shelves;
    parts.push(part(at(rbox(w - 0.04, 0.025, d - 0.02, 0.008), 0, y0 - 0.012, 0.01), 'body', { mat: 'wood' }));
    let x = -w / 2 + 0.06;
    while (x < w / 2 - 0.2) {
      const bw = v.r(0.2, 0.34), stack = 1 + v.int(3), sh = (h - 0.1) / shelves - 0.04;
      for (let k = 0; k < stack; k++) {
        const bh = Math.min(sh / stack, v.r(0.05, 0.08));
        parts.push(part(at(rbox(bw, bh - 0.004, d - 0.08, 0.008), x + bw / 2, y0 + k * bh + bh / 2, 0.01, 0, v.r(-0.06, 0.06), 0), 'accent', { color: SPINES[(s * 5 + k * 3 + Math.round(x * 10)) % SPINES.length] }));
      }
      x += bw + 0.02;
    }
  }
  for (let i = 0; i < 2; i++) parts.push(part(at(rbox(0.04, 0.04, 0.04, 0.006), -0.2 + i * 0.06, h + 0.055, 0.05, 0, v.r(0, 1), 0), 'secondary', { color: T.trim, mat: 'small' }));
  return { parts, footprint: { w, d }, solid: true, anchors: {}, colors: { body: T.walnut, secondary: T.trim, accent: T.teal }, hero: 'stacked game boxes + dice' };
}

/** Chalk scoreboard (E1): a slate board in an oak frame with tally marks and a chalk ledge. Origin = wall face centre. */
export function buildScoreboard(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 0.8, h = p.h ?? 0.55, parts: Part[] = [];
  parts.push(part(at(rbox(w, h, 0.03, 0.015), 0, 0, 0.015), 'secondary', { mat: 'wood' }));
  parts.push(part(at(rbox(w - 0.08, h - 0.08, 0.006, 0.002), 0, 0, 0.032), 'body', { cast: false }));
  for (let r = 0; r < 3; r++) {
    parts.push(part(at(rbox(0.12, 0.012, 0.002), -w / 2 + 0.14, h / 2 - 0.1 - r * 0.13, 0.036), 'accent', { cast: false, mat: 'small' }));
    const n = 2 + v.int(6);
    for (let k = 0; k < n; k++) parts.push(part(at(rbox(0.008, 0.07, 0.002), -0.05 + k * 0.03 + Math.floor(k / 5) * 0.03, h / 2 - 0.1 - r * 0.13, 0.036, 0, 0, k % 5 === 4 ? 1.1 : 0.05), 'accent', { cast: false, mat: 'small' }));
  }
  parts.push(part(at(rbox(w - 0.1, 0.02, 0.05, 0.006), 0, -h / 2 + 0.01, 0.04), 'secondary', { mat: 'wood' }));
  parts.push(part(at(capsule(0.006, 0.05, 2, 5), 0.1, -h / 2 + 0.028, 0.045, 0, 0, PI / 2), 'accent', { mat: 'small' }));
  return { parts, footprint: { w, d: 0.06 }, solid: false, anchors: {}, colors: { body: '#3D4A48', secondary: T.oak, accent: T.trim }, hero: 'tally marks + chalk ledge' };
}

/**
 * E3 signature · moon lamp: a big pale moon globe with craters on a walnut cradle stand; its `shade` material only
 * glows after dark (a night light for the nap lounge).
 */
export function buildMoonLamp(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), r = p.r ?? 0.24, parts: Part[] = [];
  parts.push(part(at(lathe([[0, 0], [0.2, 0], [0.21, 0.02], [0.17, 0.05], [0.06, 0.07], [0, 0.07]], 20), 0, 0, 0), 'secondary', { mat: 'wood' }));
  for (let k = 0; k < 3; k++) { const a = k * 2.094; parts.push(part(tube([[Math.cos(a) * 0.05, 0.07, Math.sin(a) * 0.05], [Math.cos(a) * 0.14, 0.2, Math.sin(a) * 0.14], [Math.cos(a) * 0.15, 0.28, Math.sin(a) * 0.15]], 0.012, 4, 5), 'secondary', { mat: 'wood' })); }
  parts.push(part(at(sphere(r, 28, 20), 0, 0.18 + r, 0), 'body', { mat: 'shade' }));
  for (let k = 0; k < 7; k++) {
    const th = v.r(0, PI * 2), ph = v.r(0.4, 2.4), cr = v.r(0.03, 0.06);
    const n = new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th));
    const g = cyl(cr, cr * 0.8, 0.012, 12);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n)).translate(n.x * (r - 0.002), 0.18 + r + n.y * (r - 0.002), n.z * (r - 0.002));
    parts.push(part(g, 'body', { mat: 'shade', color: '#CFC6B4', cast: false }));
  }
  return { parts, footprint: { r: 0.22 }, solid: false, anchors: { bulb: [0, 0.18 + r, 0] }, colors: { body: '#EDE4D0', secondary: T.walnut, accent: T.brass }, hero: 'cratered moon globe that glows at night' };
}

/** Blanket basket (E3): a woven lathed basket with two rolled blankets poking out. */
export function buildBlanketBasket(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), parts: Part[] = [];
  parts.push(part(lathe([[0, 0], [0.18, 0], [0.21, 0.05], [0.22, 0.3], [0.235, 0.32], [0.215, 0.33], [0.2, 0.05], [0, 0.03]], 20), 'body', { mat: 'fabric' }));
  for (let k = 0; k < 4; k++) parts.push(part(at(torus(0.215 + k * 0.004, 0.006, 3, 24), 0, 0.08 + k * 0.07, 0, PI / 2), 'body', { mat: 'fabric', color: '#A38561', cast: false }));
  const cols = [T.lavender, T.sage, T.rose, '#7FA3B3'];
  for (let k = 0; k < 2; k++) parts.push(part(at(capsule(0.08, 0.2, 3, 12), -0.06 + k * 0.12, 0.34, v.r(-0.04, 0.04), 0.2 * (k ? 1 : -1), 0, PI / 2 - 0.3 + k * 0.5), 'secondary', { mat: 'fabric', color: cols[(k + v.int(3)) % cols.length] }));
  return { parts, footprint: { r: 0.24 }, solid: true, anchors: {}, colors: { body: T.kraft, secondary: T.lavender, accent: T.trim }, hero: 'woven rings + rolled blankets' };
}

/** Star string (E3 wall): a looping cord with little butter stars (glow = bulb class, dim). Origin = left end. */
export function buildStarString(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), len = p.len ?? 1.8, parts: Part[] = [];
  const pts = []; for (let k = 0; k <= 12; k++) { const t = k / 12; pts.push([t * len, -Math.sin(t * PI * 2) * 0.08 - 0.18 * 4 * t * (1 - t), 0.02]); }
  parts.push(part(tube(pts, 0.003, 24, 3), 'secondary', { cast: false }));
  const star = () => { const s = new THREE.Shape(); for (let i = 0; i < 10; i++) { const a = (i / 10) * PI * 2 + PI / 2, r = i % 2 ? 0.018 : 0.042; if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r); else s.moveTo(Math.cos(a) * r, Math.sin(a) * r); } return new THREE.ExtrudeGeometry(s, { depth: 0.01, bevelEnabled: false }); };
  for (let k = 1; k < 12; k += 1) { const q = pts[k]; parts.push(part(at(star(), q[0], q[1] - 0.05, 0.03, 0, 0, v.r(-0.3, 0.3)), 'bulb', { mat: 'bulb', cast: false, color: T.butter })); }
  return { parts, footprint: { w: len, d: 0.05 }, solid: false, anchors: {}, colors: { body: T.butter, secondary: T.ink2, accent: T.butter }, hero: 'looping cord of glowing stars' };
}

/** Display plinth for a storefront window (bay side): a short oak stand with a cream top. */
export function buildPlinth(p: KitParams = {}, rng: Rng) {
  const w = p.w ?? 0.5, d = p.d ?? 0.3, h = p.h ?? 0.5;
  const parts = [part(at(rbox(w, h - 0.04, d, 0.02, 2), 0, (h - 0.04) / 2, 0), 'body', { mat: 'wood' }), part(at(rbox(w + 0.03, 0.04, d + 0.03, 0.015), 0, h - 0.02, 0), 'secondary')];
  parts.push(part(at(rbox(w + 0.01, 0.04, d + 0.01, 0.01), 0, 0.02, 0), 'accent'));
  return { parts, footprint: { w, d }, solid: true, anchors: { top: h }, colors: { body: T.oak, secondary: T.trim, accent: T.walnut }, hero: 'cream cap + plinth base' };
}

/** Trophy (W2 window display / E1): brass cup on a walnut base. */
export function buildTrophy(p: KitParams = {}, rng: Rng) {
  const s = p.s ?? 1;
  const parts = [part(at(rbox(0.1, 0.05, 0.1, 0.012), 0, 0.025, 0, 0, 0, 0, s, s, s), 'secondary', { mat: 'wood' })];
  parts.push(part(at(lathe([[0, 0.05], [0.03, 0.05], [0.012, 0.08], [0.012, 0.11], [0.06, 0.15], [0.065, 0.21], [0.058, 0.21], [0, 0.16]], 16), 0, 0, 0, 0, 0, 0, s, s, s), 'body'));
  for (const e of [-1, 1]) parts.push(part(at(torus(0.03, 0.006, 4, 10, PI), e * 0.06 * s, 0.17 * s, 0, 0, 0, e * -PI / 2, s, s, s), 'body'));
  return { parts, footprint: { r: 0.06 * s }, solid: false, anchors: {}, colors: { body: T.brass, secondary: T.walnut, accent: T.trim }, small: true, hero: 'loop handles' };
}

/** Climbing wall panel (W2): a ply board on stand-offs with lumpy holds in 4 tokens. Origin = wall face, bottom centre. */
export function buildClimbWall(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), w = p.w ?? 1.2, h = p.h ?? 1.7, y0 = p.y0 ?? 0.25, parts: Part[] = [];
  parts.push(part(at(rbox(w, h, 0.04, 0.02, 2), 0, y0 + h / 2, 0.03), 'body', { mat: 'wood' }));
  parts.push(part(at(rbox(w + 0.04, 0.05, 0.06, 0.015), 0, y0 + h + 0.01, 0.035), 'secondary'));
  const holds = [T.butter, T.teal, T.lavender, T.rose];
  for (let i = 0; i < 16; i++) {
    const x = v.r(-w / 2 + 0.12, w / 2 - 0.12), y = y0 + 0.12 + (i / 16) * (h - 0.24) + v.r(-0.05, 0.05), r = v.r(0.035, 0.06);
    parts.push(part(at(sphere(r, 8, 6), x, y, 0.055, 0, 0, v.r(0, 3), v.r(0.9, 1.5), 1, 0.55), 'accent', { color: holds[i % holds.length], ao: 0.9 }));
  }
  for (const [sx, sy] of [[-1, 0], [1, 0], [-1, 1], [1, 1]]) parts.push(part(at(cyl(0.015, 0.015, 0.01, 8), sx * (w / 2 - 0.05), y0 + 0.05 + sy * (h - 0.1), 0.053, PI / 2), 'secondary', { mat: 'small' }));
  return { parts, footprint: { w, d: 0.1 }, solid: false, anchors: {}, colors: { body: '#C9B08A', secondary: T.ink2, accent: T.butter }, hero: 'lumpy holds in four colours' };
}

/** Gym rings (W2): two straps from a ceiling plate down `drop` m to wooden rings. Origin = the ceiling point. */
export function buildGymRings(p: KitParams = {}, rng: Rng) {
  const drop = p.drop ?? 0.75, parts: Part[] = [];
  parts.push(part(at(rbox(0.5, 0.03, 0.08, 0.01), 0, -0.015, 0), 'secondary'));
  for (const e of [-1, 1]) {
    parts.push(part(at(rbox(0.03, drop, 0.006, 0.002), e * 0.2, -drop / 2, 0), 'accent', { mat: 'fabric' }));
    parts.push(part(at(rbox(0.036, 0.05, 0.012, 0.004), e * 0.2, -drop + 0.02, 0), 'secondary'));
    parts.push(part(at(torus(0.075, 0.014, 6, 20), e * 0.2, -drop - 0.07, 0, 0, PI / 2, 0), 'body', { mat: 'wood' }));
  }
  return { parts, footprint: { w: 0.5, d: 0.1 }, solid: false, anchors: {}, colors: { body: T.oak, secondary: T.ink2, accent: T.butter }, hero: 'wooden rings on straps' };
}

/** Vinyl wall (W1): three framed records in a row on a walnut rail. Origin = wall face centre. */
export function buildVinylWall(p: KitParams = {}, rng: Rng) {
  const v = vary(rng), n = p.n ?? 3, parts: Part[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * 0.36;
    parts.push(part(at(rbox(0.32, 0.32, 0.025, 0.01), x, 0, 0.012), 'secondary', { mat: 'wood' }));
    parts.push(part(at(cyl(0.13, 0.13, 0.008, 24), x, 0, 0.03, PI / 2), 'body', { cast: false }));
    parts.push(part(at(cyl(0.045, 0.045, 0.006, 16), x, 0, 0.036, PI / 2), 'accent', { color: v.pick([T.butter, T.rose, T.teal, T.lavender, T.sage]), cast: false }));
  }
  return { parts, footprint: { w: n * 0.36, d: 0.05 }, solid: false, anchors: {}, colors: { body: T.ink, secondary: T.walnut, accent: T.butter }, hero: 'framed records' };
}

/** Registry entries (spread into `KIT`, registry.ts) + signature names + prop-sheet rows. */
export const AMENITY_KIT = Object.freeze({
  piano: buildPiano, guitar: buildGuitar, recordPlayer: buildRecordPlayer, acousticPanels: buildAcousticPanels, amp: buildAmp,
  treadmill: buildTreadmill, dumbbells: buildDumbbells, yogaMat: buildYogaMat, gymBall: buildGymBall, mirror: buildMirror,
  raisedBed: buildRaisedBed, sunLamp: buildSunLamp, wateringCan: buildWateringCan, pottingBench: buildPottingBench, trellis: buildTrellis,
  pegboard: buildPegboard, dartboard: buildDartboard, gameShelf: buildGameShelf, scoreboard: buildScoreboard, moonLamp: buildMoonLamp,
  blanketBasket: buildBlanketBasket, starString: buildStarString, plinth: buildPlinth, trophy: buildTrophy,
  climbWall: buildClimbWall, gymRings: buildGymRings, vinylWall: buildVinylWall,
});
export const AMENITY_SIGNATURE = Object.freeze(['piano', 'treadmill', 'sunLamp', 'moonLamp', 'raisedBed', 'pottingBench', 'gameShelf', 'recordPlayer']);
export const AMENITY_SHEET: readonly SheetEntry[] = Object.freeze<SheetEntry[]>([
  ['piano', {}, 'piano ★'], ['guitar', {}, 'guitar'], ['recordPlayer', {}, 'recordPlayer'], ['acousticPanels', {}, 'acoustic panels'], ['amp', {}, 'amp'],
  ['treadmill', {}, 'treadmill ★'], ['dumbbells', {}, 'dumbbells'], ['yogaMat', {}, 'yogaMat'], ['gymBall', {}, 'gymBall'], ['mirror', {}, 'mirror'],
  ['raisedBed', {}, 'raisedBed'], ['sunLamp', {}, 'sunLamp ★'], ['wateringCan', {}, 'wateringCan'], ['pottingBench', {}, 'pottingBench'], ['trellis', {}, 'trellis'],
  ['pegboard', {}, 'pegboard'], ['pegboard', { kind: 'gym' }, 'pegboard · gym'], ['dartboard', {}, 'dartboard'], ['gameShelf', {}, 'gameShelf'], ['scoreboard', {}, 'scoreboard'],
  ['moonLamp', {}, 'moonLamp ★'], ['blanketBasket', {}, 'blanketBasket'], ['starString', {}, 'starString'], ['plinth', {}, 'plinth'], ['trophy', {}, 'trophy'],
  ['climbWall', {}, 'climbWall'], ['gymRings', {}, 'gymRings'], ['vinylWall', {}, 'vinylWall'],
]);
