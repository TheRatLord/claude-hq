/**
 * The valley map, drawn on canvas: the cached parchment base (mapbase.ts: painted once in idle time) blitted for the
 * current view, then the live layers on top: tilled fields, hint washes (forage areas, wildlife habitats), place tiles
 * (store, mailbox, yard, nooks, fishing, lookouts), the festival rosette, request hearts, scarecrows, villagers,
 * farmers, labels, the player arrow, and (big map only) the chart furniture: title cartouche, compass rose, scale bar
 * and a deckled, vignetted edge (cached per size). Shared by the big map panel and the corner minimap. Pin shapes and
 * colours: mappins.ts.
 */
import type { FarmerView, HelperView, PlotView, Season, ValleyState } from '../model/types.ts';
import type { Status } from '../../../../shared/protocol.ts';
import type { VillagerPin } from '../scene/context.ts';
import { inSite, POND, SITES, siteToWorld, STRUCTURES, type StructureId } from '../world/map.ts';
import { KIND_ICON, iconImage } from './icons.ts';
import { fieldName, pinGlyph, shortName, WS_COLORS } from './format.ts';
import { STATUS_SHAPE, statusColor } from '../model/prefs.ts';
import { getBase, getHalf, baseReady, roundRectPath, S, WB, worldPois } from './mapbase.ts';
import { FISH_SPOTS, HABITATS, heart, PIN_COLOR, PLACES, projectTile, rosette, tile, TIME_SHORT, type Glyph, type ProjectPin } from './mappins.ts';

export { roundRectPath as roundRect } from './mapbase.ts';
export { warmBase } from './mapbase.ts';

/** the interesting part of the valley (what "fit" frames) */
export const BOUNDS = Object.freeze({ x0: -100, x1: 96, z0: -116, z1: 88 });

export interface View { cx: number; cz: number; /** css px per metre */ scale: number; w: number; h: number }
export interface Hit { id: string; kind: 'farmer' | 'helper' | 'plot' | 'place'; sx: number; sy: number; r: number; /** places: the tooltip */ tip?: { title: string; lines: string[] } }
export interface XZ { x: number; z: number }

/** Optional map layers (toggled in the panel; the minimap follows `requests`). */
export interface MapLayers { places: boolean; requests: boolean; forage: boolean; wildlife: boolean }
export const DEFAULT_LAYERS: MapLayers = Object.freeze({ places: true, requests: true, forage: false, wildlife: false });

/** Live extras gathered by the HUD from its bindings (a few times a second, not per frame). */
export interface MapExtras {
  season: Season;
  /** the General store cart (the yard service), null until the scene places it */
  store: (XZ & { yaw: number }) | null;
  unread: number;
  /** today's open villager requests */
  requests: readonly { id: string; who: string; place?: string; placeName?: string; name: string; text: string; next: string; ready: boolean }[];
  /** today's unpicked forageables (only their rough area is ever drawn) */
  forage: readonly { key: string; x: number; z: number; habitat: string }[];
  forageLeft: number;
  /** wildlife: id → out right now */
  wildOut: Readonly<Record<string, boolean>>;
  /** field-guide entries (model/collection.ts SIGHTINGS), with whether they're in season and seen */
  wild: readonly { id: string; name: string; color: string; time: string; where: string; tip: string; inSeason: boolean; seen: boolean }[];
  /** what bites now, per water */
  bites: Readonly<Record<'pond' | 'river', string[]>>;
  festival: (XZ & { name: string; blurb: string }) | null;
  /** the chart's subtitle (season · festival · rank) */
  subtitle: string;
  /** secret places the player has found (world/map.ts POIS with `hidden`: the grotto) */
  found?: readonly string[];
  /** the Valley Projects: the Mayor's board and each place, ruined or restored (hud/map.ts gathers them) */
  projects?: readonly ProjectPin[];
  /** visitors in the valley right now (scene/visitors: 'visitorsScene'): the merchant's cart, the painter, the parcel post */
  visitors?: readonly { id: string; name: string; title: string; color: string; x: number; z: number; line: string }[];
}

export interface DrawOpts {
  time: number;
  locate?: (id: string) => XZ | null;
  player?: { x: number; z: number; yaw: number } | null;
  hover?: string | null;
  mini?: boolean;
  /** the persistent villagers: little house-shaped role pins (never farmer dots, never clickable terminals) */
  villagers?: readonly VillagerPin[];
  layers?: MapLayers;
  extra?: MapExtras | null;
  /** Settings → Accessibility: the colour-blind-safe palette, with a shape per status (statusMark) */
  safe?: boolean;
  /** reduced motion: no pulsing rings (a steady ring instead) */
  still?: boolean;
}

/**
 * A farmer's status mark: a filled circle in the status colour, or (colour-safe) a shape per status (triangle needs
 * you, circle working, square done, diamond idle) so status never rests on colour alone. The caller strokes / labels.
 */
export function statusMark(g: CanvasRenderingContext2D, x: number, y: number, r: number, st: Status, safe: boolean): void {
  g.beginPath();
  const shape = safe ? STATUS_SHAPE[st] : 'circle';
  if (shape === 'triangle') { const k = r * 1.3; g.moveTo(x, y - k); g.lineTo(x + k * 0.95, y + k * 0.62); g.lineTo(x - k * 0.95, y + k * 0.62); g.closePath(); }
  else if (shape === 'square') { const k = r * 0.9; g.rect(x - k, y - k, k * 2, k * 2); }
  else if (shape === 'diamond') { const k = r * 1.2; g.moveTo(x, y - k); g.lineTo(x + k, y); g.lineTo(x, y + k); g.lineTo(x - k, y); g.closePath(); }
  else g.arc(x, y, r, 0, Math.PI * 2);
}

