#!/usr/bin/env node
// GPU-accelerated headless screenshot + perf probe (playwright-core + Chromium, ANGLE/Vulkan on the 780M). DESIGN §9.3.
//
// usage: node scripts/shoot.ts <url> <outPrefix> [options]
//   --pose x,y,z,yaw,pitch   repeatable; world coords, y = feet → window.__hq.setPose(...) before each shot
//   --pose name              repeatable; canonical pose → window.__hq.pose(name) (§9.2)
//   --wait ms                settle time after __hq.ready (default 1500)
//   --ready-timeout ms       max wait for window.__hq.ready (default 20000; missing/timeout → warning, not failure)
//   --settle ms              settle time after each pose (default 800)
//   --size WxH               viewport (default 1920x1080)
//   --eval "js"              evaluate expression after load (awaited), print result (repeatable; runs in order)
//   --each "js"              evaluate after each pose, before the shot (repeatable)
//   --measure ms             rAF fps sampling window per shot (default 2000; 0 = skip)
//   --uncapped               disable vsync/frame-rate limit so fps reflects real GPU throughput
//   --no-gpu                 SwiftShader software GL (sanity baseline)
//   --angle vulkan|gl-egl    ANGLE backend (default vulkan; gl-egl renders the post stack black, §10)
//   --browser path           Chromium binary (default: $HQ_CHROME or newest ~/.cache/ms-playwright/chromium-*)
//   --allow-console          console errors don't fail the run (page errors still do)
//   --json                   print one JSON line per shot instead of text
// Page contract: window.__hq.ready / setPose / pose / stats (§9.1).
// Output: <outPrefix>-<i>.png per shot; stdout: renderer string, per-shot fps + stats, console errors/warnings.
// Exit: 2 on a page error, a console error (unless --allow-console), or software GL while GPU was requested; 1 on
// navigation/other failure.
// Importable: launchBrowser(o), openPage(browser, url, o) → {page, logs, errors(), gpu}, measureFps(page, ms).
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errMessage } from '../shared/guards.ts';
import type { PageWindow } from './pageTypes.ts';

declare const window: PageWindow;

// ANGLE's 'GPU stall due to ReadPixels' comes from screenshot readback itself; favicon 404s are irrelevant.
const NOISE = /GPU stall due to ReadPixels|favicon\.ico/;

export function findChrome(explicit?: string) {
  if (explicit) return explicit;
  const base = path.join(os.homedir(), '.cache/ms-playwright');
  const dir = fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => +a.split('-')[1] - +b.split('-')[1]).pop();
  if (!dir) throw new Error('no chromium in ~/.cache/ms-playwright (npx playwright-core install chromium)');
  return path.join(base, dir, 'chrome-linux64/chrome');
}

export interface LaunchOpts { gpu?: boolean; angle?: string; uncapped?: boolean; browser?: string }

export async function launchBrowser(o: LaunchOpts = {}) {
  const gpu = o.gpu !== false;
  // Verified on Ubuntu 24.04 / Radeon 780M (RADV): ANGLE-on-Vulkan gives hardware WebGL2 headless with no X server.
  const gpuArgs = [`--use-angle=${o.angle || 'vulkan'}`, ...(o.angle && o.angle !== 'vulkan' ? [] : ['--enable-features=Vulkan']), '--ignore-gpu-blocklist', '--enable-gpu'];
  const args = ['--no-sandbox', ...(gpu ? gpuArgs : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])];
  if (o.uncapped) args.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
  return chromium.launch({ executablePath: findChrome(o.browser || process.env.HQ_CHROME), args, headless: true });
}

export interface OpenOpts { size?: [number, number]; readyTimeout?: number; wait?: number }

/** What the page's WebGL probe reports (`software` is derived from the renderer string here). */
export interface GpuInfo { webgl2: boolean; vendor?: string | null; renderer?: string | null; software?: boolean }

