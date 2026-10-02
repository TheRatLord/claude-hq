#!/usr/bin/env node
/**
 * Soak test: leave the valley running for a long time while churning through everything a day-long session does
 * (scenarios, panels, terminals, toasts, poses, weather, seasons, the farmhouse, gatherings, wildlife, festivals,
 * forage, the pet, status flapping, socket drops, hidden-tab spells, midnight), then print a leak report.
 *
 *   npm run soak                                         # 20 min real time, mixed/churn/crowd40, every action
 *   npm run soak -- --minutes 5 --cycle 20 --timescale 30
 *   npm run soak -- --minutes 3 --start 2026-10-02T23:58 --date-scale 4   # cross midnight with the page open
 *   npm run soak -- --json scratch/soak/a.json --actions panels,scenario
 *
 * Every `--cycle` seconds the page goes back to a fixed baseline (the first scenario, hub pose, 10:00 clear, panels
 * closed), settles for `--settle` seconds, forces a GC (CDP) and samples: JS heap, DOM nodes, event listeners
 * (CDP Performance metrics), three.js renderer.info (geometries, textures, programs), scene object count, live
 * timers / intervals / rAFs (counted by an init script), live audio nodes (CDP WebAudio), localStorage bytes per key, fps and
 * engine frame errors. The report fits a line over the second half of the samples and flags metrics that keep
 * growing (≥ `--tol` per hour beyond noise), plus every console error / warning / page error seen.
 *
 * Options: --minutes N (20)  --cycle S (30)  --settle S (4)  --scenarios a,b (mixed,churn,crowd40)  --demo N (12)
 *          --timescale K (server demo clock, 20)  --anim K (__valley.timeScale, 4)  --date-scale K (page Date speed, 1)
 *          --start ISO (page Date start; default now)  --seed N (1)  --actions list|all  --json FILE  --size WxH (1280x720)
 *          --stacks (append a short stack to every console warning / error)  --warmup 0 (skip the warm-up pass)
 *          --tex (list textures uploaded / disposed since the last sample, with where each was made)
 *          --url URL (an existing backend + its built dist instead of a fresh demo dev server)
 * Actions: scenario panels terminal toasts poses weather inside gather wildlife festival forage pet flap socket hidden
 *          midnight
 * Exit code 1 when a metric leaks or the page logged errors.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import type { CDPSession, Page } from '@playwright/test';
import { startDev, REPO } from './devserver.ts';
import { GPU_ARGS } from './gpu.ts';

const argv = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const MINUTES = Number(opt('--minutes', '20'));
const CYCLE = Number(opt('--cycle', '30'));
const SETTLE = Number(opt('--settle', '4'));
const SCENARIOS = opt('--scenarios', 'mixed,churn,crowd40').split(',');
const ALL_ACTIONS = ['scenario', 'panels', 'terminal', 'toasts', 'poses', 'weather', 'inside', 'gather', 'wildlife', 'festival', 'forage', 'pet', 'flap', 'socket', 'hidden', 'midnight'] as const;
const ACTIONS = new Set(opt('--actions', 'all') === 'all' ? ALL_ACTIONS : opt('--actions', '').split(','));
const [W, H] = opt('--size', '1280x720').split('x').map(Number);
const JSON_OUT = opt('--json', '');
const TEX = argv.includes('--tex');
const POSES = ['hub', 'farmhouse', 'square', 'windmill', 'pond', 'barn', 'river', 'plots', 'east', 'trailhead', 'trail', 'bridge', 'summit'];
const ROOMS = ['door', 'hearth', 'desk', 'bed', 'window'];
const GATHERINGS = ['campfire', 'concert', 'market'];
const FESTIVALS = ['blossom', 'lantern', 'founders', 'harvest', 'hallowtide', 'starlight', 'newyear'];
const PANELS = ['map', 'mailbox', 'roster', 'almanac', 'collection', 'noticeboard', 'stats', 'pause', 'friends', 'pet', 'shop'];

/**
 * Page instrumentation (before any page script): an accelerated / jumpable Date, live timer + interval + rAF counts,
 * live AudioNode count (FinalizationRegistry after a forced GC), the WebSocket (to drop it) and a fake hidden tab.
 */
