/**
 * Electron shell for Claude Valley.
 *   npm run app                 live: the default herdr session (or --session NAME)
 *   npm run app:demo            demo world (--demo [N] --scenario NAME --seed S)
 *   electron electron/main.ts --url http://127.0.0.1:PORT/?t=TOKEN   attach to a running backend
 *   --tray                      start hidden in the tray (start at login uses it)
 *   --profile DIR               user-data directory (window state, desktop prefs, the single-instance lock)
 *
 * Runs the backend in-process (server/app.ts) unless one is already serving this session, in which case the window
 * attaches to it. One instance per profile (the demo has its own): a second launch focuses the first.
 * The page is sandboxed (contextIsolation, no node, window.open denied, off-origin navigation blocked); its only
 * window onto the shell is the preload bridge (electron/preload.ts → shared/desktop.ts). Tray, badge, notifications,
 * the summon hotkey and the hidden-window render mode are electron/shell.ts; docs/valley/desktop.md is the map.
 * GPU: ANGLE on Vulkan with the blocklist ignored (Linux iGPUs), Chromium defaults elsewhere.
 */
import { app, BrowserWindow, Menu } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.ts';
import type { App } from '../server/app.ts';
import { resolveConfig, loadOrCreateToken } from '../server/config.ts';
import { findLive } from '../server/instance.ts';
import { errMessage } from '../shared/guards.ts';
import { createShell, loadWindowState, trackWindowState } from './shell.ts';
import type { Shell } from './shell.ts';
import { MIN_H, MIN_W } from './model.ts';

interface Args { demo?: number; session?: string; port?: number; url?: string; scenario?: string; seed?: number; dev: boolean; tray: boolean; profile?: string }
function parse(argv: string[]): Args {
  const o: Args = { dev: false, tray: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--demo') { const v = argv[i + 1]; if (v && /^\d+$/.test(v)) { o.demo = Number(v); i++; } else o.demo = 12; }
    else if (a === '--session') o.session = argv[++i];
    else if (a === '--port') o.port = Number(argv[++i]);
    else if (a === '--url') o.url = argv[++i];
    else if (a === '--scenario') o.scenario = argv[++i];
    else if (a === '--seed') o.seed = Number(argv[++i]);
    else if (a === '--dev') o.dev = true;
    else if (a === '--tray') o.tray = true;
    else if (a === '--profile') o.profile = argv[++i];
  }
  return o;
}

const opts = parse(process.argv.slice(1));
if (process.platform !== 'darwin') {
  for (const [k, v] of [['ignore-gpu-blocklist'], ['use-angle', 'vulkan'], ['enable-features', 'Vulkan']] as [string, string?][]) {
    if (!app.commandLine.hasSwitch(k)) app.commandLine.appendSwitch(k, v);
  }
}
// one profile per mode: the demo never fights the live valley for the lock (or its window state)
if (opts.profile) app.setPath('userData', path.resolve(opts.profile));
else if (opts.demo) app.setPath('userData', `${app.getPath('userData')}-demo`);
const userData = app.getPath('userData');
const primary = app.requestSingleInstanceLock();
if (!primary) {
  console.log('claude-valley: already running; focusing that window');
  app.exit(0);
}

let backend: App | null = null;
let shell: Shell | null = null;
let flushWindow: (() => void) | null = null;

/** the preload runs sandboxed (no type stripping, no imports): strip its types once per launch into userData */
function preloadPath(): string {
  const src = fs.readFileSync(fileURLToPath(new URL('./preload.ts', import.meta.url)), 'utf8');
  const out = path.join(userData, 'preload.js');
  const js = stripTypeScriptTypes(src);
  fs.mkdirSync(userData, { recursive: true });
  if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== js) fs.writeFileSync(out, js);
  return out;
}

async function start(): Promise<void> {
  Menu.setApplicationMenu(null);
  let url = opts.url;
  if (!url) {
    const cfg = resolveConfig({ demo: opts.demo, session: opts.session, port: opts.port });
    const live = cfg.demo ? { live: false as const } : await findLive(cfg.configDir, cfg.session);
    if (live.live) {
      url = `http://127.0.0.1:${live.lock.port}/?t=${loadOrCreateToken(cfg.configDir)}`;
      console.log(`claude-valley: attaching to the running backend for "${cfg.session}"`);
    } else {
      backend = await createApp({ demo: opts.demo, session: opts.session, port: opts.port ?? 0, scenario: opts.scenario, seed: opts.seed, dev: opts.dev });
      url = backend.url;
      console.log(`Claude Valley ${cfg.demo ? `DEMO ×${cfg.demo}` : `session "${backend.session}"`} → ${url}`);
    }
  }
  const origin = new URL(url).origin;
  const saved = loadWindowState(userData);
  const win = new BrowserWindow({
    ...saved.bounds, minWidth: MIN_W, minHeight: MIN_H, show: false, backgroundColor: '#9fd3ff', title: 'Claude Valley',
    // backgroundThrottling off: Chromium would otherwise stretch a hidden page's timers to one wake-up a minute after
    // five minutes, and asks / notifications would arrive late. The shell tells the page what to draw instead
    // (RenderMode: live / background / paused, via the bridge).
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: true, backgroundThrottling: false, preload: preloadPath() },
  });
  flushWindow = trackWindowState(win, userData);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, to) => { if (new URL(to).origin !== origin) e.preventDefault(); });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) win.webContents.toggleDevTools();
  });
  shell = createShell({
    win, origin, userData, argv: process.argv.slice(1), quit: () => { void quit(0); },
    firstShow: () => { if (saved.fullscreen) win.setFullScreen(true); else if (saved.maximized) win.maximize(); },
  });
  (globalThis as { __valleyShell?: Shell }).__valleyShell = shell;   // tests: electronApp.evaluate(() => __valleyShell.debug())
  app.on('second-instance', () => shell?.summon());
  app.on('activate', () => shell?.summon());   // macOS: the dock icon
  // a --tray start stays hidden when there is a tray to come back from
  const hidden = opts.tray && shell.debug().tray;
  if (!hidden) win.once('ready-to-show', () => { if (!win.isVisible()) shell?.summon(); });
  await win.loadURL(url);
  if (!hidden && !win.isVisible()) shell.summon();
}

let quitting = false;
async function quit(code: number): Promise<void> {
  if (quitting) { backend?.kill(); app.exit(code); return; }
  quitting = true;
  try { flushWindow?.(); } catch (e) { console.error(errMessage(e)); }
  try { shell?.dispose(); } catch (e) { console.error(errMessage(e)); }
  try { await backend?.close(); } catch (e) { console.error(errMessage(e)); }
  app.exit(code);
}
app.on('window-all-closed', () => { void quit(0); });
for (const s of ['SIGINT', 'SIGTERM'] as const) process.on(s, () => { void quit(0); });
if (primary) app.whenReady().then(start).catch((e: unknown) => { console.error(`claude-valley: ${errMessage(e)}`); void quit(1); });
