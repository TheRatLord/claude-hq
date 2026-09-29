/**
 * Electron main (DESIGN §2, §4.12, §8.3, §9.3). Owner: BE.
 *   npm start [-- --demo [N] | --session S] [--port P] [--dev] [--dist dir] [--url URL]
 *   xvfb-run -a -s "-screen 0 2560x1440x24" npx electron --no-sandbox --ignore-gpu-blocklist --use-angle=vulkan \
 *     --enable-features=Vulkan . --demo --shoot /tmp/e.png [--shoot-wait 6000] [--shoot-pose name|x,y,z,yaw,pitch]
 *
 * - In-process backend (server/app.ts createApp), or ATTACH to a live backend for the same session (lock + /healthz,
 *   §4.12): then only a window opens on the existing URL (token from the token file).
 * - GPU switches (also appended here so `electron .` alone gets them): ignore-gpu-blocklist, ANGLE/Vulkan.
 * - Security: contextIsolation, sandbox, no node in the page, window.open denied, off-origin navigation blocked.
 * - Keys: no application menu (no accelerators steal keys); `before-input-event` blocks reload (Ctrl+R, Ctrl+Shift+R,
 *   F5) and devtools (F12, Ctrl+Shift+I) outside --dev, ONLY while the page reports xterm is not focused (preload IPC).
 * - --shoot: wait for window.__hq.ready, optional pose, settle, capturePage → PNG, print the WebGL renderer, quit.
 * - Single instance per session (M3.5): a second `npm start` for the same session focuses this window and exits
 *   (Chromium profile = <config>/electron/<session>). A backend already running in another process (web mode) → attach.
 * - Reach (M3.5, electron/reach.ts): tray icon + tooltip/title with the blocked count, app badge count, a global hotkey
 *   (config.json `electron.hotkey`, default Ctrl+Alt+H) that raises the window into the Blocked Inbox, and native OS
 *   notifications for new blocks while the window is unfocused (click → raise + `?open=inbox:<name>`). The count comes
 *   from the in-process WorldModel (attach mode: a listen-only WS client), never from the renderer. The page's own web
 *   notifications are denied in Electron so nothing notifies twice. Every piece degrades silently when the platform
 *   lacks it (no tray host, no badge, hotkey taken). None of it runs under --shoot.
 * - Deep links into a running page: preload's `hqElectron.onOpen(fn)` (the UI registers it) gets `hq:open <link>`;
 *   a page that never registered is reloaded at `/?open=<link>` instead.
 */
import { app, BrowserWindow, Menu, ipcMain, Tray, nativeImage, globalShortcut, Notification, session as electronSession } from 'electron';
import type { NativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.ts';
import { resolveConfig, loadOrCreateToken, defaultConfigDir } from '../server/config.ts';
import { findLive } from '../server/instance.ts';
import { PROTOCOL_VERSION } from '../shared/protocol.ts';
import { errMessage, isRecord } from '../shared/guards.ts';
import WebSocket from 'ws';
import { modelFeed, wsFeed, trayText, notifyText, deepLink, parseHotkey, trayBitmap,
  NOTIFY_RATE_MS, NOTIFY_MERGE_MS } from './reach.ts';
import type { BlockedChange, BlockedRow, ReachFeed, ReachModel } from './reach.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The sandboxed preload can't be type-stripped, so it is compiled (npm run build:preload; `npm start` does it) into out/.
const PRELOAD = path.join(HERE, '../out/preload/preload.cjs');

/** Our parsed flags. */
export interface ElectronArgs {
  demo: number | undefined;
  session: string | undefined;
  port: number | undefined;
  dev: boolean;
  dist: string | undefined;
  url: string | undefined;
  shoot: string | null;
  shootWait: number;
  shootPose: string | null;
  width: number;
  height: number;
}

/** The slice of the createApp() handle main uses (server/app.ts returns more). */
interface Backend {
  url: string;
  session: string;
  model: ReachModel;
  close(): Promise<void>;
  kill(): void;
}

/** Our flags (everything after the app path; Chromium switches are ignored here). */
export function parseElectronArgs(argv: string[]): ElectronArgs {
  const o: ElectronArgs = { demo: undefined, session: undefined, port: undefined, dev: false, dist: undefined, url: undefined,
    shoot: null, shootWait: 6000, shootPose: null, width: 1920, height: 1080 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === '--demo') {
      const v = argv[i + 1];
      if (v !== undefined && /^\d+$/.test(v)) {
        o.demo = Number(v);
        i++;
      } else o.demo = 12;
    } else if (a === '--session') o.session = next();
    else if (a === '--port') o.port = Number(next());
    else if (a === '--dev') o.dev = true;
    else if (a === '--dist') o.dist = next();
    else if (a === '--url') o.url = next();
    else if (a === '--shoot') o.shoot = next();
    else if (a === '--shoot-wait') o.shootWait = Number(next());
    else if (a === '--shoot-pose') o.shootPose = next();
    else if (a === '--size') [o.width, o.height] = next().split('x').map(Number);
  }
  return o;
}

