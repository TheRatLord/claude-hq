import type { Page } from '@playwright/test';
import { test, expect } from './server.ts';

/**
 * Robustness of a valley left open all day (scripts/soak.ts is the long version): whatever is in localStorage the page
 * boots and every panel opens; midnight rolls the day over with the page open; a tab hidden for hours resumes without a
 * catch-up storm; a dropped socket reconnects under an open terminal; long / unicode / emoji names and status flapping
 * render. Every step must keep the console clean (no page errors, no console errors).
 */
type V = {
  ready: boolean;
  state(): { farmers: Record<string, { name: string }>; timeline: { day: string }; link: string };
  requests(): { id: string }[] | null;
  forage(): { id: string }[];
  force(id: string, patch: Record<string, unknown>): Promise<unknown>;
  perf(): { fps: number; frameErrors: number };
  ctx: { services: Map<string, unknown> };
};
type W = { __valley: V; __hud: { open(id: string, arg?: unknown): void; close(): void; openTerminal(id: string): void }; __clock: { jump(ms: number): void; now(): number } };

test.describe.configure({ timeout: 150_000 });

const KEYS = ['almanac', 'timeline', 'collection', 'wallet', 'friends', 'onboarding', 'stamps', 'pet', 'summit', 'grotto'].map((k) => `claude-valley.${k}.v1`)
  .concat(['valley.hud.prefs', 'valley.hud.mapLayers', 'valley.hud.greeted', 'valley.hud.read', 'valley.hud.quests', 'valley.hud.mapKey']);
const PANELS = ['map', 'mailbox', 'roster', 'almanac', 'collection', 'noticeboard', 'stats', 'friends', 'pet', 'pause'];

/** console errors / page errors from now on */
function watch(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  return errors;
}
const ready = (page: Page) => page.waitForFunction(() => (window as unknown as W).__valley?.ready === true, null, { timeout: 60_000 });

test('corrupt or old localStorage in every store: the valley boots and every panel opens', async ({ page, demoServer }) => {
  const errors = watch(page);
  const url = `${demoServer.origin}/?t=${demoServer.token}&quality=low&pose=hub&hour=10&weather=clear`;
  await page.goto(url);
  await ready(page);
  const variants: Record<string, string>[] = [
    Object.fromEntries(KEYS.map((k) => [k, '{not json'])),
    Object.fromEntries(KEYS.map((k) => [k, JSON.stringify({ v: 1, points: 'lots', days: 'x', farmers: [1], found: 'x', coins: -5, pieces: [{ uid: 'a' }], pts: [], steps: 7, earned: null, pet: { species: 'dragon', name: 7 }, stones: '9', minimap: 'yes', drawerH: 'big' })])),
    Object.fromEntries(KEYS.map((k) => [k, JSON.stringify([null, 1, 'x', { v: 2 }])])),
    Object.fromEntries(KEYS.map((k) => [k, JSON.stringify({ v: 0, day: '1999-01-01' })])),
  ];
  for (const v of variants) {
    await page.evaluate((v) => { localStorage.clear(); for (const [k, x] of Object.entries(v)) localStorage.setItem(k, x); }, v);
    await page.reload();
    await ready(page);
    for (const id of PANELS) {
      await page.evaluate((id) => (window as unknown as W).__hud.open(id), id);
      await page.waitForTimeout(150);
    }
    await page.evaluate(() => (window as unknown as W).__hud.close());
    expect((await page.evaluate(() => (window as unknown as W).__valley.perf().frameErrors))).toBe(0);
  }
  expect(errors).toEqual([]);
});

