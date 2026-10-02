import { test, expect } from './server.ts';

/**
 * The Valley Projects (model/projects.ts, scene/projects, hud/projects.ts, docs/valley/projects.md): the Mayor's board
 * on the square opens with E; bits and a fish go in from the panel (mouse and keyboard); the demo valley's pretend work
 * never counts; a finished project toasts, and walking up to it plays the unveiling (the restored place stands, a
 * second toast says what it unlocked); everything survives a reload, and Fern's notebook has the page.
 */
interface Need { kind: string; what: string; have: number; need: number }
interface Proj { id: string; status: string; ready: boolean; pending: boolean; done: number | null; unveiled: number | null; restored: boolean; needs: Need[] }
interface List { done: number; total: number; projects: Proj[] }
type PJ = ((() => List) & {
  complete(id: string, seen?: boolean): boolean; go(id: string): boolean; reset(id?: string): boolean; unveil(id: string): boolean;
});
type V = {
  ready: boolean;
  projects: PJ;
  coins(n?: number): number;
  interact(): void;
  focused(): { id: string; verb: string; label: string } | null;
  guide(): { pages: { id: string; found: boolean }[] };
  ctx: { services: Map<string, unknown> };
};
type H = { open(id: string, arg?: unknown): void; close(): void; current(): string | null; dismissHint?(): void };
type W = { __valley: V; __hud: H };

test.describe.configure({ timeout: 180_000 });

const boot = async (page: import('@playwright/test').Page, origin: string, token: string) => {
  await page.goto(`${origin}/?t=${token}&quality=low&hour=11&weather=clear`);
  await page.waitForFunction(() => (window as unknown as W).__valley?.ready === true, null, { timeout: 60_000 });
};

