#!/usr/bin/env node
// Review shots (DESIGN §9.2, §11): every canonical pose of the current layout + focus hero shots at 1600×900 on
// medium, hour 14, scenario allStates; the radiometry set (hq: spawn/pitOverview/eBayGlass/mezzToPit/street/cafe) at
// hours 13/18/22, each with lumaStats/surfaceStats/hueGapCheck/greyCheck/edgeCheck; the §9.1 checks; sheets. Writes
// <outDir>/*.png and <outDir>/review.json. Exit non-zero on a page error, software GL, or any check with pass:false.
//
// usage: node scripts/review-shots.ts <outDir> [--url http://host:port/?t=TOKEN] [--scenario allStates] [--size 1600x900]
//                                        [--only name,name] [--no-sheets] [--settle ms] [--gate m15|m175]
//   Without --url it starts its own stack (demo backend + vite) on free ports (or `--ports backend,vite`) with a temp config dir.
// Hero shots (focus_*): the subject is held until it has arrived and stopped (status:blocked: mid "hey!" wave), then the
// clock is frozen and focus() re-run on that actor id, so framing and screenshot see the same scene; a `heroFocus`
// check records {id, side, clear, facing, desk, slot, miss, intruders, settled, waitedMs, tries} and fails when not
// clear+settled, or when the face turns less than HERO_MIN_FACING toward the lens (status:working: ≥ 0.7, framed over
// the monitor of a desk sitter — see __hq.focus desk mode). Settled matches (seated at a desk first) are tried first,
// and the camera waits parked out of the way (`plan`) so it can't block a walker's route.
// Check results: owners' __hq checks return objects; `pass:false` fails the run, `null` = not implemented yet
// ("pending", listed but not failing).
// --gate: which milestone's gates are enforced. The radiometry checks (lumaStats, surfaceStats) are M1.75 art gates
// (§11: hero zones dressed with the prop kit + probe pixels); on the greybox they are recorded with status `pending`
// (result kept, `gate:'m175'`) so real regressions aren't hidden in a red-by-construction run. Default: m175 once the
// page reports a dressed world (`__hq.ctx.worldArt !== 'greybox'`), else m15.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startDevStack, freePort } from './dev.ts';
import { launchBrowser, openPage, applyPose } from './shoot.ts';
import type { GpuInfo } from './shoot.ts';
import type { DevStack } from './dev.ts';
import type { HqFocus, HqStats, PageWindow } from './pageTypes.ts';
import type { Browser, Page } from 'playwright-core';
import { POSES, posesFor } from '../renderer/src/debug/poses.ts';
import { errMessage, isRecord } from '../shared/guards.ts';

declare const window: PageWindow;

const argv = process.argv.slice(2);
if (!argv.length || argv[0] === '-h' || argv[0] === '--help') {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
  process.exit(argv.length ? 0 : 1);
}
const outDir = path.resolve(argv[0]);
interface ReviewOpts {
  url: string | null;
  ports?: number[];
  scenario: string;
  size: [number, number];
  only: string[] | null;
  sheets: boolean;
  settle: number;
  gate: string | null;
}
const o: ReviewOpts = { url: null, scenario: 'allStates', size: [1600, 900], only: null, sheets: true, settle: 900, gate: null };
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--url') o.url = argv[++i];
  else if (a === '--ports') o.ports = argv[++i].split(',').map(Number);
  else if (a === '--scenario') o.scenario = argv[++i];
  else if (a === '--size') { const [w, h] = argv[++i].split('x').map(Number); o.size = [w, h]; }
  else if (a === '--only') o.only = argv[++i].split(',');
  else if (a === '--no-sheets') o.sheets = false;
  else if (a === '--settle') o.settle = +argv[++i];
  else if (a === '--gate') o.gate = argv[++i];
  else { console.error(`unknown arg ${a}`); process.exit(1); }
}
fs.mkdirSync(outDir, { recursive: true });

