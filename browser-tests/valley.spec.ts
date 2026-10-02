import type { Page } from '@playwright/test';
import { test, expect } from './server.ts';
import { useGpu } from './gpu.ts';

interface HudHandle {
  current(): string | null;
  mapHits(): { id: string; kind: string; sx: number; sy: number; r: number }[];
}
declare global { interface Window { __hud?: HudHandle; __valley?: { ready: boolean } } }

async function openValley(page: Page, origin: string, token: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // low quality: cheapest frames (and the only bearable setting when the suite falls back to software rendering)
  await page.goto(`${origin}/?t=${token}&quality=low`);
  await page.waitForFunction(() => window.__valley?.ready === true, null, { timeout: 30_000 });
  return errors;
}

// On the GPU (browser-tests/gpu.ts) every test gets its own worker and demo server. In SwiftShader two full 3D
// valleys rendering at once starve each other's frames and the timing-sensitive HUD steps flake, so the file runs on
// one worker ('default' runs the tests in order without skipping the rest on a failure).
test.describe.configure({ mode: useGpu() ? 'parallel' : 'default', timeout: 120_000 });

test('the valley HUD reaches every terminal: ledger, map click, needs-you answers', async ({ page, demoServer }) => {
  test.slow(); // software rendering: ~45 steps, each waiting on ~0.5 s frames
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
  test.slow(); // software rendering: ~45 steps, each waiting on ~0.5 s frames
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
  type V = { forage(): { key: string; id: string; picked: boolean }[]; forageGo(i: number): unknown; fish(step?: string): Promise<unknown>; focused(): { id: string } | null; ctx: { services: Map<string, unknown> } };
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
  // E picks up whichever find the crosshair is on (a neighbour of #0 when they lie close together)
  const spot = (await v((x) => x.focused()?.id ?? '')).slice('forage:'.length);
  await page.keyboard.press('KeyE');
  await expect.poll(() => page.evaluate((key) => (window as unknown as { __valley: V }).__valley.forage().find((f) => f.key === key)?.picked, spot)).toBe(true);
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

test('power-user loop: answer + next, ? for keys, ledger chips + new task, background notifications', async ({ page, demoServer }) => {
  test.slow(); // software rendering
  // a fake Notification API and a switchable window focus, so "in the background" can be staged headless
  await page.addInitScript(() => {
    const w = window as unknown as { __notes: { title: string; body: string }[]; __away: boolean; Notification: unknown };
    w.__notes = []; w.__away = false;
    class FakeNotification {
      static permission = 'default';
      static async requestPermission() { FakeNotification.permission = 'granted'; return 'granted'; }
      onclick: (() => void) | null = null;
      constructor(title: string, o?: { body?: string }) { w.__notes.push({ title, body: o?.body ?? '' }); }
      close() {}
    }
    w.Notification = FakeNotification;
    document.hasFocus = () => !w.__away;
  });
  const errors = await openValley(page, demoServer.origin, demoServer.token);
  await page.evaluate(() => { (window as unknown as { __hud: { dismissHint(): void } }).__hud.dismissHint(); });
  await expect(page.getByTestId('need-card').first()).toBeVisible();

  // --- mailbox: answering the selected ask selects the next one (same order as the needs-you strip) ---
  const stripOrder = await page.locator('[data-testid="need-card"]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.id));
  await page.keyboard.press('j');
  await expect(page.getByTestId('mail-tab-needs')).toHaveAttribute('aria-selected', 'true');
  const selFrom = () => page.locator('[data-testid="letter"].sel .from').textContent();
  const first = await selFrom();
  if (stripOrder.length >= 2) {
    await page.keyboard.press('1');
    await expect(page.getByTestId('toasts')).toContainText(/Answered/i);
    await expect.poll(selFrom).not.toBe(first);
    await expect(page.locator('[data-testid="letter"].sel')).toHaveCount(1);
  }
  await page.keyboard.press('Escape');

  // --- ? opens every key, grouped ---
  await page.keyboard.press('Shift+Slash');
  await expect(page.getByTestId('panel-pause')).toBeVisible();
  await expect(page.getByTestId('controls')).toContainText('collections book');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('panel-pause')).toBeHidden();

  // --- ledger: the idle chip filters; the new-task button lands in the card's prompt box; Ctrl+Enter twice sends ---
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('panel-roster')).toBeVisible();
  await page.getByTestId('roster-chip-idle').click();
  await expect(page.getByTestId('roster-chip-idle')).toHaveAttribute('aria-pressed', 'true');
  const statuses = await page.locator('[data-testid="roster-row"]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.status));
  expect(statuses.length).toBeGreaterThan(0);
  expect(statuses.every((s) => s === 'idle' || s === 'unknown' || s === 'done')).toBe(true);
  await page.getByTestId('roster-task').first().click();
  await expect(page.getByTestId('panel-card')).toBeVisible();
  await expect(page.getByTestId('card-prompt')).toBeFocused();
  await page.keyboard.type('Write the changelog');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('panel-card')).toContainText(/Send this to/);
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('toasts')).toContainText(/Sent to/);
  await expect(page.getByTestId('panel-card')).toBeHidden();

  // --- notifications: opt in (Settings → Alerts), go "away", a farmer gets blocked → one notification + icon badge ---
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('panel-pause')).toBeVisible();
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByTestId('set-sec-alerts').click();
  await page.getByTestId('set-notify').check();
  await expect(page.getByTestId('toasts')).toContainText(/notifications on/i);
  await page.keyboard.press('Escape');
  const calm = await page.evaluate(() => {
    const s = (window as unknown as { __valley: { state(): { farmers: { id: string; status: string }[] | Record<string, { id: string; status: string }> } } }).__valley.state();
    const fs = Array.isArray(s.farmers) ? s.farmers : Object.values(s.farmers);
    return fs.find((f) => f.status === 'working')?.id ?? null;
  });
  expect(calm).toBeTruthy();
  await page.evaluate((id) => {
    (window as unknown as { __away: boolean }).__away = true;
    (window as unknown as { __valley: { force(id: string, p: Record<string, unknown>): unknown } }).__valley.force(id!, { status: 'blocked' });
  }, calm);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __notes: { title: string }[] }).__notes.map((n) => n.title).join('|')), { timeout: 15_000 }).toMatch(/needs you/);
  await expect(page.locator('link[rel~="icon"]')).toHaveAttribute('data-badge', /^n/);
  await expect.poll(() => page.title()).toMatch(/need/);
  expect(errors).toEqual([]);
});

