import { writeFileSync } from 'node:fs';
import { test, expect } from './server.ts';

/**
 * Sound coverage (audio/, docs/valley/audio.md → Coverage): every synthesized sound and bed renders offline without
 * NaNs or clipping; the new places (the grotto, the glasshouse, spring and autumn) mix through the master below the
 * ceiling; a world sound that carries news shows a caption when captions are on; in the grotto the cave bed plays and
 * the music rests.
 */
type M = { peak: number; loud: number; nan: boolean; len: number; centroid: number };
type V = { ready: boolean; ctx: { services: Map<string, unknown> } };
type W = { __valley: V; __hud: { prefs(p?: Record<string, unknown>): Record<string, unknown> } };

test.describe.configure({ timeout: 150_000 });

const NEW = ['rustle', 'thump', 'press', 'train', 'cart', 'brush', 'scope', 'focus', 'shutter'];
const NEW_LOOPS = ['loop:millwheel:1', 'loop:cave:1', 'loop:glasshouse:1', 'loop:leaves:1:autumn'];

test('audio: every sound renders clean, the new places mix under the ceiling, captions, the grotto', async ({ page, demoServer }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${demoServer.origin}/?t=${demoServer.token}&quality=low&pose=hub&hour=11&weather=clear`);
  await page.waitForFunction(() => (window as unknown as W).__valley?.ready === true, null, { timeout: 60_000 });
  const dbg = <T>(fn: string, ...args: unknown[]) => page.evaluate(([f, a]) => {
    const d = ((window as unknown as W).__valley.ctx.services.get('audio') as { _debug: Record<string, (...x: unknown[]) => unknown> })._debug;
    return d[f as string](...(a as unknown[]));
  }, [fn, args] as const) as Promise<T>;

  // every one-shot, critter, voice, footstep and bed (dBFS before the buses): finite, below full scale
  const all = await dbg<Record<string, { peak: number; loud: number; nan: boolean }>>('renderAll', 2);
  for (const [k, m] of Object.entries(all)) {
    expect(m.nan, k).toBe(false);
    expect(m.peak, k).toBeLessThan(-0.5);
  }
  for (const n of NEW) {
    expect(all[n], n).toBeTruthy();
    expect(all[n].loud, `${n} is audible`).toBeGreaterThan(-45);
  }
  const loops: Record<string, M> = {};
  for (const n of NEW_LOOPS) {
    const m = await dbg<M>('render', n, 8);
    loops[n] = m;
    expect(m.nan, n).toBe(false);
    expect(m.peak, n).toBeGreaterThan(0.005);
    expect(m.peak, n).toBeLessThan(0.95);
  }
  // whole moments through the master chain (default sliders): nothing clips, nothing dominates
  const mixes: Record<string, unknown> = {};
  for (const spec of ['grotto', 'glasshouse', 'spring', 'autumn', 'snow', 'river', 'pond']) {
    const r = await dbg<Record<string, { peak: number; loud: number; nan: boolean }>>('mix', spec, 10);
    mixes[spec] = r;
    expect(r.mix.nan, spec).toBe(false);
    expect(r.mix.peak, spec).toBeLessThan(-6);
    expect(r.beds.loud, `${spec} beds are there`).toBeGreaterThan(-60);
  }
  const ref = Object.fromEntries(['alert', 'chime-done', 'ui-click', 'coins', 'creak', 'whistle', 'loop:river:1', 'loop:pond:1', 'loop:bees:1', 'loop:leaves:1'].map((n) => [n, all[n]]));
  writeFileSync(info.outputPath('levels.json'), JSON.stringify({ sfx: Object.fromEntries(NEW.map((n) => [n, all[n]])), ref, loops, mixes }, null, 1));

  // captions for a world sound that carries news (audio/captions.ts → the HUD's caption line), even before unlock
  await page.evaluate(() => (window as unknown as W).__hud.prefs({ captions: true }));
  await page.evaluate(() => ((window as unknown as W).__valley.ctx.services.get('audio') as { play(n: string): void }).play('train'));
  await expect(page.getByTestId('captions')).toContainText(/\[Train whistle\]/, { timeout: 5_000 });
  await page.evaluate(() => ((window as unknown as W).__valley.ctx.services.get('audio') as { play(n: string): void }).play('pop'));
  await expect(page.getByTestId('captions').locator('.cap')).toHaveCount(1);

  // the grotto, live: unlock (a key press is a gesture), step inside: the cave bed builds and the music rests
  await page.keyboard.press('Shift');
  await expect.poll(() => dbg<{ state: string }>('stats').then((s) => s.state), { timeout: 5_000 }).toBe('running');
  await page.evaluate(() => ((window as unknown as W).__valley.ctx.services.get('grotto') as { go(w?: string): boolean }).go('inside'));
  await expect.poll(() => dbg<{ beds: Record<string, number> }>('stats').then((s) => s.beds.cave ?? 0), { timeout: 15_000 }).toBeGreaterThan(0.5);
  const st = await dbg<{ music: { scene: string | null } | null; beds: Record<string, number> }>('stats');
  expect(st.music?.scene ?? null).toBe(null);
  expect(st.beds.birds ?? 0).toBeLessThan(0.2);
  expect(errors).toEqual([]);
});
