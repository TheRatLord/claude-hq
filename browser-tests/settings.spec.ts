import type { Page } from '@playwright/test';
import { test, expect } from './server.ts';

/**
 * Settings & accessibility (hud/pause.ts Settings, model/prefs.ts, farm/prefs.ts; docs/valley/hud.md → Settings):
 * browser-local prefs round-trip through the panel and a reload (fov, rebinding a key with conflict detection, UI scale,
 * the clock, colour-safe status, shadows), reduced motion follows the OS unless told otherwise, and every panel is
 * keyboard-navigable (Tab stays inside, focus is visible, ←/→ switch tabs), with captions + a live region for asks.
 */
type V = { ready: boolean; ctx: { camera: { fov: number }; comfort: { reducedMotion: boolean; weatherFx: number }; scene: { traverse(fn: (o: { isLight?: boolean; castShadow?: boolean; isDirectionalLight?: boolean }) => void): void } } };
type H = { dismissHint(): void; current(): string | null; prefs(p?: Record<string, unknown>): Record<string, unknown> };

test.describe.configure({ timeout: 120_000 });

async function boot(page: Page, origin: string, token: string): Promise<void> {
  await page.goto(`${origin}/?t=${token}&quality=low`);
  await page.waitForFunction(() => (window as unknown as { __valley?: V }).__valley?.ready === true, null, { timeout: 60_000 });
  await page.evaluate(() => (window as unknown as { __hud: H }).__hud.dismissHint());
}
async function openSettings(page: Page, section: string): Promise<void> {
  if (await page.evaluate(() => (window as unknown as { __hud: H }).__hud.current()) !== 'pause') {
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('panel-pause')).toBeVisible();
  }
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByTestId(`set-sec-${section}`).click();
  await expect(page.getByTestId(`set-${section}`)).toBeVisible();
}
const layerClass = (page: Page) => page.getByTestId('hud').getAttribute('class');

test('settings: prefs round-trip through the panel and a reload; rebinding refuses conflicts', async ({ page, demoServer }) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await boot(page, demoServer.origin, demoServer.token);
  expect(await page.evaluate(() => (window as unknown as { __valley: V }).__valley.ctx.camera.fov)).toBe(62);

  // --- Controls: fov, a rebind (and a refused one), then the new key works and the old one is free ---
  await openSettings(page, 'controls');
  await page.getByTestId('set-fov').fill('80');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __valley: V }).__valley.ctx.camera.fov)).toBe(80);
  await page.getByTestId('bind-use').click();
  await expect(page.getByTestId('bind-use')).toHaveText(/Press a key/);
  await page.keyboard.press('j');
  await expect(page.getByTestId('bind-msg')).toContainText(/already mailbox/);
  await page.keyboard.press('w');
  await expect(page.getByTestId('bind-msg')).toContainText(/kept for walk/);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('bind-use')).toHaveText('E');
  await expect(page.getByTestId('panel-pause')).toBeVisible();
  await page.getByTestId('bind-map').click();
  await page.keyboard.press('u');
  await expect(page.getByTestId('bind-map')).toHaveText('U');

  // --- Interface + Accessibility + Graphics ---
  await page.getByTestId('set-sec-interface').click();
  await page.getByTestId('set-uiscale').fill('1.3');
  await expect.poll(() => page.getByTestId('hud').evaluate((e) => (e as HTMLElement).style.getPropertyValue('--ui-zoom'))).toBe('1.3');
  await page.getByTestId('set-clock').selectOption('12h');
  await expect(page.getByTestId('clock')).toHaveText(/\d (am|pm)$/);
  await page.getByTestId('set-sec-access').click();
  await page.getByTestId('set-cb').check();
  await page.getByTestId('set-hc').check();
  await expect.poll(() => layerClass(page)).toMatch(/\bcb\b.*|\bhc\b/);
  expect(await layerClass(page)).toMatch(/\bcb\b/);
  expect(await layerClass(page)).toMatch(/\bhc\b/);
  await page.getByTestId('set-sec-graphics').click();
  await expect(page.getByTestId('quality-note')).toContainText('?quality=low');
  await page.getByTestId('set-shadows').uncheck();
  const shadowCasters = () => page.evaluate(() => { let n = 0; (window as unknown as { __valley: V }).__valley.ctx.scene.traverse((o) => { if (o.isLight && o.castShadow) n++; }); return n; });
  await expect.poll(shadowCasters).toBe(0);
  await page.getByTestId('set-weather').fill('0.25');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __valley: V }).__valley.ctx.comfort.weatherFx)).toBe(0.25);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('panel-pause')).toBeHidden();

  // the rebound key opens the map; M no longer does
  await page.keyboard.press('m');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as { __hud: H }).__hud.current())).toBeNull();
  await page.keyboard.press('u');
  await expect(page.getByTestId('panel-map')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('panel-map')).toBeHidden();

  // --- persisted: everything survives a reload ---
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('valley.hud.prefs') ?? '{}') as Record<string, unknown>);
  expect(stored).toMatchObject({ fov: 80, uiScale: 1.3, clock: '12h', colorSafe: true, highContrast: true, shadows: false, weatherFx: 0.25 });
  expect((stored.keys as Record<string, string>).map).toBe('KeyU');
  await boot(page, demoServer.origin, demoServer.token);
  expect(await page.evaluate(() => (window as unknown as { __valley: V }).__valley.ctx.camera.fov)).toBe(80);
  expect(await layerClass(page)).toMatch(/\bcb\b/);
  await expect(page.getByTestId('clock')).toHaveText(/(am|pm)$/);
  expect(await shadowCasters()).toBe(0);
  await expect(page.getByTestId('dock-map')).toHaveAttribute('title', 'Map (U)');
  await page.keyboard.press('u');
  await expect(page.getByTestId('panel-map')).toBeVisible();
  await page.keyboard.press('Escape');

  // reset keys puts the defaults back
  await openSettings(page, 'controls');
  await page.getByTestId('bind-reset').click();
  await expect(page.getByTestId('bind-map')).toHaveText('M');
  expect(errors).toEqual([]);
});

