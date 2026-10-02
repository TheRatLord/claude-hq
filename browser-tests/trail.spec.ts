import { test, expect } from './server.ts';

interface TrailHandle { view(i?: number): void; readonly viewing: boolean; target(): string | null; stones(): number }
type V = { ready: boolean; ctx: { services: Map<string, unknown>; camera: { fov: number } } };

test.describe.configure({ timeout: 120_000 });

test('summit trail: the valley viewer zooms onto farmers, cycles them with the arrows, E steps back', async ({ page, demoServer }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${demoServer.origin}/?t=${demoServer.token}&quality=low&pose=summit`);
  await page.waitForFunction(() => (window as unknown as { __valley?: V }).__valley?.ready === true, null, { timeout: 60_000 });
  const trail = () => page.evaluate(() => {
    const t = (window as unknown as { __valley: V }).__valley.ctx.services.get('trail') as TrailHandle;
    return { viewing: t.viewing, target: t.target(), fov: (window as unknown as { __valley: V }).__valley.ctx.camera.fov };
  });
  await page.evaluate(() => ((window as unknown as { __valley: V }).__valley.ctx.services.get('trail') as TrailHandle).view(0));
  await expect.poll(async () => (await trail()).viewing).toBe(true);
  const first = (await trail()).target;
  expect(first).not.toBeNull();
  await expect.poll(async () => (await trail()).fov, { timeout: 20_000 }).toBeLessThan(25);
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await trail()).target).not.toBe(first);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await trail()).target).toBe(first);
  await page.keyboard.press('e');
  await expect.poll(async () => (await trail()).viewing).toBe(false);
  await expect.poll(async () => (await trail()).fov).toBe(62);
  expect(errors).toEqual([]);
});
