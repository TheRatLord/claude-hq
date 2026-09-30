import type { Page } from '@playwright/test';
import { test, expect } from './server.ts';

interface HudHandle {
  current(): string | null;
  mapHits(): { id: string; kind: string; sx: number; sy: number; r: number }[];
}
declare global { interface Window { __hud?: HudHandle; __valley?: { ready: boolean } } }

async function openValley(page: Page, origin: string, token: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // low quality: headless CI renders the 3D valley in software
  await page.goto(`${origin}/?t=${token}&quality=low`);
  await page.waitForFunction(() => window.__valley?.ready === true, null, { timeout: 30_000 });
  return errors;
}

test.describe.configure({ timeout: 120_000 });

test('the valley HUD reaches every terminal: ledger, map click, needs-you answers', async ({ page, demoServer }) => {
  const errors = await openValley(page, demoServer.origin, demoServer.token);
  const hud = page.getByTestId('hud');
  await expect(hud).toBeVisible();
  await expect(page.getByTestId('link-state')).toHaveText(/demo valley|live/i);

  // --- ledger (Tab) → terminal, observe first ---
  await page.keyboard.press('Tab');
  const roster = page.getByTestId('panel-roster');
  await expect(roster).toBeVisible();
  // allStates: 23 agents + 10 shells
  await expect(page.getByTestId('roster-row')).toHaveCount(33);
  await page.getByTestId('roster-filter').fill('working');
  const working = page.locator('[data-testid="roster-row"][data-status="working"]').first();
  await expect(working).toBeVisible();
  const workingId = await working.getAttribute('data-id');
  await working.getByRole('button', { name: 'Terminal' }).click();
  const drawer = page.getByTestId('drawer');
  await expect(drawer).toBeVisible();
  await expect(page.getByTestId('drawer-mode')).toHaveAttribute('data-state', 'live:observe');
  await expect(drawer.locator(`.hq-thost[data-id="${workingId}"]`)).toBeVisible();
  await expect(drawer.locator('.xterm-accessibility-tree')).not.toHaveText('', { timeout: 10_000 });
  // Escape closes while watching
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__hud?.current() ?? null)).toBeNull();

  // --- map (M): clicking a farmer opens its terminal immediately ---
  await page.keyboard.press('m');
  const canvas = page.getByTestId('map-canvas');
  await expect(canvas).toBeVisible();
  await expect.poll(async () => (await page.evaluate(() => window.__hud?.mapHits() ?? [])).filter((h) => h.kind === 'farmer').length).toBeGreaterThan(5);
  const hits = (await page.evaluate(() => window.__hud?.mapHits() ?? [])).filter((h) => h.kind === 'farmer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('map canvas has no box');
  const target = hits.find((h) => h.sx > 20 && h.sy > 20 && h.sx < box.width - 20 && h.sy < box.height - 20) ?? hits[0];
  await page.mouse.click(box.x + target.sx, box.y + target.sy);
  await expect(drawer).toBeVisible();
  await expect(drawer.locator(`.hq-thost[data-id="${target.id}"]`)).toBeVisible();
  await expect(page.getByTestId('drawer-mode')).toHaveAttribute('data-state', /live:observe|connecting/);
  // switch terminals from the side list, then close with the leader key
  await page.keyboard.press('Control+PageDown');
  await expect(drawer.locator(`.hq-thost[data-id="${target.id}"]`)).toHaveCount(0);
  await page.keyboard.press('Control+Backquote');
  await expect(drawer).toBeHidden();

  // --- needs-you strip: answer a blocked prompt ---
  // closing the drawer handed the mouse back to the valley (pointer lock); Escape frees it and pauses
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('panel-pause')).toBeVisible();
  const cards = page.getByTestId('need-card');
  await expect(cards.first()).toBeVisible();
  const before = await cards.count();
  const card = cards.first();
  const askId = await card.getAttribute('data-id');
  await card.getByTestId('need-answer').first().click();
  await expect(page.getByTestId('toasts')).toContainText(/Answered/i);
  await expect(page.locator(`[data-testid="need-card"][data-id="${askId}"]`)).toHaveCount(0, { timeout: 10_000 });
  expect(await cards.count()).toBeLessThan(before);

  // --- mailbox (J) opens and closes cleanly ---
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('panel-pause')).toBeHidden();
  await page.keyboard.press('j');
  await expect(page.getByTestId('panel-mailbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('panel-mailbox')).toBeHidden();

  expect(errors).toEqual([]);
});

test('the terminal drawer keeps Escape for the agent while in control', async ({ page, demoServer }) => {
  const errors = await openValley(page, demoServer.origin, demoServer.token);
  const first = page.getByTestId('need-card').first();
  await expect(first).toBeVisible();
  await first.getByRole('button', { name: 'Terminal' }).click();
  const drawer = page.getByTestId('drawer');
  await expect(drawer).toBeVisible();
  await expect(page.getByTestId('drawer-mode')).toHaveAttribute('data-state', 'live:observe');
  await page.getByTestId('drawer-take').click();
  await expect(page.getByTestId('drawer-mode')).toHaveAttribute('data-state', /:control$/);
  await drawer.locator('.xterm-helper-textarea').focus();
  await page.keyboard.press('Escape');
  // still open: Escape went to the pane
  await expect(drawer).toBeVisible();
  await page.getByTestId('drawer-close').click();
  await expect(drawer).toBeHidden();
  expect(errors).toEqual([]);
});