test('settings: reduced motion follows the OS unless switched off; it calms the camera and the HUD', async ({ page, demoServer }) => {
  test.slow();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await boot(page, demoServer.origin, demoServer.token);
  expect(await layerClass(page)).toMatch(/\breduced\b/);
  expect(await page.evaluate(() => (window as unknown as { __valley: V }).__valley.ctx.comfort.reducedMotion)).toBe(true);
  // HUD animations are off (the dozing chip's pulse, pop-ins): any animated element reports no animation
  const anim = await page.evaluate(() => [...document.querySelectorAll('[data-testid="hud"] *')].filter((e) => getComputedStyle(e).animationName !== 'none').length);
  expect(anim).toBe(0);

  await openSettings(page, 'access');
  await expect(page.getByTestId('set-motion')).toHaveValue('system');
  await page.getByTestId('set-motion').selectOption('off');
  await expect.poll(() => layerClass(page)).not.toMatch(/\breduced\b/);
  expect(await layerClass(page)).toMatch(/\bmotion-ok\b/);
  expect(await page.evaluate(() => (window as unknown as { __valley: V }).__valley.ctx.comfort.reducedMotion)).toBe(false);

  // without the OS asking, the toggle alone turns it on
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByTestId('set-motion').selectOption('on');
  await expect.poll(() => layerClass(page)).toMatch(/\breduced\b/);
  expect(await page.evaluate(() => (window as unknown as { __valley: V }).__valley.ctx.comfort.reducedMotion)).toBe(true);
});

test('keyboard: Tab walks a panel and never leaves it, focus is visible, arrows switch tabs; captions + live region for asks', async ({ page, demoServer }) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await boot(page, demoServer.origin, demoServer.token);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('panel-pause')).toBeVisible();

  // Tab many times: focus always stays inside the pause panel and shows a ring
  const seen = new Set<string>();
  for (let i = 0; i < 24; i++) {
    await page.keyboard.press(i % 7 === 6 ? 'Shift+Tab' : 'Tab');
    const f = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      const panel = document.querySelector('[data-testid="panel-pause"]');
      return { inside: !!a && !!panel?.contains(a), outline: a ? getComputedStyle(a).outlineStyle : '', label: a?.textContent?.trim().slice(0, 30) ?? '' };
    });
    expect(f.inside).toBe(true);
    expect(f.outline).not.toBe('none');
    seen.add(f.label);
  }
  expect(seen.size).toBeGreaterThan(4);

  // ←/→ on the tab row switch Menu / Settings / Controls; inside Settings the sections switch the same way
  await page.getByRole('tab', { name: 'Menu' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('set-sec-controls').click();
  await page.getByTestId('set-sec-controls').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('set-sec-graphics')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('set-sec-graphics')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('set-sec-controls')).toHaveAttribute('aria-selected', 'true');

  // the ledger: Tab closes it (its key), Shift+Tab walks it
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('panel-pause')).toBeHidden();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('panel-roster')).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByTestId('panel-roster')).toBeVisible();
  expect(await page.evaluate(() => !!document.querySelector('[data-testid="panel-roster"]')?.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('panel-roster')).toBeHidden();

  // HUD landmarks carry names for screen readers
  await expect(page.locator('nav[aria-label="Quick panels"]')).toHaveCount(1);
  await expect(page.locator('[role="region"][aria-label*="needs you"]')).toHaveCount(1);

  // captions: switch them on, a farmer gets blocked → a caption line and a live-region announcement
  await page.evaluate(() => (window as unknown as { __hud: H }).__hud.prefs({ captions: true }));
  // every farmer at work gets stuck at once (the demo flaps statuses on its own: one of them surely transitions)
  const calm = await page.evaluate(() => {
    const s = (window as unknown as { __valley: { state(): { farmers: { id: string; status: string }[] | Record<string, { id: string; status: string }> } } }).__valley.state();
    const fs = Array.isArray(s.farmers) ? s.farmers : Object.values(s.farmers);
    return fs.filter((f) => f.status === 'working').map((f) => f.id);
  });
  expect(calm.length).toBeGreaterThan(0);
  await page.evaluate((ids) => { for (const id of ids) void (window as unknown as { __valley: { force(id: string, p: Record<string, unknown>): unknown } }).__valley.force(id, { status: 'blocked' }); }, calm);
  await expect(page.getByTestId('captions')).toContainText(/\[Alert bell\].*needs you/, { timeout: 15_000 });
  await expect(page.getByTestId('sr-announce')).toContainText(/needs you/);
  expect(errors).toEqual([]);
});
