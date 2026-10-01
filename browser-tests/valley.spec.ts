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

// one worker for this file: two full 3D valleys rendering at once starve each other's frames and the timing-
// sensitive HUD steps flake ('default' runs the tests in order without skipping the rest on a failure)
test.describe.configure({ mode: 'default', timeout: 120_000 });

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

test('every terminal is reachable by keyboard: map list, mailbox answers, the menu', async ({ page, demoServer }) => {
  const errors = await openValley(page, demoServer.origin, demoServer.token);
  await expect(page.getByTestId('link-state')).toHaveText(/demo valley|live/i);
  await expect(page.getByTestId('need-card').first()).toBeVisible();

  // --- map: ↓ walks the side list (farmers and scarecrows), Enter opens that terminal ---
  await page.keyboard.press('m');
  await expect(page.getByTestId('panel-map')).toBeVisible();
  await expect(page.getByTestId('map-helper').first()).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  const picked = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.id ?? null);
  expect(picked).toBeTruthy();
  await page.keyboard.press('Enter');
  const drawer = page.getByTestId('drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.locator(`.hq-thost[data-id="${picked}"]`)).toBeVisible();
  await page.getByTestId('drawer-close').click();
  await expect(drawer).toBeHidden();

  // --- mailbox: J opens the Needs you tab with the first ask selected, a digit answers it ---
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('panel-pause')).toBeVisible();
  await page.keyboard.press('j');
  await expect(page.getByTestId('panel-mailbox')).toBeVisible();
  await expect(page.getByTestId('mail-tab-needs')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-testid="letter"].sel')).toHaveCount(1);
  await page.keyboard.press('1');
  await expect(page.getByTestId('toasts')).toContainText(/Answered/i);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('panel-mailbox')).toBeHidden();

  // --- Alt+0 folds the needs-you list down to its chip; the chip unfolds it (clickable above the pause menu) ---
  const strip = page.getByTestId('needs-strip');
  if (await strip.isVisible()) {
    await page.keyboard.press('Alt+Digit0');
    await expect(page.getByTestId('need-card')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('panel-pause')).toBeVisible();
    await page.getByTestId('needs-chip').click();
    await expect(page.getByTestId('need-card').first()).toBeVisible();
  } else {
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('panel-pause')).toBeVisible();
  }

  // --- the menu's Terminals entry opens the drawer on somebody ---
  await page.getByTestId('pause-terminals').click();
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('.hq-thost')).toHaveCount(1);
  await page.getByTestId('drawer-close').click();
  await expect(drawer).toBeHidden();

  expect(errors).toEqual([]);
});

test('photo mode: P hides the HUD and flies the camera, P again puts the view back', async ({ page, demoServer }) => {
  test.slow(); // software rendering: every step waits on slow frames
  const errors = await openValley(page, demoServer.origin, demoServer.token);
  const hud = page.getByTestId('hud');
  await expect(hud).toBeVisible();
  const cam = () => page.evaluate(() => (window as unknown as { __valley: { ctx: { camera: { position: { x: number; y: number; z: number } } } } }).__valley.ctx.camera.position).then((p) => ({ x: p.x, y: p.y, z: p.z }));
  const before = await cam();
  await page.keyboard.press('KeyP');
  await expect(page.getByTestId('photo-bar')).toBeVisible();
  await expect(hud).toBeHidden();
  // Space: straight up
  await page.keyboard.down('Space');
  await page.waitForTimeout(900);
  await page.keyboard.up('Space');
  expect((await cam()).y).toBeGreaterThan(before.y + 0.5);
  // HUD keys are asleep in photo mode (M would open the map)
  await page.keyboard.press('KeyM');
  await expect(hud).toBeHidden();
  await page.keyboard.press('KeyP');
  await expect(page.getByTestId('photo-bar')).toBeHidden();
  await expect(hud).toBeVisible();
  const after = await cam();
  expect(Math.abs(after.y - before.y)).toBeLessThan(0.3);
  expect(errors).toEqual([]);
});

test('pastimes: pick up a forageable, catch a fish, both land in the Collections book (K)', async ({ page, demoServer }) => {
  test.slow(); // software rendering
  const errors = await openValley(page, demoServer.origin, demoServer.token);
  type V = { forage(): { id: string; picked: boolean }[]; forageGo(i: number): unknown; fish(step?: string): Promise<unknown>; focused(): { id: string } | null; ctx: { services: Map<string, unknown> } };
  const v = <T>(fn: (v: V) => T) => page.evaluate((src) => new Function('v', `return (${src})(v)`)((window as unknown as { __valley: V }).__valley), fn.toString()) as Promise<Awaited<T>>;
  await page.evaluate(() => { (window as unknown as { __hud: { dismissHint(): void } }).__hud.dismissHint(); });
  // the book starts empty, every entry a silhouette
  await page.keyboard.press('KeyK');
  const book = page.getByTestId('panel-collection');
  await expect(book).toBeVisible();
  await expect(book).toContainText('0 of 28 found');
  await page.keyboard.press('Escape');
  await expect(book).toBeHidden();
  // today's forageables lie about the valley; walk up to one and press E
  await expect.poll(() => v((x) => x.forage().length)).toBeGreaterThanOrEqual(8);
  await v((x) => x.forageGo(0));
  await expect.poll(() => v((x) => x.focused()?.id ?? '')).toMatch(/^forage:/);
  await page.keyboard.press('KeyE');
  await expect.poll(() => v((x) => x.forage()[0].picked)).toBe(true);
  // fishing at the dock: cast, the bobber dips, E hooks it
  expect(await v((x) => x.fish())).toBe(true);
  await expect.poll(() => v((x) => (x.ctx.services.get('forage') as { phase(): string }).phase()), { timeout: 15_000 }).toBe('wait');
  await v((x) => x.fish('bite'));
  await expect.poll(() => v((x) => (x.ctx.services.get('forage') as { phase(): string }).phase())).toBe('bite');
  await page.keyboard.press('KeyE');
  await expect.poll(() => v((x) => (x.ctx.services.get('forage') as { phase(): string }).phase()), { timeout: 15_000 }).toMatch(/show|idle/);
  await page.keyboard.press('KeyK');
  await expect(book).toBeVisible();
  await expect(book).toContainText('2 of 28 found');
  expect(errors).toEqual([]);
});
