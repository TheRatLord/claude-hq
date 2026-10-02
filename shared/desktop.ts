/**
 * The desktop bridge: the one typed surface between the Electron shell (electron/main.ts, electron/shell.ts) and the
 * page. electron/preload.ts exposes it as `window.valleyDesktop` (contextIsolation on, no node in the page); the
 * renderer feature-detects it with `desktopBridge()`, so the browser build never sees any of this.
 *
 * Also the pure pieces both sides share: the desktop prefs (shape, defaults, sanitizer), accelerator helpers for the
 * summon hotkey, and the badge text. Everything crossing the bridge is sanitized on the main side (`sanitize*`).
 */

/** IPC channel names (electron/preload.ts repeats them as literals: a sandboxed preload cannot import; a test checks) */
export const IPC = { toMain: 'valley:to-main', toPage: 'valley:to-page', prefs: 'valley:prefs' } as const;

/** one farmer who needs you, as the tray menu lists them (newest first, like the needs-you strip) */
export interface DesktopAsk { id: string; name: string; question: string }
/** what the page reports: who needs you (count + the first few), how many finished unseen */
export interface DesktopStatus { need: number; done: number; asks: DesktopAsk[] }
/** where a notification / tray item leads: a farmer's terminal, or the mailbox's Needs you tab */
export type DesktopTarget = { kind: 'terminal'; id: string } | { kind: 'mailbox' };
/** live: draw normally · background: a few frames a second (hidden / minimized) · paused: no frames at all */
export type RenderMode = 'live' | 'background' | 'paused';

/** page → shell */
export type ToMain =
  | { t: 'status'; status: DesktopStatus }
  | { t: 'notify'; title: string; body: string; target: DesktopTarget };
/** shell → page */
export type ToPage =
  | { t: 'open'; target: DesktopTarget }
  /** the summon hotkey / tray brought the window up: with asks pending, jump to the mailbox's Needs you tab */
  | { t: 'summoned'; need: number }
  | { t: 'render'; mode: RenderMode };

/** shell-side prefs (userData/desktop.json): they describe this machine, not the browser profile */
export interface DesktopPrefs {
  /** Electron accelerator for summon / hide; '' = none */
  hotkey: string;
  /** minimizing hides the window to the tray */
  minimizeToTray: boolean;
  /** closing the window hides it to the tray (quit from the tray menu) */
  closeToTray: boolean;
  /** launch at login (hidden in the tray) */
  startAtLogin: boolean;
  /** while hidden / minimized: draw nothing (true) or a couple of frames a second (false) */
  pauseHidden: boolean;
}
export const DEFAULT_HOTKEY = 'CommandOrControl+Alt+V';
export const DESKTOP_DEFAULTS: DesktopPrefs = { hotkey: DEFAULT_HOTKEY, minimizeToTray: false, closeToTray: false, startAtLogin: false, pauseHidden: false };

/** the result of reading / patching prefs: `hotkeyOk` is false when the OS refused the shortcut (taken elsewhere) */
export interface DesktopPrefsReply { prefs: DesktopPrefs; hotkeyOk: boolean; loginSupported: boolean; traySupported: boolean }

/** the API window.valleyDesktop exposes (functions only: contextBridge copies values, proxies functions) */
export interface DesktopBridge {
  version: 1;
  platform: string;
  status(s: DesktopStatus): void;
  notify(n: { title: string; body: string; target: DesktopTarget }): void;
  prefs(): Promise<DesktopPrefsReply>;
  setPrefs(patch: Partial<DesktopPrefs>): Promise<DesktopPrefsReply>;
  /** shell commands; returns an unsubscribe */
  onCommand(fn: (m: ToPage) => void): () => void;
}

/** the bridge when running inside the Electron shell, else null (browser build, tests) */
export function desktopBridge(): DesktopBridge | null {
  const b = (globalThis as { valleyDesktop?: Partial<DesktopBridge> }).valleyDesktop;
  return b && b.version === 1 && typeof b.status === 'function' && typeof b.onCommand === 'function' ? b as DesktopBridge : null;
}

// ---- sanitizers (the shell trusts nothing the page sends) ----

const str = (v: unknown, max: number): string => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : '';
const count = (v: unknown): number => typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(9999, Math.floor(v))) : 0;
const ID_RE = /^[\w:.@/+-]{1,128}$/;

export const MAX_ASKS = 9;
export function sanitizeStatus(raw: unknown): DesktopStatus {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const asks: DesktopAsk[] = [];
  if (Array.isArray(r.asks)) {
    for (const a of r.asks) {
      if (asks.length >= MAX_ASKS) break;
      const o = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
      const id = str(o.id, 128);
      if (!ID_RE.test(id)) continue;
      asks.push({ id, name: str(o.name, 40) || id, question: str(o.question, 120) });
    }
  }
  return { need: Math.max(count(r.need), asks.length), done: count(r.done), asks };
}

