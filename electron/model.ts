/**
 * Pure pieces of the desktop shell (no electron import, unit-tested in model.test.ts): the tray menu model and
 * tooltip, window-state persistence (sanitize + keep on a screen), the render mode for a window state, and the XDG
 * autostart entry for "start at login" on Linux.
 */
import type { DesktopStatus, RenderMode } from '../shared/desktop.ts';
import { badgeText } from '../shared/desktop.ts';

// ---- tray menu ----

export type TrayAction = { kind: 'ask'; id: string } | { kind: 'mailbox' } | { kind: 'show' } | { kind: 'pause' } | { kind: 'quit' };
export type TrayItem =
  | { type: 'item'; label: string; action: TrayAction; enabled?: boolean }
  | { type: 'check'; label: string; action: TrayAction; checked: boolean }
  | { type: 'label'; label: string }
  | { type: 'sep' };

/** Electron menu labels treat & as a mnemonic marker on some platforms */
const plain = (s: string) => s.replace(/&/g, '&&');
const clip = (s: string, n: number) => s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;

export function trayMenu(s: DesktopStatus, o: { paused: boolean; visible: boolean }): TrayItem[] {
  const items: TrayItem[] = [];
  if (s.need > 0) {
    items.push({ type: 'label', label: s.need === 1 ? '1 farmer needs you' : `${s.need} farmers need you` });
    for (const a of s.asks) {
      items.push({ type: 'item', label: plain(clip(a.question ? `${a.name}: ${a.question}` : a.name, 60)), action: { kind: 'ask', id: a.id } });
    }
    if (s.need > s.asks.length) items.push({ type: 'item', label: `…and ${s.need - s.asks.length} more`, action: { kind: 'mailbox' } });
    items.push({ type: 'item', label: 'Open the mailbox (Needs you)', action: { kind: 'mailbox' } });
  } else {
    items.push({ type: 'label', label: 'Nobody needs you right now' });
  }
  if (s.done > 0) items.push({ type: 'label', label: s.done === 1 ? '1 finished, not yet seen' : `${s.done} finished, not yet seen` });
  items.push({ type: 'sep' });
  items.push({ type: 'item', label: o.visible ? 'Hide valley' : 'Show valley', action: { kind: 'show' } });
  items.push({ type: 'check', label: 'Pause rendering', action: { kind: 'pause' }, checked: o.paused });
  items.push({ type: 'sep' });
  items.push({ type: 'item', label: 'Quit Claude Valley', action: { kind: 'quit' } });
  return items;
}

export function trayTooltip(s: DesktopStatus, paused: boolean): string {
  const bits = ['Claude Valley'];
  if (s.need) bits.push(s.need === 1 ? '1 needs you' : `${s.need} need you`);
  if (s.done) bits.push(`${s.done} finished`);
  if (!s.need && !s.done) bits.push('all quiet');
  if (paused) bits.push('paused');
  return bits.join(' · ');
}

/** a short key for "did anything the tray shows change" (rebuilding a native menu at 4 Hz flickers on Linux) */
export function trayKey(s: DesktopStatus, o: { paused: boolean; visible: boolean }): string {
  return JSON.stringify([badgeText(s.need, s.done), s.need, s.done, s.asks, o.paused, o.visible]);
}

// ---- render mode ----

/** what the page should draw for a window state: the tray's Pause wins; hidden or minimized → background / paused */
export function renderMode(w: { visible: boolean; minimized: boolean }, o: { paused: boolean; pauseHidden: boolean }): RenderMode {
  if (o.paused) return 'paused';
  if (!w.visible || w.minimized) return o.pauseHidden ? 'paused' : 'background';
  return 'live';
}

// ---- window state ----

export interface Rect { x: number; y: number; width: number; height: number }
export interface WindowState { bounds: Rect; maximized: boolean; fullscreen: boolean }
export const MIN_W = 640, MIN_H = 400;
export const DEFAULT_SIZE = { width: 1600, height: 960 };

const num = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * A saved window state made safe for the current screens (`workAreas`: each display's work area): sizes clamped to
 * [MIN, the largest screen], and a window that would land (mostly) off every screen (a monitor unplugged since) is
 * centred on the primary one. `null` → defaults centred on the primary display.
 */
export function restoreWindowState(raw: unknown, screens: Rect[]): WindowState {
  const workAreas = screens.length ? screens : [{ x: 0, y: 0, width: DEFAULT_SIZE.width, height: DEFAULT_SIZE.height }];
  const primary = workAreas[0];
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const b = (r.bounds && typeof r.bounds === 'object' ? r.bounds : {}) as Record<string, unknown>;
  const maxW = Math.max(MIN_W, ...workAreas.map((a) => a.width)), maxH = Math.max(MIN_H, ...workAreas.map((a) => a.height));
  const width = Math.max(MIN_W, Math.min(maxW, num(b.width) ?? Math.min(DEFAULT_SIZE.width, primary.width)));
  const height = Math.max(MIN_H, Math.min(maxH, num(b.height) ?? Math.min(DEFAULT_SIZE.height, primary.height)));
  const centred = { x: primary.x + Math.round((primary.width - width) / 2), y: primary.y + Math.round((primary.height - height) / 2), width, height };
  let bounds: Rect = centred;
  const x = num(b.x), y = num(b.y);
  if (x !== null && y !== null) {
    const cand = { x, y, width, height };
    // keep it where it was when at least a third of it (and its title strip) is on some screen
    const best = Math.max(0, ...workAreas.map((a) => overlap(cand, a)));
    const titleOn = workAreas.some((a) => overlap({ x, y, width, height: 40 }, a) > 0);
    if (best >= (width * height) / 3 && titleOn) bounds = cand;
  }
  return { bounds, maximized: r.maximized === true, fullscreen: r.fullscreen === true };
}

// ---- start at login (Linux: an XDG autostart entry; macOS / Windows use app.setLoginItemSettings) ----

const quoteExec = (s: string) => /[\s"'\\$`]/.test(s) ? `"${s.replace(/(["\\$`])/g, '\\$1')}"` : s;
export function autostartEntry(exec: string[], name = 'Claude Valley'): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${name}`,
    'Comment=Watch and drive your coding agents from a cozy valley',
    `Exec=${exec.map(quoteExec).join(' ')}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

/** the command line that relaunches this app at login: the electron binary, the app entry and the live-session args */
export function loginArgs(argv: string[]): string[] {
  const keep: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--session' || a === '--port' || a === '--profile') { if (argv[i + 1] !== undefined) keep.push(a, argv[++i]); }
    else if (a === '--no-sandbox') keep.push(a);
  }
  return [...keep, '--tray'];
}
