import { test, expect } from './server.ts';
import type { Page, TestInfo } from '@playwright/test';

/**
 * The photo album (docs/valley/album.md): photo mode's looks, frames, grid, name tags, self-timer and "say cheese";
 * pictures go into IndexedDB with their date, place, time of day, weather and who is in frame; the album panel (L)
 * edits captions, favourites, downloads framed PNGs and deletes; favourites hang on the farmhouse photo wall, and E on
 * a frame opens it in the album. The album survives a reload; without IndexedDB it keeps the session in memory.
 *
 * Artifacts (look at them: every look and frame must be lovely): the framed downloads and screenshots land in the
 * test's output folder (`npm run test:browser -- album --output scratch/pw-album`).
 */
interface Meta { id: string; place: string; who: { kind: string; id: string; name: string }[]; caption: string; fav: boolean; filter: string; frame: string; hour: number; weather: string; w: number; h: number }
interface Album { persistent: boolean; version: number; list(): Meta[]; get(id: string): Meta | null; update(id: string, p: { caption?: string; fav?: boolean }): Promise<boolean>; ready: Promise<void> }
interface Photo { on: boolean; toggle(on?: boolean): void; prefs(p?: Record<string, unknown>): Record<string, unknown>; snap(): Promise<Meta | null>; focus(): string | null; cheese(): unknown; inFrame(): { id: string; kind: string }[] }
type V = {
  ready: boolean; goTo(id: string, dist?: number): void; pet(cmd?: string, a?: string, b?: string): unknown; inside(view: string | false): unknown; teleport(x: number, z: number, yaw?: number, pitch?: number): void;
  state(): { farmers: Record<string, { tag: string }> };
  ctx: { services: Map<string, unknown>; interact: { all(): Iterable<{ id: string; label(): string; use(): void }> } };
};
type W = { __valley: V; __hud: { open(id: string, arg?: unknown): void; close(): void; current(): string | null } };

test.describe.configure({ timeout: 240_000 });

const album = (page: Page) => page.evaluate(async () => { const a = (window as unknown as W).__valley.ctx.services.get('album') as Album; await a.ready; return { persistent: a.persistent, list: a.list() }; });

async function save(page: Page, info: TestInfo, name: string, click: () => Promise<void>): Promise<string> {
  const dl = page.waitForEvent('download');
  await click();
  const d = await dl;
  const out = info.outputPath(`${name}.png`);
  await d.saveAs(out);
  return d.suggestedFilename();
}

