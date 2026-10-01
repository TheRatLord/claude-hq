/**
 * Asset gallery (/gallery/): every registered asset in isolation, with the game's lighting and post-processing.
 * Mouse: drag to orbit, wheel to zoom, right-drag to pan. Keys: G grid view, W wireframe, Space pause, R reset.
 *
 * URL (for scripts/shoot.ts): ?asset=name&variant=v&season=autumn&night=0.8&param=0.5&time=3&grid=group|all&turn=0.6&pitch=0.35&zoom=0.6
 * window.__gallery: { ready, list(), show(name, opts), grid(group|null), info() }
 */
import * as THREE from 'three';
import '../scene/assetIndex.ts';
import { listAssets, getAsset } from '../scene/assets.ts';
import type { AssetDef } from '../scene/assets.ts';
import type { Season } from '../model/types.ts';
import { createRenderer } from '../../render/renderer.ts';
import { PAL, toon } from '../scene/toon.ts';

const params = new URLSearchParams(location.search);
document.body.style.cssText = 'margin:0;height:100vh;display:grid;grid-template-columns:260px 1fr;font:13px system-ui, sans-serif;background:#1d1f22;color:#eee;overflow:hidden';
const side = document.createElement('aside');
side.style.cssText = 'overflow:auto;padding:10px;border-right:1px solid #333;background:#26282c';
const view = document.createElement('div');
view.style.cssText = 'position:relative;overflow:hidden';
const canvas = document.createElement('canvas');
canvas.style.cssText = 'width:100%;height:100%;display:block';
const info = document.createElement('pre');
info.style.cssText = 'position:absolute;left:10px;bottom:6px;margin:0;color:#fff;text-shadow:0 1px 2px #000;pointer-events:none;white-space:pre-wrap';
const bar = document.createElement('div');
bar.style.cssText = 'position:absolute;left:10px;top:8px;right:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:#0008;padding:6px 8px;border-radius:8px';
view.append(canvas, bar, info);
document.body.append(side, view);

const { renderer, resize } = createRenderer(canvas);
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd3ff);
const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 500);
const sun = new THREE.DirectionalLight(0xfff1d6, 2.3);
sun.position.set(6, 10, 5);
sun.castShadow = true;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, far: 60 });
const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x6a7a3a, 1.1);
scene.add(sun, hemi);
const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 48).rotateX(-Math.PI / 2), toon(PAL.grass));
ground.receiveShadow = true;
scene.add(ground);

const state = {
  asset: params.get('asset') ?? '', variant: params.get('variant') ?? '', season: (params.get('season') ?? 'summer') as Season,
  night: Number(params.get('night') ?? 0), param: Number(params.get('param') ?? 0.5), paused: false, wire: false,
  grid: params.get('grid'), t: Number(params.get('time') ?? 0) || 0,
  yaw: Number(params.get('turn') ?? 0.7), pitch: Number(params.get('pitch') ?? 0.35), dist: 0, target: new THREE.Vector3(),
};
let shown: { def: AssetDef; obj: THREE.Object3D }[] = [];

function frameObject(o: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(o);
  const size = box.getSize(new THREE.Vector3());
  box.getCenter(state.target);
  state.dist = (Math.max(size.x, size.y, size.z) * 1.9 + 0.5) * Number(params.get('zoom') ?? 1);
  const r = Math.max(size.x, size.z) * 0.8 + 4;
  Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r });
  sun.shadow.camera.updateProjectionMatrix();
}

function clear() { for (const s of shown) scene.remove(s.obj); shown = []; }

function build(def: AssetDef, variant?: string): THREE.Object3D {
  const obj = def.build({ seed: 1, season: state.season, variant: variant || def.variants?.[0], night: state.night });
  obj.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  return obj;
}

