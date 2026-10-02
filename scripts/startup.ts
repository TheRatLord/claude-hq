/**
 * Load-time benchmark (`npm run bench -- --startup`): serves a built `dist/` from an in-process demo backend and loads
 * the valley N times in a fresh Chromium each (no shared GPU program cache, no HTTP / V8 code cache), on the real GPU.
 * Per run it prints:
 *
 *   main    ms from navigation start until every module evaluated (performance mark 'valley:main'; download + parse)
 *   sys     ms building the systems (marks 'valley:systems-start' → 'valley:systems'; the per-system split is
 *           __valley.startup().buildMs, `--systems` prints the top ones)
 *   frame1  ms from navigation start until the first frame was submitted, and that frame's own ms (`f1ms`: mostly
 *           shader program compiles + first uploads)
 *   ready   ms until __valley.ready (world in, 3 frames drawn, +400 ms settle)
 *   progs   shader programs compiled at ready; `link` = main-thread ms inside linkProgram / getProgramParameter (sync
 *           compile stalls) ; `long` = total long-task ms (> 50 ms tasks) until ready; `js` = JS bytes fetched
 *
 *   npm run build && npm run bench -- --startup                         # 5 runs of dist/
 *   npm run bench -- --startup --dist dist,scratch/base/dist --runs 6   # A/B: alternate two builds, medians per build
 *   npm run bench -- --startup --cold                                   # also disable Mesa's on-disk shader cache
 *
 * Options: --dist a[,b] (default dist)  --runs 5  --scenario mixed  --pose (URL pose)  --size 1600x900  --systems
 *          --json FILE
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { createApp } from '../server/app.ts';
import { REPO } from './devserver.ts';
import { GPU_ARGS } from './gpu.ts';

interface Run {
  dist: string; main: number; sysMs: number; frame1: number; f1ms: number; world: number; ready: number;
  progs: number; link: number; linkN: number; long: number; js: number; heapMB: number; build: Record<string, number>;
}

/** in-page (before any script): counts program links and their sync stalls, the first draw, long tasks */
const INIT = `(() => {
  const S = window.__startup = { link: 0, linkN: 0, long: 0, firstDraw: 0 };
  for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) {
    const p = C.prototype;
    for (const k of ['linkProgram', 'getProgramParameter', 'getShaderParameter', 'getProgramInfoLog', 'getShaderInfoLog']) {
      const f = p[k];
      p[k] = function (...a) { const t = performance.now(); try { return f.apply(this, a); } finally { S.link += performance.now() - t; if (k === 'linkProgram') S.linkN++; } };
    }
    for (const k of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const f = p[k];
      p[k] = function (...a) { if (!S.firstDraw) S.firstDraw = performance.now(); return f.apply(this, a); };
    }
  }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) S.long += e.duration; }).observe({ type: 'longtask', buffered: true }); } catch {}
})();`;

const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

