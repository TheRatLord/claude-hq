import { test, expect } from './server.ts';

/**
 * Fern's Field Notebook (model/guide.ts, guidebook.ts, hud/guide.ts; docs/valley/guide.md): the notebook on its key (O)
 * and in the pause menu, empty pages with cryptic hints, a page found by really doing the thing (climbing into the
 * rowboat) with a toast, its how-to and progress, finds from the Collections book, the key in Settings / Controls,
 * Fern's nudge where you stand, a villager rumour, persistence across a reload, and the "what's new" letter (only for
 * a profile that had already met Posy; a first run never gets it).
 */
type V = {
  ready: boolean;
  guide(cmd?: string, a?: string): { found: number; total: number; seen: string[]; nudges: string[]; pages: { id: string; found: boolean; fresh: boolean; now: boolean; notes: string[] }[] };
  boat(cmd?: string, a?: number): unknown;
  collect(n: number): unknown;
  pose(n: string): void;
  ctx: { services: Map<string, unknown> };
};
type H = { open(id: string, arg?: unknown): void; close(): void; current(): string | null; tour: { tip(id: string, ms?: number): boolean } };
type W = { __valley: V; __hud: H };

test.describe.configure({ timeout: 150_000 });

const boot = async (page: import('@playwright/test').Page, origin: string, token: string, q: string) => {
  await page.goto(`${origin}/?t=${token}&quality=low&${q}`);
  await page.waitForFunction(() => (window as unknown as W).__valley?.ready === true, null, { timeout: 60_000 });
};
const guide = (page: import('@playwright/test').Page, cmd?: string, a?: string) =>
  page.evaluate(([c, x]) => (window as unknown as W).__valley.guide(c as string | undefined, x as string | undefined), [cmd, a] as const);

