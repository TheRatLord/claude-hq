import { test, expect } from './server.ts';

/**
 * Harvest recaps (docs/valley/recap.md): the demo valley seeds each farmer an earlier-today history, the ledger shows a
 * harvest chip (R opens the newest), the postcard panel has the facts, a keyboard-reachable read-only diff (D, Enter on
 * a file for its patch) and paging; the farmer card shows "Last harvest"; a stretch that ends live pops a toast that
 * opens the postcard, and its mailbox letter links to it.
 */
type F = { id: string; status: string; kind: string; git?: { head: string | null } | null };
type R = { key: string; title: string | null; said: string | null; lines: { added: number } | null; commits: unknown[] };
type V = {
  ready: boolean;
  state(): { farmers: Record<string, F> | [string, F][] };
  force(id: string, patch: Record<string, unknown>): void;
  recaps(id?: string, step?: string): unknown;
};
const W = () => (window as unknown as { __valley: V }).__valley;

test.describe.configure({ timeout: 120_000 });

test('harvest recaps: ledger chip, the postcard + diff by keyboard, the card section, a live recap toast + letter', async ({ page, demoServer }) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${demoServer.origin}/?t=${demoServer.token}&quality=low`);
  await page.waitForFunction(() => (window as unknown as { __valley?: V }).__valley?.ready === true, null, { timeout: 60_000 });

  const farmers = async (): Promise<F[]> => page.evaluate(() => {
    const f = (window as unknown as { __valley: V }).__valley.state().farmers;
    return (Array.isArray(f) ? f.map(([, v]) => v) : Object.values(f)) as F[];
  });
  // the demo seeded some farmers a history; make sure one with a repo has a couple
  const all = await farmers();
  const withRepo = all.find((f) => f.kind === 'claude' && f.git && f.status !== 'blocked');
  expect(withRepo).toBeTruthy();
  const id = withRepo!.id;
  let seeded = (await page.evaluate((x) => (window as unknown as { __valley: V }).__valley.recaps(x), id)) as R[];
  for (let i = 0; seeded.length < 2 && i < 3; i++) {
    await page.evaluate((x) => (window as unknown as { __valley: V }).__valley.recaps(x, 'seed'), id);
    seeded = (await page.evaluate((x) => (window as unknown as { __valley: V }).__valley.recaps(x), id)) as R[];
  }
  expect(seeded.length).toBeGreaterThan(0);

  // --- the ledger: a harvest chip; R on the selected row opens the newest recap ---
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('panel-roster')).toBeVisible();
  const row = page.locator(`[data-testid="roster-row"][data-id="${id}"]`);
  await expect(row.getByTestId('roster-harvest')).toBeVisible();
  await row.click();
  await page.keyboard.press('KeyR');
  const panel = page.getByTestId('panel-recap');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('recap-headline')).not.toBeEmpty();
  if (seeded[0].said) await expect(panel.getByTestId('recap-said')).toHaveText(seeded[0].said);
  await expect(panel.getByTestId('recap-facts')).toBeVisible();
  // the primary action has focus: Open terminal
  await expect(panel.getByTestId('recap-terminal')).toBeFocused();

  // --- D: the read-only diff; Tab reaches a file; Enter shows its patch ---
  await page.keyboard.press('KeyD');
  const diff = panel.getByTestId('recap-diff');
  await expect(diff.getByTestId('recap-diff-stat')).toHaveText(/\d+ files? · \+\d+ −\d+/);
  const files = diff.getByTestId('recap-file');
  expect(await files.count()).toBeGreaterThan(0);
  for (let i = 0; i < 12; i++) {
    if (await files.first().evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(files.first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(diff.getByTestId('recap-patch')).toContainText('diff --git');
  await expect(files.first()).toHaveAttribute('aria-expanded', 'true');

  // --- paging through the farmer's history (←: older) ---
  if (seeded.length > 1) {
    await page.keyboard.press('ArrowLeft');
    await expect(panel.locator('.vh-rc-pager')).toContainText(`2 of ${seeded.length}`);
    await expect(diff).toBeHidden();
    await page.keyboard.press('ArrowRight');
    await expect(panel.locator('.vh-rc-pager')).toContainText(`1 of ${seeded.length}`);
  }

  // --- C: the farmer card's "Last harvest"; its button opens the postcard again ---
  await page.keyboard.press('KeyC');
  const card = page.getByTestId('panel-card');
  await expect(card).toBeVisible();
  const harvest = card.getByTestId('card-harvest');
  await expect(harvest).toBeVisible();
  await expect(card.getByTestId('card-harvest-row')).toHaveCount(seeded.length - 1);
  await card.getByTestId('card-harvest-open').click();
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  // --- live: an idle farmer works a stretch and finishes → a recap, a toast that opens it, a letter that links it ---
  const idle = (await farmers()).find((f) => f.kind === 'claude' && f.status === 'idle' && f.id !== id) ?? (await farmers()).find((f) => f.kind === 'claude' && f.status === 'done' && f.id !== id);
  expect(idle).toBeTruthy();
  const before = ((await page.evaluate((x) => (window as unknown as { __valley: V }).__valley.recaps(x), idle!.id)) as R[]).length;
  await page.evaluate((x) => (window as unknown as { __valley: V }).__valley.force(x, { status: 'idle' }), idle!.id);
  await page.waitForTimeout(800);
  await page.evaluate((x) => (window as unknown as { __valley: V }).__valley.force(x, {
    status: 'working', title: 'Tidy the recap', work: { since: Date.now(), added: 0, removed: 0, files: 0 },
  }), idle!.id);
  await page.waitForTimeout(1500);
  await page.evaluate((x) => (window as unknown as { __valley: V }).__valley.force(x, {
    status: 'done', lastText: 'All tidy now: the recap card is wired.', work: { since: Date.now() - 1500, added: 42, removed: 3, files: 2 },
  }), idle!.id);
  await page.waitForFunction(([x, n]) => ((window as unknown as { __valley: V }).__valley.recaps(x as string) as R[]).length > (n as number), [idle!.id, before] as const, { timeout: 15_000 });
  const fresh = ((await page.evaluate((x) => (window as unknown as { __valley: V }).__valley.recaps(x), idle!.id)) as R[])[0];
  expect(fresh.said).toBe('All tidy now: the recap card is wired.');
  expect(fresh.lines?.added).toBe(42);
  const toast = page.getByTestId('toasts').locator('.vh-toast', { hasText: '+42 −3' });
  await expect(toast).toBeVisible();
  await toast.click();
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('recap-said')).toHaveText('All tidy now: the recap card is wired.');
  await expect(panel.getByTestId('recap-headline')).toHaveText(/Changes ready to review|Made changes/);
  await page.keyboard.press('Escape');

  // the mailbox letter for that finish links to the same recap
  await page.keyboard.press('KeyJ');
  const mailbox = page.getByTestId('panel-mailbox');
  await expect(mailbox).toBeVisible();
  await mailbox.getByTestId('mail-tab-all').click();
  const letter = mailbox.locator('[data-testid="letter"]', { hasText: 'Tidy the recap' }).first();
  await letter.click();
  await letter.getByTestId('letter-recap').click();
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('recap-said')).toHaveText('All tidy now: the recap card is wired.');

  expect(errors).toEqual([]);
});