export async function startupBench(argv: string[]): Promise<void> {
  const opt = (k: string, d: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const dists = opt('--dist', 'dist').split(',').filter(Boolean).map((d) => path.resolve(REPO, d));
  const runs = Number(opt('--runs', '5'));
  const scenario = opt('--scenario', 'mixed');
  const pose = opt('--pose', '');
  const [W, H] = opt('--size', '1600x900').split('x').map(Number);
  const jsonOut = opt('--json', '');
  const showSys = argv.includes('--systems');
  const env = argv.includes('--cold') ? { ...process.env, MESA_SHADER_CACHE_DISABLE: 'true' } as Record<string, string> : undefined;
  for (const d of dists) if (!fs.existsSync(path.join(d, 'index.html'))) throw new Error(`no build at ${d} (npm run build)`);
  const apps = await Promise.all(dists.map(async (distDir) => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-startup-'));
    const app = await createApp({ demo: 12, scenario, seed: 1, port: 0, distDir, configDir });
    return { distDir, configDir, app };
  }));
  const rows: Run[] = [];
  const pad = (s: string | number, n: number) => String(s).padStart(n);
  console.log(`${'build'.padEnd(24)} ${pad('main', 5)} ${pad('sys', 5)} ${pad('frame1', 6)} ${pad('f1ms', 5)} ${pad('world', 5)} ${pad('ready', 5)} ${pad('progs', 5)} ${pad('link', 5)} ${pad('long', 5)} ${pad('jsKB', 5)} ${pad('heap', 5)}`);
  try {
    for (let i = 0; i < runs; i++) {
      for (const a of apps) {
        const browser = await chromium.launch({ headless: true, args: GPU_ARGS, ...(env ? { env } : {}) });
        try {
          const context = await browser.newContext({ viewport: { width: W, height: H } });
          await context.addInitScript(INIT);
          const page = await context.newPage();
          const errors: string[] = [];
          page.on('pageerror', (e) => errors.push(e.message));
          const u = new URL(`http://127.0.0.1:${a.app.port}/`);
          u.searchParams.set('t', a.app.token);
          u.searchParams.set('hour', '10'); u.searchParams.set('weather', 'clear');
          if (pose) u.searchParams.set('pose', pose);
          await page.goto(u.toString());
          await page.waitForFunction(() => (window as unknown as { __valley?: { ready: boolean } }).__valley?.ready === true, null, { timeout: 90_000, polling: 50 });
          const r = await page.evaluate(() => {
            const mark = (n: string) => performance.getEntriesByName(n)[0]?.startTime ?? NaN;
            const S = (window as unknown as { __startup: { link: number; linkN: number; long: number; firstDraw: number } }).__startup;
            const v = (window as unknown as { __valley: { startup?(): { buildMs: Record<string, number>; firstFrameAt: number; firstFrameMs: number; programs: number }; ctx: { renderer: { info: { programs: unknown[] | null } } } } }).__valley;
            const st = v.startup?.();
            const js = (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
              .filter((e) => e.name.endsWith('.js')).reduce((s, e) => s + (e.decodedBodySize || 0), 0);
            const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
            return {
              main: mark('valley:main'), sysMs: mark('valley:systems') - mark('valley:systems-start'),
              frame1: st?.firstFrameAt || S.firstDraw, f1ms: st?.firstFrameMs ?? NaN, world: mark('valley:world'), ready: mark('valley:ready'),
              progs: st?.programs ?? v.ctx.renderer.info.programs?.length ?? 0, link: S.link, linkN: S.linkN, long: S.long, js, heapMB: (mem?.usedJSHeapSize ?? 0) / 1048576,
              build: st?.buildMs ?? {},
            };
          });
          const tag = path.relative(REPO, a.distDir) || a.distDir;
          const row: Run = { dist: tag, ...r };
          rows.push(row);
          const f = (x: number) => Number.isFinite(x) ? Math.round(x) : '-';
          console.log(`${tag.slice(-24).padEnd(24)} ${pad(f(r.main), 5)} ${pad(f(r.sysMs), 5)} ${pad(f(r.frame1), 6)} ${pad(f(r.f1ms), 5)} ${pad(f(r.world), 5)} ${pad(f(r.ready), 5)} ${pad(r.progs, 5)} ${pad(f(r.link), 5)} ${pad(f(r.long), 5)} ${pad(Math.round(r.js / 1024), 5)} ${pad(f(r.heapMB), 5)}`);
          for (const e of errors.slice(0, 5)) console.log(`  pageerror: ${e.slice(0, 300)}`);
          await context.close();
        } finally { await browser.close(); }
      }
    }
  } finally {
    for (const a of apps) { await a.app.close(); fs.rmSync(a.configDir, { recursive: true, force: true }); }
  }
  for (const d of [...new Set(rows.map((r) => r.dist))]) {
    const rs = rows.filter((r) => r.dist === d);
    const m = (k: keyof Run) => Math.round(med(rs.map((r) => r[k] as number)));
    console.log(`median ${d}: main ${m('main')}  sys ${m('sysMs')}  frame1 ${m('frame1')} (${m('f1ms')} ms)  ready ${m('ready')}  progs ${m('progs')}  link ${m('link')}  long ${m('long')}  js ${Math.round(m('js') / 1024)} KB`);
    if (showSys && rs[0] && Object.keys(rs[0].build).length) {
      const names = Object.keys(rs[0].build);
      const per = names.map((n) => [n, med(rs.map((r) => r.build[n] ?? 0))] as const).sort((x, y) => y[1] - x[1]);
      console.log('  build ms: ' + per.map(([n, x]) => `${n} ${x.toFixed(0)}`).join(', '));
    }
  }
  if (jsonOut) { fs.mkdirSync(path.dirname(path.resolve(REPO, jsonOut)), { recursive: true }); fs.writeFileSync(path.resolve(REPO, jsonOut), JSON.stringify(rows, null, 1)); }
}
