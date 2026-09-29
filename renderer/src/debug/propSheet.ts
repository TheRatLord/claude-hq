/**
 * Prop sheet (`?sheet=props`, DESIGN §7.5, M1.75 gate): every kit builder and variant on the hero-sheet cyc with the
 * renderer's own lights + post stack, in labelled rows. Views (`?view=` or `window.__props.view(name, {page})`):
 *   all         the whole kit, 3/4 above, framed on the sheet's bounds (default; the review shot)
 *   far         one page (≤ 6 items, half a row) framed on its items, from ≥ 6 m
 *   near        one page (≤ 3 items) framed on its items, from ≥ 2 m
 *   silhouette  a `far` page as ink on paper from ≥ 4 m (the §7.5 "silhouette pass at 4 m")
 * [ENV fix r1] Items are packed in rows by their real footprint (no neighbour overlap), every view is framed on its
 * items' bounds (nothing cropped at the edges), and labels wrap inside their own column so they never collide.
 * `__props.stats()` lists per item: triangles, parts, colour tokens used, hero detail, budget pass. Owner: ENV.
 */
import * as THREE from 'three';
import { createRenderer } from '../render/renderer.ts';
import { createQuality } from '../render/quality.ts';
import { createLights } from '../render/lights.ts';
import { createPost } from '../render/post.ts';
import { getMaterial } from '../render/materials/index.ts';
import { createClock } from '../core/time.ts';
import { createCtx } from '../core/ctx.ts';
import { createBus } from '../core/bus.ts';
import { installHq } from '../core/debug.ts';
import { createBaker, KIT, KIT_SHEET, SIGNATURE } from '../world/build/kit/index.ts';
import { rngOf, trisOf } from '../world/build/kit/core.ts';
import { CORE } from '../../../shared/palette.ts';
import { errMessage } from '../../../shared/guards.ts';
import type { Params } from '../core/params.ts';
import type { Footprint } from '../world/build/kit/core.ts';
import { sheetStore, sheetPlayer, noReply } from './sheetStubs.ts';

interface PlacedItem { x: number; z: number; row: number; w: number }
interface SlotInfo {
  i: number; name: string; label: string; x: number; z: number; row: number; tris: number; budget: number; pass: boolean; parts: number;
  slots: string[]; hero: string; footprint: Footprint;
  /** world bounds of the baked item, filled on first label placement */
  box?: THREE.Box3 | null;
}
export interface PropViewOpts { page?: number; pitch?: number; yaw?: number }
type PageKind = 'far' | 'near';
/** `window.__props`: what the review scripts drive. */
export interface PropSheetApi {
  views: string[];
  items: number;
  view(name: string, o?: PropViewOpts): string;
  labels(b?: boolean): boolean;
  pages(kind?: string): number;
  stats(): { items: number; overBudget: string[]; list: { label: string; tris: number; budget: number; pass: boolean; parts: number; slots: string[]; hero: string }[] };
}
declare global {
  interface Window { __props?: PropSheetApi }
}

const BACKDROP = '#B3A99B'; // hero-sheet oat backdrop, L* 70
const GROUND = '#7C766E'; // ground, L* 50
const EYE = 1.2, ROW_W = 21, GAP = 0.6, DZ = 2.5, PER_FAR = 6, PER_NEAR = 3;

