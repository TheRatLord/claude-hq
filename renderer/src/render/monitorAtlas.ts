/**
 * Live desk monitors (DESIGN §3.5 M3.5, §5.3; RND). Walk up to a Claude and its monitor shows its REAL screen.
 *  - One 2048² atlas = 16 tiles of 512² (4 × 4). A tile is drawn on a 512² scratch canvas and copied into the atlas
 *    with `copyTextureToTexture` (texSubImage2D); at most MAX_UPLOADS (2) tile uploads per frame, no mipmaps.
 *  - A tile shows the last LINES lines of `store.screens` (the `screen` feed) with a light ANSI / Claude-Code tint and
 *    the status strip (status colour, name, task); a blocked desk shows the real question + options in red
 *    (`entity.prompt`, no feed needed).
 *  - Which desks are live: the player-proximity desk (camera ≤ PROX_M from the screen) always wins a tile; then the
 *    nearest in-view, front-facing desks of SEATED owners (blocked desks too), up to 16 tiles. Their ids go to the one
 *    `screen.watch` arbiter (screenFeed.ts) as tags `proximity` / `nearest` (capped at watchMax = 8 there).
 *  - Every other desk keeps its procedural mode (deskScreens.ts), in the same InstancedMesh and program: a live desk is
 *    instanceColor mode 6 + tile (screen.ts samples the shared `uAtlas`). A desk turns live only once its tile holds
 *    content, and returns to procedural when it loses the tile.
 * `__hq.stats().render.monitorAtlas` = {tiles, live, uploadsPerFrame, …}; `__hq.stats().screens` = {deskId: live|proc}.
 * Owner: RND.
 */
import * as THREE from 'three';
import { STATUS } from '../../../shared/palette.ts';
import { taskLabel } from '../../../shared/task.ts';
import { U_ATLAS } from './materials/screen.ts';
import { deskEntries, deskOwned, setDeskTile, updateSpill, screenRect, screenRectFor, type ScreenMode, type PlacedDesk } from './deskScreens.ts';
import type { Ctx } from '../core/ctx.ts';
import type {} from './debugHandle.ts'; // (declares `globalThis.__hqRender`)
import type { Entity } from '../../../shared/protocol.ts';
import type { ScreenSnapshot } from '../net/store.ts';

export const ATLAS = 2048, TILE = 512, GRID = 4, TILES = GRID * GRID;
export const MAX_UPLOADS = 2;
/** Screen lines shown per tile (the brief: 12–16). */
export const LINES = 12;
const PROX_M = 1.5, VIEW_M = 16, PICK_S = 0.25, REDRAW_MIN_MS = 250;
/** Screen aspect of the desk monitors (w / h of the glass, bays.ts: 0.37 × 0.155). */
const ASPECT = 0.37 / 0.155;
const LH = TILE / ASPECT;   // logical tile height (tile is drawn at 512 × LH and stretched to 512², so glyphs map square)

const FONT_MONO = 'ui-monospace, "JetBrains Mono", "Cascadia Code", "SF Mono", "Ubuntu Mono", "DejaVu Sans Mono", monospace';
const FONT_UI = '"Nunito", "Inter", system-ui, sans-serif';

// ---- pure text helpers (monitorAtlas.test.ts) ---------------------------------------------------------------------

/** Claude Code / TUI glyphs many fonts lack → covered look-alikes (as ui/terminal/glyphs.ts does for the drawer). */
const GLYPHS: Readonly<Record<string, string>> = { '⎿': '└', '⏺': '●', '⏵': '▶', '⏴': '◀', '⏸': '‖', '⏹': '■', '⎯': '─', '⏎': '↵', '✶': '✻', '✳': '✻', '✽': '✻', '✢': '✻' };
const GLYPH_RE = new RegExp(`[${Object.keys(GLYPHS).join('')}]`, 'g');
/** @pure */
export const fixGlyphs = (s: string): string => s.replace(GLYPH_RE, (c) => GLYPHS[c]);

export const INK = Object.freeze({
  bg: '#0F1318', text: '#D8D2C4', dim: '#7A828C', clay: '#F0A078', green: '#8FD9A0', red: '#FF7B6B', cyan: '#8CC8F0',
  yellow: '#F2D27A', violet: '#C4A8F0',
});
const SGR: Readonly<Record<number, string>> = { 30: INK.dim, 31: INK.red, 32: INK.green, 33: INK.yellow, 34: INK.cyan, 35: INK.violet, 36: INK.cyan, 37: INK.text, 90: INK.dim, 91: INK.red, 92: INK.green, 93: INK.yellow, 94: INK.cyan, 95: INK.violet, 96: INK.cyan, 97: INK.text };

