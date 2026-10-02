// Operator flows for many agents at once (docs/valley/ops.md): the command palette (Ctrl+K) and the focus queue (Alt+N).
import type { Page } from '@playwright/test';
import { test, expect } from './server.ts';
import { useGpu } from './gpu.ts';

interface F { id: string; tag: string; status: string; needsYou: boolean; unseenDone: boolean; struggle: number; jobSince: number; options: { key: string; label: string }[] }
declare global { interface Window { __valley?: { ready: boolean } } }

test.describe.configure({ mode: useGpu() ? 'parallel' : 'default', timeout: 120_000 });

async function openValley(page: Page, origin: string, token: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}/?t=${token}&quality=low`);
  await page.waitForFunction(() => window.__valley?.ready === true, null, { timeout: 30_000 });
  await page.evaluate(() => (window as unknown as { __hud: { dismissHint(): void } }).__hud.dismissHint());
  return errors;
}
const farmers = (page: Page) => page.evaluate(() => {
  const s = (window as unknown as { __valley: { state(): { farmers: F[] | Record<string, F> } } }).__valley.state();
  return Array.isArray(s.farmers) ? s.farmers : Object.values(s.farmers);
});
const current = (page: Page) => page.evaluate(() => (window as unknown as { __hud: { current(): string | null } }).__hud.current());
const drawerId = (page: Page) => page.locator('[data-testid="drawer"] .hq-thost').getAttribute('data-id');

test('command palette: Ctrl+K finds an agent by name or by what they said, opens its terminal, Esc goes back', async ({ page, demoServer }) => {
  test.slow();
  const errors = await openValley(page, demoServer.origin, demoServer.token);

  // empty: the focus queue first ("Needs a look"), asks on top
  await page.keyboard.press('Control+k');
  const pal = page.getByTestId('panel-palette');
  await expect(pal).toBeVisible();
  await expect(page.getByTestId('palette-input')).toBeFocused();
  await expect(pal).toContainText(/needs a look/i);
  const head = page.getByTestId('palette-item').first();
  await expect(head).toHaveAttribute('data-kind', 'farmer');
  await expect(head).toContainText('needs you');

  // by name: a working farmer, fuzzily (its tag without the separator)
  const fs = await farmers(page);
  const target = fs.find((f) => f.status === 'working' && !f.needsYou) ?? fs[0];
  await page.keyboard.type(target.tag.replace('·', ' '));
  await expect(page.getByTestId('palette-item').first()).toHaveAttribute('data-key', `f:${target.id}`);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('drawer')).toBeVisible();
  await expect.poll(() => drawerId(page)).toBe(target.id);

  // over a terminal you are watching: Ctrl+K, then Esc puts you back in the same terminal
  await page.keyboard.press('Control+k');
  await expect(pal).toBeVisible();
  await expect(page.getByTestId('drawer')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('drawer')).toBeVisible();
  await expect.poll(() => drawerId(page)).toBe(target.id);
  await page.keyboard.press('Escape');
  await expect.poll(() => current(page)).toBeNull();

  // panels by name: "almnc" → the Valley Almanac; Ctrl+K over a panel and Ctrl+K again goes back to that panel
  await page.keyboard.press('Control+k');
  await page.keyboard.type('almnc');
  await expect(page.getByTestId('palette-item').first()).toHaveAttribute('data-key', /^p:almanac:/);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('panel-almanac')).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(pal).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('panel-almanac')).toBeVisible();
  await page.keyboard.press('Escape');

  // answers: "<tag> <option>" offers that answer of an open ask; Enter sends it
  const asker = (await farmers(page)).find((f) => f.needsYou && f.options.length > 0);
  expect(asker).toBeTruthy();
  const opt = asker!.options[0];
  await page.keyboard.press('Control+k');
  await page.keyboard.type(`${asker!.tag} answer ${opt.label.split(/\s+/)[0]}`);
  const answer = page.locator(`[data-testid="palette-item"][data-key="a:${asker!.id}:${opt.key}"]`);
  await expect(answer).toBeVisible();
  await answer.click();
  await expect(page.getByTestId('toasts')).toContainText(/Answered/i);
  await expect.poll(async () => (await farmers(page)).find((f) => f.id === asker!.id)?.needsYou).toBe(false);

  // the ? list knows the new keys
  await page.keyboard.press('Shift+Slash');
  await expect(page.getByTestId('controls')).toContainText('Ctrl+K');
  await expect(page.getByTestId('controls')).toContainText('Alt+N');
  expect(errors).toEqual([]);
});

test('focus queue: Alt+N steps through every agent that wants you, from the valley and from inside a terminal', async ({ page, demoServer }) => {
  test.slow();
  const errors = await openValley(page, demoServer.origin, demoServer.token);
  const fs = await farmers(page);
  const asks = fs.filter((f) => f.needsYou).sort((a, b) => a.jobSince - b.jobSince || a.id.localeCompare(b.id));
  const wanted = fs.filter((f) => f.needsYou || f.unseenDone || (f.status === 'working' && f.struggle >= 2)).length;
  expect(asks.length).toBeGreaterThan(1);

  // from the valley: the longest-waiting ask
  await page.keyboard.press('Alt+n');
  await expect(page.getByTestId('drawer')).toBeVisible();
  await expect.poll(() => drawerId(page)).toBe(asks[0].id);
  await expect(page.getByTestId('drawer-next')).toBeEnabled();
  await expect(page.getByTestId('drawer-next')).toHaveAttribute('title', /^Next: /);

  // inside the terminal: Alt+N again moves on without revisiting; the Next button does the same
  const seen = new Set<string>([asks[0].id]);
  for (let i = 0; i < Math.min(3, wanted - 1); i++) {
    if (i % 2) await page.getByTestId('drawer-next').click(); else await page.keyboard.press('Alt+n');
    await expect.poll(async () => { const id = await drawerId(page); return !!id && !seen.has(id); }).toBe(true);
    seen.add((await drawerId(page))!);
  }
  await expect(page.getByTestId('toasts')).toContainText(/Alt\+N|last one/);
  expect(errors).toEqual([]);
});
