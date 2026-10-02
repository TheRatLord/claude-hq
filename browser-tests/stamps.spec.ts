import { test, expect } from './server.ts';

/**
 * The stamp book (model/stamps.ts, hud/stamps.ts): stamps are earned from what the services already know (a catch in
 * the Collections book), toast with the inked stamp, pay bits, show on the Almanac's Stamps tab (inked / outline /
 * secret "?"), survive a reload, and the demo valley never inks work stamps.
 */
interface StampRow { id: string; earned: boolean; day: string | null; secret: boolean }
interface StampsDev { earned: number; total: number; trophies: number; stamps: StampRow[] }
type V = {
  ready: boolean;
  stamps(step?: number | 'reset'): StampsDev;
  stamp(id: string): { id: string; count: number; bits: number; trophy: string | null } | null;
  ctx: { services: Map<string, unknown> };
};
type W = { __valley: V };

test.describe.configure({ timeout: 120_000 });

test('stamp book: a catch inks stamps (toast, bits), the Almanac shows the page, it persists; demo never earns work', async ({ page, demoServer }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${demoServer.origin}/?t=${demoServer.token}&quality=low&pose=hub&hour=10&weather=clear`);
  await page.waitForFunction(() => (window as unknown as W).__valley?.ready === true, null, { timeout: 60_000 });

  const book = () => page.evaluate(() => (window as unknown as W).__valley.stamps());
  const earned = async (id: string) => (await book()).stamps.find((s) => s.id === id)?.earned ?? false;
  const coins = () => page.evaluate(() => ((window as unknown as W).__valley.ctx.services.get('wallet') as { coins(): number }).coins());
  const first = await book();
  expect(first.total).toBeGreaterThanOrEqual(38);
  expect(first.stamps.some((s) => s.secret)).toBe(true);
  expect(await earned('first-fish')).toBe(false);

  // a real signal: a big carp into the Collections book inks "First bite" and "The one that didn't get away"
  const before = await coins();
  await page.evaluate(() => ((window as unknown as W).__valley.ctx.services.get('collection') as { catch(id: string, cm: number): unknown }).catch('carp', 64));
  await expect.poll(() => earned('first-fish'), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => earned('big-catch'), { timeout: 10_000 }).toBe(true);
  await expect(page.locator('.vh-toast', { hasText: 'Stamp inked' }).first()).toBeVisible();
  await expect(page.locator('.vh-toast img.vh-stamp-ico').first()).toBeVisible();
  expect(await coins()).toBeGreaterThanOrEqual(before + 20);

  // the demo valley's farmers are not real work: no work stamp, however busy it is
  await page.waitForTimeout(1500);
  const work = (await book()).stamps.filter((s) => ['first-crate', 'five-at-once', 'streak-7', 'green-10'].includes(s.id));
  expect(work.every((s) => !s.earned)).toBe(true);

  // the Almanac's Stamps tab: inked stamp with its date, a faint outline with a hint, a secret "?"
  await page.evaluate(() => (window as unknown as { __hud: { open(id: string, arg?: unknown): void } }).__hud.open('almanac'));
  await expect(page.getByTestId('panel-almanac')).toBeVisible();
  await page.keyboard.press('s');
  await expect(page.getByTestId('stampbook')).toBeVisible();
  await expect(page.getByTestId('almanac-tab-stamps')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('stamp-first-fish')).toHaveClass(/inked/);
  await expect(page.getByTestId('stamp-summit')).toHaveClass(/blank/);
  await expect(page.getByTestId('stamp-pen-pal')).toHaveClass(/secret/);
  await expect(page.getByTestId('stamp-pen-pal')).toContainText('Secret stamp');
  await expect(page.getByTestId('almanac-tab-stamps')).toContainText(/\d+\/\d+/);
  await page.getByTestId('panel-almanac').screenshot({ path: test.info().outputPath('stamp-book.png') });
  await page.keyboard.press('1');
  await expect(page.getByTestId('stampbook')).toBeHidden();

  // the dev hook inks one with its reward; earned stamps keep their date across a reload
  const got = await page.evaluate(() => (window as unknown as W).__valley.stamp('photo'));
  expect(got?.bits).toBe(10);
  const day = (await book()).stamps.find((s) => s.id === 'first-fish')?.day;
  expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await page.reload();
  await page.waitForFunction(() => (window as unknown as W).__valley?.ready === true, null, { timeout: 60_000 });
  const after = await book();
  expect(after.stamps.find((s) => s.id === 'first-fish')?.day).toBe(day);
  expect(after.stamps.find((s) => s.id === 'photo')?.earned).toBe(true);
  expect(errors).toEqual([]);
});
