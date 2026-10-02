import { test, expect } from './server.ts';

/**
 * The Valley Gazette (model/gazette.ts, newsroom.ts, hud/gazette.ts): the demo valley gets a weekly edition in the
 * mailbox, "Read the paper" opens it as a newspaper page (masthead, lead, columns, weather, classifieds, the Mayor's
 * editorial), ← / → step between today's morning edition and the back issues, G toggles it, the noticeboard pins
 * today's paper, and a real catch makes the fishing report.
 */
interface Summary {
  no: number; kind: string; demo: boolean; lead: string; due: boolean;
  stories: { id: string; head: string }[]; gossip: string[];
  issues: { no: number; from: string; to: string }[];
}
type V = { ready: boolean; gazette(cmd?: string | number): Summary; ctx: { services: Map<string, unknown> } };
type W = { __valley: V; __hud: { open(id: string, arg?: unknown): void } };

test.describe.configure({ timeout: 120_000 });

test('gazette: a weekly edition in the mailbox, the newspaper page, back issues, noticeboard and a real catch', async ({ page, demoServer }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${demoServer.origin}/?t=${demoServer.token}&quality=low&pose=hub&hour=10&weather=clear`);
  await page.waitForFunction(() => (window as unknown as W).__valley?.ready === true, null, { timeout: 60_000 });
  const paper = () => page.evaluate(() => (window as unknown as W).__valley.gazette());

  // the demo's weekly edition is delivered (in memory) once its farmers are out
  await expect.poll(async () => (await paper()).issues.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  const first = await paper();
  expect(first.demo).toBe(true);
  expect(first.due).toBe(false);
  expect(first.lead.length).toBeGreaterThan(5);
  expect(first.stories.length).toBeGreaterThanOrEqual(4);
  expect(first.stories.map((s) => s.id)).toContain('farmer');

  // the mailbox has the paper; "Read the paper" opens that issue
  await page.evaluate(() => (window as unknown as W).__hud.open('mailbox', 'all'));
  await expect(page.getByTestId('panel-mailbox')).toBeVisible();
  const letter = page.locator('[data-testid="letter"]', { hasText: 'The Valley Gazette' }).first();
  await expect(letter).toBeVisible();
  await letter.click();
  await letter.getByTestId('letter-gazette').click();
  const panel = page.getByTestId('panel-gazette');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('gz-edition-0')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('gz-page')).toHaveAttribute('data-kind', 'weekly');
  for (const id of ['gz-masthead', 'gz-lead', 'gz-numbers', 'gz-weather', 'gz-forecast', 'gz-gossip', 'gz-classifieds', 'gz-editorial']) await expect(panel.getByTestId(id)).toBeVisible();
  await expect(panel.locator('.gz-mast-cv')).toBeVisible();
  expect(await panel.locator('[data-testid="gz-story"]').count()).toBeGreaterThanOrEqual(4);
  await expect(panel.getByTestId('gz-weather').locator('.gz-wday')).toHaveCount(7);

  // → today's morning edition, ← back again; G closes, G opens today's
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('gz-edition-today')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('gz-page')).toHaveAttribute('data-kind', 'daily');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('gz-page')).toHaveAttribute('data-kind', 'weekly');
  await page.keyboard.press('g');
  await expect(panel).toBeHidden();
  await page.keyboard.press('g');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('gz-page')).toHaveAttribute('data-kind', 'daily');
  await panel.screenshot({ path: test.info().outputPath('gazette.png') });
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  // the noticeboard pins today's paper
  await page.evaluate(() => (window as unknown as W).__hud.open('noticeboard'));
  const note = page.locator('.vh-note.gazette');
  await expect(note).toContainText("Read today's paper");
  await note.click();
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');

  // a real catch makes the fishing report of the morning edition
  await page.evaluate(() => ((window as unknown as W).__valley.ctx.services.get('collection') as { catch(id: string, cm: number): unknown }).catch('pike', 96));
  await expect.poll(async () => (await paper()).stories.find((s) => s.id === 'fish')?.head ?? '', { timeout: 10_000 }).toContain('96');

  // a forced delivery files another back issue (dev hook)
  await page.evaluate(() => (window as unknown as W).__valley.gazette('deliver'));
  expect((await paper()).issues.length).toBeGreaterThanOrEqual(1);
  expect(errors).toEqual([]);
});
