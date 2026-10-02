import { test, expect } from './server.ts';

/**
 * The walk-in barn (scene/interior/barn.ts): E on the big door fades you inside, only the barn's things answer the
 * crosshair, the chores run through the real E key (hay → Daisy, milk into the basket, grain → the hens, eggs from
 * the nests, hay for Pepper and the sheep), feeding everyone inks "Barn chores", and E on the big door steps back out.
 */
interface Vec { x: number; y: number; z: number }
interface It { id: string; verb: string; pos(out: Vec): Vec; enabled?(): boolean }
type V = {
  ready: boolean;
  inside(view: string | false): boolean;
  look(x: number, y: number, z: number): void;
  focused(): { id: string } | null;
  stamps(): { stamps: { id: string; earned: boolean }[] };
  ctx: { player: { pos: Vec; frozen: boolean }; interact: { all(): Iterable<It> }; services: Map<string, unknown> };
};
type W = { __valley: V };

test.describe.configure({ timeout: 180_000 });

test('the barn: E on the big door walks in, chores through E (feed, milk, eggs) ink a stamp, E on the door steps out', async ({ page, demoServer }) => {
  test.slow(); // software rendering
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // closing a panel re-locks the pointer, and under pointer lock headless Chromium sends a mousemove every frame,
  // which cancels the scripted look (and releasing it opens the pause menu): no pointer lock in this test
  await page.addInitScript(() => { HTMLCanvasElement.prototype.requestPointerLock = function () { return Promise.resolve(); } as never; });
  await page.goto(`${demoServer.origin}/?t=${demoServer.token}&quality=low&hour=10&weather=clear`);
  await page.waitForFunction(() => (window as unknown as W).__valley?.ready === true, null, { timeout: 60_000 });
  await page.evaluate(() => { (window as unknown as { __hud?: { dismissHint(): void } }).__hud?.dismissHint(); });

  const v = <T>(fn: (v: V, a: unknown) => T, arg?: unknown) =>
    page.evaluate(([src, a]) => new Function('v', 'a', `return (${src})(v, a)`)((window as unknown as W).__valley, a), [fn.toString(), arg] as const) as Promise<Awaited<T>>;
  const indoors = () => v((x) => { const s = x.ctx.services.get('indoors') as { active: boolean; room?: string }; return s.active ? s.room ?? '?' : ''; });
  const barn = () => v((x) => (x.ctx.services.get('barn') as { data(): { fed: string[]; milked: boolean; total: { days: number } } }).data());
  const basket = (id: string) => v((x, a) => (x.ctx.services.get('wallet') as { data(): { basket: Record<string, number> } }).data().basket[a as string] ?? 0, id);
  /** aim the crosshair at an interactable (by id) until it is the focused one, then press E */
  const use = async (id: string, verb?: string) => {
    await expect.poll(() => v((x, a) => {
      for (const i of x.ctx.interact.all()) if (i.id === a) { const p = i.pos({ x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; } } as Vec); x.look(p.x, p.y, p.z); return x.focused()?.id ?? ''; }
      return 'missing';
    }, id), { timeout: 15_000 }).toBe(id);
    if (verb) expect(await v((x, a: unknown) => { for (const i of x.ctx.interact.all()) if (i.id === a) return i.verb; return ''; }, id)).toBe(verb);
    // the HUD's prompt (which E acts on) catches up on its next frames
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r())))));
    await page.keyboard.press('KeyE');
  };

  // --- outside: stand in the yard before the big door (inside + out puts you there) and use it ---
  await v((x) => { x.inside('barn'); x.inside(false); });
  expect(await indoors()).toBe('');
  await use('barn:door');
  await expect.poll(indoors, { timeout: 15_000 }).toBe('barn');

  // --- Daisy: hay from the pile, feed, then milk into the basket ---
  await v((x) => x.inside('barn:cow'));
  await use('interior:barn:hay', 'Grab');
  await use('interior:barn:cow', 'Feed');
  await expect.poll(async () => (await barn()).fed).toContain('cow');
  await use('interior:barn:cow', 'Milk');
  await expect.poll(() => basket('milk')).toBe(1);

  // --- Pepper and the sheep: hay again ---
  await v((x) => x.inside('barn:donkey'));
  await use('interior:barn:hay', 'Grab');
  await use('interior:barn:donkey', 'Feed');
  await expect.poll(async () => (await barn()).fed).toContain('donkey');
  await use('interior:barn:hay', 'Grab');
  await v((x) => x.inside('barn:sheep'));
  await use('interior:barn:sheep', 'Feed');
  await expect.poll(async () => (await barn()).fed).toContain('sheep');

  // --- the hens: a scoop of grain, then the eggs from the nest boxes ---
  await use('interior:barn:grain', 'Scoop');
  await v((x) => x.inside('barn:hens'));
  await use('interior:barn:hens', 'Feed');
  await expect.poll(async () => (await barn()).fed).toContain('hens');
  expect((await barn()).total.days).toBe(1);
  await v((x) => x.inside('barn:coop'));
  await use('interior:barn:nests', 'Collect');
  await expect.poll(() => basket('egg')).toBeGreaterThanOrEqual(2);
  await expect.poll(() => v((x) => x.stamps().stamps.find((s) => s.id === 'barn-chores')?.earned ?? false), { timeout: 15_000 }).toBe(true);

  // --- the machine room's panel opens the system stats ---
  await v((x) => x.inside('barn:panel'));
  await use('interior:barn:panel', 'Read');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __hud: { current(): string | null } }).__hud.current())).toBe('stats');
  await page.keyboard.press('Escape');
  await expect.poll(() => v((x) => x.ctx.player.frozen)).toBe(false);

  // --- back out through the big door ---
  await v((x) => x.inside('barn:door'));
  await use('interior:barn:door', 'Go outside');
  await expect.poll(indoors, { timeout: 15_000 }).toBe('');
  expect(errors).toEqual([]);
});
