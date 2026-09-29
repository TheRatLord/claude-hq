/**
 * Portraits (DESIGN §5.4; UI hand-off contract from §11.5 "(UI M3) Portrait hand-off"): live clay head portraits of
 * each agent for the roster rows, the status card, drawer tabs and the hotbar.
 *
 *   ctx.portraits.request(id, px) → HTMLCanvasElement|null   a canvas the service keeps repainted for that agent
 *   ctx.portraits.attach(el, id, px) → canvas|null           same, mounted over `el`'s SVG fallback (absolute, inset 0);
 *                                                            the SVG is hidden once the first render lands
 *   ctx.portraits.onReady(fn(id))                             a portrait (re)painted
 *   attachPortrait(el, id, px)                                module-level shortcut (null until main.ts created one)
 *
 * Cost model: a portrait is re-rendered only when what it shows changes (kind, status, ack, workspace colour/stripe,
 * seed): store `entity` events mark it dirty, nothing polls. Dirty portraits are rendered together into the atlas
 * with ONE render call (portraitBatch.ts), at most every REFRESH_MS, deferred while the frame's main + shadow draws are
 * over the §5.3 portrait headroom (115), then read back asynchronously and blitted into each registered canvas.
 * Idle (nothing dirty) = zero per-frame GPU/CPU work. `__hq.stats().portraits` reports it.
 * Owner: CHR.
 */
import { createRig, type Rig } from '../rig/clawd.ts';
import { createAnimator } from '../anim/animator.ts';
import { createPortraitBatch } from './portraitBatch.ts';
import type { CharHandle } from './charBatch.ts';
import { hqStatSection } from '../../core/debug.ts';
import type { Store } from '../../net/store.ts';
import type { Entity } from '../../../../shared/protocol.ts';
import type * as THREE from 'three';

const REFRESH_MS = 250;
const HEADROOM = 115; // §5.3: portraits only on frames where main + shadow < 115
const MAX_DEFER_MS = 2000;
/** Status → portrait pose (face, action) so a row reads at a glance, like ui/dom.ts portraitSvg. */
const POSE: Record<'working' | 'blocked' | 'done' | 'idle' | 'unknown', { face: string; action: string }> = {
  working: { face: 'focused', action: 'portrait' },
  blocked: { face: 'surprised', action: 'portraitAlert' },
  done: { face: 'happy', action: 'portrait' },
  idle: { face: 'sleepy', action: 'portrait' },
  unknown: { face: 'neutral', action: 'portrait' },
};

/** What the service needs of a frame context (`main.ts` passes the CORE ctx). */
export interface PortraitFrameCtx { perf?: { draws?: { main: number; shadow: number } | null } }

export interface PortraitStats { tiles: number; renders: number; rendered: number; lastMs: number; pending: number; deferred: number }

export interface PortraitService {
  /** a canvas the service keeps repainted for that agent (null = unknown agent) */
  request(id: string, px?: number): HTMLCanvasElement | null;
  /** same, mounted over `el`'s SVG fallback (absolute, inset 0); the SVG is hidden once the first render lands */
  attach(el: HTMLElement, id: string, px?: number): HTMLCanvasElement | null;
  /** a portrait (re)painted; returns the unsubscribe */
  onReady(fn: (id: string) => void): () => boolean;
  /** frame hook (main.ts, after post.render): renders dirty portraits, at most every REFRESH_MS */
  update(c?: PortraitFrameCtx): void;
  /** force every portrait to re-render (context restore, debug) */
  invalidate(): void;
  stats(): PortraitStats;
  /** debug: the 2D atlas canvas */
  atlas(): HTMLCanvasElement;
  dispose(): void;
}

declare global {
  // debug handle (devtools / review): __hqPortraits.atlas()
  var __hqPortraits: PortraitService | undefined;
}

let current: PortraitService | null = null;
/** The live service (null in the hero sheet / tests / before main.ts created one). */
export const portraitService = () => current;
/**
 * Mount (or reuse) the live portrait canvas for agent `id` inside `el` (over its SVG fallback). Null = no service.
 */
export const attachPortrait = (el: HTMLElement, id: string, px: number): HTMLCanvasElement | null => current?.attach(el, id, px) ?? null;

/** The Entity fields a portrait shows. */
export interface PortraitEntity {
  id: string;
  kind: string;
  status?: string;
  ack?: unknown;
  seedKey?: string;
  process?: { activity?: string | null } | null;
  workspace?: { colorIndex?: number; cycle?: number } | null;
}