test('album: looks, frames, say cheese and the timer; the album panel; the farmhouse photo wall; it persists', async ({ page, demoServer }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${demoServer.origin}/?t=${demoServer.token}&quality=high&pose=hub&hour=17.6&weather=clear`);
  await page.waitForFunction(() => (window as unknown as W).__valley?.ready === true, null, { timeout: 60_000 });
  expect(await album(page)).toEqual({ persistent: true, list: [] });

  // stand in front of a farmer and go into photo mode
  const fid = await page.evaluate(() => Object.keys((window as unknown as W).__valley.state().farmers)[0]);
  await page.evaluate((id) => (window as unknown as W).__valley.goTo(id, 4.2), fid);
  await page.waitForTimeout(600);
  await page.keyboard.press('KeyP');
  await expect(page.getByTestId('photo-bar')).toBeVisible();
  // keys: 2 = warm film, V = polaroid, G = grid, N = name tags
  await page.keyboard.press('Digit2');
  await page.keyboard.press('KeyV');
  await page.keyboard.press('KeyG');
  await page.keyboard.press('KeyN');
  await expect(page.getByTestId('photo-filter')).toContainText('Warm film');
  await expect(page.getByTestId('photo-frame')).toContainText('Polaroid');
  await expect(page.getByTestId('photo-grid')).toHaveClass(/on/);
  await expect(page.getByTestId('photo-tags')).toContainText('Name tags in');
  // the farmer is in frame; F focuses on them and says cheese
  await expect.poll(() => page.evaluate(() => ((window as unknown as W).__valley.ctx.services.get('photo') as Photo).inFrame().map((s) => s.id))).toContain(fid);
  await page.keyboard.press('KeyF');
  expect(await page.evaluate(() => !!((window as unknown as W).__valley.ctx.services.get('photo') as Photo).cheese())).toBe(true);
  await page.waitForTimeout(900);
  await page.screenshot({ path: info.outputPath('viewfinder-warm-polaroid-cheese.png') });
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('photo-saved')).toHaveClass(/go/);
  await expect.poll(async () => (await album(page)).list.length).toBe(1);
  const first = (await album(page)).list[0];
  expect(first.filter).toBe('warm');
  expect(first.frame).toBe('polaroid');
  expect(first.w).toBe(first.h);                    // a polaroid is square
  expect(first.who.map((w) => w.id)).toContain(fid);
  expect(first.place.length).toBeGreaterThan(3);
  expect(first.caption).toContain(first.who[0].name);
  expect(first.weather).toBe('clear');
  expect(Math.round(first.hour)).toBe(18);

  // every look and frame (saved through the API: same pipeline as Enter)
  const combos: [string, string][] = [['none', 'postcard'], ['sepia', 'none'], ['mono', 'polaroid'], ['dreamy', 'postcard'], ['tilt', 'none']];
  for (const [filter, frame] of combos) {
    const m = await page.evaluate(([f, fr]) => { const p = (window as unknown as W).__valley.ctx.services.get('photo') as Photo; p.prefs({ filter: f, frame: fr, tags: false }); return p.snap(); }, [filter, frame] as const);
    expect(m?.filter).toBe(filter);
    expect(m?.frame).toBe(frame);
  }
  // the self-timer: T → 3 s, Enter starts it, the countdown shows, the picture comes 3 s later
  await page.keyboard.press('KeyT');
  await expect(page.getByTestId('photo-timer')).toContainText('3 s');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  expect((await album(page)).list.length).toBe(6);
  expect(await page.evaluate(() => !!((window as unknown as W).__valley.ctx.services.get('photo') as Photo).cheese())).toBe(true);
  await expect.poll(async () => (await album(page)).list.length, { timeout: 20_000 }).toBe(7);   // the 3 s timer runs on frame time: slow under a loaded GPU
  await page.keyboard.press('KeyT'); await page.keyboard.press('KeyT');   // back to off (3 → 10 → off)
  await expect(page.getByTestId('photo-timer')).toContainText('off');

  // L leaves photo mode for the album
  await page.keyboard.press('KeyL');
  await expect(page.getByTestId('photo-bar')).toBeHidden();
  await expect(page.getByTestId('panel-album')).toBeVisible();
  await expect(page.getByTestId('album-photo')).toHaveCount(7);
  await page.waitForTimeout(400);
  await page.getByTestId('panel-album').screenshot({ path: info.outputPath('album-grid.png') });

  // open the first (warm polaroid): caption, favourite, download with the frame baked in
  await page.locator(`[data-testid="album-photo"][data-id="${first.id}"]`).click();
  await expect(page.getByTestId('album-print')).toBeVisible();
  await expect(page.getByTestId('album-who')).toContainText(first.who[0].name);
  await page.getByTestId('album-caption').fill('Golden hour with an old friend');
  await page.getByTestId('album-caption').press('Enter');
  await expect.poll(async () => (await album(page)).list.find((p) => p.id === first.id)?.caption).toBe('Golden hour with an old friend');
  await page.getByTestId('album-fav').click();
  await expect.poll(async () => (await album(page)).list.find((p) => p.id === first.id)?.fav).toBe(true);
  await page.waitForTimeout(300);
  await page.getByTestId('panel-album').screenshot({ path: info.outputPath('album-photo.png') });
  const name = await save(page, info, 'export-warm-polaroid', () => page.getByTestId('album-download').click());
  expect(name).toMatch(/^claude-valley-\d{8}-\d{6}.*\.png$/);
  // the rest of the looks, exported framed (and the favourites for the wall)
  for (const [filter, frame] of combos) {
    const id = (await album(page)).list.find((p) => p.filter === filter && p.frame === frame)!.id;
    await page.evaluate((i) => (window as unknown as W).__hud.open('album', i), id);
    await expect(page.getByTestId('album-print')).toBeVisible();
    await save(page, info, `export-${filter}-${frame}`, () => page.getByTestId('album-download').click());
    await page.getByTestId('album-fav').click();
    await expect.poll(async () => (await album(page)).list.find((p) => p.id === id)?.fav).toBe(true);
  }
  // ← / → step, Esc goes back to the scrapbook, delete asks twice
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('album-print')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('album-grid')).toBeVisible();
  await page.getByTestId('album-tab-fav').click();
  await expect(page.getByTestId('album-photo')).toHaveCount(6);
  await page.getByTestId('album-tab-all').click();
  const victim = (await album(page)).list.find((p) => !p.fav)!.id;
  await page.locator(`[data-testid="album-photo"][data-id="${victim}"]`).click();
  await page.getByTestId('album-delete').click();
  expect((await album(page)).list.length).toBe(7);
  await page.getByTestId('album-delete').click();
  await expect.poll(async () => (await album(page)).list.length).toBe(6);
  await page.evaluate(() => (window as unknown as W).__hud.close());

  // the farmhouse photo wall: favourites in the frames over the bed; E on one opens it in the album
  await page.evaluate(() => (window as unknown as W).__valley.inside('photos'));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: info.outputPath('photo-wall.png') });
  const frames = await page.evaluate(() => [...(window as unknown as W).__valley.ctx.interact.all()].filter((i) => i.id.startsWith('interior:photo:')).map((i) => i.label()));
  expect(frames.length).toBe(8);
  expect(frames.filter((l) => l === 'Favourite photo').length).toBe(6);
  await page.evaluate(() => [...(window as unknown as W).__valley.ctx.interact.all()].find((i) => i.id === 'interior:photo:0')!.use());
  await expect(page.getByTestId('panel-album')).toBeVisible();
  await expect(page.getByTestId('album-print')).toBeVisible();
  await page.evaluate(() => (window as unknown as W).__hud.close());
  await page.evaluate(() => (window as unknown as W).__valley.inside(false));

  // say cheese to a villager, with your pet along: they turn to the lens and pose
  await page.evaluate(() => { const v = (window as unknown as W).__valley; v.pet('puppy', 'golden', 'Pip'); v.goTo('villager:posy', 3.4); });
  await page.waitForTimeout(3500);
  await page.keyboard.press('KeyP');
  await page.evaluate(() => ((window as unknown as W).__valley.ctx.services.get('photo') as Photo).prefs({ filter: 'none', frame: 'none', grid: false, tags: false }));
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: info.outputPath('cheese-villager.png') });
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await album(page)).list.length).toBe(7);
  const posy = (await album(page)).list[0];
  expect(posy.who.some((w) => w.kind === 'villager')).toBe(true);
  await page.keyboard.press('KeyP');

  // it survives a reload (IndexedDB), captions and hearts included
  await page.reload();
  await page.waitForFunction(() => (window as unknown as W).__valley?.ready === true, null, { timeout: 60_000 });
  const after = await album(page);
  expect(after.list.length).toBe(7);
  expect(after.list.find((p) => p.id === first.id)?.caption).toBe('Golden hour with an old friend');
  expect(after.list.filter((p) => p.fav).length).toBe(6);
  expect(errors).toEqual([]);
});

test('album: without IndexedDB the album keeps the session in memory and says so', async ({ page, demoServer }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${demoServer.origin}/?t=${demoServer.token}&quality=low&pose=hub&hour=11&weather=clear&album=memory`);
  await page.waitForFunction(() => (window as unknown as W).__valley?.ready === true, null, { timeout: 60_000 });
  const m = await page.evaluate(async () => { const p = (window as unknown as W).__valley.ctx.services.get('photo') as Photo; p.toggle(true); const r = await p.snap(); p.toggle(false); return r; });
  expect(m).not.toBeNull();
  expect((await album(page)).persistent).toBe(false);
  await page.evaluate(() => (window as unknown as W).__hud.open('album'));
  await expect(page.getByTestId('album-memory')).toBeVisible();
  await expect(page.getByTestId('album-photo')).toHaveCount(1);
  // the pause menu has the album too
  await page.evaluate(() => (window as unknown as W).__hud.open('pause'));
  await page.getByTestId('pause-photo').click();
  await expect(page.getByTestId('panel-album')).toBeVisible();
  expect(errors).toEqual([]);
});