const opts = parseElectronArgs(process.argv.slice(1));
const cfg0 = resolveConfig({ demo: opts.demo, session: opts.session, port: opts.port });
// Chromium profile under our config dir, not beside token/config.json (the default userData IS ~/.config/claude-hq).
// One profile per session so the single-instance lock is per session (default and hqtest windows may coexist);
// --shoot keeps the shared profile and takes no lock (parallel shots).
app.setPath('userData', path.join(defaultConfigDir(), 'electron', ...(opts.shoot || opts.url ? [] : [cfg0.session.replace(/[^A-Za-z0-9_.-]/g, '_')])));
// GPU (780M / Linux): ANGLE on Vulkan, blocklist ignored. macOS keeps Chromium's default ANGLE backend (Metal): a
// Vulkan request there falls back to software GL, so `npm start`'s --use-angle=vulkan is dropped on darwin.
if (process.platform === 'darwin') app.commandLine.removeSwitch?.('use-angle');
const gpuSwitches: [string, string?][] = process.platform === 'darwin' ? [['ignore-gpu-blocklist']] : [['ignore-gpu-blocklist'], ['use-angle', 'vulkan'], ['enable-features', 'Vulkan']];
for (const [k, v] of gpuSwitches) {
  if (!app.commandLine.hasSwitch(k)) app.commandLine.appendSwitch(k, v);
}
if (opts.shoot) app.commandLine.appendSwitch('disable-renderer-backgrounding');

let mainWin: BrowserWindow | null = null;
let pageOrigin: string | null = null;
let pageListensForLinks = false;
ipcMain.on('hq:open-ready', (e) => {
  if (mainWin && e.sender === mainWin.webContents) pageListensForLinks = true;
});
// a second `npm start` for this session → focus this window (its own process exits right away)
const primary = opts.shoot || opts.url ? true : app.requestSingleInstanceLock({ session: cfg0.session });
if (!primary) {
  console.log(`claude-hq: Claude HQ is already open for session "${cfg0.session}"; focusing it`);
  app.exit(0);
}
app.on('second-instance', () => raise(null));

let backend: Backend | null = null;
let xtermFocused = false;
ipcMain.on('hq:xterm-focus', (_e, f: unknown) => (xtermFocused = !!f));

async function start() {
  Menu.setApplicationMenu(null);
  let url = opts.url;
  if (!url) {
    const cfg = resolveConfig({ demo: opts.demo, session: opts.session, port: opts.port });
    const live = cfg.demo ? { live: false as const } : await findLive(cfg.configDir, cfg.session);
    if (live.live) {
      url = `http://127.0.0.1:${live.lock.port}/?t=${loadOrCreateToken(cfg.configDir)}`;
      console.log(`claude-hq: attaching to the running backend for "${cfg.session}" (pid ${live.lock.pid})`);
    } else {
      backend = await createApp({ demo: opts.demo, session: opts.session, port: opts.shoot && opts.port === undefined ? 0 : opts.port,
        dev: opts.dev, distDir: opts.dist });
      url = backend.url;
      console.log(`Claude HQ ${cfg.demo ? `DEMO ×${cfg.demo}` : `session "${backend.session}"`} → ${url}`);
    }
  }
  const origin = (pageOrigin = new URL(url).origin);
  const win = new BrowserWindow({
    width: opts.width, height: opts.height, useContentSize: true, show: true, backgroundColor: '#1d1b22',
    title: 'Claude HQ',
    webPreferences: {
      contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: !opts.shoot,
      preload: PRELOAD, devTools: opts.dev,
    },
  });
  mainWin = win;
  win.on('closed', () => (mainWin = null));
  win.webContents.on('did-start-navigation', (_e, _u, inPlace, isMain) => {
    if (isMain && !inPlace) pageListensForLinks = false; // a reload: the new page registers again
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, to) => {
    if (new URL(to).origin !== origin) e.preventDefault();
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || xtermFocused) return;
    const key = input.key.toLowerCase();
    const ctrl = input.control || input.meta;
    const reload = (ctrl && key === 'r') || input.key === 'F5';
    const devtools = input.key === 'F12' || (ctrl && input.shift && key === 'i');
    if (reload || (devtools && !opts.dev)) e.preventDefault();
  });
  if (!opts.shoot) {
    // native notifications replace the page's web ones in Electron (no double notification, and a click can raise)
    const ses = win.webContents.session ?? electronSession.defaultSession;
    ses.setPermissionRequestHandler((_wc, perm, cb) => cb(perm !== 'notifications'));
    ses.setPermissionCheckHandler((_wc, perm) => perm !== 'notifications');
  }
  await win.loadURL(url);
  if (opts.shoot) await shoot(win, opts.shoot);
  else startReach(url);
}

