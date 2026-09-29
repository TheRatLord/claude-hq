#!/usr/bin/env node
// Perf gate (DESIGN §9.3, §5.3): uncapped median-of-3 fps at fixed poses for scenarios mixed (the 12-agent demo, the
// M1 load), crowd40 and allStates.
// Fails (exit 3) on a > 15% regression of any row vs perf-baseline.json (repo root; committed — a missing baseline or
// a row missing from it fails too, exit 5), and (exit 4) when a `mixed` row on the proto room is under the M1 floor
// of 200 fps (§11 M1: "≥ 200 fps with 12 agents in proto"). Compare configurations only with this script (uncapped,
// median of 3; expect ±10% noise).
//
// usage: node scripts/perf.ts [--url http://host:port/?t=TOKEN] [--scenarios mixed,crowd40,allStates] [--poses a,b]
//                              [--runs 3] [--ms 3000] [--size 1920x1080] [--quality medium] [--write-baseline] [--json]
//                              [--layout hq|proto]
//   --layout L         force ?layout=L (hq is the default since M1.5; `--layout proto` for the M1 floor rows) [INT M1.5]
//   Without --url it starts its own stack per scenario (free ports, or `--ports backend,vite`; temp config dir).
//   Default poses: spawn,pitOverview,street on the hq layout; proto,protoDesks,protoCorner on the proto room.
//   --write-baseline   merge this run's rows into perf-baseline.json (rows of other layouts/scenarios are kept) [INT M1.5]; pass --reason "why" (stored in the file). Refuses to
//                      write when the GPU was contended (below) unless --force-busy.
//   --busy-max P       GPU contention guard (default 20): before each scenario, sample
//                      /sys/class/drm/card*/device/gpu_busy_percent (someone else's renderer, another reviewer's run);
//                      above P% it waits up to --busy-wait s (default 60) for quiet, then measures anyway and flags
//                      the rows `contended` — their regressions / M1 misses are reported as suspect, not trusted.
//                      Rows are also flagged `contended` when another Chromium GPU process (someone else's shoot /
//                      review / perf) exists right after measuring, and `noisy` when their runs spread > 20% after
//                      2 re-measures (load came and went). For a baseline prefer --runs 5 on a quiet GPU.
//   --no-baseline      measure only: skip the baseline comparison (implied by --url)
// Rows record the §5.3 split (drawCalls {main, shadow, portrait, post, total}, programs {scene, post, total}) and
// overBudget; a row with frameErrors > 0 (a frame callback threw) fails with exit 7; a row over a §5.3 triangle cap
// (overBudget `triangles*`, drawSplit TRI_BUDGET) fails with exit 8 [RND fix r2].
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDevStack, freePort } from './dev.ts';
import { launchBrowser, openPage, applyPose, measureFps } from './shoot.ts';
import type { DrawCalls, PageWindow, Programs, TriSplit } from './pageTypes.ts';
import type { DevStack } from './dev.ts';
import { isRecord } from '../shared/guards.ts';

declare const window: PageWindow;

const REPO = fileURLToPath(new URL('..', import.meta.url));
const BASELINE = path.join(REPO, 'perf-baseline.json');
const argv = process.argv.slice(2);
interface PerfOpts {
  url: string | null;
  ports?: number[];
  scenarios: string[];
  poses: string[] | null;
  runs: number;
  ms: number;
  size: [number, number];
  quality: string;
  layout?: string;
  write: boolean;
  json: boolean;
  compare: boolean;
  reason: string | null;
  busyMax: number;
  busyWait: number;
  forceBusy: boolean;
}

/** One measured scenario@pose row (also what perf-baseline.json stores, plus `baseline`/`delta` when compared). */
interface PerfRow {
  key: string;
  scenario: string;
  pose: string;
  layout: string;
  fps: number;
  runs: number[];
  drawCalls: DrawCalls | undefined;
  triangles: number | undefined;
  trianglesSplit: TriSplit | null;
  programs: Programs | undefined;
  overBudget: string[];
  frameErrors: number;
  actors: number | undefined;
  gpuBusyBefore: number | null;
  contended?: boolean;
  noisy?: boolean;
  otherGpuClients?: number;
  baseline?: number;
  delta?: number;
}