const HERO = ['status:working', 'status:blocked', 'status:done', 'status:idle', 'kind:shell', 'cls:task'];
/** Hero queries that should be caught mid-gesture (brain intent.activity), not just standing at their slot. */
const HERO_ACTIVITY: Record<string, string> = { 'status:blocked': 'waveBlocked' };
/** Hero queries that must show the face nearly square on (cos of face normal vs lens; art checklist shot 1). */
const HERO_MIN_FACING: Record<string, number> = { 'status:working': 0.7 };
const RADIOMETRY_HOURS = [13, 18, 22];
/**
 * hq radiometry set, shot at every RADIOMETRY_HOURS hour with lumaStats + surfaceStats + edgeCheck + hueGapCheck +
 * greyCheck. spawn/pitOverview/eBayGlass/mezzToPit = the M1.75 gate (DESIGN §10 M1.75 row); street/cafe carry the
 * §5.5 hue-gap (and street the greyscale) rules.
 */
const HQ_RADIO_POSES = ['spawn', 'pitOverview', 'eBayGlass', 'mezzToPit', 'street', 'cafe'];
/** Poses where each rule is specified (§5.5 lists ∪ the M1.75 gate); elsewhere the result is advisory. */
const HUEGAP_POSES = ['spawn', 'pitOverview', 'eBayGlass', 'mezzToPit', 'lobbyDesk', 'street', 'cafe'];
const GREY_POSES = ['spawn', 'pitOverview', 'eBayGlass', 'mezzToPit', 'street'];
/** §5.5 hue-gap poses outside the radiometry set: checked once, at the hour-14 pose pass. */
const HUEGAP_H14_POSES = HUEGAP_POSES.filter((n) => !HQ_RADIO_POSES.includes(n));
const withParams = (url: string, extra: Record<string, string | number | null>) => {
  const u = new URL(url);
  for (const [k, v] of Object.entries(extra)) if (v === null) u.searchParams.delete(k); else u.searchParams.set(k, String(v));
  return u.toString();
};

/** Enforced milestone gates (see --gate). */
let GATES = ['m15'];

type CheckStatus = 'pending' | 'error' | 'fail' | 'pass' | 'info';
interface CheckRecord { shot: string; name: string; status: CheckStatus; gate?: string; advisory?: boolean; result: unknown }
/** A screenshot; `applied` is what the pose / focus step returned (null = not applied). */
interface Shot<T = unknown> { name: string; file: string; applied: T; stats: HqStats | null }
type ShotRecord = Shot | { name: string; file: string; greyOf: string } | { name: string; file: string; params: Record<string, string | number> };
/** heroFocus's result: focus() plus how the wait went. */
type HeroResult = HqFocus & { settled: boolean; waitedMs: number; tries: number };
interface Review {
  at: string;
  scenario: string;
  size: [number, number];
  gpu: GpuInfo | null;
  layout: string | null;
  worldArt: string | null;
  gate: string | null;
  shots: ShotRecord[];
  checks: CheckRecord[];
  errors: string[];
  summary: Record<string, number> | null;
  frameErrors?: number;
}
const review: Review = { at: new Date().toISOString(), scenario: o.scenario, size: o.size, gpu: null, layout: null, worldArt: null, gate: null, shots: [], checks: [], errors: [], summary: null };
let stack: DevStack | null = null;
let browser: Browser | null = null;
let exit = 0;

/**
 * Record one __hq check call. `gate`: the milestone the check belongs to; not enforced yet → `pending` (result kept).
 * `advisory`: the rule isn't specified at this pose (DESIGN) → a pass/fail is recorded as `info` (+ `advisory:true`).
 */
