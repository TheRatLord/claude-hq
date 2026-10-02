/**
 * The big parchment map (M) and the corner minimap. Clicking a farmer opens its terminal immediately; Shift+click or
 * right-click walks there. Wheel zooms around the cursor, drag pans, 0 resets. The side list mirrors the fields
 * (farmers and scarecrows): ↑/↓ moves through it (the pin lights up on the map), Enter = terminal, Shift+Enter = walk.
 */
import type { FrameInfo } from '../scene/context.ts';
import { ICONS, KIND_ICON, icon } from './icons.ts';
import { altName, farmerLine, fieldName, HELPER_LABEL, JOB_LABEL, nice, shortName, STAGE_LABEL, STATUS_COLOR, STATUS_LABEL, STATUS_RANK } from './format.ts';
import { DEFAULT_LAYERS, drawValley, fitContent, fitView, hitTest, toWorld, villagerPin, type Hit, type MapExtras, type MapLayers, type View } from './mapdraw.ts';
import { heart, PIN_COLOR, rosette, tile, type Glyph } from './mappins.ts';
import { framePanel, h, type HudCtx, type Panel } from './ctx.ts';
import { fishOdds, SIGHTINGS } from '../model/collection.ts';
import { PLACE_NAME, type VisitPlace } from '../model/friends.ts';
import type { Status } from '../../../../shared/protocol.ts';
import './map.css';
import { readLocal, readTyped, writeJson, writeLocal } from '../storage.ts';

// ---------------------------------------------------------------------------------------------- layers + extras

const LAYERS_KEY = 'valley.hud.mapLayers';
function loadLayers(): MapLayers {
  return readTyped(LAYERS_KEY, DEFAULT_LAYERS);
}
/** shared by the panel and the minimap (one object: a toggle in the panel shows on the minimap at once) */
const layers: MapLayers = loadLayers();
const saveLayers = () => writeJson(LAYERS_KEY, layers);

const CAP = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
let extrasAt = -1;
let extras: MapExtras | null = null;
/** What the map shows besides the valley state, gathered from the bindings at most ~3 times a second. */
function gather(ctx: HudCtx, now: number): MapExtras | null {
  if (extras && now - extrasAt < 0.33 && now >= extrasAt) return extras;
  extrasAt = now;
  const s = ctx.state(), b = ctx.b;
  if (!s || !b) return (extras = null);
  const svc = <T>(n: string): T | undefined => { try { return b.service?.(n) as T | undefined; } catch { return undefined; } };
  const yard = svc<{ store?: { x: number; z: number; yaw: number } }>('yard');
  const store = yard?.store && Number.isFinite(yard.store.x) ? { x: yard.store.x, z: yard.store.z, yaw: yard.store.yaw } : null;
  let requests: MapExtras['requests'] = [];
  try {
    requests = (b.friends?.().requests() ?? []).filter((r) => !r.done).map((r) => ({
      id: r.req.id, who: r.req.who, place: r.req.kind === 'visit' ? r.req.place : undefined,
      placeName: r.req.place ? PLACE_NAME[r.req.place as VisitPlace] : undefined,
      name: r.friend.name, text: r.text, next: r.next, ready: r.ready,
    }));
  } catch { /* optional */ }
  const items = svc<{ items(): { key: string; x: number; z: number; habitat: string; picked: boolean }[] }>('forage')?.items?.() ?? [];
  const forage = items.filter((f) => !f.picked);
  const wildOut: Record<string, boolean> = {};
  try { for (const w of svc<{ list(): { id: string; on: boolean }[] }>('wildlife')?.list?.() ?? []) wildOut[w.id] = !!w.on; } catch { /* optional */ }
  const seen = b.collection?.().data().seen ?? {};
  const sky = s.sky;
  const wild = SIGHTINGS.map((d) => ({ id: d.id, name: d.name, color: d.color, time: d.time, where: CAP(d.place), tip: d.tip, inSeason: d.seasons.includes(sky.season), seen: !!seen[d.id] }));
  const bites = { pond: [] as string[], river: [] as string[] };
  for (const water of ['pond', 'river'] as const) {
    bites[water] = fishOdds({ season: sky.season, hour: sky.hour, weather: sky.weather.kind, water }).filter((o) => !o.def.junk).sort((a, c) => c.weight - a.weight).slice(0, 3).map((o) => o.def.name);
  }
  let festival: MapExtras['festival'] = null;
  const fa = sky.festival.active;
  if (fa) {
    const c = svc<{ where(): Record<string, [number, number, number]> }>('festivals')?.where?.().center;
    festival = { x: c?.[0] ?? -6, z: c?.[2] ?? -6, name: fa.name, blurb: fa.blurb };
  }
  const unread = s.letters.filter((l) => !l.read).length;
  const subtitle = [CAP(sky.season), fa?.name, s.almanac?.name].filter(Boolean).join(' · ');
  return (extras = { season: sky.season, store, unread, requests, forage, forageLeft: forage.length, wildOut, wild, bites, festival, subtitle });
}

