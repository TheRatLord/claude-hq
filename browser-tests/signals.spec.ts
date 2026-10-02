import { test, expect } from './server.ts';

/**
 * Work signals (docs/valley/signals.md): the demo server simulates git per workspace and token spend per Claude, so the
 * ledger shows each field's branch and the valley's spend today, the farmer card the model, context, branch, last
 * commit and spend, and a nameplate grows a context gauge once the window runs high.
 */
type F = { id: string; status: string; kind: string; context: number | null; model?: string | null; git?: { branch: string | null } | null; spend?: { tokens: number } | null };
type V = { ready: boolean; state(): { farmers: Record<string, F> | [string, F][]; spend?: { tokens: number; agents: number } }; force(id: string, patch: Record<string, unknown>): void; goTo(id: string, dist?: number): void };

test.describe.configure({ timeout: 120_000 });

test('work signals: ledger branch + spend, card model / context / branch / commit / spend, nameplate context gauge', async ({ page, demoServer }) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${demoServer.origin}/?t=${demoServer.token}&quality=low`);
  await page.waitForFunction(() => (window as unknown as { __valley?: V }).__valley?.ready === true, null, { timeout: 60_000 });

  const farmers = async (): Promise<F[]> => page.evaluate(() => {
    const f = (window as unknown as { __valley: V }).__valley.state().farmers;
    return (Array.isArray(f) ? f.map(([, v]) => v) : Object.values(f)) as F[];
  });
  const all = await farmers();
  const priced = all.filter((f) => f.spend && f.spend.tokens > 0);
  expect(priced.length).toBeGreaterThan(3);
  const spend = await page.evaluate(() => (window as unknown as { __valley: V }).__valley.state().spend);
  expect(spend?.agents).toBe(priced.length);

  // --- the ledger: the valley's spend today, each field's branch, per-farmer spend ---
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('panel-roster')).toBeVisible();
  await expect(page.getByTestId('roster-spend-total')).toHaveText(/\$\d+(\.\d\d)? today/);
  await expect(page.getByTestId('roster-repo').first()).toBeVisible();
  await expect(page.getByTestId('roster-spend').first()).toHaveText(/\$/);

  // --- the card of a Claude with a repo ---
  const pick = all.find((f) => f.kind === 'claude' && f.git && f.spend && f.context != null);
  expect(pick).toBeTruthy();
  const row = page.locator(`[data-testid="roster-row"][data-id="${pick!.id}"]`);
  await row.click();
  await page.keyboard.press('Control+i');
  const card = page.getByTestId('panel-card');
  await expect(card).toBeVisible();
  await expect(card.locator('.hero .sub')).toContainText(/Claude · (Opus|Sonnet|Haiku) \d/);
  await expect(card.getByTestId('card-context')).toContainText(/\d+% · \d+k of 200k/);
  await expect(card.getByTestId('card-branch')).toContainText(pick!.git!.branch ?? '@');
  await expect(card.getByTestId('card-commit')).toContainText(/“.+” · /);
  await expect(card.getByTestId('card-spend')).toHaveText(/\$\d+\.\d\d · [\d.]+[kM] tokens/);

  // a forced checklist shows on the card
  await page.evaluate((id) => (window as unknown as { __valley: V }).__valley.force(id, {
    todos: [{ content: 'Read the store', activeForm: 'Reading the store', status: 'completed' }, { content: 'Fix the bug', activeForm: 'Fixing the bug', status: 'in_progress' }, { content: 'Run tests', activeForm: 'Running tests', status: 'pending' }],
    contextTokens: 182_000,
  }), pick!.id);
  const todos = card.getByTestId('card-todos');
  await expect(todos.locator('li')).toHaveCount(3);
  await expect(todos.locator('li.doing')).toHaveText(/Fixing the bug/);
  await expect(card.getByTestId('card-context')).toContainText('compaction soon');
  await page.keyboard.press('Escape');

  // --- the nameplate: a context gauge near the top of the window ---
  await page.evaluate((id) => (window as unknown as { __valley: V }).__valley.goTo(id, 3), pick!.id);
  await expect(page.locator('.vt-name .vt-meter.hot').first()).toBeVisible({ timeout: 15_000 });
  expect(errors).toEqual([]);
});
