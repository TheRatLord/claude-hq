import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import type { TraceSnapshot } from '../renderer/src/net/trace.ts';
import { test, expect } from './server.ts';

interface Metrics {
  terminals: { viewers: number; orphans: number; promotes: number; children: { observe: number; control: number; pending: number } };
  ws: unknown[];
  herdr: { connected: boolean; live: { scenario: string } };
}

async function metrics(page: Page, origin: string): Promise<Metrics> {
  const response = await page.request.get(`${origin}/debug/metrics`);
  expect(response.status()).toBe(200);
  return await response.json() as Metrics;
}

async function exportTrace(page: Page): Promise<{ snapshot: TraceSnapshot; text: string }> {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export trace', exact: true }).click();
  const download = await downloading;
  const file = await download.path();
  if (!file) throw new Error(`Trace download failed: ${await download.failure()}`);
  const text = await readFile(file, 'utf8');
  return { snapshot: JSON.parse(text) as TraceSnapshot, text };
}

async function applyScenario(page: Page, name: string, seed: number) {
  await page.getByLabel('Scenario', { exact: true }).selectOption(name);
  await page.getByLabel('Seed', { exact: true }).fill(String(seed));
  await page.getByRole('button', { name: 'Apply scenario', exact: true }).click();
}

test('bootstraps auth, runs the real terminal with explicit control, reconnects, and releases its viewer', async ({ page, context, request, demoServer }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // The standalone API fixture has no browser cookie: metrics really are authenticated.
  expect((await request.get(`${demoServer.origin}/debug/metrics`)).status()).toBe(401);
  await page.goto(demoServer.url);
  await expect(page.getByTestId('connection')).toHaveText(/\bconnected\b/i);
  expect(new URL(page.url()).searchParams.has('t')).toBe(false);
  const cookie = (await context.cookies()).find((item) => item.name === 'hq_token');
  expect(cookie).toMatchObject({ value: demoServer.token, httpOnly: true, sameSite: 'Strict' });
  expect(await page.evaluate(() => document.cookie)).not.toContain('hq_token');
  // allStates prescribes 5 status agents, 18 tool agents and 10 shell agents, independent of --demo 3.
  await expect(page.getByTestId('agent')).toHaveCount(33);
  await expect(page.getByTestId('agent-count')).toContainText('33');
  await expect(page.getByLabel('Scenario', { exact: true })).toHaveValue('allStates');
  await expect(page.getByLabel('Seed', { exact: true })).toHaveValue('7');

  const record = page.getByLabel('Record interaction trace', { exact: true });
  await expect(record).not.toBeChecked();
  expect((await exportTrace(page)).snapshot.entries).toEqual([]);
  await record.check();
  await page.getByTestId('agent').first().click();
  await page.getByRole('button', { name: 'Open terminal', exact: true }).click();
  const terminal = page.getByTestId('terminal-host');
  const state = page.getByTestId('terminal-state');
  const output = terminal.locator('.xterm-accessibility-tree');
  await expect(state).toHaveText(/live.*observe/i);
  await expect(output).toContainText('Claude Code (demo)');
  await expect.poll(async () => (await metrics(page, demoServer.origin)).terminals.viewers).toBe(1);

  const input = terminal.locator('.xterm-helper-textarea');
  await input.focus();
  await page.keyboard.type('OBSERVE_MUST_NOT_SEND');
  await page.keyboard.press('Enter');
  await expect(state).toHaveText(/live.*observe/i);
  await expect(output).not.toContainText('OBSERVE_MUST_NOT_SEND');
  expect((await metrics(page, demoServer.origin)).terminals.promotes).toBe(0);

  await page.getByRole('button', { name: 'Take control', exact: true }).click();
  await expect(state).toHaveText(/live.*control/i);
  await input.focus();
  await page.keyboard.type('echo PRIVATE_BROWSER_SENTINEL_73');
  await page.keyboard.press('Enter');
  await expect(output).toContainText('PRIVATE_BROWSER_SENTINEL_73');
  expect((await metrics(page, demoServer.origin)).terminals.promotes).toBe(1);

  await page.getByRole('button', { name: 'Observe', exact: true }).click();
  await expect(state).toHaveText(/live.*observe/i);
  const reconnected = page.waitForEvent('websocket');
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await reconnected;
  await expect(page.getByTestId('connection')).toHaveText(/\bconnected\b/i);
  await expect(state).toHaveText(/live.*observe/i);
  await expect(output).toContainText('PRIVATE_BROWSER_SENTINEL_73');
  await expect.poll(async () => {
    const value = await metrics(page, demoServer.origin);
    return { viewers: value.terminals.viewers, orphans: value.terminals.orphans, sockets: value.ws.length };
  }).toEqual({ viewers: 1, orphans: 0, sockets: 1 });

  await page.getByRole('button', { name: 'Close terminal', exact: true }).click();
  await expect.poll(async () => {
    const value = (await metrics(page, demoServer.origin)).terminals;
    return { viewers: value.viewers, orphans: value.orphans, children: value.children };
  }).toEqual({ viewers: 0, orphans: 0, children: { observe: 0, control: 0, pending: 0 } });
  const { snapshot, text } = await exportTrace(page);
  expect(snapshot.version).toBe(1);
  expect(snapshot.context).toMatchObject({ scenario: 'allStates', seed: 7 });
  const open = snapshot.entries.find((entry) => entry.direction === 'out' && entry.type === 'term.open');
  expect(open?.meta?.request).toMatch(/^r\d+$/);
  expect(snapshot.entries).toEqual(expect.arrayContaining([
    expect.objectContaining({ direction: 'in', type: 'reply', meta: expect.objectContaining({ request: open!.meta!.request }) }),
    expect.objectContaining({ direction: 'local', type: 'call.end', meta: expect.objectContaining({ request: open!.meta!.request, outcome: 'ok' }) }),
  ]));
  for (const privateText of [demoServer.token, 'PRIVATE_BROWSER_SENTINEL_73', 'OBSERVE_MUST_NOT_SEND', 'Claude Code (demo)', '/home/demo']) {
    expect(text).not.toContain(privateText);
  }
  await page.getByRole('button', { name: 'Clear trace', exact: true }).click();
  expect((await exportTrace(page)).snapshot.entries.some((entry) => entry.type === 'term.open')).toBe(false);
  // Export must not silently re-enable a disabled recorder.
  await record.uncheck();
  expect((await exportTrace(page)).snapshot.entries).toEqual([]);
  expect(errors).toEqual([]);
});

