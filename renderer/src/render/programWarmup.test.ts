// RND fix r1 (§5.3): every scene program compiles at boot; none lazily mid-session.
// Unit part always runs. GPU part (real Chromium on the 780M, crowd40 stack) runs with HQ_GPU_TEST=1
// (ports: HQ_GPU_TEST_PORTS=backend,vite; default free ports):
//   HQ_GPU_TEST=1 node --test renderer/src/render/programWarmup.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { hqKeyOf, missingVariants, WARM_FRAMES } from './programWarmup.ts';

test('hqKeyOf takes the customProgramCacheKey suffix of a three cache key', () => {
  assert.equal(hqKeyOf('lambert,highp,srgb-linear,false,,8520706,srgb,hq|toonProp|INSTANCED+VCOL'), 'hq|toonProp|INSTANCED+VCOL');
  assert.equal(hqKeyOf('depth,highp,srgb-linear,false,onBeforeCompile() {}'), null);
  assert.equal(hqKeyOf(''), null);
});

test('missingVariants lists factory keys the scene compile did not produce', () => {
  assert.deepEqual(missingVariants(['hq|toonEnv|VCOL'], ['hq|toonEnv|VCOL', 'hq|screen|INSTANCED']), ['hq|screen|INSTANCED']);
  assert.deepEqual(missingVariants(new Set(['a', 'b']), new Set(['a', 'b'])), []);
});

test('the warm-up schedule ends early in boot (before __hq.ready settles)', () => {
  assert.ok(WARM_FRAMES[0] === 1 && (WARM_FRAMES.at(-1) ?? Infinity) <= 180);
});

/** The slice of `window.__hq` (core/debug.ts) the GPU test drives; the page.evaluate bodies below run in the browser. */
interface HqDebug {
  stats(): { programs: { scene: number }; render?: { warmup?: { frozen?: boolean; late?: string[] } } };
  pose(name: string): unknown;
  roster(on: boolean): unknown;
  entities(): { id: string }[];
  openTerminal(id: string): unknown;
  closeTerminal?(): unknown;
}
type HqWindow = Omit<Window, "__hq"> & { __hq: HqDebug };

const GPU = process.env.HQ_GPU_TEST === '1';
test('GPU: programs.scene at boot == after a full pose tour, roster, terminals and crowd40', { skip: !GPU && 'set HQ_GPU_TEST=1', timeout: 240000 }, async () => {
  const { startDevStack, freePort } = await import('../../../scripts/dev.ts');
  const { launchBrowser, openPage } = await import('../../../scripts/shoot.ts');
  const { POSES, posesFor } = await import('../debug/poses.ts');
  const os = await import('node:os');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const [bp, vp] = (process.env.HQ_GPU_TEST_PORTS ?? '').split(',').map(Number);
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-progs-'));
  const stack = await startDevStack({ scenario: 'crowd40', seed: 1, hmr: false, quiet: true, configDir, port: bp || await freePort(), vitePort: vp || await freePort() });
  const browser = await launchBrowser({});
  try {
    const s = await openPage(browser, `${stack.url}&quality=medium`, { size: [1600, 900], wait: 500 });
    const p = s.page;
    const progs = () => p.evaluate(() => { const st = (window as HqWindow).__hq.stats(); return { scene: st.programs.scene, warm: st.render?.warmup }; });
    await p.waitForFunction(() => (window as HqWindow).__hq.stats().render?.warmup?.frozen === true, null, { timeout: 30000 });
    const boot = await progs();
    assert.ok(boot.scene <= 14, `boot scene programs ${boot.scene} within the §5.3 cap`);
    for (const name of posesFor('hq')) {
      if (!(name in POSES)) continue;
      await p.evaluate((n) => (window as HqWindow).__hq.pose(n), name);
      await p.waitForTimeout(500);
    }
    await p.evaluate(() => (window as HqWindow).__hq.roster(true));
    await p.waitForTimeout(2500); // portraits render
    const ids = await p.evaluate(() => (window as HqWindow).__hq.entities().map((e) => e.id));
    for (const id of ids.slice(0, 3)) { await p.evaluate((i) => (window as HqWindow).__hq.openTerminal(i), id); await p.waitForTimeout(800); }
    await p.evaluate(() => (window as HqWindow).__hq.closeTerminal?.());
    await p.evaluate(() => (window as HqWindow).__hq.pose('plan'));
    await p.waitForTimeout(3000); // crowd40 churn: newcomer crates, rallies, ambient cards
    const after = await progs();
    assert.equal(after.scene, boot.scene, `scene programs stable (boot ${boot.scene}, after ${after.scene}; late: ${after.warm?.late?.join(' · ')})`);
    assert.deepEqual(after.warm?.late ?? [], []);
  } finally {
    await browser.close();
    await stack.close();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});
