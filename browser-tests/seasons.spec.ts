import { test, expect } from './server.ts';

/**
 * Seasonal pastimes (scene/seasons, docs/valley/seasons.md): the rowboat (climb in, row with the oars, the wake, out to
 * the middle where the rare fish are, step out at the dock, "First row"), skating on the frozen pond (onto the ice,
 * a figure eight, "Figure eight") and snowmen (roll, stack, decorate, "Snow friend", persisted for the day, melting
 * with the snow).
 */
interface BoatState { mode: string; x: number; z: number; speed: number; rowed: number; active: number; boost: number }
interface SkateState { on: boolean; speed: number; eights: number; ice: number }
interface SnowState { carrying: number | null; snowy: boolean; snowmen: { balls: number[]; decor: Record<string, string>; friend: boolean }[]; trail: number }
type V = {
  ready: boolean;
  boat(cmd?: string, a?: number): BoatState | string;
  skate(cmd?: string, a?: number): SkateState | string;
  snowman(cmd?: string, a?: number): SnowState | string;
  atmo(o: Record<string, number> | null): unknown;
  setSeason(s: string | null): void;
  stamps(): { stamps: { id: string; earned: boolean }[] };
  perf(): { calls: number };
  ctx: { services: Map<string, unknown>; player: { pos: { x: number; y: number; z: number } } };
};
type W = { __valley: V };

test.describe.configure({ timeout: 150_000 });

const boot = async (page: import('@playwright/test').Page, origin: string, token: string, q: string) => {
  await page.goto(`${origin}/?t=${token}&quality=low&${q}`);
  await page.waitForFunction(() => (window as unknown as W).__valley?.ready === true, null, { timeout: 60_000 });
};
const stamped = (page: import('@playwright/test').Page, id: string) => page.evaluate((i) => (window as unknown as W).__valley.stamps().stamps.find((s) => s.id === i)?.earned ?? false, id);

test('rowboat: climb in at the dock, row out (oars, wake), better fishing in the middle, step out; First row', async ({ page, demoServer }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await boot(page, demoServer.origin, demoServer.token, 'pose=dock&hour=10&weather=clear&season=summer');
  const boat = (cmd?: string, a?: number) => page.evaluate(([c, n]) => (window as unknown as W).__valley.boat(c as string | undefined, n as number | undefined), [cmd, a] as const);
  expect((await boat() as BoatState).mode).toBe('moored');

  await boat('in');
  expect((await boat() as BoatState).mode).toBe('aboard');
  expect(await page.evaluate(() => !!((window as unknown as W).__valley.ctx.services.get('controller') as { riding: unknown }).riding)).toBe(true);
  // row a while: she moves, the oars come out, the wake spreads behind
  await boat('row', 6);
  await expect.poll(async () => (await boat() as BoatState).rowed, { timeout: 20_000 }).toBeGreaterThan(3);
  const s = await boat() as BoatState;
  expect(s.active).toBeGreaterThan(0.5);
  expect(s.speed).toBeGreaterThan(0.3);
  await expect.poll(() => page.evaluate(() => ((window as unknown as W).__valley.ctx.services.get('seasons') !== undefined)), { timeout: 5_000 }).toBe(true);
  // the camera rides with her: the player stands in the boat, on the water
  const y = await page.evaluate(() => (window as unknown as W).__valley.ctx.player.pos.y);
  expect(y).toBeGreaterThan(-1.2);
  expect(y).toBeLessThan(-0.7);

  // out in the middle the rarer fish are likelier (forage asks the 'rowboat' service)
  const mid = await boat('middle') as BoatState;
  expect(mid.boost).toBeGreaterThan(2);
  expect(await page.evaluate(() => ((window as unknown as W).__valley.ctx.services.get('rowboat') as { fishBoost(x: number, z: number): number }).fishBoost(41, 45))).toBeGreaterThan(2);

  // more rowing inks "First row"
  await boat('row', 8);
  await expect.poll(() => stamped(page, 'first-row'), { timeout: 25_000 }).toBe(true);

  // step out at the dock: back on the planks, she drifts home to her mooring
  await boat('out');
  expect(['return', 'moored']).toContain((await boat() as BoatState).mode);
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__valley.ctx.player.pos.y), { timeout: 5_000 }).toBeGreaterThan(-0.5);
  expect(await page.evaluate(() => ((window as unknown as W).__valley.ctx.services.get('rowboat') as { fishBoost(x: number, z: number): number }).fishBoost(41, 45))).toBe(1);
  await expect.poll(async () => (await boat() as BoatState).mode, { timeout: 20_000 }).toBe('moored');
  expect(errors).toEqual([]);
});