const KIND_FILL: Record<PlotView['kind'], string> = {
  wheat: '#ecd271', pumpkins: '#eaa55a', cabbages: '#a7d57f', sunflowers: '#f4d64e', orchard: '#94c56f', vineyard: '#b495d0',
  berries: '#dc8b98', chickens: '#eee0bd', cows: '#cbe19f', sheep: '#e1eccb', pigs: '#ecc1b3', bees: '#f1d77a',
};
const LABELS: Partial<Record<StructureId, string>> = {
  farmhouse: 'Farmhouse', barn: 'Barn', silo: 'Silo', windmill: 'Windmill', waterTower: 'Water tower', campfire: 'Campfire',
  bridge: 'Bridge', waterfall: 'Waterfall', pergola: 'Pergola', picnic: 'Picnic spot', lookout: 'Stargazers\' knoll', hotspring: 'Hot spring',
  orchard: 'Honey stand', stones: 'Standing stones', haymeadow: 'Hay meadow', swingtree: 'Swing tree',
};
/** trail points of interest (world POIS kinds) */
const POI_LOOK: Record<string, [Glyph, string]> = {
  trailhead: ['boot', 'Where the cliff trail starts: follow the red dots up'],
  rest: ['nook', 'A bench to catch your breath, halfway up'],
  bridge: ['bridge', 'A rope bridge over the gap'],
  lookout: ['peak', 'The whole valley from the top of the cliffs'],
  grotto: ['cave', 'Behind the waterfall: crystals, a still pool and an old camp'],
};
const SERIF = 'Georgia, "DejaVu Serif", serif';
const INK = '#3b2a1e';
type Box = [number, number, number, number];
interface Label { text: string; x: number; z: number; off: number; ink: string; /** try above the footprint first */ up?: boolean }
const overlaps = (b: Box, list: readonly Box[]) => list.some((q) => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]);

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

/** Blit the visible part of the base. */
function drawBase(g: CanvasRenderingContext2D, v: View, mini: boolean, season: Season): void {
  g.fillStyle = '#efe0bc';
  g.fillRect(0, 0, v.w, v.h);
  // the minimap never forces the (one-off) base build; it shows plain parchment until warmBase() is done
  const b = mini ? (baseReady() ? getHalf() : null) : getBase(season);
  if (!b) return;
  const k = b.width / ((WB.x1 - WB.x0) * S); // 1 (full) or 0.5 (half)
  const tl = toWorld(v, 0, 0), br = toWorld(v, v.w, v.h);
  const sx0 = Math.max(0, (tl.x - WB.x0) * S * k), sy0 = Math.max(0, (tl.z - WB.z0) * S * k);
  const sx1 = Math.min(b.width, (br.x - WB.x0) * S * k), sy1 = Math.min(b.height, (br.z - WB.z0) * S * k);
  if (sx1 <= sx0 || sy1 <= sy0) return;
  const [dx0, dy0] = toScreen(v, WB.x0 + sx0 / (S * k), WB.z0 + sy0 / (S * k));
  const [dx1, dy1] = toScreen(v, WB.x0 + sx1 / (S * k), WB.z0 + sy1 / (S * k));
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = mini ? 'low' : 'high';
  g.drawImage(b, sx0, sy0, sx1 - sx0, sy1 - sy0, dx0, dy0, dx1 - dx0, dy1 - dy0);
}