function instrument(o: { start: number; scale: number; stacks: boolean }): void {
  if (o.stacks) for (const k of ['warn', 'error'] as const) { const f = console[k].bind(console); console[k] = (...a: unknown[]) => f(...a, `\n${(new Error().stack ?? '').split('\n').slice(2, 7).join('\n')}`); }
  const RealDate = Date;
  const realNow = RealDate.now.bind(RealDate);
  const r0 = realNow();
  const clock = { offset: (o.start || r0) - r0, scale: o.scale, base: r0 };
  const fakeNow = () => { const r = realNow(); return Math.round(clock.base + clock.offset + (r - clock.base) * clock.scale); };
  // always installed (also at scale 1, start now): `hidden` and `midnight` move the page clock through it, and a
  // jump without it silently did nothing
  {
    class FakeDate extends RealDate {
      constructor(...a: unknown[]) {
        if (a.length === 0) super(fakeNow());
        else super(...(a as [number]));
      }
      static override now() { return fakeNow(); }
    }
    (window as unknown as { Date: DateConstructor }).Date = FakeDate as unknown as DateConstructor;
  }
  const live = { timeouts: new Set<number>(), intervals: new Set<number>(), rafs: new Set<number>() };
  const st = window.setTimeout.bind(window), ct = window.clearTimeout.bind(window);
  const si = window.setInterval.bind(window), ci = window.clearInterval.bind(window);
  const ra = window.requestAnimationFrame.bind(window), ca = window.cancelAnimationFrame.bind(window);
  window.setTimeout = ((fn: TimerHandler, ms?: number, ...a: unknown[]) => {
    const id = st((...b: unknown[]) => { live.timeouts.delete(id); if (typeof fn === 'function') (fn as (...x: unknown[]) => void)(...b); }, ms, ...a);
    live.timeouts.add(id);
    return id;
  }) as typeof setTimeout;
  window.clearTimeout = ((id?: number) => { if (id !== undefined) live.timeouts.delete(id); ct(id); }) as typeof clearTimeout;
  window.setInterval = ((fn: TimerHandler, ms?: number, ...a: unknown[]) => { const id = si(fn, ms, ...a); live.intervals.add(id); return id; }) as typeof setInterval;
  window.clearInterval = ((id?: number) => { if (id !== undefined) live.intervals.delete(id); ci(id); }) as typeof clearInterval;
  window.requestAnimationFrame = (fn: FrameRequestCallback) => { const id = ra((t) => { live.rafs.delete(id); fn(t); }); live.rafs.add(id); return id; };
  window.cancelAnimationFrame = (id: number) => { live.rafs.delete(id); ca(id); };
  const sockets: WebSocket[] = [];
  const WS = window.WebSocket;
  // only the valley's own socket (/ws): dropping vite's client socket would make it reload the page
  window.WebSocket = class extends WS { constructor(u: string | URL, p?: string | string[]) { super(u, p); if (new URL(String(u), location.href).pathname === '/ws') sockets.push(this); } } as typeof WebSocket;
  let hidden: boolean | null = null;
  Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get() { return hidden ?? false; } });
  Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get() { return hidden ? 'hidden' : 'visible'; } });
  Object.assign(window, {
    __soak: {
      live,
      clock,
      jump(ms: number) { clock.offset += ms; },
      setScale(k: number) { const r = realNow(); clock.offset += (r - clock.base) * (clock.scale - k); clock.scale = k; },
      now: fakeNow,
      dropSocket() { for (const s of sockets) if (s.readyState <= 1) s.close(); },
      hide(h: boolean) { if (h === (hidden ?? false)) return; hidden = h; document.dispatchEvent(new Event('visibilitychange')); },
    },
  });
}