test('economy: sell your basket at the General store, buy decor, it stands in your yard, carry + put away', async ({ page, demoServer }) => {
  test.slow(); // software rendering
  const errors = await openValley(page, demoServer.origin, demoServer.token);
  type W = { stash(id: string, n?: number): void; coins(): number; data(): { pieces: { uid: number; id: string; slot: number | null }[] } };
  type V = { yard(step?: string): unknown; focused(): { id: string } | null; ctx: { services: Map<string, unknown> } };
  const v = <T>(fn: (v: V) => T) => page.evaluate((src) => new Function('v', `return (${src})(v)`)((window as unknown as { __valley: V }).__valley), fn.toString()) as Promise<Awaited<T>>;
  await page.evaluate(() => { (window as unknown as { __hud: { dismissHint(): void } }).__hud.dismissHint(); });
  // a basket of finds (as if picked and caught), then walk up to the store's counter
  await v((x) => { (x.ctx.services.get('wallet') as W).stash('acorn', 3); (x.ctx.services.get('wallet') as W).stash('carp', 1); });
  await v((x) => x.yard('store'));
  await expect.poll(() => v((x) => x.focused()?.id ?? '')).toBe('yard:store');
  // F: sell your basket
  await page.keyboard.press('KeyF');
  const shop = page.getByTestId('panel-shop');
  await expect(shop).toBeVisible();
  await expect(page.getByTestId('basket').locator('.row')).toHaveCount(2);
  const before = await v((x) => (x.ctx.services.get('wallet') as W).coins());
  await page.getByTestId('basket-sell-all').click();
  await expect.poll(() => v((x) => (x.ctx.services.get('wallet') as W).coins())).toBeGreaterThanOrEqual(before + 40);
  await expect(page.getByTestId('basket').locator('.row')).toHaveCount(0);
  // the Shop tab: buy a flamingo; it goes straight into the yard
  await page.getByTestId('shop-tab-buy').click();
  await page.getByTestId('shop-grid').locator('[data-id="flamingo"]').click();
  await page.getByTestId('shop-buy').click();
  await expect.poll(() => v((x) => (x.ctx.services.get('wallet') as W).data().pieces.map((p) => `${p.id}@${p.slot}`).join())).toBe('flamingo@0');
  await page.getByTestId('shop-tab-yard').click();
  await expect(page.getByTestId('yard-pieces')).toContainText('Pink flamingo');
  await expect(page.getByTestId('yard-map').locator('.spot.full')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(shop).toBeHidden();
  // in the yard: pick it up (carry), X puts it away in storage
  await v((x) => x.yard('carry'));
  await expect.poll(() => v((x) => (x.ctx.services.get('yard') as { carrying(): number | null }).carrying())).not.toBeNull();
  await page.keyboard.press('KeyX');
  await expect.poll(() => v((x) => (x.ctx.services.get('wallet') as W).data().pieces[0].slot)).toBeNull();
  expect(errors).toEqual([]);
});

test('friends: F gives a gift from your basket, today\'s request is asked, done, and handed over (E) for bits', async ({ page, demoServer }) => {
  test.slow(); // software rendering
  const errors = await openValley(page, demoServer.origin, demoServer.token);
  type Fr = { view(id: string): { hearts: number; known: Record<string, string>; giftedToday: boolean; talkedToday: boolean } | null; requests(): { req: { who: string; asked?: boolean }; ready: boolean; done: boolean }[] };
  type W = { stash(id: string, n?: number): void; coins(): number };
  type V = { setHour(h: number): void; setWeather(k: string): void; goTo(id: string): unknown; focused(): { id: string } | null; villager(id: string): { inside: boolean } | null; requests(step?: string): unknown; ctx: { services: Map<string, unknown> } };
  const v = <T>(fn: (v: V) => T) => page.evaluate((src) => new Function('v', `return (${src})(v)`)((window as unknown as { __valley: V }).__valley), fn.toString()) as Promise<Awaited<T>>;
  const standBy = async (id: string) => {
    await expect.poll(() => v(new Function('x', `return x.villager('${id}')?.inside`) as (x: V) => boolean), { timeout: 30_000 }).toBe(false);
    await expect.poll(async () => { await v(new Function('x', `x.goTo('${id}')`) as (x: V) => void); return v((x) => x.focused()?.id ?? ''); }, { timeout: 20_000 }).toBe(id);
  };
  await page.evaluate(() => { (window as unknown as { __hud: { dismissHint(): void } }).__hud.dismissHint(); });
  await v((x) => { x.setHour(12); x.setWeather('clear'); });
  // the request tracker is up under the dock with today's 1–3 requests
  await expect(page.getByTestId('quests')).toBeVisible();
  const n = await v((x) => (x.ctx.services.get('friends') as Fr).requests().length);
  expect(n).toBeGreaterThanOrEqual(1);
  // a hazelnut in the basket; F on Hazel opens the gift picker, 1 gives the first thing (she loves hazelnuts)
  await v((x) => (x.ctx.services.get('wallet') as W).stash('hazelnut', 1));
  await standBy('villager:hazel');
  await page.keyboard.press('KeyF');
  const panel = page.getByTestId('panel-friends');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('friends-give')).toContainText('A gift for Hazel');
  await page.keyboard.press('Digit1');
  await expect(panel).toBeHidden();
  await expect.poll(() => v((x) => (x.ctx.services.get('friends') as Fr).view('hazel')?.known.hazelnut)).toBe('love');
  // a request: done (dev), then E on whoever posted it hands it over for bits and hearts
  await v((x) => x.requests('ready'));
  const who = await v((x) => (x.ctx.services.get('friends') as Fr).requests()[0].req.who);
  await expect(page.getByTestId('quests').locator('.q.ready').first()).toBeVisible();
  const before = await v((x) => (x.ctx.services.get('wallet') as W).coins());
  await standBy(who);
  await page.keyboard.press('KeyE');
  await expect.poll(() => v((x) => (x.ctx.services.get('friends') as Fr).requests()[0].done)).toBe(true);
  expect(await v((x) => (x.ctx.services.get('wallet') as W).coins())).toBeGreaterThan(before);
  await expect(page.getByTestId('quests').locator('.q.done')).toHaveCount(1);
  // the noticeboard pins them too
  await page.keyboard.press('KeyB');
  await expect(page.getByTestId('cork')).toContainText('Requests');
  expect(errors).toEqual([]);
});