function show(name: string, o: { variant?: string } = {}) {
  clear();
  const def = getAsset(name);
  if (!def) { info.textContent = `no asset ${name}`; return; }
  state.asset = name; state.grid = null;
  state.variant = o.variant ?? (def.variants?.includes(state.variant) ? state.variant : def.variants?.[0] ?? '');
  const obj = build(def, state.variant);
  scene.add(obj);
  shown = [{ def, obj }];
  frameObject(obj);
  renderBar();
  describe();
}

function grid(group: string | null) {
  clear();
  const defs = listAssets().filter((d) => !group || group === 'all' || d.group === group);
  const n = Math.ceil(Math.sqrt(defs.length));
  const cell = 6;
  defs.forEach((def, i) => {
    const obj = build(def);
    const box = new THREE.Box3().setFromObject(obj);
    const s = Math.max(...box.getSize(new THREE.Vector3()).toArray());
    if (s > cell * 0.9) obj.scale.multiplyScalar((cell * 0.9) / s);
    obj.position.x += (i % n - (n - 1) / 2) * cell;
    obj.position.z += (Math.floor(i / n) - (n - 1) / 2) * cell;
    scene.add(obj);
    shown.push({ def, obj });
  });
  state.grid = group ?? 'all';
  const all = new THREE.Group();
  for (const s of shown) all.add(s.obj.clone());
  frameObject(all);
  state.dist *= 0.8;
  info.textContent = `${defs.length} assets${group && group !== 'all' ? ` in ${group}` : ''}`;
}

function describe() {
  const s = shown[0];
  if (!s) return;
  let tris = 0, meshes = 0;
  s.obj.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) { meshes++; const g = m.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3 * ((m as THREE.InstancedMesh).count ?? 1); } });
  const size = new THREE.Box3().setFromObject(s.obj).getSize(new THREE.Vector3());
  info.textContent = `${s.def.name} (${s.def.group})${s.def.note ? ` — ${s.def.note}` : ''}\n${meshes} meshes · ${Math.round(tris)} tris · ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} m`;
}

function renderList() {
  side.innerHTML = '';
  const search = document.createElement('input');
  search.placeholder = 'filter…';
  search.style.cssText = 'width:100%;box-sizing:border-box;margin-bottom:8px;padding:5px';
  side.append(search);
  const list = document.createElement('div');
  side.append(list);
  const draw = () => {
    list.innerHTML = '';
    const groups = new Map<string, AssetDef[]>();
    for (const d of listAssets()) if (d.name.includes(search.value)) groups.set(d.group, [...(groups.get(d.group) ?? []), d]);
    for (const [g, defs] of groups) {
      const h = document.createElement('div');
      h.textContent = `${g} (${defs.length})`;
      h.style.cssText = 'margin:10px 0 4px;color:#9ab;cursor:pointer;font-weight:600';
      h.onclick = () => grid(g);
      list.append(h);
      for (const d of defs) {
        const b = document.createElement('div');
        b.textContent = d.name;
        b.style.cssText = `padding:3px 6px;border-radius:4px;cursor:pointer;${d.name === state.asset ? 'background:#3b5f8a' : ''}`;
        b.onclick = () => { show(d.name); draw(); };
        list.append(b);
      }
    }
    if (!listAssets().length) list.textContent = 'No assets registered yet.';
  };
  search.oninput = draw;
  draw();
}

