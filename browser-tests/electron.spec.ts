import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The desktop shell end to end (docs/valley/desktop.md): launch `electron electron/main.ts --demo` with a throwaway
 * profile, check the page loads with the preload bridge (and nothing node-ish), that the page's status reaches the
 * tray / badge, that hiding the window switches the page to the background render mode, and that window state is
 * saved on quit. Linux without a display gets a private Xvfb; with neither, or when Electron cannot start here, the
 * test skips. `--no-sandbox`: the dev checkout's chrome-sandbox helper is not setuid root.
 */
test.describe.configure({ mode: 'serial' });

interface ShellDebug { badge: string; tooltip: string; menu: { type: string; label?: string }[]; mode: string; tray: boolean; hotkeyOk: boolean }
const shellDebug = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as { __valleyShell: { debug(): ShellDebug } }).__valleyShell.debug());

test('desktop shell: demo window, bridge, tray + badge, background render mode, window state', async ({}, info) => {
  test.setTimeout(120_000);
  const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined));
  let xvfb: ChildProcess | null = null;
  if (process.platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) {
    test.skip(spawnSync('which', ['Xvfb']).status !== 0, 'no display and no Xvfb');
    const disp = `:${200 + ((process.pid + info.workerIndex) % 500)}`;
    xvfb = spawn('Xvfb', [disp, '-screen', '0', '1920x1080x24', '-nolisten', 'tcp'], { stdio: 'ignore' });
    env.DISPLAY = disp;
    await new Promise((r) => setTimeout(r, 800));
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'valley-electron-'));
  let app: ElectronApplication | null = null;
  try {
    try {
      app = await electron.launch({ args: ['--no-sandbox', 'electron/main.ts', '--demo', '4', '--scenario', 'allStates', '--profile', profile], env, timeout: 45_000 });
    } catch (e) {
      test.skip(true, `Electron could not start here: ${String(e).split('\n')[0]}`);
      return;
    }
    const win = await app.firstWindow();
    await win.waitForSelector('[data-testid="hud"]', { timeout: 45_000 });

    // the bridge is there, typed and minimal; no node in the page
    const page = await win.evaluate(() => {
      const d = (window as unknown as { valleyDesktop?: Record<string, unknown> }).valleyDesktop;
      return { keys: d ? Object.keys(d).sort() : null, require: typeof (window as unknown as { require?: unknown }).require, process: typeof (window as unknown as { process?: unknown }).process, flag: document.documentElement.dataset.desktop };
    });
    expect(page.keys).toEqual(['notify', 'onCommand', 'platform', 'prefs', 'setPrefs', 'status', 'version']);
    expect(page.require).toBe('undefined');
    expect(page.process).toBe('undefined');
    expect(page.flag).toBe(process.platform);
    const reply = await win.evaluate(() => (window as unknown as { valleyDesktop: { prefs(): Promise<{ prefs: { hotkey: string }; traySupported: boolean }> } }).valleyDesktop.prefs());
    expect(reply.prefs.hotkey).toBe('CommandOrControl+Alt+V');

    // the page's asks reach the tray menu and the badge (allStates: a blocked farmer)
    await win.waitForFunction(() => (window as unknown as { __valley?: { state(): { farmers: Record<string, { needsYou: boolean }> } } }).__valley?.state && Object.values((window as unknown as { __valley: { state(): { farmers: Record<string, { needsYou: boolean }> } } }).__valley.state().farmers).some((f) => f.needsYou), null, { timeout: 30_000 });
    const need = await win.evaluate(() => Object.values((window as unknown as { __valley: { state(): { farmers: Record<string, { needsYou: boolean }> } } }).__valley.state().farmers).filter((f) => f.needsYou).length);
    await expect.poll(async () => (await shellDebug(app!)).badge, { timeout: 10_000 }).toBe(need > 9 ? '9+' : String(need));
    const dbg = await shellDebug(app);
    expect(dbg.menu[0].label).toMatch(/needs? you/);
    expect(dbg.menu.map((m) => m.label)).toEqual(expect.arrayContaining(['Pause rendering', 'Quit Claude Valley']));
    expect(dbg.tooltip).toContain('need');

    // hidden → the page draws in the background; shown → live again
    expect(dbg.mode).toBe('live');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
    await expect.poll(async () => (await shellDebug(app!)).mode).toBe('background');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
    await expect.poll(async () => (await shellDebug(app!)).mode).toBe('live');

    // Settings → Alerts has the desktop rows; "stop drawing while hidden" persists in the shell and pauses hidden windows
    await win.evaluate(() => (window as unknown as { __hud: { open(id: string, arg?: unknown): void } }).__hud.open('pause', 'settings:alerts'));
    await expect(win.getByTestId('set-hotkey')).toHaveText(process.platform === 'darwin' ? '⌘⌥V' : 'Ctrl+Alt+V');
    await expect(win.getByTestId('set-pause-hidden')).toBeEnabled();
    await win.getByTestId('set-pause-hidden').check();
    await expect.poll(() => { try { return JSON.parse(fs.readFileSync(path.join(profile, 'desktop.json'), 'utf8')).pauseHidden; } catch { return null; } }).toBe(true);
    // (hide, not minimize: a bare Xvfb has no window manager to iconify a window)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
    await expect.poll(async () => (await shellDebug(app!)).mode).toBe('paused');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
    await expect.poll(async () => (await shellDebug(app!)).mode).toBe('live');
    await win.evaluate(() => (window as unknown as { __hud: { close(): void } }).__hud.close());

    // a notification click / tray item lands on the page as an "open" command → that farmer's terminal or the mailbox
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('valley:to-page', { t: 'open', target: { kind: 'mailbox' } }));
    await expect.poll(() => win.evaluate(() => (window as unknown as { __hud: { current(): unknown } }).__hud.current())).toBeTruthy();

    // window state is saved on quit
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 40, y: 50, width: 1100, height: 760 }));
    await app.close();
    app = null;
    const saved = JSON.parse(fs.readFileSync(path.join(profile, 'window-state.json'), 'utf8')) as { bounds: { width: number; height: number } };
    expect(saved.bounds.width).toBe(1100);
    expect(saved.bounds.height).toBe(760);
  } finally {
    await app?.close().catch(() => {});
    xvfb?.kill();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
