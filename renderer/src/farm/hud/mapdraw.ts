/**
 * Parchment map of the valley drawn on canvas from world/map.ts: a cached base (height-shaded land, contours,
 * river, pond, roads, landmarks) plus live layers (plot fields, farmer dots, the player arrow) drawn per frame.
 * Shared by the big map panel and the corner minimap.
 */
import type { FarmerView, HelperView, PlotView, ValleyState } from '../model/types.ts';
import type { Status } from '../../../../shared/protocol.ts';
import type { VillagerPin } from '../scene/context.ts';
import { heightAt, inSite, PATHS, POND, RIVER, RIVER_HALF_WIDTH, SITES, siteToWorld, STRUCTURES, WORLD, type StructureId } from '../world/map.ts';
import { KIND_ICON, iconImage } from './icons.ts';
import { fieldName, pinGlyph, shortName, STATUS_COLOR, WS_COLORS } from './format.ts';

/** the interesting part of the valley (what "fit" frames) */
export const BOUNDS = Object.freeze({ x0: -100, x1: 96, z0: -116, z1: 88 });
/** what the base raster covers: the whole world, so panning never shows blank paper */
const WB = Object.freeze({ x0: -150, x1: 150, z0: -150, z1: 150 });
/** base raster: pixels per metre */
const S = 5;
const GW = WB.x1 - WB.x0 + 1, GH = WB.z1 - WB.z0 + 1;

export interface View { cx: number; cz: number; /** css px per metre */ scale: number; w: number; h: number }
export interface Hit { id: string; kind: 'farmer' | 'helper' | 'plot'; sx: number; sy: number; r: number }
export interface XZ { x: number; z: number }
export interface DrawOpts {
  time: number;
  locate?: (id: string) => XZ | null;
  player?: { x: number; z: number; yaw: number } | null;
  hover?: string | null;
  mini?: boolean;
  /** the persistent villagers: little house-shaped role pins (never farmer dots, never clickable terminals) */
  villagers?: readonly VillagerPin[];
}

const KIND_FILL: Record<PlotView['kind'], string> = {
  wheat: '#ecd271', pumpkins: '#eaa55a', cabbages: '#a7d57f', sunflowers: '#f4d64e', orchard: '#94c56f', vineyard: '#b495d0',
  berries: '#dc8b98', chickens: '#eee0bd', cows: '#cbe19f', sheep: '#e1eccb', pigs: '#ecc1b3', bees: '#f1d77a',
};
const LABELS: Partial<Record<StructureId, string>> = {
  farmhouse: 'Farmhouse', barn: 'Barn', silo: 'Silo', windmill: 'Windmill', waterTower: 'Water tower', campfire: 'Campfire',
  bridge: 'Bridge', waterfall: 'Waterfall', pergola: 'Pergola', picnic: 'Picnic spot', lookout: 'Stargazers\' knoll', hotspring: 'Hot spring',
};