/**
 * `--tex`: after the warm-up, track every texture three uploads (it adds its 'dispose' listener then) with where the
 * texture was made, and print the ones that appeared (+) or went (−) since the last sample under each row. Texture
 * growth is then a list of creation sites rather than a number.
 */
function texProbe(): void {
  const T = (window as unknown as { __valley: { three: Record<string, { prototype: Record<string, unknown> }> } }).__valley.three;
  const made = new WeakMap<object, string>();
  const live = new Map<object, string>();
  const site = () => (new Error().stack ?? '').split('\n').slice(3, 12).map((l) => l.trim().replace(/^at /, '').replace(/\?v=\w+/, '').replace(/https?:\/\/[^/]+/, ''))
    .filter((l) => !l.includes('three.module') && !l.includes('three.core')).slice(0, 4).join(' < ');
  // three's Texture constructor assigns `mapping`: a prototype setter sees every new texture once
  Object.defineProperty(T.Texture.prototype, 'mapping', { configurable: true, get() { return undefined; }, set(v: unknown) { made.set(this, site()); Object.defineProperty(this, 'mapping', { value: v, writable: true, configurable: true, enumerable: true }); } });
  const ed = T.EventDispatcher.prototype as { addEventListener(t: string, f: unknown): void; removeEventListener(t: string, f: unknown): void };
  const ael = ed.addEventListener, rel = ed.removeEventListener;
  type Tex = { isTexture?: boolean; name?: string; constructor: { name: string }; image?: { width?: number; height?: number } };
  ed.addEventListener = function (this: Tex, type: string, fn: unknown) { if (type === 'dispose' && this.isTexture && !live.has(this)) live.set(this, `${this.constructor.name}${this.name ? `[${this.name}]` : ''} ${this.image?.width ?? '?'}x${this.image?.height ?? '?'} ${made.get(this) ?? '(made before the probe)'}`); ael.call(this, type, fn); };
  ed.removeEventListener = function (this: Tex, type: string, fn: unknown) { if (type === 'dispose' && this.isTexture) live.delete(this); rel.call(this, type, fn); };
  let prev = new Map<string, number>();
  (window as unknown as { __soakTex(): string[] }).__soakTex = () => {
    // one entry per GPU texture: clones (three clones a texture uniform into every new material's program uniforms)
    // share their source and its upload, as renderer.info counts them
    const bySource = new Map<unknown, string>();
    for (const [t, k] of live) { const src = (t as { source?: unknown }).source ?? t; if (!bySource.has(src)) bySource.set(src, k); }
    const now = new Map<string, number>();
    for (const k of bySource.values()) now.set(k, (now.get(k) ?? 0) + 1);
    const out: string[] = [];
    for (const k of new Set([...now.keys(), ...prev.keys()])) { const d = (now.get(k) ?? 0) - (prev.get(k) ?? 0); if (d) out.push(`tex ${d > 0 ? '+' : '−'}${Math.abs(d)} ${k}`); }
    prev = now;
    return out.slice(0, 12);
  };
}

interface Sample {
  t: number;
  heapMB: number; nodes: number; listeners: number; layout: number;
  geometries: number; textures: number; programs: number; objects: number;
  timeouts: number; intervals: number; rafs: number; audio: number;
  storage: Record<string, number>; storageTotal: number; hudNodes: number; hudTop: Record<string, number>; sceneTop: Record<string, number>;
  fps: number; frameErrors: number;
}

const METRICS: { k: keyof Sample; tol: number; unit: string }[] = [
  // tol = growth per hour (of the fitted line) above which a metric counts as leaking
  { k: 'heapMB', tol: 8, unit: 'MB' }, { k: 'nodes', tol: 300, unit: '' }, { k: 'listeners', tol: 100, unit: '' },
  { k: 'hudNodes', tol: 200, unit: '' }, { k: 'geometries', tol: 20, unit: '' }, { k: 'textures', tol: 6, unit: '' },
  { k: 'programs', tol: 4, unit: '' }, { k: 'objects', tol: 60, unit: '' }, { k: 'timeouts', tol: 20, unit: '' },
  { k: 'intervals', tol: 2, unit: '' }, { k: 'rafs', tol: 2, unit: '' }, { k: 'audio', tol: 60, unit: '' },
  { k: 'storageTotal', tol: 20_000, unit: 'B' },
];

