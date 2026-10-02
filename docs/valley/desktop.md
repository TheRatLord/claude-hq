# Desktop app: tray, badges, notifications, hotkey, window state

The Electron shell (`npm run app`, `npm run app:demo`) makes the valley a tool you leave running all day. Everything
here is shell-only: the browser build feature-detects the bridge and is unaffected.

Key sources: `electron/main.ts` (boot, window, single-instance lock, preload build), `electron/shell.ts` (tray,
badges, notifications, hotkey, login item, render mode, IPC), `electron/model.ts` (pure: tray menu, tooltip, render
mode, window state, autostart entry), `electron/icon.ts` (pure: the icons, drawn in code, PNG-encoded),
`electron/preload.ts` (the bridge), `shared/desktop.ts` (bridge types, IPC channel names, sanitizers, desktop prefs,
accelerators, badge text), `renderer/src/farm/desktop.ts` (the page end), `hud/notify.ts` (native notification
path), `hud/desktopset.ts` (Settings → Alerts → Desktop app), `core/loop.ts` (`setBackground`).

## The bridge (`window.valleyDesktop`)

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The preload is TypeScript, but a sandboxed
preload is a classic script that may only `require('electron')`, so `main.ts` strips its types at startup
(`node:module` `stripTypeScriptTypes`) into `<userData>/preload.js`. It imports types only; its channel names are
literals checked against `IPC` by `electron/preload.test.ts`, which also runs the stripped script in a `vm` to pin
the exposed surface:

| member | direction | what |
|---|---|---|
| `version`, `platform` | — | `1`, `process.platform` (the page sets `<html data-desktop=…>`) |
| `status({ need, done, asks })` | page → shell | who needs you (first 9, newest first like the strip) and unseen finishes; sent every 500 ms **only when it changes** |
| `notify({ title, body, target })` | page → shell | a native notification (`target`: `{ kind: 'terminal', id }` or `{ kind: 'mailbox' }`) |
| `prefs()` / `setPrefs(patch)` | invoke | the desktop prefs below + `hotkeyOk`, `traySupported`, `loginSupported` |
| `onCommand(fn)` | shell → page | `open` (a target), `summoned` (`need`), `render` (`live` / `background` / `paused`) |

The shell trusts nothing from the page: every message goes through `sanitizeToMain` / `sanitizeStatus` /
`sanitizeTarget` / `sanitizeDesktopPrefs` (ids by pattern, strings clipped and stripped of control characters,
counts clamped), and IPC from any sender other than the window's own `webContents` on the page origin is ignored.

## Tray, menu, badges

* **Tray icon**: Clawd's block face (same figure as the tab icon), a gold count badge (asks, `9+` past nine) or a blue
  dot (unseen finishes). Linux 32 px, macOS / Windows 16 px + 32 px @2x. Tooltip: `Claude Valley · 2 need you · 1
  finished` (`trayTooltip`). A left click toggles the window (not macOS).
* **Menu** (`trayMenu`): "N farmers need you", one item per ask (`Name: question`, click → focus + their terminal),
  "…and N more" / "Open the mailbox (Needs you)", unseen finishes, **Show / Hide valley**, **Pause rendering**
  (checkbox), **Quit Claude Valley**. Rebuilt only when `trayKey` changes (native menus flicker on Linux).
* **Dock / taskbar badge** (`badgeText`): macOS `app.dock.setBadge` (count or `•`); Windows `setOverlayIcon`
  (badge-only 16 px disc); Linux `app.setBadgeCount` (Unity launcher API, where a `.desktop` entry exists) **and** the
  window icon carries the badge (most Linux taskbars have no badge API). A new ask while unfocused flashes the
  taskbar entry (`flashFrame`; macOS dock bounce), cleared on focus.

## Notifications

`hud/notify.ts` keeps its opt-in pref (`notify`, Settings → Alerts), burst merging (0.6 s, `notifyCopy`), the
one-per-farmer-per-15 s limit and the "only while away" rule. With the bridge present, `notifyPermission()` is
`granted` (no browser prompt) and a burst goes to `bridge.notify` instead of `new Notification`: an Electron
`Notification` (Clawd icon). Its click shows + focuses the window and sends `open` → that farmer's terminal (several
asks: the mailbox's Needs you tab; a farmer that left meanwhile: the mailbox too).

