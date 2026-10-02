/**
 * Photo mode (P) and the camera that fills the album (docs/valley/album.md, tools.md#in-game-keys).
 *
 * The HUD steps away, the camera leaves your body and flies (WASD along the view, Space / C up and down, Shift
 * faster), the mouse wheel zooms, [ and ] wind the clock back and forth (hold to scrub; R returns to the time you had).
 * Then:
 *  - 1–6 a look (model/album.ts FILTERS: natural, warm film, sepia, black & white, dreamy bloom, tilt-shift focused on
 *    the crosshair target), V a frame (none, a polaroid with a handwritten caption, a "Greetings from Claude Valley"
 *    postcard), G a rule-of-thirds grid, N name tags in the picture (off: the farmers' nameplates stay out of it),
 *    T a self-timer (off / 3 s / 10 s), X also download a framed PNG on every save;
 *  - F focuses on whoever is at the crosshair and says cheese: nearby farmers, villagers and your pet glance at the
 *    camera and pose for a moment (service 'photo' → `cheese()`, scene/cheese.ts); the self-timer does the same;
 *  - Enter takes the picture (or starts the timer): developed in farm/photolab.ts, stored in the album
 *    (farm/albumstore.ts, IndexedDB: ≤ 1600 px + a thumbnail) with the date, the place (nearest landmark / field /
 *    trail spot, or the room you are in), time of day, weather and who is in frame, and a first caption;
 *  - L leaves for the album; P or Esc puts everything back.
 * The viewfinder previews the look with CSS over the canvas (filters, crop, grid, tilt-shift band); none of it is
 * in the picture, which is developed from the canvas pixels. Everything photo mode draws sits outside the canvas.
 */
import * as THREE from 'three';
import type { Controller } from './player/controller.ts';
import type { Engine } from './scene/engine.ts';
import type { AudioService, CheeseCue, FarmerLocator, IndoorSpace, PetsService, PhotoService, VillagersService } from './scene/context.ts';
import type { Valley } from './model/valley.ts';
import type { CompanionService } from './model/pet.ts';
import type { AlbumService } from './albumstore.ts';
import {
  FILTERS, FRAMES, MAX_EDGE, STRUCTURE_PLACES, THUMB_EDGE, TIMERS, autoCaption, cropRect, cycle, fitSize, focusSubject, framedSubjects,
  hourText, nearestPlace, photoFileName, photoId, sanitizePhotoPrefs, unoccluded,
} from './model/album.ts';
import type { FilterId, PhotoMeta, PhotoPrefs, Place, SubjectCandidate } from './model/album.ts';
import { FILTER_BASE, canvas2d, compose, develop, download, drawTags, toBlob } from './photolab.ts';
import { POIS, POND, SITES, STRUCTURES, WORLD, heightAt } from './world/map.ts';
import { readJson, writeJson } from './storage.ts';

export interface PhotoMode extends PhotoService {
  readonly on: boolean;
  toggle(on?: boolean): void;
  /** a picture was saved (the stamp book listens: model/stamps.ts) */
  onSave(fn: (meta: PhotoMeta) => void): () => void;
  /** the viewfinder settings (filter, frame, grid, tags, timer, download); a patch applies and persists */
  prefs(patch?: Partial<PhotoPrefs>): PhotoPrefs;
  /** take the picture now (no timer); resolves with the stored record, null if it could not be saved */
  snap(): Promise<PhotoMeta | null>;
  /** focus on the crosshair target and say cheese (F) */
  focus(): string | null;
  /** dev: who would be in frame right now */
  inFrame(): SubjectCandidate[];
}

export interface PhotoDeps {
  album: AlbumService;
  /** leave photo mode for the album (L) */
  openAlbum(): void;
}

const FOV = 62;
const PREFS_KEY = 'valley.hud.photo';
const CHEESE_MS = 3600;