// ------------------------------------------------------------------------------------------------ reach (M3.5)

let tray: Tray | null = null;
let reachFeed: ReachFeed | null = null;
const reachState: { count: number; badge: number | null; tray: boolean; hotkey: string | null; notified: number } = { count: -1, badge: null, tray: false, hotkey: null, notified: 0 };

/** Raise + focus the window; with `link`, deep-link the page (`inbox`, `inbox:<name>`, a name…). */
function raise(link: string | null) {
  const win = mainWin;
  if (!win) return;
  try {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    app.focus?.({ steal: true });
  } catch {}
  if (!link) {
    if (process.env.HQ_REACH_LOG) console.log('HQ-REACH raise {"link":null}');
    return;
  }
  if (pageListensForLinks) win.webContents.send('hq:open', link);
  else if (pageOrigin) win.loadURL(`${pageOrigin}/?open=${encodeURIComponent(link)}`).catch(() => {});
  if (process.env.HQ_REACH_LOG) {
    console.log(`HQ-REACH raise ${JSON.stringify({ link, via: pageListensForLinks ? 'ipc' : 'reload' })}`);
    setTimeout(() => win.webContents.executeJavaScript('({ inbox: !!document.querySelector(".hq-inbox"), title: document.title, url: location.search })', true)
      .then((r: unknown) => console.log(`HQ-REACH page ${JSON.stringify({ ...(isRecord(r) ? r : {}), focused: win.isFocused() })}`), () => {}), 2500);
  }
}

function readConfigJson(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(defaultConfigDir(), 'config.json'), 'utf8'));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function startReach(url: string) {
  const sessionName = backend?.session ?? cfg0.session;
  // feed: in-process WorldModel, else a listen-only WS client to the backend we attached to
  let feed: ReachFeed;
  try {
    if (backend?.model) feed = modelFeed(backend.model);
    else {
      const u = new URL(url);
      const token = u.searchParams.get('t') ?? loadOrCreateToken(defaultConfigDir());
      feed = wsFeed({ port: Number(u.port), token, WebSocketImpl: WebSocket, protocol: PROTOCOL_VERSION });
    }
  } catch (e) {
    console.warn(`claude-hq: reach feed unavailable (${errMessage(e)})`);
    return;
  }
  reachFeed = feed;
  // tray (Linux needs a StatusNotifier/AppIndicator host; without one the icon is simply not shown)
  try {
    tray = new Tray(icon(false));
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Claude HQ', click: () => raise(null) },
      { label: 'Blocked Inbox', click: () => raise(deepLink(null)) },
      { type: 'separator' },
      { label: 'Quit', click: () => quit(0) },
    ]));
    tray.on('click', () => raise(null));
    reachState.tray = true;
  } catch {
    tray = null;
  }
  // global hotkey → raise into the Blocked Inbox
  const accel = parseHotkey(readConfigJson());
  if (accel) {
    try {
      if (globalShortcut.register(accel, () => raise(deepLink(null)))) reachState.hotkey = accel;
      else console.warn(`claude-hq: global hotkey ${accel} is taken by another app (set electron.hotkey in config.json)`);
    } catch (e) {
      console.warn(`claude-hq: global hotkey ${accel}: ${errMessage(e)}`);
    }
  }
  // notifications: merged bursts, ≤ 1 per pane per minute, only while the window is not focused
  const lastAt = new Map();
  let pending: string[] = [], timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    const t = Date.now();
    const rows = pending.map((id) => feed.tracker.blocked.get(id)).filter((r): r is BlockedRow => !!r)
      .filter((r) => !((lastAt.get(r.id) ?? -Infinity) + NOTIFY_RATE_MS > t));
    pending = [];
    if (!rows.length || mainWin?.isFocused()) return;
    if (!Notification.isSupported?.()) {
      if (process.env.HQ_REACH_LOG) console.log('HQ-REACH notify skipped: no notification service on this desktop');
      return;
    }
    for (const r of rows) lastAt.set(r.id, t);
    const n = notifyText(rows);
    try {
      const note = new Notification({ title: n.title, body: n.body, silent: true });
      note.on('click', () => raise(n.link));
      note.show();
      reachState.notified++;
      if (process.env.HQ_REACH_LOG) console.log(`HQ-REACH notify ${JSON.stringify(n)}`);
    } catch {}
  };
  const update = ({ count, became }: BlockedChange) => {
    if (count !== reachState.count) {
      reachState.count = count;
      const tt = trayText(count, sessionName);
      if (tray) {
        try {
          tray.setImage(icon(count > 0));
          tray.setToolTip(tt.tooltip);
          tray.setTitle?.(tt.title); // macOS menu bar / some Linux indicators
        } catch {}
      }
      try {
        reachState.badge = app.setBadgeCount(count) ? count : null; // macOS dock, Unity launcher; false elsewhere
      } catch {
        reachState.badge = null;
      }
      if (process.env.HQ_REACH_LOG) console.log(`HQ-REACH ${JSON.stringify({ ...reachState, tooltip: tt.tooltip, focused: !!mainWin?.isFocused() })}`);
    }
    if (became.length) {
      pending.push(...became);
      timer ??= setTimeout(flush, NOTIFY_MERGE_MS);
    }
  };
  feed.tracker.on('change', update);
  update({ count: feed.tracker.count, became: [] });
}

