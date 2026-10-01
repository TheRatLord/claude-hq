#!/usr/bin/env node
/**
 * Placement audit: floating objects, objects sunk into the terrain, interpenetrating objects, dry-land things in
 * the water and solids on road centres, checked in page against the scene the game actually built (BVH per mesh,
 * broad phase over world AABBs, triangle–triangle narrow phase; see renderer/src/farm/dev/placement.ts).
 *
 *   npm run audit:placement                                  allStates + crowd40, current season, top 25 sheets
 *   npm run audit:placement -- --scenario mixed --season all  every season of one scenario
 *   npm run audit:placement -- --top 0                       report only, no contact sheets
 *   npm run audit:placement -- --top 60 --all-sheets         sheets beyond the worst of each class
 *   npm run audit:placement -- --only hub-dressing           items whose key contains this
 *   npm run audit:placement -- --shots allowed               sheets for allowlisted findings too (review them)
 *   npm run audit:placement -- --strict                      exit 1 when anything is not allowlisted
 *
 * Writes scratch/placement/report.json (ranked findings, per-class summary) and one contact sheet PNG per top
 * finding: scratch/placement/NN-check-asset.png (magenta = a, cyan = b, yellow = the problem region; three views).
 * Intended cases live in scripts/placement-allow.json, each with a reason.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import type { Page } from '@playwright/test';
import { startDev, REPO } from './devserver.ts';
import { GPU_ARGS, contactSheet } from './shoot.ts';
import { CHECKS, allowedBy, findingId, sortFindings, summarize } from '../renderer/src/farm/dev/placementCore.ts';
import type { AllowEntry, Box, Finding } from '../renderer/src/farm/dev/placementCore.ts';

const argv = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const out = path.resolve(REPO, opt('--out', 'scratch/placement'));
const scenarios = opt('--scenario', 'allStates,crowd40').split(',');
const seasonArg = opt('--season', '');
const seasons = seasonArg === 'all' ? ['spring', 'summer', 'autumn', 'winter'] : [seasonArg];
const top = Number(opt('--top', '25'));
/** default: one sheet per finding class (worst first); --all-sheets: then the remaining findings by score */
const perClass = !argv.includes('--all-sheets');
const only = opt('--only', '');
const shotAllowed = opt('--shots', '') === 'allowed';
const allowFile = path.resolve(REPO, opt('--allow', 'scripts/placement-allow.json'));
const [W, H] = [960, 600];

interface AuditResult { items: number; pairs: number; ms: number; findings: Finding[]; perSystem: Record<string, number> }
type V = { __valley: { ready: boolean; audit(o?: unknown): Promise<AuditResult>; auditShow(k: string[], f: Box, v: number): Promise<unknown>; auditClear(): Promise<void>; timeScale(k: number): void } };
type Tagged = Finding & { runs: string[] };

const allow: AllowEntry[] = fs.existsSync(allowFile) ? (JSON.parse(fs.readFileSync(allowFile, 'utf8')) as { entries: AllowEntry[] }).entries : [];
for (const e of allow) if (!e.reason?.trim()) throw new Error(`allowlist entry without a reason: ${JSON.stringify(e)}`);

const slug = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);

async function sheetFor(browser: import('@playwright/test').Browser, page: Page, f: Tagged, n: number): Promise<string> {
  const keys = [f.a.key, ...(f.b ? [f.b.key] : [])];
  const shots: { png: string; label: string }[] = [];
  const labels = ['best view', 'other side', 'from above'];
  for (let v = 0; v < 3; v++) {
    await page.evaluate(([k, fo, vv]) => (window as unknown as V).__valley.auditShow(k as string[], fo as Box, vv as number), [keys, f.focus, v] as const);
    await page.waitForTimeout(350);
    shots.push({ png: (await page.screenshot()).toString('base64'), label: labels[v] });
  }
  await page.evaluate(() => (window as unknown as V).__valley.auditClear());
  const name = `${String(n).padStart(2, '0')}-${f.check}-${slug(f.a.asset.split('/').slice(-1)[0] + (f.b ? `-x-${f.b.asset.split('/').slice(-1)[0]}` : ''))}.png`;
  const extra = Object.entries(f.extra).map(([k, v]) => `${k} ${typeof v === 'number' ? +v.toFixed(3) : v}`).join(' · ');
  const title = `#${n} ${f.check}  ${f.value.toFixed(3)} m  (score ${f.score.toFixed(2)}, ${f.runs.join(', ')})${f.allowed ? `  ALLOWED: ${f.allowed}` : ''}\n`
    + `a (magenta): ${f.a.key}\n${f.b ? `b (cyan):    ${f.b.key}\n` : ''}${extra}`;
  const file = path.join(out, name);
  await contactSheet(browser, file, title, shots, W, H, 3);
  return path.relative(REPO, file);
}