test('midnight with the page open, a tab hidden for hours, a dropped socket under a terminal', async ({ page, demoServer }) => {
  const errors = watch(page);
  // the page's clock (Date only: timers and frames run on the real clock) starts late in the evening and can jump
  const start = new Date(); start.setHours(23, 50, 0, 0);
  await page.addInitScript((t0) => {
    const RealDate = Date, r0 = RealDate.now();
    let offset = t0 - r0;
    const now = () => RealDate.now() + offset;
    class FakeDate extends RealDate { constructor(...a: unknown[]) { if (a.length === 0) super(now()); else super(...(a as [number])); } static override now() { return now(); } }
    (window as unknown as { Date: DateConstructor }).Date = FakeDate as unknown as DateConstructor;
    const sockets: WebSocket[] = [];
    const WS = window.WebSocket;
    window.WebSocket = class extends WS { constructor(u: string | URL, p?: string | string[]) { super(u, p); if (new URL(String(u), location.href).pathname === '/ws') sockets.push(this); } } as typeof WebSocket;
    Object.assign(window, { __sockets: sockets });
    let hidden = false;
    Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => hidden });
    Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
    Object.assign(window, { __clock: { jump: (ms: number) => { offset += ms; }, now, hide: (h: boolean) => { hidden = h; document.dispatchEvent(new Event('visibilitychange')); } } });
  }, start.getTime());
  await page.goto(`${demoServer.origin}/?t=${demoServer.token}&quality=low&pose=hub&weather=clear`);
  await ready(page);
  // boot can take a while on a busy machine: put the clock 4 s before the next midnight now that the valley runs
  await page.evaluate(() => { const c = (window as unknown as W).__clock, d = new Date(c.now()); c.jump(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - 4000 - d.getTime()); });
  await page.waitForTimeout(600);
  const day0 = await page.evaluate(() => (window as unknown as W).__valley.state().timeline.day);
  const req0 = await page.evaluate(() => JSON.stringify((window as unknown as W).__valley.requests()));
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__valley.state().timeline.day), { timeout: 30_000 }).not.toBe(day0);
  // the day's requests re-roll when asked for (the friends panel / the noticeboard ask on open)
  await page.evaluate(() => (window as unknown as W).__hud.open('friends'));
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => JSON.stringify((window as unknown as W).__valley.requests()))).not.toBe(req0);
  await page.evaluate(() => (window as unknown as W).__hud.close());

  // hidden for five hours, then back: frames carry on, no storm of toasts for everything that happened meanwhile
  await page.evaluate(() => (window as unknown as { __clock: { hide(h: boolean): void } }).__clock.hide(true));
  await page.evaluate(() => (window as unknown as W).__clock.jump(5 * 3600_000));
  await page.waitForTimeout(2500);
  await page.evaluate(() => (window as unknown as { __clock: { hide(h: boolean): void } }).__clock.hide(false));
  await page.waitForTimeout(2500);
  expect(await page.locator('.vh-toast').count()).toBeLessThanOrEqual(3);
  expect(await page.evaluate(() => (window as unknown as W).__valley.perf().frameErrors)).toBe(0);

  // long, unicode and emoji names; a farmer flapping between states
  const ids = await page.evaluate(() => Object.keys((window as unknown as W).__valley.state().farmers));
  expect(ids.length).toBeGreaterThan(0);
  const names = ['a-really-quite-extraordinarily-long-agent-name-that-goes-on-and-on-and-on-forever', 'Zoë 🦊 狐狸 حروف', '‮evil‬👩‍👩‍👧‍👦'];
  for (let i = 0; i < ids.length; i++) await page.evaluate(([id, name]) => (window as unknown as W).__valley.force(id, { name, title: `${name} ${name}` }), [ids[i], names[i % names.length]] as const);
  for (let i = 0; i < 16; i++) await page.evaluate(([id, s]) => (window as unknown as W).__valley.force(id, { status: s }), [ids[0], ['working', 'blocked', 'idle', 'done'][i % 4]] as const);
  await expect.poll(() => page.evaluate(() => Object.values((window as unknown as W).__valley.state().farmers).some((f) => f.name.includes('🦊'))), { timeout: 10_000 }).toBe(true);
  for (const id of ['roster', 'map', 'mailbox']) { await page.evaluate((id) => (window as unknown as W).__hud.open(id), id); await page.waitForTimeout(300); }
  await page.evaluate((id) => (window as unknown as W).__hud.open('card', id), ids[0]);
  await page.waitForTimeout(300);

  // the socket drops with a terminal open: it reconnects, the terminal stays usable, nothing throws
  await page.evaluate((id) => (window as unknown as W).__hud.openTerminal(id), ids[0]);
  await page.waitForTimeout(800);
  await page.evaluate(() => { for (const ws of (window as unknown as { __sockets?: WebSocket[] }).__sockets ?? []) ws.close(); });
  await page.waitForTimeout(1500);
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__valley.state().link), { timeout: 30_000 }).toBe('live');
  await page.evaluate(() => (window as unknown as W).__hud.close());
  expect(await page.evaluate(() => (window as unknown as W).__valley.perf().frameErrors)).toBe(0);
  expect(errors).toEqual([]);
});
