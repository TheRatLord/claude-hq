// Operator leftovers (docs/valley/ops.md): searching every terminal's scrollback from the palette (`term.search`),
// pin / mute per agent, and the overview grid of every agent (V).
import type { Page } from '@playwright/test';
import { test, expect } from './server.ts';
import { useGpu } from './gpu.ts';

interface F { id: string; tag: string; status: string; needsYou: boolean; unseenDone: boolean; options: { key: string; label: string }[] }
interface H { prefs(p?: Record<string, unknown>): { pinned: string[]; muted: string[]; keys: Record<string, string> }; current(): string | null; open(id: string, arg?: unknown): void; close(): void; dismissHint(): void }
declare global { interface Window { __valley?: { ready: boolean } } }

test.describe.configure({ mode: useGpu() ? 'parallel' : 'default', timeout: 150_000 });

async function openValley(page: Page, origin: string, token: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}/?t=${token}&quality=low`);
  await page.waitForFunction(() => window.__valley?.ready === true, null, { timeout: 30_000 });
  await page.evaluate(() => (window as unknown as { __hud: H }).__hud.dismissHint());
  return errors;
}
const farmers = (page: Page) => page.evaluate(() => {
  const s = (window as unknown as { __valley: { state(): { farmers: F[] | Record<string, F> } } }).__valley.state();
  return Array.isArray(s.farmers) ? s.farmers : Object.values(s.farmers);
});
const hud = (page: Page) => ({
  prefs: (p?: Record<string, unknown>) => page.evaluate((x) => (window as unknown as { __hud: H }).__hud.prefs(x ?? undefined), p ?? null),
  current: () => page.evaluate(() => (window as unknown as { __hud: H }).__hud.current()),
});
const force = (page: Page, ids: string[], patch: Record<string, unknown>) =>
  page.evaluate(([xs, p]) => { for (const id of xs) void (window as unknown as { __valley: { force(id: string, p: Record<string, unknown>): unknown } }).__valley.force(id, p); }, [ids, patch] as const);
const drawerId = (page: Page) => page.locator('[data-testid="drawer"] .hq-thost').getAttribute('data-id');

test('palette: typing searches every terminal\'s scrollback; Enter opens that terminal\'s history at the line', async ({ page, demoServer }) => {
  test.slow();
  const errors = await openValley(page, demoServer.origin, demoServer.token);
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('panel-palette')).toBeVisible();
  // every demo agent's terminal greets with "Welcome to Claude Code (demo)": the server reads them on the first search
  await page.keyboard.type('welcome to');
  const line = page.locator('[data-testid="palette-item"][data-kind="line"]').first();
  await expect(line).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('palette-list')).toContainText(/in their terminals/i);
  await expect(line.locator('mark')).toHaveText(/welcome/i);
  await expect(page.locator('.vh-pal-count')).toContainText(/in terminals/);
  const key = (await line.getAttribute('data-key'))!;
  const id = key.split(':').slice(1, -1).join(':');
  // choose it (the line rows come after the agents that matched by name) and go
  const rows = page.getByTestId('palette-item');
  const n = await rows.count();
  for (let i = 0; i < n; i++) { if ((await rows.nth(i).getAttribute('data-key')) === key) break; await page.keyboard.press('ArrowDown'); }
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('drawer')).toBeVisible();
  await expect.poll(() => drawerId(page)).toBe(id);
  await expect(page.getByTestId('drawer-host')).toHaveAttribute('data-found', '1', { timeout: 15_000 });
  await page.keyboard.press('Escape'); // the history overlay
  await page.keyboard.press('Escape'); // the drawer (watching)
  await expect.poll(() => hud(page).current()).toBeNull();
  // short queries never search (and a nonsense word finds nothing)
  await page.keyboard.press('Control+k');
  await page.keyboard.type('zq');
  await page.waitForTimeout(600);
  await expect(page.locator('[data-testid="palette-item"][data-kind="line"]')).toHaveCount(0);
  await page.keyboard.type('xjvkqz');
  await expect(page.getByTestId('palette-list')).toContainText(/Nothing matches/, { timeout: 10_000 });
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('pin / mute: ledger toggles and keys, pinned first everywhere, persisted; a muted ask shows quietly, without a toast', async ({ page, demoServer }) => {
  test.slow();
  const errors = await openValley(page, demoServer.origin, demoServer.token);
  const fs = await farmers(page);
  const calm = fs.filter((f) => f.status === 'working' && !f.needsYou);
  expect(calm.length).toBeGreaterThan(2);
  const [pinMe, muteMe, loud] = [fs.filter((f) => !f.needsYou).at(-1)!, calm[0], calm[1]];

  // the ledger: the pin button (aria-pressed) moves the row into a Pinned group at the top
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('panel-roster')).toBeVisible();
  const pinRow = page.locator(`[data-testid="roster-row"][data-id="${pinMe.id}"]`);
  await pinRow.getByTestId('roster-pin').click();
  await expect(page.getByTestId('toasts')).toContainText(/Pinned/);
  await expect(page.locator('.vh-roster .vh-group').first()).toHaveAttribute('aria-label', 'Pinned');
  await expect(page.locator('.vh-roster .vh-group').first().getByTestId('roster-row').first()).toHaveAttribute('data-id', pinMe.id);
  await expect(pinRow.getByTestId('roster-pin')).toHaveAttribute('aria-pressed', 'true');
  // Alt+M mutes the selected row (works while the filter has focus)
  await page.getByTestId('roster-filter').fill(muteMe.tag);
  await expect(page.locator(`[data-testid="roster-row"][data-id="${muteMe.id}"]`)).toHaveClass(/sel/);
  await page.keyboard.press('Alt+m');
  await expect(page.locator(`[data-testid="roster-row"][data-id="${muteMe.id}"]`).getByTestId('roster-mute')).toHaveAttribute('aria-pressed', 'true');
  expect((await hud(page).prefs()).muted).toEqual([muteMe.id]);
  await page.keyboard.press('Escape');

  // persisted per browser: a reload keeps both
  const errors2 = await openValley(page, demoServer.origin, demoServer.token);
  const p = await hud(page).prefs();
  expect(p.pinned).toEqual([pinMe.id]);
  expect(p.muted).toEqual([muteMe.id]);

  // the palette's empty view lists pinned agents first
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('palette-list')).toContainText(/pinned/i);
  await expect(page.getByTestId('palette-item').first()).toHaveAttribute('data-key', `f:${pinMe.id}`);
  // and offers mute / pin as actions once you type
  await page.keyboard.type(`unmute ${muteMe.tag}`);
  await expect(page.locator(`[data-testid="palette-item"][data-key="m:muted:${muteMe.id}"]`)).toContainText(/Unmute/);
  await page.keyboard.press('Escape');

  // a muted agent's ask: in the strip (quietly, marked), but no toast; an unmuted one toasts
  await force(page, [muteMe.id], { status: 'blocked' });
  const quietCard = page.locator(`[data-testid="need-card"][data-id="${muteMe.id}"]`);
  await expect(quietCard).toBeVisible({ timeout: 15_000 });
  await expect(quietCard).toHaveClass(/muted/);
  await expect(quietCard.locator('.vh-need-muted')).toBeVisible();
  await force(page, [loud.id], { status: 'blocked' });
  await expect(page.locator(`[data-testid="need-card"][data-id="${loud.id}"]`)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(`.vh-toast[data-id="${loud.id}"]`)).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(`.vh-toast[data-id="${muteMe.id}"]`)).toHaveCount(0);

  // the card: Alt+P pins; its toggles say what they do
  await page.evaluate((id) => (window as unknown as { __hud: H }).__hud.open('card', id), muteMe.id);
  await expect(page.getByTestId('card-muted-note')).toContainText(/still show/);
  await page.keyboard.press('Alt+p');
  await expect(page.getByTestId('card-pin')).toHaveAttribute('aria-pressed', 'true');
  expect((await hud(page).prefs()).pinned).toEqual([pinMe.id, muteMe.id]);
  // pinned first in the needs-you strip too (Alt+1 is a pinned ask when there is one)
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('need-card').first()).toHaveAttribute('data-id', muteMe.id);
  expect([...errors, ...errors2]).toEqual([]);
});

test('overview grid: V opens a tile per agent; arrows move, Enter opens the terminal; Alt+P pins; in the palette and rebindable', async ({ page, demoServer }) => {
  test.slow();
  const errors = await openValley(page, demoServer.origin, demoServer.token);
  const fs = await farmers(page);
  await page.keyboard.press('v');
  const panel = page.getByTestId('panel-overview');
  await expect(panel).toBeVisible();
  const tiles = page.getByTestId('overview-tile');
  await expect(tiles).toHaveCount(fs.length);
  // asks first, with their waiting badge
  const asks = fs.filter((f) => f.needsYou);
  if (asks.length) {
    await expect(tiles.first()).toHaveAttribute('data-st', 'blocked');
    await expect(tiles.first().getByTestId('overview-waiting')).toContainText(/waiting/);
  }
  await expect(panel).toContainText(new RegExp(`${fs.length} agents`));
  // keyboard: the first tile is selected; → moves; Alt+P pins the selection, which jumps to the front
  await expect(tiles.first()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  const second = (await tiles.nth(1).getAttribute('data-id'))!;
  await expect(tiles.nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Alt+p');
  await expect(tiles.first()).toHaveAttribute('data-id', second);
  await expect(tiles.first()).toHaveClass(/pinned/);
  // Enter: the selected agent's terminal
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('drawer')).toBeVisible();
  await expect.poll(() => drawerId(page)).toBe(second);
  await page.keyboard.press('Escape');
  // from the palette
  await page.keyboard.press('Control+k');
  await page.keyboard.type('overview');
  await expect(page.getByTestId('palette-item').first()).toHaveAttribute('data-key', /^p:overview:/);
  await page.keyboard.press('Enter');
  await expect(panel).toBeVisible();
  await page.keyboard.press('v');
  await expect(panel).toBeHidden();
  // rebindable (Settings → Controls), listed in the controls
  expect((await hud(page).prefs()).keys.overview).toBe('KeyV');
  await hud(page).prefs({ keys: { ...(await hud(page).prefs()).keys, overview: 'KeyU' } });
  await page.keyboard.press('u');
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() => (window as unknown as { __hud: H }).__hud.open('pause', 'controls'));
  await expect(page.getByTestId('controls')).toContainText(/overview: every agent/i);
  expect(errors).toEqual([]);
});