/** perf-baseline.json as read back: rows are kept whole when merged, only `key` and `fps` are read. */
/** the M1 acceptance summary */
interface M1 { floor: number; minFps: number; actors: number; pass?: boolean; contended?: boolean }

interface BaselineRow { key: string; fps: number; [k: string]: unknown }
interface Baseline { reason?: string; rows?: BaselineRow[] }
const isBaselineRow = (r: unknown): r is BaselineRow => isRecord(r) && typeof r.key === 'string' && typeof r.fps === 'number';

const o: PerfOpts = { url: null, scenarios: ['mixed', 'crowd40', 'allStates'], poses: null, runs: 3, ms: 3000, size: [1920, 1080], quality: 'medium', write: false, json: false, compare: true, reason: null, busyMax: 20, busyWait: 60, forceBusy: false };
const M1_FLOOR = 200; // fps, `mixed` (12 agents) on the proto room
const DEMO_N = 12;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--url') o.url = argv[++i];
  else if (a === '--ports') o.ports = argv[++i].split(',').map(Number);
  else if (a === '--scenarios') o.scenarios = argv[++i].split(',');
  else if (a === '--poses') o.poses = argv[++i].split(',');
  else if (a === '--runs') o.runs = +argv[++i];
  else if (a === '--ms') o.ms = +argv[++i];
  else if (a === '--size') { const [w, h] = argv[++i].split('x').map(Number); o.size = [w, h]; }
  else if (a === '--quality') o.quality = argv[++i];
  else if (a === '--layout') o.layout = argv[++i]; // [INT M1.5]
  else if (a === '--write-baseline') o.write = true;
  else if (a === '--no-baseline') o.compare = false;
  else if (a === '--json') o.json = true;
  else if (a === '--reason') o.reason = argv[++i];
  else if (a === '--busy-max') o.busyMax = +argv[++i];
  else if (a === '--busy-wait') o.busyWait = +argv[++i];
  else if (a === '--force-busy') o.forceBusy = true;
  else if (a === '-h' || a === '--help') {
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
    process.exit(0);
  } else { console.error(`unknown arg ${a}`); process.exit(1); }
}
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/** amdgpu busy counters (every card that has one); [] when unavailable (not amdgpu / no sysfs). */
const BUSY_FILES = (() => {
  try {
    return fs.readdirSync('/sys/class/drm').filter((d) => /^card\d+$/.test(d))
      .map((d) => `/sys/class/drm/${d}/device/gpu_busy_percent`).filter((f) => fs.existsSync(f));
  } catch { return []; }
})();
/** Median GPU busy % over ~1 s (10 samples, max over cards), or null when unknown. */
async function gpuBusy() {
  if (!BUSY_FILES.length) return null;
  const xs: number[] = [];
  for (let i = 0; i < 10; i++) {
    xs.push(Math.max(...BUSY_FILES.map((f) => { try { return +fs.readFileSync(f, 'utf8'); } catch { return 0; } })));
    await new Promise((r) => setTimeout(r, 100));
  }
  return median(xs);
}
/**
 * Other Chromium GPU processes on the box (another engineer's shoot / review / perf run): gpu-processes whose parent
 * browser isn't one of ours (our browser is a direct child of this node process). Linux /proc only; 0 elsewhere.
 */