type V = { ready: boolean; [k: string]: unknown };
const rng = (() => { let s = Number(opt('--seed', '1')) * 2654435761 >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
const pick = <T>(a: readonly T[]): T => a[Math.floor(rng() * a.length)];

async function ev<T>(page: Page, fn: string): Promise<T | null> {
  try { return await page.evaluate(fn) as T; } catch (e) { console.log(`  ! ${fn.slice(0, 80)}: ${(e as Error).message.split('\n')[0]}`); return null; }
}

/** live AudioNodes (CDP WebAudio created − destroyed) */
const audio = { live: 0 };
let lastAction = 'boot';
async function sample(page: Page, cdp: CDPSession, t0: number): Promise<Sample> {
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(300);
  await cdp.send('HeapProfiler.collectGarbage');
  const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  const p = await page.evaluate(() => {
    const w = window as unknown as { __valley: { ctx: { renderer: { info: { memory: { geometries: number; textures: number }; programs?: unknown[] } }; scene: { traverse(f: () => void): void } }; perf(): { fps: number; frameErrors: number } }; __soak: { live: { timeouts: Set<number>; intervals: Set<number>; rafs: Set<number> } } };
    const info = w.__valley.ctx.renderer.info;
    let objects = 0;
    w.__valley.ctx.scene.traverse(() => { objects++; });
    // the scene's biggest top-level subtrees (to name what an object spike or leak is made of)
    const sceneTop: Record<string, number> = {};
    for (const c of (w.__valley.ctx.scene as unknown as { children: { name: string; type: string; traverse(f: () => void): void }[] }).children) {
      let n = 0; c.traverse(() => { n++; });
      const k = c.name || c.type; sceneTop[k] = (sceneTop[k] ?? 0) + n;
    }
    // where the HUD's elements are: the biggest subtrees two levels down (to name a DOM leak)
    const hudTop = () => {
      const out: Record<string, number> = {};
      const walk = (el: Element, depth: number, pre: string) => {
        for (const c of el.children) {
          const name = `${pre}${c.tagName.toLowerCase()}${c.className && typeof c.className === 'string' ? '.' + c.className.split(' ').slice(0, c.classList.contains('vh-frame') ? 2 : 1).join('.') : ''   /* panels: section.vh-frame.vh-<id> */}`;
          if (depth < 2) walk(c, depth + 1, name + ' > ');
          else out[name] = (out[name] ?? 0) + c.getElementsByTagName('*').length + 1;
        }
      };
      const root = document.getElementById('hud');
      if (root) walk(root, 0, '');
      return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]).slice(0, 8));
    };
    const storage: Record<string, number> = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; storage[k] = (localStorage.getItem(k) ?? '').length; }
    const l = w.__soak.live, perf = w.__valley.perf();
    return {
      geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? 0, objects,
      timeouts: l.timeouts.size, intervals: l.intervals.size, rafs: l.rafs.size,
      storage, storageTotal: Object.values(storage).reduce((a, b) => a + b, 0),
      hudNodes: document.getElementById('hud')?.getElementsByTagName('*').length ?? 0, hudTop: hudTop(), sceneTop: Object.fromEntries(Object.entries(sceneTop).sort((a, b) => b[1] - a[1]).slice(0, 10)), fps: Math.round(perf.fps), frameErrors: perf.frameErrors,
    };
  });
  return { t: (Date.now() - t0) / 1000, audio: audio.live, heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1), nodes: m.Nodes, listeners: m.JSEventListeners, layout: m.LayoutObjects, ...p };
}

/** least-squares slope (per second) of y over t */
function slope(t: number[], y: number[]): number {
  const n = t.length; if (n < 2) return 0;
  const mt = t.reduce((a, b) => a + b) / n, my = y.reduce((a, b) => a + b) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (t[i] - mt) * (y[i] - my); den += (t[i] - mt) ** 2; }
  return den ? num / den : 0;
}

