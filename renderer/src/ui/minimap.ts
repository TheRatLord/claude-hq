/**
 * Minimap (bottom-left of the world strip, 180 px; UI kit §5.1: graph paper taped inside a walnut frame, a small zone
 * plaque on the frame, a clay player arrow) + `M` overview on the same paper (§8 HUD). North-up. The static layer (floor,
 * furniture, walls, zone names) is baked once from the layout schema (`ctx.layout`: proto today, LVL's hq.ts when
 * `?layout=hq`), so it follows whatever plan is loaded; agents + the player are drawn on top at ≤ 20 Hz.
 * Blocked agents pulse (the "minimap pulse" notification channel, §8). Overview: a large paper map with names; click an
 * agent → go to it; click the floor → glide there; hover → name + state. M / Esc closes.
 * Owner: UI.
 */
import { h, stateColor } from './dom.ts';
import { CORE, ENV, UI } from '../../../shared/palette.ts';
import { plaque, lamp, keycap, legend } from './kit/index.ts';
import { ensureHudCss } from './hudCss.ts';
import { firstQuestionLine } from './serveModel.ts';
import { trailNote, trailHit, GO } from '../player/goThere.ts'; // [PLY m3 fix r2, cross-owner] map click on a dot that just moved
import { pruneIfGrown } from './prune.ts'; // [UI fix r3] the trail never keeps dead ids (trailHit walks them all)
import type { SeatMemo, PoseArr } from '../player/goThere.ts';
import type { Layout, Zone } from '../world/layout/schema.ts';
import type { Entity } from '../../../shared/protocol.ts';
import type { Store } from '../net/store.ts';
import type { ActorView } from './aim.ts';

type Ctx2D = CanvasRenderingContext2D;
/** `getContext('2d')` never yields null for a fresh canvas in a browser; a null here is a broken environment, so fail loudly. */
function ctx2d(c: HTMLCanvasElement): Ctx2D {
  const g = c.getContext('2d');
  if (!g) throw new Error('minimap: no 2d canvas context');
  return g;
}

export const MINIMAP_PX = 180;

