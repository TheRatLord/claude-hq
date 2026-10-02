#!/usr/bin/env node
/**
 * Repeatable render benchmark on the real GPU (same Chromium flags as `npm run shoot`). For each scenario × condition it
 * loads the valley once, then visits each pose and measures, per frame:
 *
 *   gpu     GPU ms of a whole frame (shadow map + scene + post), EXT_disjoint_timer_query_webgl2, median of reps
 *   scene   GPU ms of the scene render (incl. the shadow map), post = the rest (bloom, rays, composite, FXAA)
 *   shadow  GPU ms of the shadow map (scene with shadow updates on − off)
 *   cpu     the frame loop's main-thread ms (frame hooks + systems + render submission; EMA from __valley.perf())
 *   sys     sum of the systems' update ms (EMA); submit = JS + driver time of post.render() (draw submission)
 *   top     the three most expensive systems (ms, EMA)
 *   calls / tris   renderer.info for one frame (shadow pass included); shCalls = the shadow pass's share
 *
 *   npm run bench                                        # mixed + crowd40 × day/night/rain × 7 poses
 *   npm run bench -- --scenario mixed --cond day --pose hub,top
 *   npm run bench -- --quality low --reps 5 --frames 40 --json scratch/bench/a.json --shots
 *
 * Options: --scenario a,b (mixed,crowd40)  --cond day,night,rain,snow  --pose hub,square,river,pond,east,top,inside
 *          --size 1600x900  --quality high|medium|low (default: the game's default)  --reps 3  --frames 30
 *          --settle 2500 (ms after each pose)  --json FILE  --shots (PNG per pose → scratch/bench/<scenario>-<cond>-<pose>.png)
 *          --eval JS (run in the page after load, e.g. A/B toggles)
 *   npm run bench -- --startup                           # load time instead: first frame, ready, programs (scripts/startup.ts)
 * The machine may be busy (other agents shooting): check `uptime`, run A and B alternately, compare medians.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import type { Page } from '@playwright/test';
import { startDev, REPO } from './devserver.ts';
import { GPU_ARGS } from './gpu.ts';
import { startupBench } from './startup.ts';

const argv = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const list = (k: string, d: string) => opt(k, d).split(',').filter(Boolean);

/** x;y;z;yaw;pitch free camera, or a named pose (dev/api.ts POSES), or inside (the farmhouse) */
export const POSES: Record<string, string> = {
  hub: 'hub', square: 'square', river: 'river', pond: 'pond', east: 'east',
  top: 'cam:0;90;70;0;-0.95', inside: 'inside:room',
};
export const CONDS: Record<string, { hour: number; weather: string; season?: string }> = {
  day: { hour: 10, weather: 'clear' },
  night: { hour: 22, weather: 'clear' },
  rain: { hour: 14, weather: 'rain' },
  snow: { hour: 9, weather: 'snow', season: 'winter' },
};

interface Sample {
  gpu: number; scene: number; post: number; shadow: number; cpu: number; submit: number;
  calls: number; tris: number; shCalls: number; sysSum: number; sys: [string, number][]; fps: number; disjoint: boolean;
}

