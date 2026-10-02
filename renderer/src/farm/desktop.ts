/**
 * The page end of the desktop shell (Electron; shared/desktop.ts is the bridge, docs/valley/desktop.md the map).
 * A no-op in the browser: `installDesktop` returns null when `window.valleyDesktop` is absent.
 *
 *   page → shell   who needs you (count + the first few, newest first like the needs-you strip) and unseen finishes,
 *                  sent only when they change: the tray menu, tray / dock / taskbar badges come from it.
 *                  (Notifications go from hud/notify.ts.)
 *   shell → page   open a terminal / the mailbox (tray item, notification click), summoned (hotkey: asks pending →
 *                  the mailbox's Needs you tab), render mode (hidden / minimized / "Pause rendering" → engine).
 */
import { desktopBridge, MAX_ASKS } from '../../../shared/desktop.ts';
import type { DesktopBridge, DesktopStatus, RenderMode } from '../../../shared/desktop.ts';
import type { ValleyState } from './model/types.ts';
import { askOrder, shortName } from './hud/format.ts';

/** frames while the window is hidden or minimized but not paused: enough to keep systems ticking, ~nothing on the GPU */
export const BACKGROUND_MS = 500;

export function renderInterval(mode: RenderMode): number | null {
  return mode === 'live' ? null : mode === 'paused' ? 0 : BACKGROUND_MS;
}

/** the status the shell shows, from the valley (pure: unit-tested) */
export function desktopStatus(s: ValleyState): DesktopStatus {
  const asks = [...s.farmers.values()].filter((f) => f.needsYou).sort((a, b) => askOrder({ since: a.jobSince, id: a.id }, { since: b.jobSince, id: b.id }));
  let done = 0;
  for (const f of s.farmers.values()) if (!f.needsYou && f.unseenDone) done++;
  return {
    need: asks.length, done,
    asks: asks.slice(0, MAX_ASKS).map((f) => ({ id: f.id, name: shortName(f), question: (f.question ?? '').split('\n')[0].slice(0, 120) })),
  };
}

export interface DesktopDeps {
  valley(): ValleyState;
  openTerminal(id: string): void;
  openNeeds(): void;
  setBackground(ms: number | null): void;
}

export interface DesktopLink { bridge: DesktopBridge; mode(): RenderMode; dispose(): void }

export function installDesktop(d: DesktopDeps, bridge: DesktopBridge | null = desktopBridge()): DesktopLink | null {
  if (!bridge) return null;
  if (typeof document !== 'undefined') document.documentElement.dataset.desktop = bridge.platform;
  let mode: RenderMode = 'live';
  let last = '';
  const push = () => {
    let st: DesktopStatus;
    try { st = desktopStatus(d.valley()); } catch { return; }
    const key = JSON.stringify(st);
    if (key === last) return;
    last = key;
    try { bridge.status(st); } catch { /* shell gone */ }
  };
  const timer = setInterval(push, 500);
  push();
  const off = bridge.onCommand((m) => {
    if (m.t === 'render') { mode = m.mode; d.setBackground(renderInterval(m.mode)); return; }
    if (m.t === 'summoned') { if (m.need > 0 || desktopStatus(d.valley()).need > 0) d.openNeeds(); return; }
    const t = m.target;
    if (t.kind === 'terminal' && d.valley().farmers.has(t.id)) d.openTerminal(t.id);
    else d.openNeeds();
  });
  return { bridge, mode: () => mode, dispose() { clearInterval(timer); off(); } };
}