/** `#rrggbb` palette token → rgba() with alpha (canvas inks are palette tokens, never literals). */
export function tint(hex: string, a = 1): string {
  const n = parseInt(String(hex).slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
/** Pencil inks on the graph paper (both maps share them: "one paper style"). */
const INK = {
  wall: CORE.ink2, window: ENV.teal, floor: tint(CORE.oat, 0.45), zoneA: tint(ENV.teal, 0.08), zoneB: tint(CORE.sand, 0.16),
  // the upper deck is pencil work like everything else on the paper: a stitched outline + a light 45° hatch in p3 ink
  upper: UI.p3, upperHatch: tint(UI.p3, 0.28), label: tint(CORE.ink2, 0.72),
  halo: tint(CORE.paper, 0.9), dotRim: tint(CORE.ink2, 0.9), blocked: UI.onPaper.blocked, name: CORE.ink2, bubble: CORE.ink2,
  bubbleTx: CORE.paper, lead: tint(CORE.ink2, 0.45), player: CORE.clay, playerRim: CORE.clayDeep, wedge: tint(CORE.clay, 0.3),
  wedge0: tint(CORE.clay, 0), sel: CORE.clayDeep, follow: CORE.ink2, pulse: (a: number) => tint(UI.onPaper.blocked, a), upHalo: UI.p3, upBadge: CORE.ink2, upBadgeTx: CORE.paper,
};
/** Plan tint per furniture type (pencil washes; unknown solid types get a neutral block). */
const FURN: Record<string, string | null> = {
  desk: ENV.oak, counter: ENV.oak, sofa: ENV.sage, chair: null, deskLamp: null, floorLamp: null, podRug: ENV.teal, rug: ENV.teal,
  coffeeTable: ENV.oak, shelf: ENV.walnut, cooler: ENV.teal, whiteboard: CORE.sand, plant: ENV.moss, plantSmall: ENV.moss, beacon: null,
};
const SKIP = new Set(['chair', 'deskLamp', 'floorLamp', 'beacon', 'lamp', 'window', 'pendant']);

/** Nav level of an actor / the player: its own `level`, else from its height (the mezzanine deck is at 2.9 m). */
export const levelOf = (o: { level?: number } | null | undefined, y?: number): number => o?.level ?? ((y ?? 0) > 1.5 ? 1 : 0);
/** Zone display name ("Library", "Café"…); the code only if the layout gives no name. */
const zoneName = (z: Pick<Zone, 'id' | 'name'> | null | undefined): string => z?.name || z?.id || '';

/** World (x, z) → map px for a bounds/size. */
interface Xf { s: number; x(x: number): number; z(z: number): number; ix(px: number): number; iz(pz: number): number }
function makeXf(bounds: Layout['bounds'], W: number, H: number, pad: number): Xf {
  const bw = bounds.maxX - bounds.minX, bd = bounds.maxZ - bounds.minZ;
  const s = Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bd);
  const ox = (W - bw * s) / 2, oz = (H - bd * s) / 2;
  return { s, x: (x: number) => ox + (x - bounds.minX) * s, z: (z: number) => oz + (z - bounds.minZ) * s, ix: (px: number) => bounds.minX + (px - ox) / s, iz: (pz: number) => bounds.minZ + (pz - oz) / s };
}

/** Bake the static plan into a canvas 2D context. */
function bake(g: Ctx2D, layout: Layout, xf: Xf, W: number, H: number, big: boolean): void {
  g.clearRect(0, 0, W, H);
  const b = layout.bounds;
  // floor: a light wash over the graph paper (the paper's own ruling is the grid)
  g.fillStyle = INK.floor;
  roundRect(g, xf.x(b.minX), xf.z(b.minZ), (b.maxX - b.minX) * xf.s, (b.maxZ - b.minZ) * xf.s, 2);
  g.fill();
  // zones (hq): faint tint per zone rect, labelled on the big map
  const zones = layout.zones ?? [];
  if (zones.length > 1) {
    zones.filter((z) => (z.level ?? 0) === 0).forEach((z, i) => {
      g.fillStyle = i % 2 ? INK.zoneB : INK.zoneA;
      g.fillRect(xf.x(z.rect[0]), xf.z(z.rect[1]), (z.rect[2] - z.rect[0]) * xf.s, (z.rect[3] - z.rect[1]) * xf.s);
    });
  }
  // furniture (rugs first)
  const furn = [...(layout.furniture ?? [])].filter((f) => !SKIP.has(f.type) && (f.pos?.y ?? 0) < 1.5).sort((a, c) => (a.solid ? 1 : 0) - (c.solid ? 1 : 0));
  for (const f of furn) {
    const col = FURN[f.type] ?? (f.solid ? CORE.slate : null);
    if (!col) continue;
    const [w, , d] = f.size ?? [0.5, 0, 0.5];
    g.save();
    g.translate(xf.x(f.pos.x), xf.z(f.pos.z));
    g.rotate(-(f.yaw ?? 0));
    g.fillStyle = col;
    g.globalAlpha = f.solid ? (big ? 0.55 : 0.5) : (big ? 0.22 : 0.25);
    roundRect(g, (-w / 2) * xf.s, (-d / 2) * xf.s, w * xf.s, d * xf.s, Math.min(3, 0.12 * xf.s));
    g.fill();
    g.restore();
  }
  // walls (with door/window openings as gaps / light strokes)
  g.lineCap = 'round';
  for (const wl of layout.walls ?? []) {
    const [ax, az] = wl.a, [bx, bz] = wl.b;
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    const cuts = [...(wl.openings ?? [])].sort((p, q) => p.at - q.at);
    let t = 0;
    const seg = (t0: number, t1: number, color: string, lw: number) => {
      if (t1 - t0 < 0.01) return;
      g.strokeStyle = color; g.lineWidth = lw;
      g.beginPath();
      g.moveTo(xf.x(ax + ux * t0), xf.z(az + uz * t0));
      g.lineTo(xf.x(ax + ux * t1), xf.z(az + uz * t1));
      g.stroke();
    };
    const wallC = INK.wall, lw = big ? 3 : 1.8;
    for (const o of cuts) {
      const o0 = o.at - o.w / 2, o1 = o.at + o.w / 2;
      seg(t, o0, wallC, lw);
      if (o.kind === 'window') seg(o0, o1, INK.window, lw * 0.7);
      t = o1;
    }
    seg(t, len, wallC, lw);
  }
  // upper levels (the mezzanine over the Library): a stitched pencil outline inset from the walls below, hatched at
  // 45° (the plan convention for "overhead"), labelled "↑ Mezzanine" in the rooms' own sans
  const upper = zones.filter((z) => (z.level ?? 0) > 0);
  for (const z of upper) {
    const ins = big ? 0.35 : 0.3;
    const x0 = xf.x(z.rect[0] + ins), y0 = xf.z(z.rect[1] + ins), w = (z.rect[2] - z.rect[0] - 2 * ins) * xf.s, hh = (z.rect[3] - z.rect[1] - 2 * ins) * xf.s;
    g.save();
    g.beginPath(); g.rect(x0, y0, w, hh); g.clip();
    g.strokeStyle = INK.upperHatch;
    g.lineWidth = big ? 1 : 0.7;
    const step = big ? 9 : 5;
    g.beginPath();
    for (let t = -hh; t < w; t += step) { g.moveTo(x0 + t, y0 + hh); g.lineTo(x0 + t + hh, y0); }
    g.stroke();
    g.restore();
    g.save();
    g.setLineDash(big ? [5, 4] : [2.5, 2.5]);
    g.strokeStyle = INK.upper;
    g.lineWidth = big ? 1.4 : 0.9;
    g.strokeRect(x0, y0, w, hh);
    g.restore();
  }
  // zone names (big map only), by name, not code: horizontal along the top when it fits, else up the long side
  if (big && zones.length > 1) {
    g.font = '600 12px system-ui, sans-serif';
    g.textAlign = 'center';
    for (const z of zones) {
      const up = (z.level ?? 0) > 0;
      const text = up ? `↑ ${zoneName(z)}` : zoneName(z);
      const w = (z.rect[2] - z.rect[0]) * xf.s, hh = (z.rect[3] - z.rect[1]) * xf.s, tw = g.measureText(text).width;
      const cx = xf.x((z.rect[0] + z.rect[2]) / 2), cy = xf.z((z.rect[1] + z.rect[3]) / 2);
      // a paper halo keeps names readable over furniture; the deck's label sits mid-deck, clear of the room's
      const lab = (x: number, y: number) => { g.lineWidth = 3; g.strokeStyle = INK.halo; g.strokeText(text, x, y); g.fillStyle = INK.label; g.fillText(text, x, y); };
      if (tw + 10 <= w) lab(cx, up ? cy + 4 : xf.z(z.rect[1]) + 16);
      else if (tw + 10 <= hh && w >= 18) { g.save(); g.translate(cx + 4, cy); g.rotate(-Math.PI / 2); lab(0, 0); g.restore(); }
    }
  }
}

export interface MapLabel { id: string; x: number; y: number; wx: number; wz: number; r: number; text: string; isB: boolean; prio: number }
/** [x0, y0, x1, y1] */
type Box4 = [number, number, number, number];
/** A label placed on the overview: text-left x, baseline y, width, leader line?, and how many folded labels it carries. */
interface PlacedLabel { it: MapLabel; tx: number; ty: number; w: number; lead: boolean; more: number }
const LABEL_H = 13;
/** Candidate label anchors (text-left x, baseline y) around a dot of radius r, text width w, best first. */
function labelSpots(x: number, y: number, r: number, w: number): [number, number, boolean][] {
  const R = x + r + 4, L = x - r - 4 - w, C = x - w / 2;
  return [
    [R, y + 4, false], [L, y + 4, false], [C, y - r - 5, false], [C, y + r + 16, false],
    [R, y - 9, true], [R, y + 17, true], [L, y - 9, true], [L, y + 17, true],
    [R, y - 22, true], [R, y + 30, true], [L, y - 22, true], [L, y + 30, true],
  ];
}
const overlaps = (a: Box4, b: Box4): boolean => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/**
 * Overview label declutter (reviewer: ENG shells read 'dev dev· git tmp tmp·2'): greedy placement in priority order
 * (blocked, selected / hovered, agents, shells; then by id so it is stable frame to frame). Each label tries right,
 * left, above, below, then stacked offsets with a leader line; boxes avoid placed labels and every dot. A label with no
 * free spot folds into a "+N" count bubble on the nearest placed label within 0.8 m (hover still names each dot).
 * `measure` gives a text width in px.
 */
export function layoutLabels(items: MapLabel[], measure: (text: string) => number): PlacedLabel[] {
  const order = [...items].sort((a, b) => a.prio - b.prio || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const dots: Box4[] = items.map((d): Box4 => [d.x - d.r - 1, d.y - d.r - 1, d.x + d.r + 1, d.y + d.r + 4]);
  const boxes: Box4[] = [];
  const placed: PlacedLabel[] = [];
  const folded: MapLabel[] = [];
  for (const it of order) {
    const w = measure(it.text);
    let spot: { tx: number; ty: number; lead: boolean; box: Box4 } | null = null;
    for (const [tx, ty, lead] of labelSpots(it.x, it.y, it.r, w)) {
      const box: Box4 = [tx - 2, ty - 10, tx + w + 2, ty + 3];
      if (boxes.some((b) => overlaps(box, b))) continue;
      if (dots.some((b, i) => items[i] !== it && overlaps(box, b))) continue;
      spot = { tx, ty, lead, box };
      break;
    }
    if (!spot) { folded.push(it); continue; }
    boxes.push(spot.box);
    placed.push({ it, tx: spot.tx, ty: spot.ty, w, lead: spot.lead, more: 0 });
  }
  for (const it of folded) {
    let best: PlacedLabel | null = null, bd = 0.8 * 0.8;
    for (const p of placed) { const q = (p.it.wx - it.wx) ** 2 + (p.it.wz - it.wz) ** 2; if (q <= bd) { bd = q; best = p; } }
    if (!best) { // nothing close: fall back to the nearest placed label in screen space, else draw it anyway
      let sd = Infinity;
      for (const p of placed) { const q = (p.it.x - it.x) ** 2 + (p.it.y - it.y) ** 2; if (q < sd) { sd = q; best = p; } }
      if (!best || sd > 40 * 40) { placed.push({ it, tx: it.x + it.r + 4, ty: it.y + 4, w: measure(it.text), lead: false, more: 0 }); continue; }
    }
    best.more++;
  }
  // labels that grew a "+N" bubble: re-place them with the bubble's width so it does not land on a neighbour
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i];
    if (!p.more) continue;
    const bw = measure(`+${p.more}`) + 12;
    const others = placed.filter((q) => q !== p).map((q): Box4 => [q.tx - 2, q.ty - 10, q.tx + q.w + 2 + (q.more ? measure(`+${q.more}`) + 12 : 0), q.ty + 3]);
    for (const [tx, ty, lead] of labelSpots(p.it.x, p.it.y, p.it.r, p.w + bw)) {
      const box: Box4 = [tx - 2, ty - 10, tx + p.w + bw + 2, ty + 3];
      if (others.some((b) => overlaps(box, b)) || dots.some((b, k) => items[k] !== p.it && overlaps(box, b))) continue;
      p.tx = tx; p.ty = ty; p.lead = lead;
      break;
    }
  }
  return placed;
}