export function sanitizeTarget(raw: unknown): DesktopTarget {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const id = str(r.id, 128);
  return r.kind === 'terminal' && ID_RE.test(id) ? { kind: 'terminal', id } : { kind: 'mailbox' };
}

/** a page → shell message, or null when it is not one */
export function sanitizeToMain(raw: unknown): ToMain | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (r.t === 'status') return { t: 'status', status: sanitizeStatus(r.status) };
  if (r.t === 'notify') {
    const title = str(r.title, 120);
    return title ? { t: 'notify', title, body: str(r.body, 400), target: sanitizeTarget(r.target) } : null;
  }
  return null;
}

export function sanitizeDesktopPrefs(raw: unknown, base: DesktopPrefs = DESKTOP_DEFAULTS): DesktopPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = { ...base };
  for (const k of ['minimizeToTray', 'closeToTray', 'startAtLogin', 'pauseHidden'] as const) if (typeof r[k] === 'boolean') out[k] = r[k];
  if (typeof r.hotkey === 'string' && (r.hotkey === '' || isAccelerator(r.hotkey))) out.hotkey = r.hotkey;
  return out;
}

// ---- accelerators (the summon hotkey) ----

const MODS = ['CommandOrControl', 'Control', 'Command', 'Alt', 'Shift', 'Super'] as const;
const MOD_ALIASES: Record<string, (typeof MODS)[number]> = {
  commandorcontrol: 'CommandOrControl', cmdorctrl: 'CommandOrControl', control: 'Control', ctrl: 'Control',
  command: 'Command', cmd: 'Command', alt: 'Alt', option: 'Alt', shift: 'Shift', super: 'Super', meta: 'Super',
};
const NAMED_KEYS = new Set(['Space', 'Tab', 'Backspace', 'Delete', 'Insert', 'Return', 'Enter', 'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown', 'Escape', 'Plus', ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`)]);
const isKey = (k: string) => /^[A-Z0-9]$/.test(k) || NAMED_KEYS.has(k) || /^[`\-=[\]\\;',./]$/.test(k);

/**
 * True for a global-shortcut accelerator this app accepts: at least one modifier other than Shift (a bare key or
 * Shift+key would steal typing system-wide), then exactly one key. Function keys may stand alone.
 */
export function isAccelerator(s: string): boolean {
  const parts = s.split('+');
  if (s.endsWith('++')) parts.splice(-2, 2, 'Plus');
  const key = parts.pop() ?? '';
  if (!isKey(key)) return false;
  const mods = new Set<string>();
  for (const p of parts) {
    const m = MOD_ALIASES[p.toLowerCase()];
    if (!m || mods.has(m)) return false;
    mods.add(m);
  }
  if (/^F\d+$/.test(key)) return true;
  return [...mods].some((m) => m !== 'Shift');
}

/** a KeyboardEvent-ish key press → an accelerator, or null while only modifiers are held / for an unusable key */
export function acceleratorFromKey(e: { code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }, platform: string): string | null {
  let key: string | null = null;
  const c = e.code;
  if (/^Key[A-Z]$/.test(c)) key = c.slice(3);
  else if (/^Digit\d$/.test(c)) key = c.slice(5);
  else if (/^Numpad\d$/.test(c)) key = c.slice(6);
  else if (/^F\d{1,2}$/.test(c)) key = c;
  else key = ({
    Space: 'Space', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';',
    Quote: "'", Comma: ',', Period: '.', Slash: '/', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Insert: 'Insert', Delete: 'Delete',
  } as Record<string, string>)[c] ?? null;
  if (!key) return null;
  const mac = platform === 'darwin';
  const mods: string[] = [];
  // the primary modifier is spelled CommandOrControl so a prefs file moves between machines
  if (mac ? e.metaKey : e.ctrlKey) mods.push('CommandOrControl');
  if (mac && e.ctrlKey) mods.push('Control');
  if (!mac && e.metaKey) mods.push('Super');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  const acc = [...mods, key].join('+');
  return isAccelerator(acc) ? acc : null;
}

/** an accelerator for people: Ctrl+Alt+V (Linux / Windows), ⌘⌥V (macOS) */
export function acceleratorLabel(acc: string, platform: string): string {
  if (!acc) return 'none';
  const mac = platform === 'darwin';
  const names: Record<string, string> = mac
    ? { CommandOrControl: '⌘', Command: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧', Super: '⌘' }
    : { CommandOrControl: 'Ctrl', Command: 'Super', Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Super: 'Super' };
  const parts = acc.split('+').map((p) => names[MOD_ALIASES[p.toLowerCase()] ?? ''] ?? p);
  return parts.join(mac ? '' : '+');
}

// ---- badge ----

/** dock / taskbar / tray badge text: the ask count ('9+' past nine), '•' for unseen finishes only, '' for nothing */
export function badgeText(need: number, done: number): string {
  if (need > 0) return need > 9 ? '9+' : String(Math.floor(need));
  return done > 0 ? '•' : '';
}
