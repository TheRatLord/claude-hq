#!/usr/bin/env node
/**
 * Screenshots of the valley or the gallery, for agents and humans. Starts the demo dev server, drives headless
 * Chromium on the real GPU (Vulkan ANGLE), writes PNGs, prints console errors and perf.
 *
 *   npm run shoot -- --shot name=hub,pose=hub,hour=10
 *   npm run shoot -- --shot name=night,pose=square,hour=22,weather=rain --shot name=mill,pose=windmill
 *   npm run shoot -- --shot name=f,goto=d1:p2,wait=4000          (stand in front of a farmer / plot / structure id)
 *   npm run shoot -- --shot 'name=top,cam=0;80;60;0;-0.9'          (free camera x;y;z;yaw;pitch; quote it)
 *   npm run shoot -- --shot name=m,pose=hub,panel=map               (open a HUD panel; hud=0 hides the HUD; term=ID opens a terminal)
 *   npm run shoot -- --shot name=mill,gallery=windmill,param=0.9   (gallery asset; variant=, season=, night=, turn=)
 *   npm run shoot -- --shot name=all,grid=structure                (gallery grid of a group, or 'all')
 *   npm run shoot -- --shot name=x,pose=hub,eval=__valley.debug('labels',true)
 *
 * Options: --url URL (existing backend + its built dist; default: a fresh demo dev server)  --out DIR (default scratch/shots)  --size 1600x900  --scenario mixed  --seed 1  --demo 12  --wait 2500
 *          --timescale K  --video (also record a short webm per shot, wait = its length)
 * Shot keys: name pose hour weather season quality goto cam wait eval hint hud panel term gallery variant grid night param turn time
 * Quote specs containing ';' (cam=…) for the shell: --shot 'name=top,cam=0;120;100;0;-0.9'
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import type { Page } from '@playwright/test';
import { startDev, REPO } from './devserver.ts';

export const GPU_ARGS = ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu', '--enable-unsafe-webgpu'];

const argv = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const shots = argv.flatMap((a, i) => (a === '--shot' ? [argv[i + 1]] : [])).map((spec) => Object.fromEntries(
  spec.split(/,(?=[a-z]+=)/).map((kv) => { const j = kv.indexOf('='); return [kv.slice(0, j), kv.slice(j + 1)]; }),
) as Record<string, string>);
if (!shots.length) shots.push({ name: 'hub', pose: 'hub' });
const out = path.resolve(REPO, opt('--out', 'scratch/shots'));
const [W, H] = opt('--size', '1600x900').split('x').map(Number);
const video = argv.includes('--video');

async function shootValley(page: Page, base: URL, s: Record<string, string>): Promise<void> {
  const u = new URL(base);
  for (const k of ['pose', 'hour', 'weather', 'season', 'quality', 'timescale']) if (s[k]) u.searchParams.set(k, s[k]);
  await page.goto(u.toString());
  await page.waitForFunction(() => (window as unknown as { __valley?: { ready: boolean } }).__valley?.ready === true, null, { timeout: 30_000 });
  if (s.goto) await page.evaluate((id) => (window as unknown as { __valley: { goTo(id: string): void } }).__valley.goTo(id), s.goto);
  if (s.cam) {
    const [x, y, z, yaw, pitch] = s.cam.split(';').map(Number);
    await page.evaluate(([x, y, z, yaw, pitch]) => (window as unknown as { __valley: { cam(...a: number[]): void } }).__valley.cam(x, y, z, yaw, pitch), [x, y, z, yaw, pitch]);
  }
  // the welcome card is for humans; shots skip it unless hint=1. hud=0 hides the whole HUD; panel=map|mailbox|roster|…
  await page.evaluate(([hint, hud, panel, term]) => {
    const h = (window as unknown as { __hud?: { dismissHint(): void; open(id: string): void; openTerminal(id: string): void } }).__hud;
    if (hint !== '1') h?.dismissHint();
    if (hud === '0') { const el = document.getElementById('hud'); if (el) el.style.display = 'none'; }
    if (panel) h?.open(panel);
    if (term) h?.openTerminal(term);
  }, [s.hint ?? '', s.hud ?? '', s.panel ?? '', s.term ?? '']);
  if (s.eval) await page.evaluate(s.eval);
}

async function shootGallery(page: Page, base: URL, s: Record<string, string>): Promise<void> {
  const u = new URL(base);
  u.pathname = '/gallery/';
  if (s.gallery) u.searchParams.set('asset', s.gallery);
  if (s.grid) u.searchParams.set('grid', s.grid);
  for (const k of ['variant', 'season', 'night', 'param', 'turn', 'time']) if (s[k]) u.searchParams.set(k, s[k]);
  await page.goto(u.toString());
  await page.waitForFunction(() => (window as unknown as { __gallery?: { ready: boolean } }).__gallery?.ready === true, null, { timeout: 30_000 });
  if (s.eval) await page.evaluate(s.eval);
}

async function main(): Promise<void> {
  fs.mkdirSync(out, { recursive: true });
  // --url http://127.0.0.1:PORT/?t=TOKEN shoots an already-running backend (e.g. live herdr) instead of a demo
  const target = opt('--url', '');
  const dev = target ? { url: new URL(target), close: async () => {} } : await startDev({
    port: 0, quiet: true, scenario: opt('--scenario', 'mixed'), seed: Number(opt('--seed', '1')), population: Number(opt('--demo', '12')),
    ...(argv.includes('--timescale') ? { timescale: Number(opt('--timescale', '1')) } : {}),
  });
  const browser = await chromium.launch({ headless: true, args: GPU_ARGS });
  try {
    for (const s of shots) {
      const name = s.name ?? 'shot';
      const context = await browser.newContext({ viewport: { width: W, height: H }, ...(video ? { recordVideo: { dir: out, size: { width: W, height: H } } } : {}) });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
      const t0 = Date.now();
      try {
        if (s.gallery || s.grid) await shootGallery(page, dev.url, s);
        else await shootValley(page, dev.url, s);
        await page.waitForTimeout(Number(s.wait ?? opt('--wait', '2500')));
        const file = path.join(out, `${name}.png`);
        await page.screenshot({ path: file });
        const perf = await page.evaluate(() => {
          const v = (window as unknown as { __valley?: { perf(): unknown } }).__valley;
          return v ? v.perf() : null;
        }).catch(() => null);
        const gl = await page.evaluate(() => {
          const c = document.querySelector('canvas');
          const g = c?.getContext('webgl2');
          const e = g?.getExtension('WEBGL_debug_renderer_info');
          return e && g ? String(g.getParameter(e.UNMASKED_RENDERER_WEBGL)) : 'unknown';
        }).catch(() => 'unknown');
        console.log(`✔ ${path.relative(REPO, file)}  (${Date.now() - t0} ms, ${gl.slice(0, 60)})`);
        if (perf) console.log(`  perf ${JSON.stringify(perf)}`);
      } catch (e) {
        console.log(`✘ ${name}: ${e instanceof Error ? e.message : String(e)}`);
        await page.screenshot({ path: path.join(out, `${name}.error.png`) }).catch(() => {});
      }
      for (const e of errors.slice(0, 20)) console.log(`  ${e.slice(0, 400)}`);
      if (errors.length > 20) console.log(`  … ${errors.length - 20} more`);
      await context.close();
    }
  } finally {
    await browser.close();
    await dev.close();
  }
}

void main().catch((e: unknown) => { console.error(e); process.exitCode = 1; });
