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
 *          --stacks (append a short stack to every console warning / error)
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
  if (o.start || o.scale !== 1) {
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

interface Sample {
  t: number;
  heapMB: number; nodes: number; listeners: number; layout: number;
  geometries: number; textures: number; programs: number; objects: number;
  timeouts: number; intervals: number; rafs: number; audio: number;
  storage: Record<string, number>; storageTotal: number; hudNodes: number; hudTop: Record<string, number>;
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
    // where the HUD's elements are: the biggest subtrees two levels down (to name a DOM leak)
    const hudTop = () => {
      const out: Record<string, number> = {};
      const walk = (el: Element, depth: number, pre: string) => {
        for (const c of el.children) {
          const name = `${pre}${c.tagName.toLowerCase()}${c.className && typeof c.className === 'string' ? '.' + c.className.split(' ')[0] : ''}`;
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
      hudNodes: document.getElementById('hud')?.getElementsByTagName('*').length ?? 0, hudTop: hudTop(), fps: Math.round(perf.fps), frameErrors: perf.frameErrors,
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
}

async function churn(page: Page, seconds: number, log: (s: string) => void): Promise<void> {
  const end = Date.now() + seconds * 1000;
  const v = (s: string) => ev(page, s);
  while (Date.now() < end) {
    const a = pick([...ACTIONS]);
    switch (a) {
      case 'scenario': await v(`__valley.scenario(${JSON.stringify(pick(SCENARIOS))}, ${1 + Math.floor(rng() * 5)})`); break;
      case 'panels': {
        const panel = pick(['map', 'mailbox', 'roster', 'almanac', 'collection', 'noticeboard', 'stats', 'pause', 'friends', 'pet', 'shop']);
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
      case 'poses': await v(`__valley.pose(${JSON.stringify(pick(['hub', 'farmhouse', 'square', 'windmill', 'pond', 'barn', 'river', 'plots', 'east', 'trailhead', 'trail', 'bridge', 'summit']))})`); break;
      case 'weather':
        await v(`__valley.setWeather(${JSON.stringify(pick(['clear', 'cloudy', 'rain', 'storm', 'snow', 'fog', 'clear']))})`);
        await v(`__valley.setHour(${Math.floor(rng() * 24)})`);
        if (rng() < 0.3) await v(`__valley.setSeason(${JSON.stringify(pick(['spring', 'summer', 'autumn', 'winter']))})`);
        if (rng() < 0.3) await v(`__valley.atmo({ wet: ${rng().toFixed(2)}, snow: ${rng().toFixed(2)}, rainbow: 1 })`);
        break;
      case 'inside': await v(`__valley.inside(${JSON.stringify(pick(['door', 'hearth', 'desk', 'bed', 'window']))})`); await page.waitForTimeout(1500); await v('__valley.inside(false)'); break;
      case 'gather': await v(`__valley.gather(${JSON.stringify(pick(['campfire', 'concert', 'market']))})`); await page.waitForTimeout(2500); await v('__valley.gather(null)'); break;
      case 'wildlife': await v(`__valley.wildlife(${JSON.stringify(pick(['deer', 'fox', 'heron', 'owl', 'hedgehog', 'geese']))}, 'here')`); await page.waitForTimeout(1500); break;
      case 'festival': await v(`__valley.festival(${JSON.stringify(pick(['blossom', 'lantern', 'founders', 'harvest', 'hallowtide', 'starlight', 'newyear', null]))})`); await page.waitForTimeout(1200); break;
      case 'forage': await v(`__valley.forage('2026-${String(1 + Math.floor(rng() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rng() * 28)).padStart(2, '0')}')`); if (rng() < 0.5) await v('__valley.fish("demo")'); break;
      case 'pet': await v(`__valley.pet(${JSON.stringify(pick(['puppy', 'kitten', 'fetch', 'find', 'pet', 'home']))})`); break;
      case 'flap': await v(`(async () => { const ids = Object.keys(__valley.state().farmers); const id = ids[Math.floor(Math.random() * ids.length)]; if (!id) return; for (let i = 0; i < 12; i++) { await __valley.force(id, { status: ['working', 'blocked', 'idle', 'done'][i % 4] }); await new Promise((r) => setTimeout(r, 60)); } })()`); break;
      case 'socket': await v('__soak.dropSocket()'); await page.waitForTimeout(1500); break;
      case 'hidden': await v('__soak.hide(true)'); await v(`__soak.jump(${Math.round((1 + rng() * 4) * 3600_000)})`); await page.waitForTimeout(2000); await v('__soak.hide(false)'); break;
      case 'midnight': await v(`(() => { const d = new Date(__soak.now()); const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0).getTime(); __soak.jump(m - d.getTime() - 8000); })()`); await page.waitForTimeout(10_000); break;
    }
    await page.waitForTimeout(150 + rng() * 400);
    log(a);
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
