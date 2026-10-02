import { test, expect } from './server.ts';

/**
 * The visitors (model/visitors.ts, scene/visitors, hud/visitors.ts, docs/valley/visitors.md): the travelling merchant
 * is forced in (`__valley.visitors('merchant', 'here')`), his cart parks off the square, the crosshair finds him or his
 * cart and E opens his panel; a decor piece bought there lands in the yard (a placed piece in the wallet), the lure (when
 * he has one today) raises the rare-fish odds, the panel is keyboard-reachable, and everything survives a reload.
 */
interface StockRow { id: string; kind: string; price: number; lock: string }
interface Status {
  day: string;
  open: boolean;
  here: { id: string; x: number; z: number; settled: boolean }[];
  stock: StockRow[];
  data: { bought: Record<string, number>; lure: string | null; maps: string[]; met: string[]; total: number } | null;
}
type VS = (cmd?: string, a?: string | number) => unknown;
type V = {
  ready: boolean;
  visitors: VS;
  coins(n?: number): number;
  interact(): void;
  focused(): { id: string; verb: string; label: string } | null;
  ctx: { services: Map<string, unknown> };
};
type Wallet = { data(): { pieces: { uid: string; id: string; slot: unknown }[] } };
type VSvc = { fishBoost(day: string): number };
type W = { __valley: V };

test.describe.configure({ timeout: 180_000 });

const boot = async (page: import('@playwright/test').Page, origin: string, token: string) => {
  await page.goto(`${origin}/?t=${token}&quality=low&hour=11&weather=clear`);
  await page.waitForFunction(() => (window as unknown as W).__valley?.ready === true, null, { timeout: 60_000 });
};

test('visitors: the merchant parks, sells a decor piece that lands in the yard, and it is remembered', async ({ page, demoServer }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await boot(page, demoServer.origin, demoServer.token);
  const st = () => page.evaluate(() => (window as unknown as W).__valley.visitors() as Status);
  await page.evaluate(() => (window as unknown as W).__valley.visitors('reset'));

  // force him in, settled: the cart parks and he trades
  expect(await page.evaluate(() => (window as unknown as W).__valley.visitors('merchant', 'here'))).toBe(true);
  await expect.poll(async () => (await st()).open, { timeout: 8_000 }).toBe(true);
  const s0 = await st();
  expect(s0.here.some((p) => p.id === 'merchant')).toBe(true);
  expect(s0.stock.length).toBeGreaterThanOrEqual(2);
  const decor = s0.stock.find((e) => e.kind === 'decor')!;
  expect(decor).toBeTruthy();

  // walk up: the crosshair finds him or the cart; E opens his panel
  expect(await page.evaluate(() => (window as unknown as W).__valley.visitors('go', 'merchant'))).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__valley.focused()?.id ?? ''), { timeout: 6_000 })
    .toMatch(/^visitor:(merchant|cart)$/);
  await page.screenshot({ path: info.outputPath('visitors-cart.png') });
  await page.evaluate(() => (window as unknown as W).__valley.interact());
  const panel = page.getByTestId('panel-visitors');
  await expect(panel, 'the cart (Browse) or Barnaby (Talk to, then his wares) opens the panel').toBeVisible({ timeout: 4_000 });
  await expect(page.getByTestId('visitor-tab-merchant')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('visitor-stock')).toBeVisible();

  // too poor: the button says so in words, not colour alone
  const buy = page.getByTestId(`visitor-buy-${decor.id}`);
  const coins = await page.evaluate(() => (window as unknown as W).__valley.coins(0));
  if (coins < decor.price) {
    await expect(buy).toBeDisabled();
    await expect(page.getByTestId(`visitor-item-${decor.id}`)).toContainText(/Not enough bits/);
  }
  await page.evaluate(() => (window as unknown as W).__valley.coins(1000));
  await expect(buy).toBeEnabled();
  // keyboard reachable: the buy button takes focus
  await buy.focus();
  await expect(buy).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('visitor-msg')).not.toBeEmpty();
  await expect(buy).toContainText('Sold');
  await page.screenshot({ path: info.outputPath('visitors-panel.png') });

  // it landed in the yard: a placed piece of that decor in the wallet
  const placed = () => page.evaluate((id) => {
    const w = (window as unknown as W).__valley.ctx.services.get('wallet') as Wallet;
    return w.data().pieces.filter((p) => p.id === id && p.slot !== null).length;
  }, decor.id);
  expect(await placed()).toBe(1);
  const s1 = await st();
  expect(s1.data!.bought[`${s1.day}|${decor.id}`]).toBe(1);
  expect(s1.stock.find((e) => e.id === decor.id)!.lock).toMatch(/bought|owned/);

  // the lure (when he carries one today): rarer fish for the rest of the day
  const lure = s1.stock.find((e) => e.id === 'lure');
  if (lure) {
    await page.getByTestId('visitor-buy-lure').click();
    const boost = await page.evaluate((day) => ((window as unknown as W).__valley.ctx.services.get('visitors') as VSvc).fishBoost(day), s1.day);
    expect(boost).toBeGreaterThan(1);
  }

  // the painter's tab is one keypress away
  await page.getByTestId('visitor-tab-merchant').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('visitor-tab-painter')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  // everything survives a reload: the purchase, the piece in the yard
  await boot(page, demoServer.origin, demoServer.token);
  const s2 = await st();
  expect(s2.data!.bought[`${s2.day}|${decor.id}`]).toBe(1);
  expect(s2.data!.met).toContain('merchant');
  expect(await placed()).toBe(1);
  if (lure) expect(s2.data!.lure).toBe(s2.day);

  await page.evaluate(() => (window as unknown as W).__valley.visitors('reset'));
  await page.evaluate(() => (window as unknown as W).__valley.visitors('calendar'));
  expect(errors).toEqual([]);
});