test('notebook: O opens it, empty pages hint, the rowboat page is found by climbing in, finds, nudges, rumours, persistence', async ({ page, demoServer }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1600, height: 900 });
  await boot(page, demoServer.origin, demoServer.token, 'pose=dock&hour=10&weather=clear&season=summer');

  // a first run: nothing found yet, and no "what's new" letter (Posy's welcome is the first-run letter)
  const g0 = await guide(page);
  expect(g0.total).toBeGreaterThanOrEqual(18);
  expect(g0.pages.find((p) => p.id === 'rowboat')!.found).toBe(false);
  expect(await page.evaluate(() => (window as unknown as { __valley: { ctx: { valley: { letters: { farmerId: string }[] } } } }).__valley.ctx.valley.letters.some((l) => l.farmerId === 'guide'))).toBe(false);

  // Fern's nudge where you stand: by the dock in summer, never been in the rowboat
  await page.evaluate(() => (window as unknown as { __hud: { dismissHint(): void } }).__hud.dismissHint());
  expect((await guide(page)).nudges).toContain('boat');
  expect(await page.evaluate(() => (window as unknown as W).__hud.tour.tip('boat', 20_000))).toBe(true);
  await expect(page.getByTestId('onb-tip')).toBeVisible();
  await expect(page.getByTestId('onb-tip')).toContainText('The rowboat is tied at the dock');
  await expect(page.getByTestId('onb-tip')).toContainText('E to climb in');
  await page.screenshot({ path: info.outputPath('nudge.png') });
  await page.getByTestId('onb-tip-close').click();

  // O opens the notebook; an empty page shows Fern's cryptic hint, not the how-to
  await page.keyboard.press('o');
  await expect(page.getByTestId('panel-guide')).toBeVisible();
  await expect(page.getByTestId('guide-count')).toContainText(`of ${g0.total} pages`);
  await page.locator('.gd-tab[data-ch="seasons"]').click();
  await page.locator('.gd-entry[data-page="skate"]').click();
  await expect(page.getByTestId('guide-hint')).toContainText('When the pond turns to glass');
  await expect(page.getByTestId('guide-page')).not.toContainText('figure eight');
  await page.locator('.gd-tab[data-ch="explore"]').click();
  await page.locator('.gd-entry[data-page="grotto"]').click();
  await expect(page.getByTestId('guide-hint')).toContainText('Old Fern swears the falls are hollow');
  await expect(page.locator('.gd-entry[data-page="grotto"] .nm')).toHaveText('? ? ?');
  await page.screenshot({ path: info.outputPath('empty-page.png') });
  // ↓ walks the pages, ← → the chapters; O closes it again
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.gd-tab[aria-selected="true"]')).toHaveAttribute('data-ch', 'village');
  await page.keyboard.press('o');
  await expect(page.getByTestId('panel-guide')).toBeHidden();

  // really doing it: climb into the rowboat → the page is found, with a toast
  await page.evaluate(() => (window as unknown as W).__valley.boat('in'));
  await expect.poll(async () => (await guide(page)).pages.find((p) => p.id === 'rowboat')!.found, { timeout: 10_000 }).toBe(true);
  await expect(page.locator('.vh-toast', { hasText: "A new page in Fern's notebook: The rowboat" })).toBeVisible({ timeout: 5_000 });
  expect((await guide(page)).nudges).not.toContain('boat');
  await page.evaluate(() => (window as unknown as W).__valley.boat('out'));
  // and the Collections book: finds found the foraging and fishing pages
  await page.evaluate(() => (window as unknown as W).__valley.collect(25));
  await expect.poll(async () => (await guide(page)).pages.filter((p) => ['forage', 'fish'].includes(p.id) && p.found).length, { timeout: 10_000 }).toBe(2);

  // the found page: the how-to with key caps, when, progress; a "new" mark until read
  await page.evaluate(() => (window as unknown as W).__hud.open('guide', 'rowboat'));
  await expect(page.getByTestId('guide-page')).toHaveAttribute('data-page', 'rowboat');
  await expect(page.getByTestId('guide-how')).toContainText('climbs in');
  await expect(page.getByTestId('guide-how').locator('kbd')).toHaveText(['E', 'E']);
  await expect(page.getByTestId('guide-page')).toContainText('new page');
  await expect(page.getByTestId('guide-page')).toContainText('spring to autumn');
  await page.waitForTimeout(1600);
  await page.screenshot({ path: info.outputPath('notebook.png') });
  expect((await guide(page)).pages.find((p) => p.id === 'rowboat')!.fresh).toBe(false);
  await page.locator('.gd-tab[data-ch="pastimes"]').click();
  await page.locator('.gd-entry[data-page="fish"]').click();
  await expect(page.getByTestId('guide-notes')).toContainText('caught');
  await page.screenshot({ path: info.outputPath('notebook-fish.png') });
  await page.evaluate(() => (window as unknown as W).__hud.close());

  // the pause menu has it, the Controls list and Settings → Controls show its (rebindable) key
  await page.evaluate(() => (window as unknown as W).__hud.open('pause'));
  await page.getByRole('button', { name: /Fern's field notebook/ }).click();
  await expect(page.getByTestId('panel-guide')).toBeVisible();
  await page.evaluate(() => (window as unknown as W).__hud.open('pause', 'controls'));
  await expect(page.getByTestId('controls')).toContainText("Fern's field notebook");
  await page.evaluate(() => (window as unknown as W).__hud.open('pause', 'settings:controls'));
  await expect(page.getByTestId('bind-notebook')).toHaveText('O');
  await page.evaluate(() => (window as unknown as W).__hud.close());

  // a villager mentions something you haven't found yet (rate-limited across the village)
  const rumour = await page.evaluate(() => ((window as unknown as W).__valley.ctx.services.get('guide') as { rumour(v: string, n: number): string | null }).rumour('villager:fern', 1));
  expect(rumour && rumour.length).toBeGreaterThan(20);

  // a reload keeps what the notebook remembers; nothing old toasts again
  await boot(page, demoServer.origin, demoServer.token, 'pose=hub&hour=10&weather=clear&season=summer');
  const g1 = await guide(page);
  expect(g1.seen).toContain('rowboat');
  expect(g1.pages.find((p) => p.id === 'rowboat')).toMatchObject({ found: true, fresh: false });
  await page.waitForTimeout(1500);
  await expect(page.locator('.vh-toast', { hasText: 'A new page' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('notebook: a returning profile gets Fern\'s "what\'s new" letter; it opens the notebook', async ({ page, demoServer }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1600, height: 900 });
  // a profile that met Posy before the notebook existed
  await page.addInitScript(() => {
    if (localStorage.getItem('claude-valley.guide.v1')) return;
    localStorage.setItem('claude-valley.onboarding.v1', JSON.stringify({ v: 1, welcomed: true, active: false, dismissed: true, folded: false, steps: {}, pastimes: {}, rewarded: false, at: 1, letter: null, hints: { off: false, seen: [], last: 0 } }));
  });
  await boot(page, demoServer.origin, demoServer.token, 'pose=hub&hour=10&weather=clear');
  await page.evaluate(() => (window as unknown as W).__hud.open('mailbox', 'all'));
  const letter = page.getByTestId('letter').filter({ hasText: 'New pages for your notebook' });
  await expect(letter).toHaveCount(1);
  await letter.click();
  await expect(letter).toContainText('This very notebook');
  await expect(letter).not.toContainText('{');
  await page.screenshot({ path: info.outputPath('letter.png') });
  await letter.getByTestId('letter-guide').click();
  await expect(page.getByTestId('panel-guide')).toBeVisible();
  // once: a reload re-posts the same letter, never a second one
  await boot(page, demoServer.origin, demoServer.token, 'pose=hub&hour=10&weather=clear');
  await page.evaluate(() => (window as unknown as W).__hud.open('mailbox', 'all'));
  await expect(page.getByTestId('letter').filter({ hasText: 'New pages for your notebook' })).toHaveCount(1);
  expect(errors).toEqual([]);
});
