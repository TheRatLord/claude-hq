/**
 * The desktop shell around the valley window (electron/main.ts makes the window, this makes it a tool you leave
 * running all day): the tray icon + menu, the dock / taskbar badge, native notifications, the summon hotkey,
 * minimize / close to tray, start at login, the render mode for hidden windows, window-state persistence, and the
 * IPC end of the preload bridge (shared/desktop.ts). Pure decisions live in model.ts / icon.ts (unit-tested); this
 * file is the Electron glue. docs/valley/desktop.md is the map.
 */
import { app, globalShortcut, ipcMain, Menu, nativeImage, Notification, screen, Tray } from 'electron';
import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent, MenuItemConstructorOptions, NativeImage } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { badgeText, DESKTOP_DEFAULTS, IPC, sanitizeDesktopPrefs, sanitizeToMain } from '../shared/desktop.ts';
import type { DesktopPrefs, DesktopPrefsReply, DesktopStatus, DesktopTarget, RenderMode, ToPage } from '../shared/desktop.ts';
import { iconPng } from './icon.ts';
import type { IconBadge } from './icon.ts';
import { autostartEntry, loginArgs, renderMode, restoreWindowState, trayKey, trayMenu, trayTooltip } from './model.ts';
import type { TrayAction, TrayItem, WindowState } from './model.ts';
import { errMessage } from '../shared/guards.ts';

// ---- small JSON files in userData ----

function readJson(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function writeJson(file: string, data: unknown): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  } catch (e) { console.warn(`claude-valley: could not save ${path.basename(file)}: ${errMessage(e)}`); }
}

// ---- window state ----

const WINDOW_FILE = 'window-state.json';
export function loadWindowState(userData: string): WindowState {
  let areas: { x: number; y: number; width: number; height: number }[] = [];
  try {
    const primary = screen.getPrimaryDisplay();
    areas = [primary, ...screen.getAllDisplays().filter((d) => d.id !== primary.id)].map((d) => d.workArea);
  } catch { /* no screen yet */ }
  return restoreWindowState(readJson(path.join(userData, WINDOW_FILE)), areas);
}
/** keep the window's state on disk (normal bounds, maximized, fullscreen); returns a flush for quitting */
export function trackWindowState(win: BrowserWindow, userData: string): () => void {
  const file = path.join(userData, WINDOW_FILE);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = '';
  const save = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (win.isDestroyed()) return;
    const s: WindowState = { bounds: win.getNormalBounds(), maximized: win.isMaximized(), fullscreen: win.isFullScreen() };
    const json = JSON.stringify(s);
    if (json !== last) { last = json; writeJson(file, s); }
  };
  const soon = () => { if (timer) clearTimeout(timer); timer = setTimeout(save, 600); };
  win.on('resize', soon); win.on('move', soon);
  win.on('maximize', save); win.on('unmaximize', save); win.on('enter-full-screen', save); win.on('leave-full-screen', save); win.on('close', save);
  return save;
}

// ---- the shell ----

export interface ShellOpts {
  win: BrowserWindow;
  /** the page origin: IPC from anything else is ignored */
  origin: string;
  userData: string;
  /** process.argv after the electron binary (for the start-at-login command line) */
  argv: string[];
  quit(): void;
  /** first time the window is shown (a --tray start defers it): main.ts applies the saved maximized / fullscreen */
  firstShow(): void;
}

export interface Shell {
  /** bring the window up and tell the page (the hotkey, a second launch, the dock) */
  summon(): void;
  /** test / debug: the last badge and tray state */
  debug(): { badge: string; tooltip: string; menu: TrayItem[]; mode: RenderMode; tray: boolean; hotkeyOk: boolean };
  dispose(): void;
}