export function installPhotoMode(engine: Engine, controller: Controller, valley: Valley, canvas: HTMLCanvasElement, deps: PhotoDeps): PhotoMode {
  const ctx = engine.ctx;
  let on = false, hour: number | null = null, scrub = 0, leaving = 0;
  /** the clock override photo mode found on entry (restored on exit) */
  let entryHour: number | null = null;
  let prefs: PhotoPrefs = sanitizePhotoPrefs(readJson(PREFS_KEY));
  let cue: CheeseCue | null = null;
  let focusId: string | null = null, focusUntil = 0;
  let countdown: { at: number; secs: number } | null = null;
  let busy = false;
  const audio = () => ctx.services.get('audio') as AudioService | undefined;

  // ------------------------------------------------------------------------------------------- DOM
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => { const e = document.createElement(tag); e.className = cls; if (text) e.textContent = text; return e; };
  const bar = el('div', 'vh-photo-bar');
  bar.setAttribute('data-testid', 'photo-bar');
  const chips = el('div', 'ph-chips');
  const keysRow = el('div', 'ph-keys');
  const clock = el('b', ''), zoom = el('b', '');
  const kb = (k: string, what: string) => `<span><kbd>${k}</kbd> ${what}</span>`;
  keysRow.innerHTML = `<span class="t">Photo mode</span>${kb('WASD', 'fly')}${kb('Space / C', 'up / down')}${kb('Wheel', 'zoom')}${kb('[ ]', 'time')}${kb('F', 'say cheese')}${kb('Enter', 'snap')}${kb('L', 'album')}${kb('P', 'back')}`;
  const info = el('span', 'i');
  info.append(clock, ' · ', zoom);
  keysRow.append(info);
  bar.append(chips, keysRow);
  const chip = (id: string, key: string) => { const c = el('span', 'ph-chip'); c.setAttribute('data-testid', `photo-${id}`); c.dataset.key = key; chips.append(c); return c; };
  const cFilter = chip('filter', '1–6'), cFrame = chip('frame', 'V'), cGrid = chip('grid', 'G'), cTags = chip('tags', 'N'), cTimer = chip('timer', 'T'), cDl = chip('download', 'X');

  const view = el('div', 'ph-view');      // the viewfinder overlays (over the canvas, under the bar)
  const tint = el('div', 'ph-tint'), vig = el('div', 'ph-vig'), bloom = el('div', 'ph-bloom'), tiltA = el('div', 'ph-tilt a'), tiltB = el('div', 'ph-tilt b');
  const crop = el('div', 'ph-crop'), grid = el('div', 'ph-grid');
  grid.innerHTML = '<i></i><i></i><i></i><i></i>';
  crop.append(grid);
  const brackets = el('div', 'ph-focus');
  brackets.innerHTML = '<i></i><i></i><i></i><i></i>';
  const focusName = el('span', 'ph-fname');
  brackets.append(focusName);
  const tagLayer = el('div', 'ph-tags');
  const count = el('div', 'ph-count');
  const cheeseNote = el('div', 'ph-cheese', 'Say cheese!');
  const dims = [el('div', 'ph-dim'), el('div', 'ph-dim'), el('div', 'ph-dim'), el('div', 'ph-dim')];
  view.append(tint, vig, bloom, tiltA, tiltB, ...dims, crop, tagLayer, brackets, count, cheeseNote);
  const flash = el('div', 'vh-photo-flash');
  const saved = el('div', 'ph-saved');
  saved.setAttribute('data-testid', 'photo-saved');
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  document.body.append(view, bar, flash, saved);

  const filterName = (f: FilterId) => FILTERS.find((x) => x.id === f)?.name ?? f;
  function renderChips(): void {
    const set = (c: HTMLElement, label: string, onState: boolean) => { c.innerHTML = `<kbd>${c.dataset.key}</kbd> ${label}`; c.classList.toggle('on', onState); };
    set(cFilter, filterName(prefs.filter), prefs.filter !== 'none');
    set(cFrame, FRAMES.find((x) => x.id === prefs.frame)?.name ?? '', prefs.frame !== 'none');
    set(cGrid, 'Grid', prefs.grid);
    set(cTags, prefs.tags ? 'Name tags in' : 'Name tags hidden', prefs.tags);
    set(cTimer, prefs.timer ? `Timer ${prefs.timer} s` : 'Timer off', prefs.timer > 0);
    set(cDl, prefs.download ? 'Also PNG' : 'Album only', prefs.download);
    view.dataset.filter = prefs.filter;
    view.classList.toggle('grid', prefs.grid);
    view.classList.toggle('framed', prefs.frame !== 'none');
    canvas.style.filter = on && prefs.filter !== 'none' ? FILTER_BASE[prefs.filter] : '';
  }
  function setPrefs(patch: Partial<PhotoPrefs>): void {
    prefs = sanitizePhotoPrefs({ ...prefs, ...patch });
    writeJson(PREFS_KEY, prefs);
    renderChips();
    layout();
  }

  const refresh = () => {
    const h = valley.state.sky.hour;
    clock.textContent = `${hourText(h)}${hour === null ? ' (now)' : ''}`;
    zoom.textContent = `${Math.round(ctx.camera.fov)}°`;
  };

  const setHour = (h: number | null) => {
    hour = h === null ? null : ((h % 24) + 24) % 24;
    valley.setSky({ hour });
    refresh();
  };

  // ------------------------------------------------------------------------------------------- who is in frame
  const tmp = new THREE.Vector3(), fwd = new THREE.Vector3(), rel = new THREE.Vector3();
  const indoors = () => ctx.services.get('indoors') as IndoorSpace | undefined;
  /** the candidates in crop space (sx, sy 0..1 over the picture's crop) */
  function candidates(W: number, H: number): SubjectCandidate[] {
    const out: SubjectCandidate[] = [];
    const cam = ctx.camera;
    cam.updateMatrixWorld();
    cam.getWorldDirection(fwd);
    const cr = cropRect(W, H, prefs.frame);
    const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * 2;
    const inside = !!indoors()?.active;
    const aspect = W / Math.max(1, H);
    const push = (kind: SubjectCandidate['kind'], id: string, name: string, x: number, y: number, z: number, tall: number, half = tall * 0.42) => {
      if (!name) return;
      tmp.set(x, y, z);
      const depth = rel.subVectors(tmp, cam.position).dot(fwd);
      if (depth <= 0.3) return;
      if (inside && cam.position.distanceTo(tmp) > 9) return;
      if (!inside && occluded(cam.position, tmp)) return;
      tmp.project(cam);
      const px = ((tmp.x + 1) / 2) * W, py = ((1 - tmp.y) / 2) * H;
      out.push({ kind, id, name, sx: (px - cr.x) / cr.w, sy: (py - cr.y) / cr.h, depth, size: (tall / depth / tanH) * (H / cr.h), hw: (half / depth / (tanH * aspect)) * (W / cr.w) });
    };
    const s = valley.state;
    const loc = ctx.services.get('farmers') as FarmerLocator | undefined;
    if (!inside) {
      for (const f of s.farmers.values()) { const p = loc?.head(f.id); if (p) push('farmer', f.id, f.tag, p.x, p.y + 0.15, p.z, 1.3, 0.55); }
      for (const f of s.helpers.values()) { const p = loc?.head(f.id); if (p) push('helper', f.id, f.tag, p.x, p.y + 0.15, p.z, 1.3, 0.45); }
      for (const v of (ctx.services.get('villagers') as VillagersService | undefined)?.list() ?? []) if (!v.inside) push('villager', v.id, v.name, v.x, heightAt(v.x, v.z) + 1.45, v.z, 1.4);
      for (const p of (ctx.services.get('pets') as PetsService | undefined)?.list() ?? []) push('pet', p.id, p.name, p.x, heightAt(p.x, p.z) + 0.6, p.z, 0.6);
    }
    const me = (ctx.services.get('companion') as CompanionService | undefined)?.where?.();
    if (me) push('pet', 'pet', me.name, me.x, me.y + 0.6, me.z, 0.6);
    return out;
  }
  /** a ridge between the camera and the subject (terrain only: buildings and trees are not checked) */
  function occluded(a: THREE.Vector3, b: THREE.Vector3): boolean {
    for (let i = 1; i < 10; i++) {
      const t = i / 10, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, y = a.y + (b.y - a.y) * t;
      if (heightAt(x, z) > y + 0.4) return true;
    }
    return false;
  }
  /** where the crosshair ray meets the ground (ray-marched), null past 120 m */
  const hit = new THREE.Vector3();
  function groundHit(): THREE.Vector3 | null {
    const cam = ctx.camera;
    cam.getWorldDirection(fwd);
    let prev = 0;
    for (let d = 0.5; d < 120; d *= 1.08) {
      tmp.copy(cam.position).addScaledVector(fwd, d);
      if (tmp.y < Math.max(heightAt(tmp.x, tmp.z), WORLD.water)) {
        // refine between prev and d
        let lo = prev, hi = d;
        for (let k = 0; k < 8; k++) { const m = (lo + hi) / 2; tmp.copy(cam.position).addScaledVector(fwd, m); if (tmp.y < Math.max(heightAt(tmp.x, tmp.z), WORLD.water)) hi = m; else lo = m; }
        return hit.copy(cam.position).addScaledVector(fwd, hi);
      }
      prev = d;
    }
    return null;
  }

  // ------------------------------------------------------------------------------------------- places
  const places: Place[] = [
    { id: 'square', name: 'the village square', x: 0, z: -2, r: 11 },
    { id: 'pond', name: 'the pond', x: POND.x, z: POND.z, r: POND.r + 7 },
    ...STRUCTURES.filter((s) => STRUCTURE_PLACES[s.id]).map((s) => ({ id: s.id, name: STRUCTURE_PLACES[s.id].name, x: s.x, z: s.z, r: STRUCTURE_PLACES[s.id].r })),
    ...POIS.map((p) => ({ id: p.id, name: `the ${p.name.charAt(0).toLowerCase()}${p.name.slice(1)}`, x: p.x, z: p.z, r: p.kind === 'lookout' ? 16 : 10 })),
  ];
  function placeAt(x: number, z: number): string {
    const room = indoors();
    if (room?.active) return room.room === 'barn' ? 'inside the barn' : 'inside the farmhouse';
    const plots: Place[] = [];
    for (const p of valley.state.plots.values()) { const site = SITES[p.site]; if (site && p.label) plots.push({ id: `plot:${p.id}`, name: `the ${p.label} field`, x: site.x, z: site.z, r: Math.max(site.w, site.d) * 0.6 }); }
    return nearestPlace(x, z, [...places, ...plots])?.name ?? (Math.hypot(x, z) > WORLD.half * 0.8 ? 'out by the valley rim' : 'out in the valley');
  }

  // ------------------------------------------------------------------------------------------- viewfinder layout
  let lastCands: SubjectCandidate[] = [];
  let focusY = 0.5, band = 0.24;
  const tagEls: HTMLElement[] = [];
  function layout(): void {
    if (!on) return;
    const r = canvas.getBoundingClientRect();
    const cr = cropRect(r.width, r.height, prefs.frame);
    Object.assign(crop.style, { left: `${r.left + cr.x}px`, top: `${r.top + cr.y}px`, width: `${cr.w}px`, height: `${cr.h}px` });
    // what the frame crops away, dimmed: above, below, left, right of the crop
    const px = (v: number) => `${Math.max(0, v)}px`;
    Object.assign(dims[0].style, { left: px(r.left), top: px(r.top), width: px(r.width), height: px(cr.y) });
    Object.assign(dims[1].style, { left: px(r.left), top: px(r.top + cr.y + cr.h), width: px(r.width), height: px(r.height - cr.y - cr.h) });
    Object.assign(dims[2].style, { left: px(r.left), top: px(r.top + cr.y), width: px(cr.x), height: px(cr.h) });
    Object.assign(dims[3].style, { left: px(r.left + cr.x + cr.w), top: px(r.top + cr.y), width: px(r.width - cr.x - cr.w), height: px(cr.h) });
    const y = r.top + cr.y + cr.h * focusY, bh = cr.h * band;
    // the tilt-shift preview: blurred above and below the sharp band
    Object.assign(tiltA.style, { top: `${r.top}px`, height: `${Math.max(0, y - bh / 2 - r.top)}px` });
    Object.assign(tiltB.style, { top: `${y + bh / 2}px`, height: `${Math.max(0, r.bottom - y - bh / 2)}px` });
  }
  function track(): void {
    const r = canvas.getBoundingClientRect();
    lastCands = candidates(r.width, r.height);
    const now = performance.now();
    const framed = framedSubjects(lastCands);
    const focused = focusId && now < focusUntil ? lastCands.find((c) => c.id === focusId) ?? null : focusSubject(unoccluded(lastCands));
    // the tilt band follows the subject in focus, else the crosshair's ground point
    if (focused) { focusY = Math.min(0.9, Math.max(0.1, focused.sy + focused.size * 0.3)); band = Math.min(0.4, Math.max(0.14, focused.size * 1.4)); }
    else {
      focusY = 0.5;
      const g = groundHit();
      band = g ? Math.min(0.4, Math.max(0.14, 0.12 + g.distanceTo(ctx.camera.position) / 160)) : 0.36;
    }
    // brackets on the subject (gold once focused with F)
    const cr = cropRect(r.width, r.height, prefs.frame);
    const fx = focused ? focused.sx : 0.5, fy = focused ? focused.sy + focused.size * 0.3 : 0.5;
    const bs = focused ? Math.max(46, Math.min(220, focused.size * cr.h * 1.1)) : 54;
    Object.assign(brackets.style, { left: `${r.left + cr.x + fx * cr.w - bs / 2}px`, top: `${r.top + cr.y + fy * cr.h - bs / 2}px`, width: `${bs}px`, height: `${bs}px` });
    brackets.classList.toggle('locked', !!focused && focusId === focused.id && now < focusUntil);
    brackets.classList.toggle('subject', !!focused);
    focusName.textContent = focused ? focused.name : '';
    // name tags preview
    const show = prefs.tags ? framed : [];
    while (tagEls.length < show.length) { const t = el('span', 'ph-tag'); tagLayer.append(t); tagEls.push(t); }
    tagEls.forEach((t, i) => {
      const s = show[i];
      t.style.display = s ? '' : 'none';
      if (!s) return;
      if (t.textContent !== s.name) t.textContent = s.name;
      t.style.transform = `translate(${r.left + cr.x + s.sx * cr.w}px, ${r.top + cr.y + s.sy * cr.h}px) translate(-50%, -140%)`;
    });
    layout();
  }

  // ------------------------------------------------------------------------------------------- say cheese
  function sayCheese(id: string | null, ms = CHEESE_MS): void {
    const cam = ctx.camera;
    cam.getWorldDirection(fwd);
    const l = Math.hypot(fwd.x, fwd.z) || 1;
    const now = performance.now();
    cue = { x: cam.position.x, y: cam.position.y, z: cam.position.z, dx: fwd.x / l, dz: fwd.z / l, from: now, until: now + ms, focus: id };
    cheeseNote.classList.remove('go'); void cheeseNote.offsetWidth; cheeseNote.classList.add('go');
  }
  function focus(): string | null {
    const r = canvas.getBoundingClientRect();
    lastCands = candidates(r.width, r.height);
    const f = focusSubject(unoccluded(lastCands));
    focusId = f?.id ?? null;
    focusUntil = performance.now() + CHEESE_MS + 1500;
    sayCheese(focusId);
    audio()?.play('ui-click', { volume: 0.6, pitch: 1.4 });
    return focusId;
  }

  // ------------------------------------------------------------------------------------------- the picture
  const listeners = new Set<(m: PhotoMeta) => void>();
  let savedTimer = 0;
  function showSaved(thumb: Blob | null, title: string, sub: string, ok: boolean): void {
    saved.replaceChildren();
    if (thumb) {
      const img = document.createElement('img');
      const url = URL.createObjectURL(thumb);
      img.src = url;
      img.onload = img.onerror = () => setTimeout(() => URL.revokeObjectURL(url), 100);
      saved.append(img);
    }
    const t = el('div', 't'); t.append(el('b', '', title), el('span', '', sub));
    saved.append(t);
    saved.classList.toggle('bad', !ok);
    saved.classList.remove('go'); void saved.offsetWidth; saved.classList.add('go');
    clearTimeout(savedTimer);
    savedTimer = window.setTimeout(() => saved.classList.remove('go'), 3800);
  }

  async function snap(): Promise<PhotoMeta | null> {
    if (busy) return null;
    busy = true;
    try {
      const p = prefs;
      // 1. the frame, straight from the GPU (same task as the render: the drawing buffer is still valid)
      engine.renderOnce();
      const W = canvas.width, H = canvas.height;
      const cr = cropRect(W, H, p.frame);
      const size = fitSize(cr.w, cr.h, MAX_EDGE);
      const raw = canvas2d(size.w, size.h);
      raw.g.drawImage(canvas, cr.x, cr.y, cr.w, cr.h, 0, 0, size.w, size.h);
      // 2. what the camera knew
      const r = canvas.getBoundingClientRect();
      const cands = candidates(r.width, r.height);
      const who = framedSubjects(cands);
      const fsub = focusId && performance.now() < focusUntil ? cands.find((c) => c.id === focusId) ?? null : focusSubject(unoccluded(cands));
      const g = fsub ? null : groundHit();
      const fp = fsub ? { x: 0, z: 0 } : g ? { x: g.x, z: g.z } : { x: ctx.camera.position.x, z: ctx.camera.position.z };
      if (fsub) {
        // the subject's world spot: from the locators again (cheap)
        const loc = ctx.services.get('farmers') as FarmerLocator | undefined;
        const h = loc?.position(fsub.id);
        const v = (ctx.services.get('villagers') as VillagersService | undefined)?.list().find((x) => x.id === fsub.id);
        if (h) { fp.x = h.x; fp.z = h.z; } else if (v) { fp.x = v.x; fp.z = v.z; } else { fp.x = ctx.camera.position.x; fp.z = ctx.camera.position.z; }
      }
      const at = Date.now();
      const sky = valley.state.sky;
      const meta: PhotoMeta = {
        id: photoId(at, Math.random()), at, hour: sky.hour, season: sky.season, weather: sky.weather.kind,
        place: placeAt(fp.x, fp.z), who: who.map((c) => ({ kind: c.kind, id: c.id, name: c.name })),
        caption: '', fav: false, favAt: 0, filter: p.filter, frame: p.frame, w: size.w, h: size.h,
      };
      meta.caption = autoCaption(meta);
      // 3. develop
      const fy = fsub ? fsub.sy + fsub.size * 0.3 : 0.5;
      const dev = develop(raw.c, size.w, size.h, p.filter, { x: fsub ? fsub.sx : 0.5, y: fy, band: fsub ? Math.min(0.4, Math.max(0.14, fsub.size * 1.4)) : band });
      if (p.tags) drawTags(dev, who.map((c) => ({ name: c.name, sx: c.sx, sy: c.sy, kind: c.kind })));
      const ts = fitSize(size.w, size.h, THUMB_EDGE);
      const th = canvas2d(ts.w, ts.h);
      th.g.imageSmoothingQuality = 'high';
      th.g.drawImage(dev, 0, 0, ts.w, ts.h);
      const [full, thumb] = await Promise.all([toBlob(dev, 'image/jpeg', 0.92), toBlob(th.c, 'image/jpeg', 0.86)]);
      // 4. keep it
      let stored = false;
      if (full && thumb) {
        const res = await deps.album.add(meta, full, thumb);
        stored = res.ok;
        if (res.ok) showSaved(thumb, deps.album.persistent ? 'Saved to your album' : 'Kept for this session', deps.album.persistent ? `${meta.place} · L opens the album` : 'this browser blocks storage: X also saves PNG files', deps.album.persistent);
        else showSaved(thumb, 'The album is full of favourites', 'un-heart a few in the album (L) to make room', false);
      } else showSaved(null, 'Could not develop that one', 'try again', false);
      if (p.download || !stored) {
        const framed = compose(dev, size.w, size.h, p.frame, { caption: meta.caption, place: meta.place, at, hour: meta.hour, id: meta.id });
        const png = await toBlob(framed, 'image/png');
        if (png) download(png, photoFileName(meta));
      }
      for (const f of [...listeners]) { try { f(meta); } catch (err) { console.error('[photo] listener threw', err); } }
      return stored ? meta : null;
    } catch (e) {
      console.error('[photo] snap failed', e);
      return null;
    } finally { busy = false; }
  }
  function shutter(): void {
    flash.classList.add('go');
    requestAnimationFrame(() => requestAnimationFrame(() => flash.classList.remove('go')));
    audio()?.play('shutter', { volume: 0.8 });
    void snap();
  }
  function enter(): void {
    if (countdown) { countdown = null; count.classList.remove('go'); return; } // Enter again cancels the timer
    if (!prefs.timer) { shutter(); return; }
    countdown = { at: performance.now() + prefs.timer * 1000, secs: prefs.timer };
  }

  // ------------------------------------------------------------------------------------------- the mode
  const api: PhotoMode = {
    get on() { return on; },
    cheese: () => (cue && performance.now() < cue.until ? cue : null),
    onSave(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    prefs(patch) { if (patch) setPrefs(patch); return { ...prefs }; },
    snap,
    focus,
    inFrame() { const r = canvas.getBoundingClientRect(); return framedSubjects(candidates(r.width, r.height)); },
    toggle(want = !on) {
      if (want === on) return;
      if (want && ctx.player.frozen) return; // a panel owns the input
      on = want;
      controller.fly(on);
      document.body.classList.toggle('photo-mode', on);
      if (!on) {
        ctx.camera.fov = FOV;
        ctx.camera.updateProjectionMatrix();
        // the photo's time of day was a pose, not a setting: back to whatever clock was running before
        if (hour !== entryHour) { valley.setSky({ hour: entryHour }); hour = entryHour; }
        leaving = performance.now();
        countdown = null; cue = null; focusId = null;
        count.classList.remove('go');
      } else {
        entryHour = valley.skyOverrides().hour ?? null;
        hour = entryHour;
        controller.lockPointer();
        refresh();
      }
      renderChips();
      if (on) track();
    },
  };

  // window capture, registered with the HUD's: while photo mode is on, every key is ours
  addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (!on) {
      if (e.code === 'KeyP' && !e.ctrlKey && !e.metaKey && !e.altKey && !ctx.player.frozen) {
        e.preventDefault(); e.stopImmediatePropagation(); api.toggle(true);
      }
      return;
    }
    // movement keys go on to the controller (bubble listeners); everything else stops here so the HUD stays asleep
    const move = /^(Key[WASDC]|Space|Shift(Left|Right)|ControlLeft|Arrow(Up|Down|Left|Right))$/.test(e.code);
    if (e.code === 'KeyP' || e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); api.toggle(false); return; }
    if (!e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const digit = /^Digit([1-6])$/.exec(e.code);
      if (digit) { setPrefs({ filter: FILTERS[Number(digit[1]) - 1].id }); audio()?.play('ui-click', { volume: 0.35 }); }
      else if (e.code === 'KeyV') { setPrefs({ frame: cycle(FRAMES.map((f) => f.id), prefs.frame, e.shiftKey ? -1 : 1) }); audio()?.play('ui-click', { volume: 0.35 }); }
      else if (e.code === 'KeyG') setPrefs({ grid: !prefs.grid });
      else if (e.code === 'KeyN') setPrefs({ tags: !prefs.tags });
      else if (e.code === 'KeyT') setPrefs({ timer: cycle(TIMERS, prefs.timer) });
      else if (e.code === 'KeyX') setPrefs({ download: !prefs.download });
      else if (e.code === 'KeyF') focus();
      else if (e.code === 'KeyL') { api.toggle(false); deps.openAlbum(); }
    }
    if (e.code === 'BracketLeft' || e.code === 'BracketRight') { scrub = e.code === 'BracketLeft' ? -1 : 1; if (hour === null) hour = valley.state.sky.hour; }
    else if (e.code === 'KeyR') setHour(entryHour);
    else if (e.code === 'Enter' && !e.repeat) enter();
    if (!move) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  addEventListener('keyup', (e) => { if (e.code === 'BracketLeft' || e.code === 'BracketRight') scrub = 0; });
  // the wheel zooms (narrow lens for portraits, wide for vistas)
  addEventListener('wheel', (e) => {
    if (!on) return;
    ctx.camera.fov = Math.max(18, Math.min(95, ctx.camera.fov * Math.exp(e.deltaY * 0.0012)));
    ctx.camera.updateProjectionMatrix();
    refresh();
  }, { passive: true });
  addEventListener('resize', () => layout());
  // losing pointer lock in photo mode just leaves it (the HUD's pause menu skips this one)
  document.addEventListener('pointerlockchange', () => { if (on && !document.pointerLockElement) api.toggle(false); }, true);

  let trackAt = 0;
  engine.onFrame((f) => {
    if (!on) return;
    if (scrub && hour !== null) setHour(hour + scrub * f.dt * 1.5); // 1.5 game hours a second
    if (Math.floor(f.time * 4) !== Math.floor((f.time - f.dt) * 4)) refresh();
    const now = performance.now();
    if (now > trackAt) { trackAt = now + 60; track(); }
    if (countdown) {
      const left = Math.ceil((countdown.at - now) / 1000);
      if (String(left) !== count.textContent && left > 0) {
        count.textContent = String(left);
        count.classList.remove('go'); void count.offsetWidth; count.classList.add('go');
        audio()?.play('ui-click', { volume: 0.5, pitch: left === 1 ? 1.6 : 1.2 });
        // everyone gets ready for the last couple of seconds
        if (left <= 2 && (!cue || cue.until < countdown.at + 300)) sayCheese(focusId && now < focusUntil ? focusId : null, countdown.at - now + 900);
      }
      if (now >= countdown.at) { countdown = null; count.classList.remove('go'); count.textContent = ''; shutter(); }
    }
  });

  renderChips();
  /** the HUD asks: did photo mode just end (so a pointer-lock loss is not a pause)? */
  (window as unknown as { __photoLeftAt?: () => number }).__photoLeftAt = () => leaving;
  return api;
}

