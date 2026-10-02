import { test, expect } from './server.ts';

/**
 * The day timeline (model/timeline.ts, hud/timeline.ts): the demo valley seeds a plausible morning per farmer, the
 * ledger shows a mini strip per farmer row, the farmer card a "Today" section with stats, a hoverable day strip and the
 * key moments; live recording carries on from there.
 */
type Summary = { spans: number; marks: number; active: number; ships: number; first: number | null };
type V = { ready: boolean; timeline(id?: string, step?: string): unknown };

test.describe.configure({ timeout: 120_000 });

test('day timeline: ledger strips for every farmer, the card\'s Today section, hover, live recording', async ({ page, demoServer }) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${demoServer.origin}/?t=${demoServer.token}&quality=low`);
  await page.waitForFunction(() => (window as unknown as { __valley?: V }).__valley?.ready === true, null, { timeout: 60_000 });

  // the demo seeded a morning for every farmer
  const all = await page.evaluate(() => (window as unknown as { __valley: V }).__valley.timeline() as Summary[]);
  expect(all.length).toBeGreaterThan(10);
  expect(all.every((s) => s.spans > 3 && s.active > 0 && s.first !== null)).toBe(true);
  expect(all.reduce((n, s) => n + s.ships, 0)).toBeGreaterThan(3);

  // --- ledger: one painted mini strip per farmer row ---
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('panel-roster')).toBeVisible();
  const strips = page.getByTestId('roster-day');
  await expect(strips).toHaveCount(all.length);
  const painted = await strips.evaluateAll((els) => els.filter((e) => (e as HTMLElement).style.backgroundImage.includes('linear-gradient')).length);
  expect(painted).toBe(all.length);
  await expect(strips.first()).toHaveAttribute('title', /active/);
  // strips line up (same x and width in every row) so days compare at a glance
  const boxes = await strips.evaluateAll((els) => els.slice(0, 6).map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width)]; }));
  expect(new Set(boxes.map((b) => b.join(','))).size).toBe(1);

  // --- the card (Ctrl+I on the selected row): Today stats, the strip, key moments ---
  const row = page.locator('[data-testid="roster-row"][data-status="working"]').first();
  const id = await row.getAttribute('data-id');
  await row.click();
  await page.keyboard.press('Control+i');
  const card = page.getByTestId('panel-card');
  await expect(card).toBeVisible();
  const day = card.getByTestId('card-day');
  await expect(day).toBeVisible();
  const mine = await page.evaluate((x) => ((window as unknown as { __valley: V }).__valley.timeline(x!) as { summary: Summary & { passes: number; fails: number } }).summary, id);
  await expect(day.getByTestId('day-ships').locator('b')).toHaveText(String(mine.ships));
  await expect(day.getByTestId('day-tests').locator('b')).toHaveText(String(mine.passes + mine.fails));
  await expect(day.getByTestId('day-active').locator('b')).toHaveText(/\d+[hm]/);
  const strip = day.getByTestId('day-strip');
  await expect(strip).toHaveAttribute('aria-label', /active/);
  await expect(day.getByTestId('day-moments').locator('li').first()).toHaveText(/\d\d:\d\d/);
  await expect(day.getByTestId('day-moments')).toContainText('started work');

  // hover: one tooltip naming the span under the pointer
  await strip.scrollIntoViewIfNeeded();
  const box = await strip.boundingBox();
  if (!box) throw new Error('day strip has no box');
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
  const tip = strip.locator('.tip');
  await expect(tip).toHaveClass(/on/);
  await expect(tip).toHaveText(/\d\d:\d\d/);
  await page.mouse.move(box.x + box.width * 0.6, box.y - 120);
  await expect(tip).not.toHaveClass(/on/);

  // live recording: a cleared day fills again from the farmer's current job
  await page.evaluate((x) => (window as unknown as { __valley: V }).__valley.timeline(x!, 'clear'), id);
  await expect(day.getByTestId('day-moments')).toContainText(/Nothing to report|started work/);
  await expect.poll(() => page.evaluate((x) => ((window as unknown as { __valley: V }).__valley.timeline(x!) as { day: { spans: unknown[] } }).day.spans.length, id)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