/** in-page: GPU phases via timer queries around the scene render inside post.render() */
export async function measure(page: Page, frames: number, reps: number): Promise<Sample | null> {
  return page.evaluate(async ([frames, reps]) => {
    type Q = WebGLQuery;
    const v = (window as unknown as { __valley: { ctx: { renderer: import('three').WebGLRenderer; scene: import('three').Scene; services: Map<string, unknown> }; perf(): { cpuMs: number; fps: number; systemMs: Record<string, number> } } }).__valley;
    const ctx = v.ctx, r = ctx.renderer;
    const gl = r.getContext() as WebGL2RenderingContext;
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    const post = ctx.services.get('post') as { render(dt: number): void } | undefined;
    if (!ext || !post) return null;
    const T = ext.TIME_ELAPSED_EXT;
    const orig = r.render;
    const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    const wait = async (q: Q) => {
      for (let i = 0; i < 400; i++) { if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return; await new Promise((res) => setTimeout(res, 5)); }
    };
    let disjoint = false;
    /** one batch of frames: per-frame scene and post GPU ms */
    const batch = async (): Promise<{ scene: number; post: number; submit: number }> => {
      const qs: Q[] = [], qp: Q[] = [];
      let cur: { s: Q; p: Q; open: boolean } | null = null;
      r.render = function (this: unknown, s: import('three').Object3D, c: import('three').Camera) {
        if (cur && s === ctx.scene) {
          gl.beginQuery(T, cur.s); orig.call(r, s, c); gl.endQuery(T);
          gl.beginQuery(T, cur.p); cur.open = true;
        } else orig.call(r, s, c);
      } as typeof r.render;
      gl.getParameter(ext.GPU_DISJOINT_EXT);
      let submit = 0;
      try {
        for (let i = 0; i < frames; i++) {
          cur = { s: gl.createQuery()!, p: gl.createQuery()!, open: false };
          const t0 = performance.now();
          post.render(0);
          submit += performance.now() - t0;
          if (cur.open) gl.endQuery(T);
          qs.push(cur.s); qp.push(cur.p);
          cur = null;
        }
      } finally { r.render = orig; }
      await wait(qp[qp.length - 1]);
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) disjoint = true;
      const ms = (q: Q) => { const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number; gl.deleteQuery(q); return ns / 1e6; };
      // drop the first frame (state changes, uploads)
      const s = qs.map(ms).slice(1), p = qp.map(ms).slice(1);
      return { scene: med(s), post: med(p), submit: submit / frames };
    };
    const on: { scene: number; post: number; submit: number }[] = [], off: number[] = [];
    let calls = 0, tris = 0, shCalls = 0;
    for (let k = 0; k < reps; k++) {
      // alternate shadows on / off so load spikes hit both
      r.shadowMap.autoUpdate = true;
      on.push(await batch());
      calls = r.info.render.calls; tris = r.info.render.triangles;
      r.shadowMap.autoUpdate = false;
      try { off.push((await batch()).scene); } finally { r.shadowMap.autoUpdate = true; }
      shCalls = calls - r.info.render.calls;
      r.shadowMap.needsUpdate = true;
    }
    const scene = med(on.map((o) => o.scene)), postMs = med(on.map((o) => o.post));
    const p = v.perf();
    const sys = Object.entries(p.systemMs).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, x]) => [k, +x.toFixed(2)] as [string, number]);
    const f2 = (x: number) => +x.toFixed(2);
    return {
      gpu: f2(scene + postMs), scene: f2(scene), post: f2(postMs), shadow: f2(Math.max(0, scene - med(off))),
      cpu: f2(p.cpuMs), sysSum: f2(Object.values(p.systemMs).reduce((a, b) => a + b, 0)), submit: f2(med(on.map((o) => o.submit))), calls, tris, shCalls, sys, fps: Math.round(p.fps), disjoint,
    };
  }, [frames, reps] as const);
}