export function createShell(o: ShellOpts): Shell {
  const { win } = o;
  const prefsFile = path.join(o.userData, 'desktop.json');
  let prefs: DesktopPrefs = sanitizeDesktopPrefs(readJson(prefsFile), DESKTOP_DEFAULTS);
  let status: DesktopStatus = { need: 0, done: 0, asks: [] };
  let paused = false;
  let mode: RenderMode | null = null;
  let shown = false;
  let hotkeyOk = true;
  let registered = '';
  let quitting = false;
  const mac = process.platform === 'darwin', windows = process.platform === 'win32', linux = process.platform === 'linux';

  const send = (m: ToPage) => { if (!win.isDestroyed()) win.webContents.send(IPC.toPage, m); };
  const visible = () => !win.isDestroyed() && win.isVisible() && !win.isMinimized();

  // ---- show / hide ----
  function show(): void {
    if (win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    if (!shown) { shown = true; o.firstShow(); }
    win.focus();
  }
  function hide(): void {
    if (win.isDestroyed()) return;
    if (tray) win.hide(); else win.minimize();
  }
  function summon(): void { show(); send({ t: 'summoned', need: status.need }); }
  function toggle(): void { if (visible() && win.isFocused()) hide(); else summon(); }
  function open(target: DesktopTarget): void { show(); send({ t: 'open', target }); }

  // ---- render mode ----
  function pushMode(force = false): void {
    const m = renderMode({ visible: visible(), minimized: !win.isDestroyed() && win.isMinimized() }, { paused, pauseHidden: prefs.pauseHidden });
    if (m === mode && !force) return;
    mode = m;
    send({ t: 'render', mode: m });
    refresh();
  }

  // ---- icons ----
  const iconBadge = (): IconBadge => ({ need: status.need, done: status.done > 0 });
  function trayImage(b: IconBadge): NativeImage {
    if (linux) return nativeImage.createFromBuffer(iconPng(32, b));
    const img = nativeImage.createFromBuffer(iconPng(16, b), { scaleFactor: 1 });
    img.addRepresentation({ scaleFactor: 2, buffer: iconPng(32, b) });
    return img;
  }

  // ---- tray ----
  let tray: Tray | null = null;
  try {
    tray = new Tray(trayImage(iconBadge()));
    tray.setToolTip('Claude Valley');
    if (!mac) tray.on('click', toggle);
  } catch (e) { tray = null; console.warn(`claude-valley: no tray icon (${errMessage(e)})`); }

  function act(a: TrayAction): void {
    if (a.kind === 'ask') open({ kind: 'terminal', id: a.id });
    else if (a.kind === 'mailbox') open({ kind: 'mailbox' });
    else if (a.kind === 'show') { if (visible()) hide(); else summon(); }
    else if (a.kind === 'pause') { paused = !paused; pushMode(); }
    else o.quit();
  }
  const toTemplate = (items: TrayItem[]): MenuItemConstructorOptions[] => items.map((i) =>
    i.type === 'sep' ? { type: 'separator' }
      : i.type === 'label' ? { label: i.label, enabled: false }
        : i.type === 'check' ? { type: 'checkbox', label: i.label, checked: i.checked, click: () => act(i.action) }
          : { label: i.label, enabled: i.enabled ?? true, click: () => act(i.action) });

  let lastKey = '';
  let lastBadge = '-';
  let lastNeed = 0;
  let menu: TrayItem[] = [];
  let tooltip = '';
  function refresh(): void {
    const v = { paused, visible: visible() };
    const key = trayKey(status, v);
    if (key === lastKey) return;
    lastKey = key;
    menu = trayMenu(status, v);
    tooltip = trayTooltip(status, paused);
    const b = iconBadge();
    if (tray && !tray.isDestroyed()) {
      try {
        tray.setImage(trayImage(b));
        tray.setToolTip(tooltip);
        tray.setContextMenu(Menu.buildFromTemplate(toTemplate(menu)));
      } catch (e) { console.warn(`claude-valley: tray update failed: ${errMessage(e)}`); }
    }
    const text = badgeText(status.need, status.done);
    if (text !== lastBadge) {
      lastBadge = text;
      try {
        if (mac) app.dock?.setBadge(text);
        else if (linux) app.setBadgeCount(status.need);   // Unity launcher API, where a .desktop entry exists
        if (windows && !win.isDestroyed()) win.setOverlayIcon(text ? nativeImage.createFromBuffer(iconPng(16, b, { badgeOnly: true })) : null, text ? tooltip : '');
        // the window icon carries the badge too: taskbars / docks without a badge API (most Linux desktops)
        if (linux && !win.isDestroyed()) win.setIcon(nativeImage.createFromBuffer(iconPng(64, b)));
      } catch (e) { console.warn(`claude-valley: badge update failed: ${errMessage(e)}`); }
    }
    // a new ask while you are elsewhere: the taskbar entry asks for attention (Windows / Linux urgency, macOS dock)
    if (status.need > lastNeed && !win.isDestroyed() && !win.isFocused()) {
      try { if (mac) app.dock?.bounce('informational'); else win.flashFrame(true); } catch { /* optional */ }
    }
    lastNeed = status.need;
  }

  // ---- notifications ----
  const live = new Set<Notification>();
  const iconImg = () => nativeImage.createFromBuffer(iconPng(64, { need: 0, done: false }));
  function notify(title: string, body: string, target: DesktopTarget): void {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body, icon: iconImg(), silent: false });
    const drop = () => { live.delete(n); };
    n.on('click', () => { drop(); open(target); });
    n.on('close', drop);
    live.add(n);   // keep a reference until it is gone (garbage-collected notifications lose their click on Windows)
    if (live.size > 8) { const first = live.values().next().value; if (first) { live.delete(first); first.close(); } }
    n.show();
  }

  // ---- hotkey ----
  function registerHotkey(): void {
    if (registered) { try { globalShortcut.unregister(registered); } catch { /* ignore */ } registered = ''; }
    hotkeyOk = true;
    if (!prefs.hotkey) return;
    try { hotkeyOk = globalShortcut.register(prefs.hotkey, toggle); } catch { hotkeyOk = false; }
    if (hotkeyOk) registered = prefs.hotkey;
    else console.warn(`claude-valley: the summon hotkey ${prefs.hotkey} is taken (Settings → Alerts to pick another)`);
  }

  // ---- start at login ----
  const autostartFile = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart', 'claude-valley.desktop');
  function applyLogin(): void {
    const entry = app.isPackaged ? [] : [path.resolve(o.argv[0] ?? '.')];
    const args = [...entry, ...loginArgs(o.argv.slice(app.isPackaged ? 0 : 1))];
    try {
      if (linux) {
        if (prefs.startAtLogin) { fs.mkdirSync(path.dirname(autostartFile), { recursive: true }); fs.writeFileSync(autostartFile, autostartEntry([process.execPath, ...args])); }
        else if (fs.existsSync(autostartFile)) fs.unlinkSync(autostartFile);
      } else app.setLoginItemSettings({ openAtLogin: prefs.startAtLogin, path: process.execPath, args });
    } catch (e) { console.warn(`claude-valley: start at login: ${errMessage(e)}`); }
  }

  // ---- IPC (the page end is electron/preload.ts) ----
  const ours = (e: IpcMainEvent | IpcMainInvokeEvent) => {
    if (win.isDestroyed() || e.sender !== win.webContents) return false;
    try { return new URL(e.senderFrame?.url ?? '').origin === o.origin; } catch { return false; }
  };
  const reply = (): DesktopPrefsReply => ({ prefs, hotkeyOk, loginSupported: linux || mac || windows, traySupported: !!tray });
  const onMessage = (e: IpcMainEvent, raw: unknown) => {
    if (!ours(e)) return;
    const m = sanitizeToMain(raw);
    if (!m) return;
    if (m.t === 'status') { status = m.status; refresh(); }
    else notify(m.title, m.body, m.target);
  };
  ipcMain.on(IPC.toMain, onMessage);
  ipcMain.handle(IPC.prefs, (e, patch: unknown) => {
    if (!ours(e)) return reply();
    if (patch && typeof patch === 'object') {
      const before = prefs;
      prefs = sanitizeDesktopPrefs({ ...prefs, ...(patch as object) }, prefs);
      writeJson(prefsFile, prefs);
      if (prefs.hotkey !== before.hotkey) registerHotkey();
      if (prefs.startAtLogin !== before.startAtLogin) applyLogin();
      if (prefs.pauseHidden !== before.pauseHidden) pushMode();
    }
    return reply();
  });

  // ---- window events ----
  win.on('minimize', () => { if (prefs.minimizeToTray && tray) win.hide(); pushMode(); });
  win.on('close', (e) => { if (prefs.closeToTray && tray && !quitting) { e.preventDefault(); win.hide(); pushMode(); } });
  win.on('hide', () => pushMode()); win.on('restore', () => pushMode());
  win.on('show', () => { if (!shown) { shown = true; o.firstShow(); } pushMode(); });
  win.on('focus', () => { try { win.flashFrame(false); } catch { /* optional */ } refresh(); });
  // a reload starts the page live: tell it again
  win.webContents.on('did-finish-load', () => { pushMode(true); });
  app.on('before-quit', () => { quitting = true; });

  registerHotkey();
  if (prefs.startAtLogin) applyLogin();   // keep the entry pointing at this checkout
  refresh();

  return {
    summon,
    debug: () => ({ badge: lastBadge === '-' ? '' : lastBadge, tooltip, menu, mode: mode ?? 'live', tray: !!tray, hotkeyOk }),
    dispose() {
      quitting = true;
      try { globalShortcut.unregisterAll(); } catch { /* ignore */ }
      ipcMain.removeListener(IPC.toMain, onMessage);
      ipcMain.removeHandler(IPC.prefs);
      for (const n of live) n.close();
      tray?.destroy(); tray = null;
    },
  };
}