function otherGpuClients() {
  try {
    const procs: { pid: number; ppid: number; gpu: boolean }[] = [];
    for (const d of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(d)) continue;
      try {
        const cmd = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8');
        const ppid = +fs.readFileSync(`/proc/${d}/stat`, 'utf8').split(') ')[1].split(' ')[1];
        procs.push({ pid: +d, ppid, gpu: cmd.includes('--type=gpu-process') });
      } catch { /* exited */ }
    }
    const ours = new Set(procs.filter((p) => p.ppid === process.pid).map((p) => p.pid));
    return procs.filter((p) => p.gpu && !ours.has(p.ppid)).length;
  } catch { return 0; }
}
/** Wait (up to o.busyWait s) for the GPU to drop to ≤ o.busyMax %; returns the last reading (null = unknown). */
async function waitQuietGpu(label: string) {
  let b = await gpuBusy();
  const others = otherGpuClients();
  if (others) console.warn(`perf: note: ${others} other Chromium GPU process(es) running (another shoot/review/perf run?)`);
  if (b === null || b <= o.busyMax) return b;
  console.warn(`perf: WARNING GPU ${b}% busy before ${label} (> ${o.busyMax}%: another renderer is running) — waiting up to ${o.busyWait}s for quiet`);
  const until = Date.now() + o.busyWait * 1000;
  while (b !== null && b > o.busyMax && Date.now() < until) { await new Promise((r) => setTimeout(r, 2000)); b = await gpuBusy(); }
  if (b !== null && b > o.busyMax) console.warn(`perf: WARNING GPU still ${b}% busy — measuring anyway; ${label} rows are flagged contended (numbers are low)`);
  return b;
}

// §5.3 split contract (core/drawSplit.ts): drawCalls {main, shadow, portrait, post, total}, programs {scene, post, total}
const fmtDraws = (d: DrawCalls | undefined) => (d && typeof d === 'object' ? `${d.total} (main ${d.main}/110 shadow ${d.shadow}/25 portrait ${d.portrait} post ${d.post})` : `${d}`);
const fmtProgs = (p: Programs | undefined) => (p && typeof p === 'object' ? `scene ${p.scene}/14 post ${p.post}/16` : `${p}`);

const rows: PerfRow[] = [];
let exit = 0;
const browser = await launchBrowser({ uncapped: true });
try {
  for (const scenario of o.url ? ['(url)'] : o.scenarios) {
    let stack: DevStack | null = null;
    let url = o.url;
    const busy = await waitQuietGpu(scenario); // before our own stack starts: only other users' load shows
    const contended = busy !== null && busy > o.busyMax;
    if (!url) {
      const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-perf-'));
      stack = await startDevStack({ scenario, demo: DEMO_N, seed: 1, hmr: false, port: o.ports?.[0] ?? await freePort(), vitePort: o.ports?.[1] ?? await freePort(), configDir, quiet: true });
      url = stack.url;
    }
    try {
      const u = new URL(url);
      u.searchParams.set('quality', o.quality);
      u.searchParams.set('hour', '14');
      u.searchParams.set('nohud', '1');
      if (o.layout) u.searchParams.set('layout', o.layout); // [INT M1.5]
      const sess = await openPage(browser, u.toString(), { size: o.size, wait: 1500 });
      if (sess.gpu.software) { console.error('perf: software GL — refusing to measure'); exit = 2; break; }
      const layout = await sess.page.evaluate(() => window.__hq?.ctx?.layout?.id ?? 'proto');
      const poses = o.poses ?? (layout === 'hq' ? ['spawn', 'pitOverview', 'street'] : ['proto', 'protoDesks', 'protoCorner']);
      for (const pose of poses) {
        await applyPose(sess.page, pose);
        await sess.page.waitForTimeout(500);
        // Runs that disagree by > 20% of the median: someone else's GPU load came and went mid-measurement. Re-measure
        // (up to 2 more times) and keep the tightest set.
        const spread = (xs: number[]) => (Math.max(...xs) - Math.min(...xs)) / (median(xs) || 1);
        const measureRuns = async () => {
          const cur: number[] = [];
          for (let r = 0; r < o.runs; r++) cur.push((await measureFps(sess.page, o.ms)).fps);
          return cur;
        };
        let runs = await measureRuns();
        for (let attempt = 1; attempt < 3 && spread(runs) > 0.2; attempt++) {
          console.warn(`perf: ${scenario}@${pose} runs spread ${(spread(runs) * 100).toFixed(0)}% — re-measuring`);
          await sess.page.waitForTimeout(3000);
          const cur = await measureRuns();
          if (spread(cur) < spread(runs)) runs = cur;
        }
        const stats = await sess.page.evaluate(() => window.__hq.stats());
        const row: PerfRow = { key: `${scenario}@${pose}`, scenario, pose, layout, fps: +median(runs).toFixed(1), runs: runs.map((x) => +x.toFixed(1)), drawCalls: stats.drawCalls, triangles: stats.triangles, trianglesSplit: stats.trianglesSplit ?? null, programs: stats.programs, overBudget: stats.overBudget ?? [], frameErrors: stats.frameErrors ?? 0, actors: stats.actors, gpuBusyBefore: busy, ...(contended ? { contended: true } : {}) };
        if (spread(runs) > 0.2) row.noisy = true;
        // Steady contention doesn't spread the runs (they're all low): another GPU client alive right after is a flag too.
        const others = otherGpuClients();
        if (others) { row.contended = true; row.otherGpuClients = others; }
        rows.push(row);
        if (!o.json) console.log(`${row.key.padEnd(28)} ${String(row.fps).padStart(7)} fps  (runs ${row.runs.join(', ')})  draws ${fmtDraws(row.drawCalls)}  tris ${row.triangles}  progs ${fmtProgs(row.programs)}  actors ${row.actors}${row.overBudget.length ? `  [OVER §5.3: ${row.overBudget.join(',')}]` : ''}${row.frameErrors ? `  [FRAME ERRORS ${row.frameErrors}]` : ''}${row.contended ? `  [CONTENDED: GPU ${busy}% busy before, ${row.otherGpuClients ?? 0} other GPU client(s)]` : ''}${row.noisy ? '  [NOISY: runs spread > 20%]' : ''}`);
      }
      const e = sess.errors();
      if (e.pageErrors) { console.error(sess.logs.join('\n')); exit = 2; }
      await sess.page.close();
    } finally {
      if (stack) await stack.close();
    }
  }
} finally {
  await browser.close();
}