const CSS = `
  body.photo-mode #hud { display: none !important; }
  .vh-photo-bar { position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); display: none; flex-direction: column; gap: 6px; align-items: center;
    padding: 7px 14px; border-radius: 12px; background: rgba(32, 22, 12, 0.74); color: #f6ead2; font: 13px/1.2 "Trebuchet MS", system-ui, sans-serif;
    white-space: nowrap; z-index: 50; pointer-events: none; backdrop-filter: blur(3px); max-width: calc(100vw - 32px); }
  body.photo-mode .vh-photo-bar { display: flex; }
  .vh-photo-bar .ph-keys, .vh-photo-bar .ph-chips { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; justify-content: center; }
  .vh-photo-bar .t { font-weight: bold; color: #ffd27a; letter-spacing: .04em; }
  .vh-photo-bar kbd { font: bold 11px system-ui, sans-serif; background: #f6ead2; color: #3a2614; border-radius: 4px; padding: 1px 5px; }
  .vh-photo-bar .i { color: #cdb894; }
  .ph-chip { padding: 2px 9px 2px 3px; border-radius: 999px; background: rgba(255,246,224,.08); border: 1px solid rgba(246,234,210,.22); color: #d9c8a8; }
  .ph-chip.on { background: rgba(255,210,122,.2); border-color: #ffd27a; color: #fff3d6; }
  .vh-photo-flash { position: fixed; inset: 0; background: #fff; opacity: 0; pointer-events: none; z-index: 60; transition: opacity .35s ease-out; }
  .vh-photo-flash.go { opacity: .7; transition: none; }
  .ph-view { position: fixed; inset: 0; pointer-events: none; z-index: 40; display: none; overflow: hidden; }
  body.photo-mode .ph-view { display: block; }
  .ph-view > div { position: fixed; }
  .ph-tint, .ph-vig, .ph-bloom { inset: 0; opacity: 0; }
  .ph-view[data-filter="warm"] .ph-tint { opacity: 1; background: rgba(255,164,82,.3); mix-blend-mode: soft-light; }
  .ph-view[data-filter="sepia"] .ph-tint { opacity: 1; background: rgb(255,242,220); mix-blend-mode: multiply; }
  .ph-view[data-filter="warm"] .ph-vig, .ph-view[data-filter="sepia"] .ph-vig, .ph-view[data-filter="mono"] .ph-vig, .ph-view[data-filter="tilt"] .ph-vig {
    opacity: 1; background: radial-gradient(ellipse at center, rgba(20,12,4,0) 48%, rgba(20,12,4,.5) 100%); mix-blend-mode: multiply; }
  .ph-view[data-filter="dreamy"] .ph-bloom { opacity: .5; backdrop-filter: blur(14px) brightness(1.3) saturate(1.25); }
  .ph-view[data-filter="dreamy"] .ph-vig { opacity: 1; background: radial-gradient(ellipse at 0% 0%, rgba(255,200,225,.35), rgba(255,200,225,0) 60%), radial-gradient(ellipse at center, rgba(255,240,248,0) 55%, rgba(255,240,248,.3) 100%); mix-blend-mode: screen; }
  .ph-tilt { left: 0; right: 0; display: none; backdrop-filter: blur(6px); }
  .ph-tilt.a { -webkit-mask-image: linear-gradient(to bottom, #000 0%, #000 55%, transparent 100%); mask-image: linear-gradient(to bottom, #000 0%, #000 55%, transparent 100%); }
  .ph-tilt.b { -webkit-mask-image: linear-gradient(to top, #000 0%, #000 55%, transparent 100%); mask-image: linear-gradient(to top, #000 0%, #000 55%, transparent 100%); }
  .ph-view[data-filter="tilt"] .ph-tilt { display: block; }
  .ph-crop { box-sizing: border-box; }
  .ph-view.framed .ph-crop { outline: 1.5px dashed rgba(255,246,224,.65); outline-offset: -1px; }
  .ph-dim { display: none; background: rgba(18,12,6,.55); }
  .ph-view.framed .ph-dim { display: block; }
  .ph-grid { position: absolute; inset: 0; display: none; }
  .ph-view.grid .ph-grid { display: block; }
  .ph-grid i { position: absolute; background: rgba(255,255,255,.55); box-shadow: 0 0 2px rgba(0,0,0,.4); }
  .ph-grid i:nth-child(1) { left: 33.333%; top: 0; bottom: 0; width: 1px; } .ph-grid i:nth-child(2) { left: 66.666%; top: 0; bottom: 0; width: 1px; }
  .ph-grid i:nth-child(3) { top: 33.333%; left: 0; right: 0; height: 1px; } .ph-grid i:nth-child(4) { top: 66.666%; left: 0; right: 0; height: 1px; }
  .ph-focus { transition: left .12s, top .12s, width .12s, height .12s; }
  .ph-focus i { position: absolute; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,.75); filter: drop-shadow(0 0 1px rgba(0,0,0,.6)); }
  .ph-focus i:nth-child(1) { left: 0; top: 0; border-right: 0; border-bottom: 0; } .ph-focus i:nth-child(2) { right: 0; top: 0; border-left: 0; border-bottom: 0; }
  .ph-focus i:nth-child(3) { left: 0; bottom: 0; border-right: 0; border-top: 0; } .ph-focus i:nth-child(4) { right: 0; bottom: 0; border-left: 0; border-top: 0; }
  .ph-focus.subject i { border-color: rgba(255,246,224,.9); }
  .ph-focus.locked i { border-color: #ffd27a; width: 18px; height: 18px; }
  .ph-fname { position: absolute; left: 50%; top: 100%; transform: translate(-50%, 6px); font: bold 12px "Trebuchet MS", system-ui, sans-serif; color: #fff6e0;
    text-shadow: 0 1px 2px rgba(0,0,0,.7); white-space: nowrap; }
  .ph-tags { inset: 0; }
  .ph-tag { position: fixed; left: 0; top: 0; padding: 2px 9px; border-radius: 999px; background: #fffaf0; border: 2px solid #7a5231; color: #3b2a1e;
    font: bold 13px "Trebuchet MS", system-ui, sans-serif; white-space: nowrap; box-shadow: 0 2px 0 rgba(40,28,16,.25); }
  .ph-count { left: 50%; top: 42%; transform: translate(-50%, -50%); font: 900 120px/1 Georgia, serif; color: #fff8e6; opacity: 0;
    text-shadow: 0 4px 0 rgba(74,42,20,.6), 0 0 30px rgba(0,0,0,.35); }
  .ph-count.go { animation: ph-count 1s ease-out; }
  @keyframes ph-count { 0% { opacity: 0; transform: translate(-50%, -50%) scale(1.5); } 15% { opacity: 1; transform: translate(-50%, -50%) scale(1); } 80% { opacity: 1; } 100% { opacity: 0; } }
  .ph-cheese { left: 50%; bottom: 120px; transform: translateX(-50%); padding: 6px 16px; border-radius: 999px; background: rgba(255,246,224,.92); color: #4a2a14;
    font: italic bold 18px Georgia, serif; opacity: 0; border: 2px solid #c9963a; }
  .ph-cheese.go { animation: ph-cheese 1.8s ease-out; }
  @keyframes ph-cheese { 0% { opacity: 0; transform: translate(-50%, 10px); } 15% { opacity: 1; transform: translate(-50%, 0); } 75% { opacity: 1; } 100% { opacity: 0; } }
  body:not(.photo-mode) .ph-saved { display: none; }
  .ph-saved { position: fixed; right: 18px; bottom: 96px; z-index: 55; display: flex; gap: 10px; align-items: center; padding: 8px 12px 8px 8px; border-radius: 10px;
    background: rgba(255,250,240,.96); color: #3b2a1e; font: 13px/1.25 "Trebuchet MS", system-ui, sans-serif; box-shadow: 0 6px 18px rgba(0,0,0,.3);
    pointer-events: none; opacity: 0; transform: translateY(16px) rotate(1.5deg); transition: opacity .3s, transform .3s; max-width: 340px; }
  .ph-saved.go { opacity: 1; transform: none; }
  .ph-saved img { width: 72px; height: 72px; object-fit: cover; border: 4px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,.3); transform: rotate(-3deg); }
  .ph-saved .t { display: flex; flex-direction: column; gap: 2px; }
  .ph-saved .t span { color: #7a6250; font-size: 12px; }
  .ph-saved.bad b { color: #a3402c; }
`;
