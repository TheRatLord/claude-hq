import { test, expect } from './server.ts';

/**
 * The hillside orchard & apiary (scene/orchard, docs/valley/orchard.md): shake a ripe apple tree in autumn with E, the
 * fruit falls, bounces and flies into the basket (and the Collections book); the hives give honey; the press turns
 * three apples into cider; the notebook page turns up; winter trees are bare and the bees stay home; today's picks
 * survive a reload.
 */
interface Tree { i: number; kind: string; phase: string; left: number; x: number; z: number }
interface State { trees: Tree[]; hives: { i: number; ready: boolean }[]; bees: { activity: number; mood: string; out: number }; inAir: number }
type V = {
  ready: boolean;
  orchard(cmd?: string, a?: number): unknown;
  interact(): void;
  focused(): { id: string; verb: string; label: string } | null;
  setSeason(s: string | null): void;
  setHour(h: number | null): void;
  guide(): { pages: { id: string; found: boolean }[] };
  ctx: { services: Map<string, unknown> };
};
type W = { __valley: V };

test.describe.configure({ timeout: 150_000 });

const boot = async (page: import('@playwright/test').Page, origin: string, token: string, q: string) => {
  await page.goto(`${origin}/?t=${token}&quality=low&${q}`);
  await page.waitForFunction(() => (window as unknown as W).__valley?.ready === true, null, { timeout: 60_000 });
};

test('orchard: shake an apple tree in autumn, the fruit lands in the basket; honey, cider, winter, persistence', async ({ page, demoServer }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await boot(page, demoServer.origin, demoServer.token, 'pose=orchard&hour=11&weather=clear&season=autumn');
  const orchard = <T>(cmd?: string, a?: number) => page.evaluate(([c, n]) => (window as unknown as W).__valley.orchard(c as string | undefined, n as number | undefined), [cmd, a] as const) as Promise<T>;
  const basket = (id: string) => page.evaluate((i) => ((window as unknown as W).__valley.ctx.services.get('wallet') as { data(): { basket: Record<string, number> } }).data().basket[i] ?? 0, id);
  const found = (id: string) => page.evaluate((i) => ((window as unknown as W).__valley.ctx.services.get('collection') as { data(): { found: Record<string, { n: number }> } }).data().found[i]?.n ?? 0, id);

  const st = await orchard<State>();
  expect(st.trees.length).toBe(18);
  const apples = st.trees.filter((t) => t.kind === 'apple');
  expect(apples.every((t) => t.phase === 'ripe' && t.left >= 3)).toBe(true);
  expect(st.trees.filter((t) => t.kind === 'cherry').every((t) => t.phase === 'turning' && t.left === 0)).toBe(true);
  await page.screenshot({ path: info.outputPath('orchard-gate.png') });

  // stand under an apple tree, look at it: the crosshair finds it; E (interact) shakes it
  const tree = apples[apples.length - 1];
  await orchard('tree', tree.i);
  await page.waitForTimeout(400);
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__valley.focused()?.id ?? ''), { timeout: 5_000 }).toBe(`orchard:tree:${tree.i}`);
  expect((await page.evaluate(() => (window as unknown as W).__valley.focused()))!.verb).toBe('Shake');
  const before = await basket('apple');
  await page.evaluate(() => (window as unknown as W).__valley.interact());
  // the fruit is in the air, then in the basket and the book
  await expect.poll(() => orchard<State>().then((s) => s.inAir), { timeout: 2_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  await page.screenshot({ path: info.outputPath('orchard-shake.png') });
  await expect.poll(() => basket('apple'), { timeout: 8_000 }).toBe(before + Math.min(3, tree.left));
  await expect.poll(() => orchard<State>().then((s) => s.inAir), { timeout: 5_000 }).toBe(0);
  expect(await found('apple')).toBeGreaterThanOrEqual(Math.min(3, tree.left));
  const after = (await orchard<State>()).trees[tree.i].left;
  expect(after).toBe(Math.max(0, tree.left - 3));

  // shake two more trees: enough apples to press a bottle of cider
  for (const t of apples.slice(0, 2)) await orchard('shake', t.i);
  await expect.poll(() => orchard<State>().then((s) => s.inAir), { timeout: 8_000 }).toBe(0);
  expect(await basket('apple')).toBeGreaterThanOrEqual(3);
  const applesBefore = await basket('apple');
  expect(await orchard('press')).toBe(true);
  expect(await basket('cider')).toBe(1);
  expect(await basket('apple')).toBe(applesBefore - 3);

  // honey from a hive (once; then a few days' wait)
  expect(await orchard('honey', 0)).toBe(1);
  expect(await basket('honey')).toBe(1);
  expect(await orchard('honey', 0)).toBe(0);
  // the bees are out on a fine autumn morning near the hives
  await page.waitForTimeout(1500);
  const bees = (await orchard<State>()).bees;
  expect(bees.mood).toBe('out');
  expect(bees.activity).toBeGreaterThan(0.3);
  await page.screenshot({ path: info.outputPath('orchard-hives.png') });

  // Fern's notebook has the page now
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__valley.guide().pages.find((p) => p.id === 'orchard')?.found ?? false), { timeout: 5_000 }).toBe(true);

  // winter: bare trees, nothing to shake down, the bees stay in
  await page.evaluate(() => (window as unknown as W).__valley.setSeason('winter'));
  // the season change lands on a later frame: poll rather than sleep (a busy machine can take a few seconds)
  await expect.poll(() => orchard<State>().then((s) => s.trees.every((t) => t.phase === 'bare' && t.left === 0)), { timeout: 10_000 }).toBe(true);
  const w = await orchard<State>();
  expect(w.bees.mood).toBe('wintering');
  expect(w.bees.activity).toBe(0);
  const r = await orchard<{ n: number; phase: string }>('shake', 3);
  expect(r.n).toBe(0);
  expect(r.phase).toBe('bare');
  await page.screenshot({ path: info.outputPath('orchard-winter.png') });

  // today's picks survive a reload
  await boot(page, demoServer.origin, demoServer.token, 'pose=orchard&hour=11&weather=clear&season=autumn');
  expect((await orchard<State>()).trees[tree.i].left).toBe(after);
  expect(errors).toEqual([]);
});