/** A legend swatch: the same pin the map draws, on a tiny canvas. */
function swatch(draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const k = Math.min(2, window.devicePixelRatio || 1), n = 22;
  const c = h('canvas.sw') as HTMLCanvasElement;
  c.width = c.height = n * k;
  const g = c.getContext('2d');
  if (g) { g.scale(k, k); g.translate(n / 2, n / 2); draw(g); }
  return c;
}
const dotSw = (st: Status, mark = '') => swatch((g) => {
  g.fillStyle = STATUS_COLOR[st]; g.strokeStyle = '#3b2a1e'; g.lineWidth = 1.6; g.beginPath(); g.arc(0, 0, 7, 0, Math.PI * 2); g.fill(); g.stroke();
  if (mark) { g.fillStyle = st === 'blocked' ? '#3a2400' : '#fff'; g.font = '800 10px ui-rounded, "DejaVu Sans", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(mark, 0, 0.5); }
  if (st === 'blocked') { g.strokeStyle = '#f0a72c'; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 9.6, 0, Math.PI * 2); g.stroke(); }
});
const tileSw = (k: Glyph, c: string) => swatch((g) => tile(g, 0, 0, 7.5, k, c));

function sizeCanvas(cv: HTMLCanvasElement, w: number, hgt: number): CanvasRenderingContext2D {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(hgt * dpr));
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  cv.style.width = `${w}px`; cv.style.height = `${hgt}px`;
  const g = cv.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return g;
}