async function check(page: Page, shot: string, name: string, expr: string, gate: string | null = null, { advisory = false } = {}) {
  const r: unknown = await page.evaluate(expr).catch((e) => ({ error: errMessage(e) }));
  const rec = isRecord(r) ? r : null;
  let status: CheckStatus = r === null || r === undefined ? 'pending' : rec?.error ? 'error' : rec?.pass === false ? 'fail' : rec?.pass === true ? 'pass' : 'info';
  if (gate && !GATES.includes(gate) && status !== 'info') status = 'pending';
  if (advisory && (status === 'pass' || status === 'fail')) status = 'info';
  review.checks.push({ shot, name, status, ...(gate ? { gate } : {}), ...(advisory ? { advisory } : {}), result: r ?? null });
  return r;
}

/**
 * Hero framing that holds still for the shot. [CORE fix r2] While waiting, the camera is parked at the `plan` pose
 * (high above the roof, out of everyone's way): framing a walker first put the lens 1.5 m in its path, and a walker
 * that routes around the player could then stall at a stair head forever (focus_cls:task, review r2). Wait (animation
 * running) until *some* actor matching the query has `arrived` at its slot and stopped — for `status:blocked` until
 * it is doing its "hey!" wave — preferring desk sitters (`__hq.match` hero order); then freeze the animation clock
 * and frame that id, so nobody moves between framing and the screenshot. A spot that isn't `clear` (occluder,
 * foreground intruder) is retried after letting the room move on a little. The caller unfreezes after the shot.
 * Returns focus()'s result + {settled, waitedMs, tries}.
 */
async function heroFocus(page: Page, q: string, { timeoutMs = 60000, tries = 12 } = {}): Promise<HeroResult | null> {
  const any = await page.evaluate((q) => { window.__hq.freeze(false); return window.__hq.match(q).length; }, q);
  if (!any) return null;
  const want = HERO_ACTIVITY[q] ?? null;
  const t0 = Date.now();
  let last: HeroResult | null = null;
  for (let i = 0; i < tries; i++) {
    await page.evaluate(() => window.__hq.pose('plan'));
    const left = () => Math.max(500, timeoutMs - (Date.now() - t0));
    const id = await page.waitForFunction(({ q, want }) => {
      const m = window.__hq.match(q).find((x) => x.settled && (!want || x.activity === want));
      return m ? m.id : false;
    }, { q, want }, { timeout: left(), polling: 100 }).then((h) => h.jsonValue(), () => null);
    if (id && want) await page.waitForTimeout(450); // into the gesture (arm up), not its first frame
    // Freeze, then frame: positions can't change between the occlusion test and the screenshot. focus(q) takes the
    // best clear spot among the settled matches; a gesture query frames the id caught mid-gesture. No settled match in
    // time → frame the best walker anyway (reported as a fail).
    const r = await page.evaluate(({ q }) => { window.__hq.freeze(true); return window.__hq.focus(q); }, { q: want && id ? id : q });
    const settled = !!r && (await page.evaluate((rid) => window.__hq.match(rid)[0]?.settled ?? false, r.id));
    last = r && { ...r, settled, waitedMs: Date.now() - t0, tries: i + 1 };
    if (!last || (last.settled && last.clear) || i === tries - 1 || Date.now() - t0 > timeoutMs) return last;
    await page.evaluate(() => window.__hq.freeze(false));
    await page.waitForTimeout(1500); // let the room shuffle (walkers pass, the subject finishes its move)
  }
  return last;
}

