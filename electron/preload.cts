// Electron preload (contextIsolation, sandboxed). The ONLY bridge (Owner: BE):
//   setXtermFocused(bool)  one-way "is xterm focused" report for the before-input-event policy in electron/main.ts (§8.3)
//   onOpen(fn)             deep links from the main process (global hotkey → 'inbox', notification click →
//                          'inbox:<name>'); fn(link) gets the same values as `?open=`. Registering tells main the page
//                          can take links live; otherwise main reloads the page at /?open=<link>.
//   nativeNotifications    true: Electron shows blocked notifications natively (the page's web Notification is denied)
import { contextBridge, ipcRenderer } from 'electron';

let openListener: ((link: string) => void) | null = null;
ipcRenderer.on('hq:open', (_e, link: unknown) => {
  if (typeof openListener === 'function' && typeof link === 'string') openListener(link);
});

contextBridge.exposeInMainWorld('hqElectron', Object.freeze({
  setXtermFocused: (focused: boolean) => ipcRenderer.send('hq:xterm-focus', !!focused),
  onOpen: (fn: (link: string) => void) => {
    openListener = fn;
    ipcRenderer.send('hq:open-ready');
  },
  nativeNotifications: true,
}));