async function baseline(page: Page): Promise<void> {
  await ev(page, `(async () => {
    const v = __valley, h = window.__hud;
    __soak.hide(false);
    h?.close(); v.inside(false); v.gather(null); v.festival(null); v.wildlife && 0;
    v.setWeather(null); v.setSeason(null); v.setHour(10); v.cam(null); v.pose('hub');
    await v.scenario(${JSON.stringify(SCENARIOS[0])}, 1);
  })()`);
  // …and wait for the scene to get there: a scenario swap, a room or a festival's dressing takes a while to come
  // down, and a sample taken mid-way (hundreds of objects, +20 MB of heap) read as a spike the fit called growth.
  // The big one: the previous scenario's fields dissolve over 3.2 s of game time (scene/plots/field.ts close()) with
  // every mesh still in the scene until the end, so the count is flat *while* they go: 3 equal reads 2 s apart (6 s,
  // enough at the ~7 fps a loaded GPU gives) rather than 1 s apart
  // The fields of the scenario just left stand in their harvest stage for a few seconds (the model's HARVEST_MS, page
  // clock) before they close, and nothing in them moves meanwhile: a flat count then is not "settled". Those were the
  // +300–500 `plots` objects (and +10–20 MB of heap) some samples caught. So the count only starts once every plot in the
  // state is a live one again (≤ 40 s); the equal reads then cover the dissolve.
  let last = -1, same = 0;
  for (let i = 0; i < 20 && same < 2; i++) {
    const n = await ev(page, `(() => {
      const plots = Object.values(__valley.state().plots ?? {});
      if (plots.some((p) => p.stage === 'harvest' || p.stage === 'fallow')) return -1;
      let n = 0; __valley.ctx.scene.traverse(() => { n++; }); return n;
    })()`) as number;
    same = n === last && n >= 0 ? same + 1 : 0;
    last = n;
    await page.waitForTimeout(2000);
  }
}

async function churn(page: Page, seconds: number, log: (s: string) => void): Promise<void> {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    const a = pick([...ACTIONS]);
    await act(page, a);
    log(a);
  }
}

/**
 * Warm-up before the first sample: everything the HUD and scene build lazily on first use (each panel's DOM, sized by
 * the scenario it last rendered; rooms, gatherings, festival dressing, wildlife, the pet…) gets built once up front.
 * Without it the 20-minute run kept meeting panels for the first time in its second half (the soak opens one random
 * panel per action), and those one-off builds were fitted as growth. Every panel under every scenario, then every
 * action twice; `--warmup 0` skips it.
 */