test('switches empty and offline scenarios and exports the authoritative scenario and seed', async ({ page, demoServer }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Stale URL hints must not override the actual CLI demo configuration.
  await page.goto(`${demoServer.url}&scenario=empty&seed=99`);
  await expect(page.getByTestId('agent')).toHaveCount(33);
  await expect(page.getByLabel('Scenario', { exact: true })).toHaveValue('allStates');
  await expect(page.getByLabel('Seed', { exact: true })).toHaveValue('7');
  await page.getByLabel('Record interaction trace', { exact: true }).check();

  await applyScenario(page, 'empty', 17);
  await expect(page.getByTestId('agent')).toHaveCount(0);
  await expect(page.getByTestId('agent-count')).toContainText('0');
  expect((await metrics(page, demoServer.origin)).herdr.live.scenario).toBe('empty');

  await applyScenario(page, 'offline', 18);
  await expect(page.getByTestId('herdr')).toHaveText(/offline/i);
  await expect(page.getByTestId('connection')).toHaveText(/\bconnected\b/i);
  expect((await metrics(page, demoServer.origin)).herdr.connected).toBe(false);

  await applyScenario(page, 'mixed', 19);
  await expect(page.getByTestId('herdr')).toHaveText(/\bconnected\b/i);
  await expect(page.getByTestId('agent')).toHaveCount(3);
  const { snapshot } = await exportTrace(page);
  expect(snapshot.context).toMatchObject({ scenario: 'mixed', seed: 19 });
  const changes = snapshot.entries.filter((entry) => entry.direction === 'out' && entry.type === 'demo.scenario');
  expect(changes).toHaveLength(3);
  for (const change of changes) {
    expect(change.meta?.request).toMatch(/^r\d+$/);
    expect(snapshot.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'call.end', meta: expect.objectContaining({ request: change.meta!.request, outcome: 'ok' }) }),
    ]));
  }
  expect(errors).toEqual([]);
});