function placeLabels(gg: Ctx2D, items: MapLabel[]): void {
  gg.textAlign = 'left';
  const measure = (t: string) => { gg.font = '700 11px system-ui, sans-serif'; return gg.measureText(t).width; };
  for (const p of layoutLabels(items, measure)) {
    const { it, tx, ty, w } = p;
    if (p.lead) {
      gg.strokeStyle = INK.lead; gg.lineWidth = 1;
      const ex = tx > it.x ? tx - 2 : tx + w + 2;
      gg.beginPath(); gg.moveTo(it.x, it.y); gg.lineTo(ex, ty - 4); gg.stroke();
    }
    gg.font = `${it.isB || it.prio === 1 ? 700 : 600} 11px system-ui, sans-serif`;
    gg.lineWidth = 3; gg.strokeStyle = INK.halo;
    gg.strokeText(it.text, tx, ty);
    gg.fillStyle = it.isB ? INK.blocked : INK.name;
    gg.fillText(it.text, tx, ty);
    if (p.more) {
      const t = `+${p.more}`;
      gg.font = '700 10px system-ui, sans-serif';
      const bw = gg.measureText(t).width + 8, bx = tx + w + 4, by = ty - 10;
      gg.fillStyle = INK.bubble;
      roundRect(gg, bx, by, bw, 13, 3); gg.fill();
      gg.fillStyle = INK.bubbleTx;
      gg.fillText(t, bx + 4, ty);
    }
  }
}