/** Draw everything; returns hit targets in css px. */
export function drawValley(g: CanvasRenderingContext2D, v: View, s: ValleyState | null, o: DrawOpts): Hit[] {
  const hits: Hit[] = [];
  const mini = !!o.mini;
  const ex = o.extra ?? null;
  const L = o.layers ?? DEFAULT_LAYERS;
  drawBase(g, v, mini, ex?.season ?? s?.sky.season ?? 'summer');
  if (!s) { if (!mini) chrome(g, v, ex); return hits; }
  // the chart furniture's corners are taken: labels keep off them
  const placed: Box[] = mini ? [] : chromeBoxes(v, ex);
  const onScreen = (x: number, y: number, m = 20) => x > -m && y > -m && x < v.w + m && y < v.h + m;

  // ---- plots ----
  for (const plot of s.plots.values()) {
    const site = SITES[plot.site];
    if (!site) continue;
    const [x, y] = toScreen(v, site.x, site.z);
    const w = site.w * v.scale, d = site.d * v.scale;
    const fallow = plot.stage === 'fallow' || plot.stage === 'harvest';
    g.save(); g.translate(x, y); g.rotate(-site.yaw);
    g.fillStyle = 'rgba(60, 40, 20, .22)'; g.fillRect(-w / 2 + 2, -d / 2 + 3, w, d);
    g.fillStyle = fallow ? '#c8b494' : KIND_FILL[plot.kind];
    g.globalAlpha = fallow ? 0.85 : plot.stage === 'resting' ? 0.8 : 0.95;
    g.fillRect(-w / 2, -d / 2, w, d);
    g.globalAlpha = 1;
    if (!mini) {
      // furrows, inked
      g.strokeStyle = fallow ? 'rgba(110, 80, 50, .3)' : 'rgba(80, 55, 25, .28)'; g.lineWidth = Math.max(1, v.scale * 0.22);
      g.beginPath();
      for (let r = -d / 2 + d / 9; r < d / 2 - 1; r += d / 8) { g.moveTo(-w / 2 + 3, r); g.lineTo(w / 2 - 3, r); }
      g.stroke();
    }
    g.strokeStyle = fallow ? '#8a7a64' : WS_COLORS[plot.colorIndex % WS_COLORS.length];
    g.lineWidth = Math.max(1.5, v.scale * (mini ? 0.5 : 0.45));
    if (fallow) g.setLineDash([4, 4]);
    g.strokeRect(-w / 2, -d / 2, w, d);
    g.setLineDash([]);
    g.strokeStyle = 'rgba(40, 25, 10, .5)'; g.lineWidth = 1; g.strokeRect(-w / 2 - 1, -d / 2 - 1, w + 2, d + 2);
    if (plot.status === 'blocked' && !fallow) {
      const a = o.still ? 0.6 : 0.35 + 0.35 * Math.sin(o.time * 5);
      g.strokeStyle = `rgba(240, 167, 44, ${a})`; g.lineWidth = Math.max(3, v.scale * 1.1);
      g.strokeRect(-w / 2 - 3, -d / 2 - 3, w + 6, d + 6);
    }
    g.restore();
    if (o.hover === plot.id) { g.save(); g.translate(x, y); g.rotate(-site.yaw); g.strokeStyle = '#fff'; g.lineWidth = 3; g.strokeRect(-w / 2 - 2, -d / 2 - 2, w + 4, d + 4); g.restore(); }
    hits.push({ id: plot.id, kind: 'plot', sx: x, sy: y, r: Math.min(w, d) / 2 });
    if (!mini) {
      const ic = iconImage(KIND_ICON[plot.kind]);
      const fs = Math.max(11, Math.min(15, v.scale * 2.2));
      g.font = `700 ${fs}px ${SERIF}`;
      g.textAlign = 'left'; g.textBaseline = 'middle';
      const label = fallow ? `${plot.label} · fallow` : plot.label;
      const isz = fs + 5;
      const tw = g.measureText(label).width + isz + 4;
      const ly = y + Math.max(w, d) / 2 * 0.8 + fs;
      g.fillStyle = fallow ? 'rgba(120,100,80,.88)' : 'rgba(110, 74, 42, .95)';
      roundRectPath(g, x - tw / 2 - 6, ly - fs / 2 - 4, tw + 12, fs + 8, 6); g.fill();
      placed.push([x - tw / 2 - 6, ly - fs / 2 - 4, x + tw / 2 + 6, ly + fs / 2 + 4]);
      g.strokeStyle = 'rgba(40,20,5,.6)'; g.lineWidth = 1; g.stroke();
      if (ic.complete && ic.naturalWidth) { g.globalAlpha = fallow ? 0.6 : 1; g.drawImage(ic, x - tw / 2, ly - isz / 2, isz, isz); g.globalAlpha = 1; }
      g.fillStyle = '#fff6e0'; g.fillText(label, x - tw / 2 + isz + 4, ly + 0.5);
    }
  }

  const pinR = mini ? 5.5 : Math.max(9, Math.min(11.5, v.scale * 1.3));
  const hot = (id: string) => o.hover === id;
  const extraLabels: Label[] = [];

  // ---- hint washes (never exact): forage areas, wildlife habitats ----
  if (!mini && ex && L.forage) {
    for (const f of ex.forage) {
      // a seeded nudge keeps the wash off the exact spot: the hunt stays a hunt
      let hsh = 2166136261;
      for (let i = 0; i < f.key.length; i++) { hsh ^= f.key.charCodeAt(i); hsh = Math.imul(hsh, 16777619); }
      const a = ((hsh >>> 0) % 6283) / 1000, dd = 4 + ((hsh >>> 12) % 50) / 10;
      const cx = f.x + Math.cos(a) * dd, cz = f.z + Math.sin(a) * dd;
      const [x, y] = toScreen(v, cx, cz);
      const r = 13 * v.scale;
      if (!onScreen(x, y, r)) continue;
      const wash = g.createRadialGradient(x, y, 0, x, y, r);
      wash.addColorStop(0, 'rgba(255, 236, 150, .55)'); wash.addColorStop(0.65, 'rgba(250, 220, 120, .28)'); wash.addColorStop(1, 'rgba(250, 220, 120, 0)');
      g.fillStyle = wash; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(110, 120, 30, .75)'; g.lineWidth = 1.4; g.setLineDash([4, 4]); g.beginPath(); g.arc(x, y, r * 0.8, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      const id = `forage:${f.key}`;
      tile(g, x, y, pinR * 0.9, 'leaf', PIN_COLOR.leaf, { hot: hot(id), alpha: 0.95 });
      hits.push({ id, kind: 'place', sx: x, sy: y, r: Math.max(pinR + 2, r * 0.5), tip: { title: 'Something to forage', lines: [`Somewhere around here (${f.habitat === 'shore' ? 'by the water' : f.habitat === 'cliff' ? 'at the foot of the cliffs' : f.habitat === 'wood' ? 'under the trees' : 'in the meadow'})`, 'Look for a twinkle in the grass, then E'] } });
    }
  }
  if (!mini && ex && L.wildlife) {
    for (const hb of HABITATS) {
      const w = ex.wild.find((q) => q.id === hb.id);
      if (!w) continue;
      const out = !!ex.wildOut[hb.id];
      hb.spots.forEach((p, i) => {
        const [x, y] = toScreen(v, p.x, p.z);
        const r = 16 * v.scale;
        if (!onScreen(x, y, r)) return;
        g.globalAlpha = w.inSeason ? 1 : 0.45;
        const wash = g.createRadialGradient(x, y, 0, x, y, r);
        wash.addColorStop(0, `${w.color}55`); wash.addColorStop(1, `${w.color}00`);
        g.fillStyle = wash; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
        if (out) {
          const ph = (o.time * 0.8 + i * 0.3) % 1;
          g.strokeStyle = `rgba(255, 246, 220, ${0.9 * (1 - ph)})`; g.lineWidth = 2.4; g.beginPath(); g.arc(x, y, pinR + 3 + ph * pinR * 1.6, 0, Math.PI * 2); g.stroke();
        }
        const id = `wild:${hb.id}:${i}`;
        tile(g, x, y, pinR * 0.95, 'paw', w.color, { hot: hot(id) });
        // when, in small caps under the tile
        g.font = `italic 700 10px ${SERIF}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        const tx = out ? 'out now!' : TIME_SHORT[w.time] ?? '';
        g.lineWidth = 3; g.strokeStyle = 'rgba(248,238,214,.95)'; g.strokeText(tx, x, y + pinR + 8);
        g.fillStyle = out ? '#9a3b2a' : INK; g.fillText(tx, x, y + pinR + 8);
        g.globalAlpha = 1;
        placed.push([x - pinR, y - pinR, x + pinR, y + pinR + 14]);
        hits.push({ id, kind: 'place', sx: x, sy: y, r: pinR + 4, tip: { title: `${w.name}${w.seen ? ' ✓' : ''}`, lines: [w.where, out ? 'Out right now: go slowly!' : w.inSeason ? '' : 'Not this season', w.tip].filter(Boolean) } });
      });
    }
  }

  // ---- place tiles ----
  if (L.places && ex) {
    const R = mini ? 4.5 : pinR * 0.92;
    const put = (id: string, p: XZ, k: Glyph, color: string, title: string, lines: string[]) => {
      const [x, y] = toScreen(v, p.x, p.z);
      if (!onScreen(x, y)) return;
      tile(g, x, y, R, k, color, { hot: hot(id) });
      if (!mini) { placed.push([x - R - 1, y - R - 1, x + R + 1, y + R + 1]); hits.push({ id, kind: 'place', sx: x, sy: y, r: R + 4, tip: { title, lines } }); }
    };
    if (!mini) {
      for (const pl of PLACES) {
        const lines = [pl.line];
        if (pl.id === 'place:mailbox' && ex.unread) lines.unshift(`${ex.unread} unread letter${ex.unread === 1 ? '' : 's'}`);
        put(pl.id, pl, pl.glyph, pl.color, pl.name, lines);
        if (pl.id === 'place:mailbox' && ex.unread) {
          const [x, y] = toScreen(v, pl.x, pl.z);
          g.fillStyle = '#ffd23f'; g.strokeStyle = INK; g.lineWidth = 1.4;
          g.beginPath(); g.arc(x + R, y - R, 7, 0, Math.PI * 2); g.fill(); g.stroke();
          g.fillStyle = INK; g.font = '800 10px ui-rounded, "DejaVu Sans", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(ex.unread > 9 ? '9+' : String(ex.unread), x + R, y - R + 0.5);
        }
      }
      FISH_SPOTS.forEach((f, i) => {
        const bites = ex.bites[f.water] ?? [];
        put(`fish:${i}`, f, 'fish', PIN_COLOR.fish, `Fishing · ${f.name}`, [bites.length ? `Biting now: ${bites.join(', ')}` : 'Quiet right now', 'Look at open water, E to cast'].filter(Boolean));
      });
      for (const p of worldPois()) {
        // a secret stays a "?" (no label) until the player has found it
        if (p.hidden && !ex.found?.includes(p.id)) { put(`poi:${p.id}`, p, 'secret', PIN_COLOR.secret, '?', ['Locals say the falls hide something…']); continue; }
        const [k, line] = POI_LOOK[p.kind ?? ''] ?? POI_LOOK.lookout;
        put(`poi:${p.id}`, p, k, p.hidden ? PIN_COLOR.secret : PIN_COLOR.peak, p.name, [line]);
        extraLabels.push({ text: p.name, x: p.x, z: p.z, off: 2.6, ink: p.hidden ? '#4a3a7a' : '#7a2e20' });
      }
      // the Valley Projects: the board, ruins (gold: finished, waiting to be seen), restored places (with a label)
      for (const pp of ex.projects ?? []) {
        const [k, color] = projectTile(pp);
        put(`project:${pp.id}`, pp, k, color, pp.name, pp.lines);
        if (pp.state === 'restored') extraLabels.push({ text: pp.name, x: pp.x, z: pp.z, off: 2.6, ink: '#7a3a1e' });
      }
    }
    if (ex.store) {
      put('place:store', ex.store, 'store', PIN_COLOR.store, 'General store', ['E browse · F sell your basket', 'Yard decor, seasonal pieces, rank rewards']);
      if (!mini) extraLabels.push({ text: 'General store', x: ex.store.x, z: ex.store.z, off: 2.4, ink: '#2f6a44' });
    }
    // visitors: a tile in their own colour (the merchant's cart, the painter's easel, the parcel post), labelled on the big map
    for (const vp of ex.visitors ?? []) {
      put(`visitor:${vp.id}`, vp, vp.id === 'merchant' ? 'cart' : vp.id === 'painter' ? 'easel' : 'parcel', vp.color, `${vp.name} · ${vp.title}`, [vp.line]);
      if (!mini) extraLabels.push({ text: vp.id === 'merchant' ? 'Merchant' : vp.id === 'painter' ? 'Painter' : 'Post', x: vp.x, z: vp.z, off: 2.4, ink: '#5a2e5e' });
    }
    if (ex.festival) {
      const [x, y] = toScreen(v, ex.festival.x, ex.festival.z);
      if (onScreen(x, y)) {
        rosette(g, x, y, mini ? 5 : pinR * 1.05, o.time, { hot: hot('festival') });
        if (!mini) { placed.push([x - pinR, y - pinR, x + pinR, y + pinR * 1.4]); hits.push({ id: 'festival', kind: 'place', sx: x, sy: y, r: pinR + 4, tip: { title: ex.festival.name, lines: [ex.festival.blurb, 'The centrepiece: E to join in'] } }); }
      }
    }
  }
  if (!mini) extraLabels.push({ text: 'Your yard', x: PLACES[1].x, z: PLACES[1].z, off: 4.6, ink: '#5a4020', up: true });

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
  const vpos = new Map<string, { x: number; y: number }>();
  if (o.villagers) {
    const pr = mini ? 4.5 : Math.max(9, Math.min(12, v.scale * 1.4));
    for (const vp of o.villagers) {
      const [x, y] = toScreen(v, vp.x, vp.z);
      vpos.set(vp.id, { x, y });
      if (vp.inside && mini) continue;
      if (!onScreen(x, y)) continue;
      villagerPin(g, x, y, pr, vp.color, vp.inside ? 0.55 : 1, mini ? null : vp.glyph, mini);
      // the tooltip: what they're doing, where they usually are, a heart event waiting (model/routines.ts, hearts.ts)
      if (!mini) hits.push({ id: vp.id, kind: 'place', sx: x, sy: y, r: pr + 3, tip: { title: `${vp.name} · ${vp.role}`, lines: [
        vp.now ? `Now: ${vp.now}` : vp.inside ? 'At home' : '', ...(vp.usual ?? []).map((u) => `Usually ${u}`), vp.moment ? `♥ ${vp.moment}` : '',
      ].filter(Boolean) } });
      if (!mini) {
        const label = vp.inside ? `${vp.name} (home)` : vp.name;
        g.font = `italic 600 11px ${SERIF}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        const tw = g.measureText(label).width + 8;
        const ly = y + pr + 9;
        const box: Box = [x - tw / 2, ly - 7, x + tw / 2, ly + 7];
        if (!overlaps(box, placed)) {
          placed.push(box);
          g.globalAlpha = vp.inside ? 0.6 : 1;
          g.fillStyle = 'rgba(52, 96, 70, .9)';
          roundRectPath(g, box[0], box[1], tw, 14, 4); g.fill();
          g.fillStyle = '#fff3d6'; g.fillText(label, x, ly + 0.5);
          g.globalAlpha = 1;
        }
      }
    }
  }
  // ---- request hearts: on the villager who asked, or on the place to visit ----
  if (L.requests && ex) {
    const hr = mini ? 5 : pinR * 0.95;
    for (const q of ex.requests) {
      let x: number, y: number;
      if (q.place) {
        const st = STRUCTURES.find((t) => t.id === q.place);
        if (!st) continue;
        [x, y] = toScreen(v, st.x, st.z);
        y -= mini ? 0 : hr * 0.6;
      } else {
        const p = vpos.get(`villager:${q.who}`) ?? vpos.get(q.who);
        if (!p) continue;
        x = p.x + (mini ? 4 : hr * 1.05); y = p.y - (mini ? 5 : hr * 1.5);
      }
      if (!onScreen(x, y)) continue;
      const id = `req:${q.id}`;
      heart(g, x, y, hr, q.ready, o.time, { hot: hot(id) });
      if (!mini) {
        placed.push([x - hr, y - hr, x + hr, y + hr]);
        hits.push({ id, kind: 'place', sx: x, sy: y, r: hr + 4, tip: { title: q.ready ? `${q.name}: request ready!` : `${q.name}'s request`, lines: [q.text, q.ready ? `Talk to ${q.name} to hand it over` : q.next, q.place ? `Go to ${q.placeName ?? 'the spot'}` : ''].filter(Boolean) } });
      }
    }
  }

  // ---- farmers: screen positions, relaxed apart so clustered dots stay clickable ----
  const r = mini ? 4.5 : Math.max(8, Math.min(12, v.scale * 1.4));
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
  for (const d of dots) {
    const { f } = d;
    let { x, y } = d;
    // minimap: a farmer who needs you stays on the rim, pointing the way, when they are off the map
    let edge = false;
    if (mini && f.needsYou) {
      const cx = v.w / 2, cy = v.h / 2, dx = x - cx, dy = y - cy, dd = Math.hypot(dx, dy), lim = v.w / 2 - 8;
      if (dd > lim) { x = cx + (dx / dd) * lim; y = cy + (dy / dd) * lim; edge = true; }
    }
    if (!onScreen(x, y)) continue;
    const col = statusColor(f.status as Status, !!o.safe);
    const isHot = hot(f.id);
    const rr = mini && f.needsYou ? 6.5 : r;
    if (f.needsYou) {
      const ph = o.still ? 0.35 : (o.time * 1.2) % 1;
      g.strokeStyle = `rgba(240, 167, 44, ${1 - ph})`; g.lineWidth = mini ? 2.5 : 3;
      g.beginPath(); g.arc(x, y, rr + 2 + ph * rr * 1.6, 0, Math.PI * 2); g.stroke();
      if (mini) { g.fillStyle = 'rgba(255, 210, 63, .35)'; g.beginPath(); g.arc(x, y, rr + 3, 0, Math.PI * 2); g.fill(); }
    }
    if (edge) {
      // a little pointer toward the farmer
      const a = Math.atan2(y - v.h / 2, x - v.w / 2);
      g.fillStyle = '#f0a72c'; g.strokeStyle = INK; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(x + Math.cos(a) * (rr + 5), y + Math.sin(a) * (rr + 5)); g.lineTo(x + Math.cos(a + 0.6) * rr, y + Math.sin(a + 0.6) * rr); g.lineTo(x + Math.cos(a - 0.6) * rr, y + Math.sin(a - 0.6) * rr); g.closePath(); g.fill(); g.stroke();
    }
    g.fillStyle = 'rgba(40,25,10,.35)'; g.beginPath(); g.ellipse(x + 1, y + rr * 0.85, rr * 0.9, rr * 0.4, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = col; g.strokeStyle = isHot ? '#fff' : INK; g.lineWidth = isHot ? 3 : mini ? 1.5 : 2;
    statusMark(g, x, y, isHot ? rr + 2 : rr, f.status as Status, !!o.safe); g.fill(); g.stroke();
    g.fillStyle = f.needsYou ? '#3a2400' : '#fff';
    g.font = `800 ${Math.round(rr * (mini ? 1.5 : 1.2))}px ui-rounded, "DejaVu Sans", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (!mini || f.needsYou) g.fillText(f.needsYou ? '!' : f.unseenDone ? '✓' : pinGlyph(f), x, y + 0.5);
    hits.push({ id: f.id, kind: 'farmer', sx: x, sy: y, r: rr + 4 });
  }
  if (!mini) {
    // names: greedy, most important first, skipped when they would collide (with each other and field signs)
    const pri = (d: { f: FarmerView }) => (o.hover === d.f.id ? 0 : d.f.needsYou ? 1 : d.f.unseenDone ? 2 : 3);
    g.font = '700 12px ui-rounded, "DejaVu Sans", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const d of [...dots].sort((a, b2) => pri(a) - pri(b2))) {
      const nm = d.home ? fieldName(d.f) : shortName(d.f); // in its field the sign names the project; away from it, the full tag
      const tw = g.measureText(nm).width + 8;
      const cands: [number, number][] = [[d.x, d.y - r - 10], [d.x + r + tw / 2 + 2, d.y], [d.x - r - tw / 2 - 2, d.y], [d.x, d.y + r + 10]];
      const spot = cands.find(([cx, cy]) => {
        const box: Box = [cx - tw / 2, cy - 8, cx + tw / 2, cy + 8];
        if (box[0] < 2 || box[1] < 2 || box[2] > v.w - 2 || box[3] > v.h - 2) return false;
        const hitsDot = dots.some((o2) => o2 !== d && o2.x + r > box[0] && o2.x - r < box[2] && o2.y + r > box[1] && o2.y - r < box[3]);
        return !hitsDot && !overlaps(box, placed);
      });
      if (!spot) continue;
      const [cx, cy] = spot;
      placed.push([cx - tw / 2, cy - 8, cx + tw / 2, cy + 8]);
      g.fillStyle = d.f.needsYou ? 'rgba(255, 227, 138, .96)' : 'rgba(255, 250, 240, .93)';
      roundRectPath(g, cx - tw / 2, cy - 8, tw, 16, 5); g.fill();
      g.strokeStyle = 'rgba(59,42,30,.4)'; g.lineWidth = 1; g.stroke();
      g.fillStyle = INK; g.fillText(nm, cx, cy + 0.5);
    }
  }
  if (!mini) landmarkLabels(g, v, placed, dots, r, extraLabels);
  // ---- player ----
  if (o.player) {
    const [x, y] = toScreen(v, o.player.x, o.player.z);
    const fx = -Math.sin(o.player.yaw), fz = -Math.cos(o.player.yaw);
    const ang = Math.atan2(fz, fx);
    const R = mini ? 8 : 12;
    g.save(); g.translate(x, y); g.rotate(ang + Math.PI / 2);
    // view cone
    const cone = g.createRadialGradient(0, 0, 0, 0, 0, R * (mini ? 3.4 : 4));
    cone.addColorStop(0, 'rgba(255, 250, 230, .55)'); cone.addColorStop(1, 'rgba(255, 250, 230, 0)');
    g.fillStyle = cone; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R * (mini ? 3.4 : 4), -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); g.closePath(); g.fill();
    g.fillStyle = 'rgba(40, 25, 10, .35)'; g.beginPath(); g.moveTo(1, -R + 2); g.lineTo(R * 0.72 + 1, R * 0.8 + 2); g.lineTo(1, R * 0.4 + 2); g.lineTo(-R * 0.72 + 1, R * 0.8 + 2); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(0, -R); g.lineTo(R * 0.72, R * 0.8); g.lineTo(0, R * 0.4); g.lineTo(-R * 0.72, R * 0.8); g.closePath();
    g.fillStyle = '#d0584a'; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2.2; g.stroke();
    g.restore();
  }
  if (!mini) chrome(g, v, ex);
  return hits;
}

/** The house-shaped villager pin. */
export function villagerPin(g: CanvasRenderingContext2D, x: number, y: number, pr: number, color: string, alpha: number, glyph: string | null, mini = false): void {
  g.globalAlpha = alpha;
  g.beginPath();
  g.moveTo(x, y - pr * 1.25); g.lineTo(x + pr, y - pr * 0.25); g.lineTo(x + pr, y + pr); g.lineTo(x - pr, y + pr); g.lineTo(x - pr, y - pr * 0.25); g.closePath();
  g.fillStyle = color; g.fill();
  g.strokeStyle = '#f0d696'; g.lineWidth = mini ? 1.2 : 2; g.stroke();
  g.strokeStyle = 'rgba(40, 25, 10, .55)'; g.lineWidth = 1; g.stroke();
  if (glyph) {
    g.fillStyle = '#fff8e6';
    g.font = `700 ${Math.round(pr * 1.15)}px "DejaVu Sans", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(glyph, x, y + pr * 0.25);
  }
  g.globalAlpha = 1;
}

/** Landmark names in italic serif, quietly: each one only where it hits no field sign, pin, name or farmer dot. */
function landmarkLabels(g: CanvasRenderingContext2D, v: View, placed: Box[], dots: readonly { x: number; y: number }[], r: number, extra: readonly Label[]): void {
  const fs = Math.round(Math.max(11, Math.min(16, v.scale * 2.6)));
  g.font = `italic 700 ${fs}px ${SERIF}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round';
  const items: Label[] = [];
  for (const st of STRUCTURES) {
    const lab = LABELS[st.id];
    if (lab) items.push({ text: lab, x: st.x, z: st.z, off: Math.max(st.size[0], st.size[1]) * 0.55, ink: '#4a2f19' });
  }
  items.push({ text: 'Pond', x: POND.x, z: POND.z, off: 0, ink: '#23577f' }, ...extra);
  for (const it of items) {
    const [x, y0] = toScreen(v, it.x, it.z);
    if (x < -60 || x > v.w + 60 || y0 < -30 || y0 > v.h + 30) continue;
    const tw = g.measureText(it.text).width;
    const below = y0 + it.off * v.scale + fs * 0.7 + 4;
    // under the footprint first, then above it, then centred on it
    const above = y0 - it.off * v.scale - fs * 0.7 - 4;
    for (const y of it.up ? [above, below, y0] : [below, above, y0]) {
      const box: Box = [x - tw / 2 - 3, y - fs / 2 - 1, x + tw / 2 + 3, y + fs / 2 + 1];
      if (box[0] < 4 || box[1] < 4 || box[2] > v.w - 4 || box[3] > v.h - 4) continue;
      if (overlaps(box, placed)) continue;
      if (dots.some((d) => d.x + r > box[0] && d.x - r < box[2] && d.y + r > box[1] && d.y - r < box[3])) continue;
      placed.push(box);
      g.lineWidth = 3.5; g.strokeStyle = 'rgba(248,238,214,.92)'; g.strokeText(it.text, x, y);
      g.fillStyle = it.ink; g.fillText(it.text, x, y);
      break;
    }
  }
}

// ---------------------------------------------------------------------------------------------- chart furniture

let roseImg: HTMLCanvasElement | null = null;
let edgeImg: { w: number; h: number; c: HTMLCanvasElement } | null = null;
let cartImg: { key: string; c: HTMLCanvasElement } | null = null;
const dpr = () => Math.min(2, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) || 1);

/** An eight-point compass rose with a fleur north, cached. */
function compass(): HTMLCanvasElement {
  if (roseImg) return roseImg;
  const k = dpr(), R = 34, sz = Math.ceil((R * 2 + 26) * k);
  const c = document.createElement('canvas'); c.width = c.height = sz;
  const g = c.getContext('2d')!;
  g.scale(k, k); g.translate(sz / k / 2, sz / k / 2 + 6);
  g.fillStyle = 'rgba(248, 238, 214, .75)'; g.beginPath(); g.arc(0, 0, R * 0.98, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#6b4a2b'; g.lineWidth = 1.2; g.stroke();
  g.beginPath(); g.arc(0, 0, R * 0.86, 0, Math.PI * 2); g.lineWidth = 0.7; g.stroke();
  // ticks
  for (let i = 0; i < 32; i++) { const a = (i / 32) * Math.PI * 2; g.beginPath(); g.moveTo(Math.cos(a) * R * 0.86, Math.sin(a) * R * 0.86); g.lineTo(Math.cos(a) * R * (i % 4 ? 0.92 : 0.98), Math.sin(a) * R * (i % 4 ? 0.92 : 0.98)); g.stroke(); }
  const point = (a: number, len: number, wid: number, light: string, dark: string) => {
    g.save(); g.rotate(a);
    g.beginPath(); g.moveTo(0, -len); g.lineTo(wid, 0); g.lineTo(0, 0); g.closePath(); g.fillStyle = light; g.fill(); g.strokeStyle = '#4a2f19'; g.lineWidth = 0.8; g.stroke();
    g.beginPath(); g.moveTo(0, -len); g.lineTo(-wid, 0); g.lineTo(0, 0); g.closePath(); g.fillStyle = dark; g.fill(); g.stroke();
    g.restore();
  };
  for (let i = 0; i < 4; i++) point(Math.PI / 4 + (i * Math.PI) / 2, R * 0.58, R * 0.12, '#f4e6c4', '#b8956a');
  for (let i = 0; i < 4; i++) point((i * Math.PI) / 2, R * 0.84, R * 0.17, i === 0 ? '#e86a5a' : '#f4e6c4', i === 0 ? '#a8322a' : '#7a5636');
  g.fillStyle = '#fff3d6'; g.strokeStyle = '#4a2f19'; g.lineWidth = 0.9; g.beginPath(); g.arc(0, 0, R * 0.09, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = '#4a2f19'; g.font = `700 13px ${SERIF}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.lineWidth = 3; g.strokeStyle = 'rgba(248,238,214,.95)'; g.strokeText('N', 0, -R - 3); g.fillText('N', 0, -R - 3);
  roseImg = c;
  return c;
}

/** The deckled, vignetted edge of the chart, cached per size. */
function edges(w: number, h: number): HTMLCanvasElement {
  if (edgeImg && edgeImg.w === w && edgeImg.h === h) return edgeImg.c;
  const k = dpr();
  const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
  const g = c.getContext('2d')!;
  g.scale(k, k);
  const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.hypot(w, h) * 0.6);
  vg.addColorStop(0, 'rgba(120,80,30,0)'); vg.addColorStop(1, 'rgba(110,66,24,.36)');
  g.fillStyle = vg; g.fillRect(0, 0, w, h);
  // a burnt, slightly ragged rim
  const r = (() => { let a = 7; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  g.fillStyle = 'rgba(96, 60, 24, .22)';
  for (const [x0, y0, dx, dy, nx, ny, len] of [[0, 0, 1, 0, 0, 1, w], [0, h, 1, 0, 0, -1, w], [0, 0, 0, 1, 1, 0, h], [w, 0, 0, 1, -1, 0, h]] as const) {
    g.beginPath(); g.moveTo(x0, y0);
    for (let t = 0; t <= len; t += 7) { const d = 2 + r() * 4; g.lineTo(x0 + dx * t + nx * d, y0 + dy * t + ny * d); }
    g.lineTo(x0 + dx * len, y0 + dy * len); g.closePath(); g.fill();
  }
  // an inked neatline
  g.strokeStyle = 'rgba(74, 47, 25, .55)'; g.lineWidth = 1.2; g.strokeRect(9.5, 9.5, w - 19, h - 19);
  g.strokeStyle = 'rgba(74, 47, 25, .3)'; g.lineWidth = 0.8; g.strokeRect(13.5, 13.5, w - 27, h - 27);
  edgeImg = { w, h, c };
  return c;
}

/** The title cartouche: a scroll with the valley's name and a subtitle, cached per text. */
function cartouche(sub: string): HTMLCanvasElement {
  const key = sub;
  if (cartImg?.key === key) return cartImg.c;
  const k = dpr();
  const meas = document.createElement('canvas').getContext('2d')!;
  meas.font = `italic 700 22px ${SERIF}`;
  const tw = Math.max(meas.measureText('Claude Valley').width, (meas.font = `italic 600 12px ${SERIF}`, meas.measureText(sub).width));
  const W = Math.ceil(tw + 64), H = 62;
  const c = document.createElement('canvas'); c.width = Math.round(W * k); c.height = Math.round(H * k);
  const g = c.getContext('2d')!;
  g.scale(k, k);
  // scroll body with curled ends
  g.fillStyle = 'rgba(60, 40, 20, .25)'; roundRectPath(g, 14, 9, W - 24, H - 14, 6); g.fill();
  const body = g.createLinearGradient(0, 6, 0, H - 8);
  body.addColorStop(0, '#fbf1d8'); body.addColorStop(1, '#ecd9ab');
  g.fillStyle = body; roundRectPath(g, 12, 6, W - 24, H - 14, 6); g.fill();
  g.strokeStyle = '#6b4a2b'; g.lineWidth = 1.4; g.stroke();
  for (const sx of [12, W - 12]) {
    g.fillStyle = '#e2c995'; g.beginPath(); g.ellipse(sx, 6 + (H - 14) / 2, 7, (H - 14) / 2 + 2, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    g.beginPath(); g.ellipse(sx, 6 + (H - 14) / 2, 3, (H - 14) / 2 - 4, 0, 0, Math.PI * 2); g.stroke();
  }
  g.strokeStyle = 'rgba(107, 74, 43, .45)'; g.lineWidth = 0.8; roundRectPath(g, 22, 10, W - 44, H - 22, 3); g.stroke();
  g.fillStyle = '#4a2f19'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `italic 700 22px ${SERIF}`; g.fillText('Claude Valley', W / 2, 25);
  g.fillStyle = '#7a5636'; g.font = `italic 600 12px ${SERIF}`; g.fillText(sub, W / 2, 43);
  cartImg = { key, c };
  return c;
}

/** Where the furniture sits: compass top-right, title cartouche bottom-right, scale bar bottom-left. */
function chromeBoxes(v: View, ex: MapExtras | null): Box[] {
  const k = dpr(), rw = compass().width / k;
  const out: Box[] = [[v.w - rw - 16, 16, v.w - 16, 16 + rw]];
  if (v.w > 520) { const c = cartouche(ex?.subtitle ?? 'a map of the valley'), cs = cartScale(v); const cw = c.width / k * cs, ch = c.height / k * cs; out.push([v.w - cw - 18, v.h - ch - 16, v.w - 18, v.h - 16]); }
  const sb = scaleBar(v);
  out.push([sb.x0 - 8, sb.y0 - 18, sb.x0 + sb.px + 38, sb.y0 + 12]);
  return out;
}
/** the cartouche shrinks on small maps (laptops) */
const cartScale = (v: View) => Math.max(0.66, Math.min(1, v.w / 920));
/** scale bar: a round number of metres about 90 px long */
function scaleBar(v: View): { m: number; px: number; x0: number; y0: number } {
  const want = 90 / v.scale;
  const m = [10, 20, 25, 50, 100, 200].find((q) => q >= want * 0.7) ?? 200;
  return { m, px: m * v.scale, x0: 24, y0: v.h - 26 };
}
/** Compass, title, scale bar, edge. */
function chrome(g: CanvasRenderingContext2D, v: View, ex: MapExtras | null): void {
  g.drawImage(edges(v.w, v.h), 0, 0, v.w, v.h);
  const k = dpr();
  const rose = compass();
  const rw = rose.width / k;
  g.drawImage(rose, v.w - rw - 16, 16, rw, rw);
  if (v.w > 520) {
    const cart = cartouche(ex?.subtitle ?? 'a map of the valley');
    const cs = cartScale(v), cw = cart.width / k * cs, ch = cart.height / k * cs;
    g.drawImage(cart, v.w - cw - 18, v.h - ch - 16, cw, ch);
  }
  const { m, px, x0, y0 } = scaleBar(v);
  g.fillStyle = 'rgba(248, 238, 214, .85)'; roundRectPath(g, x0 - 8, y0 - 18, px + 46, 30, 5); g.fill();
  g.strokeStyle = '#4a2f19'; g.lineWidth = 1;
  for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#fff6e0' : '#4a2f19'; g.fillRect(x0 + (px / 4) * i, y0, px / 4, 5); }
  g.strokeRect(x0, y0, px, 5);
  g.fillStyle = '#4a2f19'; g.font = `italic 600 11px ${SERIF}`; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillText('0', x0 - 3, y0 - 4); g.textAlign = 'center'; g.fillText(`${m} m`, x0 + px, y0 - 4);
}

/** Nearest hit within its radius (farmers win over helpers over places over plots). */
export function hitTest(hits: readonly Hit[], x: number, y: number): Hit | null {
  let best: Hit | null = null, bestD = Infinity;
  const pri = { farmer: 0, helper: 1, place: 2, plot: 3 } as const;
  for (const hh of hits) {
    const d = Math.hypot(hh.sx - x, hh.sy - y);
    if (d > hh.r) continue;
    const score = pri[hh.kind] * 1000 + d;
    if (score < bestD) { bestD = score; best = hh; }
  }
  return best;
}