test('projects: the board takes bits and a fish, demo work never counts, a finished place is unveiled and remembered', async ({ page, demoServer }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await boot(page, demoServer.origin, demoServer.token);
  const list = () => page.evaluate(() => (window as unknown as W).__valley.projects());
  const proj = async (id: string) => (await list()).projects.find((p) => p.id === id)!;
  const need = async (id: string, what: string) => (await proj(id)).needs.find((n) => n.what === what)!;
  await page.evaluate(() => (window as unknown as W).__valley.projects.reset());

  const first = await list();
  expect(first.total).toBe(6);
  expect(first.done).toBe(0);
  expect(first.projects.map((p) => p.id)).toEqual(['lanterns', 'footbridge', 'glasshouse', 'millwheel', 'observatory', 'halt']);
  // the later tiers wait for the earlier ones
  expect((await proj('halt')).status).toBe('locked');
  expect((await proj('millwheel')).status).toBe('locked');
  expect(first.projects.every((p) => !p.restored)).toBe(true);

  // the board on the square: the crosshair finds it, E reads it
  expect(await page.evaluate(() => (window as unknown as W).__valley.projects.go('board'))).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__valley.focused()?.id ?? ''), { timeout: 6_000 }).toBe('project:board');
  expect((await page.evaluate(() => (window as unknown as W).__valley.focused()))!.verb).toBe('Read');
  await page.screenshot({ path: info.outputPath('projects-board.png') });
  await page.evaluate(() => (window as unknown as W).__valley.interact());
  const panel = page.getByTestId('panel-projects');
  await expect(panel).toBeVisible();
  for (const id of ['lanterns', 'footbridge', 'glasshouse', 'millwheel', 'observatory', 'halt']) await expect(page.getByTestId(`project-${id}`)).toBeVisible();

  // bits from the purse: Pay 10, then the rest
  await page.evaluate(() => (window as unknown as W).__valley.coins(500));
  await page.getByTestId('project-footbridge').click();
  await expect(page.getByTestId('project-page')).toContainText('footbridge');
  await expect(page.getByTestId('project-status')).toContainText('% there');
  const coins0 = await page.evaluate(() => (window as unknown as W).__valley.coins(0));
  await page.getByTestId('project-pay').click();
  await expect.poll(() => need('footbridge', 'bits').then((n) => n.have)).toBe(10);
  expect(await page.evaluate(() => (window as unknown as W).__valley.coins(0))).toBe(coins0 - 10);
  await page.getByTestId('project-pay-all').click();
  await expect.poll(() => need('footbridge', 'bits').then((n) => n.have)).toBe(120);
  await expect(page.getByTestId('project-need-bits')).toContainText('120 paid in');

  // a fish from the basket (stashed for the test), handed in from its chip
  await page.evaluate(() => (((window as unknown as W).__valley.ctx.services.get('wallet')) as { stash(id: string, n: number): void }).stash('trout', 2));
  const give = page.getByTestId('project-give-trout');
  await expect(give).toBeVisible();
  await give.click();
  await expect.poll(() => need('footbridge', 'fish').then((n) => n.have)).toBe(1);
  // keyboard: the chip can be reached and pressed without the mouse
  await page.getByTestId('project-give-trout').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => need('footbridge', 'fish').then((n) => n.have)).toBe(2);
  await expect(page.getByTestId('project-need-fish')).toContainText('2 of 2');

  // the demo valley's farmers are pretend: their commits never count toward the board
  await expect(page.getByTestId('project-need-ship')).toContainText('only real work counts');
  await page.waitForTimeout(4000);
  expect((await need('footbridge', 'ship')).have).toBe(0);
  await page.screenshot({ path: info.outputPath('projects-panel.png') });

  // keyboard: 1 jumps to the first plan, ↓ moves down the list
  await page.keyboard.press('1');
  await expect(page.getByTestId('project-lanterns')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('project-footbridge')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => (window as unknown as W).__hud.close());

  // finish the lantern path: a toast says so; walking up to it plays the unveiling and the posts stand lit
  expect(await page.evaluate(() => (window as unknown as W).__valley.projects.complete('lanterns'))).toBe(true);
  await expect(page.getByTestId('toasts')).toContainText('Project complete: the lantern path', { timeout: 5_000 });
  expect((await proj('lanterns')).pending).toBe(true);
  expect((await proj('lanterns')).restored).toBe(false);
  // with the lantern path done, the observatory's plan opens
  expect((await proj('observatory')).status).toBe('open');
  await page.evaluate(() => (window as unknown as W).__valley.projects.go('lanterns'));
  await expect.poll(() => proj('lanterns').then((p) => p.restored), { timeout: 10_000 }).toBe(true);
  expect((await proj('lanterns')).unveiled).toBeGreaterThan(0);
  await expect(page.getByTestId('toasts')).toContainText('lantern path is restored', { timeout: 5_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: info.outputPath('projects-unveil.png') });

  // the notebook has the page now
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__valley.guide().pages.find((p) => p.id === 'projects')?.found ?? false), { timeout: 5_000 }).toBe(true);

  // everything survives a reload: the restored path stands at once (no second unveiling), the footbridge keeps its bits
  await boot(page, demoServer.origin, demoServer.token);
  const after = await list();
  expect(after.done).toBe(1);
  const lan = after.projects.find((p) => p.id === 'lanterns')!;
  expect(lan.done).toBeGreaterThan(0);
  expect(lan.pending).toBe(false);
  await expect.poll(() => proj('lanterns').then((p) => p.restored), { timeout: 5_000 }).toBe(true);
  expect((await need('footbridge', 'bits')).have).toBe(120);
  expect((await need('footbridge', 'fish')).have).toBe(2);
  // the board's panel reflects it (✓ and a word, not colour alone)
  await page.evaluate(() => (window as unknown as W).__hud.open('projects', 'lanterns'));
  await expect(page.getByTestId('project-status')).toContainText('Restored');
  await page.evaluate(() => (window as unknown as W).__hud.close());

  await page.evaluate(() => (window as unknown as W).__valley.projects.reset());
  expect(errors).toEqual([]);
});
