/**
 * Electron shell for Claude Valley.
 *   npm run app                 live: the default herdr session (or --session NAME)
 *   npm run app:demo            demo world (--demo [N] --scenario NAME --seed S)
 *   electron electron/main.ts --url http://127.0.0.1:PORT/?t=TOKEN   attach to a running backend
 *
 * Runs the backend in-process (server/app.ts) unless one is already serving this session, in which case the window
 * attaches to it. The page is sandboxed: no node, no preload, window.open denied, off-origin navigation blocked.
 * GPU: ANGLE on Vulkan with the blocklist ignored (Linux iGPUs), Chromium defaults elsewhere.
 */
import { app, BrowserWindow, Menu } from 'electron';
import { createApp } from '../server/app.ts';
import type { App } from '../server/app.ts';
import { resolveConfig, loadOrCreateToken } from '../server/config.ts';
import { findLive } from '../server/instance.ts';
import { errMessage } from '../shared/guards.ts';

interface Args { demo?: number; session?: string; port?: number; url?: string; scenario?: string; seed?: number; dev: boolean }
function parse(argv: string[]): Args {
  const o: Args = { dev: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--demo') { const v = argv[i + 1]; if (v && /^\d+$/.test(v)) { o.demo = Number(v); i++; } else o.demo = 12; }
    else if (a === '--session') o.session = argv[++i];
    else if (a === '--port') o.port = Number(argv[++i]);
    else if (a === '--url') o.url = argv[++i];
    else if (a === '--scenario') o.scenario = argv[++i];
    else if (a === '--seed') o.seed = Number(argv[++i]);
    else if (a === '--dev') o.dev = true;
  }
  return o;
}

const opts = parse(process.argv.slice(1));
if (process.platform !== 'darwin') {
  for (const [k, v] of [['ignore-gpu-blocklist'], ['use-angle', 'vulkan'], ['enable-features', 'Vulkan']] as [string, string?][]) {
    if (!app.commandLine.hasSwitch(k)) app.commandLine.appendSwitch(k, v);
  }
}

let backend: App | null = null;

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
  const win = new BrowserWindow({
    width: 1600, height: 960, useContentSize: true, backgroundColor: '#9fd3ff', title: 'Claude Valley',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: true, backgroundThrottling: true },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, to) => { if (new URL(to).origin !== origin) e.preventDefault(); });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) win.webContents.toggleDevTools();
  });
  await win.loadURL(url);
}

let quitting = false;
async function quit(code: number): Promise<void> {
  if (quitting) { backend?.kill(); app.exit(code); return; }
  quitting = true;
  try { await backend?.close(); } catch (e) { console.error(errMessage(e)); }
  app.exit(code);
}
app.on('window-all-closed', () => { void quit(0); });
for (const s of ['SIGINT', 'SIGTERM'] as const) process.on(s, () => { void quit(0); });
app.whenReady().then(start).catch((e: unknown) => { console.error(`claude-valley: ${errMessage(e)}`); void quit(1); });