export async function runPropSheet({ params }: { params: Params }): Promise<void> {
  const canvas = document.getElementById('view');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('index.html has no <canvas id="view">');
  const quality = createQuality({ pinned: params.quality });
  const { renderer, resize } = createRenderer(canvas, { renderScale: quality.renderScale });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(params.fov, innerWidth / innerHeight, 0.05, 400);
  const clock = createClock({ scale: 1, hour: params.hour ?? 13 });
  const bus = createBus();
  const lights = createLights(scene);
  const post = createPost({ renderer, scene, camera, quality });
  scene.background = new THREE.Color(BACKDROP);

  // ---- packing: items left → right by footprint width, a new row past ROW_W (widths from a probe build)
  const probe = KIT_SHEET.map(([name, p], i) => {
    const it = KIT[name](p, rngOf(`sheet:${i}`));
    if ((name === 'lamp' && p.kind === 'string') || name === 'rope') return p.len ?? 0.9;
    let e = 0; // plan-view reach from the origin (the arc lamp's head, a shelf's ornament …), any yaw
    for (const q of it.parts) { q.geometry.computeBoundingBox(); const b = q.geometry.boundingBox; if (!b) continue; e = Math.max(e, Math.hypot(Math.max(-b.min.x, b.max.x), Math.max(-b.min.z, b.max.z))); }
    return Math.max(0.5, Math.min(2.8, 2 * e * 0.92));
  });
  const pos: PlacedItem[] = []; const rowsOf: number[][] = [];
  { let x = 0, row = 0, first = true;
    probe.forEach((w, i) => {
      if (!first && x + w > ROW_W) { row++; x = 0; }
      pos.push({ x: x + w / 2, z: -row * DZ, row, w }); x += w + GAP; first = false;
      (rowsOf[row] ??= []).push(i);
    });
    for (const r of rowsOf) { const last = pos[r[r.length - 1]], shift = (ROW_W - (last.x + last.w / 2)) / 2; for (const i of r) pos[i].x += shift; } // centre each row
  }
  const rows = rowsOf.length;
  // pages: rows split into equal chunks of ≤ per items
  const pagesOf = (per: number) => rowsOf.flatMap((r) => { const n = Math.ceil(r.length / per), out: number[][] = []; let i = 0; for (let c = 0; c < n; c++) { const k = Math.floor((r.length - i) / (n - c)); out.push(r.slice(i, i + k)); i += k; } return out; }); // balanced chunks
  const PAGES: Record<PageKind, number[][]> = { far: pagesOf(PER_FAR), near: pagesOf(PER_NEAR) };

  // ---- stage: ground + cyc behind every row
  const W = ROW_W + 6, D = rows * DZ + 6;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(W + 40, D + 40).rotateX(-Math.PI / 2), getMaterial('toonEnv', { color: GROUND }));
  ground.position.set(ROW_W / 2, 0, -(rows - 1) * DZ / 2);
  ground.receiveShadow = true;
  scene.add(ground);
  const cyc = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 14, 32, 1, true, Math.PI / 2, Math.PI).scale(W / 5, 1, 1).translate(ROW_W / 2, 7, -(rows - 1) * DZ - 1.5), getMaterial('toonEnv', { color: BACKDROP }));
  cyc.receiveShadow = true;
  scene.add(cyc);

  // ---- the kit, one item per cell (each its own vis "cell" so pages can hide the rest)
  const baker = createBaker();
  const slots = KIT_SHEET.map(([name, p, label], i): SlotInfo => {
    const { x, z, row } = pos[i];
    const lift = name === 'lamp' && p.kind === 'pendant' ? 1.1 : name === 'plant' && p.kind === 'pothos' ? 1.3 : 0;
    const wallY = name === 'poster' || name === 'sign' || name === 'corkboard' || ['acousticPanels', 'mirror', 'pegboard', 'dartboard', 'scoreboard', 'vinylWall'].includes(name) ? 0.9 : ['awning', 'streetBanner', 'starString'].includes(name) ? 1.9 : 0; // [ENV M2] wall / overhead items
    // [ENV fix r2] the desk chair's sitter faces chair-local −z (LVL's DESK.back: +z = behind the sitter), unlike the
    // kit's front = +z: turn it so the sheet shows its front (from behind + above, the reclined back read as a lounger)
    const yaw = name === 'deskChair' ? 0.45 + Math.PI : 0.45;
    const span = name === 'rope' ? (p.len ?? 0.9) : name === 'lamp' && p.kind === 'string' ? (p.len ?? 3) : 0;
    baker.place(name, p, { x: x - span / 2, y: lift + wallY + (name === 'lamp' && p.kind === 'string' ? 1.4 : 0), z, yaw: span ? 0 : yaw }, `sheet:${i}`, { cell: `i${i}` });
    const item = KIT[name](p, rngOf(`sheet:${i}`));
    const tris = trisOf(item), budget = SIGNATURE.has(name) ? 6000 : 1500;
    const tokens = new Set(item.parts.filter((q) => !q.color && !q.grad && q.mat !== 'bulb' && q.mat !== 'flame').map((q) => q.slot));
    return { i, name, label, x, z, row, tris, budget, pass: tris <= budget, parts: item.parts.length, slots: [...tokens], hero: item.hero ?? '', footprint: item.footprint };
  });
  const groups = baker.finish();
  for (const g of groups.values()) scene.add(g);
  /** world bounds of a set of items (their baked meshes) */
  const boundsOf = (ids: number[]): THREE.Box3[] => ids.map((i) => {
    const b = new THREE.Box3();
    groups.get(`i${i}`)?.traverse((o) => {
      if (!('geometry' in o) || !(o.geometry instanceof THREE.BufferGeometry)) return;
      o.geometry.computeBoundingBox();
      if (o.geometry.boundingBox) b.union(o.geometry.boundingBox);
    });
    return b;
  }).filter((b) => !b.isEmpty());

  // ---- labels (DOM): anchored under each item's front edge, wrapped inside the item's own column (max width = the
  // on-screen gap to its row neighbours), then pushed down past any label they would still overlap
  const layer = document.createElement('div');
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;font:600 12px ui-rounded,system-ui,sans-serif;color:#1F1E1D';
  document.body.appendChild(layer);
  const labels = slots.map((s) => {
    const el = document.createElement('div');
    el.textContent = s.label;
    el.style.cssText = 'position:absolute;transform:translate(-50%,0);background:#F4EDE3E8;padding:1px 6px;border-radius:8px;box-sizing:border-box;text-align:center;line-height:1.15;white-space:normal;overflow-wrap:normal';
    layer.appendChild(el);
    return el;
  });
  let showLabels = new URLSearchParams(location.search).get('labels') !== '0';
  const v3 = new THREE.Vector3();
  const px = (x: number, y: number, z: number) => { v3.set(x, y, z).project(camera); return v3.z > 1 ? null : { x: (v3.x * 0.5 + 0.5) * innerWidth, y: (-v3.y * 0.5 + 0.5) * innerHeight }; };
  let labelsDirty = true;
  const mctx = document.createElement('canvas').getContext('2d');
  if (!mctx) throw new Error('propSheet: no 2d canvas context');
  const placeLabels = () => {
    if (!labelsDirty) return;
    labelsDirty = false;
    const shown: HTMLDivElement[] = [];
    slots.forEach((s, k) => {
      const el = labels[k];
      const g = groups.get(`i${s.i}`);
      const fp = s.footprint;
      const fd = 'r' in fp ? fp.r : fp.d / 2;
      s.box ??= boundsOf([s.i])[0] ?? null;
      const ly = s.box && s.box.min.y > 0.3 ? s.box.min.y - 0.05 : 0; // hanging items: under the item, not the floor
      const a = showLabels && g?.visible ? px(s.x, ly, s.z + Math.min(0.9, fd) + 0.12) : null;
      if (!a) { el.style.display = 'none'; return; }
      const nb = slots.filter((q) => q.row === s.row && groups.get(`i${q.i}`)?.visible && q !== s);
      let room = innerWidth;
      for (const q of nb) { const b = px(q.x, 0, q.z + 0.3); if (b) room = Math.min(room, Math.abs(b.x - a.x)); }
      el.style.display = '';
      // the biggest font (12 → 9 px) whose longest word still fits the column; wrap only between words
      const maxW = Math.max(40, room - 8);
      let fs = 12;
      for (; fs > 9; fs--) { mctx.font = `600 ${fs}px ui-rounded,system-ui,sans-serif`; if (Math.max(...s.label.split(/\s+/).map((w) => mctx.measureText(w).width)) + 12 <= maxW) break; }
      el.style.fontSize = `${fs}px`;
      el.style.maxWidth = `${maxW}px`;
      el.style.left = `${a.x}px`; el.style.top = `${a.y}px`;
      shown.push(el);
    });
    // vertical declutter: any overlap left (a label whose wrap met a taller neighbour) moves down below it
    const rects = shown.map((el) => ({ el, r: el.getBoundingClientRect() })).sort((p, q) => p.r.top - q.r.top);
    for (let i = 0; i < rects.length; i++) for (let j = 0; j < i; j++) {
      const A = rects[i].r, B = rects[j].r;
      if (A.left < B.right && B.left < A.right && A.top < B.bottom && B.top < A.bottom) {
        const dy = B.bottom - A.top + 2;
        rects[i].el.style.top = `${parseFloat(rects[i].el.style.top) + dy}px`;
        rects[i].r = rects[i].el.getBoundingClientRect();
      }
    }
  };

  // ---- views: every one framed on its items' bounds (binary search on the camera distance along a fixed direction)
  let current = 'all', silhouette = false, page = 0, viewOpts: PropViewOpts = {};
  const frame = (ids: number[], { pitch, minDist, margin = 0.86, yaw = 0 }: { pitch: number; minDist: number; margin?: number; yaw?: number }) => {
    const boxes = boundsOf(ids), all = boxes.reduce((a, q) => a.union(q), new THREE.Box3()), c = all.getCenter(new THREE.Vector3());
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const corners: THREE.Vector3[] = []; // per item (the sheet AABB's empty corners would waste the frame)
    for (const b of boxes) for (let k = 0; k < 8; k++) corners.push(new THREE.Vector3(k & 1 ? b.max.x : b.min.x, k & 2 ? b.max.y : b.min.y, k & 4 ? b.max.z : b.min.z));
    // re-centre on the projected extents after the fit (the AABB centre is not the screen centre in perspective)
    const fits = (d: number) => {
      camera.position.copy(c).addScaledVector(dir, d); camera.lookAt(c); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
      return corners.every((p) => { const q = p.clone().project(camera); return q.z < 1 && Math.abs(q.x) <= margin && q.y <= margin && q.y >= -margin + 0.12; }); // room for labels at the bottom
    };
    let d = minDist;
    for (let pass = 0; pass < 3; pass++) {
      let lo = 0.5, hi = 80;
      for (let it = 0; it < 30; it++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
      d = Math.max(hi, minDist);
      fits(d);
      let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
      for (const p of corners) { const q = p.clone().project(camera); x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
      const cz = c.clone().project(camera).z;
      c.copy(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2 + 0.06, cz).unproject(camera));
    }
    fits(d);
    labelsDirty = true;
  };
  const showOnly = (ids: Set<number> | null) => { for (const [k, g] of groups) g.visible = !ids || ids.has(+k.slice(1)); labelsDirty = true; };
  const pageList = (kind: PageKind, pg: number) => { const P = PAGES[kind]; return P[Math.max(0, Math.min(P.length - 1, pg))]; };
  const views: Record<string, (o: PropViewOpts) => void> = {
    all() { showOnly(null); frame(slots.map((s) => s.i), { pitch: 0.95, minDist: 8, margin: 0.95 }); },
    far(o) { const ids = pageList('far', o.page ?? 0); showOnly(new Set(ids)); frame(ids, { pitch: o.pitch ?? 0.36, minDist: 6, yaw: o.yaw ?? 0 }); },
    near(o) { const ids = pageList('near', o.page ?? 0); showOnly(new Set(ids)); frame(ids, { pitch: o.pitch ?? 0.42, minDist: 2, yaw: o.yaw ?? 0 }); },
    silhouette(o) { const ids = pageList('far', o.page ?? 0); showOnly(new Set(ids)); frame(ids, { pitch: 0.3, minDist: 4 }); },
  };
  const setView = (name: string, o: PropViewOpts = {}): string => { current = name; page = o.page ?? 0; viewOpts = o; silhouette = name === 'silhouette'; views[name]?.(o); return name; };

  const inkMat = new THREE.MeshBasicMaterial({ color: CORE.ink });
  const renderSilhouette = () => {
    const bg = scene.background;
    scene.background = new THREE.Color('#F4EDE3');
    ground.visible = false; cyc.visible = false;
    scene.overrideMaterial = inkMat;
    // kit meshes live on the ENV/PROPS layers, which only the post passes enable on the camera: draw every layer
    const mask = camera.layers.mask;
    camera.layers.enableAll();
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    camera.layers.mask = mask;
    scene.overrideMaterial = null;
    ground.visible = true; cyc.visible = true;
    scene.background = bg;
  };

  // ---- loop
  const ctx = createCtx({ scene, camera, renderer, bus, clock, params, quality, camZone: 'sheet', store: sheetStore() });
  ctx.player = sheetPlayer(camera, EYE);
  let firstFrame: (() => void) | null = null; const firstDone = new Promise<void>((r) => { firstFrame = r; });
  let postBroken = false;
  const onResize = () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); resize(innerWidth, innerHeight, quality.renderScale); post.setSize(innerWidth, innerHeight); views[current]?.(viewOpts); };
  addEventListener('resize', onResize);
  const tick = (now: number) => {
    requestAnimationFrame(tick);
    clock.tick(now);
    ctx.dt = clock.dt; ctx.rawDt = clock.rawDt; ctx.time = clock.time; ctx.hour = clock.hour(); ctx.frame++;
    lights.update(ctx);
    if (silhouette) { renderSilhouette(); } else {
      try { post.setEnabled(!postBroken); post.render(ctx); } catch (e) { if (!postBroken) console.warn('[props] post.render threw; plain render fallback:', errMessage(e)); postBroken = true; }
    }
    placeLabels();
    const info = renderer.info.render;
    ctx.perf.drawCalls = info.calls; ctx.perf.triangles = info.triangles;
    if (firstFrame) { firstFrame(); firstFrame = null; }
  };
  const api: PropSheetApi = {
    views: Object.keys(views), items: slots.length,
    view(name, o = {}) { return setView(name, o); },
    labels(b = true) { showLabels = b; labelsDirty = true; return b; },
    pages: (kind = 'far') => { const k = kind === 'silhouette' ? 'far' : kind; return (k === 'far' || k === 'near' ? PAGES[k].length : undefined) ?? 1; },
    stats: () => ({ items: slots.length, overBudget: slots.filter((s) => !s.pass).map((s) => s.label), list: slots.map(({ label, tris, budget, pass, parts, slots: sl, hero }) => ({ label, tris, budget, pass, parts, slots: sl, hero })) }),
  };
  window.__props = api;
  installHq({ ctx, ready: firstDone.then(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))), actors: { list: () => [], get: () => null, count: () => 0 }, call: async () => noReply, poses: {} });
  const q = new URLSearchParams(location.search);
  const numParam = (k: string): number | undefined => { const v = q.get(k); return v === null ? undefined : +v; };
  setView(q.get('view') ?? 'all', { page: +(q.get('page') ?? 0), yaw: numParam('yaw'), pitch: numParam('pitch') }); // [ENV fix r2] ?yaw/?pitch: side views
  onResize();
  requestAnimationFrame(tick);
}