async function main(): Promise<void> {
  const scenarios = list('--scenario', 'mixed,crowd40');
  const conds = list('--cond', 'day,night,rain');
  const poses = list('--pose', Object.keys(POSES).join(','));
  const [W, H] = opt('--size', '1600x900').split('x').map(Number);
  const quality = opt('--quality', '');
  const reps = Number(opt('--reps', '3')), frames = Number(opt('--frames', '30')), settle = Number(opt('--settle', '2500'));
  const jsonOut = opt('--json', '');
  const shots = argv.includes('--shots');
  const extra = opt('--eval', '');
  const shotDir = path.join(REPO, 'scratch/bench');
  if (shots || jsonOut) fs.mkdirSync(shotDir, { recursive: true });
  const rows: Record<string, unknown>[] = [];
  const browser = await chromium.launch({ headless: true, args: GPU_ARGS });
  const pad = (s: string | number, n: number) => String(s).padStart(n);
  console.log(`${'scenario'.padEnd(8)} ${'cond'.padEnd(5)} ${'pose'.padEnd(6)} ${pad('gpu', 6)} ${pad('scene', 6)} ${pad('shadow', 6)} ${pad('post', 5)} ${pad('cpu', 5)} ${pad('sys', 5)} ${pad('submit', 6)} ${pad('calls', 5)} ${pad('shCls', 5)} ${pad('tris', 8)}  top systems (ms)`);
  try {
    for (const scenario of scenarios) {
      const dev = await startDev({ port: 0, quiet: true, hmr: false, scenario, seed: 1, population: 12 });
      try {
        for (const cond of conds) {
          const c = CONDS[cond];
          if (!c) throw new Error(`unknown --cond ${cond}; have ${Object.keys(CONDS).join(', ')}`);
          const context = await browser.newContext({ viewport: { width: W, height: H } });
          const page = await context.newPage();
          const errors: string[] = [];
          page.on('pageerror', (e) => errors.push(e.message));
          const u = new URL(dev.url);
          u.searchParams.set('hour', String(c.hour));
          u.searchParams.set('weather', c.weather);
          if (c.season) u.searchParams.set('season', c.season);
          if (quality) u.searchParams.set('quality', quality);
          await page.goto(u.toString());
          await page.waitForFunction(() => (window as unknown as { __valley?: { ready: boolean } }).__valley?.ready === true, null, { timeout: 60_000 });
          await page.evaluate(() => (window as unknown as { __hud?: { dismissHint(): void } }).__hud?.dismissHint());
          if (extra) await page.evaluate(extra);
          for (const pose of poses) {
            const spec = POSES[pose] ?? pose;
            await page.evaluate((spec) => {
              const v = (window as unknown as { __valley: { pose(n: string): void; cam(...a: (number | null)[]): void; inside(v: string | false): void } }).__valley;
              if (spec.startsWith('inside')) { v.cam(null); v.inside(spec.split(':')[1] || 'door'); return; }
              v.inside(false);
              if (spec.startsWith('cam:')) { const [x, y, z, yaw, pitch] = spec.slice(4).split(';').map(Number); v.cam(x, y, z, yaw, pitch); }
              else { v.cam(null); v.pose(spec); }
            }, spec);
            await page.waitForTimeout(settle);
            const m = await measure(page, frames, reps);
            const tag = `${scenario}-${cond}-${pose}`;
            if (shots) await page.screenshot({ path: path.join(shotDir, `${tag}.png`) });
            if (!m) { console.log(`${scenario.padEnd(8)} ${cond.padEnd(5)} ${pose.padEnd(6)} (no timer query / post)`); continue; }
            rows.push({ scenario, cond, pose, ...m });
            console.log(`${scenario.padEnd(8)} ${cond.padEnd(5)} ${pose.padEnd(6)} ${pad(m.gpu.toFixed(2), 6)} ${pad(m.scene.toFixed(2), 6)} ${pad(m.shadow.toFixed(2), 6)} ${pad(m.post.toFixed(2), 5)} ${pad(m.cpu.toFixed(2), 5)} ${pad(m.sysSum.toFixed(2), 5)} ${pad(m.submit.toFixed(2), 6)} ${pad(m.calls, 5)} ${pad(m.shCalls, 5)} ${pad(m.tris, 8)}  ${m.sys.map(([k, x]) => `${k} ${x}`).join(', ')}${m.disjoint ? '  (disjoint!)' : ''}`);
          }
          for (const e of errors.slice(0, 5)) console.log(`  pageerror: ${e.slice(0, 300)}`);
          await context.close();
        }
      } finally { await dev.close(); }
    }
  } finally { await browser.close(); }
  if (rows.length) {
    const num = (k: string) => rows.map((r) => r[k] as number);
    const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    console.log(`mean gpu ${mean(num('gpu')).toFixed(2)} ms, max gpu ${Math.max(...num('gpu')).toFixed(2)} ms, mean cpu ${mean(num('cpu')).toFixed(2)} ms, max tris ${Math.max(...num('tris'))}`);
  }
  if (jsonOut) { fs.mkdirSync(path.dirname(path.resolve(REPO, jsonOut)), { recursive: true }); fs.writeFileSync(path.resolve(REPO, jsonOut), JSON.stringify(rows, null, 1)); }
}

if (import.meta.main) void (argv.includes('--startup') ? startupBench(argv) : main()).catch((e: unknown) => { console.error(e); process.exitCode = 1; });
