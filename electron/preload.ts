/**
 * The page's only window onto the shell: `window.valleyDesktop` (shared/desktop.ts → DesktopBridge).
 * Runs sandboxed with contextIsolation, so it is a classic script that may only require('electron'): main.ts strips
 * the types at startup (node:module stripTypeScriptTypes) and writes the result next to the user data. No imports
 * beyond types, and the channel names are literals (preload.test.ts checks them against IPC in shared/desktop.ts).
 * Nothing node-ish leaks: every function forwards plain data over one channel each way.
 */
import type { DesktopBridge, DesktopPrefs, ToPage } from '../shared/desktop.ts';

const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

const bridge: DesktopBridge = {
  version: 1,
  platform: process.platform,
  status: (status) => ipcRenderer.send('valley:to-main', { t: 'status', status }),
  notify: (n) => ipcRenderer.send('valley:to-main', { t: 'notify', title: n.title, body: n.body, target: n.target }),
  prefs: () => ipcRenderer.invoke('valley:prefs', null),
  setPrefs: (patch: Partial<DesktopPrefs>) => ipcRenderer.invoke('valley:prefs', patch),
  onCommand(fn) {
    const h = (_e: unknown, m: ToPage) => fn(m);
    ipcRenderer.on('valley:to-page', h);
    return () => { ipcRenderer.removeListener('valley:to-page', h); };
  },
};
contextBridge.exposeInMainWorld('valleyDesktop', bridge);