const gpu = 'uncapped';
let baseline: Baseline | null = null;
try {
  const parsed: unknown = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  if (isRecord(parsed)) baseline = { reason: typeof parsed.reason === 'string' ? parsed.reason : undefined, rows: Array.isArray(parsed.rows) ? parsed.rows.filter(isBaselineRow) : undefined };
} catch { /* none */ }
const regressions: PerfRow[] = [];
const missing: string[] = [];
if (o.compare && !o.write && !o.url) { // an ad-hoc --url run has no baseline rows
  if (!baseline) missing.push('(perf-baseline.json)');
  else for (const r of rows) {
    const b = baseline.rows?.find((x) => x.key === r.key);
    if (!b) { missing.push(r.key); continue; }
    r.baseline = b.fps;
    r.delta = +(((r.fps - b.fps) / b.fps) * 100).toFixed(1);
    if (r.delta < -15) regressions.push(r);
  }
}
// M1 acceptance: every `mixed` pose on the proto room ≥ 200 fps.
const m1Rows = rows.filter((r) => r.scenario === 'mixed' && r.layout === 'proto');
const m1: M1 | null = m1Rows.length ? { floor: M1_FLOOR, minFps: Math.min(...m1Rows.map((r) => r.fps)), actors: Math.max(...m1Rows.map((r) => r.actors ?? 0)) } : null;
if (m1) m1.pass = m1.minFps >= M1_FLOOR;
if (m1) m1.contended = m1Rows.some((r) => r.contended || r.noisy);
const contendedRows = rows.filter((r) => r.contended || r.noisy).map((r) => r.key);
const SUSPECT = contendedRows.length ? ' (SUSPECT: measured on a contended GPU, re-run when quiet)' : '';