async function warmUp(page: Page): Promise<void> {
  const v = (s: string) => ev(page, s);
  if (ACTIONS.has('panels')) for (const sc of SCENARIOS) {
    await v(`__valley.scenario(${JSON.stringify(sc)}, 1)`);
    await page.waitForTimeout(800);
    for (const p of PANELS) {
      await v(`window.__hud.open(${JSON.stringify(p)}, ${p === 'shop' ? "{ tab: 'buy', at: 'store' }" : 'undefined'})`);
      await page.waitForTimeout(300);
    }
    await v(`(() => { const ids = Object.keys(__valley.state().farmers); if (ids[0]) window.__hud.open('card', ids[0]); })()`);
    await page.waitForTimeout(300);
    await v('window.__hud.close()');
  }
  for (let pass = 0; pass < 2; pass++) for (const a of ACTIONS) if (a !== 'midnight') await act(page, a);
  // The random picks above left most places unseen, and three uploads a texture the first time something using it is
  // drawn: walking to a new pose (the landmarks' plaques, the noticeboard face…), a gathering's props or a room for
  // the first time in the run's second half read as +1…+5 textures, i.e. a 44 → 51 "leak" at 6/h. Visit every one
  // here and, at each stop, upload every texture the scene holds, drawn or not (far / hidden / culled objects; a room's
  // holder is only in the scene while you stand inside it).
  const upload = () => v(`(() => {
    const r = __valley.ctx.renderer;
    __valley.ctx.scene.traverse((o) => {
      for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
        for (const t of [...Object.values(m), ...Object.values(m.uniforms ?? {}).map((u) => u && u.value)]) {
          if (t && t.isTexture && !t.isRenderTargetTexture && !t.isDepthTexture && t.image) r.initTexture(t);
        }
      }
    });
  })()`);
  const each = async (on: boolean, list: string[], call: (x: string) => string, ms: number, off?: string) => {
    if (!on) return;
    for (const x of list) { await v(call(x)); await page.waitForTimeout(ms); await upload(); }
    if (off) await v(off);
  };
  await each(ACTIONS.has('poses'), POSES, (x) => `__valley.pose(${JSON.stringify(x)})`, 700);
  await each(ACTIONS.has('inside'), ROOMS, (x) => `__valley.inside(${JSON.stringify(x)})`, 900, '__valley.inside(false)');
  await each(ACTIONS.has('gather'), GATHERINGS, (x) => `__valley.gather(${JSON.stringify(x)})`, 2500, '__valley.gather(null)');
  await each(ACTIONS.has('festival'), FESTIVALS, (x) => `__valley.festival(${JSON.stringify(x)})`, 1200, '__valley.festival(null)');
  await upload();
}

async function act(page: Page, a: string): Promise<void> {
  const v = (s: string) => ev(page, s);
  {
    switch (a) {
      case 'scenario': await v(`__valley.scenario(${JSON.stringify(pick(SCENARIOS))}, ${1 + Math.floor(rng() * 5)})`); break;
      case 'panels': {
        const panel = pick(PANELS);
        await v(`window.__hud.open(${JSON.stringify(panel)}, ${panel === 'shop' ? "{ tab: 'buy', at: 'store' }" : 'undefined'})`);
        await page.waitForTimeout(400 + rng() * 800);
        // a farmer card now and then
        if (rng() < 0.4) { await v(`(() => { const ids = Object.keys(__valley.state().farmers); if (ids[0]) window.__hud.open('card', ids[Math.floor(Math.random() * ids.length)]); })()`); await page.waitForTimeout(500); }
        await v('window.__hud.close()');
        break;
      }
      case 'terminal': {
        await v(`(() => { const ids = Object.keys(__valley.state().farmers); if (ids.length) window.__hud.openTerminal(ids[Math.floor(Math.random() * ids.length)]); })()`);
        await page.waitForTimeout(1200 + rng() * 1500);
        await v('window.__hud.close()');
        break;
      }
      case 'toasts': for (let i = 0; i < 6; i++) await v(`window.__hud.toast({ text: 'soak ${i} ' + Date.now(), level: ${JSON.stringify(pick(['info', 'good', 'warn', 'error']))} })`); break;
      case 'poses': await v(`__valley.pose(${JSON.stringify(pick(POSES))})`); break;
      case 'weather':
        await v(`__valley.setWeather(${JSON.stringify(pick(['clear', 'cloudy', 'rain', 'storm', 'snow', 'fog', 'clear']))})`);
        await v(`__valley.setHour(${Math.floor(rng() * 24)})`);
        if (rng() < 0.3) await v(`__valley.setSeason(${JSON.stringify(pick(['spring', 'summer', 'autumn', 'winter']))})`);
        if (rng() < 0.3) await v(`__valley.atmo({ wet: ${rng().toFixed(2)}, snow: ${rng().toFixed(2)}, rainbow: 1 })`);
        break;
      case 'inside': await v(`__valley.inside(${JSON.stringify(pick(ROOMS))})`); await page.waitForTimeout(1500); await v('__valley.inside(false)'); break;
      case 'gather': await v(`__valley.gather(${JSON.stringify(pick(GATHERINGS))})`); await page.waitForTimeout(2500); await v('__valley.gather(null)'); break;
      case 'wildlife': await v(`__valley.wildlife(${JSON.stringify(pick(['deer', 'fox', 'heron', 'owl', 'hedgehog', 'geese']))}, 'here')`); await page.waitForTimeout(1500); break;
      case 'festival': await v(`__valley.festival(${JSON.stringify(pick([...FESTIVALS, null]))})`); await page.waitForTimeout(1200); break;
      case 'forage': await v(`__valley.forage('2026-${String(1 + Math.floor(rng() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rng() * 28)).padStart(2, '0')}')`); if (rng() < 0.5) await v('__valley.fish("demo")'); break;
      case 'pet': await v(`__valley.pet(${JSON.stringify(pick(['puppy', 'kitten', 'fetch', 'find', 'pet', 'home']))})`); break;
      case 'flap': await v(`(async () => { const ids = Object.keys(__valley.state().farmers); const id = ids[Math.floor(Math.random() * ids.length)]; if (!id) return; for (let i = 0; i < 12; i++) { await __valley.force(id, { status: ['working', 'blocked', 'idle', 'done'][i % 4] }); await new Promise((r) => setTimeout(r, 60)); } })()`); break;
      case 'socket': await v('__soak.dropSocket()'); await page.waitForTimeout(1500); break;
      case 'hidden': await v('__soak.hide(true)'); await v(`__soak.jump(${Math.round((1 + rng() * 4) * 3600_000)})`); await page.waitForTimeout(2000); await v('__soak.hide(false)'); break;
      case 'midnight': await v(`(() => { const d = new Date(__soak.now()); const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0).getTime(); __soak.jump(m - d.getTime() - 8000); })()`); await page.waitForTimeout(10_000); break;
    }
    await page.waitForTimeout(150 + rng() * 400);
    lastAction = a;
  }
}