async function main(): Promise<void> {
  fs.mkdirSync(out, { recursive: true });
  for (const f of fs.readdirSync(out)) if (/^\d\d-.*\.png$/.test(f)) fs.rmSync(path.join(out, f));
  const browser = await chromium.launch({ headless: true, args: GPU_ARGS });
  const merged = new Map<string, Tagged>();
  const runs: { run: string; items: number; pairs: number; ms: number; findings: number; perSystem: Record<string, number> }[] = [];
  const sheets: string[] = [];
  let shotN = 0;
  const shotClasses = new Set<string>();
  try {
    for (const scenario of scenarios) for (const season of seasons) {
      const run = season ? `${scenario}/${season}` : scenario;
      const dev = await startDev({ port: 0, quiet: true, scenario, seed: 1, population: 12, hmr: false });
      const page = await browser.newPage({ viewport: { width: W, height: H } });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      try {
        const u = new URL(dev.url);
        u.searchParams.set('pose', 'hub'); u.searchParams.set('hour', '11'); u.searchParams.set('weather', 'clear');
        if (season) u.searchParams.set('season', season);
        await page.goto(u.toString());
        await page.waitForFunction(() => (window as unknown as V).__valley?.ready === true, null, { timeout: 60_000 });
        await page.evaluate(() => {
          const h = (window as unknown as { __hud?: { dismissHint(): void } }).__hud;
          h?.dismissHint();
          const el = document.getElementById('hud'); if (el) el.style.display = 'none';
        });
        await page.waitForTimeout(7000); // tilling fences drop in, harvest carts arrive, crops settle
        await page.evaluate(() => (window as unknown as V).__valley.timeScale(0));
        const t0 = Date.now();
        const res = await page.evaluate((o) => (window as unknown as V).__valley.audit(o), only ? { only } : {});
        console.log(`· ${run}: ${res.items} items (${Object.entries(res.perSystem).map(([k, v]) => `${k} ${v}`).join(', ')}), ${res.pairs} candidate pairs, ${res.findings.length} findings in ${res.ms} ms (${Date.now() - t0} ms round trip)`);
        runs.push({ run, items: res.items, pairs: res.pairs, ms: res.ms, findings: res.findings.length, perSystem: res.perSystem });
        const fresh: Tagged[] = [];
        for (const f of res.findings) {
          const id = findingId(f);
          const a = allowedBy(f, allow);
          const prev = merged.get(id);
          if (prev) { if (!prev.runs.includes(run)) prev.runs.push(run); if (f.value > prev.value) Object.assign(prev, f, { runs: prev.runs, id }); continue; }
          const t: Tagged = { ...f, id, runs: [run], ...(a ? { allowed: a.reason } : {}) };
          merged.set(id, t);
          fresh.push(t);
        }
        // contact sheets for this run's worst new findings
        // the worst of each class first (one fix per class), then the rest by score
        const cls = (f: Finding) => `${f.check}:${[f.a.asset, f.b?.asset ?? ''].sort().join('×')}`;
        const cand = sortFindings(fresh.filter((x) => shotAllowed || !x.allowed));
        const firstOf = cand.filter((f) => { const c = cls(f); if (shotClasses.has(c)) return false; shotClasses.add(c); return true; });
        for (const f of [...firstOf, ...(perClass ? [] : cand.filter((x) => !firstOf.includes(x)))]) {
          if (shotN >= top) break;
          sheets.push(await sheetFor(browser, page, f, ++shotN));
        }
      } finally {
        for (const e of errors.slice(0, 10)) console.log(`  pageerror: ${e.slice(0, 300)}`);
        await page.close();
        await dev.close();
      }
    }
  } finally {
    await browser.close();
  }

  const all = sortFindings([...merged.values()]);
  const open = all.filter((f) => !f.allowed);
  const byCheck = Object.fromEntries(CHECKS.map((c) => [c, { total: all.filter((f) => f.check === c).length, open: open.filter((f) => f.check === c).length }]));
  const unusedAllow = allow.filter((e) => !all.some((f) => allowedBy(f, [e])));
  const report = {
    generatedAt: new Date().toISOString(), runs, allowlist: path.relative(REPO, allowFile),
    totals: { findings: all.length, open: open.length, allowed: all.length - open.length, byCheck },
    classes: summarize(all),
    unusedAllow: unusedAllow.map((e) => `${e.check} ${e.a}${e.b ? ` × ${e.b}` : ''}`),
    sheets,
    findings: all.map((f) => ({ ...f, value: +f.value.toFixed(3), score: +f.score.toFixed(3) })),
  };
  const file = path.join(out, 'report.json');
  fs.writeFileSync(file, JSON.stringify(report, null, 1));

  console.log(`\n${all.length} findings: ${open.length} open, ${all.length - open.length} allowlisted`);
  for (const c of CHECKS) if (byCheck[c].total) console.log(`  ${c.padEnd(9)} ${String(byCheck[c].open).padStart(4)} open / ${byCheck[c].total}`);
  console.log('\nclasses (open first):');
  for (const c of report.classes.slice(0, 40)) console.log(`  ${String(c.n - c.allowed).padStart(4)} open ${String(c.allowed).padStart(4)} ok  worst ${c.worst.toFixed(2)} m  ${c.cls}`);
  if (unusedAllow.length) console.log(`\nallowlist entries that matched nothing: ${report.unusedAllow.join('; ')}`);
  console.log(`\n→ ${path.relative(REPO, file)}${sheets.length ? `, ${sheets.length} contact sheets in ${path.relative(REPO, out)}/` : ''}`);
  if (argv.includes('--strict') && open.length) process.exitCode = 1;
}

void main().catch((e: unknown) => { console.error(e); process.exitCode = 1; });