## Summon hotkey

Global shortcut, default `CommandOrControl+Alt+V` (Ctrl+Alt+V; ⌘⌥V on macOS). Visible and focused → hide (to the
tray when there is one, else minimize); otherwise show + focus and send `summoned`: with asks pending the page opens
the mailbox on **Needs you**. Change it in Settings → Alerts → Desktop app (click, press a combination; Esc keeps,
Backspace clears, *Default* resets). `isAccelerator` refuses a bare key or Shift+key (it would steal typing
everywhere; function keys may stand alone); a shortcut another app holds reports `hotkeyOk: false` and the row says so.

## Desktop prefs (`<userData>/desktop.json`, per machine)

| pref | default | what |
|---|---|---|
| `hotkey` | `CommandOrControl+Alt+V` | above; `''` = none |
| `minimizeToTray` | off | minimizing hides to the tray (only when a tray exists) |
| `closeToTray` | off | the close button hides to the tray; quit from the tray menu |
| `startAtLogin` | off | macOS / Windows `app.setLoginItemSettings`; Linux an XDG entry `~/.config/autostart/claude-valley.desktop` (`autostartEntry`). Relaunches with `--tray` plus `--session` / `--port` / `--profile` (`loginArgs`) |
| `pauseHidden` | off | hidden / minimized: no frames at all instead of the background rate |

## Window state, single instance, profiles

* `<userData>/window-state.json`: normal bounds (`getNormalBounds`), maximized, fullscreen; saved 0.6 s after a move /
  resize, at once on (un)maximize, fullscreen and close, and on quit. `restoreWindowState` clamps sizes to
  [640×400, the largest screen] and recentres a window whose screen is gone (less than a third on any screen, or its
  title strip off-screen). Maximized / fullscreen apply on the first show (a `--tray` start defers it).
* `app.requestSingleInstanceLock()` per profile: a second launch focuses the first (`second-instance` → summon).
  The demo uses its own profile (`<userData>-demo`), so `app:demo` never fights the live valley; `--profile DIR`
  picks any (tests use a temp dir).
* `--tray` starts hidden in the tray (only when the tray exists).

## Rendering in the background

`backgroundThrottling` is **off** for the window: Chromium's intensive throttling would otherwise stretch a hidden
page's timers to one wake-up a minute after five minutes, and asks / notifications would arrive late. Instead the
shell decides (`renderMode`): tray **Pause rendering** → `paused`; hidden or minimized → `background` (or `paused`
with `pauseHidden`); else `live`. The page maps it (`renderInterval`) onto `engine.setBackground` →
`loop.setBackground(ms)`: `null` = rAF as normal, `500` = a 2 fps timer instead of rAF, `0` = no frames. The WebSocket,
the 4 Hz model tick, the HUD timer, notifications and the badge do not depend on frames, so they stay live. The
mode is re-sent after a page reload. The idle throttle (Settings → Graphics) still applies while live.

## Testing

* Unit: `shared/desktop.test.ts` (badge text, sanitizers, prefs, accelerators), `electron/model.test.ts` (tray menu,
  tooltip, render mode, window state, autostart), `electron/icon.test.ts` (pixels + PNG round-trip),
  `electron/preload.test.ts` (strip + sandbox shape), `renderer/src/farm/desktop.test.ts` (status order, command
  routing), `core/core.test.ts` (`setBackground`).
* `browser-tests/electron.spec.ts` (Playwright `_electron`): launches `electron/main.ts --demo 4 --scenario allStates`
  with a temp `--profile` and `--no-sandbox` (a dev checkout's `chrome-sandbox` is not setuid root); on Linux without
  a display it starts a private `Xvfb`; with neither, or when Electron cannot start, it skips. Checks the bridge
  surface (and no `require` / `process` in the page), prefs, page asks → tray menu + badge
  (`globalThis.__valleyShell.debug()` in the main process), hide / show → `background` / `live`, the Alerts rows +
  `pauseHidden` → `paused`, an `open` command, and the window state written on quit. (Under a bare Xvfb there is no
  window manager, so `minimize()` is a no-op there; the test hides instead.)
* By hand: `xvfb-run -a node_modules/.bin/electron --no-sandbox electron/main.ts --demo 4 --profile scratch/desk/p`.