async function main(): Promise<void> {
  process.env.HQ_LOG ??= 'warn';
  const target = opt('--url', '');
  const dev = target ? { url: new URL(target), close: async () => {} } : await startDev({
    port: 0, quiet: true, hmr: false, scenario: SCENARIOS[0], seed: Number(opt('--seed', '1')), population: Number(opt('--demo', '12')),
    timescale: Number(opt('--timescale', '20')),
  });
  const browser = await chromium.launch({ headless: true, args: [...GPU_ARGS, '--autoplay-policy=no-user-gesture-required', '--js-flags=--expose-gc'] });
  const issues: string[] = [];
  const samples: Sample[] = [];
  const actions: Record<string, number> = {};
  try {
    const context = await browser.newContext({ viewport: { width: W, height: H } });
    const startArg = opt('--start', '');
    await context.addInitScript(instrument, { start: startArg ? new Date(startArg).getTime() : 0, scale: Number(opt('--date-scale', '1')), stacks: argv.includes('--stacks') });
    const page = await context.newPage();
    page.on('pageerror', (e) => issues.push(`pageerror: ${e.message} [after ${lastAction}]\n${e.stack ?? ''}`));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') issues.push(`${m.type()}: ${m.text()} [after ${lastAction}]`); });
    page.on('crash', () => issues.push('page crashed'));
    let loads = 0;
    page.on('load', () => { if (++loads > 1) issues.push(`page reloaded [after ${lastAction}]`); });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    cdp.on('WebAudio.audioNodeCreated', () => { audio.live++; });
    cdp.on('WebAudio.audioNodeWillBeDestroyed', () => { audio.live--; });
    await cdp.send('WebAudio.enable').catch(() => {});
    const u = new URL(dev.url);
    u.searchParams.set('timescale', opt('--anim', '4'));
    await page.goto(u.toString());
    await page.waitForFunction(() => (window as unknown as { __valley?: V }).__valley?.ready === true, null, { timeout: 60_000 });
    await ev(page, 'window.__hud?.dismissHint(); __valley.ctx.services.get("audio")?._debug?.unlock?.()');
    if (opt('--warmup', '1') !== '0') { await warmUp(page); lastAction = 'warm-up'; }
    if (TEX) await ev(page, `(${texProbe.toString()})()`);
    const t0 = Date.now();
    const end = t0 + MINUTES * 60_000;
    await baseline(page);
    await page.waitForTimeout(SETTLE * 1000);
    samples.push(await sample(page, cdp, t0));
    console.log(`soak: ${MINUTES} min, cycle ${CYCLE}s, scenarios ${SCENARIOS.join('/')}, actions ${[...ACTIONS].join(' ')}`);
    const row = (s: Sample) => console.log(`  t=${String(Math.round(s.t)).padStart(5)}s heap ${s.heapMB}MB nodes ${s.nodes} hud ${s.hudNodes} lis ${s.listeners} geo ${s.geometries} tex ${s.textures} prog ${s.programs} obj ${s.objects} to ${s.timeouts} iv ${s.intervals} raf ${s.rafs} audio ${s.audio} ls ${s.storageTotal}B fps ${s.fps} err ${s.frameErrors}`);
    row(samples[0]);
    while (Date.now() < end) {
      await churn(page, Math.min(CYCLE, (end - Date.now()) / 1000), (a) => { actions[a] = (actions[a] ?? 0) + 1; });
      await baseline(page);
      await page.waitForTimeout(SETTLE * 1000);
      samples.push(await sample(page, cdp, t0));
      row(samples.at(-1)!);
      if (TEX) for (const l of (await ev<string[]>(page, '__soakTex()')) ?? []) console.log(`      ${l}`);
    }
  } finally {
    await browser.close().catch(() => {});
    await dev.close();
  }

  // ---- report
  const half = samples.slice(Math.floor(samples.length / 2));
  const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };
  const third = Math.max(1, Math.floor(samples.length / 3));
  const ts = half.map((s) => s.t);
  const leaks: string[] = [];
  console.log('\nleak report (fit over the second half; per hour):');
  for (const { k, tol, unit } of METRICS) {
    const ys = half.map((s) => s[k] as number);
    const perHour = slope(ts, ys) * 3600;
    const first = samples[0][k] as number, last = samples.at(-1)![k] as number;
    // growing = the fitted slope is over tolerance and the last third sits above the middle third (noise-robust)
    const mid = med(samples.slice(third, 2 * third).map((s) => s[k] as number)), end = med(samples.slice(-third).map((s) => s[k] as number));
    // …and it grew by a real amount overall (a quarter of the hourly tolerance), so short runs don't flag jitter
    const flag = half.length >= 3 && perHour > tol && end > mid && last - first > tol / 4;
    if (flag) leaks.push(k);
    console.log(`  ${flag ? 'LEAK' : 'ok  '} ${k.padEnd(13)} ${String(first).padStart(9)} → ${String(last).padStart(9)}${unit}   ${perHour >= 0 ? '+' : ''}${perHour.toFixed(1)}${unit}/h (tol ${tol}; medians ${mid} → ${end})`);
  }
  const last = samples.at(-1)!;
  console.log(`  hud first: ${JSON.stringify(samples[0].hudTop)}\n  hud last:  ${JSON.stringify(last.hudTop)}`);
  console.log(`  storage: ${Object.entries(last.storage).map(([k, n]) => `${k}=${n}B`).join(' ')}`);
  console.log(`  actions: ${Object.entries(actions).map(([k, n]) => `${k}×${n}`).join(' ')}`);
  const uniq = [...new Set(issues)];
  console.log(`\nconsole: ${issues.length} errors/warnings (${uniq.length} distinct)`);
  for (const i of uniq.slice(0, 30)) console.log(`  ${i.slice(0, argv.includes('--stacks') ? 1200 : 300)}`);
  if (JSON_OUT) {
    const f = path.resolve(REPO, JSON_OUT);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ samples, leaks, issues: uniq, actions }, null, 1));
    console.log(`\nwrote ${path.relative(REPO, f)}`);
  }
  if (leaks.length || uniq.length) process.exitCode = 1;
}

if (import.meta.main) void main().catch((e: unknown) => { console.error(e); process.exitCode = 1; });
