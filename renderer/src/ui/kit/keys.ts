// @pure
/**
 * Keycap labels (docs/design/ui-kit.md §3 Keycap / Legend, §8): OS-correct names from platform.ts (`Ctrl`/`⌘`,
 * `Alt`/`⌥`, the Leader = `platform.leaderLabel`), one cap per key of a chord. Letters are drawn in the sign font so
 * O ≠ 0 and I ≠ 1; symbol caps (⏎ ↑ ↓ / [) use mono. Pure. Owner: UI (kit).
 */

/** The platform the kit labels keys for; set once by injectKit({platform}). */
export interface KeyPlatform { mac: boolean; leaderLabel: string }
let PLATFORM: KeyPlatform = { mac: false, get leaderLabel() { return 'Ctrl+`'; } };
export function setKeyPlatform(p: KeyPlatform) { if (p) PLATFORM = p; }
export const keyPlatform = () => PLATFORM;

const NAMED: Record<string, string> = {
  enter: '⏎', return: '⏎', escape: 'Esc', esc: 'Esc', tab: 'Tab', space: 'Space', backspace: '⌫', delete: 'Del',
  arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', up: '↑', down: '↓', left: '←', right: '→',
  pageup: 'PgUp', pagedown: 'PgDn', home: 'Home', end: 'End', backquote: '`',
};

/**
 * One key's cap label for this platform.
 * `k` e.g. 'Mod' (primary: Ctrl/⌘), 'Ctrl', 'Alt', 'Shift', 'Enter', 'ArrowUp', 'k', '`'
 */
export function keyLabel(k: string, p: { mac?: boolean } = PLATFORM): string {
  const s = String(k);
  const l = s.toLowerCase();
  if (l === 'mod' || l === 'primary' || l === 'cmdorctrl') return p.mac ? '⌘' : 'Ctrl';
  if (l === 'ctrl' || l === 'control') return p.mac ? '⌃' : 'Ctrl';
  if (l === 'meta' || l === 'cmd' || l === 'command') return p.mac ? '⌘' : 'Super';
  if (l === 'alt' || l === 'option' || l === 'opt') return p.mac ? '⌥' : 'Alt';
  if (l === 'shift') return '⇧';
  if (NAMED[l]) return NAMED[l];
  if (/^key[a-z]$/i.test(s)) return s.slice(3).toUpperCase();
  if (/^digit\d$/i.test(s)) return s.slice(5);
  return s.length === 1 ? s.toUpperCase() : s;
}

/**
 * Split a combo into cap labels. 'Mod+K' → ['Ctrl','K']; 'Leader' → the leader as ONE cap ('Ctrl `'), because the
 * Leader reads as a single named key; 'Shift+S' → ['⇧','S']. A literal '+' key is written 'Plus'.
 */
export function comboCaps(combo: string | string[], p: KeyPlatform = PLATFORM): string[] {
  if (Array.isArray(combo)) return combo.flatMap((c) => comboCaps(c, p));
  const s = String(combo);
  if (/^leader$/i.test(s)) return [leaderCap(p)];
  if (s === '+' || /^plus$/i.test(s)) return ['+'];
  return s.split('+').filter(Boolean).map((k) => keyLabel(k, p));
}

/** The Leader as one cap label: 'Ctrl+`' → 'Ctrl `' (mac: '⌃ `'). */
export function leaderCap(p: KeyPlatform = PLATFORM): string {
  const raw = String(p.leaderLabel || 'Ctrl+`');
  return raw.split('+').map((k) => (k.length === 1 ? k : keyLabel(k, p))).join(' ').replace(/^([⌃⌥⌘⇧])(?=\S)/, '$1 ');
}

/** Cap labels drawn in mono (symbols); everything else uses the sign font. */
export const isSymbolCap = (label: string) => !/[A-Za-z0-9]/.test(label);