let base: HTMLCanvasElement | null = null;
// the 1 m height grid is sampled progressively in idle time (~90k samples ≈ 170 ms of CPU in total)
const H = new Float32Array(GW * GH);
let rowsDone = 0;
function sampleRows(budgetMs: number): boolean {
  const t0 = performance.now();
  while (rowsDone < GH) {
    const z = WB.z0 + rowsDone;
    for (let i = 0; i < GW; i++) H[rowsDone * GW + i] = heightAt(WB.x0 + i, z);
    rowsDone++;
    if (performance.now() - t0 > budgetMs) break;
  }
  return rowsDone >= GH;
}
/** Start sampling the map heights in idle time so the first map open is instant. */
export function warmBase(): void {
  type Idle = (cb: (d: { timeRemaining(): number }) => void, o?: { timeout: number }) => number;
  const ric = (window as unknown as { requestIdleCallback?: Idle }).requestIdleCallback;
  const step = (d?: { timeRemaining(): number }) => {
    if (base) return;
    if (sampleRows(Math.max(2, Math.min(8, d ? d.timeRemaining() - 1 : 4)))) { getBase(); return; }
    if (ric) ric(step, { timeout: 1000 }); else setTimeout(() => step(), 16);
  };
  if (ric) ric(step, { timeout: 3000 }); else setTimeout(() => step(), 500);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mix = (c1: number[], c2: number[], t: number) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Marching squares: contour segments of level L on the height grid, in base-canvas pixels. */
function contour(path: Path2D, L: number): void {
  const at = (i: number, j: number) => H[j * GW + i];
  for (let j = 0; j < GH - 1; j++) for (let i = 0; i < GW - 1; i++) {
    const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
    const k = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (c > L ? 2 : 0) | (d > L ? 1 : 0);
    if (k === 0 || k === 15) continue;
    const t = (p: number, q: number) => (L - p) / (q - p);
    const top = () => [(i + t(a, b)) * S, j * S], right = () => [(i + 1) * S, (j + t(b, c)) * S];
    const bottom = () => [(i + t(d, c)) * S, (j + 1) * S], left = () => [i * S, (j + t(a, d)) * S];
    const seg = (p: number[], q: number[]) => { path.moveTo(p[0], p[1]); path.lineTo(q[0], q[1]); };
    switch (k) {
      case 1: case 14: seg(left(), bottom()); break;
      case 2: case 13: seg(bottom(), right()); break;
      case 3: case 12: seg(left(), right()); break;
      case 4: case 11: seg(top(), right()); break;
      case 5: seg(left(), top()); seg(bottom(), right()); break;
      case 6: case 9: seg(top(), bottom()); break;
      case 7: case 8: seg(left(), top()); break;
      case 10: seg(left(), bottom()); seg(top(), right()); break;
    }
  }
}

/** Build (once) the static parchment base. */
export function getBase(): HTMLCanvasElement {
  if (base) return base;
  sampleRows(Infinity);
  const at = (i: number, j: number) => H[Math.min(GH - 1, Math.max(0, j)) * GW + Math.min(GW - 1, Math.max(0, i))];
  // 1 px per metre colour raster, upscaled with smoothing
  const small = document.createElement('canvas');
  small.width = GW; small.height = GH;
  const sg = small.getContext('2d')!;
  const img = sg.createImageData(GW, GH);
  const PARCH = [241, 226, 189];
  const MEADOW = [181, 206, 128], MEADOW2 = [156, 188, 106], HILL = [178, 170, 120], ROCK = [190, 172, 142], PEAK = [232, 224, 204];
  const WATER = [126, 184, 214], DEEP = [88, 150, 196];
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const hgt = at(i, j);
    const dx = (at(i + 1, j) - at(i - 1, j)) / 2, dz = (at(i, j + 1) - at(i, j - 1)) / 2;
    const shade = clamp01(0.62 + (-dx * 0.7 - dz * 0.7) * 0.22);
    let c: number[];
    if (hgt < WORLD.water - 0.05) c = mix(WATER, DEEP, clamp01((WORLD.water - hgt) / 3));
    else if (hgt < 3) c = mix(MEADOW, MEADOW2, clamp01(hgt / 3));
    else if (hgt < 10) c = mix(MEADOW2, HILL, clamp01((hgt - 3) / 7));
    else if (hgt < 26) c = mix(HILL, ROCK, clamp01((hgt - 10) / 16));
    else c = mix(ROCK, PEAK, clamp01((hgt - 26) / 18));
    if (hgt >= WORLD.water - 0.05) c = c.map((v) => v * (0.72 + shade * 0.5));
    c = mix(c, PARCH, 0.28);
    const o = (j * GW + i) * 4;
    img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
  }
  sg.putImageData(img, 0, 0);
  const cv = document.createElement('canvas');
  cv.width = (GW - 1) * S; cv.height = (GH - 1) * S;
  const g = cv.getContext('2d')!;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(small, 0, 0, GW, GH, -S / 2, -S / 2, GW * S, GH * S);
  // contour lines (smooth, anti-aliased): every 3 m, stronger every 15 m
  const thin = new Path2D(), bold = new Path2D();
  for (let L = 0; L < 90; L += 3) contour(L % 15 === 0 ? bold : thin, L + 0.01);
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = 'rgba(120, 84, 48, .22)'; g.lineWidth = 1.2; g.stroke(thin);
  g.strokeStyle = 'rgba(120, 84, 48, .42)'; g.lineWidth = 2; g.stroke(bold);
  const P = (x: number, z: number): [number, number] => [(x - WB.x0) * S, (z - WB.z0) * S];
  const line = (pts: readonly XZ[]) => { g.beginPath(); pts.forEach((p, k) => { const [x, y] = P(p.x, p.z); if (k) g.lineTo(x, y); else g.moveTo(x, y); }); };
  g.lineCap = 'round'; g.lineJoin = 'round';
  // river
  line(RIVER);
  g.strokeStyle = '#4f89b8'; g.lineWidth = (RIVER_HALF_WIDTH * 2 + 1.2) * S; g.stroke();
  g.strokeStyle = '#8cc4e4'; g.lineWidth = RIVER_HALF_WIDTH * 2 * S; g.stroke();
  g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1.2 * S; g.setLineDash([3 * S, 4 * S]); g.stroke(); g.setLineDash([]);
  // pond
  const [px, py] = P(POND.x, POND.z);
  g.beginPath(); g.arc(px, py, POND.r * S, 0, Math.PI * 2);
  g.fillStyle = '#8cc4e4'; g.fill(); g.strokeStyle = '#4f89b8'; g.lineWidth = 0.7 * S; g.stroke();
  g.beginPath(); g.arc(px - 2 * S, py - 2 * S, POND.r * 0.45 * S, Math.PI * 1.1, Math.PI * 1.6); g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 0.5 * S; g.stroke();
  // roads
  for (const p of PATHS) { line(p.points); g.strokeStyle = '#a57c4d'; g.lineWidth = (p.width + 0.9) * S; g.stroke(); }
  for (const p of PATHS) { line(p.points); g.strokeStyle = '#e4c894'; g.lineWidth = p.width * S; g.stroke(); }
  // landmarks: footprints
  for (const s of STRUCTURES) {
    const [x, y] = P(s.x, s.z);
    g.save(); g.translate(x, y); g.rotate(-s.yaw);
    const w = s.size[0] * S, d = s.size[1] * S;
    const fill = s.id === 'barn' ? '#c9573f' : s.id === 'farmhouse' ? '#e0a26a' : s.id === 'dock' || s.id === 'bridge' ? '#b8864f'
      : s.id === 'waterfall' || s.id === 'hotspring' ? '#a9d4ef' : s.id === 'picnic' ? '#d86a5a' : s.id === 'campfire' ? '#e8742c' : s.id === 'silo' || s.id === 'waterTower' ? '#cfd6dc' : '#c8955a';
    g.fillStyle = fill; g.strokeStyle = '#4a2f19'; g.lineWidth = 0.35 * S;
    if (s.id === 'silo' || s.id === 'waterTower' || s.id === 'well' || s.id === 'campfire' || s.id === 'hotspring' || s.id === 'lookout') { g.beginPath(); g.arc(0, 0, Math.min(w, d) / 2.4, 0, Math.PI * 2); g.fill(); g.stroke(); }
    else if (s.id === 'windmill') {
      g.beginPath(); g.arc(0, 0, w / 4, 0, Math.PI * 2); g.fill(); g.stroke();
      g.lineWidth = 0.9 * S; g.beginPath(); g.moveTo(-w / 1.6, 0); g.lineTo(w / 1.6, 0); g.moveTo(0, -w / 1.6); g.lineTo(0, w / 1.6); g.stroke();
    } else {
      g.fillRect(-w / 2, -d / 2, w, d); g.strokeRect(-w / 2, -d / 2, w, d);
      if (s.id === 'farmhouse' || s.id === 'barn' || s.id === 'toolshed') { g.beginPath(); g.moveTo(-w / 2, 0); g.lineTo(w / 2, 0); g.stroke(); }
    }
    g.restore();
  }
  // landmark names are drawn live (drawValley), so they can dodge farmer pins and field signs
  base = cv;
  return cv;
}

