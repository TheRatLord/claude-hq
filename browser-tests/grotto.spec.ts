import { test, expect } from './server.ts';

/**
 * The secret grotto behind the waterfall (scene/grotto): the map shows only a "?" until you find it; stepping onto the
 * ledge behind the falling water discovers it (the "?" becomes a pin); walking into the mouth (the real W key) steps
 * you into the cave and inks the secret "Behind the curtain" stamp; E reads the explorer's journal and opens the hidden
 * chest (a geode lamp, a gift); E on the mouth steps back out behind the falls.
 */
interface Vec { x: number; y: number; z: number }
interface It { id: string; verb: string; pos(out: Vec): Vec }
interface GrottoState { discovered: boolean; inside: boolean; data: { found: number | null; visits: number; chest: number | null; pages: number } }
type V = {
  ready: boolean;
  grotto(where?: string): GrottoState | boolean | null;
  look(x: number, y: number, z: number): void;
  focused(): { id: string } | null;
  stamps(): { stamps: { id: string; earned: boolean }[] };
  perf(): { calls: number; frameErrors: number };
  ctx: { player: { pos: Vec }; interact: { all(): Iterable<It> }; services: Map<string, unknown> };
};
type W = { __valley: V; __hud: { open(id: string): void; close(): void; mapHits(): { id: string; kind: string; tip?: { title: string } }[]; dismissHint(): void } };

test.describe.configure({ timeout: 180_000 });

test('the grotto: a "?" on the map, found behind the falls, walk in, a secret stamp, the journal and the chest, back out', async ({ page, demoServer }) => {
  test.slow(); // software rendering
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // no pointer lock: headless Chromium would send a mousemove every frame and cancel the scripted look
  await page.addInitScript(() => { HTMLCanvasElement.prototype.requestPointerLock = function () { return Promise.resolve(); } as never; });
  await page.goto(`${demoServer.origin}/?t=${demoServer.token}&quality=low&hour=11&weather=clear`);
  await page.waitForFunction(() => (window as unknown as W).__valley?.ready === true, null, { timeout: 60_000 });
  await page.evaluate(() => { (window as unknown as W).__hud?.dismissHint(); });

  const v = <T>(fn: (v: V, a: unknown) => T, arg?: unknown) =>
    page.evaluate(([src, a]) => new Function('v', 'a', `return (${src})(v, a)`)((window as unknown as W).__valley, a), [fn.toString(), arg] as const) as Promise<Awaited<T>>;
  const state = () => v((x) => x.grotto() as GrottoState);
  const room = () => v((x) => { const s = x.ctx.services.get('indoors') as { active: boolean; room?: string }; return s.active ? s.room ?? '?' : ''; });
  const pin = async () => {
    await page.evaluate(() => (window as unknown as W).__hud.open('map'));
    // the falls are at the map's north edge: zoom right out, then drag the map down a little
    for (let i = 0; i < 4; i++) await page.keyboard.press('Minus');
    const box = await page.locator('canvas:visible').filter({ hasNot: page.locator('xx') }).last().boundingBox();
    if (box) { const x = box.x + box.width / 2, y = box.y + box.height / 2; await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y + 120, { steps: 6 }); await page.mouse.up(); }
    await expect.poll(() => page.evaluate(() => (window as unknown as W).__hud.mapHits().some((h) => h.id === 'poi:grotto'))).toBe(true);
    const title = await page.evaluate(() => (window as unknown as W).__hud.mapHits().find((h) => h.id === 'poi:grotto')?.tip?.title ?? '');
    await page.evaluate(() => (window as unknown as W).__hud.close());
    return title;
  };
  /** aim the crosshair at an interactable (by id) until it is the focused one, then press E */
  const use = async (id: string, verb?: string) => {
    await expect.poll(() => v((x, a) => {
      for (const i of x.ctx.interact.all()) if (i.id === a) { const p = i.pos({ x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; } } as Vec); x.look(p.x, p.y, p.z); return x.focused()?.id ?? ''; }
      return 'missing';
    }, id), { timeout: 15_000 }).toBe(id);
    if (verb) expect(await v((x, a: unknown) => { for (const i of x.ctx.interact.all()) if (i.id === a) return i.verb; return ''; }, id)).toBe(verb);
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r())))));
    await page.keyboard.press('KeyE');
  };

  // --- a secret: nothing found yet, the map (opened by the pool, so the falls are in view) shows a "?" there ---
  await v((x) => x.grotto('ledge'));
  await page.waitForTimeout(500);
  expect((await state()).discovered).toBe(false);
  expect(await pin()).toBe('?');

  // --- the ledge behind the falls: stepping onto it finds the place, the "?" becomes a named pin ---
  await v((x) => x.grotto('curtain'));
  await expect.poll(async () => (await state()).discovered, { timeout: 15_000 }).toBe(true);
  expect(await pin()).toBe('Hidden grotto');

  // --- walk into the mouth (the real W key): into the cave ---
  await v((x) => x.grotto('mouth'));
  await page.keyboard.down('KeyW');
  await expect.poll(room, { timeout: 20_000 }).toBe('grotto');
  await page.keyboard.up('KeyW');
  await expect.poll(async () => (await state()).inside).toBe(true);
  expect((await state()).data.visits).toBe(1);
  await expect.poll(() => v((x) => x.stamps().stamps.find((s) => s.id === 'grotto')?.earned ?? false), { timeout: 15_000 }).toBe(true);
  // the whole cave in view stays a small scene
  await v((x) => x.grotto('inside'));
  await page.waitForTimeout(800);
  expect((await v((x) => x.perf())).calls).toBeLessThanOrEqual(25);

  // --- the explorer's camp: read the journal, then the chest behind the stalagmites ---
  await v((x) => x.grotto('camp'));
  await use('interior:grotto:journal', 'Read');
  await expect.poll(async () => (await state()).data.pages).toBe(1);
  await v((x) => x.grotto('chestside'));
  await use('interior:grotto:chest', 'Open');
  await expect.poll(async () => !!(await state()).data.chest).toBe(true);   // (when it was opened)
  expect(await v((x) => (x.ctx.services.get('wallet') as { data(): { pieces: { id: string }[] } }).data().pieces.some((p) => p.id === 'geode'))).toBe(true);

  // --- and E on the mouth steps back out behind the falls ---
  await v((x) => x.grotto('inside'));   // just inside the mouth
  await use('interior:grotto:mouth');
  await expect.poll(room, { timeout: 15_000 }).toBe('');
  const p = await v((x) => ({ x: x.ctx.player.pos.x, z: x.ctx.player.pos.z }));
  expect(Math.hypot(p.x + 24.6, p.z + 111.5)).toBeLessThan(4);
  expect((await v((x) => x.perf())).frameErrors).toBe(0);
  expect(errors).toEqual([]);
});