test('the farmhouse: E on the door walks in, the room has its own interactables, E on the inside door steps out', async ({ page, demoServer }) => {
  test.slow(); // software rendering
  const errors = await openValley(page, demoServer.origin, demoServer.token);
  type V = { inside(view: string | false): boolean; look(x: number, y: number, z: number): void; focused(): { id: string } | null; ctx: { services: Map<string, unknown> } };
  const v = <T>(fn: (v: V) => T) => page.evaluate((src) => new Function('v', `return (${src})(v)`)((window as unknown as { __valley: V }).__valley), fn.toString()) as Promise<Awaited<T>>;
  const active = () => v((x) => (x.ctx.services.get('indoors') as { active: boolean }).active);
  await page.evaluate(() => { (window as unknown as { __hud: { dismissHint(): void } }).__hud.dismissHint(); });
  // stand on the porch (inside(false) from outdoors just puts you there) and face the front door
  await v((x) => { x.inside('door'); x.inside(false); });
  expect(await active()).toBe(false);
  await v((x) => x.look(0, 2.8, -17.15));
  await expect.poll(() => v((x) => x.focused()?.id ?? '')).toBe('farmhouse:door');
  await page.keyboard.press('KeyE');
  await expect.poll(active, { timeout: 15_000 }).toBe(true);
  // inside, only the room's things answer the crosshair
  await v((x) => x.look(0, 3.0, -17.15));
  await expect.poll(() => v((x) => x.focused()?.id ?? '')).toBe('interior:door');
  await page.keyboard.press('KeyE');
  await expect.poll(active, { timeout: 15_000 }).toBe(false);
  expect(errors).toEqual([]);
});