export function createMapPanel(ctx: HudCtx): Panel & { hits(): readonly Hit[] } {
  const { el, body, closeBtn } = framePanel('map', 'Valley Map', ICONS.map);
  closeBtn.addEventListener('click', () => ctx.panels.close());
  const canvas = h('canvas.vh-mapcanvas', { 'data-testid': 'map-canvas', 'aria-label': 'Map of the valley. Click a farmer to open their terminal.' });
  const tip = h('div.vh-tip');
  const wrap = h('div.vh-mapwrap', null, canvas, tip);
  const key = (sw: HTMLCanvasElement, label: string, title?: string) => h('span', title ? { title } : null, sw, label);
  const legend = h('div.vh-legend.vh-mapkey', { 'data-testid': 'map-legend' },
    key(dotSw('blocked', '!'), STATUS_LABEL.blocked), key(dotSw('working'), STATUS_LABEL.working), key(dotSw('done', '✓'), STATUS_LABEL.done), key(dotSw('idle'), STATUS_LABEL.idle),
    key(swatch((g) => { g.beginPath(); g.moveTo(0, -8); g.lineTo(6, 6.5); g.lineTo(0, 3.5); g.lineTo(-6, 6.5); g.closePath(); g.fillStyle = '#d0584a'; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1.6; g.stroke(); }), 'You'),
    key(swatch((g) => { g.strokeStyle = '#6e4a2a'; g.lineWidth = 2; g.beginPath(); g.moveTo(-5, -1); g.lineTo(5, -1); g.moveTo(0, -6); g.lineTo(0, 8); g.stroke(); g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(0, -6, 3, 0, Math.PI * 2); g.fill(); g.stroke(); }), 'Scarecrow'),
    key(swatch((g) => villagerPin(g, 0, 1, 7, '#3f6a4e', 1, null)), 'Villager'),
    key(swatch((g) => heart(g, 0, 0, 7.5, false, 0)), 'Request', 'Today\'s villager requests (gold when ready to hand over)'),
    key(tileSw('store', PIN_COLOR.store), 'Store', 'The General store cart: buy decor, sell your basket'),
    key(tileSw('mail', PIN_COLOR.mail), 'Mailbox'),
    key(tileSw('yard', PIN_COLOR.yard), 'Your yard'),
    key(tileSw('door', PIN_COLOR.door), 'Go inside', 'The farmhouse door'),
    key(tileSw('nook', PIN_COLOR.nook), 'Nook', 'Leisure nooks: pergola, picnic, knoll, hot spring, orchard, stones, hay meadow, swing tree'),
    key(tileSw('fish', PIN_COLOR.fish), 'Fishing'),
    key(swatch((g) => rosette(g, 0, -1, 7, 0)), 'Festival'),
    key(tileSw('peak', PIN_COLOR.peak), 'Trail stop', 'The cliff trail (red dots): trailhead, bench, rope bridge, summit lookout'));
  const layerBtn = (id: keyof MapLayers, label: string, sw: HTMLCanvasElement, title: string) => {
    const btn = h('button.vh-maplayer', { type: 'button', title, 'data-testid': `map-layer-${id}`, 'aria-pressed': String(layers[id]) }, sw, h('span.l', { text: label }), h('span.n'));
    btn.addEventListener('click', () => { layers[id] = !layers[id]; saveLayers(); btn.setAttribute('aria-pressed', String(layers[id])); extrasAt = -1; draw(); });
    return btn;
  };
  const layerBtns = {
    places: layerBtn('places', 'Places', tileSw('nook', PIN_COLOR.nook), 'Store, mailbox, yard, nooks, fishing spots, the festival'),
    requests: layerBtn('requests', 'Requests', swatch((g) => heart(g, 0, 0, 7.5, false, 0)), 'Hearts on the villagers with a request today'),
    forage: layerBtn('forage', 'Forage', tileSw('leaf', PIN_COLOR.leaf), 'Roughly where today\'s forageables lie (never the exact spot)'),
    wildlife: layerBtn('wildlife', 'Wildlife', tileSw('paw', PIN_COLOR.paw), 'Where and when the shy visitors come out'),
  };
  const layerRow = h('div.vh-maplayers', { role: 'group', 'aria-label': 'Map layers' }, layerBtns.places, layerBtns.requests, layerBtns.forage, layerBtns.wildlife);
  const list = h('div.list.vh-scroll', { 'data-testid': 'map-list' });
  const foot = h('div.vh-foot', null,
    h('span', null, 'Click a farmer: ', h('b', { text: 'terminal' })),
    h('span', null, h('kbd.vh-k', { text: 'Shift' }), '+click / right-click: walk'),
    h('span', null, h('kbd.vh-k', { text: '↑' }), h('kbd.vh-k', { text: '↓' }), 'pick', h('kbd.vh-k', { text: 'Enter' }), 'terminal'),
    h('span', null, 'Wheel zoom · drag pan · ', h('kbd.vh-k', { text: '0' }), ' reset'));
  // the key starts open on tall screens (laptops keep the room for the farmer list); a toggle is remembered
  let keyOpen = innerHeight > 860;
  const k = readLocal('valley.hud.mapKey');
  if (k) keyOpen = k === 'open';
  const keyBox = h('details.vh-mapkeybox', { open: keyOpen }, h('summary', { text: 'Key' }), legend);
  keyBox.addEventListener('toggle', () => writeLocal('valley.hud.mapKey', keyBox.open ? 'open' : 'closed'));
  const side = h('div.vh-mapside', null, layerRow, keyBox, h('div.vh-h3', null, icon(ICONS.book), 'Farmers'), list, foot);
  body.append(wrap, side);

  let g: CanvasRenderingContext2D | null = null;
  let view: View | null = null;
  let hits: Hit[] = [];
  let hover: string | null = null;
  let listHover: string | null = null;
  let t = 0;
  let drag: { x: number; y: number; cx: number; cz: number; moved: boolean } | null = null;

  const layout = () => {
    const r = wrap.getBoundingClientRect();
    const w = Math.floor(r.width), hh = Math.floor(r.height);
    if (w < 10 || hh < 10) return;
    g = sizeCanvas(canvas, w, hh);
    const fit = fitContent(w, hh, ctx.state(), ctx.b?.player?.() ?? null);
    if (!view) view = fit;
    else { view.w = w; view.h = hh; }
  };
  const draw = () => {
    if (!g || !view) return;
    const s = ctx.state();
    const ex = gather(ctx, t);
    hits = drawValley(g, view, s, { time: t, locate: ctx.b?.locate, player: ctx.b?.player?.() ?? null, hover: listHover ?? hover, villagers: ctx.b?.villagers?.(), layers, extra: ex });
    if (ex) {
      const n = (b: HTMLElement, v: string) => { const el = b.querySelector('.n') as HTMLElement; if (el.textContent !== v) el.textContent = v; };
      n(layerBtns.requests, ex.requests.length ? String(ex.requests.length) : '');
      n(layerBtns.forage, ex.forageLeft ? String(ex.forageLeft) : '');
      n(layerBtns.wildlife, String(Object.values(ex.wildOut).filter(Boolean).length || ''));
    }
  };
  const pos = (e: MouseEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  const showTip = (hit: Hit | null, x: number, y: number) => {
    const s = ctx.state();
    if (!hit || !s) { tip.classList.remove('show'); return; }
    tip.replaceChildren();
    if (hit.kind === 'farmer') {
      const f = s.farmers.get(hit.id);
      if (!f) return;
      const alt = altName(f);
      tip.append(h('b', { text: shortName(f) }), ' ', h(`span.vh-pill.st-${f.status}`, { text: STATUS_LABEL[f.status] }), alt ? h('div.vh-muted', { text: alt }) : '',
        h('div', { text: `${s.plots.get(f.plotId)?.label ?? ''} · ${JOB_LABEL[f.job]}` }),
        h('div.vh-muted', { text: f.needsYou ? (f.question ?? '') : f.detail || f.title || '' }),
        h('div.k', { text: 'Click: open terminal · Shift+click: walk there' }));
    } else if (hit.kind === 'helper') {
      const hp = s.helpers.get(hit.id);
      if (!hp) return;
      tip.append(h('b', { text: `${shortName(hp)} (scarecrow)` }), h('div', { text: `${HELPER_LABEL[hp.activity]}${hp.label ? ` · ${hp.label}` : ''}` }), h('div.k', { text: 'Click: open shell · Shift+click: walk there' }));
    } else if (hit.kind === 'place') {
      if (!hit.tip) return;
      tip.append(h('b', { text: hit.tip.title }), ...hit.tip.lines.map((l, i) => h(i ? 'div.vh-muted' : 'div', { text: l })));
    } else {
      const p = s.plots.get(hit.id);
      if (!p) return;
      tip.append(h('b', { text: p.label }), h('div', { text: `${STAGE_LABEL[p.stage]} · ${p.farmers.length} farmer${p.farmers.length === 1 ? '' : 's'}` }),
        h('div.k', { text: 'Shift+click: walk to this field' }));
    }
    tip.classList.add('show');
    const wr = wrap.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
    const tx = x + cr.left - wr.left + 16, ty = y + cr.top - wr.top + 14;
    tip.style.left = `${Math.min(tx, wr.width - 310)}px`;
    tip.style.top = `${Math.min(ty, wr.height - 120)}px`;
  };

  canvas.addEventListener('mousemove', (e) => {
    const p = pos(e);
    if (drag && view) {
      const dx = p.x - drag.x, dy = p.y - drag.y;
      if (Math.hypot(dx, dy) > 4) drag.moved = true;
      if (drag.moved) { view.cx = drag.cx - dx / view.scale; view.cz = drag.cz - dy / view.scale; tip.classList.remove('show'); return; }
    }
    const hit = hitTest(hits, p.x, p.y);
    hover = hit?.id ?? null;
    canvas.classList.toggle('hot', !!hit && (hit.kind === 'farmer' || hit.kind === 'helper'));
    showTip(hit, p.x, p.y);
  });
  canvas.addEventListener('mouseleave', () => { hover = null; tip.classList.remove('show'); drag = null; });
  canvas.addEventListener('mousedown', (e) => { if (e.button !== 0 || !view) return; const p = pos(e); drag = { x: p.x, y: p.y, cx: view.cx, cz: view.cz, moved: false }; });
  addEventListener('mouseup', () => { setTimeout(() => { drag = null; }, 0); });
  const act = (hit: Hit | null, walk: boolean) => {
    if (!hit || hit.kind === 'place') return;
    if (walk) { ctx.travel(hit.id); ctx.panels.close(); return; }
    if (hit.kind === 'farmer' || hit.kind === 'helper') ctx.openTerminal(hit.id);
  };
  canvas.addEventListener('click', (e) => {
    if (drag?.moved) return;
    const p = pos(e);
    act(hitTest(hits, p.x, p.y), e.shiftKey);
  });
  canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); const p = pos(e); act(hitTest(hits, p.x, p.y), true); });
  canvas.addEventListener('wheel', (e) => {
    if (!view) return;
    e.preventDefault();
    const p = pos(e);
    const before = toWorld(view, p.x, p.y);
    const fit = fitView(view.w, view.h).scale;
    view.scale = Math.max(fit * 0.9, Math.min(fit * 6, view.scale * Math.exp(-e.deltaY * 0.0015)));
    const after = toWorld(view, p.x, p.y);
    view.cx += before.x - after.x; view.cz += before.z - after.z;
  }, { passive: false });

  let sig = '';
  let rows: HTMLElement[] = [];
  const pickRow = (row: HTMLElement | undefined) => {
    if (!row) return;
    row.focus({ preventScroll: true });
    row.scrollIntoView({ block: 'nearest' });
    listHover = row.dataset.id ?? null;
  };
  const refreshList = () => {
    const s = ctx.state();
    if (!s) return;
    const plots = [...s.plots.values()].filter((p) => p.farmers.length + p.helpers.length > 0).sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.label.localeCompare(b.label));
    const nsig = plots.map((p) => `${p.id}:${p.kind}:${p.label}:${p.farmers.map((id) => { const f = s.farmers.get(id); return f ? `${f.name}${f.tag}${f.status}${f.job}${f.needsYou}${f.unseenDone}` : id; }).join(',')}:${p.helpers.map((id) => { const hp = s.helpers.get(id); return hp ? `${hp.name}${hp.running}` : id; }).join(',')}`).join('|') + s.link;
    if (nsig === sig) return;
    sig = nsig;
    const keep = list.scrollTop;
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.id;
    list.replaceChildren();
    rows = [];
    const add = (id: string, dot: HTMLElement, name: string, job: string, title: string, testid: string) => {
      const row = h('div.who', { role: 'button', tabindex: '0', title, 'data-testid': testid, 'data-id': id }, dot, h('span.nm', { text: name }), h('span.j', { text: job }));
      row.addEventListener('click', (e) => { if (e.shiftKey) { ctx.travel(id); ctx.panels.close(); } else ctx.openTerminal(id); });
      row.addEventListener('mouseenter', () => { listHover = id; });
      row.addEventListener('mouseleave', () => { if (listHover === id) listHover = null; });
      row.addEventListener('focus', () => { listHover = id; });
      row.addEventListener('blur', () => { if (listHover === id) listHover = null; });
      list.append(row);
      rows.push(row);
    };
    for (const p of plots) {
      list.append(h('div.fld', null, icon(KIND_ICON[p.kind]), h('span', { text: p.label })));
      const fs = p.farmers.map((id) => s.farmers.get(id)).filter((f) => !!f).sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
      for (const f of fs) add(f.id, h(`i.vh-dot.st-${f.status}`), fieldName(f), f.needsYou ? 'needs you!' : JOB_LABEL[f.job], `${nice(f.name)} — ${farmerLine(f)}\nEnter / click: terminal · Shift: walk there`, 'map-farmer');
      for (const hid of p.helpers) {
        const hp = s.helpers.get(hid);
        if (hp) add(hp.id, h('i.vh-dot.helper', { style: { background: hp.running ? '#ffd23f' : hp.exit === 'fail' ? '#d0584a' : '#ddd' } }), fieldName(hp), hp.running ? HELPER_LABEL[hp.activity] : 'scarecrow', `${nice(hp.name)} (scarecrow) — click for the shell`, 'map-helper');
      }
    }
    if (!plots.length) {
      const away = s.link === 'offline' || s.link === 'herdr-offline' || s.link === 'connecting';
      list.append(h('div.vh-empty', null, away ? 'Waiting for herdr…' : 'No fields tilled yet.', h('small', { text: away ? 'Fields and farmers appear once herdr answers.' : 'Each herdr workspace becomes a field here.' })));
    }
    list.scrollTop = keep;
    if (focused) rows.find((r) => r.dataset.id === focused)?.focus({ preventScroll: true });
  };

  let ro: ResizeObserver | null = null;
  return {
    id: 'map', el,
    hits: () => hits,
    onOpen() {
      view = null;
      requestAnimationFrame(() => { layout(); draw(); });
      layout(); refreshList(); draw();
      ro ??= new ResizeObserver(() => { layout(); draw(); });
      ro.observe(wrap);
    },
    onClose() { ro?.disconnect(); tip.classList.remove('show'); hover = null; listHover = null; },
    refresh() { refreshList(); if (document.hidden) return; draw(); },
    frame(f: FrameInfo) { t = f.time; draw(); },
    key(e) {
      if (!view) return false;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!rows.length) return true;
        const i = rows.indexOf(document.activeElement as HTMLElement);
        pickRow(rows[i < 0 ? (e.key === 'ArrowDown' ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]);
        return true;
      }
      const row = rows.find((r) => r === document.activeElement);
      if (e.key === 'Enter' && row?.dataset.id) {
        const id = row.dataset.id;
        if (e.shiftKey) { ctx.travel(id); ctx.panels.close(); } else ctx.openTerminal(id, { enterAt: e.timeStamp });
        return true;
      }
      if (e.key === '0') { view = fitContent(view.w, view.h, ctx.state(), ctx.b?.player?.() ?? null); return true; }
      if (e.key === '9') { view = fitView(view.w, view.h); return true; }
      if (e.key === '+' || e.key === '=') { view.scale *= 1.25; return true; }
      if (e.key === '-') { view.scale = Math.max(fitView(view.w, view.h).scale * 0.9, view.scale / 1.25); return true; }
      return false;
    },
  };
}