function rose(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.save(); g.translate(x, y);
  g.fillStyle = 'rgba(248,238,214,.8)'; g.beginPath(); g.arc(0, 0, r * 1.1, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#4a2f19'; g.lineWidth = r * 0.06; g.stroke();
  for (let k = 0; k < 4; k++) {
    g.rotate(Math.PI / 2);
    g.beginPath(); g.moveTo(0, -r); g.lineTo(r * 0.22, 0); g.lineTo(-r * 0.22, 0); g.closePath();
    g.fillStyle = k === 3 ? '#c0392b' : '#6e4a2a'; g.fill();
  }
  g.fillStyle = '#4a2f19'; g.font = `700 ${r * 0.5}px Georgia, "DejaVu Serif", serif`; g.textAlign = 'center'; g.textBaseline = 'bottom';
  g.fillText('N', 0, -r * 1.05);
  g.restore();
}

/** Fit the whole valley into a w×h box. */
export function fitView(w: number, h: number): View {
  const scale = Math.min(w / (BOUNDS.x1 - BOUNDS.x0), h / (BOUNDS.z1 - BOUNDS.z0));
  return { cx: (BOUNDS.x0 + BOUNDS.x1) / 2, cz: (BOUNDS.z0 + BOUNDS.z1) / 2, scale, w, h };
}
/** Fit what matters: the village hub, every tilled field and the player (padded), never tighter than ~110 m. */
export function fitContent(w: number, h: number, s: ValleyState | null, player?: XZ | null): View {
  let x0 = -38, x1 = 62, z0 = -34, z1 = 46; // farmhouse, barn, windmill, pond
  const add = (x: number, z: number, pad: number) => { x0 = Math.min(x0, x - pad); x1 = Math.max(x1, x + pad); z0 = Math.min(z0, z - pad); z1 = Math.max(z1, z + pad); };
  for (const p of s?.plots.values() ?? []) { const site = SITES[p.site]; if (site) add(site.x, site.z, 16); }
  if (player) add(player.x, player.z, 10);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const scale = Math.min(w / Math.max(110, x1 - x0), h / Math.max(110, z1 - z0));
  return { cx, cz, scale, w, h };
}
export const toScreen = (v: View, x: number, z: number): [number, number] => [(x - v.cx) * v.scale + v.w / 2, (z - v.cz) * v.scale + v.h / 2];
export const toWorld = (v: View, sx: number, sy: number): XZ => ({ x: (sx - v.w / 2) / v.scale + v.cx, z: (sy - v.h / 2) / v.scale + v.cz });

/** Where to draw a farmer/helper: its live position if the scene publishes one, else its work spot in its field. */
export function paneSpot(s: ValleyState, p: FarmerView | HelperView, locate?: (id: string) => XZ | null, helper = false): XZ | null {
  const live = locate?.(p.id);
  if (live) return live;
  const plot = s.plots.get(p.plotId);
  const site = plot ? SITES[plot.site] : undefined;
  if (!site) return null;
  const n = helper ? plot!.helpers.length : plot!.farmers.length;
  const lx = (p.spot - (n - 1) / 2) * 3.2;
  return siteToWorld(site, lx, helper ? site.d * 0.3 : -1);
}

/** Draw everything; returns hit targets in css px. */
export function drawValley(g: CanvasRenderingContext2D, v: View, s: ValleyState | null, o: DrawOpts): Hit[] {
  const hits: Hit[] = [];
  // the minimap never forces the (one-off, ~100 ms) base build; it shows plain parchment until warmBase() is done
  const b = o.mini && !base ? null : getBase();
  g.fillStyle = '#e8d5a8';
  g.fillRect(0, 0, v.w, v.h);
  if (b) {
    // draw only the visible part of the base (cheap for the minimap)
    const tl = toWorld(v, 0, 0), br = toWorld(v, v.w, v.h);
    const sx0 = Math.max(0, (tl.x - WB.x0) * S), sy0 = Math.max(0, (tl.z - WB.z0) * S);
    const sx1 = Math.min(b.width, (br.x - WB.x0) * S), sy1 = Math.min(b.height, (br.z - WB.z0) * S);
    if (sx1 > sx0 && sy1 > sy0) {
      const [dx0, dy0] = toScreen(v, WB.x0 + sx0 / S, WB.z0 + sy0 / S);
      const [dx1, dy1] = toScreen(v, WB.x0 + sx1 / S, WB.z0 + sy1 / S);
      g.imageSmoothingEnabled = true;
      g.drawImage(b, sx0, sy0, sx1 - sx0, sy1 - sy0, dx0, dy0, dx1 - dx0, dy1 - dy0);
    }
  }
  if (!s) return hits;
  const mini = !!o.mini;
  const placed: [number, number, number, number][] = [];
  // ---- plots ----
  for (const plot of s.plots.values()) {
    const site = SITES[plot.site];
    if (!site) continue;
    const [x, y] = toScreen(v, site.x, site.z);
    const w = site.w * v.scale, d = site.d * v.scale;
    const fallow = plot.stage === 'fallow' || plot.stage === 'harvest';
    g.save(); g.translate(x, y); g.rotate(-site.yaw);
    g.fillStyle = fallow ? 'rgba(170, 150, 120, .55)' : KIND_FILL[plot.kind];
    g.globalAlpha = fallow ? 0.8 : plot.stage === 'resting' ? 0.75 : 0.92;
    g.fillRect(-w / 2, -d / 2, w, d);
    g.globalAlpha = 1;
    if (!fallow && !mini) {
      // crop rows
      g.strokeStyle = 'rgba(80, 55, 25, .22)'; g.lineWidth = Math.max(1, v.scale * 0.25);
      g.beginPath();
      for (let r = -d / 2 + d / 8; r < d / 2; r += d / 7) { g.moveTo(-w / 2 + 3, r); g.lineTo(w / 2 - 3, r); }
      g.stroke();
    }
    g.strokeStyle = fallow ? '#8a7a64' : WS_COLORS[plot.colorIndex % WS_COLORS.length];
    g.lineWidth = Math.max(1.5, v.scale * (mini ? 0.5 : 0.45));
    if (fallow) g.setLineDash([4, 4]);
    g.strokeRect(-w / 2, -d / 2, w, d);
    g.setLineDash([]);
    if (plot.status === 'blocked' && !fallow) {
      const a = 0.35 + 0.35 * Math.sin(o.time * 5);
      g.strokeStyle = `rgba(240, 167, 44, ${a})`; g.lineWidth = Math.max(3, v.scale * 1.1);
      g.strokeRect(-w / 2 - 3, -d / 2 - 3, w + 6, d + 6);
    }
    g.restore();
    if (o.hover === plot.id) { g.save(); g.translate(x, y); g.rotate(-site.yaw); g.strokeStyle = '#fff'; g.lineWidth = 3; g.strokeRect(-w / 2 - 2, -d / 2 - 2, w + 4, d + 4); g.restore(); }
    hits.push({ id: plot.id, kind: 'plot', sx: x, sy: y, r: Math.min(w, d) / 2 });
    if (!mini) {
      const ic = iconImage(KIND_ICON[plot.kind]);
      const fs = Math.max(11, Math.min(15, v.scale * 2.2));
      g.font = `700 ${fs}px Georgia, "DejaVu Serif", serif`;
      g.textAlign = 'left'; g.textBaseline = 'middle';
      const label = fallow ? `${plot.label} · fallow` : plot.label;
      const isz = fs + 5;
      const tw = g.measureText(label).width + isz + 4;
      const ly = y + Math.max(w, d) / 2 * 0.8 + fs;
      g.fillStyle = fallow ? 'rgba(120,100,80,.85)' : 'rgba(110, 74, 42, .94)';
      roundRect(g, x - tw / 2 - 6, ly - fs / 2 - 4, tw + 12, fs + 8, 6); g.fill();
      placed.push([x - tw / 2 - 6, ly - fs / 2 - 4, x + tw / 2 + 6, ly + fs / 2 + 4]);
      g.strokeStyle = 'rgba(40,20,5,.6)'; g.lineWidth = 1; g.stroke();
      if (ic.complete && ic.naturalWidth) { g.globalAlpha = fallow ? 0.6 : 1; g.drawImage(ic, x - tw / 2, ly - isz / 2, isz, isz); g.globalAlpha = 1; }
      g.fillStyle = '#fff6e0'; g.fillText(label, x - tw / 2 + isz + 4, ly + 0.5);
    }
  }
  // ---- helpers (scarecrows): tiny crosses ----
  if (!mini) {
    for (const hp of s.helpers.values()) {
      const p = paneSpot(s, hp, o.locate, true);
      if (!p) continue;
      const [x, y] = toScreen(v, p.x, p.z);
      g.strokeStyle = '#6e4a2a'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x - 5, y - 2); g.lineTo(x + 5, y - 2); g.moveTo(x, y - 7); g.lineTo(x, y + 6); g.stroke();
      g.fillStyle = hp.running ? '#ffd23f' : hp.exit === 'fail' ? '#d0584a' : '#b8a888';
      g.beginPath(); g.arc(x, y - 7, 3, 0, Math.PI * 2); g.fill(); g.stroke();
      hits.push({ id: hp.id, kind: 'helper', sx: x, sy: y, r: 8 });
    }
  }
  // ---- villagers: house-shaped role pins in their own colours, names in italic serif (under the farmers) ----
  if (o.villagers) {
    const pr = mini ? 5 : Math.max(9, Math.min(12, v.scale * 1.4));
    for (const vp of o.villagers) {
      if (vp.inside && mini) continue;
      const [x, y] = toScreen(v, vp.x, vp.z);
      if (x < -20 || y < -20 || x > v.w + 20 || y > v.h + 20) continue;
      g.globalAlpha = vp.inside ? 0.55 : 1;
      g.beginPath();
      g.moveTo(x, y - pr * 1.25); g.lineTo(x + pr, y - pr * 0.25); g.lineTo(x + pr, y + pr); g.lineTo(x - pr, y + pr); g.lineTo(x - pr, y - pr * 0.25); g.closePath();
      g.fillStyle = vp.color; g.fill();
      g.strokeStyle = '#f0d696'; g.lineWidth = mini ? 1.2 : 2; g.stroke();
      if (!mini) {
        g.fillStyle = '#fff8e6';
        g.font = `700 ${Math.round(pr * 1.15)}px "DejaVu Sans", sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(vp.glyph, x, y + pr * 0.25);
        const label = vp.inside ? `${vp.name} (home)` : vp.name;
        g.font = `italic 600 11px Georgia, "DejaVu Serif", serif`;
        const tw = g.measureText(label).width + 8;
        const ly = y + pr + 9;
        const box: [number, number, number, number] = [x - tw / 2, ly - 7, x + tw / 2, ly + 7];
        if (!placed.some((q) => box[0] < q[2] && box[2] > q[0] && box[1] < q[3] && box[3] > q[1])) {
          placed.push(box);
          g.fillStyle = 'rgba(52, 96, 70, .88)';
          roundRect(g, box[0], box[1], tw, 14, 4); g.fill();
          g.fillStyle = '#fff3d6'; g.fillText(label, x, ly + 0.5);
        }
      }
      g.globalAlpha = 1;
    }
  }
  // ---- farmers: screen positions, relaxed apart so clustered dots stay clickable ----
  const r = mini ? 5 : Math.max(8, Math.min(12, v.scale * 1.4));
  const dots: { f: FarmerView; x: number; y: number; home: boolean }[] = [];
  for (const f of s.farmers.values()) {
    const p = paneSpot(s, f, o.locate);
    if (!p) continue;
    const [x, y] = toScreen(v, p.x, p.z);
    const pl = s.plots.get(f.plotId), site = pl ? SITES[pl.site] : undefined;
    dots.push({ f, x, y, home: !!site && inSite(site, p.x, p.z, 3) });
  }
  const gap = r * 2 + (mini ? 1 : 3);
  for (let it = 0; it < 8; it++) {
    let moved = false;
    for (let i = 0; i < dots.length; i++) for (let j = i + 1; j < dots.length; j++) {
      const A = dots[i], B = dots[j];
      let dx = B.x - A.x, dy = B.y - A.y;
      let dd = Math.hypot(dx, dy);
      if (dd >= gap) continue;
      if (dd < 0.01) { dx = 1; dy = 0; dd = 1; }
      const push = (gap - dd) / 2 / dd;
      A.x -= dx * push; A.y -= dy * push; B.x += dx * push; B.y += dy * push;
      moved = true;
    }
    if (!moved) break;
  }
  dots.sort((a, b2) => Number(a.f.needsYou) - Number(b2.f.needsYou));
  for (const { f, x, y } of dots) {
    if (x < -20 || y < -20 || x > v.w + 20 || y > v.h + 20) continue;
    const col = STATUS_COLOR[f.status as Status] ?? '#999';
    const hot = o.hover === f.id;
    if (f.needsYou) {
      const ph = (o.time * 1.2) % 1;
      g.strokeStyle = `rgba(240, 167, 44, ${1 - ph})`; g.lineWidth = mini ? 2 : 3;
      g.beginPath(); g.arc(x, y, r + 2 + ph * r * 1.6, 0, Math.PI * 2); g.stroke();
    }
    g.fillStyle = 'rgba(40,25,10,.35)'; g.beginPath(); g.ellipse(x + 1, y + r * 0.85, r * 0.9, r * 0.4, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = col; g.strokeStyle = hot ? '#fff' : '#3b2a1e'; g.lineWidth = hot ? 3 : mini ? 1.5 : 2;
    g.beginPath(); g.arc(x, y, hot ? r + 2 : r, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = f.needsYou ? '#3a2400' : '#fff';
    g.font = `800 ${Math.round(r * (mini ? 1.5 : 1.2))}px ui-rounded, "DejaVu Sans", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (!mini || f.needsYou) g.fillText(f.needsYou ? '!' : f.unseenDone ? '✓' : pinGlyph(f), x, y + 0.5);
    hits.push({ id: f.id, kind: 'farmer', sx: x, sy: y, r: r + 4 });
  }
  if (!mini) {
    // names: greedy, most important first, skipped when they would collide (with each other and field signs)
    const pri = (d: { f: FarmerView }) => (o.hover === d.f.id ? 0 : d.f.needsYou ? 1 : d.f.unseenDone ? 2 : 3);
    g.font = `700 12px ui-rounded, "DejaVu Sans", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const d of [...dots].sort((a, b2) => pri(a) - pri(b2))) {
      const nm = d.home ? fieldName(d.f) : shortName(d.f); // in its field the sign names the project; away from it, the full tag
      const tw = g.measureText(nm).width + 8;
      const cands: [number, number][] = [[d.x, d.y - r - 10], [d.x + r + tw / 2 + 2, d.y], [d.x - r - tw / 2 - 2, d.y], [d.x, d.y + r + 10]];
      const spot = cands.find(([cx, cy]) => {
        const box: [number, number, number, number] = [cx - tw / 2, cy - 8, cx + tw / 2, cy + 8];
        if (box[0] < 2 || box[1] < 2 || box[2] > v.w - 2 || box[3] > v.h - 2) return false;
        const hitsDot = dots.some((o2) => o2 !== d && o2.x + r > box[0] && o2.x - r < box[2] && o2.y + r > box[1] && o2.y - r < box[3]);
        return !hitsDot && !placed.some((q) => box[0] < q[2] && box[2] > q[0] && box[1] < q[3] && box[3] > q[1]);
      });
      if (!spot) continue;
      const [cx, cy] = spot;
      placed.push([cx - tw / 2, cy - 8, cx + tw / 2, cy + 8]);
      g.fillStyle = d.f.needsYou ? 'rgba(255, 227, 138, .95)' : 'rgba(255, 250, 240, .92)';
      roundRect(g, cx - tw / 2, cy - 8, tw, 16, 5); g.fill();
      g.strokeStyle = 'rgba(59,42,30,.35)'; g.lineWidth = 1; g.stroke();
      g.fillStyle = '#3b2a1e'; g.fillText(nm, cx, cy + 0.5);
    }
  }
  if (!mini) landmarkLabels(g, v, placed, dots, r);
  // ---- player ----
  if (o.player) {
    const [x, y] = toScreen(v, o.player.x, o.player.z);
    const fx = -Math.sin(o.player.yaw), fz = -Math.cos(o.player.yaw);
    const ang = Math.atan2(fz, fx);
    const R = mini ? 9 : 12;
    g.save(); g.translate(x, y); g.rotate(ang + Math.PI / 2);
    if (!mini) { g.fillStyle = 'rgba(255, 255, 255, .25)'; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R * 4, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); g.closePath(); g.fill(); }
    g.beginPath(); g.moveTo(0, -R); g.lineTo(R * 0.72, R * 0.8); g.lineTo(0, R * 0.4); g.lineTo(-R * 0.72, R * 0.8); g.closePath();
    g.fillStyle = '#d0584a'; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2.2; g.stroke();
    g.restore();
  }
  if (!mini) {
    rose(g, v.w - 44, 46, 26);
    const vg = g.createRadialGradient(v.w / 2, v.h / 2, Math.min(v.w, v.h) * 0.45, v.w / 2, v.h / 2, Math.hypot(v.w, v.h) * 0.6);
    vg.addColorStop(0, 'rgba(120,80,30,0)'); vg.addColorStop(1, 'rgba(110,70,25,.38)');
    g.fillStyle = vg; g.fillRect(0, 0, v.w, v.h);
  }
  return hits;
}

/** Landmark names in italic serif, quietly: each one only where it hits no field sign, pin, name or farmer dot. */
function landmarkLabels(g: CanvasRenderingContext2D, v: View, placed: [number, number, number, number][], dots: readonly { x: number; y: number }[], r: number): void {
  const fs = Math.round(Math.max(11, Math.min(16, v.scale * 2.6)));
  g.font = `italic 700 ${fs}px Georgia, "DejaVu Serif", serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round';
  const items: { text: string; x: number; z: number; off: number; ink: string }[] = [];
  for (const st of STRUCTURES) {
    const lab = LABELS[st.id];
    if (lab) items.push({ text: lab, x: st.x, z: st.z, off: Math.max(st.size[0], st.size[1]) * 0.55, ink: '#4a2f19' });
  }
  items.push({ text: 'Pond', x: POND.x, z: POND.z, off: 0, ink: '#23577f' });
  for (const it of items) {
    const [x, y0] = toScreen(v, it.x, it.z);
    if (x < -60 || x > v.w + 60 || y0 < -30 || y0 > v.h + 30) continue;
    const tw = g.measureText(it.text).width;
    const below = y0 + it.off * v.scale + fs * 0.7 + 2;
    // under the footprint first, then above it, then centred on it
    for (const y of [below, y0 - it.off * v.scale - fs * 0.7 - 2, y0]) {
      const box: [number, number, number, number] = [x - tw / 2 - 3, y - fs / 2 - 1, x + tw / 2 + 3, y + fs / 2 + 1];
      if (box[0] < 4 || box[1] < 4 || box[2] > v.w - 4 || box[3] > v.h - 4) continue;
      if (placed.some((q) => box[0] < q[2] && box[2] > q[0] && box[1] < q[3] && box[3] > q[1])) continue;
      if (dots.some((d) => d.x + r > box[0] && d.x - r < box[2] && d.y + r > box[1] && d.y - r < box[3])) continue;
      placed.push(box);
      g.lineWidth = 3.5; g.strokeStyle = 'rgba(248,238,214,.92)'; g.strokeText(it.text, x, y);
      g.fillStyle = it.ink; g.fillText(it.text, x, y);
      break;
    }
  }
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/** Nearest hit within its radius (farmers win over helpers over plots). */
export function hitTest(hits: readonly Hit[], x: number, y: number): Hit | null {
  let best: Hit | null = null, bestD = Infinity;
  const pri = { farmer: 0, helper: 1, plot: 2 } as const;
  for (const hh of hits) {
    const d = Math.hypot(hh.sx - x, hh.sy - y);
    if (d > hh.r) continue;
    const score = pri[hh.kind] * 1000 + d;
    if (score < bestD) { bestD = score; best = hh; }
  }
  return best;
}