/** Open a page, wire logging, navigate, await __hq.ready. */
export async function openPage(browser: Browser, url: string, o: OpenOpts = {}) {
  const [w, h] = o.size ?? [1920, 1080];
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const logs: string[] = [];
  let pageErrors = 0, consoleErrors = 0;
  page.on('console', (m) => {
    const t = m.type();
    if ((t === 'error' || t === 'warning') && !NOISE.test(m.text()) && !NOISE.test(m.location()?.url || '')) {
      logs.push(`[${t}] ${m.text()}`);
      if (t === 'error') consoleErrors++;
    }
  });
  page.on('pageerror', (e) => { pageErrors++; logs.push(`[pageerror] ${e.message}\n${e.stack}`); });
  page.on('requestfailed', (r) => { if (!NOISE.test(r.url())) logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`); });
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  const readyTimeout = o.readyTimeout ?? 20000;
  const ready = await page.evaluate((ms) => new Promise<string>((res) => {
    const t0 = performance.now();
    const poll = () => {
      if (window.__hq?.ready) window.__hq.ready.then(() => res('ready'), (e) => res(`ready rejected: ${e}`));
      else if (performance.now() - t0 > ms) res('no __hq');
      else setTimeout(poll, 50);
    };
    poll();
    setTimeout(() => res('timeout'), ms);
  }), readyTimeout);
  if (ready !== 'ready') logs.push(`[shoot] __hq.ready: ${ready}`);
  await page.waitForTimeout(o.wait ?? 1500);
  const gpu: GpuInfo = await page.evaluate((): GpuInfo => {
    const c = document.createElement('canvas').getContext('webgl2');
    if (!c) return { webgl2: false };
    const d = c.getExtension('WEBGL_debug_renderer_info');
    return { webgl2: true, vendor: d && c.getParameter(d.UNMASKED_VENDOR_WEBGL), renderer: d && c.getParameter(d.UNMASKED_RENDERER_WEBGL) };
  });
  gpu.software = /swiftshader|llvmpipe|software/i.test(gpu.renderer || '');
  return { page, logs, gpu, ready, errors: () => ({ pageErrors, consoleErrors }) };
}

export interface FpsSample { fps: number; worstMs: number }

/** rAF fps over `ms`. */
export function measureFps(page: Page, ms: number): Promise<FpsSample> {
  return page.evaluate((ms) => new Promise<FpsSample>((res) => {
    let n = 0; const t0 = performance.now(); let worst = 0, prev = t0;
    const f = (t: number) => { n++; worst = Math.max(worst, t - prev); prev = t; if (t - t0 < ms) requestAnimationFrame(f); else res({ fps: n / ((t - t0) / 1000), worstMs: worst }); };
    requestAnimationFrame(f);
  }), ms);
}

/** Apply a pose: array → setPose, string → pose(name). */
export async function applyPose(page: Page, pose: string | number[] | null | undefined) {
  if (pose === null || pose === undefined) return null;
  return page.evaluate((p) => (Array.isArray(p) ? window.__hq?.setPose?.(...p) : window.__hq?.pose?.(p)) ?? null, pose);
}

interface ShootOpts extends LaunchOpts, Required<OpenOpts> {
  poses: (string | number[])[];
  evals: string[];
  each: string[];
  settle: number;
  measure: number;
  json: boolean;
  allowConsole: boolean;
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv[0] === '-h' || argv[0] === '--help') {
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
    process.exit(0);
  }
  const url = argv[0];
  const out = argv[1] || path.join(os.tmpdir(), 'hq-shot');
  const o: ShootOpts = { poses: [], evals: [], each: [], wait: 1500, readyTimeout: 20000, settle: 800, size: [1920, 1080], measure: 2000, uncapped: false, gpu: true, browser: process.env.HQ_CHROME, json: false, allowConsole: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pose') { const v = argv[++i]; o.poses.push(/^[-\d.]+(,[-\d.]+){4}$/.test(v) ? v.split(',').map(Number) : v); }
    else if (a === '--wait') o.wait = +argv[++i];
    else if (a === '--ready-timeout') o.readyTimeout = +argv[++i];
    else if (a === '--settle') o.settle = +argv[++i];
    else if (a === '--size') { const [w, h] = argv[++i].split('x').map(Number); o.size = [w, h]; }
    else if (a === '--eval') o.evals.push(argv[++i]);
    else if (a === '--each') o.each.push(argv[++i]);
    else if (a === '--measure') o.measure = +argv[++i];
    else if (a === '--uncapped') o.uncapped = true;
    else if (a === '--no-gpu') o.gpu = false;
    else if (a === '--angle') o.angle = argv[++i];
    else if (a === '--browser') o.browser = argv[++i];
    else if (a === '--allow-console') o.allowConsole = true;
    else if (a === '--json') o.json = true;
    else { console.error(`unknown arg ${a}`); process.exit(1); }
  }
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });

  const browser = await launchBrowser(o);
  let exit = 0;
  let sess: Awaited<ReturnType<typeof openPage>> | null = null;
  const logs: string[] = [];
  try {
    sess = await openPage(browser, url, o);
    const { page, gpu } = sess;
    if (!o.json) console.log(`renderer: ${gpu.renderer} (${gpu.vendor})${gpu.software ? '  <-- SOFTWARE' : ''}`);
    if (o.gpu && gpu.software) exit = 2;
    for (const e of o.evals) {
      const r = await page.evaluate(e).catch((err) => `EVAL ERROR ${errMessage(err)}`);
      console.log('eval', JSON.stringify(r));
    }
    const shots = o.poses.length ? o.poses : [null];
    for (let i = 0; i < shots.length; i++) {
      if (shots[i] !== null) {
        const r = await applyPose(page, shots[i]);
        if (r === null) sess.logs.push(`[shoot] pose ${JSON.stringify(shots[i])} not applied (unknown name or no __hq)`);
        await page.waitForTimeout(o.settle);
      }
      for (const e of o.each) {
        const r = await page.evaluate(e).catch((err) => `EVAL ERROR ${errMessage(err)}`);
        console.log('each', i, JSON.stringify(r));
      }
      const fps = o.measure > 0 ? await measureFps(page, o.measure) : null;
      const stats = await page.evaluate(() => window.__hq?.stats?.() ?? null);
      const file = `${out}-${i}.png`;
      await page.screenshot({ path: file });
      if (o.json) console.log(JSON.stringify({ file, pose: shots[i], renderer: gpu.renderer, fps: fps && +fps.fps.toFixed(1), worstMs: fps && +fps.worstMs.toFixed(1), stats }));
      else console.log(`shot ${file} pose=${shots[i] ?? '-'} fps=${fps ? fps.fps.toFixed(1) : '-'} worst=${fps ? fps.worstMs.toFixed(1) + 'ms' : '-'} stats=${JSON.stringify(stats)}`);
    }
  } catch (e) {
    logs.push(`[shoot] ${errMessage(e)}`); exit = 1;
  }
  if (sess) {
    logs.unshift(...sess.logs);
    const { pageErrors, consoleErrors } = sess.errors();
    if (pageErrors || (consoleErrors && !o.allowConsole)) exit = exit || 2;
  }
  if (logs.length) console.log(`--- console (${logs.length}) ---\n${logs.slice(-40).join('\n')}`);
  await browser.close();
  process.exit(exit);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