/**
 * Corner minimap: north-up, centred on the player, the same painted chart (a half-resolution copy of the base) with
 * fields, villagers, request hearts, the store and the festival; farmers as status dots. A farmer who needs you pops
 * (bigger, gold) and, when off the map, waits on the rim pointing the way. Click opens the big map.
 */
export function createMinimap(ctx: HudCtx): { el: HTMLElement; frame(f: FrameInfo): void; refresh(): void } {
  const canvas = h('canvas');
  const el = h('div.vh-mini.vh-wood', { title: 'Open the map (M) · toggle minimap (N)', 'data-testid': 'minimap', role: 'button', 'aria-label': 'Minimap' }, canvas, h('div.n', { text: 'N' }));
  el.addEventListener('click', () => ctx.panels.open('map'));
  let g: CanvasRenderingContext2D | null = null;
  let last = -1;
  // the corner size only changes with the window (media queries): measure on resize, never per frame
  let size = -1;
  addEventListener('resize', () => { size = -1; });
  const SIZE = () => (size >= 0 ? size : (size = Math.round(el.clientWidth - 14)));
  function draw(time: number): void {
    const s = ctx.state();
    const player = ctx.b?.player?.() ?? null;
    const on = ctx.prefs.minimap && !!player;
    el.classList.toggle('hide', !on);
    if (!on || !player) return;
    const sz = SIZE();
    if (sz <= 0) return;
    if (!g || canvas.width !== Math.round(sz * Math.min(2, devicePixelRatio || 1))) g = sizeCanvas(canvas, sz, sz);
    const view: View = { cx: player.x, cz: player.z, scale: sz / 90, w: sz, h: sz };
    g.save();
    g.beginPath(); g.arc(sz / 2, sz / 2, sz / 2, 0, Math.PI * 2); g.clip();
    drawValley(g, view, s, { time, locate: ctx.b?.locate, player, mini: true, villagers: ctx.b?.villagers?.(), layers, extra: gather(ctx, time) });
    g.restore();
  }
  return {
    el,
    frame(f) { if (f.time - last < 1 / 30 && f.time >= last) return; last = f.time; draw(f.time); },
    refresh() { if (!ctx.prefs.minimap || !ctx.b?.player) el.classList.add('hide'); },
  };
}
