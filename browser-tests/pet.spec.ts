import { test, expect } from './server.ts';

interface PetState { state: string; name: string; species: string; happy: number; stick: string; dist: number }
interface Today { pets: number; walk: number; fetch: number; finds: number }
type V = {
  ready: boolean;
  pet(cmd?: string, a?: string, b?: string): unknown;
  coins(n: number): number;
  teleport(x: number, z: number, yaw?: number, pitch?: number): void;
  inside(view?: string | false): unknown;
  ctx: { services: Map<string, unknown>; player: { pos: { x: number; z: number } } };
};

test.describe.configure({ timeout: 150_000 });

test('your own pet: adopt at the foundlings basket, it follows, catches up, fetches, is petted and curls up by the hearth', async ({ page, demoServer }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${demoServer.origin}/?t=${demoServer.token}&quality=low&pose=hub&hour=11&weather=clear`);
  await page.waitForFunction(() => (window as unknown as { __valley?: V }).__valley?.ready === true, null, { timeout: 60_000 });
  const pet = () => page.evaluate(() => (window as unknown as { __valley: V }).__valley.pet() as PetState | null);
  const today = () => page.evaluate(() => ((window as unknown as { __valley: V }).__valley.ctx.services.get('companion') as { model: { data(): { today: Today; pet: { name: string } | null } } }).model.data());

  // no pet yet: the basket is out, the adoption card offers it for the kibble fund (Fern doesn't know us yet)
  expect((await pet())?.state).toBe('off');
  await page.evaluate(() => { const v = (window as unknown as { __valley: V }).__valley; v.coins(200); });
  const before = await page.evaluate(() => (window as unknown as { __valley: V }).__valley.coins(0));
  await page.evaluate(() => (window as unknown as { __hud: { open(id: string): void } }).__hud.open('pet'));
  await expect(page.getByTestId('panel-pet')).toBeVisible();
  await expect(page.getByTestId('pet-species-fox')).toBeDisabled();
  await page.getByTestId('pet-species-kitten').click();
  await page.getByTestId('pet-coat-tuxedo').click();
  await page.getByTestId('pet-name').fill('  <b>miso</b>!! ');
  await page.getByTestId('pet-adopt').click();
  await expect(page.getByTestId('panel-pet')).toBeHidden();
  await expect.poll(async () => (await pet())?.name).toBe('Bmisob');
  expect((await pet())?.species).toBe('kitten');
  expect(await page.evaluate(() => (window as unknown as { __valley: V }).__valley.coins(0))).toBe(before - 60);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('claude-valley.pet.v1') ?? '{}').pet?.species)).toBe('kitten');

  // it runs over to you, then follows you on a walk
  await expect.poll(async () => (await pet())?.dist ?? 99, { timeout: 20_000 }).toBeLessThan(4);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(3500);
  await page.keyboard.up('KeyW');
  await expect.poll(async () => (await pet())?.dist ?? 99, { timeout: 15_000 }).toBeLessThan(5);
  // map travel: it catches up
  await page.evaluate(() => (window as unknown as { __valley: V }).__valley.teleport(30, 30, 0, -0.3));
  await expect.poll(async () => (await pet())?.dist ?? 99, { timeout: 10_000 }).toBeLessThan(6);

  // fetch: a throw, a chase, back at your feet; a pat
  await page.evaluate(() => (window as unknown as { __valley: V }).__valley.teleport(0, 6, Math.PI, -0.3));
  await page.waitForTimeout(800);
  await page.evaluate(() => (window as unknown as { __valley: V }).__valley.pet('puppy', 'golden', 'Pip'));
  await expect.poll(async () => (await pet())?.species).toBe('puppy');
  expect(await page.evaluate(() => (window as unknown as { __valley: V }).__valley.pet('fetch'))).toBe(true);
  await expect.poll(async () => (await today()).today.fetch, { timeout: 25_000 }).toBe(1);
  await page.evaluate(() => (window as unknown as { __valley: V }).__valley.pet('pet'));
  expect((await today()).today.pets).toBe(1);
  expect((await pet())?.happy).toBeGreaterThan(50);

  // indoors: it curls up on the hearth rug
  await page.evaluate(() => (window as unknown as { __valley: V }).__valley.inside('hearth'));
  await expect.poll(async () => (await pet())?.state).toBe('indoor');
  await page.evaluate(() => (window as unknown as { __valley: V }).__valley.inside(false));
  await expect.poll(async () => (await pet())?.state).not.toBe('indoor');

  // the card shows your pet's day
  await page.evaluate(() => (window as unknown as { __hud: { open(id: string): void } }).__hud.open('pet'));
  await expect(page.getByTestId('pet-rename')).toHaveValue('Pip');
  await expect(page.getByTestId('pet-hearts')).toBeVisible();
  expect(errors).toEqual([]);
});