const iconCache = new Map<boolean, NativeImage>();
function icon(alert: boolean): NativeImage {
  let img = iconCache.get(alert);
  if (!img) {
    img = nativeImage.createFromBitmap(trayBitmap(alert, 32), { width: 32, height: 32, scaleFactor: 2 });
    iconCache.set(alert, img);
  }
  return img;
}

/** What the page's WebGL probe reports (unknown until narrowed: it crosses executeJavaScript). */
interface ShootInfo { renderer?: string | null; stats?: unknown }
const shootInfo = (v: unknown): ShootInfo =>
  isRecord(v) ? { renderer: typeof v.renderer === 'string' || v.renderer === null ? v.renderer : undefined, stats: v.stats } : {};

async function shoot(win: BrowserWindow, file: string) {
  const wc = win.webContents;
  const js = (s: string): Promise<unknown> => wc.executeJavaScript(s, true);
  const t0 = Date.now();
  while (Date.now() - t0 < 20_000 && !(await js('!!(window.__hq && window.__hq.ready)').catch(() => false))) await sleep(200);
  const ready = await js('!!(window.__hq && window.__hq.ready)').catch(() => false);
  if (opts.shootPose) {
    const p = opts.shootPose;
    const call = /^[-\d.]+(,[-\d.]+){4}$/.test(p) ? `window.__hq.setPose(${p})` : `window.__hq.pose(${JSON.stringify(p)})`;
    await js(`Promise.resolve(${call})`).catch((e) => console.error(`shoot: pose failed: ${errMessage(e)}`));
  }
  await sleep(opts.shootWait);
  const info = shootInfo(await js(`(() => { const c = document.createElement('canvas').getContext('webgl2');
    const d = c && c.getExtension('WEBGL_debug_renderer_info');
    return { renderer: d && c.getParameter(d.UNMASKED_RENDERER_WEBGL), stats: window.__hq?.stats?.() ?? null }; })()`).catch(() => ({})));
  const feat = app.getGPUFeatureStatus();
  const img = await wc.capturePage();
  fs.writeFileSync(file, img.toPNG());
  const soft = /swiftshader|llvmpipe|software/i.test(info.renderer ?? '');
  console.log('SHOOT ' + JSON.stringify({ file, ready, renderer: info.renderer, size: img.getSize(), webgl2: feat.webgl2,
    gpuCompositing: feat.gpu_compositing, stats: info.stats }));
  await quit(soft ? 2 : 0);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let quitting = false;
async function quit(code = 0) {
  if (quitting) return;
  quitting = true;
  try {
    globalShortcut.unregisterAll();
    reachFeed?.close();
    tray?.destroy();
  } catch {}
  // close() releases control children (terminal.release) and SIGTERMs observe ones (SIGKILL after 1 s), so give it
  // a real bound; on timeout SIGKILL every child ourselves instead of leaving them for the next start's reaper scan.
  let closed = false;
  try {
    await Promise.race([backend?.close().then(() => (closed = true)), sleep(4000)]);
  } catch {}
  if (backend && !closed) backend.kill();
  app.exit(code);
}

app.on('window-all-closed', () => quit(0));
app.on('before-quit', (e) => {
  if (!quitting && backend) {
    e.preventDefault();
    quit(0);
  }
});
let signals = 0;
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    if (++signals > 1) {
      backend?.kill();
      app.exit(1);
    }
    quit(0);
  });
}
if (primary) app.whenReady().then(start).catch((e) => {
  console.error(`claude-hq: ${e instanceof Error ? (e.stack ?? e) : e}`);
  quit(1);
});