try {
  if (!o.url) {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-review-'));
    stack = await startDevStack({ scenario: o.scenario, hmr: false, port: o.ports?.[0] ?? await freePort(), vitePort: o.ports?.[1] ?? await freePort(), configDir, quiet: true });
    o.url = stack.url;
  }
  browser = await launchBrowser({});
  const base = withParams(o.url, { quality: 'medium', hour: 14 });
  const sess = await openPage(browser, base, { size: o.size, wait: 1200 });
  const { page } = sess;
  review.gpu = sess.gpu;
  if (sess.gpu.software) { review.errors.push('software GL'); exit = 2; }
  review.layout = await page.evaluate(() => window.__hq?.ctx?.layout?.id ?? null);
  review.worldArt = await page.evaluate(() => window.__hq?.ctx?.worldArt ?? null);
  review.gate = o.gate ?? (review.worldArt && review.worldArt !== 'greybox' ? 'm175' : 'm15');
  GATES = review.gate === 'm175' ? ['m15', 'm175'] : ['m15'];

  const names = posesFor(review.layout ?? 'proto').filter((n) => !o.only || o.only.includes(n));
  const shoot = async <T>(name: string, fn: () => Promise<T>) => {
    const file = path.join(outDir, `${name.replace(/[^\w.-]+/g, '_')}.png`);
    const applied = await fn();
    await page.waitForTimeout(o.settle);
    const stats = await page.evaluate(() => window.__hq?.stats?.() ?? null);
    await page.screenshot({ path: file });
    const shot: Shot<T> = { name, file: path.basename(file), applied, stats };
    review.shots.push(shot);
    const dc = stats?.drawCalls, pr = stats?.programs; // §5.3 split (core/drawSplit.ts)
    console.log(`shot ${shot.file} fps=${stats?.fps} draws=${dc?.total ?? dc} (main ${dc?.main} shadow ${dc?.shadow} portrait ${dc?.portrait} post ${dc?.post}) progs scene ${pr?.scene} post ${pr?.post}${stats?.overBudget?.length ? ` OVER §5.3: ${stats.overBudget.join(',')}` : ''} ${applied === null ? '(NOT APPLIED)' : ''}`);
    return shot;
  };

  await page.evaluate(() => { window.__hq.setHour(14); });
  for (const name of names) {
    await shoot(name, () => applyPose(page, name));
    await check(page, name, 'frameCheck', '__hq.frameCheck()');
    await check(page, name, 'edgeCheck', '__hq.edgeCheck()');
    await check(page, name, 'placardCheck', '__hq.placardCheck()');
    if (review.layout === 'hq' && HUEGAP_H14_POSES.includes(name)) await check(page, name, 'hueGapCheck', '__hq.hueGapCheck()', 'm175');
  }
  for (const q of HERO) {
    if (o.only && !o.only.includes(q)) continue;
    const shot = await shoot(`focus_${q}`, () => heroFocus(page, q));
    await page.evaluate(() => window.__hq.freeze(false));
    const r = shot.applied;
    const minFacing = HERO_MIN_FACING[q] ?? null;
    const ok = r?.clear && r?.settled && (minFacing === null || (r.facing ?? -1) >= minFacing);
    review.checks.push({ shot: shot.name, name: 'heroFocus', status: ok ? 'pass' : 'fail', result: r && { ...r, minFacing } });
  }
  // [UI fix r1, cross-owner CORE] M3.5 walk-up: every settled working desk worker, walked up to, shows its face (live
  // facing > 0) and its own screen (facing the lens, not hidden, 'live'); desks the pod leaves no such spot at are
  // listed (tier 1 = face only). UI's __hq.walkUpCheck (ui/index.ts) moves the camera; the next shot re-poses it.
  if (!o.only || o.only.includes('walkUp')) await check(page, 'walkUp', 'walkUpCheck', '__hq.walkUpCheck()');
  // Radiometry + the §5.1/§5.5 image rules at every pose × hour of the layout's radiometry set (hq: HQ_RADIO_POSES;
  // proto: proto), so the M1.75 gate (13/18/22) is machine-checked per hour, not only at hour 14. Greyscale poses also
  // get a luminance-only PNG (`<pose>_h<h>_grey.png`, §5.5) for the reviewer's eye.
  const hq = review.layout === 'hq';
  const radioPoses = hq ? HQ_RADIO_POSES : ['proto'];
  for (const name of radioPoses.filter((n) => Object.hasOwn(POSES, n) && (!o.only || o.only.includes(n)))) {
    for (const h of RADIOMETRY_HOURS) {
      const sn = `${name}_h${h}`;
      await shoot(sn, async () => { await page.evaluate((h) => window.__hq.setHour(h), h); return applyPose(page, name); });
      await check(page, sn, 'lumaStats', '__hq.lumaStats({emissive:false})', 'm175');
      await check(page, sn, 'surfaceStats', '__hq.surfaceStats()', 'm175');
      await check(page, sn, 'hueGapCheck', '__hq.hueGapCheck()', 'm175', { advisory: hq && !HUEGAP_POSES.includes(name) });
      await check(page, sn, 'greyCheck', '__hq.greyCheck()', 'm175', { advisory: !hq || !GREY_POSES.includes(name) });
      if (hq && GREY_POSES.includes(name)) {
        const file = path.join(outDir, `${sn}_grey.png`);
        await page.evaluate(() => { document.documentElement.style.filter = 'grayscale(1)'; });
        await page.screenshot({ path: file });
        await page.evaluate(() => { document.documentElement.style.filter = ''; });
        review.shots.push({ name: `${sn}_grey`, file: path.basename(file), greyOf: sn });
      }
      // last: edgeCheck nudges the camera 5 cm and restores it
      await check(page, sn, 'edgeCheck', '__hq.edgeCheck()', 'm175');
    }
  }
  await page.evaluate(() => window.__hq.setHour(14));
  // frames whose callback threw (loop.ts counts them; each distinct error is logged once) fail the review
  review.frameErrors = await page.evaluate(() => window.__hq.stats().frameErrors ?? 0);
  if (review.frameErrors > 0) { review.errors.push(`[review] ${review.frameErrors} frame(s) threw (__hq.stats().frameErrors)`); exit = exit || 2; }
  review.errors.push(...sess.logs);
  const errs = sess.errors();
  if (errs.pageErrors || errs.consoleErrors) exit = exit || 2;
  await page.close();

  // Separate loads: silhouette + sheets.
  const extraLoads: [string, Record<string, string | number>, [string, string][]][] = [['silhouette', { silhouette: 1, pose: review.layout === 'hq' ? 'spawn' : 'proto' }, []]];
  if (o.sheets) {
    extraLoads.push(['sheet_hero', { sheet: 'hero' }, [['clayCheck', '__hq.clayCheck()']]]);
    extraLoads.push(['sheet_props', { sheet: 'props' }, []]);
  }
  for (const [name, params, checks] of extraLoads) {
    const s = await openPage(browser, withParams(base, params), { size: o.size, wait: 1200 });
    const file = path.join(outDir, `${name}.png`);
    await s.page.screenshot({ path: file });
    review.shots.push({ name, file: path.basename(file), params });
    for (const [cn, expr] of checks) await check(s.page, name, cn, expr);
    review.errors.push(...s.logs);
    const e = s.errors();
    if (e.pageErrors || e.consoleErrors) exit = exit || 2;
    await s.page.close();
    console.log(`shot ${name}.png`);
  }
} catch (e) {
  review.errors.push(`[review] ${e instanceof Error ? (e.stack || e.message) : String(e)}`);
  exit = 1;
} finally {
  if (browser) await browser.close();
  if (stack) await stack.close();
}

const count = (s: CheckStatus) => review.checks.filter((c) => c.status === s).length;
review.summary = { shots: review.shots.length, pass: count('pass'), fail: count('fail'), error: count('error'), pending: count('pending'), info: count('info') };
if (review.summary.fail || review.summary.error) exit = exit || 3;
fs.writeFileSync(path.join(outDir, 'review.json'), JSON.stringify(review, null, 2));
console.log(`review.json (gate ${review.gate}): ${JSON.stringify(review.summary)}${review.errors.length ? `\nerrors:\n  ${review.errors.join('\n  ')}` : ''}`);
process.exit(exit);