test('first-run welcome (?welcome=1): Posy\'s letter, a checklist ticked by real actions, the reward, replay from the menu', async ({ page, demoServer }) => {
  test.setTimeout(600_000); // software rendering, a long flow
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // automated browsers never see the welcome unless the page asks for it
  await page.goto(`${demoServer.origin}/?t=${demoServer.token}&quality=low&welcome=1`);
  await page.waitForFunction(() => window.__valley?.ready === true, null, { timeout: 30_000 });
  type W = { coins(): number; data(): { pieces: { id: string }[] } };
  type V = { villager(id: string): { inside: boolean } | null; goTo(id: string): void; focused(): { id: string } | null; setHour(h: number): void; setWeather(w: string): void;
    inside(view: string | false): boolean; ctx: { player: { yaw: number; pos: { x: number; z: number } }; services: Map<string, unknown> } };
  const v = <T>(fn: (v: V) => T) => page.evaluate((src) => new Function('v', `return (${src})(v)`)((window as unknown as { __valley: V }).__valley), fn.toString()) as Promise<Awaited<T>>;
  const step = (id: string) => page.locator(`[data-testid="onboarding"] [data-step="${id}"]`);

  // --- the letter, then the checklist ---
  const letter = page.getByTestId('panel-welcome');
  await expect(letter).toBeVisible({ timeout: 15_000 });
  await expect(letter).toContainText('farmer');
  await page.getByTestId('welcome-go').click();
  await expect(letter).toBeHidden();
  const list = page.getByTestId('onboarding');
  await expect(list).toBeVisible();
  await expect(list).toContainText('0/8');
  await expect(step('look')).toHaveClass(/cur/);
  await v((x) => { x.setHour(10); x.setWeather('clear'); });

  // --- look around (the camera turns) and walk (the player's own feet) ---
  // turn and step a little at a time from inside the page (the HUD samples the player at 4 Hz on a timer, not per frame)
  await v((x) => new Promise<void>((done) => { let i = 0; const t = setInterval(() => { x.ctx.player.yaw += 0.35; if (++i >= 8) { clearInterval(t); done(); } }, 280); }));
  await expect(step('look')).toHaveClass(/done/, { timeout: 20_000 });
  await v((x) => new Promise<void>((done) => { let i = 0; const t = setInterval(() => { x.ctx.player.pos.x += 0.7; if (++i >= 12) { clearInterval(t); done(); } }, 280); }));
  await expect(step('walk')).toHaveClass(/done/, { timeout: 20_000 });

  // --- talk to a villager (E on Posy) ---
  await expect.poll(() => v((x) => x.villager('villager:posy')?.inside), { timeout: 30_000 }).toBe(false);
  // stand in front of her once, then wait for the crosshair to find her (frames are slow in software rendering)
  await v((x) => x.goTo('villager:posy'));
  await expect.poll(() => v((x) => x.focused()?.id ?? ''), { timeout: 60_000 }).toBe('villager:posy');
  await page.keyboard.press('KeyE');
  await expect(step('talk')).toHaveClass(/done/, { timeout: 20_000 });
  await page.waitForTimeout(1500); // her shortcut opens a beat later
  await page.evaluate(() => (window as unknown as { __hud: { close(): void } }).__hud.close());

  // --- a terminal from the dock, then an answer from the needs-you strip ---
  await page.keyboard.press('Control+Backquote');
  await expect(page.getByTestId('drawer')).toBeVisible();
  await page.keyboard.press('Control+Backquote');
  await expect(page.getByTestId('drawer')).toBeHidden();
  await expect(step('terminal')).toHaveClass(/done/, { timeout: 20_000 });
  // answer from the mailbox's Needs you tab (1 answers the selected ask)
  await page.keyboard.press('j');
  await expect(page.getByTestId('mail-tab-needs')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('1');
  await expect(page.getByTestId('toasts')).toContainText(/Answered/i);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('panel-mailbox')).toBeHidden();
  await expect(step('answer')).toHaveClass(/done/, { timeout: 20_000 });

  // --- the map and the ledger (keys) ---
  await page.keyboard.press('m');
  await expect(page.getByTestId('panel-map')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('panel-map')).toBeHidden();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('panel-roster')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('panel-roster')).toBeHidden();
  await expect(step('map')).toHaveClass(/done/, { timeout: 20_000 });
  await expect(step('ledger')).toHaveClass(/done/, { timeout: 20_000 });
  await expect(list).toContainText('7/8');

  // --- a pastime: step into the farmhouse; the last tick pays bits, a welcome sign for the yard and Posy's letter ---
  const before = await v((x) => (x.ctx.services.get('wallet') as W).coins());
  await v((x) => x.inside('door'));
  await expect(list).toBeHidden({ timeout: 10_000 });
  await v((x) => x.inside(false));
  await expect(page.getByTestId('toasts')).toContainText(/Welcome tour complete/);
  // (+50 for the tour; real agent work may pay a few bits meanwhile)
  expect(await v((x) => (x.ctx.services.get('wallet') as W).coins())).toBeGreaterThanOrEqual(before + 50);
  expect(await v((x) => (x.ctx.services.get('wallet') as W).data().pieces.some((p) => p.id === 'welcome'))).toBe(true);
  await page.keyboard.press('j');
  await expect(page.getByTestId('panel-mailbox')).toBeVisible();
  await page.getByTestId('mail-tab-all').click();
  await expect(page.getByTestId('letters')).toContainText('Welcome home');
  await page.keyboard.press('Escape');

  // --- replay from the pause menu; skipping closes it without a checklist ---
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('panel-pause')).toBeVisible();
  await page.getByTestId('pause-replay').click();
  await expect(letter).toBeVisible();
  await page.getByTestId('welcome-skip').click();
  await expect(letter).toBeHidden();
  await expect(list).toBeHidden();
  // a tip shows in the same corner and is dismissable
  // (held for a few minutes: frames crawl in software rendering and tips fade on their own after 16 s)
  await page.evaluate(() => (window as unknown as { __hud: { tour: { tip(id: string, ms?: number): boolean } } }).__hud.tour.tip('rain', 300_000));
  await expect(page.getByTestId('onb-tip')).toContainText('Fish bite better in the rain');
  await page.getByTestId('onb-tip-close').dispatchEvent('click');
  await expect(page.getByTestId('onb-tip')).toBeHidden();
  expect(errors).toEqual([]);
});

test('the welcome stays out of automated runs without ?welcome=1', async ({ page, demoServer }) => {
  const errors = await openValley(page, demoServer.origin, demoServer.token);
  await page.waitForTimeout(2500);
  await expect(page.getByTestId('panel-welcome')).toBeHidden();
  await expect(page.getByTestId('onboarding')).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { __hud: { current(): string | null } }).__hud.current())).toBeNull();
  expect(errors).toEqual([]);
});