if (o.json) console.log(JSON.stringify({ rows, regressions: regressions.map((r) => r.key), missing, m1, contended: contendedRows }));
else {
  for (const r of rows) if (r.baseline) console.log(`${r.key.padEnd(28)} vs baseline ${r.baseline}: ${(r.delta ?? 0) > 0 ? '+' : ''}${r.delta}%${r.contended || r.noisy ? ' (contended)' : ''}`);
  if (m1) console.log(`M1 (mixed, ${m1.actors} actors, proto): min ${m1.minFps} fps vs floor ${M1_FLOOR} → ${m1.pass ? 'PASS' : 'FAIL'}${m1.contended ? SUSPECT : ''}`);
}
if (o.write && contendedRows.length && !o.forceBusy) {
  console.error(`perf: NOT writing the baseline: contended / noisy GPU for ${contendedRows.join(', ')} (re-run when quiet, or --force-busy)`);
  exit = exit || 6;
} else if (o.write) {
  if (!o.reason) console.warn('perf: --write-baseline without --reason (say why the baseline moved)');
  // [INT M1.5] merge by key: re-baselining the hq rows must not drop the proto (M1 floor) rows, and vice versa
  const keep = (baseline?.rows ?? []).filter((b) => !rows.some((r) => r.key === b.key));
  const merged = [...keep, ...rows.map(({ baseline: _b, delta: _d, ...r }) => r)];
  const reason = baseline?.reason && keep.length ? `${o.reason ?? ''} || earlier rows: ${baseline.reason}` : o.reason;
  fs.writeFileSync(BASELINE, JSON.stringify({ at: new Date().toISOString(), reason, mode: gpu, size: o.size, quality: o.quality, runs: o.runs, ms: o.ms, rows: merged }, null, 2) + '\n');
  console.log(`wrote ${BASELINE}`);
}
// [CORE m2 r1] a frame callback that threw is a failure regardless of fps (carryover: 'review/perf fail when > 0')
const threw = rows.filter((r) => r.frameErrors > 0);
if (threw.length) { console.error(`perf: frame errors: ${threw.map((r) => `${r.key} ${r.frameErrors}`).join(', ')}`); exit = exit || 7; }
const over = rows.filter((r) => r.overBudget?.length);
if (over.length) console.warn(`perf: over the §5.3 caps: ${over.map((r) => `${r.key} [${r.overBudget.join(',')}]`).join(', ')} (draw/program caps report only; triangle caps fail)`);
// [RND fix r2, cross-owner CORE] §5.3 triangle caps (drawSplit TRI_BUDGET: main-pass env / chars / stat split + total)
// are a gate, not a report: a triangle regression fails the run (exit 8). A page without the split fails too.
const triOver = rows.filter((r) => r.overBudget?.some((k) => /^triangles/.test(k)));
const noSplit = rows.filter((r) => !r.trianglesSplit);
const fmtTris = (t: TriSplit | null) => (t ? `main ${t.main} = env ${t.env} + chars ${t.chars} + stat ${t.stat}` : 'no split');
if (!o.json) for (const r of rows) if (r.trianglesSplit) console.log(`${r.key.padEnd(28)} tris ${fmtTris(r.trianglesSplit)} (shadow ${r.trianglesSplit.shadow}, prepass ${r.trianglesSplit.prepass})`);
if (triOver.length) { console.error(`perf: over the §5.3 triangle caps: ${triOver.map((r) => `${r.key} [${r.overBudget.filter((k) => /^triangles/.test(k)).join(',')}] ${fmtTris(r.trianglesSplit)}`).join(', ')}`); exit = exit || 8; }
if (noSplit.length) { console.error(`perf: no triangle split (__hq.stats().trianglesSplit) for ${noSplit.map((r) => r.key).join(', ')}`); exit = exit || 8; }
if (missing.length) { console.error(`perf: no baseline for ${missing.join(', ')} (run with --write-baseline and commit perf-baseline.json)`); exit = exit || 5; }
if (m1 && !m1.pass) { console.error(`perf: M1 floor: mixed@proto min ${m1.minFps} fps < ${M1_FLOOR}${m1.contended ? SUSPECT : ''}`); exit = exit || 4; }
if (regressions.length) { console.error(`perf: > 15% regression: ${regressions.map((r) => `${r.key} ${r.delta}%${r.contended || r.noisy ? ' (contended)' : ''}`).join(', ')}${regressions.some((r) => r.contended || r.noisy) ? SUSPECT : ''}`); exit = exit || 3; }
process.exit(exit);