function renderBar() {
  bar.innerHTML = '';
  const def = getAsset(state.asset);
  const sel = (label: string, values: readonly string[], cur: string, on: (v: string) => void) => {
    const l = document.createElement('label');
    l.textContent = `${label} `;
    const s = document.createElement('select');
    for (const v of values) s.append(new Option(v, v, false, v === cur));
    s.onchange = () => on(s.value);
    l.append(s);
    bar.append(l);
  };
  const slider = (label: string, v: number, on: (v: number) => void) => {
    const l = document.createElement('label');
    l.textContent = `${label} `;
    const s = document.createElement('input');
    s.type = 'range'; s.min = '0'; s.max = '1'; s.step = '0.01'; s.value = String(v);
    s.oninput = () => on(Number(s.value));
    l.append(s);
    bar.append(l);
  };
  if (def?.variants?.length) sel('variant', def.variants, state.variant, (v) => show(state.asset, { variant: v }));
  sel('season', ['spring', 'summer', 'autumn', 'winter'], state.season, (v) => { state.season = v as Season; if (state.grid) grid(state.grid); else show(state.asset); });
  slider('night', state.night, (v) => { state.night = v; applyNight(); if (!state.grid) show(state.asset); });
  if (def?.param) slider(def.param, state.param, (v) => { state.param = v; });
  const g = document.createElement('button');
  g.textContent = 'grid (G)';
  g.onclick = () => grid('all');
  bar.append(g);
}

function applyNight() {
  const n = state.night;
  scene.background = new THREE.Color(0x9fd3ff).lerp(new THREE.Color(0x0e1630), n);
  sun.intensity = 2.3 * (1 - n * 0.85);
  sun.color.set(0xfff1d6).lerp(new THREE.Color(0x8fa6ff), n);
  hemi.intensity = 1.1 * (1 - n * 0.6);
}

// orbit controls
let drag: { x: number; y: number; pan: boolean } | null = null;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  if (drag.pan) {
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    state.target.addScaledVector(right, -dx * state.dist * 0.002);
    state.target.y += dy * state.dist * 0.002;
  } else { state.yaw -= dx * 0.008; state.pitch = Math.max(-0.2, Math.min(1.45, state.pitch + dy * 0.008)); }
});
canvas.addEventListener('wheel', (e) => { state.dist *= Math.exp(e.deltaY * 0.001); e.preventDefault(); }, { passive: false });
addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  if (e.code === 'KeyG') grid(state.grid ? null : 'all');
  if (e.code === 'Space') state.paused = !state.paused;
  if (e.code === 'KeyR' && shown[0]) frameObject(shown[0].obj);
  if (e.code === 'KeyW') { state.wire = !state.wire; scene.traverse((c) => { const m = (c as THREE.Mesh).material as THREE.Material & { wireframe?: boolean }; if (m && 'wireframe' in m) m.wireframe = state.wire; }); }
});

const fit = () => { const w = view.clientWidth, h = view.clientHeight; resize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
addEventListener('resize', fit);
fit();

let last = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!state.paused) state.t += dt;
  for (const s of shown) s.def.animate?.(s.obj, state.t, state.paused ? 0 : dt, state.param);
  camera.position.set(
    state.target.x + Math.sin(state.yaw) * Math.cos(state.pitch) * state.dist,
    state.target.y + Math.sin(state.pitch) * state.dist,
    state.target.z + Math.cos(state.yaw) * Math.cos(state.pitch) * state.dist,
  );
  camera.lookAt(state.target);
  renderer.render(scene, camera);
}

renderList();
applyNight();
if (state.grid) grid(state.grid);
else if (state.asset) show(state.asset);
else if (listAssets()[0]) show(listAssets()[0].name);
renderBar();
requestAnimationFrame(frame);

Object.assign(window, {
  __gallery: {
    ready: false,
    list: () => listAssets().map((d) => ({ name: d.name, group: d.group, variants: d.variants ?? [], param: d.param ?? null })),
    show, grid, info: () => info.textContent,
    set(o: Partial<{ season: Season; night: number; param: number; t: number; yaw: number; pitch: number; dist: number; paused: boolean }>) {
      Object.assign(state, o);
      applyNight();
      if (o.season || o.night !== undefined) { if (state.grid) grid(state.grid); else show(state.asset); }
      if (o.dist !== undefined) state.dist = o.dist;
    },
  },
});
setTimeout(() => { (window as unknown as { __gallery: { ready: boolean } }).__gallery.ready = true; }, 300);