test('winter: the pond freezes, skate a figure eight (Figure eight); roll, stack and dress a snowman (Snow friend), kept for the day, melting with the snow', async ({ page, demoServer }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await boot(page, demoServer.origin, demoServer.token, 'pose=hub&hour=11&weather=snow&season=winter');
  await page.evaluate(() => (window as unknown as W).__valley.atmo({ snow: 1 }));
  const skate = (cmd?: string, a?: number) => page.evaluate(([c, n]) => (window as unknown as W).__valley.skate(c as string | undefined, n as number | undefined), [cmd, a] as const);
  const snow = (cmd?: string, a?: number) => page.evaluate(([c, n]) => (window as unknown as W).__valley.snowman(c as string | undefined, n as number | undefined), [cmd, a] as const);

  // the ice, the boat put away
  await expect.poll(async () => (await skate() as SkateState).ice, { timeout: 10_000 }).toBe(1);
  expect((await page.evaluate(() => (window as unknown as W).__valley.boat()) as BoatState).mode).toBe('winter');
  expect(await page.evaluate(() => (window as unknown as W).__valley.boat('in'))).toContain('winter');

  // snowmen (at the square): roll a ball and set it down as a base, then build a whole dressed one
  await snow('reset');
  await snow('roll', 0.55);
  expect((await snow() as SnowState).carrying).toBeGreaterThan(0.5);
  await snow('place');
  let st = await snow() as SnowState;
  expect(st.carrying).toBeNull();
  expect(st.snowmen.length).toBe(1);
  await page.evaluate(() => (window as unknown as W).__valley.ctx.services.get('controller') as unknown);
  await page.evaluate(() => { const v = (window as unknown as W).__valley as unknown as { teleport(x: number, z: number, yaw: number, p: number): void }; v.teleport(-6, 12, 0.6, -0.2); });
  await snow('build');
  st = await snow() as SnowState;
  expect(st.snowmen.length).toBe(2);
  expect(st.snowmen[1].balls.length).toBe(3);
  expect(st.snowmen[1].friend).toBe(true);
  expect(Object.keys(st.snowmen[1].decor).length).toBe(6);
  await expect.poll(() => stamped(page, 'snow-friend'), { timeout: 10_000 }).toBe(true);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('claude-valley.snowmen.v1') ?? '{}').list?.length)).toBe(2);

  // skating: onto the ice and a figure eight
  const on = await skate('on') as SkateState;
  expect(on.on).toBe(true);
  await skate('glide', 1.5);
  await expect.poll(async () => (await skate() as SkateState).speed, { timeout: 5_000 }).toBeGreaterThan(1);
  await skate('eight');
  await expect.poll(async () => (await skate() as SkateState).eights, { timeout: 30_000 }).toBeGreaterThan(0);
  await expect.poll(() => stamped(page, 'figure-eight'), { timeout: 10_000 }).toBe(true);
  await skate('off');
  expect((await skate() as SkateState).on).toBe(false);

  // the snowmen are still there after a reload (same day, snow lying)
  await page.reload();
  await page.waitForFunction(() => (window as unknown as W).__valley?.ready === true, null, { timeout: 60_000 });
  await page.evaluate(() => (window as unknown as W).__valley.atmo({ snow: 1 }));
  expect((await snow() as SnowState).snowmen.length).toBe(2);
  // the thaw: they melt
  await page.evaluate(() => (window as unknown as W).__valley.atmo({ snow: 0 }));
  await expect.poll(async () => (await snow() as SnowState).snowmen.length, { timeout: 25_000 }).toBe(0);
  expect(errors).toEqual([]);
});