/** A run of text in one colour. */
export interface TintRun { text: string; color: string }

/**
 * @pure One screen line → coloured runs. ANSI SGR colours (30–37, 90–97, 38;5 / 38;2 ignored → default) when present,
 * else a Claude-Code heuristic: tool bullets clay, result elbows / box rules dim, diff +/− and pass/fail green/red,
 * the input prompt cyan, spinner lines clay.
 */
export function tintLine(line: string): TintRun[] {
  if (line.includes('\x1b[')) {
    const out: TintRun[] = [];
    let color: string = INK.text;
    const re = /\x1b\[([0-9;]*)m/g;
    let last = 0, m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      if (m.index > last) out.push({ text: fixGlyphs(line.slice(last, m.index)), color });
      last = re.lastIndex;
      const codes = m[1].split(';').map(Number);
      for (let i = 0; i < codes.length; i++) {
        const c = codes[i];
        if (c === 0 || c === 39 || m[1] === '') color = INK.text;
        else if (c === 38 || c === 48) { i += codes[i + 1] === 5 ? 2 : 4; }
        else if (SGR[c]) color = SGR[c];
      }
    }
    if (last < line.length) out.push({ text: fixGlyphs(line.slice(last).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')), color });
    return out.filter((r) => r.text);
  }
  const s = fixGlyphs(line);
  const t = s.trimStart();
  if (!t) return [];
  if (/^[●•]/.test(t)) {
    const i = s.indexOf(t[0]);
    return [{ text: s.slice(0, i + 1), color: INK.clay }, { text: s.slice(i + 1), color: INK.text }];
  }
  if (/^[✻*✦·]\s*\w+…|^[✻✦]/.test(t)) return [{ text: s, color: INK.clay }];
  if (/^[╭╰─━┌└├]|^│\s*$/.test(t)) return [{ text: s, color: INK.dim }];
  if (/^│\s*>|^>\s/.test(t)) return [{ text: s, color: INK.cyan }];
  if (/\b(FAIL|FAILED|Error|ERROR|error:|✗|✘|failed)\b|✗|✘/.test(t)) return [{ text: s, color: INK.red }];
  if (/\b(PASS|passed|ok\b|✓|✔)|✓|✔/.test(t)) return [{ text: s, color: INK.green }];
  if (/^\d+\s*\+|^\+(?!\+)/.test(t)) return [{ text: s, color: INK.green }];
  if (/^\d+\s*-|^-(?!-)/.test(t)) return [{ text: s, color: INK.red }];
  if (/^└/.test(t)) return [{ text: s, color: INK.dim }];
  return [{ text: s, color: INK.text }];
}

/**
 * @pure The lines a tile shows: trailing blank lines dropped, then the last `n`.
 */
export function tailLines(lines: readonly string[] | undefined, n = LINES): string[] {
  if (!lines?.length) return [];
  let end = lines.length;
  while (end > 0 && !lines[end - 1].replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim()) end--;
  return lines.slice(Math.max(0, end - n), end);
}

/** @pure Greedy word wrap to `cols` characters (long words are cut). */
export function wrapText(text: string, cols: number): string[] {
  const out: string[] = [];
  for (const para of String(text ?? '').split('\n')) {
    let cur = '';
    for (const w of para.split(/\s+/).filter(Boolean)) {
      let word = w;
      while (word.length > cols) { if (cur) { out.push(cur); cur = ''; } out.push(word.slice(0, cols)); word = word.slice(cols); }
      if (!cur) cur = word;
      else if (cur.length + 1 + word.length <= cols) cur += ` ${word}`;
      else { out.push(cur); cur = word; }
    }
    if (cur) out.push(cur);
  }
  return out;
}

/** A desk considered for a live tile. */
export interface LiveCand { key: string; dist: number; owned: boolean; seated: boolean; visible: boolean; blocked: boolean }

/**
 * @pure Live-desk choice. Proximity desk first (always), then the nearest visible desks of seated owners (blocked
 * desks count as seated: their card is the question), capped at `max`.
 */
export function pickLive(cands: readonly LiveCand[], { max = TILES, prox = PROX_M }: { max?: number; prox?: number } = {}): { prox: string | null; live: string[] } {
  let p: LiveCand | null = null;
  for (const c of cands) if (c.owned && c.dist <= prox && (!p || c.dist < p.dist)) p = c;
  const rest = cands.filter((c) => c !== p && c.owned && c.visible && (c.seated || c.blocked)).sort((a, b) => a.dist - b.dist);
  const live = (p ? [p, ...rest] : rest).slice(0, max).map((c) => c.key);
  return { prox: p?.key ?? null, live };
}

// ---- atlas ---------------------------------------------------------------------------------------------------------

/** Module-level stats (post.ts → `render.monitorAtlas`). */
export interface AtlasStats { tiles: number; live: number; uploadsPerFrame: number; uploadsLastFrame: number; uploads: number; draws: number; watched: number; prox: string | null; updMs: number }
const st: AtlasStats = { tiles: TILES, live: 0, uploadsPerFrame: 0, uploadsLastFrame: 0, uploads: 0, draws: 0, watched: 0, prox: null, updMs: 0 };
export const monitorAtlasStats = (): AtlasStats => ({ ...st });

export interface MonitorAtlas {
  update(c: Ctx): void;
  stats: () => AtlasStats;
  /** absent when there is no DOM / renderer (node tests) */
  texture?: THREE.CanvasTexture;
}

/** One desk's tile: its slot in the atlas and what was last drawn into it. */
interface TileRec {
  tile: number;
  ready: boolean;
  s: ScreenSnapshot | null | undefined;
  at: number | undefined;
  e: Entity | null | undefined;
  mode: ScreenMode | '';
  drawnAt: number;
}

/** `ctx` is the frame context: renderer, camera, store, screens (screenFeed). */
export function createMonitorAtlas(ctx: Ctx): MonitorAtlas {
  const doc = typeof document !== 'undefined' ? document : null;
  if (!doc || !ctx?.renderer) return { update() {}, stats: monitorAtlasStats };
  const renderer = ctx.renderer;
  // the atlas: allocated once from a dark canvas (one upload at boot), then only sub-image copies
  const big = doc.createElement('canvas');
  big.width = big.height = ATLAS;
  const scratch = doc.createElement('canvas');
  scratch.width = scratch.height = TILE;
  const bg = big.getContext('2d'), scratchCtx = scratch.getContext('2d');
  if (!bg || !scratchCtx) return { update() {}, stats: monitorAtlasStats }; // no 2D canvas support
  const g: CanvasRenderingContext2D = scratchCtx; // (a const alias: narrowing does not reach the function declarations below)
  bg.fillStyle = INK.bg; bg.fillRect(0, 0, ATLAS, ATLAS);
  const atlas = new THREE.CanvasTexture(big);
  Object.assign(atlas, { flipY: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, anisotropy: 4, colorSpace: THREE.SRGBColorSpace, name: 'rnd:monitorAtlas' });
  renderer.initTexture(atlas);   // (the canvas stays: a context restore re-uploads it, then tiles redraw as they change)
  U_ATLAS.value = atlas;
  const src = new THREE.CanvasTexture(scratch);
  src.colorSpace = THREE.SRGBColorSpace;
  const dstPos = new THREE.Vector2();

  /** anchor → its tile */
  const recs = new Map<string, TileRec>();
  const free = Array.from({ length: TILES }, (_, i) => TILES - 1 - i);
  let pickClock = PICK_S, liveKeys: string[] = [], proxKey: string | null = null;
  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), toCam = new THREE.Vector3();
  const upHist = new Uint8Array(60);
  let upI = 0;

  // ---- tile drawing (logical 512 × LH, stretched ×ASPECT vertically into the 512² tile) ----
  function strip(color: string, left: string, right: string | null | undefined, ink = '#15181C') {
    g.fillStyle = color; g.fillRect(0, 0, TILE, 22);
    g.fillStyle = ink; g.font = `800 14px ${FONT_UI}`; g.textBaseline = 'middle';
    g.textAlign = 'left'; g.fillText(left, 8, 11.5, TILE * 0.55);
    if (right) { g.textAlign = 'right'; g.font = `700 12px ${FONT_UI}`; g.fillText(right, TILE - 8, 11.5, TILE * 0.42); }
    g.textAlign = 'left';
  }
  function drawBlocked(e: Entity | undefined, s: ScreenSnapshot | undefined) {
    g.fillStyle = '#2A0806'; g.fillRect(0, 0, TILE, LH);
    strip(STATUS.blocked, `! NEEDS YOU · ${e?.name ?? ''}`, taskLabel(e ?? {}) ?? '', '#FFF1EC');
    const p = e?.prompt;
    let y = 30;
    g.textBaseline = 'top';
    if (p?.question) {
      g.fillStyle = '#FFD6CE'; g.font = `700 15px ${FONT_UI}`;
      for (const l of wrapText(fixGlyphs(p.question), 52).slice(0, 4)) { g.fillText(l, 10, y, TILE - 20); y += 18; }
      y += 4;
      g.font = `700 13px ${FONT_MONO}`;
      for (const o of (p.options ?? []).slice(0, 5)) {
        const sel = o.index === (p.selected ?? 0);
        const label = `${o.key ?? ''}${o.key ? '. ' : ''}${fixGlyphs(o.label ?? '')}`.slice(0, 58);
        if (sel) { g.fillStyle = STATUS.blocked; g.fillRect(8, y - 2, Math.min(TILE - 16, g.measureText(label).width + 16), 17); }
        else { g.strokeStyle = '#B8423A'; g.lineWidth = 1; g.strokeRect(8.5, y - 1.5, Math.min(TILE - 17, g.measureText(label).width + 15), 16); }
        g.fillStyle = sel ? '#FFF1EC' : '#FF9A8C';
        g.fillText(label, 16, y, TILE - 32);
        y += 20;
        if (y > LH - 16) break;
      }
    } else {
      // blocked without a parsed prompt: the screen itself, in red
      g.font = `500 13px ${FONT_MONO}`;
      for (const l of tailLines(s?.lines, LINES)) { g.fillStyle = '#FF9A8C'; g.fillText(fixGlyphs(l).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''), 8, y, TILE - 12); y += 15.3; }
    }
  }
  function drawScreen(e: Entity | undefined, s: ScreenSnapshot | undefined, mode: ScreenMode | '') {
    g.fillStyle = INK.bg; g.fillRect(0, 0, TILE, LH);
    const col = mode === 'code' ? STATUS.working : mode === 'done' ? STATUS.done : mode === 'prompt' ? STATUS.shell : STATUS.idle;
    const tag = mode === 'done' ? '✓ done' : mode === 'code' ? (e?.activity?.tool ?? 'working') : mode === 'prompt' ? 'shell' : 'idle';
    strip(col, `${e?.name ?? ''} · ${tag}`, taskLabel(e ?? {}) ?? e?.project ?? '');
    g.font = `500 14px ${FONT_MONO}`; g.textBaseline = 'top';
    let y = 27;
    const lines = tailLines(s?.lines, LINES);
    for (const l of lines) {
      let x = 7;
      for (const r of tintLine(l)) {
        if (x > TILE) break;
        g.fillStyle = r.color;
        g.fillText(r.text, x, y);
        x += g.measureText(r.text).width;
      }
      y += (LH - 29) / LINES;
    }
  }
  function upload(key: string, rec: TileRec, d: PlacedDesk) {
    const e = d.id ? ctx.store?.entities?.get(d.id) : undefined;
    const s = d.id ? ctx.store?.screens?.get(d.id) : undefined;
    g.setTransform(1, 0, 0, TILE / LH, 0, 0);
    if (d.mode === 'blocked' || e?.status === 'blocked') drawBlocked(e, s);
    else drawScreen(e, s, d.mode);
    g.setTransform(1, 0, 0, 1, 0, 0);
    src.needsUpdate = false;
    dstPos.set((rec.tile % GRID) * TILE, Math.floor(rec.tile / GRID) * TILE);
    renderer.copyTextureToTexture(src, atlas, null, dstPos);
    rec.s = s; rec.at = s?.at; rec.e = e; rec.mode = d.mode; rec.drawnAt = performance.now();
    if (!rec.ready) { rec.ready = true; setDeskTile(key, rec.tile); }
    st.draws++;
  }

  function pick(c: Ctx): Map<string, PlacedDesk> {
    const cam = c.camera ?? ctx.camera;
    cam.updateMatrixWorld();
    frustum.setFromProjectionMatrix(pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const cp = cam.position;
    const cands: LiveCand[] = [];
    const byKey = new Map<string, PlacedDesk>();
    for (const [key, d] of deskEntries()) {
      const owned = deskOwned(d);
      if (!owned) continue;
      let dist = Math.hypot(d.pos.x - cp.x, d.pos.z - cp.z) + Math.abs(d.pos.y - cp.y) * 0.5;
      // [UI fix r1, cross-owner RND] the desk UI's walk-up / go-there framed (ctx.walkUpId) is the proximity desk while
      // the camera stays within 3 m of it (its stand spot sits 1.0–2.4 m from the agent, often > PROX_M from the glass)
      if (ctx.walkUpId && d.id === ctx.walkUpId && dist < 3) dist = 0;
      if (dist > VIEW_M) continue;
      toCam.subVectors(cp, d.pos);
      const visible = frustum.containsPoint(d.pos) && toCam.dot(d.normal) > 0.05 * toCam.length();
      cands.push({ key, dist, owned, seated: d.seated, visible, blocked: d.mode === 'blocked' });
      byKey.set(key, d);
    }
    const { prox, live } = pickLive(cands);
    proxKey = prox;
    liveKeys = live;
    // the feed: proximity + the nearest live desks whose owners need screen text (blocked desks draw their prompt)
    const idOf = (k: string) => byKey.get(k)?.id;
    const proxId = prox ? idOf(prox) : null;
    ctx.screens?.want('proximity', proxId ? [proxId] : null);
    ctx.screens?.want('nearest', live.filter((k) => k !== prox).map(idOf).filter((id): id is string => !!id));
    // release tiles of desks that left the live set, then hand free tiles to newcomers
    const want = new Set(live);
    for (const [key, rec] of recs) {
      if (want.has(key)) continue;
      setDeskTile(key, -1);
      free.push(rec.tile);
      recs.delete(key);
    }
    for (const key of live) {
      if (recs.has(key)) continue;
      const tile = free.pop();
      if (tile === undefined) continue;
      recs.set(key, { tile, ready: false, s: null, at: -1, e: null, mode: '', drawnAt: -Infinity });
    }
    return byKey;
  }

  let byKey = new Map<string, PlacedDesk>();
  // debug / review (M3.5): __hqRender.monitors.screenRect('desk:E2:0'), .rectFor(entityId), .shoulder(entityId)
  globalThis.__hqRender = Object.assign(globalThis.__hqRender ?? {}, { monitors: {
    screenRect, rectFor: screenRectFor, stats: monitorAtlasStats, live: () => [...recs].map(([k, r]) => ({ desk: k, tile: r.tile, ready: r.ready, id: byKey.get(k)?.id })),
    /** An over-the-shoulder player pose [x, feetY, z, yaw, pitch] looking at an entity's desk screen. */
    shoulder(id: string, back = 1.05, side = 0.28, eye = 1.2): [number, number, number, number, number] | null {
      const r = screenRectFor(id);
      if (!r) return null;
      const c = r.center, n = r.normal;
      const sx = n.z, sz = -n.x; // plan right of the viewer facing the screen
      const x = c.x + n.x * back + sx * side, z = c.z + n.z * back + sz * side, y = Math.max(c.y + 0.38, eye);
      const dx = c.x - x, dz = c.z - z;
      return [x, y - eye, z, Math.atan2(-dx, -dz), Math.atan2(c.y - y, Math.hypot(dx, dz))];
    },
  } });
  return {
    update(c: Ctx) {
      const t0 = performance.now();
      pickClock += c.rawDt ?? 0.016;
      if (pickClock >= PICK_S) { pickClock = 0; byKey = pick(c); }
      // dirty tiles: new screen text, a new entity object (status, prompt, task), a mode change; proximity first
      let ups = 0;
      const now = performance.now();
      for (const key of liveKeys) {
        if (ups >= MAX_UPLOADS) break;
        const rec = recs.get(key), d = byKey.get(key);
        if (!rec || !d?.id) continue;
        const s = ctx.store?.screens?.get(d.id), e = ctx.store?.entities?.get(d.id);
        const blocked = d.mode === 'blocked' || e?.status === 'blocked';
        if (!blocked && !s) continue;   // no text yet: stay procedural until the feed delivers
        const dirty = !rec.ready || rec.mode !== d.mode || rec.s !== s || rec.at !== s?.at || (rec.e !== e && now - rec.drawnAt > REDRAW_MIN_MS);
        if (!dirty) continue;
        upload(key, rec, d);
        ups++;
      }
      st.uploads += ups;
      st.uploadsLastFrame = ups;
      upHist[upI++ % upHist.length] = ups;
      st.uploadsPerFrame = Math.max(...upHist);
      let live = 0;
      for (const r of recs.values()) if (r.ready) live++;
      st.live = live;
      st.prox = proxKey;
      st.watched = ctx.screens?.watched?.().length ?? 0;
      updateSpill((c.camera ?? ctx.camera).position, c.time ?? 0);
      st.updMs = +(st.updMs * 0.9 + (performance.now() - t0) * 0.1).toFixed(3);
    },
    stats: monitorAtlasStats,
    texture: atlas,
  };
}