/** What a portrait shows: re-render only when this changes. */
export const portraitKey = (e: PortraitEntity): string => `${e.kind}|${e.kind === 'shell' ? e.process?.activity ?? '' : e.status}|${e.ack ? 1 : 0}|${e.workspace?.colorIndex ?? 0}|${e.workspace?.cycle ?? 0}|${e.seedKey ?? e.id}`;

export interface PortraitsOptions {
  renderer: THREE.WebGLRenderer;
  lights?: { key?: THREE.DirectionalLight | null } | null;
  store: Pick<Store, 'entities' | 'on'>;
  tile?: number;
  cols?: number;
  rows?: number;
}

/** One agent's atlas tile. */
interface Tile {
  id: string;
  slot: number;
  rig: Rig;
  handle: CharHandle;
  key: string;
  painted: boolean;
  canvases: Set<HTMLCanvasElement>;
  used: number;
}

export function createPortraits({ renderer, lights = null, store, tile = 64, cols = 8, rows = 8 }: PortraitsOptions): PortraitService {
  const pb = createPortraitBatch({ renderer, key: lights?.key ?? null, tile, cols, rows });
  const capacity = cols * rows;
  const atlas = document.createElement('canvas');
  atlas.width = pb.width; atlas.height = pb.height;
  const actx = atlas.getContext('2d') as CanvasRenderingContext2D; // a fresh canvas always has a 2d context
  const tiles = new Map<string, Tile>();
  const dirty = new Set<string>();
  const freeSlots: number[] = [];
  for (let i = capacity - 1; i >= 0; i--) freeSlots.push(i);
  const ready = new Set<(id: string) => void>();
  const stats: PortraitStats = { tiles: 0, renders: 0, rendered: 0, lastMs: 0, pending: 0, deferred: 0 };
  let nextAt = 0, deferSince = 0, inFlight = false;

  /** Evict the least recently requested tile (its canvases fall back to SVG until re-requested). */
  const evict = () => {
    let lru: Tile | null = null;
    for (const t of tiles.values()) if (!lru || t.used < lru.used) lru = t;
    if (lru) drop(lru.id);
  };
  const drop = (id: string) => {
    const t = tiles.get(id);
    if (!t) return;
    t.handle.remove();
    freeSlots.push(t.slot);
    for (const c of t.canvases) { c.dataset.ready = ''; showFallback(c, true); }
    tiles.delete(id); dirty.delete(id);
  };
  const tileFor = (id: string): Tile | null => {
    let t = tiles.get(id);
    if (t) return t;
    const e = store.entities.get(id);
    if (!e) return null;
    if (!freeSlots.length) evict();
    const slot = freeSlots.pop()!; // evict() above freed one when none was left (capacity ≥ 1)
    const rig = createRig({ kind: e.kind, seedKey: e.seedKey ?? e.id });
    if (rig.species === 'clawd') rig.nodes.blob.visible = false; // (Shelly's contact blob has no node handle)
    rig.root.rotation.y = 0.45; // front 3/4
    const handle = pb.batch.register(rig, { kind: e.kind, colorIndex: e.workspace?.colorIndex ?? 0, cycle: e.workspace?.cycle ?? 0 });
    handle.setVisible(false);
    t = { id, slot, rig, handle, key: '', painted: false, canvases: new Set(), used: performance.now() };
    tiles.set(id, t);
    dirty.add(id);
    return t;
  };

  /** Pose the portrait rig for the entity's current state (a fresh animator: deterministic, never mid-blink). */
  const pose = (t: Tile, e: Entity) => {
    if (t.rig.species !== 'shelly' && t.rig.accessory && (t.rig.accessory.index !== (e.workspace?.colorIndex ?? 0) % 8 || t.rig.accessory.cycle !== (e.workspace?.cycle ?? 0))) {
      // workspace changed: re-register so the accessory + colours follow
      t.handle.remove();
      t.handle = pb.batch.register(t.rig, { kind: e.kind, colorIndex: e.workspace?.colorIndex ?? 0, cycle: e.workspace?.cycle ?? 0 });
    }
    const anim = createAnimator(t.rig, { seedKey: e.seedKey ?? e.id });
    const st = e.status === 'done' || e.status === 'blocked' || e.status === 'working' || e.status === 'idle' ? e.status : 'unknown';
    const p = POSE[st];
    anim.setFace(e.kind === 'shell' ? (e.process?.activity && e.process.activity !== 'prompt' ? 'focused' : 'neutral') : p.face);
    anim.setAction(e.kind === 'shell' ? null : p.action);
    const yaw = t.rig.root.rotation.y;
    for (let i = 0; i < 24; i++) { anim.update(1 / 30, 0); t.rig.root.rotation.y = yaw; }
    t.key = portraitKey(e);
  };

  const showFallback = (c: HTMLCanvasElement, show: boolean) => {
    const p = c.parentElement;
    if (!p) return;
    for (const s of p.children) if (s !== c && s.tagName === 'svg' && s instanceof SVGElement) s.style.visibility = show ? '' : 'hidden';
  };
  const paint = (t: Tile) => {
    const sx = (t.slot % cols) * tile, sy = Math.floor(t.slot / cols) * tile;
    for (const c of t.canvases) {
      if (!c.isConnected) { t.canvases.delete(c); continue; }
      const g = c.getContext('2d');
      if (!g) continue;
      g.clearRect(0, 0, c.width, c.height);
      g.imageSmoothingQuality = 'high';
      g.drawImage(atlas, sx, sy, tile, tile, 0, 0, c.width, c.height);
      c.dataset.ready = '1';
      showFallback(c, false);
    }
    t.painted = true;
    for (const fn of ready) { try { fn(t.id); } catch (err) { console.warn('[portraits] onReady', err); } }
  };
  const newCanvas = (px: number) => {
    const c = document.createElement('canvas');
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    c.width = c.height = Math.max(16, Math.min(tile, Math.round(px * dpr)));
    c.className = 'hq-portrait';
    c.setAttribute('aria-hidden', 'true');
    c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;border-radius:inherit';
    return c;
  };

  store.on?.('entity', (e) => {
    const t = tiles.get(e?.id);
    if (t && portraitKey(e) !== t.key) dirty.add(e.id);
  });
  store.on?.('gone', (m) => { if (m?.id) drop(m.id); });

  const api: PortraitService = {
    request(id, px = 34) {
      const t = tileFor(id);
      if (!t) return null;
      t.used = performance.now();
      const c = newCanvas(px);
      t.canvases.add(c);
      if (t.painted && !dirty.has(id)) queueMicrotask(() => paint(t)); // already in the atlas: blit on the next tick
      return c;
    },
    attach(el, id, px = 34) {
      if (!el) return null;
      let c = el.querySelector<HTMLCanvasElement>(':scope > canvas.hq-portrait');
      if (c && c.dataset.pid === id) {
        const t = tiles.get(id);
        if (t) { t.used = performance.now(); t.canvases.add(c); if (c.dataset.ready === '1') showFallback(c, false); }
        return c;
      }
      c?.remove();
      c = api.request(id, px);
      if (!c) return null;
      c.dataset.pid = id;
      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      el.append(c);
      return c;
    },
    onReady(fn) { ready.add(fn); return () => ready.delete(fn); },
    update(c) {
      stats.pending = dirty.size;
      if (!dirty.size || inFlight) return;
      const now = performance.now();
      if (now < nextAt) return;
      const d = c?.perf?.draws;
      if (d && d.main + d.shadow >= HEADROOM) {
        if (!deferSince) deferSince = now;
        if (now - deferSince < MAX_DEFER_MS) { stats.deferred++; return; }
      }
      deferSince = 0;
      const items: Tile[] = [];
      for (const id of dirty) {
        const e = store.entities.get(id);
        const t = tiles.get(id);
        if (!e || !t) { dirty.delete(id); continue; }
        pose(t, e);
        items.push(t);
      }
      dirty.clear();
      if (!items.length) return;
      for (const t of tiles.values()) t.handle.setVisible(items.includes(t));
      const t0 = performance.now();
      inFlight = true;
      nextAt = now + REFRESH_MS;
      pb.render(items).then((img) => {
        stats.lastMs = +(performance.now() - t0).toFixed(2);
        if (!img) { for (const t of items) dirty.add(t.id); return; }
        // blit only the refreshed tiles into the 2D atlas (others keep their pixels)
        const id = new ImageData(img.data, img.width, img.height);
        for (const t of items) {
          const sx = (t.slot % cols) * tile, sy = Math.floor(t.slot / cols) * tile;
          actx.putImageData(id, 0, 0, sx, sy, tile, tile);
          paint(t);
        }
        stats.renders++; stats.rendered += items.length;
      }).catch((err) => { console.warn('[portraits] render failed', err instanceof Error ? err.message : err); }).finally(() => {
        inFlight = false;
        for (const t of items) t.handle.setVisible(false);
      });
      stats.tiles = tiles.size;
    },
    invalidate() { for (const id of tiles.keys()) dirty.add(id); },
    stats: () => ({ ...stats, tiles: tiles.size, pending: dirty.size }),
    atlas: () => atlas,
    dispose() { for (const id of [...tiles.keys()]) drop(id); pb.dispose(); if (current === api) current = null; },
  };
  current = api;
  globalThis.__hqPortraits = api; // debug handle (devtools / review): __hqPortraits.atlas()
  hqStatSection('portraits', () => api.stats());
  return api;
}