function roundRect(g: Ctx2D, x: number, y: number, w: number, h2: number, r: number): void {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h2, r); else g.rect(x, y, w, h2);
}

/** What the minimap reads of the player controller. */
export interface MapPlayer { getPose(): PoseArr; level?: number }
export interface MinimapDeps {
  root: HTMLElement;
  layout: Layout;
  store: Pick<Store, 'entities'>;
  actors: { list(): ActorView[] } | null;
  player: () => MapPlayer | null | undefined;
  label?: (e: Entity) => string;
  hooks: {
    goTo(id: string): void; glideTo(x: number, z: number): void; selected(): string | null; followId(): string | null;
    opened(open: boolean): void; select(id: string): void;
  };
}
export interface Minimap {
  el: HTMLElement;
  readonly isOverview: boolean;
  update(now: number): void;
  overview(on?: boolean): void;
  layout(left: number, show: boolean): void;
  readonly height: number;
  project(x: number, z: number): { x: number; y: number };
}
interface OvDot { id: string; x: number; y: number; wx: number; wz: number; level: number }

export function createMinimap(d: MinimapDeps): Minimap {
  ensureHudCss();
  /** one display label per agent (names.ts: namesakes → 'claude · 2' on the map too, m2-r3 [ui]) */
  const nameOf = (e: Entity): string => d.label?.(e) || e.name || e.id;
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  const b = d.layout.bounds;
  const aspect = (b.maxZ - b.minZ) / (b.maxX - b.minX);
  const W = MINIMAP_PX, H = Math.round(Math.min(MINIMAP_PX, Math.max(96, MINIMAP_PX * aspect + 12)));
  const cv = h('canvas', { width: W * dpr, height: H * dpr, style: { width: `${W}px`, height: `${H}px` }, 'aria-hidden': 'true' });
  const base = document.createElement('canvas');
  base.width = W * dpr; base.height = H * dpr;
  const xf = makeXf(b, W, H, 8);
  const bg = ctx2d(base);
  bg.scale(dpr, dpr);
  bake(bg, d.layout, xf, W, H, false);
  const g = ctx2d(cv);
  // graph paper taped into a walnut frame; the small plaque on the frame names the zone you stand in
  const zone = plaque('', { small: true });
  zone.hidden = true;
  const el = h('div.hq-mini.k-frame', { role: 'button', tabindex: '-1', title: 'Office map (M)', 'aria-label': 'Minimap — open the office map (M)', style: { width: `${W + 14}px` }, onclick: () => api.overview(true) },
    h('div.k-graph', null, cv),
    h('span.tape', { style: { left: '-8px', top: '1px', transform: 'rotate(-32deg)' } }), h('span.tape', { style: { right: '-9px', top: '3px', transform: 'rotate(30deg)' } }),
    keycap('M', { small: true }), zone);
  el.addEventListener('mousedown', (ev) => ev.preventDefault());
  d.root.append(el);

  // ---- overview ----
  const ov = h('canvas');
  const ovBase = document.createElement('canvas');
  const tip = h('div.tip', { hidden: true });
  // key = what drawAgents draws (unknown too: the tally counts it, so its dot is explained here): agents are round status dots, shells square (prompt / running); then the one legend
  const key = h('div.lg', null, ...['blocked', 'working', 'done', 'idle', 'unknown', 'shell', 'busy'].map((s) => h('span.it', null, lamp(s, { label: '', still: true }), s === 'shell' ? 'shell' : s === 'busy' ? 'running' : s)),
    h('span.k-sp'), legend([{ key: ['M', '/', 'Esc'], label: 'close' }]), h('span', { text: 'click an agent to go there · the floor to walk' }));
  const ovCard = h('div.card.k-frame', null, h('div.k-graph.sheet', null,
    h('div.hd', null, plaque('Office map'), h('span.nm', { text: d.layout.id === 'hq' ? 'Claude HQ' : 'proto room' })), h('div.cv', null, ov, tip), key));
  const ovWrap = h('div.hq-map', { role: 'dialog', 'aria-label': 'Office map', tabindex: '-1' }, h('div.k-veil'), ovCard);
  ovWrap.addEventListener('mousedown', (ev) => { if (ev.target === ovWrap) api.overview(false); });
  ovWrap.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' || ev.code === 'KeyM') { ev.preventDefault(); ev.stopPropagation(); api.overview(false); }
  });
  d.root.append(ovWrap);
  let ovOpen = false;
  let ovXf: Xf = makeXf(b, W, H, 16), ovW = 0, ovH = 0;
  let hoverId: string | null = null;
  let ovDots: OvDot[] = [];
  // [PLY m3 fix r2, cross-owner] where each dot was over the last GO.trailMs: a click where an agent just was (it got
  // up and moved on) goes to it, not a floor walk onto the seat it left (reviewer m3-r2 29-map-dev-5)
  const trail = new Map<string, SeatMemo[]>();

  /** "Mezzanine" / "Library"…: the zone a dot stands in, on its own level. */
  const placeName = (dot: OvDot): string => {
    const id = d.layout.zoneAt?.(dot.wx, dot.wz, dot.level);
    const z = (d.layout.zones ?? []).find((q) => q.id === id);
    return z ? zoneName(z) : dot.level > 0 ? 'upstairs' : 'ground floor';
  };

  function sizeOverview() {
    const maxW = Math.min(innerWidth * 0.86, 1100), maxH = innerHeight * 0.72;
    const bw = b.maxX - b.minX, bd = b.maxZ - b.minZ;
    const s = Math.min(maxW / bw, maxH / bd);
    ovW = Math.round(bw * s + 32); ovH = Math.round(bd * s + 32);
    for (const c of [ov, ovBase]) { c.width = ovW * dpr; c.height = ovH * dpr; }
    ov.style.width = `${ovW}px`; ov.style.height = `${ovH}px`;
    // [UI fix r3] the sheet fits the plan: the legend wraps to the plan's width instead of widening the paper past it
    // (1280×720: a plan left-aligned in a sheet with ~190 px of empty grid on its right)
    key.style.maxWidth = `${ovW}px`;
    ovXf = makeXf(b, ovW, ovH, 16);
    const og = ctx2d(ovBase);
    og.setTransform(dpr, 0, 0, dpr, 0, 0);
    bake(og, d.layout, ovXf, ovW, ovH, true);
  }
  ov.addEventListener('mousemove', (ev) => {
    const r = ov.getBoundingClientRect();
    const px = ev.clientX - r.left, py = ev.clientY - r.top;
    let best: OvDot | null = null, bd2 = 14 * 14;
    for (const p of ovDots) { const q = (p.x - px) ** 2 + (p.y - py) ** 2; if (q < bd2) { bd2 = q; best = p; } }
    hoverId = best?.id ?? null;
    ov.style.cursor = hoverId ? 'pointer' : 'crosshair';
    const e = best ? d.store.entities.get(best.id) : undefined;
    if (!e || !best) { // the floor: which room is this (and what's upstairs)?
      const wx = ovXf.ix(px), wz = ovXf.iz(py);
      const zs = d.layout.zones ?? [];
      const at = (lvl: number) => zs.find((q) => q.id === d.layout.zoneAt?.(wx, wz, lvl) && (q.level ?? 0) === lvl);
      const z0 = at(0), z1 = at(1);
      tip.hidden = !z0 && !z1;
      if (!tip.hidden) {
        tip.textContent = [z0 && zoneName(z0), z1 && `↑ ${zoneName(z1)} above`].filter(Boolean).join(' · ');
        tip.style.left = `${px + 14}px`; tip.style.top = `${py - 10}px`;
      }
      return;
    }
    tip.hidden = false;
    {
      tip.textContent = `${nameOf(e)} · ${e.kind === 'shell' ? 'shell' : e.status} · ${placeName(best)}${e.status === 'blocked' && e.prompt?.question ? ` — ${firstQuestionLine(e.prompt.question)}` : ''}`;
      tip.style.left = `${best.x + 14}px`; tip.style.top = `${best.y - 10}px`;
    }
  });
  ov.addEventListener('mouseleave', () => { hoverId = null; tip.hidden = true; });
  ov.addEventListener('click', (ev) => {
    if (hoverId) { const id = hoverId; api.overview(false); d.hooks.goTo(id); return; }
    const r = ov.getBoundingClientRect();
    const x = ovXf.ix(ev.clientX - r.left), z = ovXf.iz(ev.clientY - r.top);
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return;
    api.overview(false);
    pruneIfGrown(trail, d.actors?.list?.() ?? []); // [UI fix r3]
    const tid = trailHit(trail, x, z, performance.now(), GO.trailPx / ovXf.s); // [PLY m3 fix r2, cross-owner]
    if (tid) { d.hooks.goTo(tid); return; }
    d.hooks.glideTo(x, z);
  });

  // ---- drawing ----
  function drawAgents(gg: Ctx2D, X: Xf, big: boolean, t: number): void {
    const sel = d.hooks.selected(), fol = d.hooks.followId();
    const list = d.actors?.list?.() ?? [];
    pruneIfGrown(trail, list);
    const r0 = big ? 6 : 3.2;
    if (big) ovDots = [];
    const labels: MapLabel[] = [];
    // non-blocked first so blocked sit on top
    for (let pass = 0; pass < 2; pass++) {
      for (const a of list) {
        const e = a.entity;
        if (!e || !a.pos) continue;
        const isB = e.status === 'blocked';
        if ((pass === 1) !== isB) continue;
        const x = X.x(a.pos.x), y = X.z(a.pos.z);
        const st = e.kind === 'shell' ? 'shell' : e.status;
        const c = stateColor(st, e);
        if (isB) {
          const k = (t % 1400) / 1400;
          gg.strokeStyle = INK.pulse((1 - k) * 0.9);
          gg.lineWidth = big ? 2.5 : 1.6;
          gg.beginPath(); gg.arc(x, y, r0 + 2 + k * (big ? 14 : 8), 0, Math.PI * 2); gg.stroke();
        }
        gg.fillStyle = c;
        gg.strokeStyle = INK.dotRim;
        gg.lineWidth = big ? 2 : 1;
        gg.beginPath();
        if (e.kind === 'shell') { gg.rect(x - r0 * 0.85, y - r0 * 0.85, r0 * 1.7, r0 * 1.7); } else gg.arc(x, y, isB ? r0 * 1.2 : r0, 0, Math.PI * 2);
        gg.fill(); gg.stroke();
        const lvl = levelOf(a, a.pos.y);
        if (lvl > 0) { // upstairs: a light halo ring (and "↑" on the overview label) so the deck never reads as the room below
          gg.strokeStyle = INK.upHalo;
          gg.lineWidth = big ? 1.6 : 1;
          gg.beginPath(); gg.arc(x, y, r0 + (big ? 3 : 1.8), 0, Math.PI * 2); gg.stroke();
        }
        if (a.id === sel || a.id === fol) {
          gg.strokeStyle = a.id === fol ? INK.follow : INK.sel;
          gg.lineWidth = big ? 2 : 1.4;
          gg.setLineDash(a.id === fol ? [3, 2] : []);
          gg.beginPath(); gg.arc(x, y, r0 + (big ? 5 : 3), 0, Math.PI * 2); gg.stroke();
          gg.setLineDash([]);
        }
        if (big) {
          ovDots.push({ id: a.id, x, y, wx: a.pos.x, wz: a.pos.z, level: lvl });
          trailNote(trail, a.id, a.pos.x, a.pos.z, performance.now()); // [PLY m3 fix r2, cross-owner]
          labels.push({ id: a.id, x, y, wx: a.pos.x, wz: a.pos.z, r: isB ? r0 * 1.2 : r0, text: `${isB ? '▲ ' : ''}${lvl > 0 ? '↑' : ''}${nameOf(e)}`, isB,
            prio: isB ? 0 : a.id === sel || a.id === fol || a.id === hoverId ? 1 : e.kind === 'shell' ? 3 : 2 });
        }
      }
    }
    if (big) placeLabels(gg, labels);
    // player: a view wedge + arrow
    const p = d.player();
    if (p) {
      const pose = p.getPose();
      const x = X.x(pose[0]), y = X.z(pose[2]);
      // forward = (−sin yaw, −cos yaw) in (x, z) → canvas angle
      const ang = Math.atan2(-Math.cos(pose[3]), -Math.sin(pose[3]));
      const R = big ? 60 : 26;
      const gr = gg.createRadialGradient(x, y, 0, x, y, R);
      gr.addColorStop(0, INK.wedge);
      gr.addColorStop(1, INK.wedge0);
      gg.fillStyle = gr;
      gg.beginPath(); gg.moveTo(x, y); gg.arc(x, y, R, ang - 0.52, ang + 0.52); gg.closePath(); gg.fill();
      gg.save();
      gg.translate(x, y); gg.rotate(ang);
      const s = big ? 9 : 5.5;
      gg.fillStyle = INK.player;
      gg.strokeStyle = INK.playerRim; gg.lineWidth = 1.2;
      gg.beginPath(); gg.moveTo(s, 0); gg.lineTo(-s * 0.7, s * 0.7); gg.lineTo(-s * 0.35, 0); gg.lineTo(-s * 0.7, -s * 0.7); gg.closePath();
      gg.fill(); gg.stroke();
      gg.restore();
      if (levelOf(p, pose[1]) > 0) { // you are on the mezzanine: ring the chevron + a "↑" badge
        gg.strokeStyle = INK.upHalo;
        gg.lineWidth = big ? 2 : 1.3;
        gg.beginPath(); gg.arc(x, y, s + (big ? 4 : 2.5), 0, Math.PI * 2); gg.stroke();
        const bx = x + s + (big ? 7 : 4), by = y - s - (big ? 7 : 4), br = big ? 7 : 4.5;
        gg.fillStyle = INK.upBadge;
        gg.beginPath(); gg.arc(bx, by, br, 0, Math.PI * 2); gg.fill();
        gg.fillStyle = INK.upBadgeTx;
        gg.font = `800 ${big ? 10 : 7}px system-ui, sans-serif`;
        gg.textAlign = 'center'; gg.textBaseline = 'middle';
        gg.fillText('↑', bx, by + 0.5);
        gg.textBaseline = 'alphabetic'; gg.textAlign = 'left';
      }
    }
  }

  let last = 0, zoneAt = -1e9;
  const api: Minimap = {
    el,
    get isOverview() { return ovOpen; },
    /** ≤ 20 Hz; cheap (a blit + ≤ 40 dots). */
    update(now: number) {
      if (now - last < 50) return;
      last = now;
      if (el.style.display !== 'none') {
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, cv.width, cv.height);
        g.drawImage(base, 0, 0);
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawAgents(g, xf, false, now);
        // the zone plaque follows the player (≤ 4 Hz)
        if (now - zoneAt > 250) {
          zoneAt = now;
          const pose = d.player()?.getPose?.();
          const id = pose ? d.layout.zoneAt?.(pose[0], pose[2], levelOf(d.player(), pose[1])) : null;
          const z = id ? (d.layout.zones ?? []).find((q) => q.id === id) : null;
          const t = z ? zoneName(z) : '';
          if (zone.textContent !== t) { zone.textContent = t; zone.hidden = !t; }
        }
      }
      if (ovOpen) {
        const og = ctx2d(ov);
        og.setTransform(1, 0, 0, 1, 0, 0);
        og.clearRect(0, 0, ov.width, ov.height);
        og.drawImage(ovBase, 0, 0);
        og.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawAgents(og, ovXf, true, now);
      }
    },
    overview(on?: boolean) {
      const want = on ?? !ovOpen;
      if (want === ovOpen) return;
      ovOpen = want;
      if (want) { sizeOverview(); last = 0; api.update(performance.now()); }
      ovWrap.classList.toggle('show', want);
      if (want) ovWrap.focus({ preventScroll: true });
      d.hooks.opened(want);
    },
    /** Place over the world strip (left inset = roster / rail); hidden when the strip is too narrow or fullscreen. */
    layout(left: number, show: boolean) {
      el.style.left = `${left + 22}px`;
      el.style.display = show ? '' : 'none';
    },
    /** the frame (H + 14) + its 22 px HUD inset − 14: ui/index.ts adds 22 and hud.layout 10 more, so tickets sit 18 px above */
    get height() { return H + 22; },
    /** For p2 / review: world → minimap px of an entity. */
    project: (x: number, z: number) => ({ x: xf.x(x), y: xf.z(z) }),
  };
  addEventListener('resize', () => { if (ovOpen) sizeOverview(); });
  return api;
}
